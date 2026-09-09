# PLAN-AVGHIGH-BIAS — does the archive's avgHighPrice understate achievable sells?

**Status:** OPEN (pre-registered 2026-09-09). Owner-directed (handoff 2026-09-08: "the
highest-value thread, unmeasured"). Inform-only; gates nothing.

## Origin

PLAN-WEEKDAY-PHASE-CONFOUND §4's data-quality note, logged before this registration:
the 2026-09-05 Armadyl crossbow lot sold at **37,990,000** inside an hour whose recorded
`avgHighPrice` is **36,665,998** with `highPriceVolume 3` — one print at 37.99m plus two
near 36.0m averages to exactly that. The realized sell beat the archive's daily maximum
by 3.6%. That note ends "do not act on it beyond this note until measured." This plan is
the measurement.

## What is at stake

The 1h archive stores `avgHighPrice` — the hourly AVERAGE of instant-buy prints, not the
max. Every surface that treats it as "the level the market paid" inherits an average-vs-max
gap: the `askSide` quantiles / reach counts / placement in `js/windowread.mjs`, the reach
estimators (`js/estimators/reach.mjs`, `js/forward-reach.mjs`, `js/reach-surface.mjs`),
`js/quotecore.js` band reads, `js/trendcore.js`, `js/amplitudescreen.mjs`, `js/trends.js`.
If the gap is material and volume-dependent, reach counts ("35.30m reached 13/14 days")
are conservative on thin books and asks are being set below what the market pays. The
ceiling on any ship from this plan is an **inform-only annotation**; no estimator,
quantile, or default changes without a fresh registration.

## Mechanics, stated before measuring

An average is ≤ the max by construction, so a realized sell above the same-hour
`avgHighPrice` is EXPECTED whenever the hour holds more than one print and ours was not
the cheapest — that alone is not bias. The decision-relevant statistic is the one the tool
actually uses: reach counting compares an ask against each day's MAX hourly `avgHighPrice`.
A realized sell above that day-max is a print the archive says was unreachable. Rate and
size of those, by book thinness, is the question.

## The registered test

**Instrument:** `pipeline/experiments/avghigh-bias-study.mjs`, committed before its first
run. Read-only against `positions.json` `closed[]` (non-banked rows with a real `sellTs`)
joined to `pipeline/.market-archive.sqlite` `observations` at grain `1h` via
`archive.open(..., {readonly:true})` / `seriesFor`. Primary join: the hour bucket
containing `sellTs` (`floor(sellTs/3600)*3600`). Sensitivity join (reported, decides
nothing): best of {containing, previous} hour — the exchange logger stamps completion/
collection, which can trail the prints.

- **(a) Instrument validity, first and gating.** Rows with `qty == 1` joined to an hour
  with `highPriceVolume == 1`: our unit is then the hour's only high-side print, so
  `sellEach` should equal `avgHighPrice` (within 0.1%). Match rate < 70% on n ≥ 10 such
  rows → the join or the high-side assumption is broken → branch (C); also report the
  match rate against `avgLowPrice` (if THAT matches instead, filled asks print low-side
  and the whole premise inverts — report, do not improvise).
- **(b) Same-hour exceedance (descriptive).** Fraction of joined sells with
  `sellEach > avgHighPrice` and the median exceedance %, split by `highPriceVolume` tier
  (1–3, 4–10, 11–30, >30) and by `classifyItem` class. Expected nonzero by mechanics;
  the reportable shape is the tier gradient.
- **(c) Day-max exceedance (decides the branch).** For each joined sell: the max hourly
  `avgHighPrice` over the sell's LOCAL day (local date string, the WK2 discipline).
  Statistic: rate of sells exceeding that day-max by ≥ 1%, and the median exceedance
  among them, per hpv tier and era.
- **Era split on everything:** last 30 days vs earlier (the record is non-stationary;
  pooling reversed a conclusion once — §7a-CORRECTED).
- **Inference discipline:** per-item first for items with ≥ 5 joined sells, then across
  items; pooled rows are reported as descriptives only (the record is dominated by a few
  high-frequency items). Small n's stated per cell; no cell with n < 10 may be quoted.

**Branches, committed now:**
- **(A) Material:** in any hpv tier with ≥ 20 joined sells (either era), ≥ 15% of sells
  beat the day-max by ≥ 1% → ship an inform-only thin-book annotation on reach reads
  (surface + wording in a follow-on chunk after review; the measured number renders, the
  reach count itself does not change).
- **(B) Not material:** no tier clears the bar → record the numbers here and in the WPC
  §4 note, close; reach reads stay as-is and the 37.99m case stands as a tail anecdote.
- **(C) Instrument fails (a):** record the failure mode and the match-rate table; no
  claim in either direction; any retry needs a better join, not a looser bar.

## Limits, stated now

One book (~470 non-banked closed lots), and OUR fills only: asks were priced off the same
archive series (circularity) and a fill conditions on a buyer paying — so this measures
the archive as an instrument for THIS book's realized prices, not a market property.
Timestamp quality bounds the join (phone trades are logged late; (a) and the sensitivity
join bound the damage). One era split. Inform-only; nothing gates, sizes, or auto-prices.

## RESULTS (run 2026-09-09 — branch (B): NOT material)

442 non-banked sells, 441 joined (1 missing hour bucket, 0 missing series). Instrument:
`pipeline/experiments/avghigh-bias-study.mjs` @ c507cae, committed before this run.
Deterministic offline join — reproduce with a bare rerun.

- **(a) came back UNPOWERED, not failed: n=0.** No qty==1 sell in the record landed in an
  hpv==1 hour — this book sells into liquid hours. Branch (C)'s bar (match <70% on n≥10)
  cannot fire on n=0. Validity rests instead on three substitutes, each run: the 441/442
  join hit rate; a timestamp audit (of 442 sells: ONE exact-local-midnight date-only
  stamp, 3 on-the-hour, 11 on-the-minute — hour-grain joins are trustworthy for ~99% of
  rows); and a spot-check that reproduces the founding §Origin case's day-level numbers
  exactly (Sep-5 local-day max `avgHighPrice` 36,665,998; sell 37,990,000; +3.61%). The
  branch decider (c) is DAY-grain, so it is immune to the hour-level join error (a) would
  have tested; only date errors matter, and the audit bounds those at 1 row in 442.
- **(b) descriptive, consistent with mechanics:** ~82% of sells pooled (tier cells range
  60–100%) print above the same-hour `avgHighPrice`, median magnitude ~0.5–1.5%, mildly
  higher in rune/potion/unclassified classes. An ask fill sits at the top of the hour's print distribution while the average
  includes the cheaper prints — this is NOT bias evidence and must not be quoted as such.
- **(c) — the branch decider — day-max beats ≥1% are RARE:** recent-30d era 1/51 (2.0%);
  earlier era ~4% of 390. No hpv tier with n ≥ 20 reaches the registered 15% bar in either
  era. Per-item (≥5 joined sells, 25 items): mean beat rate 6.7%, 6 items ever beat.
- **The founding anecdote, resolved:** the 37.99m crossbow IS the recent era's single
  day-max beat — and is ALSO the record's only date-only (midnight-stamped) sell, so WPC
  §4's "inside an hour whose recorded high is 36,665,998 / hpv 3" was a plausible
  arithmetic reconstruction (the 06:00 hour), not a logged fact; its DAY-level beat
  stands. It is a real ~2–4%-of-sells tail event, not a systematic bias.
- **Volume-dilution artifact (corrected in review — the first-run explanation said "tick
  size" and was FALSE):** Coal beat its day-max on 5/5 sells at +2.65% (sellEach 155 vs
  day-max 151) in hours with hpv ~500k. At that volume the hourly AVERAGE sits far below
  the top prints, so the (c) bar is cheap to beat on bulk commodities — a dilution
  artifact of the average-price basis, not a thin-book signal. Those 5 rows are inside
  the earlier-era figure.

**Branch (B) ships nothing:** reach counting against the day's max `avgHighPrice` is not
systematically conservative for this book; the reach reads stay as-is. Asymmetry to keep
in mind when re-reading this: (c) only observes OUR asks — a sell that fails to beat the
day-max proves nothing about prints the archive missed elsewhere, so (B) means "no
evidence of a frequent effect in this book's fills", not "avgHighPrice is a faithful
max". One era, one book; inform-only; gates nothing.
