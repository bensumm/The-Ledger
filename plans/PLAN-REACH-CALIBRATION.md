# PLAN-REACH-CALIBRATION — true achievable buy/sell, size-conditioned, calibrated on our own fills
# (+ agent-readable script output, and the combined sequenced roadmap at the end)

Untracked planning doc (2026-07-17). Per the fold-out discipline this file folds into
`PLAN.md` when scheduled and is deleted when its last chunk ships. Executor rules =
PLAN.md "Executor rules", verbatim. Two topics, one roadmap: Part 1 = reach calibration
(Findings 1–3); Part 2 = agent-readable output; the **combined prioritized sequence** is
the final section.

## Intent

Three findings from the 2026-07-17 live session compound into one diagnosis: **every price
the pipeline calls "achievable" is derived from bucket AVERAGES, but a real order fills
against the best counter-order in the book — and the gap between those two is a function of
(tranche size ÷ daily volume), not of price level.**

- **Finding 1 (written up — `js/quotecore.js` header, commit 4b6d08f):** the `Quick` pair
  (`/latest` averaged high/low) can sit on the wrong side of the live spread; 4/4 clean real
  1-unit instant round-trips showed the model's buy/sell literally reversed vs the real
  cross, with true net 3–5× worse than modeled (n=4, one day, one account).
- **Finding 2 (written up — `/scan` SKILL.md "Asymmetric ask-reach read", v1.63):** the
  small-clip price premium collapses as tranche-share-of-daily-volume grows: clean below
  ~0.5% share (Soul rune 25k ≈0.56%, 23+ clean lots; Blood rune ≈0.28%), visibly degraded
  at ~0.7–1% (Prayer potion(4), Super restore(4)), gone by ~6–7% (Raw anglerfish 9,890u
  ≈6.6% — a net loss after tax on a nominally "up" sale). n≈6 items, one session.
- **Finding 3 (NEW — surfaced this turn, written up nowhere but here):** the reach check
  itself (`read-window-range.mjs --ask/--bid` → `js/windowread.mjs` `reachedDays`/
  `touchedDays` over `windowStats`) tests whether the **1h-bucket AVERAGE** high/low touched
  a level. But Soul rune's own closed-lot record (`positions.json`/`fills.json`) shows ~20+
  real resting-ask fills at 397–399 over ~2 weeks — full 25,000-unit tranches, all
  profitable — while `--ask 398` reports **"reached 1/14 day(s), recent 0/3"**, the exact
  signature the doctrine reads as a mirage/stale-optimistic artifact to reject. The check
  answers "did the hour's blended average reach X", which is a strictly more conservative
  question than "can MY small resting order fill at X". So on **proven, small-share, liquid
  lanes the doctrine systematically UNDER-prices achievable exits**, while on thin/
  big-ticket/large-share items the average genuinely does bound what's achievable (the
  Ancient-godsword/DHCB mirage class the discount exists to catch).

This plan proposes how to distinguish those two regimes and produce a size-conditioned
"true achievable" read, calibrated where possible against the one thing in this repo that
is actually ground truth: our own realized fills.

## What was verified (evidence, not theory — all read directly this session)

- **The reach mechanism** (`js/windowread.mjs` `windowStats` → `reachedDays`): per-day
  window max of `avgHighPrice` from the wiki `/1h` timeseries (~15 days of history), the
  recency split (`recencySplit`, recent-3 vs full) layered on top. Everything downstream —
  `askReachFactor`, `estimatePair`'s reach fold (`EST_REACH_SAT_FRAC`), the `/scan`
  "reached 0/7 = artifact, SKIP" doctrine — inherits the 1h-average grain.
- **Why the average understates small-clip fills, mechanically:** a 1h bucket's
  `avgHighPrice` blends every instabuy print in that hour. On a liquid item (thousands of
  prints/bucket) the best prints are smoothed far below the bucket max; on a thin item
  (~1–3 prints/bucket) the average ≈ the actual trade prices. So the smoothing bias is a
  **decreasing function of prints-per-bucket** — which is why the average-based check is
  roughly right on thin items and wrong on liquid ones. This is a structural argument, not
  yet a measured curve (AC2 below measures it).
- **The codebase already half-knows this.** `dayHighFrom5m` (js/estimators.mjs) exists
  precisely because "the wiki exposes NO raw-tick period max… the least-smoothed high
  actually retrievable is the 5m bucket average." `reachRelief` conditions on
  `sizeRatio = intendedUnits ÷ volDay` with a relief that is EXACTLY 0 on thin books.
  The pressure band (`reachableBand`, PB1–PB5) tried to predict beyond the average from
  demand balance. The pieces exist; none is calibrated against realized fills, and the
  reach CHECK itself was never grain-corrected.
