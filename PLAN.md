# PLAN — The Coffer master plan (single plan file, 2026-07-04)

This is the **only** plan file. The prior docs — `PLAN-2.md`, `PLAN-3.md`, `PLAN-4.md`,
`PLAN-5.md` — are deleted; their full text (rationale, findings, long-form specs) lives in
git history: `git show 39e5d23:PLAN-4.md` (same sha serves all four). Every chunk below is
self-sufficient for an executor; the git-show pointers are backstory, not required reading.
When a chunk ships, mark it ✅ in the Status table **in this file** with the commit sha —
single-file discipline: this doc is both the plan and the scoreboard.

**Shipped-chunk detail lives in the commits, not here (Ben, 2026-07-09).** A ✅ Status row is
just the sha (+ APP_VERSION where one shipped): the full "what/why/don't-rebuild" story is the
landing commit's message (`git show <sha>`) and `CHANGELOG.md`; load-bearing invariants live in
the headers of the modules/tests that govern them (CLAUDE.md "Where shipped work is
documented"). The last PLAN.md revision carrying the long per-row summaries is
`git show 4753e44:PLAN.md`. Only still-open work keeps its detailed spec here.

## Executor rules (apply to every chunk, verbatim)

- Each chunk ends with: `node --check` every touched `js/*.js` / `pipeline/*.mjs`; run
  `node pipeline/ci/run-tests.mjs` (the auto-discovery runner — runs every `pipeline/**/*.test.mjs`)
  if any tested module was touched; a real browser or Playwright
  smoke test for any app-facing change (ES modules don't load over `file://` — use
  `serve.cmd`); `APP_VERSION` bump in `js/state.js` if app behavior changed (skills-only
  changes do NOT bump it — SKILL.md `version:` frontmatter instead); a descriptive commit,
  then land it (G1, 2026-07-04: `main` is protected by a PR+`checks` ruleset, but there's no
  merge queue on this user-owned repo and PR creation is token-blocked for now, so the
  practical path is **attended direct-push under the admin bypass** — `git fetch && rebase
  origin/main && push`; the `gh pr create`→`gh pr merge` flow is the intent once `gh auth
  refresh` lands — see `/ship` §2/§6) — and if the change touches the deployed app, watch the
  `pages-build-deployment` run to `completed success` (`gh run list -L 1`). Prefer
  exact-string edits that fail loudly.
- Repo is public — no PII in any tracked file or commit message.
- NEVER edit RuneLite's own `exchange.log`; the writable source is the sibling
  `coffer-manual.log`.
- `positions.json` / `fills.json` are pipeline outputs — only `sync-fills.mjs` writes them.
- `git add` only the files you changed. (There is no longer a scheduler auto-committing
  positions/fills — sync is on-demand since G1; but an attended sync push or another lane's
  merge can still move `main`, so rebase your branch on `origin/main` if it drifts.)
- Discover unrelated debt → append to "Discovered" at the bottom; don't fix drive-by.
- **Spec style:** write the rule + one cheap named anchor (e.g. "the bludgeon-exit lesson").
  Do NOT paste live data (prices, multi-item verification lists) — it rots and misleads.
- A reconciling documentation pass is part of every chunk (CLAUDE.md process rule 8):
  grep for statements the change supersedes and fix them in place — move, never copy.

## Dispatch model — coordinator + Opus subagents

- Ben's main session is the **coordinator**. It hands one chunk ID per **Opus subagent**
  (Agent tool). Subagent brief template: *"Read CLAUDE.md fully, then PLAN.md's Executor
  rules and chunk `<ID>`. Execute the chunk, validate per the rules, commit."*
- **Landing (G1, 2026-07-04):** `main` is protected by a PR+`checks` ruleset with a
  repository-admin **always** bypass. Because there's **no merge queue** (user-owned repo —
  unavailable) and **PR creation is currently token-blocked** (`createPullRequest` →
  `FORBIDDEN`, needs `gh auth refresh -s repo`), chunks land today by **attended direct-push
  under the admin bypass**; the coordinator still **hand-rebases each finished lane onto
  `main`** and pushes (parallel lanes use worktree isolation, `isolation: "worktree"`).
  Never force-push `main`. The PR-per-lane flow (which would let the queue serialize lanes)
  is the intent once the token is refreshed *and* the repo has a queue — see `/ship` §2/§6.
- **Parallel-safety rule:** chunks may run concurrently only when their primary-file sets
  are disjoint (listed per chunk). Same-file-different-region overlaps are acceptable
  (git merges them); same-function overlaps are not — sequence those.
- After each wave the coordinator: runs the test file + a browser smoke pass if the app
  changed, updates the Status table here, pushes.
