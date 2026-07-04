---
name: overnight
version: 1.4
description: Two-phase end-of-day setup — resolve current positions, pause for Ben's free capital, then scan and size overnight bids with an accumulation-and-capital table. Triggers — "set up for overnight", "what should I leave running overnight", "overnight offers", "going to bed", "overnight".
---

# /overnight — two-phase interactive composer

This is a COMPOSITION, explicitly two-phase and interactive — never a single batch read.
It invokes `/positions` and `/scan` **via the Skill tool** so tweaks to the children
propagate automatically; restate nothing from them. Skills never bump `APP_VERSION`.

## Phase 1 — resolve positions, then PAUSE

1. **Invoke `/positions`** (Skill tool) → the cut/hold action plan with exact prices.
   Its standalone interactive tail (the capital question) is suppressed — the phase
   boundary below owns it.
2. **STOP and wait.** Ben executes the cuts/re-lists in-game, then states **how much
   capital he has free to commit overnight**. Resolving current positions is what
   determines free capital + free GE slots, so the capital statement is the phase
   boundary of /overnight. Do not proceed to Phase 2 on a guessed number.

## Phase 2 — scan, filter, size against stated capital

3. **Run the overnight-posture screen** — `node pipeline/screen.mjs --posture overnight --publish`
   (S2), or invoke `/scan` and pass `--posture overnight`. The posture already does the
   structural filtering for you: it keeps only flat/rising regimes with a confident (reliable)
   band, drops the thin gp-flow fast-lane and any 2h breakdown, ranks by net edge over velocity,
   and EXCLUDES items whose yesterday-overnight window printed materially below the current
   optimistic bid (`overnightStaleRisk` — the built-in stale/underwater-by-morning test). The
   500k gp/day floor is applied too. So you no longer hand-apply those exclusions.
4. **What the posture does NOT decide — your remaining judgment layer:**
   - **Big-ticket / mildly-rising items survive the posture** (they're flat/rising, non-thin) —
     that's intended: an optimistic big-ticket buy is a good overnight option. **Size them**
     (units × capital at risk, often 1–2 fills) and **flag retrace risk on the line**.
   - Honesty rule (process rule 4): the posture's stale-by-morning test is one prior night =
     one sample. It PICKS among existing edges; it does not predict. Don't oversell it.
   - **Fill-realism check (v1.1; measured, not guessed, since v1.2).** The optimistic buy
     is the 2h-band FLOOR: an extreme print, not a typical price, and overnight is
     exactly when nobody crosses down to it (2026-07-04: both rune bids placed at the
     evening band floor went 0/25,000 in ~7.5h; by morning the floor had drifted above
     the bids). **Run `node pipeline/nightlows.mjs "<item>" --bid <candidate>` for every
     candidate bid** — it scores the last ~14 local nights from the 1h timeseries and
     prints the bid levels touched on ~50%/~75%/all nights plus the overnight instasell
     volume pool. Price must-fill bids at a level touched on **most** recent nights
     (~75%+), never off a single night's dip (the 176 death-rune bid was one night's
     anomaly — the other 13 nights never went below 184). "Touched" ≠ limit filled —
     pair it with the volume line — and ~14 nights is a small sample (process rule 4).
5. **Accumulation-and-capital table (required output).** Ben's exact ask: "how many can I
   accumulate in 8h and how much capital does that require." For each recommended bid:
   - **Bid price** (the optimistic buy) **and the assumed sell price** (the optimistic
     2h-band sell target the Net/u uses — the table must state it, never leave the sell
     side implicit). Both on the standard quote basis; sell never below break-even.
   - **Expected units over ~8h** = `min(buyLimit × 2, 8/24 × 0.10 × volDay)` — the buy
     limit refreshes ~every 4h → 2 windows overnight, capped at a 10% share of
     limiting-side daily volume (the SAME convention as `screen.mjs`'s `expUnits =
     min(limit×6, 0.10×volDay)` scaled to 8h; keep the constants aligned with that
     formula). Buy limits print on `quote.mjs`'s per-item regime line. This figure is an
     **UPPER BOUND that assumes fills happen at your price** — it prorates daily volume
     flat across the quiet hours and prices in no fill probability. Present it as "up
     to", paired with the fill-realism read above.
   - **Capital required** = expected units × bid price.
   - **Net/u and total if fully cycled** at the stated sell price, after 2% tax.
   - **Prioritize top-down** (best risk-adjusted edge first) with a **running capital
     subtotal**, so Ben takes lines until the Phase-1 stated capital runs out.
6. **Output the cut / hold / slot plan:** which positions were cut (Phase 1), which holds
   stay listed at what break-even-floored price, and the prioritized bid table with exact
   prices, expected units, and capital per line.

Note: `screen.mjs --posture overnight` shipped (S2) — this skill now relies on it for the
structural overnight filtering (above); keep only the sizing + fill-realism layers here.

## Encode learnings (self-improvement — after the offers are placed, never during)

The overnight run often teaches the most (a fill-realism read that was wrong, an
accumulation estimate that overshot, a filter that let a fresh repricer through). Capture
it — but the bid table and placed offers come first, always.

- **Timing:** only AFTER Phase 2's plan is delivered and Ben has placed the overnight bids
  (or says he's done). Never interleave doc edits with the setup — offers first, encoding
  after (Ben's explicit rule).
- **Prompt:** at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (a sizing/fill-realism call
  that worked/failed, a threshold that misled, a filter gap).
- **Routing — one canonical home per fact, move never copy:** overnight-posture judgment →
  this SKILL.md (bump its `version:`); a positions/scan judgment lesson → that child's
  SKILL.md; table/app contracts → CLAUDE.md; user preferences → Claude memory; monitoring
  doctrine → `pipeline/MONITORING.md`.
- **Execution:** spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** process learnings encode freely; a *market* claim (a
  fill-rate, a nightly pattern) needs the usual evidence standard — one night is one sample.
