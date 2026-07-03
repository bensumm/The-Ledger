# PLAN — The Coffer build plan (2026-07-03)

Executor: **Opus 4.8** in Claude Code, one chunk per session. Read `CLAUDE.md` fully first.

## Executor rules (read first)
- Each chunk ends with: `node --check` every touched `js/*.js` / `pipeline/*.mjs`; a real browser
  or Playwright smoke test for any app-facing change (ES modules don't load over `file://` — use
  `serve.cmd`); `APP_VERSION` bump in `js/state.js` if app behavior changed; a descriptive commit,
  then push. Prefer exact-string edits that fail loudly.
- Repo is public — no PII in any tracked file or commit message.
- NEVER edit RuneLite's own `exchange.log`; the writable source is the sibling `coffer-manual.log`.
- `positions.json` / `fills.json` are pipeline outputs — only `sync-fills.mjs` writes them.
- `git add` only the files you changed (a scheduler auto-commits positions/fills every ~20 min).
- Discover unrelated debt → append to "Discovered" at the bottom; don't fix drive-by.
- **Spec style:** write the rule + one cheap named anchor (e.g. "the bludgeon-exit lesson"). Do NOT
  paste live data (prices, multi-item verification lists) — it rots and misleads a future agent.

## Completed (pointers — full detail in the commit + CLAUDE.md "Done")
- ✅ **Chunk 1** — manual fills log-only: tombstones (`REMOVE`), `WITHDRAWN`/`BANKED` events,
  legacy browser-local purge, trade-time field — `d867afb` (0.27.0)
- ✅ **Chunk 2** — standard Quick/Opt market table + new DOM-free `js/quotecore.js` (+`quote.js`);
  the optimistic-price clamp lives here — `fd586c9` (0.28.0)
- ✅ **Chunk 3** — `pipeline/quote.mjs` (+`--positions`), `screen.mjs`, `marketfetch.mjs` — one
  command → the finished table — `5b586fb`
- ✅ **Chunk 4** — tech-debt: tax/break-even helper dedup, pending-row always-render, `syncFills`
  error banner, docs truth pass — `0febcbe` (0.29.0)
- ✅ **Chunk 6** — `Mom` last-2h momentum column (pre-clamp, dig-in views only) + shared
  `momVerdict()` cut-trigger with `BIG_TICKET_GP` — `c0a1c58` (0.30.0)
- ✅ **Chunk 7** — `pipeline/watch.mjs`: adaptive item-type-aware monitor (6 classes → cadence +
  playbook, `momVerdict` alerts, adverse-selection gating, honest sell-side framing) + `/loop`
  routine in `MONITORING.md` — `319e254`

---

## Chunk 5 — Bank-visibility tooling — DEFERRED (2026-07-03, Ben's call after a cost/benefit look)

Examined and deferred. Bank data is a **manual, always-stale snapshot**: the Data Export plugin
dumps to *clipboard* only while the bank UI is open, and RuneLite writes no bank file → **no
auto-sync possible**. That staleness guts the headline feature — auto-reconciling a stale bank
against the live `positions.json` throws false discrepancies and risks corrupting a currently-correct
file. The cheap wins (net-worth tally, `bank ∩ watchlist` flip-screen) are real but modest, and
`positions.json` (GE flow) is already correct; the bank is a slow-changing keep-pile.

Reconciliation edge cases are already handled without it: a sell of bank stock lands as a flagged
`unmatched` sell (NOT a floating position — the log is append-only so it just persists), and bank
stock committed to flipping gets an honest basis via a `BANKED` entry (chunk 1). The real
"forgotten position" risk (an open lot disposed of OFF the GE) is the `WITHDRAWN` mechanism's job.

**If revisited:** the higher-value design is **one baseline export + GE-log replay = a rolling bank
estimate** (re-export periodically to re-baseline; the drift vs a fresh export IS the forgotten-
position detector) — not a static dump. Guardrail if ever built: bank truth is a *separate input*,
never injected into `fills.json`; advisory-only against `positions.json`, never an auto-mutation.

---

## Chunk 8 — Unify the reconstruction chain (kill the monitor drift) — MEDIUM

