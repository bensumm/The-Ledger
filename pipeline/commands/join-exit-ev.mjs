#!/usr/bin/env node
/* join-exit-ev.mjs — the decisive backtest for the reach surface (PLAN-REACH-SURFACE ch.4).
 *
 * Scores the POLICY, not the prediction: at each origin, list at the contender's ask for H hours; if
 * the 1h archive reaches it, credit net(ask); else bail at the window's last instasell, less the cost
 * of having waited. Realized net gp/unit, normalized by the origin's reference price.
 *
 * WHY THIS CAN RANK WHERE THE CO-LOG SCORER COULD NOT. join-reach-outcomes measures reach and gap,
 * both monotone in the ask, so read literally it says "always instasell". This metric is not monotone:
 * raising the ask raises the payoff and lowers the odds of collecting it. And every contender is
 * priced at EVERY origin, so the pool is matched by construction rather than by whatever the deployed
 * surfaces happened to co-log.
 *
 * NO LOOK-AHEAD IS AN HOUR FINER THAN IT LOOKS. An archive bucket is stamped with the START of its
 * hour, so the bucket AT an origin is future data; `readableCut` stops strictly before it and the
 * outcome window starts after it, leaving that one bucket to neither side. The stamping convention is
 * settled by comparing a 1h bucket's volume against the twelve 5m buckets on each side of it, NOT by
 * the store-lag: the fetcher only ever asks for `lastCompleteHour()`, so a lag over an hour is a
 * property of the fetch policy and reads identically under either convention.
 *
 * RECOMPUTE, NOT REPLAY. Contenders are rebuilt from the series truncated at each origin, so this
 * scores RECONSTRUCTIONS of the incumbents, not the deployed estimators. That swap is what buys the
 * matched pool, and it is the one thing nothing else in the plan bounds — so the report opens with an
 * acceptance check measuring each reconstruction against the ask that estimator actually logged.
 * askStar has no co-logged counterpart, so the acceptance check bounds the INCUMBENTS ONLY.
 */

/* PRE-REGISTERED before the first full run, so a result cannot be reframed after seeing it:
 *   decisive spec — H=24, delayCost 0, pooled and per cell (liqClass x fcTrack classification);
 *   two arms      — bare `askStar` on the pool it consents to price (the plan's own comparison) and
 *                   `askStar+fold`, the fallback policy chunk 5 would ship, on EVERY origin. Both
 *                   must clear before a default swap is licensed: a stricter bar than the plan set,
 *                   because bare askStar gates its own pool and a conditioned win is not a shippable
 *                   one. Registered before the first full run, alongside the rest of this block.
 *   what the pilot saw — this block was NOT written blind. A 6-item shakedown ran first and is what
 *                   added the second arm (askStar refused ~40% of origins), the bail-convention
 *                   sensitivity (the two conventions rank contenders differently), and the fix for a
 *                   reconstruction bug the acceptance check caught: asym was rebuilt as the RAW
 *                   quantile while the deployed estimator logs the ORDERING-GUARDED level, which
 *                   moved asym from last place to first. Disclosed rather than tidied away.
 *   sensitivities — H in {6,48,96}; era halves; independent-window thinning; the delayCost sweep;
 *   intervals     — item-CLUSTER bootstrap on the PAIRED per-origin difference, never origin-level;
 *   retirement    — an estimator retires from the EXIT-PRICING surfaces when its deficit against the
 *                   best contender has a cluster CI clear of zero at the decisive spec AND the same
 *                   sign in at least 2 of the 3 sensitivity horizons. Bid-side consumers survive.
 *   null branch   — if askStar does not beat the best incumbent under that criterion, the surface
 *                   ships as a DESCRIPTION layer, chunk 5's default swap is cancelled, and the plan's
 *                   headline claim is downgraded. Written before the run, not after.
 *   invalidator   — a ranking that flips sign between era halves voids the pooled headline and blocks
 *                   any retirement, however tight the pooled interval looks.
 */

/* HONEST LIMITS, and they bind harder than the row count suggests.
 * REACHED IS NOT FILLED — queue position is invisible in a bucketed aggregate, so every reach rate
 * bounds a real offer from above, and it flatters the HIGH asks most. One 92-day era, one update
 * cycle. Origins overlap unless thinned, and all of an item's origins share one price path, so the
 * effective n is far below the row count — hence the cluster bootstrap. The bail branch is the same
 * price for every contender at an origin, so the entire comparison lives in the reached rows.
 *
 * Run: node pipeline/commands/join-exit-ev.mjs [--items N] [--stride H] [--horizon H] [--json]
 *      [--delay-cost-frac f] [--depth-qty-frac f] [--min-rows N] [--warmup-days N] [--acceptance-n N]
 *      [--bail low|high]
 */
import { fileURLToPath } from 'node:url';
import * as archive from '../lib/market/archive.mjs';
import { parseArgs, median } from '../lib/render/cli.mjs';
import { readSuggestionLines, liqClassOf } from '../lib/render/suggestlog.mjs';
import { buildReachSurface } from '../../js/reach-surface.mjs';
import { askStar } from '../../js/exit-ev.mjs';
import { maxHighWithin, endLowWithin, endHighWithin, covers, HOUR } from '../../js/forward-reach.mjs';
import { windowStats, reachableBand, asymPair, clearableAsk, reachedDays, recencySplit, floorCeilingTrack, RECENT_NIGHTS } from '../../js/windowread.mjs';
import { estimatePair } from '../lib/signal/estimators.mjs';
import { FLIP_NICHES } from '../../js/flip-niches.mjs';
import { tax } from '../../js/money-math.js';

export const DECISIVE_H = 24;
export const SENSITIVITY_H = [6, 48, 96];
export const DEFAULT_ITEMS = 80;
export const DEFAULT_ORIGIN_STRIDE_H = 24;
export const DEFAULT_MIN_ROWS = 1800;
export const DEFAULT_WARMUP_DAYS = 30;
export const DEFAULT_NIGHTS = 14;
// delayCost as a FRACTION of the reference price: gp is not comparable across a 400gp rune and a 1b bow.
export const DELAY_COST_SWEEP = [0, 0.002, 0.005, 0.01, 0.02, 0.05];
// The depth contender needs a size. A stated fraction of the origin's daily flow, not an inherited
// one: the deployed reads size against a held lot, which no archive origin has.
export const DEFAULT_DEPTH_QTY_FRAC = 0.005;
export const LADDER_Z_STEP = 0.5;
export const MIN_CELL_N = 30;
// Acceptance rows below this and the reconstruction is UNBOUNDED, not merely thin. One matched row is
// not a bound, and treating "n > 0" as one let a contender with a single row out of the block.
export const ACCEPTANCE_MIN_ROWS = MIN_CELL_N;
export const BOOTSTRAP_ITERS = 2000;
export const BOOTSTRAP_SEED = 12345;   // the seed the sibling joiners use; one value keeps them comparable
// Which end-of-window price a never-reached ask bails at. 'low' crosses the spread into a standing
// bid; 'high' rests at the ask level. Chunk 1 chose 'low'; both are scored because the choice moves
// the ranking - it shifts only the REACHED rows, so contenders with different reach rates move apart.
export const BAIL_MODES = ['low', 'high'];

