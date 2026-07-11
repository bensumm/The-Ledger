import { Z_BAND, ARCHIVE_MIN_GAP, STATE, sGet, sSet, logEvent } from './state.js';
import { fetchTs } from './marketfetch.js';
import { tax, netMargin, netMarginQty, fmt, fmtP, now, pad2, fmtHour, sgn, clamp } from './format.js';
import { svgLine, svgBars } from './charts.js';
import { createChart } from './chartlib.js';                                  // CL: interactive chart (diurnal viz)
import { hourProfile, deriveDiurnalRange } from './windowread.mjs';           // shared diurnal peak-timing math (same module the console uses)
import { reachValidator, floorValidator, trajectoryValidator } from './validate.mjs';   // TV: validator notes split across their viz (inform-only)
import { termStructure } from './termstructure.mjs';                         // TV: durable multi-week floor/ceiling/typical-swing + trajectory shape (shared)
import { diurnalForecast, fmtEta } from './forecast.mjs';                    // TV: forward 24h projection off the daily rhythm (shared, provisional n≈0)
import { fetchGuideSeries, resolveItem, resolveId, searchCatalog, rebuildDatalist, coarseTrend, refineTrend } from './market.js';
import { toggleWatch } from './ui.js';
import { switchTab } from './main.js';
import { regimeDrift, momVerdict, momCell, breakEven } from './quotecore.js';   // shared impls (regime + cut-trigger + T2 momentum token + tax-capped break-even) so quotes/positions/Trends reuse them
import { fetchQuote, quoteTableHtml } from './quote.js';
// TC1: the pure DOM-free analytics moved to js/trendcore.js (node-importable + fixture-tested in
// pipeline/trendcore.test.mjs). trends.js re-imports what runTrends/renderPositionCard
// render; the rest of trendcore's exports (bestWindow/median/seasonalFactors/factorStats/dayGroups/…)
// stay pure helpers there. This was a straight MOVE — behavior is byte-identical.
import { analyseHourly, analyseBroad, buildPlan, patientTargets, backtestPlan } from './trendcore.js';

