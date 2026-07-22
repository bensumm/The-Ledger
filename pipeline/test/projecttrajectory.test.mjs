#!/usr/bin/env node
/**
 * projecttrajectory.test.mjs — acceptance fixtures for the shared projectTrajectory primitive
 * (js/windowread.mjs, PLAN-SIGNAL-RECENCY R1). projectTrajectory generalizes floorCeilingTrack's
 * inner per-track read (recent-window LSQ slope → dir · trailing raw-sign micro-run · optional
 * downward break) to an arbitrary per-day scalar, and ADDS a forward projection (latest + slope×N).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - The SAME fixture shapes floorCeilingTrack's tests encode (fang crash / maul cooldown / soulreaper
 *     trend), fed to projectTrajectory DIRECTLY via extractFn, reproduce the per-track dir/run/break —
 *     the proof the generalization is the same math (R1's byte-identity obligation, primitive side).
 *   - The NEW forward `projected` field extends the recent least-squares line one horizon forward, with
 *     an honest confidence token (low on a partial-window fit or a broken series).
 *   - Honesty rails: < minDays extracted points ⇒ null; break null unless breakLookback supplied.
 *
 * Run: `node pipeline/test/projecttrajectory.test.mjs`  (exits non-zero on any failure; auto-discovered
 * by run-tests.mjs). Fixtures are synthetic (rule 4 — no live data).
 */
import assert from 'node:assert/strict';
import { projectTrajectory, floorCeilingTrack, PT_PROJECT_N, FC_MIN_DAYS, FC_RECENT_N, FC_BREAK_LOOKBACK } from '../../js/windowread.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// days shape mirrors windowStats().days: [[key, {low, hi}], …] oldest→newest.
const day = (key, low, hi) => [key, { low, hi }];
const lowOf = n => n.low, hiOf = n => n.hi;

ok('projectTrajectory: a steady climb reads rising with a positive slope and a same-length run', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => day(`2026-07-0${i + 1}`, 1000 + i * 100, 1200 + i * 100));
  const t = projectTrajectory(days, lowOf);
  assert.equal(t.dir, 'rising', 'a +100/day floor is rising');
  assert.ok(t.slope > 0, 'positive least-squares slope');
  assert.equal(t.step, 100, 'step is the rounded per-period slope');
  assert.equal(t.latest, 1600, 'latest = the newest extracted value');
  assert.equal(t.nUsed, FC_RECENT_N, 'the slope is fit over the recent-N window');
  assert.equal(t.run.dir, 'rising', 'every step rose');
  assert.equal(t.run.len, 6, 'the trailing raw-sign run spans all 6 steps');
});

ok('projectTrajectory: the forward projection extends the recent line one horizon forward', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => day(`2026-07-0${i + 1}`, 1000 + i * 100, 1200 + i * 100));
  const t = projectTrajectory(days, lowOf);
  assert.ok(t.projected, 'a fittable slope yields a projection');
  assert.equal(t.projected.value, 1600 + 100 * PT_PROJECT_N, 'projected = latest + slope × projectN');
  assert.equal(t.projected.confidence, 'ok', 'a full-window fit with no break is confident');
});

ok('projectTrajectory: MAUL fixture — flat floor, the trailing 2-day softening shows in the run', () => {
  // the exact maul lows from the floorCeilingTrack suite: rose 7d, plateaued, ticked down 2.
  const lows = [116500, 118500, 120500, 122500, 124000, 125000, 125500, 124800, 124500];
  const days = lows.map((l, i) => day(`2026-07-0${i + 1}`, l, l + 11000));
  const t = projectTrajectory(days, lowOf);
  assert.equal(t.dir, 'flat', 'the recent-window LSQ floor slope is flat — the 2-day dip does NOT flip it');
  assert.equal(t.run.dir, 'falling', 'the trailing micro-run captures the 2-day softening');
  assert.equal(t.run.len, 2, 'exactly 2 down-ticks at the end');
});

ok('projectTrajectory: FANG fixture — the downward break fires only when breakLookback is supplied', () => {
  const lows = [17600000, 17590000, 17600000, 17580000, 17590000, 17600000, 17580000, 17460000];
  const days = lows.map((l, i) => day(`2026-07-0${i + 1}`, l, l + 1000000));
  const noBreak = projectTrajectory(days, lowOf);
  assert.equal(noBreak.break, null, 'no break test without breakLookback (never a false negative that gates)');
  const withBreak = projectTrajectory(days, lowOf, { breakLookback: FC_BREAK_LOOKBACK });
  assert.equal(withBreak.break.broke, true, 'the last low 17.46m < the prior-window floor 17.58m');
  assert.equal(withBreak.break.priorExtreme, 17580000, 'priorExtreme = the min of the prior lookback');
  assert.equal(withBreak.break.gap, 17460000 - 17580000, 'gap = latest − priorExtreme (negative = broken)');
  assert.equal(withBreak.projected.confidence, 'low', 'a broken series is low-confidence for projection');
});

