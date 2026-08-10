# DT4 — does a split-half reliability gate select items whose diurnal window actually holds?

Study: `pipeline/experiments/dt4-window-gate-study.mjs` · run 2026-08-09 · 1h archive, last 45 days,
2,393 items with ≥21 distinct days · **read-only, no fetches**.

## The question

PLAN-DIURNAL-TRIAGE **DT4** proposes gating the rendered diurnal window on a per-item split-half
correlation: compute `r` on the per-hour shape, render the window when `r ≥ ~0.6`, otherwise print
"no reliable window". The triage had already measured that the window carries **~zero information for
a resting offer** in aggregate (71.2% vs 70.5% random). DT4's premise is that a *subset* of items is
different and that split-half `r` finds it. **That premise had never been tested** — which matters,
because a flat, quiet item correlates beautifully with itself, so a gate could select low-noise items
rather than genuinely-cyclical ones and nothing in the gate statistic would reveal the difference.

## Method — the gate and the test are deliberately on different axes

| | |
|---|---|
| **GATE** (parity split) | Partition the item's **fit-period** days into even/odd, run `hourProfile` on each half, Pearson-correlate the two 24-hour `devLow` vectors (and `devHi`). Interleaving in TIME means both halves see the same regime — a reliability measure, not a stability one. |
| **TEST** (temporal holdout) | Fit `hourProfile` on the first 2/3 of days; on each **held-out later day**, ask whether the fitted dip hour printed at/below that day's median low (and the peak hour at/above its median high). |
| **BASELINE** | A deterministic pseudo-random hour on the same day, which sits below the median ~50–52% of the time. **Only lift over this baseline counts.** |

**A leak was found and fixed mid-study, and it mattered.** The first version computed the gate over all
45 days — including the held-out third — so an item that happened to be stable in the test window got
both a higher `r` *and* a higher hit rate, manufacturing part of the correlation the study existed to
test. Restricting the gate to fit-period days is also the only honest simulation of live use. The leak
inflated lift by ~2–5pp; every number below is from the leak-free run.

## Result — the gate discriminates, and the relationship is monotone

| r bucket | n | dip hit | dip rand | **lift** | peak hit | peak rand | **lift** |
|---|---|---|---|---|---|---|---|
| r < 0.2 | 1860 | 61.1% | 52.5% | +8.6pp | 59.0% | 50.7% | +8.3pp |
| 0.2–0.4 | 284 | 60.5% | 51.9% | +8.7pp | 61.6% | 50.7% | +10.9pp |
| 0.4–0.6 | 157 | 62.9% | 52.6% | +10.4pp | 66.3% | 50.6% | +15.8pp |
| 0.6–0.8 | 83 | 67.5% | 54.2% | +13.3pp | 68.2% | 52.4% | +15.8pp |
| 0.8–1.0 | 9 | 82.6% | 52.1% | +30.6pp | 77.6% | 50.3% | +27.3pp |

**PASS (r ≥ 0.6), n=92:** dip +15.0pp · peak +16.9pp  
**FAIL (r < 0.6), n=2301:** dip +8.8pp · peak +9.2pp

Monotonicity across five buckets is the main reason to believe this is real rather than a threshold
artifact — a spurious gate has no reason to order itself.

Only **3.8%** of items clear `r ≥ 0.6` (the plan's estimate of "~90% become an honest absence" was, if
anything, conservative — it is ~96%).

## The confound was tested and refuted, in the opposite direction

The obvious objection is that high `r` merely proxies *quiet*. It does not — high-`r` items are the
**liquid** ones (median 1h volume **1077** vs **56** for gate-fail), and within every volume tertile the
gate still separates:

| volume tertile | PASS n / dip lift / peak lift | FAIL n / dip lift / peak lift |
|---|---|---|
| low | 19 · +23.7pp · +30.2pp | 767 · +15.2pp · +13.4pp |
| mid | 39 · +13.2pp · +20.3pp | 777 · +6.2pp · +7.6pp |
| high | 81 · +18.3pp · +21.6pp | 711 · +4.9pp · +5.8pp |

The gap is *widest* on high-volume items (+18.3 vs +4.9), which is the opposite of a quietness proxy.
(These tertile splits are from the pre-fix run; direction and ordering are what they are cited for.)

## What this does NOT show — read before acting on it

1. **It is a within-day HOUR-RANKING result, not a fill result.** "The dip hour printed below the day's
   median" is not "a resting bid placed at the dip hour fills more often". The DT triage measured the
   resting-offer question directly and found ~nothing. **Both can be true at once**: a resting offer
   spans many hours, so within-day timing washes out for it, while an *attended* buy-now-vs-wait
   decision is exactly where hour ranking would pay. This is consistent with DT2, which already made
   `softBuy`'s window an explicitly ATTENDED parenthetical.
2. **No gp or EV claim is made.** "Below the median" is a direction, not a magnitude. How much a 15pp
   ranking edge is worth in gp is unmeasured, and could be small on a tight band.
3. **The top bucket is n=9.** The 0.8–1.0 row should not be quoted on its own.
4. **PASS is only n=92 items.** Enough for a bucket comparison, thin for anything per-item.

## Recommendation — DT4 should NOT ship as specified

The gate works, but **gate-fail items still show ~+9pp of real lift**. Printing "no reliable window" on
them would suppress a signal that is weaker, not absent — trading a false-confidence problem for a
false-absence one. Two changes to the spec:

- **Modulate confidence, don't suppress.** Render the window either way; let `r` drive how it is worded
  (a reliable window vs. a weak/indicative one). This also avoids `/schedule` going ~96% empty, which
  was flagged as the main cost of the original design.
- **Label it as ATTENDED-only**, matching DT2 and finding (1) above. Nothing here supports using the
  window to place or price a *resting* offer, and the doctrine should keep saying so.

Threshold choice is a judgment call, not a measured optimum: the curve is smooth, so `0.6` is a
reasonable place to change the wording, not a cliff. **INFORM-ONLY, n≈0 for any trading claim.**