const netOf = px => (Number.isFinite(px) && px > 0 ? px - tax(px) : null);
const mean = xs => (xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctf = (v, d = 2) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const rate = v => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

/* The contender registry. `baseline` marks a reference line, never a candidate for the default.
 * `askStar+fold` is the DEPLOYABLE policy chunk 5 would ship — the surface where it prices, reach-fold
 * where it refuses — and it is the only key that scores on every origin. Bare `askStar` gates its own
 * pool, so the two answer different questions and both are reported. */
export const CONTENDERS = Object.freeze([
  { key: 'askStar', baseline: false },
  { key: 'askStar+fold', baseline: false },
  { key: 'pressure', baseline: false },
  { key: 'asym', baseline: false },
  { key: 'reachFold', baseline: false },
  { key: 'depth', baseline: false },
  { key: 'refHigh*', baseline: true },
  { key: 'quickSell*', baseline: true },
]);
export const CONTENDER_KEYS = CONTENDERS.map(c => c.key);
export const ESTIMATOR_POOL_KEYS = CONTENDER_KEYS.filter(k => k !== 'askStar+fold');
export const DEPLOYABLE_POOL_KEYS = CONTENDER_KEYS.filter(k => k !== 'askStar');
export const INCUMBENT_KEYS = ['pressure', 'asym', 'reachFold', 'depth'];
// The policies under test. They are judged by `verdict`, and nothing here can "retire" a policy that
// was never deployed — a nomination against one is a category error, not a finding.
export const ARM_KEYS = ['askStar', 'askStar+fold'];
export const BASELINE_KEYS = CONTENDERS.filter(c => c.baseline).map(c => c.key);

/* The live pair as of an origin, from the last printing bucket at or before it. `quickSell` is the
 * instabuy — where a SELL fills — per js/quotecore.js's convention. volDay is the LIMITING side, the
 * basis quotecore and reachRelief both use.
 *
 * optSell/optBuy are PROXIES for the 2h band edges, taken as the extremes of the last `bandBuckets`
 * hourly rows and clamped the way computeQuote clamps them. The deployed pair reads a robust p90/p10
 * over 5m prints, which the 1h archive does not hold for its older half — the acceptance check
 * measures what that costs instead of leaving it assumed. */
export const BAND_PROXY_BUCKETS = 2;
export function liveAt(series, cut, { bandBuckets = BAND_PROXY_BUCKETS } = {}) {
  let quickSell = null, quickBuy = null;
  for (let i = cut - 1; i >= 0; i--) {
    if (quickSell == null && series[i].avgHighPrice != null) quickSell = series[i].avgHighPrice;
    if (quickBuy == null && series[i].avgLowPrice != null) quickBuy = series[i].avgLowPrice;
    if (quickSell != null && quickBuy != null) break;
  }
  let bandHi = null, bandLo = null;
  for (let i = cut - 1; i >= Math.max(0, cut - bandBuckets); i--) {
    const h = series[i].avgHighPrice, l = series[i].avgLowPrice;
    if (h != null && (bandHi == null || h > bandHi)) bandHi = h;
    if (l != null && (bandLo == null || l < bandLo)) bandLo = l;
  }
  const from = cut ? series[cut - 1].ts - 14 * 86400 : 0;
  let hi = 0, lo = 0, n = 0;
  for (let i = cut - 1; i >= 0 && series[i].ts >= from; i--) { hi += series[i].highPriceVolume || 0; lo += series[i].lowPriceVolume || 0; n++; }
  return {
    quickSell, quickBuy,
    optSell: quickSell == null ? null : (bandHi != null ? Math.max(quickSell, bandHi) : quickSell),
    optBuy: quickBuy == null ? null : (bandLo != null ? Math.min(quickBuy, bandLo) : quickBuy),
    volDay: n ? Math.min(hi, lo) / Math.max(1 / 24, n / 24) : null, limit: null,
  };
}

/* The reach-fold ask off a synthetic quote row — the same reconstruction read-exit-surface prints. */
export function foldAskAt({ stats, live }) {
  if (!live || live.quickBuy == null || live.quickSell == null) return null;
  if (!stats || !Array.isArray(stats.his) || !stats.his.length || !Array.isArray(stats.days) || !stats.days.length) return null;
  const row = {
    quickBuy: live.quickBuy, quickSell: live.quickSell,
    optBuy: live.optBuy ?? live.quickBuy, optSell: live.optSell ?? live.quickSell,
    volDay: live.volDay ?? null, limit: null,
  };
  const rc = recencySplit(stats.days, 'ask', row.optSell, RECENT_NIGHTS);
  const extra = { askReach: { reachedDays: reachedDays(stats.his, row.optSell), nDays: stats.his.length, recentHit: rc.recentHit, recentDays: rc.recentDays } };
  const est = estimatePair(FLIP_NICHES.band, row, extra, { sellModel: 'reach-fold' });
  return est && Number.isFinite(est.estSell) ? est.estSell : null;
}

/* Buckets a decision at `ts` may read. An archive bucket is stamped with the START of its hour, so the
 * bucket AT the origin covers the hour AFTER it and is future data. Reading it was a real one-hour
 * leak, and the suite was blind to it because its no-look-ahead fixture only perturbed rows strictly
 * past the origin. The bucket containing the origin now belongs to neither side: the read stops before
 * it and the outcome window starts after it.
 *
 * `ts` is FLOORED to the hour first. A wall-clock timestamp — which is what the co-log carries — is
 * essentially never hour-aligned, and without the floor the last admitted bucket straddles it and
 * hands back up to an hour of future. */
export function readableCut(series, ts) {
  const hour = Math.floor(ts / HOUR) * HOUR;
  let cut = 0;
  while (cut < series.length && series[cut].ts < hour) cut++;
  return cut;
}

/* Every non-surface contender's ask at one origin. PURE — the caller supplies the series and the cut. */
export function incumbentAsksAt({ series, cut, nights = DEFAULT_NIGHTS, depthQtyFrac = DEFAULT_DEPTH_QTY_FRAC, now }) {
  const statsSeries = series.slice(0, cut).map(r => ({ ...r, timestamp: r.ts }));
  const stats = windowStats(statsSeries, { nights, wStart: 0, wEnd: 0, now });
  const live = liveAt(series, cut);
  const asks = {};
  const rb = stats ? reachableBand(stats) : null;
  asks.pressure = rb && Number.isFinite(rb.ask) ? rb.ask : null;
  // The DEPLOYED asym ask is asymEstimate's ORDERING-GUARDED level, max(quickSell, quantile) — not the
  // raw quantile. The acceptance check found the difference: the raw form reconstructs 2% low against
  // the logged screen rows because the guard binds on most of them, which also makes this contender
  // equal to quickSell* whenever it binds. `guardBound` carries that so the report can say how often.
  const ap = stats ? asymPair(stats) : null;
  const rawAsym = ap && Number.isFinite(ap.highReachAsk) ? ap.highReachAsk : null;
  asks.asym = rawAsym == null ? null
    : (Number.isFinite(live.quickSell) ? Math.max(live.quickSell, rawAsym) : rawAsym);
  const guardBound = rawAsym != null && Number.isFinite(live.quickSell) && live.quickSell > rawAsym;
  asks.reachFold = foldAskAt({ stats, live });
  const qty = live.volDay > 0 ? Math.max(1, Math.round(live.volDay * depthQtyFrac)) : null;
  const ca = qty ? clearableAsk(statsSeries, { qty, nights, wStart: 0, wEnd: 0, now }) : null;
  asks.depth = ca && Number.isFinite(ca.price) ? ca.price : null;
  asks['quickSell*'] = live.quickSell;
  return { asks, stats, live, statsSeries, qty, rawAsym, guardBound };
}

/* One origin's record: every contender's ask plus the forward outcome per horizon. The surface is
 * built once and read at every (horizon, delayCost), so the sweep costs nothing extra. */
export function buildOriginRecord({ series, itemId, ts, horizons, delayCostFracs = [0], nights = DEFAULT_NIGHTS, depthQtyFrac = DEFAULT_DEPTH_QTY_FRAC, ladderZ = LADDER_Z_STEP }) {
  const cut = readableCut(series, ts);
  if (!cut) return null;
  const now = new Date(ts * 1000);
  const surface = buildReachSurface(series.slice(0, cut), { nights, now });
  if (!surface || !Number.isFinite(surface.refHigh) || !(surface.disp > 0)) return null;

  const { asks, stats, live, guardBound } = incumbentAsksAt({ series, cut, nights, depthQtyFrac, now });
  asks['refHigh*'] = surface.refHigh;
  const fc = stats && stats.days ? floorCeilingTrack(stats.days) : null;

  const byH = {};
  for (const H of horizons) {
    if (!covers(series, ts + H * HOUR)) continue;
    const top = maxHighWithin(series, ts, H);
    const bail = endLowWithin(series, ts, H);
    const bailHigh = endHighWithin(series, ts, H);
    if (top == null || bail == null) continue;
    const star = {}; let refused = null;
    for (const f of delayCostFracs) {
      const s = askStar(surface, H, { delayCost: f * surface.refHigh });
      if (f === delayCostFracs[0]) refused = s ? s.refused : 'no scorable cell at this horizon';
      star[f] = (s && !s.refused) ? s.ask : null;
    }
    const rec = { top, bail, bailHigh, star, starRefused: refused };
    if (covers(series, ts + 2 * H * HOUR)) {
      rec.top2 = maxHighWithin(series, ts + H * HOUR, H);
      rec.bail2 = endLowWithin(series, ts + H * HOUR, H);
      rec.bailHigh2 = endHighWithin(series, ts + H * HOUR, H);
    }
    byH[H] = rec;
  }
  if (!Object.keys(byH).length) return null;

  return {
    itemId, ts, refHigh: surface.refHigh, disp: surface.disp, ladderZ,
    volDay: live.volDay, liqClass: liqClassOf(live.volDay), asymGuardBound: !!guardBound,
    fcDir: fc ? fc.classification : 'unknown',
    asks, byH,
  };
}

/* Realized net for one ask at one origin, as a FRACTION of the reference price. `edgeFrac` strips the
 * bail branch, which is the same price for every contender here — the whole comparison lives in it. */
export function scoreAsk(rec, H, ask, delayCostFrac = 0, bailMode = 'low') {
  const o = rec.byH[H];
  if (!o || ask == null || !(ask > 0)) return null;
  const bailNet = netOf(bailMode === 'high' ? o.bailHigh : o.bail);
  if (bailNet == null) return null;
  const missNet = bailNet - delayCostFrac * rec.refHigh;
  const reached = o.top >= ask;
  const net = reached ? netOf(ask) : missNet;
  if (net == null) return null;
  return { reached, net, netFrac: net / rec.refHigh, edgeFrac: (net - missNet) / rec.refHigh };
}

/* The one-step ladder: on a miss, relist ladderZ dispersions lower for a second window of H. Sizes
 * Option E's headroom — a single-shot score is a FLOOR on a relist policy, never its ceiling. */
export function scoreLadder(rec, H, ask, delayCostFrac = 0, bailMode = 'low') {
  const o = rec.byH[H];
  if (!o || o.top2 == null || o.bail2 == null || ask == null || !(ask > 0)) return null;
  if (o.top >= ask) { const n = netOf(ask); return n == null ? null : { net: n, netFrac: n / rec.refHigh }; }
  const relist = ask - rec.ladderZ * rec.disp;
  const bail2Net = netOf(bailMode === 'high' ? o.bailHigh2 : o.bail2);
  if (bail2Net == null) return null;
  const hit = relist > 0 && o.top2 >= relist ? netOf(relist) : null;
  const net = (hit ?? bail2Net) - 2 * delayCostFrac * rec.refHigh;
  return { net, netFrac: net / rec.refHigh, relist, reached2: hit != null };
}

/* One contender's ask at one origin and horizon. The ONE place a key becomes a price. */
export function askOf(rec, H, key, delayCostFrac = 0) {
  const o = rec.byH[H];
  if (!o) return null;
  if (key === 'askStar') return o.star[delayCostFrac] ?? null;
  if (key === 'askStar+fold') return o.star[delayCostFrac] ?? rec.asks.reachFold ?? null;
  return rec.asks[key] ?? null;
}

/* The MATCHED pool: the origins where EVERY named contender produced an ask. Anything wider compares
 * different row sets and cannot rank. */
export function matchedRows(records, H, keys, delayCostFrac = 0, bailMode = 'low') {
  const rows = [];
  for (const rec of records) {
    if (!rec.byH[H]) continue;
    const per = {}; let ok = true;
    for (const k of keys) {
      const ask = askOf(rec, H, k, delayCostFrac);
      const sc = scoreAsk(rec, H, ask, delayCostFrac, bailMode);
      if (!sc) { ok = false; break; }
      per[k] = { ask, z: (ask - rec.refHigh) / rec.disp, ...sc };
    }
    if (ok) rows.push({ rec, per });
  }
  return rows;
}

/* Does a REFERENCE LINE outscore every estimator. Its own function because it is the finding the
 * report must be able to state, not a field of the winner. */
export const topIsBaseline = stats => !!(stats && stats[0] && BASELINE_KEYS.includes(stats[0].key));

export function summarize(rows, keys) {
  return keys.map(k => {
    const xs = rows.map(r => r.per[k]);
    return {
      key: k, n: xs.length,
      reachRate: xs.length ? xs.filter(x => x.reached).length / xs.length : null,
      meanEdge: mean(xs.map(x => x.edgeFrac)),
      medEdge: median(xs.map(x => x.edgeFrac)),
      meanNet: mean(xs.map(x => x.netFrac)),
      medZ: median(xs.map(x => x.z)),
    };
  }).sort((a, b) => (b.meanEdge ?? -Infinity) - (a.meanEdge ?? -Infinity));
}

/* The delayCost at which each contender overtakes the leader, SOLVED. On a miss `edgeFrac` is exactly
 * zero, so for any contender whose ask does not move with the cost, mean edge is
 * `edge(0) + delayCostFrac x reachRate` — an identity, verified to 1e-12 against the sweep. The sweep
 * therefore carries no information the reach column does not already have, and a sweep that stops
 * short of the crossing reports "no crossover" when there is one. `askStar`/`askStar+fold` are the
 * exception (their ask is re-derived at every cost) and are excluded here, not solved. */
export function crossoverClosed(h2h) {
  const lead = h2h.stats[0];
  if (!lead) return null;
  const out = [];
  for (const c of h2h.stats.slice(1)) {
    if (ARM_KEYS.includes(c.key) || ARM_KEYS.includes(lead.key)) continue;
    const dr = c.reachRate - lead.reachRate;
    if (!(dr > 0)) continue;
    const at = (lead.meanEdge - c.meanEdge) / dr;
    if (at > 0) out.push({ key: c.key, at });
  }
  out.sort((a, b) => a.at - b.at);
  return { lead: lead.key, first: out[0] || null, all: out };
}

/* Item-CLUSTER bootstrap on the PAIRED per-origin difference in edge. Paired because both contenders
 * saw the same window; clustered because an item's origins share one price path. */
export function pairedClusterCI(rows, keyA, keyB, { iters = BOOTSTRAP_ITERS, seed = BOOTSTRAP_SEED } = {}) {
  const byItem = new Map();
  let allSum = 0, allN = 0;
  for (const r of rows) {
    const a = r.per[keyA], b = r.per[keyB];
    if (!a || !b) continue;
    const d = a.edgeFrac - b.edgeFrac;
    const cur = byItem.get(r.rec.itemId) || { sum: 0, n: 0 };
    cur.sum += d; cur.n++;
    byItem.set(r.rec.itemId, cur);
    allSum += d; allN++;
  }
  const items = [...byItem.values()];
  if (items.length < 4) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0, n = 0;
    for (let k = 0; k < items.length; k++) { const g = items[Math.floor(rnd() * items.length)]; sum += g.sum; n += g.n; }
    if (n) out.push(sum / n);
  }
  if (out.length < iters / 4) return null;
  out.sort((a, b) => a - b);
  return { point: allSum / allN, lo: out[Math.floor(out.length * 0.025)], hi: out[Math.floor(out.length * 0.975)], items: items.length };
}

