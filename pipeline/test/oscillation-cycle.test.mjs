#!/usr/bin/env node
/**
 * oscillation-cycle.test.mjs — acceptance fixtures for PLAN-OSCILLATION-CYCLE Chunk 1: the
 * drift-adjusted exit-projection primitive + the drift-aware oscillation-vs-knife detector
 * (both in js/forecast.mjs). INFORM-ONLY, n≈0 — these pins guard the ARITHMETIC + the
 * direction-agnostic contract, NOT any gate (Chunk 1 gates on nothing).
 *
 * PURE over synthetic fixtures — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/oscillation-cycle.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - a fang/blowpipe-shaped fixture (multi-week decline + a faster ~weekly bounce) reads as
 *     "oscillating, not knife" AND its driftAdjustedPeak comes out BELOW naive nextPeak.level.
 *   - a MIRROR up-drift fixture reads driftAdjustedPeak ABOVE naive — via the SAME code path
 *     (no direction branch: only the sign of the slope number differs).
 *   - a monotone knife (no bounce) reads as "knife, not oscillating".
 *   - BYTE-IDENTITY: wrapping diurnalForecast in driftAdjustedExit changes the un-adjusted forecast
 *     NOTHING (no mutation), and the un-adjusted halves equal the naive levels.
 *   - the returned object exposes NO phase / NO direction label (the corrected-mechanism ruling).
 */
import assert from 'node:assert/strict';
import { hourProfile, windowStats } from '../../js/windowread.mjs';
import { amplitudeRanges } from '../../js/amplitudescreen.mjs';
import {
  diurnalForecast, driftAdjustedExit, oscillationVsKnife,
  OSC_HOLD_HORIZON_DAYS, OSC_DETECTOR_NIGHTS,
} from '../../js/forecast.mjs';

// AMP_NIGHTS is a screen-flip-niches.mjs-local const (the amplitude GATE's daily-range lookback) — not
// exported, so mirror its value here for the F-H decoupling pins. If it changes there, change it here.
const AMP_NIGHTS = 14;

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('PLAN-OSCILLATION-CYCLE Chunk 1 acceptance:');

// helpers -----------------------------------------------------------------------------------------
const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi, volLo = 20, volHi = 20) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });

// A diurnal 1h fixture (same shape as forecast.test's helper): evening dip + afternoon peak per day.
function diurnal(days, { baseFn, dipHours = [3, 4, 5], peakHours = [15, 16, 17], dipD = 50, peakD = 70 } = {}) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = baseFn(di);
    const low = base - (dipHours.includes(h) ? dipD : 0);
    const hi = base + (peakHours.includes(h) ? peakD : 10);
    s.push(pt(ts(2026, 0, 1 + di, h), low, hi));
  }
  return s;
}

// A per-day windowStats-shaped `days` array — [[key, {low, hi}], …] oldest→newest — from a list of mids
// (band ±5 around each mid). This is the shape the detector consumes.
const daysFromMids = mids => mids.map((m, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, { low: m - 5, hi: m + 5 }]);

// ── 1. the detector: fang/blowpipe shape (SMOOTH multi-day runs riding a decline) = OSCILLATING ────
// F-A (2026-07-22): the real fang/blowpipe shape is a SMOOTH ~4-day-up/~4-day-down alternation riding a
// slow decline (PLAN: "+ + + + − − − − + + + + − −"), NOT a daily zigzag. The retired first-difference
// metric mislabeled exactly this shape a false knife (few day-to-day flips); the redesigned leg/amplitude
// metric is built to read it correctly. Construct it explicitly: a −1.5/day linear decline plus a
// triangular bounce that moves +3/day for 4 days, then −3/day for 4 days, then +3/day for 4 days, then
// −3/day for the remaining days (a textbook multi-week-oscillator shape, 14 days ⇒ ~1.75 cycles).
function fangShapedMids(n = 14) {
  const mids = [];
  let bounce = 0, bdir = 1, runLen = 0;
  for (let i = 0; i < n; i++) {
    mids.push(100 - 1.5 * i + bounce);
    bounce += bdir * 3; runLen++;
    if (runLen === 4) { bdir = -bdir; runLen = 0; }
  }
  return mids;
}
ok('detector: a declining floor + a smooth multi-day bounce reads OSCILLATING (not a false knife)', () => {
  const fang = daysFromMids(fangShapedMids(14));
  const det = oscillationVsKnife(fang);
  assert.ok(det, 'a 14-day series is readable');
  assert.equal(det.oscillating, true, 'the smooth bounce riding the decline is oscillation, not a knife');
  assert.equal(det.knife, false, 'knife = !oscillating');
  assert.ok(det.slope < 0, 'the fitted drift is DOWN (an intermediate number, never a returned label)');
  assert.ok(det.legs >= 3, `≥3 real legs found (got ${det.legs})`);
});

