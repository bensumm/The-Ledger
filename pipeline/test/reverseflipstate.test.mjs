#!/usr/bin/env node
/**
 * reverseflipstate.test.mjs — RF0: the declared reverse-flip CYCLE store
 * (pipeline/lib/reverseflipstate.mjs, PLAN-REVERSE-FLIP). Mirrors holdthesis.test.mjs.
 *
 * BUSINESS REQUIREMENTS:
 *   - loadReverseFlip DEGRADES to [] on any failure (missing / corrupt / non-array).
 *   - reverseFlipFor returns the most-recently-declared entry for an id, else null.
 *   - upsertReverseFlip REPLACES an id (never duplicates) and PRESERVES unset fields (advance updates
 *     only what changed); all mutators PURE.
 *   - clearReverseFlip removes every entry for an id.
 *   - pruneReverseFlip drops entries older than the TTL and malformed rows.
 *
 * TZ-hermetic (unix seconds only). Run: `node pipeline/test/reverseflipstate.test.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadReverseFlip, saveReverseFlip, reverseFlipFor, upsertReverseFlip, clearReverseFlip, pruneReverseFlip,
  REVERSE_FLIP_STATES, REVERSE_FLIP_TTL_DAYS,
} from '../lib/reverseflipstate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const NOW = 1_800_000_000;
const DAY = 86400;

ok('REVERSE_FLIP_STATES is the declared state machine', () => {
  assert.deepEqual(REVERSE_FLIP_STATES, ['holding', 'awaiting-rebuy', 'rebuy-armed']);
});

ok('loadReverseFlip degrades to [] on missing / corrupt / non-array', () => {
  assert.deepEqual(loadReverseFlip(path.join(os.tmpdir(), 'rf-none-' + Date.now() + '.json')), []);
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')), 'store.json');
  fs.writeFileSync(p, '{ not json'); assert.deepEqual(loadReverseFlip(p), []);
  fs.writeFileSync(p, '{"id":1}'); assert.deepEqual(loadReverseFlip(p), []);
});

ok('save then load round-trips the array', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')), 'store.json');
  const store = [{ id: 21018, name: 'Ancestral hat', state: 'awaiting-rebuy', soldQty: 1, soldEach: 57_000_000, soldTs: NOW, beRebuy: 55_860_000, targetQty: 1, rebuyBidPrice: null, rebuyBidTs: null, declaredTs: NOW }];
  saveReverseFlip(p, store);
  assert.deepEqual(loadReverseFlip(p), store);
});

ok('reverseFlipFor returns the entry for an id (newest declaredTs), else null', () => {
  const store = [{ id: 1, state: 'awaiting-rebuy', declaredTs: NOW - DAY }, { id: 1, state: 'rebuy-armed', declaredTs: NOW }];
  assert.equal(reverseFlipFor(store, 1).state, 'rebuy-armed');
  assert.equal(reverseFlipFor(store, 999), null);
  assert.equal(reverseFlipFor(null, 1), null);
});

ok('upsertReverseFlip appends the full shape and is PURE', () => {
  const out = upsertReverseFlip([], { id: 21018, name: 'Ancestral hat', state: 'awaiting-rebuy', soldQty: 1, soldEach: 57_000_000, soldTs: NOW, beRebuy: 55_860_000, targetQty: 1 }, NOW);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { id: 21018, name: 'Ancestral hat', state: 'awaiting-rebuy', soldQty: 1, soldEach: 57_000_000, soldTs: NOW, beRebuy: 55_860_000, targetQty: 1, rebuyBidPrice: null, rebuyBidTs: null, declaredTs: NOW });
});

ok('upsertReverseFlip REPLACES an id and PRESERVES unset fields (advance only changes state+bid)', () => {
  const set = upsertReverseFlip([], { id: 21018, name: 'Ancestral hat', state: 'awaiting-rebuy', soldQty: 1, soldEach: 57_000_000, soldTs: NOW, beRebuy: 55_860_000, targetQty: 1 }, NOW);
  const adv = upsertReverseFlip(set, { id: 21018, name: 'Ancestral hat', state: 'rebuy-armed', rebuyBidPrice: 54_050_000, rebuyBidTs: NOW + 100 }, NOW + 100);
  assert.equal(adv.filter(e => e.id === 21018).length, 1, 'no duplicate');
  assert.equal(adv[0].state, 'rebuy-armed');
  assert.equal(adv[0].rebuyBidPrice, 54_050_000);
  assert.equal(adv[0].soldEach, 57_000_000, 'sell-leg fields preserved through advance');
  assert.equal(adv[0].beRebuy, 55_860_000, 'beRebuy preserved');
  assert.equal(set[0].state, 'awaiting-rebuy', 'input untouched (PURE)');
});

ok('clearReverseFlip removes every entry for an id and is PURE', () => {
  const before = [{ id: 1, declaredTs: NOW }, { id: 2, declaredTs: NOW }];
  assert.deepEqual(clearReverseFlip(before, 1).map(e => e.id), [2]);
  assert.equal(before.length, 2);
});

ok('pruneReverseFlip drops entries older than the TTL and malformed rows', () => {
  const store = [
    { id: 1, declaredTs: NOW },
    { id: 2, declaredTs: NOW - (REVERSE_FLIP_TTL_DAYS + 1) * DAY },
    { id: 3 },            // no declaredTs → kept
    null,
    { declaredTs: NOW },  // no id → dropped
  ];
  assert.deepEqual(pruneReverseFlip(store, NOW).map(e => e.id), [1, 3]);
});

console.log(`\nAll ${pass} checks passed.`);
