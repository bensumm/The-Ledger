#!/usr/bin/env node
/**
 * bandedge.test.mjs — acceptance fixtures for the Bar E ROBUST BAND EDGE (marketfetch.mjs robustBand).
 *
 * Bar E (Ben 2026-07-10) — Bar D fixed WHETHER a band gates; Bar E fixes WHERE its edges sit. The raw
 * min/max over the 2h of 5m prints let ONE flier print (a lone 100k against a 59k mid) set the edge and
 * inflate the surfaced ROI (the "band-top artifact"). robustBand takes the p90 high / p10 low on a DENSE
 * side (≥ BAND_EDGE_MIN_SAMPLE prints) and keeps the raw extremum on a SPARSE side (a quantile over a few
 * points either == the max or wrongly discards the one real high — the thin big-ticket class Bar D just
 * admitted, backstopped by the reach validator). This file pins that contract; it is a PURE-function test
 * (no fetch/fs — robustBand takes plain arrays). No live data (CLAUDE.md rule 4).
 * Run: `node pipeline/bandedge.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import {
  robustBand, BAND_EDGE_MIN_SAMPLE, BAND_EDGE_HI_Q, BAND_EDGE_LO_Q,
} from './lib/marketfetch.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const rep = (v, n) => Array.from({ length: n }, () => v);   // n copies of a price

console.log('bandedge — Bar E robust band edge:');

/* --- 1. the flier is trimmed on a DENSE side --------------------------------------------------------- */
ok('dense high side: a lone flier no longer sets bandHi (p90, not the max)', () => {
  // 11 highs clustered at 60k + ONE 100k flier — a dense side (≥8) → p90 trims the flier out.
  const his = [...rep(60_000, 11), 100_000];
  const r = robustBand([], his);
  assert.equal(r.rawBandHi, 100_000, 'the raw max still records the flier (for audit)');
  assert.ok(r.bandHi < 100_000, 'the robust edge is below the flier');
  assert.ok(r.bandHi <= 61_000, `p90 sits in the cluster, not at the flier (got ${r.bandHi})`);
});

ok('dense low side: a lone low flier no longer sets bandLo (p10, not the min)', () => {
  const los = [30_000, ...rep(59_000, 11)];   // one 30k flier below a 59k cluster
  const r = robustBand(los, []);
  assert.equal(r.rawBandLo, 30_000);
  assert.ok(r.bandLo > 30_000 && r.bandLo >= 58_000, `p10 sits in the cluster (got ${r.bandLo})`);
});

/* --- 2. a SPARSE side keeps the extremum (don't discard the one real high) ---------------------------- */
ok('sparse side (< min sample): the raw extremum is kept — the thin big-ticket case', () => {
  const his = [50_000_000, 51_000_000, 52_000_000];   // 3 prints — a thin big ticket
  assert.ok(his.length < BAND_EDGE_MIN_SAMPLE, 'precondition: below the dense threshold');
  const r = robustBand([50_000_000], his);
  assert.equal(r.bandHi, 52_000_000, 'the one real high survives (== raw max), not quantiled away');
  assert.equal(r.rawBandHi, 52_000_000);
});

ok('exactly at the sample threshold engages the quantile', () => {
  const his = [...rep(1000, BAND_EDGE_MIN_SAMPLE - 1), 5000];   // N prints, one flier
  const r = robustBand([], his);
  assert.ok(r.bandHi < 5000, `at ${BAND_EDGE_MIN_SAMPLE} prints the quantile engages (got ${r.bandHi})`);
});

/* --- 3. no flier ⇒ robust ≈ the real edge (no distortion of a clean band) ----------------------------- */
ok('a clean dense band: p90/p10 sit at the true edges (no artifact to trim)', () => {
  const his = rep(60_000, 12), los = rep(58_000, 12);   // flat clean band
  const r = robustBand(los, his);
  assert.equal(r.bandHi, 60_000, 'a flat side quantiles to itself');
  assert.equal(r.bandLo, 58_000);
});

/* --- 4. degenerate inputs ---------------------------------------------------------------------------- */
ok('empty / all-null side ⇒ null edge (no throw)', () => {
  const r = robustBand([], [null, 0, undefined]);
  assert.equal(r.bandLo, null);
  assert.equal(r.bandHi, null);
  assert.equal(r.rawBandHi, null);
});

ok('single print ⇒ that print is the edge (raw == robust)', () => {
  const r = robustBand([42], [99]);
  assert.deepEqual([r.bandLo, r.bandHi, r.rawBandLo, r.rawBandHi], [42, 99, 42, 99]);
});

/* --- 5. quantile constants are the placeholders the doctrine names ------------------------------------ */
ok('constants are the named Bar-E placeholders', () => {
  assert.equal(BAND_EDGE_HI_Q, 0.90);
  assert.equal(BAND_EDGE_LO_Q, 0.10);
  assert.ok(BAND_EDGE_MIN_SAMPLE >= 2, 'min sample is a real density bar');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
