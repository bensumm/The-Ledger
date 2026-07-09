#!/usr/bin/env node
/**
 * termstructure.test.mjs — acceptance fixtures for the P3 term-structure math (js/termstructure.mjs)
 * and floorValidator (js/validate.mjs).
 *
 * Lives in pipeline/ next to validate.test.mjs / quotecore.test.mjs (the convention for js/-module
 * tests). Everything here is PURE over synthetic daily-mid series — no live data, no SQLite, no
 * network (CLAUDE.md rule 4). Run: `node pipeline/termstructure.test.mjs` (exits non-zero on failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - termStructure: computes the 1/3/7/14/28d structure (median/low/high/pctInRange), a durable floor
 *     (low quantile of the longest multi-week lookback with enough points) and a typical-fluctuation
 *     (IQR) that a single recent spike does NOT inflate. A short/empty series degrades to hasData:false.
 *   - floorValidator (BUY-side ONLY):
 *       · a DECAY-KNIFE buy (bid parked well ABOVE the durable multi-week floor) → reject on BOTH the
 *         screen-shaped ctx and the quote-shaped ctx.
 *       · a GENUINE DIP buy (bid at/below the durable floor) → pass.
 *       · missing archive data (no term structure / cold series) → pass (no-data), NEVER a reject.
 *       · a HELD lot (position.held) is a SELL decision → degrade to pass, never judged.
 */
import assert from 'node:assert/strict';
import {
  termStructure, quantile, FLOOR_QUANTILE, FLOOR_MIN_POINTS, MIN_SWING_FRAC,
} from '../js/termstructure.mjs';
import {
  floorValidator, runValidators, worstStatus, flags,
  FLOOR_REJECT_RANGES, FLOOR_CAUTION_RANGES,
} from '../js/validate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('termstructure.mjs + floorValidator acceptance:');

// --- fixture builders -------------------------------------------------------------------------
const DAY = 86400;
// A daily-mid series anchored so the newest point is `now`. `mids` is oldest→newest; one point per
// `stepDays` (default 1) walking backward from now. Returns ascending `[{ts,mid}]`.
const NOW = Math.floor(new Date(2026, 6, 8, 12, 0, 0).getTime() / 1000);   // 2026-07-08 (an arbitrary fixed instant)
function seriesFrom(mids, { now = NOW, stepDays = 1 } = {}) {
  const n = mids.length;
  return mids.map((mid, i) => ({ ts: now - (n - 1 - i) * stepDays * DAY, mid }));
}

// --- 1. quantile + termStructure basics -------------------------------------------------------
ok('quantile interpolates an ascending array', () => {
  assert.equal(quantile([10, 20, 30, 40, 50], 0.5), 30);
  assert.equal(quantile([10, 20], 0.5), 15);
  assert.equal(quantile([42], 0.9), 42, 'single element');
  assert.equal(quantile([], 0.5), null, 'empty → null');
});
ok('termStructure computes lookback structure + a durable floor over a flat-ish 28d series', () => {
  // 28 daily mids ranging ~98k–102k around 100k (a stable band commodity), newest at 100k.
  const mids = [];
  for (let i = 0; i < 28; i++) mids.push(100_000 + ((i % 5) - 2) * 1_000);   // 98k..102k, deterministic
  const ts = termStructure(seriesFrom(mids));
  assert.equal(ts.hasData, true);
  assert.equal(ts.current, mids[mids.length - 1]);
  assert.ok(ts.lookbacks[28] && ts.lookbacks[28].n >= FLOOR_MIN_POINTS, '28d lookback populated');
  assert.equal(ts.floorLookback, 28, 'durable floor comes from the 28d lookback');
  assert.ok(ts.floor <= 100_000 && ts.floor >= 97_000, `floor ~ low quantile (got ${ts.floor})`);
  assert.ok(ts.typicalSwing > 0, 'a non-degenerate typical swing');
});
ok('termStructure floor is a LOW quantile (below the median), typical swing is the IQR', () => {
  const mids = [];
  for (let i = 0; i < 28; i++) mids.push(100_000 + i * 200);   // steadily 100k → ~105.4k
  const vals = mids.slice().sort((a, b) => a - b);
  const ts = termStructure(seriesFrom(mids));
  assert.equal(ts.floor, quantile(vals, FLOOR_QUANTILE), 'floor == FLOOR_QUANTILE of the 28d mids');
  assert.equal(ts.typicalSwing, quantile(vals, 0.75) - quantile(vals, 0.25), 'swing == IQR');
});
ok('a single recent spike does NOT inflate the typical swing (IQR is spike-robust)', () => {
  // 27 days flat at 100k, one recent spike to 200k. IQR stays ~0 (floored by MIN_SWING_FRAC), NOT ~100k.
  const mids = new Array(27).fill(100_000); mids.push(200_000);
  const ts = termStructure(seriesFrom(mids));
  assert.ok(ts.typicalSwing <= 100_000 * MIN_SWING_FRAC + 1, `spike excluded from IQR (swing ${ts.typicalSwing})`);
  assert.ok(ts.floor <= 100_001, 'floor unaffected by the lone high spike');
});

