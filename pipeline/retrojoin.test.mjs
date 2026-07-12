#!/usr/bin/env node
/**
 * retrojoin.test.mjs — the PURE suggestion→fill retro-join core (P6a).
 *
 * BUSINESS REQUIREMENTS (what an agent must not break):
 *   - A suggestion followed by a cheaper buy fill within the mode horizon → outcome 'filled',
 *     latencySec EXACT (suggestion.ts → first-fill ts).
 *   - A buy fill executed ABOVE the suggested buy → 'filled-worse'.
 *   - No qualifying buy fill in the horizon → 'not-taken' (the dominant class).
 *   - Two suggestions for the same item close together DON'T double-claim one fill: the
 *     nearest-prior (latest, within its own horizon) claims it; the stale earlier one is not-taken.
 *   - Rows WITHOUT a `path` aggregate under mode without throwing ('(no-path)' path bucket).
 *   - A closed FIFO round-trip surfaces realisedNet / realisedPerUnit / holdSec.
 *   - DETERMINISTIC: identical fixtures → identical rows + aggregates.
 *
 * SYNTHETIC fixtures only — never the live fills.json. Run: `node pipeline/retrojoin.test.mjs`.
 */
import assert from 'node:assert/strict';
import {
  retroJoin, aggregateOutcomes, horizonFor,
  HORIZON_INTRADAY_SEC, HORIZON_MULTIDAY_SEC, HORIZON_DEFAULT_SEC,
} from './lib/retrojoin.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// --- fixture builders ------------------------------------------------------------------------
// one collapsed BUY offer: placed@openTs → partial(filled)@fillTs → complete@fillTs+1. eachPrice =
// priceEach (spent = priceEach*filled). tsFirstFill = fillTs.
function buyOffer(slot, itemId, priceEach, qty, filled, openTs, fillTs) {
  const spent = priceEach * filled;
  return [
    { ts: openTs,    slot, type: 'buy', state: 'placed',   itemId, price: priceEach, qty, filled: 0,      spent: 0 },
    { ts: fillTs,    slot, type: 'buy', state: 'partial',  itemId, price: priceEach, qty, filled,          spent },
    { ts: fillTs + 1, slot, type: 'buy', state: 'complete', itemId, price: priceEach, qty, filled,          spent },
  ];
}
function sellOffer(slot, itemId, priceEach, qty, filled, openTs, fillTs) {
  const spent = priceEach * filled;
  return [
    { ts: openTs,    slot, type: 'sell', state: 'placed',   itemId, price: priceEach, qty, filled: 0,      spent: 0 },
    { ts: fillTs,    slot, type: 'sell', state: 'partial',  itemId, price: priceEach, qty, filled,          spent },
    { ts: fillTs + 1, slot, type: 'sell', state: 'complete', itemId, price: priceEach, qty, filled,          spent },
  ];
}
const sug = (ts, itemId, extra = {}) => ({ ts, itemId, script: 'screen', mode: 'band', ...extra });

// --- horizon map ------------------------------------------------------------------------------
ok('horizonFor maps the scalp family intraday, rising/value multi-day, unknown → default', () => {
  for (const m of ['scalp', 'band', 'spread', 'churn']) assert.equal(horizonFor(m), HORIZON_INTRADAY_SEC);
  for (const m of ['rising', 'value']) assert.equal(horizonFor(m), HORIZON_MULTIDAY_SEC);
  assert.equal(horizonFor(null), HORIZON_DEFAULT_SEC);
  assert.equal(horizonFor('nonsense'), HORIZON_DEFAULT_SEC);
});

// --- 1. cheaper buy within horizon → filled, latency exact -----------------------------------
ok('cheaper buy within horizon → filled, latency exact', () => {
  const T0 = 1_000_000;
  const suggestions = [sug(T0, 100, { optBuy: 100, quickBuy: 105 })];
  const events = buyOffer(1, 100, /*each*/90, /*qty*/10, /*filled*/10, /*open*/T0 + 100, /*fill*/T0 + 3600);
  const { rows } = retroJoin(suggestions, events);
  assert.equal(rows[0].outcome, 'filled');
  assert.equal(rows[0].latencySec, 3600);       // fillTs - suggestion.ts
  assert.equal(rows[0].fillEach, 90);
  assert.equal(rows[0].partial, false);
});

