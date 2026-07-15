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
 * Synthetic fixtures only. Run: `node pipeline/test/watchstate.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import {
  computeDeltas, advanceState, classifyBandTop, shouldReset, convictionGate,
  STALE_GAP_MS, BANDTOP_FLAT_PCT,
} from '../lib/watchstate.mjs';

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

/* --- V4 passesBelowSupport counter (mirrors passesUnderwater; feeds the structural break) ---- */
// a below-support observation: instabuy 90 prints under support 100 (independent of break-even).
const below = (o = {}) => obs({ support: 100, instabuy: 90, ...o });

ok('passesBelowSupport increments over consecutive below-support passes', () => {
  let s = advanceState(undefined, below(), T0);
  assert.equal(s.passesBelowSupport, 1);
  s = advanceState(s, below({ instabuy: 88 }), T0 + 5 * MIN);
  assert.equal(s.passesBelowSupport, 2);
  const d = computeDeltas(s, below({ instabuy: 86 }), T0 + 10 * MIN);
  assert.equal(d.passesBelowSupport, 3);            // the 3rd pass's delta reports 3 below-support
  assert.equal(d.belowSupport, true);
});

ok('passesBelowSupport resets on surfacing above support, identity change, and a stale gap', () => {
  // surface back above support → 0
  let s = advanceState(advanceState(undefined, below(), T0), below({ instabuy: 88 }), T0 + 5 * MIN);
  assert.equal(s.passesBelowSupport, 2);
  s = advanceState(s, below({ instabuy: 120 }), T0 + 10 * MIN);   // 120 ≥ support 100
  assert.equal(s.passesBelowSupport, 0);
  // identity change re-counts from this episode
  const prior = advanceState(advanceState(undefined, below(), T0), below({ instabuy: 88 }), T0 + 5 * MIN);
  const idCur = below({ identity: 'hld:2:200', instabuy: 86 });
  assert.equal(computeDeltas(prior, idCur, T0 + 10 * MIN).passesBelowSupport, 1);
  // stale-gap re-counts from the resumed episode
  const staleNow = prior.ts + STALE_GAP_MS + 1;
  assert.equal(computeDeltas(prior, below({ instabuy: 86 }), staleNow).passesBelowSupport, 1);
});

/* --- V4/V7 convictionGate: TIME-based arm-then-confirm escalation --------------------------- */
const PERSIST = 4 * MIN;   // explicit test threshold (real default = ALERT_PERSIST_MS)

ok('Gate-D CUT-CANDIDATE arms while underwater < persist, escalates once it PERSISTS ≥ persist', () => {
  const armed = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', underwaterMs: 1 * MIN, persistMs: PERSIST });
  assert.equal(armed.escalate, false);
  assert.equal(armed.armed, true);
  assert.equal(armed.reason, 'cut-candidate-armed');
  const esc = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', underwaterMs: PERSIST, persistMs: PERSIST });
  assert.equal(esc.escalate, true);
  assert.equal(esc.armed, false);
  assert.equal(esc.reason, 'cut-candidate');
});

ok('CADENCE-INDEPENDENCE: escalation depends on elapsed TIME, not pass count', () => {
  // the whole point of V7 — 300 passes a second apart or 2 passes 5 min apart, only elapsed ms matters
  assert.equal(convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', underwaterMs: PERSIST - 1, persistMs: PERSIST }).escalate, false,
    'just under the window stays armed no matter how many passes accrued');
  assert.equal(convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', underwaterMs: PERSIST + 1, persistMs: PERSIST }).escalate, true,
    'past the window escalates');
});

ok('LIST-TO-CLEAR (V7): a single-pass breakdown flicker only ARMS; escalates once breakdown HOLDS ≥ persist', () => {
  const flicker = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, breakdownMs: 1 * MIN, persistMs: PERSIST });
  assert.equal(flicker.escalate, false, 'a 1-pass momentum flicker must NOT headline (the fast-cadence fix)');
  assert.equal(flicker.armed, true);
  assert.equal(flicker.reason, 'clear-armed');
  const held = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, breakdownMs: PERSIST, persistMs: PERSIST });
  assert.equal(held.escalate, true);
  assert.equal(held.reason, 'clear');
});

ok('price ≥δ below structural support (through the trigger) → IMMEDIATE structural escalation (no time gate)', () => {
  const support = 20_000_000, trigger = support * (1 - 0.005);   // cut-trigger = support − 0.5%
  const g = convictionGate({ verdict: 'HOLD', gate: null, price: trigger - 1, support, cutTrigger: trigger, belowSupportMs: 0, persistMs: PERSIST });
  assert.equal(g.escalate, true);
  assert.equal(g.armed, false);
  assert.equal(g.reason, 'structural');
});

ok('a non-convincing graze of support arms; escalates once below support PERSISTS ≥ persist', () => {
  const support = 20_000_000, trigger = support * (1 - 0.005);
  const price = support - 10_000;                                 // below support but ABOVE cut-trigger
  const g1 = convictionGate({ verdict: 'HOLD', gate: null, price, support, cutTrigger: trigger, belowSupportMs: 1 * MIN, persistMs: PERSIST });
  assert.equal(g1.escalate, false);
  assert.equal(g1.armed, true);
  assert.equal(g1.reason, 'structural-armed');
  const g2 = convictionGate({ verdict: 'HOLD', gate: null, price, support, cutTrigger: trigger, belowSupportMs: PERSIST, persistMs: PERSIST });
  assert.equal(g2.escalate, true);
  assert.equal(g2.reason, 'structural');
});

ok('a reset zeroes the underwater streak → elapsed 0 → back to armed', () => {
  const prior = advanceState(undefined, obs({ instabuy: 90 }), T0);
  const cur = obs({ identity: 'hld:9:900', instabuy: 90, breakEven: 950 }); // new lot, still underwater
  const d = computeDeltas(prior, cur, T0 + 5 * MIN);
  assert.equal(d.reset, true);
  assert.equal(d.underwaterMs, 0, 'a reset restarts the streak now → 0 elapsed (cannot escalate)');
  const g = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', underwaterMs: d.underwaterMs, persistMs: PERSIST });
  assert.equal(g.escalate, false);
  assert.equal(g.armed, true);
});

ok('INVARIANT: a Gate-2 breakdown CUT escalates IMMEDIATELY regardless of elapsed time / conviction', () => {
  // no matter the elapsed durations or support levels, the breakdown CUT is never time-gated
  for (const um of [0, 1 * MIN, 10 * MIN]) {
    const g = convictionGate({ verdict: 'CUT', gate: 2, underwaterMs: um,
      price: 999, support: 1000, cutTrigger: 995, belowSupportMs: 0, breakdownMs: 0, persistMs: PERSIST });
    assert.equal(g.escalate, true, `breakdown CUT must escalate at underwaterMs=${um}`);
    assert.equal(g.armed, false);
    assert.equal(g.reason, 'breakdown');
  }
});

/* --- TG1: the thesis branch — silence expected-underwater above the declared tripwire ------ */
// A declared hold plan: exit 4848, tripwire 4678 (the nest example from the chunk spec).
const NEST_THESIS = { exitPrice: 4848, tripwire: 4678, horizon: 'multi-day' };

ok('TG1: an UNDERWATER lot with a thesis, live ABOVE the tripwire → ARMED note, NO headline', () => {
  // being underwater vs the instant-clear IS the plan; live 4700 is above the 4678 tripwire.
  const g = convictionGate({ verdict: 'HOLD', gate: null, price: 4700, underwater: true, thesis: NEST_THESIS,
    underwaterMs: 10 * MIN, persistMs: PERSIST });
  assert.equal(g.escalate, false, 'expected-underwater above the tripwire must NOT headline');
  assert.equal(g.armed, true);
  assert.equal(g.reason, 'thesis-armed');
  assert.equal(g.thesis, NEST_THESIS, 'the branch echoes the thesis for the note');
});

ok('TG1: a Gate-D CUT-CANDIDATE with a thesis, live ABOVE the tripwire → ARMED (thesis wins over #3)', () => {
  // a fully-persisted CUT-CANDIDATE would normally escalate (#3); the thesis silences it above the tripwire.
  const g = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', price: 4700, underwater: true,
    thesis: NEST_THESIS, underwaterMs: PERSIST * 3, persistMs: PERSIST });
  assert.equal(g.escalate, false, 'a declared thesis above the tripwire silences even a persisted CUT-CANDIDATE');
  assert.equal(g.armed, true);
  assert.equal(g.reason, 'thesis-armed');
});

ok('TG1: live AT-OR-BELOW the tripwire falls through to the normal escalation (real risk headlines)', () => {
  // live 4650 < tripwire 4678: the real risk — fall through to the Gate-D #3 escalation (persisted).
  const below = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', price: 4650, underwater: true,
    thesis: NEST_THESIS, underwaterMs: PERSIST, persistMs: PERSIST });
  assert.equal(below.escalate, true, 'below the tripwire, a persisted CUT-CANDIDATE headlines as usual');
  assert.equal(below.reason, 'cut-candidate');
  // exactly AT the tripwire is NOT "above" (price > tripwire is strict) → also falls through.
  const at = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', price: 4678, underwater: true,
    thesis: NEST_THESIS, underwaterMs: PERSIST, persistMs: PERSIST });
  assert.equal(at.escalate, true, 'AT the tripwire is a break — not silenced');
});

ok('TG1 INVARIANT: a Gate-2 breakdown CUT is NEVER silenced by a thesis, even above the tripwire', () => {
  // the breakdown CUT is checked BEFORE the thesis branch — a real breakdown is real risk, thesis or not.
  const g = convictionGate({ verdict: 'CUT', gate: 2, price: 4700, underwater: true, thesis: NEST_THESIS,
    underwaterMs: 10 * MIN, persistMs: PERSIST });
  assert.equal(g.escalate, true, 'a Gate-2 breakdown CUT must headline even with a declared thesis above the tripwire');
  assert.equal(g.reason, 'breakdown');
});

ok('TG1 (VN-2): LIST-TO-CLEAR IS thesis-silenced ABOVE the tripwire (the expected pre-peak trough)', () => {
  // VN-2 supersedes the original exclusion: on a DECLARED hold above its tripwire, the band-flip
  // frame's "clear at the band top" is the expected dip the declared abort level supersedes (RC7) —
  // even a PERSISTED breakdown only ARMS while the plan holds.
  const g = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, price: 4700, underwater: true,
    thesis: NEST_THESIS, breakdownMs: PERSIST, persistMs: PERSIST });
  assert.equal(g.escalate, false, 'above the tripwire, a declared plan silences LIST-TO-CLEAR');
  assert.equal(g.armed, true);
  assert.equal(g.reason, 'thesis-armed');
});

ok('TG1 (VN-2): LIST-TO-CLEAR BELOW the tripwire resumes its own #4 arm-then-confirm (real risk headlines)', () => {
  const g = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, price: 4650, underwater: true,
    thesis: NEST_THESIS, breakdownMs: PERSIST, persistMs: PERSIST });
  assert.equal(g.escalate, true, 'below the tripwire the thesis no longer silences — V7 escalation stands');
  assert.equal(g.reason, 'clear');
  // and WITHOUT a declared thesis, LIST-TO-CLEAR behavior is byte-identical to V7 (arm-then-confirm on time)
  const noThesis = convictionGate({ verdict: 'LIST-TO-CLEAR', gate: 2, breakdownMs: PERSIST, persistMs: PERSIST });
  assert.equal(noThesis.reason, 'clear');
  assert.equal(noThesis.escalate, true);
});

ok('TG1 SAFE-DEGRADE: no thesis (or a thesis with no numeric tripwire) → byte-identical to today', () => {
  // no thesis: the underwater CUT-CANDIDATE arms/escalates purely on the V4/V7 rule (thesis absent).
  const noThesis = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', price: 4700, underwater: true,
    underwaterMs: 1 * MIN, persistMs: PERSIST });
  assert.equal(noThesis.reason, 'cut-candidate-armed', 'absent a thesis, behavior is the plain V4/V7 path');
  // a thesis missing a numeric tripwire cannot gate → same plain path.
  const noTrip = convictionGate({ verdict: 'CUT-CANDIDATE', gate: 'D', price: 4700, underwater: true,
    thesis: { exitPrice: 4848, tripwire: null }, underwaterMs: 1 * MIN, persistMs: PERSIST });
  assert.equal(noTrip.reason, 'cut-candidate-armed', 'a tripwire-less thesis is inert — no silencing');
});

ok('TG1: a thesis on a lot that is NOT underwater does not arm (nothing to silence)', () => {
  // above break-even, no CUT-CANDIDATE, above the tripwire → the thesis branch does not fire.
  const g = convictionGate({ verdict: 'HOLD', gate: null, price: 4700, underwater: false, thesis: NEST_THESIS });
  assert.equal(g.armed, false, 'a healthy lot has no expected-underwater signal to silence');
  assert.equal(g.reason, null);
});

console.log(`\nAll ${pass} checks passed.`);
