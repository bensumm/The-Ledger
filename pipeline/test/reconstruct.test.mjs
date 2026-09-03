#!/usr/bin/env node
/**
 * reconstruct.test.mjs — acceptance fixtures for the fill-reconstruction money path.
 *
 * reconstruct.mjs is the highest-risk pipeline code with real incident history (phantom
 * open lots, FIFO mis-pairs, snapshot re-emission) but had ZERO fixtures — this file (R1)
 * closes that gap, and P1's snapshot-dedupe fixtures live in the same harness.
 *
 * Like quotecore.test.mjs: the reconstruction functions are PURE (no DOM, no network, no
 * git), so the whole chain is fixture-testable with SYNTHETIC events — no live data.
 * Run: `node pipeline/test/reconstruct.test.mjs`  (exits non-zero on any failure).
 *
 * Coverage:
 *   R1 — buy→sell FIFO close; EMPTY derives no event (inference removed); WITHDRAWN consume; BANKED basis lot;
 *        REMOVE tombstone deleting an already-persisted event; eventId GOLDEN value (guards the
 *        §5.1 eventId()↔eventIdFor() cross-file hash contract).
 *   P1 — snapshot re-emission dedupe: (a) the 2026-07-04 blowpipe-style dup BOUGHT pair dedupes;
 *        (b) a genuine same-price repeat buy with a placement line between terminals does NOT
 *        dedupe; (c) a dup pair straddling an EMPTY-burst login snapshot dedupes.
 *   TD1 — two money-path gaps: a big-ticket close taxes at the 5m CAP per unit inside matchTrades
 *        (not floor(sell·0.02)); collapseOffers folds an incremental partial-fill sequence (same
 *        offer, rising cumulative qty/worth) into ONE lot at the final totals.
 */
import assert from 'node:assert/strict';
import {
  parseJsonLine, buildEvents, reconstruct, eventId, dedupeSnapshots, collapseOffers,
  isNetWorthSource, auditWorthConvention, sellNetEach, GE_TAX,
} from '../lib/reconstruct/reconstruct.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

/* ---------------------------------------------------------------------------
 * Fixture helpers. `raw()` builds ONE Exchange-Logger JSON line object using the
 * RAW field names (item→itemId, offer→price, max→offer-size, qty→cumulative-filled,
 * worth→cumulative-spent — the verified ADAPTER mapping) so the fixtures exercise the
 * real parseJsonLine → buildEvents chain, not a hand-shaped normalized event.
 *   state    — BUYING/SELLING (placement), BOUGHT/SOLD (terminal), WITHDRAWN, BANKED,
 *              CANCELLED_BUY/SELL, EMPTY, or a REMOVE tombstone (via removeLine()).
 * `runPipeline()` mirrors sync-fills.mjs main(): parse each line, split off REMOVE
 * tombstones, sequence via buildEvents, stamp each event's content-hash id.
 * `mergeReconstruct()` mirrors the sync merge (prior ∪ new, dedupe by id, drop tombstoned
 * ids) then reconstructs — so the tombstone fixture deletes an ALREADY-PERSISTED event
 * exactly as the pipeline does.
 * ------------------------------------------------------------------------- */
const raw = ({ state, slot, item, time, date = '2026-07-01',
               filledQty = 0, grossWorth = 0, offerSize = 0, priceEach = 0 }) =>
  ({ date, time, state, slot, item, qty: filledQty, worth: grossWorth, max: offerSize, offer: priceEach });
const removeLine = target => JSON.stringify({ state: 'REMOVE', target });

function runPipeline(rawObjs, parseOpts) {
  const rawParsed = [];
  const removeTargets = new Set();
  for (const o of rawObjs) {
    const line = typeof o === 'string' ? o : JSON.stringify(o);
    const r = parseJsonLine(line, parseOpts);
    if (r && r.remove !== undefined) { if (r.remove) removeTargets.add(r.remove); continue; }
    if (r) rawParsed.push(r);
  }
  const events = buildEvents(rawParsed);
  for (const e of events) e.id = eventId(e);
  return { events, removeTargets };
}
// Mirror of sync-fills.mjs's prior∪new merge + tombstone filter (its lines ~203-227).
function mergeReconstruct(prior, next, removeTargets = new Set()) {
  const byId = new Map();
  for (const e of [...prior, ...next]) byId.set(e.id, e);
  const merged = [...byId.values()].filter(e => !removeTargets.has(e.id)).sort((a, b) => a.ts - b.ts);
  return { merged, pos: reconstruct(merged) };
}

// ============================================================================================
console.log('R1 reconstruction acceptance:');

