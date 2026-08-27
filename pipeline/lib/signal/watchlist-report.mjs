// The ONE watchlist row builder. Two callers today: `read-watchlist.mjs` (the explicit surface) and
// `screen-flip-niches.mjs`'s `runWatchlist`, which the scan still runs on every pass — SEP16c is what
// takes it off the default path, and the `--include-watchlist` flag belongs to that chunk, not this one.
// Neither caller owns a second quote loop. Rendering and `logSuggestions` stay with the callers —
// this module computes, it does not emit.

import { computeQuote } from '../../../js/quotecore.js';
import { tax } from '../../../js/money-math.js';
import { fmt, fmtP } from '../../../js/money-format.js';
import { FLIP_NICHES } from '../../../js/flip-niches.mjs';
import { estimateRank, fmtTtf } from './estimators.mjs';
import { expUnits } from './gatecandidates.mjs';
import { rateItem, CONF_THIN_N_FLOOR } from './rating.mjs';
import { stdCells, RANK_TABLE_HEADERS } from '../render/cli.mjs';
import { suggestionEntry, liqClass } from '../render/suggestlog.mjs';

export const WATCHLIST_HEADERS = [...RANK_TABLE_HEADERS, 'Note'];

export const round2 = x => Math.round(x * 100) / 100;

// P6b lean fields: the quoted pair + rank components + n/basis, so the retro-join can calibrate
// estimate-vs-realized. Absent-field rows stay byte-identical (the YS2 pattern).
export function estFields(er) {
  return {
    bid: er.pair.bid, ask: er.pair.ask,
    pFill: round2(er.pFill.value), ttfSec: er.ttf.value, rank: Math.round(er.rank),
    estBasis: `${er.pFill.basis}/${er.ttf.basis}`, estN: Math.min(er.pFill.n, er.ttf.n),
  };
}

// best-effort realistic gp/day for a watchlist grade (no mode context) — band edge if we have one,
// else the 24h-avg spread; same expUnits basis as the niches. Informational only.
export function roughExpGpDay(d, bands, id, limit) {
  if (!d) return 0;
  const b = bands && bands[id];
  let net;
  if (b && b.bandHi != null && b.bandLo != null) net = (b.bandHi - tax(b.bandHi)) - b.bandLo;
  else if (d.avgHighPrice && d.avgLowPrice) net = (d.avgHighPrice - tax(d.avgHighPrice)) - d.avgLowPrice;
  else return 0;
  if (net <= 0) return 0;
  return Math.round(expUnits(limit, Math.min(d.highPriceVolume || 0, d.lowPriceVolume || 0)) * net);
}

// the reason a gate WOULD have hidden this row (empty = it'd pass a normal scan) — surfaced as a Note.
export function watchlistNote(row, d, bands, id, limit, { floor, gpFloor, minGpd }) {
  const hpv = d?.highPriceVolume || 0, lpv = d?.lowPriceVolume || 0;
  if (hpv <= 0 || lpv <= 0) return 'one-sided book — uncrossable (ghost-spread)';
  if (row.falling) return 'falling — price to clear, do not accumulate';
  const limitVol = Math.min(hpv, lpv), mid = row.mid || ((d.avgHighPrice + d.avgLowPrice) / 2);
  if (limitVol < floor) return limitVol * mid >= gpFloor ? `thin (~${limitVol}/day — size in units)` : 'thin/illiquid — few trades/day';
  if (roughExpGpDay(d, bands, id, limit) < minGpd) return `below ${(minGpd / 1e3).toLocaleString()}k/day attention floor`;
  return '';                                               // would surface in a normal scan on merit
}