- **Why pressure-exit failed and was reverted to opt-in (Ben 2026-07-16):** it predicted
  where price TRADED (bucket data), not where OUR fills cleared; it carried **no
  size-share axis** — so it overstated achievable price as a tranche approached its own
  buy limit on a lower-volume item (Water orb list-at ~9% above neutral during a false-CUT
  chop); and it REPLACED both estimate legs as an override rather than adjusting a
  bounded fold. All three are addressed by design below (§A "what's different").
- **Ground-truth inventory** (`positions.json` closed: 229 lots, 79 items): per-item lot
  counts are heavily skewed — top items 25/25/23/19/12 lots (ids 13263, 566=Soul rune,
  23959, 23956, 6737), then a long tail of 1–5. **Only ~5–6 items have enough own-fill
  history to say anything per-item**; most items have 0–3. `fills.json` (3,140 events)
  additionally exposes per-offer partial-fill sequences (`placed`/`partial`/`complete`
  with cumulative `filled`/`spent`), so the price-vs-cumulative-quantity curve of a single
  offer is reconstructable — finer than the lot-level `buyEach`/`sellEach` averages.
- **A critical own-data limitation (do not oversell):** nearly all Soul-rune lots are the
  SAME 25k full-limit tranche. That is n≈25 observations at ONE point on Soul rune's
  size-curve — it validates "398 clears at 0.56% share" powerfully, but it is NOT a
  per-item curve. The curve's shape comes from pooling ACROSS items (the n≈6 Finding-2
  spread), which is much weaker evidence.
- **Archive coverage** (`pipeline/.market-archive.sqlite`, checked live): 1.59M
  observations but only **189 one-hour buckets and 662 five-minute buckets** total —
  opportunistic accrual, ~5 buckets/day. The archive cannot yet support a continuous
  cross-day 5m-grain reach read for most days; it extends coverage opportunistically and
  improves passively with every scan/watch run. The wiki serves 5m timeseries ~30h back
  live; 1h ~15 days.
- **Volume denominators:** the wiki `/24h` endpoint is broken (frozen 1–3h slice,
  10–27× under-report — memory + PLAN-VOL24). `vol24FromInputs` (marketfetch.mjs)
  composes the true trailing 24h from the in-hand 1h series on quote/watch; the SCREEN
  default is still the legacy path (`--vol-source rolling` is opt-in). A deflated volDay
  OVERSTATES sizeShare — conservative direction for this plan's relief, but every
  size-share number must state which volume source produced it, and AC1's calibration
  must use the composed rolling-24h denominator.

## The honesty core (process rule 4 — read before any chunk)