// --- 2. degrade contract ----------------------------------------------------------------------
ok('an empty / single-point series degrades to hasData:false', () => {
  assert.equal(termStructure([]).hasData, false);
  assert.equal(termStructure([{ ts: NOW, mid: 100 }]).hasData, false);
  assert.equal(termStructure(null).hasData, false);
});
ok('a series too short for a multi-week floor has hasData:true but a null floor', () => {
  // 3 points over 3 days — real data, but < FLOOR_MIN_POINTS in any 14/28d window → no durable floor.
  const ts = termStructure(seriesFrom([100_000, 101_000, 100_500]));
  assert.equal(ts.hasData, true);
  assert.equal(ts.floor, null, 'too few multi-week points to assert a floor');
  assert.equal(ts.floorLookback, null);
});

// --- ctx builders for floorValidator (the two surface shapes) ---------------------------------
// screen-shaped: market.row (optBuy) + history.termStructure + explicit floor.level; no position.
const screenCtx = (row, ts, level) => ({ market: { row }, history: { termStructure: ts }, floor: { level } });
// quote-shaped: same, but let floorValidator fall back to row.optBuy (no explicit floor.level).
const quoteCtx = (row, ts) => ({ market: { row }, history: { termStructure: ts } });

// --- 3. THE ACCEPTANCE: decay-knife reject, genuine-dip pass ----------------------------------
// DECAY KNIFE: 28d durable base ~30k (a long low range), a recent spike-and-decay still ELEVATED at
// ~52k. The buy (optBuy≈52k) sits MANY typical swings above the 30k durable floor → reject.
function decayKnifeSeries() {
  const mids = [];
  for (let i = 0; i < 22; i++) mids.push(30_000 + ((i % 3) - 1) * 500);   // 22 days ranging 29.5k–30.5k (the durable base)
  for (const m of [45_000, 58_000, 60_000, 56_000, 53_000, 52_000]) mids.push(m);   // spike then decaying, still high
  return seriesFrom(mids);
}
ok('DECAY-KNIFE buy well above the durable floor → REJECT (screen-shaped ctx)', () => {
  const ts = termStructure(decayKnifeSeries());
  assert.ok(ts.floor < 32_000, `durable floor is the ~30k base (got ${ts.floor})`);
  const r = floorValidator(screenCtx({ optBuy: 52_000 }, ts, 52_000));
  assert.equal(r.status, 'reject', `52k buy is ${r.evidence.ranges}× swing above the floor`);
  assert.ok(r.evidence.ranges > FLOOR_REJECT_RANGES);
  assert.match(r.reason, /not near durable support/);
});
ok('DECAY-KNIFE buy → REJECT (quote-shaped ctx, optBuy fallback) — SAME verdict on BOTH surfaces', () => {
  const ts = termStructure(decayKnifeSeries());
  const r = floorValidator(quoteCtx({ optBuy: 52_000 }, ts));
  assert.equal(r.status, 'reject');
  assert.equal(r.evidence.level, 52_000, 'fell back to row.optBuy as the buy candidate');
});
ok('DECAY-KNIFE row drops via runValidators on the screen ctx (worst status = reject)', () => {
  const ts = termStructure(decayKnifeSeries());
  const res = runValidators(screenCtx({ optBuy: 52_000, optSell: 60_000 }, ts, 52_000));
  assert.equal(worstStatus(res), 'reject');
  assert.ok(flags(res).some(f => f.key === 'floor' && f.status === 'reject'));
});

