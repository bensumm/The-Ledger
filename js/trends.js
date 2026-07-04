import { API, Z_BAND, ARCHIVE_MIN_GAP, STATE, tsCache, sGet, sSet, logEvent } from './state.js';
import { tax, netMargin, fmt, fmtP, now, pad2, fmtHour, sgn } from './format.js';
import { svgLine, svgBars } from './charts.js';
import { fetchGuideSeries, resolveItem, resolveId, searchCatalog, rebuildDatalist, coarseTrend, refineTrend } from './market.js';
import { toggleWatch, renderSignals } from './ui.js';
import { switchTab } from './main.js';
import { regimeDrift, momVerdict } from './quotecore.js';   // shared impls (regime + cut-trigger) so quotes/positions reuse them
import { fetchQuote, quoteTableHtml } from './quote.js';

/*
 * TRENDS TAB STRUCTURE (as of 0.16.0) — read before editing runTrends.
 * The per-item Trends view is organized in decision-priority tiers, deliberately —
 * don't scatter new info back into a flat list:
 *  1. Suggested plan card (#trSuggest) — instant buy/sell, profit-now, trend box, and
 *     warnings. Includes trend-aware pricing (patientTargets(series, it, falling)):
 *     steady/rising items get a wider-margin patient offer off the recent ~2h 5m range
 *     (20th/80th percentiles); falling items instead get buy-low/sell-quick targets — a
 *     more aggressive low bid (10th pctl) and a sell priced to *clear* at/below the
 *     instabuy (min(instabuy, 50th pctl)), never above a dropping market (0.20.0). The
 *     plan card branches its copy on PT.falling. And a regime-shift warning
 *     (regimeDrift(): last-3d median vs prior ~2wk; fires at >=8%). No sigma jargon here.
 *  2. "Why this trend?" (#trWhy, collapsible) — plain-language guide-divergence readout;
 *     the sigma number lives only in this expander's fine print.
 *  3. Price history (#trHistWrap) — 3-month chart, promoted as immediate context.
 *  4. Timing & seasonality (#trTiming, collapsible) — gated on the walk-forward backtest:
 *     the hourly price/volume charts (#trCharts) only render when the timing edge is
 *     actually proven out-of-sample (good && !regimeShift); otherwise the section states
 *     "no proven edge"/"unreliable" and hides the charts. Weekday/weekend boxes were
 *     removed (effect was ~noise).
 * Key lesson: hourly seasonality is usually noise or a regime artifact; conf/medCount only
 * measure history coverage, not price-level stability, so the regime guard + backtest gate
 * exist to stop one-off jumps masquerading as cycles.
 * (Moved here from CLAUDE.md by PLAN.md chunk K3 — this file is where every editor of the
 * Trends view already looks; CLAUDE.md keeps a one-line pointer.)
 */

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
  o.regime = regimeDrift(points);
  return o;
}
/* regimeDrift moved to js/quotecore.js (imported above) so the Trends plan card, position
   review, and the standard quote model all share ONE regime-shift impl. */
/* --- patient-offer sizing: instant spread vs. waiting for the range edges -----
   The live low/high is the instant-fill spread. If you'll wait, you can often buy
   nearer the low end of the recent range and sell nearer the high end, clearing a
   bigger margin at the cost of fill certainty. Uses ~2h of 5m data; the 20th/80th
   percentiles keep the targets inside where it has actually traded (not the single
   noisiest print), and clamps so a patient target never sits worse than the live
   quote. Returns ok:false when there isn't enough recent data to size it. */
