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
- **Watchlist / Signals** — star items to track; live buy signals fire when a
  watched item has an after-tax spread during its historically-cheap window.
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
  object + constants + persistence + diagnostics), `format.js` (formatting/tax —
  the canonical `tax()`/`breakEven()`/`netMargin`/`netMarginQty` helpers), `charts.js`
  (inline SVG), `marketfetch.js` (shared browser fetch layer — one timeout-guarded `jget`
  + one cached `fetchTs`/`fetch24h` store, A2), `market.js`
  (price/guide fetch + scoring), `trends.js` (archive + seasonal analysis +
  regime/patient/backtest — renders the Trends view; pure analytics live in
  `trendcore.js`), `trendcore.js` (TC1 — pure DOM-free Trends analytics:
  hourly/seasonal decomposition, the walk-forward `backtestPlan` gate, `patientTargets`
  offer sizing, `bestWindow`/`median`; moved out of `trends.js` for
  `pipeline/trendcore.test.mjs`), `quotecore.js` (DOM-free quote model + canonical
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
  `ui.js` by A3), `ledgercore.js` (TD2 — pure `periodKey`/`groupTrades` day-boundary
  bucketing + per-item grouping, moved out of `ledger.js` so node can import them for
  `pipeline/ledgercore.test.mjs`), `watch.js` (0.49.0 — the Watch tab: a verdict-first
  flipping desk rendering held positions, active offers and today's fills, with verdicts
  from the shared `momVerdict`/`offerVerdict`; per-item session-context notes persist under
  `watchnote:<id>`), `watchcore.js` (0.49.0 — pure Watch-tab derivations: verdict→stripe
  family, alert count, flip/incidental split, today's-fills feed + after-tax net, summary
  aggregates; node-importable, fixture-tested in `pipeline/watchcore.test.mjs`),
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
  renders as verdict-tagged offer rows (`FILLS-PIPELINE.md` §14)
- `heartbeat.json` — **gitignored, local-only, never deployed** — a tiny daemon-liveness
  heartbeat (`{app:'the-coffer-heartbeat', generatedAt:<ISO>}`) written by `watch-log.mjs`
  every ~30s (LW3). The localhost app polls it (`js/ledger.js` `fetchHeartbeat`) for the
  "watcher live" freshness stamp — liveness INDEPENDENT of book changes, because
  `positions.json`'s `generatedAt` only advances on a fill and legitimately freezes during
  quiet no-fill stretches. Does zero git; a stale heartbeat (>90s) is what trips the
  "watcher down?" warning
- `watchlist.json` — tracked repo-root watchlist (array of item names/ids); the app unions it
  with local `STATE.watchlist` and `screen.mjs` always scans it (S3); app writes it back via
  the GitHub contents API (`js/github.js`)
- `alerts.json` — tracked named price alerts (`{itemId, direction, price, note?}`) read by
  `pipeline/alerts.mjs` (N1); ships empty
- `suggestions.jsonl` — tracked, append-only suggestions ledger (O1): every emitted
  recommendation, one JSON object per line, written by `quote.mjs`/`screen.mjs`/`watch.mjs`
  via `pipeline/lib/suggestlog.mjs`
- `screen.json` — the published opportunity screen the app's Scan tab renders (written by
  `screen.mjs --publish`)
