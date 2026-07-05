# CHANGELOG — The Coffer / The-Ledger

Deep per-version writeups (rationale, superseded approaches, the "why" behind each shipped
change) live here. `CLAUDE.md`'s "Done (recent)" section keeps only a one-line load-bearing
pointer per entry — the "do not rebuild this" signal — and points here for the full story.
Moved out of `CLAUDE.md` by PLAN.md chunk K3 (2026-07-04). Newest entries at the top of the
recent block; the ordering below preserves the original CLAUDE.md sequence.

For anything older or not captured here, the commit history + `git show <sha>` is canonical.

## Recent

### Suggestlog path regression fix (SL1, pipeline-only — no APP_VERSION bump)
OR2 moved `suggestlog.mjs` from `pipeline/` into `pipeline/lib/` but left its ledger path as
`HERE/'..'/suggestions.jsonl` — correct from the old location, but from `lib/` it resolves to
`pipeline/suggestions.jsonl`. Every market read from OR2 onward (2026-07-05 10:21→15:39, 351
rows) appended the O1 suggestions ledger — the accrual dataset the F1 algorithm-feedback gate
is waiting on — to that untracked fork while the tracked repo-root file sat frozen. Found when
Ben questioned a cleanup recommendation to delete the "orphan" (the first-pass review had
misread `HERE/..` as repo root); the near-miss is the lesson — **verify a file is dead by
proving what writes it, not by checking what reads it.** Fix: path now two levels up (exported
as `LEDGER`), the 351 stranded rows folded back into the tracked ledger in ts order, and new
`pipeline/lib/suggestlog.test.mjs` pins the resolved path to the repo root (plus the
never-fabricate-numbers entry contract and the liqClassOf thresholds). 17 suites. One
follow-through at merge time: rows the desk writes to the forked path before it pulls this fix
get folded the same way, then the stray file is deleted.

### Trends analytics extraction + gate-stack extraction (0.50.0 TC1; GC1 pipeline-only, no bump)
Two Wave-7 testability extractions, both pure MOVES with behavior held byte-identical (the TD2
precedent: make a decision-bearing function node-importable so its real rules get a committed fixture,
without changing them).

**TC1 — `js/trendcore.js` (0.50.0).** The pure, DOM-free analytics behind the Trends view — everything
from `bestWindow` / `analyseHourly` / `analyseBroad` / the `seasonalFactors`→`hourFactors`→`factorStats`
decomposition through `buildPlan`, `patientTargets`, the walk-forward `dayGroups`/`backtestPlan` gate,
and `planSignal` (plus `median` and the `sideVal`/`localDayKey`/`hourOf` helpers) — was living
DOM-pinned in `js/trends.js` (which imports charts.js/ui.js/main.js at load), so the money-affecting
`backtestPlan` gate and `patientTargets` sizing had NO test. Moved wholesale into node-importable
`js/trendcore.js` (its only imports are node-safe `format.js` tax/netMargin and `quotecore.js`
regimeDrift); `trends.js` re-imports the six it renders (`analyseHourly`, `analyseBroad`, `buildPlan`,
`patientTargets`, `backtestPlan`, `planSignal`). The Trends tier-structure doctrine header stays in
`trends.js` where its editors look. New `pipeline/trendcore.test.mjs` (19 checks) pins: the walk-forward
gate (insufficient-days path + a clean 10-day diurnal cycle where buying the cheap window / selling the
rich one beats naive spread-flip every out-of-sample day, `edge === stratRoi − spreadRoi`), patient vs
falling offer sizing (20th/80th vs 10th/clear-at-instabuy percentiles), the seasonal detrend (a 2× price
day yields identical hour factors), volume weighting, corrupt-print trimming, and `median`/`bestWindow`
edges. No behavior change — a straight move; `APP_VERSION` → 0.50.0 because it touches deployed files.

**GC1 — `gateCandidates` thresholds-as-argument (pipeline-only, no bump).** `screen.mjs`'s pre-fetch
candidate gate stack was a module-scoped function closing over the CLI-derived constants (FLOOR,
MIN_ROI, GP_FLOOR, MIN_GPD, the rising-pool floor, …), so it couldn't be fixtured. GC1 exports it as
`gateCandidates(mode, ctx, thresholds = THRESHOLDS)` — every constant it used is now a named field of
the `thresholds` object; `main()` passes a `THRESHOLDS` object built from the same CLI values, so stdout
is byte-identical for every mode/flag. New `pipeline/gatecandidates.test.mjs` (8 checks) drives the whole
stack with synthetic 24h/band data: two-sided liquidity, gp-flow big-ticket `thin` admission, the 500k
attention floor + the thin exemption, the rising-pool noise floor (big-ticket OR liquid, rising-mode
only), a traded-band requirement, and the price window. **Boundary honestly documented:** falling-
EXCLUSION and rising-CONFIRM are NOT in `gateCandidates` — they run post-fetch in `renderMode` off the
real `computeQuote` row — and held/asked/watchlist exemptions bypass the gate stack entirely (the S3
watchlist path), so they're out of this function's scope and not fixtured here. Runner now discovers
16 suites; no `checks.yml` edit (auto-discovery).