1. **Our own fills are ground truth — for OFFLINE calibration only.** They calibrate the
   safeQuantile constants (AC1); they never act as a live per-item lookup/override (Ben's
   revision: a raw "we filled here before" check goes stale across regime shifts — the
   exact trap RC1 exists to catch — and the decay/regime machinery needed to make it safe
   isn't worth building for a noise-reduction fix).
2. **The size-share knee is a rough observation, not a calibrated threshold.** n≈6 items,
   one session, uncontrolled. 0.5%/1%/5% must ship as NAMED PLACEHOLDERS with the pooled-n
   beside them, exactly like every other estimator constant in this repo. AC1 exists to
   widen the n before any of it touches a fold.
3. **The calibration sample is pooled and clustered, not a curve per item.** 229 lots
   across 79 items, but 25 Soul-rune lots at ONE tranche size is one point on one axis.
   `qEvidence`/`impactFold` ship as pooled, small-n placeholder constants with the n
   beside them — never presented as per-item calibration.
4. **The mirage guard is non-negotiable.** Every relaxation below is conditioned on
   (liquid book) AND (small size-share); the thin/big-ticket/
   large-share path stays byte-identical to today's conservative discount. This is the
   same hard constraint `reachRelief` already encodes — this plan calibrates it, never
   removes it.
5. **A projection off stale data is worse than no projection.** The 24h read (§B) must
   refuse loudly on stale inputs (the `diurnalForecast` degrade-with-reason pattern), not
   silently project.
6. **No claimed price above what evidence shows printed.** The safe quantile is a
   quantile OF the observed daily-high distribution — bounded by the observed print
   ceiling (5m max / dayHigh) by construction. Nothing ever fabricates a level beyond
   what printed; on a thin book the threshold collapses toward the center (today's
   conservative behavior).

## A) From "above average = suspicious" to a liquidity-scaled safe quantile (the proposal)

**Revised 2026-07-17 after Ben's review.** The first draft proposed a live per-item
own-fill override ("we filled at 398 before, so trust 398"). **Dropped** (Ben's call, both
reasons his): (i) a raw fill-history check goes STALE — an old fill at an old price would
vouch for a now-unreachable level, reintroducing exactly the regime-shift trap the RC1
recency split exists to catch (Blood rune's 4/14 pre-crash reach is the anchor); making it
safe needs recency-decay/regime detection, real complexity for a noise-reduction fix.
(ii) The deeper problem isn't missing evidence, it's that the check asks the wrong
question. Own fills remain ground truth for OFFLINE calibration (AC1) — they just never
act as a live per-item lookup.

**A1 — reframe what the warning measures.** Ben, directly: *"Going above the average sell
price is exactly how we make money, it shouldn't be an alarming thing."* The average high
is definitionally the median-ish outcome; a resting ask priced above it is the entire
point of listing rather than dumping at the instant price. The current check treats
"above the 1h-average reach" as inherently suspicious and hands two completely different
situations identical warning language:

- **upper-middle of the daily-high distribution** — the normal achievable band for a
  small resting order (Soul rune 399: ~p50–p75 of daily highs, deep book) — nothing
  alarming; today it reads "reached 1/14 ⚠" and gets rejected;
- **genuine tail outlier** — at/near/above the historical extreme, plausibly a single
  artifact print (the DHCB 36.21m band top, the anglerfish bulk-clear case) — the real
  mirage the discount exists to catch.

The fix: the reach read reports WHERE the scored price sits in the daily-high (/low)
distribution — a percentile placement, machinery `quantHigh`/`quantLow` already has — and
warns only past a threshold, instead of treating any un-reached-by-the-average level as
an artifact.

**A2 — the threshold is liquidity-scaled, and it MERGES with the Finding-2 size curve.**
How far into the upper percentiles is safe to treat as normal scales with the book's
depth: on a thin book one outlier print carries enormous weight and may never repeat —
stay near the center; on a deep book an above-average print is far more likely a
repeatable small-order execution — trust deeper into the tail. That is a GENERAL,
uniform rule (a function of current volume, re-derived fresh every read), not a per-item
list, and it cannot go stale the way a fill-history check can.

**Merge resolution (investigated, answer: one model, two arguments).** Finding 2's
size-share curve and this threshold are the same underlying variable — liquidity — driving
two distinct mechanisms:

- **evidence trust** (this section): is a PAST upper-percentile print reliable evidence,
  given absolute book depth? Depends on the item's volume only.
- **market impact** (Finding 2): will MY order degrade its own execution? Depends on
  sizeShare = intendedUnits ÷ volDay.

They are not redundant — one is about the data, the other about your order — but they
compose into ONE function rather than two mechanisms:

```
safeQuantile(volDay, units) = qEvidence(volDay) − impactFold(units / volDay)
```

`qEvidence` rises with absolute volume (thin book → ~p50, stay near the center; deep book
→ ~p85–p90, trust the upper tail); `impactFold` pulls it back down as your tranche grows
toward the Finding-2 knee (≈0 below ~0.5% share, large past ~5%). The `units→0` limit is
the pure warning-threshold case (scoring someone else's print); evaluated at your actual
units it IS the achievable-price read. One set of placeholder constants, calibrated
together by AC1 — this replaces the first draft's three-tier lookup entirely (simpler:
no tiers, no per-item state, no live fills join). It also subsumes today's separate
`reachRelief` axes (same variables, now with a mechanical story: 1h-average smoothing
bias shrinks as prints-per-bucket → 1, so thin books are where the average genuinely
bounds you).

Surfaced form (both `read-window-range.mjs` and the est-cells): placement + verdict, e.g.
`398 = p62 of daily highs — inside the normal band for this liquidity (safe ≈ p85)` vs
`36.21m = above every printed high — tail outlier on a thin book; artifact until proven`.
The RC1 recency split stays untouched on top — regime contamination is a different
failure, and it is precisely the failure that killed the own-fill idea.

**A3 — what's different from pressure-exit (which already failed a trial):**
(i) constants calibrated offline against realized FILLS (AC1), not traded prints — the
gap that sank it; (ii) size-share/liquidity is the primary axis — the variable it lacked;
(iii) it adjusts the existing bounded reach-fold and the warning LANGUAGE — never
overriding both estimate legs, never quoting above the observed print ceiling (5m
max/dayHigh) absent evidence; (iv) shadow-first discipline (suggestions.jsonl fields +
stdout inform line before any fold change; `--publish` keeps refusing non-neutral
estimators until a Ben ruling).

**Where the constants come from (AC1, the calibration study):** for every closed lot,
join sell events to same-day bucket data (wiki 1h + archive 5m where present) and compute
(a) sizeShare = qty ÷ composed rolling-24h volume that day, (b) realized placement: what
daily-high quantile `sellEach` cleared at, (c) per-offer fill duration from the `partial`
event chain. Regress/bucket realized placement against volDay (calibrates `qEvidence`)
and sizeShare (calibrates `impactFold`). 229 lots ≈ 229 points, heavily clustered at a
few (item, size) pairs — honesty item 3.

## B) Two reads — "now" vs "next 24h"

**Recommendation: two numbers, both surfaced, posture picks the headline — the 24h read
never silently supersedes.**

- **NOW read** — live-anchored achievable pair at the caller's actual intended size (held
  qty on a positions surface, buy limit on discovery — the existing `intendedUnits`
  convention). Two flavors, and Finding 1 says they differ materially: an **instant cross**
  (market-order both legs — quote it with the Finding-1 caveat; the model's Quick net ran
  3–5× optimistic in the n=4 test, so never present it as achievable without a real 1-unit
  probe) vs a **resting-order now** (post at the achievable level from §A; fills over
  minutes-to-hours). The NOW read's mechanism: live tick + §A's size-conditioned level.
- **24H read** — the same size-conditioned level projected onto the existing
  `diurnalForecast` machinery (nextPeak/nextTrough window + eta + confidence ordinal,
  with all its refusal reasons intact: spike/decay phase, band violation, trend-dominates,
  stale anchor). Mechanism: `safeQuantile(volDay, units)`'s price evaluated over the projected peak/dip window's distribution
  instead of the live level. Because a resting order sits until filled or canceled, the
  24h read is functionally the PRIMARY read for passive/overnight posture — you don't
  need to be at the desk when the window arrives.
- **Surfacing (no new note family).** The render-tier registry (`pipeline/lib/render.mjs`
  NOTE_KINDS) already carries `forecast` (ℹ), `asym` (◆), `reachRelief` (↥), and
  `pressureExit` (◇) — four families all circling this same question. Propose ABSORB, not
  add: the NOW read rides in the existing `Est. buy`/`Est. sell` cells (it IS what those
  cells claim to be — this plan makes them honest), with the percentile-placement token
  replacing/extending the current reach token (`398 (p62, safe ≈ p85 @ this liquidity)`
  vs today's `(0/3 · 1/14)`); the 24H read rides the existing `ℹ forecast` line, upgraded to carry
  the size-conditioned level + eta (`ℹ sellable ~398 @ 20:00–23:00 (~6h, med)`). Once
  shipped and trialed, `◆ asym` and `↥ reachRelief` become candidates to retire INTO this
  (a future evidence-based ruling per R10 — not speculatively upfront), and `◇
  pressureExit` stays the opt-in trial it already is. Net note-family count goes down,
  not up.
- Ordering: `/scan` active posture headlines NOW; `/overnight`/passive headlines 24H.
  Both always present — one line each, the compact-output discipline.

## C) Should the workflow always live-fetch?

**Recommendation: yes — code-enforced for any surfaced price, with exactly two legitimate
skip cases.** Reasons: (i) the SY1 precedent — freshness rules left to prose get skipped;
the fix that worked was making the sync a code path, and the same applies here; (ii) the
wiki API has no meaningful rate-limit risk at this pipeline's volume (verified in prior
session research + the PLAN-WIKI-CONTEXT probe); (iii) every fetch passively feeds the
archive via marketfetch — the fetch is not a cost, it is how the 5m/1h coverage §A's
distribution read depends on accrues at all; (iv) a stale-anchored 24h projection is confidently
wrong, the worst failure mode this repo knows (fresh-read-before-acting memory).

Concretely: any command emitting an achievable-price number fetches `/latest` + the 5m
series as part of the run (all current surfaces already do); the 24H projection
HARD-REFUSES with a reason when its live anchor is older than a staleness threshold
(reuse `STALE_QUOTE_MIN` / the thin-item interval scaling from quotecore — no new
constant), following `diurnalForecast`'s degrade-loudly contract. The two legitimate
skips: **pure retrospective analysis** over historical fills (`analyze-record` — there is
no "now" to price) and **tests/replay fixtures** (determinism requires no network).
Everything user-facing fetches, every time.

## Chunks (not yet scheduled — proposed breakdown)

### AC1 — calibration study (the gate for everything else) — **DONE (2026-07-17)**

**WHAT WAS BUILT.** `pipeline/commands/analyze-fill-placement.mjs` (new READ-ONLY command; pure core
`pipeline/lib/fill-placement.mjs`, fixture-tested by `pipeline/test/fill-placement.test.mjs`). New file,
NOT a mode on `analyze-record.mjs`: that command's documented contract is "writes NOTHING, no fetch, never
a commit/sync path", and this study MUST fetch live `/timeseries?1h` + read the archive — a different
dependency profile. Joins all 232→227 sell lots (withdrawals dropped) to same-day 1h buckets, computes
per-lot daily-high/low percentile placement + `sizeShare` on the CORRECTED composed rolling-24h denominator
(`rolling24FromTs1h`, never `/24h`), fill duration from the `collapseOffers` chain, and the AC2 smoothing
bias (archive-5m max vs live-1h avg by volume proxy). Per-bucket n throughout, lot-count concentration,
pooled + per-item Spearman ρ, hpv-side robustness axis. README inventory updated. All 68 test suites +
`check-imports` + `check-dead-exports` green.

**WHAT THE CALIBRATION FOUND — the honest gate answer: the Finding-2 knee does NOT replicate, and it
CANNOT be tested on our own fills.** Two compounding reasons, numbers stated:
1. **The corrected denominator collapses Finding-2's x-axis ~6–16×.** Finding 2's shares were (near-certainly)
   computed on the broken `/24h` volume. On the composed rolling-24h denominator: Soul rune 25k = **0.07%**
   (Finding 2 said 0.56%), Raw anglerfish 10k = **0.41%** total / 0.64% instabuy-side (Finding 2 said 6.6%),
   Blood rune 25k = **0.05%** (said 0.28%). Every placeable lot sits **below ~0.74% share** (max placed:
   0.74% total / 1.48% instabuy-side). We have **ZERO fills in the ≥1% "degraded/gone" regime** the knee
   describes — the 6 lots >1% are qty-1–5 lots of THIN items (high share only because that item's volume is
   tiny), not large tranches, and all fall in the un-placeable early period anyway.
2. **Within our actual 0–0.74% coverage there is no monotone degradation.** Pooled Spearman
   ρ(sizeShare, sellPlacement) = **+0.02** (n=102); +0.07 on the instabuy denominator — i.e. ~0, and if
   anything the WRONG sign for a knee. Placement by share bucket is non-monotone (p29 / **p80** / p33 / p33 /
   p20) — the p80 bump is just the one liquid item (Soul rune) we sold aggressively, a LIQUIDITY effect, not
   a share effect. The per-item cross-item ρ = **−0.30** (n=28) is the only negative signal, but it is
   small-n, non-robust, and confounded with liquidity (thin items sold mid-band; liquid Soul/Blood rune sold
   high). Placement tracks item liquidity more than share, but even that (§3, → `qEvidence`) is dominated by
   2 items in the >10M bucket.

**GATE RESULT: NOT MET.** The knee is not disproven — it is UNOBSERVABLE on our ground truth, because with a
correct volume denominator we never traded a large-enough share to see market impact. Per this chunk's own
gate clause, the plan should **stop at AC1 + AC4a's descriptive percentile-placement rendering** (which
survives — "where does this price sit" needs no calibration); **AC3's calibrated `impactFold`/`safeQuantile`
SAFE threshold should NOT proceed on this evidence.** A coordinator + Ben ruling owns the actual go/no-go.

