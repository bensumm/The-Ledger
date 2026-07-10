---
name: positions
version: 1.20
description: Review Ben's held GE positions against the live market and produce a prioritized cut/list/hold action plan. Triggers — "how are my positions", "check the market against what I hold", "am I underwater", "should I cut/hold anything", "review my holds", "positions".
---

# /positions — held-positions review, verdict interpretation, action plan

Skills-versioning note: this file's `version` bumps on material behavior change; skills
NEVER bump `APP_VERSION` (that marks the deployed app, which skills never touch).

## 1. Run the script — never hand-fetch

```
node pipeline/quote.mjs --positions
```

That command IS the market read (reads `positions.json` open lots, quotes each held item,
prints the standard table + Held@/Break-even/Verdict). Never hand-write a fetch. The gates
already ran inside `momVerdict()` — your job is to *interpret* the printed verdicts, never
to re-derive them.

Freshness: there is **no scheduled sync** (the 20-min `CofferFillsSync` job was eliminated
2026-07-04 — sync is on-demand only). **Sync first (SY1):** run `node pipeline/sync-fills.mjs`
before quoting so `positions.json` reflects every logged trade — including any phone-logged
lines, since the sync ff-pulls `origin/main` (mobile `mobile-fills.log` writes) before
reading the logs (the multi-writer contract, FILLS-PIPELINE §13.3) — then run `--positions`
against the fresh file. (`node pipeline/monitor.mjs` shows live exchange-log truth if a
just-made trade matters even more immediately.)

**Run the sync from the MAIN checkout only (SY1.2):** `sync-fills.mjs` commits+pushes the
pipeline artifacts (`fills.json`/`positions.json`) to `main` under the admin bypass, so run
it from `C:\dev\The-Ledger` — **never a git worktree** (a worktree is on a feature branch;
pushing pipeline artifacts from there would land them on the wrong ref). If this session is
running inside a worktree and you can't reach the main checkout, SKIP the sync and say so —
report that `positions.json` may be stale rather than pushing from the wrong branch.

**Act on the stale-book banner — re-sync, don't just note it (Ben, 2026-07-06).** When
`watch.mjs`'s summary prints `held basis positions.json Nm old ⚠ stale` and the age keeps
CLIMBING across passes, the banner is a prompt to ACT: run `node pipeline/sync-fills.mjs`
(from the MAIN checkout) to refresh the book BEFORE trusting or reporting the held count —
do not merely mention the banner and report off the stale file. Anchor (the failure this
fixes): on 2026-07-06 the book sat frozen ~2+ hours (age climbed past 300m) while positions
had actually changed; the held count was reported as ×2/×1 off a stale book when the real
position had already half-closed. (This complements the LW3 heartbeat — the heartbeat is the
localhost app's liveness signal; this is the operator's rule when reading `watch.mjs` in a
session.)

**Position = held inventory + active GE offers** (Ben's definition, 2026-07-04). If
`--positions` prints no open lots, the review isn't done: run `node pipeline/watch.mjs` —
its default pass covers active bids/asks (BID-OK / BID-BEHIND / CROSSING / CANCEL-BID) —
and report the offer set as the position set.

**Reading `watch.mjs`'s per-held note block (the V5 EMIT CONTRACT).** Every held lot's note
block is the same fixed, ordered shape: `verdict · conviction-state (V4 armed) · Δ-since-last
(V1) · structural tripwire (V2) · sell/list-at (+ break-even) · fill-progress`. The
**`sell: list @ X · break-even Y · <ask n/m or NOT LISTED>` line is ALWAYS present on a held
lot** — that guaranteed field is where you read the current list-at + break-even for every held
item without re-deriving it (Ben's rule: a fill you didn't see may have happened). Optional
fields drop out when N/A; the sell line never does. Full contract: `MONITORING.md` "What each
tick surfaces". (This is the SCRIPT's list-at; the step-down doctrine below can still override
it for a new/test lane.)

## 2. Separate flip targets from incidental inventory

Open lots include loot/supplies that were never flip targets (e.g. a stray Defence potion,
molten glass). Do NOT spend verdict/action lines on sub-noise lots. Tests, in order:

