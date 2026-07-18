#!/usr/bin/env node
/**
 * analyze-fill-placement.mjs — AC1/AC2 calibration study (PLAN-REACH-CALIBRATION). READ-ONLY.
 *
 *   node pipeline/commands/analyze-fill-placement.mjs            human report
 *   node pipeline/commands/analyze-fill-placement.mjs --json     structured brief (for a coordinator)
 *   node pipeline/commands/analyze-fill-placement.mjs --nights 14   trailing-day window for the placement distribution (default 14)
 *   node pipeline/commands/analyze-fill-placement.mjs --offline   skip the live 1h fetch (archive-only; degrades placement coverage hard)
 *
 * WHAT THIS IS. The evidence-gathering GATE for the rest of PLAN-REACH-CALIBRATION (§A). It joins every
 * closed lot (positions.json `closed`) with same-day bucket data and measures WHERE our realized sell/buy
 * cleared in that day's daily-high/low distribution (the `quantHigh`/`quantLow` percentile machinery), as a
 * function of volDay (→ `qEvidence`) and sizeShare = qty ÷ composed rolling-24h volume (→ `impactFold`).
 * AC2 rides along: how far the 1h `avgHighPrice` sits below the same-hour 5m-bucket max (the smoothing
 * bias), bucketed by a volume proxy for prints-per-bucket.
 *
 * WHAT THIS IS NOT. It does NOT build `safeQuantile`/`qEvidence`/`impactFold` (that is AC3, gated on THIS
 * study replicating the Finding-2 knee). It changes NO live pricing/gating surface. It is a REPORT, not a
 * ruling — it hands back numbers + an honest characterization; a human decides what happens next.
 *
 * HONESTY (process rule 4; PLAN §"The honesty core"). The size-share knee is a 6-item one-session
 * observation; this widens n to the full closed-lot join but the sample is heavily CLUSTERED (≈25 Soul-rune
 * lots at ONE 25k tranche = one point on one axis, not a curve). Every bucket prints n; the pooled
 * cross-item read (the actually-relevant, much weaker evidence) is reported BESIDE the raw pooled one with
 * the dominant item excluded, so a concentrated item can't launder confidence. Nothing here is a calibrated
 * conclusion.
 *
 * READ-ONLY / FETCH. Reads positions.json + fills.json + the Tier-1 archive (5m buckets, read-only handle).
 * Fetches the live per-item /timeseries?1h once per distinct closed-lot item (the ONLY way to get a dense,
 * contiguous ~15-day daily-high distribution + a trailing-24h volume denominator as-of each historical fill;
 * the archive's 1h coverage is sparse ~6h-spaced and cannot sum a real trailing-24h). Writes NOTHING to any
 * pipeline artifact; NEVER enters a commit/sync path. Use --offline to skip the fetch (placement then only
 * covers items whose 1h series happens to sit in the archive — usually near-empty; the archive stores 1h
 * observations but the dense per-hour series a distribution needs is the live endpoint's).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib/cli.mjs';
import { fetchTs } from '../lib/marketfetch.mjs';
import { collapseOffers } from '../lib/reconstruct.mjs';
import { open as openArchive } from '../lib/archive.mjs';
import { median, quant, spearman, lotPlacement, smoothingBias, FP_MIN_DAYS } from '../lib/fill-placement.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const POSITIONS = path.join(ROOT, 'positions.json');
const FILLS = path.join(ROOT, 'fills.json');

const A = parseArgs(process.argv.slice(2));
const JSON_OUT = !!A.json;
const OFFLINE = !!A.offline;
const NIGHTS = A.nights != null && A.nights !== true ? Number(A.nights) : 14;
const MIN_DAYS = FP_MIN_DAYS;   // 'thin-history' threshold — the ONE definition lives in lib/fill-placement.mjs

const log = (...a) => { if (!JSON_OUT) console.log(...a); };
const err = (...a) => console.error(...a);
const pctStr = f => f == null ? '—' : 'p' + Math.round(f * 100);

// ---- load (read-only) -------------------------------------------------------------------------
function loadJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
const posData = loadJson(POSITIONS);
const fillsData = loadJson(FILLS);
if (!posData || !Array.isArray(posData.closed)) { err('✗ positions.json unreadable or has no closed[]'); process.exit(1); }
const closedAll = posData.closed;
// SELLS only: drop withdrawals (sellEach 0, personal-use) — they carry no achievable-price signal.
const closed = closedAll.filter(l => l.sellEach > 0 && l.qty > 0 && l.buyTs != null && l.sellTs != null);
const fillsEvents = (fillsData && Array.isArray(fillsData.events)) ? fillsData.events : [];

// per-offer fill chains: index sell offers by (itemId, tsOpen) for the fill-duration join.
const offers = collapseOffers(fillsEvents);
const sellOfferByKey = new Map();
for (const o of offers) if (o.type === 'sell' && o.filled > 0) sellOfferByKey.set(o.itemId + ':' + o.tsOpen, o);

// ---- fetch the per-item 1h series (the daily-high distribution + volume denominator source) ----
const itemIds = [...new Set(closed.map(l => l.itemId))];
const series1h = new Map();   // id -> ascending 1h /timeseries points
if (!OFFLINE) {
  err(`fetching live /timeseries?1h for ${itemIds.length} distinct closed-lot items…`);
  let i = 0;
  for (const id of itemIds) {
    try { series1h.set(id, await fetchTs(id, '1h')); } catch (e) { err(`  ! ${id} fetch failed: ${(e && e.message) || e}`); series1h.set(id, []); }
    if (++i % 10 === 0) err(`  …${i}/${itemIds.length}`);
    await new Promise(r => setTimeout(r, 60));
  }
} else {
  err('--offline: skipping live fetch; placement coverage will be near-empty (archive 1h is sparse).');
}

// ---- AC2: archive 5m max vs live 1h avg smoothing bias (smoothingBias — pure) ------------------
// Bucket by the 1h highPriceVolume (the best available proxy for prints-per-bucket — the wiki exposes NO
// print count, only volume; stated as a proxy). Hypothesis (AC2): the bias SHRINKS toward 0 as volume →
// thin (fewer prints to smooth away). The 5m value is itself a 5-min AVERAGE, so bias is a LOWER BOUND.
const archive = openArchive(undefined, { readonly: true });
const biasSamples = [];   // { itemId, hourTs, oneHourAvgHigh, fiveMax, bias, vol1hHigh }
try {
  for (const id of itemIds) {
    const s1 = series1h.get(id) || [];
    if (!s1.length) continue;
    const from = s1[0].timestamp, to = s1[s1.length - 1].timestamp + 3600;
    let fiveRows = [];
    try { fiveRows = archive.seriesFor(id, '5m', { from, to }); } catch {}
    for (const b of smoothingBias(s1, fiveRows)) biasSamples.push({ itemId: id, ...b });
  }
} finally { archive.close(); }

// ---- per-lot placement + sizeShare (lotPlacement — pure) ---------------------------------------
const rows = [];
for (const lot of closed) {
  const s1 = series1h.get(lot.itemId) || [];
  const pl = lotPlacement(lot, s1, { nights: NIGHTS, minDays: MIN_DAYS });
  const off = sellOfferByKey.get(lot.itemId + ':' + lot.sellTs);   // fill duration = tsClose − tsOpen
  rows.push({
    itemId: lot.itemId, qty: lot.qty, buyEach: lot.buyEach, sellEach: lot.sellEach, realised: lot.realised,
    banked: !!lot.banked, buyTs: lot.buyTs, sellTs: lot.sellTs,
    ...pl, fillDurSec: off ? off.tsClose - off.tsOpen : null,
  });
}

// ---- bucketing --------------------------------------------------------------------------------
const withPlacement = rows.filter(r => r.sellPlacement != null);
const withShare = withPlacement.filter(r => r.sizeShare != null);

// Buckets resolve the SUB-1% region — that is where every placeable lot lives on the corrected
// denominator (max placed share ≈0.74%). The old 1–2%/2–5%/5–10% buckets were always empty and are
// dropped; a single >1% catch-all remains to prove the tail is empty (or noise), not hidden.
const SHARE_BUCKETS = [
  { lo: 0, hi: 0.0005, label: '<0.05%' },
  { lo: 0.0005, hi: 0.001, label: '0.05–0.1%' },
  { lo: 0.001, hi: 0.0025, label: '0.1–0.25%' },
  { lo: 0.0025, hi: 0.005, label: '0.25–0.5%' },
  { lo: 0.005, hi: 0.01, label: '0.5–1%' },
  { lo: 0.01, hi: Infinity, label: '>1%' },
];
const VOL_BUCKETS = [
  { lo: 0, hi: 100e3, label: '<100k' },
  { lo: 100e3, hi: 500e3, label: '100k–500k' },
  { lo: 500e3, hi: 2e6, label: '500k–2M' },
  { lo: 2e6, hi: 10e6, label: '2M–10M' },
  { lo: 10e6, hi: Infinity, label: '>10M' },
];
function bucketize(sample, buckets, keyFn) {
  return buckets.map(b => {
    const ins = sample.filter(r => { const v = keyFn(r); return v != null && v >= b.lo && v < b.hi; });
    const pls = ins.map(r => r.sellPlacement);
    const items = new Set(ins.map(r => r.itemId));
    return {
      label: b.label, n: ins.length, nItems: items.size,
      medPlacement: median(pls), p25: quant(pls, 0.25), p75: quant(pls, 0.75),
      medDurSec: median(ins.map(r => r.fillDurSec).filter(v => v != null)),
      topItem: [...items].length ? [...new Set(ins.map(r => r.itemId))].sort((x, y) => ins.filter(r => r.itemId === y).length - ins.filter(r => r.itemId === x).length)[0] : null,
    };
  });
}
const byShare = bucketize(withShare, SHARE_BUCKETS, r => r.sizeShare);
const byVol = bucketize(withShare, VOL_BUCKETS, r => r.volDaySell);

// dominant-item concentration + pooled robustness (drop the single most-frequent item, re-correlate)
const lotByItem = {};
for (const r of rows) lotByItem[r.itemId] = (lotByItem[r.itemId] || 0) + 1;
const topItems = Object.entries(lotByItem).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ itemId: +id, lots: n }));
const dominantId = topItems.length ? topItems[0].itemId : null;

const sharePairs = withShare.map(r => [r.sizeShare, r.sellPlacement]);
const rhoAll = spearman(sharePairs);
const sharePairsNoDom = withShare.filter(r => r.itemId !== dominantId).map(r => [r.sizeShare, r.sellPlacement]);
const rhoNoDom = spearman(sharePairsNoDom);
// hpv-side robustness (the mechanically-relevant sell-impact denominator) + observed share ceilings
const withShareHpv = withPlacement.filter(r => r.shareHpv != null);
const rhoHpv = spearman(withShareHpv.map(r => [r.shareHpv, r.sellPlacement]));
const maxPlacedShare = withShare.length ? Math.max(...withShare.map(r => r.sizeShare)) : null;
const maxPlacedShareHpv = withShareHpv.length ? Math.max(...withShareHpv.map(r => r.shareHpv)) : null;
const maxAnyShare = rows.filter(r => r.sizeShare != null).length ? Math.max(...rows.filter(r => r.sizeShare != null).map(r => r.sizeShare)) : null;
// pooled per-ITEM (one median-placement, one median-share point per item — kills the cluster's n-inflation)
const perItem = {};
for (const r of withShare) (perItem[r.itemId] || (perItem[r.itemId] = [])).push(r);
const itemPoints = Object.entries(perItem).map(([id, rs]) => ({ itemId: +id, n: rs.length, medShare: median(rs.map(x => x.sizeShare)), medPlacement: median(rs.map(x => x.sellPlacement)) }));
const rhoPerItem = spearman(itemPoints.filter(p => p.n >= 1).map(p => [p.medShare, p.medPlacement]));

// AC2 bias buckets by the volume proxy
const BIAS_VOL_BUCKETS = [
  { lo: 0, hi: 1e3, label: '<1k' },
  { lo: 1e3, hi: 10e3, label: '1k–10k' },
  { lo: 10e3, hi: 50e3, label: '10k–50k' },
  { lo: 50e3, hi: 200e3, label: '50k–200k' },
  { lo: 200e3, hi: Infinity, label: '>200k' },
];
const biasByVol = BIAS_VOL_BUCKETS.map(b => {
  const ins = biasSamples.filter(s => s.vol1hHigh >= b.lo && s.vol1hHigh < b.hi);
  return { label: b.label, n: ins.length, nItems: new Set(ins.map(s => s.itemId)).size, medBias: median(ins.map(s => s.bias)), p25: quant(ins.map(s => s.bias), 0.25), p75: quant(ins.map(s => s.bias), 0.75) };
});
const rhoBias = spearman(biasSamples.map(s => [s.vol1hHigh, s.bias]));

// ---- coverage accounting ----------------------------------------------------------------------
const cov = {
  closedTotal: closedAll.length,
  sells: closed.length,
  withSeries: rows.filter(r => r.coverage !== 'no-series').length,
  withPlacement: withPlacement.length,
  withShare: withShare.length,
  thinHistory: rows.filter(r => r.coverage === 'thin-history').length,
  noSeries: rows.filter(r => r.coverage === 'no-series').length,
  withFillDur: rows.filter(r => r.fillDurSec != null).length,
  biasSamples: biasSamples.length,
  biasItems: new Set(biasSamples.map(s => s.itemId)).size,
};

// ---- JSON out ---------------------------------------------------------------------------------
if (JSON_OUT) {
  console.log(JSON.stringify({
    generatedAt: Math.floor(Date.now() / 1000), nights: NIGHTS, offline: OFFLINE,
    coverage: cov, topItems, byShare, byVol,
    correlation: { rhoAllPooled: rhoAll, rhoPooledNoDominant: rhoNoDom, rhoPerItemMedian: rhoPerItem, rhoHpvPooled: rhoHpv, dominantId, nPooled: sharePairs.length, nPerItem: itemPoints.length, maxPlacedShare, maxPlacedShareHpv, maxAnyShare },
    perItem: itemPoints,
    ac2: { byVol: biasByVol, rhoVolVsBias: rhoBias, nSamples: biasSamples.length },
    rows,
  }, null, 2));
  process.exit(0);
}

// ---- human report -----------------------------------------------------------------------------
log(`# analyze-fill-placement — AC1/AC2 realized-fill calibration study (READ-ONLY)`);
log(`  ⚠ HONESTY (rule 4): a report, not a ruling. The size-share knee is a 6-item one-session observation; this widens n but the sample is heavily CLUSTERED. Every bucket carries n. Nothing here is calibrated.`);

log(`\n## 0. Coverage`);
log(`  closed lots: ${cov.closedTotal} total · ${cov.sells} sells analyzed (withdrawals dropped)`);
log(`  1h series: ${cov.withSeries}/${cov.sells} lots have a fetched series · placement computed on ${cov.withPlacement} · sizeShare on ${cov.withShare}`);
log(`  dropped: ${cov.thinHistory} thin-history (<${MIN_DAYS} trailing days — the ENTIRE early period 07-02→07-07, before the live 1h series' ~15d reach) · ${cov.noSeries} no-series`);
log(`  fill-duration join: ${cov.withFillDur} lots matched a sell offer · AC2 5m/1h overlap: ${cov.biasSamples} hour-samples across ${cov.biasItems} items`);
log(`  max sizeShare observed: placed ${maxPlacedShare != null ? (maxPlacedShare * 100).toFixed(2) + '%' : '—'} (total-vol) / ${maxPlacedShareHpv != null ? (maxPlacedShareHpv * 100).toFixed(2) + '%' : '—'} (instabuy-side); any lot incl. dropped ${maxAnyShare != null ? (maxAnyShare * 100).toFixed(2) + '%' : '—'}. The dropped >1% lots are qty-1–5 lots of THIN items (high share only because that item's daily volume is tiny) — NOT large tranches.`);

log(`\n## 1. Lot-count concentration (the clustering caveat — read before trusting any pooled number)`);
for (const t of topItems) log(`  #${t.itemId}: ${t.lots} lots`);
log(`  → the pooled scatter is dominated by these; #${dominantId} alone is ${lotByItem[dominantId]} lots. A concentrated item's n is ~one point on its own size-curve, NOT a curve.`);

log(`\n## 2. Realized SELL placement vs sizeShare (the Finding-2 knee test → impactFold)`);
log(`  placement = percentile of the trailing-${NIGHTS}d daily-HIGH distribution the realized sellEach cleared (higher pXX = sold above more days' peaks = the small-clip premium).`);
log(`  sizeShare = qty ÷ composed rolling-24h volume (instabuy+instasell) as-of the sell — NEVER the broken /24h.`);
const H = ['sizeShare', 'n', 'items', 'med placement', 'p25–p75', 'med fill'];
const R = byShare.map(b => [b.label, String(b.n), String(b.nItems), pctStr(b.medPlacement), `${pctStr(b.p25)}–${pctStr(b.p75)}`, b.medDurSec != null ? Math.round(b.medDurSec / 60) + 'm' : '—']);
const wcol = H.map((h, i) => Math.max(h.length, ...R.map(r => r[i].length)));
const lineOf = r => r.map((c, i) => c.padEnd(wcol[i])).join('  ');
log('  ' + lineOf(H)); log('  ' + wcol.map(x => '-'.repeat(x)).join('  '));
for (const r of R) log('  ' + lineOf(r));

log(`\n## 3. Realized SELL placement vs volDay (→ qEvidence)`);
const R2 = byVol.map(b => [b.label, String(b.n), String(b.nItems), pctStr(b.medPlacement), `${pctStr(b.p25)}–${pctStr(b.p75)}`]);
const H2 = ['volDay', 'n', 'items', 'med placement', 'p25–p75'];
const wc2 = H2.map((h, i) => Math.max(h.length, ...R2.map(r => r[i].length)));
const l2 = r => r.map((c, i) => c.padEnd(wc2[i])).join('  ');
log('  ' + l2(H2)); log('  ' + wc2.map(x => '-'.repeat(x)).join('  '));
for (const r of R2) log('  ' + l2(r));

log(`\n## 4. Monotone association (Spearman ρ; negative ⇒ bigger share → lower placement = the knee's direction)`);
log(`  ρ pooled (all ${sharePairs.length} lots, share vs placement):        ${rhoAll != null ? rhoAll.toFixed(3) : '—'}`);
log(`  ρ pooled EXCLUDING dominant item #${dominantId} (n=${sharePairsNoDom.length}):  ${rhoNoDom != null ? rhoNoDom.toFixed(3) : '—'}`);
log(`  ρ per-item median (${itemPoints.length} items, one point each):        ${rhoPerItem != null ? rhoPerItem.toFixed(3) : '—'}  ← the actually-relevant cross-item evidence (weak n)`);
log(`  ρ pooled on the INSTABUY-side denominator (n=${withShareHpv.length}):        ${rhoHpv != null ? rhoHpv.toFixed(3) : '—'}  (robustness: the mechanically-correct sell-impact share)`);

log(`\n## 5. Per-item medians (one point per item — the un-clustered view)`);
for (const p of itemPoints.sort((a, b) => (a.medShare ?? 0) - (b.medShare ?? 0)))
  log(`  #${p.itemId}: n=${p.n} · medShare ${p.medShare != null ? (p.medShare * 100).toFixed(2) + '%' : '—'} · med placement ${pctStr(p.medPlacement)}`);

log(`\n## 6. AC2 — 1h-average smoothing bias vs the 5m max (→ liquidity-scaling basis)`);
log(`  bias = (max 5m avgHighPrice in the hour) ÷ (1h avgHighPrice) − 1. Proxy for prints-per-bucket = 1h highPriceVolume (the wiki exposes NO print count — this is a VOLUME proxy, stated as such).`);
log(`  hypothesis: bias SHRINKS toward 0 as volume → thin (fewer prints to smooth away).`);
const H3 = ['vol proxy', 'n', 'items', 'med bias', 'p25–p75'];
const R3 = biasByVol.map(b => [b.label, String(b.n), String(b.nItems), b.medBias != null ? (b.medBias * 100).toFixed(2) + '%' : '—', b.p25 != null ? `${(b.p25 * 100).toFixed(2)}%–${(b.p75 * 100).toFixed(2)}%` : '—']);
const wc3 = H3.map((h, i) => Math.max(h.length, ...R3.map(r => r[i].length)));
const l3 = r => r.map((c, i) => c.padEnd(wc3[i])).join('  ');
log('  ' + l3(H3)); log('  ' + wc3.map(x => '-'.repeat(x)).join('  '));
for (const r of R3) log('  ' + l3(r));
log(`  ρ (volume proxy vs bias, n=${biasSamples.length} hour-samples): ${rhoBias != null ? rhoBias.toFixed(3) : '—'}  (positive ⇒ bias grows with volume, as hypothesized)`);

log(`\n(read-only: positions.json + fills.json + archive 5m + live /timeseries?1h; nothing written to any artifact)`);
