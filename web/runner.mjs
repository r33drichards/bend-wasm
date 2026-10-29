import oracle from './cpu-oracle.mjs';
const result = document.querySelector('#result');
async function main() {
  if (!navigator.gpu) throw new Error('WebGPU unavailable in this browser');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter available');
  const device = await adapter.requestDevice();
  const info = adapter.info ?? {};
  const abi = await (await fetch('./abi.json')).json();
  const code = await (await fetch('./shader.wgsl')).text();
  const setupStart = performance.now();
  const shader = device.createShaderModule({ code });
  const diagnostics = await shader.getCompilationInfo();
  const errors = diagnostics.messages.filter(m => m.type === 'error');
  if (errors.length) throw new Error(errors.map(m => m.message).join('\n'));
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
  const pipelineMs = performance.now() - setupStart;
  const samples = [];
  for (const n of [1, 65, 4096, 65536]) {
    const input = new Uint32Array(n);
    const edge = [0, 1, 2, 255, 256, 65535, 65536, 0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff];
    let seed = 123456789;
    for (let i = 0; i < n; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; input[i] = i < edge.length ? edge[i] : seed; }
    const cpuStart = performance.now();
    const expected = input.map(x => oracle[abi.entry](x));
    const cpuMs = performance.now() - cpuStart;
    device.pushErrorScope('validation');
    const start = performance.now();
    const source = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const output = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: input.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(source, 0, input);
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: source } }, { binding: 1, resource: { buffer: output } }] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(n / 64)); pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, input.byteLength);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const actual = new Uint32Array(readback.getMappedRange()).slice();
    const endToEndMs = performance.now() - start;
    let mismatches = 0;
    for (let i = 0; i < n; i++) if (actual[i] !== expected[i]) mismatches++;
    readback.unmap(); source.destroy(); output.destroy(); readback.destroy();
    const error = await device.popErrorScope(); if (error) throw new Error(error.message);
    if (mismatches) throw new Error(`${mismatches}/${n} results differ from Bend JS oracle`);
    samples.push({ n, mismatches, cpuMs, endToEndMs, uploadedBytes: input.byteLength, downloadedBytes: input.byteLength });
  }
  return { status: 'passed', adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter }, userAgent: navigator.userAgent, pipelineMs, samples, timing: 'One cold sample per size. End-to-end includes buffer creation, upload, dispatch, readback and JS copy; excludes pipeline compilation and CPU oracle. Kernel-only time not measured.' };
}
try { result.textContent = JSON.stringify(await main(), null, 2); document.title = 'PASS'; }
catch (e) { result.textContent = JSON.stringify({ status: 'failed', error: String(e) }, null, 2); document.title = 'FAIL'; }
