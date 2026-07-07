#!/usr/bin/env node
/**
 * capitalutil.test.mjs — acceptance fixtures for #3's PURE capital-utilization reads
 * (lib/capitalutil.mjs). Pure over plain objects — fixture-testable with synthetic values, no live
 * data (rule 4). Run: `node pipeline/capitalutil.test.mjs` (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - bookUtilization splits committed capital into working (held) vs parked (bids); the pct is
 *     working/(working+parked), rounded, and NULL when nothing is committed (never a fake 0/100).
 *   - all-parked reads 0% working; all-working reads 100%.
 *   - parkedStats counts bids / filled-bids / never-filled, medians the MEASURED parkedSec of
 *     filled bids only, and tallies the velocityClass mix; a never-filled bid counts as parked and
 *     is excluded from the parked-time median (it has no first-fill).
 */
import assert from 'node:assert/strict';
import { bookUtilization, parkedStats } from './lib/capitalutil.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('#3 capital-utilization acceptance:');

ok('bookUtilization: working/(working+parked), rounded', () => {
  const u = bookUtilization({ workingGp: 800, parkedGp: 200 });
  assert.equal(u.committed, 1000);
  assert.equal(u.utilizationPct, 80);
});

ok('bookUtilization edges: all-parked 0%, all-working 100%, nothing committed null', () => {
  assert.equal(bookUtilization({ workingGp: 0, parkedGp: 500 }).utilizationPct, 0);
  assert.equal(bookUtilization({ workingGp: 500, parkedGp: 0 }).utilizationPct, 100);
  assert.equal(bookUtilization({ workingGp: 0, parkedGp: 0 }).utilizationPct, null, 'no capital → null, never a fake %');
  assert.equal(bookUtilization().utilizationPct, null);
});

ok('parkedStats: bid/filled/never-filled counts + parked-time median (filled only) + velocity mix', () => {
  const campaigns = [
    { side: 'buy', everFilled: true, parkedSec: 100, velocityClass: 'fast-cycler' },
    { side: 'buy', everFilled: true, parkedSec: 300, velocityClass: 'mid' },
    { side: 'buy', everFilled: false, parkedSec: 9999, velocityClass: 'n/a' },   // never filled → parked, no first-fill
    { side: 'sell', everFilled: true, parkedSec: 5, velocityClass: 'slow-hold' },
  ];
  const ps = parkedStats(campaigns);
  assert.equal(ps.nBids, 3, 'three buy campaigns');
  assert.equal(ps.nFilledBids, 2);
  assert.equal(ps.nNeverFilled, 1);
  assert.equal(ps.medianParkedSec, 200, 'median of the two FILLED bids (100,300) — never-filled excluded');
  assert.equal(ps.velocityDist['fast-cycler'], 1);
  assert.equal(ps.velocityDist['slow-hold'], 1);
  assert.equal(ps.velocityDist['n/a'], 1);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
