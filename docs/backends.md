# Backend investigation

Inspected official Bend commit
[`4f99f4c19e1a91fd4c3a9377363d580171d4d40c`](https://github.com/bendlang/bend/tree/4f99f4c19e1a91fd4c3a9377363d580171d4d40c).
The earlier HigherOrderCO/Bend2 repository points to bendlang/bend.

## C to Wasm

[`bend2/main.ts`](https://github.com/bendlang/bend/blob/4f99f4c19e1a91fd4c3a9377363d580171d4d40c/bend2/main.ts)
selects C emission by the `.c` extension. The prototype calls the same compiler
API after loading and checking the program: `book_load`, `book_valid`, and
`compile_book`. Calling the APIs avoids the native CLI's daily update check and
its Bun-specific binary build path.

[`bend2/comp.ts`](https://github.com/bendlang/bend/blob/4f99f4c19e1a91fd4c3a9377363d580171d4d40c/bend2/comp.ts)
contains the C emitter and shared host/device runtime. Relevant paths:
`runtime_c`, `WL_JMP`, `pool_stack`, `corpus_map`, `corpus_grow`, and
`corpus_setup`. Native execution reserves an 8 GiB corpus and a 2 GiB evaluation
stack, uses high virtual addresses and signal guards, and selects CPU threads
at runtime. Direct Emscripten compilation succeeded locally, but the resulting
program trapped with an out-of-bounds access.

The adapter in `src/runtime.mjs` changes only generated C, never the upstream
checkout. It replaces the corpus mapping and growth functions, bounds the
stack, reduces reservations, fixes execution to one thread, and rejects runtime
GPU/thread overrides. Each replacement requires an exact single match.
Emscripten's `-mtail-call` supports the runtime's `musttail` transfers. These
choices preserve a narrow executable route; they do not port all native effects.

## WebGPU feasibility

The CUDA and Metal paths share `runtime_c`, with dialect macros for address
spaces, atomics, fences, and barriers. `gpu_make`, `gpu_load`, and `cube_run`
also perform native host work. Translating shader syntax alone cannot replace
those launch, allocation, synchronization, and result-transfer paths.

The inspected runtime uses 64-bit `Term` words, tagged locations, dynamic heap
banks, task queues, explicit stacks, and cross-workgroup communication. Metal
uses coherent device memory and fences; CUDA uses device fences and atomics.
A generic source translator would need to preserve those semantics.

[WGSL's specification](https://www.w3.org/TR/WGSL/) has no concrete 64-bit integer
type. Its atomic built-ins use relaxed memory semantics, while control barriers
synchronize a workgroup. Its pointer/address-space rules also differ from C.
Representing each Bend word as two `u32`s does not by itself preserve atomicity
or synchronization. These constraints require a scheduler and memory-model
redesign, not token substitution.

A possible first GPU experiment is a bounded, pure array kernel with explicit
input/output buffers and no dynamic task creation. Another is a queue-based
runtime split into dispatch phases, with host coordination between phases.
Both need resource-limit checks, overflow behavior, conformance tests, and
measurement of transfers and dispatch overhead. Emitting WGSL from Bend's
lowered representation may be cleaner than translating either native dialect;
this remains a proposal. The local subset compiler below tests a narrower approach; no general runtime port or CUDA/Metal transpiler has been implemented.

## Local evidence

Node 26.3.0 and Emscripten 5.0.7-git compiled and ran U32 arithmetic (`42`) and a
recursive Nat sum (`5050n`). Tests also reject IO entry points, reachable `!`
calls, invalid types, remote imports, unsupported GPU targets, and attempts to
reuse an output directory. These small tests establish feasibility, not broad
runtime correctness or performance. Browser execution of the Wasm target remains untested; the WebGPU evidence is recorded below.

## Implemented WebGPU foundation

`src/webgpu.mjs` loads and checks real Bend with the pinned frontend, then visits
`Def.e`, the checked, annotated first-order term tree. It strips annotations,
checks U32 signatures, resolves direct calls, and emits WGSL functions plus a
buffer-map entry point. It does not use regular expressions to translate source
syntax and does not special-case the example's formula. Upstream's private
`Seg`/`Lay` compiler representations and shared GPU runtime were inspected but
are not exposed or ported; this prototype deliberately starts earlier in the
pipeline.

The whitelist covers six U32 primitives (add, subtract, multiply, bitwise and,
or, xor), literals, local bindings, and acyclic direct calls. WGSL arithmetic
wraps at 32 bits, matching these Bend operations. Unsupported types, effects,
closures, patterns, recursion, and parallel calls produce errors. Expansion is
limited to 10,000 expression nodes. This foundation has no allocator or scheduler
and cannot yet compile the Bloom filter's byte arrays and loops.

The browser harness obtains a WebGPU device, compiles the generated WGSL, uploads
input, dispatches workgroups, copies output to a mappable buffer, and compares
every item with `Comp.js_lib` generated from the same checked Bend book. The
second input program adds a helper, a local binding, and bitwise operations.
Both passed on a non-fallback `apple / metal-3` adapter in installed Chrome
156.0.8078.73, with 69,698 comparisons per program. Adapter device/description
strings were empty; no more specific device identity is inferred from them.

Raw results are in `docs/evidence`. At 65,536 items, the recorded end-to-end times
were 1.5 ms and 1.2 ms, including 256 KiB upload and 256 KiB readback per run,
buffer creation, command submission, and copying the mapped result into JS.
Pipeline creation was measured separately at 20.5 ms and 400.8 ms. These are
single samples, not a benchmark distribution; timing resolution and warmup affect
them. No GPU timestamp queries were used, so kernel-only time is unknown.

For repeatable headless observation, launch a separate Chrome profile with a
local debugging port and run `node web/read-result.mjs PORT /kernel/` (or
`/bitmix/`). It waits for the generated page's report and exits nonzero on failure.
This is separate from the Node tests, which require no browser.
