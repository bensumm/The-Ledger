#!/usr/bin/env node
/**
 * velocitytag.test.mjs — acceptance for Build 2's PURE per-item velocity read (lib/velocitytag.mjs).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - buildVelocityIndex aggregates outcomes campaigns by itemId: dominant MEASURED velocityClass
 *     (n/a excluded), n classed, median time-to-first-fill of FILLED campaigns, bid + never-filled
 *     counts. A null/shapeless input yields an EMPTY index (never throws) → screen stays silent.
 *   - velocityTag returns null below minN (never label off an anecdote); formats `fast·~Nm`, and
 *     appends ` N% unfilled` ONLY when ≥minN bids and ≥20% of them never filled (the parked-capital
 *     tell). A label, never a rate.
 */
import assert from 'node:assert/strict';
import { buildVelocityIndex, velocityTag } from './lib/velocitytag.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('Build 2 velocity-tag acceptance:');

ok('buildVelocityIndex: dominant class, n classed, median fill, bid/never-filled counts', () => {
  const idx = buildVelocityIndex({ generatedAt: '2026-07-06T00:00:00Z', campaigns: [
    { itemId: 560, name: 'Blood rune', side: 'buy',  velocityClass: 'fast-cycler', everFilled: true,  timeToFirstFill: 540 }, // 9m
    { itemId: 560, name: 'Blood rune', side: 'buy',  velocityClass: 'fast-cycler', everFilled: true,  timeToFirstFill: 660 }, // 11m
    { itemId: 560, name: 'Blood rune', side: 'buy',  velocityClass: 'mid',         everFilled: false, timeToFirstFill: null }, // never filled
    { itemId: 560, name: 'Blood rune', side: 'sell', velocityClass: 'fast-cycler', everFilled: true,  timeToFirstFill: 600 },
  ] });
  const e = idx.byItem.get(560);
  assert.equal(e.velocityClass, 'fast-cycler', 'dominant (3 fast vs 1 mid)');
  assert.equal(e.n, 4, 'all four carry a class');
  assert.equal(e.medianFillSec, 600, 'median of 540,600,660');
  assert.equal(e.nBids, 3);
  assert.equal(e.nNeverFilled, 1);
  assert.equal(idx.generatedAt, '2026-07-06T00:00:00Z');
});

ok('buildVelocityIndex: n/a excluded from class ranking; null/empty input → empty, no throw', () => {
  const idx = buildVelocityIndex({ campaigns: [{ itemId: 1, side: 'buy', velocityClass: 'n/a', everFilled: true, timeToFirstFill: 60 }] });
  assert.equal(idx.byItem.get(1).velocityClass, null, 'n/a is not a class');
  assert.equal(idx.byItem.get(1).n, 0);
  assert.equal(buildVelocityIndex(null).byItem.size, 0);
  assert.equal(buildVelocityIndex({}).byItem.size, 0);
});

ok('velocityTag: null below minN; fast·~9m format; "% unfilled" only at ≥20%', () => {
  assert.equal(velocityTag({ velocityClass: 'fast-cycler', n: 2, medianFillSec: 540, nBids: 2, nNeverFilled: 0 }), null, 'below minN → no anecdote tag');
  assert.equal(velocityTag({ velocityClass: 'fast-cycler', n: 9, medianFillSec: 540, nBids: 9, nNeverFilled: 0 }), 'fast·~9m');
  assert.equal(velocityTag({ velocityClass: 'slow-hold', n: 8, medianFillSec: 1440, nBids: 8, nNeverFilled: 2 }), 'slow·~24m 25% unfilled');
  assert.equal(velocityTag({ velocityClass: 'mid', n: 10, medianFillSec: null, nBids: 10, nNeverFilled: 1 }), 'mid', '10% unfilled is below the 20% floor → omitted; no fill time → class only');
  assert.equal(velocityTag(null), null);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