/*
 * TRENDS TAB STRUCTURE (as of 0.35.0) — read before editing runTrends.
 * The per-item Trends view is organized in decision-priority tiers, deliberately —
 * don't scatter new info back into a flat list:
 *  1. Suggested plan card (#trSuggest) — instant buy/sell, profit-now, trend box, and
 *     warnings. Since 0.35.0 (T2) the blurb renders as small labeled sections, only when
 *     they apply: "⚠ Warnings" (always FIRST), "Flip now", and "Patient pricing" or
 *     "Price to clear" (the PT.falling branch — the header IS the signal), with the .ccap
 *     fine print as a trailing footer. Includes trend-aware pricing
 *     (patientTargets(series, it, falling)):
 *     steady/rising items get a wider-margin patient offer off the recent ~2h 5m range
 *     (20th/80th percentiles); falling items instead get buy-low/sell-quick targets — a
 *     more aggressive low bid (10th pctl) and a sell priced to *clear* at/below the
 *     instabuy (min(instabuy, 50th pctl)), never above a dropping market (0.20.0). The
 *     plan card branches its copy on PT.falling. And a regime-shift warning
 *     (regimeDrift(): last-3d median vs prior ~2wk; fires at >=8%). No sigma jargon here.
 *  2. "Recent movement (last 2h)" (#trRecent, added 0.35.0/T2) — sits between the plan
 *     card and "Why this trend?": a small 2h chart off the already-fetched 5m series with
 *     the patientTargets band edges + live quick buy/sell overlaid (an outside-the-band
 *     break is visible), plus a one-line readout (band lo→hi, live percentile,
 *     traded-window count with a thin flag, T1 momentum arrow). No new requests; respects
 *     showAnalysis; renders only when the series has points.
 *  3. "Why this trend?" (#trWhy, collapsible) — plain-language guide-divergence readout;
 *     the sigma number lives only in this expander's fine print.
 *  4. Price history (#trHistWrap) — 3-month chart, promoted as immediate context.
 *  5. Timing & seasonality (#trTiming, collapsible) — gated on the walk-forward backtest:
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
// L1: track how a Trends open was initiated (deep-link vs. typed) so runTrends — the single
// funnel every open passes through — logs the source without double-firing. Reset after each log.
let trendSource='manual';
export function openTrends(id){ const it=resolveId(id); if(!it) return; trendSource='link'; switchTab('trends'); document.getElementById('trItem').value=it.name; runTrends(); }
// fetchTimeseries/fetchTs + their cache moved to js/marketfetch.js (A2); call fetchTs directly.
export async function archGet(id){ const a=await sGet('tsa:'+id); return (a&&typeof a==='object')?a:{}; }
export async function archMerge(id,series){
  const a=await archGet(id), cut=now()-ARCH_MAX_DAYS*86400;
  series.forEach(p=>{ if(p.timestamp>=cut) a[p.timestamp]=[p.avgHighPrice||0,p.avgLowPrice||0,p.highPriceVolume||0,p.lowPriceVolume||0]; });
  for(const k in a){ if(+k<cut) delete a[k]; }
  await sSet('tsa:'+id,a); return a;
}
export function archToPoints(a){ return Object.keys(a).map(k=>{ const v=a[k]; return {timestamp:+k, avgHighPrice:v[0]||null, avgLowPrice:v[1]||null, highPriceVolume:v[2]||0, lowPriceVolume:v[3]||0}; }).sort((x,y)=>x.timestamp-y.timestamp); }
export function archDays(a){ const ks=Object.keys(a); if(ks.length<2) return 0; let mn=Infinity,mx=-Infinity; ks.forEach(k=>{ k=+k; if(k<mn)mn=k; if(k>mx)mx=k; }); return Math.max(1,Math.round((mx-mn)/86400)); }
export async function archiveHourly(id){ try{ const s=await fetchTs(id,'1h'); await archMerge(id,s); }catch(e){} }
export async function archiveWatchlist(force){
  if(!STATE.watchlist.length) return false;
  if(!force){ const last=await sGet('tsa_last'); if(last && (now()-last)<ARCHIVE_MIN_GAP) return false; }
  for(const id of STATE.watchlist.slice(0,25)){ await archiveHourly(id); }
  await sSet('tsa_last', now()); return true;
}
/* The pure analytics (bestWindow, analyseBroad/analyseHourly, median/sideVal/localDayKey/hourOf,
   seasonalFactors/hourFactors/factorStats, buildPlan, patientTargets, dayGroups/backtestPlan)
   MOVED to js/trendcore.js (TC1) — node-importable + fixture-tested. Imported at top. */
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
   The pivot is the break-even sell price (shared breakEven() — the smallest sell that nets
   cost after the 2% tax, tax-capped; see quotecore) crossed with the trend. Reuses the same
   building blocks as the Trends plan:
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
  const sellNow=it.high, netNow=sellNow-tax(sellNow), profNow=netMarginQty(buy,sellNow,qty);
  const breakeven=breakEven(buy);                      // smallest sell that nets >= cost after 2% tax (tax-capped; shared quotecore)
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
  // V3: pass the lot's buy timestamp (t.opened = the fill's buyTs, unix s; see ledger.js syncFills)
  // so the app inherits the entry-age softening — a fresh (<FRESH_HOURS) underwater lot shows
  // WATCH — fresh entry, not CUT-CANDIDATE. askFilling is undefined here (no live offer view in
  // this card), so momVerdict degrades to entry-age only. Absent t.opened → undefined → unchanged.
  const mv=qrow?momVerdict(qrow, breakeven, lotValue, s5m, undefined, {buyTs:t.opened}):null;
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
  const profAt=netMarginQty(buy,listAt,qty);
  const fill=listAt<=sellNow?'fills ~instantly':(listAt<=hiMax?'within the recent 2h range — fills with patience':'above the recent 2h high — may sit');
  const trWord=tr.falling?'Falling':(tr.rising?'Rising':'Flat'), trCls=tr.falling?'loss':(tr.rising?'gold':'gain');
  const mom=[]; if(tr.m7!=null)mom.push((tr.m7>=0?'+':'')+tr.m7.toFixed(0)+'%/7d'); if(tr.m30!=null)mom.push((tr.m30>=0?'+':'')+tr.m30.toFixed(0)+'%/30d'); if(tr.regime.ok)mom.push('regime '+(tr.regime.driftPct>=0?'+':'')+tr.regime.driftPct.toFixed(0)+'%');
  const tableHtml=qrow?quoteTableHtml(t.name, qrow):'';   // same standard columns as Finder/Trends, for consistency
  // L1: return the verdict alongside the html so reviewPositions can log a verdict tally (one caller).
  const html='<div class="suggest" style="margin-top:10px">'+
    tableHtml+
    '<div class="stitle">'+t.name+' <span class="csub">×'+qty.toLocaleString()+' @ '+fmtP(buy)+'</span><span class="'+cls+'" style="float:right;font-weight:700">'+verdict+'</span></div>'+
    '<div class="sgrid">'+
      '<div class="sbox"><div class="sk">Break-even</div><div class="sv">'+fmtP(breakeven)+'</div><div class="ss">nets your cost</div></div>'+
      '<div class="sbox"><div class="sk">Sell now</div><div class="sv">'+fmtP(sellNow)+'</div><div class="ss '+sgn(profNow)+'">'+(profNow>=0?'+':'')+fmt(profNow)+'</div></div>'+
      '<div class="sbox"><div class="sk">Trend</div><div class="sv '+trCls+'">'+trWord+'</div><div class="ss mini">'+(mom.join(' · ')||'—')+'</div></div>'+
      '<div class="sbox"><div class="sk">List at</div><div class="sv '+cls+'">'+fmtP(listAt)+'</div><div class="ss '+sgn(profAt)+'">'+(profAt>=0?'+':'')+fmt(profAt)+'</div></div>'+
    '</div>'+
    '<div class="sreason">'+why+' <b>'+fill+'</b> at '+fmtP(listAt)+'.</div></div>';
  return {html, verdict};
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
  const cards=[]; const tally={};   // L1: count verdicts (first word) for the action-log summary
  for(const t of open){
    try{
      const it=resolveId(t.itemId); if(!it||!it.high){ cards.push('<div class="suggest" style="margin-top:10px"><div class="stitle">'+t.name+'</div><div class="mini">No live quote available.</div></div>'); continue; }
      const [s5m,s6h]=await Promise.all([fetchTs(t.itemId,'5m'), fetchTs(t.itemId,'6h')]);
      let gser=[]; try{ gser=await fetchGuideSeries(t.itemId); }catch(e){}
      let qrow=null; try{ qrow=await fetchQuote(t.itemId,{held:true}); }catch(e){}   // held → always shown even if falling
      const r=renderPositionCard(t, it, s5m, s6h, gser, qrow);
      cards.push(r.html); const key=String(r.verdict||'?').split(/[\s—-]/)[0]; tally[key]=(tally[key]||0)+1;
    }catch(e){ cards.push('<div class="suggest" style="margin-top:10px"><div class="stitle">'+t.name+'</div><div class="mini">Couldn’t load live data — try again.</div></div>'); }
  }
  box.innerHTML='<div class="stitle" style="margin-top:6px">Position review <span class="csub">live · after 2% tax · break-even = sell that nets cost · guidance, not guarantees</span></div>'+cards.join('');
  const summ=Object.keys(tally).sort().map(k=>tally[k]+' '+k).join(', ');
  logEvent('info','action','position review · '+open.length+(summ?' ('+summ+')':''));
  if(btn){ btn.disabled=false; btn.textContent='Review pricing'; }
}
/* T2: the "Recent movement (last 2h)" chart+readout. Uses the ALREADY-fetched 5m series and the
   standard quote row (qrow) — no new requests. Plots the 2h mids with the band edges (min avgLow /
   max avgHigh, same basis as patientTargets) and the live quick buy/sell overlaid as reference
   lines, so a live-price break outside its own 2h band is visible. Readout: band lo→hi, where the
   live mid sits in that range (percentile), how many 5m windows actually traded (thin 2h activity
   says so), and the T2 Momentum arrow/color. Renders only with showAnalysis and a real series. */
