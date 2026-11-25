---
name: scan
version: 4.1
description: Screen the GE market for flip opportunities and apply Ben's judgment layer over the rated output. Triggers — "find me flips", "any opportunities", "what should I buy", "screen the market", "anything in <flip-niche>", "scan".
---

# /scan — opportunity screen + the judgment layer over it

`version` bumps on a material behavior change; skills never bump `APP_VERSION`.

## Procedure — follow top to bottom

1. **Scan** (§1): one `screen-flip-niches.mjs --digest` call, output read whole.
2. **Sweep** (§2 B): `verify-pick.mjs --scan`. It verifies the digest rows, every churn row and the
   band rows at the screen's own pair. The digest is not the candidate list: its rows can all
   fail while rows outside it pass.
3. **Price** the survivors only, for the stated dwell horizon (§2 A): one `quote-items.mjs` call.
4. **Re-verify** each survivor at the exact bid and ask you will quote, same turn (§2 B). Only a
   PASS at the quoted pair is pitched.
5. **Book** (§5): `quote-items.mjs --positions` every pass; `watch-positions.mjs` only when a pick passed.
6. **Reply** (§4): digest, picks, one rec line, one line per flip-niche.
7. **Learnings** (§6).

`read-rows.mjs` answers anything else about the scan (§1). Never `node -e` over a dump.

Scripts already do, so do not redo or restate: the local sync, every gate and floor, the winners
filter, per-window sizing, crowded-out detection, the change line against the last scan, lane coverage.

## 1. Run the script — never hand-fetch

```
node pipeline/commands/screen-flip-niches.mjs --digest --mode all [--capital <gp> --slots N] [--posture overnight] [--max-price <gp>] [--min-gpd <gp>] [--hold-days 7]
```

- Run it bare from the repo root with a long timeout. **No `| head`, no `| tail`, no `cd … &&`**:
  the output is short and the size, lane and coverage lines print last. If you must keep it, redirect
  to a scratch file and Read the file.
- A general ask runs `--mode all` (band + churn + amplitude). A named lane runs `--mode
  band|churn|amplitude|scalp|value` (`invest` = value). Scalp and value run only when named.
- "Anything in herbs?" has no flag: scan, then `read-rows.mjs screen --item "<word>"`.
- `--capital` is a session budget Ben states; without it the pool is the derived deployable figure.
  `--max-price` only narrows; big tickets need no flag. `--posture overnight` comes from `/overnight`.
