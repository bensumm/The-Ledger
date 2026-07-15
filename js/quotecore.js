/* quotecore.js — DOM-free quote model + canonical market-table cells.
   Pure ESM: imports only money-math.js + money-format.js (also pure), references no window/document.
   Importable by BOTH the browser app (js/quote.js, trends.js, ui.js) AND node
   pipeline scripts (chunk 3 quote-items.mjs/screen-flip-niches.mjs, chunk 5 bank.mjs) — keep it that way.

   The canonical market table (CLAUDE.md "Market analysis workflow"):
     Item | Guide | Mid | Buy@ Quick / Opt | Sell@ Quick / Opt | Net/u Quick / Opt (ROI) | Vol/d | Regime
   - Quick = transact now: buy at live instasell (latest.low), sell at live instabuy (latest.high).
   - Optimistic = patient 2h-band edges over the last 24×5m points, ROBUSTIFIED (Bar E, robustBand): the
     p10 low / p90 high on a dense side (≥ BAND_EDGE_MIN_SAMPLE prints), the raw extremum on a sparse one,
     so a lone flier can't inflate the surfaced edge. The MOMENTUM tell keeps the true raw min/max.
   INVARIANT (guaranteed by construction below): optBuy ≤ quickBuy ≤ quickSell ≤ optSell.
   The 2026-07-03 bug that inflated an edge 2.5× came from mixing bases (24h percentiles vs
   live quotes). Here the optimistic edges are CLAMPED against the SAME live quote, so the
   optimistic side can never be worse than the quick side — the mixing can't happen. */

import { tax, netMargin, TAXCAP, isBond, bondFee } from './money-math.js';
import { fmtP, fmt } from './money-format.js';
export { tax, netMargin } from './money-math.js';   // re-export so node consumers (chunk 4.1) get the ONE tax impl
// Break-even list price: the smallest sell price `s` that still nets ≥ `buy` after the GE tax —
// i.e. the smallest integer s with s - tax(s) ≥ buy. The ONE definition shared by the app, the
// pipeline monitor, and the analysis scripts (chunk 4.1) so tax/break-even math can never drift.
// PIECEWISE, matching money-math.js tax() exactly (BE1) — the plain ceil(buy/0.98) is the *uncapped*
// inverse and is wrong in tax()'s two flat regions:
//   • buy < 50            → buy       (a sell under 50gp is tax-exempt: tax(s)=0, so s=buy clears)
//   • buy > 250m − TAXCAP → buy+TAXCAP (the 2% cap binds: floor(s·0.02) hits TAXCAP=5m at
//                                       s ≥ TAXCAP/0.02 = 250m, so tax is flat 5m and true BE is
//                                       buy+5m — ceil(buy/0.98) OVERSTATES it, e.g. a 1.633b bow
//                                       demanded 1.666b vs 1.638b true)
//   • otherwise           → ceil(buy/0.98)   (uncapped region — unchanged legacy formula)
// The crossover (buy > TAXCAP/0.02 − TAXCAP = 245m) and smallest-s correctness at every region
// boundary are brute-force-proven in pipeline/test/quotecore.test.mjs (BE1 fixtures).
// BOND exception (opts.bond, with opts.guide): bonds pay NO 2% sell tax, so the smallest sell that
// recovers the flip's cost is just buy + the 10%-of-guide retrade fee (shared bondFee). Non-bond callers
// pass no opts → the legacy tax-capped piecewise below (byte-identical).
export const breakEven = (buy, opts) => {
  if (opts && opts.bond) return buy + bondFee(opts.guide);
  if (buy < 50) return buy;
  if (buy > TAXCAP/0.02 - TAXCAP) return buy + TAXCAP;
  return Math.ceil(buy/0.98);
};
// Inverse of breakEven for WINDOW-CLEAR PRICING (PLAN-WINDOW-CLEAR B3): the LARGEST integer buy whose
// break-even + `margin` still lands at/under a reachable exit `sell` — i.e. the max buy with
// breakEven(buy) + margin ≤ sell. This is the tax-EXACT form of the /scan WINDOW-CLEAR back-solve, so it
// MUST live beside breakEven (CLAUDE.md: breakEven is "the ONE definition" — an inverse implemented
// anywhere else is a second tax-math home that would drift). A plain (sell − margin)·0.98 is WRONG in the
// two flat regions breakEven is piecewise over, so this mirrors them exactly (target = the largest
// break-even the exit can carry = sell − margin):
//   • target < 50            → target        (sub-50 sells are tax-exempt: breakEven(buy)=buy, so buy=target)
//   • target > 250m          → target−TAXCAP (the cap binds: breakEven(buy)=buy+TAXCAP → buy=target−5m; a
//                                             ·0.98 here UNDER-shoots the true max buy)
//   • otherwise              → floor(target·0.98)   (inverse of ceil(buy/0.98); floor picks the max buy)
// Bond exception via the same opts (bonds pay no sell tax; breakEven=buy+bondFee → buy=target−bondFee).
// Returns null when no profitable buy exists (sell − margin below the smallest break-even). `margin`
// defaults to 0 (the break-even-neutral max buy). Round-trip against breakEven is brute-force-pinned in
// pipeline/test/quotecore.test.mjs.
// The tax-exact inverse of breakEven (PLAN-WINDOW-CLEAR B3). CONSUMED by quote-items.mjs's #6 forecast
// line (the profitable-buy target for whenBuyable). CAVEAT for callers: the exact back-solve wants the
// WITHIN-WINDOW-REACHABLE exit — optSell is the ask that doesn't clear in-window, so passing it OVER-states
// the entry ceiling (conservative for an inform read). The dedicated exact surface is `read-window-range.mjs
// --exit <ask> [--margin <gp>]` (#9, built 2026-07-15 — back-solves the buy AND shows the exit's in-window
// reachability so a rarely-printed, over-stated exit is flagged). Pinned by quotecore.test.mjs.
export const maxBuyForExit = (sell, margin = 0, opts) => {
  const target = sell - margin;                                   // the largest break-even the exit can carry
  if (opts && opts.bond) { const b = target - bondFee(opts.guide); return b >= 0 ? Math.floor(b) : null; }
  if (target < 0) return null;
  if (target < 50) return Math.floor(target);                     // sub-50 tax-exempt: breakEven(buy) = buy
  if (target > TAXCAP/0.02) return Math.floor(target - TAXCAP);    // tax-capped region (target > 250m)
  return Math.floor(target * 0.98);                               // uncapped: inverse of ceil(buy/0.98)
};
// Total lot value (qty × avgCost, i.e. capital at risk — NOT per-unit) at/above which a 2h
// breakdown against a rising regime is CLEARED rather than held (chunk 6 cut-trigger). Named +
// tunable; lives here (the shared node+browser module) so reviewPositions and quote-items.mjs --positions
// use ONE constant and can never drift.
export const BIG_TICKET_GP = 10_000_000;
// V3 lot-context softening of the Gate-D clean-momentum CUT-CANDIDATE (see momVerdict). A lot
// bought less than FRESH_HOURS ago is DEFINITIONALLY underwater on the instant-clear price — a
// patient fill hasn't had its thesis window to work yet — so the "a genuine trough would have
// recovered by now" persistence-cut doesn't apply, "by now" being minutes. PLACEHOLDER (Ben's
// chosen 1h start) — monitor the real loop cadence and tune; cited nowhere as calibrated. Softens
// ONLY Gate-D; it NEVER touches the Gate-2 breakdown CUT.
export const FRESH_HOURS = 1;

// --- PLAN-3 underwater-triage tunables (named, not magic numbers) --------------------------
// GATE 0 (quote reliability). A live /latest print older than STALE_QUOTE_MIN minutes is stale
// for a LIQUID item; for a THIN item (rare prints) the effective threshold is scaled UP to
// STALE_INTERVAL_MULT × the item's own typical inter-print gap (so a 4h-old instabuy on a
// liquid book is stale, while the same age on an item that trades twice a day is normal).
export const STALE_QUOTE_MIN     = 90;
export const STALE_INTERVAL_MULT = 3;
// minimum populated 5m windows in the 2h band to trust it as a real two-sided price.
export const MIN_BAND_WINDOWS    = 3;
// GATE 1 (diurnal). current 2h activity < QUIET_RATIO × the series' median 2h activity ⇒ a quiet
// (liquidity-trough) window; yesterday's same-clock window counts as a dip if its band low was
// ≥ DIURNAL_DIP_MARGIN below the series median low, recovered if prices later rose ≥
// DIURNAL_RECOVER_MARGIN back above that dip.
export const QUIET_RATIO             = 0.5;
export const DIURNAL_DIP_MARGIN      = 0.03;
export const DIURNAL_RECOVER_MARGIN  = 0.03;
// GATE 2 (shock vs bleed). a down-move concentrated in ≤ SHOCK_MAX_NEWLOWS new-low windows on a
// ≥ VOL_SPIKE_MULT× volume spike, then stabilizing = a one-off shock; ≥ BLEED_MIN_NEWLOWS
// distributed lower-lows still at the lows = a bleed (repricing under way).
export const SHOCK_MAX_NEWLOWS   = 3;
export const VOL_SPIKE_MULT      = 2.5;
export const BLEED_MIN_NEWLOWS   = 4;

/* --- type-7 quantile / median: the ONE shared home (SF-1) ---------------------------------------
   quotecore.js is lowest in the import graph, so the type-7 linear-interpolation quantile lives HERE and
   js/termstructure.mjs + pipeline/lib/retrojoin.mjs re-export/alias it (was three drifting copies).
   TWO shapes, so every caller keeps its exact contract:
     - quantileSorted(sortedAsc, q) — REQUIRES an ascending array (does NOT sort); q clamped to [0,1],
       empty → null. Used by robustBand's dense-side edge + termstructure (its mids arrive pre-sorted).
     - quantileOf(arr, q) / median(arr) — sort a COPY first (never mutate the input), empty/absent → null.
       The sorting convenience used by retrojoin's q25/q75 and quotecore's own `med` regime/phase math.
   median(arr) === the classic mean-of-two-middle median (type-7 at q=0.5 is byte-identical to it). */
export function quantileSorted(sorted, q){       // type-7 linear interpolation over an ascending array
  const n=sorted?.length||0;
  if(!n) return null;
  if(n===1) return sorted[0];
  const pos=(n-1)*Math.min(1,Math.max(0,q)), base=Math.floor(pos), rest=pos-base;
  return sorted[base+1]!=null ? sorted[base]+rest*(sorted[base+1]-sorted[base]) : sorted[base];
}
export const quantileOf = (arr, q) => (!arr || !arr.length) ? null : quantileSorted([...arr].sort((a,b)=>a-b), q);
export const median = arr => quantileOf(arr, 0.5);
const med = median;   // internal alias for the regime/phase/activity math below (was a private copy)
const cap=s=>s?s[0].toUpperCase()+s.slice(1):s;

/* --- regime-shift guard (MOVED here from trends.js so Trends + quotes share one impl) ----
   Has the price LEVEL moved recently? Compares the last 3 days' median mid-price against the
   prior ~2 weeks'. conf/medCount only measure how much history we have, not whether it's one
   stable regime — a one-off jump can masquerade as a daily cycle without this. Operates on a
   6h-timestep series (points with avgLowPrice/avgHighPrice/timestamp). */
export function regimeDrift(points){
  if(!points || points.length<2) return {ok:false};
  const mid=p=>(p.avgLowPrice&&p.avgHighPrice)?(p.avgLowPrice+p.avgHighPrice)/2:(p.avgLowPrice||p.avgHighPrice);
  const tEnd=points[points.length-1].timestamp;
  const recentCut=tEnd-3*86400, priorCut=tEnd-17*86400;
  const recent=[], prior=[];
  points.forEach(p=>{ const m=mid(p); if(!m) return;
    if(p.timestamp>=recentCut) recent.push(m);
    else if(p.timestamp>=priorCut) prior.push(m); });
  if(recent.length<8 || prior.length<8) return {ok:false};   // not enough on either side to compare
  const recentMed=med(recent), priorMed=med(prior);
  if(!recentMed || !priorMed) return {ok:false};
  return {ok:true, driftPct:(recentMed-priorMed)/priorMed*100, recentMed, priorMed};
}
/* flat / rising / falling label off a regimeDrift result. ±5% threshold matches the
   falling/rising cutoffs used in classifyPositionTrend and the Trends plan card. */
export function regimeLabel(regime){
  if(!regime || !regime.ok) return {label:'unknown', falling:false, rising:false};
  const d=regime.driftPct;
  if(d<=-5) return {label:'falling', falling:true,  rising:false};
  if(d>= 5) return {label:'rising',  falling:false, rising:true};
  return {label:'flat', falling:false, rising:false};
}

