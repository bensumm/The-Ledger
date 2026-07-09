/**
 * gatecandidates.mjs — the screen's pure candidate-selection + survival doctrine (P1).
 *
 * Extracted from screen.mjs (GC1 first pulled `gateCandidates`/`risingPoolFloor` out as exported,
 * threshold-driven functions behind screen.mjs's invocation guard; P1 relocated the whole
 * pool-selection + post-fetch-doctrine cluster HERE so it is node-importable + fixture-testable with
 * synthetic data and no live network). The LOGIC is byte-identical to the pre-P1 inline screen.mjs
 * code — this is a pure MOVE. screen.mjs imports everything back and calls it exactly where it did.
 *
 * The four concerns that live here (all pure, no CLI/network/fs state):
 *   1. gateCandidates(mode, ctx, thresholds) — the PRE-FETCH gate stack (two-sided liquidity OR
 *      gp-flow, price window, rising-pool noise floor, per-mode step-3 edge, 500k attention floor).
 *      Threshold-driven so fixtures drive it; defaults to DEFAULT_THRESHOLDS (the CLI defaults).
 *   2. rankAndSlice(mode, cand, dailySeries, opts) + proxyDrift + softFactor — the fetch-pool
 *      ORDERING (never displayed): proxy-drift deprioritizes probable fallers, rising pre-ranks by
 *      the proxy, thin gp-flow qualifiers get a bounded reserve, then TOP-N slice.
 *   3. surviveMode(mode, row, phase, opts) — the POST-FETCH doctrine renderMode applies to each
 *      fetched row: falling-exclusion (+ --phase-rescue basing rescue), rising-mode confirm, and
 *      overnight-posture filters. Returns {keep, discardReason, rescued}; discardReason maps 1:1 to
 *      renderMode's `disc` counters (falling / notRising / breakdown / posture), and `rescued` drives
 *      the disc.rescued counter (which increments on rescue even if a later gate drops the row).
 *   4. risingPoolFloor + expUnits — the shared predicates the above and the watchlist path reuse.
 *
 * PIN NOTE (P1 → re-pinned at P5): surviveMode encodes the CURRENT pre-amendment falling-exclusion
 * behavior (falling ⇒ dropped unless --phase-rescue basing). Ben's 2026-07-08 falling amendment
 * lands at P5 — the fixtures here will change then, and that diff IS the doctrine change.
 *
 * ALL numeric math (tax, overnightStaleRisk, median) is the shared impl imported below, so the
 * numbers stay byte-identical to screen.mjs / the app. No live data in the tests (CLAUDE.md rule 4).
 */
import { overnightStaleRisk } from '../../js/quotecore.js';
import { tax } from '../../js/format.js';
import { median } from './cli.mjs';

// DEFAULT_THRESHOLDS: the gate-stack constants at their CLI defaults (screen.mjs builds its own
// THRESHOLDS from parsed args and passes it explicitly; this default serves fixtures / import callers
// that don't supply one). Values mirror screen.mjs's `A.<flag> != null ? … : <default>` fallbacks.
export const DEFAULT_THRESHOLDS = {
  FLOOR: 50, MIN_ROI: 1.5, MIN_PRICE: 0, MAX_PRICE: 45e6, MIN_NET_GP: 100_000,
  MIN_ACTIVE: 6, MIN_ACTIVE_THIN: 1, MIN_GPD: 500_000, GP_FLOOR: 250_000_000,
  RISE_MID_FLOOR: 1_000_000, RISE_LIQUID_VOL: 1000,
};
// Default rank/slice sizing (screen.mjs's --thin-reserve / --top defaults).
export const THIN_RESERVE_DEFAULT = 6;
export const TOP_DEFAULT = 40;

// realistic expected units/day: buy-limit refreshes ~every 4h → 6 limits/day, capped at a 10% share
// of the limiting-side daily volume. Null limit → volume share only.
export const expUnits = (limit, volDay) => { const vShare = 0.10 * (volDay || 0); return limit != null ? Math.min(limit * 6, vShare) : vShare; };

// Pure predicate (NY2.1) — true = candidate survives the rising-pool noise floor: a BIG TICKET
// (mid ≥ midFloor) OR LIQUID enough to move (limitVol ≥ liqVol). Rising mode only.
export function risingPoolFloor(mid, limitVol, midFloor = DEFAULT_THRESHOLDS.RISE_MID_FLOOR, liqVol = DEFAULT_THRESHOLDS.RISE_LIQUID_VOL) {
  return mid >= midFloor || limitVol >= liqVol;
}