/* Origins thinned to non-overlapping outcome windows, per item. */
export function thinIndependent(records, H) {
  const byItem = new Map();
  for (const r of records) { if (!byItem.has(r.itemId)) byItem.set(r.itemId, []); byItem.get(r.itemId).push(r); }
  const out = [];
  for (const rs of byItem.values()) {
    let last = -Infinity;
    for (const r of rs.sort((a, b) => a.ts - b.ts)) if (r.ts >= last + H * HOUR) { out.push(r); last = r.ts; }
  }
  return out;
}

/* ── The acceptance check ─────────────────────────────────────────────────────────────────────────
 * How far the RECOMPUTED contender sits from the ask that estimator actually logged, over the
 * overlapping (itemId, ts) rows. This is the only bound on the reconstruction swap, and it covers the
 * incumbents only — askStar was never deployed, so it has no logged counterpart to diverge from. */
export const ACCEPTANCE_FIELDS = Object.freeze({
  pressure: s => (s.reachable && Number.isFinite(s.reachable.ask) ? s.reachable.ask : null),
  asym: s => (s.asym && Number.isFinite(s.asym.ask) ? s.asym.ask : null),
  reachFold: s => {
    const r = s.estConfidence ? s.estConfidence.reachRelief : null;
    return (r == null || r === 0) && Number.isFinite(s.estSell) ? s.estSell : null;
  },
  depth: s => (s.depthExit && Number.isFinite(s.depthExit.ask) ? s.depthExit.ask : null),
  'quickSell*': s => (Number.isFinite(s.quickSell) ? s.quickSell : null),
});

