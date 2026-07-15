#!/usr/bin/env node
/**
 * recovery.test.mjs — the watch loop's ADVISORY recover-vs-drop forecast (chunk V6).
 *
 * lib/recovery.mjs COMPOSES signals momVerdict already computes (diurnal seasonal · regime/phase
 * trend · underwater persistence · position vs the V2 support level) into a LEAN + a rendered line,
 * and gates WHEN that line surfaces. It is ADVISORY — it decides nothing, changes no verdict, raises
 * no alert. This pins the composition, the honesty caps, and the trigger gating so a future editor
 * can't quietly turn the lean into a decision or over/under-surface it.
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - Canonical composition: quiet-trough + flat + at-support → recovers; falling + underwater-
 *     through-a-liquid-window → drops; basing + rising → recovers; conflicting inputs → uncertain.
 *   - HONESTY: a `spike` phase CAPS confidence — a would-be decisive lean is downgraded to uncertain
 *     (blind to a repricing); the rendered line always carries "(a lean, not a probability)".
 *   - A decisive lean needs ≥ LEAN_MARGIN concordant drivers; a tie / lone signal → uncertain.
 *   - Trigger gating surfaces on a non-clean position (underwater / thin-margin / ask-not-filling /
 *     lean-conflicts-verdict / a direction-dependent bid) and is SILENT on a cleanly-good one.
 *
 * Synthetic fixtures only. Run: `node pipeline/test/recovery.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import {
  recoveryRead, recoveryLine, recoveryTrigger, verdictPolarity, leanConflictsVerdict, LEAN_MARGIN,
} from '../lib/recovery.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const flat    = { label: 'flat', rising: false, falling: false };
const rising  = { label: 'rising', rising: true, falling: false };
const falling = { label: 'falling', rising: false, falling: true };
const troughRecovered = { quiet: true, yesterdayDipped: true, yesterdayRecovered: true };

/* --- canonical composition ------------------------------------------------------------------- */
ok('quiet-trough + flat regime + at support → likely-recovers', () => {
  const r = recoveryRead({ diurnal: troughRecovered, regime: flat, phase: null,
    underwater: { coveredLiquidPeak: false }, price: 100, support: 95 });
  assert.equal(r.lean, 'likely-recovers');
  assert.deepEqual(r.drivers, ['post-trough hour', 'flat regime', 'at support']);
});

ok('falling regime + underwater through a liquid window → likely-drops', () => {
  const r = recoveryRead({ diurnal: null, regime: falling, phase: null,
    underwater: { coveredLiquidPeak: true }, price: null, support: null });
  assert.equal(r.lean, 'likely-drops');
  assert.ok(r.drivers.includes('falling regime'));
  assert.ok(r.drivers.includes('underwater through a liquid window'));
});

ok('basing phase + rising regime → likely-recovers', () => {
  const r = recoveryRead({ diurnal: null, regime: rising, phase: { phase: 'basing' },
    underwater: null, price: null, support: null });
  assert.equal(r.lean, 'likely-recovers');
  assert.deepEqual(r.drivers, ['rising regime', 'basing']);
});

ok('conflicting inputs (falling but at support) → uncertain', () => {
  const r = recoveryRead({ diurnal: null, regime: falling, phase: null,
    underwater: { coveredLiquidPeak: false }, price: 100, support: 95 });
  // falling → drop 1 · at support → recover 1 · net 0
  assert.equal(r.recover, 1);
  assert.equal(r.drop, 1);
  assert.equal(r.lean, 'uncertain');
});

ok('a lone weak signal (< LEAN_MARGIN) → uncertain', () => {
  const r = recoveryRead({ diurnal: null, regime: flat, phase: null, underwater: null });
  assert.equal(r.recover, 1);          // just the flat-regime recover vote
  assert.ok(r.recover < LEAN_MARGIN);
  assert.equal(r.lean, 'uncertain');
});

/* --- HONESTY: a spike caps confidence -------------------------------------------------------- */
ok('a spike phase CAPS confidence — a would-be recover lean is downgraded to uncertain', () => {
  const r = recoveryRead({ diurnal: troughRecovered, regime: rising, phase: { phase: 'spike' },
    underwater: null, price: 100, support: 95 });
  assert.equal(r.spike, true);
  assert.equal(r.lean, 'uncertain');   // recover votes present, but spike forces uncertain
  assert.ok(r.drivers.some(d => d.includes('spike')));
});

