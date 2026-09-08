# PLAN-ENTRY-CONFIDENCE — what the buy line didn't say

Drafted 2026-09-08 from a live post-mortem. Ben's ask, verbatim intent: *"Was the buy price
around the suggested buy price or was this genuinely my mistake? If that's the case we need to
work on how it is presented so that it's unambiguous."*

**This document deliberately does NOT contain a solution.** It states the problem, the evidence,
the tension any fix has to resolve, and what a done outcome looks like. The executor designs the
mechanism; nothing below is a prescribed implementation. Where a claim is unverified it says so.

Chunk prefix **EC** (verify free of collisions with `lint-plan-refs.mjs --collisions` before
using it — not yet run at drafting time).

## The trade this came from (facts, verified 2026-09-08)

Avernic defender hilt (22477). The band-mode screen fired at **20:58 PDT on 09-07** with
`estBuy 29,890,723 → estSell 30,699,999`. The agent relayed it as the session's top pick. Ben
bought 1 @ **29,909,000** at 21:17 PDT and listed @ 30,848,000.

| | Recommended | Executed | Δ |
| --- | --- | --- | --- |
| Buy | 29,890,723 | 29,909,000 | +18,277 (**0.061%**) |
| List | 30,858,549 | 30,848,000 | −10,549 |
| Net at the pair | +350,655 | +322,040 | −28,615 |

**The execution was faithful and the price was unambiguous.** The original hypothesis — that the
suggested buy price was presented unclearly and was therefore missed — is REFUTED. Whatever is
wrong is upstream of the number, in the confidence attached to it. An executor who starts by
making the suggested price more prominent has misread this document.

By 11:43 PDT on 09-08 the lot read CUT-CANDIDATE, 624,859 under break-even at the day's high.
The **first** CUT-CANDIDATE was logged at 23:33 PDT on 09-07 — **2h16m after the fill**. A lot
that reads CUT inside one window of entry was not moved against by the market; it was priced
above the sell-side reach on arrival.

The relayed recommendation argued *against* the one patient alternative it named:

> *"Patient alternative: 29,700,000 … With the floor climbing +235k/d that rung is walking away
> — I'd take the fill."*

That sentence is the whole subject of this plan. The rising-floor number was **not invented** —
it was a faithful relay of what the tool said. The tool was wrong, and the reason is structural.

## Defect 1 — the forming-day guard is time-of-day blind

`floorCeilingTrack` (`js/windowread.mjs:468`) splits off the current, incomplete day so it never
feeds the slope or the break test (`:472-477`), surfacing it separately as `forming`. The guard
is **binary on `key === todayKey`** — it has no notion of how much of the day has elapsed.

Reconstructed at the exact entry cut, the cue read:

| As of | Floor slope (full-day) | Floor slope (peak-window) | dir | run | `break` |
| --- | --- | --- | --- | --- | --- |
| **09-07 evening (entry)** | **+418,376/d** | **+265,138/d** | **rising** | **rising ×5** | `false` |
| 09-08 evening | +120,079/d | −44,436/d | flat | falling ×1 | `false` |

At 21:05 PDT — **88% of the way through the local day** — 09-07 had already printed a low of
~29.38–29.43m during its 01:00–13:00 window, roughly **1.3m below** the last completed day's
30,739,055. The cue reported `rising ×5` with `break: false` while the day in progress had
already broken through the trend it was describing, because that day was excluded by
construction. Nothing about the market changed overnight; 09-07 merely stopped forming.

**This is a genuine tension, not a simple bug, and the executor must resolve it rather than pick
a side by reflex.** `pipeline/test/windowread.test.mjs:900-918` exists precisely because the
guard is load-bearing in the *other* direction: it pins that a mid-session deep print (a forming
low of 500 under a 1000 floor) must NOT fake a `floorBreak` / `crash-risk`. So:

- **Early in the day** — including the partial day biases the floor *up* and can fake a break
  *down*; the guard is right and the test proves it.
- **Late in the day** — excluding it discards the most recent, most decision-relevant, and by
  then nearly-complete observation; the guard is wrong and this trade is the proof.

A fix that simply drops the guard re-breaks the pinned test. A fix that keeps it unchanged
leaves the failure in this document intact. Any elapsed-fraction or partial-day-weighting notion
is a NEW estimator and inherits rule 4 — the honesty rails on `floorCeilingTrack` (thin history
⇒ `null`, never a fake read, `:919-922`) are the standard to match.

**Unverified, and worth an executor's first ten minutes:** the relayed message quoted
`+235,079/d`, while the closest reconstruction here is `+265,138/d` on the peak window. The
window was `01:00–16:00` at the time and reads `01:00–13:00` now, which plausibly accounts for
the gap — but it has NOT been confirmed, and the exact producing call site is therefore not
established. Do not treat `+235,079` as traced.

## Defect 2 — the guard is applied inconsistently across call sites

`todayKey` is opt-in per call site, and the sites disagree:

| Site | Passes `todayKey`? | Surface |
| --- | --- | --- |
| `pipeline/commands/quote-items.mjs:192` | **yes** (`localDayKey()`) | `/positions` |
| `pipeline/commands/read-window-range.mjs:360` | **yes** | trajectory read |
| `pipeline/commands/read-window-range.mjs:540` | **yes** | window read |
| `pipeline/commands/screen-flip-niches.mjs:1567` | **no** | **soft-buy cue (scan)** |
| `pipeline/commands/screen-flip-niches.mjs:2346` | **no** | **soft-buy cue (scan)** |
| `js/forecast.mjs:388` | **no** | feeds `driftExitFrom` |
| `pipeline/commands/join-exit-ev.mjs:250` | **no** | offline analysis |

So the two surfaces most likely to be read side by side in one session — the scan's soft-buy cue
and the positions floor/ceiling line — can give **different answers about the same item on the
same day**, and neither states which convention it used. Note the direction: the *unguarded* scan
sites fold the partial day back in, which is the behaviour the pinned test calls a false break.

Whether every site should converge, or the divergence is deliberate per surface, is an open
question — but it is currently undocumented either way, which is the defect regardless of which
answer is right.

## Defect 3 — `forming` is computed and rendered, but only where the guard ran

`formatFloorCeiling` (`js/windowread.mjs:539`) already pushes a
`today forming low X/high Y (provisional)` clause when `fc.forming` is truthy (`:553`). But
`fc.forming` is non-null **only on the call sites that passed `todayKey`** — i.e. exactly the
sites that don't need the warning most. On the unguarded scan sites the partial day is silently
inside the slope with no clause available to render.

None of the reads taken during this post-mortem surfaced that clause on the positions path
either; whether `fc.forming` was null there (the archive window ending yesterday) or the clause
was dropped downstream is **not established** and is a cheap thing to determine first.

## Defect 4 — the dip level is computed and never shown next to the buy

Independent of the floor cue, and the same failure shape. The logged suggestion carried
`timedLap.dipReality.typicalLevel = 29,383,485`, **reached 6/7 days, recent 3/3**, and
`estConfidence.buyPlacement = 0.64`. Ben paid 29,909,000 — **525,515 over a level that prints
almost every day**, which is **2.7× the trade's entire expected net** (+195,276 at the shown
pair, 0.65%, `pFill 0.39`).

Neither number reached the buy line. Both were already computed and already logged. This is
arithmetic on fields in hand — no fetch, no estimator, no calibration claim — which is why it is
in this document despite being a different mechanism from Defects 1–3.

Counterfactual, stated narrowly: at 29,383,485 break-even would be 29,983,148 instead of
30,519,388; 09-07's high (30,416,478) clears it and 09-08's 29,894,529 misses by 88,619 rather
than 624,859. **This is not a claim the trade would have won** — only that the entry premium, not
the market, accounts for most of the current gap.

Related precedent the executor should read before touching the cue: the same
`▲ favorable — dip in uptrend` wording already has a documented failure mode (the Snape grass
entry — `js/validate.mjs:317`, `js/windowread.mjs:1437-1455`), where a 5-day window sitting
entirely inside a spike made the floor "rise" *because* it spiked. That is a THIRD way this one
cue can be confidently wrong, and it was already known. A fix that addresses only the forming
day has addressed one of three.

## Defect 5 — full-day and window daily lows disagree (data integrity, separate)

Comparing `read-window-range.mjs --nights 14` bare against the same command with
`--window peak`, the **window** low sits BELOW the **full-day** low on **5 of 13 days**:

```
2026-08-30  full-day 30,234,538   window 29,927,813   (−306,725)
2026-09-01  full-day 29,070,922   window 28,895,891   (−175,031)
2026-09-05  full-day 30,110,089   window 30,054,177   (−55,912)
2026-09-06  full-day 30,739,055   window 30,169,235   (−569,820)
2026-09-07  full-day 29,429,316   window 29,383,485   (−45,831)
```

A subset's minimum cannot be below its superset's. Most likely the two paths bucket local days
differently or read different series, but that is a **guess and is explicitly not diagnosed
here** — the refuting test is to trace both back to their source series and day-bucketing, which
is its own chunk and may not belong in this plan at all.

It does not invalidate Defects 1–3: each slope comparison above used one table consistently, and
both tables independently show rising → falling across the same day boundary.

## What "done" looks like, as an outcome rather than a mechanism

- A buy suggestion whose price sits materially above a high-reach dip level says so **on the buy
  line**, with the level and its reach fraction, at the moment of the recommendation.
- A floor/ceiling cue cannot report a rising or healthy trend while the day in progress has
  already broken through it — by whatever mechanism the executor chooses, including deciding the
  honest answer is to refuse a direction word rather than compute a better one.
- The guard convention is the same across surfaces, or the divergence is documented at both
  sites with its reason.
- `pipeline/test/windowread.test.mjs:900-918` still passes unchanged, or its replacement pins
  the same property with an argued reason for the change.
- A regression test fails if a forming-day break can be hidden behind a rising label. Note this
  is an absence-assertion, the class that passes for the wrong reason — process rule 10's
  mutation check applies with force.