export function acceptanceRow({ series, s, nights, depthQtyFrac }) {
  const cut = readableCut(series, s.ts);
  if (!cut) return null;
  const now = new Date(s.ts * 1000);
  const qtyFrac = (s.depthExit && s.depthExit.qty > 0) ? null : depthQtyFrac;
  const { asks, stats, live, statsSeries } = incumbentAsksAt({ series, cut, nights, depthQtyFrac: qtyFrac ?? depthQtyFrac, now });
  if (s.depthExit && s.depthExit.qty > 0) {
    const ca = clearableAsk(statsSeries, { qty: s.depthExit.qty, competition: s.depthExit.competition, nights, wStart: 0, wEnd: 0, now });
    asks.depth = ca && Number.isFinite(ca.price) ? ca.price : null;
  }
  if (!stats || !live) return null;
  const out = {};
  for (const [key, read] of Object.entries(ACCEPTANCE_FIELDS)) {
    const logged = read(s);
    const recomputed = asks[key];
    if (logged == null || recomputed == null || !(logged > 0)) continue;
    out[key] = { logged, recomputed, relDiff: (recomputed - logged) / logged };
  }
  return Object.keys(out).length ? out : null;
}

/* Contenders whose reconstruction the acceptance check cannot bound. A ROW FLOOR, not n>0: one
 * matched row is not a bound, and `n > 0` once let a single-row contender out of the block. */
export const unboundedKeys = acceptance => new Set((acceptance || []).filter(x => x.n < ACCEPTANCE_MIN_ROWS).map(x => x.key));

export function acceptanceSummary(rows) {
  const keys = Object.keys(ACCEPTANCE_FIELDS);
  return keys.map(k => {
    const xs = rows.map(r => r[k]).filter(Boolean);
    if (!xs.length) return { key: k, n: 0 };
    const abs = xs.map(x => Math.abs(x.relDiff));
    return {
      key: k, n: xs.length,
      medRel: median(xs.map(x => x.relDiff)),
      medAbs: median(abs),
      p90Abs: abs.sort((a, b) => a - b)[Math.min(abs.length - 1, Math.floor(abs.length * 0.9))],
      exactFrac: xs.filter(x => x.relDiff === 0).length / xs.length,
      within1pct: abs.filter(v => v <= 0.01).length / xs.length,
    };
  });
}

/* ── Report assembly (pure) ───────────────────────────────────────────────────────────────────── */

export const CELL_OF = rec => `${rec.liqClass} × ${rec.fcDir}`;

/* The head-to-head at one spec. `best` is the highest mean edge among the non-baseline contenders;
 * every other contender is reported as a DEFICIT against it with a paired cluster interval. */
export function headToHead(records, H, delayCostFrac = 0, keys = ESTIMATOR_POOL_KEYS, bailMode = 'low', { withDeficits = false } = {}) {
  const rows = matchedRows(records, H, keys, delayCostFrac, bailMode);
  if (!rows.length) return { H, delayCostFrac, bailMode, keys, n: 0, items: 0, rows: [], stats: [], best: null, topOverall: null, baselineWins: false, deficits: [] };
  const stats = summarize(rows, keys);
  const candidates = stats.filter(s => !CONTENDERS.find(c => c.key === s.key).baseline);
  const best = candidates.length ? candidates[0].key : null;
  const deficits = withDeficits ? keys.filter(k => k !== best).map(k => ({ key: k, ci: pairedClusterCI(rows, k, best) })) : [];
  return {
    H, delayCostFrac, bailMode, keys, n: rows.length, items: new Set(rows.map(r => r.rec.itemId)).size, rows, stats, best,
    // `best` is the best ESTIMATOR; a reference line outscoring all of them is the finding, not a footnote.
    topOverall: stats[0] ? stats[0].key : null,
    baselineWins: topIsBaseline(stats),
    deficits,
  };
}