/* --- PHASE classifier — trajectory SHAPE over the ~21d 6h series (spike → decay → basing) -------
   COMPLEMENTARY to regimeDrift/regimeLabel, which stays the flat/rising/falling GATE driver (this
   changes NOTHING about that). phase() reads the *shape* of a pump-and-fade off the SAME `ts6h`
   points computeQuote already fetches (points = [{avgLowPrice, avgHighPrice, timestamp}]) → ZERO new
   network. It is consumed ONLY by the pipeline (screen-flip-niches.mjs display + the opt-in basing-rescue); the
   deployed app renders nothing off it, so this ships without an APP_VERSION bump.

   Returns { phase, curMid, baseMid, peakMid, lowSlope }, phase ∈ 'base'|'spike'|'decay'|'basing'|'unknown':
     base    stable / no recent spike (or a spike so old it's the new normal)
     spike   currently elevated well above the pre-spike base, with a recent peak
     decay   pulled back off a recent peak and lows STILL stepping down (still falling)
     basing  pulled back off a recent peak, back near base, and recent lows FLATTENED (the DWH case)
     unknown too few points / no measurable current-or-base level

   ALL thresholds below are NAMED PLACEHOLDERS pending validation — same discipline as the
   rating.mjs grade cutoffs; do NOT cite them as calibrated. */
export const PHASE_CUR_DAYS            = 2;    // window whose median mid = the CURRENT level
export const PHASE_BASE_LOOKBACK_DAYS  = 14;   // points at/older than this = the pre-spike BASE
export const PHASE_PEAK_RECENT_DAYS    = 6;    // a peak within this many days of the series end is "recent"
export const PHASE_RECENT_LOW_DAYS     = 4;    // window over which the daily-low slope is measured
export const PHASE_SPIKE_PCT           = 0.08; // cur ≥ base×(1+this) ⇒ elevated (a spike)
export const PHASE_DECAY_FROM_PEAK_PCT = 0.08; // cur ≤ peak×(1−this) ⇒ pulled back off the peak
export const PHASE_LOW_FLAT_PCT        = 0.02; // |recent daily-low slope| ≤ this ⇒ lows flattened (basing)
export function phase(points){
  const nul={phase:'unknown', curMid:null, baseMid:null, peakMid:null, lowSlope:null};
  if(!points || points.length<2) return nul;
  const mid=p=>(p.avgLowPrice&&p.avgHighPrice)?(p.avgLowPrice+p.avgHighPrice)/2:(p.avgLowPrice||p.avgHighPrice);
  const pts=points.filter(p=>p && p.timestamp!=null && mid(p)!=null).slice().sort((a,b)=>a.timestamp-b.timestamp);
  if(pts.length<2) return nul;
  const tEnd=pts[pts.length-1].timestamp;
  // current level: median mid over the last CUR_DAYS; pre-spike base: median mid over the OLDEST
  // portion (points at/before tEnd − BASE_LOOKBACK_DAYS). Timestamp-window style mirrors regimeDrift.
  const curMid  = med(pts.filter(p=>p.timestamp>=tEnd-PHASE_CUR_DAYS*86400).map(mid));
  const baseMid = med(pts.filter(p=>p.timestamp<=tEnd-PHASE_BASE_LOOKBACK_DAYS*86400).map(mid));
  // peak: max mid over ALL points + its recency (first occurrence wins, so a flat series' "peak" is
  // its oldest point ⇒ not recent ⇒ never mistaken for a spike/decay).
  let peakMid=null, peakTs=tEnd;
  for(const p of pts){ const m=mid(p); if(peakMid==null || m>peakMid){ peakMid=m; peakTs=p.timestamp; } }
  const peakRecent = peakMid!=null && (tEnd-peakTs)<=PHASE_PEAK_RECENT_DAYS*86400;
  // recent daily-low slope: bucket the last RECENT_LOW_DAYS into LOCAL days (repo local-time rule),
  // take each day's MIN avgLowPrice, then the fractional change first-day→last-day. Negative = lows
  // stepping down; ~zero = flattened. null when <2 buckets / no first-day low.
  const lowCut=tEnd-PHASE_RECENT_LOW_DAYS*86400;
  const dayLow=new Map();
  for(const p of pts){
    if(p.timestamp<lowCut || p.avgLowPrice==null) continue;
    const dt=new Date(p.timestamp*1000);
    const key=dt.getFullYear()*10000+(dt.getMonth()+1)*100+dt.getDate();
    const cur=dayLow.get(key);
    if(cur==null || p.avgLowPrice<cur) dayLow.set(key, p.avgLowPrice);
  }
  const keys=[...dayLow.keys()].sort((a,b)=>a-b);
  let lowSlope=null;
  if(keys.length>=2){ const f=dayLow.get(keys[0]), l=dayLow.get(keys[keys.length-1]); if(f>0) lowSlope=(l-f)/f; }
  if(curMid==null || baseMid==null) return {phase:'unknown', curMid, baseMid, peakMid, lowSlope};
  // classify (ordered; each branch defers only on positive evidence)
  const elevated  = curMid >= baseMid*(1+PHASE_SPIKE_PCT);
  let ph;
  if(elevated && peakRecent) ph='spike';
  else {
    const pulledBack = peakRecent && peakMid!=null && curMid <= peakMid*(1-PHASE_DECAY_FROM_PEAK_PCT);
    if(pulledBack && lowSlope!=null && lowSlope < -PHASE_LOW_FLAT_PCT)          ph='decay';
    else if(pulledBack && lowSlope!=null && Math.abs(lowSlope) <= PHASE_LOW_FLAT_PCT) ph='basing';
    else ph='base';
  }
  return {phase:ph, curMid, baseMid, peakMid, lowSlope};
}

/* --- Bar E (Ben 2026-07-10) — robustify the band EDGES so a lone flier print can't set bandHi/bandLo.
   Bar D fixed WHETHER a band gates (density vs two-sidedness); Bar E fixes WHERE its edges sit. The raw
   min/max over the 2h of 5m prints lets ONE outlier (a lone 100k print against a 59k mid) set the edge
   and inflate the surfaced ROI — the "band-top artifact". On a DENSE side (≥ BAND_EDGE_MIN_SAMPLE
   prints) take the p90 high / p10 low instead of the raw extremum; on a SPARSE side keep the extremum,
   because a quantile over a handful of points either equals the max OR wrongly discards the one real
   high — exactly the thin big-ticket class Bar D just admitted (the reach validator backstops the
   residue there; per Ben, Bar E need not be exact — a surfaced outlier gets caught downstream).
   SHARED HOME (Scope B, Ben 2026-07-10): robustBand lives HERE (app+node shared, DOM-free) so BOTH the
   pipeline surfacing path (marketfetch.mjs loadBands re-imports it) AND the app-facing computeQuote
   Optimistic column robustify off the ONE implementation. Two paths stay RAW on purpose:
   marketfetch's loadHistBands (honest historical RECONSTRUCTION for the O1 backtest-join — the real band
   a trade sat in, flier and all) and computeQuote's MOMENTUM tell (rawBandLo/rawBandHi drive `mom`: a
   "fresh 2h high" must fire off the true band max, not the robust p90). All three thresholds are NAMED
   PLACEHOLDERS pending a validation pass (process rule 4). rawBandLo/rawBandHi are retained for audit AND
   for the ask-headroom signal (the FIRST live consumer of the raw residue): when the robust p90 shaved a
   TRADED in-band top, `computeQuote`'s inform-only `askHeadroom` surfaces the discarded upside so the
   operator ladders the ask up instead of relisting down (see the askHeadroom derivation below). That is a
   parallel READ of the raw edge, NOT a fork of the robust-edge rule — the quoted NUMBER still comes from
   the robust band everywhere (the value-niche q15/q85 twin in valueAmplitudeValidator is UNCHANGED and
   must stay so; don't "fix" it to match a misread of this signal). */
export const BAND_EDGE_MIN_SAMPLE = 8;   // < this many prints/side ⇒ raw extremum (a quantile is meaningless)
export const BAND_EDGE_HI_Q = 0.90;      // dense-side high edge quantile (was the raw max)
export const BAND_EDGE_LO_Q = 0.10;      // dense-side low edge quantile  (was the raw min)
// Bar E ask-headroom signal (inform-only; PLAN Bar-E-signal, Ben 2026-07-11). ALL PLACEHOLDERS pending
// F1 RETRO CALIBRATION — n=1 (one Soul rune lot, 566): analyze.mjs joins the ledger `askHeadroom` field
// to realized fills so F1 can measure how often a trusted raw top is actually reached before tuning these
// or graduating the deferred clamp-widen. Do NOT treat them as validated.
export const ASK_HEADROOM_MIN_PCT = 0.005;    // Class-1 materiality floor (0.5%) — a smaller gap isn't worth a ladder note
export const RAWTOP_TRUST_BUCKET_VOL = 50;    // min raw-top 5m-bucket highPriceVolume to TRUST the top traded size (sharper than counting buckets)
export const ASK_HEADROOM_VOL_FLOOR = 2000;   // item-level volDay fallback when bucket volumes are absent (churn scale, cf CHURN_MIN_VOL)
// quantileSorted is the shared type-7 impl defined at the top of this file (SF-1).
export function robustBand(los, his){
  const edge=(vals, q, dir)=>{
    const s=vals.filter(x=>x!=null && x>0).sort((a,b)=>a-b);
    if(!s.length) return {robust:null, raw:null};
    const raw=dir==='hi' ? s[s.length-1] : s[0];
    if(s.length<BAND_EDGE_MIN_SAMPLE) return {robust:raw, raw};   // sparse ⇒ keep the extremum
    return {robust:Math.round(quantileSorted(s, q)), raw};
  };
  const lo=edge(los, BAND_EDGE_LO_Q, 'lo');
  const hi=edge(his, BAND_EDGE_HI_Q, 'hi');
  return {bandLo:lo.robust, bandHi:hi.robust, rawBandLo:lo.raw, rawBandHi:hi.raw};
}

/* Build the full row model for one item from raw fetched inputs (all DOM-free):
     latest : {low, high, ...}         live /latest snapshot (low=instasell, high=instabuy)
     ts5m   : [{avgLowPrice,avgHighPrice,...}]  5m timeseries (last 24 used for the 2h band)
     ts6h   : [{avgLowPrice,avgHighPrice,timestamp}]  6h timeseries (regimeDrift)
     vol24  : {highPriceVolume,lowPriceVolume}   /24h endpoint (limiting-side Vol/d)
     guide  : GE guide price (NOT the wiki mapping value) or null
     limit  : buy limit or null
     held   : Ben holds an open lot (falling-exclusion exception — always shown w/ clear guidance)
     asked  : Ben explicitly loaded/asked this item (same exception) */
