#!/usr/bin/env node
/* edge-map-study.mjs — the EDGE-MAP research study (2026-08-04). Four workstreams over the
   /1h SQLite archive + positions.json, sharing one item-day panel (edge-map-lib.mjs):

     A  Does realized P&L (386 closed lots) track item characteristics as of the BUY date
        (price decile, volume quintile, band, spread, trailing regime — trailing-only joins,
        no lookahead)? Clustered by ITEM, not lot; cells with <10 distinct items are flagged
        and not concluded from.
     B  Is the liquidity gate (min-side 3,500/d) in the right place, and how much of the
        low-volume "wide band" is measurement artifact? Includes THE CRITICAL TEST: subsample
        dense liquid items' hourly observations down to thin-item print counts and see what
        happens to bandPct — plus the sharper decomposition (trimmed/robust band collapse +
        units of depth at the band-setting prints).
     C  Is the within-item volume↔band link (+0.153 contemporaneous) actually TRADEABLE —
        does volume(t−1) lead band(t)? Does early-day (UTC 0–5) volume predict rest-of-day
        range? Compared against the honest control (band persistence), translated into
        after-tax realizable edge, not just correlation.
     D  THE EXCLUSION MAP: price-decile × vol-quintile grid of realizable after-tax edge,
        depth, one-sidedness → a ranked, quotable "never trade here" list, each rule scored
        by how much of the gate-passing universe / current screen it removes, and
        cross-checked against workstream A for lots we actually profited on.

   FINDINGS: see EDGE-MAP-FINDINGS.md (sibling). Headline results: (1) subsampling SHRINKS
   the observed band (med ratio 0.61 at k=3 → 0.97 at k=18) — the low-volume wide band is
   NOT a bucket-count artifact; it is real extreme prints carrying a median depth of ~2–3
   units at the band-setting hours (a SIZE mirage, not a price mirage); (2) volume(t−1) does
   NOT lead band(t) — median ρ +0.034 vs +0.380 for plain band persistence, conditional
   P(band>median | high-vol yesterday) = 50% = the base rate; the intraday early-volume lead
   is equally null (ρ +0.034); (3) the exclusion map: R-TAX0 (gate-passing, med after-tax
   robust edge ≤ 0; 35 items, zero of our lots inside) and R-1SIDED (med imbalance ≥ 0.6;
   0 lots inside) survive the strike check; R-SUBGATE / R-CLEAR / R-TAX1 are CONTRADICTED by
   our own realized P&L (the 500–3,500/d zone alone holds +13.2m of our profit) and must NOT
   be encoded as hard exclusions.

   Usage: node pipeline/experiments/edge-map-study.mjs [--section a|b|c|d|all] [--json]
          [--min-days 40] [--min-hours 12]
   Read-only; no writes, no fetches, no git. Removable per this directory's README. */

import { open } from '../lib/market/archive.mjs';
import {
  loadOrBuildPanel, annotateRegimes, perItemAgg, makeBins,
  loadClosedLots, loadNames, loadScreenIds,
  spearman, median, quantile, pct, num, cor, gp,
} from './edge-map-lib.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);
const SECTION = String(flag('section', 'all')).toLowerCase();
const MIN_DAYS = Number(flag('min-days', 40));
const MIN_HOURS = Number(flag('min-hours', 12));
const asJson = has('json');
const log = asJson ? () => {} : (...a) => console.log(...a);
const err = (...a) => console.error(...a);

