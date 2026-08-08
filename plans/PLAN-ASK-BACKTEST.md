# PLAN-ASK-BACKTEST — price the ask off what ACTUALLY filled, at fine grain, with a tunable lever

**Status: PLANNING ONLY (2026-08-07). No code changed.** Deferred behind AF1/AF2
(`PLAN-ARCHIVE-FIRST-FUNNEL.md`). Owner ask, verbatim: *"our strategy should be some variation of what
price filled according to the fine-grained buckets on x% of days? That gives us an easy lever to tune.
The other question is how can we inform it based on the other data we've gathered especially the last
3 days of detailed info."*

---

## §0 — Why the current ask reads don't answer the question

Every level the tooling currently offers for "where do I list this?" is **a level, not a fill
probability**, and each is measured on a smoothed basis:

| Read | What it actually is | Why it can't answer "will my ask fill?" |
| --- | --- | --- |
| `ASK side — reached on ~50% of days: X` | the **median of the 14 daily highs** (`windowread.mjs:31`) | 50% is TRUE BY CONSTRUCTION. A median cannot carry information about its own quantile. |
| `--depth → BOOK AT ≤ X` | depth/flow over 1h bucket **averages** | self-documented as *"a strictly-conservative FLOOR that under-prices the top"* (`windowread.mjs:949`); anchor: Soul rune floor said 394, real fills at **397** |
| amplitude `Both-leg reach` | reach vs a **median-quantile** level (`AMP_ASK_Q=0.5`) | prints `7/14` on every row, both legs — measures nothing (PLAN.md Discovered) |
| `reachMargin` cushion | direction of the gap over 7d | genuinely useful, but attached to a level chosen by the reads above |

~~**The smoothing cost is measured, not theoretical.** For Masori chaps at ~26.93m, the 1h-derived reach
says **5/14 days**; the same question asked of **5m buckets** says **10/15**. The 1h basis was hiding
half the fills.~~

