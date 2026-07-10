---
name: morning
version: 1.8
description: Morning-after review — reconstruct what filled overnight, re-verdict stale bids, book realized P/L. Triggers — "what happened overnight", "morning review", "what filled", "catch me up", "morning".
---

# /morning — the overnight counterpart

Reconstructs "what happened while I was away" from a specific set of sources and
re-verdicts stale bids. A judgment flow over several scripts — never a hand-parse of the
exchange log. Skills never bump `APP_VERSION`.

## 1. What filled vs didn't — two sources, two jobs

**Sync first (SY1).** There is no scheduled sync (the 20-min `CofferFillsSync` job was
eliminated 2026-07-04 — on-demand only). Run `node pipeline/sync-fills.mjs` at the top of
the review so `positions.json`/`fills.json` reflect everything the exchange log captured
overnight — *and* any phone-logged trades, since the sync ff-pulls `origin/main`
(`mobile-fills.log` writes) before reading logs (the multi-writer contract, FILLS-PIPELINE
§13.3) — *then* read them below.

**Run the sync from the MAIN checkout only (SY1.2):** `sync-fills.mjs` commits+pushes
`fills.json`/`positions.json` to `main` under the admin bypass — run it from
`C:\dev\The-Ledger`, **never a git worktree** (that's a feature branch; the artifacts would
land on the wrong ref). If you're in a worktree and can't reach the main checkout, SKIP the
sync and say the overnight numbers may be stale rather than pushing from the wrong branch.

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
If you read a `node pipeline/watch.mjs` pass here instead, each held lot's note block is the
fixed V5 EMIT CONTRACT — verdict → conviction → Δ → tripwire → **guaranteed
`sell: list @ X · break-even Y` line** → fill-progress (`MONITORING.md` "What each tick
surfaces"); the sell line is where you read every held item's list-at without re-deriving it.

## 4. Book the realized P/L narrative

Summarize `closed` trades since the last session (after-tax), what the overnight offers
achieved vs the plan Ben recalls, and what to redeploy freed capital into — **offer
`/scan`** for the redeploy.

## 5. Weekly descriptive-outcomes read (once a week, not every morning)

**Cadence (W1, 2026-07-05; mechanized COD-3, 2026-07-10):** descriptive trade analysis starts
NOW and runs **weekly** — calibration (F1) stays gated. Run this section once per **Mon–Sun
week**. The "did it already run this week?" question is now a MECHANICAL check, not "ask Ben if
unsure": run `node pipeline/outcomes.mjs --weekly-due` (a cheap standalone check — no rebuild).
It prints `weekly-due: yes` (run the section below) or `weekly-due: no` (skip it — a `--report`
this week already stamped `.cache/last-weekly-report`). Running this section's `outcomes.mjs --report`
re-stamps the marker, so the next `--weekly-due` reads `no` for the rest of the week. Every
other morning, this check reads `no` — skip straight past this section.

**What to run** — after the overnight review above is delivered (market work first, always):
1. `node pipeline/outcomes.mjs --report` — fill-time distributions by band-percentile ×
   liquidity class with **n per cell**, plus the F1-gate progress line and the
   concentration line (top item's share of closed lots / realised P/L).
2. A **realized-P/L attribution** read over `positions.json` `closed` lots (and
   `outcomes.mjs`'s realised sell campaigns): per-item realised net after tax, **win rate**
   (share of closed lots in profit), **hold-time distribution** (buy→sell), and
   **realized-vs-suggested capture** (booked net vs what the nearest-prior suggestion's
   band edges implied — the suggestion join `outcomes.mjs` already computes).

**Honesty rules (process rule 4 — descriptive ≠ calibration):**
- **Print n for every cut you report** _(enforced: `pipeline/outcomes.mjs` `--report` suppresses cells under `MIN_N_REPORT`)_ and **refuse per-cell conclusions below the O1
  thresholds** (`--report` already suppresses cells under `MIN_N_REPORT`; F1's calibration
  gate is n≥30 per side×percentile×class×regime cell, ≥5 such cells — surfaced by the
  F1-gate progress line). This is a *description of what happened*, never a fill-rate model.
- **Respect the concentration caveat.** _(judgment: honesty)_ When one item is >40% of closed lots (the caveat the
  report prints), per-item reads are mostly ONE sample — present them as anecdote, not a
  rate. Do not extrapolate a per-item win rate or hold time off a handful of lots.
- **One week is one sample too.** _(judgment: honesty)_ Week-over-week deltas are narrative colour until the
  calendar accrues; never present a weekly swing as a trend.

Deliverable: a short honest "here's what the record shows so far, and here's how far we are
from calibration-grade (F1-gate progress)" — not a recommendation to change the algorithm.
F1 opens only when its documented thresholds clear (weeks away at ~20 lots/day); this read
just makes that distance visible every week.

## 6. Encode learnings (self-improvement — after the review, never during)

The morning reconstruction can teach what the overnight plan got wrong (a bid that should
have been repriced, a staleness call that missed). Capture it — but the re-verdicts and any
reprice/cancel actions come first, always.

- **Timing:** _(judgment: process)_ only AFTER the review is delivered and Ben has repriced/cancelled the stale
  offers (or says he's done). Never interleave doc edits with the market work — offers
  first, encoding after (Ben's explicit rule).
- **Prompt:** _(judgment: process)_ at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (an overnight call that
  worked/failed, a re-verdict that read wrong, a reconstruction gap).
- **Routing — one canonical home per fact, move never copy:** _(judgment: process)_ an overnight-posture lesson →
  the `/overnight` SKILL.md; a positions judgment lesson → `/positions`; morning-flow
  doctrine → this SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user
  preferences → Claude memory; monitoring doctrine → `pipeline/MONITORING.md`.
- **Execution:** _(judgment: process)_ spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** _(judgment: process)_ process learnings encode freely; a *market* claim (a
  fill-rate, a nightly pattern) needs the usual evidence standard — one night is one sample.
