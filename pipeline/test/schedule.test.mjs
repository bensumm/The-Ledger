#!/usr/bin/env node
/**
 * schedule.test.mjs — acceptance fixtures for read-schedule.mjs (PLAN-SCHEDULE).
 *
 * Fixtures ONLY — no live logs, no market fetch (CLAUDE.md rule 4). The pure `In (h)` math
 * (hoursUntil/isInsideWindow) is the fiddly bit the plan flags for real fixture discipline
 * (midnight-wrap + inside-window + rounding), so it gets the bulk of the coverage.
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - hoursUntil = hours to the NEXT occurrence of a local start hour, wrapping past midnight,
 *     rounded to nearest 0.5h (round-half-up at an exact .25 boundary).
 *   - isInsideWindow handles non-wrapping (startH≤endH) AND midnight-spanning (startH>endH) windows;
 *     a currently-inside window renders In(h) 0.0, never negative.
 *   - agendaRowsForItem emits up to 2 rows (dip+peak); a null (too-thin) profile emits ZERO.
 *   - resolveWatchlist skips an unresolvable name WITH a warning, never aborts.
 *   - buildAudit surfaces only flipped ids whose NAME is not watchlisted, count+summed realised,
 *     sorted by trade count desc.
 */
import assert from 'node:assert/strict';
import {
  hoursUntil, isInsideWindow, agendaRowsForItem, sortRows,
  resolveWatchlist, buildAudit, loopHeaderLine,
} from '../commands/read-schedule.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
// a fixed "now" stub — hoursUntil/windowInH only read getHours()/getMinutes()
const at = (h, m = 0) => ({ getHours: () => h, getMinutes: () => m });

console.log('read-schedule In(h) math acceptance:');

// --- (a) ordinary case: startH a few hours ahead of now ---------------------------------------
ok('ordinary: now 09:00, start 13 → 4.0h ahead', () => {
  assert.equal(hoursUntil(13, at(9, 0)), 4.0);
});
ok('ordinary with minutes: now 09:20, start 12 → 2.6667 rounds to 2.5h', () => {
  assert.equal(hoursUntil(12, at(9, 20)), 2.5);   // 2.6667 → round(5.333)/2 = 5/2 = 2.5
});

// --- (b) midnight-wrap next-start: now late evening, start early morning -----------------------
ok('midnight-wrap: now 23:10, start 02 → ~2.83h rounds to 3.0h', () => {
  assert.equal(hoursUntil(2, at(23, 10)), 3.0);   // (2 - 23.1667 + 24) = 2.8333 → round(5.667)/2 = 3.0
});
ok('midnight-wrap exact: now 22:00, start 01 → 3.0h', () => {
  assert.equal(hoursUntil(1, at(22, 0)), 3.0);
});

// --- (c) currently inside a window → 0.0, never negative (via agendaRowsForItem's windowInH) ---
ok('inside a NON-wrapping window (02-08, now 04) → dip row In(h) 0.0', () => {
  const rows = agendaRowsForItem({
    name: 'X', profile: { dip: { startH: 2, endH: 8, level: 100 }, peak: { startH: 14, endH: 16, level: 200 } },
    now: at(4, 30),
  });
  const dip = rows.find(r => r.action === 'BUY dip');
  assert.equal(dip.inH, 0);
  assert.ok(rows.every(r => r.inH >= 0), 'no negative In(h)');
});
ok('inside a MIDNIGHT-SPANNING window (22-03, now 01) → In(h) 0.0', () => {
  // window 22→03 spans midnight; now 01:00 is inside
  const rows = agendaRowsForItem({
    name: 'Y', profile: { dip: { startH: 22, endH: 3, level: 5 }, peak: { startH: 12, endH: 13, level: 9 } },
    now: at(1, 0),
  });
  const dip = rows.find(r => r.action === 'BUY dip');
  assert.equal(dip.inH, 0, 'nowH 1 is inside 22→03');
});
ok('isInsideWindow branch coverage', () => {
  assert.equal(isInsideWindow(2, 8, 4), true);    // non-wrapping, inside
  assert.equal(isInsideWindow(2, 8, 8), false);   // non-wrapping, at end (exclusive)
  assert.equal(isInsideWindow(2, 8, 1), false);   // non-wrapping, before
  assert.equal(isInsideWindow(22, 3, 1), true);   // wrapping, inside (after midnight)
  assert.equal(isInsideWindow(22, 3, 23), true);  // wrapping, inside (before midnight)
  assert.equal(isInsideWindow(22, 3, 12), false); // wrapping, outside
  assert.equal(isInsideWindow(0, 0, 7), true);    // degenerate full-day cluster → always inside
});

// --- (d) rounding boundary at exactly X.25h → round-half-up ------------------------------------
ok('rounding boundary: now 02:45, start 05 → exactly 2.25h rounds UP to 2.5h', () => {
  assert.equal(hoursUntil(5, at(2, 45)), 2.5);    // 5 - 2.75 = 2.25 → round(4.5)/2 = 5/2 = 2.5
});
ok('rounding boundary: now 02:15, start 05 → exactly 2.75h rounds UP to 3.0h', () => {
  assert.equal(hoursUntil(5, at(2, 15)), 3.0);    // 5 - 2.25 = 2.75 → round(5.5)/2 = 6/2 = 3.0
});

