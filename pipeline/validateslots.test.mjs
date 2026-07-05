#!/usr/bin/env node
/**
 * validateslots.test.mjs — acceptance fixtures for LH1's slot-state transition validator.
 *
 * validateSlotTransitions() (pipeline/lib/reconstruct.mjs) is the LOUD, conservative catch for the
 * "impossible transition" log-artifact class: a GE slot is a state machine, so a SECOND terminal
 * (BOUGHT/SOLD/CANCELLED_*) on the same slot with NO placement line between is impossible unless the
 * plugin re-emitted a stale slot state after a relog (the 13:25:53/13:29:01 double-BOUGHT incident,
 * 2026-07-05). Pure over synthetic events — no live data (CLAUDE.md rule 4).
 * Run: `node pipeline/validateslots.test.mjs` (exits non-zero on any failure; auto-discovered by
 * run-tests.mjs — adding this file is the whole job).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - An exact-identical second terminal on a GE slot (0–7) with no placement between is DROPPED
 *     and a warning is emitted; exactly one survives.
 *   - The SAME two terminals WITH a fresh placement (BUYING/SELLING) between them are BOTH KEPT —
 *     that's a genuine repeat trade, not a re-emit (the two-real-blowpipe-bids case).
 *   - A same-slot double-terminal that DIFFERS in any of item/side/qty/price is KEPT (warn only) —
 *     fail toward preserving data; only provable exact duplicates drop.
 *   - Manual-log slots 8 (desktop/CLI) and 9 (mobile) are EXEMPT — they carry independent one-shot
 *     lines that legitimately repeat, so identical manual terminals are never dropped.
 *   - P/L safety: dropping the phantom yields the one-real-buy reconstruction (matchTrades consumes
 *     filled>0 only, so the sole effect is removing the phantom lot).
 *   - REMOVE tombstones keep working on the validated stream — a tombstone on a SURVIVING event
 *     still purges it after validation.
 *   - EMPTY lines are never evidence: an EMPTY burst on OTHER slots between the two terminals does
 *     not count as an intervening placement (the deleted cancel-to-EMPTY inference stays deleted).
 */
import assert from 'node:assert/strict';
import { parseJsonLine, buildEvents, validateSlotTransitions, reconstruct, eventId } from './lib/reconstruct.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// raw() builds ONE Exchange-Logger JSON line with the verified RAW field names (item→itemId,
// offer→price, max→offer-size, qty→cumulative-filled, worth→cumulative-spent).
const raw = ({ state, slot, item, time, date = '2026-07-05',
               filledQty = 0, grossWorth = 0, offerSize = 0, priceEach = 0 }) =>
  ({ date, time, state, slot, item, qty: filledQty, worth: grossWorth, max: offerSize, offer: priceEach });

// parse raw objects → sequenced events (the buildEvents chain), the input validateSlotTransitions sees.
function events(rawObjs) {
  const parsed = [];
  for (const o of rawObjs) { const r = parseJsonLine(JSON.stringify(o)); if (r && r.remove === undefined) parsed.push(r); }
  return buildEvents(parsed);
}
// Run validateSlotTransitions with console.warn captured so we can assert a warning fired AND keep
// the test output clean of the (expected, loud-by-design) pipeline warnings.
function validateCapturingWarns(evs) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { const r = validateSlotTransitions(evs); return { ...r, warns }; }
  finally { console.warn = orig; }
}

console.log('LH1 slot-state transition validation:');

