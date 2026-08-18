# PLAN-APP-PARITY.md — bring the app to parity with the console (→ v1.0.0)

Status: **PARTIALLY SHIPPED — 6 of 10 chunks landed; AP2, AP3, AP5 and the V1.0.0 bump remain.**
PV · AP1 · CL · TV · SIG-DEL are done; AP4 is done except its RATE_W teardown. The shipped chunks
are folded into `PLAN.md`'s Status table as `PARITY PV/AP1/AP4/CL/TV/SIG-DEL`; this file stays alive
only for what is still open, and dies when AP2/AP3/AP5 + the bump land.

Ben's ruling (the app is a first-class surface, numbers must match, 1.0.0 is the parity milestone)
stands unchanged and is recorded under "The ruling" below.

## The ruling (was AP0, resolved)
The app is a first-class surface. Goal: **the console and the app are two renderings of ONE body of
logic**, so a judgment change made while iterating in the console translates to the app for free
(barring genuinely new UI). Concretely:
1. **Numbers must match.** Any figure shown in both places is computed by ONE shared module — never
   forked. (Precedent: `js/quotecore.js`, `js/money-math.js` + `js/money-format.js`.)
2. **A pipeline version is displayed in-app** beside the app version, so drift is visible at a glance.
3. **App version → 1.0.0** as the parity milestone (the culminating bump, not the first commit).

## Coupling architecture — the ONE rule every chunk obeys
Two, and only two, ways the app may show a console number:

- **(V) View-of-published.** The console computes; the app renders the published artifact verbatim
  (`screen.json`, `positions.json`, `fills.json`). Perfect coupling, zero fork risk, cost = staleness
  (as of the last scan/sync). Home surface: **Scan**, **Ledger**.
- **(C) Shared-module compute.** The app fetches live and computes with the SAME module the console
  imports. Live, but the module must be pure + browser-safe. Home surface: **Finder**, **Trends item
  page**, **Watch**, **quote**.

**Encoding boundary (hard):** app-needed logic is MOVED into a `js/` shared module and node
re-imports it — never copied, never re-derived. The app must never compute a judgment the console
can't, and where it can't share state (local watch-state), it degrades and says so on the card.

Which shared modules the app actually imports today: `js/trends.js` imports `validate.mjs`,
`termstructure.mjs`, `windowread.mjs` and `forecast.mjs` (TV consumed all four — they are no longer
the un-imported reserve the v2 draft described). `js/market.js` imports `estimators.mjs` +
`rating.mjs`, which the pipeline re-exports through `pipeline/lib/signal/{estimators,rating}.mjs`
(`export *` shims) — the moves Wave 2a scheduled are done, in the specified direction.
`js/flip-niches.mjs` and `js/held-item-strategy.mjs` (the modules the v2 draft called
`strategies.mjs` and `paths.mjs`) are **node-only and deliberately not app-imported** — see
`js/flip-niches.mjs`'s header.

## Screen-by-screen — keep / toss / add (reconciled against shipped state)

| Tab | Verdict | State |
| --- | --- | --- |
| **Finder** | FULL REBASE (Q1) | **PARTIAL (AP4).** Ranks + sorts on shared `estimateRank`/`rateItem` (`js/market.js` `desirabilityOf`, `js/ui.js` sort keys), grade letter carries the "Provisional — cutoffs uncalibrated (n≈0)" label. **`RATE_W` is NOT yet removed** — still in `js/state.js`, still computed every `computeScores` pass, and the profit/hr column still renders. |
| **Scan** | KEEP + ENRICH (the husk fix) | **AP1 done, AP2 not started.** Niche copy is clean (`NICHE_META`/`NICHE_ORDER` = band/churn, tolerant fallback kept). `screen.json` is still `schema: 2`; no per-row annotation block, no expandable note. Rank + Grade DO reach the app, but as ordinary table cells under schema 2 — pre-existing T1/S1 work, not AP2. |
| **Trends (item page)** | KEEP + BIG VIZ ADD (Q3) | **DONE (TV).** All four viz shipped through CL: diurnal profile bars, forward forecast band (`fillBetween` + eta markers), term-structure floor/ceiling overlay on the history chart, and validator notes SPLIT across the viz they qualify (reach → diurnal, floor/trajectory → term-structure). |
| **Watchlist** | KEEP | unchanged; the optional rank column was never scoped in. |
| **Signals** | DELETE (Q4) | **DONE (SIG-DEL).** Zero hits for `panel-signals`/`renderSignals`/`computeSignals`/`sigBadge`/`signalCache`/`planSignal` across `js/`, `index.html`, `styles.css`, `pipeline/`. |
| **Watch** | KEEP + FIX (correctness) | **NOT STARTED (AP3).** The ungated verdict is still live — `js/watch.js` headlines `UNDERWATER` off a bare `quickSell < be` with no thesis silencing. |
| **Ledger** | KEEP | unchanged (LU1). |
| **Logs** | KEEP | unchanged. |
| header/Coffer | KEEP + version display | **DONE (PV).** `#pipeVer` renders beside `#appVer`, degrades to `v?`. |

