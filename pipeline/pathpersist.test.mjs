#!/usr/bin/env node
/**
 * pathpersist.test.mjs — the V2-P4b path-dominance PERSISTENCE GATE + held wiring acceptance.
 *
 * P4a's weighPaths re-weighs an item's thesis-paths every pass; its `dominant`/`migration` are
 * INSTANTANEOUS. P4b adds the cross-pass whiplash guard: `pathPersistence()` (lib/watchstate.mjs,
 * arm-then-confirm + hysteresis, the convictionGate discipline applied to path dominance) and the
 * `pathsStage()` chain slice (lib/context.mjs) both surfaces consume. This pins the PLAN.md P4b
 * acceptance verbatim:
 *
 *   - FLAPPING weights (dominance alternating within persistMs) NEVER flip the persisted
 *     `currentPath` or the rendered headline — a simulated tick sequence.
 *   - a REAL migration (dominance held past persistMs) arms → confirms → the rendered path line
 *     surfaces `path MIGRATED <enteredUnder> → <current>`.
 *   - an entered-under-`hold-recovery` DECAY-KNIFE (falling regime, decay phase, underwater)
 *     raises migration toward the exit family (be-escape/cut) — END-TO-END through pathsStage +
 *     the persistence gate, seeded by the declared hold-thesis path.
 *   - LEGACY watch-state entries (no path fields) load + behave byte-identically (back-compat).
 *   - hysteresis: a challenger inside PATH_HYSTERESIS_MARGIN of the incumbent never even arms.
 *
 * Synthetic fixtures only; PATH_PERSIST_MS / PATH_HYSTERESIS_MARGIN are named PLACEHOLDERS (the
 * tests pin the MECHANISM, not the magnitudes). Run: `node pipeline/pathpersist.test.mjs`.
 */
import assert from 'node:assert/strict';
import {
  pathPersistence, PATH_PERSIST_MS, PATH_HYSTERESIS_MARGIN,
  computeDeltas, advanceState,
} from './lib/watchstate.mjs';
import { pathsStage, renderPathLine } from './lib/context.mjs';
import { PATH_KEYS } from '../js/paths.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_800_000_000_000;   // arbitrary base ms
const MIN = 60_000;
const P = PATH_PERSIST_MS;

/* =============================================================================================
 * 1. pathPersistence — the pure gate
 * ============================================================================================= */

ok('initial establishment: no prior currentPath → adopt the dominant immediately (nothing to whiplash)', () => {
  const r = pathPersistence(null, { dominantKey: 'value-hold', dominantViability: 0.7, now: T0 });
  assert.equal(r.currentPath, 'value-hold');
  assert.equal(r.arming, false);
  assert.equal(r.confirmedThisPass, false);
  assert.equal(r.migration, false);   // no enteredUnder declared → no migration signal
});

ok('re-affirmed dominant disarms a pending challenger (the flap guard)', () => {
  const prior = { currentPath: 'value-hold', pathArmedKey: 'cut', pathArmedSince: T0 };
  const r = pathPersistence(prior, { dominantKey: 'value-hold', dominantViability: 0.7, incumbentViability: 0.7, now: T0 + MIN });
  assert.equal(r.currentPath, 'value-hold');
  assert.equal(r.armedKey, null, 'the armed challenger is DISARMED on a flip back');
  assert.equal(r.arming, false);
});

