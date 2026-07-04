# PLAN-2 — The Coffer: outcomes data, mobile source-of-truth, Finder v2 (2026-07-03)

Sequel to `PLAN.md` (chunks 1–10 complete). Same executor contract: **read `CLAUDE.md` fully,
then PLAN.md's "Executor rules" — they all apply here verbatim** (node --check, real-browser
smoke test, APP_VERSION bump on app changes, no PII, only sync-fills writes fills/positions,
spec-style: rule + cheap anchor, no live data pasted into this doc).

## Status (2026-07-04)

- **Chunk A (outcomes dataset)** — OPEN. Nothing built (`suggestions.jsonl` doesn't exist);
  the dataset compounds with calendar time, so this stays the priority chunk.
- **Chunk B (mobile writes)** — B1's safety core SHIPPED as the sync-fills clobber-guard
  (fetch + ff-only before git work; amend additionally requires HEAD === origin/main, else
  plain commit whose push fails safely). The rebase-onto-moved-remote path for a genuine
  second committer, and B2–B5, remain OPEN.
- **Chunk C (Finder v2)** — SHIPPED as 0.31.0, then **superseded** by the niche-rating Scan
  rework (per-niche graded tables + `pipeline/rating.mjs`, 0.32.0), which replaced the Tier
  A/B rendering. C1/C2's plumbing (publish → screen.json → app tab, staleness banner,
  deep-links) lives on inside that version. C3 (in-app re-scan) still deferred.
- **Chunk D (algorithm feedback)** — GATED on chunk A, unchanged.

## The three problems (Ben, 2026-07-03)

1. **Everything depends on trading at the PC.** Mobile trades fall outside the RuneLite
   exchange log → tracking gaps + manual-entry overhead. Want: one source of truth that
   doesn't care where the trade happened.
2. **The app is weaker than a Claude session.** The agent workflow (screen.mjs scan →
   surface candidates → watch open offers → suggest moves) has no in-app peer. Want the app
   closer to parity — "Finder v2" powered by the same screen logic (Finder v1 stays).
3. **A future goldmine of untapped data.** "An offer at the Xth band percentile on an item
   with profile Z took Y minutes to clear and made/lost N gp" — that dataset should
   eventually tune the buy/sell algorithm. Want: capture *now* in a shape that enables that
   analysis *later*.

## Decisions taken (Ben answered these 2026-07-03 — do not re-litigate)

- **Mobile client = official OSRS mobile.** No plugins, no exchange log → mobile fills can
  never be auto-captured. The mobile goal is *frictionless manual capture into the same
  pipeline*, not auto-logging. (RuneLite-Android investigation: dropped.)
- **Shared-write architecture = GitHub-as-backend.** The app (any device) writes via the
  GitHub contents API with a fine-grained PAT. No new infra, no cloud backend (declined),
  no PC-as-server/Tailscale (declined). Writes are commits; versioning for free.
- **The live offer-watch loop stays agent-run** (`watch.mjs` + the `MONITORING.md` /loop
  routine). An app-native poller is explicitly out of scope for this plan.
- **Priority: data capture first** — the dataset compounds with calendar time, so its
  capture gaps are the most expensive thing to leave open. Order: A → B → C; D is gated.

## Findings that shape the plan (verified against the code 2026-07-03 — don't rebuild)

- **`fills.json` already captures the full offer lifecycle.** Events are
  `placed | partial | cancelled | complete` per slot with `ts, price, qty, filled, spent` —
  including cancel-replace repricing chains (place → cancel → re-place lower is visible as
  discrete events on the same slot). So time-to-first-fill, time-to-complete, fill fraction
  at cancel, and reprice behavior are **already being recorded**. Problem 3 is mostly a
  *join* problem, not a capture problem. Two real capture gaps exist (chunk A): the
  tool's *suggestion* at the time, and the item-class label as computed then.
