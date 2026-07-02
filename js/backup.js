import { STRAT, STATE, tsCache, mem, hasStore, idb, sGet, sSet } from './state.js';
import { fmt } from './format.js';
import { rebuildDatalist } from './market.js';
import { renderAll, recompute } from './ui.js';

/* backup: export / import */
export function flashStamp(msg){ const s=document.getElementById('stamp'); const prev=s.innerHTML; s.textContent=msg; setTimeout(()=>{ if(s.textContent===msg) s.innerHTML=prev; },2600); }
export async function listArchiveIds(){
  if(hasStore){ try{ const r=await window.storage.list('tsa:'); const keys=(r&&r.keys)||[]; return keys.map(k=>typeof k==='string'?k:(k&&k.key)).filter(Boolean); }catch(e){} }
  else if(idb){ try{ const ks=await idb.keys(); return ks.filter(k=>typeof k==='string'&&k.indexOf('tsa:')===0); }catch(e){} }
  return Object.keys(mem).filter(k=>k.indexOf('tsa:')===0);
}
export async function buildBackup(){
  const archives={}; for(const k of await listArchiveIds()){ const v=await sGet(k); if(v) archives[k.slice(4)]=v; }
  return { app:'the-coffer', version:1, exportedAt:new Date().toISOString(),
    data:{ watchlist:STATE.watchlist, trades:STATE.trades, pinned:STATE.pinned, bankroll:STATE.bankroll, slots:STATE.slots, strategy:STATE.strategy, archives } };
}
export async function doExport(){
  try{
    const b=await buildBackup();
    const blob=new Blob([JSON.stringify(b)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download='coffer-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
    flashStamp('backup exported');
  }catch(e){ alert('Export failed.'); }
}
export async function applyBackup(obj){
  const d=obj&&obj.data; if(!d) throw new Error('bad');
  if(Array.isArray(d.watchlist)){ STATE.watchlist=d.watchlist; await sSet('watchlist',STATE.watchlist); }
  if(Array.isArray(d.pinned)){ STATE.pinned=d.pinned; await sSet('pinned',STATE.pinned); }
  if(Array.isArray(d.trades)){ STATE.trades=d.trades; await sSet('trades',STATE.trades); }
  if(typeof d.bankroll==='number'){ STATE.bankroll=d.bankroll; await sSet('bankroll',STATE.bankroll); }
  if(typeof d.slots==='number'){ STATE.slots=d.slots; await sSet('slots',STATE.slots); }
  if(d.strategy&&STRAT[d.strategy]){ STATE.strategy=d.strategy; await sSet('strategy',STATE.strategy); }
  if(d.archives&&typeof d.archives==='object'){ for(const id in d.archives){ await sSet('tsa:'+id,d.archives[id]); } }
  document.getElementById('bankInput').value=fmt(STATE.bankroll);
  document.getElementById('slotsInput').value=STATE.slots;
  document.getElementById('stratSel').value=STATE.strategy;
  for(const k in tsCache) delete tsCache[k];
  rebuildDatalist();
}
export function doImport(file){
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const obj=JSON.parse(reader.result);
      if(!obj||obj.app!=='the-coffer'){ if(!confirm('This doesn’t look like a Coffer backup. Import anyway?')) return; }
      const n=(obj.data&&obj.data.archives)?Object.keys(obj.data.archives).length:0;
      if(!confirm('Import this backup? It overwrites the watchlist, ledger, settings and '+n+' hourly archive'+(n===1?'':'s')+' on this device.')) return;
      await applyBackup(obj);
      if(STATE.ITEMS.length) recompute(); else renderAll();
      flashStamp('backup imported');
    }catch(e){ alert('Could not read that backup file.'); }
  };
  reader.readAsText(file);
}
document.getElementById('exportBtn').onclick=doExport;
document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
document.getElementById('importFile').onchange=e=>{ const f=e.target.files[0]; if(f) doImport(f); e.target.value=''; };

