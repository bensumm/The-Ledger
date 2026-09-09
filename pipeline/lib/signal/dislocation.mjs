/**
 * dislocation.mjs — WK4 (PLAN-WEEKLY-CYCLE, folded — full text via `git show 6d0d970:plans/PLAN-WEEKLY-CYCLE.md`): the inform-only dislocation/yield read.
 * "Is this price dislocated vs the item's own trailing level, and what conditional yield did WK3
 * measure for its class from that state?" Pure math — DOM/fetch/fs-free; callers hand in an
 * archive-shaped 1h series (archiveSeries(...) rows keyed `timestamp`).
 *
 * EVERY number in DISLOCATION_TABLE is a measured constant from pipeline/experiments/
 * wk3-class-cycle-study.mjs (era 2026-05-28→2026-09-08, 104d, one season; regenerated and
 * verified byte-identical before this module was written). Cells carried:
 *   - DEEP buy cells: ONLY classes robust under the trailing (non-lookahead) beyond-lane split,
 *     and ONLY their BH-significant registered decision cells. potion-dose and bulk-commodity are
 *     deliberately ABSENT (unresolved — magnitudes held, significance failed the trailing split);
 *     rune is ABSENT (lane-increment items floor). bigticket-lowlimit carries lane:'owned' — the
 *     amplitude lane already prices that trough; its annotation must never read as a second edge.
 *   - ELEVATED (≥+4%) sell/wait cells: descriptive (NOT BH-registered — the registered cells were
 *     deep×4d only), carried where p≤0.05 two-sided on ≥15 items.
 *   - `lag` (enter NEXT day's mid — the honest actionable magnitude), `vol` (day-t traded gp ≥
 *     the item's own median — the executability check; the deep edge is volume-fragile), `adv`
 *     (same-day, descriptive upper bound), `cond` (raw class-conditional 4d net, drives the
 *     elevated wait-savings arithmetic), `hold` (the study's --transitions measurement: % of
 *     first-6h partial-mean reads still in the same bucket at full-day close — deep7 86–91% and
 *     elevated 69–88% quote cleanly at read time; deep4/deep2 run 41–74%, so those rendered lines
 *     carry the hold clause). All % after 2% tax, mid-to-mid — NOT executable prices.
 * DOCTRINE: inform-only. Nothing here may gate, size, re-rank, or move a suggested price.
 */

export const TAX = 0.98;
export const TRAIL_DAYS = 15;              // strictly-trailing reference window (Test Y)
export const TRAIL_MIN_DAYS = 12;          // ≥12 of 15 prior days present, else no read
export const TODAY_MIN_ROWS = 3;           // partial-day current mean needs ≥3 hourly rows
export const FRESH_MAX_H = 6;              // newest row older than this → stale, no read (1h buckets + daemon tick already lag ~1–2h healthy)
export const HORIZON_DAYS = 4;             // the registered decision horizon (say "~4d", never "2 days")

// Taxonomy — verbatim from the WK3 pre-registration (first match wins; metadata only).
export const CLEAN_HERBS = ['Guam leaf', 'Marrentill', 'Tarromin', 'Harralander', 'Ranarr weed', 'Toadflax',
  'Irit leaf', 'Avantoe', 'Kwuarm', 'Snapdragon', 'Cadantine', 'Lantadyme', 'Dwarf weed', 'Torstol'];
export function classifyItem({ name, limit = null, eraMid = 0 }) {
  const n = String(name || '');
  if (eraMid >= 5e6 && limit != null && limit <= 15) return 'bigticket-lowlimit';
  if (/\(\d\)$/.test(n)) return 'potion-dose';
  if (/ rune$/i.test(n)) return 'rune';
  if (/(bolts?( ?\(e\))?$|arrows?( ?\(p\+*\))?$|darts?$|javelins?$|cannonball$|bolt tips$|arrowtips$|dart tips?$)/i.test(n)) return 'ammo';
  if (/( seed| sapling)s?$/i.test(n)) return 'seed-sapling';
  if (/^grimy /i.test(n) || CLEAN_HERBS.includes(n)) return 'herb';
  if (/(bones|ashes)$/i.test(n)) return 'bones-ashes';
  if (/( ore$| bar$|logs$| plank$|^uncut |^raw )/i.test(n) || /(hide$|leather$)/i.test(n)) return 'raw-material';
  if (eraMid >= 1e5 && limit != null && limit <= 70) return 'midvalue-lowlimit';
  if (limit != null && limit >= 1000) return 'bulk-commodity';
  return 'unclassified';
}

