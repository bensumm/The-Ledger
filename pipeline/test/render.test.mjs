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
import { renderReport } from '../lib/render.mjs';
import { buildWatchReport } from '../commands/watch-positions.mjs';
import { quoteCells as canonicalQuoteCells, cellText } from '../../js/quotecore.js';

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

/* --- renderReport section-type guard: an unknown section throws (a builder typo is a defect) ---- */
ok('renderReport throws on an unknown section type (fail loud, never silently drop a fact)', () => {
  assert.throws(() => renderReport({ sections: [{ type: 'bogus' }] }), /unknown section type 'bogus'/);
});

console.log(`\nAll ${pass} checks passed.`);
