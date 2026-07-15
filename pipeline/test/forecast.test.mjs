#!/usr/bin/env node
/**
 * forecast.test.mjs — acceptance fixtures for the pure diurnal+trend forecast (js/forecast.mjs, PF1)
 * and the additive hourProfile dispersion fields (js/windowread.mjs).
 *
 * PURE over synthetic 1h /timeseries fixtures — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/forecast.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - THE BLOOD-RUNE GOLDEN: a week shaped so the diurnal trough prints ~4h ahead, below a profitable
 *     bid that the item is ABOVE right now → whenBuyable(fc, target) returns etaH≈4 at a level ≤ target.
 *     This is the module's reason to exist: "not buyable at a profitable price now; should be in ~4h at ~X".
 *   - the current-hour projection reproduces ~the live price (the anchor boundary condition).
 *   - a downtrend steps the trough DOWN by ~slope·Δt (the codified decay-trend projection).
 *   - the model DEGRADES LOUDLY to null with a reason on: spike/decay phase, live band violation,
 *     unreliable quote, thin/short series, trend-erased dip (trend-only mode).
 *   - the uncertainty band is monotonically NON-SHRINKING over the horizon.
 *   - the new dispersion fields are ADDITIVE — the pre-existing hourProfile fields are byte-identical.
 */
import assert from 'node:assert/strict';
import { hourProfile } from '../../js/windowread.mjs';
import { diurnalForecast, whenBuyable, whenSellable, fmtEta, FC_HORIZON_DEFAULT } from '../../js/forecast.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ~${b} ±${tol})`);

console.log('forecast.js diurnal+trend forecast acceptance:');

const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi, volLo = 20, volHi = 20) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });

// A diurnal fixture: `days` days starting Jan-1, an evening/early-morning dip and an afternoon peak.
// Normal hour: low=base, hi=base+10 (mid=base+5). Dip hour: low=base−dipD. Peak hour: hi=base+peakD.
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

// ── 1. hourProfile: the ADDITIVE dispersion fields, existing fields byte-identical ────────────────
ok('hourProfile: adds devMid/devLowSpread/devHiSpread; pre-existing dip/peak/level unchanged', () => {
  const prof = hourProfile(diurnal(8, { baseFn: () => 1000 }), { nights: 14 });
  assert.ok(prof, 'an 8-day series is profilable');
  // the pre-existing contract (identical to the windowread.test expectations on this exact shape):
  assert.deepEqual(prof.dip.hours, [3, 4, 5], 'dip clusters the three morning hours (unchanged)');
  assert.deepEqual(prof.peak.hours, [15, 16, 17], 'peak clusters the three afternoon hours (unchanged)');
  assert.equal(prof.dip.level, 950, 'dip level = base−50 (unchanged)');
  assert.equal(prof.peak.level, 1070, 'peak level = base+70 (unchanged)');
  assert.equal(prof.trendDominates, false, 'flat base ⇒ no dominating trend (unchanged)');
  // the NEW additive fields exist on every hour and are sane:
  for (const h of prof.hours) {
    assert.ok('devMid' in h && 'devLowSpread' in h && 'devHiSpread' in h, 'new fields present on every hour');
    // a perfectly-repeating flat fixture ⇒ zero deviation dispersion (IQR of identical samples = 0)
    assert.equal(h.devLowSpread, 0, 'flat-shape fixture ⇒ per-hour low IQR is 0');
    assert.equal(h.devHiSpread, 0, 'flat-shape fixture ⇒ per-hour high IQR is 0');
  }
  const dipHr = prof.hours.find(x => x.h === 3);
  assert.equal(dipHr.devMid, -25, 'dip-hour mid deviation = (950+1010)/2 − 1005 baseline = −25');
});

ok('hourProfile: IQR reflects real day-to-day dispersion when the shape wobbles', () => {
  // wobble the dip depth day to day so the dip hour has a real spread of deviations
  const s = [];
  const depths = [40, 60, 40, 60, 40, 60, 40, 60];
  for (let di = 0; di < depths.length; di++) for (let h = 0; h < 24; h++) {
    const low = 1000 - ([3, 4, 5].includes(h) ? depths[di] : 0);
    const hi = 1000 + ([15, 16, 17].includes(h) ? 70 : 10);
    s.push(pt(ts(2026, 0, 1 + di, h), low, hi));
  }
  const prof = hourProfile(s, { nights: 14 });
  const dipHr = prof.hours.find(x => x.h === 3);
  assert.ok(dipHr.devLowSpread > 0, 'a wobbling dip depth ⇒ a positive low-deviation IQR');
});

