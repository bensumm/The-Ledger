#!/usr/bin/env node
/**
 * format.test.mjs — acceptance fixtures for the money primitives in js/format.js.
 *
 * js/format.js holds the shared tax/margin/parse helpers used by BOTH the browser and every
 * pipeline script; they had NO direct test. These are PURE (no DOM, no network), so they are
 * fixture-testable with synthetic values — no live data (CLAUDE.md rule 4).
 * Run: `node pipeline/format.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - GE tax is 0 for any sell under 50gp (the sub-50 exemption).
 *   - In the normal band, tax is floor(price × 2%) — floored, NEVER rounded.
 *   - Tax caps at a flat 5m no matter how large the sell (the cap BE1's break-even depends on).
 *   - netMargin is the after-tax sell minus the buy; it returns null (not a fabricated 0-margin)
 *     when either price is missing.
 *   - netMarginQty is the per-unit after-tax margin × qty, with the same null-on-missing guard.
 *   - parseGp honors k/m/b suffixes and commas, passes real numbers straight through, and
 *     returns NaN for garbage (never a silent 0).
 */
import assert from 'node:assert/strict';
import { tax, netMargin, netMarginQty, parseGp, TAXCAP } from '../js/format.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('format.js money-primitive acceptance:');

// --- 1. tax exemption under 50gp ----------------------------------------------------------
ok('tax is 0 for any sell under 50gp (GE exemption)', () => {
  assert.equal(tax(0), 0);
  assert.equal(tax(49), 0);
  assert.equal(tax(50), Math.floor(50 * 0.02)); // 50 is the first taxed price (=1)
  assert.equal(tax(null), 0);
  assert.equal(tax(undefined), 0);
});

// --- 2. tax is floor(price × 2%), never rounded -------------------------------------------
ok('tax is floor(price × 2%) in the normal band (floor, not round)', () => {
  assert.equal(tax(100), 2);
  assert.equal(tax(149), 2);           // 149×0.02 = 2.98 → floors to 2, NOT rounds to 3
  assert.equal(tax(1000), 20);
  assert.equal(tax(12_345), Math.floor(12_345 * 0.02)); // 246
});

// --- 3. tax caps at a flat 5m -------------------------------------------------------------
ok('tax caps at 5m regardless of sell size (the cap BE1 depends on)', () => {
  assert.equal(TAXCAP, 5_000_000);
  // cap binds once floor(p×0.02) ≥ 5m, i.e. p ≥ 250m.
  assert.equal(tax(249_999_950), Math.floor(249_999_950 * 0.02)); // 4,999,999 — just under the cap
  assert.equal(tax(250_000_000), TAXCAP);                          // exactly at the cap
  assert.equal(tax(1_000_000_000), TAXCAP);                        // deep in the cap
  assert.equal(tax(5_000_000_000), TAXCAP);
});

// --- 4. netMargin: after-tax sell − buy, null on a missing price --------------------------
ok('netMargin is after-tax sell minus buy, null when a price is missing', () => {
  // buy 100, sell 200: tax(200)=4 → (200-4)-100 = 96
  assert.equal(netMargin(100, 200), 96);
  assert.equal(netMargin(null, 200), null, 'missing buy → null, not a fabricated margin');
  assert.equal(netMargin(100, null), null, 'missing sell → null');
  assert.equal(netMargin(0, 200), null, 'a 0/falsy price is treated as missing (null)');
});

// --- 5. netMarginQty: per-unit after-tax margin × qty, same null guard --------------------
ok('netMarginQty is per-unit after-tax margin × qty, null on a missing price', () => {
  assert.equal(netMarginQty(100, 200, 10), 960);   // 96/unit × 10
  assert.equal(netMarginQty(100, 200, 1), 96);
  assert.equal(netMarginQty(null, 200, 10), null, 'missing price → null, never 0×qty');
  assert.equal(netMarginQty(100, null, 10), null);
});

// --- 6. parseGp: suffixes/commas, number passthrough, garbage → NaN -----------------------
ok('parseGp honors k/m/b + commas, passes numbers through, garbage → NaN', () => {
  assert.equal(parseGp('50'), 50);
  assert.equal(parseGp('1k'), 1_000);
  assert.equal(parseGp('2.5m'), 2_500_000);
  assert.equal(parseGp('1.5b'), 1_500_000_000);
  assert.equal(parseGp('1,234,567'), 1_234_567, 'commas stripped');
  assert.equal(parseGp('12 345'), 12_345, 'spaces stripped');
  assert.equal(parseGp(4200), 4200, 'a real number passes straight through');
  assert.ok(Number.isNaN(parseGp('abc')), 'garbage → NaN, never a silent 0');
  assert.ok(Number.isNaN(parseGp('')), 'empty → NaN');
  assert.ok(Number.isNaN(parseGp(null)), 'null → NaN');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
