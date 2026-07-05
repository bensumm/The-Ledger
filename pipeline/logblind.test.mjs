#!/usr/bin/env node
/**
 * logblind.test.mjs — acceptance fixtures for LH2's restart-blindness header line.
 *
 * blindWarningLine() (pipeline/lib/logblind.mjs) is the PURE header-line assembler for the
 * monitor.mjs / watch.mjs "log may be blind" warning. Per plan LH2.3 the pure line assembly is
 * tested here; the filesystem probe (reading staleMin / active offers / positions) is NOT — the
 * callers already own that data and pass it in.
 * Run: `node pipeline/logblind.test.mjs` (auto-discovered by run-tests.mjs).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - The warning fires ONLY when all three hold: the log is stale (age ≥ threshold), there are
 *     ZERO active offers, and there is held inventory (openLotCount > 0) — the post-restart blind
 *     state. Any one condition failing → null (no false alarm).
 *   - A fresh log, a log still showing offers, or a desk with no positions each suppress it.
 *   - The threshold is overridable but defaults to BLIND_STALE_MIN.
 */
import assert from 'node:assert/strict';
import { blindWarningLine, BLIND_STALE_MIN } from './lib/logblind.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('LH2 restart-blindness header line:');

// --- 1. all three conditions met → fires -----------------------------------------------------
ok('stale log + no active offers + held inventory → warning fires', () => {
  const line = blindWarningLine({ staleMin: 45, activeOfferCount: 0, openLotCount: 3 });
  assert.ok(line, 'a warning string is returned');
  assert.match(line, /log may be blind/);
  assert.match(line, /45m/, 'names the actual staleness');
  assert.match(line, /3 open lot/, 'names the held-lot count');
});

// --- 2. fresh log suppresses it --------------------------------------------------------------
ok('a fresh log (below the threshold) → no warning even with held inventory', () => {
  assert.equal(blindWarningLine({ staleMin: 5, activeOfferCount: 0, openLotCount: 3 }), null);
  assert.equal(blindWarningLine({ staleMin: BLIND_STALE_MIN - 1, activeOfferCount: 0, openLotCount: 1 }), null);
  // exactly at the threshold, it DOES fire (>= boundary)
  assert.ok(blindWarningLine({ staleMin: BLIND_STALE_MIN, activeOfferCount: 0, openLotCount: 1 }));
});

// --- 3. the log still showing offers suppresses it -------------------------------------------
ok('active offers visible → not blind, no warning', () => {
  assert.equal(blindWarningLine({ staleMin: 90, activeOfferCount: 2, openLotCount: 4 }), null);
});

// --- 4. no held inventory suppresses it (the documented inventory-based gate) -----------------
ok('no held inventory → no warning (avoids false alarm on an idle desk)', () => {
  assert.equal(blindWarningLine({ staleMin: 90, activeOfferCount: 0, openLotCount: 0 }), null);
});

// --- 5. threshold override -------------------------------------------------------------------
ok('a custom thresholdMin is honored', () => {
  assert.equal(blindWarningLine({ staleMin: 30, activeOfferCount: 0, openLotCount: 1, thresholdMin: 60 }), null);
  assert.ok(blindWarningLine({ staleMin: 70, activeOfferCount: 0, openLotCount: 1, thresholdMin: 60 }));
});

console.log(`\nAll ${pass} acceptance checks passed.`);
