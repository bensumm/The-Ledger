#!/usr/bin/env node
/**
 * gatecandidates.test.mjs — acceptance fixtures for screen.mjs's candidate gate stack (GC1).
 *
 * GC1 extracted screen.mjs's pre-fetch gating into the exported, threshold-driven gateCandidates();
 * P1 then RELOCATED it (with risingPoolFloor + the rest of the pool-selection cluster) into
 * pipeline/lib/gatecandidates.mjs — a pure module, so importing it fires NO screen/network. The gate
 * LOGIC is byte-identical to the original inline screen.mjs code — the `thresholds` argument (default
 * DEFAULT_THRESHOLDS) lets fixtures drive the whole stack with synthetic 24h / band data (no live
 * API). No live data (CLAUDE.md rule 4).
 * Run: `node pipeline/gatecandidates.test.mjs`  (exits non-zero on any failure).
 *
 * WHAT gateCandidates OWNS (and this file pins) — the PRE-FETCH gate stack. (Steps 3+4, Ben 2026-07-09:
 * the spread + rising specs are DELETED; these tests use `band` as the generic vehicle. The risingPoolFloor
 * predicate is retained-but-unused — no shipped spec sets pool.risingFloor:true — and pinned as a pure fn.)
 *   - two-sided liquidity (highPriceVolume>0 && lowPriceVolume>0) — the NON-NEGOTIABLE ghost-spread gate.
 *   - price window (MIN_PRICE ≤ mid ≤ MAX_PRICE).
 *   - liquidity: unit floor (limitVol ≥ FLOOR) OR gp-flow (limitVol×mid ≥ GP_FLOOR); the gp-flow-only
 *     admission sets `thin`.
 *   - the per-mode step-3 edge (band/scalp = traded band, %-ROI ≥ MIN_ROI OR thin&abs-gp; churn swaps in
 *     a volume+limit gate).
 *   - the 500k/day attention floor (expGpDay ≥ MIN_GPD), from which THIN gp-flow qualifiers are EXEMPT.
 *
 * WHAT gateCandidates DOES NOT OWN (so it's not fixtured HERE): the POST-fetch survival doctrine —
 * falling-regime EXCLUSION, the rising-CONFIRM, and the overnight-posture filters — runs off the real
 * computeQuote row (row.falling / row.rising / row.reliable / …), not in gateCandidates. P1 extracted
 * that doctrine into the pure surviveMode() (same lib/gatecandidates.mjs) and it IS fixtured now — in
 * the sibling survivemode.test.mjs. Held/asked/watchlist EXEMPTIONS never reach gateCandidates either —
 * the S3 watchlist path bypasses the gate stack entirely (runWatchlist). The only exemption inside
 * gateCandidates is the thin-gp-flow exemption from the attention floor, pinned below.
 */
import assert from 'node:assert/strict';
import { gateCandidates, risingPoolFloor, rankAndSlice, proxyDrift, softFactor, VALUE_TOP_DEFAULT } from './lib/gatecandidates.mjs';

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

console.log('gatecandidates.mjs gateCandidates() acceptance:');

/* --- two-sided liquidity gate ------------------------------------------------------------- */
ok('two-sided liquidity: a one-sided book (lpv=0) is dropped; a two-sided one survives', () => {
  const v24 = { 100: rec(1000, 1100, 200, 0), 200: rec(1000, 1100, 200, 200) };
  const bands = { 100: band(1000, 1100, 10), 200: band(1000, 1100, 10) };
  const cand = gateCandidates('band', ctx(v24, {}, bands), baseT);
  const ids = cand.map(c => c.id);
  assert.deepEqual(ids, [200], 'only the two-sided item survives (100 has lpv=0)');
  assert.equal(cand[0].thin, false);
});

/* --- gp-flow big-ticket admission with the thin flag -------------------------------------- */
ok('gp-flow path admits a big-ticket thin item (limitVol<FLOOR but limitVol×mid ≥ GP_FLOOR)', () => {
  // mid 17.5m, limitVol 20 (<50 → below the unit floor); 20×17.5m = 350m ≥ 250m GP_FLOOR.
  const v24 = { 7: rec(17_000_000, 18_000_000, 20) };
  const bands = { 7: band(17_000_000, 18_000_000, 6) };   // a traded band (active5m ≥ MIN_ACTIVE_THIN)
  const cand = gateCandidates('band', ctx(v24, {}, bands), baseT);
  assert.equal(cand.length, 1);
  assert.equal(cand[0].thin, true, 'admitted via gp-flow only → flagged thin');
  // and it FAILS when its gp-flow no longer clears a raised GP_FLOOR (350m < 400m)
  const cand2 = gateCandidates('band', ctx(v24, {}, bands), { ...baseT, GP_FLOOR: 400_000_000 });
  assert.equal(cand2.length, 0, 'below both the unit floor and the raised gp-flow floor → dropped');
});

