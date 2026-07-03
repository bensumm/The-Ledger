/* quote.js — browser orchestrator for the standard market table.
   Fetches ONE item's live/5m/6h/24h series + the app's guide, builds the row model via
   the DOM-free quotecore, and renders the canonical HTML table. On-demand only — never
   bulk-fetch across the universe (rate limits). Node scripts (chunk 3) do their own
   fetching and reuse quotecore directly; this module is the browser half.
   Deps: state.js, format.js, quotecore.js — deliberately NO import of trends.js/market.js
   so there's no import cycle (trends.js and ui.js import FROM here). */
import { API, STATE, tsCache } from './state.js';
import { fmtP, sgn } from './format.js';
import { computeQuote, quoteCells } from './quotecore.js';

/* User-Agent is a forbidden header in browsers (silently dropped) — the node scripts set it
   for real; kept here only so the two fetch layers read the same. */
const UA='TheCoffer/0.28 (bensumm; github.com/bensumm/The-Ledger)';
async function jget(url){
  const ctrl=new AbortController(), to=setTimeout(()=>ctrl.abort(),15000);
  try{ const r=await fetch(url,{signal:ctrl.signal, headers:{'User-Agent':UA}}); if(!r.ok) throw new Error('http '+r.status); return await r.json(); }
  finally{ clearTimeout(to); }
}
async function fetchTs(id,step){ const key=id+':'+step; if(tsCache[key]) return tsCache[key];   // shares trends.js's tsCache key scheme
  const d=(await jget(API+'/timeseries?id='+id+'&timestep='+step)).data||[]; tsCache[key]=d; return d; }
async function fetchLatest(id){ const j=await jget(API+'/latest?id='+id); return (j.data&&(j.data[id]||j.data[String(id)]))||(STATE.LATEST&&STATE.LATEST[id])||null; }
async function fetch24h(id){ const key='v24:'+id; if(tsCache[key]) return tsCache[key];
  const j=await jget(API+'/24h?id='+id); const v=(j.data&&(j.data[id]||j.data[String(id)]))||null; if(v) tsCache[key]=v; return v; }

const heldOpen=id=>!!(STATE.trades && STATE.trades.some(t=>t.itemId===id && t.sell===null));
const guideOf =id=>{ const g=STATE.GUIDE&&STATE.GUIDE[id]; return (g&&g.price)||null; };
const limitOf =id=>{ const m=(STATE.byId&&STATE.byId[id])||(STATE.catById&&STATE.catById[id]); return (m&&m.limit)||null; };

/* fetch + model in one call (Finder expander). opts.asked defaults true (user clicked/loaded it). */
export async function fetchQuote(id, opts={}){
  const [latest, ts5m, ts6h, vol24]=await Promise.all([fetchLatest(id), fetchTs(id,'5m'), fetchTs(id,'6h'), fetch24h(id)]);
  return computeQuote({ latest, ts5m, ts6h, vol24, guide:guideOf(id), limit:limitOf(id),
    held:heldOpen(id)||!!opts.held, asked:opts.asked!==false });
}

/* the canonical table as app HTML. Data cells come from quoteCells (byte-identical to the
   chunk-3 markdown); only wrapping/coloring/flags are app-specific. */
export function quoteTableHtml(name, row){
  const c=quoteCells(name, row);
  const flag = row.falling ? ' <span class="qflag loss" title="multi-day regime falling — price to clear, don’t list above the drop">falling</span>'
             : row.rising  ? ' <span class="qflag gold" title="multi-day regime rising">rising</span>' : '';
  const inv  = row.ordered ? '' : ' <span class="qflag loss" title="live low/high inverted in the feed — quote basis unreliable">⚠ basis</span>';
  const netCls=sgn(row.optNet);
  return '<div class="tablewrap qtwrap"><table class="qtbl"><thead><tr>'+
    '<th class="left">Item</th><th>Guide</th><th>Mid</th><th>Buy@ Q / Opt</th><th>Sell@ Q / Opt</th><th>Net/u Q / Opt (ROI)</th><th>Vol/d</th><th>Regime</th>'+
    '</tr></thead><tbody><tr>'+
    '<td class="left">'+c.item+flag+inv+'</td>'+
    '<td class="num">'+c.guide+'</td>'+
    '<td class="num">'+c.mid+'</td>'+
    '<td class="num">'+c.buy+'</td>'+
    '<td class="num">'+c.sell+'</td>'+
    '<td class="num '+netCls+'">'+c.net+'</td>'+
    '<td class="num mini">'+c.vol+'</td>'+
    '<td class="num">'+c.regime+'</td>'+
    '</tr></tbody></table></div>';
}
