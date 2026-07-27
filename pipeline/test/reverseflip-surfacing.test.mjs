#!/usr/bin/env node
/**
 * reverseflip-surfacing.test.mjs — acceptance fixtures for RF4 (PLAN-REVERSE-FLIP): the reverse-flip
 * cycle-state SURFACING into the three read surfaces (/schedule, /book, /positions).
 *
 * Fixtures ONLY — no live logs, no market fetch, no fs read (the store array is handed in directly).
 * TZ-HERMETIC: every days-pending / stale read is off an INJECTED `now` (unix-ms), so CI's UTC clock
 * can't shift a result. process.env.TZ is pinned at the top for the same reason.
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - reverseFlipPendingEntries excludes `holding` (pre-sell); folds live mark + thin read from in-hand
 *     data; degrades to store-only fields when no info is passed. daysPending off soldTs (declaredTs fallback).
 *   - reverseFlipCycleNotes: a thin big-ticket row → the rebuy-strand caution; a passed driftNote rides;
 *     a cycle pending > REBUY_STALE_DAYS → the stale nudge. None on a liquid, fresh cycle.
 *   - read-schedule reverseFlipRows: one row per entry, tagged RF (rf:true), action names the leg, windowed
 *     on the in-hand profile's dip/peak (null window → inH null, sorts LAST); an EMPTY store → ZERO rows.
 *   - book-model buildReverseFlipPending: awaiting/armed entries → rendered rows (soldTxt/beRebuyTxt/
 *     liveTxt/daysPendingTxt + notes); an EMPTY / all-holding store → [] (zero-ripple: read-book prints nothing).
 *   - quote-items reverseFlipPositionLines: a non-empty store → a labelled block of lines; an EMPTY store → [].
 */
process.env.TZ = 'UTC';
import assert from 'node:assert/strict';
import {
  reverseFlipPendingEntries, reverseFlipCycleNotes, rebuyStaleNote, daysPending, REBUY_STALE_DAYS,
} from '../../js/reverseflip.mjs';
import { reverseFlipRows, sortRows, agendaRowsForItem } from '../commands/read-schedule.mjs';
import { buildReverseFlipPending } from '../lib/capital/book-model.mjs';
import { reverseFlipPositionLines } from '../commands/quote-items.mjs';
import { fmt, fmtP } from '../../js/money-format.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const NOW = 1_800_000_000_000;               // fixed unix-ms "now"
const nowSec = Math.floor(NOW / 1000);
const daysAgoSec = d => nowSec - d * 86400;

// A thin big-ticket quote row (guide ≥ 10m, low vol) → isThinBigTicket true.
const THIN_ROW = { guide: 55_000_000, volDay: 135 };
// A liquid big-ticket row → isThinBigTicket false (vol above the thin floor).
const LIQUID_ROW = { guide: 55_000_000, volDay: 50_000 };

// --- shared fixture store: one awaiting-rebuy (fresh, thin) + one rebuy-armed (stale) + one holding ------
const STORE = [
  { id: 100, name: 'Ancestral hat', state: 'awaiting-rebuy', soldQty: 1, soldEach: 57_000_000,
    beRebuy: 55_860_000, soldTs: daysAgoSec(1), declaredTs: daysAgoSec(1) },
  { id: 200, name: 'Twisted bow', state: 'rebuy-armed', soldQty: 1, soldEach: 1_200_000_000,
    beRebuy: 1_176_000_000, rebuyBidPrice: 1_150_000_000, soldTs: daysAgoSec(5), declaredTs: daysAgoSec(5) },
  { id: 300, name: 'Holding item', state: 'holding', soldEach: null, declaredTs: daysAgoSec(0) },
];

console.log('RF4 shared core (reverseFlipPendingEntries / notes):');

ok('daysPending off soldTs; declaredTs fallback; null when neither', () => {
  assert.equal(daysPending({ soldTs: daysAgoSec(2) }, NOW), 2);
  assert.equal(daysPending({ declaredTs: daysAgoSec(3) }, NOW), 3);
  assert.equal(daysPending({}, NOW), null);
});

