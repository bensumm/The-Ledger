// admission.test.mjs — pure fixture tests for pipeline/lib/signal/admission.mjs (PLAN-SCREEN-ARCHITECTURE
// + PLAN-MID-TIER-ADMISSION MT2/MT3).
// No live data (CLAUDE.md rule 4): synthetic candidates only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackIndex, trackBoost, pickFetchPool, TRACK_BOOST_MIN_N, TRACK_BOOST_CAP, clampUnionFetch, rotationPeriodMs, ROTATE_MS, safeSlot } from '../lib/signal/admission.mjs';
import { CHURN_VOL_CUT } from '../lib/signal/structural-admission.mjs';

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

function mkCand(id, { thin = false, held = false, expGpDay = 0, limitVol = 1000, mid = 1000, volDay, limit = null } = {}) {
  const c = { id, thin, held, expGpDay, limitVol, mid, limit, activeWin: 24 };
  if (volDay !== undefined) c.volDay = volDay;   // omitted by default — see the fail-closed test below
  return c;
}
// MT2 lane helpers. classifyVolLane splits on TOTAL two-sided volume (hpv+lpv), NOT the thin-side depth.
const GEAR_VOL = CHURN_VOL_CUT - 1;    // just under the cut → gear lane
const CHURN_VOL = CHURN_VOL_CUT;       // at the cut → churn lane (boundary is inclusive-churn)

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

// --- AR2: exploration-rotation marker (PLAN-ARCHITECTURE-COHERENCE) ------------------------------

test('pickFetchPool AR2: an exploration-admitted survivor carries via:"explore"; a ranked-in one does not', () => {
  // "strong" wins the sole thinReserve slot on score (ranked in — no marker); "weak" is the only
  // remainder, so it fills the exploration slot (rotating lottery pick — marked).
  const strong = mkCand('strong', { thin: true, expGpDay: 100 });
  const weak = mkCand('weak', { thin: true, expGpDay: 1 });
  const { survivors } = pickFetchPool('band', [strong, weak], {}, { thinReserve: 1, risingReserve: 0, exploreReserve: 1, top: 2, now: 0 });
  const strongS = survivors.find(c => c.id === 'strong');
  const weakS = survivors.find(c => c.id === 'weak');
  assert.equal(strongS.via, undefined, 'a ranked-in survivor carries no via field (byte-identical shape to before)');
  assert.equal(weakS.via, 'explore', 'the exploration-slotted survivor is tagged via:"explore"');
});

test('pickFetchPool AR2: with exploreReserve 0 no survivor carries via — JSON shape unchanged from before the marker', () => {
  const cand = [mkCand('a', { expGpDay: 100 }), mkCand('b', { expGpDay: 50 }), mkCand('c', { thin: true, expGpDay: 10 })];
  const { survivors } = pickFetchPool('band', cand, {}, { top: 3, thinReserve: 1, risingReserve: 0, exploreReserve: 0 });
  for (const s of survivors) assert.ok(!('via' in s), 'no exploration ⇒ no via field on any survivor (common case, byte-parity)');
});

test('pickFetchPool: value-niche candidates take their own valueScore top-N (valueReserve:0 pins the pure cut)', () => {
  const cand = [{ id: 1, valueScore: 5 }, { id: 2, valueScore: 9 }, { id: 3, valueScore: 1 }];
  const { survivors, excluded } = pickFetchPool('value', cand, {}, { top: 2, valueReserve: 0 });
  assert.deepEqual(survivors.map(c => c.id), [2, 1]);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].reason, 'value-top-n');
});

