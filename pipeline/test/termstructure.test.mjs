#!/usr/bin/env node
/**
 * termstructure.test.mjs — acceptance fixtures for the P3 term-structure math (js/termstructure.mjs)
 * and floorValidator (js/validate.mjs).
 *
 * Lives in pipeline/ next to validate.test.mjs / quotecore.test.mjs (the convention for js/-module
 * tests). Everything here is PURE over synthetic daily-mid series — no live data, no SQLite, no
 * network (CLAUDE.md rule 4). Run: `node pipeline/test/termstructure.test.mjs` (exits non-zero on failure).
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
  termStructure, classifyTrajectory, quantile, FLOOR_QUANTILE, FLOOR_MIN_POINTS, MIN_SWING_FRAC,
  basePosition, BASEPOS_LOOKBACK_DAYS,
} from '../../js/termstructure.mjs';
import {
  floorValidator, runValidators, worstStatus, flags,
  FLOOR_REJECT_RANGES, FLOOR_CAUTION_RANGES,
} from '../../js/validate.mjs';

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

// --- 4b. R3 (PLAN-SIGNAL-RECENCY): recentTrend TIGHTENS an elevated buy that is ALSO falling ----
// hand-built ts so the ranges + trend are exact (ranges = (level−floor)/swing). recentTrend is the
// projectTrajectory read termStructure now attaches; here we set its `dir` directly to exercise the gate.
const tsWith = (dir) => ({ hasData: true, floor: 1000, typicalSwing: 100, floorLookback: 28, current: 1000, recentTrend: dir ? { dir, slope: dir === 'falling' ? -50 : 50, run: { dir, len: 3 } } : null });
ok('R3: a caution-range buy (ranges 1.5) + FALLING recent trend → escalates to REJECT (elevated into a decline = a knife)', () => {
  const r = floorValidator(screenCtx({ optBuy: 1150 }, tsWith('falling'), 1150));
  assert.equal(r.status, 'reject');
  assert.match(r.reason, /recent trend falling/);
});
ok('R3: the SAME caution-range buy with a RISING trend stays CAUTION — only falling tightens (recovery ≠ knife)', () => {
  const r = floorValidator(screenCtx({ optBuy: 1150 }, tsWith('rising'), 1150));
  assert.equal(r.status, 'caution');
});
ok('R3: a borderline-elevated PASS (ranges 0.8 ≥ 0.75×caution) + FALLING → nudged to CAUTION', () => {
  const r = floorValidator(screenCtx({ optBuy: 1080 }, tsWith('falling'), 1080));
  assert.equal(r.status, 'caution');
});
ok('R3: a clean LOW pass (ranges 0.5 < 0.75×caution) + FALLING is NOT touched — the headroom guard', () => {
  const r = floorValidator(screenCtx({ optBuy: 1050 }, tsWith('falling'), 1050));
  assert.equal(r.status, 'pass');
});
ok('R3: a re-priced-up recovery is not false-tightened — a borderline buy with a RISING trend stays a PASS', () => {
  const r = floorValidator(screenCtx({ optBuy: 1080 }, tsWith('rising'), 1080));
  assert.equal(r.status, 'pass');
});
ok('R3: real termStructure emits recentTrend (dir over the daily-mid series)', () => {
  const rising = termStructure(seriesFrom([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110, 120, 130, 140, 150].map(x => x * 1000)));
  assert.ok(rising.recentTrend && rising.recentTrend.dir === 'rising', `recentTrend rises over a climbing tail (got ${JSON.stringify(rising.recentTrend)})`);
});
ok('R3: recentTrend buckets a 6h-STEP series to DAYS — not 5 raw points (the Fable calibration bug)', () => {
  // every real caller feeds a 6h-step archive (≤4 pts/day). A rising tail spread over 6h steps must still
  // read as a per-DAY rise, and minDays must gate on DAYS. Build ~12 daily levels, 4 points each (6h apart).
  const levels = [100, 100, 100, 100, 100, 100, 100, 110, 120, 130, 140, 150].map(x => x * 1000);
  const sixH = [];
  const N = levels.length;
  for (let d = 0; d < N; d++) for (let h = 0; h < 4; h++) sixH.push({ ts: NOW - (N - 1 - d) * DAY + h * 6 * 3600 - 3 * DAY, mid: levels[d] });
  const ts = termStructure(sixH);
  assert.ok(ts.recentTrend && ts.recentTrend.dir === 'rising', `the 6h-step rise reads as a per-day rise (got ${JSON.stringify(ts.recentTrend)})`);
  // min-days gates on DAYS, not raw points: 4 daily-spaced points ⇒ null (a 6h path would have ≥16 points,
  // which the OLD unbucketed code would have wrongly treated as > minDays and produced a fake read).
  assert.equal(termStructure(seriesFrom([1, 2, 3, 4].map(x => x * 100000))).recentTrend, null, '4 daily points ⇒ null (< 5 days)');
});

// --- 5. registry wiring: floor is registered and runs alongside reach (+ limit, LM1) -----------
ok('runValidators runs reach + floor + limit (registry has all keys)', () => {
  const res = runValidators({ intraday: { ts1h: null } });   // all degrade with no inputs
  const keys = res.map(r => r.key).sort();
  assert.deepEqual(keys, ['dip-posture', 'floor', 'limit', 'reach', 'trajectory', 'value-amplitude']);
  assert.ok(res.every(r => r.status === 'pass'), 'no inputs → all degrade to pass');
});

// --- 6. classifyTrajectory (2026-07-09) — the SHAPE read attached as ts.trajectory ---------------
const shapeOf = mids => termStructure(seriesFrom(mids)).trajectory.shape;
ok('classifyTrajectory: spike then monotone decline → knife (the Nightmare-staff shape)', () => {
  // a base, a spike, then lows stepping down every day (few reversals) → a knife.
  assert.equal(shapeOf([100, 100, 100, 100, 150, 146, 142, 138, 134, 130, 126, 122, 118, 114, 110]), 'knife');
});
ok('classifyTrajectory: falling BUT oscillating → oscillating, NOT knife (the Hydra distinction)', () => {
  // a declining MEAN with large repeating zigzags — checked BEFORE knife so a rhythmic faller is buyable
  // at the local min rather than mislabeled a knife (Ben 2026-07-09).
  assert.equal(shapeOf([130, 120, 128, 118, 126, 116, 124, 114, 122, 112, 120, 110, 118, 108]), 'oscillating');
});
ok('classifyTrajectory: older-high then a flat low plateau → based (the value-low shape)', () => {
  assert.equal(shapeOf([112, 110, 108, 106, 104, 102, 101, 100, 100, 101, 100, 100, 101, 100]), 'based');
});
ok('classifyTrajectory: a thin series degrades to shape "unknown" (never asserts off too few points)', () => {
  assert.equal(classifyTrajectory([{ ts: NOW, mid: 100 }, { ts: NOW - DAY, mid: 101 }]).shape, 'unknown');
});

// --- 7. basePosition (DT6, PLAN-DIURNAL-TIMING §6) — the multi-week base-position note read --------
// Hand-built `ts` fixtures (mirrors the §4b `tsWith` precedent above) pin the EXACT shape→label
// mapping deterministically, decoupled from real slope-fit arithmetic; one end-to-end case at the
// bottom confirms the real termStructure() wiring (reuses the file's own 'knife' fixture, unchanged).
const bpTs = (shape, pctInRange, { recentDir = null, n = 14 } = {}) => ({
  hasData: true,
  lookbacks: { [BASEPOS_LOOKBACK_DAYS]: { days: BASEPOS_LOOKBACK_DAYS, n, pctInRange } },
  trajectory: { shape },
  recentTrend: recentDir ? { dir: recentDir } : null,
});
ok('basePosition: based/flat shape → range-bound, percentile reused verbatim from the SAME 14d pctInRange', () => {
  const bp = basePosition(bpTs('based', 0.12));
  assert.deepEqual(bp, { pct: 12, days: BASEPOS_LOOKBACK_DAYS, n: 14, label: 'range-bound' });
  assert.equal(basePosition(bpTs('flat', 0.5)).label, 'range-bound');
});
ok('basePosition: rising/elevated shape → trending↑', () => {
  assert.equal(basePosition(bpTs('rising', 0.6)).label, 'trending↑');
  assert.equal(basePosition(bpTs('elevated', 0.9)).label, 'trending↑');
});
ok('basePosition: knife shape → trending↓', () => {
  assert.equal(basePosition(bpTs('knife', 0.8)).label, 'trending↓');
});
ok('basePosition: oscillating + a FALLING recentTrend → decaying (the fang case: "oscillator... decaying... downtrend")', () => {
  assert.equal(basePosition(bpTs('oscillating', 0.3, { recentDir: 'falling' })).label, 'decaying');
});
ok('basePosition: oscillating with no falling drift (rising/flat/absent trend) → range-bound, never a false decay', () => {
  assert.equal(basePosition(bpTs('oscillating', 0.3, { recentDir: 'rising' })).label, 'range-bound');
  assert.equal(basePosition(bpTs('oscillating', 0.3, { recentDir: 'flat' })).label, 'range-bound');
  assert.equal(basePosition(bpTs('oscillating', 0.3)).label, 'range-bound', 'no recentTrend computed at all → range-bound, not a decay guess');
});
ok('basePosition: "unknown" shape (thin series) degrades to null — never fakes a percentile off too little history', () => {
  assert.equal(basePosition(bpTs('unknown', 0.5)), null);
});
ok('basePosition: no term structure / cold / too few 14d points → null (honest degrade, no note)', () => {
  assert.equal(basePosition(null), null);
  assert.equal(basePosition({ hasData: false }), null);
  assert.equal(basePosition({ hasData: true, lookbacks: {}, trajectory: { shape: 'based' } }), null, 'missing 14d lookback entirely');
  assert.equal(basePosition({ hasData: true, lookbacks: { [BASEPOS_LOOKBACK_DAYS]: { n: 2, pctInRange: 0.5 } }, trajectory: { shape: 'based' } }), null, 'too few points (< BASEPOS_MIN_POINTS)');
});
ok('basePosition: pct is clamped to [0,100] and rounded (a pctInRange outside [0,1] from a live print beyond the raw lookback high/low)', () => {
  assert.equal(basePosition(bpTs('based', -0.02)).pct, 0);
  assert.equal(basePosition(bpTs('based', 1.04)).pct, 100);
});
ok('basePosition: end-to-end off a REAL termStructure() knife series — days honestly reports the 14d lookback ACTUALLY used, never an aspirational 90d', () => {
  // the same 15-point spike-then-monotone-decline fixture the "classifyTrajectory ... knife" test above
  // already pins to shape 'knife' — reused verbatim, not a new series.
  const ts = termStructure(seriesFrom([100, 100, 100, 100, 150, 146, 142, 138, 134, 130, 126, 122, 118, 114, 110]));
  assert.equal(ts.trajectory.shape, 'knife', 'sanity: same fixture the shapeOf test already confirms');
  const bp = basePosition(ts);
  assert.ok(bp, 'a real 15-point series clears BASEPOS_MIN_POINTS');
  assert.equal(bp.label, 'trending↓', 'the knife shape maps to trending↓');
  assert.equal(bp.days, BASEPOS_LOOKBACK_DAYS, 'reports the ACTUAL lookback horizon used (14), never 90');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
