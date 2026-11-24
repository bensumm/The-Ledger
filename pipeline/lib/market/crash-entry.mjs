/* crash-entry.mjs — PLAN-CRASH-REPLAY: per-item dump events, entry rules, fill/exit simulators and the
 * breadth/stability read over archive-shaped 1h series ({ts, avgHighPrice, avgLowPrice,
 * highPriceVolume, lowPriceVolume}, ts = bucket START, seconds). PURE.
 *
 * Every decision at hour t reads only buckets the imported `readableCut` admits (ts ≤ t − 3600).
 * Outcome windows are (t, t + H] — the bucket stamped t belongs to neither side. Every forward read is
 * also capped at `nowSec`, so an outcome the archive has not resolved yet is `pending`, never a miss.
 * Thresholds are the plan's pre-registered placeholders. */
import { readableCut, firstIndexAfter, endLowWithin, endHighWithin, HOUR } from '../../../js/forward-reach.mjs';
import { breakEven } from '../../../js/quotecore.js';
import { tax } from '../../../js/money-math.js';
import { floorCeilingTrack, hourProfile } from '../../../js/windowread.mjs';
import { dailyMidsFrom1h, trailingDeviation, bucketOf } from '../signal/dislocation.mjs';

const DAY = 86400;
export const ONSET_FRAC = 0.85;
export const ONSET_LOOKBACK_H = 72;
export const LIQ_DAYS = 7;
export const LIQ_MIN_GPD = 5_000_000;
export const CRASH_MIN_PRICE = 1_000_000;
export const BIG_PRICE = 10_000_000;
export const SMALL_PRICE = 10_000;
export const COOLDOWN_H = 14 * 24;
export const ARM_H = 7 * 24;
export const DELAY_H = 72;
export const DEEP_FRAC = 0.75;
export const DEEP_LOOKBACK_H = 14 * 24;
export const BOUNCE_FRAC = 1.02;
export const CLIMAX_MULT = 2;
export const CLIMAX_H = 6;
export const RB2_BUCKETS = ['deep4', 'deep7'];
export const STAGE_OFFSETS_H = [0, 24, 48];
export const H_FILL = 24;
export const H_EXIT = 7 * 24;
export const EXIT_MARGIN = 0.02;
export const TRANCHE_GP = { big: 20_000_000, '1-10m': 10_000_000 };
export const BLOCK_R_FIRST = '2026-10-19';
export const BLOCK_R_LAST = '2026-10-26';
export const BREADTH_LOW_DAYS = 20;
export const BREADTH_MIN_PRIOR = 14;
export const RET_DAYS = 3;
export const STABLE_BREADTH = 0.15;
export const STABLE_RET = -0.01;
export const STABLE_RUN = 3;
export const CRASH_CLASSES = ['big', '1-10m'];
export const CRASH_DIURNAL_NIGHTS = 14;
// Sensitivity only, not pre-registered: an onset must hold for this many buckets and trade this many units.
export const PERSIST_BUCKETS = 3;
export const PERSIST_MIN_UNITS = 5;
// Rules read at most this far back from their decision hour, so scoring on a sliced window is exact.
export const LOOKBACK_D = 22;

const dayStart = ts => Math.floor(ts / DAY) * DAY;
const lastSeen = nowSec => Math.floor(nowSec / HOUR) * HOUR - HOUR;
export const utcDay = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const midOf = b => (b && b.avgHighPrice != null && b.avgLowPrice != null ? (b.avgHighPrice + b.avgLowPrice) / 2 : null);
const turnoverOf = b => (b.avgHighPrice ?? 0) * (b.highPriceVolume ?? 0) + (b.avgLowPrice ?? 0) * (b.lowPriceVolume ?? 0);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function classOf(price) {
  if (!(price >= SMALL_PRICE)) return null;
  return price >= BIG_PRICE ? 'big' : price >= CRASH_MIN_PRICE ? '1-10m' : '10k-1m';
}

export function blockOf(day) {
  if (day < BLOCK_R_FIRST) return 'P';
  return day <= BLOCK_R_LAST ? 'R' : null;
}

/* Readable buckets at decision hour t with ts ≥ fromTs, as an index range [lo, hi). */
function span(series, t, fromTs = -Infinity) {
  const hi = readableCut(series, t);
  let lo = hi;
  while (lo > 0 && series[lo - 1].ts >= fromTs) lo--;
  return [lo, hi];
}

