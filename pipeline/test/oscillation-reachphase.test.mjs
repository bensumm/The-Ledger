#!/usr/bin/env node
/**
 * oscillation-reachphase.test.mjs — PLAN-OSCILLATION-CYCLE F-F: the trough-vs-decay DISPLAY annotation
 * on the amplitude reach cell (`reachPhaseNote` in pipeline/commands/screen-flip-niches.mjs).
 *
 * The classifier is a pure function over three signals ALREADY in scope at the amplitude gate stage
 * (osc.oscillating + dae.floorSlope sign + driftShadow.margin sign) — no compute/fetch, DISPLAY-only.
 * PURE over synthetic shapes — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/oscillation-reachphase.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (one fixture per branch of the 2×2, resolved by margin sign):
 *   (a) oscillating + floor≥0                → "trough phase — floor holding, oscillation intact" (BUY signal)
 *   (c) oscillating + floor<0, margin>0      → "…falling floor — drift margin still clears"
 *   (c') oscillating + floor<0, margin≤0     → "…falling floor — drift margin does not clear"
 *   (b) knife (falling floor)                → "no real cycle to harvest"
 *   (d) knife + RISING floor (Aldarium hollow) → ALSO "no real cycle to harvest" and NOT any direction
 *       word ("decay"/"rising"/"falling") — THE load-bearing pin: the knife bucket is direction-agnostic,
 *       so a rising-floor collapsed-amplitude mirage is never mislabeled a "decay".
 */
import assert from 'node:assert/strict';
import { reachPhaseNote } from '../commands/screen-flip-niches.mjs';

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// (a) oscillating + floor holding (≥0) → trough phase / BUY
eq(
  reachPhaseNote({ oscillating: true }, { floorSlope: 0 }, { margin: -50 }),
  'trough phase — floor holding, oscillation intact',
  '(a) oscillating + floor≥0 → trough phase (margin sign IGNORED on this branch)',
);
eq(
  reachPhaseNote({ oscillating: true }, { floorSlope: 1200 }, null),
  'trough phase — floor holding, oscillation intact',
  '(a) oscillating + rising floor → still trough phase',
);

// (c) oscillating + falling floor, margin clears
eq(
  reachPhaseNote({ oscillating: true }, { floorSlope: -800 }, { margin: 120 }),
  'oscillating into a falling floor — drift margin still clears',
  '(c) oscillating + floor<0 + margin>0 → still clears',
);

// (c') oscillating + falling floor, margin does not clear (≤0)
eq(
  reachPhaseNote({ oscillating: true }, { floorSlope: -800 }, { margin: 0 }),
  'oscillating into a falling floor — drift margin does not clear',
  "(c') oscillating + floor<0 + margin==0 → does not clear",
);
eq(
  reachPhaseNote({ oscillating: true }, { floorSlope: -800 }, { margin: -300 }),
  'oscillating into a falling floor — drift margin does not clear',
  "(c') oscillating + floor<0 + margin<0 → does not clear",
);

// (b) knife with a FALLING floor → no cycle to harvest (no direction word)
eq(
  reachPhaseNote({ oscillating: false }, { floorSlope: -900 }, { margin: -400 }),
  'no real cycle to harvest',
  '(b) knife (falling floor) → no real cycle to harvest',
);

// (d) THE LOAD-BEARING PIN — knife with a RISING floor + collapsed amplitude (the Aldarium hollow mirage:
// rising+hollow → {oscillating:false, knife:true}). Must ALSO read "no real cycle to harvest" and must NOT
// carry ANY floor-direction word — "decay" on a rising item would be exactly the direction-labeling the
// whole program retired.
const aldarium = reachPhaseNote({ oscillating: false, knife: true }, { floorSlope: 1147 }, { margin: 90 });
eq(aldarium, 'no real cycle to harvest', '(d) knife + RISING floor → no real cycle to harvest');
for (const word of ['decay', 'rising', 'falling', 'floor']) {
  ok(!aldarium.toLowerCase().includes(word), `(d) knife bucket is direction-agnostic — must NOT contain "${word}"`);
}

// degrade: null osc (too few days to score) → treated as no cycle, never throws
eq(reachPhaseNote(null, null, null), 'no real cycle to harvest', 'degrade: null osc → no real cycle to harvest');
// degrade: oscillating but no dae (floorSlope unknown) → default to the floor-holding branch (null ⇒ 0)
eq(
  reachPhaseNote({ oscillating: true }, null, null),
  'trough phase — floor holding, oscillation intact',
  'degrade: oscillating + null dae → trough phase (unknown slope treated as ≥0)',
);

console.log(`✓ oscillation-reachphase.test.mjs — ${pass} checks passed`);
