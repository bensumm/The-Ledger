import { API, STATE, sSet, logEvent } from './state.js';
import { tax, fmt, fmtP, fmtTurn, parseGp, grade, now, fmtHour, sgn, pad2 } from './format.js';
import { loadAll, resolveItem, resolveId, computeScores, TREND_BADGE } from './market.js';
import { openTrends, computeSignals } from './trends.js';
import { switchTab } from './main.js';

/* finder */
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
  const dir=(STATE.sortKey==='riskIndex')?-STATE.sortDir:STATE.sortDir;
  rows.sort((a,b)=>{ if(STATE.sortKey==='name') return STATE.sortDir*((a.name>b.name)?1:-1);
    const av=a[STATE.sortKey]??-Infinity, bv=b[STATE.sortKey]??-Infinity; return dir*((av>bv)?1:(av<bv?-1:0)); });
  return rows.slice(0,80);
}
export function renderFinder(){
  const body=document.getElementById('finderBody'), empty=document.getElementById('finderEmpty');
  if(!STATE.ITEMS.length) return;
  const rows=currentFinderRows();
  document.querySelectorAll('#finderTable thead th').forEach(th=>{
    th.classList.toggle('sorted', th.dataset.k===STATE.sortKey);
    const old=th.querySelector('.arrow'); if(old) old.remove();
    if(th.dataset.k===STATE.sortKey){ const s=document.createElement('span'); s.className='arrow'; s.textContent=STATE.sortDir<0?'▼':'▲'; th.appendChild(s); }
  });
  if(!rows.length){ body.innerHTML=''; empty.classList.remove('hidden');
    empty.innerHTML='<div class="big">No flips match</div><div class="sm">Loosen the price tier or turn off “Affordable”. Margins under 2% never clear the tax, so they’re hidden by design.</div>'; return; }
  empty.classList.add('hidden');
  const maxScore=Math.max(...rows.map(r=>r.score),1), staleT=now()-3600;
  body.innerHTML=rows.map(it=>{
    const watched=STATE.watchlist.includes(it.id);
    const stale=(it.highTime<staleT||it.lowTime<staleT)?'<span class="stale">stale</span>':'';
    const rel=Math.round(it.score/maxScore*100), g=grade(it.riskIndex);
    const rt=it.rate;
    const gTitle=rt?('Rating factors — ROI '+Math.round(rt.roiS*100)+'% · Liquidity '+Math.round(rt.volS*100)+'% · Stability '+Math.round(rt.stabS*100)+'% · Turnaround '+Math.round(rt.turnS*100)+'% (stability = live price vs guide; full regime check is on Trends)'):'insufficient data';
    const tb=TREND_BADGE[(it.trend&&it.trend.state)||'none']||TREND_BADGE.none;
    const badge=tb.g?' <span class="tbadge '+tb.c+'" title="'+tb.t+(it.trend&&it.trend.divPct!=null?' · '+(it.trend.divPct>=0?'+':'')+it.trend.divPct.toFixed(1)+'% vs guide':'')+'">'+tb.g+'</span>':'';
    return '<tr><td class="left"><span class="linkname" data-trend="'+it.id+'">'+it.name+'</span>'+badge+stale+(it.members?'':' <span class="mini">f2p</span>')+'</td>'+
      '<td class="num">'+fmtP(it.low)+'</td><td class="num">'+fmtP(it.high)+'</td>'+
      '<td class="num gain">'+fmtP(it.margin)+'</td><td class="num">'+it.roi.toFixed(1)+'%</td>'+
      '<td class="num">'+(it.fill?it.fill.toLocaleString():'—')+'</td><td class="num mini">'+fmtTurn(it.turn)+'</td>'+
      '<td class="num gold">'+fmt(it.pph)+'</td><td><span class="grade r'+g+'" title="'+gTitle+'">'+g+'</span></td>'+
      '<td><span class="scorebar" title="'+gTitle+'"><span class="track"><span class="fillb" style="width:'+rel+'%"></span></span><span class="n">'+rel+'</span></span></td>'+
      '<td><button class="star '+(watched?'on':'')+'" data-id="'+it.id+'">'+(watched?'★':'☆')+'</button></td></tr>';
  }).join('');
  body.querySelectorAll('.star').forEach(b=>b.onclick=()=>toggleWatch(+b.dataset.id));
  body.querySelectorAll('[data-trend]').forEach(b=>b.onclick=()=>openTrends(+b.dataset.trend));
}
export function showFinderError(){
  document.getElementById('finderBody').innerHTML='';
  const empty=document.getElementById('finderEmpty'); empty.classList.remove('hidden');
  empty.innerHTML='<div class="big">Couldn’t reach the price API</div><div class="sm">The OSRS Wiki prices service didn’t respond. Check your connection and try again.</div><button id="retryBtn">Retry</button>';
  document.getElementById('retryBtn').onclick=()=>loadAll(false,true);
}