ok('detector: the MIRROR up-drift shape reads OSCILLATING too — same code path, no sign branch', () => {
  const mids = fangShapedMids(14).map((v, i) => v + 3 * i);   // add a stronger UP drift on top
  const det = oscillationVsKnife(daysFromMids(mids));
  assert.ok(det, 'readable');
  assert.equal(det.oscillating, true, 'an up-drift oscillator reads oscillating identically to a down-drift one');
  assert.ok(det.slope > 0, 'fitted drift is UP this time — direction is only ever the sign of an intermediate number');
});

// ── 2. the detector: a monotone (even CURVED) collapse = KNIFE ─────────────────────────────────────
ok('detector: a monotone (accelerating) collapse reads KNIFE (no oscillation to harvest)', () => {
  // strictly down, convex (accelerating), no bounce. A single straight-line detrend of ANY curved
  // monotone series produces exactly one hump in the residuals (one up-leg, one down-leg — 2 legs) as a
  // pure linear-fit artifact; OSC_MIN_LEGS=3 is what tells this apart from a real multi-leg oscillation.
  const knife = daysFromMids([100, 98, 94, 88, 80, 70, 58, 44]);
  const det = oscillationVsKnife(knife);
  assert.ok(det, 'readable');
  assert.equal(det.knife, true, 'a monotone collapse is a knife, even though a linear detrend leaves a residual hump');
  assert.equal(det.oscillating, false, 'only ~2 legs (one hump) — below OSC_MIN_LEGS, not a real cycle');
  assert.ok(det.legs <= 2, `at most 2 legs from a single linear-fit hump (got ${det.legs})`);
});

ok('detector: a genuinely straight-line monotone series has ZERO legs (no residual at all)', () => {
  const straight = daysFromMids([100, 92, 84, 76, 68, 60, 52, 44]);   // exactly linear, slope -8/day
  const det = oscillationVsKnife(straight);
  assert.ok(det, 'readable');
  assert.equal(det.legs, 0, 'a perfectly linear series detrends to a flat-zero residual — no legs at all');
  assert.equal(det.oscillating, false, 'no legs ⇒ not oscillating');
});

ok('detector: too-thin a series degrades to null (never a fake read)', () => {
  assert.equal(oscillationVsKnife(daysFromMids([100, 95, 101, 90])), null, '4 days < OSC_MIN_DAYS');
  assert.equal(oscillationVsKnife([]), null, 'empty → null');
  assert.equal(oscillationVsKnife(null), null, 'non-array → null');
});

// ── 3. driftAdjustedExit: DOWN drift ⇒ driftAdjustedPeak BELOW naive nextPeak.level ───────────────
ok('exit: a negative ceiling slope pulls driftAdjustedPeak BELOW naive nextPeak.level', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });   // flat base ⇒ clean naive peak
  const now = new Date(2026, 0, 10, 12, 0, 0);
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now, phase: 'base', reliable: true });
  assert.equal(fc.reason, null, 'clean based series forecasts');
  const naive = fc.forecast.nextPeak.level;

  const dae = driftAdjustedExit(fc, { ceilingSlope: -50, floorSlope: -50 });
  assert.ok(dae, 'exit projection emitted');
  assert.equal(dae.naivePeak, naive, 'the un-adjusted peak half equals diurnalForecast nextPeak.level');
  assert.ok(dae.driftAdjustedPeak < naive, `down-drift ⇒ adjusted peak (${dae.driftAdjustedPeak}) below naive (${naive})`);
  assert.ok(dae.driftAdjustedTrough < fc.forecast.nextTrough.level, 'and the trough shifts down too');

  // the shift magnitude = slope × residual horizon past the peak eta (the finding: near-term already baked in)
  const residDays = Math.max(0, OSC_HOLD_HORIZON_DAYS - fc.forecast.nextPeak.etaH / 24);
  assert.equal(dae.driftAdjustedPeak, naive + (-50) * residDays, 'shift = slope × max(0, horizon − etaDays)');
});

