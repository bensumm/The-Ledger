#!/usr/bin/env node
/**
 * dipposture.test.mjs — acceptance fixtures for DP1 (dip DIRECTION, not just depth):
 *   - recentDirection (js/quotecore.js) — the pure 5m direction read.
 *   - dipPostureValidator (js/validate.mjs) — the buy-side INFORM-ONLY / NEVER-REJECT policy over it.
 *
 * Lives in pipeline/ next to validate.test.mjs / quotecore.test.mjs (the convention for js/-module
 * tests; run-tests.mjs auto-discovers it). Everything is PURE over synthetic series, no live data
 * (rule 4). Run: `node pipeline/test/dipposture.test.mjs` (exits non-zero on any failure).
 *
 * HONESTY: every threshold under test is a NAMED PLACEHOLDER (n=2). These fixtures pin the SHAPE of
 * the read (falling vs reverting vs flat, robust-to-a-flier), not that the thresholds are calibrated.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - recentDirection: a FRESH low → falling; a bounced-and-old low → reverting; a mild-recovery old
 *     low → flat; a thin series → null; a LONE FLIER in the last 3 lows must NOT flip the read (median).
 *   - dipPostureValidator: no-dip / held / missing-5m / missing-24h all DEGRADE to pass; falling → pass;
 *     reverting → caution carrying the cross message + crossNet in evidence; a reverting dip with an
 *     unprofitable cross → the "cross unprofitable — pass" language (still caution); NEVER 'reject'.
 *   - inform-mode clamp: a reverting caution runs as pass with gatedStatus 'caution' (never drops).
 *   - registry: VALIDATORS + REGISTRY_ORDER carry 'dip-posture'.
 */
import assert from 'node:assert/strict';
import {
  recentDirection, DIR_MIN_POINTS, DIR_LOOKBACK_H,
} from '../../js/quotecore.js';
import {
  dipPostureValidator, runValidators, worstStatus, informFlags,
  VALIDATORS, REGISTRY_ORDER,
} from '../../js/validate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('DP1 recentDirection + dipPostureValidator acceptance:');

// --- fixture builders -------------------------------------------------------------------------
// Anchor to the REAL now: the validator calls recentDirection() with the DEFAULT now (Date.now()),
// so a fixture must sit inside the live 3h lookback. Points are minute-scale; sub-second drift
// between building and calling is irrelevant. `pts` is [{ agoMin, low }] (any order).
const NOW_S = Math.floor(Date.now() / 1000);
const mk = pts => pts.map(p => ({
  timestamp: NOW_S - p.agoMin * 60,
  avgLowPrice: p.low, avgHighPrice: p.low + 20,
  lowPriceVolume: 5, highPriceVolume: 5,
}));
// evenly-spaced helper: n points at 5-min steps ending `endAgo` min ago, low = lowOf(i) (i: 0=oldest).
const ramp = (n, endAgo, lowOf) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ agoMin: endAgo + (n - 1 - i) * 5, low: lowOf(i) });
  return out;
};

// FALLING — descending into a FRESH low (min at agoMin 0). 20 pts.
const fallingSeries = mk(ramp(20, 0, i => (i < 16 ? 1080 - i * 5 : 1000)));   // last 4 flat at the 1000 low, freshest = 0min old
// REVERTING — min 1000 at agoMin 60 (NOT fresh), recovered to ~1010 by now (bounce ~1%).
const revertingSeries = mk([
  ...ramp(13, 65, i => 1060 - i * 5),   // descend 1060 → 1000 approaching the trough
  { agoMin: 60, low: 1000 },            // the trough (min), 60 min ago
  ...ramp(11, 0, i => 1001 + i),        // rise 1001 → 1011 out of the trough; last-3 median ~1010
]);
// FLAT — same trough 60 min ago but only a mild recovery to ~1003 (bounce ~0.3%, between the atLow
// and the revert thresholds).
const flatSeries = mk([
  ...ramp(13, 65, i => 1060 - i * 5),
  { agoMin: 60, low: 1000 },
  ...ramp(11, 0, () => 1003),           // recent lows all 1003 → bounce 0.003
]);
// THIN — fewer than DIR_MIN_POINTS non-null lows → null.
const thinSeries = mk(ramp(DIR_MIN_POINTS - 2, 0, () => 1000));
// LONE-FLIER — recent lows sit at 1001 (min 1000 is 60 min old, NOT fresh) with ONE spike print at
// agoMin 5. The MEDIAN of the last 3 lows [1001, 1500, 1001] = 1001 (near the low → falling); a naive
// MEAN would be ~1167 (a fake +16% bounce → reverting). This pins the Bar-E robustness.
const flierSeries = mk([
  ...ramp(13, 65, i => 1060 - i * 5),
  { agoMin: 60, low: 1000 },
  ...ramp(11, 0, () => 1001).map(p => (p.agoMin === 5 ? { agoMin: 5, low: 1500 } : p)),
]);