// --- 1. buy→sell FIFO close ----------------------------------------------------------------
// Two buy lots (10@100, 10@110), then a 15-unit sell @200. FIFO consumes lot A whole + 5 of B.
ok('buy→sell FIFO close (partial second lot, correct after-tax realised)', () => {
  const { events } = runPipeline([
    raw({ state: 'BUYING', slot: 0, item: 100, time: '10:00:00', offerSize: 10, priceEach: 100 }),
    raw({ state: 'BOUGHT', slot: 0, item: 100, time: '10:01:00', filledQty: 10, grossWorth: 1000, offerSize: 10, priceEach: 100 }),
    raw({ state: 'BUYING', slot: 1, item: 100, time: '10:05:00', offerSize: 10, priceEach: 110 }),
    raw({ state: 'BOUGHT', slot: 1, item: 100, time: '10:06:00', filledQty: 10, grossWorth: 1100, offerSize: 10, priceEach: 110 }),
    raw({ state: 'SELLING', slot: 2, item: 100, time: '11:00:00', offerSize: 15, priceEach: 200 }),
    raw({ state: 'SOLD', slot: 2, item: 100, time: '11:01:00', filledQty: 15, grossWorth: 3000, offerSize: 15, priceEach: 200 }),
  ]);
  const { closed, open, unmatched } = reconstruct(events);
  assert.equal(closed.length, 2, 'FIFO split across two buy lots → two closed rows');
  // GE_TAX(200) = floor(200*0.02) = 4/unit.
  assert.deepEqual(
    closed.map(c => [c.qty, c.buyEach, c.sellEach, c.tax, c.realised]),
    [[10, 100, 200, 40, 960], [5, 110, 200, 20, 430]],
  );
  assert.equal(unmatched.length, 0, 'sell fully covered by logged buys → no unmatched');
  assert.deepEqual(open.map(o => [o.itemId, o.qty, o.buyEach]), [[100, 5, 110]], 'lot B remainder stays open');
});

// --- 2. EMPTY derives NO event (inference removed 2026-07-05) -------------------------------
// A buy placed, never filled, slot drops straight to EMPTY (no explicit CANCELLED line):
// the offer's line stays as-logged (NOT retro-marked cancelled — the logout-burst incident:
// an all-slots-EMPTY snapshot while offers were live in-game fabricated phantom cancels).
// Either way a filled=0 offer produces no position.
ok('EMPTY after a placed offer derives no event and no phantom lot', () => {
  const { events } = runPipeline([
    raw({ state: 'BUYING', slot: 0, item: 200, time: '12:00:00', offerSize: 10, priceEach: 50 }),
    raw({ state: 'EMPTY', slot: 0, item: 0, time: '12:10:00' }),
  ]);
  assert.equal(events.length, 1);
  assert.notEqual(events[0].state, 'cancelled', 'no retro-cancel from EMPTY — a running plugin always writes a real terminal');
  const { closed, open, unmatched } = reconstruct(events);
  assert.deepEqual([closed, open, unmatched], [[], [], []], 'a filled=0 offer yields no closed/open/unmatched');
});

// --- 3. WITHDRAWN consume ------------------------------------------------------------------
// Buy 5@100, then WITHDRAWN 3 (personal use): consumes open lots FIFO into realised-0 rows.
ok('WITHDRAWN consumes open lots FIFO at realised 0', () => {
  const { events } = runPipeline([
    raw({ state: 'BOUGHT', slot: 0, item: 300, time: '10:00:00', filledQty: 5, grossWorth: 500, offerSize: 5, priceEach: 100 }),
    raw({ state: 'WITHDRAWN', slot: 8, item: 300, time: '11:00:00', filledQty: 3, offerSize: 3 }),
  ]);
  const { closed, open } = reconstruct(events);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].withdrawn, true);
  assert.equal(closed[0].realised, 0, 'a withdrawal has no sale → realised 0, no invented profit');
  assert.equal(closed[0].tax, 0);
  assert.equal(closed[0].qty, 3);
  assert.equal(closed[0].buyEach, 100);
  assert.deepEqual(open.map(o => [o.qty, o.buyEach]), [[2, 100]], 'the un-withdrawn 2 stay open');
});

