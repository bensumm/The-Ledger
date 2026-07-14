# PLAN-LIQUIDITY-REACH — liquidity/size-conditioned reach, de-biased at the top

Status: **SHIPPED 2026-07-13** (`js/estimators.mjs` `reachRelief` + `dayHighFrom5m`, wired into
`estimatePair`'s sell fold + the `screen.mjs`/`quote.mjs` stdout `reach-relief` notes; `askReachFactor`
takes an optional `relief` arg but `estimateRank` calls it SINGLE-ARG so the app-published grade/sort is
byte-identical → no APP_VERSION bump; the LOW-liquidity mirage discount is pinned byte-for-byte by the
gating fixture in `pipeline/estimators.test.mjs`). Console-first, provisional, placeholder-calibrated
(n=1 soul-rune anchor), F1-gated for magnitudes. Folds into `PLAN.md` and is deleted with its last chunk.

## Threshold re-check under corrected volume (PLAN-VOL24 tie-in, 2026-07-13)
`reachRelief` was implemented while the broken `/24h` endpoint was still the default volume source, so it
was effectively INERT (a real 1.5m/d book read ~65k < the 100k floor → relief never fired). PLAN-VOL24
step 2 made the corrected rolling-24h the default `screen.mjs` volume, so `reachRelief` receives TRUE
volume for the first time — the thresholds were re-checked against the corrected two-sided volDay
distribution (p50 146 · p75 3,265 · p90 62,357 · p95 250,541 · max ~19m) and **KEPT** (not adjusted):
- `REACH_RELIEF_MIN_VOL = 100_000` (≈ **p92-93**) — cleanly above the mid-liquidity mass (p90 62k) so
  relief fires ONLY for the genuinely-liquid top ~7%, and robustly above any mirage-class thin book
  (few-hundred/d). This is the INTENDED "deep liquidity only" cutoff, not an artifact of the old deflated
  calibration.
- `REACH_RELIEF_FULL_VOL = 1_000_000` (≈ **p97**) — a graduated relief ramp across the liquid tail; the
  soul-rune anchor (~10m TRUE volDay) sits comfortably saturated (full liquidity factor), consistent with
  the pinned `reachRelief(25k, 5m) = REACH_RELIEF_MAX` fixture (which requires `FULL_VOL ≤ 5m`).
- `REACH_RELIEF_SIZE_FULL/ZERO = 0.02/0.10` — dimensionless, UNCHANGED; under corrected volume a normal
  buy-limit position is ≪ flow (size factor ≈ 1) while a genuinely large position (≥ 10% of flow) still
  gets relief 0 — verified live: Dragon arrow 2.03m/d @ 0.5% of flow → 75% softening; Opal bolts 115k/d @
  9.5% of flow → **0%** (the size gate governs, exactly as designed).
- Decision rationale: the values are SANE in true units, and adjusting them would over-tune to a single
  snapshot (process rule 4). They stay labeled PLACEHOLDER (n=1); F1 owns the magnitudes. NOTE: `quote.mjs`
  per-item still reads the broken `/24h` volume (deferred vol24 quote/watch fix), so reach-relief there
  fires off deflated numbers until that lands — the SCREEN surface is the corrected one.

## Motive (Ben, 2026-07-13 — the soul-rune desk investigation)
Ben deep-bid Soul rune (25k @ 381, the 14-day band low) and listed near the top. The tool
discouraged the top ask: `reach ask 396/398 reached only 4/14d → would caution`, and the est-sell
reach-fold discounts the top. Ben's challenge, which the data backs:

1. **Our realized-sell history can't bound the ceiling — it's confounded by our own listing.** We
   top out at 398 because we *listed* 398, never because the market refused higher. Unconfounded
   evidence = the market's own daily highs: Soul rune printed **400 twice in 14d** and 396–397
   routinely (`windowrange "Soul rune" --window 0-23 --nights 14`).
