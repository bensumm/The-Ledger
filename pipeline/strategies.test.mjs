#!/usr/bin/env node
/**
 * strategies.test.mjs — the CONFORMANCE suite for the declarative strategy registry (js/strategies.mjs,
 * Pipeline v2 chunk P4c).
 *
 * The registry re-expresses the screen's niches (band/churn + provisional scalp/value; spread/rising were
 * DELETED in Steps 3+4) as DATA-SHAPED specs that pipeline/lib/gatecandidates.mjs drives instead of
 * branching on the niche name. This file is the
 * conformance harness the P4c spec calls for: it iterates the registry and asserts every spec's
 * STRUCTURAL contract (required fields, edge callable, default-path key in js/paths.mjs's vocabulary,
 * gates well-formed), proves the checker BITES on a deliberately-malformed spec, and runs each edge over
 * the shared replay archetypes for NO-THROW + DETERMINISM — so when P5 registers the scalp/value specs
 * they get conformance-checked for free. Pure + offline — NO live API (CLAUDE.md rule 4).
 *
 * The byte-identity of the edge MATH (that the specs reproduce the old inline gateCandidates logic) is
 * pinned separately + more strongly by the P1 replay goldens (replay.test.mjs) and gatecandidates.test.mjs
 * — this suite owns the spec CONTRACT, not the numeric acceptance.
 * Run: `node pipeline/strategies.test.mjs`  (exits non-zero on any failure). Auto-discovered by run-tests.mjs.
 */
import assert from 'node:assert/strict';
import {
  STRATEGY_LIST, STRATEGIES, MODE_KEYS, ALL_MODE_KEYS, ENTRY_PATH_KEYS,
  validateStrategySpec, CHURN_MIN_VOL,
} from '../js/strategies.mjs';
import { PATH_KEYS } from '../js/paths.mjs';
import { ESTIMATOR_FAMILIES } from './lib/estimators.mjs';
import { DEFAULT_THRESHOLDS } from './lib/gatecandidates.mjs';
import { buildSnapshot } from './lib/replay.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const VALID_PATH_KEYS = new Set(Object.values(PATH_KEYS));

console.log('strategies.mjs conformance:');

/* --- registry shape ------------------------------------------------------------------------------- */
ok('the registry holds the four niches (Steps 3+4 deleted spread/rising), in order, keyed correctly', () => {
  assert.deepEqual(MODE_KEYS, ['band', 'churn', 'scalp', 'value']);
  assert.deepEqual(STRATEGY_LIST.map(s => s.key), MODE_KEYS);
  for (const s of STRATEGY_LIST) assert.equal(STRATEGIES[s.key], s, `${s.key} indexed by key`);
  // the deleted specs are truly gone from the registry.
  for (const k of ['spread', 'rising']) assert.equal(STRATEGIES[k], undefined, `${k} spec deleted`);
});

ok('--mode all is the inAll specs (band/churn) — scalp/value are off-by-default (Steps 3+4, Ben 2026-07-09)', () => {
  assert.deepEqual(ALL_MODE_KEYS, ['band', 'churn']);
  for (const k of ['scalp', 'value']) assert.equal(STRATEGIES[k].inAll, false, `${k} is off-by-default`);
  assert.deepEqual(STRATEGY_LIST.filter(s => s.inAll).map(s => s.key), ALL_MODE_KEYS);
});

ok('P5 per-spec falling doctrine + gate selector are registered as designed', () => {
  for (const k of ['band', 'churn']) assert.equal(STRATEGIES[k].falling, 'exclude', `${k} keeps the falling exclusion`);
  assert.equal(STRATEGIES.scalp.falling, 'accept', 'scalp EXPECTS a falling wide band');
  assert.equal(STRATEGIES.value.falling, 'knife-guard', 'value rejects the knife but accepts a value-low');
  for (const k of ['band', 'churn', 'scalp']) assert.equal(STRATEGIES[k].gate, 'band', `${k} uses the shared gate stack`);
  assert.equal(STRATEGIES.value.gate, 'value', 'value routes to the term-structure gate');
  assert.equal(STRATEGIES.scalp.defaultPath, PATH_KEYS.SCALP);
  assert.equal(STRATEGIES.value.defaultPath, PATH_KEYS.VALUE_HOLD);
  assert.equal(STRATEGIES.value.rank, 'value', 'value ranks by valueScore');
});

ok('value GATES trajectory (Ben 2026-07-09 — knife drops), while band/churn/scalp keep it inform', () => {
  const trajMode = k => STRATEGIES[k].validators.find(v => v.key === 'trajectory')?.mode;
  assert.equal(trajMode('value'), 'gate', 'value drops a knife — "buy the base, never the knife" + the hold asymmetry');
  for (const k of ['band', 'churn', 'scalp']) assert.equal(trajMode(k), 'inform', `${k} keeps trajectory inform (already excludes fallers, or accepts by thesis)`);
});

