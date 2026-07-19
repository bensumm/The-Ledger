---
name: scan
version: 1.74
description: Screen the GE market for flip opportunities and apply Ben's judgment layer over the rated output. Triggers — "find me flips", "any opportunities", "what should I buy", "screen the market", "anything in <flip-niche>", "scan".
---

# /scan — opportunity screen + the judgment layer over it

Skills-versioning note: `version` here bumps on material behavior change; skills never bump
`APP_VERSION`.

**Paste the raw markdown table verbatim, unfenced (Ben, 2026-07-16).** Include the script's own
printed table(s) in the reply as PLAIN markdown, not just a prose rollup of what changed — and
NOT wrapped in a fenced code block (a code fence forces the client to show literal `|`/`-`
characters instead of rendering an actual table — confirmed live, 2026-07-16). Ben reads the
actual numbers/columns directly. This applies to `screen-flip-niches.mjs` and to
`watch-positions.mjs --dip` when it's driving this skill. The judgment pass (§2) supplements
the table, it doesn't replace it. On a repeated/looped scan where nothing material changed,
it's fine to note that and skip re-pasting — but when there IS something to report, paste the
table, don't just describe it.

**"Verbatim" means the NUMBERS aren't altered — it does NOT mean dumping every dust-tier row
(Ben, 2026-07-19 — reconciles this rule against the standing `actionable-first-dead-last`
memory, which this skipped in practice).** _(judgment: relay discipline)_ A D-grade row with a
few-gp net (Sunfire splinters net 9, Amethyst arrowtips net 27 — real anchor, 2026-07-19) is
noise, not a candidate; pasting the WHOLE script table including its D-grade/BE-floored tail
every pass is what made a reply "unreadable" in practice. **Trim before pasting**: keep every
row that's genuinely gradeable (roughly B- and above, or any row you're about to discuss in the
judgment pass), and collapse the rest into ONE line — `Skipped: N D-grade/BE-floored rows
(negligible net): Item, Item, …` — at the bottom, per `actionable-first-dead-last`. This is a
row-count trim, not a column/number edit — nothing about a KEPT row's numbers changes, and
nothing is silently dropped (the skipped names are still named, just not as full rows).

