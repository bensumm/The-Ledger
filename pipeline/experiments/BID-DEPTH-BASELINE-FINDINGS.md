# Bid-depth baseline — the live −5% experiment, captured 2026-08-09

Companion data: `bid-depth-baseline-20260809.json`. Feeds `plans/PLAN-BID-DEPTH-5PCT.md`.

## Why this file exists

Ben left 8 buy offers resting overnight to test whether a bid more than 5% under guide simply
does not fill (the queue-wall hypothesis). **That experiment was unmeasurable after the fact**,
because nothing in the pipeline persists the guide price at time T:

- the market archive schema (`pipeline/lib/market/archive.mjs`) stores avgHigh/avgLow/volumes and
  a daily `mid` — **no guide column**;
- `pipeline/.cache/guide.json` is a *current* snapshot on a 10-minute TTL, overwritten in place;
- `pipeline/.guide-history.jsonl` holds 97 rows over 34 days, of which only **26 are real
  re-anchor events** across 17 items — exactly **one** item clears `GUIDE_MIN_UPDATES = 3`;
- `suggestions.jsonl` carries **0 of 13,401** rows with a `guide` field.

So this snapshot was taken by hand. It is the control record for tomorrow's fill/no-fill read.

## The baseline

Captured 2026-08-09 10:32 UTC. All live prints were 4–13 min old (inside `QUICK_FRESH_MIN` ~15m),
so no stale-print caveat applies. Guide is the GE guide price (`loadGuide()` ← chisel `os_dump.json`)
— the same anchor the in-game −5% button computes off, verified at `js/quotecore.js:337`.

| Item | Bid | Guide | % under guide | Live instasell | % under live | Guide vs live |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Looting bag note | 40,450 | 46,603 | **−13.20%** | 46,241 | −12.52% | −0.78% |
| Chasm teleport scroll | 32,551 | 35,625 | **−8.63%** | 34,200 | −4.82% | −4.00% |
| Saturated heart | 72,540,000 | 78,539,935 | **−7.64%** | 74,914,433 | −3.17% | −4.62% |
| Teak logs | 110 | 119 | **−7.56%** | 113 | −2.66% | −5.04% |
| Torstol seed | 14,755 | 15,956 | **−7.53%** | 15,501 | −4.81% | −2.85% |
| Bastion potion(4) | 14,350 | 15,162 | **−5.36%** | 14,776 | −2.88% | −2.55% |
| Dragon javelin tips | 720 | 734 | −1.91% | 721 | −0.14% | −1.77% |
| Irit leaf | 1,577 | 1,565 | **+0.77%** | 1,605 | −1.75% | **+2.56%** |

## The finding — "−5% of WHICH number" is not a quibble, it is decisive

The last column is the point. **Guide diverges from the live print on every item, by −5.04% to
+2.56% — a 7.6-point spread.** That is *larger than the entire effect being hunted*.

The consequence is a straight reversal of the read:

- measured against **guide**: 6 of 8 bids sit past −5%;
- measured against **live instasell**: only **one** does (Looting bag note).

Six of these offers are "deep" in guide terms and "ordinary" in market terms. So a night of no
fills would be evidence for the queue-wall hypothesis *only* if the wall forms at −5% of guide.
If depth-in-real-terms is what governs fills, these bids are mostly 2–5% under market and should
fill on normal movement. **The two readings make opposite predictions from the same 8 offers**,
which is what makes this a usable experiment rather than a wash.

Guide lags in **both** directions — it is not a simple upward bias. Irit leaf's guide (1,565) sits
*below* live (1,605): guide has not caught a rise, so a bid above guide is still under market.
Teak logs is the opposite extreme, guide 5.04% above live. Any analysis that substitutes the wiki
mid or an archive mid for guide will therefore smear a genuine step at −5% into a gradient and
produce a confident false refutation.

## Status

INFORM-ONLY, n=8 offers, one night, one desk. This is a lean, not a law — it establishes that the
measurement question is real and that the two anchors disagree materially. It does **not** yet say
anything about whether the wall exists.

## What to check tomorrow

Which of the 8 filled. Then read the fill set against **both** columns. The discriminating pattern:
fills clustering above −5%-of-guide regardless of live depth supports the wall; fills tracking
%-under-live and ignoring the guide boundary refutes it.
