import { now } from './money-math.js';
import { pad2 } from './money-format.js';

/*
 * THE STATE OBJECT — read before adding shared mutable state.
 * Almost all app-wide mutable state (ITEMS, watchlist, trades, bankroll, LOG, ...)
 * lives as properties on the single exported object `STATE` below, accessed everywhere as
 * STATE.xxx — NOT as bare imported `let` bindings. This is a hard ES module constraint, not
 * a style choice: a module can `export let x` and other modules can *read* x, but only the
 * declaring module can *reassign* x — any other module doing `x = newValue` on an imported
 * binding is a SyntaxError. Since market.js, ui.js, trends.js, main.js, and backup.js all
 * REASSIGN things like ITEMS/watchlist/bankroll (not just mutate in place), those had to
 * become properties of one shared object (`STATE.ITEMS = ...` is a property mutation on an
 * object every module holds the same reference to — always legal).
 * When adding new shared mutable state, put it on STATE, not as a new bare `export let`.
 * Constants that are never reassigned (API, APP_VERSION, weight constants, ...) stay as
 * plain `export const` — no need to route those through STATE.
 * (Moved here from CLAUDE.md by PLAN.md chunk K3 — this is the one place every editor of
 * shared state already looks; CLAUDE.md process rules keep a one-line pointer.)
 */

export const API='https://prices.runescape.wiki/api/v1/osrs';
export const APP_VERSION='0.64.2';
// LW2: true only when the app is served from a local dev host (serve.cmd → localhost). Used to
// gate the local live-refresh poll + freshness stamp; on the deployed origin (bensumm.github.io)
// it's false and every LW2 behavior stays off (M1 banner + Refresh button remain the mechanism).
// Guarded so importing state.js outside a browser (never today, but cheap) doesn't throw.
export const IS_LOCALHOST=(typeof location!=='undefined' && (location.hostname==='localhost' || location.hostname==='127.0.0.1'));
// Finder rating model — four transparent 0..1 sub-scores blended into a quality
// multiplier that dampens the profit/hr magnitude anchor. Weights sum to 1.
// (These become Settings-tab editable next pass.)
export const RATE_W={roi:0.30, vol:0.25, stab:0.25, turn:0.20};
export const RATE_ROI_MAX=6;        // % after-tax ROI that maxes the ROI factor
export const RATE_VOL_MAX=20000;    // hourly volume that maxes the liquidity factor (log-scaled)
export const RATE_TURN_FAST=0.25;   // h · turnaround at/under this = full marks
export const RATE_TURN_SLOW=6;      // h · turnaround at/over this = zero
export const MAXPART=0.15;          // market-impact guardrail: capture ≤15% of hourly volume per fill
export const DIV_FULL=0.08;         // divergence (8%) that maps trend intensity → 1.0
export const Z_BAND=1.0;            // |z| under this = within normal noise (no edge)
export const UP_RISK=0.30;          // uptrend contributes less to risk than a downtrend (reversion only)
export const MIN_PRICE=1000, MIN_VOL=30;
export const FRESH_S=900, STALE_S=21600;
export const STRAT={conservative:{damp:0.85}, balanced:{damp:0.6}, aggressive:{damp:0.35}};
export const MARKET_TTL=180;          // s · reuse stored /latest+/1h snapshot if newer (cold-start throttle)
export const ARCHIVE_MIN_GAP=55*60;   // s · skip watchlist archiving if done within the hour (/1h gains a point hourly)
export const GUIDE_TTL=6*3600;        // s · official guide updates ~daily; cache the parsed map this long
export const GUIDE_DUMP='https://chisel.weirdgloop.org/gazproj/gazbot/os_dump.json';
export const GUIDE_MODULE='https://oldschool.runescape.wiki/w/Module:GEPricesByIDs/data.json?action=raw';
export const GUIDE_HIST='https://api.weirdgloop.org/exchange/history/osrs/last90d?id=';

export const STATE = {
  MAP: null, LATEST: null, VOL: null, ITEMS: [], byId: {}, byName: {},
  GUIDE: {},
  watchlist: [], trades: [], pinned: [], bankroll: 300_000_000, slots: 6, strategy: 'balanced',
  ignored: [], ignoredMeta: { _doc: null, greenlisted: [] },   // MERCH-book quarantine editor: {id,name,reason}[]; meta preserves the file's _doc + greenlisted on write-back (pipeline applies the filter)
  fillsHidden: [], fillsUnmatched: [], fillsTs: 0,   // auto-populated ledger from positions.json (RuneLite fills)
  offers: [], offersTs: 0,   // LW2: live GE offer snapshot from offers.json (localhost poll) — data home for the future Watch tab
  heartbeatTs: 0,   // LW3: epoch-seconds of the local daemon's last heartbeat.json write (localhost poll) — DAEMON LIVENESS, independent of book changes (positions.generatedAt freezes on quiet no-fill stretches)

  fillsPending: [],   // optimistic rows for manual entries just written to coffer-manual.log, shown until the next sync absorbs them
  catById: {}, catByName: {},   // full-catalog indices (every mapped item, no flip floor)
  cofferCollapsed: false,
  ledgerWatchOnly: true, ledgerPeriod: 'all', ledgerExpanded: {}, ledgerBucket: null,  // Ledger view: filter to watchlist, P&L bucket size (by sell date), drilled-in item groups, active period-bucket filter (LU1.3 — session-only, not persisted)
  LOG: [],                     // {t, level, scope, msg}
  logFilter: 'all'             // Logs view scope filter (L1): all | action | system
};
export function applyCoffer(){ const w=document.getElementById('cofferWrap'); if(w) w.classList.toggle('collapsed',STATE.cofferCollapsed); }
// (A2) the single-item series/quote cache moved to js/marketfetch.js (module-local Map).

