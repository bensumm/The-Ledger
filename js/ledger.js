/* ledger.js — the Ledger view + fills-write cluster (A3, split out of ui.js).
   Owns: manual-entry writes (desktop coffer-manual.log / mobile mobile-fills.log), the
   optimistic pending rows, the positions.json auto-populate (syncFills), the Ledger render
   (open/closed groups, period P&L, pending, legacy banner), fills freshness/meta, the
   GitHub-sync + fills-log link panels, and the Ledger view controls (watchlist-only filter,
   period, group drill-in). ui.js keeps Finder/Watchlist/Signals/Coffer/Scan; renderAll (ui.js)
   stays the single coordination point and calls renderLedger here. A3 was a PURE MOVE — no
   logic changed. `realised`, `renderCoffer`, `FILLS_STALE_MS` and `fmtAge` stay in ui.js
   (shared with the Coffer/Scan surfaces) and are imported back here. */
import { STATE, sSet, logEvent, setHealth } from './state.js';
import { tax, netMarginQty, fmt, fmtP, parseGp, now, pad2, sgn } from './format.js';
import { resolveItem, resolveId } from './market.js';
import { openTrends } from './trends.js';
import { makeSortable } from './table.js';
import { periodKey, groupTrades } from './ledgercore.js';
import { renderAll, renderCoffer, realised, FILLS_STALE_MS, fmtAge } from './ui.js';
import { isLinked, appendFillsLog, fillsLogLine, fsApiSupported, linkFillsLog, unlinkFillsLog, linkedName,
         tombstoneLine, manualLineEvent, eventIdFor, readFillsLog, rewriteFillsLog, MOBILE_SLOT } from './fillslog.js';
import { hasPat, ghConfigured, ghTarget, appendMobileLines } from './github.js';

/* ledger — manual entries are LOG-ONLY (PLAN.md chunk 1): every manual buy/sell/withdraw/
   banked writes a line to coffer-manual.log through the linked file handle, shows as an
   optimistic pending row, and becomes real when the pipeline sync folds it into
   positions.json. There is no browser-local trade path any more — unlinked = guidance
   message, nothing created. */
