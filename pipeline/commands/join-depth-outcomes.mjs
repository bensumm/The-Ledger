#!/usr/bin/env node
/**
 * join-depth-outcomes.mjs — score the DEPTH model against REALIZED sells (PLAN-DEPTH-EXIT, the
 * missing outcome half of DE3).
 *
 *   node pipeline/commands/join-depth-outcomes.mjs                 the report
 *   node pipeline/commands/join-depth-outcomes.mjs --json          the per-episode scored array
 *   node pipeline/commands/join-depth-outcomes.mjs --item "<name>" one item's per-episode table
 *   node pipeline/commands/join-depth-outcomes.mjs --competition 8 --nights 21
 *                                                                 sweep the model's own constants
 *
 * ── READ THIS BEFORE QUOTING ANY NUMBER THIS PRINTS ────────────────────────────────────────────
 * The v1 of this script (2026-08-11) was reviewed and its headline reading was WRONG. Kept here
 * because the failure is the useful part:
 *
 *   THE RESIDUAL IS DOMINATED BY PRICE TREND, NOT DEPTH. `clearableAsk` averages `nights` COMPLETE
 *   local days ending at the previous midnight (the `windowBuckets` today-skip, js/windowread.mjs).
 *   On a trending item that window LAGS, so `realized − predicted` mostly reads the item's drift.
 *   Measured over 392 lots: corr(residual, 14d drift) = 0.61, and the swing across trend buckets
 *   (−0.29% falling → +3.73% rising, ~4.0pp) was SEVEN TIMES the 0.58pp "size gradient" v1 asked
 *   the reader to interpret. v1's Dragon boots finding ("the model overstates, 10 of 12 lots
 *   negative") was an artifact: boots fell ~7% that week and a trailing average lagged it.
 *
 * So this report ALWAYS stratifies by trend, and the size comparison is only meaningful WITHIN a
 * trend bucket. Do not read a size gradient off the pooled column; it is confounded by construction.
 * `predictedAsk` also is NOT the "conservative floor" `clearableAsk`'s own header claims — measured,
 * it sits at the ~52nd percentile of the window's hourly high prints and equals the window max on
 * 0% of lots.
 *
 * ── WHAT IS BEING TESTED ───────────────────────────────────────────────────────────────────────
 * `clearableAsk` answers "what ask books QTY units?". Its `DEPTH_COMPETITION_MULT` (×4) is an n≈0
 * PLACEHOLDER never scored against a fill. HONEST STATUS: on the current book this report CANNOT
 * calibrate it — sweeping competition 0.5→16 (a 32× range) moves the median residual 0.20pp, and
 * 4→8 leaves ~71% of predictions bit-identical. It is also not yet distinguishable from the trivial
 * null model (just use the window's MEDIAN hourly high — always computed, there is NO --null-model flag). Both are printed so the
 * comparison is visible rather than assumed. Treat this as instrumentation that will become
 * informative as big-lot sells accrue, NOT as a live calibration.
 *
 * ── WHY IT RECOMPUTES RATHER THAN READING THE LOG ──────────────────────────────────────────────
 * `depthExit` IS logged on held rows, but joining the full ledger (active file + `suggestions-archive/`
 * via the canonical `readSuggestionLines`) to these sells covers only ~60 of 392 lots. Recomputing
 * from the archive scores all of them. NOTE the sparseness is NOT purely "few held lots": the
 * `quote-items.mjs --positions` path computes the depth read and never passes `depthExit` to
 * `suggestionEntry` (0 of 81 held-lot rows carry it), and on a default run it is not even computed
 * (it sits inside the `--pressure-exit` branch). That is a separate instrumentation bug.
 *
 * NO LOOK-AHEAD: the series is truncated to `ts < sellTs` AND `now` is pinned to the sell moment.
 * BOTH matter — dropping the `now` pin alone changes the prediction on 42% of lots. `joindepth.test.mjs`
 * mutation-tests both; the v1 test was VACUOUS (it passed with the truncation deleted entirely,
 * because its synthetic spike landed on the sell's own local day where the today-skip drops it
 * regardless). Do not "simplify" either guard, and do not trust a look-ahead test you have not
 * watched FAIL against deliberately broken source.
 *
 * ── HONESTY (rule 4) ───────────────────────────────────────────────────────────────────────────
 * `sellEach` is a real fill, but CENSORED: it records where Ben's ask was PLACED and filled, not the
 * highest price that would have filled. n is also far below the row count — rows are FIFO fragments,
 * so they are aggregated into SELL EPISODES here (same item, same hour) because a 39-unit sell split
 * into 16 FIFO rows would otherwise be scored as sixteen ~2-unit lots, corrupting the size axis
 * specifically. Even then episodes cluster hard by item (~77 items), so every interval is
 * item-CLUSTER bootstrapped, never lot-level.
 *
 * The pure core is EXPORTED + fixture-tested; the CLI wiring is guarded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearableAsk } from '../../js/windowread.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import * as archive from '../lib/market/archive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', '..', 'positions.json');

// Size buckets as a fraction of daily flow. The denominator is the LIMITING side —
// `min(highPriceVolume, lowPriceVolume)` — because that is what `js/quotecore.js`'s `volDay` is, what
// `reachRelief`'s `sizeRatio` divides by, and what the n≈6 knee study back-solves to. v1 summed BOTH
// sides, which measured a median 2.24× larger denominator, emptied the >2% buckets entirely, and
// REVERSED the apparent direction of the size effect. If you change this, you break comparability
// with REACH_RELIEF_SIZE_FULL and the ~0.5–1% measured knee, which is the only reason the axis exists.
export const SIZE_BUCKETS = [
  { key: '<0.5%',   lo: 0,      hi: 0.005 },
  { key: '0.5–1%',  lo: 0.005,  hi: 0.01  },
  { key: '1–2%',    lo: 0.01,   hi: 0.02  },
  { key: '2–5%',    lo: 0.02,   hi: 0.05  },
  { key: '≥5%',     lo: 0.05,   hi: Infinity },
];

// Trend buckets on the item's own drift across the SAME window the model averaged. Not a refinement —
// without this the residual is mostly drift (r=0.61) and no size reading is supportable.
export const TREND_BUCKETS = [
  { key: 'falling', lo: -Infinity, hi: -0.02 },
  { key: 'flat',    lo: -0.02,     hi: 0.02  },
  { key: 'rising',  lo: 0.02,      hi: Infinity },
];

const median = xs => {
  if (!xs || !xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* sellEpisodes(closedLots, {bucketSec}) → FIFO fragments merged into one row per (item, hour).
 * `qty` on a closed row is a FIFO MATCH fragment, not the size the book absorbed. Aggregating is
 * required for the size axis to mean anything: qty sums, price is QUANTITY-WEIGHTED. */
