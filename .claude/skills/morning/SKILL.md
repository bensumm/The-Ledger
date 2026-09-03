---
name: morning
version: 1.22
description: Morning-after review — reconstruct what filled overnight, re-verdict stale bids, book realized P/L. Triggers — "what happened overnight", "morning review", "what filled", "catch me up", "morning".
---

# /morning — the overnight counterpart

Reconstructs "what happened while I was away" from a specific set of sources and
re-verdicts stale bids. A judgment flow over several scripts — never a hand-parse of the
exchange log. Skills never bump `APP_VERSION`.

**Display contract — two paths, don't cross them.** For **`monitor-offers.mjs`** output (the live
resting-offers / fills view): paste the raw markdown table verbatim, unfenced (Ben, 2026-07-16) — relay
the script's own markdown table as PLAIN markdown, NOT wrapped in a fenced code block (a code fence forces
the client to show literal `|`/`-` characters instead of a real table — confirmed live, 2026-07-16). For
**`quote-items.mjs --positions`** (the re-verdict of held lots / new positions): follow the `/positions`
JSON-dump contract instead — run QUIET (no `--verbose`), read `pipeline/.cache/last-report/quote.json`, and
build the reply from its `table` section + your own prose; never paste raw `--positions` stdout. This
SUPERSEDES the earlier blanket "paste raw stdout for `--positions` too" — `/positions` owns that surface's
display rule (2026-07-17), so defer to it, don't duplicate it here (§3 already delegates to `/positions`
doctrine). The overnight-fill narrative supplements the table, it doesn't replace it.

**READ everything, RELAY what's actionable (winners-only, Ben 2026-09-02 — supersedes R10's
"relay both tiers by default", 2026-07-16).** The render layer labels every note family a TRACKING
tier — `core` (verdicts, alerts, the V5 held-note fields) and `context` (the inform-only families);
the tier registry lives in `pipeline/lib/render/render.mjs`'s header, the ONE registry, don't restate
tiers here. _judgment:_ **read both tiers so nothing decision-relevant is missed, but relay
actionable-first**: an item with something to act on overnight (a fill, a changed verdict, a stale bid
to reprice or cancel, a broken support) is written up fully; an item that did nothing and needs
nothing gets **ONE line**. Never `·`-join items onto a shared line, and every item line still carries
its `list @ X (BE Y)`. A context note that doesn't change a decision is read and not relayed — no
"what didn't happen and why" section.

## 0. Ensure the local desk is up (Ben, 2026-07-18)

Run `node pipeline/commands/ensure-server.mjs` first, every morning pass — it checks whether the
local dev server (`dev-server.mjs`, :8000) and the log-watcher daemon (`watch-log.mjs`, via its
`heartbeat.json` liveness signal) are already running, and starts `serve.cmd` (detached) if
either is down. This used to be a manual "did you run serve.cmd?" assumption; now the morning
routine checks instead of assuming. Report its one/two status lines, then continue to §1 — don't
wait around for a freshly-started server, the rest of the review doesn't depend on it (only Ben's
browser tab does).

## 1. What filled vs didn't — two sources, two jobs

**Sync first (SY1, Ben 2026-07-15).** Run `node pipeline/commands/sync-fills.mjs` at the top of the review
so `positions.json`/`fills.json` reflect everything the exchange log captured overnight — *then* read
them below. The DEFAULT is **local / zero-git** (rebuild only, no fetch/commit/push), so it's cheap; run
it unconditionally, never inferring freshness from how long you were away. **Phone-trade caveat:** the
local read doesn't ff-pull, so an un-pulled *phone* overnight trade folds in only at the next `/overnight`
`sync-fills.mjs --publish` (or a manual `git fetch`); a desktop-RuneLite overnight session is captured
locally. Publishing to the deployed app is the once-a-day `/overnight` job — `/morning` is a local read.

- **Booked numbers** ← `positions.json` (`closed` = after-tax realized P/L; `open` = new
  inventory) + new `fills.json` events — fresh as of the sync you just ran.
