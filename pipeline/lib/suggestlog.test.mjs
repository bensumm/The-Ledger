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
 * 4. YS2 forward fields (posture/tripwire/fillWindowHrs/velocityClass/thesis) are LEAN-INCLUDED:
 *    written only when supplied, so a legacy call (no forward fields) is byte-identical to before.
 * 5. SR1 rotation/compaction: completed months move OUT of the active ledger into monthly archive
 *    files with ZERO row loss (active ∪ archives == original set, always), idempotently, across
 *    multiple accumulated months; the current month is NEVER rotated; readSuggestionLines reunites
 *    active + archives so the F1 calibration set is never silently halved.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { LEDGER, suggestionEntry, liqClassOf, rotateLedger, readSuggestionLines, currentMonthKey } from './suggestlog.mjs';

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

ok('YS2 forward fields are omitted when absent (legacy row stays byte-identical)', () => {
  const legacy = suggestionEntry({ quickBuy: 100 }, { itemId: 1, cls: 'mid', verdict: 'BUY' });
  assert.ok(!('posture' in legacy) && !('tripwire' in legacy) && !('fillWindowHrs' in legacy) &&
    !('velocityClass' in legacy) && !('thesis' in legacy), 'no forward keys when none supplied');
});

ok('YS2 forward fields are included only when supplied (lean, non-null)', () => {
  const e = suggestionEntry({}, { itemId: 2, cls: 'liquid', verdict: null,
    posture: 'overnight', tripwire: 'support 17.2m', fillWindowHrs: 8, velocityClass: 'slow-hold', thesis: 'guide re-anchor' });
  assert.equal(e.posture, 'overnight');
  assert.equal(e.tripwire, 'support 17.2m');
  assert.equal(e.fillWindowHrs, 8);
  assert.equal(e.velocityClass, 'slow-hold');
  assert.equal(e.thesis, 'guide re-anchor');
  // a partial supply includes ONLY the supplied one
  const p = suggestionEntry({}, { itemId: 3, posture: 'active' });
  assert.equal(p.posture, 'active');
  assert.ok(!('tripwire' in p), 'unsupplied forward field stays absent');
});

ok('liqClassOf thresholds', () => {
  assert.equal(liqClassOf(null), 'unknown');
  assert.equal(liqClassOf(99), 'thin');
  assert.equal(liqClassOf(100), 'mid');
  assert.equal(liqClassOf(999), 'mid');
  assert.equal(liqClassOf(1000), 'liquid');
});

// ---- SR1 rotation/compaction ---------------------------------------------------------------
// Synthetic ledgers in a temp dir (never touch the real repo-root LEDGER). ts anchors:
const MAY = Math.floor(Date.parse('2026-05-15T00:00:00Z') / 1000);
const JUN = Math.floor(Date.parse('2026-06-20T00:00:00Z') / 1000);
const JUL = Math.floor(Date.parse('2026-07-03T00:00:00Z') / 1000);
const NOW = Date.parse('2026-07-08T00:00:00Z');   // "current" month = 2026-07
const row = (ts, itemId) => JSON.stringify({ ts, script: 'quote', itemId });

function tmpFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr1-'));
  const ledger = path.join(dir, 'suggestions.jsonl');
  const archiveDir = path.join(dir, 'suggestions-archive');
  fs.writeFileSync(ledger, lines.join('\n') + '\n');
  return { dir, ledger, archiveDir };
}
function allLines({ ledger, archiveDir }) {
  return readSuggestionLines({ ledger, archiveDir }).slice().sort();
}

ok('rotation moves completed months out, keeps the current month, loses ZERO rows', () => {
  const original = [row(MAY, 1), row(JUN, 2), row(JUL, 3), row(JUL, 4)];
  const fx = tmpFixture(original);
  const before = allLines(fx);
  const res = rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  assert.equal(res.rotated, 2, 'the two prior-month rows rotated');
  assert.deepEqual(res.months.sort(), ['2026-05', '2026-06']);
  // active file now holds ONLY the current month
  const active = fs.readFileSync(fx.ledger, 'utf8').split(/\r?\n/).filter(l => l.trim());
  assert.equal(active.length, 2, 'active keeps exactly the current-month rows');
  assert.ok(active.every(l => JSON.parse(l).ts === JUL));
  // archives exist, one per rotated month
  assert.ok(fs.existsSync(path.join(fx.archiveDir, 'suggestions-2026-05.jsonl')));
  assert.ok(fs.existsSync(path.join(fx.archiveDir, 'suggestions-2026-06.jsonl')));
  // ZERO row loss: active ∪ archives == original
  assert.deepEqual(allLines(fx), before);
  assert.deepEqual(allLines(fx), original.slice().sort());
});

ok('rotation is idempotent — a second pass moves nothing and preserves every row', () => {
  const original = [row(MAY, 1), row(JUN, 2), row(JUL, 3)];
  const fx = tmpFixture(original);
  rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  const afterFirst = allLines(fx);
  const res2 = rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  assert.equal(res2.rotated, 0, 'nothing left to rotate');
  assert.deepEqual(allLines(fx), afterFirst, 'no duplication, no loss on re-run');
  assert.deepEqual(allLines(fx), original.slice().sort());
});

ok('re-rotation merges into an existing archive without duplicating', () => {
  // First rotation archives the May row; then a NEW May row appears in the active file and rotates.
  const fx = tmpFixture([row(MAY, 1), row(JUL, 9)]);
  rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  fs.appendFileSync(fx.ledger, row(MAY, 2) + '\n');           // a second, distinct May row
  const res = rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  assert.equal(res.rotated, 1, 'only the new May row is added to the archive');
  const arch = fs.readFileSync(path.join(fx.archiveDir, 'suggestions-2026-05.jsonl'), 'utf8')
    .split(/\r?\n/).filter(l => l.trim());
  assert.equal(arch.length, 2, 'both distinct May rows archived, no duplicate');
});

ok('an all-current-month ledger rotates nothing (the live repo state today)', () => {
  const original = [row(JUL, 1), row(JUL, 2), row(JUL, 3)];
  const fx = tmpFixture(original);
  const res = rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  assert.equal(res.rotated, 0);
  assert.equal(res.months.length, 0);
  assert.ok(!fs.existsSync(fx.archiveDir), 'no archive dir created when nothing rotates');
  assert.deepEqual(allLines(fx), original.slice().sort());
});

ok('unparseable / ts-less lines are KEPT in the active file, never dropped', () => {
  const junk = 'not-json{';
  const noTs = JSON.stringify({ script: 'quote', itemId: 7 });   // no ts
  const fx = tmpFixture([row(MAY, 1), junk, noTs, row(JUL, 3)]);
  rotateLedger(NOW, { ledger: fx.ledger, archiveDir: fx.archiveDir });
  const active = fs.readFileSync(fx.ledger, 'utf8').split(/\r?\n/).filter(l => l.trim());
  assert.ok(active.includes(junk), 'unparseable line stays active');
  assert.ok(active.includes(noTs), 'ts-less line stays active');
  assert.ok(active.includes(row(JUL, 3)), 'current-month row stays active');
  assert.ok(!active.includes(row(MAY, 1)), 'the dated prior-month row rotated out');
});

ok('currentMonthKey is UTC YYYY-MM', () => {
  assert.equal(currentMonthKey(NOW), '2026-07');
  assert.equal(currentMonthKey(Date.parse('2026-01-01T00:00:00Z')), '2026-01');
});

console.log(`All ${n} checks passed.`);
