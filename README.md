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
  `money-format.js` (gp/number DISPLAY formatting — `fmt`/`fmtSig`/`fmtP`/`fmtTurn`/`fmtHour` +
  `pad2`/`parseGp`/`sgn`/`grade`/`gradeCls`; split out of the old `format.js` in the R2 rename), `charts-static.js`
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
  rank + Desirability grade off `js/estimators.mjs`+`js/rating.mjs`), `trends.js` (archive + seasonal analysis +
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
  re-exports it as `quantile`, `retrojoin.mjs` aliases `quantileOf`), `windowread.mjs` (P2 — pure window-range/reach math:
  `windowStats`/`quantLow`/`quantHigh`/`touchedDays`/`reachedDays` + the RC1
  `recencySplit`/`recentQuant` reach-contamination guard + the **hour-of-day diurnal profile**
  `hourProfile`/`deriveDiurnalRange` (2026-07-09 — de-trended per-hour dip/peak detection, side-specific
  clustering, and the stale-to-live guard; the peak-timing engine `screen-flip-niches.mjs` auto-runs and
  `windowrange --profile` prints) + `asymPair` (PART II PLAN-GRADE-REACH 2026-07-12 — the day-level
  deep-bid/high-reach-ask realizable pair + P_ask/P_bid, consumed by `js/estimators.mjs` `asymEstimate`
  for the `◆ asym fill` inform line + the `asym` suggestions-ledger shadow field) + `depthDays`/`clearableAsk`
  (PLAN-DEPTH-EXIT DE1 2026-07-15 — the percentile-DEPTH exit: reconstructs a per-day price→volume
  distribution from the 1h bucket point masses and answers "what can I actually BOOK at?" for a given lot
  size; the reach count is its qty→0 limit, and a thin book collapses to a null-with-`reason`; `@provisional-api`
  until DE2/DE3 consume it, the `DEPTH_*` constants module-internal placeholders) + `clearableBid`
  (DE6 2026-07-15 — the low-side mirror off the same side-generic engine: the LOWEST bid whose instasell
  flow at/below it fills `competition×qty` on ≥`targetFrac` of days — with `clearableAsk` the TWO-SIDED
  size-aware band; same collapse-with-reason guard, qty→0 ≡ `touchedDays`) + `demandPressure`/`reachableBand`
  (PLAN-DEPTH-EXIT Extension A PB1 2026-07-15 — the pressure-driven reachable band: `s=ln(medVolHi/medVolLo)`
  sets each side's headroom `base ± band·φ(±s)·reliability` off the recent central daily level (RC1 reused)
  + the daily-high/low IQR; a thin-VOLUME book collapses to the smoothed center via the sample-reliability
  guard (no peak-cap); the `PRESSURE_*` constants are exported n≈0 placeholders and the Soul-rune/sell-heavy
  reasonableness pins live in the test; `@provisional-api` until DE3/PB2 consume it) + `hourlyPressure`/`demandRegime`
  (PLAN-DEPTH-EXIT Extension B DC1 2026-07-15 — the per-hour demand-cycle classifier: `hourlyPressure`
  reuses `hourProfile`'s per-hour MEDIAN volumes + `demandPressure` so per-hour pressure is the ratio of
  volume AGGREGATES not median-of-ratios (no divide-by-zero on a dead hour); `demandRegime` → `{ regime:
  buy-heavy|sell-heavy|balanced, pooled, buyWindow, sellWindow, hours }` where the sell window is the
  peak-buy-pressure hours and the buy window is the sell-pressure trough; `@provisional-api` until DC2/DC3
  consume it); MOVED here from `pipeline/lib/`
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
  wired yet (PF2–PF8) and no app import → no APP_VERSION. Pinned by `pipeline/test/forecast.test.mjs`),
  `validate.mjs` (P2 — the pure VALIDATOR REGISTRY `(ctx)→{status:pass|caution|reject,reason,evidence}`
  run on EVERY surface: `reachValidator` wraps windowread reach + RC1 into caution/reject WITH the
  reach evidence; `floorValidator` (P3, BUY-side) rejects/cautions a buy parked above the durable floor;
  `trajectoryValidator` (TV1 2026-07-09, BUY-side) is the SHAPE policy over `termstructure`'s
  `classifyTrajectory` — knife/oscillating/based/elevated; `valueAmplitudeValidator` (TV1) the recent-week
  amplitude+proximity for value; `limitValidator` (LM1) the rolling-4h buy-limit; `dipPostureValidator`
  (DP1, BUY-side, INFORM-only/NEVER-REJECT) the dip DIRECTION read via `quotecore.js`'s `recentDirection`
  (a reverting dip → caution "cross or pass"; wired inform on band/churn). All degrade to pass on
  missing data and never throw. `runValidators(ctx,{specs})` drives a PER-THESIS plan (`{key,mode,window}`
  from `js/flip-niches.mjs`) — `gate` (verdict stands) vs `inform` (`informFlags`: annotate-only, clamped to
  pass, would-have verdict logged via `leanValidators`). `worstStatus`/`flags`. Screens DROP reject + FLAG
  caution + SHOW inform notes; explicit asks/held/watchlist never hidden. NOT app-imported → no APP_VERSION),
  `termstructure.mjs` (P3 — pure DOM-free multi-day term structure over a daily-mid `[{ts,mid}]` series:
  the 1/3/7/14/28d `termStructure` (median/low/high/pctInRange per lookback), a durable **floor** (low
  quantile of the longest multi-week lookback), a robust **ceiling** (P5 — the symmetric high quantile
  q85, so a lone spike can't inflate a range), a **typical fluctuation** (IQR), and a **trajectory** SHAPE
  (TV1 — `classifyTrajectory`: knife/oscillating/based/rising/elevated/flat, attached as `ts.trajectory`);
  degrades to `hasData:false`/`unknown` on a short series. Consumed by `js/validate.mjs`'s floor+trajectory
  validators + `pipeline/commands/screen-flip-niches.mjs`/`pipeline/commands/quote-items.mjs` + `js/valuescreen.mjs`; here in `js/` so validate.mjs can import it — NOT yet app-imported),
  `valuescreen.mjs` (P5 — the PURE, DOM-free gate/rank/tier math for the `--mode value` buy-hold flip-niche:
  `valueRanges` (recency-anchored shape features) / `valueScore` (composite rank with a deployable-capital
  multiplier; `capGp` threaded from `screen-flip-niches.mjs --capital÷--slots`) / `valueGate` (amplitude floor +
  artifact-low guard + knife guard + coverage guard) / `valueTier` (buy-now vs watch). Consumed by
  `screen-flip-niches.mjs`/`gatecandidates.mjs`; imports only `tax`. Full spec + all NAMED-PLACEHOLDER thresholds (n≈0)
  live in the module header; resolved rank-metric history in `docs/LORE.md`. NOT app-imported → no
  APP_VERSION. Fixture-pinned `pipeline/test/valuescreen.test.mjs`),
  `held-item-strategy.mjs` (P4a — the PURE, dependency-free PATH ENGINE core: `enumeratePaths(ctx)→Path[]`
  (candidate thesis-paths for an item — held lots get hold-recovery/value-hold/be-escape/
  list-to-clear/cut; unheld candidates get scalp/value-hold/avoid) + `weighPaths(paths,ctx)→
  {dominant,weighed,enteredUnder,migration}` (viability-weighted ordering off PLACEHOLDER heuristics
  over the derived ctx — regime/phase/underwater/aboveFloor/band-width; `no-data` evidence notes,
  degrade-not-throw). Path = `{key,thesis,action,levels,tripwire,horizon,economics,viability,evidence}`.
  Consumes the enriched ItemContext; recomputes no prices. Alternatives are decision SUPPORT, never
  alert inputs; `migration` here is the RAW instantaneous flag — the persistence-gated
  dominance/migration (arm-then-confirm + hysteresis) SHIPPED at P4b as `pathPersistence`
  (`pipeline/lib/watchstate.mjs`) + `pathsStage` (`pipeline/lib/item-context.mjs`). NOT yet app-imported →
  no APP_VERSION bump. Fixture-pinned `pipeline/test/held-item-strategy.test.mjs`),
  `flip-niches.mjs` (P4c/P5 — the PURE, DOM-free DECLARATIVE STRATEGY REGISTRY: the screen's FOUR flip-niches
  (band/churn + scalp/value; the `spread` and `rising` specs were DELETED in Steps 3+4) as data-shaped
  specs `{key,label,inAll,pool:{risingFloor},edge,rank,confirm,falling,gate,validators,defaultPath}`.
  `pipeline/lib/gatecandidates.mjs` looks up
  `FLIP_NICHES[mode]` and calls `spec.edge(...)` / reads `spec.pool.risingFloor` / `spec.rank` / `spec.falling`
  / `spec.gate` instead of branching on the flip-niche name — so a flip-niche can be added or REMOVED by editing the
  registry alone. P5's per-spec `falling` doctrine (`exclude`|`accept`|`knife-guard`), a `gate` selector
  (`band`|`value` — value routes to the term-structure `valueGate`), and the `scalp`/`value` specs (both
  off-by-default). Steps 3+4: `pool.risingFloor` is now vestigial (all false — the rising flip-niche that set it
  true is deleted) and `rank:'proxy'` is unused (rising's proxy ordering is absorbed into `rankAndSlice`'s
  rising reserve). `defaultPath` = the inferred DEFAULT ENTRY PATH the surfacing implies (band/churn/
  scalp → `scalp`, value → `value-hold` — a Ben-vetoable judgment proposal), written to
  `suggestions.jsonl` (lean `path` field) + shown as the screen's per-row entry-path annotation.
  `validateNicheSpec` + `pipeline/test/flip-niches.test.mjs` are the CONFORMANCE suite (structural contract +
  no-throw + determinism over the replay archetypes). Imports only `tax` from money-math.js + `PATH_KEYS` from
  held-item-strategy.mjs. NOT yet app-imported → no APP_VERSION bump),
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
- `manifest.json`, `icon-*.png` — PWA manifest and icons
- `fills.json` — raw real-trade event stream synced from RuneLite; the pipeline source
  `positions.json` is FIFO-reconstructed from (the app fetches the derived `positions.json`,
  not this file directly)
- `mobile-fills.log` — tracked, append-only source log the app appends mobile GE trades to
  (slot 9) via the GitHub contents API; read by `sync-fills.mjs` (M1, `FILLS-PIPELINE.md` §13)
- `positions.json` — derived from `fills.json` by the pipeline (FIFO-matched closed
  trades + open positions); the app auto-populates its Ledger/Coffer from it
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
- `watchlist.json` — tracked repo-root watchlist (array of item names/ids); the app unions it
  with local `STATE.watchlist` and `screen-flip-niches.mjs` always scans it (S3); app writes it back via
  the GitHub contents API (`js/github.js`)
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
  intent. `watch-positions.mjs` reads it READ-ONLY through `pipeline/lib/holdthesis.mjs` and passes it into
  `convictionGate` (`lib/watchstate.mjs`): while the live price holds ABOVE the declared tripwire,
  the EXPECTED signals — `UNDERWATER`/`CUT-CANDIDATE` and (VN-2) `LIST-TO-CLEAR` — are silenced to
  an armed note (the pre-peak trough is the plan, not news), and the shared display layer renders
  the lot as the `HOLD — per thesis: exit … · abort < …` frame (MONITORING.md step 4); below the
  tripwire the real-risk headline fires and normal escalation resumes.
  `momVerdict` is untouched (the raw verdict stays honest in the ledger). The Gate-2
  breakdown `CUT` is never silenced or frame-masked. Ships empty (`[]`); fixture-pinned in
  `pipeline/test/holdthesis.test.mjs` + `pipeline/test/watchstate.test.mjs` + `pipeline/test/verdictpersist.test.mjs`.
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
- `suggestions.jsonl` — tracked, append-only suggestions ledger (O1): every emitted
  recommendation, one JSON object per line, written by `quote-items.mjs`/`screen-flip-niches.mjs`/`watch-positions.mjs`
  via `pipeline/lib/suggestlog.mjs`. Rows carry a lean **`volSrc`** tag (SF-3, `'bulk'`|`'peritem'`)
  recording which `/24h` endpoint the liquidity `class` volume came from (screen = bulk; quote = bulk
  when `all24h.json` was warm, else per-item) so F1 can normalize the two snapshot sources. A row may also
  carry a lean **`askHeadroom`** object (PLAN Bar-E-signal) when the robust p90 shaved a TRADED in-band top
  off the quoted ask — `{gap, gapPct, rawTop, topBucketVol, netLever, trusted}`, logged trusted AND
  audit-only, joined to fills by `analyze.mjs` §5 (`askHeadroomAudit`) for F1. A `watch` held row may
  carry the lean **`depthExit`**/**`reachable`** pair (PLAN-DEPTH-EXIT DE3, 2026-07-15): the depth-floor
  read incl. its collapse REASON + liquidity class, and the pressure-driven reachable band. RC-S1/RC-S2
  (PLAN-REACHABILITY-CONSOLIDATION) co-log all five competing exit estimators — reach (`estConfidence`) ·
  reachRelief (**`estBuy`/`estSell`/`estConfidence`**) · **`asym`** · depth (**`depthExit`**) · pressure
  (**`reachable`**) — for the F1 head-to-head against the realized `sellEach`. The head-to-head spans HELD
  (watch, quote `--positions`) AND DISCOVERY (screen survivors, quote per-item): `reachable` rides every row
  with an in-hand 1h series; `depthExit` rides only held rows (real qty in hand — the DE7 fetch-budget rule
  keeps depth off the screen). All three shadow shapes come from ONE reshaper home
  (`suggestlog.mjs reachableShadow`/`depthExitShadow`/`asymShadow`). A screen survivor row also carries a
  lean **`demandRegime`** `{ regime, pooled, sellWin?, buyWin? }` (PLAN-DEPTH-EXIT DC3 inform half,
  2026-07-15 — the dip-buy-vs-sell-into-demand flip-side axis off `js/windowread.mjs demandRegime`, surfaced
  as an `◈ demand` inform note for a clearly-tilted survivor; INFORM-ONLY, never a rank/gate/grade/`screen.json`
  input — the routing/rank half is F1-gated). A screen row also carries
  the **`expGpDay`**/**`expGpDayLegacy`** shadow pair (PLAN-CAPITAL-THROUGHPUT, 2026-07-14): the ACTIVE
  capital-aware attention-floor throughput (`min(limit, deployablePool/mid)×6 × net`) beside the legacy
  capital-blind value, so `--stats`/F1 can diff old-vs-new surfacing (`--throughput legacy` restores the
  blind value). A churn/scalp screen row (and every `quote-items.mjs` per-item read) also carries a lean
  **`winClear`** object (PLAN-WINDOW-CLEAR B2): the within-window CLEAR read for the quoted ask over its
  diurnal peak window — `{windowReach, reachedDays, nDays, pool, clearRatio, wStart, wEnd, diverges}` — so
  F1 can test whether the days-reach ≠ lap-clear divergence predicts an unfilled/slow ask (the note fires
  on the window-reach leg only; `clearRatio`/`sizeShort` ride the shadow for calibration).
  **Bounded to the CURRENT month (SR1):** on append,
  `logSuggestions` rolls any completed month out to a monthly archive (see below), so the
  root file never grows past ~a month of rows. F1-gating accrual is preserved — history is
  archived, never deleted.
- `pipeline/suggestions-archive/` — tracked dir of completed-month archive files
  `suggestions-YYYY-MM.jsonl` (SR1), moved OUT of the deploy root by `rotateLedger`
  (`pipeline/lib/suggestlog.mjs`). Same schema/lines as the active ledger; the append-only O1
  calibration history. Read together with the active file via `readSuggestionLines` — any full-
  history reader (`join-outcomes.mjs`'s F1 join, `retrojoin.mjs`'s P6a suggestion→fill join) MUST use
  that helper, not the active file alone.
  Created lazily on the first rotation (empty until a month completes); committed by
  `sync-fills.mjs` alongside `suggestions.jsonl`.
- `screen.json` — the published opportunity screen the app's Scan tab renders (written by
  `screen-flip-niches.mjs --publish`)
