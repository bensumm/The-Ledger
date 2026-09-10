#!/usr/bin/env node
/**
 * dwell.test.mjs — pins formatDwell / tallyCounts (emit.mjs) + the lean `dwell` ledger field
 * (suggestlog.mjs). The ⇄ dwell line is the fill-now vs rest-day pricing comparison (the
 * bludgeon/Marlin 2026-09-10 anchor: two rest-all-day legs priced at live edges); these pins keep
 * its honesty properties from regressing:
 *   - counts render over nAsk/nBid, NEVER nDays (the asymPair denominator trap, windowread.mjs
 *     ~:866 — his/lows can be SHORTER than nDays, so a nDays tally counts days the fraction never
 *     scored);
 *   - a missing basis degrades to null (honest absence, never a fabricated comparison);
 *   - a rest-day level carries its reality clause; a declared exit carries a label, never a clause;
 *   - the ledger field is lean-included (absent flag ⇒ byte-absent field).
 * Run: `node pipeline/test/dwell.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { formatDwell, tallyCounts, dwellSellClassRateNote } from '../lib/render/emit.mjs';
import { suggestionEntry } from '../lib/render/suggestlog.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// --- tallyCounts ---------------------------------------------------------------------------------
ok('tallyCounts uses nAsk/nBid as denominators, not nDays', () => {
  const t = tallyCounts({ pAsk: 10 / 12, pBid: 4 / 13, nAsk: 12, nBid: 13, nDays: 14 });
  assert.deepEqual(t, { hA: 10, nA: 12, hB: 4, nB: 13 });   // 10/12, never "12/14"
});
ok('tallyCounts falls back to nDays only when the side denominators are absent', () => {
  assert.deepEqual(tallyCounts({ pAsk: 0.5, pBid: 0.25, nDays: 12 }), { hA: 6, nA: 12, hB: 3, nB: 12 });
});
ok('tallyCounts null-degrades with no denominator at all', () => {
  assert.equal(tallyCounts({ pAsk: 0.5, pBid: 0.25 }), null);
  assert.equal(tallyCounts(), null);
});

// --- formatDwell, items surface (side both) ------------------------------------------------------
const itemsInput = {
  fillNow: { buy: 17_835_594, sell: 17_900_000, net: 64_706 },
  restDay: {
    bid: 17_420_000, ask: 18_050_000, net: 268_000,
    hB: 4, nB: 14, hA: 11, nA: 14,
    bidReality: null, askReality: null, poolLo: 120, poolHi: 95,
  },
};
ok('items line: both bases, tallies, pools, per-TIME/per-FLIP framing, rest-day routing clause', () => {
  const s = formatDwell(itemsInput);
  assert.equal(s,
    'dwell: FILL-NOW 17.84m→17.90m net +64.7k/u (live edges — pays per-TIME)'
    + ' | REST-DAY bid 17.42m (touched 4/14d) → ask 18.05m (printed 11/14d)'
    + ' net +268k/u · pools ~120/~95 u/d (pays per-FLIP; touched ≠ filled, in-sample)'
    + ' — resting away-hours/overnight? price off REST-DAY');
});
ok('no execution verb on the fill-now half (quotecore measured the live edges REVERSED on real fills)', () => {
  const s = formatDwell(itemsInput);
  assert.ok(!/clears now|crossable/i.test(s));
});
ok('a firing reality clause rides WITH its rest-day level', () => {
  const s = formatDwell({ ...itemsInput, restDay: { ...itemsInput.restDay,
    askReality: { spikeTop: true, staleOptimistic: false, typicalLevel: 17_600_000 } } });
  assert.ok(s.includes('ask 18.05m (printed 11/14d) ⚠ spike-top ~17.60m'));
});
ok('items line null-degrades when either basis is incomplete', () => {
  assert.equal(formatDwell({ ...itemsInput, restDay: null }), null);
  assert.equal(formatDwell({ ...itemsInput, restDay: { ...itemsInput.restDay, ask: null } }), null);
  assert.equal(formatDwell({ ...itemsInput, fillNow: { ...itemsInput.fillNow, buy: null } }), null);
  assert.equal(formatDwell({ ...itemsInput, restDay: { ...itemsInput.restDay, hA: null } }), null);
});
ok('a null net renders as n/a, never a fabricated number', () => {
  const s = formatDwell({ ...itemsInput, fillNow: { ...itemsInput.fillNow, net: null } });
  assert.ok(s.includes('FILL-NOW 17.84m→17.90m net n/a (live edges'));
});

// --- formatDwell, positions sell leg (side ask) --------------------------------------------------
ok('positions sell leg: nets vs cost, asym rest-day rung with tally', () => {
  const s = formatDwell({
    fillNow: { sell: 3_885, net: -12 },
    restDay: { ask: 4_050, askHit: 11, askN: 14, askReality: null, net: 153 },
    side: 'ask',
  });
  assert.equal(s,
    'dwell (sell): FILL-NOW @3,885 net −12/u vs cost'
    + ' | REST-DAY @4,050 (printed 11/14d) net +153/u vs cost'
    + ' — resting all day? price the REST-DAY rung (touched ≠ filled, in-sample)');
});
ok('a DECLARED exit carries its label and never a reality clause (item-context refusal)', () => {
  const s = formatDwell({
    fillNow: { sell: 3_885, net: -12 },
    restDay: { ask: 4_200, askHit: 6, askN: 14, askReality: null, askLabel: 'declared exit', net: 296 },
    side: 'ask',
  });
  assert.ok(s.includes('REST-DAY @4,200 (declared exit — printed 6/14d)'));
  assert.ok(!s.includes('⚠'));
});
ok('positions leg null-degrades without a live or rest-day ask', () => {
  assert.equal(formatDwell({ fillNow: { sell: null }, restDay: { ask: 4_050 }, side: 'ask' }), null);
  assert.equal(formatDwell({ fillNow: { sell: 3_885 }, restDay: { ask: null }, side: 'ask' }), null);
});
ok('a null-net (no cost basis) sell leg gets the verify-vs-BE tail, not the routing imperative', () => {
  const s = formatDwell({
    fillNow: { sell: 140, net: null },
    restDay: { ask: 139, askHit: 12, askN: 14, askReality: null, net: null },
    side: 'ask',
  });
  assert.ok(s.includes('no cost basis on this lot: verify vs break-even before resting'));
  assert.ok(!s.includes('price the REST-DAY rung'));
});
ok('dwellSellClassRateNote is the ask-leg footer — conditional stated, big-ticket split, no round trip', () => {
  const s = dwellSellClassRateNote();
  assert.ok(s.startsWith('dwell (sell) — '));
  assert.ok(s.includes('NOT') && s.includes('fill rates'));
  assert.ok(s.includes('given the paired deep bid touched'));   // the conditioning may never be dropped
  assert.ok(s.includes('big-ticket'));                          // the split held lots concentrate in
  assert.ok(!s.includes('round trip'));                         // the round-trip rate has no held-lot meaning
  assert.ok(!/of cases over ~\d+ items/.test(s));               // the full-pool n never rides the conditional rate
  assert.ok(s.includes('Re-derive: join-asym-outcomes.mjs'));
});
ok('a sub-BE rest-day rung NEVER gets the routing imperative — the BE floor line replaces it', () => {
  const s = formatDwell({
    fillNow: { sell: 3_885, net: -200 },
    restDay: { ask: 3_950, askHit: 13, askN: 14, askReality: null, net: -120 },
    side: 'ask',
  });
  assert.ok(s.includes('rest-day rung sits BELOW break-even; the BE floor governs'));
  assert.ok(!s.includes('price the REST-DAY rung'));
});
ok('a negative rest-day pair on the items surface drops the routing imperative too', () => {
  const s = formatDwell({ ...itemsInput, restDay: { ...itemsInput.restDay, net: -5_000 } });
  assert.ok(s.includes('rest-day pair nets NEGATIVE — no resting edge here'));
  assert.ok(!s.includes('price off REST-DAY'));
});
ok('a reality clause whose typical renders IDENTICAL to its level is suppressed (same-render rule)', () => {
  const s = formatDwell({ ...itemsInput, restDay: { ...itemsInput.restDay,
    bidReality: { spikeTop: false, staleOptimistic: true, typicalLevel: 17_420_000 } } });
  assert.ok(s.includes('bid 17.42m (touched 4/14d) → ask'));   // no dangling "⚠ stale ~17.42m"
  assert.ok(!s.includes('⚠ stale ~17.42m'));
});

// --- suggestlog lean `dwell` field ---------------------------------------------------------------
const rowStub = { quickBuy: 100, quickSell: 110, optBuy: 95, optSell: 115 };
ok('suggestionEntry includes dwell when passed and omits the KEY entirely when absent', () => {
  const withD = suggestionEntry(rowStub, { itemId: 1, dwell: 'away' });
  const without = suggestionEntry(rowStub, { itemId: 1 });
  assert.equal(withD.dwell, 'away');
  assert.ok(!('dwell' in without));
  delete withD.dwell;
  assert.deepEqual(withD, without);   // the field is the ONLY difference (lean, byte-stable rows)
});

console.log(`dwell.test.mjs — ${pass} checks passed`);
