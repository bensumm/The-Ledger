# PLAN — The Coffer master plan (single plan file, 2026-07-04)

This is the **only** plan file. The prior docs — `PLAN-2.md`, `PLAN-3.md`, `PLAN-4.md`,
`PLAN-5.md` — are deleted; their full text (rationale, findings, long-form specs) lives in
git history: `git show 39e5d23:PLAN-4.md` (same sha serves all four). Every chunk below is
self-sufficient for an executor; the git-show pointers are backstory, not required reading.
When a chunk ships, mark it ✅ in the Status table **in this file** with the commit sha —
single-file discipline: this doc is both the plan and the scoreboard.

**Shipped-chunk detail has been folded out (2026-07-06).** Waves 1–7's per-chunk executor
briefs were pruned once every chunk in them landed — the Status table below keeps the
one-line "don't-rebuild" summary + sha for each, `CHANGELOG.md` and CLAUDE.md's "Done"
section hold the "why", and the full original spec is recoverable via `git show <sha>:PLAN.md`
(any pre-2026-07-06 commit). Only still-open work keeps its detailed spec here.

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

Waves 1–7 have all shipped (see Status). The only scheduled-but-open work is **SR1** and
**GA1** (Wave 7, ready-unassigned) plus the gated **F1**; everything else lives in the
Discovered / Needs-a-Ben-decision lists.

| Wave | What (all ✅ — detail via `git show <sha>:PLAN.md`) |
| --- | --- |
| **1** | T1→T2 (tables + Trends) ∥ O1 (outcomes dataset) ∥ K1→K2→K3 (self-improving skills + memory dedupe + CLAUDE.md slimming) |
| **2** | S1→S2→S3 (screening economics → overnight posture → watchlist section) ∥ Q1 (Gate-0 reliability fix) ∥ E1 (local-time audit) |
| **3** | L1 (action logging) → G1 (PR flow + ruleset) → M1 (mobile parity) → N1 (push notifications) |
| **4** | Repo-review cleanup: D1 (doc reconciliation) ∥ R1→P1 (reconstruct harness → snapshot dedupe) ∥ X2→X1 (dead-scheduler excision → pipeline dedup) ∥ A1→A2→A3 (app dead-code → fetch unification → ledger split) ∥ BE1 (break-even tax-cap fix). W1 (analysis cadence) + CI1 (browser smoke in CI) independent. |
| **5** | UX round: TB1→LU1→FX1 (sortable table → Ledger UX → Finder/Signals fixes) ∥ NY1→NY2 (scan niche-yield audit → ruling) ∥ SY1 (sync-fills doctrine). |
| **6** | Business-logic tests + org: OR1 (org map docs) → OR2 (pipeline/lib/ split) → TD1 (money tests) → TD2 (extractions + tests) → TD3 (nice-to-have sweep). |
| **LW/LH** | LW1→LW2→LW3 (local log-watcher) ∥ LH1→LH2→LH3 (exchange-log hardening) — folded from standalone plan files, both shipped. |
| **7** | TC1 (trendcore extraction) ∥ GC1 (gateCandidates extraction) ∥ SL1 (suggestlog path regression). **Ready-unassigned: SR1, GA1** (specs below). |
| gated | **F1** (algorithm feedback) — opens only when O1's sample thresholds clear |

## Status

