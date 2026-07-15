#!/usr/bin/env node
/**
 * diploop.test.mjs — acceptance fixtures for DL2 (the reactive LIQUID-FLUSH → bid-into-the-fall detector):
 *   - flushSignal (js/quotecore.js) — the pure liquid-flush firing read.
 *   - suggestionEntry (pipeline/lib/suggestlog.mjs) — the lean `dipLoop` pass-through.
 *   - dipLoopAudit (pipeline/lib/analyze.mjs) — the FLUSH-firing ⇆ fills retro shape.
 *
 * Lives in pipeline/ next to dipposture.test.mjs / validate.test.mjs (the convention for js/-module
 * tests; run-tests.mjs auto-discovers it). Everything is PURE over synthetic series, no live data (rule 4).
 * Run: `node pipeline/test/diploop.test.mjs` (exits non-zero on any failure).
 *
 * HONESTY: every DL2 threshold under test is a NAMED PLACEHOLDER (n=2). These fixtures pin the SHAPE of
 * the firing (liquid + deep + falling + profitable-exit fires; anything else does not) and that the score
 * ranks + never throws on a null limit — NOT that the thresholds are calibrated.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - flushSignal FIRES (flush:true) on liquid + deep(≥3%) + still-falling + profitable-exit.
 *   - SIGNAL vs FLUSH split: an ILLIQUID deep+falling item is signal:true/flush:false/liquid:false (LOGGED,
 *     never alerted) — the widened-log path; shallow/reverting/flat → signal:false.
 *   - flushSignal does NOT fire when: thin (flush:false, liquid:false); shallow (< flush%); reverting/flat
 *     direction; exit underwater (optSell ≤ break-even or afterTaxMargin ≤ 0); null on missing inputs.
 *   - dipScore: > 0 on a firing; the limit===null fallback yields a FINITE score (never throws); a
 *     higher-volDay/higher-margin fixture scores higher (ranking sanity).
 *   - bucketVol is INFORMATIONAL: a firing with a low current-bucket volume STILL fires (Ben's refinement).
 *   - suggestionEntry passes `dipLoop` through (lean-included; absent → byte-identical shape).
 *   - dipLoopAudit joins flush signals to retro outcomes, segments alerted vs signal-only, and computes the
 *     fillable-vs-not separation over the ALERTED subset.
 */
import assert from 'node:assert/strict';
import {
  flushSignal, DIP_LOOP_LIQUID_FLOOR, DIP_LOOP_FLUSH_PCT, DIP_LOOP_DEPLOY_VOL_FRAC, breakEven,
} from '../../js/quotecore.js';
import { suggestionEntry } from '../lib/suggestlog.mjs';
import { dipLoopAudit } from '../lib/analyze.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('DL2 flushSignal + dipLoop logging + dip-loop retro acceptance:');

// --- fixture builders -------------------------------------------------------------------------
// flushSignal calls recentDirection() with the passed `now`; a fixture must sit inside the live 3h
// lookback. `pts` is [{ agoMin, low, vol? }].
const NOW_S = Math.floor(Date.now() / 1000);
const mk = pts => pts.map(p => ({
  timestamp: NOW_S - p.agoMin * 60,
  avgLowPrice: p.low, avgHighPrice: p.low + 20,
  lowPriceVolume: p.vol != null ? p.vol : 5, highPriceVolume: 5,
}));
const ramp = (n, endAgo, lowOf, volOf) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ agoMin: endAgo + (n - 1 - i) * 5, low: lowOf(i), vol: volOf ? volOf(i) : undefined });
  return out;
};
// FALLING into a FRESH low (min at agoMin 0) — 20 pts, last 4 flat at 1000.
const fallingSeries = mk(ramp(20, 0, i => (i < 16 ? 1080 - i * 5 : 1000)));
// REVERTING — min 1000 at agoMin 60 (NOT fresh), bounced to ~1010.
const revertingSeries = mk([
  ...ramp(13, 65, i => 1060 - i * 5),
  { agoMin: 60, low: 1000 },
  ...ramp(11, 0, i => 1001 + i),
]);
// FLAT — same trough, mild recovery to ~1003.
const flatSeries = mk([
  ...ramp(13, 65, i => 1060 - i * 5),
  { agoMin: 60, low: 1000 },
  ...ramp(11, 0, () => 1003),
]);

// A LIQUID, RELIABLE buy-side row dumping to a fresh low. avgLow24 = 1000, quickBuy = 950 → 5% depth
// (clears DIP_LOOP_FLUSH_PCT). optSell 1060 → an after-tax-profitable exit above break-even.
const AVG_LOW_24 = 1000;
const liqRow = (over = {}) => ({
  quickBuy: 950, quickSell: 970, optSell: 1060, volDay: 144000, limit: 30000,   // PLAN-VOL24: was 14400 (pre-recal); bumped above the recalibrated DIP_LOOP_LIQUID_FLOOR (40000) so this stays the LIQUID fixture
  reliable: true, bond: false, guide: null, ...over,
});

