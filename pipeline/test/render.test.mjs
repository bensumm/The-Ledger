#!/usr/bin/env node
/**
 * render.test.mjs — the PLAN-VIZ-LAYER render layer (pipeline/lib/render.mjs) + the watch report object.
 *
 * VZ1 is a MECHANICAL, byte-identical move: watch-positions.mjs's output pass now builds a plain
 * report object (buildWatchReport) and prints it ONCE via renderReport, instead of a sequence of
 * inline console.log calls. This pins that the rendered string is byte-for-byte the SAME as the
 * pre-VZ1 console.log sequence, over a fixture that exercises every section type (headline, alerts +
 * pressure-exit/freed/blind sub-lines, table via mdTable, notes, summary) and the --brief branch.
 *
 * The expected strings below reproduce the EXACT old console.log format (the golden), so a future
 * edit that drifts the render away from the pre-VZ1 output fails here. No live fetch — pure fixtures.
 *
 * Run: `node pipeline/test/render.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { renderReport, formatNote, NOTE_KINDS } from '../lib/render.mjs';
import { buildWatchReport } from '../commands/watch-positions.mjs';
import { buildQuoteReport } from '../commands/quote-items.mjs';
import { buildScreenNicheReport } from '../commands/screen-flip-niches.mjs';
import { mdTable } from '../lib/cli.mjs';
import { quoteCells as canonicalQuoteCells, cellText } from '../../js/quotecore.js';
import { formatTimedLap } from '../lib/emit.mjs';   // PLAN-DIURNAL-TIMING DT2

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

/* The GOLDEN reproduction of the pre-VZ1 console.log sequence for the watch output pass. This is the
   exact ordering + blank-line contract the old inline code emitted; renderReport must match it. */
function preVZ1Golden({ headline, pressureExitWarning, alerts, freedLine, blindLine,
  brief, briefLines, tableHeaders, tableRows, notes, summaryLines }) {
  const L = [];
  L.push(headline);                                       // console.log(headline)
  if (pressureExitWarning) L.push(pressureExitWarning);   // console.log(pressure-exit warning)
  for (const a of alerts) L.push(`  ⚠ ${a.msg}`);         // for … console.log('  ⚠ ' + msg)
  if (freedLine) L.push(freedLine);                       // console.log(freed) — already prefixed
  if (blindLine) L.push(blindLine);                       // console.log(blind) — already prefixed
  if (brief) {
    L.push('');                                           // console.log('')
    for (const b of briefLines) L.push(b);
  } else {
    L.push('\n| ' + tableHeaders.join(' | ') + ' |');     // console.log('\n| … |')
    L.push('| ' + tableHeaders.map(() => '---').join(' | ') + ' |');
    for (const r of tableRows) L.push(`| ${r.join(' | ')} |`);
    if (notes.length) { L.push(''); for (const n of notes) L.push(n); }
  }
  L.push('\n=== SUMMARY ===');                            // console.log('\n=== SUMMARY ===')
  for (const s of summaryLines.slice(1)) L.push(s);       // summaryLines[0] is '=== SUMMARY ==='
  return L.join('\n');
}

/* --- a rich fixture: alerts + pressure-exit + freed + blind + table (held/orphan/bid/target) + notes */
const rich = {
  headline: '# watch 2026-07-16 07:00 — ⚠ 2 ALERTS · 1 held · 1 bid · 1 unbooked ask · 1 target',
  pressureExitWarning: '⚠ --pressure-exit: held list-at uses the UN-CALIBRATED pressure model (TRIAL; retro still scoring — not validated). The depth floor renders beside as the conservative reference.',
  alerts: [
    { level: 'CUT', msg: 'CUT Water orb @ 190 — 2h breakdown & underwater; free the capital.' },
    { level: 'UNDERWATER', msg: 'UNDERWATER Dragon bones — live sell 2,450 < break-even 2,500.' },
  ],
  freedLine: '  ⋯ freed ~1.20m this pass — consider a scan to redeploy (1 lot sold since last pass)',
  blindLine: '  ⚠ restart-blind: stale log, held inventory but no visible offers',
  brief: false,
  briefLines: [],
  tableHeaders: ['Verdict', 'Item', 'Position', 'Quick', 'Optimistic', 'Vol/d', 'Mom', 'Regime', 'Break-even'],
  tableRows: [
    ['HOLD — list @ 210', 'Water orb', '×1000 @ 185 · ask 0/1000 @ 210', '188 → 190', '186 → 212', '3.4m/d', '–', 'Flat +0%', '189'],
    ['UNBOOKED-ASK', 'Cannonball', 'ask 5000/20000 @ 205', '—', '—', '—', '—', '—', '—'],
    ['BID-OK', 'Nature rune', 'bid 0/5000 @ 95', '96 → 100', '94 → 102', '8.1m/d', '↑', 'Rising +2%', '98'],
    ['BUY', 'Ranarr weed', 'watched', '7,100 → 7,300', '7,000 → 7,450', '210k/d', '–', 'Flat +0%', '7,242'],
  ],
  notes: [
    '- Water orb: HOLD — list @ 210 (break-even-floored). · window ask 210 reached 3/7d',
    '    sell: list @ 210 · break-even 189 · ask 0/1000 @ 210',
    '- Nature rune bid @ 95: BID-OK — resting inside the band. · window bid 95 touched 4/7d',
  ],
  summaryLines: [
    '=== SUMMARY ===',
    '  held exposure 185.00k (1 lot, 1 listed) · bid capital 475.00k (1 offer) · capital 28% working / 72% parked · ⚠ 2 alerts need action',
    '  held basis positions.json 4m old · offer basis live log, newest line 1m ago',
    '  loop /loop 1m node pipeline/commands/watch-positions.mjs  (tightest cadence across 4 items)',
    '  READ-ONLY decision support — exit at entry · never a stranded ask · cut on breakdown, not hope · you place every offer.',
  ],
};