// ── 2. THE BLOOD-RUNE GOLDEN ──────────────────────────────────────────────────────────────────────
// A flat-trend week with the dip at 03:00–05:00. "now" = 23:00, so the dip is ~4h ahead. Live is at the
// normal level (1000 instasell) — ABOVE a profitable 970 bid — but the projected trough is 950 ≤ 970.
ok('GOLDEN: not buyable at a profitable price now, but whenBuyable ≈ 4h at ~the projected trough', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const now = new Date(2026, 0, 10, 23, 0, 0);   // 23:00 local → the 03:00 dip is Δt=4
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now, phase: 'base', reliable: true });
  assert.equal(fc.reason, null, 'a clean based series forecasts (no degrade)');
  assert.ok(fc.forecast, 'forecast emitted');

  const TARGET = 970;                             // a profitable buy the item is currently ABOVE
  assert.ok(1000 > TARGET, 'the live instasell (1000) sits above the profitable target — not buyable now');

  const wb = whenBuyable(fc, TARGET);
  assert.ok(wb, 'the model says the target WILL be reachable within the horizon');
  approx(wb.etaH, 4, 1, 'the projected buyable moment is ~4 hours out');
  assert.ok(wb.projLevel <= TARGET, 'and the projected low there is at/under the target');
  approx(wb.projLevel, 950, 5, 'at ~the constructed diurnal trough (950)');

  // the trough scan agrees
  approx(fc.forecast.nextTrough.etaH, 4, 1, 'nextTrough eta lands on the dip ~4h ahead');
  approx(fc.forecast.nextTrough.level, 950, 5, 'nextTrough level ≈ the constructed dip low');
  assert.deepEqual(fc.forecast.nextTrough.atHours, [prof.dip.startH, prof.dip.endH], 'eta window = the dip cluster');
});

ok('anchor boundary condition: the current-hour projection reproduces ~the live price', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const now = new Date(2026, 0, 10, 23, 0, 0);
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now, phase: 'base', reliable: true });
  assert.equal(fc.forecast.baselineNow, 1005, 'baselineNow = liveMid − devMid(currentHour) = 1005 − 0');
  // Δt=24 wraps back to the current hour (23:00); with a flat trend its projected low == the live instasell
  const wrap = fc.forecast.series.find(s => s.etaH === FC_HORIZON_DEFAULT);
  assert.equal(wrap.h, 23, 'the 24h entry is the current hour again');
  assert.equal(wrap.projLow, 1000, 'and its projected low reproduces the live instasell (boundary condition)');
});

// ── 3. downtrend: the trough steps DOWN by ~slope·Δt (codified decay-trend projection) ─────────────
ok('downtrend: the projected trough steps down by ~the daily-low slope × Δt', () => {
  const prof = hourProfile(diurnal(10, { baseFn: di => 1000 - 10 * di }), { nights: 14 }); // −10/day
  const now = new Date(2026, 0, 10, 23, 0, 0);
  const liveLo = 1000 - 10 * 9;                   // last day's normal low = 910
  const fc = diurnalForecast(prof, { liveLo, liveHi: liveLo + 10, now, phase: 'base', reliable: true });
  assert.equal(fc.reason, null);
  approx(fc.forecast.trendPerHour, -10 / 24, 0.05, 'trendPerHour ≈ daily slope (−10) / 24');
  // the diurnal-only floor would be baselineNow + devLow(dip). The trend pulls it further DOWN by trend·Δt.
  const t = fc.forecast.nextTrough;
  const shapeOnlyFloor = fc.forecast.baselineNow - 55;  // devLow at the dip hour ≈ −55
  assert.ok(t.level < shapeOnlyFloor, 'the downtrend steps the trough below the pure-shape floor');
  approx(t.level, shapeOnlyFloor + fc.forecast.trendPerHour * t.etaH, 3, 'level ≈ baseline + trend·Δt + devLow');
});

// ── 4. the loud degrades ──────────────────────────────────────────────────────────────────────────
const cleanProf = () => hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
const noon = new Date(2026, 0, 10, 12, 0, 0);

