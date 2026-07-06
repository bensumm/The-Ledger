/* quotecore.js — DOM-free quote model + canonical market-table cells.
   Pure ESM: imports only from format.js (also pure), references no window/document.
   Importable by BOTH the browser app (js/quote.js, trends.js, ui.js) AND node
   pipeline scripts (chunk 3 quote.mjs/screen.mjs, chunk 5 bank.mjs) — keep it that way.

   The canonical market table (CLAUDE.md "Market analysis workflow"):
     Item | Guide | Mid | Buy@ Quick / Opt | Sell@ Quick / Opt | Net/u Quick / Opt (ROI) | Vol/d | Regime
   - Quick = transact now: buy at live instasell (latest.low), sell at live instabuy (latest.high).
   - Optimistic = patient 2h-band edges: min(avgLowPrice) / max(avgHighPrice) over the last 24×5m points.
   INVARIANT (guaranteed by construction below): optBuy ≤ quickBuy ≤ quickSell ≤ optSell.
   The 2026-07-03 bug that inflated an edge 2.5× came from mixing bases (24h percentiles vs
   live quotes). Here the optimistic edges are CLAMPED against the SAME live quote, so the
   optimistic side can never be worse than the quick side — the mixing can't happen. */

import { tax, netMargin, fmtP, fmt, TAXCAP } from './format.js';
export { tax, netMargin } from './format.js';   // re-export so node consumers (chunk 4.1) get the ONE tax impl
// Break-even list price: the smallest sell price `s` that still nets ≥ `buy` after the GE tax —
// i.e. the smallest integer s with s - tax(s) ≥ buy. The ONE definition shared by the app, the
// pipeline monitor, and the analysis scripts (chunk 4.1) so tax/break-even math can never drift.
// PIECEWISE, matching format.js tax() exactly (BE1) — the plain ceil(buy/0.98) is the *uncapped*
// inverse and is wrong in tax()'s two flat regions:
//   • buy < 50            → buy       (a sell under 50gp is tax-exempt: tax(s)=0, so s=buy clears)
//   • buy > 250m − TAXCAP → buy+TAXCAP (the 2% cap binds: floor(s·0.02) hits TAXCAP=5m at
//                                       s ≥ TAXCAP/0.02 = 250m, so tax is flat 5m and true BE is
//                                       buy+5m — ceil(buy/0.98) OVERSTATES it, e.g. a 1.633b bow
//                                       demanded 1.666b vs 1.638b true)
//   • otherwise           → ceil(buy/0.98)   (uncapped region — unchanged legacy formula)
// The crossover (buy > TAXCAP/0.02 − TAXCAP = 245m) and smallest-s correctness at every region
// boundary are brute-force-proven in pipeline/quotecore.test.mjs (BE1 fixtures).
export const breakEven = buy => {
  if (buy < 50) return buy;
  if (buy > TAXCAP/0.02 - TAXCAP) return buy + TAXCAP;
  return Math.ceil(buy/0.98);
};
// Total lot value (qty × avgCost, i.e. capital at risk — NOT per-unit) at/above which a 2h
// breakdown against a rising regime is CLEARED rather than held (chunk 6 cut-trigger). Named +
// tunable; lives here (the shared node+browser module) so reviewPositions and quote.mjs --positions
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

