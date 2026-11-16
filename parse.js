// swiftmd-render: a Markdown renderer whose output matches marked 18.1.3 (MIT, github.com/markedjs/marked)
// with its default options (gfm on, breaks off, pedantic off). Written from scratch: a position-based
// block scanner that builds a flat list of light block records, and an inline scanner that writes HTML
// directly. Regular expressions are used only for the rare, intricate constructs (raw HTML, link
// destinations, emphasis closers); the hot paths (paragraph lines, plain text runs, escaping) are
// hand-written char-code loops.

// ---------------------------------------------------------------------------------------------------
// Character classes

const C_SP = 32, C_TAB = 9, C_NL = 10;

// bounds-checked char code: an out-of-range charCodeAt would deoptimize the hot loops. Past either end
// it gives 0x10000, which matches no class and compares unequal to every character.
function at(s, i) { return s.charCodeAt(i); }

// Bit flags for ASCII characters.
const F_ALNUM = 1, F_EMAIL = 2, F_STOP = 4, F_PUNCT = 8, F_URL1 = 16;
const CT = new Uint8Array(128);
(function () {
  for (let c = 48; c < 58; c++) CT[c] |= F_ALNUM | F_EMAIL | F_URL1;
  for (let c = 65; c < 91; c++) CT[c] |= F_ALNUM | F_EMAIL | F_URL1;
  for (let c = 97; c < 123; c++) CT[c] |= F_ALNUM | F_EMAIL | F_URL1;
  const email = ".!#$%&'*+/=?_`{|}~-";
  for (let i = 0; i < email.length; i++) CT[email.charCodeAt(i)] |= F_EMAIL;
  const stop = '\\<![`*~_';
  for (let i = 0; i < stop.length; i++) CT[stop.charCodeAt(i)] |= F_STOP;
  const punct = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
  for (let i = 0; i < punct.length; i++) CT[punct.charCodeAt(i)] |= F_PUNCT;
  const u1 = '._+-';
  for (let i = 0; i < u1.length; i++) CT[u1.charCodeAt(i)] |= F_URL1;
})();

// JavaScript's \s
function isWS(c) {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
}

// ---------------------------------------------------------------------------------------------------
// Regular expressions for the intricate constructs (marked's grammar, rebuilt here; tools/rules.mjs
// checks each source against the reference's).

function build(src, flags, pairs) {
  for (let i = 0; i < pairs.length; i += 2) {
    let v = pairs[i + 1];
    if (typeof v !== 'string') v = v.source;
    v = v.replace(/(^|[^\[])\^/g, '$1');
    const k = pairs[i];
    src = typeof k === 'string' ? src.replace(k, () => v) : src.replace(k, () => v);
  }
  return new RegExp(src, flags);
}

const TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const TAGSET = new Set('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul'.split(' '));

const R_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const R_BULL = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const R_LABEL_DEF = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const R_COMMENT = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const HTML_BEGIN_P = ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)';
const FENCES_P = ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)';

