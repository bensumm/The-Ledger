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

import { tax, netMargin, fmtP, fmt } from './format.js';
export { tax, netMargin } from './format.js';   // re-export so node consumers (chunk 4.1) get the ONE tax impl
// Break-even list price: the sell price that just clears the 2% GE tax on a lot bought at `buy`.
// The ONE definition shared by the app, the pipeline monitor, and the analysis scripts (chunk 4.1)
// so tax/break-even math can never drift between them.
export const breakEven = buy => Math.ceil(buy/0.98);
// Total lot value (qty × avgCost, i.e. capital at risk — NOT per-unit) at/above which a 2h
// breakdown against a rising regime is CLEARED rather than held (chunk 6 cut-trigger). Named +
// tunable; lives here (the shared node+browser module) so reviewPositions and quote.mjs --positions
// use ONE constant and can never drift.
export const BIG_TICKET_GP = 10_000_000;

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
  // --- GATE 0: quote reliability (PLAN-3, interpretation E) -------------------------------
  // Is this reading even a price? A quote is UNRELIABLE if it is stale (a /latest print aged
  // past a print-interval-scaled threshold), one-sided (only one side of the 2h band ever
  // printed), or too sparse (fewer than MIN_BAND_WINDOWS populated 5m windows). Everything
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
  let reliableReason;
  if(quickSell==null)        reliableReason='no-quote';       // no live instabuy → cannot price a sell/cut
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
     GATE 0  unreliable/missing quote        → NO_READ   (a missing instabuy must NEVER → CUT)
     GATE 1  underwater + quiet diurnal trough that dipped+recovered yesterday → DIURNAL_WATCH
     GATE 2  mom breakup                      → HOLD_STRONG
             mom breakdown, small-lot shock   → SHOCK_WATCH (one more cycle)
             mom breakdown otherwise          → CUT / HOLD_WATCH / CLEAR (unchanged matrix)
     D-esc.  mom clean but underwater through a liquid window → CUT-CANDIDATE
     else    null → caller keeps its existing regime-based verdict
   Params: row (a computeQuote row — needs .mom/.quickSell/.rawBandHi/.optSell/.rising/.reliable),
   breakEvenPrice = ceil(avgCost/0.98), lotValue = qty×avgCost (vs BIG_TICKET_GP). ts5m/now are
   optional — pass the full 5m series (and now, ms) to activate Gates 1/2-shape/D; without them
   the tree degrades to Gate 0 + the original breakdown matrix. Returns null or
   { action, verdict, listAt, cls, gate, why }; listAt is a price or null (HOLD, no reprice). */
export function momVerdict(row, breakEvenPrice, lotValue, ts5m, now){
  if(!row) return null;
  const instabuy=row.quickSell;   // clear-now price (live instabuy)
  // GATE 0 — is this reading even a price? An unreliable quote yields NO price action, and a
  // MISSING instabuy must never produce CUT (the old bug: null instabuy → most aggressive verdict).
  if(instabuy==null || row.reliable===false){
    return {action:'NO_READ', verdict:'NO-READ', listAt:null, cls:'mini', gate:0,
      why:'quote not reliable ('+(row.reliableReason||'no-quote')+') — '+(instabuy==null?'no live instabuy to price against':'the feed is stale, one-sided, or too sparse to trust')+'. No price action off this read; keep any resting ask ≥ break-even'+(breakEvenPrice!=null?' ('+fmtP(breakEvenPrice)+')':'')+' and re-check at the next liquid window.'};
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
      return {action:'CUT', verdict:'CUT-CANDIDATE', listAt:instabuy, cls:'loss', gate:'D',
        why:'no live 2h break, but the band has printed below break-even for ~'+uw.hours.toFixed(1)+'h including a liquid (busy-hour) window — a genuine daily trough would have recovered when the book filled. This is persistence, not the clock: list to clear at the instabuy ('+fmtP(instabuy)+').'};
    }
  }
  return null;   // clean, reliable, not escalated → caller keeps its existing regime verdict
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
/* markdown table for the chunk-3 pipeline scripts (built now so both sides share quoteCells).
   rows: [{name, row}]
   NOTE (chunk 10.2): still UNADOPTED by quote.mjs/screen.mjs — deliberately. Both consumers
   APPEND columns to the standard set (quote.mjs --positions → Held@/Break-even/Verdict;
   screen.mjs → Grade + Score gp/d), and this helper hard-codes QUOTE_HEADERS + the fixed cell
   order, so it can't express an extended table. The scripts instead share the generic
   pipeline/cli.mjs mdTable(headers, rows) + stdCells(name, row) split. Kept as the documented
   fixed-column shared-API form for a future consumer that wants exactly the standard table. */
export function quoteMarkdown(rows){
  const head='| '+QUOTE_HEADERS.join(' | ')+' |';
  const sep ='| '+QUOTE_HEADERS.map(()=>'---').join(' | ')+' |';
  const body=(rows||[]).map(({name,row})=>'| '+quoteCells(name,row).map(cellText).join(' | ')+' |');
  return [head,sep,...body].join('\n');
}
