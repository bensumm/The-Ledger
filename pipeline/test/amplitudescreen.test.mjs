#!/usr/bin/env node
/**
 * amplitudescreen.test.mjs — acceptance fixtures for the PURE amplitude niche math (js/amplitudescreen.mjs,
 * PLAN-AMPLITUDE-SCAN chunk A1). Gate/ranges/proxy/deploy are DOM-free + fetch-free, so they're
 * fixture-testable with synthetic windowStats-shaped inputs — NO live data (CLAUDE.md rule 4).
 *
 * BUSINESS REQUIREMENTS pinned here (§2.1/§2.2):
 *   - an oscillating big-ticket with a ≥3% after-tax daily swing, both legs reachable on ≥2 of recent-3
 *     days, PASSES the amplitude gate.
 *   - a razor-thin daily range (amp below the floor) is REJECTED (amp-below-floor).
 *   - a bid the recent days no longer touch (repriced-up floor) is REJECTED (bid-unreachable).
 *   - the caller's trend/knife flags REJECT (trend / knife) — a trending item's "amplitude" is drift.
 *   - amplitudeProxy reads the 6h-archive daily range; amplitudeDeployUnits is the three-way min().
 * Run: `node pipeline/test/amplitudescreen.test.mjs` (exits non-zero on any failure). Auto-discovered.
 */
import assert from 'node:assert/strict';
import {
  amplitudeProxy, amplitudeRanges, amplitudeGate, amplitudeDeployUnits,
  AMP_MIN_AMP_PCT, AMP_STAGE1_MIN_PCT,
} from '../../js/amplitudescreen.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// build a windowStats-shaped result from per-day {low,hi} (oldest→newest).
function makeStats(days) {
  const lows = days.map(d => d.low).filter(v => v != null).sort((a, b) => a - b);
  const his = days.map(d => d.hi).filter(v => v != null).sort((a, b) => a - b);
  return { days: days.map((d, i) => [`2026-06-${String(i + 1).padStart(2, '0')}`, d]), lows, his };
}
// an oscillating big-ticket: low ~1000, hi ~1060 (afterTax(1060)=1039 → ~3.9% after-tax daily amplitude).
const OSC = makeStats(Array.from({ length: 10 }, () => ({ low: 1000, hi: 1060 })));
// razor-thin: hi 1010 → afterTax(1010)=990 < low ⇒ negative net ⇒ below floor.
const THIN = makeStats(Array.from({ length: 10 }, () => ({ low: 1000, hi: 1010 })));
// repriced-up floor: 7 old days floor 1000, recent 3 days floor 1040 (the bid no longer touches).
const REPRICED = makeStats([
  ...Array.from({ length: 7 }, () => ({ low: 1000, hi: 1060 })),
  ...Array.from({ length: 3 }, () => ({ low: 1040, hi: 1120 })),
]);

console.log('amplitudescreen.mjs:');

ok('an oscillating ≥3% after-tax daily swing with both legs reachable PASSES', () => {
  const ar = amplitudeRanges(OSC, 1005, { holdDays: 1 });
  assert.equal(ar.hasData, true);
  assert.ok(ar.medAmpPct >= AMP_MIN_AMP_PCT, `medAmpPct ${ar.medAmpPct} ≥ floor ${AMP_MIN_AMP_PCT}`);
  assert.equal(ar.ampBid, 1000, 'trough-bid = median daily low');
  assert.equal(ar.ampAsk, 1060, 'peak-ask = median daily high');
  assert.ok(ar.netPerCycle > 0, 'positive after-tax net/cycle');
  assert.ok(ar.pFill2leg > 0.9, 'both legs reach nearly every recent day');
  const g = amplitudeGate(ar, {});
  assert.equal(g.pass, true, `gate passes, got ${g.reason}`);
});

ok('a razor-thin daily range is REJECTED (amp-below-floor)', () => {
  const ar = amplitudeRanges(THIN, 1005, {});
  const g = amplitudeGate(ar, {});
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'amp-below-floor');
});

