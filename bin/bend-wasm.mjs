#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWebGPU } from '../src/webgpu.mjs';
import { parseArgs } from 'node:util';
import { capabilities, emit, run } from '../src/compiler.mjs';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'bend-root': { type: 'string' }, emcc: { type: 'string', default: 'emcc' },
    entry: { type: 'string', default: 'kernel' }, out: { type: 'string' }, target: { type: 'string', default: 'wasm' }, help: { type: 'boolean' }
  }});
  if (values.help || !positionals.length) {
    console.log('bend-wasm doctor --bend-root PATH\nbend-wasm build INPUT.bend --bend-root PATH --out NEW_DIRECTORY\nWasm: pure programs with a Node launcher. WebGPU: --target webgpu --entry kernel (U32 subset).');
  } else {
    const [command, file, ...extra] = positionals;
    if (!['wasm', 'webgpu'].includes(values.target)) throw new Error('Unsupported target: use wasm or webgpu; CUDA/Metal translation is not implemented');
    if (extra.length || !['doctor', 'build'].includes(command)) throw new Error('Expected doctor or build; use --help');
    const info = capabilities(values['bend-root'], values.target === 'webgpu' ? null : values.emcc);
    Object.assign(info, values.target === 'webgpu' ? { target: 'WGSL U32 subset; browser buffer ABI v1', gpu: 'requires WebGPU adapter at execution', threads: null } : {});
    if (command === 'doctor') console.log(JSON.stringify(info, null, 2));
    else {
      if (!file || !values.out) throw new Error('build requires INPUT.bend and --out NEW_DIRECTORY');
      const out = path.resolve(values.out);
      if (fs.existsSync(out)) throw new Error('Output already exists; choose a new directory to preserve existing work');
      const gpu = values.target === 'webgpu';
      const compiled = gpu ? await compileWebGPU(info.root, file, values.entry) : await emit(info.root, file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const temp = fs.mkdtempSync(path.join(path.dirname(out), '.bend-wasm-'));
      try {
        if (gpu) {
          fs.writeFileSync(path.join(temp, 'shader.wgsl'), compiled.shader);
          fs.writeFileSync(path.join(temp, 'cpu-oracle.mjs'), compiled.oracle);
          fs.writeFileSync(path.join(temp, 'abi.json'), JSON.stringify(compiled.abi, null, 2));
          for (const name of ['index.html', 'runner.mjs']) fs.copyFileSync(fileURLToPath(new URL('../web/' + name, import.meta.url)), path.join(temp, name));
        } else {
          fs.writeFileSync(path.join(temp, 'program.c'), compiled);
          run(values.emcc, [path.join(temp, 'program.c'), '-O2', '-mtail-call', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=1073741824', '-sSTACK_SIZE=8388608', '-sENVIRONMENT=node', '-o', path.join(temp, 'program.cjs')], {
            env: { ...process.env, EM_CACHE: path.resolve(process.env.BEND_WASM_CACHE ?? path.join(path.dirname(out), '.emcache')) }
        });
        }
        fs.writeFileSync(path.join(temp, 'build.json'), JSON.stringify(info, null, 2) + '\n');
        fs.renameSync(temp, out);
      } catch (error) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw error;
      }
      if (gpu) console.log(`Generated ${out}/shader.wgsl and browser test harness`);
      else console.log(`Built ${out}/program.wasm\nRun: node ${out}/program.cjs`);
    }
  }
} catch (error) {
  console.error('bend-wasm: ' + (error?.message ?? String(error)));
  process.exitCode = 1;
}