// --- 4. BANKED basis lot -------------------------------------------------------------------
// BANK 12 @500 (pre-owned basis), sell 10 @600: banked flag rides the closed row AND the
// leftover open lot; realised computed against the declared basis.
ok('BANKED basis lot enters FIFO tagged, closed + leftover open both carry banked', () => {
  const { events } = runPipeline([
    raw({ state: 'BANKED', slot: 8, item: 400, time: '09:00:00', filledQty: 12, grossWorth: 6000, offerSize: 12, priceEach: 500 }),
    raw({ state: 'SOLD', slot: 0, item: 400, time: '10:00:00', filledQty: 10, grossWorth: 6000, offerSize: 10, priceEach: 600 }),
  ]);
  const { closed, open } = reconstruct(events);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].banked, true);
  // basis each = 6000/12 = 500; sell each = 6000/10 = 600; GE_TAX(600)=12/unit.
  assert.deepEqual([closed[0].qty, closed[0].buyEach, closed[0].sellEach, closed[0].tax, closed[0].realised],
    [10, 500, 600, 120, 880]);
  assert.deepEqual(open.map(o => [o.qty, o.buyEach, !!o.banked]), [[2, 500, true]], 'leftover 2 stay open, still banked');
});

// --- 5. REMOVE tombstone deletes an ALREADY-PERSISTED event --------------------------------
// A completed sell with no logged buy → unmatched. Persist it (as fills.json would), then a
// later REMOVE line targeting its eventId purges it from the merged set (§5.1) → gone.
ok('REMOVE tombstone deletes a persisted (prior-fills.json) event', () => {
  const { events: priorEvents } = runPipeline([
    raw({ state: 'SOLD', slot: 0, item: 500, time: '10:00:00', filledQty: 4, grossWorth: 8000, offerSize: 4, priceEach: 2000 }),
  ]);
  const persisted = priorEvents[0];
  assert.equal(reconstruct(priorEvents).unmatched.length, 1, 'pre-tombstone: the orphan sell is unmatched');

  // A REMOVE line arrives in a later log, targeting the persisted event's content-hash id.
  const { removeTargets } = runPipeline([removeLine(persisted.id)]);
  assert.ok(removeTargets.has(persisted.id), 'parseJsonLine surfaces the REMOVE target');
  const { merged, pos } = mergeReconstruct([persisted], [], removeTargets);
  assert.equal(merged.length, 0, 'the persisted event is filtered out of the merged set');
  assert.equal(pos.unmatched.length, 0, 'post-tombstone: nothing to reconstruct');
});

// --- 6. eventId GOLDEN value (cross-file hash contract, §5.1) -------------------------------
// eventId() (reconstruct.mjs) and eventIdFor() (js/fillslog.js) MUST produce the same 16-hex
// sha1 of [ts,slot,itemId,type,state,filled,spent].join('|') — the app's REMOVE tombstones
// target ids the pipeline computes. This GOLDEN pins that value; if it changes, the field
// order/join was altered in one file and the two have drifted apart — re-verify BOTH.
ok('eventId golden value pins the §5.1 hash contract', () => {
  const sample = { ts: 1751400000, slot: 2, itemId: 1515, type: 'buy', state: 'complete', filled: 5000, spent: 1400000 };
  assert.equal(eventId(sample), '5d78bec562b77d65',
    'golden eventId drift → eventId()/eventIdFor() field-order or hash changed; reconcile js/fillslog.js');
});

// ============================================================================================
console.log('\nP1 snapshot re-emission dedupe acceptance:');

// --- 7a. blowpipe-style duplicate BOUGHT pair → dedupe -------------------------------------
// RuneLite re-broadcasts a completed-but-uncollected offer's terminal line on login. Two
// identical BOUGHTs, same slot, NO placement between → the second is a re-emission, dropped.
ok('duplicate BOUGHT pair (no intervening placement) → one lot, not a phantom pair', () => {
  const { events } = runPipeline([
    raw({ state: 'BUYING', slot: 0, item: 12924, time: '20:00:00', offerSize: 1, priceEach: 5000000 }),
    raw({ state: 'BOUGHT', slot: 0, item: 12924, time: '20:05:00', filledQty: 1, grossWorth: 5000000, offerSize: 1, priceEach: 5000000 }),
    // login re-broadcast 25 min later — identical terminal, no fresh BUYING between:
    raw({ state: 'BOUGHT', slot: 0, item: 12924, time: '20:30:00', filledQty: 1, grossWorth: 5000000, offerSize: 1, priceEach: 5000000 }),
  ]);
  assert.equal(dedupeSnapshots(events).length, events.length - 1, 'exactly one terminal dropped');
  const { open } = reconstruct(events);
  assert.deepEqual(open.map(o => [o.itemId, o.qty]), [[12924, 1]], 'one blowpipe held, not a phantom two');
});

