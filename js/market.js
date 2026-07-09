import { API, RATE_W, RATE_ROI_MAX, RATE_VOL_MAX, RATE_TURN_FAST, RATE_TURN_SLOW, MAXPART, DIV_FULL, Z_BAND, UP_RISK, MIN_PRICE, MIN_VOL, FRESH_S, STALE_S, STRAT, MARKET_TTL, GUIDE_TTL, GUIDE_DUMP, GUIDE_MODULE, GUIDE_HIST, STATE, sGet, sSet, logEvent, setHealth } from './state.js';
import { jget, cached } from './marketfetch.js';
import { netMargin, clamp, now, isBond } from './format.js';
import { showFinderError, renderAll } from './ui.js';
import { syncFills } from './ledger.js';   // A3: positions.json auto-populate now lives with the Ledger
import { archiveWatchlist, computeSignals } from './trends.js';

/* catalog */
export async function getMapping(force){
  if(!force){ const c=await sGet('mapping'), ts=await sGet('mapping_ts'); if(c&&ts&&(Date.now()-ts<7*864e5)){ STATE.MAP=c; return false; } }
  const full=await fetch(API+'/mapping').then(r=>r.json());
  // Bonds ARE kept in the catalog now (searchable) — their flip margin is computed correctly (tax-exempt
  // minus the 10%-guide retrade fee, via bondMarginOpts below), so they no longer read as false profit.
  STATE.MAP=full.map(m=>({id:m.id,name:m.name,members:!!m.members,limit:m.limit||null}));
  await sSet('mapping',STATE.MAP); await sSet('mapping_ts',Date.now()); return true;
}
// BOND: the ONE tax exception (format.js). A bond flip's margin is sell − (buy + 10%×guide), tax-free.
// The Finder builds margin from live low/high, so hand netMargin the bond opts (guide from STATE.GUIDE)
// for the bond ONLY; every other item gets undefined → the normal after-tax margin (byte-identical).
const bondMarginOpts = id => isBond(id) ? { bond: true, guide: (STATE.GUIDE[id] && STATE.GUIDE[id].price) || 0 } : undefined;

export async function loadMarket(force){
  if(!force){
    const snapTs=await sGet('snap_ts');
    if(snapTs && (now()-snapTs)<MARKET_TTL){
      const L=await sGet('snap_latest'), V=await sGet('snap_vol');
      if(L && V){ STATE.LATEST=L; STATE.VOL=V; return {fresh:false, ts:snapTs}; }
    }
  }
  const [r1,r2]=await Promise.all([jget(API+'/latest'), jget(API+'/1h')]);
  STATE.LATEST=r1.data; STATE.VOL=r2.data;
  const ts=now(); await sSet('snap_latest',STATE.LATEST); await sSet('snap_vol',STATE.VOL); await sSet('snap_ts',ts);
  return {fresh:true, ts};
}

/* official GE guide price (lagging reference for divergence/trend).
   universe price: wiki GEPricesByIDs module (works in-browser); the chisel bulk dump
   (price+last+volume) is tried first but is CORS-blocked in most browsers, so the module
   is a legitimate primary, not a degradation. per-item momentum/volume comes from
   api.weirdgloop.org on demand (see fetchGuideSeries). */