**Quiet is now the DEFAULT (AO1, default flipped post-review — Ben: an agent must read the JSON dump
for the data, not lean on a stdout summary line, so quiet can't be optional).** A bare
`screen-flip-niches.mjs` run prints one summary line + writes `pipeline/.cache/last-report/screen.json`
(the render-object dump) — read THAT file for the data. **Pass `--verbose` whenever this skill's job is
to paste the table to Ben** (the §1 "paste the raw markdown table" rule above) — without it there is no
table to paste. Bare/quiet is for the agent's own reasoning passes only.

**Relay both surfacing tiers — nothing trimmed speculatively (R10, 2026-07-16).** The render
layer labels every note family a TRACKING tier — `core` (grades/verdicts, alerts, the WATCHLIST,
the fired REJECT/CAUTION footer) and `context` (the inform-only families: diurnal, forecast, ask
headroom, asym fill, window-clear, reach relief, demand). _judgment:_ **both render AND relay by
default** — there is NO default-hidden middle tier, so surface the context footer notes too, don't
drop them to "keep it short." A note family only stops being surfaced once real sessions evidence
it's consistently unused (a future ruling, never a per-pass call). The tier registry lives in
`pipeline/lib/render.mjs`'s header — the ONE registry; don't restate tiers here.

## 1. Run the script — never hand-fetch

```
node pipeline/commands/screen-flip-niches.mjs --verbose [--mode band|churn|scalp|value|all] [--max-price …]
```

`--verbose` is required here since this skill's job is to paste the table to Ben (§ above) — quiet
is now the default (AO1) and without `--verbose` there is no table in stdout to paste.

**`--pressure-exit` is OPT-IN, not default (Ben 2026-07-16 — reverted off the 2026-07-15 early-adopt).**
_(judgment: owner call; mechanic in `js/estimators.mjs` `estimatePair({ pressureExit })`, PB4)_ Run the
NEUTRAL screen (no flag) by default. The trial surfaced real divergence this session (Water orb's
pressure list-at sat ~9% above the neutral number while the item was chopping through a false CUT alert)
— un-calibrated (n≈0) is not just a disclaimer, it moved a real recommendation. Only add `--pressure-exit`
when Ben explicitly asks to compare or price off it; running it just silently skips the publish
write that pass (screen.json / the deployed app stay on the neutral estimator — no error, no flag
juggling needed). The retro keeps shadow-logging both estimates either way.

**Publishing (writing `screen.json`) is now the DEFAULT, every run (Ben, 2026-07-16 — was opt-in
behind `--publish`).** Publishing here means the LOCAL FILE WRITE only — it is NOT a git commit;
committing/pushing `screen.json` to `main` stays a wholly separate, deliberate step (the once-a-day
`/overnight` `sync-fills.mjs --publish` is the only thing that commits it, unrelated to this flag).
So a bare `screen-flip-niches.mjs` run now keeps the local app's Scan tab (and a future git commit,
whenever one happens) current with zero extra step. Use `--no-publish` for a throwaway filtered
console read you don't want left written to disk. `--asym`/`--pressure-exit` still keep screen.json
F1-gated on the neutral estimator — running either just silently skips the write that pass instead
of erroring (only an EXPLICIT `--publish --asym`/`--publish --pressure-exit` combo still hard-refuses,
since that's a real conflict, not an accidental default).

**After the judgment pass (§2), write a short analysis blurb for the app's Scan tab — ALWAYS,
every publishing run (Ben, 2026-07-18 — supersedes the 2026-07-16 "when Ben wants the tab updated"
gate).** `node pipeline/commands/set-scan-analysis.mjs "<html>"` patches repo-root `screen.json`'s
`analysis` field (no re-scan, zero refetch) — it renders at the TOP of the Scan tab, separate from
the tables below it (`#scanAnalysis`). Ben was missing this on the app almost every session because
the step was conditional and kept getting skipped; it is now a mandatory last step of every `/scan`
pass that publishes (i.e. every run except `--no-publish`), not something to remember to offer. This
is the judgment READ over the scan you just ran, written in your own words — not a template, not
auto-generated. Keep it short (a few sentences); `--clear` removes it if it goes stale, and a fresh
`set-scan-analysis.mjs` call on the next pass simply overwrites it — no manual clear needed between
runs. Because publishing is a local file write straight into repo-root `screen.json`, and
`dev-server.mjs`/`serve.cmd` serve that same file same-origin, the analysis reaches the localhost
app the moment it's written — no extra step to "push it to the local server." Skip this ONLY on an
explicit `--no-publish` throwaway console read.

Map Ben's ask to args: flip-niche mode → `--mode` (default `band`); a price cap → `--max-price`;
a keyword/flip-niche ("anything in herbs?") → **no script flag exists** — run the screen and
filter the output rows by flip-niche yourself. The script already gates (two-sided liquidity, price
window, per-spec falling doctrine) and grades (`rating.mjs`); your job is the judgment pass over
what it prints.

**P5 flip-niches — scalp / value (both PROVISIONAL, n≈0).** `--mode scalp` stays OFF-by-default (explicit
`--mode scalp` only); **`--mode value` now RUNS IN `--mode all` by default (Ben 2026-07-10)** — still
console-only (excluded from `screen.json`, no app tab) and provisional, but it surfaces on every default scan.
- **`--mode scalp`** _(judgment: when to chase — desk-presence call)_ — a DELIBERATE intraday flip on a FALLING market (Ben's 2026-07-08 amendment: a
  faller isn't auto-bad). It surfaces ONLY fallers (Step 5, Ben 2026-07-09: a scalp REQUIRES falling — a
  non-falling row is a band flip band already owns → dropped `notFalling`). Flip-only/no-hold, HARD intraday
  stop — an unsold lap is a CUT, not a hold. Judgment: only chase these when actively at the desk;
  never leave a scalp bid unattended (a resting scalp bid keeps its stop only while you watch it).
- **`--mode value`** _(judgment: still PROVISIONAL — don't trade on it yet)_ — buy-hold near a multi-week
  low, hold for the cycle (ONE tax-paid sell of a big move). Its own term-structure table (buy-now vs watch
  tiers, hold horizon stated). CONSOLE-ONLY (no app tab). Every pick is provisional; state the multi-week
  hold horizon at entry. The daily archive is backfilled to ~20d, so this surfaces items now; a
  newly-tracked item with a thin slice still degrades to no-data. **Artifact/liquidity hardening (Ben
  2026-07-09):** `valueGate` rejects an **artifact-low** (live >15% below the durable q15 floor — a broken
  instasell print or a crash mid-fall, the low-side analog of the band artifact-bid; the §F footer counts
  the drops), and the unit-liquidity floor was raised 20→50 (a value hold you can't exit isn't a hold).
  **RC1 recency anchor (same day):** the cycle range is now anchored to the recent 7d, so a stale HIGH from
  a prior regime the item LEFT can't inflate amplitude or make a mid-recovery item read "near the low →
  BUY-NOW" (Contract-of-sensory-clouding was #3 BUY-NOW off a month-old 365k ceiling → correctly WATCH now).
  A `range recency-anchored — durable A→B … recent C→D` note flags it. **Deployable-capital rank (same
  day):** `valueScore` now multiplies in a two-sided **deployable-capital multiplier** — REALIZABLE after-tax
  gp/cycle on the capital you can actually park+exit (`min(capGp/buyLow, vol-share, buy-limit accumulation)`)
  — because the pure-% amplitude score was sweeping the top-N with cheap high-% tabs and hiding the viable
  class (which, per a Fable pool audit, is **mid-amp DEPLOYABLE sub-1m** items like Soiled page / Awakener's
  orb, NOT the illiquid big tickets — there are no big-LIQUID items). The per-position cap is an INPUT: pass
  **`--capital <gp>`** (your current bankroll) **`--slots N`** (concurrent value holds; cap = capital÷slots;
  absent `--capital` the default is the DERIVED `deployablePool` from the cash anchor —
  `lib/derive-cash-tiers.mjs` (free cash + reclaimable DEEP-bid escrow; a near-live flip bid you expect to fill is
  NOT counted as freely redeployable, unlike the older looser `liquidCapital`) — falling back to a 100m
  placeholder only when no anchor is set;
  slots default 5; the footer names which source it used and prints `N buy-now surfaced — re-run --slots N`). The
  default scan now surfaces a real MIX (big tickets + mid-deployable sub-1m + deployable cheap); if you
  expect a specific item and don't see it, it's genuinely gated (illiquid, or a knife) or out-deployed, not
  blindly rank-buried. **Trajectory now GATES in value (Ben 2026-07-09):** a KNIFE is DROPPED (named in the
  §F footer, `dropped N trajectory-knife: …`) — so a falling knife like Inoculation bracelet / Zombie axe no
  longer sits atop BUY-NOW; `elevated` still flags (timing), oscillating/based/rising pass. Still: DON'T pitch
  a value buy off this table blind — **value-amplitude stays inform-only** (a would-caution "live is N% up the
  week range — wait for the dip" is NOT a drop), and every threshold is a PLACEHOLDER (n≈0). Read the `ℹ
  timing/trajectory` notes + the footer drops, and verify the sell-leg reach by hand before quoting profit.

**Flip-niche set (Steps 3+4, 2026-07-09 — Ben's ruling; value added 2026-07-10).** `--mode all` runs **band +
churn + value** (value graduated into the default scan 2026-07-10 — console-only, provisional). **The
`spread` and `rising` flip-niches were DELETED** (this supersedes NY2/NY3's "spread off-by-default,
rising kept"): spread's 24h-*average* edge is structurally narrower than the intraday band and
surfaced ≈0 clean flips once the render net>0 gate landed (its only exclusive lane — thin
big-tickets with an untraded 2h band — is already caught by band's thin path); `rising` ⊆ `band`
(a rising item clears band's gates), and its proxy-first fetch ordering is absorbed into the
screen's small **rising reserve** so risers still aren't buried below flats. **Churn** — the
high-volume commodity lane (the rune staples: soul/blood/death) earns default visibility even
though its per-cycle edge is thin and buy-limit-throttled; judge each rune against its weekly
range (buy the dip, not near the weekly high). Churn ranks the **LAP** (net/u × the exact buy
limit × P ÷ TTF), not the unit — so its rank reflects "buy a whole limit's worth and flip it";
the RANK number separates the runes even though the placeholder letter-cutoffs clump them at S+.
In `--mode all`, churn is disjoint from band by margin (band shows the ROI ≥ min-roi rows; churn
keeps the sub-min-roi high-volume ones). `--mode spread` / `--mode rising` now error cleanly.

**Sync is now CODE-ENFORCED, not just doctrine (SY1 2026-07-15; enforced 2026-07-16).**
`screen-flip-niches.mjs` runs `sync-fills.mjs` unconditionally as its first step now — local/zero-git,
never blocks the screen on failure, prints a one-line `sync ·` summary — so the §5 position-context
pass and the held-item exception both read Ben's current book without a separate manual step. This
closed a real gap: the prose "sync first, always" was skippable and got skipped (an agent — this
one — declared a real closed position "just a bug" mid-session off a stale book; the anglerfish
anchor incident, CHANGELOG 2026-07-16). Phone-trade caveat unchanged: the local sync doesn't ff-pull,
so an un-pulled *phone* trade only folds in at the once-a-day `/overnight` `sync-fills.mjs --publish`;
desktop trades are always captured. When `/scan` runs inside `/overnight`, Phase 1 already synced (and
now the screen syncs again itself regardless — redundant but harmless, both are local/zero-git).

## 2. Judgment pass over the rated rows

This is the tribal layer the script can't do — apply ALL of these:

- **500k gp/day attention floor** _(enforced: `pipeline/commands/screen-flip-niches.mjs` `--min-gpd`)_ (standing rule, memory `gpd-floor-500k`): NOW ENFORCED BY THE
  SCRIPT — `screen-flip-niches.mjs --min-gpd` (default 500_000) drops sub-floor rows pre-rating (S1), so you no
  longer post-filter. Just trust the printed rows and, if Ben wants a different bar, pass `--min-gpd
  <N>`. Thin gp-flow big tickets and held/asked items are floor-exempt by design.
- **SUB-FLOOR FALLBACK tables are NOT qualified picks (P6c).** _(judgment: relay discipline; mechanic in `pipeline/lib/gatecandidates.mjs`)_ If a flip-niche prints `SUB-FLOOR
  FALLBACK` (zero candidates cleared the floors → the script re-ran beneath them and shows the best
  ≤5, grades `C (sub-floor)`-capped), relay it AS sub-floor: name the floor that emptied the flip-niche,
  never present a sub-floor row as a normal recommendation, and default to "nothing qualified today"
  unless Ben explicitly wants to fish below the bar. The bar itself was not lowered.
- **24h-drift is a pre-filter only.** _(judgment: interpretation discipline)_ A current-vs-24h-avg read of "flat/slightly soft"
  repeatedly masks multi-day fallers. The screen's displayed Regime column is the real
  multi-day `regimeDrift` check — trust it, and never recommend off a 24h impression alone.
- **Two-sided liquidity discipline.** _(enforced: `pipeline/lib/gatecandidates.mjs` two-sided gate; the FLOOR is `judgment:`)_ Real liquidity = a two-sided daily market
  (`lowPriceVolume>0 && highPriceVolume>0`), never the `/volumes` count (bursty/weekly, overstates
  tradability). NOTE (PLAN-VOL24, 2026-07-13): Vol/d now comes from the CORRECTED rolling-24h source
  (composed from the `/1h` grain — the raw `/24h` endpoint is broken, it serves a frozen stale ~1–3h
  slice that under-read ~10–27×), and the gate `FLOOR` was recalibrated to that scale (50→3,500). So the
  practical mental floor is a few-thousand limiting-side units/day, not the old deflated ~100; below it
  the juicy "margins" are ghost-spreads (cosmetics, ornament kits — uncrossable). The `--vol-source
  legacy` flag restores the old broken numbers if you need to reproduce a pre-recal read.
- **Tax dominates thin flips.** _(judgment: the >0.5% after-tax bar)_ The 2% tax eats most of a tight spread — need meaningfully
  >~0.5% after-tax to bother. Stable/tight ≠ profitable.
- **Band-is-the-edge pricing.** _(judgment: pricing call)_ For a liquid item with a stable *regime* but a wide
  intraday band, the band IS the edge: ladder buys at band lows / sell at band tops (the
  crystal-teleport-seed lesson — the band beat mid-spread flips ~4:1). Never list below
  break-even; don't chase a softening item's buy.
- **Anchor pricing — sit on the fillable side of a round number / guide (Ben, 2026-07-07).** _(judgment: pricing nudge, n=2)_ A
  shared PSYCHOLOGICAL ANCHOR — a round number (esp. a round million: 16.000m, 17.000m) or the
  CURRENT guide price — clusters orders at it: buyers won't pay OVER it (resistance), sellers won't
  sell UNDER it (support). That leaves a **dead zone just on the wrong side**. So when a
  band/live-justified price lands next to an anchor, **nudge it across to the fillable side**: **asks
  just UNDER** the anchor (10,699, not 10,700+), **bids just OVER** it (16.001m, never 15.997m —
  you'd sit just beneath the seller cluster and catch nothing). Two guards: (1) **nudge, not
  override** — the rule refines a price you already justified off the band/live read; it never sets
  the price alone (if the band says bid 15.5m, bid 15.5m, don't jump to 16m to be "over a round").
  (2) **guide is an anchor ONLY when guide ≈ live** — a STALE/diverged guide (post-reprice, guide
  lagging the live market — Seeking arrow guide 2,832 vs live ~4,800) is NOT the anchor; there the
  round numbers near the LIVE price are. (3) **The nudge only works on a WIDE band — never fill-now-
  cross a TIGHT band (Ben, 2026-07-07, the bones miss).** Crossing to the fillable side means paying up
  by a hair; that's free on a wide band but on a TIGHT band it pays up into your own edge and leaves
  ~nothing. Before nudging a BID up over a round, check there is still meaningful margin from the
  nudged price to the band top; if not, DON'T fill-now-cross — leave the patient band-low bid and wait
  for the dip. (4) **On a LIQUID item a fill-priced bid fills the FULL size FAST** — so a thin-margin
  fill-now bid doesn't leave a small position, it leaves a LARGE one you can't cancel before it fills,
  parked at breakeven. Anchors weigh margin-per-unit AND how much size you're about to lock. Evidence
  (2026-07-07): **sell-side CONFIRMED** — the super-restore ask stalled 5+ passes at 10,713 (above the
  10,700 anchor), then filled promptly at 10,699 once dropped just under it (+108/u, ~+113k). **Buy-side
  CONFIRMED but with the tight-band cost** — a bones bid bumped 2,957→3,001 (just over the 3,000 anchor)
  filled where 2,957 sat dead (anchor logic holds), BUT 3,001 sat near the top of the tight 2,957–3,073
  band so it ate ~26 of the 36gp/u edge, AND all 7,500 filled on 163k/d before it could be cancelled →
  22.5m locked at breakeven. **Honesty (rule 4):** order-clustering microstructure is well-established;
  our fills are n=2 (one each side) — the anchor DIRECTION holds both ways, the tight-band + liquid-
  fills-fast guards are the cost side; keep scoring.
- **Entry aggression follows posture (Ben, 2026-07-05).** _(judgment: posture call)_ When Ben is ACTIVELY flipping
  (at the client, watch loop running), price entries to FILL: recommend bids at or near
  the live instasell — or the upper half of the band — accepting a thinner per-unit edge
  so long as the exit still clears break-even meaningfully (the validated half-chase:
  bludgeon 2026-07-05, +292k). A band-floor bid watching a riser run away costs more in
  missed cycles than the floor discount saves — that day's chin/ring/jaw floor bids never
  filled. When Ben is PASSIVE (walking away / overnight), invert: deep optimistic /
  band-floor bids only, sized for the good payout if hit (`/overnight`'s fill-realism
  check governs), and never leave a near-live chase bid resting unattended — it fills
  into the first dip with nobody watching. State which posture a recommendation assumes.
  **New-lane exception — the FIRST entry into a NEW/unproven item is cautious even when
  actively flipping (Ben, 2026-07-06).** Fill-aggression is *earned* by knowing the lane —
  you've watched its fills and band behavior. On a brand-new item you're buying information
  first, and an instant fill teaches you nothing about whether the price was good. So a first
  entry gets a passive bid BELOW live (price improvement) and/or a smaller starter size, not a
  fill-priced near-live bid. Frame it as a "test with an exit AND a cautious entry." Anchor
  (2026-07-06): a webweaver-bow first entry priced at the band low (= live instasell) filled
  near-instantly, and within ~5 minutes the instabuy dropped 18.51m→18.35m with momentum
  flipping to a 2h breakdown — the adverse-selection cost of a fill-priced first entry,
  materializing in real time.
  **BUT the new-lane caution SCALES DOWN with liquidity (Ben, 2026-07-06 — "risk is just an
  opportunity to learn").** On a HYPER-LIQUID item the deep two-sided pool IS the risk mitigant: a
  fill-priced first entry that goes wrong exits straight back into hundreds of thousands of daily
  units, so the downside is a little tax/spread, not being stranded — the adverse selection that
  burned the *big-ticket* webweaver is cheap on a liquid commodity. So on a liquid lane, **price the
  first entry to FILL (at/near live) and size it fully** rather than sitting at a band-floor bid
  burning cycles — you learn the lane by trading it, and the liquidity is your exit. Reserve the
  cautious below-live / half-size first entry for ILLIQUID or big-ticket lanes where you genuinely
  can't exit cheaply. (Anchor: sitting a snape-grass bid 16 below live while it traded, 2026-07-06 —
  the caution cost cycles the 107k/day liquidity already covered.) The break-even floor and
  real-breakdown cuts are unchanged — this relaxes ENTRY timidity, not the floors. See Claude memory
  `risk-tolerance-lean-in`.
- **Parked-capital leak on mid-liquidity band-floor bids (HYPOTHESIS, 2026-07-06 — YV1
  data, not yet a rule).** _(judgment: unproven lean, F1-gated)_ The first `join-outcomes.mjs --report` capital-efficiency read showed
  **~24% of bids never filled** and that band-low (0–20 pct) **mid-liquidity** buys are the
  slowest to fill (~24m median vs ~9m liquid) — i.e. mid-liquidity band-floor bids are where
  capital gets stranded. So when *actively* flipping, lean toward pricing a mid-liquidity entry
  nearer the live instasell rather than the deep band floor: the missed cycles + stranded gp
  likely cost more than the floor discount saves (the measured-evidence companion to the
  posture rule above). **Honesty (process rule 4):** this is descriptive off ~116 concentrated
  lots (bludgeon 22% of closed), and F1 is still gated — it is a LEAN to test against the
  accruing never-filled-bid count, NOT a hard gate. Liquid items and passive/overnight deep
  band-floor bids are unaffected (there the deep bid is the intended play).
- **Velocity beats magnitude AT CURRENT CAPITAL — but the crossover comes with size (HYPOTHESIS,
  2026-07-06 — Ben's framing, backed by the YV1 record).** _(judgment: unproven lean, crossover unmeasured)_ The measured record so far says
  high-liquidity fast-cyclers have been the most capital-efficient play *by far* at our current
  investment level: a liquid item cycles in minutes for a given % gain, while a mid-liquidity
  big-ticket waits ~half a day for a *similar* % — so the big-ticket's slower lap is pure
  opportunity cost when both return ~the same percentage. **So default the pick toward the liquid
  fast-cycle lane at this capital level** (thin margin × huge volume × fast turns), not the patient
  big-ticket. **The crossover:** as capital grows and you play items whose *absolute* per-unit swings
  are millions (bigger fluctuation magnitude), the patient big-ticket flip's absolute upside outgrows
  the velocity edge — at higher variance/risk. So the velocity preference is REGIME-DEPENDENT on
  position size, not absolute. **Honesty (process rule 4):** this is a lean off a small, concentrated
  record (bludgeon ~21% of closed lots) — the crossover point is unmeasured; track it as sizes climb,
  don't treat it as a fixed rule. Companion to the parked-capital-leak hypothesis above.
- **Band-top artifact detection.** _(judgment: artifact spotting; `--min-traded` supports; Bar E trims at source)_ A single outlier print inflating the band (one lone
  100k print against a 59k mid) makes ROI look absurd. **Bar E (2026-07-10) now trims this at SOURCE on
  BOTH surfacing paths:** `robustBand` takes the p90 high / p10 low on a DENSE band (≥8 prints/side), so a
  lone flier no longer sets the Rank/edge (Scope A) NOR the app-facing Optimistic column (Scope B, 0.55.0
  — the app's `optBuy`/`optSell` are clamped against the robust edges too now) — your manual check is now
  CONFIRMATION, not the primary detector. The ONE residue: a SPARSE side (a thin big ticket, <8 prints)
  keeps the raw extremum, so a flier can still inflate a thin item's edge — those are exactly where you
  still eyeball it (the reach `ℹ` note is the backstop). (The momentum tell deliberately still keys off the
  RAW band max, so a "fresh 2h high" fires on the real extreme, not the p90.)
  Check `--min-traded` traded-windows plausibility when a
  band ROI looks too good. (Bar D, 2026-07-09: the traded-band GATE splits density = `tradedWin` from
  two-sidedness = `sawLow && sawHigh`, so it no longer culls big tickets that trade a few times an hour;
  `--min-active` still works as a back-compat alias for `--min-traded`. Bar D gates the band's REALITY;
  Bar E robustifies its EDGES.)
- **The screen now DOES the windowrange analysis in-script (2026-07-09) — read its `ℹ trajectory/reach`
  notes first.** _(enforced: `js/validate.mjs` trajectory + reach validators, `pipeline/commands/screen-flip-niches.mjs` Leg B)_
  Each surfaced row now carries auto-computed INFORM notes (never a drop, n≈0 rollout): a **reach** note
  covering **BOTH legs** (2026-07-09) — the sell-leg `--ask` reachability AND the buy-leg `bid` touch
  (`reach bid X touched N/14d` — the 2h band min is artifact-prone, and an unreachable bid inflates the
  grade; the Primordial/Nightmare-staff S- catch), each with the RC1 stale bump, off the 1h series
  fetched per survivor — and a
  **trajectory** note classifying the buy-leg shape — **knife** (spike + monotone-down lows → "not a dip",
  the Nightmare-staff catch), **oscillating** (repeating local minima → "buyable at the local min", the
  Hydra case), **based** (flat value-low), **elevated** (bought high). This is the encoded form of the
  manual `windowrange` reads below — so the manual `--ask`/`--window 0-23 --nights 21` step is now a
  CONFIRMATION on the handful you actually pitch, not the primary detector (a `would reject`/`would caution`
  note is the screen telling you what a stricter thesis would have done). Still verify by hand before
  quoting a profit — the notes are inform-only and thresholds are placeholders.
- **The DIURNAL TIMING block auto-derives the peak-timing bid/ask (2026-07-09) — READ IT; it supplies the spike-window exit for WINDOW-CLEAR PRICING below.**
  _(enforced: `js/windowread.mjs` `hourProfile`/`deriveDiurnalRange`, `pipeline/commands/screen-flip-niches.mjs` Diurnal timing block)_
  After the reach notes, `screen-flip-niches.mjs` prints a `Diurnal timing` line per surfaced pick (FREE — off the
  in-hand 1h series): `BID <x> (basis, dip HH–HH) · ASK <y> (peak HH–HH) · ~net/u (roi%)`, with `⚠
  trend-dominates → bid to live` when a multi-day trend erases the intraday dip (the Ghrazi lesson — the
  BID is then priced to live, not to a stale low). A `★` marks a **clean diurnal candidate** (concentrated
  dip+peak, trend-quiet, positive after-tax ≥ min-ROI). This is the ENCODED form of the manual per-item
  windowrange dance below — it caught BOTH the stale-low bids we pitched manually (Virtus, Ghrazi) and
  reorders the shelf (a `★` big-ticket can beat a higher-graded row). Read it FIRST; then `windowrange
  --profile "<item>"` for the full hour-by-hour table on the handful you actually pitch. Honesty: `★`
  doesn't know froth (a spike item's amplitude flatters the roi — cross-check the phase tag), thresholds
  are placeholders, and the funnel-widening pass (running this on gate-EXCLUDED items to test "are we
  hiding winners?") is a planned fast-follow, not yet built — so this reorders SURVIVORS, it doesn't yet
  surface the excluded universe.
- **WINDOW-CLEAR PRICING — the canonical peak-timing step (Ben 2026-07-14; encodes memory
  `peak-timing-default-for-pricing`).** _(judgment: the pricing method every churn/scalp bid+ask routes through; the reach/diurnal/asym reads below are its INPUTS)_
  A churn/scalp lap is a WITHIN-WINDOW round trip — buy the tranche, sell it inside the same 4h
  buy-limit window OR inside the diurnal spike window the ask targets. So **"reaches N/M DAYS" is the
  daily GATE; whether the price prints INSIDE your target window is the FILL** — a level can reach
  12/14 days yet only print in a 2h nightly spike that's already behind you today, at volume that clears
  a tenth of your tranche (the days-reach ≠ lap-clear trap). Price every pick in three moves:
  1. **Name the exit WINDOW.** *4h-lap* (ask at/just under the live instabuy → clears this window, the
     churn default) OR *diurnal-spike* (ask at the peak-window level from the **Diurnal timing** block /
     `read-window-range.mjs --profile` → clears in that window, better margin if you can wait). State which.
  2. **Quote the reachable-IN-WINDOW ask** (RC1 recency-honest; the Asymmetric ask-reach read below
     verifies it) — NEVER the raw band top.
  3. **BACK-SOLVE the buy from that ask** — bid ≤ the price that leaves break-even + your target margin
     UNDER the reachable exit. Run `node pipeline/commands/read-window-range.mjs "<item>" --window <peak
     hours> --exit <ask> [--margin <gp>]` (#9): it prints the tax-exact max profitable buy (`maxBuyForExit`,
     the inverse of `breakEven()`) AND how often that exit actually prints in the window — a low reach means
     the exit over-states the sell, so pick a lower one. The buy is priced BACKWARD from the exit, not
     forward from the band low.
  4. **Project TODAY** — is the window ahead or already printed? (`diurnalForecast` eta / the Hydra
     stale-window rule). A spike window behind you today means price the 4h-lap exit or wait for the next.
  Anchor (2026-07-14, anglerfish): bought 2,735, but to clear the volume you EITHER hold the ask for the
  14:00–17:00 spike (~2,899, prints 3/3 recent) OR clear-in-4h just under live instabuy (~2,815); the
  next rebuy back-solves to ~2,710 (BE ~2,760) so both exits carry real margin. This is the ONE home for
  the peak-timing pricing method — the reach/diurnal/asym reads below FEED it; `/positions` points here
  for the sell-side (step-down) voice. (The tax-exact back-solve is now `read-window-range.mjs --exit`
  above; the mechanical within-window clear-RATE is the shadow-logged `winClear` on
  `screen-flip-niches.mjs`/`quote-items.mjs` — this bullet is the judgment form that routes them.)
- **Asymmetric ask-reach read — the verification gate (2026-07-07, method) — an INPUT to WINDOW-CLEAR PRICING above.** _(judgment: method; tool `pipeline/commands/read-window-range.mjs`)_ The screen's ROI is
  computed off the 2h optimistic band edges, which are often extremes the market never actually
  pays. Before recommending ANY pick, run the `read-window-range.mjs --ask <band-top>` reach check the
  doctrine already requires and read it two ways: **band-top ask reached ~0/7 days = artifact, SKIP**
  (the ROI is an illusion — realistic sells sit below break-even; anchor: Dharok's 4.85m and ruby
  bolts' 3,098 both reached 0/7 while the screen showed +9%/+1.7%). **Band-top ask reached ~7/7 days
  AND live instasell sitting BELOW the item's own recent bid-side window floor = a real dip-buy**
  (you're buying an actual intraday dip at market, fills now, no chase — anchor: super restore, live
  10,377 under the ~10,610 7-day floor with the 10,752 sell reaching 7/7). The tell that separates a
  clean entry from a trap is not the grade or the ROI — it's **where live sits relative to the item's
  own window** (below the floor = dip; at/above an unreachable top = illusion). Honesty (rule 4): the
  METHOD (verify ask-reach before pitching) encodes freely; "dips below the window floor are buys" is
  a hypothesis off one still-open trade, not a proven pattern — keep scoring it.
  - **The reach count is REGIME-contaminated — trust the recency split, not the raw N/M (RC1,
    2026-07-08).** A flat `reached 4/14` / `touched 14/14` count is dominated by stale, older-priced
    days on any item that changed regime inside the window, so it lies in BOTH directions: an **ask**
    on a crashed item reads reachable off pre-crash days (blood rune: 4/14 all pre-crash, recent 0/3);
    a **bid** on a repriced-up item reads reachable off old cheap days the floor has left. `windowrange
    --bid/--ask` now prints the **recent-3-night** hit rate beside the full one and flags **`⚠ stale`**
    when the full count is rosier than recent — when you see `⚠ stale`, DISCOUNT the full count and
    price off the `recent-3 ~50%` quantile instead. It is NOT a looser gate (the band-top-artifact SKIP
    above still stands); it stops the count fooling you on a regime-change item. A stable item never
    flags. Do NOT re-derive a reach number by hand — read the split the script prints.
    - **Above-average is not a warning sign (Finding 3, 2026-07-17; full guard:
      `docs/MARKET-ANALYSIS.md` §4).** RC1 above catches regime contamination on the reach COUNT; a
      separate failure is treating a low raw reach count itself as alarming — "reached" only means the
      1h bucket AVERAGE crossed the level, and pricing an ask above that average is the normal way a
      flip earns money. Judge a level by liquidity (deep book → distrust only near the historical
      extreme; thin book → stay near center), never by the raw N/14 alone. Don't re-reject a Soul-rune-
      shaped case (397-399 filled routinely on ~20+ real lots against a "reached 1/14, recent 0/3" read).
    - **A `⚠ stale` flag on a BID means "don't assert the fill" — price to live instead (Ben,
      2026-07-08, first live save).** The stale flag exists on the bid side precisely to stop you
      claiming a fill the recent regime won't give. When `--bid X` shows `⚠ stale` (recent nights sat
      ABOVE X — the floor repriced up), X is a band-floor extreme recent sellers don't cross down to;
      do NOT pitch it as "fills the dip." Either **bid at/just under the live instasell** (the
      fill-correct level — you give up the hoped-for entry to actually get filled) or call it an
      explicit patient dip-catch that *probably misses* (a fine resting bid, no downside — just don't
      size the plan around it). Anchor: I pitched Hydra leather at its 13.44m 2h-floor (recent 0/3,
      ⚠ stale) as a dip-fill; live instasell was 13.53m, ~90k above the bid — it needed the pullback
      to *deepen*, which recent history argued against. Repriced to 13.50m (near live) to actually
      fill. The reachable-ASK side (3/3 recent) was genuine; it was the bid fill I got ahead of.
    - **A low BAND buy-reach is "patient/deep," NOT "dead" — the Est. buy now PRICES the band low
      (PLAN-ESTIMATOR-POSTURE AC1, 2026-07-18).** The band flip-niche's `Est. buy` no longer folds up toward
      live when its recent touch-reach is low (that fold was collapsing real patient band flips to
      "+1 BE-floored" and reading the board dead). It now prices the band low and CARRIES the fill-signal
      in the cell: `17.30m (0/3 · 9/14 · p93)` = the reach token PLUS a **placement percentile** (`pXX` =
      where that bid sits in the 14-day daily-LOW distribution; a **low pXX = below most daily lows = a
      deep/patient entry**). So a band-low bid with a low recent reach is a rest-it-as-optionality patient
      bid (it fills on the next real dip), NOT a dead row — the Est. net now shows its true patient edge.
      The RANK still discounts it (low bid-reach → low P(fill) → it ranks BELOW an equal-net fill-now flip),
      so a rarely-filling deep bid shows its real edge without out-ranking a printer. **CHURN now behaves
      the SAME (PLAN-ESTIMATOR-POSTURE AC5/AC6, 2026-07-18)** — churn's `Est. buy` AND `Est. sell` are now
      unfolded band-edge prices too (the day-level reach mismeasures a tight symmetric lap; the codebase
      already skipped it for rank + grade). So a churn row's Est. cells carry no reach caution token —
      **read the RANK/GRADE for churn fill risk, not the Est. cell**. This un-floored Super restore(4)-class
      churn rows from `+1 (BE-floored)` to a real net. The reach-FOLD now lives in the VALIDATION step
      (`read-window-range.mjs`'s `fold:` line — the trio below), not the churn discovery price.
  **MANDATORY, both legs — this is a hard step, not a judgment call (Ben, 2026-07-07, the DHCB
  overpitch).** A dip-bid has TWO legs to verify and it is easy to do only one: the BUY (trajectory /
  dip-vs-knife) AND the SELL (the `--ask` reach). **Before quoting ANY dip-bid's expected profit, run
  `read-window-range.mjs --ask <sell target>` (the verification TRIO below) — the RUN stays mandatory;
  what changed is the INTERPRETATION of the result.** Read it the liquidity-conditioned, placement-informed
  way — a low raw reach count is NOT by itself grounds to reject a level (see the "Above-average is not a
  warning sign" bullet above; full doctrine `docs/MARKET-ANALYSIS.md` §4, don't restate it here). Judge the
  sell level by LIQUIDITY and its placement percentile, not the raw N/14: on a deep/liquid book the upper
  tail is fine — distrust only a level at/near the historical extreme (≈p100); on a thin book stay near
  center. This session the old "step down to the ~50–75%-day reach level, never above" rule produced TWO
  false "won't clear" reads on liquid items (soul rune, dragon bones) that then cleared at the higher price.
  The raw `Optimistic`/`Rank` band top remains a CANDIDATE, not the pitched number — on a thin + wide-band
  item it is an artifact that never reaches — but on a liquid book do not reflexively step it down. (PLAN-OUTPUT-TABLE 2026-07-13 + revisions: the
  screen's DEFAULT table now renders the reach-folded `Est. sell` — the fold (on the RECENT-3 reach) already
  collapses a mirage top and the cell carries its recent reach token (`0/3`, full window beside it on
  divergence) — but it is a PLACEHOLDER model, so the `--ask` confirmation on what you actually pitch STAYS
  mandatory; `--raw` shows the unfolded pair.) No pitch without the sell leg verified. Anchor: DHCB surfaced top-of-board (score 2.24m/d) and I verified the BUY (21-night
  trajectory = a healthy recovery) but carried the band-top sell 36.21m forward UNVERIFIED and quoted
  +690–810k; `--ask 36.21m` reached **0/7 days**, the reachable sell was ~35.6m, and the real trade was
  +80k that then went underwater. The band top is a fine CANDIDATE (input); it is never the pitched
  profit until `--ask` confirms the reach. (Decided against re-scoring the screen off a reachable sell:
  the cheap ts6h proxy understates reach → false negatives that HIDE good sells, worse than the
  problem; run `--ask` on the handful you actually pitch instead — accurate + cheap.)
  - **The verification TRIO — mandatory for every top pick, ONE combined call, every time (Ben,
    2026-07-18 — supersedes "run `--profile` on the handful you actually pitch" being optional;
    revised same day once `--profile` was fixed to COMPOSE with `--ask`/`--bid`/`--exit`/`--depth`
    instead of short-circuiting the rest of the per-item read).**
    The sell-leg-only rule above is the FLOOR, not the whole bundle. Before naming a bid/ask on
    anything you're about to recommend, run ONE `read-window-range.mjs` call bundling all three
    checks — cheap (no new fetch beyond the archive), each catching a different failure mode
    already seen this session:
    ```
    node pipeline/commands/read-window-range.mjs "<item>" --ask <sell> --bid <buy> --exit <ask> --window <hours> --profile --json --out pipeline/.cache/last-report/verify.json
    ```
    1. **`--ask <sell>` / `--bid <buy>` (percentile + reach, AC4a).** Read both numbers printed,
       not just the day-count: `reached N/14d · recent M/3 · placement pXX of the 14-day daily-
       HIGH/LOW distribution`. A level can have solid N/14 reach and still be an aggressive ask if
       its placement percentile is high (near the top of the distribution) — the percentile is
       what the raw reach count hides.
    2. **`--exit <ask> [--window <hours>] [--margin <gp>]` (tax-exact back-solve).** Gives the real
       breakeven BUY for that sell (`maxBuyForExit`, already tax-net) — margin is this value MINUS
       the actual bid, never a raw ask-minus-bid subtraction (the Tormented synapse correction,
       2026-07-17: a naive subtraction on an already-tax-net value overstated margin ~4x, and part
       of the "safe" bid range actually crossed into a loss).
    3. **`--profile` (hour-by-hour diurnal sweep).** Don't stop at the auto Diurnal-timing line —
       pull the full 24-row hour-of-day table and read the printed DIP/PEAK windows + amplitude/
       trend yourself before stating a timing target. Same underlying data as the auto-note, full
       resolution, so "targets the 20:00–21:00 dip" is backed by the actual numbers, not a
       summarized guess.
    Each scored `--ask`/`--bid`/`--exit` also prints a **`fold:` data-point line** (PLAN-ESTIMATOR-POSTURE
    AC8): `best-case ask X → reach-folded Y (recent a/b · full c/d) · net at folded pair …`. This is where
    the reach-fold moved — discovery shows best-case, validation shows what the estimator's fold makes of
    the level you're about to pitch. Read both numbers: a big gap between best-case and folded = a
    stale-top mirage. Inform-only, a PLACEHOLDER — never gates; `--niche churn` shows churn's exempt fold
    (≈ best-case). None of these move the grade or the gate tree — they're the confirmation pass on the
    specific number about to get said out loud. Skipping one is exactly the DHCB/Tormented-synapse failure
    shape: the tool existed, wasn't run, and the pitched number was wrong in a way it would have
    caught. **Dump it with `--out`** for any candidate `/scan` is elevating — a top pick per
    flip-niche, or one specifically pitched in the analysis blurb — so `set-scan-analysis.mjs` and
    `/positions`' deep-dive step can read `pipeline/.cache/last-report/verify.json` instead of
    re-running the checks by hand or re-deriving the numbers.
  - **Tranche-size-as-%-of-daily-volume is the variable that predicts when the reach-relief
    premium collapses (2026-07-17, real-fill evidence, n≈6 items).** `reachRelief`
    (`js/estimators.mjs`) softens the ask-reach fold on the theory that a position small vs daily
    flow can clear at an elevated price — but it currently conditions on `sizeRatio` at the
    THRESHOLDS already in that module (`REACH_RELIEF_SIZE_FULL`/`REACH_RELIEF_SIZE_ZERO`), not on
    a validated real-fill curve. Cross-referencing positions.json `closed` lots against fills.json
    for Soul rune, Blood rune, Prayer potion(4), Super restore(4), Ruby dragon bolts (e), and Raw
    anglerfish found a rough knee: **below ~0.5% of daily volume** a tranche reliably clears close
    to the best available price (Blood rune 25k/lap ≈0.28%, Soul rune 25k/lap ≈0.56% — both clean
    across every tested lot); **~0.7–1%** already shows visible degradation (Prayer potion(4)
    1,799 units ≈0.71% sold 8,684 vs ~8,744 on same-day tiny ladder-top lots; Super restore(4)
    1,044 units ≈0.71% sold 10,698 vs ~10,774); **by ~5–7%** the premium is gone and you're pricing
    near the bulk-clearing level (Raw anglerfish 9,890 units ≈6.6% sold 2,449 vs 2,480–2,498 on
    tiny same-day lots — a NET LOSS after tax despite nominally selling above the buy). Raw
    anglerfish's own full buy limit (15,000 units) is ~10.4% of its daily volume — structurally
    oversized for its own liquidity depth, not just an unlucky trade. This is the real-data
    explanation for why `--pressure-exit` (`js/estimators.mjs` `estimatePair`) was found too
    optimistic this session (Water orb) and stays opt-in/`--publish`-refused: the theory
    (small clips get better prices) is directionally right, and `reachRelief` DOES scale the
    effect down by size (it conditions on `sizeRatio`) — but its full-relief threshold
    (`REACH_RELIEF_SIZE_FULL` = 2% of daily flow) sits ABOVE the measured degradation knee
    (~0.5–1%), so it grants full relief across a mid-size range that the real fills show already
    degrading — i.e. it OVER-CREDITS mid-size positions rather than not scaling at all.
    HONESTY (rule 4): n≈6 items, same-session, real fills but not a controlled experiment — a
    rough knee-in-the-curve observation, not a calibrated threshold; don't hardcode 0.5%/1%/5% as
    gates off this alone. Full numbers live here; `js/estimators.mjs`'s `reachRelief` header
    carries a one-line pointer, don't duplicate.
- **Fresh-repricer flag.** _(judgment: sizing call)_ A large multi-day regime move = the item was recently repriced
  → overnight-retrace risk. Size small; skip for unattended holds.
- **Phase tag on the Regime cell (2026-07-06).** `screen-flip-niches.mjs` annotates each Regime cell with a
  trajectory phase from the shared `phase()` (off the same 6h series, zero extra fetch): `spike`
  (elevated over its own base), `decay` (pulled back from a recent peak with lows STILL stepping
  down — a falling knife), or `basing` (decayed back to the pre-spike base with lows FLATTENED —
  a possible base-buy). It's a read aid, not a gate. **A `spike` tag is NOT automatically "about
  to retrace" (Ben, 2026-07-06).** The Tier-1 tag can't tell froth from a genuine reprice: `spike`
  covers BOTH the frothy-about-to-retrace case (DWH) AND a real reprice UP to a new sustained
  higher level (webweaver: base ~15.7m repriced to ~18m, with recent daily LOWS *rising*/higher-lows,
  not decaying). So treat a `spike` on an item you're considering as a PROMPT to run the full
  `/positions` "trajectory read for confidence" (`read-window-range.mjs --window 0-23 --nights 21`,
  phase-mapped) and read the recent-low trend: RISING higher-lows = a healthy reprice (holdable);
  lows flattening/falling from a recent peak = the froth-retrace case (size-small/skip). A `basing`
  tag is likewise the prompt to run that same trajectory read before committing. Honesty (process
  rule 4): the webweaver reprice is one item of evidence.
  `--phase-rescue` (OFF by default) is a gated trial that surfaces a `basing` faller the
  falling-exclusion would otherwise drop (grade-capped B, flagged provisional) — turn it on only to
  trial base-buy candidates, and treat its picks as unproven (thresholds are placeholders, one item
  of evidence). Honesty rule (process rule 4): the classifier is new and unvalidated.
- **Froth entry — the check is a CLASSIFIER, not a PREDICTOR (2026-07-07, method).** _(judgment: method, n≈0 froth trades)_ When tempted
  to trade a spike ("catch the froth window"), run the froth-entry diligence — the 21-night full-day
  trajectory (`read-window-range.mjs "<item>" --window 0-23 --nights 21`) read for the **lows-trend + volume**
  — but be clear about what it can and cannot do. It tells you, for a move ALREADY UNDERWAY, whether
  it's the good kind or a knife: **spike + rising-then-holding lows + solid/rising volume = a healthy
  reprice to a new sustained base** (ride/dabble-able off that base, with a hard tripwire below the new
  base low), vs **spike + FALLING lows = distribution/knife** (never enter). What it CANNOT do is
  predict the IGNITION: the explosive first leg fires out of a flat-or-soft base driven by an EXOGENOUS
  catalyst (meta shift, update, news) that is not in the price history, and volume typically rises WITH
  the spike, not ahead of it — so there is no leading price/volume signal for the launch. Anchor
  (2026-07-07): webweaver bow exploded 07-01 (14.3m→19.7m) out of a flat base whose lows were slightly
  FALLING the day before — nothing on 06-30 forecast it; the check would only have flagged it (correctly,
  as holding-lows) on 07-02, after the leg. **The strategic consequence:** froth trading here is "ride
  the healthy moves already in motion and dodge the knives," NOT "catch the explosion" (unforecastable
  with price-history tools). Two more guards carry over: a big-ticket spike (webweaver ~18m/unit) is NOT
  dabble-sized — a genuine SMALL froth experiment needs a CHEAP holding-lows spike where 2–4m buys a
  survivable position; and every froth entry pre-commits a mechanical exit (first pass of falling lows /
  momentum ↓ = exit, no averaging down). Honesty (rule 4): n≈0 froth trades of our own — this is
  data-gathering with a capped downside, not a proven edge.
- **Big-ticket caution.** _(judgment: sizing; gp-flow gate in `pipeline/commands/screen-flip-niches.mjs`)_ High per-unit capital → each fill is expensive; require real
  gp-flow (units × net), not a unit count. The script now SURFACES these via the gp-flow gate,
  flagged `thin` and capped at grade A- with a "~N/day — size in units, expect slow fills" tooltip
  (S1). Treat a `thin` row honestly: the edge is real but you can only place a few units/day, fills
  are slow, and its wide band can be a thin-trading artifact — size in units, never chase.
  For a big-ticket price SUGGESTION where you want confidence in the entry / where the item is
  heading, run the same full-day multi-week trajectory read — `/positions` "trajectory read for
  confidence on a marginal/big-ticket hold" (`read-window-range.mjs --window 0-23 --nights 21`,
  phase-mapped). Point to it; don't copy the method here.
- **A "crowded out: N (best excluded: X)" footer line means a real edge lost its fetch slot — read
  it, don't skip past it (PLAN-SCREEN-ARCHITECTURE, 2026-07-18).** _(judgment: relay discipline; mechanic in `pipeline/lib/admission.mjs` `pickFetchPool`)_
  The fetch pool is bounded (API-fetch cost) — only so many gated candidates get priced each pass.
  Since the anchor incident (Abyssal bludgeon / Sanguinesti staff never surfacing despite real
  profitable history — the raw-gp-flow-ranked thin reserve was silently starving them out every
  single pass), the DEFAULT admission path ranks the thin/big-ticket lane on real after-tax edge
  instead of raw turnover, rotates in starved candidates on a bounded exploration reserve, and
  reports every excluded candidate with a reason instead of dropping it silently. When you see this
  line, name the best-excluded item to Ben if it's genuinely close — that's the whole point of the
  line existing. `--admission legacy` restores the old raw-gp-flow reserve (rollback/comparison
  only, never the default). Full diagnosis + design: `PLAN-SCREEN-ARCHITECTURE.md`.
- **"Skip despite high grade."** Grade cutoffs are placeholders (`rating.mjs`); a good
  letter on a ghost-spread / thin / tax-eaten row is still a skip — say why in one line.
- **Lane management — scale what's printing, rotate what's stalling (v1.8, 2026-07-05,
  Ben's framing).** _(judgment: exposure call)_ Read the current book's recent lanes before pitching new picks: an
  item that has closed several profitable laps TODAY is a live, validated edge — the
  default recommendation is to **increase exposure there to test the theory** (up to the
  buy limit / concentration comfort), not to spread into a fresh unproven pick of similar
  grade. Conversely, a lane that is REALLY SLOW (capital parked, asks not filling across
  multiple windows — the jaw) is a rotation prompt: say explicitly "this lane is stalling,
  look elsewhere" and offer the redeploy. Frame both as *tests with an exit* (one day of
  laps is one sample — process rule 4); the buy limit is usually the binding constraint,
  so state it on the line.
- **Peak-throughput sizing — decide "one-window clear" vs "multi-day roll" AT ENTRY (Ben,
  2026-07-07, the nest retro).** _(judgment: sizing labeling discipline)_ Before building an accumulation position, read the **"median
  window instabuy volume"** line the `--ask` sell-leg verify already prints (the pool your ask
  competes for in the sell window — no new fetch). Size so your position is a realistic **share
  (~10–20%)** of that pool for a **one-window clear** — you compete with other sellers, so you
  won't take the whole pool. If the position is bigger than that share, it is a **multi-day roll
  by definition**: SAY SO at entry and price the ask for the multi-day horizon — don't discover
  the ceiling when the peak fades and the stack strands underwater. Anchor: a nest accumulation
  of 2,622 (+3.6k bid) against ~28k window-instabuy was ~10% (clearable in a window), but we
  never STATED the horizon, so a faded evening peak read as a problem instead of the plan — the
  position was fine, the *unlabeled* horizon wasn't. **Honesty (rule 4):** the ~10–20% share is a
  sizing sanity-check, not a formula; it's a labeling discipline (call the roll horizon at entry),
  never a hard cap.
- **Buy-limit-aware sizing — NEVER suggest a quantity over the 4h GE limit (Ben, 2026-07-08).**
  _(code-pointer: `pipeline/lib/limits.mjs` `limitWindow` + `js/validate.mjs` `limitValidator`; ask =
  `node pipeline/commands/read-buy-limits.mjs "<item>"`)_ Every accumulation/tranche suggestion is CAPPED by the item's
  GE buy limit (`quote-items.mjs` prints it as `· buy limit N/4h`; also in the mapping — look it up before
  sizing). A "tranche" is ONE window's worth = **≤ limit units**; a position bigger than the limit is a
  **multi-window accumulation by definition** — state the per-window cap, the gp it represents, and how
  many 4h windows it takes (e.g. "11k darts = ~2.0m/window; 44k = 4 windows ≈ 16h"). Do NOT pitch a
  single-tranche size that silently exceeds the limit (the anchor: I suggested "~45–55k amethyst darts"
  against an 11k/4h limit — that's 4+ windows, not a tranche). This is now ENCODED on every suggesting
  surface (LM1): the rolling-4h `limitWindow` math is fed to the BUY-side `limitValidator`, which
  **REJECTs** (screen drops it, quote/held/watchlist note it) a buy whose window is exhausted and
  **CAUTIONs** one nearly spent — and `quote-items.mjs`'s regime line appends `(bought X this window — Y
  left, next frees ~HH:MM)` when there are in-window logged buys. Two follow-ons the numbers already do
  for you: (1) **if the item was already bought today, the limit is partially/fully consumed** — run
  `node pipeline/commands/read-buy-limits.mjs "<item>"` (reads `fills.json`, no fetch) for bought/remaining + the local
  `next frees ~HH:MM` / `fully resets ~HH:MM`; size the REMAINING headroom, not the full limit. HONEST
  LIMIT: only RuneLite-logged fills are visible, so a mobile/unlogged buy is invisible — "left" is an
  UPPER bound, not a guarantee. (2) **a null/untracked limit ≠ unlimited** — the validator DEGRADES to
  pass on a null limit (never green-lights it); flag it and size conservatively off volume.
- **A thin CURRENT 2h band ≠ no edge — read the recent DAILY range on a proven lane (Ben,
  2026-07-08).** _(judgment: read call; tool `pipeline/commands/read-window-range.mjs`)_ The screen's band is the last-2h window; it looks THIN precisely when live sits at
  the top or bottom of the item's wider daily range. Do NOT dismiss a known/proven lane (one you've
  flipped before) off the thin 2h band — run the full-day `read-window-range.mjs --window 0-23` and read
  the **recent daily lows→highs** (the band you actually flip over), recency-verified per RC1. Bid
  the recent daily-LOW zone, sell the recent daily-HIGH zone. If live isn't at the low right now,
  it's a **patient dip-bid** (rest it, it fills on the next daily dip), not a fill-now — say which.
  Anchor: I skipped Berserker ring as "thin band" off its 3.11–3.23m 2h window, but its recent daily
  range is ~2.93m→3.165m (both recent 3/3) = a real +5.9% band-flip; live was just near the daily top
  (3.11m), so it was a patient dip-bid at 2.93m, not "no edge."

## 3. Hard rules (cited from CLAUDE.md's table contract — don't restate, don't violate)

- Falling handling is PER-STRATEGY, not global (Ben's 2026-07-08 amendment; P5 — memory
  `falling-exclusion-amended`, encoded in `js/flip-niches.mjs` `spec.falling`). The `band`/`churn`
  flip-niches EXCLUDE fallers silently (`falling: 'exclude'`) — for those, never re-add
  or mention a falling row. But `--mode scalp` ACCEPTS fallers (a deliberate intraday flip expects a
  falling wide band) and `--mode value` KNIFE-GUARDS (rejects a decay knife, accepts a flat/basing
  value-low) — do NOT call a scalp/value faller a mistake; the spec surfaced it on purpose. Exception
  for the EXCLUDE flip-niches: items Ben holds, explicitly asks about, or **watchlists** → always show,
  with price-to-clear.
- **Watchlist section (S3): always report, honestly.** The script appends a Watchlist table (from
  repo-root `watchlist.json`) that is exempt from every floor/gate; each row carries a Note saying
  what a gate would have hidden (below-floor / thin / one-sided / falling). Never silently drop a
  watchlist row and never hype one past its read — surface it with its Note and one honest line.
  Falling watchlist items appear here with the falling warning (they're excluded from the flip-niches).
- Preserve the standard table columns exactly as printed (app-code canon).

## 4. Output

The judgment-filtered shortlist, one-line rationale per pick (why this edge is real), plus
a note of how many candidates the 500k floor eliminated. If a high-grade row was skipped,
point at it and give the reason — that's the layer this skill exists for.

**Cover every flip-niche each pass — "no dips" is NOT a complete scan (Ben, 2026-07-07).** A
recurring scan (esp. inside a watch loop) drifts narrow: one salient sub-task — the dip-hunt
— quietly becomes the *only* thing evaluated, and the broader mandate (candidates for the
dry/committed capital) silently collapses to "nothing." The fix is structural, not
willpower: the report must give an **explicit one-line read on EACH flip-niche every pass** —
`Dips · Band big-tickets · Churn` — even when the answer is "nothing, because X".
A slot you must fill can't be silently dropped (same principle as the ONE-LINE-PER-ITEM and
recent-reach rules — make the output enforce the coverage). "No dips" ends the *dip* line,
never the scan. Anchor (2026-07-07): several watch-loop passes reported only "no new dips"
while band big-tickets (bludgeon/sang/tassets class) went unmentioned for an hour — Ben had
to ask "are we looking at other flip-niches?"; the miss was omission, not a bad call.

**Every recommended price states its timing target (Ben, 2026-07-05):** a pick's bid and
sell are each "X, targeting Y" — bind the number to the window/mechanism expected to fill
it (e.g. "bid 17.00m — tonight's 18:00–23:00 trough, projected 16.8–17.0m" / "sell 17.55m —
the 23:00–03:00 UK-morning lift, reached 7/7d"; a churn item's target can simply be "normal
daily churn"). Run the time-of-day `read-window-range.mjs` read the CLAUDE.md doctrine already
requires and quote it — never a bare number.

## 5. Position-context pass (Ben, 2026-07-05) — read the shortlist against the current book

A scan is not done until the picks are compared against where Ben's capital already sits.
After the shortlist, run `node pipeline/commands/watch-positions.mjs` (positions = held inventory + every
active offer) and close the loop:

- **Stale-bid displacement.** _(judgment: redeploy call)_ For each resting BUY offer, ask: does a shortlist pick offer
  a better expected edge than what that parked capital is waiting on? A bid that's
  BID-BEHIND with the floor rising away is a candidate to cancel and redeploy into a pick —
  say so explicitly with the two edges side by side.
- **Overlap check.** _(judgment: concentration call)_ If a pick is something Ben already holds or bids, say that on the
  pick's line (don't recommend doubling a position blind — buy-limit and concentration
  both bite).
- **Held-ask sanity.** _(judgment: cross-check)_ If a shortlist item's read contradicts a current ask's premise
  (e.g. the scan shows its band breaking down while Ben's ask rides the old top), flag it —
  that's the `/positions` step-down doctrine firing from the scan side.

This is a lightweight cross-check, not a full `/positions` review — don't re-verdict every
lot; only surface lines where the scan changes what an existing position should do. When
`/scan` runs inside `/overnight`, skip this pass (Phase 1 already resolved the book).

## 6. Encode learnings (self-improvement — after the market work, never during)

Each run may teach something (a judgment filter that misfired, a threshold that misled, a
band-artifact that fooled the grade). Capture it — but the shortlist comes first, always.

- **Timing:** _(judgment: process)_ only AFTER the shortlist is delivered and Ben's offers are placed/adjusted
  (or he says he's done). Never interleave doc edits with live market work — offers first,
  encoding after (Ben's explicit rule).
- **Prompt:** _(judgment: process)_ at that point ask one short question — "anything from this run worth
  encoding?" — and propose the candidates this run surfaced (a judgment call that
  worked/failed, a threshold that misled, a screen that hid/hyped a real edge, a gap).
- **Routing — one canonical home per fact, move never copy:** _(judgment: process)_ judgment-layer lessons → this
  SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user preferences →
  Claude memory; monitoring doctrine → `pipeline/MONITORING.md`.
- **Execution:** _(judgment: process)_ spawn a **background subagent** to make the edits + commit so this
  conversation keeps flowing; report the diff summary when it lands.
- **Honesty guard (process rule 4):** _(judgment: process)_ process learnings encode freely; a *market* claim (a
  new threshold, a pattern) needs the usual evidence standard — one session is one sample.
