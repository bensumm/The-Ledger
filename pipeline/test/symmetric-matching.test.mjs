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
import { matchTrades } from '../lib/reconstruct/reconstruct.mjs';
import { keepIds, keepMisclassificationRisks } from '../lib/capital/ownedledger.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const KEEP = 27238;      // stands in for a bank keep
const COMMODITY = 5952;  // stands in for a normal flip item
let ts = 1_000_000;
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
  const r = matchTrades([offer('sell', COMMODITY, 10, 7000)], { keeps });
  assert.equal(r.unmatched.length, 1, 'lands in unmatched');
  assert.equal(r.awaitingRebuy.length, 0, 'no short opened');
  assert.equal(r.closed.length, 0);
});

ok('a KEEP sell with no open lot opens a pending short, not unmatched', () => {
  const r = matchTrades([offer('sell', KEEP, 1, 78_140_000)], { keeps });
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
  const r = matchTrades([offer('sell', KEEP, 1, 78_140_000), offer('buy', KEEP, 1, 75_290_000)], { keeps });
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
  const r = matchTrades([offer('sell', KEEP, 3, 1000), offer('buy', KEEP, 1, 900)], { keeps });
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].qty, 1);
  assert.equal(r.awaitingRebuy.length, 1);
  assert.equal(r.awaitingRebuy[0].qty, 2, 'remaining legs stay open');
});

ok('a buy LARGER than the short closes it and opens a lot with the remainder', () => {
  const r = matchTrades([offer('sell', KEEP, 1, 1000), offer('buy', KEEP, 3, 900)], { keeps });
  assert.equal(r.closed.length, 1);
  assert.equal(r.closed[0].qty, 1);
  assert.equal(r.awaitingRebuy.length, 0);
  assert.equal(r.open.length, 1);
  assert.equal(r.open[0].qty, 2, 'excess becomes ordinary flip inventory');
});

ok('an ordinary buy->sell flip on a keep is UNAFFECTED (lot consumed first, no short)', () => {
  const r = matchTrades([offer('buy', KEEP, 1, 900), offer('sell', KEEP, 1, 1000)], { keeps });
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

console.log(`\nAll ${pass} checks passed.`);
