/* cli.mjs — tiny shared arg/format helpers for the pipeline CLI scripts.
   Companion to marketfetch.mjs (which owns the FETCH layer); this file owns the
   CLI-plumbing that had re-grown as byte-identical copies across the scripts
   (chunk 10.2 dedup). No market/quote math lives here — that is js/quotecore.js.
   Consumers: screen-flip-niches.mjs, add-manual-fill.mjs (parseArgs/parseGp); quote-items.mjs,
   screen-flip-niches.mjs (mdTable/stdCells). */
import { quoteCells, cellText } from '../../js/quotecore.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* --- writeLastReport(kind, reports): the AO1 agent-readable dump (PLAN-REACH-CALIBRATION Part 2).
   The three market-read CLIs (screen/quote/watch) print a human markdown table + note footers to
   stdout — load-bearing for Ben's terminal read, but a per-run context tax for an AGENT (a --mode all
   scan is ~480 lines to redirect + re-read). Each already builds render.mjs report objects; this
   serialises the object(s) already in hand to `pipeline/.cache/last-report/<kind>.json` (compact, NOT
   pretty), overwritten every run — "last run from this command" semantics, mirroring join-outcomes.mjs's
   `.cache/last-weekly-report` marker. Gitignored (the whole `.cache/` tree is). `kind` = the report's own
   `kind` field ('screen'|'quote'|'watch'); screen accumulates its N per-niche reports into the ONE file
   per pass. Wrapped as `{kind, generatedAt, reports:[…]}` so a consumer reads a single predictable shape
   (`.reports[]` of render.mjs section objects) regardless of how many the pass produced. Best-effort:
   never throws (a dump-write failure must not break the read). Returns the repo-relative display path.
   PURE of side effects on import (only writes when CALLED), so it's safe in a test-imported entrypoint. --- */
const LAST_REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'last-report');
export function writeLastReport(kind, reports) {
  const payload = { kind, generatedAt: new Date().toISOString(), reports: Array.isArray(reports) ? reports : [reports] };
  try { mkdirSync(LAST_REPORT_DIR, { recursive: true }); writeFileSync(join(LAST_REPORT_DIR, kind + '.json'), JSON.stringify(payload)); }
  catch { /* dump is best-effort — a write failure never breaks the market read */ }
  return `pipeline/.cache/last-report/${kind}.json`;
}

/* --- parseArgs(argv): the `--flag value` / bare-`--flag` loop.
   argv = process.argv.slice(2). A bare flag (no value, or followed by another --flag)
   becomes `true`; otherwise the next token is its string value. Returns a plain object.
   (Was duplicated verbatim in screen-flip-niches.mjs + add-manual-fill.mjs.) --- */
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
   strips commas, honors k/m/b suffix.
   NOTE: deliberately NOT identical to js/money-format.js's parseGp (the app-form copy). This CLI
   copy accepts a leading '-' sign and ROUNDS a numeric passthrough (CLI args are strings/ints);
   the app copy instead accepts leading-dot decimals (".5m"), strips internal spaces, and passes
   a number through unrounded. Two homes on purpose — CLI arg parsing vs browser form input. --- */
export function parseGp(s) {
  if (typeof s === 'number') return Math.round(s);
  const t = String(s).trim().toLowerCase().replace(/,/g, '');
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return NaN;
  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

/* --- median(a): middle value of a numeric array (mean of the two middle values for an even
   length); null for an empty/absent array. The ONE copy — was byte-identical in screen-flip-niches.mjs
   (band medians) and join-outcomes.mjs (fill-time cells) (X1 dedup). Does not mutate its input. --- */
export const median = a => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* --- mdTable(headers, rows): generic markdown table (rows = array of cells). R7 (PLAN-VIZ-LAYER):
   this is a DELEGATE of the render layer — `pipeline/lib/render.mjs` `renderReport` calls mdTable for
   its `table` sections; the formatter stays here (avoids a churn-only move), render.mjs is the entry point.
   Generic on purpose — both consumers APPEND columns to the standard set (quote-items.mjs
   --positions adds Held@/Break-even/Verdict; screen-flip-niches.mjs adds Grade + the per-thesis Rank net·P/ttf), which is
   why quotecore's fixed-column quoteMarkdown() can't serve them. A cell may be a plain
   string OR a T1 structured `{t, c}` cell — cellText() renders the plain markdown text for
   either, so stdout stays colorless while the app keeps the class. --- */
export const mdTable = (headers, rows) =>
  ['| ' + headers.join(' | ') + ' |',
   '| ' + headers.map(() => '---').join(' | ') + ' |',
   ...rows.map(r => '| ' + r.map(cellText).join(' | ') + ' |')].join('\n');

/* --- stdCells(name, row): the standard QUOTE_HEADERS cells as an ORDERED ARRAY of structured
   `{t, c}` cells (T1), ready for mdTable (renders text) or the app publish path (keeps class),
   or to have extra columns appended. Wraps quotecore.quoteCells directly. --- */
export const stdCells = (name, row) => quoteCells(name, row);
