// Practice-set check: renders every case with ../parse.js and compares with the reference HTML
// code unit for code unit. Usage: node tools/test.mjs [kitDir]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const kit = process.argv[2] ?? join(here, '..', '..', 'kitx', 'markdown-render-speed-02-kit');
const cases = JSON.parse(readFileSync(join(kit, 'practice', 'input', 'cases.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(kit, 'practice', 'reference', 'expected.json'), 'utf8')).cases;
let pass = 0;
const fails = [];
for (let i = 0; i < cases.length; i++) {
  let got;
  try { got = parse(cases[i].markdown); } catch (e) { got = 'THREW ' + e.stack; }
  const exp = expected[i].html;
  if (got === exp) { pass++; continue; }
  let d = 0;
  while (d < got.length && d < exp.length && got[d] === exp[d]) d++;
  fails.push({ id: cases[i].id, d, got: JSON.stringify(got.slice(Math.max(0, d - 40), d + 60)), exp: JSON.stringify(exp.slice(Math.max(0, d - 40), d + 60)) });
}
const verbose = process.argv.includes('-v');
for (const f of fails.slice(0, verbose ? 1000 : 25)) console.log(`${f.id} @${f.d}\n  got ${f.got}\n  exp ${f.exp}`);
console.log(`practice: ${pass}/${cases.length} pass`);
process.exitCode = pass === cases.length ? 0 : 1;
