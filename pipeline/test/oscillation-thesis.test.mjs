#!/usr/bin/env node
/**
 * oscillation-thesis.test.mjs — acceptance fixtures for PLAN-OSCILLATION-CYCLE Chunk 6: the per-thesis
 * drift-adjusted-exit INFORM note (band/churn/scalp/value). The drift number is wired into each thesis's
 * per-spec `driftInform` framing + the shared `driftInformNote` formatter — INFORM EVERYWHERE, NO gate.
 * These pins guard the DIRECTION-AGNOSTIC arithmetic + the inform-only contract, NOT any gate (Chunk 6
 * gates on nothing — Chunk 3's amplitude margin is the program's only gate).
 *
 * PURE over synthetic fixtures — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/oscillation-thesis.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - band/churn/scalp/value each declare a `driftInform` label and surface a drift-adjusted-exit note via
 *     the ONE `driftInformNote` helper; a spec WITHOUT driftInform (amplitude — its own margin gate) → null.
 *   - the note is INFORM-ONLY: it exposes NO gate/reject/status field — it CANNOT change admission (it is a
 *     pure descriptor a render path pushes to a note array), and it carries an n≈0 inform label (rule 4).
 *   - the ALDARIUM regression pin: a RISING floor + a FADING ceiling prices the drift-adjusted top LOWER
 *     (delta < 0), NOT bullish — no thesis silently treats "rising" as good (the corrected-mechanism ruling).
 *   - a same-magnitude opposite-sign drift moves the note by the IDENTICAL arithmetic (the direct guard
 *     against re-introducing a directional gate): level−naive is equal-and-opposite, margin uses one formula.
 */
import assert from 'node:assert/strict';
import { tax } from '../../js/money-math.js';
import { hourProfile } from '../../js/windowread.mjs';
import { diurnalForecast, driftAdjustedExit, driftExitFrom } from '../../js/forecast.mjs';
import { FLIP_NICHES, driftInformNote, DRIFT_NEAR_HIGH_FRAC } from '../../js/flip-niches.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const afterTax = p => p - tax(p);
const THESES = ['band', 'churn', 'scalp', 'value'];

console.log('PLAN-OSCILLATION-CYCLE Chunk 6 acceptance:');

// helpers -----------------------------------------------------------------------------------------
const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi) => ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: 20, highPriceVolume: 20 });

// A flat-base diurnal 1h fixture (evening dip + afternoon peak) → a clean naive peak/trough.
function diurnal(days, { baseFn, dipHours = [3, 4, 5], peakHours = [15, 16, 17], dipD = 50, peakD = 70 } = {}) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = baseFn(di);
    s.push(pt(ts(2026, 0, 1 + di, h), base - (dipHours.includes(h) ? dipD : 0), base + (peakHours.includes(h) ? peakD : 10)));
  }
  return s;
}
// a windowStats().days-shaped array with INDEPENDENT low/hi trajectories, oldest→newest.
const daysFrom = (lows, his) => lows.map((lo, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, { low: lo, hi: his[i] }]);

const flatProf = () => hourProfile(diurnal(10, { baseFn: () => 1000 }), { nights: 14 });
const cleanFc = () => diurnalForecast(flatProf(), { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true });

// ── 1. every thesis declares a driftInform label + surfaces a note; a non-opted spec → null ────────
ok('each of band/churn/scalp/value declares a driftInform label and surfaces a drift-exit note', () => {
  const dae = driftAdjustedExit(cleanFc(), { ceilingSlope: -40, floorSlope: -40 });
  for (const k of THESES) {
    assert.ok(FLIP_NICHES[k].driftInform && typeof FLIP_NICHES[k].driftInform.label === 'string' && FLIP_NICHES[k].driftInform.label,
      `${k} declares a driftInform.label`);
    const note = driftInformNote(FLIP_NICHES[k], dae, { entry: 950 });
    assert.ok(note, `${k} surfaces a note`);
    assert.equal(note.key, 'drift-exit', `${k} note key`);
    assert.ok(note.text.includes(FLIP_NICHES[k].driftInform.label), `${k} note text carries its thesis label`);
    assert.match(note.text, /n≈0 inform, not a gate/, `${k} note carries the n≈0 inform label (rule 4)`);
  }
});

ok('a spec WITHOUT driftInform (amplitude — its own margin gate) yields NO note (opt-in only)', () => {
  const dae = driftAdjustedExit(cleanFc(), { ceilingSlope: -40 });
  assert.equal(FLIP_NICHES.amplitude.driftInform, undefined, 'amplitude does not opt into the per-thesis note');
  assert.equal(driftInformNote(FLIP_NICHES.amplitude, dae, { entry: 950 }), null, 'no driftInform ⇒ null note');
});

// ── 2. INFORM-ONLY: the note is a pure descriptor with NO gate/reject/status field ────────────────
ok('the note exposes NO gate/reject/status/pass field — it cannot change admission', () => {
  const dae = driftAdjustedExit(cleanFc(), { ceilingSlope: -40, floorSlope: -40 });
  const note = driftInformNote(FLIP_NICHES.band, dae, { entry: 950 });
  for (const banned of ['gate', 'reject', 'status', 'pass', 'drop', 'admit', 'verdict']) {
    assert.ok(!(banned in note), `no '${banned}' field on the inform note (it is decision support, not a gate)`);
  }
  // the contracted inform fields are present
  for (const f of ['level', 'naive', 'delta', 'margin', 'text']) assert.ok(f in note, `note carries ${f}`);
});

