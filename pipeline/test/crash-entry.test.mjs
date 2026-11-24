#!/usr/bin/env node
/**
 * crash-entry.test.mjs — acceptance for pipeline/lib/market/crash-entry.mjs (PLAN-CRASH-REPLAY CRX1).
 * Synthetic 1h series only; `nowSec` is always explicit.
 *
 * BUSINESS REQUIREMENTS pinned here (the plan's Verification list):
 *   - LOOK-AHEAD: every rule and the detector return the same decision at t on the full series, on the
 *     series truncated at t, and on a series whose buckets from t onward are rewritten; a future bucket
 *     under the bid never fills a decision whose window it is outside of.
 *   - CLOCK: the bucket stamped t is in neither the readable set nor the fill window.
 *   - TROUGH: a V whose only bucket ≤ bid is the trough bucket at t → no fill at t, a fill at t−1h.
 *   - VOLUME: avgLow ≤ bid with lowPriceVolume < qty is no fill (and < 2×qty under the strict sensitivity).
 *   - STAGED: a tranche that never fills leaves a partial position whose net is the filled tranches' net.
 *   - CLUSTER: two events on one onset day are one bootstrap unit.
 *   - REPRODUCIBILITY: the event list and every score are a deterministic function of the series and
 *     nowSec — including the machine timezone (RB2 reads UTC days) — and history older than LOOKBACK_D
 *     cannot change a score.
 *   - Plus one fire / no-fire pin per rule threshold, the liquidity gate's edges, and the EX2 ladder.
 */
import assert from 'node:assert/strict';
import {
  detectEvents, RULES, firstEntry, persistentOnset, PERSIST_BUCKETS, simulateFill, exitCertainClear, exitLadder, scoreOracle,
  eventWindow, entriesFor, scoreEntries,
  pairedRows, breadthRead, stabilityRead, classOf, blockOf, turnoverGpd, qtyFor,
  ONSET_FRAC, ARM_H, DELAY_H, COOLDOWN_H, LOOKBACK_D, H_FILL,
} from '../lib/market/crash-entry.mjs';
import { pairedClusterCI } from '../lib/signal/cluster-ci.mjs';
import { breakEven } from '../../js/quotecore.js';
import { tax } from '../../js/money-math.js';

const H = 3600, DAY = 86400;
const T0 = Date.UTC(2026, 8, 1) / 1000;
let pass = 0;
const scoreRule = (s, ev, key, now, o = {}) => scoreEntries(s, ev, entriesFor(eventWindow(s, ev, o), ev, key, now), now, o);
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// hours → archive rows; f(i) = { p, lv?, hv?, lo?, hi? } (lo/hi default p ∓ 1%).
function mk(hours, f, start = T0) {
  const out = [];
  for (let i = 0; i < hours; i++) {
    const x = f(i);
    if (!x) continue;
    out.push({ ts: start + i * H, avgLowPrice: Math.round(x.lo ?? x.p * 0.99), avgHighPrice: Math.round(x.hi ?? x.p * 1.01), lowPriceVolume: x.lv ?? 5, highPriceVolume: x.hv ?? 5 });
  }
  return out;
}
// A flat 2.0m line where the test places single buckets by hand.
const flat = (n = 30 * 24) => mk(n, () => ({ p: 2_000_000, lo: 2_000_000, hi: 2_020_000 }));
const put = (s, ts, patch) => s.map(b => (b.ts === ts ? { ...b, ...patch } : b));
const truncAt = (s, t) => s.filter(b => b.ts < t);
const poisonFrom = (s, t) => s.map(b => (b.ts >= t ? { ...b, avgLowPrice: 1, avgHighPrice: 9e9, lowPriceVolume: 1e6, highPriceVolume: 1e6 } : b));

