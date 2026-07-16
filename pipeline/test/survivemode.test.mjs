#!/usr/bin/env node
/**
 * survivemode.test.mjs — acceptance fixtures for surviveMode() (P1).
 *
 * surviveMode() is the POST-fetch survival doctrine renderMode() applies to each fetched+quoted row:
 * the falling-regime EXCLUSION (+ the --phase-rescue basing rescue), the SPEC-DRIVEN confirm (a spec with
 * confirm:'falling', i.e. scalp, requires a falling regime — N2), and the overnight-POSTURE filters. P1
 * extracted it verbatim from screen-flip-niches.mjs's inline renderMode loop into
 * the pure lib/gatecandidates.mjs so it is node-importable + fixture-testable with synthetic rows (no
 * live API / CLI state). This file PINS the byte-identical behavior — most importantly the
 * discardReason→disc-counter 1:1 map and the `rescued`-carries-through-a-later-gate contract that
 * lets the caller increment BOTH disc.rescued and disc.posture for one rescued-then-posture-dropped row.
 *
 * PIN (re-pinned at P5): the CURRENT pre-amendment falling-exclusion (falling ⇒ dropped unless
 * --phase-rescue basing). Ben's 2026-07-08 falling amendment lands at P5 — these fixtures change then,
 * and that diff IS the doctrine change. No live data (CLAUDE.md rule 4).
 * Run: `node pipeline/test/survivemode.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { surviveMode } from '../lib/gatecandidates.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// a clean, surviving quote row; individual tests override fields via spread.
const row = (over = {}) => ({ falling: false, rising: false, mom: 'ranging', regimeLabel: 'flat', reliable: true, optBuy: 1000, ...over });

// a 24h+ 5m series whose 16–24h-ago overnight window prints a low below bid*0.97 → overnightStaleRisk true.
function stale5m(bid) {
  const now = Date.now() / 1000, pts = [];
  for (let h = 24; h >= 0; h -= 0.25) {                 // 15-min spacing over 24h → ~97 points (≥24)
    const inWin = h >= 16 && h <= 24;                   // the OVERNIGHT_SPAN_H=8 forward window
    pts.push({ timestamp: now - h * 3600, avgLowPrice: inWin ? Math.round(bid * 0.90) : bid });
  }
  return pts;
}

console.log('surviveMode() acceptance:');

/* --- falling-exclusion (+ phase rescue) --------------------------------------------------- */
ok('a clean (non-falling) band row survives with no discard reason', () => {
  const sv = surviveMode('band', row(), { phase: 'base' }, {});
  assert.deepEqual(sv, { keep: true, discardReason: null, rescued: false, heldFallingOverride: false });
});

ok('a falling row is dropped (discardReason "falling"), rescue OFF', () => {
  const sv = surviveMode('band', row({ falling: true }), { phase: 'decay' }, { phaseRescue: false });
  assert.deepEqual(sv, { keep: false, discardReason: 'falling', rescued: false, heldFallingOverride: false });
});

ok('--phase-rescue + basing shape RESCUES a faller (kept, rescued:true)', () => {
  const sv = surviveMode('band', row({ falling: true }), { phase: 'basing' }, { phaseRescue: true });
  assert.deepEqual(sv, { keep: true, discardReason: null, rescued: true, heldFallingOverride: false });
});

ok('--phase-rescue but NOT basing (decay) still drops the faller', () => {
  const sv = surviveMode('band', row({ falling: true }), { phase: 'decay' }, { phaseRescue: true });
  assert.deepEqual(sv, { keep: false, discardReason: 'falling', rescued: false, heldFallingOverride: false });
});

ok('--phase-rescue with a null phase drops the faller (no basing to read)', () => {
  const sv = surviveMode('band', row({ falling: true }), null, { phaseRescue: true });
  assert.deepEqual(sv, { keep: false, discardReason: 'falling', rescued: false, heldFallingOverride: false });
});

