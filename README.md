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
  profit/hr, margin, ROI, or volume.
- **Trends** — deep per-item analysis. A live "Suggested plan" (instant buy/sell +
  **patient pricing** that sizes a wider-margin offer off the recent 2h range),
  a **regime-shift guard** that warns when a recent price-level jump makes the
  hourly-timing stats unreliable, a plain-language guide-divergence readout
  ("Why this trend?"), 3-month price history, and a collapsible **timing &
  seasonality** section gated on a walk-forward backtest (hourly charts only appear
  when the timing edge is actually proven out-of-sample).
- **Watchlist / Signals** — star items to track; live buy signals fire when a
  watched item has an after-tax spread during its historically-cheap window.
- **Ledger** — manual position tracking with after-tax realized/unrealized P/L,
  summarized in the "Coffer" header tiles.
- **Fill-data pipeline** — see `pipeline/` (below): captures real GE trades from
  RuneLite to `fills.json` so the tool can eventually calibrate its predictions
  against actual fills.

## Files

- `index.html` — the app shell (markup only)
- `styles.css` — all styles
- `js/` — app logic as ES modules: `state.js` (shared mutable state as one `STATE`
  object + constants + persistence + diagnostics), `format.js` (formatting/tax —
  the canonical `tax()`/`breakEven()`/`netMargin`/`netMarginQty` helpers), `charts.js`
  (inline SVG), `marketfetch.js` (shared browser fetch layer — one timeout-guarded `jget`
  + one cached `fetchTs`/`fetch24h` store, A2), `market.js`
  (price/guide fetch + scoring), `trends.js` (archive + seasonal analysis +
  regime/patient/backtest), `quotecore.js` (DOM-free quote model + canonical
  market-table cells — `computeQuote`/`regimeDrift`/`quoteCells`; shared byte-for-byte
  with the node analysis scripts), `quote.js` (browser orchestrator that fetches one
  item's series and renders the standard quote table), `fillslog.js` (File System
  Access API writer for `coffer-manual.log` + tombstones), `github.js` (M1 — mobile
  GitHub-as-backend writes: fine-grained PAT in localStorage, `mobile-fills.log` /
  `watchlist.json` via the contents API), `table.js` (TB1 — reusable sortable-table
  helper: click-to-sort headers, direction toggle, arrow decoration, per-table sort
  state persisted under `sort:<name>`; the Finder and Watchlist adopt it), `ui.js`
  (Finder/Watchlist/Signals/Coffer/Scan rendering + the `renderAll` coordinator),
  `ledger.js` (Ledger view + fills-write cluster — manual-entry writes, positions.json
  auto-populate, Ledger render/controls, freshness + GitHub-sync panels; split out of
  `ui.js` by A3), `backup.js` (export/import),
  `main.js` (entry point — event wiring + init, loaded as `<script type="module">`)
- `manifest.json`, `icon-*.png` — PWA manifest and icons
- `fills.json` — raw real-trade event stream synced from RuneLite, fetched same-origin
- `mobile-fills.log` — tracked, append-only source log the app appends mobile GE trades to
  (slot 9) via the GitHub contents API; read by `sync-fills.mjs` (M1, `FILLS-PIPELINE.md` §13)
- `positions.json` — derived from `fills.json` by the pipeline (FIFO-matched closed
  trades + open positions); the app auto-populates its Ledger/Coffer from it
- `watchlist.json` — tracked repo-root watchlist (array of item names/ids); the app unions it
  with local `STATE.watchlist` and `screen.mjs` always scans it (S3); app writes it back via
  the GitHub contents API (`js/github.js`)
- `alerts.json` — tracked named price alerts (`{itemId, direction, price, note?}`) read by
  `pipeline/alerts.mjs` (N1); ships empty
- `suggestions.jsonl` — tracked, append-only suggestions ledger (O1): every emitted
  recommendation, one JSON object per line, written by `quote.mjs`/`screen.mjs`/`watch.mjs`
  via `pipeline/suggestlog.mjs`
- `screen.json` — the published opportunity screen the app's Scan tab renders (written by
  `screen.mjs --publish`)
- `pipeline/` — RuneLite fill-data pipeline + node analysis scripts; not served by
  Pages, not part of the app:
  - `sync-fills.mjs` (parse logs → `fills.json`/`positions.json`, commit + push),
    `reconstruct.mjs` (shared FIFO reconstruction + `dedupeSnapshots`), `offers.mjs` (shared
    exchange-log discovery + open-offer semantics), `positions.mjs` (shared `readOpenPositions`
    open-lot grouping), `add-manual-fill.mjs` (inject/tombstone manual fills)
  - `marketfetch.mjs` (node-side price/guide fetch layer + historical bands), `cli.mjs`
    (shared arg/format/table helpers), `quote.mjs` (per-item / `--positions` market table),
    `screen.mjs` (opportunity screen), `rating.mjs` (grade/score model), `watch.mjs` (adaptive
    live position/offer monitor), `monitor.mjs` (live read-only log-state snapshot),
    `nightlows.mjs` (overnight fill-realism scoring), `alerts.mjs` (N1 push-notification
    trigger engine), `outcomes.mjs` (derived campaign/outcomes join — gitignored output),
    `suggestlog.mjs` (shared `suggestions.jsonl` appender)
  - `smoke.mjs` (CI headless-chromium DOM smoke of `index.html`, all external network stubbed),
    `quotecore.test.mjs` (verdict-tree fixtures) and `reconstruct.test.mjs` (FIFO/tombstone/
    snapshot-dedupe fixtures) — all three wired into `.github/workflows/checks.yml`
  - `FILLS-PIPELINE.md` (pipeline design + operations) and `MONITORING.md` (live-monitoring
    routine). The `quote.mjs`/`screen.mjs`/`watch.mjs` scripts import `js/quotecore.js` +
    `js/format.js` so their tables match the app exactly.

## Local development

ES module scripts can't load over `file://` (browsers block it for CORS reasons),
so double-clicking `index.html` won't work. Run **`serve.cmd`** (tries the `py`
launcher's `http.server`, falls back to `python3`, then `npx serve`) and open
`http://localhost:8000/`. GitHub Pages is unaffected — it always serves over HTTP.

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
