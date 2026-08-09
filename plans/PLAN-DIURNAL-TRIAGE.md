# PLAN-DIURNAL-TRIAGE — what to do about the hour-of-day machinery

Status: DT3 SHIPPED (2026-08-09). DT1 + DT2 authorized by Ben and in progress. DT4–DT6 NOT authorized —
proposed only, Ben's call. Do not delete this file until DT4–DT6 resolve.
Evidence: three independent harnesses, 2026-08-09. Reports in the session tmp dir —
`HOURLY-WINDOW-FEASIBILITY.md`, `ADVERSARIAL-DIURNAL.md`, `HOURPROFILE-RELIABILITY.md`
(plus `verify-hw.mjs`, my own leakage-corrected check).

## The one-paragraph finding

The hour-of-day machinery splits into four pieces with four different verdicts, and they were
never distinguished before because they all live in the same modules. The per-hour **slope**
(`hourlyDrift`) is dead. The dip/peak **window** (`hourProfile`) is real but weak for the median
item, genuinely valuable for an identifiable ~8–10% minority, and **carries no information at all
for a resting offer**. The **amplitude lane's 1-day-cycle premise is refuted** and is currently
surfacing S+/A- grades on rows whose cycle has essentially never completed in-horizon. And the
piece nobody was doubting — **reachability/placement percentiles** — is the one measured to be
well-calibrated forward, so the existing WINDOW-CLEAR pricing doctrine is vindicated.

## Evidence summary (carry the numbers, they are the whole argument)

**Slope — dead.** Leakage-clean, production `hourlyDrift` days=3: median per-item MAE 276.7bp vs
197.8bp for predict-no-change; beats no-change on **6 of 380 items**. No window length fixes it
(days=4/7/14 all lose); an hours-anchored window is cleaner measurement of the same non-signal; a
dynamic window's own selected length changes day-over-day for the median item on 43% of days.
Direction is **49.7% — zero information, not negative**: the earlier "43–46%, worse than a coin
flip" was a design artifact (3-point least squares makes the fitted slope share its `m_D` term with
the target, forcing corr = −0.5 under pure noise → 33.3% sign agreement by construction; Monte
Carlo on pure noise reproduced 38.7%).

**Window — weak ungated, strong gated.** Even/odd split-half r = **0.10** median, replicated exactly
against production code (not a harness artifact). Forward: day-T cheapest hour lands in the
predicted dip window 19.3% vs 16.4% chance (×1.17); dearest in peak window 17.4% vs 13.1% (×1.33).
Ungated capture ≈ **2–5% of the daily range ≈ 7–11bp** — against a 200bp tax, never decision-moving.
Gated on pre-computable split-half r ≥ 0.6 (~8–10% of item-days): buy hit 31.3% vs 23.2%, sell 34.5%
vs 20.5%, capture **11–25% of range = 26–52bp = 45–53k gp/unit on a ≥10m item**. The gate is
monotone across buckets and must be recomputed live (half-to-half persistence 59% — do not
whitelist). Static features do NOT predict reliability (log price 0.07, log volume 0.03,
amplitudePct **−0.14** — a wider band is *less* reliable, not more).

**Resting offers — the window is worthless, confirmed twice independently.** At the production
`dip.level`, P(touch inside predicted window | touched at all) = **71.2% vs 70.5% for a random
window of the same width**. Waiting forfeits ~29% of bid fill-days and ~40% of ask reach-days at
*identical price*. The red team reached the same conclusion by a different route: first-touch timing
of a resting bid shows no window concentration (14.6% vs 15.9%). **The window predicts where the
extremes land, not when an offer fills.** Rest-all-day strictly dominates; windows are for attended
market-taking only.

**Amplitude lane — premise refuted.** Production `amplitudeRanges`/`amplitudeGate`, 92 items ≥5m,
4,881 item-days. Entry fires 56.9% of the time, but **completion within 24h given entry = 4.8%**
(≤48h 11.4%, ≤96h 22.6%, ≤7d 34.6%). Median completion when it happens at all: **~69h ≈ 3 days**,
not 1. `pFill2leg` predicted ≥0.25 → realized ~5%: the two-leg independence assumption is measured
false. Trough-touch entry is measured adverse selection (unconditional ask-reach ≤48h is 43.1% vs
11.4% conditional on entry — a ~4× haircut). Strand mark at +48h −643k across 2,114 strandings;
**EV per entered cycle −813k**. The gate barely discriminates (7.4% vs 4.9% done-24h). Named rows
from today's live board: **Saturated heart 0% completion at 96h, 5% at 7d** while advertising
+5.88m/cycle; Old school bond 6.8% at 24h; Masori chaps least bad at 12.9%/24h but **71% at 7d** —
i.e. a ~weekly oscillator, which independently confirms the standing `multi-week-oscillator-class`
note (fang, ~6–8d period).

**Reachability — the winner, and it was never in doubt.** Forward calibration is near-identity and
monotone: past-touch 10% → 21.8%, 30% → 35.5%, 50% → 53.2%, 80% → 73.2%, 100% → 94.1% (sell side
50% → 38.1%, 90% → 72.5%, 100% → 87.9%), with honest mean-reversion at the tails. Recent-3 tracks
regime better than the 14d count. `askReach.decaying` — already computed, never surfaced as a
signal — predicts next-day ask reach 12.2% vs 30.8%, and survives stratifying on yesterday's reach
(at prev 70–100%: 18.6% vs 68.3%; n=5,096 signals / 293 items).

