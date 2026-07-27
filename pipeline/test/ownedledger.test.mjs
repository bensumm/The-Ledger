#!/usr/bin/env node
/**
 * ownedledger.test.mjs — RF0: the owned-item registry store + the pure owned-qty fold
 * (pipeline/lib/ownedledger.mjs, PLAN-REVERSE-FLIP).
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - loadOwned DEGRADES to an empty {items:[],pendingClassification:[]} on any failure.
 *   - computeOwnedQty folds owned qty over RAW fills.json events (seed ± buys/sells) and tracks to
 *     0 and back through a reverse-flip-shaped sell→rebuy sequence with ZERO reverse-flip-specific
 *     logic in the fold — a reverse-flip sell is an ordinary sell, the rebuy an ordinary buy.
 *   - events before seedTs, and events for other itemIds, are ignored.
 *   - foldPendingBuys flags ONLY big-ticket (each >= BIG_TICKET_GP) small-qty (<= qtyMax) buys for
 *     items the store doesn't already know; deduped, capped.
 *   - all store mutators are PURE.
 *
 * TZ-hermetic: no local-time getters / Date formatting — only unix-second arithmetic. Synthetic
 * fixtures only. Run: `node pipeline/test/ownedledger.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadOwned, saveOwned, ownedFor, upsertOwnedItem, removePending,
  computeOwnedQty, foldPendingBuys, PENDING_QTY_MAX,
} from '../lib/capital/ownedledger.mjs';
import { BIG_TICKET_GP } from '../../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T0 = 1_700_000_000;   // seed moment (unix seconds)
const HR = 3600;

/* A raw-fills snapshot triple (placed → partial → complete) for one offer on a slot, mirroring the
   real Exchange-Logger shape fills.json stores (cumulative `filled`/`spent`). */
function offerLines(slot, tsOpen, type, itemId, price, qty) {
  return [
    { ts: tsOpen, slot, type, state: 'placed', itemId, price, qty, filled: 0, spent: 0 },
    { ts: tsOpen + 1, slot, type, state: 'partial', itemId, price, qty, filled: qty, spent: price * qty },
    { ts: tsOpen + 2, slot, type, state: 'complete', itemId, price, qty, filled: qty, spent: price * qty },
  ];
}

/* --- load degrades ------------------------------------------------------------------------------ */
ok('loadOwned degrades to an empty items shape on a missing file', () => {
  const got = loadOwned(path.join(os.tmpdir(), 'rf0-none-' + Date.now() + '.json'));
  assert.deepEqual(got.items, []);
  assert.deepEqual(got.pendingClassification, []);
});
ok('loadOwned degrades on corrupt JSON and on a store with no items[]', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf0-')), 'owned.json');
  fs.writeFileSync(p, '{ not json');
  assert.deepEqual(loadOwned(p).items, []);
  fs.writeFileSync(p, '{"_doc":"x"}');
  assert.deepEqual(loadOwned(p).items, []);
});

/* --- save/load round-trip ----------------------------------------------------------------------- */
ok('saveOwned then loadOwned round-trips items + _doc', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf0-')), 'owned.json');
  const store = { _doc: 'doc', items: [{ id: 21018, name: 'Ancestral hat', seedQty: 1, seedTs: T0, classification: 'keep', source: 'seed' }] };
  saveOwned(p, store);
  const got = loadOwned(p);
  assert.equal(got._doc, 'doc');
  assert.deepEqual(got.items, store.items);
});

/* --- upsert / lookup / removePending are PURE --------------------------------------------------- */
ok('upsertOwnedItem replaces an id (no duplicate), defaults fields, and is PURE', () => {
  const before = { items: [{ id: 5, name: 'X', seedQty: 2, seedTs: T0, classification: 'flip', source: 'seed' }] };
  const after = upsertOwnedItem(before, { id: 5, classification: 'keep' });
  assert.equal(after.items.filter(i => i.id === 5).length, 1);
  assert.equal(after.items[0].classification, 'keep', 'classification updated');
  assert.equal(after.items[0].seedQty, 2, 'seedQty preserved from prev');
  assert.equal(before.items[0].classification, 'flip', 'input untouched');
});
ok('ownedFor + removePending', () => {
  const store = { items: [{ id: 5 }], pendingClassification: [{ id: 9, qty: 1 }, { id: 5, qty: 1 }] };
  assert.equal(ownedFor(store, 5).id, 5);
  assert.equal(ownedFor(store, 999), null);
  assert.deepEqual(removePending(store, 5).pendingClassification.map(p => p.id), [9]);
});

