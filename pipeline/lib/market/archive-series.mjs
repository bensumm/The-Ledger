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
     (a) MISSING 1h buckets inside a 6h window — the dominant and effectively the ONLY source.
     (b) integer price storage (±0.5gp per bucket) — predicted to dominate on penny items; MEASURED
         NOT TO. See below.
     (c) the newest partial window, not yet fully observed.

   MEASURED against live `fetchTs(id,'6h')` across four price tiers (Revenant ether 177gp, Nature rune
   155gp, Mahogany plank 1.9k, Masori chaps 26.4m), ~120 shared buckets each. Median error is
   **0.000% on every tier**; p95 runs 0.51–1.14%. Broken out by how many of the six hours actually
   traded:

       6/6 hours traded → 0.000% median (n=111 thin item, n=118 liquid)
       5/6              → 0.000%
       3/6              → 1.284% / 1.695% (n=1 each)

   So the aggregation is EXACT at full coverage and the whole error is sparsity. The plan's stated
   hypothesis — integer rounding, worst on penny items — was WRONG: the worst p95 was the 26m
   big-ticket (thin, so more untraded hours), and the 155gp rune was among the best. Rounding is not
   the driver; coverage is. That is a better result, because coverage is OBSERVABLE where rounding is
   not — hence `sourceBuckets` below, so a caller can refuse a low-coverage window instead of silently
   consuming a wrong mean. The 1h passthrough needs none of this: it is byte-exact (364 identical / 0
   differing per item; the one absent bucket is the newest, not yet archived).
   A bucket with zero volume on a side contributes nothing to that side's mean (weight 0); when a
   whole 6h window has no volume on a side, that side is null — matching how the wiki reports an
   untraded side, so downstream null-handling is unchanged. */
// @provisional-api: the 6h derivation AF5b needs to move regimeDrift/phase() off live fetches; no
// consumer until then. See PLAN-ARCHIVE-FIRST-FUNNEL AF5b.
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
      // EXTRA vs the wire shape: how many of the six 1h buckets fed this window. Measured: 6/6 → exact,
      // below that the mean drifts (3/6 → ~1.3–1.7%). Consumers that only read the five wire fields are
      // unaffected; a coverage-sensitive caller can gate on this instead of trusting every window
      // equally. Present ONLY on derived 6h — never on the 1h/5m passthrough, which needs no gate.
      sourceBuckets: b.src,
    }));
}
