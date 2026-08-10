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
 * assumptions: limit × ACTIONABLE_WINDOWS_PER_DAY (=2 since 2026-08-08; this line said 6 until
 * 2026-08-10) windows/day, a 10% volume share, a noisy modeNet). The score still layers the
 * same risk-quality MULTIPLIER ∈ (0,1] built from real computeQuote fields (regime stability, last-2h
 * momentum, two-sided liquidity / exit-ease, and — for band modes — band-trade consistency): score =
 * rank × geomean(factors). (G2, PLAN-GRADE-REWORK 2026-07-21 — O3: the capital-commitment factor was
 * DELETED — see capitalFactor's removal note. Ben's ruling: at current capital big-ticket lanes must not
 * be penalized for per-unit price. NOTE this approved SUBSET ships the DELETION only — the deployable-
 * capital rank fold that would have made the rank capital-aware is DEFERRED (out of scope here), so the
 * rank stays per-unit for now; the deletion just removes the old per-unit-price haircut, it does not add a
 * replacement capital term.) The four remaining factors combine as a GEOMETRIC MEAN (G4, O6), not the raw
 * product, so the sub-1 haircuts no longer compound into an over-harsh discount. OVERLAP NOTES: (1) pFill/
 * TTF and the liq factor both touch fill-ease — KEPT (liq carries two-sided-exit quality the rank's pFill
 * alone doesn't). (2) the breakdown-MOMENTUM double-count was REMOVED (G4): a `mom==='breakdown'` row was
 * discounted BOTH here (momFactor ×0.45) AND inside the rank (pFillIntraday's PFILL_BREAKDOWN_PENALTY); we
 * kept only the rank's copy and dropped momFactor's breakdown branch, so it now fires exactly once. Cutoffs
 * are placeholders (Ben-vetoable).
 *
 * STATUS: weights + grade cutoffs below are PLACEHOLDERS on the NEW rank basis (a per-unit/day rate,
 * so the cutoff NUMBERS differ in scale from the old gp/day ones). Deliberately un-tuned — the retro-
 * join (pipeline/lib/retrojoin.mjs) + F1 calibrate them from realized fills. Don't cite as calibrated.
 *
 * FOUR-CAP CHAIN (G1, PLAN-GRADE-REWORK — Fix F, 2026-07-21). rateItem is the ONE home for the grade
 * caps: thin (gp-flow honesty) → phase-basing (a rescued basing-after-decay faller) → sub-floor (a
 * fallback row that didn't clear the floors) → reach (a mirage exit). They apply in that fixed order
 * (harshest last wins) via applyGradeCaps, which also names the last-binding cap in `cappedBy` (R7).
 * Before G1 only the thin cap lived here and the other three were stacked at the screen render site — a
 * returned grade was provisional (Flaw 7). Callers pass the cap VALUES in (phaseCap/subFloorCap/reachFrac/
 * reachExempt); omitting them = the pre-G1 thin-only path, byte-identical.
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

// Last-2h momentum (pre-clamp tell from computeQuote). Breakup = fresh 2h high → mild chase-risk.
// (G4, PLAN-GRADE-REWORK — O6: the BREAKDOWN branch was REMOVED here to kill a double-count. A live 2h
// breakdown was penalized TWICE off the identical `mom==='breakdown'` signal — once as this ×0.45
// multiplier and again inside the RANK via pFillIntraday's PFILL_BREAKDOWN_PENALTY (estimators/families.mjs).
// We keep ONE home: pFillIntraday's, because it's inside the rank the score already multiplies by. So a
// breakdown is now discounted exactly once, end-to-end. momFactor keeps ONLY the breakup chase-risk
// branch, which nothing else covers.)
export function momFactor(row) {
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

// (G2, PLAN-GRADE-REWORK — O3: capitalFactor DELETED.) It used to apply a gentle per-unit-price haircut
// (1m→1.0, 10m→0.85, ~46m→0.6) as a crude "capital committed" proxy. Ben's ruling (2026-07-21): at
// current capital we deploy into multiple big-ticket lanes at once, so a big-ticket must NOT be penalized
// for per-unit price. The haircut is removed outright (the Flaw-9 double-penalty by deletion). The
// deployable-capital RANK fold that would have replaced it as the one capital consideration is DEFERRED
// (out of this approved subset) — so today the rank is unchanged (per-unit) and there is simply no capital
// term in the multiplier at all.

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

   NY2.4 — DIFFERENT "thin"s, don't conflate them (now THREE, since G6). This cap keys off the screen's `thin` flag,
   which is the GP-FLOW-ONLY ADMISSION PATH: `limitVol < FLOOR` (3500/day — **this said 50/day until
   2026-08-10**, i.e. 70× stale, at the very site that DEFINES the rule; PLAN-VOL24 step 2 recalibrated
   FLOOR 50 → 3500 against the corrected rolling-24h volume) AND admitted only because
   `limitVol×mid ≥ GP_FLOOR` (screen-flip-niches.mjs gateCandidates). That is the ONLY `thin` that caps a grade,
   and it is capped every time it reaches rateItem (both the niche and watchlist paths pass it). It is
   NOT the same label as suggestlog's coarse `liqClass` 'thin' (`volDay < 100`) written to the `class`
   field of suggestions.jsonl. Because `volDay == limitVol == min(hpv,lpv)`, an item with volume in
   [50, 100)/day is `liqClass:'thin'` (logged) yet NOT gp-flow-thin (limitVol ≥ 50) → it grades ON
   MERIT and can legitimately log `class:'thin', verdict:'S+'` (the Armadyl-crossbow case that looked
   like a cap escape — it isn't; the cap never applied). No code gap; the ledger's `class` is just a
   coarser vocabulary than the screen's admission `thin`.
   THE THIRD "thin" (G6, below): the CONFIDENCE marker (`thinConfidence` / `(thin)` on the letter) keys off
   the pFill reach SAMPLE `n` < CONF_THIN_N_FLOOR — "the fill call rests on thin evidence." It MARKS the
   letter, never caps or shrinks it, and is independent of BOTH the gp-flow admission `thin` (a liquidity
   fact) and suggestlog's `liqClass` (a volume bucket). Three triggers, one label — the tooltip says which. */
export const THIN_GRADE_CAP = 'A-';

/* G6 (PLAN-GRADE-REWORK — Fix E, reshaped by O5): a `(thin)` CONFIDENCE MARKER — mark, don't shrink.
   O5's ruling: do NOT perturb the score with an empirical-Bayes shrinkage (a magic number that silently
   moves a real grade). Instead, when the EVIDENCE behind a row's fill call is thin, annotate the letter
   with `(thin)` — the score/letter itself is UNCHANGED, fully deterministic (no interaction with G5's TTF
   term). This is a THIRD "thin" (see the NY2.4 note above): the gp-flow THIN_GRADE_CAP CAPS the letter;
   this confidence-thin only MARKS it; they share a label, not a trigger.

   O5 INVESTIGATION (Ben's question "shouldn't we be using our percentile measurements here?") — DONE
   before coding, per the plan; the finding drives the trigger:
   • `placement` (js/windowread.mjs) is `count(≤x)/n` — a price's PERCENTILE POSITION in the printed
     distribution ("62% of daily highs sat at/below this ask"). It is PURELY DESCRIPTIVE of WHERE a level
     sits, explicitly NOT how many observations back it (the module header says so outright). So placement
     is ORTHOGONAL to confidence — a p85 ask is not more/less certain, it's just higher in the band.
   • Distribution SHAPE (IQR width) is orthogonal too: the fill call is a PROPORTION estimate
     (reachedDays/nDays); the uncertainty of a proportion is governed by the SAMPLE SIZE n (binomial SE ~
     √(p(1−p)/n)), not by how wide the price band is. A wide IQR changes the reach MAGNITUDE, not the
     confidence in the proportion. So the right confidence signal is the reach/pFill sample `n` (nDays),
     and placement/IQR do NOT feed the trigger.
   • We key the marker off the pFill `n` (the measured reach evidence). We deliberately do NOT fold in the
     TTF `n`: Flaw 5 established TTF is ALWAYS the prior in production (n=0 on every row), so a min(pFillN,
     ttfN) trigger would mark EVERYTHING and carry no signal. The pFill reach read (n up to ~14 on a
     surfaced screen survivor; 0 for a prior-only/band-depth call) is the honest confidence dimension.
   CONF_THIN_N_FLOOR is a NAMED PLACEHOLDER (n≈0) — the shape of "few observations", not a tuned bar. */
export const CONF_THIN_N_FLOOR = 5;   // pFill (reach) sample below this ⇒ the fill call is thin evidence → mark the letter (n≈0 placeholder)
// Proposal B (PLAN-GRADE-REACH): a headline-grade CEILING when the quoted ASK/exit reaches < REACH_GRADE_CAP_FRAC
// of recent days. Proposal A already shrinks the RANK NUMBER for a mirage exit; this guarantees the LETTER an
// operator reads can't oversell it either (a 2/14-reach S+ ask can't advertise an S/A grade). Applied INSIDE
// rateItem's four-cap chain (applyGradeCaps, G1) alongside THIN_GRADE_CAP / PHASE_BASING_GRADE_CAP / SUBFLOOR_GRADE_CAP.
// PLACEHOLDER cutoff+cap (rule 4: n≈14 ask reach) — the frac mirrors the reachValidator caution band
// (validate.mjs REACH_CAUTION_FRAC 0.5); F1/retro-join calibrates both against realized sell latency.
export const REACH_GRADE_CAP = 'B';
export const REACH_GRADE_CAP_FRAC = 0.5;
export function capGrade(grade, cap) {
  const order = GRADE_CUTOFFS.map(([g]) => g);
  const gi = order.indexOf(grade), ci = order.indexOf(cap);
  return (gi >= 0 && ci >= 0 && gi < ci) ? cap : grade;   // gi<ci ⇒ grade is BETTER than the cap → clamp down
}

/* THE FOUR-CAP CHAIN (G1, PLAN-GRADE-REWORK — Fix F). Before G1 rateItem applied ONLY the gp-flow
   THIN_GRADE_CAP internally, and THREE more caps were stacked OUTSIDE it at the screen render site
   (screen-flip-niches.mjs): PHASE_BASING_GRADE_CAP (a rescued basing-after-decay faller),
   SUBFLOOR_GRADE_CAP (a sub-floor fallback row), and REACH_GRADE_CAP (a mirage exit whose ask reaches
   < REACH_GRADE_CAP_FRAC of recent days). A returned grade was therefore PROVISIONAL — the value
   actually shown could differ from what rateItem returned (two sources of truth, Flaw 7). G1 pulls all
   four into ONE documented chain, applied in a FIXED order (best→worst caps last so the harshest cap
   wins): base gradeFor → thin → phase-basing → sub-floor → reach. Each cap is an OPTIONAL input; a
   caller that passes none gets byte-identical behaviour to the pre-G1 thin-only path.
   R7: applyGradeCaps also returns `cappedBy` — the name of the LAST cap that actually LOWERED the letter
   (or null) — so the render site no longer re-derives cap attribution with its own capGrade helper. */
export function applyGradeCaps(grade, { thin = false, phaseCap = null, subFloorCap = null, reachFrac = null, reachExempt = false } = {}) {
  let g = grade, cappedBy = null;
  const step = (ceiling, name) => { if (!ceiling) return; const c = capGrade(g, ceiling); if (c !== g) { g = c; cappedBy = name; } };
  step(thin ? THIN_GRADE_CAP : null, 'thin');
  step(phaseCap, 'phase-basing');
  step(subFloorCap, 'sub-floor');
  // reach cap: a non-exempt (asym-fillShape) row whose quoted ASK reaches < FRAC of recent days can't
  // advertise a headline letter. Exempt (symmetric-fillShape churn) or no read (reachFrac null) → skip.
  if (!reachExempt && reachFrac != null && reachFrac < REACH_GRADE_CAP_FRAC) step(REACH_GRADE_CAP, 'reach');
  return { grade: g, cappedBy };
}

/* rateItem — combine everything into { score, grade, riskMult, factors, cappedBy, thinConfidence }.
   row      : a computeQuote row (regime, rising, mom, volDay, mid)
   rank     : the PER-THESIS rank (net × P(fill) ÷ TTF from estimators.mjs) — the reward magnitude
              (P6b; REPLACED the demoted expGpDay). Missing/0 → a D-grade floor, honestly.
   activeWin / nWin : traded-window count and total windows for the band (null for spread mode)
   thin / phaseCap / subFloorCap / reachFrac / reachExempt : the four-cap chain inputs (G1, above) —
              all optional; omitting them keeps the pre-G1 thin-only behaviour, byte-identical.
   pFillN / ttfN : the estimator sample sizes (G6). pFillN < CONF_THIN_N_FLOOR sets `thinConfidence` — a
              MARKER the render layer shows as `(thin)`; it NEVER changes score/grade/ordering. ttfN is
              accepted for symmetry but NOT used (Flaw 5: ttf n≈0 in production, see CONF_THIN_N_FLOOR). */
export function rateItem({ row, rank, activeWin = null, nWin = null, thin = false,
  phaseCap = null, subFloorCap = null, reachFrac = null, reachExempt = false,
  pFillN = null, ttfN = null }) {
  const factors = {
    regime: regimeFactor(row),
    mom: momFactor(row),
    liq: liqFactor(row.volDay),
    confidence: confidenceFactor(activeWin, nWin),
  };
  // G4 (PLAN-GRADE-REWORK — O6): the risk multiplier is the GEOMETRIC MEAN of the four sub-factors, NOT
  // the raw product. The product compounded four sub-1 haircuts (0.85⁴≈0.52) into an over-harsh discount;
  // the geometric mean (0.85⁴)^¼ = 0.85 softens the compounding without deleting any signal — each factor
  // still pulls the multiplier down, just not multiplicatively. (The fuller 2–3-factor collapse is the
  // DEFERRED G4b, run only if testing shows the geometric mean insufficient — NOT done here.)
  const fv = [factors.regime, factors.mom, factors.liq, factors.confidence];
  const riskMult = Math.pow(fv.reduce((a, b) => a * b, 1), 1 / fv.length);
  const score = Math.round((rank || 0) * riskMult);
  // G1: the four-cap chain (thin → phase-basing → sub-floor → reach) is applied here in ONE place; R7's
  // last-binding-cap attribution (`cappedBy`) is returned so the render site never re-derives it.
  const { grade, cappedBy } = applyGradeCaps(gradeFor(score), { thin, phaseCap, subFloorCap, reachFrac, reachExempt });
  // G6: the confidence MARKER — does not touch score/grade. Only fires when a sample size was actually
  // passed (pFillN != null), so surfaces that don't thread `n` (the app Finder) are never marked.
  const thinConfidence = (typeof pFillN === 'number') && pFillN < CONF_THIN_N_FLOOR;
  return { score, grade, riskMult, factors, thin: !!thin, cappedBy, thinConfidence };
}