export function patientTargets(series, it, falling){
  if(!series || !series.length || !it || !it.low || !it.high) return {ok:false};
  const recent=series.slice(-24);   // ~2h at 5m steps
  const los=recent.map(p=>p.avgLowPrice).filter(Boolean).sort((a,b)=>a-b);
  const his=recent.map(p=>p.avgHighPrice).filter(Boolean).sort((a,b)=>a-b);
  if(los.length<4 || his.length<4) return {ok:false};
  const pctl=(s,p)=>s[Math.min(s.length-1,Math.max(0,Math.round((s.length-1)*p)))];
  // Falling items: don't sit above a dropping market. Bid MORE aggressively low (the price is
  // coming to you) and price the sell to clear at/below the instabuy, not at a stale recent high.
  // Steady/rising: the original patient logic — wait at the wider range edges for a fatter margin.
  const patientBuy = falling ? Math.min(it.low, pctl(los,0.1))    // more aggressive low bid
                             : Math.min(it.low, pctl(los,0.2));   // never pay MORE than the instant buy
  const patientSell = falling ? Math.min(it.high, pctl(his,0.5))  // clear at/below the instabuy
                              : Math.max(it.high, pctl(his,0.8)); // never ask LESS than the instant sell
  return {ok:true, falling:!!falling, patientBuy, patientSell,
    patientMargin:netMargin(patientBuy,patientSell), fastMargin:netMargin(it.low,it.high),
    loMin:los[0], hiMax:his[his.length-1]};
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
  if(it.volume!=null) h+='<span class="trhead-vol" title="units traded in the last hour (both sides) — the liquidity behind these prices">'+fmt(it.volume)+'/hr traded · ~'+fmt(it.volume*24)+'/day</span>';
  if(off) h+='<span class="qtag">quote only · off the flip screen</span>';
  h+='<span class="trhead-acts">';
  h+='<button class="tgl '+(watched?'on':'')+'" data-watch="'+it.id+'">'+(watched?'★ Watching':'☆ Watch')+'</button>';
  if(off) h+='<button class="tgl '+(isPinned?'on':'')+'" data-pin="'+it.id+'">'+(isPinned?'📌 Pinned':'📌 Pin to search')+'</button>';
  h+='</span></div>';
  const el=document.getElementById('trHead'); el.innerHTML=h;
  const wb=el.querySelector('[data-watch]'); if(wb) wb.onclick=async()=>{ await toggleWatch(it.id); renderTrendHead(it); };
  const pb=el.querySelector('[data-pin]'); if(pb) pb.onclick=async()=>{ await togglePin(it.id); renderTrendHead(it); };
}
/* --- position review: for each OPEN position, live guidance (HOLD / ADJUST / CUT + list-at price) ---
   The pivot is the break-even sell price (ceil(buy/0.98) — the sell that nets cost after
   2% tax) crossed with the trend. Reuses the same building blocks as the Trends plan:
   patientTargets (recent 2h range edges), regimeDrift (3d vs 2wk level shift) and
   refineTrend (guide divergence + 7d/30d momentum). Guidance, not guarantees. */
