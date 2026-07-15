#!/usr/bin/env node
/**
 * subfloor.test.mjs — acceptance fixtures for the P6c EMPTY-RESULT SUB-FLOOR FALLBACK.
 *
 * Ben's ruling (2026-07-09): when a niche's floors leave ZERO candidates, the screen must not print
 * an empty table and stop — it re-runs the SAME gate stack beneath the floor (subFloorFallback in
 * pipeline/lib/gatecandidates.mjs — no forked gate logic, just relaxed thresholds through
 * gateCandidates) and shows the best few rows HONESTLY LABELED. Never silently lower the bar.
 *
 * What this file pins (the P6c contract):
 *   1. TRIGGER SHAPE — the fallback un-empties a pool the MIN_GPD attention floor emptied, and names
 *      'min-gpd' as the relaxed floor; a pool the LIQUIDITY floor emptied escalates to 'liquidity'.
 *   2. NON-EMPTY BYTE-IDENTITY — the fallback never runs on a non-empty niche (screen.mjs's trigger is
 *      `!cand.length`); pinned here by asserting gateCandidates at the configured floors is UNCHANGED
 *      by the fallback's existence (same module, same thresholds → same output), and structurally by
 *      the P1 replay goldens (gateCandidates itself was not touched by P6c).
 *   3. FLOORS ONLY, NEVER DOCTRINE — the two-sided liquidity gate and the per-niche EDGE are never
 *      relaxed: a market that fails those returns null (screen keeps its normal `_none_`).
 *   4. LABEL — subFloorLabel names WHICH floor was relaxed and its configured value.
 *   5. CAP — the fallback slice is bounded to SUBFLOOR_TOP; grades cap at SUBFLOOR_GRADE_CAP.
 *   6. LEDGER LEAN MARKER (YS2 pattern) — suggestionEntry writes `subFloor` ONLY when supplied; a
 *      floor-qualified row's logged shape is byte-identical to pre-P6c.
 *   7. VALUE SCOPE-OUT — the value niche (own term-structure floors + §F flood control) returns null.
 *
 * Run: `node pipeline/subfloor.test.mjs` (exits non-zero on any failure). No live data (rule 4).
 */
import assert from 'node:assert/strict';
import {
  gateCandidates, rankAndSlice, subFloorFallback, subFloorLabel,
  SUBFLOOR_TOP, SUBFLOOR_GRADE_CAP, DEFAULT_THRESHOLDS,
} from './lib/gatecandidates.mjs';
import { capGrade } from './lib/rating.mjs';
import { suggestionEntry } from './lib/suggestlog.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// Fixture helpers (same vocabulary as gatecandidates.test.mjs).
const baseT = {
  FLOOR: 50, MIN_ROI: 1.5, MIN_PRICE: 0, MAX_PRICE: 45e6, MIN_NET_GP: 100_000,
  MIN_TRADED: 6, MIN_TRADED_THIN: 2, MIN_GPD: 500_000, GP_FLOOR: 250_000_000,
};
const rec = (avgLow, avgHigh, hpv, lpv = hpv) => ({ avgLowPrice: avgLow, avgHighPrice: avgHigh, highPriceVolume: hpv, lowPriceVolume: lpv });
const band = (bandLo, bandHi, active5m, tradedWin = active5m, sawLow = true, sawHigh = true) => ({ bandLo, bandHi, active5m, tradedWin, sawLow, sawHigh });
const ctx = (v24, byId = {}, bands = {}) => ({ v24, map: { byId }, bands });
// Steps 3+4: spread was deleted, so these tests use `band` as the generic vehicle — band requires a
// TRADED band record (Bar D: tradedWin ≥ MIN_TRADED[_THIN] + two-sided), so each fixture carries one.

console.log('subfloor — P6c empty-result sub-floor fallback:');

/* --- 1. trigger + which-floor identification ----------------------------------------------------- */
ok('MIN_GPD-emptied pool: fallback fires, relaxed floor = min-gpd, rows still cleared liquidity+edge', () => {
  // liquid two-sided item with a real edge but tiny throughput: expGpDay ≈ 1.6k, far below the 500k floor.
  const v24 = { 300: rec(1000, 1100, 200) }, bands = { 300: band(1000, 1100, 10) };
  assert.equal(gateCandidates('band', ctx(v24, {}, bands), baseT).length, 0, 'precondition: empty at the configured floors');
  const fb = subFloorFallback('band', ctx(v24, {}, bands), baseT);
  assert.ok(fb, 'the fallback un-empties the pool');
  assert.equal(fb.relaxed, 'min-gpd', 'the attention floor was the emptier');
  assert.deepEqual(fb.cand.map(c => c.id), [300]);
  assert.equal(fb.cand[0].thin, false, 'the row cleared the real liquidity floor — only MIN_GPD was relaxed');
});

ok('liquidity-emptied pool: escalates to the liquidity step (two-sided but below unit floor AND gp-flow)', () => {
  // two-sided, big honest edge, but 20/day units (<50) and 20×~5.5k gp-flow ≪ 250m → liquidity-emptied.
  const v24 = { 7: rec(5000, 6000, 20) }, bands = { 7: band(5000, 6000, 6) };
  assert.equal(gateCandidates('band', ctx(v24, {}, bands), baseT).length, 0, 'precondition: empty at the configured floors');
  const fb = subFloorFallback('band', ctx(v24, {}, bands), baseT);
  assert.ok(fb, 'the liquidity relaxation un-empties it');
  assert.equal(fb.relaxed, 'liquidity');
  assert.equal(fb.cand[0].thin, true, 'admitted via the (relaxed) gp-flow path → still flagged thin');
});