// --- 7b. genuine same-price repeat buy (placement between) → NOT dedupe ---------------------
// Same item/price/qty twice, but a real BUYING placement separates the terminals → two real
// trades; the discriminator must keep both.
ok('genuine repeat buy with a placement line between terminals → NOT deduped', () => {
  const { events } = runPipeline([
    raw({ state: 'BUYING', slot: 0, item: 100, time: '10:00:00', offerSize: 1, priceEach: 100 }),
    raw({ state: 'BOUGHT', slot: 0, item: 100, time: '10:05:00', filledQty: 1, grossWorth: 100, offerSize: 1, priceEach: 100 }),
    raw({ state: 'BUYING', slot: 0, item: 100, time: '10:10:00', offerSize: 1, priceEach: 100 }),   // fresh placement
    raw({ state: 'BOUGHT', slot: 0, item: 100, time: '10:15:00', filledQty: 1, grossWorth: 100, offerSize: 1, priceEach: 100 }),
  ]);
  assert.equal(dedupeSnapshots(events).length, events.length, 'placement between terminals → nothing dropped');
  const { open } = reconstruct(events);
  assert.deepEqual(open.map(o => [o.itemId, o.qty]), [[100, 2]], 'both real buys counted (2 held)');
});

// --- 7c. dup pair straddling an EMPTY-burst login snapshot → dedupe -------------------------
// The login snapshot also re-broadcasts EMPTY for the OTHER slots (the burst). Those must not
// count as an intervening placement for the traded slot; the identical terminal still dedupes.
ok('duplicate SOLD straddling an EMPTY-burst snapshot → one unmatched, not two', () => {
  const { events } = runPipeline([
    raw({ state: 'SELLING', slot: 0, item: 566, time: '20:00:00', offerSize: 100, priceEach: 200 }),
    raw({ state: 'SOLD', slot: 0, item: 566, time: '20:05:00', filledQty: 100, grossWorth: 20000, offerSize: 100, priceEach: 200 }),
    // login burst: EMPTY re-broadcast for the other slots + the duplicate terminal on slot 0
    raw({ state: 'EMPTY', slot: 1, item: 0, time: '20:30:00' }),
    raw({ state: 'EMPTY', slot: 2, item: 0, time: '20:30:00' }),
    raw({ state: 'EMPTY', slot: 3, item: 0, time: '20:30:00' }),
    raw({ state: 'SOLD', slot: 0, item: 566, time: '20:30:00', filledQty: 100, grossWorth: 20000, offerSize: 100, priceEach: 200 }),
  ]);
  assert.equal(dedupeSnapshots(events).length, events.length - 1, 'the re-emitted SOLD is dropped');
  const { unmatched } = reconstruct(events);   // no logged buy → orphan sell(s)
  assert.deepEqual(unmatched.map(u => [u.itemId, u.qty]), [[566, 100]], 'one unmatched sell, not a phantom double');
});

// ============================================================================================
console.log('\nTD1 money-path acceptance:');

// --- 8. big-ticket close taxes at the 5m CAP per unit --------------------------------------
// Buy 2 @ 200m, sell 2 @ 300m. GE_TAX(300m) = min(floor(300m·0.02)=6m, 5m) = 5m/unit — the CAP,
// NOT the raw floor(sell·0.02). A regression that dropped the cap would tax 6m/unit and understate
// realised by 1m/unit (the BE1 lesson, now enforced inside matchTrades).
ok('big-ticket close taxes at the 5m cap per unit (not floor(sell·0.02))', () => {
  const { events } = runPipeline([
    raw({ state: 'BOUGHT', slot: 0, item: 600, time: '10:00:00', filledQty: 2, grossWorth: 400_000_000, offerSize: 2, priceEach: 200_000_000 }),
    raw({ state: 'SOLD',   slot: 1, item: 600, time: '11:00:00', filledQty: 2, grossWorth: 600_000_000, offerSize: 2, priceEach: 300_000_000 }),
  ]);
  const { closed } = reconstruct(events);
  assert.equal(closed.length, 1);
  const c = closed[0];
  assert.equal(c.tax, 2 * 5_000_000, 'tax = 5m cap × 2 units, not floor(300m·0.02)=6m/unit');
  assert.notEqual(c.tax, 2 * Math.floor(300_000_000 * 0.02), 'the uncapped 2% would be 12m — the cap must bind');
  // realised = ((sellEach − taxEach) − buyEach) × qty = ((300m − 5m) − 200m) × 2 = 190m.
  assert.equal(c.realised, 190_000_000);
  assert.deepEqual([c.qty, c.buyEach, c.sellEach], [2, 200_000_000, 300_000_000]);
});