/* The pre-registered verdict, computed rather than argued. */
const bestOf = (h2h, allowed) => {
  const s = h2h.stats.filter(x => allowed.includes(x.key));
  return s.length ? s[0].key : null;
};

/* One arm of the criterion: does `key` beat the best incumbent, with the same sign across horizons
 * and no era flip. Run for both bare askStar and the deployable askStar+fold. */
export function armVerdict(key, decisive, sensitivities, eraHalves) {
  const bestIncumbent = bestOf(decisive, INCUMBENT_KEYS);
  const ci = bestIncumbent ? pairedClusterCI(decisive.rows, key, bestIncumbent) : null;
  const clearOfZero = !!ci && (ci.lo > 0 || ci.hi < 0);
  const sign = ci ? Math.sign(ci.point) : 0;
  const signOf = h => {
    const inc = bestOf(h, INCUMBENT_KEYS);
    if (!inc) return 0;
    const c = pairedClusterCI(h.rows, key, inc);
    return c ? Math.sign(c.point) : 0;
  };
  const agreeing = sensitivities.filter(s => sign !== 0 && signOf(s) === sign).length;
  const eraSigns = eraHalves.map(signOf);
  const eraFlip = eraSigns.length === 2 && eraSigns[0] !== 0 && eraSigns[1] !== 0 && eraSigns[0] !== eraSigns[1];
  const mine = decisive.stats.find(x => x.key === key);
  const beatsBaselines = !!mine && BASELINE_KEYS.every(b => {
    const ref = decisive.stats.find(x => x.key === b);
    return !ref || mine.meanEdge >= ref.meanEdge;
  });
  return { key, bestIncumbent, ci, clearOfZero, sign, agreeing, eraSigns, eraFlip, beatsBaselines,
    beats: clearOfZero && sign > 0 && agreeing >= 2 && !eraFlip };
}

/* The pre-registered RETIREMENT criterion, applied to every contender rather than argued per estimator:
 * a deficit against the best contender whose cluster CI clears zero at the decisive spec AND whose sign
 * repeats in at least 2 of the 3 sensitivity horizons. Reference lines are excluded (they are rulers, not
 * estimators), and so is any contender whose reconstruction the acceptance check could not bound — an
 * unbounded reconstruction cannot retire a deployed estimator, whatever its deficit looks like. This
 * NOMINATES; chunk 8 executes, and a nomination is not a retirement. */
export function retirementTable(decisive, sensitivities, eraHalves, unbounded = new Set(), { invalidated = false, resolutionFloor = null } = {}) {
  const best = decisive.best;
  return decisive.stats
    .filter(x => x.key !== best && !BASELINE_KEYS.includes(x.key) && !ARM_KEYS.includes(x.key))
    .map(x => {
      const ci = pairedClusterCI(decisive.rows, x.key, best);
      const clear = !!ci && (ci.lo > 0 || ci.hi < 0);
      const sign = ci ? Math.sign(ci.point) : 0;
      const horizonSigns = sensitivities.map(h => {
        const a = h.stats.find(y => y.key === x.key), b = h.stats.find(y => y.key === h.best);
        return (a && b) ? Math.sign(a.meanEdge - b.meanEdge) : 0;
      });
      const eraSigns = eraHalves.map(h => {
        const a = h.stats.find(y => y.key === x.key), b = h.stats.find(y => y.key === h.best);
        return (a && b) ? Math.sign(a.meanEdge - b.meanEdge) : 0;
      });
      const agreeing = horizonSigns.filter(v => v === sign && v !== 0).length;
      // A deficit under the reconstruction's own resolution is not a measurement. Nothing may be
      // retired on a gap smaller than the noise in the instrument that measured it.
      const underFloor = !!ci && resolutionFloor != null && Math.abs(ci.point) < resolutionFloor;
      const blockedBy = invalidated ? 'the run VERDICT is INVALIDATED — no retirement is licensed off it'
        : unbounded.has(x.key) ? 'reconstruction UNBOUNDED — too few overlapping rows to bound it'
        : underFloor ? 'the deficit is SMALLER than the reconstruction resolution floor — not a measurement'
        : (eraSigns[0] && eraSigns[1] && eraSigns[0] !== eraSigns[1]) ? 'the sign flips between era halves'
        : null;
      return { key: x.key, best, ci, clear, sign, horizonSigns, eraSigns, agreeing, underFloor, blockedBy,
        nominated: !blockedBy && clear && sign < 0 && agreeing >= 2 };
    });
}

/* The pre-registered branch, computed rather than argued. The estimator arm is what the plan
 * pre-registered; the deployable arm is what chunk 5 would actually ship, and BOTH must clear before
 * a default swap is licensed — a stricter bar than the plan set, never a looser one. */
export function verdict(estimatorArm, deployableArm) {
  const anyFlip = estimatorArm.eraFlip || deployableArm.eraFlip;
  const both = estimatorArm.beats && deployableArm.beats;
  const branch = anyFlip
    ? 'INVALIDATED — the sign flips between era halves; the pooled headline is void and no retirement is licensed'
    : both
      ? 'askStar BEATS the best incumbent on both arms — the chunk-5 default swap is licensed'
      : 'NULL BRANCH — the surface ships as a DESCRIPTION layer, the chunk-5 default swap is CANCELLED, and the plan headline claim is downgraded';
  return { estimatorArm, deployableArm, anyFlip, beats: both, branch };
}

// --- CLI (guarded) --------------------------------------------------------------------------------

function eligibleItems(db, minRows, want) {
  const rows = db.db.prepare(
    "SELECT itemId, COUNT(*) n FROM observations WHERE grain='1h' GROUP BY itemId HAVING n >= ? ORDER BY itemId ASC").all(minRows);
  if (rows.length <= want) return rows.map(r => r.itemId);
  const step = rows.length / want;
  return Array.from({ length: want }, (_, i) => rows[Math.floor(i * step)].itemId);
}

function statsTable(h2h, unbounded = new Set()) {
  const L = ['| contender | n | median z | reach at ' + h2h.H + 'h | mean edge | median edge | mean net |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const s of h2h.stats) {
    const tag = (s.key === h2h.topOverall ? ' <-top' : '') + (unbounded.has(s.key) ? ' †' : '');
    L.push(`| ${s.key}${tag} | ${s.n} | ${s.medZ == null ? '—' : s.medZ.toFixed(2)} | ${rate(s.reachRate)} | ${pctf(s.meanEdge, 3)} | ${pctf(s.medEdge, 3)} | ${pctf(s.meanNet, 2)} |`);
  }
  if ([...unbounded].some(k => h2h.stats.some(x => x.key === k))) {
    L.push('  † the acceptance check scored fewer than ' + ACCEPTANCE_MIN_ROWS + ' overlapping rows for this contender, so its');
    L.push('    reconstruction is UNBOUNDED — its position here is not evidence about the deployed estimator.');
  }
  return L;
}

