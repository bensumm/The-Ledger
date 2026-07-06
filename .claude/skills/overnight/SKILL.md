---
name: overnight
version: 1.11
description: Two-phase end-of-day setup — resolve current positions, pause for Ben's free capital, then scan and size overnight bids with an accumulation-and-capital table. Triggers — "set up for overnight", "what should I leave running overnight", "overnight offers", "going to bed", "overnight".
---

# /overnight — two-phase interactive composer

## Time-geography of the overnight flip (v1.8, 2026-07-05 — Ben-endorsed)

Ben is US-Pacific; OSRS demand is UK-centric. **Ben's sleep window (~01–09 local) = UK
daytime (~08–16 GMT) — the deepest demand pool of the day**, measured 3–4× the quiet-window
instabuy volume on every windowrange read taken so far (bludgeon 881 vs 232, jaw 477 vs 169,
blowpipe 738 vs 220 median units). The game's actual quiet trough (GMT ~04–08) is Ben's
**late evening, while he's still at the keyboard**. Consequences for every overnight plan:

- **Overnight ASKS are structurally favored** — a band-top ask rides the UK-day wave while
  Ben sleeps (the 2026-07-05 bludgeon: trough-priced 16.79m rebid AND 17.70m band-top ask
  both filled inside the UK-day window). Don't under-price asks out of generic overnight
  fill-fear; the window read (§ fill-realism, ask side) is the honest bound.
- **Overnight DEEP BIDS are structurally disfavored** — placed at Ben's midnight they
  target a floor that stops printing as UK demand lifts (~07–08 GMT ≈ Ben 00–01): the
  soul-rune band-floor bids went 0-fill on two consecutive nights for exactly this reason.
  The BUY window is Ben's evening (the GMT 04–08 trough) — buy the trough before bed, list
  the ask, sleep through the sell window.
- Evidence bounds (process rule 4): the volume asymmetry is measured and the timezone
  geometry is fact; the behavioral sample (1 two-leg win, 2 bid failures) is small — keep
  scoring fills against this model as nights accrue.