## Chunks

### PV — Pipeline version + version-display plumbing ✅ SHIPPED
`pipeline/lib/version.mjs` exports `PIPELINE_VERSION` (currently `1.0.0`), stamped at write time into
`screen.json` (`screen-flip-niches.mjs`, in the published payload) and `positions.json`
(`pipeline/commands/sync-fills.mjs`). The app renders it at `js/ui.js` beside `#appVer` with a
local-time scan stamp, degrading to `v?` on an unstamped artifact.
Honest: the app displays the pipeline version of the LAST PUBLISHED artifact, not a live import — a
static page can't do better, and the label says so.

### AP1 — Fix the deployed surface's stale claims ✅ SHIPPED
Scan intro reconciled (niches = Band/Churn; falling handling stated as per-strategy with the
held/asked/watchlist exception), `NICHE_META`/`NICHE_ORDER` pruned to the shipped niches with the
tolerant unknown-key fallback kept, params label reads "traded windows".

### AP2 — screen.json schema v3: publish the annotations ⬜ NOT STARTED
`screen-flip-niches.mjs --publish` gains, additively + versioned (`schema: 3`), the per-row LEAN
annotations the console already computes: validator inform/caution note text, diurnal timing line
(+★), entry-path. App Scan renders them as a per-row expandable note (the LU1 `.expbtn` chevron).
Sub-floor rows + probes stay OUT (standing rulings). Old app must render the new file (additive) and
the new app must render an old file (schema check) — both tested.
Note the payload is currently `{app, schema, pipeline, generatedAt, mode, posture, params, headers,
niches, html, watchlist, analysis}` with rows shaped `{id, cells[], reachable{}}`; rank + grade
already ship as cells, so AP2's remit is the annotation block and the render, not the numbers.
Fork Q2 is resolved (PORT NOW, inform-labeled) — the grade letter already ships.

### AP4 — Finder re-base to the shared rank/grade 🟨 PARTIAL
Shipped: `estimateRank`/`rating` live in `js/` with `pipeline/lib/signal/{estimators,rating}.mjs` as
`export *` re-exports; Finder computes and sorts on `desirabilityOf` (rank) and renders the grade
with the required provisional label.
**Remaining:** tear out `RATE_W` — `js/state.js`'s `RATE_W`/`RATE_ROI_MAX`/`RATE_VOL_MAX`/
`RATE_TURN_FAST`/`RATE_TURN_SLOW`, `js/market.js`'s `ratingParts()` and the `it.rate`/`it.riskIndex`/
`it.score` it produces, and the profit/hr column in `js/ui.js`. The code already flags itself as
vestigial at the `computeScores` site. Q1 ruled FULL REBASE, so this is a deletion, not a decision.

### CL — Interactive chart library ✅ SHIPPED (as `js/charts-interactive.js`)
Shipped under a different filename than the draft's `js/chartlib.js`; the old static module was
renamed `js/charts.js` → **`js/charts-static.js`** and kept for the sparkline cases (`svgLine`/
`svgBars`), exactly as the chunk allowed. `createChart(container, config)` provides pointer-drag pan,
wheel zoom and a 2h/1d/1w/3mo/All span selector. The design question the draft reserved for a
pre-build gate (SVG-viewBox transform vs canvas redraw) is **resolved in code**: a fixed viewBox with
a JS-recomputed data window — explicitly not canvas, not a CSS transform — documented in the module
header. No build step, no framework, no external lib.

### TV — Trends item-page visualization enrichment ✅ SHIPPED
All four viz, all strategy (C), each rendered through CL and wired into `js/trends.js`'s existing
decision-priority tier structure: diurnal profile (`hourProfile`/`deriveDiurnalRange`, ★ when clean),
forward forecast band (`diurnalForecast`, trough/peak eta markers, inform-labeled n≈0),
term-structure floor+ceiling overlay on the history chart, and validator notes split across the viz
they qualify rather than one flat plan-card block.

### AP3 — Watch tab verdict consistency ⬜ NOT STARTED (the one CORRECTNESS drift)
Move pure `convictionGate` from `pipeline/lib/thesis/watchstate.mjs` into a `js/` shared home (node
re-imports; fixtures unmoved). App Watch fetches tracked `hold-thesis.json` same-origin and applies
the SAME silencing. Gate-2 breakdown CUT is NEVER silenced (invariant, pinned by tests). Fixes the
phone-whiplash case: the app headlines UNDERWATER on a thesis the console has silenced.
`hold-thesis.json` is git-tracked, so the same-origin fetch is available; `js/watch.js` already
fetches `fills.json`, so the fetch pattern exists.

