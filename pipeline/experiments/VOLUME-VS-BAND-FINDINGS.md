# Volume vs band width — findings (2026-08-04)

**Question (Ben):** is there a correlation between trade volume and % deviation from the
guide/median — i.e. does **high volume = thin band**?

**Answer: yes, strongly — but ONLY across items. Within a single item, day to day, the sign
flips.** Those are two different questions with two different answers, and the distinction is
the whole practical content of this study.

Script: `pipeline/experiments/volume-vs-band-study.mjs` (read-only against the `/1h` SQLite
archive; `--json` for machine output).

## Method

1,894 items × 123,093 item-days, 2026-05-29 → 2026-08-04, `/1h` grain. Item needs ≥40 days of
coverage; a day needs ≥12 hours of prints. Three dispersion measures per item-day:

| measure | definition | what it is |
| --- | --- | --- |
| `spreadPct` | median over the day of `(avgHighPrice − avgLowPrice) / mid` | the instantaneous bid-ask — what a CHURN lap captures |
| `bandPct` | `(day max high − day min low) / day mid` | the intraday range — what a patient BAND flip works over |
| `madPct` | mean `\|hourMid − dayMedianMid\| / dayMedianMid` | dispersion around the day's own median |

All correlations are **Spearman** (rank). Pearson on raw volume would be driven entirely by a
handful of rune/essence outliers.

## The confound, and why controlling for it *strengthens* the result

Price level contaminates this question badly:

- ρ(volume, price) = **−0.561** — cheap items trade in bulk
- ρ(price, bandPct) = **−0.506** — cheap items carry wide % bands (a 1gp tick on a 14gp item is 7.1%)

Those two combine to push ρ(volume, band) **positive**, i.e. *against* the hypothesis. The
pooled number is negative anyway, so the true within-price effect must be stronger than the
pooled figure. It is.

## 1. Pooled cross-item (confounded — do not quote this one)

| measure | ρ(volume, measure) |
| --- | ---: |
| spreadPct | **−0.436** |
| bandPct | −0.254 |
| madPct | −0.203 |

## 2. Within price decile (confound controlled — the headline)

| decile | price range | n | med vol/d | ρ(vol,spread) | ρ(vol,band) | med spread | med band |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2–38 | 189 | 80,534 | −0.329 | −0.507 | 5.13% | 49.18% |
| 2 | 39–125 | 189 | 20,413 | −0.549 | −0.708 | 4.34% | 27.14% |
| 3 | 125–330 | 189 | 23,813 | −0.675 | −0.811 | 4.50% | 27.75% |
| 4 | 332–887 | 189 | 17,972 | −0.709 | −0.871 | 3.72% | 23.46% |
| 5 | 891–1,920 | 189 | 11,449 | −0.758 | −0.852 | 3.67% | 17.71% |
| 6 | 1,921–4,229 | 189 | 19,458 | −0.813 | **−0.905** | 3.33% | 13.79% |
| 7 | 4,250–16,433 | 189 | 11,306 | **−0.869** | −0.868 | 2.99% | 9.99% |
| 8 | 16,629–81,743 | 189 | 1,063 | −0.791 | −0.765 | 4.59% | 15.14% |
| 9 | 84,444–1,413,374 | 189 | 391 | −0.620 | −0.572 | 4.07% | 12.87% |
| 10 | 1.44m–1.49b | 193 | 432 | −0.272 | −0.368 | 2.04% | 5.34% |

ρ around **−0.85 to −0.9** in deciles 4–7 is about as strong as anything in this dataset. Among
items of comparable price, **volume very nearly determines band width.**

The relationship **weakens sharply at the extremes** — decile 1 (tick-granularity noise floor)
and decile 10 (big tickets, where everything is thin-volume and already tight in % terms).

## 3. Effect size — volume quintiles within a price decile

**Price decile 5 (891–1,920 gp)** — the clearest case:

| vol quintile | n | med vol/d | med spread | med band |
| ---: | ---: | ---: | ---: | ---: |
| Q1 | 37 | 216 | 15.57% | **85.73%** |
| Q2 | 37 | 1,982 | 5.77% | 26.76% |
| Q3 | 37 | 9,557 | 5.54% | 23.95% |
| Q4 | 37 | 72,347 | 2.44% | 11.04% |
| Q5 | 41 | 449,574 | 1.65% | **7.09%** |

