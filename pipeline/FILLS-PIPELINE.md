# The Coffer — Fill-Data Pipeline (handoff for Claude Code)

> Written 2026-07-01 in a Claude mobile session. This doc transfers full context to a
> Claude Code instance on Ben's Windows machine. Read it top to bottom before touching
> anything. The goal: close the feedback loop between The Coffer's trade suggestions
> and real GE trades captured by RuneLite.
>
> **2026-07-01 update**: this file and the pipeline scripts now live in `pipeline/`
> (moved out of the repo root to separate pipeline tooling from what GitHub Pages
> deploys). `sync-fills.mjs` commands below assume you've `cd`'d into `pipeline/`
> first. `fills.json` itself is unaffected — it still lives at the repo root, since
> the app fetches it same-origin.

## 1. Project context (what The Coffer is)

- Single self-contained web app, one file: **`index.html`** at the repo root, deployed
  via **GitHub Pages** (bensumm.github.io/The-Ledger/). Vanilla JS, no build step, no
  framework. PWA-packaged. Currently **v0.14.1**.
- It's an OSRS Grand Exchange flipping cockpit: a Finder ranking flippable items by
  after-tax margin/ROI/risk, per-item Trends analytics (hourly seasonality, momentum,
  guide-price divergence, walk-forward backtest), live buy Signals for watched items,
  and a manual Ledger tracking real positions with after-tax P/L.
- Data sources: OSRS Wiki real-time prices API (`prices.runescape.wiki/api/v1/osrs` —
  `/latest`, `/1h`, `/mapping`, `/timeseries`), Wiki GEPricesByIDs module for in-game
  guide prices, weirdgloop per-item history API. All fetched client-side.
- Persistence: two-tier localStorage/IndexedDB (`sGet`/`sSet` wrappers). Hourly price
  archives stored per item under `tsa:{id}` keys. Export/Import JSON backup exists.
- GE tax: 2% on sell price, floored per item, capped at 5M, nil under 50gp. Every
  margin in the app is after tax: `netMargin = (high - tax(high)) - low`.
- Price semantics (flipper convention, opposite of wiki labels): **Buy** = `low` =
  instasell side = where you place buy offers. **Sell** = `high` = instabuy side.

### Critical process rules (inherited from the mobile sessions — keep them)
1. **The deployed `index.html` in the repo is canonical.** Never edit from a stale
   copy. Confirm the file/version before changing it. A rollback incident happened
   when edits were applied to an outdated snapshot.
2. Validate every edit: extract the `<script>` body, run `node --check`, verify
   brace/paren/bracket balance. Prefer exact-string-match patches that fail loudly.
3. Ben wants **prose explanations** of what changed and why, alongside code.
4. Be honest about statistical limits. Never oversell signal quality.
5. Bump `APP_VERSION` and the `BUILD` date constant on every shipped change.

## 2. What this pipeline is for

The tool currently predicts (margins, fill sizes, turn times, buy targets) but never
learns whether predictions worked. Real trade data closes that loop and enables:
- calibrating **Turn** estimates (currently `2·fill/volume` with a 15%-participation
  cap — a proxy, never validated);
- measuring **slippage** (quoted price vs. realized price);
- validating **Risk grades** against actual losses;
- true after-tax P/L per flip and gp/hr of attention.

Ben trades **exclusively on desktop RuneLite**, so client-side capture sees everything.

## 3. Architecture

```
RuneLite + Exchange Logger plugin          (captures every GE offer state change)
        │  writes .runelite/exchange-logger/*.log (JSON mode)
        ▼
sync-fills.mjs  (this repo, run by Task Scheduler every ~15-30 min)
        │  parse → normalize → dedupe → merge
        ▼
fills.json  (repo root, next to index.html)
        │  git commit + push  →  GitHub Pages
        ▼
The Coffer (any device) fetches fills.json same-origin on refresh and merges
```

Claude is **not** in the runtime loop. The pipeline is plugin → file → git → Pages.

## 4. Windows-machine setup tasks (do these first)

1. **Install the Exchange Logger plugin** from the RuneLite Plugin Hub (search
   "Exchange Logger"; source: github.com/istid/exchange-logger). In its config:
   - Output format: **Json**
   - File mode: **file per day** (safer than single-file-rewritten-per-session)
   - Note the output dir (default `%USERPROFILE%\.runelite\exchange-logger`).
   If the hub plugin is missing/renamed, fallbacks in §8.
