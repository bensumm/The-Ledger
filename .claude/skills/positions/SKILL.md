---
name: positions
version: 2.0
description: Review Ben's held GE positions against the live market and produce a prioritized cut/list/hold action plan. Triggers — "how are my positions", "check the market against what I hold", "am I underwater", "should I cut/hold anything", "review my holds", "positions".
---

# /positions — held-positions review, verdict interpretation, action plan

The scripts compute and print the read. This file holds the procedure and the judgment no script
prints. `version` bumps on a behavior change; skills never bump `APP_VERSION`.

## 1. Run the read — never hand-fetch

```
node pipeline/commands/quote-items.mjs --positions --verbose
node pipeline/commands/watch-positions.mjs --verbose
```

Run each command alone: no pipe, no redirect, no `;`, and never `node -e` over
`pipeline/.cache/last-report/*.json`. Stdout is the read; never re-derive a number or a verdict.

- **Call 1, always.** _(judgment: procedure)_ It prints the `sync ·` line, the 10-column table, a
  note block per lot, the `Conviction` / `Paths` / `Rebid advisory` blocks, any `Reverse-flip
  pending` block, and LAST the plan lines (one per lot, action-ordered).
- **Call 2 whenever call 1 shows a held lot or the `sync ·` line an open offer.** _(judgment:
  procedure)_ It adds what call 1 cannot print: the alerts (`FADE`, the `[flicker]` tag, `through
  cut-trigger`, `CANCEL-BID`), `listed n/m` or `NOT LISTED` per lot, `support` / `cut-trigger`,
  `recovery-read`, a row per resting offer, and the capital `SUMMARY`.
- **Details on demand, one command each.** A row of the last saved report: `read-rows.mjs` with
  `quote --item "<item>"` (its row and notes; or `watch`; re-run the read when it prints STALE). A lot's history:
  `read-book.mjs --lots --item "<item>"`. Buy limit left: `read-buy-limits.mjs "<item>"`.
- **Freshness is enforced, not remembered.** Both calls sync the book first (`runLocalSync` in
  `pipeline/lib/reconstruct/sync-invoke.mjs`); do not run `sync-fills.mjs` yourself. `held basis
  positions.json last changed Nm ago` is the time since a trade last changed the book. It is not a
  staleness warning. Never infer freshness from elapsed time on a surface that does not sync.
- **A trade Ben made is missing (a lot, an offer, `NOT LISTED`).** _(judgment: source first)_
  Suspect Exchange Logger lag before the book: read the SUMMARY's `offer basis live log, newest
  line Nm ago` (`monitor-offers.mjs` is the zero-lag log view). A relog or world-hop flushes
  RuneLite; then re-run. A phone trade folds in only on
  `sync-fills.mjs --publish`, which runs only when Ben asks.
- **`⚠ stale live print`.** _(judgment: fresh read)_ Never quote a price or a profit off the
  flagged side. Read the fresher side it names and re-run before naming a price.

## 2. What counts as a position

- **Position = held inventory + active GE offers** _(judgment: Ben's definition)_, so with no held
  lots the offer rows of call 2 are the review.
- **Incidental inventory is filtered in code** (`pipeline/commands/quote-items.mjs`: lots under
  `NOISE_OFFER_GP` unless watchlisted, collapsed to one `incidental inventory, ignored:` line). A
  tiny loot lot that still draws a verdict is a bug to report, not a call to make.
- **Personal use is per TRADE, never per item.** _(judgment: Ben-ruled)_ A mention is the
  instruction: `add-manual-fill.mjs --item "<item>" --type withdraw --qty N --time <after the buy>`
  the same turn, re-run call 1, never verdict the lot. Add to `ignored-items.json` only when Ben
  asks for the ignore list by name.
- **The first buy after a `(banked)` close is owned gear.** _(judgment: Ben-ruled, twice)_ Before
  any verdict on a big-ticket open lot, run `read-book.mjs --lots 50 --item "<item>"`. If the lot
  is the FIRST buy after a `(banked)` closed row, it is re-acquired gear: `--type withdraw` it, no
  verdict. If a later row already closed that cycle, the lot is a normal position. Unclear: ask.

## 3. Interpret — the plan lines ARE the action list

Each plan line reads `WORD Item ×qty · list @ X (BE Y) · reason · was PREV`, printed cuts first,
then list/sell, then watch, then holds (`pipeline/lib/render/plan.mjs`). Start from them. Keep the
script's word and price unless a rule below or in §4 changes it. When you change either, write
one line, `overriding: <script's> → <yours> — <rule>`, then how the plan plays out. Never rebuild the case on later passes. Read every lot's note block even when its line is quiet.

