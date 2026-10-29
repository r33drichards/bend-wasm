# Existing CUDA-to-WebGPU tools

This is a source review, not a claim that either candidate runs current BendRT
unchanged. No candidate dependencies or toolchains were installed.

## HipScript

Inspected [lights0123/hipscript](https://github.com/lights0123/hipscript/tree/ffa631ce450a239780f20f8bec68a4d3dcc4d138)
at `ffa631ce450a239780f20f8bec68a4d3dcc4d138`.

`emcc/src/lib/compiler.worker.ts` implements HIP/Clang to LLVM bitcode, clspv to
SPIR-V, SPIRV-Tools processing, and Tint to WGSL. `emcc/src/lib/wasm/em.cpp` and
`webgpu.js` supply a HIP-style host shim for allocation, copying, and dispatch.
The browser compiler loads a Wasmer registry toolchain. Its build instructions
require additional tools.

No root license or application package license field was found at this revision.
Bundled dependency licenses do not establish licensing for the original project
code. Clarify licensing before copying or integrating it. HipScript itself was
not executed. Its pipeline does not establish compatibility with BendRT's CUDA
driver/NVRTC host path, 64-bit terms, native virtual memory, or cross-workgroup
scheduler.

## CUDA WebShader

Inspected [SamG-Coder/cuda-webshader](https://github.com/SamG-Coder/cuda-webshader/tree/d6b9de81a68c1ced62144d325fdc701dd368b6ea)
at `d6b9de81a68c1ced62144d325fdc701dd368b6ea`. Original project code is MIT; the
vendored Bend frontend is Apache-2.0. Its dependency/sample notices also apply.
Neither candidate was copied into this CLI.

The [documented Bend integration](https://github.com/SamG-Coder/cuda-webshader/blob/d6b9de81a68c1ced62144d325fdc701dd368b6ea/docs/bend.md)
is present in source. `src/bend/compiler.js` checks source and lowers annotated
terms into an opcode table. `runtime.cu` executes that table as a functional term
machine, and the CUDA subset compiler translates it into WGSL. `runtime.js`
validates inputs and manages allocation, dispatch, status, and readback. It does
not translate upstream BendRT's generated CUDA directly.

The frontend pin is `3378e6237ed431d17629efd36d24c96241815b7e` (Bend 2.0.32),
recorded with original source hashes in `src/bend/vendor/provenance.json`. Our
current compiler uses `4f99f4c19e1a91fd4c3a9377363d580171d4d40c` (2.0.39).
Those pins must remain distinct until compatibility is tested.

The checked-term lowering includes lambdas, applications, local bindings,
constructors, matches, rewrites, and direct/global references. An indexed global
table permits recursion; runtime continuations and environments support closures.
The primitive whitelist includes U32 arithmetic/comparisons/shifts and selected
F32 operations. This is substantially broader than our direct U32 emitter.

Its boundary is still explicit:

| Contract | Current candidate behavior |
| --- | --- |
| Entry ABI | Up to eight scalar U32/F32/Nat arguments and one scalar result |
| Nat | 32-bit bound; successor overflow reports failure |
| Imports | Base only; no local modules or hub loader |
| Execution | One invocation per input row; internal parallel evaluation is sequential |
| Program size | 4,096 nodes / 64 KiB table |
| Input batch | 1–1,024 rows |
| Memory | Separate monotonic arena per row; total at most 128 MiB and device limit |
| Termination | Explicit arena and step limits; per-row status codes |
| Unsupported | Foreign/unsafe definitions, TODOs, unsupported live terms and primitives, array/IO entry values |

A caller must check every status before accepting output: `runBend` returns status
arrays rather than throwing for each runtime failure. Its elapsed timer starts
after buffer allocation/upload; it measures dispatch and readback, not full
input-to-output setup. This differs from our transfer-inclusive test timing.

Before the connection interruption, all four tests in
`tests/bend-runtime.test.mjs` passed locally without installing dependencies.
They check fixture compilation through CUDA to WGSL, packing, invalid source,
and unsupported entry types. The fixture set includes nested closures, generic
lists, arithmetic boundaries, and recursive examples. This is compiler/host-test
evidence, not local GPU execution of this candidate. Its committed GPU/native
reports are upstream evidence; those suites were not independently executed here.
The recovery pass only read candidate source; no external software was newly run.

## Recommended next step

Evaluate a separate, opt-in CUDA WebShader adapter before extending our own term
runtime. Keep the existing direct WGSL path as a small tested baseline. The
adapter should identify both compiler pins and licenses in its artifact, expose
the candidate's scalar ABI and resource/status limits, and avoid silently
switching runtime semantics.

First perform a differential compatibility check on common fixtures: check and
run them with our pinned Bend JS backend, compile them through the candidate,
then run the generated WGSL on the available browser/device and compare every
result and error status. Include recursion, closures, constructors, Nat overflow,
arena exhaustion, and step-limit failures. Recheck the vendor transformation
against its recorded upstream hashes before upgrading its frontend pin.

This candidate GPU execution and any new external runner should proceed only
with the required approval. No such integration has been executed in this
recovery pass. A passing comparison would justify a reusable adapter, not a claim
of full Bend support. Array/buffer ABI work and a separate scheduling design are
still needed before the Bloom-filter validation case or BendRT-like parallelism.
