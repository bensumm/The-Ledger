#!/usr/bin/env node
/**
 * symmetric-matching.test.mjs — SM1 (PLAN-SYMMETRIC-MATCHING): matchTrades pairs sell->buy into a
 * closed KEEP ROUND TRIP, gated on the owned-items 'keep' set.
 *
 * Fake data is built at RUNTIME here (offers constructed inline); nothing is read from or written to
 * the real owned-items.json / fills.json / positions.json. Same discipline as reverse-flip-cli.test.mjs.
 *
 * Run: `node pipeline/test/symmetric-matching.test.mjs`.
 */
import assert from 'node:assert/strict';
import { matchTrades, GE_TAX, SHORT_MAX_AGE_DAYS } from '../lib/reconstruct/reconstruct.mjs';
import { keepIds, keepMisclassificationRisks } from '../lib/capital/ownedledger.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const KEEP = 27238;      // stands in for a bank keep
const COMMODITY = 5952;  // stands in for a normal flip item
let ts = 1_000_000;
/* H1: matchTrades settles an UNDECLARED short older than SHORT_MAX_AGE_DAYS, so a fixture states its
   clock — atNow() reads the last-issued fixture ts, keeping every SM1 book below young. */
const atNow = () => ({ keeps, now: ts + 1 });
/* offer — a filled GE offer as collapseOffers would emit it. `spent` is gross; each = spent/filled. */
const offer = (type, itemId, qty, each) => ({ type, itemId, filled: qty, spent: qty * each, tsOpen: ts += 100 });
const store = { items: [{ id: KEEP, name: 'Keep item', classification: 'keep' },
                        { id: COMMODITY, name: 'Commodity', classification: 'flip' }] };
const keeps = keepIds(store);

/* --- the gate ------------------------------------------------------------------------------------ */
ok('keepIds returns only classification:keep', () => {
  assert.equal(keeps.has(KEEP), true);
  assert.equal(keeps.has(COMMODITY), false);
});

ok('a NON-keep sell with no open lot stays unmatched (never opens a short)', () => {
  const r = matchTrades([offer('sell', COMMODITY, 10, 7000)], atNow());
  assert.equal(r.unmatched.length, 1, 'lands in unmatched');
  assert.equal(r.awaitingRebuy.length, 0, 'no short opened');
  assert.equal(r.closed.length, 0);
});

ok('a KEEP sell with no open lot opens a pending short, not unmatched', () => {
  const r = matchTrades([offer('sell', KEEP, 1, 78_140_000)], atNow());
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.awaitingRebuy.length, 1);
  const s = r.awaitingRebuy[0];
  assert.equal(s.itemId, KEEP);
  assert.equal(s.qty, 1);
  assert.equal(s.sellEach, 78_140_000);
  // beRebuy = soldEach - tax(soldEach); 2% of 78.14m = 1,562,800
  assert.equal(s.beRebuy, 76_577_200, 'break-even on the capital reallocation');
});

/* --- the round trip ------------------------------------------------------------------------------ */
ok('sell -> buy closes a keepRoundTrip with the correct realised P/L', () => {
  const r = matchTrades([offer('sell', KEEP, 1, 78_140_000), offer('buy', KEEP, 1, 75_290_000)], atNow());
  assert.equal(r.awaitingRebuy.length, 0, 'short fully drained');
  assert.equal(r.open.length, 0, 'the rebuy did NOT leak a phantom open lot');
  assert.equal(r.closed.length, 1);
  const c = r.closed[0];
  assert.equal(c.keepRoundTrip, true, 'tagged intent-neutrally');
  assert.equal(c.reverseFlip, undefined, 'never asserts an intent the log cannot supply');
  assert.equal(c.sellEach, 78_140_000);
  assert.equal(c.buyEach, 75_290_000);
  // 78,140,000 - 1,562,800 tax - 75,290,000 = 1,287,200 (the real Masori body figure, SM0 Result B)
  assert.equal(c.realised, 1_287_200);
});

ok('a partial rebuy drains only part of the short and leaves the rest pending', () => {
  const r = matchTrades([offer('sell', KEEP, 3, 1000), offer('buy', KEEP, 1, 900)], atNow());
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].qty, 1);
  assert.equal(r.awaitingRebuy.length, 1);
  assert.equal(r.awaitingRebuy[0].qty, 2, 'remaining legs stay open');
});