console.log('\nread-schedule row-building acceptance:');

// --- a null (too-thin) profile emits zero rows; empty agenda is clean ---------------------------
ok('null profile → zero rows (too thin to schedule)', () => {
  assert.deepEqual(agendaRowsForItem({ name: 'Z', profile: null, now: at(9) }), []);
});
ok('empty agenda: sortRows([]) is [], loopHeaderLine([]) is null', () => {
  assert.deepEqual(sortRows([]), []);
  assert.equal(loopHeaderLine([]), null);
});

// --- end-to-end: 2 items → up to 4 rows, sorted In(h) ascending ---------------------------------
ok('two items → 4 rows sorted by In(h) ascending', () => {
  const now = at(10, 0);
  const a = agendaRowsForItem({ name: 'Aitem', tags: ['C'], now, profile: { dip: { startH: 14, endH: 16, level: 1 }, peak: { startH: 20, endH: 22, level: 2 } } });
  const b = agendaRowsForItem({ name: 'Bitem', tags: ['W'], now, profile: { dip: { startH: 11, endH: 13, level: 3 }, peak: { startH: 12, endH: 13, level: 4 } } });
  const rows = sortRows([...a, ...b]);
  assert.equal(rows.length, 4, 'up to 2 rows/item');
  const inHs = rows.map(r => r.inH);
  assert.deepEqual(inHs, [...inHs].sort((x, y) => x - y), 'ascending In(h)');
  assert.equal(rows[0].item, 'Bitem', 'soonest (start 11, In 1.0) first');
  assert.equal(rows[0].inH, 1.0);
});
ok('loopHeaderLine picks the global minimum row (not the first item)', () => {
  const now = at(10, 0);
  const a = agendaRowsForItem({ name: 'Aitem', tags: ['C'], now, profile: { dip: { startH: 18, endH: 20, level: 1 }, peak: { startH: 22, endH: 23, level: 2 } } });
  const b = agendaRowsForItem({ name: 'Bitem', tags: ['C'], now, profile: { dip: { startH: 11, endH: 13, level: 3 }, peak: { startH: 15, endH: 16, level: 4 } } });
  const line = loopHeaderLine(sortRows([...a, ...b]));
  assert.ok(line.includes('Bitem'), 'soonest window is Bitem dip, not Aitem');
  assert.ok(line.startsWith('⏭ next:'));
});

console.log('\nread-schedule -w resolution acceptance:');

// mock mapping: same shape as marketfetch loadMapping()'s return (resolve + byId)
const mockMapping = {
  byId: { 4151: { name: 'Abyssal whip' }, 561: { name: 'Nature rune' } },
  resolve: (t) => ({ 'abyssal whip': { id: 4151, name: 'Abyssal whip' }, 'nature rune': { id: 561, name: 'Nature rune' } })[String(t).toLowerCase()] || null,
};

ok('resolveWatchlist: a known name resolves, an unknown name skips WITH a warning (no abort)', () => {
  const { items, warnings } = resolveWatchlist(['Abyssal whip', 'Notanitem xyz'], mockMapping);
  assert.equal(items.length, 1, 'only the resolvable name survives');
  assert.deepEqual(items[0], { id: 4151, name: 'Abyssal whip' });
  assert.equal(warnings.length, 1, 'the bad name produces exactly one warning');
  assert.ok(/Notanitem xyz/.test(warnings[0]) && /skipped/.test(warnings[0]));
});

console.log('\nread-schedule --audit acceptance:');

ok('buildAudit surfaces only the NOT-watchlisted flipped id, count + summed realised, sorted desc', () => {
  const closed = [
    { itemId: 4151, realised: 100 },   // Abyssal whip — WATCHLISTED → excluded
    { itemId: 561, realised: 20 },     // Nature rune — not watchlisted
    { itemId: 561, realised: 30 },     // Nature rune again → count 2, realised 50
    { itemId: 999, realised: 5 },      // unknown id → '#999', not watchlisted
  ];
  const rows = buildAudit({ closed, watchNames: ['Abyssal whip'], mapping: mockMapping });
  assert.equal(rows.length, 2, 'whip is watchlisted → excluded; nature rune + #999 remain');
  assert.equal(rows[0].item, 'Nature rune', 'most-flipped first (2 trades)');
  assert.equal(rows[0].trades, 2);
  assert.equal(rows[0].realised, 50, 'summed realised');
  assert.equal(rows[1].item, '#999', 'unknown id → #<id> fallback, still surfaced');
});
ok('buildAudit: empty closed → empty rows (no crash)', () => {
  assert.deepEqual(buildAudit({ closed: [], watchNames: [], mapping: mockMapping }), []);
  assert.deepEqual(buildAudit({ closed: null, watchNames: null, mapping: mockMapping }), []);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
