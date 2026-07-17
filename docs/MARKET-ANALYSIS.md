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
compute and print it via `renderReport` — the ONE render path, `pipeline/lib/render.mjs`. It formats
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
- **Ordering invariant.** On ONE consistent basis, `optBuy ≤ quickBuy ≤ quickSell ≤ optSell`. A
  break on MIXED bases is a bug — fix the script. On consistent bases a break is a real **momentum
  tell** (the live price left its own 2h band), surfaced as the **Momentum** column off the
  *pre-clamp* comparison: `quickBuy < optBuy` = breaking down / active pullback (don't buy in; on a
  held big-ticket it's a CUT trigger that fires before the multi-day regime confirms); `quickSell >
  optSell` = breaking up / fresh high; in-band = ranging. Strength-graded `–` · `↑/↓` · `↑↑/↓↓`
  (≥ `MOM_STRONG_PCT`). Drives the position cut-trigger via `momVerdict`; NOT wired into the bulk
  Finder rating.

### Console default — `Est. buy` / `Est. sell`
On `screen-flip-niches.mjs` and `quote-items.mjs`, STDOUT replaces Quick+Optimistic with the
reconciliation-estimator pair + `Net/u (ROI)` + `BE` columns (`js/estimators.mjs` `estimatePair`
is the full synthesis: Optimistic ∩ diurnal ∩ reach ∩ anchor ∩ BE-floor). `--raw` restores the
model-free Quick/Optimistic (and `--asym` implies `--raw`). The app + `screen.json` render the raw
table-v2 **decision** cells — the Grade, the rank, and the sort stay F1-gated on the NEUTRAL
estimator — but (PB4 app-display, 2026-07-15) `screen.json` now ALSO carries an ADDITIVE per-row
`reachable` band `{ ask, bid, pressure, reliability, … }`, and the **app's Scan tab renders a
`Pressure (trial)` column by default** (deep reachable bid → bold ask) beside the neutral Optimistic
reference — labeled un-calibrated (n≈0), never a rank/grade/sort input. Operating summary:

- **`Est. buy` is strategy-aware** (`entryDoctrine(spec)`): **scalp** → near-live (bids the
  instasell to fill); **value** → the trough (band low, unfolded); **band/churn** → the band low
  reach-folded toward live. The asym deep bid is never folded in — it stays the `◆ asym` line
  (rest-and-see optionality).
- **`Est. sell`** = a DECLARED thesis exit **only on a held lot** (floored to live, not clamped to
  the band), else the band top folded by reach + a diurnal/asym blend; **BE-floored always**. The
  pure discovery screen NEVER anchors to a declared exit (a bare candidate is a buy read).
- **The sell-top proposal is a NAMED, swappable MODEL** (PC3, `js/estimators/sell-models/`): the neutral
  **`reach-fold`** (default) above, and the opt-in TRIAL **`pressure`** (PB4). `--est-sell reach-fold|pressure`
  selects it (**`--pressure-exit` = legacy sugar for `--est-sell pressure`**); the model only PROPOSES a
  price — the shell keeps the non-skippable floors (ordering clamps, BE floor, declared-exit anchor) so no
  model can price past break-even or the live book. Under the `pressure` model Est. buy/sell become the
  `reachableBand` legs (deep reachable bid → bold reachable ask), reranking the console scan by the pressure
  net; still BE-floored, sell ≥ live, declared exit still wins the sell leg, and a **reliability-gated ceiling**
  lets a fully-reliable read exceed the observed 24h high (reliability<1 keeps the `dayHighFrom5m` cap). The
  conservative depth floor renders beside as the reference; a LOUD banner flags every surface as un-calibrated
  (n≈0). **The `pressure` model is REFUSED under `--publish`** — the deployed app + `screen.json` + the grade
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
  `js/estimators.mjs`.
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
  retro-join can score them head-to-head against the realized sell — the evidence-based, deprecate-then-
  remove migration is architected in `PLAN-REACHABILITY-CONSOLIDATION.md` (nothing retires on theory).
- **Confidence rides IN the price cell** as the recent-3 reach (`0/3`, `recencySplit`) — the
  freshness-honest signal and the fold basis; the full window shows beside it only on divergence
  (`0/3 · 12/14` = stale); `–` = no read.

PLACEHOLDER model (n≈3–14); `estBuy`/`estSell`/`estConfidence` ride `suggestions.jsonl` for F1.

### The other columns
- **Guide** = the real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- **Vol/d** = the limiting side, `min(highPriceVolume, lowPriceVolume)`. It comes from the CORRECTED
  rolling-24h source composed from the `/1h` grain — **the wiki `/24h` endpoint is broken** (a frozen
  stale slice that under-reads the true rolling 24h ~10–27×). Every volume-denominated floor is
  calibrated to the corrected scale. `--vol-source legacy` restores the broken read. Full story +
  the recalibrated floor values: `docs/GLOSSARY.md` "/24h broken" + the `marketfetch.mjs`
  `loadAll24hRolling` header. (The browser app still reads the broken `/24h` until a deferred step.)
- **Net/u** = after the 2% tax. **Regime** = the multi-day `regimeDrift` (flat/rising/falling), with
  a display-only **phase tag** folded in (`spike`/`decay`/`basing`, from `phase()`) — NOT a gate.

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

`screen-flip-niches.mjs` prints one table per **flip-niche** (band / churn / scalp / value — declarative
specs in `js/flip-niches.mjs`; `--mode` selects which run, `all` = band+churn+value). A candidate
survives: **gate → validate → rank/grade → render**.

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
- **500k attention floor (S1).** `--min-gpd` (500k) drops sub-floor `expGpDay` pre-rating (Ben's
  "never surface sub-500k"); thin gp-flow qualifiers and held/asked items exempt. `expGpDay` is
  **capital-aware** — `expUnits` caps the per-window buy by what the derived `deployablePool` affords
  one tranche of, so the floor measures real capital throughput, not capital-blind market capacity
  (byte-identical when one buy-limit tranche is affordable; binds only on expensive/big positions).
  `--throughput legacy` restores the capital-blind value. Home: `pipeline/lib/gatecandidates.mjs`.

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
| `trajectoryValidator` | the daily-mid SHAPE (`classifyTrajectory`) | **knife** → reject · **oscillating**/**based** → pass · **elevated** → caution |
| `floorValidator` | the durable multi-week floor (`termStructure`) | parked well above durable support → reject, marginally-elevated → caution |
| `valueAmplitudeValidator` | the recent-week after-tax amplitude + proximity-to-low (robust q15/q85) | value flip-niche BUY-side; inform |
| `limitValidator` (LM1) | the rolling-4h buy-limit window | exhausted → reject, nearly-spent → caution; a null limit is never "unlimited" |
| `dipPostureValidator` (DP1) | the last-3h 5m low DIRECTION (`recentDirection`) | inform-only, band+churn: still-falling/flat → pass, reverting → caution "cross or pass" |

Rollout: `reach`/`value-amplitude` start inform everywhere; `floor`+`limit` gate; `trajectory`
gates in `value` (the knife-drop) and informs elsewhere. Reach/trajectory fire NOW off the warm
1h-derived shape (`trajectoryFrom1h`, `lib/warm-term-structure.mjs`) while the daily archive warms.
Thresholds are named PLACEHOLDERS. `validate.mjs` is app-imported (Trends), so a behavior change
bumps `APP_VERSION`.

### Rank + grade
The per-thesis column is `Rank net·P/ttf` (P6b): **rank = net after tax × P(fill at the quoted pair)
÷ TTF** (`pipeline/lib/estimators.mjs`), at the ONE pair the thesis posts. `expGpDay` survives only
as the cheap pre-fetch pool orderer + the 500k pre-filter. Grade letters (`rating.mjs`) are
placeholder cutoffs.
- **P(fill) is two-leg:** `P = P_bid × askReachFactor(askReach)` — the entry fill discounted by the
  cross-day ASK reach (a robust p90 top can reach only ~2/14 days; the same inform-mode reach number,
  zero new fetch). Paired with a `REACH_GRADE_CAP` so a rarely-reaching ask can't oversell the LETTER.
- **Churn is EXEMPT** from both (`fillShape:'symmetric'` — a lap sells into continuous two-sided flow,
  so the day-high reach read mismeasures it); the discount + cap apply only to `fillShape:'asym'`
  (band/scalp).
- **Churn ranks the LAP, not the unit:** `net/u × min(limit, feasibleDepth) × P(fill) ÷ TTF` (we max
  the buy limit on commodities, so the exact limit is a fact). In `--mode all`, churn (volume lane) and
  band (per-unit lane) are DISJOINT by margin — churn drops any row clearing `--min-roi`, band shows it.
- **Asymmetric fill (inform):** the ideal flip is a rare deep entry + a near-certain exit; the
  symmetric p10/p90 pair is 50/50. A `◆ asym fill` line shows the day-level deep-bid → high-reach-ask
  pair (`asymPair`) with `P_ask` (the rank weight) and `P_bid` as "rest as optionality" (never a rank
  multiplier). `--asym` flips the whole objective but is F1-gated OFF (refuses `--publish`). Doctrine:
  the `asymEstimate` header in `js/estimators.mjs`.

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

`windowClear` (`js/windowread.mjs`) fires an inform-only `ℹ window-clear` note when an ask reaches on
DAYS but rarely IN its peak window. Band-is-the-edge: on a liquid stable-regime wide-band item, ladder
buys at band lows / sell at band tops (never below break-even). Full judgment: the `/scan` skill's
WINDOW-CLEAR PRICING step.

**"Reached" is the 1h bucket AVERAGE crossing a level — not a ceiling on a resting order (Finding
3, 2026-07-17).** `reachedDays`/`touchedDays` (`read-window-range.mjs --ask/--bid`) count days where
the hourly average print touched the level, which is a stricter bar than what a small resting order
actually needs to fill. Pricing an ask ABOVE the recent average is how a flip makes money, not an
anomaly — a low raw reach count alone is not grounds to reject a level. Judge by liquidity instead: on
a LIQUID/deep book, distrust only a level AT OR ABOVE the item's own historical extreme; on a THIN
book, stay close to the center of the distribution (a single artifact print is easy to mistake for a
real level there). Anchor: Soul rune's own ~20+ closed lots filled at 397–399 while `--ask 398`
reported "reached 1/14, recent 0/3" — the raw count read as a warning on a liquid, thick book where the
real fill risk was near zero. AC4a (`PLAN-REACH-CALIBRATION.md`) will replace this with a
percentile-placement read; until it ships, this paragraph is the guard against re-rejecting a normal
above-average ask off the raw reach count.

**Multiple offers on the SAME item are a queue, not independent rungs (Ben, 2026-07-16).** The GE
matches a buyer against the cheapest compatible offer first, so a higher-priced ask on an item you
also have a lower ask resting on is structurally queued behind it — it cannot fill first, and its
"time to fill" measures queue position, not that price level's own demand. Design a multi-price
test (or any deliberate ladder) as a **rolling 2-deep queue** — the front rung live + the next
queued behind it by price, advancing one step each time the front clears — never as several
simultaneous independent rungs on one item.

---

## 5. Time-of-day & forecast

- **Diurnal timing (auto).** `screen-flip-niches.mjs` runs an hour-of-day `hourProfile` +
  `deriveDiurnalRange` on every surfaced pick (zero extra fetch) and prints a **Diurnal timing** block:
  the stale-guarded BID (recent dip-window level, priced to LIVE when a dominating trend erases the dip
  — the Ghrazi lesson) and the ASK (recent peak-window level), with the after-tax swing; a clean read
  is starred `★`. The shape is de-trended so the trend can't fool the dip/peak detection. `quote-items.mjs`
  prints the same line; `read-window-range.mjs --profile` prints the full hour-by-hour table. The app
  renders it in Trends (TV). This is the ENCODED form of the manual windowrange dance — read the block;
  the manual read is now a CONFIRMATION.
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
  `--positions` adds Held@/Break-even/Verdict + the shared `item-context.mjs` chain (offers book,
  read-only watch-state + hold thesis, `renderHeldVerdict`, the read-only `Paths` block, the rebid
  advisory, the stale-declared-exit flag). Verdict vocabulary: `pipeline/MONITORING.md` step 4.
- **`screen-flip-niches.mjs`** — one gate stack (above) + `--mode` swaps the step-3 edge; a render-stage
  net>0 surface gate drops any row whose after-tax net at its posted pair is ≤ 0 (held/asked/watchlist
  exempt). `--posture` tunes the stack (§3). `--mode all` also runs the DL4 dip-nomination pass
  (`nominateDip` → `dip-watchlist.json`, the "B feeds A" half). A flip-niche empty at the floors re-runs
  beneath it (`subFloorFallback`, grade-capped `C (sub-floor)`, stdout-only). `--publish` writes
  `screen.json` (the app Scan tab).
- **`watch-positions.mjs`** — watches every position = any committed capital (held inventory PLUS every
  active GE offer). Output: headline alerts → numbers-only table → per-item note block → summary footer.
  Load-bearing: the **sell/list-at + break-even line is ALWAYS emitted on a held lot** (a fill you
  didn't see may have happened). Bids get rows (BID-OK/BID-BEHIND/CROSSING/CANCEL-BID — only CANCEL-BID
  alerts). The ONE writer of the path fields on watch-state. `--dip` folds `dip-watchlist.json` and
  fires the reactive FLUSH alert (DL2). Full tick contract: `pipeline/MONITORING.md`.
- **`read-window-range.mjs`** — scores the last ~14 local days for a window: per-day low/high + volume,
  bid/ask levels touched/reached on ~50/75/all days, the RC1 recency split (+ `⚠ stale`), the `--exit`
  back-solve (§4), and `--profile` (the diurnal read). Shared math in `js/windowread.mjs`.
- **`read-buy-limits.mjs`** — the rolling-4h buy-limit read per item (no args → every item bought in
  the last 4h). **`run-loop.mjs`** — the multi-action `/loop` multiplexer (watch + screen on
  independent cadences, scan-gated on deployable capital, a local book-refresh each watch pass).
