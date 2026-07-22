#!/usr/bin/env node
/**
 * oscillation-render.test.mjs — acceptance fixtures for PLAN-OSCILLATION-CYCLE Chunk 5: the drift-adjusted
 * exit LEVEL is folded into the SHARED trajectoryRead/floorCeilingTrack note path (formatFloorCeiling's
 * `drift` opt) so it rides beside EVERY price suggestion. INFORM/display-only — never a gate, never a verdict.
 *
 * PURE over synthetic fixtures — no live data, no fetch/fs (rule 4). Run:
 *   node pipeline/test/oscillation-render.test.mjs   (exits non-zero on any failure)
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - formatFloorCeiling's `drift` opt renders the drift-adjusted exit LEVEL (peak + trough) in the note.
 *   - it is a PROJECTED LEVEL, NEVER a rising/falling verdict — the drift clause carries NO direction word.
 *   - ±same-magnitude drift moves the rendered note by IDENTICAL arithmetic (equidistant either side of
 *     naive) — the direct guard against a directional render.
 *   - the surface DEGRADES CLEANLY: a null drift (projection unavailable) omits the clause; the rest of the
 *     note is byte-identical to a no-drift render.
 *   - the whole clause carries the n≈0 inform label (honesty, rule 4).
 */
import assert from 'node:assert/strict';
import { hourProfile, floorCeilingTrack, formatFloorCeiling } from '../../js/windowread.mjs';
import { diurnalForecast, driftAdjustedExit, driftExitFrom } from '../../js/forecast.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const idfmt = n => String(n);   // identity fmt so the assertions read the raw numbers

console.log('PLAN-OSCILLATION-CYCLE Chunk 5 acceptance:');

// helpers -----------------------------------------------------------------------------------------
const ts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const pt = (t, low, hi) => ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: 20, highPriceVolume: 20 });
function diurnal(days, { baseFn = () => 1000, dipHours = [3, 4, 5], peakHours = [15, 16, 17], dipD = 50, peakD = 70 } = {}) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = baseFn(di);
    s.push(pt(ts(2026, 0, 1 + di, h), base - (dipHours.includes(h) ? dipD : 0), base + (peakHours.includes(h) ? peakD : 10)));
  }
  return s;
}
const fcDay = (key, low, hi) => [key, { low, hi }];
// a windowStats().days-shaped array from per-day mids (band ±5), oldest→newest — for the slope source.
const daysFromMids = mids => mids.map((m, i) => [`2026-07-${String(i + 1).padStart(2, '0')}`, { low: m - 5, hi: m + 5 }]);

// a flat floor/ceiling fc read (a stable ranging item — the "every price suggestion, not just big-ticket" case).
const flatFc = () => {
  const lows = [1000, 1001, 1000, 1001, 1000, 1001, 1000];
  const his = [1100, 1101, 1100, 1101, 1100, 1101, 1100];
  return floorCeilingTrack(lows.map((l, i) => fcDay(`2026-07-0${i + 1}`, l, his[i])));
};

// ── 1. the drift clause renders the drift-adjusted exit LEVEL in the shared note ───────────────────
ok('formatFloorCeiling: the drift opt folds the drift-adjusted exit level (peak + trough) into the note', () => {
  const dae = { driftAdjustedPeak: 1160, driftAdjustedTrough: 940, confidence: 'low', holdHorizonDays: 1.5,
    ceilingSlope: -40, floorSlope: -40, naivePeak: 1200, naiveTrough: 980 };
  const line = formatFloorCeiling(flatFc(), idfmt, { drift: dae });
  assert.match(line, /drift-adj exit \(~1\.5d hold\): peak ~1160 \/ trough ~940/, 'both projected levels render');
  assert.match(line, /conf low/, 'the confidence ordinal rides the clause');
  assert.match(line, /n≈0 — inform, not a direction/, 'the honesty + not-a-direction label rides the clause');
});