2. Place a couple of small real GE trades so log lines exist.
3. Clone the Pages repo locally if not already; note its path.
4. Edit the CONFIG block at the top of `sync-fills.mjs` (`REPO_DIR` especially).
5. **Run `node sync-fills.mjs --probe`** — it prints raw log lines next to what the
   parser extracted. If any PARSED output is null or has wrong values, adjust the
   field names in `parseLogLine()`/`pick()` to match RAW. This is the ONLY part of
   the script expected to need adjustment; it was written against plausible field
   names without access to a real log file. Everything downstream consumes only the
   normalized shape.
6. `node sync-fills.mjs --dry` → sanity-check counts → run for real → verify
   `https://<pages-site>/fills.json` serves the file.
7. Register a Task Scheduler job: every 15–30 min, working dir = repo,
   `node sync-fills.mjs --auto` (the `--auto` flag matters — it makes the job amend
   its own previous commit + force-push instead of piling up a new commit every run;
   manual/Claude-driven syncs should omit the flag so they stay as distinct
   checkpoints). Also trigger "at log on". Git auth is via SSH (already working,
   confirmed with `ssh -T git@github.com`), so no PAT/credential-manager setup needed.

## 5. fills.json schema (v1 — the stable contract)

```json
{
  "app": "the-coffer-fills",
  "version": 1,
  "generatedAt": "2026-07-01T19:30:00.000Z",
  "events": [
    {
      "id": "a1b2c3d4e5f60718",   // sha1(ts|slot|itemId|type|state|filled|spent), 16 hex
      "ts": 1751400000,            // unix seconds
      "type": "buy",               // "buy" | "sell"
      "state": "complete",         // "placed" | "partial" | "complete" | "cancelled"
      "itemId": 1515,
      "slot": 2,                   // GE slot 0-7 (-1 if unknown)
      "price": 280,                // offer price per item
      "qty": 5000,                 // total offer quantity
      "filled": 5000,              // CUMULATIVE quantity filled as of this event
      "spent": 1400000             // CUMULATIVE gp moved as of this event
    }
  ]
}
```

Design decisions, deliberate — don't undo casually:
- **Raw offer events, not derived flips.** Cancels and partials are the most valuable
  calibration data (an offer that sat unfilled and got cancelled = direct evidence a
  price wasn't fillable; cancel-and-relist = measured slippage). Derivation (pairing,
  durations) happens downstream where it can be re-run as logic improves.
- **Idempotent sync**: every run re-reads all logs and dedupes by content-hash id. No
  incremental watermark state to corrupt. Personal volume is small; this is fine.
- Retention: 180 days / 20k events (config constants).
- **`spent` is GROSS, confirmed empirically** (2026-07-01): sold 33 dragon arrowtips
  (item 11237), offer listed at 3900/ea but filled at avg 3945/ea (GE matched a
  better buyer than the listed price — sell offers are a floor, not the execution
  price). Logged `worth: 130185` = exactly `33 × 3945`, no tax subtracted. Real
  after-tax proceeds would be `130185 − floor(3945×0.02)×33 = 127611`. **The Coffer
  must apply its own `tax()` function to `spent`/`worth` when computing realized
  margins from fills.json** — same as it already does for live quotes. No change
  needed in `sync-fills.mjs`; leaving `spent` raw/gross is correct and consistent
  with how buy-side `spent` already behaves (buys have no tax to begin with).
- Corollary: **quoted/offer price ≠ execution price**, even for filled orders — GE
  matches favorably when possible. Any slippage calibration (§6.5) should compare
  realized avg price (`spent/filled`) against the quote, not assume they're equal
  just because an order fully filled.
- Offer **duration is derivable** (same slot+item chain of events) but only trustworthy
  for offers completing while the client was open — offline fills all "arrive" at next
  login. Flag/segment rather than trust blindly.

### 5.1 positions.json (derived — v1)

`sync-fills.mjs` emits a second artifact next to `fills.json`, at the repo root:
the reconstructed trade/position view the app auto-populates its Ledger from. It's
regenerated from the full merged event history every run (idempotent), written +
committed + pushed under the *same* change-gate as `fills.json` (`git add fills.json
positions.json`). No file moves ⇒ **no Task Scheduler re-registration needed**.

