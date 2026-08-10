# PLAN-SUGGESTION-FILL-JOIN — the instrumentation blocker, measured

Status: **DIAGNOSIS COMPLETE, PROPOSAL OPEN.** Adversarial investigation 2026-08-09.
Every number below was measured this pass from data already on disk (scratch scripts, not
committed; read-only; archive opened `readonly:true`). Nothing here is calibrated — see §9.

**Headline: the framing that opened this investigation is wrong in its most load-bearing
part.** The suggestion→fill join is real, is genuinely unreliable, and will stay unreliable.
But it is *not* the blocker on P(fill) calibration, and it is not the blocker on
`PLAN-REACH-HORIZON` Chunk 3. Both of those are blocked on an **offer-keyed** join that
needs no suggestion attribution and no new logging — and which this pass computed end to
end as a proof of viability (§5). The suggestion-keyed join answers a different and much
weaker question, and the data says it will not reach useful n from Ben's own trading.

---

## 1. The dataset, quantified

| Side | Measure | Value |
| --- | --- | --- |
| Suggestions | item-keyed rows (active + `pipeline/suggestions-archive/`) | **96,141** |
| | admission-exclusion aggregate rows (no `itemId`, correctly skipped by joiners) | 253 |
| | distinct items · span · rate | 808 · 36d · ~1,674 rows/day |
| | by script | screen 91,762 · watch 3,338 · quote 1,294 |
| | active file on disk / committed | **17.2 MB / 13.4 MB** (mean 1,257 B/row) |
| | July archive (gitignored, local-only) | 75.0 MB |
| Fills | normalized events in `fills.json` | 6,803 |
| | event states | placed 1,951 · partial 2,952 · complete 754 · **cancelled 1,146** |
| | collapsed offers → campaigns → closed FIFO lots | 1,901 → **902** → 420 |
| | buy campaigns: filled / never filled | 437 = **311 / 126** |
| | sell campaigns: filled / never filled | 465 = 452 / 13 |
| | manual/mobile (`slot 8`) share | **29 events (0.4%), 15/902 campaigns** |

**The ratio that governs everything: 96,141 suggestion rows : 437 buy campaigns ≈ 220 : 1.**

---

## 2. Failure modes, enumerated and quantified

Each is stated with the evidence, and — critically — with whether it is *fatal*, *bounded*,
or *not actually a problem*. Two of the five hypotheses handed to this investigation are
falsified by the data.

### F1 — No correlation key. CONFIRMED, fatal to exact attribution.
`suggestionEntry()` (`pipeline/lib/render/suggestlog.mjs:432`) writes no offer id, no run id,
no suggestion id. The complete historical key set across all rows contains nothing that could
tie a row to a placed GE offer. The exchange log has no field the tool could write into. The
only available join keys are `(itemId, ts, price)` fuzzy proximity. **There is no path to an
exact key without RuneLite plugin work Ben would have to install and maintain** — out of scope
by construction.

### F2 — Attribution ambiguity from suggestion volume. CONFIRMED, fatal. This is the real killer.
Nearest-prior-suggestion attribution against the 437 buy campaigns:

| Window | Campaigns with a prior suggestion | >1 candidate | mean candidates | distinct bid levels among them |
| --- | --- | --- | --- | --- |
| 30 min | 278 / 437 | 68% | 3.4 | 1.5 |
| 1 h | 299 / 437 | 71% | 5.1 | 1.8 |
| **6 h** (join-outcomes `SUGGEST_WINDOW`) | **324 / 437** | **85%** | **17.1** | **4.4** |
| 12 h | 331 / 437 | 89% | 27.3 | 6.7 |
| 24 h | 354 / 437 | 93% | 44.7 | 10.7 |

At the window the repo actually uses, **85% of buy campaigns have a contested attribution,
averaging 17 candidate suggestions spanning 4.4 distinct recommended bid levels.**
`retrojoin.mjs`'s nearest-prior rule resolves this deterministically, but determinism is not
correctness — it picks one of 17 and discards the tie information.

Root cause is the surfacing cadence, not the logging: suggestion rows per `(item, day)` run
median 5, p90 43, **max 462**. A scan loop re-surfaces the same item every pass.

### F3 — Price disagreement between suggestion and placement. FALSIFIED as a major mode; it is a *weak key*, not a *distortion*.
Placed price vs nearest-prior suggested bid (W=6h, n=324): p10 −1.6%, p25 −0.4%, **median
0.0%**, p75 +0.4%, p90 +1.4%. 234/324 within ±1%; 303/324 within ±3%.

