---
name: morning
version: 1.2
description: Morning-after review — reconstruct what filled overnight, re-verdict stale bids, book realized P/L. Triggers — "what happened overnight", "morning review", "what filled", "catch me up", "morning".
---

# /morning — the overnight counterpart

Reconstructs "what happened while I was away" from a specific set of sources and
re-verdicts stale bids. A judgment flow over several scripts — never a hand-parse of the
exchange log. Skills never bump `APP_VERSION`.

## 1. What filled vs didn't — two sources, two jobs

**Sync first.** There is no scheduled sync (the 20-min `CofferFillsSync` job was eliminated
2026-07-04 — on-demand only). Run `node pipeline/sync-fills.mjs` at the top of the review so
`positions.json`/`fills.json` reflect everything the exchange log captured overnight, *then*
read them below.

- **Booked numbers** ← `positions.json` (`closed` = after-tax realized P/L; `open` = new
  inventory) + new `fills.json` events — fresh as of the sync you just ran.
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

## 5. Encode learnings (self-improvement — after the review, never during)

The morning reconstruction can teach what the overnight plan got wrong (a bid that should
have been repriced, a staleness call that missed). Capture it — but the re-verdicts and any
reprice/cancel actions come first, always.

- **Timing:** only AFTER the review is delivered and Ben has repriced/cancelled the stale
  offers (or says he's done). Never interleave doc edits with the market work — offers
  first, encoding after (Ben's explicit rule).
- **Prompt:** at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (an overnight call that
  worked/failed, a re-verdict that read wrong, a reconstruction gap).
- **Routing — one canonical home per fact, move never copy:** an overnight-posture lesson →
  the `/overnight` SKILL.md; a positions judgment lesson → `/positions`; morning-flow
  doctrine → this SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user
  preferences → Claude memory; monitoring doctrine → `pipeline/MONITORING.md`.
- **Execution:** spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** process learnings encode freely; a *market* claim (a
  fill-rate, a nightly pattern) needs the usual evidence standard — one night is one sample.

## 4. Book the realized P/L narrative

Summarize `closed` trades since the last session (after-tax), what the overnight offers
achieved vs the plan Ben recalls, and what to redeploy freed capital into — **offer
`/scan`** for the redeploy.
