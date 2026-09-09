#!/usr/bin/env node
/**
 * dislocation.test.mjs — acceptance fixtures for WK4's pure dislocation read
 * (lib/signal/dislocation.mjs). Synthetic series only (rule 4 — no live data).
 * Run: `node pipeline/test/dislocation.test.mjs` (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - Taxonomy is the WK3 pre-registered rule set, first match wins (a potion-suffixed name that
 *     also matches a later rule stays potion-dose; big-ticket outranks every name rule).
 *   - The trailing reference EXCLUDES today (strictly trailing — the lookahead trap) and refuses
 *     to read below 12 of 15 prior days, below 3 hourly rows today, or on stale data.
 *   - Table lookup returns null (silence) for unclassified items, unresolved classes' deep cells
 *     (potion-dose/bulk-commodity/rune), and depths with no BH-significant cell — absence is
 *     absence, never zero.
 *   - bigticket deep reads carry lane:'owned' (the no-double-count annotation).
 *   - waitSavesGp inverts the after-tax cell correctly and returns null when waiting saves nothing.
 */
import assert from 'node:assert/strict';
import {
  classifyItem, dailyMidsFrom1h, trailingDeviation, dislocationRead, waitSavesGp,
  DISLOCATION_TABLE, TAX,
} from '../lib/signal/dislocation.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// Build an archive-shaped 1h series: `days` of hourly rows ending "now", per-day mid via midFor(dayIdxFromEnd).
// dayIdxFromEnd: 0 = today (partial, `todayHours` rows), 1 = yesterday, …
function series({ days = 20, midFor = () => 100, todayHours = 6, nowMs = Date.UTC(2026, 8, 8, 20, 0, 0), skipDays = [] } = {}) {
  const rows = [];
  const dayMs = 86400000;
  for (let back = days; back >= 0; back--) {
    if (skipDays.includes(back)) continue;
    const mid = midFor(back);
    const d0 = new Date(nowMs - back * dayMs);
    const localMidnight = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
    // today: rows end AT `nowMs` (fresh); prior days: a full 24 hourly rows inside that local day
    const hourList = back === 0
      ? Array.from({ length: todayHours }, (_, i) => nowMs - (todayHours - 1 - i) * 3600000)
      : Array.from({ length: 24 }, (_, i) => localMidnight + i * 3600000);
    for (const t of hourList) rows.push({ timestamp: Math.floor(t / 1000), avgHighPrice: mid + 1, avgLowPrice: mid - 1 });
  }
  return rows;
}
const NOW = Date.UTC(2026, 8, 8, 20, 0, 0);

ok('taxonomy: first match wins + metadata rules', () => {
  assert.equal(classifyItem({ name: 'Saradomin brew(4)', limit: 2000, eraMid: 5000 }), 'potion-dose');
  assert.equal(classifyItem({ name: 'Death rune', limit: 25000, eraMid: 200 }), 'rune');
  assert.equal(classifyItem({ name: 'Ruby dragon bolts (e)', limit: 11000, eraMid: 4000 }), 'ammo');
  assert.equal(classifyItem({ name: 'Grimy ranarr weed', limit: 13000, eraMid: 7000 }), 'herb');
  assert.equal(classifyItem({ name: 'Torstol', limit: 13000, eraMid: 8000 }), 'herb');       // clean-herb list
  assert.equal(classifyItem({ name: 'Dragon bones', limit: 13000, eraMid: 2500 }), 'bones-ashes');
  assert.equal(classifyItem({ name: 'Osmumten’s fang', limit: 8, eraMid: 30e6 }), 'bigticket-lowlimit'); // metadata beats name rules
  assert.equal(classifyItem({ name: 'Malediction ward', limit: 70, eraMid: 2e5 }), 'midvalue-lowlimit');
  assert.equal(classifyItem({ name: 'Jug', limit: 13000, eraMid: 5 }), 'bulk-commodity');
  assert.equal(classifyItem({ name: 'Rune scimitar', limit: 70, eraMid: 15000 }), 'unclassified');
});

