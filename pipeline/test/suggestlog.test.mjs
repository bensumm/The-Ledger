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
 * 4. YS2 forward fields (posture/tripwire/fillWindowHrs/velocityClass/thesis) — and the SF-3 `volSrc`
 *    tag — are LEAN-INCLUDED: written only when supplied, so a legacy call (no such fields) is
 *    byte-identical to before. (Full SF-3 class/source parity is pinned in sf3-volsrc.test.mjs.)
 * 5. SR1 rotation/compaction: completed months move OUT of the active ledger into monthly archive
 *    files with ZERO row loss (active ∪ archives == original set, always), idempotently, across
 *    multiple accumulated months; the current month is NEVER rotated; readSuggestionLines reunites
 *    active + archives so the F1 calibration set is never silently halved.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { LEDGER, suggestionEntry, liqClassOf, rotateLedger, readSuggestionLines, currentMonthKey, reachableShadow, depthExitShadow, windowExitShadow } from '../lib/suggestlog.mjs';

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
  assert.ok(!('path' in legacy), 'P4c: no path key when none supplied — clean row byte-identical');
  assert.ok(!('volSrc' in legacy), 'SF-3: no volSrc key when none supplied (watch-positions.mjs rows stay byte-identical)');
});

ok('SF-3: volSrc is lean-included (present only when supplied)', () => {
  const bulk = suggestionEntry({}, { itemId: 8, cls: 'mid', verdict: 'A', volSrc: 'bulk' });
  assert.equal(bulk.volSrc, 'bulk', 'supplied volSrc is written');
  const peritem = suggestionEntry({}, { itemId: 9, cls: 'thin', verdict: 'A', volSrc: 'peritem' });
  assert.equal(peritem.volSrc, 'peritem');
  const none = suggestionEntry({}, { itemId: 10, cls: 'liquid', verdict: 'A' });
  assert.ok(!('volSrc' in none), 'absent volSrc stays absent (lean, byte-identity)');
});

ok('AZ-forward: `grade` letter is lean-included (present only when supplied)', () => {
  const graded = suggestionEntry({}, { itemId: 11, cls: 'liquid', verdict: 'A-', grade: 'A-' });
  assert.equal(graded.grade, 'A-', 'supplied grade letter is written');
  const none = suggestionEntry({}, { itemId: 12, cls: 'liquid', verdict: 'HOLD' });
  assert.ok(!('grade' in none), 'absent grade stays absent (quote/watch rows byte-identical)');
});

ok('AZ-forward: `depth` {hpv,lpv} is derived off row.pressure; no pressure → no field', () => {
  const withP = suggestionEntry({ quickBuy: 100, quickSell: 110, pressure: { hpv: 3050, lpv: 1910, ratio: 1.6 } },
    { itemId: 13, cls: 'liquid', verdict: 'B' });
  assert.deepEqual(withP.depth, { hpv: 3050, lpv: 1910 }, 'depth snapshots the two 24h flow sides');
  const noP = suggestionEntry({ quickBuy: 100, quickSell: 110 }, { itemId: 14, cls: 'liquid', verdict: 'B' });
  assert.ok(!('depth' in noP), 'no /24h pressure → no depth field (lean, byte-identity)');
  const nullSides = suggestionEntry({ pressure: { hpv: null, lpv: null, ratio: null } }, { itemId: 15, cls: 'mid', verdict: 'B' });
  assert.ok(!('depth' in nullSides), 'pressure with both sides null → no depth field');
  const oneSide = suggestionEntry({ pressure: { hpv: 500, lpv: null, ratio: null } }, { itemId: 16, cls: 'mid', verdict: 'B' });
  assert.deepEqual(oneSide.depth, { hpv: 500, lpv: null }, 'a one-sided read is kept with the null side explicit');
});

