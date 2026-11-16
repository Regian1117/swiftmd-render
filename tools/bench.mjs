// Benchmark: interleaves `node main.ts` (this repo), the kit baseline (marked) and `node -e 0`,
// N runs each, on the practice input; prints medians and speedup net of the null run. With
// tools/cpu-hook.mjs preloaded, every run reports its process CPU time (all threads), which is what the
// grader ranks on; speedups are printed for both.
// Usage: node tools/bench.mjs [N=15] [kitDir]
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const N = +(process.argv[2] ?? 15);
const kit = process.argv[3] ?? join(here, '..', '..', 'kitx', 'markdown-render-speed-02-kit');
const out = join(here, '..', '..', 'scratch', 'bench-out');
mkdirSync(out, { recursive: true });
const env = { ...process.env, MAKEFUN_INPUT_DIR: join(kit, 'practice', 'input'), MAKEFUN_OUTPUT_DIR: out };
const hook = ['--import', new URL('./cpu-hook.mjs', import.meta.url).href];
const runs = { mine: [...hook, join(here, '..', 'main.ts')], marked: [...hook, join(kit, 'baselines', 'main.ts')], null: [...hook, '-e', '0'] };
const t = { mine: [], marked: [], null: [] }, cpu = { mine: [], marked: [], null: [] };
for (let i = 0; i < N; i++) {
  for (const k of Object.keys(runs)) {
    const s = process.hrtime.bigint();
    const r = spawnSync(process.execPath, runs[k], { env, encoding: 'utf8' });
    t[k].push(Number(process.hrtime.bigint() - s) / 1e6);
    if (r.status !== 0) throw new Error(k + ' failed: ' + r.stderr);
    const m = /cpu (\d+\.?\d*)ms/.exec(r.stderr);
    if (m) cpu[k].push(+m[1]);
  }
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const m = med(t.mine), b = med(t.marked), z = med(t.null);
console.log(`median wall ms: mine ${m.toFixed(1)}  marked ${b.toFixed(1)}  null ${z.toFixed(1)}`);
const cm = med(cpu.mine), cb = med(cpu.marked), cz = med(cpu.null);
console.log(`median process cpu ms: mine ${cm.toFixed(1)}  marked ${cb.toFixed(1)}  null ${cz.toFixed(1)}`);
console.log(`net cpu: mine ${(cm - cz).toFixed(1)}  marked ${(cb - cz).toFixed(1)}  speedup ${((cb - cz) / (cm - cz)).toFixed(2)}x`);
console.log(`net wall: mine ${(m - z).toFixed(1)}  marked ${(b - z).toFixed(1)}  speedup ${((b - z) / (m - z)).toFixed(2)}x`);
