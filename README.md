# bend-wasm

An exploratory CLI that compiles pure Bend 2 programs to WebAssembly through
Bend's C backend and an experimental runtime adapter. Architecture remains open
for discussion. A second compiler path emits WGSL for a declared U32 subset. Neither path supports the full language.

The prototype emits a Wasm module and an Emscripten Node launcher. It is not a
standalone WASI executable, a browser bundle, or a library export generator.

## Run locally

Use an existing Emscripten installation, Node with TypeScript stripping, and a
clean checkout of [official Bend](https://github.com/bendlang/bend) at
`4f99f4c19e1a91fd4c3a9377363d580171d4d40c` (version 2.0.39 in its CLI source).
The CLI checks this revision and refuses modified compiler files. It installs
nothing and does not download Bend packages.

From this repository:

```sh
node bin/bend-wasm.mjs doctor --bend-root ../upstream-bend
node bin/bend-wasm.mjs build examples/answer.bend --bend-root ../upstream-bend --out build/answer
node build/answer/program.cjs
# 42

node bin/bend-wasm.mjs build examples/sum.bend --bend-root ../upstream-bend --out build/sum
node build/sum/program.cjs
# 5050n
```

Choose a new output directory for each build; existing directories are preserved.
Outputs include `program.c`, `program.cjs`, `program.wasm`, and a toolchain record
in `build.json`. Emscripten builds its normal system libraries into `.emcache`
beside the output directory; set `BEND_WASM_CACHE` to reuse another local cache.
Use `--emcc PATH` to select an existing compiler.

## Wasm limits

- Pure entry points only; explicit IO programs, custom FFI, hub imports, and
  reachable `!` execution are rejected.
- The Wasm target uses one CPU thread, no GPU, and no browser integration. Runtime options that enable
  more threads or a GPU are rejected.
- The adapter replaces native address reservations with a fixed 512 MiB corpus
  and a 16 MiB evaluation stack. Much of the corpus is runtime metadata. Heap
  growth is disabled; evaluation-stack pushes are checked against the fixed bound.
  Wasm linear memory has a 1 GiB maximum, including other allocations.
- Requires Wasm tail calls. Tested with Node 26.3.0 and Emscripten 5.0.7-git;
  other versions and larger programs are unverified.

This is a proof of feasibility, not a general Bend portability guarantee. See
[the backend investigation](docs/backends.md) and [existing compiler evaluation](docs/existing-tools.md) for runtime changes and GPU
constraints.

## WebGPU subset

```sh
node bin/bend-wasm.mjs build examples/kernel.bend --target webgpu --bend-root ../upstream-bend --out build/kernel
python3 -m http.server 8766 --bind 127.0.0.1 --directory build
# Open http://127.0.0.1:8766/kernel/ in a WebGPU-capable browser.
```

The compiler reads the checked Bend term tree and generates WGSL for any program
in this subset: `U32` literals and parameters, local bindings, acyclic direct
calls, and `U32.add/sub/mul/and/or/xor`. It rejects other primitives, recursion,
closures, parallel calls, and other term forms. Helpers take up to eight U32
parameters; the entry (default `kernel`, selectable with `--entry`) takes exactly
one U32 and returns U32. This supports array mapping, not general task graphs.

The host ABI uses group 0, binding 0 for a read-only U32 input storage buffer and
binding 1 for an equally sized output buffer. One invocation computes one item;
workgroups contain 64 invocations. The host must use nonempty equal-sized buffers
and dispatch enough workgroups within device limits. The generated harness does
this for four test sizes and compares every output with Bend's independent JS
backend, including U32 boundary values and deterministic pseudorandom inputs.

Outputs are `shader.wgsl`, `cpu-oracle.mjs`, `abi.json`, `build.json`, and a browser
harness. They contain compiler-generated shaders, not a handwritten demo kernel.
Emscripten is not required for this target. Browser execution requires a secure
context (localhost works) and an available WebGPU adapter.

Two different Bend programs ran on Chrome's non-fallback Apple Metal adapter:
139,396 results matched the CPU oracle, with zero mismatches. See
[raw evidence](docs/evidence/kernel.json) and [the helper/bitwise test](docs/evidence/bitmix.json).
The recorded timings are single samples with transfer and setup costs stated;
they do not establish a speedup. Bloom-filter compilation is a future validation
case and requires extending the subset.

## Test

```sh
BEND_ROOT=/absolute/path/to/upstream-bend node --test
```

Without `BEND_ROOT`, integration tests are explicitly skipped. With the pinned
checkout and Emscripten, the suite builds and runs both Wasm examples, checks Wasm
headers, and tests rejection of unsupported inputs and output overwrites. It also checks WebGPU compilation and unsupported constructs; actual GPU execution uses the separate browser harness.