- **Weekend→weekday calendar shift (v1.11, 2026-07-06 — Ben's call, 1 observation).** The
  day-of-week matters the same way the hour does: weekend sessions carry deeper player
  demand, so window-quantile reads built on Fri–Sun days OVERSTATE what a Mon–Thu morning
  reaches (anchor: the DWH 15.65–15.71m "reached 3/3 mornings" stat was all weekend
  mornings; the Monday session peaked ~15.52m and the asks had to step down). The inverse
  is the working hypothesis for Thu/Fri heading into the weekend: expect highs to jump, so
  don't under-price a Thursday-night ask off midweek quantiles. **Check before trusting any
  window read: which weekdays were the sample days, and which weekday is the target
  window?** If the read crosses the weekend/weekday boundary, discount (or raise) the
  quantiles and say so on the line. Evidence: one Monday morning + a plausible prior —
  score this as weeks accrue; the Thu/Fri lift side is still unobserved.

This is a COMPOSITION, explicitly two-phase and interactive — never a single batch read.
It invokes `/positions` and `/scan` **via the Skill tool** so tweaks to the children
propagate automatically; restate nothing from them. Skills never bump `APP_VERSION`.

## Phase 1 — resolve positions, then PAUSE

1. **Invoke `/positions`** (Skill tool) → the cut/hold action plan with exact prices.
   Its standalone interactive tail (the capital question) is suppressed — the phase
   boundary below owns it. **Freshness (SY1):** `/positions` runs `node pipeline/sync-fills.mjs`
   first (from the MAIN checkout, never a worktree — SY1.2), so the book is fresh for the
   whole composition; don't re-run the sync when `/scan` runs in Phase 2.
2. **Chase-bid sweep (Ben, 2026-07-05 — the entry-aggression posture flip).** Active
   sessions price bids near the live instasell to fill; overnight inverts that. Before the
   pause, list every RESTING BUY offer (`node pipeline/watch.mjs` shows them with verdicts)
   and flag any bid priced at/near the live instasell or in the upper half of its band —
   each must be **cancelled or dropped to the band floor / a `windowrange.mjs`-supported
   level** before Ben walks away. A chase-priced bid left unattended fills into the first
   quiet-hours dip with nobody watching the exit — the exact adverse selection the active
   posture accepts only because someone is at the keyboard. Canonical posture doctrine:
   `/scan` §2 "Entry aggression follows posture"; this step is its overnight enforcement.
3. **STOP and wait.** Ben executes the cuts/re-lists in-game, then states **how much
   capital he has free to commit overnight**. Resolving current positions is what
   determines free capital + free GE slots, so the capital statement is the phase
   boundary of /overnight. Do not proceed to Phase 2 on a guessed number.

## Phase 2 — scan, filter, size against stated capital

4. **Run the overnight-posture screen** — `node pipeline/screen.mjs --posture overnight --publish`
   (S2), or invoke `/scan` and pass `--posture overnight`. The posture already does the
   structural filtering for you: it keeps only flat/rising regimes with a confident (reliable)
   band, drops the thin gp-flow fast-lane and any 2h breakdown, ranks by net edge over velocity,
   and EXCLUDES items whose yesterday-overnight window printed materially below the current
   optimistic bid (`overnightStaleRisk` — the built-in stale/underwater-by-morning test). The
   500k gp/day floor is applied too. So you no longer hand-apply those exclusions.
5. **What the posture does NOT decide — your remaining judgment layer:**
   - **Big-ticket / mildly-rising items survive the posture** (they're flat/rising, non-thin) —
     that's intended: an optimistic big-ticket buy is a good overnight option. **Size them**
     (units × capital at risk, often 1–2 fills) and **flag retrace risk on the line**.
   - Honesty rule (process rule 4): the posture's stale-by-morning test is one prior night =
     one sample. It PICKS among existing edges; it does not predict. Don't oversell it.
   - **Nightly-low TREND check (v1.7, 2026-07-05).** The posture's flat-regime gate passed
     three items in one run (tormented bracelet, amulet of fury, zombie axe) whose *nightly
     lows* were trending straight down or had just repriced — fallers/repricers in disguise
     that the multi-day regime average hadn't caught yet. When the fill-realism windowrange
     read comes back, also LOOK AT THE PER-DAY LOW COLUMN: lows stepping down night after
     night (or a 0/14 touch count on a bid near live) = the item is falling into your bid —
     skip it regardless of the regime label. The touch-quantiles alone can mislead when the
     touches all predate a reprice (zombie axe: 10/14 touched, 0/4 post-reprice).
   - **Decay-trend trough projection (v1.10, 2026-07-05 — Ben-endorsed).** The mirror case:
     an item in a POST-SPIKE DECAY (nightly lows stepping down toward a prior base). There
     the raw touch-quantiles mislead in the *other* direction — pre-spike days sat far BELOW
     tonight's level, so a candidate bid shows "touched 9/14 days" while none of those
     touches describe the current regime. Project tonight's trough from the **night-over-
     night low trend** instead (the per-day low column, most recent 3–5 nights): read the
     step size, extend it one night, and price the bid at/just above the projected floor.
     Anchor: the bludgeon decay (window lows 18.85→18.08→17.79→17.03m) priced the 17.02m
     bid that filled; the 14-day quantiles would have said anything under 18.8m was safe.
     Evidence: one item, ~4 nights (process rule 4) — this is a "read the low column's
     trend" prompt, not a formula.
   - **Fill-realism check (v1.1; measured, not guessed, since v1.2).** The optimistic buy
     is the 2h-band FLOOR: an extreme print, not a typical price, and overnight is
     exactly when nobody crosses down to it (2026-07-04: both rune bids placed at the
     evening band floor went 0/25,000 in ~7.5h; by morning the floor had drifted above
     the bids). **Run `node pipeline/windowrange.mjs "<item>" --bid <candidate>` for every
     candidate bid** — it scores the last ~14 local nights from the 1h timeseries and
     prints the bid levels touched on ~50%/~75%/all nights plus the overnight instasell
     volume pool. Price must-fill bids at a level touched on **most** recent nights
     (~75%+), never off a single night's dip (the 176 death-rune bid was one night's
     anomaly — the other 13 nights never went below 184). "Touched" ≠ limit filled —
     pair it with the volume line — and ~14 nights is a small sample (process rule 4).
6. **Accumulation-and-capital table (required output).** Ben's exact ask: "how many can I
   accumulate in 8h and how much capital does that require." For each recommended bid:
   - **Bid price** (the optimistic buy) **and the assumed sell price** (the optimistic
     2h-band sell target the Net/u uses — the table must state it, never leave the sell
     side implicit). Both on the standard quote basis; sell never below break-even.
     **Each carries its timing target (Ben, 2026-07-05):** bind both numbers to the window
     expected to fill them — the bid to the overnight-window read the fill-realism check
     already produced ("touched ~75% of nights"), the sell to when tomorrow's flow should
     reach it (morning lift / next-day churn). "X, targeting Y" — never a bare number.
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
7. **Output the cut / hold / slot plan:** which positions were cut (Phase 1), which holds
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