const R_HTML = build('^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))', 'i', [
  'comment', R_COMMENT, 'tag', TAGS, 'attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/,
]);
const R_DEF = build('^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)', '', [
  'label', R_LABEL_DEF, 'title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/,
]);
const R_TABLE = build('^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)', '', [
  'hr', R_HR, 'heading', ' {0,3}#{1,6}(?:\\s|$)', 'blockquote', ' {0,3}>', 'code', '(?: {4}| {0,3}\t)[^\\n]', 'fences', FENCES_P, 'list', ' {0,3}(?:[*+-]|1[.)])[ \\t]', 'html', HTML_BEGIN_P, 'tag', TAGS,
]);
const R_LHEADING = build('^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |fences|blockquote|heading|hr|html|table))+?)\\n {0,3}(=+|-+)[ \\t]*(?:\\n+|$)', '', [
  /bull/g, R_BULL, /blockCode/g, /(?: {4}| {0,3}\t)/, /fences/g, / {0,3}(?:`{3,}|~{3,})/, /blockquote/g, / {0,3}>/, /heading/g, / {0,3}#{1,6}(?:\s|$)/,
  /hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/, /html/g, / {0,3}<[^\n>]+>\n/, /table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/,
]);

// inline
const R_PUNCT_CLASS = /[\p{P}\p{S}]/u;
const R_ANY_PUNCT = /\\([\p{P}\p{S}])/gu;
const R_PUNCTUATION = /^((?![*_])[\s\p{P}\p{S}])/u;
const R_ALNUM_U = /[\p{L}\p{N}]/u;
const R_EM_L = /(?:\*+(?:((?!\*)(?!~)[\p{P}\p{S}])|([^\s*]))?)|_+(?:((?!_)(?!~)[\p{P}\p{S}])|([^\s_]))?/uy;
const R_EM_R_AST = build('^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)', 'gu', [
  /notPunctSpace/g, /(?:[^\s\p{P}\p{S}]|~)/, /punctSpace/g, /(?!~)[\s\p{P}\p{S}]/, /punct/g, /(?!~)[\p{P}\p{S}]/,
]);
const R_EM_R_UND = build('^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)', 'gu', [
  /notPunctSpace/g, /[^\s\p{P}\p{S}]/, /punctSpace/g, /[\s\p{P}\p{S}]/, /punct/g, /[\p{P}\p{S}]/,
]);
const R_DEL_L = /~~?(?:((?!~)[\p{P}\p{S}])|[^\s~])/uy;
const R_DEL_R = build('^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)', 'gu', [
  /notPunctSpace/g, /[^\s\p{P}\p{S}]/, /punctSpace/g, /[\s\p{P}\p{S}]/, /punct/g, /[\p{P}\p{S}]/,
]);
const R_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/y;
const R_CODE_A = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const R_AUTOLINK = /<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>/y;
const R_AUTOLINK_A = new RegExp('^' + R_AUTOLINK.source);
const TAG_SRC = '<!--(?:-?>|[\\s\\S]*?-->)|</[a-zA-Z][a-zA-Z0-9-]*\\s*>|<[a-zA-Z][a-zA-Z0-9-]*(?:\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*\'[^\']*\'|\\s*=\\s*[^\\s"\'=<>`]+)?)*?\\s*/?>|<\\?[\\s\\S]*?\\?>|<![a-zA-Z]+\\s[\\s\\S]*?>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>';
const R_TAG = new RegExp(TAG_SRC, 'y');
const R_TAG_A = new RegExp('^(?:' + TAG_SRC + ')');
const LINK_LABEL = /(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
const R_LINK = build('!?\\[(label)\\]\\([ \\t\\n]*(href)(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(title))?[ \\t\\n]*\\)', 'y', [
  'label', LINK_LABEL, 'href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/, 'title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/,
]);
const R_LINK_A = new RegExp('^' + R_LINK.source);
const R_REFLINK = build('!?\\[(label)\\]\\[(ref)\\]', 'y', ['label', LINK_LABEL, 'ref', R_LABEL_DEF]);
const R_NOLINK = build('!?\\[(ref)\\](?:\\[\\])?', 'y', ['ref', R_LABEL_DEF]);
const R_REF_SEARCH = build('reflink|nolink(?!\\()', 'g', [
  'reflink', build('^!?\\[(label)\\]\\[(ref)\\]', '', ['label', /(?:[^\[\]\\`]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/, 'ref', /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/]),
  'nolink', build('^!?\\[(ref)\\](?:\\[\\])?', '', ['ref', /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/]),
]);
const R_BLOCK_SKIP = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
const R_PUNCT_OUTSIDE_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const R_URL = /(?:mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])|xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?)|((?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/y;
const R_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const R_NUMREF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const R_NUMREF_OR_AMP = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

export const RULES = { R_HTML, R_DEF, R_TABLE, R_LHEADING, R_EM_R_AST, R_EM_R_UND, R_DEL_R, R_LINK, R_REFLINK, R_NOLINK, R_REF_SEARCH, R_BLOCK_SKIP, R_PUNCT_OUTSIDE_CODE, R_URL, R_TAG, R_AUTOLINK };

// ---------------------------------------------------------------------------------------------------
// Escaping

const R_ESC_ALL = /[&<>"']/g;
const R_ESC_NE = /[<>"']|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
function escRepl(c) {
  return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
}
function escAll(s) { return s.replace(R_ESC_ALL, escRepl); }

// text escape: an ampersand that already starts an entity-like reference is left alone
function esc(s) { return s.replace(R_ESC_NE, escRepl); }

function decodeNumRefs(s) {
  if (s.indexOf('&#') < 0 || !R_NUMREF.test(s)) return s;
  return s.replace(R_NUMREF_OR_AMP, numRefRepl);
}
function numRefRepl(m, d, h) {
  if (d === undefined && h === undefined) return '&amp;';
  const v = d === undefined ? Number.parseInt(h, 16) : Number.parseInt(d, 10);
  return v === 0 || v > 1114111 || (v >= 55296 && v <= 57343) ? '\uFFFD' : v === 38 ? '&amp;' : String.fromCodePoint(v);
}

const URI_SAFE = new Uint8Array(128);
(function () {
  const ok = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789;,/?:@&=+$-_.!~*'()#%";
  for (let i = 0; i < ok.length; i++) URI_SAFE[ok.charCodeAt(i)] = 1;
})();
function cleanUrl(href) {
  let i = 0;
  const n = href.length;
  while (i < n) { const c = href.charCodeAt(i); if (c < 128 && URI_SAFE[c] === 1) i++; else break; }
  if (i === n) return href;
  try { return encodeURI(href).replace(/%25/g, '%'); } catch { return null; }
}

function unescapePunct(s) {
  return s.indexOf('\\') < 0 ? s : s.replace(R_ANY_PUNCT, '$1');
}

function normLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// strip trailing characters equal to ch
function rtrimChar(s, ch) {
  let n = s.length;
  while (n > 0 && s[n - 1] === ch) n--;
  return n === s.length ? s : s.slice(0, n);
}

// drop trailing blank lines when there is more than one trailing line break
function trimBlankTail(a) {
  const e = a.split('\n');
  let t = e.length - 1;
  while (t >= 0 && /^[ \t]*$/.test(e[t])) t--;
  return e.length - t <= 2 ? a : e.slice(0, t + 1).join('\n');
}

function expandTabs(s, col) {
  let out = '', c = col;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\t') { const r = 4 - (c % 4); out += ' '.repeat(r); c += r; }
    else { out += ch; c++; }
  }
  return out;
}
function expandLeading(s, col) {
  let i = 0;
  while (i < s.length) { const c = s.charCodeAt(i); if (c === 32 || c === 9) i++; else break; }
  if (i === 0) return s;
  return expandTabs(s.slice(0, i), col) + s.slice(i);
}
function firstNonSpace(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) !== 32) return i;
  return -1;
}

// ---------------------------------------------------------------------------------------------------
// Line predicates (positions within a source string)

function eol(s, i) {
  const j = s.indexOf('\n', i);
  return j < 0 ? s.length : j;
}

// hr line at i, up to `max` leading spaces; whole line must be the rule
function isHrAt(s, i, max) {
  const n = s.length;
  let sp = 0;
  while (s.charCodeAt(i) === C_SP) { i++; sp++; }
  if (sp > max) return false;
  const ch = s.charCodeAt(i);
  if (ch !== 45 && ch !== 95 && ch !== 42) return false;
  let cnt = 0;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === ch) cnt++;
    else if (c === C_SP || c === C_TAB) continue;
    else if (c === C_NL) break;
    else return false;
  }
  return cnt >= 3;
}

// html block start (paragraph-interrupt flavour: case-sensitive, `$` = end of s)
function htmlBeginAt(s, i) {
  if (s.charCodeAt(i) !== 60) return false;
  const n = s.length;
  let j = i + 1;
  let c = s.charCodeAt(j);
  if (c === 63) return true; // <?
  if (c === 33) { // <!
    const d = s.charCodeAt(j + 1);
    if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122)) return true;
    if (s.startsWith('--', j + 1)) return true;
    if (s.startsWith('[CDATA[', j + 1)) return true;
    return false;
  }
  if (c !== 47) {
    for (const t of ['script', 'pre', 'style', 'textarea']) {
      if (s.startsWith(t, j)) {
        const k = j + t.length;
        if (k >= n) return true;
        const e = s.charCodeAt(k);
        if (e === 62 || isWS(e)) return true;
      }
    }
  } else j++;
  const st = j;
  while (j < n) { c = s.charCodeAt(j); if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) j++; else break; }
  if (j === st || !TAGSET.has(s.slice(st, j))) return false;
  c = s.charCodeAt(j);
  return c === C_SP || c === C_NL || c === 62 || (c === 47 && s.charCodeAt(j + 1) === 62);
}

// Delimiter row of a table (lookahead flavour, no [:|] requirement): whole line
const R_DELIM_ROW = / {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?(?:\n|$)/y;
function isDelimRow(s, i) {
  R_DELIM_ROW.lastIndex = i;
  return R_DELIM_ROW.test(s);
}

// does line at i (non-empty) interrupt a gfm paragraph?
function paraInterrupt(s, i) {
  const n = s.length;
  let j = i;
  while (s.charCodeAt(j) === C_SP) j++;
  const sp = j - i;
  const c = s.charCodeAt(j);
  if (sp <= 3) {
    switch (c) {
      case 45: case 42: case 95: // - * _
        if (isHrAt(s, j, 0)) return true;
        if (c !== 95 && listInterrupt(s, j + 1)) return true;
        break;
      case 43:
        if (listInterrupt(s, j + 1)) return true;
        break;
      case 49: {
        const d = s.charCodeAt(j + 1);
        if ((d === 46 || d === 41) && listInterrupt(s, j + 2)) return true;
        break;
      }
      case 35: { // #
        let k = j;
        while (s.charCodeAt(k) === 35) k++;
        if (k - j <= 6 && (k >= n || isWS(s.charCodeAt(k)))) return true;
        // more than 6 hashes: #{1,6} then \s fails
        break;
      }
      case 62: return true;
      case 96: {
        let k = j;
        while (s.charCodeAt(k) === 96) k++;
        if (k - j >= 3) {
          const e = eol(s, k);
          if (s.indexOf('`', k) < 0 || s.indexOf('`', k) >= e) return true;
        }
        break;
      }
      case 126:
        if (s.charCodeAt(j + 1) === 126 && s.charCodeAt(j + 2) === 126) return true;
        break;
      case 60:
        if (htmlBeginAt(s, j)) return true;
        break;
    }
  }
  // [ \t]+\n
  {
    let k = i;
    while (k < n) { const d = s.charCodeAt(k); if (d === C_SP || d === C_TAB) k++; else break; }
    if (k > i && s.charCodeAt(k) === C_NL) return true;
  }
  // table: ` *([^\n ].*)\n` + delimiter row
  if (c !== C_NL && j < n) {
    const e = eol(s, j);
    if (e < n && lineDots(s, j, e) && isDelimRowQuick(s, e + 1)) return true;
  }
  return false;
}
function isDelimRowQuick(s, i) {
  // cheap reject: first non-space char must be | : or -
  let j = i, k = 0;
  while (s.charCodeAt(j) === C_SP && k < 3) { j++; k++; }
  const c = s.charCodeAt(j);
  if (c !== 124 && c !== 58 && c !== 45) return false;
  return isDelimRow(s, i);
}
// all chars in [a,b) are matched by `.` (no line terminators)
function lineDots(s, a, b) {
  for (let i = a; i < b; i++) { const c = s.charCodeAt(i); if (c === 0x2028 || c === 0x2029 || c === 13) return false; }
  return true;
}
// after a list bullet at i: [ \t]+[^ \t\n]
function listInterrupt(s, i) {
  let c = s.charCodeAt(i);
  if (c !== C_SP && c !== C_TAB) return false;
  i++;
  while ((c = s.charCodeAt(i)) === C_SP || c === C_TAB) i++;
  return i < s.length && c !== C_NL;
}

// blockquote-paragraph continuation interrupt (no table, any ordered number)
function bqInterrupt(s, i) {
  const n = s.length;
  let j = i;
  while (s.charCodeAt(j) === C_SP) j++;
  const sp = j - i;
  const c = s.charCodeAt(j);
  if (sp <= 3) {
    switch (c) {
      case 45: case 42: case 95:
        if (isHrAt(s, j, 0)) return true;
        if (c !== 95 && bulletEnd(s, j + 1)) return true;
        break;
      case 43:
        if (bulletEnd(s, j + 1)) return true;
        break;
      case 35: {
        let k = j;
        while (s.charCodeAt(k) === 35) k++;
        if (k - j <= 6 && (k >= n || isWS(s.charCodeAt(k)))) return true;
        break;
      }
      case 62: return true;
      case 96: {
        let k = j;
        while (s.charCodeAt(k) === 96) k++;
        if (k - j >= 3) {
          const e = eol(s, k);
          const b = s.indexOf('`', k);
          if (b < 0 || b >= e) return true;
        }
        break;
      }
      case 126:
        if (s.charCodeAt(j + 1) === 126 && s.charCodeAt(j + 2) === 126) return true;
        break;
      case 60:
        if (htmlBeginAt(s, j)) return true;
        break;
      default:
        if (c >= 48 && c <= 57) {
          let k = j;
          while (k < n && k - j < 10) { const d = s.charCodeAt(k); if (d >= 48 && d <= 57) k++; else break; }
          if (k - j <= 9) {
            const d = s.charCodeAt(k);
            if ((d === 46 || d === 41) && bulletEnd(s, k + 1)) return true;
          }
        }
    }
  }
  let k = i;
  while (k < n) { const d = s.charCodeAt(k); if (d === C_SP || d === C_TAB) k++; else break; }
  if (k > i && s.charCodeAt(k) === C_NL) return true;
  return false;
}
// (?:[ \t]|\n|$)
function bulletEnd(s, i) {
  if (i >= s.length) return true;
  const c = s.charCodeAt(i);
  return c === C_SP || c === C_TAB || c === C_NL;
}

// ---------------------------------------------------------------------------------------------------
// Block lexer

const T_SPACE = 0, T_CODE = 1, T_HEADING = 2, T_HR = 3, T_BQ = 4, T_LIST = 5, T_HTML = 6, T_DEF = 7, T_TABLE = 8, T_PARA = 9, T_TEXT = 10, T_CHECK = 11;

let links = null; // label -> {href, title}
let nLinks = 0;
let top = true;
let inLink = false, inRaw = false, linkEmitted = false, parenOk = true, textMode = false;

function Tok(type, raw, text) {
  this.type = type;
  this.raw = raw;
  this.text = text;
  this.a = null; // depth / lang / items / tokens / rows
  this.b = null; // ordered / header / checkbox
  this.c = null; // start / align
  this.q = null; // inline queue entry
}

// marked lexes inline content after the block pass, in the order the block pass queued it
let queue = [];
function QEntry(src) { this.src = src; this.html = ''; }
function enq(src) { const e = new QEntry(src); queue.push(e); return e; }

function blockTokens(src, toks, clipped) {
  const n = src.length;
  let pos = 0;
  while (pos < n) {
    const c0 = src.charCodeAt(pos);
    // space
    if (c0 === C_NL || c0 === C_SP || c0 === C_TAB) {
      let q = pos;
      for (;;) {
        let r = q;
        while (r < n) { const d = src.charCodeAt(r); if (d === C_SP || d === C_TAB) r++; else break; }
        if (r >= n) { q = r; break; }
        if (src.charCodeAt(r) === C_NL) { q = r + 1; continue; }
        break;
      }
      if (q > pos) {
        const last = toks.length ? toks[toks.length - 1] : null;
        if (q - pos === 1 && last !== null) last.raw += '\n';
        else toks.push(new Tok(T_SPACE, src.slice(pos, q), ''));
        pos = q;
        continue;
      }
    }
    let i = pos;
    while (src.charCodeAt(i) === C_SP) i++;
    const sp = i - pos;
    const c = src.charCodeAt(i);
    // indented code
    if (sp >= 4 || c === C_TAB) {
      const t = codeBlock(src, pos);
      const last = toks.length ? toks[toks.length - 1] : null;
      if (last !== null && (last.type === T_PARA || last.type === T_TEXT)) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + t.raw;
        last.text += '\n' + t.text;
        queue[queue.length - 1].src = last.text;
      } else toks.push(t);
      pos += t.raw.length;
      continue;
    }
    // sp <= 3 here
    let t = null;
    switch (c) {
      case 96: case 126: t = fences(src, pos, i); break;
      case 35: t = heading(src, pos, i); break;
      case 62: t = blockquote(src, pos); break;
      case 60: t = htmlBlock(src, pos); break;
      case 91: {
        const d = defBlock(src, pos);
        if (d !== null) {
          const last = toks.length ? toks[toks.length - 1] : null;
          if (last !== null && (last.type === T_PARA || last.type === T_TEXT)) {
            last.raw += (last.raw.endsWith('\n') ? '' : '\n') + d.raw;
            last.text += '\n' + d.raw;
            queue[queue.length - 1].src = last.text;
          } else {
            if (links[d.text] === undefined) { links[d.text] = d.a; nLinks++; }
            toks.push(d);
          }
          pos += d.raw.length;
          continue;
        }
        break;
      }
      case 45: case 42: case 95: case 43:
        if (c !== 43 && isHrAt(src, pos, 3)) { const e = eol(src, i); t = new Tok(T_HR, src.slice(pos, e), ''); break; }
        if (c !== 95 && bulletEnd(src, i + 1)) t = list(src, pos);
        break;
      default:
        if (c >= 48 && c <= 57) {
          let k = i;
          while (k < n && k - i < 10) { const d = src.charCodeAt(k); if (d >= 48 && d <= 57) k++; else break; }
          if (k - i <= 9) {
            const d = src.charCodeAt(k);
            if ((d === 46 || d === 41) && bulletEnd(src, k + 1)) t = list(src, pos);
          }
        }
    }
    if (t !== null) { toks.push(t); pos += t.raw.length; continue; }
    // table
    t = table(src, pos);
    if (t !== null) { toks.push(t); pos += t.raw.length; continue; }
    // setext heading
    t = lheading(src, pos);
    if (t !== null) { toks.push(t); pos += t.raw.length; continue; }
    if (top) {
      const e = paragraphEnd(src, pos);
      const raw = src.slice(pos, e);
      const last = toks.length ? toks[toks.length - 1] : null;
      if (clipped && last !== null && last.type === T_PARA) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
        last.text += '\n' + raw;
        queue[queue.length - 1].src = last.text;
      } else { const p = new Tok(T_PARA, raw, raw); p.q = enq(raw); toks.push(p); }
      clipped = false;
      pos = e;
      continue;
    }
    {
      const e = eol(src, pos);
      const raw = src.slice(pos, e);
      const last = toks.length ? toks[toks.length - 1] : null;
      if (last !== null && last.type === T_TEXT) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
        last.text += '\n' + raw;
        queue[queue.length - 1].src = last.text;
      } else { const p = new Tok(T_TEXT, raw, raw); p.q = enq(raw); toks.push(p); }
      pos = e;
    }
  }
  top = true;
  return toks;
}

