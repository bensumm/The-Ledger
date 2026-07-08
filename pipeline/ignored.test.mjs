#!/usr/bin/env node
/**
 * ignored.test.mjs — the MERCH-book quarantine (pipeline/lib/ignored.mjs).
 *
 * BUSINESS REQUIREMENTS:
 *   - An item in ignored-items.json `items` is QUARANTINED from the merch derivation by default:
 *     quarantineEvents drops its events from the reconstruct() input; fills.json (not touched here)
 *     keeps the full audit.
 *   - A NON-ignored item's events are ALWAYS kept (byte-identical passthrough).
 *   - A greenlisted flip is surfaced as a real merch trade: an ignored-item event matching a
 *     `greenlisted` entry on id + price(±3%) + ts(±6h) is KEPT.
 *   - Match tolerance is exactly price ±3% and ts ±6h; a `consumed:true` entry never matches.
 *   - offerQuarantined drops a resting offer on an ignored item unless its price matches a live
 *     greenlist entry (no ts check — the offer is current).
 *
 * Synthetic fixtures only. Run: `node pipeline/ignored.test.mjs`.
 */
import assert from 'node:assert/strict';
import { quarantineEvents, greenlistMatch, offerQuarantined, PRICE_TOL, TS_TOL } from './lib/ignored.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const SNAP = 5300, NEST = 6693, T0 = 1_783_000_000;
const ev = (itemId, price, ts = T0) => ({ itemId, price, ts, type: 'buy', filled: 10 });
const cfg = (greenlisted = []) => ({ ids: new Set([SNAP]), greenlisted });

ok('non-ignored items pass through untouched', () => {
  const events = [ev(NEST, 4700), ev(NEST, 4720), ev(SNAP, 49846)];
  const kept = quarantineEvents(events, cfg());
  assert.deepEqual(kept.map(e => e.itemId), [NEST, NEST]);   // both nests kept, snapdragon dropped
});

ok('an ignored item with NO greenlist is fully quarantined (farming default)', () => {
  const events = [ev(SNAP, 49846), ev(SNAP, 50710), ev(SNAP, 888)];
  assert.equal(quarantineEvents(events, cfg()).length, 0);
});

ok('empty/absent config = no quarantine (safe degrade)', () => {
  const events = [ev(SNAP, 49846), ev(NEST, 4700)];
  assert.equal(quarantineEvents(events, { ids: new Set(), greenlisted: [] }).length, 2);
});

ok('a greenlisted flip is KEPT (id + price within ±3% + ts within ±6h)', () => {
  const gl = [{ id: SNAP, qty: 30, price: 49846, ts: T0, consumed: false }];
  const events = [
    ev(SNAP, 49846, T0),            // exact → kept
    ev(SNAP, 50000, T0 + 3600),     // +0.3% price, +1h → within tol → kept
    ev(SNAP, 55000, T0),            // +10% price → outside → dropped (a farm buy at a different price)
    ev(SNAP, 49846, T0 + 8 * 3600), // +8h → outside ts window → dropped
    ev(NEST, 4700, T0),             // non-ignored → kept
  ];
  const kept = quarantineEvents(events, cfg(gl));
  assert.deepEqual(kept.map(e => `${e.itemId}@${e.price}`), ['5300@49846', '5300@50000', '6693@4700']);
});

ok('a consumed greenlist entry never re-matches', () => {
  const gl = [{ id: SNAP, qty: 30, price: 49846, ts: T0, consumed: true }];
  assert.equal(greenlistMatch(cfg(gl), SNAP, 49846, T0), null);
  assert.equal(quarantineEvents([ev(SNAP, 49846, T0)], cfg(gl)).length, 0);
});

ok('tolerance boundaries: price ±3% and ts ±6h are the exact edges', () => {
  const gl = [{ id: SNAP, qty: 1, price: 1000, ts: T0, consumed: false }];
  const c = cfg(gl);
  assert.ok(greenlistMatch(c, SNAP, 1000 * (1 + PRICE_TOL), T0));       // +3% → in
  assert.equal(greenlistMatch(c, SNAP, 1000 * (1 + PRICE_TOL) + 1, T0), null); // just over → out
  assert.ok(greenlistMatch(c, SNAP, 1000, T0 + TS_TOL));               // +6h → in
  assert.equal(greenlistMatch(c, SNAP, 1000, T0 + TS_TOL + 1), null);  // just over → out
});

ok('offerQuarantined: ignored offer dropped unless price matches a live greenlist entry', () => {
  assert.equal(offerQuarantined(cfg(), SNAP, 49846), true);           // ignored, no greenlist → drop
  assert.equal(offerQuarantined(cfg(), NEST, 4700), false);           // not ignored → keep
  const gl = [{ id: SNAP, qty: 30, price: 49846, consumed: false }];
  assert.equal(offerQuarantined(cfg(gl), SNAP, 49846), false);        // greenlisted price → keep
  assert.equal(offerQuarantined(cfg(gl), SNAP, 55000), true);         // ignored, off-greenlist price → drop
});

console.log(`\nAll ${pass} checks passed.`);
