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
- **Finder rating rework** (0.17.0): `computeScores()` in `js/market.js` blends four 0..1
  sub-scores (ROI, liquidity, stability, turnaround) into a `quality` dampener on profit/hr;
  per-factor tooltip on the Risk grade + Rating bar.
- **Ledger auto-populate from fills** (0.18.0): `syncFills()` in `js/ui.js` fetches
  `positions.json` and merges pipeline-reconstructed real trades into the Ledger/Coffer
  (`src:'fills'`, idempotent rebuild, tombstoned via `STATE.fillsHidden`).
- **Position review workflow** (0.19.0): "Review pricing" on the Ledger → `reviewPositions()`
  in `js/trends.js` renders a HOLD / ADJUST / CUT verdict + "list at X" price per open lot.
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
  `pipeline/MONITORING.md`: a verdict per held position, break-even = `ceil(buy/0.98)`,
  with an **evidence-gated 24h-cycle guard** (daily cycles are usually noise → default to
  cutting a genuinely falling position; only a *proven* backtested hour-of-day pattern defers
  a cut). The underwater verdict became the **PLAN-3 gate tree** (0.33.0 — `MONITORING.md`
  step 4; the 24h-cycle guard is unchanged, now framed as input-vs-decision). Session/agent-run
  for now; the durable app-native home is the Refresh-positions + Ledger break-even/regime
  followups below.
- **Last-2h momentum tell — `Mom` column + cut-trigger** (0.30.0): the chunk-2 standard quote
  table (0.28.0) CLAMPS the optimistic prices against the live quote (`optBuy=min(quickBuy,
  bandLo)`, `optSell=max(quickSell,bandHi)`) — correct for *pricing*, but that clamp alone was
  **incomplete**: it ANNIHILATED the momentum signal (a live-outside-its-own-2h-band break can
  never appear once clamped). Fix: `computeQuote` now derives `mom ∈ {clean,breakdown,breakup}`
  from the **pre-clamp** raw band comparison (`quickBuy<rawBandLo` ↓ / `quickSell>rawBandHi` ↑)
  and exposes it; the price clamp is unchanged. `Mom` (clean / ↓ / ↑) renders in the dig-in views
  only (Trends card, Finder **expander**, position review, `quote.mjs`/`screen.mjs`) — NOT the
  Finder bulk list (deliberate; `market.js` untouched). Held-position cut-trigger: shared
  `momVerdict()` in `js/quotecore.js` (used by both `reviewPositions` and `quote.mjs
  --positions`) — ↓+underwater → CUT; ↓+in-profit+flat/falling → LIST-TO-CLEAR; ↓+in-profit+
  rising → size-conditional on `BIG_TICKET_GP` (10m total lot value: ≥ → clear, < → HOLD-watch);
  ↑ → HOLD/list at 2h top. The base-mixing bug is guarded separately by `quoteOrdered()`, not the
  clamp. **(0.33.0: this ↓/↑ matrix is now the Gate-2 leaf of the PLAN-3 underwater gate tree —
  `momVerdict` additionally returns NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT-CANDIDATE ahead of
  it; see the 0.33.0 entry below.)**
- **Underwater-at-tick triage — the five-way read + gated decision tree** (0.33.0, PLAN-3):
  `momVerdict()` in `js/quotecore.js` is now the whole underwater gate tree, not just the Mom
  cut-trigger. `computeQuote` exposes `reliable`/`reliableReason`/`quoteAgeMin` (Gate 0 — a
  stale/one-sided/sparse quote is unreliable; the old `instabuy==null → CUT` bug is fixed to
  **NO-READ**). New pure, fixture-tested helpers: `diurnalRead` (Gate 1 — quiet-hour trough that
  dipped+recovered ~24h ago → **DIURNAL-WATCH**, spent statelessly once the window turns liquid),
  `moveShape` (Gate 2 — small-lot volume-spike **shock** that stabilized → **SHOCK-WATCH**, vs a
  **bleed** → cut), `underwaterHours` (D-escalation — underwater *through a liquid window* →
  **CUT-CANDIDATE**, ending the flat-regime WATCH-forever case). Every gate defers only on
  positive evidence, so the bludgeon-style real breakdown cuts byte-identically (regression-
  guarded). Wired into all three consumers (`watch.mjs`, `quote.mjs --positions`, `reviewPositions`)
  + the `classify()` breakdown route reliability-gated. Acceptance fixtures:
  `pipeline/quotecore.test.mjs` (`node pipeline/quotecore.test.mjs`). Docs: `MONITORING.md` step 4
  is the tree; the 24h-cycle guard is unchanged but reframed as **input** (Gate 0/1: is this a
  price?) vs **decision** (the guard: is there a proven daily rhythm?).
