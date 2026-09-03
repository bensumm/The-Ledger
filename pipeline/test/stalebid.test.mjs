#!/usr/bin/env node
/**
 * stalebid.test.mjs — FD4: bid declaration store (lib/thesis/bidthesis.mjs) + stale-bid staleness
 * read / dedupe policy (lib/signal/stalebid.mjs).
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - bidthesis mirrors the holdthesis store contract: load degrades to [] on any failure; lookup
 *     is keyed (id, side) with most-recent-ts winning; upsert replaces (never duplicates); clear
 *     drops one side or both; prune TTLs stale declarations but keeps ts-less entries (the
 *     deliberate holdthesis gap — the CLI saves the pruned store, so expiring a ts-less entry
 *     would delete a hand-written declaration on the next write); mutators are PURE.
 *   - staleBidRead fires on EITHER trigger: episode age ≥ STALE_BID_HOURS (the named placeholder,
 *     n≈0), or a FULL buy-dip-window occurrence elapsed while the bid rested unfilled. A null
 *     placedTs can never fire (no age data — honest degrade, not a default-stale).
 *   - buyWindowPassed: a bid placed mid-window gets its next full window; a degenerate full-day
 *     window (startH === endH) never "passes"; midnight-spanning windows work.
 *   - Declaration silencing is the CALLER's contract (watch checks bidThesisFor BEFORE reading);
 *     pinned here as: an unexpired declaration is returned, an expired one is pruned away.
 *   - Dedupe policy: print on first firing; identical state re-fires nothing; further fill, a new
 *     whole-day age bucket, or a reason change re-surfaces.
 *   - staleBidLine carries the unfilled remainder, resting time, reclaimable escrow
 *     (max(0,max−qty)×offer — the suspectBidEscrow formula), and both options; it NEVER pitches a
 *     chase ("reprice up so it fills" wording is banned — the reprice is window-named or absent).
 *
 * Synthetic fixtures only. Run: node pipeline/test/stalebid.test.mjs (non-zero exit on failure).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadBidThesis, saveBidThesis, bidThesisFor, upsertBidThesis, clearBidThesis, pruneBidThesis,
  BID_THESIS_TTL_DAYS,
} from '../lib/thesis/bidthesis.mjs';
import {
  STALE_BID_HOURS, buyWindowPassed, staleBidRead, staleBidState, shouldResurfaceStale, staleBidLine,
  staleBidNotes,
} from '../lib/signal/stalebid.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const NOW_S = 1_800_000_000;         // unix seconds (store fixtures)
const DAY_S = 86400;
const H = 3600e3;                    // ms per hour

/* ── bidthesis store ─────────────────────────────────────────────────────────────────────────── */
ok('loadBidThesis degrades to [] on missing / corrupt / non-array', () => {
  assert.deepEqual(loadBidThesis(path.join(os.tmpdir(), 'fd4-nope-' + Date.now() + '.json')), []);
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fd4-')), 's.json');
  fs.writeFileSync(p, '{ not json');
  assert.deepEqual(loadBidThesis(p), []);
  fs.writeFileSync(p, '{"id":1}');
  assert.deepEqual(loadBidThesis(p), []);
});

ok('save/load round-trips; upsert replaces per (id, side) and is PURE', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fd4-')), 's.json');
  const s0 = [];
  const s1 = upsertBidThesis(s0, { id: 5075, note: 'deep ladder' }, NOW_S);
  assert.equal(s0.length, 0, 'input untouched (pure)');
  const s2 = upsertBidThesis(s1, { id: 5075, note: 'updated' }, NOW_S + 10);
  assert.equal(s2.length, 1, 'same (id, side) replaced, never duplicated');
  assert.equal(s2[0].note, 'updated');
  const s3 = upsertBidThesis(s2, { id: 5075, side: 'sell', note: 'ask ladder' }, NOW_S);
  assert.equal(s3.length, 2, 'the other side is a distinct key');
  saveBidThesis(p, s3);
  assert.deepEqual(loadBidThesis(p), s3);
});

ok('bidThesisFor keys on (id, side), defaults side buy, most-recent ts wins', () => {
  const s = [
    { id: 9, side: 'buy', note: 'old', ts: NOW_S - 100 },
    { id: 9, side: 'buy', note: 'new', ts: NOW_S },     // hand-written duplicate: newest wins
    { id: 9, side: 'sell', note: 'ask', ts: NOW_S },
    { id: 9, note: 'sideless', ts: NOW_S - 500 },        // side omitted → treated as buy
  ];
  assert.equal(bidThesisFor(s, 9).note, 'new');
  assert.equal(bidThesisFor(s, 9, 'sell').note, 'ask');
  assert.equal(bidThesisFor(s, 404), null);
});