- `pipeline/` — RuneLite fill-data pipeline + node analysis scripts; not served by
  Pages, not part of the app. **CLI entrypoints live directly in `pipeline/`; the
  imported-only libraries they share live in `pipeline/lib/`** (OR2 — the split makes the
  CLI-vs-lib distinction structural, since the exec bit doesn't):
  - **CLI entrypoints (`pipeline/*.mjs`, run directly):** `sync-fills.mjs` (parse logs →
    `fills.json`/`positions.json`/`offers.json`, commit + push; `--local` writes them with
    **zero git** for desk-side freshness — LW1, exported `regenerate()` core),
    `watch-log.mjs` (LW1 local daemon — `fs.watch` the exchange-logger dir + `regenerate()`
    in-process on every change, ~10s debounce, **zero git**; also writes a liveness
    `heartbeat.json` at the repo root every ~30s (LW3, zero git) so the localhost stamp shows
    "watcher live" independent of book changes; started manually via
    `watch-log.cmd`, dies with the terminal — see `FILLS-PIPELINE.md` §14),
    `add-manual-fill.mjs` (inject/tombstone
    manual fills), `quote.mjs` (per-item / `--positions` market table), `screen.mjs`
    (opportunity screen; YP2 adds a stdout-only "WATCH CLOSELY" transition list), `watch.mjs` (adaptive live position/offer monitor; also appends
    change-only guide-price observations to `pipeline/.guide-history.jsonl` — below, and holds
    the V1/V2 cross-pass memory: it emits per-pass Δ context + structural-support lines via
    `lib/watchstate.mjs`/`lib/levels.mjs`, persisting `pipeline/.cache/watch-state.json`; each held
    lot's note block follows the V5 EMIT CONTRACT built by `lib/emit.mjs`),
    `monitor.mjs`
    (live read-only log-state snapshot), `thesis.mjs` (YT1 #4 — CLI to set/clear/list the SESSION
    THESIS per item, the sole writer of gitignored `.cache/session-thesis.json`; watch.mjs reads it
    to print a per-held reminder), `windowrange.mjs` (né `nightlows.mjs` — time-of-day
    range read / overnight fill-realism scoring), `alerts.mjs` (N1 push-notification trigger
    engine — behind the standard `import.meta.url === pathToFileURL(argv[1])` invocation guard
    (TD2) so importing it for tests never runs/fetches; exports `positionSignal`/`quietSuppresses`),
    `outcomes.mjs` (derived campaign/outcomes join — gitignored output; schema v2 (YS1) adds per-campaign
    `stateAtFill` (band-pctl+regime+phase AS OF the fill via `lib/histstate.mjs`, for EVERY fill),
    measured `holdTimeSec`/`parkedSec`/`velocityClass`, and `predicted` (copied from the joined
    suggestion, null on pre-YS2 rows); reconstruction routes through `dedupeSnapshots`)
  - **Shared libraries (`pipeline/lib/*.mjs`, imported only):** `reconstruct.mjs` (shared
    FIFO reconstruction + `dedupeSnapshots`), `offers.mjs` (exchange-log discovery + open-offer
    semantics), `positions.mjs` (shared `readOpenPositions` open-lot grouping), `marketfetch.mjs`
    (node-side price/guide fetch layer + historical bands `loadHistBands`/past-anchored 6h series
    `loadHistDaily` (YF1) + the FC1 opt-in cross-invocation fetch
    cache — `setFetchCache`/`cachedJget` serve the per-item GETs from gitignored `.cache/fetch/`
    within per-endpoint TTLs; OFF by default so decision paths stay byte-identical), `cli.mjs` (shared arg/format/table
    helpers), `rating.mjs` (grade/score model), `suggestlog.mjs` (shared `suggestions.jsonl` appender; YS2 `suggestionEntry` also lean-includes the
    forward prediction fields — `posture` and the plumbing for `tripwire`/`fillWindowHrs`/`velocityClass`/`thesis` —
    written only when a caller honestly supplies them, so legacy rows stay byte-identical), `windowread.mjs` (pure window-range math, shared with `windowrange.mjs`/`watch.mjs`),
    `watchstate.mjs` (V1/V4 — PURE cross-pass temporal memory for the watch loop: `computeDeltas`/
    `advanceState` compute Δ instabuy, mom transitions, consecutive-`passesUnderwater`/
    `passesBelowSupport` counters, and band-top drift, with a reset policy on identity change /
    `STALE_GAP_MS`; plus the V4 `convictionGate()` — the pure arm-then-confirm ALERT-escalation
    decision (Gate-2 breakdown CUT exempt/immediate; Gate-D CUT-CANDIDATE + structural break gated).
    Thin `loadState`/`saveState` are the only fs surface — verdict strings untouched, `momVerdict`
    untouched), `levels.mjs`
    (V2 — PURE `structuralSupport`/`cutTrigger`: recent higher-low support + a δ-below cut-trigger
    tripwire off the per-day lows watch.mjs already fetches — OUTPUT-ONLY context, no verdict),
    `emit.mjs` (V5 — PURE `heldNoteBlock`/`heldListAt`: the watch loop's stable, consistently-ordered
    per-HELD-lot note block — `verdict · conviction · Δ · tripwire · recovery-read (V6) · sell/list-at
    (+ break-even) · fill-progress`, with the sell line GUARANTEED on every held lot; orders/formats
    already-computed pieces, decides nothing — output-format-only),
    `recovery.mjs` (V6 — PURE `recoveryRead`/`recoveryLine`/`recoveryTrigger`: the ADVISORY
    recover-vs-drop LEAN that COMPOSES momVerdict's existing signals (diurnal · regime/phase ·
    underwater-persistence · vs structural support) + the trigger gating that surfaces it only on a
    non-clean position — decides NOTHING, never a verdict/alert input; a `spike` caps confidence),
    `capital.mjs` (V6 Companion — PURE `freedCapital`: detects capital freed by a booked SELL between
    passes off V1's prior-pass state and prompts a redeploy scan ≥ `FREED_CAPITAL_SCAN_GP` — surface-
    only, never auto-places/runs the scan; anchor-free, no startup/stale-gap misfire),
    `velocity.mjs` (#3/YS1 — PURE `velocityClass(holdTimeSec)` → fast-cycler/mid/slow-hold/n·a off a
    MEASURED round-trip hold; placeholder thresholds), `capitalutil.mjs` (#3/YV1 — PURE
    `bookUtilization` (working-held vs parked-bid capital split) + `parkedStats` (historical
    "how long bids sat" + velocity mix over outcomes campaigns); output-only, never a verdict input),
    `statetransition.mjs` (YP2 #2 — PURE `stateTransition(phase())`: flags a basing faller / a spike on
    rising-vs-falling lows for the screen's "watch closely" list; descriptive, never a buy signal),
    `guideanchor.mjs` (YP1 #2 — PURE guide re-anchor model off `.guide-history.jsonl`: modal update
    hour + median step, HONESTY-GATED below `GUIDE_MIN_UPDATES` (ships silent today — the wild history
    is all baselines); advisory line on quote/watch, never a verdict input),
    `sessionthesis.mjs` (YT1 #4 — PURE session-thesis state model: `loadThesis`/`saveThesis`/`upsert`/
    `clear`/`prune`/`thesisLine`, the intent-per-lane store watch.mjs reads read-only; persists like
    watchstate), `histstate.mjs` (YF1 — reconstruct MARKET STATE AS OF a past timestamp: the PURE `deriveState`
    composes `loadHistBands` + `loadHistDaily` into the SHIPPED `regimeDrift`/`regimeLabel`/`phase`
    classifiers → band-percentile + regime + phase at a fill/placement time, with `reconstructed:false`
    honesty when the history is gone; the shared seam #1(a)'s every-fill classification + #2's
    state-transition scan both read — no market math re-implemented)
  - `smoke.mjs` (CI headless-chromium DOM smoke of `index.html`, all external network stubbed),
    `quotecore.test.mjs` (verdict-tree fixtures), `reconstruct.test.mjs` (FIFO/tombstone/
    snapshot-dedupe fixtures), `format.test.mjs` (money primitives), `lib/rating.test.mjs`
    (grade/score model), `ledgercore.test.mjs` (TD2 — `periodKey`/`groupTrades` local
    day/week/month bucketing), `table.test.mjs` (TD2 — the `compareRows` sort comparator),
    `alerts.test.mjs` (TD2 — transition-only + quiet-hours contract), `sync-fills.test.mjs`
    (LW1 — `regenerate()` does zero git), `lib/offers.test.mjs` (incl. the LW1 `offersSnapshot`
    emitter), `watchcore.test.mjs` (Watch-tab derivations + `offerVerdict`), `lib/cli.test.mjs`
    (arg/`parseGp`/`median`), `lib/windowread.test.mjs` (window-range quantiles),
    `validateslots.test.mjs` (LH1 — impossible-transition re-emit drop), `logblind.test.mjs`
    (LH2 — restart-blindness header), `trendcore.test.mjs` (TC1 — the walk-forward `backtestPlan`
    gate, `patientTargets` sizing, seasonal decomposition) and `gatecandidates.test.mjs` (GC1 —
    screen.mjs's pre-fetch gate stack), `watchstate.test.mjs` (V1 — cross-pass deltas + the
    consecutive-underwater/below-support counters' reset policy + V4 `convictionGate` arm-then-confirm
    escalation incl. the breakdown-exempt invariant), `levels.test.mjs` (V2 — higher-low support /
    cut-trigger + graceful degradation), `emit.test.mjs` (V5 — the per-held emit contract: the
    guaranteed sell line + fixed field order + `heldListAt` precedence), `recovery.test.mjs` (V6 — the
    advisory recover-vs-drop composition, the spike confidence-cap, and the trigger gating) and
    `capital.test.mjs` (V6 — freed-capital detection + the first-seen/stale-gap/grown-lot anti-misfire
    guards), `fetchcache.test.mjs` (FC1 — the opt-in fetch cache's TTL hit/miss + byte-identical
    payload + default-off toggle), `histstate.test.mjs` (YF1 — `deriveState` band-percentile
    clamp, regime/phase off a synthetic 6h series, and the `reconstructed:false` honesty guard),
    `velocity.test.mjs` (YS1 — the velocity-class half-open boundaries + n/a guard),
    `capitalutil.test.mjs` (YV1 — `bookUtilization` split/edges + `parkedStats` counts/median/mix),
    `sessionthesis.test.mjs` (YT1 — upsert/preserve/clear/prune + `thesisLine` format + file round-trip),
    `statetransition.test.mjs` (YP2 — basing/spike-rising/spike-falling classification + the base/decay/null focus guard),
    `guideanchor.test.mjs` (YP1 — the honesty gate + prev:null-baseline filter + modal-hour/median-step above the gate)
    — all auto-discovered by
    `run-tests.mjs` (below), which CI runs once
  - gitignored scratch is consolidated under `pipeline/.cache/` (OR2): the market caches plus
    `mapping.cache.json`, `.alerts-state.json`, the optional `held-override.json`, the FC1
    `fetch/` per-URL cache (opt-in cross-invocation fetch cache — one `{ts,url,data}` file per
    cached GET, disposable), the YF1 `outcomes-daily/` per-item reduced past 1h@6h series (sibling
    of `outcomes-bands/`), the YT1 `session-thesis.json` (intent-per-lane store; `thesis.mjs` writes,
    watch.mjs reads), and
    `watch-state.json` (V1 — the watch loop's cross-pass memory: a keyed map
    `held:<id>`/`bid:<id>:<offer>` → `{ts, identity, instabuy, mom, bandTop, breakEven, support,
    underwater, passesUnderwater, belowSupport, passesBelowSupport, bandTopHist[]}`, rewritten fresh
    each pass by `watch.mjs` so vanished positions drop out; counters reset on identity change or a
    gap > `STALE_GAP_MS`. Local, disposable —
    deleting it just loses one pass of delta history)
  - `pipeline/.guide-history.jsonl` (**tracked** as of 2026-07-06 — Ben's call: it's an accruing
    observation record, so it lives in the repo to survive a lost machine; kept OUTSIDE `.cache/`
    so cache pruning never touches it) — change-only GE guide-price observations for watched items,
    one JSON line `{ts,id,name,guide,prev}` per observed change, appended by `watch.mjs`
    `logGuideChanges()` at watch cadence. Purpose: pin each item's ~daily guide-update
    time + magnitude to feed the guide-re-anchor pricing edge (PLAN.md Discovered,
    2026-07-06). Consumer: `pipeline/lib/guideanchor.mjs` (YP1 — the guide re-anchor model, honesty-gated
    on accrual; quote.mjs/watch.mjs surface its advisory line, silent until enough real updates accrue). (Not auto-committed by
    `sync-fills.mjs`; commit it periodically so the record on `origin` stays current.)
  - `FILLS-PIPELINE.md` (pipeline design + operations) and `MONITORING.md` (live-monitoring
    routine). The `quote.mjs`/`screen.mjs`/`watch.mjs` scripts import `js/quotecore.js` +
    `js/format.js` so their tables match the app exactly.

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
| `fills.json` | the pipeline source `positions.json` is FIFO-reconstructed from; `sync-fills.mjs` commits it at the root (not app-fetched directly, but coupled to the same convention) |

**Pipeline-only / movable** — no app fetch and no hardcoded remote path; a single path
constant governs each, so these can move without touching the deployed app or phone:

| File | Producer / consumer | Tracked? |
| --- | --- | --- |
| `alerts.json` | read by `pipeline/alerts.mjs` (N1) | tracked (ships empty) |
| `suggestions.jsonl` | appended by `pipeline/lib/suggestlog.mjs` (O1 fields + YS2 forward `posture?`/…) | tracked, append-only |
| `outcomes.json` | derived by `pipeline/outcomes.mjs` | gitignored |

### Shared logic modules

`js/quotecore.js` and `js/format.js` are served to the browser **and** imported by node —
an edit ripples into the pipeline scripts and CI, not just the app. After editing either,
run `pipeline/quotecore.test.mjs` + `pipeline/reconstruct.test.mjs`.

| Module | Also imported by (pipeline) |
| --- | --- |
| `js/quotecore.js` | 10 files: `quote.mjs`, `screen.mjs`, `watch.mjs`, `monitor.mjs`, `alerts.mjs`, `lib/cli.mjs`, `lib/reconstruct.mjs`, `add-manual-fill.mjs`, `quotecore.test.mjs`, `watchcore.test.mjs` (`offerVerdict`, shared with the app Watch tab) |
| `js/format.js` | 5 files: `quote.mjs`, `screen.mjs`, `watch.mjs`, `alerts.mjs`, `outcomes.mjs` |

### Test-location convention

Tests are `*.test.mjs` files **colocated next to the code they pin** (e.g.
`pipeline/quotecore.test.mjs` sits beside its subject, `pipeline/lib/rating.test.mjs` beside
`pipeline/lib/rating.mjs`) — there is **never** a `tests/` directory; adjacency beats grouping
for agents. Each test is plain `node <file>.test.mjs` (no framework — copy the shape of an
existing one). They are **auto-discovered**: `pipeline/run-tests.mjs` recursively finds every
`pipeline/**/*.test.mjs`, runs each in its own child process, and exits non-zero if any suite
fails **or** if zero suites are found. CI (`.github/workflows/checks.yml`) and `/ship` call the
runner once, so **adding a test file is the whole job** — nothing else wires it in. Follow the
same rule for `js/` and `pipeline/lib/` subjects: put the test beside the file (tests for `js/`
subjects live under `pipeline/`, which is where the runner globs — the `quotecore.test.mjs`/
`format.test.mjs` precedent).

## Local development

ES module scripts can't load over `file://` (browsers block it for CORS reasons),
so double-clicking `index.html` won't work. Run **`serve.cmd`** (tries the `py`
launcher's `http.server`, falls back to `python3`, then `npx serve`) and open
`http://localhost:8000/`. GitHub Pages is unaffected — it always serves over HTTP.

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
