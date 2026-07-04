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

## Trends tab structure
The per-item Trends view's decision-priority tier structure (plan card → "Why this trend?"
→ price history → timing/seasonality, and the regime-guard/backtest-gate lesson) is a
**header comment at the top of `js/trends.js`** — read it before editing `runTrends`, since
that's where every editor of the view already is. (Moved out of CLAUDE.md by chunk K3.)

## Done (recent, for context — don't rebuild)
Deep per-version writeups (the "why", superseded approaches) live in `CHANGELOG.md`. Below
is the one load-bearing "do not rebuild this" line per entry; open `CHANGELOG.md` for the
full story.
- **Gate-0 feed-inversion fix** (0.36.0, Q1) — a crossed feed (instasell>instabuy) is now
  `reliable:false`/`reliableReason:'feed-inversion'` in `computeQuote`, so `momVerdict()` Gate 0
  prints **NO-READ** instead of a decisive verdict off a non-price. `/positions`' interim
  override is gone. Don't re-add per-consumer inversion checks — the reliability signal is shared.
- **Finder rating rework** (0.17.0) — `computeScores()` in `js/market.js`: four 0..1
  sub-scores → a `quality` dampener on profit/hr.
- **Ledger auto-populate from fills** (0.18.0) — `syncFills()` in `js/ui.js` merges
  `positions.json` (`src:'fills'`, idempotent, tombstoned via `STATE.fillsHidden`).
- **Position review workflow** (0.19.0) — `reviewPositions()` in `js/trends.js`:
  HOLD/ADJUST/CUT + "list at X" per open lot.
- **Falling items → price to clear** (0.20.0) — SUPERSEDED 0.19.0's "list high above
  market" (the ~always-true `patientUpside` guard misfired in a decline). `renderPositionCard`
  now always lists a faller at the instabuy (in profit → SELL; underwater → CUT), never
  above it. Don't reintroduce the upside guard.
- **Last-2h momentum — `Mom` column + cut-trigger** (0.30.0) — `computeQuote` derives
  `mom` from the **pre-clamp** band comparison; shared `momVerdict()` in `js/quotecore.js`
  drives the held-position cut-trigger. Deliberately NOT wired into the bulk Finder list.
- **Underwater-at-tick triage — the gate tree** (0.33.0, PLAN-3) — `momVerdict()` is the
  whole tree; Gate-0 `reliable` + `diurnalRead`/`moveShape`/`underwaterHours`; verdicts
  NO-READ/DIURNAL-WATCH/SHOCK-WATCH/CUT/LIST-TO-CLEAR/HOLD/CUT-CANDIDATE. Fixtures:
  `pipeline/quotecore.test.mjs`. `MONITORING.md` step 4 is the tree. Every gate defers only
  on positive evidence (real breakdown cuts byte-identically — regression-guarded).
- **Project skills + skill-versioning convention** (PLAN-5) — `/positions` `/scan`
  `/overnight` `/morning` at `.claude/skills/*/SKILL.md`; per-workflow doctrine *moved*
  there. Skills-only changes bump the SKILL.md `version:` frontmatter, NEVER `APP_VERSION`.
- **`/overnight` fill-realism check** (v1.1/1.2) — band-floor bids don't fill overnight;
  `nightlows.mjs` scores recent nights; size as "up to", not a guarantee.
- **Self-improving skills** (PLAN-5 K1) — each workflow skill's closing "Encode learnings"
  section: after the market work (offers first), one canonical home per fact, background
  subagent edits+commits. Market claims still need evidence (one session = one sample).

## Market judgment layer — lives in the project skills (moved by PLAN-5)
The screen/positions judgment layer (500k gp/d floor, 24h-drift-is-a-pre-filter-only,
two-sided liquidity / ghost-spread discipline, tax-dominates-thin-flips, band-is-the-edge
pricing, band-top artifacts, fresh-repricer flag, overnight/morning posture) lives in the
committed project skills `/scan`, `/positions`, `/overnight`, `/morning`
(`.claude/skills/*/SKILL.md`) — *moved* there, not copied, so it loads only when the
workflow runs. The ask→command table below still routes bare asks.

