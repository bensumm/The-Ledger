#!/usr/bin/env node
/**
 * sf3-volsrc.test.mjs — acceptance fixtures for SF-3 (the liquidity-`class` volume-source split).
 * Run: `node pipeline/test/sf3-volsrc.test.mjs`  (exits non-zero on any failure).
 *
 * THE BUG SF-3 FIXES: quote-items.mjs (per-item /24h) and screen-flip-niches.mjs (bulk /24h) are DIFFERENT snapshots,
 * so the same item could log a different `class` in suggestions.jsonl (observed live: Toxic blowpipe
 * `mid` vs `thin`). The polluted quantity is `volDay` itself, so re-deriving class later doesn't launder
 * it. Fix = warm-cache read (converge on the bulk snapshot when it's on disk) + a `volSrc` honesty tag.
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - CLASS PARITY: when a WARM bulk map is in hand, the class classAndSource logs equals the class
 *     screen-flip-niches.mjs would log for the SAME item (both take min(hpv,lpv) from the SAME bulk /24h entry),
 *     and it is tagged volSrc:'bulk' — even when the per-item snapshot would have straddled a boundary.
 *   - COLD FALLBACK, NO FETCH: with no warm map (null — the hard no-cold-fetch constraint means the
 *     caller passes null rather than forcing the ~4000-item dump), classAndSource keeps the per-item
 *     row.volDay and tags volSrc:'peritem'. classAndSource is PURE/synchronous — it cannot fetch.
 *   - WARM ACCESSOR IS FETCH-FREE: readWarmAll24h is a synchronous file read over an injectable dir —
 *     absent/stale/cold → null (a caller must then keep per-item), fresh → the stored map. No network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classAndSource, liqClass, liqClassOf } from '../lib/suggestlog.mjs';
import { readWarmAll24h, ALL24H_TTL } from '../lib/marketfetch.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('SF-3 volume-source split acceptance:');

// How screen-flip-niches.mjs derives the logged class for an item: computeQuote sets row.volDay = min(hpv,lpv)
// over the BULK v24[id] entry, then it logs liqClass(row). This helper reproduces that exactly.
const screenClass = bulkEntry => liqClass({ volDay: Math.min(bulkEntry.highPriceVolume || 0, bulkEntry.lowPriceVolume || 0) });

const ITEM = 12926;   // Toxic blowpipe (the live-observed straddle item) — id only, no live data (rule 4)

// --- 1. CLASS PARITY on a straddle: per-item snapshot says 'thin', bulk says 'mid' -----------
ok('warm bulk path converges with screen-flip-niches.mjs (same class) even when per-item straddled the boundary', () => {
  // Per-item /24h snapshot the quote path already fetched — limiting side 80/day ⇒ liqClassOf → 'thin'.
  const perItemRow = { volDay: 80 };
  assert.equal(liqClass(perItemRow), 'thin', 'the per-item volume would log thin (the polluted path)');
  // Bulk /24h snapshot a recent screen wrote — limiting side 140/day ⇒ 'mid'. This is what screen logs.
  const bulk = { [ITEM]: { highPriceVolume: 300, lowPriceVolume: 140 } };
  assert.equal(screenClass(bulk[ITEM]), 'mid', 'screen would log mid from the bulk snapshot');
  const cs = classAndSource(perItemRow, ITEM, bulk);
  assert.equal(cs.volSrc, 'bulk', 'a warm bulk hit is tagged bulk');
  assert.equal(cs.cls, 'mid', 'quote CONVERGES on the bulk class — no longer straddles screen');
  assert.equal(cs.cls, screenClass(bulk[ITEM]), 'class parity: quote-via-warm == screen exactly');
});

// --- 2. string-keyed bulk map resolves the same (JSON maps stringify numeric ids) ------------
ok('classAndSource resolves a string-keyed bulk entry (JSON object keys are strings)', () => {
  const bulk = { [String(ITEM)]: { highPriceVolume: 5000, lowPriceVolume: 4000 } };
  const cs = classAndSource({ volDay: 80 }, ITEM, bulk);
  assert.equal(cs.volSrc, 'bulk');
  assert.equal(cs.cls, 'liquid', 'min(5000,4000)=4000 ⇒ liquid, from the bulk entry');
  assert.equal(cs.cls, liqClassOf(4000));
});

// --- 3. COLD FALLBACK: no warm map ⇒ keep the per-item volume, tag peritem, never fetch -------
ok('a cold quote (null warm map) keeps the per-item class and tags peritem — no fetch is possible', () => {
  const perItemRow = { volDay: 80 };
  const cs = classAndSource(perItemRow, ITEM, null);
  assert.equal(cs.volSrc, 'peritem', 'no warm map ⇒ honest peritem tag');
  assert.equal(cs.cls, 'thin', 'falls back to the per-item volDay class');
  assert.equal(cs.cls, liqClass(perItemRow));
  // classAndSource is a plain synchronous function — it returns a value, not a Promise, so it cannot
  // have performed (or be about to perform) any network I/O. This is the "assert no fetch" guarantee.
  assert.ok(!(cs instanceof Promise), 'classAndSource is synchronous — no fetch path exists');
});

// --- 4. item absent from an otherwise-warm bulk map ⇒ peritem (still no fetch) ----------------
ok('an item missing from the warm bulk map falls back to peritem (never fetches the item)', () => {
  const bulk = { 999: { highPriceVolume: 10, lowPriceVolume: 10 } };   // some other item only
  const cs = classAndSource({ volDay: 2000 }, ITEM, bulk);
  assert.equal(cs.volSrc, 'peritem');
  assert.equal(cs.cls, 'liquid', 'per-item volDay 2000 ⇒ liquid');
});

// --- 5. readWarmAll24h is a fetch-free file read: absent/stale → null, fresh → the stored map --
ok('readWarmAll24h returns null on a cold/absent cache dir (caller must then keep per-item — no fetch)', () => {
  const dir = path.join(os.tmpdir(), 'sf3-absent-' + process.pid);   // never created
  assert.equal(readWarmAll24h(dir, ALL24H_TTL, Date.now()), null, 'absent all24h.json ⇒ null');
});

ok('readWarmAll24h returns the stored map when warm, and null once past the TTL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf3-warm-'));
  const now = 10_000_000;
  const data = { [ITEM]: { highPriceVolume: 300, lowPriceVolume: 140 } };
  // writeCache's on-disk shape is { ts, data } — mirror it exactly.
  fs.writeFileSync(path.join(dir, 'all24h.json'), JSON.stringify({ ts: now, data }));
  assert.deepEqual(readWarmAll24h(dir, ALL24H_TTL, now + 1000), data, 'within TTL ⇒ the stored map');
  assert.equal(readWarmAll24h(dir, ALL24H_TTL, now + ALL24H_TTL + 1), null, 'past TTL ⇒ null (stale, never served)');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

// --- 6. END-TO-END parity: the warm map drives quote AND screen to the identical logged class --
ok('end-to-end: reading the SAME warm all24h.json, quote and screen log an identical class', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf3-e2e-'));
  const now = 20_000_000;
  const bulkEntry = { highPriceVolume: 700, lowPriceVolume: 620 };   // min 620 ⇒ 'mid'
  fs.writeFileSync(path.join(dir, 'all24h.json'), JSON.stringify({ ts: now, data: { [ITEM]: bulkEntry } }));
  const warm = readWarmAll24h(dir, ALL24H_TTL, now + 5000);
  // quote path: a per-item row that DISAGREES (volDay 90 ⇒ 'thin'); the warm read overrides to bulk.
  const quoteCs = classAndSource({ volDay: 90 }, ITEM, warm);
  // screen path: liqClass over the bulk-derived volDay.
  const screenCls = screenClass(warm[ITEM] || warm[String(ITEM)]);
  assert.equal(quoteCs.cls, screenCls, 'both surfaces log the SAME class off the shared warm snapshot');
  assert.equal(quoteCs.cls, 'mid');
  assert.equal(quoteCs.volSrc, 'bulk');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

console.log(`\nAll ${pass} acceptance checks passed.`);
