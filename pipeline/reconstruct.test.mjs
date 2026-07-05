#!/usr/bin/env node
/**
 * reconstruct.test.mjs — acceptance fixtures for the fill-reconstruction money path.
 *
 * reconstruct.mjs is the highest-risk pipeline code with real incident history (phantom
 * open lots, FIFO mis-pairs, snapshot re-emission) but had ZERO fixtures — this file (R1)
 * closes that gap. (P1's snapshot-dedupe fixtures land in this same harness.)
 *
 * Like quotecore.test.mjs: the reconstruction functions are PURE (no DOM, no network, no
 * git), so the whole chain is fixture-testable with SYNTHETIC events — no live data.
 * Run: `node pipeline/reconstruct.test.mjs`  (exits non-zero on any failure).
 *
 * Coverage:
 *   R1 — buy→sell FIFO close; cancel-to-EMPTY inference; WITHDRAWN consume; BANKED basis lot;
 *        REMOVE tombstone deleting an already-persisted event; eventId GOLDEN value (guards the
 *        §5.1 eventId()↔eventIdFor() cross-file hash contract).
 */
import assert from 'node:assert/strict';
import {
  parseJsonLine, buildEvents, reconstruct, eventId,
} from './reconstruct.mjs';

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

function runPipeline(rawObjs) {
  const rawParsed = [];
  const removeTargets = new Set();
  for (const o of rawObjs) {
    const line = typeof o === 'string' ? o : JSON.stringify(o);
    const r = parseJsonLine(line);
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

// --- 2. cancel-to-EMPTY inference ----------------------------------------------------------
// A buy placed, never filled, slot drops straight to EMPTY (no explicit CANCELLED line) →
// buildEvents retroactively marks it cancelled; a filled=0 cancel produces no position.
ok('cancel-to-EMPTY inference (placed → EMPTY → cancelled, no phantom lot)', () => {
  const { events } = runPipeline([
    raw({ state: 'BUYING', slot: 0, item: 200, time: '12:00:00', offerSize: 10, priceEach: 50 }),
    raw({ state: 'EMPTY', slot: 0, item: 0, time: '12:10:00' }),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].state, 'cancelled', 'the sequence-aware fallback marks the un-completed offer cancelled');
  const { closed, open, unmatched } = reconstruct(events);
  assert.deepEqual([closed, open, unmatched], [[], [], []], 'a filled=0 cancel yields no closed/open/unmatched');
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

console.log(`\nAll ${pass} acceptance checks passed.`);
