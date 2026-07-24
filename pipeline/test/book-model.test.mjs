/* book-model.test.mjs — BUSINESS REQUIREMENTS pinned here (PLAN-DASHBOARD chunk 1 + 3):
 *
 * 1. buildBook is PURE and off canned inputs (no fetch/fs) — slots, capital, and per-lot P&L math.
 * 2. SLOTS: each active offer = one occupied slot; free = 8 − occupied (decision 4: a completed-
 *    uncollected slot is simply absent from the offers array → reads as free; carried as slots.caveat).
 * 3. CAPITAL split is byte-identical to watch-positions.mjs's SUMMARY footer for the same input —
 *    workingGp/parkedGp/utilizationPct and the totalCapital split come from the SAME
 *    capital-utilization.mjs functions the footer calls, never a re-derivation (Risk 5 gate).
 * 4. LOTS: breakEven is quotecore's tax-capped breakEven(); unrealPL = qty·(mark−breakEven);
 *    pctToBE = (mark−breakEven)/breakEven; a MISSING mark → null P&L (never fabricated); daysHeld off
 *    the group's oldest-lot buyTs; a stale mark is carried with its stale flag + ageMin (decision 3).
 * 5. SIZER (sizeTranche): min of buy-limit / clearability / capital bounds, `binding` names the min,
 *    each bound can be the binding one; a NULL limit REFUSES (UNKNOWN ≠ unlimited); netIfCycled =
 *    qty·(mark−breakEven).
 */
import assert from 'node:assert/strict';
import { buildBook, sizeTranche, CLEARABILITY_FRAC, TOTAL_SLOTS } from '../lib/book-model.mjs';
import { bookUtilization, totalCapital } from '../lib/capital-utilization.mjs';
import { breakEven } from '../../js/quotecore.js';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const NOW = 1_800_000_000_000;                 // fixed unix-ms "now"
const nowSec = Math.floor(NOW / 1000);

// --- shared fixture: the "leather is 15.6m" book anchor from the plan --------------------------
// Two open lots summing 15,600,000 working capital; a derived-cash record with 3,000,000 resting-bid
// escrow (2m deep + 1m committed) and 4,400,000 free cash.
const GROUPS = [
  { itemId: 100, qty: 10, cost: 5_000_000,  avgCost: 500_000,   buyTs: nowSec - 2 * 86400 }, // 2 days held
  { itemId: 200, qty: 5,  cost: 10_600_000, avgCost: 2_120_000, buyTs: nowSec - 5 * 86400 }, // 5 days held
];
const CASH = {
  known: true, availableCash: 4_400_000, deployablePool: 6_400_000, liquidCapital: 7_400_000,
  reserved: 3_000_000, reservedDeep: 2_000_000, reservedCommitted: 1_000_000, restingDeepN: 1,
};
const OFFERS = [
  { slot: 0, side: 'buy',  itemId: 300, item: 'Bid item',  price: 1000, qty: 100, filled: 0 },
  { slot: 1, side: 'sell', itemId: 100, item: 'Held A',    price: 520000, qty: 10, filled: 3 },
  { slot: 2, side: 'buy',  itemId: 400, item: 'Bid item 2', price: 2000, qty: 50, filled: 10 },
];
const MARKS = new Map([
  [100, { mark: 520_000,   stale: false, ageMin: 3,  name: 'Held A' }],
  [200, { mark: 2_100_000, stale: true,  ageMin: 42, name: 'Held B' }],   // underwater + stale
]);

const book = buildBook({ groups: GROUPS, offers: OFFERS, cash: CASH, marks: MARKS, now: NOW });

// --- slots -------------------------------------------------------------------------------------
ok('slots: each active offer occupies one slot; free = 8 − occupied', () => {
  assert.equal(book.slots.total, TOTAL_SLOTS);
  assert.equal(book.slots.occupied, 3);
  assert.equal(book.slots.free, 5);
  assert.equal(book.slots.occupants.length, 3);
  assert.equal(book.slots.occupants[0].itemId, 300);
  assert.match(book.slots.caveat, /log-derived lower bound/);
});

// --- capital: BYTE-IDENTICAL to the watch-positions.mjs SUMMARY footer (Risk 5 gate) -----------
ok('capital split == watch SUMMARY footer for the same input (Risk 5)', () => {
  // The footer feeds bookUtilization({workingGp: exposure, parkedGp: committed}) + totalCapital({…, cashGp:
  // availableCash}). With the fixture's escrow == committed, exposure=15.6m and committed=3.0m — the SAME
  // numbers buildBook derives — so the two surfaces must agree to the coin.
  const exposure = 15_600_000, committed = 3_000_000;
  const wUtil = bookUtilization({ workingGp: exposure, parkedGp: committed });
  const wTot = totalCapital({ workingGp: exposure, parkedGp: committed, cashGp: CASH.availableCash });
  assert.equal(book.capital.workingGp, exposure);
  assert.equal(book.capital.parkedGp, committed);
  assert.equal(book.capital.utilizationPct, wUtil.utilizationPct);
  assert.equal(book.capital.committedGp, wTot.committedGp);
  assert.equal(book.capital.totalGp, wTot.totalGp);
  assert.equal(book.capital.committedPct, wTot.committedPct);
  assert.equal(book.capital.idlePct, wTot.idlePct);
  // hard-pinned expected integers (not just "same function" — the concrete footer values)
  assert.equal(book.capital.utilizationPct, 84);
  assert.equal(book.capital.committedGp, 18_600_000);
  assert.equal(book.capital.totalGp, 23_000_000);
  assert.equal(book.capital.committedPct, 81);
  assert.equal(book.capital.idlePct, 19);
  // deployable tiers carried verbatim from the cash record (decision 5)
  assert.equal(book.capital.deployablePool, 6_400_000);
  assert.equal(book.capital.availableCash, 4_400_000);
  assert.equal(book.capital.liquidCapital, 7_400_000);
});

