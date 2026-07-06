#!/usr/bin/env node
/**
 * watchstate.test.mjs — the watch loop's PURE cross-pass temporal memory (chunk V1).
 *
 * watchstate.mjs is the OUTPUT-ONLY memory layer watch.mjs owns OUTSIDE the pure momVerdict:
 * per-pass deltas + a consecutive-underwater counter that RESETS on identity change or a stale
 * gap. This pins the counting/reset rules so a future editor can't silently let a stale count
 * leak across a re-buy or an overnight pause.
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - First sighting (no prior) yields NO cross-pass deltas — nothing consecutive to compare —
 *     but initialises passesUnderwater to 1 when the fresh observation is already underwater.
 *   - Δ instabuy carries the signed magnitude + direction; a pass with no prior emits null.
 *   - A momentum transition string reads prior.mom→cur.mom, and momChanged is exactly their !==.
 *   - passesUnderwater increments only while CONSECUTIVE + underwater, and RESETS to (re-count) on
 *     (a) a changed identity (a re-bought lot / re-priced offer) and (b) a gap > STALE_GAP_MS.
 *   - Band-top drift classifies rising / flat / decaying over the retained history.
 *   - advanceState never mutates its inputs and produces the entry the next pass compares against.
 *
 * Synthetic fixtures only. Run: `node pipeline/watchstate.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import {
  computeDeltas, advanceState, classifyBandTop, shouldReset,
  STALE_GAP_MS, BANDTOP_FLAT_PCT,
} from './lib/watchstate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_800_000_000_000;         // arbitrary base ms
const MIN = 60_000;
// a held-lot observation
const obs = (o = {}) => ({ identity: 'hld:1:100', instabuy: 100, mom: 'clean', bandTop: 110, breakEven: 95, ...o });

/* --- first-seen: no deltas, but underwater initialises the counter --------------------------- */
ok('first sighting (no prior) yields no cross-pass deltas', () => {
  const d = computeDeltas(undefined, obs(), T0);
  assert.equal(d.firstSeen, true);
  assert.equal(d.instabuyDelta, null);
  assert.equal(d.momTransition, null);
  assert.equal(d.bandTopTrend, null);
  assert.equal(d.passesUnderwater, 0);          // instabuy 100 ≥ break-even 95 → not underwater
});

ok('first sighting while underwater initialises passesUnderwater to 1', () => {
  const d = computeDeltas(undefined, obs({ instabuy: 90 }), T0); // 90 < break-even 95
  assert.equal(d.firstSeen, true);
  assert.equal(d.underwater, true);
  assert.equal(d.passesUnderwater, 1);
});

/* --- Δ instabuy: signed magnitude + direction ----------------------------------------------- */
ok('Δ instabuy is the signed magnitude with direction, and gapMs is the pass gap', () => {
  const prior = advanceState(undefined, obs({ instabuy: 1_000_000 }), T0);
  const d = computeDeltas(prior, obs({ instabuy: 780_000 }), T0 + 5 * MIN);
  assert.equal(d.instabuyDelta, -220_000);
  assert.equal(d.instabuyDir, '-');
  assert.equal(d.gapMs, 5 * MIN);
  const up = computeDeltas(prior, obs({ instabuy: 1_050_000 }), T0 + MIN);
  assert.equal(up.instabuyDelta, 50_000);
  assert.equal(up.instabuyDir, '+');
});

/* --- momentum transition -------------------------------------------------------------------- */
ok('momentum transition reads prior→cur and momChanged is their !==', () => {
  const prior = advanceState(undefined, obs({ mom: 'clean' }), T0);
  const changed = computeDeltas(prior, obs({ mom: 'breakup' }), T0 + MIN);
  assert.equal(changed.momTransition, 'clean→breakup');
  assert.equal(changed.momChanged, true);
  const same = computeDeltas(prior, obs({ mom: 'clean' }), T0 + MIN);
  assert.equal(same.momTransition, 'clean→clean');
  assert.equal(same.momChanged, false);
});

/* --- passesUnderwater increments across consecutive underwater passes ------------------------ */
ok('passesUnderwater increments over consecutive underwater passes', () => {
  let s;                                          // simulate three consecutive underwater passes
  s = advanceState(undefined, obs({ instabuy: 90 }), T0);
  assert.equal(s.passesUnderwater, 1);
  s = advanceState(s, obs({ instabuy: 88 }), T0 + 5 * MIN);
  assert.equal(s.passesUnderwater, 2);
  const d = computeDeltas(s, obs({ instabuy: 86 }), T0 + 10 * MIN);
  assert.equal(d.passesUnderwater, 3);            // the third pass's delta reports "3rd pass underwater"
  s = advanceState(s, obs({ instabuy: 86 }), T0 + 10 * MIN);
  assert.equal(s.passesUnderwater, 3);
});

