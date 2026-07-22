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
 *       { type: 'table', headers, rows, blank? }         // mdTable(headers, rows); leading blank unless blank:false
 *       { type: 'lines', lines, blank? }                 // verbatim lines (brief book, summary, …)
 *       { type: 'notes', items, blank?, keepEmpty? }     // note items — strings OR typed {kind,tier,itemId,data,text}
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
 * STAGE-2 SEAM (R6, now EXERCISED by AO1): because a report object is plain JSON, a consumer can write it
 * out and re-render it elsewhere. Two live consumers now do: renderHtmlTable below (the app's Scan tab,
 * from screen.json) and AO1's `writeLastReport` (pipeline/lib/cli.mjs), which dumps the exact report
 * object(s) each of the three market-read CLIs builds to pipeline/.cache/last-report/<kind>.json for an
 * agent read (the `--quiet` path). So: never put pre-rendered markdown as the ONLY representation of a
 * structured fact, never bake console widths/ANSI into cells, and keep render.mjs pipeline-only (the SHAPE
 * is the cross-surface contract, not this file).
 *
 * PURE: no fetch, no fs, no clock. Consumers: watch-positions.mjs (VZ1). quote-items.mjs and
 * screen-flip-niches.mjs join in later chunks. Fixture-pinned by pipeline/test/render.test.mjs.
 */
import { mdTable } from './cli.mjs';
import { gradeCls, fmtP } from '../../js/money-format.js';

/* --- SURFACING-TIER REGISTRY (R10 — TRACKING label, NOT a render/relay gate; VZ5 = the ONE registry) --
   Every note kind carries a tier so a later iteration pass can see which kinds are actually read vs
   skipped over sessions. Per Ben's 2026-07-16 ruling, `core` AND `context` both render AND relay by
   default — there is no default-hidden middle tier. `shadow` data never enters a report object at all
   (it rides suggestions.jsonl, unrendered). A wrong tier label therefore hides nothing; it only
   mis-tracks which section a future evidence-based demote-to-shadow decision would target. A note kind
   with no entry defaults to 'context' (shown), never silently dropped.

   THE TIER ASSIGNMENTS (R10 defaults — the encoded half of VZ5; the relay rules are the judgment half,
   in the four SKILL.md files). Both `core` and `context` render AND relay — the split is TRACKING only:
     core    = the decision surface an operator must always see: a held-lot verdict / list-at, an
               alert (headline + the `alerts` section, watch), the WATCHLIST niche, and the V5
               guaranteed held-note fields (emit.mjs `heldNoteBlock`). Also `regime` + `validator`
               (a fired gate flag) below — a screen/quote row's regime line + any REJECT/CAUTION note.
     context = every inform-only family: diurnal, forecast, ask-headroom, asym, window-clear,
               reach-relief, pressure-exit, guide-anchor, stale-exit, reach-placement, window-exit, and screen's footer inform
               families (caution / trajectory-reach / headroom / window-clear / asym / demand — those
               ride as PRE-FORMATTED strings, not typed kinds, so they carry no NOTE_KINDS entry; their
               tier is context by this doctrine). Rendered + relayed by default, same as core.
     shadow  = never entered a report object: suggestions.jsonl analytics fields (estBuy/estSell/
               reachable/depthExit/asym/winClear/…). Unrendered today, unchanged by this plan.
   A note kind only moves toward shadow (log-only) once real sessions evidence it's consistently
   unused — a separate future ruling (see PLAN honesty note), never speculatively upfront. */
export const TIER = { core: 'core', context: 'context', shadow: 'shadow' };

/* NOTE_KINDS — the ONE registry of every typed note kind a report object can carry (VZ3 onward). For
   each kind: `prefix` is the leading whitespace+sigil that used to be hand-written at the push site
   (moved here so the kind stops being a string prefix — the note item now carries {kind,text} and the
   FORMATTER owns the sigil); `tier` is the R10 tracking label (core/context — both render AND relay,
   the label never gates). A kind with no entry renders with an empty prefix and defaults to 'context'
   (shown), never dropped. quote-items.mjs (VZ3) is the first consumer; screen (VZ4) extends this. */
