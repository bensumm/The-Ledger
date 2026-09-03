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
 *   - The latest log line for a slot BY WALL-CLOCK (`date`+`time`) is that slot's current state — NOT the
 *     latest in READ order, which tracks file mtime and let a stale BUYING row resurrect a cancelled slot
 *     (the slot-2 crossbow phantom, 2026-09-02). Exact ties and rows with no parseable timestamp fall back
 *     to read order (later wins); an unstamped row never displaces a stamped one.
 *   - Only BUYING / SELLING slots surface as active offers (Ben's committed-capital definition,
 *     2026-07-04); terminal / cancelled / EMPTY states never do.
 *   - offersSnapshot() (LW1, the offers.json emitter) maps each active offer to the flat schema
 *     { slot, side, itemId, item, price, qty, filled, lastUpdateTs, placedTs }: side BUYING→'buy' /
 *     SELLING→'sell'; qty = TOTAL offer size (max), filled = cumulative filled so far (qty field);
 *     EMPTY/terminal slots are excluded; item name comes from a best-effort lookup ('#<id>' fallback).
 *   - placedTs (FD3, PLAN-FLOW-DIET) is the slot's current offer EPISODE start: a partial-fill
 *     re-log (qty moves, state·item·price·max don't) does NOT reset it; a price/item change,
 *     terminal row, or EMPTY→offer transition starts a new episode; underivable → null, never a
 *     throw (an old/unstamped log degrades to the pre-FD3 render via restingAge('') === '').
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activeOffers, offersSnapshot, readOfferRows, restartBlindSuspects, restingAge, suspectBidEscrow, suspectBidNote } from '../lib/reconstruct/offers.mjs';

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

// --- 1b. WALL-CLOCK decides the per-slot winner, not read order (H3) --------------------------
// THE LIVE SHAPE (slot-2 crossbow, 2026-09-02): readOfferRows concatenates log files in FILE-MTIME order.
// The manual CANCELLED_BUY (22:50) sat in coffer-manual.log, whose mtime was OLDER than exchange.json — so
// the stale 19:31 BUYING row was read LAST and won, resurrecting a slot Ben had cancelled. Twice.
ok('a NEWER-wall-clock cancel read EARLIER beats a stale BUYING row read later (the mtime-race phantom)', () => {
  const rows = [
    // read first (older-mtime file) but the LATER wall-clock — the real current state
    row(2, 'CANCELLED_BUY', 'Armadyl crossbow', 0, { date: '2026-09-02', time: '22:50:00' }),
    // read last (newest-mtime file) but a STALE wall-clock — must NOT win
    row(2, 'BUYING', 'Armadyl crossbow', 0, { date: '2026-09-02', time: '19:31:00' }),
    row(6, 'BUYING', 'Dragon bones', 10, { date: '2026-09-02', time: '20:00:00' }),
    row(7, 'SELLING', 'Magic logs', 5, { date: '2026-09-02', time: '20:00:00' }),
  ];
  const active = activeOffers(rows);
  assert.deepEqual(active.map(o => o.slot).sort(), [6, 7], 'slot 2 is cancelled and stays gone; live slots survive');
});

ok('an exact wall-clock tie keeps the later-read row (re-emit semantics unchanged)', () => {
  const rows = [
    row(0, 'BUYING', 'Rune scimitar', 1, { time: '12:00:00' }),
    row(0, 'BUYING', 'Rune scimitar', 4, { time: '12:00:00' }),   // same stamp → later-read wins
  ];
  const active = activeOffers(rows);
  assert.equal(active.length, 1);
  assert.equal(active[0].qty, 4, 'tie falls back to read order');
});

