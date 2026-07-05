#!/usr/bin/env node
/**
 * gatecandidates.test.mjs — acceptance fixtures for screen.mjs's candidate gate stack (GC1).
 *
 * GC1 extracted screen.mjs's pre-fetch gating into the exported, threshold-driven gateCandidates()
 * (behind screen.mjs's import.meta.url invocation guard, so importing it fires NO screen/network).
 * The gate LOGIC is byte-identical to before — GC1 only replaced the closed-over module-level CLI
 * constants with a `thresholds` argument so fixtures can drive the whole stack with synthetic 24h /
 * band data (no live API). No live data (CLAUDE.md rule 4).
 * Run: `node pipeline/gatecandidates.test.mjs`  (exits non-zero on any failure).
 *
 * WHAT gateCandidates OWNS (and this file pins) — the PRE-FETCH gate stack:
 *   - two-sided liquidity (highPriceVolume>0 && lowPriceVolume>0) — the NON-NEGOTIABLE ghost-spread gate.
 *   - price window (MIN_PRICE ≤ mid ≤ MAX_PRICE).
 *   - the rising-pool NOISE FLOOR (rising mode only): a candidate must be a big ticket (mid ≥
 *     RISE_MID_FLOOR) OR liquid (limitVol ≥ RISE_LIQUID_VOL). Off in every other mode.
 *   - liquidity: unit floor (limitVol ≥ FLOOR) OR gp-flow (limitVol×mid ≥ GP_FLOOR); the gp-flow-only
 *     admission sets `thin`.
 *   - the per-mode step-3 edge (spread = 24h-avg after-tax spread; band/rising/churn = traded band),
 *     %-ROI ≥ MIN_ROI OR (thin & abs-gp ≥ MIN_NET_GP); churn swaps in a volume+limit gate.
 *   - the 500k/day attention floor (expGpDay ≥ MIN_GPD), from which THIN gp-flow qualifiers are EXEMPT.
 *
 * WHAT IT DOES NOT OWN (so it's NOT fixtured here): falling-regime EXCLUSION and the rising-CONFIRM
 * both run POST-fetch in renderMode() off the real computeQuote row (row.falling / row.rising), not in
 * gateCandidates. Held/asked/watchlist EXEMPTIONS never reach gateCandidates either — the S3 watchlist
 * path bypasses the gate stack entirely (runWatchlist). The only exemption inside this function is the
 * thin-gp-flow exemption from the attention floor, pinned below.
 */
import assert from 'node:assert/strict';
import { gateCandidates, risingPoolFloor } from './screen.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// A realistic thresholds object; individual tests override fields via spread. MIN_GPD is kept LOW in
// the base so edge/liquidity tests aren't incidentally filtered by the attention floor — the floor has
// its own dedicated test that sets it explicitly.
const baseT = {
  FLOOR: 50, MIN_ROI: 1.5, MIN_PRICE: 0, MAX_PRICE: 45e6, MIN_NET_GP: 100_000,
  MIN_ACTIVE: 6, MIN_ACTIVE_THIN: 1, MIN_GPD: 1000, GP_FLOOR: 250_000_000,
  RISE_MID_FLOOR: 1_000_000, RISE_LIQUID_VOL: 1000,
};
// build a 24h record and (optionally) a map limit / a band, keyed by id.
const rec = (avgLow, avgHigh, hpv, lpv = hpv) => ({ avgLowPrice: avgLow, avgHighPrice: avgHigh, highPriceVolume: hpv, lowPriceVolume: lpv });
const band = (bandLo, bandHi, active5m) => ({ bandLo, bandHi, active5m });
const ctx = (v24, byId = {}, bands = {}) => ({ v24, map: { byId }, bands });

console.log('screen.mjs gateCandidates() acceptance:');

/* --- two-sided liquidity gate ------------------------------------------------------------- */
ok('two-sided liquidity: a one-sided book (lpv=0) is dropped; a two-sided one survives', () => {
  const v24 = { 100: rec(1000, 1100, 200, 0), 200: rec(1000, 1100, 200, 200) };
  const cand = gateCandidates('spread', ctx(v24), baseT);
  const ids = cand.map(c => c.id);
  assert.deepEqual(ids, [200], 'only the two-sided item survives (100 has lpv=0)');
  assert.equal(cand[0].thin, false);
});

/* --- gp-flow big-ticket admission with the thin flag -------------------------------------- */
ok('gp-flow path admits a big-ticket thin item (limitVol<FLOOR but limitVol×mid ≥ GP_FLOOR)', () => {
  // mid 17.5m, limitVol 20 (<50 → below the unit floor); 20×17.5m = 350m ≥ 250m GP_FLOOR.
  const v24 = { 7: rec(17_000_000, 18_000_000, 20) };
  const cand = gateCandidates('spread', ctx(v24), baseT);
  assert.equal(cand.length, 1);
  assert.equal(cand[0].thin, true, 'admitted via gp-flow only → flagged thin');
  // and it FAILS when its gp-flow no longer clears a raised GP_FLOOR (350m < 400m)
  const cand2 = gateCandidates('spread', ctx(v24), { ...baseT, GP_FLOOR: 400_000_000 });
  assert.equal(cand2.length, 0, 'below both the unit floor and the raised gp-flow floor → dropped');
});