ok('a buy LARGER than the short closes it and opens a lot with the remainder', () => {
  const r = matchTrades([offer('sell', KEEP, 1, 1000), offer('buy', KEEP, 3, 900)], atNow());
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].qty, 1);
  assert.equal(r.awaitingRebuy.length, 0);
  assert.equal(r.open.length, 1);
  assert.equal(r.open[0].qty, 2, 'excess becomes ordinary flip inventory');
});

ok('an ordinary buy->sell flip on a keep is UNAFFECTED (lot consumed first, no short)', () => {
  const r = matchTrades([offer('buy', KEEP, 1, 900), offer('sell', KEEP, 1, 1000)], atNow());
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].keepRoundTrip, undefined, 'a normal flip is not a round trip');
  assert.equal(r.awaitingRebuy.length, 0);
});

/* --- backward compatibility ---------------------------------------------------------------------- */
ok('omitting `keeps` restores exact pre-SM1 behavior (direct callers unaffected)', () => {
  const offers = [offer('sell', KEEP, 1, 78_140_000), offer('buy', KEEP, 1, 75_290_000)];
  const r = matchTrades(offers);   // no options — campaigns.mjs / join-outcomes.mjs shape
  assert.equal(r.closed.length, 0, 'no round trip booked');
  assert.equal(r.unmatched.length, 1, 'sell falls through to unmatched as before');
  assert.equal(r.awaitingRebuy.length, 0);
  assert.equal(r.open.length, 1, 'the buy opens an ordinary lot');
});

/* --- the §5.1 hygiene guard ---------------------------------------------------------------------- */
ok('keepMisclassificationRisks flags a keep with many CASH flips', () => {
  const closed = Array.from({ length: 12 }, () => ({ itemId: KEEP, realised: 1 }));
  const risks = keepMisclassificationRisks(store, closed, { threshold: 10 });
  assert.equal(risks.length, 1);
  assert.equal(risks[0].id, KEEP);
  assert.equal(risks[0].closedFlips, 12);
});

ok('hygiene guard ignores round-trip and withdrawn rows, and non-keeps', () => {
  const closed = [
    ...Array.from({ length: 20 }, () => ({ itemId: KEEP, keepRoundTrip: true })),  // round trips don't count
    ...Array.from({ length: 20 }, () => ({ itemId: KEEP, withdrawn: true })),      // withdrawals don't count
    ...Array.from({ length: 20 }, () => ({ itemId: COMMODITY })),                  // not a keep
  ];
  assert.deepEqual(keepMisclassificationRisks(store, closed, { threshold: 10 }), []);
});

/* --- SLT (PLAN-SALE-LOG-TAX): net-convention sells through the SHORTS path ----------------------- */
// The `.json`-era log records a sell's `spent` NET of tax (worthNet:true on the collapsed offer).
// Fixture numbers are the real Armadyl crossbow row (§4): listed gross 37,099,995, logged net
// 36,357,996 (tax 741,999), rebought at 36,151,000 → true realised +206,996 (booked −520,163 pre-fix).
const GROSS = 37_099_995, NET = 36_357_996, REBUY = 36_151_000;
const netSell = (itemId, qty, netEach) => ({ type: 'sell', itemId, filled: qty, spent: qty * netEach, worthNet: true, tsOpen: ts += 100 });

ok('net-convention KEEP sell opens a short at the recovered gross; beRebuy = the net proceeds', () => {
  const r = matchTrades([netSell(KEEP, 1, NET)], atNow());
  assert.equal(r.awaitingRebuy.length, 1);
  const s = r.awaitingRebuy[0];
  assert.equal(s.sellEach, GROSS, 'sellEach is the true sale price, recovered by inversion');
  assert.equal(s.tax, GROSS - NET, 'tax is the true per-item floor of the gross, not a re-tax of the net');
  assert.equal(s.beRebuy, NET, 'break-even on the reallocation = exactly what the sale banked');
});

