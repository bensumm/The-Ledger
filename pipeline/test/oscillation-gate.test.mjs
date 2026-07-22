#!/usr/bin/env node
/**
 * oscillation-gate.test.mjs — acceptance fixtures for PLAN-OSCILLATION-CYCLE Chunk 3: the drift-adjusted
 * margin BECOMES the gate — THE ONLY GATE in the whole program. Two separately-tested changes:
 *   (A) amplitudeGate gains a `margin-below-floor` reject computed from amplitudeDriftMargin vs the floor.
 *   (B) the knife guard is TEMPERED by oscillationVsKnife — a drift-riding oscillator is not a false knife.
 *
 * PURE over synthetic fixtures — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/oscillation-gate.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (the load-bearing regression pins — diff a change against these):
 *   - a FANG down-leg (drift-adjusted exit genuinely below entry after tax) → rejected on
 *     `margin-below-floor` — the CORRECT reason, NOT "falling", NOT "knife".
 *   - the ALDARIUM shape (rising FLOOR / +1,147-per-day floor drift BUT a collapsed amplitude / fading
 *     ceiling) → ALSO rejected on `margin-below-floor`. The single most important pin: the concrete disproof
 *     that a "rising floor" is EVER rewarded — the margin rides the CEILING (fading), never the floor.
 *   - a healthy oscillator (drift-adjusted margin clearly positive) → PASSES the margin gate.
 *   - (B) a down-drift oscillator the raw knife signal fires on → NOT rejected as `knife` (oscillating) and
 *     instead reaches the margin gate; a genuine monotone knife → still rejected as `knife`.
 *   - DIRECTION-AGNOSTIC: the reject decision is identical arithmetic for a same-magnitude opposite-sign
 *     drift pair (differing only by the margin's VALUE, never a branch).
 *   - the margin gate is sequenced AFTER knife (a knife is attributed to `knife`, not `margin`).
 *   - degrade-OPEN: a null/absent driftMargin (projection degraded) is NOT a reject.
 */
import assert from 'node:assert/strict';
import { tax } from '../../js/money-math.js';
import { hourProfile } from '../../js/windowread.mjs';
import { diurnalForecast, driftAdjustedExit } from '../../js/forecast.mjs';
import { amplitudeGate, amplitudeDriftMargin, AMP_DRIFT_REQ_MARGIN } from '../../js/amplitudescreen.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const afterTax = p => p - tax(p);

console.log('PLAN-OSCILLATION-CYCLE Chunk 3 acceptance (the margin gate + the knife temper):');

// helpers -----------------------------------------------------------------------------------------
const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi, volLo = 20, volHi = 20) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });

// A diurnal 1h fixture: evening dip + afternoon peak per day, around a per-day base (dipD/peakD control
// the AMPLITUDE — small dipD+peakD relative to `base` is a "collapsed amplitude" the tax alone sinks).
function diurnal(days, { baseFn, dipHours = [3, 4, 5], peakHours = [15, 16, 17], dipD, peakD } = {}) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = baseFn(di);
    const low = base - (dipHours.includes(h) ? dipD : 0);
    const hi = base + (peakHours.includes(h) ? peakD : Math.round(peakD / 7));
    s.push(pt(ts(2026, 0, 1 + di, h), low, hi));
  }
  return s;
}

// An `ar` (amplitudeRanges result) that PASSES every gate BEFORE the trend/knife/margin stage — data
// present, amplitude over the floor, both legs reachable — so a test can isolate exactly which of the
// later rejects fires. amplitudeGate reads only these fields (hasData, medAmpPct, bidTouch, askReach).
const goodLeg = () => ({ staleOptimistic: false, recentDays: 3, recentHit: 2, fullN: 8, fullFrac: 0.8 });
const passingAr = (over = {}) => ({ hasData: true, medAmpPct: 0.03, bidTouch: goodLeg(), askReach: goodLeg(), ...over });

// Build a REAL drift-adjusted margin from the actual arithmetic (diurnalForecast → driftAdjustedExit →
// amplitudeDriftMargin), so these pins exercise the load-bearing math, not a hand-set number.
function realDriftMargin({ base, dipD, peakD, entry, ceilingSlope, floorSlope = ceilingSlope }) {
  const prof = hourProfile(diurnal(12, { baseFn: () => base, dipD, peakD }), { nights: 14 });
  const fc = diurnalForecast(prof, {
    liveLo: base - Math.round(dipD / 2), liveHi: base + Math.round(peakD / 2),
    now: new Date(2026, 0, 12, 12), phase: 'base', reliable: true,
  });
  assert.equal(fc.reason, null, 'fixture forecasts cleanly');
  const dae = driftAdjustedExit(fc, { ceilingSlope, floorSlope });
  return { dae, drift: amplitudeDriftMargin(dae, { entry }) };
}

