#!/usr/bin/env node
/**
 * flip-niches.test.mjs — the CONFORMANCE suite for the declarative strategy registry (js/flip-niches.mjs,
 * Pipeline v2 chunk P4c).
 *
 * The registry re-expresses the screen's niches (band/churn + provisional scalp/value; spread/rising were
 * DELETED in Steps 3+4) as DATA-SHAPED specs that pipeline/lib/gatecandidates.mjs drives instead of
 * branching on the niche name. This file is the
 * conformance harness the P4c spec calls for: it iterates the registry and asserts every spec's
 * STRUCTURAL contract (required fields, edge callable, default-path key in js/held-item-strategy.mjs's vocabulary,
 * gates well-formed), proves the checker BITES on a deliberately-malformed spec, and runs each edge over
 * the shared replay archetypes for NO-THROW + DETERMINISM — so when P5 registers the scalp/value specs
 * they get conformance-checked for free. Pure + offline — NO live API (CLAUDE.md rule 4).
 *
 * The byte-identity of the edge MATH (that the specs reproduce the old inline gateCandidates logic) is
 * pinned separately + more strongly by the P1 replay goldens (replay.test.mjs) and gatecandidates.test.mjs
 * — this suite owns the spec CONTRACT, not the numeric acceptance.
 * Run: `node pipeline/flip-niches.test.mjs`  (exits non-zero on any failure). Auto-discovered by run-tests.mjs.
 */
import assert from 'node:assert/strict';
import {
  FLIP_NICHE_LIST, FLIP_NICHES, MODE_KEYS, ALL_MODE_KEYS, ENTRY_PATH_KEYS,
  validateNicheSpec, CHURN_MIN_VOL,
} from '../js/flip-niches.mjs';
import { PATH_KEYS } from '../js/held-item-strategy.mjs';
import { ESTIMATOR_FAMILIES } from './lib/estimators.mjs';
import { DEFAULT_THRESHOLDS } from './lib/gatecandidates.mjs';
import { buildSnapshot } from './lib/replay.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const VALID_PATH_KEYS = new Set(Object.values(PATH_KEYS));

console.log('flip-niches.mjs conformance:');

/* --- registry shape ------------------------------------------------------------------------------- */
ok('the registry holds the four niches (Steps 3+4 deleted spread/rising), in order, keyed correctly', () => {
  assert.deepEqual(MODE_KEYS, ['band', 'churn', 'scalp', 'value']);
  assert.deepEqual(FLIP_NICHE_LIST.map(s => s.key), MODE_KEYS);
  for (const s of FLIP_NICHE_LIST) assert.equal(FLIP_NICHES[s.key], s, `${s.key} indexed by key`);
  // the deleted specs are truly gone from the registry.
  for (const k of ['spread', 'rising']) assert.equal(FLIP_NICHES[k], undefined, `${k} spec deleted`);
});

ok('--mode all is the inAll specs (band/churn/value) — scalp stays off-by-default (Ben 2026-07-10: value graduated into the default scan)', () => {
  assert.deepEqual(ALL_MODE_KEYS, ['band', 'churn', 'value']);
  assert.equal(FLIP_NICHES.scalp.inAll, false, 'scalp is off-by-default');
  assert.deepEqual(FLIP_NICHE_LIST.filter(s => s.inAll).map(s => s.key), ALL_MODE_KEYS);
});

ok('P5 per-spec falling doctrine + gate selector are registered as designed', () => {
  for (const k of ['band', 'churn']) assert.equal(FLIP_NICHES[k].falling, 'exclude', `${k} keeps the falling exclusion`);
  assert.equal(FLIP_NICHES.scalp.falling, 'accept', 'scalp EXPECTS a falling wide band');
  assert.equal(FLIP_NICHES.value.falling, 'knife-guard', 'value rejects the knife but accepts a value-low');
  for (const k of ['band', 'churn', 'scalp']) assert.equal(FLIP_NICHES[k].gate, 'band', `${k} uses the shared gate stack`);
  assert.equal(FLIP_NICHES.value.gate, 'value', 'value routes to the term-structure gate');
  assert.equal(FLIP_NICHES.scalp.defaultPath, PATH_KEYS.SCALP);
  assert.equal(FLIP_NICHES.value.defaultPath, PATH_KEYS.VALUE_HOLD);
  assert.equal(FLIP_NICHES.value.rank, 'value', 'value ranks by valueScore');
});

