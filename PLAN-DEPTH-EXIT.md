# PLAN-DEPTH-EXIT — percentile-depth-aware exit pricing (the reach count's principled successor)

Status: **DRAFT — scoping only, nothing implemented.** Per-topic working doc (PLANNING.md lifecycle
step 1–2); folds into `PLAN.md` and is deleted when its last chunk ships. Builds ON TOP of the
uncommitted Task 1+2 baseline in the working tree (real held-lot `intendedUnits` → `reachRelief`
in `estimatePair` + the watch-positions size-relieved fill note) — that baseline is the CURRENT
state this plan supersedes, not the shipped `row.limit` proxy.

## Problem / motivation (the soul-rune anchor)

Exit-price confidence on a held lot is priced by two PROXIES today, and both answer the wrong
question:

1. **The binary reach COUNT** — `reachedDays(his, ask)/N` (`js/windowread.mjs:31`, consumed by
   `watch-positions.mjs`'s window line and `read-window-range.mjs`): "on how many of the last N
   days did the 1h-average window high print ≥ my ask." It measures how OFTEN the top prints —
   a day where one 1h bucket grazed the ask with 40 units counts the same as a day where 900k
   units crossed above it. It never sees whether MY size clears.
2. **`reachRelief`** (`js/estimators.mjs:133`, PLAN-LIQUIDITY-REACH): softens the reach discount
   when the book is liquid AND `sizeRatio = intendedUnits ÷ volDay` is small. Directionally right
   (depth ∝ volume), but the denominator is WHOLE-DAY limiting-side volume — it never looks at how
   much volume actually trades AT OR ABOVE the candidate ask. It's a shape-only heuristic (n=1,
   all constants placeholders) bolted onto the count it distrusts.

**The anchor (soul-rune desk investigation, this session):** a 25k lot on a ~10.6m/d book reads
"ask reached 2/7d" — the count says "rarely." But summing the instabuy volume that printed at/above
that ask per day, the cumulative depth clears the whole 25k lot (even allowing a multiple for
competing sellers) on **~87% of days**. The count and the truth point opposite directions, and the
gap is exactly the quantity neither proxy measures: **volume at the price percentile of the ask.**