// ── 1. FANG down-leg → rejected on margin-below-floor (NOT falling, NOT knife) ────────────────────
ok('fang down-leg: drift-adjusted exit below entry after tax → margin-below-floor (correct reason)', () => {
  // fang ~32m, a modest daily swing, a DOWN ceiling drift (down-leg of the multi-week cycle). entry (the
  // trough-bid) is set just below base; the down drift + the 2% tax pull the drift-adjusted peak's after-tax
  // value below entry → a genuinely negative margin.
  const { drift } = realDriftMargin({ base: 32_000_000, dipD: 200_000, peakD: 200_000, entry: 31_900_000, ceilingSlope: -400_000 });
  assert.ok(drift && drift.margin < 0, `fixture is genuinely sub-floor after tax (margin=${drift && drift.margin})`);
  const g = amplitudeGate(passingAr(), { trendDominates: false, knife: false, oscillating: false, driftMargin: drift });
  assert.equal(g.pass, false, 'the fang down-leg is dropped');
  assert.equal(g.reason, 'margin-below-floor', `dropped on the drift-adjusted margin, not "trend"/"knife" (got ${g.reason})`);
});

// ── 2. ALDARIUM: rising FLOOR (+1,147/day) + collapsed amplitude → ALSO margin-below-floor ─────────
// THE single most important pin: a "rising floor" is NEVER rewarded. The margin rides the CEILING (fading,
// ~flat) — the +1,147/day is the FLOOR slope, which only shifts the trough, never the exit peak.
ok('aldarium: rising floor +1,147/day BUT collapsed amplitude → margin-below-floor (rising floor NOT rewarded)', () => {
  // collapsed amplitude: a tiny daily swing on a big-ticket, so the after-tax peak barely clears — the tax
  // alone sinks it. ceilingSlope ~ 0 (the FADING ceiling of a compressing-up shape); floorSlope = +1,147.
  const { drift } = realDriftMargin({
    base: 5_000_000, dipD: 30_000, peakD: 30_000, entry: 4_975_000,
    ceilingSlope: 0, floorSlope: 1147,
  });
  assert.ok(drift && drift.floorSlope === 1147, 'the rising-floor drift number is present (+1,147/day)');
  assert.ok(drift.margin <= 0, `the collapsed amplitude leaves a sub-floor margin despite the rising floor (margin=${drift.margin})`);
  const g = amplitudeGate(passingAr(), { driftMargin: drift });
  assert.equal(g.reason, 'margin-below-floor', 'the rising floor does NOT rescue a fading ceiling — rejected on the margin');
});

// ── 3. a healthy oscillator → PASSES the margin gate ──────────────────────────────────────────────
ok('healthy oscillator: drift-adjusted margin clearly positive → PASSES', () => {
  // a wide daily swing (~8%) whose after-tax peak clears entry by a wide margin, even with a mild DOWN drift
  // (falling ≠ auto-bad — the amended per-strategy falling doctrine): the amplitude covers drift + tax.
  const { drift } = realDriftMargin({ base: 5_000_000, dipD: 100_000, peakD: 500_000, entry: 4_900_000, ceilingSlope: -20_000 });
  assert.ok(drift && drift.margin > 0, `fixture clears the floor (margin=${drift && drift.margin})`);
  const g = amplitudeGate(passingAr(), { driftMargin: drift });
  assert.equal(g.pass, true, 'a healthy oscillator survives the margin gate');
  assert.equal(g.reason, null);
});

// ── 4. (B) the knife TEMPER — a drift-riding oscillator is not a false knife ───────────────────────
ok('(B) temper: knife signal + oscillating=true → NOT rejected as knife; reaches the margin gate', () => {
  const { drift } = realDriftMargin({ base: 5_000_000, dipD: 100_000, peakD: 500_000, entry: 4_900_000, ceilingSlope: -20_000 });
  assert.ok(drift.margin > 0, 'the oscillator clears the margin');
  // raw knife fires (a down-drift can look like a knife to the 1h trajectory), BUT oscillationVsKnife says
  // it oscillates → the knife reject is skipped and the item passes the margin gate.
  const g = amplitudeGate(passingAr(), { knife: true, oscillating: true, driftMargin: drift });
  assert.equal(g.pass, true, 'the tempered knife falls through to the margin gate and passes');
  assert.notEqual(g.reason, 'knife', 'it is NOT killed as a false knife');
});

