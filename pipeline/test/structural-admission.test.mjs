#!/usr/bin/env node
/**
 * structural-admission.test.mjs — acceptance fixtures for the STRUCTURAL admission gate
 * (PLAN-LANE-ADMISSION, Chunk B). Pure module, synthetic v24 data only (CLAUDE.md rule 4 — no live API).
 * Run: `node pipeline/test/structural-admission.test.mjs`  (exits non-zero on any failure).
 *
 * WHAT THIS PINS — the universal gate + lane classifier documented in PLAN-LANE-ADMISSION.md
 * "The validated admission system", asserting the HARD-WON lessons (do NOT simplify these back out):
 *   - thin = min(hpv, lpv) is an ABSOLUTE depth floor, NOT a balance ratio (min/max) — a hugely-liquid
 *     but lopsided book passes; a genuine ghost (min-side ~0) fails.
 *   - notional = value × volDay is 2-D: a low-vol/high-val big ticket and a moderate/moderate mid-tier
 *     both pass where a single value-floor or volume-floor would amputate one of them.
 *   - null limit → thin floor MIN_THIN (25) fallback, NOT exclude.
 *   - lane = volume: volDay ≥ 20k → churn, else gear.
 * Plus: the `--gate structural` routing seam through gateCandidates is purely additive (legacy default
 * unchanged), proven directly here (not against golden.json — that's the sibling suites' job).
 */
import assert from 'node:assert/strict';
import {
  structuralGate, classifyVolLane, eachStructuralCandidate,
  MIN_VALUE, MIN_THIN, MIN_NOTIONAL, CHURN_VOL_CUT, DEFAULT_STRUCTURAL,
} from '../lib/structural-admission.mjs';
import { gateCandidates } from '../lib/gatecandidates.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('structural-admission.mjs constants + classifyVolLane():');

ok('placeholder thresholds are the documented values', () => {
  assert.equal(MIN_VALUE, 100);
  assert.equal(MIN_THIN, 25);
  assert.equal(MIN_NOTIONAL, 25_000_000);
  assert.equal(CHURN_VOL_CUT, 20_000);
});

ok('classifyVolLane: volume is the ONLY discriminator (≥ cut → churn, else gear)', () => {
  assert.equal(classifyVolLane(20_000), 'churn', 'at the cut → churn (>= boundary)');
  assert.equal(classifyVolLane(19_999), 'gear', 'just below the cut → gear');
  assert.equal(classifyVolLane(500_000), 'churn');
  assert.equal(classifyVolLane(8_000), 'gear');
  assert.equal(classifyVolLane(0), 'gear');
  assert.equal(classifyVolLane(null), 'gear', 'null/unknown volume → the conservative gear bucket');
});

console.log('\nstructural-admission.mjs structuralGate() — the universal gate:');

ok('value floor: a sub-100gp dust item is dropped (reason "value")', () => {
  const g = structuralGate({ value: 50, volDay: 10_000_000, hpv: 5_000_000, lpv: 5_000_000, limit: 1000 });
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'value');
});

ok('thin = ABSOLUTE min(hpv,lpv), NOT a ratio: a lopsided-but-deep book PASSES', () => {
  // bird-nest shape: thin side 72k vs high side 500k → ratio 0.14 (a "ghost" by ratio) but trivially
  // crossable in absolute terms. value 300, volDay 572k → notional 171m ≥ 25m. limit small.
  const g = structuralGate({ value: 300, volDay: 572_000, hpv: 500_000, lpv: 72_000, limit: 5000 });
  assert.equal(g.pass, true, 'absolute depth 72k ≥ max(limit,25) → admitted despite the lopsided ratio');
  assert.equal(g.thinDepth, 72_000);
});

ok('thin: a genuine ghost (one side ~0) is DROPPED (reason "thin")', () => {
  // Silver bolts unf 14.3k / 0 — huge one side, zero the other → min 0 < 25.
  const g = structuralGate({ value: 200, volDay: 14_300, hpv: 14_300, lpv: 0, limit: 11000 });
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'thin');
  assert.equal(g.thinDepth, 0);
});

ok('thin floor is max(limit, 25): min-side must clear the buy limit when it exceeds 25', () => {
  // min-side 30, limit 100 → thin floor max(100,25)=100 → 30 < 100 → dropped.
  const below = structuralGate({ value: 1_000_000, volDay: 200, hpv: 100, lpv: 30, limit: 100 });
  assert.equal(below.pass, false);
  assert.equal(below.reason, 'thin', 'a limit-worth of depth is required on the thin side');
  // min-side 120 clears the same limit → passes (notional 1m×200=200m ≥ 25m).
  const above = structuralGate({ value: 1_000_000, volDay: 240, hpv: 120, lpv: 120, limit: 100 });
  assert.equal(above.pass, true);
});

