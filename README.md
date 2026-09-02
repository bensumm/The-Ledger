# The Coffer — OSRS Grand Exchange flipping tool

**Live: https://bensumm.github.io/The-Ledger/**

A self-contained web app for finding and managing OSRS Grand Exchange flips. Vanilla
JS, no build step, no framework, no bundler — plain static files served by GitHub
Pages. Installable as a PWA (works on desktop and iOS home screen), but primary
development is now on desktop.

Every price/margin in the app is **after the 2% GE sell tax** (floored per item,
capped at 5m, none under 50gp). Price convention follows flipper usage: **Buy** =
the instasell price (where you place buy offers), **Sell** = the instabuy price.

## What it does

- **Finder** — ranks flippable items by a budget-aware **rating** (profit/hr × a
  quality dampener blending ROI, liquidity, stability, and turnaround; hover the Risk
  grade for the per-factor breakdown). Stability here is a cheap live-price-vs-guide
  proxy — the full regime-drift check lives on the Trends page. Sortable by rating,
  profit/hr, margin, ROI, or volume. Typing a **search** query reveals *every* mapped
  match — including cheap items (soul rune ~300gp) the browse-mode price floor normally
  hides; those search-only rows show `—` for the rating columns and lean on the quote
  button + star.
- **Trends** — deep per-item analysis. A live "Suggested plan" (instant buy/sell +
  **patient pricing** that sizes a wider-margin offer off the recent 2h range),
  a **regime-shift guard** that warns when a recent price-level jump makes the
  hourly-timing stats unreliable, a plain-language guide-divergence readout
  ("Why this trend?"), 3-month price history, and a collapsible **timing &
  seasonality** section gated on a walk-forward backtest (hourly charts only appear
  when the timing edge is actually proven out-of-sample).
- **Watchlist** — star items to track their live margins each refresh; the same
  starred set is the repo-shared watchlist the pipeline scans. (The old **Signals**
  tab — live cheap-window buy signals — was removed in 0.57.0; Ben didn't use it.)
- **Ledger** — per-item grouped open/closed positions with after-tax realized/unrealized P/L,
  summarized in the "Coffer" header tiles. Item names link to Trends; multi-lot groups expand via a
  chevron; a "P&L by" Day/Week/Month control on the Closed-flips header drives a period strip whose
  buckets click to filter the table by sell date; the manual-entry form is a collapsible section and the
  closed columns are sortable.
- **Fill-data pipeline** — see `pipeline/` (below): captures real GE trades from
  RuneLite to `fills.json` so the tool can eventually calibrate its predictions
  against actual fills.

## Files

- `index.html` — the app shell (markup only)
- `styles.css` — all styles
- `js/` — app logic as ES modules: `state.js` (shared mutable state as one `STATE`
  object + constants + persistence + diagnostics), `money-math.js` (the tax/margin/bond MATH —
  canonical `tax()`/`netMargin`/`netMarginQty` + the ONE **BOND tax exception**
  `BOND_ID`/`isBond`/`bondFee`: a bond is tax-exempt but pays a 10%-of-guide retrade fee, so
  `netMargin(low,high,{bond,guide})` = `sell − (buy + fee)`, tax-free; plus the generic `clamp`/`now`),
  `money-format.js` (gp/number DISPLAY formatting — `fmt`/`fmtSig`/`fmtP`/`fmtTurn`/`fmtHour`/`fmtHourRange` +
  `ukHourOffset`/`localTzAbbrev`/`pad2`/`parseGp`/`sgn`/`grade`/`gradeCls`; split out of the old `format.js` in the R2
  rename. `fmtHourRange(startH,endH)` labels a diurnal hour-of-day window in BOTH the runner's local zone AND the UK —
  e.g. `01:00–03:00 PDT / 09:00–11:00 UK` — so peak/dip window narration can't slip between the Pacific-local hours the
  tools emit and the UK-driven demand basis; the offset is Intl-derived per instant, DST-correct for both zones), `charts-static.js`
  (static inline SVG — `svgLine`/`svgBars`, fixed-size, no interaction; still used by the
  Trends hourly seasonality charts + the quote sparkline), `charts-interactive.js` (CL — the reusable
  **interactive** SVG chart: `createChart(container,{series,overlay,fillBetween,refs,bands,markers,
  kind,yFmt,xFmt,spans,span})` → `{setSpan,destroy}` handle, with pointer-drag PAN, wheel/pinch ZOOM about the
  cursor, a span selector, y-axis auto-rescale to the visible window, a hover tooltip + crosshair,
  and a `DEFAULT_SPANS` export. Max zoom-in is density-floored (~4 sample points, `medGap*4`) so you
  can't zoom into empty space; explicit span buttons bypass that floor to hit their exact duration.
  Degrades to a no-op on a missing container or empty series. An optional `overlay` second line +
  `fillBetween` shading draws the Forward-forecast low/high CONE (0.61.0; absent config ⇒ byte-identical
  single-series). Consumed by `trends.js` — the **Recent movement** (2h), **Price history** (1/7/30/90d
  windows), **Diurnal timing** (7d/28d toggle), and **Forward forecast** (cone) charts; more surfaces
  adopt it over time. ADDITIVE — `charts-static.js` stays intact), `marketfetch.js` (shared browser fetch layer — one timeout-guarded `jget`
  + one cached `fetchTs`/`fetch24h` store, A2), `market.js`
  (price/guide fetch + scoring; keeps the bond in the catalog — searchable — with a
  bond-aware Finder margin via `bondMarginOpts`; AP4 `desirabilityOf` computes the Finder's shared
  rank + Desirability grade off `js/estimators.mjs`+`js/rating.mjs`. **`vol24Of(id)` (0.74.2) is THE ONE
  HOME for turning `STATE.VOL24` into a daily volume** — every reader goes through it so the
  absent-vs-unavailable rule cannot be re-derived per call site: an item ABSENT from a PRESENT `/24h`
  map traded ZERO (measured — 0.0% of absent items traded during the day the map covers), while a
  null return means the MAP is unusable and the consumer must keep its wide prior. Consumed by
  `desirabilityOf` and by `trends.js`'s item header), `trends.js` (archive + seasonal analysis +
  regime/patient/backtest — renders the Trends view; pure analytics live in
  `trendcore.js`; TV — also renders the **Diurnal timing** section via the shared
  `windowread.mjs` `hourProfile`/`deriveDiurnalRange` + a `charts-interactive.js` bar chart + an
  inform-only `validate.mjs` `reachValidator` note — the same computation the console prints), `trendcore.js` (TC1 — pure DOM-free Trends analytics:
  hourly/seasonal decomposition, the walk-forward `backtestPlan` gate, `patientTargets`
  offer sizing, `bestWindow`/`median`; moved out of `trends.js` for
  `pipeline/test/trendcore.test.mjs`), `quotecore.js` (DOM-free quote model + canonical
  market-table cells — `computeQuote`/`regimeDrift`/`quoteCells`; shared byte-for-byte
  with the node analysis scripts; also home to `recentDirection` (DP1), `flushSignal` (DL2 — the
  reactive liquid-flush firing read, consumed ONLY by `pipeline/commands/watch-positions.mjs --dip`, no app import), and
  `nominateDip`/`reconcileDipPool`/`pruneDipPool` (DL4 — the scan's flush-SUITABILITY nomination + the
  quality-ranked, self-pruning pool write; `selectNominations` is the legacy dedup/cap, retained + tested but
  no longer on the write path — all consumed ONLY by `pipeline/commands/screen-flip-niches.mjs`, no app import);
  also the ONE type-7 quantile/median home (SF-1):
  `quantileSorted` (pre-sorted input) + `quantileOf`/`median` (sort a copy) — `termstructure.mjs`
  re-exports it as `quantile`, `retrojoin.mjs` aliases `quantileOf`; and home to `grossFromNet`
  (PLAN-SALE-LOG-TAX — the EXACT sell-side inverse of `tax()`: the smallest integer `g` with
  `g − tax(g) === round(net)`, found by a ±2 scan around `round(net/0.98)` then `net + TAXCAP` (the
  cap region falls out of tax saturation). NOT `breakEven` (that answers ≥ and lands 1gp high where
  two consecutive `g` share one net — the per-item floor makes ~every-50th pair collide, so an ask at
  an exact-2% point recovers 1gp low: display-only, realised never routes through it; fractional net
  inverts the rounded value). Consumed by the reconstruction + the raw-row display sites to recover
  gross from `.json`-era net `worth`; bond-blind like `tax()` — the quarantined-bond caveat applies),
  `forward-reach.mjs` (the shared FORWARD-SCORING primitives over the 1h archive — `touchedAt` (bid
  side, `avgLowPrice`), `reachedWithin` / `maxHighWithin` (ask side, `avgHighPrice`), `covers`,
  `firstIndexAfter`, and the END-OF-WINDOW bail pair `endLowWithin` / `endHighWithin` off one
  `lastPrintWithin(series, from, windowH, field)` (chunk 4 homed them here; `js/reach-surface.mjs` had
  carried a private `endLowWithin` twin). The two bails are DIFFERENT POLICIES for a seller whose ask
  was never reached — cross the spread into a standing bid (`avgLow`, chunk 1's choice) or rest at the
  ask level (`avgHigh`) — and `join-exit-ev.mjs` measures that they rank contenders differently, so a
  consumer must say which it charges rather than inheriting one. **Lives in `js/` as of PLAN-REACH-SURFACE chunk 0** (it was
  `pipeline/lib/market/forward-reach.mjs`; that path is now a one-line re-export shim so every
  pipeline importer resolves byte-identically, the `pipeline/lib/signal/estimators.mjs` pattern). The
  move is what lets `js/reach-surface.mjs` build the surface from the same walk the joiners score
  with — `js/` never imports `pipeline/`, so a primitive both sides need has to live here. `covers`
  is the load-bearing one: an unresolved window is DROPPED, never counted as a miss, because counting
  it biases every rate DOWN by exactly the truncation at the end of the archive. Side convention is
  pinned by `js/quotecore.js` — a BUY fills against `avgLow`, a SELL against `avgHigh`. Pure: no fs,
  no fetch, no clock; the caller supplies the `ts`-ascending series. ⚠ It is shared by
  `join-asym-outcomes.mjs` + `join-reach-outcomes.mjs` + `js/reach-surface.mjs` ONLY:
  `join-reach-basis.mjs` still carries its own independent `scoreForward` walk, and
  `pipeline/lib/market/printed-at.mjs` a third — so a fix here does NOT reach every reach joiner.
  Consolidating them is unfinished work, not a claim to repeat; `printedAt` additionally has the
  better tristate (`null` when no bucket exists, which `reachedWithin` collapses to `false`)),
  `reach-surface.mjs` (PLAN-REACH-SURFACE chunk 1 — the empirical reach surface **p(ask, H)** for ONE
  item, replayed from its own 1h archive. `buildReachSurface(series, opts)` walks origins every
  `strideH` hours and scores a z-grid of ask levels against `maxHighWithin`, returning the p(z,H)
  grid plus `refHigh`/`disp`, `bailZOnMiss` (the miss payoff, in z), the per-horizon refusal, and a
  reported-never-applied 1h-vs-5m `grainBias`. `surfaceProb(surface, ask, H)` reads a live ask off it;
  `surfaceShape` reduces the curve to z50/z20/spread; `referenceAsOf` exposes the point-in-time
  reference. It re-derives nothing: `refHigh` is `windowread.mjs`'s `recentQuant(days,'ask',0.5,3)` and
  `disp` its `iqr` (exported from that module for this — it was module-local), both fed by
  `windowStats`, whose `pt.timestamp` shape is bridged from the archive's `.ts` here rather than in
  `windowStats`, where every other caller already passes `timestamp`. **Everything is `@provisional-api` until chunk 3's `read-exit-surface.mjs` consumes it** —
  chunk 4 scores the surface before anything prices off it. Four properties are load-bearing and each
  has a killed mutant in `pipeline/test/reach-surface.test.mjs`: (1) **no look-ahead** — `refHigh`/`disp`
  are re-derived at every origin from complete days strictly before it, so a level scored 90 days ago
  never sees day 91; (2) **unresolved windows are DROPPED**, never scored as misses, and an origin whose
  window held no printing bucket is dropped too and COUNTED (`noPrintDropped`) because the archive
  cannot tell a quiet hour from an unfetched one — that drop biases p UP; (3) **refusal is a WIDTH
  bound** — a cell is thin by its **Wilson** half-width (Wald reads 0 at p=0 and would price an empty
  cell as certain), computed on `nIndep` (origins thinned to non-overlapping windows) rather than the
  raw count; a HORIZON refuses on its decision cell, the one nearest p=0.5, because "every cell thin"
  can never fire; (4) **the grain bias is reported, never applied** — passing `fiveMin` must not move a
  grid cell, and `fiveMinCoverage` rides beside every delta since a ~0 delta on a thin item means NOT
  MEASURABLE rather than unbiased. The z axis is `(ask - refHigh)/disp`, not a % grid: a raw
  %-above-median grid inverts the trend split. **z-monotonicity needs no cleanup — it holds by
  construction** (one origin set, one threshold per origin; measured 0 violations in 22,500 adjacent
  pairs, so the specified isotonic pass was deleted rather than shipped inert); the H axis DOES invert
  because its origin set shrinks with H (155 violations over 250 items, max 12.1pp) and keeps a running
  max. **REACH IS NOT FILL** — queue position is invisible in bucketed aggregates, so p bounds P(fill)
  from ABOVE **as a working bound, not a theorem**: the folded plan's §6.1 RETRACTED the theorem
  reading — the 1h-average instrument pushes p the other way on liquid items, so the net error's
  direction is item-dependent there (read it off `grainBias`, never assume it) — and every consumer
  must say so. What chunk 1 MEASURED — including that
  PLAN-REACH-SURFACE §1.5's taxonomy premise did not survive and its ordering inverted — is §1b of
  the folded plan (`git show bdea911:plans/PLAN-REACH-SURFACE.md`, folded into PLAN.md 2026-08-30);
  don't restate it here),
  `exit-ev.mjs` (PLAN-REACH-SURFACE chunk 2 — the inversions that turn a reach surface into a PRICE.
  `evCurve(surface,H,{bailNet,delayCost})` scores every level of one horizon at
  `EV = p·net(ask) + (1−p)·(net(bail) − delayCost)` (tax from `money-math.js`, the ONE definition);
  `askStar` is its argmax, `askForHorizon` the highest level clearing `pTarget`, and
  `horizonForAsk` the SMALLEST horizon clearing it — returned with the full p-by-H row, so the
  threshold never travels alone; p is read through `reach-surface.mjs`'s `surfaceProb`, the ONE
  interpolation, so every row carries its `ciHalf`. Six properties are load-bearing and each has a
  killed mutant in `pipeline/test/exit-ev.test.mjs`: (1) **EV has an interior maximum on real curves** — the property
  the co-log scorer lacked, and without it nothing can rank; (2) **the miss payoff is PER-CELL**
  (`bailZOnMiss`) because that is the conditional expectation the decomposition asks for — and its
  MEASURED DIRECTION is the opposite of the intuition: at a low ask only a catastrophic window
  misses, so E[bail|miss] is WORST there and rises toward the unconditional value as the ask climbs,
  which means per-cell prices at or ABOVE the unconditional form, never below (an earlier version of
  this entry, the module header and the test all asserted the reverse);
  (3) **`delayCost` is charged to the MISS branch only** — on both branches it is a constant at fixed
  H and cannot move the argmax at all, so the asymmetry is what makes waiting cost anything;
  (4) **a maximum on the last SCORED z is a refusal**, not a price (the edge is the scored one, not
  the declared grid — a dropped cell would otherwise pass as interior); (5) **`net()` is the ONE tax
  definition on BOTH legs** — a tax asymmetry is 2% of price, larger than the whole EV spread being
  optimized over; (6) **`horizonForAsk` reads horizons ascending** regardless of grid order.
  Consumed by chunk 3's `read-exit-surface.mjs`, which is why the `@provisional-api` markers are gone
  from every export but `askForHorizon` — that one is now `@test-only` and has no production consumer
  BY DESIGN, since §1c forbids its ask as a price. **`askStar` is an argmax over
  a PLATEAU, not a point** — adjacent cells sit within a few basis points of refHigh of each other,
  decided off a p known to a few pp, so a consumer must present a band and never a false point;
  `read-exit-surface.mjs` owns that. The chunk-2 stop-or-go gate and what it measured live in
  the folded plan's §1c — PLAN-REACH-SURFACE folded into PLAN.md 2026-08-30; full text
  `git show bdea911:plans/PLAN-REACH-SURFACE.md` (don't restate its numbers here — they were, once).
  The one rule to carry out of it: **`pTarget` must never pick a price.** It answers "how long",
  never "how much". ⚠ **And chunk 4 has now measured what `askStar` is worth**: scored against realized
  net gp over the archive it LOSES to a deployed incumbent, decisively enough to fire the plan's
  pre-registered null branch. Everything above is still how the arithmetic works; none of it is a
  reason to price an offer off `askStar`. See `join-exit-ev.mjs`),
  `windowread.mjs` (P2 — pure window-range/reach math:
  **`windowReliability`** (DT4, 2026-08-10 — the split-half hours gate: parity-split the last
  `WINDOW_RELIABLE_NIGHTS` (14) days, `hourProfile` each half, Pearson-correlate the de-trended devLow/devHi
  24h vectors, gate on `min(rLow,rHi) ≥ WINDOW_RELIABLE_R` (0.6, PLACEHOLDER). Returns a TRI-state
  `reliable` true/false/null — null = not measurable, deliberately distinct from a measured fail. Pins its
  OWN 14-day window off the RAW series, never the caller's `nights`. Consumed by `diurnalTimedLap`
  (`lap.reliable`), `formatTimedLap`, `softBuyRead`/`softBuyHoursClause`, the `/scan` digest soft-buy cell,
  `read-schedule.mjs` and `read-window-range --profile`; shadow-logged by `suggestlog.mjs`. DISPLAY-ONLY —
  it gates no grade, rank, verdict or `screen.json` field. It DOES move displayed prices on the ~0.8% of
  rows that PASS: DT4b refits those over the gate's window, and hours and levels come from one fit, so the
  soft-buy floor/diurnal levels shift there — see `displayFitNights`) + `softBuyHoursClause` (the ONE wording
  for the three hours states, `full` + `compact` styles) +
  `windowStats`/`quantLow`/`quantHigh`/`touchedDays`/`reachedDays` + the RC1
  `recencySplit`/`recentQuant` reach-contamination guard + **`askExitRead`** (PLAN-POSITIONS-WINDOW-READ
  2026-07-18 — the ONE ask-side "typical exit" assembly: daily-HIGH q50/q75/every-day levels + the scored
  list-price reach/placement + the ≥`FIVE_MIN_MIN_DAYS` 5m-grain reach; pure over already-computed
  `windowStats` results, so `read-window-range.mjs`'s `--ask` block and `quote-items.mjs --positions`'
  auto-surfaced big-ticket `↗ windowExit` note render from ONE definition instead of re-sequencing the
  primitives) + **`reachMargin`** (the fade check, 2026-07-20 — folded INTO `askExitRead`, so it rides both
  surfaces: the cushion TREND `fading|stable|extending` over the recent `MARGIN_NIGHTS` days at
  `MARGIN_FADE_FRAC`, the current-day cushion, and today's `pace` — live-now vs the reaching-day median at
  this hour-of-day off the in-hand `hourProfile`; symmetric ask/bid, inform-only, placeholders pending F1;
  the lean summary rides `suggestions.jsonl` via `windowExitShadow`) + **`avgBoundRead`/`formatAvgBound`**
  (2026-08-05 — the DEEP-BOOK reach-misread guard: `touchedDays`/`reachedDays` count days the per-day
  extremum of 1h-bucket AVERAGES crossed a level, a bias that is strict IN PROPORTION TO LIQUIDITY, so a
  low N/M on a deep book means "below every hourly average", not "never fills". Fires only when the
  limiting-side `volDay` clears `REACH_RELIEF_MIN_VOL` (reused from `js/estimators/reach.mjs`, never
  forked — passed in as an opt so `windowread.mjs` stays a leaf) AND the hit fraction is below
  `AVG_BOUND_LOW_FRAC`; names the averaged basis, the signed gap to the most extreme daily average
  (read against AC2's ~0.36–0.56% measured smoothing bias), the in-window competing pool, and the
  bid-side "low placement = deep patient entry" gloss. Rendered by `read-window-range.mjs` on every
  scored `--bid`/`--ask`/`--exit` AND mirrored into the `--json`/`--out` dump as `avgBound` (the machine
  path is the point — agents read `verify.json`). THIN books return null and print byte-identically, an
  asymmetry pinned by test in `pipeline/test/windowread.test.mjs`. INFORM-ONLY, n≈0 — gates nothing) +
  the **hour-of-day diurnal profile**
  `hourProfile`/`deriveDiurnalRange` (2026-07-09 — de-trended per-hour dip/peak detection, side-specific
  clustering, and the stale-to-live guard; the peak-timing engine `screen-flip-niches.mjs` auto-runs and
  `windowrange --profile` prints) + **multi-peak windows** (PLAN-MULTI-PEAK-WINDOWS 2026-07-23 — `hourProfile`
  gains ADDITIVE prominence-ranked `peaks`/`dips` arrays (length 1–2); `peaks[0]`/`dips[0]` deep-equal the
  unchanged `peak`/`dip`, `peaks[1]`/`dips[1]` is a SECOND window that cleared the `SECOND_PROMINENCE_FRAC`
  topographic-prominence gate; `diurnalTimedLap` mirrors it with index-aligned `askReaches`/`bidReaches`
  arrays — inform-only, n≈0, rendered as a trailing clause by `emit.mjs formatTimedLap`) + **`computeReality`/`realityClause`**
  (PLAN-DIURNAL-RECENCY-GUARD 2026-07-24 — each emitted `peak`/`dip` carries an additive `reality` level-check:
  `spikeTop` (a recent 1–2 day spike over-generalised into the quoted level) / `staleOptimistic` (an old high
  the current regime no longer reaches) + a recency-honest `typicalLevel` to quote instead, off the cluster's
  per-day HIGHS/LOWS with ZERO new fetch; `realityClause` is the ONE renderer across **nine** console call sites
  as of Chunk 2c (2026-08-13) — `--profile` window headers + its `→ BID/ASK` line, the non-`--profile` `diurnal:`
  summary, `formatTimedLap`'s primary BID/ASK and its `also ASK`/`also BID` secondaries, `quote-items`'
  `windowExit` peak-level bit, the held-lot thesis-frame `exit`, and `/schedule`'s Level column. _(This cell read
  "the three console surfaces" through Chunks 2b AND 2c; every hand-enumeration of these sites has been short —
  treat the number as a floor, and see the plan's §10 for what is still bare.)_ Constants `SPIKE_REACH_FRAC`/`SPIKE_PLACEMENT_PCTILE`/
  `SPIKE_MIN_GAP_FRAC`/`REALITY_TYPICAL_QUANT`/`REALITY_TYPICAL_RECENTN` are PLACEHOLDERS; inform-only, n≈0,
  never gates — the emitted `level` is unchanged. **No longer console-only:** Chunk 2c added the WRITE side, so
  `reality` now reaches `suggestions.jsonl` (`timedLapShadow`) and `verify.json` (`result.profile`, which already
  carried it) — that is what finally makes "does this flag predict anything" an answerable question) + **`hourConcentration`/`diurnalTimedLap`** (PLAN-DIURNAL-TIMING DT1
  2026-07-23 — `hourConcentration` is a per-day argmin/argmax-hour CIRCULAR-concentration classifier
  (mean resultant length R∈[0,1] of each day's own trough/peak hour, `HOURCONC_MIN_DAYS`/`HOURCONC_MIN_R`
  placeholders), distinct from `hourProfile`'s aggregate cluster width; `diurnalTimedLap` is
  `deriveDiurnalRange`'s output EXTENDED with `net`/`roi` (the TIMED trough→peak lap, `netMargin` from
  `js/money-math.js`) + `instantNet`/`instantRoi` (the SAME-HOUR/churn margin — both surfaced, since a
  big-ticket item can show a NEGATIVE same-hour margin beside a POSITIVE timed one) + `bidReach`/
  `askReach` (`recencySplit` scored against the chosen dip/peak levels' own `windowStats` slice) +
  `lowTrend`/`hiTrend` (`projectTrajectory`) + `dipPool`/`peakPool` + `trancheComfort`/
  `trancheCeiling` (`DT_TRANCHE_COMFORT_VOL_PCT`=0.5%/`DT_TRANCHE_CEILING_VOL_PCT`=1% of `volDay`,
  borrowed from `js/estimators/reach.mjs`'s n≈6 reach-relief knee, not validated for diurnal
  specifically — rendered `tranche ~X clean · ~Y price-knee`, and **read the two disclaimers on
  `emit.mjs`'s caveat before quoting either number**: it is a price-degradation knee rather than a
  clearing cap, and a ROUND-TRIP bound rather than a per-leg one, both of which have been misread off
  it in a live session) + `hourConcentration`'s `clean` verdict; degrades to `{degraded:true, reason}`, never a
  throw. DT2 (2026-07-23) wires this into `screen-flip-niches.mjs` for EVERY flip-niche survivor
  (was top-picks-only via raw `hourProfile`+`deriveDiurnalRange`), rendered through the ONE shared
  `pipeline/lib/render/emit.mjs` `formatTimedLap` — see that file's README entry. DT3 (2026-07-23) wires the
  SAME `diurnalTimedLap`+`formatTimedLap` pair into `quote-items.mjs`'s bare-quote `kind:'diurnal'`
  note (`prof`/`dr` themselves stay — they still feed `extraEst.diurnal`, the window-clear peak window,
  and the forward E4 inputs), and swaps `watch-positions.mjs`'s two direct `hourProfile`+
  `deriveDiurnalRange` call sites (the shadow-log bid/ask co-log, the `diurnalAsk` cycle-fallback exit)
  for `diurnalTimedLap` — those two are VALUE consumers, not note-render sites, so only the underlying
  computation moved) + **`softBuyRead`/`formatSoftBuy`/`SOFT_BUY_CUE_TEXT`** (2026-07-22 — the
  ADD-while-holding soft-buy timing read off the SAME `hourProfile`: the dip-cluster FLOOR level + a
  live-vs-dip-floor `@floor`/`+X%` marker at `SOFT_BUY_AT_FLOOR_PCT`, ending in a cue, with the diurnal DIP
  window in a trailing parenthetical labelled **attended**. DT2 (2026-08-09) made the render LEVEL-FIRST and
  re-scoped the window: it does NOT time a resting offer (71.2% in-window touch vs 70.5% for a random window
  of the same width; waiting forfeits ~29% of bid fill-days at an identical price), so a resting bid is
  placed at the level now and the hours are for attended market-TAKING. The `@floor` cue is **FLOOR-AWARE** (the
  fang under-read fix) — `softBuyRead` takes an optional `fc` (a `floorCeilingTrack` result the caller already
  computed; NO re-derived slope) and resolves `buy now` (flat/ranging), `▲ favorable` (rising floor —
  price-trend-only, never a green-light), or `▽ caution — floor breaking ↓` (broke/crash-risk — a dump artifact,
  not a discount); `SOFT_BUY_CUE_TEXT` maps the cue to its wording so both surfaces phrase it identically.
  `quote-items.mjs` renders it as the `⏳ softBuy` note on held lots + bare quotes (threading the `fc`
  `pushTrajectory` returns), and `screen-flip-niches.mjs`'s digest soft-buy column delegates to the SAME
  helper (ONE implementation); inform-only, n≈0, null profile / no fc ⇒ plain cue) + `asymPair` (PART II PLAN-GRADE-REACH 2026-07-12 — the day-level
  deep-bid/high-reach-ask realizable pair + P_ask/P_bid, consumed by `js/estimators.mjs` `asymEstimate`
  for the `◆ asym fill` inform line + the `asym` suggestions-ledger shadow field) + `clearableAsk`
  (PLAN-DEPTH-EXIT DE1 2026-07-15 — the percentile-DEPTH exit: reconstructs a per-day price→volume
  distribution from the 1h bucket point masses and answers "what can I actually BOOK at?" for a given lot
  size; the reach count is its qty→0 limit, and a thin book collapses to a null-with-`reason`; feeds the
  `--depth` "BOOK AT ≤X" line + the LIVE DE3 `depthExit` shadow on watch/quote held lots; the `DEPTH_*`
  constants module-internal placeholders. **`depthDays`/`clearableBid` were REMOVED 2026-07-22,
  PLAN-REMOVE-DEPTH-PRESSURE-READS — git-revivable**) + `demandPressure`/`reachableBand`
  (PLAN-DEPTH-EXIT Extension A PB1 2026-07-15 — the pressure-driven reachable band: `s=ln(medVolHi/medVolLo)`
  sets each side's headroom `base ± band·φ(±s)·reliability` off the recent central daily level (RC1 reused)
  + the daily-high/low IQR; a thin-VOLUME book collapses to the smoothed center via the sample-reliability
  guard (no peak-cap); the `PRESSURE_*` constants are exported n≈0 placeholders and the Soul-rune/sell-heavy
  reasonableness pins live in the test; its surviving consumers are the co-log shadow (bid/band), the
  `read-window-range.mjs --pressure` inspector and reverse-flip's `reverseListBand` — the pressure SELL
  model it once priced was RETIRED 2026-08-30 (join-exit-ev.mjs's criterion; CHANGELOG 0.76.0). **The
  Extension-B `hourlyPressure`/`demandRegime` per-hour demand-cycle classifier was REMOVED 2026-07-22,
  PLAN-REMOVE-DEPTH-PRESSURE-READS — git-revivable**) + **`trajectoryRead`** (2026-07-21, the fang under-read fix — the shared multi-day SHAPE read
  over a `windowStats().days` series: classifies rising/falling/oscillating/based/elevated + the window
  floor/ceiling (with the day each printed) + where a `liveRef` sits between them; HEURISTIC/inform-only,
  never gates. **Its rendered `⌁ read:` line was RETIRED at both emitters by R6** — `floorCeilingTrack`
  below supersedes it; what survives is the floor/ceiling/livePos fields that note now carries) + **`floorCeilingTrack`/`formatFloorCeiling`**
  (PLAN-DRIFT-VS-CRASH, 2026-07-22 — the phase-aligned floor+ceiling **slope-asymmetry** classifier that
  `trajectoryRead`'s single min-low/max-high collapse washes out: reads the daily-LOW track and daily-HIGH
  track SEPARATELY, each a recent-window least-squares slope (windowed, so a short trailing wiggle
  cannot flip it; a volatile END day can — OLS endpoint leverage) classified `rising|flat|falling` + a
  raw-sign trailing micro-`run` for duration, plus a discrete **floor-break** flag (latest completed low vs
  the prior-lookback floor); combines the two slopes + the break into `crash-risk` (break dominates) /
  `healthy-trend` / `compressing-up` / `mild-cooldown` / `cooling` / `ranging`. REQUIREMENT #1 phase-alignment:
  a `todayKey` forming/incomplete day is DROPPED from the slope/break and surfaced separately as provisional.
  HEURISTIC/n≈0/inform-only, never gates; `formatFloorCeiling` (fmt injected — windowread stays dependency-free)
  is the ONE line-render both `read-window-range.mjs`'s trajectory block and `quote-items.mjs`'s `⇅` note use);
  MOVED here from `pipeline/lib/`
  so it is node- AND app-importable like `quotecore.js`; consumed by `pipeline/commands/read-window-range.mjs`,
  `pipeline/commands/watch-positions.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `js/validate.mjs` and `js/forecast.mjs` (both now app-imported via `js/trends.js`, TV).
  PF1 (2026-07-10) added additive per-hour dispersion fields `devMid`/`devLowSpread`/`devHiSpread` (IQR of
  the deviation samples) so the forecast band isn't re-derived; every pre-existing field is byte-identical),
  `forecast.mjs` (PF1 2026-07-10 — the pure forward 12h/24h price projection: **CONSUMES** an `hourProfile`
  object and produces a diurnal+trend forecast — `diurnalForecast(profile, ctx)` → `nextTrough`/`nextPeak`
  `{level, band, etaH, window, confidence, mode}` + the per-hour projected `series`, plus `whenBuyable`/
  `whenSellable`/`fmtEta`. The interpretable ADDITIVE model `projLevel(h) ≈ baselineNow + trendPerHour·Δt +
  deTrendedHourShape(h)`; anchor from the live quote, shape/dispersion from up to 14d, trend from the
  recent slope. DEGRADES LOUDLY to `{forecast:null, reason}` on a spike/decay phase, a live band violation,
  a thin/short series, an unreliable quote, or a trend-erased dip (trend-only mode); the band widens with
  horizon. Claims ONLY "recurring diurnal shape + dumb trend extension" — never an exogenous shock. Imports
  only `windowread.mjs` (no quotecore — `phase`/`mom`/`reliable` arrive as plain ctx). INFORM-ONLY /
  console-only / provisional (n≈0, every constant a NAMED PLACEHOLDER pending the PF8 backtest); no consumer
  wired yet (PF2–PF8) and no app import → no APP_VERSION. Pinned by `pipeline/test/forecast.test.mjs`.
  Also homes PLAN-OSCILLATION-CYCLE Chunk 1 (the multi-week oscillator lane): `driftAdjustedExit(fc,
  {ceilingSlope,floorSlope,holdHorizonDays})` composes diurnalForecast's next trough/peak with a multi-week
  drift NUMBER (never a direction label — NO phase/direction field), shifting ONLY by the RESIDUAL horizon
  past the diurnal eta (diurnalForecast already trend-extrapolates to the eta), and `oscillationVsKnife(days)`
  — a detector (REDESIGNED at F-A, 2026-07-22 — the original first-difference flip-fraction metric measured
  day-to-day NOISINESS, not harvestable oscillation, and mislabeled fang/blowpipe's smooth multi-day runs a
  false knife; see the header comment above the function for the full finding) that detrends the daily mids
  (same shared `projectTrajectory` slope, one-home) and splits the residuals into maximal same-direction
  LEGS, counting a leg as real only past `OSC_MIN_LEG_DAYS` + `OSC_AMP_NOISE_MULT`× the series' own
  day-to-day noise floor; `oscillating` fires at `OSC_MIN_LEGS` (≥2 direction reversals) — fewer legs is a
  monotone linear-fit hump (even a CURVED collapse), never a real cycle. Tells an oscillating-while-drifting
  shape (fang/blowpipe) from a monotone knife where floorCeilingTrack.oscillating structurally can't. F-H
  (2026-07-22) added `OSC_DETECTOR_NIGHTS=21` (> the amplitude gate's `AMP_NIGHTS=14`): `renderAmplitudeMode`
  feeds the detector its OWN longer trailing `windowStats(...).days` window (off the same in-hand series, NO
  fetch) so it sees the ≥1.5 cycles / ≥3 legs it needs WITHOUT widening the gate's `AMP_NIGHTS` daily-range/
  reach/recency read — a sample-size fix BOUNDED by the ~16-day `/timeseries?timestep=1h` endpoint, not a
  calibration. **⚠ That endpoint bound is now load-bearing, not incidental (2026-08-11):** `OSC_MIN_LEGS` is
  an ABSOLUTE leg count with no length normalisation, so the label is a function of WINDOW LENGTH — measured
  59.5% OSC at 14d → 99.9% at 60d on the real archive, and ~66% at 14d → ~100% at 30d on a synthetic DRIFTLESS
  RANDOM WALK containing no cycle at all. Amplitude cannot matter — every threshold is homogeneous of degree 1
  in price, so the criterion is scale-free BY CONSTRUCTION and length is the only free variable (an earlier
  note offered amplitude-invariance as corroborating measurement; it is an algebraic identity, not evidence).
  The ~15d cap is the only reason the knife temper still discriminates; feeding the detector a
  deeper `archive.mjs` series (F-H calls this a noted-not-built follow-up, and `renderAmplitudeMode` already
  has that archive open) would take it to ~100% and silently delete the guard. Normalise the criterion BEFORE
  widening the window — full note in the function header; measured in `RANGE-PERSISTENCE-FINDINGS.md`.
  INFORM-ONLY, wired into NO gate in Chunk 1 (gating is Chunk 3); pinned by `pipeline/test/oscillation-cycle.test.mjs`. Chunk 2 adds
  `driftExitFrom(profile, days, ctx, opts)` — the ONE slope-sourcing + drift-adjusted-exit COMPOSITION (imports
  `floorCeilingTrack` from windowread to pull the ceiling/floor slope off an in-hand `windowStats().days`, NO
  fetch; builds the diurnalForecast wrapper; calls `driftAdjustedExit`) — the reusable caller pattern the
  amplitude lane established and Chunk 6 REUSES; PURE/tax-free (the after-tax margin stays the caller's concern).
  Pinned by `pipeline/test/oscillation-shadow.test.mjs`. Chunk 3 (THE ONLY GATE) turns that margin into
  `amplitudeGate`'s `margin-below-floor` reject (`amplitudeDriftMargin().margin <= 0`, direction-agnostic,
  the floor already inside the margin) sequenced after trend/knife, computed ONCE at the gate stage in
  `renderAmplitudeMode` and reused for the shadow-log, and TEMPERS the knife guard with `oscillationVsKnife`
  (a drift-riding oscillator is not a false knife → falls through to the margin gate). Pinned by
  `pipeline/test/oscillation-gate.test.mjs`. Chunk 6 REUSES `driftExitFrom` per-thesis (band/churn/scalp/value
  drift-adjusted-exit INFORM notes — see `js/flip-niches.mjs`; console-only, no gate). Chunk 5 folds the
  drift-adjusted exit LEVEL into the SHARED `formatFloorCeiling` note path (an optional `drift` opt — the
  caller passes a pre-computed `driftAdjustedExit()` result off its in-hand prof+days, so windowread keeps
  its one-way arrow) so it rides beside EVERY price suggestion (`quote-items.mjs` trajectory note,
  `read-window-range.mjs`, and — APP-VISIBLE — `js/trends.js` `renderForecast`); a projected LEVEL never a
  direction verdict, display-only, degrade-clean; **APP_VERSION-bumped** (reaches `js/trends.js`). Pinned by
  `pipeline/test/oscillation-render.test.mjs`). F-F adds a trough-vs-decay DISPLAY annotation to the
  amplitude reach cell (`reachPhaseNote` in `screen-flip-niches.mjs` — recent+full both-leg reach plus a
  3-signal phase note off `oscillating`/`floorSlope`/`margin`, direction-agnostic in the knife bucket,
  console-only; pinned by `pipeline/test/oscillation-reachphase.test.mjs`),
  `validate.mjs` (P2 — the pure VALIDATOR REGISTRY `(ctx)→{status:pass|caution|reject,reason,evidence}`
  run on EVERY surface: `reachValidator` wraps windowread reach + RC1 into caution/reject WITH the
  reach evidence; `floorValidator` (P3, BUY-side) rejects/cautions a buy parked above the durable floor
  — and `durableFloorRead(vres)` (2026-08-06) is the ONE canonical extraction of that verdict
  (`{status, ranges, lookback}`) for consumers that need the LEVEL read without re-deriving it: the
  soft-buy `unproven-base` cue, the `⚠N×floor` row probe, and the bucketed caution footer all compose
  it rather than fork it (windowread cannot import validate — the arrow is one-way — so the caller
  hands it down);
  `trajectoryValidator` (TV1 2026-07-09, BUY-side) is the SHAPE policy over `termstructure`'s
  `classifyTrajectory` — knife/oscillating/based/elevated; `valueAmplitudeValidator` (TV1) the recent-week
  amplitude+proximity for value; `limitValidator` (LM1) the rolling-4h buy-limit; `dipPostureValidator`
  (DP1, BUY-side, INFORM-only/NEVER-REJECT) the dip DIRECTION read via `quotecore.js`'s `recentDirection`
  (a reverting dip → caution "cross or pass"; wired inform on band/churn). All degrade to pass on
  missing data and never throw. `runValidators(ctx,{specs})` drives a PER-THESIS plan (`{key,mode,window}`
  from `js/flip-niches.mjs`) — `gate` (verdict stands) vs `inform` (`informFlags`: annotate-only, clamped to
  pass, would-have verdict logged via `leanValidators`). `worstStatus`/`flags`. Screens DROP reject + FLAG
  caution + SHOW inform notes; explicit asks/held/watchlist never hidden. App-imported via `js/trends.js`
  (TV) — a behavioral change here needs the smoke test + the APP_VERSION rule),
  `termstructure.mjs` (P3 — pure DOM-free multi-day term structure over a daily-mid `[{ts,mid}]` series:
  the 1/3/7/14/28d `termStructure` (median/low/high/pctInRange per lookback), a durable **floor** (low
  quantile of the longest multi-week lookback), a robust **ceiling** (P5 — the symmetric high quantile
  q85, so a lone spike can't inflate a range), a **typical fluctuation** (IQR), and a **trajectory** SHAPE
  (TV1 — `classifyTrajectory`: knife/oscillating/based/rising/elevated/flat, attached as `ts.trajectory`);
  degrades to `hasData:false`/`unknown` on a short series. Plus (DT6, PLAN-DIURNAL-TIMING §6, 2026-07-23)
  `basePosition(ts)` — a pure, LIGHT read of an already-computed `ts`: reuses `ts.lookbacks[14].pctInRange`
  (the SAME field `classifyTrajectory` already scores) + a 3-way coarsening of `ts.trajectory.shape`
  (+`ts.recentTrend.dir` to split a falling-drift oscillation as "decaying") onto `range-bound`/
  `trending↑`/`trending↓`/`decaying`, for the `screen-flip-niches.mjs` **Base position** note on band/
  churn/amplitude survivors (rendered by `pipeline/lib/render/emit.mjs` `formatBasePosition`) — NOT a second
  term-structure computation, a second reader of the one `termStructure()` call already in hand; the
  value flip-niche is deliberately not wired to it (already has its own durable-floor render). Consumed by `js/validate.mjs`'s floor+trajectory
  validators + `pipeline/commands/screen-flip-niches.mjs`/`pipeline/commands/quote-items.mjs` + `js/valuescreen.mjs`; here in `js/` so validate.mjs can import it — NOT yet app-imported),
  `valuescreen.mjs` (P5 — the PURE, DOM-free gate/rank/tier math for the `--mode value` buy-hold flip-niche:
  `valueRanges` (recency-anchored shape features) / `valueScore` (composite rank with a deployable-capital
  multiplier; `capGp` threaded from `screen-flip-niches.mjs --capital÷--slots`) / `deployUnits` (the extracted
  three-way-min deployable position size `valueScore` blends in — ALSO reused by the `--digest` decision
  block's `deploy` SIZING column — not its sort basis, PLAN-CAPITAL-EFFICIENCY-AND-DIGEST) / `valueGate` (amplitude floor +
  artifact-low guard + knife guard + coverage guard) / `valueTier` (buy-now vs watch). Consumed by
  `screen-flip-niches.mjs`/`gatecandidates.mjs`; imports only `tax`. Full spec + all NAMED-PLACEHOLDER thresholds (n≈0)
  live in the module header; resolved rank-metric history in `docs/LORE.md`. NOT app-imported → no
  APP_VERSION. Fixture-pinned `pipeline/test/valuescreen.test.mjs`),
  `amplitudescreen.mjs` (PLAN-AMPLITUDE-SCAN A1 — the PURE, DOM-free two-stage gate + range math for the
  `--mode amplitude` MULTI-DAY-cycle flip-niche (**RE-HORIZONED 1d → 4d by DT1 2026-08-09** — the 24h
  premise measured 4.8% completion given entry over 92 items / 4,881 item-days; the module header carries
  the full refutation): `amplitudeProxy` (Stage-1 attenuated daily-range proxy off the
  6h archive → picks the fetch pool) / `amplitudeRanges` (the exact per-day trough/peak + both-leg recent
  reach off a `windowStats` result) / **`cycleCompletion`** (DT1 — the ordered day-grain round-trip rate
  built to replace `pFill2leg`: an entry day whose ask is reached on a STRICTLY LATER day inside the
  horizon; window-edge entries are PENDING not misses; same-day never counts; `frac` null on zero judged
  entries. **SHADOW-LOG ONLY — measured on the live board and REJECTED as a rank input, then dropped from
  the table by DT1b**: its levels are the median low/high OF THE VERY DAYS it scores, so a multi-day
  horizon saturates it (~94% at H=4; the board read 18/19). Kept only for continuity with rows logged
  between DT1 and DT1b) / **`ampWalkForward`** (DT1b — THE per-item P(fill): for each origin day the
  trough/peak levels are fitted STRICTLY PRE-ORIGIN over the preceding `AMP_WF_FIT_DAYS`, entry is the
  first hour of that day whose 1h avgLow touches the bid, completion is any LATER hour within the horizon
  whose avgHigh reaches the ask; unresolved end-of-series entries are PENDING not misses; null — never 0% —
  when history is too thin. Reads the local 1h archive via `archiveSeries` (~20ms/item); the live
  `/timeseries` fetch is far too short. This is the DT1 study's own design and reproduces its published
  figures exactly; it separates live rows 0%/16%/21%/26%/48% where the in-sample figure read ~100% on all
  of them. Printed as `round-trip X/Y = Z% ≤4d`; `pFillAmplitude` ranks on it above `AMP_WF_MIN_JUDGED`
  judged entries and falls back to the 0.5 prior below it) / `amplitudeGate` (after-tax daily-amplitude floor + both-leg reach — ⚠ which at default quantiles reduces to a `staleOptimistic` check, since the level is the median of its own scoring window +
  trend/knife guard) / `amplitudeDeployUnits` (the deployable-units three-way min the `amplitude`
  estimator family reads — floored HONESTLY to an integer, 0 when unaffordable: amplitude is a
  CONCENTRATION lane so `capGp` is TOTAL REALIZABLE `liquidCapital` used UNDIVIDED, NOT value's
  `deployablePool ÷ slots`; the caller drops a `lapUnits < 1` pick as `unaffordable`) / `amplitudeDriftMargin`
  (PLAN-OSCILLATION-CYCLE Chunk 2 — the drift-adjusted margin `afterTax(driftAdjustedPeak) − entry −
  requiredMargin` off a `js/forecast.mjs` `driftAdjustedExit` result, through the SAME afterTax path
  `netPerCycle` uses; direction-agnostic, no sign branch; `AMP_DRIFT_REQ_MARGIN=0` PLACEHOLDER Chunk 3's gate
  reuses; INFORM-ONLY, shadow-logged only). Imports only `tax` + the `windowread.mjs` reach helpers; consumed by
  `screen-flip-niches.mjs`/`gatecandidates.mjs`/`js/estimators/families.mjs`. All thresholds NAMED
  PLACEHOLDERS (n≈0); full spec in the module header. NOT app-rendered (console-only lane) but the shared
  `FLIP_NICHES`/estimators ARE app-imported → the registry addition is app-safe (a null 'daily' pair, never
  rendered). Fixture-pinned `pipeline/test/amplitudescreen.test.mjs`),
  `desk-cadence.mjs` (2026-08-09 — the ONE home for the "how many GE buy-limit windows a day do we
  actually assume?" constant: `REFILL_WINDOWS_PER_DAY` = 6, the physical 24h÷4h game rule, and
  `ACTIONABLE_WINDOWS_PER_DAY` = 2, the realistic desk cadence Ben set — a PLACEHOLDER, n≈0. A leaf
  module with ZERO imports, because it must be reachable from both `js/valuescreen.mjs` /
  `js/amplitudescreen.mjs` AND `pipeline/lib/signal/gatecandidates.mjs`, and gatecandidates imports
  FROM the two screens — so the constant could not live there without a cycle. Created because the
  answer previously existed as three independent literals that drifted the moment the 6→2 attention
  haircut landed (2026-08-08 moved `expUnits`, left value + amplitude sizing at 6 under comments still
  claiming to "mirror expUnits"). Consumed by `gatecandidates.mjs` (which re-exports both names, so
  every prior importer is unchanged), `valuescreen.mjs`, `amplitudescreen.mjs`. NOT app-imported.
  Carries the ⚠ note that moving `ACTIONABLE_WINDOWS_PER_DAY` invalidates `MIN_GPD`s calibration —
  the floor must be re-DERIVED, not rescaled. `expUnitsOvernight` deliberately still passes the
  PHYSICAL 6 (an unattended 8h span needs no re-buying). Wiring + value pinned in
  `pipeline/test/amplitudescreen.test.mjs`),
  `reverseflip.mjs` (PLAN-REVERSE-FLIP RF1 — the PURE, DOM-free gate/edge math for the `--mode reverse`
  HARVEST-AN-OWNED-ITEM flip-niche, i.e. sell an item you already own into the PEAK and rebuy at the DIP,
  capital-free: `invertedRegimeGate` (re-maps `js/termstructure.mjs` `classifyTrajectory`'s shape with the
  read INVERTED — `rising`/`elevated`→reject (sell now, rebuy HIGHER tomorrow = loses by construction),
  `knife`/`oscillating`/`based`/`flat`→pass (`knife` IS the "falling" case the strategy wants — there is no
  `falling`/`cooling` shape, that was the plan's fixed vocab bug), `unknown`/missing→caution) / `reverseFlipEdge`
  (`beRebuy = sellRef − tax(sellRef)` via the canonical `js/money-math.js` `tax()`, NOT a ×0.98 approx —
  Ruling §1; the peak→dip swing + a `REVERSE_MIN_SWING_PCT` amplitude-floor flag; direction-agnostic) /
  `reverseFlipGate` (composes regime + swing floor + a REBUY-LEG-WEIGHTED liquidity check: a thin SELL leg is
  caution-not-reject (live demand clears the sell — the 2026-07-24 Ancestral-hat anchor), a thin REBUY leg is
  the binding risk → reject; degrade-to-caution, never throws). RF6 (2026-07-25) adds the THIN BIG-TICKET
  read handling — `isThinBigTicket(row)` (the ONE thin predicate: big-ticket `guide ≥ BIG_TICKET_GP` (10m) AND
  liquidity-thin — a clearable tranche ≤ `THIN_TRANCHE_UNITS` OR min-side `vol/d < THIN_VOL_FLOOR`) + four
  inform-only, THIN-ITEM-ONLY display-guard helpers reused across RF2/RF4: `reverseListBand`/`reverseListBandCell`
  (RANGE-not-a-point list price off the reachable band), `askSpreadFlag`/`askSpreadNote` (traded-mid vs a lone
  rarely-reached standing ask), `rebuyStrandNote` (the reverse-flip-specific rebuy-may-strand caution), and the
  ask-reach decay read on the sell-ref (was a `THIN_DRIFT_DAYS=7` longer-window drift default until DT3
  deleted the slope 2026-08-09; the window is now the validated 3d for thin and liquid alike). Every guard degrades to the existing
  render on a non-thin item — a liquid reverse row is BYTE-IDENTICAL (empirically verified against the pre-RF6
  output). Imports `tax` + `BIG_TICKET_GP`; consumed by RF2's `--mode reverse` wiring —
  `gatecandidates.mjs` `gateReverseFlipCandidates` applies the gate per owned candidate and
  `screen-flip-niches.mjs` `runReverseMode` renders the own-table surface + the thin-item guards (RF2 shipped
  2026-07-25; RF6 2026-07-25; the `@provisional-api` markers stay as the n≈0 honesty label). All thresholds
  NAMED PLACEHOLDERS (n≈0). RF4 (2026-07-25) adds the PURE, app-safe CYCLE-STATE SURFACING helpers reused by
  all three read surfaces: `REBUY_STALE_DAYS` (a placeholder stale-nudge floor, softer/shorter than the
  30-day store TTL) + `daysPending`/`rebuyStaleNote`, `reverseFlipPendingEntries` (the awaiting-rebuy/
  rebuy-armed entries folded with any in-hand live mark + quote row; `holding` excluded), and
  `reverseFlipCycleNotes` (the shared inform-only note lines a surfaced cycle carries — thin rebuy-strand +
  a generic pre-rendered `driftNote` slot, UNFED by every caller since DT3 deleted the hourly-drift note it
  used to carry + the stale nudge). No fetch/fs (the store IO stays in
  `pipeline/lib/thesis/reverseflipstate.mjs`). NOT app-imported → no APP_VERSION bump. Fixture-pinned
  `pipeline/test/reverseflip.test.mjs` (RF1/RF6) + `pipeline/test/reverseflip-surfacing.test.mjs` (RF4)),
  `patha.mjs` (PLAN-LANE-ADMISSION Chunk C — the PURE, no-fetch/no-fs Path-A (intraday-flip) gp/day
  calculator off Chunk A's `loadDailyRangeBulk` daily-range data: `intradayDailyRange(dayRanges)` (the
  robust CENTRAL after-tax intraday range = the MEDIAN of per-day `netMargin(lo,hi)` across the coverage
  window — the calibrated statistic, NOT max−min/a spike day; reuses quotecore's ONE `median`/`tax`) /
  `pathAGpDay({dayRanges,price,buyLimit,volDay,lane,capital})` → `{gpDay,marginU,captureFrac,cyclesDay,
  units,price,intradayRange,lane}` (the H1 `pathA` shape minus `rankInLane`), where `marginU =
  intradayDailyRange × captureFrac`, `unitsCyc = min(effLimit, floor(capital÷price))` (0 if unaffordable,
  null-limit → volDay/24 inferred), and the throughput (`unitsCyc × cyclesDay`) REUSES gatecandidates.mjs
  `expUnits(effLimit,volDay,floor(capital÷price))` so no ×6-refill / 10%-volume-share constant is
  re-derived — `gpDay = marginU × unitsCyc × cyclesDay`. `captureFrac` 0.45 gear / 0.62 churn are NAMED
  PLACEHOLDERS (n=13/12, own-book-biased — re-estimated from the H2/H4 forward join). EXPLICITLY NOT
  `expGpDay` (a demoted pre-fetch orderer) and NOT the live-ranked `rateItem` — a genuinely new sortable
  quantity, named distinctly. Also exports the Chunk-D console-ranking helpers `pathASurfaceTier(pathA,
  minGpd)` / `comparePathARows(a,b,minGpd)` (the two-tier PRIMARY-sort comparator — Path-A gp/day desc above
  the `MIN_GPD` SURFACING floor, backup `score`/grade desc beneath) / `assignRankInLane(rows)` (stamps each
  row's `pathA.rankInLane` within its gear/churn lane). Consumes `js/quotecore.js` (`median`/`netMargin`/`tax`)
  + gatecandidates.mjs `expUnits`; consumed by `screen-flip-niches.mjs` (Chunk D makes Path-A the CONSOLE/
  last-report PRIMARY sort — grade shown as the A/B backup; screen.json unchanged). Fixture-pinned
  `pipeline/test/patha.test.mjs` (synthetic daily-range + ranking inputs, no live archive)),
  `held-item-strategy.mjs` (P4a — the PURE, dependency-free PATH ENGINE core: `enumeratePaths(ctx)→Path[]`
  (candidate thesis-paths for an item — held lots get hold-recovery/value-hold/be-escape/
  list-to-clear/cut; unheld candidates get scalp/value-hold/avoid) + `weighPaths(paths,ctx)→
  {dominant,weighed,enteredUnder,migration}` (viability-weighted ordering off PLACEHOLDER heuristics
  over the derived ctx — regime/phase/underwater/aboveFloor/band-width; `no-data` evidence notes,
  degrade-not-throw). Path = `{key,thesis,action,levels,tripwire,horizon,economics,viability,evidence}`.
  Consumes the enriched ItemContext; recomputes no prices. Alternatives are decision SUPPORT, never
  alert inputs; `migration` here is the RAW instantaneous flag — the persistence-gated
  dominance/migration (arm-then-confirm + hysteresis) SHIPPED at P4b as `pathPersistence`
  (`pipeline/lib/thesis/watchstate.mjs`) + `pathsStage` (`pipeline/lib/market/item-context.mjs`). NOT yet app-imported →
  no APP_VERSION bump. Fixture-pinned `pipeline/test/held-item-strategy.test.mjs`),
  `flip-niches.mjs` (P4c/P5/A2/RF2 — the PURE, DOM-free DECLARATIVE STRATEGY REGISTRY: the screen's SIX
  flip-niches (band/churn + scalp/value + **amplitude** + **reverse**; the `spread` and `rising` specs were DELETED in
  Steps 3+4) as data-shaped specs `{key,label,inAll,pool:{risingFloor},edge,rank,confirm,falling,gate,
  validators,defaultPath,estimator,priceBasis,fillShape}`. THE SWAP (PLAN-AMPLITUDE-SCAN §3): `amplitude`
  is `inAll:true` (in `--mode all`) and `value` is now `inAll:false` (relabelled **Invest**, KEY unchanged,
  runnable via `--mode value`/`--mode invest`). `gate:'amplitude'` routes to `gateAmplitudeCandidates`;
  `estimator:'amplitude'` is the walk-forward round-trip family (pFill = `ampWalkForward`, DT1b); `priceBasis:'daily'` = a surface-computed
  daily-quantile pair. RF2 (PLAN-REVERSE-FLIP, 2026-07-25): the `reverse` spec — `inAll:false` (explicit
  `--mode reverse` only, like scalp), `gate:'reverse'` (routes to `gateReverseFlipCandidates` over the
  OWNED-item pool, NOT the v24 fetch universe), `validators:[]` (reverseFlipGate does its own gating),
  `falling:'accept'`/`estimator:'amplitude'`/`priceBasis:'daily'`/`defaultPath:'value-hold'` — a HARVEST-AN-
  OWNED-ITEM flip-niche (sell a keep item into the peak, rebuy the dip); `'reverse'` is in `VALID_GATE` so the
  conformance suite passes with it registered.
  `pipeline/lib/signal/gatecandidates.mjs` looks up
  `FLIP_NICHES[mode]` and calls `spec.edge(...)` / reads `spec.pool.risingFloor` / `spec.rank` / `spec.falling`
  / `spec.gate` instead of branching on the flip-niche name — so a flip-niche can be added or REMOVED by editing the
  registry alone. P5's per-spec `falling` doctrine (`exclude`|`accept`|`knife-guard`), a `gate` selector
  (`band`|`value` — value routes to the term-structure `valueGate`), and the `scalp`/`value` specs (both
  off-by-default). Steps 3+4: `pool.risingFloor` is now vestigial (all false — the rising flip-niche that set it
  true is deleted) and `rank:'proxy'` is unused (rising's proxy ordering is absorbed into `rankAndSlice`'s
  rising reserve). `defaultPath` = the inferred DEFAULT ENTRY PATH the surfacing implies (band/churn/
  scalp → `scalp`, value → `value-hold` — a Ben-vetoable judgment proposal), written to
  `suggestions.jsonl` (lean `path` field) + shown as the screen's per-row entry-path annotation.
  PLAN-OSCILLATION-CYCLE Chunk 6 adds an OPTIONAL per-spec `driftInform:{label}` (band/churn/scalp/value; amplitude
  opts out — it has its own margin gate) + the pure `driftInformNote(spec,dae,{entry,fmt})` helper: the render paths
  compute the drift-adjusted exit ONCE via `driftExitFrom` (off in-hand data, NO fetch) and format it through this ONE
  helper, so the per-thesis wording is REGISTRY DATA, not an `if(mode===)` branch. INFORM-ONLY (a sibling note, never a
  gate/drop/grade/screen.json input), DIRECTION-AGNOSTIC (reads `driftAdjustedPeak`, a signed number, no sign branch);
  pinned by `pipeline/test/oscillation-thesis.test.mjs` (incl. the Aldarium rising-floor/fading-ceiling regression pin).
  F-C (2026-07-22 — the main session's audit of F-A/F-B found `driftExitFrom`'s `holdHorizonDays` silently
  defaulting to the AMPLITUDE lane's own 1.5d everywhere): `driftInform` gained an optional `holdDays` —
  `DRIFT_INTRADAY_HOLD_DAYS` (~2h, band/churn/scalp, anchored to `screen-flip-niches.mjs`'s `BAND_HOURS`) and
  `DRIFT_VALUE_HOLD_DAYS` (14d, value, anchored to `js/termstructure.mjs`'s `FLOOR_FALLBACK_DAYS`) — read at
  `screen-flip-niches.mjs`'s two Chunk-6 call sites and passed through to `driftExitFrom`'s own
  `holdHorizonDays` param (one-home, registry-line read). `validateNicheSpec` checks `holdDays` is a positive
  number when present. Contexts with no reliably-known per-item thesis (quote-items.mjs/read-window-range.mjs/
  js/trends.js/watch-positions.mjs's non-`--cycle` path) deliberately stay on `js/forecast.mjs`'s
  `OSC_HOLD_HORIZON_DAYS` GENERIC fallback (re-documented there as such) — the rendered clause already shows
  the actual horizon used, so nothing is silently mis-scaled.
  `validateNicheSpec` + `pipeline/test/flip-niches.test.mjs` are the CONFORMANCE suite (structural contract +
  no-throw + determinism over the replay archetypes). `admitMinNet` + the exported `belowAdmitNet()` are the
  per-flip-niche floor on the DISPLAYED net — the second render-stage drop in `screen-flip-niches.mjs`, beside
  the older one that reads the thesis's posted pair. The two prices disagree whenever the sell model moves the
  exit, which is how a row ranked on a positive raw margin reached the table showing a negative one. `0` gates,
  `null` opts out — and `null` is CORRECT for value/amplitude/reverse, which render on their own branches and
  never reach the gate, so a floor there would be dormant metadata claiming a protection that never runs (value
  shipped with a dormant `0` for exactly one pass). Held/watchlist rows are exempt at the call site.
  `pipeline/test/admit-min-net.test.mjs` pins the predicate — every case mutation-verified RED against a
  reverted fix, including the `<=` boundary and the null-means-do-not-drop contract — but it exercises the pure
  function only; the drop site itself is still covered by nothing, which is how a `est`-vs-`estShown` mix-up got
  as far as review. Imports only `tax` from money-math.js + `PATH_KEYS` from held-item-strategy.mjs. NOT
  app-imported → no APP_VERSION bump on changes here),
  `quote.js` (browser orchestrator that fetches one
  item's series and renders the standard quote table), `fillslog.js` (File System
  Access API writer for `coffer-manual.log` + tombstones), `github.js` (M1 — mobile
  GitHub-as-backend writes: fine-grained PAT in localStorage, `mobile-fills.log` /
  `watchlist.json` via the contents API), `table.js` (TB1 — reusable sortable-table
  helper: click-to-sort headers, direction toggle, arrow decoration, per-table sort
  state persisted under `sort:<name>`; the Finder and Watchlist adopt it), `ui.js`
  (Finder/Watchlist/Coffer/Scan rendering + the `renderAll` coordinator; also stamps
  the published pipeline version + scan time next to the app version — PV),
  `ledger.js` (Ledger view + fills-write cluster — manual-entry writes, positions.json
  auto-populate, Ledger render/controls, freshness + GitHub-sync panels; split out of
  `ui.js` by A3), `ledgercore.js` (TD2 — pure `periodKey`/`groupTrades` day-boundary
  bucketing + per-item grouping, moved out of `ledger.js` so node can import them for
  `pipeline/test/ledgercore.test.mjs`), `watch.js` (0.49.0 — the Watch tab: a verdict-first
  flipping desk rendering held positions, active offers and today's fills, with verdicts
  from the shared `momVerdict`/`offerVerdict`; per-item session-context notes persist under
  `watchnote:<id>`), `watchcore.js` (0.49.0 — pure Watch-tab derivations: verdict→stripe
  family, alert count, flip/incidental split, today's-fills feed + after-tax net, summary
  aggregates, the YA1 `capitalSplit` working-vs-parked utilization, and the `watch-positions.mjs --brief`
  compact-book format `briefDot`/`briefLine`/`briefBook` — the loop's one-line-per-item report is
  now SCRIPT-owned here, not hand-formatted by the agent; node-importable,
  fixture-tested in `pipeline/test/watchcore.test.mjs`),
  `backup.js` (export/import),
  `main.js` (entry point — event wiring + init, loaded as `<script type="module">`)
- `pipeline/test/fixtures/reach-surface.json` — frozen 1h/5m archive slices behind
  `pipeline/test/reach-surface.test.mjs` AND `pipeline/test/exit-ev.test.mjs`, as
  `[ts, avgHighPrice, avgLowPrice]` triples. Three `curve`
  items (Soul rune / Ranarr weed / Ancestral robe top) pin the re-derived p(z,H=24) curves; two
  `grain` items with their 5m series (one liquid, one thin) exercise the coverage split that
  distinguishes "measured, small" from "not measurable"; one `hviol` item carries a REAL 12.1pp
  H-monotonicity violation, because the three curve items are all already ordered and a synthetic
  violator is hard to build (z re-normalizes per origin and cancels a manufactured tail spike).
  Regenerate from the archive if the era it freezes stops being representative; the pinned curve
  values in the test move with it — and so do `exit-ev.test.mjs`'s interior-maximum, non-monotone and
  per-cell-bail groups, which assert properties of THIS DATA as well as of the code. Read a failure
  there as "check the fixture era" before suspecting chunk-2 arithmetic.
- `manifest.json`, `icon-*.png` — PWA manifest and icons
- `fills.json` — raw real-trade event stream synced from RuneLite; the pipeline source
  `positions.json` is FIFO-reconstructed from (the app fetches the derived `positions.json`,
  not this file directly)
- `mobile-fills.log` — tracked, append-only source log the app appends mobile GE trades to
  (slot 9) via the GitHub contents API; read by `sync-fills.mjs` (M1, `FILLS-PIPELINE.md` §13)
- `positions.json` — derived from `fills.json` by the pipeline (FIFO-matched closed
  trades + open positions); the app auto-populates its Ledger/Coffer from it.
  Buckets: `closed` · `open` · `unmatched` · **`awaitingRebuy`** (SM1 — a `keep` sold and not yet
  rebought; matching is SYMMETRIC, so sell→buy closes a `keepRoundTrip` row exactly as buy→sell
  closes a flip. `beRebuy` = break-even on the capital reallocation. See `FILLS-PIPELINE.md` §5.1a)
- `offers.json` — tracked, flat snapshot of the live GE offer slots (`{slot, side, itemId,
  item, price, qty, filled, lastUpdateTs}`), written by `sync-fills.mjs`/`watch-log.mjs` in
  both attended and `--local` modes (LW1); the localhost app polls it for desk-side offer
  freshness and stashes it on `STATE.offers`, which the **Watch tab** (0.49.0, `js/watch.js`)
  renders as verdict-tagged offer rows (`FILLS-PIPELINE.md` §14). P0: `quote-items.mjs --positions` also
  reads it (via `lib/offers.mjs`'s `readOffersSnapshot`) as the held-book source for the askFilling
  softening — the OTHER-machine-safe path that needs no local `~/.runelite` log dir
- `.capital-state.json` — **gitignored, local-only, never deployed** — Ben's cash ANCHOR
  (`{cashGp, statedAt}`), written by `pipeline/commands/derive-cash.mjs`, read by `lib/derive-cash-tiers.mjs` — whose
  `loadDerivedCash` feeds `watch-positions.mjs`'s SUMMARY total-capital line (`availableCash`, escrow excluded),
  `run-loop.mjs`'s scan-gate (`deployablePool`), and `screen-flip-niches.mjs`'s value `--capital` default
  (`deployablePool`). The GE cash stack is in no log, but idle cash is no longer merely stated: this is the
  ANCHOR `derive-cash-tiers.mjs` runs FORWARD from (anchor + Σ sells-after-tax − Σ buys − resting-bid escrow).
  **THREE-TIER model** (`availableCash ≤ deployablePool ≤ liquidCapital`): `availableCash` = the free coin
  stack (all resting-bid escrow excluded); `deployablePool` = free stack + the escrow of DEEP/reclaimable
  bids only (priced ≥ `DEEP_BID_PCT` below the market — a supplied `marketRef` of live/band-low classifies
  each bid, a missing ref → COMMITTED, conservative); `liquidCapital` = + every resting bid's escrow (the
  loosest "cancel everything" pool). `cashderive` NEVER fetches — the `marketRef` is supplied by the caller
  (loop-tick does a small live fetch of resting-bid ids; watch/screen reuse prices already in hand). It is
  NEVER a verdict/alert input — purely the denominator for the idle-vs-working picture
- `heartbeat.json` — **gitignored, local-only, never deployed** — a tiny daemon-liveness
  heartbeat (`{app:'the-coffer-heartbeat', generatedAt:<ISO>}`) written by `watch-log.mjs`
  every ~30s (LW3). The localhost app polls it (`js/ledger.js` `fetchHeartbeat`) for the
  "watcher live" freshness stamp — liveness INDEPENDENT of book changes, because
  `positions.json`'s `generatedAt` only advances on a fill and legitimately freezes during
  quiet no-fill stretches. Does zero git; a stale heartbeat (>90s) is what trips the
  "watcher down?" warning
- `cycle-watch.json` — **gitignored, repo-root, desk-side runtime state** (PLAN-OSCILLATION-CYCLE
  Chunk 4). Per-item cycle-EXPECTATION state keyed by item id: the recorded drift-adjusted
  trough/peak PRIOR (Chunk 1's `driftAdjustedTrough`/`driftAdjustedPeak` + a placeholder confidence
  band), the running realized min/max this cycle, and a bounded history of `{expected, actual,
  adjustment}` calibration triples. PRODUCED + CONSUMED by `pipeline/commands/watch-positions.mjs
  --cycle` ONLY (opt-in; the default watch pass never touches the file) — rebuilt fresh each pass via
  the SHARED `loadState`/`saveState` (`pipeline/lib/thesis/watchstate.mjs`), the pure logic in
  `pipeline/lib/timing/cyclewatch.mjs`. INFORM-ONLY (n≈0 placeholders); it drives a nested `cycle — …` note,
  never a verdict/alert/price. NOT app-imported. Gitignored like `pipeline/.cache/watch-state.json`
- `watchlist.json` — tracked repo-root watchlist (array of item names/ids); the app unions it
  with local `STATE.watchlist` and `screen-flip-niches.mjs` always scans it (S3); app writes it back via
  the GitHub contents API (`js/github.js`). It is a PERMISSION AND PRIORITY set, not a display list:
  see `pipeline/lib/config/watchlist.mjs` for the grants membership carries and the one reader that
  serves them. The app rewrites the WHOLE file as bare numeric ids on every star-click
  (`js/ui.js` `pushWatchlist`, and `dev-server.mjs`'s local-file write validates nothing), so no
  durable metadata can live here — that is why the sidecar below exists.
- `watchlist-meta.json` — tracked repo-root ROLE SIDECAR for `watchlist.json` (SEP16a; ships `{}`).
  An id-keyed object `{ "<itemId>": { why, note?, addedTs?, level? } }` where `why` is one of
  `target` / `hold` / `universe` / `probe`. PRODUCED by hand or by an agent; CONSUMED only by
  `pipeline/lib/config/watchlist.mjs` (`loadWatchlistEntries`), which attaches the role to each
  resolved member. **It can never change membership**: absent, empty, garbled, not-an-object, or
  carrying an unknown/missing role all read as `universe`, and an id present here but absent from
  `watchlist.json` is ignored (the array is authoritative). Pipeline-only, NOT app-imported and NOT
  in `sync-fills.mjs --publish`'s add-list. The role SURFACES are a later chunk; today the file is
  the schema and the degrade path, pinned by `pipeline/test/watchlist-permission.test.mjs`.
- `pipeline/lib/config/watchlist.mjs` — the ONE reader for both files above (SEP16a), replacing the
  separate parse in `screen-flip-niches.mjs`, `quote-items.mjs`, `watch-positions.mjs`,
  `read-schedule.mjs` and `report-archive-gate.mjs`, and since SEP16b also backing `read-watchlist.mjs`
  (SIX node consumers; the app keeps its own `fetch` resolve and is NOT covered by the tripwire). All three loaders take ONE options bag
  `{ map, root, tolerant }`: `loadWatchlistIds` (the permission set), `loadWatchlistEntries`
  (ordered `{id, name, why, note, addedTs, level}`, first occurrence wins) and `loadWatchlistNames`
  (raw tokens). The bag is not cosmetic — the original `loadWatchlistNames(root)` /
  `loadWatchlistIds(map, root)` split meant `loadWatchlistNames(map)` returned `[]` in silence.
  **Degrade:** absent/unreadable/non-array → empty set, never a throw. Three different counts are
  true of this loader at once, so all three are stated here rather than one being picked and left to
  contradict the others: **6 consumer commands · 10 literal call sites · 2 commands that actually read
  twice per process.** The 10 sites sit in 6 commands and four of those hold two — but in
  `read-schedule.mjs` (`:326` vs `:411`, the latter inside `if (AUDIT) {…return}`) and
  `read-watchlist.mjs` (`:32` vs `:35`) the pair is MUTUALLY EXCLUSIVE, so only
  `screen-flip-niches.mjs` and `watch-positions.mjs` execute two reads in one process — which is the
  property the once-per-process banner dedup below depends on.
  **The MALFORMED-ENTRY case:** an OBJECT entry inside the array. `buildMapping.resolve`
  (`pipeline/lib/market/marketfetch.mjs`) does `String(token)`, so an object becomes
  `"[object Object]"`, misses `byName`, and returns `null` **without throwing**. Measured against the
  verbatim pre-SEP16a loader: that costs exactly ONE member (60 clean → 59 with one member rewritten
  as an object), and only a WHOLE-FILE schema rewrite empties the set — which `pushWatchlist` cannot
  produce, it writes bare numeric ids. So the default throws `WatchlistFormatError` (plus
  `console.error`), and the six desk commands pass `tolerant: true`: the bad entries are dropped, the
  rest still grant, and ONE banner goes straight to `process.stdout` — not through `console.log`,
  which quiet mode stubs and the screen's report capture reassigns — deduped to once per process
  because two commands read the file twice. An inform-only read must not die on one bad entry.
  `report-archive-gate.mjs` passes `REPO_DIR` explicitly because it has always read the CLONE root,
  which differs from the worktree root under `git worktree`; that divergence is preserved
  deliberately, not fixed here.
- `alerts.json` — tracked named price alerts (`{itemId, direction, price, note?}`) read by
  `pipeline/commands/trigger-alerts.mjs` (N1); ships empty
- `dip-watchlist.json` — tracked repo-root pool of flush candidates for the `--dip` loop (ships empty
  `[]`). **DL4 schema:** an array of `{ id, name, source:'auto'|'manual', track:'liquid'|'illiquid',
  addedTs, lastQualTs, score }` objects (`lastQualTs`/`score` added 2026-07-12 for the quality-ranked
  hygiene); the legacy plain name/id string-or-number form is still accepted (the reader is polymorphic).
  PRODUCED by BOTH manual curation AND `pipeline/commands/screen-flip-niches.mjs`'s DL4 nomination pass (`--mode all` re-scores
  every flush-SUITABLE candidate via `nominateDip` and rewrites the pool via `reconcileDipPool` —
  SELF-PRUNING, not append-only: top-N by score per track, `DL4_POOL_CAP_LIQUID` 15 / `DL4_POOL_CAP_ILLIQUID`
  45, aged out after `DL4_POOL_MAX_AGE_DAYS` of not re-qualifying; manual entries exempt). Suitability now
  gates on a per-unit swing floor (`DL4_MIN_ABS_SWING`) as well as the gp-scale floor, so cheap high-volume
  churn no longer qualifies. CONSUMED by `pipeline/commands/watch-positions.mjs --dip` — which folds the **LIQUID track ONLY**
  into its live target set (illiquid is DL3 backlog, not fetched live); the reader is polymorphic. NOT
  app-imported (watchlist.json is the app's, kept separate).
- `hold-thesis.json` — tracked repo-root store (TG1, 2026-07-07): AGENT-WRITTEN declared hold plans,
  a flat array of `{id, exitPrice, tripwire, horizon, window, path, enteredUnder, ts}`
  (`path`/`enteredUnder` added additively by P4a — the js/held-item-strategy.mjs entry-path declaration; `window`
  — the declared exit window, "h-h" local hours — added additively by VN-2; legacy entries without
  them stay valid). When Ben declares a patient/accumulation hold ("accumulate nest, exit 4,848,
  tripwire 4,678, multi-day") the agent appends/upserts an entry (the greenlist pattern — hand-edit,
  `holdthesis.mjs upsertThesis`, or `declare-thesis.mjs set … --tripwire <gp> --exit <gp> --window <h-h>
  --path <key>`, which VN-2 made the full declared-plan writer); a 14-day TTL prunes stale
  intent. `watch-positions.mjs` reads it READ-ONLY through `pipeline/lib/thesis/holdthesis.mjs` and passes it into
  `convictionGate` (`lib/watchstate.mjs`): while the live price holds ABOVE the declared tripwire,
  the EXPECTED signals — `UNDERWATER`/`CUT-CANDIDATE` and (VN-2) `LIST-TO-CLEAR` — are silenced to
  an armed note (the pre-peak trough is the plan, not news), and the shared display layer renders
  the lot as the `HOLD — per thesis: exit … · abort < …` frame (MONITORING.md step 4); below the
  tripwire the real-risk headline fires and normal escalation resumes.
  `momVerdict` is untouched (the raw verdict stays honest in the ledger). The Gate-2
  breakdown `CUT` is never silenced or frame-masked. Ships empty (`[]`); fixture-pinned in
  `pipeline/test/holdthesis.test.mjs` + `pipeline/test/watchstate.test.mjs` + `pipeline/test/verdictpersist.test.mjs`.
  RF0 (PLAN-REVERSE-FLIP) adds an optional additive `reverseFlip: true` MARKER to an entry — the Case-A
  flag that elects a normal tracked hold into the reverse-flip candidate pool; written only when set (a
  bare upsert keeps the pre-RF0 shape byte-for-byte), preserved across later upserts.
- `owned-items.json` — tracked repo-root store (RF0, PLAN-REVERSE-FLIP, 2026-07-25): the OWNED-ITEM
  REGISTRY for reverse-flip eligibility. `{_doc, items:[{id,name,seedQty,seedTs,classification,source}]}`
  (mirrors `ignored-items.json`'s `{_doc, items:[]}` convention; an optional `pendingClassification[]`
  holds captured-but-unclassified big-ticket buys). AGENT-WRITTEN via `pipeline/commands/declare-owned.mjs`
  (`seed`/`classify`/`list`); RF1/RF2's screen + the surfacing skills READ it. An item's live
  owned qty is NEVER stored — it is RECOMPUTED off `fills.json` via `ownedledger.computeOwnedQty`
  (`seedQty + Σbuy − Σsell` over events with `ts ≥ seedTs`; the same never-patch-a-derived-number
  philosophy `positions.json` uses). `classification` ∈ `keep`/`flip`/`consumable` — `classification:'keep'`
  IS the reverse-flip candidate pool (Ruling 8: NO per-item opt-in flag; RF1's oscillator filter + Ben's
  per-run table selection pick the actual candidates from the kept set). A Case-B (pre-log, sold-first)
  item MAY also carry an optional `seedBasis` (acquisition cost each) — the acquisition basis
  `reconcile-reverse-flip.mjs` (RF3) reads to build the BANKED-backfill command (absent → RF3 prints a
  "declare the seed first" note instead of a fabricated basis). **The COMMITTED copy ships EMPTY**
  (`{_doc, items:[]}`); on Ben's desk it is populated locally with the ≥5m big-ticket bank keeps (27
  items, from the data-export plugin's `container_bank.json`) but held OUT of the public repo via
  `git update-index --skip-worktree owned-items.json` — so the file is full on disk (the reverse-flip
  screen reads it) yet `git status` shows nothing and it never commits/pushes (his holdings stay off
  GitHub; see memory `owned-items-skip-worktree`). To edit the committed stub's schema: clear
  skip-worktree, edit to the EMPTY shape only, commit, re-set skip-worktree, repopulate locally. No PII
  (ids/names only). Fixture-pinned in
  `pipeline/test/ownedledger.test.mjs` + `pipeline/test/reverse-flip-cli.test.mjs`.
  `keepIds` (the SM1 round-trip gate) and `keepMisclassificationRisks` (the mis-seeded-keep hygiene
  warning `sync-fills.mjs` prints) also live here — pinned by `pipeline/test/symmetric-matching.test.mjs`,
  which builds its fake owned store at runtime and never reads the real `owned-items.json`.
- `reverse-flip-state.json` — tracked repo-root store (RF0, PLAN-REVERSE-FLIP, 2026-07-25): the declared
  reverse-flip CYCLE store — a flat array of `{id,name,state,soldQty,soldEach,soldTs,beRebuy,targetQty,
  rebuyBidPrice,rebuyBidTs,declaredTs}` (mirrors `hold-thesis.json`'s shape/CLI pattern). `state` walks
  `holding → awaiting-rebuy → rebuy-armed`. AGENT-WRITTEN via `pipeline/commands/declare-reverse-flip.mjs`
  (`set`/`advance`/`clear`/`list`) when Ben reports the sell/rebuy; `/schedule`·`/book`·`/positions`
  READ it (RF4, 2026-07-25) to keep an in-flight cycle visible between the sell and the rebuy (it holds no
  open FIFO lot / no slot) — inform-only, zero-ripple (an empty store surfaces nothing extra). It is scheduling/UX bookkeeping, NOT the source of ownership truth (that's the
  `computeOwnedQty` fold). `beRebuy = soldEach − tax(soldEach)` (canonical `js/money-math.js` tax(), E8).
  Ships empty (`[]`); a 30-day TTL prunes stale intent. Fixture-pinned in
  `pipeline/test/reverseflipstate.test.mjs` + `pipeline/test/reverse-flip-cli.test.mjs`.
- `pipeline/experiments/` — **deliberately removable** standalone probe logs, isolated from the main
  pipeline on purpose (nothing under `pipeline/commands/`, `js/quotecore.js`, `suggestions.jsonl`, or
  `positions.json` reads it — delete a file or the whole dir and nothing else breaks). `README.md`
  documents each probe; `ladder-probe-2026-07-16.jsonl` is Ben's 2026-07-16 sell-ladder fill-time probe
  (rung/price/timeToFillSec per offer on two thin books) — real fill-time-vs-price data to replace guessed
  reliability-discount constants, honest n=1. Also three read-only 2026-08-04 archive studies, each a
  `*-study.mjs` + a `*-FINDINGS.md` report: `flow-crossover-study.mjs` (does an instasell→instabuy flow
  crossover mark a bottom? — **clean null**, lift 1.14 vs placebo 1.08), `volume-vs-band-study.mjs` (does
  volume predict % band width? — strong NEGATIVE across items at equal price, ρ≈−0.85 in the MIDDLE
  deciles only, weakening at both extremes incl. the big-ticket decile; weak POSITIVE
  within an item day-to-day), and `edge-map-study.mjs` + its shared `edge-map-lib.mjs` panel builder
  (realized-P&L-vs-characteristics · liquidity-gate placement + the subsampling artifact test · the
  volume→band lead/lag null · the price×volume exclusion map, strike-checked against our own lots;
  `--section a|b|c|d`, panel cached to the gitignored `pipeline/.cache/edge-map-panel.jsonl`). Plus
  **`floor-strategy-study.mjs` → `FLOOR-STRATEGY-FINDINGS.md`** (2026-08-11) — is "at its N-day low"
  (1/3/7/14/30) a buy signal? **No, and this was already closed** as a measured negative one day
  earlier by the day-low-surfacing work (PLAN.md's `DL-0` Status row); this is a re-measurement under a different
  construction that reproduces the closure cell-for-cell. A real *relative* signal (monotone in N,
  survives an entry-lag control) that is **not a trade**: best after-tax round trip +0.26%/7d ≈ 15k
  gp/day on 40m vs the 250k gp/day attention floor. `termStructure` already ships `pctInRange` at
  1/3/7/14/28d, so the gap was presentational only. `--section a|b|c|d`, `--json`; needs the local
  archive + `mapping.cache.json`, so it does NOT run on a clean checkout. **Carries a retraction
  banner** — an adversarial review overturned two of three headline claims (floor slope is NOT a
  discount-vs-knife discriminator; the drawdown-depth section is unresolved, not refuted). Quote §1/§2
  only. Plus **`range-persistence-study.mjs` → `RANGE-PERSISTENCE-FINDINGS.md`** (2026-08-11) — if an
  item has a DEMONSTRATED, repeatedly-traversed range and is sitting at the bottom of it, is that a buy
  ("the value strategy with less speculation")? **No — DON'T BUILD.** Rolling-origin walk-forward over
  74 full days: range fitted strictly on days T−28…T−1, read day T, enter T+1, exit T+1+H (H ∈ 4/7/14).
  Six arms including the load-bearing **amplitude-matched control** (same ≥6% band, repetition condition
  removed) and the real `valueGate`/`valueTier`. Within item, A−F is not significantly positive in any of
  6 cells; the amplitude-matched persistence lift is 0.70–0.83 (the criterion *anti*-selects); a 2-day
  entry lag turns the excess negative. **~59% of the raw round trip is bid-ask spread**, so
  `excessNet`/`driftLo` (spread-free) are the only trustworthy columns. **Zero arm-A items above 100k gp
  under the shipped units gate** — it cannot speak to the big-ticket class, which leaves Ben's original
  multi-week-oscillator question unmeasured rather than answered. Incidental but load-bearing:
  **`oscillationVsKnife` fires as a function of series LENGTH** (see its entry under `js/forecast.mjs`).
  `--section a|b|c|d|e`, `--json`; needs the local archive + `mapping.cache.json`, so it does NOT run on
  a clean checkout. **Carries a correction banner** — two adversarial passes overturned seven headline
  claims and found two script bugs; the verdict survived, the numbers were re-derived. Plus
  **`amp-cycle-reproduction.mjs`** (2026-08-09, DT1b) — the head-to-head that settled which of two
  round-trip measurements was broken: the in-sample day-grain `cycleCompletion` vs the DT1 study's
  out-of-sample hour-grain design. The study reproduces exactly (Saturated heart 0.0% @96h n=41; Masori
  chaps 12.9% @24h n=31) while the in-sample version reads ~100% on the same items, which is why
  `ampWalkForward` ships and `pFillAmplitude` ranks on it. UNLIKE the others it is NOT freely deletable:
  `js/amplitudescreen.mjs` and `js/estimators/families.mjs` both cite it as their validation source, and
  it is the standing regression check. It runs THREE columns — the rejected in-sample figure, an
  independent reimplementation of the study, and the SHIPPED `ampWalkForward`. Cols 2 and 3 agreeing is
  the HEALTHY state (they are independent implementations of one design). Col 1 converging on col 3 ⇒ a
  break in the shared helpers; col 3 diverging from col 2 ⇒ a regression inside `ampWalkForward` itself.
  Plus **`dt4-window-gate-study.mjs`** + **`DT4-WINDOW-GATE-FINDINGS.md`** (2026-08-09, PLAN-DIURNAL-TRIAGE
  DT4) — the measurement that had to precede the DT4 build: does a per-item split-half reliability gate on
  the diurnal shape actually select items whose window holds OUT-OF-SAMPLE? Gate = parity split (even/odd
  days) Pearson-correlated on `hourProfile`'s per-hour `devLow`/`devHi`, computed on the FIT PERIOD ONLY;
  test = a temporal holdout (fit on the first 2/3 of days, score the fitted dip/peak hour against each
  held-out day's median) versus a same-day random hour. Answer: the gate DOES discriminate and the lift is
  monotone across five buckets (PASS +15.0/+16.9pp vs FAIL +8.8/+9.2pp at r≥0.6, 3.8% pass), and the
  quietness confound is refuted backwards — gate-pass items are the LIQUID ones and the gap is widest in
  the high-volume tertile. **But gate-fail items still show ~+9pp**, so the findings RECOMMEND AGAINST DT4
  as specified (suppressing the window on failure) in favour of modulating confidence. It measures
  within-day HOUR RANKING, not fills — deliberately a different question from the triage's resting-offer
  null, and not an EV claim. Freely deletable; nothing imports it.
  All read the `/1h` SQLite archive read-only and gate nothing.
- `ignored-items.json` — tracked repo-root config (2026-07-07): items QUARANTINED from the MERCH
  book (farming inputs / loot / personal-use — e.g. snapdragon seed 5300, snapdragon 3000). Its
  `items` are dropped from the DERIVED merch views (`positions.json` phantom lots + unmatched-harvest
  sells, `offers.json`, and watch's live-offer rows) while their raw events STAY in `fills.json`
  (full audit — this is a VIEW filter, never a deletion). A `greenlisted` array `[{id,qty,price,ts,
  consumed}]` surfaces a *specific* transaction as a real flip (matched on id + price ±3% + ts ±6h) —
  the agent appends one when Ben confirms a recommended flip of an ignored item (he only flips these
  on a rec, so every legit flip passes that gate). Read + matched by `pipeline/lib/ignored.mjs`,
  applied in `sync-fills.mjs` (positions/offers derivation), `monitor-offers.mjs` (live-log views), and
  `lib/offers.mjs activeOffers` (watch); fixture-pinned in `pipeline/test/ignored.test.mjs`.
  **EDITED FROM the app (0.63.0):** the deployed app's **Ignore tab** (mirrors Watchlist) is an EDITOR
  — add/remove items (🚫 on a Finder row, reason picker in the tab) and push `items` back via the
  GitHub contents API (`putJsonFile`, same path as `watchlist.json`), PRESERVING `_doc` + `greenlisted`.
  The app never applies the quarantine itself — it only curates the file; the pipeline applies the
  filter on its next sync. `js/github.js IGNORED_PATH`; handlers + `loadRepoIgnored`/`renderIgnore` in
  `js/ui.js`; `STATE.ignored`/`STATE.ignoredMeta` in `js/state.js`.
- `pipeline/pipeline-config.json` — **OPTIONAL, absent by default** (PC1, PLAN-PIPELINE-COMPOSITION).
  When present, sets pipeline-wide DEFAULTS the CLI flags can still override — the middle tier of the
  `pipeline/lib/market/compose.mjs` `resolve()` precedence chain (**CLI flag > this file > hardcoded fallback**).
  Its ABSENCE is the default state and produces byte-identical behavior to the pre-PC1 inline defaults;
  do not commit one just to have it. Read (once, cached) by `loadPipelineConfig()`. Minimal shape:
  `{ "mode": "band", "volSource": "rolling", "sellModel": "reach-fold", "asym": false, "phaseRescue": false }`
  (any subset — an unset key falls through to the hardcoded fallback). Consumer: `compose.mjs`, via
  `screen-flip-niches.mjs`/`quote-items.mjs`/`watch-positions.mjs`.
- `suggestions.jsonl` — tracked, append-only suggestions ledger (O1): every emitted
  recommendation, one JSON object per line, written by `quote-items.mjs`/`screen-flip-niches.mjs`/`watch-positions.mjs`
  via `pipeline/lib/render/suggestlog.mjs`. Rows carry a lean **`guide`** field (BD-LOG, 2026-08-09) — the GE
  guide price at emit time, the anchor the in-game −5%/+5% offer buttons compute off. It rides off
  `row.guide` (`computeQuote`), so it cost zero call-site changes, and it is **not reconstructable after the
  fact**: the archive schema has no guide column, `pipeline/.cache/guide.json` is a 10-minute snapshot
  overwritten in place, and `pipeline/.guide-history.jsonl` records only re-anchor *changes*. The live side
  needs no new field — `quickBuy` IS the live instasell and `quickSell` IS the live instabuy — so this one
  field makes **both** depth-vs-guide and depth-vs-live computable from a single row, which matters because
  the two anchors disagree on whether an offer is "past −5%" for 52 of 428 measured offers. Rows also carry a lean **`volSrc`** tag (SF-3, `'bulk'`|`'peritem'`)
  recording which `/24h` endpoint the liquidity `class` volume came from (screen = bulk; quote = bulk
  when `all24h.json` was warm, else per-item) so F1 can normalize the two snapshot sources. A row may also
  carry a lean **`askHeadroom`** object (PLAN Bar-E-signal) when the robust p90 shaved a TRADED in-band top
  off the quoted ask — `{gap, gapPct, rawTop, topBucketVol, netLever, trusted}`, logged trusted AND
  audit-only, joined to fills by `analyze.mjs` §5 (`askHeadroomAudit`) for F1. A `watch` held row may
  carry the lean **`depthExit`**/**`reachable`** pair (PLAN-DEPTH-EXIT DE3, 2026-07-15): the depth-floor
  read incl. its collapse REASON + liquidity class, and the pressure-driven reachable band. RC-S1/RC-S2
  (PLAN-REACHABILITY-CONSOLIDATION) co-log the competing exit estimators — reach (`estConfidence`) ·
  reachRelief (**`estBuy`/`estSell`/`estConfidence`**) · **`asym`** · depth (**`depthExit`**) — for the F1
  head-to-head against the realized `sellEach`; pressure's **`reachable`** rode beside them until its ASK
  leg stopped logging with the 2026-08-30 retirement (the bid/band record continues, historical rows still
  score). The head-to-head spans HELD
  (watch, quote `--positions`) AND DISCOVERY (screen survivors, quote per-item): `reachable` rides every row
  with an in-hand 1h series; `depthExit` rides only held rows (real qty in hand — the DE7 fetch-budget rule
  keeps depth off the screen). All three shadow shapes come from ONE reshaper home
  (`suggestlog.mjs reachableShadow`/`depthExitShadow`/`asymShadow`). The `asym` leg also rides the screen
  rows the `spec.admitMinNet` gate DROPS (the `admitSkip` marker, PP0): those rows are kept in the ledger
  precisely because they are where the reach-fold pair and the asym pair disagree most, and without the
  `asym` field they could not answer that question. ⚠ ON-DISK CAVEAT: every `admitSkip` row written before
  PP0 carries no `asym` at all, and a churn (`fillShape:'symmetric'`) skip row legitimately omits it at any
  date — split a join on mode AND date, never read absence as "no asym read". `suggestlog.mjs`'s DATA
  CAVEATS block is the ONE home for that split. _(The screen's lean `demandRegime`
  `◈ demand` shadow/note was REMOVED 2026-07-22, PLAN-REMOVE-DEPTH-PRESSURE-READS — git-revivable.)_ A screen row also carries
  the **`expGpDay`**/**`expGpDayLegacy`** shadow pair (PLAN-CAPITAL-THROUGHPUT, 2026-07-14): the ACTIVE
  capital-aware attention-floor throughput (`min(limit, deployablePool/mid)×2 × net`, where ×2 is
  `ACTIONABLE_WINDOWS_PER_DAY` — **this line said ×6 until 2026-08-10**, the physical refill count, and was
  missed by that day's own ×6→×2 sweep) beside the legacy
  capital-blind value, so `--stats`/F1 can diff old-vs-new surfacing (`--throughput legacy` restores the
  blind value). A churn/scalp screen row (and every `quote-items.mjs` per-item read) also carries a lean
  **`winClear`** object (PLAN-WINDOW-CLEAR B2): the within-window CLEAR read for the quoted ask over its
  diurnal peak window — `{windowReach, reachedDays, nDays, pool, clearRatio, wStart, wEnd, diverges}` — so
  F1 can test whether the days-reach ≠ lap-clear divergence predicts an unfilled/slow ask (the note fires
  on the window-reach leg only; `clearRatio`/`sizeShort` ride the shadow for calibration).
  A **BIG-TICKET held row** (`quote-items.mjs --positions` / `watch-positions.mjs`, lot ≥ `BIG_TICKET_GP`
  or watchlisted) also carries a lean **`windowExit`** object (WC1, PLAN-WINDOW-CLEAR-OUTCOMES,
  2026-07-20) — the FORWARD record of the surfaced window-clear ask RUNG: `{ list, live, peakWindow:
  [startH,endH], hiReach:{reached,n,recentHit,recentDays,placement}, fiveReach:{reached,n,placement}|null,
  reachMargin:{trend,cushions,reachedRecent/nRecent,pace}|null }` (field-by-field schema: `suggestlog.mjs`'s
  header, the ONE home; a stale-refusal pace logs `{stale, ageMin}`, never a fabricated gap)
  off `js/windowread.mjs askExitRead` (reshaped by `suggestlog.mjs windowExitShadow`). It logs the surfaced
  list level, the diurnal peak window it targets, and the TWO competing reach signals SIDE-BY-SIDE — daily-
  HIGH (1h avgHigh) reach and the less-smoothed 5m-grain reach — so a later WC2 join against `fills.json`
  (and F1 accrual) can measure which signal predicts whether the resting ask actually FILLED in its window.
  `fiveReach` is `null` when the 5m archive is thin/absent — never faked (honesty). Distinct from `winClear`
  (that keys the within-window lap-clear on `optSell`; `windowExit` keys the rung's two reach signals +
  placement). Producer: the two positions/watch held-lot surfaces; consumer: F1 accrual / the future WC2 join.
  A screen flip-niche/amplitude row also carries the lean **`capEff`**/**`weakDeploy`** shadow pair
  (PLAN-CAPITAL-EFFICIENCY-AND-DIGEST, 2026-07-21): `capEff` = after-tax ROI%/day of capital tied up
  (`roiPct ÷ holdDays`, a churn lane's `holdDays` reflecting its laps/day), `weakDeploy` = the big-ticket
  single-turn (non-churn) thin-per-turn flag (mid ≥ `BIG_TICKET_GP`, roiPct < ~0.5% PLACEHOLDER). Computed
  inline in `screen-flip-niches.mjs` (`capEfficiency`/`weakDeploy`). The LEAN-LOGGED `capEff` is the INTRINSIC
  per-turn-efficiency (size-independent, calibration-friendly); the console-only `--digest` decision block
  DISPLAYS a REALIZABLE, buy-limit-bounded `capEff` (laps/day capped at the deployed size) but RANKS on
  `rank` = net × P(fill) ÷ TTF (AF1 — scale-aware and wallet-free; `capEff × deployable` via the reused
  `valuescreen.mjs deployUnits` survives only as a tie-break, because on a fully-deployed book it collapses
  to 0 for every row and the order fell through to scale-free `capEff`. A guaranteed `— big-ticket lane —`
  slice keeps big deploys visible; the sort basis is stated once, in the block's own printed header).
  Two DIGEST-ONLY denoisers (W3, PLAN-OSCILLATION-CYCLE, 2026-07-22) reshape only the digest sort/verdict:
  `liveCrossable(row)` FLOORS an uncrossable-live-spread row (`row.quickRoi <= 0`) to the bottom of the
  digest sort (comparator only — displayed `capEff` unchanged, row still renders) + fires the top-priority
  `spread closed now` verdict (DISTINCT from the one-sided-book "ghost spread" caught by the two-sided-liquidity
  gate); and the amplitude digest rank basis (`ampEr.net`) uses the drift-adjusted `driftShadow.margin` (falls
  back to `netPerCycle`) so a fading mirage sinks. Neither touches the per-niche `rank`/`grade`.
  INFORM-ONLY (n≈0), never a gate/`screen.json` field. Consumer: the future retro-join calibration.
  A screen-flip-niches.mjs survivor row also carries a lean **`timedLap`** object (DT4,
  PLAN-DIURNAL-TIMING, 2026-07-23): the `js/windowread.mjs` `diurnalTimedLap()` result reshaped by
  `suggestlog.mjs timedLapShadow` — either `{ degraded: true, reason: 'thin-history'|'no-window' }`
  (never faked) or `{ bid, ask, dipWindow, peakWindow, net, roi, instantNet, instantRoi, holdHrs,
  clean, lowTrend, hiTrend, bidReach, askReach, dipPool, peakPool, trancheComfort, trancheCeiling,
  fitNights, peakReality, dipReality, bidBasis }`. _(The last three landed with Chunk 2c, 2026-08-13;
  `fitNights` with DT4b and was missing from this registry until the same pass.)_ **`bidBasis` is not
  decoration: `bid` is REPRICED to the live instasell when the dip is not below live, so on a
  `bidBasis: 'live'` row `dipReality` describes a level that is NOT the `bid` beside it.** A retro that
  joins `dipReality`→`bid` without splitting on `bidBasis` silently mixes two populations. Rows written
  before 2026-08-13 lack all four fields — **absent ≠ clean**.
  This is the §7 **data guarantee** made concrete at the ledger layer — DT2 already computes a
  `timedLap` for EVERY flip-niche survivor (not just top picks), so this field rides every row the shadow
  logs, healthy or thin/degraded alike; the SEPARATE render guarantee (the printed `↳ diurnal` note)
  stays soft — it prints only when there's something worth telling Ben (`pipeline/lib/render/emit.mjs
  formatTimedLap`). PLACEHOLDER (n≈0, rule 4) — never a gate/rank/`screen.json` input. Not yet wired
  on `quote-items.mjs`/`watch-positions.mjs` (their rows log a byte-identical shape without it).
  Coverage pinned by `pipeline/test/dt4-timedlap-coverage.test.mjs`.
  A screen band/churn survivor row also carries a lean **`pathA`** object (PLAN-LANE-ADMISSION Chunk E/H1,
  2026-07-25): the Path-A intraday-flip gp/day forward record `{ gpDay, marginU, captureFrac, cyclesDay,
  units, price, intradayRange, lane, rankInLane }` off `pipeline/lib/signal/patha.mjs` `pathAGpDay` + the row's
  rank within its gear/churn lane this run. This is the ACCRUAL half of the H2/H4 forward validator — Path-A
  is the CONSOLE PRIMARY sort now (Chunk D) but its `captureFrac` is a PLACEHOLDER (n=13/12, own-book-biased),
  so the future join scorer reads this field to test whether the predicted `intradayRange` materialized and
  captureFrac holds forward, before any recalibration. Absent on a null-Path-A row (no intraday range) /
  non-screen scripts (YS2 lean-include). IDs/prices/timestamps only, no PII. Consumer: the future Path-A
  forward-join calibration.
  Every screen flip-niche row also carries the lean **admission-provenance trio** (EF-0a, 2026-08-01 — the
  PLAN.md Discovered `via`+rank logging, the reserve-retirement prerequisite): **`via`** (`'reserve'` |
  `'explore'` | `'watch'` — how the row won its fetch slot; absent = ranked-in/held, the natural-experiment
  baseline. `'watch'` (PP-R) is the one value also emitted under `--admission legacy`, since it is stamped in
  `rankAndSlice`; `preRank`/`prePool` remain `pickFetchPool`-only), **`preRank`**/**`prePool`** (the candidate's 1-based position in its flip-niche's pre-fetch
  ordering + that pool's size — "would have ranked 12th of 178"; stamped by `admission.mjs
  pickFetchPool`, NOT reconstructable after the pass; absent under `--admission legacy`), and
  **`askPlacement`** (the quoted ask's daily-HIGH placement percentile the `--digest` verdicts already
  compute; band/churn renderMode rows only). Each screen pass ALSO appends ONE **admission-exclusion
  AGGREGATE line per flip-niche** — `{ ts, script:'screen', mode, params, prePool, excluded:[{ id, reason,
  preRank?, expGpDay? }, …] }` (`suggestlog.mjs excludedShadow`) — recording the CROWDED-OUT set (every
  gated candidate that never got a fetch slot, with its SC1 reason). These aggregate rows are admission
  telemetry, not suggestions: they carry NO `itemId`, so every suggestion→fill joiner skips them
  (analyze-record additionally exempts them from its noKey health counter). Consumer: EF0's
  counterfactual (PLAN-ESTIMATOR-FIDELITY) + the reserve-retirement comparison.
  **Bounded to the CURRENT month (SR1):** on append,
  `logSuggestions` rolls any completed month out to a monthly archive (see below), so the
  root file never grows past ~a month of rows. F1-gating accrual is preserved — history is
  archived, never deleted.
- `pipeline/suggestions-archive/` — **gitignored, local-only** dir of completed-month archive files
  `suggestions-YYYY-MM.jsonl` (SR1), moved OUT of the deploy root by `rotateLedger`
  (`pipeline/lib/render/suggestlog.mjs`). Same schema/lines as the active ledger; the append-only O1
  calibration history. Read together with the active file via `readSuggestionLines` — any full-
  history reader (`join-outcomes.mjs`'s F1 join, `retrojoin.mjs`'s P6a suggestion→fill join) MUST use
  that helper, not the active file alone.
  Created lazily on the first rotation (empty until a month completes). **NOT committed** (Ben,
  2026-08-07): 75MB and growing ~13k rows/day, so it is gitignored and `sync-fills.mjs --publish`
  deliberately omits it from its commit set. Consequence: the rolled-out months exist on ONE disk
  only and are not backed up by the repo — only the active month (`suggestions.jsonl`) is published.
- `screen.json` — the published opportunity screen the app's Scan tab renders (written by
  `screen-flip-niches.mjs --publish` to the REPO ROOT — the R3-rename REPO_ROOT regression that briefly
  wrote it to `pipeline/` is fixed). Each flip-niche row is `{ id, cells }` — the NEUTRAL F1-gated
  decision surface. (The PB4 per-row `reachable` band and the app's default trial pressure column it
  fed were RETIRED 2026-08-30 with the pressure exit estimator — join-exit-ev.mjs's criterion, CHANGELOG
  0.76.0; a pre-retirement screen.json still renders, minus that column.) Also carries a top-level `html` field
  (2026-07-16, PLAN-VIZ-LAYER Stage-2) — one pre-rendered HTML string per flip-niche + watchlist
  (`pipeline/lib/render/render.mjs` `renderHtmlTable`, the server-side twin of `js/ui.js`'s client-side
  `scanTableHtml`), ADDITIVE beside `cells` (never a replacement); the app prefers `html[key]` when
  present, falling back to client-side rendering for a screen.json published before this field
  existed. **Publishing is now the DEFAULT every run**
  (2026-07-16, `--no-publish` opts out) — the local file write only, never a git commit (that stays the
  once-a-day `/overnight` `sync-fills.mjs --publish`). Also carries an OPTIONAL top-level `analysis`
  string (2026-07-16) — a judgment blurb rendered above the tables on the Scan tab (`#scanAnalysis`,
  `js/ui.js` `renderScan`), set via `pipeline/commands/set-scan-analysis.mjs` (a separate, zero-refetch
  patch command — the analysis is the judgment PASS OVER an already-published scan, not part of the
  scan itself); absent → the section stays hidden, never an empty box.
- `pipeline/commands/set-scan-analysis.mjs` — patches repo-root `screen.json`'s optional `analysis`
  field (or `--clear`s it) without re-running the scan. CLI-only, trusted-input (the app renders it as
  raw HTML) — never wire an untrusted input path to this.
- `PLAN-OUTPUT-TABLE.md` — in-flight per-topic plan: the reach-folded `Est. buy`/`Est. sell`
  console table (shipped 2026-07-13 as `js/estimators.mjs` `estimatePair` + the `screen-flip-niches.mjs`/
  `quote-items.mjs` default stdout view with `--raw` as the model-free escape hatch; console-only, no
  `screen.json`/app change). Folds into `PLAN.md` and is deleted when its last chunk ships (the
  plan-file rule).
- `plans/PLAN-SALE-LOG-TAX.md` — in-flight per-topic plan (raised + planned 2026-09-01): RuneLite's
  Exchange Logger format switch (2026-08-26, `.log`→`.json`) silently changed the sell-terminal
  `worth` field from GROSS to NET-of-tax, so `matchTrades` taxes it a second time and profitable
  sales book as losses (lifetime realised understated 3,580,466 across 5 rows + 1 unmatched;
  `deriveCash`'s sellIn double-taxes the same way). §1–§8 are the problem statement (symptom,
  evidence split, blast radius, 8 triage-proven traps); §9–§12 the decided design: extension-based
  `isNetWorthSource` discriminator stamped as `worthNet:true` on sell events at both readers
  (`regenerate()` + `readOfferRows`), interpreted in `matchTrades`/`deriveCash` (net is the money
  path, gross recovered via a new `grossFromNet` beside `tax()` in `js/quotecore.js` for display),
  a per-file convention cross-check guard, and a real-book acceptance list. Ingest normalisation
  was REJECTED because rewriting `spent` breaks the `eventId` content-hash merge/tombstone
  contract. Folds into `PLAN.md` and is deleted when its last chunk ships (the plan-file rule).
- `plans/PLAN-DIGEST-SIGNAL-AND-SCAN-PERF.md` — in-flight per-topic plan (2026-08-07, **PARTLY SHIPPED —
  SP1 landed**; corrected 2026-08-09, this entry said PLANNING ONLY / no code changed): two workstreams that share one file (`pipeline/commands/screen-flip-niches.mjs`)
  and therefore one parallel-safety contract. **A — digest SIGNAL:** as of that plan's writing
  `buildDigestBlock`'s comparator ranked on `capEff × deployable` and never read the `reach` column it
  prints, so its top slots went to rows its own `digestVerdict` calls `sell unreliable` (live anchor 2026-08-07: 9 of 11 rendered rows,
  top four graded C/C/D/B-, the only `A- fill-now` row at #5). **BOTH HALVES OF THAT PREMISE ARE GONE:**
  AF1 moved the comparator to `rank`, and SEP12 DELETED the `sell unreliable` verdict outright and
  shipped DS2's honest reach cell. The plan carries a banner saying so; what remains open is DS0/DS1. Chunks DS0 (log the digest's computed
  fields — `verdict`/`reachHit`/`reachDays`/`marginTrend`/`crossable`/`deployable`/`rankKey`/
  `capEffRealizable`/`digestRank`, none of which survive a pass today) → DS1 (a read-only
  market-counterfactual study, `report-digest.mjs`: *did the quoted ask actually print within
  12/24/48h*, since a fills-joined study is structurally impossible at 92 filled / 88,272 not-taken)
  — see also **`pipeline/commands/report-archive-gate.mjs`** (AF5, PLAN-ARCHIVE-FIRST-FUNNEL): READ-ONLY
  evidence for whether the LOCAL archive reproduces the gate verdicts we currently pay a per-item
  `/timeseries` call for. Runs `reachValidator` twice per item — once on the live 1h series, once on the
  same span read from the archive — with the SAME candidate level (the live instabuy, external to both
  series) and the same `now`, so only the series source varies. Measured 2026-08-07: **25/25 (100%)**
  verdict AND hit/days agreement across the watchlist. ⚠ Read that number with its limit: 1h is
  byte-identical archive-vs-live (AF4), so this run largely confirms identical inputs give identical
  outputs — the test with real power is the DERIVED 6h grain at AF5b, not this one)
  → DS2 (render the reach cell's raw counts — measured, `askRecDays === 3` on **100%** of logged rows,
  so the ✓/✗ glyph is a 3-sample binomial and ✗ is 55% of every board) → DS3 (the LOW-placement /
  crashed-regime trap — 11% of rows sit at `askPlacement ≤ 0.05` where 84% render a mechanically
  meaningless reach ✓) → DS4 (a W3-1-shaped sort floor scoped to the unambiguous `0/3` cell,
  **gated on DS1 — and ❌ SHELVED 2026-08-07 when that gate rejected it**) → DS5/DS6/DS7 (the inverted
  `LAPS_PER_DAY_CEIL` asymmetry, an exit-pool column, the drift fold), plus DS8 (90-day retention on
  the suggestions ledger). **DS1 was PILOT-RUN 2026-08-07** and is the wave's pivot: archive coverage
  of the next-24h window is **99.9%**, and the quoted ask printed within 24h on **55.4% / 58.6% /
  65.0% / 69.9%** of rows in the `0/3 → 3/3` recent-reach cells (n = 776/418/346/652, z ≈ 5.6). The
  gradient is real but a `0/3` ask still prints more often than not — so the 3-day reach basis is a
  *tilt*, not a *gate*: DS2 was promoted to the primary signal deliverable, DS6 became a **replacement**
  of the saturating `deploy` column rather than a 10th, and **no chunk in this wave re-ranks the
  board**. **B — scan PERFORMANCE:** SP1 parallelises `runWatchlist`'s strictly-serial fetch
  loop (measured 6.0–9.5s of a 14–17s run; the survivor burst at peak concurrency 15 is already
  optimal and is left alone), SP2 settles the FC1 cache scoping per-endpoint (`fetchTsCached` on the
  bucketed 1h series in `read-window-range.mjs`/`read-schedule.mjs`; `COFFER_FETCH_CACHE` stays off
  forever — and per Ben's 2026-08-07 ruling the served series must SURFACE its age, so SP2 is
  "identical numbers + one visible age token", not a silent swap), SP3/SP4/SP5 cover the `loadBands`
  cold backfill, `archive.append` batching (don't bother) and `cache-warm`'s wrong-grain health check.
  **SP5's measured mechanics (2026-08-07):** the `TheCofferCacheWarm` task fires **every 4h** and
  fetches only **BULK** `/1h?timestamp=` + `/5m?timestamp=` snapshots (one measured `/5m` call =
  156KB / 1,799 items / ~124ms; ≤24 per grain) — it never fetches an item individually, so it does
  NOT warm the per-item `/timeseries` calls that dominate a scan, and SP1's savings ADD to it rather
  than overlap. Because `loadBands` looks back only 2h, the 4h tick is **lossy**: measured, only
  **139 of 288 daily 5m buckets (48.3%)** are captured. **SP5 was APPROVED 2026-08-07** (tick 4h →
  105 min, a `Set-ScheduledTask` edit with no code): head **5.5s → ~294ms**, 5m capture → ~100%, and
  Ben explicitly accepted the measured archive-growth cost (**~13 → ~24MB/day, ~4.9 → ~8.8GB/yr**, at
  ~45 bytes/row). Every chunk carries expected benefit, confidence,
  risk-of-cutting-a-good-candidate, effort and rollback, plus an explicit
  behaviour-preserving-vs-changes-what-surfaces label and a do-first/do-later/don't-bother split.
  Produced by a planning session; consumed by an executor + `PLAN.md`'s Status table. Folds into
  `PLAN.md` and is deleted when its last chunk ships (the plan-file rule).
- `PLAN-MCP-BANK-SERVER.md` — READ-ONLY scoping doc (2026-07-24, no code): a local MCP server that
  reads Ben's RuneLite `data-export` plugin output (`~/.runelite/Data Exports/container_bank.json`,
  NDJSON, same `{id,quantity,name}` schema the bank dump uses — the plugin is already installed and
  running, a sibling of `exchange-logger`) and exposes `get_bank()`/`get_equipment()`/`get_inventory()`
  plus thin `get_offers()`/`get_fills()`/`get_positions()` wrappers over existing pipeline code. Tier-A
  (file-reader, recommended) vs Tier-B (custom RuneLite plugin + live socket, deferred). Feeds
  reverse-flip RF0's owned-item seed and SUPERSEDES RF5 (the plugin RF5 would have built already exists).
  Server CODE can live in the repo; the bank DATA (private) stays gitignored, never committed.
- `PLAN-GRADE-REWORK.md` — per-topic plan (2026-07-21, un-folded): dimensionally-honest single-source
  screen grading. 9 confirmed flaws in the `net × P(fill) ÷ TTF` grade; chunks G1 (centralize the grade
  caps — incl. FLAW 4b, the reach-cap double-count from blindspot-audit #4), G2 (fold deployable capital
  into every rank family — highest-leverage, app-touching), G3 (invocation-independent per-mode
  normalized grading), G4 (collapse `riskMult` + kill the momentum double-count), G5 (bound TTF leverage),
  G6 (`(thin)` confidence marker), G7 (retro-retune, F1-gated/deferred). PLANNING ONLY, no code yet.
- `PLAN-ESTIMATOR-FIDELITY.md` — per-topic plan (2026-08-01): the discovery
  estimator understates both legs against the daily distribution (the 2h-band basis + the
  clamp-to-bandTop blend make a verified daily-basis ask/dip structurally unquotable), the rank
  buries repriceable rows (dead-bid ⇒ P~0 instead of a repriced-entry alternative; churn's
  symmetric fold exemption lacked a placement bound), and windows-per-day was assumed ×6 in four
  homes while `diurnalTimedLap`'s measured cycle is discarded. _(The ×6 half of that finding was FIXED
  2026-08-10 — every home now takes `ACTIONABLE_WINDOWS_PER_DAY = 2`, including `expUnits`' own
  definition site. The discarded-measured-cycle half stands.)_ Chunks: EF-0a (`via`+rank ledger
  logging — SHIPPED 2026-08-01) and **EF1 (rank-leg honesty: dead-bid `↻ repriced entry`
  alternative, the placement-bounded churn exemption, ONE labeled P per row, the screen-vs-quote
  bid-reach window divergence diagnosed — SHIPPED 2026-08-01)**; open: EF0 (counterfactual +
  `(none)`-bucket attribution report) → EF2 (timed pair as a visible
  second answer) → EF3 (measured cycles post-fetch + constant single-sourcing). Anchor is n=5
  laps on one item — hypothesis-generating, nothing auto-applies without EF0. Starvation stays
  with the fetch-pool-scaling work (PLAN.md's `FPS 1–4` Status row); the band sell fold moves only via AC7's re-decision path.
- `plans/` — the per-topic `PLAN-*.md` working docs (moved off the repo root 2026-07-26). Each is a
  transient planning doc that folds into the root `PLAN.md` (the master plan + scoreboard) and is deleted
  the moment its last chunk ships (`docs/PLANNING.md` lifecycle). `plans/PLAN-*.md` is scanned by
  `pipeline/ci/lint-plan-lifecycle.mjs` for docs past their fold-in point; `PLAN.md` itself stays at root.
- `docs/` — repo docs that aren't app/pipeline reference:
  - `PLANNING.md` — the planning process itself (required plan sections, chunk design rules, the
    skills improvement loop, anti-patterns; written 2026-07-08, follow it when producing any
    improvement plan).
  - `ARCHITECTURE.md` (2026-07-14) — the general-rules layer: what the system IS + the load-bearing
    invariants, in ONE place (the anti-fragmentation index). Split into 🔒 ENFORCED (each naming the CI
    guard that fails on violation — `import-check`/`dead-export-check`/`doclint`/`skill-lint`/`smoke`/replay
    goldens/`archlint`) vs ⚖️ JUDGMENT principles. Its own file references are guarded by
    `pipeline/ci/lint-arch.mjs` (invariant E7). NOT the file inventory (this README is) — the "how it's
    organized + why".
  - `FLOW.md` (2026-07-15) — the end-to-end flow/entity walkthrough companion to ARCHITECTURE.md: how a
    price/trade/suggestion/verdict moves through the system (the two runtimes + shared `js/quotecore.js`
    core; the market-read, opportunity-screen, held-verdict, fill-loop, and learning-loop flows; an
    entities-in-flow-order table). POINTS to this README/ARCHITECTURE/GLOSSARY rather than restating them.
  - `MARKET-ANALYSIS.md` (2026-07-15) — the doctrine behind a market read, extracted from CLAUDE.md (where
    it had grown to ~72% of the file). Six sections built in the order a read is: the output table, the
    tax math, how a candidate is found + validated + ranked, how an entry is priced, the time-of-day reads,
    and what each script does. Every rule is the operating summary + a pointer to the module header that
    owns the full spec (thresholds, provenance, fixtures). CLAUDE.md keeps only the table shape + routing.
  - `GLOSSARY.md` (2026-07-14) — the plain-English lookup for the vocabulary: core concepts
    (flip-niche / held-item strategy, reach, diurnal, band, verdicts, cash tiers…) + the codename
    dictionary (the concept behind each plan-chunk shorthand like `Bar E` / `DL4`). The ONE home for
    term definitions — module headers point here rather than re-explain. Its file-refs are guarded by
    `pipeline/ci/lint-arch.mjs`. Built + maintained by the R1/R2/R3 rename pass (the codename dictionary lives here).
  - `LORE.md` (P7) — narrative/history + superseded-approach rationale (the single-file→split
    story, the LW2/LW3 live desk, the pipeline's eliminated scheduler, the incident anchors behind
    the process rules, the rejected/retired approaches). Nothing here is load-bearing — CLAUDE.md
    "Where shipped work is documented" points here for the stories; invariants stay in module headers.
  - `SKILL-TRIAGE.md` (P7) — the three-way triage (ENCODE / KEEP-AS-JUDGMENT / RETIRE-proposal) of
    every prose rule-block in the four market skills + the memory index. The semantic record behind
    the `pipeline/ci/lint-skills.mjs` tags; hand-maintained — add a row when a skill gains a rule.
- `.gitattributes` — repo EOL normalization (GA1): text sources (`*.js`/`*.mjs`/`*.json`/
  `*.jsonl`/`*.md`/`*.yml`/`*.css`/`*.html`/`*.log` + `.gitignore`/`LICENSE`) are `text eol=lf`,
  the Windows batch launchers (`serve.cmd`/`watch-log.cmd`/`*.cmd`) are `text eol=crlf`, and
  `*.png` is `binary`. Makes line endings explicit instead of per-machine `core.autocrlf`
  guessing — that guessing is what emitted the recurring Windows "LF will be replaced by CRLF"
  warnings on commits touching `suggestions.jsonl`/`pipeline/.guide-history.jsonl`/`PLAN.md`
- `pipeline/` — RuneLite fill-data pipeline + node analysis scripts; not served by
  Pages, not part of the app. **The top level holds only subdirectories** (R3 — the split
  makes each role structural, since the exec bit doesn't): **`pipeline/commands/`** = the
  workflow CLIs you run (screen-flip-niches, quote-items, watch-positions, sync-fills, …);
  **`pipeline/ci/`** = the CI/dev guards + test runner (check-imports, check-dead-exports,
  check-daemon-safety, check-forecast-guards, check-verdict-guards, lint-arch/docs/skills, run-tests, smoke-test) plus two NON-GATING report
  tools the `/cleanup` skill reads (lint-plan-lifecycle, report-branches — never wired into
  `checks.yml`); **`pipeline/lib/`** = the imported-only
  shared libraries — **being regrouped into concept subdirectories one cluster at a time**
  (PLAN-LIB-SUBDIRS, COMPLETE — folded into PLAN.md). The seven clusters: **`pipeline/lib/render/`** = output/reporting (render, emit,
  cli, suggestlog, retrojoin, replay, analyze); **`pipeline/lib/thesis/`** = the declared-state stores
  (holdthesis, sessionthesis, watchstate, reverseflipstate); **`pipeline/lib/reconstruct/`** = the
  FIFO book reconstruction (reconstruct, campaigns, offers, positions, fill-placement, sync-invoke,
  logblind); **`pipeline/lib/timing/`** = the cycle/velocity clock (cyclewatch, velocity, velocitytag,
  staleexit, statetransition); **`pipeline/lib/market/`** = market data acquisition (marketfetch,
  archive, warm-term-structure, compose, guideanchor, item-context, probes, hourly-lmh);
  **`pipeline/lib/signal/`** = scoring/admission (estimators, rating, gatecandidates, admission,
  structural-admission, patha, recovery, range-position, levels, watchlist-report).
  `watchlist-report.mjs` (SEP16b) is the ONE watchlist row builder: `buildWatchlistReport` does the
  bounded prefetch + the per-entry quote→`estimateRank`→`rateItem`→cells/`suggestionEntry` loop and
  returns `{headers, rows, sugg}`; it COMPUTES only — rendering and `logSuggestions` stay with its
  two callers (`read-watchlist.mjs` and `screen-flip-niches.mjs`'s `runWatchlist`), so neither owns a
  second quote loop. It also holds `watchlistNote` (the reason a gate WOULD have hidden a row),
  `roughExpGpDay`, `estFields` and `round2`, all moved out of `screen-flip-niches.mjs` — the gate
  thresholds (`floor`/`gpFloor`/`minGpd`) are PARAMETERS, since they are per-run CLI values.
  Pinned by `pipeline/test/watchlist-report.test.mjs` (11 cases: the column contract, the gate-reason
  vocabulary and its ORDERING, and the row loop's load-bearing lines — the fail-closed thin cap, the
  qcache truthiness admission test, the `(thin)` marker. Every "Kills:" claim in that file was
  confirmed by applying the mutation; the header NAMES the two invariants still unpinned rather than
  implying full coverage). It also carries a KNOWN MOVED DEFECT, pinned rather than fixed: an item
  ABSENT from `v24` renders `one-sided book — uncrossable (ghost-spread)`, because `d?.highPriceVolume
  || 0` cannot tell missing data from a real one-sided book — the opposite reading of the same `d`
  that the `thin` cap takes four lines below, where missing data fails CLOSED. Identical in the
  pre-SEP16b `runWatchlist`, so changing it is a behaviour change (and breaks the byte-match) that
  belongs to its own chunk.
  Files not yet clustered stay at
  `pipeline/lib/` root, and cross-cutting infra — paths, version, ignored — stays there by design;
  **`pipeline/probes/`** = the probe framework; **`pipeline/test/`** = all
  `*.test.mjs` suites + `fixtures/`; plus the two pipeline docs and generated data files.
  - **Workflow CLIs (`pipeline/commands/*.mjs`, run directly):** `sync-fills.mjs` (parse logs →
    `fills.json`/`positions.json`/`offers.json`; **DEFAULT is LOCAL / zero-git** — the cheap in-session
    book read run at the top of every `/scan` + `/positions`; **`--publish` is the once-a-day `/overnight`
    commit + push** that fetches/ff-pulls phone trades and updates the deployed app; `--local` = an
    explicit synonym for the default — LW1, exported `regenerate()` core),
    `watch-log.mjs` (LW1 local daemon — `fs.watch` the exchange-logger dir + `regenerate()`
    in-process on every change, ~10s debounce, **zero git**; also writes a liveness
    `heartbeat.json` at the repo root every ~30s (LW3, zero git) so the localhost stamp shows
    "watcher live" independent of book changes; started manually via
    `watch-log.cmd`, dies with the terminal — see `FILLS-PIPELINE.md` §14),
    `dev-server.mjs` (LW4 local dev HTTP server launched by `serve.cmd` — serves the repo-root
    static files (ES modules, correct MIME) exactly like the old Python `http.server` AND exposes
    ONE localhost-only endpoint `POST /api/scan` (bound `127.0.0.1`) that runs `screen-flip-niches.mjs --mode
    all --publish` (rewrites `screen.json` with **ZERO git**), single-flight-guarded, so the app's
    Scan-tab "Refresh scan" button runs a REAL local scan; never reachable off-localhost, no git
    ops — see README "Local development"),
    `ensure-server.mjs` (2026-07-18 — liveness-check-and-nudge for the local live desk: probes the
    daemon `heartbeat.json` (>90s = stale) + an HTTP GET of `:8000`, and spawns `serve.cmd` detached
    if EITHER is down. NOT a supervisor — no retries/polling; `/morning` §0 runs it first so the
    morning pass checks the desk is up instead of assuming it. Consumed by `.claude/skills/morning`),
    `add-manual-fill.mjs` (inject/tombstone
    manual fills), `quote-items.mjs` (per-item / `--positions` market table; PM1 stdout-only `Probes`
    column when a probe fires. `--positions` builds the shared `item-context.mjs` chain per lot — offers.json
    book, read-only watch-state + hold thesis, the shared `renderHeldVerdict`, and a read-only `pathsStage`
    `Paths` block — so it can't disagree with watch-positions.mjs; Proposal C (2026-07-12) adds the INFORM-ONLY
    stale declared-exit flag per held lot (`lib/staleexit.mjs` over a targeted TTL-cached 1h fetch —
    declared-exit lots only); behavior detail in CLAUDE.md "Script facts".
    (The PB4 pressure-exit trial was RETIRED 2026-08-30 — join-exit-ev.mjs's pre-registered
    criterion; the retired trial flag now errors loudly instead of silently running the neutral model —
    every spelling incl. `=value`, pinned across all three CLIs by `pipeline/test/retired-flag.test.mjs`.) RF4 (2026-07-25) appends an
    INFORM-ONLY "Reverse-flip pending" block after the held-lots table — the PURE `reverseFlipPositionLines`
    reads `reverse-flip-state.json` directly, reusing `fmt`/`fmtP` + the in-hand held rows (no new fetch);
    `[]` on an empty store → no section → byte-identical positions report), `screen-flip-niches.mjs`
    (opportunity screen; YP2 adds a stdout-only "WATCH CLOSELY" transition list; PM1 a stdout-only
    `Probes` column per flip-niche; P6c re-runs an empty flip-niche beneath the floor (`subFloorFallback` in
    `lib/gatecandidates.mjs`, honestly labeled + grade-capped + stdout-only, never in `screen.json`; the
    two-sided gate and thesis edge are never relaxed).
    (The PB4 pressure-exit trial + its pressure-net console rerank were RETIRED 2026-08-30 —
    join-exit-ev.mjs's criterion; the retired trial flag errors loudly, and `--publish` still refuses any
    non-neutral `--est-sell` model.)
    **`--archive-regime`** (AF5b, PLAN-ARCHIVE-FIRST-FUNNEL — opt-in, OFF by default) sources the 6h REGIME
    series (`regimeDrift`'s falling/rising gate + `phase()`'s trajectory shape) from the LOCAL SQLite
    archive via `lib/market/archive-series.mjs`'s `sixHourReader`/`archive6h` instead of a per-item
    `/timeseries` call — pinned to the last `LIVE_TS6H_BUCKETS`(365)×6h. All THREE 6h call sites (survivor
    pool, watchlist pool, reverse-flip pool) go through the ONE `read6h` seam, which with no archive handle
    is a pure pass-through to the same `fetchTsCached(id,'6h',TS_TTL_6H)` — so the default path is
    byte-identical (measured: a real `--mode all` pre/post diff is empty once the `~Nmin ago` wall clock is
    neutralised). Handle is opened `{ readonly: true }` (an unguarded `open()` runs schema DDL against a
    multi-GB live DB) and best-effort — an unavailable/locked archive degrades every read to live. PRICES
    are untouched (live) and **`--publish` is REFUSED** under it; the flag is ALSO stamped into
    `suggestions.jsonl`'s logged params as `archiveRegime:true`, because that ledger is TRACKED and pushed
    to main by the once-a-day `/overnight` publish and the `--publish` refusal does NOT cover it — without
    the marker an unpromoted-source run is indistinguishable from a live one in the F1 record forever
    (any F1/retro consumer must EXCLUDE flagged rows until AF6 promotes). Prints the archive/live split,
    the `shallow` count (series too short for `regimeDrift`, served live instead — see
    `REGIME_MIN_6H_BUCKETS`), the achieved bucket depth (the pin is a CEILING not a floor: while the archive
    is shallower than live — 285/365 buckets on 2026-08-07 — `phase()` is NOT live-equivalent), and the
    CORRECTED evidence line (same-span regime flips are real; see `archive-series.mjs`). The banner prints
    on EVERY exit path that renders an archive-sourced regime, including `--mode reverse`, which returns
    before `main()`'s header. Unpromoted — AF6 owns promotion),
    `watch-positions.mjs` (adaptive live position/offer monitor — the V1–V6 cross-pass memory surface: per-pass
    Δ/structural-support lines (`lib/watchstate.mjs`/`levels.mjs`, persisting `.cache/watch-state.json`),
    the V5 EMIT-CONTRACT note block (`lib/emit.mjs`), and the shared held-verdict + dominant-path lines
    (`renderHeldVerdict`/`pathsStage`, `lib/item-context.mjs`). DE3 (PLAN-DEPTH-EXIT, 2026-07-15): each
    held lot still computes the whole-day depth FLOOR (`clearableAsk`) + the pressure band
    (`reachableBand`) and shadow-logs them as the lean `depthExit`/`reachable` ledger fields
    (inform-only; `reachable` is bid/band-only since the retirement). The DE3 two-lens render clause
    (`depthReachClause`) and the PB4 pressure-exit held list-at trial were RETIRED 2026-08-30 with
    the pressure exit estimator — join-exit-ev.mjs's criterion; the retired trial flag errors loudly. RC-S1
    (PLAN-REACHABILITY-CONSOLIDATION, 2026-07-15): held rows ALSO co-log the two OLDER exit estimators —
    the reachRelief-family `estBuy`/`estSell`/`estConfidence` (`estimatePair`, `declaredExit` nulled so the
    scored number is the model's intrinsic ask) + the fixed-quantile `asym` pair — so the competing
    exit-price estimators ride ONE row for the F1 head-to-head against the realized sell (pressure's
    retired ask no longer among them); zero new fetch,
    inform-only. The ONE WRITER of the watch-state path fields
    and of `.guide-history.jsonl`; each pass appends the passive Tier-1 archive snapshot. Full output
    contract: `pipeline/MONITORING.md`),
    `monitor-offers.mjs`
    (live read-only log-state snapshot; ARCH-1 — its in-memory held book now applies coffer-manual.log
    REMOVE tombstones via `reconstruct.buildTombstonedEvents`, the same purge sync/positions.json honor,
    so a corrected/mobile lot never reappears as a phantom hold. Also applies the shared `lib/ignored.mjs`
    MERCH-book quarantine BY DEFAULT (2026-07-12) — held/offers/fills skip non-greenlisted ignored items
    (farming/loot/personal-use) so `/morning` no longer reads them back as phantom positions; `--all` shows
    the raw unfiltered log), `run-loop.mjs` (multi-action `/loop` driver — time-gated multiplexer that
    execs `watch-positions.mjs` (positions) and `screen-flip-niches.mjs --mode all` (scan) on independent cadences from one loop;
    scan is gated on `loadDerivedCash` `deployablePool` ≥ `--min-idle` (free cash + reclaimable deep-bid
    escrow — a small live fetch of the resting-bid ids classifies each bid deep-vs-committed); a **sync step rides with the watch pass
    by default** (2026-07-12 — `sync-fills.mjs --local`: rebuilds fills/positions/offers.json from the
    exchange logs so positions always reads a FRESH book, ZERO git like the watch-log daemon — the loop never
    pushes to `main`, so publishing stays the overnight flow's attended job and cron-firing the loop can't
    breach the no-unattended-writer invariant; `--no-sync` opts out); state in `.cache/loop-state.json`;
    prints a `next due:` footer naming each action's next-due LOCAL time + the earliest; pure driver, streams
    the sub-scripts' stdout, no fetch/writes of its own), `declare-thesis.mjs` (YT1 #4 — CLI to set/clear/list the SESSION
    THESIS per item, the sole writer of gitignored `.cache/session-thesis.json`; watch-positions.mjs reads it
    to print a per-held reminder. **P4a** — `set … --path <key> [--entered-under <key>]` ALSO declares
    the path-engine entry path into the TRACKED root `hold-thesis.json` via `holdthesis.upsertThesis`,
    preserving any existing plan fields; enteredUnder defaults to the path on first declaration.
    **VN-2** — with `--path`, a numeric `--tripwire`, `--exit <gp>` and `--window <h-h>` now ride the
    hold-thesis entry too (parseGp; omitted/unparseable flags preserve the existing values), making
    one command the full declared-plan writer the thesis render frame reads),
    `declare-owned.mjs` (RF0, PLAN-REVERSE-FLIP — CLI, the sole agent-writer of the TRACKED root
    `owned-items.json`: `seed "<item|id>" [--qty N]` (register pre-log ownership, defaults keep),
    `classify "<item|id>" flip|keep|consumable`, `list` (shows each item's live computed qty via
    `ownedledger.computeOwnedQty`). No per-item eligibility flag (Ruling 8 — `classification:'keep'` IS
    the candidate pool). `COFFER_OWNED_PATH`/`COFFER_FILLS_PATH` env overrides exist ONLY for the
    round-trip test; production hits the repo root),
    `declare-reverse-flip.mjs` (RF0, PLAN-REVERSE-FLIP — CLI mirroring declare-thesis.mjs, the sole
    agent-writer of the TRACKED root `reverse-flip-state.json`: `set "<item|id>" --state awaiting-rebuy
    --sold-each <gp> --qty N [--sold-ts <iso>]` (computes `beRebuy = soldEach − tax(soldEach)`),
    `advance "<item|id>" --state rebuy-armed --bid <gp>`, `clear`, `list`. `COFFER_REVERSE_FLIP_PATH`
    env override for tests only),
    `reconcile-reverse-flip.mjs` (RF3, PLAN-REVERSE-FLIP — the BANKED-backfill reconciliation ADVISORY,
    READ-ONLY: touches NO file, PRINTS a command, never runs it. `[<item|id>]` (bare = every declared
    reverse-flip item). When a declared `reverse-flip-state.json` item has a matching `positions.json`
    `unmatched` sell (the Case-B sold-first artifact — a sell with no prior buy), it prints the exact
    `add-manual-fill.mjs --type banked --price <basis> --time <iso>` command to inject the acquisition
    basis so the next sync produces a real `closed` row. `--price` = the owned-items `seedBasis`
    (acquisition cost, NOT the sell price); `--time` = the owned-items `seedTs` (ACQUISITION time, NOT
    the unmatched `sellTs` — FIFO needs the BANKED lot BEFORE the sell). Prints "nothing to reconcile"
    on no declaration / no matching unmatched sell — never a false positive.
    `COFFER_REVERSE_FLIP_PATH`/`COFFER_OWNED_PATH`/`COFFER_POSITIONS_PATH` env overrides for tests only.
    Fixture-pinned `pipeline/test/reconcile-reverse-flip.test.mjs`),
    `derive-cash.mjs` (CLI to DERIVE / re-anchor / clear the idle-cash balance: bare = the derived balance
    (anchor + Σ sells-after-tax − Σ buys − resting escrow, via `lib/derive-cash-tiers.mjs`); `<amount>` =
    re-anchor the `.capital-state.json` starting point — the total-capital denominator `watch-positions.mjs`'s
    SUMMARY reads),
    `read-window-range.mjs` (né `nightlows.mjs` — time-of-day
    range read / overnight fill-realism scoring; **`--window` accepts the literals `peak`/`dip`**
    (2026-07-26) resolved PER ITEM off that item's own `hourProfile`, so a peak/dip verification never
    depends on hand-transcribing hours — **`--window 0-23` is a legal 24-hour window, NOT a "no scoping"
    sentinel**, and scoring an exit against it while pitching a narrower window is what cost a real trade
    (CHANGELOG 2026-07-26); a full-day window self-labels `ALL-DAY`, an explicit `--window` that disagrees
    with `--profile`'s peak/dip prints a divergence warning, the volume-pool lines restate their own window,
    and the `--profile` DIP/PEAK lines carry an `↳ in-window:` read — that window's own level reach, the pool
    competing in those hours, and (with `--ask`/`--bid`) your level's in-window reach + signed gap to the
    window's own level; a scored `--bid`/`--ask`/`--exit` now reports its
    PERCENTILE PLACEMENT in the trailing daily-low/high distribution (AC4a — `js/windowread.mjs`
    `placement`, the price→percentile inverse of `quantLow`/`quantHigh`; n stated) BESIDE the reach
    count — purely descriptive, no "safe ≈ pXX" threshold (AC3's calibrated safe quantile did NOT ship,
    its gate failed; `PLAN-REACH-CALIBRATION.md` AC1); where the Tier-1 archive (`lib/archive.mjs`,
    read-only) has ≥3 covered window-days it adds a less-smoothed 5m-grain reach/placement ALONGSIDE
    (labeled, a LOWER BOUND per AC2), degrading cleanly to 1h-only otherwise. A scored/verify run
    (a `--bid`/`--ask`/`--exit`/`--depth` LEVEL — `--profile` alone does NOT, and the gate no longer
    claims it does) also prints a **`DAILY TRAJECTORY`** block — the per-day window low/high path already
    in the `--json` `days` array, plus, when `--profile` wasn't passed, a compact `diurnal:` line;
    HEURISTIC + inform-only (the shape label never gates), the console-only fix for the trajectory
    being read-past in favour of just the reach/placement fields. The `read:` synthesis is the SHARED
    `js/windowread.mjs` `trajectoryRead(days,{liveRef})` helper (2026-07-21) — `quote-items.mjs`
    renders the SAME `DAILY TRAJECTORY` block on every quote AND `--positions` held lot (zero new fetch —
    `days` already in hand). The `⌁ read:` note it used to carry alongside was retired by R6 at both emitters. `--json` (AO2) dumps the
    assembled per-item result objects to stdout (the `analyze-record`/`analyze-fill-placement`
    `--json`→stdout convention, NOT `writeLastReport` — this command builds no render.mjs sections);
    default markdown stdout is byte-identical when absent (the `DAILY TRAJECTORY`/`read:`/`diurnal:`
    lines are console-only — `--json` output is unchanged). `--profile` = the hour-of-day diurnal dip/peak read
    + derived stale-guarded bid/ask; `--depth <qty>` = the PLAN-DEPTH-EXIT DE2 percentile-depth inspector —
    the `clearableAsk` "BOOK AT ≤ X" (the highest ask the lot clears on ≥targetFrac of days), with the
    collapse REASON surfaced on a thin book — inform-only, reads `js/windowread.mjs` `clearableAsk`. _(The
    per-day `depthDays` flow tables + the low-side `clearableBid` "CATCH AT ≥X" were REMOVED 2026-07-22,
    PLAN-REMOVE-DEPTH-PRESSURE-READS — git-revivable.)_ `--pressure` = the
    PB2 demand-balance read: `pressure` (medVolHi/medVolLo) + regime label + `reachableBid`/`reachableAsk`
    (`base ± band·φ` inline) + reliability, off `demandPressure`/`reachableBand`, inform-only n≈0. _(The DC2
    per-hour demand cycle + SELL/BUY window block (`demandRegime`) was REMOVED 2026-07-22, same removal.)_
    PLAN-ESTIMATOR-POSTURE AC8: a scored
    `--bid`/`--ask`/`--exit` now also prints a **`fold:` data-point line** — the SHARED `estimatePair`
    reach-fold on the in-hand data (`best-case X → reach-folded Y · net at folded pair`), zero new fetch,
    inform-only; `--niche band|churn|scalp` (default band) picks the spec (churn inherits the AC5/AC6
    fold exemption); it rides `--json`/`--out` as `result.fold`. `--trajectory` (R1, PLAN-SIGNAL-RECENCY)
    = the recency-weighted FORWARD read: the full-day per-day low/high table + the shared floor/ceiling
    slope-asymmetry classification + a **forward-projected next-day low/high band** (`js/windowread.mjs`
    `projectTrajectory`, the ONE trend primitive `floorCeilingTrack` is now a two-call wrapper over) —
    its own block, requestable alone, inform-only n≈0, rides `--json` as `result.trajectory`). `--hourly
    [--days N]` (PLAN-DIURNAL-HOURLY) = the RAW per-LOCAL-hour LOW/MID/HIGH grid: a 7d-avg (median L/M/H)
    block + the last N dates (default 3, most-recent-first) broken out individually, off the pure
    `pipeline/lib/market/hourly-lmh.mjs` `hourlyLMH(series1h,{days})` helper — the hour-by-hour detail the dip/peak
    summary distills away (reuses the same 1h series, NO second fetch; its own block, requestable alone;
    inform-only n≈0, rides `--json` as `result.hourly`); the grid ALSO carries a summary line off the
    sibling `askReachDecay(series1h,{days,ask})` export (PLAN-DIURNAL-TRIAGE DT3) — for a candidate ask,
    the per-day RATE of hours whose HIGH reached it and whether that rate is sliding (the Ghrazi rapier
    catch: graded fill-now while the ask had stopped clearing intraday). Rendered via the shared
    `js/windowread.mjs` `askReachDecayNote(decay,{ask,fmt})` (one owner with
    quote-items.mjs/screen-flip-niches.mjs), and ONLY when it fires. Consumers: `read-window-range.mjs
    --hourly` (the summary line; rides `--json` as `result.hourly.askDecay`), `quote-items.mjs` (an
    `askReachDecay` note on a bare ask/bid quote and on held/watched positions),
    `screen-flip-niches.mjs`'s `--digest` (a bounded top-X enrichment pass; never gates/drops a row and no
    longer alters any verdict), and `watch-positions.mjs` (inside the big-ticket/watchlist `reachRead` line). **DELETED 2026-08-09 (DT3): the per-hour `Δ/d` column, the `hourlyDrift`
    slope export + its uniform/split synthesis, its shared note renderer, and the digest's
    `⚠ falling — verify (~X/d)` relabel** — measured 49.7% direction, beat predict-no-change on 6 of 380
    items. INFORM-ONLY, n≈0; fixture-tested in `pipeline/test/hourly-lmh.test.mjs` (incl. a stays-deleted
    pin on the slope)),
    `js/windowread.mjs` `liveAgeTag(ageMin,{freshMin})` (2026-08-09) — the age suffix on the
    ALWAYS-printed `live instasell/instabuy now` line: `(<1m ago)` / `(Nm ago)` when fresh, escalating to
    the UNCHANGED `⚠ Nm old` past the caller-supplied bar, with `(age n/a)` for an UNKNOWN age (null,
    non-finite, or negative — never silently rendered as fresh). The threshold is a PARAMETER,
    not an import, so the helper stays a pure leaf (`js/windowread.mjs` imports only `money-math`) — a
    test pins the default against `QUICK_FRESH_MIN` so the two cannot drift. `lowTime`/`highTime` are
    TRADE timestamps from `/latest`, so a price that stays the same while its age grows PROVES no trade
    printed rather than a stale read — which is the ambiguity the silent-when-fresh predecessor created
    and that produced a wrong bug diagnosis. (For the record: `/latest` on this path is UNCACHED —
    `cachedJget` passes straight through unless `COFFER_FETCH_CACHE=1`, which nothing sets, so
    `FETCH_TTL.latest` is declared but inert.) THREE render call sites, all converted: `read-window-range.mjs`
    (also now its ONE age helper — it carried a second byte-identical copy), `quote-items.mjs` (the
    windowExit live-instabuy clause) and `read-book.mjs` (`ageLabel` on every P&L mark). Deliberately NOT
    converted, and why: `watch-positions.mjs`'s held-lot `staleLive` clause AND `quote-items.mjs`'s
    `staleLiveNote` both hand-roll the same `Math.round(age)m old` render, but each lives in a STALE-ONLY
    branch (`quickStale.sell` implies a non-null age), so neither is ever silently-fresh — not this defect
    class — and converting them would change their wording. (An earlier version of this entry named only
    the first of the two while claiming to enumerate them.) Genuinely
    unlabelled, and named here rather than implied: `read-book.mjs`'s SIZER `net if cycled once (sell …)`
    mark and `book-model.mjs`'s reverse-flip `liveTxt` — both inform-only, both off the P&L board.
    Pinned by `windowread.test.mjs`,
    including a negative-age case, a guard that the DISPLAYED minute never contradicts the fresh/stale
    verdict it carries, and a drift guard tying `LIVE_FRESH_MIN_FALLBACK` to `QUICK_FRESH_MIN`.
    `read-trajectory.mjs` (R1 — a thin one-word PRESET that re-execs `read-window-range.mjs --trajectory`
    with all flags forwarded, so the fetch/bucketing plumbing keeps ONE home; answers "how's `<item>`
    trending / where's it likely to be tomorrow"), `limits.mjs` (LM1 — the buy-limit read:
    `node pipeline/commands/read-buy-limits.mjs "<item>" [...]` prints limit / bought-this-4h-window / remaining /
    local `next frees ~HH:MM` · `fully resets ~HH:MM` off `fills.json` + the mapping, NO market fetch;
    no-args reports every item with a logged buy in the last 4h. Window math in `lib/limits.mjs`),
    `read-book.mjs` (PLAN-DASHBOARD — the `/book` capital & book dashboard: `node
    pipeline/commands/read-book.mjs` renders (1) GE slots + the working/parked/idle capital split and
    (2) a grouped per-lot P&L board (cost basis / live mark / unreal P&L / % to break-even / capital
    tied / days held); `--size "<item>" [--capital <gp>]` adds (5) the tranche sizer = min(buy-limit,
    clearability, capital) with the BINDING bound + net-if-cycled, capital defaulting to this run's own
    `deployablePool`. IMPURE SHELL: one per-invocation `fetchItemInputs` per id in the held∪bid∪{sizer}
    union feeds the age-labelled marks + `loadDerivedCash` marketRef; ALL aggregation is the PURE
    `lib/book-model.mjs`. Inform-only, no gates; live marks age-labelled (decision 3), free-slot count a
    log-derived UPPER bound — occupancy is the lower one, so read it as "at most N free" (decision 4). RF4 (2026-07-25) adds a "Reverse-flip pending" section — loads
    `reverse-flip-state.json` and renders `book-model.mjs`'s PURE `buildReverseFlipPending` (awaiting-rebuy/
    rebuy-armed cycles with sold price / BE-rebuy / live / days-pending + notes), reusing the SAME in-hand
    quote rows (no new fetch); an empty store renders NOTHING extra — byte-identical to the pre-RF4 read),
    `read-schedule.mjs` (PLAN-SCHEDULE — the buy/sell WINDOW AGENDA: a presentation/aggregation layer over
    the SAME `hourProfile` dip/peak `read-window-range.mjs --profile` prints, consolidated into ONE
    time-sorted table `In (h) | Window | Item | Action | Level | List`, sorted by `In (h)` ascending
    (hours to the window's next start, nearest 0.5h; `now` when inside). Each item emits up to 4 rows —
    BUY(dip)+SELL(peak), EACH up to 2: the primary window plus a prominence-ranked SECONDARY off
    `hourProfile`'s additive `dips[]`/`peaks[]` arrays, the secondary's Action marked `·2` (PLAN-MULTI-PEAK-WINDOWS;
    a length-1 array never manufactures a `·2` row). **The Level column routes through `deriveDiurnalRange`
    (2026-08-10) — the ONE home for the dip-not-below-live guard — and fetches a live `/latest` leg per item
    to feed it; marks `↧` repriced-to-live, `⚠` degenerate pair (peak level not above dip level), `?` no live
    price so the guard could not run. It previously printed the RAW `hourProfile` level and was the only
    consumer bypassing that guard, which shipped a buy-high/sell-low agenda on 7.3% of items.** Three MUTUALLY-EXCLUSIVE modes:
    `-c`/`--current-position` (DEFAULT) = the actionable set, open lots in `positions.json` ∪ open offers
    in `offers.json` (`readOpenPositions`+`readOffersSnapshot`); `-w`/`--watchlist` = `watchlist.json`
    names OR bare ids via `loadMapping` (`-c`+`-w` UNION, rows tagged C/W); `--audit` = flipped-but-not-watchlisted
    review off `positions.json` `closed` (trade count + realised P/L, NO market fetch, review-only — never
    edits `watchlist.json`); its "already watchlisted" join is **ID-keyed** off `loadWatchlistEntries` —
    a name join silently proposed re-adding every watched item as soon as the app rewrote the file as ids. Per-item `fetchTs('1h')`+`hourProfile` pooled at `FETCH_CONCURRENCY=5`,
    served by the 15-min disk cache; INFORM-ONLY n≈0 (PLANS, never gates). Pure `hoursUntil`/`isInsideWindow`/
    `agendaRowsForItem`/`buildAudit` helpers are fixture-tested (`pipeline/test/schedule.test.mjs`); its
    `buildAgenda`+`loopHeaderLine` are imported in-process by `run-loop.mjs` for the `⏭ next:` banner.
    RF4 (2026-07-25) adds the PURE `reverseFlipRows(state, {profileByItem,now})` builder,
    unioned into the agenda when `reverse-flip-state.json` is non-empty: one `RF`-tagged row per declared
    in-flight cycle (`SELL peak`/`REBUY dip`/`REBUY armed`), windowed on the ALREADY-fetched `hourProfile`
    (a null-window RF row sorts last), carrying the shared cycle notes (the REBUY_STALE_DAYS nudge; the thin-strand caution is NOT emitted here — see the explicit `row: null` in read-schedule.mjs +
    `REBUY_STALE_DAYS` nudge) below the table. (DT3, 2026-08-09: the `driftByItem` param and its
    hourly-drift note are GONE — this surface never had an ask level, so the surviving ask-reach decay read
    has nothing to score here.) Zero new fetch; an empty store adds ZERO rows — the
    agenda is byte-identical (`pipeline/test/reverseflip-surfacing.test.mjs`). Reads
    `positions.json`/`offers.json`/`watchlist.json`/`reverse-flip-state.json`; produces NO new tracked file),
    `read-watchlist.mjs` (SEP16b, PLAN-PIPELINE-SEPARATION — the watchlist's OWN surface, answering
    "how are the things I track doing?" rather than the scan's "what should I buy?". Renders the same
    `Item | Grade | Guide | Quick | Optimistic | Vol/d | Momentum | Regime | Rank net·P/ttf | Note`
    table the scan's WATCHLIST section prints, from the ONE shared row builder
    `lib/signal/watchlist-report.mjs`. **The TABLE LINES were byte-identical** to the in-scan
    section on the same inputs when measured, grade column included (the Decision-2 tripwire) — but
    that was one manual byte-diff, and NO standing test reproduces it. What IS enforced is narrower:
    `watchlist-report.test.mjs` pins this surface's column sequence and pins that the scan binds its
    headers to the same shared constant. Neither compares rendered output. Do not treat the two
    surfaces as provably identical; the surrounding
    SECTION is not, and deliberately so — `renderReport`'s `table` carries a leading blank line where
    the scan's raw `console.log` pair did not. Quiet by default per AO1 (`--verbose` for the table,
    `--json` for the structured read); `writeLastReport('watchlist', …)` fires on EVERY path —
    `--json` and the empty-watchlist case included, the latter writing a headline-only report so an
    emptied watchlist cannot leave the previous run's rows sitting in the dump. Note the two shapes: the dump is
    the fleet-standard `{kind, generatedAt, reports:[…]}`, while `--json` is the flatter
    `{kind, tracked, headers, rows}`. Builds its own context (`loadMapping`/`loadAllLatest`/
    `loadGuide`/`loadAll24hRolling`/`loadBands`) and pools per-item 5m+6h fetches at
    `FETCH_CONCURRENCY=5` — runtime is dominated by that per-item
    pool, so it is bimodal on `TS_TTL_5M`, NOT on how long ago you last ran it: **inside** the TTL the
    context loads are all that remain and it returns in a fraction of a second; **outside** it, all
    tracked items refetch 5m+6h and it takes several seconds. The slow case is the NORMAL one for a
    real ask — the TTL is minutes, so any gap between two questions clears it. Measure if it matters;
    do not quote a figure from here. Flags: `--verbose`, `--json`, `--band-hours`, `--floor`,
    `--gp-floor`, `--min-gpd`. (A `--posture` flag was documented here and REMOVED — it was inert:
    posture reaches `suggestionEntry` only, and this command discards those entries, so all three
    values produced byte-identical output. It is now the literal `'active'` at the one call.) **Two KNOWN context divergences from the scan, named in the file header:** no
    `--archive-regime` seam (6h is always live, so Regime would differ under that flag) and no
    `--vol-source`/`pipeline-config.json` resolution (always `rolling`) — latent while no config file
    exists, and moot once SEP16c removes the scan's own pass. Every row carries `(thin)` because
    `estimateRank` is called with no `extra` — reproduced deliberately from the in-scan path
    (Decision 2 Option 1), since wiring it is a fetch-budget change (SEP16e) needing its own ruling.
    **Writes NOTHING to `suggestions.jsonl`** — an explicit read must not move the retro's population;
    it discards the `sugg` entries the shared builder returns. Absent/empty/garbled `watchlist.json`
    degrades to a one-line message and exit 0, never an error, and under `--json` the shared reader's
    malformed-entry banner is diverted to stderr so stdout stays parseable),
    `trigger-alerts.mjs` (N1 push-notification trigger
    engine — behind the standard `import.meta.url === pathToFileURL(argv[1])` invocation guard
    (TD2) so importing it for tests never runs/fetches; exports `positionSignal`/`quietSuppresses`),
    `join-outcomes.mjs` (derived campaign/outcomes join — gitignored output; **schema v3 (2026-08-11)** makes
    `liqClass` POINT-IN-TIME-preferring via `suggestlog.mjs`'s `liquidityAtPlacement` — the logged `volDay`
    scalar, else the logged `class` (vocabulary-gated: `watch-positions.mjs` logs a different taxonomy into
    the same field), else a present-day recompute — and adds `liqBasis` / `liqClassCurrent` /
    `volDayAtPlacement` so the basis is auditable and F1 can segment on it. Bucketing a historical fill by
    TODAY's liquidity was putting thin-at-placement items in the `liquid` column; correcting it surfaced a
    `thin` column that had been all but empty (2 rows → 26). schema v2 (YS1) adds per-campaign
    `stateAtFill` (band-pctl+regime+phase AS OF the fill via `lib/range-position.mjs`, for EVERY fill),
    measured `holdTimeSec`/`parkedSec`/`velocityClass`, and `predicted` (copied from the joined
    suggestion, null on pre-YS2 rows); reconstruction routes through `dedupeSnapshots`. COD-3: `--report`
    stamps `.cache/last-weekly-report` and the cheap standalone `--weekly-due` prints `weekly-due: yes|no`
    off the local Mon–Sun week so `/morning`'s weekly-read cadence is mechanical, not "ask Ben". `--report`
    prints the F1-gate progress line (general calibration), a static pointer to `join-reach-outcomes.mjs`
    (the **Reachability head-to-head** accrual was DELETED — that scorer needs no closed round-trip, so the
    count gated nothing; `joinSuggestion`'s `coLog` marker is still written but now has no reader),
    and the **Ring-3 rank-denoise** accrual (`PLAN-ESTIMATOR-HONEST-SELL`) — closed round-trips filtered by
    the FORWARD-exit co-log (`joinSuggestion`'s `fwdLog` marker = `estConfidence.forwardPeak`), the gate that
    tracks when the forward-vs-reach-fold head-to-head (`aggregateForwardExit`) becomes scorable, the
    evidence Ring-3's promotion of the forward exit into `estimateRank`/`screen.json` is deferred on),
    `join-amplitude-outcomes.mjs` (PLAN-AMPLITUDE-SCAN A5 — the amplitude lane's SHADOW BOTH-LEG REPLAY,
    read-only: for every `mode:'amplitude'` pick logged to `suggestions.jsonl` (the `amplitude` shadow
    block — printed trough-bid/peak-ask + hold horizon), replays against the NEXT `holdDays` of the
    per-item 1h SQLite archive (`lib/archive.mjs` `seriesFor`) and reports the would-have-fill rate as an
    UPPER BOUND (a printed level ≠ your fill; daily buckets can't order intra-day). The cheap n-rich
    falsifier for the §4 make-or-break question; the realized truth is `retrojoin.mjs`→`/analyze`. Pure
    core `replayAmplitudePick`/`dayBuckets` fixture-pinned `pipeline/test/join-amplitude.test.mjs`; `--json`
    dumps the per-pick array),
    **`join-depth-outcomes.mjs`** (2026-08-11 — the DEPTH model's missing OUTCOME half. Scores
    `clearableAsk` (`js/windowread.mjs`, the DE3 `depthExit` shadow) against REALIZED sells, because its
    `DEPTH_COMPETITION_MULT` ×4 is an explicit n≈0 PLACEHOLDER that had never been checked against a fill.
    PRODUCER: `positions.json` `closed` rows, excluding `withdrawn` personal-use tombstones and `banked`
    declared-basis rows. **THE HEADLINE IS NEGATIVE, AND IT IS ABOUT THE MODEL, NOT THE SCRIPT:** measured
    over 277 sell episodes / 77 items, `clearableAsk` is **not distinguishable from the trivial null model**
    "use the window's MEDIAN hourly high" (median residual +0.81% vs +0.83%), it sits at the ~52nd
    percentile of the window's hourly highs so it is a CENTRAL estimate rather than the "conservative floor"
    its own header claims, and sweeping `--competition` 0.5→16 moves the median 0.20pp. **The residual is
    TREND-DOMINATED** (corr ≈0.61 with 14d drift; −0.19% falling / +0.00% flat / +3.39% rising) because
    `clearableAsk` averages complete days ending at the previous midnight and that window LAGS a trending
    item — so the report always stratifies by trend and reads size only WITHIN the flat arm, where the
    item-CLUSTER bootstrap CI straddles zero and it says so instead of printing a gradient.
    **RECOMPUTES the prediction per episode from the 1h archive rather than reading the logged
    `depthExit`** — joining the full ledger (active file + `suggestions-archive/` via `readSuggestionLines`:
    199 rows / 26 items) covers only ~60 of 392 lots, so ~85% of the evidence would be discarded. Note the
    log's sparseness is NOT merely "few held lots": `quote-items.mjs --positions` computes the depth read
    and never passes `depthExit` to `suggestionEntry` (0 of 81 held rows carry it), and on a default run it
    is not even computed — see PLAN.md Discovered. Rows are FIFO fragments, so they are aggregated into
    same-hour **sell EPISODES** (qty summed, price quantity-weighted) — without that a 39-unit sell split
    into 16 rows scores as sixteen ~2-unit lots, corrupting the size axis specifically. `sizeFrac` divides
    by the **LIMITING side** `min(hpv,lpv)`, matching `js/quotecore.js`'s `volDay` and `reachRelief`'s
    `sizeRatio`; v1 summed both sides (median 2.24× off), which emptied the >2% buckets and reversed the
    apparent direction. **NO LOOK-AHEAD**: series truncated to `ts < sellTs`, `now` pinned to the sell
    moment, and the volDay/drift/null windows cut at the sell day's local midnight to match the model's own
    complete-day boundary. `pipeline/test/joindepth.test.mjs` is MUTATION-VERIFIED (six deliberate breakages
    each watched to fail) — v1's look-ahead test was vacuous, passing with the truncation deleted entirely;
    the `now` pin remains uncovered by unit test for a reason documented there. `--json` (per-episode array,
    returns before any table), `--item <name|id>` (adds a per-episode table), `--competition N`, `--nights N`.
    Pure core `scoreDepthLot`/`sellEpisodes`/`bucketBy`/`clusterBootstrapCI`/`readClosedLots` fixture-pinned),
    **`pipeline/lib/signal/digest.mjs`** (2026-08-25, PLAN-PIPELINE-SEPARATION) — the digest's ask-reach
    INTERPRETATION, extracted from `screen-flip-niches.mjs`: which basis the reach column reads
    (`digestReachFrac` → the one shared `reachFraction` on the recent-3 basis), the stale-live-print guard
    that recomputes reach/placement/cushion-trend against the fresher instasell before any of them are
    scored (`digestReachAndPlacement`), and the `MIRAGE_REACH_FRAC` threshold. **Why it exists as a module:**
    the threshold was a bare module-private `const` inside a 3,000-line command, so nothing could import it —
    and `join-reach-basis.mjs`, the script written to SCORE that very threshold, had to keep a hand-copied
    duplicate with a comment warning the copy would not track the source. That comment's line reference had
    itself gone stale. The scorer now imports it; verified by changing the value at the source and watching
    the scorer follow. **A byte-identical move** — the extraction changed no logic, and the falsifier was two
    back-to-back screen runs across the change with zero structural stdout diff (a later comparison showed
    472 diff lines, which reproduces identically between two runs of the SAME code twenty minutes apart:
    that is market drift, not regression — check the drift baseline before reading a diff as a defect).
    **`digestVerdict` and `capEfficiency` deliberately did NOT move**: both reach into command-local helpers
    (`weakDeploy` → `isBigTicket`, `gradeAtLeast`, `holdDays`), so moving them now would drag those along or
    create an import cycle, and `isBigTicket` is itself slated for replacement by two explicitly-named
    predicates. They follow once that lands.

    **`join-asym-outcomes.mjs`** (2026-08-24, PLAN-PATIENT-PAIR §7 — replaces the asym pair's
    READ-BACK QUANTILE CONSTANTS with forward-measured rates. PRODUCER: `asymShadow` on
    `suggestions.jsonl` + the monthly archives via `readSuggestionLines()`; forward-scored against the
    1h `pipeline/.market-archive.sqlite`. Asks the two-leg question the display implies but never
    measured: was the deep bid actually TOUCHED, and if so was the high ask REACHED within H hours?
    **The measured pair is nothing like the displayed one.** Over the pool `ASYM_MEASURED_ROWS`/
    `ASYM_MEASURED_ITEMS` record (`emit.mjs` — read them there, they accrue) at the locked
    decisive spec (entry ≤24h, exit ≤24h from the touch): entry **17.8%** against a logged `pBid` of
    31.1%, exit-given-entry **24.2%** against a logged `pAsk` of **86.8%**, and a **4.3% round trip**.
    The logged numbers are the `ASYM_P_LO`/`ASYM_P_HI` quantiles read back out (PLAN §2b), so this is
    the size of the fiction, NOT a model comparison — do not report it as "the estimator was 62pp
    optimistic". **DT1 GENERALISES, and hardest exactly where the anchor lived**: big-ticket rows
    (ask ≥ `BIG_TICKET_GP`) enter MORE often (23.1%) but convert far less (**6.4%** exit-given-entry,
    1.5% round trip) than sub-big-ticket (28.6% / 4.8%) — DT1's own figure was 4.8% at 24h. So the
    Webweaver move reads as a good OUTCOME from a bad-odds setup, which is the answer PLAN §7 said
    nobody had. Round trip rises with the horizon but never far: 6.3% at 48h, 9.0% at 96h, 10.8% at 7d.
    **A REJECTED ESTIMATOR is recorded in the header and matters more than any shipped number**: the
    first design scored a random-offset matched null and measured −36.0pp "adverse selection", which was
    an artifact of the STARTING PRICE — the null arm begins at 99.8% of the row's ask level, the
    conditional arm at 93.8%. The shipped contrast is time-matched instead (round trip vs ask-reached-
    anywhere-in-W over the identical window), and `hit ⊆ askOnly` by construction makes it a
    DECOMPOSITION, not a horse race. HONESTY: touched/reached ≠ filled — no queue position, no partials,
    no competition at the level, so every absolute rate bounds a real offer from ABOVE; one era, one
    update cycle, band-dominated; CIs resample ITEMS. **GATES NOTHING** — threshold work belongs to F1.
    `--entry`/`--horizon`/`--item`/`--json`.)

    **`join-reach-outcomes.mjs`** (2026-08-27, PLAN-REACHABILITY-CONSOLIDATION — the RC head-to-head,
    forward-scored. The tool carries FIVE overlapping ways to price an exit (reach-fold · reachRelief ·
    asym · depth · pressure); RC-S1/RC-S2 co-log them RAGGEDLY — see the Coverage table the command
    prints — and nothing had ever read that
    log. PRODUCER: the `reachable`/`estSell`/`asym`/`depthExit` co-logs on `suggestions.jsonl` + the
    monthly archives via `readSuggestionLines()`; forward-scored against the 1h
    `pipeline/.market-archive.sqlite` through `js/forward-reach.mjs`. Per estimator, per
    (side × class × regime) cell: was that ask REACHED within the horizon, and how far above it did the
    market go. **The target is the ARCHIVE, and that is the load-bearing design decision** — the plan
    specified scoring against the realized sell, which is CIRCULAR here: a GE sell executes AT the ask you
    typed, and you type the tool's suggestion, so scoring against it measures the tool agreeing with
    itself. The header of
    `pipeline/lib/render/reachability.mjs` is the ONE home for that reasoning; don't re-derive it.
    **⚠ THE METRIC CANNOT RANK EXIT ESTIMATORS, and no conclusion here may be read as if it did.**
    `reached` and `headroomPct` are the SAME PER-ROW comparison (`reached ⟺ gap ≥ 0`, derived at
    `reachability.mjs:52`), and both are monotone in the ask price, so the REACH ordering is a
    PRICE-LEVEL ordering: `quickSell*`, the declared null, maximises the reach column in every MATCHED
    pool. But the two REPORTED columns are different functionals of that one quantity — a RATE and a
    MEDIAN — so they can and do rank differently: `depth` sits above `quickSell*` on gap in the
    depth-matched pool at every horizon tested. Neither ordering is a quality ordering.
    Read literally this surface says "always instasell", which nobody believes: an
    ask that misses costs a RE-LIST, not the trade, and nothing here expresses that cost. The sibling
    `join-reach-basis.mjs` already solved this exact problem (`mcnemarCost`, a cost ratio `r`, a
    four-regime map, `rStar`); until that is ported, this command DESCRIBES reach and gap and ranks nothing.
    **It does refute the consolidation's premise, but not by ranking.** Pressure prices consistently
    higher than the incumbents, so on a SHORT horizon its ask sits above the window top while the
    incumbents sit near zero — the opposite of what RC1 ("retire reachRelief in favour of pressure") and
    RC2 ("merge asym into the pressure band") assumed. **That finding is HORIZON-CONDITIONAL, and the
    default horizon is the adversarial one for pressure's own class:** on one matched pool pressure's gap
    is NEGATIVE at H=6, still negative at H=24, and turns slightly POSITIVE at H=96 — where it is the
    CLOSEST of all five to zero. Run `--horizon 6/24/96` and read the sign flip; don't quote a digit here. H=24 is the premise DT1 measured and retired for big-ticket, and
    pressure is the big-ticket estimator. Quote the horizon with any claim off this surface, and never
    the phrase "prices past the market" unqualified.
    **Compare on the gap column, never the conditional headroom** — headroom conditions on reaching, which selects
    high-topping rows and flatters a rarely-reaching estimator. Read the MATCHED tables, never the pooled ones: coverage is ragged (depth needs
    a held qty; reachFold/reachRelief are disjoint by construction) so the pooled per-estimator marginals
    are computed over DIFFERENT row sets. HONESTY: reached ≠ filled — no queue position — so every rate
    bounds a real offer from ABOVE; n counts READS, not trades, and the screen re-prices the same item
    many times a day, so rows are heavily item-day clustered and effective n is far below nominal; the
    ASK leg only, so a bid-side claim is not in evidence; `quickSell*` is the live market print (the true
    null) but `optSell*` is the tool's OWN band edge, so beating it beats a sibling. **GATES NOTHING.**
    `--horizon`/`--min-n`/`--item`/`--json`.)

    **`read-exit-surface.mjs`** (PLAN-REACH-SURFACE chunk 3 — the first surface that ships a PRICE off
    `js/reach-surface.mjs` + `js/exit-ev.mjs`. Reads the 1h series from
    `pipeline/.market-archive.sqlite` (the API's ~15-day `/timeseries` cannot fill a 14-night reference
    window plus a replay), one `/latest`+`/5m`+`/6h` fetch per item for the live quote, and prints, per
    item: the p(z,H) grid with levels in gp and a **ΔEV column** against the argmax so the plateau is
    auditable cell by cell; `askStar` at each `--horizon` **as a BAND**, never a point; the incumbent
    exit estimators placed on that same surface as (ask, z, p@H) rows; the flavor line; and the guards.
    **It answers two different questions and never blends them** — `askStar` is the PRICE and
    `horizonForAsk` (`--price`) is the HORIZON read. `askForHorizon`'s p≥pTarget level is deliberately
    NOT offered as an ask: PLAN-REACH-SURFACE §1c measured it as the worst pricing rule tried at short
    horizons. **The load-bearing output nobody expected is the delay-cost crossover.** On some items
    the argmax lands on a cell that reaches only a few percent of the time, so each priced horizon
    also reports the smallest `delayCost` at which its own answer changes, the answer it changes to,
    and that cost as a share of the reference price. It is SOLVED, not searched: EV is linear in
    `delayCost` per cell with slope −(1−p), so the crossing has a closed form, and the test asserts it
    is self-consistent (the argmax has moved just above it and has not just below). An argmax under
    `P_STAR_FLOOR` is FLAGGED rather than printed bare. **TWO different forces push that argmax up and
    the report refuses to conflate them** — a first draft asserted one of them and was wrong on the
    very item it was written from: (a) `--delay-cost 0` makes a miss cost little more than the bail,
    and (b) the per-cell miss payoff RISES with the ask, crediting a high ask with a better
    consolation prize (chunk 1's `bailZOnMiss`; chunk 2 measured per-cell pricing at or ABOVE the
    unconditional form). Swapping (b) for the unconditional bail while holding (a) fixed separates
    them, and `bailDrivenDrift` runs exactly that swap PER ITEM and prints which one is doing the
    work — measured on the row, never asserted in prose. The `fold` row is a **RECONSTRUCTION** and says so on the row — the deployed estimator also
    sees diurnal/asym/dayHigh/placement and an anchor nudge this surface does not build, the same
    divergence `read-window-range.mjs`'s fold block already documents. **REFUSALS CARRY NO PRICE, at
    BOTH levels** — an item whose archive holds under `MIN_COVERED_DAYS` days with a high print
    refuses whole, and a single horizon whose argmax lands on the grid top nulls its own ask/z/p/band
    so `--json` and the dump cannot serve a number the row's own text disowns (they did, on every
    grid-top row, until review measured it). Note the floor reads REAL archive coverage, NOT
    `surface.coveredDays` — that field is pinned to `nights`, so a floor against it is a tautology
    that fires zero times at the default and refuses every item below it. `--json` emits the report
    objects and nothing else. **The guards are reached, not decorative, but the RATE is not a fixed
    number** — two independent sweeps disagreed by roughly 2x on every rate because the archive moves
    under the measurement, so the durable claim is the SHAPE (a material minority), never digits
    (full story: the folded plan, `git show bdea911:plans/PLAN-REACH-SURFACE.md` §5 chunk 3). **INFORM-ONLY: gates nothing, prices no offer, writes only
    `pipeline/.cache/last-report/exit-surface.json`.** `MIN_COVERED_DAYS`/`PLATEAU_TOL_FRAC`/
    `P_STAR_FLOOR`/`delayCost`/`pTarget` are all PLACEHOLDER and printed beside the numbers they moved.
    Chunk 4's `join-exit-ev.mjs` HAS now scored it, and the answer was NO — read that entry before
    quoting this one; what survives here is the description, not a pricing recommendation. `--horizon`/`--price`/`--qty`/`--delay-cost`/`--p-target`/`--nights`/`--json`.)

    **`join-exit-ev.mjs`** (PLAN-REACH-SURFACE chunk 4 — the decisive backtest, and **the
    pre-registered NULL BRANCH FIRED: `askStar` does not beat the best incumbent, so the reach surface
    ships as a DESCRIPTION layer, chunk 5's default `sellModel` swap is CANCELLED, and the plan's
    headline claim is downgraded.** Read that before quoting anything else here.
    **What it scores is a POLICY, not a prediction**: at each origin, list at the contender's ask for H
    hours; if the 1h archive reaches it, credit `net(ask)`; else bail at the window's last instasell,
    less the cost of having waited. That metric is NOT monotone in the ask — raising it raises the
    payoff and lowers the odds of collecting it — which is exactly what `join-reach-outcomes.mjs`
    could not do, and why that command DESCRIBES where each estimator prices while this one ranks.
    Every contender is priced at EVERY origin, so the pool is matched by construction rather than by
    whatever the deployed surfaces happened to co-log.
    **THE TOP OF THE TABLE IS TWO INCUMBENTS, AND THEY ARE TIED.** `asym` (the ordering-guarded
    quantile ask `max(quickSell, the 14-day ask quantile)` — `asymEstimate`'s deployed level) leads
    the pooled table on both arms, in both era halves, under both bail conventions, on independent
    (non-overlapping) windows and at every horizon on the deployable arm. But its margin over
    `reachFold`, today's default sell model, has a cluster CI that STRADDLES ZERO, so nothing here
    separates them and no claim should. What IS separated is where the surface lands: `askStar`'s
    deficit against the leader has a CI clear of zero with the same sign across the sensitivity
    horizons and both era halves, and the deployable `askStar+fold` sits below BOTH incumbents. A
    per-ITEM sign test — no bootstrap, no distributional assumption — puts it behind `asym` on three
    items in four, and behind `reachFold` too. Against `quickSell*`, the live instabuy, that same test
    is a COIN FLIP: the surface is NO BETTER than the trivial null, which is a weaker claim than "worse
    than it" and is the one the evidence carries. That is the pre-registered criterion, run in the
    direction nobody wanted.
    **TWO ARMS, because bare `askStar` gates its own pool.** It refuses a large minority of origins
    (thin cells and grid-top optima), so the estimator arm is CONDITIONED on it consenting to price.
    The report scores the deployable policy separately — `askStar+fold`, the surface where it prices
    and reach-fold where it refuses, which is what chunk 5 would have shipped — over EVERY origin, and
    both arms must clear before a swap is licensed. That is a stricter bar than the plan set, never a
    looser one. The refused-vs-priced split is printed because it settles the direction of the
    conditioning: most incumbents earn MORE on the origins `askStar` declined, so what it consents to
    price is the LOWER-return half of the market and the estimator arm is measured only there. Read
    the two arms' deficits against each other rather than assuming the conditioning runs one way.
    **THE ACCEPTANCE CHECK IS NOT CEREMONY — it inverted the result once already.** Contenders are
    RECOMPUTED from the truncated series, so this scores reconstructions rather than the deployed
    estimators, and nothing else in the plan bounds that swap; the report therefore opens by measuring
    each recomputed ask against the ask that estimator actually logged, over the overlapping
    `(itemId, ts)` rows. It caught `asym` being rebuilt as the RAW quantile while the deployed
    estimator logs the GUARDED level — correcting it moved `asym` from last place to first. It also
    fixes the report's own resolution: even `quickSell*`, which is a single archive field, reconstructs
    a fraction of a percent off its logged value (an hourly average against a live print), so a
    head-to-head gap narrower than that is not real. `askStar` has NO row in that table and cannot —
    it was never deployed, so the check bounds the INCUMBENTS ONLY. A contender the check scores zero
    rows for is marked `†` UNBOUNDED in every table and can never be nominated for retirement; `depth`
    is currently that contender, and its size is a convention invented here (a fixed fraction of daily
    flow) because no archive origin has a held lot, so its last-place finish is not evidence about the
    deployed depth read.
    **The pre-registered RETIREMENT criterion is applied, not argued** — deficit CI clear of zero at
    the decisive spec plus the same sign in ≥2 of 3 sensitivity horizons, reference lines excluded,
    unbounded reconstructions blocked, an era sign flip blocking. It NOMINATES; executing one is a
    separate reviewed change — and **`pressure`'s ASK-leg nomination has been carried out (2026-08-30,
    CHANGELOG 0.76.0)**: sell model deleted, trial flags erroring, app column removed, `reachable.ask`
    no longer co-logged, while the bid/band reads and every logged historical row stay scoreable. A
    re-run still re-applies the criterion and annotates that row "already EXECUTED 2026-08-30"
    (`EXECUTED_RETIREMENTS`) so a fresh NOMINATED line never reads as an open action item. Bid-side
    consumers survive either way — this scores the ASK leg only. Run the command for the current
    nomination list rather than quoting one from here.
    **THE CRITERION TRIED TO NOMINATE THE SHIPPED DEFAULT, AND A GUARD STOPPED IT — that exchange is
    the most useful thing this chunk produced.** As pre-registered, `reachFold` qualified: a deficit
    against the leader whose sign repeated across horizons. But that deficit is SMALLER than the
    report's own reconstruction resolution — the figure the acceptance check prints two sections
    earlier — so it is not a measurement, and a nomination under the floor is now BLOCKED in code
    rather than hedged in prose. Nothing may be retired on a gap narrower than the noise in the
    instrument that measured it. The same guard, plus a row floor on what counts as a bounded
    reconstruction, left exactly one live nomination — the `pressure` retirement executed above;
    `reachFold` and `depth` stay BLOCKED.
    **Three sensitivities are load-bearing and two of them moved something.** (1) The `delayCost` sweep
    turns out to be an ALGEBRAIC IDENTITY, not a robustness check: a miss scores an edge of exactly
    zero, so a contender whose ask does not move with the cost has mean edge `edge(0) + cost × reach`
    — which means the sweep carries nothing the reach column did not already, and a sweep that stops
    short reports "no crossover" when there is one. The crossover is now SOLVED in closed form and
    printed. What it says is that a higher-reaching estimator overtakes the leader only once waiting
    costs a substantial fraction of the item's own price per unit per window — and that nothing in the
    range promotes `askStar`, so the chunk-3 reading that a free wait was doing the work does not
    survive contact with realized outcomes. (2) The BAIL CONVENTION settles chunk 1's open owner question in an
    unexpected way: switching from the aggressive `avgLow` bail (cross the spread) to the passive
    `avgHigh` one (rest at the ask level) turns EVERY contender's edge negative — listing at any of
    these asks does worse than simply resting — while leaving the WINNER unchanged. The order BELOW
    first place does move, which is why both conventions are scored instead of one being inherited:
    the bail shifts only the REACHED rows, so contenders that reach at different rates move apart. (3) The one-step LADDER (relist `LADDER_Z_STEP`
    dispersions lower for a second window on a miss) lifts every contender, most the ones that ask
    highest, so Option E has real headroom and a single-shot score is a FLOOR on a relist policy.
    **One measurement artifact is known and it favours the loser**: `reached` is `top >= ask` while
    `refHigh` is a median of PRINTED daily highs, so an ask at the reference collects exact-equality
    matches — over 12pp of the z=0 reach rate, vanishing a half-basis-point higher. It inflates whatever
    prices at z≈0, which is where `askStar+fold`'s median sits, so the null branch is if anything
    understated. `join-exit-ev.mjs`'s header is the ONE home for it (re-homed at the plan fold).
    NO LOOK-AHEAD is the load-bearing invariant, it is mutation-verified, and it is an hour finer than
    it looks: an archive bucket is stamped with the START of its period, so the bucket AT an origin is
    future data. (The store-lag does NOT establish that — the fetcher only ever requests the last
    COMPLETE hour, so a lag over an hour is a property of the fetch policy and reads the same under
    either convention. Comparing a 1h bucket's volume against the twelve 5m buckets on each side of it
    does establish it.) `readableCut`
    stops strictly before it and the outcome window starts after it, leaving that bucket to neither
    side; contenders, reference and dispersion are all rebuilt from what remains, and deleting any of
    the truncations reddens the suite. INFORM-ONLY: gates nothing, writes nothing, prices no offer. Honest limits — one
    92-day era and one update cycle; `reached ≠ filled` (queue position is invisible in a bucketed
    aggregate, so every reach rate bounds a real offer from ABOVE and flatters the HIGH asks most);
    origins overlap unless thinned and every origin of an item shares one price path, so read the ITEM
    counts, never the origin counts — the per-cell table prints both for that reason.
    `--items`/`--stride`/`--horizon`/`--delay-cost-frac`/`--depth-qty-frac`/`--bail`/`--min-rows`/
    `--warmup-days`/`--acceptance-n`/`--json`.)

    **`join-reach-basis.mjs`** (2026-08-13, PLAN-REACH-BASIS-DECISION — settles the digest's
    recent-3-vs-full-window ask-reach split that `screen-flip-niches.mjs`'s header had flagged as KNOWN,
    UNDECIDED and forbidden to "fix" either way without a measurement. PRODUCER: `estConfidence`
    (`askHit`/`askDays`/`askRecHit`/`askRecDays`) on `suggestions.jsonl` + the monthly archives, read via
    `readSuggestionLines()`; forward-scored against the 1h `pipeline/.market-archive.sqlite`. Both bases come
    off the SAME logged row through the one shared `reachFraction`, so the recent→full degradation that
    contaminates a naive contrast is directly EXCLUDABLE (2,101 of 39,909 rows, 5.3%) rather than silent —
    a structural advantage over the unreproducible "+9.8pp/n=6,016" prior, whose method is recorded nowhere in the tree
    and whose script was never committed. **THE PRE-REGISTERED DON'T-BUILD BRANCH FIRED, AND THE FINDING
    IS ABOUT THE TAG RATHER THAN THE BASIS:** at the decisive spec (24h, `askDays ≥ 7`, `askRecDays == 3`)
    M(1) = **+2.3pp favouring recent-3**, 95% item-clustered CI **[0.8, 3.8]** — but **BOTH bases LOSE to
    the never-gate null at equal error costs** (never 2950 · recent 3493 · full 3668 · gate-all 4542), and
    the plan's §3.3 committed that outcome to DON'T-BUILD *before* the run, so it is reported as such and
    not reframed as a basis win. The tag only earns its place when a false green-light costs ≥ ~1.29× a
    false gate. **The full map is FOUR regimes, not a winner** — `never-gate < 1.29 · recent-3 < 1.76 ·
    full-window < 2.05 · gate-all above` — so the shipped basis is optimal only in the narrow
    **1.29 < r < 1.76**, and above r ≈ 2.05 the right move is to gate everything, which no basis choice
    reaches. Note the tension worth stating plainly: r\* = 1.76 sits INSIDE the window where the gate
    beats both nulls, so "both bases lose to never-gate" holds only at the r=1 the analysis itself
    disowns — the script prints the crossovers so a reader can place their own cost ratio instead of
    inheriting one. Code left UNCHANGED on that result; the threshold question goes to F1. Sign is
    stable across all four horizons, both
    fold-flip eras, and band-only (M +2.0pp, CI [0.5, 3.5], r\* 1.56). **PRIMARY IS r\*, NOT M(1)**: M(1)
    swings +0.2pp→+3.7pp across horizons purely through class imbalance (base rate 43.9%→73.2%), which is
    why an accuracy headline would have been an artifact. `reached ≠ filled` — the outcome is a 1h
    `avgHighPrice ≥ ask` PRINT, so absolute rates are an upper bound on filling; the bias is identical
    across arms so the PAIRED contrast holds. A rejected estimator is documented in the header rather than
    deleted: the first design's Δ (outcome-rate gap between discordant cells) is WRONG because it never sees
    the cell WEIGHTS, and a worked counterexample where Δ picks the losing basis is kept there.
    `pipeline/test/joinreachbasis.test.mjs` is MUTATION-VERIFIED — and **its own first draft's look-ahead
    test was VACUOUS**, passing against a deliberately broken binary search because the fixture had no
    bucket exactly at the suggestion ts; the boundary fixture that kills it is documented as load-bearing.
    `--json` (returns before any text), `--horizon H`, `--min-days N`, `--cost-ratio r`, `--item <name|id>`,
    `--iters N`. Pure core `readRows`/`basisPair`/`dedupRows`/`scoreForward`/`mcnemarCost`/`bootstrapM`/
    `blastRadius` fixture-pinned. NOTE `bootstrapM` is a deliberate sibling of, NOT a reuse of,
    `clusterBootstrapCI` — that one takes a `median()` per arm and the median of a {0,1} outcome is
    degenerate),
    `join-window-clears.mjs` (WC2, PLAN-WINDOW-CLEAR-OUTCOMES — the window-clear ask-RUNG fill-attribution
    join, read-only. PRODUCER: the WC1 `windowExit` shadow rows on `suggestions.jsonl` (the surfaced list
    level + peak window + the daily-HIGH vs 5m-grain reach pair, logged on `quote-items.mjs --positions` /
    `watch-positions.mjs` big-ticket held lots). CONSUMER: F1 / human diagnostics. For each `windowExit`
    surface it reconstructs the item's SELL campaigns (via the shared `lib/campaigns.mjs`
    `reconstructCampaigns`/`campaignBase` — the SAME `collapseOffers`/`matchTrades`/`stampFirstFill`, never
    re-implemented) and classifies FOUR outcomes: `UNPLACED` (no rung placed at/near list — a COUNT,
    EXCLUDED from every fill-rate, so a surface Ben never placed is never a false "no-fill"),
    `PLACED_NO_FILL` (the floor-night negative), `PLACED_FILLED_IN_WINDOW`, `PLACED_FILLED_OUT_OF_WINDOW`
    (first fill's local hour ∈/∉ the peak window via `js/windowread.mjs inWindow`). Attribution is
    nearest-PRIOR (no double-count) + an ASYMMETRIC price gate (`--price-tol` 0.5% above, `--price-tol-below`
    1.5% below — the anchor-nudge room, since Ben asks just under round numbers) with the signed
    (placement−list)/list gap emitted so the skew stays visible; the surface→placement lag + gap
    distributions are the D2 diagnostics that CALIBRATE the `--horizon` (24h) / price-tol placeholders LATER.
    DATA ACCRUAL, tunes NO constant; n≈0 for weeks, matching-diagnostics-first. Zero false positives —
    an unrelated lower dump fails the price gate → `UNPLACED`. Pure core `joinWindowClears`/`priceMatch`/
    `classifyOutcome`/`fillHourInWindow` fixture-pinned `pipeline/test/joinwindowclears.test.mjs`; `--json`
    dumps the classified rows + counts + diagnostics),
    `f1-calibrate.mjs` (F1 calibration STUDY — read-only over the derived `outcomes.json` (run
    `join-outcomes.mjs --report` first). PROPOSAL-ONLY, mutates nothing and touches no live pricing/gating
    code: (1) re-audits the F1 gate the way its spec documents (side × pctBucket × class × regime cells
    clearing n≥30, regime bucketed from reconstructed `stateAtFill`), reporting each cleared cell's regime
    SOURCE (real vs the `'noreg'` unknown pile) + top-item concentration; (2) prints P(fill)/median-TTF
    curves by side × class × band-percentile; (3) proposes class-conditional `patientTargets` percentiles
    (`js/trendcore.js`) + fitted `PFILL_*` / `TTF_*` magnitudes (`js/estimators/families.mjs`), each with
    supporting n + an explicit confidence label — surfacing evidence for Ben, NOT graduating a constant.
    `--json` dumps the proposal bundle. Pure analysis fns pinned by `test/f1-calibrate.test.mjs`, incl. a
    drift-guard tying `MIN_N_F1`/`MIN_CELLS_F1` to `join-outcomes.mjs`),
    `reachability.mjs` (RC, PLAN-REACHABILITY-CONSOLIDATION — the PURE reachability head-to-head scorer
    behind `join-reach-outcomes.mjs`. `REACH_ESTIMATORS` is the ONE registry mapping a logged suggestion
    field to a contender: `reachable.ask`→pressure, `asym.ask`→asym, `depthExit.ask`→depth, and `estSell`
    splitting into reachFold / reachRelief on whether `estConfidence.reachRelief` FIRED — the same
    estimator with and without the softening, so the two are scored over DISJOINT rows and this surface
    can never answer "does relief help?" (that needs the relief=0 counterfactual co-logged). `scoreRow`
    scores one read forward against a series; `matchedPool` restricts to the rows every named contender
    priced, which is the only place a cross-estimator comparison is legitimate — coverage is ragged, so
    the pooled marginals are computed over different row sets. Its header owns the why-not-the-realized-
    sell reasoning (the target is circular: a GE sell executes at the ask you typed). Fixture-pinned +
    mutation-verified by `pipeline/test/reachability.test.mjs`),
    `retrojoin.mjs` (P6a — the SUGGESTION→FILL retro-join REPORT: read-only, prints per-flip-niche +
    per-path outcome accounting — filled / filled-worse / not-taken counts, realized TTF median/
    spread, and realized profit per unit of attention — over EVERY suggestion row × `fills.json`
    buy offers. The SUGGESTION-keyed FORWARD counterpart to join-outcomes.mjs's campaign-keyed backward
    join; the ground-truth TTF calibrator for P6 and the input to the band/churn
    consolidation question (the spread/rising flip-niches were deleted in Steps 3+4). Each retro row also
    carries the logged `amplitude` shadow block through (F-G — null off every non-amplitude row + pre-F-G
    history) for the §2b shadow-vs-realized readout. Join logic is the pure `lib/retrojoin.mjs`; `--json` dumps raw rows.
    n on every aggregate, deliberately NO grades/verdicts — the archive is weeks-cold and mostly
    not-taken),
    `analyze.mjs` (PLAN-ANALYZE AZ1 — the ANALYSIS ENGINE: read-only IO+print shell that AUDITS the
    dataset's health (ledger freshness/volume, field-DROP detection — an ALWAYS_FIELD that stopped being
    logged, fills⇆ledger un-attributed-buy coherence, a rebuildability PROXY = inputs parse + positions.json
    fresh vs fills.json, and forward-data recommendations), ORCHESTRATES the existing joins for a compact
    per-flip-niche RETRO ROLLUP (invokes `retroJoin`/`aggregateOutcomes` — re-implements nothing), an
    **amplitude shadow-vs-realized readout §2b** (F-G — `amplitudeRetro`: per closed amplitude round-trip,
    the logged shadow `ampBid→ampAsk ±drift-margin` vs the realized `buy→sell net`, plus the aggregate
    DISCOUNT = (Σ shadow net − Σ realized net)/Σ shadow net; n-gated by the SAME `MIN_N_CANDIDATE` floor —
    n=0 today prints an honest "awaiting real fills" line, deploy-small-to-learn/tuition posture, gates
    NOTHING), a **DL2
    dip-loop retro §4** (`dipLoopAudit` — joins the widened flush log against the retro rows, segments
    `alerted` (liquid) from `signal-only` (illiquid → DL3 input) rows, and computes fillable-vs-not
    separation over the alerted subset; candidate-surfacing → points at F1, never retunes; n≈0 placeholder),
    a **Bar E ask-headroom retro §5** (`askHeadroomAudit` — pulls the lean `askHeadroom` shave-gap flags,
    segments trusted (surfaced) from untrusted (audit-only), joins the trusted subset to the retro
    round-trip. A `rawTopReached` field lived here and was DELETED as circular — `rawTop` exceeds the
    quoted ask by construction and a GE sell executes at the ask you typed, so it scored the tool against
    itself; `forward-reach.mjs` `maxHighWithin` is the non-circular replacement. Candidate-surfacing →
    F1 owns `ASK_HEADROOM_*` + the deferred clamp-widen; n≈0 placeholder),
    and derives
    n-gated TUNING CANDIDATES that are FLAGS for F1, never applied here; a ~0% taken rate is treated as the
    documented BASELINE, not a finding. `--since <hrs>`/`--json`/`--min-n`. Pure core is `lib/analyze.mjs`,
    fixture-tested by `analyze.test.mjs`; consumed by the `/analyze` skill (AZ2). READ-ONLY — never in a
    commit/sync path),
    `analyze-fill-placement.mjs` (PLAN-REACH-CALIBRATION AC1/AC2 — READ-ONLY calibration STUDY, the gate
    for §A's `safeQuantile`: joins every closed lot (`positions.json`) to same-day bucket data and measures
    WHERE realized `sellEach`/`buyEach` cleared in the trailing daily-high/low distribution (the
    `quantHigh`/`quantLow` percentile machinery) vs volDay (→ `qEvidence`) and `sizeShare` = qty ÷ the
    CORRECTED composed rolling-24h volume (`vol24FromInputs`/`rolling24FromTs1h`, never the broken `/24h`),
    with per-bucket n + a lot-count concentration + pooled/per-item Spearman ρ; AC2 rides along — the 1h
    `avgHighPrice` vs same-hour archive-5m max smoothing bias by a volume proxy for prints-per-bucket.
    Fetches live `/timeseries?1h` per distinct closed-lot item (the only dense ~15d source) + reads the
    Tier-1 archive 5m read-only; `--json`/`--nights`/`--offline`. Builds NONE of
    `safeQuantile`/`qEvidence`/`impactFold` (AC3). Pure core `lib/fill-placement.mjs`, fixture-tested by
    `fill-placement.test.mjs`. READ-ONLY — writes no artifact, never in a commit/sync path),
    `build-fill-surface.mjs` (AB2, PLAN-ASK-BACKTEST — the OFFLINE ask-fill-surface BUILDER. Sweeps
    items × reference windows × a premium grid against the Tier-1 archive (`open(undefined,{readonly:true})`
    ONLY — a plain `open()` runs schema DDL against the multi-GB live DB) and emits the versioned
    `pipeline/.cache/fill-surface.json` lookup keyed **premium × price tier × volatility band × horizon**,
    each cell carrying `n`, `nItems`, an ITEM-CLUSTER bootstrap CI and a per-window spread. Answers "if I
    ask X% over mid, how often does the market print at or above that within N days?" — the thing today's
    reads cannot, since `windowread`'s "reached on ~50% of days" is the MEDIAN of the daily highs and its
    50% is true by construction. The premium is EXOGENOUS (set on a grid, never read back off our own
    quotes — that is what made the earlier 91.5% study self-fulfilling); the mid is PINNED via
    `lib/market/fill-surface.mjs:itemFeaturesFromSeries`; features are strictly BEFORE the reference
    instant and the outcome window strictly after. `--grain 1h|5m`, `--windows`, `--vol-days`,
    `--mid-hours`, `--min-coverage`, `--limit`, `--boot`, `--out`, `--dry-run`. ⚠ **Build at `1h`, not
    `5m`, despite 1h's measured bias** (2026-08-08): the 5m archive is only 30d deep and a 5m build yields
    **n=10** per `>=10m` cell against **576** at 1h — it trades a ~9pp calibration bias for an unusable
    sample. The bias is carried as a REPORTED correction instead (`grainBiasPp`), never applied.
    READ-ONLY against the archive, writes only its own artifact, never in a commit/sync path — NO live
    surface reads it (AB7 is the chunk that puts the LOOKUP on `read-window-range.mjs --fill-rate`,
    console-only/INFORM))
  - **Daemon subsystem (`pipeline/daemons/*.mjs`, PLAN-DAEMON-SUBSYSTEM Phase 1+2):** the legible
    background-task layer — one registry + one lightweight manager for the scattered fleet
    (`sync-fills`/`watch-log`/`dev-server` + the `cache-warm` guard). `registry.mjs` (the DECLARATIVE
    fleet list — one `{name, description, kind:'resident'|'guard', local, autoRun?, trigger, healthCheck(),
    start()}` entry per daemon. Phase 2 migrated the three pre-existing daemons off their stubs to REAL
    health checks: `sync-fills` (guard — book freshness via `positions.json` mtime), `watch-log` (resident —
    `heartbeatHealth` off the LW3 `heartbeat.json`), `dev-server` (resident — `httpProbeHealth` on :8000),
    all `autoRun:false` (see below); `cache-warm` (guard, zero-git) stays the ONE auto-run entry. Also the
    registry-adjacent `GIT_WRITER` const records `sync-fills --publish` as `local:false` WITHOUT a callable
    `start()` so the manager can never invoke it. Each `description` states "zero-git"/"commits to main" in
    words — the `--publish` naming-collision guard, since screen's `--publish` is local but sync-fills' is a
    git-push. Side-effect-free on import). **The `autoRun` field (Phase 2):** `local` = git-safe-to-run-at-all;
    `autoRun` = should `ensure()` actually START it. Only `cache-warm` is auto-run (field omitted → defaults
    true); the other three are `autoRun:false` — VISIBLE in `status()` but never auto-started (sync-fills
    already rides every read via `runLocalSync`; residents are started attended via `serve.cmd`).
    `manager.mjs` (`status()` = read-only fleet health, resident up/down + guard last-ran/stale + the `autoRun`
    flag per row; `ensure()` = start any down resident / run any stale guard, self-throttling via
    `MIN_CHECK_INTERVAL_MS` (5-min PLACEHOLDER). **THE SAFETY INVARIANT:** `ensure()` refuses to auto-run any
    `local:false` daemon — `if (!d.local) { …; continue; }` runs BEFORE any `start()`, every entry every call
    (the CofferFillsSync lesson encoded — no git-writer ever runs unattended); a second `if (d.autoRun ===
    false) continue` skips the visible-but-manual entries the same way. Never throws out to its caller; also
    owns the `loadState`/`saveState` heartbeat helpers. Fixture-tested by `pipeline/test/daemons.test.mjs`,
    incl. the mandatory safety-invariant + autoRun-skip tests).
    `health.mjs` (Phase 2 Chunk 7 — the SHARED resident health primitives: `heartbeatHealth({path,now,staleMs})`
    (heartbeat.json age → `{ok,detail,lastRan}`) + `httpProbeHealth({url,timeoutMs,fetchFn})` (HTTP probe →
    `{ok,detail}`), both injectable + never-throw. GENERALIZED from `ensure-server.mjs`'s two hand-rolled
    `checkDaemon()`/`checkServer()` probes so the registry's resident entries AND `ensure-server.mjs` share ONE
    implementation; consumed by `registry.mjs`, `pipeline/commands/ensure-server.mjs`, and the test).
    `cache-warm.mjs` (Chunk 4 — the cache-warm GUARD's real `healthCheck()`/`start()` the registry entry
    dynamic-imports): `healthCheck()` reads the newest /1h bucket age via `marketfetch.newest1hAgeHours`
    (opens+closes its own archive handle) and reports `ok:false` when age > `WARM_THRESHOLD_HOURS` (**3h** —
    retuned 2026-07-27 from 23h, which could not work: the Task Scheduler tick is 4h, so a 23h threshold left
    ~1h of margin against the 24h cap on `loadAll24hRolling`'s backfill walk and routinely reported "fresh"
    on a 12h-stale archive. The threshold must stay BELOW the tick interval — the two are coupled) OR the archive is COLD (no /1h
    data → "needs warming", never a crash); `start()` runs the two zero-git check-before-fetch backfills
    (`loadAll24hRolling` + `loadBands`, both INJECTABLE so the test stays offline) then stamps
    `daemon-state.json`'s `lastRan` via the manager's `loadState`/`saveState`. ZERO-GIT by construction —
    never imports `sync-fills.mjs`. Idempotent (relies on the manager's `MIN_CHECK_INTERVAL_MS` throttle as
    the de-dupe, no second lock file); both hooks wrapped so they never throw. Ships a CLI
    (`node pipeline/daemons/cache-warm.mjs --check-only` = report health only; bare/`--warm` = ensure-then-warm
    through a one-entry `ensure()`) as the Windows Task Scheduler target (Chunk 6). Consumed by
    `registry.mjs` (dynamic import) + the opportunistic `ensure()` hook (Chunk 5 — LANDED, wired into
    `screen-flip-niches.mjs`/`quote-items.mjs`/`run-loop.mjs`/`dev-server.mjs` boot);
    fixture-tested hermetically by `pipeline/test/cache-warm.test.mjs` (synthetic :memory: archive + injected
    backfill spies + temp heartbeat file, TZ-pinned).
    `read-daemons.mjs` (`pipeline/commands/`, Phase 2 Chunk 8 — the fleet STATUS surface: `node
    pipeline/commands/read-daemons.mjs [--json]` prints `manager.status()`'s one-row-per-daemon table
    (Daemon · Kind · Git · Auto · Health · Last ran · Detail). READ-ONLY — calls `status()`, never `ensure()`,
    so it starts nothing; it DOES live-probe each entry (a localhost fetch for dev-server, an archive read for
    cache-warm, a stat for the guards). No APP_VERSION bump).
    `backfill-archive.mjs` (`pipeline/commands/`, added 2026-07-27 — the DELIBERATE hole-REPAIR job for the
    Tier-1 SQLite archive, the backwards-looking counterpart to the forward-looking `cache-warm` guard:
    `node pipeline/commands/backfill-archive.mjs [--days N] [--grain 1h|5m] [--dry-run] [--limit N] [--pace ms]`.
    EXISTS BECAUSE every routine writer is capped — `loadAll24hRolling` walks only the trailing 24 windows and
    `loadDaily` only a 6-HOURLY grid (`stepHours=6`, the 1-in-6 sawtooth older than a day) — so a hole left by an
    idle stretch is never repaired by anything else. Holes ARE repairable: bulk `/1h?timestamp=` was measured
    serving real, distinct buckets 365 DAYS back, so the old "the wiki only serves ~30h/item, a hole is
    permanent" premise is retired. Finds the missing buckets over the requested window, prints them as
    contiguous runs, then fetches OLDEST-FIRST (the leading edge refills itself via the guard/any scan; old holes
    do not). ZERO-GIT — writes only `pipeline/.market-archive.sqlite`; interrupt-safe + resumable (idempotent
    composite PK + check-before-fetch), so a re-run skips what landed. Distinguishes a wiki-EMPTY slot from a
    FAILED request in the summary. Costs one bulk request per missing bucket — prefer `--dry-run` first, and
    `--limit` to split a long repair. Not auto-run by anything. Its two PURE helpers (`windowsFor` — the
    grain-grid window list, pinned to the last COMPLETE bucket so a half-formed hour is never archived as
    final; `holeRuns` — contiguous-run shaping for the report) are fixture-tested offline by
    `pipeline/test/backfill-archive.test.mjs`, which also proves importing the module never fires its CLI).
    `run-cache-warm.cmd` (Chunk 6 — the STABLE, args-free Windows Task Scheduler target: `cd /d "%~dp0..\.."`
    to the repo root then `node pipeline\daemons\cache-warm.mjs --warm` (ensure-then-warm, NOT --check-only).
    Zero-git — same code path as the opportunistic hook. Produced/committed by this repo; consumed by the
    Task Scheduler job "TheCofferCacheWarm").
    `install-cache-warm-task.cmd` / `uninstall-cache-warm-task.cmd` (Chunk 6 — the REVERSIBLE, checked-in,
    run-ONCE-attended installer pair. `install` runs `schtasks /create /tn "TheCofferCacheWarm" /tr
    "<%~dp0-derived abs path to run-cache-warm.cmd>" /sc hourly /mo 4 /rl limited /f` (every 4h, non-admin
    run level — local files only) and echoes what it did + how to undo; `uninstall` runs `schtasks /delete
    /tn "TheCofferCacheWarm" /f`. An agent SHIPS these; Ben RUNS `install` once — registering an OS scheduled
    task is a human-attended step, not an unattended agent action. Not auto-run by anything)
  - **Shared libraries (`pipeline/lib/*.mjs`, imported only):** `analyze.mjs` (AZ1 — the PURE audit +
    tuning-candidate core: `auditDataset`/`deriveCandidates`/`fieldPresence`/`dipLoopAudit`/`askHeadroomAudit`
    + the NAMED-PLACEHOLDER
    thresholds; no fs/no fetch, the honesty n-gates live here so a skill can't launder a thin signal),
    `fill-placement.mjs` (AC1/AC2 — the PURE calibration core for `analyze-fill-placement.mjs`:
    `lotPlacement` (per-lot daily-high/low percentile placement + `sizeShare`/`shareHpv` on the corrected
    rolling-24h denom, coverage-degrading + future-leak-guarded), `smoothingBias` (the AC2 5m-max vs 1h-avg
    join), and `cdf`/`spearman`/`median`/`quant`; no fs/no fetch, fixture-tested by `fill-placement.test.mjs`),
    `reconstruct.mjs` (shared
    FIFO reconstruction + `dedupeSnapshots`; ARCH-1 adds `buildTombstonedEvents` — the live-log →
    tombstone-filtered event list monitor-offers.mjs reconstructs from, mirroring sync's inline REMOVE-tombstone
    filter. PLAN-SALE-LOG-TAX adds the WORTH-CONVENTION layer: `isNetWorthSource(filename)` (`.json`
    sources log a sell's `worth` NET of tax since the 2026-08-26 plugin format switch; `.log`/`.txt`
    — incl. manual/mobile — stay GROSS; source-derived, never timestamp), a `worthNet: true` flag
    stamped on SELL events by `parseJsonLine`'s per-file option or a stamped raw field (never hashed
    into `eventId`, so the fills.json merge auto-migrates flags id-for-id), `collapseOffers`
    propagation to the offer, `sellNetEach(offer)` — the ONE net-proceeds formula `matchTrades`'
    realised and `deriveCash`'s sellIn share — with gross/tax recovered for display via
    `js/quotecore.js` `grossFromNet`, and `auditWorthConvention(rows, assignedNet, filename)` — the
    per-file recurrence guard `regenerate()` runs every sync (warn-only, never abort/auto-flip;
    limits in `pipeline/FILLS-PIPELINE.md` §5.1)),
    `campaigns.mjs` (WC2 — the shared CAMPAIGN reconstruction primitive: `reconstructCampaigns(events)` =
    the exact `dedupeSnapshots→collapseOffers→stampFirstFill→matchTrades→groupCampaigns` sequence
    `join-outcomes.mjs` used to run inline, lifted here VERBATIM so the forward-join siblings
    (`join-window-clears.mjs`) reuse ONE reconstruction (the FIFO helpers stay in `reconstruct.mjs`; this
    only adds campaign GROUPING + `stampFirstFill` + `campaignBase` — the base per-campaign fields
    placement/first-fill/terminal/fill-fraction). `groupCampaigns` is MULTI-CHAIN per item+side: each
    parallel ladder is its own chain and an offer joins the chain it genuinely succeeds — same slot wins
    outright (a freed slot reused cannot be parallel), then closest-closing within
    [−`REPLACE_OVERLAP_TOL`, `REPRICE_GAP`]; a predecessor still live past the tolerance is a parallel
    listing, never a forced stitch, and completion always terminates a chain. (The old single-chain map
    both stitched parallel listings into false reprices and interleaved genuine ladders — scored pairwise
    on the real book at the fix: false stitches to zero, definite same-slot successions up, every
    non-merged place-then-cancel candidate explained by a completion split or a closer same-slot
    predecessor. Grouping-derived baselines from before the fix don't carry across.) Pinned by
    `pipeline/test/campaigns.test.mjs`. `join-outcomes.mjs` imports it. Owns
    `REPRICE_GAP`/`REPLACE_OVERLAP_TOL`/`MANUAL_SLOT_MIN`),
    `offers.mjs` (exchange-log discovery + open-offer
    semantics; P0 also adds `readOffersSnapshot`/`askFromSnapshot`/`bidFromSnapshot` — the OTHER-machine-safe
    reader of the flat root `offers.json`, normalized to the `{price,filled,total}` shape the context
    position stage wants, so quote-items.mjs can see the live book without the `~/.runelite` log dir;
    `readOfferRows` stamps rows from a `.json` (net-worth) source `worthNet: true` — PLAN-SALE-LOG-TAX —
    so the convention survives `readExchangeLog`'s stringify round-trip into `parseJsonLine` and the
    raw-row px displays (monitor-offers / trigger-alerts) can recover gross on a net sell row),
    `paths.mjs` (chunk 6 — the tiny shared `REPO_DIR` anchor, honoring `--repo-dir`, so `derive-cash-tiers.mjs`
    and `cash-anchor.mjs` no longer import it from the `sync-fills.mjs` COMMAND (a lib→command layering
    inversion that ran sync's module top-level as a side effect); `sync-fills.mjs` re-exports it so
    `watch-log.mjs`'s import is unchanged),
    `positions.mjs` (shared `readOpenPositions` open-lot grouping), `limits.mjs` (LM1 — PURE rolling-4h
    buy-limit window math: `limitWindow({buys,limit,now})` → `{limit,boughtInWindow,remaining,nextFreeAt,
    fullResetAt}` (null limit = UNKNOWN, never unlimited) + `buysByItem(events)` extracting per-item BUY
    fills the SAME way `reconstruct.mjs` does (`collapseOffers∘dedupeSnapshots`, final cumulative filled,
    banked/sells excluded). Consumed by `pipeline/commands/read-buy-limits.mjs` CLI + `screen-flip-niches.mjs`/`quote-items.mjs`'s
    `limitValidator` ctx; honesty: logged fills only, so `remaining` is an UPPER bound), `archive.mjs`
    (D0 — the Tier-1 SQLite market archive: a thin `node:sqlite` (`DatabaseSync`) wrapper storing
    RAW `/1h`+`/5m` bulk observations keyed `(grain, ts, itemId)` with `INSERT OR IGNORE` + WAL/
    busy_timeout. `open`/`append`/`seriesFor`/`marketAt`/`exportFixture`/`pruneBefore`/`dailyRangeBulk`;
    NEVER archives
    `/latest` (no idempotent bucket); stores only raw fields — every derived value is recomputed by
    pure functions, never cached; `hasBucket` is the check-before-fetch predicate. `dailyRangeBulk({ids,
    sinceTs})` (PLAN-LANE-ADMISSION Chunk A) is the READ-ONLY bulk SQL aggregate → per-item per-UTC-day
    `{hi:MAX(avgHigh), lo:MIN(avgLow)}` over the raw `/1h` buckets + a `coverage` map (distinct 1h
    buckets/day, 24 = full) — the Path-A intraday-range data source; degrades to an empty result on a
    cold archive, never throws. `newestBucket(grain='1h')` (PLAN-DAEMON-SUBSYSTEM Chunk 1a) is the
    READ-ONLY index-covered `SELECT MAX(ts) WHERE grain=?` — newest stored ts (unix s) for a grain, or
    `null` on a cold/empty archive (never throws); the cache-warm guard's "how cold is the /1h archive"
    freshness probe. Backs `loadDaily`
    (with a one-time `daily_seed` import of the pre-D0 `.cache/daily` mids). Surgically suppresses the
    one `node:sqlite` ExperimentalWarning via a `process.emitWarning` filter installed before a
    `createRequire` load — no global `--no-warnings` flag on any script. CLI: `node
    pipeline/lib/market/archive.mjs [--prune-before <ts>]` (prune shipped, unused by default)),
    **`archive-series.mjs`** (AF4, PLAN-ARCHIVE-FIRST-FUNNEL — reads a per-item series OUT of the archive
    in the exact `fetchTs` row shape so a Stage-2 gate can run with ZERO per-item API: `archiveSeries()`
    renames the archive's `ts` to the `timestamp` every consumer keys on — fed raw the rows are silently
    dropped by `quotecore.js:246`'s filter and the gates degrade-to-pass, which is why the rename is a
    fixture-pinned adapter and not an inline `.map()`; `aggregate1hTo6h()` derives the unstored 6h grain
    from 1h, volume-weighted and EXACT at full coverage (measured 0.000% median error vs live across four
    price tiers; the whole residual is missing hours, exposed as `sourceBuckets` — DESCRIPTIVE ONLY, never
    a gate, and side-blind). Plus the AF5b 6h read: `LIVE_TS6H_BUCKETS` (365 = the `/timeseries?timestep=6h`
    cap, ≈91d), `archive6h(handle,id,{now})` — aggregate + PIN to the newest 365×6h + strip `sourceBuckets`
    so the archive-only field can never reach a serialiser — and `sixHourReader({handle,live,onSource})`,
    the seam whose no-handle path is a pure pass-through to the live fetch (that is what makes "flag off is
    byte-identical" a property rather than a promise). The pin exists because `phase()` is DEPTH-dependent
    (`baseMid`/`peakMid` both move with history length: 4/165 verdicts flip full-series vs 0/165 same-span)
    and the archive accrues forever, so past ~2026-08-28 an unpinned read would drift silently. It is a
    CEILING, not a floor — it cannot add depth the archive lacks, so until the archive passes 91.25d
    `phase()` is not live-equivalent (Snape grass reads `spike` live / `decay` archive) and `onSource`
    carries the achieved bucket count so callers say so. ⚠ The pin fixes the DEPTH artifact ONLY — the
    once-claimed "same-span ⇒ no flips, none is data quality" was FALSIFIED 2026-08-08 (2/60 same-span
    six-way flips and 1/60 GATE flips in the 00:00–02:00 local window, from ±1gp rounding tipping a discrete
    threshold; the Red d'hide chaps case OPENS the falling exclusion on an item live excludes). The reader
    also enforces a DEPTH FLOOR (`REGIME_MIN_6H_BUCKETS`): an archive slice too short for `regimeDrift` is
    served LIVE and reported as `shallow`, because a short series yields `{ok:false}` → label `unknown` →
    the falling exclusion silently un-gates. Consumer: `screen-flip-niches.mjs --archive-regime` (AF5b).
    Pinned by `pipeline/test/archive-series.test.mjs` + `pipeline/test/archive-6h-pin.test.mjs`),
    **`forward-reach.mjs`** (RE-EXPORT SHIM only — the primitives MOVED to `js/forward-reach.mjs` at
    PLAN-REACH-SURFACE chunk 0 and are documented in the `js/` inventory above; this path survives so
    existing pipeline importers resolve unchanged. Do not add logic here),
    **`printed-at.mjs`** (AB1, PLAN-ASK-BACKTEST — the PURE atom the ask fill surface is built from:
    `printedAt(series,{mid,premium,horizon,from})` → did any bucket in the horizon print `avgHighPrice ≥
    mid × (1+premium)`, plus the observed max. No fetch, no archive handle, no clock. `mid` is an INPUT
    and is NEVER derived here — base side/window move every measured level 5–15pp, so the pinned
    definition is enforced at the CALL SITE rather than silently chosen inside. Premium is over MID, never
    over our own bid (bid-relative conflates ask greed with entry quality). `horizon` is in DAYS; the
    window is exclusive at `from` (the reference bucket cannot score its own outcome) and inclusive at
    `from + horizon×86400`. `printed` is TRISTATE — `null` + a reason when no bucket is archived in the
    window, because an unarchived bucket can never print and scoring it as a miss mechanically depresses
    every level. A `ts`-shaped archive row THROWS rather than reading as "never printed". Fixture-pinned
    by `pipeline/test/printed-at.test.mjs`),
    **`fill-surface.mjs`** (AB2's keying/feature layer + AB3's inversion — `itemFeaturesFromSeries()` is
    THE pinned basis (mid = prior-24h mean `avgHighPrice`, `relStd` = prior-7d relative std = the item
    axis, `coverage` = that window's density), all computed strictly BEFORE the reference instant so the
    same call is valid at build time and at decision time; `priceTierOf` (ABSOLUTE `<100k`/`100k-1m`/
    `1-10m`/`>=10m` — omitting price tier overstates big-ticket fill by ~30pp) and `volBandOf(relStd,cuts)`
    (SAMPLE-RELATIVE terciles read from the artifact's own stored cuts, never hardcoded); `loadSurface()`
    returns null on a missing/pruned/wrong-schema artifact so the lookup refuses loudly; and
    **`askAtFillRate(item,{targetP,horizon})`** (AB3) — the highest premium whose measured cell clears
    `targetP`, converted to gp off the pinned mid. It REFUSES (`ask:null` + a reason) rather than
    extrapolating: `no-surface`/`no-mid`/`no-volatility`/`no-density`/`sparse-item` (the surface describes
    DENSE items only)/`unknown-horizon`/`sparse-cell`/`target-unreachable`/`bad-target`/**`tier-out-of-range`**
    (2026-08-08: `>=10m` is UNBOUNDED ABOVE and was pricing a 1.4b item off the same cell as a 27m one —
    the `>=100m` stratum prints 37.3% where the tier reads 44.6% at +2%/3d. The tier cannot be split, so
    above `TIER_CALIBRATED_MAX` it refuses); a hit at the top
    of the grid returns `capped:true` (censored, not extrapolated), and below the +2% separation floor the
    volatility band is reported NOT claimable with the vol-pooled figure alongside. Every answer carries a
    level uncertainty and the print-proxy limit (a lower bound at qty=1, silent about size) — and where a
    cell's `windowSpread` exceeds its bootstrap CI (the MEDIAN case: 18.4pp vs 8.5pp on the 2026-08-08
    build, since an item-cluster bootstrap cannot see window clustering) the answer leads with the spread
    and says the CI is a floor on the uncertainty, not the whole of it. `grainBiasPp(grain,tier,premium)`
    carries the MEASURED 1h-vs-5m gap (`>=10m` only: 5.5–9.4pp, peaking at +2% — the working range —
    rather than converging as the plan claimed; pooled across tiers it is 0.7–2.0pp and within noise) and
    the answer SHOWS both numbers without applying either: a decision-mover ships as a visible comparison,
    not a silent swap.
    Fixture-pinned by `pipeline/test/fill-surface.test.mjs`. NOT wired to any surface yet — AB7),
    `marketfetch.mjs`
    (node-side price/guide fetch layer + historical bands `loadHistBands`/past-anchored 6h series
    `loadHistDaily` (YF1) + `loadBands(hours,{db})` — the whole-market 5m intraday band read, PERF-1
    (2026-07-19) re-pointed at the D0 SQLite archive (`marketAt('5m',w)`, check-before-fetch,
    optional shared `db` handle) off the retired `.cache/bands/` flat-file day-cache that was read in
    full every scan pass; `BANDS_DIR`/`BANDS_RETENTION_DAYS` gone (archive is append-forever). Pinned
    by `pipeline/test/loadbands.test.mjs`. `loadHistBands` (its own per-item outcomes-band cache) is a
    SEPARATE function, untouched + `loadDaily` re-pointed at the D0 archive (byte-identical `{ts,mid}` output,
    proven vs the old cache) + `loadSnapshot()` — the D0 per-pass immutable context `{ts, latest, v24,
    mapping, guide, archive, series(id)}` composed from the existing loaders, passively accruing the
    archive (appends the current bulk `/1h`+`/5m` buckets, check-before-fetch) + the FC1 opt-in cross-invocation fetch
    cache — `setFetchCache`/`cachedJget` serve the per-item GETs from gitignored `.cache/fetch/`
    within per-endpoint TTLs; OFF by default so decision paths stay byte-identical + the SF-3
    `loadAll24hWarm()`/`readWarmAll24h(dir,ttl,now)` warm-ONLY bulk `/24h` accessor — a fetch-free
    synchronous read of `all24h.json` when within `ALL24H_TTL`, else null; NEVER forces the bulk dump,
    letting `quote-items.mjs` converge its logged liquidity `class` on screen's bulk snapshot for free) + the
    PLAN-VOL24 CORRECTED rolling-24h volume composers `loadAll24hRolling({db})` (whole-market trailing-24h
    map from the last 24 complete `/1h?timestamp` bulk windows, reusing the SQLite 1h archive; the fix for
    the BULK `/24h` endpoint, which serves a complete UTC-day aggregate whose newest data is ~24–48h old —
    the "frozen ~1–3h slice" reading is 2026-07 history, see the `loadAll24hRolling` header) + `loadDailyRangeBulk(days,{db,ids})`
    (PLAN-LANE-ADMISSION Chunk A — the thin READ-ONLY wrapper over `archive.dailyRangeBulk`: whole-market
    per-item per-day intraday range `{id:{date:{hi,lo}}}` straight from the SQLite archive, ZERO fetch,
    plus a `coverageDays`/`partialDays` HONESTY field — number of days with FULL 24-bucket `/1h` coverage,
    never hardcodes a depth the archive lacks; full coverage only started 2026-07-13) + `newest1hAgeHours({db})`
    (PLAN-DAEMON-SUBSYSTEM Chunk 1a — the thin ZERO-fetch wrapper over `archive.newestBucket('1h')`: hours
    since the newest `/1h` bucket, or `null` on a cold archive, so the cache-warm guard reads "how cold are
    we?" without opening the archive itself) + `rolling24FromTs1h(ts1h)` (the same
    sum off an already-fetched per-item 1h series → zero new fetch) — now the DEFAULT `screen-flip-niches.mjs` volume
    (`--vol-source legacy` switches to the raw bulk `/24h` — a staleness A/B, NOT a pre-recal repro:
    measured median 1.151× and only 5.2% `FLOOR`-admission disagreement, 2026-08-10; PLAN-VOL24 step 2), with the volume floors recalibrated
    to the corrected distribution; consumed by `screen-flip-niches.mjs` and logged as the `volDayRolling` shadow field for the
    floor recalibration (`PLAN-VOL24.md`; a sibling `volDay` scalar — the raw limiting-side number behind
    `class` — is logged from 2026-08-11, so `class` is reproducible from the record and a future source
    split is diagnosable; absent on earlier rows, which are therefore unrepairable) + `vol24FromInputs(inp)` (PLAN-VOL24 step 2b — the per-item corrected
    volume for `quote-items.mjs`/`watch-positions.mjs`: `rolling24FromTs1h` off the in-hand `ts1h`, reassigned onto `inp.vol24`
    so Vol/d + pressure + the dip reference read corrected volume; degrades to the `/24h` read when the 1h series
    is too short)), `cli.mjs` (shared arg/format/table
    helpers), `sync-invoke.mjs` (AR1, PLAN-ARCHITECTURE-COHERENCE — the ONE home for the SY1 "always sync
    first" invocation: `runLocalSync({offBookNote})` shells out to a BARE (local/zero-git) `sync-fills.mjs`
    before a read, prints the single `positions:`/`nothing to`/`Pushed` summary line (unified superset regex —
    a local sync never prints `Pushed`, so the union is a no-op on observed output), and NEVER blocks the read
    on failure. Was copy-pasted byte-for-byte across `screen-flip-niches.mjs`/`quote-items.mjs`/`watch-positions.mjs`
    — those FOUR (`screen-flip-niches`, `quote-items`, `watch-positions`, `read-book`) are its only consumers, one call each. `read-book.mjs` is the odd one: no quiet default, so the sync summary line prints there and nowhere else. Node-only, not app-imported), `compose.mjs` (PC1, PLAN-PIPELINE-COMPOSITION — the thin COMPOSITION resolver: `resolve(category,
    {flag, config, fallback, shadowPool?})` → `{active, shadow:[names]}` with precedence **CLI flag > `pipeline/pipeline-config.json`
    > hardcoded fallback**, ACTIVE-PLUS-SHADOW not exclusive-or — `shadow` is the optional `shadowPool` minus
    `active` (a variant never shadows itself; absent pool ⇒ `[]`, byte-identical to PC1). PC3 adds
    `shadowModelsOf(registry)` (pools a registry's `defaultShadow:true` model names for the pool) + `loadPipelineConfig()`
    (the OPTIONAL config, read once + cached, absent ⇒ `{}` ⇒ every default stands byte-identically) + the ONE
    shared `refusePublishIfNonNeutral({publish, publishExplicit, checks})` guard (replaces the per-flag inline
    publish-refusal copies in `screen-flip-niches.mjs`). No fetch/clock; pure of side
    effects on import (config read is lazy). Consumers: `screen-flip-niches.mjs` (mode/vol-source/asym/phase-rescue/
    `sellModel` via `--est-sell` + the `modes` config array driving `--mode all`'s flip-niche set), `quote-items.mjs` +
    `watch-positions.mjs` (`sellModel` via `--est-sell=…`; the retired pressure-exit sugar now errors). Pinned by `compose.test.mjs`),
    `render.mjs` (PLAN-VIZ-LAYER — the ONE render layer between the pipeline's DATA and the
    reader: a script builds a plain JSON-serializable **report object** `{kind, generatedAt, sections:[…]}`
    beside its compute, and `renderReport()` turns it into markdown/console text, DELEGATING to the existing
    pure formatters (`mdTable`, `heldNoteBlock`, `renderHeldVerdict`/`renderPathLine`) — it decides nothing +
    computes no numbers. Consumers: `watch-positions.mjs` (`buildWatchReport`, VZ1), `quote-items.mjs`
    (`buildQuoteReport`, both modes, VZ3), `screen-flip-niches.mjs` (`buildScreenNicheReport`, VZ4a/b). Notes
    are typed `{kind,tier,text}`; the per-kind sigil lives in render.mjs's `NOTE_KINDS`, not the push site.
    Also holds the surfacing-TIER registry (R10 — `core`/`context` both render+relay by default, a tracking
    label not a gate; `shadow` never enters a report). Byte-identity + the VZ2b canonical-cell format +
    quote/screen report assembly pinned by `pipeline/test/render.test.mjs`).
    **`rating.mjs` and `estimators.mjs` MOVED to `js/` (2026-07-10, app-parity Wave 2a)** —
    now **APP-IMPORTED by `js/market.js`** (AP4, 0.61.0 — the Finder Grade column + Rating bar + sort use
    the shared `estimateRank` + `rateItem`, replacing the old `RATE_W` profit/hr Risk model; coarse
    live-quick basis in the Finder — the per-item quote is the band-precise read); `pipeline/lib/`
    keeps a one-line re-export shim at each old path so every node importer resolves byte-identically.
    Their descriptions (retained here for the pipeline reader): `rating.mjs` (grade/score model — P6b:
    the reward basis is the per-thesis RANK
    `net × P(fill) ÷ TTF` from `estimators.mjs`, NOT the demoted expGpDay; cutoffs are on that rank
    scale, still PLACEHOLDERS. **PLAN-GRADE-REWORK (2026-07): `score = rank × geomean(regime·mom·liq·confidence)`**
    — the risk multiplier is a GEOMETRIC MEAN (G4/O6), not the raw product, and the old per-unit-price
    `capitalFactor` is DELETED (G2/O3, no big-ticket haircut). The breakdown penalty lives once, in the
    rank's pFill (G4 dropped `momFactor`'s duplicate branch). The four grade caps (thin→phase-basing→
    sub-floor→reach) live in ONE `applyGradeCaps` chain inside `rateItem` (G1), which also returns the R7
    `cappedBy` binder. A `(thin)` CONFIDENCE MARKER (`CONF_THIN_N_FLOOR`, G6/O5) annotates the letter when
    the pFill reach sample `n` is thin — marker only, never moves score/grade/order), `estimators.mjs` (**PC2, 2026-07-17 — now the BARREL: a pure `export *` re-export of the four split files under `js/estimators/`, so the app (`js/market.js`) + pipeline-shim (`pipeline/lib/signal/estimators.mjs`) import paths are unchanged. The split: `js/estimators/families.mjs` = the P(fill)/TTF family estimators (`pFillIntraday`/`pFillValue`/`pFillRising`, `ttfIntraday`/`ttfValue`/`ttfRising`, `churnLapUnits`) + the `ESTIMATORS` registry/`estimatorFor`, `quotedPair`, `rankScore`, `estimateRank`, `fmtTtf`, the priors block + the module's founding header; `js/estimators/reach.mjs` = the reach-conditioning helpers `reachRelief` (+ its `REACH_RELIEF_*`/`REACH_DEBIAS_MAX_FRAC` constants), `dayHighFrom5m`, `reachFraction`, `askReachFactor`, `asymEstimate`. **RB-3 (PLAN-RECENCY-BASIS, 2026-08-04) added `reachFraction(askReach, { prefer })` — the ONE recency-basis rule**: `prefer:'full'` (the default) returns `reachedDays/nDays`; `prefer:'recent'` returns `recentHit/recentDays` and degrades to the full window when no recent counts exist. It replaced three independent copies of that conditional (`estimatePair`'s `reachRead`, the screen's `digestReachFrac` — RB-5, and an inline fraction inside `askReachFactor`). `askReachFactor(askReach, relief, { prefer })` takes the basis as an explicit OPT-IN defaulting to `'full'`, so every pre-existing call stays byte-identical; **BASIS FLIP 2026-08-09**: `estimatePair`'s `pFill` AND the fold price it sits beside moved back to `'full'` (recent-3 is four-valued at n=3 — the resolution argument, which stands on its own; the forward-scoring result once quoted here is the UNREPRODUCIBLE prior this same file flags in the `join-reach-basis.mjs` entry, so its digits are not repeated), so display and RANK now agree and RB-3's deliberate display/rank split is retired. Still on `'recent'`, and now the only two: the `--digest` reach column and `watch-positions`' size-relief note — **no longer a flagged split: MEASURED 2026-08-13 by `join-reach-basis.mjs`, which found recent-3 the cheaper basis for the digest column (M(1)=+2.3pp, CI [0.8,3.8]) and left it in place; the same run found the `sell unreliable` TAG loses to not gating at all below r≈1.29, which is the finding that matters** (see this file's `join-reach-basis.mjs` entry); `js/estimators/pair.mjs` = the reconciliation price estimator `entryDoctrine` + `estimatePair` (PC3: now the ordering SHELL/spine ONLY — it preps shared inputs, delegates the buy+sell PROPOSAL to a named `SELL_TOP_MODELS` entry, then applies the non-skippable floors: declared-exit anchor → nudge → ordering clamps → BE floor. **PLAN-ESTIMATOR-HONEST-SELL E1 (2026-07-22): the BE floor is NO LONGER an overwrite** — `estSell` keeps the model's honest (possibly-sub-BE) number, `estSellFloorBind` carries the break-even as a display fact (killing the false `+1 (BE X)`), and the shell adds `pFill` (reuses `askReachFactor` — the same function the rank calls, never forked; on the FULL-WINDOW basis since 2026-08-09 so it matches the full-window fold price beside it — and, unlike under RB-3, the rank's own P too) + `estSellForward`/`forwardPeak`/`forwardTrough`/`forwardConfidence`/`holdHorizonDays` (the `driftExitFrom` "list at X" forward projection off `extra.forward`, degrade-safe/zero-fetch — hence pair.mjs now imports `js/forecast.mjs`; **its `fwdCtx` passes `liveLo: quickBuy` (the instasell) / `liveHi: quickSell` (the instabuy), matching every other call site and `forecast.mjs`’s own `@param` — it was SWAPPED here until 0.74.9. The two trend-only branches are MUTUALLY EXCLUSIVE (`trendPerHour > 0` vs `< 0`), so exactly ONE side moved per item — a faller's exit peak one spread low, a riser's entry trough one spread high — never both, and `forwardTrough` is shadow-log-only, so only the peak half ever reached an operator**); PP2 adds the DISPLAY-ONLY `patient` field (`{bidTxt, askTxt, net}`, built from the new `extra.asymEst`/`extra.asymFill` inputs and null without both) — it is NOT a rev3 reversal: rev3 bars the deep bid from `estBuy` because that is an expected-price number, and a render field is not one, so `estBuy`/`estSell`/`estNet` are untouched; re-exports the `EST_REACH_SAT_FRAC`/`EST_BLEND_EQUAL_WEIGHTS` constants + `SELL_TOP_MODELS` for the barrel); `js/estimators/sell-models/` = the PC3 sell-top model registry — `index.mjs` (`SELL_TOP_MODELS` keyed by name, `Object.freeze`d), `reach-fold.mjs` (the neutral fold — DEFAULT + always-on shadow, `defaultShadow:true`; owns the SELL-MODEL CONTRACT header + `EST_REACH_SAT_FRAC`/`EST_BLEND_EQUAL_WEIGHTS`). The PB4 `pressure.mjs` trial model was RETIRED + deleted 2026-08-30 (join-exit-ev.mjs's pre-registered criterion; git-revivable — a retired/unknown `sellModel` name degrades to reach-fold, never throws). A new sell-top variant (later `safe-quantile`, PLAN-REACH-CALIBRATION AC3) is a file + one registry line, NOT a boolean threading through `estimatePair`; `js/estimators/cells.mjs` = the render/shadow projections `EST_HEADERS`, `estPairCells`, `estConfLean`. **PP2 (PLAN-PATIENT-PAIR, 2026-08-22): the `beFloored` branch of `estPairCells` also names the PATIENT alternative** — `est.patient` is appended to the sell cell when its net is positive, so a "nothing to price above break-even" cell no longer contradicts the `◆ asym fill` footer two lines below it (the anchor: a row read −114.7k/u in the cell and +427k/u in the note, and the cell was taken as the verdict). The clause TEXT is `formatAsymFill`'s, rendered by the CALLER: that function lives in `pipeline/lib/render/emit.mjs` and `js/` never imports `pipeline/` (the browser would 404 — the `smoke` job's failure class), so the guard-aware price-vs-level wording arrives as text and is never reimplemented here. Every non-`beFloored` branch is byte-identical, proved by an 86,400-row corpus diff over 22 branch combinations rather than by inspection. **`pipeline/test/estimator-orientation.test.mjs` (0.74.9, 8 cases) pins the LIVE-PAIR ORIENTATION for every caller that hand-builds a row**: it reads the definition out of `computeQuote` by CALLING it, asserts the DIRECTION of the damage a swap does (estBuy up, break-even up, a manufactured `beFloored`), and pins the two sites that had it backwards separately — `read-window-range.mjs`’s synthetic row by source scan (its block does live fetches and is not unit-callable) and pair.mjs’s own `fwdCtx` by delegation against a correctly-oriented `driftExitFrom`. **Cases 1/5/6/8 are mutation-verified RED against the mutant they name; cases 2/3/4/7 are NOT and each says so on its own line** — a blanket "every case verified" claim was made here and was false. Deleting both ordering clamps outright leaves seven of the eight green (only case 5 holds them), and case 4 is unrepairable: reach-fold's top reference is `max(optSell, quickSell)`, so its proposal already clears `qs` and the sell floor never binds under this model. `pipeline/test/patient-cell.test.mjs` pins the branch — eight cases, each mutation-verified RED against a named mutant (the `beFloored` guard, the `net > 0` leg, the honesty tail, an invent-the-wording mutant, and a rev3-reversal mutant that folds the deep bid into `estBuy`). families↔reach is a runtime function-reference cycle (ESM-safe). The description below is the full doctrine, unchanged.**) P6b — the PURE per-thesis P(fill)+TTF estimators +
    the `rankScore` composite that REPLACED expGpDay as the displayed/graded metric (Ben 2026-07-09:
    "gp/d is out"). **G5 (PLAN-GRADE-REWORK): `rankScore`'s TTF term SATURATES — `net×P / (days + TTF_SAT_DAYS)`,
    monotone-decreasing in TTF but BOUNDED as TTF→0, so a near-zero TTF can't unboundedly inflate the rank;
    the old `TTF_FLOOR_DAYS` divide-by-tiny floor is retired.** Families keyed by a spec's `estimator` field — `intraday` (band/scalp: P(fill) from
    band-depth / a real windowread reach when fetched, TTF from volume velocity), `churn` (Step 6,
    decision A — reuses intraday P(fill)/TTF but ranks the LAP via `churnLapUnits` = min(limit, feasible
    depth), so estimateRank multiplies net × lapUnits: on buy-limit-cycle commodities we always max the
    limit), `value` (P(fill)=floor-proximity, TTF=trough→recovery prior), and `rising` (regime/forecast
    horizon — retained but no shipped spec uses it since the rising flip-niche was deleted, Steps 3+4);
    each estimate is `{value,n,basis}` so the honesty travels with the number. `quotedPair(spec,row)`
    is the ONE price pair the thesis posts (the price-basis principle); `estimateRank(spec,row,extra)`
    bundles pair/net/pFill/ttf/rank (Proposal A two-leg P via `askReachFactor` — SKIPPED for
    `fillShape:'symmetric'` specs, the PART II churn exemption, **placement-bounded since EF1(b)
    (PLAN-ESTIMATOR-FIDELITY): the skip holds only while `extra.askPlacement ≤ MIRAGE_PLACEMENT` (0.85,
    moved here from the screen's digest) or no read — `symmetricExemptionHolds`; an above-the-daily-high-
    distribution churn ask takes the standard discount and the result carries `exemptionBounded`. EF1 also
    added `pLegs` (the entry/askF split behind the leg-labeled console P) and `repriced` (the dead-bid
    repriced-entry alternative, `DEADBID_PFILL_FLOOR` 0.10 n≈0 — a labeled alternative, never the headline
    rank). Callers passing no `askPlacement` (quote/watch/app Finder/amplitude) are byte-identical**);
    `asymEstimate(spec,row,asymPair)`
    (PART II PLAN-GRADE-REACH — the asymmetric deep-buy/reliable-sell estimate: rank = net × P_ask ÷ TTF,
    P_bid is annotation-only, ordering guards; feeds the inform line + the `asym` ledger shadow field +
    `screen-flip-niches.mjs --asym`); `estimatePair(spec,row,extra,{nudge,sellModel})` + `entryDoctrine`/`estPairCells`/`estConfLean`/
    `EST_HEADERS` (PLAN-OUTPUT-TABLE 2026-07-13 + REVISIONS — the RECONCILIATION estimator behind the
    console-default `Est. buy`/`Est. sell` columns: `Est. buy` is STRATEGY-AWARE (`entryDoctrine(spec)` off
    the existing falling/priceBasis fields — scalp near-live · value trough · **band + churn both price the
    band low** (PLAN-ESTIMATOR-POSTURE AC1 un-folded band, AC6 un-folded churn — the retired `'reach-fold'`
    entry doctrine now has NO producer; the deleted buy-fold branch left every non-scalp doctrine emitting
    the same `ob` anchor); the asym DEEP bid is never folded in — rev3); `Est. sell` anchors to a declared
    `hold-thesis.json` exit ONLY on a HELD lot (FIX 1 — an open lot in positions.json; the discovery screen
    never anchors), else the reach-folded band top + diurnal/asym blend — **churn EXEMPT** (AC5: a
    `foldExempt:'symmetric'` marker forces the sell fold factor to 1 so churn's Est. sell/buy are the
    unfolded band-edge prices, its reach caution token suppressed; the fold surfaces instead as a
    validation datapoint in `read-window-range.mjs`, AC8); confidence is the RECENT-3 reach
    (`recencySplit`, the fold basis) with the full window shown on divergence — rev1; ⚓ nudge, BE-floored;
    `--raw` restores Quick/Optimistic; consumed by `screen-flip-niches.mjs`+`quote-items.mjs` stdout only — never the
    `screen.json` publish cells). ALL constants are NAMED PLACEHOLDERS, n≈0 — retrojoin.mjs is the
    calibrator. Consumed by `screen-flip-niches.mjs`+`rating.mjs` and **app-imported by `js/market.js`** (AP4,
    0.61.0 — the Finder desirability rank/grade; a behavior change to it now bumps APP_VERSION),
    `gatecandidates.mjs` (P1 — screen-flip-niches.mjs's PURE
    candidate-selection + survival doctrine, moved out of screen-flip-niches.mjs so it's node-importable +
    fixture-testable with synthetic data: the pre-fetch `gateCandidates` gate stack + the
    `risingPoolFloor` predicate (GC1's threshold-driven form, default `DEFAULT_THRESHOLDS`), the
    fetch-pool ranker `rankAndSlice` + `proxyDrift` + `softFactor` (+ `expUnits`) + the **rising reserve**
    (Steps 3+4 — front-loads the highest-proxy risers, the absorbed `rising` flip-niche mechanism) + the
    **F-B amplitude watchlist reserve** (2026-07-22 — `gateAmplitudeCandidates`'s `watchedIds` param lets a
    `watchlist.json` id bypass the `AMP_STAGE1_MIN_PCT` proxy floor, and `rankAndSlice`'s amplitude branch
    reserves it a guaranteed fetch slot below the `AMP_TOP_DEFAULT` cut, unbounded like the held reserve —
    the fix for fang/blowpipe/dragon boots never reaching the margin gate via a normal scan) and the
    **PP-R band-stack watchlist reserve** (`WATCH_RESERVE_DEFAULT`, `watchReserved(cand, admitted, limit)` —
    the same guarantee for every `gate:'band'` spec (band/churn/scalp), which had none: `watched` was never
    even stamped on a band candidate, so a watchlisted-but-unheld item ranking below the cutoff never reached
    a FLIP-NICHE TABLE — `runWatchlist` still quoted and graded it in its own always-shown section, so what
    was lost is the lane (partition, Path-A sort, validators, digest, per-flip-niche `screen.json` row), not
    the price.
    Does NOT cover `subFloorFallback`, which re-gates without `watchedIds` and so produces unmarked candidates. BOUNDED, unlike amplitude's — sized off the logged
    per-pass count of watchlist candidates that cleared the gate and were still excluded (mean 7.3, max 20
    over the 96 passes at the current `--top 90`; max 24 over the full history including the older top-40
    pool, which is the bound), NOT off the watchlist's 60 entries. Ranked by `expGpDay`, tagged `via:'watch'`,
    strictly additive, and shared with `pickFetchPool` so the two admission paths cannot drift; pinned by
    `pipeline/test/watch-reserve.test.mjs`, every case mutation-verified RED against a named mutant), and the
    extracted post-fetch `surviveMode(mode,row,phase,opts)` — falling doctrine/`--phase-rescue`/the
    scalp falling-confirm (+ a vestigial rising-confirm)/overnight-posture, returning
    `{keep,discardReason,rescued}` that maps 1:1 onto renderMode's `disc` counters. **P5**:
    `surviveMode` reads the PER-SPEC `spec.falling` (band/churn keep `exclude`; scalp `accept`s AND
    requires fallers), and `gateCandidates` routes a `gate:'value'` spec to `gateValueCandidates` (the
    term-structure value gate off `ctx.daily` + `js/valuescreen.mjs`) with `rankAndSlice` hard-top-N'ing
    the value pool by `valueScore`). **RF2 (PLAN-REVERSE-FLIP, 2026-07-25)**: `gateCandidates` routes a
    `gate:'reverse'` spec to `gateReverseFlipCandidates(pool, ctxById, t)` — the PURE + total owned-item gate.
    Unlike every other gate it does NOT iterate the v24 fetch universe: its population is the caller-assembled
    OWNED-item pool (`owned-items.json` `classification:'keep'` ∪ `hold-thesis.json` `reverseFlip:true` — Ruling
    §8: the keep set IS the pool), taken off `ctx.reversePool`/`ctx.reverseCtxById`, and it applies RF1's
    `reverseFlipGate` per candidate, returning EVERY entry annotated with its `gate` (decision/reasons/regime/edge)
    for the renderer to split surfaced-from-rejected (an empty pool → `[]`, never a throw). It's a SEPARATE branch
    from the standard fetch pipeline (`screen-flip-niches.mjs`'s `runReverseMode`), so the replay goldens are
    untouched — provable zero-ripple. **PLAN-FETCH-POOL-SCALING (2026-07-24)**: adds `VALUE_RESERVE_DEFAULT`
    (the value flip-niche's own fetch-pool reserve — `rankAndSlice`'s value branch now PREPENDS the highest
    cycle-amplitude-% (`valueRanges.afterTaxAmpPct`) of the excluded remainder, tagged `via:'reserve'`,
    mirroring the thin/rising/watch reserves; closes finding #7) and `scaleSlots(base,{capital,max})` — the
    sub-linear (sqrt), hard-capped capital-scaling curve for the pool sizes (`CAP_REF`/`POOL_SCALE` + per-pool
    `*_MAX`); a strict no-op at/below `CAP_REF` (100m = the no-anchor `VALUE_CAPITAL` fallback) so a default
    run is byte-identical. All PLACEHOLDER n≈0), `replay.mjs` (P1 — the
    snapshot-replay acceptance ENGINE: `buildSnapshot()` expands five synthetic ARCHETYPES into a full
    raw market snapshot (`coffer-replay-snapshot/1`, a documented superset of D0's archive fixture —
    it also carries v24/band/latest/timeseries/daily so the whole funnel runs offline) anchored to a
    fixed `ANCHOR_TS`; `runReplay(snapshot,opts)` drives the WHOLE per-flip-niche funnel — `gateCandidates`
    → `rankAndSlice` → `computeQuote`/`phase` → `surviveMode` — and returns the per-flip-niche stage
    outputs (`gated`/`ranked`/`survivors`/`kept`/`dropped`) the golden pins. Pure/offline, no live API,
    no real SQLite), `suggestlog.mjs` (shared `suggestions.jsonl` appender + SR1
    rotation: `logSuggestions` rolls completed months into `pipeline/suggestions-archive/suggestions-YYYY-MM.jsonl`
    on append via `rotateLedger` — no-row-loss archive-then-truncate, idempotent — and `readSuggestionLines`
    reunites active+archives for full-history readers; YS2 `suggestionEntry` also lean-includes the
    forward prediction fields — `posture` and the plumbing for `tripwire`/`fillWindowHrs`/`thesis` (a predicted
    `velocityClass` was accepted until 2026-08-10 and removed as dead — no caller ever supplied it, so it was
    absent on all 15,660 logged rows; the MEASURED `velocityClass` in `velocity.mjs` is unaffected) —
    written only when a caller honestly supplies them, so legacy rows stay byte-identical; P2 also
    lean-includes a `validators` flag list; SF-3's `classAndSource(row,id,warmBulkMap)` picks the logged
    liquidity `class` + the lean `volSrc` (`bulk`|`peritem`) tag, converging quote on screen's bulk
    `/24h` snapshot when it's warm), `version.mjs` (PV — the ONE `PIPELINE_VERSION` const, stamped
    into `screen.json` (`pipeline` field) + `positions.json` so the app can display the pipeline
    version beside APP_VERSION; independent bump track, launched at 1.0.0 with the app parity milestone),
    `retrojoin.mjs` (P6a — the PURE, fixture-tested join
    core behind `pipeline/commands/report-retro.mjs`: `retroJoin(suggestions, fillsEvents)` classifies each
    suggestion row's forward outcome (filled / filled-worse / not-taken), measures suggestion→fill
    latency + the FIFO-matched round-trip (realized net / hold time, reusing reconstruct.mjs's
    helpers — never re-implemented), with a NEAREST-PRIOR one-fill-one-suggestion dedup rule; and
    `aggregateOutcomes(rows)` groups per flip-niche + per path with n on every field. NAMED-placeholder
    per-mode horizons; no fs/fetch — caller feeds parsed rows). **`windowread.mjs` MOVED to `js/`** (P2 — see the `js/`
    inventory above; consumed here by `read-window-range.mjs`/`watch-positions.mjs`),
    `watchstate.mjs` (V1/V4/V7 — PURE cross-pass temporal memory for the watch loop: `computeDeltas`/
    `advanceState` compute Δ instabuy, mom transitions, `passesUnderwater`/`passesBelowSupport` counters
    (display), the `underwaterSince`/`belowSupportSince`/`breakdownSince` streak timestamps, and band-top
    drift, with a reset policy on identity change / `STALE_GAP_MS`; plus the `convictionGate()` — the pure
    arm-then-confirm ALERT-escalation decision, now **TIME-based (V7, `ALERT_PERSIST_MS`)** so alert
    sensitivity is independent of loop cadence (Gate-2 breakdown CUT exempt/immediate; Gate-D
    CUT-CANDIDATE, structural break, AND `LIST-TO-CLEAR` gated on elapsed persistence). **P4b** adds
    `pathPersistence()` — the SAME arm-then-confirm discipline applied to PATH DOMINANCE: a dominance
    flip must beat the incumbent by `PATH_HYSTERESIS_MARGIN` and hold for `PATH_PERSIST_MS` (both
    named placeholders) before the persisted `currentPath` changes; a flip-back disarms, so flapping
    weights never whiplash the headline path. State entries grow the ADDITIVE `currentPath`/
    `pathArmedKey`/`pathArmedSince`/`enteredUnder` fields (legacy entries stay byte-identical —
    fixture-pinned in `pathpersist.test.mjs`). **VN-1** adds `verdictPersistence()`/`verdictSeverity`
    (`VERDICT_PERSIST_MS` placeholder) — the same arm-then-confirm discipline applied to the
    DISPLAYED verdict label: escalations (severity 2+) must persist before the rendered label
    changes, calmer candidates adopt immediately, the Gate-2 breakdown CUT bypasses the timer, and
    a NO-READ against an incumbent demotes to an `unreliableThisPass` note; ADDITIVE state fields
    `displayVerdict`/`verdictArmedKey`/`verdictArmedSince` (pinned in `verdictpersist.test.mjs`).
    Thin `loadState`/`saveState` are the only fs surface — the raw `momVerdict` untouched), `levels.mjs`
    (V2 — PURE `structuralSupport`/`cutTrigger`: recent higher-low support + a δ-below cut-trigger
    tripwire off the per-day lows watch-positions.mjs already fetches — OUTPUT-ONLY context, no verdict),
    `emit.mjs` (V5 — PURE `heldNoteBlock`/`heldListAt`: the watch loop's stable, consistently-ordered
    per-HELD-lot note block — `verdict · conviction · Δ · tripwire · recovery-read (V6) · path (P4b) ·
    sell/list-at (+ break-even) · fill-progress`, with the sell line GUARANTEED on every held lot;
    plus `reachRead` (rendered after the margin-budget line) — the list-at level's movement read, built
    from `formatReachMargin` + `askReachDecayNote`. `formatReachMargin(rm)` is the ONE home for the
    COMPACT `askExitRead().ask.reachMargin` clause, shared by `quote-items.mjs`'s windowExit note and
    `watch-positions.mjs`'s held block; `read-window-range.mjs` keeps the VERBOSE per-day form + the
    composite price-to-sell-EARLY trigger, deliberately not folded in. Both surfaces thread `profile` +
    `live` into `askExitRead` (watch reads the profile off `diurnalTimedLap`'s `.profile`, with the
    same stale-live guard quote builds), so the clause — pace read included — is at parity; the one
    remaining content difference is the SEPARATE 5m-grain line (watch passes `stats5m: null`, honestly). **Reading the clause: `trend` is an OLS fit over all N recent days while
    `cushionFrom→cushionTo` are the RAW first and last of them, so the label and the pair answer
    different questions and can disagree. It is NOT robust to a volatile end-day — OLS gives endpoints
    maximum leverage (`plans/PLAN-SIGNAL-RECENCY.md` retracted that claim; do not reintroduce it).**
    orders/formats already-computed pieces, decides nothing — output-format-only; PLAN-DIURNAL-TIMING
    DT2 adds `formatTimedLap(lap, {fmt})` here too — the ONE shared renderer for a `js/windowread.mjs`
    `diurnalTimedLap` result, SUPERSEDING the old per-call-site diurnal text so `screen-flip-niches.mjs`
    (DT2, every flip-niche survivor) and `quote-items.mjs`'s bare-quote path (DT3) render byte-identical
    diurnal notes off one definition — same `diurnal` NOTE_KIND/sigil, richer text. **DT4
    (2026-08-10) changed what varies:** every row now renders BID/ASK LEVELS + timed/same-hour nets +
    range + reach + base; only the HOURS are gated, on `windowReliability`'s split-half r (`lap.reliable`
    — true ⇒ the dip/peak window spans, the hold horizon, any secondary window and a closing "hours
    MAY repeat most days"; false ⇒ "levels only — no reliable hours"; null ⇒ "levels only — hours
    unverified"). This REPLACED a `lap.clean` branch whose `false` arm printed `range-churn — no timing
    edge` and dropped the LEVELS too, on ~97% of items — `clean` was measured not to discriminate
    (CHANGELOG 0.72.0). All shapes append a liquidity/tranche segment + the §4 tranche-ceiling
    caveat. PLAN-MULTI-PEAK-WINDOWS (2026-07-23) extends it to also append a trailing `also ASK …/also BID …
    — second elevated/depressed window (n≈0, inform)` clause per side when the lap carries an
    `askReaches[1]`/`bidReaches[1]` (a SECOND prominent diurnal window) — both ride the SAME joined line
    (one-line-per-item rule), no new NOTE_KIND. Returns null (nothing printed) on a degraded/unpriceable lap — §7's softened contract: every
    survivor's lap is COMPUTED, only a row with something to say PRINTS. DT3 also swaps
    `watch-positions.mjs`'s two direct `hourProfile`+`deriveDiurnalRange` call sites (the shadow-log
    bid/ask co-log, the `diurnalAsk` cycle-fallback exit) for `diurnalTimedLap` — those are VALUE
    consumers, not note-render sites, so only the computation moved, not the output shape).
    **`asymClassRateNote()` + `ASYM_RT_24H_PCT` / `ASYM_RT_24H_BIG_PCT` / `ASYM_MEASURED_ROWS` /
    `ASYM_MEASURED_ITEMS`** (PLAN-PATIENT-PAIR §7, 2026-08-24) — the ONE-TIME class-rate FOOTER that rides
    under the per-row clauses above. `formatAsymFill`'s counts are in-sample tallies, which each row says;
    what no row could say is how often the shape actually completes. `join-asym-outcomes.mjs` measured it:
    round trip **~4.3%** within 24h, **~1.5%** big-ticket. It is a FUNCTION, not a template literal, so no
    call site can restate the wording, and it is emitted ONCE per surface — `screen-flip-niches.mjs` pushes
    it into `footerLines` gated on `asymNotes.length`, `quote-items.mjs`'s `buildQuoteReport` appends it to a
    LOCAL copy of `notes` gated on any `kind:'asym'` item (non-mutating; the caller's array is untouched).
    **Footer, never per-row, on purpose**: it is a class rate over ~770 items and attaching it to a row
    would read as that row's fill probability — the exact error the row wording works to avoid. The n's
    RENDER ROUNDED (`~39k rows / ~770 items`) because the sample grows with every scan and an exact tally
    in prose is stale by morning; `lint-docs`' constant-drift check pins doc↔source and cannot see
    source↔reality, so re-derive with the script rather than hand-editing to a remembered number.
    **`--positions` gets neither this footer nor the patient clause** — it pushes no `kind:'asym'` note and
    renders no `Est.` columns; two independent reasons, see PLAN.md's folded PLAN-PATIENT-PAIR open item 1.
    Pinned by `pipeline/test/emit.test.mjs` (2 cases; the interpolation pin is a SOURCE scan, because
    asserting the rendered text cannot distinguish an interpolated constant from its pasted value — the
    first version of that case claimed to catch exactly that mutant and was green against it) and by
    `pipeline/test/render.test.mjs`'s byte-exact golden, which pins that the footer is appended once, last,
    with the `◆` sigil, deriving the expected line from this function rather than pasting it.

    **`formatAsymFill(ae, ap, {fmt})` (2026-08-12)** is the ONE home for the `◆ asym fill` clause pair —
    `quote-items.mjs` and `screen-flip-niches.mjs` both emit that line and had written the wording twice.
    Returns `{bidTxt, askTxt}`; it exists so a reach COUNT is never printed against a price it was not
    measured at. `asymEstimate`'s ordering guards can move bid/ask off the quantile levels `pAsk`/`pBid`
    were counted at, so when a guard binds the clause names the quoted price and the measured level
    separately — `ask 220,200 (= live instabuy, above the 218,500 level that printed 12/14d)` — and makes
    **no execution claim**: an earlier draft said "clears now", which `js/quotecore.js`'s own header
    contradicts (n=4 real round trips, the quick legs reversed against the true fill order). Whether `pAsk`
    is a floor or a mild overstatement at the guarded price is UNRESOLVED — on a bound row the adjacent
    `⊙ reach/placement` note prints reach at that price on the same basis and comes in below `pAsk`, so
    this clause states only what was measured and leaves the reader the neighbouring number. Counts are
    past tense (in-sample tallies, never forward rates) and use `pAsk`'s OWN denominator via `asymPair`'s
    `nAsk`/`nBid` — `nDays` includes days with no print, which rendered 10/12 as "12/14d". `fmtP`, not
    `fmt`: bucketed rendering collapsed a sub-bucket guard gap into two identical prices. Null-degrades.
    **DT6** (2026-07-23) adds `formatBasePosition(bp)` — a one-liner over `js/termstructure.mjs`
    `basePosition()`'s already-computed `{pct,days,n,label}`: `"base pXX of the <N>d range · <label>"`,
    or null on a degraded read (never a fabricated percentile). `screen-flip-niches.mjs` calls it for
    every band/churn/amplitude survivor off the SAME `termStructure()` result already computed for
    `floorValidator`),
    `recovery.mjs` (V6 — PURE `recoveryRead`/`recoveryLine`/`recoveryTrigger`: the ADVISORY
    recover-vs-drop LEAN that COMPOSES momVerdict's existing signals (diurnal · regime/phase ·
    underwater-persistence · vs structural support) + the trigger gating that surfaces it only on a
    non-clean position — decides NOTHING, never a verdict/alert input; a `spike` caps confidence),
    `freed-capital.mjs` (V6 Companion — PURE `freedCapital`: detects capital freed by a booked SELL between
    passes off V1's prior-pass state and prompts a redeploy scan ≥ `FREED_CAPITAL_SCAN_GP` — surface-
    only, never auto-places/runs the scan; anchor-free, no startup/stale-gap misfire),
    `velocity.mjs` (#3/YS1 — PURE `velocityClass(holdTimeSec)` → fast-cycler/mid/slow-hold/n·a off a
    MEASURED round-trip hold; placeholder thresholds), `capital-utilization.mjs` (#3/YV1 — PURE
    `bookUtilization` (working-held vs parked-bid capital split) + `parkedStats` (historical
    "how long bids sat" + velocity mix over outcomes campaigns — the mix counts SELL campaigns only,
    the round-trip-capable side, since a buy leg has no `holdTimeSec` and can never carry a class;
    counting both sides padded `n/a` with 438 unclassifiable buy legs) + `totalCapital` (committed +
    idle cash → the WHOLE-pool idle-vs-working split, null-safe when cash is unknown; the idle
    figure it's fed is now the DERIVED `availableCash` from `derive-cash-tiers.mjs`, not a stated snapshot);
    output-only, never a verdict input),
    `cash-anchor.mjs` (impure fs sibling — `readCash`/`writeCash`/`clearCash` over the gitignored
    `.capital-state.json`; now the ANCHOR store rather than the answer — kept out of pure
    `capital-utilization.mjs`),
    `derive-cash-tiers.mjs` (PLAN-CASH-TRACKING — PURE `deriveCash(events, anchor, liveOffers)` +
    `restingBuyEscrow` deriving idle cash from the fills-log flow (Σ sell net proceeds − Σ buys since the
    anchor; sell proceeds via `reconstruct.mjs`'s worthNet-aware `sellNetEach`, PLAN-SALE-LOG-TAX — a
    `.json`-era sell's `spent` is already net and is no longer taxed a second time) minus
    LIVE-offers.json resting-bid escrow, so the balance is computed not re-stated; the
    INJECTION DETECTOR raises the anchor when resting bids exceed the tracked balance; `loadDerivedCash`
    is the impure loader (fills.json + offers.json + `cashstate` anchor). Pinned by `derive-cash-tiers.test.mjs`),
    `book-model.mjs` (PLAN-DASHBOARD — PURE aggregation layer for `/book`'s `read-book.mjs`: `buildBook({
    groups, offers, cash, marks, sizer })` folds open-lot groups + the offers snapshot + the derived-cash
    record + a caller-built age-labelled marks map into the slots / capital / per-lot P&L views, and
    `sizeTranche` computes the min(buy-limit, clearability, capital) sizer + net-if-cycled. NO fetch/fs;
    delegates the capital split to `capital-utilization.mjs` (never re-derived — pinned byte-identical to
    watch's SUMMARY footer) and break-even to `js/quotecore.js`. RF4 (2026-07-25) adds the PURE
    `buildReverseFlipPending(state, {marks, infoById, now, fmt, fmtP})` render block for the "Reverse-flip
    pending" section (awaiting-rebuy/rebuy-armed cycles → rendered rows with sold/BE-rebuy/live/days-pending
    + `js/reverseflip.mjs` cycle notes; `[]` on an empty/all-holding store). Pinned by `book-model.test.mjs`
    + `reverseflip-surfacing.test.mjs`),
    `staleexit.mjs` (Proposal C 2026-07-12 — PURE `staleExitRead({ts1h, exitLevel})`: scores a DECLARED
    hold-thesis exit against the recent full-day reach history via `js/windowread.mjs`'s own
    `windowStats`/`recencySplit`/`recentQuant` (min-sample floor imported from `reachValidator` — reuse,
    never re-derived). Stale = printed on < `STALE_EXIT_RECENT_FRAC` (2/3, PLACEHOLDER n≈0) of the recent
    nights; names the recent ~50% reachable high instead. Consumed by `quote-items.mjs --positions` as an
    INFORM-ONLY note — never a verdict/gate/price input; degrades to null (silent) on thin history.
    Pinned by `staleexit.test.mjs`),
    `statetransition.mjs` (YP2 #2 — PURE `stateTransition(phase())`: flags a basing faller / a spike on
    rising-vs-falling lows for the screen's "watch closely" list; descriptive, never a buy signal),
    `velocitytag.mjs` (Build 2 — PURE `buildVelocityIndex`/`velocityTag` over the gitignored
    outcomes.json campaigns: per-item dominant velocity + median time-to-first-fill + % of bids that
    never filled, for screen-flip-niches.mjs's stdout velocity footnote; a label off history, never a rate/gate),
    `guideanchor.mjs` (YP1 #2 — PURE guide re-anchor model off `.guide-history.jsonl`: modal update
    hour + median step, HONESTY-GATED below `GUIDE_MIN_UPDATES` (ships silent today — the wild history
    is all baselines); advisory line on quote/watch, never a verdict input),
    `sessionthesis.mjs` (YT1 #4 — PURE session-thesis state model: `loadThesis`/`saveThesis`/`upsert`/
    `clear`/`prune`/`thesisLine`, the intent-per-lane store watch-positions.mjs reads read-only; persists like
    watchstate),
    `holdthesis.mjs` (TG1 — PURE declared-hold-thesis store: `loadHoldThesis`/`saveHoldThesis`/
    `thesisFor`/`upsertThesis`/`clearThesis`/`pruneHoldThesis` over the TRACKED root `hold-thesis.json`
    array of `{id,exitPrice,tripwire,horizon,path,enteredUnder,ts}` — **P4a** grew the additive optional
    `path`/`enteredUnder` (the js/held-item-strategy.mjs entry-path declaration; LEGACY entries without them stay
    fully valid, both default null); watch-positions.mjs reads it read-only and feeds it to `convictionGate` to
    SILENCE the expected-underwater headline while live holds above the declared tripwire — never
    touches `momVerdict`; fixture-pinned `holdthesis.test.mjs`; RF0 added the additive optional
    `reverseFlip:true` Case-A marker on an entry — presence-of-true, written only when set, preserved
    across upserts, legacy entries unaffected),
    `ownedledger.mjs` (RF0, PLAN-REVERSE-FLIP — PURE owned-item registry store + the owned-qty fold over
    `owned-items.json`: `loadOwned`/`saveOwned`/`ownedFor`/`upsertOwnedItem`/`removePending`, the
    `computeOwnedQty(item,fillsEvents)` fold that tracks owned qty via shared `collapseOffers` — seed
    ± buys/sells over raw fills.json, ZERO reverse-flip-specific logic so a reverse-flip sell drives qty
    to 0 and the rebuy brings it back like any trade — and `foldPendingBuys` (`@provisional-api`, the
    `BIG_TICKET_GP` + qty-ceiling capture-on-buy filter consumed by sync-fills at RF2); no gate/screen
    logic (that's RF1); fixture-pinned `ownedledger.test.mjs`),
    `reverseflipstate.mjs` (RF0, PLAN-REVERSE-FLIP — PURE declared reverse-flip CYCLE store mirroring
    holdthesis.mjs: `loadReverseFlip`/`saveReverseFlip`/`reverseFlipFor`/`upsertReverseFlip`/
    `clearReverseFlip`/`pruneReverseFlip` over the TRACKED root `reverse-flip-state.json`; `state` ∈
    `holding`/`awaiting-rebuy`/`rebuy-armed`; upsert PRESERVES unset fields so `advance` changes only
    state+bid; 30-day TTL; fixture-pinned `reverseflipstate.test.mjs`),
    `item-context.mjs` (P0 — the ITEM CONTEXT CHAIN + the ONE shared held-verdict renderer, the home that ENDS
    the quote-vs-watch verdict fork: staged PURE enrichers (identity→market→history→intraday→position)
    build an `ItemContext`; `renderHeldVerdict(ctx,{mode})` emits the compact (quote `--positions`) or
    verbose (watch heldAction) form off ONE `heldMomVerdict`, byte-identical to the pre-P0 inline
    functions, so the two surfaces can't disagree. **P4b** adds `pathsStage` + `renderPathLine` (the
    shared dominant-path line, ADDITIVE watch-state fields); **COD-4** adds `staleBookBanner` (the
    positions.json-age warning both surfaces now share); **VN-1** adds `rawHeldToken` (the one raw
    held display token, formerly `watch-positions.mjs`'s heldVerdict) + `heldDisplay` (the persistence-gated display
    read — token/label/mvDisplay off `verdictPersistence`; computed in `positionStage`, consumed by
    `renderHeldVerdict` so the table cell and the note render ONE label; byte-identical when nothing
    diverges); **VN-2** the thesis render frame (a declared plan above its tripwire renders
    `HOLD — per thesis: exit <declared/diurnal> · abort < <tripwire>`); **VN-3** `parkedDeadband` +
    the `PARKED — at break-even (±X)` dead-band state (`BE_DEADBAND_BAND_FRAC`/`BE_DEADBAND_MIN_PCT`
    placeholders) and one-decimal path-menu weights in `renderPathLine` (F4 — the ±0.12 placeholder
    steps stop reading as instability). No fetch/fs — every stage is node-importable +
    fixture-pinned in `item-context.test.mjs`), `warm-term-structure.mjs` (COD-4 — `richFrom1h`/
    `trajectoryFrom1h`: aggregate a fetched 1h /timeseries into a WARM multi-week term structure so
    reach/trajectory FIRE while the `loadDaily` archive is still young; EXTRACTED from screen-flip-niches.mjs so
    `quote-items.mjs`'s budgeted-`ts1h` read shares the identical aggregation — one home, no drift), `range-position.mjs` (YF1 — reconstruct MARKET STATE AS OF a past timestamp: the PURE `deriveState`
    composes `loadHistBands` + `loadHistDaily` into the SHIPPED `regimeDrift`/`regimeLabel`/`phase`
    classifiers → band-percentile + regime + phase at a fill/placement time, with `reconstructed:false`
    honesty when the history is gone; the shared seam #1(a)'s every-fill classification + #2's
    state-transition scan both read — no market math re-implemented),
    `hourly-lmh.mjs` (PLAN-DIURNAL-HOURLY — the PURE `hourlyLMH(series1h,{days})` behind
    `read-window-range.mjs --hourly`: per-LOCAL-hour 0–23 LOW/MID/HIGH off an already-fetched 1h series
    — a 7d-avg median block + the last N dates broken out; the raw diurnal detail the dip/peak summary
    hides. PLUS (PLAN-DIURNAL-TRIAGE DT3) the sibling PURE `askReachDecay(series1h,{days,ask})` — for a
    candidate ask, the per-day RATE of hours whose HIGH reached it and whether that rate is sliding
    (judged on the RATE, so a partial newest day can't false-trigger); both functions share ONE internal
    bucketing helper. Consumers: `read-window-range.mjs --hourly` (the summary line via
    `js/windowread.mjs`'s `askReachDecayNote`), `quote-items.mjs` (an `askReachDecay` note on a bare quote
    + held/watched positions), `screen-flip-niches.mjs --digest` (a bounded top-X enrichment), `--mode reverse`'s thin rows, and
    `watch-positions.mjs` (the held-lot `reachRead` line). **This module's header carries the DON'T-REBUILD TOMBSTONE for
    `hourlyDrift`** — the per-hour least-squares slope + uniform/split synthesis deleted 2026-08-09 after
    measuring 276.7bp vs 197.8bp median per-item MAE against predict-no-change, winning on 6 of 380 items,
    and 49.7% direction; no window length fixes it, and `THIN_DRIFT_DAYS=7` died with it. Read the
    tombstone before reintroducing any per-hour trend read. Inform-only n≈0, never gates; fixture-tested
    in `pipeline/test/hourly-lmh.test.mjs`). RF2/RF4's owned-item surfacing is unchanged apart from the
    dropped drift note — the decay read rides `--mode reverse`'s thin rows (RF6)
    and each declared in-flight cycle surfaced into `/schedule`·`/book`·`/positions` (RF4),
    `probes.mjs` (PM1 — the probe-module LOADER + stage-keyed runner: auto-discovers
    `pipeline/probes/*.mjs`, groups by stage (`observe`/`price`/`gate`), and `runProbes(row,surface,ctx)`
    returns the fired display annotations. **Presence = enabled** (delete the file to disable). The
    **empty-passthrough guarantee** — no module present or none fire ⇒ `[]` ⇒ nothing appends ⇒
    byte-identical output — is the removability contract. `collectNeeds` exposes the multi-item
    `needs(row,ctx)` sibling-id declaration (decant). NO probe of any stage feeds a
    verdict/gate/rating/reconstruction — observe probes touch no number, price probes touch only the
    advisory recommendation. `logFirings(fired,meta)` (PM2) appends the fired annotations to
    `pipeline/probes/<module>.log` — called by each surface AFTER the PURE runProbes; failure-safe)
  - **Probe modules (`pipeline/probes/*.mjs`, PM1 — experimental per-item theory plug-ins):** each a
    pure `{name,version,theory,stage,surfaces,needs?,probe}` file, trial-and-keep-or-drop, surfaced in
    the stdout `Probes` column on screen/quote (never a verdict/gate/rating input). `dip.mjs`
    (`observe` — live instasell under the 24h avg low on a flat/rising non-decay reliable non-thin book
    ⇒ `⬇DIP -N%`, the migrated ex-`screen-flip-niches.mjs` prototype; owned ⇒ average-down framing for the watch
    follow-on), `froth.mjs` (`observe` — a spike/rising CLASSIFIER: rising/holding lows ⇒
    healthy-reprice, falling lows ⇒ knife, off `phase().lowSlope`), `anchor.mjs` (`price` — the
    round-number PRICE-NUDGE: a proposed ask just past a round wall ⇒ `⚓ ask X (under Y)`; proves the
    loader carries the `{price,reason}` shape), `decant.mjs` (`observe`, MULTI-ITEM — potion dose
    arbitrage: reads 1/2/3-dose sibling prices off the whole-market 24h map (`ctx.v24all`) and flags a
    lower dose whose per-4-dose cost beats the 4-dose; declares its siblings via `needs()`; screen-only,
    since the per-item quote surface has no whole-market map). The gitignored `pipeline/probes/<name>.log`
    firing log is now WIRED (PM2): `logFirings` appends one compact JSONL line per firing —
    `{ts,module,version,stage,surface,id,name,tag,price(price-stage),quickBuy,quickSell,guide,regimeLabel,phase}`
    — the hit/miss ledger the validate-before-promote loop scores later (SCORING is a later chunk).
  - `lint-skills.mjs` (P7 — a HEURISTIC linter over `SKILL_FILES`, which is now ALL NINE skills
    (book/schedule/ship joined 2026-07-26 once tagged), run in CI's
    cheap `checks` job + auto-discovered by `run-tests.mjs` via its test: every top-level `- **…**`
    rule-block must carry a backticked `code-pointer` OR an explicit `judgment:` tag; FAILs on
    untagged blocks and prints per-file + total counts so untagged-prose GROWTH is visible. **Its
    SCOPE is self-checking as of 2026-08-14** — `scopeDrift` compares the declared `SKILL_FILES`
    against `.claude/skills/` in BOTH directions and fails BEFORE linting, so a new skill can't be
    added and silently never linted, and a renamed one fails by name instead of a raw ENOENT. The
    declared array stays (it is the reviewable statement of intent, and `lint-plan-lifecycle.mjs`
    imports it) — but its old comment cited that non-gating report as the backstop, and nothing in
    CI had ever compared the list to disk. Exports `lintText`/`lintFile`/`scopeDrift`/`SKILL_FILES`
    for the tests, and `--root <dir>` retargets the run at a fixture tree so the TEST can drive main()
    itself — without it the only reachable assertion is that the helper computes the right lists, which a
    gate that IGNORES those lists still satisfies (the first version of its test passed with the failure
    branch stubbed to `if (false)`). Deliberately NOT a Markdown parser — a
    growth-visibility guard; the semantic dispositions live in `docs/SKILL-TRIAGE.md`),
  - `lint-docs.mjs` (DL1 — a STRUCTURAL, offline doc-drift linter run in CI's cheap `checks` job +
    auto-discovered via `lint-docs.test.mjs`; the CI-encoded half of process rule 8. THREE checks:
    (1) a maintained **DENYLIST** of superseded terms/commands × the operating docs they'd mislead
    (seeded: the deleted spread/rising flip-niches listed as live, an unqualified global falling-exclusion,
    and the removed per-flip-niche mode flags — see the `DENYLIST` table in the source for the exact patterns)
    — a ruling that deletes a concept adds a line, CI then catches every future doc
    that resurrects it; an `xfail` records a KNOWN live violation owned elsewhere (index.html's stale
    Scan-intro = PLAN-APP-PARITY AP1) so CI stays green while the finding stays reported; and
    (2) a **single-source / duplicate-phrase** check that flags a distinctive 14-word shingle appearing
    verbatim in >1 doc on the CLAUDE.md ⇆ README.md axis (the copy-not-move failure), with a `DUP_ALLOWLIST`
    for legit shared boilerplate + known pre-existing dups owned by DOC-2/DOC-3; and
    (3) a **constant-drift** check — the stale-NUMBER class a denylist structurally cannot see, since it
    only knows literals someone thought to add. Auto-discovers every SCREAMING_SNAKE numeric constant in
    `js/` + `pipeline/` (excluding `pipeline/test/`, whose fixtures set synthetic thresholds), reads its
    value from SOURCE (never a hand-maintained table, which would drift too), and compares it against
    every literal a governed doc writes ADJACENT to that name. Anchor: the 2026-08-08 `MIN_GPD`
    500k→250k move left the floor stale at 2× its value in eleven doc sites, found by human review
    rather than by CI. The matcher is an adjacency grammar whose glue carries NO LETTERS, and that one
    rule is what makes historical prose safe: "…, MEASURED 2026-08-08 — was 1.0" has words between, so
    the old number is never read as a claim about the current one. Three further structural rules —
    `A → B` is a transition record judged on B; a hyphen compound (`5m-grain`) is a unit label, not a
    value; a non-magnitude attached unit (`30s` against a `_MS` constant) is DECLINED rather than
    failed. A magnitude suffix is ambiguity-tolerant on purpose (`15m` reads as both 15 million and 15,
    so a gp constant and a minutes constant can share the notation without a false alarm). Name
    collisions are auto-skipped, `CONST_XFAIL` records a known live mismatch owned elsewhere, and the
    CLI prints the count of gloss sites actually compared so a matcher narrowed into a no-op is visible.
    Corpus split is the primary escape hatch: the DATED record (`CHANGELOG.md`, `docs/LORE.md`,
    `PLAN.md` + `plans/`, `pipeline/experiments/`) is EXCLUDED because restating a superseded value is
    its job. Known limit: a number stated in prose with no constant name attached is invisible to it —
    most of the eleven-site incident, still a human-review class. **MUST stay a
    denylist + structural checker — never a semantic/LLM checker** (the skill-lint honesty note applies
    verbatim: it catches recurrence of NAMED drift + novel COPY + a stale literal glossed onto a live
    name, NOT novel contradiction; the wave-start
    semantic drift scan stays necessary). Exports `DENYLIST`/`runDenylist`/`normalizeWords`/
    `findDuplicateShingles`/`runDuplicatePhrase`/`scanSourceConstants`/`findConstantDrift`/
    `runConstantDrift`/`constantCandidates` for the test),
  - `check-imports.mjs` (PLAN-VOL24 follow-up — TWO static binding guards run in the cheap `checks` job.
    **Part 1, import RESOLUTION:** STATICALLY parses each pipeline entrypoint's relative
    `import { … } from './x.mjs'` and verifies
    every named/default import exists in the target module's exports, dynamic-importing ONLY the pure lib
    targets (never the entrypoints — so no main()/fetch/git/argv side effect fires).
    **Part 2, UNBOUND CONSTANTS (2026-08-09):** the REVERSE direction — every SCREAMING_SNAKE name an
    entrypoint USES must be imported or declared. Part 1 is blind to this, and so are `node --check`
    (syntax-only) and the suite (no test executes the command bodies), which is how a `ReferenceError`
    shipped CI-green in `quote-items.mjs`. Narrow by design: that casing is the repo's constant
    convention, and requiring an underscore keeps verdict/prose tokens out. It delegates comment-stripping
    to `check-dead-exports.mjs`'s regex-aware `stripComments` and imports its `REGEX_PREV_OK` — ONE home
    for the division-vs-regex rule, because a second hand-rolled copy is exactly how this guard first
    shipped broken (no regex state ⇒ a single `.replace(/"/g, …)` opened a phantom string and silently
    blinded the scan to the rest of the file). Deliberately OVER-binds parameters, catch params, labels
    and class fields: a false positive is a mysterious CI failure on correct code, which is worse than a
    missed detection. **Scope EXTENDED 2026-08-10 (Ben-directed) to the ENTRYPOINTS ⋃ `js/**` ⋃ `pipeline/lib/**`** —
    still ~0.3s. The file/import/constant counts are DELETED rather than re-derived — they had drifted
    on every one of the three, and the tool prints the true values on every run. It previously scanned
    `pipeline/commands/*.mjs` ONLY, leaving the app and lib files unscanned with the gap recorded as
    "latent, not live" — and that latency is exactly how the 2026-08-09 `ReferenceError` shipped. `js/**` is the
    worst place to have it, since that is what the deployed page runs while the browser smoke never opens
    an item. The extension cost nothing: 0 violations measured across the newly-covered files BEFORE
    wiring, so it is pure lock-in of an already-clean state. Both halves were mutation-proved IN THE NEW
    SCOPE — an unbound constant injected into `js/windowread.mjs` (which `node --check` happily passes)
    and a bad import name in `js/trends.js` each fail the guard, and both restores were hash-verified.
    Enumerating the browser modules needs a dumb `document`/`window` Proxy shim, installed CLI-only and
    never when a test imports the module; it cannot mask a missing export, which fails at LINK time
    regardless of any shim.
    `unboundConstantsIn` is EXPORTED and pinned by `pipeline/test/check-imports-scanner.test.mjs`, which
    asserts each of the four shipped failure shapes individually — the CLI's aggregate ✓ proved nothing
    about *which* shapes it detects, which is how three broken drafts each passed their own check.) Closes the gap that let
    screen-flip-niches.mjs's missing `dayHighFrom5m` import ride onto main undetected — `node --check` is syntax-only, no
    test imports the entrypoints, smoke loads only the browser app. Fast/offline/deterministic; exits non-zero
    naming the offending entrypoint→module→symbol. **Entrypoints = every `pipeline/commands/*.mjs`, read from
    the directory** (PLAN-LIB-SUBDIRS chunk 0 — was a hardcoded list of 11, leaving ~19 commands statically
    unchecked; a new command is now covered automatically and never needs registering),
  - `check-dead-exports.mjs` (RC-A guard, 2026-07-14 — the INVERSE of import-check, run in the cheap `checks`
    job: a name-based, comment-stripped, deliberately CONSERVATIVE static scan of `js/` + `pipeline/` that
    fails if any export has NO non-test consumer — the recurring "kept-for-future / until-torn-out" vestigial
    pattern (its motivating case, `risingPoolFloor`, was removed by the same cleanup). An export exists solely
    for its test declares that inline: `// @test-only: <reason>` or `// @provisional-api: <reason>` (an intended-
    but-unwired API citing a tracking item) immediately above it — the acknowledgement travels with the code.
    Uses a character-scanner comment stripper (strings/templates/regexes preserved verbatim, so an identifier in
    a `${…}` interpolation still counts — the STAGES false-positive lesson). Pure helpers exported + pinned by
    `check-dead-exports.test.mjs`,
  - `check-forecast-guards.mjs` (2026-08-06, the Snape grass miss — a STRUCTURAL, denylist-style pin on
    `diurnalForecast`'s FAIL-OPEN refusals, run in the cheap `checks` job. `js/forecast.mjs` refuses to project
    an `unreliable-quote` / `post-shock-shape` (`ctx.phase` 'spike'|'decay') / `band-violation-live` shape — but
    `ctx.phase === 'spike'` is simply false when a caller omits `phase`, so a blind call yields an UNGUARDED
    projection that renders byte-identically to a guarded one. Scans `js/`, `pipeline/commands/`, `pipeline/lib/`
    (non-test; `js/forecast.mjs` itself exempt — it is where the guards live) and FAILS the build if any
    `diurnalForecast(`/`driftExitFrom(` call region does not carry `phase`, resolving ONE level so a
    prepared ctx (`...guardCtx`, or a bare `ctx` param built as `ctx: { … phase … }`) counts. Strips comment
    bodies offset-preservingly so a doc comment quoting a call shape can't trip it. Only `phase` is REQUIRED —
    `mom`/`reliable` aren't computed on every surface, and their absence is surfaced at runtime by the
    forecast's `guardsUnchecked` field rendering `⚠ guards unchecked: …` on the drift-adj clause instead.
    **SECOND RULE, `dead-phase-value` (0.71.8): the v1 guard above was ITSELF fail-open** — it asked only whether
    the WORD `phase` appeared in the argument region, and `phase: row.phase` contains it while evaluating to
    `undefined`, because `computeQuote` returns no `phase` field. Seven call sites shipped that way and the guard
    reported ✓ on all of them; one (`screen-flip-niches.mjs`'s amplitude lane) fed `amplitudeGate({driftMargin})`,
    a REAL gate. Rule 2 therefore checks the VALUE: it finds any `phase:` whose value reads `X.phase`
    (including inside a ternary, and inside a ctx built away from the call — BOTH shapes produced a false green in
    the first drafts, the second because a first-match lookup resolved `ctx` to an unrelated decoy object earlier
    in the same file), then duck-types `X` by the other properties the file reads off it against `computeQuote`'s
    REAL key set — obtained by CALLING computeQuote, never parsed or hardcoded, so the rule retires itself if a
    `phase` field is ever legitimately added. A throw while probing that shape EXITS NONZERO rather than skipping
    the rule. Produces/consumes nothing; exit 1 + a per-site report on violation)
  - `check-verdict-guards.mjs` (0.74.1, 2026-08-10 — the same fail-open class as the forecast guard, one function
    over. `momVerdict`'s 6th arg `lotCtx` carries Gate D's two V3 softenings (`buyTs` under `FRESH_HOURS` →
    `WATCH — fresh entry`; an own ask filling above the clear → `HOLD — ask filling`), and `lotCtx && lotCtx.x`
    is simply false when the caller omits it, so a blind call silently returns CUT-CANDIDATE with no error.
    `js/watch.js` (the app's Watch tab) and `trigger-alerts.mjs` (push alerts) both called it with 4 args while
    the lot's `buyTs` sat computed and unread on the line above — a red CUT badge on a minutes-old fill, verified
    live before the fix (same row + real 5m series: 4-arg → CUT-CANDIDATE, 6-arg fresh → WATCH — fresh entry).
    Scans `js/`, `pipeline/commands/`, `pipeline/lib/` (test dirs exempt — proving the degradation path REQUIRES
    a 5-arg call) and fails on (1) fewer than 6 args, (2) a 6th arg literally `undefined`/`null`, which reads
    identically to omitting it. The 5th (`now`) IS legitimately `undefined`. **Its own v1 was fail-open in a
    third distinct way:** the comment/string scrubber had no regex-literal case, so `js/watch.js`'s
    `.replace(/"/g, '&quot;')` opened a phantom string that blanked the REST OF THE FILE — the guard saw zero
    call sites there and reported ✓ over the very bug it was written for. Fixed by handling regex literals, and
    backstopped by `lostSites()`: any raw `momVerdict(` with arguments that the scan did not see fails the build,
    so the NEXT scrubber bug is loud instead of silent. Produces/consumes nothing; exit 1 + a per-site report)
  - `check-daemon-safety.mjs` (PLAN-DAEMON-SUBSYSTEM Hardening finding #1, the CI half approved for Phase 1 —
    a STRUCTURAL, DENYLIST-style zero-git guard run in the cheap `checks` job. **Scope is REGISTRY-DERIVED**
    (widened 2026-08-17): `pipeline/daemons/registry.mjs` + every `pipeline/daemons/*.mjs` (non-test) PLUS every
    `DAEMONS` entry's implementation, resolved `<name>.mjs` against `pipeline/daemons/` then `pipeline/commands/`;
    an unresolvable registered name is a HARD FAILURE so a rename cannot silently shrink coverage. It previously
    scanned only `readdirSync(pipeline/daemons)` while **3 of the 4 registered daemons (sync-fills, watch-log,
    dev-server) are implemented in `pipeline/commands/`** — it read a quarter of the fleet and reported a clean
    run, with `watch-log.mjs`'s static `import { regenerate, REPO_DIR } from './sync-fills.mjs'` (a `local:true`
    resident importing the git-writer module) green throughout. That import is in fact SAFE, and the guard now
    pins why rather than assuming it. FAILS the build if a daemon (1) IMPORTs sync-fills — narrowed for
    registered implementations OUTSIDE `pipeline/daemons/` to an allowlist of the zero-git bindings
    (`ZERO_GIT_EXPORTS` = `regenerate`, `REPO_DIR`), since watch-log legitimately reuses the rebuild core
    in-process, while a module inside `pipeline/daemons/` keeps the blanket ban; (2) SPAWN/EXECs a command
    naming `sync-fills` or the `git` binary via `exec`/`execSync`/`execFile`/`execFileSync`/`spawn`/`spawnSync`
    — **NOT a bare `--publish`**, which is spelled identically by two unrelated commands (`screen-flip-niches.mjs
    --publish` only rewrites the local `screen.json`; `dev-server.mjs` spawns exactly that, and a bare-flag
    denylist was only ever safe while dev-server sat outside scope); (3) marks the `GIT_WRITER` const
    `local:true`; or (4) — on `sync-fills.mjs` ITSELF, where rules 1–2 cannot apply because it IS the writer —
    loses its `import.meta.url === pathToFileURL(process.argv[1]).href` invocation guard, or exports anything
    outside `ZERO_GIT_EXPORTS`. Rule 4 is what makes rule 1's allowlist sound: `PUBLISH` is read from
    `process.argv` at module top level, so without the invocation guard an importing daemon run with `--publish`
    would fetch/commit/push; and the export check stops the allowlist rotting if a future chunk exports something
    that does reach git. Reuses `check-dead-exports.mjs`'s comment stripper (STRINGS preserved so a real
    footgun's flag is visible, but the registry's description prose "sync-fills.mjs --publish" doesn't trip
    it — no spawn/import construct sits by it). Same philosophy as `lint-docs.mjs`/`lint-skills.mjs` — NEVER a
    semantic/LLM check; it is the build-time backstop to the manager's runtime `!d.local` guard. `--dir <path>`
    scans a synthetic copy (used to prove the fail path without committing a fixture); `--commands-dir <path>`
    redirects the registry-derived half too, which is how `pipeline/test/daemon-safety.test.mjs` drives every
    rule to red. Exits non-zero naming the offending file:line),
  - `lint-comments.mjs` + `comment-budget.json` (the COMMENT-DOCTRINE ratchet, run in the cheap `checks` job —
    the ONE home for its design + limits, and the CI half of the owner ruling that **behavior belongs in
    CODE**: a comment carries brief intent only when absolutely necessary, otherwise none at all, and
    historical narrative belongs in `CHANGELOG.md`. THREE structural proxies per source file. (1) DATED
    REFS — the count of `YYYY-MM-DD` in comments (leading AND trailing; dates inside quoted spans are example
    data and excluded, as are dates under a `DATA CAVEATS` marker in the same block — those are provenance
    about a data file's CURRENT contents, which a joiner needs at the schema and cannot move to CHANGELOG).
    (2) BLOCK — the longest contiguous comment run. (3) VOLUME — comment lines against code lines, added
    2026-08-25 because the first two are structurally blind to it: a freshly extracted module shipped at a
    **2.34 comment:code ratio and passed both GREEN**, since a compact, undated 19-line header violates
    neither.
    **COUNTING — read this before trusting a number it prints.** The first version of the volume axis used a
    line-shape test (`/^\s*(\/\/|\/\*|\*)/`) and was itself wrong in the same direction it was built to
    catch. A `/* … */` body written WITHOUT a leading `*` matched nothing, so it scored as CODE — and since
    the allowance is a multiple of code, **writing prose RAISED the file's own budget**: two lines of essay
    bought one line of comment. That is 3,424 lines across 80 of 154 files, including the whole of
    `js/quotecore.js`'s canonical header. It now tracks block OPEN/CLOSE state. A trailing `code(); // note`
    counts as one comment AND one code line: crediting it as neither (the first version did) actively REWARDED
    moving prose from leading to trailing position, because that lowers `comments` and raises `code` at once —
    an expanded copy of a REFUSED file passed at a pinned ceiling of zero. Counting it as both makes the
    migration exactly neutral. **Corrected, the repo measures 0.90 comment:code with a per-file median of
    0.85** — not the 0.60/0.5 the broken counter reported.
    **The 0.5 new-file cap is therefore deliberately BELOW the repo's own median, not equal to it.** The
    status quo is the thing being corrected, so matching it would be no rule at all; the cap is set where
    code written to the doctrine actually lands. That is an existence proof rather than an aspiration —
    `pipeline/lib/signal/digest.mjs` and `lint-guard-lists.mjs`, the two files cleaned to the doctrine in the
    same wave, both measure 0.47 on the corrected counter. It does mean ~two thirds of existing files would
    fail the allowance if they were new; they are grandfathered on the absolute ratchet instead.
    **The three axes ratchet differently, and the asymmetry is deliberate.** Dated refs and block length pin
    against `comment-budget.json` — every scanned file sits at its current count and may only improve. Volume
    pins on the ABSOLUTE comment count rather than the ratio, because a ratio ceiling would go red when you
    DELETE code, which is not a regression; the practical effect is that a governed file's prose may only come
    out, so adding a comment line means trimming one. The RATIO applies to NEW files only, where there is no
    baseline to count down from, and as an ALLOWANCE — `max(0.5 x code, 20 lines)` — never a bare ratio behind
    a minimum-file-size gate, because a `code >= N` cutoff would exempt the worst shape there is: an essay
    standing over two constants. (`js/desk-cadence.mjs`, 38 comment lines over 2 code, is the live example at
    ratio 19.0 — the allowance would refuse it as new code, but it is baselined, so it is pinned where it
    stands rather than caught.) Scans `js/`, `pipeline/{lib,commands,ci,daemons,probes}`, excluding
    `*.test.mjs`. `--report` ranks offenders without failing and prints each file's ratio; `--bless`
    re-baselines after a genuine cleanup and REFUSES, without `--force`, to raise any ceiling, to grandfather
    a NEW file that is over doctrine, or to proceed past a baseline entry whose `comments` field is missing —
    that field FAILS CLOSED at 0, because treating it as "no ceiling" made deleting one JSON key a cheaper
    red-build reflex than typing `--force`, and the deletion laundered the regression silently. A bless also
    NAMES any baseline entry with no file on disk, since a rename otherwise resets the ratchet: the new path
    reads as new code and blesses at whatever it carries. `--root`/`--baseline` drive it against a fixture
    tree; `pipeline/test/lint-comments.test.mjs` covers all of the above and every case is mutation-verified.
    A magnitude budget, never a semantic check — it cannot tell a good 39-line contract header from a bad one,
    only stop them growing. DISCLOSED EVASIONS: narrative carrying no date is invisible to (1); blank-line
    splitting halves (2); a `//`-looking line inside a template literal is miscounted (measured: zero here);
    and the guard's own file sits at 0.70, over the cap it applies to new code — grandfathered, disclosed
    rather than hidden. Consumes nothing; exit 1 + per-file violations),
  - `lint-guard-lists.mjs` (the guard-list drift gate, run in the cheap `checks` job — the ONE home for its
    design + limits. The repo documents its own CI in several places, and those copies drifted: three guards
    were gating while absent from `/cleanup`, and the SAME three were absent from `docs/FLOW.md`, while
    `CLAUDE.md` was missing a fourth. A `/cleanup` could therefore report a clean sweep and the very next push
    go red. The guard closes that by treating `.github/workflows/checks.yml` as the registry: it collects the
    `node pipeline/ci/*.mjs` steps and requires each doc in `GOVERNED_DOCS` to mention every one, and requires
    every `pipeline/ci/…` path those docs cite to resolve on disk. **Scope, stated honestly because a guard
    that claims more than it reads is the class this one closes:** it is JOB-SCOPED to `checks` (confirmed via
    the ruleset API to be the only required status check — `smoke` is a separate, non-gating job, and a
    job-blind read would wrongly demand `smoke-test.mjs` of docs that deliberately conditionalize it), and it
    reads only that job's SCRIPT steps, not its two inline ones (the syntax sweep, the fills/positions parse).
    So it verifies "pipeline/ci scripts within the `checks` job" and its output says exactly that — never "the
    gating set". Job bodies are found by indentation, not a YAML dependency. The `.mjs` suffix is OPTIONAL when
    matching a doc, because the governed docs legitimately differ in style (`FLOW.md` writes `check-imports`,
    `CLAUDE.md` writes `check-imports.mjs`); demanding the suffix would fail files that are correct as written,
    and a loose match can only ever cost a missed omission, never a false red. LIMITS: it proves a name is
    PRESENT, never that the prose around it is accurate, and never that a list is byte-for-byte or correctly
    ordered. `GOVERNED_DOCS` is hand-kept and cannot be derived — only prose says whether a doc claims to
    enumerate the job — so `/ship` and `/analyze` are excluded BY NAME (they carry partial, purpose-built
    lists), and a NEW complete-list home added without registering it here is the guard's own blind spot. A
    zero-length read is a hard failure rather than a clean report, since "0 missing" and "0 examined" are
    otherwise indistinguishable. Structural only, never semantic. `--root <dir>` drives it against a synthetic
    tree; `pipeline/test/guard-lists.test.mjs` exercises it through the CLI and every case is mutation-verified
    — each was confirmed RED against a deliberately broken copy, including the job-blind and suffix-strict
    mutants. Consumes nothing; exit 1 + the offending doc/script pairs.)
  - `lint-plan-refs.mjs` + `plan-folded.json` (the plan-reference gate, run in the cheap `checks` job — the one
    existence guard `plans/` has. `lint-arch.mjs` governs only ARCHITECTURE.md/GLOSSARY.md and explicitly SKIPS
    every `PLAN-*.md` token as a transient working doc, so before this a plan could be removed while live
    source still pointed at it and every check stayed green. Every `PLAN-<NAME>` token in scanned
    source/docs must resolve to a file in `plans/` or appear in the `plan-folded.json` baseline. A RATCHET over
    deletions, not a verdict on past ones: names already dangling when the baseline was seeded are
    grandfathered (those plans shipped and folded; their names survive in code as commit-searchable provenance
    tags), and what it stops is the NEXT one. NOT scanned: `CHANGELOG.md`/`docs/LORE.md` (the dated record,
    where naming a folded plan is the job), `pipeline/{test,experiments}` (synthetic fixture names), and its
    own source. Line-wrapped names are rejoined before matching — a comment header that breaks a long plan
    name mid-token across two lines otherwise reads as two separate plans, which measured 2 of the first 33
    hits. A BARE FAMILY PREFIX written on purpose is the trap this creates: naming a plan family by its
    stem alone — `PLAN-` plus a topic word, with no full plan name after it — reads as its own plan name
    to `PLAN_RE` and turns CI red, and the fix is a baseline line like any other name, since the guard
    cannot tell a deliberate prefix from a typo. (Writing this entry tripped it, which is the guard
    working; the example above is deliberately spelled so it does not.) `--refs X` lists every file citing a plan and is the check
    to run BEFORE deleting one; `--unused` shortlists plans nothing outside `plans/` points at; `--bless`
    records folds and refuses to add a name without `--force`. A token match, not a link checker: it answers
    "is anything still pointing here?", never "does this plan still matter?". Consumes nothing; exit 1 + the
    referencing file list per dangling name. `--collisions` is a SEPARATE, non-gating report over chunk-id
    reuse — commit messages and PLAN.md rows cite chunks by bare id, and 49 ids are currently
    claimed by more than one document (`A1`, `A2`, `A3` and `D1` by five each), so a bare id can be genuinely
    ambiguous. It reads four declaration forms — headings, table cells, and dashed or numbered bullets —
    across `plans/` plus the root `PLAN.md`, and requires a digit in the id, so purely alphabetic ids (`F-A`)
    are invisible. UNDER-REPORTING has bitten this mode twice: reading two of the forms hid the `AC1`
    three-way clash, and scanning `plans/` alone hid five more — including `O1`, which CLAUDE.md cites bare
    as F1's gating dependency — by skipping PLAN.md, the corpus's single biggest declarer at ~99 ids. Treat
    the count as a floor and widen the reader before trusting a clean run. The two
    pure readers (`unwrap`, `chunkIdsIn`) are pinned by `lint-plan-refs.test.mjs` against literal fixtures,
    never the live tree),
  - `lint-arch.mjs` (doc-reference guard, 2026-07-14 — enforces `docs/ARCHITECTURE.md` invariant E7 in the
    cheap `checks` job: every code-font FILE token the governed doc names must resolve on disk — a path from
    root, a bare basename against the source dirs; function/field names are skipped, `PLAN-*.md` working docs
    are exempt, genuinely-future files sit in its `PROPOSED` set. Catches rename/delete drift in the doc,
    esp. through the directory rename. Structural/existence only, never semantic; pinned by
    `lint-arch.test.mjs`. A bare basename also resolves RECURSIVELY under `pipeline/lib/**`
    (PLAN-LIB-SUBDIRS chunk 0) so a doc reference like `` `gatecandidates.mjs` `` survives the lib-subdir
    reorg without the guard needing an edit per cluster),
  - `move-lib-cluster.mjs` (PLAN-LIB-SUBDIRS chunk 0 — the mechanical cluster-mover; a DEV tool, NOT wired
    into `checks.yml`. Takes a cluster name + explicit file-basename list, `git mv`s those files into
    `pipeline/lib/<cluster>/`, then rewrites every affected import specifier across `js/` + `pipeline/` by
    RESOLVING each relative specifier to an absolute path and comparing it against the moved set — not by
    pattern-matching import "cases", so all six edge cases (in-cluster sibling, outside-in, moved-importing-
    stayed, the `../../js/` depth-bump, and the second bump when an already-moved file's target moves in a
    LATER chunk) are handled correctly by construction. Parses `export … from`/`export * from` as well as
    `import` (the estimators/rating barrel shims are re-export-only — `check-imports.mjs`'s parser misses
    them). `--dry-run` prints the full rewrite plan without writing. Runs `check-imports` + `run-tests`
    after applying; NEVER commits, never infers cluster membership, and leaves doc/skill prose pointers to
    the manual step. Pure helpers pinned by `move-lib-cluster.test.mjs`),
  - `lint-plan-lifecycle.mjs` (PLAN-CLEANUP-SKILL C10+C11 — a NON-GATING report the `/cleanup` skill
    reads; NOT wired into `checks.yml`. Scans `plans/PLAN-*.md` (excluding the root `PLAN.md`) and flags any
    whose Status reads complete (SHIPPED/DONE/LANDED) with no open marker — a doc past its
    `docs/PLANNING.md` fold-in point — and reports which `.claude/skills/*` are absent from
    `lint-skills.mjs`'s `SKILL_FILES`. It reads the whole Status **BLOCK** (the markdown paragraph),
    not the Status LINE, and with no continuation cap: the real corpus puts the load-bearing clause on
    line five or six of a status, and every bound short of the paragraph terminator nominated live
    plans as fold candidates — a false `review` costs a plan, which is the expensive direction for a
    report consulted before DELETING a doc. The marker set lives in `OPEN_RE` (the ONE home — don't
    restate it here) and covers three shapes: plain open words, negated completions (`not landed`
    matched `\bLANDED\b` and nominated a plan whose status says it did not land), and — scrubbed in
    the other direction — negated open (`Nothing open here` carried the word OPEN while meaning the
    opposite). Both negation sets are literal phrase lists, so a phrasing outside them still defeats
    the report; that is the standing limit and why the reader opens the doc. Structural (regex on a
    status block + a filename set-difference), never semantic; exit is ALWAYS 0. Exports
    `extractStatus`/`classifyStatus`/`scanPlans`/`skillDrift`, pinned by `lint-plan-lifecycle.test.mjs`
    — whose assertions are checked to FAIL against the pre-fix implementation, since a status-reader
    test built from one-line fixtures passes just as happily with the bug in place),
  - `report-branches.mjs` (PLAN-CLEANUP-SKILL C12 — a NON-GATING fact-gather the `/cleanup` skill
    reads; NOT wired into `checks.yml`, never deletes anything. Emits per-local-branch + per-worktree
    JSON (`tipSha`/`tipDate`/`tipSubject`/`isAncestorOfMain` vs `origin/main`, plus per-worktree
    `dirty`) so the stale-vs-deferred VERDICT is the skill's judgment pass — the script only gathers,
    giving CLAUDE.md rule 9's prose a cheap repeatable data source. Exports the pure parsers
    `parseWorktreePorcelain`/`parseBranchRefs`, pinned by `report-branches.test.mjs`),
  - `.claude/skills/cleanup/SKILL.md` (PLAN-CLEANUP-SKILL — the `/cleanup` project skill: the
    repeatable post-wave hygiene + architectural-integrity pass. Orchestrates the mechanical guards
    above in `checks.yml` order + the two report tools, then a SESSION/WAVE-scoped judgment sweep
    (duplication/two-homes, unread spec fields, README-inventory completeness, invariant-table
    freshness, comment/doc-hygiene) + the worktree/branch review, ending in a propose-never-apply
    fix list. Cheapness constraint: judgment is scoped to the wave diff, never a cold repo-wide
    re-audit. Boundary with `/analyze`: `/cleanup` owns implementation integrity, `/analyze` owns the
    trading-record retro. Linted by `lint-skills.mjs`),
  - `smoke-test.mjs` (CI headless-chromium DOM smoke of `index.html`, all external network stubbed;
    `/1h` and `/24h` carry DELIBERATELY different fixture volumes so the 0.74.0 volDay pin can
    discriminate — a zero-daily-volume item must hit `THIN_GRADE_CAP`, mutation-proven against both
    reverting the Finder to `STATE.VOL` and reverting `thin` to the `volDay > 0` test),
    `quotecore.test.mjs` (verdict-tree fixtures + the P4a lotCtx.path byte-identity pin),
    `held-item-strategy.test.mjs` (P4a — the path-engine acceptance: decay-knife held ranks the hold-family below
    the exit-family, the genuine-dip counter-fixture, enteredUnder→migration, and the
    degrade-not-throw/no-data contract), `pathpersist.test.mjs` (P4b — the path-dominance
    persistence-gate acceptance: flapping weights never flip the persisted `currentPath`/headline
    inside `PATH_PERSIST_MS`, a real migration arms→confirms→`MIGRATED` prose, the entered-under-
    hold-recovery decay-knife end-to-end through `pathsStage`, hysteresis, and the legacy
    watch-state back-compat pin), `verdictpersist.test.mjs` (VN-1/2/3 — the persistence-gated
    DISPLAYED verdict: severity-ranked arm-then-confirm on the label, the Gate-2 breakdown CUT
    immediate at both layers, NO-READ demoted to a note against an incumbent, the thesis render
    frame + PARKED dead-band fixtures, and the byte-identity pin for an all-quiet pass),
    `reconstruct.test.mjs` (FIFO/tombstone/
    snapshot-dedupe fixtures), `format.test.mjs` (money primitives), `lib/rating.test.mjs`
    (grade/score model), `ledgercore.test.mjs` (TD2 — `periodKey`/`groupTrades` local
    day/week/month bucketing), `table.test.mjs` (TD2 — the `compareRows` sort comparator),
    `alerts.test.mjs` (TD2 — transition-only + quiet-hours contract), `sync-fills.test.mjs`
    (LW1 — `regenerate()` does zero git), `lib/offers.test.mjs` (incl. the LW1 `offersSnapshot`
    emitter), `watchcore.test.mjs` (Watch-tab derivations + `offerVerdict`), `lib/cli.test.mjs`
    (arg/`parseGp`/`median`), **`daemon-safety.test.mjs`** (2026-08-17 — fail-path proofs for
    `check-daemon-safety.mjs`, which shipped with no test at all while its scope silently covered a
    quarter of the registered fleet. Drives EVERY rule to RED against synthetic fixtures via the guard's
    `--dir` + `--commands-dir` CLI rather than by importing its internals, since `check-dead-exports.mjs`
    forbids an export kept alive only by its own test: out-of-dir implementations are in scope at all; the
    zero-git import allowlist admits `{regenerate, REPO_DIR}` and refuses anything else, including a
    namespace import; a git-writer losing its invocation guard or growing a non-allowlisted export; an
    unresolvable registered daemon name; and the regression that `--publish` alone is NOT a git signal, so
    `screen-flip-niches.mjs --publish` stays legal while `sync-fills.mjs --publish` still fails. All 7
    verified to fail against the pre-widening guard), **`check-imports-scanner.test.mjs`** (2026-08-09 — acceptance fixtures for `check-imports.mjs`'s exported `unboundConstantsIn`, i.e. the CI guard's OWN behaviour. Exists because that scanner shipped broken four times in one day and was each time "verified" by running the CLI and seeing ✓ — an aggregate pass says nothing about WHICH shapes are detected. Pins each shipped failure individually: nested-brace `${…}` interiors, a regex containing a quote/backtick blinding the file to EOF, `return /"/…` misread as division, and control-flow parens (`if (X) {`) binding X file-wide and masking a real unbound use; plus the silence side — params/catch/labels/`static`/re-exports/object keys/member access must NOT be reported, since a false positive is a mysterious CI failure on correct code. Mutation-checked: removing the control-flow lookbehind makes it fail), `windowread.test.mjs` (window-range quantiles + the RC1 recency-split reach-contamination guard + the PLAN-DIURNAL-RECENCY-GUARD `computeReality` Layer-A mechanics fixtures — spike/bid-spike/crash/clean series + the `peaks[0]===peak` referential-identity + `{reality,…rest}` deep-equal invariant; moved to `pipeline/` beside the other `js/`-module tests when P2 moved windowread to `js/`), `diurnal-recency-replay.test.mjs` (PLAN-DIURNAL-RECENCY-GUARD Layer-B retrospective replay — reads a FROZEN committed snapshot `fixtures/diurnal-recency-replay.json` (the two anchors' 1h series cut at end-07-23 PDT, `cutISO`, so the recent-3 data days are the 07-21/22 double-spike; refresh via `--snapshot`) and asserts the HARD anchor Black dragon leather (2509) fires `spikeTop` with `typicalLevel` at the reachable ~4,216 (not the 4,337 spike peak); Primordial boots (13239) is reported INFORM-only — its 1h archive has since revised past the sharp 19.36m print (validated live by Fable at build), so it no longer reproduces deterministically. Default path is network-free → it IS a `*.test.mjs` and runs in `run-tests.mjs`/CI; `--live` gives a live diagnostic with no assertion since the wiki's revised averages self-heal past the failure. n=1 hard real anchor + the Layer-A `computeReality` synthetics — validates "catches what fooled us," not a calibrated rate), `forecast.test.mjs` (PF1 — the `js/forecast.mjs` diurnal+trend model: the pinned BLOOD-RUNE golden (whenBuyable ≈ 4h at the projected trough), the anchor boundary condition, the downtrend step-down, the loud degrades (spike/decay/band-violation/thin/no-anchor/trend-only), and the band-non-shrinking + additive-dispersion-fields checks — all synthetic, no fetch/fs), `validate.test.mjs` (P2 — the validator registry semantics + reachValidator fixtures: rarely-reached→caution, never-reached→reject, RC1 stale-optimistic→bumped reject, and the no-data/thin-sample degrade-to-pass contract),
    `dipposture.test.mjs` (DP1 — `recentDirection` falling/reverting/flat/thin/lone-flier-robustness +
    `dipPostureValidator`: no-dip/held/missing-input degrades, falling→pass, reverting→caution with the
    cross message + crossNet, unprofitable-cross language, the NEVER-reject invariant, and the inform clamp),
    `diploop.test.mjs` (DL2 — `flushSignal` fires on liquid+deep+falling+profitable-exit; does not fire
    on thin/shallow/reverting/flat/exit-underwater/unreliable; null on missing inputs; the null-limit
    `dipScore` fallback + ranking sanity; bucketVol-informs-not-gates; `suggestionEntry` lean-includes
    `dipLoop`; and `dipLoopAudit` separates fillable from not-taken firings),
    `dl4nominate.test.mjs` (DL4 — `nominateDip` fires liquid/illiquid tracks on two-sided+wide books,
    rejects one-sided ghost books + narrow books + missing inputs + **penny items below the `DL4_MIN_GP_FLOW`
    gp-scale floor OR the `DL4_MIN_ABS_SWING` per-unit swing floor** (cheap high-volume churn now EXCLUDED by
    the swing floor — 2026-07-12), prefers band amplitude over the 24h range, and score-ranks; the
    `pruneDipPool`/`reconcileDipPool` hygiene ages by `lastQualTs` + caps each track top-N BY SCORE (manual
    exempt); `selectNominations` (legacy) dedups by id AND legacy name/number, respects the cap, highest-score
    wins; plus the polymorphic `--dip` reader token-extraction over a mixed array),
    `termstructure.test.mjs` (P3 — the `js/termstructure.mjs` math + floorValidator acceptance:
    decay-knife buy above the durable floor→reject, genuine dip at/below it→pass, spike-robust IQR, and
    the no-data/thin-floor/held-lot degrade-to-pass contract on both surface ctx shapes),
    `bandedge.test.mjs` (Bar E — the robust band edge: `robustBand` — home MOVED to `js/quotecore.js` by
    Scope B, `marketfetch.mjs` re-exports it — takes p90 high / p10 low on a DENSE side (≥
    `BAND_EDGE_MIN_SAMPLE`), keeps the raw extremum on a SPARSE side, so a lone flier can't set
    `bandHi`/`bandLo`; a pure-array test — no fetch/fs. Scope B (0.55.0) also robustifies `computeQuote`'s
    app Optimistic column off the same helper — pinned by the `quotecore.test.mjs` Scope-B split assertion),
    `validateslots.test.mjs` (LH1 — impossible-transition re-emit drop), `logblind.test.mjs`
    (LH2 — restart-blindness header), `trendcore.test.mjs` (TC1 — the walk-forward `backtestPlan`
    gate, `patientTargets` sizing, seasonal decomposition) and `gatecandidates.test.mjs` (GC1 —
    the pre-fetch gate stack; P1 — the `rankAndSlice`/`proxyDrift`/`softFactor` fetch-pool
    ordering: thin-reserve slots, the rising reserve (Steps 3+4), soft-factor deprioritization, TOP
    slice), `survivemode.test.mjs` (P1 — the post-fetch `surviveMode` doctrine: falling-exclusion +
    `--phase-rescue` basing rescue, the scalp falling-confirm (+ vestigial rising-confirm), overnight-posture, and the load-bearing
    rescued-carries-through-a-later-posture-drop dual-counter invariant), `replay.test.mjs` (P1 — the
    snapshot-replay ACCEPTANCE harness: feeds the committed `fixtures/replay/snapshot.json` through the
    full per-flip-niche funnel (`lib/replay.mjs` `runReplay`) for band/churn (active) + scalp + band
    (overnight posture) and compares each stage to `fixtures/replay/golden.json` — a DRIFT guard
    (`buildSnapshot()` still reproduces the fixture) + a GOLDEN guard (funnel output matches) + readable
    per-archetype path assertions; `--update` regenerates both fixtures for hand-review. Pins the CURRENT
    pre-amendment falling-exclusion, re-pinned at P5), `watchstate.test.mjs` (V1 — cross-pass deltas + the
    consecutive-underwater/below-support counters' reset policy + V4 `convictionGate` arm-then-confirm
    escalation incl. the breakdown-exempt invariant), `levels.test.mjs` (V2 — higher-low support /
    cut-trigger + graceful degradation), `emit.test.mjs` (V5 — the per-held emit contract: the
    guaranteed sell line + fixed field order + `heldListAt` precedence), `campaigns.test.mjs` (the
    multi-chain `groupCampaigns` grouping: parallel listings never stitched, ladders recovered whole,
    place-then-cancel overlap kept, completion terminates, same-slot wins the join — the load-bearing cases name their mutant), `recovery.test.mjs` (V6 — the
    advisory recover-vs-drop composition, the spike confidence-cap, and the trigger gating) and
    `freed-capital.test.mjs` (V6 — freed-capital detection + the first-seen/stale-gap/grown-lot anti-misfire
    guards), `fetchcache.test.mjs` (FC1 — the opt-in fetch cache's TTL hit/miss + byte-identical
    payload + default-off toggle), `range-position.test.mjs` (YF1 — `deriveState` band-percentile
    clamp, regime/phase off a synthetic 6h series, and the `reconstructed:false` honesty guard),
    `velocity.test.mjs` (YS1 — the velocity-class half-open boundaries + n/a guard),
    `capital-utilization.test.mjs` (YV1 — `bookUtilization` split/edges + `parkedStats` counts/median/mix
    + `totalCapital` committed/idle-cash split, null-safe when cash unknown),
    `book-model.test.mjs` (PLAN-DASHBOARD — `buildBook` slots/capital/lots math + the Risk-5
    byte-identical-to-watch-SUMMARY-footer capital-split gate + `sizeTranche` each-bound-binding cases +
    the null-limit refusal + missing-mark null-P&L),
    `velocitytag.test.mjs` (Build 2 — `buildVelocityIndex` aggregation/dominant-class/median + null-safe;
    `velocityTag` minN gate, `fast·~Nm` format, ≥20% unfilled suffix),
    `sessionthesis.test.mjs` (YT1 — upsert/preserve/clear/prune + `thesisLine` format + file round-trip),
    `holdthesis.test.mjs` (TG1 — load-degrades-to-[]/round-trip/thesisFor-newest/upsert-replaces/clear/prune-TTL;
    P4a — path/enteredUnder persistence + the legacy-entry back-compat fixture),
    `statetransition.test.mjs` (YP2 — basing/spike-rising/spike-falling classification + the base/decay/null focus guard),
    `guideanchor.test.mjs` (YP1 — the honesty gate + prev:null-baseline filter + modal-hour/median-step above the gate),
    `probes.test.mjs` (PM1 — the loader's empty-passthrough + stage grouping, the observe-touches-no-number
    and price-only-when-ctx.price invariants, and each seed probe's gates: dip fire/silence + owned framing,
    froth healthy-vs-knife, anchor's `{price}` nudge, decant's `bestDecant` dose math + `needs()` declaration;
    PM2 — `logFirings` writes a well-formed line to the right `<module>.log`, appends not overwrites, no
    firing ⇒ no file, and a write failure is swallowed),
    `archive.test.mjs` (D0 — append idempotency (same bucket twice = one row per item), `hasBucket`
    check-before-fetch, `seriesFor`/`marketAt` vs hand-computed slices on `:memory:` DBs, `exportFixture`
    round-trip, `pruneBefore`, the never-`/latest` grain guard, and the `dailyMidsAt`+`daily_seed`
    loadDaily bridge — all on `:memory:`/tmp DBs, NEVER the real archive),
    `archive-6h-pin.test.mjs` (AF5b — the 6h READ CONTRACT on a fake handle, no sqlite/fetch/clock:
    `LIVE_TS6H_BUCKETS` = 365; a deeper-than-live archive pins to the newest 365×6h; **the BLOCKER
    reproduced** — a 250d unpinned read flips `phase()` `spike`→`base` (both depth-dependent inputs,
    `baseMid` 1000→3000 and `peakMid` 1200→3000) where the pinned read does not, while `regimeDrift`'s
    classification/driftPct are IDENTICAL across the same depth change; the pin is a CEILING not a floor
    (a short archive stays short and moves `baseMid` — why AF6 must wait for 91.25d of archive); the five
    wire keys only, with `sourceBuckets`/`ts` provably absent; `sixHourReader`'s no-handle path
    returning the live call's OWN object from one same-id call — the default-off byte-identity guard —
    plus its empty-archive and throwing-handle live fallbacks and the achieved-depth `onSource` hook; and
    the DEPTH FLOOR (`REGIME_MIN_6H_BUCKETS`), pinned one-directionally: everything the floor ADMITS drives
    the gate, and a genuinely short series really does break `regimeDrift` — deliberately conservative,
    since admitting a too-short series costs a silent un-gating of the falling exclusion while rejecting a
    usable one costs a single fetch),
    `item-context.test.mjs` (P0 — the context chain's per-stage enrichers (identity/market/history/intraday/
    position), THE PIN (`HOLD — ask filling` renders the same verdict on compact + verbose off one
    `ctx.position.mv`), and the CONVICTION PIN (an armed-not-escalated Gate-D CUT-CANDIDATE is
    consistent on both surfaces, then escalates once the underwater streak persists ≥ `ALERT_PERSIST_MS`)),
    `subfloor.test.mjs` (P6c — the empty-result sub-floor fallback: `subFloorFallback`'s relaxation
    ladder identifies WHICH floor emptied the flip-niche (min-gpd vs liquidity), never relaxes the two-sided
    gate or the thesis edge (null when those emptied it), the honest `subFloorLabel` wording, the
    `SUBFLOOR_TOP` slice bound + `SUBFLOOR_GRADE_CAP` clamp, the value-flip-niche scope-out, and the lean
    `subFloor` suggestions-ledger marker's absent-field byte-identity),
    `lint-skills.test.mjs` (P7 — the heuristic skill-linter's convention: `- **…**` rule-block
    detection, the two tag forms (code-pointer vs `judgment:`), frontmatter/fence exclusions, the
    counting, and the LIVE regression guard that every committed SKILL.md in `SKILL_FILES` lints
    clean — it iterates the array, so it widens automatically as skills join),
    `lint-skills-scope.test.mjs` (2026-08-14 — fail-path proofs for `lint-skills.mjs`'s `scopeDrift`:
    a skill on disk but unlisted (the silent coverage-loss direction), a listed skill missing from
    disk (the stale-entry direction), an exact match drifting neither way, a non-skill subdirectory
    with no SKILL.md correctly NOT counted, and the real repo reading clean end-to-end through the
    CLI — every case drives main() through the CLI, NOT the exported helper, and the set is verified RED
    against a gate stubbed out to `if (false)`. The green run is only meaningful because those reds are
    reproducible),
    `lint-docs.test.mjs` (DL1 — the doc-drift linter's three checks: denylist pattern precision (live-flip-niche
    form hits, deletion prose does NOT), the live corpus has no hard denylist violations + STILL catches
    the index.html AP1 drift as xfail, `normalizeWords`/`findDuplicateShingles` on synthetic docs
    (≥14-word verbatim passage flags, short overlap + single-home + null-doc don't), the live
    CLAUDE.md ⇆ README axis is clean, and — for the constant-drift check — that both source definition
    shapes are read (module `const`, threshold-table property, with spread overrides NOT counted as a
    second definition), that a stale gloss fires in either word order while historical prose / a date /
    a hyphen compound / a comma-separated old→new list do NOT, that a cross-unit restatement is declined,
    and a no-op tripwire pinning a floor under the number of gloss sites actually compared),
    `lint-plan-lifecycle.test.mjs` (PLAN-CLEANUP-SKILL C10+C11 — the plan-lifecycle report's
    `extractStatus`/`classifyStatus` (complete-word vs open-marker, incl. the PARTIALLY/open-work
    carve-outs) + `scanPlans`/`skillDrift` on deterministic tmp fixtures, never the live tree),
    `report-branches.test.mjs` (PLAN-CLEANUP-SKILL C12 — the branch-report's pure parsers
    `parseWorktreePorcelain`/`parseBranchRefs` on canned git-output fixtures; classification is the
    caller's job so the impure `gather()` is exercised live by the skill, not unit-pinned),
    `expunitsovernight.test.mjs` (COD-2 — pins the documented closed form `min(limit×2, 8/24×0.10×volDay)`
    plus the limit-bound/volume-bound/null-limit/zero-vol edges. **This entry claimed `expUnitsOvernight`
    = `expUnits × 8/24` until 2026-08-10; that identity is FALSE and the test asserts its NEGATION** —
    `assert.notEqual(expUnitsOvernight(10,5000), expUnits(10,5000)*K)`, measured 20 vs 6.67. It broke when
    `expUnits` moved to the HAIRCUT `ACTIONABLE_WINDOWS_PER_DAY = 2` while `expUnitsOvernight` kept the
    PHYSICAL refill count, so scaling the day figure by 8/24 now double-counts the haircut. The line 335
    entry above always described this correctly — the two README statements contradicted each other),
    `vol24.test.mjs` (PLAN-VOL24 — pins the rolling-24h correction, which NOTHING pinned before
    2026-08-10: the whole of `vol24FromInputs` was reverted as a mutation and all 109 suites passed.
    13 groups, offline/deterministic (fixed clock, zero fetch): the `[anchor-23h, anchor]` window
    arithmetic + both-ends exclusivity, VWAP volume-weighting, the degradation contract (absent /
    too-short / all-zero series), **F4's both-ends coverage guard** (a series reaching back far enough
    but stopping short of the anchor used to sum a PARTIAL window while still reporting
    `volSrc:'rolling'` — measured on one stratified n=24 sample at 10/24 items with short coverage, of
    which 5 were still bit-exact because the missing hour had no trades and 2 under-reported by >1%;
    an earlier "4/24, 3 under-reporting" figure came from a different probe and was incompatible with
    the "22/24 bit-identical" published beside it — and the "19/24" that replaced BOTH was itself an
    artifact of the 00:00–01:00 UTC read hour, see the loadAll24hRolling header), F5's `buckets` count (DIAGNOSTIC — no production
    caller reads it, or `volSrc`; this test is the only thing exercising either field), and
    F7 (a string-timestamped series degrades SAFELY — `rolling24FromTs1h`'s `>=` would coerce it while
    the guard's `Number.isFinite` does not; the disagreement is real and pinned in its safe direction).
    Mutation-proven twice — disabling the correction fails the guard test, restoring the old
    start-only guard fails the F4 test),
    `rebid.test.mjs` (COD-3 — the cut-and-rebid helpers in `js/quotecore.js`: `rebidBar`'s friction
    arithmetic (tax + half-spread below the clear) + `rebidAdvice`'s trajectory-branch selection — knife→against,
    oscillating→rebid-at-trough/sell-peak with diurnal level carry-through, else→friction-bar governs),
    `sf3-volsrc.test.mjs` (SF-3 — the liquidity-`class` volume-source split: `classAndSource` CLASS PARITY
    (a warm bulk map converges quote's logged class on screen's, even across a per-item straddle) + the
    cold `peritem` fallback (pure/synchronous ⇒ no fetch) + `readWarmAll24h`'s fetch-free warm/stale/absent
    reads — all synthetic, no network),
    `printed-at.test.mjs` (AB1 — the fill atom: `mid` is an input that moves the verdict, the `>=`
    threshold over MID, the exclusive-at-`from`/inclusive-at-`from+horizon` window, `horizon` in DAYS, the
    TRISTATE `printed:null` on missing coverage that must never collapse to `false`, and the `ts`-shaped
    row that THROWS),
    `fill-surface.test.mjs` (AB2 keying + AB3 inversion — the pinned prior-24h mid computed strictly
    before the reference instant, absolute price tiers, artifact-supplied volatility cuts, the
    highest-premium-clearing-target selection, price tier and horizon each moving the answer, the
    `capped` top-of-grid flag, the below-2% not-claimable band, all nine refusal paths, plus the three
    2026-08-08 review fixes: the above-ceiling `tier-out-of-range` refusal that must not also carry a
    price, the wider-of-CI-vs-windowSpread rule (and the suppression of the reassuring pooled figure
    when the spread wins), and the grain bias being SHOWN with `p` left untouched)
    — all auto-discovered by
    `run-tests.mjs` (below), which CI runs once
  - `pipeline/test/fixtures/replay/snapshot.json` + `golden.json` (**tracked**, P1) — the committed inputs +
    expected outputs for `replay.test.mjs`. `snapshot.json` is a `coffer-replay-snapshot/1` synthetic
    market state (five archetypes — stable band, genuine dip, thin big ticket, decay-knife, falling
    wide-band; no PII, no live data), produced by `lib/replay.mjs` `buildSnapshot()`; `golden.json`
    (`coffer-replay-golden/1`) is the per-flip-niche funnel result `runReplay` must reproduce. Regenerate
    both with `node pipeline/test/replay.test.mjs --update` (hand-review the diff). Consumer: `replay.test.mjs`.
  - gitignored scratch is consolidated under `pipeline/.cache/` (OR2): the market caches plus
    `mapping.cache.json`, `.alerts-state.json`, the optional `held-override.json`, the FC1
    `fetch/` per-URL cache (opt-in cross-invocation fetch cache — one `{ts,url,data}` file per
    cached GET, disposable), the YF1 `outcomes-daily/` per-item reduced past 1h@6h series (sibling
    of `outcomes-bands/`), the YT1 `session-thesis.json` (intent-per-lane store; `declare-thesis.mjs` writes,
    watch-positions.mjs reads), the COD-3 `last-weekly-report` stamp (an ISO timestamp `join-outcomes.mjs --report` writes
    and `--weekly-due` reads — the `/morning` weekly-read cadence memory), and
    `watch-state.json` (V1 — the watch loop's cross-pass memory: a keyed map
    `held:<id>`/`bid:<id>:<offer>` → `{ts, identity, instabuy, mom, bandTop, breakEven, support,
    underwater, passesUnderwater, belowSupport, passesBelowSupport, bandTopHist[]}`, rewritten fresh
    each pass by `watch-positions.mjs` so vanished positions drop out; counters reset on identity change or a
    gap > `STALE_GAP_MS`. Local, disposable —
    deleting it just loses one pass of delta history), `daemon-state.json` (PLAN-DAEMON-SUBSYSTEM Chunk 3 —
    the daemon manager's own heartbeat/throttle bookkeeping: a keyed map `{[daemonName]: {lastRan, lastChecked,
    ok, detail}}` written by `pipeline/daemons/manager.mjs`'s `saveState`. DELIBERATELY SEPARATE from
    root-level `heartbeat.json` (LW3 — watch-log's browser-facing 30s pulse): this one is desk-only,
    whole-fleet, never fetched by the app. Missing/corrupt → `{}`, never throws. Disposable), and the AO1
    `last-report/<kind>.json`
    dumps (`screen.json`/`quote.json`/`watch.json`/`watchlist.json`, plus `exit-surface.json` — which is NOT a render.mjs
report object but `read-exit-surface.mjs`'s own report array) — the compact-JSON render.mjs report object(s)
    the last run of each market-read CLI built, overwritten with "last run" semantics. **NOT written on
    every run** — three of the four producers return before their dump on a degenerate path
    (`quote-items.mjs` exits at `:618`/`:655`; `watch-positions.mjs` returns on "Nothing to watch";
    `screen-flip-niches.mjs --mode reverse` returns before its write), so a stale dump can outlive the
    run that should have replaced it. `read-watchlist.mjs` is the one that writes on every path,
    including the empty case. A reader that must know the dump is fresh should check `generatedAt`,
    for an agent to read instead of re-parsing stdout. Producer: `screen-flip-niches.mjs` /
    `quote-items.mjs` / `watch-positions.mjs` / `read-watchlist.mjs` (via `writeLastReport`, `pipeline/lib/render/cli.mjs`); consumer:
    agent analysis passes — quiet-and-dump-only is now the DEFAULT (an agent must read this file for
    the data, not a stdout summary line); `--verbose` opts into the markdown table for a human paste.
    Shape `{kind, generatedAt, reports:[…]}`; screen
    accumulates its per-flip-niche reports into the one file (the VALUE flip-niche is console-only,
    excluded, same as screen.json). Local, disposable — deleting it just loses the last run's dump.
    Also `fill-surface.json` (AB2, PLAN-ASK-BACKTEST — the versioned `coffer-fill-surface/1` ask-fill
    lookup: `{schema, builtAt, meta, cells, cellsVolPooled, pooled}`, where a cell key is
    `<horizon>d|<priceTier>|<volBand>|<premium>` and carries `{n, hits, p, nItems, ci, nWindows,
    windowSpread, byWindow}`. `meta` stamps the PINNED mid definition, the measured volatility-tercile
    cuts, the density floor, the reference windows, the bootstrap method, the build GRAIN, and an explicit
    `limits` list of what the numbers may not be used to claim. ⚠ `ci` is the ITEM bootstrap and is the
    NARROWER of the two uncertainties — `windowSpread`/`byWindow` carry the between-regime variance that
    usually dominates (median 18.4pp vs 8.5pp), so no consumer may quote `ci` alone. Producer:
    `build-fill-surface.mjs`; consumer: `lib/market/fill-surface.mjs:loadSurface`/`askAtFillRate`.
    Gitignored + DERIVED from the machine-local archive, so it is reproducible rather than precious — but
    deleting it makes `askAtFillRate` refuse with `no-surface`, the intended loud degradation, never a
    silent pooled guess).
  - `pipeline/.guide-history.jsonl` (**tracked** as of 2026-07-06 — Ben's call: it's an accruing
    observation record, so it lives in the repo to survive a lost machine; kept OUTSIDE `.cache/`
    so cache pruning never touches it) — change-only GE guide-price observations for watched items,
    one JSON line `{ts,id,name,guide,prev}` per observed change, appended by `watch-positions.mjs`
    `logGuideChanges()` at watch cadence. Purpose: pin each item's ~daily guide-update
    time + magnitude to feed the guide-re-anchor pricing edge (PLAN.md Discovered,
    2026-07-06). Consumer: `pipeline/lib/market/guideanchor.mjs` (YP1 — the guide re-anchor model, honesty-gated
    on accrual; quote-items.mjs/watch-positions.mjs surface its advisory line, silent until enough real updates accrue). (Not auto-committed by
    `sync-fills.mjs`; commit it periodically so the record on `origin` stays current.)
  - `pipeline/.market-archive.sqlite` (+ `-wal`/`-shm` sidecars) — **gitignored, machine-local, D0**:
    the Tier-1 SQLite market archive. Append-forever RAW `/1h`+`/5m` whole-market observations
    (~30–35GB/yr, Ben-approved) that the wiki API only serves ~30h/item live — the ONLY route to broad
    intraday history, feeding P3's term structure + P6's backtests. Deliberately OUTSIDE `pipeline/.cache/`
    (that tree is disposable/pruned; the archive must survive). Producer: `pipeline/lib/market/archive.mjs`
    (`append`, via `loadDaily`/`loadSnapshot`). Consumers: `loadDaily`'s regime proxy + P3's
    `js/termstructure.mjs` durable-floor read (via `loadDaily`, incl. the read-only `{noFetch:true}` path
    quote-items.mjs uses); the Pipeline-v2 context chain (P0+) as it lands. NEVER committed (huge, machine-local,
    reproducible-by-accrual).
  - `FILLS-PIPELINE.md` (pipeline design + operations) and `MONITORING.md` (live-monitoring
    routine). The `quote-items.mjs`/`screen-flip-niches.mjs`/`watch-positions.mjs` scripts import `js/quotecore.js` +
    `js/money-math.js`/`js/money-format.js` so their tables match the app exactly.

## Map of the repo

Two things bite when you move or edit a file here, so they get their own map: the root
**data artifacts** (some are load-bearing at fixed paths; some are free to move) and the
two **shared logic modules** that are served to the browser *and* imported by node.

### Root data artifacts

**ROOT-LOCKED** — the app fetches these same-origin and/or the deployed phone writes them at
hardcoded contents-API paths, so moving any one is a coordinated app + pipeline +
deployed-phone change (not a rename):

| File | What locks it to the root |
| --- | --- |
| `positions.json` | app fetches same-origin (`js/ledger.js` `syncFills`) |
| `offers.json` | app fetches same-origin on localhost (`js/ledger.js` `fetchOffers`, LW2) — live GE offer snapshot written by `sync-fills.mjs`/`watch-log.mjs` |
| `screen.json` | app fetches same-origin (`js/ui.js` Scan tab) |
| `watchlist.json` | app fetches same-origin (`js/ui.js`) **and** the phone writes it back via the contents API (`js/github.js` `WATCHLIST_PATH`) |
| `mobile-fills.log` | the phone appends slot-9 lines via the contents API (`js/github.js` `MOBILE_LOG_PATH`); `sync-fills.mjs` reads it |
| `fills.json` | the pipeline source `positions.json` is FIFO-reconstructed from; `sync-fills.mjs --publish` commits it at the root nightly (a bare run rebuilds it locally, zero-git; not app-fetched directly, but coupled to the same convention) |

**Pipeline-only / movable** — no app fetch and no hardcoded remote path; a single path
constant governs each, so these can move without touching the deployed app or phone:

| File | Producer / consumer | Tracked? |
| --- | --- | --- |
| `alerts.json` | read by `pipeline/commands/trigger-alerts.mjs` (N1) | tracked (ships empty) |
| `watchlist-meta.json` | role sidecar for `watchlist.json`; read only by `pipeline/lib/config/watchlist.mjs` (never by the app, never by a grant) | tracked (ships `{}`) |
| `suggestions.jsonl` | appended by `pipeline/lib/render/suggestlog.mjs` (O1 fields + YS2 forward `posture?`/… + SF-3 `volSrc?`); SR1-bounded to the current month | tracked, append-only |
| `pipeline/suggestions-archive/suggestions-YYYY-MM.jsonl` | completed months rolled out of the active ledger by `rotateLedger` (SR1); read with the active file via `readSuggestionLines` | **gitignored, local-only** (2026-08-07) — rolled-out months live on ONE disk, no repo backup |
| `outcomes.json` | derived by `pipeline/commands/join-outcomes.mjs` (F1 join reads active+archives) | gitignored |

### Shared logic modules

`js/quotecore.js`, `js/money-math.js` and `js/money-format.js` are served to the browser **and** imported by node —
an edit ripples into the pipeline scripts and CI, not just the app. After editing either,
run `pipeline/test/quotecore.test.mjs` + `pipeline/test/reconstruct.test.mjs`.

| Module | Also imported by (pipeline) |
| --- | --- |
| `js/quotecore.js` | a widely-shared leaf — treat any edit as broad-blast-radius. Includes: `quote-items.mjs`, `screen-flip-niches.mjs`, `watch-positions.mjs`, `monitor-offers.mjs`, `trigger-alerts.mjs`, `lib/cli.mjs`, `lib/reconstruct.mjs`, `lib/retrojoin.mjs` (P6a — `tax` for suggested-net; SF-1 — `quantileOf` for the p25/p75 latency spread), `add-manual-fill.mjs`, `quotecore.test.mjs`, `watchcore.test.mjs` (`offerVerdict`, shared with the app Watch tab), `dipposture.test.mjs` (DP1 — `recentDirection`); plus the js/ side-imports `js/termstructure.mjs` (SF-1 — re-exports `quantileSorted` as `quantile`) + `js/validate.mjs` (DP1 — `recentDirection` for `dipPostureValidator`) |
| `js/money-math.js` | the tax/margin/bond MATH (split from `format.js`, R2): `quote-items.mjs`/`screen-flip-niches.mjs` (`tax`) + js-side node imports `js/flip-niches.mjs` (`tax`), `js/estimators.mjs` (`netMargin`/`clamp`), `js/validate.mjs`/`js/trendcore.js` (`tax`/`netMargin`), `js/valuescreen.mjs`/`js/market.js`. Edit ⇒ re-run `quotecore.test`+`reconstruct.test` (byte-identical tax). |
| `js/money-format.js` | gp/number DISPLAY (split from `format.js`, R2): `quote-items.mjs`, `screen-flip-niches.mjs`, `watch-positions.mjs`, `trigger-alerts.mjs`, `join-outcomes.mjs`, `retrojoin.mjs`, `derive-cash.mjs` + `lib/analyze.mjs`/`item-context.mjs`/`emit.mjs` (`fmt`/`fmtP`/`fmtTurn` for the reports) |
| `js/windowread.mjs` | **A widely-shared leaf — treat any edit as broad-blast-radius.** Commands: `read-window-range.mjs`, `quote-items.mjs`, `watch-positions.mjs`, `read-book.mjs` (`liveAgeTag` on P&L marks), `read-schedule.mjs`, `join-window-clears.mjs`, `join-depth-outcomes.mjs`, `screen-flip-niches.mjs` (diurnal profile). js/: `js/quotecore.js` (`windowStats`/`floorCeilingTrack` — the edge that makes windowread a PURE LEAF: it can never import quotecore back, so a shared constant is passed as a PARAMETER, not imported), `js/validate.mjs`, `js/forecast.mjs` (PF1 — `hourProfile`), `js/amplitudescreen.mjs`, `js/termstructure.mjs`, `js/estimators/cells.mjs`, `js/estimators/pair.mjs`. pipeline/lib: `render/emit.mjs`, `timing/staleexit.mjs`, `reconstruct/fill-placement.mjs`, `market/warm-term-structure.mjs`, `market/item-context.mjs` (`realityClause` on the thesis-frame exit — PLAN-DIURNAL-RECENCY-GUARD Chunk 2c, 2026-08-12; a NEW `pipeline/lib/market` → `js/windowread.mjs` edge). Experiments: `pipeline/experiments/dt4-window-gate-study.mjs`. _(No importer COUNT is stated here on purpose: a hand-maintained tally in this cell was wrong in four consecutive review rounds, and was wrong again the round after it was re-derived. Enumerate with a grep when you need the set; do not write the number down.)_ Tests: `windowread.test.mjs` (P2 — moved from `pipeline/lib/`), `askexitread.test.mjs`, `projecttrajectory.test.mjs`, `forecast.test.mjs`, `diurnal-recency-replay.test.mjs`, `dt4-timedlap-coverage.test.mjs` (DT4 — the §7 data-guarantee structural pin, direct `diurnalTimedLap` import), `reality-render-coverage.test.mjs` (PLAN-DIURNAL-RECENCY-GUARD **Chunks 2b + 2c**, 2026-08-12 — the render-COVERAGE guard: a source-level scan over **five** NAMED files (`js/windowread.mjs`, `read-window-range.mjs`, `read-schedule.mjs`, `emit.mjs`, `suggestlog.mjs`) asserting the known diurnal-level call sites still render `realityClause`, plus behavioural pins built from the real Green-dragon-leather daily highs (they reproduce the shipped `3/14 · p86 · typical ~1,828` exactly). **It is a fixed regex set, not an enumeration** — it cannot discover a new surface. Chunk 2c added `js/windowread.mjs`, `emit.mjs` (the `also ASK`/`also BID` clause, no longer bare) and `suggestlog.mjs` to its scan. **Two Chunk-2c sites are NOT source-scanned here** and rest on behavioural tests alone: `item-context.mjs`'s thesis-frame exit (`verdictpersist.test.mjs` fixtures 3f–3i) and `quote-items.mjs`'s `windowExit` peak-level bit — a deletion at either would not trip this guard. _(A draft of this cell said "six NAMED files"; it is five. A hand-maintained count in this exact cell has now been wrong in four consecutive review rounds — the durable fix is to stop stating one, not to re-derive it again.)_ `js/trends.js` remains uncovered and still bare, logged in the plan's §10 — which now records it as FOUR app sites, not one, two of them (the ★ badge gate and the `diurnalForecast` projections) being design questions rather than clause-appends. Exists because Chunk 2 enumerated three surfaces and missed two — `read-window-range.mjs`'s own `→ BID/ASK` recommendation line and `/schedule`'s Level column — and a missed CALL SITE is invisible to every behavioural test of the function itself. Also pins the two load-bearing gates that must not be "simplified": the `bidBasis !== 'live'` guard (a repriced bid must not inherit the dip level's reality) and the side-branch on the `⚠⚠` cushion composite. Non-vacuity is scoped, not blanket: every §A assertion that targets a NEW call site fails against `git show HEAD:` copies of the four files §A scans; exactly three §A assertions are before/after invariants guarding a FUTURE deletion, named rather than counted (the `→ BID/ASK` line existing at all, the ASK-leg ⚠⚠ wording surviving the BID-leg fix, and Chunk 2's own `formatTimedLap` clauses); §B pins `computeReality`, which the diff does not touch. **No assertion count is stated** — a hand-maintained count here was wrong in three consecutive review rounds), and the `oscillation-*.test.mjs` set except `oscillation-reachphase.test.mjs` (`oscillation-reachphase.test.mjs` does NOT import it). **APP-IMPORTED by `js/trends.js`** (TV — the Trends Diurnal timing section, same `hourProfile`/`deriveDiurnalRange` the console prints; since 0.73.0 it also imports `windowReliability` + `fitWindowMismatchNote` + `WINDOW_RELIABLE_NIGHTS` — the ★ badge is gated on the SAME split-half reliability verdict the console gates hour-display on, and the lookback toggle defaults to the gate's own window. _It imported `hourConcentration` for the ★ from DT5 (0.68.0) until 0.73.0, when that predicate was dropped here as a measured non-discriminator._) |
| `js/forecast.mjs` | `pipeline/test/forecast.test.mjs`, `pipeline/commands/read-window-range.mjs` + `pipeline/commands/quote-items.mjs` (`driftExitFrom` Chunk 5), `js/amplitudescreen.mjs`, and **`js/estimators/pair.mjs`** (PLAN-ESTIMATOR-HONEST-SELL E1 — `driftExitFrom` for the `estSellForward` "list at X" forward projection); **APP-IMPORTED by `js/trends.js`** (TV, 0.60.0 — the Trends "Forward forecast" section: `diurnalForecast`/`fmtEta`, provisional PF n≈0). Console-side consumers still pending — PF7 validate. An app-behavior change to it bumps APP_VERSION. |
| `js/validate.mjs` | `pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/test/validate.test.mjs`, `pipeline/test/termstructure.test.mjs`, `pipeline/test/dipposture.test.mjs` (DP1 — `dipPostureValidator`) (P2/P3 — the validator registry: reach + floor + dip-posture); imports `js/quotecore.js` (DP1 — `recentDirection`); **APP-IMPORTED by `js/trends.js`** (TV — `reachValidator` beside the Diurnal timing chart; `floorValidator`+`trajectoryValidator` beside the 0.60.0 term-structure overlay — all inform-only) |
| `js/termstructure.mjs` | `js/validate.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/test/termstructure.test.mjs` (P3 — term structure / durable floor); **APP-IMPORTED by `js/trends.js`** (TV, 0.60.0 — the Price-history floor/ceiling overlay). Imports `js/quotecore.js` for the shared `quantileSorted` (SF-1) and re-exports it as `quantile`. |
| `js/held-item-strategy.mjs` | `pipeline/lib/market/item-context.mjs` (`pathsStage`, P4b — so `watch-positions.mjs` + `quote-items.mjs --positions` at runtime), `js/flip-niches.mjs` (P4c — `PATH_KEYS` vocabulary), `pipeline/commands/screen-flip-niches.mjs` (P4c — per-row entry-path annotation), `pipeline/test/held-item-strategy.test.mjs`, `pipeline/test/pathpersist.test.mjs` (not yet app-imported) |
| `js/flip-niches.mjs` | `pipeline/lib/signal/gatecandidates.mjs` (spec-driven gate edge/pool/rank; RF2 — `gate:'reverse'` routes to `gateReverseFlipCandidates`), `pipeline/commands/screen-flip-niches.mjs` (mode-name lists + `defaultPath`; P6b — the per-spec `estimator` family + `priceBasis`; RF2 — the `reverse` mode / `runReverseMode` branch), `js/estimators.mjs` (P6b — `estimatorFor(spec)`/`quotedPair(spec,row)` read those two fields; moved from pipeline/lib 2026-07-10), `pipeline/test/flip-niches.test.mjs` (P4c/P6b/RF2 — the declarative flip-niche registry; not yet app-imported) |
| `pipeline/lib/signal/admission.mjs` | `pipeline/commands/screen-flip-niches.mjs` (`pickFetchPool`/`buildTrackIndex` — the DEFAULT fetch-pool admission path, PLAN-SCREEN-ARCHITECTURE, 2026-07-18), `pipeline/test/admission.test.mjs`. Replaces `gatecandidates.mjs`'s `rankAndSlice` thin-lane rank (raw gp-flow → after-tax `expGpDay`) + adds a bounded rotating exploration reserve (starvation-proofing), a boost-only track-record prior off `positions.json` closed lots, and an exclusion report (every non-admitted gated candidate returned with a reason) — the fix for the Abyssal-bludgeon/Sanguinesti-staff thin-reserve starvation anchor incident (2026-07-17). `gatecandidates.mjs`'s `rankAndSlice` keeps these lane fixes out of the legacy path, is still fixture/golden-pinned, and stays selectable via `--admission legacy` for rollback — but it is NOT frozen: a fix that must hold on both paths lands in both (the `VALUE_RESERVE`, and PP-R's watch reserve, which changed its signature and return value). AR2 (PLAN-ARCHITECTURE-COHERENCE): a survivor admitted by the `Date.now()`-bucketed exploration reserve (rather than ranked in) is tagged `via:'explore'`; `screen-flip-niches.mjs` surfaces that as a small 🎲 token on the Item cell so a rotating-lottery slot reads honestly as such. The rotation logic itself is intentionally left non-deterministic (marker, not determinism fix); inform-only, no gate/rank/grade/`screen.json`-number impact. F-B (2026-07-22): `pickFetchPool`'s amplitude branch (the DEFAULT admission path — this is the one a real scan actually runs) mirrors `gatecandidates.mjs`'s watchlist reserve, since the amplitude flip-niche's own top-N slice lives here too, not only in the legacy `rankAndSlice`. PLAN-FETCH-POOL-SCALING (2026-07-24): `pickFetchPool`'s value branch gained the SAME `VALUE_RESERVE` carve-out as legacy `rankAndSlice` (both admission paths must implement it — the double-maintenance shape this file's header documents), and `clampUnionFetch(…, TOTAL_FETCH_MAX)` — the cross-flip-niche fetch-budget ceiling that clamps the deduped survivor union under `--mode all --scale-pool`, protecting held/watched/`via`-tagged reserve rows and reporting every trimmed row (reason `total-fetch-max`, never a silent drop). PLAN-MID-TIER-ADMISSION MT2/MT3 (2026-07-27): **`GEAR_RESERVE`** (`--gear-reserve`, default 4) — the last unreserved lane. Mid-price gear (Helm of neitiznot class) is too liquid for `THIN_RESERVE` and too low-margin to outrank churn on the velocity lane's absolute-`expGpDay` sort, so it was never fetched at any bankroll; the reserve gives `gear`-lane (`classifyVolLane`, `volDay < CHURN_VOL_CUT`) candidates from the velocity remainder guaranteed slots, ranked among their own lane, tagged `via:'reserve'`, additive (`0` = byte-identical to pre-MT2). Reads the lane off `volDay` (hpv+lpv, newly carried on the candidate by `gatecandidates.mjs`) and NEVER `limitVol` (min(hpv,lpv)); FAIL-CLOSED — a candidate with no `volDay` gets no slot rather than defaulting to gear. Plus `rotationPeriodMs` (MT3), which reports the exploration reserve's true per-row wait on the `crowded out:` line. PLAN-MID-TIER-V2 (2026-07-27): a re-validation showed `GEAR_RESERVE` alone does NOT reach the GE-restricted mid-price class it targets — `gear` is a VOLUME lane, so its own 4 slots go to high-buy-limit consumables (teleport scrolls, ship parts) that outrank restricted items on raw `expGpDay`, leaving Helm of neitiznot at rank 10/15. Widening it 4→10 was rejected (6 more fetches to reach a WORSE-scoring row, and it contradicts this module's own "fix the ranking dimension, not the reserve size" ruling). Added **`MID_TIER_RESERVE`** (`--mid-tier-reserve`, default 2) + **`--mid-tier-offset`**: a sibling reserve sequenced after `GEAR_RESERVE` over its leftovers, additionally filtered to `limit <= MID_TIER_LIMIT_CUT` (200) so restricted items rank against each other, with the offset paging to the next N picks. `safeSlot` guards the `.slice()` NaN/negative footgun that paging introduces — inside `pickFetchPool`, so direct callers are covered too. A null-limit candidate is excluded but REPORTED as `mid-tier-limit-unknown` (never a silent drop), since `structural-admission.mjs` deliberately does not exclude on null. All PLACEHOLDER n≈0. PP-R: `pickFetchPool` calls `gatecandidates.mjs`'s shared `watchReserved` on the band/churn/scalp path (the amplitude branch already had its own), so a watchlist item excluded from the ranked pool still gets a bounded, additive fetch slot — and a watchlist row that loses even that bound is reported `watch-reserve-full` rather than folded into `thin-reserve-full`/`top-n-full`. Measured on a live `--mode all` pair: band pool 94 → 102, band table 58 → 63 rows, ZERO rows displaced, and the DEDUPED cross-flip-niche survivor union (what actually costs requests) grew by 0–2 ids across three live snapshots (174→175, 162→162, 175→177), because amplitude's own watchlist reserve is already fetching most of the same ids under `--mode all`; the items themselves were being quoted by the always-on watchlist pass regardless, so the incremental request is the survivor-only `/1h` leg. |
| `pipeline/lib/signal/structural-admission.mjs` | `pipeline/lib/signal/gatecandidates.mjs` (`eachStructuralCandidate`/`DEFAULT_STRUCTURAL` — routed via `t.GATE === 'structural'`), `pipeline/test/structural-admission.test.mjs`. **PLAN-LANE-ADMISSION Chunk B** (2026-07-25) — the NEW edge-blind STRUCTURAL fetch-pool admission gate: one universal gate (`value ≥ 100gp` ∧ `thin = min(hpv,lpv) ≥ max(limit,25)`, null-limit → 25 fallback ∧ `notional = value × volDay ≥ 25m/day`) + a volume lane classifier (`volLane: volDay ≥ 20k → 'churn' else 'gear'` — ORTHOGONAL to the `churn` flip-niche MODE in `js/flip-niches.mjs`, a documented naming-collision risk). Exports `structuralGate(item,t?)` (pure predicate → `{pass,reason,thinDepth,notional,volLane}`), `classifyVolLane`, and `eachStructuralCandidate(ctx,t?,fn)` — an alternate iterator with the SAME callback shape as `gatecandidates.mjs`'s `eachLiquidCandidate` (gear survivors carry `thin:true` as the big-ticket/attention-floor-exempt analogue). Selectable via `GATE` (library-level only — `t.GATE` in gatecandidates.mjs; there is NO `--gate` CLI flag, nothing parses one), INDEPENDENT of `--admission` (a 2×2 with it — `--admission` is pool ORDERING, `--gate` is pool MEMBERSHIP). Purely additive behind the flag: `--gate legacy`/omitted is byte-identical (no golden/fixture change); the per-mode `spec.edge` still runs post-admission in this library-only chunk (edge-blind end-to-end is a later chunk). Thresholds (25m notional, thin-floor 25, 20k vol-cut) are NAMED PLACEHOLDERS (rule 4) — snapshot+own-book calibrated, NOT outcome-validated. |

### Test-location convention

Tests are `*.test.mjs` files that all live in **`pipeline/test/`** (R3 — one test home; e.g.
`pipeline/test/quotecore.test.mjs` pins `js/quotecore.js`, `pipeline/test/rating.test.mjs` pins
`pipeline/lib/signal/rating.mjs`). Test fixtures live beside them under `pipeline/test/fixtures/`. Each
test is plain `node <file>.test.mjs` (no framework — copy the shape of an existing one). They are
**auto-discovered**: `pipeline/ci/run-tests.mjs` recursively finds every `pipeline/**/*.test.mjs` (so
a suite placed anywhere under `pipeline/` still runs), runs each in its own child process, and
exits non-zero if any suite fails **or** if zero suites are found. CI (`.github/workflows/checks.yml`) and `/ship` call the
runner once, so **adding a test file is the whole job** — nothing else wires it in. Follow the
same rule for `js/` and `pipeline/lib/` subjects: put the test beside the file (tests for `js/`
subjects live under `pipeline/`, which is where the runner globs — the `quotecore.test.mjs`/
`format.test.mjs` precedent).
**CLOSED — the runner now fails a suite that produced NO OUTPUT.** It captures each child's
stdout/stderr (re-emitting them verbatim, so the pass-through contract is unchanged) and rejects a
suite whose combined output is empty or whitespace-only. Pinned by `pipeline/test/run-tests-silence.test.mjs`,
verified against a deliberately silent canary suite: `✗ … — SILENT: exited 0 but produced no output`,
runner exit 1. **It is a FLOOR, not a ceiling** — it proves a suite SPOKE, never that what it asserted
was meaningful; a suite whose regression check never calls the function it guards still passes.
Fixing this also required moving the runner's own body behind an entrypoint guard: it ran at IMPORT
scope, so importing `isSilent` from the new test spawned all 122 suites — one of which is that test —
and recursed without bound. Same class as the defect below, inside the guard written to catch it.
The history that motivated it: `quote-items.mjs` no-op'd global `console.log` at IMPORT scope, and every test importing
`buildQuoteReport` inherited it — `render.test.mjs` (31 checks) and `reverseflip-surfacing.test.mjs` (13)
each emitted **zero bytes**, exited 0, and were indistinguishable from an empty file. The assertions did
run and the suites did gate, so nothing was silently broken; nothing was silently VISIBLE either. **Rule:
a library module must never mutate global `console` at import scope** — a quiet-mode override belongs
inside the entrypoint guard, where the two sibling commands already had theirs.

## Local development

ES module scripts can't load over `file://` (browsers block it for CORS reasons),
so double-clicking `index.html` won't work. Run **`serve.cmd`** (launches the node
**`pipeline/commands/dev-server.mjs`**, falling back to the `py` launcher's `http.server`,
`python3`, then `npx serve` if node is unavailable) and open `http://localhost:8000/`.
GitHub Pages is unaffected — it always serves over HTTP.

`dev-server.mjs` (LW4) serves the repo-root static files exactly like the old Python
server (ES modules, correct MIME) AND exposes **one localhost-only endpoint**, `POST
/api/scan`, bound to `127.0.0.1`. It runs `node pipeline/commands/screen-flip-niches.mjs --mode all --publish`
(which rewrites the repo-root `screen.json` with **ZERO git**) and responds `{ ok,
generatedAt }`. That is what makes the Scan tab's **Refresh scan** button run a REAL scan
on the local desk: on localhost the app POSTs the endpoint, waits (~10–30s, showing a
"Scanning…" state), then re-reads the freshly-written `screen.json`. A single-flight guard
returns `{ ok:false, busy:true }` (HTTP 409) if a scan is already running. It does NO git
operations (mirroring `watch-log.mjs`'s zero-git rule) and is never reachable off-localhost
(it runs a shell command). On deployed GitHub Pages there is no endpoint, so Refresh
degrades to re-fetching the committed `screen.json` (and surfaces an honest "run the
pipeline" hint if that snapshot isn't newer) — the deployed behavior is unchanged.

**`POST /api/local-file?path=<watchlist.json|ignored-items.json>`** (LOCAL-FILE1, 2026-07-19 —
Ben: "the local server IS the app," GitHub Pages was the early proof of concept) — writes the
POST body (a JSON array/object) straight to that repo-root file, ZERO git, allowlisted by
basename. This is the localhost counterpart to `js/github.js`'s `putJsonFile`: toggling the
Watchlist/Ignore list in the app (`pushWatchlist`/`pushIgnored`, `js/ui.js`) now persists
immediately on localhost without needing a GitHub token configured — previously that write-back
only fired on the token-configured (mobile/Pages) path, so a localhost browser session's
watchlist additions lived only in `localStorage` and were invisible to the pipeline/console
screen until someone noticed the mismatch. Silent/best-effort like the GitHub path it complements;
falls through to that path automatically off-localhost.

`serve.cmd` is also the **live desk experience** (LW2): it now `start /b`s the
`watch-log.mjs` daemon in the same console (one Ctrl+C stops both, commit `74e437a`), so no
separate `watch-log.cmd` step is needed. On localhost the app polls `positions.json` +
`offers.json` + `heartbeat.json` every ~30s, so with RuneLite running every fill / cancel /
reprice shows up in the local app within ~40s — no keystrokes, **zero git commits**. The
**Watch tab** (0.49.0) is the desk surface over this data: verdict-first held cards, active
offers, today's fills, with a two-part freshness stamp instead of the deployed
Refresh-positions banner — **`watcher live hh:mm`** (from `heartbeat.json`, the real daemon
liveness signal — warns "watcher down?" if >90s stale) **·** `book synced hh:mm` (from
`positions.json`, informational, no age warning since a frozen book is normal when trading is
quiet). This split (LW3) fixed a false "is the watcher running?" alarm the old
positions-only stamp raised during no-fill stretches. On `bensumm.github.io` the poll is off
and the M1 banner + button are unchanged.

Data sources are the OSRS Wiki real-time prices API, the in-game GE guide price
(wiki module + weirdgloop history), all fetched client-side.

## Deploy

`git push` to `main` auto-deploys via GitHub Pages (Settings → Pages → deploy from
`main` / root). There is **no service worker**, so there's no cache to invalidate —
the next launch serves the new files. Deploy typically lands within ~1 minute.

## Persistence

State lives in **IndexedDB** (ledger, watchlist, settings, the growing hourly price
archives, cached snapshots), with a `localStorage`/in-memory fallback. Use the in-app
**Export** button periodically as a backstop — browsers can evict site storage under
pressure, even for installed PWAs. Export/Import round-trips the full state as JSON.

## Notes for future work

- A service worker (network-first for the HTML) would add an offline shell, but the
  app needs the live wiki API to be useful, so it was intentionally omitted.
- For an edge-to-edge iOS look: switch `apple-mobile-web-app-status-bar-style` to
  `black-translucent`, add `viewport-fit=cover` to the viewport meta, pad the header
  with `env(safe-area-inset-top)`.