### AP5 — Buy-limit context in the app ⬜ NOT STARTED
Move pure `limitWindow`/`buysByItem` from `pipeline/lib/capital/limits.mjs` to `js/`; app fetches
`fills.json` same-origin (that fetch already exists in `js/watch.js`), renders "bought X this window
— Y left, frees ~HH:MM" on the Trends plan card + Watch cards. Same LM1 honesty (logged fills only,
upper bound). If `fills.json` is too heavy on mobile, derive a tiny `limits` summary into
`positions.json` at sync time instead (decide at execution).

### V1.0.0 — the milestone bump ⬜ LAST
Once AP2 + AP3 + AP5 + AP4's RATE_W teardown land and a real-browser/Playwright smoke is green, bump
`APP_VERSION` (currently `0.74.6`) → **1.0.0** in `js/state.js` with a CHANGELOG entry framing it as
the app↔console parity milestone. 1.0.0 marks "the app renders what the console computes," NOT "every
number is calibrated" — the provisional (n≈0) items keep their inform labels.
Note `PIPELINE_VERSION` already launched at `1.0.0`, on the reasoning that it ships alongside the
app's parity milestone; that milestone has not happened yet, so the two are currently out of step.

### SIG-DEL — Delete the Signals tab (Q4) ✅ SHIPPED

## Sequencing for what remains
The v2 draft serialized AP2-render / AP4 / PV-render behind a shared `js/ui.js`. **That bottleneck is
mostly gone**: Ledger moved to `js/ledger.js` (chunk A3) and Watch to `js/watch.js`, so AP3 (watch.js)
and AP5 (trends.js + watch.js) are file-disjoint from AP2's Scan render (`js/ui.js` `scanTableHtml`).
AP4's teardown touches `js/state.js` + `js/market.js` + `js/ui.js`, so it serializes against AP2 only.

Remaining order: **AP4-teardown → AP2 (pipeline publish, then `js/ui.js` render) ‖ AP3 ‖ AP5 →
V1.0.0.** Every app-behavior chunk: APP_VERSION bump, browser/Playwright smoke, README inventory +
Map-of-repo shared-module table, CLAUDE.md reconciliation. Shared-module edits re-run
`pipeline/ci/run-tests.mjs` in full.

## Resolved rulings (Ben, 2026-07-10)
- **Q1 = FULL REBASE.** Finder drops the `RATE_W` profit/hr rating entirely and ranks on the shared
  `estimateRank` (net×P÷TTF) + grade — one answer to "best flip," matching the console.
- **Q2 = PORT NOW, inform-labeled.** Provisional (n≈0) rank/grade + validator notes surface WITH a
  prominent "provisional — cutoffs uncalibrated" label. Honesty cost accepted; label is the mitigation.
- **Q3 = ALL FOUR viz**, built on a NEW reusable interactive chart library, with validator notes
  SPLIT across their relevant viz rather than one flat plan-card block.
- **Q4 = DELETE Signals** — Ben doesn't use it; not archived, removed.

## Future improvements discovered (noted for review, NOT auto-implemented)
- **F-A: value/scalp app tabs.** Still provisional, n≈0. Defer to post-P6/F1 evidence even under
  aggressive parity — a public always-on tab is a higher bar than an opt-in `--mode`.
- **F-B: rank/grade CALIBRATION (F1/retrojoin).** The estimator constants + `rating.mjs` cutoffs are
  named placeholders; the whole rank/grade parity story is only as honest as F1. Real prerequisite
  for removing the inform labels.
- **F-C: in-app re-scan / "recommend price adjustment" button.** Stays F1-gated (PLAN.md). AP2's
  richer published scan weakens the case for a client-side re-scan further.
- **F-D: path-engine / conviction-persistence UI.** Decision-support depth belongs on the console;
  the app has no watch-state and must not grow a writer (single-writer rule). AP3 ports only the pure
  read-side `convictionGate`, nothing that writes.
- **F-E: shared-module test parity.** As modules move into `js/`, ensure each keeps its node fixture
  test (move the test's import path, don't drop coverage).

## Honesty (process rule 4)
- The rank/grade and several validators are calibrated at n≈0. Parity makes them VISIBLE, not
  correct — 1.0.0 is a coupling milestone, not a calibration claim. Every ported provisional number
  keeps its inform label until F1.
- The pipeline-version display is of the LAST PUBLISHED artifact, not a live pipeline import — a
  static page can't do better; the label is explicit about it.
