// admission.test.mjs — pure fixture tests for pipeline/lib/admission.mjs (PLAN-SCREEN-ARCHITECTURE).
// No live data (CLAUDE.md rule 4): synthetic candidates only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackIndex, trackBoost, pickFetchPool, TRACK_BOOST_MIN_N, TRACK_BOOST_CAP } from '../lib/admission.mjs';

test('buildTrackIndex aggregates closed lots per item, ignoring malformed entries', () => {
  const closed = [
    { itemId: 1, realised: 1000 },
    { itemId: 1, realised: -200 },
    { itemId: 1, realised: 500 },
    { itemId: 2, realised: 300 },
    null,
    { itemId: 3 },              // no realised — skipped
    { realised: 100 },          // no itemId — skipped
  ];
  const idx = buildTrackIndex(closed);
  assert.deepEqual(idx.get(1), { n: 3, sumRealised: 1300, wins: 2 });
  assert.deepEqual(idx.get(2), { n: 1, sumRealised: 300, wins: 1 });
  assert.equal(idx.get(3), undefined);
});

test('buildTrackIndex degrades to an empty index on absent/malformed input', () => {
  assert.equal(buildTrackIndex(null).size, 0);
  assert.equal(buildTrackIndex(undefined).size, 0);
  assert.equal(buildTrackIndex('not an array').size, 0);
});

test('trackBoost is BOOST-ONLY: never below 1, regardless of a losing or unknown record', () => {
  assert.equal(trackBoost(null), 1);
  assert.equal(trackBoost({ n: 1, sumRealised: 999999, wins: 1 }), 1);              // below minN
  assert.equal(trackBoost({ n: 10, sumRealised: -5000, wins: 2 }), 1);              // net losing
  assert.equal(trackBoost({ n: 10, sumRealised: 5000, wins: 4 }), 1);               // winRate 0.4 < 0.5
});

test('trackBoost rewards a proven-profitable record, capped and confidence-scaled by n', () => {
  const atMinN = trackBoost({ n: TRACK_BOOST_MIN_N, sumRealised: 100, wins: TRACK_BOOST_MIN_N });
  const thin = trackBoost({ n: TRACK_BOOST_MIN_N + 1, sumRealised: 100, wins: TRACK_BOOST_MIN_N + 1 });
  const thick = trackBoost({ n: 30, sumRealised: 100, wins: 30 });
  assert.equal(atMinN, 1, 'right at the n-gate the confidence term is zero — no boost yet');
  assert.ok(thin > 1, 'one closed lot past the n-gate already earns a small boost');
  assert.ok(thick > thin, 'more closed profitable lots yields a bigger boost');
  assert.ok(thick <= TRACK_BOOST_CAP + 1e-9, 'boost never exceeds the cap');
});

// --- pickFetchPool ------------------------------------------------------------------------------

function mkCand(id, { thin = false, held = false, expGpDay = 0, limitVol = 1000, mid = 1000 } = {}) {
  return { id, thin, held, expGpDay, limitVol, mid, limit: null, activeWin: 24 };
}

test('pickFetchPool: a held candidate always survives, unbounded, regardless of score', () => {
  const cand = [mkCand(1, { held: true, expGpDay: 1 }), ...Array.from({ length: 10 }, (_, i) => mkCand(100 + i, { expGpDay: 1e6 - i }))];
  const { survivors } = pickFetchPool('band', cand, {}, { top: 3, thinReserve: 0, risingReserve: 0, exploreReserve: 0 });
  assert.ok(survivors.some(c => c.id === 1), 'held candidate must survive even with the worst score and a tiny budget');
});

test('pickFetchPool: thin lane ranks by expGpDay (the after-tax edge), not raw gp-flow — SC2', () => {
  // Candidate A has a MUCH bigger raw gp-flow (limitVol*mid) but a smaller real edge (expGpDay);
  // candidate B is the reverse. The legacy thin-reserve ranked purely on gp-flow and would pick A;
  // the unified admission must pick B — the actual anchor-incident fix.
  const A = mkCand('A', { thin: true, expGpDay: 100, limitVol: 10000, mid: 1_000_000 });   // huge gp-flow, tiny edge
  const B = mkCand('B', { thin: true, expGpDay: 10_000_000, limitVol: 10, mid: 100 });      // tiny gp-flow, huge edge
  const { survivors, excluded } = pickFetchPool('band', [A, B], {}, { thinReserve: 1, risingReserve: 0, exploreReserve: 0, top: 1 });
  assert.equal(survivors.length, 1);
  assert.equal(survivors[0].id, 'B', 'the bigger real edge wins the thin slot, not the bigger raw turnover');
  assert.equal(excluded[0].id, 'A');
  assert.equal(excluded[0].reason, 'thin-reserve-full');
});