/* --- the 500k/day attention floor + the thin exemption ------------------------------------ */
ok('attention floor drops a sub-floor LIQUID row; thin gp-flow qualifiers are EXEMPT', () => {
  // liquid low-net item: expGpDay ≈ 1560 (net 78 × ~20 exp units/day).
  const liquid = { 300: rec(1000, 1100, 200) };
  const lbands = { 300: band(1000, 1100, 10) };
  assert.equal(gateCandidates('band', ctx(liquid, {}, lbands), { ...baseT, MIN_GPD: 1000 }).length, 1, 'passes a low floor');
  assert.equal(gateCandidates('band', ctx(liquid, {}, lbands), { ...baseT, MIN_GPD: 5000 }).length, 0, 'dropped below a 5k floor');
  // thin big-ticket: tiny expGpDay, but EXEMPT from even an enormous attention floor.
  const thinBig = { 7: rec(17_000_000, 18_000_000, 20) };
  const tbands = { 7: band(17_000_000, 18_000_000, 6) };
  const cand = gateCandidates('band', ctx(thinBig, {}, tbands), { ...baseT, MIN_GPD: 10_000_000 });
  assert.equal(cand.length, 1, 'thin gp-flow qualifier ignores the attention floor');
  assert.equal(cand[0].thin, true);
});

/* --- risingPoolFloor: retained-but-unused pure predicate (rising niche deleted) ------------ */
ok('risingPoolFloor predicate: passes on big-ticket OR liquid, fails cheap-and-thin', () => {
  // the predicate is kept as a pure fn (a future rising re-add is a one-flag change), though no shipped
  // spec sets pool.risingFloor:true anymore — so gateCandidates never invokes it in production.
  assert.equal(risingPoolFloor(2_000_000, 100, 1_000_000, 1000), true, 'big ticket');
  assert.equal(risingPoolFloor(500_000, 1500, 1_000_000, 1000), true, 'liquid');
  assert.equal(risingPoolFloor(500_000, 100, 1_000_000, 1000), false, 'cheap AND thin-volume → dropped');
});

ok('no shipped spec triggers the rising pool floor — a cheap-and-thin-volume item survives band', () => {
  // cheap item, mid 500k, limitVol 100 (≥FLOOR so NOT thin) — this would have been dropped by the deleted
  // rising niche's pool floor, but band (pool.risingFloor:false) has no such floor, so it survives.
  const v24 = { 1: rec(490_000, 510_000, 100) };
  const bands = { 1: band(490_000, 510_000, 10) };
  const bandMode = gateCandidates('band', ctx(v24, {}, bands), baseT);
  assert.equal(bandMode.length, 1, 'band mode has no rising floor → the item survives');
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
  const v24 = { 5: rec(50_000_000, 55_000_000, 100000) };   // mid 52.5m > 45m default MAX_PRICE (wide band clears tax)
  const bands = { 5: band(50_000_000, 55_000_000, 10) };
  assert.equal(gateCandidates('band', ctx(v24, {}, bands), baseT).length, 0, 'above MAX_PRICE → dropped');
  assert.equal(gateCandidates('band', ctx(v24, {}, bands), { ...baseT, MAX_PRICE: 60_000_000 }).length, 1, 'raised MAX_PRICE admits it');
});

/* === fetch-pool ORDERING: proxyDrift / softFactor / rankAndSlice (P1) ===================== *
 * These were untested inline in screen.mjs — a selection effect that silently drops opportunities.
 * All pure now, driven with synthetic {ts,mid} archives + candidate stubs (no live API).            */

// build a bulk daily {ts,mid} series with a chosen recent (last-3d) vs prior (4–17d) median so
// proxyDrift returns a known drift %. 6 prior points + 4 recent points clear its min-sample gates.
function dseries(recentMid, priorMid) {
  const day = 86400, tEnd = 1_700_000_000, pts = [];
  for (let i = 9; i >= 4; i--) pts.push({ ts: tEnd - i * day, mid: priorMid });   // prior: 4–9d before tEnd
  for (const d of [2, 1.5, 1, 0]) pts.push({ ts: tEnd - Math.round(d * day), mid: recentMid });  // recent: ≤3d, last = tEnd
  return pts;
}

console.log('\ngatecandidates.mjs proxyDrift() / softFactor():');