ok('null limit → MIN_THIN (25) fallback, NOT exclude (the newer-gear case)', () => {
  // Webweaver-shape: limit=null, thin side 30 ≥ 25 → admitted. High value, low vol → notional clears.
  const passNull = structuralGate({ value: 40_000_000, volDay: 60, hpv: 30, lpv: 30, limit: null });
  assert.equal(passNull.pass, true, 'null limit uses the 25 floor, does not hard-exclude');
  // same shape but thin side 20 < 25 → dropped on the fallback floor.
  const dropNull = structuralGate({ value: 40_000_000, volDay: 40, hpv: 20, lpv: 20, limit: null });
  assert.equal(dropNull.pass, false);
  assert.equal(dropNull.reason, 'thin');
});

ok('notional is 2-D (value × volDay): low-vol/high-val AND mid/mid both pass; junk fails', () => {
  // Twisted-bow shape: vol 300, value 1.47b → notional 441b ≫ 25m (a value-floor-free admit).
  const twbow = structuralGate({ value: 1_470_000_000, volDay: 300, hpv: 150, lpv: 150, limit: 8 });
  assert.equal(twbow.pass, true, 'a low-volume big-ticket clears on money-flow, not raw volume');
  // Dragon-scimitar mid-tier: value ~100k, vol ~4000 → notional 400m — the 182-item hole a value floor amputated.
  const dscim = structuralGate({ value: 100_000, volDay: 4_000, hpv: 2_000, lpv: 2_000, limit: 70 });
  assert.equal(dscim.pass, true, 'the moderate/moderate mid-tier survives (no single-axis floor amputates it)');
  // Halloween-mask junk: low vol, low-ish flow → notional 1m < 25m → dropped on notional.
  const junk = structuralGate({ value: 5_000, volDay: 200, hpv: 100, lpv: 100, limit: 8 });
  assert.equal(junk.pass, false);
  assert.equal(junk.reason, 'notional', 'neither value nor volume alone catches it — money-flow does');
});

ok('gate returns volLane on every item (pass or fail) off volDay', () => {
  const churn = structuralGate({ value: 1000, volDay: 50_000, hpv: 25_000, lpv: 25_000, limit: 1000 });
  assert.equal(churn.volLane, 'churn');
  const gear = structuralGate({ value: 5_000_000, volDay: 500, hpv: 250, lpv: 250, limit: 10 });
  assert.equal(gear.volLane, 'gear');
});

ok('thresholds are overridable (fixtures/CLI can drive them)', () => {
  const item = { value: 1000, volDay: 10_000, hpv: 5_000, lpv: 5_000, limit: 100 };
  assert.equal(structuralGate(item).pass, false, 'notional 10m < default 25m → dropped');
  assert.equal(structuralGate(item, { ...DEFAULT_STRUCTURAL, minNotional: 5_000_000 }).pass, true, 'lowered floor admits it');
});

console.log('\nstructural-admission.mjs eachStructuralCandidate() — the iterator:');

const rec = (avgLow, avgHigh, hpv, lpv = hpv) => ({ avgLowPrice: avgLow, avgHighPrice: avgHigh, highPriceVolume: hpv, lowPriceVolume: lpv });
const ctx = (v24, byId = {}) => ({ v24, map: { byId } });
// an identity fn returning the candidate context (so we can inspect what the iterator hands back).
const idFn = c => ({ id: c.id, mid: c.mid, limitVol: c.limitVol, thin: c.thin, volLane: c.volLane });

ok('iterator applies the universal gate and mirrors the callback shape', () => {
  const v24 = {
    // churn liquid: mid 1050, volDay 100k, notional 105m ≥ 25m → passes, churn lane.
    1: rec(1000, 1100, 50_000, 50_000),
    // dust: mid 50 < 100 → dropped.
    2: rec(40, 60, 50_000, 50_000),
    // ghost: lpv 0 → thin 0 → dropped.
    3: rec(1000, 1100, 50_000, 0),
  };
  const out = eachStructuralCandidate(ctx(v24), DEFAULT_STRUCTURAL, idFn);
  assert.deepEqual(out.map(c => c.id), [1], 'only the fully-qualified item survives');
  assert.equal(out[0].volLane, 'churn');
  assert.equal(out[0].limitVol, 50_000, 'limitVol carries the min-side depth (== eachLiquidCandidate contract)');
});

ok('iterator: gear-lane survivor gets thin:true (the big-ticket legacy analogue); churn gets thin:false', () => {
  const v24 = {
    // gear big-ticket: mid 40m, volDay 60, notional 2.4b, thin side 30 ≥ 25 → gear lane.
    10: rec(39_000_000, 41_000_000, 30, 30),
    // churn commodity: volDay 100k → churn lane.
    11: rec(1000, 1100, 50_000, 50_000),
  };
  const out = eachStructuralCandidate(ctx(v24, { 10: { limit: null }, 11: { limit: 1000 } }), DEFAULT_STRUCTURAL, idFn);
  const byId = Object.fromEntries(out.map(c => [c.id, c]));
  assert.equal(byId[10].volLane, 'gear');
  assert.equal(byId[10].thin, true, 'gear big-ticket rides the thin/attention-floor-exempt path');
  assert.equal(byId[11].volLane, 'churn');
  assert.equal(byId[11].thin, false, 'churn commodity is an ordinary liquid row');
});