ok('watch: the full table+notes report renders byte-identical to the pre-VZ1 console.log sequence', () => {
  const report = buildWatchReport({ generatedAt: '2026-07-16 07:00', ...rich });
  assert.equal(renderReport(report), preVZ1Golden(rich));
});

ok('watch: the table goes through mdTable (header + --- separator + one row per tableRow)', () => {
  const out = renderReport(buildWatchReport({ generatedAt: 'x', ...rich }));
  assert.ok(out.includes('\n| Verdict | Item | Position | Quick | Optimistic | Vol/d | Mom | Regime | Break-even |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'));
  assert.ok(out.includes('| HOLD — list @ 210 | Water orb | ×1000 @ 185 · ask 0/1000 @ 210 | 188 → 190 | 186 → 212 | 3.4m/d | – | Flat +0% | 189 |'));
});

/* --- the --brief branch: table + notes are skipped; the compact book renders instead ------------ */
const briefFix = {
  ...rich,
  headline: '# watch 2026-07-16 07:00 — all quiet · 1 held',
  pressureExitWarning: null,
  alerts: [],
  freedLine: null,
  blindLine: null,
  brief: true,
  briefLines: [
    'HOLD  Water orb   ×1000 @ 185   list @ 210 (BE 189)',
  ],
  notes: [],
};

ok('watch --brief: headline+alerts+summary still render; table/notes skipped, brief book shown', () => {
  const report = buildWatchReport({ generatedAt: '2026-07-16 07:00', ...briefFix });
  assert.equal(renderReport(report), preVZ1Golden(briefFix));
});

/* --- minimal: headline + empty alerts + empty table + no notes (all quiet, empty board) --------- */
const minimal = {
  headline: '# watch 2026-07-16 07:00 — all quiet · empty board',
  pressureExitWarning: null, alerts: [], freedLine: null, blindLine: null,
  brief: false, briefLines: [],
  tableHeaders: rich.tableHeaders, tableRows: [], notes: [],
  summaryLines: ['=== SUMMARY ===', '  no alerts',
    '  loop /loop 3m node pipeline/commands/watch-positions.mjs  (tightest cadence across 0 items)',
    '  READ-ONLY decision support — exit at entry · never a stranded ask · cut on breakdown, not hope · you place every offer.'],
};

ok('watch: an all-quiet empty board renders header+separator table (no rows) and no notes block', () => {
  const report = buildWatchReport({ generatedAt: '2026-07-16 07:00', ...minimal });
  assert.equal(renderReport(report), preVZ1Golden(minimal));
});

/* --- VZ2b: the watch table's Quick/Optimistic cells adopt the CANONICAL composite (buy → sell · +net
   (roi)) — the SAME cell helper (js/quotecore.js quoteCells → cellText, indices 2/3) the watch row
   builder now calls. Pins the exact cell format the watch table changed to (R8 visible change). */
ok('VZ2b: the canonical Quick/Optimistic cells render "buy → sell · +net (roi)" (net/roi included)', () => {
  const row = { guide: null, quickBuy: 2421, quickSell: 2490, quickNet: 20, quickRoi: 0.8,
    optBuy: 2401, optSell: 2499, optNet: 49, optRoi: 2.0, mom: 'clean', momPct: null,
    volDay: 661500, regime: { ok: false }, regimeLabel: '' };
  const c = canonicalQuoteCells('', row);
  assert.equal(cellText(c[2]), '2,421 → 2,490 · +20 (+0.8%)');   // Quick
  assert.equal(cellText(c[3]), '2,401 → 2,499 · +49 (+2.0%)');   // Optimistic
});

/* ============================================================================================
   VZ3 — quote-items.mjs onto the report path. buildQuoteReport builds a report object (both modes);
   the flat lines[] is now typed note items whose per-kind sigil lives in render.mjs's formatNote
   (NOTE_KINDS). These goldens reconstruct the EXACT pre-VZ3 console.log sequence and pin that
   renderReport(buildQuoteReport(fixture)) is byte-for-byte identical to it. The `noteStrings` a golden
   is fed are the OLD full sigil-prefixed lines (hand-written), so a match ALSO proves formatNote's
   prefix map reproduces the pre-VZ3 wording exactly (the sigil truly only moved, it didn't change).
   ============================================================================================ */

/* GOLDEN: the pre-VZ3 items-mode console.log sequence.
   (opt pressure banner+'\n') · mdTable · (opt Est. explainer) · '' · notes.join('\n')  — each was its
   own console.log; the single renderReport string is those contents joined by '\n'. */
function preVZ3ItemsGolden({ pressureBanner, headers, rows, estExplainer, noteStrings }) {
  const L = [];
  if (pressureBanner) L.push(pressureBanner + '\n');
  L.push(mdTable(headers, rows));
  if (estExplainer) L.push(estExplainer);
  L.push('');
  L.push(noteStrings.join('\n'));
  return L.join('\n');
}

