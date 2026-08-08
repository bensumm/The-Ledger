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

**The smoothing cost is measured, not theoretical.** For Masori chaps at ~26.93m, the 1h-derived reach
says **5/14 days**; the same question asked of **5m buckets** says **10/15**. The 1h basis was hiding
half the fills. 5m is 12× finer and the archive already holds 30 days of it for ~4,438 items.

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

| # | Chunk | Dep | Effort |
| --- | --- | --- | --- |
| **AB1** | Pure `askAtFillRate()` in `js/windowread.mjs` + fixture. Reads a passed-in series; no fetch, no archive coupling. | — | S |
| **AB2** | Outlier guard (§3), neighbour-relative, fired before the quantile. Fixture-pinned on the 07-28 artifact. | AB1 | S |
| **AB3** | `unitsPerDay` + `P(fill ≤ N days)` as first-class outputs; a thin-flow refusal so the optimizer cannot recommend a level with no flow. | AB1 | S |
| **AB4** | Recency fold — shapes (a)+(c) from §2, cushion sourced from the existing `reachMargin`, not re-derived. | AB1–AB3 | M |
| **AB5** | Surface on `read-window-range.mjs` as an opt-in flag (`--fill-rate`), console-only, INFORM. Compare against the existing quantile line in the same output so the divergence is visible. | AB1–AB4 | M |
| **AB6** | Shadow-log both the quantile price and the backtest price to `suggestions.jsonl`; join realized fills at F1 to settle which predicts better. **This is the only chunk that produces evidence.** | AB5 | M |
| **AB7** | Only after AB6 shows a win: promote to the default ask basis on `/positions` and the scan. | AB6 | M |

**Sequence:** `AB1 → AB2 → AB3 → AB4 → AB5 → AB6 → (gate) → AB7`.

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
