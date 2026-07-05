import { API, STATE, sSet, logEvent, setHealth } from './state.js';
import { tax, netMargin, netMarginQty, fmt, fmtP, fmtTurn, parseGp, grade, now, fmtHour, sgn, pad2 } from './format.js';
import { loadAll, resolveId, computeScores, TREND_BADGE, rawItem } from './market.js';
import { openTrends, computeSignals } from './trends.js';
import { switchTab } from './main.js';
import { fetchQuote, quoteTableHtml } from './quote.js';
import { renderLedger } from './ledger.js';   // A3: Ledger + fills-write cluster split out; renderAll still coordinates
import { renderWatchTab } from './watch.js';   // WATCH tab: renderAll paints its sync structure (quotes fill in async)
import { ghConfigured, putJsonFile, WATCHLIST_PATH } from './github.js';
import { makeSortable } from './table.js';

/* finder — sort owned by the shared sortable-table helper (TB1); columns mirror the
   #finderTable header data-k set. riskIndex inverts (lower index = better grade). */
export const finderSort=makeSortable({
  tableId:'finderTable', name:'finder', defaultKey:'score',
  columns:[
    {key:'name', type:'str', get:r=>r.name},
    {key:'riskIndex', type:'num', invert:true, get:r=>r.riskIndex},
    {key:'score', type:'num', get:r=>r.score},
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
  const maxScore=Math.max(...rows.map(r=>r.score||0),1), staleT=now()-3600;
  body.innerHTML=rows.map(it=>{
    const watched=STATE.watchlist.includes(it.id);
    const stale=(it.highTime<staleT||it.lowTime<staleT)?'<span class="stale">stale</span>':'';
    const off=it.offscreen;   // FX1.1 search-only catalog row: no rating/score/fill/turn — render — and lean on the quote button
    const rel=off?null:Math.round(it.score/maxScore*100), g=off?null:grade(it.riskIndex);
    const rt=it.rate;
    const gTitle=off?'below the browse price floor — search-surfaced; use quote for the live table':(rt?('Rating factors — ROI '+Math.round(rt.roiS*100)+'% · Liquidity '+Math.round(rt.volS*100)+'% · Stability '+Math.round(rt.stabS*100)+'% · Turnaround '+Math.round(rt.turnS*100)+'% (stability = live price vs guide; full regime check is on Trends)'):'insufficient data');
    const tb=TREND_BADGE[(it.trend&&it.trend.state)||'none']||TREND_BADGE.none;
    const badge=tb.g?' <span class="tbadge '+tb.c+'" title="'+tb.t+(it.trend&&it.trend.divPct!=null?' · '+(it.trend.divPct>=0?'+':'')+it.trend.divPct.toFixed(1)+'% vs guide':'')+'">'+tb.g+'</span>':'';
    // T1.4: Risk grade + Rating bar sit immediately after the item name (identity first),
    // then the price/margin columns — cell order must match the <th> order in index.html.
    return '<tr><td class="left"><span class="linkname" data-trend="'+it.id+'">'+it.name+'</span>'+badge+stale+(it.members?'':' <span class="mini">f2p</span>')+'</td>'+
      (off?'<td><span class="grade" title="'+gTitle+'">—</span></td>'
          :'<td><span class="grade r'+g+'" title="'+gTitle+'">'+g+'</span></td>')+
      (off?'<td class="num mini" title="'+gTitle+'">—</td>'
          :'<td><span class="scorebar" title="'+gTitle+'"><span class="track"><span class="fillb" style="width:'+rel+'%"></span></span><span class="n">'+rel+'</span></span></td>')+
      '<td class="num">'+fmtP(it.low)+'</td><td class="num">'+fmtP(it.high)+'</td>'+
      '<td class="num gain">'+fmtP(it.margin)+'</td><td class="num">'+it.roi.toFixed(1)+'%</td>'+
      '<td class="num">'+(it.fill?it.fill.toLocaleString():'—')+'</td><td class="num mini">'+fmtTurn(it.turn)+'</td>'+
      '<td class="num gold">'+fmt(it.pph)+'</td>'+
      '<td><button class="act qbtn" data-quote="'+it.id+'" title="on-demand standard market table (Quick/Optimistic, regime)">quote</button> <button class="star '+(watched?'on':'')+'" data-id="'+it.id+'">'+(watched?'★':'☆')+'</button></td></tr>';
  }).join('');
  body.querySelectorAll('.star').forEach(b=>b.onclick=()=>toggleWatch(+b.dataset.id));
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
  if(i>=0){ STATE.watchlist.splice(i,1); delete STATE.signalCache[id]; logEvent('info','action','unwatch '+nm); } else { STATE.watchlist.push(id); logEvent('info','action','watch '+nm); }
  await sSet('watchlist',STATE.watchlist); renderAll(); computeSignals();
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
export function renderSignals(){
  const hr=new Date().getHours();
  const inCheap=w=>{ if(!w) return false; for(let k=0;k<3;k++) if((w.start+k)%24===hr) return true; return false; };
  const rows=STATE.watchlist.filter(id=>STATE.signalCache[id]&&STATE.byId[id]).map(id=>{
    const it=STATE.byId[id], s=STATE.signalCache[id];
    const gross=netMargin(it.low,it.high), roi=it.low?gross/it.low*100:0, profitable=gross>0;
    const cheapNow=inCheap(s.buyWin);
    const buy = profitable && cheapNow && s.conf!=='low';   // cheap-hour window + live margin; falling knives NOT excluded (flagged in Trend)
    return {it,s,gross,roi,profitable,cheapNow,buy};
  }).sort((a,b)=>b.gross-a.gross);
  const firing=rows.filter(r=>r.buy).length;
  // FX1.2: show firing/total (e.g. 0/6) so a live-but-quiet tab no longer misreads as empty;
  // plain 0 when there are no watched signal rows at all.
  document.getElementById('sigBadge').textContent=rows.length?firing+'/'+rows.length:'0';
  const body=document.getElementById('sigBody'), empty=document.getElementById('sigEmpty');
  if(!rows.length){
    body.innerHTML=''; empty.classList.remove('hidden');
    empty.innerHTML='<div class="big">No signals yet</div><div class="sm">Star items in the Finder and refresh prices a few times — once an item has banked enough hourly history, its live buy signal shows up here.</div>';
    return;
  }
  empty.classList.add('hidden');
  const winStr=w=>fmtHour(w.start)+'–'+fmtHour((w.end+1)%24);
  body.innerHTML=rows.map(({it,s,gross,roi,profitable,cheapNow,buy})=>{
    const tr=s.trend, volatile = tr && tr.ok && (tr.state==='down-confirmed'||tr.state==='reversion');
    const trendCell = (!tr||!tr.ok) ? '<span class="mini">—</span>'
      : (tr.state==='down-confirmed' ? '<span class="grade rD" title="'+tr.zGuide.toFixed(1)+'σ under guide, momentum down">↓ falling</span>'
      : tr.state==='reversion' ? '<span class="grade rC" title="dislocated low, momentum flattening">~ dip?</span>'
      : tr.state==='up' ? '<span class="grade rB" title="above guide">↑ up</span>'
      : '<span class="grade rA" title="straddles guide">✓ stable</span>');
    const state = buy ? '<span class="grade rA" title="'+(volatile?'cheap hour + live margin, but volatile — size down':'cheap hour + live margin')+'">BUY'+(volatile?' ⚡':'')+'</span>'
      : profitable ? '<span class="grade rB" title="live margin available, outside the cheap-hour window">flip'+(volatile?' ⚡':'')+'</span>'
      : (s.conf==='low' ? '<span class="grade rC" title="needs more banked history">low data</span>' : '<span class="grade rB" title="spread doesn’t clear tax right now">no spread</span>');
    return '<tr><td class="left"><span class="linkname" data-trend="'+it.id+'">'+it.name+'</span></td>'+
      '<td class="num">'+fmtP(it.low)+'</td><td class="num">'+fmtP(it.high)+'</td>'+
      '<td class="num '+sgn(gross)+'">'+(gross>=0?'+':'')+fmtP(gross)+'</td>'+
      '<td class="num mini">'+(s.buyWin?winStr(s.buyWin):'—')+(cheapNow?' <span class="gain">• now</span>':'')+'</td><td>'+trendCell+'</td><td>'+state+'</td></tr>';
  }).join('');
  body.querySelectorAll('[data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
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
    {key:'riskIndex', type:'num', invert:true, get:r=>r.it.riskIndex}
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
    const gradeCell=off?'<span class="mini">—</span>':'<span class="grade r'+grade(it.riskIndex??1)+'">'+grade(it.riskIndex??1)+'</span>';
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
   The cells are byte-identical to screen.mjs's markdown table (both go through quotecore's
   stdCells), so there is NO client-side re-scoring here — we render exactly what the scan said.
   The file is self-describing (its own `headers` travel with the rows), so a stale published
   file can never mismatch app-side header code. Item names deep-link to the live Trends view.
   Fetched once per session (like syncFills) unless the user hits "Refresh scan". */
let scanLoaded=false;
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
function scanTableHtml(headers, rows){
  if(!rows||!rows.length) return '<div class="scannone">— none —</div>';
  const head='<thead><tr>'+headers.map((h,i)=>'<th'+(i===0?' class="left"':'')+'>'+h+'</th>').join('')+'</tr></thead>';
  const body='<tbody>'+rows.map(r=>{ const cells=r.cells||[];
    return '<tr>'+cells.map((c,i)=>{
      const ttl=scTitle(c), t=ttl?' title="'+attr(ttl)+'"':'';
      if(i===0) return '<td class="left"><span class="linkname" data-trend="'+r.id+'">'+scText(c)+'</span></td>';
      if(headers[i]==='Grade'){ const g=scText(c); return '<td'+t+'><span class="grade r'+g+'"'+(ttl?' title="'+attr(ttl)+'"':'')+'>'+g+'</span>'+(ttl?'<span class="thinflag" title="'+attr(ttl)+'">thin</span>':'')+'</td>'; }
      return '<td class="'+scCls(c)+'"'+t+'>'+scText(c)+'</td>';
    }).join('')+'</tr>'; }).join('')+'</tbody>';
  return '<div class="tablewrap"><table class="scantable">'+head+body+'</table></div>';
}
// per-niche display metadata — one table per niche, each already sorted by Grade (screen.mjs sorts
// by the risk-adjusted score, and Grade is column 2). Rendered in this canonical order when present.
const NICHE_META={
  band:{label:'Band', hint:'wide traded intraday range — ladder the low, sell the top'},
  spread:{label:'Spread', hint:'24h-average spread flips'},
  rising:{label:'Rising', hint:'frothy momentum — size small'},
  churn:{label:'Churn', hint:'high-volume commodities — volume does the work'}
};
const NICHE_ORDER=['band','spread','rising','churn'];
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
    showEmpty('No published scan yet','Run <code>node pipeline/screen.mjs --publish</code> — the pipeline commits <code>screen.json</code> alongside fills, and this panel mirrors it.');
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
    (['band','rising','churn'].includes(mode)?(' · band '+(p.bandHours??'—')+'h ≥'+(p.minActive??'—')+' windows'):'');
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
  const headers=scan.headers||[], niches=scan.niches||{};
  const present=NICHE_ORDER.filter(n=>Array.isArray(niches[n]));
  let html = present.length
    ? present.map(n=>{ const m=NICHE_META[n]||{label:n,hint:''};
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
  if(added){ logEvent('info','watchlist','union +'+added+' from repo watchlist.json'); renderWatch(); computeSignals(); }
}

export function renderAll(){ renderCoffer(); renderFinder(); renderWatch(); renderSignals(); renderLedger(); renderWatchTab(); }
export function recompute(){ computeScores(); renderAll(); }