ok('proxyDrift: null on missing/too-short/too-sparse series', () => {
  assert.equal(proxyDrift(null), null);
  assert.equal(proxyDrift([{ ts: 1, mid: 100 }]), null);
  assert.equal(proxyDrift([{ ts: 1000, mid: 100 }, { ts: 2000, mid: 100 }]), null);  // <4 recent / <6 prior
});

ok('proxyDrift: recent-vs-prior median drift %, signed', () => {
  assert.equal(proxyDrift(dseries(110, 100)), 10, 'recent 10% above prior → +10');
  assert.equal(proxyDrift(dseries(90, 100)), -10, 'recent 10% below prior → -10');
  assert.equal(proxyDrift(dseries(100, 100)), 0, 'flat → 0 (NOT null — rm/pm truthy)');
});

ok('softFactor: null→0.7, ≤-8→0.1, ≤-5→0.5, else 1 (boundaries)', () => {
  assert.equal(softFactor(null), 0.7);
  assert.equal(softFactor(0), 1);
  assert.equal(softFactor(-4), 1);
  assert.equal(softFactor(-5), 0.5);
  assert.equal(softFactor(-6), 0.5);
  assert.equal(softFactor(-8), 0.1);
  assert.equal(softFactor(-9), 0.1);
});

console.log('\ngatecandidates.mjs rankAndSlice():');

// candidate stub (shape rankAndSlice consumes): id, expGpDay, thin, limitVol, mid.
const c = (id, expGpDay, over = {}) => ({ id, expGpDay, thin: false, limitVol: 100, mid: 5000, ...over });

ok('non-rising ranking deprioritizes a probable faller via softFactor', () => {
  // equal expGpDay; id 1 has a -10% proxy drift (softFactor 0.1) so it sorts BELOW the flat id 2.
  const cand = [c(1, 1000), c(2, 1000)];
  const daily = { 1: dseries(90, 100), 2: dseries(100, 100) };
  const out = rankAndSlice('band', cand, daily, { top: 40, thinReserve: 6 });
  assert.deepEqual(out.map(x => x.id), [2, 1]);
});

ok('rising RESERVE front-loads a strong riser (band mode) despite a higher-expGpDay flat', () => {
  // the absorbed `rising` mechanism (Steps 3+4): the highest positive-proxyDrift non-thin candidate is
  // reserved to the FRONT of the fetch pool so a riser isn't buried below a flat with a bigger expGpDay.
  const cand = [c(1, 500), c(2, 9999)];
  const daily = { 1: dseries(110, 100), 2: dseries(100, 100) };   // id1 +10% drift, id2 flat (0 drift, not reserved)
  const out = rankAndSlice('band', cand, daily);
  assert.deepEqual(out.map(x => x.id), [1, 2], 'the riser leads via the reserve despite id2\'s bigger expGpDay');
});

ok('rising reserve is bounded — risingReserve:0 disables it (pure velocity order)', () => {
  const cand = [c(1, 500), c(2, 9999)];
  const daily = { 1: dseries(110, 100), 2: dseries(100, 100) };
  const out = rankAndSlice('band', cand, daily, { risingReserve: 0 });
  assert.deepEqual(out.map(x => x.id), [2, 1], 'no reserve → the bigger expGpDay flat leads');
});

ok('thin gp-flow qualifiers ride a bounded reserve, PREPENDED, ranked by limitVol×mid', () => {
  const cand = [
    c(10, 100000),                                              // liquid main-pool row
    c(20, 5, { thin: true, limitVol: 20, mid: 18_000_000 }),    // thin big ticket, gp-flow 360m
    c(21, 5, { thin: true, limitVol: 10, mid: 18_000_000 }),    // thin, gp-flow 180m
  ];
  const out = rankAndSlice('band', cand, {}, { thinReserve: 6, top: 40 });
  assert.deepEqual(out.map(x => x.id), [20, 21, 10], 'reserve (by gp-flow desc) first, then the non-thin pool');
});

ok('thinReserve caps how many thin rows are admitted', () => {
  const cand = [
    c(20, 5, { thin: true, limitVol: 30, mid: 10_000_000 }),
    c(21, 5, { thin: true, limitVol: 20, mid: 10_000_000 }),
    c(22, 5, { thin: true, limitVol: 10, mid: 10_000_000 }),
  ];
  const out = rankAndSlice('band', cand, {}, { thinReserve: 2, top: 40 });
  assert.deepEqual(out.map(x => x.id), [20, 21], 'only the top-2 thin by gp-flow');
});