// The crash fixture: 2.0m for 20d; drop to 1.4m with a 6h volume climax; flat a day, then a 1.45m bounce
// held flat (floor settles), then a slow recovery.
const DROP = 20 * 24;
const crash = mk(40 * 24, i => {
  if (i < DROP) return { p: 2_000_000 };
  if (i < DROP + 6) return { p: 1_400_000, lv: 80 };
  if (i < DROP + 30) return { p: 1_400_000 };
  if (i < DROP + 10 * 24) return { p: 1_450_000 };
  return { p: 1_450_000 + (i - DROP - 240) * 2000 };
});
const NOW = T0 + 40 * 24 * H;
const [ev] = detectEvents(crash, NOW);

ok('detector: onset = first bucket ≤ 0.85×72h max; t0 = the hour it is first readable', () => {
  assert.equal(ev.onsetTs, T0 + DROP * H);
  assert.equal(ev.t0, ev.onsetTs + H);
  assert.equal(ev.cls, '1-10m');
  assert.equal(ev.cluster, '2026-09-21');
  assert.ok(ev.onsetMid <= ONSET_FRAC * ev.refMax);
});

ok('detector: illiquid, sub-1m and in-cooldown dumps are not events', () => {
  assert.equal(detectEvents(crash.map(b => ({ ...b, lowPriceVolume: 0, highPriceVolume: 0 })), NOW).length, 0);
  assert.equal(detectEvents(crash.map(b => ({ ...b, avgLowPrice: b.avgLowPrice / 4, avgHighPrice: b.avgHighPrice / 4, lowPriceVolume: 100, highPriceVolume: 100 })), NOW).length, 0);
  const twice = mk(60 * 24, i => ({ p: (i >= 20 * 24 && i < 22 * 24) || (i >= 30 * 24 && i < 32 * 24) || i >= 50 * 24 ? 1_500_000 : 2_000_000 }));
  const evs = detectEvents(twice, T0 + 60 * 24 * H);
  assert.deepEqual(evs.map(e => (e.onsetTs - T0) / H / 24), [20, 50]);
  assert.ok(evs[1].t0 - evs[0].t0 >= COOLDOWN_H * H);
});

ok('look-ahead: the detector at nowSec ignores every bucket from nowSec on', () => {
  const now = ev.t0 - H;
  assert.deepEqual(detectEvents(crash, now), []);
  assert.deepEqual(detectEvents(poisonFrom(crash, now), now), []);
  assert.deepEqual(detectEvents(poisonFrom(crash, ev.t0), ev.t0), [ev]);
  assert.deepEqual(detectEvents(truncAt(crash, ev.t0), ev.t0), [ev]);
});

ok('look-ahead: every rule decides identically on full, truncated-at-t and future-poisoned series', () => {
  const fired = new Set();
  for (const key of Object.keys(RULES)) {
    for (let t = ev.t0; t < ev.t0 + ARM_H * H; t += H) {
      const full = RULES[key](crash, ev, t);
      assert.equal(RULES[key](truncAt(crash, t), ev, t), full, `${key} @ +${(t - ev.t0) / H}h truncated`);
      assert.equal(RULES[key](poisonFrom(crash, t), ev, t), full, `${key} @ +${(t - ev.t0) / H}h poisoned`);
      if (full != null) fired.add(key);
    }
  }
  assert.deepEqual([...fired].sort(), Object.keys(RULES).sort(), 'every rule fires somewhere on the fixture');
});

ok('rule timing: RB0 at t0, RB1 at t0+72h, R5 enters the hour after the climax, RB2 at a UTC midnight', () => {
  assert.equal(firstEntry(crash, ev, 'RB0', NOW).entry, ev.t0);
  assert.equal(firstEntry(crash, ev, 'RB1', NOW).entry, ev.t0 + DELAY_H * H);
  const r5 = firstEntry(crash, ev, 'R5', NOW);
  assert.equal(r5.entry, r5.decidedAt + H);
  assert.equal(firstEntry(crash, ev, 'RB2', NOW).entry % DAY, 0);
  const c = firstEntry(crash, ev, 'RB1-00UTC', NOW);
  assert.equal(c.entry, Math.ceil((ev.t0 + DELAY_H * H) / DAY) * DAY, 'the RB2 clock control: RB1 deferred to the next 00:00 UTC');
  assert.equal(firstEntry(crash, ev, 'RB1', ev.t0 + 10 * H).status, 'armed');
});

