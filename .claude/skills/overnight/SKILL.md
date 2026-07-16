---
name: overnight
version: 1.21
description: Two-phase end-of-day setup — resolve current positions, pause for Ben's free capital, then scan and size overnight bids with an accumulation-and-capital table. Triggers — "set up for overnight", "what should I leave running overnight", "overnight offers", "going to bed", "overnight".
---

# /overnight — two-phase interactive composer

**Paste the raw markdown table verbatim, unfenced (Ben, 2026-07-16).** This flow runs `/positions`
then `/scan`; relay each script's own markdown table (the positions table, the screen flip-niche
tables, the overnight accumulation-and-capital table) as PLAIN markdown — NOT wrapped in a fenced code block
(a code fence forces the client to show literal `|`/`-` characters instead of a real table —
confirmed live, 2026-07-16). The sizing prose supplements the tables, it doesn't replace them.

**Relay both surfacing tiers — nothing trimmed speculatively (R10, 2026-07-16).** The render layer
labels every note family a TRACKING tier — `core` (verdicts, alerts, the WATCHLIST, the accumulation
table) and `context` (the inform-only families: diurnal, forecast, ask headroom, asym, window-clear,
reach relief, demand). _judgment:_ **both render AND relay by default** — there is NO default-hidden
middle tier, so surface the context notes too. The tier registry lives in `pipeline/lib/render.mjs`'s
header — the ONE registry; don't restate tiers here.

## Time-geography of the overnight flip (v1.8, 2026-07-05 — Ben-endorsed)

Ben is US-Pacific; OSRS demand is UK-centric. **Ben's sleep window (~01–09 local) = UK
daytime (~08–16 GMT) — the deepest demand pool of the day**, measured 3–4× the quiet-window
instabuy volume on every windowrange read taken so far (bludgeon 881 vs 232, jaw 477 vs 169,
blowpipe 738 vs 220 median units). The game's actual quiet trough (GMT ~04–08) is Ben's
**late evening, while he's still at the keyboard**. Consequences for every overnight plan:

- **Overnight ASKS are structurally favored** _(judgment: time-geography lean, n small)_ — a band-top ask rides the UK-day wave while
  Ben sleeps (the 2026-07-05 bludgeon: trough-priced 16.79m rebid AND 17.70m band-top ask
  both filled inside the UK-day window). Don't under-price asks out of generic overnight
  fill-fear; the window read (§ fill-realism, ask side) is the honest bound.
- **Overnight DEEP BIDS are structurally disfavored** _(judgment: time-geography lean, n small)_ — placed at Ben's midnight they
  target a floor that stops printing as UK demand lifts (~07–08 GMT ≈ Ben 00–01): the
  soul-rune band-floor bids went 0-fill on two consecutive nights for exactly this reason.
  The BUY window is Ben's evening (the GMT 04–08 trough) — buy the trough before bed, list
  the ask, sleep through the sell window.
- Evidence bounds (process rule 4): the volume asymmetry is measured and the timezone
  geometry is fact; the behavioral sample (1 two-leg win, 2 bid failures) is small — keep
  scoring fills against this model as nights accrue.
- **Weekday basis of a window read (v1.11→v1.12, 2026-07-06).** _(judgment: the narrow-slice weekend→weekday fade is UNCONFIRMED on full-day data — checked on DWH the apparent fade showed ONLY in the noisier 00-08 slice; full-day lows were flat-to-up across 3 Sun→Mon transitions)._ Before trusting any window read that crosses the weekend/weekday boundary, re-read on the full day — `node pipeline/commands/read-window-range.mjs "<item>" --window 0-23 --nights 21` — which is the honest basis; cross-reference `/positions` "trajectory read for confidence on a marginal/big-ticket hold."

This is a COMPOSITION, explicitly two-phase and interactive — never a single batch read.
It invokes `/positions` and `/scan` **via the Skill tool** so tweaks to the children
propagate automatically; restate nothing from them. Skills never bump `APP_VERSION`.

## Phase 1 — resolve positions, then PAUSE