- **Wave-start consistency scan (Wave 2 onward — Ben, 2026-07-04):** when kicking off each
  wave after the first, the coordinator also spawns a **Sonnet** subagent to sweep the
  repo's docs (`CLAUDE.md`, `PLAN.md`, `README.md`, `pipeline/*.md`,
  `.claude/skills/*/SKILL.md`) for drift the prior wave left behind — statements a shipped
  chunk superseded, stale column sets/verdict lists, chunk specs contradicted by what
  actually landed. Findings are wrapped into followup notes appended to that wave's chunk
  briefs (doc fixes ride with the owning chunk's reconciliation pass); findings that
  belong to no active chunk go to the Discovered list.

## Order of operations

Waves 1–7 have all shipped (see Status), and **PM1** (probe-module system) + **TG1**
(thesis-gated hold alerts) shipped 2026-07-08 (Fable lanes; shas in Status — specs pruned per
the fold-out discipline, recoverable via `git show a46e69a:PLAN.md`), followed the same day by
**PM2** (probe firing logs), **SR1** (suggestions rotation) and **GA1** (`.gitattributes`) —
shas in Status. **The Pipeline-v2 wave (D0→P8, folded from the 2026-07-08 planning round with
Ben) is now the active program** — specs below under "Pipeline v2 — open chunk specs"; F1 stays
gated on O1 thresholds (P6's evidence work feeds it). Everything else lives in the Discovered /
Needs-a-Ben-decision lists. The planning process itself is documented in `docs/PLANNING.md`.

| Wave | What (all ✅ — detail via `git show <sha>:PLAN.md`) |
| --- | --- |
| **1** | T1→T2 (tables + Trends) ∥ O1 (outcomes dataset) ∥ K1→K2→K3 (self-improving skills + memory dedupe + CLAUDE.md slimming) |
| **2** | S1→S2→S3 (screening economics → overnight posture → watchlist section) ∥ Q1 (Gate-0 reliability fix) ∥ E1 (local-time audit) |
| **3** | L1 (action logging) → G1 (PR flow + ruleset) → M1 (mobile parity) → N1 (push notifications) |
| **4** | Repo-review cleanup: D1 (doc reconciliation) ∥ R1→P1 (reconstruct harness → snapshot dedupe) ∥ X2→X1 (dead-scheduler excision → pipeline dedup) ∥ A1→A2→A3 (app dead-code → fetch unification → ledger split) ∥ BE1 (break-even tax-cap fix). W1 (analysis cadence) + CI1 (browser smoke in CI) independent. |
| **5** | UX round: TB1→LU1→FX1 (sortable table → Ledger UX → Finder/Signals fixes) ∥ NY1→NY2 (scan niche-yield audit → ruling) ∥ SY1 (sync-fills doctrine). |
| **6** | Business-logic tests + org: OR1 (org map docs) → OR2 (pipeline/lib/ split) → TD1 (money tests) → TD2 (extractions + tests) → TD3 (nice-to-have sweep). |
| **LW/LH** | LW1→LW2→LW3 (local log-watcher) ∥ LH1→LH2→LH3 (exchange-log hardening) — folded from standalone plan files, both shipped. |
| **7** | TC1 (trendcore extraction) ∥ GC1 (gateCandidates extraction) ∥ SL1 (suggestlog path regression). |
| **YIELD** | Yield-improvement program (folded from `PLAN-YIELD.md`, all shipped 2026-07-06): FC1 (fetch cache) → YF1 (historical market-state helper) → YS1 (outcomes v2 schema) ∥ YS2 (forward suggestion enrichment) → YV1 (velocity+capital-util #3) → YT1 (session-thesis #4) ∥ YP2 (state-transition scan #2) → YP1 (guide re-anchor #2, gated) → YA1 (in-app utilization #5). Full story: `CHANGELOG.md`. |
| **V2** | Pipeline v2 (ACTIVE): D0 (snapshot+SQLite archive) → P0 (context chain) → P1 (surface extraction + replay harness) → P2/P3 (validators, every surface) → P4a/b/c (path engine → persistence → declarative specs) → P5 (scalp/value + path-aware bids) → P6 (evidence viability) → P7 (docs/skills triage + skill-lint) → P8 (desk orchestrator). D0 ∥ P1-mechanical parallel-safe (disjoint primaries). |
| **SLT** | Sale-log tax fix (folded from `plans/PLAN-SALE-LOG-TAX.md`, shipped 2026-09-01): C1 (worthNet flag at ingest — `.json`-era sell `worth` is NET of GE tax) → C2 (net-primary matchTrades + `sellNetEach`, `grossFromNet` display inverse in quotecore) → C3 (warn-only per-file convention audit) → C4 (real-book acceptance + docs) → C5 (the §3a amendment, shipped 2026-09-02: the `.json` format RECORDS the tax — carried as `taxAmt`, gross becomes a read with `grossFromNet` as fallback, and the audit reads the field). Design home: `pipeline/FILLS-PIPELINE.md` §5.1 + the reconstruct.mjs header; full §1–§12 text `git show d1a6516:plans/PLAN-SALE-LOG-TAX.md` (the §3a amendment arrived uncommitted after the fold — its content is re-homed in §5.1 and CHANGELOG pipeline 1.2.0). |
| **BSH** | Book self-heal (folded from `plans/PLAN-BOOK-SELF-HEAL.md`, all shipped 2026-09-03): H1 (rebuy time/price gate `SHORT_MAX_AGE_DAYS` ∧ ≤`beRebuy`, hold-thesis `reverseFlip` override; breakeven closeout of undeclared aged shorts into positions.json `settled` — no closed row, lifetime unmoved; `REVIVE` exemption directive; AMENDS the "open measurement, no deadline" doctrine for undeclared shorts, Ben 2026-09-02) → H2 (money-math bond opt-in threaded through amplitude/band/churn screens) → H3 (`activeOffers` per-slot winner by wall-clock — kills the mtime-race phantom-slot class) → H4 (personal-use is per-TRADE withdraw, never item-level ignore unasked). Design homes: FILLS-PIPELINE §5.1a + reconstruct.mjs/offers.mjs headers; full text `git show 9fe4787:plans/PLAN-BOOK-SELF-HEAL.md`. |
| gated | **F1** (algorithm feedback) — opens only when O1's sample thresholds clear |

## Status

Detail per ✅ row = the landing commit message (`git show <sha>`) + `CHANGELOG.md`.

| Chunk | What | Primary files | State |
| --- | --- | --- | --- |
| BSH H1+H4 | Rebuy gate + breakeven closeout + `settled` + REVIVE + deterministic settledTs; personal-use per-trade docs | `pipeline/lib/reconstruct/reconstruct.mjs`, `pipeline/commands/sync-fills.mjs`, `pipeline/commands/add-manual-fill.mjs`, `pipeline/lib/thesis/holdthesis.mjs`, `.claude/skills/positions/SKILL.md`, tests | ✅ 2026-09-03 (CHANGELOG pipeline 1.3.0) |
| BSH H2+H3 | Bond costed as a bond on the screens (opt-in threaded + sweep); offers per-slot wall-clock winner | `js/amplitudescreen.mjs`, `js/flip-niches.mjs`, `pipeline/lib/signal/gatecandidates.mjs`, `pipeline/lib/reconstruct/offers.mjs`, tests | ✅ `bddf12f`+`08ebb20` (CHANGELOG 0.76.1) |
| SLT C1–C4 | Sale-log worth-convention fix: `worthNet` flag (SELL events, outside the eventId hash so fills.json auto-migrates), net-primary money paths incl. deriveCash sellIn, `grossFromNet`, `auditWorthConvention` guard, real-book acceptance | `pipeline/lib/reconstruct/reconstruct.mjs`, `pipeline/lib/reconstruct/offers.mjs`, `pipeline/commands/sync-fills.mjs`, `pipeline/lib/capital/derive-cash-tiers.mjs`, `js/quotecore.js`, tests | ✅ `dc07707` |
| SLT C5 | The §3a recorded-tax read: `taxAmt` carried outside the id hash, gross = `spent + taxAmt` (exact at the inversion's ≤1gp collision points, `grossFromNet` the fallback), audit reads the field both directions | `pipeline/lib/reconstruct/reconstruct.mjs`, `pipeline/commands/sync-fills.mjs`, `pipeline/commands/monitor-offers.mjs`, `pipeline/commands/trigger-alerts.mjs`, tests | ✅ 2026-09-02 (CHANGELOG pipeline 1.2.0) |
| DL2 | Reactive liquid-flush loop — `flushSignal` + `watch.mjs --dip` FLUSH alert (bid-into-the-fall, liquid-only, unit-flow fillability); widened SIGNAL log (liquid+illiquid, `alerted`/`gatedReason`) + `analyze.mjs §4` candidate-surfacing retro; PLACEHOLDERS n=2, ALERTS-never-places | `js/quotecore.js`, `pipeline/commands/watch-positions.mjs`, `pipeline/lib/suggestlog.mjs`, `pipeline/lib/analyze.mjs`, `pipeline/commands/analyze-record.mjs`, `dip-watchlist.json`, `pipeline/test/diploop.test.mjs` | ✅ `73eb65e` |
| DL4 | Scan auto-nominates dip candidates ("B feeds A") — pure `nominateDip`/`selectNominations` (zero-fetch flush-suitability over the gate-tier universe) append flush-suitable picks to `dip-watchlist.json`; polymorphic `--dip` reader; PROPOSALS-to-watch, PLACEHOLDERS n=2 | `js/quotecore.js`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/watch-positions.mjs`, `dip-watchlist.json`, `pipeline/test/dl4nominate.test.mjs` | ✅ `6c9abf2` |
| DL3 | Flush-distribution → candidate discovery feeding the thesis layer (spec below) — DL4 already landed the `dip-watchlist.json` auto-feed half; DL3 adds the flush-distribution thesis layer on top | `pipeline/lib/analyze.mjs`, `js/flip-niches.mjs`, `dip-watchlist.json` (auto-fed by DL4), tests | OPEN (n-gated on DL2's widened log accruing, like F1) |
| DP1 | Dip-posture entry classifier (dip DIRECTION, not just depth) — `recentDirection` + `dipPostureValidator`, inform on band/churn | `js/quotecore.js`, `js/validate.mjs`, `js/flip-niches.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/test/dipposture.test.mjs` | ✅ `597f132` |
| PM1 | Probe-module system (dip/froth/anchor/decant theory plug-ins) | `pipeline/modules/*`, `pipeline/lib/probes.mjs` | ✅ `6aba80b` |
| TG1 | Thesis-gated hold alerts | `hold-thesis.json`, `pipeline/lib/holdthesis.mjs`, `watch.mjs` | ✅ `b2634a1` |
| T1 | Standard table v2 | `js/quotecore.js`, `pipeline/cli.mjs`, app | ✅ `c7b53e7` (0.34.0) |
| T2 | Trends sections + last-2h view | `js/trends.js`, `js/charts-static.js` | ✅ `70633f6` (0.35.0) |
| O1 | Outcomes dataset | `pipeline/commands/join-outcomes.mjs`, `suggestions.jsonl` | ✅ `b0749bf` (F1 gate: n≥30 per side×pctl×class×regime cell, ≥5 cells — stays GATED) |
| K1 | Self-improving skills | `.claude/skills/*/SKILL.md` | ✅ `283e12a` |
| K2 | Memory dedupe pass | Claude memory dir | ✅ (memory-dir only — no repo commit) |
| K3 | CLAUDE.md slimming round 2 | `CLAUDE.md`, code headers | ✅ `ec02495` |
| S1 | Screening economics (gp-flow, 500k floor) | `pipeline/commands/screen-flip-niches.mjs`, `rating.mjs` | ✅ `5ad72a9` (S1.3 spread-drop STAYS DEFERRED — NY2.3) |
| S2 | Overnight vs active posture | `pipeline/commands/screen-flip-niches.mjs` | ✅ `12e8a86` |
| S3 | Watchlist always scanned | `watchlist.json`, `screen.mjs` | ✅ `3a38018` (0.37.0) |
| Q1 | Gate-0 reliability gap | `js/quotecore.js` | ✅ `23deba0` (0.36.0) |
| E1 | Local-time audit | `js/ui.js` (+sweep) | ✅ `4c433d0` (audit-only, no code change) |
| L1 | Action logging pass | `js/main.js` et al. | ✅ `3404681` (0.38.0) |
| G1 | PR flow + ruleset migration | GitHub ruleset, `checks.yml`, `/ship` | ✅ `553c3a6`+`b57fbe8` |
| M1 | Mobile parity — GitHub-as-backend writes | `sync-fills.mjs`, `mobile-fills.log`, app | ✅ `6789859`+`d3df7fe` (0.39.0) |
| N1 | Push notifications on price movement | `pipeline/commands/trigger-alerts.mjs` | ✅ `033318e` (delivery mechanism = pending Ben decision) |
| P1 | Snapshot-re-emission dedupe in reconstruct | `pipeline/reconstruct.mjs` | ✅ `5015a5c` |
| D1 | Doc reconciliation pass | docs | ✅ `2135d49` |
| R1 | Reconstruction test harness + CI wiring | `reconstruct.test.mjs`, `checks.yml` | ✅ `c79dcc5` |
| X1 | Pipeline dedup | `pipeline/*` | ✅ `e7e62f5` |
| X2 | Dead-scheduler excision | `sync-fills.mjs` | ✅ `fb9344e` |
| A1 | App dead-code sweep | app | ✅ `a2e8318` (0.41.0) |
| A2 | App fetch/helper unification | `js/marketfetch.js` et al. | ✅ `1aa43ec` (0.42.0) |
| A3 | Split `js/ledger.js` out of `ui.js` | `js/ledger.js` | ✅ `7ef1db1` (0.43.0) |
| BE1 | Break-even 5m tax-cap fix | `js/quotecore.js` | ✅ `82340d5` (0.40.0) |
| W1 | Trade-analysis cadence | `/morning` skill | ✅ `5666eac` |
| CI1 | Browser smoke test in CI | `checks.yml`, `pipeline/ci/smoke-test.mjs` | ✅ `69bf79d` |
| TB1 | Reusable sortable-table component | `js/table.js` | ✅ `3e40cbe` (0.44.0) |
| LU1 | Ledger UX rework | `js/ledger.js`, app | ✅ `c88df30` (0.45.0) |
| FX1 | Finder full-catalog search + Signals badge | `js/ui.js`, `js/market.js` | ✅ `c12bf4b` (0.46.0) |
| NY1 | Scan niche-yield audit | analysis only | ✅ report delivered 2026-07-05 (no repo change) |
| SY1 | Strategic sync-fills points in skills | workflow skills | ✅ `563da75` |
| NY2 | Niche ruling (rising floor, churn off-by-default, spread stays) | `screen.mjs`, `/scan` | ✅ `f982a31` — **SUPERSEDED: spread + rising DELETED (Steps 3+4, see Discovered)** |
| OR1 | Org map docs | `README.md`, `CLAUDE.md` | ✅ `1822ad9` |
| OR2 | pipeline/lib/ split | `pipeline/lib/*` | ✅ `94781cc` |
| TD1 | Glob test runner + money tests | `pipeline/ci/run-tests.mjs`, tests | ✅ `d147bab` |
| TD2 | Testability extractions | `js/ledgercore.js` et al. | ✅ `e442367` (0.47.0) |
| TD3 | Nice-to-have test sweep | tests | ✅ `a1110c7` |
| LW1 | Local log-watcher core + `offers.json` + daemon | `sync-fills.mjs`, `watch-log.mjs` | ✅ `b97c87b` (offers.json `d395864`; the daemon does ZERO git — load-bearing) |
| LW2 | App localhost live-refresh | `js/ledger.js`, `js/state.js` | ✅ `9da9910` (0.48.0) |
| LW3 | Local-watcher docs reconciliation | docs | ✅ `8ad3a45` |
| LH1 | Exchange-log hardening (`validateSlotTransitions`) | `lib/reconstruct.mjs` | ✅ `c0fc711` (EMPTY stays non-evidence — don't resurrect cancel-to-EMPTY inference) |
| LH2 | Restart-blindness header | `lib/logblind.mjs` | ✅ `f7bd006` |
| LH3 | Log-hardening docs reconciliation | docs | ✅ `05ccea6` |
| TC1 | trendcore extraction | `js/trendcore.js` | ✅ `eaa5414` (0.50.0) |
| GC1 | gateCandidates extraction | `lib/gatecandidates.mjs` (precursor) | ✅ `cb3eb67` |
| SL1 | suggestlog path regression fix | `lib/suggestlog.mjs` | ✅ `1702126` |
| V1+V2 | Verdict-layer temporal memory | `lib/watchstate.mjs`/`levels.mjs`, `watch.mjs` | ✅ `8a5d160` (temporal memory lives OUTSIDE pure `momVerdict`) |
| V3 | Gate-D lot-context softening | `js/quotecore.js` | ✅ `692baee` (0.52.0) |
| V4 | Conviction gating (arm-then-confirm) | `lib/watchstate.mjs` | ✅ `2a87269` (Gate-2 breakdown CUT EXEMPT — immediate) |
| V5 | Emit-contract standardization | `lib/emit.mjs`, `watch.mjs` | ✅ `825469f` |
| V6 | Recovery-read + capital companion (advisory) | `lib/recovery.mjs`/`freed-capital.mjs` | ✅ (the PLAN-VERDICT.md fold commit, 2026-07-06) |
| FC1 | Opt-in cross-invocation fetch cache | `lib/marketfetch.mjs` | ✅ `0e48b2c` (OFF by default — decision paths byte-identical) |
| YF1 | Historical market-state helper | `lib/range-position.mjs` | ✅ `2ab0139` |
| YS1 | outcomes.mjs schema v2 | `outcomes.mjs`, `lib/velocity.mjs` | ✅ `92ffa1c` |
| YS2 | Forward prediction-field logging | `lib/suggestlog.mjs` + surfaces | ✅ `27f0baa` |
| YV1 | Velocity + capital-utilization analytics | `lib/capital-utilization.mjs` | ✅ `1ea914d` (+ velocity footnote `7502889`, total-capital `2fdae81`) |
| YT1 | Session-thesis memory | `lib/sessionthesis.mjs`, `thesis.mjs` | ✅ `5439fed` |
| YP2 | State-transition scan | `lib/statetransition.mjs` | ✅ `9f60c15` |
| YP1 | Guide re-anchor prediction (honesty-gated, ships silent) | `lib/guideanchor.mjs` | ✅ `a93da6a` |
| YA1 | In-app capital-utilization line | `js/watchcore.js`, app | ✅ `a7fd785` (0.53.0) |
| PM2 | Probe firing logs | `lib/probes.mjs` | ✅ `5ca4f95` |
| SR1 | `suggestions.jsonl` rotation/compaction | `lib/suggestlog.mjs` | ✅ `457a7bd` |
| GA1 | `.gitattributes` LF/CRLF normalization | `.gitattributes` | ✅ `3a7f68f` |
| F1 | Algorithm feedback loop | (gated on O1) | GATED (spec below) |
| D0 | Snapshot + SQLite archive | `pipeline/lib/archive.mjs` | ✅ `7e0e962` |
| V2-P0 | Context chain + unified held verdict | `pipeline/lib/item-context.mjs` | ✅ `a6dc7d1` |
| V2-P1 | Surface extraction + replay harness | `lib/gatecandidates.mjs`, `lib/replay.mjs` | ✅ `f02fbf5`+`8db97bf` |
| V2-P2 | Validate stage + reachValidator (every surface) | `js/validate.mjs`, `js/windowread.mjs` | ✅ `910bea1` |
| V2-P3 | floorValidator + term structure | `js/termstructure.mjs` | ✅ `b55f895` |
| V2-P4a | Path engine core (pure) | `js/held-item-strategy.mjs` | ✅ `e2eed20` |
| V2-P4b | Path persistence + migration | `lib/watchstate.mjs`, `watch.mjs`, `quote.mjs` | ✅ `ec425f7` |
| V2-P4c | Declarative strategy specs | `js/flip-niches.mjs` | ✅ `cfcc624` |
| V2-P5 | scalp/value specs + path-aware bids + falling doctrine | `js/flip-niches.mjs`, `js/valuescreen.mjs`, `js/quotecore.js` | ✅ `fe46f2e` (value-niche spec full text: `git show fe46f2e:PLAN-VALUE.md`) |
| V2-P6a | Retro-join calibrator (suggestion→fill ground truth) | `pipeline/lib/retrojoin.mjs`, `pipeline/commands/report-retro.mjs` | ✅ `6c3f1b5` |
| V2-P6b | TTF estimators + per-thesis ranking (net × P(fill) ÷ TTF) | `pipeline/lib/estimators.mjs`, `js/flip-niches.mjs`, `screen.mjs`, `rating.mjs` | ✅ `a21f1bc` (expGpDay DEMOTED to pre-fetch orderer + 500k pre-filter; rank/price-basis doctrine lives in the `estimators.mjs` header) |
| V2-P6c | Empty-result sub-floor fallback (zero candidates at floor → show best sub-floor rows, honestly labeled) | `lib/gatecandidates.mjs`, `screen.mjs` | ✅ `6432a05` (two-sided gate + thesis edge NEVER relaxed; sub-floor rows stdout-only, never screen.json; ledger rows carry a lean `subFloor` marker) |
| V2-P7 | Docs/skills triage + skill-lint + CLAUDE.md diet | docs, skills, new `pipeline/ci/lint-skills.mjs`, `docs/LORE.md` | ✅ `105326a` (skill-lint in CI — rule-blocks need a code pointer or `judgment:` tag). Lone RETIRE disposition executed `f8de508` (Ben 2026-07-09): `/overnight` v1.11 weekend-shift prose → one-line full-day check (v1.15) |
| V2-P8 | Desk orchestrator | new `pipeline/desk.mjs` | OPEN (after P0–P5 harden) |
| TV1 | Per-thesis validators (gate/inform) + trajectory (knife/oscillating/based) classifier + in-script windowrange (reach Leg B + 1h-derived trajectory) | `js/termstructure.mjs`, `js/validate.mjs`, `js/flip-niches.mjs`, `pipeline/commands/screen-flip-niches.mjs`, tests | ✅ 2026-07-09 (Ben design session: separate validator COMPUTATION from per-thesis ACTION; `spec.validators`={key,mode,window}; reach/trajectory/value-amplitude start inform everywhere, floor+limit gate; trajectory off the fetched 1h series so it fires while loadDaily is cold — the Nightmare-staff knife catch; SKILL /scan v1.29; replay goldens untouched; no APP_VERSION) |
| PF1 | Forecast: pure diurnal+trend 12h/24h projection module + `hourProfile` dispersion fields | `js/forecast.mjs` (new), `js/windowread.mjs` (additive), `pipeline/test/forecast.test.mjs` (new) | ✅ 2026-07-10 (`diurnalForecast`/`whenBuyable`/`whenSellable`; blood-rune golden pinned; loud degrades; band widens with horizon; INFORM-ONLY/console-only, n≈0 placeholders, no APP_VERSION. **PF2–PF8 remain OPEN** — surfaces (quote/screen/windowrange/watch), estimator/validator hooks, and the PF8 validation study that gates any graduation past inform-only; see `PLAN-FORECAST.md`) |
| ARCH-1 | monitor.mjs applies REMOVE tombstones (no phantom holds) | `pipeline/commands/monitor-offers.mjs`, `lib/reconstruct.mjs`, `monitor.test.mjs` | ✅ `a24d456` (routes monitor's in-memory FIFO through shared `buildTombstonedEvents`; PLAN-ARCH-DOCS-AUDIT A1) |
| COD-1 | Quote-basis ordering invariant fixture | `pipeline/test/quotecore.test.mjs` | ✅ `55861d1` (test-only; `quoteOrdered(row)` across consistent-basis shapes; Q3-2) |
| DL1 | Structural doc-drift linter + CI wire | `pipeline/ci/lint-docs.mjs`, `lint-docs.test.mjs`, `checks.yml` | ✅ `ef239dc` (denylist + duplicate-phrase; stays denylist/structural, never semantic; Q3-1) |
| COD-2 | Overnight accumulation table → script | `lib/gatecandidates.mjs`, `screen.mjs`, `/overnight` SKILL | ✅ `81d9049` (`expUnitsOvernight`; `screen.mjs --posture overnight` prints the table; pinned by `expunitsovernight.test.mjs`; Q3-3) |
| COD-3 | `rebidBar`/`rebidAdvice` helper + weekly-read marker | `js/quotecore.js`, `pipeline/commands/join-outcomes.mjs`, skills | ✅ `5b91d10` (trajectory/diurnal-aware CUT-family advisory; `--weekly-due`; pinned by `rebid.test.mjs`; Q3-4/5) |
| COD-4 | quote.mjs budgeted ts1h → reach/trajectory fire on explicit asks | `pipeline/commands/quote-items.mjs`, `lib/warm-term-structure.mjs`, `lib/item-context.mjs` | ✅ `a923496` (fixes flaw A4; shared `staleBookBanner` + diurnal line on quote; Q3-6/7) |
| DOC-1..4 | ARCH-docs cleanup: PLAN prune · CLAUDE diet r3 · README registry-grade · verdict single-home | docs, `.claude/skills/*` | ✅ `e45cd7b`/`560b28b`/`1619ff6`/`0c9ecca` (from `PLAN-ARCH-DOCS-AUDIT.md`; DOC-5+ARCH-2 stay Ben-gated there — see Discovered) |
| ARCH-3 | `parseGp` cross-comments (the volume-source half is NOT mechanical → Discovered SF-3) | `js/format.js`, `pipeline/lib/cli.mjs` | ✅ `6808c58` (comment-only, no APP_VERSION) |
| SWEEP | 2026-07-10 sweep innocuous fixes: `Promise.all` bulk loaders · shared `clamp` dedup · `bandPercentile` extraction | `screen.mjs`, `rating.mjs`, `estimators.mjs`, `range-position.mjs`, `outcomes.mjs` | ✅ `ef68792` (byte-identical dedups; the review verdict + parked residue = Discovered SF-1/2/4/5) |
| SF-2 | Document quote.mjs's uncapped per-item ts1h fetch budget | `pipeline/commands/quote-items.mjs` | ✅ `fe57a3b` (comment-only; soft-cap recipe if large batches ever routine) |
| SF-1 | Quantile/median type-7 consolidated to one `js/quotecore.js` home (both sorted + sorting contracts) | `js/quotecore.js`, `js/termstructure.mjs`, `pipeline/lib/retrojoin.mjs` | ✅ `2cbca38` (0.56.0; byte-identical refactor, fixture-pinned; caller audit preserved each site's sorted/unsorted contract) |
| SF-3 | Liquidity-class volume-source unify: `volSrc` tag + fetch-free warm-only bulk read (never a cold bulk fetch for a 1-item ask) | `pipeline/lib/suggestlog.mjs`, `pipeline/lib/marketfetch.mjs`, `pipeline/commands/quote-items.mjs`, `pipeline/commands/screen-flip-niches.mjs` | ✅ `3a36a1e` (pre-F1 calibration hygiene; pinned by `sf3-volsrc.test.mjs`; pipeline-only) |
| DT1–DT6 | Diurnal timing layer (was `PLAN-DIURNAL-TIMING.md`, folded+deleted 2026-07-23): surface "max intraday margin if you buy/sell at the right times" on EVERY band/churn/amplitude row + the multi-week base-position shape. `diurnalTimedLap`/`hourConcentration` pure fns → `formatTimedLap` shared renderer → screen/quote/watch wiring → `timedLap` shadow-log + §7 data-guarantee test → trends.js `★` on canonical `hourConcentration` → `basePosition` multi-week note (single-source off `termStructure`). Inform-only, n≈0 PLACEHOLDER (tranche borrows reach-relief's n≈6 anchor). | `js/windowread.mjs`, `pipeline/lib/emit.mjs`, `pipeline/commands/{screen-flip-niches,quote-items,watch-positions}.mjs`, `pipeline/lib/suggestlog.mjs`, `js/trends.js`, `js/termstructure.mjs` | ✅ DT1 `7756706` · DT2 `63d5863` · DT3 `aeab7d1` · DT4 `369f059` · DT5 `f642fef` (0.68.0 — the one app bump) · DT6 `296332d` |
| DAEMON P1–P10 | Daemon subsystem: a legible, self-maintaining background-task layer (was `PLAN-DAEMON-SUBSYSTEM.md`, folded+deleted 2026-07-25). **Phase 1** — `pipeline/daemons/` home + `registry.mjs` (declarative fleet list, `GIT_WRITER` const adjacent) + `manager.mjs` (`status()`/`ensure()` + THE SAFETY INVARIANT: `ensure()` physically refuses `local:false` git-writers) + heartbeat store (`.cache/daemon-state.json`) + the `cache-warm` GUARD (forward-looking >23h-cold coverage keeper, zero-git) + `archive.newestBucket`/`marketfetch.newest1hAgeHours` freshness probe + the opportunistic `ensure()` hook at 4 workflow seams + a reversible Windows Task Scheduler installer + `check-daemon-safety.mjs` CI zero-git guard. **Phase 2** — migrated the 3 pre-existing daemons off stubs to REAL health checks (`sync-fills` guard = book freshness, `watch-log`/`dev-server` residents via the shared `health.mjs` `heartbeatHealth`/`httpProbeHealth`, generalized from `ensure-server.mjs`), all `autoRun:false` (visible in `status()`, never auto-started — only `cache-warm` auto-runs); added the `autoRun` skip to `ensure()`; the `read-daemons.mjs` status surface; deduped `ensure-server.mjs` onto `health.mjs`. Node-only, no APP_VERSION bump. | `pipeline/daemons/{registry,manager,cache-warm,health}.mjs`, `pipeline/daemons/*.cmd`, `pipeline/commands/{read-daemons,ensure-server,dev-server}.mjs`, `pipeline/lib/{archive,marketfetch}.mjs`, `pipeline/ci/check-daemon-safety.mjs` | ✅ P1a `8a372df` · P1/2/3 `df86759` · P4 `c1c7080` · P5 `167c439` · P6 `9540d25` · **Phase 2 `937a687`** |
| HT0–HT5 | 3-day hourly drift read: the per-hour day-over-day slope in the core flow (was `plans/PLAN-HOURLY-3DAY-TREND.md`, folded+deleted 2026-07-28). Fixes the signal the 14-day aggregate profile HIDES — `--profile` collapses 14 days into one low/high per hour-of-day and the reach validators count over that same collapsed window, so a staircase-down item reads bullish because its reach was earned days ago (anchor: Ghrazi rapier graded A- "fill-now" at an ask that had already stopped clearing intraday). HT0 pure `hourlyDrift(series1h,{days,ask})` primitive + least-squares slope + flat-epsilon placeholder, fixture-pinned → HT1 `read-window-range --hourly` per-hour `Δ/d` column + summary → HT2 `hourlyDriftNote` compact folded note wired into the quote notes → HT3 scan pre-recommendation enrichment on the ranked top-X (the seam that prints `⚠ falling ~800k/d — verify`) → HT4 reverse-flip fold, landed inside PLAN-REVERSE-FLIP's RF6+RF4 rather than separately → HT5 docs/registry, landed per-chunk not as a trailer. INFORM-ONLY n≈0 — plans and warns, never gates. Pipeline/console-only, no APP_VERSION bump. | `pipeline/lib/market/hourly-lmh.mjs`, `js/windowread.mjs`, `js/reverseflip.mjs`, `pipeline/lib/render/render.mjs`, `pipeline/commands/{read-window-range,quote-items,screen-flip-niches,read-schedule}.mjs`, `pipeline/test/{hourly-lmh,windowread}.test.mjs` | ✅ HT0/HT1 `51da206` · HT2/HT3 `746da1b` · HT4 via RF6 `89bfdde` + RF4 `e1d8c1a` |
| RF0–RF6 | Reverse-flip: harvest an OWNED keep item — sell into the diurnal/multi-week PEAK, rebuy at the DIP, capital-free (was `PLAN-REVERSE-FLIP.md`, folded+deleted 2026-07-25). RF0 owned-item + cycle-state substrate (stores/lib/CLIs) → RF1 `js/reverseflip.mjs` pure inverted-regime gate (rising/elevated→reject, knife=the "falling" case→pass) + `tax()` break-even + rebuy-leg-weighted liquidity → RF2 `--mode reverse` console surface (own gate/table/ownership-gated pool, zero-ripple) → RF3 read-only BANKED-backfill reconciliation advisory → RF6 thin big-ticket read guards (`isThinBigTicket` + inform-only display) → RF4 surfacing into /schedule·/book·/positions (byte-identical on empty store). RF5 (custom bank plugin) DELETED — `data-export` already dumps the bank (`PLAN-MCP-BANK-SERVER.md`, deferred). Inform-only n≈0; Ben places every offer. Pipeline/console-only, no APP_VERSION bump. | `owned-items.json`, `reverse-flip-state.json`, `js/reverseflip.mjs`, `js/flip-niches.mjs`, `pipeline/lib/{ownedledger,reverseflipstate,gatecandidates,book-model}.mjs`, `pipeline/commands/{declare-owned,declare-reverse-flip,reconcile-reverse-flip,screen-flip-niches,read-schedule,read-book,quote-items}.mjs` | ✅ RF0 `0dc43ca` · RF1 `665e22e` · RF2 `5df6987` · RF3 `8d9f348` · RF6 `89bfdde` · RF4 `e1d8c1a` |
| CAP-DEP L1–L3, C1 | Lean capital-deployability: the deployable number is SHOWN + composed at the point of use and corrected at the SOURCE, not modelled (was `PLAN-CAPITAL-DEPLOYABILITY.md`, folded+deleted 2026-07-26). L1 the run-loop scan-gate already prints `deployable X (free Y + Z reclaimable · liquid W)` + gate outcome (pre-existing since the 07-15 rename). L2 `suspectBidEscrow`/`loadSuspectBidEscrow`/`suspectBidNote` in `offers.mjs` → the `⚠ N restart-suspect bid(s) may be included — verify in-game` flag beside the deployable figure on read-book, the run-loop scan gate, and screen --capital (INFORM-ONLY; a restart-blind bid drops from offers.json so its escrow is never subtracted → deployable can be inflated). L3 correction doctrine in `/scan` (v1.88) + `/book` (v1.2) SKILL.md + memory `deployable-shown-correct-at-source`. C1 the collapseOffers lost-terminal-relist split + buildEvents purity were already on main. The three-bucket automated redesign stays SHELVED (revisit only if capital is ever sized unattended). Pipeline/skill-only, no APP_VERSION bump. | `pipeline/lib/offers.mjs`, `pipeline/commands/{read-book,run-loop,screen-flip-niches}.mjs`, `pipeline/test/offers.test.mjs`, `.claude/skills/{scan,book}/SKILL.md` | ✅ L2/L3 `ecbc5de` · `/book` L3 `10856ab` · L1/C1 pre-existing |
| LIB-SUBDIRS 0–7 | `pipeline/lib/`'s 50 flat `.mjs` files regrouped into 7 concept subdirectories, so the tree describes the architecture (was `PLAN-LIB-SUBDIRS.md`, folded+deleted 2026-07-26). **Chunk 0** built `move-lib-cluster.mjs` — the mover rewrites specifiers by RESOLVING each to an absolute path and comparing against the moved set (not by pattern-matching import cases), so every edge case incl. the `../../js/` depth-bump and cross-cluster re-bumps is correct by construction; it parses `export … from` (the estimators/rating barrel shims `check-imports` cannot see) and warns on self-relative path math. Chunk 0 also made `lint-arch` resolve bare basenames recursively under `pipeline/lib/**` (else chunk 1 hard-fails on ARCHITECTURE.md's bare `gatecandidates.mjs`/`compose.mjs`) and widened `check-imports` ENTRYPOINTS from a hardcoded 11 to every `pipeline/commands/*.mjs` (473→614 imports checked). **Chunks 1–7:** render → thesis → reconstruct → timing → market → signal → capital (reconstruct moved before capital to avoid double-touching 3 files). `paths`/`version`/`ignored` stay at `lib/` root as cross-cutting infra. **7 self-relative paths fixed** across chunks 1/3/5 (`suggestlog` LEDGER, `offers` mapping-cache, `sync-invoke` SYNC_FILLS, `marketfetch` CACHE_DIR, `archive` DEFAULT_DB, `compose` CONFIG_PATH, `probes` PROBES_DIR) — a class NO static guard catches, several failing silently via try/catch fallbacks. Every chunk: 7 guards green + `positions.json`/`offers.json` byte-identical. Pipeline-only, no APP_VERSION bump. | `pipeline/ci/{move-lib-cluster,lint-arch,check-imports}.mjs`, `pipeline/test/{move-lib-cluster,lint-arch}.test.mjs`, all of `pipeline/lib/**`, ~30 `pipeline/commands/*.mjs`, ~40 `pipeline/test/*.test.mjs` | ✅ C0 `36ee38c` · C1 `0193801` · C2 `0e0b5f9` · C3 `2424834` · C4 `d527217` · C5 `49792ac` · C6 `75083c0` · C7 (this wave) |
| CLEANUP C1–C11 | The `/cleanup` skill — a repeatable post-wave CODE/DOC/ARCHITECTURE hygiene pass (distinct from `/analyze`'s trading retro): runs every CI guard in `checks.yml` order + two non-gating reports, then a SESSION/WAVE-scoped judgment sweep (duplication, dead code, doc-honesty, worktree/branch staleness) → a propose-never-apply fix list (was `PLAN-CLEANUP-SKILL.md`, folded+deleted 2026-07-26). Added `lint-plan-lifecycle.mjs` (root `PLAN-*.md` past-fold-in flag + `SKILL_FILES` drift, non-gating) + `report-branches.mjs` (branch/worktree fact-gather) + tests. C11 tail: all 9 `.claude/skills/*/SKILL.md` now in `lint-skills` `SKILL_FILES` with tagged rule-blocks (book/schedule/ship joined). Node/skill-only, no APP_VERSION bump. | `.claude/skills/cleanup/SKILL.md`, `pipeline/ci/{lint-plan-lifecycle,report-branches,lint-skills}.mjs`, `pipeline/test/{lint-plan-lifecycle,report-branches}.test.mjs`, all `.claude/skills/*/SKILL.md` | ✅ core `5f3ac4b` · C11 (this wave) |
| MT1–MT3 | Mid-price gear (Helm of neitiznot class, ~10k–2m mid) never entered a default scan (was `PLAN-MID-TIER-ADMISSION.md`, folded+deleted 2026-07-27). **The first draft blamed `MIN_GPD` and was WRONG** — it is a hard PRE-fetch gate (`gatecandidates.mjs:284` returns null, not the "P6b demotion" the header claimed) and neitiznot PASSES it at ~692k Stage-1 `expGpDay`; the draft's own evidence proved it (177 gated at BOTH `--top` settings) and went unread. What misled it is a real hazard **MT1** fixes: the row's `⚠<floor` marker is **Path-A gp/day** (post-fetch, display-only) while the gate uses **Stage-1 `expGpDay`** (pre-fetch, hard drop) — two different numbers against one 500k constant, described three inconsistent ways in-tree. The true cause is fetch ORDERING: mid-tier gear is too liquid to be `thin` (no thin reserve) and too low-margin to outrank churn's 4.21m/d on the velocity lane's absolute-`expGpDay` sort — the one class with neither a reserve nor a winning rank. **MT2** = `GEAR_RESERVE` (`--gear-reserve`, default 4): guaranteed slots for `gear`-lane velocity-remainder candidates ranked among their OWN lane, `via:'reserve'`, additive (`0` ⇒ byte-identical). Lane is read off `volDay` (hpv+lpv, newly carried by `gatecandidates.mjs`), NEVER `limitVol` (min(hpv,lpv) — substituting it would classify churn as gear and poison the reserve, a plausible result not a crash), and FAIL-CLOSED on a missing `volDay`. NOT a re-rank — `capEfficiency` needs the post-fetch estimator result, and a capital-relative GRADE is what `5fea8bd` deliberately walked back. **MT3** = `rotationPeriodMs` on the `crowded out:` line: the exploration reserve is "starvation-proof by construction" but 1 velocity slot over ~140 excluded is a **~70h** wait per row. n=0 (no mid-tier flip has ever been logged, because none was ever surfaced); success = "mid-tier rows appear and can be judged". Class B (Berserker helm 780/d, failing BOTH liquidity paths) NOT scoped — see Open. Pipeline-only, no APP_VERSION bump. | `pipeline/lib/signal/{admission,gatecandidates}.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/admission.test.mjs`, `docs/MARKET-ANALYSIS.md`, `README.md` | ✅ MT1–MT3 `86e4aa6` |
| MT-V2 1–3 | **`GEAR_RESERVE` worked but reached the wrong population — fixed by re-cutting the peer group, not by enlarging it** (was `plans/PLAN-MID-TIER-V2.md`, folded+deleted 2026-07-27). Validation after MT2 shipped: the mechanism is sound (purely additive, 0 displaced, confirmed by a live `--gear-reserve 0` A/B) but `gear` is a VOLUME lane spanning Old school bond (11.88m mid) to Mithril keel parts (4.5k), so ranking it by absolute `expGpDay` gave the slots to cheap high-buy-limit consumables and left Helm of neitiznot at rank 10/15 — MT1's "biggest number wins" bias recurring one level down. Bumping 4→10 was REJECTED: 6 more fetches to reach a row scoring WORSE post-fetch (Path-A 420.7k/d sub-floor) than the three the reserve already delivers (528k–758k/d, grade B), and it contradicts `admission.mjs`'s founding ruling ("the fix is the ranking dimension, not a bigger reserve"). **MT-V2/2** = `MID_TIER_RESERVE` (default **2**, `--mid-tier-reserve`) — a sibling sequenced after `GEAR_RESERVE` over its leftovers, filtered to `limit ≤ MID_TIER_LIMIT_CUT` (200), so GE-restricted items rank against each other; plus `--mid-tier-offset N` paging (next N by CURRENT rank — not a durable cursor, deliberately no state file) and `safeSlot`, which guards the `.slice()` NaN/negative footgun paging newly introduces (no existing reserve validates CLI input — there was nothing to mirror). Null limits are fail-closed but REPORTED as `mid-tier-limit-unknown`, never a silent drop, because `structural-admission.mjs` deliberately does NOT exclude on null (~89 newer gear items carry `limit=null`, and escaping `thin` is the defining trait of this class — so this will eventually bite, loudly by design). **MT-V2/1+3** = doc reconciliation: MARKET-ANALYSIS/README's "closes the last unreserved lane" overclaim corrected in place, and the Class B Open entry rewritten (it asked about `FLOOR`; the real blocker is `bandEdge`'s ROI floor — proven via the structural gate). Verified on real data: the low-limit pool is reached, additive, no duplicates; 6 of 9 new tests fail against un-patched code. **⚠ SUCCESS CRITERION CORRECTED (owner, 2026-07-27):** this was validated by "Helm of neitiznot is admitted", which was the WRONG target — an arbitrary example of the class, possibly unprofitable. The goal is a candidate pool appropriate to AVAILABLE CAPITAL; mid-tier is probably not lucrative at high bankroll and should not crowd the pool there, but must surface if it ever becomes the right call. See the capital-conditioned-reserves entry in Open. Chunk 4 (a genuine edge treatment for tight-band gear) explicitly NOT scheduled, n=0. Pipeline-only, no APP_VERSION bump. | `pipeline/lib/signal/admission.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/admission.test.mjs`, `docs/MARKET-ANALYSIS.md`, `README.md`, `PLAN.md` | ✅ MT-V2 1–3 (this wave) |
| VZ1–VZ6 | One render layer between the pipeline's DATA and the reader's VIEW (was `plans/PLAN-VIZ-LAYER.md`, folded+deleted 2026-08-07). The three market-read scripts each hand-formatted their own console output, smearing data (facts: quotes, verdicts, fired gates, notes) into visualization (markdown tables, column widths, note ordering). VZ1–VZ6 extracted the typed render object — `headline`/`alerts`/`table`/`notes`/`lines` sections + the `core`/`context` TRACKING-tier registry that the `/scan` and `/positions` skills read instead of parsing stdout — into `render.mjs`, and pointed watch/quote/screen at it. **Presentation-only by construction: no chunk was permitted to change a gate, verdict, grade, rank, price, or break-even number**, and any that would have was flagged rather than done. VZ2a's fixture surfaced a genuine convictionGate-vs-heldDisplay disagreement; Ben's ruling — heldDisplay stays authoritative for the verdict word, a structural break surfaces as an appended warning clause — landed in `heldAlert()` directly. The per-report JSON dump (`pipeline/.cache/last-report/*.json`) that every skill's display contract now depends on is this plan's artifact. Pipeline/console-only, no APP_VERSION bump. | `pipeline/lib/render/render.mjs`, `pipeline/commands/{watch-positions,quote-items,screen-flip-niches}.mjs` | ✅ VZ1–VZ6 (2026-07-16) |
| FC1 | Phase-aligned floor+ceiling slope-asymmetry trajectory classifier (was `plans/PLAN-DRIFT-VS-CRASH.md`, folded+deleted 2026-08-14 — the plan never carried a Status line and shipped in the same commit that wrote it, so it had no scoreboard row). `floorCeilingTrack` tracks the floor (daily lows) and ceiling (daily highs) as SEPARATE least-squares slopes and classifies the asymmetry — `crash-risk / cooling / mild-cooldown / healthy-trend / compressing-up / ranging` — because a falling ceiling over a holding floor is a drift, while both falling is a break, and a single blended-mid slope cannot tell them apart. Req #1: an incomplete TODAY bucket must never feed the fit (a partial day reads as a crash). The four motivating cases (fang, godsword, maul, soulreaper) survive as prose in the `js/windowread.mjs` header AND as executable fixtures. HEURISTIC n≈0, inform-only — never gates. Pipeline-only, no APP_VERSION bump. | `js/windowread.mjs`, `pipeline/commands/{quote-items,read-window-range}.mjs`, `pipeline/lib/render/render.mjs`, `pipeline/test/windowread.test.mjs` | ✅ `c8fee6b` |
| CT1 | Derived cash: the idle-cash figure stops being a STATED number aging in place (was `plans/PLAN-CASH-TRACKING.md`, folded+deleted 2026-08-14 — its header still said "do NOT implement from this doc" for work that shipped 2026-07-12). Cash is conserved, so `deriveCash(events, anchor, liveOffers)` reconstructs `{liquidCapital, availableCash, deployablePool, netFlowSinceAnchor, restingEscrow, inferredInjection}` forward from an anchor plus the log flow; when resting offers exceed the derived balance it reports the shortfall as an INFERRED INJECTION rather than printing a figure it can prove wrong. Anchor lifecycle = original anchor, forward-derive only. INVARIANT: never a verdict/alert input. The motivating incident is re-homed to `docs/LORE.md`. Candidate direction 5 (a stale-anchor "verify against your coin stack" nudge) was NOT built and is superseded by CAP-DEP L3 — the figure is SHOWN and corrected at the SOURCE. Node-only, no APP_VERSION bump. | `pipeline/lib/capital/{derive-cash-tiers,cash-anchor}.mjs`, `pipeline/commands/{derive-cash,watch-positions,read-book}.mjs`, `pipeline/test/derive-cash-tiers.test.mjs` | ✅ (2026-07-12; three-tier update 2026-07-26 `ecbc5de`) |
| WX1 | Auto-surfaced ask-side window-clear read on big-ticket held lots (was `plans/PLAN-POSITIONS-WINDOW-READ.md`, folded+deleted 2026-08-14 — no Status line, future-tense prose over month-old shipped code). ONE shared `askExitRead` assembly gives `/positions` the daily-HIGH typical-exit levels, list-price reach/placement, 5m-grain reach, live-instabuy-vs-list and the diurnal peak window that previously required a manual `read-window-range --ask` — byte-parity with that CLI, ZERO extra fetch. Gated at `BIG_TICKET_GP` ∪ watchlist; the bar is an OUTPUT-NOISE bar, not a cost bar (rationale re-homed to `quote-items.mjs`). Degrades to one "window read unavailable" note on a null 1h series. Has since grown `reachMargin`, WC1 shadow-logging and the Chunk-2c reality clause. Pipeline/skill-only, no APP_VERSION bump. | `js/windowread.mjs`, `js/quotecore.js`, `pipeline/commands/{quote-items,read-window-range}.mjs`, `pipeline/lib/render/render.mjs`, `pipeline/test/askexitread.test.mjs` | ✅ `9aeaf7a` |
| PARITY PV/AP1/AP4/CL/TV/SIG-DEL | App↔console parity, the SHIPPED 6 of 10 (`plans/PLAN-APP-PARITY.md` stays ALIVE for AP2/AP3/AP5 + the 1.0.0 bump — it had never been folded, so six shipped chunks had no scoreboard row at all). **PV** `pipeline/lib/version.mjs` `PIPELINE_VERSION` stamped into `screen.json` + `positions.json` at write time, rendered beside `#appVer` as `#pipeVer` (degrades to `v?`; it is the LAST PUBLISHED artifact's version, not a live import — a static page can't do better). **AP1** the deployed Scan intro + `NICHE_META`/`NICHE_ORDER` reconciled to the shipped niches. **SIG-DEL** the Signals tab removed outright (zero residual hits). **CL** the interactive chart library shipped as `js/charts-interactive.js` (NOT the draft's `js/chartlib.js`), with the old static module renamed `js/charts.js` → `js/charts-static.js` and kept for sparklines; the draft reserved SVG-viewBox-vs-canvas for a pre-build design gate and it is resolved in code (fixed viewBox + JS-recomputed data window). **TV** all four Trends viz on CL — diurnal profile, forward forecast band, term-structure floor/ceiling overlay, and validator notes SPLIT across the viz they qualify. **AP4 is PARTIAL**: Finder ranks/sorts on the shared `estimateRank`/`rateItem` with the provisional label, but `RATE_W` is NOT torn out — `js/state.js`'s weight constants, `js/market.js`'s `ratingParts()` and the profit/hr column all still ship, and the code flags itself vestigial at its own call site. Q1 ruled FULL REBASE, so the teardown is a deletion, not a decision. | `pipeline/lib/version.mjs`, `js/{charts-interactive,charts-static,trends,market,ui,state}.js`, `index.html`, `pipeline/commands/{screen-flip-niches,sync-fills}.mjs` | ✅ PV `1df4352` · AP1+SIG-DEL+PV-render `143d7c9` (0.57.0) · CL+TV `a794f99` (0.58.0) · `a214f4e` (0.59.0) · `9921c91` (0.60.0) · AP4-partial `2e1a110` (0.61.0) · rename `c41bc1c` — **AP2/AP3/AP5/V1.0.0 OPEN** |
| AR1–AR4 | Architecture-coherence audit + salvage (was `plans/PLAN-ARCHITECTURE-COHERENCE.md`, folded+deleted 2026-08-14; its header blocked its own deletion on two chunks preserved "UNCOMMITTED on worktree `agent-a3e1ba12232696893`" — that worktree no longer exists and BOTH chunks have since resolved). AR1 deduped the copy-pasted sync-before-read block (three byte-for-byte copies with a hairline regex divergence) into `sync-invoke.mjs` `runLocalSync`. AR3 tags exploration-reserve survivors `via:'explore'` + the 🎲 screen token so a lottery slot is never rendered as a ranked-in pick. AR4 one-homed the admission rows and the validator inform-vs-gate invariant in ARCHITECTURE.md. Salvage 1/5/6 (`maxTs` reduce over a spread, in-flight promise cache, `lib/paths.mjs` owning `REPO_DIR`) landed at `ceb538b`; deferred chunks 2/3 resolved under CAP-DEP L2/C1. **AR2 (a sunset condition for the `--admission legacy` `rankAndSlice` path) was NEVER built** — re-homed as an EVIDENCE-based trigger in `docs/ARCHITECTURE.md`, not dropped. ⚠ In-tree comments cite "AR2" for what this plan calls AR3 (commit `4c8973a` is mistitled); the ids are load-bearing nowhere else. Pipeline/doc-only, no APP_VERSION bump. | `pipeline/lib/reconstruct/sync-invoke.mjs`, `pipeline/lib/signal/admission.mjs`, `pipeline/lib/paths.mjs`, `pipeline/commands/{read-buy-limits,screen-flip-niches}.mjs`, `docs/ARCHITECTURE.md` | ✅ AR1 `2b7af60` · AR3 `4c8973a` · AR4 folded · salvage `ceb538b` · AR2 re-homed as Open |
| A1–A6 | The AMPLITUDE lane + **THE SWAP** (was `plans/PLAN-AMPLITUDE-SCAN.md`, folded+deleted 2026-08-14). Origin: the band screen prices the 2h band and ranks `net × P(fill) ÷ TTF` on an intraday basis, so a big-ticket that oscillates ~4% DAILY (Masori body ≈42m, ~250/d, daily range 41.3m↔43.9m) read Quick +0.0% / Opt +1.2% and ranked ~12,881 — a structural blind spot, not a bad score. **A1** `js/amplitudescreen.mjs`: a TWO-STAGE gate mirroring value's (Stage 1 = a cheap attenuated amplitude proxy off the 6h-spaced bulk daily archive, whose only job is picking the fetch pool and which degrades to no-candidate — never a fake amplitude — on a cold slice; Stage 2 = the real gates off ONE full-day `windowStats` call: daily-amplitude median, both-leg `recencySplit` reach, trend/knife guard). **A2** registered it as a 4th DECLARATIVE SPEC (`gate:'amplitude'` route + an `'amplitude'` ESTIMATOR FAMILY) rather than the draft's bespoke `ampScore` — the draft's `net × deployable ÷ holdDays` is `rankScore` in disguise minus the P(fill) term its own §4 called make-or-break, and building it would have forked a third ranking composite. **A3** `holdDays` + `weekdayProfile` (day-of-week bucketing was genuinely-new code — the plan's first draft claimed it "already exists", which was false). **A4 THE SWAP** — `value.inAll=false` ∥ `amplitude.inAll=true`, a TOGGLE not a delete: value stays runnable via `--mode value`/`--mode invest`, its ledger KEY and replay goldens untouched (a KEY rename would fork the retro history — label-rename only). **A5** the shadow both-leg replay (`join-amplitude-outcomes.mjs`), an n-rich would-have-filled UPPER BOUND (a printed level ≠ your fill — no queue/size model) alongside the realized retrojoin. **A6** banked the one real dedup — the shared candidate-loop boilerplate `gateCandidates`/`gateValueCandidates` duplicated. **§6's verdict, the load-bearing one:** the cycle-period continuum is a genuine organizing FRAME but a forced IMPLEMENTATION abstraction — a literal `cycle=<t>` engine would leak churn's three code-verified exemptions (no ROI gate, per-LAP rank, `fillShape:'symmetric'`) back in as special cases and would not unify the DATA GRAIN, where most of the code lives; the honest cycle-parameterized core already exists and is called `FLIP_NICHES`. That frame is re-homed to `docs/MARKET-ANALYSIS.md` §3 + `docs/GLOSSARY.md`. **SUPERSEDED SINCE:** PLAN-DIURNAL-TRIAGE DT1 REFUTED the 24h premise in the plan's own title (4.8% completion given entry) and re-horizoned the lane 1d → 4d; DT1b replaced the P(fill) with the walk-forward `ampWalkForward`. Thresholds were PLACEHOLDERS at n≈0 and the lane is console-only/inform-first. | `js/{amplitudescreen,flip-niches,windowread}.mjs`, `js/estimators/families.mjs`, `pipeline/lib/signal/{gatecandidates,admission}.mjs`, `pipeline/commands/{screen-flip-niches,join-amplitude-outcomes}.mjs`, `pipeline/lib/render/{suggestlog,retrojoin}.mjs` | ✅ A1–A6 `4acd1bb` (re-horizon DT1 `c50626f`) |
| FPS 1–4 | Capital-scale the fetch pool + give value a reserve (was `plans/PLAN-FETCH-POOL-SCALING.md`, folded+deleted 2026-08-14; scoped from blindspot-audit findings #1/#7). The scan's fetch pool is sized by FIXED constants and a candidate that misses the slice is dropped BEFORE any pricing/gate math that would judge it — there is no post-fetch recovery path. **Chunk 1** `VALUE_RESERVE` (default-ON, purely additive): the value niche had ZERO reserve where band/churn had `THIN_RESERVE` — the excluded remainder is now ranked by raw termStructure cycle-amplitude-%, a DIFFERENT key than the composite `valueScore` that was burying strong-cycle/low-`limitVol` big-tickets. It had to be added in BOTH admission paths (`admission.mjs` `pickFetchPool` AND legacy `rankAndSlice`) — the double-maintenance shape every admission chunk inherits. **Chunks 2–3** the `scaleSlots` sub-linear capped curve `base·(1 + POOL_SCALE·√(excess/CAP_REF))`, behind an explicit `--scale-pool` (default OFF — byte-identical otherwise); an explicit `--top` always wins and is never capital-scaled. **Chunk 4** `clampUnionFetch`/`TOTAL_FETCH_MAX`, the cross-niche ceiling (`--mode all` unions survivors across niches, so each could independently grow toward its own MAX), protecting held/watched/`via`-tagged reserve rows and reporting every trim as `total-fetch-max` — never a silent drop. **THE LOAD-BEARING MEASUREMENT (2026-08-07, paired live A/B at 100.75m deployable, `--mode all --no-publish`; this is the table PLAN.md's Discovered anchor-correction entry points at): `--top 40` → `--top 90` took BAND 31→68 rows rated (+37, NONE lost — strictly additive) and CHURN S+ 2→10; grades 40: A-×1 B×8 C×9 D×12, at 90: A-×2 B×11 B-×7 C×17 D×30. Cost +419 ms (1,605→2,024 ms, +26%), touching no gate/price/grade/rank — only what gets CONSIDERED.** Against that, flipping `--scale-pool` on by default captured ~5% of the win (+2 rows vs +37): at a 100.75m pool, only 0.75% above `CAP_REF` 100m, √0.0075 ≈ 0.087 so the curve barely engages (TOP 40→43; reaches its 90 max at ~256m). **The conclusion is that the BASE was mis-tuned at the reference bankroll, not that scaling was missing — no capital-conditioning curve fixes a base that is wrong at its own anchor point.** Ben resolved it 2026-08-07 with knob (a): `TOP` default 40 → 90, which also makes `--scale-pool` a no-op on that pool (90 == `TOP_MAX`) while it still governs THIN_RESERVE/VALUE/AMP; `AMP_TOP_DEFAULT` stays 40. The same commit fixed the run header printing the UNSCALED `top ${TOP}` (it now prints per-niche `effTop`, e.g. `top band 90/churn 90/amplitude 40`) — the output could previously not tell you what pool actually ran. **Two corrections worth keeping:** (i) the starved population was MIS-RECORDED — Sanguinesti staff / Basilisk jaw / Webweaver bow appear in NEITHER pool (Sanguinesti left the board on its own degraded numbers between two default scans, not on admission); the real starved class is churn-class commodities, and the binding constraint on Sanguinesti was `thin-reserve-full`, never `top-n-full`. (ii) **The ranker that decides who gets fetched is not predictive of what an item scores once fetched** — the top excluded row read ~12.89m/d Stage-1 `expGpDay` proxy but +88,162/u (+0.5%), rank 140k, P(ask)~0.36 once actually fetched; do NOT read a proxy figure as forgone profit, and fixing a reserve without fixing the proxy just re-orders a queue sorted by the wrong key. Constants all PLACEHOLDER n≈0, n=1 paired run at one capital level. `--scale-pool` default-on was later ruled OUT at Ben's capital by PLAN-THIN-RESERVE. | `pipeline/lib/signal/{gatecandidates,admission}.mjs`, `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/admission.test.mjs` | ✅ chunks 1–4 `5e7e9d9` · TOP 40→90 + header fix `0763dbc` |
| VOL24 1/2/2b/3/4 | **The wiki `/24h` endpoint is unusable as a trailing-24h source; the true rolling-24h is composed from the healthy `/1h` grain** (was `plans/PLAN-VOL24.md`, folded+deleted 2026-08-14). **The ONE HOME for the CURRENT description is the `marketfetch.mjs` `loadAll24hRolling` header — read it, not this row, before quoting the endpoint's behaviour.** **Step 1** `bd3f254` added `loadAll24hRolling({db})` (whole-market, from the last 24 complete bulk `/1h?timestamp` windows, reusing the Tier-1 SQLite archive check-before-fetch) + `rolling24FromTs1h` (one item off an already-fetched 1h series → ZERO new fetch), SHADOW-only behind `--vol-source legacy|rolling`; proven EXACT vs a per-item timeseries sum, 10/10 items on both hpv and lpv. Proposal A (scale `/24h` by `24/hoursSinceUTCmidnight`) was REJECTED — its premise was false and it left ±58% scatter; a confidently-wrong number is worse than a flagged degraded one. **Step 2** `42ce665` flipped the default to `rolling` and recalibrated every volume-denominated floor. The rolling/legacy ratio was hugely dispersed (p10 7.8× · median 23.0× · p90 173×), so a flat multiplier was wrong — each floor was **COUNT-MATCHED** (the floor that admits ≈ the same item count the old floor did under legacy): `FLOOR`/`VALUE_LIQ_FLOOR` 50 → **3,500** (884 items; solved 3,652, rounded DOWN deliberately per Ben's surface-the-lane intent) · `CHURN_MIN_VOL` 2,000 → **65,000** (361) · `DIP_LOOP_LIQUID_FLOOR` 1,000 → **40,000** (438; rounded from 42,425) · `GP_FLOOR` 250m → **4,500m** (89, ~18×) · `DL4_MIN_GP_FLOW` 500k → **9m** — the ONE row with NO target count, derived by TRANSFERRING GP_FLOOR's ~18× ratio, and therefore not re-anchorable from the record (`js/quotecore.js` flags this at its own definition) · `DL4_MIN_ABS_SWING` and `MIN_GPD` deliberately UNCHANGED (`MIN_GPD` is a real NET-throughput quantity; it was later moved 500k → 250k for unrelated reasons). Combined-effect check landed BETWEEN the over-tight legacy and the flood: BAND gated 23 → 238 → **137**, CHURN 1 → 135 → **96**, dip-pool 0 → 40 → **1**; and holding FLOOR fixed while raising `MIN_GPD` 500k → 5m collapsed BAND gated 139 → 30, proving `MIN_GPD` BINDS and FLOOR is not the sole gate. **Step 2b** `69696fc` `vol24FromInputs(inp)` gave the per-item surfaces (quote/watch/book) the same correction off their in-hand 1h series — zero new fetch — and shipped the CI import-resolution guard that closes the missing-export gap this work found. **Step 3** `195c074` (0.74.0) and **Step 4** `5851e18` (0.74.2) fixed the APP half, and the honest record is that Step 3's original framing was wrong twice: the app's per-item read was never the broken endpoint, and the real defect was the Finder reading `/1h` into `STATE.VOL` and feeding it to daily-anchored scoring as `volDay` — plus an `|| it.volume` fallback substituting `hpv+lpv` for a one-sided book and a `volDay > 0` guard that disabled the grade cap for zero-volume items, which was **100% of the app's S+ grades**. Step 4 then fixed three escapes of ONE shape — **a MEASURED zero falling through guards written for MISSING data** (`ttfIntraday`'s unscaled prior, `churnLapUnits`' `Infinity` depth, and an item ABSENT from a present `/24h` map read as null); absence from a full map is a measurement of zero (0.0% of 178 absent items traded during the day that map covers, median last trade 66h old, vs 0h present), and `vol24Of(id)` in `js/market.js` is now the ONE home for measured-zero-vs-unknown. Effect: no-trade items in the top 50 29 → 10, top 100 47 → 24, `maxRank` 69.3M → 41.6M — it does NOT clear the class, six untraded items remain in the top 20 because rank is dominated by nominal `net`. **⚠ THE ENDPOINT CHANGED UNDER US — re-measured 2026-08-10/11: the fix stands, the REASON does not.** The original ~10–27× under-report is **HISTORY and now measures ~1.0×**; do not restate it in the present tense. Today BOTH variants serve complete, bit-exact UTC-DAY aggregates (bulk 3767/3767 bit-exact at offset 0; per-item matches its own labelled UTC day 30/30 but the TRUE trailing 24h only 4/30, and its `?id=` parameter is IGNORED — it returns the whole 4,152-item map). **What is broken now is STALENESS, not magnitude**: the served day closes 24–48h before the read. The fix survives on a different argument than the one that motivated it — *a fixed past UTC day cannot gate today's liquidity, whatever its internal accuracy* — and that is true of BOTH endpoints, so `vol24FromInputs` does real work ~23h/day, not the no-op an intermediate correction claimed. **Why it changed is UNKNOWN — do not invent a mechanism** (a plausible one was written down, propagated through three commits, and retracted). Two further retractions worth carrying: the "22/24 bit-identical" evidence for per-item-is-correct was measured entirely inside the 00:00–01:00 UTC hour these sessions habitually run in (**check the clock before concluding the two agree**); and the count-matched floors are unaffected NOT because they were "calibrated against the composed source" (false — they were solved on rolling but anchored to a raw-`/24h` quantity) but on direct re-check of the design targets. Do NOT re-solve any floor against today's legacy distribution — it is ≈ true volume now and was never the target the gate was built on. | `pipeline/lib/market/marketfetch.mjs`, `js/{quotecore,market,rating,flip-niches}.js/.mjs`, `pipeline/lib/signal/gatecandidates.mjs`, `pipeline/commands/{screen-flip-niches,quote-items,watch-positions,read-book}.mjs`, `pipeline/ci/check-imports.mjs`, `pipeline/test/vol24.test.mjs` | ✅ S1 `bd3f254` · S2 `42ce665` · S2b `69696fc` · S3 `195c074` (0.74.0) · S4 `5851e18` (0.74.2) |
| OUTPUT-TABLE | **SHIPPED — the console's DEFAULT estimator columns, and three doctrine rules that outlive the plan** (was `plans/PLAN-OUTPUT-TABLE.md`, folded+deleted 2026-08-14). Replaced the model-free `Quick`+`Optimistic` pair, which the operator had been reconciling BY HAND into the one number he actually posts, with `Est. buy`/`Est. sell`/`Net/u (ROI)`/`BE` as the console default — reach FOLDED INTO the price rather than caveated beside it (`EST_HEADERS` in `js/estimators/cells.mjs`; `HEADERS_EST` in `screen-flip-niches.mjs`), with the recent-3 confidence token riding IN the row and `estBuy`/`estSell`/`estConfidence` written to `suggestions.jsonl`. **The three rules that must survive this file:** (1) **`--raw` is a NON-NEGOTIABLE escape hatch, not a convenience flag** — it restores the model-free arithmetic underneath, and it exists because the estimated columns bake in diurnal/reach/forecast thresholds that were placeholders at n≈0–14; the honesty guard is that a placeholder-model number must never be the ONLY number available. (2) **BE stays model-free and is never overridden by the estimate.** (3) **Held-lot surfaces are INTENT-DIFFERENT — do NOT collapse them.** On `--positions`/`watch` the operative price is the Verdict's list-at plus `Quick` as the clear-now/CUT downside bound, which is a real held-lot decision input; `Quick` must NOT be removed there just because the discovery screen stopped showing it. That anti-goal is the one a future tidy-up would most plausibly get wrong. ⚠ The estimator itself has since been RE-CUT — read `PLAN-ESTIMATOR-POSTURE` (AC1/AC5–AC9) and `PLAN-ESTIMATOR-HONEST-SELL` (E1) for the current model; this row is the record of the COLUMN CONTRACT, not of the maths behind it. Shipped console-only by design (`screen.json` bytes identical, no `APP_VERSION` bump); the app-parity follow-up was explicitly out of scope and is tracked by `PLAN-APP-PARITY`. | `js/estimators/cells.mjs`, `js/estimators/pair.mjs`, `pipeline/commands/{screen-flip-niches,quote-items}.mjs`, `pipeline/lib/render/suggestlog.mjs` | ✅ `3b50b7b` (2026-07-13), incl. all three revisions |
| BL1–BL4 | **CLOSED NEGATIVE — nothing was built and nothing should be** (was `plans/PLAN-BOTH-LEG-ENTRY.md`, folded+deleted 2026-08-14). Proposed replacing `amplitudescreen.mjs`'s quantile-pinned entry pair (`AMP_BID_Q`/`AMP_ASK_Q` = 0.5) with a grid search maximising `EV = net(bid,ask) × joint(bid,ask)`, motivated by a live Dinh's bulwark miss where a hand-picked 12,501,000 bid tripled entry reach over the median-low bid the tool quoted. **Its own BL4 validation gate was run FIRST, before BL1, on the real archive — and failed.** Walk-forward (train 9 days, test 4 buy-days, 238 items, 1h grain): grid argmax **3.80% in-sample → 0.48% OOS** vs the shipped median pin **1.84% → 0.49%** — statistically identical out of sample, and the argmax LOSES the paired comparison (beats the median on 28/238, loses on 45, ties 165); its `joint` shrinks 0.394 → 0.079 under holdout. **This is structural, not a tuning failure:** `joint` is a step function changing only at observed extremes and `net` is monotone in both legs, so the argmax always lands exactly ON an order statistic with zero out-of-sample margin — split-half on the motivating item gave test-EV = 0 in 7 of 8 splits. Shipping it would have displayed an ~8× inflated EV while delivering nothing. **The median it set out to replace IS the robust estimator.** The plan then retracted two of its own three cited defects: the proposed same-day *extremes-ordering* tradeability test is the wrong event (it keeps 52% of both-leg days where correct first-touch-before-later-reach keeps 62%) and same-day scoping contradicts `AMP_HOLD_DAYS_DEFAULT` being a parameter at all — a **2.8× undercount** (joint 0.057 vs a strategy-correct hold-≤1d 0.161), LARGER than the ~1.6× overcount it claimed to fix; and it mischaracterised `legOk`, which never counts both-leg days at all. The motivating anchor collapses on re-measurement: the Dinh's "+533k/u" marginals give an ORDERED joint of 3/16, worth ~100k gp/day in-sample and **14–56k held out** against the attention floor — a check the first draft never ran. (The hand-picked entry WAS better than what the tool quoted; what was not real is that a search would have found it reliably.) Its third defect — `pFill2leg` as a product of marginals — was real in construction but was separately made moot by DT1/DT1b, which deleted `pFill2leg` outright in favour of the walk-forward `ampWalkForward`; that also retires this plan's one surviving cheap-fix suggestion (the full-window `fullFrac × fullFrac` fallback that was 2.3–3.5× optimistic and ≈0.25 for every item by construction). What remains is an experiment note, NOT a code or default change: a 36-cell `(bidQ, askQ)` sweep put the shipped 0.5/0.5 at rank 16/36 with the best cell at bidQ 0.7 / askQ 0.4 — weak directional support for exactly Ben's hand-picked move, but **every cell's OOS median is 0.000%**, so the differences are tail-driven on one test window and not significant; reachable through the existing `--amp-bid-q` flag. **The lesson: a median is a robust estimator; an argmax over ~870 correlated candidates on 16 days is not.** If reopened, start from a shrunk/regularised estimator evaluated out-of-sample from the beginning, never an unpenalised in-sample maximum. It also missed the one unambiguous bug in the file it was attacking — `amplitudeProxy`'s unpadded day key, which served a stale "recent-5" to Stage-1 pool selection for two-thirds of every month (fixed separately at `b7cbf64`). | none (no code shipped); `js/amplitudescreen.mjs` + `js/estimators/families.mjs` are the files it studied | ✅ CLOSED NEGATIVE `b8fc8f2` (2026-08-08; proposal `9e5a9e3`) — no code change |
| DL-0/DL-1–3 | **CLOSED NEGATIVE — a real relative signal that is not a trade** (was `plans/PLAN-DAY-LOW-SURFACING.md`, folded+deleted 2026-08-14). Ben asked for a surfacing lane over "items resting on their 1/3/7/30 day lows". First finding: **the data already exists** — `js/termstructure.mjs` `termStructure` already computes per-horizon `low`/`high`/`pctInRange` at 1/3/7/14/28d, so the missing piece was only the CROSS-HORIZON read, and the lane had to justify itself against Invest, which already buys near a multi-week low. Two data constraints: use the existing **28**, not a new 30 (28 is also `FLOOR_LOOKBACK_DAYS`, so a 30 would be a second near-identical horizon that can disagree with the durable floor for no gain); and the **1d bit is the weak one** — `termStructure` consumes daily mids bucketed from the 6h archive, ~4 points, so it is a coarse daily-mid low and must never be presented as an intraday signal. **The plan's OWN central hypothesis was REFUTED by its own blocking Chunk 0.** It argued from the repo's standing doctrine (`base-position-caution-not-credit`, the fang/update-cycle loss pattern) that `1111` — at every low at once — is a falling knife that must never rank first. Walk-forward over the 1h archive (184 items, 5,799 origins, 38 origin days, price ≥1,000gp, `pctInRange ≤ 0.15`), 7-day forward return, per-ITEM median: `1111` **+3.96%** · `1110` +1.27% · `1100` 0.00% · `1000` −0.01% · `0000` **−1.95%**. **The ordering is MONOTONE IN DEPTH-OF-LOW — the exact opposite of the prior** — and it survived de-marketing (the market FELL −0.32%/7d, so de-marketing made `1111` stronger, not weaker → not beta), per-item equal weighting, a 1,000gp price floor, and a one-day entry lag (0b: `1111` +3.96% → **+2.76%**, spread 5.91pp → 3.61pp, i.e. ~40% of the naive edge was entry-print artifact and ~60% real). **But it does not pay under EITHER execution bound.** 0c, worst execution (cross the spread twice, buy `avgHighPrice` at t+1, sell `avgLowPrice` at t+8, taxed): **net negative in every bucket** — best `1111` −2.51% per-item against a −7.01% baseline; the median round trip costs ~7% and swallows the ~2.8% mid-drift edge whole. 0d, BEST execution (both legs fill patiently, liquid population only, median `min(hv,lv)` ≥ 3,500/d): the ordering holds a FOURTH time and still doesn't pay — best bucket `1110` **+0.26% median over a 7-day hold** (de-marketed +1.15%), and true execution sits BELOW that since 0d assumes both legs fill. **The magnitude argument kills it independent of everything above:** even taking `1110` at face value and adding back a full ~1.2% of assumed market drag, ~1.4%/7d on a 40m position is ~80k gp/day (the raw +0.26% is ~15k gp/day) against the scan's **250k gp/d** attention floor — clearing it would need a ~125m single-item position, a size Invest and amplitude already serve better. Honesty bounds that both cut AGAINST the strategy: origins are daily but the hold is 7 days, so consecutive origins overlap ~6/7 and `1110`'s n=139 is roughly **20 independent windows** (the two positive buckets are the least trustworthy on the board, and `0111` at 4 items must not be quoted); the population is 42 items, not the 112 that passed the gate; and the harness built daily mids from ~24 hourly points where production `termStructure` gets ~4, so its figures must be re-measured on the production input before being quoted as production numbers. **The lesson worth keeping (CLAUDE.md rule 11):** the "liquid spreads are narrower than the 2% tax" explanation for the −1.32% baseline was stated, "REFUTED" by a test run on the WRONG population (all 112 gate-passers, median spread 2.80% > tax), and turned out to be RIGHT — the origin population's own spread is 1.82%, BELOW tax, because the 70 items that never generate origins are the wide-spread ones. **A refuting test measured against a different population than the claim is not a refuting test.** (~1pp of the residual stays unexplained and should not be attributed.) DL-1/DL-2/DL-3 were gated on 0's result and were never started. Independently re-measured 2026-08-11 by `pipeline/experiments/floor-strategy-study.mjs` under a different construction, reproducing the closure cell-for-cell. | none (no code shipped); `js/termstructure.mjs` is the primitive it studied, `pipeline/experiments/FLOOR-STRATEGY-FINDINGS.md` the independent replication | ✅ CLOSED NEGATIVE `20a45f9` (2026-08-10; scoped `03fb76e`) — no code change |
| BLINDSPOT #1–#7 | **AUDIT ONLY, no code changed** — the FALSE-NEGATIVE inventory (was `plans/PLAN-BLINDSPOT-AUDIT.md`, folded+deleted 2026-08-14). Ben asked for the inverse of the usual question: not "are our picks good" (`docs/SIGNAL-AUDIT.md`'s stale-read census covers false positives) but "what genuinely-profitable shapes are we systematically dropping or blind to". Honesty bar: mostly n≈0 hypothesis-generation off structure + ONE live scan snapshot (2026-07-24) + `analyze-record.mjs --json` over 73,493 logged suggestions — a "where to look first", never a validated backlog. **The seven ranked signatures, and where each went:** **#1 (HIGH)** a real winner never gets fetched at all, dropped by a fixed top-N/thin-reserve slot count before any pricing math runs — live, band dropped 93/134 gated candidates pre-fetch, best excluded Crimson kisten ~13.84m/d `thin-reserve-full`; churn dropped 45/86 → **scoped and shipped as the FPS row above**. **#7 (MEDIUM)** value/invest's top-25-by-`valueScore` cut had NO reserve mechanism at all where band/churn had a partial one — 104 of 129 gated candidates never got a slot → **shipped as FPS chunk 1's `VALUE_RESERVE`**. **#2 (HIGH, STILL OPEN)** a liquid FALLING big-ticket with a genuinely positive robust-band net is invisible to every discovery niche **unless already watchlisted** — that scan's watchlist section held ~15 A−/B+ falling/cooling big-tickets with clearly positive Optimistic net (Ancient godsword +623.2k P~0.50, Dragon claws +414.2k, Masori body +137.5k P~1.00, Webweaver bow +248.7k) that appear in NO band/churn/amplitude output, and amplitude's own Stage-2 footer dropped `trend 11` of 41 for exactly this shape; **the whole class depends on Ben having pre-added the item.** The sketched minimal fix is NOT to un-exclude falling (that reopens ghost-spread risk on illiquid fallers) but a console-only appendix printing candidates dropped SPECIFICALLY on `trend`/`knife` through the same `estimatePair` band math, inform-only. **#3 (MEDIUM-HIGH)** the repeatable multi-week oscillator — the fang quadrant, ~6–8d period, ~11% swing — has no niche: band is 2h, amplitude was 24h with a ~1d hold prior, invest is explicitly a ONE-SHOT buy-and-hold that never re-enters → investigated separately, see the MWO row below. **#4 (MEDIUM)** grade-vs-rank DOUBLE PENALTY: ask-reach is already multiplied into the `net × P(fill) ÷ TTF` rank, and `REACH_GRADE_CAP='B'` then caps the displayed LETTER on the identical signal — a legibility false negative (a human skims past a `B` that is genuinely top-ranked). `cappedBy` fixed cap ATTRIBUTION, not the double-application; the finding is re-homed in full as FLAW 4b in `plans/PLAN-GRADE-REWORK.md`, which is still live. **#5 (HIGH VOLUME, LOW-MEDIUM confidence)** `reach` is by far the largest reject source in the historical record — **8,009 rejects** vs the next-largest `trajectory` at 1,606 — but a high reject count is NOT evidence of over-tightness and no not-taken→would-have-filled counterfactual exists → investigated separately, see the RVA row below. **#6 (LOW — found nothing to fix)** update-cycle gear has no anticipation signal on EITHER side, and that is DELIBERATE: the operator overlays exogenous knowledge on every trend note, and grep confirms no update-calendar code exists anywhere. **Equally valuable: the five gates checked and found CORRECTLY TIGHT** — the two-sided liquidity gate (a one-sided book genuinely cannot be crossed both ways; loosening reopens a closed failure mode), the attention floor (exempts held/asked/watchlist already, and was firing on genuinely sub-scale sub-100gp commodities), Bar E's p90/p10 trim (Bar D's density gate already requires the edge to be genuinely traded before the trim applies, so a real edge survives by construction), the `ignored-items.json` quarantine (verified by grep — `screen-flip-niches.mjs` NEVER imports it, so an ignored item still fully participates in candidacy; Old school bond graded S+ live while quarantined), and value's 6%/150% cycle-amplitude band (wide enough that it rejects regime-change/noise, not real cycles — 5/129 dropped, all named legitimate knives). **What it could NOT investigate:** whether a vetoed/cut item later ran (needs a not-taken→would-have-filled join that does not exist), and whether the crowded-out items are ACTUALLY good flips as opposed to merely carrying a high pre-fetch `expGpDay` proxy — the audit establishes only that they never got the chance to be checked. | none (audit only); `docs/SIGNAL-AUDIT.md` is its false-positive companion | ✅ AUDIT DELIVERED `746da1b` (2026-07-24) — no code change |
| RVA | **SCOPING + LIVE ANALYSIS, no code changed** — is `reach` actually costing us anything? (was `plans/PLAN-REACH-VALIDATOR-AUDIT.md`, folded+deleted 2026-08-14; it investigates blindspot finding #5). **It corrects the blindspot audit's own premise, and that correction is the headline.** The audit had said "`reach` gates on band+churn, informs elsewhere". False: reading `js/flip-niches.mjs` directly, EVERY spec — band, churn, scalp, value, amplitude — declares `{ key: 'reach', mode: 'inform' }`, and `git log -S"key: 'reach', mode: 'gate'"` over that file's whole history returns **zero commits**. Confirmed against `suggestions.jsonl` (74,735 rows): inform-mode reach produced 8,081 rejects and 14,514 cautions, gate-mode just **37 rejects and 192 cautions** — and those 37 came from a `null`-mode quote/positions surface, not a discovery screen. **So 99.5% of the 8,118 rejects the blindspot audit flagged never removed a suggestion from any screen output** (a sampled `status:'reject', mode:'inform'` row is still in the ledger with a passing `verdict:'A-'`). `reach` is a SHADOW validator by deliberate rollout choice — the F1 instrumentation it was built to be, not a live filter. **Answer to "are we dropping real winners because of `reach` today": essentially no.** (Still true as of the fold — every registry cell is `inform`.) **⚠ THIS ANSWERS ONE OF TWO AXES — read `plans/PLAN-REACH-CALIBRATION.md` before working on `reach`.** That plan is still LIVE and investigates the OTHER axis: whether the underlying 1h-average-based reach CHECK correctly measures an achievable price for a small resting order at all. This row answers only whether the reject VOLUME represents real, current lost opportunity (it does not — the validator is inform-mode everywhere). A clean answer here is NOT a clean bill of health for the estimator; the two questions are independent and the deleted audit doc's standing instruction was to read both. **The calibration question is separate and DID get real evidence for the first time.** The counterfactual join the blindspot audit called unbuildable became buildable when the 1h archive grew from 189 buckets to 1.1M rows / 44 days, overlapping the suggestions range. A read-only forward-reach join (~3,700 of the 7,402 reach-reject rows whose 8h window had fully elapsed, level parsed from each row's own logged reason string, checked against `archive.seriesFor`) found: **rejects forward-reached 31.3%** (genuine `frac=0` subset 29.8%, RC1 stale-optimistic-bump subset 34.1%) vs **cautions 39.2%**. The ordinal ranking is sane — the signal is not backwards — **but ~1 in 3 "reject" calls would have been wrong in the very next window**, which is a nontrivial false-reject rate if `reach` ever graduates to gate as defined. Also worth carrying: `reachValidator`'s reject line is `frac <= 0`, a definitional not marginal signal, yet **34% of rejects are not genuine zeros** — they are RC1 stale bumps where the level WAS reached historically (up to ~43% of nights) but the recent 3-night sample shows 0 hits; a bump off a 3-night sample is a much thinner basis than the "reject" label suggests, and the two subsets' forward-hit rates barely differ, which is mild evidence the bump is neither miscalibrated nor clearly justified as a separate harsher signal. **Honesty limits:** a single uniform 8h window was applied even to value/amplitude rows that really use 24h (approximated, not exact), and it tests only "did price touch the level", never "would OUR order size have filled there". **NOT BUILT, and the recommended shape if it ever is:** a committed `reach-outcomes` module fed by STRUCTURED `level`/`side`/`windowHours` fields on the validator entry rather than string-parsing the reason prose, per-niche window lengths, feeding `deriveCandidates` as a genuine `kind:'candidate'` — a natural F1/AC1-style chunk, not a new plan program. **No urgency**: since `reach` gates nothing live there is no active harm; the value is having the instrument ready BEFORE a `reach: gate` graduation is proposed, so that decision rests on forward-hit evidence rather than the historical-window frac alone. | none (analysis only); `js/validate.mjs`, `js/flip-niches.mjs`, `pipeline/lib/market/archive.mjs` are what it read | ✅ ANALYSIS DELIVERED `5e7e9d9` (2026-07-24) — no code change |
| MWO | **SCOPING ONLY, no code changed** — the "repeats every ~6–8 days" fang-class taxonomy hole (was `plans/PLAN-MULTIWEEK-OSCILLATOR.md`, folded+deleted 2026-08-14; it investigates blindspot finding #3). **Headline: the ask was ALREADY SUBSTANTIALLY BUILT, and the blindspot audit missed it for a process reason worth remembering** — the six-chunk `PLAN-OSCILLATION-CYCLE` program plus F-A/F-B/F-D/F-G had already landed detection (`oscillationVsKnife` in `js/forecast.mjs` — detrend daily mids, walk residuals into same-direction legs, call OSCILLATING at ≥`OSC_MIN_LEGS`), a direction-agnostic drift-adjusted margin gate (`amplitudeGate`'s `driftAdjustedPeak` → `margin-below-floor`, pinned against BOTH a fang down-leg and an Aldarium rising-floor mirage fixture), a discoverability fix (F-B's `watchlist.json` fetch reserve so a named oscillator bypasses the Stage-1 proxy floor; F-D widened `AMP_TOP_DEFAULT` 25→40), a RE-ENTRY rather than close-out loop (`watch-positions.mjs --cycle` persists an expected trough/peak in `cycle-watch.json`, ticks a `trackError()` comparator and re-arms after a leg — literally the `multi-week-oscillator-class` memory's ask), and F-G's real-fill retro. **The auditor could not find any of it because that per-topic plan had never folded into `PLAN.md`** — which is the argument for this fold pass. What genuinely was NOT built: a niche of its own with a ~week hold horizon; it lives as a temper inside the amplitude lane, framed around `AMP_HOLD_DAYS`. **THE ONE REAL FINDING, and it has since been fully explained.** Running `oscillationVsKnife` over 24-day trailing windows for 23 UNRELATED big-tickets — the first broad uncorrelated basket, possible only because the D0 archive had grown to 44 days past the wiki endpoint's ~15–16d ceiling — returned **OSCILLATING on 22 of 23 (96%)**, only Twisted bow reading KNIFE. Read honestly at the time: not confirmation the fang class generalizes, but evidence the detector **does not discriminate** a rare repeatable ~week-period item from ordinary big-ticket wobble — it was answering "is this non-monotone" (almost everything) rather than "does this have a real 6–8 day period", since it reports legs/amplitude/slope but never leg LENGTH or period regularity. **MECHANISM FOUND 2026-08-11:** `OSC_MIN_LEGS` is an ABSOLUTE leg count over a variable-length window with NO normalisation, so the label tracks SERIES LENGTH, not shape — 59.5% OSC at 14d → 88.9% at 21d → **99.9% at 60d** on the real archive, and ~66% → ~100% by 30d on a synthetic DRIFTLESS RANDOM WALK with no cycle in the generating process at all. The 22-of-23 is that artifact. **This is a live trap:** `renderAmplitudeMode` already has a deeper archive open in the same function, so feeding the detector a longer series is a ONE-LINE change that takes it to ~100% OSC and SILENTLY DELETES the Chunk-3B knife temper's discriminating power — no error, no test failure, the gate just stops rejecting. **If you widen the window you MUST first normalise the criterion** (legs per unit time, or a period-regularity / repeated-level-traversal test); that warning is pinned in `oscillationVsKnife`'s own header. And a selective criterion WAS then built and measured (repeated traversals of the same two levels + leg-regularity, firing on 26.2% of item-origins vs the detector's 98.4%) — **conditioning on it bought NOTHING**, the amplitude-matched persistence lift came out 0.70–0.83, i.e. it ANTI-selects, so a metric refinement alone does not unlock a lane. **⚠ The fang-class question itself remains UNMEASURED, not refuted** — that study had zero big-ticket coverage. **Verdicts:** don't build a new niche from scratch; a period detector, if ever pursued, needs AUTOCORRELATION on daily mids (a genuine peak at lag ≈6–8 above the lag-1 noise floor, plus its harmonics) over ≥3 full periods, not leg-counting — **which is a concrete data floor, not a vague preference: ≥3 periods of a 6–8d cycle means ≥18–24 days of daily mids, and that is exactly why this is newly possible.** The live wiki endpoint caps at ~15–16d and could never have supported the test (`OSC_DETECTOR_NIGHTS`'s own comment flagged that cap as a known unaddressed limitation); the D0 archive at 44 days clears it. Anyone picking this up should check the archive's depth FIRST — a detector run on under ~18 days of history cannot distinguish a real 6–8d period from noise no matter how it is written; and the real next step is to let F-G's amplitude retro accrue real closed cycles (n=0) rather than doing model work ahead of its own evidence gate. | none (scoping only); `js/forecast.mjs`, `js/amplitudescreen.mjs`, `pipeline/experiments/RANGE-PERSISTENCE-FINDINGS.md` | ✅ SCOPING DELIVERED `5e7e9d9` (2026-07-24) · mechanism found `2d3b21f` (2026-08-11) — no code change |
| CV1–CV14 | **REVIEW FINDINGS, read-only** — per-item validation of the dead-export cleanup batch before it was executed (was `plans/PLAN-CLEANUP-VALIDATION.md`, folded+deleted 2026-08-14). Every verdict was reconstructed from source + `git log -S` + the live import graph rather than accepted from the dispositions as given, against an A (one path is better-designed — wire it) / B (deliberate scaffolding pending a named gate — keep + tag) / C (orphaned remnant — delete) framework. **9 of 14 confirmed outright; the value is the FIVE it caught.** **#4 `alertCount` — proposed DELETE, OVERTURNED to WIRE:** `js/watch.js` duplicated its exact expression INLINE while `watchcore.js`'s own header declared it the ONE alert count that must "never diverge" — deleting it would have removed a fixture-pinned contract and LEFT the duplication in place. **#9 `STATUS` — proposed TAG, OVERTURNED to DELETE:** dead since the commit that created it; validate.mjs uses the bare `'pass'|'caution'|'reject'` literals ~30× internally and its own header documents the STRINGS as the contract, so tagging would have enshrined a vocabulary its own author never adopted. **#11 the probe framework — the key question's PREMISE was FALSE:** the shipped `@test-only` marker on `collectNeeds` claimed "the probe-orchestration framework is not yet wired into a production surface", but screen and quote both drive it every pass with four live probes and thousands of real firings in the logs (dip.log ~3.5k lines, anchor.log ~12k). Only `collectNeeds`' active pre-fetch contract is unconsumed. **A marker stating a false reason is exactly the rot the review exists to catch.** **#10 `STAGES` — not dead at all**, it validates every loaded probe's declared stage internally. **#2 `selectNominations` — DELETE confirmed, but with a real capability loss named:** `reconcileDipPool` superseded it with a DIFFERENT write model (upsert + re-score + age-out + per-track top-N, built precisely because the append-only model caused a 640-entry bloat), so delegating back to it would REINTRODUCE the bug class — but the legacy NAME-dedup goes with it, and the fix belongs in `reconcileDipPool`, not in keeping the old function. Two passing notes: the N1 delete cluster reaches into app-imported `js/estimators.mjs`, so the batch's "node-only ⇒ no APP_VERSION" line was slightly too broad (still behaviour-neutral, but the executor is editing an app-served file). **All dispositions were subsequently EXECUTED** — verified at fold time: `alertCount` is imported and called in `js/watch.js` with the never-re-inline comment beside it, and `STATUS`/`selectNominations`/`briefBook`/`supportLevels`/the rising cluster are all gone. Honesty note from the review itself: the confidence ratings are judgment over a static read of a ~4-day-old subsystem, strongest where the evidence was a verbatim duplicated expression (#4) or live firing logs (#11), weakest where intent was inferred from comments written by the same sessions that produced the drift. | none directly (review only); executed by `219192d` across `js/{watch,watchcore,validate,quotecore,estimators}.js/.mjs`, `pipeline/lib/{levels,limits,modules}.mjs` | ✅ REVIEW DELIVERED `19c3682` (2026-07-14) · dispositions EXECUTED `219192d` |
| RDP 1–3 (4 declined) | **NARROW removal of the depth/pressure reads** (was `plans/PLAN-REMOVE-DEPTH-PRESSURE-READS.md`, folded+deleted 2026-08-14). Ben's framing: *"remove reads and fixtures and note their removal in a standalone commit, we can revive them later if needed"* — **no archive-in-place; git history IS the revival path**, and every removal site says so in-tree ("git-revivable"). **The plan's real work was the CONSUMER INVENTORY, and it corrected a stale doc claim that would have caused a bad delete:** `docs/SIGNAL-AUDIT.md` §36 and PLAN-SIGNAL-RECENCY R8 both described `clearableAsk`/`reachableBand` as "inspector-only" when they had had LIVE shadow-log consumers since 2026-07-15. **Chunks 1–2 removed the CLEAN-CUT four** — `depthDays` (DE1 per-day flow-beyond table), `clearableBid` (DE6 low-side mirror, and its `--depth` "CATCH AT ≥X" block; the "BOOK AT ≤X" ask side stays), `hourlyPressure` and `demandRegime` (the Extension-B per-hour demand cycle, incl. the `--pressure` DC2 block, screen's DC3 `demReg` inform note and its `suggestlog` shadow field). `clearableLevel`'s ASK-side branch was deliberately left intact — it is still `clearableAsk`'s engine. Historical `suggestions.jsonl` rows keep their `demandRegime` field (append-only, YS2). **Chunk 3** was the doc reconciliation, and the plan flagged it as LOAD-BEARING for a specific reason: skip it and the next reader repeats the wrong "clearableAsk is dead" assumption and deletes a live shadow — the exact failure the plan existed to prevent. **CHUNK 4 (broad) was DECLINED by Ben and must not be done as cleanup.** It would have removed `clearableAsk`/`reachableBand`/`demandPressure`/`PRESSURE_*` — but those are not inert reads: `reachableBand` powers the PRESSURE sell-model (`--est-sell pressure`/`--pressure-exit` across three commands, and it reranks the console scan) and is the **SOLE marker** `join-outcomes.mjs` uses (`coLog: best.reachable != null`) to gate the weekly Gate-B reachability head-to-head the `/morning` skill reads, while `clearableAsk` is a live `depthExit` shadow on quote `--positions`, every watch held lot, `emit.mjs`'s `depthReachClause` and the suggestions ledger. **Deleting them would be a FEATURE REGRESSION and would zero a dashboard mid-flight, not a dead-read cleanup** — their retirement already has an intended mechanism, `PLAN-REACHABILITY-CONSOLIDATION` RC1's retire flag, gated on head-to-head accrual. (Since then `join-depth-outcomes.mjs` measured `clearableAsk` against realized sells and found it does not beat its own null baseline — evidence for that gated retirement path, still not a reason to hand-delete it here.) Executed as one commit rather than the planned three single-concern commits. | `js/windowread.mjs`, `pipeline/commands/{read-window-range,screen-flip-niches}.mjs`, `pipeline/lib/render/suggestlog.mjs`, `docs/SIGNAL-AUDIT.md`, `pipeline/test/{windowread,suggestlog}.test.mjs` | ✅ chunks 1–3 `fce5974` (2026-07-22) — **chunk 4 DECLINED; the gated retirement path later FIRED for the ASK leg (see the REACH-SURFACE row below)** |
| REACH-SURFACE 0–4, 8 (5 cancelled; 6/7/9 unscheduled) | **The reach surface `p(ask,H)` — built, measured, demoted to a DESCRIPTION layer, and the one retirement it licensed executed** (was `plans/PLAN-REACH-SURFACE.md`, folded+deleted 2026-08-30; full text `git show bdea911:plans/PLAN-REACH-SURFACE.md`). Successor to PLAN-REACHABILITY-CONSOLIDATION, whose scorer could not rank (reach and gap are both monotone in the ask). **Chunks 0–3 built the machinery**: `js/forward-reach.mjs` re-home (0), `js/reach-surface.mjs` — the per-item empirical surface, z-normalized levels, uniform 1h instrument, no look-ahead (1), `js/exit-ev.mjs` — the EV inversions `askStar`/`horizonForAsk` (2), `read-exit-surface.mjs` — the inspector that priced off it (3). Chunk 1's measurement overturned the plan's own premise (per-item curves LOSE to the pooled curve out of sample — the value is the NORMALIZATION; §1b) and chunk 2's §1c gate ruled `pTarget` must never pick a price. **Chunk 4 (`join-exit-ev.mjs`) was the decisive backtest and THE PRE-REGISTERED NULL BRANCH FIRED**: against realized net gp `askStar` loses to the deployed incumbents with an item-clustered CI clear of zero at every sensitivity, on both arms, in both era halves; the top two incumbents (`asym`, `reachFold`) are statistically TIED; a specialist read found `askStar+fold` behind in every declared bucket, losing most where it disagrees most with the quantile rule. So **chunk 5 (the `curve` sell-model default swap) is CANCELLED** — its spec is preserved in the folded plan, to be revived unchanged only if a future variant beats the incumbents under the same pre-registered criterion. **Chunk 8 EXECUTED 2026-08-30 (this fold's commit)**: a fresh run nominated exactly `pressure` (ASK leg; deficit vs `asym` clear of zero, 3/3 horizons, no era flip) and the retirement was carried out — the PB4 pressure sell model deleted, its trial flags now error, the app's trial pressure column + the screen.json per-row `reachable` band removed, the `reachable.ask` co-log stopped (bid/band record continues; historical rows verified still parsing through `reachability.mjs`'s HISTORICAL `pressure` key over the full ~32.6k-row ledger). `reachFold`'s nomination stays BLOCKED — its deficit is smaller than the reconstruction resolution floor, the load-bearing guard chunk 4 added when the criterion tried to nominate the shipped default: **nothing may be retired on a gap narrower than the noise in the instrument that measured it** (now pinned in `join-exit-ev.mjs`'s header, with the z=0 exact-equality artifact re-homed there too). `depth` stays BLOCKED (reconstruction UNBOUNDED — zero acceptance rows). **Chunks 6 (guards/flavor line), 7 (pooled fallback surfaces) and 9 (clock-hour hazard, Option D) are UNSCHEDULED, not merely unbuilt**: chunk 4 demoted the surface to description, and the plan's own record names the ONE-STEP LADDER (Option E — relist a half-dispersion lower on a miss; measured to lift every contender, most the high-askers) as the live lead. Revival pointers: 6/7 specs in the folded plan §5 (both only matter if a surface variant is ever revived for pricing); 9 sits behind its own ~5pp falsifier check, also in §5. CLAUDE.md's ask→command rows for `read-exit-surface.mjs` / `join-exit-ev.mjs` remain the operating pointers. | `js/{forward-reach,reach-surface,exit-ev}.mjs`, `pipeline/commands/{read-exit-surface,join-exit-ev}.mjs` + (chunk 8) `js/estimators/sell-models/*`, `js/{ui.js,estimators.mjs,windowread.mjs}`, `styles.css`, `pipeline/commands/{quote-items,screen-flip-niches,watch-positions,join-reach-outcomes,join-depth-outcomes}.mjs`, `pipeline/lib/render/{suggestlog,emit,render,reachability}.mjs`, `pipeline/ci/lint-docs.mjs`, docs + `/scan`+`/positions` skills | ✅ 0–1 `88f7df7` (+ suite clock fix `27dd25d`, §1b measurement `dcf26d4`) · 2 `18e53c5` · 3 `e927dd4` · 4 `1cfc5ea` (+ corrections `d0a698a`, `d09ede3`) · **5 CANCELLED by the null branch · 8 EXECUTED 2026-08-30 (0.76.0, this fold's commit) · 6/7/9 UNSCHEDULED** |

---

## Open chunk specs

### F1 — Algorithm feedback loop (INVESTIGATION done 2026-07-17; CALIBRATION ungraduated, pending Ben)

The payoff of O1. Fill-probability/fill-time curves by band-percentile × item class →
replace `patientTargets`' fixed 20th/80th percentiles with class-conditional choices;
observed time-to-fill replaces `Exp gp/d`'s cycle-time assumptions; realized-vs-suggested
calibration report (the O1 suggestion join makes it a query). Known confound: regime mix —
bucket outcomes by regime label before believing any curve.

**Gate cleared numerically 2026-07-17: 5/5 cells at n≥30** (was "currently 1"). The
INVESTIGATION half is done — `pipeline/commands/f1-calibrate.mjs` (read-only over
`outcomes.json`; test `pipeline/test/f1-calibrate.test.mjs`). Honest findings:
- **The gate IS computed correctly per its own spec.** `join-outcomes.mjs`'s F1-gate line keys
  on (side × pctBucket × class × **regime**), and all 5 cleared cells are sourced 100% from
  reconstructed `stateAtFill.regime` — **0 from the `'noreg'` fallback**. Regime is genuinely a
  bucketing dimension, not just labeled. (Minor: the `--report` 2D table's "cells clearing the F1
  floor" side-totals line is regime-COLLAPSED and prints a DIFFERENT count (2+2) than the real
  4D gate (5) — display-only, the gate verdict line itself is right.)
- **But the 5 cells are lopsided: 4 flat + 1 rising + 0 falling.** The confound is controlled only
  within `flat`. The lone `rising` cell (`buy|0-20|mid`, n=31, barely over the floor) is **68% one
  item (Abyssal bludgeon)** — not broad evidence. The 4 flat cells are healthier (28–36% top item,
  12–19 items each) but still one-tool/one-trader/months-not-years.
- **Directional proposals (trustworthy):** thin buys UNDER-fill at the 0.20 percentile (P≈41% vs
  mid/liquid ≈72–75%) → thin needs a shallower percentile; sell 0.80 is well-placed (P≈94–100% all
  classes); `TTF_INTRADAY_PRIOR_SEC` (12h) is ~10–100× too slow (realized intraday first-fill 7–27m,
  round-trip hold median 0.9h). **Not trustworthy at magnitude:** precise per-class percentiles
  (placements cluster at one band bucket per side), `PFILL_PRIOR`/`DEPTH_SLOPE` (proxy-based, weak n),
  `TTF_REF_VOL` (volDay bimodal, sqrt scaling too steep), `TTF_MULTIDAY_PRIOR_SEC` (UNTESTABLE — max
  observed hold 23.5h, no multi-day lots), `PFILL_BREAKDOWN_PENALTY`/`ASKREACH_FLOOR` (n<floor).

**CALIBRATION remains a separate, ungraduated decision — F1/Ben OWN the actual constant changes**
(the "analyze surfaces with n; F1/Ben calibrate" boundary). Do NOT mark F1 done as if the algorithm
change shipped — no live constant in `trendcore.js`/`families.mjs` has moved. Recommend accruing
falling/rising regime coverage before graduating any single magnitude; more lots at ~20/day.

### DL3 — flush-distribution → candidate discovery feeding the thesis layer (n-gated on DL2's log)

Consumes DL2's **widened flush log** (every flush SIGNAL — liquid `alerted` AND illiquid `signal-only`
— with per-row depth/price/volDay/dipScore + `alerted`/`gatedReason`, joinable to `fills.json`). Builds a
**per-item flush profile**: each item's OWN depth/frequency signature (a bludgeon's differs from a rune's) —
p25/p50 flush price, flush frequency/cadence, floor-stability. DL2's log schema is a complete enough input
(per-item flush price/depth/frequency is reconstructable from the rows).

NOT a standalone illiquid-bid report — it is a candidate-**DISCOVERY** source that feeds the EXISTING
machinery two ways: **(a)** auto-feeds the DL2 `dip-watchlist.json` pool (closes the discovery loop — the
"B feeds A" screen/flush-history → curated-pool path); **(b)** surfaces an item into the relevant niche via
the declarative `js/flip-niches.mjs` spec pattern (a predictably-deep recurring flusher is a standing-bid /
value candidate the theses put forward, with the flush profile as supporting evidence). It integrates with
`flip-niches.mjs`, not a separate silo.

Output = a suggested **RESTING-BID level + expected fill cadence** per illiquid item, where the bid
PERCENTILE is **NOT a fixed p25** — it is a TUNABLE parameter CONDITIONED on item features (price × liquidity
× floor-stability), per-item or per-item-class: shallower (→median) fills more/less discount; deeper (p10–p25)
better price / misses more; the optimum is item-dependent (cheap + hyperliquid + frequent-shallow → nearer
median, favoring fill-rate/velocity; expensive + illiquid + rare-deep → deeper, few shots so make them count,
safe IF the floor is stable; unstable floor → more conservative/deeper).

**Calibration routes THROUGH F1 (the encoding boundary):** DL3's `analyze.mjs` retro-join (flush-log ↔
`fills.json`) FITS percentile-as-a-function-of-(price, liquidity, stability) optimizing fill-rate × edge, but
`analyze.mjs` only **SURFACES** that fit as an n-gated CANDIDATE with evidence — **F1/Ben OWN the actual
calibration**, exactly like DL2's thresholds (analyze surfaces with n; F1 calibrates; no constant analyze
writes). Placeholder p25 default until the data speaks, NO hardcoded constant, same log-everything /
fit-from-data discipline as DL2. Depends on DL2's widened log having accrued enough history (n-gated like F1).

---

## Pipeline v2 — open chunk specs (folded from the 2026-07-08 planning round; ACTIVE)

**Problem.** The pipeline "fights itself": scripts disagree on the same item, judgment lives as
prose in skills, and a verdict is treated as a property of the item alone when it is really
**(item × the strategy thesis you entered under)** — anchor incident: the Hydra leather buy
(13.5m mid-decay, NOT the multi-week floor; no script ran the reach/floor checks that were prose
in `/scan`), then whiplash hold/cut advice from the `quote.mjs`-vs-`watch.mjs` verdict fork.
Three roots, three fixes: different fetch instants → the Snapshot layer (D0); forked verdict
logic → the Context chain + one judgment home in `js/` (P0/P4); per-surface gate differences →
shared validators on every surface (P2/P3).

**Ben's rulings (2026-07-08):** falling-exclusion doctrine AMENDED (falling ≠ auto-bad; needs
history/typical-fluctuation review; no CANCEL-BID off falling regime alone for a deliberate
thesis — memory `falling-exclusion-amended`); evidence-based viability, not hand weights; ONE
verdict home (`js/`); declarative strategy specs; every single-item analysis runs validation;
encode-in-scripts wherever mechanical; SQLite archive may grow ~100GB; app work DEFERRED (Ben
isn't using it; stale tabs may be archived) — no APP_VERSION bumps in this wave.

**Ben's rulings (2026-07-09) — ENCODED at P6a/P6b, kept here only as pointers:** the TTF ruling
(every suggestion carries a data-justified Time-to-Flip; shared time-analysis layer; missed
deadline = adaptation trigger; ground truth = retro-join latency, never touch-proxies) and the
ranking ruling ("I despise gp/d…" → rank = net after tax × P(fill at the quoted pair) ÷ TTF,
per thesis; the price-basis principle: ONE pair per suggestion, all three factors evaluated at
it) live in `pipeline/lib/estimators.mjs`'s header + the `6c3f1b5`/`a21f1bc` commit messages;
`pipeline/commands/report-retro.mjs` is the calibrator. Archive-gap note (verified 2026-07-09): whole-market
daily/1h history is server-backfillable (`loadDaily`'s `?timestamp=` reaches past windows;
per-item `/timeseries?timestep=1h` ~15d) — the local SQLite archive is an accelerator + the only
home for sub-hour history, not the source of truth the TTF work depends on.

### Architecture

```
Snapshot (D0) ─▶ Surface ─▶ Context chain ─▶ VALIDATE ─▶ PATH ENGINE ─▶ Render (per-script)
```

- **Data tiers:** Tier 0 = live bulk (`/latest`,`/24h`, 3–4 fetches/tick total; all surfacing
  gates). Tier 1 = the SQLite archive (`node:sqlite`, verified Node v22.16; thin
  `pipeline/lib/archive.mjs` wrapper) — each run appends the bulk `/1h` AND `/5m` snapshots;
  bulk `/5m` accrual is the only route to broad intraday history (API serves ~30h/item) and
  feeds P6's backtests. Tier 2 = per-item timeseries, budgeted to the fetch pool (existing
  `rankAndSlice` TOP + `fetchTsCached`).
- **No duplicates by construction:** archive ONLY bucketed endpoints (API-supplied bucket ts;
  never `/latest`); PK `(grain, ts, itemId)` + `INSERT OR IGNORE`; check bucket-already-stored
  BEFORE fetching. WAL + busy_timeout for concurrent writers.
- **No-blowup rules:** store only raw observations; EVERYTHING derived (regime, phase, term
  structure, bands, validator results, path scores) is recomputed by pure functions — never
  cached. Append forever (~30–35GB/yr, Ben-approved); `--prune-before` utility ships unused.
- **Context chain:** one `ItemContext` via staged pure enrichers, each owning a namespace,
  nulls degrade downstream (the momVerdict optional-degradation precedent):
  identity → market (Tier 0 row) → history (Tier 1: term structure/phase/fluctuation/window) →
  intraday (Tier 2: ts5m/bands/reach) → position (lot, BE, offers.json, watch-state, thesis/path)
  → validate → paths → render. Scripts = slices of the chain + a renderer.
- **Validate:** registry of pure validators `(ctx) → {status: pass|caution|reject, reason,
  evidence}` in `js/validate.mjs`, run on EVERY surface. Reject semantics (default, Ben-vetoable):
  screens DROP reject (counted in `--stats`) and FLAG caution; explicit asks/held/watchlist are
  NEVER hidden — full results printed.
- **Path engine (`js/held-item-strategy.mjs`):** Path = `{key, thesis, action∈BUY/HOLD/LIST/CUT/AVOID, levels,
  tripwire, horizon, economics, viability, evidence}`; `enumeratePaths` + `weighPaths`; headline
  dominant + weighed alternatives (alternatives are decision support, NEVER alert inputs);
  `enteredUnder` tracked; MIGRATION flag when dominant ≠ enteredUnder. Dominance/migration are
  persistence-gated (convictionGate arm-then-confirm + a hysteresis margin) — no path-level
  whiplash. Single-alert / V5 EMIT / Gate-2-CUT-exempt contracts preserved verbatim.
- **offerVerdict layering:** stays a small placement primitive ("is this bid valid under ITS
  path?"). A resting bid IS a position → the path engine runs on bids; **CANCEL-BID becomes
  emergent** (no enumerated path validates the capital); falling→CANCEL-BID survives only as the
  path-less default.
- **Strategy = declarative spec** (`js/flip-niches.mjs`): scripts iterate the registry, never name
  niches. Four module kinds with registries + a CONFORMANCE suite (every registered
  validator/path/spec auto-run against the shared archetype fixtures — decay-knife, genuine dip,
  stable band, thin big ticket, falling wide-band; contract shape + no-throw + determinism, or CI
  fails): validators, paths, specs, probes (PM1 — stays output-only, never a gate).
- **Quarantine (`ignored-items.json`) unchanged:** it solves intent-not-in-the-log, which
  validators can't; its v2 home is the position stage (filters merch VIEWS only — archive stores
  the whole market, screens may surface ignored items, pricing on asks ungated). P6 enhancement:
  greenlist entries gain an optional suggestion-emit pointer.
- **Encoding boundary:** encode everything mechanical-given-data; judgment stays for novel events
  / taste / placeholder-era thresholds; the split is "scripts compute the weighed menu with
  evidence; Ben picks". Skills improvement loop: fixture-first; prose only with a `judgment:` tag;
  pointers not copies; enforced by `pipeline/ci/lint-skills.mjs` (P7) + a wave-start drift audit of
  the `judgment:` inventory.

### Chunks (each carries its own reconciling docs pass + README inventory in the same commit)

**D0, P0–P6c, P7 — SHIPPED.** Specs pruned per the fold-out discipline; shas in Status,
full spec text via `git show 4753e44:PLAN.md` (the last revision before this compaction), and
each chunk's landing commit message is the authoritative "what shipped" record. P7's lone RETIRE
disposition (`docs/SKILL-TRIAGE.md` had exactly 1, not 3) is now executed (`f8de508`, Ben
2026-07-09) — no P7 leftovers.

- **P8 — Desk orchestrator (after P0–P5 harden).** `pipeline/desk.mjs`: cold start → sync-fills
  → snapshot → positions review → weighed action menu → drives the watch loop (the `/loop`
  target). One process owns cadence + appends (serialized writers by construction) but
  `archive.mjs` keeps WAL safety for ad-hoc runs. FUTURE (out of scope): time-of-day/history
  cold-start suggestions (`--posture auto` + windowread are the ingredients).

### watch.mjs under v2 (contract, load-bearing)

Output contract unchanged (headline alerts → numbers table → per-item notes → footer; V5
always-emit sell/list-at+BE; V6 advisories stay support). Each tick = one `loadSnapshot()`
(+archive append — the running loop passively accrues P6's data); held notes show
entered-under/dominant/alternatives; migration is a NOTE until it survives persistMs; bid rows
get path-relative feedback. The `/loop` pattern, daemon zero-git rule, heartbeat, and
`quote.mjs --positions` as the booked-lots view all stand.

### Honesty (rule 4)

Validator thresholds ship as named placeholders; viability is evidence-scored with printed
sample sizes and a fallback when n is small; scalp is the hardest niche (adverse selection on
the knife) — provisional + off-by-default until P6 evidence says otherwise.

---

## Other unscheduled notes

- **Flow diet — winners-only surfaces, stale-bid flagging, reclaimable capital (FD1–FD6,
  ACTIVE)** (`plans/PLAN-FLOW-DIET.md`, Ben 2026-09-03). **FD1 ✅ `d3bc21c`** (winners-only
  `--verbose` render — stanza families cache-only behind a pointer line, `--full` debug
  restore, cache identical across modes; the positive-net row filter ships with the
  held/watchlist exemption and is unreachable by construction on band/churn/scalp — the ~50%
  stdout cut is the stanza diet) + **FD2 ✅ `e41db14`** (skills + doctrine homes reconciled;
  judgment reads `last-report/screen.json`), both through 3 adversarial review rounds
  (CHANGELOG pipeline 1.4.0). FD3–FD6 (offer `placedTs` → declared-deep bids + inform-only
  stale-bid flag → bids on the positions surface → shown reclaimable-stale capital line)
  staged behind them. Ruling: NO grade term in any filter predicate (grade tuning is later,
  F1-tagged work); the still-large winners table (a rank-based cap?) is an OPEN question for
  Ben, recorded in the plan.

- **Hybrid-review experiment — wave 1 RUN (2026-08-30), accrual open** (`plans/PLAN-HYBRID-REVIEW.md`,
  Ben 2026-08-29). Both arms ran blind on the forward-record honesty wave's diff; results + scored
  predictions live under the plan's dated Results heading. Headline: the blind-spot branch fired
  BOTH directions (B missed cross-file prose findings A caught; A measured as clean a live-data
  defect B fixture-caught), so any adopted hybrid keeps a broad agent AND the verify stage. n=1 —
  no adoption call; the decision rule wants 2–3 waves. NEXT wave's review round: run wave 2 per the
  plan (finder cap 8 this time; aim finders at code seams, not doc claims).

- **Verdict-layer temporal memory (V1–V6) — DONE, `PLAN-VERDICT.md` folded + deleted.** Cross-pass
  memory, conviction gating, standard emit contract, advisory recovery-read + capital companion —
  all OUTSIDE pure `momVerdict`/`offerVerdict` (only V3's optional `lotCtx` touched it, no-op when
  omitted). Shas in Status. Documented follow-on (NOT built): app Watch-tab adoption of the same
  context lines.
- **Screen pre-filter heuristic from a pattern study:** the niche screens do a blind
  fetch-and-check (esp. `rising`: ~30 of 40 top candidates discarded after the expensive
  per-item confirm). Study: dump cheap 24h/band features + survive/discard labels for a
  100–200-item sample; if a clean predictor separates, use it as a pre-rank filter.
  Belongs with rating-cutoff calibration (both need the same validation data).
- **Per-item "recommend price adjustment" button** (Trends): deferred; T2's 2h readout is
  a step toward it, F1's calibration is the real enabler.
- **Annotated price-path chart — `pipeline/chart.mjs` + app Trends overlay (Ben, 2026-07-10 — "extremely useful in our app").**
  Encode the on-demand annotated chart prototyped this session (the Searing-page artifact:
  90d reprice context + 15d hourly with actionable levels + diurnal hour-of-day profile) into a
  reusable capability. Two deliverables, shared plumbing:
  1. **CLI** `node pipeline/chart.mjs "<item or id>"` → emits a self-contained annotated HTML
     (or SVG) so any desk decision gets a picture without hand-building it — same fewer-scripts-
     on-the-fly rationale as `limits.mjs`/`quote.mjs`. Data via the shared `fetchTs`/`fetchLatest`
     (`marketfetch.mjs`); annotations (buy/break-even/ask rungs, dip/peak windows) reuse
     `computeQuote` + `windowread.mjs`'s `hourProfile`/`deriveDiurnalRange` so the levels are
     byte-identical to the tables.
  2. **App Trends tab** — the higher-value half: overlay the SAME annotations (break-even line,
     band edges, diurnal dip/peak shading, live marker) onto the existing Trends chart, and add the
     diurnal hour-of-day profile as a companion view. Client-side off the app's own quote path
     (bumps `APP_VERSION`); the CLI is the node-side twin (no bump). Shared render helper so both
     surfaces draw the same picture — the ONE chart-annotation home, mirroring the `quotecore` split.
  Honesty carries into the render: sample-size + reach caveats stay on the chart (the prototype's
  footnote), and the diurnal profile is an average, not a forecast (the PF-series forecast is the
  separate quantitative layer). Scope note: distinct from the deferred in-browser re-scan below
  (that rebuilds the market scan; this draws one item's history).
- **In-app re-scan** (ex PLAN-2 C3): browser CAN rebuild the band scan (~26 CORS-open
  requests); build only if published-scan staleness proves annoying. IndexedDB cache +
  courtesy rates if built.
- **Bank-visibility tooling — DEFERRED** (2026-07-03, Ben's call): bank data is a manual,
  always-stale clipboard export — no auto-sync possible; auto-reconciling it against live
  `positions.json` risks false discrepancies. Edge cases already handled (`unmatched`
  sells, `BANKED` basis, `WITHDRAWN` for off-GE disposal). If revisited: one baseline
  export + GE-log replay = rolling estimate; bank truth stays advisory, never injected
  into `fills.json`. Full rationale: `git show 39e5d23:PLAN.md` (chunk 5 section).

### Needs a Ben decision (not scheduled — list only, don't action unprompted)
- **`pnl.mjs` — go/no-go (proposed 2026-07-09, script-helper audit; NOT approved).** A standing
  P&L query helper over `positions.json` (realized after-tax closed P/L + open-inventory mark, by
  item / period / watchlist) so a "how am I doing?" ask stops spawning ad-hoc `node -e` reads — the
  same fewer-scripts-on-the-fly rationale that landed `limits.mjs` (LM1). Would share
  `js/ledgercore.js`'s period bucketing so numbers match the app Ledger. Build only on Ben's word.
- **N1 delivery-mechanism trial** — pick option a/b/c after the live scheduled-Claude-session trial.
- **Smaller product calls (from Discovered):** side-specific price-alert semantics; a mobile
  REMOVE editor for already-synced fills; a `--niche` keyword flag on `screen.mjs`; the
  `--max-price` default vs big tickets; a churn-niche `--min-gpd` exemption.
- (Resolved 2026-07-06…08: stale remote branches deleted; `pipeline/held-override.json` +
  `yield-improvement-brief.md` orphans removed — detail in `git show 4753e44:PLAN.md`.)

## Out of scope (standing decisions — don't re-open without Ben)

- App-native offer polling loop — the agent-run `watch.mjs` + `/loop` routine stays.
- RuneLite-Android / mobile auto-capture — wrong client.
- Cloud backend / PC-as-server — GitHub-as-backend chosen.
- `momVerdict`/cut-trigger changes from T1 — momentum strength is display-only for now.
- Rating cutoff/weight calibration — placeholder values stay until the validation study.
- Converting skills to subagents — scripts do the heavy lifting; skills encode judgment.

## Completed (pointers — full detail in commits + CLAUDE.md "Done" + git history)

- ✅ **PLAN chunks 1–10** (2026-07-03): manual-fills vocabulary + tombstones (0.27.0,
  `d867afb`); standard Quick/Opt table + `js/quotecore.js` (0.28.0, `fd586c9`);
  `quote.mjs`/`screen.mjs`/`marketfetch.mjs` (`5b586fb`); debt pass (0.29.0, `0febcbe`);
  `Mom` column + `momVerdict` cut-trigger (0.30.0, `c0a1c58`); `watch.mjs` adaptive
  monitor (`319e254`); unified `reconstruct.mjs` (`181a07c`); niche screens + `Exp gp/d`
  (`2c3ca7e`); `pipeline/cli.mjs` dedup (chunk 10). Bank tooling (chunk 5) deferred — see
  unscheduled notes.
- ✅ **PLAN-2 chunk C** — Finder v2 published-scan (0.31.0), then superseded by the
  niche-rating Scan (per-niche graded tables + `pipeline/rating.mjs`, 0.32.0); C1/C2
  plumbing lives on inside it. B1's safety core shipped as the sync-fills clobber-guard
  (`4711ff5`); the rest of B is M1.
- ✅ **PLAN-3** — underwater-at-tick triage, fully built (0.33.0, `d841cd1`): Gate-0
  reliability + `diurnalRead`/`moveShape`/`underwaterHours` + NO-READ/DIURNAL-WATCH/
  SHOCK-WATCH verdicts + fixtures; `MONITORING.md` step 4 is the tree.
- ✅ **PLAN-5** — project skills `/positions` `/scan` `/overnight` `/morning` + CLAUDE.md
  slimming (`82ba8a5`…`39e5d23`): skills committed, buy limit printed on `quote.mjs`
  regime lines, per-workflow doctrine moved into the skills with the grep-checklist
  reconciliation. Chunk 6 (memory pass) → K2; Gate-0 gap → Q1.
- ✅ **Waves 1–7 + LW/LH** (2026-07-04…07-05): shipped per the Status table above; per-chunk
  executor detail folded out 2026-07-06 (recoverable via `git show <sha>:PLAN.md`).

- ✅ **Flip-planning tooling wave** (2026-07-24) — three build-ready plans, scoped by Claude +
  hardened by Fable, implemented by Opus worktree lanes, hand-serialized onto main:
  **`/schedule`** buy/sell window agenda (`-c`/`-w`/`--audit` + `⏭ next:` loop banner, `826b4e8`);
  **`/book`** capital+P&L dashboard + `--size` sizer (`ca35f9f`); **multi-peak windows** —
  up-to-2 prominence-ranked `peaks[]`/`dips[]` per side on `hourProfile`, additive/zero-ripple
  (`41cc041`). Detail in those commits + CHANGELOG. `PLAN-{SCHEDULE,DASHBOARD,MULTI-PEAK-WINDOWS}.md`
  deleted per the fold-and-delete lifecycle.

## PLAN-PATIENT-PAIR — FOLDED (2026-08-24). Shipped, measured, and the measurement says stop.

The per-topic file is deleted; `git show 00344fb:plans/PLAN-PATIENT-PAIR.md` has the full text. It
began with a real anchor — `Webweaver bow (u)`, a 3-unit trade someone banked ~1.4m on overnight,
which our screen graded A- while its cell read `Est. sell 15.30m (reach-fold floored to BE 15.42m —
nothing to price above break-even)`, net −114.7k/u, two lines above an `◆ asym fill` note reading
`net 427k/u` on the same row.

**SHIPPED:** PP0 (`ca3939e`, log `asym` on skipped rows — the sample feed) · PP-R (`02417e4`,
band-mode watchlist reserve, `WATCH_RESERVE_DEFAULT = 24`) · PP2 (`21e442e`, the BE-floored cell
names the patient alternative inline).

**THE MEASUREMENT (§7, `join-asym-outcomes.mjs`, `00344fb`) IS THE OUTCOME THAT MATTERS.** Over
39,110 rows / 766 items: the deep bid is touched **17.8%** within 24h (logged `pBid` claims 31.1%),
the ask is reached **24.2%** given the touch (logged `pAsk` claims 86.8%), **round trip 4.3%** —
and **1.5% on big-ticket**, the class the whole plan was written about. DT1 generalises; the anchor
was a good OUTCOME from a bad-odds setup, which is the branch §7 named and nobody could distinguish.
Horizon does not rescue it (6.3% at 48h, 9.0% at 96h, 10.8% at 7d). Those rates are now carried into
the surfaces as a one-time `◆ asym fill —` footer (`emit.mjs` `asymClassRateNote()`, the ONE home).

**DO NOT RE-PROPOSE (each measured, not argued):** a `max(shownNet, asymNet)` gate (656 of 671
shown-net-≤0 rows have positive asym net — a repeal, not a filter) · a ranking objective on
`pAsk`/`pBid` (they are the `ASYM_P_LO`/`ASYM_P_HI` quantiles read back off the same array, 0.86 on
89.9% of rows and 0.29 on 86.5%) · an asym-amplitude gate (≥3% on 90.8% of items) · a random-offset
matched null for the outcome study (it measured −36.0pp "adverse selection" and was an artifact of
the STARTING PRICE — 99.8% of the ask level on the null arm vs 93.8% on the conditional arm).

**STILL OPEN, both carried here:**
1. **The patient clause does not reach `--positions`, and neither does the class-rate footer.** Two
   INDEPENDENT reasons, both verified against a real dumped positions report — an earlier version of
   this item named only a third thing ("the positions `estimatePair` passes no `asymEst`/`asymFill`"),
   which is true but would not have fixed either symptom if acted on:
   **(a) positions renders no `Est.` cells at all.** Its headers are `[...QUOTE_HEADERS, 'Held@',
   'Break-even', 'Verdict']` (`quote-items.mjs` ~:712) — Quick/Optimistic, not Est. buy/sell — and
   `estPairCells` is called only inside `runItems()`. The patient clause lives INSIDE the estSell cell
   (`js/estimators/cells.mjs`), so there is no cell for it to attach to. (The positions
   `estimatePair` call at ~:831 is also inside `if (PRESSURE_EXIT)`, so on the default path it never
   runs, and its `ts1hP` is block-scoped to that branch — the unconditional series is `inp.ts1h`.)
   **(b) positions pushes no `kind:'asym'` note,** which is what the class-rate footer gates on
   (`quote-items.mjs` ~:301). Passing the pair into `estimatePair` creates no note, so the footer
   would still not appear. These are two different mechanisms and an earlier draft conflated them.
   The work is therefore TWO independent pieces: build the asym pair for held lots off `inp.ts1h` and
   push a `kind:'asym'` note (that alone lights the footer), and separately decide whether the
   held-lot table should carry `Est.` columns at all (that is what the clause needs). NOT DONE —
   the second half changes what the held-lot review displays and is its own decision.
- **The held-lot `◆ asym fill` note — BUILT, REVERTED, and the two defects are the spec for redoing it.**
  Pushing a `kind:'asym'` note from `runPositions()` off the already-computed `astHeld` works and costs
  no fetch (verified: shape-identical `windowStats` call, footer fires once, degrades cleanly to zero
  notes when the 1h series is null). It was reverted for two display defects, both confirmed by running it:
  **(a) it prints a positive net at a price below the lot's own break-even.** `asymEstimate`'s
  `netMargin(bid, ask)` uses the asym DEEP BID, not the held basis, so a real run showed
  `ask 108.72m · net 1.56m/u (1.5%)` two cells from `Break-even 112.55m`. The fix is the annotation the
  sibling `pressureExit` note already carries on this surface (`below BE X — cut/damage-control price,
  not a profit`); the items path gets its equivalent free from `estPairCells`' `beFloored` branch, which
  `--positions` never reaches because it renders no `Est.` columns.
  **(b) the class-rate footer does not land under the notes it qualifies.** `buildQuoteReport` appends it
  at the tail of the whole `notes` array, so on a 4-lot book it sat 63 lines below the first asym note,
  beneath a different item, with no item name while every other note on that surface is `Name: …`. Its
  text opens "the counts above are…", which then spans four items. Needs either per-item placement or an
  explicit section break — a design decision, not a one-liner.
  **(c) and the positions path co-logs no `asym` field**, so rows from this surface would be invisible to
  the very script the footer names. `asymShadow` is already imported and `aeHeld` is in scope at the
  `suggestionEntry` push; `docs/MARKET-ANALYSIS.md` states the held-row five-estimator co-log doctrine.

2. **PP1 (a named patient section for non-watchlisted rows) — DEFERRED, and §7 argues against it.**
   Its floor was to be sized against a population nobody had characterised; that population is
   characterised now and its round trip is 1.5%. Revisit only against these numbers.

## Discovered

- **The value/Invest lane's money path is NOT bond-covered (BSH H2 review, 2026-09-03).**
  `js/valuescreen.mjs` `afterTaxAmpPct` and `js/validate.mjs` `valueAmplitudeValidator` (a GATE)
  take no item id, and `gateValueCandidates` returns before `spec.edge` runs, so the `ctx.guide`
  bond thread never reaches them — a bond can still be admitted there on tax-model economics.
  Mitigated: `value` is out of `--mode all` (explicit-only) and the bond is book-quarantined. Fix =
  thread a guide into the value gate branch + validator ctx — its own chunk, not a drive-by.
- **`restartBlindSuspects` still walks per-slot rows in READ order (BSH H3 review, 2026-09-03)** —
  the same mtime race `activeOffers` now survives can, in shape, flag a wall-clock-superseded stale
  BUYING as a restart suspect (spurious ⚠ on capital surfaces). Inform-only, unmeasured occurrence;
  fold it onto `supersedes()` when next in `offers.mjs`.
- **The bond no-guide refusal lives duplicated in two private `netOf` helpers (BSH H2, 2026-09-03)**
  (`amplitudescreen.mjs`, `flip-niches.mjs`) while `bondFee(null) → 0` in money-math stays silently
  fee-free for `computeQuote` — one policy, three behaviors. ENCODE candidate: one shared refusal
  home in money-math.
- **`REPO_DIR` (pipeline/lib/paths.mjs) is hardcoded to the main checkout**, so a bare sync run from
  a WORKTREE without `--repo-dir` writes the LIVE book — bit a reviewer once (2026-09-02, the SLT
  wave) and every worktree acceptance since has had to remember the flag. Guard candidate: refuse a
  bare run when `cwd` is inside `.claude/worktrees/` and no `--repo-dir` was given.

- **~~A pure-prior `n:0` annihilates a real sample count through `Math.min`~~ — FIXED (2026-08-30,
  `estSampleN`).** The semantics decision this entry demanded: `estN` = the observation-backed
  sample count — min over legs with n>0, a pure-prior leg excluded rather than annihilating, all
  legs priors → 0 (which is the honest record on the RISING lane, where `pFillRising` is itself a
  prior). Matches the DT1b amplitude convention already in the file; which leg was a prior stays
  recoverable from `estBasis`. One home (`js/estimators/families.mjs`, beside `estR`), both
  `Math.min` call sites (value row, watchlist `estFields`) rebased onto it, mutation-pinned in
  `estimators.test.mjs`. Forward-record note (corrected by the 2026-08-30 review — the first draft
  claimed band rows were unchanged): every MIXED row changes, and the dominant band-table population
  (a reach-based pFill leg against a velocity-prior ttf) flips estN 0→its reach n — far more rows than
  the value lane; only rows with both legs priors, or both observed, keep their old estN.

- **~~`leanValidators` cannot distinguish a validator that PASSED from one that ABSTAINED~~ — FIXED
  (2026-08-30, `abstain: true`).** `degrade()` and the thin-sample branch mark their pass-shaped
  non-answers `abstain: true`, and `leanValidators` logs them the way it already logged
  `validatorError` (the branch directly above — a crashed validator and a degraded one are the same
  non-answer shape). An all-abstained row no longer serializes identically to an all-clean one; the
  one-directional hit-rate-denominator inflation stops accruing at this commit. `analyze.mjs` counts
  only `status === 'reject'`, so rows either side of the boundary read compatibly. Mutation-pinned in
  `validate.test.mjs`.

- **`reachability.mjs` scores a pre-E2 break-even SUBSTITUTION as the fold estimator's own price
  (2026-08-29).** Before the E2 commit a BE-floored row set `estSell = breakEven(estBuy)` — the fold
  saying it had nothing to price, i.e. a refusal. `REACH_ESTIMATORS`' `reachFold`/`reachRelief`
  entries read `s.estSell` with no `estConfidence.beFloored` check, and the archive still holds those
  rows, so `join-reach-outcomes.mjs` pools two eras under one key. The era split is the discriminating
  test and it is clean: essentially every pre-E2 `beFloored` row has `estSell === breakEven(estBuy)`
  and no post-E2 row does — re-derive it with the canonical `breakEven` from `js/quotecore.js`, never a
  hand-rolled one (a hand-rolled version inverted the date cut on first attempt). Direction is
  determinate: `beFloored` ⟺ fold < BE, so the substitution raises the ask and biases both fold keys'
  reach rate DOWN. **Deliberately not fixed:** the affected share sits under the noise `join-reach-outcomes.mjs`
  already declares, and that file explicitly does not rank. Worth paying for only alongside the
  `join-reach-basis` cost-model port, as a `readRows` exclusion — a prose caveat is the wrong fix here,
  since the caveat would carry a number that regresses.

- **~~`groupCampaigns` mis-groups campaigns in BOTH directions~~ — FIXED (2026-08-30, multi-chain
  keying).** Each parallel ladder is its own chain; an offer joins the chain it succeeds (same slot
  wins outright, then closest-closing within [−`REPLACE_OVERLAP_TOL`, `REPRICE_GAP`]); completion
  terminates. Scored PAIRWISE on the real book per this entry's own rule: false stitches (predecessor
  live past tolerance, merged anyway) to ZERO; definite same-slot successions recovered rose; every
  non-merged place-then-cancel candidate decomposed to a completion split or a closer same-slot
  predecessor — no unexplained case. One earlier claim here measured WRONG and is withdrawn: the
  overlap tolerance is NOT made moot by multi-chain keying (without it, place-then-cancel splits), so
  `REPLACE_OVERLAP_TOL` ships. Consumers rebuilt (`join-outcomes`, `join-window-clears` run clean);
  **every grouping-derived baseline from before the fix — `PLAN-FIRST-ASK` §1.1/§1.2 flagged in place —
  must be re-derived, not carried.** Pinned by `pipeline/test/campaigns.test.mjs`.

- **~~`suggestlog.mjs`'s pace projection records the stale-REFUSAL marker as a pace reading~~ —
  FIXED (2026-08-30, both halves).** `diurnalTimedLap` exposes `.profile` and watch threads it plus
  the stale-guarded live into `askExitRead` (watch `windowExit` rows carry `pace` from that commit
  on — a forward-record content change to remember when joining across it), and `windowExitShadow`
  now serializes a refusal AS a refusal (`{stale, ageMin, hour, n}`) instead of fabricating
  `gap: null` and dropping the why. Mutation-pinned in `suggestlog.test.mjs`. Rows logged before the
  boundary keep the lossy shape — classifiable only by their gap-null signature.

- **The "certain-pair" screen is unsatisfiable on BIG-TICKET specifically — not "by construction" (2026-08-27).**
  Pairing the certain bid (max daily low) with the certain ask (min daily high) nets negative on **0 of 31**
  measured items ≥10m, which is why it rejected an entire 8-row digest shortlist. But it is NOT arithmetic:
  it passes on ~38% of sub-100k items (two samples, 591 and 790 items). The mechanism is that day-to-day
  drift plus the 2% tax exceeds the stable common band once the price is large. An agent screening
  big-ticket candidates this way will reject every one of them and read the result as a per-item finding.
  **A `pairRead` estimator + digest column built on the wrong "by construction" story was written and then
  DELETED the same day** — `pipeline/lib/market/fill-surface.mjs`'s header already names the defect
  ("windowread's 'reached on ~50% of days' is the median of the daily highs, so its 50% is TRUE BY
  CONSTRUCTION and cannot carry information about its own quantile"), and the Discovered entry on
  `AMP_ASK_Q`/`AMP_BID_Q` = 0.5 already condemned the same estimator. **The real remedy is AB7**
  (`plans/PLAN-ASK-BACKTEST.md`): `askAtFillRate` answers 9/9 digest items today off the cached surface
  with a MEASURED p, and refuses honestly where it cannot. Measured walk-forward (5,277 folds): on ≥10m
  items both legs of a 50/50 pair are available on the same day **8.5%** of the time.

- **Doc/prose drift left UNFIXED because each needs a version bump or a judgment call (found
  2026-08-26, away-scoped review; everything cheap and unambiguous in the same sweep was fixed).**
  (a) `pipeline/daemons/registry.mjs` says sync-fills "rides **EVERY** read" in three places; five
  read commands (`read-window-range`, `read-schedule`, `read-trajectory`, `read-buy-limits`,
  `monitor-offers`) never call `runLocalSync`. The four that do are now correctly enumerated in
  `sync-invoke.mjs`, `docs/ARCHITECTURE.md` and README; this registry copy still overclaims.
  (b) `.claude/skills/schedule/SKILL.md` calls them "three mutually-exclusive modes" and then says two
  may be combined; `.claude/skills/overnight/SKILL.md` cites a line number for the `--mode` default
  that points at an unrelated comment (the CLAIM is right, only the citation drifted). Both are
  skills-only edits and so carry a `version:` bump — batch them with the next skill change.
  (c) `docs/GLOSSARY.md` has no entry for the `reverse` flip-niche at all, though `MODE_KEYS`
  includes it and CLAUDE.md gives it its own row.
  (d) `pipeline/ci/check-imports.mjs` reports a SYNTAX error in a module as ~76 failures all naming
  the healthy files that import it, never the broken one. Largely defused rather than fixed: the
  syntax step now covers `js/**/*.mjs` too and runs FIRST, so it fails and names the file before
  `check-imports` runs — but run it standalone and the misdirection is still there.

- **UNFIXED BUG — the amplitude lane's phase label asserts "floor holding" from an ABSENT
  measurement (found 2026-08-26 by an away-scoped review; flagged, deliberately not fixed).**
  `reachPhaseNote` (`pipeline/commands/screen-flip-niches.mjs`) reads
  `const floorSlope = (dae && dae.floorSlope != null) ? dae.floorSlope : 0;` and then
  `if (floorSlope >= 0) return 'trough phase — floor holding, oscillation intact'`.
  `driftExitFrom` returns **null** whenever `diurnalForecast` degrades, so a missing forecast becomes
  slope 0, which passes `>= 0`, which prints a floor-direction claim. **FAIL-OPEN on the direction
  word**, on the big-ticket multi-day lane.
  **Verified by a discriminating run, not inferred:** `reachPhaseNote(osc, dae, null)` on real archive
  data varying ONLY the `reliable` field of the ctx — `reliable=true` → `oscillating into a falling
  floor`; `reliable=false` → `dae` null → `trough phase — floor holding`; `reliable=undefined` →
  `falling floor`. Same item, same window, opposite words.
  **Live instance:** the 2026-08-26 scan printed Abyssal bludgeon as `trough phase — floor holding,
  oscillation intact` at A- while `floorCeilingTrack` on the SAME 14-day `days` array gave
  `floor.slope −147,649/d`. They are not different windows — `driftExitFrom` calls
  `floorCeilingTrack(days)` on the array `windowStats(ts1h, {nights: AMP_NIGHTS})` produced. A first
  diagnosis blamed differing windows; that was wrong, and the fail-open default is the real cause.
  **`check-forecast-guards.mjs` cannot see this** — it pins how `phase` is PASSED IN, not what happens
  when the whole forecast returns null.
  **But this is NOT an uncovered gap — it is COVERED IN THE WRONG DIRECTION, which is worse.**
  `pipeline/test/oscillation-reachphase.test.mjs:77-82` asserts exactly this output and calls it
  intentional: `'degrade: oscillating + null dae → trough phase (unknown slope treated as ≥0)'`. A
  test SAW the behaviour and codified it. So the fix is not a one-line edit — it requires INVERTING a
  currently-green assertion, which is why it needs a ruling rather than a patch.
  ⚠ **The earlier "sweep of the other consumers (done, so nobody re-audits it)" was WRONG, and the
  closing instruction made it worse.** It checked exactly two functions — `amplitudeDriftMargin`
  (`js/amplitudescreen.mjs`) and `driftInformNote` (`js/flip-niches.mjs`), both siblings in the same
  lane, both of which do degrade correctly — and then told future readers not to look again. A
  repo-wide sweep finds at least two more instances of the shape in under two minutes. Never close a
  sweep against re-audit; that sentence is the finding as much as the misses are.
  **(a) `js/valuescreen.mjs` — the same shape ON A GATE, but LATENT.** `knifeDelta` coalesces an
  unmeasurable 3d/14d median pair to `0`, and the gate then asks `(vr.knifeDelta || 0) > VALUE_KNIFE_PCT`,
  so a MISSING measurement reads as "not a knife" and passes. Demonstrated on two fixtures identical
  but for the 3d lookback: `0.2833 → {pass:false,reason:'knife'}` vs `0 → {pass:true}`.
  **Reachability was then measured rather than assumed, and it is the part that changes the ranking:
  across 4,041 archive items with `valueRanges` data the null path fires ZERO times** — `termStructure`
  anchors `now` to the series' last point, so the 3d/14d windows always contain data, and
  `warmOverride` patches only `.trajectory`/`.recentTrend`, never `.lookbacks`. So this is a LATENT
  fail-open worth closing for defence-in-depth, NOT a live defect — an adversarial pass reported it as
  live on the strength of the synthetic fixture alone, which proves the shape and says nothing about
  reachability.
  **(b) `js/market.js` `refineTrend` — reachable.** `mom = m7 ?? m30 ?? 0` means an unmeasurable
  momentum (series shorter than 7 days, which still clears the `px.length >= 8` guard) becomes `0`,
  and `(mom<0)?'down-confirmed':'reversion'` then labels a genuinely falling item `reversion`. That
  silences two of the three terms in `js/trends.js`'s `falling` flag at once (`R.state` and the
  `m30<=-15` term), leaving only `rl.falling`. Reachable only on a short series, so scoped to
  newly-tracked items — but unlike (a) it is not structurally blocked.
  Fix direction (needs a ruling, since it changes a printed label): a null `dae` should yield a
  direction-AGNOSTIC phrase, the way the `!osc.oscillating` branch already does (itself pinned at
  `:71-73`), never "floor holding".
  **Limit on the live instance:** the reach cell is CONSOLE-ONLY and absent from `screen.json`, so the
  printed line is not reproducible from a stored artifact. The MECHANISM and the −147,649/d slope are
  both independently reproducible; the print itself rests on a session observation.

- **OPEN INVESTIGATION — the asym deep bid skews STALE on rising items. Effect confirmed, magnitude
  much smaller than first written (Ben, 2026-08-26; corrected the same day by an adversarial pass).**
  **Verified at source:** `asymPair` (`js/windowread.mjs`) sets `deepBid = quantLow(stats.lows,
  ASYM_P_LO)` with `ASYM_P_LO = 0.25` — an unweighted 25th percentile over the 14-day `lows` array.
  There is NO recency handling anywhere in the chain: `windowStats` sorts `lows` ascending and
  discards day order, `asymEstimate` only applies `Math.min(row.quickBuy, deepBid)`, and
  `formatAsymFill` prints a bare `touched N/Md` with no dates. `recentQuant` exists but serves
  `reachableBand`/`realityClause`, never `asymPair`. The `min()` guard is structurally NON-BINDING on
  a riser (a stale `deepBid` sits below live `quickBuy`), so it cannot rescue the level.
  **The point:** the function's header sells `deepBid` as "a bid that fills only on a genuine flush".
  On a dumping item rare means the market seldom flushes there; on a rising item it can instead mean
  the market has moved past the level. Same statistic, two different objects, and the render shows a
  bare count that cannot separate them.
  **MEASURED (n=400 items, ONE snapshot, proxy statistic — directional evidence, not a measurement).**
  Mean normalised position of the deep bid's touch-days across the 14-day window (0 = oldest,
  1 = newest), bucketed on `floorCeilingTrack(...).floor.slope` at ±0.2%/day:
  `rising n=205 → 0.419 · flat n=60 → 0.455 · falling n=135 → 0.501`.
  **The 3-bucket collapse HIDES a non-monotonicity in the very variable it buckets on. The honest
  reading is "a small aggregate lean, non-monotone in slope, driven by the falling tail" — NOT
  "direction confirmed".** Refuting test named first, then run: *if the deep bid is drawn from the old
  end BECAUSE the item is rising, mean touch position must fall as the rising slope steepens.* It does
  not. Finer bins on floor slope %/day (n=346, top 400 by guide price with a touch and 14 full days):
  `<-2.0% n=22 -> 0.575 · [-2.0,-0.5) n=71 -> 0.486 · [-0.5,-0.2) n=32 -> 0.451 · [-0.2,+0.2) n=56 -> 0.447 · [+0.2,+0.5) n=30 -> 0.412 · [+0.5,+2.0) n=96 -> 0.408 · >=+2.0% n=39 -> 0.514`.
  The non-monotone U is the durable finding: **three independent implementations reproduce every bin
  mean to within ~0.03**, and all three put the strongest-riser bin back ABOVE its milder neighbours.
  **The n does NOT reproduce — 323 / 346 / 362 across the three runs.** The universe spec ("top 400 by
  price") is under-determined (guide price vs latest-high; whether 14 FULL days are required), and each
  choice moves n by ~10%. Anyone re-running this must fix the universe first; quote the SHAPE, never the n.
  **Do not quote a correlation coefficient here to three decimals.** The three runs give Pearson
  **+0.009 / −0.014 / −0.058** — the sign is not even determined, because the slope axis has outliers
  spanning −35 to +31 %/day and Pearson chases them. The rank statistic is the one that answers the
  question. **The pooled rank correlation is negative — and it is a SIMPSON'S-PARADOX ARTIFACT. Split
  the pool and the sign flips on the half the hypothesis is actually about.** Among FALLERS the
  association is negative and near-tautological: `quantLow` picks the lowest daily lows, and on a
  falling item those ARE the newest days, so the statistic largely restates the trend classification.
  Among RISERS — the exact population "the deep bid skews STALE on rising items" is a claim about —
  the association is significantly POSITIVE with a CI excluding zero, and the strongest risers sit near
  the MIDDLE of the position range where the mechanism predicts the extreme low end. That is not
  "non-monotone in the tails"; it is roughly half the pool, monotone the WRONG way.
  **So the honest claim is that the mechanism FAILS on risers, not that it weakly holds.** A recency
  fix to `asymPair` tuned on the pooled number would move risers in the wrong direction. Fix the
  universe spec and the `floor.nUsed === 5` confound (a 5-day slope cannot classify days 0–8, which is
  the leading candidate for why strong risers land mid-range) BEFORE treating any of this as a result.
  **Nothing here is auditable and that is the load-bearing problem:** the position statistic is
  computed by NO committed script (grep the repo — zero hits), so all four runs are unreproducible by
  construction. Any next pass writes the script FIRST. No coefficient is quoted here on purpose;
  re-derive from primitives, and expect the digits to move.
  **The mechanical benchmark nobody stated, which is what makes the effect small:** at `ASYM_P_LO = 0.25`
  over 14 days a PERFECTLY monotone riser touches only its oldest ~4 days -> mean position **0.115**; a
  monotone faller -> **0.885** (both verified by running the construction, not reasoning it). The
  observed 0.41–0.58 spread is ~20% of that 0.77 span. The statistic is
  therefore largely a definitional consequence of the trend classification, and real risers land nowhere
  near the value the mechanism implies. An earlier draft said "drawn structurally from the old end"; the
  retraction of that phrase was right, and "direction confirmed" was still too strong a replacement.
  **A limitation of the bucketing itself, found while re-running it:** `floorCeilingTrack` fits
  `floor.slope` over the RECENT 5 days while touch position spans all 14 — the stratifier and
  the outcome do not cover the same window. This is TOTAL, not occasional: `nUsed === 5` on **346 of
  346** items. Any real study must fix that before reading anything into it.
  **The four-item anecdote that started this is a TAIL, not an illustration of the typical case, and
  its internal ordering is inverted** (recorded so nobody re-quotes it as the pattern): mean touch
  position — Masori body 0.115 (rising) · Primordial boots 0.231 (rising) · **Abyssal bludgeon 0.346
  (FALLING)** · **Armadyl crossbow 0.577 (RISING)**. The crossbow's touches sit mostly in the NEWER
  half — its floor is a V (35.54m → 33.48m on 08-19 → 35.19m), so the level was reached mid-window on
  a dip and recovered, which is mean reversion, not abandonment. And the one falling item is OLDER
  than one of the risers. The mechanism's own prediction is violated inside the four items first cited
  as evidence for it.
  **Still worth finishing, because it bears on an already-measured number:** `join-asym-outcomes.mjs`
  found the deep bid touched 17.8% within 24h against a logged `pBid` of 31.1%. A proper study would
  score P(touched within 24h) — not touch POSITION — stratified by floor slope, forward, off the
  archive.
  **If you build it, read `pipeline/lib/market/archive-series.mjs` FIRST.** `archive.seriesFor`
  returns rows keyed `ts`; `windowStats` keys on `timestamp`. The mismatch filters every point and
  returns `null` SILENTLY — the adapter module exists to close exactly that trap, and a first attempt
  at the measurement above fell into it.
  **Not blocked by PLAN-PATIENT-PAIR's DO-NOT-RE-PROPOSE list** — that bars a `max(shownNet, asymNet)`
  gate, a ranking objective on `pAsk`/`pBid`, an asym-amplitude gate, and a random-offset null. A
  recency-aware LEVEL is none of them. Closest sibling is F1 (`ASYM_P_LO` is a labelled PLACEHOLDER
  F1 tunes), but the question is the estimator's BASIS, not its threshold.
  Promote to a `plans/PLAN-*.md` when scheduled.


- **FIXED — `pipeline/test/render.test.mjs` printed NOTHING and still passed.**
  `node pipeline/test/render.test.mjs` emits 0 bytes and exits 0; `run-tests.mjs` prints `✓` over that
  silence. Cause verified by a discriminating run rather than inferred: `quote-items.mjs` sets
  `if (!VERBOSE) console.log = () => {}` **at import time, globally** (~:128), and the test imports it for
  `buildQuoteReport`. Running `node pipeline/test/render.test.mjs --verbose` prints all 31 checks. So the
  assertions DO run and the suite does gate via exit code — but nobody can see it, and any future
  contributor reading the runner has no way to tell a silent pass from an empty file. Any other test that
  imports `quote-items.mjs` inherits the blackout. Found 2026-08-24 by an away-scoped review pass. The fix
  is to stop a library import from mutating global `console`; not done here because it touches a
  load-bearing quiet-by-default path (AO1) that several surfaces depend on.

- **UNFIXED, NEEDS BEN'S CALL: four reconstruction defects that would REWRITE the realised book (found
  2026-08-14 by an away-scoped review; deliberately NOT changed).** These sit in `collapseOffers` /
  `matchTrades`, which CLAUDE.md gates behind "read `pipeline/FILLS-PIPELINE.md` §5.1 first" — and every
  one of them changes `positions.json`'s realised P/L, so they need an attended decision plus a re-sync,
  not a cleanup-wave commit. Each is recorded with what was actually verified.
  **(1) A missing terminal SWALLOWS an offer's fills.** An offer closes only on `o.done` / a different
  itemId / a different type, so a fresh `placed` on the SAME slot+item+side does not open a new offer, and
  `filled`/`spent` fold with `Math.max` — the second offer's fills are absorbed rather than added.
  Reported live on slot 3, item 24585: reconstructed `filled 4 / spent 189,996` against a real
  `6 units / 284,996 gp`, i.e. **~95,000 gp missing from the shipped book**, with no `open` and no
  `unmatched` row to show for it. 1 of 2,057 collapsed offers. §10 already says a missing terminal happens;
  `validateSlotTransitions`/`dedupeSnapshots` both key on DOUBLE terminals and cannot see a missing one,
  and qty-conservation passes because it measures AFTER the loss. ⚠ VERIFY THE ITEM/NUMBERS FIRST — the
  event field names in `fills.json` differ from the ones the report assumed, so treat the mechanism as
  the finding and re-derive the figures.
  **(2) The manual-slot exemption is hard-coded `slot === 8 || slot === 9` while the documented backfill
  instruction is `--slot <n> (≥ 8)`.** VERIFIED against the live book: the slot histogram runs 0–14 with
  **10 events on slots 10–14**. Those fall outside the exemption, so the DROP path applies — two identical
  manual terminals on slot 10 silently collapse to one, while on slot 8 both are kept. The remedy the doc
  recommends is the thing that causes the loss. (`add-manual-fill.mjs` enforces `≥ 8`, so the doc and the
  writer agree; only the reconstruction disagrees.)
  **(3) FIFO orders by PLACEMENT time, and this is undocumented.** Neither §5.1 nor `matchTrades`' header
  says which clock it uses. A sell resting from before a buy books as `unmatched` plus a phantom open lot;
  36 of 146 items have sequences where placement order ≠ fill order. Re-running with `tsOpen := tsClose`
  moved realised **39,162,243 → 35,779,811** and open lots **37 → 70** — about 3.4m gp of realised P/L
  rests on a choice nothing states. Related: `buyTs`/`sellTs` are placement stamps too, 19.1% of them more
  than an hour early (max 20.9h), which suppresses the entry-age freshness softening on exactly the patient
  entries it exists for. **The clock should be DOCUMENTED before it is changed** — one is defensible, the
  silence is not.
  **(4) `FILLS-PIPELINE.md`'s schema blocks contradict the real artifacts**: `type` is documented
  `"buy" | "sell"` while 23 live events carry `withdraw`/`banked`; `slot` is documented "0-7 (-1 if
  unknown)" while real slots reach 14 and a missing slot yields `null`, never `-1` (which also collides
  every unknown-slot event into ONE `collapseOffers` bucket); and the `closed` block omits the live
  `banked`/`withdrawn`/`keepRoundTrip` keys. Same class the doc already patched once for `awaitingRebuy`.
  FIXED in the same review, because it touches analytics rather than the book: `campaigns.mjs`'s
  `MANUAL_SLOT = 8` equality test (its own comment said "mobile / manual") reported every slot-9 MOBILE
  campaign as `manual:false`, so hand-typed entries entered `outcomes.json` as organic GE fills and their
  "time to first fill" was fiction in the F1 set. Now `isManualSlot(slot) = slot >= 8`.

- **THE GUARD-SCOPE CLASS: a guard that derives its scope from a directory listing under-reports
  SILENTLY, and a clean run is what that failure looks like (nine instances, 2026-08-09 → 2026-08-14).**
  Not a hypothesis — a tally. Every one printed a PASSING result over a scope narrower than the thing it
  claimed to cover: a `--collisions` regex; `extractStatus` (the `**Status: …**` form never matched, so
  plans reported "(no Status line)" that had one); `OPEN_RE`; `extractStatus`'s 3-continuation-line cap,
  which was ITSELF the fix for the previous instance and re-opened the same hole one line further down
  (two plans put their `OPEN:` clause on line five and were nominated as fold candidates) — now an
  uncapped read to the paragraph terminator; `chunkIds()` skipping the root `PLAN.md`; `check-daemon-safety.mjs` reading
  `pipeline/daemons/` while **3 of the 4 registered daemons live in `pipeline/commands/`** — a quarter of
  the fleet, green for months, including a `local:true` resident that statically imports the git-writer;
  a verification harness of my own that "proved" byte-identity by comparing two EMPTY files after the
  script it ran had died; `lint-skills.mjs`'s hand-kept `SKILL_FILES`, whose own comment named a backstop
  (`lint-plan-lifecycle.mjs`'s skillDrift) that **is not in `checks.yml`**, so nothing gating had ever
  compared the list to disk; and — while writing this very entry — my own `grep` for status-less plans,
  which reported three where the authoritative guard reported five.
  **The rule, in three parts.** (1) **Derive scope from the REGISTRY, never from a `readdirSync` of one
  directory**, and make an unresolvable registered name a hard FAILURE rather than a silent omission —
  that is the difference between coverage shrinking and coverage complaining. (2) **A guard must refuse
  to report success on an empty or zero-length read**; "0 problems found" and "0 things examined" are
  indistinguishable in every output format we use, and the second one is the dangerous one. (3) **When
  counting anything a guard also counts, take the guard's number** — ad-hoc greps written to check a
  guard are themselves un-guarded, which is how instance nine happened one paragraph after instance eight
  was written down. Corollary already in CLAUDE.md rule 10: "covered by tests + import resolution" is not
  coverage, because `node --check` is syntax-only and `check-imports` only proves names RESOLVE.

- **STILL-OPEN, RE-SURFACED 2026-08-15: the falling-but-liquid big-ticket APPENDIX (blindspot #2).**
  This was finding #2 of the 2026-08-13 blindspot audit and it is the only one of the four still
  unbuilt. It is listed here because folding the audit put a live item inside a Status row stamped
  `✅ AUDIT DELIVERED`, where nobody scanning for open work would find it. **The buildable predicate,
  in full** — the appendix is restricted to items that are (a) two-sided liquid, (b) big-ticket by
  `BIG_TICKET_GP`, and (c) currently excluded ONLY by the falling doctrine: i.e. when amplitude's
  Stage-2 drops a candidate specifically on `trend`/`knife` and **NOT** on `amp-below-floor` /
  `bid-unreachable` / `ask-unreachable` / `unaffordable`. **The negative drop-reason list is the
  load-bearing half** — without it the appendix becomes a dumping ground for everything the gate
  rejected, which is the failure mode that kept this unbuilt. Precedent for the shape: the digest's
  big-ticket-lane guarantee (POLISH 1) already appends a sub-section on exactly this pattern.
  *Evidence base: ~15 items. Its own validation path — the third "could NOT investigate" bullet of
  the audit — was to check whether the appendix would have surfaced anything Ben actually traded.*
- **DEFERRED ON PURPOSE, NOT MISSED: the value/amplitude render-path duplication (~400 lines × 2).**
  `renderMode` vs `renderValueMode` in `screen-flip-niches.mjs` are two near-parallel render paths,
  and `valuescreen.mjs` keeps its own `valueScore` rank alongside `estimateRank`. The amplitude plan
  analysed merging them (migrate `valueScore` onto `estimateRank`, then merge the render paths) and
  deliberately deferred it — the swap that demoted value out of `--mode all` made the merge a bet on
  a lane that may not survive its trial. Recorded here so a `/cleanup` pass reads this as a decided
  deferral rather than an unexamined 400-line duplication and "fixes" it.
- **FOUR LIVE MODELS OF "HOW MUCH CLEARS", CONSTANTS SPANNING 20× — three of them tracing to the SAME
  n≈6 paragraph. Found 2026-08-14 off a live misread; labels fixed, constants deliberately NOT
  retuned.** The trigger: a market read told Ben not to scale a sapling sale past the printed
  `~36 ceiling`. He had already cleared **146 Magic saplings @ ~77,565 and 200 Yew saplings @ ~20,957**
  that day. Both defects behind that read are real and neither is a calibration error:
  **(1) CATEGORY.** `trancheComfort`/`trancheCeiling` (`js/windowread.mjs`) borrow their 0.5%/1%
  constants from `js/estimators/reach.mjs`'s reach-relief knee, and that study measured **how far the
  realized PRICE degrades with lot size** — it never measured whether the quantity fills. The tranche
  model re-reads a price-quality knee as a quantity capacity ceiling, and the words `comfortable`/
  `ceiling` sold it as one. Renamed to `clean`/`price-knee`; the caveat now says "expect a worse
  realized NET at this size, not a failure to clear".
  **(2) SCOPE.** `volDay` is `min(hpv, lpv)`, so both numbers are a ROUND-TRIP bound — the tighter leg
  governs. A one-leg sell of stock already held is bounded by the sell side alone (`peakPool`), which
  on a lopsided book is several times larger; Magic sapling runs hpv 20,023 vs lpv 3,620, so 146 units
  is 4.0% of the min side but **0.73% of the side the trade actually consumed** — right at the borrowed
  knee. The caveat now names the `peak-pool` one-leg bound beside the round-trip one. Note this makes
  the round-trip `min()` DEFENSIBLE for the lap it models: the first fix attempted here was "change the
  denominator", and it was wrong.
  **The 20× spread, which is the durable finding:** `trancheComfort`/`trancheCeiling` use 0.5%/1% of
  `volDay` (`js/windowread.mjs`, display only) · `CLEARABILITY_FRAC` uses 0.5%
  (`pipeline/lib/capital/book-model.mjs`, `/book --size`, display only) · `expUnits` uses **10%**
  (`pipeline/lib/signal/gatecandidates.mjs`) and is the one that **actually GATES** — it feeds
  `pathAGpDay` and thence the `MIN_GPD` surfacing floor · `VALUE_VOL_SHARE`/`AMP_VOL_SHARE` use **10%**
  (`js/valuescreen.mjs`, `js/amplitudescreen.mjs`) in the value/amplitude `deployUnits` ranks. Three of
  the four cite the same n≈6 paragraph and two of them chose numbers 20× apart from it. The saplings
  sit comfortably under the gating 10% and 4–8× over the displayed knee — i.e. the surfaces disagree
  with each other by more than either disagrees with reality.
  **NOT DONE, deliberately:** the constants are unchanged. Retuning them by hand off n=2 items is the
  hand-tuning F1 owns, and the neighbouring depth model (`join-depth-outcomes.mjs`) already measured
  as indistinguishable from a one-line null once its residual was stratified by price trend — so a
  half-built harness here would most likely return the same non-answer. **The harness that would settle
  it** reuses ~70% of `join-depth-outcomes.mjs`: its `sellEpisodes()` FIFO-fragment merge (mandatory —
  raw `positions.json.closed` rows split one 39-unit sell into ~16 lots and destroy the size axis), its
  no-look-ahead `volDay` reconstruction, and its `TREND_BUCKETS` stratification; what it must ADD is a
  read-back of the logged `trancheComfort`/`trancheCeiling` from `suggestions.jsonl` (written by
  `suggestlog.mjs`, currently consumed by NOTHING — `analyze-record.mjs` and `join-outcomes.mjs` both
  have zero references) and an outcome-per-size measure rather than a price residual. F1-gated.
  **One dead parameter found in passing:** `isThinBigTicket(row, { tranche })` (`js/reverseflip.mjs`)
  would gate on `tranche <= THIN_TRANCHE_UNITS`, but no live caller passes `tranche` — all four call
  sites pass the row only, and the branch is exercised solely by its own test.

- **THE `sell unreliable` TAG LOSES TO NOT GATING AT ALL — measured 2026-08-13, the pre-registered
  DON'T-BUILD branch fired. Code left UNCHANGED; the open question moved from the basis to the tag.**
  `join-reach-basis.mjs` (PLAN-REACH-BASIS-DECISION, now folded here) settled the recent-3 vs
  full-window ask-reach split that `screen-flip-niches.mjs:800-816` had flagged as KNOWN, UNDECIDED
  and forbidden to "fix" either way without a measurement. Forward-scored 7,904 deduped rows / 635
  items from `estConfidence` on the suggestion ledger against the 1h archive.
  **Result, at the pre-registered decisive spec (24h, `askDays ≥ 7`, `askRecDays == 3`):** recent-3 is
  cheaper than full-window — M(1) = **+2.3pp**, item-clustered 95% CI **[0.8, 3.8]**, sign stable
  across all four horizons, both fold-flip eras, and band-only. **BUT both bases lose to the
  never-gate null at equal error costs** (never 2950 · recent 3493 · full 3668 · gate-all 4542).
  §3.3 of the plan pre-committed that outcome to the DON'T-BUILD branch *before* the run, so it is
  reported as such rather than reframed: **the finding is about the TAG, not the basis.** The full map is
  **FOUR regimes** in the cost ratio r = cost(falseGreen)/cost(falseGate):
  `never-gate < 1.29 · recent-3 < 1.76 · full-window < 2.05 · gate-all above` — so the shipped basis is
  optimal only in the narrow `1.29 < r < 1.76`, and past r ≈ 2.05 the right move is to gate everything,
  which no basis choice reaches. State the tension honestly: r\* = 1.76 sits INSIDE the window where the
  gate beats both nulls, so "both bases lose to never-gate" is true only at the r=1 the analysis disowns.
  **Quote r\*, never M(1)**: M(1) swings +0.2pp→+3.7pp across horizons purely through class imbalance
  (base rate 43.9%→73.2%), so an accuracy headline is an artifact.
  **Two method notes worth keeping.** (1) The first estimator was WRONG — Δ, the outcome-rate gap
  between the discordant cells, never sees the cell WEIGHTS and picks the losing basis on a worked
  counterexample; the shipped `mcnemarCost` is a paired contrast where concordant rows cancel exactly.
  (2) The precedent this replaces ("+9.8pp within-item, p=0.0001, n=6,016") is **unreproducible** —
  quoted in ten files, method recorded in none, no script ever committed. Treated as context, not a
  baseline. Full result + the honesty limits: README's `join-reach-basis.mjs` entry.
  **Open follow-ups this leaves:** whether `REACH_GRADE_CAP_FRAC` (0.5) is the right threshold at all
  belongs to F1, not hand-tuning; and the true `r` is unmeasured — it is misdirected operator
  attention on an inform-only triage surface, not a stuck slot, so nobody should assume r > 1.29
  without evidence. **Five pre-registered items were specified and NOT implemented** (recorded here so
  the omission is visible rather than lost with the folded plan): the `askDays ≥ 10` sensitivity row;
  time-of-day stratification for the 8h row (pre-registered *because* dedup keep-first biases 8h
  toward whichever hour the day's first scan ran); a CI on the null-model clearance; the disjoint
  `older11 + recent3` regression that would separate the two windows' information content from the
  two deployed configurations; and the paired Brier calibration secondary. None changes the decision;
  all four horizons and both eras already agree in sign. **Also unmeasured:** `watch-positions.mjs:267`,
  the other recent-preferring surface — its case was always display-coherence with the adjacent
  `⚠stale` marker, not prediction, so it was deliberately left alone.

- **RETRO-JOIN'S AMPLITUDE CLAIM WINDOW IS SHORTER THAN THE THESIS IT MEASURES — found 2026-08-09
  (audit round 3), DELIBERATELY UNRESOLVED, one-line fix awaiting an owner call.**
  `HORIZON_AMPLITUDE_SEC` (`pipeline/lib/render/retrojoin.mjs`) is **2 days**. It was set when the
  amplitude thesis was a 24h cycle. DT1 re-horizoned the lane to `AMP_HOLD_DAYS_DEFAULT` = **4 days**
  after measuring 4.8% completion within 24h, and the MEDIAN completion is **~69h** — so the typical
  real round trip now closes on day 3, outside the claim window, and is never attributed to the
  suggestion that called it. The retro therefore systematically UNDER-measures the amplitude lane, and
  will keep doing so. Fix direction: derive the horizon from `AMP_HOLD_DAYS_DEFAULT` so there is ONE
  home (the current constant is a second, now-stale home for the hold number — exactly what
  `suggestlog.mjs`'s header warns about). NOT taken unilaterally because it **changes which fills the
  retro attributes**, which moves every historical amplitude number `/analyze` reports.

- **PROXIMITY-TO-EXTREMES AS A PRIMARY SCREEN — Ben's idea, 2026-08-09. LOW SIDE: ANSWERED,
  MEASURED NEGATIVE (2026-08-10, re-measured 2026-08-11). HIGH SIDE: still open, unmeasured.**
  _Reconciliation, 2026-08-11:_ the LOW half of this entry was answered twice and both times the
  answer was no. The `DL-0/DL-1–3` Status row above closed it as a measured negative on 2026-08-10
  (chunks 0a–0d), and `pipeline/experiments/FLOOR-STRATEGY-FINDINGS.md` re-measured it on 2026-08-11
  under a different construction and reproduced the closure cell-for-cell. The finding: proximity to
  an N-day low IS a real relative signal — monotone in N, surviving an entry-lag control — and it is
  **not a trade**, because the best absolute after-tax round trip under the most generous execution
  assumption available is **+0.26% over 7 days** (~15k gp/day on 40m, against the scan's 250k gp/day
  attention floor). No discriminator (floor slope, drawdown depth) survived review as a way to
  separate a discount from a knife. **Don't re-open the low side without a NEW mechanism** — two
  independent passes is enough. The HIGH side (proximity to N-day highs, and the low↔high *pair* as a
  single range-position rank) has never been measured and remains genuinely open; the original text
  follows. "I wonder if we're just looking too deep — what if we just look for items based on
  their proximity to 1/3/7/14/30-day lows and highs?" A deliberately SHALLOW screen: rank/gate on
  where live sits inside each of the 1d/3d/7d/14d/30d low→high ranges, and nothing else. The context
  it came out of: the per-hour drift column was measured and found anti-predictive (two independent
  harnesses, ~43–46% directional, loses to predict-no-change on ~99% of items), which raises the
  general worry that the deeper time-structure machinery is fitting noise. Worth testing precisely
  BECAUSE it is dumb — it has almost no free parameters, so it can't overfit the way a per-hour slope
  can. Existing pieces to reuse/compare against rather than rebuild: `basePosition`/term-structure
  (already computes 14d/multi-week range position, and per memory `base-position-caution-not-credit`
  is to be read asymmetrically as a risk flag, never as an entry credit), the value flip-niche's
  RC1 recency-anchored cycle range, and the reach/placement percentiles (p-of-the-14-day-daily-LOW/HIGH
  distribution) which are already a proximity-to-extreme measure in all but name. **The open question
  is whether multi-horizon proximity carries decision value the existing single-horizon reads don't,
  and whether it beats them as a primary rank rather than as context.** Test forward, out of sample,
  against realized outcomes — the same discipline the validator sweep used. UNSCHEDULED, n=0.

- **"AT THE BOTTOM OF A RANGE IT HAS TRAVERSED BEFORE" — Ben's follow-up, 2026-08-11. ANSWERED FOR
  COMMODITIES: DON'T BUILD. STILL UNMEASURED FOR BIG-TICKET.** Ben's objection to the floor-strategy
  closure above was methodological and correct: a pooled cross-sectional average is the wrong
  estimator for a hypothesis that is explicitly CONDITIONAL on an item having an established
  oscillating range. He framed the conditional version as "the value strategy but with less
  speculation" — the shipped Invest lane bets an item *will* recover (one-shot, speculative), whereas
  conditioning on demonstrated persistence bets that an item which has already recovered N times will
  recover again. Measured in `pipeline/experiments/RANGE-PERSISTENCE-FINDINGS.md` (rolling-origin
  walk-forward, 74 days, six arms, real `valueGate`/`valueTier` as the comparison arm). **Result:
  no.** Within item and amplitude-matched, the excess is null in 6 of 6 cells (max |t|=1.2); the
  persistence lift is 0.70–0.83, i.e. the criterion *anti*-selects; a 2-day entry lag turns it
  negative; and it does not beat the value lane (+0.55%, t=0.3). A genuinely selective criterion WAS
  built (repeated traversals of the same two levels + leg-regularity, 26.2% firing vs
  `oscillationVsKnife`'s 98.4%) and bought nothing, so "refine the detector" is not the unlock.
  **The caveat is load-bearing and this entry must not be cited as a full closure:** zero arm-A items
  above 100k gp under the shipped units gate (3 above 10m under a loose one), so the fang-class /
  multi-week-oscillator case Ben was actually describing is UNMEASURED, not refuted — the same
  price-tier censoring that limited the floor study. Re-opening it needs a sample that reaches the
  big-ticket tier, not a new estimator on this one. See also the `MWO` Status row above,
  whose 22-of-23 OSCILLATING result is now explained as a detector artifact (next entry).

- **`oscillationVsKnife`'s OSC LABEL IS A FUNCTION OF SERIES LENGTH — a live trap, one refactor away
  from silently deleting a shipped guard (2026-08-11).** `OSC_MIN_LEGS` is an ABSOLUTE leg count over
  a variable-length window with no normalisation, so legs accumulate as the window grows: 59.5% OSC at
  14d → 88.9% at 21d → 99.9% at 60d on the real archive, and independently ~66% at 14d → ~100% by 30d on
  a synthetic DRIFTLESS RANDOM WALK with no cycle in the generating process at all. Amplitude cannot
  matter: every threshold is homogeneous of degree 1 in price, so the criterion is SCALE-FREE BY
  CONSTRUCTION and LENGTH is the only free variable. _(Corrected on adversarial review: the first
  version of this entry offered "identical across 3%/6%/12% per-step amplitude" as corroborating
  measurement. It is an algebraic identity that cannot fail on an additive walk, and on the
  multiplicative process the words described the rates are NOT identical but mildly monotone — vacuous
  in one reading, false in the other. The 14d figure also moved 63% → 66–68% on re-measurement and the
  generator was never recorded; the ≥30d saturation is the load-bearing part.)_ Survivable today only
  because the wiki `/timeseries?timestep=1h` endpoint caps the series
  at ~15d, so it fires ~2/3 of the time and the Chunk-3B knife temper still rejects 3–4% of rows. **The trap:**
  F-H's own note calls "feed it a deeper `archive.mjs` series" a noted-not-built follow-up, and
  `renderAmplitudeMode` already has that archive open in the same function — a one-line change takes
  it to ~100% OSC and deletes the guard with no error and no failing test. Recorded as a don't-rebuild
  note in the `oscillationVsKnife` header (the invariant's home), README's `js/forecast.mjs` entry, and
  PLAN-OSCILLATION-CYCLE's F-H row. **If pursued, normalise the criterion (legs per unit time, or
  period-regularity) BEFORE widening the window.** Also worth noting `docs/SIGNAL-AUDIT.md` has no row
  for this signal at all. UNSCHEDULED.

- **FOUR SMALLER DEFECTS FOUND ALONGSIDE THE RANGE-PERSISTENCE STUDY (2026-08-11) — not yet fixed.**
  (1) **`pFillValue`'s n is structurally 0** — it reads `vr.coverageDays`, but `valueRanges`
  (`js/valuescreen.mjs`) *gates* on `ts.coverageDays` (line ~120) and never puts it in its return
  object, so `num(vr.coverageDays) ?? 0` is always 0 for every value row. Worse, `pipeline/test/
  estimators.test.mjs` passes green by hand-constructing a `valueRanges` shape the producer never
  emits — a test asserting against a fiction, the same class as the fail-open forecast guard.
  VERIFIED directly, not taken on report — re-confirmed by execution on adversarial review
  (`valueRanges` returns 16 keys, none of them `coverageDays`; `pFillValue` → `n: 0`), and the green
  test is `pipeline/test/estimators.test.mjs:157–159`, whose own title asserts the thing that is false
  in production. (2) ~~`/scan` SKILL.md quotes the value liquidity floor as 50 where code says
  3,500~~ — **SOFTENED on review: this was overstated.** The `50` sits inside a DATED historical
  bullet ("Artifact/liquidity hardening, Ben 2026-07-09") narrating a 20→50 change, and the SAME file
  states the current 3,500 about 80 lines later. It is stale narration missing a forward pointer, not
  a live contradiction. Fix = add "(later re-based to 3,500)" to the dated bullet. (3) The superseded
  **500k gp/d** floor survives in `EDGE-MAP-FINDINGS.md` (×2) and `VOLUME-VS-BAND-FINDINGS.md` (×1) in
  LIVE voice, and no `lint-docs` rule covers it — confirmed twice over: no rule contains the string
  `500`, and `experiments` appears nowhere in `lint-docs.mjs`, so no rule's `files` list could reach
  those paths (CHECK 2 is scoped to `POINTER_DOCS = CLAUDE.md + README.md`). Both files are now
  tracked, so a rule would bite. (4) ~~Two `gate` validators declared on the value niche never
  execute~~ — **SOFTENED on review: true but INTENTIONAL and already documented.** `js/flip-niches.mjs`
  says so explicitly in the amplitude spec ("like value's floor/limit — these sit dormant in the
  console path"). The real (minor) gap is that the VALUE spec's own validator block carries no such
  note, so a reader of that block alone would believe they gate. Doc-locality, not a defect.

- **`quote-items.mjs --positions` COMPUTES THE DEPTH READ AND THROWS IT AWAY (2026-08-11).** Found by
  adversarial review while auditing why `depthExit` is sparse in `suggestions.jsonl`. The
  `--positions` path is separate from the per-item quote loop, and its `suggestionEntry` call
  (`quote-items.mjs:934`) passes `verdict`/`validators`/`windowExit` but **no `depthExit`** (nor
  `reachable`/`asym`/`estBuy`/`estSell`). Measured: **0 of 81** `--positions` held-lot rows carry it,
  against 3 of 3 on `watch-positions.mjs`. Worse, `clearableAsk` there sits inside the
  `if (PRESSURE_EXIT)` branch (`:818`), so on a DEFAULT `/positions` run the depth read is not even
  computed. `/positions` is the primary held-lot surface, so this is where the depth evidence should
  have been accruing all along. **A correction to my own earlier note:** README initially explained the
  sparseness as "the shadow only rides lots held while a watch/quote ran" — that causal claim was
  false; 81 qualifying reads ran and logged nothing because of a missing argument. UNSCHEDULED.

- **THE DEPTH MODEL DOES NOT BEAT A ONE-LINE NULL MODEL — measured 2026-08-11, negative.** Built
  `pipeline/commands/join-depth-outcomes.mjs` to score `clearableAsk` against realized sells (277 sell
  episodes / 77 items, predictions recomputed per episode with no look-ahead). Findings: (a) it is not
  distinguishable from "use the window's MEDIAN hourly high" — median residual **+0.81% vs +0.83%**;
  (b) `predictedAsk` sits at the **~52nd percentile** of the window's hourly highs, so the "strictly-
  conservative FLOOR" language in `clearableLevel`'s own header is wrong — it is a central estimate;
  (c) the residual is **TREND-DOMINATED** (corr ≈0.61 with 14d drift; −0.19% falling / +0.00% flat /
  +3.39% rising) because the model averages complete days ending at the previous midnight and that
  window lags a trending item; (d) `DEPTH_COMPETITION_MULT` is **not calibratable from this book** —
  sweeping 0.5→16 moves the median residual 0.20pp and 4→8 leaves ~71% of predictions bit-identical.
  Within the flat-trend arm the size gradient's item-cluster bootstrap CI straddles zero, so no size
  effect is supportable yet either. **Do not tune the constant off this; the honest next step is
  either a trend-corrected formulation or accepting the null model.** UNSCHEDULED.

- **THE VALIDATOR STACK HAD NEVER BEEN SCORED AGAINST OUTCOMES — TWO OF THE FIRST THREE MEASURED
  FAILED (2026-08-08).** Forward-scored every level-based validator against the 5m archive over the
  35-day ledger, arms = fired vs not-fired within the same band/churn population. Findings, in
  descending confidence:
  - **`dip-posture` FALSIFIED AT THE QUOTED LEVEL and reframed** (landed `6a8fbd9`) — its "a resting
    bid @ X likely misses, cross or pass" claim is inverted at `quickBuy`: the reverting bid is reached
    MORE often than the falling one it blessed (85.7% vs 82.6% @8h, n=5,535; strict sign test p=0.136,
    not significant). Cause: `quickBuy` rises with the bounce. The underlying rest-at-the-low MECHANIC
    is UNRESOLVED, not confirmed: scored at each row's own 3h low it looks confirmed (+30.7pp), but at a
    fixed offset below live the sign reverses (−9.9 to −14.6pp), and direction is not separable from
    level because `recentDirection` is defined by that level. What died is the policy at the level
    actually quoted. Full evidence: the `MEASURED` + `GEOMETRY TRAP` blocks of `recentDirection`'s
    header (`js/quotecore.js`).
  - **`floor` RETUNED** — `ranges` predicts DRAWDOWN monotonically (Spearman ρ 0.151, n=4,121;
    within-item p=0.066) but NOT loss (7d return flat). Honest effect size ~8–11pp on a fixed-percent
    threshold (the swing-unit spread overstates ~2× — the outcome shared terms with the bucketing).
    Caution line moved 1.0 → 1.5: a precision/recall trade (69.6% of firings silenced, 48% of real
    DD ≥ 1-swing events with them; precision 17.4% → 29.8%). Reject tier UNMEASURED in band/churn —
    censored by its own gate (a reject row never reaches the ledger). R3 trend escalation UNMEASURABLE
    from the ledger — its escalation censors its own arm (ranges-matched overlap zero); left in place.
  - **`reach` is INFORM-ONLY everywhere and excludes nothing** — 27,799 firings shaping prices, weak
    discrimination (reject 55.9% vs caution 62.2% @8h) and an 8h window applied to 1–2 day theses:
    **18.2% of scored levels printed within 48h but not within 8h**. STILL OPEN — the horizon mismatch
    is real and unaddressed; scoring it properly needs a fill model, not a print model.
  - **`reach` THRESHOLD: measured, and the answer is "no cut point earns much"** (2026-08-09, n=6,016 ask
    rows with a real 8h outcome). The planned `REACH_CAUTION_FRAC` 0.5 → 0.2 was NOT landed: base miss
    rate 60.0%, and 0.2 buys precision 60.0% → 64.6% while recall drops to 62.7% (~5pp is the ceiling
    anywhere in the range). The signal is real but CONTINUOUS — within-item, a higher reach fraction
    prints **9.8pp** more often (78 items vs 36, p=0.0001) — so it belongs in the rank as a continuous
    term (`askReachFactor`, where it already is), not in a binary flag a threshold move can improve.
    CLOSED as "don't tune this"; the reasoning is pinned in `reachValidator`'s header.
  - **`reach` fold BASIS flipped recent-3 → full-window; stale bump capped at caution** (0.71.3,
    2026-08-09). `staleOptimistic` does carry ~4pp at matched frac (kept) but its reject arm did not —
    those rows printed 43.3% of the time, above base rate. Retires RB-3's display/rank basis split.
    Remaining flagged split: the `--digest` reach column + `watch-positions` relief note are still
    recent-preferring, pending their own measurement. OPEN (small).
  - **`trajectory` MEASURES BACKWARDS → demoted gate→inform in `value`** (landed 2026-08-08). The
    ledger-only read (`elevated` n=2,173, `knife` n=823, no round-trip discrimination) was itself
    censored — the gate dropped its own population — so this was settled by a 71-day 1h-archive replay
    instead: `knife` **+4.08%** excess 28d return (p=0.001) vs `rising` **−7.28%** (p=0.001, the
    strongest signal in the study), `declPct` monotone the wrong way, and the hold-asymmetry premise
    reversed (extra upside +2.68pp vs extra downside −0.78pp). The classifier is sound — it predicts
    short-horizon REVERSAL and the gate rejected the favourable end of it. A would-reject knife is now
    tier-demoted BUY-NOW → WATCH; value rows finally log `validators`, so the track record accrues.
    CLOSED, with two live caveats: 71 days is one regime, and post-update GEAR dumps (the losses that
    actually hurt) are invisible at this n — that needs an EVENT study, still OPEN and unscheduled.
  - **Where exclusion ACTUALLY happens is the fetch-slot competition, not the validators.** Validators
    dropped ~14 rows in 35 days; `thin-reserve-full` dropped **2,184 candidates averaging 3.83m/day
    expected** — 4.3× the average of the `top-n-full` cut. That is the price-keyed fetch reserve already
    noted below, now with a number attached.
  - **Method note for whoever runs the next one:** a validator's `pass` is NEVER logged (`leanValidators`
    records only non-pass / would-have-gated), so "didn't fire" conflates *passed* with *not applicable*
    and there is no control arm in the ledger. Both usable studies had to REPLAY the validator's own pure
    function at each suggestion's timestamp to rebuild the real arms. Budget for that.
  - **Universal caveat:** `avgLow ≤ level` / `avgHigh ≥ level` are PRINTS, not fills — absolute rates are
    upper bounds. Bias is identical across arms, so comparisons hold; levels do not.

- **`gpDay`'s `cyclesDay` CAP OF 6 IS A THEORETICAL CEILING USED AS AN EXPECTED VALUE, AND IT
  SYSTEMATICALLY FLATTERS CHEAP CHURN OVER BIG TICKETS (Ben, 2026-08-08).** `pathA` computes
  `gpDay = marginU × units × cyclesDay` with `cyclesDay = min(6, 0.10×volDay/limit)`
  (`pipeline/lib/signal/patha.mjs:89,116-117`); the 6 is the GE 4h buy-limit reset count, mirrored as
  `AMP_WINDOWS_PER_DAY` / `VALUE_WINDOWS_PER_DAY` (`js/amplitudescreen.mjs:88`, `js/valuescreen.mjs:102`).
  Six refills/day encodes **re-buying every four hours around the clock, including overnight** — a
  presence assumption Ben does not and will not meet, and on some items those windows may not exist as
  tradeable opportunities at all. The bias is one-directional: a cheap liquid item is refill-bound and
  collects the full 6×, while a big ticket is volume-bound (`0.10×volDay`) long before the refill cap
  binds, so it never sees the multiplier. Everything ranked on `gpDay` — the 500k attention floor, the
  digest's deployable-throughput ordering — therefore compares a 6-cycle fantasy against a 1-cycle
  reality. **Ben's ruling: at most ~2× for the churn lanes, not 6×.**
  **The second half is an ATTENTION axis the metric lacks entirely.** A big ticket deploys more capital
  per DECISION: 1.57% on 12.6m in one placement is not the same good as 1.57% on 100k six times over,
  because the second costs six decisions for the same gp. `gpDay` measures gp per unit of TIME and is
  silent on gp per unit of ATTENTION, which is the actually-scarce input here. This is why a live
  Dinh's read got called "sub-floor" against a floor calibrated on churn cadence — the denominator was
  wrong, not the trade (session anchor, 2026-08-08).
  **HALF SHIPPED (2026-08-09). The WINDOWS half is done; the ATTENTION AXIS is not.**
  - *Done:* Ben set the cadence at **2 windows** ("enough for 1 band/amp flip or 2 churn flips"). The
    band/churn haircut had already landed 2026-08-08 (`expUnits`); what remained was that
    `VALUE_WINDOWS_PER_DAY` and `AMP_WINDOWS_PER_DAY` were still bare `6`s under comments claiming to
    "mirror expUnits" — two lanes sizing off a 3x fantasy. All three now read ONE constant,
    `ACTIONABLE_WINDOWS_PER_DAY`, in the new leaf `js/desk-cadence.mjs` (it cannot live in
    `gatecandidates.mjs`, which imports FROM both screens — that direction is a cycle).
    `expUnitsOvernight` keeps the physical 6 by design. `patha.mjs`'s header documented `min(6, …)`
    for a day after the haircut and is now written in terms of W so it cannot go stale again; ~12
    stale "500k attention floor" assertions across three files now say `MIN_GPD` instead of a number.
  - *Still OPEN — the actually-hard half:* `gpDay` measures gp per unit of TIME and is silent on gp per
    unit of ATTENTION, which is the scarce input. Ben's framing carries the exchange rate (a band/amp
    round-trip costs BOTH windows; a churn round-trip costs one), so the lanes should not spend the
    budget at the same rate — nothing encodes that yet. Touches the attention floor, digest ranking,
    `capEff` and every lane's sizing bound, so it still wants its own plan.
  - *Carried warning:* `MIN_GPD` 500k→250k was a RESCALE, not a re-derivation — the haircut is up to 3x
    while the floor moved 2x, so the floor now sits ~1.5x TIGHTER in effective terms than pre-haircut.
    Whether that over-binds is measurable and unmeasured. Pinned in `desk-cadence.mjs`'s header.

- **[CAP HALF FIXED 2026-08-08 — the RESERVE half remains]** The `--max-price` literal is GONE: it now
  derives from the deployable pool (`screen-flip-niches.mjs`, default = capital, `--max-price` still
  overrides). Measured effect: the cap resolved to 102.09m, band GATED rose 187→208, but RATED went
  63→62 and exactly ONE item above the old 45m surfaced (Virtus armour set, 67.89m, B — −0.4% at the
  reach-folded price, +5.3% on the asym deep-bid read). **That is the proof the cap was never the
  binding constraint.** The fetch pool is a fixed top-N ranked by velocity-weighted expected gp/day, so
  newly-admitted big tickets are displaced before they are ever fetched. The reserve below is the real
  fix; do not re-litigate the cap.

- **NO FETCH-POOL RESERVE EXISTS FOR BIG-TICKET ITEMS IN BAND/CHURN, AND THE `--max-price 45m` DEFAULT
  IS AN UNEXAMINED DAY-ONE LITERAL (measured 2026-08-08).** Asked why no big items were recommended off
  a live board with 105m idle. Three separate mechanisms, only one of which was known:
  1. **The cap.** `MAX_PRICE = 45e6` (`screen-flip-niches.mjs:193`) is a bare literal with NO rationale
     in code, `docs/`, or any plan. It traces to the tool's first implementation plan (`83ec264`,
     2026-07-03) written as `[--max-price 45m]` and has never been revisited — conspicuous beside
     `FLOOR` (recalibrated 50→3500 with a documented study) and `TOP` (40→90 on 2026-08-07, explicitly
     because it was "mis-tuned at its own reference point" vs `scaleSlots`' `CAP_REF` of **100m**). The
     codebase's stated reference bankroll is 100m while a single item is capped at 45% of it.
     `--mode amplitude` got a capital-aware affordability gate; band/churn kept the literal. That is why
     Saturated heart (78m) appears on the amplitude board but can NEVER enter band.
  2. **Lifting the cap is ZERO-SUM, not additive.** The fetch pool is fixed at top-92/niche and
     competitive. `--max-price 90m` added 10 rows and **displaced 9** — among big items a straight swap
     (gained Venator bow + Virtus armour set, LOST Nightmare staff, Dragon claws, Ring of suffering) and
     it also cost Steel bar, the only genuinely soft entry on that board.
  3. **`GEAR_RESERVE` is NOT the lever.** `--gear-reserve 10` made it strictly worse: 54 rated vs the
     55 baseline, displacing 11 including Nightmare staff AND Sanguinesti staff, to add mostly cheap
     consumables (Uncut diamond, Super energy(4), Mist rune, Gold ore). That is the documented behaviour
     of the knob — its own header says `gear` is a VOLUME lane whose "peer group is dominated by cheap
     high-limit consumables", which is precisely why `MID_TIER_RESERVE` was added as a sibling. Its
     comment also carries an un-actioned deferral: *"Deliberately NOT capital-scaled yet … then revisit
     alongside the THIN_RESERVE scaling entry."*

  **The gap:** every reserve keys on a LANE (thin/gear/mid-tier/value/explore) or a buy-limit cut. None
  keys on PRICE. So a thin big-ticket has no guaranteed representation in band/churn at any setting —
  its only reliable surfaces are the amplitude board (own pool + affordability gate) and the digest's
  `— big-ticket lane —` append. Tonight that append correctly did nothing, because the digest top-8 was
  already all big tickets. **Candidate fix:** a price-keyed reserve (`BIG_TICKET_GP`-based, capital-
  scaled off `deployablePool`) rather than raising `TOP` or the cap, both of which just reshuffle a
  fixed pool. ~~Worth pairing with the deferred `GEAR_RESERVE`/`THIN_RESERVE` capital-scaling.~~
  **`THIN_RESERVE` capital-scaling is CLOSED — DO NOT BUILD** (2026-08-09: measured economically
  backwards against 408 realised closed lots — a 1-for-1 slot reallocation out of churn into big-ticket
  gear; full reasoning at the THIN_RESERVE entry below). Any price-keyed reserve here must stand on its
  own evidence, not on that pairing.

- **THE REGIME CLASSIFIERS ARE KNIFE-EDGE ON ±1gp, INDEPENDENT OF DATA SOURCE (2026-08-08, found by
  the AF5b adversarial pass — generalises well beyond AF5b).** The discrete floor-slope and
  floor-break tests can be tipped by rounding residue in a re-derived weighted mean:
  - **Red d'hide chaps #2495** — floor slope live **−14.40** vs archive **−14.20** gp/d against a
    flat-band of ≈**14.30** (latest 2859 × `FC_FLAT_FRAC` 0.005). A **0.2 gp/d** difference straddles
    the threshold, flipping `falling/cooling` → `flat/mild-cooldown` — which **OPENS the
    falling-exclusion gate** on an item the live read excludes. That is the UNSAFE direction.
  - **Rune nails #4824** — `priorExtreme` 749 vs 748, a **1gp** difference in one day-low ~11d ago,
    flips `broke:true` → `cooling` vs `crash-risk`.

  Both survive same-span AND same-end trimming, so this is not the 15.2d age cliff and not depth — it
  is a permanent property of feeding volume-weighted means into discrete threshold tests. **The
  implication is not about the archive.** Any item whose slope sits within rounding distance of
  `FC_FLAT_FRAC × price` has a regime label that is effectively a coin flip, and the falling-exclusion
  gate hangs off it. Worth measuring how many items sit in that band on a normal run, and whether the
  discrete tests want a hysteresis/deadband rather than a bare threshold.

**ARCH-DOCS-AUDIT codification (from `PLAN-ARCH-DOCS-AUDIT.md`, Q3 "prose → code") — ALL DONE, now in the Status table above:**
COD-2 `81d9049` · COD-3 `5b91d10` · COD-4 `a923496` (plus ARCH-1 `a24d456`, DL1 `ef239dc`, COD-1 `55861d1`).
Full "what/why" per the fold-out discipline = the landing commit messages.

**Open:**
- **SAME-DAY TURNOVER AT A SMALL EXIT PREMIUM IS THE TARGET; ENTRY DEPTH IS WHAT BUYS IT (Ben,
  2026-08-07, after the first closed trade that tested any of this).** Ben's framing: *"turning over in
  a day — before I have to step away, before anything can REALLY happen — is safest and best; the hard
  part is finding items that afford us to take the 0.5%-over exit. Our low buy-in gives us the easy
  exit, which means we minimise risk."*

  **The trade that produced it.** Masori chaps: bought **25,651,000 (4.02% BELOW mid)**, sold
  **26,889,000 (+0.36% over mid)**, filled in **3h 20m**, net **+700,220 (2.73%)**. The counterfactual
  is the point — the assistant had recommended **27,149,999 (+1.34% over mid)**, and **6.4 hours after
  the sale that level still had not printed**, the highest print since being exactly the sale price.
  The cheaper exit was both faster AND, so far, the only one that existed.

  **The arithmetic that makes it a rule, not an anecdote.** Break-even is `buy / 0.98`. For an exit at
  `mid × (1+x)` to clear it you need `buy < mid × (1+x) × 0.98`. So:

  | exit premium over mid | you must buy at least this far BELOW mid to break even |
  | --- | --- |
  | +0.5% | **1.51%** |
  | +1.0% | 1.02% |
  | +2.0% | 0.04% |

  …and that is only break-even; real profit needs more. **Entry depth is therefore not a nicety, it is
  what determines whether a fast, high-probability exit is available at all.** Ben's 4.02%-below-mid
  entry is the entire reason a +0.36% exit returned 2.73%.

  **Why this beats optimising the exit.** Measured (§9/§10 of `plans/PLAN-ASK-BACKTEST.md`), a ≥10m
  item asked at +2% over mid prints **52.4%** within 3 days; at +0.5% it prints **80.4%**. The exit
  curve is steep and we do not control it. The ENTRY is the leg we choose, and every gp below mid
  converts directly into exit probability.

  **The risk argument is Ben's, and it is the strongest part.** He cannot watch the book. Time-in-
  position IS the risk — overnight moves, game updates, regime breaks. A 3-hour round trip at +2.73%
  is not a worse version of a 3-day round trip at +3.7%; it is a *different risk profile*, and the one
  that survives an owner who steps away. Capital velocity is the secondary prize.

  **What this changes about the funnel (supersedes the framing in `PLAN-ARCHIVE-FIRST-FUNNEL.md`
  AF3b).** The cream-of-the-crop question was posed as "rank candidates by expected net". The better
  target is: **rank by ACHIEVABLE ENTRY DEPTH BELOW MID** — how reliably can this item be bought 2–4%
  under its own recent mean — because that is what makes a same-day, small-premium exit feasible.
  This is measurable from the archive by exactly the method that built the ask surface, run on the
  BID side: for each item, the distribution of how far below mid it actually trades, and how often.
  Nothing about it needs a live fetch.

  **Do not over-fit to one trade.** n=1, one item, one day. The arithmetic above is exact; the
  *strategy* claim (that this dominates patient exits generally) is not yet measured. The natural test
  is cheap and offline: over the archive, compare realised gp/day of "buy 3% under mid → exit +0.5%"
  against "buy 1% under mid → exit +2%" across items and windows.

  **MEASURED 2026-08-07 — the conditioner on achievable entry depth is AMPLITUDE, not trend
  DIRECTION. Do not encode a rising/falling depth modifier.** Ben's hypothesis was: falling slightly →
  bid deeper, rising slightly → bid shallower. Tested offline on the 5m archive (250 sampled items ×
  6 reference windows at T−4/7/10/13/16/19d; trend = mean(last 6h) vs mean(prior 24h), ±0.5% bands;
  fill = any forward `avgLowPrice` at or below the bid). **The direction effect does not survive.**
  Anchored to the current instasell (which removes the bid-ask spread, the confound that dominated the
  first two passes), P(a −2% bid is hit within 4h) reads **rising 51.5% · falling 41.9% · flat 21.3%**
  — rising *ahead* of falling, the opposite of the hypothesis — and at 24h the two swap (falling 80.6%
  · rising 74.8%). A gap that reverses sign between horizons at n≈180/cell (SE ≈ 3.7pp) is noise.

  What IS robust — every depth, both horizons, all three anchorings — is **flat vs moving**: at −2%/4h
  a quiet item fills 21.3% against ~42–52% for a moving one, a ~26pp gap (~7 SE). The diagnostic that
  explains it: median bid-ask spread by class is **flat 1.57% · falling 2.96% · rising 3.85%** — the
  "trend" classifier was largely reading volatility, not direction.

  **So the AF3b ranking target above is refined, not replaced:** rank by achievable entry depth, and
  the cheap archive-side predictor of it is the item's own intraday amplitude/spread — the same
  quantity the `amplitude` flip-niche already computes. A flat item will not come to a deep bid, and
  the 1.51%-below-mid entry that makes a +0.5% exit break even is only reliably available on items
  that actually move. *Caveats:* one archive snapshot, ~180 obs/cell; a 5m bucket average at or below
  the bid means trades printed there, which is an upper bound on a real fill (queue position and
  partial fills are not modelled); and a wide spread is itself a cost — this measures whether the bid
  is HIT, not whether the round trip is profitable.

  **MEASURED 2026-08-08 — the strategy is sound but the BIG-TICKET tier is the wrong place to run
  it, and the 2% tax eats the whole spread.** Two follow-ups to the above, same method, anchored to
  the current instasell.

  *(a) Entry depth is strongly tier-dependent.* P(a bid this far below the current instasell is hit):

  | depth | `<100k` 4h | `≥10m` 4h | `<100k` 24h | `≥10m` 24h |
  | --- | --- | --- | --- | --- |
  | −1% | 55.3% | 21.0% | 82.9% | 68.6% |
  | −2% | 39.4% | **10.5%** | 71.9% | **41.0%** |
  | −3% | 31.7% | **3.8%** | 61.7% | **23.8%** |

  Within `≥10m`, splitting on 24h `relStd`: a QUIET big ticket is close to hopeless for a deep entry
  (−3%: **0.0%**/4h, 8.9%/24h, n=56) while a mid-volatility one is far better (8.5%/42.6%, n=47).
  Same amplitude conclusion as above, now on the exact tier being traded. *n is thin here — 105
  `≥10m` observations, 47–56 per volatility band (SE ≈7pp). Suggestive, not settled. Two further
  limits, both since measured on the ask side and worth carrying: these 6 windows sit only 3d apart
  across ~15 days, far less regime diversity than the ask surface's 71-day span, so the between-window
  variance that dominates there is barely sampled here; and the dense-item filter (`≥1500` 5m buckets)
  makes these numbers CONSERVATIVE, not optimistic — the sparse stratum prints MORE, not less
  (85.0% vs 77.4% at +2% on the ask side), so excluding it deflates fill probability.*

  *(b) The free depth is real but the tax exactly cancels it.* The current instasell already sits
  **2.04% (`≥10m`) to 3.56% (`100k–1m`)** below the 24h mean — median, no price move required. That
  looks like it clears the 1.51%-below-mid break-even for a +0.5% exit for free. It does not: buying
  at `0.9796 × mid` and selling at `1.005 × mid` nets `0.98 × 1.005 − 0.9796 = 0.53% of mid` before
  any slippage. **Spread capture alone is break-even; the 2% tax is the same order as the entire
  typical spread.** Real profit therefore requires a genuine EXCURSION on one leg or the other —
  which is precisely what the two tables measure as unlikely on big tickets.

  **The consequence, and it is the actionable one.** A big-ticket same-day round trip needs TWO
  independently unlikely events: a −2% entry (41% within 24h) and a +2% exit (**55.8%** within 3d —
  the AB2 surface's 45.2% is 1h-grain and understates `≥10m` by 9.4pp at this premium; see the D1
  grain finding in the AB review). Multiplied, ~23%. The sub-1m tiers are far friendlier on BOTH legs
  — `<100k` reads 71.9% for the −2% entry within 24h and 81.2% for a +2% exit within 3d, ~58%
  combined, a ~2.5× better same-day proposition.
  Ben's framing ("our low buy-in gives us the easy exit") is correct; the tier he has been running it
  in is the one where neither leg cooperates. This is also the cleanest available explanation of the
  Masori pair: chaps closed in 3h20m, the body's bid is still resting.
- **THE FUNNEL, MEASURED END-TO-END (2026-08-07, `--mode all --stats`, TOP=90, fully-deployed book).**
  Ben: *"how can we improve our funnel at each step?"* Numbers first, so the next chunk argues from data:

  | Stage | BAND | CHURN | AMPLITUDE |
  | --- | --- | --- | --- |
  | 1 · Stage-1 cheap gate | 140 gated | 93 gated | 56 admitted |
  | 2 · admission → fetch | **93 fetched · 47 crowded out** | 91 · 2 out | 54 (top 40 + 18 watchlist) |
  | 3 · Stage-2 gates | 63 survivors · **yield 68%** | 11 · **12%** | 5 · **9%** |
  | 4 · rank (Path-A gp/d) | **0/d on ALL 63 rows** | — | — |
  | 5 · digest | top-8, `rankKey = capEff × deployable` = **0 for every row** | | |

  **Finding A — capital is multiplied into the funnel THREE separate times, and all three collapse at
  `deployable = 0`.** Pre-fetch via `THROUGHPUT_CAP_GP` (`capPerWindow = pool / mid`), post-fetch via
  Path-A gp/d (the *primary console sort*), and again at the digest's `rankKey`. On a fully-deployed
  book **every band row printed `Path-A 0/d ⚠<floor` and every digest row ranked 0** — so the board's
  primary sort and the triage view were both dead simultaneously, silently falling back to grade order.
  This is the mechanism behind Ben's "we filter on capital too late": it is not only late, it is applied
  REPEATEDLY, and a product is not a ranking when a factor is zero. Decide the ONE layer that owns it.
  **Finding B — the pre-fetch ranker is not predictive of post-fetch score.** The top crowded-out row
  (Sanguinesti staff, `thin-reserve-full`) carries a Stage-1 `expGpDay` of **~12.89m/d**; fetched, it
  reads **net +88,162/u (+0.5%), rank 140k, A-**. Ordering the fetch queue by a proxy this far off means
  widening any pool mostly buys more of the wrong items — which is why `TOP` 40→90 doubled the board
  without surfacing this row at all. The `via`/`preRank`/`prePool` logging (EF-0a, 2026-08-01) exists
  precisely to quantify this; it now has a named case to start from.
  **Finding C — `THIN_RESERVE` = 6 is binding hard, and still binding at its MAX of 15.** 47 of 140 band
  candidates never got a fetch slot; the best excluded is `thin-reserve-full` at both 6 and 15. Raising
  it is a queue re-order, not a fix, until Finding B is addressed.
  **Finding D — amplitude drops 34 of 54 on reachability** (`bid-unreachable 20, ask-unreachable 14`),
  i.e. its dominant filter is the quantile-pinned estimator flagged in the entry below. Its 9% yield is
  the funnel's worst, and it is measured with a broken ruler.
  **Finding E — churn's 12% yield is mostly by design**: 54 of its discards are `band-lane partition`
  (disjoint tables in `--mode all`). True churn yield is 11/39 ≈ 28%; do not "fix" the 12%.
- **WHERE does capital filtering happen? Probably too late — filter at the cheap-fetch and digest layers
  instead (Ben, 2026-08-07, raised on landing the `TOP` 40→90 widening).** The ask: *"revisit at what
  point we are filtering based on available capital, maybe we're doing it too late. Ideally we apply
  better filters to the cheap item fetch and to the digest creation layer to reduce noise and only
  surface good candidates."* This is now URGENT-adjacent because `TOP` 40→90 **doubled the board**
  (BAND 32→67, CHURN 5→13) — the widening is correct, but it doubles what the noise filter must handle.
  **Anchor — the digest actively misranks when the pool is committed (measured 2026-08-07, fully-deployed
  book).** `rankKey = capEff × deployable` (`collectDigestRow`), so when deployable hits 0 EVERY row's
  key is 0, the ordering degenerates, and the printed board led with:

  | Item | capEff | deploy | grade | verdict |
  | --- | --- | --- | --- | --- |
  | Bronze dart | **3155.56%/d** | 0 | **D** | sell unreliable |
  | Quetzal feed | 231.42%/d | 0 | C | sell unreliable |
  | Camphor plank | 61.28%/d | 0 | C | sell unreliable |
  | … | | | | |
  | Venator ring | 4.23%/d | 0 | **A-** | **fill-now** |

  An **A- `fill-now` row sat below three D/C `sell unreliable` rows**, and **8 of 11 rows read `sell
  unreliable`** — the digest surfaced, at the top, rows it simultaneously declared untradeable. Two
  distinct defects behind it: (1) the multiply-by-deployable rank has no defined behaviour at
  deployable≈0 (a product where one factor is 0 is not a ranking); (2) capEff is unbounded, so dust
  items print 3155%/d and dominate any product they survive. Note capital ALREADY enters pre-fetch via
  `THROUGHPUT_CAP_GP` (`capPerWindow = pool / mid`, `gatecandidates.mjs`), so the digest is
  **double-counting** capital — once in `expGpDay`, again in `rankKey`. Direction (not scoped): decide
  the ONE layer that owns the capital filter, make the cheap Stage-1 proxy carry it (it is the layer
  that can drop an item before paying a fetch), and let the digest rank on *quality* among things
  already known affordable, rather than re-deriving affordability. Sibling of the capital-conditioned
  reserves entry below — same underlying question, different layer.
- **The amplitude board's `Both-leg reach` column is QUANTILE-PINNED and measures nothing (2026-08-07,
  found in a live read).** `AMP_ASK_Q`/`AMP_BID_Q` default to **0.5** (`js/amplitudescreen.mjs`), so the
  peak and trough being reach-tested ARE the median of the item's own daily highs/lows. Reaching them on
  half of days is arithmetic, not a finding. Evidence: on a 4-row board **every item, both legs, printed
  `7/14`** — the column carried zero item-specific information. The recent-3 half is then a 3-sample draw
  around that same 50% design point (P(3/3)=12.5%, P(≤1/3)=50%), so `1/3` is the single most likely
  outcome and `3/3` is a one-in-eight run, neither of which is evidence about the item. This matters
  because the column WAS *presented as the make-or-break read* in `/scan` and five other places. **CONFIRMED
  AND PARTLY ADDRESSED 2026-08-09 (DT1b + the audit rounds):** the tautology was measured — `fullFrac` min =
  p10 = median = p90 = 0.500 (sd 0.000) across 335 items, 100% of legs clear `AMP_MIN_FULL_FRAC`, and
  `amplitudeGate`'s `legOk` returns a verdict IDENTICAL to bare `!staleOptimistic` on 670/670 legs. It is
  inert at any quantile ≥ 0.5, binding only below it. Every doc calling it decisive has been corrected, and
  the make-or-break role passed to the MEASURED walk-forward `round-trip` cell (`ampWalkForward`). **The GATE
  ITSELF IS UNCHANGED and this entry stays open** — the honest repair is walk-forward legs, which moves which
  rows appear and was not taken unilaterally. Note the reject reasons `bid-unreachable`/`ask-unreachable` are
  misnamed on a default run: every such drop is a stale-optimistic drop. **Contrast with the reach numbers
  that ARE real:** `read-window-range --ask/--bid` tests an OPERATOR-CHOSEN level against the daily
  distribution, so a `0/14` there genuinely means the level has not traded — those stay trustworthy. Fix
  direction (not scoped): either print the reach of a level that is NOT the median (so the number can
  differ from 50%), or replace the column with the in-window pool + placement percentile the `⊙ avg-bound`
  clause already argues for. Do NOT simply delete it without a replacement — the underlying question
  ("do both legs actually fill?") is the right one; only this estimator of it is degenerate.
- **`--mode reverse` names its rejects but never says WHY (2026-08-07).** The header prints
  `## REVERSE-FLIP — 17 owned candidate(s) to harvest (9 rejected: <names>)` with no per-item reason,
  so a direct question ("can I reverse-flip Ancestral?") is unanswerable for the rejected two-thirds
  without re-deriving the gate by hand. Every sibling surface already prints its drop reasons (the scan's
  `dropped Stage-2: … bid-unreachable 20, ask-unreachable 15, trend 5 …` line). Fix: carry
  `gateReverseFlipCandidates`' rejection reason through to the console the same way, ideally as a
  one-line-per-item tail rather than an aggregate, since the pool is ownership-bounded and small.
- **Ownership does not model GE set ⇄ component convertibility (2026-08-07, Ben-corrected).** The GE set
  exchange converts a set to its pieces and back at no cost, so holding Ancestral hat + robe top + robe
  bottom **IS** holding an Ancestral robes set. `owned-items.json` treats them as unrelated ids, so
  `--mode reverse` screened the three pieces individually (taking only the bottom, `swing-below-floor`
  at 1.9% vs a 2% tax) and never considered the set — which has a **5.8% gross / 3.7% after-tax** daily
  swing and is the tradeable expression of the same holding. Live measurement the same day: the set's
  mid carried a **~1.2% premium** over sum-of-parts (227.33m vs 224.68m), so selling as a set nets
  **~+3.5m more** than selling the pieces, before any directional view. Two consequences — (1) reverse-flip
  eligibility is under-counted wherever a convertible set exists, (2) there is a standing pieces→set
  arbitrage the screen cannot see (one-way only: buy pieces → sell set clears ~+1.95m passively; buy set →
  sell pieces is ~−3.3m and structurally dead). Needs a set↔components mapping; the wiki mapping data may
  already carry it. Ben owns several affected sets (Ancestral, Masori (f), Justiciar).
- **The cushion / trajectory notes label an INCOMPLETE day "today" (2026-08-07, caused a real misreport).**
  The all-day series' last point is the current, still-forming day, but the reach-margin per-day cushion
  line renders it as a completed observation. On 2026-08-06 this had me relay "+1.39m today · cushion
  extending" for Masori body when the number was the PRIOR day's — the kind of error the `⚠ stale live
  print` guard exists to prevent on the live side, with no equivalent on the daily side. Note
  `read-window-range` already does this correctly elsewhere (`today forming low X/high Y (provisional)`),
  so the fix is to propagate that existing `(provisional)` treatment into the cushion/reach-margin
  per-day list rather than invent a new convention.
- **Estimator fidelity vs the daily distribution — `plans/PLAN-ESTIMATOR-FIDELITY.md` (2026-08-01,
  PLANNING ONLY).** The discovery `Est.` pair prices the 2h band and clamps the daily-basis diurnal
  levels inside it (`reach-fold.mjs:132`, `buyLo` `:143`), so a verifier-confirmed daily ask/dip is
  structurally unquotable; the rank zeroes on a dead bid instead of repricing the entry (the
  Helm-of-neitiznot burial); churn's symmetric fold exemption has no placement bound (the
  Sapphire-dragon-bolts mirage top); windows/day is an assumed ×6 in four homes while
  `diurnalTimedLap`'s measured cycle count is shadow-only. Chunks EF0–EF3, evidence-first
  (counterfactual report gates every promotion; anchor = n=5 laps on ONE item, rule 4). Starvation
  is deliberately left to the `FPS 1–4` Status row + the capital-conditioned-reserves entry below;
  the band sell fold moves only via AC7's re-decision path (`reach-fold.mjs` header).
- **~~Thin-reserve should scale with `--capital`~~ — CLOSED **CAPITAL-CONDITIONALLY** 2026-08-09,
  corrected 2026-08-10. DO NOT BUILD *at present capital*.**
  `plans/PLAN-THIN-RESERVE.md` is now COMMITTED (it was a local uncommitted file, which is why this entry
  restated its reasoning inline; read the doc for the full argument). Verdict: **DO NOT WIDEN
  `THIN_RESERVE`, DO NOT DEFAULT-ON `--scale-pool`, DO NOT BLEND TO MERIT** — at Ben's capital. Widening
  costs nothing in fetch budget, so the question is never "can we afford it"; it is a pure **1-for-1
  REALLOCATION** of slots out of the cheap-churn velocity lane into big-ticket gear.
  ⚠ **THE STATED REASON WAS WRONG AND IS RETRACTED.** This entry justified the closure with *"Ben's own
  408 realised closed lots say that trade loses"* (the doc's §3c ">20m is the worst tier, 2.8:1"). That
  doc's OWN red-team pass marks §3c **DOWNGRADED** (n=20; 47% of the capital denominator is zero-P/L
  non-flips; bootstrap CI [0.26%, 7.04%]; **the 2.8× figure could not be reproduced**) and the
  class-underperforms claim **NOT SUPPORTED** (the tier is 100% gear, so class effect and
  update-sensitivity are inseparable). **Stop citing §3c.** The surviving reason is different and
  narrower: *capital binds before slots, so gear cannot deploy here anyway* — widening buys ~0.5m/d of
  harm on a constraint that is not even binding (`top-n-full`).
  **It is therefore NOT a permanent rule.** Above ~400m deployable, excluding gear strands capital at
  zero, so the closure **OVERTURNS at the top end**; the doc sets a **revisit trigger at ~150–200m
  deployable**. Anyone re-opening this needs new outcome evidence, not a fresh scan anecdote — but it is
  a question to revisit on capital growth, not a settled no. The text
  below is kept for its history and its CORRECTED anchor, but **it is no longer a directive: do not
  implement the "Fix" it describes.** (It also
  had a live self-contradiction — the ⚠ anchor correction two paragraphs down already showed the three
  named items do not reproduce and that the starved population is mostly CHURN, not thin big-tickets, so
  tuning `THIN_RESERVE` off it would tune the wrong reserve.) Original text follows:
  **Thin-reserve should scale with `--capital` (screen fetch-admission, `pipeline/lib/signal/admission.mjs`
  `pickFetchPool`) — surfaced 2026-07-23, Ben-flagged.** `THIN_RESERVE` is a fixed 6-slot guarantee for
  thin gp-flow big-tickets regardless of bankroll. At high capital (162m trial) the fixed 6 starves the
  thin big-ticket band lane: a default `--top 40` scan buried Sanguinesti staff (uncharged, A-, +607k/u
  P~95%), Basilisk jaw (A-), and Webweaver bow (B) — they only surfaced at `--top 90`. The bug: the
  reserve caps the number of thin big-tickets that get a fetch slot to a constant, but the number Ben can
  actually deploy into scales with capital. Fix (for the screen-architecture chunk, NOT a live tweak off
  one scan, rule 4): make the reserve a function of `--capital` (more idle capital → more guaranteed thin
  big-ticket slots), so a high-bankroll scan doesn't need a manual `--top 90`. Owner: whatever chunk next
  touches `pickFetchPool` / the admission ordering. ~~Interim workaround: pass `--top 90` for scans at
  ≳100m.~~ **RESOLVED for the band/churn pool 2026-08-07 (Ben): `TOP`'s default is now 90, so the manual
  workaround IS the default.** Measured +419ms for BAND 32→67 and CHURN 5→13, strictly additive. Note this
  makes `--scale-pool` a no-op on THIS pool (90 == `TOP_MAX`); it still governs THIN_RESERVE/VALUE/AMP.
  **`AMP_TOP_DEFAULT` is untouched at 40** — amplitude has its own pool and did NOT widen (visible now in
  the corrected run header, `top band 90/churn 90/amplitude 40`), so the "scan for more big-ticket
  oscillators" question is still gated at 40.
  **⚠ ANCHOR CORRECTED 2026-08-07 (paired live A/B at 100.75m — full table in the `FPS 1–4` Status row).**
  The widening is real and strictly ADDITIVE (band 31→68 rows, none lost), but the three items named above
  do NOT reproduce: Sanguinesti staff, Basilisk jaw and Webweaver bow appear in NEITHER pool. Sanguinesti
  staff left the board between two consecutive default scans on its own degraded numbers, not on admission.
  The dominant gain is **CHURN S+ 2 → 10** — the starved population is mostly churn-class commodities, NOT
  the thin big-tickets this entry claims. Tuning `THIN_RESERVE` off the old anchor would tune the wrong
  reserve. n=1 paired run at one capital level: enough to correct the anchor, not to flip a default.
  **Sibling: MT2's `GEAR_RESERVE` (Status table above, shipped 2026-07-27)** — same function, a DIFFERENT
  starved population (mid-price gear on the velocity lane, which had no reserve at all, vs thin big-tickets
  whose reserve is merely too small). MT2 landed FIXED, deliberately un-capital-scaled, so one before/after
  scan can be read. This remains the BIGGEST of the three starvations by the system's own metric: 34 thin
  candidates compete for 6 slots, with excluded rows ranked as high as 6.94m/d expGpDay — roughly 5× what
  the gear/mid-tier reserves reach at all. **Subsumed by the entry below — do not do this one in isolation.**
- **CAPITAL-CONDITIONED RESERVES — the reserves bypass a ranking that is already capital-aware
  (owner's reframe, 2026-07-27).** The stated goal is *"surface the correct candidate pool based on
  available capital"*: mid-tier flips are probably not lucrative at high bankroll and should not crowd the
  pool there, **but if they ever became lucrative they must show.** Key finding: the RANKING already does
  this. `expGpDay` is capital-aware through `THROUGHPUT_CAP_GP` (`capPerWindow = pool / mid`,
  `gatecandidates.mjs` DEFAULT_THRESHOLDS note), so a small pool caps affordable units on expensive items
  and naturally promotes cheaper ones; a large pool stops binding and big tickets win on net/u. What is NOT
  capital-aware is every RESERVE — `THIN_RESERVE` 6, `GEAR_RESERVE` 4, `MID_TIER_RESERVE` 2 are fixed slot
  counts, and a reserve is BY CONSTRUCTION a standing bypass of the ranking. So they pay the same cost at
  10m as at 500m, which is exactly the failure the owner named. Direction (not yet scoped): condition each
  reserve on whether its class is plausibly deployable at the CURRENT pool rather than sizing it by hand —
  for mid-tier the natural test is `limit × mid` (max deployable per 4h window) as a fraction of
  `THROUGHPUT_CAP_GP`; Helm of neitiznot is ~3.4m/window ≈ 3% of a 100m pool but ~34% of a 10m one. That
  makes a reserve self-retiring at high capital and self-activating at low, with no hand-tuned constant per
  class, and it unifies the three reserves under ONE rule instead of three numbers. Open question to settle
  first: whether reserves should remain standing quotas at all, or become bounded DISCOVERY mechanisms with
  rotation/decay like the exploration reserve already is. **RESOLVED (Ben, 2026-07-27): neither — they are
  VALIDATION SCAFFOLDING with an exit condition.** Keep them in the short term precisely because we are
  still validating; **once the top-N is proven to surface the best candidates for the capital pool, the
  reserves are not needed at all.** So the work is not "make three constants adaptive" — it is "prove or
  disprove the ranking, then delete the scaffolding". Recorded in `admission.mjs`'s header so a future
  editor doesn't entrench them. All PLACEHOLDER, n=0.
- **~~Log `via` into `suggestions.jsonl` — the prerequisite for retiring the reserves (2026-07-27,
  small).~~ DONE 2026-08-01 as EF-0a (PLAN-ESTIMATOR-FIDELITY's logging prerequisite chunk).**
  Each reserve admission is a natural experiment: an item the ranked top-N would NOT have fetched, fetched
  anyway and then scored post-fetch. Comparing `via`-tagged rows against ranked-in rows is exactly the
  evidence that settles "does the top-N already surface the best candidates for this capital" — and
  therefore whether the reserves can be deleted.
  **Shape (Ben, 2026-07-27): CASE-BY-CASE, not a standing rollup** — the real use is diagnostic (*"how did
  a reserve's picks rank in the overall list?"* — 12th of 178 says the slot isn't earning its keep; 87th
  says it reaches genuinely far down), so no `analyze-record.mjs` aggregate; just enough per row to make
  that a lookup. **Shipped exactly that:** `pickFetchPool` (`admission.mjs`) stamps every gated candidate's
  `preRank`/`prePool` (position in the pre-fetch ordering — band/churn: the `expGpDay × softFactor ×
  trackBoost` unified score; value: `valueScore`; amplitude: `ampProxy`), and the screen's log sites thread
  `via` + `preRank`/`prePool` (+ the already-computed `askPlacement` percentile) through `suggestionEntry`
  as lean fields; each pass also appends ONE admission-exclusion aggregate line per niche (the crowded-out
  set with SC1 reasons — `suggestlog.mjs excludedShadow`; itemId-less, skipped by every fill joiner).
  Behaviour-neutral (console + `screen.json` byte-identical; ledger-only, ~+19KB/`--mode all` pass). The
  retirement comparison and EF0's counterfactual can now accrue; anything logged before 2026-08-01 has no
  provenance — the datapoints those passes discarded are gone (the urgency was real).
- **~~Class B mid-tier: does the `FLOOR` 50 → 3,500 recalibration overshoot the mid band?~~ SUPERSEDED
  2026-07-27 — that asked about the wrong constant. The real blocker is the EDGE floor, not liquidity.**
  Berserker helm (780/d), Dragon scimitar (1.7k/d) and — newly identified — **Rune platebody** never become
  candidates. The original framing blamed `FLOOR`/`GP_FLOOR`. PLAN-MID-TIER-V2 disproved that by running the
  already-built (but **not CLI-reachable** — `THRESHOLDS` never sets `GATE`, and no `--gate` flag exists)
  structural admission path: **all three PASS `structuralGate` comfortably** (notional 84m / 471m / 4,251m
  per day, far above the 25m floor) and are still excluded — every one of them by `bandEdge`'s **1.5%
  `MIN_ROI` floor**, with the thin-escape (`modeNet ≥ 100k/u`) nowhere close at 57–220 gp/u actual. Rune
  platebody additionally fails `churnEdge`'s 65k volume floor at 20.3k. So Berserker helm/Dragon scimitar
  (once thought liquidity-gated) and Rune platebody (once thought a separate cause) are ONE gap: their 2h
  bands are genuinely tight (0.15–0.57%), which no reserve reaches and no liquidity threshold explains.
  Still deliberately NOT a code chunk — the honest fix is a NEW edge treatment for tight-band,
  moderate-notional, low-buy-limit items (closer to `js/valuescreen.mjs`'s multi-day term-structure shape
  than to `band`'s fast 2h-flip ROI gate), NOT loosening `MIN_ROI`/`CHURN_MIN_VOL`, which would silently
  change behavior for every existing band/churn candidate on n=0 outcomes (rule 4). Prerequisite: wire a
  `--gate` flag and flip the structural default (PLAN-LANE-ADMISSION Chunk I) — that is what makes this
  population reachable at all, and it is bigger than "flip a default".
- **Diurnal funnel-widening (fast-follow to the 2026-07-09 diurnal engine):** the hour-of-day
  `hourProfile`/`deriveDiurnalRange` engine + the screen's `Diurnal timing` block auto-run on SURVIVORS
  only (free — series in hand). Ben's open question — "are the gates EXCLUDING items that are profitable
  under the detailed diurnal read?" — needs the bounded experiment: run the profile on a fetch-budgeted
  set of gate-excluded rows (reuse the `subFloorFallback` "peek below the gate" primitive), and LOG which
  would've been profitable at fill-correct diurnal prices → emit a "diurnal candidates" list (NOT
  auto-added to the curated `watchlist.json`; Ben promotes). Costs 1h fetches (the gate funnel's expensive
  step) so it needs a budget. Honest prior (rule 4): the deep read has so far DISQUALIFIED picks (Virtus,
  Ghrazi) as often as promoted, so this may tighten the shelf rather than widen it — either outcome is signal.
- **Value niche lacks the LM1 limit stage (LM1 `9517655`, 2026-07-09):** `--mode value` renders via
  `valueGate`, not `runValidators`, so `limitValidator` doesn't reach it. Provisional/off-by-default
  (n≈0) — wire the limits stage in when the value path grows a validator pass, not before.
- **Spread/rising consolidation — RESOLVED (Steps 3+4, Ben 2026-07-09):** `spread` AND `rising` specs
  DELETED (`js/flip-niches.mjs`; git history is the reference). SUPERSEDES NY2/NY3. Rising's proxy-first
  fetch ordering absorbed into `rankAndSlice`'s rising reserve; residual thin-big-ticket lane caught by
  band's thin path. Detail: `git show f982a31` + the deletion commits.
- **Traded-band gate (Bar D) — DONE `0ed7aa1` (Ben 2026-07-09).** Decoupled DENSITY (`tradedWin`) from
  TWO-SIDEDNESS (`sawLow && sawHigh`) so genuinely-liquid big tickets stop failing the old both-in-one-5m-
  bucket `active5m` count. Invariant lives in the `bandCore` header (`js/flip-niches.mjs`); pinned by replay
  archetype 2003.
- **Band EDGE robustness (Bar E) — DONE `dba20b4` (Scope A) + `7056846` (Scope B, 0.55.0).** `robustBand`
  (home in `js/quotecore.js`) takes p90/p10 on a DENSE side, raw extremum on a SPARSE side, killing the
  band-top artifact in both the pipeline `bandCore` edge and the app's Optimistic column. Invariant lives in
  the `robustBand` header; pinned by `pipeline/test/bandedge.test.mjs` + the `quotecore.test.mjs` Scope-B split.
- **Churn per-lap rank + band partition — DONE `8c84fac` (Step 6, Ben 2026-07-09).** Churn ranks the LAP
  (`net/u × min(limit, feasibleDepth) × P ÷ TTF`) via its own estimator family; `--mode all` partitions
  churn disjoint from band by margin (render-stage, replay goldens untouched). Detail: the landing commit.
- **PM1 follow-ons (deliberate, not scope-cut — PM1 `6aba80b`, 2026-07-08):** (1) the **watch
  surface** for probes — dip inverts to "average-down window" on an owned lot (the framing is
  already coded in `modules/dip.mjs` behind `ctx.owned`; wiring watch.mjs to run probes is the
  chunk); (2) an **app `Probes` column** (APP_VERSION bump — separate step, published-cells
  contract change); (3) ~~firing logs~~ — SHIPPED as **PM2** `5ca4f95`; the remaining piece is
  the **SCORING pass** (read `pipeline/modules/<name>.log`, judge hit/miss against subsequent
  price action, graduate-or-delete — needs firings to accrue first). decant also models no
  decant fee/low-dose fill liquidity — documented in-file, a firing is a prompt to check, not
  an edge.
- **TG1 follow-on (deliberate):** the app Watch tab could adopt the declared `hold-thesis.json`
  silence (it currently shows the ungated verdict) — separate chunk, APP_VERSION bump.
- **P2 follow-ons (2026-07-08):** (1) `reachValidator` has NO live consumer — screen/quote lack
  `ts1h`, so the reach gate can't fire; wire it into `watch.mjs` (which fetches ts1h per target)
  or give screen/quote a budgeted top-rows ts1h fetch. (2) the screen drop/footer/caution paths
  are validator-unit-tested but not exercised end-to-end — a synthetic reject forced through
  `renderMode` (replay-harness archetype?) would close the gap.
- **P3 follow-ons (2026-07-08):** floorValidator is not yet driven by a declarative strategy
  spec — the `ctx.floor.level` namespace is the natural hook for P4c/P5's per-strategy buy
  candidate (and where the falling-doctrine amendment's history/typical-fluctuation review
  gets its numbers). Its direction-agnosticism (mid-range buy on a risen item → caution) is a
  deliberate conservatism to revisit with F1/P6 evidence.
- **P4a follow-ons (2026-07-08):** (1) TWO overlapping thesis stores — gitignored
  `session-thesis.json` (free-text intent) and tracked `hold-thesis.json` (gating, now
  path-carrying) BOTH carry a `tripwire` and are both touched by `thesis.mjs set` (`--tripwire`
  still targets the session one, a string; hold-thesis's is numeric). Pre-existing confusion the
  P4a spec inherited ("sole writer" was wrong); P4b/P7 should unify the CLI surface or split the
  stores' responsibilities in docs. (2) replay archetype 2004's REAL `phase()` likely computes
  `basing` (flat recent lows), not `decay`, despite the "decay-knife" name — P4a's fixtures set
  derived ctx fields directly so it doesn't bite yet, but P4c/P5 wiring off the real series
  should verify the archetype's phase label before leaning on it.
- **P4b follow-on (2026-07-08):** `quote.mjs --positions`' read-only `pathsStage` run mutates
  `ctx.position.newStateEntry` with path fields it never saves — harmless today, but a P8
  single-writer must know the entry is confirm-advanced on quote's clock too if it ever
  persists it.
- **P0 follow-ons (2026-07-08, from the lane's honest report):** (1) quote `--positions`
  conviction runs WITHOUT the structural-support arm (booked-lots view fetches no ts1h, so
  `support/cutTrigger` are null — timers present, support-break arm absent); P4b could thread
  them in, or quote could add a ts1h fetch. (2) the position stage computes `newStateEntry` but
  only watch persists it — a P8 desk orchestrator owning the single writer could let quote
  contribute observations to the shared watch-state too.
- **Guide re-anchor prediction model (follow-on to YP1 `a93da6a`, Ben wants this edge):** capture
  is live (`.guide-history.jsonl`, change-only lines at watch cadence). The chunk to build once
  samples accrue: per-item update-time estimate + magnitude model (yesterday's realtime drift ≈
  today's guide step), surfaced as a line on `quote.mjs`/`watch.mjs` rows and folded into the
  ask-pricing doctrine (price asks against the POST-update guide when the update lands before
  the sell window). Honesty: needs days of history before the timing claim is real.
- No `--niche` keyword flag on `screen.mjs` (skills filter output rows by hand; a flag is
  a possible future convenience).
- ~~**Liquidity-`class` volume-source split (SF-3, pre-F1; = the deferred ARCH-3 half)**~~ — **DONE `3a36a1e`**.
  The problem: the logged `class` derives from `volDay = min(hpv,lpv)`, whose hpv/lpv came from DIFFERENT
  endpoints (quote's per-item `/24h?id=` vs screen's bulk `loadAll24h`/`all24h.json`), so the same item
  could straddle a `liqClassOf` boundary (Toxic blowpipe `mid` vs `thin`); `outcomes.mjs` re-derives class
  from the stored `volDay` so re-deriving did NOT launder it — a pre-F1 calibration pollutant. The APPROVED
  combined fix (Ben 2026-07-10): (1) a `volSrc` tag (`bulk`|`peritem`) lean-threaded through
  `suggestionEntry` — the honesty layer F1 normalizes on; (2) a fetch-free warm-only bulk read
  (`marketfetch.readWarmAll24h(dir,ttl,now)`/`loadAll24hWarm()` — synchronous, NO network path, null when
  cold/stale) so `quote.mjs` converges on the bulk snapshot when a recent scan warmed `all24h.json` (and
  `--positions` reuses `snap.v24` loadSnapshot already fetched ⇒ zero extra fetch), else keeps the per-item
  volume tagged `peritem`. The hard constraint — NEVER a cold ~4000-item bulk fetch for a 1-item ask — is
  structural (the warm accessor cannot fetch). Pure `classAndSource(row,id,warmBulk)` picks class+source;
  `screen.mjs` tags `bulk`. Pinned by `pipeline/test/sf3-volsrc.test.mjs` (class-parity + fetch-free); docs
  FILLS-PIPELINE.md §11.1 + README. Pipeline-only, no APP_VERSION (lane O 2026-07-04; approved + shipped 2026-07-10).
- `js/backup.js:23` stamps the backup filename with the UTC date (`toISOString().slice(0,10)`)
  — a late-evening local backup gets tomorrow's date in the name. File-artifact only, not a
  displayed time; switch to a local slug if it ever annoys (lane E, 2026-07-04).
- gp-flow ∩ `--max-price` default (45m): big tickets above 45m (Twisted bow, Elder maul…) are
  still excluded by the default price window — the gp-flow path only helps inside it. Not a
  bug; raise `--max-price` (or its default) if Ben wants them surfaced by default (lane S,
  2026-07-04).
- The 500k `--min-gpd` floor nearly empties the churn niche (~2 rated) — expected given churn's
  thin per-unit margins, but if churn should stay useful it may need a niche-specific floor
  exemption (lane S, 2026-07-04).
- Signals render 2-3× during init (`market.js:96-101`: `renderAll` → bare `computeSignals`
  → `archiveWatchlist().then(computeSignals)`) — idempotent, functionally fine; note for a
  future perf pass, not a bug (audit, 2026-07-05).
- ~~`parseGp` divergence comment~~ — **DONE `6808c58`** (ARCH-3 part): cross-comments now in both
  `pipeline/lib/cli.mjs` and `js/format.js` documenting the intentional app/pipeline behavior split.
- **Arch-sweep followups (2026-07-10 review/sweep; the residue after the innocuous fixes landed in
  `ef68792`). None has a demonstrated live cost — hygiene/reuse, not bugs.**
  - ~~**SF-1 (MED) — quantile/median type-7 has THREE copies**~~ — **DONE `2cbca38`** (0.56.0): one
    shared home in `js/quotecore.js` exporting BOTH contracts — `quantileSorted(sortedAsc,q)` (pre-sorted,
    no sort) and `quantileOf(arr,q)`/`median(arr)` (copy+sort, never mutate). termstructure re-exports
    `quantileSorted`; retrojoin uses `quantileOf`. Caller audit preserved every site's sorted/unsorted
    contract; byte-identical (type-7 at q=0.5 IS mean-of-two-middle median), fixture-pinned in
    `quotecore.test.mjs`. APP_VERSION bumped (quotecore.js is app-served; TC1/TD2 precedent).
  - ~~**SF-2 (LOW) — `quote.mjs` per-item ts1h fetch (COD-4) is uncapped across a batch**~~ — **DONE**
    (2026-07-10, comment-only): the amplification (`quote A B C … J` = one 1h fetch per item, budget
    unenforced) is now documented at the fetch site with the soft-cap recipe for if large batches ever
    become routine. Ben ruled the comment sufficient — a soft cap is machinery for a non-problem.
  - **SF-4 (LOW) — two `UA` strings drifted** (`js/marketfetch.js` `0.30`, `pipeline/lib/marketfetch.mjs`
    `0.28`, vs `APP_VERSION 0.55`): the version token is dead-decorative (the wiki API doesn't gate on it;
    the contact string is what matters). Drop the version number from both UAs to kill the drift surface;
    the app-file touch is a rule-5 deployed change (APP_VERSION bump + smoke), so bundle with the next
    genuine app change or SF-1's js/ pass.
  - **SF-5 (cosmetic — skip unless a Finder/forecast pass happens anyway):** `js/market.js:171`
    `ratingParts` terse field names (`roiS/volS/…` vs the spelled-out style); PF1 `js/forecast.mjs`
    `atHours` (dip/peak cluster window) vs `etaH` (global-extremum hour) can point at slightly different
    hours under a sub-`trendDominates` trend (label only — level+eta stay correct); README/commit claim
    "`forecast.mjs` imports windowread" but the module has no import (it consumes a passed-in profile).
- **DOC-5 / ARCH-2 stay Ben-gated proposals** in `PLAN-ARCH-DOCS-AUDIT.md`: DOC-5 = skills anchor
  compression (table-first per the P7 precedent — compress incident STORIES to `rule + anchor + LORE`
  pointer, keep the rules); ARCH-2 = thesis-store unification (the same two-store `tripwire` hazard
  already noted in the P4a follow-on above — a product-semantics ruling, not a mechanical fix). Not
  started by design.
- Log-file discovery near-duplicated between `sync-fills.readLogFiles` and
  `offers.readExchangeLog` — partly justified (`--log-dir` override, mobile file); unify
  only if either changes again (audit, 2026-07-05).
- Named price alerts fire on the live mid; side-specific semantics ("alert when I could *sell*
  above Y" = instabuy basis) is a one-line change but a product decision for Ben (lane N,
  2026-07-04).
- Fill-alert dedupe keys on `slot:item:state:date+time` — if the Exchange Logger re-logs an
  identical terminal line at a different timestamp (the re-log behavior that motivated
  `collapseOffers`), a fill could alert twice. Low risk in the 60-min window; watch during the
  N1 live trial (lane N, 2026-07-04).
- No mobile editor for already-synced fills: mobile can edit/delete *pending* rows, but a fill
  already in `positions.json` only offers local "Hide" — a mobile `editManualLog`-equivalent
  (append a REMOVE tombstone for a chosen synced event id via the contents API) is the natural
  follow-up (lane M, 2026-07-04).
- Watchlist write-back stores ids, not names — `watchlist.json` flips names→ids on the first
  mobile toggle. Harmless (`loadRepoWatchlist` resolves both), but hand-editors of that file
  should know (lane M, 2026-07-04).
- `mobile-fills.log` grows unbounded (append-only by design, like `coffer-manual.log`) — a
  future compaction of absorbed/tombstoned lines could trim it (lane M, 2026-07-04).
- LH2's blind-warning heuristic can't catch the *false-EMPTY snapshot* restart variant: a
  client bounce made the plugin write a fresh all-slots `EMPTY` snapshot (16:10:02
  2026-07-05) while real offers stood in-game — log is FRESH (so the staleness gate never
  fires) yet every slot reads empty and watch prints NOT LISTED for listed items. Detectable
  signature: an all-slots-EMPTY re-emit burst arriving with no intervening fill/cancel
  terminals while the pipeline FIFO says inventory is held (and/or offers were visible in
  the immediately-prior log state). Display-only warning like LH2, same header channel —
  never verdict input, and EMPTY stays non-evidence for fills (don't resurrect the deleted
  cancel-to-EMPTY inference). Watch-loop session, 2026-07-05.
- P1's `dedupeSnapshots()` runs inside `reconstruct()` (positions.json + `monitor.mjs`), but
  `outcomes.mjs` calls `collapseOffers`/`matchTrades` directly for campaign boundaries, so its
  campaigns can still see a snapshot-duplicate terminal as a phantom offer. Low impact (outcomes
  is derived/gitignored), but adopt `dedupeSnapshots` there if campaign counts ever look off
  (P1, 2026-07-05).

**Resolved / promoted:** `gateCandidates` testability → chunk **GC1**; LF/CRLF warnings →
chunk **GA1**; `fetchInputs` triplication → chunk **X1**; `suggestions.jsonl` unbounded growth
→ chunk **SR1**; README pipeline-inventory gap → shipped in **D1**; cross-invocation fetch cache →
shipped as **FC1**; guide re-anchor capture → shipped as **YP1** (prediction model stays Open above).
The YIELD wave also left these DEFERRED (honesty-gated, not dropped): in-app fill-probability + the
Trends "recommend price adjustment" button (both need **F1** open + a published outcomes artifact);
`outcomes.mjs` `dedupeSnapshots` gap is now CLOSED (YS1). The scan per-row velocity tag deferral is
now **SHIPPED** (`7502889`) as a stdout velocity FOOTNOTE (`lib/velocitytag.mjs` reads the gitignored
`outcomes.json`) rather than a table column — kept out of the published cells so the canonical
table/`screen.json`/app contract stay byte-identical (same discipline as the phase fold). Also
shipped post-YIELD: **total-capital view** (`2fdae81`) — `capitalutil.totalCapital` + `lib/cash-anchor.mjs`
+ `pipeline/commands/derive-cash.mjs` add a committed + STATED idle-cash line to the watch footer (idle GP is in no
log, so it's a stated snapshot, staleness-bannered, never a verdict input). SUPERSEDED
(PLAN-CASH-TRACKING): the footer's idle figure is now DERIVED (`lib/derive-cash-tiers.mjs` —
anchor + log flow, escrow-excluded `availableCash`), and `screen.mjs`'s value `--capital` default +
`loop-tick.mjs`'s scan-gate now use the derived **`deployablePool`** — the THREE-TIER model
(`availableCash ≤ deployablePool ≤ liquidCapital`, `lib/derive-cash-tiers.mjs`): deployablePool = free cash +
reclaimable DEEP-bid escrow (bids priced ≥ `DEEP_BID_PCT` below a caller-supplied market ref; a near-live
flip bid stays COMMITTED), superseding the looser `liquidCapital` default. Earlier per-plan Discovered
lists (chunks 4/8/10 fixes) are preserved in git history — `git show 39e5d23:PLAN.md`.