A **12× band-width difference** across the volume range at the same price.

**Price decile 10 (1.44m+)** — the relationship largely dissolves:

| vol quintile | n | med vol/d | med spread | med band |
| ---: | ---: | ---: | ---: | ---: |
| Q1 | 38 | 142 | 2.48% | 6.75% |
| Q2 | 38 | 280 | 2.24% | 6.18% |
| Q3 | 38 | 427 | 1.96% | 5.32% |
| Q4 | 38 | 664 | 2.05% | 5.46% |
| Q5 | 41 | 1,434 | 1.82% | 4.40% |

Only ~1.5× top to bottom. Big tickets are uniformly low-volume *and* uniformly tight in
percentage terms.

## 4. The sign reversal — within a single item, day to day

| measure | items | median ρ | IQR | % of items negative |
| --- | ---: | ---: | --- | ---: |
| spreadPct | 1,883 | +0.075 | −0.068..+0.219 | 36% |
| bandPct | 1,894 | **+0.153** | +0.017..+0.288 | 23% |
| madPct | 1,894 | +0.130 | −0.002..+0.257 | 25% |

**Positive.** For a given item, its *busy* days are its *wide* days — 77% of items show a
positive volume↔band relationship day to day. Volume spikes accompany price moves; they don't
tighten the book.

This is weak (median +0.15, IQR straddles zero for `spreadPct`) — a tendency, not a law.

## What it means

- **Across items, liquidity is efficiency.** A heavily traded item has many participants
  competing on both sides, so its price stays near consensus and its band is thin. This is
  textbook microstructure and the data reproduces it very cleanly.
- **So you are paid for illiquidity, not liquidity** — the 85.73% bands live in the Q1-volume
  items. Which is exactly where you can't size, can't exit, and where a wide "band" is often a
  ghost-spread artifact of a handful of prints. The screen's two-sided liquidity gate
  (3,500/d) and 500k gp/d attention floor **deliberately trade away the widest bands** for
  bands you can actually transact. That's the right trade, and this study is the reason it's
  the right trade — not a limitation to relax.
- **The thin margins on churn lanes are structural, not a pricing failure.** Sub-1% churn laps
  are what a decile-6/7 Q5-volume item *is*. No amount of better entry timing changes that.
- **The mid-volume band is where sized edge lives.** Decile 5 Q3–Q4 (9.5k–72k units/day) still
  carries 11–24% bands at volumes that support real tranches. That is roughly where our
  actual winners sit.
- **Section 4 is the timing corollary:** trade an item on its high-volume days. Weakly
  supported here, but it matches the Spider cave episode — the lane paid on the days its range
  was wide, and died when the range collapsed 79% in two days.

## Limits (rule-4 honesty)

- **One 68-day archive window**, no out-of-sample split. Descriptive of Jun–Aug 2026.
- Decile-1 Q5 shows `med spread 0.00%` — a tick-granularity artifact (high == low most hours on
  2–38gp items), not a real zero spread. Treat decile 1 as unreliable throughout.
- `bandPct` on a thin item is inflated by sparse prints: fewer observations means the observed
  max/min are noisier estimates of the true range. Some of the Q1 "85% band" is measurement,
  not opportunity — which reinforces the practical conclusion rather than weakening it.
- Correlation only. Nothing here is a causal claim, and nothing here was tested against
  realized fills.

## README inventory lines (paste into "Map of the repo")

```
- `pipeline/experiments/volume-vs-band-study.mjs` — one-shot research study (2026-08-04): does trade volume predict % band width / deviation from median? Reads the /1h SQLite archive read-only; pooled + within-price-decile + within-item Spearman correlations, `--json` for machine output. Result: strong NEGATIVE across items (ρ≈−0.85 within price decile), weak POSITIVE within an item day-to-day.
- `pipeline/experiments/VOLUME-VS-BAND-FINDINGS.md` — the written findings report for volume-vs-band-study.mjs: method, tables, the price-level confound, and why the liquidity gates deliberately trade away the widest bands.
```
