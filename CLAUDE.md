# The Coffer / The-Ledger — instructions for Claude Code

This repo is the primary, ongoing place where this tool gets built and iterated on.
Expect repeated sessions here, not one-offs — check git log and this file for
context before assuming something is new.

**Live app: https://bensumm.github.io/The-Ledger/** (bookmarkable; auto-deploys on
push to `main`).

## What this is
- **The Coffer**: OSRS Grand Exchange flipping tool. `index.html` is markup only; `styles.css`
  holds all styles; logic is split into ES modules under `js/`. **No build step, no framework, no
  bundler** — deployed to GitHub Pages exactly as the files sit on disk. The **full module/file
  inventory is `README.md`** ("Files" + "Map of the repo") — the ONE registry; don't duplicate it
  here. Why it's split out of the old single `index.html`, and how localhost differs (the
  LW2/LW3/LW4 live desk — incl. the Scan tab's LOCAL "Refresh scan" that runs a real
  `screen-flip-niches.mjs --publish` via `pipeline/commands/dev-server.mjs`'s `POST /api/scan`, zero git): `docs/LORE.md`.
  Local testing needs `serve.cmd` (ES modules don't load over
  `file://`); see README "Local development".
- **Fill-data pipeline**: closes the loop between the tool's suggestions and real GE trades,
  captured client-side via RuneLite's Exchange Logger. Lives in `pipeline/` (separate from the
  deployed app root); design doc `pipeline/FILLS-PIPELINE.md`, sync script `pipeline/commands/sync-fills.mjs`
  (**on-demand only** — the `CofferFillsSync` scheduler was eliminated 2026-07-04, §12). It reads
  `.runelite/exchange-logger/*` and rebuilds `fills.json` + the derived `positions.json`
  (+ `offers.json`, LW1). **The DEFAULT is now LOCAL / ZERO-GIT (Ben 2026-07-15)** — a bare run writes
  the artifacts with no fetch/commit/push, so it's the cheap always-fresh in-session read. The `/scan`
  and `/positions` read commands (`screen-flip-niches.mjs`, `quote-items.mjs --positions`) now **auto-run
  this local sync themselves before the read** (SY1, 2026-07-16 — enforced in-code, was a repeatedly-skipped
  doctrine); run it MANUALLY only for OTHER surfaces that don't (e.g. a bare quote, `/morning`, a hand
  read of `positions.json`). **Publishing is ONCE A DAY at `/overnight` via `sync-fills.mjs
  --publish`** (the only path that fetches/ff-pulls phone trades + commits + pushes) — so the deployed
  app's book updates nightly while the localhost desk reads the fresh rebuild all day. `positions.json` is the FIFO-reconstructed view (`collapseOffers` +
  `matchTrades`): `closed` after-tax realised P/L, `open` inventory at real avg cost, `unmatched`
  pre-log sells. **`fills.json` and the derived artifacts are ROOT-LOCKED** (app fetches them
  same-origin — README "Map of the repo" has the full ROOT-LOCKED vs movable split + the
  `js/quotecore.js`/`js/money-math.js`/`js/money-format.js` shared-module ripple map). **Read `pipeline/FILLS-PIPELINE.md`
  §5.1 before touching the reconstruction, and the whole doc before either script path.** History of
  the pipeline's evolution: `docs/LORE.md`.

## Trends tab structure
The per-item Trends view's decision-priority tier structure (plan card → "Why this trend?"
→ price history → timing/seasonality, and the regime-guard/backtest-gate lesson) is a
**header comment at the top of `js/trends.js`** — read it before editing `runTrends`, since
that's where every editor of the view already is. (Moved out of CLAUDE.md by chunk K3.)

