# PLAN — The Coffer master plan (single plan file, 2026-07-04)

This is the **only** plan file. The prior docs — `PLAN-2.md`, `PLAN-3.md`, `PLAN-4.md`,
`PLAN-5.md` — are deleted; their full text (rationale, findings, long-form specs) lives in
git history: `git show 39e5d23:PLAN-4.md` (same sha serves all four). Every chunk below is
self-sufficient for an executor; the git-show pointers are backstory, not required reading.
When a chunk ships, mark it ✅ in the Status table **in this file** with the commit sha —
single-file discipline: this doc is both the plan and the scoreboard.

## Executor rules (apply to every chunk, verbatim)

- Each chunk ends with: `node --check` every touched `js/*.js` / `pipeline/*.mjs`; run
  `node pipeline/quotecore.test.mjs` if quotecore was touched; a real browser or Playwright
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

Largest chunks (mobile parity, push notifications) deliberately last (Ben, 2026-07-04).

| Wave | Parallel lanes (one subagent each) |
| --- | --- |
| **1** | **T1→T2** (tables + Trends, one agent — shared styling) ∥ **O1** (outcomes dataset — pipeline-only, and the data compounds with calendar time, so it starts now) ∥ **K1→K2→K3** (self-improving skills + memory dedupe + CLAUDE.md slimming round 2 — K3 also touches js file headers/docs, still conflict-free with the other lanes) |
| **2** | **S1→S2→S3** (screening economics → overnight posture → watchlist section, one agent — all `screen.mjs`-centric) ∥ **Q1** (Gate-0 reliability fix — quotecore + fixtures) ∥ **E1** (local-time audit) |
| **3** | **L1** (action logging — solo first, it instruments the final shapes) → **G1** (PR flow + merge queue — investigation then flip; deliberately BEFORE the two big chunks: M1's sync design depends on the cadence decision, and M1/N1 then land through the new PR flow) → **M1** (mobile parity) → **N1** (push notifications). M1 and N1 have disjoint file sets and *may* run in parallel if desired; both are large. G1's *investigation* may start any time; the workflow flip lands only between waves, never mid-wave. |
| **4** | Repo-review cleanup (2026-07-05 three-agent audit): **D1** (doc reconciliation — docs only, parallel with anything) ∥ **R1→P1** (reconstruct test harness FIRST, then the snapshot dedupe lands with its fixtures in that harness) ∥ **X2→X1** (dead-scheduler excision, then pipeline dedup — both touch `sync-fills.mjs`/shared pipeline files, so sequenced) ∥ **A1→A2→A3** (app dead-code sweep → fetch/helper unification → ledger split; same-file chain, one agent) ∥ **BE1** (break-even tax-cap fix — `quotecore.js` + fixtures, disjoint from A-lane's files until A2; run before or parallel-early). **W1** (analysis cadence) and **CI1** (browser smoke in CI) are independent, any time. |
| **5** | UX round + scan-yield audit (Ben, 2026-07-05): **rebase this branch onto `origin/main` first** (main gained skills commits + the `nightlows.mjs`→`windowrange.mjs` rename after the Wave-4 base — D1's doc edits may conflict). Then **TB1→LU1→FX1** (one app lane, sequential — shared `ui.js`/`ledger.js`/`styles.css`/`index.html`: reusable sortable table FIRST, then the Ledger UX rework that consumes it, then the Finder/Signals fixes) ∥ **NY1** (scan niche-yield audit — pipeline/analysis only) ∥ **SY1** (sync-fills doctrine — skills only). |
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
| S1 | Screening economics (gp-flow, 500k floor, spread verdict) | `pipeline/screen.mjs`, `rating.mjs` | ✅ `5ad72a9` (S1.3 spread-drop DEFERRED — needs a few days of `--mode all` publishes under the floor before removing) |
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
| LU1 | Ledger UX rework (click→Trends, expand button, P&L filter placement, period-bucket filter, collapsible entry, sortable closed table) | `js/ledger.js`, `index.html`, `styles.css`, `js/state.js`, `js/main.js` | ✅ `c88df30` (0.45.0; all 5 behaviors chromium-verified — name→Trends, chevron expand, period control on Closed-flips label, bucket filter+clear, collapsed `<details>` form, TB1 sortable closed columns) |
| FX1 | Finder full-catalog search (soul-rune class) + Signals badge count | `js/ui.js`, `js/market.js` | ✅ `c12bf4b` (0.46.0; search unions catalog matches below MIN_PRICE — browse view byte-identical; badge `firing/total`) |
| NY1 | Scan niche-yield audit (spread/rising value; S1.3 spread-drop decision) | `suggestions.jsonl` (read), analysis only | ✅ report delivered 2026-07-05 (analysis-only, no repo change). Evidence (~11.5h window, ~2 independent non-band samples — small, stated): rising 46% grade-D + 1 exclusive ≥B+ item + 0 exclusive flips → drop candidate; churn 84% band-overlap, never beats band's ceiling → demote/fold candidate; spread weakest grades BUT surfaced the one niche-exclusive real flip (+147k) → keep pending multi-day data (S1.3 stays deferred). Scarcity = concentration (2–6 NEW names per publish), not row count. **Ben decides drops** — nothing changed in `screen.mjs`/`/scan`. |
| SY1 | Strategic sync-fills points in workflow skills | `.claude/skills/{morning,positions,overnight,scan}/SKILL.md` | ✅ `563da75` (positions 1.9 / morning 1.4 / scan 1.5 / overnight 1.7 — sync-first everywhere + MAIN-checkout caveat; /scan was the real gap) |
| F1 | Algorithm feedback loop | (gated on O1) | GATED |

---

## Wave 1

### T1 — Standard table v2 (ex PLAN-4 chunk A)

Goal: the standard market table becomes glanceable — grouped columns, color, momentum
arrows, sticky header/first column — changed in ONE place (`quoteCells` in
`js/quotecore.js` is the single formatting source; `stdCells` in `pipeline/cli.mjs` wraps
it) so Scan, Trends, Finder expander, position review, and the scripts stay consistent.
Decisions already taken (Ben, 2026-07-04 — do not re-litigate): units in header only;
`Mom` → `Momentum` with `–`/`↑`/`↓`/`↑↑`/`↓↓` color-coded; rating immediately after the
item name everywhere; the `Net/u Quick / Opt (ROI)` composite splits into self-contained
**Quick** and **Optimistic** columns; Mid is dropped from app tables (it's just the 24h
avg midpoint — redundant next to Guide + live prices); frozen header + first column.

1. **Structured cells:** `quoteCells` returns `{t, c}` (text + optional css class) + a
   `cellText()` helper so the markdown path derives the same strings it prints today.
   `screen.json` publishes structured cells (bump a `schema` field). Script stdout stays
   plain markdown; color is app-only.
2. **New canonical column set** (update `QUOTE_HEADERS`, screen.mjs `HEADERS`, and
   CLAUDE.md's "standard output format" section **in the same commit**):
   `Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime` — Scan inserts `Grade`
   after Item and appends `Score gp/d`; `--positions` appends Held@/Break-even/Verdict.
   Quick cell: `31.2m → 32m · +115k (0.4%)` (buy → sell · net/u · ROI), Optimistic same
   shape on the patient band-edge basis; net/ROI colored gain/loss; the two columns
   visually parallel.
3. **Momentum strength:** expose the pre-clamp band overshoot in `computeQuote` (distance
   beyond the band edge as a fraction — pick a basis, comment it, name the double-arrow
   threshold constant). `–` muted; single arrow amber; `↓↓` red / `↑↑` green.
   `momVerdict()` and the cut-trigger consume the categorical `mom` and DO NOT change.
4. **Rating placement:** Scan is already Item→Grade. Move Finder v1's Risk grade + Rating
   bar to right after Item (`renderFinder` + `<th>` order in `index.html`; sort wiring
   follows).
5. **Sticky header + first column:** CSS-only — `.tablewrap` bounded height +
   `overflow:auto`; `thead th {position:sticky; top:0}`; first column sticky-left; corner
   cell both + higher z-index; opaque backgrounds matching both stripe states + hover.
6. **Verify:** fresh `--publish` renders the new Scan shape; Trends shows the same column
   set; sticky holds on both axes at a narrow viewport; `quote.mjs`/`screen.mjs` markdown
   still column-aligned, numbers matching the app.

### T2 — Trends: sectioned plan card + the missing last-2h view (ex PLAN-4 chunk C)

1. **Sectioned blurb** (`sreason` prose in `runTrends`, `js/trends.js`): small labeled
   sections, rendered only when they apply — **⚠ Warnings** (regime-shift + volatile;
   stays FIRST), **Flip now** (instant-spread math), **Patient pricing** / **Price to
   clear** (the `PT.falling` branch keeps its own header — the header IS the signal).
   Fine-print `.ccap` stays the trailing footer. Reuse an existing small-header pattern
   (`.stitle` scale); plain blocks, not collapsibles. Layout only — copy stays.
2. **"Recent movement (last 2h)" block** between the plan card and "Why this trend?": the
   5m series (`s5m`) is ALREADY fetched — no new requests. Small 2h chart (reuse
   `js/charts.js` inline-SVG) with the band edges (`patientTargets` basis) marked and the
   live quick buy/sell overlaid so an outside-the-band break is *visible*; one-line
   readout: band lo → hi, live-price percentile in the range, traded-window count (thin 2h
   activity should say so), Momentum with T1's arrows/colors. Respect `showAnalysis`;
   render only when the series has points.
3. **Rolled-in chart notes:** try overlaying price + volume on one axis set (volume as
   background bars; keep separate if cluttered); add a "now" vertical marker to the hourly
   charts.

### O1 — The outcomes dataset (ex PLAN-2 chunk A; full text `git show 39e5d23:PLAN-2.md`)

From here on, every offer's full story is recoverable — market context, what the tool
said, what Ben did, how long it took, what it made. `fills.json` already captures the full
offer lifecycle (placed/partial/cancelled/complete with ts/price/qty/filled/spent,
cancel-replace chains visible); this is mostly a *join* problem plus two capture gaps.

1. **Suggestions ledger:** `quote.mjs`, `screen.mjs`, `watch.mjs` append every emitted
   recommendation to repo-root `suggestions.jsonl` (append-only):
   `{ts, script, mode/params, itemId, quickBuy, optBuy, quickSell, optSell, mom, regime,
   class, verdict}`. Log at emit time, unconditionally. `class` = the item-type label *as
   computed then* (the logic evolves; recomputing later rewrites history). Scheduler
   commit set grows to include it. No PII (ids/prices/timestamps only).
2. **Market-context retention:** spot-check `/5m?timestamp=` at ~1wk / ~6mo / ~2yr back;
   document in `FILLS-PIPELINE.md` that outcome analysis relies on it. Raise
   `.cache/bands/` prune 7d → ~90d (local, gitignored) as insurance. Never commit band
   data.
3. **`pipeline/outcomes.mjs` — the join** (derived + rebuildable → gitignored). Campaign =
   one intent to trade: group same-slot/item/side chains `placed → … → terminal`; stitch
   cancel-replace successions (small-gap re-place, tunable constant) into one campaign
   with a reprice list. Per campaign: placement ts/price; **band percentile at placement**
   (trailing-2h 5m band from historical `/5m` — same basis as `patientTargets`); spread +
   limiting-side volume context; time-to-first-fill; time-to-complete (or terminal state +
   filled fraction); reprice count/steps; realized net after tax where it closes a FIFO
   lot (reuse `reconstruct.mjs` matching — never re-implement FIFO). Suggestion join:
   nearest-*prior* suggestion for the item within a bounded window; missing = null, not
   dropped. Manual/mobile fills stay as `manual: true` campaigns.
4. **First read = schema validation, not conclusions:** `outcomes.mjs --report` prints
   fill-time distributions by percentile bucket × liquidity class **with n per cell,
   refusing to summarize below a minimum n** (process rule 4). Deliverable: confidence the
   shape supports the analysis + the documented n thresholds that gate F1.

### K1 — Self-improving skills (new — Ben, 2026-07-04)

Each skill should improve itself: when a run teaches something, the learning gets encoded
in the proper canonical home — but **iteration never blocks the market work**.

1. Every SKILL.md (`positions`, `scan`, `overnight`, `morning`) gains a closing
   **"Encode learnings"** section with these rules:
   - **Timing:** only AFTER the actionable output is delivered and Ben's offers are placed
     / adjusted (or he says he's done). Never interleave doc edits with live market work —
     offers first, encoding after (Ben's explicit rule).
   - **Prompt:** at that point, ask one short question — "anything from this run worth
     encoding?" — and propose candidates the run surfaced (a judgment call that
     worked/failed, a threshold that misled, a verdict that read wrong, a workflow gap).
   - **Routing (canonical homes, move-never-copy):** judgment-layer lessons → the owning
     SKILL.md (bump its `version:`); table/app contracts → CLAUDE.md; user preferences →
     memory; monitoring doctrine → `MONITORING.md`. One home per fact.
   - **Execution:** spawn a **background subagent** to make the edits + commit so the main
     conversation keeps flowing; report the diff summary when it lands.
   - **Honesty guard (process rule 4):** process learnings encode freely; *market* claims
     (a new threshold, a pattern) need the usual evidence standard — one session is one
     sample.
2. One-line pointer in CLAUDE.md noting the convention (process rule 8 pass).

### K2 — Memory dedupe pass (ex PLAN-5 chunk 6)

Enumerate the Claude memory dir; for each memory now owned by a skill —
`gpd-floor-500k`, two-sided-liquidity, band-is-the-edge, `opportunity-cost-can-beat-
patient-hold`, and any others mirroring skill doctrine — replace with a pointer to the
owning skill or delete. Also update `execute-plans-off-main` to reflect this file's
dispatch model (single PLAN.md, subagent waves, worktrees only for parallel lanes). Same
drift rule as the CLAUDE.md slimming: one canonical home per fact.

### K3 — CLAUDE.md slimming round 2: reference material out (new — Ben, 2026-07-04)

The `/ship` extraction (gh/CI/shipping mechanics → skill, CLAUDE.md keeps a 4-bullet
pointer) is the template. Remaining extraction candidates, in value order — each gets a
one-to-three-line pointer left behind, never a silent deletion (rule 8 reconciliation):
1. **"Done (recent)" entries** (~90 lines, the single biggest block) → the 0.30.0/0.33.0
   style deep entries move to `CHANGELOG.md` (or rely on commit messages + `git show`);
   CLAUDE.md keeps one line each for only the entries a future agent must not rebuild.
2. **The `STATE` object section** → header comment in `js/state.js` itself (the one place
   every editor of shared state is already looking); pointer stays in process rules.
3. **Trends tab structure** → header comment in `js/trends.js` (same logic — it's guidance
   for editing that file), pointer from CLAUDE.md.
4. **Environment notes** (RuneLite paths, field mappings, cancel semantics, manual-fill
   timestamp rule) → already mostly duplicated in `pipeline/FILLS-PIPELINE.md`; make that
   doc the single home, leave pointers.
Not skills — none of these are workflow-shaped; they're reference docs that belong next
to the code they describe. Skills stay for workflows (`/scan` `/positions` `/overnight`
`/morning` `/ship`).

---

## Wave 2

### S1 — Screening economics: gp-flow gate, 500k floor, spread verdict (ex PLAN-4 chunk B)

Goal: an Avernic-class item (huge gp-flow, single-digit unit count — verified live: ~31.6m
mid, 12/d limiting side ≈ ~380m gp/day two-sided flow, real ~360k net/u edge, excluded by
THREE gates: unit floor, `MIN_ACTIVE`, `--min-roi`) passes the screen and is honestly
marked thin; sub-attention rows stop rendering.

1. **gp-flow alternative liquidity path** (`gateCandidates()` in `screen.mjs`): two-sided
   gate (`hpv>0 && lpv>0`) untouched — the ghost-spread lesson is non-negotiable.
   Liquidity gate becomes `limitVol ≥ FLOOR` (50, unchanged) **or** `limitVol × mid ≥
   GP_FLOOR` (new `--gp-floor`, default ~250m — pick to pass the Avernic profile with
   margin, comment why). gp-flow-only qualifiers get `thin: true` → fed to `rateItem` as a
   liquidity/exit-ease penalty capping the grade mid-scale (tooltip: "thin: ~N trades/day —
   size in units, expect slow fills"). Band-activity gate scales for thin items
   (`MIN_ACTIVE ≥ 6`/2h is impossible at 12/d — relax for gp-flow qualifiers, document the
   choice inline). ROI gate gains an absolute-gp alternative: pass on `modeRoi ≥ MIN_ROI`
   or (`thin` && `modeNet ≥ MIN_NET_GP`, ~100k/u).
2. **500k/day attention floor:** shared `--min-gpd` (default 500_000) on realistic
   `expGpDay`, applied **pre-rating** so grades never advertise sub-floor rows; held/asked
   items exempt as always. The `/scan` skill then passes the flag instead of post-filtering
   (its SKILL.md notes this switch — update it).
3. **Spread-niche verdict:** apply the floor, run `--mode all` for a few days of publishes;
   if the spread table is empty/near-empty (expected), drop spread from `--mode all` and
   the app Scan tab (keep `--mode spread` CLI-runnable until confirmed dead, then delete).
4. **Verify:** post-change `--publish` surfaces the Avernic-class big ticket with the thin
   tooltip visible in the app; the non-thin survivor set is materially unchanged vs a
   pre-change run (gp-flow *adds*, not reshuffles). Update CLAUDE.md's screen-workflow
   flags; note the two-sided *lesson* stands — the unit floor was the wrong universal
   measure.

### S2 — Overnight vs active posture (ex PLAN-4 chunk D)

`--posture overnight|active|auto` on `screen.mjs` (auto = local clock, overnight roughly
22:00–06:00, named constants). Posture tunes the shared stack, not a new niche:
**overnight** = only flat/rising regimes with confident bands (no `thin` fast-lane, no
breakdown momentum); prices at patient band edges; ranking weights net edge over velocity;
exclude items whose *yesterday overnight window* printed materially below the current
bid — the "stale/underwater by morning" test, **built on the shipped `diurnalRead`**
(quotecore, 0.33.0), with posture fixtures added to `quotecore.test.mjs`. **active** =
current behavior. `quote.mjs --positions` gains an informational late-night line flagging
open SELLs at morning-staleness risk (verdict logic unchanged). Published `screen.json`
records the posture in `params` so the Scan banner says which posture it shows. The
`/overnight` skill adopts `--posture overnight` and thins its filter prose (its SKILL.md
already flags this). Honest limit: one prior night is one sample — posture picks which
existing edges to prefer; real overnight fill-time curves are O1/F1's job.

### S3 — Watchlist always scanned (new — Ben, 2026-07-04)

Every scan always covers the watchlist, regardless of gates.

1. **Source of truth:** the pipeline can't read the browser's localStorage. Add tracked
   repo-root **`watchlist.json`** (array of item names/ids). The app loads it and treats
   `STATE.watchlist` as the union of local + repo entries; app *write-back* to the file
   arrives with M1's PAT write path — until then the file is edited in sessions ("add X to
   the watchlist") and auto-synced like other root files.
2. **Screen behavior:** `screen.mjs` (and thus `--publish` → the app Scan tab) appends a
   separate **Watchlist** section quoting every watchlisted item as a full standard row —
   exempt from floors/gates, graded, with the exclusion reason as a note where a gate
   would have hidden it ("below floor", "thin"). **Falling watchlist items ARE shown**
   with the falling warning — this extends the held/asked exception to watchlisted items;
   update the falling-exclusion rule's wording in CLAUDE.md and the `/scan` skill.
3. `/scan` skill: the judgment pass treats watchlist rows as "always report, honestly" —
   never silently dropped, never hyped past their read.

### Q1 — Gate-0 reliability gap (ex PLAN-5 out-of-scope; live datapoint 2026-07-04)

A row whose regime line carries the "⚠ feed inversion — quote basis unreliable" footnote
can still print a decisive verdict (live case: a footnoted item printed CUT-CANDIDATE
instead of NO-READ). Investigate whether `reliable`/`ordered` actually gates
`momVerdict()`'s output path in `js/quotecore.js`; fix so an unreliable basis yields
NO-READ (no decisive verdict off a non-price — the PLAN-3 Gate-0 principle). Extend
`pipeline/quotecore.test.mjs` with the inversion fixture; regression-guard the real
breakdown cut (byte-identical). Then remove the `/positions` skill's interim
NO-READ-equivalent override and the CLAUDE.md followup bullet (reconciling pass).

### E1 — Local-time audit (ex PLAN-4 chunk E)

Sweep rendered timestamps (grep `toISOString|getUTC|\.date|\.time` over `js/`): known
suspects are the live-offers list (`js/ui.js` ~L267) printing raw exchange-log
`date`/`time` strings, and day-bucket boundaries (verify `periodKey` day/week with a
near-midnight fixture). Trends `getHours()` buckets and Ledger grouping are already local —
this is confirm + fix stragglers. Land one rule line in CLAUDE.md: all displayed times are
local; UTC/ISO is storage/wire format only.

---

## Wave 3

### L1 — Action logging pass (ex PLAN-4 chunk F)

Instrument, don't rebuild: `logEvent(level, scope, msg)` + persisted ring + Logs view
exist (`js/state.js`); callers today are fetch paths only. New scope `'action'`. Call
sites (sweep `main.js`, `ui.js`, `trends.js`, `backup.js`): tab switches; manual refresh
buttons; watchlist add/remove; trade add/edit/delete + fills-row hide; Trends open (item +
source); quote expander fetches; position review runs (+ verdict counts); backup
export/import; settings changes (**never log secret values** — "PAT updated" only); scan
deep-link clicks. One line each, includes the object of the action, no PII. `LOG_MAX` 50 →
200; minimal scope filter (All / actions / system) in `logRowsHtml`. Noise rule: log state
*changes*, never renders — nothing in a render path calls `logEvent` unconditionally
(re-check T1's code too). Smoke: each instrumented action logs exactly once; nothing fires
on a passive re-render.

### G1 — PR flow + merge queue migration (new — Ben, 2026-07-04; investigation-first, lands before M1/N1)

Goal: all work lands via branch → PR → `checks` → merge queue → `main`, so concurrent
agent work serializes at the queue instead of conflicting on `main`. Foundations already
shipped 2026-07-04: `gh` installed+authed, `.github/workflows/checks.yml` (has the
`merge_group` trigger), `/ship` skill holds the current direct-to-main procedure + the
migration's direction-of-travel section.

0. **Sync-cadence investigation (blocks the rest).** The 20-min `CofferFillsSync` push is
   the only unattended direct writer to `main`, and Ben's read is the manual/on-demand
   update flow covers ~99% of his use — the schedule may drop to on-demand or be
   eliminated. Inventory what actually depends on the cadence: (a) deployed-app
   Ledger/Coffer freshness (`positions.json` fetched same-origin — matters mostly away
   from the PC; ties to M1's staleness banner + Refresh-positions button); (b) `/morning`
   `/overnight` `/positions` reconstruction freshness (these run on the PC and can invoke
   the sync locally on demand); (c) any remote reader of `fills.json`. Deliverable: a
   written decision in `pipeline/FILLS-PIPELINE.md` — eliminate the schedule / long
   cadence (e.g. daily) / on-demand only — chosen with Ben.
1. **Apply the cadence decision**: demote or delete the Task Scheduler job (§4.7 of
   FILLS-PIPELINE.md); wire on-demand sync into the session skills that need fresh data.
2. **Only if a scheduled direct writer survives step 1**: give it a bypass identity — a
   write deploy key added as a ruleset bypass actor, `GIT_SSH_COMMAND` in the sync's git
   calls. (If the schedule dies, no bypass is needed and the ruleset can be clean.)
3. **Protect `main`**: ruleset requiring a PR + the `checks` run green; enable merge
   queue (`checks.yml` already runs on `merge_group`).
4. **Flip the workflow docs in one pass** (rule 8 reconciliation): `/ship` §2/§6 rewritten
   for branch→PR→queue, CLAUDE.md process rules + gh section, PLAN.md Executor rules
   ("land directly on main" → PR flow), memory `execute-plans-off-main`.

Interacts with M1: M1's multi-writer rebase path and its stretch in-cloud reconstruction
Action assume a scheduled PC writer exists; if the schedule is eliminated, mobile
freshness leans on the Refresh button + (possibly) the in-cloud rebuild instead. That's
why G1 lands first.

### M1 — Mobile parity: GitHub-as-backend writes (ex PLAN-2 chunks B2–B5)

A phone trade lands in the same pipeline as a PC trade, seconds of friction,
fix-at-the-source intact (the phone writes a *source log line*, never
`fills.json`/`positions.json`). Decisions already taken: official OSRS mobile (no
auto-capture possible — frictionless manual capture is the goal); GitHub contents API with
a fine-grained PAT (no cloud backend, no PC-as-server).

1. **Finish B1 first (prerequisite):** the clobber-guard shipped (fetch + ff-only; amend
   requires HEAD === origin/main), but `sync-fills.mjs` still needs the full multi-writer
   path: rebase onto a moved remote so a phone-pushed log is actually *read* before
   reconstructing, fresh commit chain instead of force-push when the remote moved, loud
   abort on a failed rebase (collisions are structural bugs — the phone never touches
   PC-committed files).
2. **`mobile-fills.log`:** new tracked repo-root source log, same line vocabulary as
   `coffer-manual.log` (fills, `REMOVE`, `WITHDRAWN`, `BANKED`, explicit trade time).
   Append-only; the PC never writes it. Distinct slot-number convention (provenance stays
   visible).
3. **App write path + quick-add UI:** Settings stores a fine-grained PAT (contents
   read/write, this repo only) in localStorage — never rendered back after entry;
   documented tradeoff (own devices, single-repo, revocable). Thumb-sized quick-add: item
   search from mapping cache, buy/sell, price, qty, timestamp defaulting to now but
   editable (backdated entries MUST carry true trade time — the phantom-5-bludgeons rule).
   Write = GET sha → PUT append; on 409 re-GET and retry. Expose REMOVE/WITHDRAWN from
   fill rows. Dedupe guard: warn on identical item+price+qty within a recent window.
4. **Freshness UX:** `generatedAt` staleness banner on Ledger/Coffer; mobile-entered lines
   render immediately as *pending* rows (the `STATE.fillsPending` pattern), absorbed when
   the next `positions.json` arrives; fold in the long-standing **Refresh-positions
   button** (same-origin re-fetch on demand) — it lives naturally here. Also the S3
   watchlist write-back (add/remove from the app via the same contents-API path).
5. **Stretch — PC-free reconstruction:** a GitHub Action on pushes touching
   `mobile-fills.log` merges + rebuilds + commits `positions.json` in-cloud
   (`reconstruct.mjs` is pure; must respect single-writer ownership as a third committer
   and never require `.runelite` logs). Build only if PC-off staleness actually bites.

### N1 — Push notifications on price movement (new — Ben, 2026-07-04; design-first)

Ben's phone buzzes on market events that matter while he's away. **Design decision ships
before code** (a short committed doc section): delivery mechanism.

- **Triggers (the part that's already designed):** (1) a held position's verdict
  escalates to CUT / CUT-CANDIDATE, or Momentum hits `↓↓` on a held item; (2) a resting
  offer filled/completed (exchange log via `monitor.mjs`); (3) price crosses an explicit
  named alert ("tell me if X breaks Y"). Alerts fire on the same gate-tree evidence
  standards — no new prediction logic.
- **Trigger engine:** thin `pipeline/alerts.mjs` reusing the existing reads
  (`quote.mjs --positions` verdicts, `monitor.mjs` fills), comparing against last-run
  state (small gitignored state file) and emitting only on *transitions* — named
  dedupe/cooldown constants; quiet hours respect S2's posture clock except for fills.
- **Delivery options (decide after a live trial of (a)):** (a) a scheduled Claude Code
  background session (Cron) that runs the check and uses the harness PushNotification
  tool — zero new infra, lands on Ben's Claude app; (b) ntfy.sh topic pushed straight
  from a Task Scheduler script — no Claude dependency, public-topic caveat (item
  names/prices only — already public in this repo; obscure topic name, no PII); (c)
  GitHub Actions + email (slowest, last resort).
- Keep it out of the app entirely — pipeline + scheduled session only.

### P1 — Snapshot-re-emission dedupe (diagnosed 2026-07-05)

RuneLite re-broadcasts all GE slot states on login/world-hop/GE-open; completed-but-
uncollected offers re-log their terminal line, and collapseOffers reads the second
terminal as a second trade (phantom BUY lots; duplicate SELLs land in unmatched).
Fix in `reconstruct.mjs`: drop a terminal event when the previous event for the same
slot is an identical terminal (same item/qty/max/offer/worth) with NO intervening
BUYING/SELLING placement line for that slot. A genuine repeat trade always has a fresh
placement line between terminals; a snapshot re-emission never does — that's the
discriminator. Must ship with fixtures covering: (a) the 2026-07-04 blowpipe dup pair,
(b) a genuine same-price repeat buy (placement line between terminals — must NOT dedupe),
(c) dup pair straddling an EMPTY-burst snapshot. Read FILLS-PIPELINE.md top to bottom
first (§5.1 rule). Until P1 lands, the §10 interim tombstone procedure applies.

---

## Wave 4 — repo-review cleanup + hardening (three-agent audit, 2026-07-05)

Source: a full-repo review (app code / pipeline / docs, one Opus agent each) plus a
coordinator data-audit. Every "dead"/"duplicate" claim below was verified by the reviewing
agent (callers grepped, exports traced — including `index.html` inline handlers and
pipeline imports of `js/` modules) — executors should still re-verify before deleting,
but these are not speculative.

### D1 — Doc reconciliation pass (drift audit fixes)

All doc-only; no APP_VERSION. One agent, one commit, rule-8 style (fix in place, move
never copy):
1. **CLAUDE.md "Open followups"** still lists ~12 shipped chunks (T1…N1) as "not yet
   built" — replace the enumeration with: P1 + Wave-4 chunks + F1 (gated) are open; the
   rest shipped, see PLAN.md Status.
2. **`pipeline/FILLS-PIPELINE.md` stale handoff frame:** §1 claims a single-file app at
   v0.14.1; §6 marks the long-shipped Coffer fetch/merge/Ledger work "Not yet built"; §9's
   checklist last item is done since 0.18.0; §4 restates process rules from the
   single-file era (a `<script>`-extraction step and a `BUILD` constant that doesn't
   exist). Fix: banner the historical sections ("2026-07-01 handoff — current state in
   §5.1/§10/§12/§13") or trim; §4 becomes a pointer to CLAUDE.md's process rules.
3. **`pipeline/MONITORING.md`:** (a) "Data sources" says monitor's held positions come
   from `positions.json` — the code does the opposite (in-memory reconstruction from the
   live log, `monitor.mjs:67-96`; the doc even self-contradicts at L154). Rewrite, and
   document the `held-override.json` reconciliation knob (currently code-only). (b) Three
   "~20m sync lag" mentions describe the eliminated schedule — reword to "lag since the
   last on-demand sync". (c) L21-23 "Until that exists" ignores the shipped
   Refresh-positions button (0.39.0) — only the Ledger break-even/regime check remains
   unbuilt.
4. **README file inventory** — missing 8 `pipeline/*.mjs` and tracked root files
   `alerts.json`/`watchlist.json`/`suggestions.jsonl`/`screen.json`. The staged
   `g1-readme-inventory` branch predates N1 and omits `alerts.json` — reconcile/extend it.
5. **Small:** one clause distinguishing the two "floors" (`--floor 50` script gate vs the
   ~100/d ghost-spread judgment floor in `/scan`/`watch.mjs` — different purposes, both
   called "the floor"); `/positions` verdict table gains the two HOLD sub-verdict rows
   (`HOLD — list high`, `HOLD — watch`; skill version bump).
Verified clean (don't spend time re-checking): verdict vocabulary, column sets,
version-bump rules, PR-vs-direct-push story, memory-index pointers.

### R1 — Reconstruction test harness (highest risk-reduction in the audit)

`quotecore.test.mjs` covers the verdict tree exhaustively, but `reconstruct.mjs` — the
money path with the actual incident history (phantom lots, FIFO mis-pairs, snapshot
re-emission) — has **zero fixtures**, as do `sync-fills.mjs` merge/tombstone logic,
`offers.mjs`, and `outcomes.mjs`. New `pipeline/reconstruct.test.mjs` with synthetic
event fixtures: buy→sell FIFO close; cancel-to-EMPTY inference; `WITHDRAWN` consume;
`BANKED` basis lot; `REMOVE` tombstone deleting a persisted event; an `eventId` golden
value (guards the §5.1 `eventId()`↔`eventIdFor()` cross-file contract). Wire into
`checks.yml` next to the quotecore run. Read FILLS-PIPELINE.md top-to-bottom first (§5.1
rule). **P1 then lands its snapshot-dedupe fixtures in this harness — R1 before P1.**

### X1 — Pipeline dedup (three verified triplications + two mapping loaders)

1. `fetchInputs(id)` (latest+5m+6h+24h, 60ms spacing) is byte-identical in
   `quote.mjs:45`, `watch.mjs:125`, `alerts.mjs:91` → one `fetchItemInputs(id)` exported
   from `marketfetch.mjs` (this resolves the lane-N Discovered note below).
2. The "parse positions.json → open lots → group by itemId at weighted-avg cost →
   breakEven" block is copied in `quote.mjs:114`, `watch.mjs:289`, `alerts.mjs:125` → one
   shared `readOpenPositions()` (small `pipeline/positions.mjs` or alongside
   `reconstruct.mjs`).
3. `monitor.mjs:29-37` and `add-manual-fill.mjs:116-124` each hand-roll mapping-cache
   loading + raw `fetch` with ad-hoc UAs, bypassing `marketfetch.loadMapping()`/`jget` —
   adopt the shared loader (it already returns `{byId, resolve()}` and tolerates the flat
   cache shape).
4. `liqClass` thresholds duplicated (`suggestlog.mjs:34` vs `outcomes.mjs:109`) → import
   one; same for the `median` one-liner (`screen.mjs:144`, `outcomes.mjs:55`).
Behavior-identical refactor; pipeline-only, no APP_VERSION. Sequence after X2 (both edit
shared pipeline files).

### X2 — Dead-scheduler excision + sync ff-guard

The `CofferFillsSync` job died 2026-07-04 but its machinery survives: `run-fills-sync.cmd`
/ `run-fills-sync.vbs` (verified: referenced only by each other + historical prose) and
the entire `--auto` branch in `sync-fills.mjs` — `AUTO`, `AUTO_TRAILER`,
`Auto-Fills-Sync-Since`, and a `push --force-with-lease` path (L283-317) living inside an
otherwise fresh-commit-only, disjoint-writer sync. Git history is the recovery story;
delete the two files and the `--auto` branch (keep `syncMainToRemote`'s clobber-guard —
that's the live protection). Also: the `merge --ff-only origin/main` call (L132) is the
one un-wrapped git call in that path — route its failure into the same loud structured
"reconcile by hand" abort as the divergence case. Update FILLS-PIPELINE §12's
"retained for recoverability" note (rule 8).

### A1 — App dead-code sweep

All verified caller-free by the review agent; re-verify each grep before deleting
(remember `index.html` inline handlers + pipeline imports of `js/quotecore.js`/`format.js`):
1. Write-only STATE props `guideSource`/`guideTs`/`guideHasMomentum` (`state.js:48`,
   assigned in `market.js` + persisted to `snap_guide_src`, read nowhere).
2. `quoteMarkdown` + its `QUOTE_HEADERS` use (`quotecore.js:387`) — self-described as
   unadopted; **delete** (the `quoteCells`/`cellText` split is the real shared API; Ben
   can veto at review).
3. `svgLine` `opt.eq` branch (`charts.js:21`) + `.eline`/`.earea` CSS — no caller passes
   `eq`.
4. Dead weekend/weekday fields in `analyseBroad`/`analyseHourly`/`buildPlan`
   (`trends.js:85,106-107,149` — feed the removed weekday boxes; `runTrends` reads none
   of them).
5. Dead CSS: `.insight`(+children), `.wkrow`/`.wkbox`, `.backup`, `.cgain`/`.closs`.
6. Dead `id="cofferChev"` (`index.html:35` — CSS parent rule does the rotation).
APP_VERSION bump; browser smoke per executor rules (dead-code removal is where "syntax
passed but a render broke" bites).

### A2 — App fetch/helper unification

1. New `js/marketfetch.js` (mirrors the pipeline convention, breaks the quote↔trends
   cycle-avoidance duplication): `jget(url)` with the shared AbortController+15s-timeout
   body (currently hand-rolled ~6×: `market.js:22,44,59,75`, `trends.js:55`,
   `quote.js:14`) and one cached `fetchTs(id,step)` (currently duplicated
   `trends.js:53-58` vs `quote.js:19-20`, same cache-key scheme).
2. Route the six inline `(high-tax(high))-low` sites (`trends.js:143,291`,
   `ui.js:114,520,525,597`) through `format.js`'s existing `netMargin` (+ a qty variant) —
   the exact drift class the tax consolidation targets, and the prerequisite for BE1's
   fix reaching every P/L surface.
3. Reuse `FILLS_STALE_MS` in `renderScan` (`ui.js:685` hard-codes `6*3600*1000`).
APP_VERSION bump. After A1 (same files).

### A3 — Split `js/ledger.js` out of `ui.js`

`ui.js` (733 lines) holds four unrelated surfaces. The Ledger + fills-write cluster
(~380 lines: `addTrade`, `writeToFillsLog`/`writeToMobileLog`, `promptFillEdit`,
`editPending`/`delPending`, `editManualLog`, `renderLedger`, `renderFillsMeta`/`Fresh`,
`renderGhSync`, `periodKey`, `groupTrades`) is cohesive, owns the `fillslog.js`/`github.js`
imports, and touches nothing in Finder/Watch/Signals → pure move to `js/ledger.js`,
`renderAll` stays the coordinator. No logic change; APP_VERSION bump; full browser smoke
(every moved handler exercised once). Optional rider if either site is being touched
anyway: factor the `quoteTableHtml`/`scanTableHtml` linkname-header scaffold
(`quote.js:44` vs `ui.js:633`).

### BE1 — Break-even ignores the 5m tax cap (coordinator finding, 2026-07-05)

`tax()` (`js/format.js:6`) correctly models the 50gp exemption and the 5m `TAXCAP`, but
`breakEven = ceil(buy/0.98)` (`quotecore.js:20`, inline at `trends.js:292`, inverse at
`add-manual-fill.mjs:99`) is the *uncapped* inverse. Above 250m the cap binds: true
break-even is `buy + 5m`, i.e. `ceil(buy/0.98)` **overstates** it (a 1.6b bow: 1.633b
demanded vs 1.605b true — 28m too high), and under 50gp it's `buy` exactly. Conservative
direction (never lists *below* true BE) — but it's exactly the big-ticket class S1's
gp-flow gate admits, so wrong asks on the items where per-unit gp matters most. Fix:
`breakEven(buy)` = smallest `s` with `s - tax(s) ≥ buy` (piecewise: `<50` → `buy`;
capped region → `buy + TAXCAP`; else `ceil(buy/0.98)`); replace the trends.js inline and
the add-manual-fill inverse (its "uncapped inverse" comment already flags it); fixtures
for the three regions in `quotecore.test.mjs`; docs sweep for `ceil(buy/0.98)`
(CLAUDE.md, MONITORING.md, `/positions`, `screen.mjs` playbook string — state the
piecewise rule once, pointer elsewhere). APP_VERSION bump.

### W1 — Trade-analysis cadence (the "when do we start analyzing" answer, encoded)

Data as of 2026-07-05: 640 fill events / 64 closed lots / 15 items / 3 days; 639
suggestions logged; F1's gate at 1 of ≥5 cells. Decision: **descriptive analysis starts
now, weekly; calibration stays gated.**
1. A weekly descriptive read — `outcomes.mjs --report` + realized-P/L attribution
   (per-item, win rate, hold-time distribution, realized-vs-suggested spread capture) —
   becomes a standing ritual: fold into `/morning` as a once-a-week section (or a tiny
   `/review` skill — executor's call with Ben). Report must print n per cell and refuse
   conclusions below the O1 thresholds (process rule 4 — descriptive ≠ calibration).
2. Add two cheap honesty lines to the report: **concentration** (top item's share of
   closed lots — currently 29/64 from one item, so "per-item" reads are mostly one
   sample) and **F1-gate progress** (cells cleared / needed), so every weekly read shows
   how far from calibration-grade we are.
3. F1 unchanged: opens when its documented thresholds clear, realistically weeks away at
   ~20 lots/day — the gate check is now visible weekly instead of silent.

### CI1 — Browser smoke test in CI (blind spot: only syntax is checked)

`checks.yml` runs `node --check` + quotecore fixtures + JSON parses — an
import/export mismatch or a render-path throw ships green today; every incident class
the process rules warn about ("syntax check passed but the app broke") is invisible to
CI. Add a minimal Playwright(-chromium) job: serve the repo root, load `index.html`,
fail on any console error / unhandled rejection, assert the four tab panes render
non-empty with seeded localStorage + stubbed network (no live wiki calls in CI — fixture
JSON responses; keep it seconds-fast per the `/ship` §4 constraints). This is the check
that would make the ruleset's required-PR flow actually protective for app changes.

---

## Wave 5 — UX round + scan-yield audit (Ben, 2026-07-05)

Coordinator investigation findings are baked into each chunk — the root causes below were
verified against the code on 2026-07-05, not guessed. Wave-5 app chunks build on A3's
`js/ledger.js` split (this branch), so the wave lands on top of Wave 4. **Rebase onto
`origin/main` before dispatch** — main gained skills commits and the
`nightlows.mjs`→`windowrange.mjs` rename after the Wave-4 base.

### TB1 — Reusable sortable-table component (foundation — runs first)

Ben: "the columns should be sortable — we should build a standard table object we can
reuse i.e. watchlist, finder etc."

Today the Finder has the only sortable table, as bespoke wiring: `STATE.sortKey`/
`STATE.sortDir`, a hand-rolled comparator in `currentFinderRows()` (`js/ui.js:30-32`), and
per-render `<th>` arrow decoration (`js/ui.js:39-43`). Watchlist, Signals, Scan and the
Ledger tables have no sorting.

- **TB1.1** New `js/table.js` (zero-build vanilla, same idiom as the rest of `js/`):
  a small helper that takes a `<table>` (or thead selector) + column descriptors
  (`{key, type:'num'|'str', get(row)}`) + a re-render callback, and owns: click-to-sort on
  headers, direction toggle, sorted-column arrow/class, a stable comparator with the
  Finder's null-handling (`??-Infinity`) and the risk-grade inversion quirk (lower
  riskIndex = better ⇒ direction flip, `js/ui.js:30`). Per-table sort state persists via
  `sSet` (one key per table, e.g. `sort:finder`), replacing the Finder-only
  `STATE.sortKey`/`sortDir` pair.
- **TB1.2** Adopt it in the **Finder** (delete the bespoke comparator + arrow code; byte-
  identical default ordering) and the **Watchlist** table. Scan tab tables are
  server-rendered `cells` snapshots (`screen.json`) — adopt there only if it falls out
  free; do not restructure the snapshot format.
- **TB1.3** Acceptance: Finder default sort unchanged (rating desc), clicking each header
  sorts and re-clicking reverses, arrow tracks the active column, watchlist sortable,
  `node --check` + chromium smoke green. APP_VERSION bump.

### LU1 — Ledger UX rework (after TB1 — consumes it)

Five Ben asks, one surface (`js/ledger.js` `renderLedger` + the `#panel-ledger` markup,
`index.html:160-225`):

- **LU1.1 Row click → Trends; expansion moves to a button.** Today clicking a grouped
  closed/open row toggles expansion (`data-grp` handler, `js/ledger.js:420`). Change:
  clicking the **item name** opens Trends for that item (`openTrends(itemId)` — same
  `linkname` affordance the Finder/Signals rows already use), and the multi-lot detail
  expansion moves to an explicit **Expand/Collapse chevron button** in the row (only on
  groups with >1 lot, where expansion does something today).
- **LU1.2 P&L period filter moves next to "Closed flips".** The All/Day/Week/Month
  segmented control (`#ledgerPeriod`, `index.html:166-171`) only affects the closed-flips
  period strip — move it out of the top `ledgerctl` bar to sit on the "Closed flips"
  section label line (`index.html:218`). "Watchlist only" stays at the top (it filters
  open AND closed).
- **LU1.3 Period bucket click filters the item list.** When grouped by day/week/month,
  clicking a bucket in `#periodStrip` filters the closed-flips table below to that
  bucket's trades (`periodKey` match on sell date). Clearing must be intuitive: the active
  bucket renders highlighted with an `×`, clicking it again (or an explicit "All" pill)
  clears; switching period granularity also clears. Filter state is session-only (not
  persisted).
- **LU1.4 Manual entry collapsible.** Wrap the manual-entry form (`.ledgerform` +
  its caveat line, `index.html:188-210`) in a `<details>` (same pattern as the existing
  `#ghSync` details at `index.html:179`), summary "Log a trade…", collapsed by default;
  persist open/closed via `sSet`. The Link-fills-log/Edit-manual-entries row and GitHub
  sync details stay where they are.
- **LU1.5 Sortable closed-flips columns** via TB1 (default: last-close desc, today's
  order). Grouped rows sort by group aggregates (qty/avg buy/avg sold/tax/realised).
- **LU1.6** Acceptance: all five behaviors verified in a real chromium session (click
  name → Trends opens the right item; expand button works; period buttons live by Closed
  flips; bucket filter applies + clears; form collapsed by default; columns sort).
  APP_VERSION bump. Doc pass: CLAUDE.md Ledger-redesign line + README if it describes the
  Ledger layout.

### FX1 — Finder full-catalog search + Signals badge count (after LU1)

Two small verified bugs, both `js/ui.js`:

- **FX1.1 "Soul rune" unsearchable — root cause `MIN_PRICE`.** `buildItems()` skips any
  item with `l.high < MIN_PRICE` (=1000, `js/state.js:36`; `js/market.js:138`), so
  sub-1000gp items (soul rune ~300gp — a live S-grade band/churn row in today's
  `screen.json`) never enter `STATE.ITEMS`, and Finder search
  (`currentFinderRows`, which filters only `STATE.ITEMS`) can't find them even though the
  search path deliberately bypasses the browse gates (`js/ui.js:18`). Fix at the search
  layer, not by dropping MIN_PRICE (it exists to keep browse-mode noise out): when a
  search query is active, union in catalog matches via the existing off-screen path
  (`searchCatalog`/`rawItem`, `js/market.js:105-125`) for ids not in `STATE.ITEMS`.
  Guard the renderer: off-screen rows lack `rate`/`score`/`fill`/`turn` — render `—`
  (the `gTitle` fallback already handles `!rt`). The quote button + star must work on
  them (both key off id; `toggleWatch`→`resolveId` already handles catalog items).
- **FX1.2 Signals badge reads 0 with rows present — by design, but misleading.**
  `#sigBadge` shows `firing` = rows where the BUY signal fires now (`js/ui.js:118-119`),
  not the row count, so it reads 0 while the tab lists several watched items. Change the
  badge to `firing/total` (e.g. `0/6`) — keeps the firing signal prominent, kills the
  "tab is empty" misread. If the badge styling makes `x/y` too wide, fallback: show
  `total` with a distinct "firing" style only when `firing>0`, coordinator's call at
  execution.
- **FX1.3** Acceptance: searching "soul" surfaces Soul rune with live prices + working
  quote/star; browse view (no query) byte-identical; badge shows both numbers; chromium
  smoke green. APP_VERSION bump.

### NY1 — Scan niche-yield audit (pipeline/analysis; parallel-safe)

Ben: "only receiving a small crop of viable items from the scan flow — was one of the
niches completely removable since it never surfaces good items?"

Coordinator snapshot (2026-07-04 `screen.json`, mode all): **band** 34 rows, 33 ≥ A-;
**churn** 35 rows, 25 ≥ A-; **spread** 40 rows, best grade B+ (26 C/D); **rising** 39
rows, 20 grade-D. 34 of 106 distinct items appear in 2+ niches, band∩churn overlap heavy
(runes). So spread/rising look weak and churn looks like band's shadow — but ONE snapshot
is not evidence (process rule 4), and S1.3's spread-drop was already deferred pending
"a few days of `--mode all` publishes".

- **NY1.1** Evidence read over the accrued **O1 `suggestions.jsonl`** (every surfaced row
  since Wave 1, with niche + grade + prices): per-niche grade distribution over time;
  per-niche **unique contribution** (items ONLY that niche surfaces that ever grade ≥ B+);
  band↔churn Jaccard overlap; join to `positions.json` closed lots — which niche surfaced
  the flips Ben actually took (soul rune!).
- **NY1.2** Recommendation ONLY — **the drop decision comes back to Ben with the
  evidence** (Ben, 2026-07-05; supersedes the earlier "implement if decisive" wording).
  For each of spread/churn/rising, recommend keep / drop / demote with the numbers
  behind it; do NOT touch `screen.mjs`, `/scan`, or the S1.3 note — those change only
  after Ben rules. Also answer the *other* half of "small crop": is the perceived
  scarcity concentration (few NEW names day to day) rather than few rows — report
  new-vs-repeat item counts per day.
- **NY1.3** Report to Ben in prose (per rule 4: sample sizes stated). Pipeline-stdout /
  analysis only unless a drop is implemented; no APP_VERSION either way (screen.json
  shape unchanged, or Scan-tab niche list follows the published file automatically —
  verify `NICHE_ORDER` handles a missing niche, `js/ui.js:273`).

### SY1 — Strategic sync-fills runs (skills-only; parallel-safe)

Ben: "run `node pipeline/sync-fills.mjs` at strategic points to avoid stale data."
The sync is on-demand since the scheduler was eliminated (FILLS-PIPELINE §12) — the gap is
that workflow skills don't consistently refresh before reading positions.

- **SY1.1** Audit the four workflow skills + MONITORING.md: which already run/mention the
  sync at session start. Encode: **/positions**, **/morning**, **/overnight** run
  `node pipeline/sync-fills.mjs` FIRST (before any positions/fills read); **/scan** runs it
  only when the position-context pass needs the book (it does, since 1.4 — so yes, first
  there too). Note the multi-writer contract: the sync ff-pulls `origin/main` (phone
  lines) before reading logs, so this also picks up mobile entries — that's the point.
- **SY1.2** SKILL.md `version:` bumps only, never APP_VERSION. One caveat to encode: the
  sync pushes to `main` (pipeline-owned artifacts, admin bypass) — skills running in a
  worktree/branch context must run it from the MAIN checkout (`C:\dev\The-Ledger`), not
  the worktree, or skip it and say so.

---

## Gated / unscheduled

### F1 — Algorithm feedback loop (ex PLAN-2 chunk D — GATED on O1's n thresholds)

The payoff of O1. Fill-probability/fill-time curves by band-percentile × item class →
replace `patientTargets`' fixed 20th/80th percentiles with class-conditional choices;
observed time-to-fill replaces `Exp gp/d`'s cycle-time assumptions; realized-vs-suggested
calibration report (the O1 suggestion join makes it a query). Known confound: regime mix —
bucket outcomes by regime label before believing any curve. Do not start until O1's
documented sample thresholds clear (process rule 4).

### Other unscheduled notes
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

## Discovered

**Open:**
- No `--niche` keyword flag on `screen.mjs` (skills filter output rows by hand; a flag is
  a possible future convenience).
- Mixed line-ending handling (recurring `LF will be replaced by CRLF` warnings on Windows
  commits) — a `.gitattributes` normalization pass would quiet it (lane K, 2026-07-04).
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
- README.md's pipeline file inventory is incomplete: missing `watch.mjs`, `rating.mjs`,
  `windowrange.mjs` (né `nightlows.mjs`), `offers.mjs`, `outcomes.mjs`, `suggestlog.mjs`, `quotecore.test.mjs` and the
  tracked root files `watchlist.json`/`suggestions.jsonl`/`screen.json` (wave-3 scan,
  2026-07-04). Fix staged on branch `g1-readme-inventory` — becomes the G1 acceptance PR once
  the gh token is refreshed.
- ~~`alerts.mjs` and `quote.mjs` each define their own ~5-line `fetchInputs(id)` helper~~ —
  promoted to chunk **X1** (2026-07-05 audit found a third copy in `watch.mjs`).
- Signals render 2-3× during init (`market.js:96-101`: `renderAll` → bare `computeSignals`
  → `archiveWatchlist().then(computeSignals)`) — idempotent, functionally fine; note for a
  future perf pass, not a bug (audit, 2026-07-05).
- `parseGp` exists in both `pipeline/cli.mjs:29` and `js/format.js:24` with slightly
  different behavior — intentional app/pipeline divergence; worth a one-line comment in
  each noting so (audit, 2026-07-05).
- `suggestions.jsonl` grows unbounded in the tracked repo (639 lines in ~2 days ≈ tens of
  MB/year at this pace) — needs a rotation/compaction story before it gets silly (e.g.
  monthly archive files, or move history out of the deploy root) (audit, 2026-07-05).
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
- P1's `dedupeSnapshots()` runs inside `reconstruct()` (positions.json + `monitor.mjs`), but
  `outcomes.mjs` calls `collapseOffers`/`matchTrades` directly for campaign boundaries, so its
  campaigns can still see a snapshot-duplicate terminal as a phantom offer. Low impact (outcomes
  is derived/gitignored), but adopt `dedupeSnapshots` there if campaign counts ever look off
  (P1, 2026-07-05).

**Resolved:** earlier per-plan Discovered lists (chunks 4/8/10 fixes) are preserved in git
history — `git show 39e5d23:PLAN.md`.
