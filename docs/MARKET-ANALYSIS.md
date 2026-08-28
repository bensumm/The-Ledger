# MARKET-ANALYSIS.md — the standard market read

How every market read (a screen, a per-item quote, a position review) is produced and
interpreted. CLAUDE.md keeps the **routing** (which command answers which ask) and the
one-table output shape; this doc is the **doctrine** behind that output — read in the order
a read is built: *output → tax → find → price → time → scripts*.

It POINTS to the module header that owns each full spec (thresholds, calibration provenance,
fixtures) rather than restating it — the header is the single source, this is the operating
summary. Term lookup: `docs/GLOSSARY.md`. Data-flow: `docs/FLOW.md`. Invariants: `docs/ARCHITECTURE.md`.

---

## 1. The output — one table

**The render layer (PLAN-VIZ-LAYER).** The three market-read scripts (watch/quote/screen) each build
ONE plain, JSON-serializable **report object** (`{ kind, generatedAt, sections:[…] }`) beside their
compute and print it via `renderReport` — the ONE render path, `pipeline/lib/render/render.mjs`. It formats
already-computed facts and decides NOTHING (no numbers, no verdicts). Section types: `headline` /
`alerts` / `table` (→ `mdTable`) / `lines` / `notes` (typed `{kind,tier,text}`, the per-kind sigil
lives in render.mjs's `NOTE_KINDS`, not the push site). Every note family carries a **surfacing tier**
— `core` vs `context`, a TRACKING label only: BOTH render AND relay by default (R10), there is no
default-hidden tier; `shadow` (suggestions.jsonl analytics) never enters a report object. The tier
registry + relay rules are in render.mjs's header (encoded) and the four SKILL.md files (the two
`judgment:` relay rules — raw-unfenced tables, relay both tiers). Don't restate the format elsewhere;
point here / at render.mjs.

Every read is ONE table, the **table v2** column set:

`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime`

- **Quick** and **Optimistic** are each a self-contained cell reading `buy → sell · net/u (ROI)`,
  net after the 2% tax (colored gain/loss in the app). **Quick** = transact now (buy the live
  instasell, sell the live instabuy). **Optimistic** = the patient 2h-band edges (last 24×5m
  points), **Bar-E robustified** (see §3). Mid is dropped from the table (redundant beside Guide
  + the live prices); the row model still exposes `row.mid`. **Quick is a recent-averaged read,
  not a literal top-of-book snapshot** — a small same-day live-fill check (n=4, 2026-07-17) found
  it can sit on the wrong side of the live spread at execution time; full writeup + evidence is
  the header comment in `js/quotecore.js` (the one home), not restated here.
