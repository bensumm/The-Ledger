# The Coffer / The-Ledger — instructions for Claude Code

This repo is worked in repeated sessions. Check `git log` and this file before assuming something is new.

**Live app: https://bensumm.github.io/The-Ledger/** (auto-deploys on push to `main`).

## What this is
- **The Coffer**: an OSRS Grand Exchange flipping tool. `index.html` is markup only, `styles.css` holds all
  styles, logic is ES modules under `js/`. **No build step, no framework, no bundler**: GitHub Pages serves the
  files as they sit on disk. Local testing needs `serve.cmd` (ES modules don't load over `file://`); README
  "Local development". How localhost differs from the deployed app: `docs/LORE.md`.
- **Fill-data pipeline** (`pipeline/`, design doc `pipeline/FILLS-PIPELINE.md`): `pipeline/commands/sync-fills.mjs`
  reads RuneLite's `.runelite/exchange-logger/*` and rebuilds `fills.json`, `positions.json` and `offers.json`.
  - **A bare run is local and zero-git**: no fetch, commit or push. No scheduled sync exists.
  - `screen-flip-niches.mjs`, `quote-items.mjs --positions`, `read-book.mjs` and `watch-positions.mjs` run it
    themselves. Run it by hand before any read that doesn't (a bare quote, `/morning`, a hand read of
    `positions.json`).
  - **Never run `sync-fills.mjs --publish` unless Ben asks.** It is the only path that fetches phone trades,
    commits and pushes. The sync runs the private `backup-data.mjs` itself when due
    (`pipeline/lib/config/chores.mjs`).
  - **Never edit RuneLite's `exchange.log`**; corrections go in the sibling `coffer-manual.log`
    (`add-manual-fill.mjs`). Only `sync-fills.mjs` writes `fills.json` / `positions.json`: fix the source, never
    the derived file.
  - `positions.json` is the FIFO reconstruction: `closed` (after-tax realised P/L), `open` (inventory at real
    average cost), `unmatched` (pre-log sells), `awaitingRebuy` (a keep sold and not yet rebought; matching is
    symmetric, `beRebuy` is its break-even). **Read `pipeline/FILLS-PIPELINE.md` §5.1 before touching the
    reconstruction, the whole doc before changing either script path, and §10 (RuneLite/Windows notes: logger
    fields, cancel semantics, the manual-fill `--time` rule, `REMOVE` tombstones) before touching the pipeline
    or a source log.**
  - `fills.json` and the derived artifacts are ROOT-LOCKED (the app fetches them same-origin). The locked vs
    movable split and the shared-module ripple map (`js/quotecore.js`, `js/money-math.js`,
    `js/money-format.js`): README "Map of the repo".

## Where shipped work is documented (check before assuming something is new)
Much of what feels new already exists: check `git log` and `CHANGELOG.md` before building.

| Need | Home |
| --- | --- |
| Shipped changes and why | `CHANGELOG.md`, `git log` |
| Every file and artifact (the ONE registry; never duplicate it here) | `README.md` "Files" + "Map of the repo" |
| Architecture; invariants marked guard-enforced or judgment | `docs/ARCHITECTURE.md` |
| How a price, trade, suggestion or verdict moves through the system | `docs/FLOW.md` |
| Market-read doctrine | `docs/MARKET-ANALYSIS.md` |
| Terms and codenames | `docs/GLOSSARY.md` |
| History and superseded approaches | `docs/LORE.md` |
| Which skill prose is encoded vs judgment (CI: `lint-skills.mjs`) | `docs/SKILL-TRIAGE.md` |
| Open work with no plan, and the measured "do not rebuild" list: read before proposing work | `docs/BACKLOG.md` |
| Active plans; planning process | `plans/`; `docs/PLANNING.md` |
| Executor rules and shipped shas | `PLAN.md` |

