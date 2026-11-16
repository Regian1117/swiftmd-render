// Rule check: the regex sources parse.js rebuilds must equal the reference's (marked, in the kit).
// Usage: node tools/rules.mjs [kitDir]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES } from '../parse.js';
const kit = new URL(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href + '/' : '../../kitx/markdown-render-speed-02-kit/', import.meta.url);
const { Lexer } = await import(new URL('baselines/vendor/marked/marked.esm.js', kit).href);
const { block, inline } = Lexer.rules;
const strip = (s) => s.replace(/(^|[^\[])\^/g, '$1');
const pairs = [
  ['R_HTML', block.gfm.html, true], ['R_DEF', block.gfm.def, true], ['R_TABLE', block.gfm.table, true], ['R_LHEADING', block.gfm.lheading, true],
  ['R_EM_R_AST', inline.gfm.emStrongRDelimAst, true], ['R_EM_R_UND', inline.gfm.emStrongRDelimUnd, true], ['R_DEL_R', inline.gfm.delRDelim, true],
  ['R_LINK', inline.gfm.link], ['R_REFLINK', inline.gfm.reflink], ['R_NOLINK', inline.gfm.nolink], ['R_REF_SEARCH', inline.gfm.reflinkSearch, true],
  ['R_BLOCK_SKIP', inline.gfm.blockSkip, true], ['R_PUNCT_OUTSIDE_CODE', inline.gfm.anyPunctuationOutsideCode, true], ['R_URL', inline.gfm.url],
  ['R_TAG', inline.gfm.tag], ['R_BACKPEDAL', inline.gfm._backpedal, true], ['R_AUTOLINK', inline.gfm.autolink],
];
let bad = 0;
for (const [k, ref, exact] of pairs) {
  const mine = RULES[k].source;
  // numbered groups here stand for marked's named ones (same matching, cheaper callbacks)
  const theirs = ref.source.replace(/\(\?<([ab])>/g, '(').replace('\\k<a>', '\\1').replace('\\k<b>', '\\3');
  const ok = exact ? mine === theirs : strip(mine) === strip(theirs).replace(/^\(\?:(.*)\)$/, '$1') || strip(mine) === strip(theirs);
  if (!ok) { bad++; console.log(k, '\n mine  ', mine, '\n theirs', theirs); }
}
console.log(bad ? `${bad} rule(s) differ` : 'all rules match');
