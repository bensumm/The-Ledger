/**
 * patient-cell.test.mjs — PP2 (PLAN-PATIENT-PAIR): the PATIENT alternative inside the BE-floored cell.
 *
 * WHY THIS EXISTS. A row rendered `Est. sell 15.30m (reach-fold floored to BE 15.42m — nothing to price
 * above break-even)` → net -114.7k/u while the `◆ asym fill` footer two lines below read
 * `deep-bid 14.57m → ask 15.30m · net 427k/u`. Same row, same pass. The cell was taken as the verdict
 * and a real ~1.4m trade was dismissed. The information was present and mis-placed.
 *
 * Every case below was confirmed RED against the named mutant before being committed. A case that
 * passes both ways is not a test.
 *
 * Run: `node pipeline/test/patient-cell.test.mjs`. Auto-discovered by run-tests.mjs. PURE/synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePair, estPairCells } from '../../js/estimators.mjs';
import { formatAsymFill } from '../lib/render/emit.mjs';
import { FLIP_NICHES } from '../../js/flip-niches.mjs';

// a BE-floored row: the live pair is flat, so the honest fold lands under break-even.
const FLOORED_ROW = { quickBuy: 15_000_000, quickSell: 15_000_000, optBuy: 14_900_000, optSell: 15_050_000, volDay: 400, limit: 8 };
// a healthy row: a wide live spread the fold clears comfortably.
const OPEN_ROW = { quickBuy: 1000, quickSell: 1600, optBuy: 950, optSell: 1650, volDay: 5000, limit: 100 };
const BASE_EXTRA = { bidReach: { reachedDays: 4, nDays: 14 }, askReach: { reachedDays: 12, nDays: 14 } };
// the UNGUARDED asymPair read; asymEstimate's ordering guards raise the ask off highReachAsk on the
// floored row, which is the 69.7%-of-rows case §2d is about.
const AP = { deepBid: 14_570_000, highReachAsk: 14_800_000, pAsk: 12 / 14, pBid: 4 / 14, nAsk: 14, nBid: 14, nDays: 14 };
const AE = { bid: 14_570_000, ask: 15_300_000, net: 427_000, pAsk: 12 / 14, pBid: 4 / 14, pAskAt: AP.highReachAsk, pBidAt: AP.deepBid, nDays: 14 };

// CONTROL = the pre-PP2 extra, asym pair INCLUDED. `extra.asym` is a pre-existing sell-fold input
// (reach-fold reads highReachAsk), so comparing against an extra without it would measure that instead
// of PP2 — the only difference between CTRL and withAsym() is the two new display-only fields.
const CTRL = { ...BASE_EXTRA, asym: AP };
const withAsym = (ae = AE, ap = AP) => ({ ...CTRL, asym: ap, asymEst: ae, asymFill: formatAsymFill(ae, ap) });
const cellsFor = (row, extra) => estPairCells(estimatePair(FLIP_NICHES.band, row, extra));
const sellText = (row, extra) => cellsFor(row, extra)[1].t;

test('the BE-floored cell carries the patient pair and its net — the defect this chunk exists to fix', () => {
  // MUTANT: drop ${patSeg} from the sell-cell template — red on every assertion here.
  const est = estimatePair(FLIP_NICHES.band, FLOORED_ROW, withAsym());
  assert.equal(est.confidence.beFloored, true, 'fixture must actually be BE-floored');
  const t = estPairCells(est)[1].t;
  assert.match(t, /nothing to price above break-even/, 'the floor caution still stands');
  assert.match(t, / · patient: /, 'the patient alternative is named IN the cell, not only in a footer');
  assert.match(t, /net \+427k\/u/, 'and carries the number the reader was missing');
});

test('the clause is the CALLER\'s formatAsymFill text — cells.mjs never re-derives the wording', () => {
  // MUTANT: in pair.mjs build bidTxt/askTxt inline from extra.asym's prices (`deep-bid X` / `ask Y`)
  // instead of the caller's formatAsymFill clause — red, because the guard-bound phrasing below cannot
  // be reconstructed from the prices alone.
  // §2d: asymEstimate's ask guard binds on 69.7% of rows, so the QUOTED price is not the level pAsk was
  // measured at. formatAsymFill is the ONE home for saying that; PP2 must route through it, not invent.
  const af = formatAsymFill(AE, AP);
  assert.match(af.askTxt, /= live instabuy, above the .* level that printed 12\/14d/, 'fixture must be guard-bound');
  const t = sellText(FLOORED_ROW, withAsym());
  assert.ok(t.includes(af.bidTxt), 'bid clause passed through verbatim');
  assert.ok(t.includes(af.askTxt), 'ask clause passed through verbatim — including the level/price split');
});

test('the patient number never reads as achievable — no execution verb, and the caveat rides with it', () => {
  // MUTANT: delete the ` — resting levels, in-sample counts, not a fill rate` tail — red. The deep bid
  // fills roughly 4 days in 14 and pAsk/pBid are ASYM_P_LO/ASYM_P_HI quantile constants read back
  // (0.86 on 89.9% of 8,300 rows; 0.29 on 86.5%), so the counts are in-sample ranks, not fill rates.
  const t = sellText(FLOORED_ROW, withAsym());
  assert.match(t, /resting levels, in-sample counts, not a fill rate/);
  assert.match(t, /rest as optionality/, 'the bid stays optionality (formatAsymFill\'s own word)');
  assert.doesNotMatch(t, /clears now|will fill|guaranteed/i, 'no execution claim — quotecore measured that false');
});

test('a non-positive patient net prints NOTHING — a losing alternative is not an alternative', () => {
  // MUTANT: drop the `est.patient.net > 0` leg — red. Without it a row where both estimates lose gains a
  // long clause that says nothing, against the one-line-per-item compact-output rule.
  const zero = sellText(FLOORED_ROW, withAsym({ ...AE, net: 0 }));
  const neg = sellText(FLOORED_ROW, withAsym({ ...AE, net: -50_000 }));
  const none = sellText(FLOORED_ROW, CTRL);
  assert.equal(zero, none, 'net 0 renders exactly the pre-PP2 cell');
  assert.equal(neg, none, 'and so does a negative one');
  assert.doesNotMatch(zero, /patient/);
});

test('a NON-BE-floored row is untouched by the asym inputs — every other branch stays byte-identical', () => {
  // MUTANT: drop the `c.beFloored &&` guard on patSeg — red. This is the AC5/AC6 line: PP2 may only
  // change the branch that was wrong, and a healthy row must not grow a second price pair.
  const bare = cellsFor(OPEN_ROW, CTRL);
  const rich = cellsFor(OPEN_ROW, withAsym());
  assert.equal(rich[1].c, undefined, 'fixture must NOT be BE-floored');
  assert.deepEqual(rich, bare, 'all four cells identical with and without the patient inputs');
});

test('the patient block is DISPLAY-ONLY — it never moves a price (rev3 still stands)', () => {
  // MUTANT: fold `extra.asymEst.bid` into estBuy — red. rev3 bars the deep bid from estBuy because that
  // is an expected-price number; a render field is not, and this pins the distinction mechanically.
  const bare = estimatePair(FLIP_NICHES.band, FLOORED_ROW, CTRL);
  const rich = estimatePair(FLIP_NICHES.band, FLOORED_ROW, withAsym());
  for (const k of ['estBuy', 'estSell', 'estNet', 'estRoi', 'be', 'estSellFloorBind', 'pFill']) {
    assert.equal(rich[k], bare[k], `${k} must not move`);
  }
  assert.deepEqual(rich.confidence, bare.confidence, 'confidence is untouched too');
});

test('half the inputs produce NO clause — never a fabricated or half-rendered pair', () => {
  // MUTANT: `extra.asymFill || extra.asymEst` instead of `&&` — red. Either alone would render a clause
  // with a missing net or an undefined text fragment.
  const noFill = estimatePair(FLIP_NICHES.band, FLOORED_ROW, { ...CTRL, asymEst: AE });
  const noEst = estimatePair(FLIP_NICHES.band, FLOORED_ROW, { ...CTRL, asymFill: formatAsymFill(AE, AP) });
  assert.equal(noFill.patient, null);
  assert.equal(noEst.patient, null);
  assert.equal(estPairCells(noFill)[1].t, sellText(FLOORED_ROW, CTRL));
});

test('the UNGUARDED extra.asym alone never produces a clause', () => {
  // MUTANT: build `patient` in pair.mjs from extra.asym (the unguarded pair) rather than the caller's
  // asymEst/asymFill — red. That object has no net and no guard-aware text, so it would print a price
  // pair §2d says is not the level the counts were measured at. CTRL carries extra.asym and nothing else.
  assert.equal(estimatePair(FLIP_NICHES.band, FLOORED_ROW, CTRL).patient, null);
  assert.doesNotMatch(sellText(FLOORED_ROW, CTRL), /patient/);
  // churn (fillShape 'symmetric') gets no asym read from either caller at all — belt and braces.
  assert.doesNotMatch(estPairCells(estimatePair(FLIP_NICHES.churn, FLOORED_ROW, BASE_EXTRA))[1].t, /patient/);
});
