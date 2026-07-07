#!/usr/bin/env node
/**
 * statetransition.test.mjs — acceptance fixtures for YP2's PURE state-transition classifier
 * (lib/statetransition.mjs). Pure over a phase() result — fixture-testable with synthetic values,
 * no live data (rule 4). Run: `node pipeline/statetransition.test.mjs`.
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - A 'basing' phase (a faller that flattened) is a watch-closely transition — the case the
 *     screen's falling-exclusion would otherwise drop.
 *   - A 'spike' is split by its recent-low slope: rising lows → spike-rising-lows (healthy),
 *     falling lows → spike-falling-lows (froth), flat/absent → a plain spike watch.
 *   - base / decay / unknown / null are NOT watch-closely transitions (return null) — the list
 *     stays focused, never a firehose.
 */
import assert from 'node:assert/strict';
import { stateTransition } from './lib/statetransition.mjs';
import { PHASE_LOW_FLAT_PCT } from '../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('YP2 state-transition acceptance:');

ok('a basing faller is a watch-closely transition', () => {
  const t = stateTransition({ phase: 'basing', lowSlope: 0.0 });
  assert.equal(t.state, 'basing');
  assert.equal(t.watch, true);
});

ok('a spike on rising lows is healthy; on falling lows is froth', () => {
  const rising = stateTransition({ phase: 'spike', lowSlope: PHASE_LOW_FLAT_PCT + 0.05 });
  assert.equal(rising.state, 'spike-rising-lows');
  const froth = stateTransition({ phase: 'spike', lowSlope: -(PHASE_LOW_FLAT_PCT + 0.05) });
  assert.equal(froth.state, 'spike-falling-lows');
});

ok('a spike with flat/absent low-slope is a plain spike watch', () => {
  assert.equal(stateTransition({ phase: 'spike', lowSlope: 0 }).state, 'spike');
  assert.equal(stateTransition({ phase: 'spike', lowSlope: null }).state, 'spike');
});

ok('base / decay / unknown / null are NOT watch-closely (null)', () => {
  assert.equal(stateTransition({ phase: 'base', lowSlope: 0 }), null);
  assert.equal(stateTransition({ phase: 'decay', lowSlope: -0.5 }), null);
  assert.equal(stateTransition({ phase: 'unknown' }), null);
  assert.equal(stateTransition(null), null);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
