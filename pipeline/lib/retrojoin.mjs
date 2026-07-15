/* retrojoin.mjs — the PURE suggestion→fill RETRO-JOIN core (Pipeline v2, chunk P6a).
 *
 * WHAT THIS IS. The FOUNDATION slice of P6 (evidence-based viability + TTF). For every suggestion
 * row the tool ever logged (active suggestions.jsonl + the monthly archives), join FORWARD against
 * fills.json BUY events for the same item AFTER the suggestion, and classify the outcome. This is
 * the ground-truth calibrator the P6 TTF ruling (PLAN.md, Ben 2026-07-09) demands: realized
 * suggestion→fill latency from OUR OWN FILLS, never touch-proxies (touched ≠ filled — queue
 * position is invisible). Its per-niche / per-path attribution is also what answers the Discovered
 * "spread/band/churn consolidation — evidence-gated" question later (realized profit per unit of
 * attention, per niche), with the honesty that the sample is weeks-cold and mostly `not-taken`.
 *
 * DIRECTION — WHY THIS IS NOT join-outcomes.mjs. join-outcomes.mjs is CAMPAIGN-keyed and joins BACKWARD (each
 * offer-campaign → the nearest PRIOR suggestion) to validate the campaign schema + band-percentile
 * fill-time cells. This module is SUGGESTION-keyed and joins FORWARD (each suggestion → the fills
 * it plausibly caused). The primary key, the join direction, and the output (per-niche/per-path
 * TTF + realized-vs-suggested attribution vs campaign band-pct fill-time) all differ, so this is a
 * sibling concern, not an extension. It REUSES the canonical FIFO helpers (collapseOffers /
 * matchTrades / dedupeSnapshots from reconstruct.mjs) — FIFO P/L is never re-implemented here — and
 * the ONE shared suggestions reader (readSuggestionLines, via the caller). This file is PURE: no
 * fs / no fetch. The caller feeds parsed suggestion rows + parsed fills events; tests feed SYNTHETIC
 * fixtures only (never the live fills.json).
 *
 * ⚠ ALL horizon constants below are NAMED PLACEHOLDERS (the same discipline as held-item-strategy.mjs weights and
 * rating.mjs cutoffs). They encode the SHAPE of the judgment (a scalp-family suggestion's fill
 * window is intraday; a value/rising accumulation's is multi-day), NOT a calibrated magnitude — the
 * whole point of P6 is that this retro-join MEASURES the real latency so a later chunk can replace
 * guesses with data. Do NOT cite any constant here as validated.
 */
import { collapseOffers, matchTrades, dedupeSnapshots } from './reconstruct.mjs';
import { median } from './cli.mjs';
import { tax, quantileOf } from '../../js/quotecore.js';   // quantileOf = the ONE sorting type-7 quantile (SF-1)

// --- named placeholder horizons (s): how long after a suggestion a BUY fill still counts as "acting
// on it". Keyed by the strategy niche the row was surfaced under; a row with no/unknown mode (a
// plain quote or a --positions review) gets the default. Per the P6 TTF ruling the niches are one
// buy-low-sell-high formula differing mainly in LOOKBACK/hold horizon, so the fill window scales the
// same way: intraday for the scalp family, multi-day for accumulation. -----------------------------
export const HORIZON_INTRADAY_SEC = 12 * 3600;        // scalp / band / spread / churn — intraday flip family
export const HORIZON_MULTIDAY_SEC = 7 * 24 * 3600;    // rising / value — patient multi-day accumulation
export const HORIZON_DEFAULT_SEC  = 24 * 3600;        // mode-less rows (quote / --positions) — one day
export const HORIZON_BY_MODE = Object.freeze({
  scalp: HORIZON_INTRADAY_SEC, band: HORIZON_INTRADAY_SEC, spread: HORIZON_INTRADAY_SEC, churn: HORIZON_INTRADAY_SEC,
  rising: HORIZON_MULTIDAY_SEC, value: HORIZON_MULTIDAY_SEC,
});
export function horizonFor(mode, byMode = HORIZON_BY_MODE) {
  return (mode != null && byMode[mode] != null) ? byMode[mode] : HORIZON_DEFAULT_SEC;
}

// The price the tool would have you BID: the patient band edge (optBuy) if present, else the live
// instasell (quickBuy). A buy fill executed at or below this is "filled as suggested"; above it is
// "filled-worse" (bought the item, but paid more than the recommended level). Null when the row
// logged no buy price → we can't grade the price, so a claimed fill counts as `filled` (priceKnown:false).
function refBuyOf(s) {
  const o = (typeof s.optBuy === 'number' && Number.isFinite(s.optBuy)) ? s.optBuy : null;
  const q = (typeof s.quickBuy === 'number' && Number.isFinite(s.quickBuy)) ? s.quickBuy : null;
  return o != null ? o : q;
}
// The suggested after-tax net per unit at the patient edges (optimistic if present, else quick) —
// the number a realized round-trip is measured against. Null unless both a sell and a buy are known.
function suggestedNetPerUnit(s) {
  const buy = refBuyOf(s);
  const sell = (typeof s.optSell === 'number' && Number.isFinite(s.optSell)) ? s.optSell
    : (typeof s.quickSell === 'number' && Number.isFinite(s.quickSell)) ? s.quickSell : null;
  if (buy == null || sell == null) return null;
  return (sell - tax(sell)) - buy;
}