2. **Depth-at-percentile scales with volume — so liquidity lets you push SIZE to a higher
   percentile.** `fillable size at price P in time T ≈ throughput(P) × T`. On a 100/day book the
   87th-pct price has a trickle of throughput (can't clear 50u there); on a 10M/day book that same
   percentile swallows 25k. **The percentile you can realistically target is governed by
   `position_size ÷ volume`, not by reach-frequency alone.** Reach measures *how often the price is
   there*; it does not measure *how much of your stock clears when it is*.
3. **`avgHighPrice` averaging hides the peaks a resting ask actually fills at.** The reach metric is
   built on the wiki's `avgHighPrice` — a volume-weighted bucket average. If a few units print 400
   and many print 395 in a bucket, the data records ~396; the true 400 tick is averaged away. A
   resting LIMIT ask executes against the raw tick, not the average — so it fills at peaks reach
   literally cannot see. **Reach is therefore a biased-LOW estimator of top-fill probability**, and
   "reaches 1/7d" both understates frequency and mis-states the mechanism ("days to wait" is wrong;
   the price is a bucket average that doesn't cover the intraday peaks).

Net: the reach-fold **over-penalizes the top for a LIQUID, small-relative-size ask**. For Soul rune
(25k ≈ 5% of the limiting-side daily flow, hyper-liquid, flat regime, deep entry) the honest read is
"list near the top; depth clears you and the true peaks come more/higher than the averaged reach
says" — which reach currently punishes.

## HARD CONSTRAINT (Ben, 2026-07-13 — non-negotiable) — reach MUST keep working for LOW-liquidity items
Reach-fold was BUILT to catch the thin-big-ticket **mirage exit** (the Ancient-godsword p90 band top
reaching 2/14d that would grade S+ off a mirage). That protection is the reason the whole mechanism
exists. **This change must be CONDITIONAL on liquidity + relative size and leave the low-liquidity /
thin-big-ticket reach discount BYTE-FOR-BYTE INTACT.** The softening applies ONLY where depth
genuinely clears the position; a thin book (where `size/volume` is large, or absolute volume is low)
keeps the full existing discount. Verify this with a preserved godsword-class fixture: a thin item
with a 2/14 ask reach must still discount exactly as it does today. If in doubt, DON'T soften.

## The fix (two parts, both conditional on liquidity/size)

### Part A — condition the ask-reach discount on `position_size ÷ volume`
Today `askReachFactor(askReach)` (`js/estimators.mjs`) is a flat linear map `reachFrac 0→0.25, 1→1`,
independent of liquidity or size. Introduce a **liquidity/size relief** that SOFTENS (moves toward 1)
the discount only when the position is small relative to throughput at the target price:
- Define a relief factor from `sizeRatio = intendedUnits / limitingVolPerWindow` (or an available
  proxy — see Deciding Points). Small ratio on a liquid book → relief↑ (discount → milder); large
  ratio or low absolute volume → relief 0 (discount unchanged = today's behavior).
- Relief is CLAMPED so it can never RAISE the top-fill weight above the raw reach when volume is thin;
  its floor recovers today's `askReachFactor` exactly (absent size/vol inputs ⇒ byte-identical).
- Placeholder constants NAMED (e.g. `REACH_LIQ_RELIEF_*`), n small, F1 owns the magnitude. The relief
  is monotone in liquidity and monotone-decreasing in size — assert both in tests.

Note: churn (`fillShape:'symmetric'`) already SKIPS `askReachFactor` in the RANK
(`estimateRank`, `js/estimators.mjs` — "sells into continuous two-sided flow"). Part A therefore
mainly affects (i) the **est-sell PRICE reach-fold** in `estimatePair`, and (ii) the reachValidator
NOTE — the surfaces that still discourage a top ask on a liquid item. Map the exact call sites; do not
double-apply.

### Part B — de-bias the top: stop reading peaks off `avgHighPrice` alone
Investigate whether a LESS-SMOOTHED high is available and use it to correct the averaging bias:
- The **24h endpoint's `highPrice`** is a period MAX (not a bucket average) — a candidate de-biased
  ceiling signal already in hand on most surfaces.
- `/latest` gives the instantaneous high.
- If a genuinely raw-tick high is NOT retrievable from the wiki data (the 5m/1h series only exposes
  `avgHighPrice`/`avgLowPrice`), then Part B degrades to a **liquidity-scaled clamp-widening**: widen
  the reach's top reference toward the 24h `highPrice` by an amount that grows with liquidity, so a
  liquid book's reach top isn't pinned to the smoothed `avgHighPrice`. Document whichever path the
  data supports; do NOT invent a raw-tick field that isn't there.
- Part B must ALSO be liquidity-gated: a thin book's `avgHighPrice` is already close to its sparse
  raw prints (little averaging to undo), so the de-bias is ~0 there — the mirage protection is
  unaffected.

## Scope & APP_VERSION (read carefully — there is an app-ripple trap)
- **Prefer NODE/CONSOLE-ONLY.** Keep the change in the est-view reach-fold path (`js/estimators.mjs`
  `askReachFactor`/`estimatePair`, `pipeline/screen.mjs` render-stage) so `screen.json`/the app
  Finder are byte-identical → **no APP_VERSION bump**, replay goldens unaffected.
- **`js/validate.mjs` `reachValidator` IS app-imported** (`js/trends.js` renders it on the Trends
  Diurnal-timing surface — CLAUDE.md). If the fix changes `reachValidator`'s emitted status/text, that
  ripples into the app and **DOES require an APP_VERSION bump**. Preferred: implement the liquidity
  relief in the NODE consumers and leave `reachValidator`'s computation untouched (it stays the honest
  raw reach; the RELIEF is applied by the caller when forming the note). If an app-imported behavior
  change is unavoidable, FLAG IT and bump `APP_VERSION` (`js/state.js`) with a one-line note.
- Provisional + placeholder-labeled everywhere it surfaces (same discipline as est-view/asym/value).
- Lean shadow fields on `suggestions.jsonl` (e.g. `reachRelief`, `sizeRatio`, `debiasedTop`) so the
  F1 retro-join can later score whether the relaxed top actually filled. No retune here — F1 owns it.

## Honesty guards (process rule 4 — NON-NEGOTIABLE)
- The microstructure LOGIC is sound (depth ∝ volume; averaging hides peaks) but the MAGNITUDES are
  unvalidated (n≈14 market days, n=16 of our own confounded lots). Everything ships provisional +
  placeholder; no number is presented as calibrated.
- There is still a REAL ceiling (Soul rune won't sell at 500) — relief must not imply "list
  arbitrarily high." Cap the de-biased top at the observed 24h `highPrice`, never above it.
- `size/volume` is the governing ratio, NOT liquidity alone — a 500k-unit position on a liquid book
  must NOT get the relief (its size exhausts the depth). Assert this.

## Test + doc checklist (part of the chunk, per process rules 2 + 8)
- `node --check` every touched `js/*.js` + `pipeline/*.mjs`; run `node pipeline/run-tests.mjs` green.
- New fixtures in `pipeline/estimators.test.mjs` (+ `validate.test.mjs` if the note path changes):
  1. **LOW-liquidity mirage PRESERVED** — a thin item, 2/14 ask reach, large `size/volume` → the
     discount is BYTE-IDENTICAL to today (the godsword guard). This is the gating test.
  2. **HIGH-liquidity small-size relief** — liquid item, small `size/volume`, 4/14 ask reach → the
     discount SOFTENS toward 1 (relief > 0), est-sell top lifts, but never above the 24h `highPrice`.
  3. **HIGH-liquidity LARGE-size no relief** — liquid item but `size/volume` large → relief ≈ 0
     (size governs, not liquidity alone).
  4. **Absent size/vol inputs → byte-identical** to today's `askReachFactor` (degrade-to-model-free).
  5. Part-B de-bias: `avgHighPrice` < 24h `highPrice` on a liquid book → top reference lifts toward
     `highPrice`; on a thin book → ~no change.
- Confirm `screen.json` bytes UNCHANGED for the app path (diff a `--publish` before/after) UNLESS an
  app-imported `reachValidator` change was deliberately taken (then bump APP_VERSION + note it).
- Docs: update CLAUDE.md (the reach/two-leg-P + est-table bullets) to describe the liquidity/size
  conditioning + the `avgHighPrice` de-bias, keeping the LOW-liquidity mirage-protection statement
  intact and prominent; add this file to `README.md` inventory; reconcile the `askReachFactor` header
  and the `robustBand`/reach headers.

## Deciding points to escalate (don't guess these)
- **`sizeRatio` denominator**: limiting-side `volDay`, per-window volume, or throughput-at-price? Pick
  the one actually in hand at the reach call site; label PLACEHOLDER.
- **`intendedUnits` source**: held-lot qty (quote --positions) vs a screen default (buy-limit? a
  nominal?). On the discovery screen there is no position — relief there may key off `buyLimit` or be
  OFF entirely (discovery isn't holding size). Decide per-surface.
- **Part B data availability**: is a less-smoothed high actually retrievable, or is the 24h `highPrice`
  clamp-widen the only honest option? Investigate before implementing.
- **App ripple**: can the relief live entirely in node consumers (no `reachValidator` change)? Confirm;
  that's the no-APP_VERSION path.
