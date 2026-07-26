# PLAN-OUTPUT-TABLE — reach-folded Estimated buy/sell + confidence

Status: DRAFT (2026-07-13, Ben-directed). Owner: this session. Console-only, provisional.
Folds into `PLAN.md` and is deleted the moment its last chunk ships (per CLAUDE.md's plan-file rule).

## Motive (Ben, 2026-07-13)
The market table's `Quick` + `Optimistic` cells are two *theoretical, model-free* price pairs
the operator has to reconcile by hand into the one number he actually posts. All session, the
price handed to Ben (e.g. `bid 6.06m → ask 6.27m, targeting the evening peak`) has been
`Optimistic ∩ diurnal-timing ∩ reach-check ∩ anchor-nudge ∩ BE-floor`, synthesized manually
every pass. We already compute every ingredient (`robustBand`, `asymPair`, `diurnalForecast`,
`reachValidator`). This plan promotes that synthesis into two first-class columns —
**`Est. buy` / `Est. sell`** — so the table emits the number you act on, not the raw ingredients.

## The core idea — fold reach INTO the price, don't caveat beside it
> **AMENDED 2026-07-18 (PLAN-ESTIMATOR-POSTURE AC1, extended by AC5/AC6): the "fold reach INTO the
> price" premise is now PER-NICHE, and CHURN NO LONGER FOLDS EITHER LEG.** It was over-folding the BUY
> leg on the BAND niche — a quiet-band day collapsed real patient band flips to "+1 (BE-floored)"
> because the band-low bid folded up toward live whenever its recent touch-reach was low. The band
> niche is a "ladder the band low, sell the band top" play — non-immediate fill is the STRATEGY, not a
> mispriced buy. So the split is now: **BAND (asym) PRICES the band low and ANNOTATES its
> fill-probability** (reach token + placement percentile `4/14 · p36`), exactly as the SELL side
> annotates, and **still folds a stale sell top down** (the mirage guard, KEPT — AC7). **CHURN
> (symmetric) is now EXEMPT on BOTH legs** — AC5 forces its sell fold factor to 1 and AC6 deleted its
> buy-fold branch, because the day-level reach read mismeasures a tight symmetric lap and the codebase
> already skips it for rank + grade (Super restore(4)-class rows un-floored from `+1` to a real net;
> `foldExempt:'symmetric'` marks them for F1). The reach-FOLD itself now surfaces as a VALIDATION
> DATA POINT in `read-window-range.mjs` (AC8), not a discovery-price mutation on churn. The rank
> absorbs the fill-probability the band price no longer hides (bid reach → P(fill) → a rarely-filling
> deep bid ranks down), and the overnight sort is reach-aware (AC9). ~~CHURN still FOLDS its buy toward
> live~~ (superseded by AC6). The paragraph below is the ORIGINAL global framing, kept for the record.

An honest `Est. sell` is NOT the optimistic band top; it is the price you'll *actually clear at*,
**discounted by reach**. The godsword mirage (24.44m ask reaching 4/14d) collapses to its
reachable ~24.09m (12/14d), so its `Est. net` collapses and it stops grading S+ — the estimate
self-corrects the mirage-exit trap that we vetoed twice on 2026-07-12. Same on the buy side:
`Est. buy` is the reach-realistic acquisition price (what actually prints), not the artifact band
floor that never fills. `Net/u (ROI)` computed on the `Est. buy → Est. sell` pair is therefore the
**honest expected margin** — the single number that separates a real edge from a mirage.

## Definitions (the estimator)
New reconciliation layer, home in **`js/estimators.mjs`** (node+app importable; the existing
`asymPair`/`asymEstimate`/`askReachFactor`/reach machinery already lives here or is imported).
It is a PURE function over the already-computed `row`/`ctx` (zero new fetch):

- **`estBuy`** = the reach-realistic bid: reconcile `robustBand` low (`optBuy`), the diurnal dip-window
  BID, and the `asymPair` deep-bid, weighted by their touch-reach (`reachValidator` bid leg). Never
  below a level that fails the two-sided/artifact guards. Anchor-nudge to the fillable side of a round
  number (existing `⚓` logic) as a final step — nudge, never override.
- **`estSell`** = the reach-realistic ask: reconcile `robustBand` high (`optSell`), the diurnal
  peak-window ASK, and the `asymPair` reachable ask, discounted by the ASK reach (`askReachFactor`
  is exactly this discount and already exists). **BE-floored** — never emit `estSell < breakEven`.
- **`estNet` / `estRoi`** = after-tax net on the `estBuy → estSell` pair (bond-aware via the existing
  `netMargin` opts).
- **`confidence`** = carried WITH the price (Ben, 2026-07-13), not a separate column. Render as a
  compact reach/quality token on the sell price, e.g. `6.27m (12/14d)` or a graded glyph
  (`●●●`/`●●○`/`●○○`) off the combined bid-reach × ask-reach × sample-size. Exact encoding is an
  implementation choice — see Deciding Points.

## Row layout (screen)
`Item · Guide · **Est. buy** · **Est. sell** · **Net/u (ROI)** · **BE** · Vol/d · Momentum · Regime · Grade`
- `Est. buy`/`Est. sell` REPLACE `Quick`+`Optimistic` **on the screen only**.
- `BE` is the **honesty anchor** — the one model-free number in the row; `Est. sell < BE` is the
  estimate self-reporting "no trade" (Ben confirmed BE is load-bearing here).
- `Net/u (ROI)` is on the ESTIMATED pair, not the raw band.
- Momentum/Regime/Grade/Guide unchanged.

## Held-lot surfaces are INTENT-DIFFERENT — do NOT collapse there
On `quote.mjs --positions` and `watch.mjs` the operative "best price" is the **list-at** (already the
Verdict's number) plus the **clear-now** price (`Quick` sell = the CUT/downside bound). So:
- KEEP `Quick` on `--positions`/`watch` as the clear-price floor (it is a real held-lot decision input).
- The held-lot "recommendation" stays the Verdict's list-at; optionally surface `estSell` as the
  list-at candidate, but the Verdict/thesis frame still governs. Do not delete Quick there.

## Model-free escape hatch
Add a **`--raw`** flag to `screen.mjs` (and `quote.mjs`) that restores the `Quick`+`Optimistic`
model-free columns — for the passes where the placeholder model is distrusted and the operator wants
the honest arithmetic underneath. Default is the new estimated view.

## Honesty guards (process rule 4 — NON-NEGOTIABLE)
1. `Quick`/`Optimistic` are model-free arithmetic; `Est. buy/sell` bakes in diurnal/reach/forecast
   models whose thresholds are **placeholders (n≈0–14)**. The table MUST label the estimated columns
   as estimates (header suffix or a one-line footer), and `--raw` MUST exist.
2. Confidence rides IN the row (per Ben) so a placeholder-model number never reads as gospel.
3. BE stays model-free and is never overridden by the estimate.

## Scope — CONSOLE-ONLY first (no APP_VERSION bump)
Ship on `screen.mjs`/`quote.mjs` stdout ONLY, provisional + placeholder-labeled — the same path
`value`/`scalp`/`asym` took. The app Scan tab / `screen.json` payload is UNCHANGED this chunk (so
NO `APP_VERSION` bump, replay goldens unaffected). App-parity (rendering Est.buy/sell in the Scan
tab, which needs the estimator client-side + an APP_VERSION bump) is a deferred follow-up, explicitly
OUT of this chunk. Confirm the render change is stdout-only and `screen.json` bytes are identical.

## F1 calibration hook
The suggestion→fill join already accrues in `suggestions.jsonl` → `analyze.mjs`. Add lean
`estBuy`/`estSell`/`estConfidence` shadow fields to the logged suggestion so the retro can later score
"did `Est. sell` predict the realized sell" — the estimated pair IS the thing the retro scores. No
retune here; F1 owns calibration. Node-only field → no APP_VERSION bump.

## Test + doc checklist (part of the chunk, per process rules 2 + 8)
- `node --check` every touched `js/*.js` + `pipeline/*.mjs`.
- New `estBuy`/`estSell` fixtures in `pipeline/quotecore.test.mjs` or `pipeline/estimators.test.mjs`:
  a mirage-exit case (ask reaches 4/14d ⇒ `estSell` discounted below the raw top, `estNet` collapses),
  a clean case (dense two-sided ⇒ `estSell` ≈ raw top), and a BE-floor case (`estSell` clamped to BE).
- Run `node pipeline/screen.mjs --mode all` and `node pipeline/screen.mjs --mode all --raw` — confirm
  the new columns render and `--raw` restores Quick/Optimistic.
- Confirm `screen.json` bytes UNCHANGED (publish path untouched) — grep/diff a `--publish` before/after.
- Docs: update CLAUDE.md "Market analysis workflow — standard output format" (the Quick/Optimistic
  bullet) to describe Est.buy/sell + the console-only/`--raw`/placeholder framing; add the
  `PLAN-OUTPUT-TABLE.md` file to `README.md`'s inventory; reconcile any doc that calls Quick/Optimistic
  the primary price cells.

## REVISIONS (Ben, 2026-07-13 — post-first-implementation, before push)
Three changes decided after reviewing Fable's first pass. None has shipped/pushed yet.

1. **Confidence token → RECENT-3, not `(live)`.** The span-0 `(live)` fallback is dropped. Show the
   **recent-3-night reach** (`2/3`) as the PRIMARY confidence token, in the same idiom as the full
   `2/14` — it's the freshness-honest signal (the godsword read `(2/14)` fine but its recent reach was
   0/3 = the mirage). We already compute the RC1 recency split (`windowread.mjs` recent-3 beside the
   full window) → zero new work. When recent and full DIVERGE sharply, show BOTH (`2/3 · 12/14`) —
   that divergence IS the stale flag. Recent-3 is the confidence; the full window is the sample-size
   backstop.
2. **estBuy/estSell become STRATEGY-AWARE (via the already-threaded `spec`).** A blanket estBuy
   formula contradicts the P4c per-strategy architecture (entry placement is per-niche: scalp bids
   near live to fill; value bids the trough/floor; band ladders the band-low; falling doctrine differs
   per niche). `estimatePair(spec, …)` already threads `spec` but ignores it — WIRE IT UP so the entry
   defers to the spec's entry doctrine: **scalp → near-live**, **value → trough / declared-exit-
   anchored**, ~~**band/churn → the reach-folded band edge**~~ (SUPERSEDED — AC1 un-folded band, AC6
   un-folded churn; both now price the band low, and churn's sell fold is exempt too — AC5).
   estSell is thesis-aware too: when a lot has a DECLARED thesis (hold-thesis.json, e.g. seed's 6.27m
   evening-peak exit), estSell anchors to the **declared exit**, not the generic reach-folded band top.
   All per-strategy placements stay NAMED PLACEHOLDERS (F1 calibrates).
3. **Deep bids stay OPTIONALITY — never folded into estBuy (keep Fable's exclusion, new rationale).**
   A deep flush bid (asym deepBid, ~4/14d) is NOT a thesis — it's rest-and-see optionality — so it
   doesn't belong inside any expected-price number. It stays the separate `◆ asym` "rest as
   optionality" line. This is now derived from the strategy model ("no strategy posts a 4/14-flush bid
   as its expected entry"), not a standalone blanket rule. Document it in the `estimatePair` header.

## Deciding points to escalate (don't guess these)
- **Confidence encoding**: `(12/14d)` numeric vs `●●○` glyph vs a `%`. (Lean: reuse the existing
  `N/14d` reach idiom the notes already print — least new vocabulary.)
- **Estimator reconciliation weights**: how `robustBand` vs diurnal vs `asymPair` combine into the one
  estimate. All placeholder; pick a simple, documented default (e.g. reach-weighted mean, clamped to
  the band) and label it PLACEHOLDER.
- **`--raw` default**: confirm the NEW estimated view is default and `--raw` is the opt-out (not vice
  versa).
