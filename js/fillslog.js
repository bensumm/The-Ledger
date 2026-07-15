/* Direct-to-fills-log writing via the File System Access API (Chromium: Edge/Chrome).
   The Coffer is a static page and can't silently touch disk, but with a user-granted file
   handle it can APPEND schema-correct lines to coffer-manual.log — the same sibling file
   pipeline/commands/add-manual-fill.mjs writes and sync-fills.mjs already ingests. So a manual entry
   flows through the REAL reconstruction into positions.json and persists across every
   re-sync (it's a pipeline input, not a hand-edit of the derived view).

   The handle persists in IndexedDB (handles are structured-cloneable; localStorage can't
   hold them). readwrite permission is re-verified each session and re-requested on a user
   gesture — browsers drop the grant between sessions by design. */
import { idb } from './state.js';

const HKEY='fillsLogHandle';
const MANUAL_SLOT=8; // real GE slots are 0-7; 8 keeps synthetic events clear of live-slot cancel inference
export const MOBILE_SLOT=9; // M1: mobile GitHub-as-backend entries (mobile-fills.log) — distinct from desktop/CLI slot 8 so provenance stays visible
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
  if(!fsApiSupported()){ alert('Direct file writing needs Chrome or Edge on desktop (File System Access API). Use pipeline/commands/add-manual-fill.mjs from the terminal instead.'); return false; }
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
// type: 'buy' | 'sell' | 'withdraw' (inventory taken for personal use — price 0, consumes
// open lots FIFO at realised 0) | 'banked' (pre-owned inventory entering the flip flow at a
// declared basis). See the manual-line vocabulary in pipeline/commands/sync-fills.mjs.
// `slot` defaults to the desktop/CLI MANUAL_SLOT (8); mobile GitHub writes pass MOBILE_SLOT (9).
export function fillsLogLine({type,itemId,qty,priceEach,ts,slot}){
  const d=new Date((ts||Math.floor(Date.now()/1000))*1000);
  const p=n=>String(n).padStart(2,'0');
  const date=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  const time=p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  const state=type==='buy'?'BOUGHT':type==='sell'?'SOLD':type==='withdraw'?'WITHDRAWN':'BANKED';
  return JSON.stringify({date,time,state,slot:slot||MANUAL_SLOT,item:itemId,qty,worth:priceEach*qty,max:qty,offer:priceEach});
}
// Tombstone directive: on the next sync, sync-fills.mjs deletes the target event id from the
// merged set — including events already persisted in fills.json (PLAN.md chunk 1.4).
export function tombstoneLine(eventId){ return JSON.stringify({state:'REMOVE',target:eventId}); }

// Normalize a parsed manual-log line ({date,time,state,slot,item,qty,worth,max,offer}) into
// the event shape sync-fills.mjs hashes. Mirrors its parseJsonLine() for the manual subset:
// manual lines are always terminal ('complete') with filled = qty field, spent = worth field.
export function manualLineEvent(o){
  const ts=Math.floor(Date.parse(o.date+'T'+o.time)/1000);
  const st=String(o.state||'').toUpperCase();
  const type= st.includes('WITHDRAW')?'withdraw'
            : st.includes('BANK')?'banked'
            : (st.includes('BUY')||st.includes('BOUGHT'))?'buy':'sell';
  return {ts, slot:Number(o.slot), itemId:Number(o.item), type, state:'complete', filled:Number(o.qty)||0, spent:Number(o.worth)||0};
}
// Event id = sha1 content hash, SAME ALGORITHM as eventId() in pipeline/reconstruct.mjs
// ([ts,slot,itemId,type,state,filled,spent].join('|'), first 16 hex chars). If either side
// changes, tombstones written by the app stop matching pipeline events — keep them in sync.
export async function eventIdFor(evt){
  const data=new TextEncoder().encode([evt.ts,evt.slot,evt.itemId,evt.type,evt.state,evt.filled,evt.spent].join('|'));
  const buf=await crypto.subtle.digest('SHA-1',data);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
}

// Full text of the linked log, or null if unlinked/denied/unreadable.
export async function readFillsLog(){
  const h=await loadHandle(); if(!h) return null;
  if(!(await ensurePerm(true))) return null;
  try{ return await (await h.getFile()).text(); }catch{ return null; }
}
// Replace ONE line of the linked log (exact-string match after trim) with zero or more
// replacement lines — the edit/delete path for manual entries (PLAN.md chunk 1.3). Read →
// splice → truncate-write, same pattern as appendFillsLog. Fails loudly ({ok:false,reason})
// when the line isn't found rather than fuzzy-matching; nothing is written in that case.
export async function rewriteFillsLog(oldLine, newLines){
  const h=await loadHandle(); if(!h) return {ok:false, reason:'fills log not linked'};
  if(!(await ensurePerm(true))) return {ok:false, reason:'write permission denied'};
  let text='';
  try{ text=await (await h.getFile()).text(); }catch(e){ return {ok:false, reason:'could not read '+h.name+': '+((e&&e.message)||e)}; }
  const lines=text.split(/\r?\n/);
  const idx=lines.findIndex(l=>l.trim()===oldLine.trim());
  if(idx<0) return {ok:false, reason:'line not found in '+h.name+' (edited outside the app?) — nothing was changed'};
  lines.splice(idx,1,...newLines);
  const w=await h.createWritable();
  await w.write(lines.join('\n'));
  await w.close();
  return {ok:true};
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
