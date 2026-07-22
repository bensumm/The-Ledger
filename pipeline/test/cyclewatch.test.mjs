#!/usr/bin/env node
/**
 * cyclewatch.test.mjs — the adaptive cycle-expectation loop (PLAN-OSCILLATION-CYCLE Chunk 4).
 *
 * Pins the load-bearing guarantees of pipeline/lib/cyclewatch.mjs:
 *   - The tracking-error revision fires correctly for BOTH an up-drift and a down-drift cycle via
 *     the SAME code path (trackError → sideRevision) — no branch on the drift sign. This is the
 *     symmetry pin: the two fixtures differ ONLY in the numbers the prior was recorded with.
 *   - Shallower/deeper dip and weaker/stronger peak each emit the right adjustment token and append
 *     an {expected, actual, adjustment} triple for calibration.
 *   - A band-breach sequence fires the inform-only ABORT note (and NO place/cancel action — this
 *     module has no offer surface at all; the ABORT is a string, nothing more).
 *   - A persistence round-trip mirroring watchstate.test.mjs: saveState/loadState reproduce the map.
 *
 * The RUNNING-EXTREME model: each tick carries the live spread as one `price`; the module accumulates
 * the cycle's realized MIN (trough) and MAX (peak) across ticks. A fixture therefore records near one
 * side of the cycle and then moves toward the side under test — so the realized extreme lands where
 * the scenario needs it, exactly as a live watch loop would accumulate it over a cycle.
 *
 * Synthetic fixtures only. Run: `node pipeline/test/cyclewatch.test.mjs` (exits non-zero on failure).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cycleTick, trackError, recordExpectation, bandHalf, shouldRecycle, cycleNoteLines,
  CYCLE_HISTORY_MAX, CYCLE_CONF_BAND_FRAC,
} from '../lib/cyclewatch.mjs';
import { loadState, saveState } from '../lib/watchstate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_800_000_000_000;         // arbitrary base ms
const HOUR = 3_600_000;
const rnd = v => Math.round(v);

// A cycle's drift-adjusted prior, as driftAdjustedExit (js/forecast.mjs) would return it. The KEY
// point (the corrected mechanism): the drift is already baked into the LEVELS — an up-drift cycle
// records a HIGHER expected peak, a down-drift cycle a LOWER one; the module never sees a drift sign.
const UP_DRIFT   = { driftAdjustedTrough: 30_000_000, driftAdjustedPeak: 34_000_000, confidence: 'med', holdHorizonDays: 1.5 };
const DOWN_DRIFT = { driftAdjustedTrough: 28_000_000, driftAdjustedPeak: 31_000_000, confidence: 'med', holdHorizonDays: 1.5 };

// One tick at a single live price (trough+peak actuals collapse to the current spread point). The
// module's running min/max accumulate the realized trough/peak across the ticks of a cycle.
const tickAt = (prior, id, price, { dae = null, now } = {}) =>
  cycleTick(prior, { identity: id, troughActual: price, peakActual: price, dae, now });

/* --- trackError: the direction-agnostic comparator ------------------------------------------- */
ok('trackError classifies by the sign of (actual − expected), never a drift sign', () => {
  const half = bandHalf(34_000_000, 'med');           // ±5% × 1.5 = ±7.5% ≈ 2.55m
  const above = trackError(34_000_000, 35_000_000, half);
  assert.equal(above.dir, 1);
  assert.equal(above.breach, false);
  const below = trackError(34_000_000, 33_000_000, half);
  assert.equal(below.dir, -1);
  const breach = trackError(34_000_000, 40_000_000, half);   // +6m ≫ ±2.55m band
  assert.equal(breach.breach, true);
  const tiny = trackError(34_000_000, 34_010_000, half);     // sub-threshold nudge is immaterial
  assert.equal(tiny.material, false);
});

/* --- recordExpectation + first-seen: record the prior, emit no revision ----------------------- */
ok('first observation records the prior (no revision, firstSeen)', () => {
  const t = tickAt(undefined, 'cyc:26235', 30_100_000, { dae: UP_DRIFT, now: T0 });
  assert.equal(t.firstSeen, true);
  assert.equal(t.notes.length, 0);
  assert.equal(t.triples.length, 0);
  assert.equal(t.state.expectedPeak, 34_000_000);
  assert.equal(t.state.expectedTrough, 30_000_000);
  assert.ok(t.state.bandPeakHalf > 0);
});

/* --- SYMMETRY: the SAME code path fires for an up-drift AND a down-drift cycle ---------------- */
// WEAKER peak: record near the trough, then the price lifts but FAILS to reach the expected peak
// (realized peak ~4% below the prior). For BOTH cycles it is the same code, different numbers.
ok('WEAKER peak fires the step-DOWN revision identically for up-drift and down-drift cycles', () => {
  for (const dae of [UP_DRIFT, DOWN_DRIFT]) {
    const first = tickAt(undefined, 'cyc:x', dae.driftAdjustedTrough, { dae, now: T0 });
    const weakPeak = rnd(dae.driftAdjustedPeak * 0.96);   // the cycle peaks ~4% below the prior
    const t = tickAt(first.state, 'cyc:x', weakPeak, { now: T0 + 6 * HOUR });
    const peakTriple = t.triples.find(x => x.side === 'peak');
    assert.ok(peakTriple, 'a weaker peak emits a peak triple');
    assert.equal(peakTriple.adjustment, 'step-down-weaker-peak');
    assert.equal(peakTriple.expected, dae.driftAdjustedPeak);
    assert.equal(peakTriple.actual, weakPeak);
    assert.ok(t.notes.some(n => /step the ask DOWN/.test(n)));
  }
});

