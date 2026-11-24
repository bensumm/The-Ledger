# PLAN-LADDERED-STEPDOWN — an unfilled ask steps down in rungs, never straight to the instabuy

Drafted 2026-09-20 (Ben: "a 3 minute sell indicates we could have asked for a little more").
Executor: Fable — harden, take over, fold. Chunk prefix `SD*` (checked free with
`lint-plan-refs.mjs --collisions`). Status: DRAFT — Ben has reviewed the diagnosis live; the chunk
list is the part to harden.

## 1. Context / diagnosis

**What happened (the Magic longbow, 2026-09-20).** 8,000 Magic longbow bought 1,152 (fill-now, a
live dip) on 09-19 ~22:00 PDT; listed 1,197 — the rest-day peak level (recent 3/3, 4/14 full) —
for the 00:00–06:00 peak window. It did not print overnight (instabuy topped at ~1,190). At
`/morning` (09:20) the ask was stepped **straight from 1,197 to 1,186 — the live instabuy**. From
`fills.json`: listed 1,186 at 09:32:44; **5,517 of 8,000 sold by 09:35:54** (three minutes) and the
remainder within the hour. A three-minute clear on an 8k lot against ~930k/d volume means the
market's crossing level was ABOVE 1,186; 1,190–1,192 would very likely have cleared inside the
hour. Cost of the miss ≈ 4–6 gp/u × 8,000 = ~30–50k, on a lap that netted +11/u — i.e. roughly
a third to a half of the realised edge.

**Root cause — the step-down has TWO rungs and nothing between them.**

1. The sell-side pricing surface offers exactly two levels. `quote-items.mjs`'s `⇄ dwell (sell)` line
   (`pipeline/lib/render/emit.mjs formatDwell`, `:325–`) prints `FILL-NOW @<instabuy>` and
   `REST-DAY @<12/14d level>`; the held-lot `sell: list @ X · break-even Y` line
   (`watch-positions.mjs`, MONITORING "What each tick surfaces") prints ONE list-at. When the
   rest-day rung fails, the only other number on the page is the instabuy — so the agent stepped
   to it. On the longbow the rest-day rung (1,150) was BELOW break-even, so the dwell line itself
   said "the BE floor governs" and left only the fill-now number standing.
2. The `/positions` step-down doctrine (SKILL.md, step-down rules: "sell velocity over premium",
   "step down to the printing band", the decaying-band-top trigger) says WHEN to step and names
   the band as the destination, but not the GRANULARITY — it never says "in rungs, with a dwell
   per rung". A jump to the instabuy satisfies the prose.
3. Nothing measures the miss. A sell that clears a large fraction of the lot within minutes of
   listing is the ONE cheap, unambiguous signal that the ask was under the market, and no surface
   flags it — `/morning`, `watch-positions.mjs` and `join-outcomes.mjs` all treat a fast fill as a
   good fill. So the error is invisible unless Ben notices the timestamps, which is how this one
   was caught.

**Anchor:** "the longbow 3-minute clear" (2026-09-20, 1,197 → 1,186, 5,517 units in 3m).

## 2. Rulings (decided / proposed-for-veto)

- **R-SD-1 (decided, Ben 2026-09-20):** a fast clear is evidence of under-pricing, and the
  step-down granularity is the defect — not the decision to step down (velocity over premium
  still stands; 1,197 had failed through the whole window).
- **R-SD-2 (proposed default — veto?):** the rungs come from the 14-day daily-HIGH distribution the
  `--ask` reach read already computes (`js/windowread.mjs` `quantHigh` / `reachedDays` / placement),
  NOT from a fixed gp or % step. Rungs are the levels that PRINT: e.g. the ~75%-of-days level, the
  12/14d level, the 5m-grain instabuy — each carrying its reach `k/Nd` and net/u vs cost.
- **R-SD-3 (proposed default — veto?):** the rung dwell is a NAMED PLACEHOLDER — `STEP_DWELL_MIN`
  30m attended / one window away-hours — and is printed beside each rung. On a LIQUID lot
  (`volDay ≥ LIQUID_FLOOR_PER_DAY`) the ladder applies; on a THIN lot the existing single-step
  doctrine stands (there is no "printing band" to ladder into at 190 u/d).
