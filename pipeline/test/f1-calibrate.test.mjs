/* f1-calibrate.test.mjs — BUSINESS REQUIREMENTS pinned here:
 *
 * f1-calibrate.mjs is F1's read-only CALIBRATION STUDY over the derived outcomes.json. The honesty
 * of its report is load-bearing (CLAUDE.md rule 4), so the pure analysis functions are pinned:
 *
 * 1. regimeOf follows the EXACT F1-gate fallback chain (stateAtFill.regime → suggestion.regime →
 *    'noreg') and REPORTS the source — so the audit can distinguish a real reconstructed regime from
 *    the 'noreg' unknown pile. A cell cleared on 'noreg' is NOT regime-controlled evidence.
 * 2. gateAudit buckets by (side × pctBucket × class × regime) exactly as the gate spec documents,
 *    counts cells clearing n≥30, and surfaces per-cell top-item concentration + whether the cleared
 *    cells are all reconstructed-regime. n≥30 in an 80%-one-item cell is NOT broad evidence.
 * 3. fillCurves' P(fill) uses ALL campaigns in a cell (a never-filled bid is a real fill-rate
 *    observation); medTTF uses only filled ones with a fill-time.
 * 4. confidence never calls an n barely over the floor "solid": <30 insufficient, <50 weak,
 *    and a >60%-one-item share is tagged ONE-ITEM-DOMINATED regardless of n.
 * 5. The F1 thresholds (MIN_N_F1=30, MIN_CELLS_F1=5) stay in SYNC with join-outcomes.mjs (the gate's
 *    home) — a drift in either file is caught here, not silently in a live report.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pctBucket, regimeOf, concentration, gateAudit, fillCurves, confidence, holdStats,
  MIN_N_F1, MIN_CELLS_F1,
} from '../commands/f1-calibrate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

// --- fixture: synthetic campaigns exercising the bucketing + concentration + regime-source logic ---
function camp(over) {
  return { itemId: 1, name: 'Item', side: 'buy', everFilled: true, timeToFirstFill: 600,
    bandPct: 10, liqClass: 'mid', volDayCurrent: 500, holdTimeSec: null, stateAtFill: null, suggestion: null, ...over };
}

ok('pctBucket edges', () => {
  assert.equal(pctBucket(null), 'unknown');
  assert.equal(pctBucket(0), '0-20');
  assert.equal(pctBucket(19.9), '0-20');
  assert.equal(pctBucket(20), '20-40');
  assert.equal(pctBucket(80), '80-100');
  assert.equal(pctBucket(100), '80-100');
});

ok('regimeOf prefers reconstructed state, then suggestion, then noreg', () => {
  assert.deepEqual(regimeOf(camp({ stateAtFill: { regime: 'rising' }, suggestion: { regime: 'flat' } })),
    { regime: 'rising', source: 'state' });
  assert.deepEqual(regimeOf(camp({ stateAtFill: { regime: 'unknown' }, suggestion: { regime: 'flat' } })),
    { regime: 'flat', source: 'suggestion' });
  assert.deepEqual(regimeOf(camp({ stateAtFill: null, suggestion: null })),
    { regime: 'noreg', source: 'noreg-fallback' });
});

ok('concentration reports top-item share', () => {
  const rows = [camp({ itemId: 1, name: 'A' }), camp({ itemId: 1, name: 'A' }), camp({ itemId: 1, name: 'A' }), camp({ itemId: 2, name: 'B' })];
  const c = concentration(rows);
  assert.equal(c.nItems, 2);
  assert.equal(c.topName, 'A');
  assert.equal(c.topN, 3);
  assert.equal(c.topShare, 0.75);
});

ok('gateAudit buckets by regime and flags a noreg-cleared cell', () => {
  // 30 filled campaigns in one (buy|0-20|mid|flat) cell from reconstructed state → cleared, reconstructed
  const flat = Array.from({ length: 30 }, (_, i) => camp({ itemId: 10 + (i % 5), stateAtFill: { regime: 'flat' } }));
  // 30 in a noreg cell (no state, no suggestion) → cleared but from the unknown pile
  const noreg = Array.from({ length: 30 }, (_, i) => camp({ itemId: 100 + (i % 5), bandPct: 90, side: 'sell' }));
  const a = gateAudit([...flat, ...noreg]);
  assert.equal(a.clearedCount, 2);
  assert.equal(a.noregCleared, 1, 'the state-less cell must be counted as a noreg clear');
  assert.equal(a.regimeSpread.flat, 1);
  assert.equal(a.regimeSpread.noreg, 1);
  const flatCell = a.cleared.find(c => c.regime === 'flat');
  assert.equal(flatCell.regimeAllState, true);
});

ok('gateAudit surfaces one-item domination in a cleared cell', () => {
  // 30 filled, 25 the same item → 83% one item, cleared but dominated
  const rows = Array.from({ length: 30 }, (_, i) => camp({ itemId: i < 25 ? 1 : 2 + i, stateAtFill: { regime: 'flat' } }));
  const a = gateAudit(rows);
  assert.equal(a.clearedCount, 1);
  assert.ok(a.cleared[0].conc.topShare > 0.8);
});

ok('fillCurves P(fill) counts never-filled bids; medTTF only filled', () => {
  const rows = [
    camp({ everFilled: true, timeToFirstFill: 600 }),
    camp({ everFilled: true, timeToFirstFill: 1200 }),
    camp({ everFilled: false, timeToFirstFill: null }),
    camp({ everFilled: false, timeToFirstFill: null }),
  ];
  const c = fillCurves(rows);
  const cell = c.buy['mid|0-20'];
  assert.equal(cell.n, 4);
  assert.equal(cell.nFilled, 2);
  assert.equal(cell.fillRate, 0.5);
  assert.equal(cell.medTtfSec, 900);   // median of 600,1200
  assert.equal(cell.ttfN, 2);
});

ok('confidence never oversells a small or concentrated n', () => {
  assert.match(confidence(29, 0.1), /insufficient/);
  assert.match(confidence(31, 0.1), /weak/);
  assert.match(confidence(31, 0.7), /ONE-ITEM-DOMINATED/);
  assert.match(confidence(100, 0.1), /moderate/);
  assert.match(confidence(200, 0.1), /fair/);
  assert.doesNotMatch(confidence(200, 0.1), /solid/);
});

ok('holdStats reports median/max/n', () => {
  const rows = [camp({ holdTimeSec: 3600 }), camp({ holdTimeSec: 7200 }), camp({ holdTimeSec: null })];
  const h = holdStats(rows);
  assert.equal(h.n, 2);
  assert.equal(h.medianSec, 5400);
  assert.equal(h.maxSec, 7200);
});

ok('F1 thresholds stay in sync with join-outcomes.mjs (drift guard)', () => {
  assert.equal(MIN_N_F1, 30);
  assert.equal(MIN_CELLS_F1, 5);
  const jo = fs.readFileSync(path.join(HERE, '..', 'commands', 'join-outcomes.mjs'), 'utf8');
  const mn = jo.match(/const MIN_N_F1\s*=\s*(\d+)/);
  const mc = jo.match(/const MIN_CELLS_F1\s*=\s*(\d+)/);
  assert.ok(mn && mc, 'could not find the gate constants in join-outcomes.mjs');
  assert.equal(+mn[1], MIN_N_F1, 'MIN_N_F1 drifted from join-outcomes.mjs');
  assert.equal(+mc[1], MIN_CELLS_F1, 'MIN_CELLS_F1 drifted from join-outcomes.mjs');
});

console.log(`\nf1-calibrate: ${n} checks passed.`);
