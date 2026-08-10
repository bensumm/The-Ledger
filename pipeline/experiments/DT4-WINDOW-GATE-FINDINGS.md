# DT4 — does a split-half reliability gate select items whose diurnal window actually holds?

Study: `pipeline/experiments/dt4-window-gate-study.mjs` · **numbers below are the CORRECTED run
(2026-08-09, second pass)** · 1h archive, last 45 days, 2,010 items with ≥21 distinct days ·
**read-only, no fetches**. Every table here is printed by the script as committed.

> **AS-OF PIN — a re-run will NOT match digit-for-digit, and the earlier "run it and compare" invitation
> was wrong to imply it would.** These are the archive as it stood ~20:00 local on 2026-08-09. The script
> has no `--as-of`: it always takes the last 45 days from `MAX(ts)`, and the archive grows continuously,
> so the panel shifts under it. A re-run ~2h later gave 2,022 items / 89 PASS / PASS +14.3pp / FAIL
> +3.2pp / **t ≈ 4.8, not 5.6**. What reproduces: PASS ≈ +14–15pp vs FAIL ≈ +3pp, strict monotonicity,
> ~4.5% pass rate, the ~14% tie rate, both covariates. What does not: third significant figures and the
> exact `t`. **Quote the direction and the gap; do not quote `t = 5.6` or `± 2.0` as if pinned.**

> **This document was rewritten after review found a real estimator bug in the first version. The
> correction moved the headline enough to change what the study recommends.** Both errors are described
> below rather than quietly fixed, because the first version's numbers were already quoted in a commit
> message and someone may have read them.

## The question

PLAN-DIURNAL-TRIAGE **DT4** proposes gating the rendered diurnal window on a per-item split-half
correlation: render the window when `r ≥ ~0.6`, otherwise print "no reliable window". The triage had
already measured that the window carries **~zero information for a resting offer** in aggregate. DT4's
premise is that a *subset* of items is different and that split-half `r` finds it. That premise had never
been tested — and a flat, quiet item correlates beautifully with itself, so a gate could select low-noise
items rather than genuinely-cyclical ones with nothing in the gate statistic to reveal the difference.

## Method

| | |
|---|---|
| **GATE** (parity split) | Even/odd **fit-period** days → `hourProfile` each half → Pearson-correlate the two 24-hour `devLow` vectors (and `devHi`). Interleaving in time means both halves see the same regime: a reliability measure, not a stability one. |
| **TEST** (temporal holdout) | Fit `hourProfile` on the first 2/3 of days; on each **held-out later day**, did the fitted dip hour print at/below that day's median low (peak hour at/above its median high)? |
| **BASELINE** | A deterministic pseudo-random hour **on the same day, scored on the same days**. Only lift over this baseline counts. The draw is uniform over 24 hours and is NOT excluded from picking the fitted hour, so ~1/24 (measured 4.14%) of baseline draws ARE the fitted hour and score as a hit. That contaminates the baseline TOWARD the treatment, i.e. the study is **conservative** by ~4%: true lift ≈ observed ÷ 0.959 (PASS ≈ +14.9, FAIL ≈ +3.3). No conclusion moves. |

### Two bugs found in this study, both corrected here

1. **The leak (found during the first pass).** The gate originally used all 45 days including the
   held-out third, so an item that happened to be stable in the test window got both a higher `r` *and* a
   higher hit rate — manufacturing part of the correlation the study existed to test. Gate is now
   fit-period-only, which is also the only honest simulation of live use.
2. **The asymmetric denominator (found by review, after the first write-up shipped).** A day was counted
   whenever the *fitted* hour printed, but the random arm only scored when the *random* hour printed — so
   a missing random hour was silently counted as a miss. Hours are absent ~11–13% of the time, and **more
   often on illiquid low-`r` items**, so the bias ran *with* the gate and inflated the reported lift.
   Scoring is now **strictly paired**: a day counts only when both hours printed, so both arms share one
   denominator. This did not move PASS much (+15.0 → +14.8pp) but it cut FAIL by nearly two thirds
   (+8.8 → +3.2pp) — i.e. it hit precisely the number the old recommendation rested on.

Also fixed: `medVol` was computed over all days (a covariate leak, in the study whose headline is a leak
fix) and is now fit-period-only.

## Result — the gate discriminates, and more sharply than the first pass reported

| r bucket | n | dip hit | dip rand | **lift** | peak hit | peak rand | **lift** |
|---|---|---|---|---|---|---|---|
| r < 0.2 | 1496 | 59.8% | 57.7% | +2.1pp | 58.6% | 56.2% | +2.3pp |
| 0.2–0.4 | 269 | 60.4% | 54.7% | +5.7pp | 61.5% | 53.5% | +8.0pp |
| 0.4–0.6 | 154 | 63.0% | 54.1% | +8.9pp | 66.3% | 52.4% | +13.8pp |
| 0.6–0.8 | 82 | 68.0% | 54.9% | +13.1pp | 68.0% | 53.7% | +14.2pp |
| 0.8–1.0 | 9 | 82.4% | 52.8% | +29.6pp | 77.7% | 51.8% | +25.9pp |