- **Vocabulary has one home: `pipeline/MONITORING.md` step 4.** `(X arming ~Nm)`, an `arming`
  reason or a `Conviction … armed` line means X has not confirmed. Armed is not actionable: until confirmed, quote `list @ BE`, name the
  armed price, and re-run after the stated minutes. If no rung clears BE, say so; do not invent
  one. Timing is elapsed time
  (`pipeline/lib/thesis/watchstate.mjs`), so never quote a pass count. A 2h-breakdown `CUT` is
  never delayed. `was PREV` marks a verdict that changed: render that lot in full.
- **A verdict is a prompt, not an order.** _(judgment: per-item dossier)_ Read it against what this
  session already knows about the lot: entry intent, today's range, how the same alert resolved
  before, whether the ask is filling.
- **Override discipline.** _(judgment: the override rule)_ This binds undeclared lots. A declared
  lot above its tripwire follows its plan line, and a 2h-breakdown CUT still prints CUT there.
  Override a CUT or CUT-CANDIDATE only when its alert carries `[flicker]`; an untagged gap is real
  money. Name a concrete structural level in the override line. `through cut-trigger` in the alert
  ends the override that same pass: execute, do not re-argue. A level you named yourself breaks on
  a print about 0.5% through it or one that persists, not on a graze. While overriding, watch the
  clear price: if it decays, step the ask down instead of holding all-or-nothing.
- **Fresh entry.** `WATCH — fresh entry` prints while a lot is under `FRESH_HOURS` old
  (`js/quotecore.js`, CUT-CANDIDATE only). A bare `UNDERWATER` on a just-filled patient buy is
  normal, not a cut signal. A CUT-CANDIDATE past that age is the gate working: overriding it is
  your judgment and is labelled as one. A Gate-2 CUT under 1h old: say fresh, state the entry
  floor; it still stands.
- **Filling ask.** `HOLD — ask filling` prints when the lot's own ask is transacting above the
  clear price (`js/quotecore.js`). Apply the same to a shallow `UNDERWATER`: an ask showing
  `listed n/m` progress above the clear beats repricing down.
- **Falling label is not a veto.** _(judgment: measured, TF2)_ On `crash-risk` or `cooling`, when
  the regime line ends `→ measured cell:`, read the `◇` line under it and any declared plan before
  recommending a cut off the label alone. `mild-cooldown` keeps its full ceiling-slope caution.
- **Read the `⇅ floor/ceiling` line against the verdict.** _(judgment: heuristic, never gates)_
  At the FLOOR and oscillating: price to the swing, do not cut. At the CEILING and cooling: clear.
  Near the ceiling: do not add.
- **Never cut for opportunity cost.** _(judgment: Ben-ruled)_ "Earns more elsewhere" is not a
  reason to cut. A stuck lot is damage control: name the cheapest reliable exit.
- **`recovery-read` ranks where to dig, nothing more.** _(judgment: a lean, not a probability)_ It
  matters most when it conflicts with the verdict or reads `uncertain`: apply judgment then.
- **Resting bids default to LEAVE.** _(judgment: Ben-ruled patience)_ A bid fills only at your
  price. Relay `CANCEL-BID` as an action only on a structural break that held, a chase bid at or
  above live filling into a confirmed fall, or a clearly better home plus a bid unlikely to fill.
  Otherwise report it and wait a pass. Never pitch repricing a stranded bid up to fill: name the
  next dip window and the peak it pairs with (`read-schedule.mjs -c`).
