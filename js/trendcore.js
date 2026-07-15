import { tax, netMargin } from './money-math.js';
import { regimeDrift } from './quotecore.js';   // shared 3d-vs-~2wk regime-drift impl (also used by quote-items.mjs/positions)

/*
 * TREND CORE (TC1) — the pure, DOM-free analytics behind the Trends view.
 *
 * These functions were living in js/trends.js, but trends.js pulls in the DOM + STATE (charts-static.js,
 * ui.js, main.js, marketfetch/state) at import — which pinned the decision-bearing analytics behind
 * an un-node-importable module. This is a straight MOVE into a pure module (mirrors TD2's ledgercore/
 * watchcore extractions) so the hourly/seasonal decomposition, the walk-forward backtest gate, and
 * patient-offer sizing can be fixture-tested in node (pipeline/test/trendcore.test.mjs). trends.js
 * re-imports what it renders; the Trends-tab tier-structure doctrine stays in trends.js (its editors
 * live there). Nothing here touches the DOM, STATE, or a browser global — its only imports are the
 * node-safe money-math.js (tax/netMargin) and quotecore.js (regimeDrift).
 *
 * TIME CONVENTION: localDayKey / hourOf use LOCAL Date getters by design (project rule — hour-of-day
 * seasonality and day grouping are read in local wall-clock, matching what the app renders). Do not
 * swap in getUTC*.
 */

export function bestWindow(arr,L,mode){ const n=arr.length; let best=null; for(let s=0;s<n;s++){ let sum=0; for(let k=0;k<L;k++) sum+=arr[(s+k)%n]; const avg=sum/L; if(!best||(mode==='min'?avg<best.avg:avg>best.avg)) best={start:s,end:(s+L-1)%n,avg}; } return best; }
export function analyseBroad(series){
  const trend=[];
  series.forEach(pt=>{ const hi=pt.avgHighPrice, lo=pt.avgLowPrice, mid=(hi&&lo)?(hi+lo)/2:(hi||lo); if(!mid) return;
    trend.push(mid);
  });
  if(!trend.length) return null;
  const days=series.length?Math.max(1,Math.round((series[series.length-1].timestamp-series[0].timestamp)/86400)):0;
  return { trend, days };
}
export function analyseHourly(series){
  const hp=Array(24).fill(0), hc=Array(24).fill(0), hv=Array(24).fill(0);
  series.forEach(pt=>{
    const hi=pt.avgHighPrice, lo=pt.avgLowPrice; let price=(hi&&lo)?(hi+lo)/2:(hi||lo); if(!price) return;
    const vol=(pt.highPriceVolume||0)+(pt.lowPriceVolume||0);
    const dt=new Date(pt.timestamp*1000), h=dt.getHours();
    hp[h]+=price; hc[h]++; hv[h]+=vol;
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
  return {hourPriceF,hourPrice,hourVol,meanPrice,minH,maxH,swingPct,volPeak,days};
}
/* --- seasonal decomposition: price ~ level x hour-factor x weekday-factor --- */
export function median(arr){ if(!arr||!arr.length) return null; const s=arr.slice().sort((a,b)=>a-b), m=s.length>>1; return s.length%2?s[m]:(s[m-1]+s[m])/2; }
export const sideVal=(p,side)=>side==='low'?p.avgLowPrice:p.avgHighPrice;
export const localDayKey=ts=>{ const d=new Date(ts*1000); return d.getFullYear()+'-'+d.getMonth()+'-'+d.getDate(); };
export const hourOf=ts=>new Date(ts*1000).getHours();
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
  o.nowGross=netMargin(it.low,it.high); o.nowRoi=it.low?o.nowGross/it.low*100:0;
  o.nowSpread=it.high-it.low; o.nowTax=tax(it.high);                 // the plan IS the live spread vs the tax it must clear
  o.nowProfitable=o.nowGross>0;
  // 3-month drift
  if(s6h&&s6h.length>9){ const t=Math.floor(s6h.length/3);
    const older=median(s6h.slice(0,t).map(p=>p.avgLowPrice).filter(Boolean)), recent=median(s6h.slice(-t).map(p=>p.avgLowPrice).filter(Boolean));
    o.trendPct=(older&&recent)?(recent-older)/older*100:null; }
  o.flat=o.lowEdge.flat && o.highEdge.flat;
  o.conf = (o.archDays>=10 && o.medCount>=5) ? 'good' : (o.archDays>=4 && o.medCount>=2) ? 'moderate' : 'low';
  o.regime = regimeDrift(points);
  return o;
}
/* regimeDrift lives in js/quotecore.js (imported above) so the Trends plan card, position
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