// --- 9. collapseOffers folds an incremental partial-fill sequence into one lot --------------
// The Exchange Logger emits a rising cumulative (filled, worth) as an offer fills piece by piece.
// collapseOffers must keep ONE offer per slot at the FINAL totals (max cumulative), not one per line.
ok('collapseOffers folds a rising partial-fill sequence into ONE lot at final totals', () => {
  const { events } = runPipeline([
    raw({ state: 'BUYING', slot: 0, item: 700, time: '10:00:00', offerSize: 10, priceEach: 100 }),                       // placed, filled 0
    raw({ state: 'BUYING', slot: 0, item: 700, time: '10:02:00', offerSize: 10, priceEach: 100, filledQty: 3, grossWorth: 300 }),  // partial
    raw({ state: 'BUYING', slot: 0, item: 700, time: '10:05:00', offerSize: 10, priceEach: 100, filledQty: 7, grossWorth: 700 }),  // more
    raw({ state: 'BOUGHT', slot: 0, item: 700, time: '10:09:00', offerSize: 10, priceEach: 100, filledQty: 10, grossWorth: 1000 }),// terminal
  ]);
  const offers = collapseOffers(events);
  assert.equal(offers.length, 1, 'the whole partial-fill sequence is ONE offer, not four');
  assert.equal(offers[0].filled, 10, 'final cumulative filled, not an intermediate value');
  assert.equal(offers[0].spent, 1000, 'final cumulative worth');
  const { open } = reconstruct(events);
  assert.deepEqual(open.map(o => [o.itemId, o.qty, o.buyEach]), [[700, 10, 100]], 'one open lot of 10 @ 100');
});

// ============================================================================================
console.log('\nSLT (PLAN-SALE-LOG-TAX) worth-convention acceptance:');

// RuneLite's Exchange Logger switched formats 2026-08-26: in `.json` sources a sell's `worth` is
// NET of tax (the `.log` era, coffer-manual.log, and mobile-fills.log stay GROSS). Fixture numbers
// are the real Magus ring row (§4 of the plan): listed/filled gross 22,944,000, logged net
// 22,485,120 (tax 458,880), bought at 22,401,000 → true realised +84,120 (booked −365,582 pre-fix).

// --- SLT-1. the discriminator is the source EXTENSION, never a timestamp --------------------
ok('isNetWorthSource: .json → net; .log/.txt (incl. manual/mobile) → gross', () => {
  assert.equal(isNetWorthSource('exchange_2026-08-26.json'), true);
  assert.equal(isNetWorthSource('C:\\logs\\exchange.json'), true);
  assert.equal(isNetWorthSource('exchange_2026-08-21.log'), false);
  assert.equal(isNetWorthSource('coffer-manual.log'), false);
  assert.equal(isNetWorthSource('mobile-fills.log'), false);
  assert.equal(isNetWorthSource('exchange.txt'), false);
});

// --- SLT-2. the flag arrives via BOTH entry routes, on sell events only ---------------------
ok('parseJsonLine option route: flags a SELL, never a BUY; absent without the option', () => {
  const sold = raw({ state: 'SOLD', slot: 0, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 });
  const bought = raw({ state: 'BOUGHT', slot: 1, item: 28313, time: '10:00:00', filledQty: 1, grossWorth: 22_401_000, offerSize: 1, priceEach: 22_401_000 });
  assert.equal(parseJsonLine(JSON.stringify(sold), { worthNet: true }).worthNet, true);
  assert.equal(parseJsonLine(JSON.stringify(bought), { worthNet: true }).worthNet, undefined, 'buys carry no tax — never flagged');
  assert.equal(parseJsonLine(JSON.stringify(sold)).worthNet, undefined, 'no option, no field → gross as always');
});
ok('parseJsonLine stamped-field route: a worthNet:true raw field (the readExchangeLog round-trip) is honoured', () => {
  const sold = { ...raw({ state: 'SOLD', slot: 0, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 }), worthNet: true };
  assert.equal(parseJsonLine(JSON.stringify(sold)).worthNet, true);
});

// --- SLT-3. the flag rides event → offer, and eventId never sees it -------------------------
ok('collapseOffers propagates worthNet to the offer; eventId is unchanged by the flag', () => {
  const lines = [
    raw({ state: 'SELLING', slot: 0, item: 28313, time: '10:59:00', offerSize: 1, priceEach: 22_944_000 }),
    raw({ state: 'SOLD', slot: 0, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 }),
  ];
  const { events: flagged } = runPipeline(lines, { worthNet: true });
  const { events: plain } = runPipeline(lines);
  assert.equal(collapseOffers(flagged)[0].worthNet, true, 'offer carries the convention bit');
  assert.equal(collapseOffers(plain)[0].worthNet, undefined);
  assert.deepEqual(flagged.map(e => e.id), plain.map(e => e.id),
    'eventId hashes [ts,slot,itemId,type,state,filled,spent] only — the flag must not change ids (the §9b merge/auto-migration contract)');
});