// --- 1. recentDirection -----------------------------------------------------------------------
ok('recentDirection: a FRESH low → falling', () => {
  const rd = recentDirection(fallingSeries);
  assert.equal(rd.dir, 'falling');
  assert.ok(rd.minAgeMin <= 15, 'the low is fresh');
  assert.equal(rd.minLow, 1000);
});
ok('recentDirection: a bounced, OLD low → reverting', () => {
  const rd = recentDirection(revertingSeries);
  assert.equal(rd.dir, 'reverting');
  assert.ok(rd.minAgeMin > 15, 'the low is not fresh');
  assert.ok(rd.bouncePct >= 0.004, `bounced off the low (${(rd.bouncePct * 100).toFixed(2)}%)`);
});
ok('recentDirection: a mild-recovery OLD low → flat', () => {
  const rd = recentDirection(flatSeries);
  assert.equal(rd.dir, 'flat');
  assert.ok(rd.bouncePct > 0.002 && rd.bouncePct < 0.004, 'between the at-low and revert thresholds');
});
ok('recentDirection: a thin series → null (degrade, never guess)', () => {
  assert.equal(recentDirection(thinSeries), null);
  assert.equal(recentDirection([]), null);
  assert.equal(recentDirection(null), null);
});
ok('recentDirection: a LONE FLIER in the last 3 lows does NOT flip the read (median holds)', () => {
  const rd = recentDirection(flierSeries);
  assert.equal(rd.recentLevel, 1001, 'the median of the last 3 lows ignores the 1500 flier (a mean would be ~1167)');
  assert.equal(rd.dir, 'falling', 'still reads at-the-low despite the spike print');
});

// --- 2. dipPostureValidator -------------------------------------------------------------------
// avgLow24 1000 vs quickBuy 980 = a 2% dip (clears DIPPOST_MIN_PCT). crossable: quickSell 1010 →
// optSell 1060 (a profitable after-tax cross).
const dipRow = (over = {}) => ({ quickBuy: 980, quickSell: 1010, optSell: 1060, bond: false, guide: null, ...over });
const ctxDip = (ts5m, avgLow24, row = dipRow(), extra = {}) => ({ market: { row }, intraday: { ts5m, avgLow24 }, ...extra });

