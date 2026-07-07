# PLAN-YIELD — the yield-improvement program (planning lead: Fable, 2026-07-06)

**Status: PLAN ONLY. Nothing here is built.** This is the architecture-fit review + the #1
output-schema design + a chunked, Opus-allocated build plan for Ben's five-part yield-improvement
program. It follows the master-plan idiom (chunk IDs, one-line "don't-rebuild" intent, wave
sequencing, per-chunk pipeline-vs-app + test fixtures). Per the master-plan convention it **folds
into `PLAN.md` and is deleted when its last chunk ships** (like `PLAN-VERDICT.md` did).

## Build status (this file folds into PLAN.md when the last chunk ships)

| Chunk | State |
| --- | --- |
| FC1 | ✅ shipped (opt-in fetch cache; OFF by default → decision paths byte-identical; `fetchcache.test.mjs`) |
| YF1 | ✅ shipped (`loadHistDaily` + pure `deriveState` in `lib/histstate.mjs`; `histstate.test.mjs`) |
| YS1 | ✅ shipped (outcomes.mjs → schema v2: `stateAtFill`/`holdTimeSec`/`parkedSec`/`velocityClass`/`predicted`; dedupe routed; `velocity.mjs`+test. Refinement: the pure `velocityClass` landed here, not YV1, so outcomes.mjs is edited once) |
| YS2 | ✅ shipped (`suggestionEntry` lean-includes forward fields; `posture` wired into quote/screen/watch; tripwire/fillWindow/thesis/velocity = plumbing until a caller can honestly compute them; `suggestlog.test.mjs` extended) |
| YV1 | ✅ shipped (`lib/capitalutil.mjs` `bookUtilization`+`parkedStats`; watch footer working/parked line; outcomes `--report` #3 velocity+capital section; `capitalutil.test.mjs`. Scan per-row velocity tag deferred — needs outcomes.json wired into screen; the `--report` section is the primary #3 home) |
| YT1 | ✅ shipped (`lib/sessionthesis.mjs` + `thesis.mjs` CLI (sole writer) + read-only watch reminder line after the emit contract; `sessionthesis.test.mjs`) |
| YP2 | ✅ shipped (`lib/statetransition.mjs` off `phase()`; screen.mjs stdout "WATCH CLOSELY" list, deduped across niches, captures basing fallers before the falling-drop; `statetransition.test.mjs`) |
| YP1 | ✅ shipped (`lib/guideanchor.mjs` model + gated advisory line on quote/watch; ships SILENT — 0/16 real history rows clear the gate; also reconciled the `.guide-history.jsonl` gitignored→tracked doc drift; `guideanchor.test.mjs`) |
| YA1 | ⏳ building (app; APP_VERSION bump) |

Ben's fixed priority: **#1 (highest) → #3 → #4 (folds into #1) → #2 → #5 (eventually).**
The unifying insight that shapes everything below: **#1 is the data spine; #3/#4/#2 are read
layers over the dataset #1 produces; #5 is presentation.** So **the #1 record contract is the
first real deliverable** — designed here (§2) before any analytics chunk.

---

## 1. Architecture-fit review — how each area maps onto what exists

The load-bearing finding: **most of #1 already exists.** `pipeline/outcomes.mjs` (O1, `b0749bf`)
is the descriptive-analytics engine — it already builds a per-campaign record, classifies
band-percentile *at placement* (via `loadHistBands`), joins the nearest-prior suggestion, folds in
FIFO realized P/L, and prints fill-time distributions by band-pctl × liquidity class with the F1
gate and concentration caveat. **We EXTEND it; we never rebuild it.** The whole program is analysis
layers hung off its enriched output.

| Area | Existing module it extends | Net-new | Seam / risk |
| --- | --- | --- | --- |
| **#1(a) every-fill market-state** | `outcomes.mjs` (campaigns, `loadHistBands` band-pctl) | regime+phase **at fill time** for every fill (incl. unsuggested) — a *past 6h/1h* read `loadHistBands` doesn't do | **The missing historical-state helper is the shared seam (§1.1).** Also: `outcomes.mjs` calls `collapseOffers`/`matchTrades` directly, bypassing `dedupeSnapshots` (PLAN Discovered) — every-fill classification must route through the deduped boundaries or it classifies phantom terminals |
| **#1(b) forward enrichment** | `pipeline/lib/suggestlog.mjs` + writers (`quote.mjs`/`screen.mjs`/`watch.mjs`) | log posture · named tripwire · predicted fill-window · velocity class · thesis | Purely **additive** JSONL fields (back-compat: `outcomes.joinSuggestion` reads `?? null`, so old rows survive). Fields are defined by the §2 contract |
| **#3 velocity + capital-util** | `outcomes.mjs` hold-time fields; `collapseOffers` spans | pure `velocity.mjs` (fast/slow classer off measured hold-time) + `capitalutil.mjs` (parked-vs-working from `tsOpen→tsClose`) | **No persisted parked-capital series exists** — must reconstruct from the exchange log via `collapseOffers`. Surface seams: `screen.mjs:331-349` (per-row tag), `watch.mjs` note block (util line) |
| **#4 session-thesis memory** | `watchstate.mjs` persistence pattern (`.cache/watch-state.json`) | a thin `.cache/session-thesis.json` + a read-side view over #1's enriched log | Folds into #1 as a **consumer of #1(b)'s logged fields** — not a separate data source. Persist exactly like `loadState`/`saveState` do |
| **#2 guide re-anchor** | `.guide-history.jsonl` (`{ts,id,name,guide,prev}`), already captured by `watch.mjs logGuideChanges` | per-item update-time + magnitude model → "guide update expected ~HH:MM, projected ≈X" | **Gated on accrual** (2 observed deltas today). Honesty twin of F1 |
| **#2 state-transition scan** | `phase()` (`js/quotecore.js`), already used at `screen.mjs:306` | "entering interesting states" list (faller→`basing`; `spike` w/ rising vs falling lows) | Builds on the existing phase seam + the §1.1 historical helper |
| **#5 app surfacing** | `js/trends.js` (the long-open "recommend price adjustment" button), windowrange read | in-app fill-probability + timing surfacing | **The only APP_VERSION-bumping area.** Deliberately last — console-first is the intentional design; doing it after the console workflow hardens means less rework |

### 1.1 The seam to refactor FIRST — a shared historical market-state helper (relates to FC1)

Both **#1(a)** (classify every fill's market state) and **#2** (state-transition + guide models)
need to reconstruct **market state at a past timestamp**. Today only half exists:

- **Have:** `loadHistBands(reqs, hours)` (`lib/marketfetch.mjs`) — batched *past 5m band* at each
  `{id, endUnix}`, whole-market-fetch-once/extract-many, archived under `.cache/outcomes-bands/`,
  90-day retention. This is the band-percentile source `outcomes.mjs` already uses.
- **Missing:** the equivalent for *past 6h/1h* series, which `regimeLabel`/`phase`/`regimeDrift`
  (all pure in `js/quotecore.js`) need to classify **regime** and **phase** at that same past time.

So the clean move is **YF1 (§3): extend the historical fetch into one `loadHistState(reqs)`** that
returns the full reconstructed state — band-pctl **+** regime **+** phase — at each past timestamp,
by adding a batched past-6h/1h pull alongside the existing 5m one, feeding the **existing pure
classifiers** (no new math). Build this **before** the every-fill chunk (YS1) and the
state-transition chunk (YP2), which both consume it.

**Relation to FC1 (already specced, PLAN Discovered):** FC1 is the *cross-invocation* live-fetch
cache (screen→windowrange→watch same-item overlap). YF1 is a *past-timestamp batched
reconstruction* — a different axis, but they share `lib/marketfetch.mjs`'s `jget`/disk-cache layer.
YF1's **backfill** path is served by its own archive cache (like `loadHistBands`), so **YF1 does not
hard-depend on FC1**. Recommendation: **promote FC1 and land it first or in parallel** — it cuts the
redundant live pulls YF1/YS1/YP2 will otherwise make, and it's a pure byte-identical wrapper — but
treat it as a *recommended prereq, not a blocker*. Both are pipeline-only, no APP_VERSION.

### 1.2 Invariants every chunk below must preserve (called out per chunk in §3)

1. **`quotecore.js` stays PURE**; verdict DECISIONS stay byte-identical; the Gate-2 breakdown-cut
   invariant is never softened (regression-pinned). Every classifier YF1 uses is *consumed*, never
   forked — no market math is re-implemented in the analytics layer.
2. **Pipeline vs app.** All of #1–#4 and #2 are **pipeline-only → NO `APP_VERSION` bump**. Only #5
   (YA1) touches the app and bumps it. Skills bump their own SKILL.md `version:` only.
3. **Single-writer / clobber-guard (§12/§13).** No new unattended writer to `main`; only
   `sync-fills.mjs` writes `fills.json`/`positions.json`/`offers.json`. New datasets are
   **gitignored derived artifacts** (like `outcomes.json`) or **tracked append-only** (like
   `suggestions.jsonl`) — never written by an unattended process to `main`. Any log-reader treats
   `EMPTY` as a boundary only and routes dedupe through `reconstruct()`/`validateSlotTransitions()`.
4. **Test discipline.** Every chunk adds a `pipeline/**/*.test.mjs` with a BUSINESS REQUIREMENTS
   banner + synthetic fixtures + `node:assert/strict`; auto-discovered by `run-tests.mjs` (no CI
   wiring). Colocated, never a `tests/` dir.
5. **No PII** (public repo); displayed times LOCAL, storage/wire UTC.
6. **Doc reconciliation + README file-inventory entry** are part of every chunk (process rule 8) —
   a new file with no inventory entry is undocumented by definition.

---

## 2. THE #1 OUTPUT-SCHEMA DESIGN (the contract #3/#4/#2 read) — first real deliverable

Two records make up the contract: the **enriched campaign record** (what `outcomes.mjs` emits,
bumped to `version: 2`) and the **enriched suggestion record** (what the writers log going forward).
Everything downstream reads these; design them to serve #3/#4/#2 now.

### 2.1 Enriched campaign record — `outcomes.json` `campaigns[]` (schema `version: 2`)

Existing v1 fields stay byte-identical (don't drop any). **Added fields** — grouped as `stateAtFill`
(the #1(a) every-fill classification) and read-support fields for #3/#4:

```jsonc
{
  // ── unchanged v1 fields (do not remove) ──
  "itemId", "name", "side", "manual",
  "placementTs", "placementPrice", "targetQty", "filledUnits", "filledFraction",
  "terminalState", "timeToFirstFill", "timeToComplete", "everFilled",
  "repriceCount", "reprices",
  "bandLo", "bandHi", "bandPct", "bandCovered", "spread2h", "limitVol2h",
  "volDayCurrent", "liqClass", "realised",
  "suggestion": { /* nearest-prior join, unchanged */ },

  // ── NEW: #1(a) market-state-at-FILL (not just placement), for EVERY campaign ──
  "stateAtFill": {
    "atTs": 1783300000,            // the first-fill ts (or placement if never filled)
    "bandPct": 62,                 // percentile within the trailing-2h band AT the fill (via YF1)
    "regime": "flat",              // regimeLabel() over past-6h series AT the fill (YF1) — the F1 confound
    "phase": "basing",             // phase() over the same past-6h series (YF1)
    "reconstructed": true,         // false ⇒ history unavailable at that ts (honest null-out, never fabricated)
    "source": "hist-5m+6h"         // provenance tag; distinguishes archive-cache vs live
  },

  // ── NEW: #3 read-support (all MEASURED, never guessed) ──
  "holdTimeSec": 43200,            // round-trip: buy-fill → matched sell-fill (null if open/unmatched)
  "parkedSec": 5400,              // time this offer sat resting before first fill (tsOpen → tsFirstFill)
  "workingFraction": 0.61,         // filledUnits/targetQty weighted by time — capital-utilization primitive
  "velocityClass": "slow-hold",    // derived bucket off holdTimeSec (fast-cycler | mid | slow-hold | n/a)

  // ── NEW: #1(b) prediction fields, COPIED from the joined suggestion when present ──
  //     (present only when a matching enriched suggestion exists; null otherwise — backfill can't invent them)
  "predicted": {
    "posture": "overnight",        // active | passive | overnight
    "tripwire": "support 17.2m",   // the named structural tripwire at suggest time
    "fillWindowHrs": 8,            // predicted time-to-fill bucket
    "thesis": "guide re-anchor lift", // free-text intent (NO PII)
    "velocityClassPredicted": "slow-hold"
  }
}
```

**Honesty rules baked into the schema:**
- `stateAtFill.reconstructed:false` + all-null fields when the past series is unavailable — **never
  a fabricated percentile** (mirrors `outcomes.joinSuggestion` returning `null`, never a guess).
- `stateAtFill` is **5m-bucket approximate** (fine for percentile/regime/phase classification, **not**
  tick-exact) — documented on the field and in the report banner.
- `predicted.*` is **null on all backfilled rows** — those fields only exist forward (§2.2). The
  descriptive backfill must never present a `predicted` value it didn't log.
- The record stays **derived + gitignored** (`outcomes.json`) — rebuildable any time, never committed.

### 2.2 Enriched suggestion record — `suggestions.jsonl` (additive, back-compat)

`suggestlog.mjs`'s `logSuggestions` writer gains these fields; readers already tolerate missing keys
(`?? null`). Old rows stay valid — **no migration, no rewrite of the 351 recovered rows**.

```jsonc
{
  // ── unchanged ── ts, itemId, name, script, mode, verdict,
  //                 quickBuy, optBuy, quickSell, optSell, mom, regime, class
  // ── NEW forward-only enrichment ──
  "posture": "overnight",          // from screen.mjs --posture / the active workflow
  "tripwire": "support 17.2m",     // the named structural level the rec is watching
  "fillWindowHrs": 8,              // predicted time-to-fill (from windowread quantiles where available)
  "velocityClass": "slow-hold",    // predicted from liqClass + band width
  "thesis": "guide re-anchor lift" // one-line intent — NO PII, no RSN, no account detail
}
```

This is the join key that lets #1(a)'s backfill and #1(b)'s forward log meet: `outcomes.mjs`'s
`joinSuggestion` already pulls the nearest-prior suggestion; it just starts copying the new fields
into `campaign.predicted`.

---

## 3. Chunked plan (PLAN.md idiom)

Chunk IDs are `Y*` (yield). Each line: **don't-rebuild intent · deps · pipeline/app · primary files ·
test fixture · invariants touched.**

| Chunk | Don't-rebuild intent | Deps | App? | Primary files | Test fixture |
| --- | --- | --- | --- | --- |
| **FC1** | Cross-invocation live-fetch cache — pure byte-identical TTL wrapper on the CLI fetch layer (already specced in PLAN Discovered; **promote**). Don't let a stale cache feed a *decision* (short-TTL/bypass held/bid quotes). | — | no | `lib/marketfetch.mjs`, gitignored `.fetch-cache/` | `fetchcache.test.mjs` (hit-within-TTL returns byte-identical payload; bypass on write path) |
| **YF1** | Shared historical **market-state** helper `loadHistState(reqs)` — extend `loadHistBands` to also batch past-6h/1h and feed the EXISTING pure `regimeLabel`/`phase` (no new math). The seam #1(a) & #2 both need. | FC1 (soft) | no | `lib/marketfetch.mjs`, `js/quotecore.js` (import only) | `histstate.test.mjs` (band-pctl+regime+phase from a synthetic past series; `reconstructed:false` when absent) |
| **YS1** | **Enrich `outcomes.mjs` to schema v2** — `stateAtFill` for EVERY fill via YF1 + `holdTimeSec`/`parkedSec`/`workingFraction`/`velocityClass` + `predicted` copy from the join. **EXTEND, do not rebuild;** route boundaries through the deduped offers (fix the `dedupeSnapshots` bypass). | YF1 | no | `pipeline/outcomes.mjs` | extend `outcomes`-style fixture: v2 record shape, null-out honesty, dedupe applied |
| **YS2** | **Forward prediction-field logging** — `suggestlog.mjs` + writers log posture/tripwire/fillWindow/velocity/thesis (additive, back-compat). Don't rewrite old rows. | §2 contract | no | `lib/suggestlog.mjs`, `quote.mjs`, `screen.mjs`, `watch.mjs` | `suggestlog.test.mjs` extend: new fields written, old rows still parse |
| **YV1** | **#3 velocity + capital-utilization analytics** — pure `velocity.mjs` (measured hold-time classer) + `capitalutil.mjs` (parked-vs-working from `collapseOffers` spans). Surface as a per-row scan tag + a watch util line. Measured, never guessed; output-only, never a verdict input. | YS1 | no | new `lib/velocity.mjs`, `lib/capitalutil.mjs`, `screen.mjs`, `watch.mjs` | `velocity.test.mjs`, `capitalutil.test.mjs` |
| **YT1** | **#4 session-thesis memory (folds into #1)** — thin persisted `.cache/session-thesis.json` (persist EXACTLY like `watchstate.loadState/saveState`) + a read-side view over #1(b)'s logged fields so the agent stops re-deriving each pass. | YS2 | no | new `lib/sessionthesis.mjs`, `watch.mjs`, `.claude/skills/positions/SKILL.md` | `sessionthesis.test.mjs` (persist/round-trip; stale-lane expiry) |
| **YP2** | **#2 state-transition scan** — flag items ENTERING states (faller→`basing`; `spike` rising-lows vs falling-lows) on the existing `phase()` seam (`screen.mjs:306`) + YF1. Populates a "watch closely" list; a scan of *entries*, not a verdict. | YF1 | no | new `lib/statetransition.mjs`, `screen.mjs` | `statetransition.test.mjs` |
| **YP1** | **#2 guide re-anchor prediction** — per-item update-time + magnitude model off `.guide-history.jsonl`; surface "guide update expected ~HH:MM, projected ≈X"; fold into ask-pricing doctrine. **GATED on accrual** (honesty twin of F1). | `.guide-history.jsonl` accrual | no | new `lib/guideanchor.mjs`, `quote.mjs`, `watch.mjs`, `/positions` skill | `guideanchor.test.mjs` (synthetic multi-day history; refuses a claim below N observed updates) |
| **YA1** | **#5 app surfacing (LAST)** — windowrange timing read + #1 fill-probability in-app; the Trends "recommend price adjustment" button. **APP change → APP_VERSION bump.** Fill-probability shows DESCRIPTIVE only until F1 opens. | YS1 (+F1 for calibrated numbers) | **yes** | `js/trends.js`, `js/ui.js`, `styles.css`, `index.html`, `js/state.js` | app smoke (`smoke.mjs`) + any extracted-core fixture |

**Not in this plan (unchanged):** **F1** stays GATED (n≥30 per side×pctl×class×regime cell, ≥5
cells; currently 1). This program front-loads the DESCRIPTIVE phase — it does **not** open F1. YA1's
fill-*probability* surfacing is descriptive until F1's gate clears.

---

## 4. Opus subagent allocation & wave sequencing

Landing reality (respected): **attended direct-push to `main` under the admin bypass**, PR-creation
token-blocked, **no merge queue**, parallel lanes are **hand-serialized worktree subagents**
(`isolation: "worktree"`). Two lanes may run concurrently only when their **primary-file sets are
disjoint** (same-function overlap must be sequenced). Coordinator = Ben's main session; one chunk per
Opus subagent; brief template = *"Read CLAUDE.md fully, then PLAN.md Executor rules and PLAN-YIELD
chunk `<ID>`. Execute, validate, commit."*

**Wave Y0 — foundation (mostly sequential; the schema gates everything):**
- **FC1** — 1 Opus lane. Independent; land first (or parallel with YF1 — files overlap in
  `marketfetch.mjs`, so if parallel, **sequence FC1→YF1** to avoid a same-file merge fight).
- **YF1** — 1 Opus lane, **after FC1**. Same file (`marketfetch.mjs`) ⇒ not parallel with FC1.
- **YS1** — 1 Opus lane, **after YF1** (hard dep: consumes `loadHistState`).
- **YS2** — 1 Opus lane. Disjoint files from YS1 (`suggestlog.mjs`+writers vs `outcomes.mjs`) ⇒
  **YS1 ∥ YS2 can run as two worktree lanes** once the §2 field contract is frozen (it is, above).
  Hand-serialize the merges.

**Wave Y1 — analysis layers (#3 then #4):**
- **YV1** and **YT1** both touch `watch.mjs`'s note block → **same-function overlap → sequence
  YV1 → YT1** (or one lane does both watch.mjs edits). YV1 depends YS1; YT1 depends YS2.
- **YP2** is disjoint (new `statetransition.mjs` + `screen.mjs` gate region) and depends only on
  YF1 → **YP2 can lane-parallel Wave Y1** as a third worktree lane (watch for the `screen.mjs`
  same-region overlap with YV1's per-row tag — different function, git-mergeable, but coordinate).

**Wave Y2 — predictive (gated) + presentation:**
- **YP1** — 1 Opus lane, **gated on `.guide-history.jsonl` accrual** (days). Buildable-but-honest:
  the model can ship refusing a claim below N observed updates (like the F1 gate pattern).
- **YA1** — 1 Opus lane, **last**, single lane (app files, APP_VERSION bump, Pages deploy watch).

**Parallelizable-at-a-glance:** `YS1 ∥ YS2` · `YV1 → YT1` with `YP2` alongside. Everything else
sequential. The **YS1 schema chunk is the true gate** — nothing in Wave Y1/Y2 reads a stable dataset
until it lands.

---

## 5. Honesty / calibration caveats (kept visible throughout — this program's entire point)

- **Descriptive ≠ calibrated.** Backfill front-loads the DESCRIPTIVE phase. It does **not** clear
  F1's statistical gate and must never masquerade as a fill-rate model. Every `--report`-style
  surface keeps the n-per-cell suppression `outcomes.mjs` already enforces (`MIN_N`), and the F1
  gate stays GATED until n≥30 per (side×pctl×class×regime) cell across ≥5 cells.
- **Concentration.** ~116 closed lots today, top-item-dominated (`outcomes.mjs` already prints the
  >40% caveat). Per-item velocity/util reads are **near-anecdote** — carry that caveat into #3's
  tags: a velocity class off 3 lots is a label, not a rate.
- **One session / one week = one sample.** #4's thesis memory and the weekly read (W1) never
  promote a single window to a trend.
- **#2 needs calendar time.** Guide re-anchor (2 observed deltas) and state-transition claims bake
  over days — YP1 ships gated, YP2's "entering" flags are descriptive prompts, not predictions.
- **5m-bucket approximation.** `stateAtFill` is percentile/regime/phase-grade, not tick-exact —
  stamped on the field and the report banner.
- **Regime is the known confound.** Bucket every outcome by regime label *before* believing any
  curve (already the F1 gate's fourth axis).

---

## 6. Test plan per chunk (money-primitive + analytics fixtures)

All synthetic, `node:assert/strict`, BUSINESS REQUIREMENTS banner, auto-discovered by
`run-tests.mjs` (adding the file is the whole job).

- **FC1** `fetchcache.test.mjs` — hit-within-TTL returns byte-identical payload; miss on stale;
  bypass on `--fresh`/write path; short-TTL for a decision quote.
- **YF1** `histstate.test.mjs` — band-pctl + regime + phase reconstructed from a synthetic past 5m/6h
  series match the pure classifiers; `reconstructed:false` + null-out when history absent.
- **YS1** extend the outcomes fixture — v2 record shape; `stateAtFill` on an unsuggested fill;
  `predicted` null on backfill; dedupe applied so a phantom terminal doesn't spawn a campaign.
- **YS2** extend `suggestlog.test.mjs` — new fields written; a legacy row (missing keys) still
  parses and joins.
- **YV1** `velocity.test.mjs` (hold-time → class buckets, boundary values) + `capitalutil.test.mjs`
  (parked-vs-working from synthetic `tsOpen→tsFirstFill` spans; a never-filled offer = 100% parked).
- **YT1** `sessionthesis.test.mjs` — persist/round-trip a lane; stale-lane expiry; no fabricated
  thesis when none logged.
- **YP2** `statetransition.test.mjs` — faller→`basing` flagged; `spike` w/ rising lows vs falling
  lows separated; no flag on a clean range.
- **YP1** `guideanchor.test.mjs` — update-time/magnitude off synthetic multi-day history; **refuses a
  timing claim below N observed updates** (the honesty gate is itself pinned).
- **YA1** — `smoke.mjs` (headless chromium, all network stubbed) stays green; extract any new pure
  app logic into a `*core.js` and fixture it.

---

## 7. Risks & discovered (feed back to PLAN.md Discovered on fold)

- **`outcomes.mjs` dedupe bypass** (already PLAN Discovered) — YS1 must adopt `dedupeSnapshots` /
  route through `reconstruct()` boundaries, else every-fill classification counts phantom terminals.
- **`.guide-history.jsonl` tracked-vs-gitignored doc drift** — CLAUDE.md/PLAN.md/this brief call it
  *gitignored*; README's inventory (per the research read) lists it *tracked*. Reconcile in YP1's
  doc pass (decide one, fix the other in place — process rule 8). Flagged, not actioned.
- **`watch.mjs` note-block contention** — YV1's util line + YT1's thesis line + the existing V5 EMIT
  CONTRACT (`heldNoteBlock`) all write the same block. New lines must be **nested sub-lines that
  never displace the guaranteed sell/list-at + break-even field**, and must be OUTPUT-ONLY (no
  verdict/alert input, no new headline verdict string or dot color — the palette is closed).
- **FC1 stale-cache-into-a-decision** — size TTLs so a held/bid quote a verdict runs on stays
  short-TTL or bypasses; the win is on back-to-back reads and quiet loops only.
- **SR1 (`suggestions.jsonl` rotation)** is adjacent — YS2 grows the row width; if SR1 hasn't landed,
  note that rotation must preserve the new fields (archive, don't drop — they're calibration data).
