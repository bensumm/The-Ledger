/* marketfetch.js — the shared browser fetch layer (A2).
   ONE timeout-guarded jget() plus a SINGLE cached single-item series/quote store (timeseries,
   24h, guide series). Mirrors the pipeline's marketfetch.mjs convention. Kept separate from
   market.js so quote.js can reuse the same jget/fetchTs without importing market.js — that
   import-cycle avoidance is exactly why the ~6 hand-rolled AbortController timeout bodies and
   the two fetchTs/fetchTimeseries copies existed; this module removes the duplication.
   The cache is a module-local Map — never reassigned, so the STATE-object rule (see the header
   comment in js/state.js) doesn't apply; a plain module const is correct here. */
import { API } from './state.js';

// User-Agent is a forbidden header in browsers (silently dropped); set for parity with the
// node scripts so both fetch layers read the same. 15s abort ceiling on every request.
const UA='TheCoffer/0.30 (bensumm; github.com/bensumm/The-Ledger)';
export async function jget(url){
  const ctrl=new AbortController(), to=setTimeout(()=>ctrl.abort(),15000);
  try{ const r=await fetch(url,{signal:ctrl.signal, headers:{'User-Agent':UA}}); if(!r.ok) throw new Error('http '+r.status); return await r.json(); }
  finally{ clearTimeout(to); }
}

const tsCache=new Map();   // one shared cache: id:step timeseries, v24:id 24h, g<id> guide series
export function clearTsCache(){ tsCache.clear(); }   // backup-import reset (was: delete every key)
// cache-through helper: stores the RESOLVED value (not the promise), matching the old
// "cache only after success" semantics — a failed fetch is not memoized.
export async function cached(key, fn){ if(tsCache.has(key)) return tsCache.get(key); const v=await fn(); tsCache.set(key,v); return v; }

export const fetchTs=(id,step)=>cached(id+':'+step, async()=>(await jget(API+'/timeseries?id='+id+'&timestep='+step)).data||[]);
export async function fetch24h(id){
  const key='v24:'+id; if(tsCache.has(key)) return tsCache.get(key);
  const j=await jget(API+'/24h?id='+id); const v=(j.data&&(j.data[id]||j.data[String(id)]))||null; if(v) tsCache.set(key,v); return v;   // only memoize a real value
}