/* watchlist */
export async function toggleWatch(id){ const i=STATE.watchlist.indexOf(id); if(i>=0){ STATE.watchlist.splice(i,1); delete STATE.signalCache[id]; } else STATE.watchlist.push(id); await sSet('watchlist',STATE.watchlist); renderAll(); computeSignals(); }
export function renderSignals(){
  const hr=new Date().getHours();
  const inCheap=w=>{ if(!w) return false; for(let k=0;k<3;k++) if((w.start+k)%24===hr) return true; return false; };
  const rows=STATE.watchlist.filter(id=>STATE.signalCache[id]&&STATE.byId[id]).map(id=>{
    const it=STATE.byId[id], s=STATE.signalCache[id];
    const gross=(it.high-tax(it.high))-it.low, roi=it.low?gross/it.low*100:0, profitable=gross>0;
    const cheapNow=inCheap(s.buyWin);
    const buy = profitable && cheapNow && s.conf!=='low';   // cheap-hour window + live margin; falling knives NOT excluded (flagged in Trend)
    return {it,s,gross,roi,profitable,cheapNow,buy};
  }).sort((a,b)=>b.gross-a.gross);
  const firing=rows.filter(r=>r.buy).length;
  document.getElementById('sigBadge').textContent=firing;
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
export function renderWatch(){
  document.getElementById('watchBadge').textContent=STATE.watchlist.length;
  const body=document.getElementById('watchBody'), empty=document.getElementById('watchEmpty');
  if(!STATE.watchlist.length){ body.innerHTML=''; empty.classList.remove('hidden');
    empty.innerHTML='<div class="big">Nothing watched yet</div><div class="sm">Star items in the Finder to park them here and track their margins each refresh.</div>'; return; }
  empty.classList.add('hidden');
  body.innerHTML=STATE.watchlist.map(id=>{ const it=resolveId(id); if(!it) return ''; const off=!!it.offscreen;
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

/* ledger */
const newTid=()=>'t'+Date.now()+Math.random().toString(36).slice(2,6);
export async function addTrade(){
  const tt=document.getElementById('tType'), mode=tt?tt.dataset.mode:'buy';
  const name=document.getElementById('tItem').value.trim();
  const qty=parseGp(document.getElementById('tQty').value)||1;
  if(!name){ alert('Enter an item.'); return; }
  const it=resolveItem(name);
  if(mode==='sell'){
    let sell=parseGp(document.getElementById('tSell').value);
    if(isNaN(sell)){ alert('Enter a sell price.'); return; }
    const tx=document.getElementById('tTax');
    if(tx && tx.dataset.mode==='post') sell=Math.round(sell/0.98); // net gp received → store pre-tax so realised() nets the 2% itself
    // A sale just CLOSES matching open position(s) FIFO — no need to re-enter the buy (it's on the open lot).
    const match=t=>t.sell===null && (it? t.itemId===it.id : t.name===name);
    const open=STATE.trades.filter(match).sort((a,b)=>(a.opened||0)-(b.opened||0));
    if(!open.length){ alert('No open ‘'+name+'’ position to sell — switch to Buy and log the purchase first (a sale needs a cost basis).'); return; }
    let remain=qty; const remove=new Set();
    for(const t of open){ if(remain<=0) break;
      const take=Math.min(remain, t.qty);
      STATE.trades.push({tid:newTid(), itemId:t.itemId, name:t.name, qty:take, buy:t.buy, sell, opened:t.opened, closed:now()});
      remain-=take;
      if(take>=t.qty){                                    // whole lot sold → drop the open lot
        if(t.src==='fills' && !STATE.fillsHidden.includes(t.tid)) STATE.fillsHidden.push(t.tid); // tombstone so a sync won't resurrect it
        remove.add(t.tid);
      } else if(t.src==='fills'){                          // partial sale of a fills lot: tombstone it, keep the remainder as a manual open
        if(!STATE.fillsHidden.includes(t.tid)) STATE.fillsHidden.push(t.tid); remove.add(t.tid);
        STATE.trades.push({tid:newTid(), itemId:t.itemId, name:t.name, qty:t.qty-take, buy:t.buy, sell:null, opened:t.opened, closed:null});
      } else { t.qty-=take; }                              // partial sale of a manual lot: just reduce it
    }
    STATE.trades=STATE.trades.filter(t=>!remove.has(t.tid));
    await sSet('fillsHidden',STATE.fillsHidden);
    if(remain>0) alert('Logged the sale. You only had '+(qty-remain)+' open, so '+remain+' with no recorded buy were skipped (no cost basis).');
  } else {
    const buy=parseGp(document.getElementById('tBuy').value);
    if(isNaN(buy)){ alert('Enter a buy price.'); return; }
    STATE.trades.push({tid:newTid(), itemId:it?it.id:null, name:it?it.name:name, qty, buy, sell:null, opened:now(), closed:null});
  }
  await sSet('trades',STATE.trades);
  ['tItem','tQty','tBuy','tSell'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  renderAll();
}
export async function closeTrade(tid){ const t=STATE.trades.find(x=>x.tid===tid); if(!t) return;
  const it=t.itemId?STATE.byId[t.itemId]:null, def=it&&it.high?it.high:''; const v=prompt('Sell price (each):',def); if(v===null) return;
  const sell=parseGp(v); if(isNaN(sell)){ alert('Invalid price.'); return; } t.sell=sell; t.closed=now(); await sSet('trades',STATE.trades); renderAll(); }
export async function delTrade(tid){
  const t=STATE.trades.find(x=>x.tid===tid);
  if(t && t.src==='fills'){ // fills entries are regenerated each sync — tombstone the key so it stays hidden
    if(!STATE.fillsHidden.includes(tid)){ STATE.fillsHidden.push(tid); await sSet('fillsHidden',STATE.fillsHidden); }
  }
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
  }catch(e){ logEvent('info','fills','positions.json unavailable ('+((e&&e.message)||e)+') — keeping last-synced ledger'); return; }
  if(!pos || pos.app!=='the-coffer-positions'){ return; }
  const hidden=new Set(STATE.fillsHidden||[]);
  const nameOf=id=>(STATE.byId[id]&&STATE.byId[id].name)||(STATE.catById[id]&&STATE.catById[id].name)||('Item #'+id);
  STATE.trades=STATE.trades.filter(t=>t.src!=='fills');
  const add=[];
  for(const t of (pos.closed||[])){ const key='f:c:'+t.itemId+':'+t.buyTs+':'+t.sellTs; if(hidden.has(key)) continue;
    add.push({tid:key, src:'fills', itemId:t.itemId, name:nameOf(t.itemId), qty:t.qty, buy:t.buyEach, sell:t.sellEach, opened:t.buyTs, closed:t.sellTs}); }
  for(const o of (pos.open||[])){ const key='f:o:'+o.itemId+':'+o.buyEach; if(hidden.has(key)) continue;
    add.push({tid:key, src:'fills', itemId:o.itemId, name:nameOf(o.itemId), qty:o.qty, buy:o.buyEach, sell:null, opened:o.buyTs, closed:null}); }
  STATE.trades.push(...add);
  STATE.fillsUnmatched=Array.isArray(pos.unmatched)?pos.unmatched:[];
  STATE.fillsTs=pos.generatedAt?Math.floor(Date.parse(pos.generatedAt)/1000):0;
  await sSet('trades',STATE.trades);
  logEvent('info','fills',(pos.closed||[]).length+' closed, '+(pos.open||[]).length+' open, '+STATE.fillsUnmatched.length+' unmatched from positions.json');
  renderLedger(); renderCoffer();
}
export function realised(t){ return ((t.sell-tax(t.sell))-t.buy)*t.qty; }
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
/* Ledger view controls: watchlist-only filter, per-item grouping w/ drill-in, period P&L */
export function periodKey(ts, period){
  const d=new Date(ts*1000);
  if(period==='month') return {key:d.getFullYear()+'-'+pad2(d.getMonth()+1), label:d.toLocaleString([], {month:'short'})+' '+d.getFullYear()};
  if(period==='week'){ const m=new Date(d); m.setHours(0,0,0,0); m.setDate(m.getDate()-((m.getDay()+6)%7)); // back to Monday
    return {key:'w'+m.getFullYear()+'-'+pad2(m.getMonth()+1)+'-'+pad2(m.getDate()), label:'wk '+pad2(m.getMonth()+1)+'/'+pad2(m.getDate())}; }
  return {key:d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()), label:pad2(d.getMonth()+1)+'/'+pad2(d.getDate())}; // day
}
function ledgerKeep(t){ return !STATE.ledgerWatchOnly || STATE.watchlist.includes(t.itemId); }
function groupTrades(trades){
  const m=new Map();
  for(const t of trades){ const k=t.itemId!=null?('i'+t.itemId):('n'+t.name);
    if(!m.has(k)) m.set(k,{key:k, itemId:t.itemId, name:t.name, rows:[]}); m.get(k).rows.push(t); }
  return [...m.values()];
}
function openActions(t){ const isF=t.src==='fills'; return (isF?'':'<button class="act" data-close="'+t.tid+'">Mark sold</button> <button class="act" data-edit="'+t.tid+'">Edit</button> ')+'<button class="act danger" data-del="'+t.tid+'">'+(isF?'Hide':'Delete')+'</button>'; }
function closedActions(t){ const isF=t.src==='fills'; return (isF?'':'<button class="act" data-edit="'+t.tid+'">Edit</button> ')+'<button class="act danger" data-del="'+t.tid+'">'+(isF?'Hide':'Delete')+'</button>'; }
/* Edit a MANUAL entry in place (fills are regenerated by the pipeline, so editing them wouldn't stick — hence non-fills only).
   Prompts each editable field pre-filled with its current value; blank/cancel on any leaves it unchanged. Sell price is pre-tax. */
export async function editTrade(tid){
  const t=STATE.trades.find(x=>x.tid===tid); if(!t || t.src==='fills') return;
  const q=prompt('Quantity:', t.qty); if(q===null) return;
  const qty=parseGp(q); if(isNaN(qty)||qty<=0){ alert('Invalid quantity.'); return; }
  const b=prompt('Buy price (each):', t.buy); if(b===null) return;
  const buy=parseGp(b); if(isNaN(buy)){ alert('Invalid buy price.'); return; }
  let sell=t.sell;
  if(t.sell!==null){ const s=prompt('Sell price (each, pre-tax):', t.sell); if(s===null) return;
    sell=parseGp(s); if(isNaN(sell)){ alert('Invalid sell price.'); return; } }
  t.qty=qty; t.buy=buy; if(t.sell!==null) t.sell=sell;
  await sSet('trades',STATE.trades); renderAll();
}
export async function setLedgerWatchOnly(v){ STATE.ledgerWatchOnly=v; await sSet('ledgerWatchOnly',v); renderLedger(); }
export async function setLedgerPeriod(p){ STATE.ledgerPeriod=p; await sSet('ledgerPeriod',p); renderLedger(); }
export function toggleLedgerGroup(key){ STATE.ledgerExpanded[key]=!STATE.ledgerExpanded[key]; renderLedger(); }

export function renderLedger(){
  const openAll=STATE.trades.filter(t=>t.sell===null), closedAll=STATE.trades.filter(t=>t.sell!==null);
  const open=openAll.filter(ledgerKeep), closed=closedAll.filter(ledgerKeep);
  document.getElementById('ledgerBadge').textContent=open.length;
  renderFillsMeta();
  const wc=document.getElementById('ledgerWatchOnly'); if(wc) wc.checked=STATE.ledgerWatchOnly;
  document.querySelectorAll('#ledgerPeriod button').forEach(b=>b.classList.toggle('on',b.dataset.period===STATE.ledgerPeriod));
  const ftag='<span class="srctag" title="auto-synced from RuneLite fills">fills</span>';
  const caret=k=>'<span class="caret">'+(STATE.ledgerExpanded[k]?'▾':'▸')+'</span>';
  const cnt=n=>' <span class="cnt">×'+n+'</span>';

  // ---- OPEN (grouped by item; drill-in when >1 lot) ----
  const ob=document.getElementById('openBody'), oe=document.getElementById('openEmpty');
  if(!open.length){ ob.innerHTML=''; oe.classList.remove('hidden');
    oe.innerHTML='<div class="empty"><div class="big">No open positions'+(STATE.ledgerWatchOnly?' on your watchlist':'')+'</div><div class="sm">'+(STATE.ledgerWatchOnly&&openAll.length?'Turn off “Watchlist only” to see '+openAll.length+' hidden.':'Log a buy above to track a flip. Shorthand works — 1.79b, 450k.')+'</div></div>';
  }else{ oe.classList.add('hidden');
    ob.innerHTML=groupTrades(open).map(g=>{
      const it=g.itemId?resolveId(g.itemId):null, cur=it&&it.high?it.high:null;
      const totQty=g.rows.reduce((s,t)=>s+t.qty,0), avgBuy=Math.round(g.rows.reduce((s,t)=>s+t.buy*t.qty,0)/totQty);
      const un=cur!==null?g.rows.reduce((s,t)=>s+((cur-tax(cur))-t.buy)*t.qty,0):null, multi=g.rows.length>1, exp=STATE.ledgerExpanded[g.key];
      const head='<tr class="grp'+(multi?' clk':'')+'"'+(multi?' data-grp="'+g.key+'"':'')+'><td class="left">'+(multi?caret(g.key):'')+'<span class="itemname">'+g.name+'</span>'+(multi?cnt(g.rows.length):(g.rows[0].src==='fills'?' '+ftag:''))+'</td>'+
        '<td class="num">'+totQty.toLocaleString()+'</td><td class="num">'+fmt(avgBuy)+'</td><td class="num">'+(cur!==null?fmt(cur):'—')+'</td>'+
        '<td class="num '+(un!==null?sgn(un):'')+'">'+(un!==null?fmt(un):'—')+'</td><td>'+(multi?'':openActions(g.rows[0]))+'</td></tr>';
      let det=''; if(multi&&exp) det=g.rows.map(t=>{ const u=cur!==null?((cur-tax(cur))-t.buy)*t.qty:null;
        return '<tr class="detail"><td class="left sub">'+(t.src==='fills'?ftag+' ':'')+t.qty.toLocaleString()+' @ '+fmt(t.buy)+'</td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td><td class="num">'+(cur!==null?fmt(cur):'—')+'</td><td class="num '+(u!==null?sgn(u):'')+'">'+(u!==null?fmt(u):'—')+'</td><td>'+openActions(t)+'</td></tr>'; }).join('');
      return head+det;
    }).join('');
  }

  // ---- period P&L strip (closed flips bucketed by SELL date — sidesteps border-straddle) ----
  const strip=document.getElementById('periodStrip');
  if(strip){
    if(STATE.ledgerPeriod==='all' || !closed.length){ strip.classList.add('hidden'); strip.innerHTML=''; }
    else{ const buckets=new Map();
      for(const t of closed){ const {key,label}=periodKey(t.closed||t.opened||now(), STATE.ledgerPeriod);
        if(!buckets.has(key)) buckets.set(key,{label,total:0,count:0}); const b=buckets.get(key); b.total+=realised(t); b.count++; }
      const arr=[...buckets.entries()].sort((a,b)=>a[0]<b[0]?1:-1).slice(0,8).map(e=>e[1]);
      strip.classList.remove('hidden');
      strip.innerHTML='<div class="pstitle">Realised by '+STATE.ledgerPeriod+' <span class="mini">· attributed by sell date</span></div><div class="pscells">'+
        arr.map(b=>'<div class="pcell"><div class="pl">'+b.label+'</div><div class="pv num '+sgn(b.total)+'">'+fmt(b.total)+'</div><div class="pc">'+b.count+' flip'+(b.count===1?'':'s')+'</div></div>').join('')+'</div>';
    }
  }

  // ---- CLOSED (grouped by item; drill-in when >1 flip) ----
  const cb=document.getElementById('closedBody'), ce=document.getElementById('closedEmpty');
  if(!closed.length){ cb.innerHTML=''; ce.classList.remove('hidden');
    ce.innerHTML='<div class="empty"><div class="big">No closed flips'+(STATE.ledgerWatchOnly?' on your watchlist':'')+'</div><div class="sm">'+(STATE.ledgerWatchOnly&&closedAll.length?'Turn off “Watchlist only” to see '+closedAll.length+' hidden.':'Sold positions land here with realised profit after tax.')+'</div></div>';
  }else{ ce.classList.add('hidden');
    const groups=groupTrades(closed).map(g=>{ const totQty=g.rows.reduce((s,t)=>s+t.qty,0);
      g.totQty=totQty; g.avgBuy=Math.round(g.rows.reduce((s,t)=>s+t.buy*t.qty,0)/totQty); g.avgSell=Math.round(g.rows.reduce((s,t)=>s+t.sell*t.qty,0)/totQty);
      g.totTax=g.rows.reduce((s,t)=>s+tax(t.sell)*t.qty,0); g.totReal=g.rows.reduce((s,t)=>s+realised(t),0); g.last=Math.max(...g.rows.map(t=>t.closed||0)); return g;
    }).sort((a,b)=>b.last-a.last);
    cb.innerHTML=groups.map(g=>{ const multi=g.rows.length>1, exp=STATE.ledgerExpanded[g.key];
      const head='<tr class="grp'+(multi?' clk':'')+'"'+(multi?' data-grp="'+g.key+'"':'')+'><td class="left">'+(multi?caret(g.key):'')+'<span class="itemname">'+g.name+'</span>'+(multi?cnt(g.rows.length):'')+(g.rows.some(t=>t.src==='fills')?' '+ftag:'')+'</td>'+
        '<td class="num">'+g.totQty.toLocaleString()+'</td><td class="num">'+fmt(g.avgBuy)+'</td><td class="num">'+fmt(g.avgSell)+'</td>'+
        '<td class="num mini loss">'+fmt(g.totTax)+'</td><td class="num '+sgn(g.totReal)+'">'+fmt(g.totReal)+'</td><td>'+(multi?'':closedActions(g.rows[0]))+'</td></tr>';
      let det=''; if(multi&&exp) det=g.rows.slice().sort((a,b)=>(b.closed||0)-(a.closed||0)).map(t=>{ const r=realised(t), d=new Date((t.closed||0)*1000);
        const when=t.closed?pad2(d.getMonth()+1)+'/'+pad2(d.getDate()):'—';
        return '<tr class="detail"><td class="left sub">'+when+' · '+t.qty.toLocaleString()+' @ '+fmt(t.buy)+'→'+fmt(t.sell)+'</td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td><td class="num">'+fmt(t.sell)+'</td><td class="num mini loss">'+fmt(tax(t.sell)*t.qty)+'</td><td class="num '+sgn(r)+'">'+fmt(r)+'</td><td>'+closedActions(t)+'</td></tr>'; }).join('');
      return head+det;
    }).join('');
  }
  document.querySelectorAll('#openBody [data-grp],#closedBody [data-grp]').forEach(el=>el.onclick=e=>{ if(e.target.closest('button')) return; toggleLedgerGroup(el.dataset.grp); });
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeTrade(b.dataset.close));
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editTrade(b.dataset.edit));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delTrade(b.dataset.del));
}

