# PLAN-APP-PARITY.md — bring the app to parity with the console (→ v1.0.0)

Status: **PROPOSAL v2 — re-scoped 2026-07-10 under Ben's aggressive-parity ruling.** Supersedes
the cautious v1 (which gated everything on an unanswered "what is the app for?"). Ben has now
answered: the app matters, it should MIRROR the console, numbers must match, and it graduates to
**1.0.0** when it does. Approved chunks fold into `PLAN.md`; this file dies when the last ships.

## The ruling (was AP0, now resolved)
The app is a first-class surface again. Goal: **the console and the app are two renderings of ONE
body of logic**, so a judgment change made while iterating in the console translates to the app
for free (barring genuinely new UI). Concretely:
1. **Numbers must match.** Any figure shown in both places is computed by ONE shared module — never
   forked. (Precedent already works: `js/quotecore.js`, `js/format.js`.)
2. **A pipeline version is displayed in-app** beside the app version, so drift is visible at a glance.
3. **App version → 1.0.0** as the parity milestone (the culminating bump, not the first commit).

## Coupling architecture — the ONE rule every chunk obeys
Two, and only two, ways the app may show a console number:

- **(V) View-of-published.** The console computes; the app renders the published artifact verbatim
  (`screen.json`, `positions.json`, `fills.json`). Perfect coupling, zero fork risk, cost = staleness
  (as of the last scan/sync). Home surface: **Scan**, **Ledger**.
- **(C) Shared-module compute.** The app fetches live and computes with the SAME module the console
  imports. Live, but the module must be pure + browser-safe. Home surface: **Finder**, **Trends item
  page**, **Watch**, **quote**. Several modules already sit in `js/` un-imported for exactly this
  moment: `validate.mjs`, `termstructure.mjs`, `windowread.mjs`, `forecast.mjs`, `paths.mjs`,
  `strategies.mjs`.

**Encoding boundary (hard):** app-needed logic is MOVED into a `js/` shared module and node
re-imports it — never copied, never re-derived. The app must never compute a judgment the console
can't, and where it can't share state (local watch-state), it degrades and says so on the card. This
is the existing "quotecore precedent," now made the law for the whole parity program.

## Screen-by-screen — keep / toss / add

| Tab | Verdict | Keep | Toss | Add |
| --- | --- | --- | --- | --- |
| **Finder** | **FULL REBASE** (Q1) | search, budget/slots, catalog | the entire `RATE_W` profit/hr rating (the gp/d lens the console rejected) — REMOVED | shared `estimateRank` **rank + grade** as the sole ordering (strategy (C)), grade letters inform-labeled "provisional (n≈0)" |
| **Scan** | **KEEP + ENRICH** (the husk fix) | published-snapshot render (V) | stale niche intro copy (AP1) | schema-v3 annotations: validator notes, diurnal timing ★, rank/grade, entry-path, posture (AP2) |
| **Trends (item page)** | **KEEP + BIG VIZ ADD** (fork Q3) | plan card, 2h recent chart, why-trend, 3mo history, backtest-gated seasonality | nothing | diurnal dip/peak profile, forward FORECAST band, term-structure floor+fluctuation overlay, inline validator notes (all strategy (C), shared modules already in `js/`) |
| **Watchlist** | KEEP | list + badges | — | (optional) rank/verdict column off the same shared rank |
| **Signals** | **DELETE** (Q4 — Ben: "I don't use it") | — | the whole tab: `panel-signals`, nav button, `sigBadge`, `renderSignals`/`computeSignals`, `STATE.signalCache`, and `planSignal` if nothing else consumes it | — |
| **Watch** | **KEEP + FIX (correctness)** | verdict-first desk (C via quotecore) | the UNGATED verdict (headlines UNDERWATER on a lot the console has silenced) | `convictionGate` + hold-thesis silencing (AP3); buy-limit line (AP5) |
| **Ledger** | KEEP (LU1 is good) | grouped, period P&L, watchlist filter (V) | — | (optional) pipeline-version stamp in the synced line |
| **Logs** | KEEP | diagnostics | — | — |
| header/Coffer | KEEP | merch view | — | **pipeline version display (PV)** |

