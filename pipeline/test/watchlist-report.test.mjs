/**
 * watchlist-report.test.mjs — the shared watchlist row builder (SEP16b).
 *
 * WHY THIS EXISTS. `runWatchlist` used to own the watchlist's quote loop, its gate-reason Note and
 * its table shape inside `screen-flip-niches.mjs`. SEP16b moved that into
 * `lib/signal/watchlist-report.mjs` so `read-watchlist.mjs` could render the SAME rows without a
 * second quote loop. The acceptance test was a live byte-diff of the two tables; these cases pin the
 * parts of that guarantee a future edit could break silently — the column shape (a header added or
 * reordered on one side desynchronises the two surfaces), and the gate-reason vocabulary, which is
 * the whole point of a gate-exempt row.
 *
 * The thresholds are PARAMETERS here, not module constants — they are per-run CLI values in the
 * scan, so a case that passed them implicitly would not be testing the real call.
 *
 * EVERY "Kills:" claim below was confirmed by actually applying that mutation and watching the suite
 * go red. Two invariants are STILL UNPINNED and should not be assumed covered: swapping the band
 * thesis for churn (`estimateRank(FLIP_NICHES.band, row)`) and dropping the `row.mid` fallback in
 * watchlistNote both leave this suite green. Both need a realistic quote row rather than the null
 * series used here — with empty inputs the two theses agree and the mid fallback is never consulted.
 *
 * Run: `node pipeline/test/watchlist-report.test.mjs`. Auto-discovered by run-tests.mjs.
 * PURE/synthetic — nothing here touches the network or disk.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WATCHLIST_HEADERS, watchlistNote, roughExpGpDay, buildWatchlistReport } from '../lib/signal/watchlist-report.mjs';

const GATES = { floor: 3500, gpFloor: 4_500_000_000, minGpd: 250_000 };
const v24 = (hpv, lpv, hi = 20_000_000, lo = 19_000_000) => ({
  highPriceVolume: hpv, lowPriceVolume: lpv, avgHighPrice: hi, avgLowPrice: lo,
});

test('column shape is the scan section shape — the exact 10-column sequence', () => {
  // Kills: any column added, dropped, renamed or REORDERED on WATCHLIST_HEADERS. Pinning length +
  // the four edge positions did NOT kill reordering of the middle six, nor a slice that duplicated a
  // column while keeping the length. This assertion sees ONE side only — the scan-side binding is
  // pinned separately below.
  assert.deepEqual(WATCHLIST_HEADERS, [
    'Item', 'Grade', 'Guide', 'Quick', 'Optimistic', 'Vol/d', 'Momentum', 'Regime',
    'Rank net·P/ttf', 'Note',
  ]);
});

test('the scan binds its table headers to the SHARED constant, not a literal', () => {
  // Kills: replacing screen-flip-niches.mjs's `const HEADERS = RANK_TABLE_HEADERS` with a literal
  // array. That desync is invisible to every assertion above — those read the shared constant, so a
  // scan-side literal with two columns swapped mislabels the niche tables' price columns with the
  // whole suite green. Static source check because the binding, not the value, is the invariant.
  const src = readFileSync(new URL('../commands/screen-flip-niches.mjs', import.meta.url), 'utf8');
  assert.match(src, /const HEADERS = RANK_TABLE_HEADERS;/);
});

test('watchlistNote: a one-sided book is uncrossable, and outranks every other reason', () => {
  // Kills: reordering the checks so a one-sided book reports as merely "thin". Volume is huge here,
  // so only the ordering keeps this row honest.
  assert.match(watchlistNote({}, v24(500_000, 0), null, 1, 100, GATES), /one-sided book/);
  assert.match(watchlistNote({}, v24(0, 500_000), null, 1, 100, GATES), /one-sided book/);
  // The ordering case: a row that is BOTH falling and one-sided must report the BOOK. An uncrossable
  // book is a fact about whether the row can trade at all; "price to clear" is advice that presumes
  // it can. (A falling-only row and a one-sided-only row both pass under either order, so neither
  // alone tests this — verified by mutation: swapping the two checks leaves them green.)
  assert.match(watchlistNote({ falling: true }, v24(500_000, 0), null, 1, 100, GATES), /one-sided book/);
  // falling is still checked before any volume test
  assert.match(watchlistNote({ falling: true }, v24(500_000, 500_000), null, 1, 100, GATES), /falling/);
});

test('watchlistNote: thin splits on gp-flow, not on volume alone', () => {
  // Kills: collapsing the two thin messages into one. A low-COUNT big-ticket is sizeable in gp and
  // must read "size in units", not "few trades/day" — that distinction is the sizing advice.
  const bigTicket = watchlistNote({ mid: 20_000_000 }, v24(300, 300), null, 1, 8, GATES);
  assert.match(bigTicket, /thin \(~300\/day — size in units\)/);
  const dust = watchlistNote({ mid: 5 }, v24(300, 300, 6, 4), null, 1, 8, GATES);
  assert.match(dust, /thin\/illiquid/);
});

test('watchlistNote: a liquid row that clears every gate returns EMPTY, not a reason', () => {
  // Kills: a refactor that always produces a string. Empty means "would surface on merit" and the
  // render leans on that emptiness.
  assert.equal(watchlistNote({ mid: 20_000_000 }, v24(500_000, 500_000), null, 1, 8, GATES), '');
});

test('watchlistNote: the attention floor names the threshold it applied', () => {
  // Kills: hardcoding 250k in the message while the caller passes a different --min-gpd.
  const note = watchlistNote({ mid: 1000 }, v24(500_000, 500_000, 1001, 1000), null, 1, 1, { ...GATES, minGpd: 9_000_000 });
  assert.match(note, /below 9,000k\/day attention floor/);
});

test('roughExpGpDay prefers a band edge over the 24h spread, and never returns negative', () => {
  // Kills: dropping the band branch (the band edge is the realistic per-lap net) and returning a
  // negative gp/day on an inverted book, which would sort below a zero-volume row.
  const d = v24(1000, 1000, 20_000_000, 19_000_000);
  const withBand = roughExpGpDay(d, { 1: { bandLo: 19_500_000, bandHi: 20_000_000 } }, 1, 8);
  const noBand = roughExpGpDay(d, null, 1, 8);
  assert.notEqual(withBand, noBand);
  assert.ok(roughExpGpDay(v24(1000, 1000, 19_000_000, 20_000_000), null, 1, 8) === 0);
  assert.equal(roughExpGpDay(null, null, 1, 8), 0);
});

// --- the ROW LOOP. Everything above pins pure helpers; these enter buildWatchlistReport's loop,
// which an earlier version of this file never did — five mutations to load-bearing lines inside it
// (the fail-closed thin cap, the qcache truthiness test, the band thesis, the (thin) marker, the mid
// fallback) all left the suite green. Synthetic inputs only: null series are a shape computeQuote
// already handles, so no network and no fixtures.
const loopArgs = (over = {}) => ({
  entries: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }],
  map: { byId: { 1: { limit: 8 }, 2: { limit: 8 } } },
  v24: {}, bands: null, guide: {}, latest: {},
  concurrency: 2, ...GATES, volSrcLabel: 'rolling', posture: 'active',
  fetchSeries: async () => [null, null],
  ...over,
});

test('a FALSY cached quote is re-fetched — the qcache test is truthiness, not .has()', async () => {
  // Kills: `!qcache.get(id)` → `!qcache.has(id)`, which the module header explicitly warns against.
  // Id 2 is PRESENT in the cache with a null value; under .has() it would be skipped and then read
  // back as null in the loop, producing a row built from nothing.
  const called = [];
  await buildWatchlistReport(loopArgs({
    qcache: new Map([[2, null]]),
    fetchSeries: async id => { called.push(id); return [null, null]; },
  }));
  assert.deepEqual(called.sort(), [1, 2]);
});

test('an item missing from v24 is thin FAIL-CLOSED, and says so in the grade tooltip', async () => {
  // Kills: `const thin = d ? (limitVol < floor) : true` → `: false`. Unknown liquidity must not
  // headline — an item absent from v24 has an unverifiable book, and skipping THIN_GRADE_CAP is the
  // CAP ESCAPE the module comment describes.
  const { rows } = await buildWatchlistReport(loopArgs());
  assert.match(rows[0].cells[1].title, /thin: ~0\/day two-sided/);
});

test('every row carries the (thin) confidence marker under the no-extra call', async () => {
  // Kills: dropping the thinConfidence marker. It fires because estimateRank is called with no
  // `extra` → pFillN 0 — a code-path artifact reproduced deliberately (Decision 2 Option 1), and the
  // ONE visible signal that a reader should not trust the letter. Wiring `extra` is SEP16e.
  const { rows } = await buildWatchlistReport(loopArgs());
  for (const r of rows) assert.match(r.cells[1].t, /\(thin\)$/);
});

test('KNOWN DEFECT, pinned not fixed: absent v24 renders as a one-sided BOOK', async () => {
  // watchlistNote reads `d?.highPriceVolume || 0`, so `d === undefined` (item absent from v24) is
  // indistinguishable from a real one-sided book and reports an uncrossable ghost-spread — a market
  // fact asserted from missing data, and the opposite reading of the same `d` that the thin cap four
  // lines below takes. This is a MOVED defect (identical in the pre-SEP16b runWatchlist), so it is
  // pinned here rather than fixed: changing it changes the rendered Note and breaks the byte-match
  // that SEP16b rests on. If a later chunk fixes it, this case is the one that should go red.
  const { rows } = await buildWatchlistReport(loopArgs());
  assert.equal(rows[0].cells.at(-1).t, 'one-sided book — uncrossable (ghost-spread)');
});

test('buildWatchlistReport with no entries returns rows: [], never null', () => {
  // Kills: an early `return null` on empty. A caller must be able to tell "nothing watchlisted"
  // (rows: []) from "did not run" (no call), which is exactly the distinction SEP16c depends on.
  return buildWatchlistReport({
    entries: [], map: { byId: {} }, v24: {}, bands: null, guide: {}, latest: {},
    fetchSeries: async () => { throw new Error('must not fetch with no entries'); },
    ...GATES, volSrcLabel: 'rolling', posture: 'active',
  }).then(out => {
    assert.deepEqual(out.rows, []);
    assert.deepEqual(out.sugg, []);
    assert.deepEqual(out.headers, WATCHLIST_HEADERS);
  });
});
