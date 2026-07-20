#!/usr/bin/env node
/**
 * join-amplitude.test.mjs — the PURE amplitude shadow both-leg replay core (PLAN-AMPLITUDE-SCAN §A5,
 * join-amplitude-outcomes.mjs replayAmplitudePick / dayBuckets). Synthetic 1h series only — no archive,
 * no live data (rule 4). Pins the UPPER-BOUND semantics: both legs = a daily low ≤ ampBid AND a daily
 * high ≥ ampAsk on the leg-1 day or later, within the hold horizon; pending when the archive is too young.
 * Run: `node pipeline/test/join-amplitude.test.mjs` (exits non-zero on any failure). Auto-discovered.
 */
import assert from 'node:assert/strict';
import { replayAmplitudePick, dayBuckets } from '../commands/join-amplitude-outcomes.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const T = 1_700_000_000;   // a fixed base ts
const pt = (t, low, hi) => ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: 10, highPriceVolume: 10 });

console.log('join-amplitude-outcomes.mjs replay core:');

ok('both legs print within the horizon ⇒ bothFill, resolved', () => {
  const series = [
    pt(T + 3600, 990, 1005),    // leg-1: low 990 ≤ ampBid 1000
    pt(T + 7200, 1010, 1070),   // leg-2: high 1070 ≥ ampAsk 1060
    pt(T + 2 * 86400, 1010, 1010),
  ];
  const r = replayAmplitudePick(series, { ts: T, ampBid: 1000, ampAsk: 1060, holdDays: 1 }, { nowSec: T + 3 * 86400 });
  assert.equal(r.leg1Fill, true);
  assert.equal(r.leg2Fill, true);
  assert.equal(r.bothFill, true);
  assert.equal(r.resolved, true);
});

ok('archive too young + round trip incomplete ⇒ pending (NOT a miss)', () => {
  const series = [pt(T + 3600, 990, 1005)];   // leg-1 only, series ends before the horizon
  const r = replayAmplitudePick(series, { ts: T, ampBid: 1000, ampAsk: 1060, holdDays: 1 }, { nowSec: T + 3600 });
  assert.equal(r.leg1Fill, true);
  assert.equal(r.bothFill, false);
  assert.equal(r.pending, true);
  assert.equal(r.resolved, false);
});

ok('horizon covered but the ask never prints ⇒ a real miss (resolved, not bothFill)', () => {
  const series = [
    pt(T + 3600, 990, 1005),
    pt(T + 2 * 86400, 1010, 1030),   // covers past the 1-day horizon; ask 1060 never reached
  ];
  const r = replayAmplitudePick(series, { ts: T, ampBid: 1000, ampAsk: 1060, holdDays: 1 }, { nowSec: T + 3 * 86400 });
  assert.equal(r.leg1Fill, true);
  assert.equal(r.leg2Fill, false);
  assert.equal(r.bothFill, false);
  assert.equal(r.resolved, true);
});

ok('dayBuckets groups per local day with min-low / max-hi, chronological', () => {
  const series = [pt(T, 1000, 1050), pt(T + 3600, 990, 1060), pt(T + 2 * 86400, 1100, 1200)];
  const days = dayBuckets(series, { from: T, to: T + 3 * 86400 });
  assert.ok(days.length >= 2);
  assert.equal(days[0].low, 990, 'day-1 min low');
  assert.equal(days[0].hi, 1060, 'day-1 max hi');
});

ok('no levels ⇒ a clean no-op (never throws)', () => {
  const r = replayAmplitudePick([], { ts: T, holdDays: 1 }, {});
  assert.equal(r.resolved, false);
  assert.equal(r.reason, 'no-levels');
});

console.log(`\njoin-amplitude replay: ${pass} assertions passed.`);