function codeBlock(src, pos) {
  const n = src.length;
  let q = pos;
  for (;;) {
    // indented line with content
    let i = q, sp = 0;
    while (src.charCodeAt(i) === C_SP && sp < 4) { i++; sp++; }
    if (sp < 4) { if (src.charCodeAt(i) !== C_TAB) break; i++; }
    if (i >= n || src.charCodeAt(i) === C_NL) break;
    q = eol(src, i);
    if (q >= n) break;
    q++;
    // blank lines
    for (;;) {
      let r = q;
      while (r < n) { const d = src.charCodeAt(r); if (d === C_SP || d === C_TAB) r++; else break; }
      if (r >= n) { q = r; break; }
      if (src.charCodeAt(r) === C_NL) { q = r + 1; continue; }
      break;
    }
    if (q >= n) break;
  }
  const raw = trimBlankTail(src.slice(pos, q));
  const text = raw.replace(/^(?: {0,3}\t| {1,4})/gm, '');
  const t = new Tok(T_CODE, raw, text);
  t.a = undefined;
  return t;
}

function fences(src, pos, i) {
  const n = src.length;
  const ch = src.charCodeAt(i);
  let k = i;
  while (src.charCodeAt(k) === ch) k++;
  const flen = k - i;
  if (flen < 3) return null;
  const le = eol(src, k);
  if (ch === 96) { const b = src.indexOf('`', k); if (b >= 0 && b < le) return null; }
  const info = src.slice(k, le);
  let q = le < n ? le + 1 : n;
  let end = -1, content;
  // empty content alternative
  let ce = closeFence(src, q, ch, flen);
  if (ce >= 0) end = ce;
  else if (q >= n) end = n;
  else {
    // lazy content
    let ls = q;
    for (;;) {
      const e = eol(src, ls);
      if (e >= n) { content = src.slice(q, n); end = n; break; }
      const after = e + 1;
      ce = closeFence(src, after, ch, flen);
      if (ce >= 0) { content = src.slice(q, e); end = ce; break; }
      if (after >= n) { content = src.slice(q, e); end = n; break; }
      ls = after;
    }
  }
  const raw = src.slice(pos, end);
  let text = content === undefined ? '' : content;
  if (ch === 96 && text !== '') {
    const m = /^(\s+)(?:```)/.exec(raw);
    if (m !== null) {
      const ind = m[1].length;
      text = text.split('\n').map((l) => {
        const o = /^\s+/.exec(l);
        if (o === null) return l;
        return l.slice(Math.min(o[0].length, ind));
      }).join('\n');
    }
  }
  const t = new Tok(T_CODE, raw, text);
  t.a = info ? unescapePunct(info.trim()) : info;
  return t;
}
// closing fence at line start i: ' {0,3}' + run(>=flen of ch) + ' *' + (\n|$); returns end (before \n) or -1
function closeFence(src, i, ch, flen) {
  const n = src.length;
  if (i >= n) return -1;
  let j = i, sp = 0;
  while (src.charCodeAt(j) === C_SP && sp < 3) { j++; sp++; }
  let k = j;
  while (src.charCodeAt(k) === ch) k++;
  if (k - j < flen) return -1;
  while (src.charCodeAt(k) === C_SP) k++;
  if (k < n && src.charCodeAt(k) !== C_NL) return -1;
  return k;
}

function heading(src, pos, i) {
  const n = src.length;
  let k = i;
  while (src.charCodeAt(k) === 35) k++;
  const depth = k - i;
  if (depth > 6) return null;
  if (k < n && !isWS(src.charCodeAt(k))) return null;
  const e = eol(src, k);
  if (!lineDots(src, k, e)) return null;
  let text = src.slice(k, e).trim();
  if (text.endsWith('#')) {
    const s = rtrimChar(text, '#');
    if (!s || / $|\t$/.test(s)) text = s.trim();
  }
  const t = new Tok(T_HEADING, src.slice(pos, e), text);
  t.q = enq(text);
  t.a = depth;
  return t;
}

function htmlBlock(src, pos) {
  // R_HTML is anchored; run on the remainder
  const m = R_HTML.exec(pos === 0 ? src : src.slice(pos));
  if (m === null) return null;
  const raw = trimBlankTail(m[0]);
  return new Tok(T_HTML, raw, raw);
}

function defBlock(src, pos) {
  const rest = pos === 0 ? src : src.slice(pos);
  const m = R_DEF.exec(rest);
  if (m === null) return null;
  const h = m[2];
  if (h.charCodeAt(0) !== 60 && balance(h) !== -1) return null;
  const tag = normLabel(m[1]);
  const href = h ? unescapePunct(h.replace(/^<(.*)>$/, '$1')) : '';
  const title = m[3] ? unescapePunct(m[3].substring(1, m[3].length - 1)) : m[3];
  const t = new Tok(T_DEF, rtrimChar(m[0], '\n'), tag);
  t.a = { href, title };
  return t;
}

// index of the unmatched closing paren (-1 none, -2 unbalanced open)
function balance(a) {
  if (a.indexOf('(') < 0 && a.indexOf(')') < 0) return -1;
  let t = 0;
  for (let i = 0; i < a.length; i++) {
    const c = a.charCodeAt(i);
    if (c === 92) i++;
    else if (c === 40) t++;
    else if (c === 41) { t--; if (t < 0) return i; }
  }
  return t > 0 ? -2 : -1;
}

function table(src, pos) {
  // quick reject: the next line must look like a delimiter row with [:|]
  const e1 = eol(src, pos);
  const n = src.length;
  if (e1 >= n) return null;
  const e2 = eol(src, e1 + 1);
  let hasDash = false, hasPipe = false;
  for (let i = e1 + 1; i < e2; i++) {
    const c = src.charCodeAt(i);
    if (c === 45) hasDash = true;
    else if (c === 124 || c === 58) hasPipe = true;
    else if (c !== C_SP) return null;
  }
  if (!hasDash || !hasPipe) return null;
  const m = R_TABLE.exec(pos === 0 ? src : src.slice(pos));
  if (m === null || !/[:|]/.test(m[2])) return null;
  const header = splitCells(m[1], 0);
  const aligns = m[2].replace(/^\||\| *$/g, '').split('|');
  const rows = m[3] && m[3].trim() ? m[3].replace(/\n[ \t]*$/, '').split('\n') : [];
  if (header.length !== aligns.length) return null;
  const al = [];
  for (const a of aligns) {
    if (/^ *-+: *$/.test(a)) al.push('right');
    else if (/^ *:-+: *$/.test(a)) al.push('center');
    else if (/^ *:-+ *$/.test(a)) al.push('left');
    else al.push(null);
  }
  const t = new Tok(T_TABLE, rtrimChar(m[0], '\n'), '');
  t.b = header.map(enq);
  t.c = al;
  const rr = [];
  for (const r of rows) rr.push(splitCells(r, header.length).map(enq));
  t.a = rr;
  return t;
}

function splitCells(row, count) {
  const s = row.replace(/\|/g, (m, off, str) => {
    let e = false, p = off;
    while (--p >= 0 && str[p] === '\\') e = !e;
    return e ? '|' : ' |';
  });
  const cells = s.split(/ \|/);
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// setext underline line at i: ' {0,3}(=+|-+)[ \t]*' then \n or end
function underlineAt(src, i) {
  const n = src.length;
  let j = i, sp = 0;
  while (src.charCodeAt(j) === C_SP && sp < 3) { j++; sp++; }
  const ch = src.charCodeAt(j);
  if (ch !== 61 && ch !== 45) return false;
  while (src.charCodeAt(j) === ch) j++;
  while (j < n) { const c = src.charCodeAt(j); if (c === C_SP || c === C_TAB) j++; else break; }
  return j >= n || src.charCodeAt(j) === C_NL;
}

function lheading(src, pos) {
  // quick reject: some later line before the first blank line must be an underline
  const n = src.length;
  let ls = eol(src, pos);
  let found = false;
  while (ls < n) {
    ls++;
    if (ls >= n) break;
    // blank ([ \t]*) line stops
    let k = ls;
    while (k < n) { const c = src.charCodeAt(k); if (c === C_SP || c === C_TAB) k++; else break; }
    if (k >= n || src.charCodeAt(k) === C_NL) break;
    if (underlineAt(src, ls)) { found = true; break; }
    ls = eol(src, ls);
  }
  if (!found) return null;
  const m = R_LHEADING.exec(pos === 0 ? src : src.slice(pos));
  if (m === null) return null;
  const t = new Tok(T_HEADING, rtrimChar(m[0], '\n'), m[1].trim());
  t.q = enq(t.text);
  t.a = m[2].charCodeAt(0) === 61 ? 1 : 2;
  return t;
}

function paragraphEnd(src, pos) {
  const n = src.length;
  let e = eol(src, pos);
  while (e < n) {
    const ls = e + 1;
    if (ls >= n || src.charCodeAt(ls) === C_NL) break;
    if (paraInterrupt(src, ls)) break;
    e = eol(src, ls);
  }
  return e;
}

// blockquote: match the marked block rule, then split into chunks
function bqMatchEnd(src, pos) {
  const n = src.length;
  let q = pos;
  while (q < n) {
    let i = q, sp = 0;
    while (src.charCodeAt(i) === C_SP && sp < 3) { i++; sp++; }
    if (src.charCodeAt(i) !== 62) break;
    i++;
    if (src.charCodeAt(i) === C_SP) i++;
    // blank rest?
    let k = i;
    while (k < n) { const c = src.charCodeAt(k); if (c === C_SP || c === C_TAB) k++; else break; }
    let e;
    if (k >= n || src.charCodeAt(k) === C_NL) e = eol(src, i);
    else {
      e = eol(src, i);
      while (e < n) {
        const ls = e + 1;
        if (ls >= n || src.charCodeAt(ls) === C_NL) break;
        if (bqInterrupt(src, ls)) break;
        e = eol(src, ls);
      }
    }
    q = e < n ? e + 1 : n;
  }
  return q;
}

const R_BQ_START = /^ {0,3}>/;
function blockquote(src, pos) {
  const end = bqMatchEnd(src, pos);
  if (end === pos) return null;
  let lines = rtrimChar(src.slice(pos, end), '\n').split('\n');
  let raw = '', text = '';
  const toks = [];
  while (lines.length > 0) {
    let inBq = false;
    const cur = [];
    let p;
    for (p = 0; p < lines.length; p++) {
      if (R_BQ_START.test(lines[p])) { cur.push(lines[p]); inBq = true; }
      else if (!inBq) cur.push(lines[p]);
      else break;
    }
    lines = lines.slice(p);
    const h = cur.join('\n');
    const u = h.replace(/^( {0,3}>)([ \t]+)/gm, (g, b, m) => b + expandTabs(m, b.length))
      .replace(/\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g, '\n    $1')
      .replace(/^ {0,3}>[ \t]?/gm, '');
    raw = raw ? raw + '\n' + h : h;
    text = text ? text + '\n' + u : u;
    const d = top;
    top = true;
    blockTokens(u, toks, true);
    top = d;
    if (lines.length === 0) break;
    const k = toks[toks.length - 1];
    const kt = k === undefined ? -1 : k.type;
    if (kt === T_CODE || kt === T_HEADING || kt === T_HR || kt === T_HTML || kt === T_TABLE) break;
    if (kt === T_BQ) {
      const b = lines.join('\n');
      const m = k.raw + '\n' + b.replace(/^ {0,3}>[ \t]?/gm, '');
      const f = blockquote(m, 0);
      toks[toks.length - 1] = f;
      const y = m.substring(f.raw.length).replace(/^\n/, '');
      const R = y ? y.split('\n').length : 0;
      const A = R ? lines.slice(0, -R) : lines;
      if (A.length > 0) raw = raw + '\n' + A.join('\n');
      text = text.substring(0, text.length - k.text.length) + f.text;
      lines = lines.slice(A.length);
      if (lines.length > 0 && R_BQ_START.test(lines[0])) continue;
      break;
    } else if (kt === T_LIST) {
      const b = k.raw + '\n' + lines.join('\n');
      const m = list(b, 0);
      toks[toks.length - 1] = m;
      const f = m.raw.length > k.raw.length ? b.slice(k.raw.length + 1, m.raw.length).split('\n').length : 0;
      if (f > 0) {
        const y = lines.slice(0, f).join('\n');
        raw = raw + '\n' + y;
        text = text + '\n' + y;
      }
      lines = lines.slice(f);
      continue;
    }
  }
  const t = new Tok(T_BQ, raw, text);
  t.a = toks;
  return t;
}

// --- lists

// line-string predicates with indent limit n (0..3)
function lead(s, n) {
  let i = 0;
  while (i <= n && s.charCodeAt(i) === C_SP) i++;
  return i > n ? -1 : i; // index of first non-space, or -1 if more than n spaces
}
function fencesBeginL(s, n) {
  const i = lead(s, n);
  if (i < 0) return false;
  return s.startsWith('```', i) || s.startsWith('~~~', i);
}
function headingBeginL(s, n) {
  const i = lead(s, n);
  if (i < 0 || s.charCodeAt(i) !== 35) return false;
  let k = i;
  while (s.charCodeAt(k) === 35) k++;
  return k - i <= 6 && (k >= s.length || isWS(s.charCodeAt(k)));
}
const R_HTML_BEGIN_L = new RegExp('^(?:</?(?:' + TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)', 'i');
function htmlBeginL(s, n) {
  const i = lead(s, n);
  if (i < 0 || s.charCodeAt(i) !== 60) return false;
  return R_HTML_BEGIN_L.test(i === 0 ? s : s.slice(i));
}
function bqBeginL(s, n) {
  const i = lead(s, n);
  return i >= 0 && s.charCodeAt(i) === 62;
}
function bulletBeginL(s, n) {
  const i = lead(s, n);
  if (i < 0) return false;
  const c = s.charCodeAt(i);
  let k;
  if (c === 42 || c === 43 || c === 45) k = i + 1;
  else if (c >= 48 && c <= 57) {
    k = i;
    while (k < s.length && k - i < 10) { const d = s.charCodeAt(k); if (d >= 48 && d <= 57) k++; else break; }
    if (k - i > 9) return false;
    const d = s.charCodeAt(k);
    if (d !== 46 && d !== 41) return false;
    k++;
  } else return false;
  if (k >= s.length) return true;
  const d = s.charCodeAt(k);
  return d === C_SP || d === C_TAB;
}
function hrL(s, n) {
  return isHrAt(s, 0, n);
}

// /\n[ \t]*\n[ \t]*$/
function endsDoubleBlank(a) {
  let i = a.length - 1;
  while (i >= 0) { const c = a.charCodeAt(i); if (c === C_SP || c === C_TAB) i--; else break; }
  if (i < 0 || a.charCodeAt(i) !== C_NL) return false;
  i--;
  while (i >= 0) { const c = a.charCodeAt(i); if (c === C_SP || c === C_TAB) i--; else break; }
  return i >= 0 && a.charCodeAt(i) === C_NL;
}
const R_TASK = /^\[[ xX]\][ \t]+\S/;
const R_TASK_REPL = /^\[[ xX]\][ \t]+/;

function list(src, pos) {
  const n = src.length;
  let i = pos;
  while (src.charCodeAt(i) === C_SP) i++;
  const c = src.charCodeAt(i);
  let be;
  if (c === 42 || c === 43 || c === 45) be = i + 1;
  else {
    be = i;
    while (be < n && be - i < 10) { const d = src.charCodeAt(be); if (d >= 48 && d <= 57) be++; else break; }
    be++;
  }
  const bull = src.slice(i, be);
  const ordered = bull.length > 1;
  const delim = bull.charCodeAt(bull.length - 1);
  const items = [];
  let loose = false, endsWithBlank = false;
  let e = pos;
  while (e < n) {
    // item regex: ^( {0,3}BULL)((?:[\t ][^\n]*)?(?:\n|$))
    let j = e, sp = 0;
    while (src.charCodeAt(j) === C_SP && sp < 3) { j++; sp++; }
    const d0 = src.charCodeAt(j);
    let k;
    if (ordered) {
      k = j;
      while (k < n && k - j < 10) { const d = src.charCodeAt(k); if (d >= 48 && d <= 57) k++; else break; }
      if (k === j || k - j > 9 || src.charCodeAt(k) !== delim) break;
      k++;
    } else {
      if (d0 !== delim) break;
      k = j + 1;
    }
    if (k < n) { const d = src.charCodeAt(k); if (d !== C_SP && d !== C_TAB && d !== C_NL) break; }
    if (isHrAt(src, e, 3)) break;
    const itemStart = e;
    const b = k - e;
    const le = eol(src, k);
    const line = src.slice(k, le);
    e = le < n ? le + 1 : n;
    let mm = expandLeading(line, b);
    let fl = src.slice(e, eol(src, e));
    let blank = !mm.trim();
    let R, contents = '';
    if (blank) R = b + 1;
    else {
      R = firstNonSpace(mm);
      R = R > 4 ? 1 : R;
      contents = mm.slice(R);
      R += b;
    }
    let endEarly = false;
    if (blank && /^[ \t]*$/.test(fl)) {
      e = Math.min(n, e + fl.length + 1);
      endEarly = true;
    }
    if (!endEarly) {
      const ni = Math.max(0, Math.min(3, R - 1));
      while (e < n) {
        const ue = eol(src, e);
        const U = src.slice(e, ue);
        const Z = expandLeading(U, 0);
        if (fencesBeginL(U, ni) || headingBeginL(U, ni) || htmlBeginL(U, ni) || bqBeginL(U, ni) || bulletBeginL(U, ni) || hrL(U, ni)) break;
        const fns = firstNonSpace(Z);
        if (fns >= R || !U.trim()) contents += '\n' + Z.slice(R);
        else {
          if (blank || firstNonSpace(mm.replace(/\t/g, '    ')) >= 4 || fencesBeginL(mm, ni) || headingBeginL(mm, ni) || htmlBeginL(mm, ni) || hrL(mm, ni)) break;
          const qe = /^ {0,3}(?:=+|-+) *$/.test(U) && R_LHEADING.test(mm + '\n' + U) ? '    ' + Z.replace(/^ {0,3}/, '') : U;
          contents += '\n' + qe;
        }
        blank = !U.trim();
        e = Math.min(n, ue + 1);
        mm = Z.slice(R);
      }
    }
    const A = src.slice(itemStart, e);
    if (!loose) {
      if (endsWithBlank) loose = true;
      else if (endsDoubleBlank(A)) endsWithBlank = true;
    }
    items.push({ raw: A, task: R_TASK.test(contents), text: contents, tokens: null, checked: false });
  }
  if (items.length === 0) return null;
  const lastItem = items[items.length - 1];
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  const t = new Tok(T_LIST, src.slice(pos, e).trimEnd(), '');
  for (const it of items) {
    top = false;
    it.tokens = blockTokens(it.text, [], false);
    if (!loose) {
      let l = false;
      for (const tk of it.tokens) {
        if (tk.type === T_SPACE) { const r = tk.raw; const a = r.indexOf('\n'); if (a >= 0 && r.indexOf('\n', a + 1) >= 0) { l = true; break; } }
      }
      loose = l;
    }
  }
  for (const it of items) {
    const d = it.tokens[0];
    if (it.task && d !== undefined && (d.type === T_TEXT || d.type === T_PARA)) {
      it.text = it.text.replace(R_TASK_REPL, '');
      d.raw = d.raw.replace(R_TASK_REPL, '');
      d.text = d.text.replace(R_TASK_REPL, '');
      for (let g = queue.length - 1; g >= 0; g--) {
        if (R_TASK.test(queue[g].src)) { queue[g].src = queue[g].src.replace(R_TASK_REPL, ''); break; }
      }
      const km = /\[[ xX]\]/.exec(it.raw);
      if (km !== null) {
        const checked = km[0] !== '[ ]';
        it.checked = checked;
        if (loose) d.b = checked ? 2 : 1;
        else { const cb = new Tok(T_CHECK, km[0] + ' ', ''); cb.b = checked; it.tokens.unshift(cb); }
      }
    } else it.task = false;
  }
  if (loose) for (const it of items) for (const tk of it.tokens) if (tk.type === T_TEXT) tk.type = T_PARA;
  t.a = items;
  t.b = ordered;
  t.c = ordered ? +bull.slice(0, -1) : '';
  return t;
}

// ---------------------------------------------------------------------------------------------------
// Block renderer

function renderBlocks(toks) {
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    switch (t.type) {
      case T_PARA:
        out += '<p>' + (t.b ? checkbox(t.b === 2) : '') + t.q.html + '</p>\n';
        break;
      case T_TEXT:
        out += (t.b ? checkbox(t.b === 2) : '') + t.q.html;
        break;
      case T_HEADING:
        out += '<h' + t.a + '>' + t.q.html + '</h' + t.a + '>\n';
        break;
      case T_CODE: {
        const lang = t.a;
        const s = lang ? /^\S*/.exec(lang)[0] : '';
        const body = t.text ? escAll(t.text.replace(/\n$/, '') + '\n') : '';
        out += (s ? '<pre><code class="language-' + esc(s) + '">' : '<pre><code>') + body + '</code></pre>\n';
        break;
      }
      case T_HR: out += '<hr>\n'; break;
      case T_HTML: out += t.text; break;
      case T_BQ: out += '<blockquote>\n' + renderBlocks(t.a) + '</blockquote>\n'; break;
      case T_LIST: {
        const tag = t.b ? 'ol' : 'ul';
        out += '<' + tag + (t.b && t.c !== 1 ? ' start="' + t.c + '"' : '') + '>\n';
        for (const it of t.a) out += '<li>' + renderBlocks(it.tokens) + '</li>\n';
        out += '</' + tag + '>\n';
        break;
      }
      case T_TABLE: {
        out += '<table>\n<thead>\n<tr>\n';
        const al = t.c;
        for (let k = 0; k < t.b.length; k++) out += (al[k] ? '<th align="' + al[k] + '">' : '<th>') + t.b[k].html + '</th>\n';
        out += '</tr>\n</thead>\n';
        const rows = t.a;
        if (rows.length) {
          let s = '';
          for (const r of rows) {
            s += '<tr>\n';
            for (let k = 0; k < r.length; k++) s += (al[k] ? '<td align="' + al[k] + '">' : '<td>') + r[k].html + '</td>\n';
            s += '</tr>\n';
          }
          out += '<tbody>' + s + '</tbody>';
        }
        out += '</table>\n';
        break;
      }
      case T_CHECK: out += checkbox(t.b); break;
      default: break; // space, def
    }
  }
  return out;
}

function checkbox(checked) {
  return checked ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ';
}

// ---------------------------------------------------------------------------------------------------
// Inline lexer + renderer


// per-call masked source state
function Mask(src) {
  this.src = src;
  this.masked = null;
  this.ast = -2; this.und = -2; this.del = -2;
  this.runsA = null; this.runsU = null; this.riA = 0; this.riU = 0;
}

function computeMask(m) {
  let t = m.src;
  const hasBr = t.indexOf('[') >= 0, hasTick = t.indexOf('`') >= 0;
  // without definitions the first pass changes nothing; with neither a backslash nor a "``" the second
  // pass changes nothing (a one-backtick span has no inner backtick to rewrite)
  if (hasBr && nLinks > 0) t = t.replace(R_REF_SEARCH, refMaskRepl);
  if (t.indexOf('\\') >= 0 || (hasTick && t.indexOf('``') >= 0)) t = t.replace(R_PUNCT_OUTSIDE_CODE, punctMaskRepl);
  if (hasBr || hasTick || t.indexOf('<') >= 0) t = t.replace(R_BLOCK_SKIP, skipMaskRepl);
  m.masked = t;
}
function punctMaskRepl(n, s, r) {
  return r ? '+'.repeat(n.length) : s ? s + n.slice(s.length, -s.length).replace(/`/g, '+') + s : n;
}
function skipMaskRepl(n) {
  return '[' + 'a'.repeat(n.length - 2) + ']';
}
// start of the last run of ch whose preceding character is not ASCII whitespace (-1 if none)
function lastCloser(t, ch) {
  let i = t.length - 1;
  while (i >= 0) {
    i = t.lastIndexOf(ch, i);
    if (i < 0) return -1;
    let st = i;
    while (st > 0 && t[st - 1] === ch) st--;
    const o = st === 0 ? 10 : t.charCodeAt(st - 1);
    if (o !== 32 && o !== 9 && o !== 10 && o !== 13 && o !== 12) return st;
    i = st - 1;
  }
  return -1;
}
function refMaskRepl(r) {
  const o = r.lastIndexOf('[');
  if (!Object.hasOwn(links, normLabel(r.slice(o + 1, -1)))) return r;
  if (o > 1 && r.charAt(0) !== '!') {
    const i = r.slice(1, o - 1);
    if (linkInText(i)) return '[' + i.replace(R_REF_SEARCH, refMaskRepl) + '][' + 'a'.repeat(r.length - o - 2) + ']';
  }
  return '[' + 'a'.repeat(r.length - 2) + ']';
}
function linkInText(e) {
  if (e.indexOf('[') < 0) return false;
  for (const m of e.matchAll(R_BLOCK_SKIP)) if (R_LINK_A.test(m[0]) && e.charAt(m.index - 1) !== '!') return true;
  for (const m of e.matchAll(R_REF_SEARCH)) {
    const s = m[0], r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(links, normLabel(s.slice(r + 1, -1)))) && !(r > 1 && linkInText(s.slice(1, r - 1)))) return true;
  }
  return false;
}

function inlineTokens(src) {
  const savedParen = parenOk;
  parenOk = savedParen && src.indexOf(')') >= 0;
  const r = lexInline(src);
  parenOk = savedParen;
  return r;
}

// does a '<' inside the link label start a tag/autolink running past the label end?
function labelHasTag(src, pos, label, off) {
  if (label.indexOf('<') < 0) return false;
  for (let s = 0; s < label.length; s++) {
    const c = label.charCodeAt(s);
    if (c === 92) { s++; continue; }
    if (c === 96) {
      const m = R_CODE_A.exec(label.slice(s));
      if (m !== null) { s += m[0].length - 1; continue; }
    }
    if (c !== 60) continue;
    const r = src.slice(pos + off + s);
    const o = R_TAG_A.exec(r) || R_AUTOLINK_A.exec(r);
    if (o !== null) {
      if (o[0].length > label.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}

// link / image output given label text and destination; returns null when marked would not emit it
function emitLink(raw, label, href, title, isImage) {
  const text = label.replace(/\\([\[\]])/g, '$1');
  const pIn = inLink, pEm = linkEmitted, pRaw = inRaw;
  inLink = true;
  linkEmitted = false;
  let inner;
  if (isImage) {
    const tm = textMode;
    textMode = true;
    inner = inlineTokens(text);
    textMode = tm;
  } else inner = inlineTokens(text);
  const k = linkEmitted;
  linkEmitted = pEm;
  inLink = pIn;
  if (!isImage) {
    if (k) { inRaw = pRaw; return null; }
    linkEmitted = true;
  }
  if (textMode) return inner;
  const u = cleanUrl(href);
  if (isImage) {
    if (u === null) return esc(inner);
    let o = '<img src="' + esc(u) + '" alt="' + esc(inner) + '"';
    if (title) o += ' title="' + esc(title) + '"';
    return o + '>';
  }
  if (u === null) return inner;
  let l = '<a href="' + esc(u) + '"';
  if (title) l += ' title="' + esc(title) + '"';
  return l + '>' + inner + '</a>';
}

function autoLinkHtml(text, href) {
  if (textMode) return text;
  const u = cleanUrl(href);
  const t = escAll(text);
  if (u === null) return t;
  return '<a href="' + escAll(u) + '">' + t + '</a>';
}

// result slot for tokenizers returning (html, consumed)
let rLen = 0;

function tryLink(src, pos) {
  R_LINK.lastIndex = pos;
  const t = R_LINK.exec(src);
  if (t === null) return null;
  let t0 = t[0], t2 = t[2], t3 = t[3];
  const isImage = t0.charCodeAt(0) === 33;
  if (labelHasTag(src, pos, t[1], isImage ? 2 : 1)) return null;
  const s = t2.trim();
  if (s.charCodeAt(0) === 60) {
    if (!s.endsWith('>')) return null;
    const l = rtrimChar(s.slice(0, -1), '\\');
    if ((s.length - l.length) % 2 === 0) return null;
  } else {
    const l = balance(t2);
    if (l === -2) return null;
    if (l > -1) {
      const h = (t0.indexOf('!') === 0 ? 5 : 4) + t[1].length + l;
      t2 = t2.substring(0, l);
      t0 = t0.substring(0, h).trim();
      t3 = '';
    }
  }
  const r = rtrimChar(t0.slice(0, -1), '\\');
  if ((t0.length - r.length) % 2 === 0) return null;
  let o = t2.trim();
  const title = t3 ? t3.slice(1, -1) : '';
  if (o.charCodeAt(0) === 60) o = o.slice(1, -1);
  const html = emitLink(t0, t[1], o && unescapePunct(o), title && unescapePunct(title), isImage);
  if (html === null) return null;
  rLen = t0.length;
  return html;
}

// returns html, '' sentinel with rLen=-1 for "text fallback", or null
let refFallback = false;
function tryRefLink(src, pos) {
  R_REFLINK.lastIndex = pos;
  let m = R_REFLINK.exec(src);
  if (m === null) { R_NOLINK.lastIndex = pos; m = R_NOLINK.exec(src); if (m === null) return null; }
  const isImage = m[0].charCodeAt(0) === 33;
  if (labelHasTag(src, pos, m[1], isImage ? 2 : 1)) return null;
  const def = links[normLabel(m[2] || m[1])];
  if (def === undefined) { refFallback = true; rLen = 1; return m[0][0]; }
  const html = emitLink(m[0], m[1], def.href, def.title || null, isImage);
  refFallback = false;
  if (html === null) return null;
  rLen = m[0].length;
  return html;
}

function charBefore(s, l) {
  // last code point of s.slice(max(0,l-2), l)
  if (l <= 0) return '';
  const a = s.charCodeAt(l - 1);
  if (a >= 0xdc00 && a <= 0xdfff && l >= 2) {
    const b = s.charCodeAt(l - 2);
    if (b >= 0xd800 && b <= 0xdbff) return s.slice(l - 2, l);
  }
  return s[l - 1];
}
function isPunctuation(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return c !== 42 && c !== 95 && ((CT[c] & F_PUNCT) !== 0 || isWS(c));
  return R_PUNCTUATION.test(ch);
}
function cpLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 0xd800 || c > 0xdbff || i + 1 >= s.length) n++; else { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { n++; i++; } else n++; } }
  return n;
}

// Code-point class used by the emphasis flanking rules: 0 whitespace, 1 punctuation or symbol, 2 other.
// `*` runs treat `~` as "other", `_` runs treat it as punctuation (marked's two closer grammars differ there).
const EC = new Uint8Array(128);
(function () {
  for (let c = 0; c < 128; c++) EC[c] = c === 32 || (c >= 9 && c <= 13) ? 0 : (CT[c] & F_PUNCT) ? 1 : 2;
})();
const R_ALT0_A = /[^_*]*?__[^_*]*?\*[^_*]*?(?=__)/uy;
const R_ALT0_U = /[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)/uy;

function cpClassAt(t, i, ast) {
  const c = t.charCodeAt(i);
  if (c < 128) return c === 126 && ast ? 2 : EC[c];
  if (isWS(c)) return 0;
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
    const d = t.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return R_PUNCT_CLASS.test(t.slice(i, i + 2)) ? 1 : 2;
  }
  return R_PUNCT_CLASS.test(t[i]) ? 1 : 2;
}

// Every run of the delimiter `rc` (42 or 95) in the masked text that marked's closer grammar can match,
// as flat quadruples: match start (incl. the character before the run), run start, run length, kind
// (1 closer, 2 opener, 3 both), in text order. The grammar looks only at the characters either side of a
// maximal run, so one pass classifies every run and later searches just walk this list.
function buildRuns(t, rc, ast) {
  const ch = rc === 42 ? '*' : '_';
  const n = t.length;
  const out = [];
  let i = t.indexOf(ch);
  while (i >= 0) {
    let e = i + 1;
    while (e < n && t.charCodeAt(e) === rc) e++;
    if (i > 0) {
      let w = 1, pc;
      const c = t.charCodeAt(i - 1);
      if (c < 128) pc = c === 126 && ast ? 2 : EC[c];
      else if (c >= 0xdc00 && c <= 0xdfff && i >= 2 && (t.charCodeAt(i - 2) & 0xfc00) === 0xd800) {
        w = 2;
        pc = R_PUNCT_CLASS.test(t.slice(i - 2, i)) ? 1 : 2;
      } else pc = isWS(c) ? 0 : R_PUNCT_CLASS.test(t[i - 1]) ? 1 : 2;
      const nc = e < n ? cpClassAt(t, e, ast) : 0; // the end of the text acts like whitespace
      let kd;
      if (pc === 1) kd = nc === 1 ? 3 : nc === 2 ? 2 : 1;
      else if (pc === 0) kd = nc === 0 ? 0 : 2;
      else kd = nc === 2 ? (ast ? 3 : 0) : 1;
      if (kd !== 0) out.push(i - w, i, e - i, kd);
    }
    i = t.indexOf(ch, e);
  }
  return out;
}

function tryEmStrong(src, pos, prev, mk) {
  const c = src.charCodeAt(pos);
  const sn = src.length;
  let e = pos + 1;
  while (e < sn && src.charCodeAt(e) === c) e++;
  if (e >= sn) return null;
  // the character after the run: punctuation (d), or another non-space character (g4, `_` only)
  const fc = src.charCodeAt(e);
  let d = '', g4 = false;
  if (fc < 128) {
    if (fc === 32 || (fc >= 9 && fc <= 13)) return null;
    if ((CT[fc] & F_PUNCT) !== 0 && fc !== 126) d = src[e];
    else g4 = c === 95;
  } else {
    if (isWS(fc)) return null;
    let cp = src[e];
    if (fc >= 0xd800 && fc <= 0xdbff && e + 1 < sn) {
      const x = src.charCodeAt(e + 1);
      if (x >= 0xdc00 && x <= 0xdfff) cp = src.slice(e, e + 2);
    }
    if (R_PUNCT_CLASS.test(cp)) d = cp; else g4 = c === 95;
  }
  const r = c === 42 ? '*' : '_';
  const ast = c === 42;
  const o = prev === r;
  const k = e - pos;
  let t = null, l = pos, n = prev, u, p = '', h = false;
  if (pos > 0 && src.charCodeAt(pos - 1) === c) {
    // inside a run: its start, as the masked text sees it
    if (mk.masked === null) computeMask(mk);
    t = mk.masked;
    while (l > 0 && t.charCodeAt(l - 1) === c) l--;
  }
  if (t !== null) {
    p = charBefore(t, l);
    h = p === '*' || p === '_' || isPunctuation(p);
  }
  if (l < pos) { n = p; u = h; } else u = isPunctuation(n);
  if (g4 && R_ALNUM_U.test(n)) return null;
  if (!(!d || !n || u)) return null;
  const Q = pos + k;
  if (src.lastIndexOf(r) < Q) return null; // masking never adds a delimiter
  if (t === null) {
    if (mk.masked === null) computeMask(mk);
    t = mk.masked;
    p = charBefore(t, l);
    h = p === '*' || p === '_' || isPunctuation(p);
  }
  let v;
  if (ast) { if (mk.ast === -2) mk.ast = lastCloser(t, '*'); v = mk.ast; }
  else { if (mk.und === -2) mk.und = lastCloser(t, '_'); v = mk.und; }
  if (v < Q) return null;
  const y = pos - l + k;
  const R = !!p.trim() && (!!d || (r === '*' && !h));
  // marked's closer grammar can also swallow a "__x*y__" (or "**x_y**") stretch right at the start
  let skipTo = 0;
  if (t.indexOf(ast ? '__' : '**', Q) >= 0) {
    const re = ast ? R_ALT0_A : R_ALT0_U;
    re.lastIndex = Q;
    const mm = re.exec(t);
    if (mm !== null) skipTo = Q + mm[0].length;
  }
  let runs, ri;
  if (ast) { if (mk.runsA === null) mk.runsA = buildRuns(t, 42, true); runs = mk.runsA; ri = mk.riA; }
  else { if (mk.runsU === null) mk.runsU = buildRuns(t, 95, false); runs = mk.runsU; ri = mk.riU; }
  const rn = runs.length;
  while (ri < rn && runs[ri] < Q) ri += 4;
  if (ast) mk.riA = ri; else mk.riU = ri;
  let m = k, f = 0;
  for (; ri < rn; ri += 4) {
    const ms = runs[ri];
    if (ms > v) break;
    if (ms < skipTo) continue;
    const kd = runs[ri + 3];
    let b = runs[ri + 2];
    if (kd === 2) { m += b; continue; }
    if (kd === 3 || R) {
      if (o && kd === 3) break;
      if (y % 3 && !((y + b) % 3)) { f += b; continue; }
    }
    m -= b;
    if (m > 0) continue;
    b = Math.min(b, b + m + f);
    const len = runs[ri + 1] - pos + b;
    if (Math.min(k, b) % 2) {
      const inner = inlineTokens(src.slice(pos + 1, pos + len - 1));
      rLen = len;
      return textMode ? inner : '<em>' + inner + '</em>';
    }
    const inner = inlineTokens(src.slice(pos + 2, pos + len - 2));
    rLen = len;
    return textMode ? inner : '<strong>' + inner + '</strong>';
  }
  return null;
}

function tryDel(src, pos, prev, mk) {
  R_DEL_L.lastIndex = pos;
  let s = R_DEL_L.exec(src);
  if (s === null) return null;
  if (!(!s[1] || !prev || isPunctuation(prev))) return null;
  const o = cpLen(s[0]) - 1;
  let p = o;
  if (mk.masked === null) computeMask(mk);
  const t = mk.masked;
  if (mk.del === -2) mk.del = lastCloser(t, '~');
  const u = mk.del;
  const d = pos + o;
  if (u < d) return null;
  const ts = t.slice(d);
  const k = u - d;
  R_DEL_R.lastIndex = 0;
  while ((s = R_DEL_R.exec(ts)) !== null && !(s.index > k)) {
    const g = s[1] || s[2] || s[3] || s[4] || s[5] || s[6];
    if (!g) continue;
    let l = g.length;
    if (l !== o) continue;
    if (s[3] || s[4]) { p += l; continue; }
    p -= l;
    if (p > 0) continue;
    l = Math.min(l, l + p);
    const c0 = s[0].charCodeAt(0);
    const g0 = c0 >= 0xd800 && c0 <= 0xdbff && s[0].length > 1 ? 2 : 1;
    const len = o + s.index + g0 + l;
    const inner = inlineTokens(src.slice(pos + o, pos + len - o));
    rLen = len;
    return textMode ? inner : '<del>' + inner + '</del>';
  }
  return null;
}

// url / email autolink without angle brackets
function tryUrl(src, pos) {
  R_URL.lastIndex = pos;
  const t = R_URL.exec(src);
  if (t === null) return null;
  let raw = t[0], href;
  if (t[2] === '@') { href = 'mailto:' + raw; }
  else {
    let prevRaw;
    do { prevRaw = raw; const b = R_BACKPEDAL.exec(raw); raw = b === null ? '' : b[0]; } while (prevRaw !== raw);
    href = t[1] === 'www.' ? 'http://' + raw : raw;
  }
  rLen = raw.length;
  return autoLinkHtml(raw, href);
}

function urlPossible(src, pos, c) {
  // cheap pre-check for R_URL at pos
  const n = src.length;
  if (c === 109 && src.startsWith('mailto:', pos)) return true;
  if (c === 120 && src.startsWith('xmpp:', pos)) return true;
  if (c === 119 && src.startsWith('www.', pos)) return true;
  if (protoAt(src, pos)) return true;
  let j = pos;
  while (j < n) { const d = src.charCodeAt(j); if (d < 128 && (CT[d] & F_URL1)) j++; else break; }
  return j > pos && src.charCodeAt(j) === 64;
}
function protoAt(s, q) {
  const c = s.charCodeAt(q) | 32;
  if (c === 104) {
    if ((s.charCodeAt(q + 1) | 32) !== 116 || (s.charCodeAt(q + 2) | 32) !== 116 || (s.charCodeAt(q + 3) | 32) !== 112) return false;
    let k = q + 4;
    if ((s.charCodeAt(k) | 32) === 115) k++;
    return s.charCodeAt(k) === 58 && s.charCodeAt(k + 1) === 47 && s.charCodeAt(k + 2) === 47;
  }
  if (c === 102) {
    return (s.charCodeAt(q + 1) | 32) === 116 && (s.charCodeAt(q + 2) | 32) === 112 && s.charCodeAt(q + 3) === 58 && s.charCodeAt(q + 4) === 47 && s.charCodeAt(q + 5) === 47;
  }
  return false;
}
function emailProtoAt(s, q) {
  return s.startsWith('mailto:', q) || s.startsWith('xmpp:', q);
}
// (?= {2,}\n)
function spaces2nl(s, q) {
  let k = q;
  while (s.charCodeAt(k) === C_SP) k++;
  return k - q >= 2 && s.charCodeAt(k) === C_NL;
}
// (?=[emailchars]+@)
function emailAhead(s, q) {
  const n = s.length;
  let j = q;
  while (j < n) { const d = s.charCodeAt(j); if (d < 128 && (CT[d] & F_EMAIL)) j++; else break; }
  return j > q && s.charCodeAt(j) === 64;
}

// end of the inline text token starting at s
// Where marked's lazy text rule stops. The stop characters, protocols and www. are found by one native
// search; the three conditions that hinge on a rarer anchor (an '@' after an email-looking run, two or
// more spaces before a line break, mailto:/xmpp:) are located with indexOf and cached per source:
// each cached occurrence stays the first relevant one until the scan position passes it.
const R_TEXT_STOP = /[\\<!\[`*~_]|[hH][tT][tT][pP][sS]?:\/\/|[fF][tT][pP]:\/\/|(?<![^\s*_~(])www\./g;

function TextScan(src) {
  this.src = src;
  this.atA = -2; this.atR = 0; // next '@' (A) with a non-empty email run [R, A) before it; -1 none
  this.brK = -2; this.brS = 0; // next "  \n": newline at K, its space run starts at S; -1 none
  this.mt = -2;                // next mailto:/xmpp: after a non-alphanumeric; -1 none
}

function isEmailC(c) { return c < 128 && (CT[c] & F_EMAIL) !== 0; }

// end of the inline text token starting at s
function textEnd(sc, s) {
  const src = sc.src;
  const n = src.length;
  const c0 = src.charCodeAt(s);
  if (!(c0 < 128 && (CT[c0] & F_ALNUM)) && emailProtoAt(src, s + 1)) return s + 1;
  let q = s + 1;
  if (c0 === 96 || c0 === 126) while (q < n && src.charCodeAt(q) === c0) q++;
  if (q >= n) return n;
  const cq = src.charCodeAt(q);
  if (cq === 96 || cq === 126) return q;
  let end = n;
  if (sc.brK !== -1) {
    if (sc.brK === -2 || sc.brK - 2 < q) {
      const i = src.indexOf('  \n', q);
      if (i < 0) sc.brK = -1;
      else { let S = i; while (S > 0 && src.charCodeAt(S - 1) === C_SP) S--; sc.brK = i + 2; sc.brS = S; }
    }
    if (sc.brK !== -1) {
      if (sc.brS <= q) return q; // (?= {2,}\n) right here
      end = sc.brS;
    }
  }
  if (sc.atA !== -1) {
    if (sc.atA === -2 || sc.atA < q + 1) {
      let i = src.indexOf('@', q + 1), R = 0;
      while (i >= 0) {
        R = i;
        while (R > 0 && isEmailC(src.charCodeAt(R - 1))) R--;
        if (R < i) break;
        i = src.indexOf('@', i + 1);
      }
      if (i < 0) sc.atA = -1; else { sc.atA = i; sc.atR = R; }
    }
    if (sc.atA !== -1) {
      if (sc.atR <= q) return q; // q is inside the run: (?=[...]+@) right here
      if (sc.atR < end) end = sc.atR;
    }
  }
  if (sc.mt !== -1) {
    if (sc.mt === -2 || sc.mt < q + 1) {
      let from = q + 1, m = -1;
      for (;;) {
        const i1 = src.indexOf('mailto:', from), i2 = src.indexOf('xmpp:', from);
        const i = i1 < 0 ? i2 : i2 < 0 ? i1 : Math.min(i1, i2);
        if (i < 0) break;
        const d = src.charCodeAt(i - 1);
        if (!(d < 128 && (CT[d] & F_ALNUM))) { m = i; break; }
        from = i + 1;
      }
      sc.mt = m;
    }
    if (sc.mt !== -1 && sc.mt < end) end = sc.mt;
  }
  R_TEXT_STOP.lastIndex = q;
  const m = R_TEXT_STOP.exec(src);
  if (m !== null && m.index < end) end = m.index;
  return end;
}

const ESC_HTML = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' };

// text with none of these can only be one plain text token (no escape, tag, link, emphasis, code span,
// entity, autolink or hard break can start in it)
const R_SPECIAL = /[\\<!\[`*~_&@:]|www\.|  \n/;

function lexInline(src) {
  if (!R_SPECIAL.test(src)) return inRaw || textMode ? src : esc(src);
  const n = src.length;
  let out = '';
  let pend = '', pendEsc = false, hasPend = false;
  let prevText = false, prev = '';
  let mk = null, sc = null;
  let pos = 0;
  while (pos < n) {
    if (!prevText) prev = '';
    prevText = false;
    const c = src.charCodeAt(pos);
    let html = null;
    switch (c) {
      case 92: { // backslash
        const d = src.charCodeAt(pos + 1);
        if (d < 128 && (CT[d] & F_PUNCT)) {
          if (hasPend) { out += pendEsc || textMode ? pend : esc(pend); hasPend = false; }
          out += textMode ? src[pos + 1] : (ESC_HTML[d] || src[pos + 1]);
          pos += 2;
          continue;
        }
        if (d === C_NL && !onlyWsAfter(src, pos + 2)) {
          html = textMode ? '' : '<br>';
          let k = pos + 2;
          while (k < n) { const e = src.charCodeAt(k); if (e === C_SP || e === C_TAB) k++; else break; }
          rLen = k - pos;
        }
        break;
      }
      case 60: { // <
        R_TAG.lastIndex = pos;
        const m = R_TAG.exec(src);
        if (m !== null) {
          const raw = m[0];
          if (!inLink && /^<a /i.test(raw)) inLink = true;
          else if (inLink && /^<\/a>/i.test(raw)) inLink = false;
          if (!inRaw && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) inRaw = true;
          else if (inRaw && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) inRaw = false;
          html = raw;
          rLen = raw.length;
          break;
        }
        R_AUTOLINK.lastIndex = pos;
        const a = R_AUTOLINK.exec(src);
        if (a !== null) {
          html = autoLinkHtml(a[1], a[2] === '@' ? 'mailto:' + a[1] : a[1]);
          rLen = a[0].length;
        }
        break;
      }
      case 33: // !
        if (src.charCodeAt(pos + 1) !== 91) break;
      // falls through
      case 91: { // [
        if (parenOk) html = tryLink(src, pos);
        if (html === null) {
          refFallback = false;
          html = tryRefLink(src, pos);
          if (html !== null && refFallback) {
            // a one-character text token, merged with a preceding text token
            if (!hasPend) { pend = html; pendEsc = false; hasPend = true; } else pend += html;
            pos += 1;
            continue;
          }
        }
        break;
      }
      case 42: case 95: { // * _
        if (mk === null) mk = new Mask(src);
        html = tryEmStrong(src, pos, prev, mk);
        if (html === null && c === 95 && !inLink && urlPossible(src, pos, c)) html = tryUrl(src, pos);
        break;
      }
      case 96: { // `
        R_CODE.lastIndex = pos;
        const m = R_CODE.exec(src);
        if (m !== null) {
          let t = m[2].replace(/\n/g, ' ');
          if (/[^ ]/.test(t) && t.charCodeAt(0) === C_SP && t.charCodeAt(t.length - 1) === C_SP) t = t.substring(1, t.length - 1);
          html = textMode ? t : '<code>' + escAll(t) + '</code>';
          rLen = m[0].length;
        }
        break;
      }
      case 32: { // br: two or more spaces then newline not followed by only whitespace
        let k = pos;
        while (src.charCodeAt(k) === C_SP) k++;
        if (k - pos >= 2 && src.charCodeAt(k) === C_NL && !onlyWsAfter(src, k + 1)) {
          k++;
          while (k < n) { const e = src.charCodeAt(k); if (e === C_SP || e === C_TAB) k++; else break; }
          html = textMode ? '' : '<br>';
          rLen = k - pos;
        }
        break;
      }
      case 126: { // ~
        if (mk === null) mk = new Mask(src);
        html = tryDel(src, pos, prev, mk);
        break;
      }
      default:
        if (c < 128 && (CT[c] & F_URL1) && !inLink && urlPossible(src, pos, c)) html = tryUrl(src, pos);
    }
    if (html !== null) {
      if (hasPend) { out += pendEsc || textMode ? pend : esc(pend); hasPend = false; }
      out += html;
      pos += rLen;
      continue;
    }
    // text
    if (sc === null) sc = new TextScan(src);
    const e = textEnd(sc, pos);
    const raw = src.slice(pos, e);
    const txt = inRaw ? raw : decodeNumRefs(raw);
    if (!hasPend) { pend = txt; pendEsc = inRaw; hasPend = true; } else pend += txt;
    if (src.charCodeAt(e - 1) !== 95) prev = src[e - 1];
    prevText = true;
    pos = e;
  }
  if (hasPend) out += pendEsc || textMode ? pend : esc(pend);
  return out;
}

// (?=\s*$) from i
function onlyWsAfter(s, i) {
  for (let k = i; k < s.length; k++) if (!isWS(s.charCodeAt(k))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------

export function parse(markdown) {
  const src = markdown.indexOf('\r') >= 0 ? markdown.replace(/\r\n|\r/g, '\n') : markdown;
  links = Object.create(null);
  nLinks = 0;
  top = true;
  inLink = false; inRaw = false; linkEmitted = false; parenOk = true; textMode = false;
  queue = [];
  const toks = blockTokens(src, [], false);
  for (let i = 0; i < queue.length; i++) { const e = queue[i]; inRaw = false; e.html = inlineTokens(e.src); }
  queue = null;
  return renderBlocks(toks);
}
