#!/usr/bin/env node
/* volume-vs-band-study.mjs — one-shot research study (2026-08-04).

   QUESTION (Ben): is there a correlation between trade volume and % deviation from the
   guide/median — i.e. does HIGH VOLUME mean a THIN BAND?

   Three distinct dispersion measures are computed per item-day, because they are NOT the
   same thing and they matter differently for flipping:
     1. spreadPct  — per-hour (avgHighPrice − avgLowPrice) / mid, median over the day.
                     The instantaneous bid-ask spread. This is what a CHURN lap captures.
     2. bandPct    — (daily max avgHighPrice − daily min avgLowPrice) / dayMid.
                     The intraday range. This is what a patient BAND flip works over.
     3. madPct     — mean |hourMid − dayMedianMid| / dayMedianMid.
                     Dispersion around the day's own median ("deviation from guide").

   THE CONFOUND THAT DOMINATES THIS QUESTION: price level. Cheap items trade in enormous
   quantity AND carry a huge %-spread because the 1gp tick is a large fraction of price
   (1gp on a 14gp item is 7.1%). So the raw pooled correlation is contaminated in the
   direction OPPOSITE to the hypothesis. The headline number here is therefore the
   WITHIN-PRICE-DECILE correlation, not the pooled one.

   Correlations are Spearman (rank) — the distributions are heavily skewed and Pearson on
   raw volume would be driven entirely by a handful of rune/essence outliers.

   FINDINGS SUMMARY: see FLOW-CROSSOVER-FINDINGS.md's sibling — VOLUME-VS-BAND-FINDINGS.md.

   Read-only against the /1h SQLite archive. No writes, no fetches. */

import { open } from '../lib/market/archive.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const has = (name) => args.includes(`--${name}`);

const GRAIN = '1h';
const MIN_DAYS = Number(flag('min-days', 40));        // item coverage floor
const MIN_HOURS = Number(flag('min-hours', 12));      // hours needed for a day to count
const MIN_VOL = Number(flag('min-vol', 0));           // optional min-side daily volume floor
const DECILES = Number(flag('deciles', 10));
const asJson = has('json');

