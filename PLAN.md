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
- ✅ **Chunk 8** — unified log→positions reconstruction onto one `reconstruct.mjs` chain (killed the
  `monitor.mjs` WITHDRAWN/BANKED drift); `sync-fills.mjs --dry` output verified byte-identical — `181a07c`
- ✅ **Chunk 9** — niche screens: `loadBands(hours)` whole-market 5m band archive in
  `marketfetch.mjs` + `screen.mjs --mode band|spread|rising|churn` (band default) + realistic
  `Exp gp/d` ranking column — `2c3ca7e`
- ✅ **Chunk 10** — debt pass: `monitor.mjs` NaN-freshness fix, stale chunk-8 pointer comments,
  pipeline arg/format helper dedup into new `pipeline/cli.mjs`, docs truth pass — (this commit)

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

## Out of scope (tracked separately in CLAUDE.md)
- Refresh-positions button; Ledger redesign (watchlist filter / grouping / period P&L);
  realized-vs-suggested calibration.

## Discovered
**Open:** _(none)_

**Resolved (chunk 10):**
- **low** — `monitor.mjs` freshness line printed `NaNm ago`: the raw-row `Math.max(...rows.map(ep))`
  included manual REMOVE lines (no `date`/`time` → `ep()` = NaN poisoned the max). Fixed by filtering
  to `Number.isFinite` epochs before the max, falling back to `now` if none valid.
- **low** — stale pointer comments after the chunk-8 reconstruction move: `js/fillslog.js` (eventId
  "SAME ALGORITHM" pointer) and `watch.mjs` (held-basis rationale) both retargeted to `reconstruct.mjs`
  as the canonical home; `MONITORING.md`'s matching "older copy blind to WITHDRAWN/BANKED" claim fixed too.
- **low** — pipeline scripts had re-grown byte-identical `parseArgs` loop + `parseGp` + `mdTable` +
  `stdCells` copies; consolidated into new `pipeline/cli.mjs` (arg/format/table helpers). `quoteMarkdown`
  in `quotecore.js` left unadopted — both consumers append columns it can't express; noted in-code.

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