ok('surfacing back above break-even resets the underwater counter to 0', () => {
  let s = advanceState(undefined, obs({ instabuy: 90 }), T0);
  s = advanceState(s, obs({ instabuy: 88 }), T0 + 5 * MIN);
  assert.equal(s.passesUnderwater, 2);
  s = advanceState(s, obs({ instabuy: 120 }), T0 + 10 * MIN);   // back above break-even 95
  assert.equal(s.passesUnderwater, 0);
});

/* --- RESET on identity change --------------------------------------------------------------- */
ok('a changed identity RESETS the counter and drops cross-pass deltas', () => {
  const prior = advanceState(advanceState(undefined, obs({ instabuy: 90 }), T0), obs({ instabuy: 88 }), T0 + 5 * MIN);
  assert.equal(prior.passesUnderwater, 2);
  // a re-bought lot at a different avg cost → new identity
  const cur = obs({ identity: 'hld:2:200', instabuy: 88, breakEven: 210 }); // still underwater vs new BE
  assert.equal(shouldReset(prior, cur, T0 + 10 * MIN), true);
  const d = computeDeltas(prior, cur, T0 + 10 * MIN);
  assert.equal(d.reset, true);
  assert.equal(d.instabuyDelta, null);            // no consecutive comparison across a reset
  assert.equal(d.momTransition, null);
  assert.equal(d.passesUnderwater, 1);            // counts fresh from this episode
});

/* --- RESET on a stale gap ------------------------------------------------------------------- */
ok('a gap beyond STALE_GAP_MS RESETS (an overnight pause is not a consecutive pass)', () => {
  const prior = advanceState(advanceState(undefined, obs({ instabuy: 90 }), T0), obs({ instabuy: 88 }), T0 + 5 * MIN);
  assert.equal(prior.passesUnderwater, 2);
  const staleNow = prior.ts + STALE_GAP_MS + 1;
  assert.equal(shouldReset(prior, obs({ instabuy: 86 }), staleNow), true);
  const d = computeDeltas(prior, obs({ instabuy: 86 }), staleNow);
  assert.equal(d.reset, true);
  assert.equal(d.passesUnderwater, 1);            // re-counts from the resumed episode
  assert.equal(d.instabuyDelta, null);
  // a pass just INSIDE the gap does NOT reset
  const freshNow = prior.ts + STALE_GAP_MS - 1;
  assert.equal(shouldReset(prior, obs({ instabuy: 86 }), freshNow), false);
  assert.equal(computeDeltas(prior, obs({ instabuy: 86 }), freshNow).passesUnderwater, 3);
});

/* --- band-top drift classification ---------------------------------------------------------- */
ok('classifyBandTop labels rising / flat / decaying and null under 2 points', () => {
  assert.equal(classifyBandTop([]), null);
  assert.equal(classifyBandTop([100]), null);
  assert.equal(classifyBandTop([100, 90]).trend, 'decaying');   // −10% ≫ flat band
  assert.equal(classifyBandTop([100, 110]).trend, 'rising');
  const flatChg = 100 * (1 + BANDTOP_FLAT_PCT / 2);             // inside the flat band
  assert.equal(classifyBandTop([100, flatChg]).trend, 'flat');
  const bt = classifyBandTop([100, 95, 90]);
  assert.equal(bt.from, 100);                                   // from = oldest, to = newest
  assert.equal(bt.to, 90);
});

ok('computeDeltas surfaces a decaying band-top over the retained history', () => {
  let s = advanceState(undefined, obs({ bandTop: 18_900_000 }), T0);
  const d = computeDeltas(s, obs({ bandTop: 18_800_000 }), T0 + 5 * MIN);
  assert.equal(d.bandTopTrend, 'decaying');
  assert.equal(d.bandTopFrom, 18_900_000);
  assert.equal(d.bandTopTo, 18_800_000);
});

/* --- purity: advanceState must not mutate its inputs ---------------------------------------- */
ok('advanceState does not mutate prior or cur', () => {
  const prior = advanceState(undefined, obs({ instabuy: 90 }), T0);
  const frozen = JSON.parse(JSON.stringify(prior));
  const cur = obs({ instabuy: 88 });
  const curFrozen = JSON.parse(JSON.stringify(cur));
  advanceState(prior, cur, T0 + MIN);
  assert.deepEqual(prior, frozen);
  assert.deepEqual(cur, curFrozen);
});

console.log(`\nAll ${pass} checks passed.`);
