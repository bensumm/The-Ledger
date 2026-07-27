#!/usr/bin/env node
/**
 * rating.test.mjs — acceptance fixtures for the screen grade/score model (pipeline/lib/rating.mjs).
 *
 * Colocated NEXT TO its subject in pipeline/lib/ (this file also proves the run-tests.mjs runner
 * discovers tests recursively, not just at pipeline/'s top level). rating.mjs is PURE — fixtures
 * are synthetic computeQuote-shaped rows, no live data (CLAUDE.md rule 4).
 * Run: `node pipeline/lib/rating.test.mjs`  (exits non-zero on any failure).
 *
 * NOTE: the grade CUTOFF NUMBERS in rating.mjs are explicit PLACEHOLDERS (un-tuned pending the
 * validation study). These fixtures pin STRUCTURE and ORDERING only — never "a specific gp/d = an A".
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - A gp-flow-thin item never grades above A- no matter how high its score (the S1 honesty cap).
 *   - capGrade only ever clamps a grade DOWN toward the cap; it never promotes a worse grade up.
 *   - gradeFor is monotonic: a higher score is never assigned a worse letter.
 *   - riskMult is the GEOMETRIC MEAN of the FOUR sub-factors (G2 deleted capital; G4 geomean), and
 *     score = round(rank × riskMult).
 *   - momFactor punishes a breakup (0.9); clean is unpenalized (1.0); a breakdown is NO LONGER penalized
 *     in the multiplier (G4 moved the single breakdown penalty into the rank's pFill).
 *   - the four grade caps (thin → phase-basing → sub-floor → reach) live inside rateItem (G1), harshest
 *     cap wins, and rateItem returns the R7 last-binding `cappedBy` attribution.
 *   - the G6 `(thin)` confidence marker fires off a thin pFill sample `n` and NEVER moves score/grade/order.
 *
 * P6b: the reward magnitude is the PER-THESIS RANK (net × P(fill) ÷ TTF), NOT the demoted expGpDay.
 * These fixtures pin STRUCTURE/ORDERING on the new basis; the cutoff numbers stay placeholders.
 */
import assert from 'node:assert/strict';
import {
  rateItem, gradeFor, capGrade, applyGradeCaps, momFactor, regimeFactor, liqFactor,
  confidenceFactor, GRADE_CUTOFFS, THIN_GRADE_CAP, REACH_GRADE_CAP, REACH_GRADE_CAP_FRAC,
  CONF_THIN_N_FLOOR,
} from '../lib/signal/rating.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// grade → rank in the canonical order (0 = best). Lower rank = better letter.
const ORDER = GRADE_CUTOFFS.map(([g]) => g);
const rank = g => ORDER.indexOf(g);

// A clean, flat, liquid, cheap row → every risk factor is ~1.0 (so score ≈ expGpDay).
const idealRow = { regime: { ok: true, driftPct: 0 }, rising: false, mom: 'clean', volDay: 5000, mid: 1000 };

console.log('rating.js grade/score acceptance:');

// --- 1. gp-flow-thin never grades above the A- cap ----------------------------------------
ok('a gp-flow-thin item never grades above A- regardless of score (THIN_GRADE_CAP)', () => {
  const huge = rateItem({ row: idealRow, rank: 50_000_000, thin: true });   // would be S+ on merit
  assert.equal(gradeFor(huge.score), 'S+', 'un-capped this score is top tier');
  assert.equal(huge.grade, THIN_GRADE_CAP, 'the thin cap clamps the displayed grade to A-');
  assert.ok(rank(huge.grade) >= rank(THIN_GRADE_CAP), 'never better than the cap');
  // a thin item that would already grade BELOW the cap is untouched (rank well under the A- cutoff).
  const small = rateItem({ row: idealRow, rank: 2_000, thin: true });
  assert.equal(small.grade, gradeFor(small.score), 'thin cap only clamps, never lifts a sub-cap grade');
});
// R7 (PLAN-SIGNAL-RECENCY): rateItem names the THIN cap in `cappedBy` only when it actually BOUND.
ok('R7: rateItem.cappedBy names "thin" when the thin cap bound the letter, else null', () => {
  const bound = rateItem({ row: idealRow, rank: 50_000_000, thin: true });   // S+ clamped to A-
  assert.equal(bound.cappedBy, 'thin', 'the thin cap bound the printed letter → cappedBy "thin"');
  const notBound = rateItem({ row: idealRow, rank: 2_000, thin: true });      // already below the cap
  assert.equal(notBound.cappedBy, null, 'thin flag but the grade was already ≤ cap → no binding → null');
  const notThin = rateItem({ row: idealRow, rank: 50_000_000, thin: false }); // never capped
  assert.equal(notThin.cappedBy, null, 'a non-thin row is never thin-capped → null');
});

