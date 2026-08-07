/* edge-map-lib.mjs — shared panel/stats helpers for the EDGE-MAP study (2026-08-04).

   Extracted so the four EDGE-MAP workstreams (edge-map-study.mjs) share ONE panel build and
   ONE set of measure definitions, byte-compatible with the prior volume-vs-band study:
     spreadPct — median over the day of per-hour (avgHighPrice − avgLowPrice) / mid
     bandPct   — (day max avgHighPrice − day min avgLowPrice) / dayMid
     madPct    — mean |hourMid − dayMedianMid| / dayMedianMid
   plus the NEW robustified measures this study needs:
     trimBandPct   — (2nd-highest hi − 2nd-lowest lo) / dayMid  (drops ONE extreme print/side)
     robustBandPct — (q90 of hourly highs − q10 of hourly lows) / dayMid
     edgePct       — (q90hi − tax(q90hi) − q10lo) / dayMid — the REALIZABLE after-tax robust
                     edge, using the canonical tax() from js/quotecore.js (the ONE tax impl).
     depthTop/Bot  — the instabuy/instasell VOLUME printed in the single hour that set the
                     day's max-high / min-low (how many units the band extreme was good for).
     early/rest    — UTC hours 0–5 vs 6–23 split for the intraday-lead test (workstream C).

   Day keys are UTC days (analysis keys, not rendered timestamps — same convention as the
   flow-crossover study; the app's local-display rule doesn't apply). Read-only against the
   /1h SQLite archive; no writes, no fetches. Removable per this directory's README. */

import fs from 'node:fs';
import pathMod from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from '../lib/market/archive.mjs';
import { breakEven, tax } from '../../js/quotecore.js';

export { breakEven, tax };

const HERE = pathMod.dirname(fileURLToPath(import.meta.url));
export const ROOT = pathMod.join(HERE, '..', '..');

