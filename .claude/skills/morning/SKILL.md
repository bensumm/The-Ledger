---
name: morning
version: 1.0
description: Morning-after review — reconstruct what filled overnight, re-verdict stale bids, book realized P/L. Triggers — "what happened overnight", "morning review", "what filled", "catch me up", "morning".
---

# /morning — the overnight counterpart

Reconstructs "what happened while I was away" from a specific set of sources and
re-verdicts stale bids. A judgment flow over several scripts — never a hand-parse of the
exchange log. Skills never bump `APP_VERSION`.

## 1. What filled vs didn't — two sources, two jobs

- **Booked numbers** ← `positions.json` (`closed` = after-tax realized P/L; `open` = new
  inventory) + new `fills.json` events. These sync every ~20 min (Task Scheduler
  `CofferFillsSync`) — note the ≤20-min lag if the file is fresh-stale.
- **Live truth** ← `node pipeline/monitor.mjs` (reads the exchange log directly, ~0 lag):
  resting offers still open (didn't fill), recent fills/cancels. Use monitor for
  freshness, positions.json for booked numbers — never re-sum the log yourself.

**Honest gap — no fabricated intent.** Skills are stateless: there is no record of what
bids were placed last night. Reconstruct intent from the currently-open offers plus Ben's
recollection; never fabricate what "was supposed to" fill. (If PLAN.md chunk L1
action-logging lands, that log becomes the memory source — a future input, not available
yet.)

## 2. Re-verdict stale unfilled bids

For each still-open offer: `node pipeline/quote.mjs "<item>"` (or it's covered by
`--positions` if held) → fresh gate-tree verdict → recommend **keep / reprice / cancel**.
Never frame a sell-side reprice-down as "outrunning a drop" — it's controlled loss-taking
or it's realizing the band, and you say which (MONITORING.md's sell-side framing).

## 3. Review new positions

`node pipeline/quote.mjs --positions` → verdict + price-to-clear for anything acquired
overnight. The incidental-inventory filter and verdict interpretation follow the shared
`/positions` doctrine (invoke it via the Skill tool rather than duplicating its rules).

## 4. Book the realized P/L narrative

Summarize `closed` trades since the last session (after-tax), what the overnight offers
achieved vs the plan Ben recalls, and what to redeploy freed capital into — **offer
`/scan`** for the redeploy.