**Data-quality caveats a reader must weigh:** (a) only **102/227 sells** are placeable — the entire early
period 07-02→07-07 (125 lots) is dropped 'thin-history' because the live 1h series only reaches ~15d, so
those lots lack a trailing distribution (and they hold the only >1%-share lots, all thin-item noise);
(b) the sample is heavily **clustered** — top items 25/25/23/19/12 lots (566/13263/23959/23956/6737), Soul
rune alone ≈25 at ONE 25k tranche = one point, not a curve; (c) placement is measured against the wiki 1h
`avgHighPrice` daily-high distribution (the same grain the reach check uses), inheriting its smoothing.

### AC1 (original spec) — calibration study (the gate for everything else)
Committed read-only script (`pipeline/commands/analyze-fill-placement.mjs` or an
`analyze-record` mode): join closed lots + per-offer fill chains against same-day 1h/5m
bucket data; emit realized daily-high-quantile placement per lot against volDay (→
`qEvidence`) and sizeShare (→ `impactFold`), with per-bucket n, plus the smoothing-bias
measurement (AC2's numbers ride along: per item, 1h `avgHighPrice` vs same-hour 5m max,
as a function of prints-per-bucket). Uses the composed rolling-24h volume denominator,
never `/24h`. ~half a day. **Gate for AC3/AC4's fold changes:** the Finding-2 knee must
replicate on the full 229-lot join, not just the 6-item spot-check — if it doesn't, this
plan stops at AC1 + AC4a's percentile-placement rendering (which is descriptive — "where
does this price sit in the distribution" — and survives regardless; only the
liquidity-scaled SAFE threshold needs the calibration).