/* GOLDEN: the pre-VZ3 positions-mode console.log sequence.
   header(+'\n') · (opt banner+'\n') · staleBanner+'\n' · mdTable · '' · notes.join('\n') ·
   (opt '' 'Conviction …:' conv.join) · (paths) · (rebid) · (opt '' lateNightLine). */
function preVZ3PositionsGolden({ header, pressureBanner, staleBanner, headers, rows, noteStrings,
  convLines = [], pathLines = [], rebidLines = [], lateNightLine = null }) {
  const L = [header];
  if (pressureBanner) L.push(pressureBanner + '\n');
  L.push(staleBanner + '\n');
  L.push(mdTable(headers, rows));
  L.push('');
  L.push(noteStrings.join('\n'));
  if (convLines.length) { L.push(''); L.push('Conviction (shared watch-state):'); L.push(convLines.join('\n')); }
  if (pathLines.length) { L.push(''); L.push('Paths (persistence-gated dominant per held lot — decision support, placeholder weights):'); L.push(pathLines.join('\n')); }
  if (rebidLines.length) { L.push(''); L.push('Rebid advisory (cut-and-rebid friction bar + multi-week trajectory — support, never overrides the verdict):'); L.push(rebidLines.join('\n')); }
  if (lateNightLine) { L.push(''); L.push(lateNightLine); }
  return L.join('\n');
}

/* Typed items → the OLD full-line strings, so both halves of the golden come from ONE source of truth.
   Each pair is [typedNote, expectedOldLine]; expectedOldLine hand-carries the pre-VZ3 sigil. */
const ITEMS_NOTE_PAIRS = [
  [{ kind: 'regime', text: '- Nature rune: regime rising +6.6% (3d vs prior ~2wk median) · buy limit 18,000/4h · pressure buy 1.4× (hpv 11.05m / lpv 8.01m)' },
    '- Nature rune: regime rising +6.6% (3d vs prior ~2wk median) · buy limit 18,000/4h · pressure buy 1.4× (hpv 11.05m / lpv 8.01m)'],
  [{ kind: 'guideAnchor', text: 'guide anchor: model advisory line' }, '  guide anchor: model advisory line'],
  [{ kind: 'validator', text: 'reach: ask 141 reached only 1/14d' }, '  ⚠ reach: ask 141 reached only 1/14d'],
  [{ kind: 'diurnal', text: 'diurnal: BID 137 (live, dip 00:00–06:00) · ASK 141 (peak 20:00–00:00) · ~2/u (1.5%)' },
    '  ↳ diurnal: BID 137 (live, dip 00:00–06:00) · ASK 141 (peak 20:00–00:00) · ~2/u (1.5%)'],
  [{ kind: 'forecast', text: 'forecast: not profitably buyable now (live 139 > ~138 to clear BE at 141) → buyable ~8h (00:00)' },
    '  ℹ forecast: not profitably buyable now (live 139 > ~138 to clear BE at 141) → buyable ~8h (00:00)'],
  [{ kind: 'askHeadroom', text: 'ask headroom: robust p90 shaved a traded in-band top — ladder up' },
    '  ⤴ ask headroom: robust p90 shaved a traded in-band top — ladder up'],
  [{ kind: 'asym', text: 'asym fill: deep-bid 127 (fills ~5/14d — rest as optionality) → ask 140 (prints ~12/14d) · net 11/u (8.7%) (placeholder quantiles, n≈14)' },
    '  ◆ asym fill: deep-bid 127 (fills ~5/14d — rest as optionality) → ask 140 (prints ~12/14d) · net 11/u (8.7%) (placeholder quantiles, n≈14)'],
  [{ kind: 'windowClear', text: 'window-clear: ask 141 prints 2/14 in the 20:00–00:00 peak window — days-reach ≠ lap-clear (placeholder, n≈0)' },
    '  ℹ window-clear: ask 141 prints 2/14 in the 20:00–00:00 peak window — days-reach ≠ lap-clear (placeholder, n≈0)'],
  [{ kind: 'reachRelief', text: 'reach relief: liquid book (8.01m/d, buy limit ~0.2% of flow) softens the ask-reach fold 75% (PLACEHOLDER, n=1)' },
    '  ↥ reach relief: liquid book (8.01m/d, buy limit ~0.2% of flow) softens the ask-reach fold 75% (PLACEHOLDER, n=1)'],
  [{ kind: 'pressureExit', text: 'depth floor 138 · reachable 141 for ×10000' },
    '  ◇ depth floor 138 · reachable 141 for ×10000'],
];

const itemsHeaders = ['Item', 'Guide', 'Est. buy', 'Est. sell', 'Net/u (ROI)', 'BE', 'Vol/d', 'Momentum', 'Regime', 'Probes'];
const itemsRows = [['Nature rune', '139', '137 (3/3)', '141 (1/3)', '+2 (+1.5%)', '140', '8.01m/d', '–', 'Rising +7%', '📈froth healthy-reprice']];
const ITEMS_EXPLAINER = '(Est. buy/sell are ESTIMATES — … --raw restores the model-free Quick/Optimistic columns.)';