export function computeQuote({latest, ts5m, ts6h, vol24, guide, limit, held, asked, now, id}={}){
  const quickBuy  = (latest && latest.low)  || null;   // your BUY fills at the instasell
  const quickSell = (latest && latest.high) || null;   // your SELL fills at the instabuy
  // patient 2h band: last 24×5m points
  const recent=(ts5m||[]).slice(-24);
  const los=recent.map(p=>p.avgLowPrice).filter(Boolean);
  const his=recent.map(p=>p.avgHighPrice).filter(Boolean);
  // Bar E Scope B (2026-07-10): the band edges are SPLIT into two distinct jobs.
  //   • rawBandLo/rawBandHi = the TRUE min/max — drive the momentum tell (a "fresh 2h high" fires off
  //     the real band max) and the row.rawBandLo/rawBandHi audit fields.
  //   • bandLo/bandHi = the ROBUST edges (robustBand: p10 low / p90 high on a DENSE side ≥
  //     BAND_EDGE_MIN_SAMPLE, raw extremum on a SPARSE side) — feed ONLY the Optimistic clamp below, so a
  //     lone flier can't inflate optBuy/optSell (the "band-top artifact"). Sparse bands ⇒ robust==raw.
  const rb=robustBand(los, his);
  const rawBandLo=rb.rawBandLo, rawBandHi=rb.rawBandHi;
  const bandLo=rb.bandLo, bandHi=rb.bandHi;
  // --- GATE 0: quote reliability (PLAN-3, interpretation E; feed-inversion added in Q1) ----
  // Is this reading even a price? A quote is UNRELIABLE if it is stale (a /latest print aged
  // past a print-interval-scaled threshold), inverted (a crossed feed: live instasell above
  // the live instabuy — quoteOrdered() would fail), one-sided (only one side of the 2h band
  // ever printed), or too sparse (fewer than MIN_BAND_WINDOWS populated 5m windows). Everything
  // here comes from the SAME fetches the tick already makes — no new endpoints. lowTime/highTime
  // are unix SECONDS from /latest; `now` is ms (defaults Date.now()) so tests can pin it.
  const nowMs=(now!=null)?now:Date.now();
  const ageMin=t=>(t!=null && Number.isFinite(t))?(nowMs/1000 - t)/60:null;   // null = no timestamp → can't prove stale
  const buyAgeMin=ageMin(latest && latest.lowTime), sellAgeMin=ageMin(latest && latest.highTime);
  const allPop=(ts5m||[]).filter(p=>p.avgLowPrice||p.avgHighPrice).length;   // typical inter-print gap → scale for thin items
  const typicalGapMin=allPop>0?Math.min(360, 5*((ts5m||[]).length)/allPop):STALE_QUOTE_MIN;
  const staleThreshMin=Math.max(STALE_QUOTE_MIN, STALE_INTERVAL_MULT*typicalGapMin);
  const stale=(buyAgeMin!=null && buyAgeMin>staleThreshMin) || (sellAgeMin!=null && sellAgeMin>staleThreshMin);
  const bandTwoSided=los.length>0 && his.length>0;
  const bandPop=recent.filter(p=>p.avgLowPrice||p.avgHighPrice).length;
  // Q1: a crossed/inverted feed (live instasell above the live instabuy) is not a real
  // two-sided price — quoteOrdered() below would fail on it. Gate it here at the SINGLE
  // reliability source so `reliable` is correct for EVERY consumer (momVerdict's Gate 0,
  // watch-positions.mjs's `mom==='breakdown' && reliable`, quote-items.mjs's classify), not just one path.
  const inverted=quickBuy!=null && quickSell!=null && quickBuy>quickSell;
  let reliableReason;
  if(quickSell==null)        reliableReason='no-quote';       // no live instabuy → cannot price a sell/cut
  else if(inverted)          reliableReason='feed-inversion'; // crossed feed (instasell>instabuy) → basis unreliable
  else if(stale)             reliableReason='stale-quote';
  else if(!bandTwoSided)     reliableReason='one-sided-band';
  else if(bandPop<MIN_BAND_WINDOWS) reliableReason='sparse-band';
  else                       reliableReason='ok';
  const reliable=reliableReason==='ok';
  const regime=regimeDrift(ts6h||[]);
  const rl=regimeLabel(regime);
  const falling=rl.falling;
  // --- pre-clamp momentum tell (chunk 6; Bar E split, 2026-07-10) -------------------------
  // The momentum tell uses the TRUE RAW band extremes (rawBandLo/rawBandHi, computed above), NOT the
  // robust p90/p10 that feed the Optimistic clamp — a "fresh 2h high" must fire off the real band max,
  // so Bar E deliberately leaves this signal on the raw edges (byte-identical to pre-Bar-E). The
  // displayed opt prices clamp against the live quote (pricing correctness — never suggest buying above
  // the live market), which ANNIHILATES the signal — so `mom` is derived HERE, from the pre-clamp
  // live-vs-RAW-band comparison, independently of the clamp:
  //   quickBuy  < rawBandLo (live instasell below the 2h floor) → 'breakdown' (↓ active pullback)
  //   quickSell > rawBandHi (live instabuy above the 2h top)    → 'breakup'   (↑ fresh 2h high)
  //   otherwise                                                 → 'clean'     (ranging in-band)
  // Same single basis (live /latest + 2h 5m band from the SAME fetch) ⇒ a break is a real momentum
  // tell, not a base-mixing bug. That bug is guarded SEPARATELY by quoteOrdered() on the clamped
  // prices (row.ordered) — the clamp is not what prevents mixing.
  let mom='clean', momPct=0;
  if(quickBuy!=null && rawBandLo!=null && quickBuy<rawBandLo){ mom='breakdown'; momPct=(rawBandLo-quickBuy)/rawBandLo; }
  else if(quickSell!=null && rawBandHi!=null && quickSell>rawBandHi){ mom='breakup'; momPct=(quickSell-rawBandHi)/rawBandHi; }
  // Optimistic edges = the ROBUST band (bandLo/bandHi, Bar E) CLAMPED to the live quote → optBuy ≤
  // quickBuy and optSell ≥ quickSell ALWAYS (this is the ordering guarantee; single shared basis, no
  // mixing). The robust edges trim a flier out of the surfaced Optimistic ROI at source.
  let optBuy=quickBuy, optSell=quickSell;
  if(quickBuy!=null)  optBuy  = bandLo!=null?Math.min(quickBuy, bandLo):quickBuy;
  if(quickSell!=null) optSell = bandHi!=null?Math.max(quickSell, bandHi):quickSell;
  // Falling regime → price to clear: cap the optimistic sell at the instabuy, never above a
  // dropping market (the 0.20.0 rule). Still bid low on the buy side.
  if(falling && quickSell!=null) optSell=quickSell;
  const mid=(quickBuy!=null&&quickSell!=null)?(quickBuy+quickSell)/2:(quickBuy||quickSell||null);
  const volDay=vol24?Math.min(vol24.highPriceVolume||0, vol24.lowPriceVolume||0):null;
  // --- buy/sell PRESSURE (realized 24h volume imbalance) — zero extra fetch ----------------
  // highPriceVolume = units that transacted at the instabuy side (buyers crossing the spread);
  // lowPriceVolume = units at the instasell side (sellers crossing). hpv/lpv > 1 ⇒ net aggressive
  // BUYING over the window; < 1 ⇒ net aggressive selling. Vol/d deliberately keeps only
  // min(hpv,lpv) (the two-sided-liquidity gate), so the imbalance itself is preserved here.
  // KNOWN SHORTCOMINGS (be honest when citing this number):
  //   • It is REALIZED flow, not the order book — Jagex exposes no resting bid/ask depth, so
  //     "N buyers vs M sellers waiting" is genuinely unavailable; this infers pressure from
  //     which side of the spread trades actually printed on.
  //   • Side attribution is the wiki's price-side heuristic (trade at the high = a buyer
  //     crossing) — a mispriced/instant flip can be attributed to the wrong side.
  //   • It is a TRAILING 24h window: it lags an intraday shift by hours. The Momentum column
  //     (live vs own 2h band, same read) is the LIVE directional tell; pressure is the slower
  //     flow backdrop. Don't read a fresh reversal from it.
  //   • Flip-heavy items trend toward 1.0× by construction (every flip prints once on each side),
  //     so a strong skew on a liquid item is more informative than balance is.
  // Display-only (quote/watch regime+note lines); NOT a gate, verdict, or rating input.
  const hpv=vol24?(vol24.highPriceVolume||0):null, lpv=vol24?(vol24.lowPriceVolume||0):null;
  const pressure={hpv, lpv, ratio:(hpv>0 && lpv>0)?hpv/lpv:null};
  // BOND cost model (the ONE tax exception — see money-math.js): a bond flip's net = sell − (buy + 10%×guide),
  // tax-free. bopt carries that through netMargin for BOTH the quick and optimistic legs; retradeFee is
  // surfaced on the row so downstream (estimators rank, quote note) don't re-derive it. Non-bond → null.
  const bond=isBond(id), retradeFee=bond?bondFee(guide):null;
  const bopt=bond?{bond:true, guide:guide??null}:null;
  const quickNet=(quickSell!=null&&quickBuy!=null)?netMargin(quickBuy,quickSell,bopt):null;
  const optNet  =(optSell!=null&&optBuy!=null)?netMargin(optBuy,optSell,bopt):null;
  const quickRoi=(quickNet!=null&&quickBuy)?quickNet/quickBuy*100:null;
  const optRoi  =(optNet!=null&&optBuy)?optNet/optBuy*100:null;
  // --- Bar E ask-headroom signal (inform-only; PLAN Bar-E-signal) --------------------------
  // "Real demand printed above the number I quoted — laddering is cheap under the GE better-price
  // rule." TWO classes (see the robustBand header):
  //   Class 1 — SHAVE GAP: the robust p90 discarded a TRADED in-band top (rawBandHi > optSell, which
  //     structurally implies a DENSE high side AND mom!=='breakup'). This is the gap the Momentum
  //     column CANNOT show — `mom` is 'clean' because the live print sits inside the raw band. This
  //     block emits the number.
  //   Class 2 — BREAKUP: optSell==quickSell (live print is the top, no in-band evidence above it) —
  //     the upside IS the Momentum 'breakup' tell (mom/momPct), voiced as ladder guidance at the
  //     render/verdict layer, NOT a new number here → askHeadroom stays null (the incident's own case).
  // INFORM-ONLY: never gates, drops, reprices, or grades. Trust = Bar E's density intent made sharper
  // (the raw-top BUCKET's own highPriceVolume — direct evidence the top PRICE traded size — falling
  // back to item volDay). netLever is the "why": near break-even a small gp gap is a large SHARE of
  // the after-tax net (Soul runes: 4gp gap ≈ 2× the 4gp net). All thresholds PLACEHOLDER, F1-routed.
  let askHeadroom=null;
  if(rawBandHi!=null && optSell!=null && rawBandHi>optSell && mom!=='breakup'){
    const gap=rawBandHi-optSell, gapPct=gap/optSell;
    if(gapPct>=ASK_HEADROOM_MIN_PCT){
      let topBucketVol=null;
      for(const p of recent){ if(p && p.avgHighPrice===rawBandHi){ topBucketVol=(p.highPriceVolume||0); break; } }
      const trusted = topBucketVol!=null ? topBucketVol>=RAWTOP_TRUST_BUCKET_VOL
                                         : (volDay!=null && volDay>=ASK_HEADROOM_VOL_FLOOR);
      const netLever=(optNet!=null && optNet>0)?gap/optNet:null;
      askHeadroom={gap, gapPct, rawTop:rawBandHi, topBucketVol, netLever, trusted};
    }
  }
  const row={ quickBuy, quickSell, optBuy, optSell, mid, guide:guide??null, volDay, pressure,
    quickNet, optNet, quickRoi, optRoi, limit:limit??null, bond, retradeFee,
    regime, regimeLabel:rl.label, falling, rising:rl.rising, held:!!held, asked:!!asked,
    mom, momPct, rawBandLo, rawBandHi, askHeadroom,
    reliable, reliableReason, quoteAgeMin:{buy:buyAgeMin, sell:sellAgeMin},
    band:{lo:bandLo, hi:bandHi, n:recent.length} };
  row.ordered=quoteOrdered(row);
  return row;
}
/* Compact display text for row.pressure — the ONE formatter every surface prints from (quote-items.mjs
   regime line, watch-positions.mjs note lines), so the phrasing can't drift. Reads the DOMINANT side:
   `buy 1.4×` = 1.4 units bought aggressively per unit sold aggressively over the trailing 24h;
   `sell 1.3×` = the inverse. Full form appends the raw sides `(hpv 32.1k / lpv 23.0k)`; compact
   form is the bare `buy 1.4×`. Returns null when either side is zero/absent (a one-sided or
   unfetched book has no meaningful ratio — and one-sidedness is already the liquidity gate's job).
   Read the SHORTCOMINGS comment at the derivation in computeQuote before leaning on this number:
   realized trailing-24h flow, not an order book; lags intraday shifts (Momentum is the live tell). */
export function pressureText(pressure, {compact}={}){
  if(!pressure || pressure.ratio==null) return null;
  const r=pressure.ratio, side=r>=1?'buy':'sell', mag=r>=1?r:1/r;
  const head=side+' '+mag.toFixed(1)+'×';
  return compact?head:head+' (hpv '+fmt(pressure.hpv)+' / lpv '+fmt(pressure.lpv)+')';
}

/* Compact display text for row.askHeadroom — the ONE formatter every surface prints from (quote-items.mjs
   read, screen-flip-niches.mjs note block, renderHeldVerdict), so the phrasing can't drift. INFORM-ONLY prose:
   the robust p90 shaved a TRADED in-band top off the quoted Optimistic ask; laddering up is cheap
   under the GE better-price rule (a list at the quoted number already fills at the best standing bid).
   Returns null unless there is a TRUSTED Class-1 gap (untrusted gaps are logged for F1, not surfaced).
   Returns the BODY only (each surface adds its own `⤴ ask headroom:` / `⤴ ask headroom — <item>:` label,
   mirroring how screen labels the `ℹ trajectory/reach` notes). Body shape: `raw top 397 traded (1.2k u)
   above the quoted ask 393 — +4/u ≈ 2.0× the quoted net; ladder the ask, don't relist down`. netLever is
   stated because near break-even the gp gap is a large SHARE of the after-tax net — that ratio, not the
   raw %, is why it matters. PLACEHOLDER thresholds. */
