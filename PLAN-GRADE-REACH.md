# PLAN-GRADE-REACH — the grade ignores ASK reachability (diagnosis + proposal)

**Status:** Proposals **A + B SHIPPED** (2026-07-12, Ben) — ask-reach folded into the rank's two-leg P
(`js/estimators.mjs` `askReachFactor`/`PFILL_ASKREACH_FLOOR`) + `REACH_GRADE_CAP` letter ceiling
(`js/rating.mjs`), wired render-stage in `screen.mjs`; verified demoting Saradomin GS S+→B (P 0.86→0.31),
Eternal boots S-→B. Render-stage only — replay goldens byte-identical, app path unchanged (no APP_VERSION).
Constants are PLACEHOLDERS (n≈14). **HELD for F1/retro-join:** Proposal C (reach inform→gate).

**Part II status (2026-07-12, second pass):** the **safe reframing SHIPPED** — the inform-only
`◆ asym fill` line (deep-bid → high-reach-ask + the P_ask/P_bid split, `screen.mjs` band + `quote.mjs`,
zero new fetch off the in-hand 1h series) and the `asym` shadow field on `suggestions.jsonl` beside the
symmetric rank (the F1 A/B data accrual). New pure homes: `asymPair` (`js/windowread.mjs`,
`ASYM_P_LO`/`ASYM_P_HI`/`ASYM_MIN_DAYS` — PLACEHOLDERS, n≈14) + `asymEstimate` (`js/estimators.mjs` —
the P_ask-weights / P_bid-is-optionality doctrine home). The **F1-gated half is WIRED but OFF**:
`screen.mjs --asym` flips the quoted band/scalp prices to the asymmetric pair and the sort to
`net × P_ask ÷ TTF` (min/max ordering guards in `asymEstimate`; refuses `--publish`; loud EXPERIMENTAL
banner) — the DEFAULT table is verified byte-identical (before/after diff, cache-warm; only the inform
lines are additive). **CHURN DECISION: exempt** (`spec.fillShape:'symmetric'`, `js/strategies.mjs`) —
from the asymmetric objective (§II.2: a deep-flush bid is anti-churn; churn fills every lap) AND from
Part I's ask-reach P-discount + `REACH_GRADE_CAP` (Ben's flag): a churn lap exits into continuous
two-sided flow near a tight band top, so the day-HIGH reach read (1h avg-high aggregates vs a
small-margin band top) systematically mismeasures the exit — the discount would multiply measurement
noise into the per-lap rank, not information. Value stays `symmetric` too (its own term pricing; it
never had an ask-reach read). Pinned by the estimators.test.mjs Lightbearer golden (3/14-bid + 11/14-ask
out-ranks 12/14-bid + 2/14-ask at equal net; the old symmetric P preferred the wrong shape), the
P_bid-never-multiplies fixture, the churn-exemption fixture, and the windowread asymPair fixtures.
Remaining for F1: calibrate `ASYM_P_LO`/`ASYM_P_HI`, judge the shadow A/B (does `asym.rank` predict
realized exit-safe edge better than `rank`?), then graduate `--asym` to the default (a quoted-price
change — the high-blast-radius step).

## The symptom

`screen.mjs` ranks items S+/A+/S- at the TOP of the band niche whose quoted Optimistic ASK
(`optSell`) reaches only a tiny fraction of recent days — the grade looks great but the exit
price basically never prints. Observed this session:

| Item | Grade | Optimistic ask | Ask reach (14d) | Realistic (diurnal) exit |
| --- | --- | --- | --- | --- |
| Saradomin godsword | **S+** (top) | 24.91m | **2/14** | +80k/u (0.3%) |
| Eternal boots | **S-** | 4.22m | **0/14** | — |
| Crystal armour seed | **A+** | band-top | **5/14** | — |

The reach validator and the grade tell opposite stories about the same row, and the grade wins
the sort.

## The chain — exactly how a 2/14-reach ask carries an S+ grade

### 1. The GRADE has no reach term at all

