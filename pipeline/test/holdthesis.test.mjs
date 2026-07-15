#!/usr/bin/env node
/**
 * holdthesis.test.mjs — the TG1 agent-written declared-hold-thesis store (pipeline/lib/holdthesis.mjs).
 *
 * The store is the read side of the thesis-gated hold alert (TG1). watch.mjs reads it READ-ONLY to
 * silence the expected-underwater headline while a lot holds above its declared tripwire. These
 * fixtures pin the store contract so a future editor can't silently break the read/write shape.
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - loadHoldThesis DEGRADES to [] on any failure (missing / corrupt / non-array) — a bad store
 *     file must NEVER break a watch pass (matches watchstate.loadState).
 *   - thesisFor returns the active entry for an id (the most-recently-declared when several), else null.
 *   - upsertThesis REPLACES an existing entry for the id (never duplicates); entry shape is
 *     {id, exitPrice, tripwire, horizon, ts}.
 *   - clearThesis removes every entry for an id.
 *   - pruneHoldThesis drops entries older than the TTL (stale declared intent) and malformed rows.
 *   - all mutators are PURE (return a new array, never mutate the input).
 *
 * Synthetic fixtures only. Run: `node pipeline/lib/holdthesis.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadHoldThesis, saveHoldThesis, thesisFor, upsertThesis, clearThesis, pruneHoldThesis,
  HOLD_THESIS_TTL_DAYS,
} from '../lib/holdthesis.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const NOW = 1_800_000_000;   // arbitrary base unix seconds
const DAY = 86400;

/* --- load degrades to [] on any failure ---------------------------------------------------- */
ok('loadHoldThesis degrades to [] on a missing file', () => {
  assert.deepEqual(loadHoldThesis(path.join(os.tmpdir(), 'tg1-does-not-exist-' + Date.now() + '.json')), []);
});
ok('loadHoldThesis degrades to [] on corrupt JSON and on a non-array', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg1-')), 'store.json');
  fs.writeFileSync(p, '{ not json');
  assert.deepEqual(loadHoldThesis(p), [], 'corrupt JSON → []');
  fs.writeFileSync(p, '{"id":123}');   // valid JSON but an object, not the array shape
  assert.deepEqual(loadHoldThesis(p), [], 'a non-array store → []');
});

/* --- round-trip through save/load ----------------------------------------------------------- */
ok('saveHoldThesis then loadHoldThesis round-trips the array', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg1-')), 'store.json');
  const store = [{ id: 5075, exitPrice: 4848, tripwire: 4678, horizon: 'multi-day', ts: NOW }];
  saveHoldThesis(p, store);
  assert.deepEqual(loadHoldThesis(p), store);
});

/* --- thesisFor ------------------------------------------------------------------------------- */
ok('thesisFor returns the entry for an id, else null', () => {
  const store = [{ id: 5075, tripwire: 4678, ts: NOW }];
  assert.equal(thesisFor(store, 5075).tripwire, 4678);
  assert.equal(thesisFor(store, 999), null);
  assert.equal(thesisFor([], 5075), null);
  assert.equal(thesisFor(null, 5075), null);
});
ok('thesisFor picks the MOST-RECENTLY-declared when several entries share an id', () => {
  const store = [{ id: 5075, tripwire: 4600, ts: NOW - DAY }, { id: 5075, tripwire: 4700, ts: NOW }];
  assert.equal(thesisFor(store, 5075).tripwire, 4700, 'the newest ts wins');
});