### Exchange-log hardening — impossible-transition validation + restart-blindness warning (LH1/LH2, pipeline-only, no APP_VERSION bump)
**Origin (Ben, 2026-07-05):** "we've had a ton of problems with the log discrepancies… missing bids,
phantom bids." A live-session catalogue found four failure classes; two were already fixed (the
EMPTY-burst phantom-cancel inference was deleted 2026-07-05; the stale-positions basis is solved by
LW1's `watch-log.mjs`). This is the remaining two. **Pipeline + docs only — no deployed-app change,
so no `APP_VERSION` bump.**

**LH1 — slot-state validation in reconstruction.** A GE slot is a state machine: a terminal event
(BOUGHT/SOLD/CANCELLED_*) closes it, so a SECOND terminal on the same slot with NO placement/progress
line between is IMPOSSIBLE unless the plugin re-emitted a stale slot state after a relog (the burst of
simultaneous EMPTY lines on the OTHER slots is the tell). On 2026-07-05, 13:25:53 and 13:29:01 both
logged `BOUGHT` item 13263 qty 1 @17,401,000 on slot 7 — only one buy was real.
- New exported pure `validateSlotTransitions(events)` in `pipeline/lib/reconstruct.mjs`, run at
  INGEST (next to `buildEvents()`, BEFORE the `fills.json` merge) in `sync-fills.mjs` `regenerate()`
  and in `monitor.mjs`. Walking each GE slot's event subsequence in ts order, when a terminal follows
  a terminal on the same slot with nothing re-opening it between: if STRICTLY identical to the prior
  terminal (`sameTerminal`: item+type+qty+price+filled+spent) it is a provable re-emit → **DROPPED
  LOUDLY** (a `console.warn` per drop with item/qty/price/slot + the prior terminal's ts, plus a
  dropped-count in the sync summary line) and, because it runs pre-merge, it **never enters
  `fills.json`**. Conservative: any differing field → warn but KEEP (fail toward preserving data);
  manual slots 8/9 (no GE state machine) are exempt entirely. This does NOT resurrect the deleted
  cancel-to-EMPTY inference — EMPTY lines are consumed by `buildEvents()` and never reach here, so
  absence is still never evidence; only two REAL terminals trigger it.
- The loud warnings are gated (`warn:false`) in the frequently-re-run callers — the `watch-log.mjs`
  daemon, `sync-fills.mjs --local`, and `monitor.mjs` — which re-read the whole log every run and
  would otherwise re-print months-old historical re-emits every tick; the attended sync stays loud.
- `dedupeSnapshots()` (P1) remains the SILENT DERIVATION-LAYER BACKSTOP inside `reconstruct()`, using
  the same discriminator, so a phantom ALREADY persisted in an older (pre-LH1) `fills.json` — which the
  ingest validator never re-reads — is still dropped from the derived `positions.json`. Don't merge the
  two layers: ingest (loud, keeps the archive clean going forward) vs derivation (silent, cleans history).
- **Real-log acceptance:** re-running the reconstruction over the live logs into a temp dir dropped
  **17** identical same-slot re-emits (incl. the known 13:29 bludgeon), each warned, and produced a
  `positions.json` byte-identical (modulo `generatedAt`) to the committed one — confirming the drops
  were already what the silent backstop did; LH1 only makes them visible and keeps them out of the
  archive. Fixtures in `pipeline/validateslots.test.mjs` (the verbatim 13:29 case, the real-repeat
  case with a placement between, a near-duplicate differing price → kept, manual slots exempt, P/L
  parity, and a REMOVE tombstone still purging a surviving event).

**LH2 — restart-blindness warning line.** After a client restart the Exchange Logger (emit-on-change)
re-emits nothing until each slot next changes, so `monitor.mjs`/`watch.mjs` read resting offers as
missing (NOT LISTED / no active bids) for minutes-to-hours — root cause is the plugin, not fixable in
reconstruction, but detectable.
- New pure `blindWarningLine()` + `BLIND_STALE_MIN` in `pipeline/lib/logblind.mjs`, wired into both
  `monitor.mjs` and `watch.mjs` headers. **Chosen heuristic (self-contained, documented in the file
  header):** fire when the newest exchange-log line is stale (≥20m) AND the log shows ZERO active
  offers AND you hold open inventory (>0 lots) — the exact post-restart blind state, and very unlikely
  otherwise (an idle desk fails the inventory gate; a live log fails staleness; a log showing your
  offers fails the zero-offers gate). Deliberately avoids fragile RuneLite `launcher.log`/`client.log`
  mtime parsing (client.log is rewritten continuously while running). Honest limitation, documented: it
  can't see a blind state where you hold no inventory but only resting bids. No behavioral change — the
  header line is the whole deliverable; verdicts/annotations are untouched. Fixtures in
  `pipeline/logblind.test.mjs` (pure line assembly only, not the filesystem probe).

