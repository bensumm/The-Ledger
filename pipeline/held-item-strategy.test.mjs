#!/usr/bin/env node
/**
 * held-item-strategy.test.mjs — acceptance fixtures for the PURE path engine core (js/held-item-strategy.mjs, Pipeline v2 P4a).
 *
 * held-item-strategy.mjs is DOM-free + dependency-free, so the whole enumerate/weigh model is fixture-testable with
 * synthetic DERIVED contexts — NO live data (CLAUDE.md rule 4). The ctx here mirrors the shape the v2
 * context chain hands the path stage (regime/phase/underwater/aboveFloor/… already derived upstream),
 * so these are the archetypes' DERIVED shapes, not raw series.
 *
 * BUSINESS REQUIREMENTS pinned here (PLAN.md P4a "Acceptance"):
 *   - a DECAY-KNIFE held lot (falling regime, decay phase, underwater, above the multi-week floor)
 *     ranks the hold-family (value-hold, hold-recovery) LOW and the exit-family (cut/list-to-clear/
 *     be-escape) HIGHER — being above an ERODING floor is not a value thesis.
 *   - a GENUINE-DIP held lot (rising/basing, mildly underwater) ranks a recovery/value hold ABOVE the
 *     cut — proving the weights aren't trivially always-exit (the counter-fixture).
 *   - enteredUnder tracking: dominant ≠ enteredUnder → migration flag true; equal → false.
 *   - degrade-not-throw: an empty/na ctx never throws; unprovable paths get low viability + a
 *     `no-data` evidence note (never zero, never decisive).
 *
 * Run: `node pipeline/held-item-strategy.test.mjs` (exits non-zero on any failure). Auto-discovered by run-tests.mjs.
 */
import assert from 'node:assert/strict';
import {
  enumeratePaths, weighPaths, PATH_KEYS, ACTIONS,
} from '../js/held-item-strategy.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const via = (weighed, key) => { const p = weighed.find(x => x.key === key); return p ? p.viability : null; };

console.log('P4a path-engine acceptance:');

// The archetype-2004 decay-knife, in its DERIVED-context shape (what the context chain would hand us):
// falling regime, decay phase, underwater, live still above the durable multi-week floor.
function decayKnifeCtx(extra = {}) {
  return {
    id: 2004, name: 'Decay knife', held: true,
    regime: 'falling', phase: 'decay', mom: 'breakdown', underwater: true,
    aboveFloor: true,                 // live is above the multi-week floor — but the floor is eroding
    breakEven: 42_000, quickBuy: 39_000, quickSell: 39_500, optBuy: 39_000, optSell: 41_000,
    floor: 35_000, reliable: true,
    ...extra,
  };
}

// --- 1. THE ACCEPTANCE: decay-knife held → hold-family LOW, exit-family HIGHER ----------------
ok('decay-knife held: value-hold & hold-recovery rank BELOW the exit-family (cut/list-to-clear/be-escape)', () => {
  const ctx = decayKnifeCtx();
  const paths = enumeratePaths(ctx);
  // held enumeration is exactly the five hold/exit theses (no scalp on an existing lot).
  assert.deepEqual(paths.map(p => p.key).sort(),
    [PATH_KEYS.BE_ESCAPE, PATH_KEYS.CUT, PATH_KEYS.HOLD_RECOVERY, PATH_KEYS.LIST_TO_CLEAR, PATH_KEYS.VALUE_HOLD].sort());
  const { dominant, weighed } = weighPaths(paths, ctx);
  const vHold = via(weighed, PATH_KEYS.VALUE_HOLD);
  const vRec  = via(weighed, PATH_KEYS.HOLD_RECOVERY);
  const vCut  = via(weighed, PATH_KEYS.CUT);
  const vClear = via(weighed, PATH_KEYS.LIST_TO_CLEAR);
  const vEsc  = via(weighed, PATH_KEYS.BE_ESCAPE);
  // the two hold-family theses are the two LOWEST-viability paths.
  const holdFamily = [vHold, vRec];
  const exitFamily = [vCut, vClear, vEsc];
  for (const h of holdFamily) for (const e of exitFamily)
    assert.ok(e > h, `every exit-family path must outrank every hold-family path (exit ${e} > hold ${h})`);
  // the dominant path is an exit-family action (cut here), never a hold.
  assert.equal(dominant.action, ACTIONS.CUT);
  assert.equal(dominant.key, PATH_KEYS.CUT);
});

