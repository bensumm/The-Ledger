/* joinreachbasis.test.mjs — fixture pins for join-reach-basis.mjs's pure core.
 *
 * SYNTHETIC SERIES ONLY. No archive, no live data, no suggestions ledger.
 *
 * ⚠ MUTATION-VERIFIED — 13 deliberate breakages of join-reach-basis.mjs, each applied and watched
 * to FAIL. `joindepth.test.mjs` records that its v1 look-ahead test was VACUOUS (it passed against
 * a deliberately broken source), and THIS FILE REPRODUCED THAT DEFECT TWICE before it was caught,
 * so the list below is what was ACTUALLY RUN, not what was intended:
 *   scoreForward — `ts <= ts` → `< ts` · delete the `last < end` coverage return
 *   mcnemarCost  — `-A/B` → `A/B` · delete the `root > 0` guard · flip the dominance sign ·
 *                  read dominance off B alone · hard-code `cheaperBelowRStar` to 'recent' ·
 *                  count only discordant rows in the cost sums
 *   blastRadius  — flip the `< REACH_GRADE_CAP_FRAC` comparison · force branch-2 to 0 ·
 *                  swap the band filter to 'churn'
 *   bootstrapM   — replace item resampling with ROW resampling
 *   dedupRows    — drop the local-day component of the composite key
 *
 * TWO VACUITY FAILURES THIS FILE ALREADY MADE — do not reintroduce their shapes:
 *   1. The first look-ahead test used a fixture with NO bucket exactly at the suggestion ts, so the
 *      binary-search boundary was never exercised and the mutation passed. The boundary fixture is
 *      the whole test — do not "simplify" it.
 *   2. The first r* test used a fixture giving A=0, B=1 ⇒ root = −0 ⇒ rStar === null, so the
 *      assertion body NEVER EXECUTED and four separate rStar+dominance mutations survived. Every r*
 *      fixture below is chosen so the branch under test actually runs, and asserts rStar is
 *      non-null BEFORE asserting anything about it.
 * A third trap, met while running the battery itself: one mutation reported as "surviving" when the
 * `sed` had silently failed to apply. Confirm a mutation really changed the file before believing it.
 *
 * If you change any line named above, re-run this file and confirm it goes RED before making it green.
 */
import assert from 'node:assert/strict';
import {
  readRows, basisPair, dedupRows, scoreForward, mcnemarCost, bootstrapM, blastRadius,
  LEVEL_BUCKET_PCT,
} from '../commands/join-reach-basis.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

// helper: a 1h series at `step` spacing, ascending
const series = (pts) => pts.map(([ts, high]) => ({ ts, avgHighPrice: high, avgLowPrice: high - 1 }));

console.log('join-reach-basis — pure core');

// ── readRows: the field-level guards, through the injectable `lines` seam ───────────────────────
// These were advertised as "fixture-pinned" while completely untested (caught in review). Guards
// 4 (degradation), 5 (partial recent window) and 10 (level pinning) all silently admit bad rows if
// they regress, and none of them is visible in the output — exactly the class that needs a test.
const line = (o) => JSON.stringify(o);
const goodRow = {
  ts: 1785567036, itemId: 42, ask: 1000, optSell: 1000, mode: 'band',
  estConfidence: { askHit: 7, askDays: 14, askRecHit: 2, askRecDays: 3 },
};

