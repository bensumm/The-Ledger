---
name: schedule
version: 1.7.0
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

Column legend (the render columns of `read-schedule.mjs`):

| Column | Meaning |
| --- | --- |
| `In (h)` | hours to the window's next start, nearest 0.5h; `now` when currently inside it. |
| Window | the dip/peak hour range in BOTH zones (local / UK). A leading **`~`** (DT4, 2026-08-10) means these hours did NOT clear the split-half reliability gate, or could not be measured — the TIME is not a commitment. **It says nothing about the Level, which is marked separately** (this row used to read "the LEVEL still stands", which vouched for the one number that was actually unguarded — see the Level row). Only ~0.8% of items clear it, so **most rows are marked**: read the agenda as a level plan with timing hints, and treat an unmarked row as the rare item whose clock actually repeats. A legend prints under the table whenever any row is marked. |
| Action | `BUY dip` / `SELL peak`, plus `BUY dip·2` / `SELL peak·2` for a SECOND elevated/depressed window. Each item contributes up to **4** rows (`dips.slice(0,2)` × `peaks.slice(0,2)`) — this said 2 until 2026-08-09, which would make a real second window read as a typo (memory `surface-secondary-local-peaks`). |
| Level | the recent dip/peak price guide (the bid/ask candidate), routed through `deriveDiurnalRange` — the ONE home for the dip-not-below-live (Ghrazi) guard. **Marks: `↧`** the dip was not below live so it was repriced TO the live instasell (a resting bid at the raw dip would not fill); **`⚠`** the pair is DEGENERATE — the peak level is not above the dip level, so the row pair does not make money as printed, do not read it as a plan; **`?`** no live price that pass, so the guard could not run and the level is unverified; **`*`** the level-reality read flagged this level (spike-top / stale) and the legend under the table names it WITH the typical level (rendered `~X` in the compact `short` style the console bits use, and spelled out as `typical ~X` in the `exit`/`full` styles — do NOT grep relayed output for the word "typical") — quote the typical, not the level; **`?*`** both of the last two apply. A `↧` or `⚠` row never also carries `*`: on a repriced row the reality read describes the raw dip level rather than the one printed (`js/windowread.mjs`), and a degenerate row already carries the louder, more specific warning. _(Fixed 2026-08-10: this column printed the RAW `hourProfile` level and was the only consumer in the repo bypassing that guard. Live failure — Bastion potion(4) showed `BUY dip 15,191` above BOTH its SELL rows (15,027 / 15,005) with live instasell at 14,723. The dip HOUR is chosen by de-trended `devLow` while the level printed is that hour's ABSOLUTE price, and those can point opposite ways: 7.3% of 600 archive items inverted, 86% had a dip hour that was not the cheapest hour by level.)_ Rendered with `fmtP` — FULL gp resolution under 100k (`1,081`, not `1.1k`), compact above it (`26.30m`) — because it is a price to place an offer at. Ben, 2026-08-05: the old `fmt` render collapsed all four Snape-grass rows (1,081 / 1,093 / 1,122 / 1,123) onto one `1.1k`, hiding a 42gp spread on a trade whose whole margin was ~36/u. |
| List | C / W tag(s). |

## How to present it
Run the script, then interpret the table into a **short spoken agenda** — the same pattern
`/scan` and `/positions` follow. Lead with the soonest actionable rows (small `In (h)` and,
for `-c`, a window that's `now` or within a couple hours), stating each as
`<item> — <BUY dip / SELL peak> @ <level> in <In(h)>` on ONE line per item (the compact-output
rule). Fold the far-off rows into a brief "later today" tail. For `--audit`, summarise the
strongest 2–3 unwatchlisted-but-flipped candidates and ask whether to add them to `watchlist.json`
(never edit it yourself). Honesty (process rule 4): these windows are n≈0 `hourProfile` medians —
a guide to time the passes, never a fill guarantee.

**A `*`-marked Level is spoken WITH the clause the legend gives it** (`js/windowread.mjs`
`realityClause` — the flag never reprices the level): say the typical, or say the level and its
`⚠ spike-top …` / `⚠ stale …` beside it, because a spoken agenda that drops the mark is exactly where
a flagged level becomes a plain "place it at X".

## Loop banner
`run-loop.mjs` prints a `⏭ next:` one-liner (the single soonest `-c` window) at the top of each
watch-due tick, off this same `buildAgenda` — so the upcoming action is always visible mid-loop
without running the skill.

## Reverse-flip cycles (RF4)
When `reverse-flip-state.json` holds declared in-flight cycles (`awaiting-rebuy`/`rebuy-armed`), the
agenda unions `RF`-tagged rows (`SELL peak`/`REBUY dip`/`REBUY armed`) and prints a "Reverse-flip cycles"
note block under the table — the `REBUY_STALE_DAYS` nudge. **The thin rebuy-strand caution does NOT
print on this surface** (corrected 2026-08-09: it was listed here but was dead code — `read-schedule`
has no guide/volDay, so `isThinBigTicket` always short-circuited to false. Use `/book` or a quote for
the liquidity read on a big-ticket strand).
INFORM-ONLY n≈0; relay it when present. An empty store surfaces nothing extra.
DT3 (2026-08-09) removed this block's third note, the shared hourly-drift line ("a RISING drift is the
reverse-flip's OWN bad signal — you'd rebuy into strength"): the per-hour slope behind it was measured to
be a coin flip and deleted. Its replacement needs an ASK level to score reach against, and this surface
never had one, so the agenda simply carries one fewer note now.