// seeded PRNG (LCG) so the subsampling test is reproducible run to run
let _seed = 0xC0FFEE;
const rand = () => (_seed = (_seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

// ── shared context ───────────────────────────────────────────────────────────
err(`[edge-map] loading item-day panel (grain 1h, min ${MIN_HOURS} two-sided hours/day; cached in pipeline/.cache/)…`);
const t0 = Date.now();
const panel = annotateRegimes(loadOrBuildPanel({
  minHours: MIN_HOURS,
  force: has('no-cache'),
  onProgress: (n) => err(`[edge-map]   …${num(n)} hourly rows`),
}));
const perItem = perItemAgg(panel, MIN_DAYS);
err(`[edge-map] panel: ${num(panel.length)} item-days · ${num(perItem.length)} items ≥${MIN_DAYS}d (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

const names = loadNames();
const nm = (id) => names.get(id) || `#${id}`;
const screenIds = loadScreenIds();
const priceBins = makeBins(perItem, 'medPrice', 10);
const volBinsGlobal = makeBins(perItem, 'medMinSide', 5);
const perItemById = new Map(perItem.map((r) => [r.itemId, r]));

// within-decile vol quintiles (sorted by TOTAL vol, matching the prior study's quintProfile)
const decGroups = new Map();   // decile → perItem rows
for (const r of perItem) {
  const d = priceBins.of(r.medPrice);
  if (!decGroups.has(d)) decGroups.set(d, []);
  decGroups.get(d).push(r);
}
const volBinsByDec = new Map();   // decile → makeBins over medVol
for (const [d, rows] of decGroups) volBinsByDec.set(d, makeBins(rows, 'medVol', 5));

let dayMin = Infinity, dayMax = -Infinity;
for (const p of panel) { if (p.day < dayMin) dayMin = p.day; if (p.day > dayMax) dayMax = p.day; }
const dayRange = [
  new Date(dayMin * 86400000).toISOString().slice(0, 10),
  new Date(dayMax * 86400000).toISOString().slice(0, 10),
];

// per-item day→row index (workstreams A and C)
const itemDays = new Map();   // itemId → Map(day → panel row)
for (const p of panel) {
  let m = itemDays.get(p.itemId);
  if (!m) { m = new Map(); itemDays.set(p.itemId, m); }
  m.set(p.day, p);
}

const OUT = {
  meta: {
    grain: '1h', minDays: MIN_DAYS, minHours: MIN_HOURS,
    itemDays: panel.length, items: perItem.length, dayRange,
    note: 'one 68-day window, no out-of-sample split; descriptive of Jun–Aug 2026 only',
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// A. realized P&L vs item characteristics as of buy date
// ═════════════════════════════════════════════════════════════════════════════
function sectionA() {
  const lotsAll = loadClosedLots();
  const banked = lotsAll.filter((l) => l.banked);
  const lots = lotsAll.filter((l) => !l.banked);

  const chars = [];   // one entry per characterized lot
  let uncharacterized = 0;
  for (const l of lots) {
    const buyDay = Math.floor(l.buyTs / 86400);
    const m = itemDays.get(l.itemId);
    const pre = [];
    if (m) for (let d = buyDay - 7; d <= buyDay - 1; d++) { const r = m.get(d); if (r) pre.push(r); }
    if (pre.length < 3) { uncharacterized++; continue; }
    const g = (k) => median(pre.map((r) => r[k]).filter((v) => v != null));
    const p1 = m.get(buyDay - 1)?.price ?? m.get(buyDay - 2)?.price ?? null;
    const p7 = m.get(buyDay - 7)?.price ?? m.get(buyDay - 6)?.price ?? m.get(buyDay - 8)?.price ?? null;
    const slope = p1 != null && p7 > 0 ? p1 / p7 - 1 : null;
    chars.push({
      itemId: l.itemId, qty: l.qty, realised: l.realised,
      netU: l.realised / l.qty,
      roi: l.realised / (l.buyEach * l.qty),
      win: l.realised > 0,
      holdH: (l.sellTs - l.buyTs) / 3600,
      preMedPrice: g('price'), preMedMinSide: g('minSide'),
      preMedBand: g('bandPct'), preMedSpread: g('spreadPct'), preMedEdge: g('edgePct'),
      regime: slope == null ? null : slope >= 0.03 ? 'rising' : slope <= -0.03 ? 'falling' : 'flat',
      decile: priceBins.of(g('price')),
      volQ: volBinsGlobal.of(g('minSide')),
    });
  }

  const cellStats = (rows) => {
    if (!rows.length) return null;
    const items = new Map();
    for (const r of rows) {
      if (!items.has(r.itemId)) items.set(r.itemId, []);
      items.get(r.itemId).push(r);
    }
    const perItemStats = [...items.values()].map((rs) => ({
      winRate: rs.filter((r) => r.win).length / rs.length,
      medRoi: median(rs.map((r) => r.roi)),
    }));
    return {
      nLots: rows.length, nItems: items.size,
      winRate: rows.filter((r) => r.win).length / rows.length,
      medNetU: median(rows.map((r) => r.netU)),
      medRoi: median(rows.map((r) => r.roi)),
      medHoldH: median(rows.map((r) => r.holdH)),
      totRealised: rows.reduce((s, r) => s + r.realised, 0),
      itemWinRate: median(perItemStats.map((s) => s.winRate)),
      itemMedRoi: median(perItemStats.map((s) => s.medRoi)),
      thin: items.size < 10,
    };
  };

  const groupBy = (keyFn, labels) => {
    const groups = new Map();
    for (const r of chars) {
      const k = keyFn(r);
      if (k == null) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const order = labels || [...groups.keys()].sort((a, b) => (a > b ? 1 : -1));
    return order.filter((k) => groups.has(k)).map((k) => ({ cell: k, ...cellStats(groups.get(k)) }));
  };

  const bandBucket = (r) => r.preMedBand == null ? null
    : r.preMedBand < 0.05 ? '<5%' : r.preMedBand < 0.10 ? '5–10%' : r.preMedBand < 0.20 ? '10–20%' : '≥20%';
  const spreadBucket = (r) => r.preMedSpread == null ? null
    : r.preMedSpread < 0.02 ? '<2% (≤tax)' : r.preMedSpread < 0.04 ? '2–4%' : '≥4%';

  // concentration
  const byItem = new Map();
  for (const r of chars) {
    if (!byItem.has(r.itemId)) byItem.set(r.itemId, []);
    byItem.get(r.itemId).push(r);
  }
  const conc = [...byItem.entries()]
    .map(([id, rs]) => ({
      itemId: id, name: nm(id), lots: rs.length,
      totRealised: rs.reduce((s, r) => s + r.realised, 0),
      winRate: rs.filter((r) => r.win).length / rs.length,
    }))
    .sort((a, b) => b.lots - a.lots);

  const A = {
    lotsTotal: lotsAll.length, banked: banked.length, flips: lots.length,
    characterized: chars.length, uncharacterized,
    distinctItems: byItem.size,
    top10Items: conc.slice(0, 10),
    top3Share: conc.slice(0, 3).reduce((s, c) => s + c.lots, 0) / Math.max(1, chars.length),
    byDecile: groupBy((r) => r.decile),
    byVolQ: groupBy((r) => r.volQ),
    byBand: groupBy(bandBucket, ['<5%', '5–10%', '10–20%', '≥20%']),
    bySpread: groupBy(spreadBucket, ['<2% (≤tax)', '2–4%', '≥4%']),
    byRegime: groupBy((r) => r.regime, ['falling', 'flat', 'rising']),
    overall: cellStats(chars),
  };
  OUT.A = A;
  OUT.A.chars = chars;   // consumed by section D's cross-check; stripped from --json below

  if (SECTION !== 'all' && SECTION !== 'a') return;
  log(`\n## A. Realized P&L vs item characteristics as of buy date`);
  log(`${A.flips} flip lots (${A.banked} banked keep-round-trips excluded) · ${A.characterized} characterized (${A.uncharacterized} lacked ≥3 pre-buy panel days) · ${A.distinctItems} distinct items`);
  log(`Top-3 items carry ${pct(A.top3Share, 0)} of all lots — this is OUR OWN self-selected trade log, not a sample of the opportunity set. Item-weighted columns (itemW) weight each ITEM equally.`);
  log(`\n| item (top 10 by lots) | lots | win% | total realised |`);
  log(`| --- | ---: | ---: | ---: |`);
  for (const c of A.top10Items) log(`| ${c.name} | ${c.lots} | ${pct(c.winRate, 0)} | ${gp(c.totRealised)} |`);

  const printCells = (title, rows) => {
    log(`\n### ${title}`);
    log(`| cell | lots | items | win% | med net/u | med ROI | med hold | itemW win% | itemW ROI | |`);
    log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`);
    for (const r of rows) {
      log(`| ${r.cell} | ${r.nLots} | ${r.nItems} | ${pct(r.winRate, 0)} | ${gp(r.medNetU)} | ${pct(r.medRoi, 1)} | ${r.medHoldH.toFixed(1)}h | ${pct(r.itemWinRate, 0)} | ${pct(r.itemMedRoi, 1)} | ${r.thin ? '⚠ <10 items — no conclusion' : ''} |`);
    }
  };
  printCells('by price decile (universe bounds)', A.byDecile.map((r) => ({ ...r, cell: `decile ${r.cell}` })));
  printCells('by min-side volume quintile (universe bounds)', A.byVolQ.map((r) => ({ ...r, cell: `vol Q${r.cell}` })));
  printCells('by pre-buy median band', A.byBand);
  printCells('by pre-buy median spread', A.bySpread);
  printCells('by trailing 7d regime (±3%)', A.byRegime);
}

// ═════════════════════════════════════════════════════════════════════════════
// B. gate placement + the measurement-artifact test
// ═════════════════════════════════════════════════════════════════════════════
function sectionB() {
  // B1 — volume strata around the 3,500/d min-side gate
  const strata = [
    ['<100/d', (r) => r.medMinSide < 100],
    ['100–500/d', (r) => r.medMinSide >= 100 && r.medMinSide < 500],
    ['500–3,500/d (below gate)', (r) => r.medMinSide >= 500 && r.medMinSide < 3500],
    ['3,500–20k/d', (r) => r.medMinSide >= 3500 && r.medMinSide < 20000],
    ['≥20k/d', (r) => r.medMinSide >= 20000],
  ];
  const stratStats = strata.map(([label, test]) => {
    const rs = perItem.filter(test);
    const g = (k) => median(rs.map((r) => r[k]).filter((v) => v != null));
    return {
      label, nItems: rs.length,
      medPrice: g('medPrice'), medNHours: g('medNHours'),
      medSpread: g('medSpread'), medBand: g('medBand'),
      medTrimBand: g('medTrimBand'), medRobustBand: g('medRobustBand'),
      medEdge: g('medEdge'), medClearFrac2: g('clearFrac2'),
      medDepthTop: g('medDepthTop'), medImb: g('medImb'), medGpFlow: g('gpFlow'),
    };
  });

  // below-gate zone: who down there is GENUINELY tradeable? (robust band clears tax by ≥2%
  // on ≥50% of days, two-sided book, price above the tick floor)
  const belowGate = perItem.filter((r) => r.medMinSide >= 500 && r.medMinSide < 3500);
  const tradeable = belowGate
    .filter((r) => r.medEdge >= 0.02 && r.clearFrac2 >= 0.5 && r.medImb < 0.5 && r.medPrice >= 100)
    .sort((a, b) => b.medEdge * b.gpFlow - a.medEdge * a.gpFlow);

  // B2 — THE CRITICAL TEST: subsample dense liquid items down to thin print counts
  const refs = perItem
    .filter((r) => r.medMinSide >= 3500 && r.medNHours >= 23.5 && r.medPrice >= 300 && r.medPrice <= 20000)
    .sort((a, b) => a.medPrice - b.medPrice);
  const pickN = 40;
  const step = Math.max(1, Math.floor(refs.length / pickN));
  const picked = refs.filter((_, i) => i % step === 0).slice(0, pickN);

  const KS = [3, 4, 6, 8, 12, 18];
  const TRIALS = 25;
  const ratioSamples = new Map(KS.map((k) => [k, []]));
  const absSamples = new Map(KS.map((k) => [k, []]));
  let refDays = 0;
  if (picked.length) {
    const a = open(undefined, { readonly: true });
    const ph = picked.map(() => '?').join(',');
    const rows = a.db.prepare(`
      SELECT itemId, ts, avgHighPrice AS hi, avgLowPrice AS lo
      FROM observations
      WHERE grain = '1h' AND itemId IN (${ph})
            AND avgHighPrice IS NOT NULL AND avgLowPrice IS NOT NULL
            AND avgHighPrice > 0 AND avgLowPrice > 0
      ORDER BY itemId, ts
    `).all(...picked.map((r) => r.itemId));
    a.close();
    const days = new Map();
    for (const r of rows) {
      const key = `${r.itemId}:${Math.floor(r.ts / 86400)}`;
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(r);
    }
    for (const hrs of days.values()) {
      if (hrs.length !== 24) continue;   // only complete days — the k=24 baseline must be exact
      refDays++;
      const mids = hrs.map((h) => (h.hi + h.lo) / 2);
      const dayMid = median(mids);
      const full = (Math.max(...hrs.map((h) => h.hi)) - Math.min(...hrs.map((h) => h.lo))) / dayMid;
      if (!(full > 0)) continue;
      for (const k of KS) {
        let acc = 0;
        for (let t = 0; t < TRIALS; t++) {
          // sample k of 24 hours without replacement (partial Fisher–Yates)
          const idx = [...hrs.keys()];
          for (let i = 0; i < k; i++) {
            const j = i + Math.floor(rand() * (idx.length - i));
            [idx[i], idx[j]] = [idx[j], idx[i]];
          }
          let mx = -Infinity, mn = Infinity;
          const smids = [];
          for (let i = 0; i < k; i++) {
            const h = hrs[idx[i]];
            if (h.hi > mx) mx = h.hi;
            if (h.lo < mn) mn = h.lo;
            smids.push((h.hi + h.lo) / 2);
          }
          acc += (mx - mn) / median(smids);
        }
        const bk = acc / TRIALS;
        ratioSamples.get(k).push(bk / full);
        absSamples.get(k).push(bk);
      }
    }
  }
  const subsample = KS.map((k) => ({
    k,
    medRatio: median(ratioSamples.get(k)),
    q25: quantile(ratioSamples.get(k), 0.25),
    q75: quantile(ratioSamples.get(k), 0.75),
    medAbsBand: median(absSamples.get(k)),
  }));

  // print densities to match against (what k actually corresponds to a thin item)
  const densOf = (test) => median(perItem.filter(test).map((r) => r.medNHours));
  const printDensity = {
    'minSide <100/d': densOf((r) => r.medMinSide < 100),
    'minSide 100–500/d': densOf((r) => r.medMinSide >= 100 && r.medMinSide < 500),
    'minSide 500–3,500/d': densOf((r) => r.medMinSide >= 500 && r.medMinSide < 3500),
    'minSide ≥3,500/d': densOf((r) => r.medMinSide >= 3500),
  };

  // B2b — the sharper decomposition on price decile 5 (the prior study's showcase cell):
  // raw → trimmed → robust band collapse + depth at the band-setting prints
  const d5 = decGroups.get(5) || [];
  const vb5 = volBinsByDec.get(5);
  const decomp = [];
  for (let q = 1; q <= 5; q++) {
    const rs = d5.filter((r) => vb5.of(r.medVol) === q);
    if (!rs.length) continue;
    const g = (k) => median(rs.map((r) => r[k]).filter((v) => v != null));
    decomp.push({
      q, nItems: rs.length, medVol: g('medVol'), medMinSide: g('medMinSide'), medNHours: g('medNHours'),
      medBand: g('medBand'), medTrimBand: g('medTrimBand'), medRobustBand: g('medRobustBand'),
      medEdge: g('medEdge'), medDepthTop: g('medDepthTop'), medDepthBot: g('medDepthBot'),
      unitsPerHour: g('medMinSide') / Math.max(1, g('medNHours')),
    });
  }

  OUT.B = {
    strata: stratStats,
    belowGate: { nItems: belowGate.length, tradeableN: tradeable.length,
      tradeable: tradeable.slice(0, 15).map((r) => ({
        itemId: r.itemId, name: nm(r.itemId), medMinSide: r.medMinSide, medPrice: r.medPrice,
        medEdge: r.medEdge, clearFrac2: r.clearFrac2, medDepthTop: r.medDepthTop, gpFlow: r.gpFlow,
      })) },
    subsample: { refItems: picked.length, refDays, trials: TRIALS, curve: subsample },
    printDensity, decompDecile5: decomp,
  };

  if (SECTION !== 'all' && SECTION !== 'b') return;
  log(`\n## B. Gate placement + the measurement-artifact test`);
  log(`\n### B1. Volume strata around the 3,500/d min-side gate (per-item medians)`);
  log(`| stratum | items | med price | med hrs/d | med spread | med band | med trim band | med robust band | med after-tax edge | med clear≥2% days | med depth@top | med imb | med gp-flow/d |`);
  log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const s of stratStats) {
    log(`| ${s.label} | ${s.nItems} | ${gp(s.medPrice)} | ${s.medNHours?.toFixed(0)} | ${pct(s.medSpread)} | ${pct(s.medBand)} | ${pct(s.medTrimBand)} | ${pct(s.medRobustBand)} | ${pct(s.medEdge)} | ${pct(s.medClearFrac2, 0)} | ${num(s.medDepthTop)} | ${s.medImb?.toFixed(2)} | ${gp(s.medGpFlow)} |`);
  }
  log(`\nBelow-gate zone (500–3,500/d): ${OUT.B.belowGate.nItems} items, of which ${OUT.B.belowGate.tradeableN} pass a strict tradeability screen (robust after-tax edge ≥2%, ≥50% of days clear 2%, imbalance <0.5, price ≥100gp):`);
  log(`| item | min-side/d | price | robust edge | clear≥2% days | depth@top | gp-flow/d |`);
  log(`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of OUT.B.belowGate.tradeable) {
    log(`| ${r.name} | ${num(r.medMinSide)} | ${gp(r.medPrice)} | ${pct(r.medEdge)} | ${pct(r.clearFrac2, 0)} | ${num(r.medDepthTop)} | ${gp(r.gpFlow)} |`);
  }
  log(`\n### B2. THE CRITICAL TEST — subsample dense liquid items to thin print counts`);
  log(`${OUT.B.subsample.refItems} reference items (min-side ≥3,500/d, 24 printed hrs/d, 300–20k gp) · ${num(refDays)} complete item-days · ${TRIALS} trials/day/k (seeded PRNG)`);
  log(`| k hours kept | med band(k)/band(24) | IQR | med subsampled bandPct |`);
  log(`| ---: | ---: | --- | ---: |`);
  for (const s of subsample) log(`| ${s.k} | ${s.medRatio?.toFixed(3)} | ${s.q25?.toFixed(3)}..${s.q75?.toFixed(3)} | ${pct(s.medAbsBand)} |`);
  log(`\nPrint density to match against (med two-sided hrs/day):`);
  for (const [k, v] of Object.entries(printDensity)) log(`  ${k}: ${v?.toFixed(1)}h`);
  log(`\n### B2b. Where the wide band actually comes from — decile 5, by vol quintile`);
  log(`| vol Q | items | med vol/d | med min-side | hrs/d | raw band | trim band | robust band | after-tax edge | depth@top | depth@bot | units/printed-hr |`);
  log(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const d of decomp) {
    log(`| Q${d.q} | ${d.nItems} | ${num(d.medVol)} | ${num(d.medMinSide)} | ${d.medNHours?.toFixed(0)} | ${pct(d.medBand)} | ${pct(d.medTrimBand)} | ${pct(d.medRobustBand)} | ${pct(d.medEdge)} | ${num(d.medDepthTop)} | ${num(d.medDepthBot)} | ${d.unitsPerHour?.toFixed(1)} |`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// C. does the within-item volume↔band link LEAD (tradeable) or only co-move?
// ═════════════════════════════════════════════════════════════════════════════
function sectionC() {
  const dist = (arr) => ({
    n: arr.length, median: median(arr),
    q25: quantile(arr, 0.25), q75: quantile(arr, 0.75),
    fracPos: arr.length ? arr.filter((v) => v > 0).length / arr.length : null,
  });

  const rhoLagVB = [], rhoConVB = [], rhoBB = [], rhoVV = [], rhoLagVE = [];
  const condSignal = [], condControl = [];          // per-item conditional summaries
  const quintRows = new Map([1, 2, 3, 4, 5].map((q) => [q, { ratios: [], edgeDelta: [] }]));
  const rhoEarly = [], rhoEarlyBand = [], rhoRestPersist = [];
  const condEarly = [];

  for (const [itemId, m] of itemDays) {
    const days = [...m.values()].sort((a, b) => a.day - b.day);
    if (days.length < MIN_DAYS) continue;
    // consecutive-day pairs only
    const pairs = [];
    for (let i = 1; i < days.length; i++) if (days[i].day - days[i - 1].day === 1) pairs.push([days[i - 1], days[i]]);
    if (pairs.length < 20) continue;

    const vPrev = pairs.map(([p]) => p.vol), vNow = pairs.map(([, t]) => t.vol);
    const bPrev = pairs.map(([p]) => p.bandPct), bNow = pairs.map(([, t]) => t.bandPct);
    const eNow = pairs.map(([, t]) => t.edgePct);
    push(rhoLagVB, spearman(vPrev, bNow));
    push(rhoConVB, spearman(vNow, bNow));
    push(rhoBB, spearman(bPrev, bNow));
    push(rhoVV, spearman(vPrev, vNow));
    push(rhoLagVE, spearman(vPrev, eNow));

    const medBand = median(days.map((d) => d.bandPct));
    const medEdge = median(days.map((d) => d.edgePct));
    const vQ80 = quantile(days.map((d) => d.vol), 0.8);
    const bQ80 = quantile(days.map((d) => d.bandPct), 0.8);

    // conditional: yesterday top-quintile VOLUME → today's band vs own baseline
    const sig = pairs.filter(([p]) => p.vol >= vQ80);
    if (sig.length >= 8 && medBand > 0) {
      condSignal.push({
        ratio: median(sig.map(([, t]) => t.bandPct / medBand)),
        pAbove: sig.filter(([, t]) => t.bandPct > medBand).length / sig.length,
        edgeDelta: median(sig.map(([, t]) => t.edgePct)) - medEdge,
        price: median(days.map((d) => d.price)),
      });
    }
    // control: yesterday top-quintile BAND → today's band (pure persistence)
    const ctl = pairs.filter(([p]) => p.bandPct >= bQ80);
    if (ctl.length >= 8 && medBand > 0) {
      condControl.push({
        ratio: median(ctl.map(([, t]) => t.bandPct / medBand)),
        pAbove: ctl.filter(([, t]) => t.bandPct > medBand).length / ctl.length,
      });
    }
    // full quintile profile of vol(t−1) → band(t)/edge(t)
    const vols = days.map((d) => d.vol);
    const cutsQ = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(vols, q));
    const qOf = (v) => v <= cutsQ[0] ? 1 : v <= cutsQ[1] ? 2 : v <= cutsQ[2] ? 3 : v <= cutsQ[3] ? 4 : 5;
    for (let q = 1; q <= 5; q++) {
      const ps = pairs.filter(([p]) => qOf(p.vol) === q);
      if (ps.length >= 5 && medBand > 0) {
        quintRows.get(q).ratios.push(median(ps.map(([, t]) => t.bandPct / medBand)));
        quintRows.get(q).edgeDelta.push(median(ps.map(([, t]) => t.edgePct)) - medEdge);
      }
    }

    // intraday: early (UTC 0–5) volume → rest-of-day (6–23) band, SAME day, no hour overlap
    const intra = days.filter((d) => d.earlyVol != null && d.restBandPct != null);
    if (intra.length >= 20) {
      push(rhoEarly, spearman(intra.map((d) => d.earlyVol), intra.map((d) => d.restBandPct)));
      const restPairs = [];
      for (let i = 1; i < intra.length; i++) if (intra[i].day - intra[i - 1].day === 1) restPairs.push([intra[i - 1], intra[i]]);
      if (restPairs.length >= 15) push(rhoRestPersist, spearman(restPairs.map(([p]) => p.restBandPct), restPairs.map(([, t]) => t.restBandPct)));
      const eQ80 = quantile(intra.map((d) => d.earlyVol), 0.8);
      const medRest = median(intra.map((d) => d.restBandPct));
      const medRestEdge = median(intra.map((d) => d.restEdgePct).filter((v) => v != null));
      const esig = intra.filter((d) => d.earlyVol >= eQ80);
      if (esig.length >= 8 && medRest > 0) {
        condEarly.push({
          ratio: median(esig.map((d) => d.restBandPct / medRest)),
          pAbove: esig.filter((d) => d.restBandPct > medRest).length / esig.length,
          restEdgeDelta: medRestEdge != null ? median(esig.map((d) => d.restEdgePct).filter((v) => v != null)) - medRestEdge : null,
        });
      }
    }
  }
  function push(arr, v) { if (v != null) arr.push(v); }

  OUT.C = {
    correlations: {
      'ρ(vol(t−1), band(t))  [the LEAD under test]': dist(rhoLagVB),
      'ρ(vol(t), band(t))    [contemporaneous, prior study]': dist(rhoConVB),
      'ρ(band(t−1), band(t)) [CONTROL: pure persistence]': dist(rhoBB),
      'ρ(vol(t−1), vol(t))   [volume persistence]': dist(rhoVV),
      'ρ(vol(t−1), edge(t))  [lead onto after-tax edge]': dist(rhoLagVE),
    },
    conditional: {
      signal: { nItems: condSignal.length,
        medRatio: median(condSignal.map((c) => c.ratio)),
        q25: quantile(condSignal.map((c) => c.ratio), 0.25), q75: quantile(condSignal.map((c) => c.ratio), 0.75),
        medPAbove: median(condSignal.map((c) => c.pAbove)),
        medEdgeDeltaPp: median(condSignal.map((c) => c.edgeDelta)) },
      control: { nItems: condControl.length,
        medRatio: median(condControl.map((c) => c.ratio)),
        medPAbove: median(condControl.map((c) => c.pAbove)) },
    },
    quintProfile: [1, 2, 3, 4, 5].map((q) => ({
      q, nItems: quintRows.get(q).ratios.length,
      medRatio: median(quintRows.get(q).ratios),
      medEdgeDeltaPp: median(quintRows.get(q).edgeDelta),
    })),
    intraday: {
      'ρ(earlyVol 0–5h, restBand 6–23h) same day': dist(rhoEarly),
      'ρ(restBand(t−1), restBand(t)) [CONTROL]': dist(rhoRestPersist),
      conditional: { nItems: condEarly.length,
        medRatio: median(condEarly.map((c) => c.ratio)),
        q25: quantile(condEarly.map((c) => c.ratio), 0.25), q75: quantile(condEarly.map((c) => c.ratio), 0.75),
        medPAbove: median(condEarly.map((c) => c.pAbove)),
        medRestEdgeDeltaPp: median(condEarly.map((c) => c.restEdgeDelta).filter((v) => v != null)) },
    },
    configsTried: 'fixed a priori: lag 1 day; q80 signal threshold; UTC 0–5 early window; ±3% regime thr. No grid searched.',
  };

  if (SECTION !== 'all' && SECTION !== 'c') return;
  log(`\n## C. Is the within-item volume↔band link tradeable? (lead/lag + intraday)`);
  log(`\n### Per-item Spearman distributions (items with ≥20 consecutive-day pairs)`);
  log(`| relation | items | median ρ | IQR | % positive |`);
  log(`| --- | ---: | ---: | --- | ---: |`);
  for (const [k, d] of Object.entries(OUT.C.correlations)) {
    log(`| ${k} | ${d.n} | ${cor(d.median)} | ${cor(d.q25)}..${cor(d.q75)} | ${d.fracPos != null ? (d.fracPos * 100).toFixed(0) + '%' : '—'} |`);
  }
  const cd = OUT.C.conditional;
  log(`\n### Conditional: given yesterday was a top-quintile VOLUME day for the item`);
  log(`| condition | items | med band(t)/own-median | IQR | med P(band > median) | med Δ after-tax edge |`);
  log(`| --- | ---: | ---: | --- | ---: | ---: |`);
  log(`| vol(t−1) ≥ q80 (SIGNAL) | ${cd.signal.nItems} | ${cd.signal.medRatio?.toFixed(3)} | ${cd.signal.q25?.toFixed(3)}..${cd.signal.q75?.toFixed(3)} | ${pct(cd.signal.medPAbove, 0)} | ${cd.signal.medEdgeDeltaPp != null ? (cd.signal.medEdgeDeltaPp * 100).toFixed(2) + 'pp' : '—'} |`);
  log(`| band(t−1) ≥ q80 (CONTROL: persistence) | ${cd.control.nItems} | ${cd.control.medRatio?.toFixed(3)} | — | ${pct(cd.control.medPAbove, 0)} | — |`);
  log(`\n### vol(t−1) quintile → band(t) vs own median (pooled per-item medians)`);
  log(`| vol(t−1) quintile | items | med band ratio | med Δ after-tax edge |`);
  log(`| ---: | ---: | ---: | ---: |`);
  for (const r of OUT.C.quintProfile) log(`| Q${r.q} | ${r.nItems} | ${r.medRatio?.toFixed(3)} | ${r.medEdgeDeltaPp != null ? (r.medEdgeDeltaPp * 100).toFixed(2) + 'pp' : '—'} |`);
  log(`\n### Intraday lead — UTC 0–5h volume vs rest-of-day (6–23h) band`);
  log(`| relation | items | median ρ | IQR | % positive |`);
  log(`| --- | ---: | ---: | --- | ---: |`);
  for (const k of ['ρ(earlyVol 0–5h, restBand 6–23h) same day', 'ρ(restBand(t−1), restBand(t)) [CONTROL]']) {
    const d = OUT.C.intraday[k];
    log(`| ${k} | ${d.n} | ${cor(d.median)} | ${cor(d.q25)}..${cor(d.q75)} | ${d.fracPos != null ? (d.fracPos * 100).toFixed(0) + '%' : '—'} |`);
  }
  const ce = OUT.C.intraday.conditional;
  log(`\nConditional (early vol ≥ own q80): ${ce.nItems} items · med rest-band ratio ${ce.medRatio?.toFixed(3)} (IQR ${ce.q25?.toFixed(3)}..${ce.q75?.toFixed(3)}) · med P(rest-band > median) ${pct(ce.medPAbove, 0)} · med Δ rest after-tax edge ${ce.medRestEdgeDeltaPp != null ? (ce.medRestEdgeDeltaPp * 100).toFixed(2) + 'pp' : '—'}`);
  log(`\n(${OUT.C.configsTried})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// D. THE EXCLUSION MAP
// ═════════════════════════════════════════════════════════════════════════════
function sectionD() {
  // our lots per item (flip lots only, from section A's characterization pass)
  const chars = OUT.A?.chars || [];
  const lotsByItem = new Map();
  for (const c of chars) {
    let e = lotsByItem.get(c.itemId);
    if (!e) { e = { n: 0, realised: 0, wins: 0 }; lotsByItem.set(c.itemId, e); }
    e.n++; e.realised += c.realised; e.wins += c.win ? 1 : 0;
  }

  // the 10×5 grid
  const grid = [];
  for (let d = 1; d <= 10; d++) {
    const rows = decGroups.get(d) || [];
    const vb = volBinsByDec.get(d);
    for (let q = 1; q <= 5; q++) {
      const rs = rows.filter((r) => vb.of(r.medVol) === q);
      if (!rs.length) continue;
      const g = (k) => median(rs.map((r) => r[k]).filter((v) => v != null));
      let lotN = 0, lotReal = 0, lotItems = 0;
      for (const r of rs) {
        const e = lotsByItem.get(r.itemId);
        if (e) { lotN += e.n; lotReal += e.realised; lotItems++; }
      }
      grid.push({
        decile: d, volQ: q, nItems: rs.length,
        medPrice: g('medPrice'), medMinSide: g('medMinSide'), medSpread: g('medSpread'),
        medBand: g('medBand'), medRobustBand: g('medRobustBand'), medEdge: g('medEdge'),
        medClearFrac2: g('clearFrac2'), medDepthTop: g('medDepthTop'), medImb: g('medImb'),
        gateN: rs.filter((r) => r.medMinSide >= 3500).length,
        screenN: rs.filter((r) => screenIds.has(r.itemId)).length,
        lotN, lotReal, lotItems,
      });
    }
  }

  // regime cut (item-day level) — does trailing regime change realizable edge?
  const gateSet = new Set(perItem.filter((r) => r.medMinSide >= 3500).map((r) => r.itemId));
  const regimeCut = ['falling', 'flat', 'rising'].map((rg) => {
    const ds = panel.filter((p) => p.regime === rg && gateSet.has(p.itemId));
    return {
      regime: rg, nDays: ds.length,
      medBand: median(ds.map((d) => d.bandPct)),
      medEdge: median(ds.map((d) => d.edgePct)),
      clearFrac2: ds.length ? ds.filter((d) => d.edgePct >= 0.02).length / ds.length : null,
    };
  });

  // candidate exclusion rules
  const ruleDefs = [
    ['R-GHOST', 'min-side < 500/d (ghost-spread zone)', (r) => r.medMinSide < 500],
    ['R-SUBGATE', 'min-side 500–3,500/d (below the current gate)', (r) => r.medMinSide >= 500 && r.medMinSide < 3500],
    ['R-TICK', 'price < 50gp (1gp tick ≥2% of price; tax-exempt but unmeasurable)', (r) => r.medPrice < 50],
    ['R-TAX0', 'gate-passing AND med after-tax robust edge ≤ 0 (tax-eaten)', (r) => r.medMinSide >= 3500 && r.medEdge != null && r.medEdge <= 0],
    ['R-TAX1', 'gate-passing AND med after-tax robust edge 0–1% (marginal)', (r) => r.medMinSide >= 3500 && r.medEdge != null && r.medEdge > 0 && r.medEdge < 0.01],
    ['R-1SIDED', 'med |hv−lv|/(hv+lv) ≥ 0.6 (one-sided book)', (r) => r.medImb != null && r.medImb >= 0.6],
    ['R-CLEAR', 'fewer than 25% of days clear 2% after tax (robust band)', (r) => r.clearFrac2 < 0.25],
  ];
  const gateTotal = gateSet.size;
  const screenInUniverse = perItem.filter((r) => screenIds.has(r.itemId)).length;
  const rules = ruleDefs.map(([id, label, test]) => {
    const rs = perItem.filter(test);
    const hits = rs.filter((r) => lotsByItem.has(r.itemId));
    return {
      id, label,
      nItems: rs.length, pctUniverse: rs.length / perItem.length,
      gateRemoved: rs.filter((r) => r.medMinSide >= 3500).length,
      screenRemoved: rs.filter((r) => screenIds.has(r.itemId)).length,
      lotN: hits.reduce((s, r) => s + lotsByItem.get(r.itemId).n, 0),
      lotRealised: hits.reduce((s, r) => s + lotsByItem.get(r.itemId).realised, 0),
      lotItems: hits.length,
      lotDetail: hits
        .map((r) => ({ name: nm(r.itemId), gpFlow: r.gpFlow, ...lotsByItem.get(r.itemId) }))
        .sort((a, b) => b.realised - a.realised),
      screenNames: rs.filter((r) => screenIds.has(r.itemId)).map((r) => nm(r.itemId)),
      examples: [...rs].sort((a, b) => b.gpFlow - a.gpFlow).slice(0, 3).map((r) => nm(r.itemId)),
    };
  });

  OUT.D = { grid, regimeCut, gateTotal, screenInUniverse, screenIdsTotal: screenIds.size,
    priceDecileCuts: priceBins.cuts, volQuintileCutsGlobal: volBinsGlobal.cuts, rules };

  if (SECTION !== 'all' && SECTION !== 'd') return;
  log(`\n## D. THE EXCLUSION MAP`);
  log(`Universe: ${perItem.length} items ≥${MIN_DAYS}d · gate-passing (min-side ≥3,500/d): ${gateTotal} · currently screen-surfaced ids present in universe: ${screenInUniverse}/${screenIds.size}`);
  log(`\n### The grid — price decile × vol quintile (per-item medians)`);
  log(`| dec | volQ | items | med price | med min-side | spread | band | robust band | after-tax edge | clear≥2% | depth@top | imb | gate | screen | our lots (realised) |`);
  log(`| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |`);
  for (const c of grid) {
    log(`| ${c.decile} | Q${c.volQ} | ${c.nItems} | ${gp(c.medPrice)} | ${num(c.medMinSide)} | ${pct(c.medSpread)} | ${pct(c.medBand)} | ${pct(c.medRobustBand)} | ${pct(c.medEdge)} | ${pct(c.medClearFrac2, 0)} | ${num(c.medDepthTop)} | ${c.medImb?.toFixed(2)} | ${c.gateN} | ${c.screenN} | ${c.lotN ? `${c.lotN} (${gp(c.lotReal)})` : ''} |`);
  }
  log(`\n### Regime cut — gate-passing item-days by trailing 7d regime (±3%)`);
  log(`| regime | item-days | med band | med after-tax edge | days clearing 2% |`);
  log(`| --- | ---: | ---: | ---: | ---: |`);
  for (const r of regimeCut) log(`| ${r.regime} | ${num(r.nDays)} | ${pct(r.medBand)} | ${pct(r.medEdge)} | ${pct(r.clearFrac2, 0)} |`);
  log(`\n### Candidate exclusion rules (ranked in the findings doc)`);
  log(`| rule | definition | items | % universe | gate-passing removed | screen removed | our lots inside | realised inside |`);
  log(`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of rules) {
    log(`| ${r.id} | ${r.label} | ${r.nItems} | ${pct(r.pctUniverse, 1)} | ${r.gateRemoved} | ${r.screenRemoved} | ${r.lotN} (${r.lotItems} items) | ${gp(r.lotRealised)} |`);
  }
  for (const r of rules) {
    if (r.screenNames.length) log(`\n${r.id} — currently screen-surfaced items it would remove: ${r.screenNames.join(' · ')}`);
    if (!r.lotN) continue;
    log(`\n${r.id} — our lots inside (the STRIKE check; gp-flow = med min-side × med price, vs the screen's 4.5b gp-flow side door):`);
    for (const d of r.lotDetail) log(`  ${d.name}: ${d.n} lots, ${gp(d.realised)} realised, ${d.wins}/${d.n} wins, gp-flow ${gp(d.gpFlow)}/d`);
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
err('[edge-map] section A (realized P&L join)…');
sectionA();                                          // always runs — section D consumes its lot join
if (SECTION === 'all' || SECTION === 'b') { err('[edge-map] section B (gate + artifact test)…'); sectionB(); }
if (SECTION === 'all' || SECTION === 'c') { err('[edge-map] section C (lead/lag)…'); sectionC(); }
if (SECTION === 'all' || SECTION === 'd') { err('[edge-map] section D (exclusion map)…'); sectionD(); }

if (asJson) {
  delete OUT.A.chars;   // internal cross-check payload, not part of the machine output
  console.log(JSON.stringify(OUT, null, 2));
} else {
  delete OUT.A.chars;
  log(`\n(one ${OUT.meta.dayRange[0]} → ${OUT.meta.dayRange[1]} window; descriptive, not predictive; no out-of-sample split)`);
}
err(`[edge-map] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