## Market analysis workflow — standard output format
Every market read presented to Ben (screen, per-item quote, position review) is ONE table
(the **table v2** column set, T1):
`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime`
- **Quick** and **Optimistic** are each SELF-CONTAINED cells reading `buy → sell · net/u (ROI)`
  (net after 2% tax; the cell is colored gain/loss in the app). Quick = transact now (buy at live
  instasell, sell at live instabuy). Optimistic = patient 2h-band edges (last 24×5m points: min
  avgLow / max avgHigh). Mid is dropped from the table (redundant next to Guide + the live prices;
  the row model still exposes `row.mid` for `rating.mjs`/`watch.mjs`).
- **Ordering + the `Momentum` (last-2h momentum) column.** On ONE consistent basis, optBuy ≤ quickBuy
  ≤ quickSell ≤ optSell holds *normally*. A break means one of two things — check the bases FIRST:
  (1) **inconsistent bases → bug** (24h percentiles mixed with live quotes — the 2026-07-03
  incident); fix the script. (2) **consistent bases (live `/latest` + 2h 5m-band) → a real-time
  momentum tell**, not an error: the live price moved *outside* its own 2h band. `quickBuy < optBuy`
  (live instasell below the 2h floor) = **breaking down / active pullback** — don't buy in, and a
  held big-ticket flashing this is a CUT trigger that fires *before* the lagging multi-day regime
  confirms (this is the signal whose absence cost us on the bludgeon exit). `quickSell > optSell`
  (live instabuy above the 2h top) = **breaking up / fresh 2h high**. Clean in-band = ranging.
  The price columns clamp opt to never cross quick (correct *pricing*), so this tell is surfaced as
  the **`Momentum` column**, computed from the *pre-clamp* live-vs-band comparison and rendered with
  strength-graded arrows: `–` (clean/in-band, muted) · `↑`/`↓` (single-arrow break, amber) ·
  `↑↑`/`↓↓` (strong break ≥ `MOM_STRONG_PCT` past the band edge — green up / red down). `Momentum`
  is a **dig-in / position-management** signal — it appears in the per-item views that fetch the real
  2h series (Trends card, Finder expander, position review) and the `quote.mjs`/`screen.mjs` scripts,
  and it drives the position cut-trigger (a held breakdown escalates toward CUT before the regime
  confirms; big-ticket in-profit-but-breaking-down positions clear rather than hold). The categorical
  `mom` (clean/breakdown/breakup) is unchanged — the arrows are display strength only; `momVerdict`/
  the cut-trigger still consume `mom`. It is deliberately NOT wired into the bulk Finder-list rating
  (approximate there / churns the sort). Verified live 2026-07-03 — flags matched an independent
  2h-drift read.
- Guide = real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- Vol/d = limiting side, `min(highPriceVolume, lowPriceVolume)` from the 24h endpoint.
- Net/u (inside the Quick/Optimistic cells) is after 2% tax. Regime = multi-day regimeDrift check
  (flat/rising/falling label).
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
- `watch.mjs` watches every **position**, where a position = *any committed capital*: held
  inventory PLUS every active GE offer (Ben's definition, 2026-07-04; shared log reader
  `pipeline/offers.mjs`). Asks annotate their held row (`listed n/m @ X` / `NOT LISTED`);
  bids get an ACTIVE BIDS section with verdicts BID-OK / BID-BEHIND / CROSSING / CANCEL-BID
  (only CANCEL-BID — adverse-selection fill risk — alerts). Offers under 100k total value
  are noise, collapsed to one line. `quote.mjs --positions` remains the booked-lots view.
- `nightlows.mjs "<item>" [--nights 14] [--window 0-8] [--bid <gp>]` scores the last ~14
  local nights from the 1h timeseries: per-night low + overnight instasell volume, and the
  bid levels touched on ~50%/~75%/all nights. `/overnight`'s fill-realism check runs it on
  every candidate bid ("touched" ≠ limit filled; ~14 nights is a small sample).