**The real model Ben wants:** given the volume-by-price distribution over the sell window and the
held lot size, find the highest ask where cumulative volume above it is enough to clear the lot
(with a competition allowance), and price the exit there — potentially ABOVE the naive band top
when depth supports it. This SUBSUMES both proxies: the reach count is the degenerate lot-size→0
case (see DE1's pinned invariant), and reachRelief's size÷flow intuition becomes a measured
size÷depth-at-price statistic instead of a whole-day ratio.

## Data-availability analysis (the crux — what the wiki actually exposes)

There is **NO order book and NO price→volume histogram** in the wiki API. Per bucket (5m / 1h;
/24h is broken — memory `vol24-endpoint-broken`, corrected source is composed 24×/1h) we get:
`avgHighPrice` (volume-weighted AVERAGE of instabuy prints in the bucket — not the tick max),
`highPriceVolume` (unit count of those prints), and the low-side twins. ~15d of 1h, ~30h of 5m.

**What IS reconstructible.** Treat each bucket as a point mass: `highPriceVolume` units at price
`avgHighPrice`. Across a day's buckets that yields an empirical **trade-price-vs-volume
distribution of the instabuy flow** — exactly the flow a resting ask fills against. From it,
`depthAbove_d(P) = Σ highPriceVolume over buckets with avgHighPrice ≥ P` is a per-day estimate of
"units that transacted at/above P." This is a REAL estimator of the quantity we want, from data
already in hand on every 1h-fetching surface (zero new fetch).

**What is NOT recoverable, and the error structure (be honest about the sign of each bias):**

- **Tail truncation (bias: depth UNDER-stated at high P — conservative, guard-friendly).** A
  bucket averaging 396 whose true prints included 400s attributes zero volume above 396. Volume
  above the highest bucket AVERAGE is invisible. So `depthAbove` is biased LOW near the true tick
  ceiling — the model will under-price the extreme top, never hallucinate depth above it. This is
  the same averaging bias Part B/`dayHighFrom5m` documents; here it works FOR us.
- **Within-bucket misattribution (bias: depth OVER-stated just BELOW a bucket average — the ONE
  dangerous direction).** That same 396-average bucket (half 400s, half 392s) attributes ALL its
  volume to ≥ 394 when only half really printed there. An ask sitting just under a fat bucket's
  average can see inflated depth. Mitigations (all in DE1): require multi-bucket support (a
  minimum number of distinct buckets at/above the candidate ask, not one fat one); prefer the 5m
  grain where held (12× less averaging; the archive accrues bulk 5m — see DE5); and the
  competition multiplier absorbs residual optimism.
- **Competition is unobservable.** Printed volume at ≥ P cleared through ALL resting asks ≤ P at
  the time — our share of that depth is unknowable from this data. Modeled as a placeholder
  multiplier (below), calibratable ONLY by the F1 retro-join (did depth-priced asks actually
  fill?). No pretending otherwise.
- **Endogeneity.** The distribution was printed WITHOUT our 25k sitting in it; adding size can
  move the clearing price. Second-order when qty ≪ depth (the same regime reachRelief's size gate
  already polices); the competition multiplier and a retained absolute-volume floor bound it.
- **Sample size.** ~14 day-samples per item on the 1h grain; every day-fraction has n≈14 (rule 4).
  Recent-vs-full contamination applies exactly as it does to reach — the `recencySplit` idiom
  must ride along, not be reinvented.

**Verdict on feasibility: the ideal (tick-level percentile depth) is NOT estimable; a
bucket-average depth-above curve IS, with a known conservative bias at the top and one known
optimistic bias just under fat buckets, both mitigable.** That estimator is strictly more
informative than either existing proxy and uses the same fetches. Build on it.

## Proposed model

All pure, in `js/windowread.mjs` (it owns window/day bucketing; `windowClear` at line 170 is the
direct ancestor — its `pool` is "median TOTAL window volHi on reached days," which this replaces
with volume at-or-above the ask). Names provisional:

- **`depthDays(series, ask, { qty, competition, wStart, wEnd, nights, now })`** → per-day
  `depthAbove_d(ask)` + `clearedDays` = # days where `depthAbove_d(ask) ≥ competition × qty`,
  + `clearFrac = clearedDays / N`, + recent-N split. A day "clears" when the flow at/above the ask
  could absorb the lot `competition`-times over.
  - **Pinned invariant (the subsumption proof):** with `qty → 0` (require `depthAbove_d > 0`),
    `clearedDays` ≡ `reachedDays(his, ask)` exactly — a bucket avgHigh ≥ ask exists iff the day's
    window max ≥ ask. The reach count IS this model's zero-size limit; fixture-pin it.
- **`clearableAsk(series, { qty, competition, targetFrac, minBuckets, ... })`** → the HIGHEST ask
  P with `clearFrac(P) ≥ targetFrac` AND ≥ `minBuckets` distinct supporting buckets at/above P
  (the misattribution guard). Candidate levels = the distinct bucket `avgHighPrice` values (the
  only prices carrying information — no interpolation between them, that would invent data).
  Monotone non-increasing in `qty`, `competition`, and `targetFrac` (assert in tests).
- **Competition/pool-share factor:** `DEPTH_COMPETITION_MULT` (propose **4** — "the flow must
  absorb four of me"; NAMED PLACEHOLDER, n=0, Ben-accepted 2026-07-15 conditional on the surfacing
  below; F1 owns it). Deliberately a multiplier on required depth, not a share percentage — same
  math, but it reads as a safety factor and degrades legibly.
  - **CONSEQUENCE — a flat multiplier IS a liquidity bias, and the model MUST surface it (Ben,
    2026-07-15).** Requiring flow ≥ `4 × qty` means a THIN book (whole-day flow under 4× your lot at
    every level) yields a collapsed/null depth read and falls back to reach/relief. This is correct
    for the mirage guard and honest for held-lot PRICING (a thin lot genuinely can't clear a big ask
    fast — the deflation is real), but it makes the depth model effectively a **LIQUID-CLASS tool**:
    it cannot rescue a thin item's buried edge, only surface liquid ones (the DE7 limitation below).
    **HARD REQUIREMENT (acceptance-pinned):** every collapsed/null read prints its REASON inline —
    `depth n/a — book absorbs <4× your Nk lot; reach fallback` — so the operator ALWAYS sees whether
    a number is a depth verdict or a fallback. A silent degrade is a defect, not an acceptable path.
- **Target fraction:** `DEPTH_TARGET_FRAC` (propose **0.75**, echoing `EST_REACH_SAT_FRAC`'s
  "reachable-enough" convention; PLACEHOLDER). The recent-3 split rides beside it: a full-window
  clear with a 0/3 recent clear gets the same ⚠stale treatment reach gets today.
- **Mirage-guard survival (must-hold, the Ancient-godsword protection):** the guard is now
  STRUCTURAL, not a bolt-on. A thin book has tiny `depthAbove` at every level, so `clearableAsk`
  collapses DOWN toward where the day's whole flow trades — at/below the band top, never above.
  The godsword-class 2/14 top fails `targetFrac` outright. Belt-and-braces degrades regardless:
  fewer than `DEPTH_MIN_DAYS` scored days, or volDay under an absolute floor, or qty ≥ the
  reachRelief size-zero ratio → return **null** → every caller keeps its CURRENT behavior
  (reach count + reachRelief). A thin book must never see an INFLATED exit; with this model it
  structurally sees a deflated one or no read at all. Fixture-pin the thin case byte-identical.
- **Ceiling:** never price above the observed data — `clearableAsk` cannot exceed the max bucket
  avgHigh by construction, and the rendered estimate stays capped at `dayHighFrom5m` (the real
  observed ceiling; "Soul rune won't sell at 500" stands).

## Relationship to existing code

- **`js/windowread.mjs`** — gains the two pure functions (additive exports; existing consumers
  byte-identical). `windowClear`'s pool/clearRatio stays for the within-window lap read; its
  header gains a pointer ("depth-at-price refinement: depthDays").
- **`js/estimators.mjs`** — `reachRelief` + the estimatePair relief fold are UNTOUCHED until DE4;
  they remain the degrade path when the depth read is null (thin data), and the discovery screen's
  buy-limit-proxy path stays theirs permanently (no held qty exists there; a full depth read per
  screen row would also cost the 1h fetch the screen only does for survivors). Long-term (post-F1)
  the held-lot relief fold is REPLACED by the depth-derived ask; reachRelief survives as the
  discovery-surface heuristic only. The de-bias Part B (`dayHighFrom5m` topRef) is subsumed on
  held lots — the depth model reads real levels directly.
- **Consumers:** `watch-positions.mjs` window line (replaces the Task-2 reliefSuffix note when the
  depth read is non-null), `quote-items.mjs --positions` (DE4), `read-window-range.mjs` (DE2, the
  inspection surface). `declaredExit` still governs everywhere it's set — a depth read informs,
  the operator's declared thesis anchors (unchanged contract).
- **Inform-only + F1-gated at first — YES (n≈0).** Phase 1 (DE1–DE3) never moves a price, verdict,
  or grade: it prints beside the reach line and shadow-logs to `suggestions.jsonl` so the
  retro-join can score "did the depth-priced ask fill, at what latency" against the relief-priced
  and reach-priced alternatives. Phase 2 (DE4) promotes it into `estimatePair`'s held-lot sell
  path only on that evidence.
- **App↔console parity:** shared math lives in `js/` (windowread) per the parity boundary; all
  consumers are console/pipeline → `screen.json` + the app untouched → **no APP_VERSION bump**
  (additive-export precedent: PF1's dispersion fields).

## Chunked implementation plan (PLANNING.md chunk rules; each carries its own docs pass)

- **DE1 — pure depth math + fixtures (LANDED 2026-07-15).** (`js/windowread.mjs` + `pipeline/test/
  windowread.test.mjs`.) `depthDays` + `clearableAsk` exported (`@provisional-api`, DE2/DE3 the
  tracked consumers); the `DEPTH_*` constants stay module-internal placeholders (greppable, surfaced
  via returns — promote to `export` when a cross-file consumer imports one). **Correction to the
  original acceptance sketch (honesty, rule 4):** `clearFrac ≤ reachFrac` ALWAYS — a day can only
  *clear* a level it *reached*, so depth is the strictly-CONSERVATIVE refinement of reach (that IS
  the mirage-safe property, not a bug). The five shipped fixtures: (1) qty→0 `clearedDays` ≡
  `reachedDays` (the reach count is the zero-size limit); (2) deep book + small size → `clearableAsk`
  books at the top tier, and the SAME book with a large lot books strictly lower (size-honest,
  monotone) — the soul-rune shape; (3) thin book / oversized lot → `null` with a surfaced `reason`
  (`insufficient-depth` / `thin-history`), never a silent null; (4) monotone (non-increasing) in
  qty/competition/targetFrac, and `clearFrac` monotone in the level; (5) minBuckets guard — a lone
  fat top-flier (1 supporting bucket < 2) cannot set the ask. No consumers touched — downstream
  byte-identical; console-only, no `APP_VERSION`.
- **DE2 — `read-window-range.mjs --depth <qty>` (LANDED 2026-07-15).** Prints the per-day instabuy
  flow at/above the scored `--ask`/`--exit` (clears qty×competition? per day) + the `clearableAsk`
  "BOOK AT ≤ X" line with `×comp · ≥N% of Md · ≥K buckets` stated inline; `clearableAsk` now echoes
  `targetFrac`/`minBuckets` in its return so the CLI states them without importing the consts. Every
  read carries the "estimate from bucket AVERAGES, not an order book · ×4 is a PLACEHOLDER n≈0"
  honesty line. Live-validated: **Soul rune 25k → BOOK AT ≤ 394** (398 clears only 2/14 — a thin
  percentile even on a deep book, the honest refinement of the reachRelief note's 87%); a small claws
  lot clears with size-honesty (100u books lower than 2u); an oversized lot → `NO clearable ask —
  the book can't absorb Nu … LIQUIDITY collapse, reach fallback` (the surfaced reason, never a bare
  null). Inform-only; no consumer of a price/verdict.
- **DE3 — watch-positions + shadow logging** (inform-only). The held-lot window line prefers the
  depth read ("clears 25k @ ≥396 on 6/7d (est, ×4 comp)") over the Task-2 reliefSuffix when
  non-null, and on a null read prints the collapse reason instead of silently keeping the old line;
  lean shadow fields (`depthAsk`, `clearFrac`, `depthCompetition`, `depthCollapse` reason +
  `liqClass`) ride `suggestions.jsonl` per the `estConfLean` absent-field pattern — so F1 can measure
  the predicted thin-null / liquidity bias by class. Acceptance: thin/absent-data lots render the
  reason line (never a bare fallback); a golden-fixture pass diffs the two paths.
- **DE4 — estimatePair held-lot integration (F1-GATED, flag-off).** Behind `--depth-exit` (or
  promoted by F1 evidence): on a held lot with a non-null depth read, the depth-derived ask
  replaces the relief-softened fold as the sell reference (BE floor, declaredExit anchor, and the
  qs clamp all unchanged). Acceptance: flag-off byte-identical everywhere; flag-on thin-book
  fixture byte-identical (the guard); flag-on soul-rune fixture lifts estSell toward clearableAsk,
  never above dayHighFrom5m.
- **DE5 — 5m-grain / archive refinement (DEFERRED, note-only).** The 1h grain is the v1 basis
  (~15d reach). Bulk 5m accrual in the Tier-1 SQLite archive (pipeline-v2 D0) is the route to
  multi-day 5m depth curves — sharper distributions, smaller misattribution bias. Not scheduled
  until the archive has weeks of 5m and DE3's shadow data says the model earns it.
- **DE6 — low-side symmetric `clearableBid` (Ben, 2026-07-15).** The mirror of DE1: `depthDaysLow`
  reads `lowPriceVolume` at `avgLowPrice` (instasell flow), and `clearableBid` = the LOWEST bid P
  with `clearFrac(P) ≥ targetFrac` — "how deep can I bid and still get filled." Same subsumption
  proof (qty→0 ≡ `touchedDays`), same structural mirage guard (a thin book's clearableBid collapses
  UP toward where flow trades, never below), same ceiling (never below the observed day low). This
  gives the TWO-SIDED size-aware band — a deep bid AND a high ask both priced off real depth — which
  is the honest version of the asym-fill (`asymEstimate`) deep-bid→high-ask shape. Consumers: DE2's
  `--depth` inspector prints both edges; `quote-items` / `watch-positions` read the two-sided band.
  Acceptance mirrors DE1 on the low side. Inform-only; no rank effect (that's DE7).
- **DE7 — discovery reranking (F1-GATED — the Q2 destination, Ben 2026-07-15).** This is the
  *point* of the two-sided depth band: today `reachRelief` (Part A/B) and `asymEstimate` already
  WIDEN the effective band on liquid items but are inform-only, so they never rerank the screen or
  admit new rows — a genuinely deep-book item whose real deep-bid→high-ask margin is being SHAVED by
  the p90/reach mirage guards stays buried. DE7 promotes the depth-derived two-sided band into the
  screen's `estimateRank`/grade so those items surface. HARD constraints: (a) F1-GATED — the mirage
  risk is precisely re-inflating the band on liquidity, so nothing reranks until the retro-join has
  scored depth-priced asks against real fills; (b) fetch budget — the screen fetches 1h only for
  gate SURVIVORS, so depth ranks survivors (admission stays on the cheap proxy) or the 1h fetch
  scope widens deliberately, a costed decision at DE7 time. Until then, `reachRelief` keeps the
  discovery surface (per the relationship note above). Acceptance: flag-off byte-identical
  `screen.json`; flag-on reranks a liquid deep-band fixture above a thin mirage without admitting
  the godsword-class row. **HONESTY (Ben, 2026-07-15): DE7 is a LIQUID-CLASS lever.** Because a thin
  book yields no depth read (the competition bar), depth reranking CANNOT rescue a thin item's buried
  edge — that burial is a separate problem (band's thin-path / the asym handling), NOT something DE7
  addresses. DE7's win is "stop shaving the LIQUID deep-band," not "surface everything."

Bookkeeping per chunk: README inventory (new exports noted in windowread's entry; this file is
untracked-working-doc, NOT inventoried), `docs/MARKET-ANALYSIS.md` §price reconciled at DE3/DE4
(the reach-fold paragraph must not stand contradicted), CLAUDE.md untouched until DE4 changes a
workflow mapping, `node --check` + `run-tests.mjs` + the smoke job green throughout.

## Open questions / honesty caveats (rule 4)

- **Every constant is a placeholder at n=0**: `DEPTH_COMPETITION_MULT` (4), `DEPTH_TARGET_FRAC`
  (0.75), `DEPTH_MIN_DAYS`, `minBuckets`, the absolute-volume floor. The soul-rune anchor is ONE
  item on ONE week. F1/retrojoin is the calibrator; DE3's shadow fields are built so it CAN be.
- **The competition multiplier is the model's soft spot** — it stands in for queue position,
  concurrent sellers, and within-bucket misattribution all at once. State it inline in every
  rendered line so no one reads the depth ask as a queue-cleared guarantee. Flag the value for
  Ben's veto at DE1. **Predicted bias to VALIDATE (Ben, 2026-07-15): a flat ×4 will systematically
  null thin-liquidity items and bias any depth-driven ranking toward high-liquidity ones.** DE3's
  shadow log must therefore record the collapse-REASON + liquidity class per read, so F1 can measure
  whether ×4 is nulling a class we'd want to price — and whether the multiplier should flex with
  size/class rather than stay flat (an open DE4/DE7-era calibration question, not a v1 change).
- **Within-bucket misattribution can overstate depth just under a fat bucket** — the one bias in
  the dangerous direction. minBuckets + competition + the dayHigh cap are mitigations, not proofs;
  DE3's realized-fill data is the only real test.
- **Whole-day vs sell-window first?** Proposed: whole-day (0–23) for v1 (matches how the anchor
  was computed and the held-lot "will it clear at all" question); window-scoped depth (the
  `windowClear` marriage) is a natural DE5-era refinement. Flagged as a deciding point.
- **Does depth replace reachRelief on DISCOVERY surfaces too?** For PRICING the est-sell cell, no —
  reachRelief (buy-limit proxy, no per-row 1h fetch) keeps that home. But for RANKING, yes: DE7 is
  the F1-gated destination where the two-sided depth band reranks the screen so liquid deep-band
  items currently shaved by the mirage guards surface (Ben's Q2). The open sub-question is the fetch
  budget — rank survivors on depth, or widen the 1h fetch scope (a costed DE7 decision).

## Recommendation

**Build it in two phases, split on the F1 gate.**

- **Phase 1 — buildable NOW, no F1 (DE1 → DE2 → DE3, + DE6).** The whole inform-only two-sided
  depth read: the pure math + fixtures (DE1), the `--depth` CLI inspector (DE2), the watch-positions
  line + shadow-logging (DE3), and the low-side `clearableBid` mirror (DE6 — cheap symmetric math
  off DE1's side-aware core). Nothing here moves a price, verdict, or grade; it renders beside the
  existing lines and shadow-logs depth-priced asks/bids to `suggestions.jsonl`. This phase is what
  FEEDS F1 the alternatives to score, so building it now shortens the gate rather than waiting on it.
- **Phase 2 — F1-gated (DE4, DE7).** Promote the depth read into `estimatePair`'s held-lot sell
  price (DE4) and into the screen rank / discovery rerank (DE7). Nothing here ships until the retro-
  join has scored real fills against the Phase-1 shadow log. DE5 (5m-grain) is deferred beyond both.

The current
baseline (reachRelief with real lot size) is a defensible stopgap but it is a shape-only heuristic
calibrated on n=1 that ignores the price dimension entirely; the depth model measures the actual
decision quantity from data every held-lot surface already fetches (zero new cost), its dominant
bias is conservative at exactly the top-of-band prices where inflation would hurt, and its
degenerate case reproduces the reach count so the migration is provable rather than a leap.
The thin-book mirage guard comes out STRONGER, not preserved-by-exception. What it must NOT do is
skip the inform-only apprenticeship: no price/verdict/grade moves off it until the F1 retro-join
has scored real fills against it.

The **two-sided extension (DE6 → DE7, Ben's Q2)** is the strategic destination: `clearableAsk` +
`clearableBid` give the real size-aware band, and promoting it into the screen rank (DE7) surfaces
the liquid deep-band items whose margin the mirage guards currently shave. DE6 is cheap and
inform-only (a low-side mirror of math already built); DE7 is the reranking payoff and is
F1-GATED for the same reason DE4 is — widening the effective band on liquidity is exactly where an
uncalibrated model re-introduces mirages. So the whole "surface more, book higher" upside converges
on the SAME gate: **F1.** DE1–DE3 + DE6's inform lines are what feed F1 the depth-priced
alternatives to score, so building the inform phase now shortens, not competes with, that gate.
