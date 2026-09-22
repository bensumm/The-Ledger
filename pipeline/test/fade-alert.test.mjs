#!/usr/bin/env node
/**
 * fade-alert.test.mjs — acceptance fixtures for watch-positions.mjs's FADE alert
 * (PLAN-HOLD-FADE-ALERT HF2). Synthetic series only — no fetch, no archive (rule 4).
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - the Diamond-bolts 09-21 shape (12 completed hours under the 7d-profile HIGH + a fading cushion
 *     + a lagging live pace) produces ONE FADE alert carrying the 12h magnitude, the cushion
 *     from→to, the pace gap, and the price-to-sell-EARLY list-at (BE-floored fold sell);
 *   - the healthy 09-20 shape (printing AT profile, on-pace) produces NO FADE;
 *   - FADE fires on EITHER half (R-HF-3; HF1's decisive run kept R-HF-2): an alert-grade
 *     hours-under-profile run (≥ FADE_MIN_HOURS) triggers even without the composite, the composite
 *     triggers even on a profile-tracking day, and below the bar with a quiet composite nothing
 *     fires; the hours clause is omitted below FADE_MIN_HOURS;
 *   - fadeAlert is a pure read of it._fade — an unevaluable read never alerts.
 * SCOPE HONESTY: these fixtures drive fadeAlert + the SAME primitives the held-lot loop composes
 * (hoursUnderProfile / windowStats / hourProfile / askExitRead / reachMarginTrigger). The loop's
 * GLUE is not fixturable without a fetch mock: the HOURS-half glue is live-proven (a real FADE
 * fired on the 2026-09-22 watch pass — last-report evidence in the review record); the COMPOSITE
 * half's glue (aerLive construction, dr.profile threading, listAt off _estShadow) is verified by
 * the replication below only, and composeFade diverges from the loop in three named ways
 * (hourProfile direct vs lap.profile; hand-built live vs quickStale/quoteAgeMin; constant ask vs
 * thesis??optSell) — a regression confined to that glue keeps this suite green.
 */
import assert from 'node:assert/strict';
import { fadeAlert, cutGapClause, FLICKER_GP } from '../commands/watch-positions.mjs';
import { hoursUnderProfile, fadeMinGp, fadeEntryRead, FADE_MIN_HOURS } from '../lib/market/hourly-lmh.mjs';
import { windowStats, hourProfile, askExitRead, reachMarginTrigger } from '../../js/windowread.mjs';
import { breakEven } from '../../js/quotecore.js';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const pt = (y, mo, d, h, low, high) => ({
  timestamp: Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000),
  avgLowPrice: low, avgHighPrice: high, lowPriceVolume: 500, highPriceVolume: 500,
});

console.log('FADE alert (watch-positions) acceptance:');

// ── the Diamond-bolts 09-21 shape, synthesized on Jan 2–9 2026 (no DST edge) ──────────────────
// Days 1–7: full days whose daily HIGH steps down 2780 → 2742 (the fading cushion over ask 2735).
// Day 8 (today): hours 0–4 print AT the profile; hours 5–16 print 2700 (≥40 under it, 12 hours);
// the read happens at 17:43 (the real first-CUT pass) with a live instabuy 2,690 lagging the
// hour median — 12 COMPLETED under-hours, exactly the plan's anchor count.
const ASK = 2735;
const priorHi = [2780, 2772, 2764, 2756, 2750, 2745, 2742];   // day 2 … day 8 (7 prior days)
const bolts = [];
for (let i = 0; i < 7; i++) {
  for (let h = 0; h < 24; h++) bolts.push(pt(2026, 0, 2 + i, h, priorHi[i] - 90, priorHi[i]));
}
for (let h = 0; h < 18; h++) {
  const high = h < 5 ? 2742 : 2700;
  bolts.push(pt(2026, 0, 9, h, high - 90, high));
}
const NOW = new Date(2026, 0, 9, 17, 43, 0);
const LIVE = { lo: 2612, hi: 2690, staleLo: false, staleHi: false };

// compose _fade with the loop's primitives (argument DIVERGENCES from the real loop: header above)
function composeFade(ts1h, { ask = ASK, live = LIVE, now = NOW, quickSell = live.hi, estSell = null, be = null } = {}) {
  const hup = hoursUnderProfile(ts1h, { minGp: fadeMinGp(quickSell), now });
  const f = hup ? { hours: hup.hours, maxDeficit: hup.maxDeficit, minGp: hup.minGp, trigger: null, rm: null } : null;
  const dayStats = windowStats(ts1h, { nights: 14, wStart: 0, wEnd: 0, now });
  const prof = hourProfile(ts1h, { nights: 14, now });
  const aer = askExitRead(dayStats, { ask, stats5m: null, profile: prof, live, now });
  const rm = aer && aer.ask ? aer.ask.reachMargin : null;
  const out = f || { hours: null, maxDeficit: null, minGp: null, trigger: null, rm: null };
  out.trigger = reachMarginTrigger(rm); out.rm = rm || null;
  out.listAt = estSell != null ? Math.max(be ?? 0, Math.round(estSell)) : null;
  return out;
}