// ── 4. driftAdjustedExit: MIRROR up drift ⇒ ABOVE naive, via the SAME code path ───────────────────
ok('exit: a positive ceiling slope pushes driftAdjustedPeak ABOVE naive — SAME path, no direction branch', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const now = new Date(2026, 0, 10, 12, 0, 0);
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now, phase: 'base', reliable: true });
  const naive = fc.forecast.nextPeak.level;

  const up = driftAdjustedExit(fc, { ceilingSlope: +50, floorSlope: +50 });
  const down = driftAdjustedExit(fc, { ceilingSlope: -50, floorSlope: -50 });
  assert.ok(up.driftAdjustedPeak > naive, 'up-drift ⇒ above naive');
  // symmetric by construction: equal-magnitude opposite-sign slopes land equidistant either side of naive.
  assert.equal(up.driftAdjustedPeak - naive, naive - down.driftAdjustedPeak, 'symmetric around naive (no directional asymmetry)');
});

// ── 5. the corrected-mechanism CONTRACT: no phase, no direction label exposed ─────────────────────
ok('contract: driftAdjustedExit returns NO phase and NO direction/rising-falling field', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true });
  const dae = driftAdjustedExit(fc, { ceilingSlope: -50 });
  for (const banned of ['phase', 'direction', 'rising', 'falling', 'dir', 'label']) {
    assert.ok(!(banned in dae), `no '${banned}' field on the exit projection (direction is arithmetic only)`);
  }
  assert.ok('driftAdjustedPeak' in dae && 'driftAdjustedTrough' in dae && 'confidence' in dae, 'the three contracted fields are present');
});

// ── 6. BYTE-IDENTITY: wrapping diurnalForecast changes the un-adjusted forecast NOTHING ────────────
ok('byte-identity: driftAdjustedExit does not mutate the forecast; un-adjusted halves = naive levels', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const now = new Date(2026, 0, 10, 12, 0, 0);
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now, phase: 'base', reliable: true });
  const snapshot = JSON.stringify(fc);

  const dae = driftAdjustedExit(fc, { ceilingSlope: -50, floorSlope: 30 });
  assert.equal(JSON.stringify(fc), snapshot, 'the forecast object is untouched (pure — wrapping is a no-op on it)');
  assert.equal(dae.naivePeak, fc.forecast.nextPeak.level, 'un-adjusted peak half == diurnalForecast level');
  assert.equal(dae.naiveTrough, fc.forecast.nextTrough.level, 'un-adjusted trough half == diurnalForecast level');

  // and with NO slope supplied both sides pass through the naive levels unchanged (degrade, not a fake shift).
  const passthru = driftAdjustedExit(fc, {});
  assert.equal(passthru.driftAdjustedPeak, fc.forecast.nextPeak.level, 'no ceilingSlope ⇒ peak unshifted');
  assert.equal(passthru.driftAdjustedTrough, fc.forecast.nextTrough.level, 'no floorSlope ⇒ trough unshifted');
});

ok('exit: degrades to null when the forecast degraded (no nextPeak/nextTrough)', () => {
  assert.equal(driftAdjustedExit({ forecast: null, reason: 'no-anchor' }, { ceilingSlope: -50 }), null, 'null forecast → null');
  assert.equal(driftAdjustedExit(null, {}), null, 'null input → null');
});