ok('iterator: null limit from the mapping uses the 25 fallback (not exclude)', () => {
  const v24 = { 20: rec(39_000_000, 41_000_000, 30, 30) };   // thin 30 ≥ 25
  const out = eachStructuralCandidate(ctx(v24, { 20: { limit: null } }), DEFAULT_STRUCTURAL, idFn);
  assert.equal(out.length, 1, 'limit=null → 25 floor → 30 ≥ 25 → admitted');
});

ok('iterator: a null fn-return is a per-item drop (collects only non-null, == eachLiquidCandidate)', () => {
  const v24 = { 1: rec(1000, 1100, 50_000), 2: rec(1000, 1100, 50_000) };
  const out = eachStructuralCandidate(ctx(v24), DEFAULT_STRUCTURAL, c => (c.id === 1 ? null : { id: c.id }));
  assert.deepEqual(out.map(c => c.id), [2]);
});

ok('iterator: survivors carry volLane/thinDepth/volDay attached to the fn result', () => {
  const v24 = { 1: rec(1000, 1100, 50_000, 40_000) };
  const out = eachStructuralCandidate(ctx(v24), DEFAULT_STRUCTURAL, c => ({ id: c.id }));
  assert.equal(out[0].volLane, 'churn');
  assert.equal(out[0].thinDepth, 40_000);
  assert.equal(out[0].volDay, 90_000);
});

console.log('\nstructural-admission.mjs --gate routing through gateCandidates():');

// mirror gatecandidates.test.mjs's baseT so the per-mode edge doesn't incidentally filter — a wide
// traded band + low floors so the STRUCTURAL admission is what decides membership here.
const baseT = {
  FLOOR: 50, MIN_ROI: 1.5, MIN_PRICE: 0, MAX_PRICE: 45e6, MIN_NET_GP: 100_000,
  MIN_TRADED: 6, MIN_TRADED_THIN: 2, MIN_GPD: 1000, GP_FLOOR: 250_000_000, VALUE_LIQ_FLOOR: 50,
};
const band = (bandLo, bandHi, active5m, tradedWin = active5m, sawLow = true, sawHigh = true) => ({ bandLo, bandHi, active5m, tradedWin, sawLow, sawHigh });
const gctx = (v24, byId = {}, bands = {}) => ({ v24, map: { byId }, bands });

ok('GATE omitted / legacy → the legacy eachLiquidCandidate admission is used (unchanged)', () => {
  // an item that PASSES legacy (limitVol 200 ≥ FLOOR 50) but FAILS structural (notional 1100×400=440k < 25m).
  const v24 = { 1: rec(1000, 1100, 200, 200) };
  const bands = { 1: band(1000, 1100, 10) };
  const legacy = gateCandidates('band', gctx(v24, {}, bands), baseT);
  assert.equal(legacy.length, 1, 'legacy admits the liquid low-notional row (default, byte-identical)');
  const legacy2 = gateCandidates('band', gctx(v24, {}, bands), { ...baseT, GATE: 'legacy' });
  assert.equal(legacy2.length, 1, 'explicit --gate legacy is identical');
});

ok('GATE structural → the universal gate decides membership; the per-mode edge still runs after', () => {
  // same low-notional row: structural DROPS it (notional 440k < 25m) though it cleared legacy above.
  const lowNotional = { 1: rec(1000, 1100, 200, 200) };
  const lnBands = { 1: band(1000, 1100, 10) };
  assert.equal(gateCandidates('band', gctx(lowNotional, {}, lnBands), { ...baseT, GATE: 'structural' }).length, 0,
    'structural notional floor drops the liquid-but-low-money-flow row');
  // a churn commodity clearing structural (mid 1050 × volDay 100k = 105m ≥ 25m) AND the band edge → admitted.
  const churn = { 2: rec(1000, 1100, 50_000, 50_000) };
  const chBands = { 2: band(1000, 1100, 10) };
  const out = gateCandidates('band', gctx(churn, { 2: { limit: 1000 } }, chBands), { ...baseT, GATE: 'structural' });
  assert.equal(out.length, 1, 'a genuine money-flow commodity clears structural + the band edge');
  assert.equal(out[0].id, 2);
});

ok('GATE structural: a gear big-ticket is EXEMPT from the attention floor (thin=gear analogue)', () => {
  // mid 40m, volDay 60 → gear lane → thin:true → exempt from even a huge MIN_GPD, like the legacy thin path.
  const gear = { 5: rec(39_000_000, 41_000_000, 30, 30) };
  const gBands = { 5: band(39_000_000, 41_000_000, 6) };
  const out = gateCandidates('band', gctx(gear, { 5: { limit: null } }, gBands), { ...baseT, GATE: 'structural', MIN_GPD: 10_000_000, MAX_PRICE: 60_000_000 });
  assert.equal(out.length, 1, 'gear big-ticket clears despite a 10m attention floor');
  assert.equal(out[0].thin, true);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