export function sellEpisodes(lots, { bucketSec = 3600 } = {}) {
  const by = new Map();
  for (const l of lots || []) {
    if (l.sellTs == null || !(l.qty > 0) || !(l.sellEach > 0)) continue;
    const key = `${l.itemId}:${Math.floor(l.sellTs / bucketSec)}`;
    const e = by.get(key) || { itemId: l.itemId, qty: 0, gp: 0, sellTs: l.sellTs, nRows: 0 };
    e.qty += l.qty;
    e.gp += l.qty * l.sellEach;
    e.nRows++;
    if (l.sellTs > e.sellTs) e.sellTs = l.sellTs;   // the episode ends at its last fragment
    by.set(key, e);
  }
  return [...by.values()].map(e => ({ itemId: e.itemId, qty: e.qty, sellEach: e.gp / e.qty, sellTs: e.sellTs, nRows: e.nRows }))
    .sort((a, b) => a.sellTs - b.sellTs);
}

/* scoreDepthLot(series, lot, opts) → the depth model's score for ONE sell episode.
 *   series — the item's 1h series ({timestamp, avgLowPrice, avgHighPrice, lowPriceVolume,
 *            highPriceVolume}), ascending. May extend past the sell; this truncates.
 *   lot    — { qty, sellEach, sellTs }.
 *   opts   — { nights, minSeriesDays, competition }.
 * Returns { resolved, reason?, predictedAsk, nullAsk, realized, residual, residualPct, nullResidualPct,
 *           sizeFrac, volDay, drift, askPctile, qty }. */