// ── 7. F-H: the DETECTOR's lookback is DECOUPLED from the amplitude GATE's AMP_NIGHTS window ───────
// F-H (2026-07-22): `oscillationVsKnife` needs ≥1.5 cycles / ≥3 real legs of history to fire OSCILLATING.
// At the gate's AMP_NIGHTS=14 window, a real oscillator that has RECENTLY entered a prolonged down-leg
// (the fang down-leg you sit inside) reads a false KNIFE — from inside a 14-day window it genuinely
// cannot yet tell a monotone leg from a cycle (the F-A walk-forward finding). Feeding the detector a
// SEPARATE, LONGER trailing window (`OSC_DETECTOR_NIGHTS` > AMP_NIGHTS) buys it the extra history to see
// the earlier reversals and read OSCILLATING — WITHOUT widening the gate's own daily-range/reach reads.
// A realistic ~7-day-cycle oscillator whose last ~13 days are a prolonged descent: older days carry two
// clean legs of the ~weekly oscillation; recent days are the current down-leg (with tiny jitter so the
// noise floor is non-zero). Walked at AMP_NIGHTS trailing days it is all descent (≤1 real leg → KNIFE);
// the full OSC_DETECTOR_NIGHTS window catches the earlier reversals (≥3 real legs → OSCILLATING).
function fangDownLegMids() {
  const mids = [1000, 1018, 1006, 982, 972, 992, 1014, 1016];   // days 0–7: two clean legs of a ~7-day cycle
  let v = 1010;
  for (let i = 8; i < 21; i++) { v -= 10 + (i % 2 ? 3 : -3); mids.push(v); }   // days 8–20: the current down-leg + jitter
  return mids;
}
ok('F-H: a recently-down-legging oscillator reads KNIFE at AMP_NIGHTS but OSCILLATING at OSC_DETECTOR_NIGHTS', () => {
  assert.ok(OSC_DETECTOR_NIGHTS > AMP_NIGHTS, `the detector window (${OSC_DETECTOR_NIGHTS}) must exceed the gate's AMP_NIGHTS (${AMP_NIGHTS}) — that is the decoupling`);
  const full = fangDownLegMids();
  assert.ok(full.length >= OSC_DETECTOR_NIGHTS, 'fixture supplies at least a full detector window');

  const shortWin = oscillationVsKnife(daysFromMids(full.slice(full.length - AMP_NIGHTS)));
  assert.ok(shortWin, 'the AMP_NIGHTS slice is readable');
  assert.equal(shortWin.knife, true, 'from inside a 14-day window the fang down-leg looks monotone → KNIFE (too few legs)');
  assert.ok(shortWin.legs < 3, `fewer than OSC_MIN_LEGS real legs in the short window (got ${shortWin.legs})`);

  const longWin = oscillationVsKnife(daysFromMids(full.slice(full.length - OSC_DETECTOR_NIGHTS)));
  assert.ok(longWin, 'the OSC_DETECTOR_NIGHTS slice is readable');
  assert.equal(longWin.oscillating, true, 'the longer window catches the earlier reversals → OSCILLATING (the fix helps the target class)');
  assert.ok(longWin.legs >= 3, `≥3 real legs once enough trailing history is supplied (got ${longWin.legs})`);
});

// A 25-day 1h fixture: a wide daily swing (evening dip / afternoon peak) riding the same recently-down-
// legging mid path — so the daily windowStats().days quantiles differ between a 14- and a 21-night window.
function diurnalOverMids(mids, { dipHours = [3, 4, 5], peakHours = [15, 16, 17], dipD = 40, peakD = 60 } = {}) {
  const s = [];
  for (let di = 0; di < mids.length; di++) for (let h = 0; h < 24; h++) {
    const base = mids[di];
    const low = base - (dipHours.includes(h) ? dipD : 0);
    const hi = base + (peakHours.includes(h) ? peakD : 5);
    s.push(pt(ts(2026, 0, 1 + di, h), low, hi));
  }
  return s;
}
ok('F-H: the GATE\'s AMP_NIGHTS basis is UNCHANGED — the longer detector window does not touch amplitudeRanges/reach', () => {
  const mids = [1000, 1018, 1006, 982, 972, 992, 1014, 1016, 1003, 990, 983, 970, 963, 950, 943, 930, 923, 910, 903, 890, 883, 876, 869, 862, 855];
  const ts1h = diurnalOverMids(mids);
  const live = 880;

  const gateStats = windowStats(ts1h, { nights: AMP_NIGHTS, wStart: 0, wEnd: 0 });
  const detStats = windowStats(ts1h, { nights: OSC_DETECTOR_NIGHTS, wStart: 0, wEnd: 0 });
  assert.equal(gateStats.days.length, AMP_NIGHTS, 'gate window keeps AMP_NIGHTS completed days');
  assert.ok(detStats.days.length > gateStats.days.length, 'the detector window genuinely reaches further back');

  // The gate's amplitudeRanges is a pure function of the AMP_NIGHTS stats — computing the longer detector
  // window alongside it changes nothing (recompute it and assert byte-identity to the reference).
  const ref = amplitudeRanges(gateStats, live);
  const again = amplitudeRanges(windowStats(ts1h, { nights: AMP_NIGHTS, wStart: 0, wEnd: 0 }), live);
  assert.deepEqual(again, ref, 'the AMP_NIGHTS amplitudeRanges is unaffected by the detector-window decoupling');

  // …and it is load-bearing that the gate stays on AMP_NIGHTS: feeding it the DETECTOR window instead
  // WOULD change the reach/quantile outputs (different day set), which the decoupling deliberately avoids.
  const wrong = amplitudeRanges(detStats, live);
  assert.ok(wrong.ampBid !== ref.ampBid || wrong.ampAsk !== ref.ampAsk,
    'the two windows produce different amplitudeRanges — so decoupling (gate on AMP_NIGHTS, detector on OSC_DETECTOR_NIGHTS) is what protects the gate\'s recency read');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