function deficitLines(h2h) {
  const L = [`  deficit vs ${h2h.best} (paired, item-cluster bootstrap 95% CI):`];
  for (const d of h2h.deficits) {
    if (!d.ci) { L.push(`    ${d.key}: too few items for an interval`); continue; }
    const clear = d.ci.lo > 0 || d.ci.hi < 0;
    L.push(`    ${d.key}: ${pctf(d.ci.point, 3)} [${pctf(d.ci.lo, 3)}, ${pctf(d.ci.hi, 3)}] over ${d.ci.items} item(s)${clear ? ' — clear of zero' : ' — STRADDLES ZERO'}`);
  }
  return L;
}

function acceptanceTable(sum, n) {
  const L = ['| estimator | rows | median delta | median abs | p90 abs | exact | within 1% |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const s of sum) {
    if (!s.n) { L.push(`| ${s.key} | 0 | — | — | — | — | — |`); continue; }
    L.push(`| ${s.key} | ${s.n} | ${pctf(s.medRel, 2)} | ${(s.medAbs * 100).toFixed(2)}% | ${(s.p90Abs * 100).toFixed(2)}% | ${rate(s.exactFrac)} | ${rate(s.within1pct)} |`);
  }
  L.push(`  ${n} co-logged row(s) sampled. delta = (recomputed − logged) / logged.`);
  return L;
}

