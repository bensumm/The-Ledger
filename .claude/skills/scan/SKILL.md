---
name: scan
version: 1.29
description: Screen the GE market for flip opportunities and apply Ben's judgment layer over the rated output. Triggers — "find me flips", "any opportunities", "what should I buy", "screen the market", "anything in <niche>", "scan".
---

# /scan — opportunity screen + the judgment layer over it

Skills-versioning note: `version` here bumps on material behavior change; skills never bump
`APP_VERSION`.

## 1. Run the script — never hand-fetch

```
node pipeline/screen.mjs [--mode band|spread|rising|churn|scalp|value|all] [--max-price …] [--publish]
```

Map Ben's ask to args: niche mode → `--mode` (default `band`); a price cap → `--max-price`;
a keyword/niche ("anything in herbs?") → **no script flag exists** — run the screen and
filter the output rows by niche yourself; `--publish` only if Ben wants the app's Scan tab
updated. The script already gates (two-sided liquidity, price window, per-spec falling doctrine)
and grades (`rating.mjs`); your job is the judgment pass over what it prints.

**P5 niches — scalp / value (both PROVISIONAL, n≈0, OFF-by-default; explicit `--mode` only).**
- **`--mode scalp`** _(judgment: when to chase — desk-presence call)_ — a DELIBERATE intraday flip on a FALLING market (Ben's 2026-07-08 amendment: a
  faller isn't auto-bad). It INCLUDES fallers other niches exclude. Flip-only/no-hold, HARD intraday
  stop — an unsold lap is a CUT, not a hold. Judgment: only chase these when actively at the desk;
  never leave a scalp bid unattended (a resting scalp bid keeps its stop only while you watch it).
- **`--mode value`** — buy-hold near a multi-week low, hold for the cycle (ONE tax-paid sell of a big
  move). Its own term-structure table (buy-now vs watch tiers, hold horizon stated). CONSOLE-ONLY (no
  app tab). Every pick is provisional; state the multi-week hold horizon at entry. The gate needs a WARM
  daily archive — on a cold archive it correctly surfaces little/nothing.

**Niche set (NY2, 2026-07-05 — Ben's ruling on NY1's evidence).** `--mode all` runs **band,
spread, rising** — NOT churn. **Churn is off-by-default** (its 14 band-exclusive names are
low-margin commodity staples that never beat band's edge); reach it only with an explicit
`--mode churn`. **Rising** is kept but its candidate pool now carries a noise floor (big-ticket
OR liquid), so its old cheap teleport-tab D-flood no longer shows. **Spread** is kept, unchanged
— it surfaced the one niche-exclusive real flip (Hydra leather), so it stays pending genuine
multi-day `--mode all` data. Evidence base: one evening of `suggestions.jsonl` — small sample,
rising re-judged on a trending day.

**Sync first (SY1).** The §5 position-context pass reads Ben's current book, and there is no
scheduled sync (on-demand only since the `CofferFillsSync` job was eliminated — FILLS-PIPELINE
§12). Run `node pipeline/sync-fills.mjs` before the position-context pass (in practice, at the
top of the scan) so held-inventory/offer context is current — it also ff-pulls `origin/main`
so any phone-logged trades are folded in (the multi-writer contract, §13.3).
**Run it from the MAIN checkout only (SY1.2):** the sync commits+pushes `fills.json`/
`positions.json` to `main` under the admin bypass, so run it from `C:\dev\The-Ledger`, **never
a git worktree** (a feature-branch context would push the artifacts to the wrong ref). If
you're in a worktree and can't reach the main checkout, SKIP the sync and note the book may be
stale. (When `/scan` runs inside `/overnight`, Phase 1 already synced via `/positions` — don't
re-run it.)

## 2. Judgment pass over the rated rows

This is the tribal layer the script can't do — apply ALL of these:

- **500k gp/day attention floor** _(enforced: `pipeline/screen.mjs` `--min-gpd`)_ (standing rule, memory `gpd-floor-500k`): NOW ENFORCED BY THE
  SCRIPT — `screen.mjs --min-gpd` (default 500_000) drops sub-floor rows pre-rating (S1), so you no
  longer post-filter. Just trust the printed rows and, if Ben wants a different bar, pass `--min-gpd
  <N>`. Thin gp-flow big tickets and held/asked items are floor-exempt by design.
- **SUB-FLOOR FALLBACK tables are NOT qualified picks (P6c).** _(judgment: relay discipline; mechanic in `pipeline/lib/gatecandidates.mjs`)_ If a niche prints `SUB-FLOOR
  FALLBACK` (zero candidates cleared the floors → the script re-ran beneath them and shows the best
  ≤5, grades `C (sub-floor)`-capped), relay it AS sub-floor: name the floor that emptied the niche,
  never present a sub-floor row as a normal recommendation, and default to "nothing qualified today"
  unless Ben explicitly wants to fish below the bar. The bar itself was not lowered.
- **24h-drift is a pre-filter only.** _(judgment: interpretation discipline)_ A current-vs-24h-avg read of "flat/slightly soft"
  repeatedly masks multi-day fallers. The screen's displayed Regime column is the real
  multi-day `regimeDrift` check — trust it, and never recommend off a 24h impression alone.
- **Two-sided liquidity discipline.** _(enforced: `pipeline/lib/gatecandidates.mjs` two-sided gate; the ~100/day floor is `judgment:`)_ Real liquidity = a two-sided daily market
  (`lowPriceVolume>0 && highPriceVolume>0` on the 24h endpoint), never the `/volumes` count
  (bursty/weekly, overstates tradability). ~100/day limiting-side is the practical floor;
  below it the juicy "margins" are ghost-spreads (cosmetics, ornament kits — uncrossable).
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
  data, not yet a rule).** _(judgment: unproven lean, F1-gated)_ The first `outcomes.mjs --report` capital-efficiency read showed
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
- **Band-top artifact detection.** _(judgment: artifact spotting; `--min-active` supports)_ A single outlier print inflating the band (one lone
  100k print against a 59k mid) makes ROI look absurd — flag it and discount; never
  recommend off one print. Check `--min-active` traded-windows plausibility when a band
  ROI looks too good.
- **The screen now DOES the windowrange analysis in-script (2026-07-09) — read its `ℹ trajectory/reach`
  notes first.** _(enforced: `js/validate.mjs` trajectory + reach validators, `pipeline/screen.mjs` Leg B)_
  Each surfaced row now carries auto-computed INFORM notes (never a drop, n≈0 rollout): a **reach** note
  (the sell-leg `--ask` reachability + RC1 stale bump, off the 1h series fetched per survivor) and a
  **trajectory** note classifying the buy-leg shape — **knife** (spike + monotone-down lows → "not a dip",
  the Nightmare-staff catch), **oscillating** (repeating local minima → "buyable at the local min", the
  Hydra case), **based** (flat value-low), **elevated** (bought high). This is the encoded form of the
  manual `windowrange` reads below — so the manual `--ask`/`--window 0-23 --nights 21` step is now a
  CONFIRMATION on the handful you actually pitch, not the primary detector (a `would reject`/`would caution`
  note is the screen telling you what a stricter thesis would have done). Still verify by hand before
  quoting a profit — the notes are inform-only and thresholds are placeholders.
- **Asymmetric ask-reach read — the verification gate (2026-07-07, method).** _(judgment: method; tool `pipeline/windowrange.mjs`)_ The screen's ROI is
  computed off the 2h optimistic band edges, which are often extremes the market never actually
  pays. Before recommending ANY pick, run the `windowrange.mjs --ask <band-top>` reach check the
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
  **MANDATORY, both legs — this is a hard step, not a judgment call (Ben, 2026-07-07, the DHCB
  overpitch).** A dip-bid has TWO legs to verify and it is easy to do only one: the BUY (trajectory /
  dip-vs-knife) AND the SELL (the `--ask` reach). **Before quoting ANY dip-bid's expected profit, run
  `windowrange.mjs --ask <sell target>` and quote the REACHABLE sell (the ~50–75%-day reach level),
  NEVER the raw 2h band top** — the screen's `Optimistic`/`Rank` column price the sell at the band top,
  which on a thin + wide-band item is an artifact that never reaches. No pitch without the sell leg
  verified. Anchor: DHCB surfaced top-of-board (score 2.24m/d) and I verified the BUY (21-night
  trajectory = a healthy recovery) but carried the band-top sell 36.21m forward UNVERIFIED and quoted
  +690–810k; `--ask 36.21m` reached **0/7 days**, the reachable sell was ~35.6m, and the real trade was
  +80k that then went underwater. The band top is a fine CANDIDATE (input); it is never the pitched
  profit until `--ask` confirms the reach. (Decided against re-scoring the screen off a reachable sell:
  the cheap ts6h proxy understates reach → false negatives that HIDE good sells, worse than the
  problem; run `--ask` on the handful you actually pitch instead — accurate + cheap.)
- **Fresh-repricer flag.** _(judgment: sizing call)_ A large multi-day regime move = the item was recently repriced
  → overnight-retrace risk. Size small; skip for unattended holds.
- **Phase tag on the Regime cell (2026-07-06).** `screen.mjs` annotates each Regime cell with a
  trajectory phase from the shared `phase()` (off the same 6h series, zero extra fetch): `spike`
  (elevated over its own base), `decay` (pulled back from a recent peak with lows STILL stepping
  down — a falling knife), or `basing` (decayed back to the pre-spike base with lows FLATTENED —
  a possible base-buy). It's a read aid, not a gate. **A `spike` tag is NOT automatically "about
  to retrace" (Ben, 2026-07-06).** The Tier-1 tag can't tell froth from a genuine reprice: `spike`
  covers BOTH the frothy-about-to-retrace case (DWH) AND a real reprice UP to a new sustained
  higher level (webweaver: base ~15.7m repriced to ~18m, with recent daily LOWS *rising*/higher-lows,
  not decaying). So treat a `spike` on an item you're considering as a PROMPT to run the full
  `/positions` "trajectory read for confidence" (`windowrange.mjs --window 0-23 --nights 21`,
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
  trajectory (`windowrange.mjs "<item>" --window 0-23 --nights 21`) read for the **lows-trend + volume**
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
- **Big-ticket caution.** _(judgment: sizing; gp-flow gate in `pipeline/screen.mjs`)_ High per-unit capital → each fill is expensive; require real
  gp-flow (units × net), not a unit count. The script now SURFACES these via the gp-flow gate,
  flagged `thin` and capped at grade A- with a "~N/day — size in units, expect slow fills" tooltip
  (S1). Treat a `thin` row honestly: the edge is real but you can only place a few units/day, fills
  are slow, and its wide band can be a thin-trading artifact — size in units, never chase.
  For a big-ticket price SUGGESTION where you want confidence in the entry / where the item is
  heading, run the same full-day multi-week trajectory read — `/positions` "trajectory read for
  confidence on a marginal/big-ticket hold" (`windowrange.mjs --window 0-23 --nights 21`,
  phase-mapped). Point to it; don't copy the method here.
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
  `node pipeline/limits.mjs "<item>"`)_ Every accumulation/tranche suggestion is CAPPED by the item's
  GE buy limit (`quote.mjs` prints it as `· buy limit N/4h`; also in the mapping — look it up before
  sizing). A "tranche" is ONE window's worth = **≤ limit units**; a position bigger than the limit is a
  **multi-window accumulation by definition** — state the per-window cap, the gp it represents, and how
  many 4h windows it takes (e.g. "11k darts = ~2.0m/window; 44k = 4 windows ≈ 16h"). Do NOT pitch a
  single-tranche size that silently exceeds the limit (the anchor: I suggested "~45–55k amethyst darts"
  against an 11k/4h limit — that's 4+ windows, not a tranche). This is now ENCODED on every suggesting
  surface (LM1): the rolling-4h `limitWindow` math is fed to the BUY-side `limitValidator`, which
  **REJECTs** (screen drops it, quote/held/watchlist note it) a buy whose window is exhausted and
  **CAUTIONs** one nearly spent — and `quote.mjs`'s regime line appends `(bought X this window — Y
  left, next frees ~HH:MM)` when there are in-window logged buys. Two follow-ons the numbers already do
  for you: (1) **if the item was already bought today, the limit is partially/fully consumed** — run
  `node pipeline/limits.mjs "<item>"` (reads `fills.json`, no fetch) for bought/remaining + the local
  `next frees ~HH:MM` / `fully resets ~HH:MM`; size the REMAINING headroom, not the full limit. HONEST
  LIMIT: only RuneLite-logged fills are visible, so a mobile/unlogged buy is invisible — "left" is an
  UPPER bound, not a guarantee. (2) **a null/untracked limit ≠ unlimited** — the validator DEGRADES to
  pass on a null limit (never green-lights it); flag it and size conservatively off volume.
- **A thin CURRENT 2h band ≠ no edge — read the recent DAILY range on a proven lane (Ben,
  2026-07-08).** _(judgment: read call; tool `pipeline/windowrange.mjs`)_ The screen's band is the last-2h window; it looks THIN precisely when live sits at
  the top or bottom of the item's wider daily range. Do NOT dismiss a known/proven lane (one you've
  flipped before) off the thin 2h band — run the full-day `windowrange.mjs --window 0-23` and read
  the **recent daily lows→highs** (the band you actually flip over), recency-verified per RC1. Bid
  the recent daily-LOW zone, sell the recent daily-HIGH zone. If live isn't at the low right now,
  it's a **patient dip-bid** (rest it, it fills on the next daily dip), not a fill-now — say which.
  Anchor: I skipped Berserker ring as "thin band" off its 3.11–3.23m 2h window, but its recent daily
  range is ~2.93m→3.165m (both recent 3/3) = a real +5.9% band-flip; live was just near the daily top
  (3.11m), so it was a patient dip-bid at 2.93m, not "no edge."

## 3. Hard rules (cited from CLAUDE.md's table contract — don't restate, don't violate)

- Falling handling is PER-STRATEGY, not global (Ben's 2026-07-08 amendment; P5 — memory
  `falling-exclusion-amended`, encoded in `js/strategies.mjs` `spec.falling`). The `band`/`spread`/
  `rising`/`churn` niches EXCLUDE fallers silently (`falling: 'exclude'`) — for those, never re-add
  or mention a falling row. But `--mode scalp` ACCEPTS fallers (a deliberate intraday flip expects a
  falling wide band) and `--mode value` KNIFE-GUARDS (rejects a decay knife, accepts a flat/basing
  value-low) — do NOT call a scalp/value faller a mistake; the spec surfaced it on purpose. Exception
  for the EXCLUDE niches: items Ben holds, explicitly asks about, or **watchlists** → always show,
  with price-to-clear.
- **Watchlist section (S3): always report, honestly.** The script appends a Watchlist table (from
  repo-root `watchlist.json`) that is exempt from every floor/gate; each row carries a Note saying
  what a gate would have hidden (below-floor / thin / one-sided / falling). Never silently drop a
  watchlist row and never hype one past its read — surface it with its Note and one honest line.
  Falling watchlist items appear here with the falling warning (they're excluded from the niches).
- Preserve the standard table columns exactly as printed (app-code canon).

## 4. Output

The judgment-filtered shortlist, one-line rationale per pick (why this edge is real), plus
a note of how many candidates the 500k floor eliminated. If a high-grade row was skipped,
point at it and give the reason — that's the layer this skill exists for.

**Cover every niche each pass — "no dips" is NOT a complete scan (Ben, 2026-07-07).** A
recurring scan (esp. inside a watch loop) drifts narrow: one salient sub-task — the dip-hunt
— quietly becomes the *only* thing evaluated, and the broader mandate (candidates for the
dry/committed capital) silently collapses to "nothing." The fix is structural, not
willpower: the report must give an **explicit one-line read on EACH niche every pass** —
`Dips · Band big-tickets · Spread · Rising` — even when the answer is "nothing, because X".
A slot you must fill can't be silently dropped (same principle as the ONE-LINE-PER-ITEM and
recent-reach rules — make the output enforce the coverage). "No dips" ends the *dip* line,
never the scan. Anchor (2026-07-07): several watch-loop passes reported only "no new dips"
while band big-tickets (bludgeon/sang/tassets class) went unmentioned for an hour — Ben had
to ask "are we looking at other niches?"; the miss was omission, not a bad call.

**Every recommended price states its timing target (Ben, 2026-07-05):** a pick's bid and
sell are each "X, targeting Y" — bind the number to the window/mechanism expected to fill
it (e.g. "bid 17.00m — tonight's 18:00–23:00 trough, projected 16.8–17.0m" / "sell 17.55m —
the 23:00–03:00 UK-morning lift, reached 7/7d"; a churn item's target can simply be "normal
daily churn"). Run the time-of-day `windowrange.mjs` read the CLAUDE.md doctrine already
requires and quote it — never a bare number.

## 5. Position-context pass (Ben, 2026-07-05) — read the shortlist against the current book

A scan is not done until the picks are compared against where Ben's capital already sits.
After the shortlist, run `node pipeline/watch.mjs` (positions = held inventory + every
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
