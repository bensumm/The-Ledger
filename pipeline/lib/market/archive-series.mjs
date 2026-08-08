/**
 * archive-series.mjs — read per-item series out of the LOCAL market archive in the exact shape the
 * estimators already consume, so a gate can run without paying a per-item `/timeseries` call.
 * (AF4, PLAN-ARCHIVE-FIRST-FUNNEL.)
 *
 * WHY THIS EXISTS. The scan spends API to DECIDE: it fetches ~93 of ~147 gated band candidates purely
 * to run the Stage-2 gates on them, and that budget is the only reason the fetch reserves
 * (THIN/GEAR/MID_TIER/…) and their crowding-out exist at all. But the Stage-2 gates are 14-day HISTORY
 * reads, and `pipeline/.market-archive.sqlite` already holds ~4,489 items × ~70 days at 1h and ~4,438 ×
 * ~30 days at 5m, refreshed for free by the zero-git `cache-warm` daemon off the BULK endpoints. The
 * marginal API cost of gating one more candidate from here is zero.
 *
 * THE TRAP THIS MODULE EXISTS TO CLOSE. `archive.seriesFor()` returns rows keyed `ts`; every consumer
 * — `windowread.mjs` (259/880/1173/1512/1569), `quotecore.js:246`'s
 * `points.filter(p => p && p.timestamp != null …)`, `diurnalRead` — keys on `timestamp`. Fed raw, the
 * archive rows are SILENTLY DISCARDED by every filter: windowStats returns empty, the gates
 * degrade-to-pass, and nothing throws. That is the whole reason this is a named adapter with a fixture
 * rather than an inline `.map()` at each call site.
 *
 * NOT A FETCH REPLACEMENT FOR PRICES. Gating is a history read and tolerates the archive's lag (1h is
 * up to ~1 daemon tick old, 5m ~a few minutes). PRICING is not: a quoted bid/ask must come from the
 * live book. Nothing here may reach a quoted price — see PLAN-ARCHIVE-FIRST-FUNNEL risk #3.
 */

/* Grains physically stored by the archive. `6h` is NOT among them — see aggregate1hTo6h. */
export const STORED_GRAINS = new Set(['1h', '5m']);

/* archiveSeries(handle, id, grain, { days, from, to }) → [{ timestamp, avgHighPrice, avgLowPrice,
   highPriceVolume, lowPriceVolume }] ascending — the EXACT `fetchTs(id, step)` row shape (verified
   against a live 1h fetch: same five keys, same value columns; only the time key differed).
   `handle` is an OPEN archive handle (`open(path, { readonly: true })`); this module never opens one
   itself, so a caller can never accidentally run schema DDL against the live multi-GB DB.
   Returns [] for an unstored grain or an unknown item — callers MUST treat [] as "no archive data,
   fall back to a live fetch", never as "no trades". */
// @provisional-api: AF4's archive read adapter; first consumer is AF5 (route trajectory/floor through
// it, shadow-logged) per PLAN-ARCHIVE-FIRST-FUNNEL. Built ahead of its caller deliberately so the
// ts→timestamp contract is fixture-pinned BEFORE anything depends on it.
export function archiveSeries(handle, id, grain, { days = null, from = null, to = null, now = null } = {}) {
  if (!handle || !STORED_GRAINS.has(String(grain))) return [];
  const nowS = now != null ? now : Math.floor(Date.now() / 1000);
  const hi = to != null ? to : nowS;
  const lo = from != null ? from : (days != null ? hi - days * 86400 : -Infinity);
  const rows = handle.seriesFor(id, grain, { from: lo, to: hi });
  // The rename IS the adapter. Build new objects rather than mutating the sqlite rows.
  return rows.map(r => ({
    timestamp: r.ts,
    avgHighPrice: r.avgHighPrice,
    avgLowPrice: r.avgLowPrice,
    highPriceVolume: r.highPriceVolume,
    lowPriceVolume: r.lowPriceVolume,
  }));
}

