# PLAN-PERF-1H-ARCHIVE — serve the survivor 1h series from the SQLite archive

Status: DRAFT (2026-07-18, perf follow-on to the PERF-1 bands migration). Owner: next Opus
session. Pipeline-only (no APP_VERSION bump). Folds into `PLAN.md` and is deleted the moment
its last chunk ships (per CLAUDE.md's plan-file rule).

## Motive

A warm `/scan` spends ~8s in the per-item series loop: profiling found **167 network MISSES at
~48ms each** against the wiki `/timeseries` endpoint — one call per (id, grain), grains
5m/6h/1h, whose short per-grain TTLs (3m/30m/15m, `screen-flip-niches.mjs:339-340`) expire
between scans. The already-applied mkdir hoist (`marketfetch.mjs:191-193`) saves ~16ms; the
real lever is eliminating the network round-trips. This plan removes the **1h third** (~56
misses ≈ ~2.7s) by serving the survivor 1h series from the Tier-1 SQLite archive that
`loadAll24hRolling`/`loadDaily`/`loadBands` already populate. **HARD constraint: byte-identical
scan output — a pure data-source swap, not a behavior change.**

## Findings (evidence gathered live, 2026-07-18, against the real archive + wiki API)

### CRUX VERDICT FIRST (#3): byte-identical archive-sourcing IS possible — value equality is
**proven exact**; the only obstacle is **coverage**, which is solvable and cheaply detectable.

- **Per-point equality (proven):** the bulk `/1h?timestamp=` windows the archive stores and the
  per-item `/timeseries?timestep=1h` points are the SAME upstream aggregation. Live diff on ids
  560/561/2434: **193/193 overlapping points byte-equal on all four fields** (avgHighPrice,
  avgLowPrice, highPriceVolume, lowPriceVolume), 0 mismatches. Thin items (20997, 27277)
  including one-sided-null hours (`avgLowPrice: null`, `lowPriceVolume: 0`): archive row ==
  API point exactly (SQL NULL round-trips as JSON null). This extends the 2026-07-13
  PLAN-VOL24 "proven EXACT" volume result (`marketfetch.mjs:253`) to per-point price fields.
- **Endpoint semantics (measured):** `/timeseries?timestep=1h` returns **exactly the last 365
  traded-hour points**; the newest point is the **last COMPLETE hour** (== `lastCompleteHour()`,
  `marketfetch.mjs:261` — NO partial current-hour point, so no structural staleness gap vs the
  archive). Liquid items: dense hourly grid (0 skips). Thin items: untraded hours are **omitted
  entirely** (no zero-vol placeholder points — measured 0 such points), and the 365-point window
  extends further back to compensate (20997 had 2 skips → first point 367h back). Omission
  matches the archive: a bulk bucket omits untraded items, so no row exists — **absent == absent**.
- **Coverage (the real constraint, measured on the live DB):** 1h grain holds 222 buckets
  (2026-06-11 → 2026-07-19). Over the current 365h `/timeseries` window: **193/365 hourly
  buckets present, 172 missing; contiguous trailing run = 155h**; beyond the trailing runs the
  spacing is 6h (loadDaily's grid). So TODAY the archive cannot serve a full series for any
  item — the plan must include a backfill (feasible: `/1h?timestamp=` serves past windows
  17-28d back, `marketfetch.mjs:438-443`) and a fallback.

### 1. Archive schema (`pipeline/lib/archive.mjs`)

- Grains: **1h and 5m only** (`GRAINS`, archive.mjs:43). Rows: `(grain, ts, itemId)` PK + the
  four raw fields (archive.mjs:63-72); companion `buckets` table records each stored
  whole-market (grain, ts) → `hasBucket()` is the cheap grid-completeness predicate
  (archive.mjs:106, 118-120).
- **A per-item range query EXISTS**: `seriesFor(itemId, grain, {from, to})` → ascending
  `[{ts, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume}]`, backed by the
  `obs_item (grain, itemId, ts)` index (archive.mjs:73, 150-160). No `marketAt` iteration
  needed — the feared 365-calls-per-item cost is moot; one indexed query per item, sub-ms.
- 1h populators: `loadAll24hRolling` (trailing 24 complete hours, **on the scan's DEFAULT path**
  since PLAN-VOL24 step 2 — `VOL_SOURCE` fallback `'rolling'`, screen-flip-niches.mjs:313,
  1376), `loadDaily` (6h-spaced windows back 17-28d, marketfetch.mjs:464-503), plus
  loadSnapshot accrual. Net effect: any day with ≥1 scan contributes a complete trailing-24h
  hourly grid; dark periods >24h leave hourly gaps that nothing currently backfills.

### 2. What `fetchTsCached(id,'1h',ttl)` returns (`pipeline/lib/marketfetch.mjs`)

- `fetchTsCached` (marketfetch.mjs:186-199) = 15-min disk cache (`.cache/ts/{id}-1h.json`)
  over `fetchTs` (line 169) = `GET /timeseries?id=<id>&timestep=1h` → the raw `data` array:
  `[{timestamp, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume}]`, 365 points,
  newest = last complete hour. Survivor-only (the union of mode survivors), fetched in the
  bounded worker pool at screen-flip-niches.mjs:1454-1457.
- NOTE the field-name delta: consumers read `p.timestamp`; `seriesFor` returns `ts`. The
  reconstruction must emit `timestamp` (and the four fields, nulls preserved).

### 3. Field + source equivalence — see CRUX VERDICT above. Same source, byte-equal. YES.

### 4. Consumers of `series1h` (screen-flip-niches.mjs) — the equivalence bar

All read `p.timestamp` + the four raw fields; all are numerically sensitive (they feed gates,
rank, printed cells, and suggestion logs), which is why the bar is exact identity, not "close":

- `reachValidator` via `runValidators` `intraday.ts1h` — lines 522, 557 (patient-bid reach),
  1098, 1111 (value mode)
- `rollShadow` → `rolling24FromTs1h` (volDayRolling shadow field) — lines 380-381, 806, 1152
- `trajectoryFrom1h` / `richFrom1h` (warm term structure) — lines 505, 1087
- `windowStats` (asym pair n=14 nights; reachable-band co-log) — lines 593, 610
- `hourProfile` / `deriveDiurnalRange` (diurnal timing block) — lines 603, 919-948
- `demandRegime` (DC3 flip-side annotation) — line 617
- `windowClear` (within-window clear read) — lines 650-651

## Design — archive-first / network-fallback hybrid, 1h only

**Everything below is per-scan-cheap: one grid scan + one indexed query per survivor.**

1. **New helper in `marketfetch.mjs`**: `makeTs1hArchiveReader({ db })` (opened once per scan,
   handle shared with loadBands/loadDaily/loadAll24hRolling as they already support via `{db}`).
   At construction it computes:
   - `anchor = lastCompleteHour()` (the existing marketfetch.mjs:261 helper — the SAME anchor
     the API's newest point uses, verified).
   - The **contiguous complete-grid span** `[C, anchor]`: walk `t = anchor, anchor-3600, …`
     while `hasBucket('1h', t)`; stop at the first gap. (Bounded at ~400 iterations; the
     `buckets` PK makes each check trivial.)
2. **Per-survivor read** (replaces only the 1h call in the worker at
   screen-flip-niches.mjs:1457; 5m and 6h stay on `fetchTsCached` — see "out of scope"):
   - Keep the `.cache/ts` TTL check FIRST, exactly as today (a warm cache hit today returns a
     ≤15-min-stale series; reordering would change output legitimately but non-identically).
   - On cache miss: `rows = seriesFor(id, '1h', { from: C, to: anchor })`.
     **Eligibility: `rows.length >= 365`.** If eligible → serve `rows.slice(-365)` mapped
     `{ts→timestamp, …four fields}` — provably identical to the API response, because the API
     is "the last 365 traded-hour points", every traded hour inside the complete span is in
     the archive (bucket present + absent-row == untraded, both proven), and any older API
     point is beyond the 365 cutoff. Write the served series through to `.cache/ts` with the
     normal `{ts: Date.now(), data}` envelope so downstream TTL semantics are unchanged.
   - Not eligible (item has <365 traded hours inside the span — the API would reach back past
     `C`) → **network fallback**: today's `fetchTs` path, byte-identical to current behavior.
3. **Grid heal + one-time backfill** (what makes eligibility actually fire):
   - Auto-heal at scan start: count missing hourly buckets in `[anchor-399h, anchor]` (400h =
     365 + ~35h slack for thin-item skip-hours). If `0 < missing <= MAX_AUTO_BACKFILL` (48 —
     one ≤2-day dark gap), fetch each via `jget(API + '/1h?timestamp=' + w)` + `append` —
     byte-for-byte the loadDaily/loadAll24hRolling backfill pattern (marketfetch.mjs:478-486),
     70ms spacing. If missing > 48, skip healing (scan latency politeness) — 1h simply falls
     back to network this run (zero regression) and a log line says so.
   - One-time initial fill: `node pipeline/commands/backfill-1h.mjs [--hours 400]` (new tiny
     command reusing the same loop, no cap) — ~172 bulk calls today, ~3-4 min once. Side
     benefit: the same grain feeds loadDaily/loadAll24hRolling, so those warm too.
   - Steady state: every scan's `loadAll24hRolling` (default path) already appends the trailing
     24h grid, so daily scanning keeps the grid complete forever; the auto-heal covers ≤48h
     outages; longer outages need one manual backfill run.
4. **Flag + rollout**: `--ts1h-source archive|network` (config-resolvable like `--vol-source`),
   **default `network` until AC2's shadow gate passes**, then flip the default to `archive` in
   a separate commit. `--ts1h-source network` stays as the escape hatch.
5. **Out of scope, on purpose**: 6h — the archive has no 6h grain (`GRAINS`, archive.mjs:43)
   and composing 6h from 1h is a different aggregation (NOT byte-safe). 5m — the archive
   accrues only ~2h of 5m per scan (loadBands) vs the ~30h `/timeseries?5m` window; coverage
   is structurally impossible without ~12× more 5m accrual. Note both as possible follow-ons;
   this plan does not touch them.

## Byte-equivalence validation strategy — the HARD gate

1. **Shadow mode** (`--shadow-ts1h`, or env `COFFER_SHADOW_TS1H=1`): for every survivor, build
   BOTH series — the archive candidate (when eligible) AND the network fetch — and diff
   point-by-point (same length; per index, `timestamp` + all four fields strictly `===`, null
   == null). The NETWORK series remains the one served (zero behavior change while
   shadowing). Emit a per-item PASS / FAIL / NOT-ELIGIBLE line + a summary count. **Gate: run
   across ≥3 real scans at different times of day after the backfill; required result: 0
   FAILs on every eligible item.** Any FAIL is a stop-and-investigate, not a tolerance.
2. **Full-output A/B**: two back-to-back runs inside the same hour anchor — run 1
   `--ts1h-source network`, run 2 `--ts1h-source archive` — each with the `.cache/ts/*-1h.json`
   entries deleted first (so both take the miss path) and with the bulk caches warm (so the
   non-1h inputs are byte-shared). Diff `screen.json` normalizing ONLY `generatedAt`, and diff
   the captured stdout. **Acceptable diff: none.** Abort and re-run the comparison if the hour
   boundary ticks between the two runs (the anchors would legitimately differ).
3. **Unit test** `pipeline/test/ts1h-archive.test.mjs`: in-memory archive fixture covering (a)
   dense liquid item → exact 365-slice reconstruction incl. the ts→timestamp rename, (b)
   thin item with skip-hours + one-sided nulls, (c) <365 rows in span → NOT eligible →
   fallback signalled, (d) grid gap moves `C` forward and flips eligibility. Runs in CI with
   the existing test sweep.

## Acceptance criteria

- **AC1** — `makeTs1hArchiveReader` + eligibility predicate + `backfill-1h.mjs`, unit-tested
  (test cases a-d above). *Honesty: mechanical, fixture-proven; no market claim.*
- **AC2** — shadow gate: ≥3 real scans post-backfill, 0 diffs on all eligible items; plus the
  A/B `screen.json`/stdout diff = empty. *Honesty: the empirical identity proof; the 3-item
  spot check in Findings is evidence of plausibility, NOT the gate — this is.*
- **AC3** — hybrid wired into the survivor worker behind `--ts1h-source` (default `network`);
  default flipped to `archive` only after AC2, in its own commit. *Honesty: mechanical.*
- **AC4** — auto-heal (≤48 missing) verified by deleting a few buckets from a COPY of the DB
  and watching them refill; >48 missing verified to fall back with a log line. *Mechanical.*
- **AC5** — measurement: re-profile a warm scan before/after. Expected: ~56 of the 167 misses
  removed ≈ ~2.5-2.7s saved (56 × 48ms, minus ~56 sub-ms SQLite reads). *Honesty: an
  ESTIMATE — the exact miss split by grain was not separately counted (TTLs differ: 3m/15m/30m,
  so the warm-scan mix varies); AC5 is verified by measurement, not asserted.*
- **AC6** — docs pass (rule 8): README inventory entries for `backfill-1h.mjs` + the flag;
  `docs/MARKET-ANALYSIS.md` per-script facts (1h source); CHANGELOG. Pipeline-only — no
  APP_VERSION bump (rule 5).

## Risks & honesty (process rule 4)

- **Coverage is the whole game.** Day 1 saves nothing until the one-time backfill runs; after
  a >48h dark period the scan silently reverts to network (correct, but the perf win pauses)
  until a manual backfill. This is by design — correctness degrades to today's exact behavior,
  never to a wrong series.
- **Bucket-minting race at the hour edge**: if the wiki hasn't minted the newest complete
  bucket when a scan starts seconds after the hour, `/timeseries`'s newest point and the
  archive's newest bucket could transiently disagree. Measured today they agree exactly
  (newest API point == `lastCompleteHour()`), and eligibility requires `hasBucket(anchor)` so
  a missing newest bucket fails closed to network — but the shadow runs (AC2) must include a
  scan started within ~2 min after an hour boundary to observe this edge live.
- **Bucket immutability assumption**: a value archived at hour H+ε is assumed equal to what
  `/timeseries` serves days later. Evidence: 193/193 week-old points matched exactly. A late
  upstream revision would break identity; AC2's shadow diffs are exactly the instrument that
  would catch it — if any FAIL traces to revision, the honest outcome is to STOP and keep 1h
  on network (documented, not fudged with a tolerance).
- **Ordering trap**: keep the `.cache/ts` TTL check FIRST. Archive-first-before-cache would
  often serve a *fresher* series than today's warm-cache hit — a real improvement, but NOT
  byte-identical; out of scope for this plan.
- **Perf claim discipline**: "~1/3 of 167 ≈ 56 misses ≈ 2.7s" is arithmetic on one profiled
  session; AC5 measures the real number. Don't quote the saving as fact until then.

## Implementation steps (ordered; each independently verifiable)

1. `backfill-1h.mjs` + the grid-span/eligibility helpers in `marketfetch.mjs` + unit tests
   (AC1). Verify: tests pass; `node pipeline/lib/archive.mjs` shows the 1h bucket count jump
   after a backfill run; the coverage probe (Findings) shows 365+/365 present.
2. Shadow mode `--shadow-ts1h` (network still served). Verify: AC2's ≥3-scan zero-diff record,
   including one scan started just after an hour boundary.
3. Wire the hybrid behind `--ts1h-source` (default `network`) + auto-heal (AC3/AC4). Verify:
   the A/B empty diff; the deleted-buckets refill test.
4. Flip the default to `archive` (own commit) + AC5 profile + AC6 docs pass.

## Docs to reconcile when this ships (rule 8)

- `README.md` — inventory: `pipeline/commands/backfill-1h.mjs`, the `--ts1h-source` flag on
  the screen entry, the archive's new consumer.
- `docs/MARKET-ANALYSIS.md` — per-script facts: the screen's 1h series source (archive-first,
  network fallback) and the escape hatch.
- `pipeline/lib/marketfetch.mjs` / `archive.mjs` headers — note the 1h grain's new reader and
  the proven bulk==timeseries per-point equivalence (with the 2026-07-18 evidence date).
- `CHANGELOG.md` — the perf entry with the measured AC5 number.
- This file folds into `PLAN.md` and is deleted at ship.
