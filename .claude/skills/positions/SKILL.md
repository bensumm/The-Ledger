---
name: positions
version: 1.8
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
2026-07-04 — sync is on-demand only). **Sync first:** run `node pipeline/sync-fills.mjs`
before quoting so `positions.json` reflects every logged trade, then run `--positions`
against the fresh file. (`node pipeline/monitor.mjs` shows live exchange-log truth if a
just-made trade matters even more immediately.)

**Position = held inventory + active GE offers** (Ben's definition, 2026-07-04). If
`--positions` prints no open lots, the review isn't done: run `node pipeline/watch.mjs` —
its default pass covers active bids/asks (BID-OK / BID-BEHIND / CROSSING / CANCEL-BID) —
and report the offer set as the position set.

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

Vocabulary = `pipeline/MONITORING.md` step 4 (the PLAN-3 gate tree). The script emitted the
verdict; you translate it into the action line:

| Verdict | Action |
| --- | --- |
| NO-READ | No action — quote basis isn't a price. Keep any ask ≥ break-even; re-check at the next liquid window. |
| DIURNAL-WATCH | Hold ≥ break-even; do NOT cut into a quiet-hour trough that recovered yesterday. |
| SHOCK-WATCH | One-off volume shock, not a bleed — hold one more cycle; cut on a fresh low. |
| CUT | Clear now at the instabuy. This is **controlled loss-taking** — freeing the capital — never "staying ahead of the drop" (MONITORING.md's sell-side framing; you can't outrun a fall by chasing your ask down). |
| LIST-TO-CLEAR | List at the instabuy to clear. |
| HOLD | Stay listed at the 2h top / patient edge. |
| CUT-CANDIDATE | Underwater through a liquid window — persistence, not the clock. List to clear before a bigger loss. |

**Sell-velocity preference (Ben, 2026-07-04):** when a held item's ask sits ABOVE the current 2h band top and isn't filling, don't let it ride — recommend stepping the ask down to just under the band top (the price the market is actually printing), and if it still doesn't move within ~an hour or momentum flips ↓, step again to just above the live instabuy to clear. Moving the item and freeing the capital generally beats the patient premium. The floor is unchanged — never below break-even `ceil(buy/0.98)` (the CUT/CUT-CANDIDATE verdicts remain the only exceptions). Present the rungs with net-per-unit and lot P/L so the velocity/premium trade-off is explicit.

**Decaying-band-top trigger (Ben, 2026-07-04 — the bludgeon retro):** the 2h band top falling across consecutive watch passes while a held item's ask sits above the printing range means the "top" is stale old prints, not live demand — that decay is a step-down trigger in its own right; do NOT wait out the usual hour. And when a measured intraday trough/bounce window lies ahead (per a `windowrange.mjs` window read), prefer realizing the printing price early and re-bidding the trough over holding a stranded premium through it — two small legs beat one stale ask. Break-even floor unchanged.

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
`item · held@ · break-even · verdict · exact action price`. Preserve the standard 10-column
`--positions` table exactly as the script printed it —
`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime | Held@ | Break-even | Verdict`
(that table is app-code canon — see CLAUDE.md "standard output format").

Hard rules — cite, never recompute differently:
- Never list below break-even `ceil(buy/0.98)`.
- Held fallers ARE shown here with price-to-clear (the screen-exclusion rule's exception).
- Guide = real GE guide price, never the wiki mapping `value` field.

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

- **Timing:** only AFTER the action plan is delivered and Ben's offers are placed/adjusted
  (or he says he's done). Never interleave doc edits with live market work — offers first,
  encoding after (Ben's explicit rule).
- **Prompt:** at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (a judgment call that
  worked/failed, a threshold that misled, a verdict that read wrong, a workflow gap).
- **Routing — one canonical home per fact, move never copy:** judgment-layer lessons → this
  SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user preferences →
  Claude memory; monitoring doctrine → `pipeline/MONITORING.md`.
- **Execution:** spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** process learnings encode freely; a *market* claim (a
  new threshold, a pattern) needs the usual evidence standard — one session is one sample.
