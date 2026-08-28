#!/usr/bin/env node
/* join-reach-outcomes.mjs — the reachability head-to-head, FORWARD-SCORED (RC, PLAN-REACHABILITY-CONSOLIDATION).
 *
 * The tool carries five overlapping ways to price an exit (reach-fold · reachRelief · asym · depth ·
 * pressure). RC-S1/RC-S2 co-log all of them on every read; this scores them head-to-head so a
 * retirement is measured rather than argued. For each co-logged row it walks the 1h archive FORWARD
 * from the read and asks, per estimator: was that ask REACHED within the horizon, and how much higher
 * did the market go (headroom). Two logged market prints — quickSell/optSell, marked * — ride along as
 * BASELINES — quickSell is the live market print (the true null); optSell is the tool's own patient band
 * edge, an incumbent kept as a reference line, NOT an outside check.
 *
 * SCOPE: the ASK leg only. pressure and asym also produce a BID, and nothing here scores it — a
 * retirement argued from this surface is argued about exits.
 *
 * ⚠ Read the module header of lib/render/reachability.mjs before changing the target: scoring against
 * the realized sell is CIRCULAR here (a GE sell executes at the ask you typed, and you type the tool's
 * suggestion — 75% exact match on this book), which is why this joins the archive instead.
 *
 * INFORM-ONLY, gates nothing. Reached != filled — queue position is invisible — so every rate here
 * bounds a real offer from ABOVE. Sibling of join-asym-outcomes.mjs / join-reach-basis.mjs; shares
 * their forward primitives via lib/market/forward-reach.mjs.
 * Run: node pipeline/commands/join-reach-outcomes.mjs [--horizon H] [--min-n N] [--item "<name>"] [--json]
 */
import { fileURLToPath } from 'node:url';
import * as archive from '../lib/market/archive.mjs';
import { readSuggestionLines, liqClassOf, LIQ_CLASSES } from '../lib/render/suggestlog.mjs';
import { parseArgs } from '../lib/render/cli.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { reachPredictions, scoreRow, scoreReachability, matchedPool, REACH_ESTIMATORS } from '../lib/render/reachability.mjs';

const DEFAULT_HORIZON_H = 24;
const DEFAULT_MIN_N = 8;          // the join-outcomes --report floor, reused — no new threshold
const ROBUST_N = 30;              // MIN_N_F1, reused — a retirement wants a cell at this depth

/* Every co-logged read in the ledger → a scorable row. `reachable` is the universal co-log marker
 * (logged on held AND discovery reads); a row without it predates RC-S1. */