export function scoreDepthLot(series, lot, { nights = 14, minSeriesDays = 5, competition } = {}) {
  const { qty, sellEach, sellTs } = lot || {};
  if (qty == null || !(qty > 0)) return { resolved: false, reason: 'no-qty' };
  if (sellEach == null || !(sellEach > 0)) return { resolved: false, reason: 'no-sell-price' };
  if (sellTs == null) return { resolved: false, reason: 'no-sell-ts' };

  const pre = (series || []).filter(p => Number.isFinite(p.timestamp) && p.timestamp < sellTs);
  if (!pre.length) return { resolved: false, reason: 'no-archive-before-sell' };
  const spanDays = (pre[pre.length - 1].timestamp - pre[0].timestamp) / 86400;
  if (spanDays < minSeriesDays) return { resolved: false, reason: 'archive-too-short' };

  const caOpts = { qty, wStart: 0, wEnd: 0, nights, now: new Date(sellTs * 1000) };
  if (competition != null) caOpts.competition = competition;
  // The key is `price`, NOT `ask` — `depthExitShadow` renames it for the ledger, this reads the raw
  // return. v1 read `.ask` and silently declined all 392 lots behind a plausible "nothing scoreable".
  const ca = clearableAsk(pre, caOpts);
  if (!ca || ca.price == null) return { resolved: false, reason: (ca && ca.reason) || 'model-declined' };

  // The comparison window: the same COMPLETE local days the model averaged (it skips the sell's own
  // day). Reproducing that boundary here is what keeps volDay, drift and the null model on the model's
  // own basis — v1 used a raw [sellTs − nights·86400, sellTs) slice, which included the partial sell
  // day (so Ben's own sell inflated his own denominator on 387 of 392 lots) and part of a 15th day.
  const sellDay = new Date(sellTs * 1000);
  const midnight = new Date(sellDay.getFullYear(), sellDay.getMonth(), sellDay.getDate(), 0, 0, 0, 0);
  const dayEnd = Math.floor(midnight.getTime() / 1000);
  const dayFrom = dayEnd - nights * 86400;
  const win = pre.filter(p => p.timestamp >= dayFrom && p.timestamp < dayEnd);
  if (!win.length) return { resolved: false, reason: 'no-complete-days' };

  // volDay on the LIMITING side, matching js/quotecore.js volDay = min(hpv, lpv) — the basis
  // reachRelief's sizeRatio and the ~0.5–1% knee study both use. Summing both sides is a ~2.24× error.
  let hi = 0, lo = 0;
  for (const p of win) { hi += (p.highPriceVolume || 0); lo += (p.lowPriceVolume || 0); }
  const winDays = Math.max(1 / 24, (win[win.length - 1].timestamp - win[0].timestamp) / 86400);
  const volDay = Math.min(hi, lo) / winDays;
  const sizeFrac = volDay > 0 ? qty / volDay : null;

  // Drift across the model's own window: mean high of the last 3 days vs the first 3. This is the
  // confound control, not a nicety — see the header.
  const highs = win.filter(p => p.avgHighPrice != null);
  let drift = null;
  if (highs.length >= 6) {
    const span = highs[highs.length - 1].timestamp - highs[0].timestamp;
    const third = span / 4;
    const early = highs.filter(p => p.timestamp <= highs[0].timestamp + third).map(p => p.avgHighPrice);
    const late = highs.filter(p => p.timestamp >= highs[highs.length - 1].timestamp - third).map(p => p.avgHighPrice);
    const a = early.length ? early.reduce((x, y) => x + y, 0) / early.length : null;
    const b = late.length ? late.reduce((x, y) => x + y, 0) / late.length : null;
    if (a && b && a > 0) drift = (b - a) / a;
  }

  // NULL MODEL: the window's median hourly high. If the depth model cannot beat this it is not
  // earning its complexity, whatever its residual looks like in isolation.
  const nullAsk = median(highs.map(p => p.avgHighPrice));
  // Where the prediction sits in the window's high prints — tests the "conservative floor" claim.
  const sortedHi = highs.map(p => p.avgHighPrice).sort((a, b) => a - b);
  const askPctile = sortedHi.length ? sortedHi.filter(v => v <= ca.price).length / sortedHi.length : null;

  const residual = sellEach - ca.price;
  return {
    resolved: true,
    predictedAsk: ca.price,
    nullAsk,
    realized: sellEach,
    residual,
    residualPct: residual / ca.price,
    nullResidualPct: (nullAsk && nullAsk > 0) ? (sellEach - nullAsk) / nullAsk : null,
    sizeFrac, volDay, drift, askPctile, qty,
    clearFrac: ca.clearFrac ?? null,
    competition: ca.competition ?? null,
  };
}

/* bucketBy(scored, buckets, field) → per-bucket aggregates. Generic over SIZE_BUCKETS/TREND_BUCKETS. */
export function bucketBy(scored, buckets, field) {
  return buckets.map(b => {
    const inB = (scored || []).filter(s => s.resolved && s[field] != null && s[field] >= b.lo && s[field] < b.hi);
    if (!inB.length) return { ...b, n: 0, medianPct: null, underFrac: null };
    return {
      ...b, n: inB.length,
      medianPct: median(inB.map(s => s.residualPct)),
      underFrac: inB.filter(s => s.residual < 0).length / inB.length,
    };
  });
}

/* clusterBootstrapCI(scored, split, {iters, seed}) → 95% CI on the difference in median residual
 * between the two arms of `split`, resampling ITEMS (not lots) with replacement. Episodes cluster
 * hard by item, so a lot-level interval is far too narrow. Seeded ⇒ deterministic output. */
