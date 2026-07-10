#!/usr/bin/env node
/**
 * rebid.test.mjs — pins the COD-3 cut-and-rebid helpers in js/quotecore.js.
 *
 * TWO things are pinned, at their two different confidence levels (rule 4):
 *   1. rebidBar(clear, spread) — the FRICTION arithmetic (SOLID): friction = tax(clear) + half the
 *      spread; threshold = clear − friction; marginPct = friction/clear. The ~2.5% figure /positions
 *      used as prose is now this number.
 *   2. rebidAdvice({clear, spread, trajectory, diurnal}) — the TRAJECTORY-BRANCH SELECTION (inform-grade):
 *      knife → against the rebid; oscillating → rebid at the diurnal trough / sell the daily peak; else →
 *      the friction bar governs. This test pins WHICH branch each trajectory shape selects + the level
 *      carry-through, NOT the (placeholder) classifier that produces the shape.
 * Pure — no fetch/fs/DOM. Run: `node pipeline/rebid.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { rebidBar, rebidAdvice } from '../js/quotecore.js';
import { tax } from '../js/format.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// --- rebidBar: the arithmetic ------------------------------------------------------------------
ok('rebidBar(null) → null (no clear price to bar against)', () => {
  assert.equal(rebidBar(null), null);
  assert.equal(rebidBar(null, 5000), null);
});

ok('rebidBar: friction = tax(clear) + half the spread; threshold = clear − friction', () => {
  const clear = 1_000_000, spread = 100_000;
  const bar = rebidBar(clear, spread);
  assert.equal(bar.friction, tax(clear) + spread / 2);
  assert.equal(bar.threshold, clear - (tax(clear) + spread / 2));
  assert.equal(bar.marginPct, bar.friction / clear * 100);
});

ok('rebidBar: default spread 0 → friction is just the tax (the ~2% floor)', () => {
  const clear = 1_000_000;
  const bar = rebidBar(clear);
  assert.equal(bar.friction, tax(clear));            // tax(1m) = 20000
  assert.equal(bar.threshold, clear - tax(clear));
  assert.ok(Math.abs(bar.marginPct - 2.0) < 1e-9);   // ~2%
});

ok('rebidBar: a real spread lifts the bar toward the ~2.5%+ /positions cited', () => {
  const clear = 1_000_000, spread = 30_000;          // 20000 tax + 15000 half-spread = 35000 = 3.5%
  const bar = rebidBar(clear, spread);
  assert.equal(bar.friction, 35_000);
  assert.ok(bar.marginPct >= 2.5);
});

ok('rebidBar: negative spread is floored at 0 (never a negative friction)', () => {
  const bar = rebidBar(1_000_000, -50_000);
  assert.equal(bar.friction, tax(1_000_000));        // half of a floored-0 spread = 0
});

// --- rebidAdvice: the trajectory-branch selection ----------------------------------------------
ok('knife → advise AGAINST the rebid (rebid=false, kind knife), bar still computed', () => {
  const a = rebidAdvice({ clear: 1_000_000, spread: 20_000, trajectory: { shape: 'knife' } });
  assert.equal(a.rebid, false);
  assert.equal(a.kind, 'knife');
  assert.equal(a.troughTarget, null);
  assert.ok(a.bar && a.bar.threshold != null);       // the bar is reported even though it's moot
  assert.match(a.why, /KNIFE/);
});

ok('oscillating + diurnal → rebid=true, targets the diurnal trough (bid) & daily peak (ask)', () => {
  const a = rebidAdvice({ clear: 1_000_000, spread: 20_000, trajectory: { shape: 'oscillating' }, diurnal: { bid: 940_000, ask: 1_030_000 } });
  assert.equal(a.rebid, true);
  assert.equal(a.kind, 'oscillating');
  assert.equal(a.troughTarget, 940_000);
  assert.equal(a.peakTarget, 1_030_000);
  assert.match(a.why, /OSCILLATES/);
});

ok('oscillating + no diurnal → still rebid=true, targets null (qualitative dip/peak in the prose)', () => {
  const a = rebidAdvice({ clear: 1_000_000, trajectory: { shape: 'oscillating' }, diurnal: null });
  assert.equal(a.rebid, true);
  assert.equal(a.troughTarget, null);
  assert.equal(a.peakTarget, null);
  assert.match(a.why, /diurnal dip/);
});

ok('flat/based/rising/unknown/absent trajectory → the friction bar governs (rebid=null, kind friction)', () => {
  for (const shape of ['flat', 'based', 'rising', 'elevated', 'unknown']) {
    const a = rebidAdvice({ clear: 1_000_000, spread: 20_000, trajectory: { shape } });
    assert.equal(a.rebid, null, `shape ${shape} should defer to the bar`);
    assert.equal(a.kind, 'friction');
    assert.ok(a.bar && a.bar.threshold != null);
  }
  const none = rebidAdvice({ clear: 1_000_000, trajectory: null });
  assert.equal(none.kind, 'friction');
});

ok('friction branch with no clear price → bar null, honest why', () => {
  const a = rebidAdvice({ clear: null, trajectory: { shape: 'flat' } });
  assert.equal(a.bar, null);
  assert.match(a.why, /no clear price/);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