**Docs (LH3):** `FILLS-PIPELINE.md` §5.1 + §10 name both artifact classes and the two-layer validator
and reconcile the "append-only truth" phrasing (the log is an archive of REAL events, not unfiltered
truth); `MONITORING.md` documents the blindness header line; the `reconstruct.mjs` P1 comment is
reconciled to "silent backstop." Test suite: 14 suites green via `node pipeline/run-tests.mjs` (adds
`validateslots.test.mjs` + `logblind.test.mjs`).

### Watch tab — the at-a-glance flipping desk (0.49.0)
**Origin (Ben, 2026-07-05):** an approved HTML mockup (`WATCH-TAB-MOCKUP.html`, since deleted — recover via git history) — a verdict-first desk surface that
turns the data LW1/LW2 made live at the desk (held book + offers) into a single glance: *what do I
hold, what wants action, what's resting, what filled today.* Built exactly to the mockup, with the
tweaks Ben pre-approved.

**What shipped:**
- **A new `Watch` tab** rendered by `js/watch.js`, top-to-bottom: (1) three freshness stamps (prices
  live / held book synced / offers as-of-sync — staleness is always stamped, never hidden); (2) a
  4-cell summary strip (Exposure = deployed capital · Day P/L = today's realised · Free capital =
  bankroll − deployed · Alerts); (3) **held positions** as one verdict-first card per flip lot —
  severity stripe (green HOLD / amber WATCH / red CUT) + a `momVerdict()` pill + momentum glyph +
  a right-aligned P/L-at-action figure + a 4-col data grid (Held @ / Break-even / Quick sell or
  Target ask / Regime) + a dashed action line + a **session-context note**; incidental inventory
  (sub-100k lots) collapses to one muted line; (4) **active offers** from `STATE.offers`, each a flat
  verdict-tagged row (BID-OK / BID-BEHIND / CROSSING / CANCEL-BID for bids, LISTED for asks) with a
  fill-progress bar, behind an amber staleness banner (the browser can't read the exchange log —
  offers are as-of-last-sync; held quotes above are live); (5) today's fills feed from `fills.json`.
