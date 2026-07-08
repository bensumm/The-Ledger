# The Coffer / The-Ledger — instructions for Claude Code

This repo is the primary, ongoing place where this tool gets built and iterated on.
Expect repeated sessions here, not one-offs — check git log and this file for
context before assuming something is new.

**Live app: https://bensumm.github.io/The-Ledger/** (bookmarkable; auto-deploys on
push to `main`).

## What this is
- **The Coffer**: OSRS Grand Exchange flipping tool. `index.html` is markup only;
  `styles.css` holds all styles; logic is split into ES modules under `js/`
  (`state.js` = shared mutable state as one exported `STATE` object + constants +
  persistence + diagnostics; `format.js` = formatting/tax helpers; `charts.js` =
  inline SVG rendering; `marketfetch.js` = shared browser fetch layer (one timeout-guarded
  `jget` + one cached `fetchTs`/`fetch24h` store, A2); `market.js` = price/guide fetch +
  scoring; `trends.js` = archive + seasonal analysis (renders the Trends view; its pure analytics
  moved to `trendcore.js`); `trendcore.js` = pure DOM-free Trends analytics (hourly/seasonal
  decomposition, the walk-forward `backtestPlan` gate, `patientTargets` offer sizing — moved out of
  `trends.js` by TC1 so they're node-importable + fixture-tested); `table.js` = reusable sortable-table
  helper (TB1 — click-to-sort/arrow/persisted per-table sort; Finder + Watchlist adopt it);
  `ui.js` =
  Finder/Watchlist/Signals/Coffer/Scan rendering + `renderAll` coordinator; `ledger.js` =
  Ledger view + fills-write cluster (manual-entry writes, positions.json auto-populate,
  Ledger render/controls, freshness/GitHub-sync panels — split out of `ui.js` by A3);
  `ledgercore.js` = pure day-boundary bucketing + per-item grouping (`periodKey`/`groupTrades`,
  moved out of `ledger.js` by TD2 so they're node-importable + fixture-tested);
  `watch.js` = the Watch tab (0.49.0 — verdict-first flipping desk: held cards, active offers,
  today's fills; verdicts from the shared `momVerdict`/`offerVerdict`; per-item session notes under
  `watchnote:<id>`); `watchcore.js` = pure Watch-tab derivations (verdict→stripe family, alert count,
  flip/incidental split, today's-fills feed, summary aggregates — node-importable, fixture-tested);
  `backup.js` = export/import; `main.js` = entry point, event wiring + init). No build step, no framework, no bundler — deployed to GitHub Pages at
  bensumm.github.io/The-Ledger/ exactly as these files sit on disk. See `README.md`
  for the full file inventory and deploy mechanics.
- Split out of one 1375-line `index.html` file in 2026-07 once development moved
  from mobile-only Claude sessions to Claude Code on a PC — the single-file
  constraint was about zero-build Pages deploys, not mobile editing, so the split
  keeps zero-build while making the code far more reviewable/diffable. Local testing
  needs `serve.cmd` now (ES modules don't load over `file://`); see README. `serve.cmd` is also
  the **live desk experience** (LW2): on localhost the app polls `positions.json`/`offers.json`/
  `heartbeat.json` and, paired with the `watch-log.mjs` daemon, reflects fills/offers within ~40s
  with zero git; the daemon's 30s `heartbeat.json` (LW3) drives a "watcher live" liveness stamp
  that stays fresh even when the book is frozen during a quiet no-fill stretch.
- **Fill-data pipeline**: closes the loop between the tool's trade suggestions and
  real GE trades, captured client-side via RuneLite's Exchange Logger plugin. Lives
  in `pipeline/` (kept separate from the deployed app root): full design doc
  `pipeline/FILLS-PIPELINE.md`, sync script `pipeline/sync-fills.mjs` (runs on Ben's
  Windows machine **on demand** — session-start or a manual push; the ~20-min
  `CofferFillsSync` Task Scheduler job was eliminated 2026-07-04, see FILLS-PIPELINE.md
  §12 — reads `.runelite/exchange-logger/*`, writes/commits/pushes `fills.json` **and**
  `positions.json` at the repo root (plus `offers.json`, LW1 — a flat live-GE-offer snapshot the
  localhost app fetches same-origin) — these stay at root because the app fetches the derived
  `positions.json`/`offers.json` same-origin and `fills.json` is the ROOT-LOCKED source it reconstructs from;
  see README.md "Map of the repo" for the full app-fetched/ROOT-LOCKED vs pipeline-only artifact
  split and the `js/quotecore.js` + `js/format.js` shared-module ripple map). `positions.json` is the derived view (`collapseOffers` +
  FIFO `matchTrades`): `closed` trades w/ after-tax realised P/L, `open` inventory at
  real avg cost, and `unmatched` sells (pre-log inventory, no fabricated profit). The
  app auto-populates its Ledger/Coffer from it. Read `pipeline/FILLS-PIPELINE.md` §5.1
  before touching the reconstruction. Read the whole doc top to bottom before touching
  either script path.

## Trends tab structure
The per-item Trends view's decision-priority tier structure (plan card → "Why this trend?"
→ price history → timing/seasonality, and the regime-guard/backtest-gate lesson) is a
**header comment at the top of `js/trends.js`** — read it before editing `runTrends`, since
that's where every editor of the view already is. (Moved out of CLAUDE.md by chunk K3.)

## Done (recent, for context — don't rebuild)
Deep per-version writeups (the "why", superseded approaches) live in `CHANGELOG.md`. Below
is the one load-bearing "do not rebuild this" line per entry; open `CHANGELOG.md` for the
full story.
- **`suggestions.jsonl` rotation/compaction** (SR1, pipeline-only — NO APP_VERSION) — the O1 ledger
  grew unbounded in the DEPLOY ROOT (~3k rows/day). `pipeline/lib/suggestlog.mjs` now bounds the
  active root file to the CURRENT calendar month: on every append `logSuggestions` calls
  `rotateLedger()` (cheap first-line-month guard) which rolls each COMPLETED month out to
  `pipeline/suggestions-archive/suggestions-YYYY-MM.jsonl`. **Don't-rebuild / the load-bearing rules:**
  (1) rows are F1's calibration data — ARCHIVE, never delete; rotation writes each archive fully
  (dedup, tmp+rename) BEFORE truncating the active file, so it's crash-safe + idempotent + zero-row-loss;
  (2) any FULL-HISTORY reader (`outcomes.mjs`'s F1 join) MUST read active + archives via the shared
  `readSuggestionLines` — reading the active file alone silently halves the calibration set after the
  first rotation; (3) the active-ledger path stays REPO-ROOT, pinned by `pipeline/lib/suggestlog.test.mjs`
  (SL1) — only history relocates; don't re-relativize `LEDGER`. `sync-fills.mjs` commits the archive dir
  alongside `suggestions.jsonl`. Note: as of landing, 100% of rows are the current month, so the first
  rotation is a no-op — the first real archive fires at the next month boundary. Fixtures:
  `pipeline/lib/suggestlog.test.mjs`. Full story: `FILLS-PIPELINE.md` §11.1.
- **Thesis-gated hold alerts — silence expected-underwater** (TG1, 2026-07-07, pipeline-only — NO
  APP_VERSION) — a patient/accumulation hold is DEFINITIONALLY underwater on the instant-clear from
  the moment its bid fills, so the `UNDERWATER`/`CUT-CANDIDATE` headline cried wolf every pass (Ben:
  "tired of being told I'm underwater when that's the plan"). The fix lives in the ALERT gate, NOT
  the verdict core. **Don't-rebuild / the load-bearing rules:** (1) `momVerdict()` (`js/quotecore.js`)
  is UNTOUCHED — the verdict still SAYS underwater (honest); only the *headline* is gated. (2) The
  thesis branch lives in `convictionGate()` (`pipeline/lib/watchstate.mjs`) — a declared thesis with
  a numeric tripwire, live ABOVE the tripwire → ARMED note (`per thesis: silent above X…`), no
  headline; live at/below the tripwire → falls through to the normal V4/V7 escalation (real risk
  headlines). (3) The **Gate-2 breakdown `CUT` stays EXEMPT** — checked BEFORE the thesis branch, a
  real breakdown is NEVER silenced (`LIST-TO-CLEAR` is also excluded from the silence). (4) The store
  is AGENT-WRITTEN like the greenlist — TRACKED root `hold-thesis.json` (`{id,exitPrice,tripwire,
  horizon,ts}`, 14-day TTL), read via `pipeline/lib/holdthesis.mjs`, watch READ-ONLY; when Ben
  declares a hold plan the agent appends/upserts an entry (`upsertThesis`). No thesis / empty store →
  byte-identical to today (opt-in, safe-degrade). Fixtures: `pipeline/lib/holdthesis.test.mjs` +
  the TG1 block in `pipeline/watchstate.test.mjs`. Full story: `MONITORING.md` "What each tick
  surfaces" item 1 (the THESIS-silence bullet) + the `holdthesis.mjs` header.
- **Probe firing logs — the hit/miss ledger wired** (PM2, 2026-07-07, pipeline-only — NO APP_VERSION) —
  PM1 defined the per-probe `pipeline/modules/<name>.log` firing-log convention but left it UNWIRED; PM2
  wires the writes so the validate-before-promote data accrues. `logFirings(fired, meta)`
  (`pipeline/lib/modules.mjs`) appends ONE compact JSONL line per fired annotation —
  `{ts,module,version,stage,surface,id,name,tag,price(price-stage only),quickBuy,quickSell,guide,regimeLabel,phase}`
  — enough to SCORE the firing later without re-fetching; `version` is the probe's DECLARED version (looked
  up from the loaded set). Called EXPLICITLY by `screen.mjs` renderMode + `quote.mjs` runItems right after
  their `runProbes` calls. **Don't-rebuild / the load-bearing rules:** (1) `runProbes` stays PURE — logging
  is a separate explicit call, never folded into the runner; (2) **failure-safe** — every write is
  try/caught + swallowed, a broken log can NEVER break a render (same discipline as runProbes' throw-
  swallowing); (3) **byte-identical stdout** — logging adds NO output change (proven: a live `quote.mjs`
  diff before-vs-after is identical; the Probes column is untouched); (4) no firing ⇒ no write ⇒ no file.
  SCORING (hit/miss) is deliberately a LATER chunk — PM2 only accrues. Fixtures: the FIRING LOG block in
  `pipeline/modules.test.mjs`. Full story: the `pipeline/lib/modules.mjs` header (FIRING LOG) + README's
  probe-modules inventory entry.
- **Probe-module system — theory-testing plug-ins** (PM1, 2026-07-07, pipeline-only — NO APP_VERSION)
  — a pluggable way to trial a per-item market THEORY, see it in a dedicated stdout `Probes` column, and
  DELETE it in one `rm`. `pipeline/lib/modules.mjs` is the LOADER + stage-keyed runner: it auto-discovers
  `pipeline/modules/*.mjs` (presence = enabled), groups probes BY STAGE (`observe` → `{tag,note}`; `price`
  → `{price,reason}`; `gate` future), and `runProbes(row,surface,ctx)` returns the fired annotations.
  screen.mjs + quote.mjs append a `Probes` column ONLY when a probe fires. **Don't-rebuild / the
  load-bearing invariants:** (1) the **empty-passthrough guarantee** — no module present OR none fire ⇒
  `[]` ⇒ nothing appends ⇒ **byte-identical** output (proven: with-vs-without the modules dir differ ONLY
  by the appended column) — that IS the removability contract, never break it; (2) **NO probe of any
  stage feeds a verdict/gate/rating/reconstruction** — observe probes touch NO number, price probes touch
  ONLY the advisory recommendation; (3) the `Probes` column is **stdout-only**, deliberately NOT in the
  published `screen.json`/app (an app Probes column bumps APP_VERSION — a separate later step). Four seed
  probes: **dip** (the migrated ex-`screen.mjs` `⬇DIP` prototype — same gates), **froth** (spike/rising
  knife-vs-healthy classifier off `phase().lowSlope`), **anchor** (the `price`-stage round-number nudge,
  proving both output shapes), **decant** (MULTI-ITEM — reads dose siblings off the whole-market 24h map
  `ctx.v24all` and declares them via `needs(row,ctx)`; screen-only). Watch surface + owned dip-inversion
  (average-down) are the deliberate follow-on. A firing is DATA to score, never a validated edge (rule 4).
  Fixtures: `pipeline/modules.test.mjs`. Full story: the `pipeline/lib/modules.mjs` header + README's
  probe-modules inventory entry.
- **MERCH-book quarantine — `ignored-items.json` + greenlist** (2026-07-07, pipeline-only — NO
  APP_VERSION) — items Ben transacts but doesn't flip (farming inputs snapdragon seed 5300 /
  snapdragon 3000, loot, personal-use) are quarantined from the DERIVED merch views. **Don't-rebuild
  / the load-bearing rule:** `pipeline/lib/ignored.mjs` `quarantineEvents` filters the `reconstruct()`
  INPUT only — `fills.json` stays the FULL merged audit (never delete an ignored item's events; it's
  a VIEW filter). Intent isn't in the log, so an ignored item is quarantined BY DEFAULT and a
  specific transaction is surfaced as a real flip ONLY via a `greenlisted` entry matched on
  id+price(±3%)+ts(±6h). **The greenlist is agent-written:** when you recommend a flip of an
  ignored item and Ben confirms qty+price, APPEND `{id,qty,price,ts,consumed:false}` to
  `ignored-items.json`'s `greenlisted` array (Ben only flips these on a rec, so that gate catches
  every legit flip). Wired in `sync-fills.mjs` (positions/offers) + `lib/offers.mjs activeOffers`
  (watch); real-log validated snapdragon 6→0 entries with realised P/L byte-identical. Fixtures:
  `pipeline/ignored.test.mjs`. Full story: the `pipeline/lib/ignored.mjs` header + README's
  `ignored-items.json` inventory entry.
- **Yield-improvement program** (FC1/YF1/YS1/YS2/YV1/YT1/YP2/YP1/YA1, 2026-07-06 — `PLAN-YIELD.md`
  folded into `PLAN.md` + deleted; shas in the Status table's YIELD block) — the measurement spine +
  its read layers. **Don't-rebuild:** `outcomes.mjs` is the schema-v2 data spine (EXTENDED, never
  rebuilt) — `stateAtFill` (band-pctl+regime+phase AS OF every fill via the shared `lib/histstate.mjs`
  `loadHistState`, itself feeding the SHIPPED `regimeDrift`/`phase` — no market math re-implemented),
  measured `holdTimeSec`/`parkedSec`/`velocityClass`, and `predicted` (copied from the join, null on
  pre-YS2 rows). #3 velocity/capital-util (`lib/capitalutil.mjs`/`velocity.mjs`), #4 session-thesis
  (`lib/sessionthesis.mjs` + `thesis.mjs` CLI, watch read-only), #2 state-transition scan
  (`lib/statetransition.mjs`) + guide re-anchor (`lib/guideanchor.mjs`), #5 the one in-app
  Utilization cell (`js/watchcore.js` `capitalSplit`). **The honesty invariants are load-bearing:**
  F1 stays GATED (descriptive ≠ calibrated); YP1 ships SILENT below its update-count gate; every new
  surface is OUTPUT-ONLY, never a verdict/alert input; FC1 is OFF by default so decision paths stay
  byte-identical. Fill-probability + the Trends recommend-price button were DEFERRED (F1-gated), not
  dropped. Full story: `CHANGELOG.md` (YA1 0.53.0 entry) + `PLAN.md` YIELD Status block.
- **watch.mjs per-held EMIT CONTRACT** (V5, pipeline+docs only — NO APP_VERSION) — the pure
  `heldNoteBlock()` in `pipeline/lib/emit.mjs` (fixture-pinned `pipeline/emit.test.mjs`) makes each
  held lot's note block ONE stable, consistently-ordered shape: `verdict · conviction-state (V4
  armed) · Δ-since-last (V1) · structural tripwire (V2) · sell/list-at (+ break-even) · fill-progress`.
  **Don't-rebuild / the load-bearing rule:** the **sell/list-at + break-even line is ALWAYS emitted on
  a held lot** (`sell: list @ X · break-even Y · ask n/m`), guaranteed even if the optional context
  fields fail to compute — Ben's standing rule (2026-07-06): always state the sell price for every
  held item, since a fill you didn't see may have happened. `heldListAt` prefers the shared
  momVerdict `listAt`, else the band-top-floored-at-BE fallback — never re-fork that. OUTPUT-FORMAT-
  ONLY (no verdict/alert/row-selection change). Full state: PLAN.md V5 row, `MONITORING.md`
  "What each tick surfaces" (the emit-contract block).
- **Cadence-independent alert gating — TIME-based arm-then-confirm** (V7, pipeline-only — NO
  APP_VERSION) — `convictionGate()` (`pipeline/lib/watchstate.mjs`) now escalates on **elapsed
  WALL-CLOCK time a condition has persisted** (`ALERT_PERSIST_MS`, 4-min placeholder), NOT a pass
  count. **Why:** a pass-count threshold made a faster /loop manufacture faster alerts — at 1-min
  cadence "2 consecutive passes" was 2 min of noise; a choppy market checked every minute produced
  flicker headlines. Time-gating makes sensitivity independent of cadence. **New:** `LIST-TO-CLEAR`
  (a 2h-momentum breakdown, previously UNGATED — it headlined every ↓ pass) is now arm-then-confirmed
  too: a single-pass flicker only ARMS; it headlines only once the breakdown HOLDS ≥ `ALERT_PERSIST_MS`.
  Persistence is measured from `underwaterSince`/`belowSupportSince`/`breakdownSince` timestamps in
  the watch-state. **Don't-rebuild / invariant preserved:** the **Gate-2 breakdown `CUT` stays EXEMPT
  — immediate, never time-gated** (pinned by an "immediate regardless of elapsed time" fixture); note
  `LIST-TO-CLEAR` also carries `gate:2` but its verdict is `LIST-TO-CLEAR` not `CUT`, so it is gated,
  not exempt. `watchstate.test.mjs` pins the time-based gate + a cadence-independence fixture. Full
  state: `pipeline/MONITORING.md` "What each tick surfaces" item 1.
- **Conviction gating — arm-then-confirm alerts** (V4, pipeline-only — NO APP_VERSION; the pass-count
  thresholds below were SUPERSEDED by V7's time-based gating above — read that first) — the pure
  `convictionGate()` in `pipeline/lib/watchstate.mjs` gates whether a held verdict escalates to a
  headline ⚠ ALERT in `watch.mjs` (verdict strings UNCHANGED; `js/quotecore.js` untouched). A Gate-D
  `CUT-CANDIDATE` needs the underwater condition to persist (V7: ≥ `ALERT_PERSIST_MS`; was 2 passes)
  to alert; a structural break needs the V2 tripwire convincingly broken (`< cut-trigger`) OR below
  support persisted (V7: ≥ `ALERT_PERSIST_MS`; was 2 passes). First observation → ARMED (a visible
  note, not a headline). **Don't-rebuild / invariant:** the **Gate-2 breakdown `CUT` is EXEMPT — it
  alerts immediately, byte-identically** (pinned by an "immediate regardless of conviction" fixture);
  never gate it. Full state: `pipeline/MONITORING.md` "What each tick surfaces" item 1.
- **Verdict self-sufficiency — recovery-read forecast + capital companion** (V6, pipeline-only — NO
  APP_VERSION; the last chunk of the V1–V6 verdict-layer series, `PLAN-VERDICT.md` folded into
  `PLAN.md` + deleted) — two ADVISORY, OUTPUT-ONLY surfaces in `watch.mjs`, neither a verdict/alert
  input (`momVerdict`/`offerVerdict`/`convictionGate` untouched — the breakdown-cut invariant holds
  trivially). (1) The pure `pipeline/lib/recovery.mjs` COMPOSES momVerdict's existing signals
  (`diurnalRead` seasonal · `regimeLabel`/`phase` trend · `underwaterHours` persistence · position vs
  the V2 support) into a recover-vs-drop LEAN (`likely-recovers`/`likely-drops`/`uncertain` + drivers),
  surfaced as `recovery-read: …` ONLY on a non-clean position (underwater / thin-margin / unfilled ask
  / `BID-BEHIND` bid / lean-conflicts-verdict) and silent on a cleanly-good one. **Don't-rebuild /
  honesty:** it's a LEAN not a probability (structural shape, not a low-sample per-hour number), and
  `phase==='spike'` CAPS it to `uncertain` (blind to a repricing) — never wire it into a verdict/alert.
  (2) The pure `pipeline/lib/capital.mjs` detects capital freed by a booked SELL between passes (a held
  lot's qty dropped, off V1's prior-pass state) and, ≥ `FREED_CAPITAL_SCAN_GP` (5m placeholder),
  surfaces a `⋯ freed ~X — consider a scan to redeploy` prompt — surface-only, never auto-places/runs
  the scan; a fresh/stale-gap prior yields no misfire. Fixtures: `pipeline/recovery.test.mjs` +
  `pipeline/capital.test.mjs` (22 suites). Full story: `CHANGELOG.md` / PLAN.md V-series row.
- **Suggestlog path regression fix** (SL1, pipeline-only — NO APP_VERSION) — the O1 ledger path in
  `pipeline/lib/suggestlog.mjs` is now exported `LEDGER`, resolving TWO levels up to repo-root
  `suggestions.jsonl` (OR2's move into `lib/` had silently forked it to untracked
  `pipeline/suggestions.jsonl`; 351 stranded rows folded back). The resolved path is pinned by
  `pipeline/lib/suggestlog.test.mjs` — don't re-relativize it. Lesson: prove a file is dead by
  what WRITES it, not what reads it. Full story: `CHANGELOG.md`.
- **Exchange-log hardening — impossible-transition validation + restart-blindness warning** (LH1/LH2,
  pipeline+docs only — NO APP_VERSION) — (LH1) `validateSlotTransitions()` (`pipeline/lib/reconstruct.mjs`)
  runs at INGEST next to `buildEvents()`, BEFORE the `fills.json` merge: a GE slot is a state machine, so a
  same-slot second terminal that is strictly identical to the prior terminal with no placement line between is
  a snapshot re-emit (the 13:25:53/13:29:01 double-BOUGHT) — DROP it LOUDLY (`console.warn` + a sync-summary
  count) so it never enters `fills.json`. Conservative: manual slots 8/9 exempt, any differing field warns but
  is KEPT; warnings are gated to the attended sync (`warn:false` in the daemon/`--local`/`monitor` re-read
  callers). `dedupeSnapshots()` stays as the SILENT derivation backstop for already-persisted phantoms — don't
  merge the two. (LH2) a `⚠ log may be blind` header line in `monitor.mjs`/`watch.mjs` (`pipeline/lib/logblind.mjs`)
  when the log is stale + shows no offers + you hold inventory (the post-restart plugin-silent state) — display
  only, no verdict change. Real-log acceptance: 17 historical re-emits dropped (incl. the known 13:29), positions
  byte-identical to the committed `positions.json`. Do NOT resurrect the deleted cancel-to-EMPTY inference —
  EMPTY stays non-evidence. Full story: `FILLS-PIPELINE.md` §10, `CHANGELOG.md`.
- **Trends analytics extraction** (0.50.0, TC1 — pure MOVE, behavior byte-identical) — the pure
  DOM-free analytics (`analyseHourly`/`analyseBroad`, `seasonalFactors`/`hourFactors`/`factorStats`,
  `bestWindow`, `buildPlan`, `patientTargets`, `dayGroups`/`backtestPlan`, `planSignal`, `median`)
  moved out of DOM-pinned `js/trends.js` into new node-importable `js/trendcore.js` (mirrors TD2's
  ledgercore/watchcore) → `pipeline/trendcore.test.mjs` finally pins the walk-forward `backtestPlan`
  gate + `patientTargets` sizing + the seasonal decomposition. `trends.js` re-imports what it renders;
  its tier-structure doctrine header stays there. **Don't-rebuild:** it was a straight move — don't
  re-fork these back into trends.js.
- **screen.mjs gate-stack extraction** (GC1, pipeline-only — no APP_VERSION) — the pre-fetch
  candidate gate stack is now the exported, threshold-driven `gateCandidates(mode, ctx, thresholds)`
  (behind screen.mjs's invocation guard) → `pipeline/gatecandidates.test.mjs` pins two-sided liquidity,
  gp-flow thin admission, the 500k attention floor + thin exemption, the rising-pool noise floor, and
  the per-mode edge. Byte-identical stdout (main() passes the same CLI values via a `THRESHOLDS`
  object). **Note:** falling-EXCLUSION + rising-CONFIRM stay POST-fetch in `renderMode` (off the real
  quote row), NOT in gateCandidates — don't move them there.
- **Watch tab — the at-a-glance flipping desk** (0.49.0) — a verdict-first in-app surface
  (`js/watch.js` + pure node-importable `js/watchcore.js`, fixture-tested in
  `pipeline/watchcore.test.mjs`; the old Watchlist tab took id `watchlist`). **Don't-rebuild:**
  the console `watch.mjs` stays the zero-lag "act now" authority — the Watch tab is the standing
  desk picture off `positions.json`/`offers.json`, honestly stale-bannered. Verdicts are NOT
  reimplemented (held cards call shared `momVerdict()`, offers the shared `offerVerdict()`, both
  `js/quotecore.js`; `watch.mjs` routes through the same `offerVerdict` byte-identically). Per-item
  session notes persist under `watchnote:<id>` — **never log their contents** (L1). Full story:
  `CHANGELOG.md` 0.49.0.
- **Daemon liveness heartbeat — separate "watcher live" from "book synced"** (0.51.0, LW3) — the
  `watch-log.mjs` daemon now writes a gitignored root `heartbeat.json` (`{app,generatedAt}`) every
  30s (`HEARTBEAT_MS`, imports `REPO_DIR` from `sync-fills.mjs` for the root path, zero git/zero
  log-read); the localhost app polls it (`fetchHeartbeat`, `STATE.heartbeatTs`) and `renderLocalStamp`
  now shows TWO lines — **`watcher live hh:mm`** (the liveness signal, warns "watcher down?" past 90s)
  and **`book synced hh:mm · N offers`** (positions.generatedAt, no age warning). **Why:** the daemon
  only rewrites `positions.json` on a book change, so a quiet no-fill stretch froze the old
  positions-only stamp and raised a false "is the watcher running?" alarm — liveness now has its own
  independent signal. **Don't-rebuild:** the heartbeat is pure liveness (regenerates nothing) and
  gitignored — it is NOT a polling fallback and NOT an unattended writer to `main` (§12 preserved).
  Full story: `FILLS-PIPELINE.md` §14, `CHANGELOG.md`.
- **Local log-watcher — desk-side freshness, zero git in the daemon** (0.48.0, LW1/LW2) — a
  manual-start `pipeline/watch-log.mjs` daemon runs the git-free `regenerate()` core (also
  `sync-fills.mjs --local`), writing `fills.json`/`positions.json`/tracked `offers.json` locally on
  every fill; on localhost the app polls them for the freshness stamp (`js/ledger.js`; the "book
  synced" line — the LW3 heartbeat adds the "watcher live" liveness line above it).
  **Don't-rebuild:** the daemon does **ZERO git** — that's how it gives live desk freshness while
  preserving the §12 invariant (no unattended writer **to `main`**). Never give it a Task Scheduler
  job or a commit/push (that reverses §12 — Ben's call, not scope creep), and never fold un-pulled
  phone `mobile-fills.log` writes (attended sync's job). Full story: `FILLS-PIPELINE.md` §14,
  `CHANGELOG.md`.
- **Testability extractions + unlocked tests** (0.47.0, TD2 — pure MOVES/guard, behavior
  byte-identical) — three modules made node-importable so their real rules get committed fixtures:
  (1) `periodKey`/`groupTrades` → new pure `js/ledgercore.js` (`ledger.js` re-imports) →
  `pipeline/ledgercore.test.mjs` finally pins E1's local-time day-boundary bucketing (23:55 stays on
  its LOCAL day, week splits at the local Monday); (2) the sort comparator factored out of
  `makeSortable` into exported pure `compareRows(column, dir)` in `js/table.js` →
  `pipeline/table.test.mjs` (null→-Infinity sink, str-vs-num, the risk-grade `invert` quirk, dir flip);
  (3) `pipeline/alerts.mjs` gained the standard `import.meta.url===pathToFileURL(argv[1])` invocation
  guard (it used to FETCH on import) + exports `positionSignal`/`quietSuppresses` → `pipeline/alerts.test.mjs`
  (transition-only sig; quiet hours suppress position/price, fills exempt). Auto-discovered by TD1.0's
  runner (no CI edits) — 7 suites at the time (16 as of TC1/GC1).
- **Glob test runner + must-have money tests** (TD1, pipeline-only — no APP_VERSION) —
  `pipeline/run-tests.mjs` auto-discovers every `pipeline/**/*.test.mjs` (recursive, so colocated
  `lib/` tests are found), runs each in its own child process, and exits non-zero on ANY suite
  failure OR zero discovery. **Adding a test file is the whole job** — `checks.yml` and `/ship`
  call the runner once; never wire a new test into CI by hand again. New money-primitive coverage:
  `pipeline/format.test.mjs` (tax exemption/floor/5m-cap, netMargin null-guard, parseGp) and
  `pipeline/lib/rating.test.mjs` (thin A- cap, capGrade clamps-down-only, gradeFor monotonic,
  riskMult = Π(factors), momFactor breakdown<breakup); `reconstruct.test.mjs` gained a big-ticket
  5m-cap-per-unit close + a partial-fill `collapseOffers` fold. Test house style: banner of
  BUSINESS REQUIREMENTS an agent can diff against, `node:assert/strict`, synthetic fixtures only.
- **Finder full-catalog search + Signals badge count** (0.46.0, FX1) — a Finder **search query
  now reveals every mapped match**, not just the flip universe: `currentFinderRows` (`js/ui.js`)
  unions in off-screen catalog rows (shared `rawItem`, `js/market.js`) for ids `MIN_PRICE` keeps
  out of `STATE.ITEMS` (soul rune ~300gp). Those `offscreen` rows lack rating/score/fill/turn →
  the renderer prints `—` for the grade + score-bar cells (fmt/fmtP/fmtTurn already null to `—`);
  the quote button + star work (both key off id via `resolveId`). Don't "fix" this by dropping
  `MIN_PRICE` — it exists to keep browse-mode noise out; the reveal is search-only. The `#sigBadge`
  now shows **`firing/total`** (e.g. `0/6`; plain `0` when no rows) so a live-but-quiet Signals tab
  no longer misreads as empty.
