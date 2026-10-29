import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { adaptRuntime } from './runtime.mjs';
export const PIN = '4f99f4c19e1a91fd4c3a9377363d580171d4d40c';
export function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${command} failed: ${r.error?.message ?? r.stderr ?? r.signal}`);
  return r.stdout;
}
export function preflight(file, seen = new Set()) {
  file = fs.realpathSync(file);
  if (seen.has(file)) return;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const m = /^\s*import\s+(\S+)/.exec(line);
    if (!m || m[1] === 'Base') continue;
    if (!m[1].startsWith('./') && !m[1].startsWith('../')) {
      throw new Error('Unsupported import: only Base and relative local imports are allowed (no hub downloads)');
    }
    preflight(path.resolve(path.dirname(file), m[1]), seen);
  }
}
export function capabilities(root, emcc = 'emcc') {
  if (!root) throw new Error('Set --bend-root to the official Bend checkout at ' + PIN);
  root = fs.realpathSync(root);
  const actual = run('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  if (actual !== PIN) throw new Error(`Unsupported Bend revision ${actual}; expected ${PIN}`);
  run('git', ['-C', root, 'diff', '--exit-code', 'HEAD', '--', 'bend2']);
  if (run('git', ['-C', root, 'ls-files', '--others', '--exclude-standard', 'bend2']).trim()) {
    throw new Error('Unsupported untracked files in Bend compiler directory');
  }
  const version = emcc === null ? null : run(emcc, ['--version']).split('\n')[0];
  if (version !== null && !version.includes('Emscripten')) throw new Error('Expected an Emscripten emcc compiler');
  return { root, bend: PIN, emcc: version, node: process.version, target: 'wasm32 + Emscripten Node launcher', threads: 1, gpu: false };
}
export async function emit(root, file) {
  preflight(file);
  const Bend = await import(pathToFileURL(path.join(root, 'bend2/bend.ts')));
  const Comp = await import(pathToFileURL(path.join(root, 'bend2/comp.ts')));
  try {
    const book = Bend.book_nil();
    await Bend.book_load(book, fs.realpathSync(file), '', new Map());
    Bend.book_valid(book);
    if (book.hols) throw new Error('Incomplete program: TODO holes are unsupported');
    if (Comp.io_type(book) !== null) throw new Error('Unsupported IO main: this prototype accepts pure programs only');
    for (const def of Object.values(book.tlds)) {
      if (!def.b && def.i?.length) throw new Error('Unsupported foreign implementation: C/JS FFI is not portable');
    }
    const c = Comp.compile_book(book);
    if (!/^#define BANGS 0$/m.test(c)) throw new Error('Unsupported parallel ! execution: no Wasm threads or GPU backend yet');
    return adaptRuntime(c);
  } catch (error) {
    if (error?.$ === 'Err') throw new Error(Bend.err_show(error));
    throw error;
  }
}
