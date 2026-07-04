/* cli.mjs — tiny shared arg/format helpers for the pipeline CLI scripts.
   Companion to marketfetch.mjs (which owns the FETCH layer); this file owns the
   CLI-plumbing that had re-grown as byte-identical copies across the scripts
   (chunk 10.2 dedup). No market/quote math lives here — that is js/quotecore.js.
   Consumers: screen.mjs, add-manual-fill.mjs (parseArgs/parseGp); quote.mjs,
   screen.mjs (mdTable/stdCells). */
import { quoteCells } from '../js/quotecore.js';

/* --- parseArgs(argv): the `--flag value` / bare-`--flag` loop.
   argv = process.argv.slice(2). A bare flag (no value, or followed by another --flag)
   becomes `true`; otherwise the next token is its string value. Returns a plain object.
   (Was duplicated verbatim in screen.mjs + add-manual-fill.mjs.) --- */
export function parseArgs(argv) {
  const A = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) A[k] = true;
    else { A[k] = v; i++; }
  }
  return A;
}

/* --- parseGp("18.05m" | "450k" | "3439800" | 150) -> integer gp (NaN if unparseable).
   Superset of the two prior copies: accepts a number passthrough and a leading sign,
   strips commas, honors k/m/b suffix. --- */
export function parseGp(s) {
  if (typeof s === 'number') return Math.round(s);
  const t = String(s).trim().toLowerCase().replace(/,/g, '');
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return NaN;
  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/* --- mdTable(headers, rows): generic markdown table (rows = array of cell arrays).
   Generic on purpose — both consumers APPEND columns to the standard set (quote.mjs
   --positions adds Held@/Break-even/Verdict; screen.mjs adds Exp gp/d), which is why
   quotecore's fixed-column quoteMarkdown() can't serve them. --- */
export const mdTable = (headers, rows) =>
  ['| ' + headers.join(' | ') + ' |',
   '| ' + headers.map(() => '---').join(' | ') + ' |',
   ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');

/* --- stdCells(name, row): the standard 9-column QUOTE_HEADERS cells as an array,
   ready for mdTable (or to have extra columns appended). Wraps quotecore.quoteCells. --- */
export const stdCells = (name, row) => {
  const c = quoteCells(name, row);
  return [c.item, c.guide, c.mid, c.buy, c.sell, c.net, c.vol, c.mom, c.regime];
};