const BE = breakEven(2655);
const boltsFade = composeFade(bolts, { estSell: 2716, be: BE });

ok('fixture sanity: the shape really is 12 completed hours under the profile + a firing composite', () => {
  assert.equal(boltsFade.hours, 12, `hours 5–16 sit ≥ minGp(${boltsFade.minGp}) under the 7d-profile HIGH`);
  assert.equal(boltsFade.rm.trend, 'fading', 'the daily cushion over 2,735 is collapsing');
  assert.equal(boltsFade.rm.pace.onPace, false, 'live 2,690 lags the hour median');
  assert.equal(boltsFade.trigger, true);
});
ok('the 09-21 shape → ONE FADE alert: 12h magnitude, cushion from→to, pace, list-at (BE-floored)', () => {
  const a = fadeAlert({ name: 'Diamond dragon bolts (e)', be: BE, _fade: boltsFade });
  assert.equal(a.level, 'FADE');
  assert.ok(a.msg.includes('12h'), `the hours magnitude must lead: ${a.msg}`);
  assert.ok(/cushion .*fading/.test(a.msg), `the cushion half: ${a.msg}`);
  assert.ok(/pace −\d+ lagging/.test(a.msg), `the pace half: ${a.msg}`);
  assert.ok(a.msg.includes('price-to-sell-EARLY'), `the actionable fold list-at: ${a.msg}`);
  assert.ok(a.msg.includes('BE'), `break-even rides along: ${a.msg}`);
});
ok('the healthy 09-20 shape (printing AT profile, on-pace) → no FADE', () => {
  // flat prior days + today printing at the profile, live at the hour median
  const healthy = [];
  for (let i = 0; i < 7; i++) for (let h = 0; h < 24; h++) healthy.push(pt(2026, 0, 2 + i, h, 2650, 2740));
  for (let h = 0; h < 20; h++) healthy.push(pt(2026, 0, 9, h, 2650, 2740));
  const f = composeFade(healthy, { live: { lo: 2650, hi: 2740, staleLo: false, staleHi: false } });
  assert.equal(f.hours, 0);
  assert.notEqual(f.trigger, true);
  assert.equal(fadeAlert({ name: 'x', be: BE, _fade: f }), null);
});
ok('an alert-grade under-print ALONE fires (the hours half is a TRIGGER — R-HF-2 stood at the decisive run)', () => {
  // 12h under-print but the cushion is HEALTHY (prior days flat and far above the ask) and live is
  // on pace ⇒ the composite stays quiet — and the hours half still alerts, magnitude-first.
  const underOnly = [];
  for (let i = 0; i < 7; i++) for (let h = 0; h < 24; h++) underOnly.push(pt(2026, 0, 2 + i, h, 2700, 2800));
  for (let h = 0; h < 20; h++) underOnly.push(pt(2026, 0, 9, h, 2650, h < 17 ? 2750 : 2800));
  const f = composeFade(underOnly, { ask: 2735, live: { lo: 2650, hi: 2800, staleLo: false, staleHi: false } });
  assert.ok(f.hours >= FADE_MIN_HOURS, `fixture sanity: a real under-run (${f.hours}h)`);
  assert.notEqual(f.trigger, true, 'fixture sanity: healthy cushion / on-pace ⇒ the composite is quiet');
  const a = fadeAlert({ name: 'x', be: BE, _fade: f });
  assert.equal(a.level, 'FADE');
  assert.ok(a.msg.includes('under the 7d profile'), `the hours magnitude carries the alert: ${a.msg}`);
  assert.ok(!/cushion/.test(a.msg), `the quiet composite half is omitted, never printed as "ok": ${a.msg}`);
});
ok('an hours-only FADE never narrates the quiet composite — no fabricated "lagging"/cushion clause', () => {
  // composite evaluated and NOT firing (live ON pace, gap +120) while the hours half fires: the
  // review repro — the old builder printed `pace +120 lagging` and a cushion clause off this shape.
  const rm = { trend: 'fading', cushionFrom: 45, cushionTo: 5, cushionNow: -12,
               pace: { stale: false, onPace: true, gap: 120 } };
  const a = fadeAlert({ name: 'x', be: BE, _fade: { hours: 12, maxDeficit: 55, minGp: 27, trigger: false, rm, listAt: null } });
  assert.equal(a.level, 'FADE', 'the hours half still alerts');
  assert.ok(a.msg.includes('12h'), a.msg);
  assert.ok(!a.msg.includes('lagging'), `no fabricated pace clause: ${a.msg}`);
  assert.ok(!a.msg.includes('cushion'), `no cushion clause off a non-firing composite: ${a.msg}`);
});
ok('unevaluable / sub-bar never alerts; a sub-FADE_MIN_HOURS hours clause is omitted on a composite fire', () => {
  assert.equal(fadeAlert({ name: 'x', be: BE, _fade: null }), null);
  assert.equal(fadeAlert({ name: 'x', be: BE, _fade: { hours: FADE_MIN_HOURS - 1, maxDeficit: 40, trigger: null, rm: null } }), null,
    'below the bar with no composite read ⇒ quiet');
  const a = fadeAlert({ name: 'x', be: BE, _fade: { hours: FADE_MIN_HOURS - 1, maxDeficit: 40, minGp: 27,
    trigger: true, rm: { trend: 'fading', cushionFrom: 45, cushionTo: 5, pace: { stale: false, onPace: false, gap: -50 } }, listAt: null } });
  assert.equal(a.level, 'FADE');
  assert.ok(!a.msg.includes('under the 7d profile'), `a sub-bar run is not printed as magnitude: ${a.msg}`);
  assert.ok(/cushion \+45→\+5 fading/.test(a.msg), `cushion half still renders: ${a.msg}`);
});

