/**
 * valuescreen.mjs — PURE gate + rank math for the `--mode value` buy-hold niche (Pipeline-v2 chunk
 * P5 / PLAN-VALUE). Lives in js/ (NOT pipeline/lib/) for the same reason as js/quotecore.js /
 * js/termstructure.mjs: importable from BOTH node (screen.mjs / gatecandidates.mjs) AND — later — the
 * app. No DOM, no fetch, no fs — the caller hands in an already-loaded daily-mid series' term
 * structure (js/termstructure.mjs) + the live price.
 *
 * THE NICHE (PLAN-VALUE, Ben 2026-07-08). Our fast niches turn things over NOW; value surfaces items
 * to BUY near a multi-week low and HOLD for the range to cycle back up. The edge is ONE tax-paid sell
 * of a big move — structurally tax-efficient (2% paid once per cycle, not per lap). Because a great
 * slow-hold item has LOW daily throughput, the 500k gp/day attention floor would throw it out — so
 * value is a NICHE with its OWN gate (this module), not a probe.
 *
 * WHAT THIS COMPUTES (all off the 1/3/7/14/28d term structure — §C):
 *   valueRanges(ts, live)   → the scalar SHAPE features: after-tax cycle amplitude, proximity-to-low,
 *                             floor-stability (low dispersion across ranges), and the knife delta (the
 *                             recent-3d median below the 14d median = a DECLINE in progress; see the
 *                             note at the knifeDelta computation for why medians, not lows). The cycle
 *                             range is RECENCY-ANCHORED (§ VALUE_RECENT_DAYS) so a stale prior-regime
 *                             high/low can't inflate amplitude or fake proximity (RC1's disease).
 *   valueScore(vr)          → the composite rank (§B/§F): amplitude × proximity × stability. The
 *                             ranking IS the central design problem — the gated pool is expected LARGE
 *                             (§F), so a usable score + a hard top-N is non-optional.
 *   valueGate(vr, {phase})  → { pass, reason }: two-sided liquidity is the caller's (shared, kept); this
 *                             gate is the cycle-amplitude floor + the ARTIFACT/proximity-sanity guard
 *                             (live implausibly below the durable floor = a broken instasell print or a
 *                             crash, not a dip — the low-side analog of the band/rising artifact-bid) +
 *                             the phase/term-structure KNIFE guard ("buy the base, never the knife" —
 *                             accept basing/flat/rising; reject a decay/downtrend that is still stepping down).
 *   valueTier(vr)           → 'buy-now' (live at/near the multi-week low) | 'watch' (good range, wait
 *                             for the dip) — falls out of PROXIMITY (rank, don't gate — decision 1).
 *
 * HONESTY (rule 4 — n≈0). EVERY threshold + weight below is a NAMED PLACEHOLDER. valueScore's weights
 * are a STARTING HYPOTHESIS, not a calibrated model (§F): the point of the suggestions/firing accrual
 * is to learn WHICH term-structure features predict a good hold, then re-weight. Do not cite any
 * constant here as validated.
 */
import { tax } from './format.js';