- **A `CROSSING` bid that is not filling.** _(judgment: the gate cannot see limits)_ Run
  `read-buy-limits.mjs "<item>"` before expecting fills or repricing; a spent 4h limit blocks it.
- **Trajectory read for confidence.** _(judgment: diligence scales with size)_ For a big-ticket,
  underwater or marginal hold-vs-cut call only: `read-window-range.mjs "<item>" --window 0-23
  --nights 21`. Name the phase (base, spike, decay). Lows that stopped stepping down at the
  pre-spike base are hold-supportive, and the tripwire becomes a convincing break below that base
  low. A hypothesis from one item, not a pattern.

### Thesis

- **Declare the thesis AT ENTRY.** _(judgment: operating rule)_ Every deliberate diurnal or value
  hold: `declare-thesis.mjs set "<item>" "<plan>" --tripwire <gp> --exit <gp> --window <h-h>
  --until <YYYY-MM-DD> --path <key>`. `--path` with a numeric `--tripwire` is what gates; `--until` alone only
  dates the plan, and the tool refuses a path with neither (`--no-tripwire` to say so on purpose). When a hold you have
  judged keeps drawing a flip-flopping verdict for lack of one, declare it and report in one line.
- **A declared lot is reported in the plan's terms.** _(judgment: Ben-ruled terse)_ Relay the plan
  line's word (`HOLD`, or `HOLD (overrode cut) · abort < Y`) and its price, which is the declared
  exit. Do not re-litigate the gate. Exit, abort and date detail only when asked or changed.
- **`plan expired — reassess` means decide now.** _(judgment: re-decide)_ Re-declare with a new
  date, or drop the plan and follow the machinery verdict. The entry also prunes about 14 days
  after declaration (`pipeline/lib/thesis/holdthesis.mjs`): re-declare mid-hold to extend.
- **`⚠ declared exit X looks STALE`.** _(judgment: inform-only flag)_ Judge whether the premise
  holds. If the peak has moved, re-declare with the new `--exit`.
- **Cadence follows the thesis.** _(judgment: cadence)_ A declared multi-hour hold wants a check
  near its exit window and two or three passes a day. The tight loop is for falling and thin
  big-ticket lots.

## 4. Price the exit and render the plan

### Exit pricing

- **Break-even is the floor.** Never list below the printed BE (`breakEven()` in
  `js/quotecore.js`). Only a CUT-family plan line may carry a lower price.
- **Every price states its basis and its target.** _(judgment: Ben-ruled)_ Write `X (fill-now)` or
  `X (rest-day)`, then the window or mechanism expected to fill it. Take both levels from the lot's
  `⇄ dwell (sell): FILL-NOW @… | REST-DAY @…` line; never recompute them. A price whose window has
  not arrived is not "not filling".
- **Dwell horizon picks the basis.** _(judgment: `/scan` §2 dwell rule)_ Ben at the desk: the
  FILL-NOW edge, and the step-down below. Away or overnight: one REST-DAY rung, when it clears BE.
  Never start a ladder nobody will walk, and never leave a fill-now price to rest unattended.
- **Sell-velocity step-down.** _(judgment: Ben-ruled)_ An ask above the 2h band top that is not
  filling: step to just under the band top. Still not moving after about an hour, or momentum
  flips ↓: step to just above the live instabuy. Show each rung with net per unit and lot P/L.
- **A band top that decays across passes is a step-down trigger now.** _(judgment: bludgeon
  retro)_ Do not wait out the hour. With a measured trough ahead, realize the printing price and
  re-bid the trough.
- **New or test lane: velocity over premium.** _(judgment: Ben-ruled)_ The HOLD default is the
  band top. On an unproven lane list at a level reached most days, take less, and learn the lane.
