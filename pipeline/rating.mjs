/* rating.mjs — screen desirability rating + letter grade (chunk 0 of the niche-rating rework).
 *
 * PURPOSE (Ben's framing, 2026-07-03): out of a batch of screened items, "which ones are worth our
 * time putting offers in for?" — SEPARATE the best from the merely-good. The grade is an easy-to-read
 * heuristic ("this S+ is a better flip than this B+"), NOT an absolute gp/hr anchor: two items with
 * different risk / reward / liquidity / capital profiles can legitimately share a grade if their
 * overall desirability nets out similar. If a whole batch clumps at one grade, that is a signal the
 * SCORE lacks dynamic range (fix the factors), not that the letter scale is wrong.
 *
 * The score blends ONE reward magnitude (expGpDay — realistic expected gp/day, which already folds in
 * liquidity via its volume-share cap) with a risk-quality MULTIPLIER ∈ (0,1] built from real
 * computeQuote fields: regime stability, last-2h momentum, two-sided liquidity / exit-ease, capital
 * commitment (per-unit ticket size), and — for band-based modes — how consistently the intraday band
 * actually traded. score = expGpDay × Π(factors). All inputs are REAL computeQuote output (never a
 * proxy) — the pre-filter may approximate to pick the fetch pool, but a displayed grade is always
 * built from a real quote.
 *
 * STATUS: weights + grade cutoffs below are PLACEHOLDERS. They are deliberately un-tuned — the
 * Chunk-C validation study (see the pre-filter plan) sets them from multi-day evidence, same
 * discipline as everywhere in this repo. Don't cite these numbers as calibrated.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* --- risk-quality sub-factors (each ∈ (0,1], 1 = no concern) --- */

// Regime stability. Flat = full marks; rising is discounted by froth magnitude (a +5% drift barely
// dents, a +100% reprice is frothy → size-small territory); an unconfirmed regime takes a mild
// haircut. Falling never reaches here — the screen excludes fallers before rating.
export function regimeFactor(row) {
  if (!row.regime || !row.regime.ok) return 0.85;                 // unconfirmed / too little history
  if (row.rising) return clamp(0.9 - (row.regime.driftPct - 5) / 95 * 0.4, 0.5, 0.9); // +5%→0.9 … +100%→0.5
  return 1.0;                                                      // flat
}

// Last-2h momentum (pre-clamp tell from computeQuote). Breakdown = live price broke below its own 2h
// floor → don't buy a pullback (heavy penalty). Breakup = fresh 2h high → mild chase-risk. Clean = ok.
export function momFactor(row) {
  if (row.mom === 'breakdown') return 0.45;
  if (row.mom === 'breakup') return 0.9;
  return 1.0;
}

// Liquidity / exit-ease. Saturating in the limiting-side daily volume: at the practical floor (~50/d)
// you can barely exit → 0.5; by ~5000/d it's a deep two-sided market → 1.0.
export function liqFactor(volDay) {
  if (!volDay || volDay <= 0) return 0.5;
  const F0 = 50, F1 = 5000;
  return clamp(0.5 + 0.5 * Math.log10(volDay / F0) / Math.log10(F1 / F0), 0.5, 1);
}

// Capital commitment. Gentle penalty for big-ticket per-unit price: a 15m item ties up more gp per
// slot and is costlier to be wrong on than a 200gp rune. Intentionally mild (Ben: capital differences
// alone shouldn't dominate the grade). No penalty under 1m; ~46m floors at 0.6.
export function capitalFactor(mid) {
  if (!mid || mid <= 1e6) return 1.0;
  return clamp(1 - 0.15 * Math.log10(mid / 1e6), 0.6, 1);         // 1m→1.0, 10m→0.85, ~46m→0.6
}

// Band confidence (band/rising/churn modes). How many of the intraday 5m windows actually traded
// two-sided — a band stitched from a few spikes is less trustworthy than one traded every window.
// Null (spread mode, no band) → no adjustment.
export function confidenceFactor(activeWin, nWin) {
  if (activeWin == null || !nWin) return 1.0;
  return clamp(0.6 + 0.4 * activeWin / nWin, 0.6, 1);
}

/* --- letter grade from the risk-adjusted score (PLACEHOLDER cutoffs, in risk-adjusted gp/day) --- */
export const GRADE_CUTOFFS = [
  ['S+', 2_000_000], ['S', 1_000_000], ['S-', 600_000],
  ['A+', 350_000], ['A', 200_000], ['A-', 120_000],
  ['B+', 70_000], ['B', 40_000], ['B-', 20_000],
  ['C', 8_000], ['D', 0],
];
export function gradeFor(score) {
  for (const [g, t] of GRADE_CUTOFFS) if (score >= t) return g;
  return 'D';
}

/* rateItem — combine everything into { score, grade, riskMult, factors }.
   row      : a computeQuote row (regime, rising, mom, volDay, mid)
   expGpDay : the screen's realistic expected gp/day for this item (the reward magnitude)
   activeWin / nWin : traded-window count and total windows for the band (null for spread mode) */
export function rateItem({ row, expGpDay, activeWin = null, nWin = null }) {
  const factors = {
    regime: regimeFactor(row),
    mom: momFactor(row),
    liq: liqFactor(row.volDay),
    capital: capitalFactor(row.mid),
    confidence: confidenceFactor(activeWin, nWin),
  };
  const riskMult = factors.regime * factors.mom * factors.liq * factors.capital * factors.confidence;
  const score = Math.round((expGpDay || 0) * riskMult);
  return { score, grade: gradeFor(score), riskMult, factors };
}
