#!/usr/bin/env node
/**
 * freed-capital.test.mjs — the watch loop's freed-capital redeploy prompt (chunk V6 Companion).
 *
 * lib/freed-capital.mjs detects capital FREED by a booked SELL between two consecutive passes (a held
 * lot's qty dropped, read off V1's prior-pass state map) and, when it clears a threshold, tells the
 * loop to SURFACE a scan prompt. It is SURFACE-ONLY — it never auto-places and never runs the scan.
 * This pins the detection + the anti-misfire guards (first-seen / stale-gap / a growing lot).
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - A lot whose qty dropped since last pass frees unitsSold × (prior instabuy, else avg cost);
 *     ≥ threshold total → prompt true.
 *   - Below threshold → prompt false (no noise on a tiny incidental sell).
 *   - A fresh/empty prior (startup), a stale-gap prior (overnight pause), and a lot that GREW or is
 *     unchanged → NO event (no false positive).
 *
 * Synthetic fixtures only. Run: `node pipeline/freed-capital.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { freedCapital, FREED_CAPITAL_SCAN_GP } from './lib/freed-capital.mjs';
import { STALE_GAP_MS } from './lib/watchstate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_800_000_000_000, MIN = 60_000;
const NOW = T0 + 5 * MIN;   // a consecutive pass, well inside STALE_GAP_MS
// a prior-pass state entry for a held lot (as watchstate.advanceState would produce it)
const entry = (id, qty, avgCost, instabuy, ts = T0) =>
  ({ [`held:${id}`]: { ts, identity: `hld:${qty}:${avgCost}`, instabuy } });

/* --- a closed position frees capital ≥ threshold → prompt ------------------------------------ */
ok('a fully-sold lot frees unitsSold × prior instabuy and surfaces the prompt', () => {
  const prior = entry(100, 10, 1_000_000, 1_200_000);     // 10 units, prior clear price 1.2m
  const r = freedCapital(prior, [], { now: NOW });         // lot gone this pass
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].unitsSold, 10);
  assert.equal(r.totalFreed, 12_000_000);                  // 10 × 1.2m
  assert.equal(r.prompt, true);                            // ≥ 5m
});

ok('a partial sell frees only the sold units', () => {
  const prior = entry(100, 10, 1_000_000, 1_200_000);
  const r = freedCapital(prior, [{ id: 100, qty: 4, sellPrice: 1_250_000 }], { now: NOW }); // 6 sold
  assert.equal(r.events[0].unitsSold, 6);
  assert.equal(r.totalFreed, 7_200_000);                   // 6 × prior instabuy 1.2m
  assert.equal(r.prompt, true);
});

ok('falls back to avg cost when the prior entry has no instabuy', () => {
  const prior = { 'held:7': { ts: T0, identity: 'hld:5:2000000', instabuy: null } };
  const r = freedCapital(prior, [], { now: NOW });
  assert.equal(r.totalFreed, 10_000_000);                  // 5 × avg cost 2m
});

/* --- below threshold → silent ---------------------------------------------------------------- */
ok('a small freed value below the threshold does not prompt', () => {
  const prior = entry(200, 10, 100_000, 100_000);          // frees 1m
  const r = freedCapital(prior, [], { now: NOW });
  assert.equal(r.totalFreed, 1_000_000);
  assert.equal(r.prompt, false);
  assert.ok(FREED_CAPITAL_SCAN_GP > r.totalFreed);
});

/* --- anti-misfire guards --------------------------------------------------------------------- */
ok('a fresh/empty prior (startup) yields no events', () => {
  assert.deepEqual(freedCapital({}, [{ id: 1, qty: 5 }], { now: NOW }), { totalFreed: 0, events: [], prompt: false });
  assert.deepEqual(freedCapital(undefined, [], { now: NOW }), { totalFreed: 0, events: [], prompt: false });
});

ok('a stale-gap prior (overnight pause) is not a consecutive pass → no event', () => {
  const prior = entry(100, 10, 1_000_000, 1_200_000, T0);
  const staleNow = T0 + STALE_GAP_MS + 1;                  // beyond the consecutive-pass window
  const r = freedCapital(prior, [], { now: staleNow });
  assert.equal(r.events.length, 0);
  assert.equal(r.prompt, false);
});

ok('a lot that GREW or is unchanged frees nothing', () => {
  const prior = entry(100, 10, 1_000_000, 1_200_000);
  assert.equal(freedCapital(prior, [{ id: 100, qty: 10 }], { now: NOW }).totalFreed, 0); // unchanged
  assert.equal(freedCapital(prior, [{ id: 100, qty: 14 }], { now: NOW }).totalFreed, 0); // grew (a re-buy)
});

console.log(`\nAll ${pass} checks passed.`);