ok('VZ3 items: report renders byte-identical to the pre-VZ3 console.log sequence (non-RAW, probe col)', () => {
  const notes = ITEMS_NOTE_PAIRS.map(p => p[0]);
  const noteStrings = ITEMS_NOTE_PAIRS.map(p => p[1]);
  const report = buildQuoteReport({ mode: 'items', headers: itemsHeaders, rows: itemsRows, estExplainer: ITEMS_EXPLAINER, notes });
  assert.equal(renderReport(report), preVZ3ItemsGolden({ pressureBanner: null, headers: itemsHeaders, rows: itemsRows, estExplainer: ITEMS_EXPLAINER, noteStrings }));
});

ok('VZ3 items --raw: no Est. explainer line; table then notes still byte-identical', () => {
  const rawHeaders = ['Item', 'Guide', 'Quick', 'Optimistic', 'Vol/d', 'Momentum', 'Regime'];
  const rawRows = [['Nature rune', '139', '137 → 140 · +1 (+0.7%)', '137 → 141 · +2 (+1.5%)', '8.01m/d', '–', 'Rising +7%']];
  const notes = ITEMS_NOTE_PAIRS.map(p => p[0]);
  const noteStrings = ITEMS_NOTE_PAIRS.map(p => p[1]);
  const report = buildQuoteReport({ mode: 'items', headers: rawHeaders, rows: rawRows, estExplainer: null, notes });
  assert.equal(renderReport(report), preVZ3ItemsGolden({ pressureBanner: null, headers: rawHeaders, rows: rawRows, estExplainer: null, noteStrings }));
});

ok('VZ3 items: --pressure-exit banner rides on top, byte-identical', () => {
  const banner = '⚠ --pressure-exit: Est. buy/sell + rank use the UN-CALIBRATED pressure model (TRIAL …).';
  const notes = ITEMS_NOTE_PAIRS.map(p => p[0]);
  const noteStrings = ITEMS_NOTE_PAIRS.map(p => p[1]);
  const report = buildQuoteReport({ mode: 'items', pressureBanner: banner, headers: itemsHeaders, rows: itemsRows, estExplainer: ITEMS_EXPLAINER, notes });
  assert.equal(renderReport(report), preVZ3ItemsGolden({ pressureBanner: banner, headers: itemsHeaders, rows: itemsRows, estExplainer: ITEMS_EXPLAINER, noteStrings }));
});

/* positions mode: header + stale banner + table + notes + the conviction/paths/rebid/late-night blocks */
const POS_NOTE_PAIRS = [
  [{ kind: 'regime', text: '- Raw anglerfish: regime rising +5.2% (3d vs prior ~2wk median) · buy limit 15,000/4h · pressure sell 1.5× (hpv 661.5k / lpv 968.6k)' },
    '- Raw anglerfish: regime rising +5.2% (3d vs prior ~2wk median) · buy limit 15,000/4h · pressure sell 1.5× (hpv 661.5k / lpv 968.6k)'],
  [{ kind: 'validator', text: 'Raw anglerfish reach: ask 2499 reached only 5/14d' }, '  ⚠ Raw anglerfish reach: ask 2499 reached only 5/14d'],
  [{ kind: 'staleExit', text: 'Raw anglerfish: declared exit 3,000 looks STALE on reach — inform-only.' },
    '  ⚠ Raw anglerfish: declared exit 3,000 looks STALE on reach — inform-only.'],
  [{ kind: 'askHeadroom', text: 'Raw anglerfish: ask headroom — ladder up' }, '  ⤴ Raw anglerfish: ask headroom — ladder up'],
];
const posHeaders = ['Item', 'Guide', 'Quick', 'Optimistic', 'Vol/d', 'Momentum', 'Regime', 'Held@', 'Break-even', 'Verdict'];
const posRows = [['Raw anglerfish ×10000', '2,501', '2,405 → 2,500 · +45 (+1.9%)', '2,401 → 2,500 · +49 (+2.0%)', '661.5k/d', '–', 'Rising +5%', '2,411', '2,461', 'PARKED — at break-even (±52) — list ≥ 2,461']];
const posHeader = '# Open positions vs market (1 items, 1 lots)\n';
const posStale = 'held basis positions.json 982m old ⚠ stale — re-sync before trusting the held count';

ok('VZ3 positions: full report (header+stale+table+notes+conviction+paths+rebid+late-night) byte-identical', () => {
  const notes = POS_NOTE_PAIRS.map(p => p[0]);
  const noteStrings = POS_NOTE_PAIRS.map(p => p[1]);
  const convLines = ['  Raw anglerfish: CUT-CANDIDATE armed — underwater ~40m; confirms once it persists ~30m.'];
  const pathLines = ['  Raw anglerfish: path hold-recovery 0.6 · menu: value-hold 0.6 (support, not a verdict — placeholder weights)'];
  const rebidLines = ['  Raw anglerfish: rebid at the diurnal trough & sell the daily peak'];
  const lateNightLine = 'ℹ Late-night: 1 held position(s) may be stale/underwater by morning — re-verdict at the morning liquid window (Raw anglerfish).';
  const report = buildQuoteReport({ mode: 'positions', header: posHeader, staleBanner: posStale, headers: posHeaders, rows: posRows, notes, convLines, pathLines, rebidLines, lateNightLine });
  assert.equal(renderReport(report), preVZ3PositionsGolden({ header: posHeader, pressureBanner: null, staleBanner: posStale, headers: posHeaders, rows: posRows, noteStrings, convLines, pathLines, rebidLines, lateNightLine }));
});