**Ben places essentially at the suggested price.** The hypothesis that he "often places at a
different price" is not supported. But this *helps the trading and hurts the join*: because
every candidate suggestion clusters at nearly the same price, price cannot disambiguate them.
Adding a price tolerance to the time window makes things worse, not better:

| Price tolerance (W=6h) | matched | **uniquely** matched | still multi | mixed-mode among matches |
| --- | --- | --- | --- | --- |
| exact | 46 / 437 | 19 | 27 | — |
| ±0.25% | 165 / 437 | 48 | 117 | 44% |
| ±0.50% | 210 / 437 | 48 | 162 | 47% |
| ±1.00% | 253 / 437 | 51 | 202 | 51% |

**A price key never yields more than ~51 unique attributions out of 437, and tightening it
trades recall for nothing.** Even where price matches, ~45–50% of matched candidate sets span
more than one `mode` — so the niche attribution, which is the whole point of the retro, stays
ambiguous. *This is the single most important negative result in this document: the obvious fix
does not work.*

### F4 — Mobile/phone trades bypass the desktop log. FALSIFIED as material.
Manual-slot (`MANUAL_SLOT = 8`, `coffer-manual.log`) events are **29 of 6,803 = 0.4%**, and
15 of 902 campaigns. Whatever else is wrong, mobile leakage is not moving any estimate. Do not
spend a chunk on it.

### F5 — Cancelled offers leave no trace. FALSIFIED, and the inverse is true.
Cancellation is explicitly logged — 1,146 `cancelled` events in `fills.json`, from explicit
`CANCELLED_BUY` / `CANCELLED_SELL` lines in the raw RuneLite log. Further, 155/437 buy
campaigns carry ≥1 reprice (mean 1.6; step Δ p25 0.00% / median +0.14% / p75 +0.59%), already
stitched by `campaigns.mjs`'s `REPRICE_GAP` logic. **Cancel-and-reprice behaviour is one of
the best-instrumented things in the repo.**

### F6 — Coarse timestamps. FALSIFIED. The log is second-resolution (`date` + `time` to the
second). `parseTs` yields exact unix seconds. Not a failure mode.

### F7 — Selection, not censoring: only 2.5% of surfaced rows are ever acted on.
Screen rows followed by *any* buy placement on that item within 6h: **2,267 / 91,509 = 2.48%**.
The suggestion ledger is a ~40:1 noise channel relative to action. A "did our suggestion fill"
rate computed over this denominator measures Ben's attention allocation, not market fill
dynamics, and the two are confounded beyond separation.

Relatedly: 672 of 808 suggested items were **never traded at all**, accounting for 42,028 rows
(43.7% of the ledger).

### F8 — Validator pass-arm censoring. CONFIRMED, as briefed, and it is real.
35,043 of 96,141 rows carry a `validators` field, and by construction (`leanValidators`) only
non-pass outcomes are recorded. A validator that passed is indistinguishable from a validator
that never ran. **Any forward-scoring of validator discrimination from this ledger is a
numerator with no denominator.** The 2026-08-08/09 reach finding cited in `PLAN-REACH-HORIZON`
(27,799 firings, reject 55.9% vs caution 62.2%) inherits this defect and should be read as
between-non-pass-strata contrast only, never as a validator-vs-baseline effect.

---

## 3. The censoring problem, stated correctly

The briefing framed this as "a not-filled suggestion leaves no record anywhere." **That is
true, and it is also the wrong denominator to want.** There are three distinct populations, and
conflating them is what produces confidently wrong calibration:

| # | Population | Size | On disk today? | What it can calibrate |
| --- | --- | --- | --- | --- |
| **D1** | Suggestions surfaced | 96,141 | ✅ complete | Nothing about fills. Ben acted on 2.5%; the other 97.5% is an attention/selection process, not a market process. |
| **D2** | **Offers placed** (filled *and* not) | **902** (437 buy) | ✅ **complete** — `placed` 1,951 + `cancelled` 1,146 | **P(fill), TTF, print→fill bias, reach-window validity.** This is the real denominator. |
| **D3** | Validator evaluations | unknown | ❌ non-pass only | Validator discrimination. Genuinely has no control arm. |

