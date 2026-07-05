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
 */
import assert from 'node:assert/strict';
import { activeOffers } from './offers.mjs';

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

console.log(`\nAll ${pass} acceptance checks passed.`);
