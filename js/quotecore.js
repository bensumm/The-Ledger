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
export function computeQuote({latest, ts5m, ts6h, vol24, guide, limit, held, asked}={}){
  const quickBuy  = (latest && latest.low)  || null;   // your BUY fills at the instasell
  const quickSell = (latest && latest.high) || null;   // your SELL fills at the instabuy
  // patient 2h band: last 24×5m points
  const recent=(ts5m||[]).slice(-24);
  const los=recent.map(p=>p.avgLowPrice).filter(Boolean);
  const his=recent.map(p=>p.avgHighPrice).filter(Boolean);
  const bandLo=los.length?Math.min(...los):null;
  const bandHi=his.length?Math.max(...his):null;
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
    band:{lo:bandLo, hi:bandHi, n:recent.length} };
  row.ordered=quoteOrdered(row);
  return row;
}
/* the ordering INVARIANT as a testable predicate (chunk-2 acceptance asserts this on fixtures) */
export function quoteOrdered(row){
  return !!row && row.quickBuy!=null && row.quickSell!=null &&
    row.optBuy<=row.quickBuy && row.quickBuy<=row.quickSell && row.quickSell<=row.optSell;
}

/* --- cut-trigger overlay (chunk 6) ---------------------------------------------------------
   A HELD position's precise 2h `mom` modifies the existing HOLD / list-at / CUT verdict. The 2h
   breakdown LEADS the multi-day regime, so an underwater position is cut EARLIER than regime-only
   logic would (the bludgeon-exit lesson). This is the ONE shared implementation — both
   js/trends.js reviewPositions and pipeline/quote.mjs --positions call it, so the matrix can't
   drift between app and script.
     row              : a computeQuote row (needs .mom, .quickSell, .rawBandHi, .optSell, .rising)
     breakEvenPrice   : ceil(avgCost/0.98) — the sell price that nets cost after 2% tax
     lotValue         : qty × avgCost = capital at risk in the lot (compared to BIG_TICKET_GP)
   Returns null when mom==='clean' (caller keeps its existing regime-based verdict), else
   { action, verdict, listAt, cls, why }. listAt is a price (number) or null (HOLD, no reprice). */
export function momVerdict(row, breakEvenPrice, lotValue){
  if(!row || row.mom==null || row.mom==='clean') return null;
  const instabuy=row.quickSell;   // clear-now price (live instabuy)
  if(row.mom==='breakup'){
    const listAt=(row.optSell!=null)?row.optSell:instabuy;   // the 2h top
    return {action:'HOLD_STRONG', verdict:'HOLD — list high', listAt, cls:'gain',
      why:'2h breakup — the live instabuy ('+fmtP(instabuy)+') has pushed above the 2h top ('+fmtP(row.rawBandHi)+'). Be patient on the sell and list at the 2h top ('+fmtP(listAt)+'); don’t sell into strength.'};
  }
  // mom==='breakdown'
  const underwater = instabuy==null || (breakEvenPrice!=null && instabuy<breakEvenPrice);
  if(underwater){
    return {action:'CUT', verdict:'CUT', listAt:instabuy, cls:'loss',
      why:'2h breakdown while underwater (live sell '+fmtP(instabuy)+' < break-even '+fmtP(breakEvenPrice)+') — the 2h break leads the multi-day regime, so cut at the instabuy now to free the capital rather than wait for the slower regime to confirm.'};
  }
  // in profit
  const big = lotValue!=null && lotValue>=BIG_TICKET_GP;
  if(row.rising && !big){
    // a lone 2h dip on a small lot against a real uptrend is usually noise
    return {action:'HOLD_WATCH', verdict:'HOLD — watch', listAt:null, cls:'gold',
      why:'2h pullback vs an uptrend on a sub-'+(BIG_TICKET_GP/1e6)+'m lot — a lone 2h dip against a rising regime is usually noise. HOLD and watch, it may reabsorb.'};
  }
  // breakdown + in profit + (flat/falling regime) OR (rising but big-ticket) → clear now
  const why = row.rising
    ? '2h breakdown against a rising regime, but this is a big-ticket lot (≥ '+(BIG_TICKET_GP/1e6)+'m at risk) → clearing: list at the instabuy ('+fmtP(instabuy)+'). The downside of a real drop on a large position outweighs the patient premium.'
    : '2h breakdown, in profit, flat/falling regime — list to clear at the instabuy ('+fmtP(instabuy)+') and bank it; don’t hold for the patient premium into a weakening market.';
  return {action:'CLEAR', verdict:'LIST-TO-CLEAR', listAt:instabuy, cls:'amber', why};
}

/* Canonical formatted cells — the SINGLE source both the app HTML table (js/quote.js) and the
   chunk-3 markdown scripts build from, so the numbers are byte-identical everywhere. */
export const QUOTE_HEADERS=['Item','Guide','Mid','Buy@ Quick / Opt','Sell@ Quick / Opt','Net/u Quick / Opt (ROI)','Vol/d','Mom','Regime'];
// last-2h momentum symbol for the Mom column (dig-in views only; NOT the Finder bulk list).
export const momSymbol=mom=>mom==='breakdown'?'↓':mom==='breakup'?'↑':'clean';
export function quoteCells(name, row){
  const roi=r=>r==null?'—':((r>=0?'+':'')+r.toFixed(1)+'%');
  return {
    item:  name,
    guide: row.guide!=null?fmtP(row.guide):'—',
    mid:   row.mid!=null?fmtP(row.mid):'—',
    buy:   fmtP(row.quickBuy)+' / '+fmtP(row.optBuy),
    sell:  fmtP(row.quickSell)+' / '+fmtP(row.optSell),
    net:   fmtP(row.quickNet)+' / '+fmtP(row.optNet)+' ('+roi(row.quickRoi)+' / '+roi(row.optRoi)+')',
    vol:   row.volDay!=null?fmt(row.volDay)+'/d':'—',
    mom:   momSymbol(row.mom),
    regime:(row.regime&&row.regime.ok)?(cap(row.regimeLabel)+' '+(row.regime.driftPct>=0?'+':'')+row.regime.driftPct.toFixed(0)+'%'):'—'
  };
}
/* markdown table for the chunk-3 pipeline scripts (built now so both sides share quoteCells).
   rows: [{name, row}]
   NOTE (chunk 10.2): still UNADOPTED by quote.mjs/screen.mjs — deliberately. Both consumers
   APPEND columns to the standard 9 (quote.mjs --positions → Held@/Break-even/Verdict;
   screen.mjs → Exp gp/d), and this helper hard-codes QUOTE_HEADERS + the fixed 9-cell order,
   so it can't express an extended table. The scripts instead share the generic
   pipeline/cli.mjs mdTable(headers, rows) + stdCells(name, row) split (stdCells === this
   function's `order(quoteCells(...))`). Kept as the documented fixed-column shared-API form
   for a future consumer that wants exactly the standard table. */
export function quoteMarkdown(rows){
  const c=quoteCells, order=x=>[x.item,x.guide,x.mid,x.buy,x.sell,x.net,x.vol,x.mom,x.regime];
  const head='| '+QUOTE_HEADERS.join(' | ')+' |';
  const sep ='| '+QUOTE_HEADERS.map(()=>'---').join(' | ')+' |';
  const body=(rows||[]).map(({name,row})=>'| '+order(c(name,row)).join(' | ')+' |');
  return [head,sep,...body].join('\n');
}