ok('readRows keeps a well-formed row and carries the counts through', () => {
  const { rows } = readRows({ lines: [line(goodRow)] });
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { h: rows[0].askHit, d: rows[0].askDays, rh: rows[0].askRecHit, rd: rows[0].askRecDays },
    { h: 7, d: 14, rh: 2, rd: 3 });
});
ok('guard 4: a degraded row (askRecDays 0) is DROPPED, not silently read as full-window', () => {
  const r = { ...goodRow, estConfidence: { askHit: 7, askDays: 14, askRecHit: 0, askRecDays: 0 } };
  const { rows, drop } = readRows({ lines: [line(r)] });
  assert.equal(rows.length, 0);
  assert.equal(drop.degraded, 1);
});
ok('guard 4, REAL-WORLD SHAPE: degraded rows have askRecDays ABSENT, not 0', () => {
  // Census over the actual ledger: askRecDays ∈ {1:6, 2:1, 3:37801, absent:2101}. The field is
  // never literally 0 anywhere, so a fixture using 0 tests a case the producer cannot emit.
  const ec = { askHit: 7, askDays: 14 };          // no askRecHit / askRecDays at all
  const { rows, drop } = readRows({ lines: [line({ ...goodRow, estConfidence: ec })] });
  assert.equal(rows.length, 0);
  assert.equal(drop.degraded, 1, 'an ABSENT recent window must be dropped, not read as full');
});
ok('guard 5: a PARTIAL recent window (askRecDays 2) is dropped', () => {
  const r = { ...goodRow, estConfidence: { askHit: 7, askDays: 14, askRecHit: 1, askRecDays: 2 } };
  const { rows, drop } = readRows({ lines: [line(r)] });
  assert.equal(rows.length, 0);
  assert.equal(drop.partialRecent, 1);
});
ok('guard 10: a row whose scored level != the COUNTED level is dropped', () => {
  const r = { ...goodRow, optSell: 999 };            // ask 1000 != optSell 999
  const { rows, drop } = readRows({ lines: [line(r)] });
  assert.equal(rows.length, 0);
  assert.equal(drop.levelMismatch, 1);
});
ok('guard 6: a short history (askDays < minDays) is dropped', () => {
  const r = { ...goodRow, estConfidence: { askHit: 2, askDays: 4, askRecHit: 2, askRecDays: 3 } };
  const { rows, drop } = readRows({ lines: [line(r)], minDays: 7 });
  assert.equal(rows.length, 0);
  assert.equal(drop.shortWindow, 1);
});
ok('readRows survives a malformed line and rows without estConfidence', () => {
  const { rows } = readRows({ lines: ['{not json', line({ ts: 1, itemId: 2, ask: 3 }), line(goodRow)] });
  assert.equal(rows.length, 1, 'the one good row still comes through');
});

// ── basisPair: the estConfidence → reachFraction field remap ────────────────────────────────────
ok('basisPair remaps askHit/askDays onto reachedDays/nDays (the remap is load-bearing)', () => {
  const p = basisPair({ askHit: 7, askDays: 14, askRecHit: 3, askRecDays: 3 });
  assert.equal(p.full, 0.5);
  assert.equal(p.rec, 1);
});
ok('basisPair reads the two bases independently (recent can disagree with full)', () => {
  const p = basisPair({ askHit: 12, askDays: 14, askRecHit: 0, askRecDays: 3 });
  assert.ok(p.full > 0.5, 'full window says reliable');
  assert.equal(p.rec, 0, 'recent-3 says unreliable');
});

// ── scoreForward: the two look-ahead guards + the hit rule ──────────────────────────────────────
ok('no look-ahead: a print BEFORE the suggestion does not count', () => {
  // 100 prints at ts=0 (before), never again inside the window. Must be a MISS.
  const s = series([[0, 100], [3600, 10], [7200, 10], [10800, 10]]);
  const r = scoreForward(s, 3000, 100, 2);
  assert.equal(r.resolved, true);
  assert.equal(r.hit, false);
});
ok('no look-ahead AT THE BOUNDARY: the bucket exactly AT ts is excluded', () => {
  // The load-bearing case. The 100 sits on the suggestion's OWN bucket — the price that was on
  // screen when the level was chosen. Counting it is look-ahead, and it is the only fixture that
  // distinguishes `ts <= ts` from `ts < ts` in the binary search. Without a bucket exactly at ts,
  // this test is VACUOUS (it was, on the first draft — the mutation passed).
  const s = series([[3000, 100], [3600, 10], [7200, 10], [10800, 10]]);
  const r = scoreForward(s, 3000, 100, 2);
  assert.equal(r.resolved, true);
  assert.equal(r.hit, false, 'the suggestion-time bucket must NOT count as a forward print');
});
ok('a print strictly INSIDE the window counts', () => {
  const s = series([[0, 10], [3600, 10], [7200, 100], [10800, 10]]);
  assert.deepEqual(scoreForward(s, 3000, 100, 2), { resolved: true, hit: true });
});
ok('a print past the horizon end does not count', () => {
  // window is (3000, 3000+2h=10200]; the 100 lands at 10800, outside it
  const s = series([[0, 10], [3600, 10], [7200, 10], [10800, 100], [14400, 10]]);
  assert.equal(scoreForward(s, 3000, 100, 2).hit, false);
});
ok('unresolved when the archive does not reach the horizon end (never a miss)', () => {
  const s = series([[0, 10], [3600, 10]]);
  const r = scoreForward(s, 3000, 100, 24);
  assert.equal(r.resolved, false, 'must be pending, NOT a scored miss');
});
ok('hit rule is avgHighPrice >= level (equality counts)', () => {
  const s = series([[0, 10], [3600, 50], [7200, 10]]);
  assert.equal(scoreForward(s, 0, 50, 2).hit, true);
  assert.equal(scoreForward(s, 0, 51, 2).hit, false);
});
ok('empty series is unresolved, not a miss', () => {
  assert.equal(scoreForward([], 0, 10, 24).resolved, false);
});