ok('STRONGER peak fires the ladder-UP revision identically for up-drift and down-drift cycles', () => {
  for (const dae of [UP_DRIFT, DOWN_DRIFT]) {
    const first = tickAt(undefined, 'cyc:y', dae.driftAdjustedTrough, { dae, now: T0 });
    const strongPeak = rnd(dae.driftAdjustedPeak * 1.04);   // the cycle peaks ~4% ABOVE the prior
    const t = tickAt(first.state, 'cyc:y', strongPeak, { now: T0 + 6 * HOUR });
    const peakTriple = t.triples.find(x => x.side === 'peak');
    assert.equal(peakTriple.adjustment, 'ladder-up-stronger-peak');
    assert.equal(peakTriple.actual, strongPeak);
    assert.ok(t.notes.some(n => /ladder the ask UP/.test(n)));
  }
});

// SHALLOWER dip: record near the peak, then the price falls but does NOT reach the expected trough
// (realized dip ~4% above the prior). The expected trough is revised UP so a resting bid still fills.
ok('SHALLOWER dip fires bid-shallower AND revises the expected trough UP (same path both cycles)', () => {
  for (const dae of [UP_DRIFT, DOWN_DRIFT]) {
    const first = tickAt(undefined, 'cyc:z', dae.driftAdjustedPeak, { dae, now: T0 });
    const shallowDip = rnd(dae.driftAdjustedTrough * 1.04);   // dip bottoms ABOVE the expected trough
    const t = tickAt(first.state, 'cyc:z', shallowDip, { now: T0 + 6 * HOUR });
    const troughTriple = t.triples.find(x => x.side === 'trough');
    assert.equal(troughTriple.adjustment, 'bid-shallower');
    assert.equal(troughTriple.actual, shallowDip);
    assert.equal(t.state.expectedTrough, shallowDip, 'Te revised up to the shallower level');
    assert.ok(t.notes.some(n => /dip SHALLOWER/.test(n)));
    assert.ok(!t.triples.some(x => x.side === 'peak'), 'the peak stayed on-prior — no peak note pollutes');
  }
});

ok('DEEPER dip fires drop-bid-deeper (does NOT revise Te up) for both cycles', () => {
  for (const dae of [UP_DRIFT, DOWN_DRIFT]) {
    const first = tickAt(undefined, 'cyc:d', dae.driftAdjustedPeak, { dae, now: T0 });
    const deepDip = rnd(dae.driftAdjustedTrough * 0.96);   // dip bottoms BELOW the expected trough
    const t = tickAt(first.state, 'cyc:d', deepDip, { now: T0 + 6 * HOUR });
    const troughTriple = t.triples.find(x => x.side === 'trough');
    assert.equal(troughTriple.adjustment, 'drop-bid-deeper');
    assert.equal(troughTriple.actual, deepDip);
    assert.equal(t.state.expectedTrough, dae.driftAdjustedTrough, 'a deeper dip does not revise Te up');
    assert.ok(t.notes.some(n => /drop the bid/.test(n)));
  }
});

/* --- SYMMETRY, the direct disproof of a directional gate: same-magnitude opposite-drift pair --- */
ok('a same-magnitude opposite-drift pair produces the SAME adjustment token (no drift-sign branch)', () => {
  const mk = dae => {
    const first = tickAt(undefined, 'cyc:s', dae.driftAdjustedTrough, { dae, now: T0 });
    return tickAt(first.state, 'cyc:s', rnd(dae.driftAdjustedPeak * 0.96), { now: T0 + 6 * HOUR });
  };
  const up = mk(UP_DRIFT), down = mk(DOWN_DRIFT);
  assert.equal(up.triples.find(x => x.side === 'peak').adjustment, down.triples.find(x => x.side === 'peak').adjustment);
});

/* --- BAND BREACH → inform-only ABORT note, no place/cancel ------------------------------------ */
ok('a peak that never lifts (beyond the band) fires the inform-only ABORT note (no action taken)', () => {
  // record at the trough; the peak window passes and the price never lifts off the floor → the
  // realized peak stays ~12% below the prior, far beyond the ±7.5% band → the cycle rolled over.
  const first = tickAt(undefined, 'cyc:b', UP_DRIFT.driftAdjustedTrough, { dae: UP_DRIFT, now: T0 });
  const t = tickAt(first.state, 'cyc:b', UP_DRIFT.driftAdjustedTrough, { now: T0 + 6 * HOUR });
  const peakTriple = t.triples.find(x => x.side === 'peak');
  assert.equal(peakTriple.adjustment, 'abort-band-breach');
  const abortNote = t.notes.find(n => /ABORT-WATCH/.test(n));
  assert.ok(abortNote, 'the abort note fires');
  // ALERTS-never-places: the note is a STRING; it names no place/cancel and the tick returns no action.
  assert.match(abortNote, /no offer is placed\/cancelled/);
  assert.equal(t.state.expectedPeak, UP_DRIFT.driftAdjustedPeak, 'a breach does not silently rewrite the prior');
  // the tick's return has NO place/cancel field of any kind — the ONLY outputs are state + notes + triples.
  assert.deepEqual(Object.keys(t).sort(), ['firstSeen', 'notes', 'recycled', 'state', 'triples']);
});