ok('look-ahead: a future bucket under the bid cannot fill a decision whose window it lies outside', () => {
  const t = T0 + (DROP + 250) * H, base = simulateFill(crash, t, NOW);
  assert.equal(base.status, 'unfilled');
  const under = { avgLowPrice: 1, lowPriceVolume: 1e6 };
  assert.deepEqual(simulateFill(put(crash, t + (H_FILL + 1) * H, under), t, NOW), base);
  assert.deepEqual(simulateFill(put(crash, t, under), t, NOW), base);
  assert.equal(simulateFill(put(crash, t + H_FILL * H, under), t, NOW).status, 'filled');
});


ok('clock: the bucket stamped t is in neither the readable set nor the fill window', () => {
  const t = T0 + 10 * 24 * H;
  const atT = put(flat(), t, { avgLowPrice: 1_000_000, lowPriceVolume: 1e6 });
  const f = simulateFill(atT, t, T0 + 30 * 24 * H);
  assert.equal(f.bid, 2_000_000);
  assert.equal(f.fillTs, t + H, 'fills on the next flat bucket, never on the one stamped t');
  const lifted = flat().map(b => ({ ...b, avgLowPrice: b.ts > t ? 2_100_000 : b.avgLowPrice }));
  assert.equal(simulateFill(put(lifted, t, { avgLowPrice: 1_000_000, lowPriceVolume: 1e6 }), t, T0 + 30 * 24 * H).status, 'unfilled');
  assert.equal(simulateFill(put(lifted, t + H, { avgLowPrice: 1_000_000, lowPriceVolume: 1e6 }), t, T0 + 30 * 24 * H).status, 'filled');
});

ok('trough: the V-bottom bucket at t fills the decision at t−1h, not the one at t', () => {
  const tr = 10 * 24;
  const v = mk(30 * 24, i => { const p = 2_000_000 + (i < tr ? (tr - i) * 20_000 : (i - tr) * 40_000); return { p, lo: p, hi: p + 20_000 }; });
  const t = T0 + tr * H;
  assert.equal(simulateFill(v, t, T0 + 30 * 24 * H).status, 'unfilled');
  const prior = simulateFill(v, t - H, T0 + 30 * 24 * H);
  assert.equal(prior.status, 'filled');
  assert.equal(prior.fillTs, t);
});

ok('volume: avgLow ≤ bid with lowPriceVolume < qty is no fill; strict needs 2×qty', () => {
  const t = T0 + 10 * 24 * H;
  const lifted = flat().map(b => ({ ...b, avgLowPrice: b.ts > t ? 2_100_000 : b.avgLowPrice }));
  const thin = put(lifted, t + 2 * H, { avgLowPrice: 1_990_000, lowPriceVolume: 4 });
  const now = T0 + 30 * 24 * H;
  assert.equal(simulateFill(thin, t, now, { qty: 5 }).status, 'unfilled');
  assert.equal(simulateFill(thin, t, now, { qty: 4 }).status, 'filled');
  assert.equal(simulateFill(thin, t, now, { qty: 3, volMult: 2 }).status, 'unfilled');
  assert.equal(simulateFill(thin, t, now, { qty: 2, volMult: 2 }).status, 'filled');
});

