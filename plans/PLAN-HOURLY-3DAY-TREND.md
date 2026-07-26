# PLAN-HOURLY-3DAY-TREND — the per-hour day-over-day drift read, in the core flow

**One-line:** surface, at every price-recommendation surface, the day-over-day slope of each
hour-of-day's price over the last N (default 3) days — the signal the 14-day aggregate profile
*hides* — so a staircase-down item is never recommended as a "dip / fill-now" without the drift in
front of it.

## Context / diagnosis (why this exists)

The trio (`quote` + `read-window-range --profile` + the reach/placement notes) collapses the day
dimension. `--profile` aggregates 14 days into ONE low/high per hour-of-day; the reach validators
count "ask reached X/14d" over that same collapsed window. Both read *bullish on a falling item*,
because the reach was earned days ago when the price was higher.

**The anchor (2026-07-24, live):** Ghrazi rapier graded **A- fill-now**, ask 25.3m "reached 14/14d,
recent 3/3". The manual `--hourly --days 3` pull showed the truth — the MID at *every* hour stepping
down ~650k–1m/day (07-22 → 07-23 → 07-24), and today's hourly *highs* already decayed below 25.3m by
midday, i.e. the ask had **stopped clearing intraday**. Same shape as the Primordial boots guide
staircase we fought out of. The data existed (`hourlyLMH` already builds the 3-day grid) but (a) it
was behind a flag nobody runs pre-recommendation, and (b) it prints raw columns — the day-over-day
*trend* is left for the human to eyeball. This plan computes the trend and puts it in the flow.

**This is the "predict the guide step-down" capability** Ben asked for after the boots exit — the
guide steps down *because* each hour's realized price is stepping down; read the hours and you see
it coming a day early.

## Rulings (owner decisions, 2026-07-24)

1. **It must appear anywhere we make a price recommendation, BEFORE the recommendation** — not as an
   opt-in flag. Concretely: held positions, watched items, reverse-flip owned items (fold into
   PLAN-REVERSE-FLIP), and the **top-X scan picks** (before they print as graded recommendations).
2. **Where the "before we recommend" check fits (Ben handed this design call back):** as a **bounded
   post-ranking enrichment stage on the top-X survivors only**, NOT the full candidate universe —
   see [Design decision D1](#design-decision-d1--where-the-pre-recommendation-check-fits). The per-item
   1h fetch is too heavy to run on all ~70 scanned items, and the signal only matters for the handful
   we're about to price-recommend.
3. **It informs, it does not auto-veto** (reconciles with the falling-exclusion-AMENDED doctrine —
   memory `falling-exclusion-amended`). A falling drift is a WARNING on a fill-now/band pick (where
   you pay near live expecting a quick clear); on a deliberate value / dip-accumulation / reverse-flip
   thesis, falling is the *expected* shape and the note is pure inform. Strategy-aware, never a global
   exclusion.
4. **Visible swap, not silent gate** (memory `gate-on-error-cost-not-n`): the read is cheap, visible,
   and decision-moving, so it ships ON — and when a strong drift changes a displayed verdict label
   (fill-now → ⚠ falling-verify), it shows the drift number that caused the change inline. No silent
   downgrade.
5. **Honest placeholder throughout** — n≈0, inform-only, heuristic. It never gates a gate, never moves
   a quoted number, never feeds a cut/alert input. It frames.

## The core signal (what "drift" is, precisely)

For each local hour-of-day h ∈ 0..23, over the last N (default 3) local dates:
- take that date's MID at h (`round((avgHigh+avgLow)/2)`, the same midOf `hourlyLMH` already uses),
- fit a **per-day slope** across the N points (least-squares over the N dates; degrade to
  `(newest − oldest)/(N−1)` when <3 points, null when <2),
- that hour's `driftPerDay` (gp/day) + direction (`up`/`down`/`flat`, flat = |slope| under a small
  % epsilon of the level).

Then a **whole-item synthesis** over the 24 per-hour slopes:
- dominant direction + magnitude (median of the per-hour slopes),
- **uniformity**: are all hours moving the same way (`uniform step-down`), or is it split
  (`mornings −800k/d, evenings flat`)? Uniformity is the difference between a real regime step and
  intraday noise — a uniform down-drift across every hour is the boots/rapier falling-knife tell.