ok('P6b per-thesis estimator family + price-basis fields are registered as designed', () => {
  // estimator family: band/scalp share the intraday family; churn ranks the LAP (Step 6); value has its own.
  for (const k of ['band', 'scalp']) assert.equal(STRATEGIES[k].estimator, 'intraday', `${k} → intraday estimator`);
  assert.equal(STRATEGIES.churn.estimator, 'churn', 'churn → churn estimator (per-lap rank, Step 6)');
  assert.equal(STRATEGIES.value.estimator, 'value', 'value → value estimator');
  // price basis: band/churn/scalp post the 2h band edges; value computes its own term-structure pair.
  for (const k of ['band', 'churn', 'scalp']) assert.equal(STRATEGIES[k].priceBasis, 'opt', `${k} = patient 2h band edges`);
  assert.equal(STRATEGIES.value.priceBasis, 'term', 'value = term-structure pair');
  // and every declared family is one the estimators registry actually serves (no typo).
  for (const s of STRATEGY_LIST) assert.ok(ESTIMATOR_FAMILIES.includes(s.estimator), `${s.key} family in the registry`);
});

/* --- every registered spec is structurally conformant --------------------------------------------- */
ok('every registered spec passes validateStrategySpec (no violations)', () => {
  for (const s of STRATEGY_LIST) {
    const errs = validateStrategySpec(s);
    assert.deepEqual(errs, [], `${s.key} conformant, got: ${errs.join('; ')}`);
  }
});

ok('every spec\'s defaultPath is a valid ENTRY path key in js/paths.mjs\'s vocabulary', () => {
  for (const s of STRATEGY_LIST) {
    assert.ok(VALID_PATH_KEYS.has(s.defaultPath), `${s.key} defaultPath "${s.defaultPath}" is a PATH_KEYS value`);
    assert.ok(ENTRY_PATH_KEYS.includes(s.defaultPath), `${s.key} defaultPath is an unheld-enumerable entry thesis`);
  }
});

ok('the default-entry-path proposal is the documented mapping (Ben-vetoable)', () => {
  // band/churn are flip-first "buy the low, sell the top" plays → the intraday scalp thesis;
  // value is a hold-for-the-cycle move → value-hold. See the strategies.mjs header for the /scan grounding.
  assert.equal(STRATEGIES.band.defaultPath, PATH_KEYS.SCALP);
  assert.equal(STRATEGIES.churn.defaultPath, PATH_KEYS.SCALP);
  assert.equal(STRATEGIES.scalp.defaultPath, PATH_KEYS.SCALP);
  assert.equal(STRATEGIES.value.defaultPath, PATH_KEYS.VALUE_HOLD);
});

ok('no shipped spec carries the (vestigial) pre-fetch pool floor or proxy ranking (rising deleted)', () => {
  // rising was the only spec that set pool.risingFloor:true / rank:'proxy'; its mechanism is now the
  // rankAndSlice rising reserve. band/churn rank by velocity; value ranks by valueScore.
  for (const s of STRATEGY_LIST) assert.equal(s.pool.risingFloor, false, `${s.key} has no rising floor`);
  for (const k of ['band', 'churn', 'scalp']) assert.equal(STRATEGIES[k].rank, 'velocity', `${k} ranks by velocity`);
  assert.equal(STRATEGIES.value.rank, 'value');
});

/* --- the checker BITES on a malformed spec (so P5 additions can't ship broken) --------------------- */
ok('validateStrategySpec catches a deliberately-malformed spec', () => {
  const bad = {
    key: '', label: 42, inAll: 'yes',
    pool: null, edge: 'not-a-fn', rank: 'sideways', confirm: 7,
    validators: 'none', defaultPath: 'not-a-real-path',
  };
  const errs = validateStrategySpec(bad);
  assert.ok(errs.length >= 8, `expected many violations, got ${errs.length}: ${errs.join('; ')}`);
  // spot-check the specific ones the P4c contract names
  assert.ok(errs.some(e => /key/.test(e)), 'flags empty key');
  assert.ok(errs.some(e => /edge must be a function/.test(e)), 'flags non-function edge');
  assert.ok(errs.some(e => /rank must be/.test(e)), 'flags bad rank');
  assert.ok(errs.some(e => /defaultPath/.test(e)), 'flags an unknown default path');
});

ok('a held-only path key is rejected as a surfacing defaultPath (must be an entry thesis)', () => {
  const spec = { ...STRATEGIES.band, defaultPath: PATH_KEYS.CUT };   // cut is a held-lot exit, not an entry
  const errs = validateStrategySpec(spec);
  assert.ok(errs.some(e => /ENTRY/.test(e)), 'a non-entry path key is rejected');
});