// ── dedupRows: the RELATIVE level grid ──────────────────────────────────────────────────────────
ok('dedup collapses a big-ticket relist inside the relative grid (round(gp) would not)', () => {
  const day = 1785567036;
  const rows = [
    { ts: day, itemId: 1, ask: 19_250_000 },
    { ts: day + 60, itemId: 1, ask: 19_260_000 },   // +0.05% — same bucket
  ];
  assert.equal(dedupRows(rows).length, 1);
});
ok('dedup keeps levels far enough apart to be a different bucket', () => {
  const day = 1785567036;
  const rows = [
    { ts: day, itemId: 1, ask: 1000 },
    { ts: day + 60, itemId: 1, ask: 1100 },         // +10% ≫ 0.5%
  ];
  assert.equal(dedupRows(rows).length, 2);
});
ok('dedup keys on the LOCAL DAY — the same item+level on a different day survives', () => {
  // Every other dedup fixture uses one day, so dropping the day key from the composite survived.
  const day = 1785567036;
  const rows = [
    { ts: day, itemId: 1, ask: 1000 },
    { ts: day + 3 * 86400, itemId: 1, ask: 1000 },   // same item, same level, three days later
  ];
  assert.equal(dedupRows(rows).length, 2, 'a later DAY is a separate observation, not a duplicate');
});
ok('dedup separates items and keeps the FIRST row per key', () => {
  const day = 1785567036;
  const rows = [
    { ts: day + 60, itemId: 1, ask: 1000, mark: 'second' },
    { ts: day, itemId: 1, ask: 1000, mark: 'first' },
    { ts: day, itemId: 2, ask: 1000, mark: 'other-item' },
  ];
  const out = dedupRows(rows);
  assert.equal(out.length, 2);
  assert.equal(out.find(r => r.itemId === 1).mark, 'first', 'keep-first, by ts not input order');
});
ok('LEVEL_BUCKET_PCT is the relative grid, not an absolute gp step', () => {
  assert.ok(LEVEL_BUCKET_PCT > 0 && LEVEL_BUCKET_PCT < 0.05);
});

// ── mcnemarCost: the primary estimator ──────────────────────────────────────────────────────────
const row = (unrelRec, unrelFull, hit) => ({ resolved: true, unrelRec, unrelFull, hit, itemId: 1 });

