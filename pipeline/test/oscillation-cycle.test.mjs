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
import { hourProfile } from '../../js/windowread.mjs';
import {
  diurnalForecast, driftAdjustedExit, oscillationVsKnife,
  OSC_HOLD_HORIZON_DAYS,
} from '../../js/forecast.mjs';

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

// ── 1. the detector: fang/blowpipe shape (multi-week decline + weekly bounce) = OSCILLATING ────────
ok('detector: a declining floor + a ~weekly bounce reads OSCILLATING (not a false knife)', () => {
  // overall drift DOWN (~−4/step) with a repeated up/down bounce riding it — the fang/blowpipe shape.
  const fang = daysFromMids([100, 94, 101, 88, 96, 82, 90, 77, 85, 72]);
  const det = oscillationVsKnife(fang);
  assert.ok(det, 'a 10-day series is readable');
  assert.equal(det.oscillating, true, 'the bounce riding the decline is oscillation, not a knife');
  assert.equal(det.knife, false, 'knife = !oscillating');
  assert.ok(det.slope < 0, 'the fitted drift is DOWN (an intermediate number, never a returned label)');
  assert.ok(det.flipFraction >= 0.4, `detrended flip fraction clears the threshold (got ${det.flipFraction})`);
});

// ── 2. the detector: a monotone collapse = KNIFE ─────────────────────────────────────────────────
ok('detector: a monotone (accelerating) collapse reads KNIFE (no oscillation to harvest)', () => {
  const knife = daysFromMids([100, 98, 94, 88, 80, 70, 58, 44]);   // strictly down, convex, no bounce
  const det = oscillationVsKnife(knife);
  assert.ok(det, 'readable');
  assert.equal(det.knife, true, 'a monotone collapse is a knife');
  assert.equal(det.oscillating, false, 'no detrended sign-flips → not oscillating');
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

console.log(`\nAll ${pass} acceptance checks passed.`);