function med(arr){ if(!arr||!arr.length) return null; const s=arr.slice().sort((a,b)=>a-b), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
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
   network. It is consumed ONLY by the pipeline (screen.mjs display + the opt-in basing-rescue); the
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

/* Build the full row model for one item from raw fetched inputs (all DOM-free):
     latest : {low, high, ...}         live /latest snapshot (low=instasell, high=instabuy)
     ts5m   : [{avgLowPrice,avgHighPrice,...}]  5m timeseries (last 24 used for the 2h band)
     ts6h   : [{avgLowPrice,avgHighPrice,timestamp}]  6h timeseries (regimeDrift)
     vol24  : {highPriceVolume,lowPriceVolume}   /24h endpoint (limiting-side Vol/d)
     guide  : GE guide price (NOT the wiki mapping value) or null
     limit  : buy limit or null
     held   : Ben holds an open lot (falling-exclusion exception — always shown w/ clear guidance)
     asked  : Ben explicitly loaded/asked this item (same exception) */
export function computeQuote({latest, ts5m, ts6h, vol24, guide, limit, held, asked, now}={}){
  const quickBuy  = (latest && latest.low)  || null;   // your BUY fills at the instasell
  const quickSell = (latest && latest.high) || null;   // your SELL fills at the instabuy
  // patient 2h band: last 24×5m points
  const recent=(ts5m||[]).slice(-24);
  const los=recent.map(p=>p.avgLowPrice).filter(Boolean);
  const his=recent.map(p=>p.avgHighPrice).filter(Boolean);
  const bandLo=los.length?Math.min(...los):null;
  const bandHi=his.length?Math.max(...his):null;
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
  // watch.mjs's `mom==='breakdown' && reliable`, quote.mjs's classify), not just one path.
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
  // --- pre-clamp momentum tell (chunk 6) -------------------------------------------------
  // rawBandLo/rawBandHi are the UNCLAMPED 2h edges (== bandLo/bandHi, before the price clamp
  // below). The displayed opt prices clamp against the live quote (pricing correctness — never
  // suggest buying above the live market), which ANNIHILATES the signal — so `mom` is derived
  // HERE, from the pre-clamp live-vs-band comparison, independently of the clamp:
  //   quickBuy  < rawBandLo (live instasell below the 2h floor) → 'breakdown' (↓ active pullback)
  //   quickSell > rawBandHi (live instabuy above the 2h top)    → 'breakup'   (↑ fresh 2h high)
  //   otherwise                                                 → 'clean'     (ranging in-band)
  // Same single basis (live /latest + 2h 5m band from the SAME fetch) ⇒ a break is a real momentum
  // tell, not a base-mixing bug. That bug is guarded SEPARATELY by quoteOrdered() on the clamped
  // prices (row.ordered) — the clamp is not what prevents mixing.
  const rawBandLo=bandLo, rawBandHi=bandHi;
  let mom='clean', momPct=0;
  if(quickBuy!=null && rawBandLo!=null && quickBuy<rawBandLo){ mom='breakdown'; momPct=(rawBandLo-quickBuy)/rawBandLo; }
  else if(quickSell!=null && rawBandHi!=null && quickSell>rawBandHi){ mom='breakup'; momPct=(quickSell-rawBandHi)/rawBandHi; }
  // Optimistic edges CLAMPED to the live quote → optBuy ≤ quickBuy and optSell ≥ quickSell
  // ALWAYS (this is the ordering guarantee; single shared basis, no mixing).
  let optBuy=quickBuy, optSell=quickSell;
  if(quickBuy!=null)  optBuy  = bandLo!=null?Math.min(quickBuy, bandLo):quickBuy;
  if(quickSell!=null) optSell = bandHi!=null?Math.max(quickSell, bandHi):quickSell;
  // Falling regime → price to clear: cap the optimistic sell at the instabuy, never above a
  // dropping market (the 0.20.0 rule). Still bid low on the buy side.
  if(falling && quickSell!=null) optSell=quickSell;
  const mid=(quickBuy!=null&&quickSell!=null)?(quickBuy+quickSell)/2:(quickBuy||quickSell||null);
  const volDay=vol24?Math.min(vol24.highPriceVolume||0, vol24.lowPriceVolume||0):null;
  const quickNet=(quickSell!=null&&quickBuy!=null)?netMargin(quickBuy,quickSell):null;
  const optNet  =(optSell!=null&&optBuy!=null)?netMargin(optBuy,optSell):null;
  const quickRoi=(quickNet!=null&&quickBuy)?quickNet/quickBuy*100:null;
  const optRoi  =(optNet!=null&&optBuy)?optNet/optBuy*100:null;
  const row={ quickBuy, quickSell, optBuy, optSell, mid, guide:guide??null, volDay,
    quickNet, optNet, quickRoi, optRoi, limit:limit??null,
    regime, regimeLabel:rl.label, falling, rising:rl.rising, held:!!held, asked:!!asked,
    mom, momPct, rawBandLo, rawBandHi,
    reliable, reliableReason, quoteAgeMin:{buy:buyAgeMin, sell:sellAgeMin},
    band:{lo:bandLo, hi:bandHi, n:recent.length} };
  row.ordered=quoteOrdered(row);
  return row;
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
   shared implementation — js/trends.js reviewPositions, pipeline/quote.mjs --positions, and
   pipeline/watch.mjs all call it, so the matrix can't drift between app and scripts.

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
   transacting above the clear price) } — when omitted, momVerdict is IDENTICAL to before (the
   ts5m/now optional-degradation precedent), so every existing caller is unaffected. Returns null
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

/* Shared BUY-OFFER (resting bid) verdict — the ONE decision pipeline/watch.mjs (console) and the
   in-app Watch tab both consume, so a resting bid reads IDENTICALLY in both (the momVerdict
   precedent, extracted from watch.mjs's inline bidVerdict by the Watch-tab build). Pure:
   (row, offerPrice) → one of 'CANCEL-BID' | 'NO-QUOTE' | 'CROSSING' | 'BID-BEHIND' | 'BID-OK'.
   Gate ORDER is load-bearing and matches watch.mjs's original inline logic exactly:
     CANCEL-BID  falling regime OR a reliable 2h breakdown → a fill here is adverse selection
     NO-QUOTE    no live instasell to judge the bid against
     CROSSING    bid ≥ live instasell → expect fills about now
     BID-BEHIND  bid below the 2h band low → unlikely to fill soon
     BID-OK      resting inside the band
   Only CANCEL-BID is an ALERT (the sole state where a resting order needs action); the rest are
   placement feedback. Fixture-pinned in pipeline/watchcore.test.mjs. */
export function offerVerdict(row, offerPrice){
  if(!row) return 'NO-QUOTE';
  if(row.falling || (row.mom==='breakdown' && row.reliable)) return 'CANCEL-BID';
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
   prices — the model still exposes row.mid for rating.mjs/watch.mjs). quoteCells now returns
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
/* NOTE: a fixed-column quoteMarkdown() helper was removed by A1 (dead — quote.mjs/screen.mjs
   both APPEND columns and share pipeline/cli.mjs's mdTable + stdCells split instead). The
   structured quoteCells/cellText split above is the real shared table API. */

/* ============================================================================================
   S2 — POSTURE HELPERS (overnight vs active screening). A SEPARATE, appended block: these are new,
   independently-named pure helpers and do NOT touch momVerdict / the PLAN-3 gate tree. They reuse
   the same 5m-series + DIURNAL_DIP_MARGIN machinery as diurnalRead. Fixture-tested in
   pipeline/quotecore.test.mjs under the "S2 posture fixtures" header.
   ============================================================================================ */
// The overnight window is LOCAL wall-clock: an evening bid must survive unattended to morning.
export const OVERNIGHT_START_HOUR = 22;   // local hour, inclusive
export const OVERNIGHT_END_HOUR   = 6;    // local hour, exclusive
export const OVERNIGHT_SPAN_H     = 8;    // the forward window an overnight bid rests through
// Is `now` (ms, default Date.now()) inside the local overnight window? Wraps midnight. `--posture auto`
// on screen.mjs uses this; all displayed clocks are LOCAL (CLAUDE.md local-time rule).
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