ok('clearBidThesis drops one side, or both when side is null', () => {
  const s = [{ id: 9, side: 'buy', ts: NOW_S }, { id: 9, side: 'sell', ts: NOW_S }, { id: 7, side: 'buy', ts: NOW_S }];
  assert.deepEqual(clearBidThesis(s, 9, 'buy').map(e => [e.id, e.side]), [[9, 'sell'], [7, 'buy']]);
  assert.deepEqual(clearBidThesis(s, 9).map(e => e.id), [7]);
  assert.equal(s.length, 3, 'pure');
});

ok('pruneBidThesis TTLs stale declarations, keeps fresh + ts-less, drops malformed', () => {
  const s = [
    { id: 1, side: 'buy', ts: NOW_S - (BID_THESIS_TTL_DAYS + 1) * DAY_S },  // expired → flag re-arms
    { id: 2, side: 'buy', ts: NOW_S - 1 * DAY_S },                           // fresh
    { id: 3, side: 'buy' },                                                  // ts-less: kept (see header)
    null, { side: 'buy', ts: NOW_S },                                        // malformed → dropped
  ];
  assert.deepEqual(pruneBidThesis(s, NOW_S).map(e => e.id), [2, 3]);
});

/* ── buyWindowPassed ─────────────────────────────────────────────────────────────────────────── */
// A fixed local reference clock: 2027-01-15 12:00 local.
const AT = (h, m = 0, dayOff = 0) => new Date(2027, 0, 15 + dayOff, h, m, 0, 0);

ok('buyWindowPassed: bid resting through a completed window → true', () => {
  // window 02-05; now 12:00; bid placed yesterday 20:00 → today's 02-05 elapsed in full while resting
  assert.equal(buyWindowPassed(AT(20, 0, -1).getTime(), { startH: 2, endH: 5 }, AT(12)), true);
});
ok('buyWindowPassed: bid placed mid-window is NOT passed (gets its next full window)', () => {
  assert.equal(buyWindowPassed(AT(3).getTime(), { startH: 2, endH: 5 }, AT(12)), false);
});
ok('buyWindowPassed: bid placed after the window ended → false until the next occurrence completes', () => {
  assert.equal(buyWindowPassed(AT(6).getTime(), { startH: 2, endH: 5 }, AT(12)), false);
  // …and true once tomorrow's occurrence has fully elapsed
  assert.equal(buyWindowPassed(AT(6).getTime(), { startH: 2, endH: 5 }, AT(12, 0, 1)), true);
});
ok('buyWindowPassed: now INSIDE the window does not count the current occurrence', () => {
  // now 04:00, window 02-05: current occurrence incomplete; yesterday's 02-05 did complete for an old bid
  assert.equal(buyWindowPassed(AT(20, 0, -1).getTime(), { startH: 2, endH: 5 }, AT(4)), false);
  assert.equal(buyWindowPassed(AT(20, 0, -2).getTime(), { startH: 2, endH: 5 }, AT(4)), true);
});
ok('buyWindowPassed: midnight-spanning window (22-03)', () => {
  // now 12:00; last completed occurrence started yesterday 22:00, ended today 03:00
  assert.equal(buyWindowPassed(AT(21, 0, -1).getTime(), { startH: 22, endH: 3 }, AT(12)), true);
  assert.equal(buyWindowPassed(AT(23, 0, -1).getTime(), { startH: 22, endH: 3 }, AT(12)), false, 'placed inside it');
});
ok('buyWindowPassed: degenerate full-day window / null inputs never pass', () => {
  assert.equal(buyWindowPassed(AT(0, 0, -9).getTime(), { startH: 7, endH: 7 }, AT(12)), false);
  assert.equal(buyWindowPassed(null, { startH: 2, endH: 5 }, AT(12)), false);
  assert.equal(buyWindowPassed(AT(0).getTime(), null, AT(12)), false);
});

