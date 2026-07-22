#!/usr/bin/env node
/**
 * oscillation-shadow.test.mjs — acceptance fixtures for PLAN-OSCILLATION-CYCLE Chunk 2: the amplitude
 * lane SHADOW-LOGS the drift-adjusted margin alongside the naive ampBid/ampAsk (INFORM-ONLY, no gate).
 * Pins the wiring, not a gate (Chunk 2 gates on nothing — Chunk 3 does).
 *
 * PURE over synthetic fixtures — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/oscillation-shadow.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - the amplitude shadow block (suggestlog.amplitudeShadow) carries BOTH the naive pair (ampBid/ampAsk)
 *     AND the drift-adjusted margin block (`drift.margin` + `drift.driftAdjustedPeak`).
 *   - the drift-adjusted margin is computed by the SAME arithmetic for a same-magnitude opposite-sign
 *     slope pair — the DIRECT regression guard against ever re-introducing a directional gate: margin is a
 *     pure function of driftAdjustedPeak through the ONE afterTax path, with no branch on the drift's sign.
 *   - driftExitFrom sources the ceiling/floor slope from the in-hand windowStats().days (floorCeilingTrack)
 *     with NO fetch, and degrades cleanly (slopes null ⇒ naive levels pass through; a down-drift days
 *     fixture pulls driftAdjustedPeak below naive).
 *   - the drift block is a LEAN field — absent when the exit projection degraded (historical rows unchanged).
 */
import assert from 'node:assert/strict';
import { tax } from '../../js/money-math.js';
import { hourProfile } from '../../js/windowread.mjs';
import { diurnalForecast, driftAdjustedExit, driftExitFrom } from '../../js/forecast.mjs';
import { amplitudeDriftMargin, AMP_DRIFT_REQ_MARGIN } from '../../js/amplitudescreen.mjs';
import { amplitudeShadow } from '../lib/suggestlog.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const afterTax = p => p - tax(p);

console.log('PLAN-OSCILLATION-CYCLE Chunk 2 acceptance:');

// helpers -----------------------------------------------------------------------------------------
const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi, volLo = 20, volHi = 20) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });

// A diurnal 1h fixture (evening dip + afternoon peak per day) whose per-day base follows baseFn(di).
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
// a windowStats().days-shaped array from per-day mids (band ±5), oldest→newest.
const daysFromMids = mids => mids.map((m, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, { low: m - 5, hi: m + 5 }]);

// a minimal amplitudeRanges-shaped fixture (only the fields amplitudeShadow reads).
const arFixture = ({ ampBid = 1000, ampAsk = 1100 } = {}) => ({
  hasData: true, ampBid, ampAsk, nDays: 10, medAmpPct: 0.03,
  bidTouch: { recentHit: 2, recentDays: 3 }, askReach: { recentHit: 2, recentDays: 3 },
});

// ── 1. the shadow block carries BOTH the naive pair AND the drift-adjusted margin ─────────────────
ok('shadow: amplitudeShadow logs the naive ampBid/ampAsk AND the drift.margin block together', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true });
  const dae = driftAdjustedExit(fc, { ceilingSlope: -40, floorSlope: -40 });
  const drift = amplitudeDriftMargin(dae, { entry: 1000 });
  const o = amplitudeShadow(arFixture(), { holdDays: 1.5, drift });
  // naive pair still present (unchanged shape)
  assert.equal(o.ampBid, 1000, 'naive trough-bid preserved');
  assert.equal(o.ampAsk, 1100, 'naive peak-ask preserved');
  // AND the drift block rides alongside
  assert.ok(o.drift, 'the drift block is logged alongside the naive pair');
  assert.equal(typeof o.drift.margin, 'number', 'drift.margin is a number');
  assert.equal(typeof o.drift.driftAdjustedPeak, 'number', 'drift.driftAdjustedPeak is a number');
  assert.equal(o.drift.requiredMargin, AMP_DRIFT_REQ_MARGIN, 'the requiredMargin buffer is the shared placeholder');
});

// ── 2. LEAN field: no drift block when the exit projection degraded (historical rows unchanged) ────
ok('shadow: the drift field is absent when the projection degrades (lean-field, no shape churn)', () => {
  const o = amplitudeShadow(arFixture(), { holdDays: 1.5, drift: amplitudeDriftMargin(null, { entry: 1000 }) });
  assert.ok(!('drift' in o), 'null drift ⇒ no drift key (historical rows keep their shape)');
  assert.equal(o.ampBid, 1000, 'the naive pair is still logged');
});