## Open followups (not yet built)
- **The master plan: `PLAN.md`** (single plan file since 2026-07-04) — ALL open work lives
  there as waves of chunks the coordinator session hands to Opus subagents: T1/T2 (table v2 +
  Trends sections/last-2h view), O1 (outcomes dataset), K1/K2 (self-improving skills +
  memory dedupe), S1–S3 (gp-flow gate + 500k floor + spread verdict, overnight posture,
  watchlist-always-scanned), E1 (local-time audit), L1 (action
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
   installed (2026-07-04) but is the API layer, not a git transport — see the
   "GitHub CLI (`gh`), Actions CI, and shipping" section and the `/ship` skill.
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

## GitHub CLI (`gh`), Actions CI, and shipping — mechanics live in `/ship`
- **Every push to `main` follows the `/ship` skill** (rebase-push, then verify via
  `gh run list` that the `checks` run — and, for app-touching changes, the
  `pages-build-deployment` run — is green). A push isn't done until its runs are.
- `gh` (installed + authed 2026-07-04) is the API layer only; git operations stay
  on git-over-SSH. **Never run `gh auth setup-git`** (details in `/ship` §5).
- **CI: `.github/workflows/checks.yml`** — cheap always-on checks (JS syntax
  sweep, quotecore fixtures, `fills.json`/`positions.json` parse); it is the only
  guard on the pipeline's unattended auto-commits. Agents may add/improve
  workflows within the constraints in `/ship` §4 (public logs, no `~/.runelite`,
  seconds-fast, no secrets).
- **Direction of travel: PR flow for everything + merge queue** = PLAN.md chunk
  G1 (sequenced before M1/N1; sync-cadence investigation first — Ben expects the
  20-min sync to demote to on-demand or disappear). Direct-to-main stays the
  operative workflow until G1 lands — don't half-adopt PRs.

## The `STATE` object (js/state.js) — read before editing shared state
The rule (all app-wide mutable state lives as properties on one exported `STATE` object,
because a module can't reassign an imported bare `let` binding — that's a SyntaxError) is a
**header comment at the top of `js/state.js`**, next to the object it governs. Read it
before adding shared mutable state: put new mutable state on `STATE`, not a new bare
`export let`; never-reassigned constants stay `export const`. (Moved out of CLAUDE.md by
chunk K3; this pointer stays with the process rules above.)

## Time display convention — displayed times are LOCAL
Every timestamp the app *renders* (Ledger day/week/month buckets via `periodKey`, "synced"
stamps, fills-log entries, the Logs view, Trends hour-of-day/`getHours()` markers, quote
freshness) is derived with the local-time `Date` getters (`getHours`/`getMonth`/`getDate`/
`getDay`, `toLocaleTimeString`) — never `getUTC*`/`toISOString`. `UTC`/`ISO` is **storage and
wire format only**: epoch-second `ts` fields, backup metadata (`exportedAt`), the backup
filename slug. The manual-log `date`/`time` strings are written in local wall-clock time by
both `fillsLogLine` (`js/fillslog.js`) and `pipeline/add-manual-fill.mjs`, so rendering them
raw (e.g. the synced-line list in `editManualLog`, `js/ui.js`) is already local. Verified by
the E1 audit (2026-07-04) with a near-midnight `periodKey` fixture — a local 23:55 dip buckets
to that day, not the UTC-rolled next day. When adding a rendered timestamp, use the local
getters; only reach for UTC when writing something that leaves the app.

## Environment notes (Windows machine)
The Windows-machine environment notes (RuneLite `profiles2` flush-on-restart, the Exchange
Logger field mapping, cancel semantics, the manual-fill `--time` timestamp rule + `REMOVE`
tombstones, the `CofferFillsSync` Task Scheduler job) are consolidated in
**`pipeline/FILLS-PIPELINE.md` §10** (single home). Read that before touching the pipeline
or a source log. (Moved out of CLAUDE.md by chunk K3.)