**D2 is complete and free.** A P(fill) model estimated on D1 answers "does Ben act on our
suggestions?" A P(fill) model estimated on D2 answers "if you rest a bid at this level, does it
fill?" — which is the question every open calibration item actually asks. The briefing's
correct instinct (there is no denominator) applies fully to **D3**, partially to **D1**, and
**not at all to D2**.

### The censoring that *does* remain in D2 — and it is not the naive kind
1. **Right-censoring:** 19 buy campaigns have no terminal state (still resting). Standard;
   handle with a survival estimator or exclude with a stated rule. Not a threat.
2. **Informative censoring — the real hazard.** 126 buy campaigns ended with zero fill, at
   median parked life **1.0h** (p90 8.2h). Those are not "the market refused" — they are
   *Ben cancelled*. Treating a cancel-unfilled as a clean negative biases P(fill) **down**,
   because he pulls bids that look like they are not working. Any fit on D2 must model the
   cancel as a competing risk (or at minimum report P(fill | still resting at t) alongside the
   naive rate), and say so.
3. **Reprice stitching:** a repriced campaign's "placement price" is the *first* price, but the
   fill happened at the last. `campaignBase` keeps the reprice list — use it; do not attribute
   a fill to a price that was superseded.

None of these require new instrumentation. All three require the analysis to be honest.

---

## 4. Task-3 verification: does the exchange log record placement and cancellation?

**YES. Verified directly against `~/.runelite/exchange-logger/*`.** This is the single most
consequential finding in the investigation.

Raw log lines carry `state` ∈ {`BUYING`, `SELLING`, `BOUGHT`, `SOLD`, `CANCELLED_BUY`,
`CANCELLED_SELL`, `EMPTY`} with `offer` (price), `max` (offer size), `qty` (cumulative filled),
`worth` (cumulative spent). A `BUYING`/`SELLING` line with `qty:0` **is an offer-placement
event**; `reconstruct.mjs:112` already normalizes it to `state:'placed'`. August-window sample:
300 `BUYING` · 455 `SELLING` · 40 `CANCELLED_BUY` · 78 `CANCELLED_SELL`.

So: *"offer placed at price P at time T, still resting / cancelled / filled at T2"* — the
briefing's stated gold standard — **already exists, complete, at zero user burden, back to
2026-07-02.** `monitor-offers.mjs` and `watch-log.mjs` consume it live; `campaigns.mjs`
reconstructs it into campaign lifecycles; `join-outcomes.mjs` already joins band-percentile at
placement onto it.

The honest correction to the repo's own doctrine: `PLAN-REACH-HORIZON` §8 says "**No fill data
exists.**" That statement is false and should be corrected in place. What does not exist is
*suggestion-attributed* fill data. 437 buy campaigns with full lifecycles do exist.

---

## 5. Proof of viability — the blocked number, computed

`PLAN-REACH-HORIZON` Chunk 3 is declared BLOCKED pending the suggestion→fill join, with a
pre-registered decision rule requiring (a) a declared resting duration per lane, (b) fill-proxy
evidence that a wider window's extra prints convert to fills, and (c) joint re-scaling. This
pass computed (a) and (b) from data on disk, in one scratch script, with no suggestion join.

**(a) Resting duration — measured, not a question for Ben.**

| Buy side (n=437) | p25 | median | p75 | p90 |
| --- | --- | --- | --- | --- |
| time-to-first-fill (filled, n=311) | 0.0h | **0.2h** | 1.2h | 7.2h |
| parked life (never filled, n=126) | 0.2h | 1.0h | 2.5h | 8.2h |

Offers resting longer than: 2h → 30% · 8h → 13% · **24h → 0.5% · 48h → 0%**.

**(b) The empirical fill curve, and the print→fill conversion.**

| W | P(first fill ≤ W), n=437 | | W | n | print% | P(fill ǀ printed) |
| --- | --- | --- | --- | --- | --- | --- |
| 1h | 51.9% | | 1h | 142 | 43.7 | **85.5%** |
| 2h | 57.7% | | 2h | 185 | 45.9 | 87.1% |
| 8h | 64.8% | | 8h | 232 | 62.9 | 84.2% |
| 24h | 71.2% | | 24h | 278 | 76.3 | 82.5% |
| 48h | **71.2%** | | 48h | 314 | 73.9 | **81.0%** |