// --- PLAN-FETCH-POOL-SCALING chunk 1: the VALUE RESERVE, in the DEFAULT (unified) admission path -----
test('pickFetchPool value: a buried high-amplitude straggler gets a reserved slot tagged via:"reserve" (finding #7)', () => {
  const cand = [];
  for (let i = 0; i < 5; i++) cand.push({ id: i, valueScore: 100 - i, valueRanges: { afterTaxAmpPct: 0.05 } });
  cand.push({ id: 999, valueScore: 1, valueRanges: { afterTaxAmpPct: 0.40 } });   // buried by score, huge cycle
  const { survivors, excluded } = pickFetchPool('value', cand, {}, { top: 5, valueReserve: 1 });
  assert.equal(survivors.length, 6, 'top-5 by valueScore + the 1 amplitude-reserved straggler');
  const reserved = survivors.find(c => c.id === 999);
  assert.ok(reserved, 'the buried big-cycle candidate reached the fetch pool via the reserve');
  assert.equal(reserved.via, 'reserve', 'tagged via:"reserve" (distinct from a ranked-in pick)');
  assert.ok(!excluded.some(c => c.id === 999), 'the reserved straggler is NOT also reported excluded');
  assert.equal(excluded.length, 0, 'the whole remainder was reserved (only one straggler existed)');
});

test('pickFetchPool value: the reserve ranks the remainder by amplitude, not valueScore; ranked top-N untouched', () => {
  const cand = [
    { id: 1, valueScore: 100, valueRanges: { afterTaxAmpPct: 0.05 } },   // ranked in (top-1)
    { id: 2, valueScore: 50, valueRanges: { afterTaxAmpPct: 0.08 } },    // higher score, lower amp
    { id: 3, valueScore: 40, valueRanges: { afterTaxAmpPct: 0.30 } },    // lower score, higher amp → reserve pick
  ];
  const { survivors, excluded } = pickFetchPool('value', cand, {}, { top: 1, valueReserve: 1 });
  assert.equal(survivors[0].id, 3, 'the reserve slot goes to the biggest amplitude, not the bigger valueScore');
  assert.equal(survivors[1].id, 1, 'the ranked top-1 follows (reserve prepended, top-N unreshuffled)');
  assert.equal(excluded[0].id, 2, 'the un-reserved remainder is still honestly reported excluded');
  assert.equal(excluded[0].reason, 'value-top-n');
});

// --- F-B (PLAN-OSCILLATION-CYCLE post-landing follow-up): the amplitude watchlist RESERVE, in the
// DEFAULT ('unified') admission path — this is the branch a real scan actually runs (ADMISSION==='unified'
// unless --admission legacy), so the fix has to be pinned here too, not just in gatecandidates.mjs's
// legacy rankAndSlice. ------------------------------------------------------------------------------
test('pickFetchPool amplitude: a watched straggler below the top-N still reaches the fetch pool', () => {
  const cand = [];
  for (let i = 0; i < 30; i++) cand.push({ id: i, ampProxy: 0.5 - i * 0.001, watched: false });
  cand.push({ id: 999, ampProxy: 0.001, watched: true });
  const { survivors, excluded } = pickFetchPool('amplitude', cand, {}, { top: 25 });
  assert.equal(survivors.length, 26, 'top-25 by proxy plus the 1 reserved watched straggler');
  assert.ok(survivors.some(c => c.id === 999), 'the watched straggler reached the fetch pool despite ranking #31');
  assert.ok(!excluded.some(c => c.id === 999), 'the watched straggler is not ALSO reported excluded');
  assert.equal(excluded.length, 5, 'the other 5 unwatched non-top-25 stragglers are still honestly reported excluded');
});

test('pickFetchPool amplitude: value/amplitude niches pass through unchanged when nothing is watched (byte-parity)', () => {
  const cand = Array.from({ length: 5 }, (_, i) => ({ id: i, ampProxy: 0.5 - i * 0.01, watched: false }));
  const { survivors, excluded } = pickFetchPool('amplitude', cand, {}, { top: 3 });
  assert.deepEqual(survivors.map(c => c.id), [0, 1, 2], 'unwatched pool behaves exactly like before F-B');
  assert.equal(excluded.length, 2);
});

// --- PLAN-FETCH-POOL-SCALING chunk 4: the cross-niche fetch-budget ceiling (clampUnionFetch) --------

test('clampUnionFetch: a union within budget passes through unchanged (strict no-op below the ceiling)', () => {
  const niches = [
    { mode: 'band', survivors: [{ id: 1 }, { id: 2 }] },
    { mode: 'churn', survivors: [{ id: 3 }] },
  ];
  const out = clampUnionFetch(niches, 10);
  assert.equal(out.trimmedCount, 0);
  assert.equal(out.unionSize, 3);
  for (const n of out.niches) assert.equal(n.trimmed.length, 0, 'nothing trimmed below the cap');
});

