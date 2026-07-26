# PLAN-FORECAST — forward 12h/24h price projection from hourly history

Untracked planning doc (2026-07-10). Per the fold-out discipline this file folds into
`PLAN.md` when scheduled and is deleted when its last chunk ships. Executor rules =
PLAN.md "Executor rules", verbatim.

## Intent

Today the hourly history is used only **descriptively**: `hourProfile`/`deriveDiurnalRange`
(`js/windowread.mjs`) say WHERE the daily dip/peak historically print and quote the recent
levels; `reachValidator`/`windowStats` say WHETHER a level was reached. Nothing ever
**projects forward**. Ben wants every thesis to be able to answer *"when will a profitable
entry/exit price appear?"* — canonically:

> **"Blood runes aren't buyable at a profitable price point right now, but based on
> historic hourly data they should be in ~4 hours."**

i.e. a projected trough **level** AND a projected **eta/time-of-day**, so a thesis can rest
a bid now or deliberately wait — plus the mirror read on the ask side for held-position
sell timing. This is cross-cutting (band, churn, scalp, value, positions, overnight), so
the #1 architectural requirement is a **standalone, pure, DOM/fetch/fs-free, node+app-shared
module** (the `js/windowread.mjs` / `js/quotecore.js` pattern) producing one forecast object
every surface consumes — never logic welded into one niche.

Rollout is **inform-only/provisional throughout** (the reach/trajectory validator playbook):
console-only surfaces first (no `APP_VERSION` bump), every threshold a NAMED PLACEHOLDER,
nothing gates on the forecast until the PF8 validation study reports calibration.

## The honesty core (process rule 4 — read this before any chunk)

This section is load-bearing; every chunk inherits it.

1. **What is forecastable here, and what is not.** OSRS prices carry EXOGENOUS shocks —
   game updates, meta shifts, news — that are **fundamentally absent from price history**.
   The `/scan` froth-entry doctrine already established this the hard way: the explosive
   first leg fires out of a flat-or-soft base from an exogenous catalyst with **no leading
   price/volume signal** (webweaver 07-01 anchor — nothing on 06-30 forecast it). The
   forecast therefore claims to project exactly TWO things and nothing else:
   **(a) the recurring diurnal shape** (the de-trended hour-of-day deviation `hourProfile`
   already measures) and **(b) the current multi-day trend, dumbly extrapolated**. It is a
   *"tomorrow rhymes with the last week"* model. It cannot predict ignitions, crashes,
   update reactions, or regime changes — and every surfaced line must read that way.
2. **Uncertainty travels with the number.** Every projected level carries an explicit
   band (per-hour historical dispersion + trend-extrapolation error) that **widens with
   horizon**; a 24h projection is honestly wider than a 12h one. The eta is quoted as a
   window (the dip/peak *cluster* span, per the existing Ghrazi cluster-don't-point-pick
   lesson), never a single minute.
3. **Loud degrade to NO FORECAST.** The model refuses to emit numbers when its own
   premises fail: thin/short series (< `HOURPROFILE_MIN_DAYS`), unreliable quote row,
   `phase()` = spike/decay (a post-shock shape is not the recurring shape), live momentum
   `breakdown`/`breakup` (the price is violating its own band *right now*),
   `trendDominates` on the side being projected (the trend has erased the dip — the
   existing Ghrazi guard, inherited, not re-derived). A degrade prints WHY.
4. **n≈0.** No forecast of ours has ever been scored. Every constant below is a NAMED
   PLACEHOLDER encoding the shape of the judgment, not a calibrated magnitude — same
   discipline as `estimators.mjs` (`{value, n, basis}` on every estimate). The PF8
   backtest is the calibrator; until it reports, `confidence` is a coarse ordinal
   (high/med/low) derived from sample coverage and dispersion, **not a probability**, and
   no thesis may gate on the forecast (inform-only everywhere, exactly like reach/
   trajectory at their rollout).