// ── Spearman rank correlation ────────────────────────────────────────────────
function rank(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;                       // average rank for ties
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function spearman(a, b) {
  if (a.length < 3) return null;
  const ra = rank(a), rb = rank(b);
  const n = ra.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += ra[i]; mb += rb[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = ra[i] - ma, y = rb[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const num = (v) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
const cor = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3));

// ── Build the item-day panel ─────────────────────────────────────────────────
const a = open(undefined, { readonly: true });
const rows = a.db.prepare(`
  SELECT itemId, ts, avgHighPrice AS hi, avgLowPrice AS lo,
         highPriceVolume AS hv, lowPriceVolume AS lv
  FROM observations
  WHERE grain = ? AND avgHighPrice IS NOT NULL AND avgLowPrice IS NOT NULL
        AND avgHighPrice > 0 AND avgLowPrice > 0
`).all(GRAIN);
a.close();

// group by (itemId, UTC day)
const byDay = new Map();
for (const r of rows) {
  const day = Math.floor(r.ts / 86400);
  const key = `${r.itemId}:${day}`;
  let d = byDay.get(key);
  if (!d) { d = { itemId: r.itemId, day, hrs: [] }; byDay.set(key, d); }
  d.hrs.push(r);
}

const panel = [];
for (const d of byDay.values()) {
  if (d.hrs.length < MIN_HOURS) continue;
  let maxHi = -Infinity, minLo = Infinity, hv = 0, lv = 0;
  const mids = [], spreads = [];
  for (const h of d.hrs) {
    if (h.hi > maxHi) maxHi = h.hi;
    if (h.lo < minLo) minLo = h.lo;
    hv += h.hv || 0; lv += h.lv || 0;
    const mid = (h.hi + h.lo) / 2;
    mids.push(mid);
    if (mid > 0) spreads.push((h.hi - h.lo) / mid);
  }
  const dayMid = median(mids);
  if (!dayMid || dayMid <= 0) continue;
  const minSide = Math.min(hv, lv);
  if (minSide < MIN_VOL) continue;
  const madPct = mids.reduce((s, m) => s + Math.abs(m - dayMid), 0) / mids.length / dayMid;
  panel.push({
    itemId: d.itemId, day: d.day,
    vol: hv + lv, minSide, price: dayMid,
    spreadPct: median(spreads),
    bandPct: (maxHi - minLo) / dayMid,
    madPct,
  });
}

// item coverage filter
const daysPerItem = new Map();
for (const p of panel) daysPerItem.set(p.itemId, (daysPerItem.get(p.itemId) || 0) + 1);
const keep = new Set([...daysPerItem].filter(([, n]) => n >= MIN_DAYS).map(([id]) => id));
const P = panel.filter((p) => keep.has(p.itemId));

// ── Per-item medians (the cross-sectional view: is a HIGH-VOLUME ITEM thin-banded?) ──
const perItem = [];
for (const id of keep) {
  const ds = P.filter((p) => p.itemId === id);
  perItem.push({
    itemId: id, days: ds.length,
    vol: median(ds.map((d) => d.vol)),
    price: median(ds.map((d) => d.price)),
    spreadPct: median(ds.map((d) => d.spreadPct)),
    bandPct: median(ds.map((d) => d.bandPct)),
    madPct: median(ds.map((d) => d.madPct)),
  });
}

const MEASURES = ['spreadPct', 'bandPct', 'madPct'];

// pooled (confounded) correlations
const pooled = {};
for (const m of MEASURES) {
  pooled[m] = spearman(perItem.map((r) => r.vol), perItem.map((r) => r[m]));
}
const volPrice = spearman(perItem.map((r) => r.vol), perItem.map((r) => r.price));
const pricePooled = {};
for (const m of MEASURES) {
  pricePooled[m] = spearman(perItem.map((r) => r.price), perItem.map((r) => r[m]));
}

// ── Within-price-decile correlations (the confound control — THE headline) ──
const byPrice = [...perItem].sort((x, y) => x.price - y.price);
const dec = [];
const size = Math.floor(byPrice.length / DECILES);
for (let i = 0; i < DECILES; i++) {
  const slice = byPrice.slice(i * size, i === DECILES - 1 ? byPrice.length : (i + 1) * size);
  if (slice.length < 10) continue;
  const row = {
    decile: i + 1, n: slice.length,
    priceLo: slice[0].price, priceHi: slice[slice.length - 1].price,
    medVol: median(slice.map((s) => s.vol)),
  };
  for (const m of MEASURES) {
    row[m] = spearman(slice.map((s) => s.vol), slice.map((s) => s[m]));
    row[`med_${m}`] = median(slice.map((s) => s[m]));
  }
  dec.push(row);
}

// ── Volume-quintile profile WITHIN each price decile (effect size, not just sign) ──
const quintProfile = [];
for (const i of [0, 4, 9]) {                      // cheap / mid / expensive decile
  const slice = byPrice.slice(i * size, i === DECILES - 1 ? byPrice.length : (i + 1) * size);
  if (slice.length < 20) continue;
  const byVol = [...slice].sort((x, y) => x.vol - y.vol);
  const q = Math.floor(byVol.length / 5);
  const qs = [];
  for (let k = 0; k < 5; k++) {
    const part = byVol.slice(k * q, k === 4 ? byVol.length : (k + 1) * q);
    qs.push({
      q: k + 1, n: part.length,
      medVol: median(part.map((s) => s.vol)),
      spreadPct: median(part.map((s) => s.spreadPct)),
      bandPct: median(part.map((s) => s.bandPct)),
    });
  }
  quintProfile.push({
    decile: i + 1,
    priceLo: slice[0].price, priceHi: slice[slice.length - 1].price,
    quintiles: qs,
  });
}

// ── Within-ITEM, day-to-day (does an item's OWN busy day have a thinner band?) ──
const withinItem = { spreadPct: [], bandPct: [], madPct: [] };
for (const id of keep) {
  const ds = P.filter((p) => p.itemId === id);
  if (ds.length < MIN_DAYS) continue;
  for (const m of MEASURES) {
    const r = spearman(ds.map((d) => d.vol), ds.map((d) => d[m]));
    if (r != null) withinItem[m].push(r);
  }
}

const out = {
  meta: {
    grain: GRAIN, itemDays: P.length, items: keep.size,
    minDays: MIN_DAYS, minHours: MIN_HOURS, minVol: MIN_VOL,
    dayRange: [
      new Date(Math.min(...P.map((p) => p.day)) * 86400000).toISOString().slice(0, 10),
      new Date(Math.max(...P.map((p) => p.day)) * 86400000).toISOString().slice(0, 10),
    ],
  },
  pooled, volPrice, pricePooled,
  deciles: dec,
  quintProfile,
  withinItem: Object.fromEntries(MEASURES.map((m) => [m, {
    n: withinItem[m].length,
    median: median(withinItem[m]),
    q25: quantile([...withinItem[m]].sort((x, y) => x - y), 0.25),
    q75: quantile([...withinItem[m]].sort((x, y) => x - y), 0.75),
    fracNegative: withinItem[m].filter((v) => v < 0).length / withinItem[m].length,
  }])),
};

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

console.log(`## Volume vs band width — ${out.meta.items} items · ${num(out.meta.itemDays)} item-days · ${out.meta.dayRange[0]} → ${out.meta.dayRange[1]} (${GRAIN})`);
console.log(`(Spearman rank correlations. spreadPct = per-hour bid-ask; bandPct = daily range; madPct = mean abs deviation from the day's median)\n`);

console.log(`### 1. POOLED cross-item correlation (CONFOUNDED — read section 2 instead)`);
console.log(`| measure | ρ(volume, measure) |`);
console.log(`| --- | ---: |`);
for (const m of MEASURES) console.log(`| ${m} | ${cor(pooled[m])} |`);
console.log(`\nρ(volume, price) = ${cor(volPrice)}  ← the confound: cheap items trade in bulk`);
for (const m of MEASURES) console.log(`ρ(price, ${m}) = ${cor(pricePooled[m])}`);

console.log(`\n### 2. WITHIN price decile (confound controlled — the headline)`);
console.log(`| decile | price range | n | med vol/d | ρ(vol,spread) | ρ(vol,band) | ρ(vol,mad) | med spread | med band |`);
console.log(`| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
for (const d of dec) {
  console.log(`| ${d.decile} | ${num(d.priceLo)}–${num(d.priceHi)} | ${d.n} | ${num(d.medVol)} | ${cor(d.spreadPct)} | ${cor(d.bandPct)} | ${cor(d.madPct)} | ${pct(d.med_spreadPct)} | ${pct(d.med_bandPct)} |`);
}

console.log(`\n### 3. Volume quintiles within a price decile (effect size)`);
for (const p of quintProfile) {
  console.log(`\nPrice decile ${p.decile} (${num(p.priceLo)}–${num(p.priceHi)} gp):`);
  console.log(`| vol quintile | n | med vol/d | med spread | med band |`);
  console.log(`| ---: | ---: | ---: | ---: | ---: |`);
  for (const q of p.quintiles) {
    console.log(`| Q${q.q} | ${q.n} | ${num(q.medVol)} | ${pct(q.spreadPct)} | ${pct(q.bandPct)} |`);
  }
}

console.log(`\n### 4. WITHIN-ITEM, day to day (does an item's own busy day run thinner?)`);
console.log(`| measure | items | median ρ | IQR | % negative |`);
console.log(`| --- | ---: | ---: | --- | ---: |`);
for (const m of MEASURES) {
  const w = out.withinItem[m];
  console.log(`| ${m} | ${w.n} | ${cor(w.median)} | ${cor(w.q25)}..${cor(w.q75)} | ${(w.fracNegative * 100).toFixed(0)}% |`);
}
console.log(`\n(descriptive of this window only; n≈1 archive period, no out-of-sample split)`);