test('clampUnionFetch: a union over budget is clamped, and trimmed rows are returned (never silent)', () => {
  const niches = [
    { mode: 'band', survivors: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    { mode: 'churn', survivors: [{ id: 4 }, { id: 5 }, { id: 6 }] },
  ];
  const out = clampUnionFetch(niches, 4);
  assert.equal(out.unionSize, 4, 'deduped union clamped to the cap');
  assert.equal(out.trimmedCount, 2, 'exactly the overflow is trimmed');
  // round-robin keeps the best-ranked from each niche fairly: band#1, churn#4, band#2, churn#5 → trim band#3, churn#6.
  const trimmedIds = out.niches.flatMap(n => n.trimmed.map(c => c.id)).sort();
  assert.deepEqual(trimmedIds, [3, 6], 'the lowest-ranked of each niche is trimmed, fairly');
});

test('clampUnionFetch: reserve/held/watched/via-tagged survivors are PROTECTED from trimming', () => {
  const niches = [
    { mode: 'band',  survivors: [{ id: 1, held: true }, { id: 2 }, { id: 3 }] },
    { mode: 'value', survivors: [{ id: 4, via: 'reserve' }, { id: 5, watched: true }, { id: 6 }] },
  ];
  const out = clampUnionFetch(niches, 4);
  const keptIds = new Set(out.niches.flatMap(n => n.survivors.map(c => c.id)));
  assert.ok(keptIds.has(1) && keptIds.has(4) && keptIds.has(5), 'held/via-reserve/watched all survive the clamp');
  assert.equal(out.unionSize, 4);
  // 3 protected fill the budget of 4; only 1 unprotected slot remains → 2 of {2,3,6} trimmed.
  assert.equal(out.trimmedCount, 2);
});

test('clampUnionFetch: shared (deduped) ids across niches count ONCE toward the budget', () => {
  const niches = [
    { mode: 'band',  survivors: [{ id: 1 }, { id: 2 }] },
    { mode: 'churn', survivors: [{ id: 1 }, { id: 3 }] },   // id 1 is shared
  ];
  const out = clampUnionFetch(niches, 3);   // union {1,2,3} == 3 → within budget
  assert.equal(out.trimmedCount, 0, 'the shared id is not double-counted, so the union fits');
  assert.equal(out.unionSize, 3);
});

// --- MT2: GEAR_RESERVE (PLAN-MID-TIER-ADMISSION) -------------------------------------------------
// The starved class is MID-PRICE gear: too liquid to be `thin` (so the thin reserve never covers it),
// too low-margin to outrank churn on absolute expGpDay (so it never wins a velocity slot). These pin
// that it now gets guaranteed slots WITHOUT disturbing the ranked top-N.

test('MT2 gear reserve: a gear-lane candidate that lost the velocity sort still gets a fetch slot', () => {
  const churn = mkCand('churn', { expGpDay: 4_210_000, volDay: CHURN_VOL });   // the class that always wins
  const gearA = mkCand('gearA', { expGpDay: 692_000, volDay: GEAR_VOL });      // neitiznot-shaped
  const gearB = mkCand('gearB', { expGpDay: 500_000, volDay: GEAR_VOL });
  const { survivors, excluded } = pickFetchPool('band', [churn, gearA, gearB], {},
    { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 1 });
  assert.deepEqual(survivors.map(c => c.id), ['churn', 'gearA'], 'the ranked slot goes to churn; the reserve rescues the best gear-lane loser');
  assert.equal(survivors.find(c => c.id === 'gearA').via, 'reserve', 'a reserve-slotted row is marked, not disguised as a ranked-in pick');
  assert.deepEqual(excluded.map(c => c.id), ['gearB'], 'a reserved row must NOT also be reported as excluded');
});

test('MT2 gear reserve: gearReserve 0 is byte-identical to the pre-MT2 pool', () => {
  const cand = [
    mkCand('churn', { expGpDay: 4_210_000, volDay: CHURN_VOL }),
    mkCand('gearA', { expGpDay: 692_000, volDay: GEAR_VOL }),
  ];
  const opts = { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0 };
  const off = pickFetchPool('band', cand, {}, { ...opts, gearReserve: 0 });
  assert.deepEqual(off.survivors.map(c => c.id), ['churn']);
  assert.ok(off.survivors.every(c => c.via === undefined), 'with the reserve off no row carries a via tag — the shape is unchanged');
  assert.deepEqual(off.excluded.map(c => c.id), ['gearA']);
});

test('MT2 gear reserve: CHURN-lane losers are never reserved (the reserve is not a second top-N)', () => {
  const win = mkCand('win', { expGpDay: 4_210_000, volDay: CHURN_VOL });
  const churnLoser = mkCand('churnLoser', { expGpDay: 4_200_000, volDay: CHURN_VOL });
  const { survivors } = pickFetchPool('band', [win, churnLoser], {},
    { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 4 });
  assert.deepEqual(survivors.map(c => c.id), ['win'], 'a churn-lane candidate that merely lost the sort gets no reserve slot');
});

test('MT2 gear reserve: FAIL-CLOSED on a missing volDay — no lane reading, no slot', () => {
  // The trap this guards: classifyVolLane(c.volDay ?? 0) would read a MISSING volDay as 0, which is
  // below CHURN_VOL_CUT, so every volDay-less candidate would classify as gear and the reserve would be
  // handed to an arbitrary set. Absent the field, the candidate must simply not be eligible.
  const win = mkCand('win', { expGpDay: 100 });
  const noLane = mkCand('noLane', { expGpDay: 1 });                 // mkCand omits volDay by default
  const { survivors, excluded } = pickFetchPool('band', [win, noLane], {},
    { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 4 });
  assert.deepEqual(survivors.map(c => c.id), ['win']);
  assert.deepEqual(excluded.map(c => c.id), ['noLane'], 'a candidate with no volDay is excluded, never silently treated as gear');
});

test('MT2 gear reserve: limitVol is NOT a substitute for volDay (the min-vs-sum trap)', () => {
  // A balanced churn book: limitVol = min(hpv,lpv) sits below the cut while the real volDay = hpv+lpv
  // is above it. Classifying on limitVol would call this GEAR and reserve it — the exact poisoning the
  // plan flags. Pinned by asserting the churn item is NOT reserved even though its limitVol looks gear-ish.
  const win = mkCand('win', { expGpDay: 999_999, volDay: CHURN_VOL });
  const balancedChurn = mkCand('balancedChurn', { expGpDay: 10, limitVol: CHURN_VOL_CUT - 1, volDay: (CHURN_VOL_CUT - 1) * 2 });
  const { survivors } = pickFetchPool('band', [win, balancedChurn], {},
    { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 4 });
  assert.deepEqual(survivors.map(c => c.id), ['win'], 'lane must be read off volDay (hpv+lpv), not the thin-side limitVol');
});

test('MT2 gear reserve: never double-spends a slot with the exploration rotation', () => {
  const win = mkCand('win', { expGpDay: 1e6, volDay: CHURN_VOL });
  const gear = mkCand('gear', { expGpDay: 1, volDay: GEAR_VOL });   // the ONLY remainder
  const { survivors } = pickFetchPool('band', [win, gear], {},
    { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 2, gearReserve: 4, now: 0 });
  assert.equal(survivors.filter(c => c.id === 'gear').length, 1, 'the same item must not be admitted twice by two different reserves');
});

test('MT2 gear reserve: reserved rows are PROTECTED from the cross-niche fetch clamp', () => {
  // via:'reserve' already makes a row isProtected in clampUnionFetch — pinned so a future edit to the
  // marker cannot silently make gear-reserved rows the first thing trimmed under a tight budget.
  const gearRow = { id: 'gear', via: 'reserve' };
  const out = clampUnionFetch([{ mode: 'band', survivors: [{ id: 'a' }, { id: 'b' }, gearRow] }], 1);
  assert.ok(out.niches[0].survivors.some(c => c.id === 'gear'), 'a gear-reserved row survives the clamp');
});

// --- MT3: exploration rotation period ------------------------------------------------------------

test('MT3 rotationPeriodMs: reports the real wait, and null when nothing rotates', () => {
  assert.equal(rotationPeriodMs(140, 1), 140 * ROTATE_MS, '1 slot over 140 candidates = 140 rotations');
  assert.equal(rotationPeriodMs(140, 1) / 3.6e6, 70, '…which is the ~70 HOURS the plan flags, not "eventually"');
  assert.equal(rotationPeriodMs(5, 2), 3 * ROTATE_MS, 'partial turns round UP — the last candidate still waits a full bucket');
  assert.equal(rotationPeriodMs(0, 1), null, 'nothing excluded → no rotation to report');
  assert.equal(rotationPeriodMs(140, 0), null, 'no exploration budget → no rotation to report');
});

// --- MT-V2: MID_TIER_RESERVE + paging (PLAN-MID-TIER-V2) -----------------------------------------
// GEAR_RESERVE works mechanically but `gear` is a VOLUME lane, so its peer group is dominated by cheap
// high-buy-limit consumables and the mid-price equipment it was built for still loses. This reserve
// re-cuts the peer group by GE BUY LIMIT. These pin the axis, the paging, and the fail-closed-but-
// VISIBLE null-limit handling.

const GEAR = CHURN_VOL_CUT - 1;   // gear-lane volDay

test('MT-V2 mid-tier reserve: a LOW-LIMIT candidate wins over a higher-expGpDay HIGH-LIMIT one', () => {
  // The whole point: the limit filter, not the score, separates b from c. c outranks b on expGpDay and
  // would win any score-only reserve — it must NOT win this one.
  const a = mkCand('a', { expGpDay: 2_000_000, volDay: GEAR, limit: 10000 });   // takes the gear slot
  const b = mkCand('b', { expGpDay: 500_000, volDay: GEAR, limit: 70 });        // restricted — the wanted class
  const c = mkCand('c', { expGpDay: 1_000_000, volDay: GEAR, limit: 15000 });   // higher score, mass-tradeable
  const { survivors } = pickFetchPool('band', [a, b, c], {},
    { top: 0, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 1, midTierReserve: 1 });
  const ids = survivors.map(s => s.id);
  assert.ok(ids.includes('a'), 'the gear reserve still takes the top-ranked gear-lane candidate');
  assert.ok(ids.includes('b'), 'the mid-tier reserve admits the LOW-LIMIT candidate');
  assert.ok(!ids.includes('c'), 'a higher-expGpDay HIGH-LIMIT candidate must not win the mid-tier slot');
});

test('MT-V2 mid-tier reserve: midTierReserve 0 is a strict no-op', () => {
  const a = mkCand('a', { expGpDay: 2_000_000, volDay: GEAR, limit: 10000 });
  const b = mkCand('b', { expGpDay: 500_000, volDay: GEAR, limit: 70 });
  const opts = { top: 0, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 1 };
  const off = pickFetchPool('band', [a, b], {}, { ...opts, midTierReserve: 0 });
  assert.deepEqual(off.survivors.map(s => s.id), ['a']);
  assert.deepEqual(off.excluded.map(s => s.id), ['b'], 'with the reserve off the low-limit row stays excluded');
});

test('MT-V2 mid-tier reserve: FAIL-CLOSED on a null limit, and the drop is REPORTED not silent', () => {
  // structural-admission.mjs records "null => NOT exclude — ~89 newer gear items carry limit=null", so
  // this filter is a deliberate local exception. It must therefore be VISIBLE: asserting the specific
  // reason string is the point — a generic top-n-full here is the silent-drop regression.
  const a = mkCand('a', { expGpDay: 2_000_000, volDay: GEAR, limit: 10000 });
  const nul = mkCand('nul', { expGpDay: 1_500_000, volDay: GEAR, limit: null });
  const { survivors, excluded } = pickFetchPool('band', [a, nul], {},
    { top: 0, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 1, midTierReserve: 4 });
  assert.ok(!survivors.some(s => s.id === 'nul'), 'a null-limit candidate never takes a mid-tier slot');
  const row = excluded.find(c => c.id === 'nul');
  assert.equal(row.reason, 'mid-tier-limit-unknown', 'the structural shut-out must be named, not folded into top-n-full');
});

test('MT-V2 mid-tier reserve: offset pages to the NEXT batch without re-ranking', () => {
  const pool = [
    mkCand('p1', { expGpDay: 900, volDay: GEAR, limit: 70 }),
    mkCand('p2', { expGpDay: 800, volDay: GEAR, limit: 70 }),
    mkCand('p3', { expGpDay: 700, volDay: GEAR, limit: 70 }),
    mkCand('p4', { expGpDay: 600, volDay: GEAR, limit: 70 }),
  ];
  const opts = { top: 0, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 0, midTierReserve: 2 };
  const page1 = pickFetchPool('band', pool, {}, { ...opts, midTierOffset: 0 }).survivors.map(s => s.id);
  const page2 = pickFetchPool('band', pool, {}, { ...opts, midTierOffset: 2 }).survivors.map(s => s.id);
  assert.deepEqual(page1, ['p1', 'p2'], 'page 1 is the top two by rank');
  assert.deepEqual(page2, ['p3', 'p4'], 'page 2 is the NEXT two, in unchanged rank order');
  assert.equal(page1.filter(id => page2.includes(id)).length, 0, 'pages are disjoint');
  const past = pickFetchPool('band', pool, {}, { ...opts, midTierOffset: 99 }).survivors.map(s => s.id);
  assert.deepEqual(past, [], 'an offset past the pool admits nothing — it must not wrap around');
});

test('MT-V2 safeSlot: NaN/negative degrade to the default instead of a negative slice', () => {
  // .slice() with a negative start counts from the END, and a negative reserve makes the end bound
  // negative too — which can silently admit MORE rows than asked. Both must fall back, not compute.
  assert.equal(safeSlot(3, 9), 3);
  assert.equal(safeSlot(0, 9), 0, 'zero is a legitimate value, never replaced by the fallback');
  assert.equal(safeSlot(2.7, 9), 2, 'a finite non-integer truncates — a safe degrade');
  assert.equal(safeSlot(-2, 9), 9, 'negative falls back');
  assert.equal(safeSlot(NaN, 9), 9, 'NaN falls back');
  assert.equal(safeSlot(undefined, 9), 9);
  const pool = [
    mkCand('p1', { expGpDay: 900, volDay: GEAR, limit: 70 }),
    mkCand('p2', { expGpDay: 800, volDay: GEAR, limit: 70 }),
    mkCand('p3', { expGpDay: 700, volDay: GEAR, limit: 70 }),
  ];
  const opts = { top: 0, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 0 };
  const neg = pickFetchPool('band', pool, {}, { ...opts, midTierReserve: 2, midTierOffset: -2 }).survivors.map(s => s.id);
  assert.deepEqual(neg, ['p1', 'p2'], 'a negative offset yields the DEFAULT first page, not a tail slice');
});

test('MT-V2 mid-tier reserve: no double-admit with the gear or exploration reserve', () => {
  const solo = mkCand('solo', { expGpDay: 1000, volDay: GEAR, limit: 70 });   // every reserve would want it
  const filler = mkCand('filler', { expGpDay: 5000, volDay: GEAR, limit: 10000 });
  const { survivors, excluded } = pickFetchPool('band', [filler, solo], {},
    { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 2, gearReserve: 4, midTierReserve: 4, now: 0 });
  assert.equal(survivors.filter(s => s.id === 'solo').length, 1, 'admitted exactly once across all reserves');
  assert.ok(!excluded.some(c => c.id === 'solo'), 'an admitted row is never also reported excluded');
});

test('MT-V2 mid-tier reserve: every admission is gear-lane AND within the limit cut', () => {
  const cand = [
    mkCand('gearLow', { expGpDay: 100, volDay: GEAR, limit: 70 }),
    mkCand('churnLow', { expGpDay: 9_000_000, volDay: CHURN_VOL_CUT, limit: 70 }),   // low limit but CHURN lane
    mkCand('gearHigh', { expGpDay: 8_000_000, volDay: GEAR, limit: 10000 }),
  ];
  const { survivors } = pickFetchPool('band', cand, {},
    { top: 0, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 0, midTierReserve: 4 });
  assert.deepEqual(survivors.map(s => s.id), ['gearLow'], 'churn-lane and over-cut candidates are both ineligible');
});

test('MT-V2 mid-tier reserve: the ranked top-N and GEAR_RESERVE admissions are untouched', () => {
  const cand = [
    mkCand('ranked', { expGpDay: 9_000_000, volDay: GEAR, limit: 10000 }),
    mkCand('gearPick', { expGpDay: 5_000_000, volDay: GEAR, limit: 12000 }),
    mkCand('midPick', { expGpDay: 100, volDay: GEAR, limit: 70 }),
  ];
  const base = { top: 1, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 1 };
  const off = pickFetchPool('band', cand, {}, { ...base, midTierReserve: 0 });
  const on = pickFetchPool('band', cand, {}, { ...base, midTierReserve: 2 });
  assert.ok(off.survivors.every(c => on.survivors.some(s => s.id === c.id)),
    'turning the mid-tier reserve on is strictly additive — it displaces nothing');
  assert.ok(on.survivors.some(s => s.id === 'midPick'), 'and it adds the low-limit row');
});

// --- EF-0a: pre-fetch position stamps (preRank/prePool) — the `via`+rank ledger prerequisite ------

test('EF-0a: pickFetchPool stamps preRank/prePool on every gated candidate — survivors AND excluded', () => {
  // empty dailySeries → proxyDrift null → softFactor uniform (0.7) → unified ordering = expGpDay desc
  const cand = [
    mkCand(1, { expGpDay: 300, volDay: CHURN_VOL }),
    mkCand(2, { expGpDay: 100, volDay: CHURN_VOL }),
    mkCand(3, { expGpDay: 200, volDay: CHURN_VOL }),
  ];
  const { survivors, excluded } = pickFetchPool('band', cand, {},
    { top: 2, thinReserve: 0, risingReserve: 0, exploreReserve: 0, gearReserve: 0, midTierReserve: 0 });
  const all = [...survivors, ...excluded];
  const rankOf = id => all.find(c => c.id === id).preRank;
  assert.equal(rankOf(1), 1); assert.equal(rankOf(3), 2); assert.equal(rankOf(2), 3);
  assert.ok(all.every(c => c.prePool === 3), 'every candidate carries the pool size (the "of 178")');
  // the crowded-out row keeps its stamp — the EF0 "would the buried row have been good?" key
  assert.deepEqual(excluded.map(c => c.id), [2]);
  assert.equal(excluded[0].preRank, 3);
  // and admission itself is untouched by the stamp (survivor set is the plain top-2)
  assert.deepEqual(survivors.map(c => c.id).sort(), [1, 3]);
});

test('EF-0a: value branch stamps preRank by valueScore ordering; reserve/excluded clones inherit it', () => {
  const cand = [
    { id: 1, valueScore: 5, valueRanges: { afterTaxAmpPct: 0.01 } },
    { id: 2, valueScore: 9, valueRanges: { afterTaxAmpPct: 0.02 } },
    { id: 3, valueScore: 1, valueRanges: { afterTaxAmpPct: 0.50 } },
    { id: 4, valueScore: 2, valueRanges: { afterTaxAmpPct: 0.03 } },
  ];
  const { survivors, excluded } = pickFetchPool('value', cand, {}, { top: 2, valueReserve: 1 });
  const all = [...survivors, ...excluded];
  const rankOf = id => all.find(c => c.id === id).preRank;
  assert.equal(rankOf(2), 1); assert.equal(rankOf(1), 2); assert.equal(rankOf(4), 3); assert.equal(rankOf(3), 4);
  const reserve = survivors.find(c => c.via === 'reserve');
  assert.equal(reserve.id, 3, 'highest cycle-amplitude of the excluded remainder wins the reserve');
  assert.equal(reserve.preRank, 4, 'the via-tagged reserve CLONE inherits the position stamp');
  assert.ok(all.every(c => c.prePool === 4));
});