ok('value GATES trajectory (Ben 2026-07-09 — knife drops), while band/churn/scalp keep it inform', () => {
  const trajMode = k => FLIP_NICHES[k].validators.find(v => v.key === 'trajectory')?.mode;
  assert.equal(trajMode('value'), 'gate', 'value drops a knife — "buy the base, never the knife" + the hold asymmetry');
  for (const k of ['band', 'churn', 'scalp']) assert.equal(trajMode(k), 'inform', `${k} keeps trajectory inform (already excludes fallers, or accepts by thesis)`);
});

ok('P6b per-thesis estimator family + price-basis fields are registered as designed', () => {
  // estimator family: band/scalp share the intraday family; churn ranks the LAP (Step 6); value has its own.
  for (const k of ['band', 'scalp']) assert.equal(FLIP_NICHES[k].estimator, 'intraday', `${k} → intraday estimator`);
  assert.equal(FLIP_NICHES.churn.estimator, 'churn', 'churn → churn estimator (per-lap rank, Step 6)');
  assert.equal(FLIP_NICHES.value.estimator, 'value', 'value → value estimator');
  // price basis: band/churn/scalp post the 2h band edges; value computes its own term-structure pair.
  for (const k of ['band', 'churn', 'scalp']) assert.equal(FLIP_NICHES[k].priceBasis, 'opt', `${k} = patient 2h band edges`);
  assert.equal(FLIP_NICHES.value.priceBasis, 'term', 'value = term-structure pair');
  // and every declared family is one the estimators registry actually serves (no typo).
  for (const s of FLIP_NICHE_LIST) assert.ok(ESTIMATOR_FAMILIES.includes(s.estimator), `${s.key} family in the registry`);
});

/* --- every registered spec is structurally conformant --------------------------------------------- */
ok('every registered spec passes validateNicheSpec (no violations)', () => {
  for (const s of FLIP_NICHE_LIST) {
    const errs = validateNicheSpec(s);
    assert.deepEqual(errs, [], `${s.key} conformant, got: ${errs.join('; ')}`);
  }
});

ok('every spec\'s defaultPath is a valid ENTRY path key in js/held-item-strategy.mjs\'s vocabulary', () => {
  for (const s of FLIP_NICHE_LIST) {
    assert.ok(VALID_PATH_KEYS.has(s.defaultPath), `${s.key} defaultPath "${s.defaultPath}" is a PATH_KEYS value`);
    assert.ok(ENTRY_PATH_KEYS.includes(s.defaultPath), `${s.key} defaultPath is an unheld-enumerable entry thesis`);
  }
});

ok('the default-entry-path proposal is the documented mapping (Ben-vetoable)', () => {
  // band/churn are flip-first "buy the low, sell the top" plays → the intraday scalp thesis;
  // value is a hold-for-the-cycle move → value-hold. See the flip-niches.mjs header for the /scan grounding.
  assert.equal(FLIP_NICHES.band.defaultPath, PATH_KEYS.SCALP);
  assert.equal(FLIP_NICHES.churn.defaultPath, PATH_KEYS.SCALP);
  assert.equal(FLIP_NICHES.scalp.defaultPath, PATH_KEYS.SCALP);
  assert.equal(FLIP_NICHES.value.defaultPath, PATH_KEYS.VALUE_HOLD);
});

ok('no shipped spec ranks by proxy (rising deleted); ranks are velocity/value', () => {
  // rising was the only spec that ranked by 'proxy'; its fetch-ordering mechanism is now the rankAndSlice
  // rising reserve (proxyDrift-based). band/churn/scalp rank by velocity; value ranks by valueScore.
  for (const k of ['band', 'churn', 'scalp']) assert.equal(FLIP_NICHES[k].rank, 'velocity', `${k} ranks by velocity`);
  assert.equal(FLIP_NICHES.value.rank, 'value');
});

/* --- the checker BITES on a malformed spec (so P5 additions can't ship broken) --------------------- */
ok('validateNicheSpec catches a deliberately-malformed spec', () => {
  const bad = {
    key: '', label: 42, inAll: 'yes',
    pool: null, edge: 'not-a-fn', rank: 'sideways', confirm: 7,
    validators: 'none', defaultPath: 'not-a-real-path',
  };
  const errs = validateNicheSpec(bad);
  assert.ok(errs.length >= 8, `expected many violations, got ${errs.length}: ${errs.join('; ')}`);
  // spot-check the specific ones the P4c contract names
  assert.ok(errs.some(e => /key/.test(e)), 'flags empty key');
  assert.ok(errs.some(e => /edge must be a function/.test(e)), 'flags non-function edge');
  assert.ok(errs.some(e => /rank must be/.test(e)), 'flags bad rank');
  assert.ok(errs.some(e => /defaultPath/.test(e)), 'flags an unknown default path');
});