## Chunks (sequenced, prioritized)

### PV — Pipeline version + the version-display plumbing  ·  FOUNDATIONAL, fork-independent
- New single home `pipeline/lib/version.mjs` → `export const PIPELINE_VERSION='0.1.0'` (semver;
  bumped by the same discipline as APP_VERSION, for pipeline behavior changes). Stamp it into
  `screen.json` (`pipeline: PIPELINE_VERSION`) and `positions.json` at write time.
- App reads the freshest stamp from whichever artifact it already fetched and renders, next to
  `#appVer`: `app v1.0.0 · pipeline v0.1.0 (scan 14:32)`. If no stamp (old artifact) → `pipeline v?`.
- Honest: the app displays the pipeline version of the LAST PUBLISHED artifact, not a live import
  (a static page can't run the pipeline). Label says so.
- Files: `pipeline/lib/version.mjs` (new), `pipeline/screen.mjs`, `pipeline/sync-fills.mjs`
  (positions stamp), `js/ui.js`+`js/main.js` (render), `js/state.js` (APP_VERSION later), README
  inventory, CLAUDE.md pointer. Acceptance: published files carry both stamps; app renders them;
  old artifact without stamp degrades to `v?` not a crash.

### AP1 — Fix the deployed surface's stale claims  ·  MECHANICAL, fork-independent, do first
- `index.html` Scan intro (niches = Band/Churn; falling is per-strategy w/ held/asked/watchlist
  exception — drop "Spread/Rising" and "Falling items are excluded"); `js/ui.js` `NICHE_META`/
  `NICHE_ORDER` pruned to shipped niches (keep tolerant fallback rendering of unknown keys);
  params-line label "≥N traded windows". Acceptance: grep of `index.html`+`js/` for
  Spread/Rising/"Falling items are excluded" is clean; browser smoke.

### AP2 — screen.json schema v3: publish the annotations (the channel fix)  ·  depends on PV
- `screen.mjs --publish` adds, additively + versioned (`schema:3`), the per-row LEAN annotations the
  console already computes: validator inform/caution note text, diurnal timing line (+★), rank +
  grade, entry-path. App Scan renders them as a per-row expandable note (LU1 chevron). Sub-floor rows
  + probes stay OUT (standing rulings). Old app must render new file (additive) and new app must
  render an old file (schema check) — both tested. Fork Q2 governs whether the grade LETTER ships or
  only the inform text.

### AP4 — Finder re-base to the shared rank/grade  ·  FORK Q1 + Q2
- Move `estimateRank`/`rating` into an app-importable path (they live in `pipeline/lib/`; the pure
  core moves to `js/` per the boundary). Finder computes rank/grade live (C) and sorts on it. Exact
  shape depends on Q1 (add-column vs full-rebase vs archive) and Q2 (grade letters now vs hold).

### CL — Interactive chart library (NEW, Ben Q3)  ·  foundational for TV
- The current `charts.js` is static SVG (`svgLine`/`svgBars`, fixed 480×150, no interaction). Ben
  wants a **reusable interactive chart**: pointer-drag PAN, wheel/pinch ZOOM, a timespan selector
  (2h / 1d / 1w / 3mo), and switchable scales. Constraint: NO build step, NO framework, NO external
  lib (CSP blocks CDNs) — hand-rolled SVG (or canvas) + pointer events in a new `js/chartlib.js`.
- Design goals: a single `Chart({series, refs, bands, markers, span})` component the whole app reuses
  (Trends recent/history/diurnal/forecast, and later Scan/Watch sparklines). `svgLine`/`svgBars` become
  thin static callers of it (or are kept for the tiny sparkline cases). Accessible, touch-friendly,
  theme-aware. Ships its own APP_VERSION bump + a real-browser smoke (interaction can't be unit-tested).
- **I will spec the interaction contract and validate the agent's proposed approach before it builds**
  (open design point: SVG-with-viewBox-transform pan/zoom vs. canvas redraw — agent proposes, I gate).

### TV — Trends item-page visualization enrichment  ·  Q3 = ALL FOUR, built on CL
- All four viz, all strategy (C) off modules ALREADY in `js/`, each rendered through the CL component:
  - **Diurnal profile chart** — `windowread.mjs` `hourProfile`/`deriveDiurnalRange`: per-hour dip/peak
    bars + the derived stale-guarded BID/ASK, ★ when clean.
  - **Forward forecast band** — `forecast.mjs` `diurnalForecast`: next trough/peak with eta + band,
    the "buyable at ~X in ~4h" overlay. Degrades loudly (spike/thin/violation). Inform-labeled (PF n≈0).
  - **Term-structure floor overlay** — `termstructure.mjs`: durable multi-week floor + typical
    fluctuation as reference lines on the history chart (the "buy the base, not the knife" picture).
  - **Validator notes — SPLIT across their relevant viz (Ben's refinement, NOT one flat block):**
    the `reach` note sits with the diurnal/timing chart, the `floor`/`trajectory` note with the
    term-structure overlay, the forecast caveat with the forecast band. Each note is the same text
    the console prints (`validate.mjs`), placed where the picture it qualifies lives.
- `trends.js` wires these into the existing decision-priority tier structure (respect the header-comment
  ordering); each viz is a discrete sub-chunk so lanes can parallelize once CL lands.

### AP3 — Watch tab verdict consistency  ·  the one CORRECTNESS drift
- Move pure `convictionGate` from `pipeline/lib/watchstate.mjs` into a `js/` shared home (node
  re-imports; fixtures unmoved). App Watch fetches tracked `hold-thesis.json` same-origin and applies
  the SAME silencing. Gate-2 breakdown CUT is NEVER silenced (invariant, pinned by tests). Fixes the
  phone-whiplash case (app headlines UNDERWATER on a thesis the console silenced).

### AP5 — Buy-limit context in the app  ·  small, mobile-relevant
- Move pure `limitWindow`/`buysByItem` to `js/`; app fetches `fills.json` same-origin, renders
  "bought X this window — Y left, frees ~HH:MM" on the Trends plan card + Watch cards. Same LM1
  honesty (logged fills only, upper bound). If `fills.json` is too heavy on mobile, derive a tiny
  `limits` summary into `positions.json` at sync time instead (decide at execution).

### V1.0.0 — the milestone bump  ·  LAST
- Once PV + AP1 + AP2 + (Q1 result) + (Q3 result) + AP3 land and a real-browser/Playwright smoke is
  green, bump `APP_VERSION` → **1.0.0** in `js/state.js` with a CHANGELOG entry framing it as the
  app↔console parity milestone. 1.0.0 marks "the app renders what the console computes," NOT "every
  number is calibrated" — the provisional (n≈0) items keep their inform labels.

## Sequencing & agent orchestration (worktree-isolated, hand-serialized; I am the validation gate)
Shared working tree ⇒ one writer per file. Lanes are kept file-disjoint; `ui.js` (touched by AP1 +
AP2-render + PV-render) is serialized, not parallelized.

- **Wave 1 (parallel, 2 file-disjoint lanes):** Lane A = PV pipeline-side (`version.mjs` + stamp
  `screen.mjs`/`sync-fills.mjs`, pipeline files only). Lane B = app-shell pass (AP1 stale-fix +
  SIG-DEL Signals deletion + PV app-render display — all in `index.html`/`js/ui.js`/`js/main.js`/
  `js/state.js`). Contract between them: artifacts gain `pipeline: PIPELINE_VERSION`; Lane B reads
  `payload.pipeline`. Land A then B (or B then A — disjoint), verify, one APP_VERSION bump for Lane B.
- **Wave 2a — shared-module MOVES (prep, byte-identical):** move the pure cores Wave 2b needs into
  `js/` with node re-exports + test-path updates, ZERO behavior change: `estimators`/`rating` (→ AP4),
  `convictionGate` (→ AP3), `limitWindow`/`buysByItem` (→ AP5). (`validate`/`windowread`/`forecast`/
  `termstructure` already live in `js/`.) Re-run full `run-tests.mjs`. One coordinated lane to avoid
  N lanes racing the same moves.
- **Wave 2b — the builds (serialize where they share `ui.js`):** CL (chart library, foundational) →
  TV (item-page viz, 4 sub-chunks, `trends.js`+charts, parallel once CL lands) ‖ AP2 (schema-v3
  publish + Scan render) → AP4 (Finder rebase) → AP3 (Watch verdict) → AP5 (limits). `ui.js` is touched
  by AP2-render + AP4 → serialize those two.
- **Wave 3:** V1.0.0 bump + CHANGELOG + full doc reconciliation pass.
Every app-behavior chunk: APP_VERSION bump, browser/Playwright smoke, README inventory + Map-of-repo
shared-module table, CLAUDE.md reconciliation (esp. the many "NOT app-imported → no APP_VERSION"
statements AP2/AP3/AP4/AP5/TV each falsify). Shared-module edits re-run `quotecore.test.mjs` +
`reconstruct.test.mjs` + the full `run-tests.mjs`.

### SIG-DEL — Delete the Signals tab (Q4)
- Remove `panel-signals` (index.html), the nav button + `sigBadge`, `renderSignals` + its callers,
  `computeSignals` + its scheduling (market.js loadAll, trends.js), `STATE.signalCache`, and the
  `planSignal` export from `trendcore.js` + its `trendcore.test.mjs` coverage IFF nothing else imports
  it (grep first — `analyseHourly`/`buildPlan` etc. stay). Acceptance: grep for `signal`/`Signals` in
  `js/`+`index.html` is clean of the tab; the remaining trendcore tests pass; browser smoke.

## Resolved rulings (Ben, 2026-07-10)
- **Q1 = FULL REBASE.** Finder drops the `RATE_W` profit/hr rating entirely and ranks on the shared
  `estimateRank` (net×P÷TTF) + grade — one answer to "best flip," matching the console.
- **Q2 = PORT NOW, inform-labeled.** Provisional (n≈0) rank/grade + validator notes surface WITH a
  prominent "provisional — cutoffs uncalibrated" label. Honesty cost accepted; label is the mitigation.
- **Q3 = ALL FOUR viz**, built on a NEW reusable interactive **chart library** (CL, above), with
  validator notes SPLIT across their relevant viz rather than one flat plan-card block.
- **Q4 = DELETE Signals** (SIG-DEL, above) — Ben doesn't use it; not archived, removed.

## Future improvements discovered (noted for review, NOT auto-implemented)
- **F-A: value/scalp app tabs.** Still provisional, n≈0. Defer to post-P6/F1 evidence even under
  aggressive parity — a public always-on tab is a higher bar than an opt-in `--mode`.
- **F-B: rank/grade CALIBRATION (F1/retrojoin).** The estimator constants + `rating.mjs` cutoffs are
  named placeholders; the whole rank/grade parity story is only as honest as F1. Real prerequisite
  for removing the inform labels.
- **F-C: in-app re-scan / "recommend price adjustment" button.** Stays F1-gated (PLAN.md). AP2's
  richer published scan weakens the case for a client-side re-scan further.
- **F-D: path-engine / conviction-persistence UI.** Decision-support depth belongs on the console;
  the app has no watch-state and must not grow a writer (single-writer rule, watch.mjs owns it). AP3
  ports only the pure read-side `convictionGate`, nothing that writes.
- **F-E: shared-module test parity.** As modules move into `js/`, ensure each keeps its node fixture
  test (move the test's import path, don't drop coverage).

## Honesty (process rule 4)
- The rank/grade and several validators are calibrated at n≈0. Parity makes them VISIBLE, not
  correct — 1.0.0 is a coupling milestone, not a calibration claim. Every ported provisional number
  keeps its inform label until F1.
- The pipeline-version display is of the LAST PUBLISHED artifact, not a live pipeline import — a
  static page can't do better; the label is explicit about it.