export function readRows() {
  const rows = []; const drop = { noColog: 0, badClass: 0, badTs: 0 };
  for (const line of readSuggestionLines()) {
    if (!line.trim()) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (s.itemId == null || s.ts == null) { drop.badTs++; continue; }
    if (s.reachable == null) { drop.noColog++; continue; }
    // `class` is NOT single-vocabulary — watch-positions logs its richer classify() taxonomy
    // (FALLING / STABLE_LIQUID / …) into the same field, and those are not liquidity classes. Prefer the
    // logged volDay scalar; else accept only the LIQ_CLASSES vocabulary; else DROP rather than invent one.
    const liqClass = s.volDay != null ? liqClassOf(s.volDay) : (LIQ_CLASSES.has(s.class) ? s.class : null);
    if (liqClass == null) { drop.badClass++; continue; }
    rows.push({ itemId: s.itemId, ts: s.ts, side: 'sell', liqClass,
      regime: s.regime || 'noreg', preds: reachPredictions(s) });
  }
  return { rows, drop };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const horizonH = a.horizon != null ? Number(a.horizon) : DEFAULT_HORIZON_H;
  const minN = a['min-n'] != null ? Number(a['min-n']) : DEFAULT_MIN_N;
  const asJson = !!a.json, onlyItem = a.item != null ? String(a.item) : null;

  let { rows, drop } = readRows();
  if (onlyItem) {
    const mapping = await loadMapping();
    const hit = mapping?.resolve?.(onlyItem);
    if (!hit) { console.error(`--item: could not resolve "${onlyItem}" to an item id`); process.exit(1); }
    rows = rows.filter(r => r.itemId === hit.id);
  }
  if (!rows.length) { console.log('no co-logged rows in the ledger — nothing to score.'); return; }

  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const byItem = new Map();
  for (const r of rows) { if (!byItem.has(r.itemId)) byItem.set(r.itemId, []); byItem.get(r.itemId).push(r); }
  const scored = [];
  let unresolved = 0;
  for (const [id, rs] of byItem) {
    const series = db.seriesFor(id, '1h', {});
    for (const r of rs) { const out = scoreRow(series, r, { horizonH }); if (out) scored.push({ row: r, out }); else unresolved++; }
  }
  try { db.db.close(); } catch {}

  const res = scoreReachability(scored, { minN });
  // The head-to-head proper: reads priced by all members of each set at once. NOTE each set holds THREE
  // contenders + two reference lines — no matched pool ever holds all five. depth is excluded from
  // the first two pools — it needs a held qty, so requiring it would collapse the pool to the watch surface.
  const MATCHED_SETS = [
    ['pressure', 'asym', 'reachFold', 'quickSell*', 'optSell*'],
    ['pressure', 'asym', 'reachRelief', 'quickSell*', 'optSell*'],
    ['pressure', 'asym', 'depth', 'quickSell*', 'optSell*'],
  ];
  const matched = MATCHED_SETS.map(k => matchedPool(scored, k)).filter(Boolean);

  if (asJson) {
    console.log(JSON.stringify({ app: 'the-coffer-reach-outcomes', version: 1, horizonH, minN,
      caveat: 'reached != filled — every rate is an UPPER BOUND on a real offer',
      poolRows: rows.length, unresolved, drop, matched, ...res }, null, 2));
    return;
  }

  const pctf = x => x == null ? '—' : (100 * x).toFixed(0) + '%';
  const hp = x => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
  const HEAD = '| estimator | n | reached ≤' + horizonH + 'h | gap to top (all rows) | headroom when reached | shortfall when missed |';
  const SEP = '| --- | --- | --- | --- | --- | --- |';
  const line = e => `| ${e.key} | ${e.n} | ${pctf(e.reachRate)} | ${hp(e.medGapPct)} | ${hp(e.medHeadroomPct)} | ${hp(e.medMissGapPct)} |`;

  console.log(`\n── join-reach-outcomes — each co-logged exit ask, scored FORWARD over ≤${horizonH}h of 1h archive ──`);
  console.log(`pool ${rows.length} co-logged read(s) over ${byItem.size} item(s)  ·  scored ${scored.length}  ·  unresolved (archive too short) ${unresolved}`);
  console.log(`dropped: ${Object.entries(drop).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

  console.log(`\n## Coverage — what the co-log can actually score (ragged BY DESIGN, not a bug)`);
  console.log('| estimator | rows | of ' + scored.length + ' |');
  console.log('| --- | --- | --- |');
  for (const c of res.coverage) console.log(`| ${c.key} | ${c.n} | ${scored.length ? Math.round(c.n / scored.length * 100) : 0}% |`);
  console.log(`  depth needs a HELD qty, so it only ever logs on watch/held-quote reads. reachFold and`);
  console.log(`  reachRelief are the same estimator with and without the softening and NEVER co-occur, so`);
  console.log(`  this cannot answer "does relief help?" — that needs the relief=0 counterfactual logged too.`);

  console.log(`\n## Pooled — ALL cells together. Simpson-prone across liquidity/regime; ranks nothing alone.`);
  console.log(HEAD); console.log(SEP);
  for (const e of res.pooled.estimators) console.log(line(e));

  for (const m of matched) {
    console.log(`
## MATCHED head-to-head — the ${m.n} read(s) over ${m.items} item(s) that ALL of these priced`);
    console.log(HEAD); console.log(SEP);
    for (const e of m.estimators) console.log(line(e));
  }
  console.log(`  The pooled table above computes each estimator over a DIFFERENT row set; only these`);
  console.log(`  matched rows are the same trade priced N ways, so read a comparison here, not there.`);

  console.log(`\n## Per cell (side × class × regime) — a retirement needs a cell at n≥${ROBUST_N}, sustained`);
  for (const c of res.cells) {
    if (!c.scorable) continue;
    console.log(`\n### ${c.key} — n=${c.n}${c.n >= ROBUST_N ? ' ROBUST' : ''}`);
    console.log(HEAD); console.log(SEP);
    for (const e of c.estimators) console.log(line(e));
  }
  const hidden = res.cells.filter(c => !c.scorable);
  if (hidden.length) console.log(`\n  ${hidden.length} cell(s) under the n≥${minN} floor, not shown: ${hidden.map(c => `${c.key} (n=${c.n})`).join(' · ')}`);

  console.log(`
⚠ n counts READS, not independent trades: ${scored.length} reads over ${byItem.size} item(s) — the`);
  console.log(`  screen re-prices the same item many times a day, so rows are heavily item-day clustered and the`);
  console.log(`  effective n is far below nominal. Treat a 5-figure n as a shape, never as a confidence interval.`);
  console.log(`\n⚠ Reached != filled — queue position is invisible, so every rate bounds a real offer from ABOVE.`);
  console.log(`\n⚠ THIS SURFACE DOES NOT RANK ESTIMATORS. "reached" and "gap to top" are the SAME comparison`);
  console.log(`  (reached <=> gap >= 0), so they are one statistic printed twice, not two agreeing ones — and both`);
  console.log(`  are monotone in the ask price, so any ordering they produce is a PRICE-LEVEL ordering. That is why`);
  console.log(`  quickSell*, the null, beats every contender on both columns: read literally, the metric says`);
  console.log(`  "always instasell". A miss costs a RE-LIST, not the trade, and nothing here prices that; until the`);
  console.log(`  cost model join-reach-basis.mjs already carries (mcnemarCost / cost-ratio r / rStar) is ported,`);
  console.log(`  read these tables as a DESCRIPTION of where each estimator prices, never as a winner.`);
  console.log(`  Also horizon-conditional: pressure's gap runs -2.9% at H=6, -1.6% at H=24, +0.2% at H=96. Quote H.`);
  console.log(`  Of the two columns right of "gap to top", both CONDITION on reaching, and reaching selects the`);
  console.log(`  high-topping rows, so a rarely-reaching estimator's conditional headroom is flattered. * = reference lines:`);
  console.log(`  quickSell is the live market print (the true null); optSell is the tool's OWN band edge, so an`);
  console.log(`  estimator beating it has beaten a sibling, not an outside check. Scores the ASK leg only.`);
  console.log(`  ${res.meta.nScorableCells} scorable cell(s); a retirement needs one sustained over a window, not one report.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
