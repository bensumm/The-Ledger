import { API, STATE, sSet } from './state.js';
import { tax, fmt, fmtP, fmtTurn, parseGp, grade, now, fmtHour, sgn } from './format.js';
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
    if(tier==='staple'&&!(p<100000)) return false;
    if(tier==='mid'&&!(p>=100000&&p<10_000_000)) return false;
    if(tier==='high'&&!(p>=10_000_000&&p<250_000_000)) return false;
    if(tier==='cap'&&!(p>=250_000_000)) return false;
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
export async function addTrade(){
  const name=document.getElementById('tItem').value.trim();
  const qty=parseGp(document.getElementById('tQty').value)||1, buy=parseGp(document.getElementById('tBuy').value);
  if(!name||isNaN(buy)){ alert('Enter an item and a buy price.'); return; }
  const it=resolveItem(name);
  STATE.trades.push({tid:'t'+Date.now()+Math.random().toString(36).slice(2,6), itemId:it?it.id:null, name:it?it.name:name, qty, buy, sell:null, opened:now(), closed:null});
  await sSet('trades',STATE.trades);
  document.getElementById('tItem').value=''; document.getElementById('tQty').value=''; document.getElementById('tBuy').value=''; renderAll();
}
export async function closeTrade(tid){ const t=STATE.trades.find(x=>x.tid===tid); if(!t) return;
  const it=t.itemId?STATE.byId[t.itemId]:null, def=it&&it.high?it.high:''; const v=prompt('Sell price (each):',def); if(v===null) return;
  const sell=parseGp(v); if(isNaN(sell)){ alert('Invalid price.'); return; } t.sell=sell; t.closed=now(); await sSet('trades',STATE.trades); renderAll(); }
export async function delTrade(tid){ STATE.trades=STATE.trades.filter(x=>x.tid!==tid); await sSet('trades',STATE.trades); renderAll(); }
export function realised(t){ return ((t.sell-tax(t.sell))-t.buy)*t.qty; }
export function renderLedger(){
  const open=STATE.trades.filter(t=>t.sell===null), closed=STATE.trades.filter(t=>t.sell!==null);
  document.getElementById('ledgerBadge').textContent=open.length;
  const ob=document.getElementById('openBody'), oe=document.getElementById('openEmpty');
  if(!open.length){ ob.innerHTML=''; oe.classList.remove('hidden');
    oe.innerHTML='<div class="empty"><div class="big">No open positions</div><div class="sm">Log a buy above to track a flip. Shorthand works — 1.79b, 450k.</div></div>';
  }else{ oe.classList.add('hidden');
    ob.innerHTML=open.map(t=>{ const it=t.itemId?resolveId(t.itemId):null, cur=it&&it.high?it.high:null; const un=cur!==null?((cur-tax(cur))-t.buy)*t.qty:null;
      return '<tr><td class="left"><span class="itemname">'+t.name+'</span></td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td>'+
        '<td class="num">'+(cur!==null?fmt(cur):'—')+'</td><td class="num '+(un!==null?sgn(un):'')+'">'+(un!==null?fmt(un):'—')+'</td>'+
        '<td><button class="act" data-close="'+t.tid+'">Mark sold</button> <button class="act danger" data-del="'+t.tid+'">Delete</button></td></tr>'; }).join('');
  }
  const cb=document.getElementById('closedBody'), ce=document.getElementById('closedEmpty');
  if(!closed.length){ cb.innerHTML=''; ce.classList.remove('hidden');
    ce.innerHTML='<div class="empty"><div class="big">No closed flips</div><div class="sm">Sold positions land here with realised profit after tax.</div></div>';
  }else{ ce.classList.add('hidden');
    cb.innerHTML=closed.slice().reverse().map(t=>{ const r=realised(t), tx=tax(t.sell)*t.qty;
      return '<tr><td class="left"><span class="itemname">'+t.name+'</span></td><td class="num">'+t.qty.toLocaleString()+'</td><td class="num">'+fmt(t.buy)+'</td><td class="num">'+fmt(t.sell)+'</td>'+
        '<td class="num mini loss">'+fmt(tx)+'</td><td class="num '+sgn(r)+'">'+fmt(r)+'</td><td><button class="act danger" data-del="'+t.tid+'">Delete</button></td></tr>'; }).join('');
  }
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeTrade(b.dataset.close));
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