ok('a decisive flip ARMS (currentPath unchanged) and CONFIRMS only after persistMs', () => {
  // tick 1: cut becomes dominant, decisively → arm
  const t1 = pathPersistence({ currentPath: 'hold-recovery' },
    { dominantKey: 'cut', dominantViability: 0.8, incumbentViability: 0.2, now: T0 });
  assert.equal(t1.currentPath, 'hold-recovery', 'the flip does NOT take effect yet');
  assert.equal(t1.arming, true);
  assert.equal(t1.armedKey, 'cut');
  assert.equal(t1.armedSince, T0);
  // tick 2, inside the window: still arming
  const prior2 = { currentPath: t1.currentPath, pathArmedKey: t1.armedKey, pathArmedSince: t1.armedSince };
  const t2 = pathPersistence(prior2, { dominantKey: 'cut', dominantViability: 0.8, incumbentViability: 0.2, now: T0 + P - 1 });
  assert.equal(t2.currentPath, 'hold-recovery');
  assert.equal(t2.arming, true);
  assert.equal(t2.confirmedThisPass, false, 'inside persistMs a flip NEVER confirms');
  // tick 3, past the window: CONFIRM
  const prior3 = { currentPath: t2.currentPath, pathArmedKey: t2.armedKey, pathArmedSince: t2.armedSince };
  const t3 = pathPersistence(prior3, { dominantKey: 'cut', dominantViability: 0.8, incumbentViability: 0.2,
    enteredUnder: 'hold-recovery', now: T0 + P });
  assert.equal(t3.currentPath, 'cut', 'the migration CONFIRMS once dominance held ≥ persistMs');
  assert.equal(t3.confirmedThisPass, true);
  assert.equal(t3.migration, true, 'confirmed currentPath ≠ enteredUnder ⇒ migration');
});

ok('ACCEPTANCE: flapping dominance (alternating inside persistMs) NEVER flips the persisted currentPath', () => {
  // A confirmed value-hold; dominance alternates value-hold ↔ cut every 2 min for 40 min.
  // Every cut tick arms afresh (the interleaved value-hold tick disarmed it) → never confirms.
  let prior = { currentPath: 'value-hold', pathArmedKey: null, pathArmedSince: null };
  for (let i = 1; i <= 20; i++) {
    const now = T0 + i * 2 * MIN;
    const dominantKey = i % 2 ? 'cut' : 'value-hold';
    const r = pathPersistence(prior, { dominantKey, dominantViability: 0.8, incumbentViability: 0.2, now });
    assert.equal(r.currentPath, 'value-hold', `tick ${i}: the persisted path must not flip`);
    assert.equal(r.confirmedThisPass, false, `tick ${i}: a flap must never confirm`);
    prior = { currentPath: r.currentPath, pathArmedKey: r.armedKey, pathArmedSince: r.armedSince };
  }
});

ok('HYSTERESIS: a challenger inside the margin never arms (a near-tie is noise)', () => {
  const r = pathPersistence({ currentPath: 'value-hold' }, {
    dominantKey: 'cut',
    dominantViability: 0.50, incumbentViability: 0.50 - PATH_HYSTERESIS_MARGIN / 2,   // under the margin
    now: T0,
  });
  assert.equal(r.currentPath, 'value-hold');
  assert.equal(r.arming, false, 'a marginal flip does not even arm');
  // clearly past the margin arms (≥ is decisive; avoid a float-exact boundary probe)
  const r2 = pathPersistence({ currentPath: 'value-hold' }, {
    dominantKey: 'cut', dominantViability: 0.50 + PATH_HYSTERESIS_MARGIN, incumbentViability: 0.50 - PATH_HYSTERESIS_MARGIN, now: T0,
  });
  assert.equal(r2.arming, true);
});

ok('missing viabilities degrade the hysteresis to the time gate alone (never a throw)', () => {
  const r = pathPersistence({ currentPath: 'value-hold' }, { dominantKey: 'cut', now: T0 });
  assert.equal(r.arming, true, 'without viabilities the margin cannot be applied — the time gate still guards');
  assert.equal(r.currentPath, 'value-hold');
});

ok('a DIFFERENT challenger while one is arming re-arms afresh (the clock does not transfer)', () => {
  const prior = { currentPath: 'value-hold', pathArmedKey: 'cut', pathArmedSince: T0 };
  const r = pathPersistence(prior, { dominantKey: 'be-escape', dominantViability: 0.8, incumbentViability: 0.2, now: T0 + P });
  assert.equal(r.currentPath, 'value-hold');
  assert.equal(r.armedKey, 'be-escape');
  assert.equal(r.armedSince, T0 + P, 'a different challenger starts its own clock');
  assert.equal(r.confirmedThisPass, false);
});