// GENUINE DIP: 28d ranging ~100k–110k (durable floor ~100k), the live dip took price to ~98k, BELOW
// the durable floor. The buy (optBuy≈98k) is at/under the floor → pass (a real dip near durable support).
function genuineDipSeries() {
  const mids = [];
  for (let i = 0; i < 26; i++) mids.push(105_000 + ((i % 5) - 2) * 2_500);   // 100k–110k range
  for (const m of [101_000, 98_000]) mids.push(m);   // recent dip below the range floor
  return seriesFrom(mids);
}
ok('GENUINE-DIP buy at/below the durable floor → PASS (screen-shaped ctx)', () => {
  const ts = termStructure(genuineDipSeries());
  assert.ok(ts.floor >= 99_000 && ts.floor <= 102_000, `durable floor ~100k (got ${ts.floor})`);
  const r = floorValidator(screenCtx({ optBuy: 98_000 }, ts, 98_000));
  assert.equal(r.status, 'pass', `98k buy sits ${r.evidence.ranges}× swing from the floor (at/below it)`);
  assert.ok(r.evidence.ranges <= FLOOR_CAUTION_RANGES);
});
ok('GENUINE-DIP buy → PASS (quote-shaped ctx) — SAME verdict on BOTH surfaces', () => {
  const ts = termStructure(genuineDipSeries());
  const r = floorValidator(quoteCtx({ optBuy: 98_000 }, ts));
  assert.equal(r.status, 'pass');
});

// --- 4. no-data + held-lot degrades (never reject on absence / never judge a sell) ------------
ok('no term structure → PASS (no-term-structure), never a reject', () => {
  const r = floorValidator(screenCtx({ optBuy: 52_000 }, null, 52_000));
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-term-structure');
});
ok('a cold (hasData:false) structure → PASS (no-term-structure)', () => {
  const cold = termStructure([]);   // hasData:false
  const r = floorValidator(quoteCtx({ optBuy: 52_000 }, cold));
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-term-structure');
});
ok('a real structure with too few multi-week points (null floor) → PASS (no-durable-floor)', () => {
  const thin = termStructure(seriesFrom([100_000, 101_000, 100_500]));   // hasData:true, floor null
  const r = floorValidator(quoteCtx({ optBuy: 100_000 }, thin));
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-durable-floor');
});
ok('no buy candidate (no floor.level, no row.optBuy) → PASS (no-buy-candidate)', () => {
  const ts = termStructure(decayKnifeSeries());
  const r = floorValidator({ market: { row: {} }, history: { termStructure: ts } });
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-buy-candidate');
});
ok('a HELD lot is a SELL decision → PASS (held-lot-sell-side), even parked above the floor', () => {
  const ts = termStructure(decayKnifeSeries());
  // held position with an elevated buy that WOULD reject if it were a buy candidate — must NOT.
  const r = floorValidator({ market: { row: { optBuy: 52_000 } }, history: { termStructure: ts }, position: { held: true }, floor: { level: 52_000 } });
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'held-lot-sell-side');
});

// --- 5. registry wiring: floor is registered and runs alongside reach (+ limit, LM1) -----------
ok('runValidators runs reach + floor + limit (registry has all keys)', () => {
  const res = runValidators({ intraday: { ts1h: null } });   // all degrade with no inputs
  const keys = res.map(r => r.key).sort();
  assert.deepEqual(keys, ['floor', 'limit', 'reach']);
  assert.ok(res.every(r => r.status === 'pass'), 'no inputs → all degrade to pass');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