// ── fadeEntryRead — the ENTRY composition executed DIRECTLY (review finding: it had no direct
// test; the degrade paths are where the bugs live) ────────────────────────────────────────────
console.log('\nfadeEntryRead acceptance:');

ok('happy path on the bolts shape: trigger true + alert-grade hours', () => {
  const f = fadeEntryRead(bolts, { ask: ASK, liveLo: LIVE.lo, liveHi: LIVE.hi, now: NOW });
  assert.equal(f.trigger, true);
  assert.equal(f.hours, 12);
});
ok('no price reference at all (liveHi and ask both null) ⇒ null — never a 1-gp hair-trigger bar', () => {
  assert.equal(fadeEntryRead(bolts, { now: NOW }), null,
    'fadeMinGp(null) would default the deficit bar to 1 gp and fire on noise (review finding)');
});
ok('ask null ⇒ composite unevaluable (trigger null); the hours half still reads off liveHi', () => {
  const f = fadeEntryRead(bolts, { liveHi: LIVE.hi, now: NOW });
  assert.equal(f.trigger, null);
  assert.equal(f.hours, 12);
});
ok('a STALE sell side refuses the pace read ⇒ trigger null, hours unaffected', () => {
  const f = fadeEntryRead(bolts, { ask: ASK, liveLo: LIVE.lo, liveHi: LIVE.hi, staleHi: true, now: NOW });
  assert.equal(f.trigger, null, 'a stale print is not a pace');
  assert.equal(f.hours, 12);
});
ok('a sub-bar run is NULLED (alert-grade only leaves this function)', () => {
  // healthy prior days + today printing at profile ⇒ hours 0 < FADE_MIN_HOURS ⇒ null hours
  const flat = [];
  for (let i = 0; i < 7; i++) for (let h = 0; h < 24; h++) flat.push(pt(2026, 0, 2 + i, h, 2650, 2740));
  for (let h = 0; h < 18; h++) flat.push(pt(2026, 0, 9, h, 2650, 2740));
  const f = fadeEntryRead(flat, { ask: 2735, liveLo: 2650, liveHi: 2740, now: NOW });
  assert.equal(f.hours, null);
});

// ── HF3: the CUT magnitude clause + [flicker] tag ─────────────────────────────────────────────
// BUSINESS REQUIREMENTS pinned here:
//   - CUT/CUT-CANDIDATE text carries the quick-sell's signed gap vs cost AND vs BE;
//   - |gap to BE| ≤ FLICKER_GP tags [flicker] (the override rule keys on the tag);
//   - a quick-sell through the V2 cut-trigger prints `through cut-trigger <t>` — the tripwire fact
//     is READ off the alert, not remembered;
//   - no quick-sell ⇒ empty clause (never a fabricated gap).
console.log('\ncutGapClause (HF3) acceptance:');

ok('a −3 gp graze tags [flicker]; the gaps are signed and both bases print', () => {
  const c = cutGapClause({ row: { quickSell: 2707 }, avgCost: 2655, be: 2710, _cutTrigger: null });
  assert.ok(c.includes('+52 vs cost'), c);
  assert.ok(c.includes('−3 vs BE'), c);
  assert.ok(c.includes('[flicker]'), `|−3| ≤ FLICKER_GP(${FLICKER_GP}): ${c}`);
  assert.ok(!c.includes('through cut-trigger'), c);
});
ok('a −45 gp break: NO [flicker], and `through cut-trigger` prints when the trigger is set and breached', () => {
  const c = cutGapClause({ row: { quickSell: 2612 }, avgCost: 2655, be: 2710, _cutTrigger: 2624 });
  assert.ok(c.includes('−43 vs cost') && c.includes('−98 vs BE'), c);
  assert.ok(!c.includes('[flicker]'), c);
  assert.ok(c.includes('through cut-trigger 2,624'), c);
});
ok('a quick-sell ABOVE the trigger does not print `through`; a missing quick-sell yields an empty clause', () => {
  const c = cutGapClause({ row: { quickSell: 2700 }, avgCost: 2655, be: 2710, _cutTrigger: 2624 });
  assert.ok(!c.includes('through cut-trigger'), c);
  assert.equal(cutGapClause({ row: { quickSell: null }, avgCost: 2655, be: 2710 }), '');
  assert.equal(cutGapClause({ row: {}, avgCost: null, be: null }), '');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
