/**
 * watch-reserve.test.mjs — the BAND stack's watchlist fetch-pool reserve (PP-R).
 *
 * WHY THIS EXISTS. `gateAmplitudeCandidates` marked `watched` candidates and `rankAndSlice`/
 * `pickFetchPool` gave them a reserved fetch slot — but ONLY on the amplitude branch, which returns
 * early. The band/churn/scalp path below it had a held reserve, a thin reserve and a rising reserve
 * and NO watch reserve, and its candidates never carried `watched` at all. A watchlisted item that
 * ranked below the cutoff therefore never reached a NICHE TABLE — `Webweaver bow (u)` (27652) logged
 * `thin-reserve-full` on band while its own watchlist row graded A-. The item itself was still quoted
 * and graded every scan by runWatchlist; what it lost is the lane (partition, Path-A sort, validators,
 * digest, per-niche screen.json row), which is the claim these cases pin.
 *
 * Every case below was confirmed RED against the pre-fix code; the mutant each one kills is named
 * inline. A test that passes both ways is not a regression test.
 *
 * Run: `node pipeline/test/watch-reserve.test.mjs`. Auto-discovered by run-tests.mjs. PURE/synthetic —
 * `rankAndSlice`, `watchReserved` and `pickFetchPool` take plain candidate objects, so nothing here
 * touches the render shell, the network, or disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankAndSlice, watchReserved, gateCandidates, WATCH_RESERVE_DEFAULT, THIN_RESERVE_DEFAULT } from '../lib/signal/gatecandidates.mjs';
import { pickFetchPool } from '../lib/signal/admission.mjs';

// A band-stack candidate in the shape gateCandidates' edgeFn returns. Non-thin by default so it
// competes on the velocity lane; `expGpDay` descending is the ranking that decides admission.
const cand = (id, expGpDay, extra = {}) => ({
  id, expGpDay, expGpDayLegacy: expGpDay, limitVol: 5000, volDay: 10000, mid: 1000, limit: 100,
  activeWin: 10, thin: false, held: false, watched: false, ...extra,
});
// A pool of `n` filler candidates ranked strictly above anything the tests care about.
const filler = n => Array.from({ length: n }, (_, i) => cand(1000 + i, 10_000_000 - i));
const ids = rows => rows.map(c => c.id);
// pickFetchPool's own reserves all draw from the excluded remainder; zeroing them isolates the one
// under test (the sizes are opts precisely so a fixture can).
const ISOLATE = { top: 10, exploreReserve: 0, gearReserve: 0, midTierReserve: 0 };

test('a watchlisted candidate below the top-N cutoff still reaches the fetch pool', () => {
  // MUTANT: drop the watch reserve from rankAndSlice (the pre-fix band path) — red. THE defect: the
  // row is gated in, ranks last, and never enters the niche lane's fetch pool.
  const pool = [...filler(10), cand(27652, 1, { watched: true })];
  const out = rankAndSlice('band', pool, {}, { top: 10 });
  assert.ok(ids(out).includes(27652), 'watchlisted straggler must be admitted');
  assert.equal(out.length, 11, 'the reserve ADDS a slot — it must not displace a ranked-in row');
});

test('the same guarantee holds on the DEFAULT (unified) admission path, not just legacy', () => {
  // MUTANT: fix only rankAndSlice — red. screen-flip-niches.mjs runs `pickFetchPool` unless
  // `--admission legacy`, so a band-only fix in gatecandidates.mjs would never execute in production.
  const pool = [...filler(10), cand(27652, 1, { watched: true })];
  // ISOLATE: without it the explore/gear/mid-tier reserves would rescue the row for unrelated
  // reasons and the case would pass against a missing watch reserve — a test that proves nothing.
  const { survivors, excluded } = pickFetchPool('band', pool, {}, ISOLATE);
  assert.ok(ids(survivors).includes(27652), 'watchlisted straggler must be admitted on the default path');
  assert.equal(excluded.some(c => c.id === 27652), false, 'an admitted row must not also be reported excluded');
});

test('a watchlisted THIN candidate crowded out of the thin reserve is still admitted', () => {
  // MUTANT: select the reserve from the non-thin lane only — red. This is the anchor case's own lane:
  // every logged Webweaver exclusion read `thin-reserve-full`, never `top-n-full`.
  const thins = Array.from({ length: THIN_RESERVE_DEFAULT + 2 }, (_, i) =>
    cand(2000 + i, 5_000_000 - i, { thin: true, limitVol: 900 - i, mid: 15_000_000 }));
  const web = cand(27652, 700_000, { thin: true, limitVol: 1, mid: 15_223_232, watched: true });
  const out = rankAndSlice('band', [...thins, web], {}, { top: 40 });
  assert.ok(ids(out).includes(27652), 'a watchlisted big ticket must not die of thin-reserve crowding');
  assert.ok(ids(pickFetchPool('band', [...thins, web], {}, { top: 40 }).survivors).includes(27652));
});

test('gateCandidates STAMPS `watched` on band candidates — the reserve has nothing to select otherwise', () => {
  // MUTANT: leave `watched` off the band edgeFn's returned object (the pre-fix state) — red. The
  // amplitude gate set it, the band gate did not, so `c.watched` read `undefined` for every
  // band/churn/scalp candidate and any reserve keyed on it would be a no-op that LOOKS implemented.
  const ctx = {
    v24: { 27652: { highPriceVolume: 679, lowPriceVolume: 679, avgHighPrice: 15_365_295, avgLowPrice: 15_081_169 } },
    map: { byId: { 27652: { name: 'Webweaver bow (u)', limit: null } } },
    bands: { 27652: { tradedWin: 21, sawLow: true, sawHigh: true, bandLo: 14_000_000, bandHi: 15_312_933 } },
    daily: {},
  };
  const out = gateCandidates('band', ctx, undefined, new Set(), new Set([27652]));
  assert.equal(out.length, 1, 'fixture must clear the gate stack, else this case proves nothing');
  assert.equal(out[0].watched, true, 'band candidates must carry `watched`');
  // …and it must be FALSE, not absent, for an unwatched item — `undefined` would make every
  // `!c.watched` reader accidentally right and every future `watched === false` reader wrong.
  assert.equal(gateCandidates('band', ctx, undefined, new Set(), new Set())[0].watched, false);
});

test('the reserve is BOUNDED — it can never prepend more than its named constant', () => {
  // MUTANT: copy the amplitude branch's UNBOUNDED reserve — red. An unbounded prepend's only
  // structural limit is the watchlist's own length (60 today) on a lane that already carries four other
  // reserves; the bound is what keeps the worst case a stated number instead of a file's size.
  const many = Array.from({ length: 30 }, (_, i) => cand(3000 + i, 100 - i, { watched: true }));
  const out = rankAndSlice('band', [...filler(10), ...many], {}, { top: 10 });
  assert.equal(out.length, 10 + WATCH_RESERVE_DEFAULT);
  // The other unified-path reserves (explore/gear/mid-tier) draw from the same remainder, so they are
  // zeroed here to measure THIS bound rather than their sum.
  const { survivors } = pickFetchPool('band', [...filler(10), ...many], {}, ISOLATE);
  assert.equal(survivors.length, 10 + WATCH_RESERVE_DEFAULT);
  assert.equal(survivors.filter(c => c.via === 'watch').length, WATCH_RESERVE_DEFAULT);
});

test('when the bound binds, the slots go to the highest expGpDay — deterministically', () => {
  // MUTANT: rank the reserve by insertion order / gp-flow — red. gp-flow is the dimension
  // admission.mjs's founding ruling rejected; the tie-break on id keeps two equal edges stable.
  const pool = [...filler(4),
    cand(9001, 500_000, { watched: true }), cand(9002, 900_000, { watched: true }),
    cand(9003, 700_000, { watched: true }), cand(9004, 900_000, { watched: true })];
  const out = watchReserved(pool, filler(4), 2);
  assert.deepEqual(ids(out), [9002, 9004], 'top two by expGpDay, ties broken by ascending id');
});

test('a watchlisted candidate that ranked IN is not fetched twice', () => {
  // MUTANT: build the reserve from `cand` without subtracting the admitted pool — red. A duplicate
  // survivor is a duplicate live fetch and a duplicate table row, not a visible crash.
  const pool = [...filler(9), cand(27652, 9_999_999, { watched: true })];
  const out = rankAndSlice('band', pool, {}, { top: 10 });
  assert.equal(out.filter(c => c.id === 27652).length, 1);
  assert.equal(out.length, 10, 'a ranked-in watchlist item must cost ZERO extra fetches');
  const { survivors } = pickFetchPool('band', pool, {}, { top: 10 });
  assert.equal(survivors.filter(c => c.id === 27652).length, 1);
});

test('a reserve of 0 is byte-identical to no reserve at all', () => {
  // MUTANT: treat a 0/absent bound as "unbounded" — red. This is the rollback escape hatch, and the
  // property that keeps the P1 replay goldens (whose fixtures carry no `watched`) valid.
  const pool = [...filler(10), cand(27652, 1, { watched: true })];
  assert.deepEqual(ids(rankAndSlice('band', pool, {}, { top: 10, watchReserve: 0 })),
    ids(rankAndSlice('band', pool.map(c => ({ ...c, watched: false })), {}, { top: 10 })));
  // A NEGATIVE bound must also mean "no reserve": `.slice(0, -1)` selects from the END and would
  // silently admit len-1 rows instead of none — the footgun admission.mjs's `safeSlot` documents.
  const three = Array.from({ length: 3 }, (_, i) => cand(5000 + i, 100 - i, { watched: true }));
  assert.deepEqual(watchReserved(three, [], -1), []);
});

test('an excluded watchlist item is named `watch-reserve-full`, not folded into the lane bucket', () => {
  // MUTANT: leave the exclusion reason mapping alone — red. The bound has to be VISIBLE when it
  // binds (SC1's never-a-silent-drop contract), otherwise the next reader repeats this whole audit.
  const many = Array.from({ length: WATCH_RESERVE_DEFAULT + 3 }, (_, i) => cand(4000 + i, 100 - i, { watched: true }));
  const { excluded } = pickFetchPool('band', [...filler(10), ...many], {}, ISOLATE);
  const cut = excluded.filter(c => c.watched);
  assert.equal(cut.length, 3, 'exactly the rows past the bound');
  for (const c of cut) assert.equal(c.reason, 'watch-reserve-full');
});

test('reserve-admitted rows are tagged `via:"watch"` and the originals stay unmarked', () => {
  // MUTANT: mutate the candidate in place instead of cloning — red. `cand` is reused across niches
  // in --mode all, so an in-place tag would leak a provenance claim onto another niche's row.
  const web = cand(27652, 1, { watched: true });
  const out = rankAndSlice('band', [...filler(10), web], {}, { top: 10 });
  assert.equal(out.find(c => c.id === 27652).via, 'watch');
  assert.equal(web.via, undefined, 'the source candidate object must not be mutated');
});

test('reaching the fetch pool is not admission to the table', () => {
  // Not a mutant guard — a SCOPE pin. The reserve buys a fetch slot and nothing else: `surviveMode`'s
  // falling doctrine and every post-fetch gate still run on the row exactly as on a ranked-in one.
  // If this ever needs changing, the change is a doctrine change, not a reserve change.
  const web = cand(27652, 1, { watched: true });
  const out = rankAndSlice('band', [...filler(10), web], {}, { top: 10 });
  const admitted = out.find(c => c.id === 27652);
  assert.equal(admitted.held, false);
  assert.equal('keep' in admitted, false, 'the reserve must not pre-decide any post-fetch verdict');
});
