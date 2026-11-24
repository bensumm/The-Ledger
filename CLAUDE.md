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
  read of `positions.json`). **The book is not published by default** — `sync-fills.mjs --publish` (the only path that
  fetches phone trades, commits and pushes) runs only when Ben asks. The record is protected by the private
  `backup-data.mjs`, which the sync runs itself when due (`pipeline/lib/config/chores.mjs`). `positions.json` is the FIFO-reconstructed view (`collapseOffers` +
  `matchTrades`): `closed` after-tax realised P/L, `open` inventory at real avg cost, `unmatched`
  pre-log sells, `awaitingRebuy` a **keep** sold and not yet rebought (SM1 — matching is SYMMETRIC:
  sell→buy closes a `keepRoundTrip` just as buy→sell closes a flip; `beRebuy` is the break-even on
  the capital reallocation). **`fills.json` and the derived artifacts are ROOT-LOCKED** (app fetches them
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
the Gate-2-`CUT`-exempt rule in `pipeline/lib/thesis/watchstate.mjs`, the daemon’s zero-git rule in
`pipeline/commands/watch-log.mjs`, the probe empty-passthrough contract in `pipeline/lib/market/probes.mjs`).
Skill-prose disposition (what's encoded vs judgment) is **`docs/SKILL-TRIAGE.md`**, enforced by
`pipeline/ci/lint-skills.mjs` in CI. Before building something that feels new, check `git log` +
`CHANGELOG.md` — much of it already exists; don’t work from a stale assumption that a capability is
missing.

## Market judgment layer — lives in the project skills (moved by PLAN-5)
The screen/positions judgment layer (250k gp/d floor, 24h-drift-is-a-pre-filter-only,
two-sided liquidity / ghost-spread discipline, tax-dominates-thin-flips, band-is-the-edge
pricing, band-top artifacts, fresh-repricer flag, dwell-horizon pricing — fill-now vs
rest-day, `/scan` §2 — and overnight/morning posture) lives in the
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
(two-sided liquidity · Bar D traded-band · Bar E band-edge · 250k attention floor), the per-strategy
falling rule, the P2/P3 validator registry (gate vs inform), rank/grade (`net × P(fill) ÷ TTF`),
WINDOW-CLEAR pricing (`read-window-range.mjs --exit`), the diurnal + forecast timing reads, and the
per-script behavior facts. Each rule points to the module header that owns its full spec.

**How to generate these tables — each canonical ask maps to a skill or an exact command.
These scripts exist and ARE the workflow.** ALWAYS use them; NEVER hand-write a `node -e`
fetch for a market read (each ad-hoc script also burns ~1–2k tokens to author + parse — the
scripts exist specifically to kill that cost). All the scripts import `js/quotecore.js`, so
the numbers are byte-identical to the app's tables.

**Plain-language → command: run the match at once, don't deliberate.** Two steps:
1. **A skill first.** `/scan`, `/positions`, `/overnight`, `/morning`, `/book`, `/schedule`, `/analyze` and `/cleanup`
   list their trigger phrases in their descriptions; a matching ask runs the skill, never its bare script.
2. **Otherwise this table**, generated from the `@ask` lines in `pipeline/commands/` by `build-registry.mjs --write`
   (edit the tag, never the table). What a command measures and its limits: its header and README entry. Read a
   caveat shown here before quoting the number.

<!-- registry:asks -->
| Ask | `node pipeline/commands/…` |
| --- | --- |
| "I bought/sold X on mobile", "log this trade" | `add-manual-fill.mjs --item "<item>" --type buy\|sell\|banked --qty N --price gp --time <YYYY-MM-DDTHH:MM local>` — a personal-use mention IS the instruction; --time is the real trade time (omitting it mis-pairs lots); then sync |
| "X is personal use" | `add-manual-fill.mjs --item "<item>" --type withdraw --qty N --time <YYYY-MM-DDTHH:MM, after the buy>` — a personal-use mention IS the instruction; --time is the real trade time (omitting it mis-pairs lots); then sync |
| "back up my data", "is the backup current?" | `backup-data.mjs [--status]` |
| "what's my idle cash?" | `derive-cash.mjs` — an amount overwrites the anchor; a session budget goes to --capital instead |
| "re-anchor my cash to X" | `derive-cash.mjs 16m` — an amount overwrites the anchor; a session budget goes to --capital instead |
| "is the patient pair real?", "does the deep bid fill?" | `join-asym-outcomes.mjs [--entry H] [--horizon H] [--item "<item>"]` — the pair rarely completes, worst on big-ticket; a random-offset null was rejected (header) |
| "did buying the dump work?", "score the crash-entry rules" | `join-crash-entry.mjs [--items N]` — read its verdict line and plans/PLAN-CRASH-REPLAY.md first; every fill is an upper bound |
| "does askStar beat what we have?", "which exit ask makes the most gp?" | `join-exit-ev.mjs [--items N] [--horizon H]` — the null branch fired: the reach surface only describes; retire nothing on a gap under the instrument's noise |
| "does the fade alert measure anything?", "score hours-under-profile" | `join-fade-outcomes.mjs [--items N] [--cost-ratio r] [--item "<item>"]` — wins only at miss-cost ratio 3, loses at 2 and under, weakest on big-ticket |
| "rebuild outcomes", "fill-time distributions" | `join-outcomes.mjs [--report]` — several minutes, networked |
| "which reach basis is right?", "is the sell-unreliable tag any good?" | `join-reach-basis.mjs [--horizon H] [--item "<item>"]` — settled for neither basis; quote the cost-regime map and r*, never the accuracy number |
| "which exit estimator is best?", "is pressure any good?", "score the reachability head-to-head" | `join-reach-outcomes.mjs --horizon H [--item "<item>"]` — describes, never ranks: use the MATCHED tables, name the horizon, retire nothing on it |
| "how's X?", "quote X", "what's X doing?", "check X and Y" | `quote-items.mjs "<item>" [...]` |
| "show my open lots", "last closed flips", "what did I do with X?", "lots of X" | `read-book.mjs --lots [N] [--item "<item or id>"]` — offline after the local sync: lots only, no live fetch; times are local |
| "can I buy more X?", "how much limit left?", "when does it reset?" | `read-buy-limits.mjs ["<item>" ...]` |
| "what should I ask if I'll wait H?", "how long to clear at price P?", "the EV-max ask?" | `read-exit-surface.mjs "<item>" [--horizon 6,24,48] [--price gp]` — askStar LOST the backtest (join-exit-ev): description only, price nothing off it |
| "is X in the last scan?", "what grade was X?", "why isn't X in the scan?", "what got crowded out?" | `read-rows.mjs [screen\|quote\|watch] --item "<item>" [--mode band] [--cols a,b] [--limit N] [--drops] [--digest] [--list]` — reads the saved report only, never the market: check the printed age and re-run the read when it says STALE |
| "how's X trending?", "today vs prior days", "where's X likely tomorrow?" | `read-trajectory.mjs "<item>" [...]` — inform-only |
| "how's my watchlist?", "the items I track/follow" | `read-watchlist.mjs --verbose` — rows are gate-exempt and the grade is always (thin): read the net, not the letter |
| "is X a falling knife?", "stepping down by the hour?", "does the ask clear midday?" | `read-window-range.mjs "<item>" --hourly --days 3 [--ask gp]` — hourly: read the raw per-day columns (the drift slope was a non-signal, deleted) |
| "does this ask clear?", "price my exit" | `read-window-range.mjs "<item>" --ask <gp> --window peak` — hourly: read the raw per-day columns (the drift slope was a non-signal, deleted) |
| "reconcile my reverse-flip", "I sold a keep first", "backfill the banked basis" | `reconcile-reverse-flip.mjs ["<item>"]` |
| "loop positions AND scan", "check positions every X and scan every Y" | `run-loop.mjs [--watch min] [--scan min] [--min-idle gp] [--no-sync]` — the scan runs only when deployable capital clears --min-idle; /loop at the gcd of the two cadences |
| "what can I reverse-flip?", "sell a keep into the peak", "harvest a held item" | `screen-flip-niches.mjs --mode reverse` — reverse: the regime read is INVERTED (rising is bad), inform-only, owned keeps only |
| "sync", "refresh the book" (scan and positions already do it) | `sync-fills.mjs` — --publish pushes to main: only when Ben asks |
| "watch/monitor my positions", "run a flipping session", "keep an eye on X" (drive with /loop, pipeline/MONITORING.md) | `watch-positions.mjs ["<item>" ...]` |
| "watch for dips/flushes", "run the dip loop" | `watch-positions.mjs --dip ["<item>" ...]` |
<!-- /registry:asks -->

## Open followups
- **`docs/BACKLOG.md`** — every open item without a plan, plus the measured "do not rebuild" list. Read it before
  proposing work. **`plans/`** — the active plans only. **`PLAN.md`** — executor rules and shipped shas. Planning process: `docs/PLANNING.md`. A folded plan's text: `git show 1cfdda0:plans/<NAME>.md`.

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
   `sync-fills.mjs --publish` (on request only) pushes an explicit add-list direct to `main` — its one home is
   `pipeline/FILLS-PIPELINE.md` §13.3. A bare `sync-fills.mjs` pushes nothing; no unattended writer exists.
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed for git operations;
   don't suggest installing anything else for those. The GitHub CLI (`gh`) IS
   installed (2026-07-04); it is the API + **PR/merge-queue management** layer, not a git
   transport (git stays on SSH) — see the "GitHub CLI (`gh`), Actions CI, and shipping"
   section and the `/ship` skill.
8. **A documentation pass is part of every change — not optional, and not append-only.**
   Before calling a change done, update the docs the change touches: this `CLAUDE.md`
   (any workflow/section it affects), and any affected doc
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
   verify each landed against **the shas in PLAN.md**, NOT `git branch --merged`. A
   CONFIRMED-stale branch (tip is an ancestor of `origin/main`, or squash-landed per
   PLAN.md) may be deleted without asking, local or remote (Ben, 2026-07-08); if staleness
   can't be confirmed, still ask before `git push origin --delete …`. Check `git status` for
   orphan untracked artifacts a chunk left behind. Multi-lane dispatch mechanics are `/ship` §7.
10. **Adversarial review is the DEFAULT, not an escalation (Ben, 2026-08-09).** Any substantive
    change — a shipped chunk, a doc-reconciliation pass, a new estimator — gets a review pass by a
    SEPARATE agent before it's called done, briefed to find you wrong rather than to confirm you.
    This is measured, not a nicety: on 2026-08-09 eight review passes over one wave found — every one on
    CI-GREEN code — a self-contradicting doc pair inside files already declared consistent; a
    "regression check" that never called the function it guarded; a corrected constant left wrong at
    its own definition site; a closed negative-result plan advertised as live work; a tool-wide floor
    stale at 2× its value in eleven places (a twelfth turned up the pass after); a shipped default lane
    whose plan still said "not yet scheduled"; and a **runtime `ReferenceError`** on a big-ticket
    held-lot surface, whose `catch` disguised the crash as `window read unavailable` and silently
    deleted the price-to-sell-EARLY trigger. **Brief the reviewer to attack YOUR OWN last pass first**
    — rounds 2, 3, 5, 6, 7 and 8 each found the previous round's fixes had introduced or left a false claim,
    which is the single highest-yield instruction. And **scope at least one pass AWAY from the region
    you just worked**: the first three passes each re-audited the region the previous pass named and
    converged on their own tail; the pass that broke the pattern found three clusters every prior pass
    had missed, two of them outside the region under work.
    **Corollary — "covered by tests + import resolution" is not coverage.** The `ReferenceError` above
    was reported as verified on exactly that basis. `node --check` is syntax-only and `check-imports`
    only proves imported names *resolve*; neither sees a name that is USED but never imported, and no
    test executed the function. If a changed line has not actually RUN, say so plainly and go run it —
    forcing the gate (e.g. temporarily watchlisting a held lot) usually costs a minute.
    `pipeline/ci/check-imports.mjs` now also fails on unbound SCREAMING_SNAKE constants, closing that
    one class — but the class it cannot see is why the rule is to run the path.
    **When to STOP.** Keep going until a round returns nothing real; the empty round is the signal, not
    a round count, and a round that only re-confirms prior findings counts as empty. Cap at five and
    check in rather than continuing alone — the 2026-08-09 wave took eight, and six of those rounds
    found the PREVIOUS round's fixes had introduced or left a false claim.
11. **Name the refuting test before stating a cause; if it costs under a minute, run it.** Three
    times on 2026-08-09 a plausible mechanism was reported as an established finding and was wrong
    (a grain explanation for what was circularity; a caching bug against an uncached path; a TTL
    cited as the active mechanism when the cache is off by default). Each had a cheap discriminating
    check that was skipped. Being right for the wrong reason is worse than being wrong — nothing in
    the outcome flags it, and the wrong reason is what gets written down. When challenged on a
    number, answer from a DIFFERENT data source than the one that produced it (the daily-grain
    regime read said `ranging` while the hourly grid showed a two-hour-old breakdown).
12. **A review's output is a CANDIDATE LIST, not a work queue — triage by decision impact, and brief
    the reviewer to triage too.** Measured 2026-08-26: worked top-to-bottom, roughly ONE IN FIVE
    findings was load-bearing; a third were nitpicks costing more to fix than the error could cost,
    and several were the reviewer being wrong. Re-briefing the SAME running agents to report decision
    impact ("what goes wrong, for whom, when" — "nothing, cosmetic" being a fine answer), a remedy
    with **DELETE / LEAVE IT / ENCODE** as first-class options beside FIX, a cost note when the remedy
    exceeds the defect, and a SELF-TRIAGE of their own nitpicks raised the acted-on rate sharply in
    the very next round. Amend a running agent rather than re-triaging its output later — it still
    has the context to self-assess.
    **Demand reachability, not shape.** A fail-open shown with a synthetic fixture proves the SHAPE
    and says nothing about whether the input occurs. One was ranked "fix this first, a live
    behavioural defect" and measured ZERO across 4,041 real items; another's stated impact ("every
    value row reads thin") A/B'd to no rendered change at all. Require "measured on <path>, N of M"
    or "shape only — unmeasured", and rank latent below live.
    **Prose fixes regress; code fixes converge.** A prose correction is made of the same material as
    the thing corrected, so each one is a fresh batch of falsifiable claims — and a defensive banner
    is itself a new assertion that drifts. **Derived numbers (counts, timings, call-site tallies) do
    not belong in prose at all**: every one of them regressed, including a cell that stated a count
    directly above its own warning that the count had been wrong four rounds running. Delete the
    number or encode the check; do not re-derive it.

13. **Prevent, don't accumulate.** (a) A lesson becomes a test, script output, or nothing; prose only for
    real judgment, and doc ceilings (`pipeline/ci/doc-budget.json`) only come down — after trimming run
    `lint-budget.mjs --bless`. (b) Anything inform-only or unproven ships with a `pipeline/ci/provisional.json`
    entry: a decide-by date and a pass test. Past the date CI fails until it is promoted or deleted; a null
    result deletes the live feature in the same change. (c) Recurring upkeep goes in `chores.mjs`, never in a
    skill step. (d) Finish or delete a plan before opening one; target five open.

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
- **CI: `.github/workflows/checks.yml`** — a fast offline `checks` job (JS syntax, `run-tests.mjs`,
  `check-imports.mjs`, `check-dead-exports.mjs`, `check-daemon-safety.mjs`, `check-forecast-guards.mjs`,
  `check-verdict-guards.mjs`, `lint-arch.mjs`, `lint-skills.mjs`, `lint-docs.mjs`, `lint-comments.mjs`,
  `lint-budget.mjs`, `build-registry.mjs`, `lint-plan-refs.mjs`, `lint-guard-lists.mjs`, fills/positions parse) plus a `smoke` job (headless app
  load, `smoke-test.mjs`). Each guard's header owns its design and limits; read it before changing the guard.
  Guards are structural, never semantic/LLM. **Run `lint-plan-refs.mjs --refs <NAME>` BEFORE deleting any plan.**
  Workflow constraints: `/ship` §4.

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
