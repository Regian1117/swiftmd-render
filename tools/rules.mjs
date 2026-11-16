// Dev check: the regex sources parse.js rebuilds must equal the reference's (marked, vendored in the kit).
import { RULES } from '../parse.js';
const kit = process.argv[2] ?? new URL('../../kitx/markdown-render-speed-02-kit/', import.meta.url).href;
const { Lexer } = await import(new URL('baselines/vendor/marked/marked.esm.js', kit.endsWith('/') ? kit : kit + '/').href);
const { block, inline } = Lexer.rules;
const strip = (s) => s.replace(/(^|[^\[])\^/g, '$1');
const pairs = [
  ['R_HTML', block.gfm.html, true], ['R_DEF', block.gfm.def, true], ['R_TABLE', block.gfm.table, true], ['R_LHEADING', block.gfm.lheading, true],
  ['R_EM_R_AST', inline.gfm.emStrongRDelimAst, true], ['R_EM_R_UND', inline.gfm.emStrongRDelimUnd, true], ['R_DEL_R', inline.gfm.delRDelim, true],
  ['R_LINK', inline.gfm.link], ['R_REFLINK', inline.gfm.reflink], ['R_NOLINK', inline.gfm.nolink], ['R_REF_SEARCH', inline.gfm.reflinkSearch, true],
  ['R_BLOCK_SKIP', inline.gfm.blockSkip, true], ['R_PUNCT_OUTSIDE_CODE', inline.gfm.anyPunctuationOutsideCode, true], ['R_URL', inline.gfm.url],
  ['R_TAG', inline.gfm.tag], ['R_AUTOLINK', inline.gfm.autolink],
];
let bad = 0;
for (const [k, ref, exact] of pairs) {
  const mine = RULES[k].source, theirs = ref.source;
  const ok = exact ? mine === theirs : strip(mine) === strip(theirs).replace(/^\(\?:(.*)\)$/, '$1') || strip(mine) === strip(theirs);
  if (!ok) { bad++; console.log(k, '\n mine  ', mine, '\n theirs', theirs); }
}
console.log(bad ? `${bad} rule(s) differ` : 'all rules match');