- `PLAN-OUTPUT-TABLE.md` — in-flight per-topic plan: the reach-folded `Est. buy`/`Est. sell`
  console table (shipped 2026-07-13 as `js/estimators.mjs` `estimatePair` + the `screen-flip-niches.mjs`/
  `quote-items.mjs` default stdout view with `--raw` as the model-free escape hatch; console-only, no
  `screen.json`/app change). Folds into `PLAN.md` and is deleted when its last chunk ships (the
  plan-file rule).
- `PLAN-VOL24.md` — in-flight per-topic plan: the `/24h` endpoint is broken (serves a frozen stale
  ~1–3h UTC-day slice, under-reporting true rolling 24h ~10–27×). Steps 1+2 (SHIPPED 2026-07-13) — the
  corrected `/1h`-composed rolling source (`marketfetch.mjs` `loadAll24hRolling`/`rolling24FromTs1h`) is now
  the DEFAULT `screen-flip-niches.mjs` volume (`--vol-source legacy` = escape hatch), and every volume-denominated floor
  was count-matched to the corrected distribution (`FLOOR`/`VALUE_LIQ_FLOOR` 50→3500, `CHURN_MIN_VOL`
  2000→65000, `DIP_LOOP_LIQUID_FLOOR` 1000→40000, `GP_FLOOR` 250m→4.5b, `DL4_MIN_GP_FLOW` 500k→9m; `MIN_GPD`
  KEPT at 500k — Ben, real NET-throughput floor; `DL4_MIN_ABS_SWING` unchanged). `volDayRolling` logged on
  `suggestions.jsonl`. Step 3 REMAINING = the browser app fix (`js/marketfetch.js` Finder/Watch/Trends still
  read the broken `/24h`; APP_VERSION-bumping). Folds into `PLAN.md` and is deleted when step 3 ships.
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
  lint-arch/docs/skills, run-tests, smoke-test); **`pipeline/lib/`** = the imported-only
  shared libraries; **`pipeline/probes/`** = the probe framework; **`pipeline/test/`** = all
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
    `add-manual-fill.mjs` (inject/tombstone
    manual fills), `quote-items.mjs` (per-item / `--positions` market table; PM1 stdout-only `Probes`
    column when a probe fires. `--positions` builds the shared `item-context.mjs` chain per lot — offers.json
    book, read-only watch-state + hold thesis, the shared `renderHeldVerdict`, and a read-only `pathsStage`
    `Paths` block — so it can't disagree with watch-positions.mjs; Proposal C (2026-07-12) adds the INFORM-ONLY
    stale declared-exit flag per held lot (`lib/staleexit.mjs` over a targeted TTL-cached 1h fetch —
    declared-exit lots only); behavior detail in CLAUDE.md "Script facts"), `screen-flip-niches.mjs`
    (opportunity screen; YP2 adds a stdout-only "WATCH CLOSELY" transition list; PM1 a stdout-only
    `Probes` column per flip-niche; P6c re-runs an empty flip-niche beneath the floor (`subFloorFallback` in
    `lib/gatecandidates.mjs`, honestly labeled + grade-capped + stdout-only, never in `screen.json`; the
    two-sided gate and thesis edge are never relaxed)),
    `watch-positions.mjs` (adaptive live position/offer monitor — the V1–V6 cross-pass memory surface: per-pass
    Δ/structural-support lines (`lib/watchstate.mjs`/`levels.mjs`, persisting `.cache/watch-state.json`),
    the V5 EMIT-CONTRACT note block (`lib/emit.mjs`), and the shared held-verdict + dominant-path lines
    (`renderHeldVerdict`/`pathsStage`, `lib/item-context.mjs`). DE3 (PLAN-DEPTH-EXIT, 2026-07-15): each
    held lot's window clause now carries the whole-day depth FLOOR (`clearableAsk` — supersedes the
    relief note when non-null; a collapsed read prints its REASON) beside the pressure-reachable band
    (`reachableBand`), formatted by `lib/emit.mjs depthReachClause` and shadow-logged as the lean
    `depthExit`/`reachable` ledger fields (inform-only — no verdict/price/grade input). RC-S1
    (PLAN-REACHABILITY-CONSOLIDATION, 2026-07-15): held rows ALSO co-log the two OLDER exit estimators —
    the reachRelief-family `estBuy`/`estSell`/`estConfidence` (`estimatePair`, `declaredExit` nulled so the
    scored number is the model's intrinsic ask) + the fixed-quantile `asym` pair — so all FIVE competing
    exit-price estimators ride ONE row for the F1 head-to-head against the realized sell; zero new fetch,
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
    `derive-cash.mjs` (CLI to DERIVE / re-anchor / clear the idle-cash balance: bare = the derived balance
    (anchor + Σ sells-after-tax − Σ buys − resting escrow, via `lib/derive-cash-tiers.mjs`); `<amount>` =
    re-anchor the `.capital-state.json` starting point — the total-capital denominator `watch-positions.mjs`'s
    SUMMARY reads),
    `read-window-range.mjs` (né `nightlows.mjs` — time-of-day
    range read / overnight fill-realism scoring; `--profile` = the hour-of-day diurnal dip/peak read
    + derived stale-guarded bid/ask; `--depth <qty>` = the PLAN-DEPTH-EXIT DE2 percentile-depth inspector,
    BOTH edges since DE6: per-day instabuy flow at/above the scored `--ask` + the `clearableAsk`
    "BOOK AT ≤ X", and per-day instasell flow at/below a scored `--bid` + the `clearableBid`
    "CATCH AT ≥ X" (the two-sided size-aware band), with the collapse REASON surfaced on a thin book —
    inform-only, reads `js/windowread.mjs` `depthDays`/`clearableAsk`/`clearableBid`; `--pressure` = the
    PB2 demand-balance read: `pressure` (medVolHi/medVolLo) + regime label + `reachableBid`/`reachableAsk`
    (`base ± band·φ` inline) + reliability, off `demandPressure`/`reachableBand`, inform-only n≈0; DC2
    adds the per-hour demand cycle + the SELL/BUY timing windows (`demandRegime`) + a cross-check vs the
    price dip/peak windows — `✓ demand-confirmed` / `✗ diverge`), `limits.mjs` (LM1 — the buy-limit read:
    `node pipeline/commands/read-buy-limits.mjs "<item>" [...]` prints limit / bought-this-4h-window / remaining /
    local `next frees ~HH:MM` · `fully resets ~HH:MM` off `fills.json` + the mapping, NO market fetch;
    no-args reports every item with a logged buy in the last 4h. Window math in `lib/limits.mjs`),
    `trigger-alerts.mjs` (N1 push-notification trigger
    engine — behind the standard `import.meta.url === pathToFileURL(argv[1])` invocation guard
    (TD2) so importing it for tests never runs/fetches; exports `positionSignal`/`quietSuppresses`),
    `join-outcomes.mjs` (derived campaign/outcomes join — gitignored output; schema v2 (YS1) adds per-campaign
    `stateAtFill` (band-pctl+regime+phase AS OF the fill via `lib/range-position.mjs`, for EVERY fill),
    measured `holdTimeSec`/`parkedSec`/`velocityClass`, and `predicted` (copied from the joined
    suggestion, null on pre-YS2 rows); reconstruction routes through `dedupeSnapshots`. COD-3: `--report`
    stamps `.cache/last-weekly-report` and the cheap standalone `--weekly-due` prints `weekly-due: yes|no`
    off the local Mon–Sun week so `/morning`'s weekly-read cadence is mechanical, not "ask Ben". `--report`
    prints TWO readiness gates: the F1-gate progress line (general calibration) and the **Reachability
    head-to-head** accrual (RC, `PLAN-REACHABILITY-CONSOLIDATION`) — closed-sell round-trips carrying the
    five-way exit co-log (`joinSuggestion`'s `coLog` marker), bucketed into the scorer's (side × class ×
    regime) cells, so the weekly retro shows WHEN `aggregateReachability` becomes scorable without polling),
    `retrojoin.mjs` (P6a — the SUGGESTION→FILL retro-join REPORT: read-only, prints per-flip-niche +
    per-path outcome accounting — filled / filled-worse / not-taken counts, realized TTF median/
    spread, and realized profit per unit of attention — over EVERY suggestion row × `fills.json`
    buy offers. The SUGGESTION-keyed FORWARD counterpart to join-outcomes.mjs's campaign-keyed backward
    join; the ground-truth TTF calibrator for P6 and the input to the band/churn
    consolidation question (the spread/rising flip-niches were deleted in Steps 3+4). Join logic is the pure `lib/retrojoin.mjs`; `--json` dumps raw rows.
    n on every aggregate, deliberately NO grades/verdicts — the archive is weeks-cold and mostly
    not-taken),
    `analyze.mjs` (PLAN-ANALYZE AZ1 — the ANALYSIS ENGINE: read-only IO+print shell that AUDITS the
    dataset's health (ledger freshness/volume, field-DROP detection — an ALWAYS_FIELD that stopped being
    logged, fills⇆ledger un-attributed-buy coherence, a rebuildability PROXY = inputs parse + positions.json
    fresh vs fills.json, and forward-data recommendations), ORCHESTRATES the existing joins for a compact
    per-flip-niche RETRO ROLLUP (invokes `retroJoin`/`aggregateOutcomes` — re-implements nothing), a **DL2
    dip-loop retro §4** (`dipLoopAudit` — joins the widened flush log against the retro rows, segments
    `alerted` (liquid) from `signal-only` (illiquid → DL3 input) rows, and computes fillable-vs-not
    separation over the alerted subset; candidate-surfacing → points at F1, never retunes; n≈0 placeholder),
    a **Bar E ask-headroom retro §5** (`askHeadroomAudit` — pulls the lean `askHeadroom` shave-gap flags,
    segments trusted (surfaced) from untrusted (audit-only), joins the trusted subset to the retro
    round-trip incl. the STRICT raw-top-reach answer (`rawTopReached` off retrojoin's realized `sellEach`,
    2026-07-12 — unanswerable rows degrade to unknown); candidate-surfacing → F1 owns `ASK_HEADROOM_*` +
    the deferred clamp-widen; n≈0 placeholder),
    and derives
    n-gated TUNING CANDIDATES that are FLAGS for F1, never applied here; a ~0% taken rate is treated as the
    documented BASELINE, not a finding. `--since <hrs>`/`--json`/`--min-n`. Pure core is `lib/analyze.mjs`,
    fixture-tested by `analyze.test.mjs`; consumed by the `/analyze` skill (AZ2). READ-ONLY — never in a
    commit/sync path)
  - **Shared libraries (`pipeline/lib/*.mjs`, imported only):** `analyze.mjs` (AZ1 — the PURE audit +
    tuning-candidate core: `auditDataset`/`deriveCandidates`/`fieldPresence`/`dipLoopAudit`/`askHeadroomAudit`
    + the NAMED-PLACEHOLDER
    thresholds; no fs/no fetch, the honesty n-gates live here so a skill can't launder a thin signal),
    `reconstruct.mjs` (shared
    FIFO reconstruction + `dedupeSnapshots`; ARCH-1 adds `buildTombstonedEvents` — the live-log →
    tombstone-filtered event list monitor-offers.mjs reconstructs from, mirroring sync's inline REMOVE-tombstone
    filter), `offers.mjs` (exchange-log discovery + open-offer
    semantics; P0 also adds `readOffersSnapshot`/`askFromSnapshot`/`bidFromSnapshot` — the OTHER-machine-safe
    reader of the flat root `offers.json`, normalized to the `{price,filled,total}` shape the context
    position stage wants, so quote-items.mjs can see the live book without the `~/.runelite` log dir),
    `positions.mjs` (shared `readOpenPositions` open-lot grouping), `limits.mjs` (LM1 — PURE rolling-4h
    buy-limit window math: `limitWindow({buys,limit,now})` → `{limit,boughtInWindow,remaining,nextFreeAt,
    fullResetAt}` (null limit = UNKNOWN, never unlimited) + `buysByItem(events)` extracting per-item BUY
    fills the SAME way `reconstruct.mjs` does (`collapseOffers∘dedupeSnapshots`, final cumulative filled,
    banked/sells excluded). Consumed by `pipeline/commands/read-buy-limits.mjs` CLI + `screen-flip-niches.mjs`/`quote-items.mjs`'s
    `limitValidator` ctx; honesty: logged fills only, so `remaining` is an UPPER bound), `archive.mjs`
    (D0 — the Tier-1 SQLite market archive: a thin `node:sqlite` (`DatabaseSync`) wrapper storing
    RAW `/1h`+`/5m` bulk observations keyed `(grain, ts, itemId)` with `INSERT OR IGNORE` + WAL/
    busy_timeout. `open`/`append`/`seriesFor`/`marketAt`/`exportFixture`/`pruneBefore`; NEVER archives
    `/latest` (no idempotent bucket); stores only raw fields — every derived value is recomputed by
    pure functions, never cached; `hasBucket` is the check-before-fetch predicate. Backs `loadDaily`
    (with a one-time `daily_seed` import of the pre-D0 `.cache/daily` mids). Surgically suppresses the
    one `node:sqlite` ExperimentalWarning via a `process.emitWarning` filter installed before a
    `createRequire` load — no global `--no-warnings` flag on any script. CLI: `node
    pipeline/lib/archive.mjs [--prune-before <ts>]` (prune shipped, unused by default)), `marketfetch.mjs`
    (node-side price/guide fetch layer + historical bands `loadHistBands`/past-anchored 6h series
    `loadHistDaily` (YF1) + `loadDaily` re-pointed at the D0 archive (byte-identical `{ts,mid}` output,
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
    the broken `/24h` endpoint that serves a frozen stale ~1–3h slice) + `rolling24FromTs1h(ts1h)` (the same
    sum off an already-fetched per-item 1h series → zero new fetch) — now the DEFAULT `screen-flip-niches.mjs` volume
    (`--vol-source legacy` restores the broken `/24h`; PLAN-VOL24 step 2), with the volume floors recalibrated
    to the corrected distribution; consumed by `screen-flip-niches.mjs` and logged as the `volDayRolling` shadow field for the
    floor recalibration (`PLAN-VOL24.md`) + `vol24FromInputs(inp)` (PLAN-VOL24 step 2b — the per-item corrected
    volume for `quote-items.mjs`/`watch-positions.mjs`: `rolling24FromTs1h` off the in-hand `ts1h`, reassigned onto `inp.vol24`
    so Vol/d + pressure + the dip reference read corrected volume; degrades to the `/24h` read when the 1h series
    is too short)), `cli.mjs` (shared arg/format/table
    helpers). **`rating.mjs` and `estimators.mjs` MOVED to `js/` (2026-07-10, app-parity Wave 2a)** —
    now **APP-IMPORTED by `js/market.js`** (AP4, 0.61.0 — the Finder Grade column + Rating bar + sort use
    the shared `estimateRank` + `rateItem`, replacing the old `RATE_W` profit/hr Risk model; coarse
    live-quick basis in the Finder — the per-item quote is the band-precise read); `pipeline/lib/`
    keeps a one-line re-export shim at each old path so every node importer resolves byte-identically.
    Their descriptions (retained here for the pipeline reader): `rating.mjs` (grade/score model — P6b:
    the reward basis is the per-thesis RANK
    `net × P(fill) ÷ TTF` from `estimators.mjs`, NOT the demoted expGpDay; cutoffs are on that rank
    scale, still PLACEHOLDERS), `estimators.mjs` (P6b — the PURE per-thesis P(fill)+TTF estimators +
    the `rankScore` composite that REPLACED expGpDay as the displayed/graded metric (Ben 2026-07-09:
    "gp/d is out"). Families keyed by a spec's `estimator` field — `intraday` (band/scalp: P(fill) from
    band-depth / a real windowread reach when fetched, TTF from volume velocity), `churn` (Step 6,
    decision A — reuses intraday P(fill)/TTF but ranks the LAP via `churnLapUnits` = min(limit, feasible
    depth), so estimateRank multiplies net × lapUnits: on buy-limit-cycle commodities we always max the
    limit), `value` (P(fill)=floor-proximity, TTF=trough→recovery prior), and `rising` (regime/forecast
    horizon — retained but no shipped spec uses it since the rising flip-niche was deleted, Steps 3+4);
    each estimate is `{value,n,basis}` so the honesty travels with the number. `quotedPair(spec,row)`
    is the ONE price pair the thesis posts (the price-basis principle); `estimateRank(spec,row,extra)`
    bundles pair/net/pFill/ttf/rank (Proposal A two-leg P via `askReachFactor` — SKIPPED for
    `fillShape:'symmetric'` specs, the PART II churn exemption); `asymEstimate(spec,row,asymPair)`
    (PART II PLAN-GRADE-REACH — the asymmetric deep-buy/reliable-sell estimate: rank = net × P_ask ÷ TTF,
    P_bid is annotation-only, ordering guards; feeds the inform line + the `asym` ledger shadow field +
    `screen-flip-niches.mjs --asym`); `estimatePair(spec,row,extra,{nudge})` + `entryDoctrine`/`estPairCells`/`estConfLean`/
    `EST_HEADERS` (PLAN-OUTPUT-TABLE 2026-07-13 + REVISIONS — the RECONCILIATION estimator behind the
    console-default `Est. buy`/`Est. sell` columns: `Est. buy` is STRATEGY-AWARE (`entryDoctrine(spec)` off
    the existing falling/priceBasis fields — scalp near-live · value trough · band/churn reach-folded; the
    asym DEEP bid is never folded in — rev3); `Est. sell` anchors to a declared `hold-thesis.json` exit
    ONLY on a HELD lot (FIX 1 — an open lot in positions.json; the discovery screen never anchors), else
    the reach-folded band top + diurnal/asym blend; confidence is the RECENT-3 reach
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
    (Steps 3+4 — front-loads the highest-proxy risers, the absorbed `rising` flip-niche mechanism), and the
    extracted post-fetch `surviveMode(mode,row,phase,opts)` — falling doctrine/`--phase-rescue`/the
    scalp falling-confirm (+ a vestigial rising-confirm)/overnight-posture, returning
    `{keep,discardReason,rescued}` that maps 1:1 onto renderMode's `disc` counters. **P5**:
    `surviveMode` reads the PER-SPEC `spec.falling` (band/churn keep `exclude`; scalp `accept`s AND
    requires fallers), and `gateCandidates` routes a `gate:'value'` spec to `gateValueCandidates` (the
    term-structure value gate off `ctx.daily` + `js/valuescreen.mjs`) with `rankAndSlice` hard-top-N'ing
    the value pool by `valueScore`), `replay.mjs` (P1 — the
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
    forward prediction fields — `posture` and the plumbing for `tripwire`/`fillWindowHrs`/`velocityClass`/`thesis` —
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
    orders/formats already-computed pieces, decides nothing — output-format-only),
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
    "how long bids sat" + velocity mix over outcomes campaigns) + `totalCapital` (committed +
    idle cash → the WHOLE-pool idle-vs-working split, null-safe when cash is unknown; the idle
    figure it's fed is now the DERIVED `availableCash` from `derive-cash-tiers.mjs`, not a stated snapshot);
    output-only, never a verdict input),
    `cash-anchor.mjs` (impure fs sibling — `readCash`/`writeCash`/`clearCash` over the gitignored
    `.capital-state.json`; now the ANCHOR store rather than the answer — kept out of pure
    `capital-utilization.mjs`),
    `derive-cash-tiers.mjs` (PLAN-CASH-TRACKING — PURE `deriveCash(events, anchor, liveOffers)` +
    `restingBuyEscrow` deriving idle cash from the fills-log flow (Σ sells-after-tax − Σ buys since the
    anchor) minus LIVE-offers.json resting-bid escrow, so the balance is computed not re-stated; the
    INJECTION DETECTOR raises the anchor when resting bids exceed the tracked balance; `loadDerivedCash`
    is the impure loader (fills.json + offers.json + `cashstate` anchor). Pinned by `derive-cash-tiers.test.mjs`),
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
    touches `momVerdict`; fixture-pinned `holdthesis.test.mjs`),
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
    `probes.mjs` (PM1 — the probe-module LOADER + stage-keyed runner: auto-discovers
    `pipeline/modules/*.mjs`, groups by stage (`observe`/`price`/`gate`), and `runProbes(row,surface,ctx)`
    returns the fired display annotations. **Presence = enabled** (delete the file to disable). The
    **empty-passthrough guarantee** — no module present or none fire ⇒ `[]` ⇒ nothing appends ⇒
    byte-identical output — is the removability contract. `collectNeeds` exposes the multi-item
    `needs(row,ctx)` sibling-id declaration (decant). NO probe of any stage feeds a
    verdict/gate/rating/reconstruction — observe probes touch no number, price probes touch only the
    advisory recommendation. `logFirings(fired,meta)` (PM2) appends the fired annotations to
    `pipeline/modules/<module>.log` — called by each surface AFTER the PURE runProbes; failure-safe)
  - **Probe modules (`pipeline/modules/*.mjs`, PM1 — experimental per-item theory plug-ins):** each a
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
    since the per-item quote surface has no whole-market map). The gitignored `pipeline/modules/<name>.log`
    firing log is now WIRED (PM2): `logFirings` appends one compact JSONL line per firing —
    `{ts,module,version,stage,surface,id,name,tag,price(price-stage),quickBuy,quickSell,guide,regimeLabel,phase}`
    — the hit/miss ledger the validate-before-promote loop scores later (SCORING is a later chunk).
  - `lint-skills.mjs` (P7 — a HEURISTIC linter for the four market `SKILL.md` files, run in CI's
    cheap `checks` job + auto-discovered by `run-tests.mjs` via its test: every top-level `- **…**`
    rule-block must carry a backticked `code-pointer` OR an explicit `judgment:` tag; FAILs on
    untagged blocks and prints per-file + total counts so untagged-prose GROWTH is visible. Exports
    `lintText`/`lintFile`/`SKILL_FILES` for the test. Deliberately NOT a Markdown parser — a
    growth-visibility guard; the semantic dispositions live in `docs/SKILL-TRIAGE.md`),
  - `lint-docs.mjs` (DL1 — a STRUCTURAL, offline doc-drift linter run in CI's cheap `checks` job +
    auto-discovered via `lint-docs.test.mjs`; the CI-encoded half of process rule 8. TWO checks:
    (1) a maintained **DENYLIST** of superseded terms/commands × the operating docs they'd mislead
    (seeded: the deleted spread/rising flip-niches listed as live, an unqualified global falling-exclusion,
    and the removed per-flip-niche mode flags — see the `DENYLIST` table in the source for the exact patterns)
    — a ruling that deletes a concept adds a line, CI then catches every future doc
    that resurrects it; an `xfail` records a KNOWN live violation owned elsewhere (index.html's stale
    Scan-intro = PLAN-APP-PARITY AP1) so CI stays green while the finding stays reported; and
    (2) a **single-source / duplicate-phrase** check that flags a distinctive 14-word shingle appearing
    verbatim in >1 doc on the CLAUDE.md ⇆ README.md axis (the copy-not-move failure), with a `DUP_ALLOWLIST`
    for legit shared boilerplate + known pre-existing dups owned by DOC-2/DOC-3. **MUST stay a
    denylist + structural checker — never a semantic/LLM checker** (the skill-lint honesty note applies
    verbatim: it catches recurrence of NAMED drift + novel COPY, NOT novel contradiction; the wave-start
    semantic drift scan stays necessary). Exports `DENYLIST`/`runDenylist`/`normalizeWords`/
    `findDuplicateShingles`/`runDuplicatePhrase` for the test),
  - `check-imports.mjs` (PLAN-VOL24 follow-up — the CI import-RESOLUTION guard run in the cheap `checks`
    job: STATICALLY parses each pipeline entrypoint's relative `import { … } from './x.mjs'` and verifies
    every named/default import exists in the target module's exports, dynamic-importing ONLY the pure lib
    targets (never the entrypoints — so no main()/fetch/git/argv side effect fires). Closes the gap that let
    screen-flip-niches.mjs's missing `dayHighFrom5m` import ride onto main undetected — `node --check` is syntax-only, no
    test imports the entrypoints, smoke loads only the browser app. Fast/offline/deterministic; exits non-zero
    naming the offending entrypoint→module→symbol),
  - `check-dead-exports.mjs` (RC-A guard, 2026-07-14 — the INVERSE of import-check, run in the cheap `checks`
    job: a name-based, comment-stripped, deliberately CONSERVATIVE static scan of `js/` + `pipeline/` that
    fails if any export has NO non-test consumer — the recurring "kept-for-future / until-torn-out" vestigial
    pattern (its motivating case, `risingPoolFloor`, was removed by the same cleanup). An export exists solely
    for its test declares that inline: `// @test-only: <reason>` or `// @provisional-api: <reason>` (an intended-
    but-unwired API citing a tracking item) immediately above it — the acknowledgement travels with the code.
    Uses a character-scanner comment stripper (strings/templates/regexes preserved verbatim, so an identifier in
    a `${…}` interpolation still counts — the STAGES false-positive lesson). Pure helpers exported + pinned by
    `check-dead-exports.test.mjs`,
  - `lint-arch.mjs` (doc-reference guard, 2026-07-14 — enforces `docs/ARCHITECTURE.md` invariant E7 in the
    cheap `checks` job: every code-font FILE token the governed doc names must resolve on disk — a path from
    root, a bare basename against the source dirs; function/field names are skipped, `PLAN-*.md` working docs
    are exempt, genuinely-future files sit in its `PROPOSED` set. Catches rename/delete drift in the doc,
    esp. through the directory rename. Structural/existence only, never semantic; pinned by
    `lint-arch.test.mjs`),
  - `smoke-test.mjs` (CI headless-chromium DOM smoke of `index.html`, all external network stubbed),
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
    (arg/`parseGp`/`median`), `windowread.test.mjs` (window-range quantiles + the RC1 recency-split reach-contamination guard; moved to `pipeline/` beside the other `js/`-module tests when P2 moved windowread to `js/`), `forecast.test.mjs` (PF1 — the `js/forecast.mjs` diurnal+trend model: the pinned BLOOD-RUNE golden (whenBuyable ≈ 4h at the projected trough), the anchor boundary condition, the downtrend step-down, the loud degrades (spike/decay/band-violation/thin/no-anchor/trend-only), and the band-non-shrinking + additive-dispersion-fields checks — all synthetic, no fetch/fs), `validate.test.mjs` (P2 — the validator registry semantics + reachValidator fixtures: rarely-reached→caution, never-reached→reject, RC1 stale-optimistic→bumped reject, and the no-data/thin-sample degrade-to-pass contract),
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
    guaranteed sell line + fixed field order + `heldListAt` precedence), `recovery.test.mjs` (V6 — the
    advisory recover-vs-drop composition, the spike confidence-cap, and the trigger gating) and
    `freed-capital.test.mjs` (V6 — freed-capital detection + the first-seen/stale-gap/grown-lot anti-misfire
    guards), `fetchcache.test.mjs` (FC1 — the opt-in fetch cache's TTL hit/miss + byte-identical
    payload + default-off toggle), `range-position.test.mjs` (YF1 — `deriveState` band-percentile
    clamp, regime/phase off a synthetic 6h series, and the `reconstructed:false` honesty guard),
    `velocity.test.mjs` (YS1 — the velocity-class half-open boundaries + n/a guard),
    `capital-utilization.test.mjs` (YV1 — `bookUtilization` split/edges + `parkedStats` counts/median/mix
    + `totalCapital` committed/idle-cash split, null-safe when cash unknown),
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
    counting, and the LIVE regression guard that all four committed SKILL.md files lint clean),
    `lint-docs.test.mjs` (DL1 — the doc-drift linter's two checks: denylist pattern precision (live-flip-niche
    form hits, deletion prose does NOT), the live corpus has no hard denylist violations + STILL catches
    the index.html AP1 drift as xfail, `normalizeWords`/`findDuplicateShingles` on synthetic docs
    (≥14-word verbatim passage flags, short overlap + single-home + null-doc don't), and the live
    CLAUDE.md ⇆ README axis is clean),
    `expunitsovernight.test.mjs` (COD-2 — pins `expUnitsOvernight` = `expUnits × 8/24`: the alignment
    identity so the accumulation-sizing constants can't drift from the day figure, the documented
    closed form `min(limit×2, 8/24×0.10×volDay)`, and the limit-bound/volume-bound/null-limit/zero-vol edges),
    `rebid.test.mjs` (COD-3 — the cut-and-rebid helpers in `js/quotecore.js`: `rebidBar`'s friction
    arithmetic (tax + half-spread below the clear) + `rebidAdvice`'s trajectory-branch selection — knife→against,
    oscillating→rebid-at-trough/sell-peak with diurnal level carry-through, else→friction-bar governs),
    `sf3-volsrc.test.mjs` (SF-3 — the liquidity-`class` volume-source split: `classAndSource` CLASS PARITY
    (a warm bulk map converges quote's logged class on screen's, even across a per-item straddle) + the
    cold `peritem` fallback (pure/synchronous ⇒ no fetch) + `readWarmAll24h`'s fetch-free warm/stale/absent
    reads — all synthetic, no network)
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
    deleting it just loses one pass of delta history)
  - `pipeline/.guide-history.jsonl` (**tracked** as of 2026-07-06 — Ben's call: it's an accruing
    observation record, so it lives in the repo to survive a lost machine; kept OUTSIDE `.cache/`
    so cache pruning never touches it) — change-only GE guide-price observations for watched items,
    one JSON line `{ts,id,name,guide,prev}` per observed change, appended by `watch-positions.mjs`
    `logGuideChanges()` at watch cadence. Purpose: pin each item's ~daily guide-update
    time + magnitude to feed the guide-re-anchor pricing edge (PLAN.md Discovered,
    2026-07-06). Consumer: `pipeline/lib/guideanchor.mjs` (YP1 — the guide re-anchor model, honesty-gated
    on accrual; quote-items.mjs/watch-positions.mjs surface its advisory line, silent until enough real updates accrue). (Not auto-committed by
    `sync-fills.mjs`; commit it periodically so the record on `origin` stays current.)
  - `pipeline/.market-archive.sqlite` (+ `-wal`/`-shm` sidecars) — **gitignored, machine-local, D0**:
    the Tier-1 SQLite market archive. Append-forever RAW `/1h`+`/5m` whole-market observations
    (~30–35GB/yr, Ben-approved) that the wiki API only serves ~30h/item live — the ONLY route to broad
    intraday history, feeding P3's term structure + P6's backtests. Deliberately OUTSIDE `pipeline/.cache/`
    (that tree is disposable/pruned; the archive must survive). Producer: `pipeline/lib/archive.mjs`
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
| `suggestions.jsonl` | appended by `pipeline/lib/suggestlog.mjs` (O1 fields + YS2 forward `posture?`/… + SF-3 `volSrc?`); SR1-bounded to the current month | tracked, append-only |
| `pipeline/suggestions-archive/suggestions-YYYY-MM.jsonl` | completed months rolled out of the active ledger by `rotateLedger` (SR1); read with the active file via `readSuggestionLines` | tracked, append-only (lazy) |
| `outcomes.json` | derived by `pipeline/commands/join-outcomes.mjs` (F1 join reads active+archives) | gitignored |

