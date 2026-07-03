# PLAN — manual-fill single-sourcing, in-app market tables, analysis scripts, tech-debt

Written 2026-07-03. Intended executor: **Opus 4.8** in Claude Code, chunk by chunk, in order.

## Executor rules (read first)
- Read `CLAUDE.md` fully before starting; its process rules apply on top of this plan.
- Each chunk ends with: `node --check` on every touched `js/*.js` / `pipeline/*.mjs`; a real
  browser or Playwright smoke test for any app-facing change (`serve.cmd`, ES modules don't
  load over `file://`); `APP_VERSION` bump in `js/state.js` (one bump per shipped chunk); a
  git commit with a descriptive message, then push.
- Repo is public — no PII in any tracked file or commit message.
- NEVER edit RuneLite's own `~/.runelite/exchange-logger/exchange.log`. The writable source
  is the sibling `coffer-manual.log` in the same dir.
- `positions.json` / `fills.json` are pipeline outputs — only `sync-fills.mjs` writes them.
- If you discover unrelated debt while working, append it to "Discovered" at the bottom of
  this file — do not fix drive-by.

## Context — the motivating incident (2026-07-03)
A manual fill (3× Abyssal bludgeon @ 18,052,000, a mobile trade the desktop logger never saw)
was injected into `coffer-manual.log` with a **"now" timestamp instead of when the trade
actually happened**. FIFO matching in `sync-fills.mjs` is timestamp-ordered, so sells that in
reality consumed those units matched other lots → phantom open inventory (5 shown vs 3 real).
Fixing the log line then exposed a second gap: `fills.json` is an **append-only merged
archive** — the stale event persisted after the source was corrected and had to be hand-purged
by event id. Separately, manual ledger entries currently have **two persistence paths**
(browser-local `STATE.trades` vs `coffer-manual.log` via FS API / CLI) — two sources of truth.
Ben's decision: **the log is the only source of truth for manual entries**. Chunks 1 fixes all
three structurally.

---

## Chunk 1 — Manual fills: log-only single source of truth

### 1.1 Remove the browser-local manual-trade path
In `js/ui.js` `addTrade`: delete the unlinked fallback that writes local trades (`sellLocal`
and the local buy `STATE.trades.push`). If the fills log is not linked (or FS API unsupported),
show a message in `#fillsLogStatus` directing to "Link fills log…" or
`pipeline/add-manual-fill.mjs` — create nothing. Keep the `STATE.fillsPending` optimistic
overlay exactly as is (write line → pending row → next sync absorbs it).
Delete now-dead code: `sellLocal`, the manual FIFO-close branch, `editTrade` (prompt-based),
and the `isF` special-casing in `openActions`/`closedActions` that existed only to
distinguish manual rows. All ledger rows are now fills-derived or pending.

### 1.2 Trade-time field (the timestamp lesson)
Add an optional "when" input (`datetime-local`, default = now) to the ledger form in
`index.html`; pass it through `writeToFillsLog` → `fillsLogLine({ts})` (already supported).
Help text: "backdated trades must carry the real trade time — FIFO depends on it."