ok('a held-only path key is rejected as a surfacing defaultPath (must be an entry thesis)', () => {
  const spec = { ...FLIP_NICHES.band, defaultPath: PATH_KEYS.CUT };   // cut is a held-lot exit, not an entry
  const errs = validateNicheSpec(spec);
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
  for (const s of FLIP_NICHE_LIST) {
    for (const { name, inp } of ARCHE_INPUTS) {
      assert.doesNotThrow(() => s.edge(inp, DEFAULT_THRESHOLDS), `${s.key} edge on ${name}`);
    }
  }
});

ok('every edge returns null OR a well-shaped { modeNet, modeRoi, activeWin } (numbers / null win)', () => {
  for (const s of FLIP_NICHE_LIST) {
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
  for (const s of FLIP_NICHE_LIST) {
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
  assert.equal(FLIP_NICHES.band.edge(inp, DEFAULT_THRESHOLDS), null);
});

ok('churn edge requires a TRADED band + volume ≥ CHURN_MIN_VOL + a real buy limit', () => {
  const band = { bandLo: 1000, bandHi: 1030, active5m: 20 };
  const t = DEFAULT_THRESHOLDS;
  // below the churn volume floor → null
  assert.equal(FLIP_NICHES.churn.edge({ avgHigh: 1030, avgLow: 1000, band, limitVol: CHURN_MIN_VOL - 1, limit: 5000, thin: false }, t), null);
  // no buy limit → null
  assert.equal(FLIP_NICHES.churn.edge({ avgHigh: 1030, avgLow: 1000, band, limitVol: CHURN_MIN_VOL + 1, limit: null, thin: false }, t), null);
  // liquid enough + a limit + a traded band → an edge (churn accepts a tiny ROI, no MIN_ROI gate)
  const e = FLIP_NICHES.churn.edge({ avgHigh: 1030, avgLow: 1000, band, limitVol: CHURN_MIN_VOL + 1, limit: 5000, thin: false }, t);
  assert.ok(e && e.modeNet != null && e.activeWin === 20);
});

ok('Bar D: a low-density band (tradedWin below MIN_TRADED) yields null for band mode', () => {
  const t = DEFAULT_THRESHOLDS;
  const spike = { bandLo: 1000, bandHi: 1200, active5m: 2, tradedWin: 2, sawLow: true, sawHigh: true };   // 2 < MIN_TRADED 6
  assert.equal(FLIP_NICHES.band.edge({ avgHigh: 1200, avgLow: 1000, band: spike, limitVol: 500, limit: 100, thin: false }, t), null);
});

ok('Bar D: a thin big ticket with active5m 0 but tradedWin ≥ MIN_TRADED_THIN + two-sided PASSES', () => {
  const t = DEFAULT_THRESHOLDS;
  // the exact bug: never two-sided within one 5m bucket (active5m 0), but 8 windows traded + both sides seen.
  const bigTicket = { bandLo: 14_700_000, bandHi: 15_400_000, active5m: 0, tradedWin: 8, sawLow: true, sawHigh: true };
  const e = FLIP_NICHES.band.edge({ avgHigh: 15_400_000, avgLow: 14_700_000, band: bigTicket, limitVol: 20, limit: 8, thin: true }, t);
  assert.ok(e && e.modeNet > 0, 'admitted on tradedWin+two-sided despite active5m 0');
  assert.equal(e.activeWin, 8, 'activeWin now reports tradedWin (density), not active5m');
});

ok('Bar D: a one-sided ghost (sawHigh false) yields null even with high density', () => {
  const t = DEFAULT_THRESHOLDS;
  const ghost = { bandLo: 1000, bandHi: 1200, active5m: 0, tradedWin: 12, sawLow: true, sawHigh: false };
  assert.equal(FLIP_NICHES.band.edge({ avgHigh: 1200, avgLow: 1000, band: ghost, limitVol: 500, limit: 100, thin: false }, t), null);
});

ok('Bar D: legacy band record without tradedWin falls back to active5m (back-compat)', () => {
  const t = DEFAULT_THRESHOLDS;
  const legacy = { bandLo: 1000, bandHi: 1200, active5m: 10 };   // no tradedWin/sawLow/sawHigh → density=10, two-sided no-op
  const e = FLIP_NICHES.band.edge({ avgHigh: 1200, avgLow: 1000, band: legacy, limitVol: 500, limit: 100, thin: false }, t);
  assert.ok(e && e.activeWin === 10, 'legacy record survives via the active5m fallback');
});

console.log(`\nAll ${pass} conformance checks passed.`);
