import { API, STATE, sSet, logEvent, setHealth, IS_LOCALHOST } from './state.js';
import { tax, netMargin, netMarginQty, now } from './money-math.js';
import { fmt, fmtP, fmtTurn, parseGp, gradeCls, fmtHour, sgn, pad2 } from './money-format.js';
import { loadAll, resolveId, computeScores, TREND_BADGE, rawItem } from './market.js';
import { openTrends } from './trends.js';
import { switchTab } from './main.js';
import { fetchQuote, quoteTableHtml } from './quote.js';
import { renderLedger } from './ledger.js';   // A3: Ledger + fills-write cluster split out; renderAll still coordinates
import { renderWatchTab } from './watch.js';   // WATCH tab: renderAll paints its sync structure (quotes fill in async)
import { ghConfigured, putJsonFile, WATCHLIST_PATH, IGNORED_PATH } from './github.js';
import { makeSortable } from './table.js';

/* finder — sort owned by the shared sortable-table helper (TB1); columns mirror the
   #finderTable header data-k set. AP4: Grade + Rating both sort by the shared DESIRABILITY rank
   (higher = better), replacing the old profit/hr `score` + inverted `riskIndex`. */
export const finderSort=makeSortable({
  tableId:'finderTable', name:'finder', defaultKey:'score',
  columns:[
    {key:'name', type:'str', get:r=>r.name},
    {key:'desir', type:'num', get:r=>r.desir?r.desir.rank:-1},
    {key:'score', type:'num', get:r=>r.desir?r.desir.rank:-1},
    {key:'low', type:'num', get:r=>r.low},
    {key:'high', type:'num', get:r=>r.high},
    {key:'margin', type:'num', get:r=>r.margin},
    {key:'roi', type:'num', get:r=>r.roi},
    {key:'fill', type:'num', get:r=>r.fill},
    {key:'turn', type:'num', get:r=>r.turn},
    {key:'pph', type:'num', get:r=>r.pph}
  ],
  onSort:()=>{ syncSortSel(); renderFinder(); }
});
// keep the Finder's sort <select> in step when a header click lands on one of its options.
export function syncSortSel(){ const sel=document.getElementById('sortSel');
  if(sel && ['score','pph','margin','roi','volume'].includes(finderSort.key)) sel.value=finderSort.key; }

