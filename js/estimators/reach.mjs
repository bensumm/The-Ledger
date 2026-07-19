/**
 * estimators/reach.mjs (PC2, 2026-07-17) — the REACH-CONDITIONING helpers, split out of the estimator
 * monolith: reachRelief + its liquidity/size constants, dayHighFrom5m, askReachFactor, asymEstimate.
 * These are consumed by BOTH the family rank (families.mjs estimateRank → askReachFactor) and the
 * reconciliation price estimator (pair.mjs estimatePair → reachRelief/REACH_DEBIAS_MAX_FRAC). PURE:
 * DOM/fetch/fs-free, imports only the money-math helpers + families' estimatorFor/rankScore (a runtime
 * function-reference cycle — ESM-safe, both uses are at call time). See the js/estimators.mjs barrel
 * header for the full family/price-basis doctrine; every constant here is an unvalidated PLACEHOLDER (rule 4).
 */
import { netMargin, clamp } from '../money-math.js';
import { estimatorFor, rankScore, PFILL_ASKREACH_FLOOR } from './families.mjs';   // PC2: asymEstimate ranks via the family estimator; askReachFactor uses the two-leg floor

const clamp01 = x => clamp(x, 0, 1);   // reuse the imported clamp — was a duplicate reimplementation
const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

/* --- PLAN-LIQUIDITY-REACH (2026-07-13) — liquidity/size-conditioned reach relief -------------------
   WHY (Ben, the soul-rune desk investigation): reach measures how OFTEN a price prints, not how much
   of YOUR stock clears when it does. Depth-at-percentile scales with volume, so on a deep book a
   position that is a small fraction of daily flow can realistically target a higher percentile than
   the flat reach discount implies. The relief SOFTENS the ask-reach discount toward 1 ONLY when BOTH
   hold: the book is genuinely liquid (absolute volume floor) AND the position is small relative to
   flow (`sizeRatio = intendedUnits ÷ limiting-side volDay`).
   ⚠ THE HARD CONSTRAINT (non-negotiable): the reach discount exists to catch the thin-big-ticket
   MIRAGE EXIT (the Ancient-godsword 2/14 p90 top that would grade S+ off a mirage). A thin book
   (volDay < REACH_RELIEF_MIN_VOL) or a large relative size (sizeRatio ≥ REACH_RELIEF_SIZE_ZERO) gets
   relief EXACTLY 0 → byte-for-byte today's discount. Size GOVERNS, not liquidity alone — a 500k-unit
   position on a liquid book gets NO relief. Absent inputs → 0 (the absent→1/degrade precedent).
   intendedUnits source (per-surface deciding point, PLACEHOLDER): a HELD-LOT surface (quote-items
   --positions, watch-positions) passes the REAL lot size (positions.json qty) via extra.intendedUnits;
   a discovery/per-item read with no held qty degrades to the BUY LIMIT (the standard per-window
   accumulation proxy). ALL constants are PLACEHOLDERS (n=1 — the soul-rune anchor); F1 owns the
   magnitudes. Relief is monotone in volDay and monotone-decreasing in intendedUnits (pinned by tests).
   REAL-FILL FOLLOWUP (2026-07-17, n≈6 items): a same-session cross-check of positions.json closed
   lots against fills.json suggests the relief-collapse point tracks tranche-size-as-%-of-daily-volume
   more tightly than these thresholds currently encode (clean under ~0.5%, visibly degraded ~0.7–1%,
   gone by ~5–7% — Raw anglerfish's oversized tranche was a net loss after tax). Small-n, not yet
   folded into these constants; full writeup + numbers: `/scan` SKILL.md's "Asymmetric ask-reach
   read" bullet — don't duplicate here, this is a pointer only.
   POINTER: that measured degradation knee (~0.5–1% of daily volume, n≈6 study) sits BELOW the coded
   REACH_RELIEF_SIZE_FULL of 2% — i.e. the constant is looser than the evidence; F1 owns tightening it. */