("printed" = the 5m archive's `avgLowPrice` touched the bid within W. Archive: 5m grain, 4,613
buckets from 2026-07-08; 133/150 recent buy campaigns have ≥12 observations in their first 8h.)

Three results the plan says are unavailable:
1. **The fill curve saturates at 24h** — identical at 48h — because Ben never rests a buy offer
   past 24h. A 48h reach window is not "flattering"; it is **behaviourally undefined**. Chunk
   3's condition (a) resolves against the wide window on measurement.
2. **The print→fill bias is real, and mildly monotone-decreasing in W** (85.5% → 81.0%). §4 of
   that plan says "whether the print→fill bias worsens with W is unmeasurable from current data
   — the draft asserted it; we don't know it, in either direction." We now know it, in the
   direction the draft guessed, with n=142–314.
3. Therefore **Chunk 3 can be unblocked without ever building a suggestion→fill join.** Its
   blocker was misidentified.

⚠ Honesty on these numbers (rule 4): the print proxy is crude — a 5m bucket's `avgLowPrice` is
an average of instasell prints, not proof a resting bid at that level was hit; the 126
unfilled include Ben's own cancels (informative censoring, §3); and coverage is uneven
(295/437 campaigns lack ≥6 5m observations at W=1h). These are *directionally* usable and are
*not* a calibrated conversion factor. They are enough to unblock a decision, not enough to set
a constant.

---

## 6. Minimal instrumentation — the ordered "log these fields starting now" list

House style is the YS2 lean-field pattern: a field written only when supplied, so historical
rows and non-supplying callers stay byte-identical. Every proposal below obeys it. **All are
diffs in prose; nothing was edited.**

Budget context first, because it bounds the list: `suggestions.jsonl` is **17.2 MB on disk /
13.4 MB committed**, mean 1,257 B/row, ~1,674 rows/day, in the **deploy root of a public
GitHub Pages repo**, growing ~2 MB/day between monthly rotations. The row is already heavy.
New fields must be cheap and must earn the weight.

| # | Field | Where | Cost | Unblocks | Verdict |
| --- | --- | --- | --- | --- | --- |
| **1** | `guide` | `suggestionEntry`, one line: `if (row.guide != null) e.guide = row.guide;` | **~17 B/row = 0.81 MB/mo (1.4% of row)**; **zero call-site changes** | Guide-at-time-T for every logged row; Lane A's −5% bid-depth hypothesis; any historical replay needing the GE guide anchor | **SHIP FIRST** |
| **2** | `restIntent` (hours Ben expects to leave it) — *only if* free | posture-adjacent, screen/quote | ~14 B, **but requires a human input** | Chunk 3 condition (a) | **REJECT** — §5(a) already measures it from behaviour |
| **3** | `windowHours` on the lean reach entry | `leanValidators` / reach push site | ~14 B/firing | Reach basis labelling | **Already owned** by PLAN-REACH-HORIZON Chunk 2; don't duplicate here |
| **4** | Sampled validator **pass** logging (1-in-N, `sampled:true`) | `js/validate.mjs` `leanValidators` | at N=20, ~+3% ledger | **D3 — the only path to a validator control arm** | **SHIP SECOND**, N=20, Ben decides N |
| **5** | Any suggestion↔offer correlation id | — | requires RuneLite plugin work | exact attribution | **REJECT — impossible** (§F1) |

### On `guide` specifically — evaluated on merit, not because it was raised
I argued myself out of the reflexive "yes". The case *against*: the ledger is already 17 MB in
a public deploy root; `guide` is a slow-moving GE-published number, not a market observation;
`pipeline/.guide-history.jsonl` exists (97 rows) and could in principle be widened instead,
which would cost bytes proportional to *items* rather than to *suggestion rows* — strictly
cheaper for the same information.

The case *for* wins anyway, on three specific grounds:
1. **It is already on the object.** `computeQuote` sets `row.guide` (`js/quotecore.js:470`).
   The change is one derived line beside the existing `askHeadroom` / `depth` lines — the same
   pattern, **no call-site change across quote/screen/watch**. This is the cheapest possible
   field in this codebase.
2. **Point-in-time correctness.** `pipeline/.cache/guide.json` is a 10-minute-TTL *current*
   snapshot; `.guide-history.jsonl` has 97 rows and only logs *changes* it happened to observe.
   Neither reconstructs guide-as-of-row-ts for an arbitrary historical row. Widening
   `.guide-history.jsonl` fixes this only for items it tracks, and the tracking set is itself a
   decision that would need making and maintaining. `guide` on the row is unconditionally
   correct for every row that exists.