/* =============================================================================================
 * 2. Back-compat: legacy watch-state entries (no path fields)
 * ============================================================================================= */

// a pre-P4b `held:<id>` entry exactly as V1–V7 wrote it — NO currentPath/pathArmedKey/pathArmedSince.
const legacyEntry = {
  ts: T0, identity: 'hld:2:100', instabuy: 90, mom: 'clean', bandTop: 110, breakEven: 95,
  support: null, underwater: true, passesUnderwater: 1, belowSupport: false, passesBelowSupport: 0,
  underwaterSince: T0, belowSupportSince: null, breakdownSince: null, bandTopHist: [110],
};

ok('BACK-COMPAT: a legacy entry flows through computeDeltas/advanceState byte-identically to one carrying path fields', () => {
  const cur = { identity: 'hld:2:100', instabuy: 88, mom: 'clean', bandTop: 109, breakEven: 95 };
  const withPathFields = { ...legacyEntry, currentPath: 'value-hold', pathArmedKey: null, pathArmedSince: null, enteredUnder: null };
  assert.deepEqual(computeDeltas(legacyEntry, cur, T0 + 5 * MIN), computeDeltas(withPathFields, cur, T0 + 5 * MIN),
    'path fields on the prior are invisible to the delta math');
  assert.deepEqual(advanceState(legacyEntry, cur, T0 + 5 * MIN), advanceState(withPathFields, cur, T0 + 5 * MIN),
    'advanceState output is unchanged by the additive fields');
});

ok('BACK-COMPAT: pathPersistence on a legacy entry (no currentPath) adopts the dominant without error', () => {
  const r = pathPersistence(legacyEntry, { dominantKey: 'be-escape', dominantViability: 0.6, now: T0 + 5 * MIN });
  assert.equal(r.currentPath, 'be-escape');   // first establishment — same as a null prior
  assert.equal(r.confirmedThisPass, false);
});

/* =============================================================================================
 * 3. END-TO-END: pathsStage + renderPathLine (the wiring both surfaces share)
 * ============================================================================================= */

// The archetype decay-knife as the CONTEXT CHAIN sees it: a market row + history phase + a held
// position. falling regime, decay phase, live 2h breakdown, underwater (quickSell < be).
function decayKnifeCtx() {
  return {
    identity: { id: 2004, name: 'Decay knife' },
    market: { row: {
      falling: true, rising: false, regime: { ok: true }, mom: 'breakdown', reliable: true,
      quickBuy: 39_000, quickSell: 39_500, optBuy: 39_000, optSell: 41_000, mid: 39_250,
    } },
    history: { phase: { phase: 'decay' }, termStructure: null },
    intraday: {},
    position: { held: true, be: 42_000,
      thesis: { id: 2004, path: PATH_KEYS.HOLD_RECOVERY, enteredUnder: PATH_KEYS.HOLD_RECOVERY, tripwire: null },
      newStateEntry: {}, deltas: null },
  };
}