test('pickFetchPool: exploration reserve pulls in a thin candidate the score alone excluded', () => {
  // "strong" wins the sole thinReserve slot on score; "weak" is the ONLY remainder, so the
  // exploration slot (whatever its rotation bucket) has nowhere else to go — starvation-proofing (SC3).
  const strong = mkCand('strong', { thin: true, expGpDay: 100 });
  const weak = mkCand('weak', { thin: true, expGpDay: 1 });
  const { survivors } = pickFetchPool('band', [strong, weak], {}, { thinReserve: 1, risingReserve: 0, exploreReserve: 1, top: 2, now: 0 });
  assert.equal(survivors.length, 2);
  assert.ok(survivors.some(c => c.id === 'weak'), 'the sole remainder candidate must fill the exploration slot');
});

test('pickFetchPool: exploration ALSO covers the non-thin velocity lane (2026-07-18 extension) — a mid-tier churn/band candidate that loses the throughput ranking is not starved either', () => {
  // Two velocity-lane (non-thin) candidates: "top" wins the sole velocity budget slot on score;
  // "midtier" is the only remainder — same starvation shape as the thin lane, different lane.
  const top = mkCand('top', { expGpDay: 100 });
  const midtier = mkCand('midtier', { expGpDay: 1 });
  const { survivors, excluded } = pickFetchPool('churn', [top, midtier], {}, { thinReserve: 0, risingReserve: 0, exploreReserve: 2, top: 1, now: 0 });
  assert.ok(survivors.some(c => c.id === 'midtier'), 'the velocity lane must also get an exploration slot, not just the thin lane');
  assert.equal(excluded.length, 0);
});

test('pickFetchPool: exploration rotates deterministically across time buckets (no permanent starvation)', () => {
  const weak = [mkCand('w1', { thin: true, expGpDay: 1 }), mkCand('w2', { thin: true, expGpDay: 1 }), mkCand('w3', { thin: true, expGpDay: 1 })];
  const strong = mkCand('strong', { thin: true, expGpDay: 1000 });
  const opts = { thinReserve: 1, risingReserve: 0, exploreReserve: 1, top: 2 };
  const pick = now => pickFetchPool('band', [strong, ...weak], {}, { ...opts, now }).survivors.find(c => c.id !== 'strong').id;
  const picks = new Set([pick(0), pick(30 * 60 * 1000), pick(60 * 60 * 1000)]);
  assert.ok(picks.size > 1, 'different time buckets must rotate which starved candidate gets explored');
});

test('pickFetchPool: track-record boost can promote a thin candidate over a raw-bigger edge, never demote', () => {
  const A = mkCand('A', { thin: true, expGpDay: 100 });
  const B = mkCand('B', { thin: true, expGpDay: 90 });
  const idx = new Map();
  idx.set('B', { n: 20, sumRealised: 5_000_000, wins: 18 });   // strong proven record on B
  const { survivors } = pickFetchPool('band', [A, B], {}, { thinReserve: 1, risingReserve: 0, exploreReserve: 0, top: 1, trackIndex: idx });
  assert.equal(survivors[0].id, 'B', 'a strong track record can flip the ranking in favor of the previously-smaller edge');
});

test('pickFetchPool: no trackIndex entry never penalizes a candidate (boost degrades to 1)', () => {
  const A = mkCand('A', { thin: true, expGpDay: 100 });
  const B = mkCand('B', { thin: true, expGpDay: 90 });
  const idx = new Map();  // empty — neither A nor B has a record
  const { survivors } = pickFetchPool('band', [A, B], {}, { thinReserve: 1, risingReserve: 0, exploreReserve: 0, top: 1, trackIndex: idx });
  assert.equal(survivors[0].id, 'A', 'with no track record for either, the bigger raw edge still wins — unchanged');
});

test('pickFetchPool: every non-admitted candidate is returned with a reason (SC1)', () => {
  const cand = [mkCand('a', { expGpDay: 100 }), mkCand('b', { expGpDay: 50 }), mkCand('c', { thin: true, expGpDay: 10 })];
  const { survivors, excluded } = pickFetchPool('band', cand, {}, { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0 });
  assert.equal(survivors.length, 1);
  assert.equal(excluded.length, 2);
  for (const e of excluded) assert.ok(typeof e.reason === 'string' && e.reason.length > 0);
});

test('pickFetchPool: value-niche candidates pass through unchanged (own valueScore top-N, out of scope)', () => {
  const cand = [{ id: 1, valueScore: 5 }, { id: 2, valueScore: 9 }, { id: 3, valueScore: 1 }];
  const { survivors, excluded } = pickFetchPool('value', cand, {}, { top: 2 });
  assert.deepEqual(survivors.map(c => c.id), [2, 1]);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].reason, 'value-top-n');
});