// --- SLT-4. the money: a net-convention sell books realised = net − buy ---------------------
// MUTATION-VERIFIED: fails on pre-fix matchTrades (which re-taxed the already-net each and booked
// the Magus ring at −365,582).
ok('net-convention sell through the ordinary flip path: realised = net − buy, gross recovered for display', () => {
  const { events } = runPipeline([
    raw({ state: 'BOUGHT', slot: 0, item: 28313, time: '10:00:00', filledQty: 1, grossWorth: 22_401_000, offerSize: 1, priceEach: 22_401_000 }),
    raw({ state: 'SOLD', slot: 1, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 }),
  ], { worthNet: true });
  const { closed } = reconstruct(events);
  assert.equal(closed.length, 1);
  // realised = net(22,485,120) − buy(22,401,000) — EXACT. sellEach/tax are display fields recovered
  // via grossFromNet; the true ask 22,944,000 sits at an exact-2% point, so the smallest preimage
  // reads 1gp low (22,943,999 / tax 458,879) — the accepted ≤1gp display-only class.
  assert.deepEqual([closed[0].buyEach, closed[0].sellEach, closed[0].tax, closed[0].realised],
    [22_401_000, 22_943_999, 458_879, 84_120]);
});

// --- SLT-5. a net-convention unmatched sell (no logged buy) --------------------------------
// The real 9244 row: 3,046 sold at ask 350, logged net 343/ea. 350 is an exact-2% point, so the
// smallest preimage recovers 349 / tax 6 (≤1gp display class; the true ask was 350 / tax 7). The
// load-bearing change vs pre-fix is sellEach: it now reads a recovered GROSS, not the net-in-disguise 343.
ok('net-convention unmatched sell: sellEach is a recovered gross, no longer the net in disguise', () => {
  const { events } = runPipeline([
    raw({ state: 'SOLD', slot: 0, item: 9244, time: '09:00:00', filledQty: 3046, grossWorth: 343 * 3046, offerSize: 3046, priceEach: 350 }),
  ], { worthNet: true });
  const { unmatched } = reconstruct(events);
  assert.equal(unmatched.length, 1);
  assert.deepEqual([unmatched[0].sellEach, unmatched[0].tax], [349, 6 * 3046]);
});

// --- SLT-6. sellNetEach — the ONE net-proceeds formula (shared with deriveCash) -------------
ok('sellNetEach: flagged → spent/filled as-is; unflagged → minus the per-item tax', () => {
  assert.equal(sellNetEach({ spent: 22_485_120, filled: 1, worthNet: true }), 22_485_120);
  assert.equal(sellNetEach({ spent: 22_944_000, filled: 1 }), 22_944_000 - GE_TAX(22_944_000));
  assert.equal(sellNetEach({ spent: 0, filled: 0 }), 0, 'total on an unfilled offer');
});

// --- SLT-7. the recurrence guard: auditWorthConvention ---------------------------------------
const sellLine = (price, qty, worth) =>
  parseJsonLine(JSON.stringify(raw({ state: 'SOLD', slot: 0, item: 9, time: '09:00:00', filledQty: qty, grossWorth: worth, offerSize: qty, priceEach: price })));
ok('guard: a .json-assigned file full of GROSS rows warns (mismatch), and vice versa', () => {
  const grossRows = [sellLine(1000, 5, 5000), sellLine(2000, 1, 2000)];
  const netRows = [sellLine(1000, 5, (1000 - 20) * 5), sellLine(2000, 1, 2000 - 40)];
  assert.equal(auditWorthConvention(grossRows, true, 'x.json').mismatch, true, 'assigned net, matches gross → semantics changed again');
  assert.equal(auditWorthConvention(netRows, false, 'x.log').mismatch, true, 'assigned gross, matches net');
});
ok('guard: clean files are silent; ambiguous (tax=0) and above-ask rows are skipped, not failed', () => {
  assert.equal(auditWorthConvention([sellLine(1000, 5, 5000)], false, 'x.log').mismatch, false, 'gross file read as gross');
  assert.equal(auditWorthConvention([sellLine(1000, 5, (1000 - 20) * 5)], true, 'x.json').mismatch, false, 'net file read as net');
  const amb = auditWorthConvention([sellLine(40, 100, 4000)], true, 'x.json');   // sub-50gp: gross == net
  assert.deepEqual([amb.checked, amb.mismatch], [0, false], 'tax-0 rows are invisible to the guard, never a failure');
  const above = auditWorthConvention([sellLine(1000, 5, 5100)], true, 'x.json'); // filled above the ask — matches neither
  assert.deepEqual([above.checked, above.mismatch], [0, false]);
});
ok('guard: one opposite match amid assigned matches does NOT flag (needs 0 assigned-convention matches)', () => {
  const mixed = [sellLine(1000, 5, 5000), sellLine(2000, 1, 2000 - 40)];        // one gross + one net
  assert.equal(auditWorthConvention(mixed, false, 'x.log').mismatch, false);
  assert.equal(auditWorthConvention(mixed, true, 'x.json').mismatch, false);
});