ok('degrade: a spike/decay phase refuses (post-shock shape is not the recurring shape)', () => {
  assert.equal(diurnalForecast(cleanProf(), { liveLo: 1000, liveHi: 1010, now: noon, phase: 'spike', reliable: true }).reason, 'post-shock-shape');
  assert.equal(diurnalForecast(cleanProf(), { liveLo: 1000, liveHi: 1010, now: noon, phase: 'decay', reliable: true }).reason, 'post-shock-shape');
});
ok('degrade: a live band violation (breakdown/breakup) refuses', () => {
  assert.equal(diurnalForecast(cleanProf(), { liveLo: 1000, liveHi: 1010, now: noon, phase: 'base', mom: 'breakdown', reliable: true }).reason, 'band-violation-live');
});
ok('degrade: an unreliable quote refuses', () => {
  assert.equal(diurnalForecast(cleanProf(), { liveLo: 1000, liveHi: 1010, now: noon, phase: 'base', reliable: false }).reason, 'unreliable-quote');
});
ok('degrade: a thin/short (3-day) series is unprofilable → no-profile', () => {
  const prof = hourProfile(diurnal(3, { baseFn: () => 1000 }), { nights: 14 });
  assert.equal(prof, null, '3 days < HOURPROFILE_MIN_DAYS');
  assert.equal(diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now: noon, phase: 'base', reliable: true }).reason, 'no-profile');
});
ok('degrade: no live anchor refuses (the projection is anchored to the live print)', () => {
  assert.equal(diurnalForecast(cleanProf(), { now: noon, phase: 'base', reliable: true }).reason, 'no-anchor');
});

// ── 5. trend-dominates → the dip claim is withdrawn (trend-only mode; Ghrazi behavior) ────────────
ok('trend-dominates: the trough goes trend-only (eta dropped), the peak still forecasts', () => {
  const prof = hourProfile(diurnal(10, { baseFn: di => 900 + 50 * di }), { nights: 14 }); // rising ~50/day
  assert.equal(prof.trendDominates, true, 'the rising floor outpaces the intraday swing');
  const now = new Date(2026, 0, 10, 23, 0, 0);
  const liveLo = 900 + 50 * 9;                    // ~1350
  const fc = diurnalForecast(prof, { liveLo, liveHi: liveLo + 10, now, phase: 'base', reliable: true });
  assert.equal(fc.reason, null, 'trend-dominates does not fully refuse — it withdraws the dip claim only');
  assert.equal(fc.forecast.nextTrough.mode, 'trend-only', 'the trough side is trend-only');
  assert.equal(fc.forecast.nextTrough.etaH, null, 'no dip eta is claimed');
  assert.ok(/trend-dominates/.test(fc.forecast.nextTrough.note || ''), 'and it says why');
  assert.equal(fc.forecast.nextPeak.mode, 'diurnal', 'the peak (rising) side still forecasts');
  assert.ok(fc.forecast.nextPeak.etaH != null, 'the peak carries an eta');
});

// ── 6. the uncertainty band is monotonically NON-SHRINKING over the horizon ───────────────────────
ok('band: the projected band never narrows as the horizon grows', () => {
  const prof = hourProfile(diurnal(10, { baseFn: di => 1000 - 10 * di }), { nights: 14 }); // trend term grows
  const now = new Date(2026, 0, 10, 23, 0, 0);
  const fc = diurnalForecast(prof, { liveLo: 910, liveHi: 920, now, phase: 'base', reliable: true });
  let prevLow = -Infinity, prevHi = -Infinity;
  for (const s of fc.forecast.series) {
    const wLow = s.lowBand.hi - s.lowBand.lo, wHi = s.hiBand.hi - s.hiBand.lo;
    assert.ok(wLow >= prevLow - 1e-9, `low band width non-shrinking at Δt=${s.etaH}`);
    assert.ok(wHi >= prevHi - 1e-9, `high band width non-shrinking at Δt=${s.etaH}`);
    prevLow = wLow; prevHi = wHi;
  }
  const first = fc.forecast.series[0], last = fc.forecast.series[fc.forecast.series.length - 1];
  assert.ok((last.lowBand.hi - last.lowBand.lo) > (first.lowBand.hi - first.lowBand.lo),
    'a 24h projection is honestly wider than a near-term one');
});

// ── 7. whenSellable mirror + fmtEta ───────────────────────────────────────────────────────────────
ok('whenSellable: the first hour the projected high reaches a target ask', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const now = new Date(2026, 0, 10, 12, 0, 0);    // noon → the 15:00 peak is Δt=3
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now, phase: 'base', reliable: true });
  const ws = whenSellable(fc, 1065);              // peak projects to ~1070 ≥ 1065
  assert.ok(ws, 'the ask is reachable at the afternoon peak');
  approx(ws.etaH, 3, 1, 'the peak is ~3h out from noon');
  assert.ok(ws.projLevel >= 1065);
  assert.equal(whenSellable(fc, 5000), null, 'an unreachable ask returns null (an honest "not within 24h")');
});
ok('fmtEta: terse hour token', () => {
  assert.equal(fmtEta(4), '~4h');
  assert.equal(fmtEta(null), 'n/a');
  assert.equal(fmtEta(0), 'now');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
