#!/usr/bin/env node
/**
 * cli.test.mjs — acceptance fixtures for the shared CLI plumbing (pipeline/lib/render/cli.mjs) plus
 * the liquidity-class vocabulary (pipeline/lib/render/suggestlog.mjs).
 *
 * parseGp/median/liqClassOf are PURE — synthetic inputs only, no live data (CLAUDE.md rule 4).
 * Importing suggestlog does NOT write suggestions.jsonl (logSuggestions is never called here). The
 * one check that DOES touch disk (§4, writeLastReport) writes a throwaway `kind` and removes it, so
 * this suite still leaves no pollution.
 * Run: `node pipeline/test/cli.test.mjs`  (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - parseGp honors a k/m/b suffix + commas + a LEADING SIGN, passes a number through (rounded),
 *     and returns NaN on garbage. This is the PIPELINE parser — intentionally distinct from
 *     js/money-format.js's parseGp (which rejects a sign and passes numbers through un-rounded); that one
 *     is pinned in pipeline/test/format.test.mjs. The divergence is deliberate (PLAN Discovered note).
 *   - median = mean of the two middle values for an even length, the middle for odd, null for an
 *     empty/absent array, and NEVER mutates its input.
 *   - liqClassOf boundaries: <100 → thin, [100,1000) → mid, ≥1000 → liquid, null → unknown
 *     (the NY2.4 liquidity vocabulary).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGp, median, writeLastReport } from '../lib/render/cli.mjs';
import { liqClassOf } from '../lib/render/suggestlog.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('cli.js / suggestlog.js plumbing acceptance:');

// --- 1. parseGp: suffix / commas / sign / number passthrough / garbage ------------------------
ok('parseGp: k/m/b suffix, commas, leading sign, rounded number passthrough, garbage → NaN', () => {
  assert.equal(parseGp('18.05m'), 18_050_000);
  assert.equal(parseGp('450k'), 450_000);
  assert.equal(parseGp('2b'), 2_000_000_000);
  assert.equal(parseGp('3,439,800'), 3_439_800);     // commas stripped, no suffix
  assert.equal(parseGp('3439800'), 3_439_800);
  assert.equal(parseGp('  12K '), 12_000);           // trimmed + lower-cased
  assert.equal(parseGp(150), 150);                   // number passthrough
  assert.equal(parseGp(150.7), 151);                 // number passthrough is ROUNDED (unlike format's)
  assert.equal(parseGp('-5m'), -5_000_000);          // LEADING SIGN accepted (unlike format's parseGp)
  assert.ok(Number.isNaN(parseGp('abc')));
  assert.ok(Number.isNaN(parseGp('')));
  assert.ok(Number.isNaN(parseGp('12x')));           // an unknown suffix is not a magnitude
});

// --- 2. median: even / odd / empty, and no input mutation -------------------------------------
ok('median: odd → middle, even → mean of the two middle, empty/absent → null', () => {
  assert.equal(median([3, 1, 2]), 2);                // odd
  assert.equal(median([4, 1, 3, 2]), 2.5);           // even → (2+3)/2
  assert.equal(median([7]), 7);
  assert.equal(median([]), null);
  assert.equal(median(null), null);
  assert.equal(median(undefined), null);
});
ok('median: does not mutate its input array', () => {
  const a = [3, 1, 2];
  median(a);
  assert.deepEqual(a, [3, 1, 2], 'the caller\'s array order is preserved');
});

// --- 3. liqClassOf boundaries (NY2.4 vocabulary) ----------------------------------------------
ok('liqClassOf: <100 thin, [100,1000) mid, ≥1000 liquid, null unknown', () => {
  assert.equal(liqClassOf(null), 'unknown');
  assert.equal(liqClassOf(0), 'thin');
  assert.equal(liqClassOf(99), 'thin');
  assert.equal(liqClassOf(100), 'mid');              // boundary: 100 is mid, not thin
  assert.equal(liqClassOf(999), 'mid');
  assert.equal(liqClassOf(1000), 'liquid');          // boundary: 1000 is liquid, not mid
  assert.equal(liqClassOf(50_000), 'liquid');
});

// --- 4. writeLastReport writes WHERE IT SAYS IT DOES ------------------------------------------
// Regression (PLAN-LIB-SUBDIRS, 2026-07-27): cli.mjs moved into pipeline/lib/render/ but its
// LAST_REPORT_DIR kept a single `..`, so the dump landed in pipeline/lib/.cache/ while the function
// went on RETURNING 'pipeline/.cache/last-report/<kind>.json'. Every agent surface (/positions, /scan,
// /morning) reads the returned path, so they silently read a stale pre-move file — and the write is
// wrapped in a `catch {}`, so nothing anywhere threw. No import check or syntax check can see a
// runtime path-arithmetic bug; this asserts the two halves agree, which is the only thing that would
// have caught it. Uses a throwaway `kind` so a real screen/quote/watch dump is never clobbered.
ok('writeLastReport: the returned repo-relative path is where the file actually lands', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const kind = '__pathcheck';
  const rel = writeLastReport(kind, { sections: [] });
  const abs = join(ROOT, rel);
  try {
    assert.equal(rel, `pipeline/.cache/last-report/${kind}.json`);
    assert.ok(existsSync(abs), `writeLastReport returned ${rel} but no file exists there`);
    assert.equal(JSON.parse(readFileSync(abs, 'utf8')).kind, kind);
  } finally {
    try { rmSync(abs); } catch { /* best-effort cleanup */ }
  }
});

console.log(`\nAll ${pass} acceptance checks passed.`);