/* aggregate1hTo6h(rows) → the same shape, re-bucketed to aligned 6h windows.
   The archive stores 1h and 5m only, but `regimeDrift`/`phase()` consume a 6h series, so the 6h
   consumers can only move off live fetches if 6h is derivable.

   IT IS EXACT IN PRINCIPLE, and the honest error is elsewhere. A volume-weighted mean of
   volume-weighted 1h means over an aligned 6h partition equals the 6h volume-weighted mean —
   aggregation is NOT lossy (an earlier draft of the plan claimed it was; wrong). The real error
   sources, in order:
   THE DRIVER IS AGE, NOT COVERAGE AND NOT ROUNDING. Two earlier explanations in this header were
   wrong and are recorded here so nobody re-derives them: first "integer rounding, worst on penny
   items" (wrong), then "missing hours / coverage" (also wrong — it came from a 4-item sample with
   n=1 per cell). A 165-item / 19,839-side-bucket study (Fable, 2026-08-07) found:

     · error is ~zero wherever the derived side-VOLUME matches live (n=8,642, p95 0.008%) and lives
       ENTIRELY where it does not (n=11,197, median 0.25%, p95 5.97%);
     · and that split is an AGE CLIFF at ~15.2 days — exactly the `/timeseries` 1h endpoint's
       365-hour horizon. Within it, p95 ≤0.25%; beyond, 3.7–5.1%.
     · At FULL coverage (src=6) p95 is 0.88% on ≥5m items but 4.97% at 100gp–1k and 16.7% under
       100gp — i.e. full coverage does NOT imply exactness. Conversely 1-of-6-hour buckets are
       exact (n=182, p99 0.47%): one price, nothing to weight.

   The mechanism: inside 15.2d both live-1h and archive-1h exist and are byte-identical, so a 6h
   window derived from 1h matches the 6h endpoint. Beyond it only the archive has 1h, and the wiki's
   own 6h series is demonstrably NOT an aggregate of its own bulk 1h there (57% of side-volumes
   unequal). WHICH grain is "truer" beyond 15.2d is UNKNOWN — the archive preserved what bulk-1h
   served contemporaneously. Do not assume either.

   CONSEQUENCE: a `sourceBuckets` coverage THRESHOLD is not justifiable from data — the field stays
   as description, not as a gate. It happens not to matter, because the only 6h consumers
   (`regimeDrift`, `phase()`) read a short recent window that sits inside the exact zone.

   The 1h passthrough needs none of this: it is byte-exact (measured 7,148 identical / 0 differing
   across 20 items; the only absent buckets are the newest in-progress hour, which `windowStats`
   excludes anyway).
   A bucket with zero volume on a side contributes nothing to that side's mean (weight 0); when a
   whole 6h window has no volume on a side, that side is null — matching how the wiki reports an
   untraded side, so downstream null-handling is unchanged. */
