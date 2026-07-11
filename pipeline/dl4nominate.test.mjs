#!/usr/bin/env node
/**
 * dl4nominate.test.mjs — acceptance fixtures for DL4 (the "B feeds A" scan→dip-loop discovery half):
 *   - nominateDip (js/quotecore.js) — the pure flush-SUITABILITY read off zero-fetch gate-tier data.
 *   - selectNominations (js/quotecore.js) — the pure dedup + cap over the current dip-watchlist.
 *   - the polymorphic dip-watchlist reader logic (legacy string/number OR new object entries).
 *
 * Lives in pipeline/ next to diploop.test.mjs / dipposture.test.mjs (the convention for js/-module tests;
 * run-tests.mjs auto-discovers it). Everything is PURE over synthetic fixtures, no live data (rule 4).
 * Run: `node pipeline/dl4nominate.test.mjs` (exits non-zero on any failure).
 *
 * HONESTY: every DL4 threshold under test is a NAMED PLACEHOLDER (n=2). These fixtures pin the SHAPE of
 * the nomination (two-sided + wide-enough + liquid → liquid track; thinner → illiquid track; one-sided
 * or narrow → null) and the dedup/cap invariants — NOT that the thresholds are calibrated. A nomination
 * is a PROPOSAL TO WATCH, never a validated pick.
 */
import assert from 'node:assert/strict';
import {
  nominateDip, selectNominations,
  DL4_WIDE_BAND_PCT, DL4_WIDE_DAY_PCT, DL4_MAX_NOMINATIONS_PER_SCAN, DIP_LOOP_LIQUID_FLOOR,
} from '../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('DL4 nominateDip + selectNominations + polymorphic-reader acceptance:');

// --- fixture builders -------------------------------------------------------------------------
// v24 entry: { avgLowPrice, avgHighPrice, highPriceVolume, lowPriceVolume }
const v24 = (lo, hi, hpv, lpv) => ({ avgLowPrice: lo, avgHighPrice: hi, highPriceVolume: hpv, lowPriceVolume: lpv });
// band entry: { bandLo, bandHi, sawLow, sawHigh, tradedWin }
const band = (lo, hi, sawLow = true, sawHigh = true) => ({ bandLo: lo, bandHi: hi, sawLow, sawHigh, tradedWin: 10 });

// --- 1. FIRES liquid track: wide band + limitVol ≥ floor + two-sided ---------------------------
ok('nominateDip: wide band + liquid two-sided → track:liquid', () => {
  // band amplitude = (1050-1000)/1000 = 5% ≥ DL4_WIDE_BAND_PCT; limitVol = min(5000,5000) ≥ floor.
  const n = nominateDip(v24(1000, 1050, 5000, 5000), band(1000, 1050));
  assert.ok(n, 'nominates');
  assert.equal(n.track, 'liquid');
  assert.equal(n.twoSided, true);
  assert.ok(n.amplitude >= DL4_WIDE_BAND_PCT);
  assert.equal(n.limitVol, 5000);
  assert.ok(n.score > 0);
});

// --- 2. FIRES illiquid track: wide 24h range + two-sided + limitVol < floor --------------------
ok('nominateDip: wide 24h range + two-sided + thin → track:illiquid (no band)', () => {
  // no band → 24h amplitude = (1100-1000)/1000 = 10% ≥ DL4_WIDE_DAY_PCT; limitVol = min(50,40)=40 < floor.
  const n = nominateDip(v24(1000, 1100, 50, 40), null);
  assert.ok(n, 'nominates');
  assert.equal(n.track, 'illiquid');
  assert.ok(n.limitVol < DIP_LOOP_LIQUID_FLOOR);
  assert.ok(n.amplitude >= DL4_WIDE_DAY_PCT);
});

// --- 3. REJECTS a one-sided ghost book (the non-negotiable guard) ------------------------------
ok('nominateDip: one-sided (lpv=0) → null even if wide', () => {
  // band sawHigh false AND lpv=0 → not two-sided → null regardless of amplitude.
  assert.equal(nominateDip(v24(1000, 1200, 5000, 0), band(1000, 1200, true, false)), null);
});
ok('nominateDip: one-sided (sawHigh false, hpv>0 lpv>0 saves it) → still nominates via volume path', () => {
  // band is one-sided but hpv>0 && lpv>0 satisfies the OR — two-sidedness can come from either source.
  const n = nominateDip(v24(1000, 1200, 5000, 5000), band(1000, 1200, true, false));
  assert.ok(n, 'volume two-sidedness carries it');
  assert.equal(n.track, 'liquid');
});

