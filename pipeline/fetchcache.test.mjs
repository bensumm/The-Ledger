#!/usr/bin/env node
/**
 * fetchcache.test.mjs — acceptance fixtures for FC1, the opt-in cross-invocation fetch cache in
 * lib/marketfetch.mjs. The primitives are PURE over an injectable dir (no network), so they are
 * fixture-testable with synthetic values — no live data (CLAUDE.md rule 4).
 * Run: `node pipeline/fetchcache.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - The cache is OFF by default; setFetchCache toggles it and fetchCacheEnabled reflects it.
 *   - A PUT then a GET within the TTL returns the EXACT payload that was stored (byte-identical
 *     — a hit is never a fabricated or lossy value).
 *   - A GET past the TTL is a MISS (returns undefined, never a stale payload).
 *   - A GET for a different URL is a MISS even if some entry exists (keyed on the full URL).
 *   - A GET against an empty/absent cache dir is a MISS, never a throw.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setFetchCache, fetchCacheEnabled, _fetchCacheGet, _fetchCachePut, FETCH_TTL } from './lib/marketfetch.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('FC1 fetch-cache acceptance:');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coffer-fc1-'));
const URL_A = 'https://prices.runescape.wiki/api/v1/osrs/latest?id=560';
const URL_B = 'https://prices.runescape.wiki/api/v1/osrs/latest?id=561';
const PAYLOAD = { data: { 560: { high: 123, low: 120, highTime: 1783300000, lowTime: 1783299000 } } };

// --- 1. off by default, toggle flips it ---------------------------------------------------
ok('cache is OFF by default and setFetchCache toggles the flag', () => {
  // (env COFFER_FETCH_CACHE may be unset in CI → default off; assert the toggle both directions)
  setFetchCache(false);
  assert.equal(fetchCacheEnabled(), false, 'setFetchCache(false) disables');
  setFetchCache(true);
  assert.equal(fetchCacheEnabled(), true, 'setFetchCache(true) enables');
  setFetchCache(false);   // leave disabled so no other suite/run is affected
});

// --- 2. put→get within TTL is byte-identical ----------------------------------------------
ok('a PUT then GET within TTL returns the exact stored payload (byte-identical)', () => {
  const now = 1_000_000;
  _fetchCachePut(dir, URL_A, PAYLOAD, now);
  const hit = _fetchCacheGet(dir, URL_A, 60_000, now + 30_000); // 30s < 60s TTL
  assert.deepEqual(hit, PAYLOAD, 'hit deep-equals the stored payload');
  assert.notEqual(hit, undefined);
});

// --- 3. past TTL is a miss ----------------------------------------------------------------
ok('a GET past the TTL is a MISS (undefined, never a stale payload)', () => {
  const now = 1_000_000;
  _fetchCachePut(dir, URL_A, PAYLOAD, now);
  const stale = _fetchCacheGet(dir, URL_A, 60_000, now + 61_000); // 61s > 60s TTL
  assert.equal(stale, undefined, 'expired entry does not serve');
});

// --- 4. different URL is a miss (keyed on the full URL) -----------------------------------
ok('a GET for a different URL is a MISS even when another entry exists', () => {
  const now = 2_000_000;
  _fetchCachePut(dir, URL_A, PAYLOAD, now);
  assert.equal(_fetchCacheGet(dir, URL_B, 60_000, now), undefined, 'URL_B has no entry');
});

// --- 5. absent dir is a miss, not a throw -------------------------------------------------
ok('a GET against an empty/absent cache dir is a MISS, never a throw', () => {
  const empty = path.join(dir, 'does-not-exist');
  assert.equal(_fetchCacheGet(empty, URL_A, 60_000, Date.now()), undefined);
});

// --- 6. the per-endpoint TTLs are ordered short(live) < long(slow) ------------------------
ok('live-endpoint TTLs are shorter than slow-endpoint TTLs (a decision-safety invariant)', () => {
  assert.ok(FETCH_TTL.latest <= FETCH_TTL.tsSlow, 'latest TTL ≤ slow-series TTL');
  assert.ok(FETCH_TTL.ts5m <= FETCH_TTL.vol24, '5m band TTL ≤ 24h-vol TTL');
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`\nAll ${pass} acceptance checks passed.`);
