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
| M1 | Mobile parity — GitHub-as-backend writes | `pipeline/sync-fills.mjs`, `mobile-fills.log` (new), app settings/UI | DISPATCHED (wave 3, 2026-07-04) |
| N1 | Push notifications on price movement | new `pipeline/alerts.mjs` + design doc section | DISPATCHED (wave 3, 2026-07-04) |
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
  `nightlows.mjs`, `offers.mjs`, `outcomes.mjs`, `suggestlog.mjs`, `quotecore.test.mjs` and the
  tracked root files `watchlist.json`/`suggestions.jsonl`/`screen.json` (wave-3 scan,
  2026-07-04).

**Resolved:** earlier per-plan Discovered lists (chunks 4/8/10 fixes) are preserved in git
history — `git show 39e5d23:PLAN.md`.
