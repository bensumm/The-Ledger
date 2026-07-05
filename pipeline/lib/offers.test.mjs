#!/usr/bin/env node
/**
 * offers.test.mjs — acceptance fixtures for the active-offer reader (pipeline/lib/offers.mjs).
 *
 * Colocated NEXT TO its subject in pipeline/lib/. activeOffers() is a PURE function over already-
 * parsed log rows (readExchangeLog does the filesystem IO and is NOT tested here — fixtures only,
 * no live logs, CLAUDE.md rule 4).
 * Run: `node pipeline/lib/offers.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - The LATEST log line for a slot is that slot's current state — a re-placed / partially-filled
 *     slot reflects its most recent line, never an earlier one for the same slot.
 *   - Only BUYING / SELLING slots surface as active offers (Ben's committed-capital definition,
 *     2026-07-04); terminal / cancelled / EMPTY states never do.
 *   - offersSnapshot() (LW1, the offers.json emitter) maps each active offer to the flat schema
 *     { slot, side, itemId, item, price, qty, filled, lastUpdateTs }: side BUYING→'buy' /
 *     SELLING→'sell'; qty = TOTAL offer size (max), filled = cumulative filled so far (qty field);
 *     EMPTY/terminal slots are excluded; item name comes from a best-effort lookup ('#<id>' fallback).
 */
import assert from 'node:assert/strict';
import { activeOffers, offersSnapshot } from './offers.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const row = (slot, state, item, qty, extra = {}) =>
  ({ slot, state, item, qty, date: '2026-01-10', time: '12:00:00', ...extra });

console.log('offers.js active-offer acceptance:');

// --- 1. latest line per slot wins -------------------------------------------------------------
ok('the latest line for a slot is its current state (a partial-fill re-log updates qty)', () => {
  const rows = [
    row(0, 'BUYING', 'Rune scimitar', 1),
    row(0, 'BUYING', 'Rune scimitar', 4),   // later partial-fill line for the SAME slot → this one wins
  ];
  const active = activeOffers(rows);
  assert.equal(active.length, 1, 'one slot → one active offer, not two');
  assert.equal(active[0].qty, 4, 'reflects the most recent line, not the first');
});

ok('a slot that moved to a terminal state drops out (latest line is no longer BUYING/SELLING)', () => {
  const rows = [
    row(0, 'BUYING', 'Rune scimitar', 5),
    row(0, 'BOUGHT', 'Rune scimitar', 5),   // slot 0 completed → not active anymore
  ];
  assert.equal(activeOffers(rows).length, 0);
});

// --- 2. only BUYING / SELLING surface as active -----------------------------------------------
ok('only BUYING and SELLING slots are active offers; terminal/EMPTY are excluded', () => {
  const rows = [
    row(0, 'BUYING', 'Dragon bones', 100),
    row(1, 'SELLING', 'Magic logs', 500),
    row(2, 'EMPTY', null, 0),
    row(3, 'BOUGHT', 'Yew logs', 200),
    row(4, 'CANCELLED_BUY', 'Coal', 0),
  ];
  const active = activeOffers(rows);
  assert.equal(active.length, 2, 'only the resting BUY and SELL count as committed capital');
  const states = active.map(o => o.state).sort();
  assert.deepEqual(states, ['BUYING', 'SELLING']);
  const items = active.map(o => o.item).sort();
  assert.deepEqual(items, ['Dragon bones', 'Magic logs']);
});

// ============================================================================================
console.log('\noffersSnapshot() offers.json emitter acceptance (LW1):');

// A raw exchange-logger row uses the plugin field names: item=itemId, offer=price each,
// max=total offer size, qty=cumulative filled so far, state, slot, date/time (local wall-clock).
const rawRow = (slot, state, item, { max = 0, filled = 0, offer = 0, date = '2026-07-05', time = '12:00:00' } = {}) =>
  ({ slot, state, item, max, qty: filled, offer, date, time });

// --- 4. shape + field mapping: side, qty(=max), filled(=qty), price, ts, name fallback ---------
ok('maps active offers to the flat schema with correct side / qty / filled / name fallback', () => {
  const rows = [
    rawRow(0, 'BUYING', 4151, { max: 5, filled: 2, offer: 100, time: '12:00:00' }),   // partially-filled BUY
    rawRow(1, 'SELLING', 561, { max: 500, filled: 0, offer: 200, time: '12:05:00' }),  // resting SELL
  ];
  const nameFor = id => ({ 4151: 'Abyssal whip', 561: 'Nature rune' })[id]; // 561 present, but test the fallback via a 3rd id below
  const snap = offersSnapshot(rows, nameFor);
  assert.equal(snap.offers.length, 2, 'both resting offers surface');
  const buy = snap.offers.find(o => o.slot === 0);
  assert.deepEqual(
    [buy.side, buy.itemId, buy.item, buy.price, buy.qty, buy.filled],
    ['buy', 4151, 'Abyssal whip', 100, 5, 2],
    'BUYING→buy; qty is the TOTAL offer size (max=5), filled is the cumulative fill (2); name resolved',
  );
  const sell = snap.offers.find(o => o.slot === 1);
  assert.equal(sell.side, 'sell', 'SELLING→sell');
  assert.equal(sell.filled, 0, 'a resting-unfilled sell carries filled 0');
  assert.ok(Number.isFinite(sell.lastUpdateTs), 'lastUpdateTs is the offer line epoch (finite ms)');
  // best-effort name: an id the lookup does not know falls back to '#<id>'
  const snap2 = offersSnapshot([rawRow(2, 'BUYING', 99999, { max: 1, offer: 1 })], nameFor);
  assert.equal(snap2.offers[0].item, '#99999', 'unknown id → #<id> fallback, never a throw');
});

// --- 5. EMPTY / terminal slots are excluded from the snapshot ---------------------------------
ok('EMPTY and terminal (BOUGHT/CANCELLED) slots never appear in the snapshot', () => {
  const rows = [
    rawRow(0, 'BUYING', 4151, { max: 5, offer: 100 }),
    rawRow(1, 'EMPTY', 0),
    rawRow(2, 'BOUGHT', 561, { max: 10, filled: 10, offer: 50 }),
    rawRow(3, 'CANCELLED_SELL', 4153, { max: 1, offer: 9 }),
  ];
  const snap = offersSnapshot(rows);
  assert.equal(snap.offers.length, 1, 'only the resting BUY survives');
  assert.equal(snap.offers[0].slot, 0);
});

// --- 6. no active offers → empty array, stable envelope ---------------------------------------
ok('no live offers → empty offers array with a real generatedAt envelope', () => {
  const snap = offersSnapshot([]);
  assert.deepEqual(snap.offers, []);
  assert.equal(snap.app, 'the-coffer-offers');
  assert.ok(typeof snap.generatedAt === 'string' && snap.generatedAt.length > 0);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
