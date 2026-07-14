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
  nominateDip, selectNominations, pruneDipPool, reconcileDipPool,
  DL4_WIDE_BAND_PCT, DL4_WIDE_DAY_PCT, DL4_MAX_NOMINATIONS_PER_SCAN, DL4_MIN_GP_FLOW, DL4_MIN_ABS_SWING,
  DL4_POOL_MAX_AGE_DAYS, DL4_POOL_CAP_LIQUID, DL4_POOL_CAP_ILLIQUID, DIP_LOOP_LIQUID_FLOOR,
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
  // band amplitude = (1060-1000)/1000 = 6% ≥ DL4_WIDE_BAND_PCT; swing 60 ≥ DL4_MIN_ABS_SWING; limitVol ≥ floor.
  // PLAN-VOL24: limitVol 5000→50000 — clears BOTH the recalibrated DIP_LOOP_LIQUID_FLOOR (40000 → liquid
  // track) and DL4_MIN_GP_FLOW (mid 1030 × 50000 = 51.5m ≥ 9m).
  const n = nominateDip(v24(1000, 1060, 50000, 50000), band(1000, 1060));
  assert.ok(n, 'nominates');
  assert.equal(n.track, 'liquid');
  assert.equal(n.twoSided, true);
  assert.ok(n.amplitude >= DL4_WIDE_BAND_PCT);
  assert.ok(n.swingGp >= DL4_MIN_ABS_SWING);
  assert.equal(n.limitVol, 50000);
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
  // PLAN-VOL24: vol 5000→50000 (≥ the recalibrated DIP_LOOP_LIQUID_FLOOR 40000 → liquid track; gp-flow ≫ 9m).
  const n = nominateDip(v24(1000, 1200, 50000, 50000), band(1000, 1200, true, false));
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
  // 24h range is huge (50%) but band is tight (4%) — nomination amplitude must be the band's 4%. Priced at
  // 10k so the 4% band swing (400gp) clears DL4_MIN_ABS_SWING (this test isolates amplitude source, not the floor).
  const n = nominateDip(v24(10000, 15000, 5000, 5000), band(10000, 10400));
  assert.ok(n);
  assert.ok(Math.abs(n.amplitude - 0.04) < 1e-9, 'amplitude is the band amplitude (4%), not the 24h 50%');
});

