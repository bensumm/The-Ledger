#!/usr/bin/env node
/**
 * dt4-timedlap-coverage.test.mjs — PLAN-DIURNAL-TIMING DT4, the §7 DATA-guarantee CI test.
 *
 * §7 (softened, CONFIRMED by Ben 2026-07-23) splits the diurnal-timing contract into two:
 *   1. Data guarantee (HARD, CI-enforced HERE): the per-row computed structure always carries a
 *      `timedLap` field — either the real js/windowread.mjs diurnalTimedLap() result, or its
 *      `{ degraded: true, reason }` form. Never silently absent/undefined.
 *   2. Render guarantee (soft, NOT this file's job): the printed `↳ diurnal` note only appears
 *      when there's something worth telling Ben — that's pipeline/lib/emit.mjs formatTimedLap +
 *      pipeline/test/render.test.mjs's job. This suite asserts against STRUCTURE only (the raw
 *      diurnalTimedLap()/timedLapShadow()/suggestionEntry() objects), never the console text, so a
 *      future render-format change can't break the thing that's actually supposed to be hard-enforced.
 *
 * This is a PURE-FIXTURE suite — no live fetch (screen-flip-niches.mjs's renderMode itself isn't
 * exported / does real fetches, so it's out of scope for a fast CI unit test; render.test.mjs
 * already pins its OWN 1h-series fixtures for diurnalTimedLap in pipeline/test/windowread.test.mjs).
 * Instead this simulates a fixture SCREEN PASS the same way screen-flip-niches.mjs's DT2/DT4 call
 * sites actually wire it — one survivor with a healthy, clean 1h series (diurnalTimedLap computes a
 * real lap) and one survivor with no/thin history (diurnalTimedLap degrades) — and proves EVERY row
 * in that fixture set ends up with a `timedLap` field on both the raw computed structure and the
 * suggestions.jsonl shadow-log entry, matching the object identity of what screen-flip-niches.mjs's
 * `timedLap: timedLapShadow(r.timedLap)` line actually threads through (no recompute, no new fetch).
 *
 * Run: `node pipeline/test/dt4-timedlap-coverage.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { diurnalTimedLap } from '../../js/windowread.mjs';
import { suggestionEntry, timedLapShadow } from '../lib/suggestlog.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

// --- fixture helpers (mirrors pipeline/test/windowread.test.mjs's bolts-shaped fixture, kept
// self-contained per that file's own convention of not cross-importing test fixtures) -----------
const dts = (y, mo, d, h) => Math.floor(new Date(y, mo, d, h, 0, 0).getTime() / 1000);
const dpt = (t, low, hi, volLo = 10, volHi = 10) =>
  ({ timestamp: t, avgLowPrice: low, avgHighPrice: hi, lowPriceVolume: volLo, highPriceVolume: volHi });
const dtNow = new Date(2026, 0, 20, 12, 0, 0);

// A clean, bolts-shaped 14-night series: tight dip (21-23h) / peak (4-6h) clusters every day, so
// diurnalTimedLap resolves a real (non-degraded) lap.
function healthySeries(days = 14) {
  const s = [];
  for (let di = 0; di < days; di++) for (let h = 0; h < 24; h++) {
    const base = 2900;
    const dipExtra = [21, 22, 23].includes(h) ? 39 : 0;
    const peakExtra = [4, 5, 6].includes(h) ? 85 : 0;
    const isPeak = [4, 5, 6].includes(h);
    const low = base - 45 - dipExtra, hi = base + 45 + peakExtra;
    const volHi = isPeak ? 149334 : 858000 / 24;
    s.push(dpt(dts(2026, 0, 5 + di, h), low, hi, 858000 / 24, volHi));
  }
  return s;
}

// --- (1) diurnalTimedLap itself always returns one of the two shapes, never a bare null/undefined --
ok('diurnalTimedLap: a healthy 1h series computes a real (non-degraded) lap', () => {
  const lap = diurnalTimedLap(healthySeries(14), { nights: 14, now: dtNow, buyLimit: 11000, volDay: 858000 });
  assert.ok(lap, 'never null/undefined for a healthy series');
  assert.equal(lap.degraded, false);
  assert.ok(lap.bid != null && lap.ask != null, 'a real lap carries a resolved bid/ask');
});

ok('diurnalTimedLap: no series / thin history degrades honestly to {degraded:true, reason}, never throws', () => {
  for (const s of [undefined, null, [], [dpt(dts(2026, 0, 5, 2), 100, 110)]]) {
    const lap = diurnalTimedLap(s, { nights: 14, now: dtNow });
    assert.ok(lap, 'never null/undefined even on empty/thin input');
    assert.equal(lap.degraded, true);
    assert.ok(['thin-history', 'no-window'].includes(lap.reason), `reason must be one of the honest-degrade tokens (got ${lap.reason})`);
  }
});

// --- (2) timedLapShadow preserves the guarantee — never null for a real lap object, and NEVER
// silently drops the degrade shape ---------------------------------------------------------------
ok('timedLapShadow: reshapes a real lap into a lean structured object (bid/ask/net/roi/reach survive)', () => {
  const lap = diurnalTimedLap(healthySeries(14), { nights: 14, now: dtNow, buyLimit: 11000, volDay: 858000 });
  const shadow = timedLapShadow(lap);
  assert.ok(shadow && !shadow.degraded, 'a real lap reshapes to a non-degraded shadow object');
  assert.equal(shadow.bid, lap.bid);
  assert.equal(shadow.ask, lap.ask);
  assert.equal(shadow.net, Math.round(lap.net));
  assert.ok('bidReach' in shadow && 'askReach' in shadow, 'reach counts survive the reshape');
});

ok('timedLapShadow: a degraded lap reshapes to {degraded:true, reason} — never faked into zeros, never dropped', () => {
  const lap = diurnalTimedLap([], { nights: 14, now: dtNow });
  const shadow = timedLapShadow(lap);
  assert.deepEqual(shadow, { degraded: true, reason: 'thin-history' });
});

// --- (3) suggestionEntry, wired EXACTLY as screen-flip-niches.mjs's renderMode call site wires it
// (`timedLap: timedLapShadow(r.timedLap)`), always carries the field on both branches -------------
ok('suggestionEntry: a survivor with a healthy series logs a computed (non-degraded) timedLap', () => {
  const lap = diurnalTimedLap(healthySeries(14), { nights: 14, now: dtNow, buyLimit: 11000, volDay: 858000 });
  const e = suggestionEntry({}, { itemId: 4151, cls: 'liquid', verdict: 'A', timedLap: timedLapShadow(lap) });
  assert.ok('timedLap' in e, 'the field is present, not silently absent');
  assert.equal(e.timedLap.degraded, undefined, 'a healthy row is NOT the degraded shape');
  assert.ok(e.timedLap.bid != null && e.timedLap.ask != null);
});

ok('suggestionEntry: a survivor with thin/no history logs the degraded {degraded:true, reason} shape, never omits the field', () => {
  const lap = diurnalTimedLap(null, { nights: 14, now: dtNow });
  const e = suggestionEntry({}, { itemId: 9999, cls: 'thin', verdict: 'A', timedLap: timedLapShadow(lap) });
  assert.ok('timedLap' in e, 'the field is present even on a degraded read — this IS the §7 data guarantee');
  assert.deepEqual(e.timedLap, { degraded: true, reason: 'thin-history' });
});

ok('suggestionEntry: legacy caller with no timedLap at all stays byte-identical (YS2 lean-include pattern preserved)', () => {
  const e = suggestionEntry({}, { itemId: 1, cls: 'mid', verdict: 'BUY' });
  assert.ok(!('timedLap' in e), 'absent only when the CALLER never computed one — quote/watch, not yet wired at DT4');
});

// --- (4) THE §7 COVERAGE PROOF: a fixture SCREEN PASS (one survivor per branch), built the same way
// screen-flip-niches.mjs's renderMode computes r.timedLap per row (DT2) and threads it through
// unmodified at the shadow-log call site (DT4) — assert EVERY row in the set carries the field,
// and it is always one of the two honest shapes. This is the structural guarantee itself: no row is
// EVER silently missing timedLap, regardless of how thin its history is. --------------------------
ok('§7 DATA GUARANTEE: every row in a fixture screen pass carries timedLap — healthy AND thin/degraded alike', () => {
  // simulates the per-survivor computation screen-flip-niches.mjs's renderMode does at DT2 (one
  // diurnalTimedLap call per row, off whatever 1h series that row happens to have in hand — which may
  // be thin/absent for a newly-tracked item; §7's whole point is that a thin item still gets a row).
  const fixtureRows = [
    { id: 4151, name: 'healthy-liquid-item', series1h: healthySeries(14), buyLimit: 11000, volDay: 858000 },
    { id: 9999, name: 'newly-tracked-thin-item', series1h: [dpt(dts(2026, 0, 19, 2), 50, 55)], buyLimit: 100, volDay: 200 },
    { id: 1, name: 'no-series-at-all-item', series1h: null, buyLimit: null, volDay: null },
  ];
  const survivors = fixtureRows.map(r => ({
    id: r.id,
    timedLap: diurnalTimedLap(r.series1h, { nights: 14, now: dtNow, buyLimit: r.buyLimit, volDay: r.volDay }),
  }));
  // the DT4 shadow-log call site: `timedLap: timedLapShadow(r.timedLap)` — no recompute, threaded as-is.
  const entries = survivors.map(r => suggestionEntry({}, { itemId: r.id, cls: 'liquid', verdict: 'A', timedLap: timedLapShadow(r.timedLap) }));

  assert.equal(entries.length, fixtureRows.length, 'sanity: one entry per survivor, none dropped');
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    assert.ok('timedLap' in e, `row ${fixtureRows[i].name} is MISSING timedLap — the §7 data guarantee is broken`);
    const tl = e.timedLap;
    const isDegraded = tl && tl.degraded === true && typeof tl.reason === 'string';
    const isComputed = tl && tl.degraded === undefined && tl.bid != null && tl.ask != null;
    assert.ok(isDegraded || isComputed, `row ${fixtureRows[i].name}'s timedLap is neither a valid computed lap nor a valid degrade shape: ${JSON.stringify(tl)}`);
  }
  // and pin WHICH shape each specific fixture lands in, so this test can't quietly pass by both
  // rows accidentally taking the same branch.
  assert.equal(entries[0].timedLap.degraded, undefined, 'the healthy series computes a real lap');
  assert.equal(entries[1].timedLap.degraded, true, 'the thin single-point series degrades');
  assert.equal(entries[2].timedLap.degraded, true, 'no series at all degrades');
});

console.log(`\n${n} dt4-timedlap-coverage assertions passed.`);