export function askHeadroomText(row){
  const h=row && row.askHeadroom;
  if(!h || !h.trusted) return null;
  const lever=(h.netLever!=null)?` ≈ ${h.netLever.toFixed(1)}× the quoted net`:'';
  const vol=(h.topBucketVol!=null)?` traded (${fmt(h.topBucketVol)} u)`:'';
  return `raw top ${fmt(h.rawTop)}${vol} above the quoted ask ${fmt(row.optSell)} — +${fmt(h.gap)}/u${lever}; ladder the ask, don't relist down (inform-only, n=1)`;
}

/* the ordering INVARIANT as a testable predicate (chunk-2 acceptance asserts this on fixtures) */
export function quoteOrdered(row){
  return !!row && row.quickBuy!=null && row.quickSell!=null &&
    row.optBuy<=row.quickBuy && row.quickBuy<=row.quickSell && row.quickSell<=row.optSell;
}

/* --- GATE 1: diurnal liquidity-trough read (PLAN-3, interpretation A) ---------------------
   From the FULL ~30h 5m series (callers pass the WHOLE series — do NOT pre-slice): is the
   current 2h window a quiet liquidity trough that the same clock window dipped into ~24h ago
   and then recovered from? Compares current-2h activity vs the series' median 2h activity, and
   yesterday's same-clock band low + the recovery since. Zero extra fetches. now = ms (default
   Date.now()). Returns {quiet, yesterdayDipped, yesterdayRecovered, activityRatio}. */
export function diurnalRead(ts5m, now){
  const nul={quiet:false, yesterdayDipped:false, yesterdayRecovered:false, activityRatio:null};
  const s=(ts5m||[]).filter(p=>p && p.timestamp!=null).slice().sort((a,b)=>a.timestamp-b.timestamp);
  if(s.length<24) return nul;
  const nowSec=((now!=null)?now:Date.now())/1000, H=3600;
  const act=p=>(p.lowPriceVolume||0)+(p.highPriceVolume||0);
  const winAct=(lo,hi)=>{ let sum=0, any=false; for(const p of s){ if(p.timestamp>lo && p.timestamp<=hi){ sum+=act(p); any=true; } } return any?sum:null; };
  const curAct=winAct(nowSec-2*H, nowSec)||0;
  const blocks=[]; for(let hi=nowSec; hi>s[0].timestamp; hi-=2*H){ const a=winAct(hi-2*H, hi); if(a!=null) blocks.push(a); }
  const medAct=med(blocks)||0;
  const activityRatio=medAct>0?curAct/medAct:null;
  const quiet=activityRatio!=null && activityRatio<QUIET_RATIO;
  // yesterday's same-clock 2h window, and the interim between it and now
  const yWin=s.filter(p=>p.timestamp>nowSec-26*H && p.timestamp<=nowSec-24*H);
  const interim=s.filter(p=>p.timestamp>nowSec-24*H && p.timestamp<=nowSec-2*H);
  const yLows=yWin.map(p=>p.avgLowPrice).filter(Boolean);
  const yDipLow=yLows.length?Math.min(...yLows):null;
  const medLow=med(s.map(p=>p.avgLowPrice).filter(Boolean));
  const yesterdayDipped=yDipLow!=null && medLow!=null && yDipLow<=medLow*(1-DIURNAL_DIP_MARGIN);
  const iHis=interim.map(p=>p.avgHighPrice).filter(Boolean);
  const interimHigh=iHis.length?Math.max(...iHis):null;
  const yesterdayRecovered=yDipLow!=null && interimHigh!=null && interimHigh>=yDipLow*(1+DIURNAL_RECOVER_MARGIN);
  return {quiet, yesterdayDipped, yesterdayRecovered, activityRatio};
}
/* --- D-escalation: stateless underwater persistence (PLAN-3, interpretation D) -------------
   How many contiguous hours (from the series end) has avgHighPrice printed below break-even,
   and did that span cover a liquid (≥ median-activity) window? Underwater THROUGH a liquid
   peak defeats the diurnal defense (a real daily trough recovers when the book fills), so it
   escalates the WATCH-forever case to a cut. No tick-to-tick memory. */
export function underwaterHours(ts5m, breakEvenPrice){
  const s=(ts5m||[]).filter(p=>p && p.timestamp!=null && p.avgHighPrice).slice().sort((a,b)=>a.timestamp-b.timestamp);
  if(!s.length || breakEvenPrice==null) return {hours:0, coveredLiquidPeak:false};
  if(s[s.length-1].avgHighPrice>=breakEvenPrice) return {hours:0, coveredLiquidPeak:false};   // not underwater by the band now
  const act=p=>(p.lowPriceVolume||0)+(p.highPriceVolume||0);
  const medAct=med(s.map(act))||0;
  const endTs=s[s.length-1].timestamp; let startTs=endTs, coveredLiquidPeak=false;
  for(let i=s.length-1; i>=0; i--){
    if(s[i].avgHighPrice<breakEvenPrice){ startTs=s[i].timestamp; if(medAct>0 && act(s[i])>=medAct) coveredLiquidPeak=true; }
    else break;
  }
  return {hours:(endTs-startTs)/3600, coveredLiquidPeak};
}
/* --- GATE 2: shock vs bleed shape of the last-2h down-move (PLAN-3, interpretations B/C) ---
   'shock'     = drop concentrated in ≤ SHOCK_MAX_NEWLOWS new-low windows on a volume spike,
                 then stabilized (a one-off dump exhausting) → mean-reverts.
   'bleed'     = ≥ BLEED_MIN_NEWLOWS distributed lower-lows still at the lows (repricing).
   'ambiguous' = neither → the positive-evidence rule falls it through to the cut discipline. */
export function moveShape(ts5m){
  const recent=(ts5m||[]).slice(-24).filter(p=>p && p.avgLowPrice);
  if(recent.length<4) return 'ambiguous';
  const lows=recent.map(p=>p.avgLowPrice);
  const vols=recent.map(p=>(p.lowPriceVolume||0)+(p.highPriceVolume||0));
  let runMin=lows[0], newLows=0;
  for(let k=1;k<lows.length;k++){ if(lows[k]<runMin){ runMin=lows[k]; newLows++; } }
  const troughIdx=lows.indexOf(Math.min(...lows)), minLow=lows[troughIdx], endLow=lows[lows.length-1];
  const medVol=med(vols)||0, maxVol=Math.max(...vols);
  const spike=medVol>0 && maxVol>=VOL_SPIKE_MULT*medVol;
  const stabilized=troughIdx<=lows.length-3;   // trough ≥2 windows before the end → no fresh low since
  if(newLows<=SHOCK_MAX_NEWLOWS && spike && stabilized) return 'shock';
  if(newLows>=BLEED_MIN_NEWLOWS && endLow<=minLow*1.005) return 'bleed';
  return 'ambiguous';
}

/* --- cut-trigger overlay = the PLAN-3 underwater decision tree (was chunk-6 momVerdict) -----
   A HELD position's precise 2h read modifies the HOLD / list-at / CUT verdict. This is the ONE
   shared implementation — js/trends.js reviewPositions, pipeline/commands/quote-items.mjs --positions, and
   pipeline/commands/watch-positions.mjs all call it, so the matrix can't drift between app and scripts.

   Gate order (each gate defers ONLY on positive evidence; ambiguity falls through to the cut
   discipline, so the real bludgeon-style breakdown still cuts exactly as before):
     GATE 0  unreliable/missing/inverted quote → NO_READ (a missing/crossed feed must NEVER → CUT)
     GATE 1  underwater + quiet diurnal trough that dipped+recovered yesterday → DIURNAL_WATCH
     GATE 2  mom breakup                      → HOLD_STRONG
             mom breakdown, small-lot shock   → SHOCK_WATCH (one more cycle)
             mom breakdown otherwise          → CUT / HOLD_WATCH / CLEAR (unchanged matrix)
     D-esc.  mom clean but underwater through a liquid window → CUT-CANDIDATE, UNLESS lotCtx
             softens it (V3): a lot bought <FRESH_HOURS ago → WATCH — fresh entry; an own ask
             actively filling above the clear price → HOLD — ask filling. These softenings apply
             ONLY to this Gate-D CUT-CANDIDATE; they NEVER reach the Gate-2 breakdown CUT above,
             so the byte-identical breakdown-cut invariant holds (V3 regression fixture proves it).
     else    null → caller keeps its existing regime-based verdict
   Params: row (a computeQuote row — needs .mom/.quickSell/.rawBandHi/.optSell/.rising/.reliable/.ordered),
   breakEvenPrice = breakEven(avgCost) (tax-capped; see the breakEven definition above),
   lotValue = qty×avgCost (vs BIG_TICKET_GP). ts5m/now are
   optional — pass the full 5m series (and now, ms) to activate Gates 1/2-shape/D; without them
   the tree degrades to Gate 0 + the original breakdown matrix. lotCtx (V3) is optional too —
   { buyTs (unix SECONDS the lot was bought), askFilling (bool: the held lot's own ask is
   transacting above the clear price),
     path (P4a, OPTIONAL: the js/held-item-strategy.mjs dominant path key this lot is being held under —
       'value-hold'/'hold-recovery'/'cut'/… ) } — when omitted, momVerdict is IDENTICAL to before
   (the ts5m/now optional-degradation precedent), so every existing caller is unaffected.
   P4a NOTE: `path` is PLUMBED THROUGH ONLY — NO gate reads it yet, so a lotCtx that carries a path
   yields a BYTE-IDENTICAL verdict to one that omits it (pinned in quotecore.test.mjs "P4a" fixture).
   Wiring a verdict to the dominant path is P4b/P5 work, deliberately not done here. Returns null
   or { action, verdict, listAt, cls, gate, why }; listAt is a price or null (HOLD, no reprice). */