5. **A projected trough is not a fill.** "The low typically prints ~X at ~04:00" ≠ "your
   bid at X fills" — touched ≠ filled (the standing windowrange caveat), and the projected
   level is a 1h `avgLowPrice` aggregate, not a tick. The fill question stays owned by the
   reach/P(fill) machinery; the forecast adds the *when*, not fill certainty.

## Architectural decision — extend `deriveDiurnalRange` vs a new module

**Recommendation: a NEW `js/forecast.mjs` that CONSUMES `hourProfile`'s output, plus one
small additive extension inside `hourProfile` itself (per-hour dispersion fields).**

The case for extending `deriveDiurnalRange` instead (argued honestly):
- The forecast IS ~80% the diurnal read re-keyed onto a clock axis — dip/peak clusters,
  de-trended deviations, `trendPerDay`, the trend-dominates guard all already exist there.
  A separate module risks a second de-trending and a second slope implementation drifting
  from the first (the exact one-owner failure windowread was extracted to prevent).
- `deriveDiurnalRange` already returns bid/ask + windows; adding `eta` fields is a small
  diff, and every existing consumer (screen's Diurnal block, `windowrange --profile`)
  would inherit the forecast for free.

Why the new module still wins:
- **Separation of concerns, stated in windowread's own header.** `deriveDiurnalRange` is
  deliberately "PURE and tax-agnostic: timing math, not the quote engine". The forecast
  adds three concerns windowread deliberately does not have: a **trend model over a future
  time axis** (extrapolation, not description), an **uncertainty/confidence layer**, and
  **degrade doctrine coupled to quote-row state** (`phase`, `mom`, `reliable` — quotecore
  concepts windowread never imports). Welding those in turns a descriptive primitive into
  a policy module and bloats the contract of its three existing consumers.
- **The repo's own precedent is consumer-on-primitive.** `estimators.mjs` consumes
  computeQuote rows; `validate.mjs` consumes windowread + termstructure; `robustBand` is a
  primitive consumed by loadBands + computeQuote. A forecast is the same shape: a consumer
  that composes `hourProfile` (shape) + `regimeDrift`/`trendPerDay` (trend) + `phase`
  (degrade) into a new object.
- **Blast radius.** windowread is imported by `watch.mjs`, `windowrange.mjs`,
  `screen.mjs`, and `validate.mjs`. Keeping its exported contract byte-stable (additive
  fields only) means zero re-verification of those surfaces; a new module's bugs are
  contained to its own consumers.
- **The duplication risk is answerable**: `forecast.mjs` imports `hourProfile` and reads
  `profile.hours[*].devLow/devHi`, `profile.trendPerDay`, `profile.trendDominates` — it
  re-derives nothing. The ONE thing the profile lacks is per-hour **dispersion** (it keeps
  only medians), which is why PF1 adds two additive fields inside `hourProfile` rather
  than recomputing deviations outside it. That is the honest hybrid: primitive extended
  minimally where the data lives, model built beside it.

Location: **`js/`** (not `pipeline/lib/`) because held-position sell timing and a future
Trends-tab surface make the app a plausible consumer — the `windowread.mjs` precedent
(node- AND app-importable). Console-only consumers at rollout ⇒ no `APP_VERSION` bump
until an app surface actually imports it.

## The model (concrete, deliberately simple)

An interpretable **additive shape+trend** model — no ARIMA, no ML, nothing a table can't
explain (house preference; Bar E's sample-gated simple statistic is the anchor):

```
projLow(h)  ≈ baselineNow + trendPerHour·Δt(h) + devLow(h)     (bid side)
projHigh(h) ≈ baselineNow + trendPerHour·Δt(h) + devHi(h)      (ask side)
```

- **`devLow(h)`/`devHi(h)`** — the existing de-trended per-hour median deviations from
  `hourProfile` (each day's hours measured against that day's own median baseline, so
  multi-day drift can't contaminate the shape — already solved, reused as-is).
- **`baselineNow`** — today's baseline inferred from the live quote:
  `baselineNow = liveMid − devMid(currentHour)` (i.e. back out where today's day-median
  sits given where the live price is at this hour). This anchors the projection to NOW —
  the projection of the current hour reproduces ~the live price by construction, which is
  both the correct boundary condition and a free smoke test.
- **`trendPerHour`** — `profile.trendPerDay / 24` (the existing least-squares daily-low
  slope over the profile window), optionally cross-checked against `regimeDrift` for a
  sign disagreement (disagreement ⇒ confidence knock). This is ALSO the codified form of
  `/overnight`'s prose "decay-trend trough projection" (night-over-night low step,
  extended one night — the bludgeon 17.02m anchor): a negative slope + tonight's dip
  window IS that read, now computed instead of eyeballed (PF4).
- **Uncertainty band** — per hour: the historical spread of that hour's deviations across
  the window days (IQR of `devLow` samples — the new dispersion fields), plus a trend
  term that grows linearly with Δt (`|trendPerHour|·Δt·TREND_ERR_FRAC`, placeholder).
  Reported as `{lo, hi}` around each projected level; monotonically non-shrinking in Δt.
- **Outputs** — scan the projections over the next `horizonH` (12 and 24):
  `nextTrough = {level, band:{lo,hi}, etaH, atHours:[startH,endH), confidence}` (the min
  of `projLow` over the horizon, eta'd to its dip-cluster window) and the mirror
  `nextPeak` off `projHigh`. Optionally the full hour-indexed series for a table/chart.
  Plus the answer helper for Ben's canonical ask:
  `whenBuyable(fc, targetBid)` → `{etaH, atHours, projLevel} | null` — the first horizon
  hour whose projected low (band-adjusted) crosses at/under the target. `null` = "not
  within 24h on this model" — an honest, useful answer.
- **Confidence (ordinal, placeholder)** — high/med/low from: nights coverage (≥10 / ≥6 /
  else), per-hour dispersion vs amplitude (a dip that prints tightly vs sloppily),
  trend-vs-regime sign agreement, and `phase()==='base'`. NOT a probability (honesty §4).

**Input window — 7d vs 14d, reconciled.** Ben's spec says "past ~week"; `hourProfile`
defaults `nights=14`; the screen's Diurnal block already runs `DIURNAL_NIGHTS=7`. The
profile's own design already resolves the tension: SHAPE reads off the full-window median
(more samples per hour — at 7 nights each hour has ≤7 samples, thin), LEVEL reads off the
recent days. The forecast inherits that split: **shape/dispersion from up to 14d, anchor
from the LIVE quote (maximally recent by construction), trend from the recent ~7d slope**
— so the *level and direction* are week-fresh (Ben's intent) while the *shape* keeps the
larger sample. `nights` stays a caller option; surfaces pass what they already fetch.

**Degrade ladder (explicit, in-module):** no profile (<4 days) → null `no-profile`;
row `!reliable` → null `unreliable-quote`; `phase ∈ {spike, decay}` → null
`post-shock-shape` (the recurring shape is not in force); `mom ∈ {breakdown, breakup}` →
null `band-violation-live`; `trendDominates` against the projected side → **trend-only
mode** for that side (the dip claim is withdrawn; the eta is dropped, the level prices to
live — inheriting `deriveDiurnalRange`'s exact Ghrazi behavior) with a note; degenerate
peak≤trough → null `flat-window`. Every null carries its reason for the surface to print.

**Fetch discipline (zero new whole-market cost):** the model is pure over an
already-fetched 1h series. `screen.mjs` already fetches `ts1h` per surfaced survivor
(Leg B, `TS_TTL_1H` cached); `watch.mjs` already fetches `ts1h` per position
(`fetchItemInputs(id, {ts1h:true})`); `windowrange.mjs` fetches it by definition. Only
`quote.mjs` lacks it — PF2 adds a bounded per-explicit-item 1h fetch behind a flag first.

## Chunks

Order: PF1 (pure module + tests, SHIPPED) → **PF1b (corrective peak floor — do FIRST, it
changes the model every surface reads)** → PF2/PF3/PF4/PF5 (surfaces, parallel-safe —
disjoint primaries) → PF6/PF7 (estimator + validator hooks) → PF8 (validation study, the
gate on anything graduating past inform-only). All chunks: inform-only, console-only, no
`APP_VERSION`; docs pass per process rule 8 (README inventory entry for every new file;
CLAUDE.md time-of-day section gains a forecast pointer; skill `version:` bumps where a
skill's prose changes).

### PF1 — `js/forecast.mjs` (the pure model) + `hourProfile` dispersion fields + tests
**Primary files:** `js/forecast.mjs` (new), `js/windowread.mjs` (additive only),
`pipeline/forecast.test.mjs` (new).
**Deliverable:**
- `hourProfile` additionally returns per-hour `devLowSpread`/`devHiSpread` (IQR of the
  deviation samples) and `devMid` — additive fields; every existing field byte-identical
  (existing consumers unaffected; assert via the existing tests + a before/after diff of
  `windowrange --profile` output on a cached series).
- `js/forecast.mjs` exporting `diurnalForecast(profile, ctx)` → the object above,
  `whenBuyable(fc, targetBid)` / `whenSellable(fc, targetAsk)`, `fmtEta(etaH)`, and the
  named placeholder constants (`FC_TREND_ERR_FRAC`, `FC_CONF_*`, horizon defaults 12/24).
  Pure, DOM/fetch/fs-free, degrade-not-throw, imports only `windowread.mjs` (+ nothing
  from quotecore — `phase`/`mom`/`reliable` arrive as plain ctx values, keeping the
  dependency arrow pointing one way).
- Tests on SYNTHETIC series (the repo fixture style): (a) a clean sine-diurnal + flat
  trend series → trough eta lands on the constructed dip hour, level within the band, and
  the current-hour projection ≈ the constructed live price (the anchor boundary
  condition); (b) the same shape + a linear downtrend → trough level steps down by
  ~slope·Δt (the codified decay-trend projection); (c) a spike-shaped series → null
  `post-shock-shape`; (d) 3-day series → null `no-profile`; (e) trend-dominates → dip
  claim withdrawn; (f) band monotonically non-shrinking over the horizon.
**Acceptance (the canonical scenario):** a fixture series shaped like blood rune's diurnal
dip (constructed so the historical trough prints ~4h ahead of the fixture "now", below the
fixture break-even-profitable bid) makes `whenBuyable(fc, target)` return `etaH ≈ 4` with
a level at/under the target — i.e. the module can literally produce *"not buyable at a
profitable price now; should be in ~4 hours at ~X"*. Pin it as a golden.
**Risk/honesty:** the anchor inference (`baselineNow` from one live print) is the model's
softest joint — a momentarily-weird live print skews the whole curve. Mitigation: anchor
off the live MID with the reliability/momentum degrades in front of it; PF8 measures how
much this actually costs. Dispersion at 7–14 samples/hour is a small-sample statistic —
IQR not stdev, and confidence caps at `med` below 10 nights (placeholder).

### PF1b — quantile-FLOOR the projected peak (corrective; found live 2026-07-10)
**Status:** OPEN — for Fable to reconcile + implement. Amends PF1's shipped model on the
**ask side only**. PF1's own Risk/honesty note pre-flagged this ("the anchor inference
`baselineNow` from one live print is the model's softest joint — a momentarily-weird live
print skews the whole curve"); this is the first live instance, on the PEAK side, with a
concrete fix.

**Primary files:** `js/forecast.mjs` (the `nextPeak` construction, ~lines 156–171),
`pipeline/forecast.test.mjs` (new golden). `js/windowread.mjs` likely needs NO change —
the reachable levels already exist (`profile.peak.level`, per-hour `hiRecent`); confirm
before adding anything.

**The observed symptom (soul rune, id 566, 2026-07-10 ~02:00 local).** `diurnalForecast`
with `horizonH=8` projected `nextPeak.level ≈ 384` (band 382–386) and reported `@390 not
reached within 8h`. But the item's actual reachable high is ~**392–393** — the daily highs
run 391–397, `profile.peak.level = 393`, per-hour `hiRecent ≈ 392`. A *peak* forecast that
reads ~7–9 gp BELOW the level the market visibly prints every day is wrong on its face —
Ben flagged it immediately ("386 is way too low; we should be forecasting the reachable
high ~p85 off the highs").

**The diagnosis (confirmed by dumping the internals).** The model is
`projHigh(h) = baselineNow + trendPerHour·Δt + devHi(h)`:
- `devHi` at the peak hours ≈ **+4–5** (the high sits ~4–5 above the day's own mid
  baseline) — CORRECT, unchanged.
- `trendPerHour ≈ +0.019` (flat) — fine.
- `baselineNow = liveMid(381.5) − devMidCur(0.5) = 381.5` — **the culprit.** The live mid
  is a soft print right now (soul rune carried a `⬇DIP −2.1%` flag; live instabuy 382 sits
  below its own 386–394 band). The typical day mid is ~388. So the model anchors the ENTIRE
  curve ~6–7 gp low, and `projHigh = 381.5 + 5 ≈ 386` where the true reachable high
  `= 388 + 5 = 393`. **The whole shortfall is the depressed live anchor**, inherited with no
  mean-reversion — PF1 assumes the current dip IS the new baseline and carries it forward.

**Why this is a peak-side-specific fix, not "rip out the anchor."** The live anchor is a
deliberate, correct boundary condition (the +0h projection reproduces the live price) and
on the TROUGH side inheriting a live move is often WANTED — a rising floor erasing an
intraday dip is the Ghrazi lesson the code already handles via `trendDominates` → trend-only
mode. The asymmetry to encode: **a projected PEAK must never read below the level the highs
are actually reaching**, because a soft live mid is not evidence the ceiling dropped (only a
`breakdown`/`mom` violation is, and that already degrades to NO FORECAST). So: floor the
peak to the reachable-high quantile; leave the trough/anchor/Ghrazi machinery untouched.

**Proposed fix (Fable to reconcile the exact form).** On the ask side, compute a
**reachable-high quantile** and floor the projected peak to it:
- `reachableHigh` = ~**p85 of the daily highs over the peak window** (Ben's stated basis).
  The profile likely already carries this — prefer reusing `profile.peak.level` (the recent
  peak-window level `deriveDiurnalRange` computes) and/or a p85 over per-hour `hiRecent`,
  rather than recomputing quantiles outside `windowread`. Confirm which is the honest p85
  and reuse it (Bar-E robust-quantile discipline: dense side → quantile, sparse → raw
  extremum; the standing system-wide rule).
- `nextPeak.level = max(projectedPeak, reachableHigh)` — the diurnal+trend projection can
  still exceed the historical high (a genuine uptrend), but a soft live anchor can no longer
  drag it BELOW what highs reach. When the floor binds, tag the mode (e.g.
  `mode:'reachable-floor'`) and note it so the surface is honest that the number came from
  the high distribution, not the trend extrapolation.
- **Mirror question for Fable to decide, don't assume:** does the trough want a symmetric
  `min(projectedTrough, reachableLow=p15)` floor? Argument FOR: symmetry, a soft-high live
  print shouldn't fake a deeper dip. Argument AGAINST: the trough side's live-inheritance is
  sometimes the wanted Ghrazi behavior, and PF1 already routes that through `trendDominates`.
  Recommendation: apply the reachable floor to BOTH sides but keep it SUBORDINATE to the
  existing `trendDominates`/trend-only branch (that branch wins when it fires); the floor
  only corrects the ordinary-mode level. Reconcile against PF1's existing trough logic.
- **Boundary-condition guard:** the floor applies to `nextTrough`/`nextPeak` (the horizon
  min/max), NOT to the +0h series point — the "+0h reproduces live" smoke test in PF1's
  tests must still pass. Verify the golden (a) anchor assertion is untouched.

**Acceptance:** re-running the soul-rune forecast (`horizonH=8`) lands `nextPeak.level ≈
392–393` (at/near `profile.peak.level`), and `whenSellable(fc, 390)` now returns a hit
within the horizon. Add a synthetic golden: a series whose live anchor is depressed ~2%
below its typical mid but whose historical highs are stable → the projected peak floors to
the reachable high, not `depressed-mid + devHi`. PF1's existing goldens (anchor boundary,
downtrend step, spike→null, trend-dominates) stay byte-identical.

**Honesty:** still pre-PF8, still inform-only, thresholds (the p85 choice) are NAMED
PLACEHOLDERS. This does not claim the model is now calibrated — it fixes a structural
wrong-direction error (peak below reachable high) that no amount of calibration would cure,
because it's a formula-shape bug, not a magnitude-tuning one. Note in the `forecast.mjs`
header that the peak is quantile-floored and WHY (this session's soul-rune anchor).

**Docs/registry (rule 8):** `forecast.mjs` header gains the quantile-floor note;
`pipeline/forecast.test.mjs` gains the golden; no README inventory change (no new file); no
`APP_VERSION` (no app import); no skill bump (no skill prose changes — PF1b is internal to
the model PF2–PF5 will surface). CHANGELOG line on ship.

### PF2 — `quote.mjs`: the blood-rune answer on an explicit ask
**Primary files:** `pipeline/quote.mjs`.
**Deliverable:** `--forecast` flag (explicit-item reads only, NOT `--positions` batch):
fetches `ts1h` for the named items (bounded — an explicit ask is a handful of items; the
uncached `fetchTs` + existing `sleep` pacing), runs `diurnalForecast` with the row's
`phase`/`mom`/`reliable` ctx, and prints a **Forecast** line per item:
`Forecast (diurnal+trend, ±band, inform-only): trough ~X (±Y) in ~4h (03:00–06:00) · peak ~Z (±W) in ~11h · conf med`
— and when the item is not currently buyable under its profitable bid (caller passes
`--target <gp>`, or default = the thesis-relevant level), the explicit sentence: `not at
target now — projected ≤ target in ~4h`. Degrades print their reason
(`no forecast — post-shock shape (decay)`). Default (flagless) run is byte-identical —
quote's no-1h-fetch contract is preserved until PF8 earns default-on.
**Acceptance:** `node pipeline/quote.mjs "Blood rune" --forecast` emits the canonical
statement shape against live data (level/eta values are whatever the market says).
**Risk:** flag-gated fetch-semantics change; smallest chunk. The main risk is prose
overclaiming — the line must carry `inform-only` + the band, per honesty §2/§4.

### PF3 — `screen.mjs`: eta on the Diurnal-timing block
**Primary files:** `pipeline/screen.mjs`.
**Deliverable:** the existing per-pick Diurnal line gains the forward read — FREE, the
`series1h` is already in hand: `… BID 210 (dip 03:00–06:00, **next ~4h**) · ASK 225
(peak 14:00–16:00, **next ~11h**) · conf med`. `★` criteria unchanged (the forecast
informs, it does not re-grade); stdout-only, NOT in `screen.json` (no app contract
change). A degraded forecast leaves the line exactly as today.
**Acceptance:** a `--mode band` run shows etas on the Diurnal block; `screen.json`
byte-identical (replay goldens untouched — render-stage only).
**Risk:** line-length creep on the compact output; keep the eta token terse. Parallel-safe
with PF2/PF4/PF5 (disjoint primaries).

### PF4 — codify `/overnight`'s decay-trend trough projection
**Primary files:** `pipeline/windowrange.mjs`, `.claude/skills/overnight/SKILL.md`
(version bump).
**Deliverable:** `windowrange.mjs --forecast` prints the module's trough/peak projection
under the existing profile/window output (same 1h series, zero new fetch), including the
trend-component decomposition (`trend −120/day → tonight's projected floor ~17.0m`) — the
mechanical form of the v1.10 prose ("read the step size, extend it one night"; bludgeon
anchor). `/overnight`'s fill-realism step then says: run the forecast read on every
candidate bid and price at/just above the projected floor — replacing the eyeball
instruction with the command, keeping the prose judgment ("one item, ~4 nights" honesty)
as interpretation. Note the deliberate tension: `/overnight`'s projection case is
POST-SPIKE DECAY, which PF1's degrade ladder refuses (`post-shock-shape`) — so
`--forecast` in windowrange exposes the **trend-only mode** explicitly for that case
(slope extension without the diurnal claim), which is exactly what the prose projected.
The skill documents that split honestly: decay → trend-only floor projection; base →
full shape+trend forecast.
**Acceptance:** on a decaying item, `--forecast` prints a trend-only projected floor ≈
last window low + one night's slope step; on a based item, the full trough/peak forecast.
**Risk:** the decay case extrapolates the most breakable component (a decay can stop any
night — mean-reversion to base is not in the model). The trend-only output must carry
its own louder caveat (`decay trend-extension — can overshoot the base; floor at the
pre-spike base B is the sanity bound` — base from `phase().baseMid` when available).

### PF5 — watch/positions sell-timing line
**Primary files:** `pipeline/watch.mjs`, `pipeline/quote.mjs` (`--positions` path),
`.claude/skills/positions/SKILL.md` (version bump), `pipeline/MONITORING.md`.
**Deliverable:** each held-lot note block gains one inform line off the already-fetched
`ts1h`: `sell-timing: peak window 14:00–16:00, next in ~11h — projected ~Z (±W) vs BE Y`
(and on a bid row, the trough mirror). Explicitly decision SUPPORT in the V6 advisory
class — never a verdict/alert input (`momVerdict`/gate tree untouched); the V5 emit
contract (sell/list-at + BE always emitted) unchanged. `quote --positions` gets the same
line only where `ts1h` is present (it isn't today → degrades silently; do NOT add a batch
1h fetch to positions in this chunk).
**Acceptance:** a watch pass on a held item prints the peak-eta line; verdict output
byte-identical otherwise.
**Risk:** the positions surface is where over-trusting a projection costs real gp
(holding for a projected peak that a regime break eats). The line must sit AFTER the
verdict, phrased as timing-of-listing support, and the degrade ladder (breakdown ⇒ no
forecast) protects the worst case by construction.

### PF6 — forecast-informed TTF in `estimators.mjs`
**Primary files:** `pipeline/lib/estimators.mjs`, `pipeline/screen.mjs` (thread
`extra.forecast`).
**Deliverable:** `ttfIntraday` gains a third basis between `velocity` and the volume
prior: when `extra.forecast` carries a trough eta for the quoted bid (`whenBuyable` at
`pair.bid`), TTF ≈ eta-to-fillable + a sell-leg allowance (placeholder), returned as
`{value, n:0, basis:'forecast-eta'}` — the `n:0` says loudly it's model-derived, not
measured. `screen.mjs` passes the PF3 forecast through `extra` (the `extra.reach`
precedent); quote/watch pass none → byte-identical degrade. Velocity (real measured fills)
still outranks the forecast basis when present.
**Acceptance:** screen `--stats`/rank column shows `basis forecast-eta` rows; with the
forecast absent, ranks byte-identical to today.
**Risk:** this quietly moves rank ordering (TTF is the rank denominator) on an
unvalidated model — the most consequential integration. Mitigation options, decided at
execution: ship behind `--forecast-ttf` (off by default) until PF8, or clamp the
forecast TTF to never differ from the prior by more than ×2 (placeholder). Default to
the flag — rank stability matters more than early signal (Ben-vetoable).

### PF7 — forecast-reachability validator (inform-only)
**Primary files:** `js/validate.mjs`, `js/strategies.mjs` (spec plans).
**Deliverable:** `forecastValidator` in the registry: given ctx (profile/forecast + the
thesis's quoted bid/ask), annotate when the model says the posted level should NOT print
within the horizon (`bid below every projected low ≤24h → 'would caution: forecast says
unreached ≤24h'`) or when it prints imminently (`≤2h → supportive note`). Registered
`inform` in EVERY spec's validator plan (never `gate` — that promotion is PF8-gated,
mirroring trajectory's inform-everywhere start). Distinct from `reachValidator` and
documented as such in the header: reach scores the PAST (did the level print?), forecast
scores the PROJECTED future (when should it?) — complementary, and a disagreement between
them is itself a caution-worthy note.
**Acceptance:** screen inform notes show `ℹ forecast …` lines; zero rows dropped by it
under any spec.
**Risk:** validator-note noise on an already-dense footer; batch it into the existing
`ℹ trajectory/reach` note line rather than a new class.

### PF8 — the validation study (the graduation gate)
**Primary files:** `pipeline/forecast-backtest.mjs` (new, gitignored outputs), doc note
in `PLAN.md`/`CHANGELOG.md` on completion.
**Deliverable:** backtest against held-out actuals: for each archived day D and a panel of
items (the Tier-1 SQLite archive + `.cache` series; the daily archive is backfilled
~20d — enough to START, honestly thin), build the profile from data ≤ D-1, forecast D's
trough/peak, score against D's actual 1h lows/highs. Report per item-class (liquid
commodity vs thin big-ticket) and per horizon (12h vs 24h): trough **eta error**
distribution (|projected − actual| hours), **level error** (in % and in ticks vs the
after-tax edge — an error bigger than the edge means the forecast can't price entries),
**band calibration** (what fraction of actuals landed inside the ±band — target the band's
nominal coverage), and **degrade honesty** (did spike/decay days it refused actually
forecast worse?). Written up with n per cell; NO threshold tuning in the same pass that
reports (look-ahead discipline).
**Acceptance/graduation criteria (pre-committed, so the study can't be argued into
success):** the forecast may graduate a surface past inform-only ONLY where its cell shows
eta error median ≤ ~2h AND level error median meaningfully inside the after-tax edge AND
band coverage within ±15pts of nominal, at n ≥ 30 item-days per cell (the O1/F1 gate
style). Cells that fail stay inform-only with the failure noted in the surfaced line's
caveat. Until PF8 reports: nothing gates, PF6 stays flagged, PF7 stays inform.
**Risk/honesty:** ~20 days × panel is a SMALL sample spanning one meta-period; weekday/
weekend diurnal differences alone eat degrees of freedom (the overnight skill's v1.15
full-day check exists for that reason). The first report will likely justify only "etas
are/aren't roughly right on liquid commodities" — that is still exactly the blood-rune
use case, and claiming only that is the point.

## Dependencies / parallelism

- PF1 blocks everything (SHIPPED).
- **PF1b blocks the surfaces too** — it corrects the model's peak output, so land it before
  PF2–PF5 quote numbers off the old (wrong-direction) peak. Small diff, `forecast.mjs`-only.
- PF2, PF3, PF4, PF5 are mutually parallel-safe (disjoint primary files); each depends
  only on PF1 + PF1b.
- PF6 depends on PF3 (the threaded forecast object); PF7 depends on PF1 (and lands best
  after PF3 so its notes are visible somewhere).
- PF8 depends on PF1 only (it can and should start accruing while surfaces land), but its
  REPORT gates any promotion in PF6/PF7 and quote's default-on.

## Docs / registry pass (rule 8, per chunk)

- `README.md` inventory: `js/forecast.mjs`, `pipeline/forecast.test.mjs`,
  `pipeline/forecast-backtest.mjs` at creation.
- `CLAUDE.md` "Time-of-day context" bullet: add the forecast pointer (the diurnal block
  gains etas; the doctrine home is the `forecast.mjs` header — keep CLAUDE.md small, per
  the docs-small memory).
- Reconciliation grep: `/overnight` v1.10 trough-projection prose (superseded by PF4's
  command), `estimators.mjs` header's "band edges are the best available forecast proxy
  today" (PF6 revises), MONITORING.md "What each tick surfaces" (PF5 line).
- Skills: `/overnight`, `/positions`, `/scan` version bumps where their prose changes;
  never `APP_VERSION` (no app import in this plan; a future Trends-tab surface would
  bump it + need the browser smoke).