// --- PLACEHOLDER constants (rule 4 — unvalidated; the firing/suggestions accrual would tune them) ---
export const VALUE_MIN_CYCLE_PCT = 0.06;   // after-tax cycle amplitude must clear ~6% for one taxed sell to net meaningfully
// A HOLD cycle swings within a normal band; a robust floor→ceiling (q15→q85) that is a huge MULTIPLE is
// not a cycle, it's two different price regimes / a dead-item's noise (a 3gp→600gp "range"). Cap the
// after-tax amplitude: above this it's rejected as noise, not ranked #1. PLACEHOLDER (rule 4).
export const VALUE_MAX_CYCLE_PCT = 1.5;    // > 150% floor→ceiling ⇒ regime-change / noise, not a hold cycle
// Value is a CAPITAL-DEPLOYMENT play — a sub-threshold penny item can't absorb meaningful gp and its
// % swings are book noise. Drop items whose live/mid sits below this. PLACEHOLDER (rule 4).
export const VALUE_MIN_PRICE     = 1000;
// A value floor is a MULTI-WEEK claim — asserting one off a day of intraday points is dishonest. The
// durable lookback must span at least this many CALENDAR days (not just FLOOR_MIN_POINTS, which a cold
// intraday archive satisfies). The daily archive is backfilled to ~2026-06-19 (~20d), so this clears on
// most items now; on an item with a thin/cold slice it still degrades to no-data (the honest degrade, rule 4).
export const VALUE_MIN_COVERAGE_DAYS = 10;
export const VALUE_KNIFE_PCT     = 0.06;   // a 1d/3d low ≥6% BELOW the 14d low ⇒ still making fresh lows ⇒ a knife → reject
// PROXIMITY-SANITY / ARTIFACT guard (Ben 2026-07-09). The durable low is the ROBUST q15 multi-week floor.
// A live price sitting WELL BELOW it is NOT a value dip — it's either a broken/thin instasell print (one
// lone off-market trade — Gloves of silence live 201 vs a 1,248 floor) or a crash-in-progress (a knife
// mid-fall). Both corrupt proximity (→1) and rocket the row to the top of valueScore on a FAKE dip. This
// is the low-side analog of the band/rising artifact-bid: reject when live is more than this fraction
// below the durable floor. Tolerance is generous (a REAL dip buys at/just under q15) — past it, it's not a
// dip. PLACEHOLDER (rule 4). Applied in valueGate (fires at gate-time on mid AND post-fetch on live).
export const VALUE_MAX_BELOW_LOW_PCT = 0.15;
export const VALUE_BUYNOW_PROX   = 0.75;   // proximity ≥ this (live in the bottom ~25% of the 14d range) ⇒ the buy-now tier
// RC1 RECENCY ANCHOR (Ben 2026-07-09). The durable q15/q85 floor+ceiling span the FULL 28d window, so a
// stale high/low from a PRIOR regime the item has LEFT inflates the cycle amplitude AND fakes proximity —
// RC1's reach-contamination disease, in the value range. The cycle range is re-anchored to the last
// VALUE_RECENT_DAYS: the recovery ceiling can't exceed the recent regime's top, and the buy floor can't
// sit below where the item recently floors. VALUE_STALE_MARGIN is the min durable-vs-effective gap that
// flags a range as recency-anchored (for the note). Both PLACEHOLDERS (rule 4).
export const VALUE_RECENT_DAYS   = 7;
export const VALUE_STALE_MARGIN  = 0.05;
export const VALUE_STAB_K        = 4;      // dispersion→stability sharpness: stability = 1/(1+K·dispersion)
export const VALUE_PROX_FLOOR_W  = 0.5;    // proximity multiplier floor (a mid-range candidate still scores, at half weight)
export const VALUE_STAB_FLOOR_W  = 0.5;    // stability multiplier floor (an unstable-floor candidate still scores, at half weight)

const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;
const afterTax = p => p - tax(p);

/* valueRanges(ts, live) → the value SHAPE features, or { hasData:false }.
   ts   — a js/termstructure.mjs termStructure() result over the daily-mid series.
   live — the current live price (row.quickBuy/mid at gate time; the live instasell post-fetch). */
