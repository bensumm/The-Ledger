# PLAN-ENTRY-PLACEMENT — should a pick's bid sit lower in the daily-low range?

Status: **DRAFT v2 (2026-11-25): Ben dropped the placement warning; EPL1 is information only.** Nothing built. Chunk prefix `EPL`.

**Decision it changes:** which bid `/scan` quotes, and whether a pick with a high bid is pitched at all.
**If the answer is "no effect":** EPL1's printed placement is deleted (it is provisional), EPL3 never opens, and one line
goes to the `docs/BACKLOG.md` do-not-rebuild list. EPL2's script moves to `pipeline/experiments/` either way.

## Context / diagnosis

Ben, 2026-11-24: "we bought in and then the price dropped under us -- shouldn't we be only buying items at
their typical lows?" Anchor incidents, all that day: the **Blood essence** bid at 69,367 and the **Dragon bolts
(unf)** bid at 2,470.

Confirmed in code:

- `verify-pick.mjs` has no rule on bid placement. The trio already computes it (`read-window-range.mjs`,
  `result.bid.placement`) and the rule set never reads it. Nothing objects to a bid that sits above most daily lows.
- The EC3 dip note (`js/estimators/cells.mjs`, "buy +P above (≥ the whole net)") prints only on the quote and
  screen cells. `verify-pick.mjs` does not carry it, so a PASS line can omit it. On the bolts it printed, and the
  pitch left it out.
- Screen bids come off the 2h band edge or the live print, not the 14-day daily-low distribution.

Not a cause, as far as measured: a market-wide drop. Of 573 liquid items, 273 were down and 300 up against a
day earlier (archive through 14:00 local).

## Evidence so far (scratch, post-hoc; NOT a result)

Two throwaway scripts over the 1h archive: one decision hour (13:00 local), instasell-side volume ≥20k/d, 315
items, 164 days; bid rests 24h, exit within 48h of the touch, else sold at the last instasell print. Deep bids
are the 25th percentile of the prior 14 daily lows. Outcomes clipped at ±10%.

- **After a fill, price prints another 0.5% lower within 6h in roughly two of three live-price fills**, and in
  about half or more of deep-bid fills. Being underwater just after a fill is the normal case.
- **Item above its typical low, bid deep:** best per fill in both exit specs.
- **Item already at the bottom quarter of its lows:** negative per fill in both specs. This is the same
  direction as `FLOOR-STRATEGY-FINDINGS.md` (an N-day low is not a trade) and is not a new claim.
- **Per setup** the deep-versus-live gap is small and spec-dependent: with a fixed +3.5% exit the day-cluster
  interval excludes zero over the full span and includes zero since October; with a 25th-percentile-of-highs exit
  it includes zero in both.

What this cannot say: touched is not filled; the universe was chosen by *recent* volume (survivorship); one
decision hour; two exit specs were tried and both are reported; adjacent days overlap (48h holds).

Logged-pick check (2026-11-25, scratch, adversarially reviewed): 3,670 band and churn picks, 33 days
(2026-08-11 to 10-19; earlier rows carry no `volDay`), margin under 10%. Net per pick by placement: 0–25% +0.06,
25–50 +0.16, 50–75 +0.15, 75–90 +0.26, 90+ +0.01; below every recent low +1.10 (n=76). No cutoff separates in the
pooled run. Within-day: p50 −0.20 [−0.46, 0.01], p75 −0.17 [−0.39, 0.02], p90 −0.24 [−0.40, −0.05], the p90 null in
the second half and uncorrected for three cutoffs. A weak p90 penalty at most. Post-09-30 is five days: no evidence.

Lookback is **not** a follow-up: a first run had 3-day levels beating 14-day ones, but it filled stale bids above the
market at the bid. With bids resting below the market the paired gap is about zero in all but the last of six periods.

## Prior art — do not rebuild

- `pipeline/experiments/FLOOR-STRATEGY-FINDINGS.md` (and the closed DL-0..3 line): "at an N-day low" is closed as
  a buy signal. **This plan does not reopen it.** The question is where to rest a bid relative to a normally
  trading item, not whether a low is a signal.
- `join-asym-outcomes.mjs`: the patient pair rarely completes. Any "bid deeper" change must be read against it.
- `fadingBidAboveTodaysLow` FAILs a deep bid under today's low when the cushion is fading. That rule and a
  lower default bid pull in opposite directions; EPL3 must resolve it, not stack on top.
- `placement()` in `js/windowread.mjs`: reuse. Its own header says no calibrated "safe" cutoff landed, so no
  cutoff is assumed here.

## Rulings

Open. Proposed defaults, flagged for veto:

1. **Placement is printed, never a WARN.** *Ruled by Ben 2026-11-25.*
2. **No cutoff.** p50 and p75 were measured (above) and neither is supported. *Ruled by Ben 2026-11-25.*
3. **The EC3 dip note is copied to the PASS line only when it reads "≥ the whole net".** *Default: yes.*
4. **No default bid change until EPL2 clears its bar.** *Default: yes.*
5. **Plan slot.** This makes five open plans, the ceiling. *Default: accept; PLAN-LEAN closes next.*

## Staged chunks

### EPL1 — say it on the line (small, shippable alone)