- **Shared verdicts, not reimplemented.** Held cards call the shared `momVerdict()`; the bid decision
  was extracted from `pipeline/watch.mjs`'s inline `bidVerdict` into a new pure `offerVerdict(row,
  offerPrice)` in `js/quotecore.js`, and `watch.mjs` now routes its `bidVerdict`/`bidAlert`/`bidAction`
  through it — **byte-identical console output**, and a bid now reads identically in the terminal and
  the browser (the `momVerdict` precedent). Break-even is the shared `breakEven()`; the momentum glyph
  is `momCell()`. No tax/quote/verdict math is duplicated.
- **The tweaks (Ben-approved):** (A) session-context notes are **editable in place** (✎ → inline input;
  empty → "+ add context…"), persisted per item under `watchnote:<id>` via the app's `sSet`/`sGet`;
  their contents are **never logged** (L1). (B) the bid logic is **shared, not forked** (above). (C)
  pure derivations live in node-importable `js/watchcore.js` (verdict→stripe family, alert count,
  flip/incidental split, today's-fills feed + after-tax net, summary aggregates) and are fixture-tested
  in `pipeline/watchcore.test.mjs` (12 checks incl. `offerVerdict`'s gate order). (D) **Alerts =
  CUT-family held verdicts (CUT / CUT-CANDIDATE / LIST-TO-CLEAR) + CANCEL-BID offers** — the tab badge
  (red when >0) and the summary cell share the one count. (E) data sources reuse what the app already
  has: held book from `positions.json` via `syncFills`, offers from `STATE.offers` (LW2), today's fills
  from same-origin `fills.json` filtered to the LOCAL day, and Day P/L's after-tax net comes from the
  matched `positions.json` close (fills.json alone has no profit) — an unmatched sell honestly shows a
  blank net.
- **Naming:** the pre-existing **Watchlist** tab used the id `watch`; it was renamed to id `watchlist`
  (routing + panel id only; `watchTable`/`watchBadge`/`renderWatch` unchanged) so the new tab could
  take `watch` (matching the pipeline's `watch.mjs` concept, and the smoke test's existing `watch`
  entry). `pipeline/smoke.mjs` now enumerates 8 panes (`watchlist` + `watch`) and asserts both render
  non-empty under stubs.
- **Refresh model:** the market re-quote loop runs **only while the tab is visible** (started in
  `switchTab`), reusing marketfetch's cached `ts`/`24h` store — a light refresh, not a new data poller.
  One background pass fires at init so the alert badge is live before the tab is first opened.

Verified with a headless Playwright pass against the real committed `positions.json`/`offers.json`/
`fills.json`: two flip cards (Basilisk jaw → HOLD green, Serpentine helm → CUT red), the Soul-rune
incidental collapsed, offers rendered with a BID-BEHIND bid, today's fills fed, badge = 1, and the note
round-tripping through localStorage — no console errors. APP_VERSION → 0.49.0.

### Local log-watcher — desk-side freshness without an unattended writer (0.48.0, LW1/LW2)
**Origin (Ben, 2026-07-05):** "Can we have some process watch the log file and automatically sync?"
The obvious build — a daemon that auto-commits/pushes on every change — would reintroduce exactly the
**unattended writer to `main`** that §12 (schedule elimination, G1) deleted to unblock the PR + `checks`
protection. So we took **option 1**: regenerate locally on every log change, **never** commit or push.
The daemon does **zero git**; publishing to Pages (and the phone) stays attended and on-demand, so the
§12 invariant is preserved intact — the phrasing was tightened everywhere to "no unattended writer *to
`main`*", which a local-file-only daemon does not breach.

**LW1 (pipeline-only, no APP_VERSION bump):**
- The reconstruction core is extracted from `sync-fills.mjs`'s `main()` into an exported, git-free
  `regenerate({ write, logDir, repoDir })` — reads exchange-logger + `coffer-manual.log` +
  `mobile-fills.log`, merges with `fills.json`, reconstructs, writes `fills.json`/`positions.json`/
  `offers.json` (each only on a real content change). `main()` sits behind the standard
  `import.meta.url === pathToFileURL(argv[1])` invocation guard, so importing `regenerate()` triggers
  no sync and **no git**. New `sync-fills.mjs --local` runs it with zero git; the attended no-flag path
  is byte-identical to before plus `offers.json` in its commit set. `--local` deliberately does **not**
  fold un-pulled phone writes — that needs the attended sync's fetch/ff (acceptable: local mode serves
  the person at the PC).
- New **tracked root `offers.json`** — a dumb flat snapshot of the live GE offer slots (`{slot, side,
  itemId, item, price, qty, filled, lastUpdateTs}`), sourced from `pipeline/lib/offers.mjs`
  (`readOfferRows` → `offersSnapshot`, names resolved offline/best-effort from the mapping cache).
  EMPTY/terminal/cancelled slots excluded. It closes the gap `positions.json` (booked fills only) can't
  see: committed capital sitting in open offers.
- **`pipeline/watch-log.mjs` + `watch-log.cmd`** — the daemon: `fs.watch` on the exchange-logger
  **directory** (catches rotation; `coffer-manual.log` is a sibling there, so manual edits fire the
  same watcher — no second watch), ~10s debounce to absorb Windows' rename/duplicate bursts, then
  `regenerate()` **in-process** (same core as `--local` — no second pipeline copy to drift). Manual
  start, dies with the terminal, **no Task Scheduler** — that's the point.
- Tests (auto-discovered): `sync-fills.test.mjs` guards that `regenerate()` does zero git; `offersSnapshot`
  cases added to `pipeline/lib/offers.test.mjs`. 11 suites green.

**LW2 (deployed-app change, APP_VERSION 0.47.0 → 0.48.0):** on localhost (`IS_LOCALHOST` in
`js/state.js`) the app polls `positions.json` + `offers.json` every ~30s, compares `generatedAt`, and
on a change re-runs the **existing M1 `syncFills()` merge** (no second merge path) and stashes offers on
`STATE.offers`/`STATE.offersTs` (data home for the future Watch tab). It renders a compact "book synced
hh:mm · N open offers" stamp (local time, stale-colored past ~10 min) **instead of** the M1 banner +
Refresh button — never double-banner. On `bensumm.github.io` `IS_LOCALHOST` is false and behavior is
byte-identical to 0.47.0. With the daemon running, a fill/cancel/reprice reflects in the desk app within
~40s (debounce + poll), no keystrokes, zero new git commits. Full design: `FILLS-PIPELINE.md` §14.

### Finder full-catalog search + Signals badge count (0.46.0, PLAN chunk FX1)
Two verified UI bugs. (1) **"Soul rune" was unsearchable** — `buildItems()` excludes anything
with `l.high < MIN_PRICE` (1000gp) from `STATE.ITEMS` to keep browse-mode noise out, but Finder
search only filtered `STATE.ITEMS`, so sub-1000gp items could never be found even though search
deliberately bypasses the browse gates. Fixed at the search layer (NOT by dropping `MIN_PRICE`):
when a query is active, `currentFinderRows` unions in catalog matches via the existing off-screen
`rawItem` path for ids not in `STATE.ITEMS` (needs a live price to quote). Those rows carry
`offscreen:true` and lack `rate`/`score`/`fill`/`turn`; the renderer prints `—` for the grade and
rating-bar cells (fmt/fmtP/fmtTurn already null-safe) with a "below the browse price floor" title.
The quote button and star both work on them (they key off id; `resolveId`/`toggleWatch` already
handle catalog items). Browse view (no query) is byte-identical — verified in chromium. (2) The
**Signals badge read 0 with rows present**: `#sigBadge` showed only `firing` (rows whose BUY
signal fires now), which misreads as "tab is empty". It now shows `firing/total` (e.g. `0/6`),
plain `0` when there are no signal rows at all.