// --- 2. capGrade only clamps down, never promotes -----------------------------------------
ok('capGrade clamps a better grade down to the cap, never promotes a worse one', () => {
  assert.equal(capGrade('S+', 'A-'), 'A-', 'better-than-cap → clamped to cap');
  assert.equal(capGrade('B', 'A-'), 'B', 'already worse than the cap → unchanged (never promoted)');
  assert.equal(capGrade('A-', 'A-'), 'A-', 'equal to cap → unchanged');
});

// --- 3. gradeFor is monotonic in score ----------------------------------------------------
ok('gradeFor is monotonic: a higher score is never a worse letter', () => {
  let prevRank = Infinity;
  for (let score = 0; score <= 3_000_000; score += 5_000) {
    const r = rank(gradeFor(score));
    assert.ok(r <= prevRank, `score ${score} graded ${gradeFor(score)} — worse than a lower score`);
    prevRank = r;
  }
  // spot the endpoints of the placeholder scale (structure, not a calibrated gp/d claim).
  assert.equal(gradeFor(0), 'D', 'floor of the scale');
  assert.equal(gradeFor(1e12), 'S+', 'far above the top cutoff → top letter');
});

// --- 4. G4: riskMult = GEOMETRIC MEAN of the FOUR factors; score = round(rank × riskMult) ---------
ok('G4: riskMult is the geometric mean of the four factors (capital deleted, not the raw product); score = round(rank × riskMult)', () => {
  const row = { regime: { ok: true, driftPct: 0 }, rising: false, mom: 'breakup', volDay: 200, mid: 8_000_000 };
  const rankIn = 1_234_567;
  const r = rateItem({ row, rank: rankIn, activeWin: 6, nWin: 12 });
  const fv = [regimeFactor(row), momFactor(row), liqFactor(row.volDay), confidenceFactor(6, 12)];
  const expected = Math.pow(fv.reduce((a, b) => a * b, 1), 1 / fv.length);
  assert.equal(r.riskMult, expected, 'riskMult is exactly the geometric mean of the four factors');
  assert.equal(r.score, Math.round(rankIn * expected), 'score is round(rank × riskMult)');
  // the geometric mean SOFTENS the compounding — it is never below the raw product for sub-1 factors.
  const product = fv.reduce((a, b) => a * b, 1);
  assert.ok(r.riskMult >= product - 1e-12, 'geomean ≥ product (less harsh than the old compounding)');
  // capital is no longer a factor — a big-ticket per-unit price no longer haircuts the multiplier (O3).
  assert.equal(r.factors.capital, undefined, 'the capital factor is gone from the product');
  // and each factor ∈ (0,1] so the multiplier can only ever discount the reward.
  assert.ok(r.riskMult > 0 && r.riskMult <= 1);
});
// G2/O3: a big-ticket row no longer takes the old ~0.6× capitalFactor haircut — its grade is set purely
// by its rank × the (capital-free) multiplier. Two rows identical but for `mid` grade identically.
ok('G2: capitalFactor deleted — a big-ticket mid no longer haircuts the grade', () => {
  const base = { regime: { ok: true, driftPct: 0 }, rising: false, mom: 'clean', volDay: 5000 };
  const cheap = rateItem({ row: { ...base, mid: 1_000 }, rank: 300_000 });
  const bigTicket = rateItem({ row: { ...base, mid: 46_000_000 }, rank: 300_000 });
  assert.equal(cheap.riskMult, bigTicket.riskMult, 'per-unit price no longer moves the multiplier');
  assert.equal(cheap.grade, bigTicket.grade, 'the big-ticket grades identically to the cheap one now');
});

// --- 5. G4: momFactor no longer double-counts a breakdown ----------------------------------
ok('G4: momFactor drops the breakdown branch (kept in the rank\'s pFill) — breakup 0.9, clean/breakdown 1.0', () => {
  assert.equal(momFactor({ mom: 'breakup' }), 0.9, 'breakup chase-risk kept (nothing else covers it)');
  assert.equal(momFactor({ mom: 'clean' }), 1.0);
  assert.equal(momFactor({ mom: 'breakdown' }), 1.0, 'breakdown no longer penalized in the MULTIPLIER (moved to the rank)');
  // end-to-end: a breakdown must not perturb the risk multiplier — the discount lives ONLY in the rank now,
  // so rateItem's riskMult is identical for a breakdown vs a clean row at the same inputs (penalized once).
  const base = { regime: { ok: true, driftPct: 0 }, rising: false, volDay: 5000, mid: 1000 };
  const clean = rateItem({ row: { ...base, mom: 'clean' }, rank: 10_000 });
  const brk   = rateItem({ row: { ...base, mom: 'breakdown' }, rank: 10_000 });
  assert.equal(clean.riskMult, brk.riskMult, 'the multiplier no longer double-penalizes a breakdown');
});