/* --- edge functions: no-throw + determinism over the shared replay archetypes --------------------- */
// Reconstruct each archetype's edge inputs from the committed replay snapshot (the same raw v24/band
// the gate stack feeds spec.edge), then run every spec's edge over every archetype.
function edgeInputsFrom(snap) {
  const out = [];
  for (const idStr in snap.items) {
    const it = snap.items[idStr];
    const limitVol = Math.min(it.v24.highPriceVolume || 0, it.v24.lowPriceVolume || 0);
    out.push({
      name: it.name,
      inp: {
        avgHigh: it.v24.avgHighPrice, avgLow: it.v24.avgLowPrice,
        band: it.band, limitVol, limit: it.limit, thin: limitVol < DEFAULT_THRESHOLDS.FLOOR,
      },
    });
  }
  return out;
}
const ARCHE_INPUTS = edgeInputsFrom(buildSnapshot());

ok('every spec\'s edge runs over every archetype WITHOUT throwing', () => {
  for (const s of STRATEGY_LIST) {
    for (const { name, inp } of ARCHE_INPUTS) {
      assert.doesNotThrow(() => s.edge(inp, DEFAULT_THRESHOLDS), `${s.key} edge on ${name}`);
    }
  }
});

ok('every edge returns null OR a well-shaped { modeNet, modeRoi, activeWin } (numbers / null win)', () => {
  for (const s of STRATEGY_LIST) {
    for (const { name, inp } of ARCHE_INPUTS) {
      const e = s.edge(inp, DEFAULT_THRESHOLDS);
      if (e === null) continue;
      assert.equal(typeof e.modeNet, 'number', `${s.key}/${name} modeNet is a number`);
      assert.equal(typeof e.modeRoi, 'number', `${s.key}/${name} modeRoi is a number`);
      assert.ok(e.activeWin === null || typeof e.activeWin === 'number', `${s.key}/${name} activeWin null|number`);
    }
  }
});

ok('edges are DETERMINISTIC — the same input yields a deep-equal result twice', () => {
  for (const s of STRATEGY_LIST) {
    for (const { inp } of ARCHE_INPUTS) {
      assert.deepEqual(s.edge(inp, DEFAULT_THRESHOLDS), s.edge(inp, DEFAULT_THRESHOLDS));
    }
  }
});

/* --- a couple of targeted edge behaviors (the niche-defining gates) ------------------------------- */
ok('band edge returns null when the traded-band ROI can\'t clear the ROI floor (not thin)', () => {
  // a razor-thin traded band on a cheap liquid item: net barely positive, ROI < MIN_ROI, not thin → null.
  const band = { bandLo: 1000, bandHi: 1005, active5m: 20 };
  const inp = { avgHigh: 1005, avgLow: 1000, band, limitVol: 500, limit: 100, thin: false };
  assert.equal(STRATEGIES.band.edge(inp, DEFAULT_THRESHOLDS), null);
});

ok('churn edge requires a TRADED band + volume ≥ CHURN_MIN_VOL + a real buy limit', () => {
  const band = { bandLo: 1000, bandHi: 1030, active5m: 20 };
  const t = DEFAULT_THRESHOLDS;
  // below the churn volume floor → null
  assert.equal(STRATEGIES.churn.edge({ avgHigh: 1030, avgLow: 1000, band, limitVol: CHURN_MIN_VOL - 1, limit: 5000, thin: false }, t), null);
  // no buy limit → null
  assert.equal(STRATEGIES.churn.edge({ avgHigh: 1030, avgLow: 1000, band, limitVol: CHURN_MIN_VOL + 1, limit: null, thin: false }, t), null);
  // liquid enough + a limit + a traded band → an edge (churn accepts a tiny ROI, no MIN_ROI gate)
  const e = STRATEGIES.churn.edge({ avgHigh: 1030, avgLow: 1000, band, limitVol: CHURN_MIN_VOL + 1, limit: 5000, thin: false }, t);
  assert.ok(e && e.modeNet != null && e.activeWin === 20);
});

ok('an untraded band (active5m below MIN_ACTIVE) yields null for band mode', () => {
  const t = DEFAULT_THRESHOLDS;
  const spike = { bandLo: 1000, bandHi: 1200, active5m: 2 };   // 2 < MIN_ACTIVE 6
  assert.equal(STRATEGIES.band.edge({ avgHigh: 1200, avgLow: 1000, band: spike, limitVol: 500, limit: 100, thin: false }, t), null);
});

console.log(`\nAll ${pass} conformance checks passed.`);