## Where shipped work is documented (check before assuming something is new)
Shipped changes + the "why" live in **`CHANGELOG.md`** + `git log`; the file/artifact registry is
**`README.md`**; the general-rules architecture + load-bearing invariants (🔒 enforced-by-a-guard vs
⚖️ judgment) are **`docs/ARCHITECTURE.md`**; the end-to-end **flow/entity walkthrough** (how a
price/trade/suggestion/verdict moves through the system) is **`docs/FLOW.md`**; the **market-read
doctrine** (the output table, gates, validators, rank/grade, pricing, timing, per-script facts) is
**`docs/MARKET-ANALYSIS.md`**; the plain-English
term lookup (core concepts + the codename dictionary — `flip-niche`/`held-item strategy`/`Bar E`/`DL4`…) is
**`docs/GLOSSARY.md`**; narrative/history + superseded-approach stories are
**`docs/LORE.md`**; each
load-bearing "don’t-rebuild" invariant lives in the header of the module/test that governs it (e.g.
the Gate-2-`CUT`-exempt rule in `pipeline/lib/watchstate.mjs`, the daemon’s zero-git rule in
`pipeline/commands/watch-log.mjs`, the probe empty-passthrough contract in `pipeline/lib/probes.mjs`).
Skill-prose disposition (what's encoded vs judgment) is **`docs/SKILL-TRIAGE.md`**, enforced by
`pipeline/ci/lint-skills.mjs` in CI. Before building something that feels new, check `git log` +
`CHANGELOG.md` — much of it already exists; don’t work from a stale assumption that a capability is
missing.

## Market judgment layer — lives in the project skills (moved by PLAN-5)
The screen/positions judgment layer (500k gp/d floor, 24h-drift-is-a-pre-filter-only,
two-sided liquidity / ghost-spread discipline, tax-dominates-thin-flips, band-is-the-edge
pricing, band-top artifacts, fresh-repricer flag, overnight/morning posture) lives in the
committed project skills `/scan`, `/positions`, `/overnight`, `/morning`
(`.claude/skills/*/SKILL.md`) — *moved* there, not copied, so it loads only when the
workflow runs. The ask→command table below still routes bare asks.

## Market analysis workflow — standard output format
Every market read presented to Ben (screen, per-item quote, position review) is ONE table — the
**table v2** column set: `Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime`. Quick =
transact-now edges, Optimistic = patient 2h-band edges (Bar-E robustified); the CONSOLE default
swaps Quick+Optimistic for the estimator pair `Est. buy`/`Est. sell` + `Net/u`/`BE` (`--raw`
restores them). Break-even is the tax-capped `breakEven()` in `js/quotecore.js` — the ONE definition.

**The full doctrine lives in `docs/MARKET-ANALYSIS.md`** (read in build order: output → tax → find →
price → time → scripts): what each column means + the corrected-volume Vol/d, the gate stack
(two-sided liquidity · Bar D traded-band · Bar E band-edge · 500k attention floor), the per-strategy
falling rule, the P2/P3 validator registry (gate vs inform), rank/grade (`net × P(fill) ÷ TTF`),
WINDOW-CLEAR pricing (`read-window-range.mjs --exit`), the diurnal + forecast timing reads, and the
per-script behavior facts. Each rule points to the module header that owns its full spec.

**How to generate these tables — each canonical ask maps to a skill or an exact command.
These scripts exist and ARE the workflow.** ALWAYS use them; NEVER hand-write a `node -e`
fetch for a market read (each ad-hoc script also burns ~1–2k tokens to author + parse — the
scripts exist specifically to kill that cost). All the scripts import `js/quotecore.js`, so
the numbers are byte-identical to the app's tables.

**Plain-language → command (match Ben's ask to ONE of these and run it immediately — don't
deliberate):**

| When Ben says something like… | Run |
| --- | --- |
| "how's **`<item>`**?", "quote **X**", "what's **X** doing?", "check **X** [and **Y**]" | `node pipeline/commands/quote-items.mjs "<item or id>" [...more]` |
| "how's **X trending**?", "**today's high/low vs prior days**", "where's **X** likely **tomorrow**?", "**trajectory** of X" | `node pipeline/commands/read-trajectory.mjs "<item or id>" [...]` (R1 — per-day low/high table + floor/ceiling slope classification + forward-projected next-day low/high band; inform-only, n≈0) |
| "find me flips", "any **opportunities**?", "what should I **buy**?", "**screen** the market", "anything in **`<flip-niche>`**?", "**scan**" | **`/scan` skill** — runs `node pipeline/commands/screen-flip-niches.mjs [--mode band\|churn\|scalp\|value\|invest\|amplitude\|all]` + the judgment pass. **THE SWAP (PLAN-AMPLITUDE-SCAN §3):** `--mode all` = **band + churn + amplitude** (the 24h-cycle big-ticket lane; console-only, provisional n≈0); **`value` is OUT of `--mode all`** (relabelled **Invest**, runnable via `--mode value`/`--mode invest`). scalp still explicit-only; spread/rising DELETED. In `--mode all` it also **auto-nominates dip candidates** into `dip-watchlist.json` (DL4; the "B feeds A" discovery half of the dip loop — relay the Dip pool line) |
| "how are my **positions**?", "check the market against **what I hold**", "am I **underwater**?", "should I **cut/hold** anything?", "review my **holds**" | **`/positions` skill** — runs `node pipeline/commands/quote-items.mjs --positions` + verdict interpretation → action plan |
| "set up for **overnight**", "what should I leave running overnight", "**going to bed**" | **`/overnight` skill** — two-phase: `/positions` → pause for stated capital → `/scan` + accumulation sizing |
| "what happened **overnight**?", "**morning** review", "what **filled**?", "catch me up" | **`/morning` skill** — positions.json/fills.json + `monitor-offers.mjs` + re-verdict stale bids |
| "watch/**monitor** my positions", "run a flipping **session**", "poll/keep an eye on **X**" | `node pipeline/commands/watch-positions.mjs ["<target>" …]`  (drive with `/loop`, see `pipeline/MONITORING.md`) |
| "**loop** positions AND scan", "monitor **and** discover", "check positions every X **and** scan every Y" | `node pipeline/commands/run-loop.mjs [--watch <min>] [--scan <min>] [--min-idle <gp>] [--no-sync]` (multi-action `/loop` driver — time-gated multiplexer runs `watch-positions.mjs` + `screen-flip-niches.mjs --mode all` on independent cadences from ONE loop; scan gated on DEPLOYABLE capital ≥ `--min-idle` (`derive-cash-tiers.mjs` `deployablePool` = free cash + reclaimable DEEP-bid escrow — the three-tier `availableCash ≤ deployablePool ≤ liquidCapital` model; the gate does a small live fetch of just the resting-bid ids to classify each bid deep-vs-committed, degrading to `availableCash` if that fetch fails). **A local book-refresh rides with the watch pass by default** — `sync-fills.mjs --local` (now the default behavior, kept as an explicit synonym) rebuilds fills/positions/offers.json from the exchange logs (ZERO git, no push) so positions always reads a fresh book; the loop never pushes to `main` — publishing is the once-a-day `/overnight` `sync-fills.mjs --publish`; `--no-sync` opts out. Drive with `/loop <gcd>m node pipeline/commands/run-loop.mjs --watch 30 --scan 15`) |
| "watch for **dips/flushes**", "run the **dip loop**", "catch a **liquid flush**" | `node pipeline/commands/watch-positions.mjs --dip ["<target>" …]` (DL2 — folds `dip-watchlist.json`; fires a reactive FLUSH bid-into-the-fall alert on a LIQUID dumping item; 5m cadence floor) |
| "can I **buy more** X?", "how much **buy limit** left [on X]?", "have I hit my **limit**?", "when does X's limit **reset**?" | `node pipeline/commands/read-buy-limits.mjs "<item or id>" [...]` (no args → every item bought in the last 4h) |
| "what's my **book** look like?", "what's **deployed vs idle**?", "how many **slots free**?", "**capital dashboard**", "how much **X can I buy** right now?" | **`/book` skill** — runs `node pipeline/commands/read-book.mjs` (GE slots + working/parked/idle capital split + grouped per-lot P&L board); add `--size "<item>" [--capital <gp>]` for the tranche sizer (min of buy-limit × clearability × capital + the binding bound + net-if-cycled). Inform-only; live marks age-labelled, free-slot count a log-derived lower bound |
| "**analyze** our track record", "**what should we tune?**", "did we **log everything**?", "run a **retro**", "how are our **suggestions** doing?" | **`/analyze` skill** — runs `node pipeline/commands/analyze-record.mjs` (read-only dataset audit + per-flip-niche retro rollup + n-gated tuning candidates; `--json` for the brief) then interprets it into a retro + F1-routed improvement proposals + a project-guidelines checklist over the session's edits |


## Open followups (not yet built)
- **The master plan: `PLAN.md`** (single plan file since 2026-07-04) — the plan + the
  scoreboard. Waves 1–4 have **all shipped** (T1/T2, O1, K1–K3, S1–S3, Q1, E1, L1, G1, M1, N1,
  and the Wave-4 cleanup D1/R1/P1/X1/X2/A1–A3/BE1/W1/CI1) — see PLAN.md's Status table for the
  per-chunk shas. **The active program is the Pipeline-v2 wave (D0→P8)** — snapshot+SQLite
  archive, context chain, validators on every surface, path engine (verdict = item × thesis),
  declarative strategy specs — specs in PLAN.md "Pipeline v2"; note the **falling-exclusion
  doctrine is AMENDED** (per-strategy, not global — encoded at P5). Also open: **F1** (GATED on
  O1's sample thresholds) plus PLAN.md's **Discovered** list. Planning process: `docs/PLANNING.md`. `main` is protected by a PR+`checks` ruleset (G1, 2026-07-04); no merge queue on this
  user-owned repo and PR creation is token-blocked for now, so chunks land via attended
  direct-push under the admin bypass (parallel lanes still use worktree subagents,
  hand-serialized) until `gh auth refresh` enables the PR path. The historical plan docs
  (`PLAN-2/3/4/5.md`, and the folded `PLAN-LOCAL-WATCH.md`/`PLAN-LOG-HARDENING.md`) are
  **deleted** — full text via `git show <sha>:PLAN-4.md` (etc.). A per-topic `PLAN-*.md` is
  folded into `PLAN.md` and deleted the moment its last chunk ships — don't leave shipped plan
  files at the repo root.
- **Per-item "recommend price adjustment" button** on the Trends page: pull fresh GE
  state + item info on demand and recommend a price tweak (ties into patient pricing
  and eventually the fills pipeline's realized-vs-suggested calibration; tracked in
  PLAN.md's unscheduled notes).
- ~~**Ledger redesign — grouped, watchlist-filtered, period P&L**~~ — **BUILT** (watchlist
  filter, per-item grouping + drill-in, period P&L bucketed by SELL date — `renderLedger` /
  `periodKey` in `js/ledger.js`, A3 — were `js/ui.js`). The local-timezone day-boundary verification lives in PLAN.md
  chunk E1. **Ledger UX rework** (0.45.0, LU1) refined the surface: the grouped-row item name is now a
  Trends link (`linkname`→`openTrends`) and multi-lot expansion moved to an explicit `.expbtn` chevron
  (the old whole-row `data-grp` click is gone); the P&L period control (`#ledgerPeriod`) moved from the
  top bar onto the "Closed flips" label; clicking a `#periodStrip` bucket filters the closed table to that
  bucket's sell date (`STATE.ledgerBucket`, session-only — active bucket shows an `×`, "All" pill or
  re-click clears, changing granularity clears); the manual-entry form is a collapsed-by-default
  `<details id="ledgerFormD">` (persisted `ledgerFormOpen`); and the closed-flips columns sort via TB1's
  `makeSortable` on group aggregates (default `last`-close desc = unchanged order).

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
   The once-a-day `sync-fills.mjs --publish` (run at `/overnight`) pushes `fills.json`/`positions.json`/`suggestions.jsonl`
   direct to `main` (pipeline-owned; clobber-guard reconciles) — a bare `sync-fills.mjs` is local/zero-git and pushes nothing. No unattended writer
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
   `momVerdict` reconciliation is the anchor (story in `docs/LORE.md`). If a plain-language ask should map to a specific
   script/flow, make that mapping explicit in the relevant CLAUDE.md section so a future agent
   runs the right thing immediately.
   **The file inventory is part of this pass (Ben, 2026-07-06):** `README.md`'s repo
   inventory + "Map of the repo" is the file registry. Every NEW file — source, doc, data
   artifact, even a gitignored one — gets an entry there at creation: its purpose, what it
   contains, and who produces/consumes it. Every change that alters a file's purpose or
   contract updates its entry in the same commit. A file with no inventory entry is
   undocumented by definition — don't leave one behind.
9. **Post-wave cleanup.** When a wave's chunks are all shipped: `git branch -D` the
   squash-landed lane branches — they read as "unmerged" to git (squash rewrites history), so
   verify each landed against **PLAN.md's Status table**, NOT `git branch --merged`. A
   CONFIRMED-stale branch (tip is an ancestor of `origin/main`, or squash-landed per PLAN.md's
   Status table) may be deleted without asking, local or remote (Ben, 2026-07-08); if staleness
   can't be confirmed, still ask before `git push origin --delete …`. Check `git status` for
   orphan untracked artifacts a chunk left behind. Multi-lane dispatch mechanics are `/ship` §7.

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
- **The once-a-day `sync-fills.mjs --publish` (at `/overnight`) pushes go direct to `main`** riding the
  admin bypass (pipeline-owned artifacts; clobber-guard reconciles). A bare `sync-fills.mjs` is
  local/zero-git (the default in-session book read) and pushes nothing. No unattended writer / machine
  bypass identity exists — the schedule was eliminated (`pipeline/FILLS-PIPELINE.md` §12).
- **CI: `.github/workflows/checks.yml`** — a cheap `checks` job (JS syntax sweep, quotecore
  + reconstruct acceptance fixtures, **`check-imports.mjs`** — the import-RESOLUTION guard that statically
  verifies every pipeline entrypoint's imports resolve against module exports (catches a missing-export that
  `node --check`'s syntax-only pass lets through), `fills.json`/`positions.json` parse, `lint-skills.mjs`, and
  `lint-docs.mjs` — DL1's structural doc-drift lint: a denylist of superseded terms/commands +
  a single-source duplicate-phrase check on the CLAUDE.md ⇆ README axis; **must stay a denylist +
  structural checker, never a semantic/LLM one**) plus a separate
  **`smoke` job** (CI1) that loads `index.html` in headless Playwright chromium with all
  external network stubbed and fails on any page error / app console error / empty pane —
  the "syntax passed but the app broke" class the process rules warn about (`pipeline/ci/smoke-test.mjs`).
  Both run on push, PR, and `merge_group`; the cheap job is split out so it fails fast. Agents
  may add/improve workflows within the constraints in `/ship` §4 (public logs, no `~/.runelite`,
  seconds-fast, no secrets).

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
both `fillsLogLine` (`js/fillslog.js`) and `pipeline/commands/add-manual-fill.mjs`, so rendering them
raw (e.g. the synced-line list in `editManualLog`, `js/ledger.js` — A3, was `js/ui.js`) is already local. Verified by
the E1 audit (2026-07-04) with a near-midnight `periodKey` fixture — a local 23:55 dip buckets
to that day, not the UTC-rolled next day. When adding a rendered timestamp, use the local
getters; only reach for UTC when writing something that leaves the app.

## Environment notes (Windows machine)
The Windows-machine environment notes (RuneLite `profiles2` flush-on-restart, the Exchange
Logger field mapping, cancel semantics, the manual-fill `--time` timestamp rule + `REMOVE`
tombstones, the on-demand sync cadence — the `CofferFillsSync` schedule was eliminated,
§12) are consolidated in **`pipeline/FILLS-PIPELINE.md` §10** (single home). Read that before touching the pipeline
or a source log. (Moved out of CLAUDE.md by chunk K3.)