export const NOTE_KINDS = {
  regime:       { prefix: '',      tier: TIER.core },     // the per-item regime line (already '- name: …')
  guideAnchor:  { prefix: '  ',    tier: TIER.context },  // YP1 guide-anchor advisory (already indented)
  validator:    { prefix: '  ⚠ ',  tier: TIER.core },     // a fired P2/P3 validator flag (annotates, never hides)
  staleLive:    { prefix: '  ⚠ ',  tier: TIER.core },     // QUICK_FRESH_MIN — a displayed live instabuy/instasell that's an old /latest print, not a live tick (the 64-min godsword anchor)
  staleExit:    { prefix: '  ⚠ ',  tier: TIER.context },  // Proposal C stale declared-exit flag (inform)
  diurnal:      { prefix: '  ↳ ',  tier: TIER.context },  // COD-4 diurnal BID/ASK timing
  forecast:     { prefix: '  ℹ ',  tier: TIER.context },  // PF1 buyable/sellable-in-~Xh forecast
  windowClear:  { prefix: '  ℹ ',  tier: TIER.context },  // PLAN-WINDOW-CLEAR days-reach ≠ lap-clear
  askHeadroom:  { prefix: '  ⤴ ',  tier: TIER.context },  // Bar-E ask-headroom / list-is-a-floor ladder
  asym:         { prefix: '  ◆ ',  tier: TIER.context },  // PART II asym deep-bid/high-reach-ask read
  reachRelief:  { prefix: '  ↥ ',  tier: TIER.context },  // PLAN-LIQUIDITY-REACH reach-fold relief
  pressureExit: { prefix: '  ◇ ',  tier: TIER.context },  // PB4 pressure-exit TRIAL line (opt-in flag)
  reachPlacement: { prefix: '  ⊙ ', tier: TIER.context }, // PLAN-QUOTE-PLACEMENT — the read-window-range.mjs placement percentile folded onto the quote
  trajectory:   { prefix: '  ⌁ ',  tier: TIER.context }, // the multi-day shape read (trajectoryRead) folded onto the quote (fang under-read fix); the DAILY TRAJECTORY rows above it ride as plain strings (V5-block pattern)
  fcTrack:      { prefix: '  ⇅ ',  tier: TIER.context }, // PLAN-DRIFT-VS-CRASH — the phase-aligned floor/ceiling slope-asymmetry + floor-break read (floorCeilingTrack), folded directly under the trajectory read
  windowExit:   { prefix: '  ↗ ',  tier: TIER.context },  // PLAN-POSITIONS-WINDOW-READ — the auto-surfaced ask-side typical-exit read on a big-ticket held lot (read-window-range.mjs --ask, folded in)
};

/* formatNote(item) — render ONE note item to its line. A plain string passes through UNCHANGED (the V5
   held-note-block items + the watch report's pre-formatted notes stay byte-identical); a typed item
   `{kind,text}` gets its kind's prefix prepended (the sigil that used to live at the push site). An
   unknown kind renders with no prefix (fail-open: show the text, never drop a fact). */
export function formatNote(item) {
  if (typeof item === 'string') return item;
  if (!item) return '';
  const spec = NOTE_KINDS[item.kind];
  return (spec ? spec.prefix : '') + (item.text ?? '');
}

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
  // A leading blank line separates the table from what precedes it (the old '\n| …' console.log) —
  // UNLESS blank:false, for a table that is the first thing printed (quote-items, VZ3) with nothing
  // above it to separate from.
  const body = mdTable(s.headers, s.rows).split('\n');
  return s.blank === false ? body : ['', ...body];
}

function renderLines(s) {
  const lines = s.lines || [];
  return s.blank ? ['', ...lines] : [...lines];
}

/* renderNotes — note items (strings OR typed {kind,text}) formatted via formatNote. blank:true (default)
   prepends a leading blank line; blank:false renders flush. keepEmpty:true reproduces the pre-VZ3
   quote-items pattern where the notes block was TWO unconditional console.log calls (a blank then the
   joined lines, both printed even with zero notes) → ['',''] for an empty block; without it an empty
   block contributes nothing (the watch/V5 contract — no notes ⇒ no block). */
