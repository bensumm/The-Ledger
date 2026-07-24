---
name: book
version: 1
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

- **Live marks are age-labelled.** A mark whose last /latest print is older than ~15m is flagged
  `⚠ Nm old`; never relay a stale P&L number as if it were live. All P&L is after-tax (`breakEven`).
- **The free-slot count is a log-derived LOWER bound.** A just-completed-but-not-yet-collected GE slot
  reads as FREE (the Exchange Logger only emits on a state change). So "N free" means "at least N
  free" — don't treat it as ground truth if a fill just landed.
- **`deployablePool` degrades conservatively.** A resting bid whose item isn't in the fetched marketRef
  classifies COMMITTED, so the deployable figure can under-report — it never over-reports.
- **Grouped P&L blends tranches.** An old core lot + a fresh top-up show ONE blended break-even and ONE
  (oldest) days-held — same convention as every other positions surface, not a per-tranche view.

## How to relay

Read the stdout sections and relay them compactly — actionable first (free slots + deployable capital
+ any underwater lot), then the rest. Keep ONE line per lot (repo output convention). The sizer's
BINDING line is the single most useful number when Ben asks "how much can I buy" — lead with it.
