import { APP_VERSION, STRAT, STATE, applyCoffer, hasStore, ls, idb, sGet, sSet, logEvent, setHealth, clearLog, setLogFilter } from './state.js';
import { fmt, parseGp } from './money-format.js';
import { loadAll } from './market.js';
import { renderFinder, renderCoffer, recompute, renderScan, refreshScan, loadRepoWatchlist, loadRepoIgnored, finderSort } from './ui.js';
import { addTrade, setLedgerWatchOnly, setLedgerPeriod, toggleFillsLogLink, renderFillsLogLink, editManualLog, renderGhSync, startLocalPoll } from './ledger.js';   // A3: ledger + fills-write cluster; LW2: localhost live-refresh poll
import { enterWatch, leaveWatch, refreshWatchQuotes } from './watch.js';   // WATCH tab: verdict-first flipping desk
import { savePat } from './github.js';
import { runTrends, reviewPositions } from './trends.js';
import './backup.js'; // side-effect import: wires up the Export/Import buttons' own event handlers; nothing else references its exports directly

/* tabs + events */
const TAB_NAMES=['finder','scan','trends','watchlist','ignore','watch','ledger','logs'];
// Each tab is now a real URL path (Ben, 2026-07-16) — #<tab> in the hash, so a browser reload
// (e.g. "Refresh scan" doing a full location.reload() after a local re-scan) lands back on the
// SAME tab instead of always resetting to Finder. `push` writes the hash (a genuine tab-click);
// `false` is used on load/hashchange-driven calls so restoring from the URL doesn't itself write
// a redundant history entry.
export function switchTab(name, push=true){
  if(!TAB_NAMES.includes(name)) return;
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  TAB_NAMES.forEach(t=>document.getElementById('panel-'+t).classList.toggle('hidden', t!==name));
  if(push && location.hash.slice(1)!==name) location.hash=name;
  if(name==='scan') renderScan();   // lazy: fetch the published screen.json on first open (cached after)
  if(name==='watch') enterWatch(); else leaveWatch();   // WATCH: re-quote loop runs only while the tab is visible
}
// L1 action logging: instrument at the event handler (a genuine user click), NOT inside the
// shared switchTab/loadAll functions — those also run on programmatic/init paths we don't log.
document.querySelectorAll('nav.tabs button').forEach(b=>b.onclick=()=>{ logEvent('info','action','tab → '+b.dataset.tab); switchTab(b.dataset.tab); });
// Restore the tab from the URL on load (a fresh load OR a location.reload() from a refresh
// button) and on back/forward navigation between tabs. An absent/invalid hash keeps the
// HTML-default (Finder, the only panel not marked `hidden` in index.html) untouched.
{ const h=location.hash.slice(1); if(TAB_NAMES.includes(h)) switchTab(h, false); }
window.addEventListener('hashchange', ()=>{ const h=location.hash.slice(1); if(TAB_NAMES.includes(h)) switchTab(h, false); });
document.getElementById('refreshBtn').onclick=()=>{ logEvent('info','action','manual price refresh'); loadAll(false,true); };
document.getElementById('statusBanner').onclick=()=>document.getElementById('statusBanner').classList.toggle('open');
document.getElementById('cofferToggle').onclick=async()=>{ STATE.cofferCollapsed=!STATE.cofferCollapsed; await sSet('cofferCollapsed',STATE.cofferCollapsed); applyCoffer(); };
document.getElementById('clearLog').onclick=clearLog;
document.querySelectorAll('#logFilter button').forEach(b=>b.onclick=()=>setLogFilter(b.dataset.f));
document.getElementById('search').oninput=renderFinder;
document.getElementById('priceTier').onchange=renderFinder;
document.getElementById('sortSel').onchange=e=>{ finderSort.setSort(e.target.value,-1); renderFinder(); };
document.getElementById('stratSel').onchange=async e=>{ STATE.strategy=e.target.value; logEvent('info','action','strategy → '+STATE.strategy); await sSet('strategy',STATE.strategy); recompute(); };
document.getElementById('budgetToggle').onchange=e=>{ document.getElementById('budgetChip').classList.toggle('on',e.target.checked); renderFinder(); };
// Finder header click-to-sort + the sort-select sync are owned by finderSort (js/table.js, TB1).
const scanRef=document.getElementById('scanRefresh'); if(scanRef) scanRef.onclick=()=>{ logEvent('info','action','scan refresh'); refreshScan(scanRef); };
document.getElementById('trLoad').onclick=runTrends;
document.getElementById('trItem').addEventListener('keydown',e=>{ if(e.key==='Enter') runTrends(); });
document.getElementById('addTrade').onclick=addTrade;
function wireSeg(id,cb){ const el=document.getElementById(id); if(!el) return;
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{ el.dataset.mode=b.dataset.mode;
    el.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); if(cb) cb(b.dataset.mode); }); }
wireSeg('tType',mode=>{ // buy | sell | withdraw (no price) | banked (basis instead of buy price)
  const sell=mode==='sell', priced=(mode==='buy'||mode==='banked');
  document.querySelectorAll('.ledgerform .sellonly').forEach(e=>e.classList.toggle('hidden',!sell));
  document.querySelectorAll('.ledgerform .buyonly').forEach(e=>e.classList.toggle('hidden',!priced));
  const bl=document.getElementById('tBuyLabel'); if(bl) bl.textContent=mode==='banked'?'Basis (each)':'Buy price (each)';
  document.getElementById('addTrade').textContent=
    mode==='sell'?'Log sale':mode==='withdraw'?'Log withdrawal':mode==='banked'?'Add banked stock':'Open position'; });
