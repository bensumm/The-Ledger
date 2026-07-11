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
 * the nomination (two-sided + wide-enough amplitude + over the DL4_MIN_GP_FLOW value floor + liquid →
 * liquid track; thinner → illiquid track; one-sided or narrow or penny-scale → null) and the dedup/cap
 * invariants — NOT that the thresholds are calibrated. A nomination is a PROPOSAL TO WATCH, never a
 * validated pick.
 */
import assert from 'node:assert/strict';
import {
  nominateDip, selectNominations,
  DL4_WIDE_BAND_PCT, DL4_WIDE_DAY_PCT, DL4_MAX_NOMINATIONS_PER_SCAN, DL4_MIN_GP_FLOW, DIP_LOOP_LIQUID_FLOOR,
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

// --- 2. FIRES illiquid track: wide 24h range + two-sided + limitVol < floor (thin BIG-TICKET) ---
ok('nominateDip: wide 24h range + two-sided + thin big-ticket → track:illiquid (no band)', () => {
  // no band → 24h amplitude = (1.1m-1.0m)/1.0m = 10% ≥ DL4_WIDE_DAY_PCT; limitVol = min(50,40)=40 < floor.
  // BIG-TICKET so it clears the value floor (mid ~1.05m × 40 ≈ 42m gp-flow) — the illiquid track is for
  // thin high-value books (Abyssal-bludgeon-like), not penny items.
  const n = nominateDip(v24(1_000_000, 1_100_000, 50, 40), null);
  assert.ok(n, 'nominates');
  assert.equal(n.track, 'illiquid');
  assert.ok(n.limitVol < DIP_LOOP_LIQUID_FLOOR);
  assert.ok(n.amplitude >= DL4_WIDE_DAY_PCT);
  assert.ok(n.gpFlow >= DL4_MIN_GP_FLOW);
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
  // prices kept high enough that both clear the value floor (mid ~10.5k × 100 ≈ 1.05m gp-flow) so the
  // comparison isolates volume, not the floor.
  const lowVol = nominateDip(v24(10000, 11000, 100, 100), band(10000, 11000));
  const hiVol  = nominateDip(v24(10000, 11000, 50000, 50000), band(10000, 11000));
  assert.ok(hiVol.score > lowVol.score, 'more volume → higher score at equal amplitude');
});

// --- 6b. VALUE FLOOR: a huge-% swing on a penny item is EXCLUDED (the Sweetcorn-seed leak) ------
ok('nominateDip: penny item (wide % but trivial gp-flow) → null', () => {
  // Sweetcorn-seed-like: ~7→14gp band (+100% amplitude!), ~3.9k/d volume. mid ~10.5 × 3900 ≈ 41k gp-flow,
  // three orders below the 500k attention scale → REJECTED despite the enormous % band.
  const n = nominateDip(v24(7, 14, 3900, 3900), band(7, 14));
  assert.equal(n, null, 'penny item excluded by the value floor');
});
// --- 6c. VALUE FLOOR is gp-SCALE, NOT unit-price: cheap high-throughput churn still INCLUDED ----
ok('nominateDip: cheap-but-high-volume churn (rune-like) → still nominates', () => {
  // ~190→205gp rune (7.9% band ≥ wide), ~2m/d volume. mid ~197 × 2m ≈ 394m gp-flow ≫ floor → nominates,
  // liquid track. Proves the floor keys on gp SCALE, not raw unit price.
  const n = nominateDip(v24(190, 210, 2_000_000, 2_000_000), band(190, 205));
  assert.ok(n, 'cheap high-volume churn passes the value floor');
  assert.equal(n.track, 'liquid');
  assert.ok(n.gpFlow >= DL4_MIN_GP_FLOW);
});
// --- 6d. VALUE FLOOR boundary: just under → null, at/over → nominates ---------------------------
ok('nominateDip: value-floor boundary (mid×limitVol around DL4_MIN_GP_FLOW)', () => {
  // amplitude fixed wide (10% band); vary limitVol so mid×limitVol straddles the floor. mid=1000.
  const under = nominateDip(v24(950, 1050, 400, 400), band(950, 1050));   // mid 1000 × 400 = 400k < 500k
  assert.equal(under, null, 'just under the value floor → null');
  const over = nominateDip(v24(950, 1050, 600, 600), band(950, 1050));    // mid 1000 × 600 = 600k ≥ 500k
  assert.ok(over, 'at/over the value floor → nominates');
  assert.ok(over.gpFlow >= DL4_MIN_GP_FLOW);
});
// NOTE on null buy-limit: option 2 (gp-flow = mid × limitVol) uses TRADED VOLUME, never the GE buy-limit,
// so the "null buy-limit" hazard of a guide×limit design simply does not arise here — there is no limit
// input to be null. That absence of a degenerate case is a deliberate reason this design was chosen.

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

console.log(`\nAll ${pass} acceptance checks passed. (DL4_WIDE_BAND_PCT=${DL4_WIDE_BAND_PCT}, DL4_WIDE_DAY_PCT=${DL4_WIDE_DAY_PCT}, DL4_MIN_GP_FLOW=${DL4_MIN_GP_FLOW}, cap=${DL4_MAX_NOMINATIONS_PER_SCAN} — placeholders, n=2)`);
