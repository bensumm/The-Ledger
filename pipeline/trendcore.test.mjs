#!/usr/bin/env node
/**
 * trendcore.test.mjs — acceptance fixtures for the pure Trends analytics in js/trendcore.js (TC1).
 *
 * These functions (the hourly/seasonal decomposition, the walk-forward backtest GATE that decides
 * whether the Trends "Timing & seasonality" charts are trusted, and patient-offer sizing) used to
 * live DOM-pinned in js/trends.js with NO test. TC1 moved them into the pure, node-importable
 * js/trendcore.js — a straight behavior-identical MOVE — so this regression net can pin them. All
 * fixtures are synthetic + built with LOCAL-time Date construction (hourOf/localDayKey read local
 * getters, so this passes in any timezone — CI runs UTC, the dev box does not). No live data.
 * Run: `node pipeline/trendcore.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - median: null on empty/nullish, middle for odd, mean-of-two-middle for even, NEVER mutates input.
 *   - bestWindow: the min/max-average circular window of length L; ties keep the earliest start.
 *   - seasonalFactors: detrend each point by its PERIOD's median (removes level), then a
 *     VOLUME-WEIGHTED mean of the ratios per bucket; ratios outside [0.5, 2] are TRIMMED as corrupt.
 *   - factorStats: <3 non-null factors ⇒ {flat:true, swingPct:0, z:0}; otherwise mean/sd/min/max +
 *     swingPct = (max-min)/mean·100, and flat when swing <0.5% OR z <1.0.
 *   - patientTargets: needs ≥4 low & ≥4 high recent prints; steady/rising bids the 20th pctl (never
 *     above live) and asks the 80th (never below live); FALLING bids more aggressively (10th) and
 *     prices the sell to CLEAR at/below the instabuy (min of live-high, 50th pctl).
 *   - backtestPlan: the no-look-ahead walk-forward gate. Too few days ⇒ {insufficient, days}. With a
 *     clean diurnal cycle, buying the cheap window / selling the rich window BEATS naive spread-flip
 *     every out-of-sample day (edge>0, beatRate 100) and edge === stratRoi − spreadRoi exactly.
 */
import assert from 'node:assert/strict';
import {
  median, bestWindow, seasonalFactors, hourFactors, factorStats,
  patientTargets, backtestPlan, analyseBroad, analyseHourly, localDayKey,
} from '../js/trendcore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const approx = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

// build a timeseries point from LOCAL wall-clock (so hourOf/localDayKey are tz-robust in fixtures).
const secs = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (y, mo, d, h, low, high, vol = 0) =>
  ({ timestamp: secs(y, mo, d, h), avgLowPrice: low, avgHighPrice: high, highPriceVolume: vol, lowPriceVolume: 0 });

console.log('trendcore.js pure-analytics acceptance:');

/* --- median: edges + non-mutation ---------------------------------------------------------- */
ok('median: null on empty/nullish, odd → middle, even → mean of two middle, no mutation', () => {
  assert.equal(median(null), null);
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);          // sorts internally → middle is 2
  assert.equal(median([4, 1, 3, 2]), 2.5);     // (2+3)/2
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2], 'median must not mutate its argument (uses slice)');
});

/* --- bestWindow: min/max circular window of length L --------------------------------------- */
ok('bestWindow: min and max average window of length L, wrapping, earliest tie', () => {
  const min = bestWindow([10, 1, 2, 3], 2, 'min');
  assert.deepEqual(min, { start: 1, end: 2, avg: 1.5 });   // {1,2} is cheapest
  const max = bestWindow([10, 1, 2, 3], 2, 'max');
  assert.deepEqual(max, { start: 3, end: 0, avg: 6.5 });   // {3,10} wraps around, richest
});

/* --- seasonalFactors / hourFactors: detrend by period median, volume-weight, trim corrupt --- */
ok('hourFactors: single-day ratios detrend to the day median (75/150/225 → 0.5/1/1.5)', () => {
  const pts = [pt(2026, 0, 1, 5, 75, 300), pt(2026, 0, 1, 10, 150, 300), pt(2026, 0, 1, 15, 225, 300)];
  const hf = hourFactors(pts, 'low');           // day median of [75,150,225] = 150
  assert.equal(hf.factor[5], 0.5);
  assert.equal(hf.factor[10], 1);
  assert.equal(hf.factor[15], 1.5);
  assert.equal(hf.factor[0], null);             // an untraded hour is null, not 0
  assert.equal(hf.counts[5], 1);
  assert.equal(hf.counts[10], 1);
  assert.equal(hf.counts[0], 0);
});