ok('reverseFlipPendingEntries excludes holding; includes awaiting + armed', () => {
  const e = reverseFlipPendingEntries(STORE, { now: NOW });
  assert.equal(e.length, 2, 'holding excluded');
  assert.deepEqual(e.map(x => x.state).sort(), ['awaiting-rebuy', 'rebuy-armed']);
});

ok('reverseFlipPendingEntries folds an in-hand live mark + thin read; degrades without info', () => {
  const marks = new Map([[100, { mark: 56_000_000 }]]);
  const infoById = { 100: { row: THIN_ROW } };
  const e = reverseFlipPendingEntries(STORE, { marks, infoById, now: NOW });
  const hat = e.find(x => x.id === 100);
  assert.equal(hat.live, 56_000_000, 'live from the marks map');
  assert.equal(hat.thin, true, 'thin big-ticket detected off the in-hand row');
  const bow = e.find(x => x.id === 200);
  assert.equal(bow.live, null, 'no mark/info → live null (no fabrication)');
  assert.equal(bow.thin, false, 'no row → not thin');
});

ok('reverseFlipCycleNotes: thin → strand; driftNote rides; stale cycle → nudge', () => {
  const hat = STORE[0];                         // 1 day pending → not stale
  const n1 = reverseFlipCycleNotes(hat, { row: THIN_ROW, driftNote: '3-day hourly drift: uniform step-up ~500k/d', now: NOW, fmt });
  assert.ok(n1.some(x => /rebuy may strand/.test(x)), 'thin → strand caution');
  assert.ok(n1.some(x => /hourly drift/.test(x)), 'passed driftNote rides');
  assert.ok(!n1.some(x => /pending/.test(x)), '1d < REBUY_STALE_DAYS → no stale nudge');

  const bow = STORE[1];                          // 5 days pending → stale
  const n2 = reverseFlipCycleNotes(bow, { row: LIQUID_ROW, now: NOW, fmt });
  assert.ok(!n2.some(x => /strand/.test(x)), 'liquid → no strand');
  assert.ok(n2.some(x => /pending ~5\.0d/.test(x) && /REBUY_STALE_DAYS/.test(x)), 'stale nudge with the named placeholder');
});

ok('rebuyStaleNote respects the REBUY_STALE_DAYS placeholder boundary', () => {
  assert.equal(rebuyStaleNote({ soldTs: daysAgoSec(REBUY_STALE_DAYS - 0.1) }, NOW), null, 'just under → null');
  assert.ok(rebuyStaleNote({ soldTs: daysAgoSec(REBUY_STALE_DAYS + 1) }, NOW), 'over → note');
});

console.log('\nRF4 /schedule reverseFlipRows:');

ok('EMPTY store → ZERO rows (byte-identical agenda guard)', () => {
  assert.deepEqual(reverseFlipRows([], {}), []);
  assert.deepEqual(reverseFlipRows(null, {}), []);
});

ok('one RF row per entry, tagged RF (rf:true), action names the leg', () => {
  const rows = reverseFlipRows(STORE, { now: NOW });
  assert.equal(rows.length, 3, 'holding + awaiting + armed each get an agenda row');
  assert.ok(rows.every(r => r.rf === true && r.tags.join('') === 'RF'));
  const byId = Object.fromEntries(rows.map(r => [r.item, r]));
  assert.match(byId['Ancestral hat'].action, /REBUY dip \(RF\)/);
  assert.match(byId['Twisted bow'].action, /REBUY armed \(RF\)/);
  assert.match(byId['Holding item'].action, /SELL peak \(RF\)/);
});

