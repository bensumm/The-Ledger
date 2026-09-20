#!/usr/bin/env node
/**
 * pace.test.mjs — acceptance fixtures for AL1 (PLAN-ADAPTIVE-LOOP): the pure pace() tier engine
 * + loopPresumedDead(). Everything synthetic, no live data. Run: node pipeline/test/pace.test.mjs.
 *
 * Pins (plan §5 AL1 + §9): the tier ladder ordering; empty-book DRY→IDLE progression with the
 * PACE_IDLE_TICKS debounce; deep-bid-only → DEEP at PACE_DEEP_MIN; alert tightens instantly from
 * any tier; held lot / dip-armed never below GLANCE; loosening ONE tier per tick (a DEEP→IDLE
 * jump in one tick FAILS here by design); awaitingRebuy never holds the loop open (R-AL-4);
 * fresh start takes the computed tier directly (R-AL-8); loopPresumedDead boundaries; and the
 * PURITY pin — pace.mjs imports nothing (fs/network/child_process stay out forever).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pace, loopPresumedDead, PACE_TIERS,
  PACE_GLANCE_MIN, PACE_DEEP_MIN, PACE_DRY_FALLBACK_MIN,
  PACE_IDLE_TICKS, PACE_DEAD_FACTOR,
} from '../lib/loop/pace.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('AL1 pace() + loopPresumedDead acceptance:');

const deepBid = { side: 'buy', qty: 100, filled: 0, verdict: 'BID-OK', placement: 'deep' };
const behindBid = { side: 'buy', qty: 5, filled: 0, verdict: 'BID-BEHIND', placement: 'committed' };
const liveBid = { side: 'buy', qty: 10, filled: 0, verdict: 'BID-OK', placement: 'committed' };
const ask = { side: 'sell', qty: 3, filled: 0, verdict: null, placement: null };

// --- empty-book progression: DRY first, IDLE→STOP only after the debounce -----------------------
ok('empty book, fresh start → DRY (never instant STOP), idleTicks=1', () => {
  const r = pace({ lots: 0, offers: [], prevTier: null, idleTicks: 0 });
  assert.equal(r.tier, 'DRY');
  assert.equal(r.stop, false);
  assert.equal(r.idleTicks, 1);
  assert.equal(r.nextWakeMin, PACE_DRY_FALLBACK_MIN);
});
ok(`empty book tick ${PACE_IDLE_TICKS} → IDLE, stop:true, no wake`, () => {
  const r = pace({ lots: 0, offers: [], prevTier: 'DRY', idleTicks: PACE_IDLE_TICKS - 1 });
  assert.equal(r.tier, 'IDLE');
  assert.equal(r.stop, true);
  assert.equal(r.nextWakeMin, null);
});
ok('non-empty book resets idleTicks to 0', () => {
  const r = pace({ lots: 1, offers: [], prevTier: 'DRY', idleTicks: 5 });
  assert.equal(r.idleTicks, 0);
});
ok('DRY honours --scan interval as its wake', () => {
  const r = pace({ lots: 0, offers: [], scanMin: 45, prevTier: 'DRY', idleTicks: 0 });
  assert.equal(r.nextWakeMin, 45);
});

// --- DEEP ---------------------------------------------------------------------------------------
ok(`deep-bid-only book → DEEP ${PACE_DEEP_MIN}m`, () => {
  const r = pace({ lots: 0, offers: [deepBid], prevTier: 'DEEP' });
  assert.equal(r.tier, 'DEEP');
  assert.equal(r.nextWakeMin, PACE_DEEP_MIN);
  assert.equal(r.stop, false);
});
ok('BID-BEHIND counts as deep-side (no lots) → DEEP', () => {
  const r = pace({ lots: 0, offers: [behindBid], prevTier: 'DEEP' });
  assert.equal(r.tier, 'DEEP');
});
ok('R-AL-8: fresh start (prevTier null) on a deep-bid book → DEEP directly, not GLANCE-stepped', () => {
  const r = pace({ lots: 0, offers: [deepBid], prevTier: null });
  assert.equal(r.tier, 'DEEP');
});
ok('deep bid + a resting ask → GLANCE (a live sell leg fills too)', () => {
  const r = pace({ lots: 0, offers: [deepBid, ask], prevTier: 'GLANCE' });
  assert.equal(r.tier, 'GLANCE');
});
ok('a fully-filled offer row is not exposure (qty == filled)', () => {
  const r = pace({ lots: 0, offers: [{ ...liveBid, filled: 10 }], prevTier: 'DRY', idleTicks: 0 });
  assert.equal(r.tier, 'DRY');
});

// --- GLANCE floors ------------------------------------------------------------------------------
ok('held lot → GLANCE, and stays GLANCE over quiet ticks (never below)', () => {
  let r = pace({ lots: 1, offers: [], prevTier: 'GLANCE' });
  assert.equal(r.tier, 'GLANCE');
  r = pace({ lots: 1, offers: [], prevTier: r.tier });
  assert.equal(r.tier, 'GLANCE');
  assert.equal(r.nextWakeMin, PACE_GLANCE_MIN);
});
ok('committed near-live bid → GLANCE', () => {
  const r = pace({ lots: 0, offers: [liveBid], prevTier: 'GLANCE' });
  assert.equal(r.tier, 'GLANCE');
});
ok('dip pool armed: empty book never loosens past GLANCE, never stops', () => {
  let ticks = 0;
  let r = pace({ lots: 0, offers: [], dipArmed: true, prevTier: 'GLANCE', idleTicks: 0 });
  while (ticks++ < 5) r = pace({ lots: 0, offers: [], dipArmed: true, prevTier: r.tier, idleTicks: r.idleTicks });
  assert.equal(r.tier, 'GLANCE');
  assert.equal(r.stop, false);
});

// --- ACTIVE / tightening ------------------------------------------------------------------------
ok('alert on a deep-bid book → ACTIVE the same tick (tightening is instant)', () => {
  const r = pace({ lots: 0, offers: [deepBid], alerts: 1, prevTier: 'DEEP' });
  assert.equal(r.tier, 'ACTIVE');
});
ok('fill since last tick → ACTIVE', () => {
  const r = pace({ lots: 1, offers: [], fillsSince: 1, prevTier: 'DEEP' });
  assert.equal(r.tier, 'ACTIVE');
});
ok('new exposure (offer placed) → ACTIVE from any tier', () => {
  const r = pace({ lots: 0, offers: [liveBid], newExposure: 1, prevTier: 'DRY' });
  assert.equal(r.tier, 'ACTIVE');
});
ok('CANCEL-BID verdict on an offer is itself an alert → ACTIVE', () => {
  const r = pace({ lots: 0, offers: [{ ...liveBid, verdict: 'CANCEL-BID' }], prevTier: 'GLANCE' });
  assert.equal(r.tier, 'ACTIVE');
});
ok('tight class cadence (≤5m) → ACTIVE at that cadence', () => {
  const r = pace({ lots: 1, offers: [], classCadenceMin: 3, prevTier: 'GLANCE' });
  assert.equal(r.tier, 'ACTIVE');
  assert.equal(r.nextWakeMin, 3);
});

// --- loosening one tier per tick (R-AL-6) ---------------------------------------------------------
ok('loosening moves ONE tier per tick: ACTIVE → empty book lands GLANCE, not DRY', () => {
  const r = pace({ lots: 0, offers: [], prevTier: 'ACTIVE', idleTicks: 0 });
  assert.equal(r.tier, 'GLANCE');
});
ok('a DEEP→IDLE jump in one tick is impossible (lands DRY)', () => {
  const r = pace({ lots: 0, offers: [], prevTier: 'DEEP', idleTicks: PACE_IDLE_TICKS });
  assert.equal(r.tier, 'DRY');
  assert.equal(r.stop, false);
});
ok('full quiet run-down ACTIVE→GLANCE→DEEP→DRY→IDLE takes one tick each', () => {
  const seen = [];
  let prev = 'ACTIVE', idleTicks = 0;
  for (let i = 0; i < 5; i++) {
    const r = pace({ lots: 0, offers: [], prevTier: prev, idleTicks });
    seen.push(r.tier); prev = r.tier; idleTicks = r.idleTicks;
  }
  assert.deepEqual(seen, ['GLANCE', 'DEEP', 'DRY', 'IDLE', 'IDLE']);
});

// --- R-AL-4: awaitingRebuy never holds the loop open ---------------------------------------------
ok('awaitingRebuy alone → IDLE progression unchanged (inform-only)', () => {
  const r = pace({ lots: 0, offers: [], awaitingRebuy: 1, prevTier: 'DRY', idleTicks: PACE_IDLE_TICKS - 1 });
  assert.equal(r.tier, 'IDLE');
  assert.equal(r.stop, true);
  assert.equal(r.startable, false);
  assert.ok(r.reasons.some(s => s.includes('awaitingRebuy')));
});
ok('fills on a now-empty book → ACTIVE (the event tightens) but startable:false (nothing left to watch)', () => {
  const r = pace({ lots: 0, offers: [], fillsSince: 2, prevTier: 'GLANCE' });
  assert.equal(r.tier, 'ACTIVE');
  assert.equal(r.startable, false);
});

// --- startable: the auto-start predicate is EXPOSURE, never tier (R-AL-7 — the anchor incident) ---
ok('empty book → startable:false even though tier is DRY (auto-start must not rebuild the anchor incident)', () => {
  const r = pace({ lots: 0, offers: [], prevTier: null, idleTicks: 0 });
  assert.equal(r.tier, 'DRY');
  assert.equal(r.startable, false);
});
ok('dip-armed empty book → GLANCE but startable:false (dip watch stays an explicit ask)', () => {
  const r = pace({ lots: 0, offers: [], dipArmed: true, prevTier: null, idleTicks: 0 });
  assert.equal(r.tier, 'GLANCE');
  assert.equal(r.startable, false);
});
ok('deep bid / held lot → startable:true', () => {
  assert.equal(pace({ lots: 0, offers: [deepBid], prevTier: null }).startable, true);
  assert.equal(pace({ lots: 1, offers: [], prevTier: null }).startable, true);
});

// --- malformed offers stay exposure (a bad row must never let the loop stop on a live bid) --------
ok('qty:null offer counts as exposure → DEEP, never DRY/IDLE, stop:false', () => {
  const r = pace({ lots: 0, offers: [{ side: 'buy', qty: null, verdict: 'BID-OK', placement: 'deep' }], prevTier: 'DEEP', idleTicks: 5 });
  assert.equal(r.tier, 'DEEP');
  assert.equal(r.stop, false);
});
ok('qty:NaN offer counts as exposure (malformed ≠ empty)', () => {
  const r = pace({ lots: 0, offers: [{ side: 'buy', qty: NaN, verdict: 'BID-OK', placement: 'deep' }], prevTier: 'DEEP' });
  assert.equal(r.tier, 'DEEP');
  assert.equal(r.startable, true);
});
ok('missing placement reads committed (the FAST side) → GLANCE', () => {
  const r = pace({ lots: 0, offers: [{ side: 'buy', qty: 5, filled: 0, verdict: 'BID-OK' }], prevTier: 'GLANCE' });
  assert.equal(r.tier, 'GLANCE');
});
ok('negative alerts count cannot swallow a live CANCEL-BID → ACTIVE', () => {
  const r = pace({ lots: 0, offers: [{ ...liveBid, verdict: 'CANCEL-BID' }], alerts: -1, prevTier: 'GLANCE' });
  assert.equal(r.tier, 'ACTIVE');
});

// --- loopPresumedDead (R-AL-7) --------------------------------------------------------------------
ok('no record / stop:true / unreadable record → dead', () => {
  assert.equal(loopPresumedDead(null), true);
  assert.equal(loopPresumedDead({ stop: true, at: Date.now(), nextWakeMin: 15 }), true);
  assert.equal(loopPresumedDead({ at: NaN, nextWakeMin: 15 }), true);
  assert.equal(loopPresumedDead({ at: Date.now() }), true);
});
ok(`alive inside, dead outside at + ${PACE_DEAD_FACTOR}×wake (boundary ±ε)`, () => {
  const at = 1_000_000_000_000, wake = 15;
  const edge = at + PACE_DEAD_FACTOR * wake * 60_000;
  assert.equal(loopPresumedDead({ at, nextWakeMin: wake }, edge - 1), false);
  assert.equal(loopPresumedDead({ at, nextWakeMin: wake }, edge + 1), true);
});

// --- purity pin: pace.mjs must import NOTHING (same philosophy as check-daemon-safety) ------------
ok('pace.mjs has zero imports (pure module, no fs/network/child_process ever)', () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'loop', 'pace.mjs'), 'utf8');
  const imports = src.split('\n').filter(l => /^\s*import\b/.test(l) || /\brequire\s*\(/.test(l) || /\bimport\s*\(/.test(l));
  assert.deepEqual(imports, [], `pace.mjs must stay import-free, found: ${imports.join(' | ')}`);
});

// --- tier list itself is pinned (AL2's state file stores the name) --------------------------------
ok('tier names and order are the contract', () => {
  assert.deepEqual(PACE_TIERS, ['ACTIVE', 'GLANCE', 'DEEP', 'DRY', 'IDLE']);
});

console.log(`\npace.test.mjs: ${pass} checks passed`);