**Derived sub-signal — ask-reachability decay** (the rapier catch, the highest-value part): given a
candidate ask level, for each of the last N days count how many hours that day's hourly HIGH reached
the ask, and report whether that per-day reach-count is *falling*. `ask 25.3m: reached 18h→11h→4h of
the day (decaying) — no longer clearing midday` is the line that would have killed the rapier
recommendation outright.

## Design decision D1 — where the pre-recommendation check fits

**Answer to Ben's question.** Every surface that emits a price recommendation calls the SAME shared
read (`hourlyDrift` + the shared note renderer). They differ only in *which items* they run it on:

| Surface | Items it runs on | Fetch cost |
| --- | --- | --- |
| `quote-items` (bare + `--positions`) | the quoted item(s) — already fetches the 1h series for `--profile`/diurnal | **zero extra** (reuses the in-hand series) |
| `--positions` held / watched | every held lot + watchlist member | zero extra (already quoted) |
| reverse-flip owned items (RF2/RF4) | each reverse-flip candidate | reuses RF2's per-candidate series |
| **`screen-flip-niches` scan** | **the top-X digest picks ONLY**, after ranking | bounded: ≤X extra 1h fetches (or reuse if the ranker already pulled them) |

The scan is the one that needs the explicit gating, and the ruling is: **enrich the top-X survivors,
not the candidate universe.** The scan ranks ~70 candidates on cheap fields; the 1h-series drift read
is heavy, and it only matters for the ≤10 items about to be printed as recommendations. So it's a
final enrichment pass on the digest rows, between ranking and printing — the literal "before we
recommend it" seam. X = the digest length (already bounded, ~8–12). This keeps the scan's fetch
budget flat while guaranteeing no graded recommendation prints without its drift read attached.

## Existing scaffolding (build on, not around)

- **`pipeline/lib/hourly-lmh.mjs`** already builds the per-hour × per-day MID grid (`hourlyLMH`) off
  an already-fetched 1h series, LOCAL-hour bucketed, pure, n≈0. The drift computation is a fold over
  its `hours[].perDay[].mid` — a sibling export in the same module, not a new fetch or a new grid.
- **`js/windowread.mjs`** is where the shared diurnal notes live (`hourProfile`, `formatFloorCeiling`,
  `softBuyRead`) and where `quote-items --positions` + `read-window-range` both render from ONE
  definition. The compact drift note renderer belongs here beside them.
- **The note-family plumbing** in `quote-items.mjs` (the `notes` section, kinds `diurnal`/`softBuy`/
  `windowExit`/`fcTrack`) is exactly the slot the compact line drops into — same gating as the
  `windowExit` note (held / watched / big-ticket) already uses.
- **`read-window-range.mjs --hourly`** already prints the raw grid; it gets the drift column + summary
  line, so the detailed view and the compact note share the primitive.

## Staged chunks

Dependency: HT0 is the root; HT1/HT2 depend on HT0; HT3 depends on HT0+HT2; HT4 coordinates with
PLAN-REVERSE-FLIP RF2/RF4; HT5 is the doc/version pass that lands with each chunk (not a trailer).

### HT0 — `hourlyDrift` primitive (pure, fixture-pinned)
- New export in `pipeline/lib/hourly-lmh.mjs`: `hourlyDrift(series1h, { days = 3, ask = null })` →
  `{ perHour:[{h, driftPerDay, dir}|null …], dominant:{dir, magPerDay, uniform:bool, split?:string},
  askReach:{perDay:[{date, hoursReached}], decaying:bool}|null }`. Reuses the same bucketing as
  `hourlyLMH` (factor the byKey/date logic into one shared internal). Null-degrades on <2 dates.
- Least-squares slope helper; flat-epsilon as a % of the hour's level (placeholder, e.g. 0.3%/day).
- Fixture test in `pipeline/ci/` (or the existing hourly-lmh fixture): a synthetic uniform-down
  series → `uniform` down; a mixed series → `split`; a flat series → flat; the ask-decay case.
- INFORM-ONLY, n≈0 header comment — mirrors `hourlyLMH`'s.

### HT1 — `--hourly` gets the drift column + summary
- `read-window-range.mjs --hourly` output: add a per-hour `Δ/d` column (right of the per-day cells)
  and a summary line under the table (`dominant: uniform step-down ~800k/d · ask 25.3m reach decaying
  18h→11h→4h`). Pure render off HT0. Keep the raw grid unchanged above it.

