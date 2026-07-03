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

---

## Chunk 5 — Bank-visibility tooling (`pipeline/bank.mjs`) — BLOCKED on a real sample

`positions.json` "open" is **GE-log-derived inventory only — not the bank**. Ben holds a large bank
the pipeline is structurally blind to (Exchange Logger only sees GE offers). Goal: full bank truth so
(a) net worth tallies correctly and (b) a flip-target sitting idle in the bank gets flagged to GE.

**Capture mechanism (verified):** RuneLite writes no bank file to disk. The **"Data Export" plugin**
(plugin hub) dumps bank contents to clipboard as CSV (item, qty, GE price). Rejected: Bank Tags =
IDs only, no qty; CsvExport = player/skills, not bank. It's a **manual point-in-time snapshot** — no
auto-sync possible (client only knows the bank while the bank UI is open). Do NOT Task-Scheduler it.

**Work item:**
1. Parse a pasted Data Export CSV (`pipeline/bank.csv`) → `bank.json` (itemId → qty). Tolerant
   parser; exact columns pinned from a real sample.
2. Value bank at live prices (reuse `js/quotecore.js` + the market fetch layer). Net-worth tally.
3. Flip-target screen — `bank.json` ∩ `STATE.watchlist` → items worth GE-ing, in the standard table.
4. Reconcile GE-open vs bank — generalize `pipeline/held-override.json` (currently a one-item
   hand-patch) into proper bank-truth reconciliation; supersedes held-override.json.

**Guardrails:**
- **Do NOT inject bank items into the fill log / `fills.json`.** Bank truth is a *separate input*,
  never fabricated into the append-only trade log — real trades vs. real holdings are different
  sources. It reconciles against `positions.json`; it does not write trade events.
- Bank data is item+qty only → no PII. Document in `pipeline/FILLS-PIPELINE.md`.
- Depends on `js/quotecore.js` (chunk 2).

**Blocking on Ben:** paste one real Data Export into `pipeline/bank.csv`. Nothing to build until the
parser can be pinned to actual columns.

---

## Chunk 7 — Adaptive monitor/polling loop (item-type-aware) — FUTURE

Requested 2026-07-03 after a live scalping discussion (aggressive low-bid on a big-ticket volatile
item). Lower priority — a future improvement. Builds on `pipeline/monitor.mjs` + `MONITORING.md` +
the `/loop` skill. **Depends on chunk 6** (`mom` + cut-trigger) and **chunk 3** (`quotecore`/
`quote.mjs`); sequence after both.

### The goal
Today `monitor.mjs` runs one flat routine for all held positions. Ben wants a loop that **adapts to
the item type** and drives an active, human-executed session on a tight (1–3 min) cadence: live
price-recommendation adjustments, drop alerts, and per-item risk reads.

### 7.1 Item-type classification → different rules & cadence
Classify each watched/held item by regime + liquidity + spread + ticket size (reuse chunk-3 screen
logic): e.g. **thin big-ticket volatile** (tight cadence, hair-trigger cut), **liquid ranging
wide-spread** (scalp/market-make candidate), **stable liquid** (loose cadence). Class selects poll
frequency, alert thresholds, and which playbook applies.

### 7.2 Live price-recommendation adjustment
On each poll, re-quote (`quotecore`) and surface updated buy-at / list-at prices (break-even-floored)
so the user can adjust resting offers. **Hard lesson to encode: you cannot "stay ahead of a drop" by
chasing your ask down — that is just selling cheaper.** Sell-side re-pricing is controlled
loss-taking in a downtrend and only becomes *profit* in a ranging regime. Frame it honestly
(clear-vs-hold), never as out-running the market.

### 7.3 Drop alerts
Alert when a held/target item flips to `mom === 'breakdown'` (chunk 6), 2h drift turns negative, or
instabuy prints below the held break-even. Escalation matches the cut-trigger (6.4): breakdown on a
held big-ticket → CUT alert before the lagging multi-day regime confirms.

### 7.4 Per-item risk assessment
Compact risk read per item: spread width, two-sided liquidity, regime, ticket size / capital
exposure, and an **adverse-selection warning** for aggressive low bids (a low buy fills precisely
when the market is dropping → often no exit margin at fill). Gate the market-making/scalp playbook to
**ranging wide-spread items only** — never for a trending-down item.

### Guardrails
- **Human-executed decision support only. NEVER auto-place/cancel GE offers** — automating GE
  interaction is botting and bannable. The loop pings *when* to act; the human clicks.
- Read-only against live data (same posture as `monitor.mjs`).
- Encode the exit discipline in memory `opportunity-cost-can-beat-patient-hold`: set the exit at
  entry, don't leave stranded asks, cut on breakdown rather than hoping.

### Acceptance
Point the loop at a ranging item and a trending-down item; verify different cadence + correct
playbook (scalp vs cut), a breakdown/CUT alert on the down item, and that it never suggests
out-running a drop. Doc the routine in `pipeline/MONITORING.md`. No `APP_VERSION` bump unless app
code changes.

---

## Out of scope (tracked separately in CLAUDE.md)
- Refresh-positions button; Ledger redesign (watchlist filter / grouping / period P&L);
  realized-vs-suggested calibration.

## Discovered
**Open:**
- **med** — reconstruction logic has DRIFTED: `sync-fills.mjs` handles `WITHDRAWN`/`BANKED`, but
  `pipeline/reconstruct.mjs` (behind `monitor.mjs`) is an older copy without them → `monitor.mjs`
  mis-counts held positions if manual lines exist. Fix: unify onto one shared reconstruction module
  (larger refactor — candidate for its own chunk).
- **low** — pre-0.27 `STATE.fillsPending` rows lack the stored `line` field, so Edit/Delete degrades
  to "fix by hand"; self-heals on next sync. Not worth migration code.
- **low** — `quoteMarkdown` in `quotecore.js` is unreferenced (scripts build their own `mdTable`);
  kept as a documented shared-API helper (chunk 5 `bank.mjs` is a near-term consumer).

**Resolved (chunk 4):** `parsedLines` dead counter folded into summary · guide-dump CORS console
noise (browser-native, unsuppressable; our log is already quiet) · watchlist-filter hid pending rows
(now always render) · link-filename `.txt` gotcha (doc note added) · `loadNames()` broke on the
richer `mapping.cache.json` shape (both flatten-on-read now).
