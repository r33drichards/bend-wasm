// Adapter for one pinned runtime; fail closed if upstream text changes.
export function adaptRuntime(input) {
  let c = input;
  function replace(before, after) {
    if (c.split(before).length !== 2) throw new Error('Pinned runtime adapter mismatch');
    c = c.replace(before, after);
  }
  function fn(name, body) {
    const re = new RegExp('^static [^\\n]+ ' + name + '\\([^\\n]*\\) \\{\\n[\\s\\S]*?^\\}', 'gm');
    const hits = [...c.matchAll(re)];
    if (hits.length !== 1) throw new Error('Pinned runtime function mismatch: ' + name);
    replace(hits[0][0], hits[0][0].split('\n')[0] + '\n' + body + '\n}');
  }
  // Fixed corpus: no native address reservations or in-place doubling.
  fn('corpus_map', '  void* p = calloc(1, size);\n  if (!p) err_fail("Wasm corpus allocation failed");\n  return p;');
  fn('corpus_grow', '  return false; // Fixed 512 MiB corpus: report upstream heap exhaustion.');
  fn('pool_stack', '  Term* p = calloc(1, 16ull << 20);\n  if (!p) err_fail("Wasm stack allocation failed");\n  return p;');
  replace('!gpu ? 1ull << 33', '!gpu ? 1ull << 29');
  replace('long   thr = cpu_count();', 'long   thr = 1;');
  // Prevent runtime arguments from enabling unsupported execution paths.
  replace('const char* why = gpu != 0 && BANGS != 0 ? gpu_probe() : "";',
    'if (thr != 1 || gpu == 1) err_fail("Wasm supports only one CPU thread and GPU off");\n  const char* why = "";');
  replace('#define WL_PUSHN(N) sp += (N) * LANE_STEP',
    '#define WL_PUSHN(N) do { if (sp + (N) >= io_stk + ((16ull << 20) / sizeof(Term))) err_fail("Wasm evaluation stack exhausted"); sp += (N); } while (0)');
  return c;
}