🛑 **RETRACTED — this claim is FALSE and it was the plan's motivating premise (Fable, 2026-08-07;
independently re-verified).** Asked of the ARCHIVE's own data, 1h and 5m give **identical** daily-high
reach counts for Masori chaps at 26.93m: **8/15 both grains on UTC days, 10/15 both grains on LOCAL
days.** 5m buys **zero** additional reach days on the anchor item. The "5/14" came from a different
READ (the live-API window / `windowread`'s hourly-profile basis), not from a coarser GRAIN — so the
§0 framing attributed a read-to-read difference to grain smoothing.

**What survives:** the rest of §0's table stands — a median IS 50% by construction, and the depth read
IS self-documented as a conservative floor. The case for this plan is that those reads answer the
wrong QUESTION (a level, not a fill probability), **not** that a finer grain recovers hidden fills.
Anyone reaching for 5m over 1h purely for resolution should re-measure first; the archive holds 70d of
1h against 30d of 5m, so 1h is the deeper and cheaper default unless a specific read needs sub-hour
timing.

---

## §1 — The proposed primitive

```
askAtFillRate(itemId, { grain='5m', days=21, pct=0.5, qty=1, competition=4 })
  → { price, hitDays, nDays, unitsPerDay, pFillByDay, basis }
```

**"The highest price P such that, on ≥ `pct` of the last `days` days, at least one `grain` bucket
printed `avgHighPrice ≥ P`."** `pct` is the lever Ben asked for: `0.9` = near-certain and cheap,
`0.3` = patient and rich. One number, monotone, directly interpretable.

Measured today on Masori chaps (entry 25,651,000 · BE 26,174,490), 5m grain, recent-7 basis:

| ask | hit (7d) | P(fill ≤3d) | units/day @≥ask | net/u |
| --- | --- | --- | --- | --- |
| 26.70m | 6/7 | 100% | 70 | +515,000 |
| 26.90m | 4/7 | 92% | 48 | +711,000 |
| **27.15m** | 4/7 | 92% | **16** | **+956,000** |
| 27.50m | 3/7 | 81% | 2 | +1,299,000 |

Two things fall out that no current read surfaces:

1. **`P(fill ≤ N days)` is the decision-relevant number, not the daily rate.** An unfilled ask waits.
   92%-within-3-days at +956k dominates 100%-within-3-days at +515k. Expected value keeps climbing
   past that, which is why the raw optimum is not the answer —
2. **flow at the level is the real ceiling.** Units-at-or-above collapses 70 → 16 → 2 across that
   range. With 1 unit to sell, 16 is comfortable and 2 is a queue gamble. **`unitsPerDay` is a
   first-class output, not a footnote** — it is what stops the optimizer walking off the thin end.

---

## §2 — Informing it with recent data (the second half of the ask)

A flat `pct` over 21 days answers "typically". It cannot see a regime turning. Measured on the same
item, candidate ask 27,150,000:

| day | 5m daily high | cushion | units @≥ask |
| --- | --- | --- | --- |
| 08-03 | 27,754,822 | +604,822 | 30 |
| 08-04 | 26,842,785 | −307,215 | 0 |
| 08-05 | 27,545,965 | +395,965 | 6 |
| 08-06 | 27,160,215 | +10,215 | 1 |
| 08-07 | 27,545,965 | +395,965 | 14 |

The flat read says **4/7**. The recency read says **3/3 on the last three days**, with the misses
older. Same data, materially different confidence. Daily-HIGH slope: **+124,606/d over 7d, 0/d over
3d** — rising into a flat plateau, i.e. the level is being reached *more* often, not less.

**So the recency fold is not a refinement, it is the difference between 57% and 100%.** Candidate
shapes to evaluate (do NOT pick one on n=1 item):

- **(a) recent-N override** — report both, let the operator read the divergence. Mirrors RC1's existing
  `recent 0/3 · full 12/14 = stale` convention, which is already how divergence is surfaced elsewhere.
- **(b) exponential day-weighting** — one decay constant, continuous, no window boundary to game.
- **(c) cushion-as-a-gate** — compute at the flat rate, then require the cushion trend to be
  `extending` before quoting the richer price; fall back to the `pct`-flat price when `fading`. This
  reuses `reachMargin` rather than re-deriving it, and is the smallest change.

**Recommend (a) + (c):** show both bases, gate the rich price on the cushion. (b) is the elegant
answer and the hardest to explain when it disagrees with the operator's eye.

---

## §3 — Data-quality guard (found while measuring, not anticipated)

**07-28 prints a daily high of 35,000,004 on Masori chaps — ~30% above every neighbouring day, with
53 units at that level.** Neighbours run 26.5–27.8m. Any naive quantile over a window containing it
inherits it. The codebase already has this class of guard elsewhere (`valueGate`'s artifact-low, the
Bar-E band-top artifact, RC1's recency anchor) — this primitive needs its own, and it must fire
BEFORE the quantile, not after.

Do NOT reuse a fixed % band: on a genuinely trending item a 30% move over a week is real. The
neighbour-relative test (a single day standing far outside its immediate neighbours in BOTH
directions) is the right shape.

---

## §4 — Chunks

> ⚠ **REWRITTEN 2026-08-07 after §8/§9/§10.** The previous table specified a per-item quantile over a
> 5m series, pinned to a mis-described outlier, with `unitsPerDay` figures §8 disproved and an AB6 that
> §8 showed to be circular. It is superseded, not annotated — an implementer reads THIS table, and it
> must not describe a design we spent an afternoon disproving. The prior version is in
> `git show 46c1792:plans/PLAN-ASK-BACKTEST.md`.

**Design constraints every chunk inherits (all measured, §9/§10):**

1. **Premium is measured over MID, never over our own bid** — bid-relative conflates ask greed with
   entry quality (§9.1).
2. **`mid` is PINNED: prior-24h mean `avgHighPrice`.** Not a preference — base side and window move
   every level 5–15pp (instasell-side reads 93.4% where the pinned base reads 80.5%). VWAP is a no-op
   (−0.4pp), so volume-weighting is optional. Every consumer computes premium off the identical base
   or inherits a silent ±10pp bias.
3. **PRICE TIER is a required key.** At +2%: sub-100k prints 83.9%, ≥10m prints 52.4%. Omitting it
   overstates big-ticket fill by ~30pp — the §9.6 error.
4. **Item axis is measured relative VOLATILITY, not trade frequency.** Frequency is a proxy for it
   (Spearman −0.41) and its apparent effect collapses 25.6pp → 2.8pp once volatility is controlled.
5. **Claim separation only at premiums ≥2%.** Below ~1% the item axis separates nothing.
6. **Levels are ±2–3pp**, dense items only, and the surface is a LOWER BOUND on fill at qty=1 —
   it says nothing safe about size.
7. **Never present the premium/horizon monotonicity as evidence** — it is nested by construction.

| # | Chunk | Dep | Effort |
| --- | --- | --- | --- |
| **AB1** | Pure `printedAt(series, { mid, premium, horizon, from })` → boolean + the observed max — the atom the whole surface is built from. Fixture-pinned, no fetch, no archive coupling. Mid is an INPUT, never computed inside, so constraint 2 is enforced at the call site. | — | S |
| **AB2** | Surface BUILDER (offline, archive-only): sweep items × reference windows × premium grid → a lookup keyed by **premium × price tier × volatility band × horizon**, with per-cell n and a CI. Emits a versioned artifact; does NOT touch a live surface. | AB1 | M |
| **AB3** | `askAtFillRate(item, { targetP, horizon })` — invert the surface: highest premium whose cell clears `targetP`, converted to gp via the pinned mid. **Refuses** (returns null + reason) outside dense/known cells rather than extrapolating. | AB2 | M |
| **AB4** | Flow check — units traded at/above the level, as a **separate necessary condition**, because the proxy is only a lower bound at qty=1 (§8) and says nothing about size. A level with no flow is refused regardless of its P. | AB1 | S |
| **AB5** | Single-print spike guard, neighbour-relative, fired BEFORE any aggregation. Measured base rate: **0.9% of item-days ≥1m** (114 / 12,028, touching 75 of 511 items). ⚠ Fixture must pin the CORRECTED case: 07-28 carried **1 unit, not 53**, and was a genuine dislocation (instasells at 31m the same morning) — plus the 07-12 spike missed first time. | AB2 | S |
| **AB6** | Recency: report the recent-window rate BESIDE the full-window rate (RC1's existing divergence convention). **LOCAL day bucketing** — §2's story was UTC and flips to 2/3 under local (§8/M4). No blending, no decay constant, until something can distinguish them. | AB3 | M |
| **AB7** | Surface on `read-window-range.mjs` behind `--fill-rate`, console-only, INFORM. Print the existing quantile line alongside so the divergence is visible on every read. | AB3–AB6 | M |
| **AB8** | **Honest relabel (was AB6): shadow-log validates the PROXY, not the price choice.** §8/M6 — logging both prices only yields truth for the arm actually listed; the unplaced arm gets scored by the proxy under test. Either randomise which price is listed, or state plainly that this measures proxy-vs-realised-fill and cannot rank two pricing rules. | AB7 | M |
| **AB9** | Promote to the default ask basis ONLY after AB8 produces evidence under whichever framing it lands on. | AB8 | M |

**Sequence:** `AB1 → AB2 → AB3` (the usable core) → `AB4 + AB5` (guards, parallel) → `AB6 → AB7` →
`AB8 → (gate) → AB9`. **AB1–AB3 alone replace the 50%-by-construction quantile with something
measured** — that is the shippable increment; everything after is hardening and evidence.

---

## §5 — Risks and honest limits

1. **`avgHighPrice ≥ P` means buyers PAID ≥P, not that YOUR ask was taken.** Volume is a proxy for
   queue position, not a measurement of it. This primitive systematically over-states fill probability
   for a seller who is not at the front of the book. Never present it as a fill guarantee.
2. **5m is still an AVERAGE** — 12× less smoothed than 1h, not unsmoothed. Every number it produces
   remains a **lower bound** on the true intra-bucket peak. The direction of the bias is known and
   favourable (conservative), which is the only reason it is safe to use.
3. **n is tiny.** The recency read above rests on 3 days and the flat read on 7–21. `4/7` vs `3/7` is
   one day. Nothing here is calibrated; AB6 is the first real evidence.
4. **This optimises a single lot in isolation** — no capital, no opportunity cost, no slot contention.
   It answers "what is the best price for THIS unit", which is the question asked, but it is not a
   portfolio decision.
5. **Do not let this reach a gate.** It is an ask-PRICING aid. The existing gates stay on their current
   basis until AB6 produces evidence, per rule 4.
6. **Archive dependency.** Needs 5m history for the item; coverage is ~4,438 items / 30 days, and 5m is
   pruned at 30d under DS9. A short-history or newly-listed item must degrade to the current read,
   loudly — not silently return a worse number.

---

## §6 — Open questions for Ben

1. **What is the default `pct`?** Today's data suggests ~0.5 with the cushion gate, but that is one
   item on one day. Ship it as an explicit flag first and let a few real listings inform the default?
2. **Should `unitsPerDay` be a hard refusal or a warning?** A hard refusal stops the optimizer walking
   into the thin tail; a warning respects your risk tolerance. Recommend refusal with an override flag.
3. **Same primitive for the BID side?** Symmetric by construction (`avgLowPrice ≤ P`), and it would
   answer "where do I actually get filled buying?" — currently the same quantile problem in reverse.
4. **Does this supersede the amplitude board's reach column** (PLAN.md Discovered, quantile-pinned at
   50%)? It is a strictly better answer to the same question — worth folding rather than fixing.

---

## §7 — VALIDATION STUDY: do our scores predict anything? (2026-08-07)

Ben, on being offered a grade-based digest filter: *"I'd be interested in validating that the rows we
are demoting are in fact not deserving of their spot before we demote them. Our grade is a rough
approximation, not convinced it should be used to filter yet."* He was right. Run before building.

**Method.** Every `script:'screen'` row in `suggestions.jsonl` carrying an `ask`, `bid`, `itemId` and
`ts`, deduped to one row per (item, day, ask) to blunt pseudo-replication, restricted to rows whose
3-day outcome window lies fully inside the 5m archive's coverage. Ground truth = *did any 5m bucket in
`[ts, ts+3d]` print `avgHighPrice ≥ ask`?* This is observable for EVERY row, including ones never
traded — no fills needed, so it is not restricted to what Ben happened to buy. n = 1,750–1,777.

| signal | buckets (low → high) | monotone? |
| --- | --- | --- |
| **grade** | D **95.3%** · C 86.9% · B- 85.0% · B 89.4% · A- 91.0% · S+ 93.2% | **NO** — D is the highest |
| **rank** (`net × P ÷ TTF`, AF1's digest key) | 98.0 · 86.2 · 89.0 · 95.2 · 86.8% | **NO** |
| **pFill** (the model's own fill estimate) | 86.8 · 88.2 · 93.5 · 96.9 · 89.9% | **NO** (rises then falls) |
| **ask premium over bid (%)** | **98.3 · 93.5 · 91.0 · 91.0 · 81.5%** | **YES — the only one** |

**Conclusion 1 — do NOT filter the digest on grade or rank.** Neither predicts the observable outcome;
a grade filter would have demoted the rows that reach their exit MOST often. The proposed tail-filter
is withdrawn pending a signal that measures.

**Conclusion 2 — the base rate is 91.5%.** Almost every quoted ask prints within 3 days. So "will the
price get there" is barely the binding constraint, which compresses the variance every score is trying
to explain. **What binds must be elsewhere** — queue position (was *your* ask taken?), size, or the
entry leg. This is §5 risk 1 promoted from a caveat to the central finding: `avgHighPrice ≥ P` proves
buyers paid ≥P, not that you sold.

**Conclusion 3 — this REINFORCES AF1 on better grounds than it shipped with.** If P(print) is ~flat at
91% regardless of score, expected value ≈ `net × 0.91`, so ranking on a NET-based key is right and
ranking on a scale-free % (`capEff`) is wrong. AF1's fix was correct; the stated reasoning (a
degenerate zero-product) was only half of it.

**Conclusion 4 — widen the pool freely (Ben's call, accepted).** Since no composite score currently
separates good from bad, a bigger archive-gated pool is strictly more raw material for a filter built
on MEASURED reachability. The earlier "filter before widening" recommendation is **withdrawn**; AF4 is
the right next build.

**Honest limits.** (a) "Ask printed" measures REACHABILITY only — a D-grade item printing a +4gp ask is
not a good trade, and grade encodes net size and liquidity that this outcome ignores entirely. This
does **not** show grade is worthless, only that it does not predict THIS. (b) A 91.5% base rate leaves
little variance to explain, so all these signals are being asked to separate a narrow band. (c) Dedup
was (item, day, ask); the same item still recurs across days. (d) One 3-day horizon, one market period.

### §7.1 — CORRECTION: §7's headline conclusion was wrong (same day, after Ben's challenge)

Ben, on reading §7: *"Could that 91.5% be based on flawed data? … Worth investigating why we feel like
the lower grades are better, could there just be more of them?"* Both challenges were run. The metric
survived; **the conclusion did not.**

**The metric is VALID — placebo confirms it discriminates.** Re-asking "did it print within 3d?" with
the quoted ask inflated:

| ask × | 1.00 | 1.02 | 1.05 | 1.10 | 1.20 | 1.50 | 2.00 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| printed | **91.5%** | 60.6% | 33.5% | 13.9% | 4.1% | 2.2% | 1.3% |

A 2% higher ask HALVES the fill rate. So 91.5% is not a permissive test rubber-stamping everything —
and, separately, this says **the estimator quotes right at the edge of reachability with almost no
headroom**, which is itself worth knowing.

**But the grade comparison was CONFOUNDED, and Ben's hypothesis is what explains it.** The D and A-
populations are not comparable:

| grade | n | median bid | ask premium | printed |
| --- | --- | --- | --- | --- |
| A- | 630 | **12,851,559** | 3.28% | 91.0% |
| D | 528 | **845** | 4.50% | 95.3% |

Holding ask-premium constant (2.5–5% band) D STILL leads (96.9% vs 91.5%), so premium is not it.
Price is not it either — print rate by price quintile is **flat** (93.2 · 87.0 · 91.8 · 91.3 · 91.9%).
**Trading FREQUENCY is:** print rate by count of 5m buckets traded in the window runs **85.9 · 89.6 ·
93.0 · 91.8 · 95.0% — monotone**. An item that trades constantly crosses any nearby level constantly;
more observations, more chances to exceed. That 9-point spread is roughly the ENTIRE range grade
appeared to explain.

**Revised conclusion.** §7's "grade and rank predict nothing" is **withdrawn as stated**. What was
actually shown: (1) grade does not predict REACHABILITY, and (2) reachability is confounded with trade
frequency, which grade anti-correlates with by construction (thin big-tickets vs dust commodities). But
**grade was never designed to predict reachability** — it encodes net size, liquidity class and
confidence. Judging it on "did the ask print" is the wrong test.

**Do NOT delete the grades on this evidence** (Ben raised it; it is a fair question). The honest
position is weaker than "grades work": it is **absence of validation, not evidence of failure**. A real
test needs an outcome reflecting what grade claims to predict — realized profit per unit time on trades
actually TAKEN — which is the F1 fills join and is sample-limited. Recorded as the open question.

**What still stands from §7:** the placebo-validated finding that quoted asks print ~91.5% of the time
and collapse to 60.6% at +2%, i.e. price-reaching is rarely the binding constraint and the quotes sit
on a knife-edge; ask premium as the one monotone predictor; and Conclusion 4 (widen the pool freely).
**What falls:** any recommendation to filter or delete on the strength of the grade comparison.

### §7.2 — Grade validation: OPEN, LOW PRIORITY (Ben's ruling, 2026-08-07)

*"I think it's pretty clear that it is flawed in many ways — we're not leaning heavily on it so it's
not a big issue right now, but we should definitely record it and come back to it later. Low priority."*

**Recorded, not scheduled.** What is actually known:

- Grade does NOT predict reachability (§7), but reachability is the wrong test for it (§7.1) — the
  comparison was confounded by trade frequency, which grade anti-correlates with by construction.
- AF1 removed grade from the digest's SORT, and `capitalFactor` was already removed from grades by
  PLAN-GRADE-REWORK. So the surfaces lean on grade less than they used to — which is why this is low
  priority rather than urgent.
- Grade is still load-bearing in three places worth knowing before anyone deletes it: the `/scan` relay
  trim (B- and above), the Path-A fallback sort when `pathA` is null, and `SUBFLOOR_GRADE_CAP`.
- **A real test needs an outcome that reflects what grade CLAIMS to predict** — realized profit per
  unit time on trades actually TAKEN. That is the F1 fills join and it is sample-limited: only items
  Ben traded have ground truth, so it inherits every selection bias §7 avoided by using the archive.
  Expect this to stay under-powered for a long while; say so rather than reporting a weak result.
- **Do not delete grades on the current evidence.** The honest state is absence of validation, not
  evidence of failure.

---

## §8 — Fable adversarial validation (2026-08-07). The numbers held; the INFERENCES did not.

Read-only re-run of every study against the archive + `suggestions.jsonl`. **Nothing was fabricated —
§7's tables reproduce essentially exactly** (base 91.1% vs 91.5% after a day's accrual; the grade row
D 95.3 · C 86.9 · B- 85.0 · B 89.4 · A- 91.0 · S+ 93.2 and the premium row 98.3 · 93.5 · 91.0 · 91.0 ·
81.5 are EXACT; the placebo reproduces). What failed is what I concluded from them.

### B1 — §0's motivating claim is RETRACTED (corrected in §0 in place)

1h and 5m give identical reach counts — 8/15 both grains on UTC days, 10/15 both grains on LOCAL days.
The plan's premise was a read-to-read difference mislabelled as a grain difference.

### B2 — §7.1's confound conclusion fails its OWN methodology

§7.1 rejected ask-premium as the confound *because D still led with premium held constant*. It then
accepted trade FREQUENCY without running that same conditioned test. Run: D still leads A- in **every
frequency tercile** (+1.6 / +5.3 / +3.1 pp; n=84/223/221 vs 302/163/165). By §7.1's own logic frequency
is *also* not the confound. The frequency variable barely varies either (quintile bounds 55–477 /
477–523 / 523–538 / 538–580 / 581–602 out of a possible 864), so Q2–Q5 are near-identical populations
and Q1 alone carries the signal.

**Honest state: premium, frequency, price, item class and grade are ENTANGLED, and no single mechanism
has been identified.** §7.1 picked one and declared it *the* explanation. **§7.1's practical rulings
still stand** — do not filter on grade, do not delete grades — but they rest on "we cannot explain the
anomaly", not on "frequency explains it".

### M1 — the 91.5% base rate is substantially SELF-FULFILLING

Screen asks are quoted *from* recent reachability, so the study largely tests the estimator on the
process that generated it. Split by the estimator's own logged `estConfidence`:
quoted-when-hit-all-recent-days printed **96.5%** (n=57); `<1/3` printed **84.1%** (n=359).
Consequence the plan never drew: `askAtFillRate`'s `pct` lever is an **in-sample quantile**, and its
out-of-sample 3-day hit rate is exactly the uncalibrated quantity. §1 must stop presenting
`pct → P(fill)` as directly interpretable.

### M2 — §1's `units/day @≥ask` column is wrong (70 / 48 / 16 / 2)

Those are the single best recent DAY, not a per-day rate. True recent-7 averages: **32.4 / 16.7 / 7.3 /
2.0**. At the recommended 27.15m the expectation is **~7 units/day, not 16**, and it is lumpy —
0, 0, 30, 0, 6, 1, 14 across the window, with **3 of 7 days at ≤1 unit**. The qualitative claim (flow
collapses as price rises) is right; the quantities are not.

### M3 — §3's outlier is described wrongly on the load-bearing detail

The 35,000,004 print carried **1 unit, not 53**. And 07-28 was a genuine brief dislocation, not a pure
artifact — the same morning shows `avgLowPrice = 31,000,000` on 2 units, i.e. people *instaselling* at
31m. A second single-print spike at 07-12 (32,776,000, 1 unit) was missed entirely. **AB2's premise
survives and is now properly measured**: 114 spike days / 12,028 item-days (**0.9%**) touching 75 of
511 items ≥1m. But the fixture AB2 was told to pin is mis-described.

### M4 — the recency story is UTC-based, hair-thin, and already broken

§2's table reproduces exactly *under UTC days* — but the repo convention is LOCAL days and Ben trades
local. Under local days the last-3 is **2/3, not 3/3**, and the most recent local day (08-07, high
27,000,000) is a **MISS** at 27.15m. The 08-06 "hit" cleared by **+10,215 gp (0.04%) on exactly 1
unit** — an 11k-higher ask turns 3/3 into 2/3. "The difference between 57% and 100%" rests on a
one-unit hair-width print plus a day-boundary choice. Independently re-verified.

### M5 — non-independence breaks the monotonicity claims

1,777 rows over **284 items** (top-20 items = 25% of rows); outcomes are item-dominated (191 items
all-print, 21 all-miss, only 72 mixed; within-item variance share 0.648). Cluster bootstrap over items
(B=2000): premium Q1≠Q5 **robust** (P≈1.000), frequency Q5≠Q1 robust (P=0.998) — but **full
monotonicity fails for both** (P=0.283 premium, P=0.161 frequency). So "ask premium is the only
monotone predictor" survives only as "Q1 differs from Q5". Also, premium Q5 spans 7.88%–**2,943%** and
contains the value-mode far-OTM asks, so part of that effect is mechanical.

### M6 — AB6 cannot do the job it was assigned

Shadow-logging both prices only yields ground truth for the arm actually listed; the unplaced arm must
be scored by the print proxy, which is the thing under test. Without randomised arm assignment AB6
validates the PROXY, not the price CHOICE. And both quotes cluster at the same reachability edge (M1)
and both print ~90%, so discriminating them on the disagreement subset needs months against 262 closed
flips / ~200 sell placements / 57 items in 30d. **AB6 needs redesign or an honest relabel before it is
called "the only chunk that produces evidence".**

### What SURVIVED attack

- **The fill proxy holds for qty=1 — and §5 risk 1's hedge was pointed the WRONG WAY.** A print at
  q ≥ P implies the ask book was empty below q at that instant, so a resting 1-unit ask at P ≤ q would
  have been hit first; and `avgHigh < P` does not rule out a print ≥ P. Measured hit rates are
  therefore **lower bounds**, not over-statements. The real over-statement risks are qty > flow (AB3
  covers it) and regime persistence (M1). A volume-aware rescoring moves the base rate only
  91.1% → 90.0% at ≥5 units, without reordering grades.
- The placebo design, and that it validates the metric discriminates price levels.
- §7/§7.1's arithmetic throughout, and the Masori arithmetic (BE 26,174,490; net +955,999 at
  27,149,999; 27.50m thin at 2.0 units/day — all exact).
- AB2's outlier-guard premise, now with a real base rate.

### The live recommendation, restated honestly

**27,149,999 still stands** — 26.90m and 27.15m both hit 4/7 on the recent-7 local, so the extra
+245k/u costs no measured hit rate; hit-days print 6–30 units against a 1-unit lot; and with BE at
26,174,490 **the downside is waiting, not loss**. What was overstated is the *support*: "3/3 recent"
was UTC and is 2/3 local with the newest day a miss, and ~7 units/day is the honest flow, not 16.
Omitted from the original write-up: the item has **bled from ~30m in mid-July to 26.6–27.5m**, and the
four-day miss run 07-29→08-01 is what listing into a soft stretch looks like.

### m1 — §7's grade table was curated

Omitted: B+ 94.7% (n=38), VALUE-WATCH 78.9% (n=19), **VALUE-BUY 12.5% (n=8)**, A/S 100% (n=3 each),
A+ 0% (n=1). Small n each, but VALUE-BUY's 12.5% is direct evidence for the premium mechanism, and
leaving it out flattered the "grade predicts nothing" reading.

---

## §9 — THE RESPONSE SURFACE: premium over MID is the rankable variable (2026-08-07)

Ben, on seeing the first cut: *"Premium measured over mid is exactly the key to being able to rank
items."* This section is that surface, measured.

### 9.1 Why premium-over-BID was a contaminated variable

§7 measured "ask premium over **bid**" — `(ask − bid) / bid`. That conflates two different things:
**how greedy the ask is** and **how good the buy was**. Ben's live Masori chaps lot makes the gap
concrete:

| | level | vs his own buy | vs market mid |
| --- | --- | --- | --- |
| BUY | 25,651,000 | — | **−4.02%** |
| break-even | 26,174,490 | +2.04% | −2.06% |
| ASK | 27,149,999 | **+5.84%** | **+1.59%** |

The same order reads as a **5.84%** premium on §7's variable and **+1.59%** on the market-relative one.
Two items with identical bid→ask spreads can sit at opposite ends of the reachability curve. **Premium
over MID is the variable that ranks; premium over bid does not.** This is a further reason §7's premium
quintiles misbehaved, on top of the endogeneity in §8/M1.

### 9.2 The measured surface

**381 items × 6 reference windows (T−5/8/11/14/17/20d) × 6 premiums × 2 horizons = 25,692
observations.** Reference mid = prior-24h mean `avgHighPrice`. Outcome = did any 5m bucket in the
horizon print `avgHighPrice ≥ mid × (1+premium)`. **Premium is EXOGENOUS by construction** — we set it
on a grid rather than reading back asks the estimator chose from reachability, which is what made §7
self-fulfilling (§8/M1).

| premium over mid | P(print ≤1d) | P(print ≤3d) |
| --- | --- | --- |
| +0.5% | 85.1% | 91.1% |
| +1.0% | 80.1% | 87.5% |
| +2.0% | 70.2% | 79.9% |
| +3.0% | 62.7% | 73.4% |
| +5.0% | 49.8% | 61.0% |
| +8.0% | 37.8% | 49.6% |

🛑 **The "monotone on both axes, no exceptions" boast was a CATEGORY ERROR — it is true BY
CONSTRUCTION and carries zero evidential weight (§10/M1).** The events are NESTED: `printed ≥
mid×1.08` ⊂ … ⊂ `printed ≥ mid×1.005`, and `(T, T+1d] ⊂ (T, T+3d]`. So this table is monotone for
ANY data, real or random — 0 violations in 127,080 cells, necessarily. §7's monotonicity COULD fail
(it compared different items' asks); this version cannot fail any test. Do not cite the monotonicity
as a finding. **What the numbers ARE good for is their LEVELS**, which are separately validated:
item-cluster bootstrap CIs ±0.7–1.7pp, and stable across three window sets spanning the archive's
70 days (§10).

### 9.3 Frequency is an amplifier, not a crossover — earlier claim CORRECTED

| premium | low-freq | mid-freq | high-freq |
| --- | --- | --- | --- |
| +0.5% | 92.1% | 89.9% | 91.3% |
| +1.0% | 89.8% | 87.0% | 86.1% |
| +2.0% | 83.8% | 80.2% | 76.8% |
| +3.0% | 81.2% | 72.9% | 68.1% |
| +5.0% | 72.5% | 62.7% | 51.5% |
| +8.0% | 63.3% | 53.3% | **37.0%** |

⚠ **A single-window 300-item cut suggested the lines CROSS (high-freq best at +1%, worst at +8%). That
does not survive six windows and 381 items.** Low-frequency is better at EVERY premium; what changes is
the GAP, widening from ~1pp at +0.5% to **26pp at +8%**. Mechanism unchanged: liquid items trade
constantly but in a tight range, so they reliably touch nearby levels and rarely travel far; thin items
are the reverse. But it is an amplifier, not a sign flip. The crossover was noise.

### 9.4 What this unlocks — the ranking rule, and it needs no grade

For any candidate, all four inputs are archive-derived, **zero API**:

```
achievable buy   ← the dip level (existing reads)
achievable ask   ← candidate price
premium          ← ask / mid − 1              ← the rankable variable
P(print)         ← surface lookup, by premium × frequency × horizon
net              ← ask × 0.98 − buy
rank             ← net × P(print)
```

This is a direct answer to **AF3b's cream-of-the-crop problem** that does not use grade, rank, capEff
or any composite whose validity §7/§8 could not establish. It also composes with the archive-first
funnel: AF4–AF6 make gating free, and this makes ranking measured.

### 9.5 Entry quality dominates exit pricing — with a number

The curve is steep near zero: **+1% prints 87.5% at 3 days, +5% prints 61.0%.** So buying ~4% cheaper
is worth roughly **26 points of fill probability**, before it is worth anything in net. Ben's chaps lot
is the worked example: buying 4.02% under mid is the ONLY reason a +1.59% ask clears break-even at all.
This puts a number on the existing buy-the-dip doctrine — the entry sets the exit's feasible range, and
the exit model is downstream of it.

### 9.6 Ben's live position on the surface

~~Masori chaps is thin (181/d → low-freq tercile); the ask sits at +1.59% over mid. Interpolating
between +1.0% (89.8%) and +2.0% (83.8%): **~86% to print within 3 days.**~~

🛑 **WRONG BY ~26–33pp — the lookup omitted PRICE TIER, which dominates (§10/B1).** Re-measured on the
same data, conditioned on price: a **≥10m** item at +1% prints **71.2%** and at +2% **52.4%**, so the
+1.59% ask interpolates to **~60%** — and Fable's tighter `≥10m ∩ low-freq` cell gives **52.7%**
(n=203, 34 items). The pooled §9.2 curve was dominated by cheap items (7,634 of 9,416 observations
under 100k), so it described dust, not big-tickets.

**Honest estimate for the live lot: ~53–60% to print within 3 days**, versus 92% from `1−(1−p)³` (§1),
~83% from the crude grid, and ~86% from the un-conditioned surface. Every successive method has moved
DOWN. The ask is still defensible — BE is 26,174,490 so the downside is waiting, not loss — but its
odds are roughly a coin-flip over three days, not a near-certainty.

### 9.7 Honest limits

1. **Still the print proxy, not fills.** For a 1-unit lot it is a conservative lower bound (§8), but
   that stops holding with size — flow-at-level (AB3) remains a separate, necessary check.
2. **One market period.** Six windows inside a single ~25-day stretch is not six independent regimes.
   Rebuild across a genuinely different regime before trusting the levels.
3. **Clustering.** One row per (item, window, premium, horizon) means item effects are still repeated;
   the §8/M5 cluster-bootstrap discipline applies before any p-value is quoted off this.
4. **Terciles are sample-relative**, not absolute liquidity classes — they will move with the sample.
5. **Mid is a choice.** Prior-24h mean `avgHighPrice`; a different base (VWAP, instasell mid, longer
   window) shifts every premium and therefore every level. Pin the definition wherever this is used.

---

## §10 — Fable attack on §9. Data real and regime-stable; the RANKING RULE misspecified.

Independent re-extraction (read-only) over all 3,782 items with ≥50 5m rows/25d, plus a 1h rebuild
across three window sets spanning the archive's 70 days, plus item-cluster bootstraps (B=2000).

### 🛑 B1 — the §9.4 lookup key omits PRICE TIER, which dominates

`P(print) ← surface lookup by premium × frequency × horizon` **miscalibrates big-tickets by ~30pp.**
Re-measured (1,656 dense items, 3d horizon):

| premium | <100k | 100k–1m | 1–10m | **≥10m** |
| --- | --- | --- | --- | --- |
| +1.0% | 90.5% | 85.6% | 76.3% | **71.2%** |
| +2.0% | 83.9% | 77.8% | 63.9% | **52.4%** |
| +5.0% | 65.5% | 53.0% | 37.0% | **22.2%** |
| +8.0% | 54.5% | 40.7% | 25.9% | **10.9%** |

**7,634 of 9,416 observations are sub-100k items**, so the pooled §9.2 curve describes dust. The
price-tercile spread at +3% is 87.1% (cheap × low-freq) vs **46.9%** (expensive × high-freq) — and the
top tercile *starts* at 6,728gp, so a 27m item is far into the tail of even that bucket.

**Consequences:** §9.6's live estimate was wrong by ~26–33pp (corrected in place). §9.5's "4% cheaper ≈
26 points" is **44 points** on ≥10m items (68.3% → 23.9%) — direction survives, pooled magnitude
understates the class Ben actually trades. **Any shipped lookup MUST condition on price tier (or on
per-item history), or `net × P(print)` will systematically over-rank big-ticket rows — the exact place
a wrong verdict costs most.**

### M1 — §9.2's monotonicity is TRUE BY CONSTRUCTION (corrected in place)

Nested events; monotone for any data. 0 violations in 127,080 cells, necessarily. The
"contrast §7, where monotonicity failed" line was a category error: §7 compared different items' asks
and *could* fail; this cannot. What the bootstrap CAN test is levels (tight: ±0.7–1.7pp) and the
frequency ordering (below).

### M2 — §9.3's "low-freq better at EVERY premium" FAILS the bootstrap

**P(low > high at every premium) = 0.056.** Robust at ≥+2% (P=1.000 each), but at +0.5% the full dense
pool **reverses the point estimate** (high 92.0 vs low 90.7). So my "the crossover was noise"
correction was ITSELF overconfident — a low-premium crossover is live and unresolved. The
gap-widening claim IS robust (P=1.000).

**Safe statement: frequency separates strongly at premiums ≥2%; below ~1% it separates nothing.**

### M3 — frequency is mostly a proxy for relative VOLATILITY

Spearman(freq, relStd) = **−0.41**. Conditioning on volatility tercile collapses the +8% frequency gap
from **25.6pp to 2.8–8.5pp**, and in the lowest-volatility tercile it vanishes entirely (21.3 / 18.8 /
18.5). Volatility alone spans **19.1% → 77.6%** at +8% — the strongest item-level variable found, and
stable across all three 1h periods. Frequency does survive *price* conditioning at high premium (so
§7.1's specific confound claim is not resurrected), but **if the lookup takes one item axis, measured
relative volatility beats trade frequency decisively.**

### M4 — selection moves the levels; "exogenous" applies to the premium, not the sample

By density stratum (3d): sparse (50–500 rows) at +0.5% = **76.5%** vs dense 91.3%; mid-density at +8% =
**62.9%** vs dense 50.4%. Partly real (thin items don't print nearby levels; volatile mid-density items
travel further) and partly **mechanical** — the 5m archive holds 9–272 of 288 daily buckets on some
days, and an unarchived bucket can never print. Second-order for dense items (per-window levels vary
±2.5pp without tracking coverage), but it makes the sparse-stratum surface uninterpretable. **§9's
levels describe DENSE items only.**

### m1 — window clustering adds uncertainty an item-bootstrap misses

Per-window +2% levels span 78.1–82.3%. Publish levels as **±2–3pp**, not ±1pp.

### ✅ Confirmed — and two genuinely good results

- **The table reproduces exactly.** Independent seeded 400-item sample, 3d: 91.1 / 87.2 / 80.4 / 73.3 /
  61.4 / 49.7 against §9's 91.1 / 87.5 / 79.9 / 73.4 / 61.0 / 49.6; full 1,762-item pool within 0.8pp.
  Nothing fabricated, nothing sample-lucky.
- **The levels are NOT a one-period snapshot (attack 4 — the one I most expected to fail).** Fixed
  2,163-item cohort, 1h grain, three window sets (recent / T−35..50d / T−50..65d): every 3d level agrees
  within **2.5pp** (+8%: 51.4 / 48.8 / 49.0; +0.5%: 89.2 / 88.9 / 89.9). Frequency ordering and
  gap-widening replicate in all three. Also grain-robust (1h vs 5m within ~2pp). Caveat: 70 days is one
  summer — this rules out "lucky fortnight", not "different macro regime" (e.g. a game-update month).
- **`mid` sensitivity quantified (§9.7.5's "pin it" is now mandatory-for-correctness).** Same items,
  3d, +2%: base 80.5% · **VWAP 80.1%** · instasell-side **93.4%** · 72h window 78.0% · 6h window 81.2% ·
  last-print **73.3%**. VWAP is a no-op (−0.4pp) so volume-weighting is not a worry; base SIDE and
  WINDOW shift every level 5–15pp. Every consumer must compute premium off the identical base or
  inherit a silent ±10pp bias.
- **Crash-risk regime bound tightened from <22% to <6% (attack 6).** 214 crash-risk items classified,
  live 6h fetched for 120: **2/120 flip (1.7%, 95% CI [0.2%, 6.0%])**. Both flips are hair-width
  strict-inequality floor-break artifacts (gaps **−1gp / −0.74%** and **−4gp / −0.13%**), and the
  direction is CONSERVATIVE — the archive over-flags falling vs live. Worth encoding: **a floor-break
  decided by ≤ a few gp is below the derived-6h noise floor.**

### What is safe to build on

The premium→P(print) surface **for dense items, under a pinned mid definition, conditioned on PRICE
TIER, with levels trusted to ±2–3pp**, regime-stable across the archive's 70 days, using **volatility**
(not frequency) as the item axis, and only claiming separation at premiums ≥2%.

**Not safe:** the pooled or frequency-tercile numbers for any specific candidate; the monotonicity as
evidence; the +0.5–1% frequency ordering; anything on sparse items.