1. **Invoke `/positions`** (Skill tool) → the cut/hold action plan with exact prices.
   Its standalone interactive tail (the capital question) is suppressed — the phase
   boundary below owns it. **Freshness (SY1):** `/positions` runs `node pipeline/commands/sync-fills.mjs`
   first (the local/zero-git default), so the book is fresh for the whole composition; don't re-run the
   sync when `/scan` runs in Phase 2.
   **THE ONCE-A-DAY PUBLISH lives here (Ben 2026-07-15).** `/overnight` is the daily session boundary, so
   this is where the book gets published to the deployed app: run `node pipeline/commands/sync-fills.mjs
   --publish` once, from the MAIN checkout (`C:\dev\The-Ledger`, **never a worktree** — this is the path
   that commits+pushes to `main`). It fetches/ff-pulls first (folding any phone `mobile-fills.log` trades,
   the multi-writer contract, FILLS-PIPELINE §13.3) then commits+pushes `fills.json`/`positions.json`. Every
   other read (in-session, `/scan`, `/positions`, `/morning`) stays local/zero-git; `--publish` runs ONLY
   here, once per day. If you're in a worktree and can't reach the main checkout, SKIP the publish and note
   the deployed app's book won't update tonight (the local reads are still fresh).
   **Refresh the measurement spine (Ben, 2026-07-07).** Right after that sync, run
   `node pipeline/commands/join-outcomes.mjs` once — the schema-v2 outcomes spine is NOT auto-updated by
   watch/screen (it's gitignored/derived), so it drifts stale across a trading session;
   `/overnight` is the daily session boundary where the day's completed fills + suggestion→fill
   joins get folded into it. It's EXTEND-never-rebuild, so it's safe to run any time; do it here so
   the F1-calibration accrual and the weekly `/morning` descriptive-outcomes read stay current.
2. **Chase-bid sweep (Ben, 2026-07-05 — the entry-aggression posture flip).** Active
   sessions price bids near the live instasell to fill; overnight inverts that. Before the
   pause, list every RESTING BUY offer (`node pipeline/commands/watch-positions.mjs` shows them with verdicts)
   and flag any bid priced at/near the live instasell or in the upper half of its band —
   each must be **cancelled or dropped to the band floor / a `read-window-range.mjs`-supported
   level** before Ben walks away. A chase-priced bid left unattended fills into the first
   quiet-hours dip with nobody watching the exit — the exact adverse selection the active
   posture accepts only because someone is at the keyboard. Canonical posture doctrine:
   `/scan` §2 "Entry aggression follows posture"; this step is its overnight enforcement.
3. **STOP and wait.** Ben executes the cuts/re-lists in-game, then states **how much
   capital he has free to commit overnight**. Resolving current positions is what
   determines free capital + free GE slots, so the capital statement is the phase
   boundary of /overnight. Do not proceed to Phase 2 on a guessed number.

## Phase 2 — scan, filter, size against stated capital

4. **Run the overnight-posture screen** — `node pipeline/commands/screen-flip-niches.mjs --posture overnight --publish`
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
     the bids). **Run `node pipeline/commands/read-window-range.mjs "<item>" --bid <candidate>` for every
     candidate bid** — it scores the last ~14 local nights from the 1h timeseries and
     prints the bid levels touched on ~50%/~75%/all nights plus the overnight instasell
     volume pool. Price must-fill bids at a level touched on **most** recent nights
     (~75%+), never off a single night's dip (the 176 death-rune bid was one night's
     anomaly — the other 13 nights never went below 184). "Touched" ≠ limit filled —
     pair it with the volume line — and ~14 nights is a small sample (process rule 4).
6. **Accumulation-and-capital table — the SCRIPT prints it (COD-2, 2026-07-10).** Ben's exact
   ask ("how many can I accumulate in 8h and how much capital does that require") is now an
   ENCODED output of `screen-flip-niches.mjs --posture overnight`: an **Overnight accumulation & capital**
   table under each flip-niche, top-down by the overnight sort, with per line `Bid → Ask (sell) ·
   up-to units/8h · Capital · Cum capital · Net/u · Total if cycled`. The up-to-units figure is
   the shared `expUnitsOvernight` (`= expUnits × 8/24 = min(buyLimit×2, 8/24×0.10×volDay)` —
   `pipeline/lib/gatecandidates.mjs`, so its constants can never drift from `expUnits`); the
   script prints its UPPER-BOUND caveat itself (assumes fills at your bid, prorates daily volume
   flat across the quiet hours, no fill probability). **Do not hand-compute or restate the
   formula — read the table.** Your remaining judgment on top of it:
   - **Timing target on every line (Ben, 2026-07-05):** bind the bid + sell to the window
     expected to fill them (the bid to the fill-realism / **Diurnal timing** read the script
     already prints, the sell to tomorrow's morning-lift / next-day churn). "X, targeting Y" —
     never a bare number. Sell never below break-even.
   - **Take lines top-down against the Phase-1 stated capital** using the running `Cum capital`
     column — stop when it exceeds what Ben freed; **flag retrace risk** on any big-ticket line.
   - **Pair every up-to-units figure with the fill-realism read** (§5 windowrange) — it is a
     ceiling, not a forecast.
6b. **Declare the thesis on every deliberate overnight/diurnal entry (VN-0, Ben 2026-07-11).**
   Each bid placed on a plan (buy tonight's trough, sell tomorrow's peak window) gets
   `node pipeline/commands/declare-thesis.mjs set "<item>" "<plan>" --tripwire <gp> --exit <gp> --window <h-h>
   --path <key>` at placement time — the declared tripwire/exit window is what keeps the
   morning-after verdicts framed against the PLAN instead of band-flip churn (`/positions`
   "Declare the thesis AT ENTRY"; MONITORING.md step 4). An overnight hold's cadence is the
   morning review, not a tight loop.
7. **Output the cut / hold / slot plan:** which positions were cut (Phase 1), which holds
   stay listed at what break-even-floored price, and the prioritized bid table (the script's
   accumulation table, filtered to the lines you're recommending within stated capital).

Note: `screen-flip-niches.mjs --posture overnight` shipped (S2) and now prints the accumulation-and-capital
table itself (COD-2) — this skill relies on it for BOTH the structural overnight filtering AND
the sizing; keep only the prioritization + fill-realism judgment here.

## Encode learnings (self-improvement — after the offers are placed, never during)

The overnight run often teaches the most (a fill-realism read that was wrong, an
accumulation estimate that overshot, a filter that let a fresh repricer through). Capture
it — but the bid table and placed offers come first, always.

- **Timing:** _(judgment: process)_ only AFTER Phase 2's plan is delivered and Ben has placed the overnight bids
  (or says he's done). Never interleave doc edits with the setup — offers first, encoding
  after (Ben's explicit rule).
- **Prompt:** _(judgment: process)_ at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (a sizing/fill-realism call
  that worked/failed, a threshold that misled, a filter gap).
- **Routing — one canonical home per fact, move never copy:** _(judgment: process)_ overnight-posture judgment →
  this SKILL.md (bump its `version:`); a positions/scan judgment lesson → that child's
  SKILL.md; table/app contracts → CLAUDE.md; user preferences → Claude memory; monitoring
  doctrine → `pipeline/MONITORING.md`.
- **Execution:** _(judgment: process)_ spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** _(judgment: process)_ process learnings encode freely; a *market* claim (a
  fill-rate, a nightly pattern) needs the usual evidence standard — one night is one sample.