// first-fill ts of a collapsed buy offer: the first raw event in its slot+item+type window with
// filled>0 (collapseOffers loses intermediate timing). Falls back to tsOpen if none is found.
function stampFirstFills(events, offers) {
  const evs = [...events].sort((a, b) => a.ts - b.ts);
  for (const o of offers) {
    o.tsFirstFill = null;
    for (const e of evs) {
      if (e.slot === o.slot && e.itemId === o.itemId && e.type === o.type &&
          e.ts >= o.tsOpen && e.ts <= o.tsClose && (e.filled || 0) > 0) { o.tsFirstFill = e.ts; break; }
    }
    if (o.tsFirstFill == null) o.tsFirstFill = o.tsOpen;
  }
}

// q25/q75 over a RAW (unsorted) latency array — quantileOf sorts a copy (SF-1 shared type-7 quantile).
const q25 = a => quantileOf(a, 0.25);
const q75 = a => quantileOf(a, 0.75);

/* retroJoin(suggestions, fillsEvents, opts) → { rows, meta }.
 *   suggestions — array of parsed suggestion rows (the readSuggestionLines JSON objects).
 *   fillsEvents — array of parsed fills.json events (the raw normalized event shape).
 *   opts.horizonByMode — override the placeholder horizon map (tests).
 *
 * DEDUP / DOUBLE-CLAIM RULE. Each BUY offer is claimed by AT MOST ONE suggestion: the NEAREST-PRIOR
 * one — the latest suggestion (by ts) for that item at/before the fill AND within that suggestion's
 * own horizon. So two suggestions for the same item close together never both claim one fill: the
 * fresher recommendation (the one you'd have acted on) claims it; the stale earlier one reads
 * `not-taken`. This mirrors reality (you act on the latest re-quote) and guarantees one fill → one
 * suggestion.
 *
 * Each result row carries: outcome ∈ {filled, filled-worse, not-taken}, latencySec (suggestion→first
 * claimed fill = the TTF ground truth), partial (the claimed fill filled < its offer qty), the
 * realized round-trip (FIFO-matched sell: realisedNet / realisedPerUnit / holdSec, plus sellEach —
 * the qty-weighted realized GROSS sell price, so sell-side joins like the Bar E raw-top-reach
 * question are no longer buy-keyed-only) where one exists,
 * and suggestedNetPerUnit for the realized-vs-suggested comparison. mode/path are carried through
 * for attribution (path absent on rows that predate P4c → grouped under mode only). */
