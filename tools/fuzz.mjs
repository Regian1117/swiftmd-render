// Generalisation check against the reference. Draws README documents from fresh random seeds with the
// kit's generator, plus mutated/concatenated spec examples, renders each with marked (the oracle, from
// the kit) and with ../parse.js, and reports every difference. Nothing is written inside the repo.
// Usage: node tools/fuzz.mjs [docs=200] [mutations=3000] [kitDir]
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from '../parse.js';

const docs = +(process.argv[2] ?? 200), muts = +(process.argv[3] ?? 3000);
const kit = new URL(process.argv[4] ?? '../../kitx/markdown-render-speed-02-kit/', import.meta.url);
const gen = new URL('program/generator/', kit);
const { marked } = await import(new URL('vendor/marked/marked.esm.js', gen).href);
const { readme } = await import(new URL('readme.ts', gen).href);
const { streamFor, Rng } = await import(new URL('rng.ts', gen).href);
const examples = JSON.parse(readFileSync(new URL('spec/examples.json', gen), 'utf8'));
const S = 'zq sentinel paragraph';
const insertable = examples.filter((e) => {
  const body = e.markdown.replace(/\n+$/, '');
  if (body.trim() === '') return false;
  return marked.parse(`${body}\n\n${S}\n`).endsWith(`<p>${S}</p>\n`) && marked.parse(`${S}\n\n${body}\n`).startsWith(`<p>${S}</p>\n`);
}).map((e) => e.markdown);

const failDir = new URL('../../scratch/fails/', import.meta.url);
mkdirSync(failDir, { recursive: true });
let tested = 0, diffs = 0;
function check(label, md) {
  tested++;
  let exp, got;
  try { exp = marked.parse(md); } catch { return; }
  try { got = parse(md); } catch (e) { got = 'THREW ' + e.stack; }
  if (exp === got) return;
  diffs++;
  let d = 0;
  while (d < got.length && d < exp.length && got[d] === exp[d]) d++;
  if (diffs <= 12) {
    console.log(`DIFF ${label} @${d}\n  got ${JSON.stringify(got.slice(Math.max(0, d - 60), d + 60))}\n  exp ${JSON.stringify(exp.slice(Math.max(0, d - 60), d + 60))}`);
    writeFileSync(new URL(`fail-${diffs}.md`, failDir), md);
  }
}

for (let i = 0; i < docs; i++) {
  const seed = randomBytes(32).toString('hex');
  const rng = streamFor(seed, 'doc', i % 40);
  const target = rng.between(20000, 100000);
  check(`doc seed=${seed}`, readme(rng, target, insertable));
}
const rng = new Rng(randomBytes(16));
const pick = (a) => a[rng.below(a.length)];
const wrappers = [
  (s) => s, (s) => s.replace(/\n/g, '\r\n'), (s) => s.replace(/\n+$/, ''), (s) => s.replace(/^ {4}/gm, '\t'),
  (s) => s.replace(/^/gm, '> '), (s) => '- ' + s.replace(/\n(?=.)/g, '\n  '), (s) => '1. ' + s.replace(/\n(?=.)/g, '\n   '),
  (s) => '* [ ] ' + s.replace(/\n(?=.)/g, '\n  '), (s) => s.replace(/^/gm, '>'), (s) => '  ' + s,
];
for (let i = 0; i < muts; i++) {
  const k = 1 + rng.below(4);
  const parts = [];
  for (let j = 0; j < k; j++) parts.push(pick(wrappers)(pick(examples).markdown));
  const sep = pick(['\n', '\n\n', '', '\n\n\n', '\n  \n']);
  check(`mut#${i}`, pick(wrappers)(parts.join(sep)));
}
console.log(`fuzz: ${tested} inputs (${docs} generated documents), ${diffs} differ`);
process.exitCode = diffs ? 1 : 0;