export function currentFinderRows(){
  const q=document.getElementById('search').value.trim().toLowerCase();
  const tier=document.getElementById('priceTier').value;
  const budget=document.getElementById('budgetToggle').checked;
  const perSlot=STATE.bankroll/Math.max(STATE.slots,1); const searching=!!q;
  let rows=STATE.ITEMS.filter(it=>{
    if(q && !it.name.toLowerCase().includes(q)) return false;
    if(searching) return true;                 // explicit search reveals every match, ignoring browse gates
    if(it.margin<=0) return false;
    if(!it.liquid) return false;                // browse view stays curated to liquid items
    const p=it.high;
    if(tier==='b1'&&!(p<1_000_000)) return false;
    if(tier==='b5'&&!(p>=1_000_000&&p<5_000_000)) return false;
    if(tier==='b25'&&!(p>=5_000_000&&p<25_000_000)) return false;
    if(tier==='b75'&&!(p>=25_000_000&&p<75_000_000)) return false;
    if(tier==='bhi'&&!(p>=75_000_000)) return false;
    if(budget && it.low>perSlot) return false;
    return true;
  });
  if(searching){
    // FX1.1: an explicit search reveals EVERY mapped match, including items MIN_PRICE keeps
    // out of the browse universe (soul rune ~300gp). Union in off-screen catalog rows for ids
    // not already in STATE.ITEMS via the shared rawItem path (needs a live price to quote).
    const have=new Set(rows.map(r=>r.id));
    for(const m of STATE.MAP){
      if(m.name.toLowerCase().indexOf(q)<0) continue;
      if(STATE.byId[m.id]||have.has(m.id)) continue;   // already surfaced from the flip universe
      const it=rawItem(m); if(it){ rows.push(it); have.add(m.id); }
    }
  }
  rows=finderSort.sort(rows);
  return rows.slice(0,80);
}
export function renderFinder(){
  const body=document.getElementById('finderBody'), empty=document.getElementById('finderEmpty');
  if(!STATE.ITEMS.length) return;
  const rows=currentFinderRows();
  finderSort.decorate();
  if(!rows.length){ body.innerHTML=''; empty.classList.remove('hidden');
    empty.innerHTML='<div class="big">No flips match</div><div class="sm">Loosen the price tier or turn off “Affordable”. Margins under 2% never clear the tax, so they’re hidden by design.</div>'; return; }
  empty.classList.add('hidden');
  const maxRank=Math.max(...rows.map(r=>r.desir?r.desir.rank:0),1), staleT=now()-3600;
  body.innerHTML=rows.map(it=>{
    const watched=STATE.watchlist.includes(it.id);
    const stale=(it.highTime<staleT||it.lowTime<staleT)?'<span class="stale">stale</span>':'';
    const off=it.offscreen;   // FX1.1 search-only catalog row: no rank/grade — render — and lean on the quote button
    const rel=off?null:Math.round((it.desir?it.desir.rank:0)/maxRank*100), g=off?null:(it.desir?it.desir.grade:'—');
    // AP4: the Grade is the DESIRABILITY letter (shared js/rating.mjs off the shared js/estimators.mjs
    // rank); COARSE here (live-quick-pair basis, no per-item band) — the quote button is the band-precise
    // read. Provisional: the rank/grade cutoffs are uncalibrated (n≈0).
    const gTitle=off?'below the browse price floor — search-surfaced; use quote for the live table':(it.desir?('Desirability '+g+' — shared rank net×P(fill)÷TTF ≈ '+fmt(it.desir.rank)+'/day. COARSE (live-quick-pair basis; the quote button is the band-precise read). Provisional — cutoffs uncalibrated (n≈0).'):'insufficient data');
    const tb=TREND_BADGE[(it.trend&&it.trend.state)||'none']||TREND_BADGE.none;
    const badge=tb.g?' <span class="tbadge '+tb.c+'" title="'+tb.t+(it.trend&&it.trend.divPct!=null?' · '+(it.trend.divPct>=0?'+':'')+it.trend.divPct.toFixed(1)+'% vs guide':'')+'">'+tb.g+'</span>':'';
    // T1.4: Risk grade + Rating bar sit immediately after the item name (identity first),
    // then the price/margin columns — cell order must match the <th> order in index.html.
    return '<tr><td class="left"><span class="linkname" data-trend="'+it.id+'">'+it.name+'</span>'+badge+stale+(it.members?'':' <span class="mini">f2p</span>')+'</td>'+
      (off?'<td><span class="grade" title="'+gTitle+'">—</span></td>'
          :'<td><span class="grade '+gradeCls(g)+'" title="'+gTitle+'">'+g+'</span></td>')+
      (off?'<td class="num mini" title="'+gTitle+'">—</td>'
          :'<td><span class="scorebar" title="'+gTitle+'"><span class="track"><span class="fillb" style="width:'+rel+'%"></span></span><span class="n">'+rel+'</span></span></td>')+
      '<td class="num">'+fmtP(it.low)+'</td><td class="num">'+fmtP(it.high)+'</td>'+
      '<td class="num gain">'+fmtP(it.margin)+'</td><td class="num">'+it.roi.toFixed(1)+'%</td>'+
      '<td class="num">'+(it.fill?it.fill.toLocaleString():'—')+'</td><td class="num mini">'+fmtTurn(it.turn)+'</td>'+
      '<td class="num gold">'+fmt(it.pph)+'</td>'+
      '<td><button class="act qbtn" data-quote="'+it.id+'" title="on-demand standard market table (Quick/Optimistic, regime)">quote</button> <button class="star '+(watched?'on':'')+'" data-id="'+it.id+'">'+(watched?'★':'☆')+'</button> <button class="ignbtn '+(isIgnored(it.id)?'on':'')+'" data-ign="'+it.id+'" title="'+(isIgnored(it.id)?'ignored — quarantined from merch views':'ignore — quarantine from merch views (farming/loot/personal-use)')+'">🚫</button></td></tr>';
  }).join('');
  body.querySelectorAll('.star').forEach(b=>b.onclick=()=>toggleWatch(+b.dataset.id));
  body.querySelectorAll('.ignbtn').forEach(b=>b.onclick=()=>toggleIgnore(+b.dataset.ign));
  body.querySelectorAll('[data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
  body.querySelectorAll('.qbtn').forEach(b=>b.onclick=()=>toggleFinderQuote(b));
}
/* per-row on-demand quote expander — fetches ONE item's series and renders the standard table.
   No bulk fetching (rate limits), no always-on columns; the row is inserted only on click. */
function toggleFinderQuote(btn){
  const tr=btn.closest('tr'), id=+btn.dataset.quote, next=tr.nextElementSibling;
  if(next && next.classList.contains('qrow')){ next.remove(); btn.classList.remove('on'); return; }
  const qr=document.createElement('tr'); qr.className='qrow';
  qr.innerHTML='<td colspan="11"><div class="mini">Fetching live quote…</div></td>';
  tr.after(qr); btn.classList.add('on');
  const cell=qr.firstElementChild;
  const it0=resolveId(id); logEvent('info','action','quote '+((it0&&it0.name)||('#'+id)));
  fetchQuote(id,{asked:true})
    .then(row=>{ const it=resolveId(id); cell.innerHTML=quoteTableHtml((it&&it.name)||('#'+id), row); })
    .catch(()=>{ cell.innerHTML='<div class="mini">Couldn’t load quote — try again.</div>'; });
}
export function showFinderError(){
  document.getElementById('finderBody').innerHTML='';
  const empty=document.getElementById('finderEmpty'); empty.classList.remove('hidden');
  empty.innerHTML='<div class="big">Couldn’t reach the price API</div><div class="sm">The OSRS Wiki prices service didn’t respond. Check your connection and try again.</div><button id="retryBtn">Retry</button>';
  document.getElementById('retryBtn').onclick=()=>{ logEvent('info','action','retry price load'); loadAll(false,true); };
}

/* watchlist */
export async function toggleWatch(id){ const i=STATE.watchlist.indexOf(id), it=resolveId(id), nm=(it&&it.name)||('#'+id);
  if(i>=0){ STATE.watchlist.splice(i,1); logEvent('info','action','unwatch '+nm); } else { STATE.watchlist.push(id); logEvent('info','action','watch '+nm); }
  await sSet('watchlist',STATE.watchlist); renderAll();
  pushWatchlist(); }   // M1.4: best-effort write-back to repo watchlist.json (only when a GitHub token is set)
/* M1.4: write STATE.watchlist (the local+repo union, as ids) back to the tracked repo-root
   watchlist.json through the same contents-API path, so a phone's add/remove persists to the
   source of truth the pipeline reads. No-op (and silent) when no token is configured — the S3
   in-memory union still applies. Best-effort/fire-and-forget: never blocks the UI, warns on
   failure but never alerts (the watchlist is low-stakes). */
export async function pushWatchlist(){
  if(!ghConfigured()) return;
  const res=await putJsonFile(WATCHLIST_PATH, STATE.watchlist, 'mobile: watchlist ('+STATE.watchlist.length+' items)');
  if(res.ok){ if(!res.noop) logEvent('info','action','watchlist synced to repo ('+STATE.watchlist.length+')'); }
  else logEvent('warn','watchlist','repo write-back failed: '+res.reason);
}
/* watchlist — sortable via the shared helper (TB1); default UNSORTED (insertion order) until
   a header is clicked. Rows are {id,it} wrappers so the getters read the resolved item. */
export const watchSort=makeSortable({
  tableId:'watchTable', name:'watch',
  columns:[
    {key:'name', type:'str', get:r=>r.it.name},
    {key:'low', type:'num', get:r=>r.it.low},
    {key:'high', type:'num', get:r=>r.it.high},
    {key:'margin', type:'num', get:r=>r.it.margin},
    {key:'roi', type:'num', get:r=>r.it.roi},
    {key:'turn', type:'num', get:r=>r.it.turn},
    {key:'pph', type:'num', get:r=>r.it.pph},
    {key:'desir', type:'num', get:r=>r.it.desir?r.it.desir.rank:-1}
  ],
  onSort:()=>renderWatch()
});
export function renderWatch(){
  document.getElementById('watchBadge').textContent=STATE.watchlist.length;
  const body=document.getElementById('watchBody'), empty=document.getElementById('watchEmpty');
  if(!STATE.watchlist.length){ body.innerHTML=''; empty.classList.remove('hidden');
    empty.innerHTML='<div class="big">Nothing watched yet</div><div class="sm">Star items in the Finder to park them here and track their margins each refresh.</div>'; return; }
  empty.classList.add('hidden');
  let rows=STATE.watchlist.map(id=>{ const it=resolveId(id); return it?{id,it}:null; }).filter(Boolean);
  rows=watchSort.sort(rows); watchSort.decorate();
  body.innerHTML=rows.map(({id,it})=>{ const off=!!it.offscreen;
    const dg=it.desir?it.desir.grade:null;
    const gradeCell=(off||!dg)?'<span class="mini">—</span>':'<span class="grade '+gradeCls(dg)+'" title="Desirability (shared rank/grade) — coarse live-quick basis; provisional (n≈0)">'+dg+'</span>';
    return '<tr><td class="left"><span class="linkname" data-trend="'+id+'">'+it.name+'</span>'+(off?' <span class="mini">quote</span>':'')+'</td>'+
      '<td class="num">'+fmtP(it.low)+'</td><td class="num">'+fmtP(it.high)+'</td>'+
      '<td class="num '+sgn(it.margin)+'">'+fmtP(it.margin)+'</td><td class="num">'+(it.roi!=null?it.roi.toFixed(1)+'%':'—')+'</td>'+
      '<td class="num mini">'+(off?'—':fmtTurn(it.turn))+'</td><td class="num gold">'+(off?'—':fmt(it.pph))+'</td>'+
      '<td>'+gradeCell+'</td>'+
      '<td><button class="act" data-buy="'+id+'">Log buy</button> <button class="act danger" data-rm="'+id+'">Remove</button></td></tr>';
  }).join('');
  body.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>toggleWatch(+b.dataset.rm));
  body.querySelectorAll('[data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
  body.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{ const it=resolveId(+b.dataset.buy); if(!it) return; switchTab('ledger');
    document.getElementById('tItem').value=it.name; document.getElementById('tBuy').value=it.low||''; document.getElementById('tQty').focus(); });
}

