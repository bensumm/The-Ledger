#!/usr/bin/env node
/**
 * range-position.test.mjs — acceptance fixtures for YF1's PURE classification core `deriveState`
 * (lib/range-position.mjs). deriveState composes the shipped quotecore classifiers over a
 * reconstructed past band + 6h series; it is DOM/network-free, so it is fixture-testable with
 * synthetic values — no live data (CLAUDE.md rule 4).
 * Run: `node pipeline/test/range-position.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - bandPct is the price's percentile within [bandLo,bandHi], clamped 0..100, null when the band
 *     is degenerate or no price is given.
 *   - regime is the flat/rising/falling label off regimeDrift of the 6h series (unknown when too
 *     few points) — it never invents a direction.
 *   - phase is the shipped phase() enum; a clearly-elevated recent-peak series reads 'spike'.
 *   - reconstructed is FALSE (and fields null/unknown) when neither a covered band NOR a usable
 *     6h series exists — an unrecoverable fill is never given a fabricated state.
 */
import assert from 'node:assert/strict';
import { deriveState } from '../lib/range-position.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const H6 = 6 * 3600;
// build a 17-day 6h series ending at tEnd, with a prior-window mid and a recent-window mid so
// regimeDrift has ≥8 points each side (3d recent = 12 pts, 3–17d prior = 56 pts).
function series({ tEnd = 1_783_000_000, priorMid = 100, recentMid = 100, spread = 4 } = {}) {
  const pts = [];
  const n = Math.ceil(17 * 24 / 6);                 // 68 points
  for (let i = n - 1; i >= 0; i--) {
    const ts = tEnd - i * H6;
    const recent = ts >= tEnd - 3 * 86400;
    const mid = recent ? recentMid : priorMid;
    pts.push({ avgLowPrice: mid - spread, avgHighPrice: mid + spread, timestamp: ts });
  }
  return pts;
}

console.log('YF1 deriveState acceptance:');

// --- 1. bandPct within the band, clamped ---------------------------------------------------
ok('bandPct is the clamped percentile within [bandLo,bandHi], null when degenerate', () => {
  const band = { bandLo: 100, bandHi: 200, covered: 24, nWin: 24 };
  assert.equal(deriveState({ band, series6h: [], price: 150 }).bandPct, 50);
  assert.equal(deriveState({ band, series6h: [], price: 100 }).bandPct, 0);
  assert.equal(deriveState({ band, series6h: [], price: 250 }).bandPct, 100, 'above band → clamped to 100');
  assert.equal(deriveState({ band, series6h: [], price: 50 }).bandPct, 0, 'below band → clamped to 0');
  assert.equal(deriveState({ band, series6h: [], price: null }).bandPct, null, 'no price → null');
  assert.equal(deriveState({ band: { bandLo: 100, bandHi: 100, covered: 1 }, series6h: [], price: 100 }).bandPct, null, 'degenerate band → null');
});

// --- 2. regime label off the 6h series ----------------------------------------------------
ok('regime reads rising / falling / flat off regimeDrift, unknown when too few points', () => {
  assert.equal(deriveState({ series6h: series({ priorMid: 100, recentMid: 130 }) }).regime, 'rising');
  assert.equal(deriveState({ series6h: series({ priorMid: 100, recentMid: 70 }) }).regime, 'falling');
  assert.equal(deriveState({ series6h: series({ priorMid: 100, recentMid: 100 }) }).regime, 'flat');
  assert.equal(deriveState({ series6h: [] }).regime, 'unknown', 'empty series → unknown, never a fabricated direction');
});

// --- 3. phase enum; a spike reads 'spike' -------------------------------------------------
ok('phase is the shipped enum; an elevated recent-peak series reads spike', () => {
  const st = deriveState({ series6h: series({ priorMid: 100, recentMid: 140 }) });
  assert.ok(['base', 'spike', 'decay', 'basing', 'unknown'].includes(st.phase), 'phase is a known label');
  assert.equal(st.phase, 'spike', 'recent level well above base with a recent peak → spike');
  assert.equal(deriveState({ series6h: [] }).phase, 'unknown');
});

// --- 4. reconstructed honesty --------------------------------------------------------------
ok('reconstructed is false with nulled fields when nothing is recoverable', () => {
  const none = deriveState({ band: null, series6h: [], price: 123 });
  assert.equal(none.reconstructed, false);
  assert.equal(none.bandLo, null);
  assert.equal(none.bandPct, null);
  assert.equal(none.regime, 'unknown');
  assert.equal(none.phase, 'unknown');
  // a covered band alone is enough to count as reconstructed
  const bandOnly = deriveState({ band: { bandLo: 100, bandHi: 200, covered: 12, nWin: 24 }, series6h: [], price: 150 });
  assert.equal(bandOnly.reconstructed, true, 'a covered band counts as reconstructed even with no 6h series');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
