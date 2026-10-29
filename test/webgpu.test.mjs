import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileWebGPU } from '../src/webgpu.mjs';
const root = process.env.BEND_ROOT;
const repo = fileURLToPath(new URL('..', import.meta.url));
test('checked Bend U32 subset translates different programs', { skip: !root }, async () => {
  const a = await compileWebGPU(root, path.join(repo, 'examples/kernel.bend'));
  const b = await compileWebGPU(root, path.join(repo, 'examples/bitmix.bend'));
  assert.notEqual(a.shader, b.shader);
  assert.match(b.shader, /fn f1/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-wasm-oracle-'));
  try {
    const oracleFile = path.join(dir, 'oracle.mjs'); fs.writeFileSync(oracleFile, b.oracle);
    const { default: oracle } = await import(pathToFileURL(oracleFile));
    for (const x of [0, 1, 255, 65536, 0x7fffffff, 0x80000000, 0xffffffff]) {
      assert.equal(oracle.kernel(x), ((((x | 65536) ^ 2863311530) - 7) & 16777215) >>> 0);
    }
    for (const [name, source, error] of [
      ['nat', 'import Base\ndef kernel(x: Nat) -> Nat:\n  x\n', /parameters must be U32/],
      ['divide', 'import Base\ndef kernel(x: U32) -> U32:\n  U32.div(x, 3)\n', /function U32.div/],
      ['bang', 'import Base\ndef f(x: U32) -> U32:\n  x\ndef kernel(x: U32) -> U32:\n  f!(x)\n', /parallel/],
      ['arity', 'import Base\ndef kernel(x: U32, y: U32) -> U32:\n  U32.add(x, y)\n', /exactly one/],
      ['invalid', 'import Base\ndef kernel(x: U32) -> U32:\n  "wrong"\n', /expected/]
    ]) {
      const input = path.join(dir, name + '.bend'); fs.writeFileSync(input, source);
      await assert.rejects(compileWebGPU(root, input), error);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