`rateItem` (`js/rating.mjs:114-126`) is the whole grade:

```
score = round(rank × riskMult);   grade = gradeFor(score)          // rating.mjs:122-124
riskMult = regime × mom × liq × capital × confidence               // rating.mjs:122
```

The five risk sub-factors are `regimeFactor`/`momFactor`/`liqFactor`/`capitalFactor`/
`confidenceFactor` (`js/rating.mjs:32-68`). **None of them reads reach** — `liqFactor` is
daily volume, `confidenceFactor` is intraday traded-window count (`activeWin/nWin`), the rest
are regime/momentum/price. So the grade is a pure function of `rank` and intraday quality.

At the call site (`pipeline/screen.mjs:449`):

```
const r = rateItem({ row, rank: er.rank, activeWin: s.activeWin, nWin: ..., thin: s.thin });
```

Reach is never passed; `rateItem` has no parameter for it. The only grade caps that exist are
`THIN_GRADE_CAP='A-'` (`js/rating.mjs:102`, gp-flow-thin only), `PHASE_BASING_GRADE_CAP`, and
`SUBFLOOR_GRADE_CAP` (`screen.mjs:454-455`). **There is no reach cap.** So all the grade sees
about reachability is whatever `rank` carries.

### 2. The RANK's P models the BUY fill, never the SELL/exit reach

`rank` comes from `estimateRank` → `rankScore` (`js/estimators.mjs:197-202, 208-233`):

```
rank = net × pFill × lapUnits / days                                // rankScore, estimators.mjs:201
```

- **`net`** = `netMargin(optBuy, optSell)` (`estimators.mjs:213`, price basis `'opt'` →
  `quotedPair` `estimators.mjs:189`). For Saradomin GS this is the full 960.8k after-tax spread
  between the robust band **floor** (`optBuy`) and robust band **top** (`optSell`). **This
  number silently ASSUMES the exit at `optSell` prints** — it is the entire upside of the flip.
- **`pFill`** = `pFillIntraday(ctx)` (`estimators.mjs:79-97`). It prefers a real reach read:
  `clamp01(reach.reachedDays / reach.nDays)` (`estimators.mjs:82-83`). On the screen that
  `reach` is `reachExtra` — and `reachExtra` is built **from the BID-side reach only**
  (`screen.mjs:409-417`): `runValidators(... reach: { side: 'bid', level: row.optBuy } ...)`.
  The comment at `screen.mjs:405-407` is explicit: *"P(fill) here is a BID-FILL probability →
  it MUST use the bid-side reach (bidRes, optBuy), NOT the ask-side spec-plan reach."*
  So P ≈ 0.86 means **"my BUY at `optBuy` gets touched on ~12/14 days"** — high and correct.
- **`ttf`** = `ttfIntraday` (`estimators.mjs:121-129`) — volume-velocity, no reach.
- `lapUnits` = 1 for band (`estimators.mjs:230`).

**Nowhere in `rank` is there a factor for whether the ASK/exit ever prints.** The net assumes
the exit; P discounts only the entry; TTF is a velocity guess. So for Saradomin GS:

```
rank ≈ 960,800 × 0.86 / (46h/24) ≈ 431,000  →  × riskMult(≤1)  →  score ≥ 150k  →  S+
```

The ask-reach fact (2/14 = 0.14) is computed on the SAME pass but lands in a different place.

### 3. The ASK reach IS measured — but wired inform-only, so it's inert

The band spec (`js/strategies.mjs:194`) declares `{ key: 'reach', mode: 'inform' }`.
`screen.mjs:372-383` runs the spec-plan reach on the **ASK**: `reach: { side: 'ask', level:
row.optSell }`. `reachValidator` (`js/validate.mjs:76-120`) scores it:

```
frac = hit / n;  status = frac<=0 ? reject : frac<0.5 ? caution : pass     // validate.mjs:96,109-111
```