**PASS (r ≥ 0.6), n=91:** dip +14.8pp · peak +15.4pp  
**FAIL (r < 0.6), n=1919:** dip +3.2pp · peak +4.1pp  
**Item-level gap PASS−FAIL = 11.3pp ± 2.0pp (1 SE), t ≈ 5.6.** Strictly monotone on both sides across
all five buckets. Only **4.5%** of items clear `r ≥ 0.6`.

**The random baseline is ~53–58%, NOT ~50%** — the first write-up claimed ~50–52% and was wrong. Scoring
is "at or below", and **13.8% of scored day-obs are exact ties** (illiquid items whose `avgLowPrice` does
not move), all of which count as hits. Ties fall in both arms identically so the *lift* is unaffected,
but no absolute rate here should be read against a 50% coin flip.

## Confounds — one refuted, one REAL and previously missed

| | PASS | FAIL |
|---|---|---|
| median 1h volume | 1253 | 109 |
| median amplitude % | **4.55%** | **8.49%** |

- **Volume: refuted, backwards.** High-`r` items are the *liquid* ones, and the gate still separates
  inside every volume tertile — most strongly in the high-volume one (dip +18.5pp vs +2.9pp).

  | tertile | PASS n / dip / peak | FAIL n / dip / peak |
  |---|---|---|
  | low | 14 · +9.6pp · +8.2pp | 647 · +4.3pp · +3.8pp |
  | mid | 23 · +8.9pp · +17.7pp | 662 · +2.6pp · +3.9pp |
  | high | 54 · +18.5pp · +15.9pp | 610 · +2.9pp · +4.7pp |

- **Flatness: NOT refuted — and the first write-up missed it entirely.** Gate-pass items have roughly
  **half** the intraday amplitude of gate-fail items (4.55% vs 8.49%). The original worry was *flatness*,
  not volume, and answering only the volume form while declaring "the confound is refuted backwards" was
  an overclaim. Being right about the direction of the hit-rate does not establish the edge is worth
  anything in gp: a highly-predictable hour on a 4.5%-amplitude item may be worth less than an
  unpredictable one on a 8.5%-amplitude item.

## What this does NOT show

1. **It is within-day HOUR RANKING, not fills.** "The dip hour printed below the day's median" ≠ "a
   resting bid at that hour fills more often". The triage measured the resting-offer question directly
   and found ~nothing. Both can hold: a resting offer spans many hours so timing washes out, while an
   *attended* buy-now-vs-wait decision is where ranking would pay. Consistent with DT2, which already made
   `softBuy`'s window an explicitly ATTENDED parenthetical.
2. **No gp or EV claim.** Direction, not magnitude — and the flatness finding above is a direct reason to
   doubt that the magnitude is large.
3. **Top bucket is n=9; PASS is n=91 overall.** Fine for a bucket comparison, thin per-item.

## Recommendation — REVISED, and weaker than the first version

The first write-up said "do not ship DT4 as specified" because gate-fail items still showed ~+9pp. **That
number was an artifact; the true figure is +3.2pp, so that argument is largely gone.** The gate is a much
better discriminator than the first pass reported (≈4.6× the lift, t ≈ 5.6).

What survives, and it is now a judgment call rather than a measurement verdict:

- **Suppression as specified is defensible.** A +3.2pp edge on gate-fail items is small, and if the goal
  is to stop presenting noise as a timing signal, suppressing it is a reasonable trade. I would no longer
  argue against it on the evidence.
- **Confidence-modulation still looks better, but for a different reason than before.** Not "fail items
  are nearly as good" (they aren't) — rather that suppression removes a small-but-real signal from most of
  the board, and a wording change captures most of the honesty benefit at none of that cost.
  **Correction to how that cost was quantified:** an earlier draft said "~95% of window coverage", which
  is the ITEM-weighted figure. Gate-pass items are ~12× more liquid (median 1h volume 1253 vs 109) —
  i.e. disproportionately the ones actually quoted. Volume-weighted, PASS is **~11%** of the panel (and
  ~16% among the 50 most-liquid items), so suppression hides the window on ~89% of trading-weighted
  attention, not ~95%. The argument survives; its one quantitative figure was 2.5× off and is corrected.
- **Either way, keep it ATTENDED-only,** and do not let the ranking edge imply gp value while the
  flatness confound stands unmeasured. The highest-value follow-up is not a threshold argument: it is
  measuring what the ranking edge is actually worth in gp on the items that pass.

Threshold choice is a judgment call, not a measured optimum — the curve is smooth, so `0.6` is a
reasonable place to change wording, not a cliff. **INFORM-ONLY, n≈0 for any trading claim.**