// --- 2. evidence transparency: the low hold-family score carries WHY ---------------------------
ok('decay-knife: value-hold viability carries falling + decay evidence notes', () => {
  const { weighed } = weighPaths(enumeratePaths(decayKnifeCtx()), decayKnifeCtx());
  const vh = weighed.find(p => p.key === PATH_KEYS.VALUE_HOLD);
  const signals = vh.evidence.map(e => e.signal);
  assert.ok(signals.includes('falling'), 'falling penalty recorded');
  assert.ok(signals.includes('decay'), 'decay penalty recorded');
  assert.ok(signals.includes('above-floor'), 'the above-floor bonus IS applied (but out-weighed)');
});

// --- 3. COUNTER-FIXTURE: a genuine dip → a hold outranks the cut -------------------------------
ok('genuine-dip held (rising/basing, mildly underwater): a recovery/value hold beats the cut', () => {
  const ctx = {
    id: 2002, name: 'Genuine dip riser', held: true,
    regime: 'rising', phase: 'basing', mom: 'clean', underwater: true,
    aboveFloor: true, breakEven: 106_000, quickBuy: 104_000, quickSell: 105_000,
    optBuy: 104_000, optSell: 109_000, floor: 98_000, reliable: true,
  };
  const { dominant, weighed } = weighPaths(enumeratePaths(ctx), ctx);
  const bestHold = Math.max(via(weighed, PATH_KEYS.VALUE_HOLD), via(weighed, PATH_KEYS.HOLD_RECOVERY));
  const vCut = via(weighed, PATH_KEYS.CUT);
  assert.ok(bestHold > vCut, `a hold must outrank the cut on a genuine dip (${bestHold} > ${vCut})`);
  assert.notEqual(dominant.key, PATH_KEYS.CUT, 'the knife is not dominant on a real dip');
});

// --- 4. enteredUnder / migration flag ---------------------------------------------------------
ok('migration flag: entered-under hold-recovery decay-knife → dominant is not that → migration true', () => {
  const ctx = decayKnifeCtx({ enteredUnder: PATH_KEYS.HOLD_RECOVERY });
  const { dominant, enteredUnder, migration } = weighPaths(enumeratePaths(ctx), ctx);
  assert.equal(enteredUnder, PATH_KEYS.HOLD_RECOVERY);
  assert.notEqual(dominant.key, PATH_KEYS.HOLD_RECOVERY);
  assert.equal(migration, true, 'dominant ≠ enteredUnder ⇒ migration');
});
ok('migration flag: entered-under the dominant path → migration false; absent enteredUnder → false', () => {
  const ctx = decayKnifeCtx({ enteredUnder: PATH_KEYS.CUT });   // dominant IS cut here
  const r1 = weighPaths(enumeratePaths(ctx), ctx);
  assert.equal(r1.migration, false, 'entered under the dominant path ⇒ no migration');
  const r2 = weighPaths(enumeratePaths(decayKnifeCtx()), decayKnifeCtx());   // no enteredUnder
  assert.equal(r2.enteredUnder, null);
  assert.equal(r2.migration, false, 'no declared entry path ⇒ no migration signal');
});