ok('fill/exit windows still open at nowSec are pending, never a miss', () => {
  const t = T0 + 10 * 24 * H, lifted = flat().map(b => ({ ...b, avgLowPrice: b.ts > t ? 2_100_000 : b.avgLowPrice }));
  assert.equal(simulateFill(lifted, t, t + 5 * H).status, 'pending');
  assert.equal(exitCertainClear(flat(), t, 2_000_000, t + 5 * H).status, 'pending');
  const later = put(lifted, t + 10 * H, { avgLowPrice: 1_000_000, lowPriceVolume: 1e6, avgHighPrice: 9e6, highPriceVolume: 1e6 });
  assert.equal(simulateFill(later, t, t + 5 * H).status, 'pending', 'a fill printed after nowSec is not known at nowSec');
  assert.equal(simulateFill(later, t, t + 12 * H).status, 'filled');
  assert.equal(exitCertainClear(later, t, 2_000_000, t + 5 * H).status, 'pending');
});

ok('EX1: ask = breakEven(fill)×1.02, volume-gated; bail low/high at the window end', () => {
  const fill = 2_000_000, ask = Math.ceil(breakEven(fill) * 1.02), t = T0 + 5 * 24 * H, now = T0 + 30 * 24 * H;
  const hit = put(flat(), t + 30 * H, { avgHighPrice: ask, highPriceVolume: 1 });
  const r = exitCertainClear(hit, t, fill, now);
  assert.equal(r.status, 'reached');
  assert.equal(r.net, ask - tax(ask) - fill);
  assert.equal(exitCertainClear(hit, t, fill, now, { qty: 2 }).status, 'bailed');
  const low = exitCertainClear(flat(), t, fill, now), high = exitCertainClear(flat(), t, fill, now, { bail: 'high' });
  assert.equal(low.price, 2_000_000);
  assert.equal(high.price, 2_020_000);
  assert.equal(low.net, 2_000_000 - tax(2_000_000) - fill);
});

ok('EX2: the ladder ask is the min of the three prior completed UTC days\' highs', () => {
  const s = mk(30 * 24, i => ({ p: 2_000_000, lo: 2_000_000, hi: [2_100_000, 2_050_000, 2_080_000][Math.floor(i / 24) % 3] }));
  const r = exitLadder(s, T0 + 10 * 24 * H, 1_900_000, T0 + 30 * 24 * H);
  assert.equal(r.status, 'reached');
  assert.equal(r.ask, 2_050_000);
});

ok('staged: an unfilled tranche leaves a partial position netting only the filled tranches', () => {
  // Tranche 1 fills on the flat dip; tranches 2 and 3 are bid into a market that only rises.
  const dump = mk(40 * 24, i => {
    if (i < 20 * 24) return { p: 20_000_000, lo: 20_000_000, hi: 20_200_000 };
    if (i < 20 * 24 + 20) return { p: 16_000_000, lo: 16_000_000, hi: 16_100_000 };
    const p = 16_000_000 + (i - 20 * 24 - 19) * 100_000;
    return { p, lo: p, hi: p + 50_000 };
  });
  const now = T0 + 40 * 24 * H, [e] = detectEvents(dump, now);
  assert.equal(e.cls, 'big');
  const r = scoreRule(dump, e, 'ST-time', now);
  assert.deepEqual(r.tranches.map(x => x.status), ['filled', 'unfilled', 'unfilled']);
  const t1 = r.tranches[0];
  assert.equal(r.net, t1.exit.net * t1.qty);
  assert.equal(r.cost, t1.bid * t1.qty);
  assert.equal(r.frac, r.net / r.cost);
  assert.equal(r.status, 'entered');
});

ok('a rule that never fires is a counted no-entry at net 0', () => {
  const r = scoreRule(crash, { ...ev, onsetTs: T0 + 5 * DAY - H, t0: T0 + 5 * DAY }, 'R0', NOW);
  assert.equal(r.status, 'no-entry');
  assert.equal(r.net, 0);
  assert.equal(r.frac, 0);
});