ok('VZ3 positions: minimal (no conviction/paths/rebid/late-night blocks) byte-identical', () => {
  const notes = POS_NOTE_PAIRS.map(p => p[0]);
  const noteStrings = POS_NOTE_PAIRS.map(p => p[1]);
  const report = buildQuoteReport({ mode: 'positions', header: posHeader, staleBanner: posStale, headers: posHeaders, rows: posRows, notes });
  assert.equal(renderReport(report), preVZ3PositionsGolden({ header: posHeader, pressureBanner: null, staleBanner: posStale, headers: posHeaders, rows: posRows, noteStrings }));
});

ok('VZ3: formatNote prepends the exact pre-VZ3 sigil per kind; a plain string passes through unchanged', () => {
  assert.equal(formatNote({ kind: 'validator', text: 'x: y' }), '  ⚠ x: y');
  assert.equal(formatNote({ kind: 'diurnal', text: 'diurnal: z' }), '  ↳ diurnal: z');
  assert.equal(formatNote({ kind: 'regime', text: '- A: b' }), '- A: b');   // regime prefix is empty
  assert.equal(formatNote('already formatted'), 'already formatted');       // V5/watch strings untouched
  assert.equal(formatNote({ kind: 'unknownKind', text: 'q' }), 'q');        // fail-open: no prefix, never drop
});

ok('VZ3: every note kind quote-items emits is registered in NOTE_KINDS (kinds-vs-registry)', () => {
  const emitted = ['regime', 'guideAnchor', 'validator', 'staleExit', 'diurnal', 'forecast', 'windowClear', 'askHeadroom', 'asym', 'reachRelief', 'pressureExit'];
  for (const k of emitted) assert.ok(NOTE_KINDS[k], `NOTE_KINDS missing kind '${k}'`);
});

/* ============================================================================================
   VZ4a — screen-flip-niches.mjs: a niche's header + table + footer notes build ONE screen-report
   (buildScreenNicheReport), printed via renderReport. Byte-identical mechanical move: every line was
   its own console.log with no inter-blank line. These goldens reconstruct that exact sequence.
   ============================================================================================ */

/* GOLDEN: the pre-VZ4a niche console.log sequence.
   headerLines… · (mdTable | '_none_') · (non-RAW+rows: Est. explainer) · footerLines…  — all flush,
   each was its own console.log; the single renderReport string is those contents joined by '\n'. */
function preVZ4aScreenGolden({ headerLines, table, estExplainer, footerLines, extraSections = [] }) {
  const L = [...headerLines];
  L.push(table ? mdTable(table.headers, table.rows) : '_none_');
  if (table && estExplainer) L.push(estExplainer);
  L.push(...footerLines);
  // VZ4b: extra sections (diurnal / accumulation / velocity / entry-paths / stats + trailing blank) were
  // each their own flush console.log(s); a 'table' extra renders via mdTable, a 'lines' extra renders flush.
  for (const s of extraSections) {
    if (s.type === 'table') L.push(mdTable(s.headers, s.rows));
    else L.push(...s.lines);
  }
  return L.join('\n');
}

const screenHeaders = ['Item', 'Guide', 'Est. buy', 'Est. sell', 'Net/u (ROI)', 'BE', 'Vol/d', 'Momentum', 'Regime', 'Grade', 'Rank net·P/ttf'];
const screenRows = [
  ['Cannonball', '205', '204 (2/3)', '210 (1/3)', '+4 (+2.0%)', '208', '9.2m/d', '↑', 'Rising +3%', 'B', '1.2m·0.6/40m'],
  ['Nature rune', '139', '137 (3/3)', '141 (1/3)', '+2 (+1.5%)', '140', '8.0m/d', '–', 'Flat +0%', 'C', '0.8m·0.5/55m'],
];
const screenHeader = ['## BAND — 2 rated (from 40 gated, top 12 fetched; fallers excluded)',
  'Playbook: bid the band floor, list the band top; the edge is the 2h reachable spread.',
  '(band basis: 2h, ≥6 traded windows any-side + two-sided; thin ≥3)'];
const screenExplainer = '(Est. buy/sell are ESTIMATES — … --raw restores the model-free Quick/Optimistic columns.)';
const screenFooter = ['Grades: A×0 B×1 C×1', 'rejected: 2 (floor×1, reach×1)',
  '⚠ caution — Dragon bones: reach ask 2500 reached only 3/14d',
  'ℹ trajectory/reach — Cannonball: floor would caution',
  '⤴ ask headroom — Nature rune: p90 shaved a traded top',
  'ℹ window-clear — Cannonball: prints 2/14 in peak window — days-reach ≠ lap-clear (placeholder, n≈0)',
  '◆ asym fill — Nature rune: deep-bid 127 → ask 140',
  '◈ demand — Cannonball: buy-heavy 1.8× — sell-into-demand'];

ok('VZ4a screen: normal niche (table + Est. explainer + footer notes) byte-identical to pre-VZ4a', () => {
  const parts = { headerLines: screenHeader, table: { headers: screenHeaders, rows: screenRows }, estExplainer: screenExplainer, footerLines: screenFooter };
  assert.equal(renderReport(buildScreenNicheReport(parts)), preVZ4aScreenGolden(parts));
});

ok('VZ4a screen --raw: no Est. explainer; table then footer still byte-identical', () => {
  const parts = { headerLines: screenHeader, table: { headers: screenHeaders, rows: screenRows }, estExplainer: null, footerLines: ['Grades: A×0 B×1 C×1'] };
  assert.equal(renderReport(buildScreenNicheReport(parts)), preVZ4aScreenGolden(parts));
});