// --- lots (per-lot P&L board) ------------------------------------------------------------------
ok('lots: breakEven/unrealPL/pctToBE/daysHeld off quotecore breakEven + the group basis', () => {
  const a = book.lots.find(l => l.itemId === 100);
  const beA = breakEven(500_000);
  assert.equal(a.breakEven, beA);
  assert.equal(a.mark, 520_000);
  assert.equal(a.unrealPL, Math.round(10 * (520_000 - beA)));
  assert.equal(a.pctToBE, (520_000 - beA) / beA);
  assert.equal(a.capTied, 5_000_000);
  assert.equal(a.daysHeld, 2);
  assert.equal(a.stale, false);
  assert.equal(a.ageMin, 3);
});

ok('lots: an underwater + stale lot keeps a negative P&L and its stale/age label', () => {
  const b = book.lots.find(l => l.itemId === 200);
  const beB = breakEven(2_120_000);
  assert.ok(b.unrealPL < 0, 'underwater lot has negative unrealPL');
  assert.equal(b.unrealPL, Math.round(5 * (2_100_000 - beB)));
  assert.equal(b.stale, true);
  assert.equal(b.ageMin, 42);
  assert.equal(b.daysHeld, 5);
});

ok('lots: a lot with NO live mark yields null P&L (never fabricated)', () => {
  const b2 = buildBook({
    groups: [{ itemId: 999, qty: 3, cost: 300_000, avgCost: 100_000, buyTs: null }],
    offers: [], cash: {}, marks: new Map(), now: NOW,
  });
  const lot = b2.lots[0];
  assert.equal(lot.mark, null);
  assert.equal(lot.unrealPL, null);
  assert.equal(lot.pctToBE, null);
  assert.equal(lot.daysHeld, null);       // no buyTs → null, not 0
  assert.equal(lot.breakEven, breakEven(100_000));   // still known (no mark needed)
});

// --- sizer (view 5, chunk 3) -------------------------------------------------------------------
ok('sizer: CAPITAL binds when it is the smallest bound', () => {
  const be = breakEven(100_000);
  const s = sizeTranche({ itemId: 1, name: 'X', capital: 1_000_000, unitCost: 100_000,
    limit: 1000, limitRemaining: 50, dailyVol: 100_000, mark: 110_000, breakEven: be });
  assert.equal(s.capitalBound, 10);              // floor(1,000,000 / 100,000)
  assert.equal(s.buyLimitBound, 50);
  assert.equal(s.clearabilityBound, Math.floor(100_000 * CLEARABILITY_FRAC)); // 500
  assert.equal(s.recommendedQty, 10);
  assert.equal(s.binding, 'capital');
  assert.equal(s.netIfCycled, Math.round(10 * (110_000 - be)));
  assert.equal(s.refuse, false);
});

ok('sizer: BUY-LIMIT binds when remaining is the smallest bound', () => {
  const s = sizeTranche({ itemId: 1, name: 'X', capital: 1_000_000_000, unitCost: 100,
    limit: 1000, limitRemaining: 5, dailyVol: 10_000_000, mark: 120, breakEven: breakEven(100) });
  assert.equal(s.recommendedQty, 5);
  assert.equal(s.binding, 'buy-limit');
});

ok('sizer: CLEARABILITY binds when the daily-volume slice is the smallest bound', () => {
  const s = sizeTranche({ itemId: 1, name: 'X', capital: 1_000_000_000, unitCost: 100,
    limit: 100000, limitRemaining: 100_000, dailyVol: 1000, mark: 120, breakEven: breakEven(100) });
  assert.equal(s.clearabilityBound, Math.floor(1000 * CLEARABILITY_FRAC)); // 5
  assert.equal(s.recommendedQty, 5);
  assert.equal(s.binding, 'clearability');
});

ok('sizer: a NULL limit REFUSES to recommend a qty (UNKNOWN ≠ unlimited)', () => {
  const s = sizeTranche({ itemId: 1, name: 'X', capital: 1_000_000, unitCost: 100,
    limit: null, limitRemaining: null, dailyVol: 100_000, mark: 120, breakEven: breakEven(100) });
  assert.equal(s.refuse, true);
  assert.equal(s.refuseReason, 'unknown-limit');
  assert.equal(s.recommendedQty, null);
  assert.equal(s.binding, null);
});

ok('buildBook threads a sizer input through to sizeTranche', () => {
  const be = breakEven(100_000);
  const withSizer = buildBook({ groups: GROUPS, offers: OFFERS, cash: CASH, marks: MARKS, now: NOW,
    sizer: { itemId: 1, name: 'X', capital: 1_000_000, unitCost: 100_000, limit: 1000,
      limitRemaining: 50, dailyVol: 100_000, mark: 110_000, breakEven: be } });
  assert.equal(withSizer.sizer.recommendedQty, 10);
  assert.equal(withSizer.sizer.binding, 'capital');
});

console.log(`\n${n} book-model assertions passed.`);
