/**
 * render.mjs — the ONE render layer between the pipeline's DATA and the READER (PLAN-VIZ-LAYER).
 *
 * WHY THIS EXISTS. The three market-read scripts (watch-positions / quote-items / screen-flip-niches)
 * each hand-formatted their own console output, smearing three concerns into one pass: DATA (facts:
 * quotes, verdicts, fired gates, notes), VISUALIZATION (markdown tables / formatted text), and
 * INTERPRETATION (the judgment the reader layers on top). Because there was no single render path, the
 * same fact rendered differently per script and drifted (the headline-vs-table verdict mismatch, the
 * hand-built table vs mdTable, the flat untyped lines[]). This module is the VISUALIZATION layer: a
 * script computes ONE plain, JSON-serializable "report object" beside its existing compute, and
 * `renderReport()` turns it into markdown/console text. It decides NOTHING and computes NO numbers —
 * it only formats already-computed facts (the emit.mjs `heldNoteBlock` discipline, generalized).
 *
 * THE REPORT OBJECT (R4 — structured data is the source of truth; never re-parsed text):
 *   {
 *     kind: 'watch' | 'quote' | 'screen',   // which script produced it
 *     generatedAt: <string>,                // the local wall-clock stamp the script already built
 *     sections: [                           // rendered IN ORDER, each by its typed section renderer
 *       { type: 'headline', text }                       // one banner line (no leading blank)
 *       { type: 'alerts', pre?, items:[{level,msg}], post? }  // '  ⚠ msg' per item, no leading blank
 *       { type: 'table', headers, rows }                 // mdTable(headers, rows), preceded by a blank
 *       { type: 'lines', lines, blank? }                 // verbatim lines (brief book, summary, …)
 *       { type: 'notes', items, blank? }                 // already-formatted note lines (V5 blocks)
 *     ]
 *   }
 *   Cells in a `table` row are T1 structured `{t,c,title}` cells OR plain strings — mdTable renders
 *   either to plain markdown text (cellText), so stdout stays colorless while the app keeps the class.
 *
 * DELEGATION (R7 — one conceptual home, existing formatters stay put as delegates): the section
 * renderers DELEGATE to the existing pure formatters rather than duplicate them —
 *   - tables  → mdTable (pipeline/lib/cli.mjs), whose rows come from stdCells/quoteCells (js/quotecore.js)
 *   - held note blocks → heldNoteBlock (pipeline/lib/emit.mjs)
 *   - held verdicts / path lines / stale-book banner → renderHeldVerdict / renderPathLine /
 *     staleBookBanner (pipeline/lib/item-context.mjs)
 * render.mjs is the entry point; those files each cross-reference it in their header.
 *
 * BLANK-LINE CONTRACT (byte-identity). The pre-layer scripts emitted their output as a sequence of
 * console.log() calls; some carried an explicit leading '\n' (a blank line before the table / notes /
 * summary). `renderReport` reproduces that EXACTLY: `headline` and `alerts` render with no leading
 * blank (they follow directly); `table` / `notes` (when non-empty) / a `lines` section with `blank:true`
 * render a single leading blank line. `renderReport` returns ONE string (sections' line-arrays joined
 * by '\n') meant to be printed with ONE console.log — byte-identical to the old console.log sequence.
 *
 * STAGE-2 SEAM (R6, noted not built): because a report object is plain JSON, a later chunk can write it
 * to a root artifact (the screen.json pattern) and an app module can render it with an HTML
 * section-renderer instead of this markdown one. So: never put pre-rendered markdown as the ONLY
 * representation of a structured fact, never bake console widths/ANSI into cells, and keep render.mjs
 * pipeline-only (the SHAPE is the cross-surface contract, not this file).
 *
 * PURE: no fetch, no fs, no clock. Consumers: watch-positions.mjs (VZ1). quote-items.mjs and
 * screen-flip-niches.mjs join in later chunks. Fixture-pinned by pipeline/test/render.test.mjs.
 */
import { mdTable } from './cli.mjs';

/* --- SURFACING-TIER REGISTRY (R10 — TRACKING label, NOT a render/relay gate) -------------------
   Every note kind carries a tier so a later iteration pass can see which kinds are actually read vs
   skipped over sessions. Per Ben's 2026-07-16 ruling, `core` AND `context` both render AND relay by
   default — there is no default-hidden middle tier. `shadow` data never enters a report object at all
   (it rides suggestions.jsonl, unrendered). A wrong tier label therefore hides nothing; it only
   mis-tracks which section a future evidence-based demote-to-shadow decision would target. This is a
   placeholder registry (populated fully as VZ3/VZ4 route their note kinds through here); a note kind
   with no entry defaults to 'context' (shown), never silently dropped. */
export const TIER = { core: 'core', context: 'context', shadow: 'shadow' };

/* --- section renderers: each returns string[] (the lines it contributes) ---------------------- */

function renderHeadline(s) {
  return [s.text];
}

function renderAlerts(s) {
  const out = [];
  if (s.pre && s.pre.length) out.push(...s.pre);
  for (const a of (s.items || [])) out.push(`  ⚠ ${a.msg}`);
  if (s.post && s.post.length) out.push(...s.post);
  return out;
}

function renderTable(s) {
  // A leading blank line separates the table from what precedes it (the old '\n| …' console.log).
  return ['', ...mdTable(s.headers, s.rows).split('\n')];
}

function renderLines(s) {
  const lines = s.lines || [];
  return s.blank ? ['', ...lines] : [...lines];
}

function renderNotes(s) {
  const items = s.items || [];
  if (!items.length) return [];
  return s.blank === false ? [...items] : ['', ...items];
}

const RENDERERS = {
  headline: renderHeadline,
  alerts: renderAlerts,
  table: renderTable,
  lines: renderLines,
  notes: renderNotes,
};

/* renderReport(report) — the ONE entry point. Renders each section by its type and joins the whole
   report into a single string (sections' line-arrays concatenated, joined by '\n'). Print it with ONE
   console.log to reproduce the old console.log sequence byte-for-byte. Unknown section types throw —
   a typo in a builder is a defect, not a silent drop. */
export function renderReport(report) {
  const out = [];
  for (const s of (report && report.sections) || []) {
    const r = RENDERERS[s.type];
    if (!r) throw new Error(`render.mjs: unknown section type '${s && s.type}'`);
    out.push(...r(s));
  }
  return out.join('\n');
}
