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
 *   - riskMult is the product of the five sub-factors, and score = round(rank × riskMult).
 *   - momFactor punishes a breakdown (0.45) harder than a breakup (0.9); clean is unpenalized (1.0).
 *
 * P6b: the reward magnitude is the PER-THESIS RANK (net × P(fill) ÷ TTF), NOT the demoted expGpDay.
 * These fixtures pin STRUCTURE/ORDERING on the new basis; the cutoff numbers stay placeholders.
 */
import assert from 'node:assert/strict';
import {
  rateItem, gradeFor, capGrade, momFactor, regimeFactor, liqFactor, capitalFactor,
  confidenceFactor, GRADE_CUTOFFS, THIN_GRADE_CAP,
} from '../lib/rating.mjs';

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

// --- 4. riskMult = Π(factors) and score = round(expGpDay × riskMult) ----------------------
ok('riskMult is the product of the five sub-factors; score = round(rank × riskMult)', () => {
  const row = { regime: { ok: true, driftPct: 0 }, rising: false, mom: 'breakup', volDay: 200, mid: 8_000_000 };
  const rankIn = 1_234_567;
  const r = rateItem({ row, rank: rankIn, activeWin: 6, nWin: 12 });
  const expected = regimeFactor(row) * momFactor(row) * liqFactor(row.volDay)
    * capitalFactor(row.mid) * confidenceFactor(6, 12);
  assert.equal(r.riskMult, expected, 'riskMult is exactly the product of the five factors');
  assert.equal(r.score, Math.round(rankIn * expected), 'score is round(rank × riskMult)');
  // and each factor ∈ (0,1] so the multiplier can only ever discount the reward.
  assert.ok(r.riskMult > 0 && r.riskMult <= 1);
});

// --- 5. momFactor punishes breakdown harder than breakup ----------------------------------
ok('momFactor: breakdown (0.45) is punished harder than breakup (0.9); clean = 1.0', () => {
  assert.equal(momFactor({ mom: 'breakdown' }), 0.45);
  assert.equal(momFactor({ mom: 'breakup' }), 0.9);
  assert.equal(momFactor({ mom: 'clean' }), 1.0);
  assert.ok(momFactor({ mom: 'breakdown' }) < momFactor({ mom: 'breakup' }), 'breakdown penalized more');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
