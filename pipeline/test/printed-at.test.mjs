#!/usr/bin/env node
/**
 * printed-at.test.mjs — acceptance fixtures for AB1's `printedAt` (pipeline/lib/market/printed-at.mjs),
 * the atom the ask fill surface is built from.
 *
 * Fixtures ONLY — hand-built rows, no sqlite, no fetch, no clock.
 *
 * BUSINESS REQUIREMENTS pinned here:
 *   - `mid` is an INPUT and is never derived. Passing a different mid with the same series must move
 *     the verdict, because base side/window are worth 5–15pp of measured fill (PLAN-ASK-BACKTEST §10)
 *     and the only way to keep every consumer on one base is to make it visible at the call site.
 *   - the threshold is `mid × (1 + premium)` and the test is `>=` — measured over MID, never over a bid.
 *   - the window is EXCLUSIVE at `from`, INCLUSIVE at `from + horizon×86400`. The reference bucket that
 *     set the mid must not be allowed to also score the outcome (leakage).
 *   - `horizon` is in DAYS, not seconds. A unit slip here silently rescales every cell of the surface.
 *   - `printed` is TRISTATE: `null` (with a reason) when there is no archived bucket in the window.
 *     Collapsing that to `false` mechanically depresses every level, because an unarchived bucket can
 *     never print (§10/M4) — the builder DROPS these rather than scoring them as misses.
 *   - a `ts`-shaped archive row THROWS. Silently skipping it is how a whole surface reads "never
 *     printed" with no error (the archive-series.mjs ts→timestamp trap).
 */
import assert from 'node:assert/strict';
import { printedAt } from '../lib/market/printed-at.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const row = (timestamp, avgHighPrice) => ({ timestamp, avgHighPrice, avgLowPrice: null, highPriceVolume: 1, lowPriceVolume: 0 });
const H = 3600, D = 86400;

console.log('printed-at (AB1):');

ok('prints when a bucket reaches mid × (1 + premium)', () => {
  const r = printedAt([row(1000 + H, 1020)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.printed, true);
  assert.equal(r.threshold, 1020);
  assert.equal(r.maxHigh, 1020);
  assert.equal(r.buckets, 1);
  assert.equal(r.reason, null);
});

ok('the threshold test is `>=`, not `>` (a bucket exactly at the level counts)', () => {
  assert.equal(printedAt([row(1000 + H, 1020)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 }).printed, true);
  assert.equal(printedAt([row(1000 + H, 1019)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 }).printed, false);
});

ok('mid is an INPUT — the same series flips verdict on a different base', () => {
  const series = [row(1000 + H, 1020)];
  assert.equal(printedAt(series, { mid: 1000, premium: 0.02, horizon: 1, from: 1000 }).printed, true);
  // a base 10% higher (e.g. an instasell-side or longer-window mid) puts the same print out of reach
  assert.equal(printedAt(series, { mid: 1100, premium: 0.02, horizon: 1, from: 1000 }).printed, false);
});

ok('maxPremium reports the observed max on the SAME basis as `premium`', () => {
  const r = printedAt([row(1000 + H, 1050), row(1000 + 2 * H, 1010)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.maxHigh, 1050);
  assert.ok(Math.abs(r.maxPremium - 0.05) < 1e-12);
  assert.equal(r.atTs, 1000 + H);
});

ok('window is EXCLUSIVE at `from` — the reference bucket cannot score its own outcome', () => {
  const r = printedAt([row(1000, 9999)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.printed, null);            // the only bucket sits AT `from`, so the window is empty
  assert.equal(r.reason, 'no-buckets');
});

ok('window is INCLUSIVE at from + horizon days', () => {
  const at = 1000 + 3 * D;
  assert.equal(printedAt([row(at, 1020)], { mid: 1000, premium: 0.02, horizon: 3, from: 1000 }).printed, true);
  assert.equal(printedAt([row(at + 1, 1020)], { mid: 1000, premium: 0.02, horizon: 3, from: 1000 }).printed, null);
});

ok('`horizon` is DAYS — a print on day 2 is inside 3d and outside 1d', () => {
  const series = [row(1000 + 2 * D, 1080)];
  assert.equal(printedAt(series, { mid: 1000, premium: 0.05, horizon: 3, from: 1000 }).printed, true);
  assert.equal(printedAt(series, { mid: 1000, premium: 0.05, horizon: 1, from: 1000 }).printed, null);  // no bucket at all in 1d
});

ok('buckets exist but none reach → printed FALSE (a real miss)', () => {
  const r = printedAt([row(1000 + H, 1005), row(1000 + 2 * H, 1010)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.printed, false);
  assert.equal(r.reason, null);
  assert.equal(r.buckets, 2);
  assert.equal(r.maxHigh, 1010);
});

ok('TRISTATE: no archived bucket in the window → null, never false', () => {
  const r = printedAt([row(1000 - H, 5000)], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.printed, null);
  assert.equal(r.reason, 'no-buckets');
  assert.notEqual(r.printed, false);   // the whole point: missing coverage is NOT evidence of a miss
});

ok('a bucket with no high-side trade does not count as a bucket', () => {
  const r = printedAt([{ timestamp: 1000 + H, avgHighPrice: null }], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.printed, null);
  assert.equal(r.buckets, 0);
});

ok('a `ts`-shaped archive row THROWS rather than reading as "never printed"', () => {
  assert.throws(
    () => printedAt([{ ts: 1000 + H, avgHighPrice: 9999 }], { mid: 1000, premium: 0.02, horizon: 1, from: 1000 }),
    /carries `ts` but no `timestamp`/);
});

ok('bad inputs refuse with a reason instead of guessing', () => {
  const s = [row(1000 + H, 1020)];
  assert.equal(printedAt(s, { mid: null, premium: 0.02, horizon: 1, from: 1000 }).reason, 'no-mid');
  assert.equal(printedAt(s, { mid: 0, premium: 0.02, horizon: 1, from: 1000 }).reason, 'no-mid');
  assert.equal(printedAt(s, { mid: 1000, premium: null, horizon: 1, from: 1000 }).reason, 'no-premium');
  assert.equal(printedAt(s, { mid: 1000, premium: 0.02, horizon: 0, from: 1000 }).reason, 'no-horizon');
  assert.equal(printedAt(s, { mid: 1000, premium: 0.02, horizon: 1, from: null }).reason, 'no-from');
  assert.equal(printedAt(s, {}).printed, null);
  assert.equal(printedAt(null, { mid: 1000, premium: 0.02, horizon: 1, from: 1000 }).reason, 'no-buckets');
});

ok('unsorted input is fine — the window is a filter, not a scan from an assumed order', () => {
  const r = printedAt([row(1000 + 3 * H, 1010), row(1000 + H, 1030), row(1000 - H, 9999)],
    { mid: 1000, premium: 0.02, horizon: 1, from: 1000 });
  assert.equal(r.printed, true);
  assert.equal(r.maxHigh, 1030);
  assert.equal(r.buckets, 2);
});

ok('nested by construction: a lower premium can never miss where a higher one printed', () => {
  // This is the property the plan forbids citing as EVIDENCE (§10/M1) — it is asserted here as a
  // CODE invariant so a refactor cannot break the arithmetic, not as a finding about the market.
  const series = [row(1000 + H, 1044)];
  const at = p => printedAt(series, { mid: 1000, premium: p, horizon: 3, from: 1000 }).printed;
  const grid = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08];
  for (let i = 1; i < grid.length; i++) if (at(grid[i])) assert.equal(at(grid[i - 1]), true);
});

console.log(`  ${pass} assertion group(s) passed`);