ok('net-convention keep sell -> rebuy closes the round trip at realised = net − rebuy', () => {
  const r = matchTrades([netSell(KEEP, 1, NET), offer('buy', KEEP, 1, REBUY)], atNow());
  assert.equal(r.closed.length, 1);
  const c = r.closed[0];
  assert.equal(c.keepRoundTrip, true);
  assert.deepEqual([c.sellEach, c.buyEach, c.tax, c.realised], [GROSS, REBUY, GROSS - NET, NET - REBUY],
    'the crossbow: +206,996 true, not the double-taxed −520,163');
  assert.equal(c.realised, 206_996);
});

ok('a GROSS keep sell (log/manual era) is byte-identical to pre-fix behavior', () => {
  const r = matchTrades([offer('sell', KEEP, 1, 78_140_000)], atNow());
  const s = r.awaitingRebuy[0];
  assert.deepEqual([s.sellEach, s.tax, s.beRebuy], [78_140_000, GE_TAX(78_140_000), 76_577_200]);
});

/* --- H1 (PLAN-BOOK-SELF-HEAL): the time/price gate, the aged settle, the REVIVE exemption --------
   A rebuy no longer closes a short unconditionally: it must arrive within SHORT_MAX_AGE_DAYS AND at
   or below the short's beRebuy, unless the item is DECLARED (hold-thesis reverseFlip:true) or the
   short was REVIVEd. An undeclared short past the age settles at breakeven into `settled`. */
const DAY = 86_400;
const T0 = 2_000_000_000;                     // fixed base ts — these fixtures assert on ages, not order
const at = (type, itemId, qty, each, tsOpen) => ({ type, itemId, filled: qty, spent: qty * each, tsOpen });
const SOLD = 1000, BE = SOLD - GE_TAX(SOLD);  // beRebuy for a 1000gp gross keep sale

ok('gate: a rebuy INSIDE the window and at/below beRebuy still closes the round trip', () => {
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE, T0 + 3 * DAY)],
    { keeps, now: T0 + 3 * DAY });
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].keepRoundTrip, true);
  assert.equal(r.settled.length, 0);
  assert.equal(r.awaitingRebuy.length, 0);
});

ok('gate REFUSES on AGE: a rebuy past SHORT_MAX_AGE_DAYS settles the short and opens a normal lot', () => {
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE, T0 + 20 * DAY)],
    { keeps, now: T0 + 20 * DAY });
  assert.equal(r.closed.length, 0, 'no round trip stolen from the fresh flip');
  assert.equal(r.open.length, 1, 'the rebuy opens ordinary flip inventory');
  assert.equal(r.settled.length, 1, 'the aged short settled instead of consuming');
  assert.equal(r.awaitingRebuy.length, 0);
  assert.equal(r.refusedCloses.length, 1);
  assert.equal(r.refusedCloses[0].reason, 'age');
});

ok('gate REFUSES on PRICE: a rebuy above beRebuy leaves the short open and opens a lot', () => {
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE + 1, T0 + DAY)],
    { keeps, now: T0 + DAY });
  assert.equal(r.closed.length, 0);
  assert.equal(r.open.length, 1);
  assert.equal(r.awaitingRebuy.length, 1, 'the short stays open — only the close was refused');
  assert.equal(r.settled.length, 0);
  assert.equal(r.refusedCloses.length, 1);
  assert.equal(r.refusedCloses[0].reason, 'price');
});

ok('a DECLARED reverse flip overrides both legs of the gate (old + above beRebuy still closes)', () => {
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE + 50, T0 + 40 * DAY)],
    { keeps, declared: new Set([KEEP]), now: T0 + 40 * DAY });
  assert.equal(r.closed.length, 1, 'the declaration is the intent the log cannot carry');
  assert.equal(r.settled.length, 0, 'a declared short never ages out');
  assert.equal(r.refusedCloses.length, 0);
});

ok('settle books nothing and preserves every revival field', () => {
  const r = matchTrades([at('sell', KEEP, 2, SOLD, T0)], { keeps, now: T0 + 30 * DAY });
  assert.equal(r.awaitingRebuy.length, 0, 'awaitingRebuy empties into settled');
  assert.equal(r.settled.length, 1);
  const s = r.settled[0];
  assert.deepEqual([s.itemId, s.qty, s.sellEach, s.tax, s.beRebuy, s.sellTs, s.reason],
    [KEEP, 2, SOLD, GE_TAX(SOLD) * 2, BE, T0, 'aged-out']);
  assert.equal(r.closed.length, 0, 'no closed row at all — realised 0 by construction, lifetime realised unmoved');
});

