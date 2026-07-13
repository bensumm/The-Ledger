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
  `node pipeline/run-tests.mjs` (the auto-discovery runner — runs every `pipeline/**/*.test.mjs`)
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
| DL2 | Reactive liquid-flush loop — `flushSignal` + `watch.mjs --dip` FLUSH alert (bid-into-the-fall, liquid-only, unit-flow fillability); widened SIGNAL log (liquid+illiquid, `alerted`/`gatedReason`) + `analyze.mjs §4` candidate-surfacing retro; PLACEHOLDERS n=2, ALERTS-never-places | `js/quotecore.js`, `pipeline/watch.mjs`, `pipeline/lib/suggestlog.mjs`, `pipeline/lib/analyze.mjs`, `pipeline/analyze.mjs`, `dip-watchlist.json`, `pipeline/diploop.test.mjs` | ✅ `73eb65e` |
| DL4 | Scan auto-nominates dip candidates ("B feeds A") — pure `nominateDip`/`selectNominations` (zero-fetch flush-suitability over the gate-tier universe) append flush-suitable picks to `dip-watchlist.json`; polymorphic `--dip` reader; PROPOSALS-to-watch, PLACEHOLDERS n=2 | `js/quotecore.js`, `pipeline/screen.mjs`, `pipeline/watch.mjs`, `dip-watchlist.json`, `pipeline/dl4nominate.test.mjs` | ✅ `6c9abf2` |
| DL3 | Flush-distribution → candidate discovery feeding the thesis layer (spec below) — DL4 already landed the `dip-watchlist.json` auto-feed half; DL3 adds the flush-distribution thesis layer on top | `pipeline/lib/analyze.mjs`, `js/strategies.mjs`, `dip-watchlist.json` (auto-fed by DL4), tests | OPEN (n-gated on DL2's widened log accruing, like F1) |
| DP1 | Dip-posture entry classifier (dip DIRECTION, not just depth) — `recentDirection` + `dipPostureValidator`, inform on band/churn | `js/quotecore.js`, `js/validate.mjs`, `js/strategies.mjs`, `pipeline/screen.mjs`, `pipeline/quote.mjs`, `pipeline/dipposture.test.mjs` | ✅ `597f132` |
| PM1 | Probe-module system (dip/froth/anchor/decant theory plug-ins) | `pipeline/modules/*`, `pipeline/lib/modules.mjs` | ✅ `6aba80b` |
| TG1 | Thesis-gated hold alerts | `hold-thesis.json`, `pipeline/lib/holdthesis.mjs`, `watch.mjs` | ✅ `b2634a1` |
| T1 | Standard table v2 | `js/quotecore.js`, `pipeline/cli.mjs`, app | ✅ `c7b53e7` (0.34.0) |
| T2 | Trends sections + last-2h view | `js/trends.js`, `js/charts.js` | ✅ `70633f6` (0.35.0) |
| O1 | Outcomes dataset | `pipeline/outcomes.mjs`, `suggestions.jsonl` | ✅ `b0749bf` (F1 gate: n≥30 per side×pctl×class×regime cell, ≥5 cells — stays GATED) |
| K1 | Self-improving skills | `.claude/skills/*/SKILL.md` | ✅ `283e12a` |
| K2 | Memory dedupe pass | Claude memory dir | ✅ (memory-dir only — no repo commit) |
| K3 | CLAUDE.md slimming round 2 | `CLAUDE.md`, code headers | ✅ `ec02495` |
| S1 | Screening economics (gp-flow, 500k floor) | `pipeline/screen.mjs`, `rating.mjs` | ✅ `5ad72a9` (S1.3 spread-drop STAYS DEFERRED — NY2.3) |
| S2 | Overnight vs active posture | `pipeline/screen.mjs` | ✅ `12e8a86` |
| S3 | Watchlist always scanned | `watchlist.json`, `screen.mjs` | ✅ `3a38018` (0.37.0) |
| Q1 | Gate-0 reliability gap | `js/quotecore.js` | ✅ `23deba0` (0.36.0) |
| E1 | Local-time audit | `js/ui.js` (+sweep) | ✅ `4c433d0` (audit-only, no code change) |
| L1 | Action logging pass | `js/main.js` et al. | ✅ `3404681` (0.38.0) |
| G1 | PR flow + ruleset migration | GitHub ruleset, `checks.yml`, `/ship` | ✅ `553c3a6`+`b57fbe8` |
| M1 | Mobile parity — GitHub-as-backend writes | `sync-fills.mjs`, `mobile-fills.log`, app | ✅ `6789859`+`d3df7fe` (0.39.0) |
| N1 | Push notifications on price movement | `pipeline/alerts.mjs` | ✅ `033318e` (delivery mechanism = pending Ben decision) |
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
| CI1 | Browser smoke test in CI | `checks.yml`, `pipeline/smoke.mjs` | ✅ `69bf79d` |
| TB1 | Reusable sortable-table component | `js/table.js` | ✅ `3e40cbe` (0.44.0) |
| LU1 | Ledger UX rework | `js/ledger.js`, app | ✅ `c88df30` (0.45.0) |
| FX1 | Finder full-catalog search + Signals badge | `js/ui.js`, `js/market.js` | ✅ `c12bf4b` (0.46.0) |
| NY1 | Scan niche-yield audit | analysis only | ✅ report delivered 2026-07-05 (no repo change) |
| SY1 | Strategic sync-fills points in skills | workflow skills | ✅ `563da75` |
| NY2 | Niche ruling (rising floor, churn off-by-default, spread stays) | `screen.mjs`, `/scan` | ✅ `f982a31` — **SUPERSEDED: spread + rising DELETED (Steps 3+4, see Discovered)** |
| OR1 | Org map docs | `README.md`, `CLAUDE.md` | ✅ `1822ad9` |
| OR2 | pipeline/lib/ split | `pipeline/lib/*` | ✅ `94781cc` |
| TD1 | Glob test runner + money tests | `pipeline/run-tests.mjs`, tests | ✅ `d147bab` |
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
| V6 | Recovery-read + capital companion (advisory) | `lib/recovery.mjs`/`capital.mjs` | ✅ (the PLAN-VERDICT.md fold commit, 2026-07-06) |
| FC1 | Opt-in cross-invocation fetch cache | `lib/marketfetch.mjs` | ✅ `0e48b2c` (OFF by default — decision paths byte-identical) |
| YF1 | Historical market-state helper | `lib/histstate.mjs` | ✅ `2ab0139` |
| YS1 | outcomes.mjs schema v2 | `outcomes.mjs`, `lib/velocity.mjs` | ✅ `92ffa1c` |
| YS2 | Forward prediction-field logging | `lib/suggestlog.mjs` + surfaces | ✅ `27f0baa` |
| YV1 | Velocity + capital-utilization analytics | `lib/capitalutil.mjs` | ✅ `1ea914d` (+ velocity footnote `7502889`, total-capital `2fdae81`) |
| YT1 | Session-thesis memory | `lib/sessionthesis.mjs`, `thesis.mjs` | ✅ `5439fed` |
| YP2 | State-transition scan | `lib/statetransition.mjs` | ✅ `9f60c15` |
| YP1 | Guide re-anchor prediction (honesty-gated, ships silent) | `lib/guideanchor.mjs` | ✅ `a93da6a` |
| YA1 | In-app capital-utilization line | `js/watchcore.js`, app | ✅ `a7fd785` (0.53.0) |
| PM2 | Probe firing logs | `lib/modules.mjs` | ✅ `5ca4f95` |
| SR1 | `suggestions.jsonl` rotation/compaction | `lib/suggestlog.mjs` | ✅ `457a7bd` |
| GA1 | `.gitattributes` LF/CRLF normalization | `.gitattributes` | ✅ `3a7f68f` |
| F1 | Algorithm feedback loop | (gated on O1) | GATED (spec below) |
| D0 | Snapshot + SQLite archive | `pipeline/lib/archive.mjs` | ✅ `7e0e962` |
| V2-P0 | Context chain + unified held verdict | `pipeline/lib/context.mjs` | ✅ `a6dc7d1` |
| V2-P1 | Surface extraction + replay harness | `lib/gatecandidates.mjs`, `lib/replay.mjs` | ✅ `f02fbf5`+`8db97bf` |
| V2-P2 | Validate stage + reachValidator (every surface) | `js/validate.mjs`, `js/windowread.mjs` | ✅ `910bea1` |
| V2-P3 | floorValidator + term structure | `js/termstructure.mjs` | ✅ `b55f895` |
| V2-P4a | Path engine core (pure) | `js/paths.mjs` | ✅ `e2eed20` |
| V2-P4b | Path persistence + migration | `lib/watchstate.mjs`, `watch.mjs`, `quote.mjs` | ✅ `ec425f7` |
| V2-P4c | Declarative strategy specs | `js/strategies.mjs` | ✅ `cfcc624` |
| V2-P5 | scalp/value specs + path-aware bids + falling doctrine | `js/strategies.mjs`, `js/valuescreen.mjs`, `js/quotecore.js` | ✅ `fe46f2e` (value-niche spec full text: `git show fe46f2e:PLAN-VALUE.md`) |
| V2-P6a | Retro-join calibrator (suggestion→fill ground truth) | `pipeline/lib/retrojoin.mjs`, `pipeline/retrojoin.mjs` | ✅ `6c3f1b5` |
| V2-P6b | TTF estimators + per-thesis ranking (net × P(fill) ÷ TTF) | `pipeline/lib/estimators.mjs`, `js/strategies.mjs`, `screen.mjs`, `rating.mjs` | ✅ `a21f1bc` (expGpDay DEMOTED to pre-fetch orderer + 500k pre-filter; rank/price-basis doctrine lives in the `estimators.mjs` header) |
| V2-P6c | Empty-result sub-floor fallback (zero candidates at floor → show best sub-floor rows, honestly labeled) | `lib/gatecandidates.mjs`, `screen.mjs` | ✅ `6432a05` (two-sided gate + thesis edge NEVER relaxed; sub-floor rows stdout-only, never screen.json; ledger rows carry a lean `subFloor` marker) |
| V2-P7 | Docs/skills triage + skill-lint + CLAUDE.md diet | docs, skills, new `pipeline/skill-lint.mjs`, `docs/LORE.md` | ✅ `105326a` (skill-lint in CI — rule-blocks need a code pointer or `judgment:` tag). Lone RETIRE disposition executed `f8de508` (Ben 2026-07-09): `/overnight` v1.11 weekend-shift prose → one-line full-day check (v1.15) |
| V2-P8 | Desk orchestrator | new `pipeline/desk.mjs` | OPEN (after P0–P5 harden) |
| TV1 | Per-thesis validators (gate/inform) + trajectory (knife/oscillating/based) classifier + in-script windowrange (reach Leg B + 1h-derived trajectory) | `js/termstructure.mjs`, `js/validate.mjs`, `js/strategies.mjs`, `pipeline/screen.mjs`, tests | ✅ 2026-07-09 (Ben design session: separate validator COMPUTATION from per-thesis ACTION; `spec.validators`={key,mode,window}; reach/trajectory/value-amplitude start inform everywhere, floor+limit gate; trajectory off the fetched 1h series so it fires while loadDaily is cold — the Nightmare-staff knife catch; SKILL /scan v1.29; replay goldens untouched; no APP_VERSION) |
| PF1 | Forecast: pure diurnal+trend 12h/24h projection module + `hourProfile` dispersion fields | `js/forecast.mjs` (new), `js/windowread.mjs` (additive), `pipeline/forecast.test.mjs` (new) | ✅ 2026-07-10 (`diurnalForecast`/`whenBuyable`/`whenSellable`; blood-rune golden pinned; loud degrades; band widens with horizon; INFORM-ONLY/console-only, n≈0 placeholders, no APP_VERSION. **PF2–PF8 remain OPEN** — surfaces (quote/screen/windowrange/watch), estimator/validator hooks, and the PF8 validation study that gates any graduation past inform-only; see `PLAN-FORECAST.md`) |
| ARCH-1 | monitor.mjs applies REMOVE tombstones (no phantom holds) | `pipeline/monitor.mjs`, `lib/reconstruct.mjs`, `monitor.test.mjs` | ✅ `a24d456` (routes monitor's in-memory FIFO through shared `buildTombstonedEvents`; PLAN-ARCH-DOCS-AUDIT A1) |
| COD-1 | Quote-basis ordering invariant fixture | `pipeline/quotecore.test.mjs` | ✅ `55861d1` (test-only; `quoteOrdered(row)` across consistent-basis shapes; Q3-2) |
| DL1 | Structural doc-drift linter + CI wire | `pipeline/doclint.mjs`, `doclint.test.mjs`, `checks.yml` | ✅ `ef239dc` (denylist + duplicate-phrase; stays denylist/structural, never semantic; Q3-1) |
| COD-2 | Overnight accumulation table → script | `lib/gatecandidates.mjs`, `screen.mjs`, `/overnight` SKILL | ✅ `81d9049` (`expUnitsOvernight`; `screen.mjs --posture overnight` prints the table; pinned by `expunitsovernight.test.mjs`; Q3-3) |
| COD-3 | `rebidBar`/`rebidAdvice` helper + weekly-read marker | `js/quotecore.js`, `pipeline/outcomes.mjs`, skills | ✅ `5b91d10` (trajectory/diurnal-aware CUT-family advisory; `--weekly-due`; pinned by `rebid.test.mjs`; Q3-4/5) |
| COD-4 | quote.mjs budgeted ts1h → reach/trajectory fire on explicit asks | `pipeline/quote.mjs`, `lib/richterm.mjs`, `lib/context.mjs` | ✅ `a923496` (fixes flaw A4; shared `staleBookBanner` + diurnal line on quote; Q3-6/7) |
| DOC-1..4 | ARCH-docs cleanup: PLAN prune · CLAUDE diet r3 · README registry-grade · verdict single-home | docs, `.claude/skills/*` | ✅ `e45cd7b`/`560b28b`/`1619ff6`/`0c9ecca` (from `PLAN-ARCH-DOCS-AUDIT.md`; DOC-5+ARCH-2 stay Ben-gated there — see Discovered) |
| ARCH-3 | `parseGp` cross-comments (the volume-source half is NOT mechanical → Discovered SF-3) | `js/format.js`, `pipeline/lib/cli.mjs` | ✅ `6808c58` (comment-only, no APP_VERSION) |
| SWEEP | 2026-07-10 sweep innocuous fixes: `Promise.all` bulk loaders · shared `clamp` dedup · `bandPercentile` extraction | `screen.mjs`, `rating.mjs`, `estimators.mjs`, `histstate.mjs`, `outcomes.mjs` | ✅ `ef68792` (byte-identical dedups; the review verdict + parked residue = Discovered SF-1/2/4/5) |
| SF-2 | Document quote.mjs's uncapped per-item ts1h fetch budget | `pipeline/quote.mjs` | ✅ `fe57a3b` (comment-only; soft-cap recipe if large batches ever routine) |
| SF-1 | Quantile/median type-7 consolidated to one `js/quotecore.js` home (both sorted + sorting contracts) | `js/quotecore.js`, `js/termstructure.mjs`, `pipeline/lib/retrojoin.mjs` | ✅ `2cbca38` (0.56.0; byte-identical refactor, fixture-pinned; caller audit preserved each site's sorted/unsorted contract) |
| SF-3 | Liquidity-class volume-source unify: `volSrc` tag + fetch-free warm-only bulk read (never a cold bulk fetch for a 1-item ask) | `pipeline/lib/suggestlog.mjs`, `pipeline/lib/marketfetch.mjs`, `pipeline/quote.mjs`, `pipeline/screen.mjs` | ✅ `3a36a1e` (pre-F1 calibration hygiene; pinned by `sf3-volsrc.test.mjs`; pipeline-only) |

---

## Open chunk specs

### F1 — Algorithm feedback loop (GATED on O1's n thresholds)

The payoff of O1. Fill-probability/fill-time curves by band-percentile × item class →
replace `patientTargets`' fixed 20th/80th percentiles with class-conditional choices;
observed time-to-fill replaces `Exp gp/d`'s cycle-time assumptions; realized-vs-suggested
calibration report (the O1 suggestion join makes it a query). Known confound: regime mix —
bucket outcomes by regime label before believing any curve. Do not start until O1's
documented sample thresholds clear (n≥30 per side×pctl×class×regime cell, ≥5 cells —
currently 1; process rule 4). Realistically weeks of accrual away at ~20 lots/day.

### DL3 — flush-distribution → candidate discovery feeding the thesis layer (n-gated on DL2's log)

Consumes DL2's **widened flush log** (every flush SIGNAL — liquid `alerted` AND illiquid `signal-only`
— with per-row depth/price/volDay/dipScore + `alerted`/`gatedReason`, joinable to `fills.json`). Builds a
**per-item flush profile**: each item's OWN depth/frequency signature (a bludgeon's differs from a rune's) —
p25/p50 flush price, flush frequency/cadence, floor-stability. DL2's log schema is a complete enough input
(per-item flush price/depth/frequency is reconstructable from the rows).

NOT a standalone illiquid-bid report — it is a candidate-**DISCOVERY** source that feeds the EXISTING
machinery two ways: **(a)** auto-feeds the DL2 `dip-watchlist.json` pool (closes the discovery loop — the
"B feeds A" screen/flush-history → curated-pool path); **(b)** surfaces an item into the relevant niche via
the declarative `js/strategies.mjs` spec pattern (a predictably-deep recurring flusher is a standing-bid /
value candidate the theses put forward, with the flush profile as supporting evidence). It integrates with
`strategies.mjs`, not a separate silo.

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
`pipeline/retrojoin.mjs` is the calibrator. Archive-gap note (verified 2026-07-09): whole-market
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
- **Path engine (`js/paths.mjs`):** Path = `{key, thesis, action∈BUY/HOLD/LIST/CUT/AVOID, levels,
  tripwire, horizon, economics, viability, evidence}`; `enumeratePaths` + `weighPaths`; headline
  dominant + weighed alternatives (alternatives are decision support, NEVER alert inputs);
  `enteredUnder` tracked; MIGRATION flag when dominant ≠ enteredUnder. Dominance/migration are
  persistence-gated (convictionGate arm-then-confirm + a hysteresis margin) — no path-level
  whiplash. Single-alert / V5 EMIT / Gate-2-CUT-exempt contracts preserved verbatim.
- **offerVerdict layering:** stays a small placement primitive ("is this bid valid under ITS
  path?"). A resting bid IS a position → the path engine runs on bids; **CANCEL-BID becomes
  emergent** (no enumerated path validates the capital); falling→CANCEL-BID survives only as the
  path-less default.
- **Strategy = declarative spec** (`js/strategies.mjs`): scripts iterate the registry, never name
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
  pointers not copies; enforced by `pipeline/skill-lint.mjs` (P7) + a wave-start drift audit of
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

## Discovered

**ARCH-DOCS-AUDIT codification (from `PLAN-ARCH-DOCS-AUDIT.md`, Q3 "prose → code") — ALL DONE, now in the Status table above:**
COD-2 `81d9049` · COD-3 `5b91d10` · COD-4 `a923496` (plus ARCH-1 `a24d456`, DL1 `ef239dc`, COD-1 `55861d1`).
Full "what/why" per the fold-out discipline = the landing commit messages.

**Open:**
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
  DELETED (`js/strategies.mjs`; git history is the reference). SUPERSEDES NY2/NY3. Rising's proxy-first
  fetch ordering absorbed into `rankAndSlice`'s rising reserve; residual thin-big-ticket lane caught by
  band's thin path. Detail: `git show f982a31` + the deletion commits.
- **Traded-band gate (Bar D) — DONE `0ed7aa1` (Ben 2026-07-09).** Decoupled DENSITY (`tradedWin`) from
  TWO-SIDEDNESS (`sawLow && sawHigh`) so genuinely-liquid big tickets stop failing the old both-in-one-5m-
  bucket `active5m` count. Invariant lives in the `bandCore` header (`js/strategies.mjs`); pinned by replay
  archetype 2003.
- **Band EDGE robustness (Bar E) — DONE `dba20b4` (Scope A) + `7056846` (Scope B, 0.55.0).** `robustBand`
  (home in `js/quotecore.js`) takes p90/p10 on a DENSE side, raw extremum on a SPARSE side, killing the
  band-top artifact in both the pipeline `bandCore` edge and the app's Optimistic column. Invariant lives in
  the `robustBand` header; pinned by `pipeline/bandedge.test.mjs` + the `quotecore.test.mjs` Scope-B split.
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
  `screen.mjs` tags `bulk`. Pinned by `pipeline/sf3-volsrc.test.mjs` (class-parity + fetch-free); docs
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
shipped post-YIELD: **total-capital view** (`2fdae81`) — `capitalutil.totalCapital` + `lib/cashstate.mjs`
+ `pipeline/cash.mjs` add a committed + STATED idle-cash line to the watch footer (idle GP is in no
log, so it's a stated snapshot, staleness-bannered, never a verdict input). SUPERSEDED
(PLAN-CASH-TRACKING): the footer's idle figure is now DERIVED (`lib/cashderive.mjs` —
anchor + log flow, escrow-excluded `availableCash`), and `screen.mjs`'s value `--capital` default +
`loop-tick.mjs`'s scan-gate now use the derived **`deployablePool`** — the THREE-TIER model
(`availableCash ≤ deployablePool ≤ liquidCapital`, `lib/cashderive.mjs`): deployablePool = free cash +
reclaimable DEEP-bid escrow (bids priced ≥ `DEEP_BID_PCT` below a caller-supplied market ref; a near-live
flip bid stays COMMITTED), superseding the looser `liquidCapital` default. Earlier per-plan Discovered
lists (chunks 4/8/10 fixes) are preserved in git history — `git show 39e5d23:PLAN.md`.
