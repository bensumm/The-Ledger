---
name: schedule
version: 1.0.0
description: Consolidated buy/sell WINDOW AGENDA — a time-sorted "what to buy/sell and when" across current positions (default) or the watchlist, plus a flipped-but-not-watchlisted audit. Triggers — "what's my agenda", "what should I buy/sell and when", "when's the next window", "what's coming up", "schedule".
---

# /schedule — the buy/sell window agenda

Skills-versioning note: this file's `version` bumps on material behavior change; skills
NEVER bump `APP_VERSION` (that marks the deployed app, which skills never touch). This
skill is pipeline-only — `read-schedule.mjs` touches no `js/` file.

## What it does
Every tracked item runs its own daily **buy(dip) / sell(peak) clock** — the exact `hourProfile`
dip/peak that `read-window-range.mjs --profile` prints. This skill consolidates them into ONE
time-sorted agenda so the upcoming actions are visible at a glance. It is a
**presentation/aggregation layer over existing diurnal data — NOT a new market model**, and it is
**INFORM-ONLY** (windows are `hourProfile` medians, n≈0): the schedule PLANS, it never gates.

## Run it
```
node pipeline/commands/read-schedule.mjs            # -c (current positions ∪ offers) — the DEFAULT
node pipeline/commands/read-schedule.mjs -w         # the watchlist (watchlist.json)
node pipeline/commands/read-schedule.mjs -c -w      # union of both, each row tagged C / W / C/W
node pipeline/commands/read-schedule.mjs --audit    # flipped-but-not-watchlisted review
```

Three **mutually-exclusive modes** (`-c` and `-w` may be combined; `--audit` stands alone):
- **`-c` / `--current-position`** (default) — the actionable set: open lots in `positions.json` ∪
  open offers in `offers.json` (anything with money in a GE slot). Typically 2–6 items — cheap.
- **`-w` / `--watchlist`** — every name in `watchlist.json` (~25 items). An explicit "what's coming
  up across everything I track" pass. A name that doesn't resolve prints a one-line ⚠ and is skipped.
- **`--audit`** — reviews `positions.json` `closed` for items we've actually flipped that are NOT in
  `watchlist.json`, with trade count + realised P/L, sorted most-flipped-first. A **review output,
  never an auto-mutation** — it proposes; Ben greenlights. No market fetch.

## The agenda table
Sorted by **`In (h)` ascending** (soonest window first):

| In (h) | Window | Item | Action | Level | List |
| ---: | --- | --- | --- | ---: | --- |

- **`In (h)`** — hours to the window's next start, nearest 0.5h; `now` when currently inside it.
- **Window** — the dip/peak hour range in BOTH zones (local / UK).
- **Action** — `BUY dip` / `SELL peak`. Each item contributes up to 2 rows (its dip + its peak).
- **Level** — the recent dip/peak price guide (the bid/ask candidate).
- **List** — C / W tag(s).

## How to present it
Run the script, then interpret the table into a **short spoken agenda** — the same pattern
`/scan` and `/positions` follow. Lead with the soonest actionable rows (small `In (h)` and,
for `-c`, a window that's `now` or within a couple hours), stating each as
`<item> — <BUY dip / SELL peak> @ <level> in <In(h)>` on ONE line per item (the compact-output
rule). Fold the far-off rows into a brief "later today" tail. For `--audit`, summarise the
strongest 2–3 unwatchlisted-but-flipped candidates and ask whether to add them to `watchlist.json`
(never edit it yourself). Honesty (process rule 4): these windows are n≈0 `hourProfile` medians —
a guide to time the passes, never a fill guarantee.

## Loop banner
`run-loop.mjs` prints a `⏭ next:` one-liner (the single soonest `-c` window) at the top of each
watch-due tick, off this same `buildAgenda` — so the upcoming action is always visible mid-loop
without running the skill.