ok('a bid the recent days no longer touch is REJECTED (bid-unreachable)', () => {
  const ar = amplitudeRanges(REPRICED, 1045, {});
  const g = amplitudeGate(ar, {});
  assert.equal(g.pass, false);
  assert.equal(g.reason, 'bid-unreachable', `got ${g.reason}`);
});

ok('the caller\'s trend/knife flags REJECT (a trending item\'s amplitude is drift)', () => {
  const ar = amplitudeRanges(OSC, 1005, {});
  assert.equal(amplitudeGate(ar, { trendDominates: true }).reason, 'trend');
  assert.equal(amplitudeGate(ar, { knife: true }).reason, 'knife');
});

ok('too-thin a day sample degrades to no-data (never a fake read)', () => {
  const ar = amplitudeRanges(makeStats([{ low: 1000, hi: 1060 }, { low: 1000, hi: 1060 }]), 1005, {});
  assert.equal(ar.hasData, false);
  assert.equal(amplitudeGate(ar, {}).reason, 'no-history');
});

ok('amplitudeProxy reads the 6h-archive daily range (recent-N median), null on a cold slice', () => {
  const DAY = 86400, T = 1_700_000_000;
  // 5 days × 4 mids/day spanning 1000..1060 → each day's range 6%.
  const pts = [];
  for (let d = 0; d < 5; d++) for (const m of [1000, 1020, 1040, 1060]) pts.push({ ts: T + d * DAY + pts.length * 3600, mid: m });
  const p = amplitudeProxy(pts);
  assert.ok(p != null && Math.abs(p - 0.06) < 1e-9, `proxy ~6%, got ${p}`);
  assert.ok(p >= AMP_STAGE1_MIN_PCT, 'clears the Stage-1 proxy floor');
  assert.equal(amplitudeProxy([]), null, 'cold slice → null');
  assert.equal(amplitudeProxy(null), null, 'no data → null');
});

ok('amplitudeDeployUnits is the three-way min() (bankroll / vol-share / buy-limit), degrades to 1', () => {
  // bankroll: 100m/1000 = 100k; vol-share: 0.10×5000×1 = 500; limit: 100×6×1 = 600 → min 500.
  const u = amplitudeDeployUnits({ capGp: 100_000_000, buyLow: 1000, limitVol: 5000, limit: 100, holdDays: 1 });
  assert.equal(u, 500, `min bound, got ${u}`);
  assert.equal(amplitudeDeployUnits({}), 1, 'no inputs → a single unit');
});

ok('an UNAFFORDABLE big-ticket (price > total capital) sizes to 0 units — the caller drops it', () => {
  // A 345m item on a 100m pool: 100m/345m = 0.29 → honest floor → 0 (NOT a phantom 1u).
  assert.equal(amplitudeDeployUnits({ capGp: 100_000_000, buyLow: 345_000_000 }), 0, 'unaffordable → 0');
});

ok('an affordable big-ticket sizes UNDIVIDED (no ÷slots) and honors the min()', () => {
  // 345m mace on a 400m pool: 400m/345m = 1.16 → floor 1 (a ÷5-slots cap would have given 0 — proves undivided).
  assert.equal(amplitudeDeployUnits({ capGp: 400_000_000, buyLow: 345_000_000 }), 1, 'affordable → 1, undivided');
  // and the min() still binds on the buy-limit accumulation, not the (looser) bankroll.
  const u = amplitudeDeployUnits({ capGp: 400_000_000, buyLow: 345_000_000, limitVol: 40, limit: 2, holdDays: 1 });
  // bankroll 1.16 · vol-share 0.10×40=4 · limit 2×6=12 → min 1.16 → floor 1.
  assert.equal(u, 1, `min bound honored, got ${u}`);
});

console.log(`\namplitudescreen.mjs: ${pass} assertions passed.`);