/* coffer */
export function renderCoffer(){
  const closed=STATE.trades.filter(t=>t.sell!==null), open=STATE.trades.filter(t=>t.sell===null);
  const realisedTotal=closed.reduce((s,t)=>s+realised(t),0); let openVal=0, deployed=0;
  for(const t of open){ deployed+=t.buy*t.qty; const it=t.itemId?resolveId(t.itemId):null; if(it&&it.high) openVal+=(it.high-tax(it.high))*t.qty; }
  const cr=document.getElementById('cofferRealised'); cr.textContent=fmt(realisedTotal); cr.className='v num '+sgn(realisedTotal);
  document.getElementById('cofferRealisedMeta').textContent=closed.length+' closed flip'+(closed.length===1?'':'s')+', after tax';
  document.getElementById('cofferOpen').textContent=fmt(openVal);
  document.getElementById('cofferOpenMeta').textContent=open.length+' position'+(open.length===1?'':'s')+' · liquidation value';
  document.getElementById('cofferDeployed').textContent=fmt(deployed);
  const pct=STATE.bankroll?Math.round(deployed/STATE.bankroll*100):0;
  document.getElementById('cofferDeployedMeta').textContent=pct+'% of '+fmt(STATE.bankroll)+' across '+STATE.slots+' slots';
  document.getElementById('cofferCompact').innerHTML=
    '<div class="ci"><span class="ck">Coffer</span><span class="cv '+sgn(realisedTotal)+'">'+fmt(realisedTotal)+'</span></div>'+
    '<div class="ci"><span class="ck">Open</span><span class="cv gold">'+fmt(openVal)+'</span></div>'+
    '<div class="ci"><span class="ck">Deployed</span><span class="cv">'+fmt(deployed)+'</span></div>';
}

export function renderAll(){ renderCoffer(); renderFinder(); renderWatch(); renderSignals(); renderLedger(); }
export function recompute(){ computeScores(); renderAll(); }