**The debt (verified 2026-07-03).** There are TWO full parallel copies of the log→positions
reconstruction: `pipeline/sync-fills.mjs` defines its own `parseJsonLine`/`buildEvents`/
`collapseOffers`/`matchTrades` that **handle `WITHDRAWN`/`BANKED`** (canonical — this is what writes
the correct `positions.json`), while `pipeline/reconstruct.mjs` is an **older, stale copy** whose
`matchTrades`/`parseJsonLine` know only `buy`/`sell`. `pipeline/monitor.mjs` imports the stale
`reconstruct.mjs` → its in-memory held-position count **mis-handles any `WITHDRAWN`/`BANKED` line**
(and those exist now — the bludgeon BANKED/withdraw). `watch.mjs` and `quote.mjs --positions`
sidestep it by reading `positions.json`; `monitor.mjs` is the one live wrong consumer.

**Fix — one module, two consumers.** Make `reconstruct.mjs` the single source of truth:
1. Port `sync-fills.mjs`'s canonical chain (`parseJsonLine` incl. the `WITHDRAW`/`BANK` type
   mapping, `buildEvents` incl. the cancel-inference fallback, `collapseOffers`, `matchTrades` incl.
   the `banked`/`withdraw` branches + banked-aware open-lot keying) into `reconstruct.mjs`, replacing
   its stale versions. Move `eventId` too if it has also diverged (keep the id-hash contract shared
   with the app's `js/fillslog.js` — see chunk 1).
2. Delete `sync-fills.mjs`'s private copies; import them from `reconstruct.mjs`. `monitor.mjs`
   already imports from `reconstruct.mjs`, so it gets the correct behavior for free.
3. First **grep every importer of `reconstruct.mjs`** and confirm the full blast radius (expected:
   `sync-fills.mjs` + `monitor.mjs` only).

**Safety gate (non-negotiable — `sync-fills.mjs` is the auto-committed critical path).** The refactor
must be **output-preserving**: run `sync-fills.mjs --dry` against the real log dir before AND after,
diff the emitted `positions.json` — it must be **byte-identical** (same logic, just relocated). Then a
fixture test (scratchpad, `--log-dir` override, `--dry` only) with `WITHDRAWN` + `BANKED` + a normal
sell proves `monitor.mjs`'s reconstruction now matches `sync-fills.mjs`'s. Do NOT run the real sync;
do NOT touch `positions.json`/`fills.json`/the real log. Node-only, no `APP_VERSION` bump.
Commit: `pipeline: unify reconstruction onto reconstruct.mjs (fix monitor WITHDRAWN/BANKED drift)`.

---

## Chunk 9 — Niche opportunity screens (kill the 24h-avg-ROI blind spot) — HIGH VALUE

**The debt (found live 2026-07-03 screening session).** `screen.mjs` step 3 pre-filters on
after-tax ROI of the **24h-average spread**. Stable liquid commodities have razor-thin 24h-avg
spreads, so the screen structurally excludes the exact niche that produced ~88% of session profit
(the crystal-teleport-seed lesson: for a liquid, regime-stable item with a wide *intraday* band,
**the band IS the edge**). Net effect: screens surface almost only mid-reprice "Rising" Tier B
items and hide the stable-liquid band plays Ben actually wants. Fixing it requires band data for
ALL items *before* the top-N cut — which per-item `/timeseries` can't provide (rate limits). The
unlock is that the wiki API's `/5m` and `/1h` endpoints are **bulk whole-market snapshots** and
accept `?timestamp=` for past windows.

### 9.1 `loadBands(hours)` in `marketfetch.mjs` — whole-market band data, archived
- For each 5m window in the last `hours` (default 2): read from a local archive under
  `pipeline/.cache/bands/` (append-per-day files, gitignored, prune >7 days) else fetch
  `API/5m?timestamp=<unix rounded to 300s>` once and store it. First cold 2h run ≈ 24 bulk calls
  (~70ms apart, same throttle as today); every later run only backfills missing windows.
- Returns per-item `{bandLo: min avgLowPrice, bandHi: max avgHighPrice, active5m: windows with
  two-sided trades}` for EVERY item — zero per-item timeseries calls.
- **Sanity gate:** for ~5 items spanning liquidity tiers, assert `loadBands(2)` edges match
  `fetchTs(id,'5m')` last-24 edges (same upstream data, different route). If the `?timestamp=`
  param misbehaves, verify against the wiki API docs before proceeding — do not silently fall
  back to per-item fetches.

### 9.2 `screen.mjs --mode <niche>` — one gate stack, per-niche pre-filter + ranking
Shared gates stay for every mode (two-sided vol ≥ `--floor`, `--min-price`/`--max-price`,
falling-regime silently excluded, top-N regime confirm + `computeQuote` + Tier A/B standard
table). The mode only decides the **edge definition + ranking** in step 3:
- **`band` (NEW DEFAULT)** — the seed niche. Edge = after-tax net of bandLo→bandHi from
  `loadBands(--band-hours, default 2)`; gate `bandNet/bandLo ≥ --min-roi`; require the band to be
  *traded* (≥ N active 5m windows on both sides, not one spike). Playbook line in output: ladder
  buys at band low / sell at band top, never below break-even.
- **`spread`** — today's behavior, renamed (24h-avg spread ROI). The bludgeon-style wide-spread
  mid-liquidity flips. Keep as-is; it works for what it finds.
- **`rising`** — formalizes what the current screen surfaces by accident: rising regime +
  `mom !== 'breakdown'`, entry priced at the band low. Always Tier B, output header says "size
  small, frothy".
- **`churn`** — buy-limit-cycle commodities: volDay ≥ 2000 && limit > 0, tiny ROI accepted,
  ranked purely by expected gp/day (9.3). Surfaces the high-frequency small-margin niche the ROI
  gate also kills today.
- Keep `--mode dip` OUT of scope for now (flat-regime + mom↓ wick-bids) — note it in the header
  comment as designed-not-built; it inverts the "don't buy a breakdown" rule and needs live
  validation first.

### 9.3 Realistic gp/day ranking (cross-cutting)
Raw ROI over-ranks illiquid margins. Expected units/day = `min(limit × 6, 10% × volDay)`
(null limit → vol share only); `expGpDay = units × optNet` (band net for `band` mode). Rank every
mode by it and append an **`Exp gp/d` trailing column in screen.mjs output only** — the canonical
9-column table (`QUOTE_HEADERS`, app views, quote.mjs) is untouched; this is a screen-side
appendix column, same pattern as the existing `stdCells` wrapper.

### 9.4 Acceptance
`node --check` touched files; run all four modes live; the proof gate is that `--mode band`
surfaces at least one stable-liquid wide-band item class that `--mode spread` misses at the same
floor/price window (the seed-class shape) with zero fallers shown; existing flags all still
respected; `quote.mjs` unaffected. Node-only — no `APP_VERSION` bump unless `quotecore.js` is
touched (it shouldn't be). Commit: `screen: niche modes (band/spread/rising/churn) + bulk 5m band
archive + gp/day ranking`.

---

## Out of scope (tracked separately in CLAUDE.md)
- Refresh-positions button; Ledger redesign (watchlist filter / grouping / period P&L);
  realized-vs-suggested calibration.

## Discovered
**Open:**
- **low** — `monitor.mjs` freshness line prints `NaNm ago`: `lastLog = Math.max(...rows.map(ep))`
  (raw-row path, lines ~47-49, separate from the reconstruct chain) includes manual REMOVE lines
  that carry no `date`/`time` → `ep()` = NaN poisons the max. Filter rows lacking a valid ts before
  the max. Surfaced while running monitor after chunk 8; not caused by it.
- **low** — stale pointer comments now that the reconstruction chain moved to `reconstruct.mjs`
  (chunk 8): `js/fillslog.js` line ~77 still says "SAME ALGORITHM as eventId() in pipeline/
  sync-fills.mjs", and `watch.mjs` lines ~29-30 call `reconstruct.mjs` "an older copy blind to
  WITHDRAWN/BANKED" — both are now the canonical home. Doc-only; left untouched to keep the chunk-8
  diff to the three code files.

**Resolved (chunk 8):**
- **med** — reconstruction drift (`monitor.mjs` mis-counted `WITHDRAWN`/`BANKED`) — unified onto the
  single `reconstruct.mjs` chain; `sync-fills.mjs --dry` output verified byte-identical before/after.
- **low** — pre-0.27 `STATE.fillsPending` rows lack the stored `line` field, so Edit/Delete degrades
  to "fix by hand"; self-heals on next sync. Not worth migration code.
- **low** — `quoteMarkdown` in `quotecore.js` is unreferenced (scripts build their own `mdTable`);
  kept as a documented shared-API helper (chunk 5 `bank.mjs` is a near-term consumer).

**Resolved (chunk 4):** `parsedLines` dead counter folded into summary · guide-dump CORS console
noise (browser-native, unsuppressable; our log is already quiet) · watchlist-filter hid pending rows
(now always render) · link-filename `.txt` gotcha (doc note added) · `loadNames()` broke on the
richer `mapping.cache.json` shape (both flatten-on-read now).