ok('concordant rows cancel in the COST DIFFERENCE (and move both costs by the same amount)', () => {
  // ⚠ The difference-only assertion here was VACUOUS: counting only discordant rows in the cost
  // sums preserves the difference by construction, so that mutation survived. Pin the LEVELS too.
  const disc = [row(true, false, false), row(false, true, true)];
  const withConc = [...disc,
    row(true, true, true), row(true, true, false), row(false, false, true), row(false, false, false)];
  const a = mcnemarCost(disc, 1), b = mcnemarCost(withConc, 1);
  assert.equal(a.costFull - a.costRec, b.costFull - b.costRec,
    'concordant rows must contribute identically to BOTH arms');
  assert.equal(b.costRec, a.costRec + 2, 'the concordant rows must actually be COUNTED, not skipped');
  assert.equal(b.costFull, a.costFull + 2);
});
ok('...but M ITSELF changes, because M divides by n', () => {
  // The old name of the test above claimed "M is unchanged by adding them". Measured: 1.0 → 0.333.
  const disc = [row(true, false, false), row(false, true, true)];
  const withConc = [...disc,
    row(true, true, true), row(true, true, false), row(false, false, true), row(false, false, false)];
  assert.notEqual(mcnemarCost(disc, 1).M, mcnemarCost(withConc, 1).M);
});
ok('M > 0 when recent is right on the discordant rows', () => {
  // recent says unreliable and it did NOT print (recent correct); full says reliable (full wrong)
  const m = mcnemarCost([row(true, false, false), row(true, false, false)], 1);
  assert.ok(m.M > 0, 'recent cheaper ⇒ M > 0');
  assert.equal(m.discordant, 2);
});
ok('M < 0 when full is right on the discordant rows', () => {
  const m = mcnemarCost([row(true, false, true), row(true, false, true)], 1);
  assert.ok(m.M < 0, 'full cheaper ⇒ M < 0');
});
// r* and dominance — THE DECLARED HEADLINE STATISTIC. The first version of this block was VACUOUS:
// its fixture gave A=0, B=1 ⇒ root = −0 ⇒ rStar === null ⇒ the assertion body never executed, and
// four separate mutations (flipping the root formula, deleting the positivity guard, flipping the
// dominance sign, reading dominance off B alone) all survived. Every fixture below is chosen so the
// branch under test actually RUNS.
//   M·n = A + r·B,  A = gateFull−gateRec,  B = greenFull−greenRec,  r* = −A/B when that is > 0.
// row(unrelRec, unrelFull, hit):
//   row(true,  false, true)  → gateRec++   (A down)
//   row(true,  false, false) → greenFull++ (B up)
//   row(false, true,  true)  → gateFull++  (A up)
//   row(false, true,  false) → greenRec++  (B down)
const rep = (n, r) => Array.from({ length: n }, () => r);

