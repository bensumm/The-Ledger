#!/usr/bin/env node
/**
 * cashderive.test.mjs — acceptance fixtures for the DERIVED idle-cash model (lib/cashderive.mjs,
 * PLAN-CASH-TRACKING). Cash is conserved; deriveCash reconstructs it from the fills-log flow + a
 * live-offers escrow + an anchor, so Ben never re-states a number the log already implies.
 *
 * Pins: the realized-flow math (sell net after tax − buy spent, gated to AFTER the anchor), the
 * escrow-from-LIVE-offers rule (a stale phantom open bid in fills.json must NOT count), the
 * partial-fill no-double-count guard, banked/withdraw carrying no cash, and the INJECTION DETECTOR
 * (reserved bids > tracked balance → inferred capital add, availableCash floored at 0).
 *
 * PURE-function test — synthetic events/offers only, no fetch/fs, no live ledger (CLAUDE.md rule 4).
 * Run: `node pipeline/cashderive.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { deriveCash, restingBuyEscrow } from './lib/cashderive.mjs';
import { GE_TAX } from './lib/reconstruct.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_700_000_000;                 // an arbitrary epoch-second base
const ANCHOR_TS = T0;                      // anchor stated at T0
const anchor = { cashGp: 100_000_000, statedAt: new Date(ANCHOR_TS * 1000).toISOString() };
// a completed offer collapses from a single terminal event; ts is epoch SECONDS
const ev = (ts, slot, type, state, price, qty, filled, spent) =>
  ({ ts, slot, itemId: 1000 + slot, type, state, price, qty, filled, spent });
const buyOffer = (price, qty, filled) => ({ side: 'buy', price, qty, filled });

console.log('cashderive — derived idle-cash model:');

/* --- 1. normal derive: anchor + sell(net, after tax) − buy(spent), only AFTER the anchor ------------- */
ok('realized flow nets sells after tax and subtracts buys', () => {
  const each = 1_000_000;
  const sellSpent = each * 100;                                  // gross proceeds
  const sellNet = sellSpent - GE_TAX(each) * 100;                // after 2% tax
  const events = [
    ev(T0 + 60, 0, 'sell', 'complete', each, 100, 100, sellSpent),
    ev(T0 + 90, 1, 'buy', 'complete', 500_000, 20, 20, 10_000_000),
  ];
  const r = deriveCash(events, anchor, []);
  assert.equal(r.known, true);
  assert.equal(r.sellIn, sellNet);
  assert.equal(r.buyOut, 10_000_000);
  assert.equal(r.netFlow, sellNet - 10_000_000);
  assert.equal(r.liquidCapital, 100_000_000 + sellNet - 10_000_000);
  assert.equal(r.availableCash, r.liquidCapital);               // nothing resting → equal
  assert.equal(r.inferredInjection, 0);
});

/* --- 2. flow BEFORE the anchor is excluded ----------------------------------------------------------- */
ok('a fill settled before the anchor does not move the balance', () => {
  const events = [ev(T0 - 300, 0, 'sell', 'complete', 1_000_000, 10, 10, 10_000_000)];
  const r = deriveCash(events, anchor, []);
  assert.equal(r.netFlow, 0);
  assert.equal(r.liquidCapital, 100_000_000);
});

/* --- 3. escrow comes from LIVE offers, never from a stale phantom open bid in fills.json -------------- */
ok('a phantom open bid in the fill log does NOT count as escrow (live offers are authoritative)', () => {
  // an old placement whose cancel/expire terminal was never logged → collapseOffers sees it open, filled 0
  const events = [ev(T0 + 60, 3, 'buy', 'placed', 5_000_000, 1, 0, 0)];
  const r = deriveCash(events, anchor, []);                     // live book: nothing resting
  assert.equal(r.reserved, 0);
  assert.equal(r.restingN, 0);
  assert.equal(r.availableCash, 100_000_000);
});

/* --- 4. partial-fill no-double-count: filled leg = spend, unfilled leg = escrow, never both ---------- */
ok('a partially-filled resting buy books its filled spend once and reserves only the remainder', () => {
  const events = [ev(T0 + 60, 2, 'buy', 'partial', 1_000_000, 100, 40, 40_000_000)]; // 40/100 filled
  const live = [buyOffer(1_000_000, 100, 40)];                  // same offer, 60 remaining
  const r = deriveCash(events, anchor, live);
  assert.equal(r.buyOut, 40_000_000);                           // filled leg only
  assert.equal(r.reserved, 60_000_000);                         // unfilled remainder only
  assert.equal(r.liquidCapital, 100_000_000 - 40_000_000);      // cancel returns the reserve
  assert.equal(r.availableCash, r.liquidCapital - 60_000_000);  // coin stack excludes the reserve
});

/* --- 5. banked (pre-owned) and withdraw (personal use) carry NO cash flow ----------------------------- */
ok('banked and withdraw are not cash movements', () => {
  const events = [
    ev(T0 + 60, 0, 'banked', 'complete', 1_000_000, 50, 50, 50_000_000),
    ev(T0 + 90, 1, 'withdraw', 'complete', 1_000_000, 10, 10, 10_000_000),
  ];
  const r = deriveCash(events, anchor, []);
  assert.equal(r.buyN, 0);
  assert.equal(r.sellN, 0);
  assert.equal(r.netFlow, 0);
  assert.equal(r.liquidCapital, 100_000_000);
});

/* --- 6. INJECTION DETECTOR: resting bids exceed the tracked balance → inferred capital add ------------ */
ok('reserved > liquidCapital infers an injection and floors availableCash at 0', () => {
  const small = { cashGp: 10_000_000, statedAt: anchor.statedAt };
  const live = [buyOffer(15_000_000, 1, 0)];                    // a 15m bid against a 10m tracked balance
  const r = deriveCash([], small, live);
  assert.equal(r.reserved, 15_000_000);
  assert.equal(r.inferredInjection, 5_000_000);                 // raise the anchor to fit
  assert.equal(r.liquidCapital, 15_000_000);
  assert.equal(r.availableCash, 0);
});

/* --- 7. no anchor → known:false, balances null (flow + escrow still reported) ------------------------- */
ok('a null anchor yields known:false with null balances', () => {
  const r = deriveCash([], null, [buyOffer(2_000_000, 1, 0)]);
  assert.equal(r.known, false);
  assert.equal(r.liquidCapital, null);
  assert.equal(r.availableCash, null);
  assert.equal(r.reserved, 2_000_000);                          // context still computed
});

/* --- 8. restingBuyEscrow ignores sells and zero-remainder buys --------------------------------------- */
ok('restingBuyEscrow sums only unfilled buy-side remainders', () => {
  const { reserved, restingN } = restingBuyEscrow([
    buyOffer(1_000_000, 10, 3),                                 // 7 remaining → 7m
    { side: 'sell', price: 9_000_000, qty: 1, filled: 0 },      // a resting ASK reserves no cash
    buyOffer(2_000_000, 5, 5),                                  // fully filled → 0
  ]);
  assert.equal(reserved, 7_000_000);
  assert.equal(restingN, 1);
});

console.log(`\ncashderive: ${pass} checks passed.`);
