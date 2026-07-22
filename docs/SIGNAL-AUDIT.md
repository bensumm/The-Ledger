# SIGNAL-AUDIT — what we calculate, what earns its keep, and the stale-read problem

**Status: read-only audit (2026-07-22). No code changed.** Scope: every signal computed across
`js/windowread.mjs`, `js/quotecore.js`, `js/estimators/*`, `js/rating.mjs`, `js/validate.mjs`,
`js/forecast.mjs`, `js/termstructure.mjs`, `pipeline/commands/quote-items.mjs`, and
`pipeline/commands/screen-flip-niches.mjs` (scan + the decision digest). Written in response to
Ben's ask: inventory everything, name what's redundant/stale, and scope a recency-weighted
`reachMargin`-style primitive for the whole app.

---

## 1. The full inventory

Legend for **recency-aware**: ✅ explicit recent-vs-full split with a stale flag · ⚠️ partial (uses a
recent slice for ONE side, e.g. the level, but not the trend) · ❌ single aggregate over the whole
window, no recency split.

| Signal (file:fn) | What it computes | Input timeframe | Fires when | Recency-aware? | Consumed by |
|---|---|---|---|---|---|
| `windowread.windowStats` | per-day low/hi/vol buckets over a fixed wall-clock window | 1h archive, N nights (default 14) | always (base primitive) | n/a (raw data) | almost everything below |
| `quantLow`/`quantHigh`/`placement` | price↔percentile over the whole day-bucket sample | 1h, ~14d | on demand | ❌ whole-window quantile | reach, `askExitRead`, digest `askPlacement`, `read-window-range` |
| `touchedDays`/`reachedDays` | raw hit-count vs a level | 1h, ~14d | on demand | ❌ | `reachValidator`, `askExitRead`, estimator `pFillIntraday`(reach), digest |
| `recencySplit` (RC1) | full-window hit-frac vs recent-3 hit-frac, flags `staleOptimistic` | 1h, ~14d + recent-3 | always alongside a reach read | ✅ | `reachValidator`, `askExitRead`, `estimatePair` confidence, digest reach ✓/✗ |
| `trajectoryRead` | one-shot SHAPE label (rising/falling/oscillating/based/elevated) off blended daily mids | 1h, ~14d | quote + `--positions` (auto) | ⚠️ recent-third vs oldest-third drift, but MEAN-blended mids | quote-items notes |
| `floorCeilingTrack` (PLAN-DRIFT-VS-CRASH) | floor(lows)/ceiling(highs) tracked SEPARATELY: least-squares slope over recent-N + a floor-BREAK vs prior lookback | 1h, ~14d, recent-5 slope window | quote + `--positions` (auto) | ✅ (best trend primitive in the repo — see §4) | quote-items notes only |
| `reachMargin` (2026-07-20; R4/R4b slope+wired) | cushion-over/under-level TREND (`projectTrajectory` least-squares SLOPE of the cushion over the last 7 days — R4, was mean-of-halves) + today's live pace vs the reaching-day median | 1h, 7-day recent window, `projectTrajectory` slope | folded automatically into `askExitRead` whenever an ask is scored | ✅ slope-based (R4 fixed the mean-of-halves) | `askExitRead` → quote-items (`quote` + `--positions`) + `read-window-range --ask/--bid`; **now ALSO the digest `trend` column (R4b — the ask-side cushion trend beside reach ✓/✗)** |
| `asymPair` | day-level deep-bid (p25 quantile) / high-reach-ask (p80 quantile) pair | 1h, ~14d | quote (`asym` note), screen `--asym` (opt-in, unpublished) | ❌ whole-window quantile | quote notes, `asymEstimate` |
| `windowClear`/`windowClearDiverges` | within-target-window (not whole-day) reach fraction + volume-pool absorption check | 1h, re-bucketed to the target window | held big-ticket lots (`--positions`), `--ask` reads | ❌ whole-window reach inside the narrower window | quote-items `windowExit` note |
| `hourProfile` | per-local-hour dip/peak SHAPE (de-trended by day) + trend-dominates flag | 1h, ~14d full-window shape / recent-3 LEVEL | diurnal note, digest soft-buy, forecast anchor | ⚠️ shape=full-window, level=recent-3 | `deriveDiurnalRange`, `softBuyRead`, `diurnalPhase`, `demandRegime`, `forecast.diurnalForecast`, digest |
| `deriveDiurnalRange` | bid=dip level (live-guarded), ask=peak level | derived from `hourProfile` | quote diurnal note, `--positions` | inherits `hourProfile` | quote notes, `rebidAdvice` |
| `softBuyRead`/`digestSoftBuy` | is live at/near the diurnal dip floor right now | derived from `hourProfile` | held-lot ADD timing (quote), digest buy column | inherits `hourProfile` | quote notes, digest |
| `diurnalPhase` | in-peak / pre-peak / post-peak vs the peak window | derived from `hourProfile.peak` | stdout-only timing token (⏲) | n/a (clock vs window) | quote notes, digest `phase`/verdict rule 4 |
| `demandRegime`/`hourlyPressure` | per-hour buy/sell PRESSURE cycle (volume-ratio), sell/buy windows | 1h, ~14d | `--pressure` inspector only | ❌ | `read-window-range --pressure`, `reachableBand` |
| `reachableBand` (PB1) | pressure-driven two-sided reachable bid/ask (base = recent-3 median, band = recent-7 IQR) | 1h, recent-3/7 | `--est-sell pressure` TRIAL only | ✅ (base+band both recency-windowed) | pressure sell-model, `read-window-range --pressure` |
| `demandPressure` | buy/sell volume ratio + reliability | 1h aggregate | feeds `reachableBand`/`hourlyPressure` | ❌ | as above |
| `depthDays`/`clearableAsk`/`clearableBid` (DE1/DE6) | per-day flow-beyond-a-level (bucket point masses), the highest/lowest level that clears `competition×qty` on ≥75% of days | 1h buckets, ~14d | `--depth` inspector (console only) | ❌ whole-window clear fraction (has a `recentFrac` field but unused downstream) | `read-window-range --depth` only — not in the main pricing path |
| `weekdayProfile` | per-weekday median amplitude % | 1h, ~28d | amplitude niche notes | ❌ | amplitude scan display |
| `computeQuote` (row) | Quick (live) + Optimistic (robust 2h-band p10/p90 clamped to live) pair, momentum tell, pressure ratio, ask-headroom, bond math | live `/latest` + last 24×5m | every quote row | n/a (this IS the live basis) | everything |
| `regimeDrift`/`regimeLabel` | 3-day median mid vs prior ~14-day median mid → flat/rising/falling | 6h archive, ~17d | every row (regime column) | ⚠️ ONE comparison (recent-3d vs prior-14d), no trend beyond that | gate/rank/screen exclusion, `momVerdict`, digest |
| `phase()` (spike/decay/basing) | current (2d) vs pre-spike base (≥14d old) vs peak-recency + recent-low slope (4d) | 6h archive, ~21d | `screen-flip-niches.mjs --phase-rescue`, `forecast` refusal gate | ✅ (has an explicit recent-4d low-slope term) | phase-rescue rescue path, `forecast.diurnalForecast` refusal |
| `robustBand`(Bar E) | p10/p90 robust 2h-band edges (raw extremum on a sparse side) | last 24×5m (2h) | every quote | n/a (2h only, not multi-day) | `computeQuote` Optimistic |
| `askHeadroom` | traded-in-band top above the quoted Optimistic ask | same 2h window | when a Class-1 gap exists | n/a (2h) | quote/screen ask-headroom notes |
| `moveShape` (shock vs bleed) | 2h down-move shape: concentrated spike-then-stable vs distributed lower-lows | last 24×5m | `momVerdict` Gate 2 | n/a (2h) | cut-trigger matrix |
| `underwaterHours` | contiguous hours below break-even + did it cover a liquid window | last ~30h 5m | `momVerdict` Gate D | n/a | cut-trigger matrix |
| `recentDirection` (DP1) | falling / reverting / flat off the last 3h of 5m lows, LAST-occurrence-of-min retest logic | 3h of 5m | `dipPostureValidator`, `flushSignal` | n/a (3h) | positions dip-posture note, DL2 flush loop |
| `flushSignal` (DL2) | exogenous liquid-flush detector (depth% below 24h avg low + falling direction + exit clears) | live + 5m + 24h avg | `watch-positions.mjs --dip` | n/a | dip-loop alert |
| `nominateDip`/`reconcileDipPool` (DL4) | scan-time suitability nomination into the dip-watchlist | 24h stats + 2h band (zero extra fetch) | scan `--mode all` | n/a | `dip-watchlist.json` |
| `termStructure`/`lookbackStat` | 1/3/7/14/28-day median/low/high/percentile-in-range; durable FLOOR = q15 of the longest lookback ≥6 points; typical swing = IQR of that lookback | daily-mid archive, ~28d | `floorValidator`, value niche, `valueAmplitudeValidator` | ❌ **the single biggest stale-read risk in the repo** — a pure quantile over the WHOLE lookback, no recency split at all | `floorValidator`, `trajectoryValidator` (via `classifyTrajectory`), `valueAmplitudeValidator`, value niche |
| `classifyTrajectory` | knife / oscillating / based / rising / elevated / flat shape off short-vs-long medians + reversal count | daily-mid archive | `trajectoryValidator` (every thesis, inform by default) | ⚠️ short-median (1-3d) vs long-median (7-14d) IS a recency comparison, but the OSCILLATION/SPIKE reads are whole-recent-leg (7d) aggregates | `trajectoryValidator` |
| `reachValidator` | wraps `windowStats`+recency-split reach/touch into pass/caution/reject | 1h, configurable nights/window | every gated buy candidate | ✅ (reuses RC1) | validator registry (quote, screen via P4c specs) |
| `floorValidator` | buy-level distance above the durable floor, in typical-swing units | `termStructure` | buy-side gate | ❌ (inherits termStructure's staleness) | validator registry |
| `trajectoryValidator` | shape-based inform/gate over `classifyTrajectory` | `termStructure` | every thesis (inform by default) | ⚠️ (see above) | validator registry |
| `valueAmplitudeValidator` | recent-week (7d) amplitude + proximity-to-low, ROBUST q15/q85 edges | `termStructure.lookbacks[7]` | value niche buy gate | ⚠️ 7d window only, no sub-week recency split | validator registry |
| `limitValidator` | 4h buy-limit remaining | fills.json rolling window | buy gate | n/a (exact, not a market read) | validator registry |
| `dipPostureValidator` | wraps `recentDirection` into pass/caution | live + 5m/3h | dip buy candidates | n/a (3h) | validator registry |
| `diurnalForecast` (PF1) | forward 12-24h trough/peak projection: baseline anchored to live, + trend×Δt, + cumulative-max dispersion band | `hourProfile` + regime/phase/mom gates | quote-items `#6` forecast line | ✅ (explicitly refuses on `spike`/`decay`/band-violation) | quote-items notes |
| `whenBuyable`/`whenSellable` | first horizon hour whose projected low/high clears a target | `diurnalForecast` | quote-items forecast line | inherits forecast | quote-items notes |
| `estimatePair`/`reachFoldModel` (R5 trend-aware) | reconciliation Est.buy/Est.sell: buy = band-low/live/trough per doctrine; **sell = live + (bandTop−live)×reach-FOLD FACTOR × R5 fade** | reach-fold factor = `min(1, askFrac/0.75)` (askFrac prefers **recent-3**), **× `EST_FADE_DISCOUNT` when the ask-side `reachMargin.trend` is `fading`** (R5 — via `extra.askMargin`, screen-wired) | default table column on quote + screen | ✅ recent-3 fold AND (R5) a slope-based cushion-fade tighten a clean-reach mirage | quote-items (no fade yet), screen niche tables + digest |
| `reachRelief`/`reachRelief`-softened topRef | liquidity/size-conditioned softening of the reach-fold, + Part-B de-biased top toward the observed 24h high | `dayHighFrom5m` (24h max of 5m) + reach fraction | large-liquid-book sells only | n/a (softens the fold, doesn't add a trend read) | `estimatePair` |
| `pressureModel` (PB4) | swaps Est.buy/sell for `reachableBand`'s pressure-driven pair | `reachableBand` | `--est-sell pressure` (trial, never published) | ✅ (recency-windowed base+band) | quote-items, screen (console only) |
| `estimateRank`/`rankScore` | net × P(fill) ÷ TTF, per estimator family | family-specific (mostly 2h band / live) | every candidate's grade/rank | varies by family (see families table) | `rateItem`, screen ranking, digest `rank` |
| `pFillIntraday`/`pFillValue`/`pFillRising`/`pFillAmplitude` | P(fill) priors per family | reach (when fetched) / band-depth heuristic / regime label / 2-leg daily reach | rank composite | reach-based ones inherit RC1; band-depth/regime ones are ❌ point-in-time | `estimateRank` |
| `askReachFactor` | two-leg exit-fill discount off ask-reach fraction, floored at 0.25 | reach fraction (recent-3 preferred via `reachRead` upstream) | every rank except `symmetric`-fillShape (churn/amplitude) | ✅ (inherits RC1) but SOFT-FLOORED — a stale mirage keeps ≥25% weight | `estimateRank` |
| `rateItem`/`regimeFactor`/`momFactor`/`liqFactor`/`capitalFactor` | risk-quality multiplier on the rank | `computeQuote` fields (regime, mom, volDay, mid) | every screened row | regime factor is ❌ single-window (regimeDrift); mom factor is 2h-only | screen grade |
| `capGrade`/`REACH_GRADE_CAP`/`THIN_GRADE_CAP`/`SUBFLOOR_GRADE_CAP`/`PHASE_BASING_GRADE_CAP` | letter-grade CEILINGS layered over the score | various | screen render | inherits whichever signal set the cap | screen grade cell |
| **Decision digest** `digestVerdict` | one-word triage (`sell unreliable` / `mirage top` / `weak deploy` / `starter…` / `fill-now` / `low-conviction`) | `reachFrac` (RC1 recent-3), `askPlacement` (whole-window CDF), `phase` (diurnal in/pre/post-peak), `weakDeploy` (ROI%) | every non-held, non-sub-floor candidate, `--digest` opt-in | ✅ for reach, ❌ for placement, n/a for phase (clock, not trend) | `screen-flip-niches.mjs --digest` |
| `digestReachAndPlacement` (POLISH 3) | stale-LIVE-print guard: recomputes reach/placement off the fresher `quickBuy` when the sell-side print is stale | daily-HIGH distribution, `row.quickStale` | digest only | ✅ (a freshness guard, not a trend guard) | digest |
| `capEfficiency`/`holdDays` | realizable ROI%/day, buy-limit-bounded | `estimateRank`'s `er` + `lapsCap` | digest ranking + display | inherits `er`'s recency profile | digest |

---

## 2. The stale-read census — ranked by damage

The mandate's anchor cases all share one shape: **a level/verdict computed from a backward
aggregate (median, quantile, mean-of-halves, "reached N/M days") stands in for "will this level
still print going forward," and the recent trajectory says no.** Ranked by how much money a stale
read burns, worst first:

### Tier 1 — will misprice or strand a BIG-TICKET exit/entry (highest damage: 10m+ per incident)

1. **`termStructure`'s durable floor (`floorValidator`, `valueAmplitudeValidator`, the value niche)**
   — a **pure q15/q85 quantile over the whole 14–28d lookback**, with **zero recency weighting of
   any kind**. This is structurally the SAME failure mode as the "every-day-reach 14/14" fang
   incident, just on the buy side and over a longer window: if the item re-priced 10 days ago, the
   floor keeps citing 10-day-old cheap prints for another 18 days. `classifyTrajectory`'s
   short-vs-long median comparison is the only recency signal anywhere near this path, and it isn't
   read by `floorValidator` itself (it's a separate validator key, informational by default). This
   is the single most under-protected stale-read surface in the repo, and it directly gates BUY
   decisions on value/big-ticket holds.
2. **`digestVerdict`'s "mirage top" rule (`askPlacement`)** — **FIXED (R5, PLAN-SIGNAL-RECENCY).** Two
   layers now close it: (a) the PRICE — `estimatePair`'s reach-fold gained a `fading`-cushion discount
   (`EST_FADE_DISCOUNT`, fed by R4's slope-based `reachMargin.trend` via `extra.askMargin`), so a clean
   3/3 reach whose cushion is decaying folds the Est-sell down EVEN when the raw hit-count reads full
   (the godsword / +412k bludgeon shape); absent the trend it's byte-identical. (b) the VERDICT —
   `digestVerdict` escalates the base "mirage top" to a HIGH-confidence `mirage top!` only when BOTH the
   recent-vs-full placement DIVERGENCE (`digestReachAndPlacement`'s directional `placementDiverges`, the
   whole-window-CDF analogue of RC1's recencySplit) AND a `fading` trend hold; either alone stays the base
   caution word, and the base placement/reach condition still gates (no wider blast radius). Kept for
   history: the pre-R5 rule was a whole-window CDF with no recency split, so a fading top still clearing
   the recent-3 bar sailed through — the Searing-page "+7.3% reaching p100/never-prints" shape.
3. **`asymPair`'s deep-bid/high-reach-ask** — both legs are **whole-14-day quantiles**
   (`quantLow`/`quantHigh`), with no recency check at all before `asymEstimate` ranks off them. On
   a regime-shifted item the p80 "reaches 11/14 days" ask can be entirely pre-shift days, same
   failure as the fang. Currently console/shadow-only (not published), which limits blast radius,
   but it is the ONE quoted price under `--asym`.
4. **`windowClear`'s within-window reach fraction** — same whole-window-reach shape as the core
   reach validator, but scoped to a narrower target window (so thinner samples, worse noise) and
   with **no recency split at all** (unlike `reachValidator`/`askExitRead`, which both fold RC1 in).
   Feeds the held big-ticket `windowExit` note directly.

### Tier 2 — mispositions grade/rank/sizing but is soft-floored or two-sided-guarded

5. **`askReachFactor`'s soft floor (0.25)** — deliberately never zeroes a stale exit (an honest
   false-negative guard against an n≈14 sample), but that means a 0/3-recent mirage still keeps
   ≥25% of its rank weight and can out-rank a smaller, real edge — this is exactly the mechanism
   `reach-fold.mjs`'s own header names as reason (a) the band sell-fold can't yet be removed.
6. **`regimeDrift`/`regimeLabel`** — ONE comparison (last-3-day median vs prior-14-day median),
   thresholded at ±5%. This is coarser than a slope: two items with the same ±5% headline can have
   opposite recent trajectories (still decelerating into the drift vs. just turned around) and
   `regimeLabel` cannot tell them apart. `floorCeilingTrack` (built later) fixes this exact gap for
   the floor/ceiling pair but was never retrofitted to replace `regimeDrift` as the gate/rank
   driver — `regimeDrift` still gates screen exclusion and feeds `rateItem`'s `regimeFactor`.
7. **`reachRelief`'s de-biased top (`dayHighFrom5m`)** — widens the sell reference toward a
   24h-max that is itself a **backward high-water mark**, not a forward-looking read; it is gated
   on liquidity+size (a reasonable guard) but the widening logic itself has no trend awareness — a
   24h high set on a now-collapsing peak still widens the quoted top.
8. **`trajectoryRead`'s blended-mid shape** (used only in quote-items' stdout note) — MEAN-blends
   the whole 14-day mid series into thirds to call rising/falling; this is the exact "mean-of-halves"
   shape the mandate calls out for `reachMargin`, except `trajectoryRead` computes it over the WHOLE
   window (not just a recent slice) and was superseded in spirit by `floorCeilingTrack` (per-track
   least-squares slope) — but `trajectoryRead`'s note still prints and can disagree with
   `floorCeilingTrack`'s note in the same output (see §3 redundancy map).

### Tier 3 — real damage but already-recency-aware or low-frequency

9. **`reachMargin`'s trend split itself (mean-of-older-half vs mean-of-newer-half over 7 days)** —
   **FIXED (R4, PLAN-SIGNAL-RECENCY): the trend is now `projectTrajectory`'s least-squares SLOPE of
   the cushion series, not the mean-of-halves** (the fitted first→last change vs `level ×
   MARGIN_FADE_FRAC`), and **R4b wired it onto the screen/digest** as the ask-side `trend` column
   beside reach ✓/✗ (it was quote/positions/CLI-only before). Kept for history: a mean-of-halves over
   7 days was coarser than a slope — a single volatile day at either end swung both halves' means, and
   a real linear decay read identically to a flat cushion with one noisy day. (Honesty caveat, R4's
   corrected finding: OLS gives the window ENDPOINTS *maximum* leverage, so the slope is not "robust to
   a single end-day"; its real merits are consolidation onto the one shared primitive + an all-days fit
   + the R5 unblock — see PLAN-SIGNAL-RECENCY R4's corrected test note.)
10. **`hourProfile`'s SHAPE read (dip/peak cluster) off the full-window de-trended deviation** — the
    shape is intentionally full-window (more samples = stabler cluster), while only the LEVEL
    quoted is recent-3. This is a deliberate, documented split (not an oversight) and is low-damage
    because `trendDominates` already exists as an explicit escape hatch.

### Not stale reads (correctly scoped already)
`computeQuote`'s Quick/Optimistic (2h + live only), `moveShape`/`underwaterHours` (2h/30h only),
`recentDirection`/`dipPostureValidator`/`flushSignal` (3h only), `diurnalForecast` (explicitly
refuses on `spike`/`decay`/live-band-violation), `floorCeilingTrack` (least-squares + explicit
floor-break + `run` duration field), `reachableBand`/`pressureModel` (recent-3 base + recent-7 IQR
band, per PB5).

---

## 3. Earns-its-keep verdicts + the redundancy map

### The "is it fading" cluster — FOUR signals answering overlapping questions differently

| Signal | Question it answers | Scope | Trend math |
|---|---|---|---|
| `trajectoryRead` | "what SHAPE is the 14-day mid series" | whole window, BLENDED mids | thirds-mean drift |
| `floorCeilingTrack` | "are the floor and ceiling tracks rising/flat/falling, INDEPENDENTLY, and did the floor BREAK" | recent-5-day slope + 13-day break lookback | least-squares slope + discrete break |
| `reachMargin` | "is the CUSHION over/under a specific level fading" | recent-7-day, split at the midpoint | mean-of-older-half vs mean-of-newer-half |
| `regimeDrift`/`regimeLabel` | "has the price LEVEL moved" (gate/rank driver) | last-3d median vs prior-14d median | single delta, no slope |

**Verdict: consolidate to `floorCeilingTrack`'s slope method as canonical; keep `reachMargin` as
the LEVEL-CONDITIONED specialization; retire `trajectoryRead`'s shape label; promote
`floorCeilingTrack`'s classification to replace `regimeDrift`'s gate role.** Detail:

- `floorCeilingTrack` is objectively the best-engineered trend primitive in the repo: independent
  floor/ceiling least-squares slopes, a discrete floor-break trigger, a `run` field that reports
  DURATION instead of a flip-prone 2-day read (the maul lesson, baked into its own header), and
  a phase-alignment guard against a forming/incomplete today bucket contaminating the slope. It was
  purpose-built to fix `trajectoryRead`'s exact blend-washes-out-the-signal failure — but it was
  ADDED BESIDE `trajectoryRead`, not IN PLACE OF it. Today quote-items prints BOTH notes on the same
  pass (`trajectory` then `fcTrack`), and they can visibly disagree (a blended-mid "falling" label
  next to a floor-flat/ceiling-falling "mild-cooldown" classification) with no reconciliation. This
  is pure redundancy — same inputs (`windowStats().days`), two labels, one strictly better.
  **Cut `trajectoryRead`'s shape label from the printed note (keep floor/ceiling/livePos, which
  `floorCeilingTrack` doesn't carry) or fold the two into one combined note.**
- `reachMargin` answers a DIFFERENT question (is THIS SPECIFIC level's cushion fading, not "is the
  item's floor/ceiling drifting") and earns its keep as a level-conditioned check — but its
  internal trend math (mean-of-halves) is a strictly worse version of `floorCeilingTrack`'s
  least-squares slope. **Recommendation in §4: re-derive `reachMargin`'s `trend` field from a slope
  over the per-day cushion series (reusing `floorCeilingTrack`'s `track()` helper against
  `cushion` instead of `low`/`hi`) instead of the current two-means comparison.**
- `regimeDrift`/`regimeLabel` is the OLDEST of the four and the only one with zero recency
  granularity (one before/after comparison, no slope, no duration). It still drives the
  falling-exclusion GATE (screen inclusion/exclusion) and `rateItem.regimeFactor` (the grade
  multiplier) — the two highest-leverage consumers in the whole rating pipeline. **This is the
  single best target for the "replace a stale aggregate with the recency-weighted primitive"
  mandate**: swapping `regimeDrift`'s single delta for `floorCeilingTrack`'s floor/ceiling
  classification (which already exists, already runs on the SAME `windowStats().days` shape,
  already has a `crash-risk`/`healthy-trend`/`cooling`/`mild-cooldown` vocabulary that is STRICTLY
  richer than flat/rising/falling) would fix the worst-scoped signal in the gate stack with almost
  no new code — see §4/§5.

### The est-pair vs Quick/Optimistic cluster

- **Quick/Optimistic** (`computeQuote`) is the model-FREE ground truth: live + 2h robust band,
  clamped, ordering-guaranteed. It should stay the console `--raw` fallback and the guaranteed base
  every other estimate clamps against. **Keep, unconditionally — every other pricing model in the
  repo is defined as a transform of this pair.**
- **`estimatePair`/`reachFoldModel`** is the "what would Ben actually post" synthesis — genuinely
  useful (it's the documented motive: stop hand-reconciling Optimistic∩diurnal∩reach∩anchor∩BE by
  eye every pass). **FIXED (R5): its sell-top fold now consumes the trend primitive** — a `fading`
  ask-side `reachMargin.trend` (R4's slope, passed via `extra.askMargin`) applies `EST_FADE_DISCOUNT`
  to tighten the top even on a clean 3/3 reach, closing the point-in-time-only gap (a 3/3-today reach
  that was 1/3 last week and heading for 0/3). The screen wires it; quote-items degrades byte-identical
  (no askMargin passed) until wired. Absent the trend the fold is byte-identical to pre-R5.
- **`pressureModel`** is a genuinely distinct idea (demand-BALANCE, not reach-count) and is
  correctly gated as a trial (never published, always shadow-logged against the neutral model). No
  action — keep as-is, it is the cleanest-scoped experimental surface in the estimator stack.

### Placement vs reach vs cushion

- **`placement`** (price→percentile) is a pure, cheap, honestly-labeled DESCRIPTIVE statistic
  ("where does this level sit in the distribution") — it explicitly disclaims being a fill model in
  its own header. It is the right primitive for the digest's `askPlacement` column, but the column
  is fed a WHOLE-WINDOW placement with no recency variant, which is the Tier-1 #2 gap above.
  **Fix: also compute placement over the recent-N slice and use the DIVERGENCE between the two
  (mirrors RC1) as the digest's actual mirage signal, not the raw whole-window number.**
- **`reachedDays`/`touchedDays`** (raw counts) are the base primitive everything above derives
  from — keep, they're cheap and correct for what they claim (a count, not a percentile, not a
  trend).
- **`reachMargin`'s `cushionNow`** is a distinct, useful, ALREADY-recency-scoped number (today's
  cushion) that nothing else in the repo computes — keep.

### Grade-cap sprawl

Five independent grade CEILINGS exist (`THIN_GRADE_CAP`, `REACH_GRADE_CAP`, `SUBFLOOR_GRADE_CAP`,
`PHASE_BASING_GRADE_CAP`, plus the churn/amplitude fold-exemption that effectively removes a cap).
Each is individually well-motivated and independently applied via the same `capGrade` helper (no
literal code duplication), but a reader has to hold five separate provenance stories to explain why
a printed grade is what it is. **Not a bug, but a documentation/legibility debt: the screen row
should carry a single `cappedBy` field naming which cap (if any) bound the printed letter**,
instead of the grade cell's `title` tooltip being the only place that's spelled out (and only for
some of the five).

### Dead / never-promoted signals worth naming honestly

- **`depthDays`/`clearableAsk`/`clearableBid`** (DE1/DE6) are fully-built, fixture-tested, and
  power ONLY the manual `--depth` inspector on `read-window-range.mjs`. They were explicitly staged
  to feed `estimatePair`'s held-lot sell (DE4) and never graduated. Not dead code (real, working,
  documented), but currently **inert relative to the main decision surfaces** — nobody reading a
  scan or a positions review benefits from this work today. Either graduate DE4 or say clearly in
  `PLAN.md` that depth-based pricing was tried and shelved (right now it reads as "still coming"
  indefinitely).
- **`weekdayProfile`** is genuinely new (no prior day-of-week tooling existed) but is amplitude-mode
  only and n≈3-4/cell — correctly labeled as a lean, but worth flagging that it's the thinnest
  sample of any signal in the inventory that still prints a number.
- **`demandRegime`/`hourlyPressure`** are well-built (Extension B) but console-inspector-only
  (`--pressure`); `reachableBand` is their only production consumer, and only under the
  never-published pressure trial. Same "inert relative to main surfaces" note as depth.

---

## 4. The recency-weighting proposal: ONE shared trajectory-projection primitive

**Scoping answer to Ben's question: yes, a single shared primitive belongs in `windowread.mjs`, and
it already exists in embryonic form as `floorCeilingTrack` — the fix is to GENERALIZE it and WIRE it
to more consumers, not invent a new module.**

### Why `floorCeilingTrack` is the right base, not a new build

`floorCeilingTrack` already has the three properties a recency-weighted primitive needs:
1. A **least-squares slope** over a recent window (not a mean-of-halves, not a single delta) —
   robust to a single noisy day (the "maul" 2-day-wiggle-isn't-a-trend lesson is baked into its
   own header).
2. A **discrete break trigger** (floor-break vs the prior lookback) that catches the fang/godsword
   "stepped under its multi-day trough" case a smooth slope alone would blur.
3. A **duration-reporting `run` field** so a caller states "flat over 5d, softened 2d" instead of a
   verdict that flips on the latest tick.

It is currently hard-coded to operate on the `low`/`hi` FIELDS of a `windowStats().days` entry (a
FLOOR and a CEILING). Generalizing it to accept an arbitrary per-day scalar extractor — exactly the
shape `reachMargin` already uses internally (`extremeOf`/`cushionOf`) — makes it the one shared
projection primitive:

```
projectTrajectory(days, extractFn, opts) → {
  latest, slope, dir: 'rising'|'flat'|'falling', run: {dir, len}, nUsed,
  break: { broke, latest, priorExtreme, gap, lookback } | null,   // optional, when a break test applies
}
```

- `floorCeilingTrack(days, opts)` becomes a two-call wrapper: `projectTrajectory(days, n => n.low, …)`
  + `projectTrajectory(days, n => n.hi, …)`, byte-identical output (a pure refactor, zero behavior
  change — should ship as its own small chunk with the existing `floorCeilingTrack` fixtures
  re-run against it).
- `reachMargin`'s `trend` field becomes `projectTrajectory(days, cushionOf).dir`, replacing the
  mean-of-halves comparison with the same slope+run math the floor/ceiling read already uses. This
  directly answers Ben's ask ("recency-weighted reachMargin across the whole app") — the fix is not
  a new algorithm, it's swapping `reachMargin`'s internal trend computation for the ALREADY-BUILT
  better one.
- **`regimeDrift`/`regimeLabel`** (the screen's falling-exclusion gate + `rateItem.regimeFactor`)
  becomes a THIRD consumer: instead of a single-delta flat/rising/falling label off 6h archive
  mids, gate/rank off `projectTrajectory`'s `dir` + `run` over the mid series — this is the
  single highest-leverage rewire because `regimeDrift` currently has ZERO recency granularity and
  drives both a hard gate (screen inclusion) and the grade multiplier.
- **`estimatePair`'s reach-fold** (the Est.-sell mirage source) gets a companion trend gate: fold
  toward live not just on a low POINT-IN-TIME reach fraction, but ALSO when the ask-side cushion
  trend (already available via `reachMargin`, now slope-based) is `falling` — i.e., "reaches
  3/3 today but the cushion is decaying" should fold the sell down even though the raw hit-count
  looks clean. This is the exact fix for the Searing-page-style mirage the digest currently misses
  (§2 Tier-1 #2): today `estimatePair` never even LOOKS at `reachMargin`, only at the point-in-time
  `askReach` fraction.
- **The digest's `askPlacement`/`mirage top` rule** gets the recent-vs-full placement divergence
  proposed in §3, computed off the SAME primitive's slope sign as a second confirming signal
  (placement diverging AND slope falling = high-confidence mirage; either alone = the current
  caution-only behavior).
- **`forecast.diurnalForecast`'s trend term** (`profile.trendPerDay`, currently a bare
  `slopePerStep` over the daily-low series) can be replaced by the same primitive's `dir`+`slope`
  fields for consistency, though this is lower-priority (the forecast module already has its own
  honest refusal gates and is the least stale-prone signal in the inventory).

### Contract for the generalized primitive

```
projectTrajectory(days, extractFn, {
  recentN = FC_RECENT_N,        // slope-fit window (existing FC_RECENT_N=5)
  minDays = FC_MIN_DAYS,        // fewer completed days ⇒ null, never a fake read (existing FC_MIN_DAYS=5)
  flatFrac = FC_FLAT_FRAC,      // |slope|/latest below this ⇒ 'flat' (existing FC_FLAT_FRAC=0.005)
  todayKey = null,              // phase-alignment guard — drop an incomplete forming day (existing)
  breakLookback = null,         // optional: run the discrete break test too (null ⇒ skip, e.g. for a cushion that has no natural "prior floor" concept)
} = {})
```

Inputs: the same `windowStats().days` shape every caller already has in hand (zero new fetch across
every proposed call site — `reachMargin`, `regimeDrift`, `estimatePair`, and the digest all already
compute or receive a `windowStats` result on the pass where they run). Outputs: `dir`/`slope`/`run`
always; `break` only when `breakLookback` is supplied. Degrades to `null` under `minDays`, matching
every other windowread primitive's honesty contract.

### Call sites, prioritized (see §5 for sequencing)

1. `floorCeilingTrack` → refactor onto `projectTrajectory` (no behavior change, proves the
   generalization is sound before anything downstream depends on it).
2. `reachMargin.trend` → swap mean-of-halves for `projectTrajectory(days, cushionOf).dir` (fixes
   Tier-3 #9, the mandate's named signal).
3. `regimeDrift`/`regimeLabel` gate + `rateItem.regimeFactor` → rewire onto `projectTrajectory`'s
   classification (fixes Tier-2 #6, the highest-leverage single change — touches the gate AND the
   grade).
4. `estimatePair`'s sell-top fold → add a trend-aware discount alongside the existing point-in-time
   reach fold (fixes Tier-1 #2, the literal Est.-sell mirage anchor case).
5. Digest `mirage top` rule → add the recent-vs-full placement divergence + the same trend sign
   (fixes Tier-1 #2's other half).
6. `floorValidator`/`termStructure` → the durable floor itself stays a quantile (that's the right
   tool for "where is durable support"), but ADD a `projectTrajectory` read over the same daily-mid
   series as a second gate input: a buy near a quantile-floor that is ALSO in a `falling`
   trajectory should caution/reject even when the raw quantile distance looks fine (fixes Tier-1
   #1, the single biggest unprotected stale-read surface in the repo).

---

## 5. Prioritized recommendation list (most mistake-prevention per unit of work first)

1. **Wire a recency trend check into `floorValidator`/the value-niche buy gate.** Highest damage
   (§2 Tier-1 #1), currently ZERO recency protection, and the fix is additive (a second gate input
   beside the existing quantile-distance check) — no existing behavior needs to change, just a new
   caution condition. Smallest risk of regressing a currently-correct read.
2. **Rewire `regimeDrift`/`rateItem.regimeFactor` off `floorCeilingTrack`'s classification** (after
   the `projectTrajectory` generalization in step 4 below, or directly reusing
   `floorCeilingTrack`'s existing two-track output before generalizing, if that's faster to ship).
   This is the single highest-leverage rewire: one gate, one grade multiplier, both currently
   blind past a single before/after delta.
3. **Generalize `floorCeilingTrack` into `projectTrajectory`** (pure refactor, fixture-provable,
   unlocks steps 1/2/4/5 as reuse rather than new algorithms each).
4. **Swap `reachMargin`'s trend field onto the generalized primitive.** Directly answers the
   mandate's literal ask; low risk (the existing `reachMargin` consumers — `askExitRead`,
   quote-items, `/positions`) already treat `trend` as an opaque fading/stable/extending label, so
   the consuming code doesn't need to change, only the label's derivation.
5. **Fold a trend-aware discount into `estimatePair`'s sell-top fold, and add the recent/full
   placement-divergence check to the digest's mirage rule.** These two together close the
   Est.-sell-mirage gap the mandate calls out by name (Searing page). Sequenced after 1-4 because
   they consume the generalized primitive rather than duplicating trend logic ad hoc.
6. **Cut or merge `trajectoryRead`'s printed shape label** in favor of `floorCeilingTrack`'s (now
   `projectTrajectory`-backed) classification — removes a redundant, weaker, sometimes-contradicting
   note with no loss of information (its floor/ceiling/livePos fields can ride alongside the
   classification in one note).
7. **Add a single `cappedBy` field to the screen row** naming which of the five grade ceilings (if
   any) bound the printed letter — a legibility fix, not a correctness fix, but cheap and removes a
   recurring "why is this graded B not A" investigation cost.
8. **Decide and document the fate of DE1/DE6 depth pricing and the Extension-B pressure/demand
   read** — either graduate one into a production consumer or mark it explicitly shelved in
   `PLAN.md` so it stops reading as "still coming."

### Single highest-leverage recommendation

**Generalize `floorCeilingTrack` into a shared `projectTrajectory(days, extractFn, opts)` primitive
in `windowread.mjs`, and rewire `regimeDrift`'s gate/rank role onto it first.** `regimeDrift` is the
most consequential stale-read in the repo by REACH (it gates screen inclusion and feeds every
graded row's regime factor), it currently has less recency granularity than any other trend signal
in the inventory (a single 3-day-vs-14-day delta, no slope, no duration, no break test), and the
better primitive already exists in the codebase today — it just isn't wired to the place that would
matter most. This one rewire touches the falling-exclusion gate, the letter grade, AND (once step 4
lands) the Est.-sell mirage path, for less new code than any other item on this list.