ok('windowed on the in-hand profile dip/peak; null profile → inH null, sorts LAST', () => {
  const at = { getHours: () => 10, getMinutes: () => 0 };   // read-schedule uses getHours/getMinutes
  const profileByItem = {
    100: { dip: { startH: 12, endH: 14, level: 55_000_000 }, peak: { startH: 20, endH: 22, level: 57_000_000 } },
  };
  const rows = reverseFlipRows(STORE, { profileByItem, now: at });
  const hat = rows.find(r => r.item === 'Ancestral hat');
  assert.equal(hat.inH, 2.0, 'dip start 12 is 2h from 10:00');
  assert.equal(hat.startH, 12);
  const bow = rows.find(r => r.item === 'Twisted bow');
  assert.equal(bow.inH, null, 'no profile → null window');
  // a null-window RF row sorts to the end, never displacing a real agenda window.
  const normal = agendaRowsForItem({ name: 'N', profile: { dip: { startH: 11, endH: 13, level: 1 }, peak: { startH: 15, endH: 16, level: 2 } }, now: at });
  const sorted = sortRows([...rows, ...normal]);
  assert.equal(sorted[sorted.length - 1].inH, null, 'null-inH RF row sorts LAST');
});

ok('RF rows carry the shared notes (thin strand / stale nudge)', () => {
  const profileByItem = { 100: { dip: { startH: 12, endH: 14 }, row: THIN_ROW } };
  const rows = reverseFlipRows(STORE, { profileByItem, now: NOW });
  const hat = rows.find(r => r.item === 'Ancestral hat');
  assert.ok(hat.notes.some(n => /strand/.test(n)), 'thin → strand note (row carried on the profile)');
  const bow = rows.find(r => r.item === 'Twisted bow');
  assert.ok(bow.notes.some(n => /pending ~5\.0d/.test(n)), '5d pending → stale nudge');
});

console.log('\nRF4 /book buildReverseFlipPending:');

ok('EMPTY / all-holding store → [] (zero-ripple; read-book prints nothing)', () => {
  assert.deepEqual(buildReverseFlipPending([], { now: NOW }), []);
  assert.deepEqual(buildReverseFlipPending([STORE[2]], { now: NOW }), [], 'a lone holding entry → no pending rows');
});

ok('awaiting/armed → rendered rows with sold/BE-rebuy/live/days-pending + notes', () => {
  const marks = new Map([[100, { mark: 56_000_000 }]]);
  const infoById = { 100: { row: THIN_ROW } };
  const rows = buildReverseFlipPending(STORE, { marks, infoById, now: NOW, fmt, fmtP });
  assert.equal(rows.length, 2);
  const hat = rows.find(r => r.id === 100);
  assert.equal(hat.soldTxt, fmtP(57_000_000));
  assert.equal(hat.beRebuyTxt, fmtP(55_860_000));
  assert.equal(hat.liveTxt, fmtP(56_000_000));
  assert.equal(hat.daysPendingTxt, '1.0d');
  assert.ok(hat.notes.some(n => /strand/.test(n)), 'thin hat carries the strand note');
  const bow = rows.find(r => r.id === 200);
  assert.equal(bow.liveTxt, '—', 'no mark → live dash');
  assert.equal(bow.daysPendingTxt, '5.0d');
});

console.log('\nRF4 /positions reverseFlipPositionLines:');

ok('EMPTY store → [] (no section → byte-identical positions report)', () => {
  assert.deepEqual(reverseFlipPositionLines([], { now: NOW }), []);
  assert.deepEqual(reverseFlipPositionLines([STORE[2]], { now: NOW }), [], 'all-holding → []');
});

ok('non-empty store → a labelled block of lines with the cycle fields + notes', () => {
  const lines = reverseFlipPositionLines(STORE, { marks: new Map([[100, { mark: 56_000_000 }]]), infoById: { 100: { row: THIN_ROW } }, now: NOW });
  assert.ok(lines.length >= 3);
  assert.ok(lines.some(l => /Reverse-flip pending/.test(l)), 'section label present');
  assert.ok(lines.some(l => /Ancestral hat \[awaiting-rebuy\]/.test(l)));
  assert.ok(lines.some(l => /Twisted bow \[rebuy-armed\]/.test(l)));
  assert.ok(lines.some(l => /strand/.test(l)), 'thin hat strand note rendered');
  assert.ok(lines.some(l => /pending ~5\.0d/.test(l)), 'stale bow nudge rendered');
});

console.log(`\nAll ${pass} RF4 surfacing acceptance checks passed.`);