// The verbatim incident: BUYING then BOUGHT on slot 7 (the ONE real 17.4m buy), then a login/GE-open
// snapshot re-broadcast — an EMPTY burst on the OTHER slots + an identical BOUGHT re-emit on slot 7.
const bludgeonReEmit = [
  raw({ state: 'BUYING', slot: 7, item: 13263, time: '13:25:52', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
  raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:25:53', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
  raw({ state: 'EMPTY',  slot: 0, item: 0, time: '13:29:01' }),
  raw({ state: 'EMPTY',  slot: 4, item: 0, time: '13:29:01' }),
  raw({ state: 'EMPTY',  slot: 6, item: 0, time: '13:29:01' }),
  raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:29:01', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
];

// --- 1. the double-BOUGHT re-emit → one survives, one dropped, warn emitted -----------------
ok('13:29 double-BOUGHT re-emit (EMPTY burst between, no placement) → one dropped + warned', () => {
  const evs = events(bludgeonReEmit);
  const bought = evs.filter(e => e.state === 'complete' && e.slot === 7);
  assert.equal(bought.length, 2, 'both raw BOUGHT lines survive buildEvents (EMPTY-only sequencing)');
  const { events: kept, dropped, warns } = validateCapturingWarns(evs);
  assert.equal(dropped.length, 1, 'exactly one suspected re-emit dropped');
  assert.equal(kept.filter(e => e.state === 'complete' && e.slot === 7).length, 1, 'exactly one BOUGHT survives');
  assert.ok(dropped[0].event.ts > dropped[0].priorTs, 'the LATER terminal is the one dropped; the earlier real buy is kept');
  assert.ok(warns.some(w => /re-emit dropped/.test(w)), 'a loud console.warn was emitted for the drop');
});

// --- 2. same two terminals WITH an intervening placement → both survive (real-repeat case) ---
ok('genuine repeat buy with a BUYING placement between terminals → NOTHING dropped', () => {
  const evs = events([
    raw({ state: 'BUYING', slot: 7, item: 13263, time: '13:25:52', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
    raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:25:53', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
    raw({ state: 'BUYING', slot: 7, item: 13263, time: '13:28:00', filledQty: 0, grossWorth: 0, offerSize: 1, priceEach: 17401000 }), // fresh placement re-opens the slot
    raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:29:01', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
  ]);
  const { dropped, warns } = validateCapturingWarns(evs);
  assert.equal(dropped.length, 0, 'a placement between terminals makes the second a real trade — kept');
  assert.equal(warns.length, 0, 'no warning when the transition is legal');
  const { open } = reconstruct(validateSlotTransitions(evs).events);
  assert.deepEqual(open.map(o => [o.itemId, o.qty]), [[13263, 2]], 'both real buys counted (2 held)');
});

// --- 3. near-duplicate differing PRICE → both kept + warn ------------------------------------
ok('same-slot double-terminal that differs in price → KEPT, but warned', () => {
  const evs = events([
    raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:25:53', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
    raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:29:01', filledQty: 1, grossWorth: 17402000, offerSize: 1, priceEach: 17402000 }), // 1k different
  ]);
  const { dropped, warns } = validateCapturingWarns(evs);
  assert.equal(dropped.length, 0, 'a differing field → fail toward keeping the data');
  assert.ok(warns.some(w => /fields DIFFER/.test(w)), 'still warns loudly about the suspicious pair');
});

// --- 4. manual slots 8/9 are exempt ---------------------------------------------------------
ok('identical manual terminals on slots 8/9 are NEVER dropped (no GE state machine)', () => {
  const evs = events([
    raw({ state: 'BOUGHT', slot: 8, item: 400, time: '10:00:00', filledQty: 5, grossWorth: 500, offerSize: 5, priceEach: 100 }),
    raw({ state: 'BOUGHT', slot: 8, item: 400, time: '10:05:00', filledQty: 5, grossWorth: 500, offerSize: 5, priceEach: 100 }), // identical, would drop on a GE slot
    raw({ state: 'SOLD',   slot: 9, item: 400, time: '11:00:00', filledQty: 5, grossWorth: 900, offerSize: 5, priceEach: 180 }),
    raw({ state: 'SOLD',   slot: 9, item: 400, time: '11:05:00', filledQty: 5, grossWorth: 900, offerSize: 5, priceEach: 180 }), // identical mobile line
  ]);
  const { dropped } = validateCapturingWarns(evs);
  assert.equal(dropped.length, 0, 'manual/mobile slots exempt — identical repeats are legitimate there');
  assert.equal(validateSlotTransitions(evs).events.length, evs.length, 'every manual event survives');
});

// --- 5. P/L safety: dropping the phantom yields the one-real-buy reconstruction --------------
ok('reconstruction after validation reflects ONE bludgeon bought, not a phantom two', () => {
  const evs = events(bludgeonReEmit);
  const phantomIncluded = reconstruct(evs);                                  // no validation
  const validated = reconstruct(validateCapturingWarns(evs).events);         // LH1 applied (warns captured)
  // (dedupeSnapshots inside reconstruct() already collapses this exact pair, so the phantom-included
  // path also reads 1 — the point here is that VALIDATION independently yields the correct 1, and the
  // total is stable either way; the win LH1 adds over the silent backstop is the loud drop + no
  // phantom in fills.json, proven by tests 1 and 6.)
  assert.deepEqual(validated.open.map(o => [o.itemId, o.qty]), [[13263, 1]], 'one bludgeon held after validation');
  assert.equal(phantomIncluded.open.reduce((s, o) => s + o.qty, 0), 1, 'derivation backstop agrees: 1 held');
});

// --- 6. REMOVE tombstone still works on the validated stream --------------------------------
ok('a REMOVE tombstone purges a SURVIVING event after validation', () => {
  // A clean placement (filled 0) + one real BOUGHT + an identical re-emit; validation drops the
  // phantom, leaving the placement (filled 0 → no lot) and the one real BOUGHT (filled 1 → the lot).
  const evs = validateSlotTransitions(events([
    raw({ state: 'BUYING', slot: 7, item: 13263, time: '13:25:00', filledQty: 0, grossWorth: 0, offerSize: 1, priceEach: 17401000 }),
    raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:25:53', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
    raw({ state: 'BOUGHT', slot: 7, item: 13263, time: '13:29:01', filledQty: 1, grossWorth: 17401000, offerSize: 1, priceEach: 17401000 }),
  ])).events;
  for (const e of evs) e.id = eventId(e);
  assert.deepEqual(reconstruct(evs).open.map(o => [o.itemId, o.qty]), [[13263, 1]], 'one real lot before tombstoning');
  const survivingBuy = evs.find(e => e.state === 'complete' && e.slot === 7 && e.filled > 0);
  assert.ok(survivingBuy, 'the one real buy survived validation');
  // mirror the sync merge + tombstone filter: drop the surviving buy's id from the set.
  const merged = evs.filter(e => e.id !== survivingBuy.id);
  assert.deepEqual(reconstruct(merged).open, [], 'tombstoning the surviving buy leaves no open lot — tombstones unaffected by LH1');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