function lastReadable(series, t, field) {
  for (let i = readableCut(series, t) - 1; i >= 0; i--) if (series[i][field] != null) return series[i][field];
  return null;
}

/* Mean daily traded gp over the LIQ_DAYS completed UTC days before t's day. */
export function turnoverGpd(series, t) {
  const end = dayStart(t), [lo, hi] = span(series, t, end - LIQ_DAYS * DAY);
  let gp = 0;
  for (let i = lo; i < hi; i++) if (series[i].ts < end) gp += turnoverOf(series[i]);
  return gp / LIQ_DAYS;
}

/* Dump onsets readable at nowSec. t0 = the decision hour at which the onset bucket is first readable. */
export function detectEvents(series, nowSec, { minPrice = CRASH_MIN_PRICE, itemId = null } = {}) {
  const cut = readableCut(series, nowSec), out = [], dayGp = new Map();
  for (let i = 0; i < cut; i++) { const d = dayStart(series[i].ts); dayGp.set(d, (dayGp.get(d) ?? 0) + turnoverOf(series[i])); }
  const liquidAt = t0 => { let gp = 0; for (let k = 1; k <= LIQ_DAYS; k++) gp += dayGp.get(dayStart(t0) - k * DAY) ?? 0; return gp / LIQ_DAYS > LIQ_MIN_GPD; };
  let lastT0 = -Infinity, lo = 0;
  for (let i = 0; i < cut; i++) {
    const b = series[i], mid = midOf(b);
    if (mid == null || mid < minPrice) continue;
    const t0 = b.ts + HOUR;
    if (t0 < lastT0 + COOLDOWN_H * HOUR) continue;
    while (series[lo].ts < t0 - ONSET_LOOKBACK_H * HOUR) lo++;
    let max = null;
    for (let j = lo; j <= i; j++) { const m = midOf(series[j]); if (m != null && (max == null || m > max)) max = m; }
    if (!(mid <= ONSET_FRAC * max)) continue;
    if (!liquidAt(t0)) continue;
    const cluster = utcDay(b.ts);
    out.push({ itemId, onsetTs: b.ts, t0, onsetMid: mid, refMax: max, cls: classOf(mid), cluster, block: blockOf(cluster) });
    lastT0 = t0;
  }
  return out;
}

/* Entry rules: (series, ev, t) → entry hour, or null when the rule does not fire at t. */
function deepUnderMax(series, ev, t) {
  const [lo, hi] = span(series, t, t - DEEP_LOOKBACK_H * HOUR);
  if (hi === lo) return null;
  let max = null;
  for (let i = lo; i < hi; i++) { const m = midOf(series[i]); if (m != null && (max == null || m > max)) max = m; }
  const last = midOf(series[hi - 1]);
  return last != null && max != null && last <= DEEP_FRAC * max ? t : null;
}