// entries: loadWatchlistEntries() output. fetchSeries(id) → [ts5m, ts6h]; the caller owns the
// fetch/cache seam so the scan keeps its TTLs and --archive-regime reader.
// Returns { headers, rows, sugg } — empty entries yield rows: [] rather than null, so a caller can
// tell "nothing watchlisted" from "did not run".
export async function buildWatchlistReport({
  entries, map, v24, bands, guide, latest, qcache = new Map(),
  fetchSeries, concurrency = 5, floor, gpFloor, minGpd, volSrcLabel, posture,
}) {
  // FETCH phase, split out of the compute loop below (SP1). Every watchlist id the caller has not
  // already quoted is pre-quoted through a bounded worker pool with its two endpoints in flight
  // together, replacing a strictly-serial per-item fetch+sleep.
  //
  // ORDER SAFETY — why this is behaviour-preserving, not just fast: the COMPUTE loop still walks
  // `entries` in its original order and reads finished quotes out of an id-keyed Map, so row/sugg
  // order is independent of fetch COMPLETION order, and the shared reader dedupes ids so no two
  // workers race the same disk cache file. The `!qcache.get(id)` admission test is deliberately
  // truthiness — do not "tidy" it to `.has()`, which changes behaviour on a falsy cached quote.
  const prefetched = new Map();
  {
    const queue = entries.filter(({ id }) => !qcache.get(id)).map(({ id }) => id);
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const [ts5m, ts6h] = await fetchSeries(id);
        prefetched.set(id, computeQuote({
          id, latest: latest[id] || latest[String(id)] || null, ts5m, ts6h,
          vol24: v24[id], guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null,
          asked: true, held: true,
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) || 1 }, worker));
  }

  const rows = [], sugg = [];
  for (const { id, name } of entries) {
    const row = qcache.get(id) || prefetched.get(id);      // caller's pool first, else this pass's prefetch
    const d = v24[id], limit = map.byId[id]?.limit ?? null;
    const limitVol = d ? Math.min(d.highPriceVolume || 0, d.lowPriceVolume || 0) : 0;
    // "thin OR UNVERIFIED" — the same fail-closed rule as the app's desirabilityOf (js/market.js).
    // Both `> 0` and the old `: false` were CAP ESCAPES: a one-sided book, a zero-volume item, and an
    // item absent from v24 all read NOT-thin and skipped THIN_GRADE_CAP entirely. Watchlist rows are
    // gate-exempt by design, so this cap is the ONLY thing standing between an unverifiable book and
    // an S+ letter. Unknown liquidity must not headline.
    const thin = d ? (limitVol < floor) : true;
    // P6b: a watchlist row has no niche context, so rank it under the neutral band thesis (intraday
    // estimator, patient 2h-band pair) — a standard flip read. Same rank basis as the niche tables.
    // Decision 2 Option 1: estimateRank takes NO `extra` here, exactly as the in-scan path did, so
    // pFillN is 0 by construction and every row carries the (thin) marker. That is a code-path
    // artifact, not a property of the items; wiring `extra` is SEP16e and needs its own ruling.
    const er = estimateRank(FLIP_NICHES.band, row);
    const r = rateItem({ row, rank: er.rank, thin, pFillN: er.pFill.n, ttfN: er.ttf.n });   // G6: (thin) confidence marker off the reach sample
    const std = stdCells(name, row);
    const gradeCell = thin ? { t: r.grade, title: `thin: ~${limitVol}/day two-sided — size in units, expect slow fills` } : { t: r.grade };
    if (r.thinConfidence) { gradeCell.t = gradeCell.t + ' (thin)'; gradeCell.title = (gradeCell.title ? gradeCell.title + '; ' : '') + `thin confidence: the fill call rests on only ${er.pFill.n} day(s) of reach evidence (< ${CONF_THIN_N_FLOOR})`; }
    const rankCell = { t: `${fmtP(r.score)} · net ${fmt(er.net || 0)} P~${er.pFill.value.toFixed(2)} ttf~${fmtTtf(er.ttf.value)}`, c: 'mini' };
    const cells = [std[0], gradeCell, ...std.slice(1), rankCell, { t: watchlistNote(row, d, bands, id, limit, { floor, gpFloor, minGpd }), c: 'mini' }];
    rows.push({ id, cells });
    sugg.push(suggestionEntry(row, { itemId: id, cls: liqClass(row), volDay: row.volDay, volSrc: volSrcLabel, verdict: r.grade, grade: r.grade, cappedBy: r.cappedBy, posture, ...estFields(er) }));   // SF-3: volDay follows VOL_SOURCE · AZ-forward: grade logged explicitly · R7: THIN cap only
  }
  return { headers: WATCHLIST_HEADERS, rows, sugg };
}