// --- 4b. P5: an UNSOLD SCALP LAP migrates to cut, NEVER hold-recovery --------------------------
ok('scalp lap: a held lot entered under scalp (unsold, falling, underwater) → dominant is CUT, never a hold', () => {
  // ACCEPTANCE #3 — a scalp is flip-only; a lap that failed to sell is a cut, not a recovery hold.
  const ctx = decayKnifeCtx({ enteredUnder: PATH_KEYS.SCALP });
  const { dominant, weighed } = weighPaths(enumeratePaths(ctx), ctx);
  const vRec = via(weighed, PATH_KEYS.HOLD_RECOVERY);
  const vHold = via(weighed, PATH_KEYS.VALUE_HOLD);
  const exitFamily = [via(weighed, PATH_KEYS.CUT), via(weighed, PATH_KEYS.LIST_TO_CLEAR), via(weighed, PATH_KEYS.BE_ESCAPE)];
  for (const e of exitFamily) { assert.ok(e > vRec, `exit ${e} > hold-recovery ${vRec}`); assert.ok(e > vHold, `exit ${e} > value-hold ${vHold}`); }
  assert.notEqual(dominant.key, PATH_KEYS.HOLD_RECOVERY, 'never hold-recovery');
  assert.notEqual(dominant.key, PATH_KEYS.VALUE_HOLD, 'never a value hold either');
  assert.equal(dominant.key, PATH_KEYS.CUT, 'the failed scalp lap cuts on the falling tape');
  // the penalty is EVIDENCED (transparency): the scalp-no-hold signal is recorded on both holds.
  assert.ok(weighed.find(p => p.key === PATH_KEYS.HOLD_RECOVERY).evidence.some(e => e.signal === 'scalp-no-hold'));
});
ok('scalp-no-hold penalty is inert when the lot was NOT entered under scalp (no enteredUnder)', () => {
  const { weighed } = weighPaths(enumeratePaths(decayKnifeCtx()), decayKnifeCtx());
  assert.ok(!weighed.find(p => p.key === PATH_KEYS.HOLD_RECOVERY).evidence.some(e => e.signal === 'scalp-no-hold'));
});

// --- 5. unheld candidate enumeration (scalp / value-hold / avoid) ------------------------------
ok('an UNHELD candidate enumerates scalp + value-hold + avoid (entry theses)', () => {
  const paths = enumeratePaths({ id: 1, held: false, quickBuy: 100, quickSell: 105, reliable: true });
  assert.deepEqual(paths.map(p => p.key).sort(),
    [PATH_KEYS.AVOID, PATH_KEYS.SCALP, PATH_KEYS.VALUE_HOLD].sort());
});

// --- 6. degrade-not-throw ---------------------------------------------------------------------
ok('empty ctx never throws; every path gets a numeric viability + evidence', () => {
  const paths = enumeratePaths();                 // no ctx at all
  const { dominant, weighed } = weighPaths(paths);  // no ctx at all
  assert.ok(weighed.length >= 1);
  for (const p of weighed) {
    assert.equal(typeof p.viability, 'number');
    assert.ok(p.viability >= 0 && p.viability <= 1, 'viability is clamped to 0..1');
    assert.ok(Array.isArray(p.evidence));
  }
  assert.ok(dominant, 'a dominant path is always chosen');
});
ok('an unprovable path degrades to a low viability with a no-data note (never zero, never a throw)', () => {
  // held lot, but NO regime/phase/floor read at all → value-hold cannot be evidenced.
  const ctx = { held: true, underwater: true, reliable: true };
  const { weighed } = weighPaths(enumeratePaths(ctx), ctx);
  const vh = weighed.find(p => p.key === PATH_KEYS.VALUE_HOLD);
  assert.ok(vh.evidence.some(e => e.signal === 'no-data'), 'a no-data note is present');
  assert.ok(vh.viability > 0, 'low but never zero');
});
ok('ctx.reliable===false → every path is capped to the unreliable floor with an evidence note', () => {
  const ctx = decayKnifeCtx({ reliable: false });
  const { weighed } = weighPaths(enumeratePaths(ctx), ctx);
  for (const p of weighed) {
    assert.ok(p.viability <= 0.1, 'no path is actionable off an unreliable read');
    assert.ok(p.evidence.some(e => e.signal === 'unreliable'));
  }
});

console.log(`\nAll ${pass} checks passed.`);
