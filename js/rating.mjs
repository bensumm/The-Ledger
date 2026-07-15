/* rating.mjs — screen desirability rating + letter grade (chunk 0 of the niche-rating rework).
 *
 * PURPOSE (Ben's framing, 2026-07-03): out of a batch of screened items, "which ones are worth our
 * time putting offers in for?" — SEPARATE the best from the merely-good. The grade is an easy-to-read
 * heuristic ("this S+ is a better flip than this B+"), NOT an absolute gp/hr anchor: two items with
 * different risk / reward / liquidity / capital profiles can legitimately share a grade if their
 * overall desirability nets out similar. If a whole batch clumps at one grade, that is a signal the
 * SCORE lacks dynamic range (fix the factors), not that the letter scale is wrong.
 *
 * REWARD BASIS (P6b — Ben's 2026-07-09 ruling: gp/d is OUT as the ranking metric). The reward
 * magnitude is now the PER-THESIS RANK — `net after tax × P(fill at the quoted pair) ÷ TTF` from
 * pipeline/lib/estimators.mjs — NOT the demoted `expGpDay` (which folded three unmeasured throughput
 * assumptions: limit×6 windows/day, a 10% volume share, a noisy modeNet). The score still layers the
 * same risk-quality MULTIPLIER ∈ (0,1] built from real computeQuote fields (regime stability, last-2h
 * momentum, two-sided liquidity / exit-ease, capital commitment, and — for band modes — band-trade
 * consistency): score = rank × Π(factors). MILD OVERLAP NOTE: pFill/TTF and the liq factor both touch
 * fill-ease; the risk multiplier is kept because regime/momentum/capital/confidence still carry quality
 * signal the rank alone doesn't, and every cutoff here is a placeholder anyway (Ben-vetoable).
 *
 * STATUS: weights + grade cutoffs below are PLACEHOLDERS on the NEW rank basis (a per-unit/day rate,
 * so the cutoff NUMBERS differ in scale from the old gp/day ones). Deliberately un-tuned — the retro-
 * join (pipeline/lib/retrojoin.mjs) + F1 calibrate them from realized fills. Don't cite as calibrated.
 */
import { clamp } from './money-math.js';   // shared clamp — was reimplemented locally (identical arithmetic)

/* --- risk-quality sub-factors (each ∈ (0,1], 1 = no concern) --- */

// Regime stability. Flat = full marks; rising is discounted by froth magnitude (a +5% drift barely
// dents, a +100% reprice is frothy → size-small territory); an unconfirmed regime takes a mild
// haircut. Falling reaches here only via the falling-ACCEPTING specs (P5 scalp/value — `js/flip-niches.mjs`
// `spec.falling`); the default band/spread/rising/churn niches still EXCLUDE fallers before rating.
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

/* --- letter grade from the risk-adjusted RANK (P6b — the rank basis is net × P(fill) ÷ TTF, a
   per-unit/day rate; these cutoffs are on THAT scale, NOT the old gp/day throughput scale, and are
   NAMED PLACEHOLDERS pending calibration from the retro-join). --- */
export const GRADE_CUTOFFS = [
  ['S+', 150_000], ['S', 80_000], ['S-', 40_000],
  ['A+', 20_000], ['A', 10_000], ['A-', 5_000],
  ['B+', 2_500], ['B', 1_200], ['B-', 500],
  ['C', 100], ['D', 0],
];
export function gradeFor(score) {
  for (const [g, t] of GRADE_CUTOFFS) if (score >= t) return g;
  return 'D';
}

/* Thin (gp-flow-only) items — the S1 honesty cap. An item that qualified for the screen via the
   gp-flow path (huge two-sided flow, single-digit unit count) can post a big realistic gp/day and
   would otherwise grade top-tier — but you can only ever move a couple of units a day, so an S/A+
   letter would OVERSELL it. Cap the letter at a mid-scale ceiling regardless of score; the Vol/d
   column + the grade tooltip carry the "~N trades/day — size in units, expect slow fills" caveat.
   (The exit-ease PENALTY itself is already delivered by liqFactor, which reads the low volDay; this
   cap is the separate can-never-be-a-headline-flip ceiling.)

   NY2.4 — two DIFFERENT "thin"s, don't conflate them. This cap keys off the screen's `thin` flag,
   which is the GP-FLOW-ONLY ADMISSION PATH: `limitVol < FLOOR` (50/day) AND admitted only because
   `limitVol×mid ≥ GP_FLOOR` (screen-flip-niches.mjs gateCandidates). That is the ONLY `thin` that caps a grade,
   and it is capped every time it reaches rateItem (both the niche and watchlist paths pass it). It is
   NOT the same label as suggestlog's coarse `liqClass` 'thin' (`volDay < 100`) written to the `class`
   field of suggestions.jsonl. Because `volDay == limitVol == min(hpv,lpv)`, an item with volume in
   [50, 100)/day is `liqClass:'thin'` (logged) yet NOT gp-flow-thin (limitVol ≥ 50) → it grades ON
   MERIT and can legitimately log `class:'thin', verdict:'S+'` (the Armadyl-crossbow case that looked
   like a cap escape — it isn't; the cap never applied). No code gap; the ledger's `class` is just a
   coarser vocabulary than the screen's admission `thin`. */
export const THIN_GRADE_CAP = 'A-';
// Proposal B (PLAN-GRADE-REACH): a headline-grade CEILING when the quoted ASK/exit reaches < REACH_GRADE_CAP_FRAC
// of recent days. Proposal A already shrinks the RANK NUMBER for a mirage exit; this guarantees the LETTER an
// operator reads can't oversell it either (a 2/14-reach S+ ask can't advertise an S/A grade). Applied at the
// screen render site via capGrade, exactly like THIN_GRADE_CAP / PHASE_BASING_GRADE_CAP / SUBFLOOR_GRADE_CAP.
// PLACEHOLDER cutoff+cap (rule 4: n≈14 ask reach) — the frac mirrors the reachValidator caution band
// (validate.mjs REACH_CAUTION_FRAC 0.5); F1/retro-join calibrates both against realized sell latency.
export const REACH_GRADE_CAP = 'B';
export const REACH_GRADE_CAP_FRAC = 0.5;
export function capGrade(grade, cap) {
  const order = GRADE_CUTOFFS.map(([g]) => g);
  const gi = order.indexOf(grade), ci = order.indexOf(cap);
  return (gi >= 0 && ci >= 0 && gi < ci) ? cap : grade;   // gi<ci ⇒ grade is BETTER than the cap → clamp down
}

/* rateItem — combine everything into { score, grade, riskMult, factors }.
   row      : a computeQuote row (regime, rising, mom, volDay, mid)
   rank     : the PER-THESIS rank (net × P(fill) ÷ TTF from estimators.mjs) — the reward magnitude
              (P6b; REPLACED the demoted expGpDay). Missing/0 → a D-grade floor, honestly.
   activeWin / nWin : traded-window count and total windows for the band (null for spread mode) */
export function rateItem({ row, rank, activeWin = null, nWin = null, thin = false }) {
  const factors = {
    regime: regimeFactor(row),
    mom: momFactor(row),
    liq: liqFactor(row.volDay),
    capital: capitalFactor(row.mid),
    confidence: confidenceFactor(activeWin, nWin),
  };
  const riskMult = factors.regime * factors.mom * factors.liq * factors.capital * factors.confidence;
  const score = Math.round((rank || 0) * riskMult);
  const grade = thin ? capGrade(gradeFor(score), THIN_GRADE_CAP) : gradeFor(score);
  return { score, grade, riskMult, factors, thin: !!thin };
}