ok('VZ4a screen: empty niche renders _none_ (no table, no explainer), header+grades byte-identical', () => {
  const parts = { headerLines: ['## BAND — 0 rated (from 0 gated, top 0 fetched; fallers excluded)'], table: null, estExplainer: null, footerLines: ['Grades: (none)'] };
  const out = renderReport(buildScreenNicheReport(parts));
  assert.equal(out, preVZ4aScreenGolden(parts));
  assert.ok(out.includes('_none_'));
});

ok('VZ4b screen: full niche with all loose info sections (diurnal/accumulation/velocity/paths/stats + trailing blank) byte-identical', () => {
  const accHeaders = ['#', 'Item', 'Bid', 'Ask (sell)', 'Up-to units/8h', 'Capital', 'Cum capital', 'Net/u', 'Total if cycled'];
  const accCells = [[{ t: '1' }, { t: 'Cannonball' }, { t: '204' }, { t: '210' }, { t: 'up to 5,000', c: 'mini' }, { t: '1.02m' }, { t: '1.02m', c: 'mini' }, { t: '+4', c: 'gain' }, { t: '+20k' }]];
  const extraSections = [
    { type: 'lines', blank: false, lines: ['Diurnal timing (peak-timing bid/ask off the in-hand 1h series — support, not a gate; ★ = clean diurnal candidate):', '  ↳ ★ Cannonball — BID 204 (live, dip 00:00–06:00) · ASK 210 (peak 20:00–00:00) · ~4/u (2.0%)'] },
    { type: 'lines', blank: false, lines: ['Overnight accumulation & capital (~8h span; …):'] },
    { type: 'table', blank: false, headers: accHeaders, rows: accCells },
    { type: 'lines', blank: false, lines: ['(Up-to units = min(buy limit × 2, …). Sell never below break-even.)'] },
    { type: 'lines', blank: false, lines: ['velocity (outcomes.json, 3h old; descriptive per-item history, not a rate): Cannonball fast'] },
    { type: 'lines', blank: false, lines: ['Entry paths (surfacing default `*` + weighed menu; support, not a gate — placeholder weights):', '  ↳ Cannonball — scalp* 0.60 · value-hold 0.60 · avoid 0.30'] },
    { type: 'lines', blank: false, lines: ['stats: gated 40 | fetched 12 | survivors 2 | yield 17% | discarded: falling 3, validator-reject 2, validator-caution 1, neg-net 0'] },
    { type: 'lines', blank: false, lines: [''] },   // trailing blank between niches
  ];
  const parts = { headerLines: screenHeader, table: { headers: screenHeaders, rows: screenRows }, estExplainer: screenExplainer, footerLines: screenFooter, extraSections };
  assert.equal(renderReport(buildScreenNicheReport(parts)), preVZ4aScreenGolden(parts));
});

ok('VZ4a screen: sub-floor 3-line header renders in order, byte-identical', () => {
  const parts = {
    headerLines: ['## CHURN — SUB-FLOOR FALLBACK — 0 candidates cleared the configured floors',
      '⚠ liquidity floor relaxed to 250k/d. Best 5 max, grades capped at C — these rows did NOT qualify.',
      '(3 rated from 8 sub-floor gated, top 5 fetched; fallers excluded)',
      'Playbook: churn the lap.', '(band basis: 2h, ≥6 traded windows any-side + two-sided; thin ≥3)'],
    table: { headers: screenHeaders, rows: [screenRows[0]] }, estExplainer: screenExplainer, footerLines: ['Grades: C×1'],
  };
  assert.equal(renderReport(buildScreenNicheReport(parts)), preVZ4aScreenGolden(parts));
});

/* --- renderReport section-type guard: an unknown section throws (a builder typo is a defect) ---- */
ok('renderReport throws on an unknown section type (fail loud, never silently drop a fact)', () => {
  assert.throws(() => renderReport({ sections: [{ type: 'bogus' }] }), /unknown section type 'bogus'/);
});

/* ============================================================================================
   PLAN-DIURNAL-TIMING DT2 — formatTimedLap (pipeline/lib/emit.mjs), the ONE shared renderer for a
   js/windowread.mjs diurnalTimedLap result. Fixtures mirror the bolts-clean / chin-scatter shapes
   pinned in pipeline/test/windowread.test.mjs (same session anchors), but as LITERAL lap objects so
   this file stays a pure formatting pin, decoupled from the pure-fn's own acceptance suite.
   ============================================================================================ */

// bolts-shaped: clean cycle, tight dip/peak windows, positive timed net AND positive same-hour net
// (both shown — the plan's "compute both" row) — plus a liquidity segment (volDay merged onto the lap
// per formatTimedLap's doc comment) and buyLimit UNDER the ceiling (no caveat).
const boltsLap = {
  degraded: false, clean: true,
  bid: 2816, ask: 3030, bidBasis: 'patient-dip',
  dipWindow: { startH: 21, endH: 23 }, peakWindow: { startH: 4, endH: 6 },
  net: 154, roi: 5.5, instantNet: 40, instantRoi: 1.4,
  holdHrs: 7, lowTrend: 12, hiTrend: 18,
  bidReach: { fullN: 7, fullHit: 6 }, askReach: { fullN: 7, fullHit: 5 },
  dipPool: 200000, peakPool: 448002,
  trancheComfort: 4290, trancheCeiling: 8580,
  volDay: 858000, buyLimit: 5000,   // deliberately UNDER the 8,580 ceiling (bolts' real buy limit of 11,000
                                     // is ABOVE it per the plan's §4 anchor table — used in the next test).
};

