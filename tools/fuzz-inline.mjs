// Inline-layer fuzz: random short strings over a delimiter-heavy alphabet, rendered with marked (the
// oracle, from the kit) and with ../parse.js; reports every difference. Deterministic per seed.
// Usage: node tools/fuzz-inline.mjs [count=200000] [seed=1] [kitDir]
import { parse } from '../parse.js';

const count = +(process.argv[2] ?? 200000);
let state = (+(process.argv[3] ?? 1) >>> 0) || 1;
const kit = new URL(process.argv[4] ?? '../../kitx/markdown-render-speed-02-kit/', import.meta.url);
const { marked } = await import(new URL('program/generator/vendor/marked/marked.esm.js', kit).href);

const rnd = (n) => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state % n; };
const atoms = ['*', '**', '***', '_', '__', '___', '~', '~~', 'a', 'ab', 'word', ' ', ' ', '  ', '\n', '  \n', '.', ',', '!', '?', '(', ')', '[', ']', '`', '``', '<', '>', '\\', '&', '&amp;', '#', '-', '+',
  '[x]', '[x](u)', '[x][y]', '<b>', '</b>', '<http://a.b>', 'http://a.b/c', 'www.a.b', 'a@b.cd', '😀', 'é', '한', ' ', '"', "'", '|', '1', '=', ':'];
const defs = '\n\n[y]: /url "t"\n';
let diffs = 0;
for (let i = 0; i < count; i++) {
  const n = 1 + rnd(14);
  let md = '';
  for (let j = 0; j < n; j++) md += atoms[rnd(atoms.length)];
  if (rnd(4) === 0) md += defs;
  let exp, got;
  try { exp = marked.parse(md); } catch { continue; }
  try { got = parse(md); } catch (e) { got = 'THREW ' + e.stack; }
  if (exp !== got) {
    diffs++;
    if (diffs <= 10) console.log(`DIFF ${JSON.stringify(md)}\n  got ${JSON.stringify(got)}\n  exp ${JSON.stringify(exp)}`);
  }
}
console.log(`fuzz-inline: ${count} inputs, ${diffs} differ`);
process.exitCode = diffs ? 1 : 0;
