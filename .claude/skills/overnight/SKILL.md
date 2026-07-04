---
name: overnight
version: 1.1
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

3. **Invoke `/scan`** (Skill tool) → candidate flips (the 500k gp/day floor is already
   applied by the child).
4. **Apply the overnight filter — "stable preferred but not required" (Ben, 2026-07-04):**
   - **Hard-exclude only:** fresh repricers (large multi-day regime move → overnight
     retrace risk) and falling regimes.
   - **Do NOT hard-exclude big-ticket or mildly-rising items** — optimistic buys on big
     tickets ARE a good overnight option. Instead **size them** (units × capital at risk,
     often 1–2 fills) and **flag the retrace risk explicitly on the line**.
   - Prefer clean Momentum (no `↓`). An optimistic bid must plausibly fill in ~8h
     unattended and not be stale/underwater by morning — lean on the diurnal reasoning
     (PLAN-3 `diurnalRead`: quiet-hour behavior), but honesty rule (process rule 4): one
     prior night is one sample; prefer existing edges, don't manufacture predictions.
   - **Fill-realism check (v1.1 — the 2026-07-04 zero-fill night).** The optimistic buy
     is the 2h-band FLOOR: an extreme print, not a typical price, and overnight is
     exactly when nobody crosses down to it (both rune bids placed at the evening band
     floor went 0/25,000 in ~7.5h; by morning the floor had drifted above the bids). For
     bids that MUST fill unattended, price **between the band floor and the live
     instasell** — closer to instasell = likelier fill, at the cost of margin — and
     check the 5m series for how many recent windows actually traded at/below the
     proposed bid; if only a handful, say so and flag the line as low-fill-odds. The
     evening band is an evening artifact — expect it to move overnight.
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

Note: when `screen.mjs --posture overnight` ships (PLAN.md chunk S2), prefer it and thin
this filter prose accordingly.