// --- 6. G1: the four-cap chain lives inside rateItem, applied in a fixed order (Fix F) ------------
ok('G1: rateItem applies phase/subFloor/reach caps internally, harshest cap wins, order pinned', () => {
  // a would-be S+ score that trips TWO caps at once. The chain must land on whichever is HARSHER
  // (further down GRADE_CUTOFFS), not order-of-arrival.
  const base = { row: idealRow, rank: 50_000_000 };
  const uncapped = rateItem(base);
  assert.equal(gradeFor(uncapped.score), 'S+', 'uncapped this score is top tier');
  // reach cap alone (asym, mirage exit): a frac below FRAC clamps to REACH_GRADE_CAP.
  const reachOnly = rateItem({ ...base, reachFrac: REACH_GRADE_CAP_FRAC - 0.1, reachExempt: false });
  assert.equal(reachOnly.grade, REACH_GRADE_CAP, 'a mirage-exit row caps at REACH_GRADE_CAP');
  assert.equal(reachOnly.cappedBy, 'reach', 'R7: the reach cap is named as the binder');
  // symmetric-fillShape (churn) is EXEMPT from the reach cap even with a bad frac.
  const exempt = rateItem({ ...base, reachFrac: 0, reachExempt: true });
  assert.equal(exempt.grade, 'S+', 'a reach-exempt row ignores the reach cap');
  // phase-basing cap ('B') + a WORSE sub-floor cap ('D') → the harsher sub-floor wins.
  const two = rateItem({ ...base, phaseCap: 'B', subFloorCap: 'D' });
  assert.equal(two.grade, 'D', 'the harsher of two simultaneous caps wins');
  assert.equal(two.cappedBy, 'sub-floor', 'R7: the last (harshest) binding cap is named');
  // applyGradeCaps is the pure engine and matches an explicit hand-chained capGrade sequence.
  const hand = capGrade(capGrade(capGrade(capGrade('S+', THIN_GRADE_CAP), 'B'), 'A-'), REACH_GRADE_CAP);
  assert.equal(applyGradeCaps('S+', { thin: true, phaseCap: 'B', subFloorCap: 'A-', reachFrac: 0, reachExempt: false }).grade, hand,
    'applyGradeCaps == the fixed thin→phase→subFloor→reach capGrade chain');
  // and a no-cap call is byte-identical to plain gradeFor (the pre-G1 default path).
  assert.equal(rateItem(base).grade, gradeFor(uncapped.score), 'no caps passed → plain gradeFor');
});

// --- 7. G6: the (thin) confidence MARKER — mark, don't shrink (Fix E / O5) ------------------------
ok('G6: a thin-n row is flagged thinConfidence; a high-n row at the IDENTICAL score is not', () => {
  const base = { row: idealRow, rank: 300_000 };
  const thinN = rateItem({ ...base, pFillN: CONF_THIN_N_FLOOR - 1 });
  const richN = rateItem({ ...base, pFillN: 14 });
  assert.equal(thinN.thinConfidence, true, 'few reach days → thin confidence');
  assert.equal(richN.thinConfidence, false, 'a well-measured reach → not thin');
  // the MARKER assertion: the score AND the letter are byte-identical — only the flag differs.
  assert.equal(thinN.score, richN.score, 'the score is untouched by the marker');
  assert.equal(thinN.grade, richN.grade, 'the LETTER is untouched by the marker (mark, not shrink)');
});
ok('G6: the marker never fires when no sample size is passed (app Finder path stays unmarked)', () => {
  const r = rateItem({ row: idealRow, rank: 300_000 });   // no pFillN
  assert.equal(r.thinConfidence, false, 'no n passed → never marked');
  // ttfN is accepted but never triggers the marker on its own (Flaw 5: ttf n≈0 in production).
  const r2 = rateItem({ row: idealRow, rank: 300_000, ttfN: 0 });
  assert.equal(r2.thinConfidence, false, 'a zero ttfN alone does not mark (only pFillN drives the trigger)');
});
ok('G6: the marker does not alter grade ORDERING (two rows keep their score order regardless of the flag)', () => {
  const hi = rateItem({ row: idealRow, rank: 300_000, pFillN: 1 });   // thin-flagged
  const lo = rateItem({ row: idealRow, rank: 100_000, pFillN: 14 });  // not flagged
  assert.ok(hi.score > lo.score, 'the higher-rank row still scores higher despite carrying the thin flag');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
