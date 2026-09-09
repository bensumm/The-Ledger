// PLAN-WEEKDAY-PHASE-CONFOUND §7a-CORRECTED — lane split of the closed record.
// Era-split, win/loss decomposed, weekday keyed to BOTH buy and sell and split same-day vs
// multi-day: pooling all eras and reporting net totals reversed the conclusion once already.
// Hold duration is still ENDOGENOUS (losers get held) — descriptive, never causal.
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync(new URL('../../positions.json', import.meta.url), 'utf8'));

const lots = p.closed
  .filter((l) => l.buyTs && l.sellTs && l.sellTs > l.buyTs && !l.banked)
  .map((l) => ({ ...l, cap: l.buyEach * l.qty, hrs: (l.sellTs - l.buyTs) / 3600 }))
  .filter((l) => l.cap > 0)
  .sort((a, b) => a.sellTs - b.sellTs);

const M = (n) => { const s = n < 0 ? '-' : ''; const a = Math.abs(n);
  return s + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'm' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'k' : Math.round(a)); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const iso = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BUCKETS = [['<3h', 0, 3], ['3-12h', 3, 12], ['12-24h', 12, 24], ['1-2d', 24, 48], ['2-7d', 48, 168], ['>7d', 168, Infinity]];

console.log(`record spans ${iso(lots[0].sellTs)} → ${iso(lots[lots.length - 1].sellTs)}, n=${lots.length}`);

// ---- 1. Win/loss DECOMPOSITION: totals hide the winners.
console.log('\n## 1. Win/loss decomposition by hold bucket (all eras)');
console.log('bucket   n    win/loss   sum(wins)   sum(losses)  biggest win  biggest loss  net');
for (const [label, lo, hi] of BUCKETS) {
  const b = lots.filter((l) => l.hrs >= lo && l.hrs < hi);
  if (!b.length) continue;
  const w = b.filter((l) => l.realised > 0), ls = b.filter((l) => l.realised < 0);
  const bw = w.length ? w.reduce((a, x) => (x.realised > a.realised ? x : a)) : null;
  const bl = ls.length ? ls.reduce((a, x) => (x.realised < a.realised ? x : a)) : null;
  console.log(label.padEnd(8), String(b.length).padEnd(4),
    `${w.length}/${ls.length}`.padEnd(10),
    M(sum(w.map((l) => l.realised))).padEnd(11),
    M(sum(ls.map((l) => l.realised))).padEnd(12),
    (bw ? M(bw.realised) : '-').padEnd(12),
    (bl ? M(bl.realised) : '-').padEnd(13),
    M(sum(b.map((l) => l.realised))));
}

// ---- 2. ERA split: the record is not stationary.
const mid = Math.floor(lots.length / 2);
const eras = [['EARLY half', lots.slice(0, mid)], ['LATE half', lots.slice(mid)]];
const last30 = lots.filter((l) => l.sellTs > lots[lots.length - 1].sellTs - 30 * 86400);
eras.push(['LAST 30 DAYS', last30]);
for (const [name, set] of eras) {
  console.log(`\n## 2. ${name} (${iso(set[0].sellTs)} → ${iso(set[set.length - 1].sellTs)}, n=${set.length})`);
  console.log('bucket   n    net gp      gp/slot-day  win%   gp/trade');
  for (const [label, lo, hi] of BUCKETS) {
    const b = set.filter((l) => l.hrs >= lo && l.hrs < hi);
    if (!b.length) continue;
    const t = sum(b.map((l) => l.realised));
    const sd = sum(b.map((l) => l.hrs / 24));
    console.log(label.padEnd(8), String(b.length).padEnd(4), M(t).padEnd(11),
      (sd > 0 ? M(t / sd) : '-').padEnd(12),
      ((b.filter((l) => l.realised > 0).length / b.length) * 100).toFixed(0).padStart(3) + '%  ',
      M(t / b.length));
  }
}

// ---- 3. The long-hold winners, named. "Big wins for low effort".
console.log('\n## 3. Every lot held >12h, sorted by realised (the bucket in dispute)');
const longs = lots.filter((l) => l.hrs >= 12).sort((a, b) => b.realised - a.realised);
console.log('realised    hold     cap       bought      sold        item');
for (const l of longs.slice(0, 12)) {
  console.log(M(l.realised).padEnd(11), (l.hrs.toFixed(0) + 'h').padEnd(8), M(l.cap).padEnd(9),
    iso(l.buyTs).padEnd(11), iso(l.sellTs).padEnd(11), l.itemId);
}
console.log('   ... ' + Math.max(0, longs.length - 18) + ' middle rows omitted ...');
for (const l of longs.slice(-6)) {
  console.log(M(l.realised).padEnd(11), (l.hrs.toFixed(0) + 'h').padEnd(8), M(l.cap).padEnd(9),
    iso(l.buyTs).padEnd(11), iso(l.sellTs).padEnd(11), l.itemId);
}

// ---- 4. Weekday, keyed to BUY and to SELL, and split same-day vs multi-day.
console.log('\n## 4. Weekday — same-day lots (buy day == sell day) vs multi-day lots');
for (const [name, set] of [['SAME-DAY', lots.filter((l) => iso(l.buyTs) === iso(l.sellTs))],
                           ['MULTI-DAY', lots.filter((l) => iso(l.buyTs) !== iso(l.sellTs))]]) {
  console.log(`\n### ${name} (n=${set.length}, net ${M(sum(set.map((l) => l.realised)))})`);
  console.log('day    n(buy) net-by-BUY-day   n(sell) net-by-SELL-day');
  for (let d = 0; d < 7; d++) {
    const bb = set.filter((l) => new Date(l.buyTs * 1000).getDay() === d);
    const bs = set.filter((l) => new Date(l.sellTs * 1000).getDay() === d);
    if (!bb.length && !bs.length) continue;
    console.log(DOW[d].padEnd(6), String(bb.length).padEnd(6), M(sum(bb.map((l) => l.realised))).padEnd(16),
      String(bs.length).padEnd(7), M(sum(bs.map((l) => l.realised))));
  }
}
