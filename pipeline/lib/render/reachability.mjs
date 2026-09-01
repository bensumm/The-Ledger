/* reachability.mjs — the reachability head-to-head SCORER (RC, PLAN-REACHABILITY-CONSOLIDATION).
 *
 * Scores each co-logged exit estimator's predicted ASK forward against the 1h archive: was it reached,
 * and how far above it did the market go. Result + limits: README's join-reach-outcomes.mjs entry.
 *
 * ⚠ DO NOT re-target this at the realized sell, which is what the plan specified. A GE sell executes AT
 * the ask you typed and you type the tool's suggestion, so the executed price largely reproduces the last
 * reprice — scoring against it measures the tool agreeing with itself.
 * The archive is the only target here the tool does not influence.
 *
 * Coverage is ragged, so cross-estimator comparison is legitimate only inside matchedPool. PURE. */
import { median } from './cli.mjs';
import { maxHighWithin, covers, HOUR } from '../market/forward-reach.mjs';

// Relief is logged as a FRACTION; null/0 means `estSell` is the unsoftened fold. Same estimator with and
// without the softening → separate keys, disjoint rows.
const reliefFired = s => { const r = s && s.estConfidence ? s.estConfidence.reachRelief : null; return r != null && r > 0; };
const fin = v => Number.isFinite(v) ? v : null;

/* The contenders plus two reference lines, one registry — which logged field is which estimator lives
 * only here. quickSell is the live market print (the true null); optSell is the tool's OWN band edge, so
 * beating it beats a sibling, not an outside check.
 * `pressure` is a HISTORICAL READER: retired from exit pricing 2026-08-30 (join-exit-ev.mjs's
 * pre-registered criterion), its `reachable.ask` co-log stopped that day — the key stays so every
 * pre-retirement suggestions.jsonl row still parses and scores; new rows read null here. */
export const REACH_ESTIMATORS = Object.freeze([
  { key: 'pressure',    baseline: false, ask: s => fin(s && s.reachable ? s.reachable.ask : null) },
  { key: 'reachFold',   baseline: false, ask: s => fin(s && !reliefFired(s) ? s.estSell : null) },
  { key: 'reachRelief', baseline: false, ask: s => fin(s && reliefFired(s) ? s.estSell : null) },
  { key: 'asym',        baseline: false, ask: s => fin(s && s.asym ? s.asym.ask : null) },
  { key: 'depth',       baseline: false, ask: s => fin(s && s.depthExit ? s.depthExit.ask : null) },
  { key: 'quickSell*',  baseline: true,  ask: s => fin(s ? s.quickSell : null) },
  { key: 'optSell*',    baseline: true,  ask: s => fin(s ? s.optSell : null) },
]);

/* One logged row → { key: ask|null }. */
export function reachPredictions(s) {
  const out = {};
  for (const e of REACH_ESTIMATORS) out[e.key] = e.ask(s);
  return out;
}

/* One read → { key: {reached, headroomPct} }, or null when the archive cannot RESOLVE the window — an
 * unresolved row is dropped, never a miss, else truncation biases every rate down. headroomPct =
 * (window max − ask)/ask: positive is money left on the table. */
export function scoreRow(series, row, { horizonH }) {
  if (!covers(series, row.ts + horizonH * HOUR)) return null;
  const top = maxHighWithin(series, row.ts, horizonH);
  if (top == null) return null;
  const out = {};
  for (const e of REACH_ESTIMATORS) {
    const a = row.preds[e.key];
    if (a == null || a <= 0) continue;
    // reached ⟺ top >= ask per row; the reported rate and median are different functionals and can rank differently.
    out[e.key] = { reached: top >= a, headroomPct: (top - a) / a * 100 };
  }
  return Object.keys(out).length ? out : null;
}

function estimatorStat(key, scored) {
  const present = scored.filter(s => s.out[key]);
  if (!present.length) return { key, n: 0 };
  const reached = present.filter(s => s.out[key].reached);
  return {
    key, n: present.length,
    reachRate: reached.length / present.length,
    // UNCONDITIONAL gap, the only headroom number comparable across estimators: the two below condition
    // on reaching, and reaching selects the high-topping rows, which inflates a rarely-reaching
    // estimator's conditional headroom. Signed — negative means the ask sat above the window top.
    medGapPct: median(present.map(s => s.out[key].headroomPct)),
    // split: on a miss the gap describes the miss, not opportunity cost.
    medHeadroomPct: median(reached.map(s => s.out[key].headroomPct)),
    medMissGapPct: median(present.filter(s => !s.out[key].reached).map(s => -s.out[key].headroomPct)),
  };
}

/* The rows EVERY named estimator priced — the only place a cross-estimator comparison is like-for-like.
 * Null when no row carries them all. */
export function matchedPool(scored, keys) {
  const rows = scored.filter(s => keys.every(k => s.out[k]));
  if (!rows.length) return null;
  return { keys, n: rows.length, items: new Set(rows.map(s => s.row.itemId)).size,
    estimators: keys.map(k => estimatorStat(k, rows)) };
}

export const CELL_KEY = r => `${r.side}|${r.liqClass}|${r.regime}`;

/* [{row,out}] → cells + pooled + coverage. A cell under `minN` is REPORTED with scorable:false, never
 * dropped. `pooled` is Simpson-prone across liquidity/regime and ranks nothing alone. */
export function scoreReachability(scored, { minN = 8 } = {}) {
  const groups = new Map();
  for (const s of scored) { const k = CELL_KEY(s.row); (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  const cells = [...groups.entries()].map(([key, ss]) => ({
    key, n: ss.length, scorable: ss.length >= minN,
    estimators: REACH_ESTIMATORS.map(e => estimatorStat(e.key, ss)).filter(x => x.n > 0),
  })).sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
  return {
    cells,
    pooled: { n: scored.length, estimators: REACH_ESTIMATORS.map(e => estimatorStat(e.key, scored)).filter(x => x.n > 0) },
    coverage: REACH_ESTIMATORS.map(e => ({ key: e.key, baseline: e.baseline, n: scored.filter(s => s.out[e.key]).length })),
    meta: { minN, nScored: scored.length, nScorableCells: cells.filter(c => c.scorable).length },
  };
}