// --- 4. REJECTS a narrow / low-amplitude book --------------------------------------------------
ok('nominateDip: narrow band (< wide%) → null', () => {
  // band amplitude = (1010-1000)/1000 = 1% < DL4_WIDE_BAND_PCT.
  assert.equal(nominateDip(v24(1000, 1010, 5000, 5000), band(1000, 1010)), null);
});
ok('nominateDip: missing volume → null (degrade, never guess)', () => {
  assert.equal(nominateDip(v24(1000, 1100, null, 5000), band(1000, 1100)), null);
  assert.equal(nominateDip(null, band(1000, 1100)), null);
});

// --- 5. amplitude prefers band over 24h-range when band present --------------------------------
ok('nominateDip: amplitude reads the BAND when present, not the 24h range', () => {
  // 24h range is huge (50%) but band is tight (4%) — nomination amplitude must be the band's 4%.
  const n = nominateDip(v24(1000, 1500, 5000, 5000), band(1000, 1040));
  assert.ok(n);
  assert.ok(Math.abs(n.amplitude - 0.04) < 1e-9, 'amplitude is the band amplitude (4%), not the 24h 50%');
});

// --- 6. score ranks higher-amplitude / higher-vol higher ---------------------------------------
ok('nominateDip: score rises with amplitude and with volume', () => {
  const lowAmp = nominateDip(v24(1000, 1035, 5000, 5000), band(1000, 1035));   // 3.5%
  const hiAmp  = nominateDip(v24(1000, 1100, 5000, 5000), band(1000, 1100));   // 10%
  assert.ok(hiAmp.score > lowAmp.score, 'more amplitude → higher score');
  const lowVol = nominateDip(v24(1000, 1100, 100, 100), band(1000, 1100));
  const hiVol  = nominateDip(v24(1000, 1100, 50000, 50000), band(1000, 1100));
  assert.ok(hiVol.score > lowVol.score, 'more volume → higher score at equal amplitude');
});

// --- 7. selectNominations: dedup + cap + highest-score win --------------------------------------
ok('selectNominations: existing id never re-added; cap respected; highest-score win', () => {
  const existing = [{ id: 10, name: 'Held', source: 'manual', track: 'liquid', addedTs: 1 }];
  const cands = [
    { id: 10, name: 'Held', track: 'liquid', score: 9 },   // dup → dropped
    { id: 11, name: 'A', track: 'liquid', score: 5 },
    { id: 12, name: 'B', track: 'illiquid', score: 8 },
    { id: 13, name: 'C', track: 'liquid', score: 1 },
  ];
  const picks = selectNominations(existing, cands, 2);
  assert.equal(picks.length, 2, 'cap respected');
  assert.deepEqual(picks.map(p => p.id), [12, 11], 'highest scores first, dup excluded');
});
ok('selectNominations: legacy plain-array existing entries dedupe by name AND numeric id', () => {
  // legacy array mixes a plain name string and a numeric-id number.
  const existing = ['Searing page', 28931];
  const cands = [
    { id: 111, name: 'Searing page', track: 'liquid', score: 5 },   // name dup → dropped
    { id: 28931, name: 'Whatever', track: 'liquid', score: 6 },     // numeric-id dup → dropped
    { id: 222, name: 'Fresh', track: 'illiquid', score: 4 },
  ];
  const picks = selectNominations(existing, cands, DL4_MAX_NOMINATIONS_PER_SCAN);
  assert.deepEqual(picks.map(p => p.id), [222], 'both legacy forms dedupe; only the fresh one survives');
});
ok('selectNominations: empty candidates / cap 0 → empty (never throws)', () => {
  assert.deepEqual(selectNominations([], [], 5), []);
  assert.deepEqual(selectNominations(null, [{ id: 1, score: 1 }], 0), []);
});

// --- 8. polymorphic reader logic (watch.mjs --dip): a mixed array resolves all three forms ------
// Mirror the exact token-extraction the reader uses: object → id ?? name; else the entry itself.
const dipToken = entry => (entry && typeof entry === 'object') ? (entry.id ?? entry.name) : entry;
ok('polymorphic reader: mixed [string, number, object] all yield a resolvable token', () => {
  const mixed = ['Searing page', 28931, { id: 12695, name: 'Abyssal bludgeon', source: 'auto', track: 'illiquid', addedTs: 1 }];
  assert.equal(dipToken(mixed[0]), 'Searing page');
  assert.equal(dipToken(mixed[1]), 28931);
  assert.equal(dipToken(mixed[2]), 12695, 'object prefers id');
  // object with only a name (no id) falls back to name
  assert.equal(dipToken({ name: 'Onlyname' }), 'Onlyname');
});

console.log(`\nAll ${pass} acceptance checks passed. (DL4_WIDE_BAND_PCT=${DL4_WIDE_BAND_PCT}, DL4_WIDE_DAY_PCT=${DL4_WIDE_DAY_PCT}, cap=${DL4_MAX_NOMINATIONS_PER_SCAN} — placeholders, n=2)`);