// --- 1. flushSignal FIRES -----------------------------------------------------------------------
ok('flushSignal: liquid + deep + falling + profitable-exit → flush:true (and signal:true)', () => {
  const s = flushSignal(liqRow(), fallingSeries, AVG_LOW_24, {});
  assert.equal(s.flush, true);
  assert.equal(s.signal, true);
  assert.equal(s.liquid, true);
  assert.equal(s.dir, 'falling');
  assert.ok(s.depthPct >= DIP_LOOP_FLUSH_PCT, `depth ${(s.depthPct * 100).toFixed(1)}% clears the flush bar`);
  assert.ok(s.afterTaxMargin > 0, 'the exit is after-tax profitable');
  assert.ok(s.dipScore > 0, 'dipScore is positive on a firing');
});

// --- 2. SIGNAL vs FLUSH split + non-firing paths ------------------------------------------------
ok('flushSignal: an ILLIQUID deep+falling item is signal:true but flush:false, liquid:false (LOGGED, not alerted)', () => {
  const s = flushSignal(liqRow({ volDay: DIP_LOOP_LIQUID_FLOOR - 1 }), fallingSeries, AVG_LOW_24, {});
  assert.equal(s.signal, true, 'a genuine deep+falling flush — worth logging even on an illiquid item');
  assert.equal(s.flush, false, 'but never alerts (fails the fillability floor)');
  assert.equal(s.liquid, false);
  assert.ok(Number.isFinite(s.dipScore), 'still carries the computed fields for the DL3 log');
});
ok('flushSignal: thin book (volDay < floor) → flush:false, liquid:false', () => {
  const s = flushSignal(liqRow({ volDay: DIP_LOOP_LIQUID_FLOOR - 1 }), fallingSeries, AVG_LOW_24, {});
  assert.equal(s.flush, false);
  assert.equal(s.liquid, false);
});
ok('flushSignal: shallow dip (< flush%) → flush:false, signal:false', () => {
  const s = flushSignal(liqRow({ quickBuy: 990 }), fallingSeries, AVG_LOW_24, {});   // 1% dip
  assert.equal(s.flush, false);
  assert.equal(s.signal, false, 'not deep enough — not even a log-worthy signal');
  assert.equal(s.liquid, true, 'still a liquid book — only the depth gate failed');
});
ok('flushSignal: a REVERTING dip → flush:false, signal:false (DP1 owns reverting = cross or pass)', () => {
  const s = flushSignal(liqRow({ quickBuy: 950 }), revertingSeries, AVG_LOW_24, {});
  assert.equal(s.dir, 'reverting');
  assert.equal(s.flush, false);
  assert.equal(s.signal, false);
});
ok('flushSignal: a FLAT dip → flush:false, signal:false', () => {
  const s = flushSignal(liqRow({ quickBuy: 950 }), flatSeries, AVG_LOW_24, {});
  assert.equal(s.dir, 'flat');
  assert.equal(s.flush, false);
  assert.equal(s.signal, false);
});
ok('flushSignal: exit UNDERWATER (optSell ≤ break-even / margin ≤ 0) → flush:false', () => {
  const s = flushSignal(liqRow({ optSell: 950 }), fallingSeries, AVG_LOW_24, {});   // optSell == quickBuy → net ≤ 0
  assert.ok(s.afterTaxMargin <= 0);
  assert.equal(s.flush, false);
  assert.ok(s.optSell == null || 950 <= breakEven(950), 'below break-even sanity');
});
ok('flushSignal: an UNRELIABLE quote → flush:false (exit gate needs reliable)', () => {
  const s = flushSignal(liqRow({ reliable: false }), fallingSeries, AVG_LOW_24, {});
  assert.equal(s.flush, false);
});
ok('flushSignal: missing series / 24h avg / row → null (degrade, never guess)', () => {
  assert.equal(flushSignal(liqRow(), null, AVG_LOW_24, {}), null);
  assert.equal(flushSignal(liqRow(), fallingSeries, null, {}), null);
  assert.equal(flushSignal(null, fallingSeries, AVG_LOW_24, {}), null);
  assert.equal(flushSignal(liqRow({ quickBuy: null }), fallingSeries, AVG_LOW_24, {}), null);
});

// --- 3. dipScore: null-limit fallback + ranking -------------------------------------------------
ok('flushSignal: a null-limit (Searing-shaped) firing does NOT throw and yields a finite dipScore', () => {
  const s = flushSignal(liqRow({ limit: null }), fallingSeries, AVG_LOW_24, {});
  assert.equal(s.flush, true, 'still fires — a null limit only affects the score, not the gates');
  assert.ok(Number.isFinite(s.dipScore) && s.dipScore > 0, 'finite, positive score via the DIP_LOOP_DEPLOY_VOL_FRAC proxy');
  // the fallback deploy-units proxy is a fraction of volDay
  assert.ok(DIP_LOOP_DEPLOY_VOL_FRAC > 0);
});
ok('flushSignal: a higher-volDay/higher-margin fixture scores HIGHER (ranking sanity)', () => {
  const lo = flushSignal(liqRow(), fallingSeries, AVG_LOW_24, {});
  const hi = flushSignal(liqRow({ volDay: 500000, optSell: 1200 }), fallingSeries, AVG_LOW_24, {});   // PLAN-VOL24: bumped above the recalibrated default liqRow volDay (144000) so it stays the HIGHER-volDay fixture
  assert.ok(hi.dipScore > lo.dipScore, `${Math.round(hi.dipScore)} > ${Math.round(lo.dipScore)}`);
});