ok('seasonalFactors: detrend removes the LEVEL — a 2× price day yields identical hour factors', () => {
  // Day1 lows [100,200]@h5/h10 (median 150); Day2 lows [200,400]@h5/h10 (median 300) — pure 2× level.
  const pts = [
    pt(2026, 0, 1, 5, 100, 500), pt(2026, 0, 1, 10, 200, 500),
    pt(2026, 0, 2, 5, 200, 500), pt(2026, 0, 2, 10, 400, 500),
  ];
  const hf = hourFactors(pts, 'low');
  assert.ok(approx(hf.factor[5], 2 / 3), 'h5 ratio ≈ 0.667 on BOTH days after detrend');
  assert.ok(approx(hf.factor[10], 4 / 3), 'h10 ratio ≈ 1.333 on both days');
  assert.equal(hf.counts[5], 2);               // both days contributed to h5
  assert.equal(hf.counts[10], 2);
});

ok('seasonalFactors: volume-weights the per-bucket mean toward the higher-volume print', () => {
  // one bucket (h5), one day: low 100 (w=1) and low 200 (vol 8 → w=9); day median [100,200]=150.
  const pts = [pt(2026, 0, 1, 5, 100, 500, 0), pt(2026, 0, 1, 5, 200, 500, 8)];
  const hf = hourFactors(pts, 'low');
  // (0.6667·1 + 1.3333·9) / 10 = 1.26667 — pulled toward the heavy 1.333 print, not the plain mean 1.0
  assert.ok(approx(hf.factor[5], (2 / 3 * 1 + 4 / 3 * 9) / 10), 'weighted, not simple, mean');
  assert.ok(hf.factor[5] > 1, 'the heavier high-ratio print dominates');
});

ok('seasonalFactors: ratios outside [0.5,2] are trimmed as corrupt prints', () => {
  // four 100s @h5 + one 1000 @h12; day median = 100 → the 1000 print has ratio 10 (>2) → trimmed.
  const pts = [
    pt(2026, 0, 1, 5, 100, 500), pt(2026, 0, 1, 5, 100, 500),
    pt(2026, 0, 1, 5, 100, 500), pt(2026, 0, 1, 5, 100, 500),
    pt(2026, 0, 1, 12, 1000, 2000),
  ];
  const hf = hourFactors(pts, 'low');
  assert.equal(hf.factor[5], 1);               // the clean hour
  assert.equal(hf.factor[12], null);           // the corrupt print was trimmed → bucket empty
  assert.equal(hf.counts[12], 0);
});

/* --- factorStats: flat/swing/z ------------------------------------------------------------- */
ok('factorStats: <3 non-null factors ⇒ {flat:true, swingPct:0, z:0}', () => {
  const fs = factorStats([1, null, 2, null]);   // only 2 non-null
  assert.deepEqual(fs, { flat: true, swingPct: 0, z: 0 });
});

ok('factorStats: computes mean/min/max/swing and flat=false for a real spread', () => {
  const fs = factorStats([0.5, 1, 1.5]);
  assert.equal(fs.mean, 1);
  assert.equal(fs.mn, 0.5);
  assert.equal(fs.mx, 1.5);
  assert.equal(fs.swingPct, 100);               // (1.5-0.5)/1 · 100
  assert.ok(approx(fs.sd, Math.sqrt(0.5 / 3)));
  assert.ok(approx(fs.z, 0.5 / Math.sqrt(0.5 / 3)));  // (mean-min)/sd ≈ 1.2247
  assert.equal(fs.flat, false);                 // swing 100% and z>1 → not flat
});

ok('factorStats: a near-constant factor (swing <0.5%) is flat', () => {
  const fs = factorStats([1, 1.001, 1.002]);    // swingPct ≈ 0.2% < 0.5
  assert.ok(fs.swingPct < 0.5);
  assert.equal(fs.flat, true);
});

/* --- patientTargets: steady vs falling offer sizing ---------------------------------------- */
const ptSeries = [
  pt(2026, 0, 1, 0, 100, 150), pt(2026, 0, 1, 1, 110, 160), pt(2026, 0, 1, 2, 120, 170),
  pt(2026, 0, 1, 3, 130, 180), pt(2026, 0, 1, 4, 140, 190),
];
ok('patientTargets (steady): bid the 20th pctl (≤ live), ask the 80th (≥ live)', () => {
  const r = patientTargets(ptSeries, { low: 125, high: 165 }, false);
  assert.equal(r.ok, true);
  assert.equal(r.falling, false);
  assert.equal(r.patientBuy, 110);              // min(125, pctl(los,0.2)=110)
  assert.equal(r.patientSell, 180);             // max(165, pctl(his,0.8)=180)
  assert.equal(r.patientMargin, 67);            // netMargin(110,180): (180-3)-110
  assert.equal(r.fastMargin, 37);               // netMargin(125,165): (165-3)-125
  assert.equal(r.loMin, 100);
  assert.equal(r.hiMax, 190);
});