export function valueRanges(ts, live) {
  if (!ts || !ts.hasData) return { hasData: false };
  // MULTI-WEEK coverage guard — a durable floor asserted off < VALUE_MIN_COVERAGE_DAYS of history is a
  // day-of-intraday-noise floor, not a value floor. On a cold archive this degrades to no-data.
  if (!(ts.coverageDays >= VALUE_MIN_COVERAGE_DAYS)) return { hasData: false, cold: true };
  const lk = ts.lookbacks || {};
  const lowByRange = {}, highByRange = {};
  for (const d of [1, 3, 7, 14, 28]) { if (lk[d]) { lowByRange[d] = lk[d].low; highByRange[d] = lk[d].high; } }
  // The durable low/high are the ROBUST term-structure quantiles (floor = q15, ceiling = q85) over the
  // durable multi-week lookback — NOT the raw min/max, so a single spike/decay can't inflate the cycle
  // (the whole point of §C). Both REQUIRE FLOOR_MIN_POINTS in a 14/28d window — an item with a thin/cold
  // slice (the archive is backfilled to ~20d, but a newly-tracked item can still be short) yields a null
  // floor → hasData false → the value gate surfaces NOTHING for it (the honest degrade, rule 4).
  const rawDurableLow = num(ts.floor), rawDurableHigh = num(ts.ceiling);
  if (rawDurableLow == null || rawDurableHigh == null || rawDurableLow <= 0 || rawDurableHigh <= rawDurableLow) return { hasData: false };

  // RC1 RECENCY ANCHOR (§ VALUE_RECENT_DAYS). Re-anchor the cycle range to the recent window so a stale
  // prior-regime high/low can't inflate amplitude or fake proximity (Contract-of-sensory-clouding: a
  // month-old 365k q85 ceiling the item crashed away from made a mid-recovery 200k live read as "near the
  // low → BUY-NOW", while the warm 7d layer said "52% up the week range"). Uses the RAW recent high/low —
  // the min/max DIRECTION makes it robust to a single recent spike (anchoring fires only when the WHOLE
  // recent window has shifted, never off one outlier). The buy floor is kept at the durable q15 unless the
  // recent floor sits ABOVE it (repriced up ⇒ the durable low is unreachable); a fresh recent LOW does not
  // lower the buy (that's the knife guard's job, not a cheaper entry).
  const recentHi = num(highByRange[VALUE_RECENT_DAYS]);
  const recentLo = num(lowByRange[VALUE_RECENT_DAYS]);
  let durableLow = rawDurableLow, durableHigh = rawDurableHigh;
  if (recentHi != null && recentHi < durableHigh) durableHigh = recentHi;   // durable ceiling is a stale prior-regime high
  if (recentLo != null && recentLo > durableLow) durableLow = recentLo;     // durable floor is a stale prior-regime low (repriced up)
  if (durableHigh < durableLow) durableHigh = durableLow;                   // fully repriced above the window ⇒ no cycle (amp ⇒ reject)
  const ceilingStale = durableHigh < rawDurableHigh * (1 - VALUE_STALE_MARGIN);
  const floorStale = durableLow > rawDurableLow * (1 + VALUE_STALE_MARGIN);

  const buyLow = durableLow;   // enter at the (recency-anchored) robust floor
  // after-tax cycle amplitude: profit % if you catch the full cycle (buy the floor, sell the ceiling once).
  const afterTaxAmpPct = durableHigh > durableLow ? (afterTax(durableHigh) - buyLow) / buyLow : 0;

  // proximity-to-low over the (recency-anchored) floor→ceiling range: 1 at/below the floor, 0 at the
  // ceiling (live near the floor = buyable NOW). A collapsed range (fully repriced) ⇒ proximity 0.
  const proximity = (live != null)
    ? (durableHigh > durableLow ? clamp01(1 - (live - durableLow) / (durableHigh - durableLow)) : 0)
    : null;

  // floor stability: how FLAT the lows are across the ranges (small dispersion = a durable, defended
  // floor). dispersion = (max low − min low) / median low; stability = 1/(1+K·dispersion) ∈ (0,1].
  const lows = [1, 3, 7, 14, 28].map(d => num(lowByRange[d])).filter(v => v != null);
  let stability = null;
  if (lows.length >= 2) {
    const mn = Math.min(...lows), mx = Math.max(...lows), md = lows.slice().sort((a, b) => a - b)[Math.floor(lows.length / 2)];
    const dispersion = md > 0 ? (mx - mn) / md : 0;
    stability = 1 / (1 + VALUE_STAB_K * dispersion);
  }

  // knife delta: how far the RECENT (3d) median sits BELOW the 2-week (14d) median, as a fraction of
  // the 14d median. §C wants "1d/3d low far below the 14d/28d lows", but an inclusive term structure
  // can't express that (the 14d window already contains the 3d lows, so low3 ≥ low14 always). The
  // median-trend is the implementable proxy: recent prices materially below the multi-week norm = a
  // DECLINE in progress ("the knife"). A FLAT base has median3 ≈ median14 (≈0 → passes); a still-
  // decaying item has median3 well below median14 (> VALUE_KNIFE_PCT → rejected — buy the base, not
  // the knife). This is the deliberately CONSERVATIVE guard Ben asked for (reject decay/downtrend).
  const med3 = ts.lookbacks?.[3] ? num(ts.lookbacks[3].median) : null;
  const med14 = ts.lookbacks?.[14] ? num(ts.lookbacks[14].median) : (ts.lookbacks?.[7] ? num(ts.lookbacks[7].median) : null);
  const knifeDelta = (med3 != null && med14 != null && med14 > 0) ? (med14 - med3) / med14 : 0;

  return {
    hasData: true, live: num(live), durableLow, durableHigh, buyLow,
    rawDurableLow, rawDurableHigh, ceilingStale, floorStale,
    lowByRange, highByRange, afterTaxAmpPct, proximity, stability, knifeDelta,
    liveVsLowPct: (num(live) != null) ? (live - durableLow) / durableLow : null,
  };
}

