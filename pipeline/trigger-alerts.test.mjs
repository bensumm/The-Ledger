#!/usr/bin/env node
/**
 * alerts.test.mjs — the push-notification trigger contract (TD2.3, N1 engine).
 *
 * alerts.mjs used to run (and FETCH) on import via a top-level `await runPositions()`; it now
 * sits behind the standard `import.meta.url === pathToFileURL(argv[1])` guard so it's importable
 * for these tests. positionSignal (the per-held-item transition-KEY generator) and quietSuppresses
 * (the one pure quiet-hours rule) are exported; both are pinned here.
 *
 * BUSINESS REQUIREMENTS (the N1 contract):
 *   - TRANSITION-ONLY: positionSignal returns a STABLE `sig` for an unchanged situation, so the
 *     same verdict on two consecutive runs is ONE alert (the engine fires only when sig changes).
 *     A verdict escalation (or a strength change) yields a DIFFERENT sig → a fresh alert.
 *   - An unreliable quote (Gate-0) yields NO position alert (no decisive push off a non-price).
 *   - QUIET HOURS (22:00–06:00 local) suppress POSITION and PRICE alerts but never FILLS.
 *
 * Synthetic rows only — no network, no positions.json. positionSignal is passed hand-built
 * quote rows exactly as computeQuote would shape them.
 * Run: `node pipeline/alerts.test.mjs`  (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { positionSignal, quietSuppresses, QUIET_EXEMPT_CLASSES } from './trigger-alerts.mjs';
import { isOvernightNow, MOM_STRONG_PCT } from '../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// A held-lot quote row shaped like computeQuote's output; overrides tune the verdict.
const row = o => ({ quickSell: 90, mom: 'clean', momPct: 0, reliable: true, ordered: true,
                    falling: false, rising: false, optSell: null, rawBandHi: 100, ...o });
const BE = 100;                      // break-even 100 → quickSell 90 is underwater
const SMALL_LOT = 1000;              // < BIG_TICKET_GP so the shock branch could apply (we pass ts5m=null to skip it)

/* --- transition key: same situation → same sig (⇒ one alert) ------------------------------ */
ok('positionSignal returns a STABLE sig for an unchanged CUT situation (same verdict = one alert)', () => {
  const r = row({ mom: 'breakdown', momPct: 0.05 });   // breakdown + underwater → CUT, strong (↓↓)
  const s1 = positionSignal(r, BE, SMALL_LOT, null);
  const s2 = positionSignal(r, BE, SMALL_LOT, null);
  assert.ok(s1 && s1.verdict === 'CUT');
  assert.equal(s1.sig, s2.sig);                          // identical sig → engine's `prev.sig!==s.sig` is false → no re-fire
  assert.equal(s1.sig, 'CUT+↓↓');                        // strong breakdown tags the sig
});

ok('a clean, in-profit, reliable held lot produces NO signal (baseline clears, nothing to alert)', () => {
  const r = row({ mom: 'clean', quickSell: 120 });       // 120 > BE 100 → not underwater, clean
  assert.equal(positionSignal(r, BE, SMALL_LOT, null), null);
});

ok('escalation changes the sig: HOLD/none → CUT is a transition (fresh alert)', () => {
  const calm = row({ mom: 'clean', quickSell: 120 });
  const cut = row({ mom: 'breakdown', momPct: 0.05 });
  const sCalm = positionSignal(calm, BE, SMALL_LOT, null);
  const sCut = positionSignal(cut, BE, SMALL_LOT, null);
  assert.equal(sCalm, null);
  assert.ok(sCut && sCut.sig !== (sCalm && sCalm.sig));   // null → 'CUT+↓↓' is a change
});

ok('a strength change (single ↓ CUT vs strong ↓↓ CUT) yields a DIFFERENT sig → re-fires', () => {
  const weak = row({ mom: 'breakdown', momPct: MOM_STRONG_PCT / 2 }); // below strong threshold
  const strong = row({ mom: 'breakdown', momPct: 0.05 });
  const sWeak = positionSignal(weak, BE, SMALL_LOT, null);
  const sStrong = positionSignal(strong, BE, SMALL_LOT, null);
  assert.equal(sWeak.verdict, 'CUT');
  assert.equal(sWeak.sig, 'CUT');                         // no ↓↓ tag when the break is weak
  assert.equal(sStrong.sig, 'CUT+↓↓');
  assert.notEqual(sWeak.sig, sStrong.sig);
});

ok('an unreliable quote (Gate 0) produces NO position signal — no decisive push off a non-price', () => {
  const r = row({ mom: 'breakdown', momPct: 0.05, reliable: false });
  assert.equal(positionSignal(r, BE, SMALL_LOT, null), null);
});

/* --- quiet-hours contract ----------------------------------------------------------------- */
ok('quiet hours suppress POSITION and PRICE but never FILL', () => {
  assert.equal(quietSuppresses('position', true), true);
  assert.equal(quietSuppresses('price', true), true);
  assert.equal(quietSuppresses('fill', true), false);    // fills are exempt — a completed trade always buzzes
  assert.ok(QUIET_EXEMPT_CLASSES.has('fill'));
});

ok('outside quiet hours nothing is suppressed', () => {
  for (const c of ['position', 'price', 'fill']) assert.equal(quietSuppresses(c, false), false);
});

ok('the rule tracks the real overnight clock (isOvernightNow): 23:00 local suppresses position, not fill', () => {
  const night = new Date(2026, 6, 4, 23, 0, 0);  // 23:00 local → overnight
  const day = new Date(2026, 6, 4, 12, 0, 0);    // 12:00 local → not overnight
  assert.equal(isOvernightNow(night), true);
  assert.equal(isOvernightNow(day), false);
  assert.equal(quietSuppresses('position', isOvernightNow(night)), true);
  assert.equal(quietSuppresses('fill', isOvernightNow(night)), false);   // fill exempt even at night
  assert.equal(quietSuppresses('position', isOvernightNow(day)), false);
});

console.log(`\nAll ${pass} checks passed.`);