1. **Watchlist membership** — the natural positive signal (same idea as the Ledger
   watchlist filter in CLAUDE.md's open followups).
2. Absent watchlist data in-session, judgment: tiny total lot value (well under any sizing
   threshold), consumable/loot character, never traded as a flip in `fills.json` history.

Report incidentals in ONE collapsed line — "incidental inventory, ignored: X, Y" — and
exclude them from the action plan. **Never CUT-recommend an incidental lot.**

## 3. Interpret each verdict

**Vocabulary — the ONE home is `pipeline/MONITORING.md` step 4** (the PLAN-3 gate tree + the
momentum-up verdicts). Every verdict the script can emit — NO-READ, DIURNAL-WATCH, SHOCK-WATCH,
CUT, LIST-TO-CLEAR, CUT-CANDIDATE, WATCH — fresh entry, HOLD — ask filling, and the momentum-up
HOLD — list high / HOLD — watch — is defined there with what each means and does. Read it there;
don't re-derive it here. The script emitted the verdict; your job is to **render it as the action
line in §4, against the per-item dossier** — a verdict is a prompt for judgment, not an order
(the CANCEL-BID-on-a-thin-book and fresh-chase-entry examples in MONITORING step 4).

Interpretation that goes BEYOND the tree (this skill's value-add, not restated in MONITORING)
lives below: the sell-velocity preference (how to step an unfilled ask down toward the clear)
and the fill-progress check before acting on a CUT-CANDIDATE (an actively-filling ask may already
be resolving the underwater flag).

**Sell-velocity preference (Ben, 2026-07-04):** when a held item's ask sits ABOVE the current 2h band top and isn't filling, don't let it ride — recommend stepping the ask down to just under the band top (the price the market is actually printing), and if it still doesn't move within ~an hour or momentum flips ↓, step again to just above the live instabuy to clear. Moving the item and freeing the capital generally beats the patient premium. The floor is unchanged — never below break-even (the shared tax-capped `breakEven()`; see CLAUDE.md "Break-even") — the CUT/CUT-CANDIDATE verdicts remain the only exceptions. Present the rungs with net-per-unit and lot P/L so the velocity/premium trade-off is explicit.

**HOLD defaults to the band-TOP premium — step a NEW/test lane down to a reachable level
(Ben, 2026-07-06):** `momVerdict`'s HOLD emits "list @ <band top>" (the Optimistic 2h high)
as its default patient-premium ask. That default is right for a PROVEN lane you're happy to
wait on, but WRONG for a NEW/test lane, where velocity > premium: don't parrot the verdict's
band-top note — surface a step-down explicitly. Price the ask at a level the item actually
REACHES often (run the `windowrange.mjs --ask <level>` reach check the doctrine already
requires), take a little less profit, and get a few real laps to learn the lane's fill
behavior. Example (2026-07-06, one item — not a rule): a webweaver ask defaulted to 18.90m
(reached only 2/7 in the next-8h window); stepping to 18.70m (+226k/lap, +1.25%, reached 4/5
in the current regime) traded ~half the premium for a fillable ask. Break-even floor unchanged.

**Rising-item asks — do NOT under-price to a mid-band clear (Ben, 2026-07-07 — the berserker
overnight retro):** the step-down rules above are for a STALLED ask (not filling / decaying top).
The opposite error is just as costly: on an item with momentum ↑ / a RISING regime, an ask parked
at a mid-band *clear* price fills you out BEFORE the run finishes. When mom is ↑ or the regime is
rising, price the ask nearer the band TOP (or hold the lot) — do NOT step it down to a level that
clears mid-climb, and do NOT pre-emptively exit a rising held lot into a lower ask just to book the
trade. Anchor (one costed sample): a berserker overnight ask left at the 3.04m mid-band clear filled
at 3,039m while the ring kept running to 3,087m+ live instabuy — leaving ~+240k (≈+48k/ring ×5) on
the table, and a rebuy to recapture it pays the 2% tax twice (worse than having held). Applies
doubly overnight, where the UK-day lift is exactly the run you want the ask to ride (`/overnight`
time-geography). This is the complement of the sell-velocity step-down, not a contradiction: step
DOWN a stalled/decaying ask; price UP or hold a rising one. Break-even floor unchanged.

**Decaying-band-top trigger (Ben, 2026-07-04 — the bludgeon retro):** the 2h band top falling across consecutive watch passes while a held item's ask sits above the printing range means the "top" is stale old prints, not live demand — that decay is a step-down trigger in its own right; do NOT wait out the usual hour. And when a measured intraday trough/bounce window lies ahead (per a `windowrange.mjs` window read), prefer realizing the printing price early and re-bidding the trough over holding a stranded premium through it — two small legs beat one stale ask. Break-even floor unchanged.

**Trajectory read for confidence on a marginal/big-ticket hold (Ben, 2026-07-06 — the DWH
retro):** the stateless verdict and a narrow-window read can leave a big-ticket hold-vs-cut
call genuinely uncertain; a detailed FULL-DAY multi-week trajectory read is what generated
real decision confidence (the DWH verdict flipped to HOLD-list-high minutes after this read,
which the market then confirmed). Run it as **diligence for a big-ticket / underwater /
marginal hold-vs-cut decision** — NOT on every quote (this ties to memory "size scales
diligence"). Method:

1. **Use the FULL-DAY window, not the narrow demand slice:**
   `node pipeline/windowrange.mjs "<item>" --window 0-23 --nights 21`. The narrow 00-08
   demand slice OVERSTATED a weekend→weekday fade that the full-day lows did not show
   (see the `/overnight` correction below) — read the whole day.
2. **Pull enough history (2–3 weeks, `--nights 21`) to capture the PRE-SPIKE BASE** — so a
   post-spike decay can be read against the floor it is returning toward. (Same family as
   `/overnight`'s "decay-trend trough projection" — cross-reference it, don't duplicate: that
   one projects tonight's trough from the low trend; this one names the base a decay returns to.)
3. **Map days-of-week and NAME THE PHASE (base / spike / decay).** Then check whether the
   per-day LOWS have STOPPED stepping down: a decay that has round-tripped to the pre-spike
   base with lows that have stopped falling = BASING = hold-supportive. The cut tripwire
   then becomes "a convincing break BELOW the pre-spike base low" (a concrete structural
   level, per the override-discipline rule below).
4. **Gate by size / marginality** (above) — this is expensive diligence, reserved for the
   holds where the hold-vs-cut call is close and the lot is big.

DWH anchor (full-day, 15 days): a stable pre-spike base ~15.2–15.6m low / 15.8–16.2m high
(06-21→06-26), a spike to intraday 19.94m (06-30) / 18.80m (07-01), then a decay back to the
base with lows basing at 15.0–15.2m over the last 3 days (07-04/05/06) — a completed
spike-and-return; the named tripwire was sub-15.00m (a break below the base low). **Honesty
guard (process rule 4):** the METHOD encodes freely, but the market findings here are a tiny
sample — n=1 item, ~3 Sun→Mon transitions, one spike-and-return. Treat "basing = bottoming"
as a hypothesis to keep testing, not an established pattern.

**Entry-age check — fresh entries draw false CUTs (2026-07-05, three-for-three):** the gate
tree has no concept of entry age, so a just-filled patient buy shows "underwater" on the
instant-clear price (almost definitionally true minutes after any patient fill) and drew a
CUT-flavored verdict within ~20 minutes on every fresh entry in one session (jaw, bludgeon,
wrath — all correctly overridden). On a lot held under ~an hour whose ENTRY THESIS is intact
(the multi-day floor/base that justified the buy hasn't printed through), treat
CUT/CUT-CANDIDATE/UNDERWATER as noise and judge against the thesis, not the verdict.

**Override discipline — name a tripwire, then obey it (2026-07-05):** every verdict override
must come with a CONCRETE structural level, named at override time (e.g. "below 16.50m = the
7-day window floor is broken"), not an open-ended "hold anyway." While overriding, also track
the DECAYING COST OF THE CUT (the instabuy you'd clear at falls while you hold — option-value
bleed): if the clear price decays materially even without the tripwire printing, step the ask
down rather than binary hold-vs-cut. When the tripwire prints, EXECUTE without re-litigating —
the jaw 16.49m print (7-day floor break) is the anchor; the discipline only protects you if
the named level is obeyed both ways.

**Cut-and-rebid friction bar (2026-07-05, Ben-endorsed; ENCODED COD-3, 2026-07-10):** a cut
paired with a deeper re-entry bid is a legitimate two-leg (the jaw anchor: cut 16.87m, rebid
16.42m) — but each sell pays 2% tax, so the pair only beats holding if the rebid sits **more
than tax + half the spread below the clear price** (~2.5%+). This arithmetic is now the shared
`rebidBar(clear, spread)` in `js/quotecore.js` (friction = tax + half the spread; threshold =
the price the rebid must sit at/below), and `quote.mjs --positions` prints a **Rebid advisory**
line on every CUT / CUT-CANDIDATE / LIST-TO-CLEAR verdict — don't re-derive the numbers, read
that line. It is TRAJECTORY-AWARE (`rebidAdvice`): a **knife** (still falling) → advises AGAINST
the rebid (the bar is moot, cut and redeploy); an **oscillating** faller (bounces back at the
daily high) → rebid at the projected trough & sell the daily peak; else the friction bar governs.
Honesty: the bar arithmetic is solid; the trajectory/diurnal awareness is inform-grade
(placeholder classifier, n≈0) — it SUPPORTS the call, never auto-cancels/auto-rebids. (The
trajectory reads the read-only daily archive on this surface, so it's `unknown` → friction-bar
until the archive warms; the forecast upgrade to a quantitative projected-peak is PLAN-FORECAST
PF1.) State the discount-vs-friction numbers explicitly when recommending the pair.

**Tripwire conviction (2026-07-05, one-sample refinement — honesty rule applies):** the jaw
tripwire fired on a 1-in-1000 overshoot (16.49m against a 16.50m line) that stabilized
immediately — the floor "break" was 20k deep and the item recovered within the hour. A
structural tripwire should require conviction of the break before executing: a print
**meaningfully through** the level (~0.5%+) or two consecutive passes below it, not a
grazing touch. This tightens WHEN the tripwire fires; it does not soften obeying it once
fired (the override-discipline rule above stands). **`watch.mjs` now enforces this
mechanically (V4, arm-then-confirm):** its structural-break headline ALERT fires only when the
live instabuy is `< cut-trigger` (≥ `CUT_TRIGGER_DELTA` below support) OR below support for two
consecutive passes; a single graze *arms* (a visible note) instead of alerting. Likewise a
Gate-D `CUT-CANDIDATE` needs two consecutive underwater-liquid passes to become a headline
alert. The **Gate-2 breakdown `CUT` is exempt — it still alerts immediately** (a live breakdown
is not a thing to sit on).

**Limit-blocked CROSSING (2026-07-05):** a bid at/above the live instasell prints CROSSING
("expect fills about now") even when the 4h buy limit makes fills impossible — the gate can't
see limits. Before expecting fills or repricing a "not filling" bid, check the last buys in
`fills.json`: limit re-arms 4h after the first fill of the consumed batch (the soul-rune bid
sat CROSSING for ~50 minutes, correctly untouched, until the 23:17 re-arm).

**Fill-progress check before CUT-CANDIDATE action (2026-07-05):** before acting on a
CUT-CANDIDATE (or shallow UNDERWATER), check whether the current ask is actively filling
(`monitor.mjs` / the watch row's `listed n/m`). An ask that is transacting above the
clear price beats repricing down to a lower clear — twice on 2026-07-04 the gate fired
while the ask was filling (souls at 6k/25k) or 1gp under break-even; both were correctly
held. Depth and fill progress are context the stateless gate can't see; judge with them.

A feed-inverted row (regime line carries the "⚠ feed inversion — quote basis unreliable"
footnote) now prints **NO-READ** on its own — Gate 0 in `momVerdict()` folds inversion into
the reliability signal (Q1, quotecore 0.36.0). No interim override needed; just read the
verdict the script emits.

## 4. Render the action plan

Grouped by urgency: **cuts → list-to-clear → holds/watches**. One line each:
`item · held@ · break-even · verdict · exact action price`.

**Every action price states its timing target (Ben, 2026-07-05):** a recommended price is
"X, targeting Y" — bind the number to the window/mechanism expected to fill it, e.g.
"17.55m — targets the 23:00–03:00 UK-morning lift (reached 7/7d)" or "10.70m — velocity
clear, fills on current prints". The data is already in hand (the `windowrange.mjs`/
window-line read the doctrine above requires); this rule just forbids a bare number. It
also sets the re-check expectation: a price whose window hasn't arrived yet isn't "not
filling".

**Verify the SELL leg before quoting a profit — MANDATORY, not judgment (Ben, 2026-07-07, the
DHCB overpitch).** Whenever you pitch a dip-bid's or a hold's expected profit off a band top /
optimistic sell, **run `windowrange.mjs --ask <sell target>` first and quote the REACHABLE sell
(the ~50–75%-day reach level), never the raw 2h band top.** The band top is a CANDIDATE (input),
not the pitched number — on a thin + wide-band item it is an artifact that never reaches. This is a
hard checklist step (like `/overnight`'s fill-realism check), because the failure was a *skipped
step*, not a bad call: DHCB's band-top sell 36.21m reached **0/7 days**, I quoted +690–810k off it
without running `--ask`, and the reachable sell was ~35.6m (+80k, which then went underwater). No
edge is real until BOTH legs are verified — the buy (trajectory / dip-vs-knife) AND the sell
(`--ask` reach).

Preserve the standard 10-column
`--positions` table exactly as the script printed it —
`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime | Held@ | Break-even | Verdict`
(that table is app-code canon — see CLAUDE.md "standard output format").

Hard rules — cite, never recompute differently:
- Never list below break-even (tax-capped; the shared `breakEven()` — see CLAUDE.md "Break-even").
- Held fallers ARE shown here with price-to-clear (the screen-exclusion rule's exception).
- Guide = real GE guide price, never the wiki mapping `value` field.

**Reading the `recovery-read` line (V6, `watch.mjs` notes) as decision SUPPORT.** On a non-clean
held lot, `watch.mjs` surfaces `recovery-read: likely recovers|drops|uncertain — <drivers>` — a
COMPOSED lean from the same signals the verdict already used (diurnal · regime/phase · underwater-
persistence · vs structural support). Use it to *prioritise your dig-in*, never as an order: it
decides nothing and never overrides `momVerdict`. The highest-value case is a **conflict** — a green
lot with a drop-lean, or a mechanical cut-trigger with a recover-lean (the 2026-07-06 webweaver:
rising + at support leaned recover where the tripwire leaned cut). Honesty holds: it's a LEAN not a
probability, structural not per-hour, and BLIND to shocks (a `spike` caps it to `uncertain`) — when
it's `uncertain` or conflicts, that's your signal to apply judgment, not to defer to the line.

## 5. Interactive tail (standalone invocations only)

- Ask Ben's **available capital** → size next moves against the action plan (big-ticket
  caution: `BIG_TICKET_GP` = 10m lot value is the whole-lot threshold).
- If cuts free GE slots → **offer `/scan`** to redeploy the capital.
- **Offer the watch loop:** print the ready-to-paste command per MONITORING.md, surfacing
  `watch.mjs`'s own cadence suggestion, e.g. `/loop 2m node pipeline/watch.mjs`.

**Composition note:** when invoked from `/overnight`, SKIP this tail — `/overnight` owns
the pause-for-capital as its phase boundary. The tail is for standalone use.

## 6. Encode learnings (self-improvement — after the market work, never during)

Each run may teach something (a verdict that read wrong, an incidental-lot judgment that
misfired, a threshold that misled). Capture it — but the market work comes first, always.

- **Timing:** _(judgment: process)_ only AFTER the action plan is delivered and Ben's offers are placed/adjusted
  (or he says he's done). Never interleave doc edits with live market work — offers first,
  encoding after (Ben's explicit rule).
- **Prompt:** _(judgment: process)_ at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (a judgment call that
  worked/failed, a threshold that misled, a verdict that read wrong, a workflow gap).
- **Routing — one canonical home per fact, move never copy:** _(judgment: process)_ judgment-layer lessons → this
  SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user preferences →
  Claude memory; monitoring doctrine → `pipeline/MONITORING.md`.
- **Execution:** _(judgment: process)_ spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** _(judgment: process)_ process learnings encode freely; a *market* claim (a
  new threshold, a pattern) needs the usual evidence standard — one session is one sample.