// --- 6. score ranks higher-amplitude / higher-vol higher ---------------------------------------
ok('nominateDip: score rises with amplitude and with volume', () => {
  // priced at 10k so both band swings (350gp / 1000gp) clear DL4_MIN_ABS_SWING — isolates the score comparison.
  const lowAmp = nominateDip(v24(10000, 10350, 5000, 5000), band(10000, 10350));   // 3.5%
  const hiAmp  = nominateDip(v24(10000, 11000, 5000, 5000), band(10000, 11000));   // 10%
  assert.ok(hiAmp.score > lowAmp.score, 'more amplitude → higher score');
  // prices kept high enough that both clear the value floor (mid ~10.5k × 1000 ≈ 10.5m gp-flow ≥ the
  // recalibrated 9m DL4_MIN_GP_FLOW) so the comparison isolates volume, not the floor. (PLAN-VOL24: lowVol 100→1000.)
  const lowVol = nominateDip(v24(10000, 11000, 1000, 1000), band(10000, 11000));
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
// --- 6c. PER-UNIT SWING FLOOR: cheap high-throughput churn is now EXCLUDED (2026-07-12 doctrine change) --
ok('nominateDip: cheap-but-high-volume churn (rune-like) → null (swing too small for a flush)', () => {
  // ~190→205gp rune: 7.9% band ≥ wide AND 394m gp-flow ≫ the SCALE floor — but its per-unit swing is only
  // 15gp (< DL4_MIN_ABS_SWING), so a flush is worth ~15gp/unit — not a bid-into-the-fall play. This is the
  // penny-junk fix: SUPERSEDES the old "cheap high-volume churn still passes" property. Cheap churn is the
  // CHURN niche's job (buy-the-dip on its normal band); the flush pool wants meaningful per-unit swings.
  const n = nominateDip(v24(190, 210, 2_000_000, 2_000_000), band(190, 205));
  assert.equal(n, null, 'trivial per-unit swing excluded even at huge gp-flow');
});
// --- 6c2. PER-UNIT SWING FLOOR: a meaningful mid-ticket swing PASSES even at modest volume --------------
ok('nominateDip: mid-ticket with a real per-unit swing → nominates', () => {
  // 8000→8400gp item: 5% band, swing 400gp ≥ DL4_MIN_ABS_SWING; mid 8200 × 1200 = 9.84m gp-flow ≥ the
  // recalibrated 9m floor (PLAN-VOL24: vol 200→1200 — still modest units, a real per-unit swing passing).
  const n = nominateDip(v24(8000, 8400, 1200, 1200), band(8000, 8400));
  assert.ok(n, 'a meaningful per-unit swing passes');
  assert.ok(n.swingGp >= DL4_MIN_ABS_SWING);
});
// --- 6c3. PER-UNIT SWING FLOOR boundary: just under → null, at/over → nominates -------------------------
ok('nominateDip: abs-swing boundary around DL4_MIN_ABS_SWING', () => {
  // hold gp-flow well over the scale floor (huge volume) so ONLY the swing floor is exercised. amplitude
  // kept ≥ wide by construction (both bands are ≥ 3% of their low).
  const lo = DL4_MIN_ABS_SWING - 2, hi = DL4_MIN_ABS_SWING + 2;
  const under = nominateDip(v24(1000, 1000 + lo, 1_000_000, 1_000_000), band(1000, 1000 + lo));
  const over  = nominateDip(v24(1000, 1000 + hi, 1_000_000, 1_000_000), band(1000, 1000 + hi));
  // (1000 + ~50)/1000 ≈ 5% ≥ wide, so amplitude is not the binding gate here — the swing floor is.
  assert.equal(under, null, 'per-unit swing just under the floor → null');
  assert.ok(over, 'per-unit swing at/over the floor → nominates');
});
// --- 6d. VALUE FLOOR boundary: just under → null, at/over → nominates ---------------------------
ok('nominateDip: value-floor boundary (mid×limitVol around DL4_MIN_GP_FLOW)', () => {
  // amplitude fixed wide (10% band); vary limitVol so mid×limitVol straddles the floor. mid=1000.
  // PLAN-VOL24: DL4_MIN_GP_FLOW recalibrated 500k→9m, so straddle 9m (limitVol 8900 vs 9100).
  const under = nominateDip(v24(950, 1050, 8900, 8900), band(950, 1050));   // mid 1000 × 8900 = 8.9m < 9m
  assert.equal(under, null, 'just under the value floor → null');
  const over = nominateDip(v24(950, 1050, 9100, 9100), band(950, 1050));    // mid 1000 × 9100 = 9.1m ≥ 9m
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

// --- 9. POOL HYGIENE: pruneDipPool ages by last-qualification + caps top-N BY SCORE per track ------------
const DAY = 86400000;
ok('pruneDipPool: ages out AUTO entries whose lastQualTs is past DL4_POOL_MAX_AGE_DAYS', () => {
  const now = 1_000 * DAY;
  const pool = [
    { id: 1, name: 'fresh', source: 'auto', track: 'liquid', addedTs: now - 99 * DAY, lastQualTs: now - 1 * DAY, score: 5 }, // kept (recently qualified)
    { id: 2, name: 'stale', source: 'auto', track: 'liquid', addedTs: now - 1 * DAY, lastQualTs: now - (DL4_POOL_MAX_AGE_DAYS + 1) * DAY, score: 9 }, // aged out despite high score
  ];
  const kept = pruneDipPool(pool, { now });
  assert.deepEqual(kept.map(e => e.id), [1], 'aging is by lastQualTs, not addedTs or score');
});
ok('pruneDipPool: caps each TRACK to top-N BY SCORE (not by recency)', () => {
  const now = 1_000 * DAY;
  // 3 liquid with a tiny cap of 2 → the two HIGHEST scores survive regardless of addedTs order.
  const pool = [
    { id: 1, name: 'lo',  source: 'auto', track: 'liquid', addedTs: now, lastQualTs: now, score: 1 },
    { id: 2, name: 'hi',  source: 'auto', track: 'liquid', addedTs: now, lastQualTs: now, score: 9 },
    { id: 3, name: 'mid', source: 'auto', track: 'liquid', addedTs: now, lastQualTs: now, score: 5 },
  ];
  const kept = pruneDipPool(pool, { now, capLiquid: 2, capIlliquid: 45 });
  assert.deepEqual(kept.map(e => e.id), [2, 3], 'top-2 by score kept (hi, mid); lowest evicted');
});
ok('pruneDipPool: liquid + illiquid capped INDEPENDENTLY', () => {
  const now = 1_000 * DAY;
  const mk = (id, track, score) => ({ id, name: 't' + id, source: 'auto', track, addedTs: now, lastQualTs: now, score });
  const pool = [mk(1, 'liquid', 3), mk(2, 'liquid', 1), mk(3, 'illiquid', 3), mk(4, 'illiquid', 2), mk(5, 'illiquid', 1)];
  const kept = pruneDipPool(pool, { now, capLiquid: 1, capIlliquid: 2 });
  assert.deepEqual(kept.map(e => e.id), [1, 3, 4], 'liquid top-1 + illiquid top-2, tracks independent');
});
ok('pruneDipPool: manual + legacy entries are NEVER aged or capped', () => {
  const now = 1_000 * DAY;
  const pool = [
    'Searing page',                                                                                          // legacy string
    28931,                                                                                                   // legacy number
    { id: 3, name: 'curated', source: 'manual', track: 'liquid', addedTs: now - 999 * DAY, lastQualTs: now - 999 * DAY }, // ancient manual
    { id: 4, name: 'stale-auto', source: 'auto', track: 'liquid', addedTs: now - 999 * DAY, lastQualTs: now - 999 * DAY, score: 9 }, // aged out
  ];
  const kept = pruneDipPool(pool, { now, capLiquid: 0, capIlliquid: 0 });   // cap 0 → drop ALL auto, keep all manual/legacy
  assert.deepEqual(kept, ['Searing page', 28931, pool[2]], 'manual/legacy survive age + cap:0; auto dropped');
});
ok('reconcileDipPool: re-qualifier re-scored + kept fresh; non-qualifier ages; new qualifier inserted', () => {
  const now = 1_000 * DAY;
  const oldTs = now - (DL4_POOL_MAX_AGE_DAYS + 1) * DAY;   // already past the age cutoff
  const existing = [
    { id: 10, name: 'requal', source: 'auto', track: 'liquid', addedTs: oldTs, lastQualTs: oldTs, score: 2 }, // qualifies again → refreshed
    { id: 11, name: 'gone',   source: 'auto', track: 'liquid', addedTs: oldTs, lastQualTs: oldTs, score: 9 }, // not in this scan → ages out
  ];
  const qualifiers = [
    { id: 10, name: 'requal', track: 'liquid', score: 7 },   // re-scored higher
    { id: 12, name: 'new',    track: 'liquid', score: 4 },   // brand new
  ];
  const next = reconcileDipPool(existing, qualifiers, { now });
  const ids = next.map(e => e.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [10, 12], 're-qualifier + new survive; stale non-qualifier aged out');
  const requal = next.find(e => e.id === 10);
  assert.equal(requal.lastQualTs, now, 're-qualifier lastQualTs refreshed');
  assert.equal(requal.score, 7, 're-qualifier re-scored to the fresh value');
  assert.equal(requal.addedTs, oldTs, 'addedTs preserved (first-seen time)');
});

console.log(`\nAll ${pass} acceptance checks passed. (DL4_WIDE_BAND_PCT=${DL4_WIDE_BAND_PCT}, DL4_WIDE_DAY_PCT=${DL4_WIDE_DAY_PCT}, DL4_MIN_GP_FLOW=${DL4_MIN_GP_FLOW}, DL4_MIN_ABS_SWING=${DL4_MIN_ABS_SWING}, cap/scan=${DL4_MAX_NOMINATIONS_PER_SCAN}, pool cap liquid=${DL4_POOL_CAP_LIQUID}/illiquid=${DL4_POOL_CAP_ILLIQUID}, age=${DL4_POOL_MAX_AGE_DAYS}d — placeholders, n=2)`);