ok('(B) temper: knife signal + oscillating=true but sub-floor margin → margin-below-floor (fell THROUGH knife)', () => {
  // the temper only LOOSENS the knife guard — it is safe because the margin gate still has final say. A
  // tempered knife with a negative margin is dropped on `margin-below-floor`, NOT `knife` — proving it
  // actually reached the margin stage rather than being admitted outright.
  const { drift } = realDriftMargin({ base: 32_000_000, dipD: 200_000, peakD: 200_000, entry: 31_900_000, ceilingSlope: -400_000 });
  assert.ok(drift.margin < 0, 'sub-floor margin');
  const g = amplitudeGate(passingAr(), { knife: true, oscillating: true, driftMargin: drift });
  assert.equal(g.reason, 'margin-below-floor', 'tempered knife + sub-floor margin → dropped by the margin gate, not the knife guard');
});

ok('(B) temper: a GENUINE monotone knife (oscillating=false) → still rejected as knife', () => {
  const { drift } = realDriftMargin({ base: 5_000_000, dipD: 100_000, peakD: 500_000, entry: 4_900_000, ceilingSlope: -20_000 });
  assert.ok(drift.margin > 0, 'the margin would pass — so a knife reject here proves knife is sequenced BEFORE margin');
  const g = amplitudeGate(passingAr(), { knife: true, oscillating: false, driftMargin: drift });
  assert.equal(g.pass, false, 'a true monotone knife is still dropped');
  assert.equal(g.reason, 'knife', 'attributed to knife (sequenced before margin), not margin-below-floor');
});

// ── 5. DIRECTION-AGNOSTIC — identical arithmetic for a same-magnitude opposite-sign drift pair ─────
ok('direction-agnostic: an up/down slope pair rejects/passes by the margin VALUE alone, one code path', () => {
  const prof = hourProfile(diurnal(12, { baseFn: () => 5_000_000, dipD: 60_000, peakD: 60_000 }), { nights: 14 });
  const fc = diurnalForecast(prof, { liveLo: 4_970_000, liveHi: 5_030_000, now: new Date(2026, 0, 12, 12), phase: 'base', reliable: true });
  const entry = 4_980_000;
  const up = amplitudeDriftMargin(driftAdjustedExit(fc, { ceilingSlope: +250_000, floorSlope: +250_000 }), { entry });
  const down = amplitudeDriftMargin(driftAdjustedExit(fc, { ceilingSlope: -250_000, floorSlope: -250_000 }), { entry });
  // the margin arithmetic is a pure function of driftAdjustedPeak through the ONE afterTax path — the SAME
  // expression for BOTH signs (a directional branch would make one diverge from this closed form).
  assert.equal(up.margin, Math.round(afterTax(up.driftAdjustedPeak) - entry - up.requiredMargin), 'up = round(afterTax(peak) − entry − req)');
  assert.equal(down.margin, Math.round(afterTax(down.driftAdjustedPeak) - entry - down.requiredMargin), 'down = same closed form');
  assert.ok(up.margin > down.margin, 'only the drift NUMBER (not a branch) separates the two margins');
  // and the gate DECISION follows the value alone, through the identical call: up admits, down rejects.
  const gUp = amplitudeGate(passingAr(), { driftMargin: up });
  const gDown = amplitudeGate(passingAr(), { driftMargin: down });
  assert.equal(gUp.pass, true, 'the up-drift margin clears the floor');
  assert.equal(gDown.reason, 'margin-below-floor', 'the down-drift margin is sub-floor — same gate, same arithmetic, opposite outcome');
});

// ── 6. degrade-OPEN + floor reuse — a null margin is NOT a reject; the floor is the shared placeholder ──
ok('degrade-open: a null/absent driftMargin does NOT reject (projection degraded ≠ a fake rejection)', () => {
  assert.equal(amplitudeGate(passingAr(), { driftMargin: null }).pass, true, 'null margin passes the margin gate (degrade-open)');
  assert.equal(amplitudeGate(passingAr(), {}).pass, true, 'absent margin option passes too');
  // and the floor the gate reuses is the ONE shared placeholder (already subtracted inside .margin).
  assert.equal(AMP_DRIFT_REQ_MARGIN, 0, 'the shared placeholder floor (Chunk 2/3 one-home) is 0 gp, n≈0');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