## Open questions for the executor to answer, not assume

- Is the right unit an elapsed-fraction weighting, a separate always-visible forming line, a
  suppression of the direction word when forming contradicts it, or something else? Undetermined.
- Should the unguarded sites converge on `todayKey`, or is per-surface divergence correct? The
  scan's soft-buy cue is a BUY decision and the positions line is a HOLD read; that may justify
  different conventions, or may not.
- Does `driftExitFrom`'s unguarded call (`js/forecast.mjs:388`) inherit the same defect, and does
  it change any projected level that reaches a surface?
- Does Defect 4 belong here or in the grade/rank work? It is a render change over logged fields,
  but the same fields feed `rank`, and touching them there is a different blast radius.
- Is Defect 5 in scope at all?

## EC1 — the measurement has now been run (2026-09-08, executor session)

**The failure is systematic.** Over `suggestions.jsonl` screen rows (band/churn/amplitude,
deduped to 759 item×days): **60.6%** of shipped buys sat above their own
`dipReality.typicalLevel` (64.0% among high-reach ≥½-of-days levels); the **median** premium was
**0.95× the entire expected net** (p75 2.08×, p90 4.69×), and in **27.8%** the premium exceeded
the whole expected net. The hilt's 2.7× is p75–p90 territory, not an outlier. Defect 4 is the
highest-value fix in this plan.

Archive backtest (369 band items × ~70d, 21,013 item-day cells, cue evaluated at 21:00 local on
full-day buckets): a `rising` floor label was live in 34.8% of cells; **44.1%** of those had the
forming day *already* printed under the last completed low. That contradiction is
decision-relevant in one specific sense: the next 3 completed days print **below the current
floor 88.5%** of the time when forming contradicts vs **53.1%** when it agrees — i.e. the signal
means "a cheaper entry than this floor is likely coming", NOT "the trend reverses" (forward
3-day floor *slope* is unpredicted either way: 47.3% vs 48.5%, base 45.7% — note the rising
label itself carries ~no 3-day-forward direction information). **Monotone certainty verified:
8,463/8,463 forming-under-last days completed under** (trivially true — a day's low only falls —
but measured anyway). The under-prior-trough (certain 13d-break-in-progress) case is rare: 1.9%
of rising cells.

**Defect 5 is RESOLVED as methodology, not data.** `read-window-range.mjs` bare defaults to
`--window 0-8` (`A.window ?? '0-8'`, line 89) — the "full-day" table in this plan was the
00:00–08:00 window (09-06's "full-day low" 30,739,055 is exactly the 07:00 bucket). Two
*overlapping* windows, no subset relation, no integrity bug. Verified live `/timeseries` matches
the archive bucket-for-bucket on the hilt, so there is no source divergence either.

**Hilt correction.** On true full-day buckets the entry-time cue was `healthy-trend, floor
rising +171,745/d, run falling ×1`, lastLow 29,357,404 (09-06 had already faded 700k intraday) —
NOT `rising ×5`, and the forming low (29,383,485) was 26k ABOVE the last completed low, so the
forming-contradiction triggers would not have fired for the hilt itself. The `+235,079/d /
rising ×5` relay remains untraced (consistent with a 0-8-window basis). The hilt's own save is
Defect 4: the buy line never showed the 6/7-day dip level sitting 525k below the paid price.

**Defect 2 correction (executor).** `windowStats` itself excludes the current day (`key ===
today` skip), so the "unguarded sites fold the partial day back in" claim above is behavioral
fiction — every production site fed today-stripped days and all sites already agreed. The real
defect was uniform: the forming day's data was silently DISCARDED everywhere, which is also
Defect 3's answer (`fc.forming` was structurally null in production, so the provisional clause
never rendered anywhere).

## Honesty (rule 4)

The systematic-ness measurement above replaces the drafted "not been run" caveat. Its limits:
Part B is archive-1h-based (verified identical to live for the hilt; not re-verified per item),
evaluates one fixed hour (21:00 local), and "reversal" was operationalized two ways with only
the level-undercut one showing signal — quote the 88.5%/53.1% split as "cheaper entry likely",
never as trend-reversal prediction.

Two hypotheses were tested and **rejected**; do not reintroduce them as explanation:
- **Post-update gear dump** (`update-cycle-timing`; this is `pathA.lane: "gear"`). The Wednesday
  update day was 09-02 and the price *rose* for four days after it. The 09-04→09-06 pump and
  09-07 fade sit nowhere near an update boundary.
- **A weekly cycle (weekend pump → Monday fade).** The hilt shows the shape twice, but it does
  not replicate: the Venator ring's *highest* weekday is Monday and the Nightmare staff's are
  Thu/Fri. n=2 per weekday. Not a finding.

No gate malfunctioned. Band's validator plan is `floor`(gate), `reach`(inform),
`trajectory`(inform), `dip-posture`(inform), `limit`(gate) (`js/flip-niches.mjs:280`); the floor
gate **passed** and dip-posture abstained (`no-dip`). The entry was admissible under the rules as
written. This plan is about what the surface said, not about a broken gate.