3. **1.4% of a row that already carries `timedLap` and `windowExit`.** If the row weight is the
   objection, `guide` is not where to make the stand — see the recommendation in §8.

**Ship it.** It is the one unambiguous win in this document.

---

## 7. The case AGAINST building the suggestion→fill join

Stated as strongly as the evidence supports, because I think it is largely correct.

1. **The n will never arrive.** Buy campaigns accrue at **79.9/week** (unfilled: 23.0/week).
   Doubling today's 437 takes **5.5 weeks**. But volume is not the binding constraint —
   *attribution* is: at W=6h only 324 campaigns have any prior suggestion and only ~48–51 are
   *uniquely* attributable at any price tolerance (§F3). Uniquely-attributed rows accrue at
   roughly **9/week**. A per-niche fill-rate table needs 5 cells at n≥30 (the repo's own
   `MIN_N_F1`/`MIN_CELLS_F1`); today the nearest-prior join yields **4** such cells, and they
   are mode×class cells whose attribution is 85% contested. Reaching a *defensible* 5 cells is
   a **6–12 month** proposition, and that assumes Ben's item mix stops drifting — which it will
   not.

2. **It measures the wrong thing.** With 2.5% of surfaced rows acted on, "suggestion fill rate"
   is dominated by Ben's selection process. You cannot separate "the tool recommended well"
   from "Ben chose well among what the tool recommended" without an experiment (randomized
   surfacing) that nobody is going to run on a live book.

3. **The cheaper retrospective approach gets ≫80% of the value, and it already half-exists.**
   `join-outcomes.mjs` + `campaigns.mjs` + `f1-calibrate.mjs` already reconstruct D2 with
   band-percentile at placement. §5 shows the remaining questions fall out of D2 in one script.
   The correct move is to **retarget the existing machinery at D2 and stop pretending D1 is the
   denominator**, not to build a new joiner.

4. **The join is not the true blocker for the questions people say it blocks.** Demonstrated
   for `PLAN-REACH-HORIZON` Chunk 3 in §5. I would expect the same to hold for most of the F1
   list: they are phrased as "did our suggestion work?" but they are answered by "does a bid at
   this level in this regime fill?"

5. **Where the join genuinely is required, it is required *weakly*.** Grading recommendation
   *quality* per niche does need D1. But `retrojoin.mjs` + `aggregateOutcomes` already produce
   exactly that, with honest per-group n and no derived grade — and their own header already
   says the sample is "weeks-cold and mostly `not-taken`." That is the right posture. It does
   not need to be better; it needs to not be mistaken for calibration.

**Counter-argument, fairly stated:** D2 cannot tell you whether a niche *surfaces good
candidates* — only whether a placed bid fills. If the goal is retiring or reweighting a
flip-niche, D1 attribution is the only evidence there is, and 220:1 noise beats zero. The
honest resolution is that this question should be answered by **forward A/B on admission**
(the `via`/`preRank`/`prePool` provenance EF-0a already logs is a *better-designed natural
experiment* than any retro-join) rather than by attributing fills backwards.

---

## 8. Build-ready chunks

Ordered by value/cost. Chunks 1–3 are the whole recommendation; 4–5 are optional; 6 is a
correction pass.

**Chunk 1 — `guide` on the suggestion row. SHIP FIRST. ~30 min.**
- `pipeline/lib/render/suggestlog.mjs` `suggestionEntry()`: add one derived line next to the
  existing `askHeadroom` line — `if (row.guide != null) e.guide = row.guide;`. No signature
  change, no call-site change.
- Header schema block: document `guide?` with the same YS2 lean-field language.
- Cost: ~17 B/row, 0.81 MB/month. Numbers that move: **none**.
- Doc-reconciliation: `suggestlog.mjs` header schema · `docs/FLOW.md` (suggestion row shape) ·
  `README.md` inventory line for `suggestions.jsonl` if it enumerates fields. Pipeline-only,
  no `APP_VERSION` bump (rule 5).
- Test: extend `pipeline/test/suggestlog.test.mjs` — a row with no `row.guide` stays
  byte-identical.

