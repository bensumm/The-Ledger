import { APP_VERSION, STRAT, STATE, applyCoffer, hasStore, ls, idb, sGet, sSet, logEvent, setHealth, clearLog } from './state.js';
import { fmt, parseGp } from './format.js';
import { loadAll } from './market.js';
import { renderFinder, addTrade, renderCoffer, recompute, setLedgerWatchOnly, setLedgerPeriod, toggleFillsLogLink, renderFillsLogLink, editManualLog } from './ui.js';
import { runTrends, reviewPositions } from './trends.js';
import './backup.js'; // side-effect import: wires up the Export/Import buttons' own event handlers; nothing else references its exports directly

/* tabs + events */
export function switchTab(name){
  document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===name));
  ['finder','trends','watch','signals','ledger','logs'].forEach(t=>document.getElementById('panel-'+t).classList.toggle('hidden', t!==name));
}
document.querySelectorAll('nav.tabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
document.getElementById('refreshBtn').onclick=()=>loadAll(false,true);
document.getElementById('statusBanner').onclick=()=>document.getElementById('statusBanner').classList.toggle('open');
document.getElementById('cofferToggle').onclick=async()=>{ STATE.cofferCollapsed=!STATE.cofferCollapsed; await sSet('cofferCollapsed',STATE.cofferCollapsed); applyCoffer(); };
document.getElementById('clearLog').onclick=clearLog;
document.getElementById('search').oninput=renderFinder;
document.getElementById('priceTier').onchange=renderFinder;
document.getElementById('sortSel').onchange=e=>{ STATE.sortKey=e.target.value; STATE.sortDir=-1; renderFinder(); };
document.getElementById('stratSel').onchange=async e=>{ STATE.strategy=e.target.value; await sSet('strategy',STATE.strategy); recompute(); };
document.getElementById('budgetToggle').onchange=e=>{ document.getElementById('budgetChip').classList.toggle('on',e.target.checked); renderFinder(); };
document.querySelectorAll('#finderTable thead th[data-k]').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k; if(STATE.sortKey===k) STATE.sortDir*=-1; else { STATE.sortKey=k; STATE.sortDir=(k==='name')?1:-1; }
  const sel=document.getElementById('sortSel'); if(['score','pph','margin','roi','volume'].includes(k)) sel.value=k; renderFinder();
});
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
const lwoEl=document.getElementById('ledgerWatchOnly'); if(lwoEl) lwoEl.onchange=e=>setLedgerWatchOnly(e.target.checked);
document.querySelectorAll('#ledgerPeriod button').forEach(b=>b.onclick=()=>setLedgerPeriod(b.dataset.period));
export const bankI=document.getElementById('bankInput');
bankI.onchange=async()=>{ const v=parseGp(bankI.value); if(!isNaN(v)){ STATE.bankroll=v; bankI.value=fmt(v); await sSet('bankroll',v); recompute(); } };
export const slotsI=document.getElementById('slotsInput');
slotsI.onchange=async()=>{ let v=parseInt(slotsI.value,10); if(isNaN(v)||v<1)v=1; if(v>8)v=8; STATE.slots=v; slotsI.value=v; await sSet('slots',v); recompute(); };

/* init */
(async function init(){
  const lg=await sGet('logring'); if(Array.isArray(lg)) STATE.LOG=lg;
  if(!hasStore && !ls) setHealth('storage','error','This browser is blocking storage (Private Browsing?) — your ledger and watchlist won\u2019t be saved. Export before closing.');
  else if(!hasStore && !idb) setHealth('storage','warn','Price history can\u2019t be cached on this device — flipping works, but Trends/Signals won\u2019t accumulate.');
  logEvent('info','storage','state\u2192'+(hasStore?'artifact':(ls?'localStorage':'memory'))+', archives\u2192'+(hasStore?'artifact':(idb?'IndexedDB':'memory')));
  const wl=await sGet('watchlist'); if(Array.isArray(wl)) STATE.watchlist=wl;
  const tr=await sGet('trades'); if(Array.isArray(tr)) STATE.trades=tr;
  const pn=await sGet('pinned'); if(Array.isArray(pn)) STATE.pinned=pn;
  const fh=await sGet('fillsHidden'); if(Array.isArray(fh)) STATE.fillsHidden=fh;
  const fp=await sGet('fillsPending'); if(Array.isArray(fp)) STATE.fillsPending=fp;
  const lwo=await sGet('ledgerWatchOnly'); if(typeof lwo==='boolean') STATE.ledgerWatchOnly=lwo;
  const lpd=await sGet('ledgerPeriod'); if(typeof lpd==='string') STATE.ledgerPeriod=lpd;
  const bk=await sGet('bankroll'); if(typeof bk==='number') STATE.bankroll=bk;
  const sl=await sGet('slots'); if(typeof sl==='number') STATE.slots=sl;
  const st=await sGet('strategy'); if(st&&STRAT[st]) STATE.strategy=st;
  const cc=await sGet('cofferCollapsed'); if(typeof cc==='boolean') STATE.cofferCollapsed=cc; applyCoffer();
  const av=document.getElementById('appVer'); if(av) av.textContent='v'+APP_VERSION;
  logEvent('info','app','The Coffer v'+APP_VERSION+' loaded');
  bankI.value=fmt(STATE.bankroll); slotsI.value=STATE.slots; document.getElementById('stratSel').value=STATE.strategy;
  renderCoffer();
  renderFillsLogLink();
  await loadAll();
})();
