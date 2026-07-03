# The Coffer / The-Ledger — instructions for Claude Code

This repo is the primary, ongoing place where this tool gets built and iterated on.
Expect repeated sessions here, not one-offs — check git log and this file for
context before assuming something is new.

**Live app: https://bensumm.github.io/The-Ledger/** (bookmarkable; auto-deploys on
push to `main`).

## What this is
- **The Coffer**: OSRS Grand Exchange flipping tool. `index.html` is markup only;
  `styles.css` holds all styles; logic is split into ES modules under `js/`
  (`state.js` = shared mutable state as one exported `STATE` object + constants +
  persistence + diagnostics; `format.js` = formatting/tax helpers; `charts.js` =
  inline SVG rendering; `market.js` = price/guide fetch + scoring; `trends.js` =
  archive + seasonal analysis; `ui.js` = Finder/Watchlist/Signals/Ledger/Coffer
  rendering; `backup.js` = export/import; `main.js` = entry point, event wiring +
  init). No build step, no framework, no bundler — deployed to GitHub Pages at
  bensumm.github.io/The-Ledger/ exactly as these files sit on disk. See `README.md`
  for the full file inventory and deploy mechanics.
- Split out of one 1375-line `index.html` file in 2026-07 once development moved
  from mobile-only Claude sessions to Claude Code on a PC — the single-file
  constraint was about zero-build Pages deploys, not mobile editing, so the split
  keeps zero-build while making the code far more reviewable/diffable. Local testing
  needs `serve.cmd` now (ES modules don't load over `file://`); see README.
- **Fill-data pipeline**: closes the loop between the tool's trade suggestions and
  real GE trades, captured client-side via RuneLite's Exchange Logger plugin. Lives
  in `pipeline/` (kept separate from the deployed app root): full design doc
  `pipeline/FILLS-PIPELINE.md`, sync script `pipeline/sync-fills.mjs` (runs on Ben's
  Windows machine via a Task Scheduler job `CofferFillsSync`, reads
  `.runelite/exchange-logger/*`, writes/commits/pushes `fills.json` **and**
  `positions.json` at the repo root — both stay at root since the app fetches them
  same-origin). `positions.json` is the derived view (`collapseOffers` +
  FIFO `matchTrades`): `closed` trades w/ after-tax realised P/L, `open` inventory at
  real avg cost, and `unmatched` sells (pre-log inventory, no fabricated profit). The
  app auto-populates its Ledger/Coffer from it. Read `pipeline/FILLS-PIPELINE.md` §5.1
  before touching the reconstruction. Read the whole doc top to bottom before touching
  either script path.

## Trends tab structure (as of 0.16.0)
The per-item Trends view is organized in decision-priority tiers (rendered in
`js/trends.js` `runTrends`), deliberately — don't scatter new info back into a flat
list:
1. **Suggested plan card** (`#trSuggest`) — instant buy/sell, profit-now, trend box,
   and warnings. Includes **trend-aware pricing** (`patientTargets(series, it,
   falling)`): steady/rising items get a wider-margin patient offer off the recent
   ~2h 5m range (20th/80th percentiles); **falling** items instead get buy-low/
   sell-quick targets — a more aggressive low bid (10th pctl) and a sell priced to
   *clear* at/below the instabuy (min(instabuy, 50th pctl)), never above a dropping
   market (0.20.0). The plan card branches its copy on `PT.falling`. And a
   **regime-shift warning** (`regimeDrift()`: last-3d median vs prior ~2wk; fires at
   ≥8%). No σ jargon here — kept plain.
2. **"Why this trend?"** (`#trWhy`, collapsible) — plain-language guide-divergence
   readout; the σ number lives only in this expander's fine print.
3. **Price history** (`#trHistWrap`) — 3-month chart, promoted as immediate context.
4. **Timing & seasonality** (`#trTiming`, collapsible) — gated on the walk-forward
   backtest: the hourly price/volume charts (`#trCharts`) only render when the timing
   edge is actually proven out-of-sample (`good && !regimeShift`); otherwise the
   section states "no proven edge"/"unreliable" and hides the charts. Weekday/weekend
   boxes were removed (effect was ~noise).
Key lesson driving this: hourly seasonality is usually noise or a regime artifact;
`conf`/`medCount` only measure history coverage, not price-level stability, so the
regime guard + backtest gate exist to stop one-off jumps masquerading as cycles.

## Done (recent, for context — don't rebuild)
- **Finder rating rework** (0.17.0): `computeScores()` in `js/market.js` now blends
  four transparent 0..1 sub-scores via `ratingParts()` — ROI, liquidity (log-scaled
  vol), stability, turnaround — into a `quality` dampener; `score = pph*(1-damp*(1-
  quality))` keeps profit/hr as the magnitude anchor. Risk grade + Rating bar carry a
  per-factor tooltip. Finder stability is a cheap live-price-vs-guide proxy (the real
  `regimeDrift` still needs a per-item series → stays on Trends).
- **Ledger auto-populate from fills** (0.18.0): `syncFills()` in `js/ui.js` fetches
  `positions.json` on load/refresh and merges pipeline-reconstructed real trades into
  the Ledger/Coffer (tagged `src:'fills'`, idempotent rebuild, tombstoned via
  `STATE.fillsHidden`, unmatched sells shown but excluded from realised). Pipeline
  emits `positions.json` — see `pipeline/FILLS-PIPELINE.md` §5.1.
- **Position review workflow** (0.19.0): "Review pricing" button on the Ledger →
  `reviewPositions()` in `js/trends.js` fetches live 5m/6h/guide-history per open
  position and renders a **HOLD / ADJUST / CUT** verdict + concrete "list at X" price.
  Pivot = break-even (`ceil(buy/0.98)`) × trend (falling/flat/rising from regimeDrift +
  refineTrend momentum).
- **Falling items → price to clear** (0.20.0): Ben's rule — for a falling item the
  suggested prices must reflect the fall: buy low aggressively, price to sell quickly.
  This **superseded** the 0.19.0 "HOLD — cut if slow / list high above market" nuance,
  which misfired: in a decline the recent highs are *always* above the current price, so
  the old `patientUpside` guard was ~always true and told you to list above a dropping
  market (the Dragon nails case, found live). Now `renderPositionCard` collapses the
  falling branches → always list at the instabuy (in profit → SELL to clear; underwater →
  CUT), never above it. `patientTargets` is trend-aware (see Trends tab §1) and the plan
  card's pricing copy branches on `PT.falling`.
- **Live position monitor + deterioration-watch routine** (2026-07-02): `pipeline/monitor.mjs`
  (read-only — live offers/fills from the exchange log + held positions with break-even from
  `positions.json`, *not* a log re-sum) drives a polling routine documented in
  `pipeline/MONITORING.md`: HOLD / WATCH / CUT per held position, break-even = `ceil(buy/0.98)`,
  with an **evidence-gated 24h-cycle guard** (daily cycles are usually noise → default to
  cutting a genuinely falling position; only a *proven* backtested hour-of-day pattern defers
  a cut). Session/agent-run for now; the durable app-native home is the Refresh-positions +
  Ledger break-even/regime followups below.

## Flipping strategy lessons (2026-07-02 session — codified)
- **Screening: the 24h-drift signal is a pre-filter only.** Current-instasell-vs-24h-avg
  repeatedly read "flat/slightly soft" on items a multi-day check (`regimeDrift`: recent-3d
  median vs prior ~2wk, ≥8% flags) showed as active fallers/movers — Lightbearer, Sunfire
  cuirass, anguish, primordial, Archers ring, Blood moon (6× in one session). Always run
  the multi-day regime check before recommending any screened item.
- **Real liquidity = a two-sided daily market, not the `/volumes` count.** `/volumes` is
  bursty/weekly and overstates tradability. The 50–100/day band looked juicy (5–22%
  "margins") but was ghost-spreads: `0/0` two-sided trades in 24h (cosmetics, ornament
  kits), uncrossable. Gate on `lowPriceVolume>0 && highPriceVolume>0` in the 24h endpoint;
  ~100/day is the practical floor.
- **Tax dominates thin flips.** The 2% tax eats most of a tight spread — need meaningfully
  >~0.5% after-tax to bother. Stable/tight ≠ profitable.
- **Pricing: for a liquid item with a stable *regime* but a wide intraday band, the band
  IS the edge.** Ladder buys at band lows / sell at band tops (34–74k/unit on crystal
  teleport seeds vs ~24k for a mid-spread flip; seeds were ~88% of session profit). Never
  list below break-even (`ceil(buy/0.98)`); don't chase a softening item's buy.

## Market analysis workflow — standard output format
Every market read presented to Ben (screen, per-item quote, position review) is ONE table:
`Item | Guide | Mid | Buy@ Quick/Opt | Sell@ Quick/Opt | Net/u Quick/Opt (ROI) | Vol/d | Regime`
- Quick = transact now (buy at live instasell, sell at live instabuy). Optimistic = patient
  2h-band edges (last 24×5m points: min avgLow / max avgHigh). Same basis ⇒ optBuy ≤ quickBuy
  ≤ quickSell ≤ optSell **always** — if that ordering breaks, bases got mixed (this bug
  shipped in an analysis 2026-07-03: 24h percentiles mixed with live quotes).
- Guide = real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- Vol/d = limiting side, `min(highPriceVolume, lowPriceVolume)` from the 24h endpoint.
- Net/u after 2% tax. Regime = multi-day regimeDrift check (flat/rising/falling label).
- Group Tier A (stable regime) / Tier B (recently repriced/volatile — size small).
  **Falling-regime items are excluded from screens entirely — don't show or mention them.**
  Exception: items Ben holds or asks about → always show, with price-to-clear guidance.
**How to generate these tables — the three canonical asks map to exact commands. These scripts
exist and ARE the workflow.** ALWAYS use them; NEVER hand-write a `node -e` fetch for a market
read (each ad-hoc script also burns ~1–2k tokens to author + parse — the scripts exist
specifically to kill that cost). All three import `js/quotecore.js`, so the numbers are
byte-identical to the app's tables:
- **Per-item read** ("how's item X?") → `node pipeline/quote.mjs "<item or id>" [...more]`
  (one combined table + a regime line per item; multiple items in one call).
- **Opportunity screen** ("find me flips") → `node pipeline/screen.mjs [--floor 50] [--min-roi
  1.5] [--max-price 45m] [--top 40]` (two-sided liquidity gate, grouped Tier A / Tier B,
  falling items silently excluded).
- **Positions vs market** ("how are my positions doing / check the market against what I
  hold") → `node pipeline/quote.mjs --positions` (reads `positions.json` open lots, quotes each
  held item, adds Held@/Break-even columns + HOLD/list-at/CUT verdict; held fallers ARE shown
  here with price-to-clear). This is the recurring one — reach for it, don't rebuild it by hand.

## Open followups (not yet built)
- **Active implementation plan: `PLAN.md`** (2026-07-03) — manual-fill single-sourcing
  (log-only + tombstones + WITHDRAWN), standard quote tables in Finder/Trends, quote/screen
  analysis scripts, tech-debt pass. The items below are separate / longer-horizon.
- **Refresh-positions button**: a UI control to re-pull `positions.json` (and ideally
  trigger a fresh pipeline sync) on demand, rather than only on price refresh. Ben
  wants this. `syncFills()` already does the fetch+merge; mostly a button + wiring
  (client can't run the Node pipeline itself — a same-origin re-fetch is the app scope).
- **Per-item "recommend price adjustment" button** on the Trends page: pull fresh GE
  state + item info on demand and recommend a price tweak (ties into patient pricing
  and eventually the fills pipeline's realized-vs-suggested calibration).
- **Ledger redesign — grouped, watchlist-filtered, period P&L** (designed 2026-07-02,
  not yet built): three changes to the Ledger tab (`renderLedger` in `js/ui.js`):
  1. **Watchlist filter** — show only trades whose `itemId` is on `STATE.watchlist`
     (`STATE.watchlist.includes(t.itemId)`), as a toggle defaulting ON. Rationale: with
     fills auto-populating, random loot-sells / supply-buys pollute the Ledger; only
     watched (flip-target) items are worth tracking. Non-watched fills stay in
     `positions.json` / `STATE.trades` (not deleted) — just hidden by the filter.
  2. **Per-item grouping + drill-in** — collapse multiple trades of the same `itemId`
     into one summary row (item, total qty, avg buy, avg sell, flip count, total realised
     after tax), expandable to the per-transaction history. Applies to both the open
     table (group open lots → total qty at avg cost) and the closed table.
  3. **Period P&L (day/week/month)** — bucket realised profit by period, **attributed by
     SELL/close date (`sellTs`)**. This deliberately sidesteps the day/week/month
     border-straddle: a flip bought in one period and sold in another belongs *wholly* to
     the period it was realised in (realised P/L is booked at the sale) — no proration, no
     ambiguity. Unmatched sells bucket by their `sellTs` too. Local-time boundaries;
     week = Mon–Sun. Surface a period selector + the period total (extends the Coffer's
     realised tile).

## Repo is public — no PII
This repo is public on GitHub. Never commit account names, RSNs, real names, emails,
or other personally identifying info into tracked files (code, comments, commit
messages, `fills.json`, docs). Git author identity (`user.name`/`user.email`) is
already configured locally as `bensumm` / `benlsummers@gmail.com` — that's expected
metadata, not a leak; the concern is content, not commit authorship.

## Process rules (carried over from prior sessions — keep following these)
1. The repo's `index.html` + `styles.css` + `js/*.js` are canonical. Confirm the
   current version before editing; don't work from a stale copy (a rollback incident
   happened this way once, back when it was one file — same principle now applies
   across the split files together).
2. Validate every JS edit: `node --check` the touched file(s) (each `js/*.js` is
   valid ESM on its own now, no more single-blob extraction needed). That only
   catches syntax — also actually run the app (`serve.cmd` + a real browser, or the
   Playwright/chromium approach used in the 2026-07 restructuring session) before
   calling a change done, since cross-module import/export mismatches and DOM
   logic bugs don't show up in a syntax check. Prefer exact-string-match patches
   that fail loudly over fuzzy ones.
3. Ben wants prose explanations of what changed and why, alongside code — not just
   a diff.
4. Be honest about statistical limits in any calibration/analytics work. Never
   oversell signal quality from small samples.
5. Bump `APP_VERSION` (in `js/state.js`) on every shipped change.
6. Before running `git commit`/`git push` (including via `sync-fills.mjs`), it's fine
   to just do it once the change has been described to Ben — but for the *pipeline
   script's own* automated commits (via Task Scheduler), no confirmation loop is
   possible or expected; that's by design (§4.7 of `pipeline/FILLS-PIPELINE.md`).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed; don't suggest
   installing anything else for git operations.

## The `STATE` object (js/state.js) — read before editing shared state
Almost all app-wide mutable state (`ITEMS`, `watchlist`, `trades`, `bankroll`,
`sortKey`, `LOG`, etc.) lives as properties on one exported object,
`export const STATE = {...}` in `js/state.js`, accessed everywhere as
`STATE.xxx` — not as bare imported `let` bindings. This is a hard ES module
constraint, not a style choice: a module can `export let x` and other modules can
*read* `x`, but only the declaring module can *reassign* `x` — any other module
trying `x = newValue` on an imported binding is a SyntaxError. Since `market.js`,
`ui.js`, `trends.js`, `main.js`, and `backup.js` all reassign things like `ITEMS`,
`watchlist`, `bankroll` (not just mutate them in place), those had to become
properties of one shared object instead (`STATE.ITEMS = ...` is a property
mutation on an object all modules hold the same reference to — always legal).
When adding new shared mutable state, put it on `STATE`, not as a new bare
`export let`. Constants that are never reassigned (`API`, `APP_VERSION`, weight
constants, etc.) stay as plain `export const` — no need to route those through
`STATE`.

## Environment notes (Windows machine)
- RuneLite config lives under `~/.runelite/profiles2/*.properties`. Changes made
  in-game only flush to disk on client close/restart — if a just-changed setting
  still reads the old value, ask Ben to restart the client before re-checking.
- Exchange Logger plugin log: `~/.runelite/exchange-logger/exchange.log`, JSON mode.
  Real field names differ from the plugin's own naming conventions in the schema —
  see the ADAPTER comment block at the top of `pipeline/sync-fills.mjs` for the
  verified mapping (`item`→itemId, `offer`→price, `max`→qty, `qty`→filled,
  `worth`→spent). Don't re-guess field names; that mapping was verified against real
  log output.
- The log **does** emit explicit `CANCELLED_BUY`/`CANCELLED_SELL` states (confirmed live
  2026-07-02) — `normalizeStateStr` in `sync-fills.mjs` maps any `CANCEL*` to `'cancelled'`.
  `buildEvents()` *also* keeps a sequence-aware fallback (last non-complete event before an
  `EMPTY` or a slot item-change → cancelled) for cancels that drop straight to `EMPTY`
  without a cancel line. Keep both paths; don't revert to pure line-by-line parsing.
- **Manual fills injected into `coffer-manual.log` MUST carry the timestamp of when the
  trade actually happened** (`--time` on add-manual-fill.mjs) — a "now" timestamp on a
  backdated trade breaks FIFO matching (phantom-5-bludgeons incident, 2026-07-03). Also:
  `fills.json` is an append-only merged archive — fixing/removing a source log line does NOT
  purge an already-merged event; until PLAN.md's tombstone support lands, that needs a one-off
  removal of the event (by its `id`) from `fills.json`, then a re-sync.
- Task Scheduler job `CofferFillsSync` runs `wscript.exe
  pipeline\run-fills-sync.vbs` every 20 min (hidden window). If any pipeline file
  moves again, that task's registered path needs re-creating too — it's not
  automatically kept in sync with the repo (`schtasks /Delete` + `/Create`, see
  `pipeline/FILLS-PIPELINE.md` §4.7).