```json
{
  "app": "the-coffer-positions", "version": 1,
  "generatedAt": "2026-07-02T08:16:01.586Z",
  "closed":   [{ "itemId":31406, "qty":61, "buyEach":13540, "sellEach":14250, "tax":17385, "realised":25925, "buyTs":..., "sellTs":... }],
  "open":     [{ "itemId":31406, "qty":1528, "buyEach":13540, "buyTs":... }],
  "unmatched":[{ "itemId":11237, "qty":33, "sellEach":3945, "tax":..., "sellTs":... }]
}
```

Reconstruction (in `sync-fills.mjs`), deliberate — don't undo casually:
- **`collapseOffers()`** reduces the per-transition stream to one row per *offer*
  (contiguous `slot+item+type` run), taking the final cumulative `filled`/`spent`.
  Executed price-each = `spent/filled` (gross), never the listed `price` (see §5).
- **`matchTrades()`** FIFO-matches buy fills against sell fills per item → `closed`
  (with 2% tax applied to the sell exec price, `realised` = after-tax profit) and
  `open` (unsold inventory at real avg cost; same item+price lots merged).
- **`unmatched`** = sells with no logged buy lot (the log started mid-stream, so the
  buy predates it). Cost basis is unknowable ⇒ **no realized profit is invented** for
  these; the app shows them as informational only, never in the Coffer total.
- Cost basis is **FIFO**; itemId→name resolution is left to the app (it has the
  mapping), so `positions.json` stays name-free and stable across catalog changes.

Manual-line vocabulary (0.27.0, PLAN.md chunk 1) — extra states valid ONLY in
`coffer-manual.log` (slot 8), written by `add-manual-fill.mjs` or the app's linked
file handle (`js/fillslog.js`):
- **`WITHDRAWN`** — inventory taken for personal use. `matchTrades()` consumes open
  lots FIFO into closed rows flagged `withdrawn:true` with `realised: 0` (no sale,
  no tax); the app renders "withdrawn (used)" and excludes them from every profit
  sum. CLI: `--type withdraw` (no `--price`).
- **`BANKED`** — pre-owned inventory (bank/drop) entering the flip flow at a declared
  basis (`worth/qty`; convention: market instasell at the time it was committed to
  flipping; 0 allowed for windfalls). Enters the FIFO queue like a buy but carries
  `banked:true` onto the open lot and any closed trade it feeds, so flip-decision P/L
  stays distinguishable from cash-out-of-pocket. CLI: `--type banked --price <basis>`.
- **`{"state":"REMOVE","target":"<eventId>"}`** — tombstone. During merge the target
  event id is deleted from the merged set **including events already persisted in
  `fills.json`** (that file is an append-only archive, so deleting a source line alone
  never purges a merged event — the tombstone is the correction mechanism). Idempotent:
  the REMOVE line stays in the log, so a re-parsed source event is re-filtered every
  sync. Event id = `sha1(ts|slot|itemId|type|state|filled|spent)`, first 16 hex —
  `eventId()` in `sync-fills.mjs` and `eventIdFor()` in `js/fillslog.js` MUST stay in
  sync. CLI: `add-manual-fill.mjs --remove <eventId>`; the app appends tombstones
  automatically whenever it edits/deletes a manual line.
- Test isolation: `sync-fills.mjs --log-dir <dir> --repo-dir <dir>` points a fixture
  run at temp dirs (use `--dry`, or a fixture repo dir — never the real ones).

## 6. The Coffer side (mobile-session work, or Claude Code once comfortable)

Not yet built — planned as the next tool feature, roughly in order:

1. **Fetch + merge**: on refresh, `fetch('fills.json')` (same-origin, cache-busted),
   store under a new storage key (e.g. `fills`), show "fills last synced Xh ago" and a
   staleness warning (silent pipeline death is the failure mode to design against).
2. **Fills tab (or Ledger section)**: recent events, per-item realized flips.
3. **Buy↔sell pairing**: FIFO per item over completed events → realized flips with
   after-tax margin and durations. Handle partial sells spanning multiple buys.
   Reconcile with the manual Ledger (`trades`) — auto-match, don't double-count.
4. **Intent capture**: extend the Watchlist "Log buy" action to snapshot context at
   decision time — `{ts, itemId, side, suggestedPrice, liveLow, liveHigh, volume,
   riskIndex, trendState}` — persisted, then auto-matched to fills by item+side+nearest
   time. This yields predicted-vs-realized pairs, the core calibration dataset.
