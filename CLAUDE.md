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
   and warnings. Includes **patient pricing** (`patientTargets()`: sizes a
   wider-margin offer off the recent ~2h 5m range, 20th/80th percentiles) and a
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
  refineTrend momentum). Key nuance baked in: in-profit + falling + a reachable higher
  patient target → "HOLD — cut if slow" (list high, drop to instabuy if unfilled),
  *not* an immediate market-sell — the rigid matrix's weak spot, found in testing.

## Open followups (not yet built)
- **Refresh-positions button**: a UI control to re-pull `positions.json` (and ideally
  trigger a fresh pipeline sync) on demand, rather than only on price refresh. Ben
  wants this. `syncFills()` already does the fetch+merge; mostly a button + wiring
  (client can't run the Node pipeline itself — a same-origin re-fetch is the app scope).
- **Per-item "recommend price adjustment" button** on the Trends page: pull fresh GE
  state + item info on demand and recommend a price tweak (ties into patient pricing
  and eventually the fills pipeline's realized-vs-suggested calibration).

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
- No distinct "cancelled" state exists in the log — a cancelled offer just goes
  straight to `EMPTY`. `pipeline/sync-fills.mjs`'s `buildEvents()` does a
  sequence-aware pass to infer cancellation; don't revert to pure line-by-line
  parsing.
- Task Scheduler job `CofferFillsSync` runs `wscript.exe
  pipeline\run-fills-sync.vbs` every 20 min (hidden window). If any pipeline file
  moves again, that task's registered path needs re-creating too — it's not
  automatically kept in sync with the repo (`schtasks /Delete` + `/Create`, see
  `pipeline/FILLS-PIPELINE.md` §4.7).