ok('P4c: the inferred entry `path` is lean-included (present only when supplied)', () => {
  const e = suggestionEntry({}, { itemId: 5, cls: 'liquid', verdict: 'A', path: 'scalp' });
  assert.equal(e.path, 'scalp', 'supplied path is written');
  const none = suggestionEntry({}, { itemId: 6, cls: 'liquid', verdict: 'A' });
  assert.ok(!('path' in none), 'absent path stays absent (SL1-style byte-identity)');
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

ok('DE3 + RC-S1: the reachability head-to-head shadow fields are lean-included (co-log contract)', () => {
  // watch held rows co-log all FIVE competing exit estimators on ONE row for the F1 head-to-head
  // (PLAN-REACHABILITY-CONSOLIDATION): depthExit (depth), reachable (pressure), estSell (reachRelief),
  // asym (fixed-quantile). Each is lean-included — present only when supplied.
  const full = suggestionEntry({ quickBuy: 393, quickSell: 396 }, { itemId: 566, cls: 'liquid', verdict: 'HOLD',
    depthExit: { qty: 25000, competition: 4, liqClass: 'liquid', ask: 394, clearFrac: 0.79 },
    reachable: { ask: 401, bid: 383, pressure: 1.66, reliability: 1, bandLow: 6, bandHigh: 2 },
    estBuy: 385, estSell: 396, estConfidence: { askHit: 7, askDays: 14, reachRelief: 0.75 },
    asym: { bid: 379, ask: 396, pAsk: 0.86, pBid: 0.29, n: 14, rank: 1200 } });
  assert.equal(full.depthExit.ask, 394); assert.equal(full.reachable.ask, 401);
  assert.equal(full.estSell, 396); assert.equal(full.asym.ask, 396);
  assert.equal(full.estConfidence.reachRelief, 0.75, 'reachRelief number rides estConfidence for the head-to-head');
  // a collapsed depth read carries its reason + liqClass (the ×4-bias measurement F1 needs), no ask
  const collapsed = suggestionEntry({}, { itemId: 999, cls: 'thin', verdict: 'HOLD',
    depthExit: { qty: 100, competition: 4, liqClass: 'thin', collapse: 'insufficient-depth' } });
  assert.equal(collapsed.depthExit.collapse, 'insufficient-depth');
  assert.ok(!('ask' in collapsed.depthExit), 'a null depth read logs the reason, not a fake ask');
  // absent → byte-identical (a bid/target watch row, or any legacy row)
  const none = suggestionEntry({ quickBuy: 100 }, { itemId: 7, cls: 'mid', verdict: 'BID-OK' });
  assert.ok(!('depthExit' in none) && !('reachable' in none) && !('estSell' in none) && !('asym' in none),
    'no reachability shadow keys when none supplied — bid/target/legacy rows stay byte-identical');
});

ok('DC3: the demandRegime flip-side classification is lean-included (inform-only F1 shadow)', () => {
  const e = suggestionEntry({}, { itemId: 566, cls: 'liquid', verdict: 'A',
    demandRegime: { regime: 'buy-heavy', pooled: 1.66, sellWin: [12, 15], buyWin: null } });
  assert.deepEqual(e.demandRegime, { regime: 'buy-heavy', pooled: 1.66, sellWin: [12, 15], buyWin: null });
  const none = suggestionEntry({}, { itemId: 7, cls: 'mid', verdict: 'B' });
  assert.ok(!('demandRegime' in none), 'absent → byte-identical (quote/watch/legacy rows unaffected)');
});

ok('RC-S2: reachableShadow / depthExitShadow reshapers (shared, no drift across watch/screen/quote)', () => {
  const rb = { ask: 401, bid: 383, pressure: 1.6634, reliability: 1, bandLow: 6, bandHigh: 2, baseLow: 384 };
  assert.deepEqual(reachableShadow(rb), { ask: 401, bid: 383, pressure: 1.66, reliability: 1, bandLow: 6, bandHigh: 2 },
    'pressure/reliability rounded to 2dp; base* dropped (lean)');
  assert.equal(reachableShadow(null), null);
  assert.equal(reachableShadow({ ask: null }), null, 'a degraded (null-ask) band logs nothing');
  const ca = { price: 394, clearFrac: 0.7857, competition: 4, reason: null };
  assert.deepEqual(depthExitShadow(ca, { qty: 25000, volDay: 1_200_000 }),
    { qty: 25000, competition: 4, liqClass: 'liquid', ask: 394, clearFrac: 0.79 });
  const collapsed = { price: null, competition: 4, reason: 'insufficient-depth' };
  assert.deepEqual(depthExitShadow(collapsed, { qty: 100, volDay: 40 }),
    { qty: 100, competition: 4, liqClass: 'thin', collapse: 'insufficient-depth' }, 'collapse + liqClass, no fake ask');
  assert.equal(depthExitShadow(null, { qty: 1, volDay: 1 }), null);
});

ok('WC1: the windowExit ask-rung shadow is lean-included (present only when supplied)', () => {
  const we = { list: 12_000_000, live: 11_600_000, peakWindow: [1, 3],
    hiReach: { reached: 9, n: 14, recentHit: 1, recentDays: 3, placement: 0.62 },
    fiveReach: { reached: 5, n: 11, placement: 0.55 } };
  const withWE = suggestionEntry({ quickSell: 11_600_000 }, { itemId: 27_226, cls: 'liquid', verdict: 'HOLD', windowExit: we });
  assert.deepEqual(withWE.windowExit, we, 'both reach signals + peakWindow + list/live serialize as supplied');
  const none = suggestionEntry({ quickSell: 11_600_000 }, { itemId: 27_226, cls: 'liquid', verdict: 'HOLD' });
  assert.ok(!('windowExit' in none), 'absent windowExit → byte-identical (non-big-ticket / every other row)');
});

ok('WC1: fiveReach:null is PRESERVED, never dropped or faked, when the 5m read is absent', () => {
  const thin = { list: 44_340_000, live: 43_000_000, peakWindow: [2, 3],
    hiReach: { reached: 4, n: 14, recentHit: 0, recentDays: 3, placement: 0.71 }, fiveReach: null };
  const e = suggestionEntry({}, { itemId: 27_235, cls: 'liquid', verdict: 'HOLD', windowExit: thin });
  assert.ok('fiveReach' in e.windowExit, 'the fiveReach key is present (honesty: says "no 5m read", not silence)');
  assert.equal(e.windowExit.fiveReach, null, 'and it is explicitly null — never a fabricated 5m reach');
});

ok('WC1: windowExitShadow maps askExitRead fields (reachedDays→reached, nDays→n; recency→recentHit/Days)', () => {
  // shape mirrors js/windowread.mjs askExitRead: ask:{level,reachedDays,nDays,placement,recency}, grain5m:{...}
  const aer = {
    nDays: 14, askSide: {},
    ask: { level: 12_000_000, reachedDays: 9, nDays: 14, placement: 0.6234,
      recency: { recentHit: 1, recentDays: 3, fullFrac: 0.64, recentFrac: 0.33 } },
    grain5m: { reachedDays: 5, nDays: 11, placement: 0.5487 },
  };
  const s = windowExitShadow(aer, { list: 12_000_000, live: 11_600_000, peakWindow: [1, 3] });
  assert.deepEqual(s, { list: 12_000_000, live: 11_600_000, peakWindow: [1, 3],
    hiReach: { reached: 9, n: 14, recentHit: 1, recentDays: 3, placement: 0.62 },
    fiveReach: { reached: 5, n: 11, placement: 0.55 } }, 'placement rounded to 2dp; both signals side-by-side');
  // no scored ask (list null → askExitRead returns ask:null) ⇒ nothing to log
  assert.equal(windowExitShadow({ nDays: 14, ask: null, grain5m: null }, { list: null }), null);
  assert.equal(windowExitShadow(null, {}), null, 'no read → null (degrade, never a fake record)');
  // 5m absent ⇒ fiveReach null (honesty item 5), the hi signal still logs
  const noFive = windowExitShadow({ ask: { reachedDays: 4, nDays: 14, placement: 0.7, recency: {} }, grain5m: null },
    { list: 1, live: 1, peakWindow: [2, 3] });
  assert.equal(noFive.fiveReach, null);
  assert.deepEqual(noFive.hiReach, { reached: 4, n: 14, recentHit: null, recentDays: null, placement: 0.7 },
    'a missing recency sub-object degrades recentHit/Days to null, not a throw');
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
