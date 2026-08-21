#!/usr/bin/env node
/**
 * admit-skip-asym.test.mjs — PP0: the `admitSkip` ledger row must carry the SAME asym evidence a
 * surfaced row carries.
 *
 * WHY THIS FILE EXISTS. screen-flip-niches.mjs deliberately LOGS the rows `spec.admitMinNet` drops
 * rather than censoring them, and its comment at the ledger site says why: they are "the rows where
 * the two estimators disagree most, which is exactly the sample Ring-3's 'does forward beat the fold'
 * gate needs". The two estimators in that sentence are the reach-fold pair (estBuy/estSell) and the
 * ASYM pair. The skip entry logged only the first. Every `admitSkip` row written before this fix
 * carried NO asym field — so the sample the comment promises could not answer the question it was
 * kept for, and no existing test could see it, because the shortfall was a MISSING FIELD at a call
 * site rather than wrong logic. The mirror-image guard for the gate itself is admit-min-net.test.mjs;
 * this one guards the LEDGER.
 *
 * §A is a SOURCE SCAN, on the same reasoning as reality-render-coverage.test.mjs §A and
 * check-imports.mjs: the write happens inside renderMode, which is not exported and does live
 * fetches, so there is no fixture path to it in CI. A source scan cannot prove the field serialises
 * correctly — §B does that against the real reshaper — but it does prove the call site was not
 * dropped or "simplified", which is the exact regression class this file exists to prevent.
 * §B pins the pure end of the same wiring: absent evidence must stay ABSENT, never a fabricated pair.
 *
 * NON-VACUITY. All three §A cases were confirmed RED against the pre-PP0 copy of
 * pipeline/commands/screen-flip-niches.mjs (`git show HEAD:` at HEAD = 7cc495e) before this file was
 * committed, and the mutant each case kills is named inline. A test that passes both ways is not a
 * regression test.
 *
 * WHAT THIS DOES NOT COVER: that rows in the wild carry the field. The scan does live fetches and
 * appends to a pipeline-owned artifact, so that is the manual run recorded in the chunk report.
 *
 * Run: `node pipeline/test/admit-skip-asym.test.mjs`. Auto-discovered by run-tests.mjs. PURE/synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { asymPair } from '../../js/windowread.mjs';
import { asymEstimate } from '../../js/estimators/reach.mjs';
import { FLIP_NICHES } from '../../js/flip-niches.mjs';
import { suggestionEntry, asymShadow } from '../lib/render/suggestlog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN = readFileSync(join(HERE, '..', 'commands', 'screen-flip-niches.mjs'), 'utf8');

// --- §A the two call sites -----------------------------------------------------------------------

test('A1 the admitMinNet drop THREADS asymEr onto the retained row', () => {
  // MUTANT: revert to `skippedRows.push({ row, id: s.id, est: estShown })` — red. Without the thread
  // the ledger site below has nothing to log, which is how the field went missing in the first place:
  // asymEr is computed in the same `for (const s of survivors)` iteration and was simply not carried.
  assert.match(SCREEN, /skippedRows\.push\(\{[^}]*\basymEr\b[^}]*\}\)/,
    'the spec.admitMinNet drop must carry asymEr onto skippedRows');
});

test('A2 the admitSkip ledger entry logs the asym shadow, via the SHARED reshaper', () => {
  // MUTANT: delete `asym: asymShadow(r.asymEr)` from the .concat(skippedRows.map(…)) entry — red.
  const skipBlock = SCREEN.match(/admitSkip: 'below-shown-net',[\s\S]{0,400}?\}\)\)\)\);/);
  assert.ok(skipBlock, 'sanity: the admitSkip ledger entry is still recognisable in source');
  assert.match(skipBlock[0], /asym: asymShadow\(r\.asymEr\)/,
    'the dropped row must log the same asym shadow a surfaced row logs');
});

test('A3 there is exactly ONE asym reshaper, used by both the surfaced and the skipped entry', () => {
  // MUTANT: hand-roll a second inline reshaper at the skip site (or import a copy) — red. Two homes
  // for the shape is how a joined field silently stops being comparable across the two row classes.
  const uses = SCREEN.match(/asymShadow\(/g) || [];
  assert.equal(uses.length, 2, 'exactly two call sites: the surfaced row and the admitSkip row');
  assert.match(SCREEN, /import \{[^}]*\basymShadow\b[^}]*\} from '\.\.\/lib\/render\/suggestlog\.mjs'/,
    'asymShadow is imported from the ONE home, never redefined locally');
});

// --- §B the pure end: present stays present, absent stays absent ---------------------------------

// A 14-day stats fixture shaped like windowStats' output (lows/his/days), wide enough that the 0.25
// flush quantile and the 0.8 high-reach quantile land on genuinely different levels.
const stats14 = {
  days: Array.from({ length: 14 }, (_, i) => i),
  lows: [900, 905, 910, 915, 920, 925, 930, 935, 940, 945, 950, 955, 960, 965],
  his: [1000, 1010, 1020, 1030, 1040, 1050, 1060, 1070, 1080, 1090, 1100, 1110, 1120, 1130],
};
const skipRow = { quickBuy: 940, quickSell: 1040, volDay: 50000 };

test('B a band row dropped by admitMinNet logs a POPULATED asym pair', () => {
  // MUTANT: log `asym: null` unconditionally at the skip site — red. This is the whole point of PP0:
  // the dropped row is the one whose two estimators disagree, so its asym pair is the evidence.
  const asymEr = asymEstimate(FLIP_NICHES.band, skipRow, asymPair(stats14));
  assert.ok(asymEr, 'sanity: the fixture produces a real asym estimate');
  // wired exactly as the skip site wires it
  const e = suggestionEntry(skipRow, { itemId: 27652, cls: 'liquid', verdict: null, grade: null,
    admitSkip: 'below-shown-net', asym: asymShadow(asymEr) });
  assert.equal(e.admitSkip, 'below-shown-net');
  assert.ok('asym' in e, 'a dropped band row must carry the asym field — this IS the PP0 guarantee');
  assert.equal(e.asym.bid, asymEr.bid);
  assert.equal(e.asym.ask, asymEr.ask);
  assert.ok(e.asym.n >= 5, 'the day count rides along so a joiner can weight the read');
});

test('B a CHURN row reaches the same gate with no asym read — and logs NOTHING, not a zero pair', () => {
  // MUTANT: `asym: asymShadow(r.asymEr) || { bid: 0, ask: 0 }`, or defaulting the reshape on null — red.
  // asymEr is only computed on fillShape:'asym' niches (band/scalp); churn reaches the gate with null.
  // Absent evidence must not become a fabricated value — the same rule admit-min-net.test.mjs's
  // "an ABSENT net never drops a row" case pins on the gate side.
  assert.equal(FLIP_NICHES.churn.fillShape, 'symmetric', 'premise: churn never computes an asym read');
  assert.equal(asymShadow(null), null);
  const e = suggestionEntry(skipRow, { itemId: 1, cls: 'liquid', verdict: null, grade: null,
    admitSkip: 'below-shown-net', asym: asymShadow(null) });
  assert.ok(!('asym' in e), 'no asym read ⇒ the field is ABSENT (the YS2 lean pattern), never null-shaped junk');
  assert.equal(e.admitSkip, 'below-shown-net', 'the row is still logged — only the evidence is absent');
});

test('B the skipped row and a surfaced row reshape IDENTICALLY off the same asymEr', () => {
  // MUTANT: round/trim the shadow differently at the skip site — red. The two row classes are joined
  // against each other; a different shape on one side makes the comparison unreadable.
  const asymEr = asymEstimate(FLIP_NICHES.band, skipRow, asymPair(stats14));
  const surfaced = suggestionEntry(skipRow, { itemId: 27652, cls: 'liquid', verdict: 'A', grade: 'A', asym: asymShadow(asymEr) });
  const skipped = suggestionEntry(skipRow, { itemId: 27652, cls: 'liquid', verdict: null, grade: null,
    admitSkip: 'below-shown-net', asym: asymShadow(asymEr) });
  assert.deepEqual(skipped.asym, surfaced.asym);
});