/* --- 2. non-empty niches untouched ---------------------------------------------------------------- */
ok('a non-empty niche is untouched: the configured-floor gate output is unchanged by P6c', () => {
  // thin big-ticket that passes TODAY's gate on gp-flow (the gatecandidates.test.mjs fixture) — P6c
  // added exports only; gateCandidates at the configured floors must return exactly what it did.
  const v24 = { 7: rec(17_000_000, 18_000_000, 20) }, bands = { 7: band(17_000_000, 18_000_000, 6) };
  const cand = gateCandidates('band', ctx(v24, {}, bands), baseT);
  assert.equal(cand.length, 1);
  assert.equal(cand[0].thin, true);
  // (screen.mjs only calls subFloorFallback when this is empty — with ≥1 candidate the render path
  // takes subFloor=null and is byte-identical; the replay goldens pin the full funnel.)
});

/* --- 3. floors only — never the two-sided gate or the edge ---------------------------------------- */
ok('a one-sided market returns null (the two-sided gate is NEVER relaxed)', () => {
  const v24 = { 9: rec(1000, 1100, 200, 0) };   // lpv=0 — ghost-spread (dropped pre-edge, no band needed)
  assert.equal(subFloorFallback('band', ctx(v24), baseT), null);
});

ok('an edge-emptied market returns null (the thesis edge is NEVER relaxed)', () => {
  // liquid, two-sided, but the after-tax band ROI is below MIN_ROI — the EDGE emptied the niche,
  // not a floor → no fallback; the screen keeps its normal `_none_`.
  const v24 = { 10: rec(1000, 1005, 5000) }, bands = { 10: band(1000, 1005, 10) };   // ~-1.5% after tax
  assert.equal(gateCandidates('band', ctx(v24, {}, bands), baseT).length, 0);
  assert.equal(subFloorFallback('band', ctx(v24, {}, bands), baseT), null);
});

/* --- 4. the honest label --------------------------------------------------------------------------- */
ok('subFloorLabel names the relaxed floor and its configured value', () => {
  const fb = subFloorFallback('band', ctx({ 300: rec(1000, 1100, 200) }, {}, { 300: band(1000, 1100, 10) }), baseT);
  const label = subFloorLabel(fb);
  assert.match(label, /^sub-floor — shown because nothing cleared /, 'the spec wording leads');
  assert.match(label, /500k gp\/day attention floor/, 'names the floor + its value');
  assert.match(label, /min-gpd/, 'names which floor was relaxed');
});

/* --- 5. the cap ------------------------------------------------------------------------------------ */
ok('the fallback pool is sliced to SUBFLOOR_TOP by the existing ordering (rankAndSlice)', () => {
  const v24 = {}, bands = {};
  for (let i = 0; i < 12; i++) { v24[400 + i] = rec(1000 + i, 1100 + i, 200); bands[400 + i] = band(1000 + i, 1100 + i, 10); }   // 12 sub-MIN_GPD liquid rows
  const fb = subFloorFallback('band', ctx(v24, {}, bands), baseT);
  assert.ok(fb.cand.length > SUBFLOOR_TOP, `precondition: relaxed pool (${fb.cand.length}) exceeds the cap`);
  const sliced = rankAndSlice('band', fb.cand, {}, { thinReserve: 6, top: SUBFLOOR_TOP });
  assert.equal(sliced.length, SUBFLOOR_TOP, 'best few only — the fallback never dumps the pool');
});

ok('SUBFLOOR_GRADE_CAP clamps every headline grade down to the cap', () => {
  for (const g of ['S+', 'S', 'A+', 'A-', 'B']) assert.equal(capGrade(g, SUBFLOOR_GRADE_CAP), SUBFLOOR_GRADE_CAP, `${g} → ${SUBFLOOR_GRADE_CAP}`);
  assert.equal(capGrade('D', SUBFLOOR_GRADE_CAP), 'D', 'a grade at/below the cap is untouched');
});

/* --- 6. suggestions-ledger lean marker (YS2 byte-identity) ---------------------------------------- */
ok('suggestionEntry: `subFloor` is lean-included — absent ⇒ byte-identical row shape', () => {
  const row = { quickBuy: 100, optBuy: 95, quickSell: 110, optSell: 115, mom: null, regimeLabel: 'flat' };
  const plain = suggestionEntry(row, { itemId: 1, cls: 'mid', verdict: 'B' });
  assert.ok(!('subFloor' in plain), 'a floor-qualified row logs NO subFloor key (byte-identity)');
  assert.ok(!('subFloor' in suggestionEntry(row, { itemId: 1, cls: 'mid', verdict: 'B', subFloor: null })), 'explicit null is still lean-dropped');
  const marked = suggestionEntry(row, { itemId: 1, cls: 'mid', verdict: 'C', subFloor: 'min-gpd' });
  assert.equal(marked.subFloor, 'min-gpd', 'a fallback row carries which floor was relaxed');
  const { subFloor, ...rest } = marked;
  assert.deepEqual(rest, { ...plain, verdict: 'C' }, 'the marker is the ONLY shape difference');
});

/* --- 7. value niche scope-out ---------------------------------------------------------------------- */
ok('value niche: out of scope — subFloorFallback returns null (own floors + §F flood control)', () => {
  assert.equal(subFloorFallback('value', { v24: {}, map: { byId: {} }, bands: {}, daily: {} }, DEFAULT_THRESHOLDS), null);
});

ok('unknown mode returns null (defensive)', () => {
  assert.equal(subFloorFallback('nope', ctx({}), baseT), null);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