### Push-notification trigger engine (PLAN chunk N1 — pipeline + docs only, no APP_VERSION bump)
Design-first: the delivery mechanism decision ships as a committed doc section
(`pipeline/MONITORING.md` "Push notifications on market events") and the trigger ENGINE ships
as `pipeline/alerts.mjs` — **delivery-agnostic**, it only DETECTS and EMITS. Three trigger
classes: (1) POSITION — a held item's `momVerdict()` escalates to CUT/CUT-CANDIDATE or Momentum
`↓↓`, verdict from the shared gate tree (never re-derived); (2) FILL — a resting offer
completed, from the exchange log via `offers.mjs` (same source as `monitor.mjs`); (3) PRICE — a
live mid crosses a named alert in the tracked repo-root `alerts.json`. **Transition-only**:
fires on a state CHANGE vs the last run (a small gitignored `pipeline/.alerts-state.json`),
never on a level — first run seeds, an unchanged second run emits nothing, a persistent breach
doesn't re-buzz. Named constants `ALERT_COOLDOWN_MIN=60` (anti-flap, position/price only),
`FILL_WINDOW_MIN=60`, `FILL_DEDUPE_TTL_MIN=720`. **Quiet hours** (S2's `isOvernightNow()`,
22:00–06:00 local) suppress position/price alerts and preserve the transition so it re-fires
after 06:00 — **fills are exempt** (a completed trade always buzzes). Structured JSON + human
line on stdout, diagnostics on stderr (empty stdout = nothing fired). Delivery is **decided
after a live trial of option (a)** — a scheduled Claude Code session using the harness
`PushNotification` tool (zero new infra); (b) ntfy.sh from Task Scheduler and (c) Actions+email
are the fallbacks. No app changes; no new scheduled task/Action/topic created in this chunk.

### Mobile parity — GitHub-as-backend writes (0.39.0, PLAN chunk M1)
A phone trade now lands in the same pipeline as a PC trade, and fix-at-the-source stays intact
— the phone writes a *source log line*, never `fills.json`/`positions.json`. Four pieces:

**Pipeline multi-writer path (`sync-fills.mjs`).** Finishes B1: `syncMainToRemote()` is now
rebase-or-abort. Two writers touch `origin/main` — this PC sync (fills/positions/screen/
suggestions) and the phone (`mobile-fills.log`, via the GitHub contents API) — with **disjoint**
file sets, so a phone push only ever moves `origin/main` *ahead*. The guard fast-forwards local
main onto the moved remote BEFORE reading logs (so the phone's line is read this run) and lands a
**fresh commit** on top (never amend/force over the phone's commit; the scheduler-era `--auto`
amend path was later excised in chunk X2, §12). A genuine **divergence** now **aborts loudly (exit 1)** instead of
warn-and-continue — under the single-writer contract it's a structural bug to reconcile by hand,
not to force through. `main()` reads repo-root `mobile-fills.log` as an extra source (it is NOT in
`LOG_DIR`); slot 9 keeps mobile provenance distinct from desktop/CLI slot-8 manuals; the PC only
READS it (stays out of the PC's commit set). Validated with a bare-repo fixture (ff-then-fresh-
commit reads the mobile line into positions.json with the phone commit preserved; divergence aborts).

**New tracked `mobile-fills.log`** (repo root, comment-header only) — same line vocabulary as
`coffer-manual.log` (BOUGHT/SOLD/WITHDRAWN/BANKED + `{"state":"REMOVE","target":…}` tombstones).

**App write path + quick-add (`js/github.js` new, `js/ui.js`, `js/fillslog.js`).** Settings gains a
**GitHub sync** panel storing a fine-grained PAT in localStorage — never rendered back, never
exported (`backup.js` doesn't touch it), never logged (`logEvent 'action'` says "PAT updated"
only). owner/repo derive from the Pages origin (no account name hardcoded; localStorage overrides
for custom hosts/testing). The existing Ledger quick-add now routes its write: desktop File System
Access (slot 8) when the log is linked, else the mobile GitHub path (slot 9) when a token is saved
— GET sha → PUT append; on 409/422 re-GET and retry. Backdated entries still carry the true trade
time (the phantom-5-bludgeons rule); WITHDRAWN is a form mode and REMOVE is exposed via pending-row
delete (mobile edit/delete = append tombstone(+new line), routed by an `origin:'gh'` tag). A dedupe
guard warns on an identical item+side+price+qty just staged. Narrow-screen CSS enlarges tap targets
(16px inputs to avoid iOS zoom).

**Freshness UX (`js/ui.js`).** Since G1 there's no scheduled PC writer, so the phone's PRIMARY
freshness mechanism is here: a `generatedAt` staleness banner on the Ledger (with age + a
**Refresh-positions** button — a same-origin re-fetch; it can't regenerate positions.json, which
needs the PC's RuneLite log) and a staleness chip on the Coffer. Mobile-entered lines still render
immediately as `pending` rows, absorbed on the next `positions.json`. Folds in the S3 **watchlist
write-back**: add/remove now persists to repo `watchlist.json` through the same contents-API path
when a token is set (best-effort; the in-memory union still applies without one).

Validation: `node --check` all touched modules; a Playwright (Edge channel) smoke over http drove
the PAT-save UI, the real quick-add form submit → intercepted GitHub GET→PUT (slot-9 BOUGHT line,
correct branch/sha/base64 body) → optimistic pending row, the watchlist-write shape, and the
Refresh-positions re-fetch + banner. The GitHub write path can't be fully exercised without a real
PAT, so the network call was intercepted with a fake token and the request shape asserted.

### Action logging pass (0.38.0, PLAN chunk L1)
Instrument, don't rebuild: the `logEvent(level, scope, msg)` ring + persisted `logring` + Logs
view already existed (`js/state.js`), but every caller was a *system* fetch path (market/guide/
storage/fills). L1 adds a new `'action'` scope and logs the user's own actions, one line each,
each including the object of the action and no PII (item names/ids/prices only). Instrumented at
the **event handler**, never inside shared functions (`switchTab`/`loadAll` also run on
init/programmatic paths we don't log), so a passive re-render never emits a log: tab-bar clicks,
manual price refresh + Finder retry, scan refresh, watchlist add/remove, quote-expander opens,
trade log/hide/delete + pending-row and manual-log edit/delete, Trends open (item + source:
`link` for a deep-link, `manual` for a typed lookup — logged once at the single `runTrends`
funnel), position review (with a verdict tally — `renderPositionCard` now returns `{html,
verdict}` so the one caller can count them), backup export/import, and the bankroll/slots/strategy
settings. `LOG_MAX` 50→200 to hold the extra volume. The Logs view gains a minimal **All /
Actions / System** scope filter (`STATE.logFilter`, `logRowsHtml(withDate, filter)`,
`setLogFilter`); the status-banner dropdown always shows All. Settings note: no secret is ever
logged (the PAT M1 will add would log "PAT updated" only — value never).

### Screening economics + posture + watchlist-always-scanned (0.37.0, PLAN chunks S1/S2/S3)
S1: the liquidity gate gains a **gp-flow alternative path** — an item passes on `limitVol ≥
--floor` (50/d, unchanged) OR `limitVol × mid ≥ --gp-floor` (250m default), so an Avernic-class
big ticket (single-digit units/day, hundreds of millions of real two-sided gp flow) finally
surfaces, marked `thin: true` with a grade cap at A- and a "size in units, expect slow fills"
tooltip. Thin qualifiers are held OUT of the main ranking in a bounded `--thin-reserve` (6/niche,
ranked by real gp-flow) because their thinly-traded wide bands inflate `expGpDay`. ROI gate gets
an absolute-gp alternative for thin items (`--min-net-gp`, 100k/u); the band-activity gate
relaxes to 1 traded window for them. The **500k gp/day attention floor** moved from a `/scan`
post-filter to the structural `--min-gpd` flag, applied pre-rating (thin + held/asked exempt) —
it visibly tightens every niche (churn ~2 rated, spread ~4). S1.3 (dropping the spread niche)
deferred pending a few days of `--mode all` publishes. S2: `--posture overnight|active|auto`
(auto = local clock, 22:00–06:00 named constants); overnight = flat/rising confident-band only,
patient band-edge pricing, net-edge-weighted ranking, plus an `overnightStaleRisk` exclusion
built on the shipped `diurnalRead` basis (yesterday's overnight window printing below the
current bid); 4 posture fixtures in `quotecore.test.mjs`; published `screen.json` records the
posture in `params` and the app Scan banner shows it. S3: tracked repo-root **`watchlist.json`**;
the app unions it into `STATE.watchlist` (in-memory; write-back is M1); every screen appends a
gate-exempt **Watchlist** section with exclusion reasons as notes — falling watchlist items ARE
shown with the falling warning (extends the held/asked exception). Version note: the S-lane
authored this as 0.36.0 in parallel with Q1; renumbered to 0.37.0 at merge.

### Gate-0 feed-inversion reliability fix (0.36.0, PLAN chunk Q1)
A feed-inverted row — a crossed live feed, where the instasell (`latest.low`) prints *above*
the instabuy (`latest.high`) — used to reach `momVerdict()` with `reliable:true`/`ordered:false`
(the band was dense/fresh/two-sided, so nothing in the reliability chain caught it) and print a
decisive verdict off a non-price. Live case (2026-07-04): a row footnoted "⚠ feed inversion —
quote basis unreliable" still printed **CUT-CANDIDATE**. Fix folds inversion into the SINGLE
reliability source: `computeQuote` now sets `reliableReason='feed-inversion'` (→ `reliable:false`)
when `quickBuy>quickSell`, so every consumer that checks `row.reliable` (momVerdict's Gate 0,
`watch.mjs`'s `mom==='breakdown' && reliable`, `quote.mjs`'s classify) treats it as unreliable —
not just one path. `momVerdict()`'s Gate 0 also re-checks `row.ordered===false` at the decision
point as belt-and-suspenders. Result: an inverted feed prints **NO-READ** (Gate 0), never a
decisive verdict. New acceptance fixture in `pipeline/quotecore.test.mjs`; the 8 pre-existing
verdicts (incl. the bludgeon-cut regression guard) stay byte-identical. The `/positions` skill's
interim NO-READ-equivalent override is removed (the script now emits NO-READ itself), and the
CLAUDE.md Q1 followup + MONITORING.md Gate 0 reason list are reconciled.

### Self-improving skills (2026-07-04, PLAN-5 K1, no `APP_VERSION` bump)
Each workflow skill (`/positions` `/scan` `/overnight` `/morning`) gained a closing
**"Encode learnings"** section: capture what a run taught, but only AFTER the actionable
output is delivered and Ben's offers are placed/adjusted (his explicit rule — never
interleave doc edits with live market work). At that point ask one short question
("anything from this run worth encoding?"), route each fact to ONE canonical home
(move-never-copy: judgment-layer lessons → the owning SKILL.md + `version:` bump;
table/app contracts → CLAUDE.md; user preferences → Claude memory; monitoring doctrine →
`MONITORING.md`), and spawn a background subagent to make the edits + commit so the main
conversation keeps flowing. Honesty guard (process rule 4): process learnings encode
freely; a *market* claim (a new threshold, a pattern) still needs the usual evidence
standard — one session is one sample.

### `/overnight` v1.1 — fill-realism check (2026-07-04)
The first real overnight run filled 0/50,000 units — band-floor bids are extreme prints
nobody crosses down to during quiet hours, and the accumulation formula is an upper bound
that assumes fills at your price. The skill now requires a fill-realism read (price between
band floor and instasell for must-fill bids; count recent 5m windows at/below the bid) and
"up to" framing. (v1.2 made this measured, not guessed, via `nightlows.mjs`.)

### Project skills + CLAUDE.md slimming (2026-07-04, PLAN-5, no `APP_VERSION` bump)
Four committed skills — `/positions` (gate-tree verdict interpretation,
incidental-inventory filter, feed-inversion reliability override, action plan + interactive
tail), `/scan` (judgment pass over `screen.mjs` incl. the 500k gp/d floor), `/overnight`
(two-phase composer: `/positions` → pause for capital → `/scan` + 8h accumulation sizing
`min(limit×2, 8/24×0.10×volDay)`), `/morning` (overnight reconstruction, re-verdict stale
bids) — at `.claude/skills/*/SKILL.md`. `quote.mjs` regime lines now print the buy limit
(chunk 3a). Per-workflow doctrine *moved* out of CLAUDE.md into the skills.
**Skill-versioning convention:** skills-only changes bump the SKILL.md `version:`
frontmatter and get a one-line pointer in CLAUDE.md — they NEVER bump `APP_VERSION` (that
marks the deployed app, which skills never touch).

### Underwater-at-tick triage — the five-way read + gated decision tree (0.33.0, PLAN-3)
`momVerdict()` in `js/quotecore.js` is now the whole underwater gate tree, not just the Mom
cut-trigger. `computeQuote` exposes `reliable`/`reliableReason`/`quoteAgeMin` (Gate 0 — a
stale/one-sided/sparse quote is unreliable; the old `instabuy==null → CUT` bug is fixed to
**NO-READ**). New pure, fixture-tested helpers: `diurnalRead` (Gate 1 — quiet-hour trough
that dipped+recovered ~24h ago → **DIURNAL-WATCH**, spent statelessly once the window turns
liquid), `moveShape` (Gate 2 — small-lot volume-spike **shock** that stabilized →
**SHOCK-WATCH**, vs a **bleed** → cut), `underwaterHours` (D-escalation — underwater
*through a liquid window* → **CUT-CANDIDATE**, ending the flat-regime WATCH-forever case).
Every gate defers only on positive evidence, so the bludgeon-style real breakdown cuts
byte-identically (regression-guarded). Wired into all three consumers (`watch.mjs`,
`quote.mjs --positions`, `reviewPositions`) + the `classify()` breakdown route
reliability-gated. Acceptance fixtures: `pipeline/quotecore.test.mjs`
(`node pipeline/quotecore.test.mjs`). Docs: `MONITORING.md` step 4 is the tree; the
24h-cycle guard is unchanged but reframed as **input** (Gate 0/1: is this a price?) vs
**decision** (the guard: is there a proven daily rhythm?).

### Last-2h momentum tell — `Mom` column + cut-trigger (0.30.0)
The chunk-2 standard quote table (0.28.0) CLAMPS the optimistic prices against the live
quote (`optBuy=min(quickBuy, bandLo)`, `optSell=max(quickSell, bandHi)`) — correct for
*pricing*, but that clamp alone was **incomplete**: it ANNIHILATED the momentum signal (a
live-outside-its-own-2h-band break can never appear once clamped). Fix: `computeQuote` now
derives `mom ∈ {clean,breakdown,breakup}` from the **pre-clamp** raw band comparison
(`quickBuy<rawBandLo` ↓ / `quickSell>rawBandHi` ↑) and exposes it; the price clamp is
unchanged. `Mom` (clean / ↓ / ↑) renders in the dig-in views only (Trends card, Finder
**expander**, position review, `quote.mjs`/`screen.mjs`) — NOT the Finder bulk list
(deliberate; `market.js` untouched). Held-position cut-trigger: shared `momVerdict()` in
`js/quotecore.js` (used by both `reviewPositions` and `quote.mjs --positions`) —
↓+underwater → CUT; ↓+in-profit+flat/falling → LIST-TO-CLEAR; ↓+in-profit+rising →
size-conditional on `BIG_TICKET_GP` (10m total lot value: ≥ → clear, < → HOLD-watch); ↑ →
HOLD/list at 2h top. The base-mixing bug is guarded separately by `quoteOrdered()`, not the
clamp. **(0.33.0: this ↓/↑ matrix is now the Gate-2 leaf of the PLAN-3 underwater gate tree
— `momVerdict` additionally returns NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT-CANDIDATE
ahead of it; see the 0.33.0 entry above.)**

### Live position monitor + deterioration-watch routine (2026-07-02)
`pipeline/monitor.mjs` (read-only — live offers/fills from the exchange log + held
positions with break-even from `positions.json`, *not* a log re-sum) drives a polling
routine documented in `pipeline/MONITORING.md`: a verdict per held position, break-even =
`ceil(buy/0.98)`, with an **evidence-gated 24h-cycle guard** (daily cycles are usually
noise → default to cutting a genuinely falling position; only a *proven* backtested
hour-of-day pattern defers a cut). The underwater verdict became the **PLAN-3 gate tree**
(0.33.0 — `MONITORING.md` step 4; the 24h-cycle guard is unchanged, now framed as
input-vs-decision). Session/agent-run for now; the durable app-native home is the
Refresh-positions + Ledger break-even/regime followups.

### Falling items → price to clear (0.20.0)
Ben's rule — for a falling item the suggested prices must reflect the fall: buy low
aggressively, price to sell quickly. This **superseded** the 0.19.0 "HOLD — cut if slow /
list high above market" nuance, which misfired: in a decline the recent highs are *always*
above the current price, so the old `patientUpside` guard was ~always true and told you to
list above a dropping market (the Dragon nails case, found live). Now `renderPositionCard`
collapses the falling branches → always list at the instabuy (in profit → SELL to clear;
underwater → CUT), never above it. `patientTargets` is trend-aware (see the Trends tab
header comment in `js/trends.js`) and the plan card's pricing copy branches on `PT.falling`.

### Position review workflow (0.19.0)
"Review pricing" on the Ledger → `reviewPositions()` in `js/trends.js` renders a HOLD /
ADJUST / CUT verdict + "list at X" price per open lot.

### Ledger auto-populate from fills (0.18.0)
`syncFills()` in `js/ui.js` fetches `positions.json` and merges pipeline-reconstructed real
trades into the Ledger/Coffer (`src:'fills'`, idempotent rebuild, tombstoned via
`STATE.fillsHidden`).

### Finder rating rework (0.17.0)
`computeScores()` in `js/market.js` blends four 0..1 sub-scores (ROI, liquidity, stability,
turnaround) into a `quality` dampener on profit/hr; per-factor tooltip on the Risk grade +
Rating bar.