// --- 2. buy above the suggested price → filled-worse -----------------------------------------
ok('buy above suggested price → filled-worse', () => {
  const T0 = 1_000_000;
  const suggestions = [sug(T0, 100, { optBuy: 100, quickBuy: 105 })];
  const events = buyOffer(1, 100, /*each*/120, 10, 10, T0 + 100, T0 + 200);
  const { rows } = retroJoin(suggestions, events);
  assert.equal(rows[0].outcome, 'filled-worse');
  assert.equal(rows[0].fillEach, 120);
});

// --- 3. no fill in horizon → not-taken -------------------------------------------------------
ok('no buy fill within the horizon → not-taken', () => {
  const T0 = 1_000_000;
  const suggestions = [sug(T0, 100, { mode: 'band', optBuy: 100 })];   // band horizon = 12h
  const events = buyOffer(1, 100, 90, 10, 10, T0, T0 + 13 * 3600);     // fill 13h later = outside
  const { rows } = retroJoin(suggestions, events);
  assert.equal(rows[0].outcome, 'not-taken');
  assert.equal(rows[0].latencySec, null);
});

// --- 4. two suggestions close together don't double-claim one fill ---------------------------
ok('two suggestions for one item share NO fill — nearest-prior claims, stale one is not-taken', () => {
  const T0 = 1_000_000;
  const s1 = sug(T0, 100, { optBuy: 100 });
  const s2 = sug(T0 + 1000, 100, { optBuy: 100 });   // fresher re-quote 1000s later
  const events = buyOffer(1, 100, 90, 10, 10, T0 + 1100, T0 + 1200);   // one fill after both
  const { rows, meta } = retroJoin([s1, s2], events);
  assert.equal(meta.nClaimed, 1);                    // exactly one claim total
  assert.equal(rows[0].outcome, 'not-taken');        // s1 superseded
  assert.equal(rows[1].outcome, 'filled');           // s2 (nearest-prior) claims it
  assert.equal(rows[1].latencySec, T0 + 1200 - (T0 + 1000));
});

// --- 5. rows without `path` aggregate under mode without throwing ----------------------------
ok('rows without a path aggregate under mode + "(no-path)" without throwing', () => {
  const T0 = 1_000_000;
  const withPath = sug(T0, 100, { optBuy: 100, path: 'scalp' });
  const noPath   = sug(T0, 200, { optBuy: 50 });   // no path field
  const events = [
    ...buyOffer(1, 100, 90, 10, 10, T0 + 10, T0 + 100),
    ...buyOffer(2, 200, 40, 10, 10, T0 + 10, T0 + 100),
  ];
  const { rows } = retroJoin([withPath, noPath], events);
  const { perNiche, perPath } = aggregateOutcomes(rows);
  assert.equal(perNiche.length, 1);                                  // both are mode 'band'
  assert.equal(perNiche[0].key, 'band');
  assert.equal(perNiche[0].n, 2);
  const keys = perPath.map(g => g.key).sort();
  assert.deepEqual(keys, ['band / (no-path)', 'band / scalp']);
});

// --- 6. mode-less rows join under the default horizon and group under '(none)' ---------------
ok('mode-less (quote) rows join on the default horizon and group under (none)', () => {
  const T0 = 1_000_000;
  const quoteRow = { ts: T0, itemId: 300, script: 'quote', mode: null, optBuy: 100 };
  const events = buyOffer(1, 300, 90, 5, 5, T0 + 10, T0 + 5 * 3600);   // 5h < 24h default
  const { rows } = retroJoin([quoteRow], events);
  assert.equal(rows[0].outcome, 'filled');
  const { perNiche } = aggregateOutcomes(rows);
  assert.equal(perNiche[0].key, '(none)');
});

