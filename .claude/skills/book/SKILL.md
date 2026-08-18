---
name: book
version: 1.3
description: Show the state of the book right now — GE slots, working/parked/idle capital, per-lot P&L, and (with --size) how much of an item a given capital can buy. Triggers — "what's my book look like", "what's deployed/idle", "how many slots free", "capital dashboard", "how much X can I buy right now", "book".
---

# /book — the book / capital dashboard

Skills-versioning note: this file's `version` bumps on material behavior change; skills NEVER bump
`APP_VERSION` (that marks the deployed app, which this pipeline-only reader never touches).

A standing "state of the book right now" read — it reads existing state and renders it; it invents no
new market model and never places, cancels, or writes anything. INFORM-ONLY, never a gate/verdict.

## Run it

- **Bare dashboard** (slots + capital + P&L):
  `node pipeline/commands/read-book.mjs`
- **With the tranche sizer** ("how much X can I buy right now?"):
  `node pipeline/commands/read-book.mjs --size "<item or id>" [--capital <gp>]`
  `--capital` defaults to this run's own **deployablePool** (the three-tier deploy denominator = free
  cash + reclaimable DEEP-bid escrow); pass `--capital` only to size against a different figure.

The command auto-runs the LOCAL zero-git `sync-fills.mjs` first (SY1), so it reads a fresh book — no
manual sync needed. It does ONE live fetch per item in the held ∪ resting-bid ∪ {sizer target} union.

## What it renders

1. **`=== SLOTS ===`** — occupied / free of the 8 GE slots + each occupant (side, item, price, fill).
2. **`=== CAPITAL ===`** — working (held) vs parked (resting bids) split, total capital, and the
   three deployable tiers (`deployable ≤ … ≤ liquid`) verbatim from the derived-cash model.
3. **`=== BOOK (P&L) ===`** — one row per held item (grouped at weighted-avg cost): cost basis, live
   mark, unrealized P&L, % to break-even, capital tied, days held.
4. **`=== SIZER: <item> ===`** (only with `--size`) — the recommended buy size = the MIN of three
   bounds (buy-limit remaining · clearability = 0.5% of daily volume · capital ÷ unit cost), which
   bound is **BINDING**, and the net if the position cycles once.

## Honesty caveats — state these when relaying (they are decided simplifications, not bugs)

- **Live marks on the P&L BOARD are age-labelled — and the label is ALWAYS present.** _(judgment: display honesty)_
  Since 2026-08-09 the shared `liveAgeTag` prints an age on every board mark: `(<1m ago)` / `(Nm ago)` when
  fresh, `⚠ Nm old` past ~15m, `(age n/a)` when unknown. (It used to print nothing when fresh, which made
  "unchanged price" and "stale read" indistinguishable.) Never relay a stale P&L number as if it were live.
  All P&L is after-tax (`breakEven`).
  **SCOPE — this covers the board only.** `read-book.mjs`'s own SIZER line (`net if cycled once (sell …)`)
  and `book-model.mjs`'s reverse-flip `liveTxt` still render their marks UNLABELLED. The code headers were
  narrowed on 2026-08-09 precisely because the tool-wide wording was false at those two sites; this skill
  kept the old wording until 2026-08-09. Don't cite it as tool-wide coverage.
- **The sizer REFUSES on an unknown buy limit — it never treats null as unlimited.** _(judgment: sizing honesty)_
  `book-model.mjs` returns `refuse: true` / `refuseReason: 'unknown-limit'` with every bound null when
  `limit == null`. Relay that as "cannot advise a size", not as an unbounded one (repo rule
  `buy-limit-caps-every-size`).
- **The free-slot count is a log-derived UPPER bound** (equivalently: OCCUPANCY is the lower bound).
  _(judgment: display honesty)_ A just-completed-but-not-yet-collected GE slot reads as FREE (the
  Exchange Logger only emits on a state change), which inflates `free`. So "N free" means "at MOST N
  free" — size new offers against it knowing it can only be too high, and don't treat it as ground
  truth if a fill just landed.
- **`deployablePool` degrades conservatively.** _(mechanic: `pipeline/lib/capital/derive-cash-tiers.mjs`)_ A resting bid whose item isn't in the fetched marketRef
  classifies COMMITTED, so the deployable figure can under-report — it never over-reports.
- **The deployable figure is SHOWN, not modelled — a restart-suspect flag warns when it may be inflated, and a wrong number is fixed at the SOURCE (PLAN-CAPITAL-DEPLOYABILITY L2/L3, Ben 2026-07-26).** _(judgment: capital-transparency doctrine)_ The deployable line now carries `⚠ N restart-suspect bid(s) (~Xm) may be included — verify in-game` when a restart-blind bid (`suspectBidEscrow`) may have inflated it: a restart-blind slot reads EMPTY, so its escrow drops out of offers.json and is never subtracted. The flag is INFORM-ONLY (it never changes the number). When the deployable is actually wrong, correct it at the SOURCE, never by patching a derived view (`fix-at-the-source-not-derived-view`): **re-anchor** `node pipeline/commands/derive-cash.mjs <amount>` for a drifted free-cash baseline, or a **manual-log fix / phantom-bid clear** for a "reclaimable" bid that's really gone. The automated modelling redesign was deliberately shelved — Ben's one-command correction is the resolution (`gate-on-error-cost-not-n`).
- **Grouped P&L blends tranches.** _(judgment: display convention)_ An old core lot + a fresh top-up show ONE blended break-even and ONE
  (oldest) days-held — same convention as every other positions surface, not a per-tranche view.

## How to relay

Read the stdout sections and relay them compactly — actionable first (free slots + deployable capital
+ any underwater lot), then the rest. Keep ONE line per lot (repo output convention). The sizer's
BINDING line is the single most useful number when Ben asks "how much can I buy" — lead with it.

## Reverse-flip pending (RF4)
When `reverse-flip-state.json` holds `awaiting-rebuy`/`rebuy-armed` cycles, `read-book` prints a
"REVERSE-FLIP PENDING" section (sold price · BE-rebuy · live · days-pending + inform notes) for each
declared cycle — these are capital-free BETWEEN-legs cycles that own no lot / no slot, so they appear
nowhere else on the book. INFORM-ONLY n≈0; relay it when present. An empty store prints nothing extra.