function completedDays(series, t, nDays) {
  const end = dayStart(t), [lo, hi] = span(series, t, end - nDays * DAY), byDay = new Map();
  for (let i = lo; i < hi; i++) {
    const b = series[i];
    if (b.ts >= end) continue;
    const k = utcDay(b.ts), d = byDay.get(k) || { low: null, hi: null };
    if (b.avgLowPrice != null && (d.low == null || b.avgLowPrice < d.low)) d.low = b.avgLowPrice;
    if (b.avgHighPrice != null && (d.hi == null || b.avgHighPrice > d.hi)) d.hi = b.avgHighPrice;
    byDay.set(k, d);
  }
  return [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function floorSettled(series, ev, t) {
  const fc = floorCeilingTrack(completedDays(series, t, LOOKBACK_D - 2));
  return fc && (fc.floor.dir === 'flat' || fc.floor.dir === 'rising') && !fc.floorBreak.broke ? t : null;
}

function minLowIn(series, t, fromTs, toTs) {
  const [lo, hi] = span(series, t, fromTs);
  let min = null;
  for (let i = lo; i < hi; i++) {
    const v = series[i].avgLowPrice;
    if (series[i].ts <= toTs && v != null && (min == null || v < min)) min = v;
  }
  return min;
}

function minHolds(series, ev, t) {
  const recent = minLowIn(series, t, t - 24 * HOUR, t), prior = minLowIn(series, t, t - 48 * HOUR, t - 25 * HOUR);
  return recent != null && prior != null && recent >= prior ? t : null;
}

function bounce(series, ev, t) {
  const last = lastReadable(series, t, 'avgLowPrice'), min = minLowIn(series, t, t - 24 * HOUR, t);
  return last != null && min != null && last >= BOUNCE_FRAC * min ? t : null;
}

function hourlyVols(series, t, fromTs, toTs) {
  const [lo, hi] = span(series, t, fromTs), byTs = new Map();
  for (let i = lo; i < hi; i++) byTs.set(series[i].ts, series[i].lowPriceVolume ?? 0);
  const out = [];
  for (let s = fromTs; s < toTs; s += HOUR) out.push(byTs.get(s) ?? 0);
  return out;
}

function climax(series, ev, t) {
  const recentFrom = t - CLIMAX_H * HOUR;
  const recent = hourlyVols(series, t, recentFrom, t), base = median(hourlyVols(series, t, recentFrom - LIQ_DAYS * DAY, recentFrom));
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  return base != null && base > 0 && mean >= CLIMAX_MULT * base ? t + HOUR : null;
}

/* RB1 moved to the first hour from t0+72h in the item's hourProfile dip window, on UTC days and hours;
 * RB1 itself when no profile is readable. */
function diurnalDelay(series, ev, t) {
  if (t !== ev.t0 + DELAY_H * HOUR) return null;
  const [lo, hi] = span(series, t, t - CRASH_DIURNAL_NIGHTS * DAY), rows = [];
  for (let i = lo; i < hi; i++) rows.push({ timestamp: series[i].ts, avgHighPrice: series[i].avgHighPrice, avgLowPrice: series[i].avgLowPrice, highPriceVolume: series[i].highPriceVolume, lowPriceVolume: series[i].lowPriceVolume });
  const prof = hourProfile(rows, { nights: CRASH_DIURNAL_NIGHTS, now: new Date(t * 1000), utc: true });
  const dip = new Set(prof && prof.dip ? prof.dip.hours : []);
  if (!dip.size) return t;
  for (let e = t; e < t + DAY; e += HOUR) if (dip.has(new Date(e * 1000).getUTCHours())) return e;
  return t;
}

function incumbentDeep(series, ev, t) {
  const [lo, hi] = span(series, t, t - (LOOKBACK_D - 2) * DAY);
  const rows = [];
  for (let i = lo; i < hi; i++) rows.push({ timestamp: series[i].ts, avgHighPrice: series[i].avgHighPrice, avgLowPrice: series[i].avgLowPrice });
  const dev = trailingDeviation(dailyMidsFrom1h(rows, { utc: true }).days, t * 1000, { utc: true });
  return dev && RB2_BUCKETS.includes(bucketOf(dev.devPct)) ? dayStart(t) + DAY : null;
}

export const RULES = Object.freeze({
  RB0: (s, ev, t) => (t === ev.t0 ? t : null),
  RB1: (s, ev, t) => (t === ev.t0 + DELAY_H * HOUR ? t : null),
  'RB1-diurnal': diurnalDelay,
  // RB2's clock control: RB1 deferred to the next 00:00 UTC, the hour RB2 always enters at.
  'RB1-00UTC': (s, ev, t) => (t === ev.t0 + DELAY_H * HOUR ? Math.ceil(t / DAY) * DAY : null),
  RB2: incumbentDeep,
  R0: deepUnderMax,
  R2: floorSettled,
  R3: minHolds,
  R4: bounce,
  R5: climax,
});

/* The slice every rule and simulator needs for one event; exact because each reads at most LOOKBACK_D back. */
export function eventWindow(series, ev, { hFill = H_FILL, hExit = H_EXIT } = {}) {
  const from = ev.onsetTs - LOOKBACK_D * DAY, to = ev.t0 + (ARM_H + hFill + hExit + 1) * HOUR;
  return series.slice(firstIndexAfter(series, from - 1), firstIndexAfter(series, to));
}

/* First entry of a single-entry rule inside the arm window, as seen at nowSec. */
export function firstEntry(series, ev, key, nowSec) {
  const rule = RULES[key], end = ev.t0 + ARM_H * HOUR;
  for (let t = ev.t0; t < end; t += HOUR) {
    if (t > nowSec) return { status: 'armed' };
    const e = rule(series, ev, t);
    if (e != null) return e < end ? { status: 'fired', decidedAt: t, entry: e } : { status: 'expired' };
  }
  return { status: 'expired' };
}

/* Tranche entry states for any rule key: [{status: 'fired'|'armed'|'expired', entry?}]. */
export function entriesFor(series, ev, key, nowSec) {
  const at = entry => ({ status: 'fired', entry });
  if (key === 'ST-time') return STAGE_OFFSETS_H.map(h => at(ev.t0 + h * HOUR));
  if (key === 'ST-trigger') return [at(ev.t0), firstEntry(series, ev, 'R4', nowSec), firstEntry(series, ev, 'R2', nowSec)];
  return [firstEntry(series, ev, key, nowSec)];
}

export function qtyFor(cls, bid, { trancheGp = TRANCHE_GP[cls], limit = null } = {}) {
  if (cls === 'big') return 1;
  if (!(trancheGp > 0) || !(bid > 0)) return 0;
  const q = Math.max(1, Math.floor(trancheGp / bid));
  return limit != null ? Math.min(limit, q) : q;
}

/* Bid = last readable avgLow at t; filled iff a bucket in (t, t+hFill] has avgLow ≤ bid AND lowPriceVolume ≥ volMult×qty. */
export function simulateFill(series, t, nowSec, { hFill = H_FILL, bidAdj = 0, qty = 1, volMult = 1 } = {}) {
  const last = lastReadable(series, t, 'avgLowPrice');
  if (last == null) return { status: 'no-bid' };
  const bid = Math.floor(last * (1 + bidAdj)), end = t + hFill * HOUR, seen = lastSeen(nowSec);
  for (let i = firstIndexAfter(series, t); i < series.length && series[i].ts <= Math.min(end, seen); i++) {
    const b = series[i];
    if (b.avgLowPrice != null && b.avgLowPrice <= bid && (b.lowPriceVolume ?? 0) >= volMult * qty) return { status: 'filled', bid, fillTs: b.ts };
  }
  return { status: end <= seen ? 'unfilled' : 'pending', bid };
}

function exitOutcome(fill, price) {
  const net = price - tax(price) - fill;
  return { price, net, frac: net / fill };
}

function bailOut(series, fillTs, fill, nowSec, hExit, bail) {
  if (fillTs + hExit * HOUR > lastSeen(nowSec)) return { status: 'pending' };
  const p = (bail === 'high' ? endHighWithin : endLowWithin)(series, fillTs, hExit);
  return p == null ? { status: 'no-bail' } : { status: 'bailed', ...exitOutcome(fill, p) };
}

/* EX1: list at breakEven(fill)×(1+m) for hExit; reached iff avgHigh ≥ ask AND highPriceVolume ≥ qty. */
export function exitCertainClear(series, fillTs, fill, nowSec, { qty = 1, hExit = H_EXIT, margin = EXIT_MARGIN, bail = 'low' } = {}) {
  const ask = Math.ceil(breakEven(fill) * (1 + margin)), end = Math.min(fillTs + hExit * HOUR, lastSeen(nowSec));
  for (let i = firstIndexAfter(series, fillTs); i < series.length && series[i].ts <= end; i++) {
    const b = series[i];
    if (b.avgHighPrice != null && b.avgHighPrice >= ask && (b.highPriceVolume ?? 0) >= qty) return { status: 'reached', ask, exitTs: b.ts, ...exitOutcome(fill, ask) };
  }
  return { ask, ...bailOut(series, fillTs, fill, nowSec, hExit, bail) };
}

/* EX2: ask = min daily HIGH of the three completed UTC days before each bucket's day, same bail. */
export function exitLadder(series, fillTs, fill, nowSec, { qty = 1, hExit = H_EXIT, bail = 'low' } = {}) {
  const end = Math.min(fillTs + hExit * HOUR, lastSeen(nowSec)), asks = new Map();
  const askFor = ts => {
    const d = dayStart(ts);
    if (!asks.has(d)) {
      const his = completedDays(series, d, 3).map(([, x]) => x.hi).filter(v => v != null);
      asks.set(d, his.length ? Math.min(...his) : null);
    }
    return asks.get(d);
  };
  for (let i = firstIndexAfter(series, fillTs); i < series.length && series[i].ts <= end; i++) {
    const b = series[i], ask = askFor(b.ts);
    if (ask != null && b.avgHighPrice != null && b.avgHighPrice >= ask && (b.highPriceVolume ?? 0) >= qty) return { status: 'reached', ask, exitTs: b.ts, ...exitOutcome(fill, ask) };
  }
  return bailOut(series, fillTs, fill, nowSec, hExit, bail);
}

export const EXITS = Object.freeze({ EX1: exitCertainClear, EX2: exitLadder });

function scoreTranche(series, ev, e, nowSec, o) {
  if (e.status === 'armed') return { status: 'armed' };
  if (e.status !== 'fired') return { status: 'no-entry' };
  const t = e.entry;
  if (t > nowSec) return { status: 'scheduled', entry: t };
  const probe = lastReadable(series, t, 'avgLowPrice');
  if (probe == null) return { status: 'no-bid', entry: t };
  const qty = o.unitQty ? 1 : qtyFor(ev.cls, probe * (1 + o.bidAdj), { trancheGp: o.trancheGp, limit: o.limit });
  if (!qty) return { status: 'no-entry', entry: t };
  const f = simulateFill(series, t, nowSec, { ...o, qty });
  if (f.status !== 'filled') return { ...f, entry: t, qty };
  const exit = EXITS[o.exit](series, f.fillTs, f.bid, nowSec, { ...o, qty });
  return { ...f, entry: t, qty, exit };
}

const DEFAULTS = { hFill: H_FILL, bidAdj: 0, volMult: 1, hExit: H_EXIT, margin: EXIT_MARGIN, bail: 'low', exit: 'EX1', limit: null, unitQty: false };

/* Settles a set of tranches: net = the filled tranches' net; frac over their cost; no fill → net 0. */
function settle(tranches) {
  const filled = tranches.filter(x => x.status === 'filled');
  const pending = tranches.some(x => x.status === 'pending' || x.status === 'scheduled' || x.status === 'armed' || (x.exit && (x.exit.status === 'pending')));
  let net = 0, cost = 0;
  for (const x of filled) if (x.exit && x.exit.net != null) { net += x.exit.net * x.qty; cost += x.bid * x.qty; }
  return { status: pending ? 'pending' : filled.length ? 'entered' : 'no-entry', tranches, net, cost, frac: cost ? net / cost : 0 };
}

/* Fill and exit already-decided entries (from entriesFor), so one entry pass serves every fill/exit spec. */
export function scoreEntries(full, ev, entries, nowSec, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, series = eventWindow(full, ev, o);
  const trancheGp = (opts.trancheGp ?? TRANCHE_GP[ev.cls]) / entries.length;
  return settle(entries.map(e => scoreTranche(series, ev, e, nowSec, { ...o, trancheGp })));
}

/* The onset re-timed to the hour its persistence is first readable: the onset bucket traded ≥ PERSIST_MIN_UNITS
 * and it plus the next PERSIST_BUCKETS−1 consecutive buckets all sat at or under the threshold. Null otherwise. */
export function persistentOnset(series, ev, nowSec) {
  const t0 = ev.onsetTs + PERSIST_BUCKETS * HOUR;
  if (t0 > nowSec) return null;
  const i = firstIndexAfter(series, ev.onsetTs - 1), b0 = series[i];
  if (!b0 || b0.ts !== ev.onsetTs || (b0.lowPriceVolume ?? 0) + (b0.highPriceVolume ?? 0) < PERSIST_MIN_UNITS) return null;
  for (let k = 0; k < PERSIST_BUCKETS; k++) {
    const b = series[i + k], m = midOf(b);
    if (!b || b.ts !== ev.onsetTs + k * HOUR || m == null || m > ONSET_FRAC * ev.refMax) return null;
  }
  return { ...ev, t0 };
}

/* Entry at the lowest avgLow in (t0, t0 + ARM_H], the arm window; exit held fixed. Bounds entry-timing headroom. */
export function scoreOracle(full, ev, nowSec, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, end = ev.t0 + ARM_H * HOUR, series = eventWindow(full, ev, o);
  if (end > lastSeen(nowSec)) return { status: 'pending' };
  let best = null;
  for (let i = firstIndexAfter(series, ev.t0); i < series.length && series[i].ts <= end; i++) {
    const v = series[i].avgLowPrice;
    if (v != null && (best == null || v < best.avgLowPrice)) best = series[i];
  }
  if (!best) return { status: 'no-entry', net: 0, cost: 0, frac: 0 };
  const qty = qtyFor(ev.cls, best.avgLowPrice, { trancheGp: o.trancheGp ?? TRANCHE_GP[ev.cls], limit: o.limit });
  const exit = EXITS[o.exit](series, best.ts, best.avgLowPrice, nowSec, { ...o, qty });
  return settle([{ status: 'filled', bid: best.avgLowPrice, fillTs: best.ts, qty, exit }]);
}

/* Resolved paired per-event rows for cluster-ci's pairedClusterCI, with the onset DAY as the cluster unit. */
export function pairedRows(results, keyA, keyB) {
  const resolved = x => x && x.status !== 'pending';
  return results.filter(r => resolved(r.per[keyA]) && resolved(r.per[keyB]))
    .map(r => ({ rec: { itemId: r.ev.cluster }, per: { [keyA]: { edgeFrac: r.per[keyA].frac }, [keyB]: { edgeFrac: r.per[keyB].frac } } }));
}

/* Daily mean mid per UTC day from fromDay on, over buckets readable at nowSec, keyed by day start. */
function dailyMids(series, nowSec, fromDay) {
  const [lo, hi] = span(series, nowSec, fromDay), acc = new Map();
  for (let i = lo; i < hi; i++) {
    const m = midOf(series[i]);
    if (m == null) continue;
    const d = dayStart(series[i].ts), e = acc.get(d) || { s: 0, n: 0 };
    e.s += m; e.n++; acc.set(d, e);
  }
  return new Map([...acc].map(([d, e]) => [d, e.s / e.n]));
}

/* Breadth on the last completed UTC day at nowSec: share of liquid ≥CRASH_MIN_PRICE items whose daily mid is
 * a BREADTH_LOW_DAYS-day low, plus each class's median RET_DAYS-day return. */
export function breadthRead(seriesById, nowSec) {
  const D = dayStart(nowSec) - DAY;
  const cls = { big: { n: 0, low: 0, rets: [] }, '1-10m': { n: 0, low: 0, rets: [] } };
  for (const series of (seriesById instanceof Map ? seriesById.values() : Object.values(seriesById))) {
    if (!series || !series.length || !(turnoverGpd(series, nowSec) > LIQ_MIN_GPD)) continue;
    const mids = dailyMids(series, nowSec, D - (BREADTH_LOW_DAYS - 1) * DAY), m = mids.get(D);
    const c = cls[classOf(m)];
    if (m == null || !c) continue;
    const prior = [...mids].filter(([d]) => d < D).map(([, v]) => v);
    if (prior.length < BREADTH_MIN_PRIOR) continue;
    c.n++;
    if (m <= Math.min(...prior)) c.low++;
    const back = mids.get(D - RET_DAYS * DAY);
    if (back) c.rets.push(m / back - 1);
  }
  const n = cls.big.n + cls['1-10m'].n;
  const byClass = Object.fromEntries(Object.entries(cls).map(([k, c]) => [k, { n: c.n, breadth: c.n ? c.low / c.n : null, ret: median(c.rets) }]));
  return { day: utcDay(D), n, breadth: n ? (cls.big.low + cls['1-10m'].low) / n : null, byClass };
}

/* Stabilising per class = breadth < STABLE_BREADTH AND class median return > STABLE_RET on each of the last STABLE_RUN completed days. */
// @test-only: no production consumer until CRX2 (join-crash-entry.mjs) / CRX3 (read-crash-entry.mjs) — drop this marker there.
export function stabilityRead(seriesById, nowSec) {
  const days = [];
  for (let k = STABLE_RUN - 1; k >= 0; k--) days.push(breadthRead(seriesById, dayStart(nowSec) - k * DAY));
  const ok = (d, c) => d.breadth != null && d.breadth < STABLE_BREADTH && d.byClass[c].ret != null && d.byClass[c].ret > STABLE_RET;
  return { days, stabilising: Object.fromEntries(CRASH_CLASSES.map(c => [c, days.every(d => ok(d, c))])) };
}
