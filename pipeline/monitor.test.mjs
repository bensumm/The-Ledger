#!/usr/bin/env node
/**
 * monitor.test.mjs — pins the ARCH-1 tombstone fold-in for the live position monitor.
 *
 * monitor.mjs rebuilds a FIFO held-book IN-MEMORY from the live Exchange Logger. Before ARCH-1 it
 * DROPPED the coffer-manual.log REMOVE tombstone markers instead of applying them, so a lot the
 * sync/positions.json path had already purged reappeared as a phantom hold — and gave wrong listing
 * advice once (2026-07-05). The routing now goes through the shared buildTombstonedEvents() helper
 * (reconstruct.mjs), the same correction sync-fills.mjs applies. monitor.mjs is a top-level
 * side-effecting script (it reads ~/.runelite on import), so we pin the shared helper it calls —
 * that IS the reconstruction routing under test.
 *
 * Run: `node pipeline/monitor.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { buildTombstonedEvents, reconstruct, eventId } from './lib/reconstruct.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// One Exchange-Logger JSON line (RAW field names: item→itemId, offer→price, max→offer-size,
// qty→cumulative-filled, worth→cumulative-spent — the verified adapter mapping).
const raw = ({ state, slot, item, time, date = '2026-07-01',
               filledQty = 0, grossWorth = 0, offerSize = 0, priceEach = 0 }) =>
  JSON.stringify({ date, time, state, slot, item, qty: filledQty, worth: grossWorth, max: offerSize, offer: priceEach });
const removeLine = target => JSON.stringify({ state: 'REMOVE', target });

console.log('ARCH-1 monitor tombstone fold-in:');

// A single filled buy → one open lot. This is the exact shape that, if its terminal is later
// corrected away by a REMOVE tombstone (a mobile/mislogged buy), used to persist as a phantom hold.
const buyLines = [
  raw({ state: 'BUYING', slot: 3, item: 12695, time: '10:00:00', offerSize: 10, priceEach: 12600 }),
  raw({ state: 'BOUGHT', slot: 3, item: 12695, time: '10:01:00', filledQty: 10, grossWorth: 126000, offerSize: 10, priceEach: 12600 }),
];

ok('a filled buy with no tombstone IS a held lot (baseline phantom-hold shape)', () => {
  const events = buildTombstonedEvents(buyLines);
  const { open } = reconstruct(events);
  assert.equal(open.length, 1, 'the logged buy reconstructs to one open lot');
  assert.deepEqual([open[0].itemId, open[0].qty, open[0].buyEach], [12695, 10, 12600]);
});

ok('a REMOVE tombstone targeting that buy PURGES the lot (no phantom hold)', () => {
  // Derive the buy event's content-hash id exactly as the pipeline does, then tombstone it — the
  // real correction path (add-manual-fill.mjs --remove <eventId> writes this line into coffer-manual.log).
  const events = buildTombstonedEvents(buyLines);
  const buyEvent = events.find(e => e.type === 'buy' && e.state === 'complete');
  assert.ok(buyEvent, 'baseline produced the BOUGHT terminal event');
  const target = eventId(buyEvent);

  const withTombstone = buildTombstonedEvents([...buyLines, removeLine(target)]);
  const { open, closed, unmatched } = reconstruct(withTombstone);
  assert.deepEqual([open, closed, unmatched], [[], [], []],
    'the tombstoned buy is dropped before reconstruction → NO phantom open lot');
});

ok('a tombstone whose target matches nothing is a harmless no-op (live-log-only, no fills.json merge)', () => {
  const events = buildTombstonedEvents([...buyLines, removeLine('deadbeefdeadbeef')]);
  const { open } = reconstruct(events);
  assert.equal(open.length, 1, 'an unmatched tombstone target leaves the real lot untouched');
});

console.log(`\n✓ monitor.test.mjs — ${pass} assertion(s) passed.`);