### 1.3 Edit/delete manual lines = log rewrite through the file handle
On a **pending** row: Edit rewrites the matching line in `coffer-manual.log` (exact
serialized-string match via the stored `FileSystemFileHandle`; read → replace → truncate-write,
same pattern as `appendFillsLog`; fail loudly if the line isn't found) and updates the pending
row. Delete removes the line + the pending row. For **already-synced** manual rows (slot 8 in
`positions.json` events): Edit rewrites the source line AND appends a tombstone (1.4) for the
old event id, then tells the user "re-sync to apply" (or trigger `syncFills()` re-fetch).

### 1.4 Tombstones in the pipeline
`sync-fills.mjs`: support a removal line in any ingested log:
`{"state":"REMOVE","target":"<eventId>"}`. During merge, a REMOVE deletes the matching event
id from the merged set **including events already persisted in `fills.json`** — this is the
mechanism that makes source-level corrections propagate without hand-editing `fills.json`.
`js/fillslog.js` gains `tombstoneLine(eventId)`; the app computes eventId the same way
`sync-fills.mjs` does (sha1 content hash — extract that hashing into a tiny shared helper or
duplicate the exact algorithm with a cross-reference comment). CLI: `add-manual-fill.mjs
--remove <eventId>`. Document in `pipeline/FILLS-PIPELINE.md` §5.1.

### 1.5 WITHDRAWN event (inventory taken for personal use)
New manual line `state:"WITHDRAWN"` (slot 8): qty leaves open inventory, **no sale**.
`matchTrades` consumes open lots FIFO into a closed lot flagged `withdrawn:true`, realised 0,
excluded from profit sums and the Coffer's realised tile. App renders "withdrawn (used)"
distinctly in the closed table. CLI: `--type withdraw` (no `--price` needed; price 0). App: a
third option in the ledger form's type toggle. Motivating case: Ben pulled 1 bludgeon to use
on 2026-07-03 — the ledger currently has no honest way to record that.

### 1.6 BANKED event (pre-existing inventory enters the flip flow)
Case discovered 2026-07-03: Ben lists an item he already owned (bank/drop — never bought via
a logged GE offer). Without a buy record, FIFO wrongly matches its eventual sale against some
OTHER open bought lot, corrupting both P/L attribution and open counts. New manual line
`state:"BANKED"` (slot 8): qty enters open inventory at a declared basis. Convention: basis =
market instasell at the time it was committed to flipping (so realised P/L measures the
flipping decision), with `banked:true` carried onto the lot/closed trade so it's
distinguishable from cash-out-of-pocket. Basis 0 allowed (windfall accounting). CLI:
`--type banked --price <basis>`. App: fourth option in the ledger form type toggle.
Timestamp = when it was listed/committed, same FIFO-correctness rule as 1.2.

### 1.7 Purge legacy browser-local manual trades
Chunk 1 removes the *path*, but existing local manual entries persist in `STATE.trades`
(IndexedDB). On upgrade: one-time migration that surfaces surviving non-`src:'fills'` trades
with a "these are local-only, pre-0.27 manual entries — re-inject via the log or delete"
banner + per-row actions. (Real instance: 3 manually-added bludgeon sells from the 0.24–0.25
iteration still live in Ben's browser and double-display against pipeline rows.)

### Acceptance
`node --check` all touched; Playwright: linked add → pending row appears, unlinked add →
guidance + no state change; pipeline fixture test — create a temp dir with a small fake
exchange log + coffer-manual.log incl. a REMOVE and a WITHDRAWN, run `sync-fills.mjs --dry`
pointed at it (add a `--log-dir` override flag if none exists), assert open/closed/tombstone
behavior. Bump `APP_VERSION` → 0.27.0.
Commit: `manual fills: log-only single source, tombstones, WITHDRAWN (0.27.0)`.

---

## Chunk 2 — Standard market table in the app (Finder + Trends)

### The canonical format (identical everywhere, incl. chunk-3 scripts)
| Item | Guide | Mid | Buy@ Quick / Opt | Sell@ Quick / Opt | Net/u Quick / Opt (ROI) | Vol/d | Regime |

- **Quick** = transact now: buy at live instasell (`latest.low`), sell at live instabuy
  (`latest.high`).
- **Optimistic** = patient 2h-band edges: min(`avgLowPrice`) / max(`avgHighPrice`) over the
  last 24×5m timeseries points. Single shared basis ⇒ **optBuy ≤ quickBuy ≤ quickSell ≤
  optSell always** — if that ordering ever breaks, bases got mixed (this exact bug shipped in
  an analysis on 2026-07-03 by mixing 24h percentiles with live quotes; don't reintroduce it).
- **Guide** = the GE guide price from the app's existing guide feed in `market.js` — NEVER the
  wiki mapping `value` field (that's base/alch value, e.g. bludgeon "260k").
- **Net/u** after 2% GE tax (floored per item, 5m cap — use the shared tax helper).
- **Vol/d** = limiting side: `min(highPriceVolume, lowPriceVolume)` from the 24h endpoint.
- **Regime** = `regimeDrift` (recent-3d median vs prior ~2wk on 6h series) + label
  flat/rising/falling.
- **Falling-regime items are excluded from any screen/list output entirely** — not shown, not
  mentioned. Exception: an item Ben explicitly asks about or already holds is always shown,
  with falling state + price-to-clear guidance (the 0.20.0 rule).

### 2.1 `js/quotecore.js` (new, DOM-free) + `js/quote.js`
`quotecore.js`: pure functions — `computeQuote({latest, ts5m, ts6h, vol24, guide, limit})` →
the full row model; move/extract `regimeDrift` here so Trends and quotes share one impl;
re-export or import the tax helper. Must be importable by both browser and node (plain ESM,
no DOM/window). `quote.js`: `fetchQuote(id)` orchestrator using `market.js`'s fetch layer +
User-Agent.

### 2.2 Trends
The suggested-plan card (`#trSuggest`) renders the standard table for the loaded item above
the existing copy. Keep `patientTargets` trend-aware behavior; for a falling item the
Optimistic sell caps at instabuy (price to clear).

### 2.3 Finder
Per-row on-demand "quote" expander: click fetches that ONE item's series and renders the
table (no bulk fetching — rate limits). No always-on new columns.

### 2.4 Position review
`reviewPositions` cards include the same columns for consistency.

### Acceptance
Playwright screenshot of Trends table + Finder expander; ordering invariant asserted in a
quick node test of `computeQuote` with fixture data. `APP_VERSION` → 0.28.0.
Commit: `quotes: standard Quick/Optimistic market table in Finder+Trends (0.28.0)`.

---

## Chunk 3 — Analysis scripts (session token efficiency)

Goal: a Claude session runs ONE command and gets the finished table — no ad-hoc `node -e`
fetch scripts ever again.

### 3.1 `pipeline/quote.mjs <item-or-id> [...more]`
Resolves names via the mapping cache pattern from `add-manual-fill.mjs`
(`pipeline/mapping.cache.json`, 24h TTL); fetches latest/5m/6h/24h/guide; prints the standard
markdown table + one regime line per item. Imports `js/quotecore.js`. Compact: ≤3 lines per
item.

### 3.2 `pipeline/screen.mjs [--floor 50] [--min-roi 1.5] [--max-price 45m] [--top 40]`
Full opportunity screen: two-sided gate (both 24h vols > 0, limiting side ≥ floor), rank by
liquidity value, fetch 1h series for top-N only, band + regime per survivor. Output = standard
table grouped **Tier A** (stable regime) / **Tier B** (recently repriced/volatile — size
small). Falling items silently excluded. Cache mapping + 24h response (short TTL, e.g. 10 min)
in `pipeline/.cache/` (gitignore it).

### 3.3 `pipeline/quote.mjs --positions` (check market vs GE positions — the common ask)
"Check current market against my open positions" is a recurring request, so it gets a
first-class mode rather than an ad-hoc loop. `--positions` (no item args) reads the OPEN lots
from repo-root `positions.json`, groups by itemId at weighted-avg cost, quotes each held item
live, and prints the **standard table with two extra held-position columns**: `Held@ (avg
cost)` and `Break-even` (`ceil(avgCost/0.98)`), plus a per-row verdict (HOLD / list-at-X /
CUT) reusing the trend logic. Falling held items are ALWAYS shown here (the held/asked
exception), with price-to-clear guidance. Imports `js/quotecore.js`; same fetch/cache path as
3.1. This is the canonical answer to "how are my positions doing vs the market."

### 3.4 CLAUDE.md workflow wiring
Update the "Market analysis workflow" section so the gating is removed once these ship and the
three canonical asks map to exact commands: per-item read → `quote.mjs <item>`; opportunity
screen → `screen.mjs`; **positions-vs-market → `quote.mjs --positions`**. State plainly: never
hand-write `node -e` fetch scripts for a market read; these scripts ARE the workflow.

### Acceptance
Run all three modes live; verify ordering invariant, tier grouping, no falling items in the
screen (but held fallers DO show under `--positions`), break-even column correct against a
known lot. No APP_VERSION bump needed if `js/` untouched beyond quotecore (shipped in chunk 2).
Commit: `analysis: quote.mjs (+--positions) + screen.mjs standard-table scripts`.

---

## Chunk 4 — Tech-debt pass (priority order)

4.1 **Dedupe tax/break-even helpers**: `format.js` vs private copies in `sync-fills.mjs`,
    `add-manual-fill.mjs`, `monitor.mjs` → all import from `js/quotecore.js` (node-importable).
4.2 **Dead-code sweep** post-chunk-1: orphaned functions/branches in `ui.js`, unused exports,
    orphan `styles.css` selectors (check old ledger-form/manual-row classes).
4.3 **Docs truth pass**: README file inventory (new files: quotecore.js, quote.js, quote.mjs,
    screen.mjs); `FILLS-PIPELINE.md` §§4.7/5.1/7 (tombstones, WITHDRAWN, log-only manual
    flow); CLAUDE.md "Done" list — collapse pre-0.20 entries to one-liners.
4.4 **Error-path check**: `syncFills()` fetch failure should surface in the status banner,
    not fail silently — verify, fix if needed.
4.5 Work through "Discovered" items appended below by earlier chunks.

Commit per logical group. Bump `APP_VERSION` only if app behavior changes.

---

## Chunk 5 — Bank-visibility tooling (`pipeline/bank.mjs`) — BLOCKED on a real sample

Surfaced 2026-07-03 by a live position check: `positions.json` "open" is **GE-log-derived
inventory only — not the bank**. Ben holds ~3b in bank the pipeline is structurally blind to
(Exchange Logger only ever sees GE offers). He wants full bank truth so (a) net worth tallies
correctly and (b) any flip-target item sitting idle in the bank gets flagged to throw on the GE.

**Capture mechanism (verified):** RuneLite writes no bank file to disk. The **"Data Export"
plugin** (plugin hub) dumps bank contents to clipboard as CSV (item, qty, GE price). Rejected
alternatives: Bank Tags export = item IDs only, no quantities; CsvExport = player/skills, not
bank. It is a **manual point-in-time snapshot** — no auto-sync is possible (the client only
knows bank contents while the bank UI is open). Do NOT Task-Scheduler it like the fills sync; a
keep-pile changes slowly, so manual refresh is acceptable.

**Work item — `pipeline/bank.mjs`:**
1. Parse a pasted Data Export CSV (`pipeline/bank.csv`) → `bank.json` (itemId → qty), the
   ground truth for holdings. Tolerant parser; exact columns pinned from a real sample.
2. Value bank at live prices (reuse chunk-2 `js/quotecore.js` + market fetch layer; guide via
   the app's guide feed). Emit a net-worth tally.
3. Flip-target screen — intersect `bank.json` ∩ `STATE.watchlist` → items worth GE-ing,
   rendered in the **standard market table** (CLAUDE.md "Market analysis workflow" format).
4. Reconcile GE-open vs bank — generalize `pipeline/held-override.json` (currently hand-patches
   one item, crystal seed 23959) into proper bank-truth reconciliation, so `positions.json`
   stops claiming inventory that's actually banked or already sold. Supersedes held-override.json.

**Guardrails:**
- **Do NOT inject bank items into the fill log / `fills.json`.** Bank truth is a *separate
  input*, never fabricated into the append-only trade log — real trades vs. real holdings are
  different sources (this is the same principle behind declining the "edit the log to remove a
  position" request). It reconciles against `positions.json`; it does not write trade events.
- Bank data is item+qty only → no PII, safe for the public repo.
- Document in `pipeline/FILLS-PIPELINE.md`; note it supersedes `held-override.json`.
- Depends on chunk 2's `js/quotecore.js` (shared quote/valuation math) — sequence after it.

**Blocking on Ben:** install Data Export, open bank, paste one real export into
`pipeline/bank.csv`. Nothing to build until that sample lands (parser must be pinned to actual
columns). Until then this stays BLOCKED.

## Chunk 6 — Last-2h momentum tell: `Mom` column + rating input (HIGH PRIORITY)

Requested 2026-07-03 after a live high-value board read. Touches `js/quotecore.js`, `js/market.js`,
`js/ui.js`, `js/trends.js`, `js/quote.js`, `pipeline/quote.mjs`/`screen.mjs`. Bump `APP_VERSION`
(app behavior changes) — likely 0.30.0.

### The insight (and why chunk 2 currently HIDES it)
On ONE consistent basis (live `/latest` + 2h 5m-band), `optBuy ≤ quickBuy ≤ quickSell ≤ optSell`
holds *normally*. A break is one of two things: **inconsistent bases → bug** (the 2026-07-03
percentile-mixing incident) OR **consistent bases → a real-time momentum tell** — live has moved
outside its own 2h band. `quickBuy < optBuy` (live instasell below 2h floor) = **↓ breaking down**;
`quickSell > optSell` (live instabuy above 2h top) = **↑ breaking up**; else **clean/ranging**.
Verified live: Twinflame/Brimstone ↓, Zombie axe ↑, Tome/Buckler clean — matched the independent
2h-drift read exactly. **Problem:** chunk 2's `computeQuote` CLAMPS (`optBuy = min(quickBuy,
bandLo)`, `optSell = max(quickSell, bandHi)`) — correct for *pricing* (never suggest buying above
the live market) but it ANNIHILATES the signal (the break can never appear). Fix is NOT to
un-clamp; compute the flag from the **pre-clamp** raw comparison and keep the clamp for displayed
prices.

### 6.1 `js/quotecore.js` — add the momentum flag to the row model
Compute `rawBandLo`/`rawBandHi` (unclamped 2h edges) and derive `mom ∈ {clean, breakdown,
breakup}`: `breakdown` if `quickBuy < rawBandLo`, `breakup` if `quickSell > rawBandHi`, else
`clean`. KEEP the existing price clamp (pricing correctness) — `mom` is derived *before* it. Expose
`mom` (and optionally a magnitude = fraction outside the band) on the row model. The base-mixing BUG
is prevented separately by a consistency assertion/test (live + band from the same fetch), NOT by
the clamp. Update the ordering test: assert displayed prices still clamp AND that a seeded
below-floor live quote sets `mom==='breakdown'` without breaking the price ordering.

### 6.2 `Mom` column in every standard table
Add `Mom` to `QUOTE_HEADERS`, `quoteCells`, `quoteMarkdown` (quotecore) and the app HTML renderer
(`quote.js` `quoteTableHtml`, Trends `#trSuggest`, position-review cards, Finder expander). Render
`clean` / `↓` / `↑`. **The Buy@/Sell@ Quick/Opt price columns MUST stay** — a hand-written board
this session accidentally dropped them; the scripts/app must never. Since `pipeline/quote.mjs` and
`screen.mjs` build their own `mdTable`, add the `Mom` cell there too (they don't currently use
`quoteMarkdown`) — verify the column renders WITH the price columns in both scripts.

### 6.3 Finder rating factors momentum in (`js/market.js`)
`computeScores()`/`ratingParts()` — a `breakdown` item is penalized (actively pulling back);
`breakup` is neutral-to-slightly-positive. **Data limitation to resolve honestly:** the Finder bulk
table does NOT fetch a per-item 2h 5m series (only live + a guide proxy — see the Trends-tab note in
CLAUDE.md). Real `mom` needs the per-item series. Options, pick and JUSTIFY: (a) apply the mom
penalty only in the on-demand quote expander (where the series is fetched) and leave the bulk rating
on its cheap proxy; (b) a bounded top-N 5m fetch for only the currently-sorted-visible rows; (c) a
cheap proxy for mom from data already in bulk (`/5m` or `/latest` vs `/24h` mid). Do NOT bulk-hammer
`/timeseries` across all items (rate limits). Be explicit about what the rating can and can't see.

### 6.4 Cut-trigger wiring (position review + `--positions`)
A HELD big-ticket position flashing `breakdown` escalates the verdict toward **CUT** even when the
multi-day regime hasn't flipped yet — the tell fires *before* the lagging regime confirms (the
bludgeon-exit lesson; ties to the `opportunity-cost-can-beat-patient-hold` memory). Wire `mom` into
the HOLD/list-at/CUT verdict logic in `reviewPositions` and `quote.mjs --positions`.

### 6.5 Docs
CLAUDE.md "Market analysis workflow" wording + `Mom` column already updated (2026-07-03 doc commit).
Keep the memory `analysis-output-table-format` in sync. Note in the chunk-2 "Done" entry that the
clamp alone was incomplete — it needed the pre-clamp flag to preserve the signal.

### Acceptance
`mom` matches an independent 2h-drift read on a live board; price ordering still clamps; `Mom`
column renders in app tables AND both scripts WITH the price columns intact; Finder rating shifts on
a breakdown item; a held breakdown position escalates toward CUT. Playwright + live script runs.
Commit: `momentum: Mom column + rating input + cut-trigger (0.30.0)`.

## Out of scope (tracked separately in CLAUDE.md)
- Refresh-positions button; Ledger redesign (watchlist filter / grouping / period P&L);
  realized-vs-suggested calibration.

## Discovered
(appended during execution — severity + one-line description)
- **[done] low** — `sync-fills.mjs` counted `parsedLines` but never reported it. Folded into the summary line (`N lines (M valid trade line(s)), K events after sequencing`) in chunk 4.2.
- **[done] low** — guide dump fetch (`chisel.weirdgloop.org`) fails CORS on a localhost dev server every run. Investigated (chunk 4.5): the *browser's own* CORS console error can't be suppressed from JS, and our own log for the failure is already `info`-level (`market.js` loadGuide catch), not `error`, so it never reaches the status banner or reads as a real failure. No safe change available; left as-is.
- **low** — `STATE.fillsPending` rows persisted before 0.27 lack the stored `line` field, so their Edit/Delete degrades to a "fix by hand" message; self-heals once the next sync absorbs them. (Left per chunk 4.5 — trivial self-heal, not worth migration code.)
- **[done] med (UX)** — a freshly-logged manual entry for a NON-watchlisted item was swallowed by the "Watchlist only" ledger filter (`renderLedger` filtered `fillsPending` by `ledgerWatchOnly`). Fixed in chunk 4.5: pending rows now ALWAYS render regardless of the watch filter (the simplest correct fix — a pending row is the user's just-taken action). Verified with headless Edge/Playwright: seeded a pending buy for a non-watchlisted item with watch-only ON → row renders.
- **[done] note** — the app's "Link fills log…" could produce `coffer-manual.log.txt` on create-new. Added a doc note in `FILLS-PIPELINE.md` §7 to always pick the existing `coffer-manual.log` (the picker is `showOpenFilePicker`, so no `suggestedName` applies — doc note is the right-sized fix).
- **[done] med** — `add-manual-fill.mjs` / `monitor.mjs` `loadNames()` assumed the flat `{id:name}` `mapping.cache.json` shape, but chunk 3's `marketfetch.mjs` writes the richer `{id:{name,limit}}` shape into the SAME cache file. After any `quote.mjs`/`screen.mjs` run, `add-manual-fill.mjs --item "<name>"` resolution silently broke (name became `[object Object]`). Fixed in chunk 4.5: both `loadNames()` flatten-on-read to tolerate either shape. Verified `--item "Yew logs"` resolves against a rich cache.
- **med** — reconstruction logic is duplicated and has DRIFTED: `sync-fills.mjs` has its own `collapseOffers`/`matchTrades` that handle WITHDRAWN/BANKED manual states, but `pipeline/reconstruct.mjs` (imported by `monitor.mjs`) has an OLDER copy WITHOUT withdraw/banked handling. So `monitor.mjs`'s live held-position count would mis-handle any WITHDRAWN/BANKED manual line. Fix (a later chunk): unify onto one shared reconstruction module — larger refactor, deferred from chunk 4 (4.1 only deduped tax/break-even). Discovered while doing 4.1.
- **low** — `quoteMarkdown` in `js/quotecore.js` is currently unreferenced (the chunk-3 scripts build their own `mdTable` to add extra `--positions` columns). Kept, not removed: it's a documented shared-API helper and chunk 5 (`bank.mjs`, rendered "in the standard market table") is a near-term consumer; removing it now to re-add later is churn.