function renderRecent(it, s5m, qrow, showAnalysis){
  const el=document.getElementById('trRecent'); if(!el) return;
  const chart=document.getElementById('trRecentChart'), cap=document.getElementById('trRecentCap');
  const recent=(s5m||[]).slice(-24).filter(p=>p && (p.avgLowPrice||p.avgHighPrice));
  if(!showAnalysis || !qrow || recent.length<2){ el.classList.add('hidden'); return; }
  const mids=recent.map(p=>(p.avgLowPrice&&p.avgHighPrice)?(p.avgLowPrice+p.avgHighPrice)/2:(p.avgLowPrice||p.avgHighPrice));
  const lo=qrow.rawBandLo, hi=qrow.rawBandHi;                 // 2h band edges (min avgLow / max avgHigh)
  const refs=[];
  if(hi!=null) refs.push({v:hi, cls:'refband', label:'2h hi'});
  if(lo!=null) refs.push({v:lo, cls:'refband', label:'2h lo'});
  if(qrow.quickSell!=null) refs.push({v:qrow.quickSell, cls:'reflive', label:'sell'});
  if(qrow.quickBuy!=null)  refs.push({v:qrow.quickBuy,  cls:'reflive', label:'buy'});
  // interactive chart (chartlib): y-axis price labels + hover tooltip; 2h window is fixed (spans off).
  if(recentChart){ try{ recentChart.destroy(); }catch(_){ } recentChart=null; }
  const rseries=recent.map((p,i)=>({t:p.timestamp, v:mids[i]})).filter(p=>p.v!=null);
  recentChart=createChart(chart, {series:rseries, refs, kind:'line', spans:false,
    xFmt:t=>new Date(t*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});
  const liveMid=qrow.mid!=null?qrow.mid:mids[mids.length-1];
  const pctl=(lo!=null && hi!=null && hi>lo)?clamp(Math.round((liveMid-lo)/(hi-lo)*100),0,100):null;
  const traded=recent.filter(p=>p.avgLowPrice&&p.avgHighPrice).length;
  const m=momCell(qrow.mom, qrow.momPct);
  const momWord=qrow.mom==='breakdown'?'breaking down':qrow.mom==='breakup'?'breaking up':'ranging in-band';
  let s='';
  if(lo!=null && hi!=null) s+='Band <b>'+fmtP(lo)+' → '+fmtP(hi)+'</b>';
  if(pctl!=null) s+=' · live sits ~<b>'+pctl+'%</b> up the range';
  s+=' · <b>'+traded+'</b>/'+recent.length+' 5m windows traded'+(traded<8?' <span class="loss">(thin — reads are noisy)</span>':'');
  s+=' · Momentum <span class="'+m.cls+'">'+m.sym+'</span> '+momWord+'.';
  cap.innerHTML=s;
  el.classList.remove('hidden');
}
/* TV: the "Diurnal timing" section — the hour-of-day dip/peak profile, rendered via the shared
   js/windowread.mjs hourProfile/deriveDiurnalRange (the SAME computation the console's screen +
   quote print — parity, not a fork) off the ALREADY-fetched 1h series (no new request). A 24-bar
   hour-of-day chart (dip hours green, peak hours red) with the derived stale-guarded BID/ASK
   overlaid as reference lines, plus a one-line readout of BID→ASK + after-tax swing (★ = clean
   candidate, matching the console's flag). The `reach` validator note is rendered beside it,
   inform-only (it scores whether those diurnal levels are actually reached). It's a TIMING tool, so
   it lives in the timing tier (below Price history), NOT above the plan card. Thresholds are
   placeholders (n≈0) — the section is labeled guidance, matching the console framing.
   Degrades to a "not enough history yet" line when hourProfile returns null (never a broken chart). */
const DIURNAL_MIN_ROI=1;   // PLACEHOLDER (rule 4): after-tax ROI a clean ★ diurnal candidate must clear
// interactive-chart handles (chartlib) — destroyed + recreated each runTrends so listeners don't leak.
let diurnalChart=null, recentChart=null, histChart=null, forecastChart=null;
function renderDiurnal(profSeries, qrow, it, showAnalysis){
  const el=document.getElementById('trDiurnal'); if(!el) return;
  const chartEl=document.getElementById('trDiurnalChart'), cap=document.getElementById('trDiurnalCap'),
        reachEl=document.getElementById('trDiurnalReach'), togEl=document.getElementById('trDiurnalToggle');
  if(diurnalChart){ try{ diurnalChart.destroy(); }catch(_){ } diurnalChart=null; }
  if(reachEl) reachEl.textContent='';
  if(togEl) togEl.innerHTML='';
  if(!showAnalysis){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const liveLo=(qrow&&qrow.quickBuy!=null)?qrow.quickBuy:it.low;
  const liveHi=(qrow&&qrow.quickSell!=null)?qrow.quickSell:it.high;
  // Dip/peak hours colored with a NEUTRAL cool/warm pair (timing, not good/bad — Ben 2026-07-10),
  // keyed by this legend.
  const dpleg='<span class="dpleg"><span><i class="sw-dip"></i>dip hours (cheap)</span><span><i class="sw-peak"></i>peak hours (pricey)</span></span>';
  // draw the hour-of-day profile averaged over `nights` of history — the lookback toggle: a short
  // window is reactive, a long one is steadier. SAME shared windowread math either way (parity).
  function draw(nights){
    if(diurnalChart){ try{ diurnalChart.destroy(); }catch(_){ } diurnalChart=null; }
    if(reachEl) reachEl.textContent='';
    let prof=null; try{ prof=hourProfile(profSeries||[], {nights}); }catch(_){ prof=null; }
    if(!prof){
      if(chartEl) chartEl.innerHTML='';
      if(cap) cap.innerHTML='<span class="mini">Not enough hourly history yet to read a daily rhythm at this window — try a longer one, or re-check in a few days.</span>';
      return;
    }
    const dr=deriveDiurnalRange(prof, {liveLo, liveHi});
    const dipSet=new Set(prof.dip.hours||[]), peakSet=new Set(prof.peak.hours||[]);
    const series=(prof.hours||[]).map(h=>{
      const mid=(h.lowRecent!=null&&h.hiRecent!=null)?(h.lowRecent+h.hiRecent)/2:(h.lowRecent!=null?h.lowRecent:h.hiRecent);
      return {t:h.h, v:mid, cls:dipSet.has(h.h)?'dip':(peakSet.has(h.h)?'peak2':null)};
    }).filter(p=>p.v!=null);
    const refs=[];
    if(dr&&dr.ask!=null) refs.push({v:dr.ask, cls:'reflive', label:'ask'});
    if(dr&&dr.bid!=null) refs.push({v:dr.bid, cls:'reflive', label:'bid'});
    const markers=[{t:new Date().getHours(), cls:'nowmark', label:'now'}];
    diurnalChart=createChart(chartEl, {series, refs, markers, kind:'bars', spans:false,
      xFmt:h=>fmtHour(((Math.round(h)%24)+24)%24)});
    // readout — the SAME framing as the console's Diurnal block (deriveDiurnalRange + the ★ formula)
    if(dr&&dr.bid!=null&&dr.ask!=null){
      const win=w=>fmtHour(w.startH)+'–'+fmtHour(w.endH);
      const net=Math.round(dr.ask-tax(dr.ask)-dr.bid), roi=dr.bid?net/dr.bid*100:null;
      const concentrated=dr.dipWindow.startH!==dr.dipWindow.endH && dr.peakWindow.startH!==dr.peakWindow.endH;
      const clean=net>0 && !prof.trendDominates && concentrated && roi!=null && roi>=DIURNAL_MIN_ROI;
      let s='';
      if(clean) s+='<b class="gain" title="clean diurnal candidate — concentrated dip &amp; peak, trend-quiet, positive after-tax swing">★</b> ';
      s+='<b>BID '+fmtP(dr.bid)+'</b> <span class="mini">('+dr.bidBasis+', dip '+win(dr.dipWindow)+')</span> → <b>ASK '+fmtP(dr.ask)+'</b> <span class="mini">(peak '+win(dr.peakWindow)+')</span>';
      if(net!=null) s+=' · <b class="'+sgn(net)+'">'+(net>=0?'+':'')+fmtP(net)+'</b>/u after tax'+(roi!=null?' ('+roi.toFixed(1)+'%)':'');
      if(prof.trendDominates) s+=' · <span class="loss">⚠ trend-dominates — the moving floor erases the intraday dip; bid priced to live.</span>';
      s+=' <span class="ccap">Guidance from the recent daily rhythm — timing support, not a price target; thresholds are placeholder (n≈0).</span>';
      cap.innerHTML=dpleg+'<br>'+s;
    } else {
      cap.innerHTML=dpleg+'<br><span class="mini">Diurnal shape read, but the derived bid/ask is degenerate (flat or thin window) — no timing edge to quote.</span>';
    }
    // reach note (inform-only): does the recent same-window history actually TOUCH the bid / REACH the ask?
    if(reachEl && dr){
      const notes=[];
      for(const side of ['bid','ask']){
        const level=side==='bid'?dr.bid:dr.ask; if(level==null) continue;
        try{
          const r=reachValidator({intraday:{ts1h:profSeries, reach:{side, level}}});
          if(r && r.reason && r.status!=='pass') notes.push(r.reason);
          else if(r && r.reason && /d$/.test(r.reason)) notes.push(r.reason);   // a scored pass ("ask N reached X/Yd")
        }catch(_){ }
      }
      if(notes.length) reachEl.innerHTML='<b>Reach</b> <span class="mini">(inform-only)</span> — '+notes.map(n=>'<span class="mini">'+n+'</span>').join(' · ');
    }
  }
  // lookback toggle: average the hour-of-day shape over a short (reactive) or long (steadier) window.
  const LOOKBACKS=[{label:'7d',n:7},{label:'28d',n:28}];
  if(togEl){
    const lab=document.createElement('span'); lab.className='mini'; lab.style.marginRight='2px'; lab.textContent='avg over';
    togEl.appendChild(lab);
    LOOKBACKS.forEach(lb=>{ const b=document.createElement('button'); b.className='chartspan'; b.dataset.n=String(lb.n); b.textContent=lb.label;
      b.title='average the hour-of-day shape over the last '+lb.label+' of history'; b.onclick=()=>setN(lb.n); togEl.appendChild(b); });
  }
  function setN(n){ if(togEl) togEl.querySelectorAll('.chartspan').forEach(b=>b.classList.toggle('on', +b.dataset.n===n)); draw(n); }
  setN(7);
}
/* TV: the floor + trajectory validator notes, rendered WITH the term-structure overlay they qualify
   (Ben's validator-note split, not one flat block). Both are the SAME shared js/validate.mjs validators
   the console runs — the reason text is verbatim parity. BUY-side (a Trends read is an entry decision);
   gated on real evidence so a cold-archive degrade (internal code) never leaks to the user. */
function renderTermNote(ts, it){
  const el=document.getElementById('trHistNote'); if(!el) return; el.innerHTML='';
  if(!ts || ts.hasData===false || ts.floor==null){
    el.innerHTML='<span class="mini">A durable multi-week floor forms once ~2+ weeks of daily history accrue (the archive began 2026-07-08) — the floor/trajectory read appears here as it warms.</span>';
    return;
  }
  const ctx={ history:{termStructure:ts}, floor:{level:it.low}, market:{row:{optBuy:it.low}} };
  let f=null,t=null; try{ f=floorValidator(ctx); }catch(_){ } try{ t=trajectoryValidator(ctx); }catch(_){ }
  const cls=s=>s==='reject'?'loss':s==='caution'?'gold':'gain';
  const parts=[];
  if(t && t.evidence && t.evidence.shape) parts.push('<b class="'+cls(t.status)+'">trajectory</b> <span class="mini">'+t.reason+'</span>');
  if(f && f.evidence && f.evidence.floor!=null) parts.push('<b class="'+cls(f.status)+'">floor</b> <span class="mini">'+f.reason+'</span>');
  if(!parts.length){ el.innerHTML=''; return; }
  el.innerHTML='<span class="mini">Structure (inform-only): </span>'+parts.join(' <span class="mini">·</span> ')+
    ' <span class="ccap">Multi-week floor &amp; path shape — the “buy the base, not the knife” read; thresholds placeholder (n≈0).</span>';
}
/* TV: the "Forward forecast" section — forecast.mjs diurnalForecast projects the next 24h off the
   SAME hourProfile the Diurnal timing chart reads (parity). Answers "not buyable at a good price now —
   when ~?": next trough (bid) + next peak (ask) with eta/window/band, else a LOUD degrade reason
   (post-shock, live-band violation, thin/flat series). The chart plots the projected LOW curve (the
   "when does it get cheap" line) with the trough marked. Provisional (PF, n≈0) — the forecast caveat
   is rendered here, WITH the band it qualifies (the validator-note split). */
function renderForecast(profSeries, qrow, it, showAnalysis){
  const el=document.getElementById('trForecast'); if(!el) return;
  const chartEl=document.getElementById('trForecastChart'), cap=document.getElementById('trForecastCap');
  if(forecastChart){ try{ forecastChart.destroy(); }catch(_){ } forecastChart=null; }
  if(!showAnalysis){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  let prof=null; try{ prof=hourProfile(profSeries||[], {nights:7}); }catch(_){ prof=null; }
  const liveLo=(qrow&&qrow.quickBuy!=null)?qrow.quickBuy:it.low;
  const liveHi=(qrow&&qrow.quickSell!=null)?qrow.quickSell:it.high;
  const ctx={ liveLo, liveHi, mom:qrow?qrow.mom:null, reliable:qrow?qrow.reliable:undefined, phase:qrow?qrow.phase:null, now:new Date() };
  let fc=null; try{ fc=diurnalForecast(prof, ctx); }catch(_){ fc={forecast:null, reason:'error'}; }
  if(!fc || !fc.forecast){
    if(chartEl) chartEl.innerHTML='';
    const why={ 'no-profile':'not enough hourly history yet', 'post-shock-shape':'the price is mid-spike/decay — the recurring rhythm can’t be projected through a shock', 'band-violation-live':'the live price is breaking its own 2h band right now — the anchor is untrustworthy', 'unreliable-quote':'the live quote is unreliable', 'no-anchor':'no live price anchor', 'flat-window':'the daily rhythm is too flat to call a trough/peak' }[fc&&fc.reason]||'unavailable at this read';
    cap.innerHTML='<span class="mini">Forecast withheld — '+why+'. (The model degrades loudly rather than guess through a shock — provisional, PF n≈0.)</span>';
    return;
  }
  const f=fc.forecast, tr=f.nextTrough, pk=f.nextPeak;
  // chart: the projected 24h CONE — the projected LOW (gold, "when does it get cheap") and projected
  // HIGH (cool overlay, "when does it get dear") with the uncertainty band shaded between, trough &
  // peak marked. Both paths come from the SAME forecast.series (parity with the readout below).
  const series=(f.series||[]).map(s=>({t:s.etaH, v:s.projLow})).filter(p=>p.v!=null);
  const overlay=(f.series||[]).map(s=>({t:s.etaH, v:s.projHigh})).filter(p=>p.v!=null);
  const refs=[{v:liveLo, cls:'reflive', label:'live buy'}, {v:liveHi, cls:'reflive', label:'live sell'}];
  const markers=[];
  if(tr && tr.etaH!=null) markers.push({t:tr.etaH, cls:'nowmark', label:'trough '+fmtEta(tr.etaH)});
  if(pk && pk.etaH!=null && (!tr || pk.etaH!==tr.etaH)) markers.push({t:pk.etaH, cls:'nowmark', label:'peak '+fmtEta(pk.etaH)});
  if(series.length>1) forecastChart=createChart(chartEl, {series, overlay, fillBetween:true, refs, markers, kind:'line', spans:false, xFmt:h=>'+'+fmtEta(h)});
  else if(chartEl) chartEl.innerHTML='';
  const lvl=x=>(x&&x.level!=null)?fmtP(Math.round(x.level)):'—';
  const eta=x=>(x&&x.etaH!=null)?('in ~'+fmtEta(x.etaH)+(x.window?' ('+x.window+')':'')):'(trend-only — no eta)';
  const fcleg='<span class="dpleg"><span><i class="sw-buy"></i>projected buy (low)</span><span><i class="sw-sell"></i>projected sell (high)</span></span>';
  let s=fcleg+'<br><b>Next trough</b> '+lvl(tr)+' '+eta(tr);
  if(tr && tr.band && tr.band.lo!=null) s+=' <span class="mini">[band '+fmtP(Math.round(tr.band.lo))+'–'+fmtP(Math.round(tr.band.hi))+']</span>';
  s+=' <span class="mini">·</span> <b>Next peak</b> '+lvl(pk)+' '+eta(pk);
  s+=' <span class="mini">· confidence '+(f.confidence||'?')+'</span>';
  if(tr && tr.note) s+='<br><span class="loss">⚠ '+tr.note+'</span>';
  if(pk && pk.note) s+='<br><span class="loss">⚠ '+pk.note+'</span>';
  s+=' <span class="ccap">Projection = live anchor + the daily-rhythm shape + a dumb trend extension; it never predicts an exogenous shock. Provisional (PF, n≈0) — timing guidance, not a fill promise (touched ≠ filled).</span>';
  cap.innerHTML=s;
}
export async function runTrends(){
  const name=document.getElementById('trItem').value.trim();
  const status=document.getElementById('trStatus');
  const it=resolveItem(name);
  if(!it){ renderMatches(name); return; }   // no exact match -> whole-catalog substring search
  document.getElementById('trMatches').classList.add('hidden');
  logEvent('info','action','trends → '+it.name+' ('+trendSource+')'); trendSource='manual';
  status.textContent='loading history…';
  document.getElementById('trResult').classList.add('hidden');
  try{
    const [s1h,s6h,s5m]=await Promise.all([fetchTs(it.id,'1h'), fetchTs(it.id,'6h'), fetchTs(it.id,'5m')]);
    const arch=await archMerge(it.id,s1h);
    const pts=archToPoints(arch);
    const a=analyseHourly(pts.length>1?pts:s1h);
    const b=analyseBroad(s6h);
    if(!a){ status.textContent='No usable history yet.'; return; }
    status.textContent='';
    document.getElementById('trEmpty').classList.add('hidden');
    document.getElementById('trResult').classList.remove('hidden');
    renderTrendHead(it);
    // Render the full analysis for EVERY resolved item, including a search-surfaced catalog item
    // (offscreen — a sub-browse-floor id resolved by name/quote). The 5m/1h/6h series are fetched for
    // any tradeable id, and each section self-guards on its own data (renderRecent/history/diurnal/
    // forecast degrade cleanly), so a searched item now gets the SAME charts as an in-universe one
    // (Ben 2026-07-10 — the old `!it.offscreen` gate hid them for no data reason). `a` already passed
    // the analyseHourly guard above, so usable history is present here regardless of offscreen.
    const showAnalysis=true;
    ['trWhy','trHistWrap','trTiming','trRecent','trDiurnal','trForecast'].forEach(eid=>{ const el=document.getElementById(eid); if(el) el.classList.toggle('hidden',!showAnalysis); });
    const hourLabels=Array.from({length:24},(_,i)=>pad2(i));
    // seasonal plan (the reconciled buy/sell model)
    const P=buildPlan(pts.length>1?pts:s1h, s6h, it);
    const winStr=w=>fmtHour(w.start)+'–'+fmtHour((w.end+1)%24);
    // price history (6h) with the live buy price as the reference line — promoted context, right under the plan
    const hseries=(s6h||[]).map(p=>({t:p.timestamp, v:(p.avgHighPrice&&p.avgLowPrice)?(p.avgHighPrice+p.avgLowPrice)/2:(p.avgHighPrice||p.avgLowPrice)})).filter(p=>p.v!=null);
    if(showAnalysis && b && hseries.length>2){
      document.getElementById('trHistWrap').classList.remove('hidden');
      // interactive chart (chartlib): axis labels + hover tooltip + selectable 1/7/30/90-day windows.
      if(histChart){ try{ histChart.destroy(); }catch(_){ } histChart=null; }
      // TV: durable multi-week floor/ceiling + typical-swing band overlaid as reference structure — the
      // SAME shared termstructure.mjs read the console's floor/trajectory validators use (parity, not a
      // fork). Degrades quietly on a cold/thin archive (floor null → no overlay, just the live-buy line).
      let ts=null; try{ ts=termStructure(hseries.map(p=>({ts:p.t, mid:p.v}))); }catch(_){ ts=null; }
      const hrefs=[{v:it.low, cls:'reflive', label:'buy'}], hbands=[];
      if(ts && ts.hasData && ts.floor!=null){
        hrefs.push({v:ts.floor, cls:'reffloor', label:ts.floorLookback+'d floor'});
        if(ts.ceiling!=null){ hrefs.push({v:ts.ceiling, cls:'reffloor', label:'ceil'}); hbands.push({lo:ts.floor, hi:ts.ceiling, cls:'cband floorband'}); }
      }
      const HSPANS=[{label:'1d',s:86400},{label:'7d',s:7*86400},{label:'30d',s:30*86400},{label:'90d',s:90*86400},{label:'All',s:null}];
      histChart=createChart(document.getElementById('trHist'), {series:hseries, refs:hrefs, bands:hbands, kind:'line', spans:HSPANS, span:'All',
        xFmt:t=>new Date(t*1000).toLocaleDateString([], {month:'short',day:'numeric'})});
      let hc='6h steps · dashed line = live buy ('+fmtP(it.low)+')'+(ts&&ts.floor!=null?' · teal = '+ts.floorLookback+'d durable floor/ceiling':'')+' · drag to pan, wheel to zoom, or pick a window.';
      if(P.trendPct!=null && Math.abs(P.trendPct)>=2) hc+=' Over ~'+b.days+' days it has drifted <b>'+(P.trendPct>0?'+':'')+P.trendPct.toFixed(0)+'%</b>.';
      document.getElementById('trHistCap').innerHTML=hc;
      renderTermNote(ts, it);   // TV: floor + trajectory validator notes live WITH the term-structure overlay
    } else { document.getElementById('trHistWrap').classList.add('hidden'); const hn=document.getElementById('trHistNote'); if(hn) hn.innerHTML=''; }
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
    // ---- T2: sectioned plan blurb — small labeled blocks, each rendered only when it applies.
    // ⚠ Warnings stays FIRST; then Flip now; then Patient pricing / Price to clear (the header IS
    // the signal). The .ccap fine print stays as the trailing footer. Layout only — copy is intact. ----
    const sec=[];
    let warn='';
    // regime-shift guard first — it governs whether the timing hints below can be trusted at all
    if(P.regime && P.regime.ok && Math.abs(P.regime.driftPct)>=8){
      warn+='<div class="rsec-i"><b class="loss">Price regime shift</b> — the median has moved <b>'+(P.regime.driftPct>=0?'+':'')+P.regime.driftPct.toFixed(0)+'%</b> in the last 3 days vs the prior two weeks ('+fmtP(P.regime.priorMed)+' → '+fmtP(P.regime.recentMed)+'). The hour-of-day timing below blends two price levels, so treat those hints as unreliable — this may be a one-off move (an update or repricing), not a repeating cycle.</div>';
    }
    if(volatile) warn+='<div class="rsec-i"><b class="loss">Volatile</b> — this item is '+(gs.state==='up'?'rising':'falling')+' fast ('+(gs.divPct>=0?'+':'')+gs.divPct.toFixed(1)+'% vs guide), so the spread can move against you between buying and selling. Size down and don’t chase.</div>';
    if(warn) sec.push({t:'⚠ Warnings', c:'warn', b:warn});
    // Flip now — the instant-spread math
    const flip = prof
      ? 'Buy near <b>'+fmtP(it.low)+'</b> and sell near <b>'+fmtP(it.high)+'</b>, netting <b class="gain">'+fmtP(P.nowGross)+'</b> after tax (<b>'+P.nowRoi.toFixed(1)+'%</b>). You need ~<b>'+fmtP(P.nowTax)+'</b> of spread to clear the 2% tax; there’s ~'+fmtP(P.nowSpread)+' right now.'
      : 'The live spread (~'+fmtP(P.nowSpread)+') <b>doesn’t clear the 2% tax</b> (~'+fmtP(P.nowTax)+'), so instant-flipping <b class="loss">doesn’t profit</b> right now.';
    sec.push({t:'Flip now', b:flip});
    // pricing guidance: falling → buy-low/sell-quick (Price to clear); steady/rising → patient wider-margin edges
    if(PT.ok && PT.falling){
      sec.push({t:'Price to clear', c:'gold', b:'Over the last ~2h it traded as low as <b>'+fmtP(PT.loMin)+'</b>. With the trend down, bid aggressively low near <b>'+fmtP(PT.patientBuy)+'</b> (let the price come to you) and price any sell to clear at/below the instabuy, near <b>'+fmtP(PT.patientSell)+'</b> — don’t list above a dropping market waiting for a recovery.'});
    } else if(PT.ok && PT.patientMargin>0 && PT.patientMargin>PT.fastMargin){
      // patient pricing: shown whenever waiting for the range edges beats the instant spread (incl. turning an unprofitable instant spread positive)
      const more = PT.fastMargin>0 ? '<b>'+((PT.patientMargin/PT.fastMargin-1)*100).toFixed(0)+'% more</b> than the instant spread' : '<b>a profit where the instant spread has none</b>';
      sec.push({t:'Patient pricing', c:'gold', b:'Over the last ~2h it traded as low as <b>'+fmtP(PT.loMin)+'</b> (buy) and as high as <b>'+fmtP(PT.hiMax)+'</b> (sell). Buying near <b>'+fmtP(PT.patientBuy)+'</b> and selling near <b>'+fmtP(PT.patientSell)+'</b> would net <b class="gain">'+fmtP(PT.patientMargin)+'</b>/ea after tax — '+more+' — though fills near the range edges aren’t guaranteed and can take a while.'});
    }
    const secHtml=sec.map(s=>'<div class="rsec'+(s.c?' '+s.c:'')+'"><div class="rsec-h">'+s.t+'</div><div class="rsec-b">'+s.b+'</div></div>').join('');
    const foot='<div class="sreason rfoot"><span class="ccap">Buy/sell are live prices; trend from guide divergence. Timing detail below. Not guarantees.</span></div>';
    // standard market table above the plan copy (asked-for item → always shown even if falling,
    // with price-to-clear framing handled inside computeQuote)
    let quoteHtml='', qrowT=null;
    try{ qrowT=await fetchQuote(it.id,{asked:true}); quoteHtml=quoteTableHtml(it.name, qrowT); }catch(e){ logEvent('info','market','quote table skipped for '+it.name+' ('+(((e&&e.message)||e))+')'); }
    document.getElementById('trSuggest').innerHTML=quoteHtml+grid+secHtml+foot;
    // ---- T2: "Recent movement (last 2h)" block — the 5m series is already fetched; a small chart
    // with the 2h band edges + live buy/sell overlaid so an outside-the-band break is VISIBLE. ----
    renderRecent(it, s5m, qrowT, showAnalysis);
    // ---- TV: "Diurnal timing" (timing tier) — hour-of-day dip/peak profile off the in-hand 1h series
    // (the richer archive points when we have them, else the raw 1h) via shared windowread math. ----
    renderDiurnal(pts.length>1?pts:s1h, qrowT, it, showAnalysis);
    // ---- TV: "Forward forecast" (timing tier) — next-24h projection off the SAME hourProfile the
    // diurnal chart reads; the "buyable at ~X in ~4h" answer. Provisional (PF, n≈0); degrades loudly. ----
    renderForecast(pts.length>1?pts:s1h, qrowT, it, showAnalysis);

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
        const nowHr=new Date().getHours();   // T2.3: a "now" vertical marker (local hour) on both hourly charts
        document.getElementById('trPrice').innerHTML=svgLine(a.hourPriceF,{labels:hourLabels,ticks:[0,6,12,18,23],nowIdx:nowHr});
        document.getElementById('trPriceCap').innerHTML='Range ~'+fmtP(pmin)+'–'+fmtP(pmax)+' · green = cheapest hour, red = priciest · dashed line = now ('+fmtHour(nowHr)+').';
        document.getElementById('trVol').innerHTML=svgBars(a.hourVol,{labels:hourLabels,ticks:[0,6,12,18,23],nowIdx:nowHr});
        document.getElementById('trVolCap').innerHTML='Peak ~'+fmt(vmax)+'/hr around <span class="hl">'+fmtHour(a.volPeak)+'</span> — deepest liquidity (fastest fills) · dashed line = now.';
        chartsEl.classList.remove('hidden');
      } else { chartsEl.classList.add('hidden'); }
    }
  }catch(e){ status.textContent='Couldn’t load history — try again.'; }
}

