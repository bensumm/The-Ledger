#!/usr/bin/env node
/**
 * velocity.test.mjs — acceptance fixtures for the PURE velocityClass classifier (lib/velocity.mjs).
 * Pure over a scalar hold time — fixture-testable with synthetic values, no live data (rule 4).
 * Run: `node pipeline/velocity.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - A round-trip under VELOCITY_FAST_HRS is a fast-cycler; at/over VELOCITY_SLOW_HRS is a
 *     slow-hold; between is mid.
 *   - No measured round-trip (null / negative) is 'n/a' — never silently bucketed as fast.
 *   - The boundaries are half-open: exactly FAST_HRS is NOT fast (it's mid); exactly SLOW_HRS IS
 *     slow-hold.
 */
import assert from 'node:assert/strict';
import { velocityClass, VELOCITY_FAST_HRS, VELOCITY_SLOW_HRS } from './lib/velocity.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const H = 3600;

console.log('#3 velocityClass acceptance:');

ok('a sub-fast round-trip is a fast-cycler', () => {
  assert.equal(velocityClass(0), 'fast-cycler');
  assert.equal(velocityClass(1 * H), 'fast-cycler');
  assert.equal(velocityClass((VELOCITY_FAST_HRS - 0.01) * H), 'fast-cycler');
});

ok('the fast/mid boundary is half-open (exactly FAST_HRS is mid)', () => {
  assert.equal(velocityClass(VELOCITY_FAST_HRS * H), 'mid');
  assert.equal(velocityClass(24 * H), 'mid');
  assert.equal(velocityClass((VELOCITY_SLOW_HRS - 0.01) * H), 'mid');
});

ok('at/over SLOW_HRS is a slow-hold', () => {
  assert.equal(velocityClass(VELOCITY_SLOW_HRS * H), 'slow-hold');
  assert.equal(velocityClass(120 * H), 'slow-hold');
});

ok('no measured round-trip is n/a, never a fabricated fast bucket', () => {
  assert.equal(velocityClass(null), 'n/a');
  assert.equal(velocityClass(undefined), 'n/a');
  assert.equal(velocityClass(-5), 'n/a', 'a negative (bad data) is n/a, not fast');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