/* ── staleBidRead (the trigger pair) ─────────────────────────────────────────────────────────── */
ok('staleBidRead: age ≥ STALE_BID_HOURS fires reason "age" (no window in hand)', () => {
  const nowMs = AT(12).getTime();
  const r = staleBidRead({ placedTs: nowMs - (STALE_BID_HOURS + 2) * H, nowMs });
  assert.equal(r.reason, 'age');
  assert.ok(r.ageH > STALE_BID_HOURS);
  assert.equal(staleBidRead({ placedTs: nowMs - (STALE_BID_HOURS - 1) * H, nowMs }), null, 'under the placeholder → quiet');
});
ok('staleBidRead: a passed buy window fires at LOW age (reason "window-passed")', () => {
  const nowMs = AT(12).getTime();                                  // placed 7h ago at 05:00…
  const r = staleBidRead({ placedTs: AT(5).getTime(), dipWindow: { startH: 8, endH: 11 }, nowMs });
  assert.equal(r.reason, 'window-passed', 'the 08-11 window elapsed while resting');
  assert.ok(r.ageH < STALE_BID_HOURS, 'fires well under the age placeholder');
});
ok('staleBidRead: both triggers → reason "window+age"', () => {
  const nowMs = AT(12).getTime();
  const r = staleBidRead({ placedTs: nowMs - 30 * H, dipWindow: { startH: 8, endH: 11 }, nowMs });
  assert.equal(r.reason, 'window+age');
});
ok('staleBidRead: null placedTs can never fire (honest degrade, not default-stale)', () => {
  assert.equal(staleBidRead({ placedTs: null, dipWindow: { startH: 0, endH: 23 }, nowMs: AT(12).getTime() }), null);
});

/* ── declaration silencing (the caller contract watch encodes) ───────────────────────────────── */
ok('an unexpired declaration is found (watch silences); an expired one prunes away (flag re-arms)', () => {
  const fresh = pruneBidThesis(upsertBidThesis([], { id: 5075, note: 'deep' }, NOW_S), NOW_S + DAY_S);
  assert.ok(bidThesisFor(fresh, 5075), 'declared + fresh → silenced');
  const expired = pruneBidThesis(upsertBidThesis([], { id: 5075 }, NOW_S), NOW_S + (BID_THESIS_TTL_DAYS + 1) * DAY_S);
  assert.equal(bidThesisFor(expired, 5075), null, 'TTL out → the read runs again');
});

/* ── dedupe / re-surface policy ──────────────────────────────────────────────────────────────── */
ok('dedupe: first firing prints; identical state is silent; fill/ageDay/reason changes re-surface', () => {
  const read = { reason: 'age', ageH: 26 };
  const cur = staleBidState(read, { qty: 0, max: 100, offer: 500 });
  assert.equal(shouldResurfaceStale(undefined, cur), true, 'no prior → print');
  assert.equal(shouldResurfaceStale(cur, { ...cur }), false, 'unchanged → silent');
  assert.equal(shouldResurfaceStale(cur, { ...cur, filled: 40 }), true, 'further fill → re-surface');
  assert.equal(shouldResurfaceStale(cur, { ...cur, ageDay: cur.ageDay + 1 }), true, 'next whole-day bucket → re-surface');
  assert.equal(shouldResurfaceStale(cur, { ...cur, reason: 'window+age' }), true, 'reason change → re-surface');
});
ok('staleBidState buckets age by whole days', () => {
  assert.equal(staleBidState({ reason: 'age', ageH: 26 }, { qty: 0 }).ageDay, 1);
  assert.equal(staleBidState({ reason: 'age', ageH: 49 }, { qty: 0 }).ageDay, 2);
});

/* ── the rendered line ───────────────────────────────────────────────────────────────────────── */
ok('staleBidLine: remainder, resting time, suspectBidEscrow gp, both options, no chase pitch', () => {
  const line = staleBidLine({
    name: 'Yew logs', off: { qty: 100, max: 500, offer: 250 },
    read: { reason: 'window+age', ageH: 30 }, ageTxt: '30h',
    window: { startH: 2, endH: 5 }, level: 245,
  });
  assert.ok(line.includes('100/500 filled'), 'unfilled remainder visible as filled/max');
  assert.ok(line.includes('resting 30h'), 'resting time');
  assert.ok(line.includes('100k gp escrow reclaimable'), 'escrow = max(0,500−100)×250, fmtP-rendered');
  assert.ok(line.includes('reprice into the buy window'), 'option 1 names the window');
  assert.ok(line.includes('245'), '…and its level');
  assert.ok(line.includes('cancel & redeploy'), 'option 2');
  assert.ok(line.includes('your call'), 'CANCEL stays Ben\'s call — inform, never urge');
  assert.ok(!/so it fills|chase/i.test(line), 'never a chase-bid pitch');
  assert.ok(line.includes('declare-thesis.mjs bid'), 'the silence path is named');
});
ok('staleBidLine: age-only firing with no window degrades to a re-read pointer, never a bare reprice', () => {
  const line = staleBidLine({
    name: 'Yew logs', off: { qty: 0, max: 500, offer: 250 },
    read: { reason: 'age', ageH: 26 }, ageTxt: '26h', window: null, level: null,
  });
  assert.ok(line.includes(`${STALE_BID_HOURS}h placeholder`), 'names the placeholder + that it is uncalibrated');
  assert.ok(line.includes('re-read the window'), 'no invented level');
  assert.ok(line.includes('125k gp escrow reclaimable'));
});