**Chunk 2 — retarget the outcome read at D2 (offer-keyed), and say so. ~half a day.**
- No new joiner. `join-outcomes.mjs`/`f1-calibrate.mjs` already build campaigns with
  band-percentile at placement; add to `f1-calibrate.mjs`'s FILL CURVES section the three D2
  reads §5 computed: P(fill ≤ W) curve, resting-duration distribution by side, and the
  print→fill conversion against the read-only 5m archive (`open(undefined, {readonly:true})`).
- **Mandatory honesty features, not optional:** report cancel-unfilled as a **competing risk**,
  not a clean negative; print P(fill | still resting at t) beside the naive rate; attribute a
  fill to the *repriced* level, not the first placement price; carry archive-coverage n per
  cell and refuse the cell below `MIN_N_REPORT`.
- Numbers that move: none live — this is a report.

**Chunk 3 — unblock `PLAN-REACH-HORIZON` Chunk 3 on the D2 evidence. ~half a day, after Chunk 2.**
- Its pre-registered rule is satisfiable now: (a) resting duration is **measured** (§5a) — 0%
  of buy offers rest past 48h, so the wide-window option is decided against on behaviour;
  (b) print→fill conversion is **measured** (§5b) and decays 85.5%→81.0%; (c) joint re-scaling
  remains pure engineering, shipped as a visible comparison per `gate-on-error-cost-not-n`.
- Doc-reconciliation is the point of this chunk: `plans/PLAN-REACH-HORIZON.md` §8's "**No fill
  data exists**" and Chunk 3's "Reopens only when the suggestion→fill join exists" are both
  **factually wrong** and must be corrected in place (rule 8's reconciliation clause), citing
  D2. Same correction wherever `PLAN.md` phrases F1 as suggestion-join-gated.

**Chunk 4 — sampled validator pass-logging (the D3 control arm). Ben decides N. ~2h.**
- `js/validate.mjs` `leanValidators`: with probability 1/N, emit a pass entry marked
  `sampled:true`. At N=20, ~+3% ledger size.
- This is the **only** proposal here that creates a control arm that does not exist. Without
  it, no validator discrimination claim is ever more than a between-non-pass contrast (§F8) —
  including the reach numbers currently cited in `PLAN.md` "Discovered".
- Explicitly **propose, do not silently ship** — it changes ledger volume on a public repo.

**Chunk 5 — ledger weight (raised because Chunk 1 spends from this budget). Report only.**
- 13.4 MB tracked in the deploy root, +2 MB/day, on a public Pages repo. `guide` is 1.4% of a
  row; the heavy fields are `timedLap`, `windowExit`, `estConfidence`, `pathA`. Recommend an
  audit of bytes-per-field-per-decision-unblocked before *any* further field lands. Not a
  build; a number to put in front of Ben.

**Chunk 6 — retire the framing.** `retrojoin.mjs`'s header is honest and should stay. What
should change is anywhere the repo asserts the suggestion→fill join is *the* blocker on P(fill)
calibration. It is the blocker on **recommendation grading** only. One line in `PLAN.md`, one in
`docs/MARKET-ANALYSIS.md` if it repeats the claim.

**Explicitly NOT building:** any correlation-id scheme (§F1, impossible without plugin work);
any mobile-trade capture (§F4, 0.4%); any hand-tagging workflow — per the briefing's own
assumption, and I agree: it would decay, and at 80 placements/week the tagging burden is
~11/day for a dataset that is already free at 0/day.

---

## 9. Honesty statement (rule 4)

- Every number in §1–§5 is a one-pass measurement over a **36-day, single-trader,
  single-account** dataset. n=437 buy campaigns is the whole population, not a sample from a
  stable process — Ben's item mix, capital, and posture all drifted across the window.
- The print→fill conversion (§5b) uses a **crude proxy** (5m `avgLowPrice` ≤ bid) and unequal
  per-W coverage (n 142→314 as W widens, which itself induces composition bias — the wider
  windows include campaigns the narrow ones dropped for thin archive coverage). It is
  directionally usable; it is **not** a calibrated constant and must not be cited as one.
- The 126 unfilled buy campaigns are **not** clean negatives (§3.2). Any P(fill) fitted on them
  without competing-risk handling is biased low by an unknown amount.
- Cell counts: **4** cells clear n≥30 today against the repo's own requirement of 5. Nothing in
  this document licenses opening F1.
- §F8 stands unresolved until Chunk 4: no validator claim from this ledger currently has a
  control arm, including the ones already cited in `PLAN.md`.