A folded plan's text: `git show 1cfdda0:plans/<NAME>.md`. A "don't rebuild" invariant lives in the header of
the module or test that governs it; read the header before editing the file. Read `js/trends.js`'s header
before editing `runTrends` (the Trends view's tier structure).

## Market analysis workflow — standard output format
Every market read shown to Ben (screen, quote, position review) is ONE table, the **table v2** columns:
`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime`. Quick = transact-now edges, Optimistic =
patient 2h-band edges. The console default swaps Quick + Optimistic for `Est. buy` / `Est. sell` + `Net/u` /
`BE` (`--raw` restores them). Break-even is the tax-capped `breakEven()` in `js/quotecore.js`, the ONE definition.

Column meanings, gates, validators, rank/grade, pricing and timing: `docs/MARKET-ANALYSIS.md`. The judgment
applied over a screen or a position review lives in the skills (`.claude/skills/*/SKILL.md`) and loads only
when the skill runs.

**The scripts ARE the workflow. ALWAYS use them; NEVER hand-write a `node -e` fetch for a market read.** They
import `js/quotecore.js`, so their numbers match the app's.

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
| "X is personal use" | `add-manual-fill.mjs --item "<item>" --type withdraw --qty N --time <YYYY-MM-DDTHH:MM, after the buy>` — caveat above |
| "back up my data", "is the backup current?" | `backup-data.mjs [--status]` |
| "what's my idle cash?" | `derive-cash.mjs` — an amount overwrites the anchor; a session budget goes to --capital instead |
| "re-anchor my cash to X" | `derive-cash.mjs 16m` — caveat above |
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
| "is X in the last scan?", "what grade was X?", "why isn't X in the scan?", "what got crowded out?" | `read-rows.mjs [screen\|quote\|watch] --item "<item>" [--mode M] [--drops] [--digest] [--list] [--notes]` — reads the saved report only, never the market: check the printed age and re-run the read when it says STALE |
| "how's X trending?", "today vs prior days", "where's X likely tomorrow?" | `read-trajectory.mjs "<item>" [...]` — inform-only |
| "how's my watchlist?", "the items I track/follow" | `read-watchlist.mjs --verbose` — rows are gate-exempt and the grade is always (thin): read the net, not the letter |
| "is X a falling knife?", "stepping down by the hour?", "does the ask clear midday?" | `read-window-range.mjs "<item>" --hourly --days 3 [--ask gp]` — hourly: read the raw per-day columns (the drift slope was a non-signal, deleted) |
| "does this ask clear?", "price my exit" | `read-window-range.mjs "<item>" --ask <gp> --window peak` — caveat above |
| "reconcile my reverse-flip", "I sold a keep first", "backfill the banked basis" | `reconcile-reverse-flip.mjs ["<item>"]` |
| "loop positions AND scan", "check positions every X and scan every Y" | `run-loop.mjs [--watch min] [--scan min] [--min-idle gp] [--no-sync]` — the scan runs only when deployable capital clears --min-idle; /loop at the gcd of the two cadences |
| "what can I reverse-flip?", "sell a keep into the peak", "harvest a held item" | `screen-flip-niches.mjs --mode reverse` — reverse: the regime read is INVERTED (rising is bad), inform-only, owned keeps only |
| "sync", "refresh the book" (scan and positions already do it) | `sync-fills.mjs` — --publish pushes to main: only when Ben asks |
| "verify X at bid/ask", "is this pick still good?", "re-check my picks" | `verify-pick.mjs "<item>@<bid>:<ask>[@<flip-niche>]" [...] [--why]` — run in the same turn as the rec; pitch only a PASS (no fill guarantee) |
| "verify the whole scan", "does anything clear?" | `verify-pick.mjs --scan [N] [--all]` — caveat above |
| "watch/monitor my positions", "run a flipping session", "keep an eye on X" (drive with /loop, pipeline/MONITORING.md) | `watch-positions.mjs ["<item>" ...]` |
| "watch for dips/flushes", "run the dip loop" | `watch-positions.mjs --dip ["<item>" ...]` |
<!-- /registry:asks -->

## Repo is public — no PII
Never commit account names, RSNs, real names, emails or other identifying info into tracked files (code,
comments, commit messages, `fills.json`, docs). The configured git author identity is expected metadata, not a
leak.

## Process rules
1. The repo's `index.html`, `styles.css` and `js/*.js` are canonical. Confirm the current version before
   editing; never work from a stale copy.
2. `node --check` every touched JS file. That is syntax only, so for any change under `js/`, `index.html` or
   `styles.css` (including a shared module edited for the pipeline) also run the app (`serve.cmd` + a real
   browser, or Playwright) before calling it done. Prefer exact-string-match patches
   that fail loudly.
3. Give Ben a prose explanation of what changed and why, not just a diff.
4. Be honest about statistical limits in calibration and analytics work. Never oversell a small sample.
5. Bump `APP_VERSION` (`js/state.js`) on every shipped change to the deployed app. A skills-only change bumps
   the SKILL.md `version:` instead, never `APP_VERSION`. A pipeline-only stdout tweak may ship without a bump;
   say so in the commit message.
6. **Landing on `main`.** A ruleset requires PR + `checks` and forbids force-push and deletion; repository
   admin bypasses it. PR creation is token-blocked (the fix, `gh auth refresh -s repo`, is Ben-only) and there
   is no merge queue. So today a change lands by **attended direct push under the admin bypass**:
   `git fetch && git rebase origin/main && git push`. Never force-push. Describe the change to Ben before
   landing it. The one publisher, `sync-fills.mjs --publish`, pushes an explicit add-list
   (`pipeline/FILLS-PIPELINE.md` §13.3); no unattended writer exists. Current state
   and the PR flow: `.claude/skills/ship/SKILL.md` §2 and §6 ("`/ship`" here means that file, not the built-in).
7. Git is the CLI over SSH; suggest no other git tool. `gh` (installed) is the API and PR layer, not a git transport.
   **Never run `gh auth setup-git`** (`/ship` §5).
8. **Every change includes a documentation pass, and it is a reconciliation, not an append.** Grep the docs
   for statements the change supersedes or contradicts and fix them in place; never add a section and leave
   one that says the opposite. Update every affected doc, including this file, `README.md`,
   `pipeline/MONITORING.md`, `pipeline/FILLS-PIPELINE.md` and the skills. A new plain-language ask gets an explicit mapping
   (the command's `@ask` tag, or a skill trigger) so the next agent runs the right thing at once.
   **README is the file registry.** Every new file (source, doc, data artifact, even a gitignored one) gets
   an entry at creation: purpose, contents, who produces and consumes it. A change to a file's purpose or
   contract updates its entry in the same commit.
9. **Post-wave cleanup.** `git branch -D` the squash-landed lane branches. Git reads them as unmerged, so
   verify each against the shas in `PLAN.md`, NOT `git branch --merged`. A confirmed-stale branch (tip is an
   ancestor of `origin/main`, or squash-landed per `PLAN.md`) may be deleted without asking, local or remote;
   if staleness is unconfirmed, ask before `git push origin --delete`. Check `git status` for orphan untracked
   artifacts. Multi-lane dispatch: `/ship` §7.
10. **Adversarial review is the default, not an escalation.** Before any substantive change (a shipped chunk,
    a doc-reconciliation pass, a new estimator) is called done, a SEPARATE agent reviews it, briefed to find
    you wrong, not to confirm you. Green CI is not a review.
    - **Brief the reviewer to attack YOUR OWN last pass first.** Fixes from one round are where the next
      round's false claims come from.
    - **Scope at least one pass AWAY from the region you just worked.**
    - **A changed line must actually RUN.** "Covered by tests + import resolution" is not coverage:
      `node --check` is syntax only. `check-imports.mjs` proves *imported* names resolve and SCREAMING_SNAKE
      constants are bound; it cannot see any other name used but never imported, and runs nothing. A `catch` can report a crash as missing data. If a
      changed line has not run, say so and run it, forcing the gate if needed (e.g. temporarily watchlisting
      a held lot).
    - **Stop at an empty round.** A round that returns nothing real, or only re-confirms earlier findings, is
      the signal. Cap at five rounds, then check in instead of continuing alone.
11. **Name the refuting test before stating a cause; if it costs under a minute, run it.** A plausible
    mechanism is not a finding. Right for the wrong reason is worse than wrong: nothing flags it, and the
    wrong reason is what gets written down. When challenged on a number, answer from a DIFFERENT data source
    than the one that produced it.
12. **A review's output is a candidate list, not a work queue. Triage by decision impact, and brief the
    reviewer to triage too.** Many findings are nitpicks and some are wrong: verify before acting.
    - Ask each reviewer for: the decision impact ("what goes wrong, for whom, when"; "nothing, cosmetic" is
      a fine answer); a remedy with **DELETE / LEAVE IT / ENCODE** as first-class options beside FIX; a
      cost note when the remedy exceeds the defect; a self-triage of its own nitpicks. Amend a running agent
      instead of re-triaging its output later.
    - **Demand reachability, not shape.** A synthetic fixture proves a failure's shape, not that the input
      occurs. Require "measured on <path>, N of M" or "shape only — unmeasured", and rank latent below live.
    - **Prose fixes regress; code fixes converge.** A prose correction is a fresh set of claims that can
      drift. **Derived numbers (counts, timings, call-site tallies) never go in
      prose**: delete the number or encode the check; do not re-derive it.
13. **Prevent, don't accumulate.** (a) A lesson becomes a test, script output, or nothing; prose only for
    real judgment, and doc ceilings (`pipeline/ci/doc-budget.json`) only come down — after trimming run
    `lint-budget.mjs --bless`. (b) Anything inform-only or unproven ships with a `pipeline/ci/provisional.json`
    entry: a decide-by date and a pass test. Past the date CI fails until it is promoted or deleted; a null
    result deletes the live feature in the same change. (c) Recurring upkeep goes in `chores.mjs`, never in a
    skill step. (d) Finish or delete a plan before opening one; target five open.

## CI
`.github/workflows/checks.yml` runs a fast offline `checks` job (JS syntax, `run-tests.mjs`,
`check-imports.mjs`, `check-dead-exports.mjs`, `check-daemon-safety.mjs`, `check-forecast-guards.mjs`,
`check-verdict-guards.mjs`, `lint-arch.mjs`, `lint-skills.mjs`, `lint-docs.mjs`, `lint-comments.mjs`,
`lint-budget.mjs`, `build-registry.mjs`, `lint-plan-refs.mjs`, `lint-guard-lists.mjs`, fills/positions parse)
and a `smoke` job (headless app load, `smoke-test.mjs`). Guards are structural, never semantic/LLM. Each
guard's header owns its design and limits; read it before changing the guard. **Run
`lint-plan-refs.mjs --refs <NAME>` BEFORE deleting any plan.** Workflow constraints: `/ship` §4.

## The `STATE` object (`js/state.js`)
App-wide mutable state lives as properties on the one exported `STATE` object: a module cannot reassign an
imported `let` binding. Put new shared mutable state on `STATE`, never a new bare `export let`;
never-reassigned constants stay `export const`. Full rule: the header of `js/state.js`.

## Time display convention — displayed times are LOCAL
Every timestamp the app renders uses the local-time `Date` getters (`getHours`, `getDate`, `getDay`,
`getMonth`, `toLocaleTimeString`), never `getUTC*` or `toISOString`. UTC/ISO is storage and wire format only
(epoch-second `ts` fields, backup metadata, the backup filename). Manual-log `date`/`time` strings are
already local wall-clock (written by `fillsLogLine` and `add-manual-fill.mjs`), so render them raw.