ok('rStar EXISTS and equals −A/B when the root is positive (A<0, B>0)', () => {
  const rows = [...rep(3, row(true, false, true)), ...rep(10, row(true, false, false))];
  const m = mcnemarCost(rows, 1);
  assert.equal(m.A, -3); assert.equal(m.B, 10);
  assert.ok(m.rStar != null, 'this fixture MUST produce a real root — else the test is vacuous');
  assert.ok(Math.abs(m.rStar - 0.3) < 1e-9, `r* should be 0.3, got ${m.rStar}`);
  const at = mcnemarCost(rows, m.rStar);
  assert.ok(Math.abs(at.costRec - at.costFull) < 1e-9, 'costs must be EQUAL at r*');
});
ok('the cheaper-below-r* DIRECTION follows sign(B), not a fixed sentence', () => {
  // B > 0 ⇒ FULL is cheaper below r*. A hard-coded "recent below r*" legend inverts here.
  const rows = [...rep(3, row(true, false, true)), ...rep(10, row(true, false, false))];
  const m = mcnemarCost(rows, 1);
  assert.equal(m.cheaperBelowRStar, 'full');
  const lo = mcnemarCost(rows, 0.1);            // below r*
  assert.ok(lo.costFull < lo.costRec, 'full must actually be cheaper below r* here');
  const hi = mcnemarCost(rows, 0.5);            // above r*
  assert.ok(hi.costRec < hi.costFull, 'and recent above it');
});
ok('the OTHER sign (A>0, B<0) puts recent below r* — the shipped data’s shape', () => {
  const rows = [...rep(3, row(false, true, true)), ...rep(10, row(false, true, false))];
  const m = mcnemarCost(rows, 1);
  assert.equal(m.A, 3); assert.equal(m.B, -10);
  assert.ok(Math.abs(m.rStar - 0.3) < 1e-9);
  assert.equal(m.cheaperBelowRStar, 'recent');
});
ok('no positive root, A>0 B>0 ⇒ RECENT dominates at every r (and rStar is null, not negative)', () => {
  const rows = [...rep(2, row(false, true, true)), ...rep(2, row(true, false, false))];
  const m = mcnemarCost(rows, 1);
  assert.ok(m.A > 0 && m.B > 0);
  assert.equal(m.rStar, null, 'a negative root must NOT be reported as a crossover');
  assert.equal(m.dominance, 'recent');
  for (const r of [0.1, 1, 10]) assert.ok(mcnemarCost(rows, r).M > 0, `recent must win at r=${r}`);
});
ok('no positive root, A<0 B<0 ⇒ FULL dominates at every r', () => {
  const rows = [...rep(2, row(true, false, true)), ...rep(2, row(false, true, false))];
  const m = mcnemarCost(rows, 1);
  assert.ok(m.A < 0 && m.B < 0);
  assert.equal(m.rStar, null);
  assert.equal(m.dominance, 'full');
  for (const r of [0.1, 1, 10]) assert.ok(mcnemarCost(rows, r).M < 0, `full must win at r=${r}`);
});
ok('dominance comes from A when B is ZERO — reading it off B alone would say `tie`', () => {
  // The discriminating case for the dominance branch. A≠0, B=0 ⇒ no root at all (not even a
  // negative one), and the costs differ by a CONSTANT A at every r. Reading the sign off B would
  // report `tie` and silently erase a real, uniform winner.
  const rows = rep(2, row(false, true, true));
  const m = mcnemarCost(rows, 1);
  assert.equal(m.A, 2); assert.equal(m.B, 0);
  assert.equal(m.rStar, null);
  assert.equal(m.dominance, 'recent', 'must be read off A, not B');
  for (const r of [0.1, 1, 10]) assert.ok(mcnemarCost(rows, r).M > 0);
});
ok('a perfectly tied set reports `tie`, not a basis', () => {
  const m = mcnemarCost([row(true, true, true), row(false, false, false)], 1);
  assert.equal(m.A, 0); assert.equal(m.B, 0);
  assert.equal(m.dominance, 'tie');
});
ok('the null-model CROSSOVERS are real ratios, not the r=1 snapshot', () => {
  // never-gate costs r·nY0; recent costs gateRec + r·greenRec. They cross at gateRec/(nY0−greenRec).
  const rows = [...rep(3, row(true, false, true)), ...rep(10, row(true, false, false))];
  const m = mcnemarCost(rows, 1);
  const r = m.crossovers.recentVsNeverGate;
  assert.ok(r != null && r > 0);
  const at = mcnemarCost(rows, r);
  assert.ok(Math.abs(at.costRec - at.costNeverGate) < 1e-9, 'recent must equal never-gate AT the crossover');
});
ok('the null models are the all-rows baselines, not per-arm', () => {
  const rows = [row(true, false, true), row(false, false, false), row(true, true, true)];
  const m = mcnemarCost(rows, 1);
  assert.equal(m.costGateAll, 2, 'gate-all pays a falseGate on every printed row');
  assert.equal(m.costNeverGate, 1, 'never-gate pays a falseGreen on every non-printed row');
});
ok('mcnemarCost ignores unresolved rows', () => {
  const m = mcnemarCost([row(true, false, true), { resolved: false, unrelRec: true, unrelFull: false, hit: true }], 1);
  assert.equal(m.n, 1);
});
ok('mcnemarCost returns null on an empty set', () => {
  assert.equal(mcnemarCost([], 1), null);
});

// ── bootstrapM: the refusals ────────────────────────────────────────────────────────────────────
ok('bootstrapM REFUSES when too few items carry a discordant row', () => {
  // 40 rows, all concordant except one item ⇒ below MIN_DISCORDANT_ITEMS
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push({ ...row(false, false, true), itemId: i });
  rows.push({ ...row(true, false, false), itemId: 999 });
  assert.equal(bootstrapM(rows, 1, { iters: 50 }), null,
    'a CI over concordant-only draws would look tight while carrying no information');
});
ok('bootstrapM returns an interval when enough items are discordant', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ ...row(true, false, false), itemId: i });
  const ci = bootstrapM(rows, 1, { iters: 200 });
  assert.ok(ci && ci.lo != null && ci.hi <= 1 && ci.lo <= ci.hi);
  assert.ok(ci.discordantItems >= 5);
});
ok('bootstrapM resamples ITEMS, not rows — one dominant item must widen the interval', () => {
  // The clustering is the whole reason this function exists rather than a row bootstrap, and every
  // row-vs-item mutation survived without this. Fixture: one item with 100 rows favouring recent,
  // four items with 1 row each favouring full. Resampling ITEMS makes the big item present-or-
  // absent, so M swings across roughly [-1, +1]; resampling ROWS would pin it near +0.92 with a
  // narrow interval (measured on the real data: item CI is ~1.4× wider than row CI).
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push({ ...row(true, false, false), itemId: 1 });
  for (let k = 2; k <= 5; k++) rows.push({ ...row(true, false, true), itemId: k });
  const ci = bootstrapM(rows, 1, { iters: 500 });
  assert.ok(ci, 'five discordant items clears the refusal');
  assert.ok(ci.hi - ci.lo > 0.5,
    `item-clustered interval must be WIDE here (got [${ci.lo}, ${ci.hi}]); a row bootstrap gives ~0.1`);
  assert.equal(ci.items, 5);
});
ok('bootstrapM is deterministic for a fixed seed', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ ...row(true, false, i % 3 === 0), itemId: i });
  assert.deepEqual(bootstrapM(rows, 1, { iters: 100 }), bootstrapM(rows, 1, { iters: 100 }));
});