export function momVerdict(row, breakEvenPrice, lotValue, ts5m, now, lotCtx){
  if(!row) return null;
  const instabuy=row.quickSell;   // clear-now price (live instabuy)
  // GATE 0 — is this reading even a price? An unreliable quote yields NO price action, and a
  // MISSING instabuy must never produce CUT (the old bug: null instabuy → most aggressive verdict).
  // `reliable===false` is the primary signal (computeQuote folds in stale/one-sided/sparse AND
  // the Q1 feed-inversion case); `ordered===false` is a belt-and-suspenders re-check of the
  // ordering invariant at the decision point, so a crossed feed can never print a decisive
  // verdict regardless of how the row was constructed (Q1 — the footnoted-CUT-CANDIDATE bug).
  if(instabuy==null || row.reliable===false || row.ordered===false){
    const reason=(row.reliableReason && row.reliableReason!=='ok')?row.reliableReason:(instabuy==null?'no-quote':'feed-inversion');
    return {action:'NO_READ', verdict:'NO-READ', listAt:null, cls:'mini', gate:0,
      why:'quote not reliable ('+reason+') — '+(instabuy==null?'no live instabuy to price against':'the feed is stale, inverted, one-sided, or too sparse to trust')+'. No price action off this read; keep any resting ask ≥ break-even'+(breakEvenPrice!=null?' ('+fmtP(breakEvenPrice)+')':'')+' and re-check at the next liquid window.'};
  }
  const underwater = breakEvenPrice!=null && instabuy<breakEvenPrice;
  // GATE 1 — is it the clock? Only when underwater: a quiet trough the same window dipped into
  // and recovered from yesterday → hold, don't cut into the thinnest book. Spent statelessly —
  // once THIS window is liquid (not quiet) and still underwater, the check no longer fires and
  // we fall through to Gate 2 (the diurnal defense is "one use per episode").
  if(underwater && ts5m){
    const d=diurnalRead(ts5m, now);
    if(d.quiet && d.yesterdayDipped && d.yesterdayRecovered){
      return {action:'DIURNAL_WATCH', verdict:'DIURNAL-WATCH', listAt:breakEvenPrice, cls:'gold', gate:1,
        why:'underwater at a quiet hour (2h activity '+(d.activityRatio!=null?Math.round(d.activityRatio*100)+'% of typical':'well below typical')+'); the same clock window dipped and recovered yesterday. Hold the ask ≥ break-even'+(breakEvenPrice!=null?' ('+fmtP(breakEvenPrice)+')':'')+' — do NOT cut into the trough. If still underwater at the next liquid window, this defense is spent → re-assess.'};
    }
  }
  // GATE 2 — momentum. breakup first (unchanged).
  if(row.mom==='breakup'){
    const listAt=(row.optSell!=null)?row.optSell:instabuy;   // the 2h top
    return {action:'HOLD_STRONG', verdict:'HOLD — list high', listAt, cls:'gain', gate:2,
      why:'2h breakup — the live instabuy ('+fmtP(instabuy)+') has pushed above the 2h top ('+fmtP(row.rawBandHi)+'). Be patient on the sell and list at the 2h top ('+fmtP(listAt)+'); don’t sell into strength.'};
  }
  if(row.mom==='breakdown'){
    // shape: a small-lot one-off shock (a seller exhausting) on an intact regime earns ONE more
    // cycle; a bleed, a big-ticket lot, or an ambiguous shape falls straight through to the
    // cut matrix (positive-evidence rule — only a matched shock defers).
    const big = lotValue!=null && lotValue>=BIG_TICKET_GP;
    if(ts5m && !big && !row.falling && moveShape(ts5m)==='shock'){
      return {action:'SHOCK_WATCH', verdict:'SHOCK-WATCH', listAt:underwater?breakEvenPrice:instabuy, cls:'gold', gate:2,
        why:'2h breakdown, but the shape is a one-off shock (a volume-spike gap that then stabilized) on a sub-'+(BIG_TICKET_GP/1e6)+'m lot with an intact regime — likely a single seller exhausting. Hold one more cycle'+(underwater?' at break-even ('+fmtP(breakEvenPrice)+')':'')+'; a fresh low next tick makes it a bleed → cut.'};
    }
    // --- original breakdown matrix (outputs byte-identical to pre-PLAN-3) ---
    if(underwater){
      return {action:'CUT', verdict:'CUT', listAt:instabuy, cls:'loss', gate:2,
        why:'2h breakdown while underwater (live sell '+fmtP(instabuy)+' < break-even '+fmtP(breakEvenPrice)+') — the 2h break leads the multi-day regime, so cut at the instabuy now to free the capital rather than wait for the slower regime to confirm.'};
    }
    if(row.rising && !big){
      // a lone 2h dip on a small lot against a real uptrend is usually noise
      return {action:'HOLD_WATCH', verdict:'HOLD — watch', listAt:null, cls:'gold', gate:2,
        why:'2h pullback vs an uptrend on a sub-'+(BIG_TICKET_GP/1e6)+'m lot — a lone 2h dip against a rising regime is usually noise. HOLD and watch, it may reabsorb.'};
    }
    // breakdown + in profit + (flat/falling regime) OR (rising but big-ticket) → clear now
    const why = row.rising
      ? '2h breakdown against a rising regime, but this is a big-ticket lot (≥ '+(BIG_TICKET_GP/1e6)+'m at risk) → clearing: list at the instabuy ('+fmtP(instabuy)+'). The downside of a real drop on a large position outweighs the patient premium.'
      : '2h breakdown, in profit, flat/falling regime — list to clear at the instabuy ('+fmtP(instabuy)+') and bank it; don’t hold for the patient premium into a weakening market.';
    return {action:'CLEAR', verdict:'LIST-TO-CLEAR', listAt:instabuy, cls:'amber', gate:2, why};
  }
  // mom === 'clean' — no live 2h break. D-escalation: underwater THROUGH a liquid peak is
  // persistence, not the clock (a genuine daily trough recovers when the book fills) → cut.
  if(underwater && ts5m){
    const uw=underwaterHours(ts5m, breakEvenPrice);
    if(uw.coveredLiquidPeak){
      // V3 — lot-context softening, applied ONLY to this Gate-D clean-momentum persistence cut
      // (mom==='clean', so the mom==='breakdown' CUT above is never reached from here — the
      // byte-identical breakdown invariant is structurally preserved). Both branches downgrade
      // to a HOLD/WATCH; neither is an alert.
      const askFilling=!!(lotCtx && lotCtx.askFilling);
      const buyTs=lotCtx && lotCtx.buyTs;
      const nowMs2=(now!=null)?now:Date.now();
      // (1) fill-progress beats repricing down: an own ask actively transacting ABOVE the clear
      //     price is already exiting better than the instant-clear — hold it, don't reprice down.
      if(askFilling){
        return {action:'HOLD_FILLING', verdict:'HOLD — ask filling', listAt:breakEvenPrice, cls:'gain', gate:'D',
          why:'the band has printed below break-even for ~'+uw.hours.toFixed(1)+'h including a liquid window, but your own ask is actively filling ABOVE the clear price ('+fmtP(instabuy)+') — an ask transacting above the clear beats repricing down. Hold it and let the ask keep filling; don’t chase the price down.'};
      }
      // (2) entry-age: a fresh patient fill is definitionally underwater on the instant-clear
      //     price and hasn't had its thesis window — the persistence-cut's "would have recovered
      //     by now" is minutes here, not evidence. Give it the window; keep the ask ≥ break-even.
      if(buyTs!=null && (nowMs2 - buyTs*1000) < FRESH_HOURS*3600*1000){
        return {action:'HOLD_FRESH', verdict:'WATCH — fresh entry', listAt:breakEvenPrice, cls:'gold', gate:'D',
          why:'the band has printed below break-even for ~'+uw.hours.toFixed(1)+'h including a liquid window, but this lot was bought under '+FRESH_HOURS+'h ago — a fresh patient fill is definitionally underwater on the instant-clear price, and its thesis window hasn’t elapsed. Hold the ask ≥ break-even ('+fmtP(breakEvenPrice)+') and re-assess once it has had time to work; do NOT cut a brand-new fill on the instant read.'};
      }
      return {action:'CUT', verdict:'CUT-CANDIDATE', listAt:instabuy, cls:'loss', gate:'D',
        why:'no live 2h break, but the band has printed below break-even for ~'+uw.hours.toFixed(1)+'h including a liquid (busy-hour) window — a genuine daily trough would have recovered when the book filled. This is persistence, not the clock: list to clear at the instabuy ('+fmtP(instabuy)+').'};
    }
  }
  return null;   // clean, reliable, not escalated → caller keeps its existing regime verdict
}

/* Shared BUY-OFFER (resting bid) verdict — the ONE decision pipeline/commands/watch-positions.mjs (console) and the
   in-app Watch tab both consume, so a resting bid reads IDENTICALLY in both (the momVerdict
   precedent, extracted from watch-positions.mjs's inline bidVerdict by the Watch-tab build). Pure:
   (row, offerPrice) → one of 'CANCEL-BID' | 'NO-QUOTE' | 'CROSSING' | 'BID-BEHIND' | 'BID-OK'.
   Gate ORDER is load-bearing and matches watch-positions.mjs's original inline logic exactly:
     CANCEL-BID  falling regime OR a reliable 2h breakdown → a fill here is adverse selection
     NO-QUOTE    no live instasell to judge the bid against
     CROSSING    bid ≥ live instasell → expect fills about now
     BID-BEHIND  bid below the 2h band low → unlikely to fill soon
     BID-OK      resting inside the band
   Only CANCEL-BID is an ALERT (the sole state where a resting order needs action); the rest are
   placement feedback. Fixture-pinned in pipeline/test/watchcore.test.mjs.

   P5 — PATH-AWARE (OPTIONAL third arg). `pathCtx` is the DECLARED thesis this resting bid was placed
   under: a bare path key ('scalp' / 'value-hold', the js/held-item-strategy.mjs PATH_KEYS values) OR an object
   { path, tripwire }. It is OPTIONAL and DEGRADES: when omitted (undefined/null), offerVerdict is
   BYTE-IDENTICAL to the pre-P5 gate — so the deployed app Watch tab, which calls
   offerVerdict(row, offerPrice), is unaffected (the ts5m/now optional-degradation precedent; pinned
   in watchcore.test.mjs). Path-awareness encodes Ben's 2026-07-08 falling amendment: a bid placed
   under a DELIBERATE thesis EXPECTS a soft/declining tape, so the falling REGIME alone no longer
   auto-cancels it — only the thesis's OWN structural tripwire does:
     scalp       — flip-only intraday: falling is the thesis (not a cancel); it still CANCEL-BIDs on
                   its own tripwire, a live reliable 2h breakdown (the intraday band collapsing under
                   the entry = the hard-stop trigger).
     value-hold  — buy near a durable multi-week floor and hold through froth: neither a falling
                   regime nor a 2h breakdown cancels; ONLY price breaking below the declared floor
                   `tripwire` (when supplied) does.
   Ben's memory anchor (patience-on-cancel-and-cut / falling-exclusion-amended): "no CANCEL-BID off
   falling regime alone for a deliberate scalp/value thesis." Every scalp/value threshold here is
   provisional (n≈0). NOTE: quotecore.js imports only money-math.js + money-format.js — the path keys are compared as string
   literals (the frozen js/held-item-strategy.mjs PATH_KEYS values) to keep that single-import invariant. */
export function offerVerdict(row, offerPrice, pathCtx){
  if(!row) return 'NO-QUOTE';
  const path = (pathCtx && typeof pathCtx==='object') ? pathCtx.path : pathCtx;
  const liveBreak = row.mom==='breakdown' && row.reliable;   // the live 2h break — the intraday tripwire
  if(path==='scalp'){
    if(liveBreak) return 'CANCEL-BID';                       // band collapsing NOW → the scalp hard stop
  } else if(path==='value-hold'){
    const tw = (pathCtx && typeof pathCtx==='object') ? pathCtx.tripwire : null;
    if(tw!=null && row.quickBuy!=null && row.quickBuy < tw) return 'CANCEL-BID';   // floor broken → thesis dead
  } else if(row.falling || liveBreak) return 'CANCEL-BID';   // path-less: the pre-P5 behavior (pinned byte-identical)
  if(row.quickBuy==null) return 'NO-QUOTE';
  if(offerPrice>=row.quickBuy) return 'CROSSING';
  if(row.optBuy!=null && offerPrice<row.optBuy) return 'BID-BEHIND';
  return 'BID-OK';
}

/* Canonical formatted cells — the SINGLE source both the app HTML table (js/quote.js) and the
   chunk-3 markdown scripts build from, so the numbers are byte-identical everywhere.
   T1 (table v2): the composite Buy@/Sell@/Net columns collapsed into two SELF-CONTAINED
   columns — Quick and Optimistic — each carrying its own `buy → sell · net (ROI)`; Mid is
   dropped from the table (it's just the 24h-avg midpoint, redundant next to Guide + live
   prices — the model still exposes row.mid for rating.mjs/watch-positions.mjs). quoteCells now returns
   an ORDERED ARRAY of structured cells `{t, c}` (t = plain text for markdown/cellText; c =
   optional css class, app-only color). cellText() derives the exact markdown string the
   scripts print, so stdout stays plain while the app colors gain/loss + momentum. */
export const QUOTE_HEADERS=['Item','Guide','Quick','Optimistic','Vol/d','Momentum','Regime'];
// Momentum strength — at/above this fraction of overshoot BEYOND the item's own 2h band edge
// (row.momPct = (bandEdge−livePrice)/bandEdge, set pre-clamp in computeQuote) a break is
// "strong" → a double arrow (↓↓ / ↑↑); below it a single arrow. Named + tunable.
export const MOM_STRONG_PCT=0.02;   // ≥2% past the band edge = a strong break
// Momentum display token {sym, cls} from the categorical `mom` (unchanged — momVerdict/cut-trigger
// still consume `mom`) + its pre-clamp overshoot fraction. clean → '–' muted; single arrow amber;
// strong break → ↓↓ loss(red) / ↑↑ gain(green). Same symbols in markdown + app (color app-only).
export function momCell(mom, momPct){
  const p=momPct||0;
  if(mom==='breakdown') return p>=MOM_STRONG_PCT?{sym:'↓↓',cls:'loss'}:{sym:'↓',cls:'amber'};
  if(mom==='breakup')   return p>=MOM_STRONG_PCT?{sym:'↑↑',cls:'gain'}:{sym:'↑',cls:'amber'};
  return {sym:'–',cls:'mommuted'};
}
// signed price / roi for the composite cells (fmtP already renders a leading '-' for negatives)
const sfmtP=n=>n==null?'—':((n>0?'+':'')+fmtP(n));
const roiStr=r=>r==null?'—':((r>=0?'+':'')+r.toFixed(1)+'%');
// pull the plain markdown text out of a structured cell (or a bare string) — the ONE place the
// script stdout and the app HTML agree on what a cell says.
export const cellText=c=>(c && typeof c==='object' && 't' in c)?c.t:c;
export function quoteCells(name, row){
  // one self-contained transact-basis cell: "buy → sell · +net (roi)", colored by net sign
  const composite=(buy,sell,net,roi)=>({
    t: fmtP(buy)+' → '+fmtP(sell)+' · '+sfmtP(net)+' ('+roiStr(roi)+')',
    c: net==null?undefined:(net>=0?'gain':'loss')
  });
  const m=momCell(row.mom, row.momPct);
  return [
    {t:name},
    {t:row.guide!=null?fmtP(row.guide):'—'},
    composite(row.quickBuy, row.quickSell, row.quickNet, row.quickRoi),
    composite(row.optBuy,   row.optSell,   row.optNet,   row.optRoi),
    {t:row.volDay!=null?fmt(row.volDay)+'/d':'—', c:'mini'},
    {t:m.sym, c:m.cls},
    {t:(row.regime&&row.regime.ok)?(cap(row.regimeLabel)+' '+(row.regime.driftPct>=0?'+':'')+row.regime.driftPct.toFixed(0)+'%'):'—'}
  ];
}
/* NOTE: a fixed-column quoteMarkdown() helper was removed by A1 (dead — quote-items.mjs/screen-flip-niches.mjs
   both APPEND columns and share pipeline/cli.mjs's mdTable + stdCells split instead). The
   structured quoteCells/cellText split above is the real shared table API. */