export function classifyPositionTrend(s6h, R){
  const regime=regimeDrift(s6h);
  const m7=(R&&R.ok)?R.m7:null, m30=(R&&R.ok)?R.m30:null;
  const falling=(R&&R.ok&&R.state==='down-confirmed') || (regime.ok&&regime.driftPct<=-5) || (m30!=null&&m30<=-15);
  const rising =(R&&R.ok&&R.state==='up') || (regime.ok&&regime.driftPct>=5);
  return {falling, rising, regime, m7, m30};
}
export function renderPositionCard(t, it, s5m, s6h, gser, qrow){
  const buy=t.buy, qty=t.qty;
  const sellNow=it.high, netNow=sellNow-tax(sellNow), profNow=(netNow-buy)*qty;
  const breakeven=Math.ceil(buy/0.98);                 // sell price that nets >= cost after 2% tax
  const canBE=netNow>=buy;
  const PT=patientTargets(s5m, it);
  const patientSell=PT.ok?PT.patientSell:sellNow, hiMax=PT.ok?PT.hiMax:sellNow;
  const R=refineTrend(it, gser||[]);
  const tr=classifyPositionTrend(s6h, R);
  let verdict, cls, listAt, why;
  // Underwater decision tree (PLAN-3, was the chunk-6 cut-trigger): the held position's precise
  // 2h read (from the standard quote row, same fetch) LEADS the multi-day regime. Shared
  // momVerdict() keeps this identical to quote.mjs --positions / watch.mjs. It returns a verdict
  // for an unreliable quote (NO-READ), a diurnal trough (DIURNAL-WATCH), a one-off shock
  // (SHOCK-WATCH), a breakup/breakdown, or a clean-but-persistently-underwater lot (CUT-CANDIDATE);
  // it returns null ONLY when the quote is clean, reliable and NOT escalating → the regime-only
  // branches below run unchanged.
  const lotValue=buy*qty;   // capital at risk in this lot (qty × avgCost)
  // Pass the 5m series so the PLAN-3 gate tree can run its diurnal / shape / underwater-persistence
  // reads (Gates 1/2-shape/D). NO-READ, DIURNAL-WATCH and SHOCK-WATCH arrive here as ordinary mv
  // verdicts and render through the shared branch below.
  const mv=qrow?momVerdict(qrow, breakeven, lotValue, s5m):null;
  if(mv){
    verdict=mv.verdict; cls=mv.cls; why=mv.why;
    // NO-READ / HOLD_WATCH carry no reprice (listAt null): NO-READ keeps the ask at break-even
    // (no price action off an unreliable quote); HOLD_WATCH keeps the patient/BE ask.
    listAt = mv.listAt!=null ? mv.listAt : (mv.action==='NO_READ' ? breakeven : (canBE?patientSell:breakeven));
  } else if(tr.falling){
    // Falling: price to clear at the instabuy regardless of profit. Never list above a dropping
    // market — the recent highs are stale, and every hour spent above the bid the range steps
    // down toward you anyway. In profit → take it; underwater → take the small loss now.
    listAt=sellNow;
    if(canBE){ verdict='SELL — price to clear'; cls='amber'; why='In profit but falling — don’t list above a dropping market. Price at the instabuy ('+fmtP(sellNow)+') to sell into current demand; if a big stack isn’t clearing, step down with the market rather than waiting above it. Don’t hold out for a recovery.'; }
    else { verdict='CUT'; cls='loss'; why='Underwater and falling — take the small loss now at the instabuy rather than risk a bigger one; don’t list above the market hoping for a bounce.'; }
  } else if(canBE){
    verdict='HOLD'; cls='gain'; listAt=patientSell; why='In profit and steady — list at the patient target to capture more; fills near the top of the recent 2h range.';
  } else {
    verdict='HOLD'; cls='gold'; listAt=breakeven; why='Underwater but flat — list at break-even and wait for the normal wobble up; no reason to realise a loss yet.';
  }
  const netAt=listAt-tax(listAt), profAt=(netAt-buy)*qty;
  const fill=listAt<=sellNow?'fills ~instantly':(listAt<=hiMax?'within the recent 2h range — fills with patience':'above the recent 2h high — may sit');
  const trWord=tr.falling?'Falling':(tr.rising?'Rising':'Flat'), trCls=tr.falling?'loss':(tr.rising?'gold':'gain');
  const mom=[]; if(tr.m7!=null)mom.push((tr.m7>=0?'+':'')+tr.m7.toFixed(0)+'%/7d'); if(tr.m30!=null)mom.push((tr.m30>=0?'+':'')+tr.m30.toFixed(0)+'%/30d'); if(tr.regime.ok)mom.push('regime '+(tr.regime.driftPct>=0?'+':'')+tr.regime.driftPct.toFixed(0)+'%');
  const tableHtml=qrow?quoteTableHtml(t.name, qrow):'';   // same standard columns as Finder/Trends, for consistency
  return '<div class="suggest" style="margin-top:10px">'+
    tableHtml+
    '<div class="stitle">'+t.name+' <span class="csub">×'+qty.toLocaleString()+' @ '+fmtP(buy)+'</span><span class="'+cls+'" style="float:right;font-weight:700">'+verdict+'</span></div>'+
    '<div class="sgrid">'+
      '<div class="sbox"><div class="sk">Break-even</div><div class="sv">'+fmtP(breakeven)+'</div><div class="ss">nets your cost</div></div>'+
      '<div class="sbox"><div class="sk">Sell now</div><div class="sv">'+fmtP(sellNow)+'</div><div class="ss '+sgn(profNow)+'">'+(profNow>=0?'+':'')+fmt(profNow)+'</div></div>'+
      '<div class="sbox"><div class="sk">Trend</div><div class="sv '+trCls+'">'+trWord+'</div><div class="ss mini">'+(mom.join(' · ')||'—')+'</div></div>'+
      '<div class="sbox"><div class="sk">List at</div><div class="sv '+cls+'">'+fmtP(listAt)+'</div><div class="ss '+sgn(profAt)+'">'+(profAt>=0?'+':'')+fmt(profAt)+'</div></div>'+
    '</div>'+
    '<div class="sreason">'+why+' <b>'+fill+'</b> at '+fmtP(listAt)+'.</div></div>';
}
export async function reviewPositions(){
  const btn=document.getElementById('reviewPos'), box=document.getElementById('posReview');
  if(!box) return;
  const open=STATE.trades.filter(t=>t.sell===null && t.itemId);
  const noId=STATE.trades.filter(t=>t.sell===null && !t.itemId).length;
  box.classList.remove('hidden');
  if(!open.length){ box.innerHTML='<div class="mini">No open positions with a known item to review'+(noId?' ('+noId+' manual entr'+(noId===1?'y has':'ies have')+' no linked item).':'.')+'</div>'; return; }
  if(btn){ btn.disabled=true; btn.textContent='Reviewing…'; }
  box.innerHTML='<div class="mini">Pulling live prices, recent 2h range, and guide momentum for '+open.length+' position'+(open.length===1?'':'s')+'…</div>';
  const cards=[];
  for(const t of open){
    try{
      const it=resolveId(t.itemId); if(!it||!it.high){ cards.push('<div class="suggest" style="margin-top:10px"><div class="stitle">'+t.name+'</div><div class="mini">No live quote available.</div></div>'); continue; }
      const [s5m,s6h]=await Promise.all([fetchTimeseries(t.itemId,'5m'), fetchTimeseries(t.itemId,'6h')]);
      let gser=[]; try{ gser=await fetchGuideSeries(t.itemId); }catch(e){}
      let qrow=null; try{ qrow=await fetchQuote(t.itemId,{held:true}); }catch(e){}   // held → always shown even if falling
      cards.push(renderPositionCard(t, it, s5m, s6h, gser, qrow));
    }catch(e){ cards.push('<div class="suggest" style="margin-top:10px"><div class="stitle">'+t.name+'</div><div class="mini">Couldn’t load live data — try again.</div></div>'); }
  }
  box.innerHTML='<div class="stitle" style="margin-top:6px">Position review <span class="csub">live · after 2% tax · break-even = sell that nets cost · guidance, not guarantees</span></div>'+cards.join('');
  if(btn){ btn.disabled=false; btn.textContent='Review pricing'; }
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
    const [s1h,s6h,s5m]=await Promise.all([fetchTimeseries(it.id,'1h'), fetchTimeseries(it.id,'6h'), fetchTimeseries(it.id,'5m')]);
    const arch=await archMerge(it.id,s1h);
    const pts=archToPoints(arch);
    const a=analyseHourly(pts.length>1?pts:s1h);
    const b=analyseBroad(s6h);
    if(!a){ status.textContent='No usable history yet.'; return; }
    status.textContent='';
    document.getElementById('trEmpty').classList.add('hidden');
    document.getElementById('trResult').classList.remove('hidden');
    renderTrendHead(it);
    const showAnalysis=!it.offscreen;   // off-screen quotes stay compact: plan card only
    ['trWhy','trHistWrap','trTiming'].forEach(eid=>{ const el=document.getElementById(eid); if(el) el.classList.toggle('hidden',!showAnalysis); });
    const hourLabels=Array.from({length:24},(_,i)=>pad2(i));
    // seasonal plan (the reconciled buy/sell model)
    const P=buildPlan(pts.length>1?pts:s1h, s6h, it);
    const winStr=w=>fmtHour(w.start)+'–'+fmtHour((w.end+1)%24);
    // price history (6h) with the live buy price as the reference line — promoted context, right under the plan
    if(showAnalysis && b && b.trend.length>2){
      document.getElementById('trHistWrap').classList.remove('hidden');
      document.getElementById('trHist').innerHTML=svgLine(b.trend,{baseline:it.low, markExtremes:false});
      let hc='~'+b.days+' days at 6h steps · dashed line = live buy ('+fmtP(it.low)+').';
      if(P.trendPct!=null && Math.abs(P.trendPct)>=2) hc+=' Over this window it has drifted <b>'+(P.trendPct>0?'+':'')+P.trendPct.toFixed(0)+'%</b>.';
      document.getElementById('trHistCap').innerHTML=hc;
    } else { document.getElementById('trHistWrap').classList.add('hidden'); }
    // ---- plan card: the live spread IS the plan (median targets removed); trend box + warnings ----
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
    // falling = point-in-time below guide OR a multi-day regime step down; drives buy-low/sell-quick pricing
    const fallingNow = gs.state==='down' || (P.regime && P.regime.ok && P.regime.driftPct<=-5);
    const PT=patientTargets(s5m, it, fallingNow);
    let r='';
    // regime-shift guard comes first — it governs whether the timing hints below can be trusted at all
    if(P.regime && P.regime.ok && Math.abs(P.regime.driftPct)>=8){
      r+='<b class="loss">⚠ Price regime shift</b> — the median has moved <b>'+(P.regime.driftPct>=0?'+':'')+P.regime.driftPct.toFixed(0)+'%</b> in the last 3 days vs the prior two weeks ('+fmtP(P.regime.priorMed)+' → '+fmtP(P.regime.recentMed)+'). The hour-of-day timing below blends two price levels, so treat those hints as unreliable — this may be a one-off move (an update or repricing), not a repeating cycle. ';
    }
    if(volatile) r+='<b class="loss">⚡ Volatile</b> — this item is '+(gs.state==='up'?'rising':'falling')+' fast ('+(gs.divPct>=0?'+':'')+gs.divPct.toFixed(1)+'% vs guide), so the spread can move against you between buying and selling. Size down and don’t chase. ';
    if(prof) r+='Buy near <b>'+fmtP(it.low)+'</b> and sell near <b>'+fmtP(it.high)+'</b>, netting <b class="gain">'+fmtP(P.nowGross)+'</b> after tax (<b>'+P.nowRoi.toFixed(1)+'%</b>). You need ~<b>'+fmtP(P.nowTax)+'</b> of spread to clear the 2% tax; there’s ~'+fmtP(P.nowSpread)+' right now.';
    else r+='The live spread (~'+fmtP(P.nowSpread)+') <b>doesn’t clear the 2% tax</b> (~'+fmtP(P.nowTax)+'), so instant-flipping <b class="loss">doesn’t profit</b> right now.';
    // pricing guidance: falling → buy-low/sell-quick; steady/rising → patient wider-margin edges
    if(PT.ok && PT.falling){
      r+=' <b class="gold">Falling — price to clear:</b> over the last ~2h it traded as low as <b>'+fmtP(PT.loMin)+'</b>. With the trend down, bid aggressively low near <b>'+fmtP(PT.patientBuy)+'</b> (let the price come to you) and price any sell to clear at/below the instabuy, near <b>'+fmtP(PT.patientSell)+'</b> — don’t list above a dropping market waiting for a recovery.';
    } else if(PT.ok && PT.patientMargin>0 && PT.patientMargin>PT.fastMargin){
      // patient pricing: shown whenever waiting for the range edges beats the instant spread (incl. turning an unprofitable instant spread positive)
      const more = PT.fastMargin>0 ? '<b>'+((PT.patientMargin/PT.fastMargin-1)*100).toFixed(0)+'% more</b> than the instant spread' : '<b>a profit where the instant spread has none</b>';
      r+=' <b class="gold">Patient pricing:</b> over the last ~2h it traded as low as <b>'+fmtP(PT.loMin)+'</b> (buy) and as high as <b>'+fmtP(PT.hiMax)+'</b> (sell). Buying near <b>'+fmtP(PT.patientBuy)+'</b> and selling near <b>'+fmtP(PT.patientSell)+'</b> would net <b class="gain">'+fmtP(PT.patientMargin)+'</b>/ea after tax — '+more+' — though fills near the range edges aren’t guaranteed and can take a while.';
    }
    r+=' <span class="ccap">Buy/sell are live prices; trend from guide divergence. Timing detail below. Not guarantees.</span>';
    // standard market table above the plan copy (asked-for item → always shown even if falling,
    // with price-to-clear framing handled inside computeQuote)
    let quoteHtml='';
    try{ const qrow=await fetchQuote(it.id,{asked:true}); quoteHtml=quoteTableHtml(it.name, qrow); }catch(e){ logEvent('info','market','quote table skipped for '+it.name+' ('+(((e&&e.message)||e))+')'); }
    document.getElementById('trSuggest').innerHTML=quoteHtml+grid+'<div class="sreason">'+r+'</div>';

    // ---- "Why this trend?" expander (Tier 2): plain-language guide divergence, σ only in the detail ----
    if(showAnalysis){
      const gEl=document.getElementById('trWhyBody'), gSum=document.getElementById('trWhySum');
      const gp=(STATE.GUIDE[it.id]&&STATE.GUIDE[it.id].price)||null;
      if(gp){
        const mid=(it.low+it.high)/2;
        let gser=null;
        try{ gser=await fetchGuideSeries(it.id); logEvent('info','guide','guide history ok for '+it.name+' ('+gser.length+' pts) — weirdgloop reachable'); }
        catch(e){ logEvent('info','guide','history fetch failed for '+it.id); }
        const R=refineTrend(it, gser||[]);
        let sum, body2;
        if(R.ok){
          const zAbs=Math.abs(R.zGuide), zWord=zAbs<1?'within its normal range':(zAbs<2?'notably':'far');
          const mlist=[]; if(R.m7!=null) mlist.push((R.m7>=0?'+':'')+R.m7.toFixed(1)+'%/7d'); if(R.m30!=null) mlist.push((R.m30>=0?'+':'')+R.m30.toFixed(1)+'%/30d');
          const SUM={healthy:'Healthy — sits around guide', 'down-confirmed':'Falling — below guide, momentum down', reversion:'Possible bounce — below guide, momentum flattening', up:'Rising — above guide'};
          const PLAIN={
            healthy:'The live spread brackets the official guide price — no strong pull either way; it tends to drift back toward guide.',
            'down-confirmed':'The live price is <b class="loss">'+zWord+'</b> below the official guide <i>and</i> guide momentum is negative — a falling knife, not a dip.',
            reversion:'The live price is <b class="amber">'+zWord+'</b> below guide, but momentum has stopped falling — a possible bounce, not a confirmed trend.',
            up:'The live price is trading <b class="gain">'+zWord+'</b> above the official guide.'};
          sum=SUM[R.state]||R.state;
          body2=(PLAIN[R.state]||('State: '+R.state+'.'))+' Guide <span class="hl">'+fmt(gp)+'</span> vs live mid <span class="hl">'+fmt(mid)+'</span> ('+(R.divPct>=0?'+':'')+R.divPct.toFixed(1)+'%). '+
            (mlist.length?'Guide momentum '+mlist.join(', ')+'. ':'')+
            '<span class="ccap">Distance from guide: <b>'+(R.zGuide>=0?'+':'')+R.zGuide.toFixed(1)+'σ</b> — σ counts how many times its normal price wobble the price has strayed; under ~1 is noise, over ~2 is extreme.</span>';
        } else {
          const div=(mid-gp)/gp*100, around=(it.low<=gp&&gp<=it.high);
          sum=around?'Around guide':(it.high<gp?'Below guide':'Above guide');
          body2='Live mid <span class="hl">'+fmt(mid)+'</span> vs guide <span class="hl">'+fmt(gp)+'</span> (<b class="'+(div>=0?'gain':'loss')+'">'+(div>=0?'+':'')+div.toFixed(1)+'%</b>) — '+(around?'straddles the guide (healthy)':(it.high<gp?'below guide (downtrend)':'above guide (uptrend)'))+'. <span class="ccap">Not enough guide history for a confidence measure'+(gser?'':' — weirdgloop unreachable')+'; point-in-time only.</span>';
        }
        gSum.textContent='— '+sum;
        gEl.innerHTML=body2;
        document.getElementById('trWhy').classList.remove('hidden');
      } else { document.getElementById('trWhy').classList.add('hidden'); }
    }

    // ---- Timing & seasonality (Tier 3): gated on the walk-forward backtest; hourly charts only show when the timing edge is proven ----
    if(showAnalysis){
      const tEl=document.getElementById('trTimingBody'), tSum=document.getElementById('trTimingSum'), chartsEl=document.getElementById('trCharts');
      const bt=backtestPlan(pts.length>1?pts:s1h);
      const regimeShift=P.regime && P.regime.ok && Math.abs(P.regime.driftPct)>=8;
      const good=!bt.insufficient && bt.edge>0.3 && bt.beatRate>=60;
      const showCharts=good && !regimeShift;
      let sum, body2='';
      if(regimeShift){
        sum='— unreliable right now';
        body2='<div class="mini">Skipping the hour-of-day timing: the price level shifted <b>'+(P.regime.driftPct>=0?'+':'')+P.regime.driftPct.toFixed(0)+'%</b> in the last few days, so recent history blends two regimes and any “cheap hour” pattern is unreliable. Re-check once the price settles.</div>';
      } else if(bt.insufficient){
        sum='— not enough history yet';
        body2='<div class="mini">Not enough out-of-sample history yet ('+bt.days+' day'+(bt.days===1?'':'s')+' banked). Keep this item starred and re-check in a week or two.</div>';
      } else {
        const bad=bt.edge<=0 || bt.beatRate<50;
        sum=good?'— real edge ✓':(bad?'— no proven edge':'— marginal');
        const verdict=good?'<b class="gain">This item has a real timing edge.</b> Buying in its historically-cheap window and selling in its rich window beat naive spread-flipping on days the model hadn’t seen.':(bad?'<b class="loss">No proven timing edge.</b> On held-out days, timing didn’t beat just flipping the current spread — trade the spread, ignore hour-of-day.':'<b class="gold">Marginal timing edge</b> — small and inconsistent; don’t lean on it.');
        body2='<div class="sreason" style="margin-top:0">'+verdict+'</div>'+
          '<div class="sgrid" style="margin-top:12px">'+
          '<div class="sbox"><div class="sk">Model swing ROI</div><div class="sv '+sgn(bt.stratRoi)+'">'+bt.stratRoi.toFixed(2)+'%</div><div class="ss">avg / cycle, out of sample</div></div>'+
          '<div class="sbox"><div class="sk">Spread-flip ROI</div><div class="sv">'+bt.spreadRoi.toFixed(2)+'%</div><div class="ss">naive benchmark</div></div>'+
          '<div class="sbox"><div class="sk">Beat rate</div><div class="sv">'+bt.beatRate.toFixed(0)+'%</div><div class="ss">of '+bt.n+' held-out days · '+bt.winRate.toFixed(0)+'% profitable</div></div>'+
          '</div>';
        if(showCharts) body2+='<div class="sreason" style="margin-top:12px">Cheapest to buy around <span class="hl">'+winStr(P.buyWin)+'</span>, richest to sell around <span class="hl">'+winStr(P.sellWin)+'</span> — a scheduling edge, not a price target.</div>';
      }
      tSum.textContent=sum; tEl.innerHTML=body2;
      if(showCharts){
        const pv=a.hourPrice.filter(v=>v!=null), pmin=Math.min(...pv), pmax=Math.max(...pv), vmax=Math.max(...a.hourVol);
        document.getElementById('trPrice').innerHTML=svgLine(a.hourPriceF,{labels:hourLabels,ticks:[0,6,12,18,23]});
        document.getElementById('trPriceCap').innerHTML='Range ~'+fmtP(pmin)+'–'+fmtP(pmax)+' · green = cheapest hour, red = priciest.';
        document.getElementById('trVol').innerHTML=svgBars(a.hourVol,{labels:hourLabels,ticks:[0,6,12,18,23]});
        document.getElementById('trVolCap').innerHTML='Peak ~'+fmt(vmax)+'/hr around <span class="hl">'+fmtHour(a.volPeak)+'</span> — deepest liquidity (fastest fills).';
        chartsEl.classList.remove('hidden');
      } else { chartsEl.classList.add('hidden'); }
    }
  }catch(e){ status.textContent='Couldn’t load history — try again.'; }
}

