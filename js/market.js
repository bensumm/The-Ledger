import { API, RATE_W, RATE_ROI_MAX, RATE_VOL_MAX, RATE_TURN_FAST, RATE_TURN_SLOW, MAXPART, DIV_FULL, Z_BAND, UP_RISK, MIN_PRICE, MIN_VOL, FRESH_S, STALE_S, STRAT, MARKET_TTL, VOL24_TTL, VOL24_MIN_ITEMS, VOL24_STALE_MAX, GUIDE_TTL, GUIDE_DUMP, GUIDE_MODULE, GUIDE_HIST, STATE, sGet, sSet, logEvent, setHealth } from './state.js';
import { jget, cached } from './marketfetch.js';
import { netMargin, clamp, now, isBond } from './money-math.js';
import { estimateRank } from './estimators.mjs';   // AP4: the SAME per-thesis rank the console uses
import { rateItem } from './rating.mjs';            // AP4: the SAME desirability score + letter grade
import { showFinderError, renderAll } from './ui.js';
import { syncFills } from './ledger.js';   // A3: positions.json auto-populate now lives with the Ledger
import { archiveWatchlist } from './trends.js';

/* catalog */
export async function getMapping(force){
  if(!force){ const c=await sGet('mapping'), ts=await sGet('mapping_ts'); if(c&&ts&&(Date.now()-ts<7*864e5)){ STATE.MAP=c; return false; } }
  const full=await fetch(API+'/mapping').then(r=>r.json());
  // Bonds ARE kept in the catalog now (searchable) — their flip margin is computed correctly (tax-exempt
  // minus the 10%-guide retrade fee, via bondMarginOpts below), so they no longer read as false profit.
  STATE.MAP=full.map(m=>({id:m.id,name:m.name,members:!!m.members,limit:m.limit||null}));
  await sSet('mapping',STATE.MAP); await sSet('mapping_ts',Date.now()); return true;
}
// BOND: the ONE tax exception (money-math.js). A bond flip's margin is sell − (buy + 10%×guide), tax-free.
// The Finder builds margin from live low/high, so hand netMargin the bond opts (guide from STATE.GUIDE)
// for the bond ONLY; every other item gets undefined → the normal after-tax margin (byte-identical).
const bondMarginOpts = id => isBond(id) ? { bond: true, guide: (STATE.GUIDE[id] && STATE.GUIDE[id].price) || 0 } : undefined;

/* DAILY two-sided volume for desirabilityOf. Its own cache/TTL because /24h is a UTC-DAY aggregate
   that only rolls at 00:00Z — MARKET_TTL's 180s would re-pull 381 KB for nothing.
   `?id=` is IGNORED by the endpoint: it returns the WHOLE market, one UTC day fresher than bare /24h
   (see pipeline/lib/market/marketfetch.mjs loadAll24hRolling — the ONE HOME). That is undocumented
   behaviour, hence VOL24_MIN_ITEMS: if it ever starts honouring the id we degrade to null (wide,
   honest) instead of silently grading the whole board off a 1-item map.
   On a fetch failure a STALE cached map beats null — but only up to VOL24_STALE_MAX; past that it
   degrades to null so a permanently-dead endpoint cannot serve an ancient map behind normal-looking
   uncapped grades. Every degrade sets health 'vol24' so the banner shows it; without that the failure
   is invisible (identical grade, identical tooltip, and loadAll stamps market:'ok' right after). */
async function loadVol24(force){
  const t=await sGet('snap_vol24_ts');
  if(!force && t && (now()-t)<VOL24_TTL){ const V=await sGet('snap_vol24'); if(V){ STATE.VOL24=V; return; } }
  // A stale map beats null, but NOT indefinitely: past VOL24_STALE_MAX it degrades to null (→ every
  // grade capped). Without a max age a permanently-dead endpoint would serve an ancient map forever
  // with normal-looking uncapped grades — fail-OPEN, the opposite of the null branch's fail-closed.
  const fallback=async(why)=>{
    const cached=await sGet('snap_vol24');
    const age=t?(now()-t):Infinity;
    if(cached && age<VOL24_STALE_MAX){
      STATE.VOL24=cached;
      setHealth('vol24','warn','Daily volume is '+Math.round(age/3600)+'h stale — grades may lag. '+why);
    }else{
      STATE.VOL24=null;
      setHealth('vol24','warn','Daily volume unavailable — every grade is capped at A- until it returns. '+why);
    }
    logEvent('warn','market','/24h '+why+' — '+(STATE.VOL24?'using cached map ('+Math.round(age/3600)+'h old)':'no usable map; grades capped'));
  };
  try{
    const r=await jget(API+'/24h?id=2');
    const d=r&&r.data;
    const n=d?Object.keys(d).length:0;
    if(n<VOL24_MIN_ITEMS) return fallback('returned '+n+' items, expected the whole market');
    STATE.VOL24=d; await sSet('snap_vol24',d); await sSet('snap_vol24_ts',now());
    setHealth('vol24','ok','');
  }catch(e){ return fallback('fetch failed ('+(e&&e.message||e)+')'); }
}