ok('ACCEPTANCE (end-to-end): entered-under-hold-recovery decay-knife raises migration toward be-escape/cut through the gate', () => {
  // pass 1: no watch-state prior — the DECLARED path (hold-recovery) seeds the incumbent, so the
  // exit-family dominant must ARM, not instantly displace the declared plan.
  const c1 = decayKnifeCtx();
  pathsStage(c1, { watchStatePrior: null, nowMs: T0, fresh: false });
  const exitFamily = [PATH_KEYS.CUT, PATH_KEYS.BE_ESCAPE, PATH_KEYS.LIST_TO_CLEAR];
  assert.ok(exitFamily.includes(c1.paths.dominant.key), 'the instantaneous dominant is exit-family on a decay-knife');
  assert.equal(c1.paths.persisted.currentPath, PATH_KEYS.HOLD_RECOVERY, 'the declared path holds until confirm');
  assert.equal(c1.paths.persisted.arming, true);
  assert.equal(c1.paths.persisted.migration, false, 'not yet — arm-then-confirm');
  // the persistence fields were folded ADDITIVELY into the next-pass state entry
  assert.equal(c1.position.newStateEntry.currentPath, PATH_KEYS.HOLD_RECOVERY);
  assert.equal(c1.position.newStateEntry.pathArmedKey, c1.paths.dominant.key);
  assert.equal(c1.position.newStateEntry.enteredUnder, PATH_KEYS.HOLD_RECOVERY);
  // the rendered line shows the challenger arming, NOT a migration headline
  const line1 = renderPathLine(c1);
  assert.ok(line1.includes('challenging (arming'), 'pass 1 renders an arming note: ' + line1);
  assert.ok(!line1.includes('MIGRATED'), 'no migration headline inside the window');

  // pass 2: past persistMs with the same dominant → CONFIRM; migration surfaces in the line.
  const c2 = decayKnifeCtx();
  pathsStage(c2, { watchStatePrior: c1.position.newStateEntry, nowMs: T0 + P, fresh: false });
  assert.equal(c2.paths.persisted.currentPath, c2.paths.dominant.key, 'the exit path is now the persisted current path');
  assert.ok(exitFamily.includes(c2.paths.persisted.currentPath));
  assert.equal(c2.paths.persisted.migration, true, 'entered under hold-recovery, now exit-family ⇒ migration');
  assert.equal(c2.paths.persisted.confirmedThisPass, true);
  const line2 = renderPathLine(c2);
  assert.ok(line2.includes(`MIGRATED ${PATH_KEYS.HOLD_RECOVERY} → ${c2.paths.dominant.key}`),
    'the confirmed migration headlines in the rendered prose: ' + line2);
});

ok('ACCEPTANCE (end-to-end): the rendered headline path NEVER flips on flapping weights inside persistMs', () => {
  // Alternate the decay-knife read with a healthy read every 2 min — the persisted currentPath
  // (and therefore the headline the line renders) must stay the declared hold-recovery throughout.
  let stateEntry = null;
  for (let i = 1; i <= 10; i++) {
    const ctx = decayKnifeCtx();
    if (i % 2 === 0) {   // healthy tick: rising/basing, not underwater → hold-family dominant
      ctx.market.row = { ...ctx.market.row, falling: false, rising: true, mom: 'clean', quickSell: 43_000 };
      ctx.history.phase = { phase: 'basing' };
    }
    pathsStage(ctx, { watchStatePrior: stateEntry, nowMs: T0 + i * 2 * MIN, fresh: false });
    assert.equal(ctx.paths.persisted.currentPath, PATH_KEYS.HOLD_RECOVERY, `tick ${i}: headline path must not flip`);
    assert.equal(ctx.paths.persisted.confirmedThisPass, false, `tick ${i}: a flap never confirms`);
    const line = renderPathLine(ctx);
    assert.ok(!line.includes('MIGRATED'), `tick ${i}: no migration headline while flapping`);
    stateEntry = ctx.position.newStateEntry;
  }
});

ok('a fresh episode (first-seen/reset) re-establishes the path from scratch (prior dropped)', () => {
  const ctx = decayKnifeCtx();
  ctx.position.thesis = null;   // no declared path either
  ctx.position.deltas = { firstSeen: false, reset: true };   // identity changed → fresh
  pathsStage(ctx, { watchStatePrior: { currentPath: PATH_KEYS.VALUE_HOLD, pathArmedKey: PATH_KEYS.CUT, pathArmedSince: T0 - P }, nowMs: T0 });
  assert.equal(ctx.paths.persisted.currentPath, ctx.paths.dominant.key,
    'a reset lot adopts its current dominant immediately — no stale path carried across a re-buy');
});

ok('degrade-not-throw: pathsStage on an empty ctx yields a path read without throwing', () => {
  const ctx = { market: {}, history: {}, position: { held: true } };
  pathsStage(ctx, { nowMs: T0 });
  assert.ok(ctx.paths.dominant, 'a dominant path always exists');
  assert.ok(renderPathLine(ctx), 'the line renders');
  assert.equal(renderPathLine({}), null, 'no paths namespace → null (callers drop the line)');
});

console.log(`\nAll ${pass} checks passed.`);
