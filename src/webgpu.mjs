import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preflight } from './compiler.mjs';
const OPS = { 'U32.add': '+', 'U32.sub': '-', 'U32.mul': '*', 'U32.and': '&', 'U32.or': '|', 'U32.xor': '^' };
const strip = t => { while (t?.$ === 'Ann' || (t?.$ === 'Var' && t.v)) t = t.$ === 'Ann' ? t.x : t.v; return t; };
const u32 = t => { t = strip(t); return t?.$ === 'Ref' && t.k === 'U32'; };
export async function compileWebGPU(root, file, entry = 'kernel') {
  preflight(file);
  const B = await import(pathToFileURL(path.join(root, 'bend2/bend.ts')));
  const C = await import(pathToFileURL(path.join(root, 'bend2/comp.ts')));
  const book = B.book_nil();
  try {
    await B.book_load(book, fs.realpathSync(file), '', new Map());
    B.book_valid(book);
    if (book.hols) throw new Error('Incomplete Bend program');
  } catch (e) { throw new Error(e?.$ === 'Err' ? B.err_show(e) : String(e)); }
  const ids = new Map(), active = new Set(), functions = [];
  let count = 0, fuel = 10000;
  function fail(message) { throw new Error('Unsupported WebGPU subset: ' + message); }
  function signature(def) {
    let t = strip(def.T), n = 0;
    while (t?.$ === 'All') {
      if (!u32(t.A)) fail('parameters must be U32');
      t = strip(t.B(B.Var(t.k, -(++n + 100))));
    }
    if (!u32(t)) fail('return type must be U32');
    if (n > 8) fail('at most eight parameters per helper');
    return n;
  }
  function func(name) {
    if (active.has(name)) fail('recursive functions: ' + name);
    if (ids.has(name)) return ids.get(name);
    const def = book.tlds[name];
    if (def?.$ !== 'Def' || def.b || def.i || !def.e) fail('function ' + name);
    const n = signature(def), id = 'f' + count++;
    ids.set(name, { id, n }); active.add(name);
    let body = strip(def.e); const env = new Map(), params = [];
    for (let i = 0; i < n; i++) {
      if (body?.$ !== 'Lam') fail('expected explicit function parameters');
      params.push('p' + i + ': u32'); env.set(body.i, 'p' + i); body = strip(body.f);
    }
    const expression = expr(body, env);
    functions.push(`fn ${id}(${params.join(', ')}) -> u32 { return ${expression}; }`);
    active.delete(name);
    return { id, n };
  }
  function expr(raw, env) {
    if (--fuel < 0) fail('expression expansion exceeds 10000 nodes');
    const t = strip(raw);
    if (t?.$ === 'Lit' && t.k === 'U32') return `${t.v >>> 0}u`;
    if (t?.$ === 'Var' && env.has(t.i)) return env.get(t.i);
    if (t?.$ === 'App' || t?.$ === 'Ref') {
      let h = t; const args = [];
      while (h.$ === 'App') { args.unshift(h.x); h = strip(h.f); }
      if (h.$ !== 'Ref') fail('indirect calls or closures');
      if (h.b) fail('parallel ! calls');
      const xs = args.map(x => expr(x, env));
      if (OPS[h.k] && book.tlds[h.k]?.b) {
        if (xs.length !== 2) fail('partially applied primitive');
        return `(${xs[0]} ${OPS[h.k]} ${xs[1]})`;
      }
      const f = func(h.k);
      if (xs.length !== f.n) fail('partial function application');
      return `${f.id}(${xs.join(', ')})`;
    }
    if (t?.$ === 'Let') {
      const next = new Map(env);
      const vals = t.v.map(v => expr(v, env));
      t.i.forEach((id, i) => next.set(id, vals[i]));
      return expr(t.f, next);
    }
    fail('term ' + (t?.$ ?? 'missing') + '; supported: U32 expressions, lets, direct acyclic calls');
  }
  const f = func(entry);
  if (f.n !== 1) fail('entry must have exactly one U32 parameter');
  const shader = `// Generated from checked Bend; subset ABI v1.\n${functions.join('\n')}\n
@group(0) @binding(0) var<storage, read> inputs: array<u32>;
@group(0) @binding(1) var<storage, read_write> outputs: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&inputs)) { outputs[id.x] = ${f.id}(inputs[id.x]); }
}\n`;
  return { shader, oracle: C.js_lib(book, true), abi: { version: 1, entry, element: 'u32', inputBinding: 0, outputBinding: 1, workgroupSize: 64 } };
}