ok('cluster: two events on one onset day are one bootstrap unit', () => {
  const days = ['2026-07-01', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05'];
  const results = days.map((cluster, i) => ({ ev: { cluster, itemId: i }, per: { A: { frac: 0.01 * i }, B: { frac: 0 } } }));
  const rows = pairedRows(results, 'A', 'B');
  assert.equal(rows.length, 6);
  assert.equal(pairedClusterCI(rows, 'A', 'B').items, 5);
  results[5].per.A.status = 'pending';
  assert.equal(pairedRows(results, 'A', 'B').length, 5, 'a pending leg is not a resolved outcome');
});

ok('reproducibility: events and scores are deterministic; history older than LOOKBACK_D is inert', () => {
  assert.deepEqual(detectEvents(crash, NOW), detectEvents(crash, NOW));
  const older = [...mk(60 * 24, () => ({ p: 9_000_000 }), T0 - 60 * DAY), ...crash];
  for (const key of [...Object.keys(RULES), 'ST-time', 'ST-trigger']) {
    assert.deepEqual(scoreRule(older, ev, key, NOW), scoreRule(crash, ev, key, NOW), key);
  }
  assert.deepEqual(scoreOracle(older, ev, NOW), scoreOracle(crash, ev, NOW));
  for (const key of Object.keys(RULES)) assert.equal(scoreRule(crash, ev, key, NOW).tranches[0].entry, firstEntry(crash, ev, key, NOW).entry, `${key}: the scoring window drops nothing a rule reads`);
  assert.ok(LOOKBACK_D * DAY < 60 * DAY);
});

ok('oracle: entry at the arm window\'s lowest avgLow', () => {
  const o = scoreOracle(crash, ev, NOW);
  assert.equal(o.tranches[0].bid, Math.min(...crash.filter(b => b.ts > ev.t0 && b.ts <= ev.t0 + ARM_H * H).map(b => b.avgLowPrice)));
  const deeperOnset = put(crash, ev.onsetTs, { avgLowPrice: 1_000_000 });
  assert.equal(scoreOracle(deeperOnset, ev, NOW).tranches[0].bid, o.tranches[0].bid, 'the oracle window is (t0, end], like a rule fill');
  assert.equal(scoreOracle(crash, ev, ev.t0 + 10 * H).status, 'pending');
});

ok('classes, blocks, qty', () => {
  assert.equal(classOf(10_000_000), 'big');
  assert.equal(classOf(9_999_999), '1-10m');
  assert.equal(classOf(999_999), '10k-1m');
  assert.equal(classOf(9_999), null);
  assert.equal(blockOf('2026-10-18'), 'P');
  assert.equal(blockOf('2026-10-19'), 'R');
  assert.equal(blockOf('2026-10-26'), 'R');
  assert.equal(blockOf('2026-10-27'), null);
  assert.equal(qtyFor('big', 30_000_000), 1);
  assert.equal(qtyFor('1-10m', 2_000_000), 5);
  assert.equal(qtyFor('1-10m', 2_000_000, { limit: 3 }), 3);
  assert.equal(qtyFor('1-10m', 5_000_000, { trancheGp: 10_000_000 / 3 }), 1, 'a tranche smaller than one unit still buys one');
  assert.equal(qtyFor('10k-1m', 500_000), 0);
});

ok('staged: a 1–10m tranche at a 5m bid is never qty 0', () => {
  const dump = mk(40 * 24, i => ({ p: i < 20 * 24 ? 6_000_000 : 5_000_000 }));
  const now = T0 + 40 * 24 * H, [e] = detectEvents(dump, now);
  assert.equal(e.cls, '1-10m');
  for (const key of ['ST-time', 'ST-trigger']) {
    const r = scoreRule(dump, e, key, now);
    const priced = r.tranches.filter(x => x.qty != null);
    assert.ok(priced.length && priced.every(x => x.qty >= 1), key);
    assert.equal(r.status, 'entered', key);
  }
});

ok('settle: a filled tranche whose exit is still open keeps the rule pending', () => {
  const r = scoreRule(crash, ev, 'RB0', ev.t0 + 10 * H);
  assert.equal(r.tranches[0].status, 'filled');
  assert.equal(r.tranches[0].exit.status, 'pending');
  assert.equal(r.status, 'pending');
});

ok('nowSec boundary: the bucket stamped floor(nowSec) is not yet complete', () => {
  const t = T0 + 10 * 24 * H, at = t + 5 * H;
  const lifted = flat().map(b => ({ ...b, avgLowPrice: b.ts > t ? 2_100_000 : b.avgLowPrice }));
  const dip = put(lifted, at, { avgLowPrice: 1_000_000, lowPriceVolume: 1e6 });
  assert.equal(simulateFill(dip, t, at).status, 'pending');
  assert.equal(simulateFill(dip, t, at + H).status, 'filled');
  const spike = put(flat(), at, { avgHighPrice: 9e6, highPriceVolume: 1e6 });
  assert.equal(exitCertainClear(spike, t, 2_000_000, at).status, 'pending');
  assert.equal(exitCertainClear(spike, t, 2_000_000, at + H).status, 'reached');
});

// One sale per UTC day at `lo` (lv=2), nothing else traded; a dump to 2.0m at hour 20d+5.
const liq = (lo, extra = () => null) => mk(30 * 24, i => extra(i) || (i < 20 * 24 + 5
  ? { p: lo, lo, hi: lo * 1.01, lv: i % 24 === 12 ? 2 : 0, hv: 0 }
  : { p: 2_000_000, lo: 2_000_000, hi: 2_020_000, lv: 0, hv: 0 }));
const LIQ_NOW = T0 + 30 * 24 * H;

ok('liquidity: trailing-7-day turnover just above 5m gp/d is liquid, just below is not', () => {
  assert.equal(detectEvents(liq(2_550_000), LIQ_NOW).length, 1);
  assert.equal(detectEvents(liq(2_450_000), LIQ_NOW).length, 0);
});

ok('liquidity: turnover on or after the onset day never counts toward it', () => {
  const spike = i => (i >= 20 * 24 + 8 && i < 20 * 24 + 12 ? { p: 2_000_000, lo: 2_000_000, hi: 2_020_000, lv: 1000, hv: 1000 } : null);
  assert.equal(detectEvents(liq(2_450_000, spike), T0 + 21 * DAY - H).length, 0, "the same-day spike is not liquidity yet");
  const t = T0 + 20 * DAY + 20 * H;
  assert.equal(turnoverGpd(liq(2_450_000, spike), t), turnoverGpd(liq(2_450_000), t));
});

ok('detector: the trailing max covers exactly 72 completed hours', () => {
  const s = mk(20 * 24, i => ({ p: i < 10 * 24 ? 2_400_000 : i < 10 * 24 + 71 ? 2_100_000 : 2_000_000, lv: 50, hv: 50 }));
  assert.deepEqual(detectEvents(s, T0 + 20 * 24 * H), [], 'the 2.4m print is 73 buckets back at the first 2.0m bucket');
  const s72 = mk(20 * 24, i => ({ p: i < 10 * 24 ? 2_400_000 : i < 10 * 24 + 70 ? 2_100_000 : 2_000_000, lv: 50, hv: 50 }));
  assert.equal(detectEvents(s72, T0 + 20 * 24 * H)[0].onsetTs, T0 + (10 * 24 + 70) * H, 'and is in range 72 buckets back');
});

const at = T0 + 10 * DAY;
const evAny = { t0: at, onsetTs: at - H };

ok('R2: a flat floor fires; a fresh floor break or a forming-day low does not count', () => {
  const t = T0 + 20 * DAY + 5 * H;
  const days = (lastLo, todayLo = 2_000_000) => mk(20 * 24 + 5, i => { const d = Math.floor(i / 24); const lo = d === 20 ? todayLo : d === 19 ? lastLo : 2_000_000; return { p: lo, lo, hi: lo + 20_000 }; });
  assert.equal(RULES.R2(days(2_000_000), evAny, t), t);
  assert.equal(RULES.R2(days(1_990_000), evAny, t), null, 'latest completed low under the prior 13-day floor');
  assert.equal(RULES.R2(days(2_000_000, 1_900_000), evAny, t), t, 'the forming day is not a completed day');
});

ok('R3: the two 24h windows do not overlap', () => {
  const s = (recent, prior) => mk(12 * 24, i => { const lo = i >= 10 * 24 - 24 ? recent : i >= 10 * 24 - 48 ? prior : 2_000_000; return { p: lo, lo, hi: lo + 20_000 }; });
  assert.equal(RULES.R3(s(1_900_000, 2_000_000), evAny, at), null);
  assert.equal(RULES.R3(s(2_000_000, 1_900_000), evAny, at), at);
});

ok('R4: the bounce needs the last low ≥ 1.02 × the 24h min', () => {
  const s = k => put(flat(), at - H, { avgLowPrice: Math.round(2_000_000 * k) });
  assert.equal(RULES.R4(s(1.019), evAny, at), null);
  assert.equal(RULES.R4(s(1.021), evAny, at), at);
});

ok('R5: the climax compares the 6h MEAN (not sum) to 2× the 7d hourly median', () => {
  const s = v => mk(12 * 24, i => ({ p: 2_000_000, lv: i >= 10 * 24 - 6 ? v : 10 }));
  assert.equal(RULES.R5(s(15), evAny, at), null);
  assert.equal(RULES.R5(s(25), evAny, at), at + H);
});

ok('RB2: deep4/deep7 fire, deep2 does not', () => {
  const t = T0 + 20 * DAY + 6 * H;
  const s = p => mk(20 * 24 + 6, i => ({ p: i < 20 * 24 ? 2_000_000 : p }));
  assert.equal(RULES.RB2(s(1_940_000), evAny, t), null);
  assert.equal(RULES.RB2(s(1_840_000), evAny, t), T0 + 21 * DAY);
});

ok('RB2 reads UTC days: decision and outcome are identical under any machine timezone', () => {
  const was = process.env.TZ, seen = [];
  try {
    for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      seen.push(JSON.stringify([firstEntry(crash, ev, 'RB2', NOW).decidedAt, scoreRule(crash, ev, 'RB2', NOW).frac]));
    }
  } finally { if (was == null) delete process.env.TZ; else process.env.TZ = was; }
  assert.equal(new Set(seen).size, 1, seen.join(' vs '));
});