ok('top slices the combined reserve+pool list', () => {
  const cand = [c(1, 300), c(2, 200), c(3, 100)];               // no series → all softFactor 0.7 → expGpDay order
  const out = rankAndSlice('band', cand, {}, { top: 2, thinReserve: 6 });
  assert.deepEqual(out.map(x => x.id), [1, 2]);
});

/* === P5 VALUE niche: the term-structure gate + the §F flood-control rank/cutoff ================= *
 * value's gate is term-structure-driven (js/valuescreen.mjs), routed via spec.gate==='value'. The
 * daily-mid archive rides ctx.daily. These pin: the knife rejection, the amplitude floor, and — the
 * §F flood-control regression guard — that a LARGE gated pool is ranked by valueScore and HARD-capped. */
console.log('\ngatecandidates.mjs VALUE niche (P5):');

const DAY = 86400, TEND = 1_700_000_000;
// a daily {ts,mid} archive from mids (oldest→newest, 1 day apart ending at TEND).
const dseriesV = mids => mids.map((m, i) => ({ ts: TEND - (mids.length - 1 - i) * DAY, mid: m }));
const altV = (n, lo, hi) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? lo : hi));
const FLAT_V = [...altV(19, 1000, 1100), 1000];        // flat floor, ~7.8% after-tax amplitude
const KNIFE_V = [...altV(15, 1000, 1100), 950, 920, 900, 880, 860];  // decayed off the base
// a value ctx: v24 record + the daily archive, keyed by id.
const vctx = (v24, daily, byId = {}) => ({ v24, map: { byId }, bands: {}, daily });

ok('value gate: a flat-floor two-sided item with ≥6% amplitude near the low PASSES; a knife is dropped', () => {
  const v24 = { 500: rec(1000, 1010, 200), 600: rec(1000, 1010, 200) };   // both liquid + two-sided
  const daily = { 500: dseriesV(FLAT_V), 600: dseriesV(KNIFE_V) };
  const cand = gateCandidates('value', vctx(v24, daily), baseT);
  assert.deepEqual(cand.map(c => c.id), [500], 'the flat-floor item passes; the knife is rejected');
  assert.ok(cand[0].valueScore > 0 && cand[0].tier === 'buy-now', 'carries a score + a buy-now tier (live near the low)');
});

ok('value gate keeps the two-sided liquidity gate (a one-sided book is dropped even with a great range)', () => {
  const v24 = { 500: rec(1000, 1010, 200, 0) };   // lpv=0 → one-sided
  const cand = gateCandidates('value', vctx(v24, { 500: dseriesV(FLAT_V) }), baseT);
  assert.equal(cand.length, 0, 'one-sided → uncrossable → dropped (non-negotiable)');
});

ok('value gate drops an item with NO daily history (can\'t assert a value floor)', () => {
  const v24 = { 500: rec(1000, 1010, 200) };
  const cand = gateCandidates('value', vctx(v24, { 500: [{ ts: TEND, mid: 1000 }] }), baseT);
  assert.equal(cand.length, 0, 'a one-point series → no term structure → skipped');
});

ok('§F FLOOD CONTROL: a large gated pool ranks by valueScore and is HARD-capped to the top-N', () => {
  // 40 flat-floor value items (a realistically LARGE pool — the whole point of §F). Vary the live-vs-low
  // proximity via the 24h mid so valueScore separates them, then assert the cutoff + the ordering.
  const v24 = {}, daily = {};
  for (let i = 0; i < 40; i++) {
    const id = 1000 + i;
    // spread avgLow from 1000 (at the floor → high proximity/score) up to ~1080 (mid-range → lower).
    const lo = 1000 + i * 2;
    v24[id] = rec(lo, lo + 10, 200);
    daily[id] = dseriesV(FLAT_V);
  }
  const cand = gateCandidates('value', vctx(v24, daily), baseT);
  assert.ok(cand.length > VALUE_TOP_DEFAULT, `the pool is large (${cand.length} admitted > ${VALUE_TOP_DEFAULT})`);
  const sliced = rankAndSlice('value', cand, daily, { top: VALUE_TOP_DEFAULT });
  assert.equal(sliced.length, VALUE_TOP_DEFAULT, 'HARD top-N cutoff — never dump the full pool');
  // sorted by valueScore DESC — the nearest-the-low (id 1000) leads, and scores are monotonic non-increasing.
  for (let i = 1; i < sliced.length; i++) assert.ok(sliced[i - 1].valueScore >= sliced[i].valueScore, 'ranked by valueScore desc');
  assert.equal(sliced[0].id, 1000, 'the item at the floor (best proximity) ranks first');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