// ── stats ────────────────────────────────────────────────────────────────────
export function rank(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(a, b) {
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

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

// ── formatting ───────────────────────────────────────────────────────────────
export const pct = (v, d = 2) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
export const num = (v) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
export const cor = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3));
export const gp = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}b`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}m`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v).toLocaleString('en-US')}`;
};

// ── the item-day panel ───────────────────────────────────────────────────────
/* buildDayPanel({ minHours }) → array of item-day rows. A row requires ≥ minHours hours in
   which BOTH avgHighPrice and avgLowPrice printed (two-sided hours) — same qualification as
   the prior study, so bandPct/spreadPct/madPct medians are directly comparable. NOTE the
   censoring this implies: a thin item's sparse days drop out, so thin-item stats describe
   their MORE-ACTIVE days (stated in the findings). */
export function buildDayPanel({ minHours = 12, grain = '1h', onProgress = null } = {}) {
  const a = open(undefined, { readonly: true });
  const stmt = a.db.prepare(`
    SELECT itemId, ts, avgHighPrice AS hi, avgLowPrice AS lo,
           highPriceVolume AS hv, lowPriceVolume AS lv
    FROM observations
    WHERE grain = ? AND avgHighPrice IS NOT NULL AND avgLowPrice IS NOT NULL
          AND avgHighPrice > 0 AND avgLowPrice > 0
    ORDER BY itemId, ts
  `);
  const iter = stmt.iterate ? stmt.iterate(grain) : stmt.all(grain);

  const panel = [];
  let cur = null, nRows = 0;

  const flush = () => {
    if (!cur) return;
    const d = finishDay(cur, minHours);
    if (d) panel.push(d);
    cur = null;
  };

  for (const r of iter) {
    nRows++;
    if (onProgress && nRows % 1e6 === 0) onProgress(nRows);
    const day = Math.floor(r.ts / 86400);
    if (!cur || cur.itemId !== r.itemId || cur.day !== day) {
      flush();
      cur = { itemId: r.itemId, day, hrs: [] };
    }
    cur.hrs.push(r);
  }
  flush();
  a.close();
  return panel;
}

function finishDay(d, minHours) {
  if (d.hrs.length < minHours) return null;
  let maxHi = -Infinity, minLo = Infinity, hv = 0, lv = 0, depthTop = 0, depthBot = 0;
  const mids = [], spreads = [], his = [], los = [];
  let earlyHv = 0, earlyLv = 0, nEarly = 0;
  const restHis = [], restLos = [], restMids = [];
  for (const h of d.hrs) {
    if (h.hi > maxHi) { maxHi = h.hi; depthTop = h.hv || 0; }
    if (h.lo < minLo) { minLo = h.lo; depthBot = h.lv || 0; }
    hv += h.hv || 0; lv += h.lv || 0;
    const mid = (h.hi + h.lo) / 2;
    mids.push(mid); his.push(h.hi); los.push(h.lo);
    if (mid > 0) spreads.push((h.hi - h.lo) / mid);
    const hour = Math.floor((h.ts % 86400) / 3600);
    if (hour < 6) { earlyHv += h.hv || 0; earlyLv += h.lv || 0; nEarly++; }
    else { restHis.push(h.hi); restLos.push(h.lo); restMids.push(mid); }
  }
  const dayMid = median(mids);
  if (!dayMid || dayMid <= 0) return null;
  const rHi = quantile(his, 0.9), rLo = quantile(los, 0.1);
  const sh = [...his].sort((a, b) => b - a), sl = [...los].sort((a, b) => a - b);
  const trimBandPct = his.length >= 4 ? (sh[1] - sl[1]) / dayMid : null;
  const vol = hv + lv;

  // rest-of-day (UTC 6–23) robust band — the intraday-lead outcome. Needs ≥8 rest hours.
  let restBandPct = null, restEdgePct = null;
  if (restHis.length >= 8) {
    const rm = median(restMids);
    if (rm > 0) {
      const rrHi = quantile(restHis, 0.9), rrLo = quantile(restLos, 0.1);
      restBandPct = (Math.max(...restHis) - Math.min(...restLos)) / rm;
      restEdgePct = (rrHi - tax(Math.round(rrHi)) - rrLo) / rm;
    }
  }
  return {
    itemId: d.itemId, day: d.day, nHours: d.hrs.length,
    price: dayMid, vol, minSide: Math.min(hv, lv), hv, lv,
    imb: vol > 0 ? Math.abs(hv - lv) / vol : null,
    spreadPct: median(spreads),
    bandPct: (maxHi - minLo) / dayMid,
    madPct: mids.reduce((s, m) => s + Math.abs(m - dayMid), 0) / mids.length / dayMid,
    trimBandPct,
    robustBandPct: (rHi - rLo) / dayMid,
    edgePct: (rHi - tax(Math.round(rHi)) - rLo) / dayMid,
    rawEdgePct: (maxHi - tax(maxHi) - minLo) / dayMid,
    depthTop, depthBot,
    earlyVol: nEarly >= 3 ? earlyHv + earlyLv : null,
    restBandPct, restEdgePct,
  };
}

/* loadOrBuildPanel — buildDayPanel with a JSONL disk cache (pipeline/.cache/, gitignored) so
   the four workstreams / repeat runs don't re-walk ~4.9M archive rows each invocation. Line 1
   is a meta header; a minHours mismatch or --no-cache forces a rebuild. */
export function loadOrBuildPanel({ minHours = 12, cachePath, force = false, onProgress = null } = {}) {
  const cp = cachePath || pathMod.join(ROOT, 'pipeline', '.cache', 'edge-map-panel.jsonl');
  if (!force && fs.existsSync(cp)) {
    try {
      const lines = fs.readFileSync(cp, 'utf8').split('\n').filter(Boolean);
      const meta = JSON.parse(lines[0]);
      if (meta.minHours === minHours) return lines.slice(1).map((l) => JSON.parse(l));
    } catch { /* fall through to rebuild */ }
  }
  const panel = buildDayPanel({ minHours, onProgress });
  try {
    fs.mkdirSync(pathMod.dirname(cp), { recursive: true });
    fs.writeFileSync(cp, [JSON.stringify({ minHours, builtAt: new Date().toISOString(), rows: panel.length })]
      .concat(panel.map((p) => JSON.stringify(p))).join('\n'));
  } catch { /* cache write is best-effort */ }
  return panel;
}

/* annotateRegimes(panel) — adds `regime` (rising | flat | falling | null) to each row:
   trailing mid(day−1) vs mid(day−7) (nearest available within ±1 day of each anchor),
   thresholds ±3%. Trailing-only — no same-day or future data → safe for as-of joins. */
export function annotateRegimes(panel, thr = 0.03) {
  const byItem = new Map();
  for (const p of panel) {
    let m = byItem.get(p.itemId);
    if (!m) { m = new Map(); byItem.set(p.itemId, m); }
    m.set(p.day, p.price);
  }
  const near = (m, day) => m.get(day) ?? m.get(day - 1) ?? m.get(day + 1) ?? null;
  for (const p of panel) {
    const m = byItem.get(p.itemId);
    const p1 = m.get(p.day - 1) ?? m.get(p.day - 2) ?? null;
    const p7 = near(m, p.day - 7);
    if (p1 == null || p7 == null || p7 <= 0) { p.regime = null; continue; }
    const slope = p1 / p7 - 1;
    p.regime = slope >= thr ? 'rising' : slope <= -thr ? 'falling' : 'flat';
  }
  return panel;
}

// ── per-item aggregates (medians over the item's qualifying days) ────────────
export function perItemAgg(panel, minDays = 40) {
  const byItem = new Map();
  for (const p of panel) {
    let arr = byItem.get(p.itemId);
    if (!arr) { arr = []; byItem.set(p.itemId, arr); }
    arr.push(p);
  }
  const out = [];
  for (const [itemId, ds] of byItem) {
    if (ds.length < minDays) continue;
    const g = (k) => median(ds.map((d) => d[k]).filter((v) => v != null));
    const clearFrac = (t) => ds.filter((d) => d.edgePct != null && d.edgePct >= t).length / ds.length;
    out.push({
      itemId, days: ds.length,
      medPrice: g('price'), medVol: g('vol'), medMinSide: g('minSide'),
      medNHours: g('nHours'), medSpread: g('spreadPct'), medBand: g('bandPct'),
      medTrimBand: g('trimBandPct'), medRobustBand: g('robustBandPct'),
      medEdge: g('edgePct'), medRawEdge: g('rawEdgePct'),
      clearFrac1: clearFrac(0.01), clearFrac2: clearFrac(0.02),
      medDepthTop: g('depthTop'), medDepthBot: g('depthBot'), medImb: g('imb'),
      gpFlow: g('minSide') * g('price'),
    });
  }
  return out;
}

/* equal-count bins over a per-item field. Returns { cuts, of } — `cuts[i]` is the max value
   in bin i (ascending); `of(v)` maps any value to a 1-based bin. */
export function makeBins(items, key, nBins) {
  const sorted = items.map((r) => r[key]).filter((v) => v != null).sort((a, b) => a - b);
  const size = Math.floor(sorted.length / nBins);
  const cuts = [];
  for (let i = 0; i < nBins; i++) {
    cuts.push(i === nBins - 1 ? Infinity : sorted[(i + 1) * size - 1]);
  }
  const of = (v) => {
    if (v == null) return null;
    for (let i = 0; i < nBins; i++) if (v <= cuts[i]) return i + 1;
    return nBins;
  };
  return { cuts, of };
}

// ── repo-artifact loaders ────────────────────────────────────────────────────
export function loadClosedLots() {
  const p = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'positions.json'), 'utf8'));
  return p.closed || [];
}

export function loadNames() {
  try {
    const m = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
    const out = new Map();
    for (const [id, v] of Object.entries(m)) if (v && v.name) out.set(Number(id), v.name);
    return out;
  } catch { return new Map(); }
}

export function loadScreenIds() {
  try {
    const s = JSON.parse(fs.readFileSync(pathMod.join(ROOT, 'screen.json'), 'utf8'));
    const ids = new Set();
    for (const niche of Object.values(s.niches || {})) {
      const rows = niche.rows || niche;
      if (Array.isArray(rows)) for (const r of rows) if (r && r.id) ids.add(r.id);
    }
    return ids;
  } catch { return new Set(); }
}