ok('EX2: the ladder spans exactly three prior days and is volume-gated', () => {
  const hiOf = d => ({ 6: 1_950_000, 7: 2_000_000, 10: 2_050_000 })[d] ?? 2_100_000;
  const s = (hv10 = 5) => mk(20 * 24, i => { const d = Math.floor(i / 24); return { p: 1_900_000, lo: 1_900_000, hi: hiOf(d), hv: d === 10 ? hv10 : 5 }; });
  const fillTs = T0 + 10 * DAY - H, now = T0 + 20 * DAY;
  const r = exitLadder(s(), fillTs, 1_800_000, now);
  assert.equal(r.ask, 2_000_000);
  assert.equal(r.exitTs, T0 + 10 * DAY);
  const thin = exitLadder(s(0), fillTs, 1_800_000, now);
  assert.equal(thin.ask, 2_050_000, 'day 10 never clears with no volume; day 11 relists off days 8–10');
  assert.equal(thin.exitTs, T0 + 11 * DAY);
});


ok('breadth/stability: share at a 20-day low, class 3d return, three-day stabilising run', () => {
  const now = T0 + 30 * DAY;
  const falling = mk(30 * 24, i => ({ p: 3_000_000 - i * 1000 }));
  const steady = mk(30 * 24, () => ({ p: 2_000_000 }));
  const bigUp = mk(30 * 24, i => ({ p: 20_000_000 + i * 1000 }));
  assert.ok(turnoverGpd(falling, now) > 5_000_000);
  const b = breadthRead(new Map([[1, falling], [2, steady], [3, bigUp]]), now);
  assert.equal(b.day, '2026-09-30');
  assert.equal(b.n, 3);
  assert.equal(b.byClass['1-10m'].n, 2);
  assert.equal(b.breadth, 2 / 3, 'a flat line sits at its own 20-day low (≤, not <)');
  assert.ok(b.byClass.big.ret > 0);
  const s = stabilityRead({ a: bigUp, b: bigUp, c: bigUp, d: bigUp, e: bigUp, f: bigUp, g: bigUp, h: falling }, now);
  assert.deepEqual(s.days.map(d => d.day), ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.equal(s.stabilising.big, true);
  assert.equal(s.stabilising['1-10m'], false);
  assert.deepEqual(breadthRead(new Map([[1, poisonFrom(falling, now)]]), now), breadthRead(new Map([[1, falling]]), now));
});

ok('persistence (sensitivity): the onset is re-timed to the hour its persistence is readable', () => {
  const p = persistentOnset(crash, ev, NOW);
  assert.equal(p.t0, ev.onsetTs + PERSIST_BUCKETS * H);
  assert.equal(p.onsetTs, ev.onsetTs);
  assert.equal(persistentOnset(crash, ev, p.t0 - H), null, 'not knowable before the last persistence bucket is readable');
  assert.deepEqual(persistentOnset(poisonFrom(crash, p.t0), ev, p.t0), p);
  const thin = put(crash, ev.onsetTs, { lowPriceVolume: 2, highPriceVolume: 2 });
  assert.equal(persistentOnset(thin, ev, NOW), null, 'fewer than 5 units in the onset bucket');
  const blip = put(crash, ev.onsetTs + (PERSIST_BUCKETS - 1) * H, { avgLowPrice: 1_990_000, avgHighPrice: 2_010_000 });
  assert.equal(persistentOnset(blip, ev, NOW), null, 'back above the threshold inside the persistence window');
});

ok('RB1-diurnal: RB1 moved to the next hour in the dip window, whatever the machine timezone', () => {
  const s = mk(30 * 24, i => (i % 24 === 5 ? { p: 1_950_000, lo: 1_930_000, hi: 1_970_000 } : { p: 2_000_000 }));
  const e = { t0: T0 + 20 * DAY + 10 * H, onsetTs: T0 + 20 * DAY + 9 * H };
  const t = e.t0 + DELAY_H * H, was = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      const entry = RULES['RB1-diurnal'](s, e, t);
      assert.equal(new Date(entry * 1000).getUTCHours(), 5, tz);
      assert.ok(entry >= t && entry < t + DAY, tz);
    }
  } finally { if (was == null) delete process.env.TZ; else process.env.TZ = was; }
  assert.equal(RULES['RB1-diurnal'](s, e, t - H), null);
});