// ── 2. it is a LEVEL, never a verdict — NO direction word in the drift clause ──────────────────────
ok('formatFloorCeiling: the drift clause carries NO rising/falling/up/down direction word (level, not a verdict)', () => {
  // a strongly DOWN-drifting dae — the render must still be a bare level, no "falling"/"down"/"↓" verdict.
  const downDae = { driftAdjustedPeak: 1100, driftAdjustedTrough: 900, confidence: 'low', holdHorizonDays: 1.5,
    ceilingSlope: -200, floorSlope: -200, naivePeak: 1200, naiveTrough: 980 };
  const line = formatFloorCeiling(flatFc(), idfmt, { drift: downDae });
  // isolate the drift clause (the last ` · `-joined part before the trailing honesty tail) and assert it is verdict-free
  const clause = line.split('drift-adj exit')[1];
  assert.ok(clause, 'the drift clause is present');
  assert.doesNotMatch(clause, /\b(rising|falling|risen|fallen|up|down|upward|downward|dropping|climbing)\b/i,
    'the drift clause names a LEVEL, never a direction verdict');
  assert.doesNotMatch(clause, /[↑↓]/, 'no direction arrows either');
});

// ── 3. DIRECTION-AGNOSTIC RENDER: ±same-magnitude drift moves the note by IDENTICAL arithmetic ─────
ok('render symmetry: +slope and −slope of equal magnitude render equidistant either side of naive', () => {
  const prof = hourProfile(diurnal(10), { nights: 14 });
  const fc = diurnalForecast(prof, { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true });
  const upDae = driftAdjustedExit(fc, { ceilingSlope: +80, floorSlope: +80 });
  const downDae = driftAdjustedExit(fc, { ceilingSlope: -80, floorSlope: -80 });
  // the arithmetic is symmetric on the raw numbers (Chunk 1) — assert the SAME symmetry survives the render.
  const grabPeak = dae => {
    const m = formatFloorCeiling(flatFc(), idfmt, { drift: dae }).match(/drift-adj exit \([^)]*\): peak ~(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const up = grabPeak(upDae), down = grabPeak(downDae), naive = Math.round(upDae.naivePeak);
  assert.ok(up != null && down != null, 'both peaks render');
  assert.equal(up - naive, naive - down, 'the rendered peaks are equidistant from naive — no directional asymmetry in the render');
  assert.ok(up > naive && down < naive, 'up-drift renders above naive, down-drift below — the SAME shift, opposite sign');
});

// ── 4. DEGRADE: null drift ⇒ the clause is omitted and the rest of the note is byte-identical ──────
ok('formatFloorCeiling: a null/absent drift omits the clause (degrade) — note byte-identical to no-drift', () => {
  const fc = flatFc();
  const withNull = formatFloorCeiling(fc, idfmt, { drift: null });
  const without = formatFloorCeiling(fc, idfmt, {});
  assert.doesNotMatch(withNull, /drift-adj exit/, 'null drift ⇒ no drift clause');
  assert.equal(withNull, without, 'a null drift render equals the no-drift render (no shape churn)');
});

ok('formatFloorCeiling: a drift with both levels null omits the clause (honest degrade, never a fake level)', () => {
  const dae = { driftAdjustedPeak: null, driftAdjustedTrough: null, confidence: 'low', holdHorizonDays: 1.5,
    ceilingSlope: null, floorSlope: null, naivePeak: null, naiveTrough: null };
  const line = formatFloorCeiling(flatFc(), idfmt, { drift: dae });
  assert.doesNotMatch(line, /drift-adj exit/, 'no usable level ⇒ no clause');
});

// ── 5. END-TO-END off driftExitFrom (the caller path): the note carries the in-hand-sourced level ──
ok('end-to-end: driftExitFrom off in-hand prof+days → the note renders a below-naive peak on a down-drift', () => {
  const prof = hourProfile(diurnal(10), { nights: 14 });
  const ctx = { liveLo: 1000, liveHi: 1010, now: new Date(2026, 0, 10, 12), phase: 'base', reliable: true };
  const naive = Math.round(diurnalForecast(prof, ctx).forecast.nextPeak.level);
  const downDays = daysFromMids([1300, 1270, 1240, 1210, 1180, 1150, 1120, 1090]);   // steadily falling ceiling
  const dae = driftExitFrom(prof, downDays, ctx);   // slopes sourced from downDays — NO fetch
  assert.ok(dae && dae.driftAdjustedPeak < naive, 'a down-drift days series pulls the adjusted peak below naive');
  const line = formatFloorCeiling(floorCeilingTrack(downDays), idfmt, { drift: dae });
  const m = line.match(/drift-adj exit \([^)]*\): peak ~(\d+)/);
  assert.ok(m, 'the drift clause rendered');
  assert.ok(Number(m[1]) < naive, `the rendered peak (${m[1]}) is below naive (${naive}) — the level moved, no verdict`);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
