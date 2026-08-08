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
| gated | **F1** (algorithm feedback) — opens only when O1's sample thresholds clear |

## Status

Detail per ✅ row = the landing commit message (`git show <sha>`) + `CHANGELOG.md`.

| Chunk | What | Primary files | State |
| --- | --- | --- | --- |
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

## Discovered

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
  **Not yet scoped.** Touches the attention floor, digest ranking, `capEff`, and every lane's sizing
  bound, so it wants its own plan — and the recalibrated floor must be re-derived, not just rescaled,
  since dropping churn 6→2 moves the whole distribution the 500k was set against.

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
  fixed pool. Worth pairing with the deferred `GEAR_RESERVE`/`THIN_RESERVE` capital-scaling.

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
  because the column is *presented as the make-or-break read* ("the make-or-break read is the Both-leg
  reach column" — `/scan` SKILL.md) and it is what an operator ranks on. **Contrast with the reach numbers
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
  is deliberately left to PLAN-FETCH-POOL-SCALING + the capital-conditioned-reserves entry below;
  the band sell fold moves only via AC7's re-decision path (`reach-fold.mjs` header).
- **Thin-reserve should scale with `--capital` (screen fetch-admission, `pipeline/lib/signal/admission.mjs`
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
  **⚠ ANCHOR CORRECTED 2026-08-07 (paired live A/B at 100.75m — full table in `plans/PLAN-FETCH-POOL-SCALING.md`).**
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