(`REACH_REJECT_FRAC=0`, `REACH_CAUTION_FRAC=0.5`, `js/validate.mjs:56-57`.) So 2/14 (0.14) →
**caution**, 0/14 → **reject**. **But `mode:'inform'` clamps that verdict to pass** — the whole
inform contract (`js/validate.mjs` `runValidators`, and `screen.mjs:394-424`): inform findings
become an `informNotes` annotation and *"never downgrades … the would-have verdict logged"*.
The `vworst`/reject-drop and caution-flag paths (`screen.mjs:384-393`) only fire for **gate**-mode
validators. Reach is not one. So the ask-reach caution/reject **annotates the row and is thrown
away for grading/ranking/sorting**.

This is confirmed as the actual reason: the grade path (`rateItem`) has no reach input, and the
rank path (`estimateRank`) only ingests bid reach.

### 4. Even the robustified ask top is optimistic vs daily reach

`optSell` is the Bar-E robust band top: `robustBand` p90 of the dense side over the last 2h
(24×5m points) (`js/quotecore.js`; re-exported `pipeline/lib/marketfetch.mjs`). Bar E protects
against a **single flier within one 2h window** — it does NOT establish that the level prints
**across days**. A p90-of-one-2h-window top can be a level that showed up in one recent 2h burst
and rarely recurs daily. That is exactly what the 2/14 daily ask-reach measures and the p90 does
not: robust-within-window ≠ reachable-across-days. So the grade's `net` is computed off a top
that is genuinely over-optimistic as an exit, and the one machine that knows it (reachValidator,
14-day daily window) is muted.

## Diagnosis summary

- **Grade path:** no reach term by construction (`rating.mjs`). Not a bug — a gap.
- **Rank-P path:** P *is* reach-aware, but only for the **entry** (`side:'bid'`,
  `screen.mjs:409-417`). The **exit/ask reach is never folded into P, TTF, or a haircut on
  `net`.** The `estimators.mjs` header advertises P as *"P(fill at the quoted prices)"* (plural),
  which reads as both legs, but the implementation only models the buy fill. **This is the crux:
  a design GAP that the docstring slightly oversells** — a two-leg flip's rank discounts one leg
  and takes the other (the exit, the bigger assumption) for granted.
- **Reach validator:** correctly computes ask reach and would caution/reject — but is `inform`
  on band/churn (`strategies.mjs:194,201`), so it is decision-support text only.

Net: an operator trusting the grade buys a position whose exit is a mirage, and the system
already has the number that proves it — it just never lets that number touch the grade.

## Proposals (ranked)

All constants below are n≈14-per-item small samples; every threshold is a PLACEHOLDER. Honesty
rule (CLAUDE.md rule 4): a 14-night ask-reach is one fortnight — a stale prior-regime fortnight
can under-count a genuinely-reachable level. The RC1 recency split (`recencySplit`,
`js/windowread.mjs`) already partially guards this (it bumps severity when the full window is
stale-optimistic, `validate.mjs:112`), but small-n false-negatives are the real risk of every
option here. That argues for a SOFT discount / CAP over a hard drop, and for F1 calibration
before any of it gates.

### Proposal A (preferred) — fold an ASK-reach factor into rank P (make P a two-leg fill prob)

The rank claims to be *P(fill at the quoted prices)*. A flip only "fills" if **both** legs
transact. Model that: multiply the existing bid-fill P by an ask-reach fraction.

