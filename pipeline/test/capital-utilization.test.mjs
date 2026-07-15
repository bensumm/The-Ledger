#!/usr/bin/env node
/**
 * capital-utilization.test.mjs — acceptance fixtures for #3's PURE capital-utilization reads
 * (lib/capital-utilization.mjs). Pure over plain objects — fixture-testable with synthetic values, no live
 * data (rule 4). Run: `node pipeline/test/capital-utilization.test.mjs` (exits non-zero on any failure).
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
import { bookUtilization, parkedStats, totalCapital } from '../lib/capital-utilization.mjs';

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

ok('totalCapital: committed + stated idle cash, pcts sum to 100', () => {
  const t = totalCapital({ workingGp: 24_000_000, parkedGp: 8_000_000, cashGp: 8_000_000 });
  assert.equal(t.committedGp, 32_000_000);
  assert.equal(t.totalGp, 40_000_000);
  assert.equal(t.committedPct, 80);
  assert.equal(t.idlePct, 20, 'committedPct + idlePct == 100');
});

ok('totalCapital: cash UNKNOWN (null) → total/pcts null, committed absolute still known', () => {
  const t = totalCapital({ workingGp: 500, parkedGp: 300, cashGp: null });
  assert.equal(t.committedGp, 800, 'we always know the committed absolute');
  assert.equal(t.totalGp, null, 'never fake a total we can\'t measure');
  assert.equal(t.committedPct, null);
  assert.equal(t.idlePct, null);
  assert.equal(totalCapital({ workingGp: 500, parkedGp: 300 }).totalGp, null, 'omitted cash == unknown');
});

ok('totalCapital: cash 0 → all-committed (100% / 0% idle); empty book → total 0, pcts null', () => {
  const allIn = totalCapital({ workingGp: 1000, parkedGp: 0, cashGp: 0 });
  assert.equal(allIn.totalGp, 1000);
  assert.equal(allIn.committedPct, 100);
  assert.equal(allIn.idlePct, 0, 'cash 0 is KNOWN idle=0, not unknown');
  const empty = totalCapital({ workingGp: 0, parkedGp: 0, cashGp: 0 });
  assert.equal(empty.totalGp, 0);
  assert.equal(empty.committedPct, null, 'no capital at all → no pct, never divide by zero');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
