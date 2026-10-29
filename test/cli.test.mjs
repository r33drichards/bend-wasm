import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflight } from '../src/compiler.mjs';
const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = process.env.BEND_ROOT;
const cli = (...args) => spawnSync(process.execPath, [path.join(repo, 'bin/bend-wasm.mjs'), ...args], { encoding: 'utf8', timeout: 180000 });
test('unknown GPU targets fail explicitly', () => {
  const r = cli('build', 'unused.bend', '--target', 'cuda');
  assert.equal(r.status, 1); assert.match(r.stderr, /not implemented/);
});
test('remote imports are refused before compiler loading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bend-wasm-test-'));
  try {
    const input = path.join(dir, 'remote.bend');
    fs.writeFileSync(input, 'import example@1.0/main.bend as X\n');
    assert.throws(() => preflight(input), /no hub downloads/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('real pinned compiler and Emscripten integration', { skip: !root, timeout: 360000 }, async t => {
  fs.mkdirSync(path.join(repo, 'build'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(repo, 'build/test-'));
  try {
    await t.test('missing emcc produces a capability error', () => {
      const r = cli('doctor', '--bend-root', root, '--emcc', path.join(dir, 'absent-emcc'));
      assert.equal(r.status, 1); assert.match(r.stderr, /ENOENT/);
    });
    await t.test('unrecognized Bend revision is refused', () => {
      const r = cli('doctor', '--bend-root', repo);
      assert.equal(r.status, 1); assert.match(r.stderr, /Unsupported Bend revision/);
    });
    for (const [name, expected] of [['answer', '42'], ['sum', '5050n']]) {
      await t.test(name + ' compiles and runs', () => {
        const out = path.join(dir, name);
        const r = cli('build', path.join(repo, 'examples', name + '.bend'), '--bend-root', root, '--out', out);
        assert.equal(r.status, 0, r.stderr);
        const wasm = fs.readFileSync(path.join(out, 'program.wasm'));
        assert.deepEqual([...wasm.subarray(0, 4)], [0, 97, 115, 109]);
        const result = spawnSync(process.execPath, [path.join(out, 'program.cjs')], { encoding: 'utf8', timeout: 30000 });
        assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), expected);
        const again = cli('build', path.join(repo, 'examples', name + '.bend'), '--bend-root', root, '--out', out);
        assert.equal(again.status, 1); assert.match(again.stderr, /already exists/);
        const threads = spawnSync(process.execPath, [path.join(out, 'program.cjs'), '+RTS', '--threads', '2', '-RTS'], { encoding: 'utf8', timeout: 30000 });
        assert.notEqual(threads.status, 0); assert.match(threads.stderr, /one CPU thread/);
      });
    }
    for (const [name, source, error] of [
      ['io', 'import Base\ndef main() -> IO(Unit):\n  IO.print("hello")\n', /Unsupported IO main/],
      ['bang', 'import Base\ndef f(n: U32) -> U32:\n  n\ndef main() -> U32:\n  f!(42)\n', /Unsupported parallel/],
      ['invalid', 'def main() -> U32:\n  "wrong"\n', /expected/]
    ]) {
      await t.test(name + ' rejected', () => {
        const file = path.join(dir, name + '.bend'); fs.writeFileSync(file, source);
        const out = path.join(dir, name);
        const r = cli('build', file, '--bend-root', root, '--out', out);
        assert.equal(r.status, 1, r.stdout); assert.match(r.stderr, error); assert.equal(fs.existsSync(out), false);
      });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
