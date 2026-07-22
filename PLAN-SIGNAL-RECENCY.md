# PLAN-SIGNAL-RECENCY — one shared trajectory-projection primitive + the stale-read rewiring

Status: **DRAFT — no code shipped yet.** Per-topic working doc (PLANNING.md lifecycle step 1–2);
folds into `PLAN.md` and is deleted the moment its last chunk ships. Full inventory, stale-read
census, redundancy map, and earns-its-keep verdicts live in **`docs/SIGNAL-AUDIT.md`** (read-only
audit, 2026-07-22) — this doc does not repeat that analysis, only sequences the fix.

**The one-line thesis (Ben's mandate):** five surfaces (quote, positions, scan, digest, the
value-niche buy gate) each compute "is this trending / where's the reachable level" from a
DIFFERENT stale aggregate (14-day median, q15/q85 quantile, mean-of-halves, whole-window CDF).
`floorCeilingTrack` (PLAN-DRIFT-VS-CRASH) already solved this once, for the floor/ceiling pair, with
a least-squares slope + a discrete break test + a duration-reporting `run` field. Generalize it into
one shared `projectTrajectory(days, extractFn, opts)` primitive in `js/windowread.mjs`, then rebase
the other four stale consumers onto it instead of re-deriving trend math per surface.

**Anchor failures this plan exists to close** (name, don't re-litigate — full stories in
`docs/SIGNAL-AUDIT.md` §2): the fang's "reaches 18.11m 14/14 days" was a whole-window reach stale
against a repriced item; `regimeDrift` mislabeled recovering Letvek "Falling −13%" off a single
3-day-vs-14-day delta; a bludgeon pitch stacked an optimistic reach fold + a near-stale live tick
into an inflated +412k Est.-sell (the Searing-page mirage shape).

## House rules this plan follows (do not restate per chunk — apply to all of them)

- No `APP_VERSION` bump for pipeline/analysis changes (every chunk here is console/pipeline-only,
  same as `floorCeilingTrack`/`reachMargin` today); skills bump their own `version:` frontmatter if
  a skill's prose changes.
- Every chunk carries the honesty rails already established for `floorCeilingTrack`/`reachMargin`:
  **HEURISTIC (n≈0 or n≈14), INFORM-ONLY unless a chunk explicitly says GATE, a `minDays`/degrade
  gate that returns `null` rather than a fake read, and every threshold is a NAMED PLACEHOLDER**
  pending F1. Nothing in this plan turns a trend read into a hard auto-gate — the operator overlays
  exogenous knowledge (game updates, community intel) on top of every trend note; the two chunks
  that touch an EXISTING gate (R2's `regimeDrift` falling-exclusion, R3's `floorValidator` value-niche
  gate) are flagged with the acceptance-fixture treatment they need, precisely because a gate carries
  real regression risk that an inform-only note does not.
- A documentation-reconciliation pass rides with every chunk (CLAUDE.md rule 8): grep
  `docs/MARKET-ANALYSIS.md`, `docs/SIGNAL-AUDIT.md`, and `CLAUDE.md`'s ask→command table for
  statements the chunk supersedes and fix them in place — move, never copy. New files get a
  `README.md` inventory entry the moment they're created.