// chin-shaped: range-churn (scattered per-day trough/peak hour ⇒ clean:false), small positive net,
// falling base — the specific hours are OMITTED (the whole point of the clean flag).
const chinLap = {
  degraded: false, clean: false,
  bid: 400, ask: 440, bidBasis: 'patient-dip',
  dipWindow: { startH: 0, endH: 0 }, peakWindow: { startH: 12, endH: 12 },
  net: 32, roi: 8, instantNet: 6, instantRoi: 1.5,
  holdHrs: 12, lowTrend: -3, hiTrend: -1,
  bidReach: { fullN: 9, fullHit: 3 }, askReach: { fullN: 9, fullHit: 2 },
  dipPool: 15000, peakPool: 15000,
  trancheComfort: 2100, trancheCeiling: 4200,
  volDay: 420000, buyLimit: 2000,
};

ok('formatTimedLap: clean cycle — BID/ASK+windows, BOTH timed net and same-hour instant net, range/reach/hold/base, liquidity segment, no caveat under the ceiling', () => {
  const text = formatTimedLap(boltsLap);
  assert.ok(text.includes('BID 2.8k (patient-dip, dip'), `windows render on a clean cycle (got: ${text})`);
  assert.ok(text.includes('ASK 3k (peak'));
  assert.ok(text.includes('timed +154/u (5.5%)'), 'the TIMED trough→peak lap');
  assert.ok(text.includes('same-hour +40/u'), 'the SAME-HOUR instant margin — both nets must appear');
  assert.ok(text.includes('range 214'), 'ask−bid range');
  assert.ok(text.includes('reach bid 6/7·ask 5/7'));
  assert.ok(text.includes('hold ~7h'));
  assert.ok(text.includes('base ↑12/d'));
  assert.ok(text.includes('858k/d'), 'the liquidity segment (volDay merged onto the lap)');
  assert.ok(text.includes('dip-pool ~200k'));
  assert.ok(text.includes('peak-pool ~448k'));
  assert.ok(text.includes('tranche ~4.3k comfortable'));
  assert.ok(text.includes('~8.6k ceiling'));
  assert.ok(!text.includes('⚠ buy limit'), 'buyLimit (5,000) is UNDER trancheCeiling (8,580) — no caveat');
});

ok('formatTimedLap: §4 caveat fires when the caller-relevant size (buyLimit) exceeds trancheCeiling — the real bolts anchor (buyLimit 11,000 > ceiling 8,580 per the plan\'s §4 table)', () => {
  const overCeiling = { ...boltsLap, buyLimit: 11000 };   // the real bolts session anchor — 11,000 > 8,580
  const text = formatTimedLap(overCeiling);
  assert.ok(text.includes('⚠ buy limit 11k exceeds tranche ceiling'), `caveat must fire (got: ${text})`);
  assert.ok(text.includes('n≈6 reach-relief, not validated for diurnal'));
  assert.ok(!formatTimedLap(boltsLap).includes('⚠ buy limit'), 'the base fixture (buyLimit 5,000) stays under the ceiling — no caveat');
});

ok('formatTimedLap: range-churn (clean:false) — leads with the no-timing-edge line, OMITS the specific dip/peak hours, still shows BOTH nets + base', () => {
  const text = formatTimedLap(chinLap);
  assert.ok(text.startsWith('range-churn — no timing edge'), `must lead with the range-churn frame (got: ${text})`);
  assert.ok(!text.includes('BID '), 'the specific dip HOUR is unreliable on a scattered cycle — omit it');
  assert.ok(!text.includes('dip 0'), 'no dip-window hour text');
  assert.ok(text.includes('range 40'));
  assert.ok(text.includes('timed +32/u'), 'timed net still renders (just not the hours)');
  assert.ok(text.includes('same-hour +6/u'), 'same-hour instant net still renders');
  assert.ok(text.includes('base ↓3/d'));
});

ok('formatTimedLap: degrades to null — a degraded lap, a null lap, and a priceless (no bid/ask) lap all render NOTHING (the §7 softened contract: computed everywhere, printed only when there is something to say)', () => {
  assert.equal(formatTimedLap({ degraded: true, reason: 'thin-history' }), null);
  assert.equal(formatTimedLap({ degraded: true, reason: 'no-window' }), null);
  assert.equal(formatTimedLap(null), null);
  assert.equal(formatTimedLap(undefined), null);
  assert.equal(formatTimedLap({ degraded: false, clean: true, bid: null, ask: 100 }), null, 'no bid ⇒ nothing priceable to say');
  assert.equal(formatTimedLap({ degraded: false, clean: false, bid: 100, ask: null }), null, 'no ask ⇒ nothing priceable to say');
});

ok('formatTimedLap: coverage is NOT gated on the clean flag — both a clean AND a range-churn survivor render a line (DT2 extends coverage past the old ★-candidate-only gate)', () => {
  assert.ok(formatTimedLap(boltsLap) != null);
  assert.ok(formatTimedLap(chinLap) != null, 'a range-churn (non-clean, non-star) row still gets a rendered line, not silence');
});