- **Where:** `estimators.mjs` — thread an `extra.askReach` (mirroring the existing
  `extra.reach`) into `pFillIntraday`, so `pFill = pFillBid × f(askReach)`; and at
  `screen.mjs:409-432`, build an `askReachExtra` from the ASK reachValidator evidence already
  computed at `screen.mjs:372-383` (`vres` reach flag's `evidence.hit/days`) — zero new fetch,
  the ask reach is already in hand. `f` should be a **softened** map, not raw `reachedDays/nDays`
  (e.g. `clamp(0.25 + 0.75 × frac, …)` or a `sqrt`), so a stale-fortnight 2/14 discounts the rank
  hard but doesn't zero it.
- **Effect on the examples:** Saradomin GS rank ×≈(0.25+0.75×0.14)=×0.36 → score ≈ 155k → drops
  from mid-S+ toward S-/A+; Eternal boots 0/14 → ×0.25 → score quarters → out of S-; Crystal seed
  5/14 → ×0.52 → roughly halves, A+→A-/B. It re-orders the sort so mirage-exit rows sink beneath
  rows whose ask actually prints — which is the whole point of the rank.
- **False-negative risk:** LOW-MODERATE. It never drops a row (rank just shrinks), so a
  one-stale-fortnight good item is demoted, not hidden — and still surfaces if its net is large
  enough. The soft floor bounds the damage.
- **Ship now or F1?** The *shape* (two-leg P) is defensible and honest to ship as the rank
  definition; the *magnitude* of `f` is a placeholder that F1/retro-join must calibrate against
  realized sell latency. Recommend: ship the wiring with a clearly-named placeholder `f`, exactly
  like the other estimator priors (`estimators.mjs:62-72`), and let F1 tune it. It also fixes the
  docstring↔behavior mismatch (P finally means both legs).

### Proposal B — a reach-based grade CAP (mirror `THIN_GRADE_CAP`)

Add a `REACH_GRADE_CAP` analogous to `THIN_GRADE_CAP`. `capGrade` already exists
(`rating.mjs:103-107`) and is already reused in `screen.mjs:454-455` for the basing/sub-floor
caps — so this is a one-line addition at the same site: if the ASK reach frac is below a
threshold (e.g. `< 0.5`, the caution band), `grade = capGrade(grade, REACH_GRADE_CAP)`.

- **Effect:** Saradomin GS / Eternal boots / Crystal seed all cap to (say) `B`/`C` regardless of
  score — a blunt but unmissable "the exit doesn't print" ceiling.
- **Pros:** trivially implemented, exactly mirrors an accepted pattern, leaves the rank number
  honest-as-displayed while fixing only the LETTER (the headline an operator reads).
- **Cons / false-negative risk:** MODERATE-HIGH. A cap is a cliff — a 6/14 item one hit under
  the line caps identically to a 0/14 item. It also decouples the letter from the rank number
  (they'd disagree), which the rating.mjs philosophy (`rating.mjs:6-8`) treats as a smell.
- **Ship now or F1?** The threshold is a placeholder; cap magnitude and cutoff need F1. Ship
  only if a coarse ceiling is wanted as an interim guard while A is calibrated. **A + B are
  complementary** — A fixes the sort, B guarantees the letter can't oversell.

### Proposal C — promote `reach` from inform→gate on band (caution-demotes, reject-drops)

Flip `strategies.mjs:194` (and `:201` churn) to `{ key: 'reach', mode: 'gate' }`. Then a 0/14
ask **drops** the row and a 2/14 ask **cautions** it (surfaced, grade untouched).

- **Effect:** Eternal boots (0/14) disappears from band entirely; Saradomin GS / Crystal seed
  (caution) still surface at their inflated grade but with a caution flag.
- **False-negative risk:** HIGH — this is the option the rollout doctrine explicitly holds back.
  `strategies.mjs:171-172` and CLAUDE.md: reach starts *inform everywhere* precisely because n≈0/
  small-n; a hard reject on a 14-day window will silently bury a good item off one stale fortnight
  (the exact contamination `recencySplit` was built to flag, not to act on). And note it only
  drops the `reject` (0/14) tail — a `caution` still surfaces at the bad grade, so C alone does
  **not** fix Saradomin GS.
- **Ship now or F1?** NOT now. This is the textbook F1-gated flip: keep it inform, let
  `analyze.mjs`/retro-join accumulate realized suggestion→sell outcomes on ask-reach buckets, and
  graduate reach inform→gate on band only once the data shows the caution/reject fracs
  discriminate realized flips. It's the last step, not the first.

## Recommendation

**Proposal A** — fold a softened ask-reach factor into the rank's P — is the right primary fix:
it targets the actual mechanism (rank silently assumes the exit), reorders the sort so mirage
exits sink, never hard-drops a small-n item, and corrects the P-means-both-legs docstring claim.
Pair it with **B** as a cheap letter-ceiling guard if Ben wants the grade itself to be
un-oversellable in the interim. Hold **C** (inform→gate) for F1 graduation once realized-fill
data exists. Ship A's *wiring* now with placeholder constants (named, per rule 4); route the
*magnitudes* of A and the *thresholds* of B/C through F1/retro-join calibration.

---

# PART II — retune the SELECTION + PRICING OBJECTIVE toward an asymmetric fill shape

**Mandate (Ben's words):** *"I'd much rather hit a 2/14 buy and a 12/14 sell than 50/50 both
sides."* The ideal flip is a RARE, DEEP entry (low reach — fills only on a genuine flush/dip)
paired with a NEAR-CERTAIN exit (high reach): maximum edge-per-lap, de-risked exit, at the cost
of fewer laps. Part I diagnosed why the grade ignores exit reach; this part proposes changing
what the pipeline SELECTS and PRICES FOR so the asymmetric shape is the target, not an accident.

**Why today's design produces the wrong (symmetric) shape.** The Optimistic pair is the
*symmetric robust band*: `optBuy = min(quickBuy, bandLo)` where `bandLo` = robust **p10**, and
`optSell = max(quickSell, bandHi)` where `bandHi` = robust **p90** (`js/quotecore.js:316-318`,
edges from `robustBand` `quotecore.js:227-237`). p10↔p90 is symmetric by construction, and it is
an *intraday 2h-window* quantile (24×5m points), not a cross-day reach level. So the quoted bid
and ask sit at mirror-image depths — structurally the ~50/50-both-sides shape, and (Part I) the
ask lands at a p90 top that may reach only 2/14 days. Lightbearer is the counterexample Ben wants
rewarded: deep bid 3.80m reaches 3/14 (recent 0/3), ask 4.05m reaches 11/14 (recent 3/3) →
+169k/u (+4.4%) on a near-certain exit, vs the symmetric-band ~3.91m/~4.19m coin-flip sell.

## II.1 — Ranking objective: reward the asymmetry explicitly

This is the natural extension of Part I Proposal A. Proposal A makes P two-legged *at the fixed
symmetric prices*; here the pipeline additionally CHOOSES the price pair to maximize realizable
asymmetric edge, and ranks off THAT pair rather than the symmetric band net.

- **Metric.** Replace the rank's symmetric-band net with realizable edge at an asymmetric pair:
  `rank = net(deepBid → highReachAsk) × P_ask ÷ TTF`, where
  - `highReachAsk` = the day-level ask quantile that reaches ~75-100% of nights
    (`quantHigh(his, p)` / `reachedDays`, `js/windowread.mjs:27,31`) off the Leg-B 1h series
    already in hand (`screen.mjs:376`, `windowStats` `windowread.mjs:84`);
  - `deepBid` = a low/flush entry quantile (`quantLow(lows, p)` `windowread.mjs:22`) that fills
    only on a real dip;
  - `P_ask` = `reachedDays/nDays` for `highReachAsk` (the exit-certainty weight from Part I).
- **The key nuance — do NOT penalize a low bid-reach the way you weight the ask.** Ben's
  principle is that a rare deep fill is a *feature* (deeper entry = more edge, capital idle
  meanwhile), not a defect. So `P_bid` (bid reach) must NOT multiply the rank symmetrically with
  `P_ask` — that would re-punish exactly the deep entry we want. The deep bid's value is already
  captured by the LARGER `net`. `P_bid` instead belongs to a separate throughput/lap-frequency
  dimension (which Ben already demoted when he killed gp/d, `js/estimators.mjs:1-12`): a low
  `P_bid` means "rest this bid as free optionality and expect few fills," not "downgrade the
  flip." This matches the standing memory *patience-on-cancel-and-cut* (a resting bid is
  low-risk optionality that fills at your price). Concretely: rank weights **exit certainty
  (`P_ask`) and per-lap net**, and surfaces `P_bid` as a "fills ~N/14 — rest it" annotation, not
  a rank multiplier. (If Ben wants throughput back in, it enters as a SEPARATE, clearly-labeled
  laps/day term, never fused into the edge.)
- **How it reorders the band table.** Saradomin GS (huge net off a 2/14 p90 ask) collapses:
  either its ask reprices down to the ~11/14 level (much smaller net) or `P_ask=0.14` guts the
  rank — either way it leaves the S+ top. Lightbearer rises: net 169k × `P_ask≈0.79` ÷ TTF ranks
  it near the top precisely BECAUSE the exit is near-certain — today it grades mediocre because
  the symmetric band quotes a coin-flip sell and a thinner net. Net effect: the table sorts by
  *realizable, exit-safe* edge instead of *paper* edge off an unreachable ceiling.
- **Cross-reference, no duplication.** The P-mechanics, the bid-only-P bug, and the
  inform-only-reach inertia are all in Part I §1-3. This section only changes (a) the price pair
  the rank is computed at and (b) that `P_ask` (not `P_bid`) is the fill weight.

## II.2 — Quoted price levels: pull the ask to high-reach, push the bid to the flush

Change the Optimistic pair's *definition* for the flip niches from symmetric intraday p10/p90 to
asymmetric day-level reach quantiles:

- **`optSell` → a HIGH-REACH ask.** `max(quickSell, quantHigh(his, p_hi))` with `p_hi` chosen so
  the level reaches ~75-100% of nights (the reach fraction, `reachedDays` `windowread.mjs:31`).
  This typically PULLS the ask DOWN from the p90 band top to a level that actually prints — the
  point of the exercise. Guard the ordering invariant `optSell ≥ quickSell`
  (`quotecore.js:12,318`) by keeping the `max(quickSell, …)`.
- **`optBuy` → a DEEP/flush bid.** `min(quickBuy, quantLow(lows, p_lo))` with `p_lo` a low
  flush quantile (fills ~2-4/14). Same `min(quickBuy, …)` keeps `optBuy ≤ quickBuy`.
- **What must stay intact (verified):**
  - **The momentum tell.** `mom` keys off the RAW band extremes `rawBandLo/rawBandHi`
    (`quotecore.js:262-263,311-312`), computed *independently of and before* the Optimistic
    clamp. Repricing `optBuy/optSell` does NOT touch `mom` as long as we do not reroute the
    tell through the new levels — leave `rawBandLo/rawBandHi` and the breakdown/breakup logic
    (`quotecore.js:311-312`) exactly as-is. Safe.
  - **Ordering invariant** `optBuy ≤ quickBuy ≤ quickSell ≤ optSell` (`quotecore.js:12`) — held
    by the `min`/`max` guards above.
  - **Break-even floor.** The held-sell floor (`breakEven`, `js/quotecore.js`) is a *held-lot*
    constraint, not a screen-quote input, so a repriced screen ask doesn't touch it; but any
    held-side surface must still floor the (now lower) high-reach ask at break-even.
  - **The value niche's q15/q85 twin** (`valueAmplitudeValidator` recent-week amplitude,
    `js/validate.mjs:227-243`) is a DIFFERENT, value-scoped read on a `term` price basis
    (`strategies.mjs:239`) — untouched. This repricing is band/scalp-scoped.
- **This is a PER-NICHE knob.** Add it to the strategy spec (`js/strategies.mjs` — a new
  `priceBasis`, e.g. `'asym'`, alongside `'quick'|'opt'|'term'`, wired in `quotedPair`
  `js/estimators.mjs:185-190` and the surface pricing):
  - **band / scalp → asymmetric** (deep-buy, reliable-sell — exactly Ben's shape; scalp already
    expects a falling wide band, `strategies.mjs:207-216`).
  - **churn → keep symmetric-ish.** Churn maxes the buy limit every lap and ranks the LAP on a
    tiny per-unit margin (`estimators.mjs:145-160`, `churnEdge` `strategies.mjs:126-131`) — you
    WANT to fill every lap on a two-sided commodity, not wait for a rare flush. A deep-flush bid
    is anti-churn. Leave churn on the band edges.
  - **value → unchanged** (term-structure floor→recovery basis, its own pricing in
    `renderValueMode`).

## II.3 — Honesty + F1 routing + how to A/B without regressing the band niche

**Small-sample honesty (rule 4).** Reach is n≈14 — one fortnight. An asymmetric objective that
leans hard on reach can drop/derank a genuinely good item off one stale two-week window. Two
mitigations already exist and MUST be used: the RC1 recency split (`recencySplit`
`windowread.mjs:44`, `recentQuant` `windowread.mjs:68`) that flags `staleOptimistic`
(`validate.mjs:112`), and the `REACH_MIN_DAYS` thin-sample degrade-to-pass
(`validate.mjs:106`). Anything reach-driven inherits those guards; never hard-reject on a thin or
recency-contaminated window.

**Safe to ship as a REFRAMING (no calibration needed):**
- Computing and DISPLAYING the asymmetric realizable pair + both-leg reach as a decision-support
  line (the same inform pattern as `askHeadroom`/diurnal, `screen.mjs:425-428`, `quote.mjs:152-
  162`). Zero new fetch — the 1h series and ask reach are already in hand (`screen.mjs:372-417`).
  This lets Ben SEE the Lightbearer-shaped pick immediately with no behavior risk.
- The `P_ask`-as-fill-weight / `P_bid`-as-annotation split (Part I A + II.1) as the rank
  *definition* — the shape is defensible; only the magnitude of the `P_ask` map is a placeholder.

**Needs F1 / retro-join calibration (do NOT hardcode as truth):**
- The quantile choices `p_hi` (high-reach ask) and `p_lo` (flush bid) — these are the whole
  behavior and are pure n≈14 placeholders.
- Whether repriced `optSell/optBuy` become the QUOTED numbers (a surfaced-price change) vs stay
  an inform overlay — flipping the quoted price is the high-blast-radius step; gate it on F1.
- Whether `P_ask` multiplies rank or caps grade (Part I A vs B).

**A/B without regressing the band niche:**
- **Keep the gate stack byte-identical.** The replay goldens
  (`pipeline/fixtures/replay/golden.json`) pin `gateCandidates → rankAndSlice → surviveMode`
  (`strategies.mjs:24-27`). Put the asymmetric objective in the **estimate/render stage** only —
  the same place the net>0 render gate lives, explicitly noted as NOT affecting the goldens
  (`screen.mjs:433-438`). Selection/liquidity gates stay untouched, so the goldens hold.
- **Add fixtures for the new math** in the `bandedge.test.mjs` / `estimators.test.mjs` style
  (`quantLow/quantHigh/reachedDays` asymmetric-pair cases; the Lightbearer archetype as a
  golden: 3/14 bid + 11/14 ask should out-rank a 12/14 bid + 2/14 ask of equal band net).
- **Shadow pass before flipping the displayed sort.** Log old-rank vs new-rank ordering per row
  to `suggestions.jsonl` (extend `estFields`, `screen.mjs:519`) and let `analyze.mjs` join both
  against realized fills (it already joins suggestion→fill, §4-5) — graduate the new objective
  to the DISPLAYED sort only once the shadow data shows the asymmetric rank predicts realized
  exit-safe edge better than the symmetric one. That is the F1 gate; until then it ships as an
  inform overlay + a shadow field, exactly like every other n≈0 estimator here.

**Bottom line for Part II:** ship the DISPLAY of the asymmetric realizable pair + the
`P_ask`/`P_bid` split now (reframing, guarded, no golden impact); hold the quantile magnitudes,
the quoted-price repricing, and the sort flip for F1 calibration and a shadow A/B. The knob is
per-niche: band/scalp adopt deep-buy/reliable-sell, churn and value keep their current bases.