ok('dipPostureValidator: no dip (live not under the 24h avg low by ≥ DIPPOST_MIN_PCT) → degrade', () => {
  const r = dipPostureValidator(ctxDip(fallingSeries, 1000, dipRow({ quickBuy: 995 })));   // 0.5% dip
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'no-dip');
});
ok('dipPostureValidator: a held lot is a SELL decision → degrade (BUY-side only)', () => {
  const r = dipPostureValidator(ctxDip(fallingSeries, 1000, dipRow(), { position: { held: true } }));
  assert.equal(r.status, 'pass');
  assert.equal(r.reason, 'held-lot-sell-side');
});
ok('dipPostureValidator: missing 5m series / missing 24h avg → degrade (never reject on absence)', () => {
  assert.equal(dipPostureValidator(ctxDip(null, 1000)).reason, 'no-5m-series');
  assert.equal(dipPostureValidator(ctxDip(fallingSeries, null)).reason, 'no-24h-avg');
  assert.equal(dipPostureValidator({ market: { row: dipRow() } }).reason, 'no-24h-avg');
  assert.equal(dipPostureValidator({ intraday: { ts5m: fallingSeries, avgLow24: 1000 } }).reason, 'no-quote');
});
ok('dipPostureValidator: a still-FALLING dip → pass (a resting bid fills as it drops)', () => {
  const r = dipPostureValidator(ctxDip(fallingSeries, 1000));
  assert.equal(r.status, 'pass');
  assert.equal(r.evidence.dir, 'falling');
  assert.match(r.reason, /still falling/);
});
ok('dipPostureValidator: a REVERTING dip → caution with the cross message + crossNet in evidence', () => {
  const r = dipPostureValidator(ctxDip(revertingSeries, 1000));
  assert.equal(r.status, 'caution');
  assert.equal(r.evidence.dir, 'reverting');
  assert.match(r.reason, /reverting dip/);
  assert.match(r.reason, /cross @ 1,010/);
  // net = optSell 1060 − tax(1060) − quickSell 1010 = 1060 − 21 − 1010 = 29 (> 0, so the profitable branch).
  assert.equal(r.evidence.crossNet, 29);
  assert.ok(r.evidence.crossNet > 0);
});
ok('dipPostureValidator: a reverting dip whose cross is UNPROFITABLE → the pass-language message (still caution)', () => {
  // optSell == quickSell → after-tax cross net ≤ 0 → "cross unprofitable at the patient ask — pass".
  const r = dipPostureValidator(ctxDip(revertingSeries, 1000, dipRow({ optSell: 1010 })));
  assert.equal(r.status, 'caution');
  assert.match(r.reason, /cross unprofitable at the patient ask — pass/);
  assert.ok(r.evidence.crossNet <= 0);
});
ok('dipPostureValidator: NEVER emits reject across any fixture (the never-drop invariant)', () => {
  const cases = [
    ctxDip(fallingSeries, 1000), ctxDip(revertingSeries, 1000), ctxDip(flatSeries, 1000),
    ctxDip(thinSeries, 1000), ctxDip(null, 1000), ctxDip(fallingSeries, null),
    ctxDip(fallingSeries, 1000, dipRow({ quickBuy: 995 })),
    ctxDip(revertingSeries, 1000, dipRow({ optSell: 1010 })),
    ctxDip(fallingSeries, 1000, dipRow(), { position: { held: true } }),
  ];
  for (const c of cases) assert.notEqual(dipPostureValidator(c).status, 'reject');
});

// --- 3. inform-mode clamp (via runValidators) -------------------------------------------------
ok('inform mode: a reverting caution runs as pass with gatedStatus caution (never drops the row)', () => {
  const ctx = ctxDip(revertingSeries, 1000);
  const gated = runValidators(ctx, { specs: [{ key: 'dip-posture', mode: 'gate' }] });
  assert.equal(worstStatus(gated), 'caution', 'gate mode: the reverting dip cautions');

  const informed = runValidators(ctx, { specs: [{ key: 'dip-posture', mode: 'inform' }] });
  assert.equal(worstStatus(informed), 'pass', 'inform mode: never downgrades the row');
  assert.equal(informed[0].gatedStatus, 'caution', 'the would-have verdict is preserved');
  assert.equal(informFlags(informed).length, 1, 'informFlags surfaces the annotate-only finding');
});

// --- 4. registry membership -------------------------------------------------------------------
ok('registry: VALIDATORS + REGISTRY_ORDER carry dip-posture (last)', () => {
  assert.equal(typeof VALIDATORS['dip-posture'], 'function');
  assert.ok(REGISTRY_ORDER.includes('dip-posture'));
  assert.equal(REGISTRY_ORDER[REGISTRY_ORDER.length - 1], 'dip-posture');
});

console.log(`\nAll ${pass} acceptance checks passed. (DIR_LOOKBACK_H=${DIR_LOOKBACK_H}h — placeholder, n=2)`);