- **Live truth** ← `node pipeline/commands/monitor-offers.mjs` (reads the exchange log directly, ~0 lag):
  resting offers still open (didn't fill), recent fills/cancels. Use monitor for
  freshness, positions.json for booked numbers — never re-sum the log yourself.
  **Monitor now applies the MERCH-book quarantine by default (Ben, 2026-07-12):** its
  held/offers/fills views skip non-greenlisted ignored items (farming inputs, loot,
  personal-use consumables) — the SAME `ignored-items.json` filter positions.json/watch use.
  So do NOT report an ignored item as a phantom position or a "reconstruction bug" — that
  was the failure this fixes (the Snapdragon/Battlestaff false-bug reports, 2026-07-12).
  **Ben doesn't want to hear about quarantined items unless he asks** — the monitor footer
  names how many lines it hid; only run `node pipeline/commands/monitor-offers.mjs --all` if Ben explicitly
  asks to see them. Pricing help on an ignored item is still fine when Ben asks (the
  quarantine is a VIEW filter, not a gag — memory `pricing-ok-on-ignored-items`); this rule
  is just "don't surface them unprompted in the overnight reconstruction".

**Honest gap — narrowed, not closed (FD3/FD4, 2026-09-03).** WHEN each bid was placed IS now
recorded: `offers.json` carries `placedTs` and monitor/watch lines render `· resting 26h`; a
declared deep/long bid lives in `bid-thesis.json` (`declare-thesis.mjs bid` to declare, `list` to
read). What is still unrecorded is the PLAN behind an *undeclared* bid — reconstruct that from
the currently-open offers plus Ben's recollection; never fabricate what "was supposed to" fill.
(If PLAN.md chunk L1 action-logging lands, that log becomes the full memory source.)

## 2. Re-verdict stale unfilled bids

**Staleness has data behind it now (FD4, 2026-09-03 — this section used to run on pure judgment).**
Each open offer's resting age is on its monitor line (`offers.json` `placedTs`). The watch pass runs
an inform-only `⏳ stale bid` read on every UNDECLARED resting bid — standalone, on a held item
(accumulate-while-holding), or on a target — past a trigger: episode age ≥ `STALE_BID_HOURS` (a 24h
placeholder, n≈0) or its daily buy-dip window passed unfilled. **The flag is DEDUPED cross-pass and
fires on QUIET passes too** (an overnight `run-loop` watch pass consumes the first firing), so a
fresh `--verbose` watch here can legitimately print nothing for an already-flagged bid: the `⏳`
line lands in `pipeline/.cache/last-report/watch.json` `notes` ON THE PASS IT FIRED (quiet
included) and later deduped passes carry it nowhere — so read the current watch.json for any `⏳`
lines, and otherwise judge staleness directly off each offer's resting age plus the declaration
list (`declare-thesis.mjs list`). A bid declared deep/long (`declare-thesis.mjs bid "<item>"` →
`bid-thesis.json`, 14d TTL) is SILENT — don't nag it. _judgment:_ the flag frames reclaimable
capital, it never urges: patience-on-cancel stands and CANCEL is Ben's call; never pitch repricing
a bid up to chase a fill — name the window instead.

For each still-open offer: `node pipeline/commands/quote-items.mjs "<item>"` (or it's covered by
`--positions` if held) → fresh gate-tree verdict → recommend **keep / reprice / cancel**.
Never frame a sell-side reprice-down as "outrunning a drop" — it's controlled loss-taking
or it's realizing the band, and you say which (MONITORING.md's sell-side framing).

**A reprice level that prints a reality clause keeps it in the relay.** When a quoted diurnal level
comes back tagged `⚠ spike-top …` / `⚠ stale …` naming the typical level (rendered `~X` in the compact `short` style the console bits use, and spelled out as `typical ~X` in the `exit`/`full` styles — do NOT grep relayed output for the word "typical") (`js/windowread.mjs`
`realityClause` — the flag informs, it never moves the level), hand Ben the clause with the number or
reprice to the typical; a bare level is the one relay step that can undo the guard.

## 3. Review new positions