/* --- the 500k/day attention floor + the thin exemption ------------------------------------ */
ok('attention floor drops a sub-floor LIQUID row; thin gp-flow qualifiers are EXEMPT', () => {
  // liquid low-net item: expGpDay ≈ 1560 (net 78 × ~20 exp units/day).
  const liquid = { 300: rec(1000, 1100, 200) };
  assert.equal(gateCandidates('spread', ctx(liquid), { ...baseT, MIN_GPD: 1000 }).length, 1, 'passes a low floor');
  assert.equal(gateCandidates('spread', ctx(liquid), { ...baseT, MIN_GPD: 5000 }).length, 0, 'dropped below a 5k floor');
  // thin big-ticket: tiny expGpDay, but EXEMPT from even an enormous attention floor.
  const thinBig = { 7: rec(17_000_000, 18_000_000, 20) };
  const cand = gateCandidates('spread', ctx(thinBig), { ...baseT, MIN_GPD: 10_000_000 });
  assert.equal(cand.length, 1, 'thin gp-flow qualifier ignores the attention floor');
  assert.equal(cand[0].thin, true);
});

/* --- risingPoolFloor: big-ticket OR liquid, rising mode only ------------------------------- */
ok('risingPoolFloor predicate: passes on big-ticket OR liquid, fails cheap-and-thin', () => {
  assert.equal(risingPoolFloor(2_000_000, 100, 1_000_000, 1000), true, 'big ticket');
  assert.equal(risingPoolFloor(500_000, 1500, 1_000_000, 1000), true, 'liquid');
  assert.equal(risingPoolFloor(500_000, 100, 1_000_000, 1000), false, 'cheap AND thin-volume → dropped');
});

ok('rising mode applies the noise floor; band mode does NOT (same cheap item)', () => {
  // cheap item, mid 500k, limitVol 100 (≥FLOOR so NOT thin) — fails the rising floor (cheap & <1000 vol).
  const v24 = { 1: rec(490_000, 510_000, 100) };
  const bands = { 1: band(490_000, 510_000, 10) };
  const rising = gateCandidates('rising', ctx(v24, {}, bands), baseT);
  assert.equal(rising.length, 0, 'rising: cheap-and-thin-volume item dropped by the pool floor');
  const bandMode = gateCandidates('band', ctx(v24, {}, bands), baseT);
  assert.equal(bandMode.length, 1, 'band mode has no rising floor → same item survives');
});

ok('rising mode keeps a big-ticket OR a liquid candidate through the noise floor', () => {
  const v24 = {
    2: rec(1_950_000, 2_050_000, 100),   // big ticket (mid 2m ≥ 1m), thin-ish volume
    3: rec(490_000, 510_000, 1500),      // cheap but liquid (limitVol 1500 ≥ 1000)
  };
  const bands = { 2: band(1_950_000, 2_050_000, 10), 3: band(490_000, 510_000, 10) };
  const cand = gateCandidates('rising', ctx(v24, {}, bands), baseT);
  assert.deepEqual(cand.map(c => c.id).sort((a, b) => a - b), [2, 3], 'both survive the rising floor');
});

/* --- band mode requires a TRADED band (active5m ≥ MIN_ACTIVE) ------------------------------ */
ok('band mode: an untraded band (active5m below MIN_ACTIVE) is rejected', () => {
  const v24 = { 4: rec(1000, 1100, 200) };
  const traded = { 4: band(1000, 1100, 10) };     // 10 ≥ 6 → survives
  const spike = { 4: band(1000, 1100, 2) };       // 2 < 6 → rejected (one spike, not a band)
  assert.equal(gateCandidates('band', ctx(v24, {}, traded), baseT).length, 1);
  assert.equal(gateCandidates('band', ctx(v24, {}, spike), baseT).length, 0);
});

/* --- price window ------------------------------------------------------------------------- */
ok('price window: mid outside [MIN_PRICE, MAX_PRICE] is dropped', () => {
  const v24 = { 5: rec(50_000_000, 55_000_000, 100000) };   // mid 52.5m > 45m default MAX_PRICE (wide spread clears tax)
  assert.equal(gateCandidates('spread', ctx(v24), baseT).length, 0, 'above MAX_PRICE → dropped');
  assert.equal(gateCandidates('spread', ctx(v24), { ...baseT, MAX_PRICE: 60_000_000 }).length, 1, 'raised MAX_PRICE admits it');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