// --- regime proxy off loadDaily's bulk {ts,mid} series: SAME 3d-vs-prior-~2wk shape as quotecore's
// regimeDrift, but computed from the whole-market archive and NEVER displayed — it only ORDERS the
// fetch pool so we spend the expensive per-item fetches on likely survivors. The real regime (and the
// falling-exclusion + rising-confirm) is still the post-fetch computeQuote. ---
export function proxyDrift(points) {
  if (!points || points.length < 2) return null;
  const tEnd = points[points.length - 1].ts;
  const recentCut = tEnd - 3 * 86400, priorCut = tEnd - 17 * 86400;
  const recent = [], prior = [];
  for (const p of points) { if (p.mid == null) continue; if (p.ts >= recentCut) recent.push(p.mid); else if (p.ts >= priorCut) prior.push(p.mid); }
  if (recent.length < 4 || prior.length < 6) return null;       // too little archive → unknown (fall back to raw rank)
  const rm = median(recent), pm = median(prior);
  if (!rm || !pm) return null;
  return (rm - pm) / pm * 100;
}
// PLACEHOLDER fetch-pool ordering weight — deprioritize probable fallers (they'd be discarded
// post-fetch anyway). Chunk-C study sets these numbers; null (unknown regime) = mild trust.
export const softFactor = drift => drift == null ? 0.7 : drift <= -8 ? 0.1 : drift <= -5 ? 0.5 : 1;

// --- gate stack + mode-specific step-3 edge, ranked by realistic gp/day (picks the fetch pool) ---
// GC1: exported + threshold-driven. The gate LOGIC is byte-identical to before — every constant it
// used to close over is now a named field of the `t` thresholds object (default DEFAULT_THRESHOLDS),
// so fixtures can drive the whole stack (two-sided-liquidity OR gp-flow, price window, rising-pool
// floor, per-mode edge, 500k attention floor) without CLI/network state. `expUnits` and `tax` are pure.
export function gateCandidates(mode, { v24, map, bands }, t = DEFAULT_THRESHOLDS) {
  const cand = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity gate (shared, NON-NEGOTIABLE)
    const limitVol = Math.min(hpv, lpv);
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid < t.MIN_PRICE || mid > t.MAX_PRICE) continue;   // price window (shared)
    if (mode === 'rising' && !risingPoolFloor(mid, limitVol, t.RISE_MID_FLOOR, t.RISE_LIQUID_VOL)) continue;  // NY2.1: rising-pool noise floor (big-ticket OR liquid)
    // liquidity: raw UNIT floor OR the gp-flow floor (thin big-ticket path). `thin` = qualified via
    // gp-flow only (below the unit floor) → honestly marked downstream (grade cap + tooltip).
    const thin = limitVol < t.FLOOR;
    if (thin && limitVol * mid < t.GP_FLOOR) continue;    // fails BOTH the unit floor and the gp-flow floor
    const limit = map.byId[id]?.limit ?? null;

    // --- step 3: mode swaps ONLY the edge definition + gate here ---
    let modeNet, modeRoi, activeWin = null;
    if (mode === 'spread') {
      modeNet = (avgHigh - tax(avgHigh)) - avgLow;      // 24h-avg spread, after tax
      modeRoi = modeNet / avgLow * 100;
      if (modeRoi < t.MIN_ROI && !(thin && modeNet >= t.MIN_NET_GP)) continue;   // %-ROI OR (thin & abs-gp)
    } else {
      // band / rising / churn all price the edge off the traded intraday band
      const b = bands[id]; if (!b || b.bandLo == null || b.bandHi == null) continue;
      const minActive = thin ? t.MIN_ACTIVE_THIN : t.MIN_ACTIVE;   // 6/2h is impossible at ~12/d — relax for thin
      if (b.active5m < minActive) continue;             // band must be TRADED, not one spike
      activeWin = b.active5m;
      modeNet = (b.bandHi - tax(b.bandHi)) - b.bandLo;  // band low → band top, after tax
      modeRoi = modeNet / b.bandLo * 100;
      if (mode === 'churn') {
        if (!(limitVol >= 2000 && limit != null && limit > 0)) continue;  // buy-limit-cycle commodity
        // tiny ROI accepted for churn — no --min-roi gate; volume does the work
      } else {
        if (modeRoi < t.MIN_ROI && !(thin && modeNet >= t.MIN_NET_GP)) continue;   // %-ROI OR (thin & abs-gp)
      }
    }
    if (modeNet <= 0) continue;
    const expGpDay = Math.round(expUnits(limit, limitVol) * modeNet);
    // 500k/day attention floor — pre-rating, so no grade ever advertises a sub-floor row. Thin gp-flow
    // qualifiers are EXEMPT (a unit/gp-day count mismeasures them — see MIN_GPD note).
    if (!thin && expGpDay < t.MIN_GPD) continue;
    cand.push({ id, limitVol, mid, limit, expGpDay, activeWin, thin });
  }
  return cand;
}