// The sweep's settledTs must NOT read the wall clock: two syncs over an unchanged log would then
// write different positions.json, the write-skip could never fire, and --publish would commit churn.
ok('DETERMINISM: a swept settle stamps the AGE EDGE, so repeated runs are byte-identical', () => {
  const offers = [at('sell', KEEP, 1, SOLD, T0)];
  const early = matchTrades(offers, { keeps, now: T0 + 30 * DAY });
  const later = matchTrades(offers, { keeps, now: T0 + 99 * DAY });
  assert.equal(early.settled[0].settledTs, T0 + SHORT_MAX_AGE_DAYS * DAY, 'the edge, not the clock');
  assert.deepEqual(early.settled, later.settled, 'two runs at different clocks agree row-for-row');
});

ok('a mid-match settle keeps the deciding BUY ts (already deterministic — a log fact)', () => {
  const buyTs = T0 + 20 * DAY;
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE, buyTs)], { keeps, now: buyTs + 5 * DAY });
  assert.equal(r.settled[0].settledTs, buyTs);
});

ok('an UNSETTLED young short is untouched by the settle sweep', () => {
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0)], { keeps, now: T0 + 3 * DAY });
  assert.equal(r.awaitingRebuy.length, 1);
  assert.equal(r.settled.length, 0);
});

ok('REVIVE re-arms BOTH exemptions: no aging, and the next rebuy closes regardless of price', () => {
  const revives = [{ itemId: KEEP, target: T0 }];
  const held = matchTrades([at('sell', KEEP, 1, SOLD, T0)], { keeps, revives, now: T0 + 30 * DAY });
  assert.equal(held.settled.length, 0, 'a revived short does not age out');
  assert.equal(held.awaitingRebuy.length, 1);
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE + 500, T0 + 30 * DAY)],
    { keeps, revives, now: T0 + 30 * DAY });
  assert.equal(r.closed.length, 1, 'revived: the rebuy closes it despite age AND price');
  assert.equal(r.refusedCloses.length, 0);
});

ok('a REVIVE naming an absent short is INERT (wrong item, wrong sellTs)', () => {
  const offers = [at('sell', KEEP, 1, SOLD, T0)];
  const wrongItem = matchTrades(offers, { keeps, revives: [{ itemId: COMMODITY, target: T0 }], now: T0 + 30 * DAY });
  const wrongTs = matchTrades(offers, { keeps, revives: [{ itemId: KEEP, target: T0 + 7 }], now: T0 + 30 * DAY });
  const none = matchTrades(offers, { keeps, now: T0 + 30 * DAY });
  assert.deepEqual(wrongItem.settled, none.settled, 'wrong item: settles exactly as if no REVIVE existed');
  assert.deepEqual(wrongTs.settled, none.settled, 'wrong sellTs: same');
});

ok('a null-target REVIVE covers every short on the item (the CLI writes it only when unambiguous)', () => {
  const r = matchTrades([at('sell', KEEP, 1, SOLD, T0)], { keeps, revives: [{ itemId: KEEP, target: null }], now: T0 + 30 * DAY });
  assert.equal(r.settled.length, 0);
  assert.equal(r.awaitingRebuy.length, 1);
});

ok('existing callers are byte-identical on a book whose shorts are young', () => {
  const offers = [at('sell', KEEP, 1, SOLD, T0), at('buy', KEEP, 1, BE, T0 + DAY)];
  const r = matchTrades(offers, { keeps, now: T0 + 2 * DAY });
  assert.deepEqual([r.closed, r.open, r.unmatched, r.awaitingRebuy],
    [[{ itemId: KEEP, qty: 1, buyEach: BE, sellEach: SOLD, tax: GE_TAX(SOLD), realised: 0,
        keepRoundTrip: true, buyTs: T0 + DAY, sellTs: T0 }], [], [], []],
    'the pre-H1 four buckets, unchanged');
  assert.deepEqual([r.settled, r.refusedCloses], [[], []], 'the new buckets are empty');
});

console.log(`\nAll ${pass} checks passed.`);
