#!/usr/bin/env node
/**
 * expunitsovernight.test.mjs — pins expUnitsOvernight (COD-2), the overnight accumulation-sizing
 * formula the /overnight skill used to hand-compute with a PROSE plea to "keep the constants aligned
 * with expUnits". expUnitsOvernight IS expUnits scaled to the OVERNIGHT_SPAN_H (8h) window, so the
 * 6-limits/day and 10% volume-share constants can NEVER drift from the day figure. This file asserts
 * BOTH the alignment (it equals expUnits × span/24 exactly) AND the closed-form the skill documented
 * (min(limit×2, 8/24 × 0.10 × volDay)), so a future edit to either constant that breaks the identity
 * fails here.
 * Run: `node pipeline/expunitsovernight.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { expUnits, expUnitsOvernight } from './lib/gatecandidates.mjs';
import { OVERNIGHT_SPAN_H } from '../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const K = OVERNIGHT_SPAN_H / 24;   // the span/24 scale; 8/24 with the shipped OVERNIGHT_SPAN_H=8
// the closed form the /overnight skill documented, computed independently of the implementation
const closedForm = (limit, volDay) => {
  const vShare = (OVERNIGHT_SPAN_H / 24) * 0.10 * (volDay || 0);
  return limit != null ? Math.min(limit * (24 / 4) * K, vShare) : vShare;   // 24/4=6 limits/day, scaled
};

ok('span constant is 8h (the documented overnight window)', () => {
  assert.equal(OVERNIGHT_SPAN_H, 8);
});

ok('equals expUnits × span/24 exactly (constants cannot drift)', () => {
  for (const [limit, vol] of [[10, 5000], [30, 200000], [1, 40], [null, 12000], [null, 0], [5000, 1_000_000]]) {
    assert.equal(expUnitsOvernight(limit, vol), expUnits(limit, vol) * K,
      `alignment broke for limit=${limit} vol=${vol}`);
  }
});

ok('matches the documented closed form min(limit×2, 8/24×0.10×volDay)', () => {
  for (const [limit, vol] of [[10, 5000], [30, 200000], [1, 40], [5000, 1_000_000]]) {
    assert.equal(expUnitsOvernight(limit, vol), closedForm(limit, vol),
      `closed-form mismatch for limit=${limit} vol=${vol}`);
  }
});

ok('limit-bound case: buy limit × 2 dominates a huge daily volume', () => {
  // limit 30 → 30×2 = 60 units; volume-share 8/24×0.10×10m ≈ 333k → the limit binds.
  assert.equal(expUnitsOvernight(30, 10_000_000), 60);
});

ok('volume-bound case: the 10% share dominates a large limit', () => {
  // limit 5000 → 5000×2 = 10000; volume-share 8/24×0.10×12000 = 400 → the share binds.
  assert.equal(expUnitsOvernight(5000, 12000), Math.min(10000, (8 / 24) * 0.10 * 12000));
});

ok('null limit → volume-share only (no limit leg)', () => {
  assert.equal(expUnitsOvernight(null, 12000), (8 / 24) * 0.10 * 12000);
});

ok('zero/absent volume → 0 (never negative, never NaN)', () => {
  assert.equal(expUnitsOvernight(10, 0), 0);
  assert.equal(expUnitsOvernight(null, 0), 0);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