export const REACH_RELIEF_MIN_VOL   = 100_000;   // limiting-side vol/d floor — below it relief is EXACTLY 0 (the mirage guard)
export const REACH_RELIEF_FULL_VOL  = 1_000_000; // vol/d at which the liquidity factor saturates to 1
export const REACH_RELIEF_SIZE_FULL = 0.02;      // sizeRatio at/below which the size factor is 1 (position ≪ flow)
export const REACH_RELIEF_SIZE_ZERO = 0.10;      // sizeRatio at/above which relief is EXACTLY 0 (size governs)
export const REACH_RELIEF_MAX       = 0.75;      // max fraction of the remaining discount relief may erase — NEVER all of it
export const REACH_DEBIAS_MAX_FRAC  = 0.5;       // Part B: max fraction of the (observed-24h-high − band-top) gap the top reference may widen by

export function reachRelief({ intendedUnits, volDay } = {}) {
  const v = num(volDay), u = num(intendedUnits);
  if (v == null || u == null || v <= 0 || u <= 0) return 0;          // absent/degenerate inputs → no relief (byte-identical)
  if (v < REACH_RELIEF_MIN_VOL) return 0;                            // thin book → the FULL existing discount stands
  const ratio = u / v;
  if (ratio >= REACH_RELIEF_SIZE_ZERO) return 0;                     // large relative size → NO relief (size governs)
  const liq  = clamp01((v - REACH_RELIEF_MIN_VOL) / (REACH_RELIEF_FULL_VOL - REACH_RELIEF_MIN_VOL));
  const size = clamp01((REACH_RELIEF_SIZE_ZERO - ratio) / (REACH_RELIEF_SIZE_ZERO - REACH_RELIEF_SIZE_FULL));
  return clamp01(REACH_RELIEF_MAX * liq * size);
}

/* dayHighFrom5m(ts5m, {hours}) → the max 5m-bucket avgHighPrice over the trailing `hours` (default 24h),
   anchored to the series' own last timestamp (unix SECONDS) so tests/replays are deterministic; a
   timestamp-less series degrades to the last hours×12 buckets. Part B's HONEST de-bias reference: the
   wiki data exposes NO raw-tick period max (the /24h endpoint returns only avgHighPrice + volumes; every
   series field is a bucket AVERAGE), so the least-smoothed high actually retrievable is the 5m bucket
   average — closer to the true peaks a resting LIMIT ask fills at than the 1h avgHighPrice the reach
   read is built on, but still an average (documented, not oversold). Null when no high ever printed. */
export function dayHighFrom5m(ts5m, { hours = 24 } = {}) {
  const s = Array.isArray(ts5m) ? ts5m.filter(p => p && num(p.avgHighPrice) != null) : null;
  if (!s || !s.length) return null;
  const stamped = s.filter(p => num(p.timestamp) != null);
  let pts = s;
  if (stamped.length) {
    let maxTs = -Infinity; for (const p of stamped) if (p.timestamp > maxTs) maxTs = p.timestamp;
    pts = stamped.filter(p => p.timestamp >= maxTs - hours * 3600);
  } else pts = s.slice(-Math.round(hours * 12));
  let hi = null;
  for (const p of pts) if (hi == null || p.avgHighPrice > hi) hi = p.avgHighPrice;
  return hi;
}