export async function loadGuide(force){
  if(!force){
    const gTs=await sGet('snap_guide_ts');
    if(gTs && (now()-gTs)<GUIDE_TTL){
      const g=await sGet('snap_guide');
      if(g){ STATE.GUIDE=g; setHealth('guide','ok',''); return; }
    }
  }
  // opportunistic: bulk dump (richest: price+last+volume) — usually CORS-blocked in a browser
  try{
    const raw=await jget(GUIDE_DUMP);
    const g={}; let n=0;
    for(const k in raw){ if(k[0]==='%') continue; const o=raw[k]; if(!o||typeof o!=='object') continue;
      const id=(+o.id)||(+k); if(!id) continue;
      g[id]={price:o.price??null, last:o.last??null, volume:o.volume??null}; n++; }
    if(!n) throw new Error('empty dump');
    STATE.GUIDE=g; await sSet('snap_guide',g); await sSet('snap_guide_ts',now());
    setHealth('guide','ok',''); logEvent('info','guide','guide via bulk dump ('+n+' items, incl. volume & prior price)');
    return;
  }catch(e){ logEvent('info','guide','bulk dump unavailable ('+(((e&&e.message)||e))+') — using wiki guide module'); }
  // primary in-browser: wiki module (id -> price, whole market)
  try{
    const raw=await jget(GUIDE_MODULE);
    const g={}; let n=0;
    for(const k in raw){ const id=+k, p=raw[k]; if(!id||typeof p!=='number') continue; g[id]={price:p, last:null, volume:null}; n++; }
    if(!n) throw new Error('empty module');
    STATE.GUIDE=g; await sSet('snap_guide',g); await sSet('snap_guide_ts',now());
    setHealth('guide','ok',''); logEvent('info','guide','guide via wiki module ('+n+' items, price; momentum fetched per-item)');
    return;
  }catch(e){ logEvent('error','guide','guide module failed: '+(((e&&e.message)||e))); }
  setHealth('guide','warn','Guide prices unavailable — divergence/trend analysis off. Flipping unaffected.');
}
/* per-item official guide series (price+volume) for momentum — api.weirdgloop.org */
export async function fetchGuideSeries(id){
  return cached('g'+id, async()=>{
    const j=await jget(GUIDE_HIST+id); const arr=(j&&(j[id]||j[String(id)]))||[];
    return arr.map(p=>{ const ts=p.timestamp; const sec=typeof ts==='number'?(ts>2e10?Math.floor(ts/1000):ts):Math.floor(Date.parse(ts)/1000);
      return {t:sec, price:+p.price, volume:+p.volume||0}; }).filter(p=>p.price&&p.t).sort((a,b)=>a.t-b.t);
  });
}

