/**
 * reachability.test.mjs — the reachability head-to-head scorer (RC, PLAN-REACHABILITY-CONSOLIDATION).
 *
 * WHY THIS EXISTS. The scorer decides which exit estimator gets RETIRED, so its failure modes are
 * silent-wrong, not crash. Three of them were live during the build and are pinned here: (1) the
 * `class` field is not single-vocabulary, and bucketing watch-positions' archetype labels
 * (STABLE_LIQUID / FALLING) as liquidity classes fabricated whole cells; (2) coverage is ragged, so
 * comparing per-estimator marginals computed over DIFFERENT row sets is the unmatched-marginal trap —
 * `matchedPool` exists to avoid it; (3) `reached` and `headroomPct` must agree, since a row is reached
 * exactly when the window max clears the ask.
 *
 * Every "Kills:" claim was confirmed by applying that mutation and watching the suite go red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reachPredictions, scoreRow, scoreReachability, matchedPool, REACH_ESTIMATORS } from '../lib/render/reachability.mjs';

const HOUR = 3600;
// a 3-bucket series topping out at 110
const series = [
  { ts: 1000 + HOUR, avgHighPrice: 100, avgLowPrice: 90 },
  { ts: 1000 + 2 * HOUR, avgHighPrice: 110, avgLowPrice: 95 },
  { ts: 1000 + 3 * HOUR, avgHighPrice: 105, avgLowPrice: 98 },
];
const rowWith = preds => ({ itemId: 1, ts: 1000, side: 'sell', liqClass: 'liquid', regime: 'flat', preds });

test('reachPredictions: relief fired and relief absent are DISJOINT reads of the same estSell', () => {
  const withRelief = reachPredictions({ estSell: 50, estConfidence: { reachRelief: 0.4 } });
  assert.equal(withRelief.reachRelief, 50);
  assert.equal(withRelief.reachFold, null, 'a relief-softened estSell must not also count as the raw fold');

  const noRelief = reachPredictions({ estSell: 50, estConfidence: { reachRelief: 0 } });
  assert.equal(noRelief.reachFold, 50);
  assert.equal(noRelief.reachRelief, null);
  // Kills: treating a 0 relief as "fired" (r != null instead of r > 0).
});

test('reachPredictions: each estimator reads its OWN logged field, and a missing one is null not 0', () => {
  const p = reachPredictions({ reachable: { ask: 11 }, asym: { ask: 12 }, depthExit: { ask: 13 }, quickSell: 14, optSell: 15 });
  assert.equal(p.pressure, 11); assert.equal(p.asym, 12); assert.equal(p.depth, 13);
  assert.equal(p['quickSell*'], 14); assert.equal(p['optSell*'], 15);
  assert.equal(p.reachFold, null, 'no estSell logged → null, never a fabricated 0');
  // a depthExit that COLLAPSED carries a reason and no ask — it must not score as reachable-at-0
  assert.equal(reachPredictions({ depthExit: { collapse: 'thin book' } }).depth, null);
});

test('scoreRow: reached is exactly "the window max cleared the ask", and headroom agrees with it', () => {
  const out = scoreRow(series, rowWith({ pressure: 120, asym: 100, depth: 110 }), { horizonH: 2 });
  assert.equal(out.pressure.reached, false, '120 is above the 110 top');
  assert.equal(out.asym.reached, true);
  assert.equal(out.depth.reached, true, 'equal to the top counts as reached');
  assert.ok(out.pressure.headroomPct < 0 && out.asym.headroomPct > 0);
  assert.equal(Math.round(out.asym.headroomPct * 100) / 100, 10, '(110-100)/100');
  // Kills: a strict `top > a` reached test, and any sign flip in headroomPct.
});

test('scoreRow: a window the archive cannot RESOLVE is dropped, never counted as a miss', () => {
  // horizon runs past the last bucket → unresolved
  assert.equal(scoreRow(series, rowWith({ pressure: 100 }), { horizonH: 48 }), null);
  // Kills: dropping `covers()`, which would silently bias every reach rate DOWN by the truncation
  // at the end of the archive — the exact bias that makes a late-accruing estimator look worse.
});

test('matchedPool: only the rows where EVERY named estimator priced, so columns are the same trade', () => {
  const scored = [
    { row: rowWith({}), out: { pressure: { reached: true, headroomPct: 1 }, asym: { reached: false, headroomPct: -1 } } },
    { row: rowWith({}), out: { pressure: { reached: false, headroomPct: -2 } } },
  ];
  const m = matchedPool(scored, ['pressure', 'asym']);
  assert.equal(m.n, 1, 'the row missing asym is excluded from BOTH columns, not just asym\'s');
  assert.equal(m.estimators.find(e => e.key === 'pressure').n, 1);
  assert.equal(matchedPool(scored, ['pressure', 'depth']), null, 'no row carries them all → null, not an empty verdict');
  // Kills: falling back to per-estimator marginals, which is the unmatched-marginal trap.
});

test('scoreReachability: cells key on side × class × regime and the minN floor only LABELS, never drops', () => {
  const mk = (regime, headroom) => ({ row: { ...rowWith({}), regime },
    out: { pressure: { reached: headroom >= 0, headroomPct: headroom } } });
  const res = scoreReachability([mk('flat', 5), mk('flat', -5), mk('rising', 5)], { minN: 2 });
  const flat = res.cells.find(c => c.key === 'sell|liquid|flat');
  assert.equal(flat.n, 2); assert.equal(flat.scorable, true);
  assert.equal(flat.estimators[0].reachRate, 0.5);
  const rising = res.cells.find(c => c.key === 'sell|liquid|rising');
  assert.equal(rising.scorable, false, 'under the floor');
  assert.equal(rising.n, 1, 'but still REPORTED — a suppressed cell must stay visible');
  assert.equal(res.meta.nScorableCells, 1);
});

test('the joiner gates the class axis on the LIQUIDITY vocabulary, never on the raw field', () => {
  const src = readFileSync(new URL('../commands/join-reach-outcomes.mjs', import.meta.url), 'utf8');
  assert.match(src, /LIQ_CLASSES\.has\(s\.class\)/,
    'suggestions.jsonl `class` also carries watch-positions archetypes (STABLE_LIQUID/FALLING); ' +
    'accepting them as liquidity classes fabricated 96 rows of bogus cells during the build');
  assert.match(src, /drop\.badClass\+\+/, 'a row with no usable liquidity class is DROPPED, never assigned one');
});

test('the baselines are declared as reference lines, so a reader cannot mistake optSell for an outside null', () => {
  const baselines = REACH_ESTIMATORS.filter(e => e.baseline).map(e => e.key);
  assert.deepEqual(baselines, ['quickSell*', 'optSell*']);
  assert.ok(REACH_ESTIMATORS.filter(e => !e.baseline).length >= 5, 'the five contenders stay contenders');
});