// two-leg fill weight (Proposal A, PLAN-GRADE-REACH) — the family pFill above is the BID/ENTRY fill; the
// rank's `net` silently ASSUMES the exit at optSell prints. Discount that by the cross-day ASK reach so a
// mirage exit (e.g. a p90 band top reaching 2/14 days) can't carry a full rank. ABSENT an ask-reach read →
// 1 (byte-identical to the pre-askReach rank). Softened linear map: reachFrac 0 → PFILL_ASKREACH_FLOOR,
// 1 → 1 — a stale fortnight demotes, never zeroes (the false-negative guard for the n≈14 window).
// PLAN-LIQUIDITY-REACH: the optional `relief` (reachRelief's [0,1] output) moves the discount toward 1 —
// factor' = factor + relief×(1−factor) — for a LIQUID book where the position is small vs flow. Default
// 0 ⇒ byte-identical to the flat map; a thin book computes relief 0 so its mirage discount is untouched.
// DELIBERATELY NOT WIRED INTO estimateRank yet (F1-gated): the rank feeds the published grade/sort
// (screen.json), so promoting relief into the rank/letter is held for F1 calibration — today the relief
// consumers are the est-view price fold (estimatePair) + the stdout reach notes only.
export function askReachFactor(askReach, relief = 0) {
  const a = askReach || null;
  if (!a || !(num(a.nDays) > 0) || num(a.reachedDays) == null) return 1;
  const frac = clamp01(a.reachedDays / a.nDays);
  const base = clamp01(PFILL_ASKREACH_FLOOR + (1 - PFILL_ASKREACH_FLOOR) * frac);
  const r = clamp01(num(relief) ?? 0);
  return r > 0 ? clamp01(base + r * (1 - base)) : base;
}

/* --- asymmetric fill-shape estimate (PART II, PLAN-GRADE-REACH §II.1 — deep-buy / reliable-sell) ---
   Ben's mandate: "I'd much rather hit a 2/14 buy and a 12/14 sell than 50/50 both sides." The
   asymmetric rank re-targets the objective at the pair js/windowread.mjs asymPair derives (deep flush
   bid → high-reach ask, day-level quantiles) instead of the symmetric intraday p10/p90 band pair:
       asymRank = net(deepBid → highReachAsk) × P_ask ÷ TTF
   THE KEY NUANCE — P_bid NEVER multiplies the rank. A rare deep fill is a FEATURE (deeper entry =
   larger net, and the bigger net already carries that value); punishing a low bid-reach would re-punish
   exactly the entry the shape wants. P_bid is returned as an annotation ("fills ~N/14 — rest it as
   optionality", the patience-on-cancel-and-cut doctrine), never a weight. P_ask IS the fill weight —
   the exit is the flip's big assumption (Part I's whole diagnosis).
   ORDERING GUARDS (§II.2): the pair returned keeps bid ≤ quickBuy and ask ≥ quickSell (the min/max
   guards), so a quoted asym pair can never break optBuy ≤ quickBuy ≤ quickSell ≤ optSell. When the ask
   guard BINDS (live instabuy above the high-reach level) the exit is a transact-now sell, so the
   reported pAsk (measured at the unguarded quantile) is a floor, not exact — documented, not patched
   (F1 calibrates). The momentum tell (rawBandLo/rawBandHi) is quotecore's and is untouched here.
   STATUS (§II.3): SHIP-SAFE half = display + shadow-log this estimate (screen/quote inform lines +
   the suggestions.jsonl `asym` field). The repricing/sort flip is F1-GATED behind screen-flip-niches.mjs --asym
   (OFF by default). ASYM_P_LO/ASYM_P_HI (windowread) are PLACEHOLDERS, n≈14 (rule 4). */
export function asymEstimate(spec, row = {}, asym = null) {
  if (!asym || num(asym.deepBid) == null || num(asym.highReachAsk) == null) return null;
  const bid = num(row.quickBuy) != null ? Math.min(row.quickBuy, asym.deepBid) : asym.deepBid;
  const ask = num(row.quickSell) != null ? Math.max(row.quickSell, asym.highReachAsk) : asym.highReachAsk;
  // the ONE shared netMargin; BOND exception rides through row.bond/row.guide exactly like estimateRank.
  const net = netMargin(bid, ask, row.bond ? { bond: true, guide: row.guide } : null);
  const ttf = estimatorFor(spec).ttf({ volDay: row.volDay ?? null });
  const pAsk = clamp01(num(asym.pAsk) ?? 0);
  const pBid = clamp01(num(asym.pBid) ?? 0);
  return { bid, ask, net, pAsk, pBid, nDays: asym.nDays ?? null, ttf, rank: rankScore({ net, pFill: pAsk, ttfSec: ttf.value }) };
}