/* ============================================================================================
   S2 — POSTURE HELPERS (overnight vs active screening). A SEPARATE, appended block: these are new,
   independently-named pure helpers and do NOT touch momVerdict / the PLAN-3 gate tree. They reuse
   the same 5m-series + DIURNAL_DIP_MARGIN machinery as diurnalRead. Fixture-tested in
   pipeline/test/quotecore.test.mjs under the "S2 posture fixtures" header.
   ============================================================================================ */
// The overnight window is LOCAL wall-clock: an evening bid must survive unattended to morning.
export const OVERNIGHT_START_HOUR = 22;   // local hour, inclusive
export const OVERNIGHT_END_HOUR   = 6;    // local hour, exclusive
export const OVERNIGHT_SPAN_H     = 8;    // the forward window an overnight bid rests through
// Is `now` (ms, default Date.now()) inside the local overnight window? Wraps midnight. `--posture auto`
// on screen-flip-niches.mjs uses this; all displayed clocks are LOCAL (CLAUDE.md local-time rule).
export function isOvernightNow(now){
  const h=new Date(now!=null?now:Date.now()).getHours();
  return h>=OVERNIGHT_START_HOUR || h<OVERNIGHT_END_HOUR;
}
// Overnight staleness risk for a BUY bid placed now: did YESTERDAY's equivalent forward-8h overnight
// span (the [now-24h, now-16h] slice) print a low materially (≥ marginPct) BELOW `bid`? If so, a fill
// at `bid` tonight risks being underwater / above-market by morning (the price drifted below the bid
// last night, likely again) — the "stale/underwater by morning" test S2's overnight posture excludes on.
// Positive-evidence discipline: null bid, <24 pts, or no yesterday-window data → false (never exclude
// on ABSENCE of proof; one prior night is one sample anyway). now = ms (default Date.now()).
export function overnightStaleRisk(ts5m, bid, now, marginPct=DIURNAL_DIP_MARGIN){
  if(bid==null) return false;
  const s=(ts5m||[]).filter(p=>p && p.timestamp!=null && p.avgLowPrice).slice().sort((a,b)=>a.timestamp-b.timestamp);
  if(s.length<24) return false;
  const nowSec=((now!=null)?now:Date.now())/1000, H=3600;
  const win=s.filter(p=>p.timestamp>nowSec-24*H && p.timestamp<=nowSec-(24-OVERNIGHT_SPAN_H)*H);
  const lows=win.map(p=>p.avgLowPrice).filter(Boolean);
  if(!lows.length) return false;
  return Math.min(...lows) <= bid*(1-marginPct);
}

/* ============================================================================================
   COD-3 (2026-07-10) — CUT-AND-REBID advisory. A SEPARATE appended block of pure, DOM-free helpers
   (quotecore.js imports only money-math.js + money-format.js — kept that way): they do NOT touch momVerdict / the gate tree.
   Fixture-pinned in pipeline/test/rebid.test.mjs.
   ============================================================================================ */

/* rebidBar(clear, spread) — the cut-and-rebid FRICTION BAR (was prose arithmetic in /positions §3).
   A cut paired with a deeper re-entry bid is a legit two-leg, BUT each sell pays the 2% GE tax, so the
   rebid only BEATS holding if it sits more than (tax + half the spread) below the clear price (~2.5%+).
   This is the ONE encoded home for that math so the agent stops re-deriving it.
     clear   the price you'd clear at now (the live instabuy).
     spread  the live bid/ask spread (instabuy − instasell); 0 if unknown.
   Returns { threshold, friction, marginPct } — `threshold` = the price a rebid must sit AT OR BELOW to
   clear the bar; `friction` = the gp it must beat (tax re-paid on the eventual resale at the clear + half
   the crossed spread); `marginPct` = friction as a % of the clear (the ~2.5% figure). clear==null → null.
   PURE arithmetic — this half is SOLID (not placeholder); it's the trajectory/diurnal awareness in
   rebidAdvice that is inform-grade. */
export function rebidBar(clear, spread=0){
  if(clear==null) return null;
  const halfSpread=Math.max(0, spread||0)/2;
  const friction=tax(clear)+halfSpread;                 // re-paid tax at the clear + half the crossed spread
  const threshold=clear-friction;
  return { threshold, friction, marginPct: clear>0 ? friction/clear*100 : null };
}

/* rebidAdvice({ clear, spread, trajectory, diurnal }) — the TRAJECTORY/PROJECTION-AWARE rebid advisory
   (Ben 2026-07-10). "Should I rebid?" is not just the friction bar — it depends on whether the item
   turned into a KNIFE (keeps falling) or is FALLING-BUT-OSCILLATING (bounces back at the daily high).
   Wires the EXISTING read tools (NO forecast is built here — that's PLAN-FORECAST.md PF1):
     trajectory   a classifyTrajectory result (js/termstructure.mjs — { shape, … }); null → unknown.
     diurnal      a deriveDiurnalRange result (js/windowread.mjs — { bid, ask, … }); null → no levels.
   INFORM-GRADE (rule 4): the classifier + diurnal read are PLACEHOLDER / n≈0, so this SUPPORTS the
   decision — it NEVER auto-cancels or auto-rebids. Branches:
     knife       → advise AGAINST a rebid (it keeps falling; the friction bar is moot). rebid=false.
     oscillating → a rebid is viable: target the projected TROUGH (diurnal dip) and sell the daily PEAK
                   (diurnal peak) — the "falling but bounces back at the daily high" case. rebid=true.
     else        → the friction-bar arithmetic governs. rebid=null (the bar decides per the numbers).
   FORWARD HOOK (PF1): when the forecast module lands, upgrade the qualitative "bounces back at the daily
   high" to a QUANTITATIVE projected-peak { level, eta } + a projected-trough rebid level. Build the
   qualitative version now; do NOT block on the forecast.
   Returns { rebid, kind, bar, troughTarget, peakTarget, why }. PURE. */
export function rebidAdvice({ clear=null, spread=0, trajectory=null, diurnal=null }={}){
  const bar=rebidBar(clear, spread);
  const shape=trajectory && trajectory.shape;
  const barTxt=bar
    ? `sit at/below ${fmtP(bar.threshold)} (${bar.marginPct!=null?bar.marginPct.toFixed(1)+'%':'tax+½-spread'} below the clear${clear!=null?' '+fmtP(clear):''})`
    : 'have a clear price to bar against';
  if(shape==='knife'){
    return { rebid:false, kind:'knife', bar, troughTarget:null, peakTarget:null,
      why:`trajectory is a KNIFE (spike + monotone-down lows) — it keeps falling, so the friction bar is moot: do NOT rebid; clear and redeploy the freed capital.` };
  }
  if(shape==='oscillating'){
    const trough=diurnal && diurnal.bid!=null ? diurnal.bid : null;
    const peak=diurnal && diurnal.ask!=null ? diurnal.ask : null;
    return { rebid:true, kind:'oscillating', bar, troughTarget:trough, peakTarget:peak,
      why:`trajectory OSCILLATES (falling but bounces back at the daily high) — a rebid is viable: target the projected trough${trough!=null?' '+fmtP(trough):' (diurnal dip)'} and sell the daily peak${peak!=null?' '+fmtP(peak):' (diurnal peak)'}. PF1 will later replace this qualitative peak with a projected {level, eta}.` };
  }
  return { rebid:null, kind:'friction', bar, troughTarget:null, peakTarget:null,
    why: bar ? `friction bar governs: a rebid only beats holding if it ${barTxt}.` : `no clear price to bar a rebid against.` };
}

/* ============================================================================================
   DP1 (2026-07-10) — recentDirection: dip DIRECTION, not just depth. A SEPARATE appended block of
   pure, DOM-free 5m-shape math (quotecore.js imports only money-math.js + money-format.js — kept that way); it does NOT
   touch momVerdict / the gate tree. Fixture-pinned in pipeline/test/dipposture.test.mjs.

   WHY IT LIVES HERE. quotecore.js is the existing home for the 5m intraday-shape reads (bandCore,
   diurnalRead, overnightStaleRisk) — its natural neighbours. The 1h series is too coarse for this
   read (2–4 points over a ~3h lookback); the 5m /timeseries is the right resolution.

   THE MECHANIC (this is the dipPostureValidator DOCTRINE HOME). A RESTING BID only fills while price
   is still coming DOWN to it — a seller has to cross the spread down to your bid. Once a dip REVERTS
   (bounces off its low and runs away up) no seller crosses down, so the bid just sits there MISSING.
   A reverting dip is therefore a cross-the-spread-NOW-or-pass decision, not a rest-a-bid decision.
   The ⬇DIP probe (pipeline/modules/dip.mjs) captures DEPTH (live under the 24h avg low); this
   captures DIRECTION (is the dip still falling, or has it already bounced?). The two are orthogonal.
   ANCHOR INCIDENTS (n=2 — be honest, this is NOT a validated edge): a Searing-page resting bid
   @16,014 on a real dip that had ALREADY reverted (bounced to 16,249+ and ran away), and an
   Abyssal-bludgeon bid @16.15m on a ~83/day item that never filled — a reverting dip means no
   seller crosses down to you.

   HONESTY (process rule 4). Every threshold below is a NAMED PLACEHOLDER pending data — n=2, none
   validated. What WOULD validate them: retro-joining dip-posture firings against fills.json — does a
   'reverting' read actually correlate with a resting bid MISSING, and 'falling' with a fill?

   Reads the avgLowPrice side (the instasell side, where a resting bid fills). Pure over an
   already-fetched 5m series; no fetch/fs/DOM. Returns null on a thin/absent series (degrade — never
   guess a direction off too few prints), else { dir, minLow, minAgeMin, recentLevel, bouncePct, n }.
   dir ∈ 'falling' | 'reverting' | 'flat':
     falling   — the low is FRESH (≤ DIR_FRESH_MIN old) OR live sits within DIR_AT_LOW_PCT of the low
                 (still coming down / at the low) → a resting bid fills as it drops.
     reverting — bounced ≥ DIR_REVERT_PCT off the low AND the low is not fresh → the bid likely
                 misses; cross or pass.
     flat      — neither. */
export const DIR_LOOKBACK_H  = 3;       // PLACEHOLDER (n=2): hours of 5m prints scored for direction
export const DIR_MIN_POINTS  = 12;      // PLACEHOLDER (n=2): fewer non-null lows than this ⇒ null (too thin to call)
export const DIR_FRESH_MIN   = 15;      // PLACEHOLDER (n=2): a low this many minutes old or newer is still "fresh"
export const DIR_AT_LOW_PCT  = 0.002;   // PLACEHOLDER (n=2): recent level within this fraction of the low ⇒ still at the low → falling
export const DIR_REVERT_PCT  = 0.004;   // PLACEHOLDER (n=2): recent level ≥ this fraction above the low ⇒ reverting
export function recentDirection(ts5m, { lookbackH = DIR_LOOKBACK_H, now = new Date() } = {}){
  const nowMs = (now instanceof Date) ? now.getTime() : (now != null ? now : Date.now());
  const cut = nowMs/1000 - lookbackH*3600;
  const slice = (ts5m||[])
    .filter(p => p && p.timestamp != null && p.timestamp >= cut && p.avgLowPrice != null)
    .sort((a,b) => a.timestamp - b.timestamp);
  if (slice.length < DIR_MIN_POINTS) return null;   // degrade — never guess a direction off a thin series
  const lows = slice.map(p => p.avgLowPrice);
  const minLow = Math.min(...lows);
  // LAST occurrence of the min — a RETEST of the low counts as still-at-the-low, not a bounce.
  let minIdx = 0;
  for (let i = 0; i < lows.length; i++) if (lows[i] <= minLow) minIdx = i;
  const minAgeMin = (nowMs/1000 - slice[minIdx].timestamp) / 60;
  // recentLevel = MEDIAN of the last 3 non-null lows — ROBUST so a lone flier print can't fake a
  // bounce (the Bar E discipline). Reuses the shared type-7 median() (SF-1), not a re-derived one.
  const recentLevel = median(lows.slice(-3));
  const bouncePct = minLow > 0 ? (recentLevel - minLow) / minLow : 0;
  const fresh = minAgeMin <= DIR_FRESH_MIN;
  const atLow = bouncePct <= DIR_AT_LOW_PCT;
  let dir;
  if (fresh || atLow)                 dir = 'falling';
  else if (bouncePct >= DIR_REVERT_PCT) dir = 'reverting';
  else                                dir = 'flat';
  return { dir, minLow, minAgeMin, recentLevel, bouncePct, n: slice.length };
}