const edgeLine = h => h.stats.map(e => `${e.key} ${pctf(e.meanEdge, 3)}`).join(' · ');

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const nItems = a.items != null ? Number(a.items) : DEFAULT_ITEMS;
  const strideH = a.stride != null ? Number(a.stride) : DEFAULT_ORIGIN_STRIDE_H;
  const decisiveH = a.horizon != null ? Number(a.horizon) : DECISIVE_H;
  const minRows = a['min-rows'] != null ? Number(a['min-rows']) : DEFAULT_MIN_ROWS;
  const warmupDays = a['warmup-days'] != null ? Number(a['warmup-days']) : DEFAULT_WARMUP_DAYS;
  const depthQtyFrac = a['depth-qty-frac'] != null ? Number(a['depth-qty-frac']) : DEFAULT_DEPTH_QTY_FRAC;
  const acceptanceN = a['acceptance-n'] != null ? Number(a['acceptance-n']) : 1200;
  const dcFracs = a['delay-cost-frac'] != null ? [Number(a['delay-cost-frac'])] : DELAY_COST_SWEEP;
  const asJson = !!a.json;
  const horizons = [...new Set([decisiveH, ...SENSITIVITY_H])].sort((x, y) => x - y);

  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const ids = eligibleItems(db, minRows, nItems);
  const seriesOf = new Map();
  const getSeries = id => {
    if (!seriesOf.has(id)) seriesOf.set(id, db.seriesFor(id, '1h', {}));
    return seriesOf.get(id);
  };

  const idSet = new Set(ids);
  const logged = [];
  for (const line of readSuggestionLines()) {
    if (!line.trim()) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (s.itemId == null || s.ts == null || !idSet.has(s.itemId)) continue;
    logged.push(s);
  }
  const accSample = logged.length <= acceptanceN ? logged
    : Array.from({ length: acceptanceN }, (_, i) => logged[Math.floor(i * (logged.length / acceptanceN))]);
  const accRows = [];
  for (const s of accSample) {
    const r = acceptanceRow({ series: getSeries(s.itemId), s, nights: DEFAULT_NIGHTS, depthQtyFrac });
    if (r) accRows.push(r);
  }
  const acceptance = acceptanceSummary(accRows);
  const guardRate = records => (records.length ? records.filter(r => r.asymGuardBound).length / records.length : null);
  const resolutionFloor = (acceptance.find(x => x.key === 'quickSell*') || {}).medAbs ?? null;
  const unbounded = unboundedKeys(acceptance);

  const records = [];
  const funnel = { items: ids.length, itemsWithRecords: 0, originsTried: 0, originsKept: 0 };
  for (const id of ids) {
    const series = getSeries(id);
    if (!series.length) continue;
    const from = series[0].ts + warmupDays * 86400;
    const to = series[series.length - 1].ts;
    let kept = 0;
    for (let ts = from; ts <= to; ts += strideH * HOUR) {
      funnel.originsTried++;
      const rec = buildOriginRecord({ series, itemId: id, ts, horizons, delayCostFracs: dcFracs, nights: DEFAULT_NIGHTS, depthQtyFrac });
      if (rec) { records.push(rec); kept++; }
    }
    funnel.originsKept += kept;
    if (kept) funnel.itemsWithRecords++;
    seriesOf.delete(id);
  }
  try { db.db.close(); } catch {}

  if (!records.length) { console.log('no scorable origins — the archive holds too little history for this pool.'); return; }

  const dc0 = dcFracs[0];
  const bailMode = a.bail === 'high' ? 'high' : 'low';
  const h2h = (recs, H, f, keys, bm = bailMode, opts) => headToHead(recs, H, f, keys, bm, opts);
  const decisive = h2h(records, decisiveH, dc0, ESTIMATOR_POOL_KEYS, bailMode, { withDeficits: true });
  const deployable = h2h(records, decisiveH, dc0, DEPLOYABLE_POOL_KEYS, bailMode, { withDeficits: true });
  const sensE = SENSITIVITY_H.filter(x => x !== decisiveH).map(H => h2h(records, H, dc0, ESTIMATOR_POOL_KEYS));
  const sensD = SENSITIVITY_H.filter(x => x !== decisiveH).map(H => h2h(records, H, dc0, DEPLOYABLE_POOL_KEYS));
  const mid = median(records.map(r => r.ts));
  const halves = [records.filter(r => r.ts <= mid), records.filter(r => r.ts > mid)];
  const eraE = halves.map(rs => h2h(rs, decisiveH, dc0, ESTIMATOR_POOL_KEYS));
  const eraD = halves.map(rs => h2h(rs, decisiveH, dc0, DEPLOYABLE_POOL_KEYS));
  const thinned = h2h(thinIndependent(records, decisiveH), decisiveH, dc0, DEPLOYABLE_POOL_KEYS);
  const v = verdict(armVerdict('askStar', decisive, sensE, eraE), armVerdict('askStar+fold', deployable, sensD, eraD));
  const retirement = retirementTable(deployable, sensD, eraD, unbounded, { invalidated: v.anyFlip, resolutionFloor });
  const crossover = crossoverClosed(deployable);

  const refusedRecs = records.filter(r => r.byH[decisiveH] && r.byH[decisiveH].star[dc0] == null);
  const refusedSet = new Set(refusedRecs);
  const noStar = ESTIMATOR_POOL_KEYS.filter(k => k !== 'askStar');
  const refusedH2H = refusedRecs.length ? h2h(refusedRecs, decisiveH, dc0, noStar) : null;
  const pricedH2H = refusedRecs.length ? h2h(records.filter(r => !refusedSet.has(r)), decisiveH, dc0, noStar) : null;
  const refusalReasons = {};
  for (const r of refusedRecs) {
    const k = (r.byH[decisiveH].starRefused || 'unknown').split(':')[0];
    refusalReasons[k] = (refusalReasons[k] || 0) + 1;
  }

  // The sweep runs on the DEPLOYABLE pool, whose membership does not move with delayCost: bare askStar
  // refuses different origins at different costs, so a sweep over its pool compares different markets.
  const sweep = dcFracs.map(f => {
    const h = h2h(records, decisiveH, f, DEPLOYABLE_POOL_KEYS);
    return { f, best: h.best, topOverall: h.topOverall, n: h.n, stats: h.stats };
  });
  const flip = sweep.find(s => s.topOverall !== sweep[0].topOverall);
  const byBail = BAIL_MODES.map(bm => h2h(records, decisiveH, dc0, DEPLOYABLE_POOL_KEYS, bm));

  const ladder = DEPLOYABLE_POOL_KEYS.map(k => {
    const xs = [];
    for (const r of deployable.rows) {
      const sc = scoreLadder(r.rec, decisiveH, askOf(r.rec, decisiveH, k, dc0), dc0, bailMode);
      if (sc) xs.push({ single: r.per[k].netFrac, ladder: sc.netFrac });
    }
    return { key: k, n: xs.length, singleNet: mean(xs.map(x => x.single)), ladderNet: mean(xs.map(x => x.ladder)),
      lift: xs.length ? mean(xs.map(x => x.ladder - x.single)) : null };
  });

  const byCell = new Map();
  for (const r of deployable.rows) { const c = CELL_OF(r.rec); if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(r); }
  const cells = [...byCell.entries()].map(([key, rs]) => ({
    key, n: rs.length, items: new Set(rs.map(r => r.rec.itemId)).size, stats: summarize(rs, DEPLOYABLE_POOL_KEYS),
  })).sort((x, y) => y.n - x.n);

  if (asJson) {
    const strip = h => ({ H: h.H, delayCostFrac: h.delayCostFrac, keys: h.keys, n: h.n, items: h.items, best: h.best,
      topOverall: h.topOverall, baselineWins: h.baselineWins, stats: h.stats,
      deficits: (h.deficits || []).map(d => ({ key: d.key, ci: d.ci })) });
    console.log(JSON.stringify({
      app: 'the-coffer-exit-ev-backtest', version: 1,
      params: { nItems, strideH, decisiveH, minRows, warmupDays, depthQtyFrac, dcFracs, bailMode, nights: DEFAULT_NIGHTS },
      funnel, acceptance, acceptanceRows: accRows.length, resolutionFloor, unbounded: [...unbounded], asymGuardRate: guardRate(records),
      decisive: strip(decisive), deployable: strip(deployable),
      sensitivities: { estimator: sensE.map(strip), deployable: sensD.map(strip) },
      eraHalves: { estimator: eraE.map(strip), deployable: eraD.map(strip) },
      thinned: strip(thinned),
      refused: { n: refusedRecs.length, reasons: refusalReasons, h2h: refusedH2H ? strip(refusedH2H) : null, priced: pricedH2H ? strip(pricedH2H) : null },
      sweep, flipAt: flip ? flip.f : null, crossover, byBail: byBail.map(strip), ladder, cells, verdict: v, retirement,
      caveat: 'reached != filled; recomputed reconstructions, not the deployed estimators; one 92-day era',
    }, null, 2));
    return;
  }

  console.log(`\n── join-exit-ev — realized net of "list at ask for H, else bail" over the 1h archive ──`);
  console.log(`pool ${funnel.itemsWithRecords}/${funnel.items} item(s) with at least ${minRows} 1h rows · ${funnel.originsKept}/${funnel.originsTried} origins kept · every ${strideH}h from day ${warmupDays}`);
  console.log(`depth is sized by a CONVENTION invented here (a fixed fraction of daily flow); the deployed reads size against a held lot.`);
  console.log(`decisive H=${decisiveH}h · delayCost ${dc0 * 100}% of reference · depth sized at ${depthQtyFrac * 100}% of daily flow · reference = median of the last 3 daily highs`);
  console.log(`bail on a miss: the last avg${bailMode === "high" ? "High" : "Low"} print in the window (--bail low|high)`);

  console.log(`\n## ACCEPTANCE — how far each RECOMPUTED contender sits from the ask it actually logged`);
  console.log(`Read this before any head-to-head number below. askStar was never deployed, so it has NO row here.`);
  acceptanceTable(acceptance, accRows.length).forEach(l => console.log(l));
  console.log(`  asym ordering guard bound on ${rate(guardRate(records))} of origins — where it binds, the asym contender IS quickSell*.`);
  console.log(`  reachFold's row is CONDITIONED: it scores only logged rows where the reach relief did not fire, and`);
  console.log(`  the reconstruction passes no buy limit, so the relief cannot fire in it either. That bounds the half`);
  console.log(`  of the population where the two agree by construction, not the half where they could diverge.`);
  if (resolutionFloor != null) {
    console.log(`  RESOLUTION FLOOR: even quickSell*, which is one archive field, reconstructs ${(resolutionFloor * 100).toFixed(2)}% off its logged`);
    console.log(`  value (hourly average vs a live print). Read no head-to-head gap narrower than that as real.`);
  }

  console.log(`\n## DECISIVE (estimator arm) — H=${decisiveH}h, the ${decisive.n} origin(s) over ${decisive.items} item(s) that askStar consented to price`);
  statsTable(decisive, unbounded).forEach(l => console.log(l));
  console.log(`  edge = realized net minus the bail branch, as a fraction of the reference price. The bail is the`);
  console.log(`  same price for every contender at an origin, so the ranking lives entirely in this column.`);
  if (decisive.baselineWins) console.log(`  NOTE: ${decisive.topOverall} is a REFERENCE LINE and it outscores every estimator here.`);
  deficitLines(decisive).forEach(l => console.log(l));

  console.log(`\n## DEPLOYABLE arm — askStar+fold over ALL ${deployable.n} origin(s) / ${deployable.items} item(s) (surface where it prices, reach-fold where it refuses)`);
  statsTable(deployable, unbounded).forEach(l => console.log(l));
  if (deployable.baselineWins) console.log(`  NOTE: ${deployable.topOverall} is a REFERENCE LINE and it outscores every estimator here.`);
  deficitLines(deployable).forEach(l => console.log(l));

  console.log(`\n## PER CELL (liqClass x fcTrack classification), deployable arm — a retirement needs a cell at n>=${MIN_CELL_N}`);
  for (const c of cells) {
    if (c.n < MIN_CELL_N) continue;
    console.log(`  ${c.key.padEnd(26)} n=${String(c.n).padStart(5)} items=${String(c.items).padStart(3)}${topIsBaseline(c.stats) ? ' *' : '  '} ` + c.stats.map(s => `${s.key} ${pctf(s.meanEdge, 3)}`).join(' · '));
  }
  const small = cells.filter(c => c.n < MIN_CELL_N);
  if (small.length) console.log(`  ${small.length} cell(s) under n=${MIN_CELL_N}, not shown: ${small.map(c => `${c.key} (${c.n})`).join(' · ')}`);
  const baseCells = cells.filter(c => c.n >= MIN_CELL_N && topIsBaseline(c.stats));
  if (baseCells.length) console.log(`  * a REFERENCE LINE outscores every estimator in ${baseCells.length} of these cells (${baseCells.reduce((a, c) => a + c.n, 0)} origins) — a ruler beating the instruments is a finding, not a footnote.`);
  console.log(`  n counts ORIGINS; independence comes from the item count beside it. A cell deep in origins and`);
  console.log(`  shallow in items is one price path measured many times, not a sample.`);

  console.log(`\n## SENSITIVITY — the same matched comparison at other horizons`);
  console.log(`  estimator arm — consent is the share of origins askStar agreed to price at that horizon:`);
  const consentAt = H => { const d = [deployable, ...sensD].find(x => x.H === H); return d && d.n ? ([decisive, ...sensE].find(x => x.H === H).n / d.n) : null; };
  for (const s of [decisive, ...sensE].sort((x, y) => x.H - y.H)) console.log(`    H=${String(s.H).padStart(3)}h n=${String(s.n).padStart(5)} consent=${rate(consentAt(s.H))} top=${s.topOverall}  ${edgeLine(s)}`);
  console.log(`  deployable arm:`);
  for (const s of [deployable, ...sensD].sort((x, y) => x.H - y.H)) console.log(`    H=${String(s.H).padStart(3)}h n=${String(s.n).padStart(5)} top=${s.topOverall}  ${edgeLine(s)}`);

  console.log(`\n## ERA HALVES — a sign flip here voids the pooled headline`);
  eraE.forEach((h, i) => console.log(`  estimator  half ${i + 1}: n=${h.n} top=${h.topOverall}  ${edgeLine(h)}`));
  eraD.forEach((h, i) => console.log(`  deployable half ${i + 1}: n=${h.n} top=${h.topOverall}  ${edgeLine(h)}`));

  console.log(`\n## INDEPENDENT WINDOWS — origins thinned to non-overlapping ${decisiveH}h outcomes, deployable arm`);
  console.log(`  n=${thinned.n} over ${thinned.items} item(s) top=${thinned.topOverall}  ${edgeLine(thinned)}`);

  console.log(`\n## delayCost SWEEP — the cost of waiting at which the winner changes (the rStar idiom)`);
  for (const s of sweep) console.log(`  ${String((s.f * 100).toFixed(1)).padStart(4)}% of ref  n=${String(s.n).padStart(5)}  top=${s.topOverall}  ` + s.stats.slice(0, 3).map(e => `${e.key} ${pctf(e.meanEdge, 3)}`).join(' · '));
  console.log(flip ? `  the swept winner changes from ${sweep[0].topOverall} to ${flip.topOverall} between the points above.`
    : `  ${sweep[0].topOverall} wins at every point SWEPT — which is not the same as no crossover; see below.`);
  if (crossover) {
    console.log(`  SOLVED, not swept: on a miss the edge is exactly zero, so a fixed-ask contender's mean edge is`);
    console.log(`  edge(0) + delayCostFrac x reachRate — an identity, which makes the sweep above almost redundant.`);
    console.log(crossover.first
      ? `  ⇒ ${crossover.first.key} overtakes ${crossover.lead} at delayCost ${(crossover.first.at * 100).toFixed(2)}% of the reference price.`
      : `  ⇒ no fixed-ask contender ever overtakes ${crossover.lead}: none of them reaches more often.`);
    console.log(`  ${ARM_KEYS.join('/')} are EXCLUDED from that solve — their ask is re-derived at every cost, so only the sweep speaks for them.`);
  }

  if (refusedH2H) {
    console.log(`\n## WHERE askStar REFUSED — ${refusedRecs.length} origin(s) it declined to price`);
    console.log(`  reasons: ${Object.entries(refusalReasons).map(([k, n]) => `${k} x${n}`).join(' · ')}`);
    console.log(`  refused n=${String(refusedH2H.n).padStart(5)}  ${edgeLine(refusedH2H)}`);
    if (pricedH2H) console.log(`  priced  n=${String(pricedH2H.n).padStart(5)}  ${edgeLine(pricedH2H)}`);
    console.log(`  The estimator arm is CONDITIONED on askStar pricing. These two lines say whether that`);
    console.log(`  condition selects an easier market; the deployable arm is the one that does not.`);
  }

  console.log(`\n## BAIL CONVENTION — what a never-reached ask is worth at H, and it moves the ranking`);
  for (const b of byBail) console.log(`  bail avg${b.bailMode === 'high' ? 'High (rest at the ask level)' : 'Low (cross into a standing bid)'} n=${b.n} top=${b.topOverall}  ${edgeLine(b)}`);
  console.log(`  Chunk 1 chose the avgLow bail. A bail shifts only the REACHED rows, so contenders that reach at`);
  console.log(`  different rates move apart under it — this is a real sensitivity, not a restatement.`);

  console.log(`\n## ONE-STEP LADDER — relist ${LADDER_Z_STEP}z lower for a second ${decisiveH}h window on a miss (Option E headroom)`);
  for (const l of ladder) console.log(`  ${l.key.padEnd(13)} n=${String(l.n).padStart(5)}  single ${pctf(l.singleNet, 2)} -> ladder ${pctf(l.ladderNet, 2)}  (lift ${pctf(l.lift, 3)})`);

  console.log(`\n## RETIREMENT NOMINATIONS — the pre-registered criterion applied, deployable arm`);
  for (const r of retirement) {
    const ciTxt = r.ci ? `${pctf(r.ci.point, 3)} [${pctf(r.ci.lo, 3)}, ${pctf(r.ci.hi, 3)}]` : 'no interval';
    console.log(`  ${r.key.padEnd(13)} vs ${r.best}: ${ciTxt} · clear ${r.clear} · same sign in ${r.agreeing}/${r.horizonSigns.length} horizon(s) · era ${JSON.stringify(r.eraSigns)}`);
    console.log(`                ${r.blockedBy ? 'BLOCKED — ' + r.blockedBy : (r.nominated ? 'NOMINATED for exit-pricing retirement (chunk 8 executes; the BID side survives)' : 'not nominated')}`);
  }

  console.log(`\n## VERDICT — against the criterion pre-registered in this file header`);
  for (const arm of [v.estimatorArm, v.deployableArm]) {
    console.log(`  ${arm.key} vs best incumbent (${arm.bestIncumbent}):`);
    const denom = arm.key === 'askStar' ? sensE.length : sensD.length;
    if (arm.ci) console.log(`    ${pctf(arm.ci.point, 3)} [${pctf(arm.ci.lo, 3)}, ${pctf(arm.ci.hi, 3)}] over ${arm.ci.items} item(s) · clear of zero ${arm.clearOfZero} · same sign in ${arm.agreeing}/${denom} sensitivity horizon(s) · era signs ${JSON.stringify(arm.eraSigns)}`);
    else console.log(`    no interval — too few items`);
    console.log(`    beats incumbents: ${arm.beats} · beats every reference line: ${arm.beatsBaselines}`);
  }
  console.log(`  ⇒ ${v.branch}`);

  console.log(`\n⚠ REACHED IS NOT FILLED — queue position is invisible in a bucketed aggregate, so every reach rate`);
  console.log(`  here bounds a real offer from ABOVE, and it flatters the HIGH asks most. Origins overlap unless`);
  console.log(`  thinned, and every origin of an item shares one price path, so the effective n is far below the`);
  console.log(`  row count; read the item counts, not the origin counts. One 92-day era, one update cycle. Every`);
  console.log(`  contender is a RECONSTRUCTION — the acceptance table above is the only bound on that swap.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
