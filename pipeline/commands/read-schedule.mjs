#!/usr/bin/env node
/**
 * read-schedule.mjs — the buy/sell WINDOW AGENDA (PLAN-SCHEDULE).
 *
 * A presentation/aggregation layer over EXISTING diurnal data — NOT a new market model. Every item
 * runs its own daily buy(dip)/sell(peak) clock; these are exactly the `hourProfile` dip/peak that
 * `read-window-range.mjs --profile` already prints. This command consolidates them into ONE
 * time-sorted agenda ("what to buy/sell, and when") across a chosen set of items, and a per-item
 * dip+peak row pair, sorted by the hours-until-next-window-start column (`In (h)`) ascending.
 *
 * Three MUTUALLY-EXCLUSIVE modes of one entrypoint (not combinable flags):
 *   -c / --current-position   the actionable set — open lots in positions.json ∪ open offers in
 *                             offers.json (money in a GE slot). THE DEFAULT when no flag is passed.
 *   -w / --watchlist          watchlist.json (flat array of item-NAME strings), name→id via loadMapping.
 *   --audit                   flipped-but-not-watchlisted review off positions.json `closed` (trade
 *                             count + realised P/L); NO market fetch, short-circuits before the agenda.
 * (-c and -w may be combined to UNION the two lists; each row is tagged C / W / C/W. --audit is alone.)
 *
 * Honesty (process rule 4): windows are `hourProfile` medians, n≈0, INFORM-ONLY — same class as the
 * diurnal notes. The schedule PLANS, it never gates. Pipeline-only: no APP_VERSION concern.
 *
 * Usage:
 *   node pipeline/commands/read-schedule.mjs            # -c (current positions ∪ offers) — the default
 *   node pipeline/commands/read-schedule.mjs -w         # the watchlist
 *   node pipeline/commands/read-schedule.mjs -c -w      # union of both, tagged
 *   node pipeline/commands/read-schedule.mjs --audit    # flipped-but-not-watchlisted review
 *
 * Structure: a PURE row-building layer (`hoursUntil`/`isInsideWindow`/`agendaRowsForItem`/`buildAudit`)
 * plus a thin IO layer (`buildAgenda` does the fetch, the CLI wrapper prints). Chunk 2's loop banner
 * imports `buildAgenda` + `loopHeaderLine` in-process — no subprocess.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping, fetchTs, fetchLatest } from '../lib/market/marketfetch.mjs';   // fetchLatest (2026-08-10): the live leg the dip-not-below-live guard needs — without it deriveDiurnalRange's reprice cannot fire
import { loadWatchlistNames } from '../lib/config/watchlist.mjs';
import { readOpenPositions } from '../lib/reconstruct/positions.mjs';
import { readOffersSnapshot } from '../lib/reconstruct/offers.mjs';
import { hourProfile, displayFitNights, WINDOW_RELIABLE_R, deriveDiurnalRange, realityClause } from '../../js/windowread.mjs';   // deriveDiurnalRange = the ONE home for the Ghrazi level guard; this file used to bypass it and shipped raw hourProfile levels. realityClause = the ONE renderer for the spike-top/stale flag (Chunk 2b) — do not re-implement the wording here
import { fmt, fmtP, fmtHour, fmtHourRange, localTzAbbrev } from '../../js/money-format.js';   // fmtP for the Level column: it is a PRICE to place an offer at, and fmt()'s 1-decimal k-range collapsed 1,051 and 1,109 onto the same "1.1k" (Ben, 2026-08-05). fmtP keeps full gp under 100k and stays compact above it — the same convention the scan's Est. buy/sell price cells use.

// levelFlagged (Chunk 2b) — TRUE exactly when this row's Level cell renders a `*`, so the cell and the
// legend are the same predicate by construction. Two suppressions, and they are NOT symmetric:
//   !r.repriced   — on a repriced dip the printed number is the live instasell, NOT profile.dip.level,
//                   so `reality` describes a different price (js/windowread.mjs `deriveDiurnalRange`'s `bid >= liveLo` reprice branch). Tagging it
//                   would label one price with another's conditions — the defect this guard prevents.
//   !r.degenerate — `⚠` already says the pair does not make money as printed, which moots the level.
// `unguarded` (`?`) is deliberately NOT suppressed. It reports a MISSING INPUT ("no live price this
// pass, so the dip guard could not run"); a spike-bottom bid level is a known fact about the level
// itself. Those are orthogonal, so ranking them would show the reader only the weaker one — hence the
// `?*` combined mark below rather than a precedence chain. (An earlier cut did rank them; review
// caught that it silently dropped the stronger signal on exactly the rows least verified.)
const levelFlagged = r => !!(r.reality && !r.repriced && !r.degenerate
  && (r.reality.spikeTop || r.reality.staleOptimistic));
import { loadReverseFlip, pruneReverseFlip } from '../lib/thesis/reverseflipstate.mjs';   // RF0 store — RF4 surfaces the in-flight cycle into the agenda
import { reverseFlipCycleNotes } from '../../js/reverseflip.mjs';   // RF4/RF6 shared inform-only cycle notes (thin strand + drift + REBUY_STALE_DAYS nudge)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const FETCH_CONCURRENCY = 5;   // copy screen-flip-niches.mjs's constant — keep modest (wiki API ≤15 concurrent)
// DELIBERATELY ITS OWN LITERAL, *not* WINDOW_RELIABLE_NIGHTS (pinned to the gate constant for one commit
// on 2026-08-10; reverted after review). This value is the display window for rows that did NOT pass the
// gate — i.e. ~99% of them, the population displayFitNights' own header says must not be moved by a gate
// change ("that would move the levels of the other ~99%, which no measurement here covers"). A PASSING
// row already refits to the gate's window via displayFitNights below, which is what closes the gap; the
// non-passers need no pin because their hours are marked `~` and assert nothing.
const PROFILE_NIGHTS = 14;     // the agenda's own display window (same default read-window-range --profile uses)

// ── PURE `In (h)` math (fixture-tested in read-schedule.test.mjs) ─────────────────────────────────
// hoursUntil(startH, now) — hours from `now` to the NEXT occurrence of local hour-of-day `startH`,
// rounded to the nearest 0.5h. `now` is a Date (or any {getHours,getMinutes}); startH is a LOCAL
// hour integer 0-23 (hourProfile's dip/peak startH, already local). The `+24 then %24` wraps a
// start that already passed today onto tomorrow uniformly — no midnight special-case branch.
export function hoursUntil(startH, now = new Date()) {
  const nowFrac = now.getHours() + now.getMinutes() / 60;
  const deltaH = ((startH - nowFrac) % 24 + 24) % 24;      // 0 ≤ deltaH < 24, wraps past midnight
  return Math.round(deltaH * 2) / 2;                        // round-half-up to nearest 0.5h
}

// isInsideWindow(startH, endH, nowH) — is the current local hour inside the [startH, endH) window?
// Non-wrapping (startH ≤ endH): startH ≤ nowH < endH. Midnight-spanning (startH > endH, e.g. 22→3):
// nowH ≥ startH OR nowH < endH. A degenerate full-day cluster (startH === endH, spanOf's {0,0}) is
// treated as always-inside. `endH` is spanOf's already-wrapped value, read off the same cluster shape
// every other windowread consumer reads — no new span representation.
export function isInsideWindow(startH, endH, nowH) {
  if (startH === endH) return true;                         // full-day cluster (spanOf {0,0})
  if (startH < endH) return nowH >= startH && nowH < endH;  // non-wrapping window
  return nowH >= startH || nowH < endH;                     // midnight-spanning window
}

// windowInH(startH, endH, now) — the agenda's `In (h)` cell for one window: 0.0 when currently INSIDE
// (never negative), else hoursUntil to the next start. Inside-check first — hoursUntil of an in-window
// start returns ~24 (the start already passed today), so the clamp must precede it.
function windowInH(startH, endH, now) {
  return isInsideWindow(startH, endH, now.getHours()) ? 0 : hoursUntil(startH, now);
}

// ── PURE row building ────────────────────────────────────────────────────────────────────────────
// agendaRowsForItem({ name, tags, profile, now }) — up to 4 rows for one item off its hourProfile:
// the BUY(dip) + SELL(peak) windows, EACH up to 2 (primary + a prominence-ranked SECONDARY). A null
// profile (too thin, <4 traded days) yields ZERO rows. PLAN-MULTI-PEAK-WINDOWS: hourProfile now returns
// additive prominence-ranked `dips[]`/`peaks[]` arrays (length 1–2); `dips[0]`/`peaks[0]` are byte-
// identical to the singular `dip`/`peak`, and index-1 (present only when a second local extremum clears
// the prominence bar) is the secondary. We iterate those arrays and mark the secondary (index-1) row's
// Action `·2`, leaving the primary row's appearance UNCHANGED. Falls back to the singular dip/peak when
// the arrays aren't present (older profile shape / a hand-built fixture), so a length-1 case never
// manufactures a row.
// DT4 (2026-08-10): `reliable` is windowReliability's tri-state for this item. The agenda KEEPS every
// row — an item still has a plan even when its clock doesn't repeat — but a row whose hours failed (or
// could not be) verified is MARKED, because this table's whole content is times and an unmarked one
// reads as a commitment.
// ⚠ The rest of this note used to read "The row's Level is unaffected: levels were never what the gate
// measured." True of the GATE, but it was doing work it had not earned: read as reassurance that the
// Level was the dependable half of a marked row, when the Level was in fact the UNGUARDED half (see
// the level-guard block below). Both halves now carry their own honest marking; neither vouches for
// the other.
export function agendaRowsForItem({ name, tags = [], profile, now = new Date(), reliable = null, live = null }) {
  if (!profile) return [];
  const rows = [];
  const liveLo = live ? (live.lo ?? null) : null;
  const liveHi = live ? (live.hi ?? null) : null;
  // LEVEL-GUARD fix (2026-08-10). This used to be `level: w.level ?? null` — the raw hourProfile
  // number, the ONLY consumer in the repo that did not route through deriveDiurnalRange. That
  // function's header calls itself "the ONE home for the Ghrazi lesson", and skipping it meant this
  // table shipped an unguarded price under a column the /schedule skill defines as "a price to place
  // an offer at". Live failure (Bastion potion(4), 2026-08-10): BUY dip 15,191 printed ABOVE both
  // SELL peak rows (15,027 / 15,005), with live instasell at 14,723 — a buy-high/sell-low plan.
  //
  // MECHANISM (measured, not assumed): the dip HOUR is chosen by de-trended `devLow` while the LEVEL
  // printed is that hour's ABSOLUTE price. Those are different axes and can point opposite ways —
  // Bastion's hour 12 held the MINIMUM devLow and simultaneously the MAXIMUM absolute low of all 24
  // hours. Over 600 archive items: 7.3% render dip level > peak level, and 86% have a dip hour that
  // is not the cheapest hour by level. So this is not a tail case.
  //
  // The fix reuses deriveDiurnalRange rather than re-implementing its guard here (a second home for
  // the Ghrazi rule is how this drifted in the first place). Each window is scored through it against
  // the primary of the opposite side, so the SECONDARY (·2) rows are guarded identically — the
  // obvious partial fix, guarding only `profile.dip`/`profile.peak`, would have left ·2 unguarded and
  // recreated the same split one level down.
  const guard = (dipW, peakW) => deriveDiurnalRange(
    { dip: dipW, peak: peakW, trendDominates: profile.trendDominates,
      amplitude: profile.amplitude, amplitudePct: profile.amplitudePct },
    { liveLo, liveHi });
  const primaryDip = (Array.isArray(profile.dips) && profile.dips[0]) || profile.dip || null;
  const primaryPeak = (Array.isArray(profile.peaks) && profile.peaks[0]) || profile.peak || null;
  const mk = (side, w, idx) => {
    if (!w || w.startH == null || w.endH == null) return;
    const base = side === 'dip' ? 'BUY dip' : 'SELL peak';
    const dr = side === 'dip' ? guard(w, primaryPeak) : guard(primaryDip, w);
    // `level` is now the GUARDED number. On the dip side deriveDiurnalRange repricess to live when the
    // dip is not below it; the peak side passes through (there is no ask-side reprice) but still earns
    // the degenerate flag when the pair inverts.
    const level = dr ? (side === 'dip' ? dr.bid : dr.ask) : (w.level ?? null);
    const degenerate = !!(dr && dr.notes.some(n => n.startsWith('degenerate')));
    rows.push({
      inH: windowInH(w.startH, w.endH, now),
      startH: w.startH, endH: w.endH,
      item: name,
      action: idx >= 1 ? `${base}·2` : base,   // ·2 = the secondary (prominence-ranked) window
      secondary: idx >= 1,
      level,
      rawLevel: w.level ?? null,               // what this column printed before the guard — kept so a
                                               // reader (and the test) can see when the guard bit
      repriced: !!(dr && side === 'dip' && dr.bidBasis === 'live'),
      degenerate,
      // Chunk 2b (2026-08-12) — the level-reality read (spike-top / stale) that PLAN-DIURNAL-RECENCY-GUARD
      // Chunk 1 attaches to every cluster window. Chunk 2 rendered it on three surfaces and this one was
      // not among them, so /schedule — the surface whose Level column d37e818 defines as "a price you
      // place an offer at" — printed a spike-top level with nothing attached.
      reality: w.reality ?? null,
      unguarded: liveLo == null,               // no live this pass ⇒ the dip guard could not run
      reliable,
      tags: [...tags],
    });
  };
  const dips = (Array.isArray(profile.dips) && profile.dips.length) ? profile.dips : (profile.dip ? [profile.dip] : []);
  const peaks = (Array.isArray(profile.peaks) && profile.peaks.length) ? profile.peaks : (profile.peak ? [profile.peak] : []);
  dips.slice(0, 2).forEach((w, i) => mk('dip', w, i));
  peaks.slice(0, 2).forEach((w, i) => mk('peak', w, i));
  return rows;
}

// sortRows(rows) — soonest window first (In (h) ascending), stable for ties. RF rows with a null inH
// (no in-hand profile → no window) sort to the END (treated as +∞), never displacing a real window.
export function sortRows(rows) {
  const key = r => (r.inH == null ? Number.POSITIVE_INFINITY : r.inH);
  return rows.map((r, i) => [r, i]).sort((a, b) => (key(a[0]) - key(b[0])) || (a[1] - b[1])).map(x => x[0]);
}

// ── RF4: reverse-flip cycle rows (PLAN-REVERSE-FLIP) ─────────────────────────────────────────────
// reverseFlipRows(state, { profileByItem, now }) — PURE row-builder PARALLEL to
// agendaRowsForItem, unioned into the agenda so an in-flight DECLARED reverse-flip cycle (which owns no
// FIFO lot + no GE slot between its legs) stays on the schedule. Tagged 'RF' + an `rf:true` flag so it's
// visually distinct from a normal position/watchlist row, and its Action names the cycle leg:
//   holding        → 'SELL peak (RF)'  windowed on the item's PEAK  (sell an owned keep into the peak)
//   awaiting-rebuy → 'REBUY dip (RF)'  windowed on the item's DIP   (rebuy the sold keep at the dip)
//   rebuy-armed    → 'REBUY armed (RF)' windowed on the item's DIP  (a rebuy bid is already resting)
// The window comes from the ALREADY-FETCHED hourProfile for that id (profileByItem) — no new fetch; an id
// with no in-hand profile yields inH=null (renders '—', sorts last). Each row carries the shared inform-only
// notes (thin rebuy-strand + the REBUY_STALE_DAYS nudge). An EMPTY / all-holding-with-no-profile store
// yields ZERO rows → byte-identical agenda (the zero-ripple guard).
// DT3 (2026-08-09): the `driftByItem` param is gone with the hourlyDrift slope note it carried — this
// surface never had an ask level, so the surviving askReachDecay read has nothing to score here.
// DT4 (2026-08-10, corrected after review): `reliableByItem` carries windowReliability's tri-state per
// id. An id ABSENT from the map means the gate was never RUN on it (this surface only fetches series for
// selected ids), which is a THIRD case — the row is still marked unverified, but it must not be counted
// into the legend's "could not be measured (needs ~14 days)" tally, because that states a reason we did
// not establish. The first version omitted this map entirely, so every reverse-flip row was assigned that
// false reason — the exact null-vs-false conflation the tri-state exists to prevent.
export function reverseFlipRows(state, { profileByItem = {}, reliableByItem = {}, now = new Date() } = {}) {
  const rows = [];
  const nowMs = (now instanceof Date) ? now.getTime() : (typeof now === 'number' ? now : Date.now());
  // windowInH needs a Date-like with getHours/getMinutes; a numeric `now` (a test/injected ms) → a Date.
  const nowClock = (now && typeof now.getHours === 'function') ? now : new Date(nowMs);
  for (const e of state || []) {
    if (!e || e.id == null || !e.state) continue;
    const sell = e.state === 'holding';
    const prof = profileByItem[e.id] || null;
    const w = prof ? (sell ? (prof.peak || (prof.peaks && prof.peaks[0])) : (prof.dip || (prof.dips && prof.dips[0]))) : null;
    const action = sell ? 'SELL peak (RF)' : (e.state === 'rebuy-armed' ? 'REBUY armed (RF)' : 'REBUY dip (RF)');
    const level = sell ? (e.soldEach ?? null) : (e.rebuyBidPrice ?? e.beRebuy ?? null);
    // `prof.row` is an OPTIONAL caller-supplied quote row (guide/volDay) that enables the thin big-ticket
    // liquidity caution. This function is pure and generic, so it stays — but see buildAgenda below: the
    // PRODUCTION profileByItem is built from `hourProfile`, which has NO `row` key, so on the real
    // `/schedule` surface this is always null and the caution NEVER fires.
    const notes = reverseFlipCycleNotes(e, { row: (prof && prof.row) || null, now: nowMs, fmt });
    rows.push({
      inH: (w && w.startH != null && w.endH != null) ? windowInH(w.startH, w.endH, nowClock) : null,
      startH: w ? w.startH : null,
      endH: w ? w.endH : null,
      item: e.name || ('#' + e.id),
      action,
      secondary: false,
      level,
      tags: ['RF'],
      reliable: Object.prototype.hasOwnProperty.call(reliableByItem, e.id) ? reliableByItem[e.id] : undefined,
      rf: true,
      cycleState: e.state,
      notes,
    });
  }
  return rows;
}

// buildAudit({ closed, watchNames, mapping }) — group positions.json `closed` by itemId (count +
// summed realised), resolve each id's NAME, and surface only ids whose name is NOT in watchlist.json.
// The join is NAME-keyed (watchlist has no ids). Sorted by trade count desc (strongest signal first).
export function buildAudit({ closed, watchNames, mapping }) {
  const byItem = new Map();
  for (const c of closed || []) {
    if (c == null || c.itemId == null) continue;
    const g = byItem.get(c.itemId) || { itemId: c.itemId, trades: 0, realised: 0 };
    g.trades += 1;
    g.realised += Number(c.realised) || 0;
    byItem.set(c.itemId, g);
  }
  const watchSet = new Set((watchNames || []).map(n => String(n).toLowerCase()));
  const rows = [];
  for (const g of byItem.values()) {
    const name = (mapping && mapping.byId && mapping.byId[g.itemId] && mapping.byId[g.itemId].name) || ('#' + g.itemId);
    if (watchSet.has(String(name).toLowerCase())) continue;   // already watchlisted → skip
    rows.push({ itemId: g.itemId, item: name, trades: g.trades, realised: g.realised });
  }
  rows.sort((a, b) => (b.trades - a.trades) || (b.realised - a.realised));
  return rows;
}

// resolveWatchlist(names, mapping) — name→id via mapping.resolve; an unresolvable name (typo, delisted)
// is SKIPPED with a warning, never an abort (the degrade-gracefully convention). PURE given a mapping.
export function resolveWatchlist(names, mapping) {
  const items = [], warnings = [];
  for (const nm of names || []) {
    const r = mapping.resolve(nm);
    if (!r) { warnings.push(`watchlist item "${nm}" did not resolve to an id — skipped`); continue; }
    items.push({ id: r.id, name: r.name });
  }
  return { items, warnings };
}

// loopHeaderLine(rows) — the run-loop banner: the single soonest window across all rows (already
// sorted asc, so rows[0]). null when there's nothing to schedule. Local-zone label to stay a one-liner.
export function loopHeaderLine(rows) {
  if (!rows || !rows.length) return null;
  const r = rows[0];
  const win = `${fmtHour(r.startH)}–${fmtHour(r.endH)} ${localTzAbbrev()}`;
  const when = r.inH <= 0 ? 'now' : `~${r.inH}h`;
  return `⏭ next: ${r.item} ${r.action} ${win} (${when})`;
}

// ── IO helpers (degrade-gracefully, never throw a caller) ────────────────────────────────────────
function readClosed(repoRoot) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(repoRoot, 'positions.json'), 'utf8'));
    return Array.isArray(p.closed) ? p.closed : [];
  } catch { return []; }
}
// currentIds(repoRoot) — the -c id set: open lots (positions.json) ∪ open offers (offers.json).
function currentIds(repoRoot) {
  const rp = readOpenPositions(path.join(repoRoot, 'positions.json'));
  const groups = (rp && rp.groups) ? rp.groups : [];        // {err} on a bad file → no groups
  const offers = readOffersSnapshot(path.join(repoRoot, 'offers.json'));   // [] on a bad file
  return new Set([...groups.map(g => g.itemId), ...offers.map(o => o.itemId)]);
}

// ── the fetch-backed agenda builder (imported in-process by run-loop.mjs) ─────────────────────────
// buildAgenda({ scope, now, repoRoot }) -> { rows, warnings, itemCount }
//   scope: array subset of ['c','w'] (default ['c']). rows are the sorted agenda; warnings are the
//   per-name resolve failures (skip-not-abort). Fetches ts1h + hourProfile per selected id, pooled at
//   FETCH_CONCURRENCY. NOT cached: `fetchTs` routes through `cachedJget`, a passthrough unless
//   COFFER_FETCH_CACHE=1 (nothing sets it), so each id costs a real /timeseries fetch per run.
export async function buildAgenda({ scope = ['c'], now = new Date(), repoRoot = REPO } = {}) {
  const mapping = await loadMapping();
  const selected = new Map();   // id -> { name, tags:Set<'C'|'W'> }
  const warnings = [];
  const add = (id, name, tag) => {
    const e = selected.get(id) || { name, tags: new Set() };
    e.tags.add(tag);
    selected.set(id, e);
  };
  if (scope.includes('c')) {
    for (const id of currentIds(repoRoot)) {
      const name = (mapping.byId[id] && mapping.byId[id].name) || ('#' + id);
      add(id, name, 'C');
    }
  }
  if (scope.includes('w')) {
    const { items, warnings: w2 } = resolveWatchlist(loadWatchlistNames(repoRoot), mapping);
    for (const it of items) add(it.id, it.name, 'W');
    warnings.push(...w2);
  }
  const ids = [...selected.keys()];
  const profiles = new Map();
  // (The RF4 `series` map is GONE — it existed so a reverse-flip drift note could reuse the fetched 1h
  //  series, DT3 deleted that note 2026-08-09, and its only remaining readers were the two duplicate
  //  windowReliability calls now folded into the single displayFitNights call below. Write-only = dead.)
  const live = new Map();     // LEVEL-GUARD fix (2026-08-10): the live instasell/instabuy per item.
  const reliable = new Map(); // DT4b: windowReliability's tri-state, computed once with the fit window.
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      // DT4b routing (2026-08-10): the displayed window is fitted over displayFitNights' window, not a
      // local constant — so a row that PASSES the gate is fitted over the same days the gate judged.
      // Byte-identical today (PROFILE_NIGHTS happens to equal the gate window, so both branches pick 14); the
      // point is that it stays correct if the gate window ever moves. windowReliability runs ONCE here
      // and its verdict is reused below — it used to be recomputed per row from the retained series.
      try {
        const ts = await fetchTs(id, '1h');
        const { reliability, fitNights } = displayFitNights(ts, { nights: PROFILE_NIGHTS });
        reliable.set(id, reliability.reliable);
        profiles.set(id, hourProfile(ts, { nights: fitNights }));
      }
      catch { profiles.set(id, null); }
      // The live leg is fetched SEPARATELY and failure-isolated: without it `deriveDiurnalRange`'s
      // dip-not-below-live guard structurally cannot fire, which is the whole bug being fixed. A
      // failed /latest degrades that item to the OLD (unguarded) behavior rather than dropping the
      // row — but the row is then marked, because an unguarded level is exactly what misled before.
      try { const lat = await fetchLatest(id); if (lat) live.set(id, { lo: lat.low ?? null, hi: lat.high ?? null }); }
      catch { /* no live → guard cannot run → row marked below */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, ids.length) || 1 }, worker));
  const rows = [];
  for (const [id, e] of selected) {
    const tags = [...e.tags].sort();   // 'C' before 'W'
    rows.push(...agendaRowsForItem({ name: e.name, tags, profile: profiles.get(id), now,
      reliable: reliable.has(id) ? reliable.get(id) : null,
      live: live.get(id) || null }));
  }
  // RF4: union the in-flight reverse-flip cycles into the agenda. Guarded on a NON-EMPTY store so the
  // common (empty) case adds zero rows AND zero compute → the agenda is byte-identical to pre-RF4. Windows
  // + drift reuse ONLY already-fetched series (a rebuy-armed cycle is an open offer → in currentIds → already
  // fetched; an awaiting-rebuy cycle with no bid isn't fetched → no window/drift, store-only fields).
  const rfState = pruneReverseFlip(loadReverseFlip(path.join(repoRoot, 'reverse-flip-state.json')));
  if (rfState.length) {
    // DT3 (2026-08-09): the per-item drift note built here is GONE with the hourlyDrift slope it rendered.
    // Its replacement (askReachDecay) needs an ASK level to score reach against, and this call site never
    // had one — it passed no `ask` at all — so there is nothing here for the surviving read to say. The
    // `driftNote` slot on reverseFlipCycleNotes stays (a generic pre-rendered note slot); it is simply
    // unfed. See hourly-lmh.mjs's tombstone for why the slope went.
    // KNOWN GAP (recorded 2026-08-09): these profiles come from `hourProfile`, whose return has NO `row`
    // key. `reverseFlipRows` reads `prof.row` to enable the thin big-ticket LIQUIDITY CAUTION, so on this
    // surface that caution can never fire — `isThinBigTicket(null)` short-circuits false at its first line.
    // It went unnoticed because the acceptance test hands `reverseFlipRows` a SYNTHETIC profile carrying a
    // `row`, so the library capability is genuinely covered while the production path is dead: a fixture
    // that pins a shape nothing produces. Supplying it would need a per-item quote fetch (guide + volDay),
    // which this deliberately-cheap banner does not do — so the docs now say the caution is NOT emitted
    // here rather than the code pretending. Don't "fix" the null without adding that fetch.
    const profileByItem = {};
    for (const e of rfState) {
      if (!e || e.id == null) continue;
      const prof = profiles.get(e.id) || null;
      if (prof) profileByItem[e.id] = prof;
    }
    const rfReliable = {};
    // Reuses the SAME verdict computed with the fit window above (was a second windowReliability call
    // over the retained series — two call sites, one of which could drift from the displayed fit).
    for (const e of rfState) { if (e && e.id != null && reliable.has(e.id)) rfReliable[e.id] = reliable.get(e.id); }
    rows.push(...reverseFlipRows(rfState, { profileByItem, reliableByItem: rfReliable, now }));
  }
  return { rows: sortRows(rows), warnings, itemCount: ids.length, reverseFlipCount: rfState.length };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const AUDIT = argv.includes('--audit');
  const wantC = argv.includes('-c') || argv.includes('--current-position');
  const wantW = argv.includes('-w') || argv.includes('--watchlist');

  if (AUDIT) {
    const mapping = await loadMapping();
    const rows = buildAudit({ closed: readClosed(REPO), watchNames: loadWatchlistNames(REPO), mapping });
    console.log('# Watchlist audit — flipped but NOT in watchlist.json (proposed additions; review, never auto-added)\n');
    if (!rows.length) { console.log('(nothing to propose — every flipped item is already watchlisted)'); return; }
    console.log('| Item | Trades | Realised P/L |');
    console.log('| --- | ---: | ---: |');
    for (const r of rows) console.log(`| ${r.item} | ${r.trades} | ${fmt(r.realised)} |`);
    console.log(`\n${rows.length} unwatchlisted item(s) with logged flips.`);
    return;
  }

  const scope = [];
  if (wantC) scope.push('c');
  if (wantW) scope.push('w');
  if (!scope.length) scope.push('c');   // default = -c

  const { rows, warnings, itemCount } = await buildAgenda({ scope, now: new Date(), repoRoot: REPO });
  for (const w of warnings) console.log(`⚠ ${w}`);
  const scopeLabel = scope.map(s => s === 'c' ? 'current positions' : 'watchlist').join(' ∪ ');
  console.log(`# Window agenda — ${scopeLabel} (${itemCount} item${itemCount === 1 ? '' : 's'}; hourProfile medians, INFORM-ONLY n≈0)\n`);
  if (!rows.length) {
    console.log('(nothing to schedule — no items with a profileable dip/peak clock in this scope)');
    return;
  }
  console.log('| In (h) | Window | Item | Action | Level | List |');
  console.log('| ---: | --- | --- | --- | ---: | --- |');
  for (const r of rows) {
    const inTxt = r.inH == null ? '—' : (r.inH === 0 ? 'now' : r.inH.toFixed(1));
    // DT4: '~' = these hours did not clear the split-half reliability gate (or could not be measured).
    // The window still prints — Ben's option B keeps the plan visible — but it is not asserted as a clock.
    const winTxt = (r.startH == null || r.endH == null) ? '—'
      : (r.reliable === true ? fmtHourRange(r.startH, r.endH) : '~' + fmtHourRange(r.startH, r.endH));
    // LEVEL-GUARD fix: the Level cell carries its OWN marking now, independent of the window's `~`.
    //   ↧ = the dip was NOT below live, so deriveDiurnalRange repriced it to the live instasell (the
    //       Ghrazi guard firing — the old code printed the un-repriced number as a bid price).
    //   ⚠ = this pair is degenerate (peak level not above dip level): the plan as printed does not make
    //       money, and that must be visible in the table, not inferable by comparing two rows by eye.
    //   ? = no live price this pass, so the dip guard could not run — the level is the old unguarded one.
    //   * = the level-reality read flagged it (spike-top / stale) — the legend names each one WITH its
    //       typical level, because the whole point is that the number travels with its condition; a
    //       bare mark in a cell would just relocate the problem. SKIPPED when the dip was repriced to
    //       live (`↧`), since `reality` describes profile.dip.level and the printed level is no longer
    //       that number (js/windowread.mjs `deriveDiurnalRange`'s `bid >= liveLo` reprice branch) — tagging it would mislabel one price with
    //       another's conditions, the exact defect this guard prevents.
    const unver = r.unguarded && r.action.startsWith('BUY');
    const lvlMark = r.degenerate ? ' ⚠' : r.repriced ? ' ↧'
      : (unver && levelFlagged(r)) ? ' ?*'          // BOTH apply: unverified input AND a flagged level
      : unver ? ' ?' : levelFlagged(r) ? ' *' : '';
    // `levelFlagged` encodes the WHOLE precedence chain above, not just the reality flag, so the cell
    // and the legend can never disagree. An earlier cut tested only `reality && !repriced`, which let a
    // degenerate-and-flagged row render `⚠` in the cell while still being named under `* N level(s)
    // flagged…` — a legend announcing a mark that appears nowhere in the table. A ⚠/↧/? row already
    // carries a louder, more specific warning; losing the `*` on it costs nothing.
    console.log(`| ${inTxt} | ${winTxt} | ${r.item} | ${r.action} | ${fmtP(r.level)}${lvlMark} | ${r.tags.join('/')} |`);
  }
  // LEVEL-GUARD legend — same discipline as the DT4 one: printed only when a mark actually appears.
  if (rows.some(r => r.degenerate || r.repriced || (r.unguarded && r.action.startsWith('BUY')) || levelFlagged(r))) {
    const deg = rows.filter(r => r.degenerate).length;
    const rep = rows.filter(r => r.repriced).length;
    const ung = rows.filter(r => r.unguarded && r.action.startsWith('BUY')).length;
    const flagged = rows.filter(levelFlagged);
    const bits = [];
    if (rep) bits.push(`↧ ${rep} dip level(s) repriced to the live instasell (the dip was not below live — a resting bid at the raw dip would not fill)`);
    if (deg) bits.push(`⚠ ${deg} row(s) DEGENERATE: the peak level is not above the dip level, so this pair does not make money as printed — do not read it as a plan`);
    if (ung) bits.push(`? ${ung} buy row(s) had no live price this pass, so the dip guard could not run — treat the level as unverified`);
    // Each flagged level is named WITH its typical, so the condition travels with the number rather
    // than being a mark the reader has to go look up (Chunk 2b).
    if (flagged.length) bits.push(`* ${flagged.length} level(s) flagged by the reality read — quote the typical, not the level: ${flagged.map(r => `${r.item} ${r.action} ${fmtP(r.level)} ${realityClause(r.reality, { side: r.action.startsWith('BUY') ? 'bid' : 'ask', fmt: fmtP, style: 'short' })}`).join(' · ')}`);
    console.log(`\n${bits.join('\n')}`);
  }
  // DT4 legend — printed only when at least one row is marked, so a fully-reliable agenda is unchanged.
  if (rows.some(r => r.startH != null && r.reliable !== true)) {
    const unver = rows.filter(r => r.reliable === null && r.startH != null).length;   // STRICT: `undefined` = gate never run on this row, which is not the same as measured-unmeasurable
    console.log(`
~ = the item's dip/peak hours did not clear the split-half reliability gate (r ≥ ${WINDOW_RELIABLE_R}), or the gate was not run on that row — the TIME is not a commitment, and the In (h) countdown for a marked row inherits that uncertainty (it is computed FROM the marked window). The LEVEL is judged separately (see any ↧/⚠/? marks on the Level column); this legend used to say "the LEVEL still stands", which read as a guarantee it was not making.${unver ? ` ${unver} row(s) were measured and could not be judged (needs ~14 days of history).` : ''}`);
  }
  // RF4: reverse-flip cycle notes (inform-only, n≈0) — printed ONLY for RF rows that surfaced a note. On an
  // empty store there are no RF rows → this block is skipped → byte-identical to the pre-RF4 agenda.
  const rfNoted = rows.filter(r => r.rf && r.notes && r.notes.length);
  if (rfNoted.length) {
    console.log('\nReverse-flip cycles (declared in-flight; inform-only, n≈0 — SELL a keep into the peak, REBUY at the dip):');
    for (const r of rfNoted) console.log(`- ${r.item} [${r.cycleState}]: ${r.notes.join(' · ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
}