ok('RB1-diurnal reads UTC days and hours: the same entry under any machine timezone', () => {
  let x = 1; const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const s = mk(30 * 24, i => ({ p: 2_000_000 * (1 + 0.02 * (rnd() - 0.5) - 0.002 * i / 24) }), T0 + 10 * H);
  const e = { t0: T0 + 26 * DAY + 10 * H, onsetTs: T0 + 26 * DAY + 9 * H }, t = e.t0 + DELAY_H * H;
  const was = process.env.TZ, seen = [];
  try {
    for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles']) { process.env.TZ = tz; seen.push(RULES['RB1-diurnal'](s, e, t)); }
  } finally { if (was == null) delete process.env.TZ; else process.env.TZ = was; }
  assert.equal(new Set(seen).size, 1, seen.join(' vs '));
});

ok('qty-neutral: unitQty forces one unit on every tranche', () => {
  assert.ok(scoreRule(crash, ev, 'RB0', NOW).tranches[0].qty > 1);
  for (const key of ['RB0', 'ST-time']) {
    const r = scoreRule(crash, ev, key, NOW, { unitQty: true });
    assert.ok(r.tranches.every(x => x.qty == null || x.qty === 1), key);
  }
});

console.log(`crash-entry.test.mjs: ${pass} assertions passed`);
