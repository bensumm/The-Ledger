/* suggestlog.test.mjs — BUSINESS REQUIREMENTS pinned here:
 *
 * 1. The suggestions ledger path resolves to REPO-ROOT suggestions.jsonl — never inside
 *    pipeline/. This regressed once: OR2 moved suggestlog.mjs from pipeline/ into
 *    pipeline/lib/ and the relative '..' silently forked the O1 accrual data (the dataset
 *    F1 is gated on) into an untracked pipeline/suggestions.jsonl for half a day
 *    (2026-07-05 10:21→15:39, 345 rows). The path is load-bearing: sync-fills commits the
 *    repo-root file, so a wrong path means suggestions are written but never published.
 * 2. suggestionEntry never fabricates a number — absent row fields become null.
 * 3. liqClassOf thresholds: <100 thin, <1000 mid, else liquid; null → 'unknown'.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { LEDGER, suggestionEntry, liqClassOf } from './suggestlog.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

ok('LEDGER resolves to the repo root, not pipeline/', () => {
  const dir = path.dirname(LEDGER);
  assert.notEqual(path.basename(dir), 'pipeline', 'ledger must not live inside pipeline/');
  assert.notEqual(path.basename(dir), 'lib', 'ledger must not live inside pipeline/lib/');
  // The repo root is identifiable: it holds index.html (the deployed app entry).
  assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'ledger dir should be the repo root (has index.html)');
  assert.equal(path.basename(LEDGER), 'suggestions.jsonl');
});

ok('suggestionEntry nulls absent fields, never fabricates', () => {
  const e = suggestionEntry({}, { itemId: 4151, cls: 'liquid', verdict: null });
  assert.deepEqual(e, { itemId: 4151, quickBuy: null, optBuy: null, quickSell: null,
    optSell: null, mom: null, regime: null, class: 'liquid', verdict: null });
});

ok('liqClassOf thresholds', () => {
  assert.equal(liqClassOf(null), 'unknown');
  assert.equal(liqClassOf(99), 'thin');
  assert.equal(liqClassOf(100), 'mid');
  assert.equal(liqClassOf(999), 'mid');
  assert.equal(liqClassOf(1000), 'liquid');
});

console.log(`All ${n} checks passed.`);