/* ============================================================================================
   DL2 (2026-07-11) — flushSignal: the REACTIVE LIQUID-FLUSH → bid-into-the-fall detector. A SEPARATE
   appended block of pure, DOM-free math (quotecore.js imports only money-math.js + money-format.js — kept that way); it does
   NOT touch momVerdict / the gate tree. Consumed ONLY by pipeline/commands/watch-positions.mjs's --dip loop (a node CLI
   surface); no app module imports it, so it ships without an APP_VERSION bump. Fixture-pinned in
   pipeline/test/diploop.test.mjs.

   THE MECHANIC (this is the DL2 DOCTRINE HOME). Some dips are off-schedule EXOGENOUS FLUSHES — a holder
   dumps units into the book faster than buyers absorb them, so price gaps DOWN and stays fillable for a
   short window before it reverts. These are NOT the multi-day faller the regime column tracks (the knife
   thesis LAGS them) and they are NOT diurnal (the forecast is silent — they're unscheduled). The right
   play is REACTIVE: when a LIQUID book is actively flushing, bid INTO the fall to catch the cheap units,
   then list at the patient band top. flushSignal is the detector; watch-positions.mjs turns a firing into a headline
   FLUSH alert. It ALERTS, never auto-places (the watch-positions.mjs read-only guardrail is untouched).

   FILLABILITY IS UNIT-FLOW, NOT DEPLOYABILITY. The retro anchor (n=2, be honest — this is NOT a validated
   edge): today we MISSED a Searing page flush — it dumped 4,732 instasell units in ONE 5m bucket and
   stayed fillable ~45 min, but our ~15-min-stale scan missed the front-loaded volume. The illiquid twin
   (Abyssal bludgeon, ~83/day, ~16m/unit) was UN-fillable — only 2 units crossed the whole episode — even
   though price×limit looked deployable. So `price×limit` measures DEPLOYABILITY (can you park capital
   here?); FILLABILITY is UNIT-FLOW (`volDay`, will a seller actually cross down to your bid?). The liquid
   floor below gates on unit-flow, which is why it cleanly excludes the bludgeon and admits Searing.

   REUSE, don't re-derive: DIRECTION is recentDirection() (the DP1 5m-shape read — reverting is already
   its own cross-or-pass case, so a flush only fires while STILL falling); tax/break-even are the shared
   breakEven()/netMargin(). HONESTY (process rule 4): every threshold below is a NAMED PLACEHOLDER, n=2,
   none validated — the DL2 retro-join (FLUSH firings ⇆ fills.json, in pipeline/commands/analyze-record.mjs) is the
   calibration path that would tell us whether the defaults separate fillable from un-fillable firings.

   Signature: flushSignal(row, ts5m, avgLow24, { now = new Date() } = {}) → null (missing inputs) or
     { flush, signal, dir, depthPct, bucketVol, deployableGp, afterTaxMargin, dipScore, liquid }.

   TWO-LEVEL OUTPUT — SIGNAL (log) vs FLUSH (alert), deliberately decoupled (DL2 addition, 2026-07-11):
     • SIGNAL (`signal:true`) = gates (ii)+(iii) ALONE: a genuine falling flush of REAL DEPTH on ANY watched
       item, LIQUID OR NOT. It is worth LOGGING even for an illiquid item that will never earn the headline
       alert, because its depth/frequency history is exactly the evidence basis for WHERE to rest a standing
       bid on that illiquid item — the other half of the liquid/illiquid split, and DL3's input. So flushSignal
       ALWAYS returns the full computed object (never bails to null on the illiquid path).
     • FLUSH (`flush:true`) = ALL FOUR gates: a SIGNAL on a LIQUID book whose exit clears after tax. ONLY this
       produces the headline bid-into-the-fall alert (a fire-fast alert is pointless where you can't poll-fill).
   FIRING GATES (flush:true requires ALL; current-5m-bucket volume is NOT a gate — Ben's refinement):
     (i)   fillability — row.volDay >= DIP_LOOP_LIQUID_FLOOR (else liquid:false; signal may still be true).
     (ii)  depth      — depthPct = (avgLow24 − quickBuy)/avgLow24 >= DIP_LOOP_FLUSH_PCT (a flush is sharp).
     (iii) direction  — recentDirection === 'falling' (reverting/flat/null → no signal; DP1 owns reverting).
     (iv)  exit clears — row.reliable AND optSell != null AND after-tax net at the bid > 0 AND optSell >
           break-even (liquid-fill economics — NOT part of the log-worthy SIGNAL). */
export const DIP_LOOP_LIQUID_FLOOR   = 40000;  // PLAN-VOL24 step 2: 1000 → 40000, count-matched to the CORRECTED rolling-24h volume (was PLACEHOLDER n=2). Node-only consumer (dip/watch) → no APP_VERSION bump. Min two-sided volDay to treat a book as FILLABLE
//   (unit-flow, NOT deployability). Cleanly excludes the ~83/d Abyssal bludgeon, admits ~14.4k/d Searing;
//   room to tune DOWN as the DL2 retro-join accrues. Validation = the DL2 retro (FLUSH firings ⇆ fills.json).
export const DIP_LOOP_FLUSH_PCT      = 0.03;   // PLACEHOLDER (n=2): live instasell this fraction below the 24h avg low
//   = a fresh flush (deeper than DP1's 1% dip depth — a flush is a sharp gap, not a drift).
export const DIP_LOOP_DEPLOY_VOL_FRAC = 0.01;  // PLACEHOLDER (n=2): when limit is null/unknown, deployable units fall
//   back to this fraction of volDay (never let a null limit break the dipScore — Searing logs a null limit).
export function flushSignal(row, ts5m, avgLow24, { now = new Date() } = {}) {
  if (!row || !ts5m || avgLow24 == null || !(avgLow24 > 0) || row.quickBuy == null) return null;   // degrade — never guess
  const liquid = row.volDay != null && row.volDay >= DIP_LOOP_LIQUID_FLOOR;
  const depthPct = (avgLow24 - row.quickBuy) / avgLow24;
  const dir = recentDirection(ts5m, { now })?.dir ?? null;
  // bucketVol (INFORMATIONAL — alert text only, never a firing gate): the instasell units in the latest
  // 5m bucket (sum of the last ≤5 min of points, else the freshest point's lowPriceVolume).
  const nowSec = ((now instanceof Date) ? now.getTime() : (now != null ? now : Date.now())) / 1000;
  const pts = (ts5m || []).filter(p => p && p.timestamp != null).slice().sort((a, b) => a.timestamp - b.timestamp);
  const inLast5 = pts.filter(p => p.timestamp >= nowSec - 300);
  const bucketVol = inLast5.length
    ? inLast5.reduce((s, p) => s + (p.lowPriceVolume || 0), 0)
    : (pts.length ? (pts[pts.length - 1].lowPriceVolume || 0) : 0);
  // after-tax net at the bid-into-the-fall (buy live instasell, sell the patient band top), bond-aware via
  // the shared netMargin (the ONE tax exception — no re-derived tax here).
  const bondOpts = row.bond ? { bond: true, guide: row.guide } : undefined;
  const afterTaxMargin = (row.optSell != null && row.quickBuy != null) ? netMargin(row.quickBuy, row.optSell, bondOpts) : null;
  // dipScore — soft SECONDARY priority (ranks which FLUSH surfaces first when several trip at once; NOT a
  // gate). deployableGp = price × min(limit, volume-proxy); the limit===null fallback uses the vol proxy
  // alone so a null limit (Searing) can never break the score.
  const price = row.quickBuy;
  const volProxy = Math.max(1, Math.floor((row.volDay || 0) * DIP_LOOP_DEPLOY_VOL_FRAC));
  const deployUnits = (row.limit != null) ? Math.min(row.limit, volProxy) : volProxy;
  const deployableGp = price * deployUnits;
  const dipScore = Math.log10(Math.max(1, row.volDay || 1)) * deployableGp * (afterTaxMargin || 0);
  const deepEnough = depthPct >= DIP_LOOP_FLUSH_PCT;                                        // (ii)
  const stillFalling = dir === 'falling';                                                   // (iii)
  // SIGNAL = gates (ii)+(iii) only — a genuine falling flush of real depth on ANY item (liquid or not),
  // worth LOGGING even when it will never alert (the illiquid standing-bid evidence basis / DL3 input).
  const signal = deepEnough && stillFalling;
  // ALERT (flush) = ALL FOUR gates. exitClears is liquid-fill economics (reliable quote + a profitable
  // patient exit) and is independent of the liquidity floor; it is NOT part of the log-worthy SIGNAL.
  const exitClears = row.reliable === true && row.optSell != null &&                        // (iv)
    afterTaxMargin != null && afterTaxMargin > 0 && row.optSell > breakEven(row.quickBuy, bondOpts);
  return { flush: signal && liquid && exitClears, signal, dir, depthPct, bucketVol, deployableGp, afterTaxMargin, dipScore, liquid };
}

/* ============================================================================================
   DL4 (2026-07-11) — nominateDip + the pool-reconcile transforms: the "B feeds A" discovery half of the DL2
   dip-loop. Pure, DOM-free math (quotecore.js still imports only money-math.js + money-format.js). Consumed ONLY by node
   pipeline scripts (screen-flip-niches.mjs nominates; watch-positions.mjs --dip polls) — NO app module imports this, so it
   ships with NO APP_VERSION bump. Fixture-pinned in pipeline/test/dl4nominate.test.mjs.

   THE PROBLEM DL4 SOLVES (this is the DL4 DOCTRINE HOME). A flush is EXOGENOUS — you cannot know in
   advance WHICH liquid item will gap down — so DL2's hand-curated dip-watchlist.json has a coverage
   gap: an item nobody thought to add can never fire the 5m FLUSH loop. DL4 closes that gap by letting
   the on-demand SCAN (which ALREADY fetches the whole liquid universe's 24h stats + 2h bands) NOMINATE
   flush-SUITABLE candidates into the dip-watchlist, so discovery happens breadth-first in the scan
   while the reactive 5m loop stays bounded to a curated pool.

   SUITABILITY, NOT A LIVE CATCH. nominateDip does NOT say "this is flushing" or "trade this" — the scan
   basis (24h stats + 2h band) is too coarse and too stale for that (that's flushSignal's job on the
   fresh 5m survivor series). It says only "this book is VOLATILE + TWO-SIDED + liquid enough that a
   future flush here would be catchable — worth WATCHING." A nomination is a PROPOSAL TO WATCH that Ben
   curates, never a validated pick.

   THE ZERO-FETCH BOUNDARY (a HARD requirement — DL4 adds NO fetches). Two data tiers, both already in
   hand at nomination time in screen-flip-niches.mjs:
     • GATE tier — v24[id] (avgLow/High + hpv/lpv) + bands[id] (bandLo/Hi, sawLow/High, tradedWin) are
       loaded for the WHOLE liquid universe before any survivor fetch. This is the breadth source DL4
       keys off: nominateDip reads ONLY these two objects.
     • SURVIVOR tier — series5m is fetched only for survivors; screen-flip-niches.mjs runs flushSignal on those
       (zero extra fetch) to BONUS a nominee that is a survivor AND flushing right now.

   HONESTY (process rule 4): every DL4_* threshold below is a NAMED PLACEHOLDER, n=2, none validated —
   F1 (the retro-join in pipeline/commands/analyze-record.mjs) owns calibration.

   SUITABILITY GATES (all must hold, else null): TWO-SIDED (ghost-spread guard) + WIDE-ENOUGH amplitude
   (band % or 24h-range % fallback) + a VALUE FLOOR (gp-flow = mid × limitVol ≥ DL4_MIN_GP_FLOW, the tool-
   wide 500k gp/day attention scale) so a huge-% swing on a penny item (Sweetcorn seed) can't nominate.
   The value floor is a gp-SCALE gate, NOT a unit-price one — cheap high-throughput churn keeps a huge
   gp-flow and passes; both tracks gate on it.

   nominateDip(v24Entry, bandEntry, { now } = {}) → null (not suitable / missing inputs) or
     { track:'liquid'|'illiquid', score, amplitude, limitVol, gpFlow, twoSided }.
   reconcileDipPool(existing, qualifiers) → the ONE auto-pool write transform (upsert + re-score + age +
     per-track score cap) with the manual↔auto id/name dedup; pruneDipPool is its age+cap helper. Both
     are polymorphic over legacy plain-string/number existing entries. See their definitions below. */
