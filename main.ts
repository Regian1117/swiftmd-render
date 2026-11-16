// Driver: reads every case from /input/cases.json, renders each with parse() and writes the HTML strings
// to /output/html.json (MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR only stand in for the two directories
// when running locally).
//
// One tuning step: the run is a single short, cold pass, so the optimising compiler (TurboFan) spends more
// CPU compiling on its background threads than it saves; it is switched off before parse.js is loaded and
// V8's mid-tier compiler does the work. The call is deterministic and harmless if the flag is unknown.
import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

try { setFlagsFromString('--no-turbofan'); } catch { /* keep the defaults */ }
const { parse } = await import('./parse.js');

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases: { id: string; markdown: string }[] = JSON.parse(readFileSync(IN + '/cases.json', 'utf8'));
const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);
writeFileSync(OUT + '/html.json', JSON.stringify(html));