`node pipeline/commands/quote-items.mjs --positions` → verdict + price-to-clear for anything acquired
overnight. The incidental-inventory filter and verdict interpretation follow the shared
`/positions` doctrine (invoke it via the Skill tool rather than duplicating its rules).
If you read a `node pipeline/commands/watch-positions.mjs` pass here instead, each held lot's note block is the
fixed V5 EMIT CONTRACT — verdict → conviction → Δ → tripwire → **guaranteed
`sell: list @ X · break-even Y` line** → fill-progress (`MONITORING.md` "What each tick
surfaces"); the sell line is where you read every held item's list-at without re-deriving it.

## 4. Book the realized P/L narrative, then run `/scan`

Summarize `closed` trades since the last session (after-tax), what the overnight offers
achieved vs the plan Ben recalls, and what to redeploy freed capital into. Then **invoke `/scan`**
(via the Skill tool — the same composition pattern `/overnight` uses to invoke its children) to
cover the day's opportunities, so `/morning` ends with both an overnight reconstruction AND a
fresh opportunity read for the freed capital — not a dangling "you could run /scan" offer.

## 5. Weekly descriptive-outcomes read (once a week, not every morning)

**Cadence (W1, 2026-07-05; mechanized COD-3, 2026-07-10):** descriptive trade analysis starts
NOW and runs **weekly** — calibration (F1) stays gated. Run this section once per **Mon–Sun
week**. The "did it already run this week?" question is now a MECHANICAL check, not "ask Ben if
unsure": run `node pipeline/commands/join-outcomes.mjs --weekly-due` (a cheap standalone check — no rebuild).
It prints `weekly-due: yes` (run the section below) or `weekly-due: no` (skip it — a `--report`
this week already stamped `.cache/last-weekly-report`). Running this section's `join-outcomes.mjs --report`
re-stamps the marker, so the next `--weekly-due` reads `no` for the rest of the week. Every
other morning, this check reads `no` — skip straight past this section.

**What to run** — after the overnight review above is delivered (market work first, always):
1. `node pipeline/commands/join-outcomes.mjs --report` — fill-time distributions by band-percentile ×
   liquidity class with **n per cell**, the concentration line (top item's share of closed lots /
   realised P/L), and **THREE readiness gates** _(judgment: this is the dashboard, not a build trigger by itself)_:
   - **Gate A — F1-gate progress** (`X/5 cells at n≥30`): the general fill-rate CALIBRATION gate.
   - **Gate B — Reachability head-to-head** (RC, `PLAN-REACHABILITY-CONSOLIDATION`): **RETIRED as a gate
     — the scorer it waited on SHIPPED.** `join-reach-outcomes.mjs` (2026-08-27) scores the co-logged
     estimators forward against the 1h archive and needs no closed round-trip, so the accrual count that
     stood here gated nothing; run the command directly whenever the question comes up. Read it as a
     DESCRIPTION of reach and gap, never a ranking: both columns derive from one per-row comparison that is
     monotone in the ask price, so the reach ordering is a price-level ordering — and the two REPORTED
     columns are different functionals of it and can rank differently. "Which estimator wins" is not in
     evidence without the cost model `join-reach-basis.mjs` already carries. **No RC retire flag flips off this surface.**
   - **Gate C — Ring-3 rank-denoise** (forward-vs-recency exit, `PLAN-ESTIMATOR-HONEST-SELL`): the
     accrual that gates the display redesign's DEFERRED denoising lever — promoting the drift-adjusted
     FORWARD exit ("list at X") into `estimateRank`'s net/pFill so it reaches the graded board +
     `screen.json` for every flip-niche. Counts closed-sell round-trips whose read co-logged the forward exit
     (`estConfidence.forwardPeak`, E2), bucketed into the same (side × class × regime) cells. Its clock
     started at the E1–E4 land (2026-07-22), so it LAGS both A and B. **When a cell is `SCORABLE`, that
     is the cue to build+run `aggregateForwardExit`** (a retrojoin sibling — designed, not built) which
     scores per-cell median |forward−realized| vs |fold−realized|; Ring-3's promotion clears its evidence
     gate ONLY on a ROBUST cell where the forward exit BEATS the reach-fold, AND requires a
     rank-level knife guard (route `net` through `oscillationVsKnife.knife` → fall back to raw `netMargin`
     on a knife, since `estimateRank` has no knife gate today). Nothing promotes off a single week (rule 4).
2. A **realized-P/L attribution** read over `positions.json` `closed` lots (and
   `join-outcomes.mjs`'s realised sell campaigns): per-item realised net after tax, **win rate**
   (share of closed lots in profit), **hold-time distribution** (buy→sell), and
   **realized-vs-suggested capture** (booked net vs what the nearest-prior suggestion's
   band edges implied — the suggestion join `join-outcomes.mjs` already computes).

**Honesty rules (process rule 4 — descriptive ≠ calibration):**
- **Print n for every cut you report** _(enforced: `pipeline/commands/join-outcomes.mjs` `--report` suppresses cells under `MIN_N_REPORT`)_ and **refuse per-cell conclusions below the O1
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