// ── blastRadius: the zero-archive don't-build gate ──────────────────────────────────────────────
ok('blastRadius counts branch-1 flips exactly', () => {
  const rows = [
    { askHit: 12, askDays: 14, askRecHit: 0, askRecDays: 3, mode: 'band' },  // full rel / rec unrel → flip
    { askHit: 12, askDays: 14, askRecHit: 3, askRecDays: 3, mode: 'band' },  // both reliable → no flip
  ];
  const b = blastRadius(rows);
  assert.equal(b.branch1, 1);
  assert.equal(b.n, 2);
  assert.equal(b.fracExact, 0.5);
});
ok('blastRadius reports the band-only fraction separately from churn (ASYMMETRIC fixture)', () => {
  // ⚠ The first fixture here flipped BOTH rows, so band and churn were interchangeable and swapping
  // the mode filter to 'churn' survived. This one flips ONLY the band row, so the filter is pinned.
  const rows = [
    { askHit: 12, askDays: 14, askRecHit: 0, askRecDays: 3, mode: 'band' },   // flips
    { askHit: 12, askDays: 14, askRecHit: 3, askRecDays: 3, mode: 'churn' },  // does NOT flip
  ];
  const b = blastRadius(rows);
  assert.equal(b.branch1, 1);
  assert.equal(b.band, 1);
  assert.equal(b.fracBandExact, 1, 'the one band row flipped');
  assert.equal(b.fracExact, 0.5);
});
ok('blastRadius reads the threshold in the RIGHT DIRECTION (< 0.5 is unreliable)', () => {
  // Both bases well ABOVE 0.5 and equal ⇒ no flip. If the comparison were inverted, both would
  // read "unreliable" — still concordant — so also pin a row that is unreliable on BOTH bases.
  const bothReliable = [{ askHit: 14, askDays: 14, askRecHit: 3, askRecDays: 3, mode: 'band' }];
  const bothUnreliable = [{ askHit: 0, askDays: 14, askRecHit: 0, askRecDays: 3, mode: 'band' }];
  assert.equal(blastRadius(bothReliable).branch1, 0);
  assert.equal(blastRadius(bothUnreliable).branch1, 0);
  // full reliable (12/14 = .857), recent unreliable (0/3) ⇒ exactly one flip
  const mixed = [{ askHit: 12, askDays: 14, askRecHit: 0, askRecDays: 3, mode: 'band' }];
  assert.equal(blastRadius(mixed).branch1, 1);
});
ok('blastRadius counts a branch-2 MIRAGE flip only when branch 1 did not already fire', () => {
  // full = 10/14 = 0.714 (> 0.70), recent = 2/3 = 0.667 (< 0.70). Both ≥ 0.5, so branch 1 is
  // concordant and branch 2 is the one that differs.
  const rows = [{ askHit: 10, askDays: 14, askRecHit: 2, askRecDays: 3, mode: 'band' }];
  const b = blastRadius(rows);
  assert.equal(b.branch1, 0, 'branch 1 must NOT fire — both bases are above 0.5');
  assert.equal(b.branch2UpperBound, 1);
  assert.equal(b.fracUpperBound, 1);
  assert.equal(b.fracExact, 0, 'the exact term stays clean; the mirage term is a separate bound');
});
ok('blastRadius branch 2 does not fire when both bases sit the same side of the mirage cut', () => {
  const rows = [{ askHit: 14, askDays: 14, askRecHit: 3, askRecDays: 3, mode: 'band' }];
  assert.equal(blastRadius(rows).branch2UpperBound, 0);
});

console.log(`\n${pass} passed`);