/* --- rendered line + honesty caveat ---------------------------------------------------------- */
ok('recoveryLine renders label + drivers + the "a lean, not a probability" caveat', () => {
  const r = recoveryRead({ diurnal: troughRecovered, regime: flat, phase: null,
    underwater: { coveredLiquidPeak: false }, price: 100, support: 95 });
  assert.equal(recoveryLine(r),
    'recovery-read: likely recovers — post-trough hour · flat regime · at support (a lean, not a probability)');
  assert.equal(recoveryLine(null), null);
  const drops = recoveryRead({ regime: falling, underwater: { coveredLiquidPeak: true } });
  assert.ok(recoveryLine(drops).startsWith('recovery-read: likely drops — '));
});

/* --- verdict polarity + conflict ------------------------------------------------------------- */
ok('verdictPolarity classifies hold / cut / neutral', () => {
  assert.equal(verdictPolarity('HOLD — list high'), 'hold');
  assert.equal(verdictPolarity('DIURNAL-WATCH'), 'hold');
  assert.equal(verdictPolarity('CUT-CANDIDATE'), 'cut');
  assert.equal(verdictPolarity('LIST-TO-CLEAR'), 'cut');
  assert.equal(verdictPolarity('UNDERWATER'), 'cut');
  assert.equal(verdictPolarity('NO-READ'), 'neutral');
});

ok('leanConflictsVerdict: green/hold with a drop-lean, and cut with a recover-lean (only decisive leans)', () => {
  assert.equal(leanConflictsVerdict('likely-drops', 'HOLD — list high'), true);   // the highest-value case
  assert.equal(leanConflictsVerdict('likely-recovers', 'CUT-CANDIDATE'), true);   // the webweaver anchor
  assert.equal(leanConflictsVerdict('likely-recovers', 'HOLD — list high'), false);
  assert.equal(leanConflictsVerdict('uncertain', 'HOLD — list high'), false);
});

/* --- TRIGGER gating: surface on a non-clean position, silent on a clean one ------------------ */
ok('held trigger surfaces when underwater', () => {
  const t = recoveryTrigger({ kind: 'held', instabuy: 90, breakEven: 100, lean: 'likely-drops', verdict: 'CUT-CANDIDATE' });
  assert.equal(t.surface, true);
  assert.ok(t.reasons.includes('underwater'));
});

ok('held trigger surfaces on a thin margin just above break-even', () => {
  const t = recoveryTrigger({ kind: 'held', instabuy: 100.5, breakEven: 100, lean: 'uncertain', verdict: 'HOLD' });
  assert.equal(t.surface, true);
  assert.ok(t.reasons.includes('thin margin above break-even'));
});

ok('held trigger surfaces on an ask that is listed but not filling', () => {
  const t = recoveryTrigger({ kind: 'held', instabuy: 120, breakEven: 100, lean: 'likely-recovers',
    verdict: 'HOLD', askListedNotFilling: true });
  assert.equal(t.surface, true);
  assert.ok(t.reasons.includes('ask not filling'));
});

ok('held trigger surfaces when the lean CONFLICTS with the verdict (green lot, drop-lean)', () => {
  const t = recoveryTrigger({ kind: 'held', instabuy: 120, breakEven: 100, lean: 'likely-drops', verdict: 'HOLD — list high' });
  assert.equal(t.surface, true);
  assert.ok(t.reasons.includes('lean conflicts with verdict'));
});

ok('held trigger is SILENT on a cleanly-good position (comfortably green, filling, no conflict)', () => {
  const t = recoveryTrigger({ kind: 'held', instabuy: 120, breakEven: 100, lean: 'likely-recovers',
    verdict: 'HOLD — list high', askListedNotFilling: false });
  assert.equal(t.surface, false);
  assert.deepEqual(t.reasons, []);
});

ok('bid trigger surfaces only when the fill hinges on direction', () => {
  assert.equal(recoveryTrigger({ kind: 'bid', bidDirectional: true }).surface, true);
  assert.equal(recoveryTrigger({ kind: 'bid', bidDirectional: false }).surface, false);
});

console.log(`\nAll ${pass} checks passed.`);