/* --- reset policy: a stale gap / identity change RE-RECORDS the cycle ------------------------- */
ok('shouldRecycle: identity change and a gap beyond the cycle window re-record; a fresh gap does not', () => {
  const prior = { identity: 'cyc:a', ts: T0 };
  assert.equal(shouldRecycle(prior, 'cyc:a', T0 + HOUR), false);
  assert.equal(shouldRecycle(prior, 'cyc:OTHER', T0 + HOUR), true);
  assert.equal(shouldRecycle(prior, 'cyc:a', T0 + 3 * 24 * HOUR), true);   // > 2-day cycle stale window
  assert.equal(shouldRecycle(undefined, 'cyc:a', T0), false);              // first sight is not a reset
});

ok('a recycled tick re-records from the new dae and emits no revision', () => {
  const first = tickAt(undefined, 'cyc:r', 30_000_000, { dae: UP_DRIFT, now: T0 });
  const t = tickAt(first.state, 'cyc:r', 29_000_000, { dae: DOWN_DRIFT, now: T0 + 3 * 24 * HOUR });
  assert.equal(t.recycled, true);
  assert.equal(t.firstSeen, true);
  assert.equal(t.notes.length, 0);
  assert.equal(t.state.expectedPeak, 31_000_000, 'the new cycle records the fresh down-drift prior');
});

/* --- history is bounded + purity ------------------------------------------------------------- */
ok('the {expected,actual,adjustment} history is capped and inputs are never mutated', () => {
  let state = tickAt(undefined, 'cyc:h', 30_000_000, { dae: UP_DRIFT, now: T0 }).state;
  const firstFrozen = JSON.parse(JSON.stringify(state));
  const weak = rnd(34_000_000 * 0.96);
  for (let i = 0; i < CYCLE_HISTORY_MAX + 5; i++) {
    state = tickAt(state, 'cyc:h', weak, { now: T0 + (i + 1) * HOUR }).state;
  }
  assert.ok(state.history.length <= CYCLE_HISTORY_MAX, 'history is bounded');
  // re-running the first-seen tick reproduces the same state object (no cross-call mutation)
  const reFirst = tickAt(undefined, 'cyc:h', 30_000_000, { dae: UP_DRIFT, now: T0 });
  assert.deepEqual(JSON.parse(JSON.stringify(reFirst.state)), firstFrozen);
});

/* --- cycleNoteLines: caveat + nothing on a quiet pass ---------------------------------------- */
ok('cycleNoteLines carries the n≈0 caveat and is empty when there is nothing to say', () => {
  assert.deepEqual(cycleNoteLines("Osmumten's fang", { notes: [] }), []);
  const lines = cycleNoteLines("Osmumten's fang", { notes: ['peak WEAKER than the 34m prior — step the ask DOWN'] });
  assert.ok(lines.some(l => /cycle — Osmumten/.test(l)));
  assert.ok(lines.some(l => /PRIOR, not a validated forecast/.test(l)), 'the honesty caveat is present');
});

/* --- PERSISTENCE ROUND-TRIP (mirrors watchstate.test.mjs) ------------------------------------- */
ok('saveState/loadState round-trips the cycle-watch map byte-for-byte', () => {
  const tmp = path.join(os.tmpdir(), `cyclewatch-test-${process.pid}.json`);
  try {
    const map = {};
    const a = tickAt(undefined, 'cyc:1', 30_000_000, { dae: UP_DRIFT, now: T0 });
    map['26235'] = a.state;
    const b = tickAt(a.state, 'cyc:1', rnd(34_000_000 * 0.96), { now: T0 + 6 * HOUR });
    map['26235'] = b.state;
    saveState(tmp, map);
    const back = loadState(tmp);
    assert.deepEqual(back, JSON.parse(JSON.stringify(map)), 'the persisted map reloads identically');
    // a missing/corrupt file degrades to {} (the watchstate IO contract) — never throws
    assert.deepEqual(loadState(path.join(os.tmpdir(), 'cyclewatch-does-not-exist.json')), {});
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
});

ok('recordExpectation degrades to null on a dae with no usable levels', () => {
  assert.equal(recordExpectation(null), null);
  assert.equal(recordExpectation({ driftAdjustedTrough: null, driftAdjustedPeak: null }), null);
  assert.equal(bandHalf(null, 'high'), null);
  assert.ok(CYCLE_CONF_BAND_FRAC > 0);
});

console.log(`\nAll ${pass} checks passed.`);