### AC2 — smoothing-bias probe (folded into AC1's output) — **DONE (2026-07-17)**
No separate code — AC1 reports it (`smoothingBias` in `lib/fill-placement.mjs`). Named separately so the
finding ("bias shrinks as prints-per-bucket → 1" — the mechanical basis for liquidity-scaling the
threshold) is either confirmed with numbers or killed before anything conditions on it.

**WHAT IT FOUND — the hypothesis is NOT supported at usable magnitude.** Bias = (max same-hour 5m
`avgHighPrice`) ÷ (1h `avgHighPrice`) − 1, over **5,053 hour-samples / 49 items**, bucketed by 1h
`highPriceVolume` (the volume PROXY for prints-per-bucket — the wiki exposes no print count). Median bias
is **0.36% / 0.55% / 0.36% / 0.45% / 0.56%** across the <1k → >200k volume buckets — i.e. essentially
**FLAT and tiny** (all <0.6%). ρ(volume, bias) = **+0.089** (right direction, but negligible). So the
1h-average vs 5m-max gap is too small and too flat to justify liquidity-scaling a threshold off it.
**Big caveat:** the 5m value is itself a 5-minute AVERAGE (the wiki serves no raw tick), so this bias is a
**LOWER BOUND** on the true average-vs-execution smoothing gap — the real gap the doctrine cares about
(bucket-average vs the best fill) is not measurable from wiki grains and remains a structural argument, not
a measured curve. This does not, on its own, provide a calibrated basis for the liquidity axis.