/* --- upsert replaces, never duplicates ------------------------------------------------------ */
ok('upsertThesis appends a new entry with the full {id,exitPrice,tripwire,horizon,window,path,enteredUnder,ts} shape', () => {
  const out = upsertThesis([], { id: 5075, exitPrice: 4848, tripwire: 4678, horizon: 'multi-day' }, NOW);
  assert.equal(out.length, 1);
  // P4a: path/enteredUnder (and VN-2: window) are part of the shape now, defaulting to null when omitted.
  assert.deepEqual(out[0], { id: 5075, exitPrice: 4848, tripwire: 4678, horizon: 'multi-day', window: null, path: null, enteredUnder: null, ts: NOW });
});
ok('upsertThesis REPLACES an existing id (no duplicate) and is PURE', () => {
  const before = [{ id: 5075, tripwire: 4678, exitPrice: 4848, horizon: 'multi-day', ts: NOW - DAY }];
  const after = upsertThesis(before, { id: 5075, tripwire: 4700 }, NOW);
  assert.equal(after.filter(e => e.id === 5075).length, 1, 'exactly one entry for the id');
  assert.equal(after[after.length - 1].tripwire, 4700, 'the new tripwire took');
  assert.equal(before[0].tripwire, 4678, 'the input array was not mutated');
});
ok('upsertThesis defaults the optional fields to null', () => {
  const out = upsertThesis([], { id: 42 }, NOW);
  assert.deepEqual(out[0], { id: 42, exitPrice: null, tripwire: null, horizon: null, window: null, path: null, enteredUnder: null, ts: NOW });
});

/* --- P4a: path / enteredUnder are additive + optional; legacy entries stay fully valid ------- */
ok('upsertThesis persists a declared path + enteredUnder (P4a)', () => {
  const out = upsertThesis([], { id: 5075, tripwire: 4678, path: 'value-hold', enteredUnder: 'hold-recovery' }, NOW);
  assert.deepEqual(out[0], { id: 5075, exitPrice: null, tripwire: 4678, horizon: null, window: null, path: 'value-hold', enteredUnder: 'hold-recovery', ts: NOW });
});
ok('a LEGACY entry (no path/enteredUnder keys) loads / looks up / prunes UNCHANGED (P4a back-compat)', () => {
  // exactly the pre-P4a on-disk shape — no path/enteredUnder keys at all.
  const legacy = [{ id: 5075, exitPrice: 4848, tripwire: 4678, horizon: 'multi-day', ts: NOW }];
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg1-')), 'store.json');
  saveHoldThesis(p, legacy);
  assert.deepEqual(loadHoldThesis(p), legacy, 'legacy shape round-trips byte-for-byte (no keys injected on load)');
  assert.equal(thesisFor(legacy, 5075).tripwire, 4678, 'thesisFor reads a legacy entry unchanged');
  assert.deepEqual(pruneHoldThesis(legacy, NOW).map(e => e.id), [5075], 'a fresh legacy entry survives prune unchanged');
  // upserting a NEW field onto a legacy id replaces it with the full shape (legacy value preserved where re-passed).
  const upgraded = upsertThesis(legacy, { id: 5075, tripwire: 4678, horizon: 'multi-day', exitPrice: 4848, path: 'value-hold' }, NOW);
  assert.equal(upgraded[0].path, 'value-hold');
  assert.equal(upgraded[0].enteredUnder, null);
});

/* --- clear ---------------------------------------------------------------------------------- */
ok('clearThesis removes every entry for an id and is PURE', () => {
  const before = [{ id: 5075, ts: NOW }, { id: 99, ts: NOW }];
  const after = clearThesis(before, 5075);
  assert.deepEqual(after.map(e => e.id), [99]);
  assert.equal(before.length, 2, 'input untouched');
});

/* --- prune ---------------------------------------------------------------------------------- */
ok('pruneHoldThesis drops entries older than the TTL and malformed rows', () => {
  const store = [
    { id: 1, tripwire: 100, ts: NOW },                                  // fresh — kept
    { id: 2, tripwire: 100, ts: NOW - (HOLD_THESIS_TTL_DAYS + 1) * DAY }, // stale — dropped
    { id: 3, tripwire: 100 },                                            // no ts — kept (never expires)
    null,                                                                // malformed — dropped
    { tripwire: 100, ts: NOW },                                          // no id — dropped
  ];
  const kept = pruneHoldThesis(store, NOW).map(e => e.id);
  assert.deepEqual(kept, [1, 3], 'fresh + no-ts kept; stale/malformed/id-less dropped');
});

console.log(`\nAll ${pass} checks passed.`);