### Shared logic modules

`js/quotecore.js`, `js/money-math.js` and `js/money-format.js` are served to the browser **and** imported by node —
an edit ripples into the pipeline scripts and CI, not just the app. After editing either,
run `pipeline/test/quotecore.test.mjs` + `pipeline/test/reconstruct.test.mjs`.

| Module | Also imported by (pipeline) |
| --- | --- |
| `js/quotecore.js` | 13 files: `quote-items.mjs`, `screen-flip-niches.mjs`, `watch-positions.mjs`, `monitor-offers.mjs`, `trigger-alerts.mjs`, `lib/cli.mjs`, `lib/reconstruct.mjs`, `lib/retrojoin.mjs` (P6a — `tax` for suggested-net; SF-1 — `quantileOf` for the p25/p75 latency spread), `add-manual-fill.mjs`, `quotecore.test.mjs`, `watchcore.test.mjs` (`offerVerdict`, shared with the app Watch tab), `dipposture.test.mjs` (DP1 — `recentDirection`); plus the js/ side-imports `js/termstructure.mjs` (SF-1 — re-exports `quantileSorted` as `quantile`) + `js/validate.mjs` (DP1 — `recentDirection` for `dipPostureValidator`) |
| `js/money-math.js` | the tax/margin/bond MATH (split from `format.js`, R2): `quote-items.mjs`/`screen-flip-niches.mjs` (`tax`) + js-side node imports `js/flip-niches.mjs` (`tax`), `js/estimators.mjs` (`netMargin`/`clamp`), `js/validate.mjs`/`js/trendcore.js` (`tax`/`netMargin`), `js/valuescreen.mjs`/`js/market.js`. Edit ⇒ re-run `quotecore.test`+`reconstruct.test` (byte-identical tax). |
| `js/money-format.js` | gp/number DISPLAY (split from `format.js`, R2): `quote-items.mjs`, `screen-flip-niches.mjs`, `watch-positions.mjs`, `trigger-alerts.mjs`, `join-outcomes.mjs`, `retrojoin.mjs`, `derive-cash.mjs` + `lib/analyze.mjs`/`item-context.mjs`/`emit.mjs` (`fmt`/`fmtP`/`fmtTurn` for the reports) |
| `js/windowread.mjs` | `pipeline/commands/read-window-range.mjs`, `pipeline/commands/watch-positions.mjs`, `pipeline/commands/screen-flip-niches.mjs` (diurnal profile), `js/validate.mjs`, `js/forecast.mjs` (PF1 — consumes `hourProfile`), `pipeline/test/windowread.test.mjs` (P2 — moved from `pipeline/lib/`); **APP-IMPORTED by `js/trends.js`** (TV — the Trends Diurnal timing section, same `hourProfile`/`deriveDiurnalRange` the console prints) |
| `js/forecast.mjs` | `pipeline/test/forecast.test.mjs`; **APP-IMPORTED by `js/trends.js`** (TV, 0.60.0 — the Trends "Forward forecast" section: `diurnalForecast`/`fmtEta`, provisional PF n≈0). Console-side consumers still pending — PF2 quote, PF3 screen, PF4 windowrange, PF5 watch/positions, PF6 estimators, PF7 validate. An app-behavior change to it bumps APP_VERSION. |
| `js/validate.mjs` | `pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/test/validate.test.mjs`, `pipeline/test/termstructure.test.mjs`, `pipeline/test/dipposture.test.mjs` (DP1 — `dipPostureValidator`) (P2/P3 — the validator registry: reach + floor + dip-posture); imports `js/quotecore.js` (DP1 — `recentDirection`); **APP-IMPORTED by `js/trends.js`** (TV — `reachValidator` beside the Diurnal timing chart; `floorValidator`+`trajectoryValidator` beside the 0.60.0 term-structure overlay — all inform-only) |
| `js/termstructure.mjs` | `js/validate.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/test/termstructure.test.mjs` (P3 — term structure / durable floor); **APP-IMPORTED by `js/trends.js`** (TV, 0.60.0 — the Price-history floor/ceiling overlay). Imports `js/quotecore.js` for the shared `quantileSorted` (SF-1) and re-exports it as `quantile`. |
| `js/held-item-strategy.mjs` | `pipeline/lib/item-context.mjs` (`pathsStage`, P4b — so `watch-positions.mjs` + `quote-items.mjs --positions` at runtime), `js/flip-niches.mjs` (P4c — `PATH_KEYS` vocabulary), `pipeline/commands/screen-flip-niches.mjs` (P4c — per-row entry-path annotation), `pipeline/test/held-item-strategy.test.mjs`, `pipeline/test/pathpersist.test.mjs` (not yet app-imported) |
| `js/flip-niches.mjs` | `pipeline/lib/gatecandidates.mjs` (spec-driven gate edge/pool/rank), `pipeline/commands/screen-flip-niches.mjs` (mode-name lists + `defaultPath`; P6b — the per-spec `estimator` family + `priceBasis`), `js/estimators.mjs` (P6b — `estimatorFor(spec)`/`quotedPair(spec,row)` read those two fields; moved from pipeline/lib 2026-07-10), `pipeline/test/flip-niches.test.mjs` (P4c/P6b — the declarative flip-niche registry; not yet app-imported) |

### Test-location convention

Tests are `*.test.mjs` files that all live in **`pipeline/test/`** (R3 — one test home; e.g.
`pipeline/test/quotecore.test.mjs` pins `js/quotecore.js`, `pipeline/test/rating.test.mjs` pins
`pipeline/lib/rating.mjs`). Test fixtures live beside them under `pipeline/test/fixtures/`. Each
test is plain `node <file>.test.mjs` (no framework — copy the shape of an existing one). They are
**auto-discovered**: `pipeline/ci/run-tests.mjs` recursively finds every `pipeline/**/*.test.mjs` (so
a suite placed anywhere under `pipeline/` still runs), runs each in its own child process, and
exits non-zero if any suite fails **or** if zero suites are found. CI (`.github/workflows/checks.yml`) and `/ship` call the
runner once, so **adding a test file is the whole job** — nothing else wires it in. Follow the
same rule for `js/` and `pipeline/lib/` subjects: put the test beside the file (tests for `js/`
subjects live under `pipeline/`, which is where the runner globs — the `quotecore.test.mjs`/
`format.test.mjs` precedent).

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