- **Rising item: do not under-price.** _(judgment: berserker retro)_ With momentum ↑ or a rising
  regime, ask near the band top or hold. Do not step down to a mid-band clear or exit early to
  book the trade; a rebuy pays the tax twice. This applies doubly overnight.
- **`⤴ ask headroom` means ladder up.** The printed `list @` is a floor (`askHeadroomText` in
  `js/quotecore.js`, inform-only): step the ask toward the raw top, never relist down.
- **Fade means price the early exit now.** _(judgment: godsword retro)_ Triggers: a `FADE` alert,
  or `⚠⚠` in the `read-window-range` output. `⚠ fading` with margin still comfortably positive, or
  `⚠ lagging` alone, is a caution: read the daily HIGHS before acting. Highs stepping down toward
  the ask is a trigger too (a rising floor lags and masks it). Price the highest rung recent days
  still reach that clears BE. The alert's `list @` is the model's ask, often just BE, not a
  verified level. Do not anchor at the tail and step down later: the ceiling descends onto the ask.
- **Falling or cooling big-ticket: the certain clear beats the tail.** _(judgment: Ben-ruled,
  falling and cooling only)_ Quote the `every-day` rung of `typical exit` (else `~75%`) that still
  clears BE, not the `~50%` or recent-3 tail. State both nets and recommend the certain clear.
- **An elective small-loss exit is laddered.** _(judgment: godsword retro)_ A cooling lot with no
  confirmed CUT and no tripwire through: one unit near BE and one a rung higher, never the
  instabuy. A single unit takes the near-BE level. A confirmed CUT follows its plan line.
- **Placement tells how greedy a level is.** _(judgment: reading the `↗ window-clear` line)_ p50
  and up is the top of the recent range: fine on an extending peak, wrong on a fader. p15 and
  under clears nearly every day. `recent 0/3` beside a high full count is a stale level. `typical
  exit ~50%` and `Optimistic` are candidates, not the number to quote.
- **A reality clause travels with its level.** `⚠ spike-top …` / `⚠ stale … ~X` (`realityClause` in
  `js/windowread.mjs`) names the typical level and leaves the flagged one unchanged. Relaying the
  price without the clause turns a flagged extreme into a plain list-at.
- **Two peak windows are both real.** _(judgment: Ben-ruled)_ The clause does not print on this
  surface. When exit timing matters, `quote-items.mjs "<item>"` prints `↳ BID … · ASK …`; if it
  appends `also ASK …`, name both windows. Listing into the first and relisting for the second, or
  splitting the lot, is Ben's call.
- **Rungs are levels, not fill rates.** _(judgment: honesty)_ Touched or reached is not filled. The
  footer's class rate bounds a resting ask from above and is never this lot's odds.

### Soft-buy line — adding to a held lot, or a rebid

- **Holding for a later peak is no reason to idle on the buy side.** _(judgment: Ben-ruled)_ Read
  `⏳ soft-buy: floor ~X · live @floor | +X% · <cue>`. To add, rest a bid at the floor level now
  and leave it all day. Dip hours only matter for an attended take; a resting bid is never timed
  to them. `no reliable dip hours` was measured and failed; `dip hours unverified` was not checked.
- **The cue words are a buy-timing vocabulary of their own.** _(judgment: reading
  `SOFT_BUY_CUE_TEXT` in `js/windowread.mjs`)_ Any `▽ caution` (floor breaking, stale uptrend,
  unproven base, exit side fading): do not add on the dip alone. `▲ favorable` is price-trend only
  and blind to game updates. Gear pumps before an update and dumps after, so it is a prompt, never
  a green light.
- **Size inside the buy limit.** _(judgment: Ben-ruled)_ Never suggest more than the regime line's
  `buy limit N/4h (… left)`. A bigger add is stated as windows. A missing limit is not unlimited.
- **Cut-and-rebid.** Read the `Rebid advisory` line (`rebidAdvice` in `js/quotecore.js`), never
  redo its arithmetic. The pair beats holding only when the rebid sits below the clear by more
  than tax plus half the spread; a still-falling item gets no rebid. State both numbers.