wireSeg('tTax');
document.getElementById('reviewPos').onclick=reviewPositions;
const fll=document.getElementById('fillsLogLink'); if(fll) fll.onclick=toggleFillsLogLink;
const mle=document.getElementById('manualLogEdit'); if(mle) mle.onclick=editManualLog;
// M1: GitHub token save/remove. NEVER log or echo the token value — only the action.
const ghSaveBtn=document.getElementById('ghPatSave');
if(ghSaveBtn) ghSaveBtn.onclick=()=>{ const inp=document.getElementById('ghPat'); const v=(inp&&inp.value)||'';
  if(!v.trim()){ renderGhSync(); return; }
  if(!savePat(v)){ alert('This browser is blocking storage (Private Browsing?) — the token can’t be saved.'); return; }
  if(inp) inp.value=''; logEvent('info','action','PAT updated'); renderGhSync(); };
const ghClearBtn=document.getElementById('ghPatClear');
if(ghClearBtn) ghClearBtn.onclick=()=>{ if(!confirm('Remove the saved GitHub token from this device?')) return;
  savePat(''); logEvent('info','action','PAT removed'); renderGhSync(); };
const lwoEl=document.getElementById('ledgerWatchOnly'); if(lwoEl) lwoEl.onchange=e=>setLedgerWatchOnly(e.target.checked);
document.querySelectorAll('#ledgerPeriod button').forEach(b=>b.onclick=()=>setLedgerPeriod(b.dataset.period));
// LU1.4: the manual-entry form is a collapsible <details>, collapsed by default; persist its state.
const lfd=document.getElementById('ledgerFormD'); if(lfd) lfd.ontoggle=()=>sSet('ledgerFormOpen', lfd.open);
export const bankI=document.getElementById('bankInput');
bankI.onchange=async()=>{ const v=parseGp(bankI.value); if(!isNaN(v)){ STATE.bankroll=v; bankI.value=fmt(v); logEvent('info','action','bankroll → '+fmt(v)); await sSet('bankroll',v); recompute(); } };
export const slotsI=document.getElementById('slotsInput');
slotsI.onchange=async()=>{ let v=parseInt(slotsI.value,10); if(isNaN(v)||v<1)v=1; if(v>8)v=8; STATE.slots=v; slotsI.value=v; logEvent('info','action','slots → '+v); await sSet('slots',v); recompute(); };

/* init */
(async function init(){
  const lg=await sGet('logring'); if(Array.isArray(lg)) STATE.LOG=lg;
  if(!hasStore && !ls) setHealth('storage','error','This browser is blocking storage (Private Browsing?) — your ledger and watchlist won\u2019t be saved. Export before closing.');
  else if(!hasStore && !idb) setHealth('storage','warn','Price history can\u2019t be cached on this device — flipping works, but Trends won\u2019t accumulate.');
  logEvent('info','storage','state\u2192'+(hasStore?'artifact':(ls?'localStorage':'memory'))+', archives\u2192'+(hasStore?'artifact':(idb?'IndexedDB':'memory')));
  const wl=await sGet('watchlist'); if(Array.isArray(wl)) STATE.watchlist=wl;
  const ig=await sGet('ignored'); if(Array.isArray(ig)) STATE.ignored=ig;
  const tr=await sGet('trades'); if(Array.isArray(tr)) STATE.trades=tr;
  const pn=await sGet('pinned'); if(Array.isArray(pn)) STATE.pinned=pn;
  const fh=await sGet('fillsHidden'); if(Array.isArray(fh)) STATE.fillsHidden=fh;
  const fp=await sGet('fillsPending'); if(Array.isArray(fp)) STATE.fillsPending=fp;
  const lwo=await sGet('ledgerWatchOnly'); if(typeof lwo==='boolean') STATE.ledgerWatchOnly=lwo;
  const lpd=await sGet('ledgerPeriod'); if(typeof lpd==='string') STATE.ledgerPeriod=lpd;
  const lfo=await sGet('ledgerFormOpen'); if(lfo===true){ const d=document.getElementById('ledgerFormD'); if(d) d.open=true; }  // LU1.4: restore expanded form (collapsed default)
  const bk=await sGet('bankroll'); if(typeof bk==='number') STATE.bankroll=bk;
  const sl=await sGet('slots'); if(typeof sl==='number') STATE.slots=sl;
  const st=await sGet('strategy'); if(st&&STRAT[st]) STATE.strategy=st;
  const cc=await sGet('cofferCollapsed'); if(typeof cc==='boolean') STATE.cofferCollapsed=cc; applyCoffer();
  const av=document.getElementById('appVer'); if(av) av.textContent='v'+APP_VERSION;
  logEvent('info','app','The Coffer v'+APP_VERSION+' loaded');
  bankI.value=fmt(STATE.bankroll); slotsI.value=STATE.slots; document.getElementById('stratSel').value=STATE.strategy;
  renderCoffer();
  renderFillsLogLink();
  renderGhSync();
  await loadAll();
  loadRepoWatchlist();   // S3: union repo watchlist.json into STATE.watchlist (in-memory, post-mapping)
  loadRepoIgnored();     // union repo ignored-items.json into STATE.ignored (editor tab; pipeline applies the filter)
  startLocalPoll();      // LW2: localhost only — poll positions.json/offers.json every ~30s for the local watch-log daemon's rewrites (no-op on the deployed origin)
  setTimeout(refreshWatchQuotes, 1500);   // WATCH: one background quote pass so the tab's alert badge is live before it's opened (syncFills populates STATE.trades first)
})();