### HT2 — the compact folded note (the core-flow insertion)
- `js/windowread.mjs`: `hourlyDriftNote(drift, { ask })` → one line, e.g.
  `↕ 3-day hourly drift: uniform step-down ~800k/d · ask 25.3m no longer clears midday (reach 18h→11h→4h)`
  or on a benign item `↕ 3-day hourly drift: flat (±120k/d, mixed)`.
- Wire into `quote-items.mjs` notes as kind `hourlyDrift`, gated to **held + watched** (positions),
  same predicate the `windowExit` note uses. Auto-surfaced, no flag.
- On a bare `quote-items "<item>"` (a price recommendation on a fresh candidate — Ben's "anywhere we
  make a price recommendation"): surface it too when an ask/bid recommendation is being emitted.

### HT3 — scan pre-recommendation enrichment (top-X only)
- `screen-flip-niches.mjs`: after ranking, before printing the digest, run `hourlyDrift` on each
  top-X pick (reuse the 1h series if the ranker fetched it; else a bounded ≤X fetch). Attach the
  compact drift note to each digest row.
- **Strategy-aware label adjustment (Ruling 3+4):** a *uniform* down-drift beyond a threshold on a
  **fill-now / band / churn** pick flips its verdict label to `⚠ falling — verify` and prints the
  drift number inline (visible swap). A **value / invest / dip / reverse-flip** pick is NOT relabelled
  — falling is its thesis; the note stays pure inform. Threshold is a placeholder, documented as such.
- This is the seam that would have printed the rapier as `⚠ falling ~800k/d — verify` instead of
  `A- fill-now`.

### HT4 — reverse-flip fold (coordinate with PLAN-REVERSE-FLIP)
- The reverse-flip candidate surfacing (RF2's `--mode reverse` table; RF4's `/schedule`·`/book`·
  `/positions` rows) carries the same `hourlyDriftNote` on each candidate. Selling an owned item at a
  "peak" into a *falling* hourly regime is the same trap inverted — and a *rising* hourly drift is the
  reverse-flip's own BAD signal (Rulings §Regime asymmetry in PLAN-REVERSE-FLIP). Shared note module
  (HT2), no new compute. Add a one-line cross-reference in PLAN-REVERSE-FLIP RF2/RF4.

### HT5 — docs + registry + version (lands with each chunk, not a trailer)
- **README** inventory: new `hourlyDrift` export documented on the `pipeline/lib/hourly-lmh.mjs` entry
  (purpose, producer/consumer). No new file, so no new registry row — an updated contract on an
  existing one.
- **docs/MARKET-ANALYSIS.md**: the 3-day hourly drift read as a pre-recommendation validator (inform,
  strategy-aware, the ask-reachability-decay catch); slot it in the timing section beside the diurnal
  profile.
- **docs/GLOSSARY.md**: "hourly drift" / "ask-reachability decay" terms.
- **CLAUDE.md**: a Done pointer + the drift read named in the market-analysis workflow (the
  `read-trajectory` / diurnal row).
- **Version**: pipeline-stdout + `js/windowread.mjs` change. If the app renders it, bump `APP_VERSION`;
  if it stays pipeline/console-only, ship without an app bump (noted in the commit) per process rule 5.

## Encoding boundary

| Concern | Encoded (script) | Judgment (Ben/agent) |
| --- | --- | --- |
| per-hour day-over-day slope + uniformity | ✅ HT0 | — |
| ask-reachability decay count | ✅ HT0 | — |
| flip a fill-now label on uniform down-drift | ✅ HT3 (strategy-scoped) | whether to still enter (deep-bid optionality, a value thesis) |
| whether falling = bad | — | ✅ per-strategy, per Ruling 3 (never global) |
| the drift threshold / flat-epsilon | placeholder constants | ✅ recalibrate when a retro has n |

## Honest placeholders
- n≈0 everywhere; the slope is 3 points by default — a trend read, not a forecast. It says "this hour
  has been stepping down", not "it will continue".
- Thresholds (flat-epsilon, the label-flip magnitude) are PLACEHOLDERS pending F1-style retro
  calibration. The read ships ON as *description* (per memory `f1-gates-decisions-not-description`);
  only the label-flip magnitude is a decision-mover and it's shown-not-hidden (Ruling 4).
- Ask-reachability decay assumes the hourly HIGH is a fair proxy for "would my ask clear that hour" —
  true for a liquid item, optimistic for a thin one (a printed high ≠ a fill). Noted at the surface.