| Chunk | What | Primary files | State |
| --- | --- | --- | --- |
| T1 | Standard table v2 | `js/quotecore.js`, `pipeline/cli.mjs`, `js/quote.js`, `js/ui.js`, `styles.css`, `index.html` | ✅ `c7b53e7` (0.34.0) |
| T2 | Trends sections + last-2h view | `js/trends.js`, `js/charts.js` | ✅ `70633f6` (0.35.0) |
| O1 | Outcomes dataset | `pipeline/quote.mjs`, `screen.mjs`, `watch.mjs`, new `outcomes.mjs`, `suggestions.jsonl` | ✅ `b0749bf` (F1 gate documented: n≥30 per side×pctl×class×regime cell, ≥5 cells — currently 1, stays GATED) |
| K1 | Self-improving skills | `.claude/skills/*/SKILL.md` | ✅ `283e12a` |
| K2 | Memory dedupe pass | Claude memory dir | ✅ (memory-dir only — no repo commit; 5 memories → skill pointers, `execute-plans-off-main` updated) |
| K3 | CLAUDE.md slimming round 2 (reference material → code headers/docs) | `CLAUDE.md`, `js/state.js`, `js/trends.js`, `pipeline/FILLS-PIPELINE.md`, `CHANGELOG.md` (new) | ✅ `ec02495` |
| S1 | Screening economics (gp-flow, 500k floor, spread verdict) | `pipeline/screen.mjs`, `rating.mjs` | ✅ `5ad72a9` (S1.3 spread-drop **STAYS DEFERRED** — NY2.3, Ben 2026-07-05: spread KEEPS, it surfaced the one niche-exclusive real flip (Hydra leather, +147k); revisit only on genuine multi-day `--mode all` data) |
| S2 | Overnight vs active posture | `pipeline/screen.mjs`, `js/quotecore.js` (fixtures) | ✅ `12e8a86` (22:00–06:00 local; 4 posture fixtures, 14 total) |
| S3 | Watchlist always scanned | `watchlist.json` (new), `screen.mjs`, `js/ui.js`, `/scan` skill | ✅ `3a38018` (0.37.0 at merge — S-lane authored as 0.36.0 in parallel with Q1) |
| Q1 | Gate-0 reliability gap | `js/quotecore.js`, `pipeline/quotecore.test.mjs`, `/positions` skill | ✅ `23deba0` (0.36.0 — inversion → `reliable:false` at the source; interim `/positions` override removed) |
| E1 | Local-time audit | `js/ui.js` (+sweep) | ✅ `4c433d0` (audit-only: no UTC leaks found; `periodKey` midnight/week fixtures pass; convention rule added to CLAUDE.md — no code change, no APP_VERSION bump) |
| L1 | Action logging pass | `js/main.js`, `ui.js`, `trends.js`, `backup.js`, `state.js` | ✅ `3404681` (0.38.0) |
| G1 | PR flow + merge queue migration (sync-cadence investigation first; before M1/N1) | Task Scheduler job, GitHub ruleset/queue config, `.github/workflows/checks.yml`, `.claude/skills/ship/SKILL.md`, `pipeline/sync-fills.mjs` | ✅ `553c3a6`+`b57fbe8` (scheduler DELETED; ruleset id 18520289 active: PR+`checks` required, admin-always bypass verified. Two limits: **no merge queue** — user-owned repo; **PR creation token-blocked** until Ben runs `gh auth refresh -s repo`, then merge staged branch `g1-readme-inventory` as the acceptance PR) |
| M1 | Mobile parity — GitHub-as-backend writes | `pipeline/sync-fills.mjs`, `mobile-fills.log` (new), app settings/UI | ✅ `6789859`+`d3df7fe` (0.39.0; M1.5 in-cloud Action deliberately NOT built — designed follow-up in FILLS-PIPELINE.md §13.5, Ben's call if PC-off staleness bites) |
| N1 | Push notifications on price movement | new `pipeline/alerts.mjs` + design doc section | ✅ `033318e` (trigger engine + MONITORING.md design section; delivery mechanism = Ben decision pending a live trial of the scheduled-Claude-session option) |
| P1 | Snapshot-re-emission dedupe in reconstruct.mjs | `pipeline/reconstruct.mjs`, fixtures, `pipeline/FILLS-PIPELINE.md` | ✅ `5015a5c` (dedupeSnapshots in reconstruct(); real-data check dropped 12 phantom terminals, unmatched 23→12) |
| D1 | Doc reconciliation pass (stale "open followups", FILLS-PIPELINE handoff frame, MONITORING lag/held-source, README inventory) | `CLAUDE.md`, `README.md`, `pipeline/MONITORING.md`, `pipeline/FILLS-PIPELINE.md`, `.claude/skills/positions/SKILL.md` | ✅ `2135d49` (ran last — absorbed the wave's own drift; supersedes the `g1-readme-inventory` staged branch) |
| R1 | Reconstruction test harness + CI wiring | new `pipeline/reconstruct.test.mjs`, `.github/workflows/checks.yml` | ✅ `c79dcc5` (9 fixtures incl. eventId golden value) |
| X1 | Pipeline dedup (fetchInputs ×3, open-lot grouping ×3, mapping loaders, liqClass ×2) | `pipeline/marketfetch.mjs`, `quote.mjs`, `watch.mjs`, `alerts.mjs`, `monitor.mjs`, `add-manual-fill.mjs`, `outcomes.mjs`, `suggestlog.mjs`, new `positions.mjs` | ✅ `e7e62f5` (quote.mjs output byte-identical pre/post) |
| X2 | Dead-scheduler excision (+ ff-merge abort guard) | `pipeline/sync-fills.mjs`, delete `run-fills-sync.cmd`/`.vbs` | ✅ `fb9344e` |
| A1 | App dead-code sweep (write-only STATE props, dead chart/CSS/trends fields) | `js/state.js`, `market.js`, `charts.js`, `trends.js`, `quotecore.js`, `styles.css`, `index.html` | ✅ `a2e8318` (0.41.0) |
| A2 | App fetch/helper unification (`js/marketfetch.js`, netMargin routing) | new `js/marketfetch.js`, `js/trends.js`, `market.js`, `quote.js`, `ui.js`, `format.js` | ✅ `1aa43ec` (0.42.0) |
| A3 | Split `js/ledger.js` out of `ui.js` | `js/ui.js`, new `js/ledger.js`, `main.js`, `index.html` | ✅ `7ef1db1` (0.43.0; full chromium DOM smoke on the moved surfaces) |
| BE1 | Break-even ignores the 5m tax cap | `js/quotecore.js`, `js/trends.js`, `pipeline/add-manual-fill.mjs`, `quotecore.test.mjs`, docs sweep | ✅ `82340d5` (0.40.0; brute-force boundary proof — no-op below the 245m cap crossover) |
| W1 | Trade-analysis cadence (weekly descriptive outcomes read) | `.claude/skills/morning/SKILL.md` or new skill, `pipeline/outcomes.mjs` | ✅ `5666eac` (/morning v1.3; pipeline-stdout only, no APP_VERSION) |
| CI1 | Browser smoke test in CI | `.github/workflows/checks.yml`, new smoke script | ✅ `69bf79d` (new `pipeline/smoke.mjs`; validated locally — CI-side run unverified until the branch hits Actions) |
| TB1 | Reusable sortable-table component | new `js/table.js`, `js/ui.js` (Finder + Watchlist adopt), `styles.css` | ✅ `3e40cbe` (0.44.0; chromium sort/reverse/persist interactive test + full smoke green) |
| LU1 | Ledger UX rework (click→Trends, expand button, P&L filter placement, period-bucket filter, collapsible entry, sortable closed table) | `js/ledger.js`, `index.html`, `styles.css`, `js/state.js`, `js/main.js` | ✅ `c88df30` (0.45.0; all 5 behaviors chromium-verified) |
| FX1 | Finder full-catalog search (soul-rune class) + Signals badge count | `js/ui.js`, `js/market.js` | ✅ `c12bf4b` (0.46.0; search unions catalog matches below MIN_PRICE — browse view byte-identical; badge `firing/total`) |
| NY1 | Scan niche-yield audit (spread/rising value; S1.3 spread-drop decision) | `suggestions.jsonl` (read), analysis only | ✅ report delivered 2026-07-05 (analysis-only, no repo change; evidence fed NY2. Ben decides drops — nothing changed in `screen.mjs`/`/scan`) |
| SY1 | Strategic sync-fills points in workflow skills | `.claude/skills/{morning,positions,overnight,scan}/SKILL.md` | ✅ `563da75` (positions 1.9 / morning 1.4 / scan 1.5 / overnight 1.7 — sync-first everywhere + MAIN-checkout caveat) |
| NY2 | Niche ruling: rising pool floor, churn off-by-default, spread stays, thin-cap anomaly | `pipeline/screen.mjs`, `rating.mjs` (maybe), `/scan` skill, docs | ✅ `f982a31` (pipeline+skills only, no APP_VERSION; /scan 1.6). NY2.1 `risingPoolFloor`; NY2.2 `--mode all`=band/spread/rising (churn explicit-only); NY2.3 spread keeps (S1.3 deferred); NY2.4 = DOC bug documented in rating.mjs/suggestlog.mjs |
| OR1 | Org map docs (nightlows drift, root-artifact/shared-module tables, test convention) | `README.md`, `CLAUDE.md` | ✅ `1822ad9` (docs only; also fixed pre-existing "app fetches fills.json" inaccuracy — it fetches positions.json) |
| OR2 | pipeline/lib/ split (8 imported-only libs out of the CLI bag) | `pipeline/lib/*` (moved), ~11 importing files, `.github/workflows/checks.yml`, docs | ✅ `94781cc` (git-mv ×8, 32 import rewrites, checks.yml glob extended, caches → `pipeline/.cache/`; 45/45 specifiers resolve) |
| TD1 | Glob test runner + must-have money tests (format, rating, reconstruct tax-cap/partial-fill) | new `pipeline/run-tests.mjs`, `format.test.mjs`, `lib/rating.test.mjs`, `reconstruct.test.mjs` (extend), `checks.yml`, `/ship` skill | ✅ `d147bab` (runner: recursive discovery, per-file ✓/✗, fails on any suite AND on zero discovery; 4 suites/38 checks at landing) |
| TD2 | Testability extractions + unlocked tests (ledgercore, table comparator, alerts guard) | new `js/ledgercore.js`, `js/ledger.js`, `js/table.js`, `pipeline/alerts.mjs`, new tests | ✅ `e442367` (0.47.0; pure moves chromium-proven byte-identical; alerts no longer fetches on import; ledgercore 7 / table 7 / alerts 8 checks) |
| TD3 | Nice-to-have test sweep (computeQuote derivation, windowread, offers, cli/suggestlog) | `pipeline/quotecore.test.mjs` (extend), new `pipeline/lib/{windowread,offers,cli}.test.mjs` | ✅ `a1110c7` (pipeline-only, no APP_VERSION; quotecore +5 → 21 checks, windowread 6, offers 3, cli/suggestlog 4; 10 suites green. TD3.5 gateCandidates extraction → GC1) |
| LW1 | Local log-watcher — git-free `regenerate()` core (`sync-fills.mjs --local`) + `offers.json` emitter + `watch-log.mjs` daemon + tests | `pipeline/sync-fills.mjs`, new `offers.json`/`watch-log.mjs`/`watch-log.cmd`, `sync-fills.test.mjs` | ✅ `b97c87b` (offers.json `d395864`; pipeline-only. Load-bearing: the daemon does **ZERO git** — desk freshness without breaching the §12 no-unattended-writer-**to-`main`** invariant) |
| LW2 | App localhost live-refresh (poll `positions.json`/`offers.json`, "book synced" stamp) | `js/ledger.js`, `js/state.js` | ✅ `9da9910` (0.48.0; Pages behavior byte-identical) |
| LW3 | Local-watcher docs reconciliation | docs | ✅ `8ad3a45` (folded `PLAN-LOCAL-WATCH.md` → this file, then deleted) |
| LH1 | Exchange-log hardening — `validateSlotTransitions()` loud ingest-drop of impossible same-slot re-emit terminals (BEFORE the `fills.json` merge); `dedupeSnapshots` stays the silent backstop | `pipeline/lib/reconstruct.mjs`, `validateslots.test.mjs` | ✅ `c0fc711` (pipeline-only; 17 historical re-emits dropped incl. the 13:29 double-buy, positions byte-identical. Do NOT resurrect the deleted cancel-to-EMPTY inference — EMPTY stays non-evidence) |
| LH2 | `blindWarningLine()` restart-blindness header in `monitor.mjs`/`watch.mjs` | new `pipeline/lib/logblind.mjs`, `logblind.test.mjs` | ✅ `f7bd006` (pipeline-only; display-only line, no verdict change) |
| LH3 | Log-hardening docs reconciliation | docs | ✅ `05ccea6` (folded `PLAN-LOG-HARDENING.md` → this file, then deleted) |
| TC1 | trendcore extraction — pure analytics out of `js/trends.js` → `js/trendcore.js` + fixtures | `js/trends.js`, new `js/trendcore.js`, new `pipeline/trendcore.test.mjs` | ✅ `eaa5414` (0.50.0; pure MOVE, byte-identical; `trendcore.test.mjs` 19 checks) |
| GC1 | gateCandidates extraction — thresholds-as-argument so `screen.mjs`'s gate stack is fixture-testable (absorbs TD3.5) | `pipeline/screen.mjs`, new test | ✅ `cb3eb67` (pipeline-only, no APP_VERSION; byte-identical stdout via `THRESHOLDS`; `gatecandidates.test.mjs` 8 checks; runner 16 suites) |
| SL1 | suggestlog path regression — OR2 moved `suggestlog.mjs` into `lib/` leaving `HERE/'..'` pointing at `pipeline/`, silently forking the O1 ledger into untracked `pipeline/suggestions.jsonl`. Path fixed (two levels up), 351 stranded rows folded back, resolved path pinned by test | `pipeline/lib/suggestlog.mjs`, new `pipeline/lib/suggestlog.test.mjs`, `suggestions.jsonl` | ✅ `1702126` (pipeline-only, no APP_VERSION; runner 17 suites) |
| V1+V2 | Verdict-layer temporal memory — watch-loop cross-pass state store + per-pass deltas (`computeDeltas`/`advanceState`, `passesUnderwater`, band-top drift) + structural-support/cut-trigger tripwire, OUTPUT-ONLY | new `pipeline/lib/watchstate.mjs`/`levels.mjs` + tests, `pipeline/watch.mjs`, `.cache/watch-state.json` | ✅ `8a5d160` (pipeline-only, no APP_VERSION; adds context lines, changes no verdict/alert. Don't-rebuild: temporal memory lives OUTSIDE pure `momVerdict`) |
| V3 | Gate-D lot-context softening — `momVerdict` OPTIONAL `lotCtx={buyTs,askFilling}` softens ONLY the clean-momentum CUT-CANDIDATE (WATCH — fresh entry / HOLD — ask filling), NEVER the Gate-2 breakdown CUT | `js/quotecore.js`, `pipeline/quotecore.test.mjs`, callers, `js/trends.js`/`watch.js`/`watchcore.js`, `pipeline/lib/positions.mjs`, docs | ✅ `692baee` (0.52.0 — the one APP_VERSION bump; app inherits via `reviewPositions`. Invariant fixture: breakdown CUT byte-identical with/without lotCtx) |
| V4 | Conviction gating — arm-then-confirm alerts via pure `convictionGate()` (+ `passesBelowSupport`); gates only ESCALATION to a headline, verdict strings unchanged | `pipeline/lib/watchstate.mjs`, `pipeline/watch.mjs`, tests, docs | ✅ `2a87269` (pipeline-only, no APP_VERSION; `js/quotecore.js` untouched. Invariant: Gate-2 breakdown CUT EXEMPT — immediate regardless of pass count) |
| V5 | Emit-contract standardization — one stable, ordered per-held note block via pure `heldNoteBlock`/`heldListAt`; the sell/list-at + break-even line GUARANTEED on every held lot | new `pipeline/lib/emit.mjs` + test, `pipeline/watch.mjs`, docs | ✅ `825469f` (pipeline+docs, no APP_VERSION; output-format-only — no verdict/alert/row-selection change) |
| V6 | Recovery-read forecast (ADVISORY recover-vs-drop LEAN composing momVerdict's signals) + capital-awareness Companion (freed-capital redeploy prompt) — both OUTPUT-ONLY, surfaced only when the naive action isn't obviously right | new `pipeline/lib/recovery.mjs`/`capital.mjs` + tests, `pipeline/watch.mjs`, `pipeline/lib/emit.mjs`, docs, `.claude/skills/positions/SKILL.md` (1.15) | ✅ (this commit; pipeline+docs, no APP_VERSION; pure core untouched, breakdown-cut invariant trivially held. Don't-rebuild: a LEAN not a probability — `spike` caps to `uncertain`; never a verdict/alert input. Companion is surface-only — never auto-places/runs the scan. Folded + deleted `PLAN-VERDICT.md`) |
| SR1 | `suggestions.jsonl` rotation/compaction | `suggestions.jsonl`, `pipeline/lib/suggestlog.mjs` | ⏳ ready — unassigned (spec below) |
| GA1 | `.gitattributes` LF/CRLF normalization | new `.gitattributes` | ⏳ ready — unassigned (spec below) |
| F1 | Algorithm feedback loop | (gated on O1) | GATED (spec below) |

---

## Open chunk specs

### SR1 — `suggestions.jsonl` rotation/compaction [S] (ready, unassigned)

The tracked file grows unbounded (639 lines in ~2 days ≈ tens of MB/year at this pace, and
it lives in the deploy root) — needs a rotation story before it gets silly: monthly archive
files (`suggestions-YYYY-MM.jsonl`), or move history out of the deploy root entirely. The
writer is the shared `logSuggestions`/`LEDGER` path in `pipeline/lib/suggestlog.mjs` (SL1) —
keep O1's F1-gating accrual intact (rows are the calibration data, don't drop them; archive,
don't delete). Whatever scheme is chosen, the resolved active-ledger path stays pinned by
`pipeline/lib/suggestlog.test.mjs`. Pipeline-only, no APP_VERSION. Promoted from Discovered.

### GA1 — `.gitattributes` normalization [S] (ready, unassigned)

Quiet the recurring `LF will be replaced by CRLF` warnings on Windows commits with a new
`.gitattributes` doing an `eol`/`text` normalization pass. Watch for churn: a blanket
`text=auto` re-normalization can rewrite line endings across many tracked files in one
commit — scope it (or stage the renormalize commit separately) so a real change never hides
inside an EOL churn diff. Promoted from Discovered.

### F1 — Algorithm feedback loop (GATED on O1's n thresholds)

The payoff of O1. Fill-probability/fill-time curves by band-percentile × item class →
replace `patientTargets`' fixed 20th/80th percentiles with class-conditional choices;
observed time-to-fill replaces `Exp gp/d`'s cycle-time assumptions; realized-vs-suggested
calibration report (the O1 suggestion join makes it a query). Known confound: regime mix —
bucket outcomes by regime label before believing any curve. Do not start until O1's
documented sample thresholds clear (n≥30 per side×pctl×class×regime cell, ≥5 cells —
currently 1; process rule 4). Realistically weeks of accrual away at ~20 lots/day.

---

## Other unscheduled notes

- **Verdict-layer temporal memory (V1–V6) — DONE, `PLAN-VERDICT.md` folded + deleted.** The whole
  series gave the watch loop cross-pass memory, conviction gating, a standard emit contract, and an
  advisory recovery-read + capital companion WITHOUT touching pure `momVerdict`/`offerVerdict` (the
  temporal + advisory layers live OUTSIDE the pure core; only V3's optional `lotCtx` arg touched it,
  and that's a no-op when omitted). Shas in the Status table (V1+V2 `8a5d160`, V3 `692baee`, V4
  `2a87269`, V5 `825469f`, V6 this commit). Documented follow-on (NOT built): app Watch-tab adoption
  of the same context lines (the app has no per-pass store — console-first was deliberate).
- **Screen pre-filter heuristic from a pattern study:** the niche screens do a blind
  fetch-and-check (esp. `rising`: ~30 of 40 top candidates discarded after the expensive
  per-item confirm). Study: dump cheap 24h/band features + survive/discard labels for a
  100–200-item sample; if a clean predictor separates, use it as a pre-rank filter.
  Belongs with rating-cutoff calibration (both need the same validation data).
- **Per-item "recommend price adjustment" button** (Trends): deferred; T2's 2h readout is
  a step toward it, F1's calibration is the real enabler.
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
- **Stale remote branches** `wave4-repo-review-plan` + `g1-readme-inventory` — delete vs keep.
  D1 superseded `g1-readme-inventory`'s README work; alternatively it could be the first
  PR-path smoke once `gh auth refresh -s repo` runs. Ben's call.
- ~~**`pipeline/held-override.json`** (desk, untracked)~~ — RESOLVED 2026-07-06: `rm`'d. It was
  inert (`monitor.mjs` reads `.cache/held-override.json`, not this root copy — it forked at OR2) AND
  redundant (its one entry, `23959` @ 2026-07-03, already reconciles to 0 open in `positions.json`
  via the coffer-manual.log tombstones). Nothing read it. (The other two desk orphans —
  `pipeline/mapping.cache.json` and the SL1-forked `pipeline/suggestions.jsonl` — were cleaned +
  folded 2026-07-05.)
- **N1 delivery-mechanism trial** — pick option a/b/c after the live scheduled-Claude-session trial.
- **Smaller product calls (from Discovered):** side-specific price-alert semantics; a mobile
  REMOVE editor for already-synced fills; a `--niche` keyword flag on `screen.mjs`; the
  `--max-price` default vs big tickets; a churn-niche `--min-gpd` exemption.

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

**Open:**
- No `--niche` keyword flag on `screen.mjs` (skills filter output rows by hand; a flag is
  a possible future convenience).
- `quote.mjs` and `screen.mjs` can log a different liquidity `class` for the same item in
  `suggestions.jsonl` (volume read from `fetch24hOne` vs bulk `loadAll24h` at different
  moments — observed live on Toxic blowpipe: `mid` vs `thin`). Honest as-computed-then
  data, but unify the volume source if a single canonical label is ever needed (lane O,
  2026-07-04).
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
- `parseGp` exists in both `pipeline/cli.mjs:29` and `js/format.js:24` with slightly
  different behavior — intentional app/pipeline divergence; worth a one-line comment in
  each noting so (audit, 2026-07-05).
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
- `monitor.mjs`'s "HELD POSITIONS" view diverges from the canonical book when tombstones
  exist: it rebuilds a FIFO from the live exchange log(s) only, without applying
  `coffer-manual.log` REMOVE tombstones, so already-purged lots reappear as phantom holds
  (observed live 2026-07-05: 2× enhanced crystal teleport seed @ 3.345m showed held in
  monitor while `positions.json` correctly had 1 open lot — the agent read monitor as truth
  and gave wrong listing advice). Fix direction: fold the manual log's tombstones into
  monitor's in-memory reconstruction (same event pipeline as sync), or label the section
  honestly ("live-log FIFO — may include tombstoned lots"). Watch-loop session, 2026-07-05.
- LH2's blind-warning heuristic can't catch the *false-EMPTY snapshot* restart variant: a
  client bounce made the plugin write a fresh all-slots `EMPTY` snapshot (16:10:02
  2026-07-05) while real offers stood in-game — log is FRESH (so the staleness gate never
  fires) yet every slot reads empty and watch prints NOT LISTED for listed items. Detectable
  signature: an all-slots-EMPTY re-emit burst arriving with no intervening fill/cancel
  terminals while the pipeline FIFO says inventory is held (and/or offers were visible in
  the immediately-prior log state). Display-only warning like LH2, same header channel —
  never verdict input, and EMPTY stays non-evidence for fills (don't resurrect the deleted
  cancel-to-EMPTY inference). Watch-loop session, 2026-07-05.
- **Guide-price update tracking → predict the re-anchor (Ben, 2026-07-06 — wants this as an
  edge for single-item lane flipping).** The GE guide price updates ~once/day per item at an
  item-specific time; the update instantly re-anchors guide-price buyers, compressing (or
  lifting) the realtime ceiling — observed live: bludgeon guide 17.61m→17.43m between 21:48
  and 00:03, fury 2.80m→2.72m the same evening, and both of the day's above-average bludgeon
  ask fills printed while the ask sat UNDER the pre-update guide. Capture already shipped
  (watch.mjs `logGuideChanges` → gitignored `pipeline/.guide-history.jsonl`, change-only
  lines `{ts,id,name,guide,prev}` at watch cadence, so update time pins to ~15 min). The
  chunk to build once samples accrue: per-item update-time estimate + magnitude model
  (yesterday's realtime drift ≈ today's guide step), surfaced as a line on `quote.mjs`/
  `watch.mjs` rows ("guide update expected ~23:00, projected ≈17.2m") and folded into the
  ask-pricing doctrine (price asks against the POST-update guide when the update lands
  before the sell window). Honesty: 2 observed updates so far — needs days of history
  before the timing claim is real. Watch-loop session, 2026-07-06.
- P1's `dedupeSnapshots()` runs inside `reconstruct()` (positions.json + `monitor.mjs`), but
  `outcomes.mjs` calls `collapseOffers`/`matchTrades` directly for campaign boundaries, so its
  campaigns can still see a snapshot-duplicate terminal as a phantom offer. Low impact (outcomes
  is derived/gitignored), but adopt `dedupeSnapshots` there if campaign counts ever look off
  (P1, 2026-07-05).
- **Cross-invocation fetch cache for the CLI scripts → chunk FC1 (Ben, 2026-07-06 — cut
  redundant GE API pulls).** Each pipeline script (`watch.mjs`, `screen.mjs`, `quote.mjs`,
  `windowrange.mjs`) spawns a cold `node` process with no shared fetch state, so running a
  `windowrange` right after a `screen` re-pulls `/latest` + `/5m` + `/24h` rows the screen
  already fetched seconds earlier — and a tight watch loop re-pulls the full quote stack per
  item every pass even on a quiet, unchanged book. The browser app already dedupes within a
  session (`js/marketfetch.js` `fetchTs`/`fetch24h` in-memory store) but the CLI has no
  equivalent across processes. **Spec:** a small file-backed TTL cache in `$TMPDIR` (or a
  gitignored `pipeline/.fetch-cache/`) wrapping the shared CLI fetch layer — key on
  endpoint+item, store the JSON with a fetched-at stamp, serve from cache when age < TTL
  (~60s for `/latest`/`/5m`; longer, ~10–15 min, for `/24h` and the 1h timeseries which move
  slowly), bypass on a `--no-cache`/`--fresh` flag and for any write-committing path. Must be
  a pure wrapper: **byte-identical numbers** (a cache hit returns the same payload a live
  fetch would have within the TTL), gitignored, and inventory-registered in README at
  creation. Measure first — confirm the endpoint layer is genuinely shared before building, and
  size the TTLs so a stale cache can never feed a *decision* (a held/bid quote a verdict runs
  on should stay short-TTL or bypass). Honesty: the win is real on back-to-back reads and quiet
  loops; it does nothing for a book that's actually moving (cache correctly misses on fresh
  data). Behavioral mitigations already in place (loop at 3m not 1m; don't double-run
  `windowrange` when watch's window line answers it) capture most of the idle savings without
  this — FC1 is the structural fix for the screen→windowrange→watch same-item overlap. Watch-loop
  session, 2026-07-06.

**Resolved / promoted:** `gateCandidates` testability → chunk **GC1**; LF/CRLF warnings →
chunk **GA1**; `fetchInputs` triplication → chunk **X1**; `suggestions.jsonl` unbounded growth
→ chunk **SR1**; README pipeline-inventory gap → shipped in **D1**. Earlier per-plan Discovered
lists (chunks 4/8/10 fixes) are preserved in git history — `git show 39e5d23:PLAN.md`.