- **Project skills + CLAUDE.md slimming** (2026-07-04, PLAN-5, no `APP_VERSION` bump):
  four committed skills — `/positions` (gate-tree verdict interpretation, incidental-inventory
  filter, feed-inversion reliability override, action plan + interactive tail), `/scan`
  (judgment pass over `screen.mjs` incl. the 500k gp/d floor), `/overnight` (two-phase
  composer: `/positions` → pause for capital → `/scan` + 8h accumulation sizing
  `min(limit×2, 8/24×0.10×volDay)`), `/morning` (overnight reconstruction, re-verdict stale
  bids) — at `.claude/skills/*/SKILL.md`. `quote.mjs` regime lines now print the buy limit
  (chunk 3a). Per-workflow doctrine *moved* out of this file into the skills (see "Market
  judgment layer" below). **Skill-versioning convention:** skills-only changes bump the
  SKILL.md `version:` frontmatter and get a one-line pointer here — they NEVER bump
  `APP_VERSION` (that marks the deployed app, which skills never touch).
- **`/overnight` v1.1 — fill-realism check** (2026-07-04): the first real overnight run
  filled 0/50,000 units — band-floor bids are extreme prints nobody crosses down to during
  quiet hours, and the accumulation formula is an upper bound that assumes fills at your
  price. The skill now requires a fill-realism read (price between band floor and instasell
  for must-fill bids; count recent 5m windows at/below the bid) and "up to" framing.

## Market judgment layer — lives in the project skills (moved by PLAN-5)
The screen/positions judgment layer (500k gp/d floor, 24h-drift-is-a-pre-filter-only,
two-sided liquidity / ghost-spread discipline, tax-dominates-thin-flips, band-is-the-edge
pricing, band-top artifacts, fresh-repricer flag, overnight/morning posture) lives in the
committed project skills `/scan`, `/positions`, `/overnight`, `/morning`
(`.claude/skills/*/SKILL.md`) — *moved* there, not copied, so it loads only when the
workflow runs. The ask→command table below still routes bare asks.

## Market analysis workflow — standard output format
Every market read presented to Ben (screen, per-item quote, position review) is ONE table:
`Item | Guide | Mid | Buy@ Quick/Opt | Sell@ Quick/Opt | Net/u Quick/Opt (ROI) | Vol/d | Mom | Regime`
- Quick = transact now (buy at live instasell, sell at live instabuy). Optimistic = patient
  2h-band edges (last 24×5m points: min avgLow / max avgHigh).
- **Ordering + the `Mom` (last-2h momentum) column.** On ONE consistent basis, optBuy ≤ quickBuy
  ≤ quickSell ≤ optSell holds *normally*. A break means one of two things — check the bases FIRST:
  (1) **inconsistent bases → bug** (24h percentiles mixed with live quotes — the 2026-07-03
  incident); fix the script. (2) **consistent bases (live `/latest` + 2h 5m-band) → a real-time
  momentum tell**, not an error: the live price moved *outside* its own 2h band. `quickBuy < optBuy`
  (live instasell below the 2h floor) = **↓ breaking down / active pullback** — don't buy in, and a
  held big-ticket flashing this is a CUT trigger that fires *before* the lagging multi-day regime
  confirms (this is the signal whose absence cost us on the bludgeon exit). `quickSell > optSell`
  (live instabuy above the 2h top) = **↑ breaking up / fresh 2h high**. Clean in-band = ranging.
  The price columns clamp opt to never cross quick (correct *pricing*), so this tell is surfaced as
  the **`Mom` column** (clean / ↓ / ↑), computed from the *pre-clamp* live-vs-band comparison. `Mom`
  is a **dig-in / position-management** signal — it appears in the per-item views that fetch the real
  2h series (Trends card, Finder expander, position review) and the `quote.mjs`/`screen.mjs` scripts,
  and it drives the position cut-trigger (a held breakdown escalates toward CUT before the regime
  confirms; big-ticket in-profit-but-breaking-down positions clear rather than hold). It is
  deliberately NOT wired into the bulk Finder-list rating (approximate there / churns the sort).
  Verified live 2026-07-03 — flags matched an independent 2h-drift read.
- Guide = real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- Vol/d = limiting side, `min(highPriceVolume, lowPriceVolume)` from the 24h endpoint.
- Net/u after 2% tax. Regime = multi-day regimeDrift check (flat/rising/falling label).
- Break-even = `ceil(buy/0.98)` — never list a held item below it.
- **Falling-regime items are excluded from screens entirely — don't show or mention them.**
  Exception: items Ben holds or asks about → always show, with price-to-clear guidance.
- Screens: `screen.mjs` prints one table per niche, adding a Grade + `Score gp/d` column to
  the canonical layout (grade cutoffs in `rating.mjs` are placeholders pending validation).
**How to generate these tables — each canonical ask maps to a skill or an exact command.
These scripts exist and ARE the workflow.** ALWAYS use them; NEVER hand-write a `node -e`
fetch for a market read (each ad-hoc script also burns ~1–2k tokens to author + parse — the
scripts exist specifically to kill that cost). All the scripts import `js/quotecore.js`, so
the numbers are byte-identical to the app's tables.

**Plain-language → command (match Ben's ask to ONE of these and run it immediately — don't
deliberate):**

| When Ben says something like… | Run |
| --- | --- |
| "how's **`<item>`**?", "quote **X**", "what's **X** doing?", "check **X** [and **Y**]" | `node pipeline/quote.mjs "<item or id>" [...more]` |
| "find me flips", "any **opportunities**?", "what should I **buy**?", "**screen** the market", "anything in **`<niche>`**?", "**scan**" | **`/scan` skill** — runs `node pipeline/screen.mjs [--mode band\|spread\|rising\|churn\|all]` + the judgment pass |
| "how are my **positions**?", "check the market against **what I hold**", "am I **underwater**?", "should I **cut/hold** anything?", "review my **holds**" | **`/positions` skill** — runs `node pipeline/quote.mjs --positions` + verdict interpretation → action plan |
| "set up for **overnight**", "what should I leave running overnight", "**going to bed**" | **`/overnight` skill** — two-phase: `/positions` → pause for stated capital → `/scan` + accumulation sizing |
| "what happened **overnight**?", "**morning** review", "what **filled**?", "catch me up" | **`/morning` skill** — positions.json/fills.json + `monitor.mjs` + re-verdict stale bids |
| "watch/**monitor** my positions", "run a flipping **session**", "poll/keep an eye on **X**" | `node pipeline/watch.mjs ["<target>" …]`  (drive with `/loop`, see `pipeline/MONITORING.md`) |

Script facts the skills rely on (current behavior, not doctrine):
- `quote.mjs` takes multiple items in one call; prints one combined table + a regime line
  per item that includes the **buy limit** (`· buy limit N/4h`) and a `⚠ feed inversion`
  footnote when the quote basis is unreliable.
- `quote.mjs --positions` adds Held@/Break-even/Verdict columns; the verdict vocabulary is
  the PLAN-3 gate tree (`MONITORING.md` step 4, emitted by the shared `momVerdict()`):
  NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT / LIST-TO-CLEAR / HOLD / CUT-CANDIDATE.
  Interpretation of those verdicts lives in `/positions`.
- `screen.mjs` shares one gate stack (two-sided liquidity, price window, falling-exclusion);
  `--mode` swaps only the step-3 edge (band / spread / rising / churn, or `all`).
- `nightlows.mjs "<item>" [--nights 14] [--window 0-8] [--bid <gp>]` scores the last ~14
  local nights from the 1h timeseries: per-night low + overnight instasell volume, and the
  bid levels touched on ~50%/~75%/all nights. `/overnight`'s fill-realism check runs it on
  every candidate bid ("touched" ≠ limit filled; ~14 nights is a small sample).

## Open followups (not yet built)
- **The master plan: `PLAN.md`** (single plan file since 2026-07-04) — ALL open work lives
  there as waves of chunks the coordinator session hands to Opus subagents: T1/T2 (table v2 +
  Trends sections/last-2h view), O1 (outcomes dataset), K1/K2 (self-improving skills +
  memory dedupe), S1–S3 (gp-flow gate + 500k floor + spread verdict, overnight posture,
  watchlist-always-scanned), Q1 (Gate-0 reliability gap — interim: `/positions` treats
  feed-inversion-footnoted rows as NO-READ-equivalent), E1 (local-time audit), L1 (action
  logging), M1 (mobile parity — includes the Refresh-positions button), N1 (push
  notifications); F1 gated on O1. Sequential chunks land directly on main; parallel lanes
  use worktree subagents merged by the coordinator. The historical plan docs
  (`PLAN-2/3/4/5.md`) are **deleted** — full text via `git show 39e5d23:PLAN-4.md` (etc.).
- **Per-item "recommend price adjustment" button** on the Trends page: pull fresh GE
  state + item info on demand and recommend a price tweak (ties into patient pricing
  and eventually the fills pipeline's realized-vs-suggested calibration; tracked in
  PLAN.md's unscheduled notes).
- ~~**Ledger redesign — grouped, watchlist-filtered, period P&L**~~ — **BUILT** (watchlist
  filter, per-item grouping + drill-in, period P&L bucketed by SELL date — `renderLedger` /
  `periodKey` in `js/ui.js`). The local-timezone day-boundary verification lives in PLAN.md
  chunk E1.

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
5. Bump `APP_VERSION` (in `js/state.js`) on every shipped change **to the deployed app**.
   Skills-only changes bump the SKILL.md `version:` frontmatter instead (never
   `APP_VERSION`); pipeline-only stdout tweaks may ship without a bump, noted in the
   commit message.
6. Before running `git commit`/`git push` (including via `sync-fills.mjs`), it's fine
   to just do it once the change has been described to Ben — but for the *pipeline
   script's own* automated commits (via Task Scheduler), no confirmation loop is
   possible or expected; that's by design (§4.7 of `pipeline/FILLS-PIPELINE.md`).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed for git operations;
   don't suggest installing anything else for those. The GitHub CLI (`gh`) IS
   installed (2026-07-04) but is scoped to API reads/deploy checks, not git — see
   "GitHub CLI (`gh`) and GitHub Actions" below.
8. **A documentation pass is part of every change — not optional, and not append-only.**
   Before calling a change done, update the docs the change touches: this `CLAUDE.md`
   (a "Done" pointer, plus any workflow/section it affects), and any affected doc
   (`pipeline/MONITORING.md`, `pipeline/FILLS-PIPELINE.md`, `README.md`). Crucially, this is
   a *reconciliation* pass, not just new prose: **grep the docs for statements the change now
   supersedes or contradicts and fix them in place** (e.g. a superseded matrix/table, a stale
   "verdict set", a now-inaccurate trigger condition). Adding a new section while leaving an
   old one that says the opposite is the failure mode to avoid — the 0.30.0→0.33.0
   `momVerdict` reconciliation is the anchor. If a plain-language ask should map to a specific
   script/flow, make that mapping explicit in the relevant CLAUDE.md section so a future agent
   runs the right thing immediately.

## GitHub CLI (`gh`) and GitHub Actions — usage rules
`gh` is installed (2026-07-04, via winget) and authed to the `bensumm` GitHub
account. Its role here is deliberately narrow:
- **Read/verify only by default.** Deploy status (`gh run list` / `gh run watch`),
  run logs, `gh api` reads. Never open PRs, create releases, or push via `gh`
  unless Ben explicitly asks — work ships directly to `main` with git-over-SSH,
  unchanged.
- **Deploy verification is part of every push to `main` that touches the deployed
  app** (Ben, 2026-07-04): after pushing, watch the `pages-build-deployment` run
  (`gh run watch $(gh run list --workflow pages-build-deployment -L 1 --json
  databaseId -q '.[0].databaseId')` or just `gh run list -L 1` until it reads
  `completed success`) and confirm success before calling the change done. This
  extends rule 2's "actually run it" to the deploy itself. Pipeline auto-commits
  (`CofferFillsSync`) are exempt — no agent is present for those.
- **Never run `gh auth setup-git`.** git auth stays SSH; `gh`'s token is for the
  API only. If git ever starts prompting for credentials, suspect this and check
  `git config --get-all credential.helper`.
- **No GitHub Actions workflows without an explicit ask.** The repo has no
  `.github/workflows/` on purpose — the only "Action" is GitHub's automatic Pages
  build (`pages-build-deployment`, no workflow file). Two structural reasons this
  stays true: (1) the fills pipeline reads `~/.runelite/exchange-logger/*` on
  Ben's machine — a cloud runner can't see it, so Task Scheduler is the correct
  home for any scheduled job; (2) the repo is public, so workflows would run with
  public logs. Don't propose "move X to CI".

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
  by itself purge an already-merged event; append a `REMOVE` tombstone line (the chunk-1
  vocabulary, confirmed working) to `coffer-manual.log`, then re-sync.
- Task Scheduler job `CofferFillsSync` runs `wscript.exe
  pipeline\run-fills-sync.vbs` every 20 min (hidden window). If any pipeline file
  moves again, that task's registered path needs re-creating too — it's not
  automatically kept in sync with the repo (`schtasks /Delete` + `/Create`, see
  `pipeline/FILLS-PIPELINE.md` §4.7).