- **R-SD-4 (proposed default — veto?):** the ladder never goes below break-even. The BE floor stays
  the last rung; a lot whose rungs are all under BE prints the existing "BE floor governs" clause
  and nothing else. The ladder informs; it never gates or places (n≈0 on every rung).
- **R-SD-5 (proposed default — veto?):** the post-hoc `⚡ fast clear` flag fires on a sell campaign
  that clears ≥ `FAST_CLEAR_FRAC` (0.5) of the lot within `FAST_CLEAR_MIN` (10m) of the listing
  timestamp, on a LIQUID item, and prints the gap to the next rung UP that would have printed —
  descriptive, never a verdict. It lands in `/morning` §4's realised-P/L narrative and the watch
  pass's fill-progress line, and is logged so the retro can count it.

## 3. Existing scaffolding (not greenfield)

| Piece | Where | Reused as |
|---|---|---|
| Daily-HIGH distribution, `reachedDays`, placement percentile, recency split | `js/windowread.mjs` (`quantHigh`, `reachedDays`, `recencySplit`) | the rung levels + their reach tokens |
| `--ask` per-day cushion + `fold:` line | `read-window-range.mjs` | the verification read per rung (unchanged) |
| `⇄ dwell (sell)` renderer | `pipeline/lib/render/emit.mjs formatDwell` | grows a `↘ step:` clause between FILL-NOW and REST-DAY |
| Held `sell: list @ X · break-even Y` line | `watch-positions.mjs` V5 emit contract | carries the next rung + its dwell |
| Sell-side step-down doctrine | `.claude/skills/positions/SKILL.md` step-down rules | gets the granularity rule (prose, tagged `judgment:`) |
| `placedTs` on offers, sell fill events with ts | `offers.json`, `fills.json` (FD3/FD4) | the fast-clear measurement input |
| `join-outcomes.mjs --report` velocity section | `pipeline/commands/join-outcomes.mjs` | fast-clear count + gp-left-on-table per week |
| `breakEven()` | `js/quotecore.js` | the last rung, the ONE definition |

Verified absent: any intermediate rung on any sell surface; any fast-clear flag; any log of a
step-down as an event (the `suggestions.jsonl` row records the list-at, not the ladder).

## 4. Target architecture

```
js/windowread.mjs            ← NEW pure fn stepLadder({cost, be, restAsk, instabuy, highs14d, volDay})
                                → { rungs:[{price, reachK, reachN, placement, netU}], dwellMin, thin }
pipeline/lib/render/emit.mjs ← formatDwell renders `↘ step: 1,192 (p71 · 9/14d · +40/u) → 1,188 (12/14d) → 1,186 (fill-now)`
watch-positions.mjs          ← sell: line appends `· next rung 1,192 after ~30m`
pipeline/lib/… (retro)       ← fastClear(sellCampaign) → ⚡ flag; join-outcomes velocity section counts it
.claude/skills/positions     ← granularity rule + relay discipline (judgment:)
```

One home for the ladder arithmetic (`stepLadder`), consumed by both the quote and watch surfaces
so they can never disagree; the renderer owns the string.

## 5. Staged chunks

**SD1 — `stepLadder`, pure + fixture-pinned (foundation).**
Files: `js/windowread.mjs` (new export), `pipeline/test/step-ladder.test.mjs` (new), README inventory.
Rungs = distinct daily-HIGH quantile levels strictly between `restAsk` and `instabuy`, floored at
`be`, deduped to ≥1 gp apart, each with `reachedDays` (full + recent-3), placement and net/u vs cost.
`thin: true` (volDay < floor) → `rungs: []`. Fixtures: the longbow inputs (cost 1,152, BE 1,176,
rest 1,197, instabuy 1,186, the 09-20 14d highs) MUST produce a rung in 1,188–1,192; a thin lot
produces none; all-under-BE produces none; rungs are monotone decreasing and never < BE.