/* --- PLAN-MULTI-PEAK-WINDOWS: a SECOND elevated / depressed window renders as a trailing clause on the
   SAME diurnal line (never a second note line). Fixtures extend boltsLap with the additive index-aligned
   askReaches/bidReaches arrays; [0] is the primary parity, [1] the secondary the clause reads. ------- */
const secondaryAskLap = {
  ...boltsLap,
  askReaches: [
    { level: boltsLap.ask, window: boltsLap.peakWindow, reach: boltsLap.askReach, pool: boltsLap.peakPool },
    { level: 3060, window: { startH: 12, endH: 17 }, reach: { fullN: 7, fullHit: 4 }, pool: 300000 },
  ],
  bidReaches: [{ level: boltsLap.bid, window: boltsLap.dipWindow, reach: boltsLap.bidReach, pool: boltsLap.dipPool }],
};
const bothSecondaryLap = {
  ...secondaryAskLap,
  bidReaches: [
    { level: boltsLap.bid, window: boltsLap.dipWindow, reach: boltsLap.bidReach, pool: boltsLap.dipPool },
    { level: 2780, window: { startH: 8, endH: 11 }, reach: { fullN: 7, fullHit: 5 }, pool: 180000 },
  ],
};

ok('formatTimedLap: a SECOND elevated window renders ONE trailing clause on the same line (inform-only)', () => {
  const text = formatTimedLap(secondaryAskLap);
  assert.ok(text.includes('also ASK'), `the secondary ask clause appends (got: ${text})`);
  assert.ok(text.includes('reach 4/7'), 'the secondary window carries its own reach count');
  assert.ok(text.includes('— second elevated window (n≈0, inform)'), 'labelled inform-only, n≈0');
  assert.ok(!text.includes('also BID'), 'only the ask side has a secondary here');
  assert.ok(!text.includes('\n'), 'still ONE line — never a second note line');
});

ok('formatTimedLap: BOTH a second elevated AND a second depressed window append — still ONE joined line', () => {
  const text = formatTimedLap(bothSecondaryLap);
  assert.ok(text.includes('also ASK') && text.includes('— second elevated window (n≈0, inform)'));
  assert.ok(text.includes('also BID') && text.includes('— second depressed window (n≈0, inform)'));
  assert.ok(!text.includes('\n'), 'both clauses ride the SAME line (one-line-per-item house rule)');
  // exactly two more ' · '-joined bits than the base bolts line (one per secondary side)
  const base = formatTimedLap(boltsLap).split(' · ').length;
  assert.equal(text.split(' · ').length, base + 2, 'both clauses are bits on the SAME join, not a new line');
});

ok('formatTimedLap: NO secondary windows ⇒ byte-identical to today (the no-regression pin)', () => {
  assert.equal(formatTimedLap(boltsLap).includes('also ASK'), false, 'base bolts lap has no askReaches[1] ⇒ no clause');
  assert.equal(formatTimedLap(boltsLap).includes('also BID'), false);
  // a lap with length-1 arrays (a real single-window diurnalTimedLap result) also emits nothing extra
  const singleWindow = { ...boltsLap, askReaches: [{ level: boltsLap.ask }], bidReaches: [{ level: boltsLap.bid }] };
  assert.equal(formatTimedLap(singleWindow).includes('also '), false, 'length-1 reaches arrays ⇒ no trailing clause');
});

/* --- §5 item separator: a plain '' entry between two items' diurnal lines renders as ONE blank line
   between them, and never inside a single item's (single-line) block. Mirrors the actual screen wiring
   in screen-flip-niches.mjs's renderMode diurnal extraSection (a '' pushed between item lines, each
   real line prefixed '  ↳ '). formatNote passes a bare string through unchanged, so a lines-array '0'
   entry (not routed through formatNote at all here — screen's extraSections are plain 'lines' arrays)
   renders as an empty string list entry ⇒ one blank output line, confirmed against the real render.mjs
   renderLines()/renderReport() path below. */
ok('DT2 §5: the item separator renders as exactly one blank line between two items, never within one', () => {
  const lineA = `Cannonball — ${formatTimedLap(boltsLap)}`;
  const lineB = `Nature rune — ${formatTimedLap(chinLap)}`;
  const diurnalLines = [lineA, '', lineB];   // exactly how the screen wiring builds it
  const parts = {
    headerLines: ['## BAND — 2 rated'], table: null, estExplainer: null, footerLines: ['Grades: (none)'],
    extraSections: [{ type: 'lines', blank: false, lines: [
      'Diurnal timing (timed-lap bid/ask off the in-hand 1h series — support, not a gate):',
      ...diurnalLines.map(l => l === '' ? '' : `  ↳ ${l}`),
    ] }],
  };
  const out = renderReport(buildScreenNicheReport(parts));
  const lines = out.split('\n');
  const idxA = lines.findIndex(l => l.includes('Cannonball —'));
  const idxB = lines.findIndex(l => l.includes('Nature rune —'));
  assert.ok(idxA >= 0 && idxB >= 0, 'both item lines render');
  assert.equal(idxB - idxA, 2, 'exactly one line (the blank separator) sits between the two item lines');
  assert.equal(lines[idxA + 1], '', 'the separator line is blank');
  assert.ok(!lines[idxA].includes('\n\n') && lines[idxA].trim().length > 0, 'no blank line WITHIN one item\'s own (single-line) block');
});

console.log(`\nAll ${pass} checks passed.`);
