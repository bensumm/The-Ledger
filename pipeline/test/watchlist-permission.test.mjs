/**
 * watchlist-permission.test.mjs — the standing pin on watchlist.json's PERMISSION set (SEP16a).
 *
 * WHY THIS EXISTS. Membership in watchlist.json is not decoration: it grants gate exemption
 * (`gateCandidates`' watchedIds), the bounded band-stack fetch reserve (`WATCH_RESERVE_DEFAULT`),
 * the unbounded amplitude reserve, the amplitude Stage-1 proxy-floor bypass, `subFloorFallback`,
 * the sub-break-even render-filter exemption, the `NOISE_OFFER_GP` incidental-lot exemption in
 * quote-items AND watch-positions, and two big-ticket force-includes (quote-items' windowExit read
 * and watch-positions' WC1 window-clear rung). Every one of those turns off SILENTLY, with CI green,
 * if the id set empties — which is exactly what an object entry in watchlist.json does today, via
 * `buildMapping.resolve` returning null rather than throwing. These cases are the tripwire that
 * did not exist.
 *
 * The role sidecar (watchlist-meta.json) must never be able to move the id set. P1 is that property.
 *
 * Every case was confirmed RED against a named mutant, stated inline. PURE/synthetic: a fake mapping
 * and a temp dir — no network, no repo-root file, no render shell.
 *
 * Run: `node pipeline/test/watchlist-permission.test.mjs`. Auto-discovered by run-tests.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadWatchlistIds, loadWatchlistNames, loadWatchlistEntries,
  WatchlistFormatError, WATCHLIST_ROLE_DEFAULT,
} from '../lib/config/watchlist.mjs';

// A mapping in loadMapping()'s shape: name→id, and a numeric token resolving to itself.
const NAMES = { coal: 453, 'death rune': 560, 'dragon claws': 13652 };
const map = {
  byId: { 453: { name: 'Coal' }, 560: { name: 'Death rune' }, 13652: { name: 'Dragon claws' } },
  resolve(token) {
    const t = String(token).trim();
    if (/^\d+$/.test(t)) return { id: +t, name: map.byId[+t]?.name || ('#' + t) };
    const id = NAMES[t.toLowerCase()];
    return id ? { id, name: map.byId[id].name } : null;
  },
};

// A temp root holding watchlist.json (and optionally the sidecar), returned as a path.
function root({ list, meta }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-perm-'));
  if (list !== undefined) fs.writeFileSync(path.join(dir, 'watchlist.json'), list);
  if (meta !== undefined) fs.writeFileSync(path.join(dir, 'watchlist-meta.json'), meta);
  return dir;
}
// The loader writes its degrade/loud lines to stderr; capture so a run stays readable and so a
// case can assert the line fired. Restored in `finally` (the pipeline/test capture-and-restore shape).
function quiet(fn) {
  const real = console.error, lines = [];
  console.error = (...a) => lines.push(a.map(String).join(' '));
  try { return { value: fn(), lines }; } finally { console.error = real; }
}
const LIST = JSON.stringify(['Coal', 560, 'Dragon claws']);
const IDS = [453, 560, 13652];
const sorted = s => [...s].sort((a, b) => a - b);

test('P1 — the id set is identical with the sidecar present, absent, empty, garbled or unknown-role', () => {
  // MUTANT: make membership consult the sidecar (e.g. `if (!meta[hit.id]) continue;` in
  // loadWatchlistEntries) — every variant but the fully-populated one goes red. THE defect this
  // guards: a metadata file gaining the power to switch eight permission grants off.
  const variants = {
    absent: undefined,
    empty: '{}',
    populated: JSON.stringify({ 453: { why: 'target', level: 200 }, 13652: { why: 'hold' } }),
    garbled: '{ not json',
    notAnObject: '["coal"]',
    unknownRole: JSON.stringify({ 453: { why: 'moonshot' }, 560: { why: 7 } }),
    unrelatedIds: JSON.stringify({ 99999: { why: 'target' } }),
  };
  for (const [label, meta] of Object.entries(variants)) {
    const dir = root({ list: LIST, meta });
    const { value } = quiet(() => loadWatchlistIds(map, dir));
    assert.deepEqual(sorted(value), IDS, `sidecar variant "${label}" moved the id set`);
  }
});

test('P1b — an unknown or missing role reads as universe, and a sidecar id outside the array is ignored', () => {
  // MUTANT: return `e.why` unvalidated from roleOf — "moonshot" survives and reaches consumers.
  const dir = root({ list: LIST, meta: JSON.stringify({ 453: { why: 'moonshot' }, 560: { note: 'x' }, 99999: { why: 'hold' } }) });
  const { value: entries, lines } = quiet(() => loadWatchlistEntries(map, dir));
  assert.deepEqual(entries.map(e => e.id), [453, 560, 13652]);
  assert.equal(entries.every(e => e.why === WATCHLIST_ROLE_DEFAULT), true);
  assert.equal(entries.find(e => e.id === 560).note, 'x');
  assert.match(lines.join('\n'), /moonshot/);
});

test('P1c — a declared role rides along without touching membership', () => {
  // MUTANT: drop the roleOf spread from the entry — `why` goes undefined and SEP16d has nothing to read.
  const dir = root({ list: LIST, meta: JSON.stringify({ 453: { why: 'target', level: 200, addedTs: 5 } }) });
  const { value: entries } = quiet(() => loadWatchlistEntries(map, dir));
  const coal = entries.find(e => e.id === 453);
  assert.equal(coal.why, 'target');
  assert.equal(coal.level, 200);
  assert.equal(coal.addedTs, 5);
  assert.equal(entries.find(e => e.id === 560).why, WATCHLIST_ROLE_DEFAULT);
});

test('P2 — loadWatchlistNames never returns "[object Object]"', () => {
  // MUTANT: `return r.value.map(String)` (the shape map.resolve applies today) — the object entry
  // becomes the literal "[object Object]", which resolves to null and silently drops the member.
  const clean = root({ list: LIST });
  assert.deepEqual(quiet(() => loadWatchlistNames(clean)).value, ['Coal', '560', 'Dragon claws']);
  const dirty = root({ list: JSON.stringify(['Coal', { id: 560, why: 'hold' }]) });
  const { value, lines } = quiet(() => {
    try { return loadWatchlistNames(dirty); } catch (e) { return e; }
  });
  assert.ok(value instanceof WatchlistFormatError);
  assert.equal(JSON.stringify(value).includes('[object Object]'), false);
  assert.match(lines.join('\n'), /watchlist\.json\[1\] is a object/);
});

test('P3 — an object entry FAILS LOUDLY at every reader instead of silently emptying the set', () => {
  // MUTANT: skip the bad entry (`continue`) instead of throwing — the pre-SEP16a behavior, where
  // map.resolve returned null and the set quietly lost the member (or, on a whole-file rewrite,
  // emptied). Every assertion below goes green under the mutant, which is the point: the bug is
  // invisible without a thrown error.
  for (const bad of [{ id: 560 }, ['Coal'], null]) {
    const dir = root({ list: JSON.stringify(['Coal', bad]) });
    for (const [label, fn] of [
      ['loadWatchlistNames', () => loadWatchlistNames(dir)],
      ['loadWatchlistEntries', () => loadWatchlistEntries(map, dir)],
      ['loadWatchlistIds', () => loadWatchlistIds(map, dir)],
    ]) {
      const { value } = quiet(() => { try { return fn(); } catch (e) { return e; } });
      assert.ok(value instanceof WatchlistFormatError, `${label} did not throw on entry ${JSON.stringify(bad)}`);
    }
  }
});

test('P4 — absent, unreadable or non-array watchlist.json degrades to an empty set, never a throw', () => {
  // MUTANT: drop the Array.isArray guard (or the readJson try/catch) — an unreadable file throws
  // out of every consumer instead of degrading, which is the contract five call sites rely on.
  const cases = {
    absent: root({}),
    garbled: root({ list: '[ "Coal",' }),
    object: root({ list: '{"453": true}' }),
    string: root({ list: '"Coal"' }),
  };
  for (const [label, dir] of Object.entries(cases)) {
    const { value: ids } = quiet(() => loadWatchlistIds(map, dir));
    assert.equal(ids.size, 0, `${label} did not degrade to an empty set`);
    assert.deepEqual(quiet(() => loadWatchlistNames(dir)).value, [], `${label} names did not degrade`);
  }
  // An absent file is normal and silent; a file that EXISTS but cannot be read as a list is not.
  assert.equal(quiet(() => loadWatchlistIds(map, cases.absent)).lines.length, 0);
  assert.match(quiet(() => loadWatchlistIds(map, cases.object)).lines.join('\n'), /not an array/);
});

test('P5 — membership order is file order, first occurrence wins, unresolvable tokens are skipped', () => {
  // MUTANT: build the set from a Map keyed by name, or drop the `seen` guard — the duplicate
  // reappears and report-archive-gate's `--limit` slice silently covers fewer distinct items.
  const dir = root({ list: JSON.stringify(['Dragon claws', 'Coal', 'Coal', 'Nonexistent item', 453]) });
  const { value: entries } = quiet(() => loadWatchlistEntries(map, dir));
  assert.deepEqual(entries.map(e => e.id), [13652, 453]);
  assert.deepEqual(entries.map(e => e.name), ['Dragon claws', 'Coal']);
});