export const DL4_WIDE_BAND_PCT = 0.03;          // PLACEHOLDER (n=2): min 2h-band amplitude (bandHi-bandLo)/bandLo to be flush-suitable
export const DL4_WIDE_DAY_PCT  = 0.05;          // PLACEHOLDER (n=2): min 24h-range amplitude fallback when no band present (coarser → wider bar)
// VALUE FLOOR (2026-07-11): reuses the tool-wide 500k gp/day ATTENTION floor (screen-flip-niches.mjs MIN_GPD) as a
// gp-SCALE gate, applied as gp-flow = mid × limitVol (the SAME construction as the main gate's gp-flow
// path). It fixes the penny-item leak: a huge-% band on a sub-gp item (e.g. Sweetcorn seed — guide 3gp,
// ~7→14gp band, ~3.9k/d → ~39k/d gp-flow) is three orders below anything worth watching for a flush, yet
// cleared the %-only amplitude bar. This is about gp SCALE, NOT unit price — cheap-but-high-throughput
// churn (a ~200gp rune moving millions/day) has huge gp-flow and still passes. Both tracks gate on it.
export const DL4_MIN_GP_FLOW = 9_000_000;       // PLAN-VOL24 step 2: 500k → 9m (~18×), count-matched to CORRECTED rolling-24h gp-flow (mid×limitVol turnover, ~18× higher; the directive's "~4.5b" was GP_FLOOR-specific — DL4's 500k scaled by the same ~18× factor = 9m; NOT tied to MIN_GPD's kept-500k NET-throughput floor, a different dimension). Node-only (dip nomination) → no APP_VERSION bump. Min mid×limitVol gp-flow/day to be worth watching
// PER-UNIT SWING FLOOR (2026-07-12, Ben — the penny-junk-still-leaked fix). The gp-flow floor above is a
// gp-SCALE gate (is the MARKET big enough), but it admits cheap high-throughput commodities — Feather (2gp),
// Water/Mind rune, Iron bolts, seeds — because their volume clears the flow bar despite a trivial per-unit
// swing. A FLUSH bid captures ~one band-amplitude of gp/UNIT on the bounce, so a 3% dip on a 2gp item is
// 0.06gp — never worth a bid-into-the-fall. This ORTHOGONAL floor asks "is the dip worth catching per unit":
// the absolute swing (bandHi−bandLo, or the 24h avg range) must clear DL4_MIN_ABS_SWING. It's what actually
// screens the flush pool down to meaningful mid/big tickets (Searing-page/bludgeon class) and keeps cheap
// churn in the CHURN niche where it belongs — SUPERSEDES the old "cheap high-volume churn still passes"
// property (dl4nominate.test 6c). PLACEHOLDER (n=2); F1 owns calibration.
export const DL4_MIN_ABS_SWING = 50;            // PLACEHOLDER (n=2): min absolute per-unit swing (gp) for a flush to be worth catching
// POOL HYGIENE (2026-07-12): the auto-nomination pool grew unbounded (640 entries in <1 day) because nothing
// aged out — the --dip loop's target set crept toward the whole universe, and each entry is a live fetch +
// flushSignal check EVERY ~5m pass (watch-positions.mjs --dip folds the whole pool into targetSpecs). So pool size =
// the dip loop's per-pass cost, and "which stay/go" must be a QUALITY ranking, not a timestamp accident.
// reconcileDipPool therefore re-SCORES every qualifier each scan and keeps the top-N BY SCORE per track;
// an entry drops when it (a) stops re-qualifying for DL4_POOL_MAX_AGE_DAYS, or (b) falls out of the top-N on
// score. Manual/legacy entries are never touched. TRACK split: only the LIQUID track is watched live by
// --dip (it's the FLUSH-alert set) so it's capped TIGHT; the ILLIQUID track is DL3's (unbuilt) standing-bid
// backlog — deeper cap, not fetched live yet. Entry schema gains { lastQualTs, score }.
export const DL4_POOL_MAX_AGE_DAYS = 3;         // PLACEHOLDER: an auto entry that stops re-qualifying ages out after this many days
export const DL4_POOL_CAP_LIQUID = 15;          // PLACEHOLDER: max LIQUID auto entries (the --dip live-watch set) — kept tight; top-N by score
export const DL4_POOL_CAP_ILLIQUID = 45;        // PLACEHOLDER: max ILLIQUID auto entries (DL3 backlog, not watched live) — deeper; top-N by score

export function nominateDip(v24Entry, bandEntry, { now } = {}) {   // `now` unused today — kept for signature parity / future recency gating
  if (!v24Entry) return null;
  const hpv = v24Entry.highPriceVolume, lpv = v24Entry.lowPriceVolume;
  if (hpv == null || lpv == null) return null;                     // missing volume → can't judge → degrade, never guess
  const limitVol = Math.min(hpv, lpv);
  // TWO-SIDED liquidity GUARD (the non-negotiable ghost-spread rule): a book must trade on BOTH sides,
  // either as a band that saw both edges once, or as positive hpv AND lpv over the 24h window. A
  // one-sided book is a ghost spread — NEVER nominate it (both tracks require this; a dead/one-sided
  // book returns null here before either track).
  const twoSided = (!!bandEntry && bandEntry.sawLow === true && bandEntry.sawHigh === true) || (hpv > 0 && lpv > 0);
  if (!twoSided) return null;
  // AMPLITUDE — prefer the tighter, fresher 2h band edge; fall back to the coarse 24h range. Guard denominators.
  const haveBand = !!bandEntry && bandEntry.bandLo != null && bandEntry.bandHi != null && bandEntry.bandLo > 0;
  let amplitude;
  if (haveBand) amplitude = (bandEntry.bandHi - bandEntry.bandLo) / bandEntry.bandLo;
  else {
    if (v24Entry.avgLowPrice == null || v24Entry.avgHighPrice == null || !(v24Entry.avgLowPrice > 0)) return null;
    amplitude = (v24Entry.avgHighPrice - v24Entry.avgLowPrice) / v24Entry.avgLowPrice;
  }
  if (!(amplitude >= (haveBand ? DL4_WIDE_BAND_PCT : DL4_WIDE_DAY_PCT))) return null;   // not volatile enough to flush
  // VALUE FLOOR — reject penny items whose big % swing is trivial gp. gp-flow = mid × limitVol (the SAME
  // construction the main screen's gp-flow gate uses); mid prefers the band midpoint, falls back to the 24h
  // avg mid (both already validated non-null above on their respective paths). This is a gp-SCALE gate, NOT
  // a unit-price gate — high-throughput cheap churn keeps a huge gp-flow and passes. Applies to BOTH tracks
  // (a worthless-scale book is worthless whether liquid or thin). PLACEHOLDER (n=2); F1 owns calibration.
  const mid = haveBand ? (bandEntry.bandLo + bandEntry.bandHi) / 2
                       : (v24Entry.avgLowPrice + v24Entry.avgHighPrice) / 2;
  const gpFlow = mid * limitVol;
  if (!(gpFlow >= DL4_MIN_GP_FLOW)) return null;   // below the 500k gp/day attention scale → not worth watching
  // PER-UNIT SWING FLOOR — orthogonal to the gp-SCALE floor above: reject items whose per-unit dip is too
  // small to be worth a bid-into-the-fall (kills the Feather/rune/seed churn the flow floor let through).
  const swingGp = haveBand ? (bandEntry.bandHi - bandEntry.bandLo)
                           : (v24Entry.avgHighPrice - v24Entry.avgLowPrice);
  if (!(swingGp >= DL4_MIN_ABS_SWING)) return null;
  // TRACK split off the DL2 fill-floor (reused, not re-derived): a liquid book is an active FLUSH
  // candidate; a two-sided-but-thinner book is a DL3 standing-bid candidate (still worth watching, its
  // depth history is DL3's input). A dead/one-sided book already returned null above.
  const track = (limitVol >= DIP_LOOP_LIQUID_FLOOR) ? 'liquid' : 'illiquid';
  // SCORE — ranks which nominations win the per-scan cap: amplitude (the flush headroom) weighted by
  // log-volume (fillability). Both tracks share it so a wide liquid book outranks a wide thin one.
  const score = amplitude * Math.log10(Math.max(10, limitVol));
  return { track, score, amplitude, swingGp, limitVol, gpFlow, twoSided: true };
}

// pruneDipPool — pure age + QUALITY cap over the dip-watchlist, applied on every write so the AUTO pool can't
// grow unbounded (the 640-entry-in-a-day bloat, 2026-07-12). MANUAL/legacy entries (source !== 'auto', incl.
// plain string/number legacy tokens) are NEVER aged or capped — hand-curation is permanent. An auto entry is
// dropped once its LAST QUALIFICATION is older than maxAgeMs (it stopped re-qualifying), then each TRACK is
// kept to its top-N BY SCORE (the flush-quality rank nominateDip produces) — so eviction keeps the best flush
// candidates, not the most-recently-touched. Order: manual first (verbatim), then surviving liquid, then
// illiquid. PURE + fixture-pinned (dl4nominate.test.mjs).
export function pruneDipPool(pool, { now = Date.now(), maxAgeMs = DL4_POOL_MAX_AGE_DAYS * 86400000,
                                     capLiquid = DL4_POOL_CAP_LIQUID, capIlliquid = DL4_POOL_CAP_ILLIQUID } = {}) {
  const manual = [], auto = [];
  for (const e of (pool || [])) {
    if (e == null) continue;
    if (e && typeof e === 'object' && e.source === 'auto') auto.push(e);
    else manual.push(e);   // manual/legacy → exempt
  }
  const ts = e => Number(e.lastQualTs ?? e.addedTs ?? 0);          // back-compat: fall back to addedTs
  const byScore = (a, b) => (Number(b.score) || 0) - (Number(a.score) || 0);
  const fresh = auto.filter(e => (now - ts(e)) <= maxAgeMs);
  const liquid = fresh.filter(e => e.track === 'liquid').sort(byScore).slice(0, Math.max(0, capLiquid));
  const illiquid = fresh.filter(e => e.track !== 'liquid').sort(byScore).slice(0, Math.max(0, capIlliquid));
  return manual.concat(liquid, illiquid);
}

// reconcileDipPool — the ONE write-path transform for the auto pool. `qualifiers` = EVERY item nominateDip
// hit this scan, each { id, name, track, score } (score = the flush-quality rank, flush-now-boosted by the
// caller). It (1) upserts each qualifier — refreshing an existing entry's score + lastQualTs, or inserting a
// new one — so a persistent qualifier stays fresh and re-scored; (2) leaves non-qualifying existing auto
// entries untouched (their stale lastQualTs lets them age out); (3) prunes by age + per-track top-N score.
// PURE + fixture-pinned.
export function reconcileDipPool(existing, qualifiers, opts = {}) {
  const now = opts.now ?? Date.now();
  const quals = new Map((qualifiers || []).filter(q => q && q.id != null).map(q => [Number(q.id), q]));
  const manual = [], auto = [];
  for (const e of (existing || [])) {
    if (e == null) continue;
    if (e && typeof e === 'object' && e.source === 'auto') auto.push(e);
    else manual.push(e);
  }
  // A manual/legacy entry (hand-curated, exempt from aging) already covers its item — never insert an
  // AUTO duplicate of it, matched by id OR name. The pool is polymorphic: a legacy entry may be a plain
  // name string, a numeric id (string or number), or an object. (Name-dedup ported here from the retired
  // selectNominations so the live write-path — not just a dead helper — keeps the manual↔auto guard.)
  const manualIds = new Set(), manualNames = new Set();
  for (const e of manual) {
    if (e && typeof e === 'object') { if (e.id != null) manualIds.add(Number(e.id)); if (e.name != null) manualNames.add(String(e.name).toLowerCase()); }
    else if (typeof e === 'number') manualIds.add(Number(e));
    else if (typeof e === 'string') { const num = Number(e); if (Number.isFinite(num) && String(num) === e.trim()) manualIds.add(num); else manualNames.add(e.toLowerCase()); }
  }
  const seen = new Set();
  const merged = auto.map(e => {
    const id = Number(e.id); seen.add(id);
    const q = quals.get(id);
    return q ? { ...e, name: e.name ?? q.name, track: q.track, score: q.score, lastQualTs: now } : e;
  });
  for (const q of quals.values()) {
    const qid = Number(q.id);
    if (seen.has(qid)) continue;
    if (manualIds.has(qid) || (q.name != null && manualNames.has(String(q.name).toLowerCase()))) continue;   // a manual/legacy entry already covers this item
    merged.push({ id: qid, name: q.name, source: 'auto', track: q.track, addedTs: now, lastQualTs: now, score: q.score });
  }
  return pruneDipPool(manual.concat(merged), { ...opts, now });
}
