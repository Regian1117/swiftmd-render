import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from './parse.js';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const cases = JSON.parse(readFileSync(IN + '/cases.json', 'utf8'));
const html = new Array(cases.length);
for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);
writeFileSync(OUT + '/html.json', JSON.stringify(html));
