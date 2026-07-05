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
  Windows machine **on demand** — session-start or a manual push; the ~20-min
  `CofferFillsSync` Task Scheduler job was eliminated 2026-07-04, see FILLS-PIPELINE.md
  §12 — reads `.runelite/exchange-logger/*`, writes/commits/pushes `fills.json` **and**
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
- **Push-notification trigger engine** (N1, pipeline+docs only — no APP_VERSION) — delivery-
  agnostic `pipeline/alerts.mjs` DETECTS + EMITS three transition-only classes (held-verdict
  escalation via shared `momVerdict`, offer fills via `offers.mjs`, named price crosses from
  tracked `alerts.json`) against a gitignored `.alerts-state.json`; quiet hours suppress
  position/price (fills exempt). Delivery mechanism decided after a live trial of a scheduled
  Claude session + harness `PushNotification` (option a). Full contract: `MONITORING.md`
  "Push notifications on market events".
- **Mobile parity — GitHub-as-backend writes** (0.39.0, M1) — the phone logs a GE trade by
  appending a **slot-9** source line to tracked repo-root `mobile-fills.log` via the GitHub
  contents API (`js/github.js`; fine-grained PAT in localStorage — never rendered/exported/logged,
  "PAT updated" only). The Ledger quick-add routes desktop→FS-log (slot 8) / mobile→GitHub (slot 9,
  GET sha → PUT append, 409 retry). `sync-fills.mjs` is now multi-writer: ff onto a moved
  `origin/main` (phone push) BEFORE reading logs, **fresh commit** on top, **loud abort on
  divergence** (disjoint single-writer contract — the phone writes ONLY `mobile-fills.log`, the PC
  ONLY fills/positions/screen/suggestions). Freshness = a `generatedAt` staleness banner + a
  **Refresh-positions** button (same-origin re-fetch — it can't regenerate `positions.json`). S3's
  watchlist write-back rides the same contents-API path. Full detail: `FILLS-PIPELINE.md` §13.
- **Action logging pass** (0.38.0, L1) — the `logEvent` ring gained an `'action'` scope for
  user actions (tab/watchlist/trade/refresh/trends-open/position-review/backup/settings),
  logged at the **event handler** (never inside shared `switchTab`/`loadAll`, so re-renders
  don't log); `LOG_MAX` 50→200; Logs view has an All/Actions/System scope filter
  (`STATE.logFilter`). Never log secret values (M1's PAT logs "PAT updated" only — never the value).
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
  `windowrange.mjs` (né `nightlows.mjs`) scores recent nights; size as "up to", not a guarantee.
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
- **Liquidity gate (S1):** the two-sided requirement (`hpv>0 && lpv>0`) is the *non-negotiable*
  ghost-spread lesson — but the raw UNIT floor (`--floor 50/d`) was the wrong UNIVERSAL measure. An
  item now clears liquidity on `limitVol ≥ --floor` **OR** gp-flow `limitVol×mid ≥ --gp-floor`
  (default 250m). The gp-flow-only path admits big tickets (single-digit units/day, hundreds of
  millions of real daily flow — the Avernic-defender-hilt class); those are flagged `thin`, capped at
  grade **A-** (`rating.mjs`, `THIN_GRADE_CAP` — you can only move a few units/day) with a "thin:
  ~N/day — size in units, expect slow fills" tooltip, and bounded to a small fetch RESERVE
  (`--thin-reserve`, default 6/niche) so noisy thin bands never crowd out liquid flips.
- **500k attention floor (S1):** `--min-gpd` (default 500_000) drops any row whose realistic
  `expGpDay` is below the floor *pre-rating* — the structural home of Ben's "never surface sub-500k"
  rule (was a `/scan` post-filter). Thin gp-flow qualifiers and held/asked items are exempt.
- Net/u (inside the Quick/Optimistic cells) is after 2% tax. Regime = multi-day regimeDrift check
  (flat/rising/falling label).
- Break-even = `ceil(buy/0.98)` — never list a held item below it.
- **Falling-regime items are excluded from screens entirely — don't show or mention them.**
  Exception: items Ben holds, asks about, **or watchlists** (S3) → always show, with price-to-clear
  guidance. `screen.mjs` appends a **Watchlist** section (from tracked repo-root `watchlist.json`)
  quoting every watchlisted item as a full standard row — exempt from every floor/gate, graded, with
  the reason a gate *would* have hidden it as a Note (below-floor / thin / one-sided / falling).
  Falling watchlist items ARE shown there, with the falling warning.
- Screens: `screen.mjs` prints one table per niche, adding a Grade + `Score gp/d` column to
  the canonical layout (grade cutoffs in `rating.mjs` are placeholders pending validation).
- **Time-of-day context on every price recommendation (Ben, 2026-07-05).** Whenever a
  specific buy or sell price is being suggested (scan pick, per-item quote follow-up,
  position reprice, ladder rung), run a `windowrange.mjs` window read for the relevant
  local-hours window (e.g. `--window 21-0` for a late-evening bid) and read the level
  against the last ~14 same-window lows — daily movement patterns are standing context,
  not an overnight-only tool. It caught the bludgeon evening bounce, re-priced the jaw
  bid to the level its window actually touches, and exposed the webweaver 3-day repricer
  (2026-07-05). Honesty rule applies: ~14 nights is a small sample; "touched ≠ filled";
  it's a guide that shifts a price a few ticks, never a guarantee that overrides the
  band/regime read.
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
- `screen.mjs` shares one gate stack (two-sided liquidity **OR** `--gp-floor` gp-flow, price window,
  `--min-gpd` 500k attention floor, falling-exclusion); `--mode` swaps only the step-3 edge (band /
  spread / rising / churn, or `all`). Thin gp-flow big tickets ride a bounded `--thin-reserve`.
- `screen.mjs --posture overnight|active|auto` (S2) TUNES that stack (not a new niche): **overnight**
  keeps only flat/rising + confident-band + non-thin + non-breakdown rows, ranks by net edge over
  velocity, and drops items whose *yesterday overnight window* printed below the current bid
  (`overnightStaleRisk`); **auto** picks by the local clock (~22:00–06:00); **active** (default) =
  current behavior. Posture is recorded in `screen.json` so the Scan banner names it. `/overnight`
  runs `--posture overnight`. `quote.mjs --positions` prints an informational late-night morning-
  staleness line (verdict logic unchanged).
- `watch.mjs` watches every **position**, where a position = *any committed capital*: held
  inventory PLUS every active GE offer (Ben's definition, 2026-07-04; shared log reader
  `pipeline/offers.mjs`). Asks annotate their held row (`listed n/m @ X` / `NOT LISTED`);
  bids get an ACTIVE BIDS section with verdicts BID-OK / BID-BEHIND / CROSSING / CANCEL-BID
  (only CANCEL-BID — adverse-selection fill risk — alerts). Offers under 100k total value
  are noise, collapsed to one line. `quote.mjs --positions` remains the booked-lots view.
- `windowrange.mjs "<item>" [--nights 14] [--window 0-8] [--bid <gp>] [--ask <gp>]` (renamed
  from `nightlows.mjs` 2026-07-05 when the high side was added) scores the last ~14 local
  days from the 1h timeseries: per-day window low AND high + instasell/instabuy volume, the
  bid levels touched and ask levels reached on ~50%/~75%/all days, and `--bid`/`--ask`
  scoring for specific candidates. `/overnight`'s fill-realism check runs it on every
  candidate bid; the time-of-day doctrine bullet above runs it on every price rec
  ("touched/reached" ≠ limit filled; ~14 days is a small sample).

## Open followups (not yet built)
- **The master plan: `PLAN.md`** (single plan file since 2026-07-04) — ALL open work lives
  there as waves of chunks the coordinator session hands to Opus subagents: T1/T2 (table v2 +
  Trends sections/last-2h view), O1 (outcomes dataset), K1/K2 (self-improving skills +
  memory dedupe), S1–S3 (gp-flow gate + 500k floor + spread verdict, overnight posture,
  watchlist-always-scanned), E1 (local-time audit), L1 (action
  logging), M1 (mobile parity — includes the Refresh-positions button), N1 (push
  notifications); F1 gated on O1. `main` is protected by a PR+`checks` ruleset (G1,
  2026-07-04); no merge queue on this user-owned repo and PR creation is token-blocked for
  now, so chunks land via attended direct-push under the admin bypass (parallel lanes still
  use worktree subagents, hand-serialized) until `gh auth refresh` enables the PR path. The historical plan docs
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
6. **`main` is protected by a ruleset** (G1, 2026-07-04 — PR + `checks` required, no
   force-push/deletion; repository-admin **always** bypass). Two live caveats: no merge
   queue (user-owned repo — unavailable) and PR *creation* is currently token-blocked
   (`createPullRequest` → `FORBIDDEN`; needs `gh auth refresh -s repo`, Ben-only). **So the
   practical path today is attended direct-push under the admin bypass** (`git fetch &&
   rebase origin/main && push`); the PR-for-everything flow is the intent once the token is
   refreshed — full state in `/ship` §2/§6. Describe the change to Ben before landing it.
   On-demand `sync-fills.mjs` pushes of `fills.json`/`positions.json`/`suggestions.jsonl`
   go direct to `main` too (pipeline-owned; clobber-guard reconciles). No unattended writer
   remains (the schedule was eliminated — `pipeline/FILLS-PIPELINE.md` §12).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed for git operations;
   don't suggest installing anything else for those. The GitHub CLI (`gh`) IS
   installed (2026-07-04); it is the API + **PR/merge-queue management** layer, not a git
   transport (git stays on SSH) — see the "GitHub CLI (`gh`), Actions CI, and shipping"
   section and the `/ship` skill.
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
- **`main` is protected by a ruleset** (G1, 2026-07-04): PR + `checks` required, no
  force-push/deletion, repository-admin **always** bypass (ruleset id `18520289`). Two live
  caveats — **no merge queue** (user-owned repo → unavailable) and **PR creation is
  token-blocked** (`createPullRequest` → `FORBIDDEN`; fix = `gh auth refresh -s repo`,
  interactive/Ben-only). So today changes land by **attended direct-push under the admin
  bypass** (verified working, incl. the sync); the `gh pr create` → `gh pr merge --squash`
  flow is the intent once the token is refreshed. Full honest state: `/ship` §2/§6.
- `gh` (installed + authed 2026-07-04) is the API + ruleset/PR management layer; git
  operations stay on git-over-SSH. **Never run `gh auth setup-git`** (details in `/ship` §5).
- **On-demand `sync-fills.mjs` pushes go direct to `main`** riding the admin bypass
  (pipeline-owned artifacts; clobber-guard reconciles). No unattended writer / machine
  bypass identity exists — the schedule was eliminated (`pipeline/FILLS-PIPELINE.md` §12).
- **CI: `.github/workflows/checks.yml`** — cheap checks (JS syntax sweep, quotecore
  fixtures, `fills.json`/`positions.json` parse) run on push, PR, and `merge_group`; it is
  the ruleset's required status check. Agents may add/improve workflows within the
  constraints in `/ship` §4 (public logs, no `~/.runelite`, seconds-fast, no secrets).

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
tombstones, the on-demand sync cadence — the `CofferFillsSync` schedule was eliminated,
§12) are consolidated in **`pipeline/FILLS-PIPELINE.md` §10** (single home). Read that before touching the pipeline
or a source log. (Moved out of CLAUDE.md by chunk K3.)