function fillsMsg(m){ const el=document.getElementById('fillsLogStatus'); if(el){ el.textContent=m; el.classList.remove('hidden'); } }
// Write a manual entry straight into coffer-manual.log and stage an optimistic row until
// the next sync folds it into positions.json (see fillslog.js). The exact serialized line
// is kept on the pending row so Edit/Delete can rewrite it by exact-string match later.
async function writeToFillsLog(kind, it, qty, priceEach, ts){
  const line=fillsLogLine({type:kind, itemId:it.id, qty, priceEach, ts});
  const ok=await appendFillsLog([line]);
  if(!ok) return false;
  STATE.fillsPending.push({ id:'p'+Date.now()+Math.random().toString(36).slice(2,5), kind, itemId:it.id, name:it.name, qty, each:priceEach, ts:ts||now(), created:now(), line });
  await sSet('fillsPending', STATE.fillsPending);
  return true;
}
// M1: mobile write path — append a slot-9 line to repo-root mobile-fills.log via the GitHub
// contents API, then stage the same optimistic pending row (tagged origin:'gh' so Edit/Delete
// route back through GitHub, not the desktop file handle). Returns {ok, reason}.
async function writeToMobileLog(kind, it, qty, priceEach, ts){
  const line=fillsLogLine({type:kind, itemId:it.id, qty, priceEach, ts, slot:MOBILE_SLOT});
  const res=await appendMobileLines([line], 'mobile: '+kind+' '+qty+'× item '+it.id);
  if(!res.ok) return res;
  STATE.fillsPending.push({ id:'p'+Date.now()+Math.random().toString(36).slice(2,5), kind, itemId:it.id, name:it.name, qty, each:priceEach, ts:ts||now(), created:now(), line, origin:'gh' });
  await sSet('fillsPending', STATE.fillsPending);
  return {ok:true};
}
export async function addTrade(){
  const tt=document.getElementById('tType'), mode=tt?tt.dataset.mode:'buy';
  const name=document.getElementById('tItem').value.trim();
  const qty=parseGp(document.getElementById('tQty').value)||1;
  if(!name){ alert('Enter an item.'); return; }
  const it=resolveItem(name);
  if(!it){ alert('Item not recognised — pick the exact name from the list (manual entries need the item id for the log).'); return; }
  // Pick the write path: desktop File System Access (coffer-manual.log, slot 8) if the log is
  // linked; else the mobile GitHub contents-API path (mobile-fills.log, slot 9) when a token is
  // saved. Neither available -> guidance, nothing created.
  const linked=await isLinked(), gh=ghConfigured();
  if(!linked && !gh){
    fillsMsg('Nothing was logged — manual entries persist only through a source log. On desktop click “Link fills log…” (Edge/Chrome); on mobile save a GitHub token under “GitHub sync” below. (Or use pipeline/add-manual-fill.mjs from the terminal.)');
    return;
  }
  // Optional real trade time (chunk 1.2). Backdated trades MUST carry the time the trade
  // actually happened — FIFO matching is timestamp-ordered (the phantom-bludgeons lesson).
  let ts; const whenEl=document.getElementById('tWhen');
  if(whenEl && whenEl.value){
    ts=Math.floor(new Date(whenEl.value).getTime()/1000);
    if(!Number.isFinite(ts)){ alert('Invalid “when” — use the picker, or leave it blank for “now”.'); return; }
  }
  let each=0;
  if(mode==='sell'){
    let sell=parseGp(document.getElementById('tSell').value);
    if(isNaN(sell)||sell<=0){ alert('Enter a sell price.'); return; }
    const tx=document.getElementById('tTax');
    if(tx && tx.dataset.mode==='post') sell=Math.round(sell/0.98); // net gp received → store pre-tax so the pipeline nets the 2% itself
    each=sell;
  } else if(mode==='buy'||mode==='banked'){
    const buy=parseGp(document.getElementById('tBuy').value);
    if(isNaN(buy)||buy<0||(buy===0&&mode!=='banked')){ alert(mode==='banked'?'Enter the basis each (0 is allowed for windfalls).':'Enter a buy price.'); return; }
    each=buy;
  } // withdraw: no price — the cost basis comes from the consumed open lot
  // Dedupe guard (chunk 3): warn on an identical item+side+price+qty just staged, so a double-tap
  // (or a retry after an ambiguous network result) doesn't silently double-log.
  const dupWin=now()-600;
  const dup=(STATE.fillsPending||[]).find(p=>p.itemId===it.id && p.kind===mode && p.qty===qty && p.each===each && (p.created||0)>=dupWin);
  if(dup && !confirm('You logged '+qty+' × '+it.name+(mode==='withdraw'?' (withdraw)':' @ '+fmt(each))+' moments ago. Log it again?')) return;
  let wrote=false;
  if(linked){
    wrote=await writeToFillsLog(mode, it, qty, each, ts);
    if(!wrote){ fillsMsg('Couldn’t write to the fills log (permission denied?) — nothing was logged. Re-link the log or use pipeline/add-manual-fill.mjs.'); return; }
  } else {
    const res=await writeToMobileLog(mode, it, qty, each, ts);
    if(!res.ok){ fillsMsg('Couldn’t write to GitHub — nothing was logged. '+res.reason+'. Check the token under “GitHub sync”.'); return; }
    wrote=true;
  }
  const verb=mode==='buy'?'Bought':mode==='sell'?'Sold':mode==='withdraw'?'Withdrew':'Banked';
  logEvent('info','action','logged '+mode+' '+qty+'× '+it.name+(linked?'':' (mobile)'));
  const dest=linked?('your fills log ('+(await linkedName())+')'):'mobile-fills.log on GitHub';
  fillsMsg(verb+' '+qty+' × '+it.name+' → written to '+dest+'. Shows as pending until the next pipeline sync absorbs it.');
  ['tItem','tQty','tBuy','tSell','tWhen'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  renderAll();
}
/* Prompt-driven qty/price/when editor shared by pending-row Edit and the synced-line editor.
   Returns {qty,each,ts}, the string 'delete' (qty 0), or null (cancelled/invalid). */
function promptFillEdit(kind, curQty, curEach, defWhen){
  const q=prompt('Quantity (0 = delete this entry):', curQty); if(q===null) return null;
  const qty=parseGp(q); if(isNaN(qty)||qty<0){ alert('Invalid quantity.'); return null; }
  if(qty===0) return 'delete';
  let each=0;
  if(kind!=='withdraw'){
    const v=prompt(kind==='banked'?'Basis (each, gp — 0 allowed for windfalls):':'Price (each, pre-tax gp):', curEach); if(v===null) return null;
    each=parseGp(v); if(isNaN(each)||each<0||(each===0&&kind!=='banked')){ alert('Invalid price.'); return null; }
  }
  const w=prompt('When (YYYY-MM-DDTHH:MM) — the REAL trade time; FIFO matching depends on it:', defWhen); if(w===null) return null;
  const ts=Math.floor(new Date(w).getTime()/1000); if(!Number.isFinite(ts)){ alert('Invalid date/time.'); return null; }
  return {qty, each, ts};
}
/* Edit/delete a PENDING manual row (chunk 1.3): rewrite its exact line in coffer-manual.log
   through the stored file handle. A tombstone for the OLD event id is written alongside —
   a no-op if no sync has absorbed the line yet, and exactly the fix needed if one has
   (fills.json is append-only; removing a source line alone would not purge a merged event). */
async function editPending(pid){
  const p=STATE.fillsPending.find(x=>x.id===pid); if(!p) return;
  if(!p.line){ alert('This pending row predates 0.27 and has no stored source line — edit coffer-manual.log by hand or wait for the next sync.'); return; }
  const old=JSON.parse(p.line);
  const r=promptFillEdit(p.kind, p.qty, p.each, old.date+'T'+old.time.slice(0,5));
  if(r===null) return;
  if(r==='delete') return delPending(pid);
  const gh=p.origin==='gh';
  const newLine=fillsLogLine({type:p.kind, itemId:p.itemId, qty:r.qty, priceEach:r.each, ts:r.ts, slot:gh?MOBILE_SLOT:undefined});
  const oldId=await eventIdFor(manualLineEvent(old));
  // Desktop rewrites the line in place; mobile is append-only, so an edit = append the new line +
  // a REMOVE tombstone for the old event id (same net effect after the next sync).
  const res=gh ? await appendMobileLines([newLine, tombstoneLine(oldId)], 'mobile: edit item '+p.itemId)
               : await rewriteFillsLog(p.line, [newLine, tombstoneLine(oldId)]);
  if(!res.ok){ alert('Edit failed: '+res.reason); return; }
  p.qty=r.qty; p.each=r.each; p.ts=r.ts; p.line=newLine; p.created=now();
  await sSet('fillsPending', STATE.fillsPending);
  logEvent('info','action','edit pending '+p.kind+' '+p.name);
  fillsMsg('Log line rewritten (old event tombstoned).');
  renderAll();
}
async function delPending(pid){
  const p=STATE.fillsPending.find(x=>x.id===pid); if(!p) return;
  if(p.line){
    const oldId=await eventIdFor(manualLineEvent(JSON.parse(p.line)));
    // A REMOVE tombstone purges the merged event on the next sync (fills.json is append-only).
    // Desktop rewrites the source line to the tombstone; mobile appends the tombstone via GitHub.
    const res=p.origin==='gh' ? await appendMobileLines([tombstoneLine(oldId)], 'mobile: remove item '+p.itemId)
                              : await rewriteFillsLog(p.line, [tombstoneLine(oldId)]);
    if(!res.ok){ alert('Delete failed: '+res.reason); return; }
  } else if(!confirm('No stored source line (pre-0.27 pending row) — remove the pending row only? Any log line it wrote stays.')) return;
  STATE.fillsPending=STATE.fillsPending.filter(x=>x.id!==pid);
  await sSet('fillsPending', STATE.fillsPending);
  logEvent('info','action','delete pending '+p.kind+' '+p.name);
  fillsMsg('Entry removed from the log (tombstoned in case a sync already absorbed it).');
  renderAll();
}
/* Edit/delete ALREADY-SYNCED manual lines (chunk 1.3, second half): list every live manual
   entry in the linked coffer-manual.log, pick one, rewrite/remove it. The old event id is
   always tombstoned so the correction propagates into fills.json on the next sync. */
export async function editManualLog(){
  if(!(await isLinked())){ fillsMsg('Link the fills log first — manual entries live in coffer-manual.log. (Or use pipeline/add-manual-fill.mjs --remove <eventId> from the terminal.)'); return; }
  const text=await readFillsLog();
  if(text===null){ fillsMsg('Couldn’t read the linked log (permission denied?).'); return; }
  const removes=new Set(), entries=[];
  for(const l of text.split(/\r?\n/)){
    const s=l.trim(); if(!s||s[0]!=='{') continue;
    let o; try{ o=JSON.parse(s); }catch{ continue; }
    if(String(o.state||'').toUpperCase()==='REMOVE'){ removes.add(o.target); continue; }
    entries.push({line:s, o});
  }
  const live=[];
  for(const e of entries){ e.evt=manualLineEvent(e.o); e.id=await eventIdFor(e.evt); if(!removes.has(e.id)) live.push(e); }
  if(!live.length){ fillsMsg('No live manual entries in '+(await linkedName())+'.'); return; }
  const nameOf=id=>(STATE.byId[id]&&STATE.byId[id].name)||(STATE.catById[id]&&STATE.catById[id].name)||('#'+id);
  const list=live.map((e,i)=>(i+1)+') '+e.o.date+' '+e.o.time+'  '+e.o.state+'  '+Number(e.o.qty).toLocaleString()+' × '+nameOf(e.o.item)+' @ '+fmt(e.o.offer||0)).join('\n');
  const pick=prompt('Manual log entries (already-synced ones need a pipeline re-sync to apply changes):\n\n'+list+'\n\nEnter a number to edit (qty 0 deletes):');
  if(pick===null) return;
  const n=parseInt(pick,10);
  if(!(n>=1&&n<=live.length)){ alert('No such entry.'); return; }
  const e=live[n-1];
  const r=promptFillEdit(e.evt.type, Number(e.o.qty), Number(e.o.offer)||0, e.o.date+'T'+e.o.time.slice(0,5));
  if(r===null) return;
  const repl = r==='delete' ? [tombstoneLine(e.id)]
    : [fillsLogLine({type:e.evt.type, itemId:e.evt.itemId, qty:r.qty, priceEach:r.each, ts:r.ts}), tombstoneLine(e.id)];
  const res=await rewriteFillsLog(e.line, repl);
  if(!res.ok){ alert('Rewrite failed: '+res.reason); return; }
  logEvent('info','action',(r==='delete'?'delete manual log ':'edit manual log ')+nameOf(e.o.item));
  fillsMsg((r==='delete'?'Entry removed':'Entry rewritten')+' + old event tombstoned. Re-sync to apply: run pipeline/sync-fills.mjs on the PC (sync is on-demand now), then refresh prices here.');
}
export async function delTrade(tid){
  const t=STATE.trades.find(x=>x.tid===tid);
  if(t && t.src==='fills'){ // fills entries are regenerated each sync — tombstone the key so it stays hidden
    if(!STATE.fillsHidden.includes(tid)){ STATE.fillsHidden.push(tid); await sSet('fillsHidden',STATE.fillsHidden); }
  }
  logEvent('info','action',(t&&t.src==='fills'?'hide fills row ':'delete trade ')+((t&&t.name)||tid));
  STATE.trades=STATE.trades.filter(x=>x.tid!==tid); await sSet('trades',STATE.trades); renderAll();
}
/* auto-populate the Ledger from positions.json (pipeline-reconstructed real fills).
   Idempotent: drop all src:'fills' entries and rebuild from the file every sync, so
   reloads never duplicate and open→closed transitions resolve cleanly. Manual trades
   (no src) are never touched; a fills entry the user deletes is tombstoned in
   STATE.fillsHidden so it won't reappear. On fetch failure we keep whatever was last
   persisted rather than wiping the real-trade view. */
export async function syncFills(){
  let pos;
  try{
    const r=await fetch('positions.json?t='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('http '+r.status);
    pos=await r.json();
  }catch(e){
    // Surface a fetch failure in the status banner rather than swallowing it (chunk 4.4): a
    // silently-dead positions.json feed was the failure mode to design against. warn (not error)
    // — the ledger keeps its last-synced state, so flipping is unaffected.
    setHealth('fills','warn','Couldn’t refresh real fills (positions.json unreachable: '+((e&&e.message)||e)+') — showing the last-synced ledger.');
    return;
  }
  if(!pos || pos.app!=='the-coffer-positions'){ return; }
  const hidden=new Set(STATE.fillsHidden||[]);
  const nameOf=id=>(STATE.byId[id]&&STATE.byId[id].name)||(STATE.catById[id]&&STATE.catById[id].name)||('Item #'+id);
  STATE.trades=STATE.trades.filter(t=>t.src!=='fills');
  const add=[];
  for(const t of (pos.closed||[])){ const key='f:c:'+t.itemId+':'+t.buyTs+':'+t.sellTs+(t.withdrawn?':w':''); if(hidden.has(key)) continue;
    add.push({tid:key, src:'fills', itemId:t.itemId, name:nameOf(t.itemId), qty:t.qty, buy:t.buyEach, sell:t.sellEach, opened:t.buyTs, closed:t.sellTs, withdrawn:!!t.withdrawn, banked:!!t.banked}); }
  for(const o of (pos.open||[])){ const key='f:o:'+o.itemId+':'+o.buyEach+(o.banked?':b':''); if(hidden.has(key)) continue;
    add.push({tid:key, src:'fills', itemId:o.itemId, name:nameOf(o.itemId), qty:o.qty, buy:o.buyEach, sell:null, opened:o.buyTs, closed:null, banked:!!o.banked}); }
  STATE.trades.push(...add);
  STATE.fillsUnmatched=Array.isArray(pos.unmatched)?pos.unmatched:[];
  STATE.fillsTs=pos.generatedAt?Math.floor(Date.parse(pos.generatedAt)/1000):0;
  // Drop optimistic pending rows this sync has now absorbed. generatedAt comes from the same
  // machine that ran the sync (no clock skew): a sync generated at/after a pending row's write
  // read coffer-manual.log after we appended it, so that row is now real in positions.json.
  if(STATE.fillsPending && STATE.fillsPending.length){
    const before=STATE.fillsPending.length;
    STATE.fillsPending=STATE.fillsPending.filter(p=>p.created>STATE.fillsTs);
    if(STATE.fillsPending.length!==before) await sSet('fillsPending',STATE.fillsPending);
  }
  await sSet('trades',STATE.trades);
  setHealth('fills','ok','');   // a good fetch clears any prior "couldn’t refresh" warning banner
  logEvent('info','fills',(pos.closed||[]).length+' closed, '+(pos.open||[]).length+' open, '+STATE.fillsUnmatched.length+' unmatched from positions.json');
  renderLedger(); renderCoffer();
}
export function renderFillsMeta(){
  const el=document.getElementById('fillsMeta'); if(!el) return;
  const fills=STATE.trades.filter(t=>t.src==='fills'), un=STATE.fillsUnmatched||[];
  if(!fills.length && !un.length && !STATE.fillsTs){ el.classList.add('hidden'); el.innerHTML=''; return; }
  el.classList.remove('hidden');
  const oc=fills.filter(t=>t.sell===null).length, cc=fills.length-oc;
  let when=''; if(STATE.fillsTs){ const d=new Date(STATE.fillsTs*1000); when=' · synced '+pad2(d.getMonth()+1)+'/'+pad2(d.getDate())+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
  let h='<b>Auto-synced from your RuneLite fills</b> ('+cc+' closed, '+oc+' open)'+when+'. These carry a <span class="srctag">fills</span> tag and refresh on price refresh; delete one to hide it.';
  if(un.length){ const names=un.map(u=>((STATE.byId[u.itemId]&&STATE.byId[u.itemId].name)||(STATE.catById[u.itemId]&&STATE.catById[u.itemId].name)||('#'+u.itemId))+' ×'+u.qty.toLocaleString()).join(', ');
    h+=' <span class="loss">'+un.length+' sell'+(un.length===1?'':'s')+' had no logged buy</span> (bought before logging started, so no cost basis — excluded from realised): '+names+'.'; }
  el.innerHTML=h;
}
/* M1.4 freshness UX. Since G1 there is no scheduled PC writer — positions.json only refreshes
   when a session runs the sync, so the phone's PRIMARY freshness mechanism is (a) this staleness
   banner off positions.json's generatedAt and (b) the Refresh-positions button (a same-origin
   re-fetch — it CANNOT regenerate positions.json, which needs the PC's RuneLite log).
   FILLS_STALE_MS / fmtAge stay in ui.js (shared with the Coffer + Scan staleness surfaces). */
export function renderFillsFresh(){
  const el=document.getElementById('fillsFresh'); if(!el) return;
  const btn='<button id="refreshPositions" class="ghostbtn sm" type="button">↻ Refresh positions</button>';
  if(!STATE.fillsTs){
    el.className='fillsfresh';
    el.innerHTML='<span class="mini">Real fills not fetched yet — tap to load positions.json (produced by the PC pipeline sync).</span> '+btn;
  }else{
    const ageMs=Date.now()-STATE.fillsTs*1000, stale=ageMs>FILLS_STALE_MS;
    el.className='fillsfresh'+(stale?' warn':'');
    el.innerHTML='<span class="mini">Real fills last synced <b>'+fmtAge(ageMs)+' ago</b>'+
      (stale?' — may be behind. This only re-fetches; a fresh sync must run on the PC.':'.')+'</span> '+btn;
  }
  const rb=el.querySelector('#refreshPositions'); if(rb) rb.onclick=refreshPositions;
}
export async function refreshPositions(){
  logEvent('info','action','refresh positions');
  const rb=document.getElementById('refreshPositions'); if(rb){ rb.disabled=true; rb.textContent='Refreshing…'; }
  await syncFills();          // re-fetch positions.json same-origin; syncFills() re-renders the ledger + coffer
  renderFillsFresh();
}
/* M1 GitHub-sync settings panel (the mobile equivalent of “Link fills log…”). Never shows the
   token — only whether one is saved and which repo it targets. */
export function renderGhSync(){
  const st=document.getElementById('ghSyncStatus'), clr=document.getElementById('ghPatClear'); if(!st) return;
  const t=ghTarget(), where=(t.owner&&t.repo)?(t.owner+'/'+t.repo):null;
  if(hasPat()){
    st.innerHTML='GitHub token saved on this device (never shown again). Mobile entries append to <b>mobile-fills.log</b>'+
      (where?(' in <b>'+where+'</b>'):'')+' and your watchlist syncs back through GitHub.'+
      (where?'':' <span class="loss">Couldn’t read the repo from this URL — open the live GitHub Pages app so entries have somewhere to go.</span>');
    if(clr) clr.classList.remove('hidden');
  }else{
    st.innerHTML='On mobile (no desktop file access) save a <b>fine-grained</b> GitHub token — Contents: Read and write, this repo only — to log trades and sync your watchlist. Stored on this device only, never exported, revocable at github.com.';
    if(clr) clr.classList.add('hidden');
  }
}
/* periodKey + groupTrades moved to js/ledgercore.js (TD2.1 — pure Date/Map math, fixture-tested). */
function ledgerKeep(t){ return !STATE.ledgerWatchOnly || STATE.watchlist.includes(t.itemId); }
/* Row actions: every ledger row is now fills-derived (Hide = tombstone in fillsHidden) or a
   legacy pre-0.27 local entry (Delete — see the migration banner). Editing happens at the
   SOURCE: pending rows and manual log lines rewrite coffer-manual.log (chunk 1.3), never
   the derived view. The old Mark sold / prompt-Edit local path is gone (chunk 1.1). */
function rowActions(t){ const isF=t.src==='fills';
  return '<button class="act danger" data-del="'+t.tid+'">'+(isF?'Hide':'Delete')+'</button>'; }
export async function toggleFillsLogLink(){
  if(await isLinked()){ if(confirm('Unlink the fills log? Manual entries go back to browser-only until you re-link.')){ await unlinkFillsLog(); await renderFillsLogLink(); } return; }
  if(await linkFillsLog()) await renderFillsLogLink();
}
export async function renderFillsLogLink(){
  const btn=document.getElementById('fillsLogLink'), st=document.getElementById('fillsLogStatus'); if(!btn) return;
  if(!fsApiSupported()){ btn.classList.add('hidden');
    if(st){ st.classList.remove('hidden'); st.textContent='This browser can’t write files directly (needs Edge/Chrome). To persist a manual entry, use pipeline/add-manual-fill.mjs from the terminal.'; }
    return; }
  const nm=await linkedName();
  if(nm){ btn.textContent='Unlink fills log'; btn.classList.add('linked');
    if(st){ st.classList.remove('hidden'); st.textContent='Manual entries write to '+nm+' → the pipeline folds them into the ledger on the next sync.'; }
  }else{ btn.textContent='Link fills log…'; btn.classList.remove('linked');
    if(st){ st.classList.remove('hidden'); st.textContent='Manual entries need the fills log (single source of truth). Link coffer-manual.log to enable the form, or use pipeline/add-manual-fill.mjs from the terminal.'; } }
}
export async function setLedgerWatchOnly(v){ STATE.ledgerWatchOnly=v; await sSet('ledgerWatchOnly',v); renderLedger(); }
export async function setLedgerPeriod(p){ STATE.ledgerPeriod=p; STATE.ledgerBucket=null; /* LU1.3: changing granularity clears any active bucket filter */ await sSet('ledgerPeriod',p); renderLedger(); }
export function toggleLedgerGroup(key){ STATE.ledgerExpanded[key]=!STATE.ledgerExpanded[key]; renderLedger(); }
/* LU1.3: click a period bucket to filter the closed-flips table to that bucket's sell date;
   clicking the active bucket (or the "All" pill, key='') clears. Session-only (STATE.ledgerBucket). */
function setLedgerBucket(key){ STATE.ledgerBucket=(!key || STATE.ledgerBucket===key)?null:key; renderLedger(); }

/* LU1.5: the closed-flips columns are sortable via the shared TB1 helper. Rows here are
   per-item GROUP aggregates (groupTrades → totQty/avgBuy/avgSell/totTax/totReal), so the
   comparators read those aggregates. Default `last` (most-recent close) desc reproduces the
   pre-LU1 ordering; `last` has no visible header, so the table opens looking unchanged until a
   header is clicked. */
const closedSort=makeSortable({
  tableId:'closedTable', name:'ledgerClosed', defaultKey:'last',
  columns:[
    {key:'last', type:'num', get:g=>g.last},
    {key:'name', type:'str', get:g=>g.name},
    {key:'totQty', type:'num', get:g=>g.totQty},
    {key:'avgBuy', type:'num', get:g=>g.avgBuy},
    {key:'avgSell', type:'num', get:g=>g.avgSell},
    {key:'totTax', type:'num', get:g=>g.totTax},
    {key:'totReal', type:'num', get:g=>g.totReal}
  ],
  onSort:()=>renderLedger()
});

export function renderLedger(){
  const openAll=STATE.trades.filter(t=>t.sell===null), closedAll=STATE.trades.filter(t=>t.sell!==null);
  const open=openAll.filter(ledgerKeep), closed=closedAll.filter(ledgerKeep);
  document.getElementById('ledgerBadge').textContent=open.length;
  renderFillsMeta();
  renderFillsFresh();
  const wc=document.getElementById('ledgerWatchOnly'); if(wc) wc.checked=STATE.ledgerWatchOnly;
  document.querySelectorAll('#ledgerPeriod button').forEach(b=>b.classList.toggle('on',b.dataset.period===STATE.ledgerPeriod));
  renderLegacyBanner();
  const ftag='<span class="srctag" title="auto-synced from RuneLite fills">fills</span>';
  const ltag='<span class="srctag" title="local-only pre-0.27 manual entry — the browser-local path was removed; re-inject via the log or delete (see the banner above)">local</span>';
  const btag='<span class="srctag" title="pre-owned inventory that entered the flip flow at a declared basis (not cash out of pocket)">banked</span>';
  const wtag='<span class="srctag" title="taken from inventory for personal use — no sale; excluded from realised">withdrawn</span>';
  // LU1.1: expansion is an explicit chevron BUTTON (only on multi-lot groups), and the item
  // name is a Trends link (linkname/data-trend) — the same affordance Finder/Signals rows use.
  // Row-click-to-expand (the old data-grp handler) is gone, so name-click can own the click.
  const chev=k=>'<button class="expbtn" type="button" data-exp="'+k+'" title="Expand / collapse lots">'+(STATE.ledgerExpanded[k]?'▾':'▸')+'</button>';
  const nameCell=g=>g.itemId!=null?'<span class="linkname" data-trend="'+g.itemId+'">'+g.name+'</span>':'<span class="itemname">'+g.name+'</span>';
  const cnt=n=>' <span class="cnt">×'+n+'</span>';
  // optimistic rows for entries just written to the fills log (dropped by syncFills once absorbed).
  // ALWAYS rendered regardless of the "Watchlist only" filter (chunk 4.5): a pending row is the
  // user's just-taken action — hiding a fresh non-watchlisted entry made the write look like a
  // no-op (the Feather / Dragon-scim test-add bug, 2026-07-03).
  const pend=(STATE.fillsPending||[]);
  const pendBuys=pend.filter(p=>p.kind==='buy'||p.kind==='banked'), pendSells=pend.filter(p=>p.kind==='sell'||p.kind==='withdraw');
  const ptag='<span class="srctag pend" title="written to your fills log — shows here until the next sync folds it in">pending</span>';
  const pactions=p=>'<button class="act" data-pedit="'+p.id+'">Edit</button> <button class="act danger" data-pdel="'+p.id+'">Delete</button>';
  const pendOpenRows=pendBuys.map(p=>'<tr class="detail pend"><td class="left sub">'+ptag+' '+(p.kind==='banked'?'banked ':'')+p.qty.toLocaleString()+' × '+p.name+' @ '+fmt(p.each)+'</td><td class="num">'+p.qty.toLocaleString()+'</td><td class="num">'+fmt(p.each)+'</td><td class="num">—</td><td class="num">—</td><td>'+pactions(p)+'</td></tr>').join('');
  const pendClosedRows=pendSells.map(p=>'<tr class="detail pend"><td class="left sub">'+ptag+' '+(p.kind==='withdraw'?('withdrew '+p.qty.toLocaleString()+' × '+p.name+' (used)'):('sold '+p.qty.toLocaleString()+' × '+p.name+' @ '+fmt(p.each)))+'</td><td class="num">'+p.qty.toLocaleString()+'</td><td class="num">—</td><td class="num">'+(p.kind==='withdraw'?'—':fmt(p.each))+'</td><td class="num">—</td><td class="num pend">pending</td><td>'+pactions(p)+'</td></tr>').join('');

  // ---- OPEN (grouped by item; drill-in when >1 lot) ----
  const ob=document.getElementById('openBody'), oe=document.getElementById('openEmpty');
  if(!open.length && !pendBuys.length){ ob.innerHTML=''; oe.classList.remove('hidden');
    oe.innerHTML='<div class="empty"><div class="big">No open positions'+(STATE.ledgerWatchOnly?' on your watchlist':'')+'</div><div class="sm">'+(STATE.ledgerWatchOnly&&openAll.length?'Turn off “Watchlist only” to see '+openAll.length+' hidden.':'Log a buy above to track a flip. Shorthand works — 1.79b, 450k.')+'</div></div>';
  }else{ oe.classList.add('hidden');
    ob.innerHTML=(open.length?groupTrades(open).map(g=>{
      const it=g.itemId?resolveId(g.itemId):null, cur=it&&it.high?it.high:null;
      const totQty=g.rows.reduce((s,t)=>s+t.qty,0), avgBuy=Math.round(g.rows.reduce((s,t)=>s+t.buy*t.qty,0)/totQty);
      const un=cur!==null?g.rows.reduce((s,t)=>s+netMarginQty(t.buy,cur,t.qty),0):null, multi=g.rows.length>1, exp=STATE.ledgerExpanded[g.key];
      const rowTag=t=>(t.src==='fills'?' '+ftag:' '+ltag)+(t.banked?' '+btag:'');
      const head='<tr class="grp"><td class="left">'+(multi?chev(g.key):'')+nameCell(g)+(multi?cnt(g.rows.length):rowTag(g.rows[0]))+'</td>'+
        '<td class="num">'+totQty.toLocaleString()+'</td><td class="num">'+fmt(avgBuy)+'</td><td class="num">'+(cur!==null?fmt(cur):'—')+'</td>'+
        '<td class="num '+(un!==null?sgn(un):'')+'">'+(un!==null?fmt(un):'—')+'</td><td>'+(multi?'':rowActions(g.rows[0]))+'</td></tr>';
      let det=''; if(multi&&exp) det=g.rows.map(t=>{ const u=cur!==null?netMarginQty(t.buy,cur,t.qty):null;
        return '<tr class="detail"><td class="left sub">'+rowTag(t)+' '+t.qty.toLocaleString()+' @ '+fmt(t.buy)+'</td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td><td class="num">'+(cur!==null?fmt(cur):'—')+'</td><td class="num '+(u!==null?sgn(u):'')+'">'+(u!==null?fmt(u):'—')+'</td><td>'+rowActions(t)+'</td></tr>'; }).join('');
      return head+det;
    }).join(''):'')+pendOpenRows;
  }

  // ---- period P&L strip (closed flips bucketed by SELL date — sidesteps border-straddle) ----
  const strip=document.getElementById('periodStrip');
  if(strip){
    if(STATE.ledgerPeriod==='all' || !closed.length){ strip.classList.add('hidden'); strip.innerHTML=''; STATE.ledgerBucket=null; }
    else{ const buckets=new Map();
      for(const t of closed){ if(t.withdrawn) continue; // withdrawals are not flips — no realised P/L to attribute
        const {key,label}=periodKey(t.closed||t.opened||now(), STATE.ledgerPeriod);
        if(!buckets.has(key)) buckets.set(key,{label,total:0,count:0}); const b=buckets.get(key); b.total+=realised(t); b.count++; }
      const arr=[...buckets.entries()].sort((a,b)=>a[0]<b[0]?1:-1).slice(0,8);
      // if the active bucket scrolled out of the top-8 (or no longer exists), drop the filter
      if(STATE.ledgerBucket && !arr.some(e=>e[0]===STATE.ledgerBucket)) STATE.ledgerBucket=null;
      strip.classList.remove('hidden');
      // LU1.3: each bucket is a clickable filter; the active one highlights with an × to clear,
      // and an "All" pill (data-bucket="") clears too. Highlighted = the current STATE.ledgerBucket.
      const allOn=STATE.ledgerBucket?'':' on';
      strip.innerHTML='<div class="pstitle">Realised by '+STATE.ledgerPeriod+' <span class="mini">· attributed by sell date · click to filter</span></div><div class="pscells">'+
        '<div class="pcell allpill'+allOn+'" data-bucket="" title="Show all buckets">All</div>'+
        arr.map(([key,b])=>{ const on=STATE.ledgerBucket===key;
          return '<div class="pcell'+(on?' on':'')+'" data-bucket="'+key+'" title="'+(on?'Clear filter':'Filter to '+b.label)+'"><div class="pl">'+b.label+(on?' <span class="pclear">×</span>':'')+'</div><div class="pv num '+sgn(b.total)+'">'+fmt(b.total)+'</div><div class="pc">'+b.count+' flip'+(b.count===1?'':'s')+'</div></div>'; }).join('')+'</div>';
      strip.querySelectorAll('[data-bucket]').forEach(el=>el.onclick=()=>setLedgerBucket(el.dataset.bucket));
    }
  }

  // ---- CLOSED (grouped by item; drill-in when >1 flip) ----
  // LU1.3: when a period bucket is active, the table shows only that bucket's flips (matched on
  // sell date, same basis as the strip — withdrawals excluded, they aren't attributed to a bucket).
  const closedShown=(STATE.ledgerPeriod!=='all' && STATE.ledgerBucket)
    ? closed.filter(t=>!t.withdrawn && periodKey(t.closed||t.opened||now(), STATE.ledgerPeriod).key===STATE.ledgerBucket)
    : closed;
  const cb=document.getElementById('closedBody'), ce=document.getElementById('closedEmpty');
  if(!closed.length && !pendSells.length){ cb.innerHTML=''; ce.classList.remove('hidden');
    ce.innerHTML='<div class="empty"><div class="big">No closed flips'+(STATE.ledgerWatchOnly?' on your watchlist':'')+'</div><div class="sm">'+(STATE.ledgerWatchOnly&&closedAll.length?'Turn off “Watchlist only” to see '+closedAll.length+' hidden.':'Sold positions land here with realised profit after tax.')+'</div></div>';
  }else if(!closedShown.length){ ce.classList.add('hidden'); cb.innerHTML=pendClosedRows;
  }else{ ce.classList.add('hidden');
    // withdrawn rows carry sell=0 and no tax — average/aggregate the SOLD rows only, so a
    // withdrawal never drags the group's avg sell or tax figures (realised() is already 0)
    const groups=closedSort.sort(groupTrades(closedShown).map(g=>{ const totQty=g.rows.reduce((s,t)=>s+t.qty,0);
      const sold=g.rows.filter(t=>!t.withdrawn), soldQty=sold.reduce((s,t)=>s+t.qty,0);
      g.totQty=totQty; g.avgBuy=Math.round(g.rows.reduce((s,t)=>s+t.buy*t.qty,0)/totQty);
      g.avgSell=soldQty?Math.round(sold.reduce((s,t)=>s+t.sell*t.qty,0)/soldQty):null;
      g.totTax=sold.reduce((s,t)=>s+tax(t.sell)*t.qty,0); g.totReal=g.rows.reduce((s,t)=>s+realised(t),0); g.last=Math.max(...g.rows.map(t=>t.closed||0)); return g;
    }));   // LU1.5: sort by group aggregates (default `last` desc = pre-LU1 order)
    closedSort.decorate();
    cb.innerHTML=groups.map(g=>{ const multi=g.rows.length>1, exp=STATE.ledgerExpanded[g.key];
      const gtags=(g.rows.some(t=>t.src==='fills')?' '+ftag:'')+(g.rows.some(t=>t.src!=='fills')?' '+ltag:'')+(g.rows.some(t=>t.banked)?' '+btag:'')+(g.rows.some(t=>t.withdrawn)?' '+wtag:'');
      const head='<tr class="grp"><td class="left">'+(multi?chev(g.key):'')+nameCell(g)+(multi?cnt(g.rows.length):'')+gtags+'</td>'+
        '<td class="num">'+g.totQty.toLocaleString()+'</td><td class="num">'+fmt(g.avgBuy)+'</td><td class="num">'+(g.avgSell!==null?fmt(g.avgSell):'<span class="mini">withdrawn</span>')+'</td>'+
        '<td class="num mini loss">'+fmt(g.totTax)+'</td><td class="num '+sgn(g.totReal)+'">'+fmt(g.totReal)+'</td><td>'+(multi?'':rowActions(g.rows[0]))+'</td></tr>';
      let det=''; if(multi&&exp) det=g.rows.slice().sort((a,b)=>(b.closed||0)-(a.closed||0)).map(t=>{ const r=realised(t), d=new Date((t.closed||0)*1000);
        const when=t.closed?pad2(d.getMonth()+1)+'/'+pad2(d.getDate()):'—';
        if(t.withdrawn) return '<tr class="detail"><td class="left sub">'+when+' · '+t.qty.toLocaleString()+' withdrawn (used) '+wtag+'</td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td><td class="num mini">withdrawn (used)</td><td class="num">—</td><td class="num">—</td><td>'+rowActions(t)+'</td></tr>';
        return '<tr class="detail"><td class="left sub">'+when+' · '+t.qty.toLocaleString()+' @ '+fmt(t.buy)+'→'+fmt(t.sell)+(t.banked?' '+btag:'')+'</td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td><td class="num">'+fmt(t.sell)+'</td><td class="num mini loss">'+fmt(tax(t.sell)*t.qty)+'</td><td class="num '+sgn(r)+'">'+fmt(r)+'</td><td>'+rowActions(t)+'</td></tr>'; }).join('');
      return head+det;
    }).join('')+pendClosedRows;
  }
  // LU1.1: expansion via the chevron button; item name links to Trends (same as Finder/Signals)
  document.querySelectorAll('#openBody [data-exp],#closedBody [data-exp]').forEach(b=>b.onclick=()=>toggleLedgerGroup(b.dataset.exp));
  document.querySelectorAll('#openBody [data-trend],#closedBody [data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delTrade(b.dataset.del));
  document.querySelectorAll('[data-pedit]').forEach(b=>b.onclick=()=>editPending(b.dataset.pedit));
  document.querySelectorAll('[data-pdel]').forEach(b=>b.onclick=()=>delPending(b.dataset.pdel));
}

/* One-time migration surface (chunk 1.7): the browser-local manual path is gone, but trades
   it created before 0.27 still live in STATE.trades (no src tag). Surface them with delete
   actions until Ben re-injects them via the log (with the REAL trade time) or deletes them —
   the banner disappears on its own once none remain. */
function renderLegacyBanner(){
  const el=document.getElementById('legacyBanner'); if(!el) return;
  const legacy=STATE.trades.filter(t=>t.src!=='fills');
  if(!legacy.length){ el.classList.add('hidden'); el.innerHTML=''; return; }
  el.classList.remove('hidden');
  const rows=legacy.map(t=>{ const d=new Date(((t.closed||t.opened||0))*1000);
    return '<div class="lgrow">'+(t.sell===null?'open':'closed')+' · '+t.qty.toLocaleString()+' × '+t.name+' @ '+fmt(t.buy)+(t.sell!==null?' → '+fmt(t.sell):'')+' <span class="mini">('+pad2(d.getMonth()+1)+'/'+pad2(d.getDate())+')</span> <button class="act danger" data-lgdel="'+t.tid+'">Delete</button></div>'; }).join('');
  el.innerHTML='<b>'+legacy.length+' local-only manual '+(legacy.length===1?'entry':'entries')+' from before v0.27.</b> The browser-local entry path was removed — these never reached the fills pipeline and can double-display against pipeline rows. To keep one, re-inject it through the log (link the fills log and use the form with the <b>real trade time</b>, or pipeline/add-manual-fill.mjs), then delete it here.'+rows;
  el.querySelectorAll('[data-lgdel]').forEach(b=>b.onclick=()=>delTrade(b.dataset.lgdel));
}