// ── 3. DIRECTION-AGNOSTIC: the margin is the SAME arithmetic for opposite-sign, same-magnitude slopes ─
ok('margin: computed identically for a +slope and −slope pair (no directional branch)', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true });
  const entry = 1000;

  const upDae = driftAdjustedExit(fc, { ceilingSlope: +60, floorSlope: +60 });
  const downDae = driftAdjustedExit(fc, { ceilingSlope: -60, floorSlope: -60 });
  // the RAW (unrounded) driftAdjustedPeak lands equidistant either side of naive (Chunk 1 symmetry) — the
  // direction only ever flips the sign of the shift, via the SAME arithmetic (proven on the raw numbers so a
  // ±1 display-rounding step can't mask an asymmetry).
  const naive = upDae.naivePeak;
  assert.equal(upDae.naivePeak, downDae.naivePeak, 'same naive anchor');
  assert.equal(upDae.driftAdjustedPeak - naive, naive - downDae.driftAdjustedPeak, 'raw peaks symmetric around naive (no directional asymmetry)');

  const up = amplitudeDriftMargin(upDae, { entry });
  const down = amplitudeDriftMargin(downDae, { entry });
  // the margin is a PURE function of the driftAdjustedPeak through the ONE afterTax path — the SAME expression
  // for both signs (the direct guard: a directional branch would make one side diverge from this formula).
  assert.equal(up.margin, Math.round(afterTax(upDae.driftAdjustedPeak) - entry - up.requiredMargin), 'up margin = round(afterTax(peak) − entry − req)');
  assert.equal(down.margin, Math.round(afterTax(downDae.driftAdjustedPeak) - entry - down.requiredMargin), 'down margin = round(afterTax(peak) − entry − req) — identical formula');
  // an up-drift peak nets strictly more than a down-drift peak (monotone), confirming the sign flows through:
  assert.ok(up.margin > down.margin, 'up-drift margin exceeds down-drift margin (the drift number, not a gate, moves it)');
});

// ── 4. driftExitFrom sources the slope from windowStats().days — NO fetch — and degrades cleanly ───
ok('driftExitFrom: a DOWN-drifting days series pulls driftAdjustedPeak below naive (slope from in-hand days)', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const ctx = { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true };
  const naive = diurnalForecast(prof, ctx).forecast.nextPeak.level;

  const downDays = daysFromMids([1300, 1270, 1240, 1210, 1180, 1150, 1120, 1090]);   // steadily falling ceiling
  const dae = driftExitFrom(prof, downDays, ctx, { holdHorizonDays: 1.5 });
  assert.ok(dae, 'a readable series + clean forecast ⇒ an exit projection');
  assert.equal(dae.naivePeak, naive, 'the un-adjusted half equals diurnalForecast nextPeak.level');
  assert.ok(dae.ceilingSlope != null && dae.ceilingSlope < 0, `ceiling slope sourced from the days series is negative (got ${dae.ceilingSlope})`);
  assert.ok(dae.driftAdjustedPeak < naive, `down-drift ⇒ adjusted peak (${dae.driftAdjustedPeak}) below naive (${naive})`);

  const drift = amplitudeDriftMargin(dae, { entry: 1000 });
  assert.ok(drift && typeof drift.margin === 'number', 'the margin folds cleanly into the shadow block');
});

ok('driftExitFrom: too-thin a days series ⇒ slopes null ⇒ naive levels pass through unshifted', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  const ctx = { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true };
  const naive = diurnalForecast(prof, ctx).forecast.nextPeak.level;
  const dae = driftExitFrom(prof, daysFromMids([1000, 1005]), ctx, { holdHorizonDays: 1.5 });   // < FC_MIN_DAYS
  assert.ok(dae, 'the forecast still emits');
  assert.equal(dae.ceilingSlope, null, 'no slope from a thin series (degrade, never a fake number)');
  assert.equal(dae.driftAdjustedPeak, naive, 'unshifted peak passes through');
});

ok('driftExitFrom: a degraded forecast ⇒ null (never a fake margin)', () => {
  const prof = hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
  // an unreliable quote refuses the forecast → driftAdjustedExit(null) → null
  const dae = driftExitFrom(prof, daysFromMids([1000, 990, 980, 970, 960, 950]), { liveLo: 1000, liveHi: 1010, reliable: false });
  assert.equal(dae, null, 'refused forecast ⇒ null exit projection');
  assert.equal(amplitudeDriftMargin(dae, { entry: 1000 }), null, 'null dae ⇒ null margin');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