**SD2 — render on both sell surfaces (behaviour, additive).**
Files: `pipeline/lib/render/emit.mjs formatDwell`, `pipeline/commands/quote-items.mjs`,
`pipeline/commands/watch-positions.mjs` (sell line), `pipeline/test/render-golden/*` if present.
The `↘ step:` clause prints only when `rungs.length > 0`; the dwell placeholder prints beside it.
Golden-stdout: every existing line byte-identical; the new clause appended. `check-imports` green.

**SD3 — the post-hoc `⚡ fast clear` flag (measurement).**
Files: a small pure `fastClear()` beside `stepLadder` or in `pipeline/lib/market/`, wired into
`/morning`'s realised narrative source (`positions.json closed` × `fills.json` sell ts) and the
watch fill-progress line; `join-outcomes.mjs --report` velocity section gains
`fast clears: N (≥50% in ≤10m) · median gp/u to next rung up`. Fixture: the longbow campaign
(list 09:32:44, 5,517/8,000 by 09:35:54) flags; a 2h clear does not. Logged into
`suggestions.jsonl`'s outcome join so the retro accrues it.

**SD4 — doctrine + docs reconciliation (prose).**
Files: `.claude/skills/positions/SKILL.md` (granularity rule next to the step-down doctrine,
 tagged `judgment:`, version bump), `/morning` SKILL.md §2 (a reprice-down is a LADDER on a
liquid lot), `pipeline/MONITORING.md` sell-side framing, `docs/MARKET-ANALYSIS.md` "Two objectives,
two prices" (a third row: the RUNG), README entries for the new functions. Grep-and-fix: any line
that says "step down to the instabuy / live" becomes "step down a rung". `lint-skills`/`lint-docs`
green.

## 6. Encoding boundary

| Rule | Disposition |
|---|---|
| Rung levels, reach tokens, BE floor, thin-lot exemption | ENCODE (`stepLadder`, fixtures) |
| Rung dwell (30m attended / one window away) | ENCODE as a named PLACEHOLDER; the VALUE is judgment until SD3 accrues |
| Fast-clear detection + the gp-left-on-table read | ENCODE (`fastClear`, retro count) |
| Whether to take the rung or hold the premium | JUDGMENT — Ben's velocity/attention call; the ladder shows the trade-off, never picks |
| "Never straight to the instabuy on a liquid lot" | PROSE in `/positions` (judgment:) + the rendered rung makes the default visible |

## 7. Bookkeeping & compatibility

- README inventory for `stepLadder`, `fastClear`, the two test files, in their own chunk commits.
- No app change → no `APP_VERSION` bump (unless SD2 touches `js/windowread.mjs` in a way the app
  imports — it does import windowread; an added export is back-compat, note it in the commit).
- `suggestions.jsonl` row shape: additive field only (`ladder`), schema note in
  `pipeline/FILLS-PIPELINE.md` if that file governs the row.
- `check-daemon-safety`, `check-imports`, `lint-docs`, `lint-skills`, `lint-plan-refs` green per chunk.

## 8. Honesty (process rule 4)

The longbow is ONE lot. "1,190–1,192 would have cleared" is inferred from the 3-minute clear and
the 09:00 hour's 1,190 instabuy, not observed. The rung dwell (30m) and the fast-clear thresholds
(50% / 10m) are placeholders; SD3 is what turns them into a measured distribution (how often a
fast clear happens, and the gp gap to the next rung when it does). Nothing here changes a fill
model; the ladder is a display of levels that printed, and `touched ≠ filled` applies to every rung.

## 9. Verification summary

- SD1: fixtures above; the longbow fixture is the acceptance test.
- SD2: golden stdout byte-identical + appended clause; a live `--positions` run on a liquid held
  lot shows the `↘ step:` clause; a thin lot shows none.
- SD3: the 09-20 longbow campaign flags on the real `fills.json`; weekly report prints the count.
- SD4: grep for "to the instabuy" / "to live" in the sell-side doctrine returns only the dated record.
- Adversarial review (rule 10): one pass on whether a rung can ever print BELOW break-even or on a
  thin lot; one pass scoped AWAY — does the `⇄ dwell` change alter any BUY-side line.