export async function loadAll(forceMap, forceMarket){
  const btn=document.getElementById('refreshBtn'); btn.disabled=true; btn.textContent='Loading…';
  document.getElementById('stamp').textContent='fetching…';
  try{
    await getMapping(forceMap);
    const m=await loadMarket(forceMarket);
    buildItems(); computeScores();
    const t=new Date(m.ts*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    document.getElementById('stamp').innerHTML='updated <span class="num">'+t+'</span>'+(m.fresh?'':' <span class="mini">(cached)</span>')+' · <span class="num">'+STATE.ITEMS.length+'</span> tracked <a id="rebuildLink">rebuild list</a>';
    document.getElementById('rebuildLink').onclick=()=>loadAll(true,true);
    const liq=STATE.ITEMS.filter(i=>i.liquid).length;
    document.getElementById('universeNote').textContent=STATE.ITEMS.length+' tradeable items tracked · '+liq+' liquid enough to rank by default; search reveals the rest (3rd age, staples, thin items)';
    renderAll();
    computeSignals();
    syncFills();   // auto-populate Ledger/Coffer from positions.json (mapping is built now, so names resolve)
    archiveWatchlist().then(computeSignals);
    setHealth('market','ok','');
    logEvent('info','market',(m.fresh?'live prices loaded':'served cached snapshot')+' · '+STATE.ITEMS.length+' items'+(STATE.ITEMS.filter(i=>i.liquid).length?' ('+STATE.ITEMS.filter(i=>i.liquid).length+' liquid)':''));
    loadGuide(forceMarket).then(()=>{ if(STATE.ITEMS.length){ computeScores(); renderAll(); } }).catch(e=>logEvent('error','guide','unexpected: '+(((e&&e.message)||e))));
  }catch(e){ document.getElementById('stamp').textContent='fetch failed'; setHealth('market','error','Live prices unavailable — tap Refresh to retry.'); showFinderError(); }
  finally{ btn.disabled=false; btn.textContent='Refresh prices'; }
}

/* full-catalog reach: resolve & quote ANY mapped item, not just the flip universe */
export function buildCatalogIndex(){
  STATE.catById={}; STATE.catByName={};
  for(const m of STATE.MAP){ STATE.catById[m.id]=m; STATE.catByName[m.name.toLowerCase()]=m; }
}
export function rawItem(m){
  if(!m) return null;
  const l=STATE.LATEST[m.id]; if(!l||!l.low||!l.high) return null;          // unquotable without a live price
  const v=STATE.VOL[m.id]||{}; const vol=(v.highPriceVolume||0)+(v.lowPriceVolume||0);
  const it={id:m.id,name:m.name,members:m.members,limit:m.limit||null,low:l.low,high:l.high,
    lowTime:l.lowTime||0,highTime:l.highTime||0,volume:vol,liquid:vol>=MIN_VOL,offscreen:true};
  it.margin=netMargin(it.low,it.high,bondMarginOpts(it.id)); it.roi=it.low?it.margin/it.low*100:null;
  return it;
}
export function resolveItem(name){
  const k=(name||'').trim().toLowerCase(); if(!k) return null;
  if(STATE.byName[k]) return STATE.byName[k];                  // curated flip item (full metrics)
  const m=STATE.catByName[k]; return m?rawItem(m):null;  // exact catalog match (off-screen quote)
}
export function resolveId(id){ return STATE.byId[id] || (STATE.catById[id]?rawItem(STATE.catById[id]):null); }
export function searchCatalog(query,limit){
  const q=(query||'').trim().toLowerCase(); if(q.length<2) return [];
  const out=[];
  for(const m of STATE.MAP){ if(m.name.toLowerCase().indexOf(q)<0) continue; const it=STATE.byId[m.id]||rawItem(m); if(it) out.push(it); }
  out.sort((a,b)=>b.volume-a.volume);
  return out.slice(0,limit||40);
}
export function rebuildDatalist(){
  const dl=document.getElementById('itemList'); if(!dl) return;
  const seen=new Set(), frag=document.createDocumentFragment();
  for(const it of STATE.ITEMS){ if(seen.has(it.name)) continue; seen.add(it.name); const o=document.createElement('option'); o.value=it.name; frag.appendChild(o); }
  for(const id of STATE.pinned){ const m=STATE.catById[id]; if(!m||seen.has(m.name)) continue; seen.add(m.name); const o=document.createElement('option'); o.value=m.name; frag.appendChild(o); }
  dl.innerHTML=''; dl.appendChild(frag);
}
export function buildItems(){
  STATE.ITEMS=[]; STATE.byId={}; STATE.byName={};
  buildCatalogIndex();
  for(const m of STATE.MAP){
    if(!m.limit) continue;
    const l=STATE.LATEST[m.id]; if(!l||!l.low||!l.high) continue; if(l.high<MIN_PRICE) continue;
    const v=STATE.VOL[m.id]||{}; const vol=(v.highPriceVolume||0)+(v.lowPriceVolume||0);
    const it={id:m.id,name:m.name,members:m.members,limit:m.limit,low:l.low,high:l.high,lowTime:l.lowTime||0,highTime:l.highTime||0,volume:vol,liquid:vol>=MIN_VOL};
    it.margin=netMargin(it.low,it.high,bondMarginOpts(it.id)); it.roi=it.margin/it.low*100;
    STATE.ITEMS.push(it); STATE.byId[it.id]=it; STATE.byName[it.name.toLowerCase()]=it;
  }
  rebuildDatalist();
}

/* universe-wide coarse trend: live spread vs the lagging official guide (the straddle test).
   high<guide ⇒ even the sell is under official ⇒ downtrend the guide hasn't caught up to.
   Refined (z-score/momentum) versions live in refineTrend, used where we have history. */
export function coarseTrend(it){
  const g=STATE.GUIDE[it.id]; if(!g||!g.price){ return {state:'none', intensity:0, divPct:null, guide:null}; }
  const guide=g.price, mid=(it.low+it.high)/2, divPct=(mid-guide)/guide*100;
  if(it.volume<MIN_VOL) return {state:'thin', intensity:0, divPct, guide};   // low-vol guide prices are noise
  if(it.high<guide){ return {state:'down', intensity:clamp((guide-it.high)/guide/DIV_FULL,0,1), divPct, guide}; }
  if(it.low>guide){ return {state:'up', intensity:clamp((it.low-guide)/guide/DIV_FULL,0,1), divPct, guide}; }
  return {state:'straddle', intensity:0, divPct, guide};
}
/* Finder rating: four transparent 0..1 sub-scores (ROI, liquidity, stability,
   turnaround) → a composite quality. Sort magnitude still comes from profit/hr;
   quality is the dampener. NOTE on stability: the true regime-drift check needs a
   per-item price SERIES (see trends.js regimeDrift), which the Finder can't afford
   across the whole universe without a network call each — so here the stability
   proxy is live-price-vs-guide divergence, a cheap always-available stand-in for
   "has this dislocated from its lagging official price recently". */
export function ratingParts(it, staleRisk){
  const roiS=clamp((it.roi||0)/RATE_ROI_MAX,0,1);
  const volS=clamp(Math.log10((it.volume||0)+1)/Math.log10(RATE_VOL_MAX+1),0,1);
  const turnS=it.turn==null?0:clamp((RATE_TURN_SLOW-it.turn)/(RATE_TURN_SLOW-RATE_TURN_FAST),0,1);
  const tr=it.trend||{state:'none',intensity:0,divPct:null};
  let instab;
  if(tr.state==='down') instab=tr.intensity;                                 // downtrend: full weight (buy then it keeps falling)
  else if(tr.state==='up') instab=UP_RISK*2*tr.intensity;                    // uptrend: 0.6× — rising can still reverse under a flip
  else if(tr.state==='thin') instab=0.5;                                     // thin volume → guide is noise, treat as uncertain
  else if(tr.state==='none') instab=0.35;                                    // no guide reference → mild uncertainty
  else instab=clamp(Math.abs(tr.divPct||0)/(DIV_FULL*100),0,1)*0.5;          // straddle: small, scales with divergence
  instab=clamp(Math.max(instab,0.5*staleRisk),0,1);                          // stale live prices also erode trust
  const stabS=1-instab;
  const quality=RATE_W.roi*roiS + RATE_W.vol*volS + RATE_W.stab*stabS + RATE_W.turn*turnS;
  return {roiS,volS,stabS,turnS,quality};
}
export function computeScores(){
  const perSlot=STATE.bankroll/Math.max(STATE.slots,1), damp=STRAT[STATE.strategy].damp, t=now();
  for(const it of STATE.ITEMS){
    it.trend=coarseTrend(it);
    if(it.margin<=0){ it.fill=0; it.turn=null; it.pph=0; it.rate=null; it.riskIndex=1; it.score=0; continue; }
    const partCap=Math.max(1, Math.floor(MAXPART*it.volume));               // can't realistically grab more than this per fill
    const fill=Math.max(0, Math.min(it.limit, Math.floor(perSlot/it.low), partCap)); it.fill=fill;
    if(fill<1){ it.turn=null; it.pph=0; it.rate=null; it.riskIndex=1; it.score=0; continue; }
    const cycle=it.margin*fill;
    it.turn=clamp(2*fill/Math.max(it.volume,1),0.1,8); it.pph=cycle/it.turn;
    const age=t-Math.min(it.highTime||t,it.lowTime||t);
    const staleRisk=clamp((age-FRESH_S)/(STALE_S-FRESH_S),0,1);
    it.rate=ratingParts(it, staleRisk);
    it.riskIndex=1-it.rate.quality;                                          // Risk grade now reflects the full quality model
    it.score=it.pph*(1-damp*it.riskIndex);
  }
}
/* refined per-item trend from a price series (archive mids or weirdgloop guide series) — z-scores + momentum */
export function refineTrend(it, series){
  const g=STATE.GUIDE[it.id], guide=(g&&g.price)||null;
  const px=(series||[]).map(p=>p.price).filter(v=>v>0);
  const mid=(it.low+it.high)/2;
  if(px.length<8 || !guide){ return {ok:false, guide, mid, divPct: guide?((mid-guide)/guide*100):null}; }
  const n=px.length, ma=px.reduce((a,b)=>a+b,0)/n;
  const sd=Math.sqrt(px.reduce((a,b)=>a+(b-ma)*(b-ma),0)/n) || 1;
  const zGuide=(mid-guide)/sd, zMean=(mid-ma)/sd;
  // momentum: 7d & 30d rate-of-change off the series end
  const tEnd=series[series.length-1].t;
  const pAt=d=>{ const cut=tEnd-d*86400; let b=null; series.forEach(p=>{ if(p.t<=cut) b=p; }); return b?b.price:null; };
  const p7=pAt(7), p30=pAt(30);
  const m7=p7?((px[n-1]-p7)/p7*100):null, m30=p30?((px[n-1]-p30)/p30*100):null;
  const mom = m7!=null?m7:(m30!=null?m30:0);
  let state;
  if(it.low<=guide && guide<=it.high && Math.abs(zGuide)<Z_BAND) state='healthy';
  else if(zGuide<=-Z_BAND) state=(mom<0)?'down-confirmed':'reversion';
  else if(zGuide>=Z_BAND) state='up';
  else state='healthy';
  return {ok:true, guide, mid, ma, sd, zGuide, zMean, m7, m30, mom, state,
    divPct:(mid-guide)/guide*100, days: series.length>1?Math.round((series[series.length-1].t-series[0].t)/86400):0 };
}
export const TREND_BADGE={ down:{g:'↓',c:'loss',t:'below guide — downtrend'}, up:{g:'↑',c:'gain',t:'above guide — uptrend'},
  straddle:{g:'✓',c:'gold',t:'straddles guide — healthy'}, thin:{g:'~',c:'mini',t:'thin volume — signal unreliable'},
  none:{g:'',c:'',t:''} };