ok('a row with no parseable timestamp never displaces a stamped incumbent', () => {
  const stamped = [
    row(0, 'CANCELLED_BUY', 'Coal', 0, { date: '2026-09-02', time: '10:00:00' }),
    { slot: 0, state: 'BUYING', item: 'Coal', qty: 3 },           // no date/time — a REMOVE-shaped line
  ];
  assert.equal(activeOffers(stamped).length, 0, 'the unstamped BUYING row cannot revive the cancelled slot');
  // …but two unstamped rows still resolve by read order, so a stampless log degrades, never throws.
  const bare = [
    { slot: 1, state: 'BUYING', item: 'Coal', qty: 1 },
    { slot: 1, state: 'BUYING', item: 'Coal', qty: 9 },
  ];
  const act = activeOffers(bare);
  assert.equal(act.length, 1);
  assert.equal(act[0].qty, 9, 'no stamps at all → read order (later wins)');
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

// --- 5b. end-to-end mtime race: two fixture log FILES, the cancel in the older-mtime one (H3) ---
// This is the root cause, not just its shape: readOfferRows sorts files by mtime, so the newest-touched
// file's rows come last. The cancel lives in the OLDER file and must still win on wall-clock.
ok('a snapshot built from a fixture log dir drops the phantom slot even when the stale row is read last', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coffer-offers-'));
  try {
    const line = o => JSON.stringify(o) + '\n';
    fs.writeFileSync(path.join(dir, 'coffer-manual.log'),
      line({ slot: 2, state: 'CANCELLED_BUY', item: 11785, max: 1, qty: 0, offer: 8_000_000, date: '2026-09-02', time: '22:50:00' }));
    fs.writeFileSync(path.join(dir, 'exchange.log'),
      line({ slot: 2, state: 'BUYING', item: 11785, max: 1, qty: 0, offer: 8_000_000, date: '2026-09-02', time: '19:31:00' })
      + line({ slot: 6, state: 'BUYING', item: 561, max: 100, qty: 0, offer: 200, date: '2026-09-02', time: '20:00:00' })
      + line({ slot: 7, state: 'SELLING', item: 1515, max: 50, qty: 0, offer: 300, date: '2026-09-02', time: '20:00:00' }));
    // make the manual log the OLDER file — exactly the live race (RuneLite appended after the injection)
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(path.join(dir, 'coffer-manual.log'), old, old);
    const rows = readOfferRows(dir);
    assert.equal(rows[0].state, 'CANCELLED_BUY', 'the cancel really is read FIRST (mtime order) — the race is reproduced');
    const snap = offersSnapshot(rows);
    assert.deepEqual(snap.offers.map(o => o.slot).sort(), [6, 7], 'slot 2 excluded; live slots 6/7 survive');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- 6. no active offers → empty array, stable envelope ---------------------------------------
ok('no live offers → empty offers array with a real generatedAt envelope', () => {
  const snap = offersSnapshot([]);
  assert.deepEqual(snap.offers, []);
  assert.equal(snap.app, 'the-coffer-offers');
  assert.ok(typeof snap.generatedAt === 'string' && snap.generatedAt.length > 0);
});

// ============================================================================================
console.log('\nrestart-blind suspect-bid escrow acceptance (PLAN-CAPITAL-DEPLOYABILITY L2):');

// BUSINESS REQUIREMENT: a resting BID that went dark through a client-restart log wipe (BUYING → a run of
// trailing EMPTY, never a terminal row) may still be live in-game, so its escrow is DROPPED from
// offers.json and never subtracted from the derived deployable figure — inflating it. suspectBidEscrow
// sums the UNFILLED remainder ((max−qty)×offer) of exactly those suspect BUY slots so the surfaces can
// flag it. It must NOT count a genuinely-cancelled/filled slot, and must NOT count a suspect SELL (an ask
// is held inventory, not deployable cash).
ok('suspectBidEscrow counts a restart-blind BUYING slot\'s unfilled remainder; excludes genuine terminals + sells', () => {
  const rows = [
    // slot 0 — restart-blind BID: BUYING then trailing EMPTY, no terminal row → SUSPECT (remainder 800×5000)
    rawRow(0, 'BUYING', 100, { max: 1000, filled: 200, offer: 5000, time: '10:00:00' }),
    rawRow(0, 'EMPTY', 0, { time: '11:00:00' }),
    // slot 1 — genuinely cancelled BID: has a CANCELLED_BUY before EMPTY → NOT a suspect
    rawRow(1, 'BUYING', 200, { max: 10, filled: 2, offer: 1_000_000, time: '10:00:00' }),
    rawRow(1, 'CANCELLED_BUY', 200, { max: 10, filled: 2, offer: 1_000_000, time: '10:30:00' }),
    rawRow(1, 'EMPTY', 0, { time: '11:00:00' }),
    // slot 2 — restart-blind SELL: SELLING then EMPTY → a suspect ASK, but not deployable cash → excluded
    rawRow(2, 'SELLING', 300, { max: 50, filled: 0, offer: 2_000_000, time: '10:00:00' }),
    rawRow(2, 'EMPTY', 0, { time: '11:00:00' }),
  ];
  // sanity: restartBlindSuspects sees the two blind slots (0 BUYING, 2 SELLING), not the cancelled slot 1
  const suspects = restartBlindSuspects(rows);
  assert.deepEqual(suspects.map(s => s.slot).sort(), [0, 2], 'blind BUY + blind SELL are suspects; genuine cancel is not');
  const esc = suspectBidEscrow(rows);
  assert.equal(esc.n, 1, 'only the restart-blind BID counts (sell excluded, genuine cancel excluded)');
  assert.equal(esc.gp, 800 * 5000, 'escrow is the UNFILLED remainder (max−qty)×offer, not the whole offer');
});

ok('a clean book (no restart-blind slots) yields zero escrow and an empty note (byte-identical to today)', () => {
  const rows = [rawRow(0, 'BUYING', 100, { max: 5, filled: 1, offer: 100, time: '10:00:00' })];
  const esc = suspectBidEscrow(rows);
  assert.deepEqual(esc, { n: 0, gp: 0 });
  assert.equal(suspectBidNote(esc, n => n + 'gp'), '', 'no suspects → empty string, so surfaces render unchanged');
});

ok('suspectBidNote renders the shared flag with count-aware pluralization', () => {
  assert.equal(suspectBidNote({ n: 1, gp: 4_000_000 }, n => (n / 1e6).toFixed(2) + 'm'),
    ' ⚠ 1 restart-suspect bid (~4.00m) may be included — verify in-game');
  assert.equal(suspectBidNote({ n: 3, gp: 12_000_000 }, n => (n / 1e6).toFixed(2) + 'm'),
    ' ⚠ 3 restart-suspect bids (~12.00m) may be included — verify in-game');
});

// ============================================================================================
console.log('\nplacedTs episode derivation (PLAN-FLOW-DIET FD3):');

const epAt = time => Date.parse('2026-07-05T' + time);

ok('a partial-fill re-log does NOT reset placedTs (lastUpdateTs moves, placedTs stays)', () => {
  const rows = [
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 0, offer: 100, time: '10:00:00' }),
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 4, offer: 100, time: '11:30:00' }),   // fill moves qty only
  ];
  const [a] = activeOffers(rows);
  assert.equal(a.placedTs, epAt('10:00:00'), 'episode start is the FIRST line of the run');
  assert.equal(a.ts, epAt('11:30:00'), 'ts (→lastUpdateTs) still tracks the latest line');
  const snap = offersSnapshot(rows);
  assert.equal(snap.offers[0].placedTs, epAt('10:00:00'), 'snapshot carries placedTs beside lastUpdateTs');
  assert.equal(snap.offers[0].lastUpdateTs, epAt('11:30:00'));
});