// --- 4. bucketVol is INFORMATIONAL (Ben's refinement: volume is not a firing gate) --------------
ok('flushSignal: a firing with a LOW current-bucket volume STILL fires (bucketVol informs, never gates)', () => {
  // freshest points carry vol=1 (a low current bucket) but the book is liquid (volDay high) and falling.
  const lowBucket = mk(ramp(20, 0, i => (i < 16 ? 1080 - i * 5 : 1000), i => (i >= 16 ? 1 : 5)));
  const s = flushSignal(liqRow(), lowBucket, AVG_LOW_24, {});
  assert.equal(s.flush, true, 'fires despite a thin current bucket');
  assert.ok(s.bucketVol >= 0, 'bucketVol is reported for the alert text');
});

// --- 5. suggestionEntry lean-includes dipLoop ---------------------------------------------------
ok('suggestionEntry: dipLoop is lean-included when supplied; absent → byte-identical shape', () => {
  const row = { quickBuy: 950, optBuy: 940, quickSell: 970, optSell: 1060, mom: 'breakdown', regimeLabel: 'falling' };
  const dipLoop = { volDay: 14400, price: 950, limit: null, depthPct: 0.05, bucketVol: 4732, quickBuy: 950, optSell: 1060, afterTaxMargin: 89, dipScore: 12345 };
  const withDip = suggestionEntry(row, { itemId: 1, cls: 'liquid', verdict: 'FLUSH', dipLoop });
  assert.deepEqual(withDip.dipLoop, dipLoop);
  assert.equal(withDip.verdict, 'FLUSH');
  const without = suggestionEntry(row, { itemId: 1, cls: 'liquid', verdict: 'BUY' });
  assert.ok(!('dipLoop' in without), 'absent dipLoop is not written (lean)');
});

// --- 6. dipLoopAudit joins firings to retro outcomes + segments alerted vs signal-only ----------
ok('dipLoopAudit: separates fillable-vs-not over ALERTED, and segments signal-only (illiquid) rows', () => {
  const sugRows = [
    // ALERTED, filled
    { itemId: 1, ts: 100, verdict: 'FLUSH', dipLoop: { volDay: 14400, depthPct: 0.05, bucketVol: 4732, dipScore: 5000, alerted: true, gatedReason: null } },
    // ALERTED, not-taken
    { itemId: 2, ts: 200, verdict: 'FLUSH', dipLoop: { volDay: 2000, depthPct: 0.04, bucketVol: 50, dipScore: 100, alerted: true, gatedReason: null } },
    // SIGNAL-ONLY (illiquid, gated) — logged, distinguishable, excluded from the fillable separation
    { itemId: 3, ts: 300, verdict: 'FLUSH-SIGNAL', dipLoop: { volDay: 83, depthPct: 0.06, bucketVol: 2, dipScore: 9, alerted: false, gatedReason: 'liquid-floor' } },
    { itemId: 4, ts: 400, verdict: 'BUY' },   // no dipLoop — ignored
  ];
  const retroRows = [
    { outcome: 'filled', latencySec: 600 },
    { outcome: 'not-taken', latencySec: null },
    { outcome: 'not-taken', latencySec: null },
    { outcome: 'not-taken', latencySec: null },
  ];
  const dl = dipLoopAudit(sugRows, retroRows);
  assert.equal(dl.n, 3, 'three flush records (two alerted + one signal-only); the BUY row is ignored');
  assert.equal(dl.nAlerted, 2);
  assert.equal(dl.nSignalOnly, 1);
  assert.equal(dl.nFillable, 1, 'only the alerted-filled row counts as fillable');
  assert.equal(dl.separation.dipScoreFillable, 5000);
  assert.equal(dl.separation.dipScoreNotFillable, 100, 'the signal-only illiquid row is NOT in the alerted separation');
  assert.equal(dl.signalOnlyDist.n, 1);
  assert.equal(dl.signalOnly[0].gatedReason, 'liquid-floor');
});
ok('dipLoopAudit: no flush records → n=0 (the cold-ledger degrade)', () => {
  const dl = dipLoopAudit([{ itemId: 1, ts: 1, verdict: 'BUY' }], [{ outcome: 'not-taken' }]);
  assert.equal(dl.n, 0);
});

console.log(`\nAll ${pass} acceptance checks passed. (DIP_LOOP_LIQUID_FLOOR=${DIP_LOOP_LIQUID_FLOOR}, FLUSH_PCT=${DIP_LOOP_FLUSH_PCT} — placeholders, n=2)`);