// --- SLT-8. the recorded tax field (plan §3a): gross becomes a READ, not an inversion --------
// The `.json` format also logs a cumulative per-item-floored `tax` field, running in lockstep with
// `worth` (census: every `.json` sell row carries it, `worth + tax === offer × qty` on all, incl.
// multi-unit partial sequences; no `.log`/manual/mobile row has the key). When present on a flagged
// sell, gross = (spent + taxAmt) / filled — exact at the collision points where grossFromNet reads
// 1gp low. grossFromNet stays the fallback for flagged events without the field.
const sellLineTax = (price, qty, worth, tax) =>
  parseJsonLine(JSON.stringify({ ...raw({ state: 'SOLD', slot: 0, item: 9, time: '09:00:00', filledQty: qty, grossWorth: worth, offerSize: qty, priceEach: price }), tax }));
ok('parseJsonLine carries the recorded tax as taxAmt on sell rows (either convention), never on buys', () => {
  const sold = { ...raw({ state: 'SOLD', slot: 0, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 }), tax: 458_880 };
  const bought = { ...raw({ state: 'BOUGHT', slot: 1, item: 28313, time: '10:00:00', filledQty: 1, grossWorth: 22_401_000, offerSize: 1, priceEach: 22_401_000 }), tax: 0 };
  assert.equal(parseJsonLine(JSON.stringify(sold), { worthNet: true }).taxAmt, 458_880);
  assert.equal(parseJsonLine(JSON.stringify(sold)).taxAmt, 458_880, 'carried on a gross-assigned row too — the guard reads it');
  assert.equal(parseJsonLine(JSON.stringify(bought), { worthNet: true }).taxAmt, undefined, 'buy rows never carry it');
});
ok('taxAmt rides event → offer at the final cumulative value, and eventId never sees it', () => {
  const lines = [
    { ...raw({ state: 'SELLING', slot: 0, item: 28313, time: '10:59:00', offerSize: 1, priceEach: 22_944_000 }), tax: 0 },
    { ...raw({ state: 'SOLD', slot: 0, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 }), tax: 458_880 },
  ];
  const { events: withTax } = runPipeline(lines, { worthNet: true });
  const { events: without } = runPipeline(lines.map(({ tax, ...rest }) => rest), { worthNet: true });
  assert.equal(collapseOffers(withTax)[0].taxAmt, 458_880, 'cumulative → final, like spent');
  assert.deepEqual(withTax.map(e => e.id), without.map(e => e.id),
    'the field must not change ids (the same §9b merge/auto-migration contract as worthNet)');
});
ok('flagged sell WITH taxAmt: display gross is EXACT at a collision point (the inversion reads 1gp low there)', () => {
  const { events } = runPipeline([
    raw({ state: 'BOUGHT', slot: 0, item: 28313, time: '10:00:00', filledQty: 1, grossWorth: 22_401_000, offerSize: 1, priceEach: 22_401_000 }),
    { ...raw({ state: 'SOLD', slot: 1, item: 28313, time: '11:00:00', filledQty: 1, grossWorth: 22_485_120, offerSize: 1, priceEach: 22_944_000 }), tax: 458_880 },
  ], { worthNet: true });
  const { closed } = reconstruct(events);
  assert.deepEqual([closed[0].sellEach, closed[0].tax, closed[0].realised], [22_944_000, 458_880, 84_120],
    'sellEach/tax read back the true ask exactly; realised identical to the inversion path (SLT-4)');
});
ok('flagged unmatched sell WITH taxAmt: the real 9244 shape recovers the true ask 350 / tax 21,322', () => {
  const { events } = runPipeline([
    { ...raw({ state: 'SOLD', slot: 0, item: 9244, time: '09:00:00', filledQty: 3046, grossWorth: 343 * 3046, offerSize: 3046, priceEach: 350 }), tax: 7 * 3046 },
  ], { worthNet: true });
  const { unmatched } = reconstruct(events);
  assert.deepEqual([unmatched[0].sellEach, unmatched[0].tax], [350, 21_322], 'SLT-5 recovers 349/6·3046 without the field');
});
ok('keep-short WITH taxAmt: sellEach exact, beRebuy still the logged net (close formula convention-blind)', () => {
  const { events } = runPipeline([
    { ...raw({ state: 'SOLD', slot: 0, item: 9, time: '09:00:00', filledQty: 5, grossWorth: (1000 - 20) * 5, offerSize: 5, priceEach: 1000 }), tax: 100 },
  ], { worthNet: true });
  const { awaitingRebuy } = reconstruct(events, { keeps: new Set([9]), now: events[0].ts + 1 }); // H1: state the clock — an aged short settles
  assert.deepEqual([awaitingRebuy[0].sellEach, awaitingRebuy[0].tax, awaitingRebuy[0].beRebuy], [1000, 100, 980]);
});
/* --- H1 (PLAN-BOOK-SELF-HEAL): the REVIVE directive through the parse/sequence chain -------------- */
const reviveLine = (item, target) => JSON.stringify({ state: 'REVIVE', item, target });