// --- 7. closed FIFO round-trip surfaces realised net + hold time -----------------------------
ok('a closed round-trip surfaces realisedNet / realisedPerUnit / holdSec', () => {
  const T0 = 1_000_000;
  const suggestions = [sug(T0, 100, { optBuy: 100, optSell: 200, quickSell: 190 })];
  const buyTs = T0 + 100;
  const sellOpenTs = T0 + 4000;
  const events = [
    ...buyOffer(1, 100, /*each*/90, 10, 10, buyTs, buyTs + 50),
    ...sellOffer(1, 100, /*each*/200, 10, 10, sellOpenTs, sellOpenTs + 50),
  ];
  const { rows } = retroJoin(suggestions, events);
  assert.equal(rows[0].outcome, 'filled');
  assert.notEqual(rows[0].realisedNet, null);
  assert.ok(rows[0].realisedNet > 0);            // sold 200 (−2% tax) vs bought 90 → profit
  assert.equal(rows[0].realisedPerUnit, Math.round(rows[0].realisedNet / 10));
  assert.equal(rows[0].holdSec, sellOpenTs - buyTs);   // buy offer tsOpen → sell tsOpen
  assert.notEqual(rows[0].suggestedNetPerUnit, null);
  // sellEach (2026-07-12): the qty-weighted realized GROSS sell price — the Bar E raw-top-reach input
  assert.equal(rows[0].sellEach, 200, 'sellEach = realized gross sell price of the closing sells');
});

// --- 7b. sellEach degrades to null when no round-trip closed ----------------------------------
ok('sellEach is null on a not-taken row and on a filled-but-unsold lot', () => {
  const T0 = 1_000_000;
  const { rows: nt } = retroJoin([sug(T0, 100, { optBuy: 100 })], []);
  assert.equal(nt[0].sellEach, null, 'not-taken → sellEach null');
  const events = buyOffer(1, 100, 90, 10, 10, T0 + 100, T0 + 150);   // bought, never sold
  const { rows } = retroJoin([sug(T0, 100, { optBuy: 100 })], events);
  assert.equal(rows[0].outcome, 'filled');
  assert.equal(rows[0].sellEach, null, 'open (unsold) lot → sellEach null, never fabricated');
});

// --- 8. partial fill flagged ------------------------------------------------------------------
ok('a claimed buy offer with filled < qty is flagged partial', () => {
  const T0 = 1_000_000;
  const suggestions = [sug(T0, 100, { optBuy: 100 })];
  const events = buyOffer(1, 100, 90, /*qty*/10, /*filled*/4, T0 + 10, T0 + 100);   // 4 of 10
  const { rows } = retroJoin(suggestions, events);
  assert.equal(rows[0].outcome, 'filled');
  assert.equal(rows[0].partial, true);
});

// --- 9. determinism: identical fixtures → identical output -----------------------------------
ok('deterministic: same fixtures produce identical rows + aggregates', () => {
  const T0 = 1_000_000;
  const suggestions = [
    sug(T0, 100, { optBuy: 100, path: 'scalp' }),
    sug(T0 + 5, 200, { mode: 'rising', optBuy: 50, path: 'value-hold' }),
    sug(T0 + 9, 300, { mode: 'spread', optBuy: 70 }),
  ];
  const events = [
    ...buyOffer(1, 100, 90, 10, 10, T0 + 10, T0 + 600),
    ...buyOffer(2, 200, 55, 10, 10, T0 + 10, T0 + 2 * 24 * 3600),   // within rising multi-day horizon
    // item 300: no fill → not-taken
  ];
  const a = retroJoin(suggestions, events);
  const b = retroJoin(suggestions, events);
  assert.deepEqual(a.rows, b.rows);
  assert.deepEqual(aggregateOutcomes(a.rows), aggregateOutcomes(b.rows));
  // spot-check the mixed outcome set
  assert.equal(a.rows[0].outcome, 'filled');       // 100 filled cheap
  assert.equal(a.rows[1].outcome, 'filled-worse'); // 200 filled @55 > optBuy 50
  assert.equal(a.rows[2].outcome, 'not-taken');    // 300 never bought
});

console.log(`\n✓ retrojoin.test.mjs — ${pass} assertions passed.`);
