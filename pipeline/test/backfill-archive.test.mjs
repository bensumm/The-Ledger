/* backfill-archive.test.mjs — BUSINESS REQUIREMENTS for the archive hole-repair job
 * (pipeline/commands/backfill-archive.mjs, added 2026-07-27).
 *
 * HERMETIC + OFFLINE + TIMEZONE-INVARIANT by construction:
 *   - TZ pinned to UTC and every `now` injected — the window grid is computed from epoch math, so a
 *     suite that read the wall clock or a local zone would pass locally and fail on UTC CI.
 *   - NOTHING here touches the network or the real .sqlite: only the two PURE exports are exercised.
 *     Importing the module must not run `main()` (its CLI guard keys off process.argv[1], which is
 *     this test file) — if that regressed, this suite would hang on a live fetch instead of passing.
 *
 * Requirements pinned:
 *   1. windowsFor: returns `days`-worth of slots on the grain's grid, newest-first.
 *   2. windowsFor: the newest slot is the last COMPLETE bucket — never the in-progress one (fetching
 *      a partial bucket would archive a half-formed hour as if it were final).
 *   3. windowsFor: grid alignment holds for a `now` at an arbitrary offset inside a bucket.
 *   4. windowsFor: an unknown grain throws rather than silently walking a bogus step.
 *   5. holeRuns: merges CONTIGUOUS missing buckets, splits on a gap, returns ascending — this is what
 *      turns 1012 bare timestamps into a legible 51-run report.
 *   6. holeRuns: tolerates a descending input (the caller filters a descending window list).
 */
process.env.TZ = 'UTC';   // pin BEFORE any Date use; every `now` below is injected explicitly too

import assert from 'node:assert/strict';
import { windowsFor, holeRuns } from '../commands/backfill-archive.mjs';

let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const HOUR = 3600;
// A `now` deliberately 37m12s INTO the 12:00 bucket, so "last complete" must be 11:00 — not 12:00.
const NOW = Date.UTC(2026, 0, 15, 12, 37, 12);

// ── 1/2/3. windowsFor: count, grid, and the last-COMPLETE-bucket rule ────────────────────────────
ok('windowsFor(1h): 2 days → 48 slots, newest-first, exactly 1h apart', () => {
  const w = windowsFor('1h', 2, NOW);
  assert.equal(w.length, 48, '2 days of hourly slots');
  for (let i = 1; i < w.length; i++) {
    assert.equal(w[i - 1] - w[i], HOUR, `slot ${i} is one hour older than its predecessor`);
  }
});

ok('windowsFor(1h): newest slot is the last COMPLETE bucket, never the in-progress one', () => {
  const w = windowsFor('1h', 1, NOW);
  assert.equal(w[0], Math.floor(Date.UTC(2026, 0, 15, 11, 0, 0) / 1000),
    'now=12:37 ⇒ newest requested bucket is 11:00 (12:00 is still filling)');
});

ok('windowsFor(5m): grid-aligns to the 5m step from an off-grid now', () => {
  const w = windowsFor('5m', 1, NOW);
  assert.equal(w.length, 288, 'one day of 5m slots');
  assert.equal(w[0], Math.floor(Date.UTC(2026, 0, 15, 12, 30, 0) / 1000),
    'now=12:37:12 ⇒ last complete 5m bucket is 12:30');
  assert.equal(w[0] % 300, 0, 'every slot sits on the 5m grid the API accepts');
});

// ── 4. Unknown grain fails loudly ────────────────────────────────────────────────────────────────
ok('windowsFor: an unknown grain throws (never walks a bogus step)', () => {
  assert.throws(() => windowsFor('6h', 1, NOW), /unknown grain/i);
});

// ── 5/6. holeRuns: the report-shaping primitive ──────────────────────────────────────────────────
ok('holeRuns: merges contiguous buckets and splits on a gap, ascending', () => {
  const base = Math.floor(Date.UTC(2026, 0, 15, 0, 0, 0) / 1000);
  // three contiguous, a one-bucket gap, then two contiguous
  const missing = [base, base + HOUR, base + 2 * HOUR, base + 4 * HOUR, base + 5 * HOUR];
  const runs = holeRuns(missing, HOUR);
  assert.equal(runs.length, 2, 'the present bucket at +3h splits the holes into two runs');
  assert.deepEqual(
    runs.map(r => [r.from, r.to, r.n]),
    [[base, base + 2 * HOUR, 3], [base + 4 * HOUR, base + 5 * HOUR, 2]],
  );
});

ok('holeRuns: a descending input (the caller\'s window order) still yields ascending runs', () => {
  const base = Math.floor(Date.UTC(2026, 0, 15, 0, 0, 0) / 1000);
  const runs = holeRuns([base + 2 * HOUR, base + HOUR, base], HOUR);
  assert.equal(runs.length, 1, 'the three are contiguous regardless of input order');
  assert.deepEqual([runs[0].from, runs[0].to, runs[0].n], [base, base + 2 * HOUR, 3]);
});

ok('holeRuns: an isolated bucket is a run of 1; an empty input is no runs', () => {
  const base = Math.floor(Date.UTC(2026, 0, 15, 0, 0, 0) / 1000);
  assert.deepEqual(holeRuns([base], HOUR).map(r => r.n), [1]);
  assert.deepEqual(holeRuns([], HOUR), []);
});

console.log(`All ${n} checks passed.`);