function renderNotes(s) {
  const items = (s.items || []).map(formatNote);
  if (!items.length) {
    if (!s.keepEmpty) return [];
    return s.blank === false ? [''] : ['', ''];
  }
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

/* --- renderHtmlTable(headers, rows): the STAGE-2 SEAM, now built (Ben, 2026-07-16 — "make it app
   only... it should encode HTML tables for the app to display in the scan tab"). Pipeline-side twin
   of js/ui.js's client-side `scanTableHtml`/`scanPressureCell` — same T1 `{t,c,title}` cell shape,
   same markup, so screen.json can carry a PRE-RENDERED `html` string per niche and the app just
   injects it (`.innerHTML =`) instead of re-deriving HTML from raw cells client-side. This does NOT
   replace the `cells` data in screen.json (kept for back-compat / any other consumer) — `html` is an
   ADDITIVE sibling field. A console box-drawing table (an earlier same-session prototype in
   `pipeline/lib/cli.mjs` `consoleTable`/`consoleCards`) was explicitly ruled OUT as a dead end for
   this surface — the app is the one and only target for this renderer, never a bare terminal. Kept
   BYTE-IDENTICAL in shape to the client version deliberately (a visual diff between the two would be
   a regression, not a style choice) — if `js/ui.js`'s `scanTableHtml` ever changes, mirror the change
   here too (cross-pointer in both files' headers). --- */
const scText = c => (c && typeof c === 'object' && 't' in c) ? c.t : c;
const scCls = c => (c && typeof c === 'object' && c.c) ? c.c : '';
const scTitle = c => (c && typeof c === 'object' && c.title) ? c.title : '';
const htmlAttr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const htmlPressureCell = rb => {
  if (!rb || rb.ask == null || rb.bid == null) return '<td class="pressure-trial"></td>';
  const rel = (typeof rb.reliability === 'number') ? rb.reliability : null, low = rel != null && rel < 0.5;
  const px = (typeof rb.pressure === 'number') ? rb.pressure.toFixed(1) + '×' : '?';
  const ttl = 'pressure ' + px + (rel != null ? ', reliability ' + rel.toFixed(2) : '') + ' — deep reachable bid → bold reachable ask; TRIAL, un-calibrated (n≈0). The Optimistic column is the conservative reference.';
  return '<td class="pressure-trial' + (low ? ' pthin' : '') + '" title="' + htmlAttr(ttl) + '">' + fmtP(rb.bid) + ' → ' + fmtP(rb.ask) +
    ' <span class="pmeta">' + px + (low ? ' ⚠thin' : '') + '</span></td>';
};
export function renderHtmlTable(headers, rows) {
  if (!rows || !rows.length) return '<div class="scannone">— none —</div>';
  const hasP = rows.some(r => r.reachable && r.reachable.ask != null);
  const head = '<thead><tr>' + headers.map((h, i) => '<th' + (i === 0 ? ' class="left"' : '') + '>' + h + '</th>').join('') +
    (hasP ? '<th class="pcol" title="Pressure-driven reachable band (deep bid → bold ask) — a TRIAL, un-calibrated demand read (n≈0), NOT the ranked/graded decision. The neutral Optimistic column is the conservative reference.">Pressure <span class="ptrial">(trial)</span></th>' : '') + '</tr></thead>';
  const body = '<tbody>' + rows.map(r => { const cells = r.cells || [];
    const tds = cells.map((c, i) => {
      const ttl = scTitle(c), t = ttl ? ' title="' + htmlAttr(ttl) + '"' : '';
      if (i === 0) return '<td class="left"><span class="linkname" data-trend="' + r.id + '">' + scText(c) + '</span></td>';
      if (headers[i] === 'Grade') { const g = scText(c); return '<td' + t + '><span class="grade ' + gradeCls(g) + '"' + (ttl ? ' title="' + htmlAttr(ttl) + '"' : '') + '>' + g + '</span>' + (ttl ? '<span class="thinflag" title="' + htmlAttr(ttl) + '">thin</span>' : '') + '</td>'; }
      return '<td class="' + scCls(c) + '"' + t + '>' + scText(c) + '</td>';
    }).join('');
    return '<tr>' + tds + (hasP ? htmlPressureCell(r.reachable) : '') + '</tr>'; }).join('') + '</tbody>';
  return '<div class="tablewrap"><table class="scantable">' + head + body + '</table></div>';
}