export async function loadMarket(force){
  if(!force){
    const snapTs=await sGet('snap_ts');
    if(snapTs && (now()-snapTs)<MARKET_TTL){
      const L=await sGet('snap_latest'), V=await sGet('snap_vol');
      if(L && V){ STATE.LATEST=L; STATE.VOL=V; await loadVol24(force); return {fresh:false, ts:snapTs}; }
    }
  }
  const [r1,r2]=await Promise.all([jget(API+'/latest'), jget(API+'/1h')]);
  STATE.LATEST=r1.data; STATE.VOL=r2.data;
  const ts=now(); await sSet('snap_latest',STATE.LATEST); await sSet('snap_vol',STATE.VOL); await sSet('snap_ts',ts);
  await loadVol24(force);
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
    syncFills();   // auto-populate Ledger/Coffer from positions.json (mapping is built now, so names resolve)
    archiveWatchlist();
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
/* AP4 — the Finder's DESIRABILITY, computed with the SAME shared modules the console uses
   (js/estimators.mjs rank + js/rating.mjs grade), replacing the old profit/hr Risk grade. HONEST
   DEGRADE: the Finder is coarse — it has NO per-item 2h band or momentum (it can't fetch a series per
   universe item without hammering the rate limit), so it ranks the LIVE QUICK pair (`priceBasis:'quick'`)
   rather than the console's 2h band pair. So a Finder rank is a COARSE pre-filter that differs from the
   band-precise rank the per-item `quote`/Trends read produces; the UI labels it so and the quote button
   is the precise read.
   `volDay` MUST be the DAILY two-sided limiting side, from STATE.VOL24 (/24h) — NOT STATE.VOL (/1h).
   Three bugs were fixed here together in 0.74.0; each would re-appear if the source were reverted:
     · UNIT — /1h made volDay ONE HOUR against daily-anchored consumers (families.mjs TTF_REF_VOL,
       rating.mjs liqFactor F0/F1). ×24 is NOT an acceptable substitute: measured over 1.25M
       item-hours, hourly-MIN×24 lands at median 0.10 of a true daily figure with 44% zeros (diurnal
       shape alone gives 0.68 — so most of the damage is taking min() of a sparse hour).
       ⚠ Do NOT justify /24h by "accuracy". It is bit-exact the /1h sum over the day it labels
       (4152/4152 items), so any ratio against a /1h-composed truth measures WINDOW OFFSET, not
       endpoint error — the endpoint has none by construction. The real argument is simpler: /24h IS
       a true daily two-sided figure for a day 0–24h back, and ×24 is a bad estimator of any day.
     · ONE-SIDED BOOKS — `Math.min(hpv,lpv) || it.volume` fell through to `it.volume` (= hpv+lpv) when
       the limiting side was 0, substituting the MAX for the MIN. Never reintroduce an `||` fallback
       here; 0 is the correct answer and must survive.
     · CAP ESCAPE — `thin = volDay>0 && …` let a zero-volume item skip THIN_GRADE_CAP entirely, which
       was 100% of the app's S+ grades (89/89 at one read; the COUNT drifts 66–95 by hour, the RATIO
       does not), median true daily volume 1–2 units. Note the scope: every one of them FAILS the
       browse `liquid` gate, so they surface only via explicit search, never on the default board.
       `volDay == null || …` is load-bearing, not style.
   THIN_VOL_DAY stays 50 — do NOT "recalibrate" it to the console's 3,500. On a daily basis 3,500 caps
   64% of the pool and 74 of the visible top 80, re-creating the flat wall of A- this fix removed. The
   console's 3,500 is an ADMISSION floor paired with a gp-flow escape hatch; the Finder has no admission
   gate, so they are not interchangeable. Fixing the unit is what makes 50 correct for the first time.
   Null volDay (fetch degraded / item absent) flows honestly: liqFactor → 0.5, ttfIntraday → its 12h
   prior. Wide, not fabricated.
   No confirmable multi-day regime here ⇒ the uniform 0.85 regime haircut applies to every row (a constant
   — it shifts all grades, not the ordering). Bond rides its tax-exempt retrade-fee opts so it can't grade
   off a phantom spread. */
const FINDER_SPEC = { estimator: 'intraday', priceBasis: 'quick' };
const THIN_VOL_DAY = 50;   // daily limiting-side floor for the grade cap — see the header on why NOT 3,500
export function desirabilityOf(it){
  // DAILY two-sided limiting side. No `||` fallback: 0 is a real answer (one-sided book) and null is a
  // real answer (no daily data) — both must survive to the cap and to liqFactor.
  const v=(STATE.VOL24 && STATE.VOL24[it.id])||null;
  const volDay=v?Math.min(v.highPriceVolume||0, v.lowPriceVolume||0):null;
  const bo=bondMarginOpts(it.id);
  const row={ quickBuy:it.low, quickSell:it.high, optBuy:null, optSell:null, band:null, mom:null,
    regime:null, rising:false, falling:false, volDay, mid:(it.low+it.high)/2, limit:it.limit,
    bond:!!(bo&&bo.bond), guide:bo?bo.guide:null };
  const er=estimateRank(FINDER_SPEC, row);
  // thin = mirrors the console's THIN_GRADE_CAP so an illiquid big-ticket can't headline S+.
  // Reads "thin OR UNVERIFIED", and both halves are load-bearing:
  //   · ZERO is thin. The old `volDay>0` guard let a no-trade item skip the cap — that was all 77 of
  //     the app's S+ grades, median 2 units/day.
  //   · NULL is thin. If the /24h map is unavailable (fetch failed, cold cache) every volDay is null,
  //     and a `!= null` test would leave the WHOLE board uncapped — re-opening the same hole on the
  //     degrade path. Unknown liquidity must not headline; failing closed costs a letter, failing
  //     open costs the fix.
  const thin=volDay==null || volDay<THIN_VOL_DAY;
  const rt=rateItem({ row, rank:er.rank, thin });
  return { rank:er.rank, grade:rt.grade, score:rt.score, thin, ttfSec:er.ttf&&er.ttf.value };
}
export function computeScores(){
  const perSlot=STATE.bankroll/Math.max(STATE.slots,1), damp=STRAT[STATE.strategy].damp, t=now();
  for(const it of STATE.ITEMS){
    it.trend=coarseTrend(it);
    if(it.margin<=0){ it.fill=0; it.turn=null; it.pph=0; it.rate=null; it.riskIndex=1; it.score=0; it.desir=null; continue; }
    const partCap=Math.max(1, Math.floor(MAXPART*it.volume));               // can't realistically grab more than this per fill
    const fill=Math.max(0, Math.min(it.limit, Math.floor(perSlot/it.low), partCap)); it.fill=fill;
    if(fill<1){ it.turn=null; it.pph=0; it.rate=null; it.riskIndex=1; it.score=0; it.desir=null; continue; }
    const cycle=it.margin*fill;
    it.turn=clamp(2*fill/Math.max(it.volume,1),0.1,8); it.pph=cycle/it.turn;
    const age=t-Math.min(it.highTime||t,it.lowTime||t);
    const staleRisk=clamp((age-FRESH_S)/(STALE_S-FRESH_S),0,1);
    it.rate=ratingParts(it, staleRisk);
    it.riskIndex=1-it.rate.quality;
    it.score=it.pph*(1-damp*it.riskIndex);   // VESTIGIAL: the old profit/hr Risk score — no longer rendered
    // or sorted on (AP4 repointed Grade/Rating/sort to `desir`); kept only until RATE_W is fully torn out.
    // `it.pph` still feeds the informational Profit/hr column.
    it.desir=desirabilityOf(it);                                            // AP4: shared rank + desirability grade
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