5. **Calibration surfaces**: realized fill time vs. Turn estimate; realized price vs.
   quote (slippage); loss rate by Risk grade. Prose-honest, small-sample-aware.
6. **Skipped-signal scoring** (needs no fill data): after a Signal fires, score it
   later against the wiki timeseries — did price hit target within N hours? Honesty
   metric for the Signals tab.

## 7. Known gaps / edge cases (discussed and accepted)

- Trades placed outside RuneLite (mobile client) are invisible to the plugin. Ben does in
  fact trade on mobile sometimes, so the log is *incomplete*, not wrong. **Fix at the
  source, not the derived view:** inject the missing fills into a sibling file
  `coffer-manual.log` in `LOG_DIR` (NOT RuneLite's live `exchange.log`). `readLogFiles()`
  already ingests every `*.log` there and dedup is content-hashed, so injected lines flow
  through the real reconstruction into fills.json/positions.json and survive every re-sync.
  Two writers, same file/format:
  - **CLI:** `node pipeline/add-manual-fill.mjs --item "…" --type buy|sell --qty N --price gp
    [--net] [--time iso] [--dry]` (see its header). `--net` inverts the 2% tax (capped 5m)
    so an after-tax sell price becomes the gross listing the log stores.
  - **App (0.26.0; log-only since 0.27.0):** the Ledger's "Link fills log…" button grants the
    page write access to `coffer-manual.log` via the File System Access API (Edge/Chrome);
    once linked, manual buys/sells/withdrawals/banked entries append there directly
    (`js/fillslog.js` `fillsLogLine` = same schema, slot 8). The app stages an optimistic
    `pending` row (`STATE.fillsPending`) that `syncFills()` drops once a positions.json with
    `generatedAt >= created` arrives (same machine → no clock skew), i.e. once the sync has
    absorbed the injected line. Since 0.27.0 the log is the ONLY manual path — unlinked, the
    form shows guidance and creates nothing (the old browser-local `STATE.trades` path was
    removed; PLAN.md chunk 1).
    - **When linking, pick the EXISTING `coffer-manual.log`** — don't "create new" in the
      picker. Doing so once produced a second `coffer-manual.log.txt`; `sync-fills.mjs` ingests
      `.txt` too so nothing broke, but app-writes and CLI-writes then split across two files.
      One canonical file keeps `add-manual-fill.mjs` (CLI) and the app writing to the same place.
  Editing/deleting an injected line (0.27.0): pending rows have Edit/Delete (exact-string
  line rewrite through the stored file handle), and "Edit manual entries…" rewrites any
  already-synced manual line; both always append a REMOVE tombstone for the old event id
  (§5.1) so the correction propagates into fills.json on the next sync. Old
  screenshot-transcribe path still works as a fallback.
- Offer chains (cancel→relist) need heuristic grouping (same item, opposite side
  absent, relist within minutes) — downstream logic, not pipeline.
- Selection bias: only taken trades are observed; §6.6 partially compensates.
- DST/timezone: all pipeline timestamps are unix seconds (UTC). The Coffer renders
  local time. If Exchange Logger writes local-time strings, `Date.parse` in the
  adapter treats them as local — consistent as long as the machine's TZ is stable.

## 8. Fallbacks if Exchange Logger doesn't pan out

1. **RuneLite's built-in GE plugin** keeps a rolling trade history (up to 1 month /
   capped count) in the profile config (`grandexchange.tradeHistory`, JSON, under
   `.runelite/profiles*/`), and runelite.net offers a GE-history JSON export. Usable
   as backfill or as an alternate parse source — but rolling-window, not append-only.
2. **Flipping Utilities plugin** stores rich per-flip data locally (own schema, may
   change between versions) — richest data, least stable contract.
3. Worst case: a ~100-line custom RuneLite plugin subscribing to
   `GrandExchangeOfferChanged` and appending JSON lines. The event provides slot,
   item, price, quantity, spent, state — exactly our schema. Sideloadable without
   Plugin Hub review.

## 9. Definition of done (pipeline phase)