ok('patientTargets (falling): bid harder (10th pctl), sell to CLEAR at/below the instabuy', () => {
  const r = patientTargets(ptSeries, { low: 125, high: 165 }, true);
  assert.equal(r.falling, true);
  assert.equal(r.patientBuy, 100);              // min(125, pctl(los,0.1)=100)
  assert.equal(r.patientSell, 165);             // min(165, pctl(his,0.5)=170) → clears at the instabuy
  assert.equal(r.patientMargin, 62);            // netMargin(100,165): (165-3)-100
});

ok('patientTargets: ok:false without ≥4 prints a side, or a missing live price', () => {
  assert.equal(patientTargets(ptSeries.slice(0, 3), { low: 125, high: 165 }, false).ok, false);
  assert.equal(patientTargets(ptSeries, { low: 0, high: 165 }, false).ok, false);   // missing live buy
  assert.equal(patientTargets([], { low: 125, high: 165 }, false).ok, false);
});

/* --- backtestPlan: the walk-forward timing gate -------------------------------------------- */
// A clean, noise-free diurnal cycle repeated every day: cheapest to BUY around h4, richest to SELL
// around h16. Identical every day, so the no-look-ahead factors are stable and the timing strategy
// (buy the cheap window, sell the rich one) must beat naive spread-flipping every held-out day.
const low = h => 1000 + Math.abs(h - 4) * 10;    // min at h4
const high = h => 1200 - Math.abs(h - 16) * 5;   // max at h16
function diurnal(nDays) {
  const out = [];
  for (let d = 0; d < nDays; d++) for (let h = 0; h < 24; h++) out.push(pt(2026, 0, 1 + d, h, low(h), high(h)));
  return out;
}

ok('backtestPlan: too few days ⇒ {insufficient:true, days:N} (no fabricated edge)', () => {
  const bt = backtestPlan(diurnal(3));           // 3 days: 3 − warm(4) < 4
  assert.equal(bt.insufficient, true);
  assert.equal(bt.days, 3);
});

ok('backtestPlan (10 clean diurnal days): timing beats naive spread every out-of-sample day', () => {
  const bt = backtestPlan(diurnal(10));
  assert.ok(!bt.insufficient, 'enough history → a real result');
  assert.equal(bt.n, 6);                          // warm=4, days 4..9 scored → 6 held-out days
  assert.ok(approx(bt.edge, bt.stratRoi - bt.spreadRoi), 'edge is exactly stratRoi − spreadRoi');
  assert.ok(bt.edge > 0, 'buying the cheap window & selling the rich one beats the average spread');
  assert.ok(bt.stratRoi > bt.spreadRoi);
  assert.equal(bt.winRate, 100);                  // every held-out day is profitable (positive spread)
  assert.equal(bt.beatRate, 100);                 // timing beat naive on every held-out day
});

/* --- analyseBroad / analyseHourly: light shape coverage ------------------------------------ */
ok('analyseBroad: mids + day span, null when no usable mid', () => {
  const b = analyseBroad([pt(2026, 0, 1, 0, 100, 200), pt(2026, 0, 3, 0, 150, 250)]);
  assert.deepEqual(b.trend, [150, 200]);          // (100+200)/2, (150+250)/2
  assert.equal(b.days, 2);
  assert.equal(analyseBroad([{ avgLowPrice: 0, avgHighPrice: 0 }]), null);
});

ok('analyseHourly: buckets by local hour, marks cheapest/priciest hour', () => {
  const a = analyseHourly([pt(2026, 0, 1, 3, 100, 100), pt(2026, 0, 1, 3, 100, 100), pt(2026, 0, 1, 18, 200, 200)]);
  assert.equal(a.minH, 3);                        // hour 3 is cheapest (mid 100)
  assert.equal(a.maxH, 18);                       // hour 18 priciest (mid 200)
  assert.equal(a.hourPrice[3], 100);
  assert.equal(a.hourPrice[18], 200);
});

/* --- localDayKey: local calendar day, tz-robust -------------------------------------------- */
ok('localDayKey: keys on the LOCAL calendar day (year-month-date, month 0-based)', () => {
  assert.equal(localDayKey(secs(2026, 6, 4, 23)), '2026-6-4');   // local Jul 4 23:00 stays Jul 4
});

console.log(`\nAll ${pass} acceptance checks passed.`);