- **A deep bid does not fill.** _(judgment: reading reach)_ For an add or a rebid, a level whose
  bid reach reads `recent 0/3` at a deep placement is too deep: name a level recent days touch.

### Verify before you name a price

- **Every price you recommend acting on gets one call.** _(judgment: when to verify)_ A reprice,
  a list, a cut-ladder rung, a rest-day rung: `read-window-range.mjs "<item>" --ask <P> --exit <P>
  --window peak --profile`, this reply. Only an unchanged quiet lot is exempt. The `↗ window-clear`
  line is all-day and scores the declared exit or Optimistic, not your price; `window read
  unavailable` leaves the verdict intact. A skipped check, not a bad call, is the recorded failure.
- **A buy you recommend gets `verify-pick.mjs`** `"<item>@<bid>:<ask>"` in the same turn (add,
  rebid, redeploy). Pitch only a PASS. If nothing passes, say nothing clears.
- **Reading the trio.** _(judgment: interpretation)_ Use the literals `--window peak` / `--window
  dip`, never typed hours; `0-23` scores the whole day. Read the `↳ in-window:` line: an ask above
  the peak's own level is not a window-clear price. Margin is `--exit`'s max buy minus Held@, never
  ask minus cost. Low raw reach alone does not reject a level on a deep book (read `⊙ avg-bound
  read`); on a thin book stay near the centre. `⚠⚠` on the ask is the price-early trigger above.

### Output format

- **Table first, exactly as printed.** _(judgment: Ben-ruled)_ Paste call 1's 10-column table as
  plain markdown, unfenced. Never paste the note block, alert lines or SUMMARY raw: fold what
  changes a decision into your own lines.
- **Then the plan, actionable first.** _(judgment: Ben-ruled)_ Keep the plan lines' order. ONE LINE
  PER ITEM, never two items joined on a line. EVERY line carries `list @ X (BE Y)`: held lots,
  fresh buys, and resting bids (`bid B → if filled list X (BE Y)`).
- **Quiet lots get one line.** _(judgment: Ben-ruled)_ An unchanged on-plan lot is its plan line
  plus basis and target. Only a lot with something to act on (a cut, a changed verdict, a broken
  level, a reprice, a fill, a fade) gets more, and then a few short lines, not paragraphs.
- **End with one short rec line.** _(judgment: Ben-ruled)_ Prices are point-in-time: say so, and
  re-run before Ben places anything minutes later.

## 5. Interactive tail (standalone invocations only)

- Ask Ben's **available capital** and size next moves against the plan (quote the SUMMARY's
  `deployable` figure when call 2 ran). Big-ticket caution applies at `BIG_TICKET_GP` of lot value.
- If cuts free GE slots, offer `/scan` to redeploy.
- Offer the watch loop: relay the SUMMARY's `loop /loop Nm node
  pipeline/commands/watch-positions.mjs` line (cadence doctrine: `pipeline/MONITORING.md`).

**Composition note:** invoked from `/overnight`, skip this tail; its phase boundary owns the
capital pause.

## 6. Encode learnings (after the market work, never during)

- **Offers first, encoding after.** _(judgment: process)_ Once the plan is delivered and Ben's
  offers are placed, ask once whether anything from the run is worth encoding, and propose the
  candidates. One home per fact, moved never copied: a lesson becomes a script output or a test
  first, a line here only for real judgment (bump `version`), a preference goes to memory. Edits
  run in a background subagent. A market claim from one session is one sample.

## Reverse-flip pending (RF4)

`quote-items.mjs --positions` appends a `Reverse-flip pending` block when
`reverse-flip-state.json` holds an open cycle. A sold-first cycle owns no lot, so this block is its
only home here. Relay the facts and stop: no verdict, no rebuy nudge, no timing prompt. Ben
surfaces the rebuy himself. Relay a sync `⚖ short SETTLED` line once.