- `node --check` every touched file; run `node pipeline/ci/run-tests.mjs` for any tested module;
  add/extend fixtures per chunk's "Test additions" below — re-run `floorCeilingTrack`'s existing
  fixtures against the refactored `projectTrajectory` call path as a literal byte-identity check
  before anything downstream is allowed to depend on it (R1's proof obligation).

---

## The primitive: `projectTrajectory(days, extractFn, opts)`

**Home:** `js/windowread.mjs`, immediately above/beside the current `floorCeilingTrack` (which it
subsumes). Reuses the existing `slopePerStep` helper `floorCeilingTrack.track()` already calls —
this is a generalization of that inner function, not a new algorithm.

### Contract

```
projectTrajectory(days, extractFn, {
  recentN      = FC_RECENT_N,     // slope-fit window (existing constant, default 5)
  minDays      = FC_MIN_DAYS,     // fewer COMPLETED days ⇒ null, never a fake read (existing, default 5)
  flatFrac     = FC_FLAT_FRAC,    // |slope|/latest-level per day below this ⇒ 'flat' (existing, 0.005 placeholder)
  todayKey     = null,            // phase-alignment guard — drop an incomplete forming day from the fit
  breakLookback = null,           // optional: run the discrete break test too (null ⇒ skip; not every
                                   // extractor has a natural "prior floor" concept — e.g. a cushion series)
  projectN     = PT_PROJECT_N,    // NEW: how many forward periods the projected low/high covers (default 1 — "next period")
} = {})
→ {
  latest, slope, step,             // gp/period least-squares slope (existing floorCeilingTrack.track() fields)
  dir: 'rising'|'flat'|'falling'|null,
  run: { dir, len },                // trailing raw-sign micro-run — duration, not just a flipping verdict
  nUsed,
  break: { broke, latest, priorExtreme, gap, lookback } | null,   // only when breakLookback is supplied
  projected: { low, high, confidence } | null,   // NEW: forward-projected next-period low/high band
}
```

- **Inputs**: the exact `windowStats().days` shape (`[[key, {low, hi, volLo, volHi}], …]` oldest→newest)
  every proposed caller already has in hand on the pass where it runs (§ Call sites below) — **zero
  new fetch at any call site**. `extractFn: (dayEntry) => number|null` pulls the one scalar the
  caller wants tracked (`n => n.low`, `n => n.hi`, `n => cushionOf(extremeOf(n))`, `n => mid(n)`).
- **`floorCeilingTrack(days, opts)` becomes a two-call wrapper**: `projectTrajectory(days, n => n.low, opts)`
  for the floor track + `projectTrajectory(days, n => n.hi, opts)` for the ceiling track, with the
  existing `breakLookback` passed only on the floor call (the crash-trigger side) and the existing
  `classification` table (`crash-risk`/`healthy-trend`/`compressing-up`/`mild-cooldown`/`cooling`/
  `ranging`) computed exactly as today from the two `dir`s + the floor `break.broke` flag. This must
  ship as a **pure refactor — byte-identical output** against `floorCeilingTrack`'s existing fixtures,
  proving the generalization is sound before anything downstream depends on it.
- **The `projected` field is new** (floorCeilingTrack today has no forward projection, only a
  backward-looking slope/dir/break). `projected.low`/`.high` = `latest + slope × projectN`, i.e. the
  least-squares line extended one period forward — the SAME slope already computed, just evaluated
  forward instead of only backward. `confidence`: `'low'` when `nUsed < recentN` (a partial-window
  fit) or the series shows a `break`, else `'ok'`. **This is what makes the primitive usable as a
  forward "where's the reachable level" read, not just a backward trend label** — the CLI (below)
  is its most direct consumer, but any of the rewired consumers may read it too.
- **Honesty rails (unchanged from `floorCeilingTrack`, restated because they are the load-bearing
  contract every caller relies on):**
  - **n≈0 heuristic** — every constant (`recentN`, `minDays`, `flatFrac`, `breakLookback`) is a NAMED
    PLACEHOLDER pending F1; this primitive does not change that status, it only centralizes it.
  - **inform-only by default** — `projectTrajectory` itself never gates; a caller's POLICY (does a
    `falling` dir caution/reject) is a decision the caller makes, exactly as `trajectoryValidator`
    already separates `classifyTrajectory`'s SHAPE math from its own gate/inform POLICY over that
    shape. R2 and R3 below are the two places a caller's policy elevates this into (or beside) a
    real gate — both get the acceptance-fixture treatment.
  - **min-days gate, never a hard gate without human overlay** — fewer than `minDays` completed days
    ⇒ `null` (degrade, never a fake slope); the `break` field is `null` whenever `breakLookback` is
    not supplied, never a false negative.
  - **phase-alignment guard preserved** — the `todayKey` forming-day exclusion from
    `floorCeilingTrack` carries over unchanged; an incomplete today bucket must never feed a slope or
    a break test (the "2-day wiggle isn't a trend" / maul lesson stays load-bearing).

### Test additions (R1)
- `pipeline/test/projecttrajectory.test.mjs` (new): the maul/fang/godsword/soulreaper fixture shapes
  `floorCeilingTrack`'s existing tests already encode, re-run through `projectTrajectory` directly
  (extractFn = `n=>n.low` / `n=>n.hi`) plus a NEW `projected.low/high` assertion per fixture (the
  forward-line extension is new surface, needs its own pin).
- Re-run `floorCeilingTrack`'s existing fixture file unchanged against the refactored implementation
  — this must pass with ZERO diffs to the expected values (the byte-identity proof).

---

## Chunk sequence