**Ceiling on all of it.** An oracle knowing the true next-day day-mean change scores 141.3bp against
the 197.8bp baseline — perfect day-level foresight buys ~28% of the error (~42% on big-ticket).

## Chunks

| # | Chunk | What | Surfaces | Risk |
|---|---|---|---|---|
| DT1 | ✅ **SHIPPED 2026-08-09 (0.71.5)** — **Amplitude: stop grading a 1-day cycle** | Re-horizoned `AMP_HOLD_DAYS_DEFAULT` 1 → 4; `pFill2leg` DELETED (independence measured false). Its intended replacement `cycleCompletion` was built, measured on the live board, and **REJECTED as a rank input** — saturated by construction (median-vs-median over a multi-day horizon ≈94%; board read 18/19 incl. Saturated heart 5/5 against a study measuring it 0%/96h). `pFillAmplitude` now returns the bare 0.5 prior at n=0; the figure survives DISPLAY-ONLY as the asymmetric `ask-reprints X/Y` | `js/amplitudescreen.mjs`, `js/estimators/families.mjs`, `screen-flip-niches.mjs` | Highest value. Real fix for the ordered joint = PLAN-BOTH-LEG-ENTRY BL1 (needs sub-day tLo/tHi) |
| DT2 | ✅ **SHIPPED 2026-08-09 (0.71.4)** — **Resting-offer cue: drop the wait-for-the-window advice** | `softBuy` render is LEVEL-FIRST, cue reworded to place-at-the-level, window moved to a trailing parenthetical labelled ATTENDED. Computation untouched — same floor, threshold, marker, floor-aware cue tree | `softBuyRead`/`formatSoftBuy` (`js/windowread.mjs`), `/positions` 1.56 + `/scan` 1.97 | Doctrine change. Guarded by a `lint-docs` denylist entry + format pins |
| DT3 | ✅ **SHIPPED 2026-08-09** — **Delete the per-hour drift column** | Slope + `dominant` + both constants + the renderer + the `Δ/d` column + `THIN_DRIFT_DAYS` + `read-schedule`'s `driftByItem` + **the digest relabel** all deleted; the ask-reach-decay sub-signal EXTRACTED as `askReachDecay`/`askReachDecayNote` | 8 call sites (all verified) | Inform-only. NOTE the relabel *could* move a displayed verdict — it was keyed on the coin-flip direction call, so it was firing off noise |
| DT4 | **Per-item window gate** | Compute split-half r live (~4ms, 2 extra `hourProfile` calls on the in-hand series); r ≥ ~0.6 → render the window, else "no reliable window" | `read-window-range --profile`, `↳ diurnal:`, `softBuyRead`, `read-schedule.mjs` | ~90% of current window renders become an honest absence |
| DT5 | **Surface `askReach.decaying` as a first-class signal** | It already exists and is predictive; promote from buried sub-field | quote/positions ask-side notes | Additive |
| DT6 | **Lean reachability harder** | Prefer recent-3 over the 14d count where they diverge; keep placement percentiles as-is | pricing doctrine, `/scan` WINDOW-CLEAR step | Confirms existing doctrine |

### DT3 call-site map (already surveyed, all inform-only — nothing gates)
`quote-items.mjs:503` (bare quote), `:869` (held lot) · `screen-flip-niches.mjs:990` (digest top-X),
`:2635` (reverse-flip thin big-ticket) · `read-schedule.mjs:281` · `read-window-range.mjs:353–373`
(the `--hourly` Δ/d column + summary) · `js/reverseflip.mjs` (consumes it pre-rendered via
`reverseFlipCycleNotes`, pushes to a note list — no gate). Renderer `js/windowread.mjs:591` is a
**deployed app file** ⇒ `APP_VERSION` bump + browser smoke.

Note `js/reverseflip.mjs:193` already sets `THIN_DRIFT_DAYS = 7` because "a thin book's 3-day slope
whipsaws (Ruling §6)" — the repo had already hit this and patched the window. The measurement says
the patch does not work either (days=7 still loses to no-change).

## What does NOT change

Reach/placement percentiles · band-is-the-edge pricing · the tax-capped `breakEven()` · two-sided
liquidity gates · the validator stack · `fcTrack` floor/ceiling · regime classification. None of it
was implicated, and the reachability result actively vindicates the WINDOW-CLEAR pricing step.

## Honesty limits

One 74-day era, one update cycle. Touch proxies are hourly `avgLow`/`avgHigh` aggregates, **not
executed fills** — no queue or partial-fill modelling, so every "touched" figure is an upper bound on
what a real offer would get. Item-day clustering means effective n ≪ 18,309 (consecutive fits share
13/14 days): treat few-pp class deltas as suggestive, the monotone 8–15pp gate effects across all
eight class×side cells as solid. Gated cells are small (56–276 origins), so the 11–25% capture
carries ±few pp. H3 strand P/L is a 48h mark-to-mid and untaxed. Day-of-week n ≈ 10 weeks —
descriptive only. The split-half gate flickers for borderline items (59% persistence).