- `verify-pick.mjs`: compute `placement()` on the all-day lows inside `dayLeg` and print "bid above N% of daily lows"
  on every line. Not `result.bid.placement`: the trio runs with `--window peak`, so that number is against peak-hour lows.
- Carry the EC3 "premium ≥ whole net" fact to `verify-pick.mjs` from the same `dipRef` source, as a WARN.
  Refuse to recompute it: if the trio does not expose `dipRef`, expose it once.
- `/scan` §2 B warnings list gains one line each (bump `version:`).
- **Verification:** fixture tests, mutation-checked (the printed share is right at p79 and p36; the dip WARN fires at
  premium = net, silent below). `PASS` status unchanged on every existing fixture.
- `provisional.json`: id `bid-placement-note`, decide by 2027-01-31, passes only if EPL2 supports it.

### EPL1b — how far must it fall from here? (added 2026-11-25, Ben approved)

Placement alone misses this. Anchor: **White berries at 759**, pitched 2026-11-25 as "7/14 lows at or below" with
live at 805. From a 01:00 start a drop that large came within 8h on 4 of 178 nights and within 24h on 17 of 178
(scratch, one item, hourly averages). `verify-pick.mjs` passed it with only `bidPullingAway`.

- `verify-pick.mjs`: print the gap from live to the bid (%), and the share of past starts at this local hour from
  which the 1h low fell that far within the stated horizon (8h and 24h), with n. A WARN, never a status.
  Cutoff is a placeholder (proposed: under 20% at 24h), open to veto.
- The count is over the item's own hourly archive series via the shared `forward-reach.mjs` primitives
  (`js/forward-reach.mjs`), never a new reader. Too few starts prints "too thin", not a rate.
- Why it is not `bidNotTouched` or `bidPullingAway`: those score absolute levels against recent days or today's
  pace; neither asks how often a move of this size happens from the current price.
- Touched is not filled, so the share is an upper bound; say so on the line.
- **Verification:** fixture series with a known drop rate; the White berries pair warns; a bid 0.5% under live
  does not. `PASS` and status unchanged on every existing fixture.
- Same `provisional.json` entry as EPL1. EPL2 also reports the drop-from-live share beside each bid depth,
  so the two checks can be told apart.

### EPL2 — the registered test

A read-only `pipeline/commands/join-entry-placement.mjs` over the 1h archive. Written before it is run:

- **Primary:** paired per-setup net of a p25 bid minus a live-price bid, on items whose live print sits above the
  median of the prior 14 daily lows. Exit: the first 1h high at the 25th percentile of the prior 14 daily highs
  within 48h of the touch; else the last instasell in that window. After tax.
- **Win:** day-cluster bootstrap interval excludes zero AND the sign agrees at 24h and 96h exits AND in both
  halves of the span. Anything else prints "no detectable edge".
- **Secondary (Holm):** p10, p50, p90, below every prior low; the bottom-quarter cohort; the item class split; volume ≥3k/d versus ≥20k/d;
  decision hours 01, 07, 13, 19 local.
- **Below-guide caution (secondary, Ben approved 2026-11-25; in the Holm family):** items over 1m trading more than 1%
  under the guide, versus the same items within 1%: market-adjusted 24h return, non-overlapping origins, day-cluster
  interval, from 2026-09-30 with and without 10-17 to 10-31. Scratch, unreviewed: about -0.35% outside that span, with
  or without a guide update. Guide history is Weird Gloop's per-item 90-day series (save it before the span rolls off).
  Win: the interval excludes zero in both halves; then a WARN is proposed, never a gate. Null: one BACKLOG line.
- **Honest panel:** universe fixed by volume in the *first* 14 days of each 30-day block, not the last 14 days.
  Unfilled setups count as zero. Non-overlapping 72h origins for the interval, all origins for sensitivity.
- **Null branch, stated now:** no detectable edge → EPL3 does not open, EPL1's placement line is deleted, BACKLOG gets one line.
- **Verification:** fixtures for fill, no-fill, reach, bail and tax; one hand-checked item-day.
- A separate adversarial reviewer runs on the result before any number is quoted.

### EPL3 — change the quoted bid (only if EPL2 wins)

- One bid convention for patient picks, derived in one place, used by the screen and the quote.
- Resolve the conflict with `fadingBidAboveTodaysLow` explicitly (a deep bid under today's low on a fading
  cushion). Ship as a shown comparison first: today's bid beside the deep bid, with both fill rates.
- Verification is written when EPL2's shape is known.

## Encoding boundary

Encode: placement and the dip premium on the PASS line. Stays judgment: how many small bids to run, sizing, and
whether to skip a warned pick. Retire: nothing until EPL3.

## Bookkeeping

Per chunk: README entry for the new command (EPL2), `@ask` tag, SKILL `version:` bump (EPL1), no `APP_VERSION`
(pipeline and skills only), `lint-budget.mjs --bless` only after trimming.

## Honesty

p50 and p25 are placeholders. n=5 flips on one afternoon prompted this and is no evidence about the rate. The
scratch numbers above were tried two ways and are a reason to register a test, nothing more.

## Verification of the whole

EPL1 changes no PASS or FAIL. EPL2 produces one verdict line or the null. Ben decides EPL3 from that line.
