// Driver: reads /input/cases.json, renders each case with parse(), writes /output/html.json.
// The run is short and cold, so optimising-compiler work (done on background threads, but billed as CPU)
// costs more than it saves; it is switched off before parse.js is loaded.
import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-turbofan');
const { parse } = await import('./parse.js');

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(IN + '/cases.json', 'utf8'));
const html = new Array(cases.length);
for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);
writeFileSync(OUT + '/html.json', JSON.stringify(html));