// Consumed by archive6h() below (AF5b) — the ONLY sanctioned way to reach a 6h series from here, since
// it is the one that applies the LIVE_TS6H_BUCKETS pin. Do not call this directly for a consumer series.
export function aggregate1hTo6h(rows) {
  const SIX = 6 * 3600;
  const buckets = new Map();
  for (const r of rows || []) {
    if (r == null || r.timestamp == null) continue;
    const key = Math.floor(r.timestamp / SIX) * SIX;
    let b = buckets.get(key);
    if (!b) { b = { timestamp: key, hiNum: 0, hiVol: 0, loNum: 0, loVol: 0, src: 0 }; buckets.set(key, b); }
    b.src++;                                          // 1h buckets present for this window (max 6)
    const hv = r.highPriceVolume || 0, lv = r.lowPriceVolume || 0;
    if (r.avgHighPrice != null && hv > 0) { b.hiNum += r.avgHighPrice * hv; b.hiVol += hv; }
    if (r.avgLowPrice != null && lv > 0) { b.loNum += r.avgLowPrice * lv; b.loVol += lv; }
  }
  return [...buckets.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(b => ({
      timestamp: b.timestamp,
      avgHighPrice: b.hiVol > 0 ? Math.round(b.hiNum / b.hiVol) : null,
      avgLowPrice: b.loVol > 0 ? Math.round(b.loNum / b.loVol) : null,
      highPriceVolume: b.hiVol,
      lowPriceVolume: b.loVol,
      // EXTRA vs the wire shape: how many 1h rows fed this window (max 6). DESCRIPTIVE ONLY — do NOT
      // gate on it. The "6/6 → exact, 3/6 → drifts" story this field was added for did not survive a
      // 165-item study: full coverage is NOT exact on cheap items (p95 16.7% under 100gp) and 1-of-6
      // buckets ARE exact (one price, nothing to weight). Error tracks AGE, not coverage — see header.
      // Also note it is SIDE-BLIND: it counts rows present, so an hour that traded only the low side
      // still counts toward high-side "coverage". Present only on derived 6h, never on the passthrough.
      sourceBuckets: b.src,
    }));
}

/* --- The 6h READ, WINDOW-PINNED — AF5b's one home for a standing contract ------------------------

   LIVE_TS6H_BUCKETS is the wiki `/timeseries?timestep=6h` per-item cap: at most 365 points (verified
   live 2026-08-07 — 365 points, 91.0d span, 6h step). Every 6h consumer in this repo has therefore
   ALWAYS been fed at most that much history, and the archive read must honour the same bound.

   ⛔ WHY THE PIN IS A CONTRACT AND NOT A MIGRATION-DAY DETAIL. `phase()` is DEPTH-DEPENDENT: its
   `baseMid` is the median of points OLDER than PHASE_BASE_LOOKBACK_DAYS (js/quotecore.js:252) and its
   `peakMid` is the max over ALL points (:255-256) — feed it more history and BOTH move. A 165-item
   study (Fable, 2026-08-07, PLAN-ARCHIVE-FIRST-FUNNEL §8) measured it: comparing live 6h against the
   archive-derived 6h over each source's FULL series flipped 4/165 phase verdicts (Spider cave
   teleport, Chef's delight, Armadyl bracers, and Snape grass — the 0.71.1 fail-open incident item);
   comparing the SAME SPAN flipped 0/165.

   ⛔ "EVERY FLIP WAS A DEPTH ARTIFACT, NONE WAS DATA QUALITY" — FALSIFIED 2026-08-08 (adversarial
   review). That was this header's original claim and it is WRONG, in the unsafe direction. A 60-item
   production-realistic sample run in the previously-untested 00:00–02:00 local window found 2/60 six-way
   classification flips and 1/60 three-way GATE flips that survive same-span AND same-end trimming:
     · Red d'hide chaps #2495 — floor slope live −14.40 vs archive −14.20 gp/d against a flat-band of
       ≈14.30 (latest 2859 × FC_FLAT_FRAC 0.005). A 0.2 gp/d gap straddles the threshold and flips
       `falling/cooling` → `flat/mild-cooldown`, which OPENS the falling exclusion on an item the live
       read EXCLUDES. Wyvern bones flipped the safe way; this one does not.
     · Rune nails #4824 — `priorExtreme` 749 vs 748, a 1gp difference in one day-low ~11d ago, flipping
       `broke:true` → `crash-risk` vs `cooling`.
   Both sit INSIDE the ≤14d near-exact zone, so this is neither the 15.2d age cliff nor depth: it is a
   permanent property of feeding re-derived volume-weighted means into DISCRETE threshold tests. driftPct
   |Δ| across that sample: median 0.00pp but p95 4.27pp, max 12.55pp (vs §8's daytime p95 0.70pp).
   The generalisation, which is NOT about the archive: any item whose slope sits within rounding distance
   of `FC_FLAT_FRAC × price` has a coin-flip regime label from ANY source, and the falling-exclusion gate
   hangs off it (tracked in PLAN.md Discovered — wants a deadband, not a bare threshold).

   And it gets WORSE with time, not better. Today the archive (~71d) is SHALLOWER than live (91d);
   past ~2026-08-28 it will be DEEPER, and an unpinned archive read would silently drift phase verdicts
   as the archive accrues forever. So the pin lives HERE, applied once at the source — not at each call
   site, where the next consumer would forget it. `regimeDrift` itself is immune
   (`windowStats(nights:20)`, quotecore.js:182 — it keeps the last 20 local days whatever you feed it),
   but it reads the SAME series `phase()` does, so pinning once covers both.

   ⚠ THE PIN IS A CEILING, NOT A FLOOR — and that matters TODAY (measured 2026-08-07, AF5b build).
   It can trim a too-deep archive down to live's window; it cannot conjure depth the archive does not
   have. While the archive is SHALLOWER than live (285 of 365 buckets, 71.0d vs 91.0d as of build day)
   the two series are still not same-span, so `phase()` is NOT live-equivalent — verified on the very
   item §8 named: Snape grass reads `spike` on live 91d and `decay` on the pinned 71d archive (identical
   regime label `falling/cooling` on both), and Raw halibut reads `base` live / `spike` archive. §8's
   reassuring "0/165 same-span" was obtained by trimming the DEEPER source; a production read has no
   live series to trim against, so it cannot reproduce that condition until the archive itself passes
   365×6h ≈ 91.25 days (projected ~2026-08-28). AF6 must not promote the 6h read for phase() before
   then — `sixHourReader` reports the achieved bucket count per read so a caller can say so out loud.

   `sourceBuckets` IS STRIPPED HERE. aggregate1hTo6h attaches a descriptive per-window count that the
   live wire shape does not have. Anything that serialises a 6h point (a suggestions.jsonl row, a
   screen.json cell, a future item-context dump) would silently gain a field present only on the archive
   path — a diff that looks like data and is not. The pinned read emits the FIVE wire keys and nothing
   else.

   ⚠ DERIVED 6h VOLUMES ARE SUMS-OF-1h. `highPriceVolume`/`lowPriceVolume` here are the summed 1h side
   volumes over the window. Beyond the `/timeseries` 1h horizon (~15.2 days) they demonstrably disagree
   with the wiki's own 6h endpoint (57% of side-volumes unequal — its 6h is NOT an aggregate of its own
   bulk 1h out there; which one is "truer" is UNKNOWN). This is safe TODAY only because no 6h consumer
   reads them: `computeQuote` passes ts6h to `regimeDrift` and nothing else (js/quotecore.js:386), and
   `regimeDrift`/`phase()` read only `timestamp`/`avgLowPrice`/`avgHighPrice`. A FUTURE 6h VOLUME
   consumer inherits a silent unit change and must state which source it means.

   Returns [] when the archive holds no 1h rows for the item. Callers MUST read that as "no archive
   data, fall back to a live fetch", NEVER as "no trades" — an empty ts6h makes regimeDrift return
   {ok:false}, which un-gates the falling exclusion rather than failing loudly. */
const SIX_HOURS = 6 * 3600;
export const LIVE_TS6H_BUCKETS = 365;
export function archive6h(handle, id, { now = null, buckets = LIVE_TS6H_BUCKETS } = {}) {
  const nowS = now != null ? now : Math.floor(Date.now() / 1000);
  const rows = archiveSeries(handle, id, '1h', { from: nowS - buckets * SIX_HOURS, to: nowS });
  if (!rows.length) return [];
  const agg = aggregate1hTo6h(rows);
  // `from` can land mid-window, so the aggregate may carry one extra partial bucket — slice, don't trust.
  const pinned = agg.length > buckets ? agg.slice(-buckets) : agg;
  return pinned.map(({ sourceBuckets, ...wire }) => wire);   // strip the archive-only field (see header)
}

/* sixHourReader({ handle, live, … }) → async (id) → a 6h series. THE SEAM, so "off is byte-identical"
   is a testable property rather than a claim about four hand-edited call sites.

   With NO handle (the default, and what a bare scan gets) this is a pure pass-through: it calls `live`
   once with the same id and returns its result object UNCHANGED — the identical value the call site got
   from `fetchTsCached(id,'6h',TS_TTL_6H)` before AF5b existed.

   With a handle it reads the window-pinned archive series and FALLS BACK TO LIVE on an empty one
   (unknown item / cold archive), because an empty 6h series is not a neutral value here — see
   archive6h's closing note.

   ⚠ THE FALLBACK GUARDS DEPTH, NOT JUST EMPTINESS (2026-08-08, adversarial review). Guarding only
   `rows.length === 0` reproduced the exact fail-open the empty-case guard exists to prevent: a SHORT
   non-empty series (measured floor on the live archive: 19 buckets, Ugthanki & tomato #1879 — archive
   19 vs live 365) makes `regimeDrift` return {ok:false} → label `unknown` → the falling exclusion
   un-gates, silently. `regimeDrift` needs `REGIME_MIN_DAYS` (5) FULL LOCAL DAYS out of `windowStats`,
   which excludes today — so the floor is (5+1)×4 = 24 buckets, one spare day for the partial newest
   one. 219/4,489 items (4.9%) sit under 20 buckets and 488 (10.9%) under regimeDrift's 80-bucket
   appetite, so this is not a rare corner. This is NOT the `sourceBuckets` quality gate the plan ruled
   out: it does not judge whether archive data is GOOD ENOUGH, it refuses to hand a downstream consumer
   a series too short for it to run at all — the [] rationale applied consistently.

   `onSource('archive'|'fallback', id, n)` is an optional hook carrying the ACHIEVED bucket count (for a
   depth fallback, the count that was REJECTED, so a caller can report what it declined). A caller must
   report both halves honestly: the archive/live SPLIT (a silent fallback would overstate coverage) and
   the DEPTH (n < LIVE_TS6H_BUCKETS means phase() is reading a shorter window than live would have given
   it — see archive6h's ceiling-not-floor note; regimeDrift is unaffected ABOVE this floor). */
export const REGIME_MIN_6H_BUCKETS = (5 + 1) * 4;   // REGIME_MIN_DAYS(5) full days + today's partial, at 4×6h/day
export function sixHourReader({ handle = null, live, now = null, buckets = LIVE_TS6H_BUCKETS, minBuckets = REGIME_MIN_6H_BUCKETS, onSource = null } = {}) {
  return async function read6h(id) {
    if (handle) {
      let rows = [];
      try { rows = archive6h(handle, id, { now, buckets }); } catch { rows = []; }
      if (rows.length >= minBuckets) { if (onSource) onSource('archive', id, rows.length); return rows; }
      if (onSource) onSource(rows.length ? 'shallow' : 'fallback', id, rows.length);
    }
    return live(id);
  };
}
