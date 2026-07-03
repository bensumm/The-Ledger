/* Direct-to-fills-log writing via the File System Access API (Chromium: Edge/Chrome).
   The Coffer is a static page and can't silently touch disk, but with a user-granted file
   handle it can APPEND schema-correct lines to coffer-manual.log — the same sibling file
   pipeline/add-manual-fill.mjs writes and sync-fills.mjs already ingests. So a manual entry
   flows through the REAL reconstruction into positions.json and persists across every
   re-sync (it's a pipeline input, not a hand-edit of the derived view).

   The handle persists in IndexedDB (handles are structured-cloneable; localStorage can't
   hold them). readwrite permission is re-verified each session and re-requested on a user
   gesture — browsers drop the grant between sessions by design. */
import { idb } from './state.js';

const HKEY='fillsLogHandle';
const MANUAL_SLOT=8; // real GE slots are 0-7; 8 keeps synthetic events clear of live-slot cancel inference
let handle=null, loaded=false;

export function fsApiSupported(){ return typeof window!=='undefined' && typeof window.showOpenFilePicker==='function'; }

export async function loadHandle(){
  if(loaded) return handle;
  loaded=true;
  if(idb){ try{ handle=(await idb.get(HKEY))||null; }catch{ handle=null; } }
  return handle;
}
export async function isLinked(){ return !!(await loadHandle()); }
export async function linkedName(){ const h=await loadHandle(); return h?h.name:null; }

async function ensurePerm(request){
  const h=await loadHandle(); if(!h||!h.queryPermission) return false;
  const opts={mode:'readwrite'};
  try{ if(await h.queryPermission(opts)==='granted') return true;
       if(request && await h.requestPermission(opts)==='granted') return true; }catch{}
  return false;
}

export async function linkFillsLog(){
  if(!fsApiSupported()){ alert('Direct file writing needs Chrome or Edge on desktop (File System Access API). Use pipeline/add-manual-fill.mjs from the terminal instead.'); return false; }
  try{
    const [fh]=await window.showOpenFilePicker({ multiple:false,
      types:[{description:'Exchange log', accept:{'text/plain':['.log','.txt']}}] });
    handle=fh; loaded=true;
    if(idb) await idb.set(HKEY, handle);
    if(!(await ensurePerm(true))){ alert('Write permission was not granted — the fills log stays unlinked.'); return false; }
    return true;
  }catch(e){ if(e && e.name==='AbortError') return false; alert('Could not link the fills log: '+((e&&e.message)||e)); return false; }
}
export async function unlinkFillsLog(){ handle=null; loaded=true; if(idb){ try{ await idb.set(HKEY, null); }catch{} } }

// One schema-correct completed-offer line — identical shape to add-manual-fill.mjs / the plugin.
// priceEach is the pre-tax GROSS listing (reconstruction re-applies the 2% tax itself).
export function fillsLogLine({type,itemId,qty,priceEach,ts}){
  const d=new Date((ts||Math.floor(Date.now()/1000))*1000);
  const p=n=>String(n).padStart(2,'0');
  const date=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  const time=p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  const state=type==='buy'?'BOUGHT':'SOLD';
  return JSON.stringify({date,time,state,slot:MANUAL_SLOT,item:itemId,qty,worth:priceEach*qty,max:qty,offer:priceEach});
}

// Append lines (array of strings) to the linked file. Read-modify-write (createWritable
// truncates), fine for this small log. Returns true on success, false if unlinked/denied.
export async function appendFillsLog(lines){
  const h=await loadHandle(); if(!h) return false;
  if(!(await ensurePerm(true))) return false;
  let existing='';
  try{ existing=await (await h.getFile()).text(); }catch{}
  const sep=(existing && !existing.endsWith('\n'))?'\n':'';
  const w=await h.createWritable();
  await w.write(existing+sep+lines.join('\n')+'\n');
  await w.close();
  return true;
}