- [x] Plugin installed, JSON mode, logging real trades
- [x] `--probe` output verified; adapter matches real fields — real field names were
      `item`/`offer`/`max`/`qty`/`worth` mapping to `itemId`/`price`/`qty`(total
      offer)/`filled`(cumulative)/`spent`, all different from the original guesses;
      see the ADAPTER comment in `sync-fills.mjs`. Also: the plugin emits explicit
      `CANCELLED_BUY`/`CANCELLED_SELL` states (confirmed live 2026-07-02), mapped by
      `normalizeStateStr`; `buildEvents()` also keeps a sequence-aware fallback for
      cancels that drop straight to `EMPTY` without a cancel line.
- [x] Scheduled task running; fills.json updating in the repo and served by Pages —
      Task Scheduler job `CofferFillsSync`, every 20 min, runs
      `wscript.exe pipeline\run-fills-sync.vbs` (hidden wrapper around
      `pipeline\run-fills-sync.cmd`, which cd's into `pipeline/` and runs
      `node sync-fills.mjs --auto`). The `--auto`
      flag makes it amend its own previous commit + force-push instead of piling up
      commits (see the git section of `sync-fills.mjs`). An "at logon" trigger was
      attempted but is blocked (`Access is denied`) in this environment even at
      limited run-level — not pursued further since the 20-min interval already
      catches up after sleep/logon within 20 minutes.
- [x] Sell-tax gross-vs-net question answered empirically and recorded here (§5) —
      `spent`/`worth` is gross, not post-tax. Also surfaced that execution price can
      differ from the quoted offer price even on a full fill.
- [ ] Then: tool-side fetch+merge (§6.1) as the first index.html change

## 10. Environment notes (Windows machine) — single home

Consolidated here by PLAN.md chunk K3 (2026-07-04); CLAUDE.md keeps a one-line pointer.
The field-name mapping and cancel semantics also appear in §9's done-checklist — that
detail is authoritative there; the operational rules below are the single home.

- **RuneLite config lives under `~/.runelite/profiles2/*.properties`.** Changes made
  in-game only flush to disk on client close/restart — if a just-changed setting still
  reads the old value, ask Ben to restart the client before re-checking.
- **Exchange Logger plugin log:** `~/.runelite/exchange-logger/exchange.log`, JSON mode.
  Real field names differ from the plugin's own naming conventions — see the ADAPTER
  comment block at the top of `sync-fills.mjs` for the verified mapping (`item`→itemId,
  `offer`→price, `max`→qty, `qty`→filled, `worth`→spent). Don't re-guess field names; that
  mapping was verified against real log output (§9).
- **Cancel semantics:** the log emits explicit `CANCELLED_BUY`/`CANCELLED_SELL` states
  (confirmed live 2026-07-02) — `normalizeStateStr` maps any `CANCEL*` to `'cancelled'`.
  `buildEvents()` *also* keeps a sequence-aware fallback (last non-complete event before an
  `EMPTY` or a slot item-change → cancelled) for cancels that drop straight to `EMPTY`
  without a cancel line. Keep both paths; don't revert to pure line-by-line parsing.
- **Manual fills injected into `coffer-manual.log` MUST carry the timestamp of when the
  trade actually happened** (`--time` on `add-manual-fill.mjs`) — a "now" timestamp on a
  backdated trade breaks FIFO matching (the phantom-5-bludgeons incident, 2026-07-03).
  Never edit RuneLite's own `exchange.log`; the writable source is the sibling
  `coffer-manual.log`.
- **`fills.json` is an append-only merged archive** — fixing or removing a source log line
  does NOT by itself purge an already-merged event; append a `REMOVE` tombstone line (the
  chunk-1 vocabulary, confirmed working) to `coffer-manual.log`, then re-sync.
- **Task Scheduler job `CofferFillsSync`** runs `wscript.exe pipeline\run-fills-sync.vbs`
  every 20 min (hidden window). If any pipeline file moves again, that task's registered
  path needs re-creating too — it's not automatically kept in sync with the repo
  (`schtasks /Delete` + `/Create`, see §4.7).
## 11. Outcomes dataset (O1 — the algorithm-feedback foundation)

The pipeline captured *what filled*; O1 adds *what the tool said* and *the market context at
placement*, so every offer's full story is recoverable and F1 (algorithm feedback) becomes a
query rather than a re-derivation. Three pieces:

### 10.1 `suggestions.jsonl` — the suggestions ledger (TRACKED, append-only)
Repo-root, committed. `quote.mjs` (per-item **and** `--positions`), `screen.mjs` (each rated
niche row), and `watch.mjs` (each held/target read) append every emitted recommendation **at
emit time, unconditionally**, via the shared `pipeline/suggestlog.mjs`. One JSON object per line:
```
{ ts, script, mode, params, itemId, quickBuy, optBuy, quickSell, optSell, mom, regime, class, verdict }
```
`ts` = unix seconds. `class` = the item-type/liquidity label **as computed then** (the logic
evolves; recomputing later would rewrite history, so it is snapshotted — coarse `liqClass()` for
quote/screen, `watch.mjs`'s richer `classify()` taxonomy for watch). `verdict` = the emitted
action string where the script produces one (position verdict / grade / watch action), else null.
No PII — ids/prices/timestamps only (the repo is public). `sync-fills.mjs`'s commit set now
includes it when present (same add-only-these-files discipline as `screen.json`). NB: `watch.mjs`
is still read-only w.r.t. the market/positions — this analytics append is the sole exception, and
its header guardrail says so.

### 10.2 Historical market-context retention (`/5m?timestamp=`)
Outcome analysis reconstructs the **trailing-2h band at each historical trade placement** (same
basis as `patientTargets` / `computeQuote`'s `bandLo`/`bandHi`), which requires reading *past* 5m
windows. The wiki `/5m?timestamp=<unix÷300>` bulk endpoint serves them, and a **live spot-check
(2026-07-04)** confirmed full data returns at **1 week, 1 month, 6 months, and 2 years** back
(HTTP 200, ~1.6–1.9k items/window, per-item avgLow/High/volume intact) — so the source retains 5m
history for **at least 2 years**; band enrichment is never blocked by the endpoint for any fill in
that window. As insurance against re-fetching, the local `.cache/bands/` prune was raised **7d →
90d** (`BANDS_RETENTION_DAYS` in `marketfetch.mjs`) — local + gitignored; **band data is never
committed**.

### 10.3 `pipeline/outcomes.mjs` — the join (DERIVED, gitignored)
`node pipeline/outcomes.mjs [--report] [--no-bands] [--json] [--min-n N] [--band-hours H]`. Writes
gitignored `outcomes.json` (rebuildable any time; `outcomes.json` + `.cache/outcomes-bands/` are in
`.gitignore`). A **campaign** = one intent to trade: a same-item/same-side chain of offers
`placed → … → terminal`, with cancel-replace successions (re-place within `REPRICE_GAP`, 20 min)
stitched into one campaign carrying a reprice list. Per campaign: placement ts/price, reprice
count/steps, time-to-first-fill, time-to-complete (or terminal state + filled fraction), **band
percentile at placement**, 2h spread + limiting-side volume, realized net after tax where it
closes a FIFO lot, and the nearest **prior** suggestion for the item (≤ `SUGGEST_WINDOW`, 6h;
missing = null, never dropped). Manual/mobile fills (slot 8) are flagged `manual:true`. **FIFO
realized P/L reuses `reconstruct.mjs` `matchTrades` — never re-implemented** (closed lots joined
back to sell campaigns by `sellTs`); `collapseOffers` gives the offer boundaries; first-fill
timing is stamped from the raw events. Band enrichment batches one `loadHistBands()` fetch for all
placements (each distinct 5m window fetched once, reduced per-item datum cached ~KB/item).

**First read = schema validation, not conclusions** (process rule 4). `--report` prints fill-time
distributions by **band-percentile bucket × liquidity class, n per cell**, and **refuses** a
per-cell median below `--min-n` (default `MIN_N_REPORT = 8`). The **F1 gate thresholds** it
documents (the numbers that open F1): a per-cell fill-time/probability curve is trustworthy only at
**n ≥ 30** per `(side × percentile × class × regime)` cell — regime bucketed **first**, the known
confound — with **≥ 5** such cells populated (`MIN_N_F1` / `MIN_CELLS_F1`). These are defensible
conventions, not derived values. On the current dataset (103 campaigns, ~2.5 days, 83% fill rate,
realized +2.8m over 39 closed sell campaigns) the join is validated and behaves correctly — buy
placements cluster at the 0–20 band percentile, sells at 80–100, exactly the patient-pricing
signature — but only **1** cell clears n≥30, so **F1 stays gated**: the schema/pipeline are sound,
the sample simply must accrue calendar time (why O1 starts now).