ok('daily mids: local-day grouping, null-price rows dropped', () => {
  const { days } = dailyMidsFrom1h([
    { timestamp: Math.floor(NOW / 1000) - 3600, avgHighPrice: 102, avgLowPrice: 98 },
    { timestamp: Math.floor(NOW / 1000) - 7200, avgHighPrice: null, avgLowPrice: 98 },   // dropped
  ]);
  assert.equal(days.length, 1);
  assert.equal(days[0].mid, 100);
  assert.equal(days[0].n, 1);
});

ok('trailing reference excludes today (strictly trailing)', () => {
  // 15 prior days at 100, today crashed to 90: dev must be vs 100, untouched by today's mid.
  const s = series({ midFor: b => b === 0 ? 90 : 100 });
  const { days } = dailyMidsFrom1h(s);
  const dev = trailingDeviation(days, NOW);
  assert.ok(dev && Math.abs(dev.devPct - (-10)) < 0.01, `dev ${dev && dev.devPct}`);
  assert.ok(Math.abs(dev.ref - 100) < 1e-9);
});

ok('valid-day floor: < 12 of 15 prior days → null', () => {
  const s = series({ midFor: () => 100, skipDays: [2, 3, 4, 5] });   // 11 of 15 prior days
  const { days } = dailyMidsFrom1h(s);
  assert.equal(trailingDeviation(days, NOW), null);
});

ok('today needs ≥ 3 hourly rows', () => {
  const s = series({ midFor: () => 100, todayHours: 2 });
  const { days } = dailyMidsFrom1h(s);
  assert.equal(trailingDeviation(days, NOW), null);
});

ok('stale series (newest row > 6h old) → silence', () => {
  const s = series({ midFor: b => b === 0 ? 90 : 100 });
  assert.equal(dislocationRead({ series1h: s, name: 'Grimy ranarr weed', limit: 13000, nowMs: NOW + 7 * 3600000 }), null);
});

ok('deep herb read: beyond-lane cell + note carries lag/vol', () => {
  const s = series({ midFor: b => b === 0 ? 90 : 100 });
  const r = dislocationRead({ series1h: s, name: 'Grimy ranarr weed', limit: 13000, nowMs: NOW });
  assert.ok(r && r.state === 'deep' && r.bucket === 'deep7' && r.cls === 'herb' && r.lane === 'beyond');
  assert.equal(r.cell.lag, DISLOCATION_TABLE.herb.deep.deep7.lag);
});

ok('absent cell is silence: herb at −3% (no (−4,−2] cell) → null', () => {
  const s = series({ midFor: b => b === 0 ? 97 : 100 });
  assert.equal(dislocationRead({ series1h: s, name: 'Grimy ranarr weed', limit: 13000, nowMs: NOW }), null);
});

ok('unresolved class deep is silence; its elevated cell still reads', () => {
  const deep = series({ midFor: b => b === 0 ? 90 : 100 });
  assert.equal(dislocationRead({ series1h: deep, name: 'Saradomin brew(4)', limit: 2000, nowMs: NOW }), null);
  const hi = series({ midFor: b => b === 0 ? 105 : 100 });
  const r = dislocationRead({ series1h: hi, name: 'Saradomin brew(4)', limit: 2000, nowMs: NOW });
  assert.ok(r && r.state === 'elevated' && r.cls === 'potion-dose');
});

ok('bigticket deep carries lane:owned', () => {
  const s = series({ midFor: b => b === 0 ? 9.2e6 : 10e6 });
  const r = dislocationRead({ series1h: s, name: 'Avernic defender hilt', limit: 8, nowMs: NOW });
  assert.ok(r && r.state === 'deep' && r.lane === 'owned');
});

ok('unclassified is silence at any depth', () => {
  const s = series({ midFor: b => b === 0 ? 90 : 100 });
  assert.equal(dislocationRead({ series1h: s, name: 'Rune scimitar', limit: 70, nowMs: NOW }), null);
});

ok('waitSavesGp arithmetic: after-tax cell inverts to a price drop', () => {
  // cond = −6.07% ⇒ m4/m0 = 0.9385/0.98… ⇒ save = m0·(1 − (1+cond/100)/TAX)
  const save = waitSavesGp(1000, -6.07);
  assert.ok(Math.abs(save - 1000 * (1 - (1 - 0.0607) / TAX)) < 1e-9);
  assert.equal(waitSavesGp(1000, 0), null);   // waiting saves nothing when the class mean is flat
});

console.log(`dislocation.test.mjs: ${pass} assertions passed`);
