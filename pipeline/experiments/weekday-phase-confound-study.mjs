// PLAN-WEEKDAY-PHASE-CONFOUND §2 — motivating measurement, NOT the registered test (§3).
// Weekday-aligns the trend read to ask whether a fitted ceiling slope is confounded with weekly phase.
// Standalone: nothing imports this. Numbers live in the plan, not here.
//
//   node pipeline/experiments/weekday-phase-confound-study.mjs [--days 42] [--items <id,id,...>]

import { open } from '../lib/market/archive.mjs';

const ARCHIVE = 'pipeline/.market-archive.sqlite';
const BASKET = {
  11785: 'Armadyl crossbow',
  22477: 'Avernic defender hilt',
  24422: 'Nightmare staff',
  28310: 'Venator ring',
  26219: "Osmumten's fang",
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const days = Number(arg('--days', 42));
const itemsArg = arg('--items', null);
const items = itemsArg
  ? Object.fromEntries(itemsArg.split(',').map((s) => [Number(s.trim()), String(s.trim())]))
  : BASKET;

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

function dailyExtremes(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const d = new Date(r.ts * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let e = byDay.get(key);
    if (!e) { e = { hi: 0, lo: Infinity, dow: d.getDay() }; byDay.set(key, e); }
    if (r.hi) e.hi = Math.max(e.hi, r.hi);
    if (r.lo) e.lo = Math.min(e.lo, r.lo);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .filter((d) => d[1].hi > 0 && Number.isFinite(d[1].lo));
}

// Same-weekday week-over-week change in the daily HIGH: strips weekly phase by construction.
function weekOverWeek(dayList) {
  const out = [];
  for (let i = 7; i < dayList.length; i++) {
    const cur = dayList[i], prev = dayList[i - 7];
    if (cur[1].dow !== prev[1].dow) continue;
    out.push(((cur[1].hi - prev[1].hi) / prev[1].hi) * 100);
  }
  return out;
}

// Daily mid detrended against its own 7-day CENTERED mean, bucketed by weekday.
// Centered (not trailing) on purpose: this measures phase shape, it is not a tradeable signal.
function detrendedByWeekday(dayList) {
  const mids = dayList.map((d) => (d[1].hi + d[1].lo) / 2);
  const dev = [];
  for (let i = 3; i < dayList.length - 3; i++) {
    const cm = mean(mids.slice(i - 3, i + 4));
    dev.push({ dow: dayList[i][1].dow, d: ((mids[i] - cm) / cm) * 100 });
  }
  return dev;
}

const db = open(ARCHIVE, { readonly: true });
const now = Math.floor(Date.now() / 1000);
const since = now - days * 86400;

console.log(`# weekday-phase confound — ${days}d, 1h archive (PLAN-WEEKDAY-PHASE-CONFOUND §2)`);
console.log('# motivating only: overlapping centered means ⇒ serial dependence, t-values optimistic\n');

for (const [id, name] of Object.entries(items)) {
  const rows = db.db.prepare(
    `SELECT ts, avgHighPrice hi, avgLowPrice lo FROM observations
     WHERE grain='1h' AND itemId=? AND ts >= ? ORDER BY ts`,
  ).all(Number(id), since);
  if (!rows.length) { console.log(`${name}: no archive rows`); continue; }

  const dayList = dailyExtremes(rows);
  const wow = weekOverWeek(dayList);
  if (wow.length < 2) { console.log(`${name}: too few weekday-matched pairs (${wow.length})`); continue; }

  const m = mean(wow);
  const t = m / (sd(wow) / Math.sqrt(wow.length));
  const dev = detrendedByWeekday(dayList);
  const we = dev.filter((x) => x.dow === 0 || x.dow === 6).map((x) => x.d);
  const tue = dev.filter((x) => x.dow === 2).map((x) => x.d);
  const gap = mean(we) - mean(tue);
  const sign = (v) => (v >= 0 ? '+' : '');

  console.log(
    `${name.padEnd(24)} WoW same-weekday high: ${sign(m)}${m.toFixed(2)}%/wk  t=${t.toFixed(2)} (n=${wow.length})` +
    ` | detrended weekend ${sign(mean(we))}${mean(we).toFixed(2)}%` +
    ` vs Tue ${sign(mean(tue))}${mean(tue).toFixed(2)}%  gap ${sign(gap)}${gap.toFixed(2)}pp`,
  );
}