// Deep buckets by label: deep7 = ≤−7%, deep4 = (−7,−4], deep2 = (−4,−2].
export const DISLOCATION_TABLE = {
  'bigticket-lowlimit': {
    lane: 'owned',
    deep: { deep7: { adv: 1.81, lag: 2.43, lagT: 10.4, vol: 1.19, volT: 3.3, t: 8.55, nItems: 81, hold: 91 } },
    elevated: { adv: -1.06, cond: -3.25, t: -5.61, nItems: 96, hold: 88 },
  },
  'ammo': {
    lane: 'beyond',
    deep: { deep7: { adv: 4.76, lag: 3.26, lagT: 4.7, vol: 0.62, volT: 0.7, t: 5.69, nItems: 93, hold: 86 } },
    elevated: { adv: -5.53, cond: -6.07, t: -6.66, nItems: 100, hold: 76 },
  },
  'herb': {
    lane: 'beyond',
    deep: { deep7: { adv: 3.23, lag: 3.35, lagT: 8.0, vol: 2.17, volT: 2.3, t: 5.02, nItems: 23, hold: 87 } },
    elevated: { adv: -1.98, cond: -3.78, t: -3.51, nItems: 23, hold: 82 },
  },
  'bones-ashes': {
    lane: 'beyond',
    deep: { deep2: { adv: 1.46, lag: 0.74, lagT: 2.1, vol: 0.77, volT: 2.0, t: 4.31, nItems: 21, hold: 49 } },
    elevated: { adv: -7.01, cond: -5.42, t: -3.06, nItems: 24, hold: 79 },
  },
  'midvalue-lowlimit': {
    lane: 'beyond',
    deep: {
      deep7: { adv: 1.78, lag: 1.57, lagT: 8.4, vol: 0.02, volT: 0.1, t: 8.32, nItems: 208, hold: 89 },
      deep4: { adv: 1.32, lag: 1.09, lagT: 3.1, vol: 0.03, volT: 0.1, t: 4.08, nItems: 217, hold: 60 },
      deep2: { adv: 0.56, lag: 0.23, lagT: 1.2, vol: 0.33, volT: 1.6, t: 3.14, nItems: 225, hold: 53 },
    },
    elevated: { adv: -3.04, cond: -5.33, t: -11.71, nItems: 211, hold: 84 },
  },
  'potion-dose': { lane: 'unresolved', deep: {}, elevated: { adv: -7.52, cond: -3.58, t: -4.89, nItems: 150, hold: 77 } },
  'bulk-commodity': { lane: 'unresolved', deep: {}, elevated: { adv: -8.83, cond: -3.66, t: -3.22, nItems: 550, hold: 81 } },
  'rune': { lane: 'unresolved', deep: {}, elevated: { adv: -2.40, cond: -4.11, t: -3.80, nItems: 17, hold: 69 } },
};

// 1h archive rows → local-calendar daily mean mids (the study's grain), ascending [{di, mid, n}].
export function dailyMidsFrom1h(series) {
  const byDay = new Map();
  let lastTs = null;
  for (const r of (series || [])) {
    if (r == null || r.timestamp == null || r.avgHighPrice == null || r.avgLowPrice == null) continue;
    const d = new Date(r.timestamp * 1000);
    const di = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 86400000);
    const e = byDay.get(di) || { s: 0, n: 0 };
    e.s += (r.avgHighPrice + r.avgLowPrice) / 2; e.n++;
    byDay.set(di, e);
    if (lastTs == null || r.timestamp > lastTs) lastTs = r.timestamp;
  }
  const days = [...byDay].sort((a, b) => a[0] - b[0]).map(([di, e]) => ({ di, mid: e.s / e.n, n: e.n }));
  return { days, lastTs };
}