| Chunk | What | Primary files | Depends on | Gate or inform? | State |
| --- | --- | --- | --- | --- | --- |
| R1 | Build `projectTrajectory`; refactor `floorCeilingTrack` onto it (pure, byte-identical); ship `read-trajectory` CLI preset | `js/windowread.mjs`, `pipeline/commands/read-window-range.mjs`, `pipeline/commands/read-trajectory.mjs` (new), `pipeline/test/projecttrajectory.test.mjs` (new) | — | inform (primitive only; CLI is read-only) | **LANDED 5dfc202** (Fable-reviewed) |
| — | R2 display: `regimeCellText` — `<Label> · <classification>` compact, `· N% below/above 2wk` full (driftPct reframed as an unsigned range-position; kills the "Rising -32%" contradiction) | `js/quotecore.js`, `js/watch.js`, `pipeline/commands/watch-positions.mjs` | R2 | display | LANDED with R2 (Ben's contextualization) |
| R2 | Rewire `regimeDrift`/`regimeLabel` (screen falling-exclusion gate) + `rateItem.regimeFactor` onto `projectTrajectory`'s classification | `js/quotecore.js`, `js/rating.mjs` (unchanged — reads same fields), `pipeline/lib/gatecandidates.mjs` (unchanged), **`js/trends.js`** (`classifyPositionTrend` + `runTrends` `fallingNow` rewired — 2 Fable-found cross-surface consumers), `js/state.js` (APP_VERSION 0.66.0 — deployed-app change), `pipeline/test/quotecore.test.mjs` (Letvek anchor + pair + fields + regimeCellText) | R1 | **GATE** (falling-exclusion) + rank multiplier | **LANDED** — Fable-reviewed (2 passes, both HIGH cross-surface findings fixed), Ben green-lit the mapping + display. Mapping: `crash-risk`/`cooling`→falling, `healthy-trend`→rising, rest→flat |
| R3 | Add a `projectTrajectory` recency-trend gate input to `floorValidator` / the value-niche buy gate | `js/termstructure.mjs`, `js/validate.mjs`, `pipeline/lib/warm-term-structure.mjs` (`warmOverride` carries `.recentTrend` while cold), `pipeline/commands/{screen-flip-niches,quote-items}.mjs` (override sites), `pipeline/test/termstructure.test.mjs` | R1 | **GATE** (value niche, per-spec) | **LANDED** — Fable-reviewed (2 passes; its HIGH 6h-vs-daily calibration bug fixed: `s` is bucketed to one median-mid/local-day before `projectTrajectory`). Additive-ONLY (tighten a near-floor faller; never relaxes). App-affecting — `js/trends.js` renders `floorValidator` as an inform note, so APP_VERSION 0.66.0→0.66.1. |
| R3b | The RELAX direction (deferred from R3 per Fable's ruling): relax a raw caution/reject on `floorValidator` ONLY when `recentTrend` is decisively RISING AND the level sits above the stale q15 floor because of a genuine re-price up — the audit's lead harm (false-reject on a recovered riser). Its own fixtures + Ben sign-off; riskier than R3 (un-gates a buy), so NOT smuggled into R3's additive-only scope. | `js/validate.mjs` | R3 | **GATE** (relaxing) | OPEN — future |
| R4 | Rebase `reachMargin.trend` onto `projectTrajectory`'s slope (drop mean-of-halves) — CONSOLIDATION + all-days-by-recency fit + R5 unblock (NOT single-end-day robustness, see corrected test note) | `js/windowread.mjs`, `pipeline/test/windowread.test.mjs` | R1 | inform | **LANDED** — Fable-reviewed (confirmed the false robustness claim; landed on consolidation grounds) |
| R4b | Wire `reachMargin` into the scan/digest surface (the ask-side `trend` token beside the digest reach ✓/✗) — split from R4 per Fable (changes a live decision surface → its own before/after diff) | `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/capeff-digest.test.mjs` | R4 | inform | **LANDED** — Fable-reviewed (no issues found). Additive display-only: new `trend` column between reach and phase; `digestReachAndPlacement` folds `reachMargin(days,'ask',refLevel).trend`, scored at the same (stale-guarded) refLevel; symmetric/thin → `—`. Live before/after diff confirmed purely additive (Aldarium reach ✓ + `↓ fade`, Letvek reach ✗ + `↑ ext`). 44 assertions pass. |
| R5 | Trend-aware discount in `estimatePair`'s sell-top fold (Est-sell mirage fix) + the digest's `mirage top` rule gets recent/full placement divergence + the same trend sign | `js/estimators/sell-models/reach-fold.mjs` (`EST_FADE_DISCOUNT`), `js/estimators/pair.mjs` (thread `askMargin`/`fade`), `pipeline/commands/screen-flip-niches.mjs` (wire `askMargin`, digest escalation + `placementDiverges`), `pipeline/test/{estimators,capeff-digest}.test.mjs` | R1, R4 | inform (both are already inform: a price fold, a triage word) | **LANDED** — Fable-reviewed (2 findings fixed: #1 HIGH — the fade now surfaces in `estConfLean` (F1 shadow) + a `fading↓` sell-cell token, was set-but-never-rendered; #2 MED — `pressure.mjs` now nulls the inherited `fade`/`foldExempt` since its override replaces the sell the fold never touched; #3 dismissed). Part A: a `fading` ask-side `reachMargin.trend` (via `extra.askMargin`) applies `EST_FADE_DISCOUNT` (0.6) to the sell fold even on a clean 3/3 reach — additive, symmetric-exempt, declared-exit-nulled, byte-identical when absent/stable/extending. Part B: `digestVerdict` escalates base `mirage top`→`mirage top!` only when directional `placementDiverges` (recent-vs-full CDF) AND `fading` both hold; never widens the base. Live diff clean. 51 estimator + 52 digest assertions pass. |
| R6 | Retire `trajectoryRead`'s printed shape label; fold its unique fields (floor/ceiling/livePos) into the `floorCeilingTrack`/`projectTrajectory` note | `js/windowread.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/commands/read-window-range.mjs` | R1, R2 (so the surviving note reflects the same classification the gate now uses) | inform (display-only) | OPEN |
| R7 | Add a single `cappedBy` field to the screen row naming which of the five grade ceilings (if any) bound the printed letter | `pipeline/commands/screen-flip-niches.mjs`, `js/rating.mjs` | — (independent, can land anytime) | n/a (legibility only) | OPEN |
| R8 | Decide + document the fate of DE1/DE6 depth pricing and the Extension-B pressure/demand read (graduate one consumer, or mark shelved) | `PLAN.md` (Discovered / decisions list), `pipeline/commands/read-window-range.mjs` header | — (independent, no primitive dependency) | n/a (decision doc, no code unless graduating) | OPEN — Ben decision needed |

**Parallel-safety** (mirrors `PLAN.md`'s rule): R2 and R3 touch disjoint file sets
(`js/quotecore.js`+`js/rating.mjs` vs `js/termstructure.mjs`+`js/validate.mjs`) and both depend only
on R1, so they can run as parallel lanes once R1 lands. R4 also depends only on R1 and is disjoint
from R2/R3's primary files (only `screen-flip-niches.mjs` overlaps, and R4's edit there is additive
— a new digest column — so a same-file-different-region merge is fine per the parallel-safety rule).
R5 must sequence after R4 (it reuses `reachMargin`'s rebased trend). R6 should land after R2 so the
surviving quote-items note reflects the SAME classification the gate now drives (avoids a
transitional period where the display note and the gate note can still visibly disagree, which is
the exact redundancy the audit calls out). R7 and R8 are fully independent and can land whenever.

---

## R1 — the primitive + the `read-trajectory` CLI

### `floorCeilingTrack` refactor
`floorCeilingTrack(days, opts)` keeps its exact signature and return shape (`{ completed, forming,
nDays, floor, ceiling, floorBreak, classification }`) — callers (`quote-items.mjs`,
`read-window-range.mjs --profile`) do not change. Internally it becomes two `projectTrajectory` calls
+ the same classification table it has today. `formatFloorCeiling`'s render is untouched (it reads
the same field names).

### The `read-trajectory` CLI — spec

**Recommendation: a new thin preset command, `pipeline/commands/read-trajectory.mjs`, that is a
memorable-name wrapper over a new `--trajectory` output mode added to `read-window-range.mjs`,
NOT a from-scratch script.** Rationale: `read-window-range.mjs` already owns the fetch plumbing
(`loadMapping`/`fetchTs`/`fetchLatest`), the `windowStats` bucketing, and the existing `--profile`
block that prints `floorCeilingTrack`'s note — duplicating that plumbing in a second file would be
exactly the kind of per-surface re-derivation this whole plan exists to stop. `read-window-range.mjs`
gains a focused `--trajectory` flag (its own output block, independent of `--profile`/`--depth`/
`--pressure` so it can be requested alone); `read-trajectory.mjs` is a few-line argv-mapping wrapper
(`item` positional + `--nights`) that re-execs `read-window-range.mjs` with `--trajectory` preset —
giving Ben the one-word command he asked for without a second fetch/bucketing implementation to keep
in sync.

**Output format** (per item, mirroring the existing `--profile`/`--depth` block style — a labeled
stdout block, `--json` gets the same data structurally):

```
Fang <id> — trajectory (last 10 completed days, phase-aligned; today forming)
  day        low        high
  07-13    17.80m     18.40m
  07-14    17.62m     18.31m
  ...
  07-21    17.05m     17.90m   ← today (forming, provisional)
  live: 17.12m  (mid-band; floor 16.98m · ceiling 18.40m)
  floor: falling −38k/d over 5d · ceiling: falling −52k/d over 5d · classification: cooling
  projected next-24h: low ~16.94m · high ~17.68m  (confidence: ok)
  (heuristic, n≈0 — inform-only, never gates; F1-pending)
```

- The per-day low/high table is `windowStats().days` printed directly (already-fetched, zero new
  math) — this answers Ben's literal ask ("today's high/low vs previous days").
  Wired but not yet published — this is a NEW block on an existing pipeline command, not a screen.json
  contract, so it ships without `APP_VERSION` change.
- "Where live sits" reuses `trajectoryRead`'s `livePos` computation (floor/mid-band/ceiling) — kept
  here even though R6 retires `trajectoryRead`'s SHAPE label; `livePos` survives as a field on the
  combined note (see R6).
- "Projected next-24h low/high" is `projectTrajectory`'s new `projected` field, evaluated once for
  the floor extractor and once for the ceiling extractor — printed with its `confidence` token so a
  thin/broken series reads honestly instead of a bare number.

### Test additions (R1, CLI)
- A fixture-level test for the new `--trajectory` block's rendering (string-shape assertion, not a
  live fetch) alongside the existing `read-window-range.mjs` CLI tests.

### Docs to update (R1)
- `docs/MARKET-ANALYSIS.md`: add `read-trajectory` to the per-script facts section.
- `CLAUDE.md`'s ask→command table: add a row — "how's `<item>` trending / where's it likely to be
  tomorrow?" → `node pipeline/commands/read-trajectory.mjs "<item or id>"`.
- `README.md`: inventory entry for the new `read-trajectory.mjs` file.
- `docs/SIGNAL-AUDIT.md`: no changes needed yet (it is the read-only audit this plan executes; it
  gets a one-line "superseded by PLAN-SIGNAL-RECENCY, see PLAN.md Status" pointer only once this
  plan's chunks start shipping, per the fold-out discipline).

---

## R2 — rewire `regimeDrift`/`rateItem.regimeFactor` onto `projectTrajectory`

**Why first after R1 (per `docs/SIGNAL-AUDIT.md` §5's "single highest-leverage recommendation"):**
`regimeDrift` is the most consequential stale-read in the repo by REACH — it drives the screen's
falling-exclusion gate AND `rateItem.regimeFactor` (the grade multiplier on every graded row), and
today it has LESS recency granularity than any other trend signal in the inventory (one 3-day-vs-
14-day delta, no slope, no duration, no break test). The better primitive already exists; this chunk
just points the highest-leverage consumer at it.

**The archive-shape wrinkle (must be handled explicitly, not assumed away):** `regimeDrift` currently
operates on the 6h archive's raw `points` (`{avgLowPrice, avgHighPrice, timestamp}`), NOT on a
`windowStats().days` bucketed series — a different shape from every other `projectTrajectory` call
site. `windowStats(series, opts)` is itself timestep-agnostic (it only needs `pt.timestamp`,
`pt.avgLowPrice`/`avgHighPrice`, optionally the volume fields) — so the fix is `windowStats(ts6h,
{ nights: ~17, wStart: 0, wEnd: 24 })` (a full-day window, no time-of-day restriction) to get a
`days`-shaped series from the SAME 6h archive `computeQuote` already fetches (zero new fetch), then
`projectTrajectory(days, n => mid(n))` where `mid(n) = (n.low + n.hi) / 2` (mirroring `regimeDrift`'s
existing mid-price definition). This is the one piece of real engineering in this chunk — everything
else is substitution.

**What changes:**
- `js/quotecore.js`: `regimeDrift(points)` is replaced by a `regimeTrajectory(points)` (or the
  existing name is kept and its INTERNALS swapped — pick whichever keeps `computeQuote`'s call site
  and `row.regime`/`row.regimeLabel` field names byte-identical, since `screen-flip-niches.mjs`,
  `js/rating.mjs`, and the digest all read those field names directly). Internally: bucket `ts6h`
  via `windowStats`, run `projectTrajectory` on the mid series, and derive `regimeLabel`'s
  `flat`/`rising`/`falling` from `projectTrajectory`'s richer `crash-risk`/`healthy-trend`/
  `compressing-up`/`mild-cooldown`/`cooling`/`ranging` vocabulary (a mapping table, e.g.
  `crash-risk`→`falling`, `healthy-trend`/`compressing-up`→`rising`, `mild-cooldown`/`cooling`→
  `falling`, `ranging`→`flat` — Ben-vetoable, name it explicitly in the code comment so the mapping
  is a visible decision, not an implicit fallthrough).
- `js/rating.mjs`: `regimeFactor(row)` keeps reading `row.regime.ok`/`row.rising`/`row.regime.driftPct`
  — if the driftPct concept survives the swap (recompute it as `(latest − priorMedian)/priorMedian`
  off the same series so downstream math is untouched) this function needs NO change; if driftPct is
  dropped in favor of the slope, `regimeFactor` needs a small rewrite to key off `dir`/`slope`
  instead (state which in the implementing PR — this plan does not pre-decide it, since it depends on
  what R2's implementer finds cleanest, but the fixture below pins whichever choice ships).
- `pipeline/lib/gatecandidates.mjs`'s `surviveMode` reads `row.falling` (set from `regimeLabel`'s
  `falling` boolean) — no code change needed there IF the field's semantics stay "is this item in a
  falling regime," but the REGRESSION SURFACE is real: some rows that were `falling` under the old
  single-delta test will not be under the new slope+classification test, and vice versa (see Risk
  section).

### Test additions (R2)
- Recovering-item fixture (the "Letvek" anchor shape: recent slope turning positive after a longer
  decline) — old `regimeDrift` mislabels `falling`; new `regimeTrajectory` must label it correctly
  (or at minimum `flat`, never `falling`, while a genuine slope is positive). Pin this as the
  regression-preventing acceptance fixture for this chunk.
- A same-headline-different-trajectory pair (two items both at +/-5% drift, one still decelerating
  into it vs one that just turned around) — assert the new classification tells them apart (the gap
  the audit names as `regimeLabel`'s core blind spot).
- Full `screen-flip-niches.mjs --mode all` acceptance run against a frozen archive snapshot
  (pipeline/ci already has acceptance-fixture infra per `checks.yml`'s "quotecore + reconstruct
  acceptance fixtures" — extend that pattern here): diff the row set + grades before/after the swap,
  and manually review every row whose `falling` flag OR grade changed as a result (not just count
  them) — this is a GATE change, the review burden is real and intentional.

### Docs to update (R2)
- `docs/MARKET-ANALYSIS.md`'s regime-gate section (the falling-exclusion doctrine paragraph).
- `docs/SIGNAL-AUDIT.md` §2 Tier-2 #6 and §3's redundancy-map paragraph on `regimeDrift` — mark
  fixed/superseded once shipped (pointer to the landing commit, per the fold-out/"shipped work lives
  in commits" discipline already established for `PLAN.md`).

---

## R3 — `floorValidator` recency-trend gate (the value-niche buy gate)

**Why this is Tier-1 #1 in the audit and the single biggest unprotected stale-read surface:**
`termStructure`'s durable floor is a pure q15 quantile over the WHOLE 14–28d lookback with ZERO
recency weighting — if an item re-priced 10 days ago, the floor keeps citing 10-day-old cheap prints
for another 18 days, gating BUY decisions on value/big-ticket holds off a stale level. The fix is
**additive, not a replacement**: the durable floor stays a quantile (that is the right tool for
"where does support durably print"), but `floorValidator` gets a SECOND gate input — a
`projectTrajectory` read over the same daily-mid series `termStructure` already holds — so a buy near
a quantile-floor that is ALSO in a `falling` trajectory can caution/reject even when the raw
quantile-distance check looks fine.

**What changes:**
- `js/termstructure.mjs`'s `termStructure(series, opts)` gains a `projectTrajectory` call over the
  SAME `s` (already-filtered daily-mid series) it holds — output attached as a new field, e.g.
  `ts.recentTrend` (`{ dir, slope, run }`), computed ALONGSIDE the existing `classifyTrajectory`
  shape read (they answer different questions — shape vs slope-with-duration — keep both, per the
  audit's "not stale reads (correctly scoped already)" list which already treats `classifyTrajectory`
  as a legitimate distinct signal).
- `js/validate.mjs`'s `floorValidator(ctx)` reads `ts.recentTrend` as a SECOND condition: today it is
  purely `ranges = (level − floor) / swing` thresholded at `FLOOR_CAUTION_RANGES`/`FLOOR_REJECT_RANGES`.
  Add a caution bump (never an independent reject — keep the blast radius additive-only per the
  audit's "smallest risk of regressing a currently-correct read" framing) when `recentTrend.dir ===
  'falling'` AND `ranges` is already in caution territory (i.e. the trend read TIGHTENS an existing
  caution into a reject, or nudges a borderline pass into caution — pick the exact threshold
  combination in the implementing PR and pin it with a fixture; do not let the trend alone override a
  clean pass with a lot of headroom above the floor).

### Test additions (R3)
- The exact stale-floor anchor shape: an item whose historical q15 floor sits well below its CURRENT
  multi-day trajectory (a genuine multi-week re-price up) — assert `floorValidator` still passes (the
  trend is RISING, not falling — this must not become a false reject on a healthy recovery).
- The mirror anchor: an item whose q15 floor still looks fine on raw distance but whose recent daily
  mids are in a `falling` `projectTrajectory` run — assert the caution/reject bump fires.
- A `value` mode acceptance-fixture run (frozen archive snapshot) diffing which candidates the value
  niche admits/rejects before vs after — this is a GATE change on a real buy path, review every
  diffed row.

### Docs to update (R3)
- `docs/MARKET-ANALYSIS.md`'s value-niche / floorValidator section.
- `js/termstructure.mjs`'s own header comment (it already documents each placeholder inline — add
  `recentTrend`'s to the same block).

---

## R4 — rebase `reachMargin.trend`; wire `reachMargin` into scan + digest

**Directly answers the mandate's literal ask** ("a recency-weighted `reachMargin`-style primitive for
the whole app") and is LOW RISK: `reachMargin`'s existing consumers (`askExitRead`, quote-items,
`/positions`) already treat `trend` as an opaque `fading`/`stable`/`extending` label — swapping the
derivation from mean-of-halves to `projectTrajectory(days, cushionOf).dir` changes ONLY where the
label comes from, not what callers do with it.

**What changes:**
- `js/windowread.mjs`'s `reachMargin(days, side, level, opts)`: replace the `cushionFrom`/`cushionTo`
  mean-of-halves block with `projectTrajectory(all.map(...), d => d.cushion)` (using the SAME `all`
  array `reachMargin` already builds from `extremeOf`/`cushionOf`) and map its `dir` to
  `fading`/`stable`/`extending` (`falling`→`fading`, `rising`→`extending`, `flat`→`stable`). Keep
  `cushionNow`/`pace`/`reachedRecent` fields untouched (the audit explicitly keeps these as
  already-recency-scoped, earns-its-keep signals).
- `pipeline/commands/screen-flip-niches.mjs`: `reachMargin` is currently NOT wired in at all (the
  audit's explicit callout — it's an `askExitRead`/quote-items/CLI-only signal today). Wire it into
  the digest row / scan display: fold the `ask`-side `reachMargin` read for the quoted sell level
  into `collectDigestRow`'s inputs (available for free — the screen already has `askExitRead`-style
  inputs computed for the survivor set per §4's "the read is FREE" note on `hourProfile`) and surface
  a `fading`/`stable`/`extending` token on the digest row, informing (not replacing) the existing
  `reachFrac` ✓/✗ column.

### Test additions (R4)
- Re-run `reachMargin`'s existing fixtures (godsword/mask pair) through the rebased `trend` field —
  assert the NEW slope-based read agrees with (or explains a difference from) the old mean-of-halves
  read on those two anchor cases; a disagreement must be investigated, not silently accepted.
- CORRECTED (2026-07-22, Fable+impl review): the earlier "least-squares is robust to a single volatile
  END day" claim here was WRONG — OLS gives the window ENDPOINTS *maximum* leverage (∝ x−x̄), so a boundary
  outlier swings the fitted slope MORE than a coarse half-mean, not less (verified: `[10,10,10,10,10,50]`
  → fitted Δ ≈ +28.6 vs half-mean Δ = +13.3). Do NOT cite single-end-day robustness anywhere. The rebase's
  REAL merits are: CONSOLIDATION (the one shared `projectTrajectory` primitive, this plan's mandate), a fit
  over ALL days by recency-position (vs the old oldest-3-vs-newest-3 bucket diff that discarded the middle
  day(s)), and the R5 unblock. Test what's TRUE: the rebased `trend` tracks a genuine multi-day fade THROUGH
  a mid-window spike (mid-window leverage ≈0), and `cushionSlope < 0` on a real decline — NOT an end-outlier
  invariant. (This matters downstream: R5's sell-fold reuses this slope, so a future reader must not trust
  the wrong claim and be surprised by an ask-side cushion trend reacting to a single stale-tick print at "today".)
- A digest-row fixture asserting the new `reachMargin` token appears on scan output and is absent
  (not a crash) when the ask-side read has too few days.

### Docs to update (R4)
- `docs/MARKET-ANALYSIS.md`'s reach/reachMargin section — note it's now scan+digest-visible, not
  quote/positions-only.
- `docs/SIGNAL-AUDIT.md` §2 Tier-3 #9 — mark fixed.

---

## R5 — trend-aware discount in `estimatePair`'s sell-top fold + the digest mirage rule

**This is the literal Est.-sell-mirage fix** (the Searing-page "+7.3%" reaching p100/never-prints
anchor, and this session's bludgeon incident: an optimistic reach fold + a near-stale live tick
stacking into an inflated exit). Today `estimatePair` never even looks at `reachMargin` — it folds
purely off the POINT-IN-TIME `askReach` fraction (`reachRead` in `js/estimators/pair.mjs`), so a
reach that is 3/3 today but was 1/3 last week and heading for 0/3 next week folds toward the full
band top exactly as confidently as a genuinely stable 3/3.

**What changes:**
- `js/estimators/pair.mjs` / `js/estimators/sell-models/reach-fold.mjs`: the neutral reach-fold model
  gains a companion trend input — when the ask-side `reachMargin.trend` (now slope-based, from R4) is
  `fading`, tighten the fold's ceiling (e.g. reduce the fold-factor's saturation point, or clamp
  `sellHi` down from `topRef` toward `bandTop`+a smaller margin) EVEN WHEN the raw reach fraction
  reads clean. This must be additive to the existing fold math (never removes the existing
  `askReachFactor`/relief discount), gated on `reachMargin` actually being available (absent →
  byte-identical to today, the repo's standard absent-degrade-to-1 precedent).
- `pipeline/commands/screen-flip-niches.mjs`'s `digestVerdict`/`digestReachAndPlacement`: add the
  recent-vs-full `placement()` divergence (mirrors RC1's `recencySplit` idiom, applied to the
  whole-window CDF instead of raw hit-counts) as a SECOND confirming signal alongside the existing
  `reachFrac` check in the `mirage top` rule — fire "mirage top" with HIGH confidence when placement
  diverges recent-vs-full AND the trend sign (from R4's rebased `reachMargin` / R1's
  `projectTrajectory`) is falling; either alone stays the current caution-only behavior (do not widen
  the blast radius of what already fires "mirage top" without evidence this doesn't over-fire).

### Test additions (R5)
- The literal Searing-page/bludgeon anchor shape reproduced as a fixture: reach 3/3 clean, cushion
  trend fading — assert the Est-sell fold is now measurably tighter than the point-in-time-only fold,
  and the digest verdict escalates appropriately.
- A genuinely stable 3/3 reach with a stable/extending cushion trend — assert NOTHING changes (the
  byte-identity regression guard: this chunk must not discount a clean read).
- Screen `--digest` acceptance run (frozen snapshot) diffing verdict words before/after — review any
  row whose verdict token changed.

### Docs to update (R5)
- `docs/MARKET-ANALYSIS.md`'s Est.-sell / digest sections.
- `docs/SIGNAL-AUDIT.md` §2 Tier-1 #2 and §4's estimatePair bullet — mark fixed.

---

## R6 — retire `trajectoryRead`'s printed shape label

Cut the redundant, weaker, sometimes-contradicting note: `trajectoryRead`'s blended-mid
rising/falling/oscillating/based/elevated shape label is superseded by `floorCeilingTrack`'s (now
`projectTrajectory`-backed) classification, which uses the SAME inputs and is strictly richer
(independent floor/ceiling tracks + a discrete break + duration, vs one blended-mid thirds-mean
drift). `trajectoryRead`'s UNIQUE fields — `floor`/`ceiling`/`livePos` — are not redundant (nothing
else computes `livePos`) and ride along in the combined note.

**What changes:**
- `js/windowread.mjs`: `trajectoryRead` keeps existing (it's a small, cheap, still-correct function;
  no need to delete the code) but its `shape` field is no longer PRINTED — `quote-items.mjs` and
  `read-window-range.mjs --profile` stop emitting the `trajectory` note's shape line, keeping only the
  floor/ceiling/livePos parts, folded into the SAME line as `floorCeilingTrack`'s note (one combined
  note per pass, not two that can visibly disagree).
- `formatFloorCeiling` (or a new combined formatter) gains the `livePos` field so the one surviving
  note carries everything both notes used to say.

### Test additions (R6)
- Snapshot the combined note's rendered string for the fixture set already used by
  `formatFloorCeiling`'s tests, with `livePos` folded in.

### Docs to update (R6)
- `docs/SIGNAL-AUDIT.md` §3's "is it fading" cluster table — mark `trajectoryRead`'s shape label
  retired, pointer to the landing commit.
- `js/windowread.mjs`'s `trajectoryRead` header comment — note the shape field is now internal/unused
  by any printed surface (kept for any future programmatic consumer, not deleted outright).

---

## R7 — `cappedBy` field on the screen row

Legibility fix, not a correctness fix (explicitly called out as such in the audit). Five independent
grade ceilings exist (`THIN_GRADE_CAP`, `REACH_GRADE_CAP`, `SUBFLOOR_GRADE_CAP`,
`PHASE_BASING_GRADE_CAP`, the churn/amplitude fold-exemption) applied via the same `capGrade` helper
at different call sites in `screen-flip-niches.mjs` + inside `rateItem` (rating.mjs). Add one
`cappedBy` string field (naming which cap bound the printed letter, or `null`) alongside the existing
per-cap `title` tooltips, computed at the point each `capGrade` call is made (track which cap, if
any, actually changed the grade — the LAST one to bind wins if more than one would apply, matching
today's sequential-application order).

### Test additions (R7)
- One fixture per existing cap (thin/reach/subfloor/phase-basing/none) asserting `cappedBy` names the
  right cap or `null`.

### Docs to update (R7)
- `docs/MARKET-ANALYSIS.md`'s grade/cap section — document the new field.

---

## R8 — DE1/DE6 depth pricing + Extension-B pressure/demand: decide and document the fate

Not a code chunk by default — a DECISION chunk. `depthDays`/`clearableAsk`/`clearableBid` (DE1/DE6)
and `demandRegime`/`hourlyPressure`/`reachableBand` (Extension B) are fully-built, fixture-tested,
and power only inspector-only surfaces (`read-window-range.mjs --depth`/`--pressure`) — neither
feeds a main decision surface today. Ben needs to choose one of:
1. **Graduate DE4** (the originally-staged consumer: fold depth-based pricing into `estimatePair`'s
   held-lot sell) — if chosen, this becomes a real code chunk with its own spec (see
   `PLAN-DEPTH-EXIT.md`'s DE4 stub, which already scopes this).
2. **Mark both explicitly shelved** in `PLAN.md`'s Discovered/decisions list, so they stop reading as
   "still coming" indefinitely, with a one-line pointer to why (inert relative to main surfaces,
   `--depth`/`--pressure` remain useful manual inspectors, no plan to promote further absent new
   evidence).

Either way, this chunk's job is to STOP the ambiguity, not necessarily to write new pricing code.

### Docs to update (R8)
- `PLAN.md`'s Discovered list or Status table (whichever the decision implies).
- `docs/SIGNAL-AUDIT.md`'s "Dead / never-promoted signals worth naming honestly" section — mark
  resolved either way.

---

## Risk / validation

**Where a rewire could change which rows the screen admits or which grade they get (the real
regression surface):**

- **R2 (regimeDrift → projectTrajectory) is the highest-risk chunk in this plan.** It changes
  `row.falling`, which feeds the falling-exclusion GATE (`surviveMode` in
  `pipeline/lib/gatecandidates.mjs` — band/churn/value EXCLUDE fallers by default) — some rows that
  clear the screen today will not, and vice versa. It ALSO changes `regimeFactor`'s multiplier on
  EVERY graded row (not just fallers), so grades can shift even for rows whose admit/exclude status
  is unchanged. **Required before landing:** an acceptance-fixture diff run (frozen archive snapshot,
  the same discipline `checks.yml`'s quotecore/reconstruct acceptance fixtures already use) comparing
  the full row set + grades before/after, with a MANUAL review of every diffed row (not just a count)
  — this is the chunk that most needs the "attended, reviewed" treatment CLAUDE.md already expects
  for any gate change.
- **R3 (floorValidator trend gate) is a real gate change on the value niche specifically** (the buy
  gate `floorValidator` runs in GATE mode for). Because it's additive (a caution/reject BUMP, never an
  independent override of a clean pass with headroom), the blast radius should be narrow, but any
  value-mode candidate that was a clean pass and becomes a caution/reject needs the same
  acceptance-fixture review as R2, scoped to `--mode value`.
- **R4/R5/R6/R7 are inform-only or display-only** — they change NOTES, digest tokens, and a price
  FOLD (which affects the printed Est.-sell number and hence rank/capEff ordering within the digest's
  own display sort, but not the screen's own `rank` sort or `screen.json`'s published grade/price —
  `estimatePair` stays console/stdout-only per its own header). Regression risk here is "a printed
  number changes and looks surprising," not "a row disappears from the screen" — still worth a
  before/after diff, but not the same review bar as R2/R3.
- **R8 has zero regression risk** by construction (it's a decision + doc chunk unless Ben chooses to
  graduate DE4, at which point it inherits `PLAN-DEPTH-EXIT.md`'s own risk analysis).

**Calibration placeholders the audit flagged, and whether they should be F1-gated rather than set
now:**
- `FC_FLAT_FRAC` (0.005, the |slope|/latest-per-day band that separates `flat` from `rising`/
  `falling`) — inherited unchanged by `projectTrajectory` from `floorCeilingTrack`; every NEW consumer
  (R2's regime classification, R3's floor trend gate, R4's cushion trend) rides the SAME constant
  rather than inventing a per-consumer threshold. **Recommend: keep it F1-gated as a single shared
  constant** — tuning it per-consumer before any of them has a track record would fragment the one
  placeholder into several unvalidated ones, the opposite of this plan's consolidation goal.
- `MARGIN_FADE_FRAC` (0.003, `reachMargin`'s old fading/stable/extending threshold) — R4 REPLACES the
  mean-of-halves math this constant gated, so it either gets renamed/repurposed as the new
  `dir`-vs-`flat` threshold (in which case it should simply become an alias for `FC_FLAT_FRAC`, per
  the same "one shared constant" logic above) or retired outright if `projectTrajectory`'s own
  `flatFrac` fully replaces its job. **Decide in R4's implementing PR; do not carry two separately-
  tuned flat-bands for what becomes the same underlying slope test.**
- Every OTHER named placeholder touched by this plan (`FLOOR_CAUTION_RANGES`/`FLOOR_REJECT_RANGES` in
  R3, `MIRAGE_PLACEMENT`/`MIRAGE_REACH_FRAC` in R5, the grade cutoffs `REACH_GRADE_CAP_FRAC` etc.)
  stays exactly as unvalidated as it is today — this plan does not tune any cutoff, it only changes
  which INPUT feeds an existing cutoff (a slope/classification instead of a mean-of-halves or a
  single delta). **No new calibration decision is needed FROM Ben before coding starts**; the one
  open call is the R2 `crash-risk`/`healthy-trend`/… → `flat`/`rising`/`falling` MAPPING TABLE (name
  it explicitly in the code, Ben-vetoable at review time, not a blocking pre-decision) and the R4
  `MARGIN_FADE_FRAC`/`FC_FLAT_FRAC` consolidation call above.

---

## Recommended first PR

**R1 (the primitive + the `floorCeilingTrack` refactor + the `read-trajectory` CLI), landing alone,
proven byte-identical against `floorCeilingTrack`'s existing fixtures before anything depends on it.**
This gives Ben the `read-trajectory` CLI immediately (his explicit ask) and unblocks R2/R3/R4 as
parallel lanes once it's in. **R2 (regimeDrift rewire) is the recommended SECOND landing** — per the
audit's "single highest-leverage recommendation," it is the most consequential stale-read in the repo
by reach (gates screen inclusion, feeds every graded row's regime factor) and the better primitive
already exists; shipping it right after R1 turns the foundation chunk into a real fix fast, rather
than leaving the primitive unused while other, lower-leverage chunks land first. R3 can run in
parallel with R2 (disjoint files, both depend only on R1). R4→R5 follow in sequence; R6 waits on R2;
R7/R8 are independent and can land whenever.