/* --- computeOwnedQty: tracks to 0 and back with ZERO reverse-flip logic -------------------------- */
ok('computeOwnedQty folds seed ± buy/sell and tracks to 0 and back (reverse-flip sell→rebuy)', () => {
  const item = { id: 21018, seedQty: 1, seedTs: T0 };   // 1 owned pre-log
  const events = [
    // ignored: an event BEFORE seedTs (pre-baseline) and a DIFFERENT item
    ...offerLines(3, T0 - 10 * HR, 'buy', 21018, 50_000_000, 3),   // pre-seed → NOT counted
    ...offerLines(4, T0 + 1 * HR, 'buy', 99999, 1000, 100),        // other item → NOT counted
    // the tracked sequence for 21018 (all after seedTs)
    ...offerLines(3, T0 + 2 * HR, 'buy', 21018, 52_000_000, 1),    // +1 → qty 2
    ...offerLines(3, T0 + 3 * HR, 'sell', 21018, 55_000_000, 1),   // −1 → qty 1
    ...offerLines(3, T0 + 4 * HR, 'sell', 21018, 57_000_000, 1),   // reverse-flip SELL −1 → qty 0
    ...offerLines(3, T0 + 6 * HR, 'buy', 21018, 53_500_000, 1),    // rebuy +1 → qty 1
  ];
  // running balance verified at each stage by truncating the event stream
  const upto = ts => events.filter(e => e.ts <= ts);
  assert.equal(computeOwnedQty(item, upto(T0 + 2 * HR + 2)), 2, 'after the buy: 2');
  assert.equal(computeOwnedQty(item, upto(T0 + 3 * HR + 2)), 1, 'after a normal sell: 1');
  assert.equal(computeOwnedQty(item, upto(T0 + 4 * HR + 2)), 0, 'after the reverse-flip sell: tracks to 0');
  assert.equal(computeOwnedQty(item, events), 1, 'after the rebuy: back to 1');
});
ok('computeOwnedQty returns seedQty when there are no relevant events / no id', () => {
  assert.equal(computeOwnedQty({ id: 1, seedQty: 4, seedTs: T0 }, []), 4);
  assert.equal(computeOwnedQty({ seedQty: 4 }, [{ ts: T0, itemId: 1, type: 'sell', state: 'complete', filled: 1 }]), 4, 'no id → seedQty');
});

/* --- foldPendingBuys ---------------------------------------------------------------------------- */
ok('foldPendingBuys flags only big-ticket small-qty buys of unknown items', () => {
  const store = { items: [{ id: 100 }], pendingClassification: [{ id: 200 }] };
  const events = [
    ...offerLines(1, T0 + 1 * HR, 'buy', 300, BIG_TICKET_GP + 5_000_000, 1),   // unknown, 15m×1 → pending
    ...offerLines(1, T0 + 2 * HR, 'buy', 100, BIG_TICKET_GP + 1, 1),           // KNOWN item → skip
    ...offerLines(1, T0 + 3 * HR, 'buy', 200, BIG_TICKET_GP + 1, 1),           // already pending → skip
    ...offerLines(1, T0 + 4 * HR, 'buy', 400, 5000, 1000),                     // cheap commodity → skip
    ...offerLines(1, T0 + 5 * HR, 'buy', 500, BIG_TICKET_GP + 1, PENDING_QTY_MAX + 3), // big but bulk qty → skip
    ...offerLines(1, T0 + 6 * HR, 'sell', 600, BIG_TICKET_GP + 1, 1),          // a SELL, not a buy → skip
  ];
  const pend = foldPendingBuys(events, store);
  assert.deepEqual(pend.map(p => p.id), [300], 'only the unknown big-ticket single');
  assert.equal(pend[0].qty, 1);
  assert.equal(pend[0].buyEach, BIG_TICKET_GP + 5_000_000);
});
ok('foldPendingBuys caps at max', () => {
  const events = [];
  for (let i = 0; i < 30; i++) events.push(...offerLines(1, T0 + i * HR, 'buy', 1000 + i, BIG_TICKET_GP + 1, 1));
  assert.equal(foldPendingBuys(events, { items: [] }, { max: 5 }).length, 5);
});

console.log(`\nAll ${pass} checks passed.`);
