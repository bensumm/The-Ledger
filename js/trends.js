import { API, Z_BAND, ARCHIVE_MIN_GAP, STATE, tsCache, sGet, sSet, logEvent } from './state.js';
import { tax, fmt, fmtP, now, pad2, fmtHour, sgn } from './format.js';
import { svgLine, svgBars } from './charts.js';
import { fetchGuideSeries, resolveItem, resolveId, searchCatalog, rebuildDatalist, coarseTrend, refineTrend } from './market.js';
import { toggleWatch, renderSignals } from './ui.js';
import { switchTab } from './main.js';

/* trends + growing hourly archive */
export const ARCH_MAX_DAYS=60;
export function openTrends(id){ const it=resolveId(id); if(!it) return; switchTab('trends'); document.getElementById('trItem').value=it.name; runTrends(); }
export async function fetchTimeseries(id,step){
  const key=id+':'+step; if(tsCache[key]) return tsCache[key];
  const ctrl=new AbortController(); const to=setTimeout(()=>ctrl.abort(),15000);
  const r=await fetch(API+'/timeseries?id='+id+'&timestep='+step,{signal:ctrl.signal}); clearTimeout(to);
  const d=(await r.json()).data||[]; tsCache[key]=d; return d;
}
export async function archGet(id){ const a=await sGet('tsa:'+id); return (a&&typeof a==='object')?a:{}; }
export async function archMerge(id,series){
  const a=await archGet(id), cut=now()-ARCH_MAX_DAYS*86400;
  series.forEach(p=>{ if(p.timestamp>=cut) a[p.timestamp]=[p.avgHighPrice||0,p.avgLowPrice||0,p.highPriceVolume||0,p.lowPriceVolume||0]; });
  for(const k in a){ if(+k<cut) delete a[k]; }
  await sSet('tsa:'+id,a); return a;
}
export function archToPoints(a){ return Object.keys(a).map(k=>{ const v=a[k]; return {timestamp:+k, avgHighPrice:v[0]||null, avgLowPrice:v[1]||null, highPriceVolume:v[2]||0, lowPriceVolume:v[3]||0}; }).sort((x,y)=>x.timestamp-y.timestamp); }
export function archDays(a){ const ks=Object.keys(a); if(ks.length<2) return 0; let mn=Infinity,mx=-Infinity; ks.forEach(k=>{ k=+k; if(k<mn)mn=k; if(k>mx)mx=k; }); return Math.max(1,Math.round((mx-mn)/86400)); }
export async function archiveHourly(id){ try{ const s=await fetchTimeseries(id,'1h'); await archMerge(id,s); }catch(e){} }
export async function archiveWatchlist(force){
  if(!STATE.watchlist.length) return false;
  if(!force){ const last=await sGet('tsa_last'); if(last && (now()-last)<ARCHIVE_MIN_GAP) return false; }
  for(const id of STATE.watchlist.slice(0,25)){ await archiveHourly(id); }
  await sSet('tsa_last', now()); return true;
}
export function bestWindow(arr,L,mode){ const n=arr.length; let best=null; for(let s=0;s<n;s++){ let sum=0; for(let k=0;k<L;k++) sum+=arr[(s+k)%n]; const avg=sum/L; if(!best||(mode==='min'?avg<best.avg:avg>best.avg)) best={start:s,end:(s+L-1)%n,avg}; } return best; }
export function analyseBroad(series){
  const trend=[]; let we={p:0,c:0,v:0}, wd={p:0,c:0,v:0};
  series.forEach(pt=>{ const hi=pt.avgHighPrice, lo=pt.avgLowPrice, mid=(hi&&lo)?(hi+lo)/2:(hi||lo); if(!mid) return;
    trend.push(mid);
    const vol=(pt.highPriceVolume||0)+(pt.lowPriceVolume||0), day=new Date(pt.timestamp*1000).getDay();
    if(day===0||day===6){ we.p+=mid; we.c++; we.v+=vol; } else { wd.p+=mid; wd.c++; wd.v+=vol; }
  });
  if(!trend.length) return null;
  const days=series.length?Math.max(1,Math.round((series[series.length-1].timestamp-series[0].timestamp)/86400)):0;
  return { trend, days, wePrice:we.c?we.p/we.c:null, wdPrice:wd.c?wd.p/wd.c:null, weVol:we.c?we.v/we.c:0, wdVol:wd.c?wd.v/wd.c:0 };
}
export function analyseHourly(series){
  const hp=Array(24).fill(0), hc=Array(24).fill(0), hv=Array(24).fill(0);
  let we={p:0,pc:0,v:0,vc:0}, wd={p:0,pc:0,v:0,vc:0};
  series.forEach(pt=>{
    const hi=pt.avgHighPrice, lo=pt.avgLowPrice; let price=(hi&&lo)?(hi+lo)/2:(hi||lo); if(!price) return;
    const vol=(pt.highPriceVolume||0)+(pt.lowPriceVolume||0);
    const dt=new Date(pt.timestamp*1000), h=dt.getHours(), day=dt.getDay();
    hp[h]+=price; hc[h]++; hv[h]+=vol;
    if(day===0||day===6){ we.p+=price; we.pc++; we.v+=vol; we.vc++; } else { wd.p+=price; wd.pc++; wd.v+=vol; wd.vc++; }
  });
  const hourPrice=hp.map((s,i)=>hc[i]?s/hc[i]:null);
  const hourVol=hv.map((s,i)=>hc[i]?s/hc[i]:0);
  const avail=hourPrice.filter(v=>v!=null); if(!avail.length) return null;
  const meanPrice=avail.reduce((a,b)=>a+b,0)/avail.length;
  const hourPriceF=hourPrice.map(v=>v==null?meanPrice:v);
  let minH=-1,maxH=-1; hourPrice.forEach((v,i)=>{ if(v==null) return; if(minH<0||v<hourPrice[minH])minH=i; if(maxH<0||v>hourPrice[maxH])maxH=i; });
  const swingPct=(hourPrice[maxH]-hourPrice[minH])/meanPrice*100;
  let volPeak=0; hourVol.forEach((v,i)=>{ if(v>hourVol[volPeak])volPeak=i; });
  const days=series.length?Math.max(1,Math.round((series[series.length-1].timestamp-series[0].timestamp)/86400)):0;
  return {hourPriceF,hourPrice,hourVol,meanPrice,minH,maxH,swingPct,volPeak,days,
    wePrice:we.pc?we.p/we.pc:null, wdPrice:wd.pc?wd.p/wd.pc:null, weVol:we.vc?we.v/we.vc:0, wdVol:wd.vc?wd.v/wd.vc:0};
}
/* --- seasonal decomposition: price ~ level x hour-factor x weekday-factor --- */
export function median(arr){ if(!arr||!arr.length) return null; const s=arr.slice().sort((a,b)=>a-b), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
export const sideVal=(p,side)=>side==='low'?p.avgLowPrice:p.avgHighPrice;
export const localDayKey=ts=>{ const d=new Date(ts*1000); return d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate(); };
export const weekKey=ts=>Math.floor(ts/604800);
export const hourOf=ts=>new Date(ts*1000).getHours();
export const dowOf=ts=>new Date(ts*1000).getDay();
// detrend each point by its period's median, then volume-weighted trimmed mean of the ratios per bucket
export function seasonalFactors(points, side, bucketFn, bucketN, periodKey){
  const groups={};
  points.forEach(p=>{ const v=sideVal(p,side); if(!v) return; const k=periodKey(p.timestamp); (groups[k]=groups[k]||[]).push(v); });
  const gMed={}; for(const k in groups) gMed[k]=median(groups[k]);
  const acc=Array.from({length:bucketN},()=>({s:0,w:0,n:0}));
  points.forEach(p=>{ const v=sideVal(p,side); if(!v) return; const dm=gMed[periodKey(p.timestamp)]; if(!dm) return;
    const r=v/dm; if(r<0.5||r>2) return;                       // trim corrupt prints
    const w=(p.highPriceVolume||0)+(p.lowPriceVolume||0)+1;     // volume weight
    const b=acc[bucketFn(p.timestamp)]; b.s+=r*w; b.w+=w; b.n++; });
  return { factor:acc.map(b=>b.w?b.s/b.w:null), counts:acc.map(b=>b.n) };
}
export const hourFactors=(pts,side)=>seasonalFactors(pts,side,hourOf,24,localDayKey);
export const weekdayFactors=(pts,side)=>seasonalFactors(pts,side,dowOf,7,weekKey);
export function factorStats(factor){
  const v=factor.filter(x=>x!=null); if(v.length<3) return {flat:true,swingPct:0,z:0};
  const mean=v.reduce((a,b)=>a+b,0)/v.length, sd=Math.sqrt(v.reduce((a,b)=>a+(b-mean)*(b-mean),0)/v.length);
  const mn=Math.min(...v), mx=Math.max(...v);
  return {mean,sd,mn,mx,swingPct:(mx-mn)/mean*100, z:sd>0?(mean-mn)/sd:0, flat:(mx-mn)/mean*100<0.5 || (sd>0?(mean-mn)/sd:0)<1.0};
}
export function buildPlan(points, s6h, it){
  const o={ archDays: points.length>1?Math.max(1,Math.round((points[points.length-1].timestamp-points[0].timestamp)/86400)):0 };
  const hfLow=hourFactors(points,'low'), hfHigh=hourFactors(points,'high');
  o.lowEdge=factorStats(hfLow.factor); o.highEdge=factorStats(hfHigh.factor);
  o.medCount=median(hfLow.counts.filter(c=>c>0))||0;
  const lowF=hfLow.factor.map(v=>v==null?1:v), highF=hfHigh.factor.map(v=>v==null?1:v);
  o.buyWin=bestWindow(lowF,3,'min'); o.sellWin=bestWindow(highF,3,'max');   // cheapest / richest hour windows — timing hint only
  o.nowGross=(it.high-tax(it.high))-it.low; o.nowRoi=it.low?o.nowGross/it.low*100:0;
  o.nowSpread=it.high-it.low; o.nowTax=tax(it.high);                 // the plan IS the live spread vs the tax it must clear
  o.nowProfitable=o.nowGross>0;
  // weekday effect (buy side) from 6h layer
  if(s6h&&s6h.length>6){ const wf=weekdayFactors(s6h,'low').factor;
    const we=[0,6].map(d=>wf[d]).filter(v=>v!=null), wd=[1,2,3,4,5].map(d=>wf[d]).filter(v=>v!=null);
    if(we.length&&wd.length){ const wem=we.reduce((a,b)=>a+b,0)/we.length, wdm=wd.reduce((a,b)=>a+b,0)/wd.length; o.weBuyDiscPct=(wdm-wem)/wdm*100; } }
  // 3-month drift
  if(s6h&&s6h.length>9){ const t=Math.floor(s6h.length/3);
    const older=median(s6h.slice(0,t).map(p=>p.avgLowPrice).filter(Boolean)), recent=median(s6h.slice(-t).map(p=>p.avgLowPrice).filter(Boolean));
    o.trendPct=(older&&recent)?(recent-older)/older*100:null; }
  o.flat=o.lowEdge.flat && o.highEdge.flat;
  o.conf = (o.archDays>=10 && o.medCount>=5) ? 'good' : (o.archDays>=4 && o.medCount>=2) ? 'moderate' : 'low';
  return o;
}
/* --- walk-forward backtest: fit factors only on days BEFORE each test day (no look-ahead) --- */
export function dayGroups(points){
  const g={}; points.forEach(p=>{ const k=localDayKey(p.timestamp); (g[k]=g[k]||[]).push(p); });
  return Object.keys(g).map(k=>({key:k, pts:g[k], t:g[k][0].timestamp})).sort((a,b)=>a.t-b.t);
}
export function backtestPlan(points){
  const days=dayGroups(points);
  const warm=Math.max(4, Math.ceil(days.length*0.4));
  if(days.length-warm < 4) return {insufficient:true, days:days.length};
  const inWin=(h,w)=>{ for(let k=0;k<3;k++) if((w.start+k)%24===h) return true; return false; };
  const sR=[], bR=[]; let wins=0, beat=0;
  for(let i=warm;i<days.length;i++){
    const train=[]; for(let j=0;j<i;j++) train.push(...days[j].pts);
    const hfL=hourFactors(train,'low'), hfH=hourFactors(train,'high');
    if(hfL.counts.filter(c=>c>0).length<6) continue;
    const lowF=hfL.factor.map(v=>v==null?1:v), highF=hfH.factor.map(v=>v==null?1:v);
    const wb=bestWindow(lowF,3,'min'), ws=bestWindow(highF,3,'max');
    let bl=[], sh=[], spSum=0, spLow=0, spN=0;
    days[i].pts.forEach(p=>{ const h=hourOf(p.timestamp);
      if(p.avgLowPrice&&inWin(h,wb)) bl.push(p.avgLowPrice);
      if(p.avgHighPrice&&inWin(h,ws)) sh.push(p.avgHighPrice);
      if(p.avgLowPrice&&p.avgHighPrice){ spSum+=(p.avgHighPrice-tax(p.avgHighPrice)-p.avgLowPrice); spLow+=p.avgLowPrice; spN++; } });
    if(!bl.length||!sh.length||!spN) continue;
    const buyP=bl.reduce((a,b)=>a+b,0)/bl.length, sellP=sh.reduce((a,b)=>a+b,0)/sh.length;
    const sg=(sellP-tax(sellP))-buyP, sroi=sg/buyP*100;
    const broi=(spSum/spN)/(spLow/spN)*100;
    sR.push(sroi); bR.push(broi); if(sg>0) wins++; if(sroi>broi) beat++;
  }
  const n=sR.length; if(n<4) return {insufficient:true, days:days.length};
  const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const stratRoi=mean(sR), spreadRoi=mean(bR);
  return { n, stratRoi, spreadRoi, edge:stratRoi-spreadRoi, winRate:wins/n*100, beatRate:beat/n*100 };
}
/* --- lightweight buy-target for live signals (hourly archive only, no network) --- */
export function planSignal(points){
  if(points.length<24) return null;
  const days=points.length>1?Math.max(1,Math.round((points[points.length-1].timestamp-points[0].timestamp)/86400)):0;
  const hf=hourFactors(points,'low'), medCount=median(hf.counts.filter(c=>c>0))||0;
  const wb=bestWindow(hf.factor.map(v=>v==null?1:v),3,'min');
  const conf=(days>=10&&medCount>=5)?'good':(days>=4&&medCount>=2)?'moderate':'low';
  return { buyWin:wb, conf, archDays:days };   // hour timing + confidence only; the flip decision is live-spread native
}
export async function computeSignals(){
  const cache={};
  for(const id of STATE.watchlist){ try{
    const pts=archToPoints(await archGet(id)); const s=planSignal(pts); if(!s) continue;
    const it=STATE.byId[id];
    if(it){ const series=pts.map(p=>({t:p.timestamp, price:(p.avgHighPrice&&p.avgLowPrice)?(p.avgHighPrice+p.avgLowPrice)/2:(p.avgHighPrice||p.avgLowPrice)})).filter(p=>p.price);
      s.trend=refineTrend(it, series); }
    cache[id]=s;
  }catch(e){} }
  STATE.signalCache=cache; renderSignals();
}
export function renderMatches(query){
  const status=document.getElementById('trStatus'), box=document.getElementById('trMatches');
  document.getElementById('trResult').classList.add('hidden');
  document.getElementById('trEmpty').classList.add('hidden');
  const q=(query||'').trim();
  if(q.length<2){ status.textContent='Type at least two letters to search.'; box.classList.add('hidden'); return; }
  const rows=searchCatalog(q,40);
  if(!rows.length){ status.textContent='No items match “'+q+'”.'; box.classList.add('hidden'); return; }
  status.textContent='';
  let html='<div class="matchhead"><b>'+rows.length+(rows.length===40?'+':'')+'</b> items match “'+q+'” — tap one to quote it. <span class="mini">Off-screen items aren’t on the flip screen; the quote still shows buy/sell, even when it isn’t a profitable flip.</span></div>';
  html+='<div class="tablewrap"><table><thead><tr><th class="left">Item</th><th>Buy</th><th>Sell</th><th>Margin</th><th>Vol/hr</th><th></th></tr></thead><tbody>';
  html+=rows.map(it=>{ const off=!!it.offscreen;
    return '<tr><td class="left"><span class="linkname" data-open="'+it.id+'">'+it.name+'</span>'+(off?' <span class="mini">off-screen</span>':'')+'</td>'+
      '<td class="num">'+fmtP(it.low)+'</td><td class="num">'+fmtP(it.high)+'</td>'+
      '<td class="num '+sgn(it.margin)+'">'+fmtP(it.margin)+'</td>'+
      '<td class="num mini">'+fmt(it.volume)+'</td>'+
      '<td><button class="act" data-open="'+it.id+'">Quote</button></td></tr>'; }).join('');
  html+='</tbody></table></div>';
  box.innerHTML=html; box.classList.remove('hidden');
  box.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{ const it=resolveId(+b.dataset.open); if(it){ document.getElementById('trItem').value=it.name; runTrends(); } });
}
export async function togglePin(id){
  const i=STATE.pinned.indexOf(id); if(i>=0) STATE.pinned.splice(i,1); else STATE.pinned.push(id);
  await sSet('pinned',STATE.pinned); rebuildDatalist();
}
export function renderTrendHead(it){
  const watched=STATE.watchlist.includes(it.id), isPinned=STATE.pinned.includes(it.id), off=!!it.offscreen;
  let h='<div class="trhead"><span class="trhead-name">'+it.name+'</span>';
  if(off) h+='<span class="qtag">quote only · off the flip screen</span>';
  h+='<span class="trhead-acts">';
  h+='<button class="tgl '+(watched?'on':'')+'" data-watch="'+it.id+'">'+(watched?'★ Watching':'☆ Watch')+'</button>';
  if(off) h+='<button class="tgl '+(isPinned?'on':'')+'" data-pin="'+it.id+'">'+(isPinned?'📌 Pinned':'📌 Pin to search')+'</button>';
  h+='</span></div>';
  const el=document.getElementById('trHead'); el.innerHTML=h;
  const wb=el.querySelector('[data-watch]'); if(wb) wb.onclick=async()=>{ await toggleWatch(it.id); renderTrendHead(it); };
  const pb=el.querySelector('[data-pin]'); if(pb) pb.onclick=async()=>{ await togglePin(it.id); renderTrendHead(it); };
}
export async function runTrends(){
  const name=document.getElementById('trItem').value.trim();
  const status=document.getElementById('trStatus');
  const it=resolveItem(name);
  if(!it){ renderMatches(name); return; }   // no exact match -> whole-catalog substring search
  document.getElementById('trMatches').classList.add('hidden');
  status.textContent='loading history…';
  document.getElementById('trResult').classList.add('hidden');
  try{
    const [s1h,s6h]=await Promise.all([fetchTimeseries(it.id,'1h'), fetchTimeseries(it.id,'6h')]);
    const arch=await archMerge(it.id,s1h);
    const pts=archToPoints(arch);
    const a=analyseHourly(pts.length>1?pts:s1h);
    const b=analyseBroad(s6h);
    if(!a){ status.textContent='No usable history yet.'; return; }
    status.textContent='';
    document.getElementById('trEmpty').classList.add('hidden');
    document.getElementById('trResult').classList.remove('hidden');
    renderTrendHead(it);
    const showAnalysis=!it.offscreen;   // off-screen quotes stay compact: price card only
    ['trInsight','trCharts','trWkWrap'].forEach(eid=>{ const el=document.getElementById(eid); if(el) el.classList.toggle('hidden',!showAnalysis); });
    const hourLabels=Array.from({length:24},(_,i)=>pad2(i));
    document.getElementById('trPrice').innerHTML=svgLine(a.hourPriceF,{labels:hourLabels,ticks:[0,6,12,18,23]});
    document.getElementById('trPriceCap').innerHTML='Green = cheapest hour to buy · red = priciest to sell.';
    document.getElementById('trVol').innerHTML=svgBars(a.hourVol,{labels:hourLabels,ticks:[0,6,12,18,23]});
    // seasonal plan (the reconciled buy/sell model)
    const P=buildPlan(pts.length>1?pts:s1h, s6h, it);
    const winStr=w=>fmtHour(w.start)+'–'+fmtHour((w.end+1)%24);
    // 3-month history (6h) with the live buy price as the reference line
    if(showAnalysis && b && b.trend.length>2){
      document.getElementById('trHistWrap').classList.remove('hidden');
      document.getElementById('trHist').innerHTML=svgLine(b.trend,{baseline:it.low, markExtremes:false});
      document.getElementById('trHistCap').innerHTML='~'+b.days+' days at 6h steps · dashed line = live buy ('+fmtP(it.low)+').';
    } else { document.getElementById('trHistWrap').classList.add('hidden'); }
    // weekday/weekend descriptive boxes
    const weP=b?b.wePrice:a.wePrice, wdP=b?b.wdPrice:a.wdPrice, weV=b?b.weVol:a.weVol, wdV=b?b.wdVol:a.wdVol;
    const pdiff=(weP!=null&&wdP)?(weP-wdP)/wdP*100:null;
    document.getElementById('trWk').innerHTML=
      '<div class="wkbox"><div class="lbl">Weekday</div><div class="b">'+fmt(wdP)+'</div><div class="s">avg price · '+fmt(wdV)+'/period volume</div></div>'+
      '<div class="wkbox"><div class="lbl">Weekend</div><div class="b">'+fmt(weP)+'</div><div class="s">avg price · '+fmt(weV)+'/period volume'+(pdiff!=null?' · '+(pdiff>=0?'+':'')+pdiff.toFixed(1)+'%':'')+'</div></div>';
    // ---- plan card: the live spread IS the plan (median targets removed); trend box + timing hint ----
    const prof=P.nowProfitable;
    const gs=coarseTrend(it);
    let tState='—', tCls='', tSub='no guide reference', volatile=false;
    if(gs.state==='down'){ tState='Falling ▼'; tCls='loss'; tSub=Math.abs(gs.divPct).toFixed(1)+'% below guide'; volatile=(gs.intensity>=0.35)||(Math.abs(gs.divPct)>=6); }
    else if(gs.state==='up'){ tState='Rising ▲'; tCls='gold'; tSub='+'+gs.divPct.toFixed(1)+'% above guide'; volatile=(gs.intensity>=0.35)||(Math.abs(gs.divPct)>=6); }
    else if(gs.state==='straddle'){ tState='Stable'; tCls='gain'; tSub='at guide ('+(gs.divPct>=0?'+':'')+gs.divPct.toFixed(1)+'%)'; }
    else if(gs.state==='thin'){ tState='Thin'; tSub='low volume — guide is noisy'; }
    let grid='<div class="stitle">'+(prof?'Suggested plan':'No profitable spread right now')+' <span class="csub">live market · after 2% tax</span></div><div class="sgrid">';
    grid+='<div class="sbox"><div class="sk">Buy ≈</div><div class="sv">'+fmtP(it.low)+'</div><div class="ss">at/above the instasell</div></div>'+
          '<div class="sbox"><div class="sk">Sell ≈</div><div class="sv">'+fmtP(it.high)+'</div><div class="ss">at/below the instabuy</div></div>'+
          '<div class="sbox"><div class="sk">Profit now</div><div class="sv '+sgn(P.nowGross)+'">'+(prof?'+'+fmtP(P.nowGross):'none')+'</div><div class="ss">'+(prof?P.nowRoi.toFixed(1)+'% · need ~'+fmtP(P.nowTax)+', have ~'+fmtP(P.nowSpread):'spread ~'+fmtP(P.nowSpread)+' < ~'+fmtP(P.nowTax)+' tax')+'</div></div>'+
          '<div class="sbox"><div class="sk">Trend</div><div class="sv '+tCls+'">'+tState+(volatile?' <span class="loss" title="price moving fast">⚡</span>':'')+'</div><div class="ss">'+tSub+'</div></div>';
    grid+='</div>';
    let r='';
    if(volatile) r+='<b class="loss">⚡ Volatile</b> — this item is '+(gs.state==='up'?'rising':'falling')+' fast ('+(gs.divPct>=0?'+':'')+gs.divPct.toFixed(1)+'% vs guide), so the spread can move against you between buying and selling. Size down and don’t chase. ';
    if(prof) r+='Buy near <b>'+fmtP(it.low)+'</b> and sell near <b>'+fmtP(it.high)+'</b>, netting <b class="gain">'+fmtP(P.nowGross)+'</b> after tax (<b>'+P.nowRoi.toFixed(1)+'%</b>). You need ~<b>'+fmtP(P.nowTax)+'</b> of spread to clear the 2% tax; there’s ~'+fmtP(P.nowSpread)+' right now.';
    else r+='The live spread (~'+fmtP(P.nowSpread)+') <b>doesn’t clear the 2% tax</b> (~'+fmtP(P.nowTax)+'), so there’s <b class="loss">no profitable flip</b> right now — wait for the buy/sell gap to widen past ~'+fmtP(P.nowTax)+'.';
    if(!P.flat){
      r+=' <b>Timing hint:</b> historically cheapest to buy around <span class="hl">'+winStr(P.buyWin)+'</span> and richest to sell around <span class="hl">'+winStr(P.sellWin)+'</span>';
      if(P.weBuyDiscPct!=null && P.weBuyDiscPct>0.4) r+=', and weekends run ~<b>'+P.weBuyDiscPct.toFixed(1)+'%</b> cheaper';
      r+=' — a scheduling edge, not a price target.';
    }
    if(P.trendPct!=null && Math.abs(P.trendPct)>=2) r+=' Over ~3 months it has drifted <b>'+(P.trendPct>0?'+':'')+P.trendPct.toFixed(0)+'%</b>.';
    r+=' <span class="ccap">Buy/sell are live prices; timing shape from <b>'+P.archDays+'d</b> of hourly data (confidence <b>'+P.conf+'</b>); trend from guide divergence. Not guarantees.</span>';
    document.getElementById('trSuggest').innerHTML=grid+'<div class="sreason">'+r+'</div>';
    document.getElementById('trInsight').innerHTML='Deepest liquidity around <span class="hl">'+fmtHour(a.volPeak)+'</span> — the easiest window to fill larger orders quickly.';
    if(!showAnalysis){ document.getElementById('trGuide').style.display='none'; }
    else{
    // official guide divergence + momentum (refined: z-scores vs guide and vs own mean)
    const gEl=document.getElementById('trGuide');
    const gp=(STATE.GUIDE[it.id]&&STATE.GUIDE[it.id].price)||null;
    if(gp){
      const mid=(it.low+it.high)/2;
      let gs=null;
      try{ gs=await fetchGuideSeries(it.id); logEvent('info','guide','guide history ok for '+it.name+' ('+gs.length+' pts) — weirdgloop reachable'); }
      catch(e){ logEvent('info','guide','history fetch failed for '+it.id); }
      const R=refineTrend(it, gs||[]);
      const STATE_TXT={
        'healthy':'<b class="gold">healthy</b> — live spread brackets the guide, mean-reverting',
        'down-confirmed':'<b class="loss">confirmed downtrend</b> — live sits '+(R.ok?Math.abs(R.zGuide).toFixed(1):'')+'σ under the guide <i>and</i> guide momentum is negative: a falling knife, not a dip',
        'reversion':'<b class="amber">dislocated low</b> — live is well under the guide but momentum has stopped falling: a possible reversion buy, not a confirmed trend',
        'up':'<b class="gain">uptrend</b> — live trades above the official price' };
      let body2;
      if(R.ok){
        const mlist=[]; if(R.m7!=null) mlist.push((R.m7>=0?'+':'')+R.m7.toFixed(1)+'%/7d'); if(R.m30!=null) mlist.push((R.m30>=0?'+':'')+R.m30.toFixed(1)+'%/30d');
        body2='<b>vs official guide.</b> Guide <span class="hl">'+fmt(gp)+'</span> · live mid <span class="hl">'+fmt(mid)+'</span> ('+(R.divPct>=0?'+':'')+R.divPct.toFixed(1)+'%). '+
          'Dislocation <b class="'+(R.zGuide<0?'loss':'gain')+'">'+(R.zGuide>=0?'+':'')+R.zGuide.toFixed(2)+'σ</b> vs guide, <b>'+(R.zMean>=0?'+':'')+R.zMean.toFixed(2)+'σ</b> vs its own '+R.days+'d mean. '+
          (mlist.length?'Guide momentum '+mlist.join(', ')+'. ':'')+
          'State: '+(STATE_TXT[R.state]||R.state)+'. <span class="ccap">z-score = how many standard deviations the live price sits from the reference; |z|&lt;'+Z_BAND.toFixed(1)+' is normal noise. Tendency, not a fill guarantee.</span>';
      } else {
        const div=(mid-gp)/gp*100;
        const coarse=(it.low<=gp&&gp<=it.high)?'straddles the guide (healthy)':(it.high<gp?'below guide (downtrend)':'above guide (uptrend)');
        body2='<b>vs official guide.</b> Guide <span class="hl">'+fmt(gp)+'</span> · live mid <span class="hl">'+fmt(mid)+'</span> (<b class="'+(div>=0?'gain':'loss')+'">'+(div>=0?'+':'')+div.toFixed(1)+'%</b>). Spread '+coarse+'. <span class="ccap">Not enough guide history for a z-score'+(gs?'':' — weirdgloop unreachable')+'; showing point-in-time divergence only.</span>';
      }
      gEl.style.display=''; gEl.innerHTML=body2;
    } else { gEl.style.display='none'; }
    }
    // walk-forward backtest
    if(!showAnalysis){ document.getElementById('trBtWrap').classList.add('hidden'); }
    else{
    document.getElementById('trBtWrap').classList.remove('hidden');
    const bt=backtestPlan(pts.length>1?pts:s1h);
    const btEl=document.getElementById('trBt');
    if(bt.insufficient){
      btEl.innerHTML='<div class="mini">Not enough out-of-sample history yet ('+bt.days+' day'+(bt.days===1?'':'s')+' banked). The model needs several held-out days to prove the timing edge — keep this item starred and re-check in a week or two.</div>';
    }else{
      const good=bt.edge>0.3 && bt.beatRate>=60, bad=bt.edge<=0 || bt.beatRate<50;
      const verdictCls=good?'gain':(bad?'loss':'gold');
      const verdict=good?'The timing model beat naive spread-flipping out of sample.':(bad?'No reliable edge — on held-out days the model didn’t beat flipping the spread. Trade the spread here.':'Marginal — the edge is small and inconsistent; treat with caution.');
      btEl.innerHTML=
        '<div class="sgrid">'+
        '<div class="sbox"><div class="sk">Model swing ROI</div><div class="sv '+sgn(bt.stratRoi)+'">'+bt.stratRoi.toFixed(2)+'%</div><div class="ss">avg / cycle, out of sample</div></div>'+
        '<div class="sbox"><div class="sk">Spread-flip ROI</div><div class="sv">'+bt.spreadRoi.toFixed(2)+'%</div><div class="ss">naive benchmark</div></div>'+
        '<div class="sbox"><div class="sk">Beat rate</div><div class="sv">'+bt.beatRate.toFixed(0)+'%</div><div class="ss">of '+bt.n+' held-out days · '+bt.winRate.toFixed(0)+'% profitable</div></div>'+
        '</div>'+
        '<div class="sreason"><b class="'+verdictCls+'">'+verdict+'</b> <span class="ccap">Expanding walk-forward: factors fit only on days before each test day, scored on '+bt.n+' held-out days. Per-unit, pre-fill-risk, on aggregate hourly averages.</span></div>';
    }
    }
  }catch(e){ status.textContent='Couldn’t load history — try again.'; }
}

