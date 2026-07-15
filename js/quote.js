/* quote.js — browser orchestrator for the standard market table.
   Fetches ONE item's live/5m/6h/24h series + the app's guide, builds the row model via
   the DOM-free quotecore, and renders the canonical HTML table. On-demand only — never
   bulk-fetch across the universe (rate limits). Node scripts (chunk 3) do their own
   fetching and reuse quotecore directly; this module is the browser half.
   Deps: state.js, money-format.js, quotecore.js — deliberately NO import of trends.js/market.js
   so there's no import cycle (trends.js and ui.js import FROM here). */
import { API, STATE } from './state.js';
import { jget, fetchTs, fetch24h } from './marketfetch.js';   // A2: shared jget + one cached ts/24h store
import { computeQuote, quoteCells, cellText, QUOTE_HEADERS } from './quotecore.js';

async function fetchLatest(id){ const j=await jget(API+'/latest?id='+id); return (j.data&&(j.data[id]||j.data[String(id)]))||(STATE.LATEST&&STATE.LATEST[id])||null; }

const heldOpen=id=>!!(STATE.trades && STATE.trades.some(t=>t.itemId===id && t.sell===null));
const guideOf =id=>{ const g=STATE.GUIDE&&STATE.GUIDE[id]; return (g&&g.price)||null; };
const limitOf =id=>{ const m=(STATE.byId&&STATE.byId[id])||(STATE.catById&&STATE.catById[id]); return (m&&m.limit)||null; };

/* fetch + model in one call (Finder expander). opts.asked defaults true (user clicked/loaded it). */
export async function fetchQuote(id, opts={}){
  const [latest, ts5m, ts6h, vol24]=await Promise.all([fetchLatest(id), fetchTs(id,'5m'), fetchTs(id,'6h'), fetch24h(id)]);
  return computeQuote({ id, latest, ts5m, ts6h, vol24, guide:guideOf(id), limit:limitOf(id),
    held:heldOpen(id)||!!opts.held, asked:opts.asked!==false });
}

/* the canonical table as app HTML. Data cells come from quoteCells (byte-identical to the
   chunk-3 markdown); only wrapping/coloring/flags are app-specific. T1: one row of the new
   7-column set (Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime), each data
   cell colored by its own structured class (gain/loss on the composite Quick/Optimistic,
   momentum arrow color); regime falling/rising + feed-inversion flags ride on the Item cell. */
const momTitleOf=row=>row.mom==='breakdown'?'live instasell below its own 2h floor — breaking down / active pullback'
                    :row.mom==='breakup'?'live instabuy above its own 2h top — breaking up / fresh 2h high'
                    :'live prices inside the 2h band — ranging';
export function quoteTableHtml(name, row){
  const cells=quoteCells(name, row);
  const flag = row.falling ? ' <span class="qflag loss" title="multi-day regime falling — price to clear, don’t list above the drop">falling</span>'
             : row.rising  ? ' <span class="qflag gold" title="multi-day regime rising">rising</span>' : '';
  const inv  = row.ordered ? '' : ' <span class="qflag loss" title="live low/high inverted in the feed — quote basis unreliable">⚠ basis</span>';
  const th=QUOTE_HEADERS.map((h,i)=>'<th'+(i===0?' class="left"':'')+(h==='Momentum'?' title="last-2h momentum: live vs its own 2h band"':'')+'>'+h+'</th>').join('');
  const td=cells.map((c,i)=>{
    const txt=cellText(c), cls=(c&&c.c)?c.c:'';
    if(i===0) return '<td class="left">'+txt+flag+inv+'</td>';
    const title=QUOTE_HEADERS[i]==='Momentum'?' title="'+momTitleOf(row)+'"':'';
    return '<td class="num '+cls+'"'+title+'>'+txt+'</td>';
  }).join('');
  return '<div class="tablewrap qtwrap"><table class="qtbl"><thead><tr>'+th+'</tr></thead><tbody><tr>'+td+'</tr></tbody></table></div>';
}