export function clusterBootstrapCI(scored, split, { iters = 2000, seed = 12345 } = {}) {
  const rows = (scored || []).filter(s => s.resolved && split(s) != null);
  if (rows.length < 4) return null;
  const byItem = new Map();
  for (const r of rows) { const k = r.itemId ?? 0; if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(r); }
  const items = [...byItem.values()];
  if (items.length < 2) return null;
  // REFUSE when the split is perfectly NESTED inside items — i.e. no single item appears in both
  // arms. Then "big vs small" and "item A vs item B" are the same contrast, the resample can only
  // ever draw the one between-item difference, and the interval comes back absurdly tight (measured:
  // width 0) while looking like evidence. This is the realistic failure, not a corner case: an item
  // tends to be sold in consistent sizes, so nesting is the DEFAULT unless a lot varies its size.
  const spanning = items.filter(rows => rows.some(r => split(r) === true) && rows.some(r => split(r) === false));
  if (spanning.length < 2) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const diffs = [];
  for (let i = 0; i < iters; i++) {
    const draw = [];
    for (let k = 0; k < items.length; k++) draw.push(...items[Math.floor(rnd() * items.length)]);
    const a = median(draw.filter(r => split(r) === true).map(r => r.residualPct));
    const b = median(draw.filter(r => split(r) === false).map(r => r.residualPct));
    if (a != null && b != null) diffs.push(a - b);
  }
  if (diffs.length < iters / 4) return null;
  diffs.sort((x, y) => x - y);
  return { lo: diffs[Math.floor(diffs.length * 0.025)], hi: diffs[Math.floor(diffs.length * 0.975)], n: diffs.length };
}

/* readClosedLots(positionsPath) → scoreable realized sells. Excludes `withdrawn` (personal-use
 * tombstones — a realised-0 row is not a market sell) and `banked` (declared basis, not a fill). */
export function readClosedLots(positionsPath = POSITIONS) {
  let p;
  try { p = JSON.parse(fs.readFileSync(positionsPath, 'utf8')); } catch { return []; }
  return (p.closed || []).filter(c => !c.withdrawn && !c.banked && c.sellEach > 0 && c.qty > 0 && c.sellTs != null);
}

// --- CLI (guarded) --------------------------------------------------------------------------------
const pct = v => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
const num = v => (v == null ? '—' : Math.round(v).toLocaleString());

