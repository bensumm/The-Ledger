#!/usr/bin/env node
/**
 * context.test.mjs — the Pipeline-v2 ITEM CONTEXT CHAIN + shared held-verdict renderer (chunk P0).
 *
 * context.mjs is the single home that ended the quote.mjs-vs-watch.mjs verdict fork: one staged
 * enricher chain builds an ItemContext, one parameterized renderer turns it into either surface's
 * verdict. This suite pins:
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - PER-STAGE: identity fills id/name (and derives '#id' when name is absent); market runs
 *     computeQuote (row reflects the live latest); history computes phase off ts6h (null without
 *     it); intraday carries the series through; position derives break-even + lotValue + askFilling
 *     + lotCtx + the ONE momVerdict + the conviction gate, and degrades gracefully on missing inputs.
 *   - THE PIN: a `HOLD — ask filling` lot (held, underwater through a liquid peak, own ask filling
 *     above the clear) renders the SAME verdict on BOTH surfaces — quote.mjs's compact renderer and
 *     watch.mjs's verbose renderer — because both read the SAME ctx.position.mv. Before P0 quote.mjs
 *     could not reach this verdict (no offer read → no askFilling).
 *   - THE CONVICTION PIN: a Gate-D CUT-CANDIDATE that is armed-not-escalated (underwater, but the
 *     underwater streak hasn't persisted ≥ ALERT_PERSIST_MS) reads consistently on both surfaces —
 *     the shared position stage yields one armed gate, and both renderers read CUT-CANDIDATE.
 *
 * PURE / synthetic fixtures only (no network, no fs, no DB — auto-discovered by run-tests.mjs).
 * Run: `node pipeline/context.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import {
  identityStage, marketStage, historyStage, intradayStage, positionStage,
  buildItemContext, heldMomVerdict, renderHeldVerdict,
} from './lib/context.mjs';
import { ALERT_PERSIST_MS } from './lib/watchstate.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// --- fixture helpers ------------------------------------------------------------------------
// A ts5m series ending at `end`, `n` points 5min apart, all UNDERWATER (avgHighPrice < be) with
// uniform two-sided volume → underwaterHours() flags coveredLiquidPeak (every window ≥ median act).
function underwaterSeries(end, n, hi, lo, vol) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push({
    timestamp: end - i * 300, avgHighPrice: hi, avgLowPrice: lo,
    highPriceVolume: vol, lowPriceVolume: vol,
  });
  return out;
}
// A hand-built computeQuote-shaped row: full control of mom/reliable/quickSell so the position stage
// + renderer are exercised on a KNOWN market state (computeQuote itself is pinned in quotecore.test).
const heldRow = (o = {}) => ({
  quickBuy: 92, quickSell: 90, optBuy: 90, optSell: 96, rawBandLo: 90, rawBandHi: 96,
  mom: 'clean', reliable: true, ordered: true, reliableReason: 'ok',
  rising: false, falling: false, regimeLabel: 'flat', mid: 91, volDay: 500,
  regime: { ok: true, driftPct: 0 }, ...o,
});

// ============================================================================================
// PER-STAGE FIXTURES
// ============================================================================================
ok('identityStage fills id + name; derives #id when name absent', () => {
  assert.deepEqual(identityStage({}, { id: 4151, name: 'Abyssal whip' }).identity, { id: 4151, name: 'Abyssal whip' });
  assert.equal(identityStage({}, { id: 999 }).identity.name, '#999');
  assert.deepEqual(identityStage({}, {}).identity, { id: null, name: null });
});

ok('marketStage runs computeQuote — the row reflects the live latest', () => {
  const ctx = marketStage({}, { inp: { latest: { low: 100, high: 105, lowTime: Date.now() / 1000, highTime: Date.now() / 1000 }, ts5m: [], ts6h: [], vol24: {} } });
  assert.ok(ctx.market.row, 'a row is produced');
  assert.equal(ctx.market.row.quickBuy, 100);   // computeQuote: buy fills at the instasell (latest.low)
  assert.equal(ctx.market.row.quickSell, 105);  // sell fills at the instabuy (latest.high)
});

ok('historyStage computes phase off ts6h; null without a series', () => {
  assert.equal(historyStage({}, {}).history.phase, null);
  assert.equal(historyStage({}, {}).history.termStructure, null);       // P3 extension point, null for now
  const withSeries = historyStage({}, { ts6h: [{ timestamp: 1, avgHighPrice: 10, avgLowPrice: 9 }] }).history;
  assert.ok('phase' in withSeries);   // phase() ran (its own value is pinned in quotecore)
});

ok('intradayStage carries the series through unchanged', () => {
  const ts5m = [{ timestamp: 1 }];
  const iv = intradayStage({}, { ts5m, ts6h: null, ts1h: [{ timestamp: 2 }] }).intraday;
  assert.equal(iv.ts5m, ts5m);
  assert.equal(iv.ts6h, null);
  assert.equal(iv.ts1h.length, 1);
});

ok('positionStage derives break-even, lotValue, askFilling, lotCtx (held lot)', () => {
  const ctx = { market: { row: heldRow() }, intraday: { ts5m: [] } };
  positionStage(ctx, { held: true, qty: 10, avgCost: 100, ask: { price: 105, filled: 3, total: 10 } });
  assert.equal(ctx.position.held, true);
  assert.equal(ctx.position.lotValue, 1000);              // qty×avgCost
  assert.ok(ctx.position.be >= 100, 'break-even ≥ cost (after 2% tax)');
  assert.equal(ctx.position.askFilling, true);            // ask 105 > clear 90, filled>0
  assert.deepEqual(ctx.position.lotCtx, { buyTs: null, askFilling: true });
});

ok('positionStage askFilling=false when the ask is not above the clear / not filled', () => {
  const ctx1 = { market: { row: heldRow() }, intraday: { ts5m: [] } };
  positionStage(ctx1, { held: true, qty: 1, avgCost: 100, ask: { price: 85, filled: 3, total: 10 } }); // 85 < clear 90
  assert.equal(ctx1.position.askFilling, false);
  const ctx2 = { market: { row: heldRow() }, intraday: { ts5m: [] } };
  positionStage(ctx2, { held: true, qty: 1, avgCost: 100, ask: { price: 105, filled: 0, total: 10 } }); // nothing filled
  assert.equal(ctx2.position.askFilling, false);
});

ok('positionStage degrades gracefully — no lot / no ask → no throw, benign shape', () => {
  const ctx = { market: { row: heldRow() }, intraday: { ts5m: [] } };
  positionStage(ctx, { held: false });
  assert.equal(ctx.position.mv, null);          // not held → no held verdict
  assert.equal(ctx.position.askFilling, false);
  assert.deepEqual(ctx.position.gate, { escalate: false, armed: false, reason: null });
});

ok('buildItemContext composes the whole chain from per-stage inputs', () => {
  const ctx = buildItemContext({
    identity: { id: 7, name: 'X' },
    market: { inp: { latest: { low: 100, high: 105 }, ts5m: [], ts6h: [], vol24: {} } },
    history: {}, intraday: { ts5m: [] },
    position: { held: true, qty: 2, avgCost: 100 },
  });
  assert.equal(ctx.identity.id, 7);
  assert.ok(ctx.market.row);
  assert.ok('phase' in ctx.history);
  assert.equal(ctx.position.lotValue, 200);
});

// ============================================================================================
// THE PIN — HOLD — ask filling renders identically on BOTH surfaces
// ============================================================================================
ok('PIN: HOLD — ask filling renders the SAME verdict on quote (compact) + watch (verbose)', () => {
  const now = Date.now();
  const ts5m = underwaterSeries(now, 30, 90, 88, 200);  // 30 windows, all underwater, uniform vol → coveredLiquidPeak
  const ctx = { identity: { id: 1, name: 'Pin item' }, market: { row: heldRow() }, history: {}, intraday: { ts5m } };
  positionStage(ctx, {
    held: true, qty: 100, avgCost: 100,             // be ≈ 102 > clear 90 → underwater
    buyTs: Math.floor(now / 1000) - 6 * 3600,       // 6h old → NOT fresh (fresh-entry gate won't fire)
    ask: { price: 105, filled: 5, total: 100 },     // own ask filling ABOVE the clear → askFilling
    watchStatePrior: null, nowMs: now,
  });
  // the ONE decision both surfaces read
  const mv = heldMomVerdict(ctx);
  assert.ok(mv, 'a momVerdict fired');
  assert.equal(mv.action, 'HOLD_FILLING');
  assert.equal(mv.verdict, 'HOLD — ask filling');
  // both renderers derive from ctx.position.mv → they agree on the verdict
  const compact = renderHeldVerdict(ctx, { mode: 'compact' });   // quote.mjs
  const verbose = renderHeldVerdict(ctx, { mode: 'verbose' });   // watch.mjs
  assert.ok(compact.startsWith('HOLD — ask filling'), `compact reads HOLD — ask filling (got: ${compact})`);
  assert.ok(verbose.startsWith('HOLD — ask filling'), `verbose reads HOLD — ask filling (got: ${verbose})`);
});

ok('PIN control: WITHOUT the filling ask, the same lot is NOT HOLD — ask filling', () => {
  const now = Date.now();
  const ts5m = underwaterSeries(now, 30, 90, 88, 200);
  const ctx = { identity: { id: 1, name: 'Pin item' }, market: { row: heldRow() }, history: {}, intraday: { ts5m } };
  positionStage(ctx, {
    held: true, qty: 100, avgCost: 100, buyTs: Math.floor(now / 1000) - 6 * 3600,
    ask: null, watchStatePrior: null, nowMs: now,
  });
  const mv = heldMomVerdict(ctx);
  assert.notEqual(mv && mv.verdict, 'HOLD — ask filling');   // Gate-D persistence cut, not the softening
  assert.equal(mv.verdict, 'CUT-CANDIDATE');
});

// ============================================================================================
// THE CONVICTION PIN — a Gate-D CUT-CANDIDATE armed-not-escalated, consistent on both surfaces
// ============================================================================================
ok('CONVICTION PIN: armed-not-escalated Gate-D CUT-CANDIDATE is consistent on both surfaces', () => {
  const now = Date.now();
  const ts5m = underwaterSeries(now, 30, 90, 88, 200);
  const ctx = { identity: { id: 2, name: 'Conv item' }, market: { row: heldRow() }, history: {}, intraday: { ts5m } };
  positionStage(ctx, {
    held: true, qty: 100, avgCost: 100, buyTs: Math.floor(now / 1000) - 6 * 3600,
    ask: null,                                    // no filling ask → Gate-D persistence CUT-CANDIDATE
    watchStatePrior: null, nowMs: now,            // first-seen → underwaterSince=now → underwaterMs≈0
  });
  const mv = heldMomVerdict(ctx);
  assert.equal(mv.verdict, 'CUT-CANDIDATE');
  assert.equal(mv.gate, 'D');
  // the shared conviction gate: underwater but the streak hasn't persisted ≥ ALERT_PERSIST_MS → ARMED
  assert.equal(ctx.position.gate.escalate, false, 'not yet escalated (streak too short)');
  assert.equal(ctx.position.gate.armed, true);
  assert.equal(ctx.position.gate.reason, 'cut-candidate-armed');
  // both surfaces render the CUT-CANDIDATE verdict off the same mv (consistency)
  assert.ok(renderHeldVerdict(ctx, { mode: 'compact' }).startsWith('CUT-CANDIDATE'));
  assert.ok(renderHeldVerdict(ctx, { mode: 'verbose' }).startsWith('CUT-CANDIDATE'));
});

ok('CONVICTION PIN: once the underwater streak has persisted ≥ ALERT_PERSIST_MS it ESCALATES', () => {
  const now = Date.now();
  const ts5m = underwaterSeries(now, 30, 90, 88, 200);
  const ctx = { market: { row: heldRow() }, intraday: { ts5m } };
  // a prior state entry whose underwater streak began well over the persist window ago
  const prior = {
    ts: now - 60_000, identity: 'hld:100:100', instabuy: 90, mom: 'clean', bandTop: 96, breakEven: 102,
    support: null, underwater: true, passesUnderwater: 3,
    underwaterSince: now - (ALERT_PERSIST_MS + 60_000), belowSupportSince: null, breakdownSince: null, bandTopHist: [],
  };
  positionStage(ctx, {
    held: true, qty: 100, avgCost: 100, buyTs: Math.floor(now / 1000) - 6 * 3600,
    ask: null, watchStatePrior: prior, nowMs: now,
  });
  assert.equal(ctx.position.gate.escalate, true);
  assert.equal(ctx.position.gate.reason, 'cut-candidate');
});

console.log(`\n${pass} checks passed.`);