ok('REVIVE parses as an exemption MARKER (no ts/slot), like REMOVE', () => {
  const m = parseJsonLine(reviveLine(21012, 1_700_000_000));
  assert.deepEqual(m, { revive: { itemId: 21012, target: 1_700_000_000 } });
  assert.equal(parseJsonLine(reviveLine(21012, null)).revive.target, null, 'a null target means "the item\'s only short"');
});

ok('a REVIVE line derives NO event and leaves the eventId list untouched', () => {
  const trade = [
    raw({ state: 'BOUGHT', slot: 0, item: 100, time: '10:01:00', filledQty: 1, grossWorth: 100, offerSize: 1, priceEach: 100 }),
    raw({ state: 'SOLD',   slot: 0, item: 100, time: '11:01:00', filledQty: 1, grossWorth: 200, offerSize: 1, priceEach: 200 }),
  ];
  const plain = runPipeline(trade);
  const withRevive = runPipeline([trade[0], reviveLine(100, null), trade[1]]);
  assert.deepEqual(withRevive.events.map(e => e.id), plain.events.map(e => e.id), 'ids unchanged — markers never hash');
  assert.equal(withRevive.events.length, 2, 'the marker is not sequenced as an event');
});

ok('reconstruct surfaces the aged-out `settled` bucket (and leaves it empty on a young book)', () => {
  const { events } = runPipeline([
    raw({ state: 'SOLD', slot: 0, item: 9, date: '2026-07-01', time: '09:00:00', filledQty: 1, grossWorth: 1000, offerSize: 1, priceEach: 1000 }),
  ]);
  const sellTs = events[0].ts;
  const aged = reconstruct(events, { keeps: new Set([9]), now: sellTs + 30 * 86400 });
  assert.equal(aged.settled.length, 1);
  assert.equal(aged.awaitingRebuy.length, 0);
  assert.equal(reconstruct(events, { keeps: new Set([9]), now: sellTs + 86400 }).settled.length, 0);
});

// The sync writes positions.json only when the content changed; a wall-clock settledTs made every
// rebuild differ, so the skip could never fire and --publish would commit churn every night.
ok('two consecutive rebuilds over an unchanged log are byte-identical, settled rows included', () => {
  const { events } = runPipeline([
    raw({ state: 'SOLD', slot: 0, item: 9, date: '2026-07-01', time: '09:00:00', filledQty: 1, grossWorth: 1000, offerSize: 1, priceEach: 1000 }),
  ]);
  const sellTs = events[0].ts;
  const sig = p => JSON.stringify({ closed: p.closed, open: p.open, unmatched: p.unmatched, awaitingRebuy: p.awaitingRebuy, settled: p.settled });
  const first = reconstruct(events, { keeps: new Set([9]), now: sellTs + 30 * 86400 });
  const second = reconstruct(events, { keeps: new Set([9]), now: sellTs + 30 * 86400 + 7200 });   // two hours later
  assert.equal(first.settled.length, 1, 'the fixture really does settle — otherwise this proves nothing');
  assert.equal(sig(first), sig(second), 'the write-skip signature is stable across runs');
});

ok('guard reads the field: presence on a GROSS-assigned file warns; a short worth+tax sum warns on a NET file; above-ask does not', () => {
  const ambiguousWithTax = sellLineTax(40, 100, 4000, 0);          // formula-ambiguous (tax 0) but json-format
  assert.equal(auditWorthConvention([ambiguousWithTax], false, 'x.log2').mismatch, true,
    'json-format content under a non-.json name — closes the all-ambiguous blind spot');
  assert.equal(auditWorthConvention([ambiguousWithTax], true, 'x.json').mismatch, false, 'net-assigned: presence is expected');
  const shortSum = sellLineTax(1000, 5, 3000, 100);                // 3000 + 100 < 1000×5 — worth semantics changed again
  assert.equal(auditWorthConvention([shortSum], true, 'x.json').mismatch, true);
  const aboveAsk = sellLineTax(1000, 5, (1010 - 20) * 5, 100);     // filled above the ask: sum exceeds price×qty — legitimate
  assert.equal(auditWorthConvention([aboveAsk], true, 'x.json').mismatch, false);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