// Deviation of today's partial-day mean vs the trailing TRAIL_DAYS complete prior days.
export function trailingDeviation(days, nowMs) {
  const d = new Date(nowMs);
  const todayDi = Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 86400000);
  const today = days.find(x => x.di === todayDi);
  if (!today || today.n < TODAY_MIN_ROWS || today.mid <= 0) return null;
  let s = 0, n = 0;
  for (const x of days) if (x.di >= todayDi - TRAIL_DAYS && x.di < todayDi) { s += x.mid; n++; }
  if (n < TRAIL_MIN_DAYS) return null;
  const ref = s / n;
  return { devPct: (today.mid / ref - 1) * 100, ref, current: today.mid, nPrior: n };
}

const bucketOf = dev => dev <= -7 ? 'deep7' : dev <= -4 ? 'deep4' : dev <= -2 ? 'deep2' : dev >= 4 ? 'elevated' : null;

/** The one composed read. Returns null (silence) for: unclassified, no measured cell for the
 * state, neutral deviation, stale/thin archive data. Never throws on bad input. */
export function dislocationRead({ series1h, name, limit = null, nowMs = Date.now() }) {
  try {
    const { days, lastTs } = dailyMidsFrom1h(series1h);
    if (lastTs == null || (nowMs / 1000 - lastTs) > FRESH_MAX_H * 3600) return null;
    const dev = trailingDeviation(days, nowMs);
    if (!dev) return null;
    const eraMid = days.length ? days.reduce((s, x) => s + x.mid, 0) / days.length : 0;
    const cls = classifyItem({ name, limit, eraMid });
    const entry = DISLOCATION_TABLE[cls];
    if (!entry) return null;
    const b = bucketOf(dev.devPct);
    if (!b) return null;
    if (b === 'elevated') {
      if (!entry.elevated) return null;
      return { cls, state: 'elevated', bucket: b, cell: entry.elevated, lane: entry.lane, ...dev };
    }
    const cell = entry.deep[b];
    if (!cell) return null;
    return { cls, state: 'deep', bucket: b, cell, lane: entry.lane, ...dev };
  } catch { return null; }
}

// Waiting-saves arithmetic: cond = (TAX·m4 − m0)/m0·100 ⇒ m4/m0 = (1 + cond/100)/TAX.
export function waitSavesGp(current, condPct) {
  const ratio = (1 + condPct / 100) / TAX;
  const save = current * (1 - ratio);
  return save > 0 ? save : null;
}

const pp = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`;

/** Render the note line (callers push it under their own note kind/sigil). fmt = gp formatter. */
export function formatDislocation(info, { fmt = v => String(Math.round(v)) } = {}) {
  if (!info) return null;
  const devTxt = `${info.devPct >= 0 ? '+' : ''}${info.devPct.toFixed(1)}% vs trailing 15d mean`;
  if (info.state === 'elevated') {
    const save = waitSavesGp(info.current, info.cell.cond);
    const saveTxt = save != null ? ` → waiting ~${HORIZON_DAYS}d ≈ ${fmt(save)} gp/u cheaper` : '';
    return `elevated ${devTxt} — ${info.cls} class measured ${info.cell.cond.toFixed(1)}% mean 4d net from here${saveTxt} (class-conditional mean, descriptive cell — inform-only, one era)`;
  }
  if (info.lane === 'owned') {
    return `dislocated ${devTxt} — big-ticket class: the amplitude lane already prices this trough (lane-owned, no double-count; at-volume ${pp(info.cell.vol)}/4d t=${info.cell.volT} is the one class figure that survives the volume condition)`;
  }
  // K1: shallow buckets (deep4/deep2) are coin-flips intraday — an early partial-day read holds its
  // bucket at close only ~41–74% of the time (--transitions), so the line says so. deep7 holds 86–91%.
  const holdTxt = (info.bucket !== 'deep7' && info.cell.hold != null)
    ? `; intraday read — this bucket holds ~${info.cell.hold}% by close (a dissolve ≈ baseline entry)` : '';
  return `dislocated ${devTxt} — ${info.cls} class measured ${pp(info.cell.lag)}/4d vs baseline entering next day (t=${info.cell.lagT}; at-volume ${pp(info.cell.vol)} t=${info.cell.volT}, n=${info.cell.nItems} items${holdTxt}) — class-conditional, inform-only, one era`;
}
