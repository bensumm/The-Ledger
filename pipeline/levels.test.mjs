#!/usr/bin/env node
/**
 * levels.test.mjs — the watch loop's structural-support / cut-trigger levels (chunk V2).
 *
 * levels.mjs derives, from a recent per-day LOW series, the recent STRUCTURAL SUPPORT (the most
 * recent higher-low that held, else the N-day floor) and a cut-trigger δ below it. OUTPUT-ONLY in
 * V2 — this pins the level math so V4's eventual conviction gating builds on a proven tripwire.
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - Support = the most recent HIGHER-LOW: the pivot low the following day held at/above.
 *   - A strictly declining series (no higher-low) degrades support to the N-day minimum low.
 *   - Cut-trigger = support × (1 − δ), strictly below support.
 *   - Graceful degradation: fewer than 2 usable lows → null (no crash, no fabricated level).
 *   - The lookback only considers the most recent SUPPORT_LOOKBACK_DAYS lows.
 *
 * Synthetic fixtures only. Run: `node pipeline/levels.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import {
  structuralSupport, cutTrigger,
  SUPPORT_LOOKBACK_DAYS, CUT_TRIGGER_DELTA,
} from './lib/levels.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

/* --- support = the most recent higher-low --------------------------------------------------- */
ok('support is the most recent higher-low (the pivot the next day held above)', () => {
  // dip to 90, then a higher-low sequence holding above 100 → the most recent held pivot is 100
  const lows = [120, 90, 100, 105, 102];
  // scanning from the end: 102≥105? no. 105≥100? yes → support = 100
  assert.equal(structuralSupport(lows), 100);
});

ok('support tracks the LATEST held pivot, not an older one', () => {
  const lows = [100, 101, 95, 96, 97]; // latest adjacent hold: 97≥96 → support 96
  assert.equal(structuralSupport(lows), 96);
});

/* --- strictly declining → N-day floor ------------------------------------------------------- */
ok('a strictly declining series degrades support to the recent floor (the min low)', () => {
  const lows = [130, 120, 110, 100, 90]; // no higher-low anywhere → floor = 90
  assert.equal(structuralSupport(lows), 90);
});

/* --- cut-trigger sits δ below support ------------------------------------------------------- */
ok('cut-trigger = support × (1 − δ) and is strictly below support', () => {
  const support = 18_250_000;
  const trig = cutTrigger(support);
  assert.equal(trig, support * (1 - CUT_TRIGGER_DELTA));
  assert.ok(trig < support);
  assert.equal(cutTrigger(null), null);            // null-safe
});


/* --- graceful degradation ------------------------------------------------------------------- */
ok('fewer than 2 usable lows → null (no crash, no fabricated level)', () => {
  assert.equal(structuralSupport([]), null);
  assert.equal(structuralSupport([100]), null);
  assert.equal(structuralSupport([null, undefined, 0]), null); // 0 / null filtered out → too few
  assert.equal(structuralSupport(undefined), null);
});

/* --- lookback window ------------------------------------------------------------------------ */
ok('only the most recent SUPPORT_LOOKBACK_DAYS lows are considered', () => {
  // a very old low outside the lookback must not become the floor
  const old = [1, 200, 201, 202, 203, 204]; // length 6 > lookback (5)
  const s = structuralSupport(old, SUPPORT_LOOKBACK_DAYS);
  // within the last 5 (200..204) it's monotonic up → higher-lows everywhere; most recent hold = 203
  assert.equal(s, 203);
  assert.ok(s !== 1);                               // the stale 1 is outside the window
});

console.log(`\nAll ${pass} checks passed.`);