export function retroJoin(suggestions, fillsEvents, { horizonByMode = HORIZON_BY_MODE } = {}) {
  const events = Array.isArray(fillsEvents) ? fillsEvents : [];
  const deduped = dedupeSnapshots(events);
  const offers = collapseOffers(deduped);
  const buyOffers = offers.filter(o => o.type === 'buy' && (o.filled || 0) > 0);
  stampFirstFills(deduped, buyOffers);

  // FIFO closed lots → realized round-trip keyed by the BUY offer tsOpen (lot.ts). Never re-derived.
  // sellGross accumulates qty×sellEach across the lot's closing sells so the row can carry the
  // qty-weighted REALIZED SELL PRICE (sellEach) — the field the Bar E "did the sell reach the raw
  // top?" join needs (analyze.mjs §5); before 2026-07-12 the row was buy-keyed only.
  const { closed } = matchTrades(offers);
  const rtByBuyTs = new Map();   // buyTs -> { qty, realised, sellGross, sellTs (earliest) }
  for (const t of closed) {
    if (t.withdrawn || t.buyTs == null) continue;
    const e = rtByBuyTs.get(t.buyTs) || { qty: 0, realised: 0, sellGross: 0, sellTs: null };
    e.qty += t.qty; e.realised += (t.realised || 0);
    e.sellGross += (t.sellEach || 0) * t.qty;
    e.sellTs = e.sellTs == null ? t.sellTs : Math.min(e.sellTs, t.sellTs);
    rtByBuyTs.set(t.buyTs, e);
  }

  // suggestions indexed by item, ascending ts (carry original index for stable claim assignment)
  const byItem = new Map();
  suggestions.forEach((s, idx) => {
    if (s == null || s.itemId == null || s.ts == null) return;
    (byItem.get(s.itemId) || byItem.set(s.itemId, []).get(s.itemId)).push({ s, idx });
  });
  for (const list of byItem.values()) list.sort((a, b) => a.s.ts - b.s.ts || a.idx - b.idx);

  // assign each buy offer to its nearest-prior suggestion (each offer claimed once)
  const claims = new Map();   // suggestion idx -> [buy offers]
  for (const o of buyOffers) {
    const list = byItem.get(o.itemId); if (!list) continue;
    let best = null;
    for (const { s, idx } of list) {
      if (s.ts > o.tsFirstFill) break;
      if (o.tsFirstFill - s.ts <= horizonFor(s.mode, horizonByMode)) best = idx;   // latest qualifying = nearest-prior
    }
    if (best != null) (claims.get(best) || claims.set(best, []).get(best)).push(o);
  }

  const rows = suggestions.map((s, idx) => {
    const mode = (s && s.mode != null) ? s.mode : null;
    const path = (s && s.path != null) ? s.path : null;
    const claimed = (claims.get(idx) || []).slice().sort((a, b) => a.tsFirstFill - b.tsFirstFill);
    const refBuy = s ? refBuyOf(s) : null;
    const base = { itemId: s ? s.itemId ?? null : null, ts: s ? s.ts ?? null : null, script: s ? s.script ?? null : null,
      mode, path, refBuy, suggestedNetPerUnit: s ? suggestedNetPerUnit(s) : null };
    if (!claimed.length) {
      return { ...base, outcome: 'not-taken', latencySec: null, fillEach: null, priceKnown: refBuy != null,
        partial: false, realisedNet: null, realisedPerUnit: null, sellEach: null, holdSec: null };
    }
    const first = claimed[0];
    const fillEach = first.filled > 0 ? first.spent / first.filled : null;
    const priceKnown = refBuy != null && fillEach != null;
    const outcome = !priceKnown ? 'filled' : (fillEach <= refBuy ? 'filled' : 'filled-worse');
    const rt = rtByBuyTs.get(first.tsOpen) || null;
    return {
      ...base,
      outcome,
      latencySec: first.tsFirstFill - s.ts,
      fillEach: fillEach != null ? Math.round(fillEach) : null,
      priceKnown,
      partial: (first.filled || 0) < (first.qty || 0),
      realisedNet: rt ? rt.realised : null,
      realisedPerUnit: rt && rt.qty ? Math.round(rt.realised / rt.qty) : null,
      // qty-weighted realized GROSS sell price across the lot's closing sells (pre-tax, the price the
      // ask actually printed at) — null until a round-trip closes. Additive 2026-07-12.
      sellEach: rt && rt.qty ? Math.round(rt.sellGross / rt.qty) : null,
      holdSec: rt && rt.sellTs != null ? rt.sellTs - first.tsOpen : null,
    };
  });

  const meta = {
    nSuggestions: suggestions.length,
    nBuyOffers: buyOffers.length,
    nClaimed: [...claims.values()].reduce((a, arr) => a + arr.length, 0),
    horizon: { intradaySec: HORIZON_INTRADAY_SEC, multidaySec: HORIZON_MULTIDAY_SEC, defaultSec: HORIZON_DEFAULT_SEC },
  };
  return { rows, meta };
}

// one group's honest accounting — n on every field, no grades/verdicts. `taken` = filled+filled-worse.
function groupStat(key, rs) {
  const taken = rs.filter(r => r.outcome !== 'not-taken');
  const lat = taken.map(r => r.latencySec).filter(x => x != null);
  const realised = rs.map(r => r.realisedNet).filter(x => x != null);
  const realisedSum = realised.reduce((a, x) => a + x, 0);
  const holds = rs.map(r => r.holdSec).filter(x => x != null);
  return {
    key, n: rs.length,
    filled: rs.filter(r => r.outcome === 'filled').length,
    filledWorse: rs.filter(r => r.outcome === 'filled-worse').length,
    notTaken: rs.filter(r => r.outcome === 'not-taken').length,
    partial: rs.filter(r => r.partial).length,
    takenRate: rs.length ? taken.length / rs.length : null,
    latencyN: lat.length,
    latencyMedianSec: median(lat),
    latencyP25Sec: q25(lat), latencyP75Sec: q75(lat),
    realisedN: realised.length,
    realisedSum,
    realisedPerAttention: rs.length ? realisedSum / rs.length : null,   // profit per unit of attention
    holdN: holds.length, holdMedianSec: median(holds),
  };
}

/* aggregateOutcomes(rows) → { perNiche, perPath }. PURE. Groups the retroJoin rows two ways:
 *   perNiche — by mode (null mode → '(none)': plain quotes + --positions reviews, a mixed bucket).
 *   perPath  — by mode + inferred entry path (rows predating P4c's `path` field → '(no-path)').
 * Both arrays carry n on EVERY group and are sorted by n desc then key for deterministic output. No
 * derived grade/verdict — the sample is weeks-cold and mostly not-taken; this is honest accounting. */
export function aggregateOutcomes(rows) {
  const niche = new Map(), pathG = new Map();
  for (const r of rows) {
    const nk = r.mode != null ? r.mode : '(none)';
    const pk = nk + ' / ' + (r.path != null ? r.path : '(no-path)');
    (niche.get(nk) || niche.set(nk, []).get(nk)).push(r);
    (pathG.get(pk) || pathG.set(pk, []).get(pk)).push(r);
  }
  const build = m => [...m.entries()].map(([k, rs]) => groupStat(k, rs))
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { perNiche: build(niche), perPath: build(pathG) };
}