// Rank the gated pool and take the top-N to fetch. The proxy (from the bulk daily archive) orders
// WHICH items we spend the expensive per-item fetch on — deprioritizing probable fallers, and for
// rising mode pushing likely-rising items to the front so its fetch budget isn't wasted on flats.
// `opts.thinReserve`/`opts.top` default to screen.mjs's --thin-reserve/--top defaults (screen passes
// the CLI values explicitly); fixtures can drive them.
export function rankAndSlice(mode, cand, dailySeries, { thinReserve = THIN_RESERVE_DEFAULT, top = TOP_DEFAULT } = {}) {
  for (const c of cand) c.proxyDrift = proxyDrift(dailySeries[c.id]);
  // Thin gp-flow qualifiers are held OUT of the main ranking and given a bounded RESERVE instead.
  // Two reasons: (1) their intraday band is priced off a thinly-traded 2h window, so bandNet is noisy
  // and often inflated (the band-top-artifact lesson) → a raw-expGpDay rank lets them CROWD OUT genuine
  // liquid flips; (2) the design intent is "surface the big ticket honestly, don't let it take over".
  // So the main pool is non-thin only; thin items get up to thinReserve slots, ranked by real gp-flow
  // (limitVol×mid, not the noisy bandNet). Net effect: the non-thin survivor set is materially unchanged
  // (gp-flow ADDS ≤ thinReserve rows/niche, doesn't reshuffle).
  const nonThin = cand.filter(c => !c.thin);
  if (mode === 'rising') {
    // fetch rising-likely items first: proxy drift desc (unknowns last), expGpDay as tiebreak
    nonThin.sort((a, b) => ((b.proxyDrift ?? -1e12) - (a.proxyDrift ?? -1e12)) || (b.expGpDay - a.expGpDay));
  } else {
    nonThin.sort((a, b) => (b.expGpDay * softFactor(b.proxyDrift)) - (a.expGpDay * softFactor(a.proxyDrift)));
  }
  const reserved = cand.filter(c => c.thin).sort((a, b) => (b.limitVol * b.mid) - (a.limitVol * a.mid)).slice(0, thinReserve);
  return [...reserved, ...nonThin].slice(0, top);
}

// --- post-fetch doctrine: does this fetched+quoted row SURVIVE its niche/posture? ------------------
// Extracted verbatim from renderMode's inline loop (P1). Returns {keep, discardReason, rescued}:
//   - keep=false ⇒ discardReason ∈ {'falling','notRising','breakdown','posture'}, mapping 1:1 to
//     renderMode's `disc` counters. The caller does `disc[discardReason]++`.
//   - rescued=true ⇒ a faller that --phase-rescue kept because it has decayed to a `basing` shape.
//     It increments disc.rescued AT THE POINT OF RESCUE (before the rising/posture gates), exactly
//     as the original did — so rescued is returned on EVERY branch after the rescue, whether the row
//     is ultimately kept or dropped by a later gate. The caller: `if (rescued) disc.rescued++`.
// opts: { phaseRescue, posture, thin, series5m } — series5m is THIS item's raw 5m series (for the
// overnight staleness read), i.e. renderMode's `series5m && series5m.get(id)`.
// PIN: this is the CURRENT (pre-amendment) falling-exclusion — re-pinned at P5 when the doctrine changes.
export function surviveMode(mode, row, phase, opts = {}) {
  const { phaseRescue = false, posture = 'active', thin = false, series5m = null } = opts;
  let rescued = false;
  if (row.falling) {
    if (phaseRescue && phase && phase.phase === 'basing') rescued = true;   // decayed off a spike, lows flattened
    else return { keep: false, discardReason: 'falling', rescued: false };  // screen rule: never surface fallers
  }
  if (mode === 'rising') {                                  // rising-mode confirm
    if (!row.rising) return { keep: false, discardReason: 'notRising', rescued };
    if (row.mom === 'breakdown') return { keep: false, discardReason: 'breakdown', rescued };
  }
  if (posture === 'overnight') {
    // overnight posture: only a confident, patient, non-thin edge that won't be stale by morning.
    if (thin) return { keep: false, discardReason: 'posture', rescued };                                      // no thin fast-lane
    if (!(row.regimeLabel === 'flat' || row.rising)) return { keep: false, discardReason: 'posture', rescued }; // confident flat/rising only (drops unknown)
    if (!row.reliable) return { keep: false, discardReason: 'posture', rescued };                              // needs a trustworthy band
    if (row.mom === 'breakdown') return { keep: false, discardReason: 'posture', rescued };                    // no active pullback overnight
    if (overnightStaleRisk(series5m, row.optBuy)) return { keep: false, discardReason: 'posture', rescued };   // stale/underwater by morning
  }
  return { keep: true, discardReason: null, rescued };
}
