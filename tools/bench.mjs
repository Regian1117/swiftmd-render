// Wall-time benchmark: interleaves `node main.ts` (this repo), the kit baseline (marked) and `node -e 0`,
// N runs each, on the practice input; prints medians and speedup net of the null run. With
// SWIFTMD_BENCH=1 main.ts prints its own process.cpuUsage() to stderr, collected here too.
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
const env = { ...process.env, MAKEFUN_INPUT_DIR: join(kit, 'practice', 'input'), MAKEFUN_OUTPUT_DIR: out, SWIFTMD_BENCH: '1' };
const runs = { mine: [join(here, '..', 'main.ts')], marked: [join(kit, 'baselines', 'main.ts')], null: ['-e', '0'] };
const t = { mine: [], marked: [], null: [] }, cpu = [];
for (let i = 0; i < N; i++) {
  for (const k of Object.keys(runs)) {
    const s = process.hrtime.bigint();
    const r = spawnSync(process.execPath, runs[k], { env, encoding: 'utf8' });
    t[k].push(Number(process.hrtime.bigint() - s) / 1e6);
    if (r.status !== 0) throw new Error(k + ' failed: ' + r.stderr);
    if (k === 'mine') { const m = /cpu (\d+\.?\d*)ms/.exec(r.stderr); if (m) cpu.push(+m[1]); }
  }
}
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const m = med(t.mine), b = med(t.marked), z = med(t.null);
console.log(`median wall ms: mine ${m.toFixed(1)}  marked ${b.toFixed(1)}  null ${z.toFixed(1)}`);
if (cpu.length) console.log(`mine in-process cpu (user+sys) median ${med(cpu).toFixed(1)} ms`);
console.log(`net: mine ${(m - z).toFixed(1)}  marked ${(b - z).toFixed(1)}  speedup ${((b - z) / (m - z)).toFixed(2)}x`);