- **Market context at placement is retroactively computable.** The wiki `/5m?timestamp=`
  endpoint serves historical windows (it's how `loadBands()` backfills). Band percentile at
  any past placement can be reconstructed on demand — no need to have been archiving.
  Chunk A verifies retention depth and adds cheap local insurance.
- **`sync-fills.mjs` is single-writer by design and will break under a second committer.**
  It never `git pull`s, and `--auto` amends a rolling commit + `push --force-with-lease`.
  The moment the phone commits to main, the PC's next auto-sync force-push fails on the
  lease (good — no clobber) and the sync errors out. Chunk B1 makes the scheduler
  multi-writer-safe *before* any mobile write path ships.
- **The manual-line vocabulary already exists** (`coffer-manual.log`, PLAN.md chunk 1:
  fills, `REMOVE` tombstones, `WITHDRAWN`, `BANKED`, explicit trade-time). Mobile capture
  reuses this vocabulary in a new tracked source log — no new semantics.

---

## Chunk A — The outcomes dataset (capture gaps + join + first honest read)

Goal: from here on, every offer's full story is recoverable — what the market looked like,
what the tool said, what Ben did, how long it took, what it made. Plus the script that
assembles that story into an analysis-ready table.

**A1 — Suggestions ledger (the real capture gap).** `quote.mjs`, `screen.mjs`, and
`watch.mjs` append every recommendation they emit to a repo-root `suggestions.jsonl`
(append-only, one JSON object per line):
`{ts, script, mode/params, itemId, quickBuy, optBuy, quickSell, optSell, mom, regime, class, verdict}`.
- Log at *emit* time, unconditionally (a flag to suppress is over-design; lines are tiny).
- `class` = watch.mjs's item-type classification *as computed then* — the logic will evolve,
  so snapshot the label; recomputing it later silently rewrites history.
- The Task Scheduler auto-sync commit set grows to include `suggestions.jsonl` (same
  add-only-these-files discipline). No PII risk: item ids, prices, timestamps only.
- Rationale: realized-vs-suggested calibration (a CLAUDE.md long-standing followup) is
  impossible without knowing what was suggested; nothing records that today.

**A2 — Market-context retention: verify + insure.**
- Spot-check `/5m?timestamp=` at ~1 week, ~6 months, ~2+ years back. If deep history is
  served (expected), document in `FILLS-PIPELINE.md` that outcome analysis *relies* on it.
- Regardless, raise the `.cache/bands/` prune horizon from 7 days to ~90 (local, gitignored,
  disk-cheap) as bridge insurance against API retention changes. Do NOT commit band data —
  whole-market windows are far too big for the repo.

**A3 — `pipeline/outcomes.mjs` — the join.** Reads `fills.json` (+ `suggestions.jsonl`),
emits `outcomes` rows (stdout table + `--json` file output; **derived + rebuildable →
gitignored**, never committed — same principle as positions being derived from fills).
- **Campaign grouping:** a campaign = one *intent* to trade. Group same-slot, same-item,
  same-side event chains `placed → … → terminal`; stitch cancel-replace successions
  (terminal `cancelled` followed within a small gap by a new `placed`, same slot+item+side)
  into one campaign with a reprice list. The gap threshold is a tunable constant with a
  comment, not magic.
- **Per campaign:** placement ts + price; **band percentile at placement** (offer price's
  percentile within the trailing-2h 5m band, from historical `/5m` — same basis as
  `patientTargets`); spread + limiting-side volume context; time-to-first-fill;
  time-to-complete (or terminal state + filled fraction at cancel); reprice count + step
  sizes; realized net after tax where the campaign closes a FIFO lot (reuse
  `reconstruct.mjs` matching — do not re-implement FIFO).
- **Suggestion join:** nearest-*prior* suggestion for the same item within a bounded window
  (hours, tunable) → lets analysis ask "did following the tool work" and "did Ben beat the
  tool". Missing suggestion = null, not dropped — pre-A1 history stays usable.
- Manual fills (mobile or coffer-manual) appear as campaigns with no intra-offer lifecycle —
  keep them (flagged `manual: true`), they still carry realized P/L.

**A4 — First read: schema validation, not conclusions.** A small report mode
(`outcomes.mjs --report`): fill-time distributions by percentile bucket × liquidity class,
**printing n per cell and explicitly refusing to summarize cells below a minimum n**
(process rule 4 — never oversell small samples). The deliverable is confidence that the
captured shape supports the eventual analysis, plus a documented list of what n we need
before chunk D is allowed to touch the algorithm.

---

## Chunk B — Mobile writes: GitHub-as-backend

Goal: a trade made on the phone lands in the same pipeline as a PC trade, with seconds of
entry friction, and the fix-at-the-source rule intact (phone writes a *source log line*,
never `fills.json`/`positions.json`).

**B1 — Multi-writer-safe scheduler (ships FIRST — it's the load-bearing prerequisite).**
`sync-fills.mjs` gains: `git fetch` + fast-forward/rebase onto `origin/main` *before*
reconstructing (so a phone-pushed `mobile-fills.log` is actually read) and before
committing. Amend-the-rolling-commit only remains legal when HEAD is the auto-sync commit
**and** matches the remote head; if the remote moved, rebase and start a fresh commit chain
instead of force-pushing over it. A failed rebase (edit collision) aborts loudly rather than
resolving anything automatically — `fills.json` is append-only merged output, and the phone
never touches the files the PC commits, so collisions should be structural bugs, not routine.

**B2 — `mobile-fills.log`: a new tracked source log at repo root.** Same line vocabulary as
`coffer-manual.log` (fills, `REMOVE`, `WITHDRAWN`, `BANKED`, explicit trade time — chunk 1
semantics unchanged). `sync-fills.mjs` reads it as an additional source alongside the
`.runelite` logs. Append-only; the PC never writes it (keeps B1's no-collision property).
Distinct slot-number convention from manual slot 8 so provenance stays visible in events.

**B3 — App write path + phone-first quick-add UI.**
- Settings pane stores a **fine-grained PAT** (contents read/write, this repo only) in
  `localStorage`. Documented tradeoff: token on Ben's own devices, single-repo scope,
  revocable — acceptable for a personal tool; never rendered back to the page after entry.
- Quick-add form (thumb-sized, mobile-first): item search from the mapping cache, buy/sell,
  price, qty, **timestamp defaulting to now but editable** — backdated entries MUST carry
  true trade time (the phantom-5-bludgeons rule). Entering at trade time on the phone makes
  "now" usually correct, which is exactly why mobile capture beats after-the-fact PC entry.
- Write = GitHub contents API append (GET current sha → PUT with appended line; on 409
  conflict, re-GET and retry). Also expose REMOVE/WITHDRAWN actions from fill rows so
  corrections don't have to wait for the PC.
- App-side dedupe guard: warn if an identical item+price+qty line exists within a recent
  window (double-tap protection).

**B4 — Freshness UX + pending overlay.** `positions.json` regenerates only when the PC
syncs (~20 min cadence, PC must be on). So: (1) show `generatedAt` age as a staleness banner
on Ledger/Coffer; (2) mobile-entered lines render immediately as *pending* rows from the
app's own write history (same pattern as `STATE.fillsPending`), reconciled/absorbed when the
next `positions.json` arrives; (3) fold in the long-standing **Refresh-positions button**
followup (same-origin re-fetch of `positions.json` on demand) — it lives naturally here.

**B5 — Stretch: PC-free reconstruction via GitHub Actions.** `reconstruct.mjs` is pure and
the chunk-8 unification means positions can be rebuilt from `fills.json` + source logs
without RuneLite access. An Action triggered by pushes touching `mobile-fills.log` could
merge + rebuild + commit `positions.json` in-cloud → mobile-only trading days get correct
positions without the PC ever waking. Design constraints if built: the Action must respect
the single-writer file ownership (it becomes a *third* committer — B1's fetch-rebase logic
must hold for it too), and it must never read/require the `.runelite` logs. Build only if
the PC-off staleness actually bites in practice.

---

## Chunk C — Finder v2: the screen.mjs scan, in the app

Goal: opening the app anywhere shows the same opportunity scan a Claude session would
produce — same gates, same numbers (`js/quotecore.js` guarantees byte-parity), standard
9-column table + `Exp gp/d`. Finder v1 (the rating/quality blend) stays as-is; v2 is a
sibling view, not a replacement.

**C1 — Published scan: `screen.json`.** `screen.mjs` gains `--publish`: write a repo-root
`screen.json` — `{generatedAt, mode, params, tiers: {A: [...], B: [...]}}` with the full
9-col row payload + `Exp gp/d`. The Task Scheduler sync (or any agent session running a
screen) commits it alongside fills/positions. Default published mode: `band` (the
crystal-seed niche — highest realistic gp/day), params recorded in the file so the app can
display *what* scan it's looking at.

**C2 — Finder v2 panel.** New app view rendering `screen.json`: tier A / tier B grouping,
the standard table via `quotecore`'s row shape, staleness banner (`generatedAt` age — an
hours-old scan is context, not a live quote, and the UI must say so), falling items excluded
(they were never written), each row deep-linking to the item's Trends view. No client-side
re-scoring — render what the scan said, byte-identical.

**C3 — Stretch: on-demand in-app re-scan (band mode).** The browser *can* rebuild the band
scan live: ~24 `/5m` window fetches + `/latest` + `/24h` (CORS-open wiki API), then the same
quotecore gate stack. Feasible even on the phone (compute is trivial; it's ~26 requests).
Build only if published-scan staleness proves annoying in practice — measure first, C1/C2
may be plenty. If built, cache windows in IndexedDB and respect the wiki API's courtesy
rate expectations.

---

## Chunk D — Algorithm feedback loop (GATED — design sketch, not build order)

The payoff of chunk A, explicitly gated on sample size (A4 defines the thresholds; process
rule 4 governs). Do not start this chunk until the outcomes dataset clears them.

- **Fill-probability / fill-time curves** by band-percentile × item class → replace
  `patientTargets`' fixed 20th/80th percentiles with class-conditional choices ("on
  high-churn commodities the 85th fills in under an hour; on niche band items wait for the
  92nd") — the "squeeze out as much value" lever Ben described.
- **Honest `Exp gp/d`:** screen.mjs's expected-gp/day ranking currently embeds assumptions
  about cycle time; observed time-to-fill replaces assumption with measurement.
- **Realized-vs-suggested calibration report:** did following the tool's price beat the
  quick price, by how much, where does it misfire (the A1/A3 suggestion join makes this a
  query, not a project).
- **Known confound to design around:** regime mix — fill times measured in a rising week
  don't transfer to a falling one. Bucket or tag outcomes by regime label (already joined in
  A3) before believing any curve.

---

## Out of scope (decided 2026-07-03)

- App-native offer polling loop — the agent-run `watch.mjs` routine stays the answer.
- RuneLite-Android / any mobile auto-capture — wrong client.
- Cloud backend (Workers/D1) and PC-as-server (Tailscale) — GitHub-as-backend chosen.
- Bank-visibility tooling — still deferred (PLAN.md chunk 5 rationale stands).

## Discovered

**Open:** _(none yet)_