ok('projectTrajectory: floorCeilingTrack is a faithful two-call wrapper (same dir/break/run)', () => {
  // proves the wrapper delegates to the primitive: the fc floor/ceiling tracks match direct primitive calls.
  const lows = [17600000, 17590000, 17600000, 17580000, 17590000, 17600000, 17580000, 17460000];
  const his  = [19000000, 18624000, 18248000, 17872000, 17496000, 17120000, 16744000, 16368000];
  const days = lows.map((l, i) => day(`2026-07-0${i + 1}`, l, his[i]));
  const fc = floorCeilingTrack(days);
  const floor = projectTrajectory(days, lowOf, { breakLookback: FC_BREAK_LOOKBACK });
  const ceiling = projectTrajectory(days, hiOf);
  assert.equal(fc.floor.dir, floor.dir, 'floor dir matches the direct primitive call');
  assert.equal(fc.ceiling.dir, ceiling.dir, 'ceiling dir matches the direct primitive call');
  assert.equal(fc.floorBreak.broke, floor.break.broke, 'floorBreak.broke is the primitive break, field-renamed');
  assert.equal(fc.floorBreak.priorFloor, floor.break.priorExtreme, 'priorFloor ← priorExtreme rename is faithful');
  assert.deepEqual(fc.floor.run, floor.run, 'the micro-run is identical');
});

ok('projectTrajectory: partial-window fit is low-confidence (the OTHER lowConf branch, no break)', () => {
  // the `nUsed < recentN` branch is UNREACHABLE with default constants (minDays == recentN == 5, so a
  // non-null result always fits a full recentN window); it fires only when a caller passes minDays < recentN
  // (a later chunk's custom window). Pin that branch here so both halves of the lowConf OR are covered.
  const days = [0, 1, 2, 3].map(i => day(`2026-07-0${i + 1}`, 1000 + i * 50, 1200 + i * 50));   // 4 rising points
  const t = projectTrajectory(days, lowOf, { minDays: 3, recentN: 5 });
  assert.ok(t, 'minDays 3 admits the 4-point series');
  assert.equal(t.nUsed, 4, 'the fitted window is shorter than recentN (5)');
  assert.equal(t.break, null, 'no break test here — so low-confidence is from the partial window alone');
  assert.equal(t.projected.confidence, 'low', 'a partial-window fit is low-confidence independent of any break');
});

ok('projectTrajectory: honesty rails — thin/empty/no-extractor ⇒ null; forming guard degrades cleanly', () => {
  const thin = [0, 1, 2].map(i => day(`d${i}`, 1000, 1200));   // 3 < FC_MIN_DAYS
  assert.equal(projectTrajectory(thin, lowOf), null, `< FC_MIN_DAYS (${FC_MIN_DAYS}) extracted points ⇒ null`);
  assert.equal(projectTrajectory([], lowOf), null, 'empty ⇒ null');
  assert.equal(projectTrajectory(null, lowOf), null, 'non-array ⇒ null');
  assert.equal(projectTrajectory([['d0', { low: null }]], lowOf), null, 'all-null extraction ⇒ null');
  assert.equal(projectTrajectory(thin, 'nope'), null, 'a non-function extractFn ⇒ null');
  // forming-day guard: the newest day peels off, leaving too few completed ⇒ null (like floorCeilingTrack).
  const fivePlusForming = [0, 1, 2, 3].map(i => day(`2026-07-0${i + 1}`, 1000, 1200)).concat([day('2026-07-05', 500, 1200)]);
  const t = projectTrajectory(fivePlusForming, lowOf, { todayKey: '2026-07-05' });
  assert.equal(t, null, '4 completed after dropping the forming day ⇒ null');
});

ok('projectTrajectory: forming-day guard splits off the newest day and never feeds it to the slope', () => {
  const completed = [0, 1, 2, 3, 4, 5].map(i => day(`2026-07-0${i + 1}`, 1000 + (i % 2), 1200));
  const forming = day('2026-07-07', 500, 1150);   // an incomplete deep intraday dip
  const days = [...completed, forming];
  const t = projectTrajectory(days, lowOf, { todayKey: '2026-07-07', breakLookback: FC_BREAK_LOOKBACK });
  assert.equal(t.forming.key, '2026-07-07', 'the forming day is surfaced separately');
  assert.equal(t.forming.value, 500, 'the forming value is the extracted scalar');
  assert.ok(t.series.every(v => v >= 1000), 'the completed series never sees the forming 500');
  assert.equal(t.break.broke, false, 'the 500 forming dip is EXCLUDED → no false break');
});

console.log(`\nAll ${pass} acceptance checks passed.`);