- Not on a common pass: `--verbose` (one lane's table, only when Ben asks for that lane), `--full`
  (debugging render), `--no-publish` (throwaway read that must not touch `screen.json`), and the
  trial or rollback flags `--phase-rescue`, `--admission legacy`, `--vol-source legacy`, `--raw`.
- Rows under the 250k gp/day attention floor are already dropped. `--min-gpd` only when Ben wants
  another bar.

**What prints, and how to read it**

| Line | Read it as |
| --- | --- |
| `## DECISION DIGEST` table | Triage order by `rank` = net × P(fill) ÷ TTF. Wallet-free: a row's position says nothing about size. Held items are left out. |
| `capEff`, `deploy` | Sizing context only. `deploy` is a 2-day parkable figure and can span several buy-limit windows: never quote it as a buy size. |
| `reach` | Recent ask-reach fraction and its basis (`r3`, `14d`, `sg`). `—` = not scored for this lane, not zero. |
| `phase` | Sell-cycle clock. `post-peak` = the peak closed today: smaller entry, labelled hold-to-next-peak (blowpipe 8/8 bought into a closing peak, 5 stranded ~16h). |
| `soft-buy` | Buy-side clock. `@floor` / `+X%` = where live sits against the dip floor, **not an instruction to delay**: a resting bid goes in at the floor level now; dip hours are for an attended take. `▲ favorable` is a prompt. Any `▽ caution` on an `@floor` row means it is not a discount until you have read why (floor breaking = knife; exit side fading = floor of a fading day). |
| `verdict` | A triage word (`fill-now`, `mirage top`, `weak deploy`, `starter / hold-to-next-peak`, `spread closed now`, `low-conviction`), never an order and never a verification. Ignore `fill-now` on an amplitude row. |
| `per-item notes` | `↕` ask-reach decay, `◇` dislocation. Relay an item's notes with its row. A `◇` measured-yield line stands even on a falling-labelled item. `◇ elevated` is a caution, never a credit. |
| `size per 4h window` | The buy size: units and gp for ONE window, what binds (`limit` / `capital`), `xNw` windows to fill the deploy column, `~N clear` = a price-quality knee (bigger predicts a worse net, not a stuck offer). `limit unknown` and `PLACEHOLDER capital` are printed when true: say so. |
| `<lane>: N shown · N rejected · N crowded out` | A `⚠ X beats digest row Y (… never fetched)` tail is a real edge that lost its fetch slot: name X on that lane's line and quote it if capital needs a home. |
| `Δ vs Nm ago` | Change against the last same-scope scan. `no change` on a looped scan: say so and skip the digest. |
| `coverage:` | Every lane has a slot (`NOT RUN` if it did not run). Source for the per-lane lines in §4. `Dips N added / M watched` is a count: the names are in repo-root `dip-watchlist.json`, watched live by `watch-positions.mjs --dip`. |

**Rows — `read-rows.mjs`, offline, reads the dump the scan just wrote**

```
node pipeline/commands/read-rows.mjs screen --digest [--item "<name>"]     # numeric: bid, ask, netEach, be, limit, units, gp, windows, bound, clear, prev
node pipeline/commands/read-rows.mjs screen --item "<name>" [--mode band]   # its row in any lane (amplitude and watchlist too) and its note lines
node pipeline/commands/read-rows.mjs screen --drops [--item "<name>"]       # rejects by reason, winners-filtered, crowded out; with --item, why that item is gone
node pipeline/commands/read-rows.mjs screen --list                          # lanes and exact column names
```

- `--cols` takes the printed header names (`Est. buy`, `Net/u`, `Grade`), not field names. Check the
  age line: `STALE` means re-run the scan, not the reader.
- A read that is absent from stdout is in the dump, never "no data". An expected item that is missing:
  `--drops --item "<name>"` before saying it has no edge.

**Cell tokens in a lane row**

- `Est. buy 17.30m (0/3 · 9/14 · p93)` = recent reach · full reach · placement in the 14-day daily-low
  distribution. A low recent reach on a band-low bid is a patient bid, not a dead row; the rank
  already discounts it.
- `⚠ dip ~L prints r/n — buy +P above (≥ the whole net)`: the buy pays more over the dip than the flip earns.
- `Est. sell … reach-fold floored to BE … · patient: deep-bid … → ask … net +N/u`: the two halves
  disagree on purpose. Relay both; the floored half alone once dismissed a ~1.4m trade.
- Churn Est. cells carry no reach token: read Rank and Grade for fill risk. `⚠ exemption dropped — …
  rank X (was Y)`: relay both numbers.
- `↻ repriced entry`: the quoted bid is dead and the row's honest form is a live-entry flip. An
  option, not a pick; never quote its net without its reach token.
- `P~0.00 (bid leg)` and `P(ask)~` answer different questions. `(thin)` = the fill call rests on few
  observations. `C (sub-floor)` = not a qualified pick.
- Regime phase tag: `spike`, `decay` (lows still stepping down = knife), `basing`. Probes: `⚓` = the
  round-number nudge is already in the price.
- `◆ asym fill` (quotes): quantile levels, not fill rates. Relay the whole clause and its class-rate
  footer; a level worth resting at, not a trade to plan a day around, least of all on a big ticket.

**Lanes that need a caveat every time** (their own header and footer lines carry the measurements)

- **Amplitude is inform-only, never a pick.** _(judgment: lane handling; lane lines in `screen-flip-niches.mjs`)_
  A multi-day lane: name its top row on the Amplitude line with its `round-trip X/Y = Z%` figure,
  relayed as "the ask reprinted after entry X of Y times", an upper bound. `—` = unmeasured, not 0%.
  State the unit reality (a few units a day, no fast exit). It sizes against the whole pool,
  `--slots` ignored; `--hold-days 7` is the weekly-oscillator run. Leave `--amp-ask-q/--amp-bid-q`
  alone. Anchor: Saturated heart A- on the prior, D on a measured 0 of 37.
- **Scalp is desk-only.** _(judgment: desk-presence call)_ A deliberate intraday flip on a faller with
  a hard intraday stop; an unsold lap is a cut. Never leave a scalp bid unattended.
- **Value is provisional.** _(judgment: do not trade off it blind)_ State the multi-week hold at entry.
  A knife is demoted to WATCH, not dropped: relay the `demoted … trajectory-knife` line. Your own
  knowledge of a game update overrides the pooled read.
- **Churn ranks the lap, not the unit.** _(judgment: read call)_ Judge each staple against its weekly
  range: buy the dip, not near the weekly high.

**Publish.** Every run writes repo-root `screen.json` (a local file, never a commit). The Scan-tab
blurb (`set-scan-analysis.mjs`) is written only when Ben asks for it.

**Sync.** The scan syncs the book itself (local, zero git) and prints nothing about it when quiet. A
phone trade is not in the book until Ben asks for `sync-fills.mjs --publish`.

## 2. Judgment pass over the rated rows

### A. Price the survivors

For the rows the sweep (B) passed, and only those, get fresh levels in one call:

```
node pipeline/commands/quote-items.mjs "<A>" "<B>" --dwell=attended|away|overnight --verbose
```

Read its `⇄ dwell` line (FILL-NOW pair and REST-DAY pair), `buy limit` clause, and any `⚠ stale live
print`. Price at the dwell pair for the stated horizon, then re-verify at that pair (B). A screen
estimate that passed may be pitched as it stands, labelled `(screen est.)` with how long it will rest.

- **Entry AND exit aggression follow the DWELL HORIZON.** _(judgment: horizon call; the comparison is `formatDwell` in `pipeline/lib/render/emit.mjs`)_
  State the horizon every recommendation assumes; if Ben has not said how long he is away, ask before
  sizing a big-ticket tilt.
  - **attended** (at the client): both legs at the live edges, the FILL-NOW pair, thin edge accepted
    while the exit clears break-even meaningfully (bludgeon half-chase, +292k).
  - **away-hours (~2–8h) and overnight**: BOTH legs off the REST-DAY pair, never the live edges. A
    resting ask at the live instabuy gives the day away (Marlin 3,885). A level with a `⚠` reality
    clause goes to Ben with the clause, or priced at the typical level the clause names.
  - Fill-now is per-time profit, rest-day is per-flip; neither is wrong, undeclared is wrong.
  - **New lane**: the first entry into an unproven ILLIQUID or big-ticket item is a passive bid below
    live and/or a starter size (webweaver: filled at live, instabuy fell 160k in five minutes). On a
    hyper-liquid item the caution is dropped: price to fill and size fully, the liquidity is the exit.
- **WINDOW-CLEAR PRICING.** _(judgment: the pricing method; back-solve is `maxBuyForExit` in `js/quotecore.js`)_
  "Reaches N/M days" is the daily gate; printing inside your window is the fill. (1) Name the exit
  window: *4h-lap* (ask at or just under live instabuy) or *diurnal-spike* (the peak-window level).
  (2) Quote the ask that is reachable in that window, never the raw band top. (3) Price the buy
  backward from that ask, not forward from the band low. (4) Is the window ahead today or already
  printed? Behind you: price the 4h-lap exit or name the next window. Anchor: anglerfish, 2,899 in the
  14:00–17:00 spike or ~2,815 inside 4h.
- **Name the window, not a chase bid.** _(judgment: Ben 2026-08-04)_ Never answer a stranded or deep
  bid with "raise it so it fills". Give the next buy-dip window and the sell-peak it pairs with
  (`node pipeline/commands/read-schedule.mjs -c`), preferring a pair that fits one sitting.
- **Band is the edge.** _(judgment: pricing call)_ On a liquid item with a stable regime and a wide
  intraday band, ladder buys at band lows and sell band tops (crystal teleport seed, ~4:1 over
  mid-spread flips). Never list below break-even. Never chase a softening item's buy.
- **Tax dominates thin flips.** _(judgment: the after-tax bar)_ Under roughly 0.5% after tax is not
  worth a slot. Stable and tight is not profitable.
- **Anchor pricing.** _(judgment: pricing nudge, n=2; the nudge itself is `pipeline/probes/anchor.mjs`)_
  Asks sit just under a round number, bids just over it. Guards the probe cannot see: it refines a
  price the band already justified, never sets one; the guide counts as an anchor only when guide ≈
  live; never cross a TIGHT band to get over a round (bones: 3,001 ate 26 of 36 gp/u and all 7,500
  filled before a cancel); on a sell ladder, rungs straddle the round million, with nothing parked
  just over it and under the real daily-high prints (blowpipe 11.098m stalled).
- **A flagged level travels with its clause.** _(judgment: relay discipline; renderer is `realityClause` in `js/windowread.mjs`)_
  `⚠ spike-top` / `⚠ stale` never reprice the level. Quote the typical level it names, or carry the
  clause beside the number.
- **Diurnal timing line.** _(judgment: read discipline; rendered by `formatTimedLap` in `pipeline/lib/render/emit.mjs`)_
  `timed` (trough→peak) and `same-hour` nets can disagree hard on a big ticket: relay both. "Levels
  only — no reliable hours" is the normal case: use the level, treat hours as a bonus. The `tranche …
  clean · … price-knee` segment is a round-trip price-quality knee, never a quantity Ben cannot clear;
  a one-leg sell is bounded by `peak-pool` (two sapling sells cleared 4x the knee). `also ASK/BID`
  = a second window: surface both, because a slot freed in window one can relist for window two.
  `⚠ trend-dominates → bid to live` means the multi-day trend erased the dip.

### B. Verify — `verify-pick.mjs`, twice: the sweep, then the pair you will quote

```
node pipeline/commands/verify-pick.mjs --scan [N]                                  # after the scan
node pipeline/commands/verify-pick.mjs "<A>@<bid>:<ask>@<lane>" "<B>@…" --why     # after pricing
```

`--scan` reads the dump the scan just wrote: the digest rows, every churn row and the band rows (N = top N only)
by net × units per window, each at the screen's pair and judged for its own lane. It prints one line
per PASS (a PASS carrying warnings is marked) and others by reason. The second form runs
the fresh trio at your prices; `@churn` judges a churn lap with the churn fold. `--why` adds the live
prints and their age, max profitable buy, the peak window and its level, the fold, the floor/ceiling
track, and each rule's result.

- **Only a PASS at the quoted pair is pitched.** _(judgment: Ben 2026-09-21; the rules are `RULES` in `pipeline/commands/verify-pick.mjs`)_
  A PASS is not a fill guarantee. Paste its line as printed. Re-recommending on a later pass means
  re-running it; a dump row or an earlier run is not validation (495 chinchompas bought off a stale row).
- **"Nothing clears today" only after `--scan`.** _(judgment: Ben 2026-09-21)_ Never from the digest
  rows alone, and never lower the bar to produce a pick.
- **Read the floor/ceiling track before pitching a PASS.** _(judgment: read call; the line is `formatFloorCeiling` in `js/windowread.mjs`)_
  Price falling into the bid, or live pinned at the ceiling, outranks a clean reach count. The label
  is a prompt; the per-day lows and highs are the signal.
- **NOT NOW.** _(judgment: what to do next)_ Drop the row silently. You may re-price ONCE from the
  failure's own numbers (bid above max profitable buy → bid at or under it) and re-verify at the new
  exact prices. Never soften it into a caveat. It means the pair, not the
  item. An ask rarely reached in-window fails on any book.
- **UNKNOWN is never pitched.** _(judgment: what to do next)_ `--why` names the missing read. A stale
  live print is "unverified, re-check later": re-quoting does not refresh a print. Say "unverified"
  on its lane line.
- **Warnings do not change the status; each changes the pitch.** _(judgment: one line each; they are `WARN_RULES` in `pipeline/commands/verify-pick.mjs`)_
  - `market pulling away from the bid`: the bid is unlikely to fill today. A deep REST-DAY PASS
    carrying it is a patient bid, not a plan; never claim the fill.
  - `ask … above the peak window's level`: re-verify with the ask at that level. If that is under
    break-even, or the ask's recent split is 0/3, it is not a pick.
  - `reach ⚠ stale`: the full count is rosier than the recent days. Trust the recent split. On a bid
    it means "do not assert the fill" (Hydra leather 13.44m, recent 0/3, live 90k above).
  - `bid touched on 0/N recent days and live … above it`: a deep resting bid. Fine as optionality,
    never the plan.
  - `no buy limit listed (not unlimited)`: size conservatively off volume and say the limit is unknown.
- **Depth softens a low BID count, nothing else.** _(judgment: read call; the deep-book clause is `avgBoundRead` in `js/windowread.mjs`)_
  On a deep book a bare low touch count or recent split on the bid is not a reject (ruby dragon bolts
  skipped off `touched 0/14` on a 349k/d book). On a thin book stay near the centre. An ask at the
  extreme of its distribution (the `pXX` on the quote's `⊙ reach/placement` line) or a band top that
  reached about 0 of 7 days is an artifact on any book (Dharok's, ruby bolts).
- **Margin is max-buy minus bid, never ask minus bid.** _(judgment: arithmetic discipline; `maxBuyForExit` in `js/quotecore.js`)_
  The Tormented synapse subtraction overstated margin about 4x.
- **A deeper look is the same tool, not a script of your own.** _(judgment: tool `pipeline/commands/read-window-range.mjs`)_
  `--window peak|dip` literals, never hand-typed hours (`0-23` is all-day, and all-day reach once
  hid a peak window reading 0/3). `--hourly --days 3` answers "is it stepping down by the hour".
  `--window 0-23 --nights 21` is the multi-week trajectory for a spike, a `basing` tag or a
  big-ticket entry.

### C. Size and capital

- **Buy-limit-aware sizing.** _(code-pointer: `sizeDigestRow` in `pipeline/lib/render/digest-extras.mjs`, `limitWindow` in `pipeline/lib/capital/limits.mjs`)_
  Never suggest a quantity over the 4h limit. Quote the size line: units and gp per window, and when
  the position is bigger, the number of windows ("11k darts ≈ 2.0m a window; 44k = 4 windows ≈ 16h").
  A pick outside the digest: `node pipeline/commands/read-book.mjs --size "<item>"`; reset time:
  `read-buy-limits.mjs "<item>"`. "Left" is an upper bound: an unlogged mobile buy is invisible.
- **Sizes do not add up by themselves.** _(judgment: capital call; figures from `pipeline/commands/read-book.mjs`)_
  Each row is sized against the whole pool alone. With more than one pick, sum them and cap the
  total at the free capital `read-book.mjs` prints, after checking its restart-suspect bid flag.
- **One-window clear or multi-day roll, said at entry.** _(judgment: labeling discipline)_ A position
  near 10–20% of the sell window's instabuy pool (`peak-pool` on the quote's timing line) can clear
  in one window; bigger is a multi-day roll
  and the ask is priced for that horizon (the nest stack was fine, its unlabelled horizon was not).
- **Tranche against day volume.** _(judgment: n≈6 same-session fills, a rough knee)_ Under about 0.5%
  of day volume clears near the best price, ~1% shows degradation, 5–7% sells at the bulk level
  (anglerfish: a full limit is ~10% of its volume, sold at a net loss).
- **Velocity vs magnitude.** _(judgment: Ben's lean; crossover unmeasured, big-ticket n=1)_ Churn and
  big-ticket return about the same per gp, so the choice is fuss against tail risk: churn is liquid
  but needs presence; a big ticket is set-and-forget but cannot exit a crash. Lean big-ticket where
  the sell is verified reachable, sized to what can sit through a crash. Short and present → more
  churn; long and hands-off → big-ticket. Churn capacity tops out near 150–200m a window.
- **`weak deploy`.** _(judgment: sizing read; flag is `weakDeploy` in `pipeline/commands/screen-flip-niches.mjs`)_
  A big-ticket single turn under about 0.5% per turn is rarely worth the parked capital (Magus +160k
  on 50m cancelled; blowpipe ~1.1% clears on margin).
- **Lane management.** _(judgment: exposure call)_ An item that closed several profitable laps today
  is a validated edge: scale it toward the buy limit before spreading into an unproven pick of similar
  grade. A lane whose asks have not filled across several windows is a rotation prompt: say so and
  offer the redeploy. Both are tests with an exit.
- **Parked-capital leak (hypothesis).** _(judgment: unproven lean off ~116 concentrated lots)_ When
  attended, price a MID-liquidity entry nearer live than the deep band floor; about a quarter of
  bids never filled and those were the slowest.
- **Deployable capital is shown, not modelled.** _(judgment: Ben 2026-07-26; composition from `pipeline/lib/capital/derive-cash-tiers.mjs`)_
  If the figure is wrong fix the source: `derive-cash.mjs <amount>` re-anchors, a manual-log
  correction clears a phantom bid. `⚠ restart-suspect bid(s)` means verify in-game before sizing.

### D. Fast rules for falling, froth and catalysts

- **Falling is per-strategy.** _(judgment: Ben 2026-07-08; spec in `js/flip-niches.mjs`)_ A faller is
  not automatically a bad buy, and band/churn hiding it is a lane rule, not a verdict.
- **`decay`, `▽ floor breaking`, or daily highs stepping down is a prompt, not a refusal.** _(judgment: Ben 2026-09-08; tool `pipeline/commands/read-trajectory.mjs`)_
  Buy the floor, and quote the ceiling slope against the planned hold: a ceiling falling faster than
  the margin over that hold is the reason to pass.
- **Game updates.** _(judgment: Ben 2026-07-22)_ Combat and PvM gear rises into an update and dumps
  after it. The post-update `@floor · buy now` is a knife the dip signals misread: on that gear only,
  no dip-buy until the floor/ceiling track reads ranging. When Ben flags an update as imminent or
  just shipped: no new big-ticket gear entries, sell held gear into the pump, rotate to commodities
  and seeds (fang −1.44m held through the 07-20 dump).
- **`spike` is a prompt, not "about to retrace".** _(judgment: one item of evidence; classifier is `phase` in `js/quotecore.js`)_
  Rising higher-lows on solid volume = a healthy reprice, holdable off the new base with a tripwire
  under it (webweaver). A spike with falling lows: never enter.
- **Elevated is a caution, never a credit.** _(judgment: Ben 2026-07-23)_ An `elevated` trajectory
  note, a base position at p90 or higher, or a `◇ elevated` line warns about the entry level. None
  of them says the item was bought well or will hold.
- **Froth is classified, never predicted.** _(judgment: method, n≈0 own trades)_ The launch comes from
  outside the price history. Ride healthy moves already in motion, dodge the knives, keep a froth
  experiment cheap (2–4m, not a big-ticket unit), pre-commit the exit, never average down.
- **Fresh repricer.** _(judgment: sizing call)_ A large multi-day regime move carries overnight
  retrace risk: size small, skip for an unattended hold.
- **24h drift is a pre-filter only.** _(judgment: interpretation discipline)_ The Regime column is the
  multi-day read. Never recommend off a 24h impression.
- **Size scales diligence.** _(judgment: Ben 2026-07-02)_ A position above an hour or two of the
  item's volume is an inventory bet: confirm the multi-day trend first (dragon nails).

### E. Reading rows honestly

- **Net decides, not grade.** _(judgment: Ben 2026-09-03; the render filter is `dropAccounting` in `pipeline/commands/screen-flip-niches.mjs`)_
  A row can grade S+ on a displayed net that is negative. A good letter on a ghost-spread, thin or
  tax-eaten row is a silent skip.
- **Held and watchlist rows print regardless of net.** _(judgment: relay discipline)_ A negative net
  there is a position or watch signal. Never shortlist it as a pick.
- **`SUB-FLOOR FALLBACK` is not a pick list.** _(judgment: relay discipline; mechanic in `pipeline/lib/signal/gatecandidates.mjs`)_
  Name the floor that emptied the lane and default to "nothing qualified today".
- **Ghost spreads.** _(judgment: the floor; the two-sided gate is in `pipeline/lib/signal/gatecandidates.mjs`)_
  Below a few thousand limiting-side units a day the juicy margin is uncrossable (cosmetics,
  ornament kits).
- **Band-top artifacts.** _(judgment: artifact spotting; dense bands are trimmed by `robustBand` in `js/quotecore.js`)_
  A thin big ticket with a sparse side keeps its raw extreme: one lone print can still set the edge.
  Eyeball those.
- **Big-ticket rows.** _(judgment: sizing)_ `thin` and the A- cap mean a few units a day and slow
  fills. Size in units, never chase.
- **A thin current 2h band is not "no edge" on a proven lane.** _(judgment: read call; tool `pipeline/commands/read-window-range.mjs`)_
  Read the recent daily lows→highs. Live near the daily top makes it a patient dip-bid: say which
  (Berserker ring skipped as thin on a +5.9% daily band).
- **`watch-reserve-full` is not a lost edge.** _(judgment: diagnosis; `pickFetchPool` in `pipeline/lib/signal/admission.mjs`)_
  That item is still in the Watchlist section.

## 3. Hard rules

- **Falling handling by lane.** _(code-pointer: `spec.falling` in `js/flip-niches.mjs`)_ Band and churn
  leave fallers out silently: never re-add or mention one, except an item Ben holds or asks about,
  which always shows with a price-to-clear. Scalp requires a faller. A faller on the scalp or value
  board was surfaced on purpose. A falling WATCHLIST item is not exempt: it appears only in the
  Watchlist section.
- **Watchlist section: always report, honestly.** _(judgment: relay discipline; list is `watchlist.json`)_
  Each row's Note says what a gate would have hidden. Never drop a row, never hype one past its read.
- **Tables as printed.** _(judgment: app-code canon)_ When a lane table is pasted because Ben asked,
  paste it unfenced with columns and numbers unaltered.

## 4. Output

Order by what Ben can act on now, not by the script's order.

1. **Digest table**, verbatim and unfenced, with the per-item notes of rows you discuss. Skip it on
   a looped pass where `Δ` says no change.
2. **Picks — rows that PASS at the quoted pair, one line each.** The verify-pick line, then: basis and target for each
   leg, size, horizon. Shape:
   `Item (lane) · bid X (rest-day) — tonight's 18:00–23:00 trough · sell Y (rest-day, reached 7/7d) — 23:00–03:00 lift · +net/u · BE Z · 1,200u ≈ 28m a window (limit, 0 bought) · away ~8h`
3. **One rec line.**
4. **One line per flip-niche, every pass**: `Dips · Band big-tickets · Churn · Amplitude`, from the
   `coverage:` and lane lines (Amplitude: its top row and round-trip figure), even when the answer is "nothing, because X". "No dips" ends the dip
   line, never the scan. Lanes with nothing actionable sit at the bottom.
5. **Book lines** only where §5 found something.

- **Every price states its basis and its timing target.** _(judgment: Ben 2026-07-05, basis 2026-09-10)_
  `(fill-now)` or `(rest-day)` is the column of the `⇄ dwell` line the price came from, quoted, never
  recomputed; a price taken from the scan row is `(screen est.)`. Each is bound to the window or
  mechanism expected to fill it. A churn target can be "(fill-now) normal daily churn".
- **Winners only.** _(judgment: Ben 2026-09-02)_ No "what failed and why", no drop counts, no gate
  chatter. If Ben asks about an item you passed on, answer then.
- **Shape.** _(judgment: Ben's display)_ Numbers in a tight table or one line per item; no prose in
  table cells; never two items on one line; every item line carries `list @ X (BE Y)`.
- **Prices are point-in-time.** _(judgment: Ben 2026-07-06)_ Say so; re-quote before he places if a
  pass or several minutes have gone by.

## 5. Position-context pass

Skip inside `/overnight` (Phase 1 resolved the book) and while a `run-loop.mjs` watch is running.

- **Every pass.** _(judgment: session-local relay; plan lines from `pipeline/lib/render/plan.mjs`)_
  `node pipeline/commands/quote-items.mjs --positions` prints one plan line per held lot. Relay a
  line only when its verdict changed since your last look this session, or a pick contradicts it.
- **Only when a pick passed.** _(judgment: redeploy call)_ `node
  pipeline/commands/watch-positions.mjs` (offer verdicts; `read-rows.mjs watch` for rows) and
  `read-book.mjs` (slots, free and reclaimable capital). A resting BUY that is `BID-BEHIND` with the
  floor moving away is a cancel-and-redeploy candidate: show the two edges side by side.
- **Overlap.** _(judgment: concentration call)_ A pick Ben already holds or bids says so on its line;
  never double a position blind. `read-book.mjs --lots --item "<item>"` shows what he did with it.
- **Held-ask sanity.** _(judgment: cross-check)_ If the scan shows a band breaking down under one of
  Ben's asks, flag it for `/positions`. Do not re-verdict every lot here.

## 6. Encode learnings — after the market work, never during

- **Timing and prompt.** _(judgment: process)_ Only after the shortlist is delivered and offers are
  placed, ask once: "anything from this run worth encoding?" and propose what the run surfaced.
- **Routing.** _(judgment: process)_ One home per fact, move never copy. Prefer a test or script
  output over prose; judgment that stays prose goes here (bump `version:`), preferences to memory,
  monitoring doctrine to `pipeline/MONITORING.md`. A background subagent makes the edit.
- **Evidence.** _(judgment: process)_ Process lessons encode freely; a market claim from one session
  is one sample.
