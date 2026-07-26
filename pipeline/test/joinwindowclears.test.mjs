#!/usr/bin/env node
/**
 * joinwindowclears.test.mjs — the PURE window-clear fill-attribution core (WC2, PLAN-WINDOW-CLEAR-OUTCOMES,
 * join-window-clears.mjs joinWindowClears / priceMatch / classifyOutcome / fillHourInWindow). Synthetic
 * records + campaignBase-shaped campaigns only — no fills.json, no ledger, no archive (rule 4). Pins:
 *   - each of the four outcomes (UNPLACED / PLACED_NO_FILL / PLACED_FILLED_IN_WINDOW / _OUT_OF_WINDOW);
 *   - the ZERO-FALSE-POSITIVE guard (an unrelated LOWER dump → UNPLACED, never "filled");
 *   - the nearest-PRIOR dedup (two surfaces, one placement → attributes to the NEWER, older UNPLACED);
 *   - the anchor-nudge ASYMMETRY (a placement below list within tolBelow matches; above tol does not);
 *   - the D2 lag + signed-gap diagnostics compute correctly;
 *   - the midnight-crossing peak window;
 *   - the report floor mirrors join-outcomes.mjs MIN_N_REPORT (the duplicate-with-drift-guard pattern);
 *   - the shared campaign primitive (lib/campaigns.mjs reconstructCampaigns/campaignBase) derives the base
 *     fields correctly off a synthetic events fixture — the primitive join-outcomes now shares.
 * Run: `node pipeline/test/joinwindowclears.test.mjs` (exits non-zero on any failure). Auto-discovered.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  joinWindowClears, priceMatch, classifyOutcome, fillHourInWindow, REPORT_FLOOR,
} from '../commands/join-window-clears.mjs';
import { reconstructCampaigns, campaignBase } from '../lib/campaigns.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// A ts whose LOCAL hour is exactly `h` on a fixed day — TZ-independent (built from the local Date ctor,
// read back with getHours() the same way fillHourInWindow does).
const DAY = [2026, 0, 15];
const localTs = (h, day = DAY) => Math.floor(new Date(day[0], day[1], day[2], h, 0, 0).getTime() / 1000);

// a record + a campaignBase-shaped sell campaign
const rec = (over = {}) => ({ itemId: 100, surfaceTs: localTs(0), list: 1000, live: 990,
  peakWindow: [2, 4], hiReach: { reached: 3, n: 7, placement: 55 }, fiveReach: null, regime: 'stable', ...over });
const camp = (over = {}) => ({ itemId: 100, side: 'sell', placementTs: localTs(1), placementPrice: 998,
  everFilled: false, firstFillTs: null, timeToFirstFill: null, terminalState: 'cancelled', ...over });

console.log('join-window-clears.mjs pure core:');

// --- the four classifications --------------------------------------------------------------------
ok('PLACED_FILLED_IN_WINDOW — matched, filled, first fill hour ∈ peak window', () => {
  const r = rec(), c = camp({ everFilled: true, firstFillTs: localTs(3), timeToFirstFill: 7200, terminalState: 'complete' });
  const res = joinWindowClears([r], [c]);
  assert.equal(res.rows[0].outcome, 'PLACED_FILLED_IN_WINDOW');
  assert.equal(res.counts.PLACED_FILLED_IN_WINDOW, 1);
  assert.equal(res.filled, 1);
  assert.equal(res.placed, 1);
});

ok('PLACED_FILLED_OUT_OF_WINDOW — matched, filled, first fill outside the window', () => {
  const r = rec(), c = camp({ everFilled: true, firstFillTs: localTs(10), timeToFirstFill: 3600, terminalState: 'complete' });
  const res = joinWindowClears([r], [c]);
  assert.equal(res.rows[0].outcome, 'PLACED_FILLED_OUT_OF_WINDOW');
  assert.equal(res.filled, 1);
});

ok('PLACED_NO_FILL — matched campaign, never filled (the floor-night negative)', () => {
  const r = rec(), c = camp({ everFilled: false, terminalState: 'cancelled' });
  const res = joinWindowClears([r], [c]);
  assert.equal(res.rows[0].outcome, 'PLACED_NO_FILL');
  assert.equal(res.filled, 0);
  assert.equal(res.placed, 1);
});

ok('UNPLACED — no campaign at all for the item (a COUNT, excluded from fill-rate)', () => {
  const res = joinWindowClears([rec()], []);
  assert.equal(res.rows[0].outcome, 'UNPLACED');
  assert.equal(res.counts.UNPLACED, 1);
  assert.equal(res.placed, 0);            // UNPLACED never counts toward placed/filled
  assert.equal(res.filled, 0);
  assert.equal(res.rows[0].matchedCampaign, null);
});

// --- the zero-false-positive guard ---------------------------------------------------------------
ok('false-positive guard — an unrelated LOWER dump for the same item → UNPLACED, never filled', () => {
  const r = rec();   // list 1000
  // a dump priced 900 (10% below list) that FILLS inside the window — must NOT be attributed to the rung.
  const dump = camp({ placementPrice: 900, everFilled: true, firstFillTs: localTs(3), terminalState: 'complete' });
  const res = joinWindowClears([r], [dump]);
  assert.equal(res.rows[0].outcome, 'UNPLACED', 'a lower dump is not this rung');
  assert.equal(res.filled, 0, 'zero false fills');
  assert.equal(res.diagnostics.priceFailed, 1, 'the dump is counted as a price-rejected candidate');
});

// --- nearest-prior dedup -------------------------------------------------------------------------
ok('nearest-prior dedup — two surfaces, one placement → attributes to the NEWER; older UNPLACED', () => {
  const older = rec({ surfaceTs: localTs(0) });
  const newer = rec({ surfaceTs: localTs(6) });
  const c = camp({ placementTs: localTs(7), placementPrice: 998, everFilled: true, firstFillTs: localTs(8), terminalState: 'complete' });
  const res = joinWindowClears([older, newer], [c]);
  const byTs = Object.fromEntries(res.rows.map(x => [x.surfaceTs, x]));
  assert.equal(byTs[localTs(6)].outcome, 'PLACED_FILLED_OUT_OF_WINDOW', 'newer surface owns the placement');
  assert.equal(byTs[localTs(0)].outcome, 'UNPLACED', 'older surface gets no double-count');
  assert.equal(res.placed, 1, 'the placement is counted exactly once');
});

// --- anchor-nudge asymmetry ----------------------------------------------------------------------
ok('anchor-nudge — a placement 1% BELOW list matches (asymmetric band), 1% ABOVE does not', () => {
  const r = rec();   // list 1000, tolBelow 1.5%, tolAbove 0.5%
  const below = priceMatch(990, 1000);   // -1.0% → inside the 1.5% below room
  const above = priceMatch(1010, 1000);  // +1.0% → outside the 0.5% above tol
  assert.equal(below.matched, true, '1% below list is within the anchor-nudge room');
  assert.ok(Math.abs(below.gap + 0.01) < 1e-9, 'signed gap is -1%');
  assert.equal(above.matched, false, '1% above list is rejected (symmetric would wrongly clip/accept)');
  // and it flows through the join as a match
  const res = joinWindowClears([r], [camp({ placementPrice: 990, everFilled: false })]);
  assert.equal(res.rows[0].outcome, 'PLACED_NO_FILL');
});

// --- diagnostics ---------------------------------------------------------------------------------
ok('D2 diagnostics — lag + signed-gap distributions compute over matched placements', () => {
  const r1 = rec({ itemId: 1, surfaceTs: localTs(0) });
  const r2 = rec({ itemId: 2, surfaceTs: localTs(0), list: 2000 });
  const c1 = camp({ itemId: 1, placementTs: localTs(1), placementPrice: 990 });   // +1h lag, -1.0% gap (below)
  const c2 = camp({ itemId: 2, placementTs: localTs(3), placementPrice: 2004 });  // +3h lag, +0.2% gap (above)
  const res = joinWindowClears([r1, r2], [c1, c2]);
  assert.equal(res.diagnostics.lagSec.n, 2);
  assert.equal(res.diagnostics.lagSec.min, 3600);
  assert.equal(res.diagnostics.lagSec.max, 3 * 3600);
  assert.equal(res.diagnostics.priceGap.n, 2);
  assert.equal(res.diagnostics.priceGap.below, 1, 'one placement below list');
  assert.equal(res.diagnostics.priceGap.above, 1, 'one placement above list');
});

ok('horizon — a placement beyond the horizon is not attributed (UNPLACED)', () => {
  const r = rec({ surfaceTs: localTs(0) });
  const late = camp({ placementTs: localTs(0) + 25 * 3600, everFilled: true, firstFillTs: localTs(0) + 26 * 3600 });
  const res = joinWindowClears([r], [late]);
  assert.equal(res.rows[0].outcome, 'UNPLACED');
});

// --- window membership helpers -------------------------------------------------------------------
ok('fillHourInWindow — midnight-crossing window [22,2] includes 23:00, excludes 12:00', () => {
  assert.equal(fillHourInWindow(localTs(23), [22, 2]), true);
  assert.equal(fillHourInWindow(localTs(12), [22, 2]), false);
  assert.equal(fillHourInWindow(localTs(3), [2, 4]), true);
  assert.equal(fillHourInWindow(null, [2, 4]), false, 'null fill ts → not in window');
  assert.equal(fillHourInWindow(localTs(3), null), false, 'null window → not in window');
});

ok('classifyOutcome — null matched campaign is UNPLACED', () => {
  assert.equal(classifyOutcome(rec(), null), 'UNPLACED');
});

// --- report-floor drift guard (never re-hardcode; mirror join-outcomes MIN_N_REPORT) -------------
ok('REPORT_FLOOR stays in sync with join-outcomes.mjs MIN_N_REPORT (drift guard)', () => {
  const jo = fs.readFileSync(path.join(HERE, '..', 'commands', 'join-outcomes.mjs'), 'utf8');
  const m = jo.match(/MIN_N_REPORT\s*=\s*(\d+)/);
  assert.ok(m, 'could not find MIN_N_REPORT in join-outcomes.mjs');
  assert.equal(REPORT_FLOOR, +m[1], 'REPORT_FLOOR drifted from join-outcomes MIN_N_REPORT');
});

// --- the shared campaign primitive derives the base fields (join-outcomes now shares this) --------
ok('campaignBase — reconstructs placement/first-fill/terminal off a synthetic sell fixture', () => {
  const events = [
    { ts: 1000, type: 'sell', state: 'placed', itemId: 5, slot: 1, price: 100, qty: 10, filled: 0, spent: 0 },
    { ts: 1600, type: 'sell', state: 'complete', itemId: 5, slot: 1, price: 100, qty: 10, filled: 10, spent: 1000 },
  ];
  const { campaigns } = reconstructCampaigns(events);
  const sells = campaigns.map(campaignBase).filter(c => c.side === 'sell');
  assert.equal(sells.length, 1);
  const c = sells[0];
  assert.equal(c.placementTs, 1000);
  assert.equal(c.placementPrice, 100);
  assert.equal(c.everFilled, true);
  assert.equal(c.firstFillTs, 1600, 'first fill stamped at the filled>0 event');
  assert.equal(c.terminalState, 'complete');
  assert.equal(c.filledFraction, 1);
});

console.log(`\njoin-window-clears: ${pass} assertions passed.`);