/* --- P5: the falling doctrine is PER-SPEC (Ben's 2026-07-08 amendment) --------------------- */
ok('scalp (spec.falling="accept") KEEPS a falling row — falling is the scalp thesis, not a veto', () => {
  const sv = surviveMode('scalp', row({ falling: true }), { phase: 'decay' }, {});
  assert.deepEqual(sv, { keep: true, discardReason: null, rescued: false, heldFallingOverride: false });
});
ok('band still EXCLUDES the same falling row (existing niches unchanged — byte-identical)', () => {
  const sv = surviveMode('band', row({ falling: true }), { phase: 'decay' }, {});
  assert.deepEqual(sv, { keep: false, discardReason: 'falling', rescued: false, heldFallingOverride: false });
});
// Step 5 (Ben 2026-07-09): scalp is STRICT falling-only — a non-falling scalp is a band flip band owns.
ok('scalp DROPS a non-falling row ("notFalling") — scalp requires falling, not just accepts it', () => {
  const sv = surviveMode('scalp', row({ falling: false }), { phase: 'base' }, {});
  assert.deepEqual(sv, { keep: false, discardReason: 'notFalling', rescued: false, heldFallingOverride: false });
});
ok('scalp still applies overnight posture (accept ≠ bypass every gate) — a thin scalp drops overnight', () => {
  const sv = surviveMode('scalp', row({ falling: true, thin: true }), { phase: 'decay' }, { posture: 'overnight', thin: true });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: false, heldFallingOverride: false });
});

/* --- N2 (2026-07-14): confirm is SPEC-DRIVEN; the "rising" niche + its hardcoded confirm are DELETED --- */
ok('an unknown/deleted mode (e.g. "rising") has no spec → no confirm; a clean row survives', () => {
  // The old `mode === 'rising'` branch was dead code kept alive ONLY by this test (the rising spec was
  // deleted in Steps 3+4). N2 removed it and made confirm read spec.confirm, so an unknown mode simply has
  // no spec → nothing to confirm → it falls through to the posture/keep path.
  const sv = surviveMode('rising', row({ rising: false }), { phase: 'base' }, {});
  assert.equal(sv.keep, true, 'no spec ⇒ no confirm ⇒ kept');
});

ok('band (confirm:null) applies no confirm — a non-falling band row survives', () => {
  const sv = surviveMode('band', row({ falling: false }), { phase: 'base' }, {});
  assert.equal(sv.keep, true);
});

/* --- overnight posture filters ------------------------------------------------------------ */
ok('overnight drops a thin row (no thin fast-lane)', () => {
  const sv = surviveMode('band', row(), { phase: 'base' }, { posture: 'overnight', thin: true });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: false, heldFallingOverride: false });
});

ok('overnight drops an unknown-regime, non-rising row (needs confident flat/rising)', () => {
  const sv = surviveMode('band', row({ regimeLabel: 'unknown', rising: false }), { phase: 'base' }, { posture: 'overnight' });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: false, heldFallingOverride: false });
});

ok('overnight keeps a rising row even when regimeLabel isn\'t flat', () => {
  const sv = surviveMode('band', row({ regimeLabel: 'unknown', rising: true }), { phase: 'base' }, { posture: 'overnight' });
  assert.equal(sv.keep, true);
});

ok('overnight drops an unreliable-band row', () => {
  const sv = surviveMode('band', row({ reliable: false }), { phase: 'base' }, { posture: 'overnight' });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: false, heldFallingOverride: false });
});

ok('overnight drops a breakdown row', () => {
  const sv = surviveMode('band', row({ mom: 'breakdown' }), { phase: 'base' }, { posture: 'overnight' });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: false, heldFallingOverride: false });
});

ok('overnight drops a row whose overnight window would be stale/underwater by morning', () => {
  const sv = surviveMode('band', row({ optBuy: 1000 }), { phase: 'base' }, { posture: 'overnight', series5m: stale5m(1000) });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: false, heldFallingOverride: false });
});

ok('overnight keeps a confident flat/reliable/non-breakdown row with a non-stale (null) series', () => {
  const sv = surviveMode('band', row(), { phase: 'base' }, { posture: 'overnight', thin: false, series5m: null });
  assert.deepEqual(sv, { keep: true, discardReason: null, rescued: false, heldFallingOverride: false });
});

ok('active posture (default) applies NONE of the overnight filters', () => {
  const sv = surviveMode('band', row({ thin: true, reliable: false, regimeLabel: 'unknown' }), { phase: 'base' }, { posture: 'active', thin: true });
  assert.equal(sv.keep, true, 'active never runs the posture gate');
});

/* --- the load-bearing dual-counter invariant ---------------------------------------------- */
ok('a rescued faller later dropped by posture returns rescued:true AND discardReason:"posture"', () => {
  // In renderMode this increments BOTH disc.rescued (at rescue) and disc.posture (at the drop) —
  // the caller does `if (sv.rescued) disc.rescued++;` then `if (!sv.keep) disc[sv.discardReason]++`.
  const sv = surviveMode('band', row({ falling: true }), { phase: 'basing' }, { phaseRescue: true, posture: 'overnight', thin: true });
  assert.deepEqual(sv, { keep: false, discardReason: 'posture', rescued: true, heldFallingOverride: false });
});

console.log(`\nAll ${pass} acceptance checks passed.`);