/* persistence
   - artifact window.storage when present (Claude sandbox)
   - else: small/irreplaceable state → localStorage (synchronous, reliable)
           bulky/regenerable data (hourly archives, market snapshots) → IndexedDB
   - in-memory fallback when a tier is unavailable (e.g. Private Browsing) */
export const mem={};
export const hasStore=(typeof window!=='undefined' && window.storage && typeof window.storage.get==='function');
export const ls=(()=>{ try{ const k='__coffer_probe__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return localStorage; }catch(e){ return null; } })();
export const idb=(()=>{
  if(typeof indexedDB==='undefined') return null;
  let dbp=null;
  const db=()=>dbp||(dbp=new Promise((res,rej)=>{
    const r=indexedDB.open('coffer',1);
    r.onupgradeneeded=()=>{ const d=r.result; if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  }));
  const req=(mode,fn)=>db().then(d=>new Promise((res,rej)=>{
    const tx=d.transaction('kv',mode); const rq=fn(tx.objectStore('kv')); let result;
    rq.onsuccess=()=>{ result=rq.result; }; rq.onerror=()=>rej(rq.error);
    tx.oncomplete=()=>res(result); tx.onerror=()=>rej(tx.error); tx.onabort=()=>rej(tx.error);  // resolve on commit, not just request success
  }));
  return { get:k=>req('readonly',s=>s.get(k)), set:(k,v)=>req('readwrite',s=>s.put(v,k)), keys:()=>req('readonly',s=>s.getAllKeys()) };
})();
export const isBulk=k=>k.indexOf('tsa:')===0 || k==='snap_latest' || k==='snap_vol';
export async function sGet(k){
  if(hasStore){ try{ const r=await window.storage.get(k); return r?JSON.parse(r.value):null; }catch(e){ return null; } }
  if(isBulk(k)){ if(idb){ try{ const v=await idb.get(k); if(v!==undefined) return v; }catch(e){} } }
  else if(ls){ try{ const v=ls.getItem(k); return v==null?null:JSON.parse(v); }catch(e){} }
  return k in mem?mem[k]:null;
}
export async function sSet(k,v){
  if(hasStore){ try{ await window.storage.set(k,JSON.stringify(v)); return; }catch(e){} }
  else if(isBulk(k)){ if(idb){ try{ await idb.set(k,v); return; }catch(e){} } }
  else if(ls){ try{ ls.setItem(k,JSON.stringify(v)); return; }catch(e){} }
  mem[k]=v;
}

/* ---- diagnostics: log ring + health model + status banner ---- */
export const LOG_MAX=200;   // L1: raised 50→200 now that user actions are logged alongside system events
export const HEALTH={};            // scope -> {level, msg}
export const SEV={ok:0, info:1, warn:2, error:3};
export function logEvent(level, scope, msg){
  STATE.LOG.push({t:now(), level, scope, msg});
  if(STATE.LOG.length>LOG_MAX) STATE.LOG=STATE.LOG.slice(-LOG_MAX);
  sSet('logring', STATE.LOG);
  renderBanner();
}
export function setHealth(scope, level, msg){
  const prev=HEALTH[scope]; HEALTH[scope]={level, msg};
  if((!prev || prev.level!==level) && level!=='ok') logEvent(level, scope, msg);
  else renderBanner();
}
export function worstHealth(){
  let worst=null;
  for(const k in HEALTH){ const h=HEALTH[k]; if(h.level==='ok') continue; if(!worst||SEV[h.level]>SEV[worst.level]) worst=h; }
  return worst;
}
// L1: scope filter for the Logs view — 'action' = user actions (scope 'action'),
// 'system' = everything else (market/guide/storage/fills/…), 'all' = both. The banner
// dropdown always passes 'all'; only the Logs tab honours STATE.logFilter.
export function logRowsHtml(withDate, filter){
  let rows=STATE.LOG;
  if(filter==='action') rows=rows.filter(e=>e.scope==='action');
  else if(filter==='system') rows=rows.filter(e=>e.scope!=='action');
  if(!rows.length) return '<span class="empty2">No events logged.</span>';
  return rows.slice().reverse().map(e=>{
    const cl=e.level==='error'?'ler':(e.level==='warn'?'lw':'li');
    const d=new Date(e.t*1000);
    const tm=(withDate?(pad2(d.getMonth()+1)+'/'+pad2(d.getDate())+' '):'')+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    return '<div class="le"><span class="lt">'+tm+'</span> <span class="'+cl+'">'+e.level.toUpperCase()+'</span> ['+e.scope+'] '+e.msg+'</div>';
  }).join('');
}
export function renderLogViews(){
  const lg=document.getElementById('bannerLog'); if(lg) lg.innerHTML=logRowsHtml(false);
  const tb=document.getElementById('logsBody'); if(tb) tb.innerHTML=logRowsHtml(true, STATE.logFilter);
}
export function setLogFilter(f){
  STATE.logFilter=f;
  document.querySelectorAll('#logFilter button').forEach(b=>b.classList.toggle('on', b.dataset.f===f));
  renderLogViews();
}
export function renderBanner(){
  const el=document.getElementById('statusBanner'); if(!el) return;
  const w=worstHealth();
  el.classList.remove('show','warn','error');
  if(!w){ el.classList.remove('open'); }
  else { el.classList.add('show', w.level==='error'?'error':'warn'); document.getElementById('bannerText').innerHTML=w.msg; }
  renderLogViews();
}
export async function clearLog(){
  STATE.LOG=[]; for(const k in HEALTH) delete HEALTH[k];
  await sSet('logring',STATE.LOG); renderBanner();
}