### AC3 — `safeQuantile(volDay, units)` in js/ (shared, pure)
The one merged function (A2): `qEvidence(volDay) − impactFold(units/volDay)`, returning
`{ quantile, price, n, basis, bound }` — price = that quantile of the observed daily-high
distribution, bounded by the print ceiling. Thin-book path returns today's conservative
reach-folded value (byte-identical, pinned by test). Subsumes `reachRelief`'s axes (that
function becomes a deprecation candidate, a separate ruling). Shadow-logged to
suggestions.jsonl before any fold consumes it.

### AC4 — surface it
(a) — **DONE (2026-07-17), SHIPPED WITHOUT the "safe ≈ pXX" annotation (AC3 did not land).**
`read-window-range.mjs` now reports, beside the existing reach count on a scored `--bid`/`--ask`/`--exit`,
the level's PERCENTILE PLACEMENT in the trailing daily-low/high distribution (e.g. `--ask 398 → reached
1/14 · placement p93 of the 14-day daily-HIGH distribution`), with n stated (process rule 4). The
price→percentile primitive is a new pure `placement(sortedAsc, x)` in **`js/windowread.mjs`** — the js/
shared home beside `quantLow`/`quantHigh` (NOT a cross-boundary import of `lib/fill-placement.mjs`'s `cdf`,
which is pipeline calibration code built for AC1's study); `cdf` now DELEGATES to `placement` so there is
ONE definition. Where the Tier-1 archive (`lib/archive.mjs`, read-only, best-effort) has ≥3 covered
window-days it surfaces a less-smoothed **5m-grain** reach/placement ALONGSIDE the 1h one (labeled, a LOWER
BOUND per AC2; degrades cleanly to 1h-only otherwise — in testing the 5m path fired for liquid items over a
broad window, e.g. Soul rune 398 → 5m reached 3/7 · p57, and cleanly went 1h-only on a narrow/off-peak
window). AO2's `--json` folded in on the same touch (per-item result objects to stdout, the
`analyze-record`/`analyze-fill-placement` non-render convention; default markdown byte-identical when
absent). New tests in `windowread.test.mjs` pin `placement`. **Explicitly OUT OF SCOPE and NOT built:** any
"safe ≈ pXX" threshold/verdict/recommendation — the placement is PURELY DESCRIPTIVE. AC3's calibrated
liquidity-scaled safe quantile did not proceed because AC1's gate failed (the Finding-2 knee is unobservable
on our own fills — "GATE RESULT: NOT MET" above), so there is no calibrated basis for a "safe" annotation;
the trust judgment stays in the human/skill + `docs/MARKET-ANALYSIS.md` layer.

(a, original spec) `read-window-range.mjs`: percentile-placement rendering for `--ask`/`--bid` (where
the level sits in the daily-high/low distribution) + grain-aware (5m-max) reach where
coverage exists — descriptive, can ship before/without AC3; the "safe ≈ pXX" annotation
joins once AC3 lands. (b) `estimatePair`: `safeQuantile` becomes the sell-top reference
in place of the flat `EST_REACH_SAT_FRAC` fold + `reachRelief` pair, and the warning
language switches from "reached k/N ⚠" to placement-vs-threshold. Gated on AC1's
replication; `--publish` stays neutral-estimator-only until a Ben ruling.

### AC5 — the now/24h pairing
Upgrade the `ℹ forecast` line to carry the size-conditioned 24H level + eta; posture-keyed
headline ordering in the `/scan`/`/overnight`/`/positions` skills (SKILL.md version bumps,
no APP_VERSION).

### AC6 — staleness enforcement (the C recommendation)
The hard-refuse-on-stale-anchor guard for any 24H projection surface + a lint/test that no
surfaced-price command path skips the live fetch. Small; mostly reuses existing constants.

---

# Part 2 — agent-readable script output (the 483-line-scan problem)

## Intent

The market-read CLIs print human-readable markdown tables + inform-note footers to stdout
— load-bearing for Ben's own terminal reading (the `/scan`/`/positions` "paste the raw
table verbatim" instruction stands; this part changes NOTHING about stdout by default).
But when an AGENT runs a script for analysis, that same output is a cost: a
`screen-flip-niches.mjs --mode all` pass this session printed **483 lines** the agent had
to redirect to a scratch file and re-read in chunks — a recurring context tax paid on
every investigative run, including every chunk of Part 1's calibration work.

## What was verified (evidence, not theory)

- **The structured object already exists at every print site.** All three market-read
  scripts (`screen-flip-niches.mjs`, `quote-items.mjs`, `watch-positions.mjs`) build a
  PLAN-VIZ-LAYER report object (`{kind, generatedAt, sections:[{type:'table'|'lines'|
  'notes'|…}]}`) and print it through ONE `renderReport()` call (screen:
  `buildScreenNicheReport` → line 943's single `console.log(renderReport(...))`). The
  render.mjs header explicitly anticipates this: "STAGE-2 SEAM (R6): because a report
  object is plain JSON, a later chunk can write it to a root artifact." The minimal fix
  is to serialize the object that is already in hand — no new data plumbing.
- **`screen.json` can NOT serve this purpose as-is** (checked the live file): its rows are
  already-RENDERED display cells (`{t:"33.32m → 34.10m · +97,891 (+0.3%)", c:"gain"}`)
  plus the additive `reachable` band — strings for the app's Scan tab, not fields. It
  carries only the band+churn niches; the value niche, gate/reject reasons, and ALL the
  console footer inform families (trajectory/reach, ask-headroom, asym, demand, diurnal,
  window-clear, entry paths) are console-only today. Teaching screen.json to carry all of
  that would grow a deployed app artifact for an agent-only need — wrong artifact.
- **`suggestions.jsonl` is the wrong shape too:** append-only per-suggestion shadow rows
  (estBuy/estSell/asym/winClear…) for the F1 retro-join — not "this pass's full read"
  (no rejected candidates, no notes, and mixed across runs).
- **Partial precedent exists:** `analyze-record.mjs`, `join-outcomes.mjs`, and
  `report-retro.mjs` already have `--json`; the market-read trio and
  `read-window-range.mjs` do not. Gitignored scratch convention: `pipeline/.cache/`
  (marketfetch cache; join-outcomes' `.cache/last-weekly-report` marker).
- **Honest limitation:** inside the report object, screen's footer inform families ride as
  PRE-FORMATTED strings (render.mjs header says so — they carry no typed kind). So a
  report-object dump is structured at the section/row level (grep one item's rows/notes
  cheaply, skip whole niches) but the note text stays text. That is the 90% fix; fully
  typed notes = promoting those families into NOTE_KINDS entries, a larger VZ-direction
  chunk this plan does NOT propose now (don't over-design).

## Proposal (minimal, additive)

- **AO1 — always-write the last-report dump + `--quiet`.** At each script's single
  `renderReport` call site, also write the report object(s) as compact (un-pretty-printed)
  JSON to `pipeline/.cache/last-report/<kind>.json` (gitignored; overwritten per run —
  "last run" semantics, mirroring the join-outcomes marker pattern). Add `--quiet`:
  suppress the markdown stdout, print one summary line + the dump path. Default behavior
  (stdout markdown) byte-identical — Ben's terminal reading untouched; the skills gain one
  line: "agent-driven analysis passes may read `pipeline/.cache/last-report/*.json`
  instead of re-reading stdout." Effort: small (the object already exists); the main work
  is screen's per-niche loop accumulating sections into one file instead of N prints.
- **AO2 (opportunistic, later) — `--json` on `read-window-range.mjs`.** It predates the
  render layer (raw `console.log`s), so it needs its result object assembled first —
  medium effort, and it is the tool Part 1's chunks will run most often; do it when AC4a
  touches the file anyway, not before.
- **Explicitly NOT proposed:** a new output-format architecture, teaching screen.json the
  console-only families, or changing any default stdout.

---

# The combined sequenced roadmap (both topics, one order)

The ordering principle: cheap context-savers and doc guards first (they make every later
step cheaper to run and stop a known live failure mode), then the structural reorg that
gives the later model work a clean landing slot (Ben's call — see
**`PLAN-PIPELINE-COMPOSITION.md`**, the estimator/probe/gate one-file-per-concept +
composition-layer plan; its audit says PC1–PC3 are cheap and low-risk, which is why it
can honestly sit this early), then the evidence-gathering gate, then model changes only
after the gate passes.

1. **AO1 — report-object dump + `--quiet`** (Part 2). First because it is the cheapest
   item on the list and every subsequent step involves agents repeatedly running these
   scripts — the context savings compound across the whole roadmap.
2. **AC-0 — Finding-3 docs guard** (docs-only, minutes). Until it exists, the next session
   will re-reject normal upper-band levels (Soul rune 398 @ "1/14") off the avg-based
   read — the guard states the reframe: above-average is the point of a resting ask;
   judge placement-vs-liquidity, not reached-vs-average.
3. **PC1–PC3 — the composition reorg** (`PLAN-PIPELINE-COMPOSITION.md`): the
   flag>config>default resolver, the `js/estimators/` split behind the barrel, and the
   named sell-model registry that replaces the boolean `pressureExit` threading. The
   resolver's contract is ACTIVE-PLUS-SHADOW, not exclusive-or (Ben's refinement,
   codifying what pressure-exit already does): every registered model runs and
   shadow-logs to suggestions.jsonl each pass; only the designated active one feeds the
   displayed/published number — which is precisely what lets this plan's calibration
   compare `safe-quantile` against the incumbent models on the SAME real outcomes later,
   with no bespoke per-model logging scaffold. Honest
   placement note: this does NOT gate AC1/AC2 (a read-only fills study touches none of
   these files, and could run in parallel) — it sits here on Ben's ruling plus the fact
   that the audit found it genuinely small (two mechanical moves behind existing seams +
   one ~day design chunk), so front-loading it costs little and means AC3 ships as
   `js/estimators/safe-quantile.mjs` + one registry line instead of another if-branch in
   the monolith. PC4 (validators split) is opportunistic and unscheduled.
4. **AC1 + AC2 — the calibration study** (the gate). Join all 229 closed lots + per-offer
   fill chains against same-day 1h/5m buckets; realized quantile placement vs volDay and
   sizeShare (the `qEvidence`/`impactFold` inputs) + the smoothing-bias measurement. No
   model changes until this replicates the Finding-2 knee.
5. **AC4a — percentile-placement + grain-aware reach rendering** on
   `read-window-range.mjs` (descriptive, survives even if AC1 kills the calibrated
   threshold); fold AO2's `--json` into the same touch of the file. — **DONE (2026-07-17)**,
   shipped WITHOUT the "safe ≈ pXX" annotation because AC1's gate failed (AC3 not proceeding);
   see the AC4 section for the full note. `placement` lives in `js/windowread.mjs`.
6. **AC3 — `safeQuantile(volDay, units)`** (gated on AC1 replication): the ONE merged
   evidence-trust × market-impact function, shadow-logged first; thin-book path
   byte-identical. Lands as a registered sell-model in the PC3 structure (one new file +
   one registry line), not as new branches in `estimatePair` — registered as a SHADOW
   model first (runs + logs beside 'reach-fold'/'pressure' every pass, never displayed),
   graduating to active only on a Ben ruling after the cross-model retro.
7. **AC4b — `estimatePair` + warning language consume it** (replaces the flat fold +
   `reachRelief` pair; "reached k/N ⚠" becomes placement-vs-threshold); `--publish`
   stays neutral until a Ben ruling.
8. **AC5 — the now/24h pairing** (absorb into Est. cells + the `ℹ forecast` line;
   posture-keyed headline; skills version bump).
9. **AC6 — staleness enforcement** (the §C recommendation: code-enforced live fetch on
   every surfaced price; hard-refuse stale-anchored 24h projections).

Steps 1–5 are safe regardless of how the calibration turns out; steps 6–8 exist only if
step 4's evidence supports them (honesty core item 2); step 9 is independent and can slot
anywhere after 1.

## Docs / registry pass (rule 8, per chunk)

- **Finding 3 has no written home today — AC-0 (immediate, docs-only):** a paragraph in
  `docs/MARKET-ANALYSIS.md` beside the reach doctrine ("reached = the 1h AVERAGE touched
  it — pricing a small resting order ABOVE the average is the normal mechanism of profit,
  not an anomaly; on a liquid book, distrust only levels near/above the historical
  extreme, and stay near the center on a thin one") + a pointer from the `/scan` skill's
  RC1 bullet. Until AC4a ships, this is the only guard against the next session
  re-rejecting Soul rune 398 off the 1/14 read.
- `README.md` inventory: `analyze-fill-placement.mjs` (AC1) and the safeQuantile module
  (AC3) at creation.
- `docs/MARKET-ANALYSIS.md`: reconcile the reach/est-pair sections when AC4 lands (the
  "would reject/would caution" language keyed off raw reach percentages is exactly the
  prose Finding 3 supersedes — grep and fix in place, not append).
- `/scan` + `/positions` SKILL.md: the percentile-placement vocabulary + the now/24h
  headline rule (AC5); the RC1 stale-flag bullets stay (they guard a DIFFERENT failure —
  regime contamination — and are untouched by this plan; indeed regime-staleness is why
  the own-fill override was dropped).
- `pipeline/lib/render.mjs` NOTE_KINDS: no new kind; note the absorb-candidates ruling
  path for `asym`/`reachRelief` once trialed.
- AO1: `README.md` inventory entry for `pipeline/.cache/last-report/` (gitignored data
  artifact — producer: the three market-read scripts; consumer: agent analysis passes);
  one-line addition to the `/scan`/`/positions` skills pointing agents at the dump; the
  render.mjs header's R6 "Stage-2 seam" note updated to say the seam is now exercised.