async function main() {
  const args = process.argv.slice(2);
  const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const asJson = args.includes('--json');
  const wantItem = flag('--item');
  const competition = flag('--competition') != null ? Number(flag('--competition')) : null;
  const nights = flag('--nights') != null ? Number(flag('--nights')) : 14;

  const lots = readClosedLots();
  if (!lots.length) { console.log('# Depth-model outcome score\n_no scoreable closed lots in positions.json_'); return; }

  let map = null;
  try { map = await loadMapping(); } catch { map = null; }
  const nameOf = id => (map && map.byId[id]?.name) || ('#' + id);

  const picked = wantItem
    ? lots.filter(l => String(l.itemId) === String(wantItem) || nameOf(l.itemId).toLowerCase() === String(wantItem).toLowerCase())
    : lots;
  if (!picked.length) { console.log(`# Depth-model outcome score\n_no closed lots matched \`${wantItem}\`_`); return; }
  const episodes = sellEpisodes(picked);

  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const cache = new Map();
  const scored = [];
  for (const e of episodes) {
    let series = cache.get(e.itemId);
    if (!series) {
      series = db.seriesFor(e.itemId, '1h', {}).map(r => ({ timestamp: r.ts, avgLowPrice: r.avgLowPrice, avgHighPrice: r.avgHighPrice, lowPriceVolume: r.lowPriceVolume, highPriceVolume: r.highPriceVolume }));
      cache.set(e.itemId, series);
    }
    scored.push({ itemId: e.itemId, name: nameOf(e.itemId), sellTs: e.sellTs, nRows: e.nRows, ...scoreDepthLot(series, e, { nights, competition }) });
  }
  try { db.db.close(); } catch {}

  if (asJson) { console.log(JSON.stringify(scored, null, 2)); return; }

  const res = scored.filter(s => s.resolved);
  const items = new Set(res.map(s => s.itemId)).size;
  console.log('# Depth-model outcome score — clearableAsk vs REALIZED sells');
  console.log(`closed rows: ${picked.length} → sell EPISODES (same item, same hour): ${episodes.length} · scored: ${res.length} · distinct items: ${items}`);
  console.log(`model: competition ${competition ?? 'default(4)'} · nights ${nights}`);
  const declined = scored.filter(s => !s.resolved);
  if (declined.length) {
    const why = {};
    for (const d of declined) why[d.reason] = (why[d.reason] || 0) + 1;
    console.log(`declined: ${Object.entries(why).map(([k, v]) => `${k} ×${v}`).join(' · ')}`);
  }
  if (!res.length) { console.log('\n_(nothing scoreable)_'); return; }

  console.log(`\n⚠ THE RESIDUAL IS TREND-CONFOUNDED — read the trend rows, never the pooled number:`);
  console.log('| trend (14d drift) | n | median residual | realized < predicted |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const b of bucketBy(res, TREND_BUCKETS, 'drift')) {
    console.log(`| ${b.key} | ${b.n} | ${pct(b.medianPct)} | ${b.underFrac == null ? '—' : (b.underFrac * 100).toFixed(0) + '%'} |`);
  }

  console.log(`\nSIZE (qty ÷ limiting-side daily flow) — WITHIN the flat-trend arm only, to avoid the confound:`);
  const flat = res.filter(s => s.drift != null && s.drift > -0.02 && s.drift < 0.02);
  console.log('| size bucket | n | median residual | realized < predicted |');
  console.log('| --- | ---: | ---: | ---: |');
  for (const b of bucketBy(flat, SIZE_BUCKETS, 'sizeFrac')) {
    console.log(`| ${b.key} | ${b.n} | ${pct(b.medianPct)} | ${b.underFrac == null ? '—' : (b.underFrac * 100).toFixed(0) + '%'} |`);
  }
  const ci = clusterBootstrapCI(flat, s => (s.sizeFrac == null ? null : s.sizeFrac >= 0.005));
  if (ci) {
    const straddles = ci.lo < 0 && ci.hi > 0;
    console.log(`\n  big (≥0.5%) − small (<0.5%) median residual, item-CLUSTER bootstrap 95% CI: [${pct(ci.lo)}, ${pct(ci.hi)}]`);
    console.log(`  ${straddles ? '⇒ STRADDLES ZERO — there is NO supportable size gradient in this data. Do not read one.' : '⇒ excludes zero — a size effect is present at this n.'}`);
  } else {
    console.log('\n  (too few items/episodes for a cluster-bootstrap interval — no size claim is supportable)');
  }

  const nullOk = res.filter(s => s.nullResidualPct != null);
  if (nullOk.length) {
    console.log(`\nNULL MODEL CHECK — is the depth model beating "just use the window's median hourly high"?`);
    console.log(`  depth model : median residual ${pct(median(nullOk.map(s => s.residualPct)))} · realized below on ${(nullOk.filter(s => s.residual < 0).length / nullOk.length * 100).toFixed(0)}%`);
    console.log(`  null model  : median residual ${pct(median(nullOk.map(s => s.nullResidualPct)))} · realized below on ${(nullOk.filter(s => s.realized < s.nullAsk).length / nullOk.length * 100).toFixed(0)}%`);
  }
  const pcts = res.filter(s => s.askPctile != null).map(s => s.askPctile);
  if (pcts.length) console.log(`\n"conservative floor"? predictedAsk sits at the ${(median(pcts) * 100).toFixed(1)}th percentile (median) of the window's hourly highs — it is a CENTRAL estimate, not a floor.`);

  if (wantItem) {
    console.log(`\nPER-EPISODE — ${nameOf(picked[0].itemId)}:`);
    console.log('| sold | qty | rows | size% | drift | predicted | realized | residual |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const s of res) {
      const d = new Date(s.sellTs * 1000);
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      console.log(`| ${stamp} | ${s.qty} | ${s.nRows} | ${s.sizeFrac == null ? '—' : (s.sizeFrac * 100).toFixed(2) + '%'} | ${pct(s.drift)} | ${num(s.predictedAsk)} | ${num(s.realized)} | ${pct(s.residualPct)} |`);
    }
  }

  console.log('\nHONESTY (rule 4): the residual is TREND-DOMINATED (corr ≈0.61 with 14d drift measured on the');
  console.log('2026-08-11 book) — a pooled reading measures lag, not depth. `sellEach` is CENSORED: it records');
  console.log('where the ask was PLACED and filled, not the highest price that would have filled. Rows are FIFO');
  console.log('fragments, aggregated here into same-hour episodes; episodes still cluster hard by item, so every');
  console.log('interval is item-cluster bootstrapped. DEPTH_COMPETITION_MULT is NOT calibratable from this yet —');
  console.log('sweep it with --competition and watch how little moves. F1 owns the constant, not this script.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