/* ── F2: the repriced-to-live level is NEVER quoted as a window level (the windowread gate) ──── */
ok('staleBidLine: levelBasis "live" suppresses the level — no chase pitch wearing window clothes', () => {
  const args = {
    name: 'Yew logs', off: { qty: 0, max: 500, offer: 154 },
    read: { reason: 'window+age', ageH: 30 }, ageTxt: '30h',
    window: { startH: 2, endH: 5 }, level: 154,
  };
  const live = staleBidLine({ ...args, levelBasis: 'live' });
  assert.ok(!live.includes('@ ~154'), 'a live-basis level must never render as the reprice target');
  assert.ok(live.includes('re-read the window'), 'falls back to the re-read pointer instead');
  const diurnal = staleBidLine({ ...args, levelBasis: 'diurnal' });
  assert.ok(diurnal.includes('reprice into the buy window') && diurnal.includes('@ ~154'),
    'a non-live basis still names the window level');
});

/* ── F1: the shared per-item pass (staleBidNotes) — held/target/bid rows all route through it ── */
const FAKE_LAP = { dipWindow: { startH: 2, endH: 5 }, bid: 245, bidBasis: 'diurnal' };
const mkIt = () => ({ id: 1515, name: 'Yew logs' });   // surface-agnostic: held-ness is not an input
const OLD47H = nowMs => nowMs - 47 * H;

ok('staleBidNotes: a 47h PART-FILLED undeclared bid flags (the accumulate-while-holding shape)', () => {
  const nowMs = AT(12).getTime();
  const newState = {};
  const lines = staleBidNotes(mkIt(), [{ qty: 100, max: 500, offer: 250, placedTs: OLD47H(nowMs) }],
    { store: [], priorState: {}, newState, nowMs, lap: FAKE_LAP });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('⏳ stale bid — Yew logs: 100/500 filled'), 'partial fill visible');
  assert.ok(newState['stalebid:1515:250'], 'dedupe key written');
});
ok('staleBidNotes: a declaration silences the whole pass (no line, no state key)', () => {
  const nowMs = AT(12).getTime();
  const newState = {};
  const store = upsertBidThesis([], { id: 1515, note: 'deep' }, Math.floor(nowMs / 1000));
  const lines = staleBidNotes(mkIt(), [{ qty: 0, max: 500, offer: 250, placedTs: OLD47H(nowMs) }],
    { store, priorState: {}, newState, nowMs, lap: FAKE_LAP });
  assert.deepEqual(lines, []);
  assert.deepEqual(newState, {});
});
ok('staleBidNotes: second pass with unchanged state is deduped silent (key still maintained)', () => {
  const nowMs = AT(12).getTime();
  const s1 = {}, offs = [{ qty: 0, max: 500, offer: 250, placedTs: OLD47H(nowMs) }];
  staleBidNotes(mkIt(), offs, { store: [], priorState: {}, newState: s1, nowMs, lap: FAKE_LAP });
  const s2 = {};
  const again = staleBidNotes(mkIt(), offs, { store: [], priorState: s1, newState: s2, nowMs, lap: FAKE_LAP });
  assert.deepEqual(again, []);
  assert.ok(s2['stalebid:1515:250'], 'key re-written so the dedupe survives further passes');
});
ok('staleBidNotes: a live-basis lap never quotes its level (F2 through the composition)', () => {
  const nowMs = AT(12).getTime();
  const lines = staleBidNotes(mkIt(), [{ qty: 0, max: 500, offer: 154, placedTs: OLD47H(nowMs) }],
    { store: [], priorState: {}, newState: {}, nowMs, lap: { ...FAKE_LAP, bid: 154, bidBasis: 'live' } });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('@ ~154') && lines[0].includes('re-read the window'));
});

/* ── F1 wiring pin: watch-positions.mjs routes ALL THREE row kinds through staleBidNotes.
 * A source-shape check (the call sites live inside main(), unreachable by a unit test): the held,
 * target and standalone-bid loops must each call staleBidNotes — removing any call site fails here. */
ok('watch-positions.mjs carries the held + target + bid staleBidNotes call sites', () => {
  const src = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'commands', 'watch-positions.mjs'), 'utf8');
  const calls = (src.match(/staleBidNotes\(it,/g) || []).length;
  assert.ok(calls >= 3, `expected >=3 staleBidNotes(it, ...) call sites (held/target/bid), found ${calls}`);
  assert.ok(/bids\.filter\(b => b\.item === it\.id\)/.test(src), 'held/target sites read the item\'s own open bids');
});

console.log(`stalebid.test.mjs: all ${pass} assertions passed`);
