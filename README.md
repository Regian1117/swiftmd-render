# swiftmd-render

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Regian1117/swiftmd-render/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Regian1117/swiftmd-render/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free Markdown renderer written from scratch. Its output is byte-identical to
[marked](https://github.com/markedjs/marked) 18.1.3 (MIT) on its default options (GFM on, breaks off,
pedantic off): marked is the reference whose HTML, quirks included, this renderer reproduces. No marked
code is shipped here; marked is only read to learn its behaviour and run as the oracle in the tests.

## Design

`parse.js` exports `parse(markdown)`. It works in three stages, all on plain strings and character codes.

- **Block scanner.** A position-based scanner walks the source once and builds light block records
  (headings, fenced and indented code, block quotes, lists, tables, HTML blocks, link reference
  definitions, paragraphs). Hot line tests dispatch on the first character, so a list or block-quote
  continuation line is only compared against the block starts it can actually be. The few intricate
  constructs (raw HTML blocks, definitions, tables, setext headings) keep a regular expression, checked
  against marked's own source by `tools/rules.mjs`.
- **Inline scanner.** Inline text is queued by the block pass and rendered afterwards in the order marked
  would. A text with none of `\ < ! [ ` * ~ _ & @ :`, `www.` or a hard break is emitted as one escaped
  slice without entering the scanner. Otherwise the scanner jumps from special character to special
  character and writes HTML directly; links, code spans, tags and autolinks use sticky regular
  expressions started only where a quick necessary condition holds.
- **Emphasis pairing.** marked decides emphasis by searching forward from each opener over a masked copy
  of the text (links, code spans and tags hidden). Here the delimiter runs of that masked text are
  classified once, in one pass, into closer / opener / both from the characters on either side (marked's
  left- and right-flanking grammar, including its rule of three and its `__x*y__` quirk), and every
  opener just walks that list instead of re-running a regular expression over the rest of the text. The
  masked copy is built only when an opener survives the cheap rejections (no later delimiter, a
  `snake_case` underscore, a delimiter followed by a space).
- **Driver.** `main.ts` reads `cases.json`, renders each case, writes `html.json` with the native
  `JSON.stringify` (a hand-written writer measured three times slower). It also switches V8's optimising
  compiler off before loading `parse.js`: on a one-shot cold run its background compilation costs more CPU
  than it saves (about 30% less process CPU on Node 22 and 24).

## Measured speed

`tools/bench.mjs` interleaves runs of `main.ts`, the kit's marked baseline and `node -e 0` on the practice
set and compares process CPU (all threads) net of the empty run. On the development machine (Windows,
Node 24, noisy; runs vary by a few percent) the latest run gave **2.03x** less CPU than marked (net 1001 ms
against 2032 ms; 1.85x on wall time). Node 22.12 behaves the same way. Absolute numbers on the grader's one-CPU container
differ; the ratio is what the tools report.

## Correctness

- `node tools/test.mjs`: the 720 practice cases, code unit for code unit (720/720).
- `node tools/fuzz.mjs 250 4000`: 250 documents drawn with the kit's generator from fresh random seeds,
  plus 4000 mutated or combined spec examples, each compared with marked (0 differences).
- `node tools/fuzz-inline.mjs 400000`: short random strings over a delimiter-heavy alphabet, compared with
  marked (0 differences). This is the tool that exposed a missing `;` in the bare-URL back-pedal rule.
- `node tools/rules.mjs`: every regular expression that is rebuilt here has the same source as marked's.

## Run it

```sh
node main.ts          # reads /input/cases.json, writes /output/html.json
npm test              # practice set + rule check
npm run fuzz          # generated documents against marked
npm run bench         # speed against marked
```

The tools look for the competition kit next to the repository (`../kitx/markdown-render-speed-02-kit`);
pass another kit directory as the last argument.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