ok('a degraded projection ⇒ null note (honest degrade, never a fake note)', () => {
  assert.equal(driftInformNote(FLIP_NICHES.band, null, { entry: 950 }), null, 'null dae ⇒ null note');
  assert.equal(driftInformNote(FLIP_NICHES.band, { driftAdjustedPeak: null, naivePeak: 1000 }, {}), null, 'no peak ⇒ null note');
});

// ── 3. ALDARIUM regression pin: rising floor + fading ceiling prices the top LOWER (not bullish) ───
ok('ALDARIUM: a RISING floor + a FADING ceiling drift-adjusts the top BELOW naive (delta < 0) — no thesis reads rising as good', () => {
  const prof = flatProf();
  const ctx = { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true };
  const naive = diurnalForecast(prof, ctx).forecast.nextPeak.level;
  // floor RISES 100→120 while ceiling FADES 140→128 across 8 days (the Aldarium mirage: compressing-up).
  const lows = [100, 103, 106, 109, 112, 115, 117, 120];
  const his  = [140, 138, 136, 134, 132, 130, 129, 128];
  const dae = driftExitFrom(prof, daysFrom(lows, his), ctx, { holdHorizonDays: 1.5 });
  assert.ok(dae, 'a readable series + clean forecast ⇒ an exit projection');
  assert.ok(dae.ceilingSlope < 0, `the ceiling slope is NEGATIVE despite the rising floor (got ${dae.ceilingSlope})`);
  assert.ok(dae.floorSlope > 0, `the floor slope is POSITIVE (rising floor) (got ${dae.floorSlope})`);
  assert.ok(dae.driftAdjustedPeak < naive, `drift-adjusted top (${dae.driftAdjustedPeak}) priced BELOW naive (${naive})`);
  // and EVERY thesis's note reports that lower number — none flips the fading ceiling into a bullish read.
  for (const k of THESES) {
    const note = driftInformNote(FLIP_NICHES[k], dae, { entry: dae.naiveTrough, fmt: String });
    assert.ok(note.delta < 0, `${k}: the note's drift shift is NEGATIVE (a fading ceiling, not "rising = good")`);
    assert.ok(note.level < note.naive, `${k}: level below naive`);
  }
});

// ── 4. DIRECTION-AGNOSTIC: same-magnitude opposite-sign drift ⇒ IDENTICAL arithmetic ──────────────
ok('the note is the SAME arithmetic for a +slope and −slope pair (no directional branch)', () => {
  const fc = cleanFc();
  const entry = 950;
  const upDae = driftAdjustedExit(fc, { ceilingSlope: +60, floorSlope: +60 });
  const downDae = driftAdjustedExit(fc, { ceilingSlope: -60, floorSlope: -60 });
  for (const k of THESES) {
    const up = driftInformNote(FLIP_NICHES[k], upDae, { entry, fmt: String });
    const down = driftInformNote(FLIP_NICHES[k], downDae, { entry, fmt: String });
    // level−naive is equal-and-opposite up to a ±1 DISPLAY-rounding step (the RAW driftAdjustedPeak is exactly
    // symmetric — pinned on the un-rounded numbers in oscillation-cycle/shadow tests; the note rounds for
    // display). The point: ONE arithmetic, applied identically to both signs — no directional branch.
    assert.equal(upDae.driftAdjustedPeak - upDae.naivePeak, -(downDae.driftAdjustedPeak - downDae.naivePeak), `${k}: RAW drift shift equal-and-opposite (no directional asymmetry)`);
    assert.ok(Math.abs(up.delta + down.delta) <= 1, `${k}: displayed +drift/−drift deltas equal-and-opposite (±1 rounding), got ${up.delta} / ${down.delta}`);
    // the margin is a PURE function of the level through the ONE afterTax path — identical formula both signs
    assert.equal(up.margin, Math.round(afterTax(up.level) - entry), `${k}: up margin = round(afterTax(level) − entry)`);
    assert.equal(down.margin, Math.round(afterTax(down.level) - entry), `${k}: down margin = round(afterTax(level) − entry) — identical formula`);
    assert.ok(up.margin > down.margin, `${k}: up-drift margin exceeds down-drift margin (the drift number, not a gate, moves it)`);
  }
});

// ── 5. the churn "near the high" flag is a MAGNITUDE fraction (not a direction test) ──────────────
ok('the near-high flag is a pure magnitude read (|level − entry| ≤ frac × level), sign-independent', () => {
  const dae = driftAdjustedExit(cleanFc(), { ceilingSlope: -40 });
  const level = Math.round(dae.driftAdjustedPeak);
  const nearEntry = level - Math.floor(DRIFT_NEAR_HIGH_FRAC * level * 0.5);   // well within the near band
  const farEntry = level - Math.ceil(DRIFT_NEAR_HIGH_FRAC * level * 2);       // outside it
  assert.equal(driftInformNote(FLIP_NICHES.churn, dae, { entry: nearEntry }).near, true, 'entry within frac×level → near');
  assert.equal(driftInformNote(FLIP_NICHES.churn, dae, { entry: farEntry }).near, false, 'entry beyond frac×level → not near');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