/* valueScore(vr) → a composite rank (§B/§F). Multiplicative blend of the three shape features so a
   candidate wins by being amplitude-rich AND near the low AND on a durable floor — none alone carries
   it. Proximity/stability enter as multipliers floored at ½ so a mid-range or noisier-floor candidate
   still ranks (rank, don't gate). Returns 0 when there's no amplitude. PLACEHOLDER weights (§F). */
export function valueScore(vr) {
  if (!vr || !vr.hasData) return 0;
  const amp = Math.max(0, vr.afterTaxAmpPct || 0);
  const proxMult = VALUE_PROX_FLOOR_W + (1 - VALUE_PROX_FLOOR_W) * (vr.proximity ?? 0);
  const stabMult = VALUE_STAB_FLOOR_W + (1 - VALUE_STAB_FLOOR_W) * (vr.stability ?? 0);
  return amp * proxMult * stabMult * 100;   // ×100 → a readable score
}

/* valueGate(vr, { phase }) → { pass, reason }. Two-sided liquidity + the lowered liquidity floor are
   the CALLER's (shared stack); this owns the value-specific gate: the after-tax cycle-amplitude floor,
   the ARTIFACT/proximity-sanity guard (live implausibly below the durable floor = a broken print or a
   knife, not a dip), and the KNIFE guard. `phase` (optional, from js/quotecore.js phase() over ts6h
   post-fetch) rejects a `decay` shape; pre-fetch the term-structure knifeDelta does the work. reason is
   null when it passes; the reject reasons are no-history / amp-below-floor / amp-noise / artifact-low /
   knife / decay. */
export function valueGate(vr, { phase = null } = {}) {
  if (!vr || !vr.hasData) return { pass: false, reason: 'no-history' };   // can't assert a value floor
  const amp = vr.afterTaxAmpPct || 0;
  if (amp < VALUE_MIN_CYCLE_PCT) return { pass: false, reason: 'amp-below-floor' };
  if (amp > VALUE_MAX_CYCLE_PCT) return { pass: false, reason: 'amp-noise' };   // 100x "range" = regime-change/noise
  // ARTIFACT / proximity-sanity guard: live implausibly BELOW the durable q15 floor ⇒ a broken instasell
  // print or a crash-in-progress, not a dip (§ VALUE_MAX_BELOW_LOW_PCT). Fires post-fetch (live = the real
  // instasell) where it catches the top-of-valueScore artifacts (Gloves 201/1,248, Black pickaxe).
  if (vr.liveVsLowPct != null && vr.liveVsLowPct < -VALUE_MAX_BELOW_LOW_PCT) return { pass: false, reason: 'artifact-low' };
  if ((vr.knifeDelta || 0) > VALUE_KNIFE_PCT) return { pass: false, reason: 'knife' };   // fresh lows now
  if (phase === 'decay') return { pass: false, reason: 'decay' };        // post-fetch phase confirm (the knife)
  return { pass: true, reason: null };
}

/* valueTier(vr) → 'buy-now' | 'watch'. Falls out of proximity (rank, don't gate — decision 1): live
   at/near the multi-week low = buy-now; a good range mid-cycle = watch (wait for the dip). */
export function valueTier(vr) {
  return (vr && vr.hasData && vr.proximity != null && vr.proximity >= VALUE_BUYNOW_PROX) ? 'buy-now' : 'watch';
}