- **Ordering invariant.** On ONE consistent basis, `optBuy ≤ quickBuy` and `quickSell ≤ optSell`. A
  break on MIXED bases is a bug — fix the script. The middle pair is NOT an invariant: `quickBuy >
  quickSell` is a CROSSED FEED, which `js/quotecore.js` detects and labels `feed-inversion` rather than
  rejecting, and which ~16% of a live snapshot carries. Code that assumes the order must stay total on it. On consistent bases a break is a real **momentum
  tell** (the live price left its own 2h band), surfaced as the **Momentum** column off the
  *pre-clamp* comparison: `quickBuy < optBuy` = breaking down / active pullback (don't buy in; on a
  held big-ticket it's a CUT trigger that fires before the multi-day regime confirms); `quickSell >
  optSell` = breaking up / fresh high; in-band = ranging. Strength-graded `–` · `↑/↓` · `↑↑/↓↓`
  (≥ `MOM_STRONG_PCT`). Drives the position cut-trigger via `momVerdict`; NOT wired into the bulk
  Finder rating.

### Console default — `Est. buy` / `Est. sell`
On `screen-flip-niches.mjs` and `quote-items.mjs`, STDOUT replaces Quick+Optimistic with the
reconciliation-estimator pair + `Net/u (ROI)` + `BE` columns (`js/estimators/pair.mjs` `estimatePair`
is the full synthesis: Optimistic ∩ diurnal ∩ reach ∩ anchor, with break-even as a display ANNOTATION —
not an overwrite — since E1). `--raw` restores the
model-free Quick/Optimistic (and `--asym` implies `--raw`). The app + `screen.json` render the raw
table-v2 **decision** cells — the Grade, the rank, and the sort stay F1-gated on the NEUTRAL
estimator — but (PB4 app-display, 2026-07-15) `screen.json` now ALSO carries an ADDITIVE per-row
`reachable` band `{ ask, bid, pressure, reliability, … }`, and the **app's Scan tab renders a
`Pressure (trial)` column by default** (deep reachable bid → bold ask) beside the neutral Optimistic
reference — labeled un-calibrated (n≈0), never a rank/grade/sort input. Operating summary:

- **`Est. buy` is strategy-aware** (`entryDoctrine(spec)`, routed off `spec.fillShape`): **scalp** →
  near-live (bids the instasell to fill); **value** → the trough (band low, unfolded); **band** → the
  band low, NOT folded (doctrine `band-low`, PLAN-ESTIMATOR-POSTURE AC1: band is a "ladder the band low,
  sell the band top" play — non-immediate fill is the strategy, so the buy PRICES the band low and
  ANNOTATES its fill-probability instead of folding up), carrying a **reach token + placement percentile**
  in the cell (`4/14 · p36` — where `p36` = the percentile of the band-low bid within the 14-day daily-LOW
  distribution; a low pXX = a deep/patient entry); **churn** → the band low too (PLAN-ESTIMATOR-POSTURE
  AC6: churn's buy leg NO LONGER folds toward live either — the day-level reach mismeasures a tight
  symmetric lap on both legs, so churn prices the same band-low pair as band, carrying a placement
  percentile but with its reach caution token suppressed by `foldExempt`). The asym deep bid
  is never folded in — it stays the `◆ asym` line (rest-and-see optionality). The rank absorbs the
  fill-probability the band buy price no longer hides: the bid reach feeds `pFillIntraday` (a rarely-filling
  deep band-low bid gets low P and ranks BELOW an equal-net fill-now flip).
- **`Est. sell`** = a DECLARED thesis exit **only on a held lot** (floored to live, not clamped to
  the band), else the **band** top folded by reach + a diurnal/asym blend; **churn is EXEMPT** (AC5:
  `fillShape:'symmetric'` forces the sell fold factor to 1, so churn's Est. sell is the band-top blend
  the rank already prices on; the diurnal-ask timing blend still applies, so it lands NEAR the band top,
  not exactly at it) — **exempt only while the ask sits inside the daily-high distribution** (EF1(b)'s
  placement bound, `askPlacement ≤ MIRAGE_PLACEMENT` — an above-the-distribution churn ask takes the
  standard fold + caution tokens; see the rank/grade section). **`Est. sell` is the HONEST reach-fold price** (PLAN-ESTIMATOR-HONEST-SELL E1,
  2026-07-22): it is **no longer OVERWRITTEN to break-even**. Because `netMargin(buy, breakEven(buy)) ≡ +1`
  for the entire price range, the old BE-clamp turned every sub-BE fold into a **false `+1 (BE X)`** that
  hid a possibly-real edge — the operator read `+1` and SKIPPED. Now the cell shows the **real (possibly
  negative) net** with its **P(fill)** beside it (`askReachFactor` — the same function the rank calls, reused
  not forked, so the cell reads raw margin × P(fill)). **Its basis is the FULL WINDOW** (flipped 2026-08-09;
  it was recent-3 from RB-3, 2026-08-04). RB-3's finding still holds and is what keeps these two numbers
  paired: the fold PRICE and the probability beside it must declare the SAME basis, or one row contradicts
  itself on a regime-changed item. What changed is *which* basis both use. **Recent-3 is four-valued** — at
  n=3 the fraction can only be 0, ⅓, ⅔ or 1, so one night's print swings it by a third of its range, which
  is the noisiest input the estimator has. Forward-scoring backs the flip: over 6,016 ask rows with a real
  8h outcome, a higher full-window reach fraction printed **9.8pp** more often within-item (78 items vs 36,
  p=0.0001) — a resolution the 14-night window can carry and a 3-night one cannot. **This also retires a
  standing caveat**: the display P and the RANK's P (`js/estimators/families.mjs`) were deliberately
  different numbers under RB-3 and are now the same basis, so `P(ask)~` in the Est. cells and `P~` in the
  Rank cell agree. The freshness signal is **shown, not discarded** — the `0/3 · 12/14` divergence token is
  unchanged and the `fold:` line prints the recent-3 value beside the full-window one whenever they differ.
  Rule 4: full-window is not KNOWN to predict FILLS better (n=0 — no fills-to-basis join exists; the
  measurement is against PRINTS). ⚠ **Two display surfaces did NOT flip** and remain recent-preferring —
  the `--digest` reach ✓/✗ column (`digestReachFrac`) and `watch-positions`' size-relief note. ✅ **That
  split is now DECIDED for the digest column** — `join-reach-basis.mjs` (2026-08-13) measured recent-3 as
  the cheaper basis there (M(1)=+2.3pp, item-clustered CI [0.8,3.8]) and left it recent-preferring, so the
  disagreement with the fold is deliberate and measured. The same run's bigger result is about the TAG:
  below r≈1.29 both bases lose to not gating at all, so never read that column as a filter. When the
  fold sits below break-even the cell **ANNOTATES**
  it (`reach-fold floored to BE X — nothing to price above break-even`) rather than substituting the
  number; `estSellFloorBind` carries that BE as a display fact. **PP2 (2026-08-22): that same cell also names the
  PATIENT alternative** when the row has a positive asym pair (`· patient: deep-bid … → ask … · net +N/u
  — resting levels, in-sample counts, not a fill rate`), so the floored half is no longer the only thing
  the cell says — the wording is `formatAsymFill`'s, and its counts are in-sample quantile ranks, never
  fill rates. A **forward "list at X"** rides alongside —
  the phase-aware `driftExitFrom` projected exit (`~Nd hold`, confidence ordinal, `forward n≈0` inform),
  shown when the caller passed its in-hand `hourProfile`+`windowStats().days` (`extra.forward`; absent →
  degrade, no fetch). The reach-fold is labeled **secondary/phase-blind** (the correct read for a
  confirmed knife); NO "which is authoritative" claim — both ship until the F-G realized-fill retro
  adjudicates. The pure discovery screen NEVER anchors to a declared exit (a bare candidate is a buy read).
  The band sell fold is deliberately KEPT (AC7, the crux verdict — the rank's soft-floored ask-reach P is
  not yet a sufficient mirage guard); its removal is re-decidable when AC4/F1 scores raw-top vs folded
  against realized sells. The **reach-fold itself also surfaces as a validation DATA POINT** in
  `read-window-range.mjs` (AC8, below).
- **The sell-top proposal is a NAMED, swappable MODEL** (PC3, `js/estimators/sell-models/`): the neutral
  **`reach-fold`** (default) above, and the opt-in TRIAL **`pressure`** (PB4). `--est-sell=reach-fold|pressure`
  selects it — **the `=` is REQUIRED** on `quote-items.mjs`/`watch-positions.mjs` (they match
  `a.startsWith('--est-sell=')`); a space-separated `--est-sell pressure` is now REJECTED with an
  error (it used to fail silently twice — ignoring the flag, then quoting the bare `pressure` as an item) (**`--pressure-exit` = legacy sugar for `--est-sell pressure`**); the model only PROPOSES a
  price — the shell keeps the non-skippable floors (ordering clamps, BE floor, declared-exit anchor) so no
  model can price past break-even or the live book. Under the `pressure` model Est. buy/sell become the
  `reachableBand` legs (deep reachable bid → bold reachable ask), reranking the console scan by the pressure
  net; sell ≥ live, declared exit still wins the sell leg (break-even rides as the `estSellFloorBind` display
fact, not an overwrite — E1; the one real-price consumer, watch-positions' pressure list-at, uses that
floor-bound value so a LIST price never sits below break-even), and a **reliability-gated ceiling**
  lets a fully-reliable read exceed the observed 24h high (reliability<1 keeps the `dayHighFrom5m` cap). The
  conservative depth floor renders beside as the reference; a LOUD banner flags every surface as un-calibrated
  (n≈0). **The `pressure` model keeps its uncalibrated prices out of `screen.json`** — since publishing is
  default-on, a `pressure` (or `--asym`) pass **silently downgrades** the publish to off (skips it); only an
  EXPLICIT `--publish` alongside it hard-REFUSES (loud stderr + exit). Either way the deployed app + `screen.json` + the grade
  cutoffs stay F1-gated on the NEUTRAL estimator, and the neutral `reach-fold` runs as a SHADOW every pass
  (the resolver's `shadow` list) so the retro co-log logs it + the pressure `reachable` separately and the
  head-to-head stays unbiased (`PLAN-REACHABILITY-CONSOLIDATION.md`). Off the trial: byte-identical.
- **The ask-reach fold is liquidity/size-conditioned** (`reachRelief`): reach measures how often a
  price prints, not how much of *your* stock clears — so on a liquid book where your position is
  small vs flow the fold softens toward 1 and the sell reference de-biases toward the observed 24h
  high (`dayHighFrom5m`), never above it. A thin book or a large size/volume computes relief exactly
  0 (the Ancient-godsword mirage-exit protection). **The size input is the REAL held lot on a
  positions surface** — `quote-items --positions` and `watch-positions` pass the open qty
  (`extra.intendedUnits`); a bare discovery/per-item read with no held qty degrades to the buy-limit
  proxy. So a held-lot ask reads its relief off the actual position, not an accumulation estimate.
  Full mechanism + thresholds + the F1 shadow fields: the `asymEstimate`/`reachRelief` headers in
  `js/estimators/reach.mjs` (both live there after the PC2 split — `js/estimators.mjs` is the barrel).
- **The sell fold is also TREND-aware (R5, PLAN-SIGNAL-RECENCY).** The reach fraction says a top PRINTS;
  it does not say the cushion OVER it is decaying. When the ask-side `reachMargin.trend` is `fading`
  (R4's slope-based cushion trend, passed to `estimatePair` via `extra.askMargin` — the screen wires it;
  quote-items degrades byte-identical until wired), the sell fold factor is multiplied by
  `EST_FADE_DISCOUNT` to tighten the Est-sell EVEN on a clean 3/3 reach — the godsword / +412k-bludgeon
  mirage (reach 3/3 today, cushion collapsing). It's ADDITIVE to the reach/relief fold, exempt on a
  symmetric (churn) lap, nulled by a declared exit, and byte-identical when the trend is absent/stable/
  extending. INFORM-only, n≈0 PLACEHOLDER; a `fade` marker rides `confidence` for the F1 shadow.
- **The held-lot depth floor + pressure-reachable (PLAN-DEPTH-EXIT, inform-only).** On a held lot,
  `watch-positions` now renders TWO measured lenses beside the reach count: the **depth floor**
  (`clearableAsk` — the highest ask whose at-or-above instabuy flow absorbs `×4` the lot on ≥75% of
  days; strictly conservative, since 1h bucket AVERAGES smooth away the peaks a resting ask fills at)
  and the **pressure-reachable band** (`reachableBand` — `base ± band·φ(ln medVolHi/medVolLo)`, the
  buyer/seller-balance read that says how far beyond the smoothed center the tape realistically
  reaches). The floor never renders alone (it under-reads a liquid book — the Soul-rune 394-vs-397
  lesson); a collapsed depth read always prints its REASON (`depth n/a — book absorbs <4× your lot;
  reach fallback`) — a silent degrade is a defect. The old `size-relieved fill ~N%` relief note
  renders only when the depth read is null (it's the fallback proxy the depth read measures
  directly). Both shadow-log to `suggestions.jsonl` (`depthExit` incl. collapse reason + liquidity
  class, `reachable`) for the F1 retro-join; no verdict/price/grade moves off either until DE4/PB4.
  All constants are n≈0 placeholders (`DEPTH_*`, `PRESSURE_*` — `js/windowread.mjs`). These two
  primitives are the successors the older `reachRelief` + `asymPair` heuristics converge on: the watch
  held row co-logs ALL FIVE exit estimators (reach · reachRelief · asym · depth · pressure) so the F1
  retro-join can score them head-to-head against the 1h ARCHIVE (the realized sell is circular — a GE sell
  executes at the ask you typed); `join-reach-outcomes.mjs` does this and DESCRIBES rather than ranks — the deprecate-then-
  remove migration is architected in `PLAN-REACHABILITY-CONSOLIDATION.md` (nothing retires on theory).
- **Confidence rides IN the price cell** as the recent-3 reach (`0/3`, `recencySplit`) — the
  freshness-honest signal and the fold basis; the full window shows beside it only on divergence
  (`0/3 · 12/14` = stale); `–` = no read.

PLACEHOLDER model (n≈3–14); `estBuy`/`estSell`/`estConfidence` ride `suggestions.jsonl` for F1.

### The other columns
- **Guide** = the real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- **Vol/d** = the limiting side, `min(highPriceVolume, lowPriceVolume)`. It comes from the CORRECTED
  rolling-24h source composed from the `/1h` grain — **the wiki `/24h` endpoint is unusable as a
  trailing-24h source** (as re-measured 2026-08-10 it serves a complete, exact UTC-day aggregate that
  closed ~24–48h before you read it; the ~10–27× under-report it showed in 2026-07 is history and now measures ~1.0×).
  Every volume-denominated floor is calibrated to the corrected scale. `--vol-source legacy` restores
  the raw read. Full story + the recalibrated floor values: the `marketfetch.mjs`
  `loadAll24hRolling` header (the ONE home) + `PLAN.md`'s VOL24 Status row. (The app half shipped at
  0.74.0/0.74.2 — the Finder reads a daily two-sided volume and a measured zero no longer reads as
  "no information".)
- **Net/u** = after the 2% tax. **Regime** = the multi-day `regimeDrift` (flat/rising/falling), with
  a display-only **phase tag** folded in (`spike`/`decay`/`basing`, from `phase()`) — NOT a gate.
  Since R2 (PLAN-SIGNAL-RECENCY), `regimeDrift`'s flat/rising/falling comes from `floorCeilingTrack`'s
  slope-asymmetry **classification** over the daily-bucketed 6h series (not the old 3d-vs-14d median
  delta), so a recovering item whose recent floor/ceiling turned up is no longer mislabelled falling.
  This gate reads the **6h archive**; `read-trajectory`/`read-window-range` read the **1h** series — the
  two can classify the same item differently (granularity + history depth), so a verify-tool cross-check
  isn't a bug when it disagrees with the gate.

### The decision digest — a THIRD console view (`--digest`)
`screen-flip-niches.mjs --digest` prints ONE compact cross-niche block ABOVE the per-niche tables (and
above `--raw`): `Item | capEff | deploy | reach | trend | phase | soft-buy | grade | verdict` — top ~8 across all flip-niches
this pass, ranked by **deployable throughput** (`capEff × deployable capital` ≈ after-tax deployable gp/day,
NOT raw %). Raw `capEff` is SCALE-FREE, so ranking on it alone let dust-tier cheap high-% flips (Lead ore
1072%/d on ~60k of deployable capital) sweep the top and bury the big-ticket deploys the digest exists to
surface — the SAME failure `valueScore`'s deployable-capital blend already solved, so the digest REUSES its
`deployUnits` three-way min (`js/valuescreen.mjs` — bankroll ÷ buy price, 10% market-share over 2 days,
buy-limit accumulation) against the FULL deployable pool (`--capital`, NOT ÷slots). `capEff` is a REALIZABLE
sustained rate, not a raw per-day extrapolation: its laps/day are buy-limit-bounded at the deployed size
(`lapsCap = limit × windows/day ÷ deployUnits`), so a fast-selling cheap item reads ~13%/d, not the ~198%/d
fantasy you can't actually cycle the whole deployed position at. `capEff` stays a DISPLAYED column; the
`deploy` column shows the deployable capital so the ordering is legible. A GUARANTEED big-ticket slice
(POLISH 1) protects visibility: pure deployable-gp/day tops the digest with high-throughput churn, so if
fewer than 2 big-ticket rows (`mid ≥ BIG_TICKET_GP`) made the visible top-8, a small `— big-ticket lane —`
sub-section is APPENDED (top few big-tickets by the same rank key) — additive visibility for the
attention/risk trade-off, NOT a re-ranking of the main block. The reach ✓/✗ + mirage read is STALE-LIVE
guarded (POLISH 3). The `trend` column (R4b, PLAN-SIGNAL-RECENCY) is the ask-side `reachMargin` cushion
trend beside reach ✓/✗ — `↓ fade` (the cushion over the quoted sell is shrinking: a peak cooling ONTO the
ask, so read the ✓ with suspicion — the godsword shape), `↑ ext` (headroom growing), `stable`, or `—` (a
symmetric churn/amplitude flip-niche, a thin day sample, or no in-hand buckets → honest degrade, never a
fake read). It's the slope-based `reachMargin.trend` (R4), scored at the SAME reference the reach column uses (so
a stale-guarded row's trend reads at the fresher instasell too) — INFORM-ONLY, it never re-ranks or gates.
The `soft-buy` column is the BUY-timing complement of `phase` (which reads the peak /
sell-cycle window): the diurnal DIP window (cheapest hours for an ATTENDED take) + where the LIVE instabuy
sits vs the dip floor + a FLOOR-AWARE cue — `HH:00–HH:00 · @floor · <cue>` or `· +X%`. **DT2 (2026-08-09):
`+X%` states WHERE LIVE SITS, not "wait for the window"** — see the ⏳ soft-buy entry in §Notes for the
measurement and the resting-bid-vs-attended-take split. It delegates to the SHARED
`softBuyRead` (`js/windowread.mjs`) — the SAME helper + wording as the positions surface (ONE implementation).
When live is `@floor` the cue consults the in-hand multi-day `floorCeilingTrack`: `buy now` (soft dip),
`▲ favorable — dip in uptrend (price-trend only)` (rising floor — a prompt, blind to game-update breaks, never
a green-light), or `▽ caution — floor breaking ↓` (a post-update dump sitting @floor is a falling knife, not a
discount — the fang anchor), or `▽ caution — dip into an UNPROVEN base, still elevated over the durable floor` (2026-08-06 — the SHAPE read says rising while floorValidator's 28d LEVEL read still cautions; a COMPOSITION of the two existing checks, not a new one. **Narrowed 2026-08-08** when `FLOOR_CAUTION_RANGES` moved 1.0 → 1.5: a buy 1.0–1.5 swings over the floor no longer trips it — intended, that band measured P(drawdown ≥ 1 swing) 12.0% vs 29.8% above it; the Snape grass anchor at 1.68× still fires). Inform-only PLACEHOLDER (n≈0), stdout-only — never gates/drops/regrades and never enters
`screen.json`; it exists so a buy decision can see WHEN the item is soft instead of buying into a peak (the
blowpipe-at-10.67m-into-a-10.40m-dip miss). When a row's sell-side live print is stale (`row.quickStale`, the same QUICK_FRESH_MIN
freshness flags `quote-items.mjs`'s `staleLive` note reads), a quoted `optSell` pinned to that stale
instabuy can fake a reach ✓, so reach + placement recompute against the fresher instasell off the daily-HIGH
distribution — digest-scoped, never touching the screen's own reach validator, `screen.json`, or
`quote-items` output. It is an anti-overwhelm TRIAGE VIEW ("which N
do I look closer at"), ADDITIVE and opt-in: it never trims or replaces the per-niche tables + context
footers, and the per-niche table's own `rank` sort is untouched (the deployable-throughput ordering is
digest-only). The
`verdict` word is deterministic, first-match-wins over a rule table (`spread closed now` /
`mirage top` / `weak deploy` / `starter · hold-to-next-peak` / `fill-now` / `low-conviction`) — deterministic is not
calibrated. There is deliberately NO reach-only word: `sell unreliable` was DELETED (owner ruling
2026-08-25) after `join-reach-basis.mjs` measured that tag losing to not-gating-at-all below a cost ratio
of ~1.29 while it fired at priority 1. The `reach` column now prints the FRACTION and the window it was
read on (`r3` recent-3 · `14d` the full window it degrades to · `sg` the stale-live-guarded recompute)
instead of a ✓/✗, so the reader judges the number and knows which basis produced it. **R5 (PLAN-SIGNAL-RECENCY)** escalates the base `mirage top` to a HIGH-confidence `mirage top!`
only when BOTH the recent-vs-full placement DIVERGENCE (`placementDiverges` — the whole-window-CDF analogue
of RC1's recencySplit: recent-3 days abandoned the top by ≥ `RECENCY_DIVERGE`) AND a `fading` ask cushion
trend hold; either alone stays the base word, and the base placement/reach condition still gates (the
escalation sharpens confidence within the existing rule, it never widens what fires mirage top).

**W3-1 (PLAN-OSCILLATION-CYCLE) — live-crossability demotion (the biggest single denoiser).** The pure helper
`liveCrossable(row)` reads whether the LIVE spread is profitably crossable NOW: `row.quickRoi > 0` (the
tax-inclusive live-spread margin `computeQuote` already sets — reused, not re-derived) → `true`; `<= 0` →
`false`; no live print → `null` (UNKNOWN, never punished). When `crossable === false`, `buildDigestBlock`'s
comparator FLOORS the row's sort key to `-Infinity` (comparator ONLY — the displayed `capEff` column keeps its
true number, and the row STILL renders, never silently dropped), and `digestVerdict` returns a TOP-priority
`spread closed now` (ahead of the soft `mirage top` — an uncrossable live spread is a harder fact). This kills
the cheap-high-% ghost-spread tier (Jade necklace, Ironwood plank — live instasell ≈ instabuy) that polluted
the top. **Naming caution:** `liveCrossable`/`crossable` is a DISTINCT concept from the existing "ghost spread"
term (a ONE-SIDED book, `hpv<=0||lpv<=0`, caught upstream by the two-sided-liquidity gate in
`gatecandidates.mjs`): a book can be two-sided yet have an uncrossable live spread — `crossable` catches THAT,
in the digest sort only. **W3-2 — drift-margin into the amplitude digest rank.** The amplitude digest row's
rank basis (`ampEr.net`, which feeds `capEff` via `roiPct`) is substituted from the naive `ar.netPerCycle` to
the drift-adjusted `driftShadow.margin` (falling back to `netPerCycle` when the projection is null), so a
fading mirage (Aldarium: amplitude collapses → negative drift margin → negative `capEff`) sinks in the digest
naturally. This touches ONLY the digest struct (`ampEr` is built after and consumed only by `collectDigestRow`)
— the per-niche `rank`/`grade` and the printed amplitude table cells keep `ar.netPerCycle`, untouched. Both
W3-1 and W3-2 are INFORM/DIGEST-ONLY (n≈0 placeholders), never gating and never touching `screen.json`.

**capEff** + the **weak-deploy** flag (a big-ticket single-turn pick under ~0.5%/turn — churn
exempt, amplitude not) live inline in `screen-flip-niches.mjs` (`capEfficiency`/`weakDeploy`/`digestVerdict`,
reusing `BIG_TICKET_GP` from `js/quotecore.js`, `LIMIT_WINDOW_SEC` from `pipeline/lib/capital/limits.mjs` for the 6
laps/day ceiling, and `placement`/`diurnalPhase` from `js/windowread.mjs` + `GRADE_CUTOFFS`/
`REACH_GRADE_CAP_FRAC` from `js/rating.mjs`); a lean `capEff`/`weakDeploy` shadow rides `suggestions.jsonl`
for the retro-join. Everything here is **INFORM-ONLY, PLACEHOLDER (n≈0), never gates**, and — critically —
**the digest NEVER reaches `screen.json`** (CONSOLE-ONLY, no `APP_VERSION` bump), so don't go looking for it
in the app. Companion judgment framing: `/scan` SKILL.md's "Capital-efficiency ordering" + "Velocity vs
magnitude" bullets.

---

## 2. Tax & break-even — the one home

`js/quotecore.js` is the ONE tax-math home; every other doc/skill points here.

- **`breakEven(buy)`** = the smallest sell that still nets the buy cost after the 2% tax —
  **tax-capped, piecewise**: `buy` when `buy < 50` (sub-50 sells are tax-exempt); `buy + TAXCAP`
  (5m) once the cap binds (`buy > ~245m`); else `ceil(buy/0.98)`. Never list a held item below it.
- **`maxBuyForExit(sell, margin, opts)`** = its tax-exact INVERSE — the largest buy whose
  `breakEven(buy) + margin ≤ sell`. The back-solver for WINDOW-CLEAR pricing (§4). Don't implement a
  second inverse anywhere — call this.
- **BOND exception.** The Old School Bond is tax-EXEMPT but a GP-bought bond costs 10% of guide
  (`BOND_RETRADE_PCT`) to make re-tradeable, so its net = `sell − (buy + bondFee(guide))` and its
  break-even = `buy + bondFee(guide)`. The ONE exception, via `netMargin`/`breakEven`'s `{bond,guide}`
  opts (absent ⇒ byte-identical normal path); `computeQuote` applies it when passed the item id.

---

## 3. How a pick is found — the screen pipeline

`screen-flip-niches.mjs` prints one table per **flip-niche** (band / churn / scalp / value(invest) /
**amplitude** / **reverse** — declarative specs in `js/flip-niches.mjs`; `--mode` selects which run, `all` =
**band+churn+amplitude** as of THE SWAP, PLAN-AMPLITUDE-SCAN §3 — amplitude took value's `--mode all`
slot; value is now explicit-only via `--mode value`/`--mode invest`, relabelled **Invest**; `reverse` is
explicit-only too, an ownership-gated SEPARATE branch — see its lane below). A candidate
survives: **gate → validate → rank/grade → render** (reverse is the exception — its own gate/table, below).

**The cycle-period frame (PLAN-AMPLITUDE-SCAN §1).** band / **amplitude** / invest are ONE operation —
buy the low of the N-period cycle, sell the high, capture the amplitude minus tax — at three cycle
periods (2h / **multi-day, ~4d** / multi-week); the longer the hold, the more the pricing leans on historical
trajectory. ⚠ Amplitude's slot in that frame read **24h** until DT1 (2026-08-09) MEASURED the 24h premise
and refuted it — completion within 24h given entry was 4.8%, median ~69h — and re-horizoned the lane to
a multi-day horizon (`AMP_HOLD_DAYS_DEFAULT` in `js/amplitudescreen.mjs` is the live number,
`--hold-days` overrides it). The survivors are the multi-DAY oscillator class, not a daily one. churn (a buy-limit-throttled volume×spread lap) and scalp (a falling-regime directional bet)
sit OFF that axis. The three amplitude-axis lanes share a shape: an amplitude-of-cycle edge, a
two-sided-liquidity + reach viability test, a trough-entry/peak-exit pricing doctrine, a knife/trend
guard scaled to the period, and a capital-aware rank — they differ only in WHICH data grain defines the
cycle (band's 5m band walk / amplitude's per-item 1h daily range / invest's daily-archive term structure).

**The amplitude lane (`--mode amplitude`, console-only, provisional n≈0).** A big-ticket that oscillates
~a few % *daily* (Masori-body class) never surfaces in band: band prices the 2h band (so the ~day-long
swing reads ~0% at the 2h grain) and ranks `net × P(fill) ÷ TTF` (which buries a day-long fill at
P~0.06 / ttf~26h). Amplitude sees it. **Two-stage gate** (`js/amplitudescreen.mjs`): Stage-1 a cheap
ATTENUATED daily-range proxy off the bulk 6h archive picks the fetch pool (exactly like `proxyDrift`);
Stage-2 the exact `amplitudeGate` off ONE full-day `windowStats(series1h)` — the recent-median after-tax
daily amplitude floor (~2% PLACEHOLDER, on the taxed median-per-day basis, which reads lower than the raw
hi↔lo range), the both-leg daily reach (the quoted trough-bid TOUCHED and peak-ask REACHED on ≥2 of
recent-3 days OR ≥ half the full window, `staleOptimistic`-guarded — ⚠ but at the DEFAULT 0.5/0.5 quantiles
this is NOT a reachability read at all: the level is the median of the very days it is scored against, so
the full-window disjunct holds by construction and the test reduces to `!staleOptimistic` (measured
identical on 670/670 legs, 2026-08-09). It bites only BELOW 0.5 (`--amp-bid-q`/`--amp-ask-q` < 0.5 — above 0.5 the level is touched even more often, so it stays inert)),
and a trend/knife guard (`hourProfile().trendDominates` + the warm 1h trajectory — a trending item's
"amplitude" is drift). **The margin-below-floor gate (PLAN-OSCILLATION-CYCLE Chunk 3 — THE ONLY GATE
in that program, sequenced LAST after trend/knife):** reject when the drift-adjusted margin
`afterTax(driftAdjustedPeak) − entry − AMP_DRIFT_REQ_MARGIN <= 0` (`amplitudeDriftMargin` off
`driftExitFrom`'s forward diurnal+multi-week-drift peak projection, computed ONCE at the gate stage and
reused for the Chunk-2 shadow-log). **DIRECTION-AGNOSTIC by construction** — the margin is the SIGNED
consequence of the drift NUMBER, so a single `<= 0` comparison rejects a down-drift AND an up-drift
identically (NO `if (slope<0)` branch). This is the mechanism that rejects BOTH a fang down-leg (the
forward peak fell below entry) AND the Aldarium "rising floor" mirage (the margin rides the fading
CEILING, never the rising FLOOR — a rising floor is never rewarded). Degrade-OPEN: a degraded projection
(thin days / refused forecast) is NOT a reject. The **knife guard is TEMPERED** by
`forecast.oscillationVsKnife` — a raw knife that the detrended-mid detector reads as *oscillating* (a
drift-riding oscillator, not a monotone collapse) is NOT dropped as a false knife; it falls through to the
margin gate, which admits it only if its drift-adjusted margin clears the floor (this LOOSENS the knife
guard, safe because the margin gate has final say). Every threshold is n≈0 PLACEHOLDER — the margin gate is
the make-or-break gate itself, "do not trade on this yet." F-A (2026-07-22) redesigned `oscillationVsKnife`
itself — a walk-forward backtest found the original first-difference flip-fraction metric mislabeled
fang/blowpipe's real shape (smooth multi-day up/down runs) a false knife; the fixed version detrends the
same way but counts REAL detrended legs (≥`OSC_MIN_LEG_DAYS` long, amplitude clearing the noise floor)
instead of day-to-day sign flips — `js/forecast.mjs`'s header comment on the function has the full finding.
F-H (2026-07-22) DECOUPLED the detector's lookback from the gate's: the redesigned detector needs ≥1.5
cycles / ≥3 legs to fire OSCILLATING, so at the gate's `AMP_NIGHTS=14` daily window a real oscillator that
has recently entered a prolonged down-leg reads a false KNIFE on that short slice. `renderAmplitudeMode`
now feeds `oscillationVsKnife` a SEPARATE, LONGER trailing window (`OSC_DETECTOR_NIGHTS=21` >`AMP_NIGHTS`,
`js/forecast.mjs` — its own `windowStats(...).days` off the SAME in-hand `ts1h`, NO new fetch) while the
GATE keeps `AMP_NIGHTS` for `amplitudeRanges`/reach AND the `driftExitFrom` slopes — so the detector gets
more history WITHOUT widening the gate's daily-range/reach/recency read (a deliberate SIGNAL-RECENCY
separation). HONESTY: the wiki `/timeseries?timestep=1h` endpoint returns only ~16 calendar days, so
`OSC_DETECTOR_NIGHTS` effectively caps near ~15d on real data — a sample-size fix BOUNDED by the endpoint,
not a calibration. All still n≈0.
PP-R extended the watchlist reserve to the BAND stack (band/churn/scalp), which had none — a
watchlisted-but-unheld item ranking below the fetch cutoff never reached a flip-niche TABLE, and its
candidates never even carried the `watched` flag the reserve selects on. Scope: the item was still
quoted, graded and published by the always-on watchlist pass (§S3); what it lost is the lane — the
churn/band partition, the Path-A sort, the per-flip-niche validator stack, the digest and its
per-flip-niche `screen.json` row. Unlike amplitude's it is
BOUNDED (`WATCH_RESERVE_DEFAULT`), sized off the logged count of watchlist candidates that cleared the
gate and were still excluded per pass — not off the watchlist's length, which the reserve can never
reach. Excluded-past-the-bound rows report `watch-reserve-full`. Reaching the fetch pool remains just
that: the row still faces the falling doctrine and every post-fetch gate.
F-B (2026-07-22) added a WATCHLIST RESERVE to the Stage-1 fetch-pool cut (`AMP_TOP_DEFAULT=40`,
`pipeline/lib/signal/gatecandidates.mjs`/`admission.mjs`): a big-ticket on `watchlist.json` now bypasses the
Stage-1 amplitude-proxy floor and gets a guaranteed fetch slot even if it ranks below the top-40, so it
actually reaches this margin gate instead of being silently crowded out every scan (it can still be
dropped by the gate on its real numbers — the fix is REACHING the gate, not a free pass through it).
PLAN-FETCH-POOL-SCALING (2026-07-24, blindspot-audit #1/#7) generalizes the reserve/sizing story across
all lanes. Finding #7: the value lane had NO fetch-pool reserve at all — a big-ticket with a strong cycle
but low `limitVol` is buried by the composite `valueScore` and never fetched. Fix = **`VALUE_RESERVE`**
(default 6, `gatecandidates.mjs` `rankAndSlice` + `admission.mjs` `pickFetchPool` — BOTH admission paths):
prepend the highest raw cycle-amplitude-% (`valueRanges.afterTaxAmpPct`, a DIFFERENT key than the composite
cut) of the excluded remainder, tagged `via:'reserve'`, additive-only (mirrors the thin/rising/watch
reserves; the footer prints `+ N amp-reserved`). Finding #1: the fixed slot counts (`TOP`/`THIN_RESERVE`/
`VALUE_TOP_DEFAULT`/`AMP_TOP_DEFAULT`) are capital-blind, so on a big-bankroll night a real winner ranked
outside the slice never gets fetched. Fix (opt-in behind **`--scale-pool`**, default OFF) = `scaleSlots` —
a sub-linear (sqrt), per-lane hard-capped widening keyed off the SAME `derive-cash-tiers.mjs`
`deployablePool`/`liquidCapital` already in hand, a strict byte-identical no-op at/below `CAP_REF` (100m)
or with an explicit `--top`/`--thin-reserve` override; plus **`TOTAL_FETCH_MAX`** (`clampUnionFetch`) — the
cross-flip-niche fetch-budget ceiling clamping the deduped `--mode all` survivor union, protecting
held/watched/reserve rows and reporting every trim (`total-fetch-max`, never silent). All constants are
NAMED PLACEHOLDERS (n≈0); full specs live in the two module headers.

PLAN-MID-TIER-ADMISSION (MT2, 2026-07-27) added fetch-pool visibility for the non-thin GEAR lane.
**MID-PRICE gear** (~10k–2m mid — Helm of neitiznot, Berserker helm) is too LIQUID to be `thin` (so `THIN_RESERVE` never covers it)
and too LOW-MARGIN to outrank churn commodities on the velocity lane's absolute-`expGpDay` sort — the one
class with neither a reserve nor a winning rank, so it was never fetched at any bankroll. Fix =
**`GEAR_RESERVE`** (default 4, `--gear-reserve`, `admission.mjs` `pickFetchPool`): slots guaranteed to
`gear`-lane (`classifyVolLane`, `volDay < CHURN_VOL_CUT` 20k) candidates from the velocity remainder,
ranked among their OWN lane on the same `expGpDay × trackBoost` axis, tagged `via:'reserve'` — additive,
`0` restores the pre-MT2 pool exactly. It reads the lane off `volDay` (hpv+lpv), never `limitVol`
(min(hpv,lpv) — the thin-side depth), and is FAIL-CLOSED: a candidate with no `volDay` gets no slot rather
than defaulting to gear. Note the **attention floor was NOT the cause** and is unchanged: `MIN_GPD` is a
hard PRE-fetch gate on Stage-1 `expGpDay` which mid-tier gear passes, while the `⚠<floor` marker on the
table measures Path-A gp/day POST-fetch — two different numbers against one constant (MT1). MT3 reports
the exploration reserve's true rotation period on the `crowded out:` line, since 1 velocity slot over
~140 excluded is a ~70h wait per row, not a prompt lottery. INFORM/ADMISSION-ONLY — no grade, rank, or
`screen.json` change; n=0, no mid-tier flip has ever been logged.

**PLAN-MID-TIER-V2 (2026-07-27) — `GEAR_RESERVE` alone did NOT reach the class it targets.** A
re-validation against the live universe found the mechanism sound (purely additive, 0 rows displaced)
but the AXIS wrong: `gear` is a VOLUME lane, so its peer group spans Old school bond (11.88m mid) down
to Mithril keel parts (4.5k), and ranking that by absolute `expGpDay` hands the slots to cheap
high-buy-limit consumables — teleport scrolls, notes, ship parts. Helm of neitiznot sat rank 10/15 and
was never admitted; MT1's "biggest number wins" bias had simply recurred one level down, inside the
reserve's own peer group. Widening `GEAR_RESERVE` 4→10 was REJECTED — it spends 6 more fetch slots to
reach an item scoring WORSE post-fetch (Path-A 420.7k/d, sub-floor) than what 4 slots already deliver
(528k–758k/d, grade B), and contradicts the founding ruling in `admission.mjs`'s own header ("raising
the floor is just papering over the problem — the fix is the ranking dimension"). Fix = **`MID_TIER_RESERVE`**
(default 2, `--mid-tier-reserve`): a SIBLING sequenced strictly after `GEAR_RESERVE`, drawing from what
it left behind, additionally filtered to a **low GE buy limit** (`MID_TIER_LIMIT_CUT` 200 — an existing
per-candidate field, not a new metric) so genuinely GE-restricted items are ranked against each other
instead of against mass-tradeable commodities at limit 10,000+. **`--mid-tier-offset N`** pages to the
next N picks, so a deliberately small default costs nothing in reachability (honest limit: ranks are
recomputed each pass, so it is "next N by CURRENT rank", not a durable cursor). Null limits are
FAIL-CLOSED but never silently — such a candidate is reported as `mid-tier-limit-unknown` rather than
folded into `top-n-full`, because `structural-admission.mjs` deliberately does NOT exclude on null
(~89 newer gear items carry `limit=null`), making this a local exception that must stay visible.
Verified on real data: the low-limit pool is reached, additive, no duplicates.

**⚠ THE SUCCESS CRITERION IS NOT "a named item appears" (owner, 2026-07-27).** MT-V2 was validated by
checking that Helm of neitiznot got admitted. That was the wrong target — it is an ARBITRARY example
of the class and may well be unprofitable. **The actual goal is a candidate pool appropriate to
AVAILABLE CAPITAL**: mid-tier flips are probably not lucrative at high bankroll (buy limit × mid caps
what they can absorb — Neitiznot is ~3.4m per 4h window, i.e. ~3% of a 100m pool but ~34% of a 10m
one), and they should NOT crowd the pool there; they should surface if and when the capital makes them
the right call. Note the RANKING already behaves this way — `expGpDay` is capital-aware via
`THROUGHPUT_CAP_GP` (`capPerWindow = pool / mid`), so low capital naturally promotes cheaper items. It
is the RESERVES that are capital-blind: a fixed slot count is a standing bypass of that ranking and
costs the same at every bankroll. Making the three reserves capital-conditioned is the open follow-up
(PLAN.md Open list) — until then, read a mid-tier row as "this class was given a look", not as "this
class is worth capital right now". Two populations remain unreached and are NOT addressed here —
Berserker helm/Dragon scimitar (pre-fetch liquidity-gated) and Rune platebody (edge-gated). Still n=0.
F-F (2026-07-22) reworked the **Both-leg reach cell** (since DT1b: "Both-leg reach + ROUND-TRIP (measured) + phase"): it now
prints the FULL-window hit count alongside recent-3 for BOTH legs (`recentHit/recentDays·fullHit/fullN`,
straight off `recencySplit`) and appends a **trough-vs-decay phase annotation** (`reachPhaseNote`). WHY:
a 3-day recent window is shorter than the ~7–8d oscillation cycle, so a trough-phase oscillator reads a
low recent reach (e.g. ask `0/3`) at exactly the entry you want — over-implying "sell-unreliable". The
annotation resolves it from three signals ALREADY computed at the gate stage (no new compute/fetch):
`oscillationVsKnife.oscillating` + `driftExitFrom(...).floorSlope` sign + `amplitudeDriftMargin(...).margin`
sign → *oscillating + floor≥0* = "trough phase — floor holding, oscillation intact" (a BUY tell);
*oscillating + floor<0* = "oscillating into a falling floor — drift margin still clears / does not clear"
(by the margin sign); *knife* = "no real cycle to harvest". **DIRECTION-AGNOSTIC**: the knife bucket
carries NO floor-direction word ("decay"/"rising"/"falling") — a rising-floor collapsed-amplitude mirage
(Aldarium) ALSO lands in `knife`, and "decay" there would be a false direction-label. DISPLAY-ONLY —
touches nothing upstream of the gate, no admission/rank change. **Ranked by the STANDARD `net × P ÷ TTF`** at the `amplitude` estimator family
(`js/estimators/families.mjs`: `pFill` = the MEASURED walk-forward round-trip rate (`ampWalkForward`, DT1b — see below; the bare 0.5 prior only below `AMP_WF_MIN_JUDGED` judged entries), `ttf` = the
`--hold-days` horizon prior (4 by default since DT1; `--hold-days 7` for the weekly-oscillator horizon),
`lapUnits` = the deployable-units min) — NOT a bespoke composite. Amplitude picks are patient multi-DAY
plays → they surface under deploy/accumulate, NEVER as act-now rows. Every threshold is a PLACEHOLDER.

**RE-HORIZONED 1d → 4d, and `pFill2leg` REPLACED (PLAN-DIURNAL-TRIAGE DT1, 2026-08-09).** The lane
shipped on a 24h-cycle premise — buy the daily trough, sell the daily peak, hold ~a day — and that
premise was measured and refuted. Running the production `amplitudeRanges`/`amplitudeGate` over 92 items
≥5m and 4,881 item-days: entry fires 56.9% of the time, but **completion within 24h GIVEN entry is 4.8%**
(≤48h 11.4%, ≤96h 22.6%, ≤7d 34.6%), median completion ~69h ≈ 3 days, and EV per entered cycle **−813k**
(48h mark-to-mid, untaxed) with a +48h strand mark of −643k across 2,114 strandings. The old `pFill2leg`
(bid-touch × ask-reach) is a PRODUCT OF MARGINALS whose independence assumption is measured FALSE —
trough-touch entry is adverse selection (unconditional ask-reach ≤48h 43.1% vs 11.4% conditional on
entry), so rows predicted ≥0.25 realized ~5%. Its intended replacement, `cycleCompletion` (`js/amplitudescreen.mjs`), counts the ORDERED event directly
— an entry day whose ask is reached on a STRICTLY LATER day inside the horizon, window-edge entries
PENDING rather than misses, same-day never counting (day buckets can't prove low-preceded-high) — and was
**built, measured on the live board, and REJECTED as a rank input the same day.** It is SATURATED BY
CONSTRUCTION: `ampBid` is the median daily low and `ampAsk` the median daily high, so ~50% of days clear
the ask and over a 4-day horizon P(some later day clears it) ≈ 1−0.5⁴ ≈ 94%. The board read 18 of 19 —
including Saturated heart at 5/5, the item the study measured at 0% within 96h. The root cause is CIRCULARITY, not grain (an initial
diagnosis blaming sub-day grain was wrong): the levels are the medians OF THE DAYS THEN SCORED, so ~50%
clear the ask by definition. The study fitted levels strictly BEFORE each origin day and scored at hour
grain, and **re-running that design reproduces its published numbers exactly** — Saturated heart 0.0%
@96h (n=41), Masori chaps 12.9% @24h (n=31) — so the refutation is confirmed and the study is sound.

**DT1b then rebuilt the estimator on that design** (`ampWalkForward`, `js/amplitudescreen.mjs`): for each
origin day the trough/peak levels are fitted STRICTLY PRE-ORIGIN over the preceding `AMP_WF_FIT_DAYS`, entry is the
first hour of that day whose 1h avgLow touches the bid, and completion is any LATER hour within the
horizon whose avgHigh reaches the ask; unresolved end-of-series entries stay PENDING. It reads the local
1h archive (the live `/timeseries` fetch is ~15 days — far too short) at ~20ms/item, and **it is what
`pFillAmplitude` now ranks on**, falling back to the 0.5 prior only below `AMP_WF_MIN_JUDGED` judged
entries. The board prints it as `round-trip X/Y = Z% ≤4d` in place of the withdrawn `ask-reprints` cell —
showing both would put ~95% beside ~6% for the same item. The effect on the live board is exactly what
the study predicted: **Saturated heart fell A- → D on a measured 0 of 37**, while Fury (16/33 = 48%) held
its grade. The in-sample figure had rated all five rows near 100%. The lane was mis-horizoned, not signal-free: the
survivors are the repeatable multi-DAY oscillator class (Masori chaps 12.9%/24h but 71%/7d; fang ~6–8d).
Reconciles with PLAN-BOTH-LEG-ENTRY's "approximately calibrated" finding (mean 0.102 vs realized 0.116):
that measured the UNORDERED hold-≤1d joint, this measures the ORDERED entry-conditional round trip — both
true, and the product overstates only the ordered one. *Honesty limits: one ~73-day archive era, one update cycle;
completion measured on hourly `avgLow`/`avgHigh` aggregates, NOT executed fills, so every rate is an UPPER
BOUND; item-day clustering ⇒ effective n well below nominal; a MEASURED row carries ~30–50 judged entries
(below `AMP_WF_MIN_JUDGED` the row falls back to the prior instead) — never calibrated.* Note deploy units scale with the horizon, so the re-horizon raised them ~4×.

Forward measurement stays the shadow replay (`join-amplitude-outcomes.mjs`, an UPPER BOUND) + the
realized retro-join (`/analyze`); the shadow ledger logs BOTH a `walkForward` block (the out-of-sample rate
that actually drives P(fill) since DT1b — the one to join on) and the legacy `cycle` block (in-sample and
circular, kept only for continuity with rows logged between DT1 and DT1b). Console-only (excluded from `screen.json`, no app tab).

**The reverse-flip lane (`--mode reverse`, console-only, provisional n≈0 — RF2, PLAN-REVERSE-FLIP).** A
HARVEST-AN-OWNED-ITEM flip-niche, the mirror image of every other lane: instead of deploying capital to buy low
and sell high, it SELLS an item you already own into the diurnal/multi-day PEAK and REBUYS at the DIP —
capital-free (nothing deployed to enter), with a BOUNDED failure mode (worst case, wait for the next dip to
reacquire your own item; no deadline). Its pool is OWNERSHIP-gated — `owned-items.json`
`classification:'keep'` items ∪ `hold-thesis.json` `reverseFlip:true` entries (Ruling §8: the keep set IS
the pool, no per-item opt-in flag) — so it never overlaps the standard fetch universe, and it runs as a
SEPARATE branch (`runReverseMode`) that short-circuits the whole band/churn/amplitude/value pipeline
(provable zero-ripple: the replay goldens are untouched). It fetches each owned id DIRECTLY (the population
is small + ownership-pre-selected, so no two-stage proxy-ordered fetch pool), then routes each candidate
through `gateReverseFlipCandidates` → `js/reverseflip.mjs` `reverseFlipGate`. **The regime read is
INVERTED** (`invertedRegimeGate` re-maps `classifyTrajectory`'s shape): `rising`/`elevated` → REJECT (sell
now, rebuy at a HIGHER floor tomorrow = loses by construction), `knife`/`oscillating`/`based`/`flat` → PASS
(`knife` IS the "falling" case the strategy WANTS — sell high off a hold you'd otherwise ride DOWN, rebuy
lower), `unknown`/short-data → CAUTION. The **rebuy leg is the binding constraint** (the 2026-07-24
Ancestral-hat anchor: a wanted thin item's SELL leg clears instantly on live demand, so a thin SELL leg is
CAUTION-not-reject, but a thin REBUY leg is a real strand risk → REJECT). Its OWN table (not table-v2):
`Item · Live · Regime (inverted read) · Sold-ref/Peak · BE-rebuy · Swing · Gate`, where `BE-rebuy =
sellRef − tax(sellRef)` (any rebuy strictly below it profits after tax) and `Swing` is the peak→dip
amplitude that must clear the tax. Console-only (never writes `screen.json`, excluded from `--publish` by
construction). INFORM-ONLY throughout — it surfaces candidates + the inverted read, never sizes or enters;
Ben places every offer. An empty `owned-items.json` prints a clean "no reverse-flip candidates" message and
exits 0 (never throws).

**Thin big-ticket read handling (RF6, PLAN-REVERSE-FLIP, Ruling §6, 2026-07-25).** The reverse-flip
population IS mostly thin big-ticket owned gear (the Ancestral hat: guide ~55m, ~135–178/d, tranche ~1),
and the STANDARD reads mislead on exactly that shape — a lone standing ask reached only 2/14d looks like
"the price"; the 3-day hourly slope whipsaws on a thin book; a point recommendation is false precision on
an item that wobbles 54–58m intraday. RF6 adds INFORM-ONLY, THIN-ITEM-ONLY display guards, all gated on the
ONE shared predicate `isThinBigTicket(row)` (big-ticket `guide ≥ BIG_TICKET_GP` (10m) AND liquidity-thin —
a clearable tranche ≤ `THIN_TRANCHE_UNITS` (2), OR min-side `vol/d < THIN_VOL_FLOOR` (500)): (1) the
Sold-ref/Peak cell becomes a RANGE `~X–Y` off the pressure-reachable band (`reverseListBandCell`), not a
false-precise point; (2) an ask-reach decay read on the sell-ref (`askReachDecay`/`askReachDecayNote` —
DT3 2026-08-09; was a longer 7-day `THIN_DRIFT_DAYS` drift window until the slope was deleted, and the
window is now the validated 3 days for every item, thin or not); (3) a traded-mid vs standing-ask flag (`trades ~<guide>; lone asks to
<peak>, reached <N/14d>`, `askSpreadFlag`) when a lone ask sits materially above the traded guide and is
rarely reached; (4) the reverse-flip-specific `⚠ rebuy may strand (thin, <vol/d>)` caution (`rebuyStrandNote`
— the rebuy leg is the unreliable one). **Every threshold is a NAMED PLACEHOLDER (n≈0).** Each guard is a
thin-item-only branch — a non-thin (liquid) reverse row renders BYTE-IDENTICALLY to pre-RF6 (empirically
verified). Nothing here gates, drops, or moves a quoted number; it only reframes the read. The predicate +
helpers live in `js/reverseflip.mjs` (pipeline-only-consumed; RF4 will reuse them on the quote/`/schedule`/
`/book` surfaces).

**The reach-vs-margin quantile DIAL (`--amp-ask-q` / `--amp-bid-q`, PLAN-OSCILLATION-CYCLE F-E).** The
peak-ask / trough-bid quote from the daily-high/low quantiles `AMP_ASK_Q` / `AMP_BID_Q` — both `0.5` by
default (the median peak/trough; Ben's KEPT board). `amplitudeRanges(stats, live, { askQ, bidQ })` exposes
them as opts and the `--amp-ask-q` / `--amp-bid-q` flags override them for an experiment run. These are
REACH FRACTIONS, not price percentiles (mind the direction): a LOWER `askQ` = a HIGHER, less-reachable ask
= more margin per fill but a lower round-trip reach — the reach-vs-margin trade-off the dial exists to let
a later retro compare. Absent flag ⇒ the default board ⇒ byte-identical to before. A non-default run is
flagged in the console footer AND lean-logged (`askQ`/`bidQ` in the `amplitudeShadow` block, present ONLY
when non-default) so an experiment run is distinguishable in `suggestions.jsonl` from a default one — the
feed the F-G realized-fill retro reads. n≈0, unvalidated: the dial ENABLES the comparison, it does not
change the default board.

**Per-thesis drift-adjusted-exit notes (PLAN-OSCILLATION-CYCLE Chunk 6 — INFORM everywhere, NO gate).**
The same drift number the amplitude lane gates on is folded into the OTHER theses as an inform note only.
Each surfacing spec carries an optional `driftInform:{label}` registry field; the render paths compute the
drift-adjusted exit ONCE via the SHARED `driftExitFrom` (off data already in hand — the in-hand
`hourProfile` + `windowStats().days`, NO new fetch, forking nothing) and format it through the one pure
`driftInformNote(spec,dae,{entry,fmt})` helper — so the per-thesis wording is REGISTRY DATA, never an
`if (mode===…)` branch. DIRECTION-AGNOSTIC (reads `driftAdjustedPeak`, a signed number, with no branch on
its sign; a ±same-magnitude drift moves the note by the identical arithmetic). NONE of these gate — each is
a sibling console note (`ℹ drift-exit` in band/churn/scalp, a timing/trajectory line in invest), never a
gate/drop/grade/`screen.json` input:
F-C (2026-07-22): each thesis now feeds `driftExitFrom` its OWN real hold horizon instead of the
oscillation-forecast blanket 1.5d default (`OSC_HOLD_HORIZON_DAYS` — NOT the amplitude hold, which DT1 re-horizoned to 4d) — band/churn/scalp use `DRIFT_INTRADAY_HOLD_DAYS` (~2h, the
screen's own Bar-E band window), value uses `DRIFT_VALUE_HOLD_DAYS` (14d, the same multi-week window
the value gate's own term structure already reads). This was a real GAP (band/churn/scalp were
overstating the drift shift on an hours-long flip; value was understating it on a multi-week hold),
found by the main session's audit of F-A/F-B. Generic per-item contexts with no known thesis (a bare
quote, the Trends page) keep the honest generic default — the rendered clause always shows the actual
horizon it used, never a hidden hardcoded number.
- **band** — the drift-adjusted band TOP, priced LOWER on a down-drifting item; the item is NOT excluded,
  its sell target is just the drift-shifted top.
- **churn** — a "don't buy near the drift-adjusted weekly high" MAGNITUDE caution (folded into the label;
  `DRIFT_NEAR_HIGH_FRAC` = 0.02 placeholder).
- **scalp** — sharpens the exit-pricing note on scalp's already-accepted falling regimes; admission UNCHANGED.
- **invest (value)** — informs the value-amplitude proximity read as a NUMBER (does the drift-adjusted
  after-tax amplitude still clear the value economics against the buy-low?). EXPLICITLY not a floor relax /
  un-gate — R3b stays dropped; this adds no gate and does not change value admission.
Every threshold is n≈0 PLACEHOLDER. Console-only → no `js/trends.js` consumer, no APP_VERSION.

**Drift-adjusted exit on EVERY price suggestion (PLAN-OSCILLATION-CYCLE Chunk 5 — INFORM, display-only,
APP-VISIBLE).** The same drift number is folded into the ONE shared trajectory/floor-ceiling note path so it
rides beside *every* price suggestion, not just amplitude/big-ticket holds. `formatFloorCeiling`
(`js/windowread.mjs`) gains an optional `drift` opt — a `driftAdjustedExit()` result the CALLER computes via
the SHARED `driftExitFrom` off its in-hand `hourProfile` + `windowStats().days` (NO new fetch; windowread
never imports forecast — the caller passes the pre-computed numbers, respecting the one-way arrow). It renders
a `drift-adj exit (~1.5d hold): peak ~X / trough ~Y` clause — a projected LEVEL, NEVER a rising/falling
verdict (direction is only ever the sign of the shift upstream, never a word). Wired on the console at
`quote-items.mjs` (both the bare-quote and `--positions` trajectory note, via `pushTrajectory`) and
`read-window-range.mjs` (the `--trajectory` and DAILY TRAJECTORY blocks), and — the app-visible half — in
`js/trends.js`'s `renderForecast` (the "Forward forecast" section), which shows the drift-adjusted peak/trough
beside the naive next-trough/next-peak readout. Degrades cleanly: a null/degraded projection omits the clause.
Display-only — never a gate, verdict, grade, or price input; `APP_VERSION` bumped (like R2/R3) because it
reaches `js/trends.js` rendering. Pinned by `pipeline/test/oscillation-render.test.mjs`.

### Gates
- **Two-sided liquidity (S1).** `hpv>0 && lpv>0` (the non-negotiable ghost-spread lesson) AND
  `limitVol ≥ --floor` (3500) **OR** gp-flow `limitVol×mid ≥ --gp-floor` (4.5b). The gp-flow path
  admits big tickets, flagged `thin`, grade-capped A- (`THIN_GRADE_CAP`), bounded to `--thin-reserve`.
- **Traded-band gate (Bar D).** The 2h band edge must be TRADED, not a one-spike artifact — density
  (`tradedWin`, one-sided OK) is decoupled from two-sidedness (`sawLow && sawHigh` once across the
  window). Home: the `bandCore` header in `js/flip-niches.mjs`.
- **Band-edge robustness (Bar E).** A lone flier must not set an edge and inflate ROI: `robustBand`
  takes p90/p10 on a DENSE side (≥ `BAND_EDGE_MIN_SAMPLE`), the raw extremum on a SPARSE side. The
  momentum tell stays raw. A **system-wide discipline** — trim to a quantile on a dense side, keep
  the raw extremum on a sparse one, wherever a price EDGE comes from a bag of prints (the value flip-niche
  q15/q85 week-edge twin is the other instance). Full spec: the `robustBand` header in `js/quotecore.js`.
  - *Ask-headroom signal (inform-only):* when the robust p90 shaved a TRADED in-band top off the
    quoted ask (`rawBandHi > optSell`, dense side, not a breakup), a `⤴ ask headroom` note says
    "ladder the ask up, don't relist down." Never moves a number, gates, or grades.
- **250k attention floor (S1).** `--min-gpd` (250k since 2026-08-08 — lowered from 500k with the expUnits 6→2 refill haircut, which had let gpDay flatter cheap churn) drops sub-floor `expGpDay` pre-rating (Ben's
  "never surface sub-500k" — his original directive, at the then-500k floor); thin gp-flow qualifiers and held/asked items exempt. `expGpDay` is
  **capital-aware** — `expUnits` caps the per-window buy by what the derived `deployablePool` affords
  one tranche of, so the floor measures real capital throughput, not capital-blind market capacity
  (byte-identical when one buy-limit tranche is affordable; binds only on expensive/big positions).
  `--throughput legacy` restores the capital-blind value. Home: `pipeline/lib/signal/gatecandidates.mjs`.

### Falling doctrine — per-strategy, not global
A faller is not necessarily a poor buy ("we cannot judge falling without its history and typical
fluctuations"). Each flip-niche declares its own `falling` doctrine: **band/churn EXCLUDE** fallers
(the default); **scalp ACCEPTS AND REQUIRES** them (a deliberate intraday flip expects a falling wide
band; a non-falling scalp is a band flip → dropped `notFalling`); **value KNIFE-GUARDS** (reject a
decay/downtrend knife, accept a flat/basing value-low). Resting bids follow suit: `offerVerdict` is
path-aware — a bid under a declared scalp/value-hold thesis cancels only on its own tripwire, not on
the falling regime alone. **Exception:** items Ben holds / asks about / watchlists are ALWAYS shown
(the S3 Watchlist section quotes each as a full row, floor/gate-exempt, with the reason a gate would
have hidden it as a Note).

### Validators (P2/P3) — `js/validate.mjs`, on every surface
A registry of pure `(ctx) → {status: pass|caution|reject, reason, evidence}` checks. Screens DROP
`reject` rows (counted in `--stats`) and FLAG `caution`; explicit asks / held / watchlist rows are
NEVER hidden (a fired flag is a Note + a lean `validators` field on the ledger).

**Gate vs inform is declared per-thesis** (`spec.validators` in `js/flip-niches.mjs`, as
`{key,mode,window}`): the COMPUTATION is thesis-agnostic, but the ACTION is `gate` (caution flags,
reject drops) or `inform` (computed, annotated as an `ℹ` note, status clamped to pass, the
would-have verdict logged). Only a thesis that GATES on a key lets it hide a row — the noise
reconciliation. The registry:

| Validator | Reads | Labels / action |
| --- | --- | --- |
| `reachValidator` | the 1h series (reach/touch + RC1 stale split) | rarely-reached → caution, never → reject; scores BOTH legs (patient ask + patient bid) |
| `trajectoryValidator` | the daily-mid SHAPE (`classifyTrajectory`) | **knife** → reject · **oscillating**/**based** → pass · **elevated** → caution. **INFORM everywhere as of 2026-08-08** — it gated in `value` from 2026-07-09 until forward-scoring found the premise inverted: knife **+4.08%** excess 28d return (p=0.001) vs `rising` **−7.28%**, `declPct` monotone the wrong way, and the hold-asymmetry it rested on fails (extra upside +2.68pp vs extra downside −0.78pp). The signal is real and discriminating — it predicts short-horizon **reversal**, and the gate was rejecting the favourable end of it. A would-reject knife is now **tier-demoted BUY-NOW → WATCH**, never dropped. Caveats: 71 days = one regime, and post-update **gear** dumps (the losses that actually hurt) are invisible at this n — that needs an event study, not a shape gate |
| `floorValidator` | the durable multi-week floor (`termStructure`) + (R3) the daily-mid `recentTrend` | how far above the 28d floor the buy sits, in the item's own typical-swing (IQR) units: **> 1.5 swings → caution** (`FLOOR_CAUTION_RANGES`, **MEASURED 2026-08-08** — was 1.0; the 1.0–1.5 band carried P(drawdown ≥ 1 swing) of 12.0% vs 29.8% above it. Moving the line is a **precision/recall trade**: it silenced 69.6% of firings AND 48.0% of the real DD ≥ 1-swing events — recall kept 52%, precision 17.4% → 29.8%. Honest effect size is **~8–11pp** on a fixed-percent threshold, about half what the swing-unit table suggests — the swing-unit outcome shares terms with the bucketing). The reject tier (2.0) is **unmeasured in band/churn** — its own gate censors the evidence (a reject row is dropped before the ledger; rejects DO fire in the screen's `rejected:` footer). It predicts **drawdown, not loss**: 7-day returns are flat across every elevation bucket, and the floor it names prints only 6–8.5% of the time in 48h, so the reason states the expected dip, not "durable support". (R3, additive-only) a falling `recentTrend` tightens an already-elevated buy (caution→reject, borderline-pass→caution) — **unmeasurable from the ledger (its escalation censors its own arm: ranges-matched overlap is zero) and the only way floor drops rows**; never relaxes a clean low pass |
| `valueAmplitudeValidator` | the recent-week after-tax amplitude + proximity-to-low (robust q15/q85) | value flip-niche BUY-side; inform |
| `limitValidator` (LM1) | the rolling-4h buy-limit window | exhausted → reject, nearly-spent → caution; a null limit is never "unlimited" |
| `dipPostureValidator` (DP1) | the last-3h 5m low DIRECTION (`recentDirection`) | inform-only, band+churn: still-falling/flat → pass, reverting → caution **"past the bottom"** — an ENTRY-QUALITY note (how far the live bid sits above the 3h low), *not* a fill-probability claim. The old "bid likely misses → cross or pass" advice was **falsified and removed 2026-08-08**: the reverting bid is reached MORE often than the falling one (85.7% vs 82.6% @8h, n=5,535). Evidence + why: the MEASURED block in `recentDirection`'s header (`js/quotecore.js`) |

Rollout: `reach`/`value-amplitude`/`trajectory` are inform **everywhere**; `floor`+`limit` gate.
(`trajectory` gated in `value` 2026-07-09 → 2026-08-08; demoted back after measurement — the row
above has the numbers.) Reach/trajectory fire NOW off the warm
1h-derived shape (`trajectoryFrom1h`, `lib/warm-term-structure.mjs`) while the daily archive warms.
Thresholds are named PLACEHOLDERS. `validate.mjs` is app-imported (Trends), so a behavior change
bumps `APP_VERSION`.

### Rank + grade
The per-thesis column is `Rank net·P/ttf` (P6b): **rank = net after tax × P(fill at the quoted pair)
÷ (TTF + K)** (`estimateRank`/`rankScore` in `js/estimators/families.mjs`), at the ONE pair the thesis posts. `expGpDay` survives only
as the cheap pre-fetch pool orderer + the 250k pre-filter. Grade letters (`rating.mjs`) are
placeholder cutoffs.
- **TTF SATURATES (G5, PLAN-GRADE-REWORK):** the fill-speed term is `1/(days + TTF_SAT_DAYS)`, not a raw
  `1/days` floored at a minimum. TTF is the most-leveraged, least-measured input (always a prior in
  production), so an extreme near-zero TTF can no longer unboundedly inflate the rank — the transform is
  still monotonically decreasing in TTF (a slower flip never ranks higher) but BOUNDED as TTF→0 (→1/K).
  `TTF_SAT_DAYS` is a named placeholder (n≈0); the old `TTF_FLOOR_DAYS` divide-by-tiny floor is retired.
- **The grade layers a risk MULTIPLIER (geometric mean, G4):** `score = round(rank × geomean(factors))`,
  where the factors are `regime · mom · liq · confidence` — each ∈ (0,1]. The GEOMETRIC MEAN (G4/O6)
  replaced the raw product so four sub-1 haircuts no longer compound into an over-harsh discount. The old
  per-unit-price `capitalFactor` is **DELETED** (G2/O3) — at current capital a big-ticket lane is no
  longer penalized for costing more per unit (the deployable-capital rank fold that would have made the
  rank itself capital-aware is a deferred follow-up, not shipped here; the rank stays per-unit for now).
  The breakdown penalty lives in ONE place — the rank's `pFillIntraday` — since G4 dropped `momFactor`'s
  duplicate `mom==='breakdown'` branch (it was double-counted); `momFactor` keeps only breakup chase-risk.
- **P(fill) is two-leg:** `P = P_bid × askReachFactor(askReach)` — the entry fill discounted by the
  cross-day ASK reach (a robust p90 top can reach only ~2/14 days; the same inform-mode reach number,
  zero new fetch). Paired with a `REACH_GRADE_CAP` so a rarely-reaching ask can't oversell the LETTER.
  **The two P's on a row are labeled (EF1(c), PLAN-ESTIMATOR-FIDELITY):** the Net cell's probability is
  the ASK LEG only and prints `P(ask)~X%`; the Rank cell's `P~` is the two-leg product, and when it
  collapses to 0.00 the console names the collapsed leg (`P~0.00 (bid leg)` — the only path to a 0.00
  product is a ~0 entry leg, since `askReachFactor` floors at 0.25). Same row, two different questions —
  no longer two contradictory unlabeled numbers.
- **A dead bid gets a REPRICED-ENTRY alternative, not just a buried row (EF1(a)):** when the entry-leg P
  collapses below `DEADBID_PFILL_FLOOR` (0.10, PLACEHOLDER n≈0) on a REAL reach read while the sell leg is
  scored, the screen prints a `↻ repriced entry` line — the pair re-evaluated with the entry at the live
  crossable level, sell unchanged, WITH the sell leg's reach evidence inline (the DHCB guard). It is a
  labeled ALTERNATIVE only: the headline rank/P and every sort stay the honest dead-bid numbers (R-1)
  until EF0(c) scores the band-low-bid class; a lean `repriced` shadow rides `suggestions.jsonl`.
- **The four grade caps live INSIDE `rateItem` (G1, one chain).** `applyGradeCaps` applies the ceilings in
  one fixed order (harshest last wins): `THIN_GRADE_CAP` (A-) → `PHASE_BASING_GRADE_CAP` →
  `SUBFLOOR_GRADE_CAP` → `REACH_GRADE_CAP`. Before G1 only the thin cap lived in `rateItem` and the other
  three were stacked at the screen render site, so a returned grade was provisional (Flaw 7); the render
  site now passes the cap VALUES/flags in and `rateItem` returns the final letter.
- **`cappedBy` names which ceiling bound the letter (R7, legibility).** `applyGradeCaps` records which cap
  actually LOWERED the printed letter (last-binder-wins) as a single `cappedBy` field
  (`thin`/`phase-basing`/`sub-floor`/`reach`, or absent when the raw grade stood) — logged to
  `suggestions.jsonl` for retro segmentation + surfaced as the grade-cell tooltip. Legibility only, never
  a gate/rank/grade input (the caps themselves are unchanged; this just NAMES the binding one).
- **`(thin)` confidence MARKER (G6/O5) — mark, don't shrink.** When a row's fill call rests on a thin
  reach SAMPLE (`pFill.n < CONF_THIN_N_FLOOR`) the render appends `(thin)` to the letter — the
  score/grade/ordering are UNCHANGED, it's a marker only (deterministic, no magic shrinkage). It keys off
  the pFill reach `n`, NOT the ttf `n` (always the prior in production → would mark everything) and NOT
  placement/IQR (a price's POSITION and the band WIDTH are orthogonal to how many observations back the
  proportion). Distinct from the gp-flow `thin` CAP and suggestlog's `liqClass` `thin` — three triggers,
  one label, disambiguated by the tooltip. The app Finder passes no `n`, so it is never marked.
- **Churn's exemption is PLACEMENT-BOUNDED (EF1(b), PLAN-ESTIMATOR-FIDELITY — supersedes the
  unconditional AC5/AC6 form).** A `fillShape:'symmetric'` (churn) row skips the ask-reach discount, the
  `REACH_GRADE_CAP`, the overnight P-weight, the digest reach/trend read AND both `estimatePair` price
  folds **only while its quoted ask sits inside the 14-day daily-HIGH distribution** (placement ≤
  `MIRAGE_PLACEMENT` 0.85, or no read — `symmetricExemptionHolds`, js/estimators/families.mjs). The
  exemption exists because the day-level reach read mismeasures a TIGHT lap; an ask ABOVE the distribution
  has left that premise (the Sapphire-bolts mirage: churn #1 at P~1.00 while its ask printed 1/14d), so it
  takes the standard `askReachFactor` discount + cap + fold, its reach caution tokens return, and the
  screen prints the pre/post rank on the row (`⚠ exemption dropped — rank X (was Y)`, the R-1 visible
  swap; lean `exemptionBounded`/`rankPre` shadows ride `suggestions.jsonl`). CAVEAT (integer-tick laps):
  a one-tick band's ask IS the daily high, so it reads p100 by construction and trips the bound — but its
  genuinely-high reach makes the applied discount a no-op (factor ≈ 1, numbers unchanged; the swap note is
  suppressed when nothing moved). In-distribution churn rows are byte-identical to the AC5/AC6 behavior;
  read the rank/grade (not the Est. reach token) for an exempt churn row's fill risk.
- **Value + amplitude compute their own pair** (`fillShape:'symmetric'`, surface-computed, so the
  ask-reach discount isn't double-applied). Amplitude's `pFill` is the MEASURED walk-forward round-trip
  rate (`ampWalkForward`, DT1b) — it already CONTAINS the ask leg, which is what keeps the symmetric
  exemption sound (it was briefly unsound between DT1 and DT1b, while pFill was a bare prior with no
  exit leg in it at all); amplitude rows are
  thin-class by construction (big tickets enter via gp-flow) so they carry `THIN_GRADE_CAP` (A-).
- **Churn ranks the LAP, not the unit:** `net/u × min(limit, feasibleDepth) × P(fill) ÷ TTF` (we max
  the buy limit on commodities, so the exact limit is a fact). In `--mode all`, churn (volume lane) and
  band (per-unit lane) are DISJOINT by margin — churn drops any row clearing `--min-roi`, band shows it.
- **Asymmetric fill (inform):** the ideal flip is a rare deep entry + a near-certain exit; the
  symmetric p10/p90 pair is 50/50. A `◆ asym fill` line shows the day-level deep-bid → high-reach-ask
  pair (`asymPair`) with `P_ask` (the rank weight) and `P_bid` as "rest as optionality" (never a rank
  multiplier). `--asym` flips the whole objective but is F1-gated OFF (it silently downgrades the
  default-on publish; an explicit `--publish --asym` hard-refuses). **Reading the counts (2026-08-12):**
  they are PAST TENSE and IN-SAMPLE — `printed 12/14d` is a tally over the days that fitted the quantile,
  not a forward fill rate. When an ordering guard binds (the live instabuy/instasell has already passed
  the patient level) the clause names the quoted price and the measured level separately —
  `ask 220,200 (= live instabuy, above the 218,500 level that printed 12/14d)` — because the count
  belongs to 218,500, not to 220,200. It deliberately makes NO execution claim about the guarded price:
  whether `P_ask` is a floor there (the leg transacts now) or a mild overstatement is unresolved, and on
  a bound row the `⊙ reach/placement` note prints reach at the quoted price on the same basis — read that
  number rather than transferring this one. Doctrine:
  the `asymEstimate` header in `js/estimators/reach.mjs`.
- **Path-A gp/day is the CONSOLE PRIMARY sort; the grade is a shown BACKUP + live A/B (PLAN-LANE-ADMISSION
  Chunks D+E, owner decision H4).** On the band/churn console + last-report tables the surviving rows are
  now sorted PRIMARILY by **Path-A after-tax intraday-flip gp/day** (`pathAGpDay`, `pipeline/lib/signal/patha.mjs`
  — the CALIBRATED intraday-range base rate: `median(per-day after-tax range) × captureFrac × throughput`,
  reusing the ONE `tax()`/`expUnits`). `rateItem`'s grade is still computed EVERY run and shown in its own
  `Path-A gp/d*` column BESIDE the Grade column, so a divergence between the two is visible on every pass
  and a revert to grade-primary is a one-line comparator swap (`comparePathARows` → `b.score − a.score`).
  The existing **250k `MIN_GPD` attention floor is a post-rank SURFACING partition, NOT a new gate** — rows
  whose Path-A gp/day clears it sort on top by Path-A; rows below it (or with no intraday range → `no-pathA`)
  sink beneath, keeping their grade order, surfaced not dropped. captureFrac (0.45 gear / 0.62 churn) is an
  **unproven PLACEHOLDER** (n=13/12, own-book-biased — the `*` in the header flags it) under validate-in-real-use;
  the forward-accrual (`pathA` field on `suggestions.jsonl`, Chunk E — `{gpDay, marginU, captureFrac, cyclesDay,
  units, price, intradayRange, lane, rankInLane}`) is the formal validator/revert-trigger, not a precondition.
  Path-A is the primary sort for the STANDARD scan (active/auto posture); the two SPECIALIZED console reranks
  keep their own order (`--posture overnight`'s net-over-velocity accumulation board, `--pressure-exit`'s
  trial) — Path-A is still computed, shown, and logged on those rows, only the sort defers.
  **CONSOLE / last-report ONLY** — the published `screen.json` (and the deployed app) keep `rateItem`'s grade
  + the NEUTRAL sort UNCHANGED (the `--publish` return is frozen on the pre-Path-A order); a later
  post-validation chunk promotes Path-A to the app. So no `APP_VERSION` bump.

`--posture overnight|active|auto` (S2) TUNES the stack (not a new flip-niche): overnight keeps only
flat/rising + confident-band + non-thin + non-breakdown, ranks net-over-velocity, drops
`overnightStaleRisk` items, and prints the **Overnight accumulation & capital** table (COD-2).

---

## 4. Pricing an entry — WINDOW-CLEAR

Days-reach ≠ within-window clear. A level can reach 12/14 DAYS yet only print in a 2h nightly spike
that's already behind you today. So price every entry backward from the exit:

1. **Name the exit window** — a 4h churn lap, or a diurnal-spike window (`read-window-range.mjs
   --profile` / the Diurnal timing block).
2. **Quote the reachable-IN-WINDOW ask** (RC1 recency-honest), not the raw band top.
3. **Back-solve the buy:** `node pipeline/commands/read-window-range.mjs "<item>" --window <peak
   hours> --exit <ask> [--margin <gp>]` — it prints the tax-exact max profitable buy
   (`maxBuyForExit`) AND how often that exit prints in the window; a low reach means the exit
   over-states the sell, so pick a lower one.
4. **Project today** — is the window ahead or already printed? (the forecast eta, §5.)

When the dip/peak summary isn't enough — sizing a large position, or a break-even that looks stranded —
`read-window-range.mjs "<item>" --hourly [--days N]` prints the RAW per-LOCAL-hour LOW/MID/HIGH grid (a
7d-avg median block + the last N dates individually). It's the hour-by-hour detail the two-window summary
distills away (it caught a churn item whose break-even sat above its typical hourly high, and a secret
+7% one-day breakout). Inform-only, n≈0 — a diagnostic, never a gate.

**The per-hour drift slope — DELETED 2026-08-09 (PLAN-DIURNAL-TRIAGE DT3). Do not rebuild it.** From
2026-07-24 to 2026-08-09 this section described `hourlyDrift` — a per-hour day-over-day least-squares
slope over the last N (default 3) local dates, with a whole-item `uniform`/`split` synthesis, a `Δ/d`
column on `read-window-range --hourly`, a compact note on every price-recommendation surface, and a
strategy-aware relabel that flipped a `fill-now` band/churn digest verdict to `⚠ falling — verify (~X/d)`.
**It was measured and it carried no information.** Leakage-clean out-of-sample scoring of the production
code at its shipped days=3 config: median per-item MAE **276.7bp vs 197.8bp** for simply predicting no
change, beating that baseline on **6 of 380 items**, and direction at **49.7%** — a coin flip. No window
length rescues it (days=4/7/14 all lose), an hours-anchored window is just a cleaner measurement of the
same non-signal, and a dynamic window's own selected length changes day-over-day for the median item on
43% of days. That is also why `THIN_DRIFT_DAYS = 7` never worked: the "thin book whipsaw" it patched was
the n=2 fit itself, not the window. The slope, its constants, the `Δ/d` column and the digest relabel are
all gone; the digest verdict is now always the computed verdict. *Honesty limits on the refutation: one
74-day era, one update cycle, item-day clustering ⇒ effective n well below nominal. A strong null, not a
proof of impossibility.*

**What survived: the ask-reach decay read.** The one genuinely predictive piece was buried inside the
deleted read as a trailing clause, and is now its own export — `askReachDecay(series1h,{days,ask})`
(`pipeline/lib/market/hourly-lmh.mjs`, off the SAME 1h series, zero new fetch). For a candidate ask it
scores the per-day RATE of hours whose HIGH reached that level, and whether the rate is sliding. Measured
out-of-sample it predicts next-day ask reach at **12.2% vs 30.8%**, and survives stratifying on
yesterday's reach (at prev 70–100%: 18.6% vs 68.3%; n=5,096 signals / 293 items — one 20-day eval window,
a synthetic ask level, and reach-of-high is a FILL PROXY, not an executed fill, so it bounds a real
offer's experience from above). This is the catch the whole family existed for: the Ghrazi rapier anchor
(2026-07-24, graded A- fill-now on "ask reached 14/14d" while the ask had already stopped clearing
intraday) is a decay catch, not a slope catch. The shared renderer `askReachDecayNote`
(`js/windowread.mjs`) prints ONE compact line
(`ask-reach decay: ask 25.3m reached 75%→46%→27% of each day's hours (sliding under)`), and **only when
it fires** — a non-decaying or ask-less read stays silent rather than padding every surface with a null
clause. It renders on `read-window-range.mjs --hourly` (the summary line; the raw per-day L/M/H columns
remain and are exactly the eyeball job the `Δ/d` column automated badly), `quote-items.mjs` (a bare
ask/bid quote and every held/watched big-ticket position), `screen-flip-niches.mjs --digest` (a BOUNDED
enrichment on the top-X picks ONLY, after ranking — the 1h-series fetch is too heavy pre-rank), and
`--mode reverse`'s thin big-ticket rows. INFORM-ONLY, n≈0 — it never gates, prices, ranks, or feeds a
cut/alert input, and it no longer alters any displayed verdict. `/schedule`'s reverse-flip rows lost their
drift note outright: that surface never had an ask level to score reach against, so the surviving read has
nothing to say there (the generic pre-rendered note slot on `reverseFlipCycleNotes` remains, unfed, for a
future BID-decay read). The rest of the RF4 reverse fold is unchanged — each declared in-flight cycle
(`reverse-flip-state.json` `awaiting-rebuy`/`rebuy-armed`) is still surfaced INFORM-ONLY into `/schedule`
(`reverseFlipRows`), `/book` (`book-model.mjs` `buildReverseFlipPending`), and `/positions`
(`reverseFlipPositionLines`), carrying the thin-item rebuy-strand caution + a `REBUY_STALE_DAYS` nudge;
zero-ripple — an empty store renders NOTHING extra on every surface.

Any scored `--bid`/`--ask`/`--exit` run also prints a **three-part `fold:` line** (PLAN-ESTIMATOR-POSTURE
AC8 + PLAN-ESTIMATOR-HONEST-SELL E3, 2026-07-22): `best-case ask X · honest net ±N · P(fill)~p%[ (recent-3
q%)] · list at F (~Nd hold, conf) · reach-fold Y (secondary — phase-blind) (recent a/b · full c/d)[
reach-fold floored to BE …]`. The **honest margin** (raw best-case net, NEVER BE-clamped to `+1`) + its
**P(fill)** (`askReachFactor` on the **full-window** basis since 2026-08-09 — with the **recent-3** value,
the freshness read it no longer applies, printed in parentheses **only when the two differ**, so a basis that
moves a displayed number is visible rather than silently swapped) lead; the **forward "list at F"** (`driftExitFrom`, phase-aware,
`n≈0` inform) is the actionable price; the **reach-fold** rides labeled secondary/phase-blind (the
correct read for a confirmed knife — on a KNIFE `driftExitFrom` degrades to a labeled trend-only level, no
crash). All from the SHARED `estimatePair` (zero new fetch — byte-parity with the screen's fold).
`--niche band|churn|scalp` (default band) picks the spec; churn inherits the AC5/AC6 exemption so its line
reads fold ≈ best-case (unconditionally HERE — this surface passes no `askPlacement`, so EF1(b)'s
placement bound never fires on it; the bound lives on the screen, which does). Rides
`--json`/`--out` as `result.fold`. Never gates — pair it with the reach/placement/depth reads.

`windowClear` (`js/windowread.mjs`) fires an inform-only `ℹ window-clear` note when an ask reaches on
DAYS but rarely IN its peak window. Band-is-the-edge: on a liquid stable-regime wide-band item, ladder
buys at band lows / sell at band tops (never below break-even). Full judgment: the `/scan` skill's
WINDOW-CLEAR PRICING step.

**"Reached" is the 1h bucket AVERAGE crossing a level — not a ceiling on a resting order; read the
PERCENTILE PLACEMENT alongside it (Finding 3, 2026-07-17; AC4a shipped the placement read).**
`reachedDays`/`touchedDays` (`read-window-range.mjs --ask/--bid`) count days where the hourly average
print touched the level, which is a stricter bar than what a small resting order actually needs to
fill. Pricing an ask ABOVE the recent average is how a flip makes money, not an anomaly — a low raw
reach count alone is not grounds to reject a level. **`read-window-range.mjs` now reports the level's
placement in the trailing daily-high/low distribution beside the reach count** (e.g. `--ask 398 →
reached 1/14 · placement p93 of the 14-day daily-HIGH distribution`), and, where the archive has 5m
coverage, a less-smoothed 5m-grain reach/placement alongside (labeled; a LOWER BOUND on the true gap
per AC2). The placement is PURELY DESCRIPTIVE — it says where a price sits historically, NOT that it is
"achievable" or "safe". There is deliberately **no "safe ≈ pXX" threshold**: AC3's calibrated
liquidity-scaled safe quantile did NOT ship — its gate failed (the Finding-2 size-share knee is
unobservable on our own fills; `PLAN-REACH-CALIBRATION.md` AC1 "GATE RESULT: NOT MET"). Anchor:
Soul rune's own ~20+ closed lots filled at 397–399 while `--ask 398` reads "reached 1/14, recent 0/3"
on the smoothed 1h grain — yet placement p93 and, on the less-smoothed 5m grain, reached 3/7 · p57
(upper-middle of the printed band): the raw 1h count read as a warning on a liquid, thick book where
the real fill risk was near zero, exactly the trap the placement read now surfaces.

**The DEEP-BOOK half of that judgment is now ENCODED — read the `⊙ avg-bound read` clause, don't
perform the conditioning by hand** (`avgBoundRead`/`formatAvgBound` in `js/windowread.mjs`, rendered on
every scored `--bid`/`--ask`/`--exit` and mirrored into the `--json`/`--out` dump as `avgBound`). The
smoothing bias is **depth-proportional**: a 1h bucket on a deep book averages tens of thousands of
prints, so its mean sits structurally above the intra-hour minimum and below the intra-hour maximum,
and the gap GROWS with liquidity. So the same low count means different things at different depths —
near-harmless at ~180/day, badly misleading at ~655k/day. The clause fires only when the limiting-side
`volDay` clears `REACH_RELIEF_MIN_VOL` (100k — the SAME documented deep/thin boundary `reachRelief`
already uses, reused rather than forked) **and** the hit fraction is low; it names the averaged basis,
prints how far the level sits beyond the most extreme daily average against AC2's measured ~0.36–0.56%
smoothing bias (itself a LOWER BOUND), surfaces the in-window competing pool, and on the bid side adds
the gloss that a LOW placement is a deep patient entry rather than an extremity warning. It is
INFORM-ONLY (n≈0) and gates nothing. **The THIN-book side stays judgment**, and its output is
byte-identical to before — stay close to the centre of the distribution there, since a single artifact
print is easy to mistake for a real level. That asymmetry is pinned by test in
`pipeline/test/windowread.test.mjs`; it is what stops the fix causing the opposite error. Why it was
encoded at all: the rule had been written down twice (here and in `/scan`) and was skipped anyway —
on 2026-08-05 a live read killed Ruby dragon bolts (e), Seeking dragon arrow and Seeking amethyst
arrow (349k–750k u/d) off bare `touched 0/14 · p0` lines.

For a **big-ticket HELD lot** (lot value ≥ `BIG_TICKET_GP` = 10m, or a watchlist member), this whole
ask-side "typical exit" read is **auto-surfaced on `quote-items.mjs --positions`** as the `↗ windowExit`
note — the list-price reach/placement, the daily-HIGH typical-exit levels (~50%/~75%/every-day + recent-3),
live-instabuy-vs-list, the 5m-grain reach, and the diurnal peak window the level prints in — so a positions
review answers "will this list clear soon, in which window?" without a manual `read-window-range.mjs --ask`
call (PLAN-POSITIONS-WINDOW-READ). One shared assembly (`js/windowread.mjs` `askExitRead`) computes it for
both surfaces; the held-lot note is zero-extra-fetch (the 1h series is already in hand) and degrades to
`window read unavailable` if that series is missing — never blocking the table/verdict.
The surfaced rung is no longer discarded after rendering: WC1 (PLAN-WINDOW-CLEAR-OUTCOMES, 2026-07-20)
shadow-logs a lean **`windowExit`** field to `suggestions.jsonl` on every big-ticket held row — the
surfaced list level, the diurnal peak window, and BOTH competing reach signals side-by-side (daily-HIGH
1h reach AND the less-smoothed 5m-grain reach, each with its placement; `fiveReach:null` when the 5m
archive is thin — never faked). So the question the two signals pose — for a resting ask into a peak
window, is daily-high reach or 5m-grain reach the better fill predictor? — becomes ANSWERABLE: the WC2
join `pipeline/commands/join-window-clears.mjs` (LANDED 2026-07-26) reads those `windowExit` records and
marks whether the placed rung actually filled inside its window (it did NOT before — the note was rendered
to the human and thrown away). It classifies four outcomes — `UNPLACED` (a surface Ben never placed — a
COUNT, EXCLUDED from every fill-rate, so it can never fabricate a "no-fill"), `PLACED_NO_FILL` (the
floor-night negative), `PLACED_FILLED_IN_WINDOW`, `PLACED_FILLED_OUT_OF_WINDOW` — over the reconstructed
sell campaigns, with a nearest-prior + ASYMMETRIC-price-gated attribution (extra room below `list` for
Ben's just-under-round-number asks) and the surface→placement lag/gap diagnostics that will calibrate its
n≈0 horizon/tolerance placeholders. This is data accrual only (n≈0, weeks to accrue); it moves no
price/verdict/grade and endorses NEITHER signal — the reach-signal comparison rollup (WC3) is still gated
on accrual, and F1/Ben own that call.

**Multiple offers on the SAME item are a queue, not independent rungs (Ben, 2026-07-16).** The GE
matches a buyer against the cheapest compatible offer first, so a higher-priced ask on an item you
also have a lower ask resting on is structurally queued behind it — it cannot fill first, and its
"time to fill" measures queue position, not that price level's own demand. Design a multi-price
test (or any deliberate ladder) as a **rolling 2-deep queue** — the front rung live + the next
queued behind it by price, advancing one step each time the front clears — never as several
simultaneous independent rungs on one item.

---

## 5. Time-of-day & forecast

- **Diurnal timing (auto).** `screen-flip-niches.mjs` runs `js/windowread.mjs` `diurnalTimedLap` on
  EVERY flip-niche survivor (PLAN-DIURNAL-TIMING DT2, 2026-07-23 — was top-picks-only; zero extra fetch,
  the 1h series is already in hand) and prints a **Diurnal timing** block via the ONE shared renderer
  `pipeline/lib/render/emit.mjs` `formatTimedLap` (also `quote-items.mjs`'s DT3 call site, so
  `screen-flip-niches.mjs` and `quote-items.mjs` render byte-identical diurnal text off one
  definition, not several that can silently disagree). Two shapes off
  **`windowReliability`**'s split-half verdict (DT4, 2026-08-10 — this line said "`hourConcentration`'s
  verdict" until then, contradicting the second bullet immediately below it; that predicate was measured
  NOT to discriminate and since 0.73.0 no longer picks the shape on ANY surface, console or app):
  - **Clean cycle** — the stale-guarded BID (recent dip-window level, priced to LIVE when a dominating
    trend erases the dip — the Ghrazi lesson) and ASK (recent peak-window level), the TIMED trough→peak
    net/roi AND the SAME-HOUR/churn `instantNet` (both always shown — they can diverge hard on a
    big-ticket item: a live fang row printed `timed +964.5k/u` beside `same-hour -21k/u` on the same
    row), the ask−bid range, bid/ask window-reach (`N/M` days), the hold horizon, and the base
    floor/ceiling trend direction.
  - **Unreliable / unverified hours** (DT4, 2026-08-10 — SUPERSEDES the old `range-churn` shape): the
    LEVELS, both nets, range, reach and base ALWAYS render; only the dip/peak HOUR spans (and the
    hold horizon, which is an hours delta) are withheld when the item's daily shape fails the
    split-half reliability gate. The line closes with `hours MAY repeat most days` (passed), `levels only —
    no reliable hours` (measured fail) or `levels only — hours unverified` (too little history to
    judge). ~0.8% of the board passes. The old `range-churn — no timing edge` frame is GONE: it keyed
    on `hourConcentration.clean`, which was measured NOT to discriminate (clean=true dip +5.0pp vs
    clean=false +3.6pp), and it hid the levels along with the hours. See CHANGELOG 0.72.0.
  All shapes append a liquidity/tranche segment (`vol/d · dip-pool · peak-pool · tranche ~X clean · ~Y
  price-knee`, 0.5%/1% of `volDay` off the n≈6 reach-relief knee, borrowed not validated for diurnal) and a
  `⚠ buy limit … exceeds the round-trip price-knee` caveat when sized past it. **Two things this segment is
  NOT, both of which have been misread off it:** it is a PRICE-QUALITY knee, not a clearing cap (the borrowed
  study measured price degradation with lot size, never whether the quantity fills), and it is a ROUND-TRIP
  bound (`volDay` = min(hpv,lpv), so the tighter leg governs both numbers — a one-leg sell of held stock is
  bounded by `peakPool` alone, which on a lopsided book is several times larger). Ground truth, n=2 items:
  two one-leg sapling sells cleared 146 and 200 units at 4.0%/4.5% of min-side `volDay`, 8x/4x the printed
  numbers, with no failure to fill; price quality at that size was not measured, so this refutes the clearing
  reading and leaves the knee itself unmeasured. **Up to one ADDITIONAL elevated AND one
  additional depressed window may render** (PLAN-MULTI-PEAK-WINDOWS, 2026-07-23) as trailing `also ASK …/also
  BID … — second elevated/depressed window (n≈0, inform)` clauses on the SAME line — when `hourProfile`
  finds a SECOND local extremum per side clearing the `SECOND_PROMINENCE_FRAC` topographic-prominence gate
  (e.g. an item with a reliable-reach overnight peak AND a higher-ceiling afternoon peak). Inform-only, n≈0
  — never gates/prices/ranks; the primary window read is unchanged. **Each emitted peak/dip also carries a
  `reality` level-check** (PLAN-DIURNAL-RECENCY-GUARD, `js/windowread.mjs` `computeReality`): when the quoted
  level was inflated by a recent 1–2 day spike over-generalised into "typical" it appends `⚠ spike-top`, and
  when it's an old high the recent regime no longer reaches it appends `⚠ stale`, each trailing a
  recency-honest `typical ~X` (the recent-window q55 to quote instead — note the COMPACT `short` style
  actually prints `⚠ spike-top ~1,828`; only the `exit`/`full` styles spell out the word "typical").
  Inform-only, n≈0 (PLACEHOLDER thresholds) — it flags the level, never rewrites it or gates.
  **No longer console-only** (Chunk 2c, 2026-08-13): the flag now also rides the WRITE side into
  `suggestions.jsonl` and `verify.json`, which is what makes it measurable at all. Each line still carries the **`⏲`
  diurnal-PHASE entry-timing token** (`js/windowread.mjs` `diurnalPhase`, preserved from the pre-DT2
  block) — where NOW sits in today's cycle vs the peak window: `in-peak (closes ~Xh)` /
  `pre-peak (opens ~Xh)` / `post-peak — cooling, next peak ~Yh → starter size` (only the cooling case
  appends the sizing hint). INFORM-ONLY, n≈0 placeholder — it never gates/regrades a pick; it flags a
  post-peak/cooling entry AT entry so a full-limit buy into a fading window is caught (the blowpipe miss
  — maxed the limit as the peak closed → 5u stranded ~16h). STDOUT-only (the diurnal block never reaches
  `screen.json`); a degraded/unpriceable lap renders nothing (§7's softened contract — every survivor is
  COMPUTED, only a row with something to say PRINTS).
  `quote-items.mjs`'s bare-quote path now renders the SAME richer `diurnalTimedLap`/`formatTimedLap`
  note under the `diurnal` NOTE_KIND (PLAN-DIURNAL-TIMING DT3, 2026-07-23 — superseded the old raw
  `hourProfile`+`deriveDiurnalRange` BID/ASK/net-roi line; `prof`/`dr` themselves stay in the file,
  feeding `extraEst.diurnal`, the window-clear peak window, and the forward E4 inputs — only the
  RENDERED note changed). DT3 also swaps `watch-positions.mjs`'s two direct `hourProfile`+
  `deriveDiurnalRange` call sites (the shadow-log bid/ask co-log, the `diurnalAsk` cycle-fallback exit)
  onto `diurnalTimedLap` — those are value consumers, not note-render sites, so only the underlying
  computation moved, the numbers are unchanged. `read-window-range.mjs --profile` prints the full
  hour-by-hour table, plus the raw split-half `r` values and — when an explicit `--nights` moves the fit
  off the gate's own window — a `⚠ window mismatch` note, because that surface answers the caller's
  chosen window rather than silently refitting to the gate's (DT4b follow-up, 2026-08-10). The app's
  Trends tab now gates its `★` on the SAME `windowReliability` verdict the console gates hour-display on
  and prints a plain-language `Timing check:` line carrying the tri-state; its lookback toggle gained a
  14d option and defaults to it, so the hours drawn are the hours judged. _(Superseded in place: this
  sentence used to say "the app renders the pre-DT2 shape in Trends (DT5, not yet landed, reconciles
  `js/trends.js`'s own local `clean` predicate onto `hourConcentration`)" — DT5 landed at 0.68.0 and was
  itself superseded at 0.73.0, since `hourConcentration.clean` is a measured non-discriminator.)_ This is
  the ENCODED form of the manual windowrange dance — read the block; the manual read is now a CONFIRMATION.
- **Base position (multi-week, PLAN-DIURNAL-TIMING DT6, 2026-07-23), inform-only, n≈0.** The diurnal
  read above is intraday/recent (a 3-day `lowTrend` slope at most) and structurally cannot see the
  MULTI-WEEK shape — a live session proved this insufficient on its own: a bludgeon read "+180k flip"
  (scan-smoothed) → "knife" (3-day grid) → "low end of a mean-reverting range, a value level" (the
  multi-week base) — only the third call was right; a fang read similarly went "oscillator at a floor"
  (14d) → "decaying oscillation in a downtrend" (multi-week). `screen-flip-niches.mjs` now prints a
  **Base position** block on every band/churn/amplitude survivor: `<item> — base pXX of the 14d
  range · <range-bound|trending↑|trending↓|decaying>`. `pXX` is live's percentile position between the
  raw low/high of the 14-day daily-mid lookback `termStructure()` already computes (`js/termstructure.mjs`
  `ts.lookbacks[14].pctInRange`) — the SAME field `classifyTrajectory` already reads for its
  `elevated`/`based` calls, so the percentile can never silently diverge from the label beside it. The
  label is a 3-way coarsening of `ts.trajectory.shape` (`based`/`flat`→range-bound,
  `rising`/`elevated`→trending↑, `knife`→trending↓, `oscillating`+a falling `recentTrend`→decaying,
  `oscillating` otherwise→range-bound) — done by the new pure `js/termstructure.mjs` `basePosition(ts)`
  helper, rendered by `pipeline/lib/render/emit.mjs` `formatBasePosition`. **Single-source, not a second
  computation**: `termStructure(daily[id])` is computed ONCE per row (the SAME call `renderMode` already
  makes for `floorValidator`; `renderAmplitudeMode` now makes its own single call too, since amplitude's
  gate never touched the daily archive before) and handed to `basePosition` as a pure read of the
  already-derived structure — the value flip-niche is deliberately NOT wired to this (it already renders
  its own durable-floor proximity + phase tag via `valueRanges`/`phase()`, off the same underlying
  `termStructure` call). `days` in the note is the REAL 14-day lookback horizon actually computed off
  the on-disk daily archive (`DAILY_DAYS` = 17d for band/churn/amplitude's shared `loadDaily` call, 28d
  only when the value flip-niche runs standalone) — never an aspirational 90d; a full 90-day 6h drill stays a
  MANUAL look for a big-ticket hold decision, out of scope here. Degrades to no line (never a fabricated
  percentile) when the archive is too thin (`< BASEPOS_MIN_POINTS` mids in the 14d window) or the shape
  is `unknown`. STDOUT-only, never a gate/price/rank/`screen.json` input.
- **Soft-buy (ADD-while-holding) timing, inform-only, n≈0.** `quote-items.mjs` prints a `⏳ soft-buy`
  line beside each held lot (and on bare quotes) off the SAME `hourProfile` — `js/windowread.mjs`
  `softBuyRead`/`formatSoftBuy`: `soft-buy: floor ~X · live @floor | +X% · <cue> (<hours clause>)`.
  The hours clause is DT4-GATED (2026-08-10): `attended dip hours HH:00–HH:00 · MAY repeat most days` when
  `windowReliability`'s split-half `min(rLow,rHi) ≥ 0.6` (~0.8% of items), else `no reliable dip hours`
  (measured fail) or `dip hours unverified` (too little history to judge). The floor + cue always RENDER, whatever the gate says — but on a PASSING row the floor does MOVE (DT4b refits those rows over the gate's 14-day window; hours and levels are one fit). It is unchanged on the ~99% that don't pass. The **floor** is the dip-cluster level — the number you place at, and since DT2 it LEADS
  the line; the marker is `@floor` when live sits ≤ `SOFT_BUY_AT_FLOOR_PCT` (0.5%) over that floor (or
  below → **buy now**) vs `+X%` above it. It fills the gap the decision-digest soft-buy COLUMN leaves —
  the digest excludes held items, so it was blind to mistiming an ADD to a lot we already hold (Dragon
  boots into the daytime peak ~350k over; blowpipe at 10.67m vs the 10.40m dip). Doctrine: holding to sell
  into a LATER peak is not a reason to sit idle on the BUY side. Mirrors the digest column's threshold so
  both reconcile onto one helper. Never gates/regrades; null 1h series ⇒ no line.
  **DT2 (2026-08-09) — the window does NOT time a resting offer.** Until this date the above-floor cue was
  the bare word `wait`, meaning "wait for the dip window to come round." Measured at the production dip
  level, P(touch inside the predicted window | touched at all) is **71.2% vs 70.5% for a random window of
  the same width** — the window carries essentially nothing about WHEN a resting offer fills (independently
  confirmed: first-touch timing of a resting bid shows no window concentration, 14.6% vs 15.9%). Waiting
  therefore forfeits **~29% of bid fill-days at an identical price**. The window predicts WHERE the daily
  extremes land, not WHEN an offer fills. So the cue now reads *rest the bid at the floor now* and the
  window moved into a trailing parenthetical explicitly labelled **attended** — it is for market-TAKING
  while at the desk, not for delaying a resting bid. The cue KEY stays `'wait'` (callers/tests key on it);
  only its meaning and wording changed. *Honesty limits: one 74-day era, one update cycle; touch measured
  from hourly `avgLow`/`avgHigh` aggregates rather than executed fills, so it bounds a real offer from
  above; item-day clustering ⇒ effective n well below nominal.*
- **Forward forecast (PF1, inform-only, n≈0).** `js/forecast.mjs` `diurnalForecast(profile, ctx)` projects
  the next 12/24h → `nextTrough`/`nextPeak` (level, band, eta, window, confidence) + `whenBuyable`/
  `whenSellable` — the "not buyable/sellable at a good price now, but ~X in ~4h" answer (`quote-items.mjs`
  fires these as `ℹ forecast` lines: buy-timing for any item, sell-timing for a held lot). Claims ONLY
  the recurring diurnal shape + a dumb trend extension; DEGRADES LOUDLY (spike/decay, live band
  violation, thin series) and never forecasts a shock. Doctrine home: the `forecast.mjs` header.

---

## 6. The scripts — each ask maps to one command

ALWAYS use the scripts; NEVER hand-write a `node -e` fetch for a market read (they all import
`js/quotecore.js`, so the numbers are byte-identical to the app, and an ad-hoc script burns ~1–2k
tokens). The plain-language → command routing table lives in **CLAUDE.md** (it's the immediate
response an agent needs). Current per-script behavior (facts, not doctrine):

- **`quote-items.mjs`** — multiple items in one call; a combined table + a per-item regime line with
  the buy limit (`· buy limit N/4h`, LM1 in-window count), buy/sell pressure (a flow proxy off the
  same 24h fetch — never a gate input), and a `⚠ feed inversion` footnote when the basis is unreliable.
  A **`⚠ stale live print`** note fires when a displayed live instabuy/instasell is an OLD `/latest`
  print rather than a live tick — aged past `QUICK_FRESH_MIN` (~15m, the DISPLAY/PACE freshness bar)
  but still under the 90-min `STALE_QUOTE_MIN` reliability floor, so the quote stays reliable while
  the number carries its age and points at the fresher side. This is a distinct signal from the
  reliability gate: the floor answers "is this even a price?" (→ NO-READ); the fresh bar answers "is
  this a live tick I can quote / pace off as-is?" (the 64-min godsword that rendered as live and drove
  a false lagging-pace read, 2026-07-21). The reach-margin `pace` read prints `pace n/a (live Nm stale)`
  rather than a bogus comparison when the driving side is stale (spec: `js/quotecore.js` `QUICK_FRESH_MIN`).
  `--positions` adds Held@/Break-even/Verdict + the shared `item-context.mjs` chain (offers book,
  read-only watch-state + hold thesis, `renderHeldVerdict`, the read-only `Paths` block, the rebid
  advisory, the stale-declared-exit flag). Verdict vocabulary: `pipeline/MONITORING.md` step 4.
- **`screen-flip-niches.mjs`** — one gate stack (above) + `--mode` swaps the step-3 edge; TWO render-stage
  net>0 surface gates drop any row that cannot make money. The
  first reads the after-tax net at the thesis's POSTED pair (`er.net`, the raw basis the rank is built on).
  The second (`spec.admitMinNet`, per-niche) reads `estimatePair`'s honest net at the pair actually
  PRINTED. They disagree whenever the sell model moves the exit — a churn row ranked on a raw +41/u
  rendered a shown sell netting −6/u and still graded S+, because grade follows rank and nothing re-read
  the displayed pair. The second gate NAMES what it dropped in a `skipped: …` footer rather than dropping
  silently: it runs on n≈0, so a wrong drop has to be visible to be safe, and each dropped row is still
  written to `suggestions.jsonl` carrying an `admitSkip` marker so the calibration sample is not censored.
  A dropped row also carries the `asym` shadow (PP0) — the disagreement this sample exists to settle is
  reach-fold-vs-asym, and until that field was threaded the dropped rows could not answer it. Absent on a
  churn skip row by design (symmetric fill shape ⇒ no asym pair) and on every row logged before it shipped;
  `pipeline/lib/render/suggestlog.mjs`'s DATA CAVEATS block is the ONE home for that on-disk split.
  It EXEMPTS held and watchlist rows — the fetch-pool ranker (`rankAndSlice`/`pickFetchPool`, NOT
  `gateCandidates`) reserves them a slot so they reach this gate, and a held row is more likely to read
  sub-BE because only HELD rows also get `surviveMode`'s falling bypass. "Always" is the wrong word for a
  watchlist row on the band stack: its reserve is BOUNDED (`WATCH_RESERVE_DEFAULT`, PP-R), so past the
  bound it is reported `watch-reserve-full` instead — and `null` opts a flip-niche out entirely
  (value/amplitude/reverse render on their own branches and never reach it). **The first gate has NO such
  exemption**: a held row whose posted pair nets ≤ 0 is still dropped there, which is long-standing
  behaviour and not what the code comment beside it claims. Neither gate touches rank, grade, or
  `screen.json` ordering. `--posture` tunes the stack (§3). `--mode all` also runs the DL4 dip-nomination pass
  (`nominateDip` → `dip-watchlist.json`, the "B feeds A" half). A flip-niche empty at the floors re-runs
  beneath it (`subFloorFallback`, grade-capped `C (sub-floor)`, stdout-only). Writing repo-root
  `screen.json` (the app Scan tab) is **DEFAULT-ON every run** (2026-07-16) — `--no-publish` opts out
  (a throwaway filtered console read). An un-calibrated estimator DOWNGRADES that write: `--asym` or
  `--pressure-exit` (`--est-sell pressure`) **silently skip** the publish so an exploration run needs no
  `--no-publish`; only an EXPLICIT `--publish --asym` / `--publish --pressure-exit` combo hard-REFUSES
  (loud stderr + exit — `refusePublishIfNonNeutral`). **`--archive-regime` (AF5b) joins that refusal
  list** — it is a DATA-SOURCE swap, not an estimator: the 6h series behind the **Regime** column
  (`regimeDrift`) and the trajectory `phase()` read comes from the local SQLite archive instead of a
  per-item `/timeseries` call, pinned to the last 365×6h so `phase()` sees live's depth. Prices stay
  live; the flag is OFF by default and byte-identical off. UNPROMOTED and not yet trustworthy for
  `phase()`: the pin cannot ADD depth, so while the archive is shorter than live's 91d the two are not
  same-span (Snape grass reads `spike` live / `decay` archive). On a real `--mode all` pass the regime
  cells matched 121/121 among rows present in both, but one item (Wyvern bones) flipped
  `flat`→`falling/crash-risk` on a hair-width floor break and vanished from the board — so treat it as
  ~1.7% flip risk (the 2/120 crash-risk study), not the 0/165 same-span headline. Committing
  `screen.json` to git is a separate step
  (`sync-fills.mjs --publish`, once-a-day `/overnight`); the local write itself touches no git.
- **`watch-positions.mjs`** — watches every position = any committed capital (held inventory PLUS every
  active GE offer). Output: headline alerts → numbers-only table → per-item note block → summary footer.
  Load-bearing: the **sell/list-at + break-even line is ALWAYS emitted on a held lot** (a fill you
  didn't see may have happened). Bids get rows (BID-OK/BID-BEHIND/CROSSING/CANCEL-BID — only CANCEL-BID
  alerts). The ONE writer of the path fields on watch-state. `--dip` folds `dip-watchlist.json` and
  fires the reactive FLUSH alert (DL2). Full tick contract: `pipeline/MONITORING.md`.
- **`read-window-range.mjs`** — scores the last ~14 local days for a window: per-day low/high + volume,
  bid/ask levels touched/reached on ~50/75/all days, the RC1 recency split (+ `⚠ stale`), the `--exit`
  back-solve (§4), `--profile` (the diurnal read), and `--trajectory` (the recency-weighted forward
  read: per-day low/high table + floor/ceiling slope classification + a forward-projected next-day
  low/high band, from `js/windowread.mjs` `projectTrajectory`; inform-only, n≈0). Shared math in
  `js/windowread.mjs`.
- **`read-trajectory.mjs`** — one-word PRESET over `read-window-range.mjs --trajectory` (all flags
  forwarded); answers "how's `<item>` trending / where's it likely to be tomorrow" (PLAN-SIGNAL-RECENCY R1).
- **`read-buy-limits.mjs`** — the rolling-4h buy-limit read per item (no args → every item bought in
  the last 4h). **`run-loop.mjs`** — the multi-action `/loop` multiplexer (watch + screen on
  independent cadences, scan-gated on deployable capital, a local book-refresh each watch pass).