- **Reusable sortable-table component** (0.44.0, TB1) — `js/table.js` `makeSortable({tableId,
  name, columns, defaultKey, onSort})` owns click-to-sort, the direction toggle, the sorted-column
  `.sorted`/`▲▼` arrow, the null-safe `?? -Infinity` numeric comparator, and the risk-grade
  inversion quirk (`invert:true` — lower riskIndex = a better grade). Per-table sort state persists
  under `sort:<name>` via `sSet` (the Finder's sort used to reset each reload). The Finder and
  Watchlist adopt it; the old Finder-only `STATE.sortKey`/`sortDir` pair + hand-rolled comparator
  + per-render arrow code are **deleted** — don't reintroduce a bespoke per-table comparator, extend
  the shared helper. `defaultKey` omitted ⇒ the table starts unsorted (Watchlist keeps insertion
  order until a header is clicked). Non-sortable headers (`th` without `data-k`) no longer show the
  click cursor (`styles.css`). Scan tables stay server-rendered snapshots (not adopted).
- **Break-even respects the 5m tax cap** (0.40.0, BE1) — shared `breakEven()` in `js/quotecore.js`
  is now piecewise-consistent with `format.js` `tax()`: the smallest sell `s` with `s − tax(s) ≥ buy`
  (`buy` when `buy<50`; `buy + TAXCAP` once the 2% cap binds at `buy > 245m`; else the unchanged
  `ceil(buy/0.98)`). Below the cap it's a byte-identical no-op — only big tickets (the S1 gp-flow class)
  were overstated (a 1.633b bow demanded 1.666b, true BE 1.638b). The two private copies were routed
  through it (`trends.js` position card, `add-manual-fill.mjs` `--net` inverse); all pipeline callers
  already used the shared fn. Boundary/smallest-s proof + three-region fixtures in `quotecore.test.mjs`.
- **Push-notification trigger engine** (N1, pipeline+docs only — no APP_VERSION) — delivery-
  agnostic `pipeline/alerts.mjs` DETECTS + EMITS three transition-only classes (held-verdict
  escalation via shared `momVerdict`, offer fills via `offers.mjs`, named price crosses from
  tracked `alerts.json`) against a gitignored `.alerts-state.json`; quiet hours suppress
  position/price (fills exempt). Delivery mechanism decided after a live trial of a scheduled
  Claude session + harness `PushNotification` (option a). Full contract: `MONITORING.md`
  "Push notifications on market events".
- **Mobile parity — GitHub-as-backend writes** (0.39.0, M1) — the phone logs a GE trade by
  appending a **slot-9** source line to tracked repo-root `mobile-fills.log` via the GitHub
  contents API (`js/github.js`; fine-grained PAT in localStorage — never rendered/exported/logged,
  "PAT updated" only). The Ledger quick-add routes desktop→FS-log (slot 8) / mobile→GitHub (slot 9,
  GET sha → PUT append, 409 retry). `sync-fills.mjs` is now multi-writer: ff onto a moved
  `origin/main` (phone push) BEFORE reading logs, **fresh commit** on top, **loud abort on
  divergence** (disjoint single-writer contract — the phone writes ONLY `mobile-fills.log`, the PC
  ONLY fills/positions/screen/suggestions). Freshness = a `generatedAt` staleness banner + a
  **Refresh-positions** button (same-origin re-fetch — it can't regenerate `positions.json`). S3's
  watchlist write-back rides the same contents-API path. Full detail: `FILLS-PIPELINE.md` §13.
- **Action logging pass** (0.38.0, L1) — the `logEvent` ring gained an `'action'` scope for
  user actions (tab/watchlist/trade/refresh/trends-open/position-review/backup/settings),
  logged at the **event handler** (never inside shared `switchTab`/`loadAll`, so re-renders
  don't log); `LOG_MAX` 50→200; Logs view has an All/Actions/System scope filter
  (`STATE.logFilter`). Never log secret values (M1's PAT logs "PAT updated" only — never the value).
- **Gate-0 feed-inversion fix** (0.36.0, Q1) — a crossed feed (instasell>instabuy) is now
  `reliable:false`/`reliableReason:'feed-inversion'` in `computeQuote`, so `momVerdict()` Gate 0
  prints **NO-READ** instead of a decisive verdict off a non-price. `/positions`' interim
  override is gone. Don't re-add per-consumer inversion checks — the reliability signal is shared.
- **Finder rating rework** (0.17.0) — `computeScores()` in `js/market.js`: four 0..1
  sub-scores → a `quality` dampener on profit/hr.
- **Ledger auto-populate from fills** (0.18.0) — `syncFills()` in `js/ledger.js` (A3 — was
  `js/ui.js`) merges `positions.json` (`src:'fills'`, idempotent, tombstoned via `STATE.fillsHidden`).
- **Position review workflow** (0.19.0) — `reviewPositions()` in `js/trends.js`:
  HOLD/ADJUST/CUT + "list at X" per open lot.
- **Falling items → price to clear** (0.20.0) — SUPERSEDED 0.19.0's "list high above
  market" (the ~always-true `patientUpside` guard misfired in a decline). `renderPositionCard`
  now always lists a faller at the instabuy (in profit → SELL; underwater → CUT), never
  above it. Don't reintroduce the upside guard.
- **Last-2h momentum — `Mom` column + cut-trigger** (0.30.0) — `computeQuote` derives
  `mom` from the **pre-clamp** band comparison; shared `momVerdict()` in `js/quotecore.js`
  drives the held-position cut-trigger. Deliberately NOT wired into the bulk Finder list.
- **Underwater-at-tick triage — the gate tree** (0.33.0, PLAN-3) — `momVerdict()` is the
  whole tree; Gate-0 `reliable` + `diurnalRead`/`moveShape`/`underwaterHours`; verdicts
  NO-READ/DIURNAL-WATCH/SHOCK-WATCH/CUT/LIST-TO-CLEAR/HOLD/CUT-CANDIDATE (plus the V3
  Gate-D softenings WATCH — fresh entry / HOLD — ask filling). Fixtures:
  `pipeline/quotecore.test.mjs`. `MONITORING.md` step 4 is the tree. Every gate defers only
  on positive evidence (real breakdown cuts byte-identically — regression-guarded).
- **Gate-D lot-context softening** (0.52.0, V3) — `momVerdict()` gained an OPTIONAL
  6th param `lotCtx={buyTs, askFilling}` that softens ONLY the clean-momentum Gate-D
  CUT-CANDIDATE: a lot bought < `FRESH_HOURS` (1h, placeholder, exported from `js/quotecore.js`)
  ago → **WATCH — fresh entry**; an own ask filling above the clear price → **HOLD — ask
  filling**. Absent `lotCtx`, momVerdict is byte-identical to before; the Gate-2 breakdown CUT is
  NEVER softened (regression-pinned in `quotecore.test.mjs`). Callers pass it: `watch.mjs` (buyTs
  from the open lot + askFilling from the live ask), `quote.mjs --positions` (buyTs only),
  `js/trends.js reviewPositions` (buyTs from `t.opened` — the app inherits the entry-age
  softening). `readOpenPositions` groups now carry `buyTs` (oldest lot). Don't re-fork the
  softening back into the breakdown matrix.
- **Project skills + skill-versioning convention** (PLAN-5) — `/positions` `/scan`
  `/overnight` `/morning` at `.claude/skills/*/SKILL.md`; per-workflow doctrine *moved*
  there. Skills-only changes bump the SKILL.md `version:` frontmatter, NEVER `APP_VERSION`.
- **`/overnight` fill-realism check** (v1.1/1.2) — band-floor bids don't fill overnight;
  `windowrange.mjs` (né `nightlows.mjs`) scores recent nights; size as "up to", not a guarantee.
- **Self-improving skills** (PLAN-5 K1) — each workflow skill's closing "Encode learnings"
  section: after the market work (offers first), one canonical home per fact, background
  subagent edits+commits. Market claims still need evidence (one session = one sample).

## Market judgment layer — lives in the project skills (moved by PLAN-5)
The screen/positions judgment layer (500k gp/d floor, 24h-drift-is-a-pre-filter-only,
two-sided liquidity / ghost-spread discipline, tax-dominates-thin-flips, band-is-the-edge
pricing, band-top artifacts, fresh-repricer flag, overnight/morning posture) lives in the
committed project skills `/scan`, `/positions`, `/overnight`, `/morning`
(`.claude/skills/*/SKILL.md`) — *moved* there, not copied, so it loads only when the
workflow runs. The ask→command table below still routes bare asks.

## Market analysis workflow — standard output format
Every market read presented to Ben (screen, per-item quote, position review) is ONE table
(the **table v2** column set, T1):
`Item | Guide | Quick | Optimistic | Vol/d | Momentum | Regime`
- **Quick** and **Optimistic** are each SELF-CONTAINED cells reading `buy → sell · net/u (ROI)`
  (net after 2% tax; the cell is colored gain/loss in the app). Quick = transact now (buy at live
  instasell, sell at live instabuy). Optimistic = patient 2h-band edges (last 24×5m points: min
  avgLow / max avgHigh). Mid is dropped from the table (redundant next to Guide + the live prices;
  the row model still exposes `row.mid` for `rating.mjs`/`watch.mjs`).
- **Ordering + the `Momentum` (last-2h momentum) column.** On ONE consistent basis, optBuy ≤ quickBuy
  ≤ quickSell ≤ optSell holds *normally*. A break means one of two things — check the bases FIRST:
  (1) **inconsistent bases → bug** (24h percentiles mixed with live quotes — the 2026-07-03
  incident); fix the script. (2) **consistent bases (live `/latest` + 2h 5m-band) → a real-time
  momentum tell**, not an error: the live price moved *outside* its own 2h band. `quickBuy < optBuy`
  (live instasell below the 2h floor) = **breaking down / active pullback** — don't buy in, and a
  held big-ticket flashing this is a CUT trigger that fires *before* the lagging multi-day regime
  confirms (this is the signal whose absence cost us on the bludgeon exit). `quickSell > optSell`
  (live instabuy above the 2h top) = **breaking up / fresh 2h high**. Clean in-band = ranging.
  The price columns clamp opt to never cross quick (correct *pricing*), so this tell is surfaced as
  the **`Momentum` column**, computed from the *pre-clamp* live-vs-band comparison and rendered with
  strength-graded arrows: `–` (clean/in-band, muted) · `↑`/`↓` (single-arrow break, amber) ·
  `↑↑`/`↓↓` (strong break ≥ `MOM_STRONG_PCT` past the band edge — green up / red down). `Momentum`
  is a **dig-in / position-management** signal — it appears in the per-item views that fetch the real
  2h series (Trends card, Finder expander, position review) and the `quote.mjs`/`screen.mjs` scripts,
  and it drives the position cut-trigger (a held breakdown escalates toward CUT before the regime
  confirms; big-ticket in-profit-but-breaking-down positions clear rather than hold). The categorical
  `mom` (clean/breakdown/breakup) is unchanged — the arrows are display strength only; `momVerdict`/
  the cut-trigger still consume `mom`. It is deliberately NOT wired into the bulk Finder-list rating
  (approximate there / churns the sort). Verified live 2026-07-03 — flags matched an independent
  2h-drift read.
- Guide = real GE guide price, NEVER the wiki mapping `value` field (that's base/alch value).
- Vol/d = limiting side, `min(highPriceVolume, lowPriceVolume)` from the 24h endpoint.
- **Liquidity gate (S1):** the two-sided requirement (`hpv>0 && lpv>0`) is the *non-negotiable*
  ghost-spread lesson — but the raw UNIT floor (`--floor 50/d`) was the wrong UNIVERSAL measure. An
  item now clears liquidity on `limitVol ≥ --floor` **OR** gp-flow `limitVol×mid ≥ --gp-floor`
  (default 250m). The gp-flow-only path admits big tickets (single-digit units/day, hundreds of
  millions of real daily flow — the Avernic-defender-hilt class); those are flagged `thin`, capped at
  grade **A-** (`rating.mjs`, `THIN_GRADE_CAP` — you can only move a few units/day) with a "thin:
  ~N/day — size in units, expect slow fills" tooltip, and bounded to a small fetch RESERVE
  (`--thin-reserve`, default 6/niche) so noisy thin bands never crowd out liquid flips.
- **500k attention floor (S1):** `--min-gpd` (default 500_000) drops any row whose realistic
  `expGpDay` is below the floor *pre-rating* — the structural home of Ben's "never surface sub-500k"
  rule (was a `/scan` post-filter). Thin gp-flow qualifiers and held/asked items are exempt.
- Net/u (inside the Quick/Optimistic cells) is after 2% tax. Regime = multi-day regimeDrift check
  (flat/rising/falling label). `screen.mjs` additionally annotates the Regime cell with a **phase
  tag** (`spike`/`decay`/`basing`) from the shared `phase()` (`js/quotecore.js`), computed off the
  same 6h series `regimeDrift` already uses — **zero extra fetch** — e.g. `Flat -8% · basing`. It's a
  display-only trajectory tell (where the item sits in a spike→decay→base arc), NOT a gate, and the
  app never renders it (pipeline-only, so it ships without an `APP_VERSION` bump). `screen.mjs
  --phase-rescue` (OFF by default → default output byte-identical) is an opt-in trial that surfaces a
  `basing`-classified faller the falling-exclusion would otherwise drop, capped at grade B and flagged
  provisional; its thresholds are unvalidated placeholders. Full trajectory method: `/positions`
  "trajectory read for confidence".
- Break-even = the smallest sell price that still nets the buy cost after the 2% GE tax, computed by
  the shared `breakEven()` in `js/quotecore.js` — **tax-capped, piecewise** (BE1): `buy` when `buy<50`
  (sub-50gp sells are tax-exempt), `buy + TAXCAP` (5m) once the cap binds at `buy > 245m` (`ceil(buy/0.98)`
  overstates a big-ticket break-even by up to 5m), else the uncapped `ceil(buy/0.98)`. Never list a held
  item below it. This is the ONE definition — every other doc/skill points here.
- **Falling-regime items are excluded from screens entirely — don't show or mention them.**
  Exception: items Ben holds, asks about, **or watchlists** (S3) → always show, with price-to-clear
  guidance. `screen.mjs` appends a **Watchlist** section (from tracked repo-root `watchlist.json`)
  quoting every watchlisted item as a full standard row — exempt from every floor/gate, graded, with
  the reason a gate *would* have hidden it as a Note (below-floor / thin / one-sided / falling).
  Falling watchlist items ARE shown there, with the falling warning.
- Screens: `screen.mjs` prints one table per niche, adding a Grade + `Score gp/d` column to
  the canonical layout (grade cutoffs in `rating.mjs` are placeholders pending validation).
- **Time-of-day context on every price recommendation (Ben, 2026-07-05).** Whenever a
  specific buy or sell price is being suggested (scan pick, per-item quote follow-up,
  position reprice, ladder rung), run a `windowrange.mjs` window read for the relevant
  local-hours window (e.g. `--window 21-0` for a late-evening bid) and read the level
  against the last ~14 same-window lows — daily movement patterns are standing context,
  not an overnight-only tool. It caught the bludgeon evening bounce, re-priced the jaw
  bid to the level its window actually touches, and exposed the webweaver 3-day repricer
  (2026-07-05). Honesty rule applies: ~14 nights is a small sample; "touched ≠ filled";
  it's a guide that shifts a price a few ticks, never a guarantee that overrides the
  band/regime read. That read is the NARROW-WINDOW *timing* check (is this price touched in
  the relevant local-hours window). For a marginal/big-ticket hold-or-cut, the FULL-DAY
  multi-week *trajectory* read (`windowrange.mjs --window 0-23 --nights 21`, phase-mapped to
  base/spike/decay) is the distinct tool that builds confidence on where price is heading —
  see the `/positions` skill's "trajectory read for confidence".
**How to generate these tables — each canonical ask maps to a skill or an exact command.
These scripts exist and ARE the workflow.** ALWAYS use them; NEVER hand-write a `node -e`
fetch for a market read (each ad-hoc script also burns ~1–2k tokens to author + parse — the
scripts exist specifically to kill that cost). All the scripts import `js/quotecore.js`, so
the numbers are byte-identical to the app's tables.

**Plain-language → command (match Ben's ask to ONE of these and run it immediately — don't
deliberate):**

| When Ben says something like… | Run |
| --- | --- |
| "how's **`<item>`**?", "quote **X**", "what's **X** doing?", "check **X** [and **Y**]" | `node pipeline/quote.mjs "<item or id>" [...more]` |
| "find me flips", "any **opportunities**?", "what should I **buy**?", "**screen** the market", "anything in **`<niche>`**?", "**scan**" | **`/scan` skill** — runs `node pipeline/screen.mjs [--mode band\|spread\|rising\|churn\|all]` + the judgment pass |
| "how are my **positions**?", "check the market against **what I hold**", "am I **underwater**?", "should I **cut/hold** anything?", "review my **holds**" | **`/positions` skill** — runs `node pipeline/quote.mjs --positions` + verdict interpretation → action plan |
| "set up for **overnight**", "what should I leave running overnight", "**going to bed**" | **`/overnight` skill** — two-phase: `/positions` → pause for stated capital → `/scan` + accumulation sizing |
| "what happened **overnight**?", "**morning** review", "what **filled**?", "catch me up" | **`/morning` skill** — positions.json/fills.json + `monitor.mjs` + re-verdict stale bids |
| "watch/**monitor** my positions", "run a flipping **session**", "poll/keep an eye on **X**" | `node pipeline/watch.mjs ["<target>" …]`  (drive with `/loop`, see `pipeline/MONITORING.md`) |

Script facts the skills rely on (current behavior, not doctrine):
- `quote.mjs` takes multiple items in one call; prints one combined table + a regime line
  per item that includes the **buy limit** (`· buy limit N/4h`) and a `⚠ feed inversion`
  footnote when the quote basis is unreliable.
- `quote.mjs --positions` adds Held@/Break-even/Verdict columns; the verdict vocabulary is
  the PLAN-3 gate tree (`MONITORING.md` step 4, emitted by the shared `momVerdict()`):
  NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT / LIST-TO-CLEAR / HOLD / CUT-CANDIDATE, plus the
  V3 Gate-D softenings WATCH — fresh entry (fresh lot) / HOLD — ask filling (own ask filling
  above the clear).
  Interpretation of those verdicts lives in `/positions`.
- `screen.mjs` shares one gate stack (two-sided liquidity **OR** `--gp-floor` gp-flow, price window,
  `--min-gpd` 500k attention floor, falling-exclusion); `--mode` swaps only the step-3 edge. Four
  niches exist — `band` / `spread` / `rising` / `churn` — but per Ben's **NY2** ruling (2026-07-05)
  **`--mode all` runs band/spread/rising only; churn is off-by-default** (reach it with an explicit
  `--mode churn`). `rising`'s candidate pool carries a NY2.1 noise floor (big-ticket **OR** liquid,
  `risingPoolFloor`) that drops the cheap teleport-tab flood while keeping cheap-but-liquid risers.
  Thin gp-flow big tickets ride a bounded `--thin-reserve`.
- `screen.mjs --posture overnight|active|auto` (S2) TUNES that stack (not a new niche): **overnight**
  keeps only flat/rising + confident-band + non-thin + non-breakdown rows, ranks by net edge over
  velocity, and drops items whose *yesterday overnight window* printed below the current bid
  (`overnightStaleRisk`); **auto** picks by the local clock (~22:00–06:00); **active** (default) =
  current behavior. Posture is recorded in `screen.json` so the Scan banner names it. `/overnight`
  runs `--posture overnight`. `quote.mjs --positions` prints an informational late-night morning-
  staleness line (verdict logic unchanged).
- `watch.mjs` watches every **position**, where a position = *any committed capital*: held
  inventory PLUS every active GE offer (Ben's definition, 2026-07-04; shared log reader
  `pipeline/lib/offers.mjs`). Output is headline (alerts up front) → one numbers-only
  table (Verdict/Item/Position + the canonical quote columns) → a per-item note block →
  summary footer (2026-07-05 reformat; shape documented in MONITORING.md "What each tick
  surfaces"). Each HELD lot's note block follows a **stable, ordered EMIT CONTRACT (V5,
  `pipeline/lib/emit.mjs` `heldNoteBlock`)**: `verdict · conviction-state (V4 armed) ·
  Δ-since-last (V1) · structural tripwire (V2) · sell/list-at (+ break-even) · fill-progress`,
  same fields in the same order every pass, optional fields dropped when N/A. The
  **sell/list-at + break-even field is ALWAYS emitted on a held lot** (`sell: list @ X ·
  break-even Y · ask n/m`) — the standing rule (Ben, 2026-07-06): always state the sell price
  for every held item, since a fill you didn't see may have happened. It's output-format-only
  (no verdict/alert change). The block also carries an **ADVISORY `recovery-read` line (V6,
  `pipeline/lib/recovery.mjs`)** — a recover-vs-drop LEAN composed from the signals momVerdict
  already computes (diurnal · regime/phase · underwater-persistence · vs the V2 support), surfaced
  ONLY on a non-clean position (underwater / thin-margin / unfilled ask / a `BID-BEHIND` bid / a
  lean that conflicts with the verdict) and silent on a cleanly-good one. It is decision SUPPORT —
  NEVER a verdict/alert input, decides/auto-cuts nothing; a `phase==='spike'` caps its confidence to
  `uncertain` (blind to a repricing). The headline may also show a **V6 Companion freed-capital
  prompt** (`⋯ freed ~X this pass — consider a scan to redeploy`) when a booked SELL freed ≥
  `FREED_CAPITAL_SCAN_GP` (5m placeholder) since last pass (`pipeline/lib/capital.mjs`) — surface-only,
  it never auto-places and never runs the scan. Asks annotate their held row's Position cell (`ask n/m @ X` / `NOT LISTED`);
  bids get their own rows with verdicts BID-OK / BID-BEHIND / CROSSING / CANCEL-BID
  (only CANCEL-BID — adverse-selection fill risk — alerts). Offers under 100k total value
  are noise, collapsed to one line. Each bid row and listed-held row also prints a `window`
  context line (coming-8h touch/reach quantiles over ~7 days, via the shared
  `pipeline/lib/windowread.mjs` — same math as `windowrange.mjs`): context beside the verdict,
  never a verdict input. `quote.mjs --positions` remains the booked-lots view.
- `windowrange.mjs "<item>" [--nights 14] [--window 0-8] [--bid <gp>] [--ask <gp>]` (renamed
  from `nightlows.mjs` 2026-07-05 when the high side was added; bucketing/quantile math lives
  in `pipeline/lib/windowread.mjs`, shared with `watch.mjs`'s window line) scores the last ~14 local
  days from the 1h timeseries: per-day window low AND high + instasell/instabuy volume, the
  bid levels touched and ask levels reached on ~50%/~75%/all days, and `--bid`/`--ask`
  scoring for specific candidates. `/overnight`'s fill-realism check runs it on every
  candidate bid; the time-of-day doctrine bullet above runs it on every price rec
  ("touched/reached" ≠ limit filled; ~14 days is a small sample).

## Open followups (not yet built)
- **The master plan: `PLAN.md`** (single plan file since 2026-07-04) — the plan + the
  scoreboard. Waves 1–4 have **all shipped** (T1/T2, O1, K1–K3, S1–S3, Q1, E1, L1, G1, M1, N1,
  and the Wave-4 cleanup D1/R1/P1/X1/X2/A1–A3/BE1/W1/CI1) — see PLAN.md's Status table for the
  per-chunk shas. The only work still open is **F1** (algorithm feedback — GATED on O1's sample
  thresholds, realistically weeks of accrual away) plus whatever sits in PLAN.md's **Discovered**
  list. `main` is protected by a PR+`checks` ruleset (G1, 2026-07-04); no merge queue on this
  user-owned repo and PR creation is token-blocked for now, so chunks land via attended
  direct-push under the admin bypass (parallel lanes still use worktree subagents,
  hand-serialized) until `gh auth refresh` enables the PR path. The historical plan docs
  (`PLAN-2/3/4/5.md`, and the folded `PLAN-LOCAL-WATCH.md`/`PLAN-LOG-HARDENING.md`) are
  **deleted** — full text via `git show <sha>:PLAN-4.md` (etc.). A per-topic `PLAN-*.md` is
  folded into `PLAN.md` and deleted the moment its last chunk ships — don't leave shipped plan
  files at the repo root.
- **Per-item "recommend price adjustment" button** on the Trends page: pull fresh GE
  state + item info on demand and recommend a price tweak (ties into patient pricing
  and eventually the fills pipeline's realized-vs-suggested calibration; tracked in
  PLAN.md's unscheduled notes).
- ~~**Ledger redesign — grouped, watchlist-filtered, period P&L**~~ — **BUILT** (watchlist
  filter, per-item grouping + drill-in, period P&L bucketed by SELL date — `renderLedger` /
  `periodKey` in `js/ledger.js`, A3 — were `js/ui.js`). The local-timezone day-boundary verification lives in PLAN.md
  chunk E1. **Ledger UX rework** (0.45.0, LU1) refined the surface: the grouped-row item name is now a
  Trends link (`linkname`→`openTrends`) and multi-lot expansion moved to an explicit `.expbtn` chevron
  (the old whole-row `data-grp` click is gone); the P&L period control (`#ledgerPeriod`) moved from the
  top bar onto the "Closed flips" label; clicking a `#periodStrip` bucket filters the closed table to that
  bucket's sell date (`STATE.ledgerBucket`, session-only — active bucket shows an `×`, "All" pill or
  re-click clears, changing granularity clears); the manual-entry form is a collapsed-by-default
  `<details id="ledgerFormD">` (persisted `ledgerFormOpen`); and the closed-flips columns sort via TB1's
  `makeSortable` on group aggregates (default `last`-close desc = unchanged order).

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
   On-demand `sync-fills.mjs` pushes of `fills.json`/`positions.json`/`suggestions.jsonl`
   go direct to `main` too (pipeline-owned; clobber-guard reconciles). No unattended writer
   remains (the schedule was eliminated — `pipeline/FILLS-PIPELINE.md` §12).
7. Ben doesn't have a separate git GUI client on the Windows machine — git CLI + SSH
   auth to GitHub is already working and is the only tool needed for git operations;
   don't suggest installing anything else for those. The GitHub CLI (`gh`) IS
   installed (2026-07-04); it is the API + **PR/merge-queue management** layer, not a git
   transport (git stays on SSH) — see the "GitHub CLI (`gh`), Actions CI, and shipping"
   section and the `/ship` skill.
8. **A documentation pass is part of every change — not optional, and not append-only.**
   Before calling a change done, update the docs the change touches: this `CLAUDE.md`
   (a "Done" pointer, plus any workflow/section it affects), and any affected doc
   (`pipeline/MONITORING.md`, `pipeline/FILLS-PIPELINE.md`, `README.md`). Crucially, this is
   a *reconciliation* pass, not just new prose: **grep the docs for statements the change now
   supersedes or contradicts and fix them in place** (e.g. a superseded matrix/table, a stale
   "verdict set", a now-inaccurate trigger condition). Adding a new section while leaving an
   old one that says the opposite is the failure mode to avoid — the 0.30.0→0.33.0
   `momVerdict` reconciliation is the anchor. If a plain-language ask should map to a specific
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
   verify each landed against **PLAN.md's Status table**, NOT `git branch --merged`. Ask Ben
   before deleting any *remote* branch (`git push origin --delete …`). Check `git status` for
   orphan untracked artifacts a chunk left behind. Multi-lane dispatch mechanics are `/ship` §7.

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
- **On-demand `sync-fills.mjs` pushes go direct to `main`** riding the admin bypass
  (pipeline-owned artifacts; clobber-guard reconciles). No unattended writer / machine
  bypass identity exists — the schedule was eliminated (`pipeline/FILLS-PIPELINE.md` §12).
- **CI: `.github/workflows/checks.yml`** — a cheap `checks` job (JS syntax sweep, quotecore
  + reconstruct acceptance fixtures, `fills.json`/`positions.json` parse) plus a separate
  **`smoke` job** (CI1) that loads `index.html` in headless Playwright chromium with all
  external network stubbed and fails on any page error / app console error / empty pane —
  the "syntax passed but the app broke" class the process rules warn about (`pipeline/smoke.mjs`).
  Both run on push, PR, and `merge_group`; the cheap job is split out so it fails fast. Agents
  may add/improve workflows within the constraints in `/ship` §4 (public logs, no `~/.runelite`,
  seconds-fast, no secrets).

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
both `fillsLogLine` (`js/fillslog.js`) and `pipeline/add-manual-fill.mjs`, so rendering them
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