/* IGNORE LIST — the merch-book quarantine EDITOR (mirrors the watchlist above). The app never applies
   the filter itself (positions/screens come pre-filtered from the pipeline, which owns ignored.mjs); this
   tab just curates the shared source of truth ignored-items.json and pushes it via the same contents-API
   path as the watchlist. STATE.ignored holds {id,name,reason}; STATE.ignoredMeta preserves the file's _doc
   + greenlisted so a write-back never clobbers the confirmed-flips list the pipeline needs. */
export const IGNORE_REASONS=['farming','loot','personal-use','boss-drop','other'];
const isIgnored=id=>STATE.ignored.some(e=>+e.id===+id);
export async function toggleIgnore(id, reason='other'){
  const i=STATE.ignored.findIndex(e=>+e.id===+id), it=resolveId(id), nm=(it&&it.name)||('#'+id);
  if(i>=0){ STATE.ignored.splice(i,1); logEvent('info','action','unignore '+nm); }
  else { STATE.ignored.push({ id:+id, name:nm, reason }); logEvent('info','action','ignore '+nm+' ('+reason+')'); }
  await sSet('ignored',STATE.ignored); renderFinder(); renderIgnore(); pushIgnored();
}
export async function setIgnoreReason(id, reason){
  const e=STATE.ignored.find(x=>+x.id===+id); if(!e || e.reason===reason) return;
  e.reason=reason; await sSet('ignored',STATE.ignored); pushIgnored();
}
/* Write STATE.ignored back to ignored-items.json, PRESERVING _doc + greenlisted (only the items list is
   app-editable). Best-effort/silent when no token is set — like the watchlist. */