ok('a price change starts a NEW episode even with no terminal row logged between', () => {
  const rows = [
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 0, offer: 100, time: '10:00:00' }),
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 0, offer: 110, time: '12:00:00' }),   // repriced
  ];
  assert.equal(activeOffers(rows)[0].placedTs, epAt('12:00:00'), 'the reprice is the placement');
});

ok('cancel-and-relist at the SAME price is a new episode (terminal row breaks the run)', () => {
  const rows = [
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 2, offer: 100, time: '10:00:00' }),
    rawRow(0, 'CANCELLED_BUY', 4151, { max: 10, filled: 2, offer: 100, time: '10:30:00' }),
    rawRow(0, 'BUYING', 4151, { max: 8, filled: 0, offer: 100, time: '11:00:00' }),    // relisted
  ];
  assert.equal(activeOffers(rows)[0].placedTs, epAt('11:00:00'), 'the relist is the placement');
});

ok('EMPTY→offer transition starts a new episode (restart-blind wipes reset the clock — age is a floor)', () => {
  const rows = [
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 0, offer: 100, time: '09:00:00' }),
    rawRow(0, 'EMPTY', 0, { time: '09:30:00' }),                                       // blind wipe
    rawRow(0, 'BUYING', 4151, { max: 10, filled: 0, offer: 100, time: '10:00:00' }),   // re-emit
  ];
  assert.equal(activeOffers(rows)[0].placedTs, epAt('10:00:00'), 'the post-EMPTY re-emit starts the episode');
});

ok('an unstamped-only slot yields placedTs null (degrade, never throw), and the snapshot carries the null', () => {
  const rows = [{ slot: 1, state: 'BUYING', item: 4151, max: 5, qty: 0, offer: 100 }];  // no date/time
  const [a] = activeOffers(rows);
  assert.equal(a.placedTs, null);
  assert.equal(offersSnapshot(rows).offers[0].placedTs, null);
});

ok('restingAge renders m/h/d and returns \'\' on null so pre-FD3 rows print unchanged', () => {
  const now = Date.parse('2026-07-05T12:00:00');
  assert.equal(restingAge(now - 47 * 60000, now), '47m');
  assert.equal(restingAge(now - 26 * 3600000, now), '26h');
  assert.equal(restingAge(now - 3.2 * 86400000, now), '3.2d');
  assert.equal(restingAge(null, now), '');
  assert.equal(restingAge(undefined, now), '');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