export async function pushIgnored(){
  if(!ghConfigured()) return;
  const obj={ items: STATE.ignored.map(e=>({ id:+e.id, name:e.name, reason:e.reason })), greenlisted: STATE.ignoredMeta.greenlisted||[] };
  if(STATE.ignoredMeta._doc) obj._doc=STATE.ignoredMeta._doc;   // keep the doc string as the first key when present
  const ordered=STATE.ignoredMeta._doc ? { _doc:STATE.ignoredMeta._doc, items:obj.items, greenlisted:obj.greenlisted } : obj;
  const res=await putJsonFile(IGNORED_PATH, ordered, 'app: ignore list ('+STATE.ignored.length+' items)');
  if(res.ok){ if(!res.noop) logEvent('info','action','ignore list synced to repo ('+STATE.ignored.length+')'); }
  else logEvent('warn','ignore','repo write-back failed: '+res.reason);
}
/* Union repo ignored-items.json into STATE.ignored (post-mapping), preserving _doc + greenlisted into
   STATE.ignoredMeta. Mirrors loadRepoWatchlist: the file is the shared source of truth; local adds are
   kept, repo items missing locally are added (by id). */
export async function loadRepoIgnored(){
  let data;
  try{ const r=await fetch('ignored-items.json?t='+Date.now(),{cache:'no-store'}); if(!r.ok) return; data=await r.json(); }
  catch{ return; }
  if(!data || typeof data!=='object') return;
  STATE.ignoredMeta={ _doc:data._doc||null, greenlisted:Array.isArray(data.greenlisted)?data.greenlisted:[] };
  let added=0;
  for(const e of (Array.isArray(data.items)?data.items:[])){
    const id=+e.id; if(!Number.isFinite(id)) continue;
    if(STATE.ignored.some(x=>+x.id===id)) continue;
    const it=resolveId(id); STATE.ignored.push({ id, name:e.name||(it&&it.name)||('#'+id), reason:e.reason||'other' }); added++;
  }
  if(added) logEvent('info','ignore','union +'+added+' from repo ignored-items.json');
  renderIgnore();
}
export function renderIgnore(){
  const badge=document.getElementById('ignoreBadge'), body=document.getElementById('ignoreBody'), empty=document.getElementById('ignoreEmpty');
  if(!badge||!body||!empty) return;   // graceful degrade if the Ignore markup isn't present (e.g. a cached old index.html mid-deploy) — never throw out of renderAll and stall init
  badge.textContent=STATE.ignored.length;
  if(!STATE.ignored.length){ body.innerHTML=''; empty.classList.remove('hidden');
    empty.innerHTML='<div class="big">Nothing ignored</div><div class="sm">Hit 🚫 on a Finder row to quarantine an item from the merch views (farming inputs, loot, personal-use). It stays in the fill log for the audit — the pipeline hides it on the next sync.</div>'; return; }
  empty.classList.add('hidden');
  const opts=r=>IGNORE_REASONS.map(x=>'<option value="'+x+'"'+(x===r?' selected':'')+'>'+x+'</option>').join('');
  body.innerHTML=STATE.ignored.map(e=>{ const it=resolveId(e.id); const nm=(it&&it.name)||e.name||('#'+e.id);
    return '<tr><td class="left"><span class="linkname" data-trend="'+e.id+'">'+nm+'</span></td>'+
      '<td><select class="reasonsel" data-rid="'+e.id+'">'+opts(e.reason||'other')+'</select></td>'+
      '<td><button class="act danger" data-unignore="'+e.id+'">Remove</button></td></tr>';
  }).join('');
  body.querySelectorAll('[data-unignore]').forEach(b=>b.onclick=()=>toggleIgnore(+b.dataset.unignore));
  body.querySelectorAll('.reasonsel').forEach(s=>s.onchange=()=>setIgnoreReason(+s.dataset.rid, s.value));
  body.querySelectorAll('[data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
}

/* After-tax realised P/L — SHARED between the Coffer summary (here) and the Ledger (js/ledger.js).
   Withdrawn rows (inventory taken for personal use) are realised 0 by definition — no sale
   happened; they must never count toward profit sums (chunk 1.5). */
export function realised(t){ if(t.withdrawn) return 0; return netMarginQty(t.buy,t.sell,t.qty); }
// SHARED staleness threshold: > 6h since generatedAt -> flag harder. Used by the Coffer + Scan
// staleness surfaces here and by the Ledger freshness banner in js/ledger.js (matches the scan banner).
export const FILLS_STALE_MS=6*3600*1000;

/* coffer */
export function renderCoffer(){
  const closed=STATE.trades.filter(t=>t.sell!==null && !t.withdrawn), open=STATE.trades.filter(t=>t.sell===null);
  const realisedTotal=closed.reduce((s,t)=>s+realised(t),0); let openVal=0, deployed=0;
  for(const t of open){ deployed+=t.buy*t.qty; const it=t.itemId?resolveId(t.itemId):null; if(it&&it.high) openVal+=(it.high-tax(it.high))*t.qty; }
  const cr=document.getElementById('cofferRealised'); cr.textContent=fmt(realisedTotal); cr.className='v num '+sgn(realisedTotal);
  document.getElementById('cofferRealisedMeta').textContent=closed.length+' closed flip'+(closed.length===1?'':'s')+', after tax';
  document.getElementById('cofferOpen').textContent=fmt(openVal);
  document.getElementById('cofferOpenMeta').textContent=open.length+' position'+(open.length===1?'':'s')+' · liquidation value';
  document.getElementById('cofferDeployed').textContent=fmt(deployed);
  // M1.4: surface fills staleness on the Coffer too (the summary reads off the same positions.json).
  const cs=document.getElementById('cofferStale');
  if(cs){ const ageMs=STATE.fillsTs?Date.now()-STATE.fillsTs*1000:null;
    if(ageMs!=null && ageMs>FILLS_STALE_MS){ cs.classList.remove('hidden'); cs.textContent='fills '+fmtAge(ageMs)+' old'; }
    else cs.classList.add('hidden'); }
  const pct=STATE.bankroll?Math.round(deployed/STATE.bankroll*100):0;
  document.getElementById('cofferDeployedMeta').textContent=pct+'% of '+fmt(STATE.bankroll)+' across '+STATE.slots+' slots';
  document.getElementById('cofferCompact').innerHTML=
    '<div class="ci"><span class="ck">Coffer</span><span class="cv '+sgn(realisedTotal)+'">'+fmt(realisedTotal)+'</span></div>'+
    '<div class="ci"><span class="ck">Open</span><span class="cv gold">'+fmt(openVal)+'</span></div>'+
    '<div class="ci"><span class="ck">Deployed</span><span class="cv">'+fmt(deployed)+'</span></div>';
}

/* PLAN-2 C2 — Finder v2 ("Scan"): render the published screen.json opportunity scan as-is.
   The cells are byte-identical to screen-flip-niches.mjs's markdown table (both go through quotecore's
   stdCells), so there is NO client-side re-scoring here — we render exactly what the scan said.
   The file is self-describing (its own `headers` travel with the rows), so a stale published
   file can never mismatch app-side header code. Item names deep-link to the live Trends view.
   Fetched once per session (like syncFills) unless the user hits "Refresh scan". */
let scanLoaded=false;
let lastScanGeneratedAt=null;   // the generatedAt of the last rendered screen.json (for the refresh honesty check)
export const fmtAge=ms=>{ const s=Math.max(0,Math.round(ms/1000));
  if(s<90) return s+'s';
  const m=Math.round(s/60); if(m<90) return m+'m';
  const h=Math.round(m/60); if(h<48) return h+'h';
  return Math.round(h/24)+'d'; };
// cells may be legacy plain strings (schema 1) OR T1 structured {t,c[,title]} (schema 2) — read all.
const scText=c=>(c && typeof c==='object' && 't' in c)?c.t:c;
const scCls =c=>(c && typeof c==='object' && c.c)?c.c:'';
const scTitle=c=>(c && typeof c==='object' && c.title)?c.title:'';      // S1 thin-grade honesty tooltip
const attr=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
// PB4 (2026-07-15) — the pressure (TRIAL) reachable band, rendered by DEFAULT beside the neutral cells.
// screen.json carries an ADDITIVE per-row `reachable` { ask, bid, pressure, reliability } (never a
// rank/grade/sort input — that stays F1-gated). We APPEND a "Pressure (trial)" column (the neutral
// Optimistic column stays as the conservative reference); rule 4 — the header + tooltip say un-calibrated,
// and a thin/low-reliability read is flagged. Absent `reachable` (older/stale screen.json) → no column.
const scanPressureCell=rb=>{
  if(!rb || rb.ask==null || rb.bid==null) return '<td class="pressure-trial"></td>';
  const rel=(typeof rb.reliability==='number')?rb.reliability:null, low=rel!=null && rel<0.5;
  const px=(typeof rb.pressure==='number')?rb.pressure.toFixed(1)+'×':'?';
  const ttl='pressure '+px+(rel!=null?', reliability '+rel.toFixed(2):'')+' — deep reachable bid → bold reachable ask; TRIAL, un-calibrated (n≈0). The Optimistic column is the conservative reference.';
  return '<td class="pressure-trial'+(low?' pthin':'')+'" title="'+attr(ttl)+'">'+fmtP(rb.bid)+' → '+fmtP(rb.ask)+
    ' <span class="pmeta">'+px+(low?' ⚠thin':'')+'</span></td>';
};
function scanTableHtml(headers, rows){
  if(!rows||!rows.length) return '<div class="scannone">— none —</div>';
  const hasP=rows.some(r=>r.reachable && r.reachable.ask!=null);   // PB4: the pressure column only when data is present
  const head='<thead><tr>'+headers.map((h,i)=>'<th'+(i===0?' class="left"':'')+'>'+h+'</th>').join('')+
    (hasP?'<th class="pcol" title="Pressure-driven reachable band (deep bid → bold ask) — a TRIAL, un-calibrated demand read (n≈0), NOT the ranked/graded decision. The neutral Optimistic column is the conservative reference.">Pressure <span class="ptrial">(trial)</span></th>':'')+'</tr></thead>';
  const body='<tbody>'+rows.map(r=>{ const cells=r.cells||[];
    const tds=cells.map((c,i)=>{
      const ttl=scTitle(c), t=ttl?' title="'+attr(ttl)+'"':'';
      if(i===0) return '<td class="left"><span class="linkname" data-trend="'+r.id+'">'+scText(c)+'</span></td>';
      if(headers[i]==='Grade'){ const g=scText(c); return '<td'+t+'><span class="grade '+gradeCls(g)+'"'+(ttl?' title="'+attr(ttl)+'"':'')+'>'+g+'</span>'+(ttl?'<span class="thinflag" title="'+attr(ttl)+'">thin</span>':'')+'</td>'; }
      return '<td class="'+scCls(c)+'"'+t+'>'+scText(c)+'</td>';
    }).join('');
    return '<tr>'+tds+(hasP?scanPressureCell(r.reachable):'')+'</tr>'; }).join('')+'</tbody>';
  return '<div class="tablewrap"><table class="scantable">'+head+body+'</table></div>';
}
// per-niche display metadata — one table per niche, each already sorted by Grade (screen-flip-niches.mjs sorts
// by the risk-adjusted score, and Grade is column 2). Rendered in this canonical order when present.
// Only the SHIPPED niches carry display metadata (spread + rising were DELETED — Steps 3+4). An
// unknown/future niche key still renders: the `NICHE_META[n]||{label:n,hint:''}` fallback in
// renderScan falls back to the raw key as its label, and any niche present in a published
// screen.json but absent from NICHE_ORDER is appended after the known ones (see present[] below).
const NICHE_META={
  band:{label:'Band', hint:'wide traded intraday range — ladder the low, sell the top'},
  churn:{label:'Churn', hint:'high-volume commodities — volume does the work'}
};
const NICHE_ORDER=['band','churn'];
export async function renderScan(force){
  const tablesEl=document.getElementById('scanTables'), emptyEl=document.getElementById('scanEmpty');
  const metaEl=document.getElementById('scanMeta'), staleEl=document.getElementById('scanStale');
  if(!tablesEl) return;
  if(scanLoaded && !force) return;   // already rendered this session; Refresh forces a re-fetch
  const showEmpty=(big,sm)=>{ scanLoaded=false; tablesEl.innerHTML=''; if(metaEl) metaEl.textContent='';
    if(staleEl) staleEl.classList.add('hidden'); emptyEl.classList.remove('hidden');
    emptyEl.innerHTML='<div class="big">'+big+'</div><div class="sm">'+sm+'</div>'; };
  let scan;
  try{
    const r=await fetch('screen.json?t='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('http '+r.status);
    scan=await r.json();
  }catch(e){
    showEmpty('No published scan yet','Run <code>node pipeline/commands/screen-flip-niches.mjs --publish</code> — the pipeline commits <code>screen.json</code> alongside fills, and this panel mirrors it.');
    return;
  }
  if(!scan || scan.app!=='the-coffer-screen'){ showEmpty('Scan unavailable','<code>screen.json</code> is present but not a Coffer scan file.'); return; }
  scanLoaded=true;
  emptyEl.classList.add('hidden');
  // params line — say WHAT scan this is (mode + gates), so an old snapshot is self-explaining
  const p=scan.params||{}, mode=(scan.mode||'band');
  const posture=(scan.posture||p.posture||'active');   // S2: which posture this scan reflects
  const priceWin=(p.minPrice?fmt(p.minPrice):'0')+'–'+(p.maxPrice?fmt(p.maxPrice):'∞');
  if(metaEl) metaEl.innerHTML='<b>'+mode.toUpperCase()+'</b> scan · <b>'+posture.toUpperCase()+'</b> posture · floor '+(p.floor??'—')+'/d'+
    (p.gpFloor?(' or '+fmt(p.gpFloor)+' gp-flow'):'')+' · min ROI '+(p.minRoi??'—')+'% · attn '+(p.minGpd?fmt(p.minGpd):'—')+'/d · '+priceWin+' gp · top '+(p.top??'—')+
    (['band','churn'].includes(mode)?(' · band '+(p.bandHours??'—')+'h ≥'+(p.minActive??'—')+' traded windows'):'');
  lastScanGeneratedAt=scan.generatedAt||null;   // remember it so a Refresh can tell "newer" from "no-op"
  // staleness — always surface the age (an hours-old scan is CONTEXT, not a live quote)
  const genMs=Date.parse(scan.generatedAt), ageMs=isNaN(genMs)?null:(Date.now()-genMs);
  if(staleEl){
    staleEl.classList.remove('hidden');
    const stale=ageMs==null || ageMs>FILLS_STALE_MS;   // >6h → flag harder (shared constant)
    staleEl.className='scanstale'+(stale?' warn':'');
    staleEl.innerHTML=ageMs==null
      ? 'Scan timestamp unknown — treat as context, not a live quote.'
      : 'Scan generated <b>'+fmtAge(ageMs)+' ago</b> — a snapshot for context, not a live quote. Open an item’s Trends for the current market.';
  }
  // PV: stamp the published pipeline version + scan time next to the app version. Read from the
  // freshest artifact the app already fetched (screen.json carries a top-level `pipeline` string
  // + `generatedAt`). Absent (an older artifact) → degrade to `pipeline v?`, never crash. Scan time
  // is LOCAL (toLocaleTimeString) per the app's time-display convention.
  const pv=document.getElementById('pipeVer');
  if(pv){ const pipe=(typeof scan.pipeline==='string' && scan.pipeline)?('v'+scan.pipeline):'v?';
    const stamp=isNaN(genMs)?'':(' (scan '+new Date(genMs).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+')');
    pv.textContent=' · pipeline '+pipe+stamp; }
  const headers=scan.headers||[], niches=scan.niches||{};
  // present = the known niches in canonical order, then any unknown/future niche key in the payload
  // (tolerant rendering — a screen.json niche absent from NICHE_ORDER still renders, labeled by its
  // raw key via the NICHE_META fallback below).
  const present=[...NICHE_ORDER.filter(n=>Array.isArray(niches[n])),
                 ...Object.keys(niches).filter(n=>!NICHE_ORDER.includes(n) && Array.isArray(niches[n]))];
  // PB4: a legend when any niche carries the pressure (trial) band — rule 4, so the column never reads
  // as the validated/ranked decision. Absent on an older screen.json without `reachable` (no column).
  const anyPressure=Object.values(niches).some(a=>Array.isArray(a)&&a.some(r=>r&&r.reachable&&r.reachable.ask!=null));
  const pLegend=anyPressure
    ? '<div class="scanplegend">⚗ <b>Pressure (trial)</b> = the demand-balance reachable band (deep bid → bold ask), shown by default. It is <b>un-calibrated</b> (n≈0, retro still scoring) and does <b>not</b> drive the Grade, rank, or sort — those stay on the neutral estimator. The Optimistic column is the conservative reference.</div>'
    : '';
  let html = present.length
    ? pLegend+present.map(n=>{ const m=NICHE_META[n]||{label:n,hint:''};
        return '<div class="scantier">'+m.label+(m.hint?' <span class="scanhint">— '+m.hint+'</span>':'')+'</div>'+scanTableHtml(headers, niches[n]); }).join('')
    : '<div class="scannone">— no niches in this scan —</div>';
  // S3: the always-scanned Watchlist section (its own headers carry the extra Note column). Falling
  // watchlist items ARE shown here (with a warning note) — the held/asked exception extends to them.
  const wl=scan.watchlist;
  if(wl && Array.isArray(wl.rows) && wl.rows.length){
    html += '<div class="scantier scanwatch">Watchlist <span class="scanhint">— always shown, exempt from floors/gates; the Note says what a gate would have hidden</span></div>'+
      scanTableHtml(wl.headers||headers, wl.rows);
  }
  tablesEl.innerHTML = html;
  tablesEl.querySelectorAll('[data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
}

/* LW4 — the "Refresh scan" button.
   On the LOCAL dev server (serve.cmd → localhost, IS_LOCALHOST) the dev-server exposes POST
   /api/scan, which runs `screen-flip-niches.mjs --mode all --publish` and rewrites the local screen.json with
   ZERO git — so a click here runs a REAL scan, then we re-fetch + re-render the fresh file. A scan
   takes ~10–30s, so the button shows a "Scanning…" busy state and is disabled meanwhile.
   On deployed GitHub Pages (IS_LOCALHOST false) — or if the endpoint is unreachable / errors / times
   out — this DEGRADES to today's behavior: just re-fetch the published screen.json. If that re-fetch
   finds no newer snapshot (generatedAt unchanged), surface an honest "run the pipeline" hint rather
   than looking like a silent no-op. The endpoint fetch is fully guarded (AbortController timeout +
   try/catch), so under the CI smoke stub (127.0.0.1, no /api/scan handler) it fails gracefully. */
export async function refreshScan(btn){
  const before=lastScanGeneratedAt;
  let ranLocal=false;
  if(IS_LOCALHOST){
    const orig=btn?btn.textContent:'';
    if(btn){ btn.disabled=true; btn.textContent='Scanning…'; }
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),120000);   // a --mode all scan can take a while; bound it
    try{
      const r=await fetch('/api/scan',{method:'POST',signal:ctrl.signal});
      const j=await r.json().catch(()=>({}));
      if(r.ok && j && j.ok){ ranLocal=true; logEvent('info','scan','local scan ran → '+(j.generatedAt||'?')); }
      else if(j && j.busy){ logEvent('info','scan','local scan already running — showing latest'); }
      else { logEvent('warn','scan','local scan endpoint error — falling back to published snapshot'); }
    }catch(e){
      // endpoint unavailable (static-only server / abort / offline) → silently fall back to a re-fetch
      logEvent('info','scan','no local scan endpoint — falling back to published snapshot');
    }finally{
      clearTimeout(timer);
      if(btn){ btn.disabled=false; btn.textContent=orig; }
    }
  }
  await renderScan(true);   // re-fetch + re-render (the fresh local file, or the published one)
  // Honesty: a click that produced no newer snapshot shouldn't look like a no-op. If the endpoint
  // didn't run a fresh scan and the timestamp is unchanged, tell the user how to get a newer one.
  if(!ranLocal && before && lastScanGeneratedAt===before){
    const staleEl=document.getElementById('scanStale');
    if(staleEl){ staleEl.classList.remove('hidden'); staleEl.className='scanstale warn';
      staleEl.innerHTML=(IS_LOCALHOST
        ? 'No newer scan produced. Is the dev-server running? Otherwise run <code>node pipeline/commands/screen-flip-niches.mjs --mode all --publish</code> to refresh <code>screen.json</code>.'
        : 'No newer snapshot published yet — run the pipeline (<code>screen-flip-niches.mjs --publish</code>) to refresh. This panel mirrors the committed <code>screen.json</code>.'); }
  }
}

/* S3: repo watchlist union. The pipeline can't read the browser's localStorage, so the shared
   source of truth is tracked repo-root watchlist.json. The app treats STATE.watchlist as the UNION
   of local (localStorage) + repo entries: merge any repo ids not already watched, IN-MEMORY (no
   persist — persisting here would bake repo items into localStorage and break the union if the repo
   later drops them). Write-back to the file is M1's PAT path (pushWatchlist(), on every toggleWatch
   when a token is set). Names resolve via the full mapping (STATE.MAP), ids pass through. Call AFTER
   the market/mapping has loaded. */
export async function loadRepoWatchlist(){
  let arr;
  try{ const r=await fetch('watchlist.json?t='+Date.now(),{cache:'no-store'}); if(!r.ok) return; arr=await r.json(); }
  catch{ return; }
  if(!Array.isArray(arr) || !arr.length) return;
  const resolve=e=>{
    const s=String(e).trim();
    if(/^\d+$/.test(s)) return +s;
    const hit=STATE.byName[s.toLowerCase()]; if(hit) return hit.id;
    const m=(STATE.MAP||[]).find(x=>x.name.toLowerCase()===s.toLowerCase()); return m?m.id:null;
  };
  let added=0;
  for(const e of arr){ const id=resolve(e); if(id!=null && !STATE.watchlist.includes(id)){ STATE.watchlist.push(id); added++; } }
  if(added){ logEvent('info','watchlist','union +'+added+' from repo watchlist.json'); renderWatch(); }
}

export function renderAll(){ renderCoffer(); renderFinder(); renderWatch(); renderIgnore(); renderLedger(); renderWatchTab(); }
export function recompute(){ computeScores(); renderAll(); }
