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

> **Historical framing — 2026-07-01 handoff.** §§1–4, §6, and §9 below were written to
> hand a mobile-session state to Claude Code; parts are now superseded. **Current state
> lives in §5.1 (positions.json), §10 (environment notes — the single home), §11 (outcomes
> dataset), §12 (sync cadence — schedule eliminated), §13 (mobile write path), and §14 (the
> local log-watcher — desk-side freshness with zero git).** The
> app is no longer a single file and is not pinned to the version quoted below; see
> `README.md` + `CLAUDE.md` for the live picture. Kept for the design rationale it carries.

- Self-contained web app, deployed via **GitHub Pages** (bensumm.github.io/The-Ledger/).
  Vanilla JS, no build step, no framework, PWA-packaged. (As of 2026-07 the app is split
  across `index.html` + `styles.css` + `js/*` ES modules — it is no longer the single
  `index.html` file described in this 2026-07-01 handoff.)
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

### Critical process rules — see CLAUDE.md
The process rules now live in **`CLAUDE.md` "Process rules"** (the canonical, current home):
the repo files are canonical / don't work from a stale copy; `node --check` each touched
`js/*.js` (each is standalone ESM now — no more `<script>`-body extraction) plus a real
browser/Playwright run; prose explanations alongside code; honesty about statistical limits;
bump `APP_VERSION` in `js/state.js` on shipped app changes (there is **no** `BUILD` date
constant — that was a single-file-era artifact and no longer exists). This section is retained
only as a pointer; do not re-derive the rules here.

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
sync-fills.mjs  (this repo, run ON DEMAND — session-start or a manual push;
        │             the ~20-min Task Scheduler cadence was ELIMINATED 2026-07-04, see §12)
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
7. ~~Register a Task Scheduler job~~ **— SUPERSEDED 2026-07-04 (G1, see §12).** The
   scheduled `CofferFillsSync` job was eliminated; **sync is now on-demand only** — run
   `node pipeline/sync-fills.mjs` at session start (the skills do this) or when you want a
   manual push. The `--auto` amend/force-push flag was the scheduler's mechanism and was
   **excised** 2026-07-05 (chunk X2) — git history is the recovery story if a schedule is
   ever wanted again. Git auth is via SSH
   (already working, `ssh -T git@github.com`), so no PAT/credential-manager setup is needed.
   *(Historical: the job ran `node sync-fills.mjs --auto` every ~20 min, amending its own
   rolling commit; that whole apparatus is gone — see §12 for why and what replaced it.)*

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

Reconstruction (in `reconstruct.mjs`, called by `sync-fills.mjs` and `monitor.mjs`),
deliberate — don't undo casually. **REMOVE tombstones apply on BOTH paths:** `sync-fills.mjs`
folds them into the merged `fills.json`+archive set (below), and `monitor.mjs` folds them into its
in-memory live-log book via the shared `buildTombstonedEvents()` (ARCH-1, 2026-07-10) — so both
answer "what do I hold?" the same way and a purged lot never reappears as a phantom monitor hold
(the class of same-number-two-ways bug the shared reconstruction exists to kill):
- **`validateSlotTransitions()`** (LH1, 2026-07-05) runs at INGEST — next to `buildEvents()`,
  BEFORE the `fills.json` merge — as the LOUD, conservative catch for RuneLite snapshot re-emissions
  (a completed-but-uncollected offer's terminal line re-logged on login/world-hop). It drops a
  same-slot second terminal that is strictly identical to the prior terminal with no placement line
  between, `console.warn`s per drop (with a dropped-count in the sync summary), and so a FRESH
  re-emit never enters `fills.json` at all. Manual slots 8/9 are exempt; any differing field warns
  but is KEPT (fail toward preserving data). Discriminator + rationale in §10 "Duplicate terminal lines".
- **`dedupeSnapshots()`** (P1, 2026-07-05) runs inside `reconstruct()` as the SILENT DERIVATION-LAYER
  BACKSTOP: it drops the same class using the same discriminator, catching any phantom ALREADY
  persisted in an older (pre-LH1) `fills.json` — which the ingest validator never re-reads — so the
  derived `positions.json` is correct even before that archive is re-cleaned.
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

Manual-line vocabulary (0.27.0, PLAN.md chunk 1) — extra states valid in the manual source
logs, written by `add-manual-fill.mjs`, the app's linked file handle (`js/fillslog.js`, desktop
`coffer-manual.log`, **slot 8**), or the app's GitHub write path (M1, `mobile-fills.log`, **slot 9**
— see §13):
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

> **Mostly SHIPPED (historical roadmap).** Items 1–3 landed long ago: the app fetches +
> merges `positions.json`/`fills.json` with a `generatedAt` staleness banner (0.18.0
> auto-populate + M1's 0.39.0 Refresh-positions button), FIFO buy↔sell pairing lives in the
> pipeline's `reconstruct.mjs` (not re-done in the browser), and the Ledger auto-populates
> from `positions.json`. Items 4–6 (intent capture, calibration surfaces, skipped-signal
> scoring) are the O1→F1 line — O1's `suggestions.jsonl` + `outcomes.mjs` now capture intent
> and market context (§11); the calibration surfaces open when F1's sample gate clears. The
> list below is the original ordering, kept for context.

Original roadmap — planned as the next tool feature, roughly in order:

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
  `coffer-manual.log` in `LOG_DIR` (NOT RuneLite's live `exchange.log`). **As of M1 (0.39.0,
  §13) the phone can capture these itself** — the app writes a slot-9 source line straight to the
  tracked repo-root `mobile-fills.log` via the GitHub contents API, and `sync-fills.mjs` folds it
  in like any other source log. `coffer-manual.log` (slot 8) remains the desktop/CLI path. `readLogFiles()`
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
      `normalizeStateStr`. ~~`buildEvents()` also keeps a sequence-aware fallback for
      cancels that drop straight to `EMPTY`~~ — **REMOVED 2026-07-05** (see §10 cancel
      semantics: the logout EMPTY-burst incident).
- [x] ~~Scheduled task running~~ **— SUPERSEDED 2026-07-04 (G1, §12): the schedule was
      eliminated; sync is on-demand only.** *(Historical: the Task Scheduler job
      `CofferFillsSync` ran `wscript.exe pipeline\run-fills-sync.vbs` — a hidden wrapper
      around `pipeline\run-fills-sync.cmd`, which cd'd into `pipeline/` and ran
      `node sync-fills.mjs --auto`, amending its own rolling commit + force-pushing every
      20 min. An "at logon" trigger was blocked by `Access is denied` in this environment
      and never pursued. The whole job was deleted with `schtasks /Delete /TN CofferFillsSync
      /F` when G1 landed; the `run-fills-sync.vbs`/`.cmd` wrappers and the `--auto` branch were
      later excised (chunk X2, 2026-07-05); `fills.json`/`positions.json` now update only when a
      session or Ben runs the sync.)*
- [x] Sell-tax gross-vs-net question answered empirically and recorded here (§5) —
      `spent`/`worth` is gross, not post-tax. Also surfaced that execution price can
      differ from the quoted offer price even on a full fill.
- [x] Tool-side fetch+merge (§6.1) — **shipped 0.18.0** (`syncFills()` merges
      `positions.json` into the Ledger/Coffer; the `generatedAt` staleness banner + M1's
      0.39.0 Refresh-positions button close out the freshness half). The pipeline phase is
      complete; ongoing work is the O1→F1 calibration line (§11).

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
  That explicit line is the ONLY source of a cancel. The old cancel-to-EMPTY inference
  (last non-complete event before an `EMPTY`/slot item-change → retro-marked cancelled)
  was **REMOVED 2026-07-05**: a logout wrote an all-slots-`EMPTY` burst while four offers
  were live in-game and the inference fabricated four phantom cancels (pushed to
  fills.json/positions.json; repaired with REMOVE tombstones). A running plugin always
  writes a real terminal line, so `EMPTY` is never evidence of a cancel — it's consumed as
  a slot boundary only. An offer whose terminal was missed (plugin toggled off) is fixed
  the honest way: manual injection/tombstone in `coffer-manual.log`. **Before injecting a
  manual leg for a plugin-off gap, check which SIDE actually went unlogged** — on
  2026-07-05 the buy was missed but the sell logged fine, and injecting both sides created
  a duplicate sell (repaired with a tombstone). Don't re-add the inference.
- **Manual fills injected into `coffer-manual.log` MUST carry the timestamp of when the
  trade actually happened** (`--time` on `add-manual-fill.mjs`) — a "now" timestamp on a
  backdated trade breaks FIFO matching (the phantom-5-bludgeons incident, 2026-07-03).
  Never edit RuneLite's own `exchange.log`; the writable source is the sibling
  `coffer-manual.log`.
- **`fills.json` is an append-only merged archive of REAL events, but the log is NOT unfiltered
  truth** — two known log-artifact classes are handled before/around the archive, not trusted into
  it: (1) **snapshot re-emission** — an identical same-slot second terminal (the 13:29 double-BOUGHT)
  is dropped LOUDLY at ingest by `validateSlotTransitions()` (LH1) so it never becomes a merged event,
  with `dedupeSnapshots()` as the derivation backstop for any already-persisted duplicate (see the
  "Duplicate terminal lines" subsection below); (2) **restart display-blindness** — after a client
  restart the plugin re-emits nothing, so `monitor.mjs`/`watch.mjs` can read live offers as missing;
  that is a *display* artifact (not a reconstruction one) surfaced by the LH2 "log may be blind"
  header line. Beyond those, fixing or removing a source log line does NOT by itself purge an
  already-merged event; append a `REMOVE` tombstone line (the chunk-1 vocabulary, confirmed working)
  to `coffer-manual.log`, then re-sync.
- **Sync cadence: on-demand only (no scheduled job) — 2026-07-04, see §12.** The
  `CofferFillsSync` Task Scheduler job that ran `wscript.exe pipeline\run-fills-sync.vbs`
  every 20 min was **eliminated**; there is no longer any unattended writer **to `main`**. Run
  `node pipeline/sync-fills.mjs` at session start (the session skills do this automatically)
  or whenever a manual push is wanted. (The local `watch-log.mjs` daemon, §14, regenerates the
  root artifacts in the working tree with **zero git** — it is not a writer to `main`.) *(Historical: if a schedule is ever wanted again, it
  would be rebuilt from scratch — the `run-fills-sync.vbs`/`.cmd` wrappers and the `--auto`
  amend/force-push branch were excised in chunk X2, 2026-07-05; git history holds the old
  machinery.)*

### Duplicate terminal lines — snapshot re-emission (diagnosed 2026-07-05; silent dedupe since P1, LOUD ingest validation since LH1)
The Exchange Logger occasionally writes a second, identical terminal line (BOUGHT/SOLD)
for the same offer. Root cause: RuneLite re-broadcasts every GE slot's current state on
login / world-hop / opening the GE (visible in the log as a burst of simultaneous EMPTY
lines for the other slots at the same second); a completed-but-uncollected offer re-reports
its terminal state and the plugin logs it again. Three cases on 2026-07-04 (soul SOLD,
blowpipe BOUGHT, bludgeon SOLD). Effect if left unhandled: duplicate SELLs fall harmlessly
into `unmatched` (no fabricated profit), but a duplicate BUY creates a phantom open lot.

**The discriminator (both layers share it):** a genuine repeat trade always has a fresh
BUYING/SELLING placement line between two terminals on the same slot; a snapshot re-emission never
does — so a terminal whose immediately-preceding same-slot event is an IDENTICAL terminal (same
item/type + offer-size/price/cumulative-filled/cumulative-spent, `sameTerminal()`) with nothing
re-opening the slot between is a re-emit. This is the same "impossible transition" invariant the
13:25:53/13:29:01 double-BOUGHT of a 17.4m item on slot 7 (2026-07-05, only one real) violated: a GE
slot is a state machine and cannot close twice with no offer placed between.

**Two layers, since LH1 (2026-07-05):**
- **`validateSlotTransitions()` — the LOUD INGEST validator** (`reconstruct.mjs`, called next to
  `buildEvents()` in `sync-fills.mjs` `regenerate()` and in `monitor.mjs`, BEFORE the `fills.json`
  merge). Drops the identical re-emit, `console.warn`s per drop (with item/qty/price/slot + the prior
  terminal's ts) and a dropped-count in the attended sync summary, and — because it runs pre-merge —
  a FRESH re-emit **never enters `fills.json`**. Conservative: manual slots 8/9 are exempt; a same-slot
  double-terminal that DIFFERS in any field warns but is KEPT (fail toward preserving data). The loud
  warnings are gated to the attended sync (`warn:false` in the `--local`/`watch-log.mjs`/`monitor.mjs`
  callers, which re-read the whole log every run and would otherwise re-print months-old re-emits every
  tick). Fixtures in `pipeline/validateslots.test.mjs`.
- **`dedupeSnapshots()` — the SILENT DERIVATION backstop** (inside `reconstruct()`). Catches the same
  class at the positions.json layer, so a phantom ALREADY persisted in an older (pre-LH1) `fills.json`
  — which the ingest validator never re-reads — is still dropped from the derived view. Fixtures
  (a: blowpipe dup pair, b: genuine same-price repeat with a placement between → NOT deduped,
  c: dup straddling an EMPTY-burst) live in `pipeline/reconstruct.test.mjs`.
  **NB — no manual-slot exemption here** (unlike the loud validator above): `dedupeSnapshots` keys purely
  on slot, so two IDENTICAL manual `complete` terminals on the SAME slot 8 (or 9) silently collapse to one.
  A same-item/qty/price **multi-window backfill** must give each window a DISTINCT slot via
  `add-manual-fill.mjs --slot <n>` (≥ 8), or a window is lost with no warning (the 2026-07-10 soul-rune
  two-25k-window backfill hit exactly this — both buys on slot 8 merged; slot 8 + slot 9 fixed it).

So `fills.json` is no longer guaranteed to archive both raw lines of a fresh re-emit (LH1 filters it
at ingest); a pre-LH1 archive that still carries a duplicate pair is handled correctly by the
derivation backstop and is cleaned out of the archive on any re-sync where the phantom no longer
survives ingest. The old **interim manual procedure** — scan after each session for same-item/
same-price terminal pairs minutes apart and tombstone the later one with `add-manual-fill.mjs
--remove <eventId>` — is **no longer needed** for this class. (`REMOVE` tombstones remain the
correction mechanism for genuine mislogged events — see §5.1.) Note: `outcomes.mjs` calls
`collapseOffers`/`matchTrades` directly (not through `reconstruct()` or the ingest validator), so its
campaign boundaries do not yet get this dedupe — tracked as a Discovered followup in PLAN.md.

## 11. Outcomes dataset (O1 — the algorithm-feedback foundation)

The pipeline captured *what filled*; O1 adds *what the tool said* and *the market context at
placement*, so every offer's full story is recoverable and F1 (algorithm feedback) becomes a
query rather than a re-derivation. Three pieces:

### 11.1 `suggestions.jsonl` — the suggestions ledger (TRACKED, append-only)
Repo-root, committed. `quote.mjs` (per-item **and** `--positions`), `screen.mjs` (each rated
niche row), and `watch.mjs` (each held/target read) append every emitted recommendation **at
emit time, unconditionally**, via the shared `pipeline/lib/suggestlog.mjs`. One JSON object per line:
```
{ ts, script, mode, params, itemId, quickBuy, optBuy, quickSell, optSell, mom, regime, class, verdict, volSrc?, grade?, depth? }
```
`ts` = unix seconds. `class` = the item-type/liquidity label **as computed then** (the logic
evolves; recomputing later would rewrite history, so it is snapshotted — coarse `liqClass()` for
quote/screen, `watch.mjs`'s richer `classify()` taxonomy for watch). `verdict` = the emitted
action string where the script produces one (position verdict / grade / watch action), else null.
**`grade` (AZ-forward 2026-07-12, lean-included):** the rating LETTER as rendered then (`'S+'…'D'`,
incl. any thin/sub-floor cap) — only `screen.mjs` computes one, so quote/watch rows omit it; absent on
all older rows (consumers treat absent as unknown). **`depth` (AZ-forward 2026-07-12, lean-included):**
`{hpv, lpv}` off `computeQuote`'s `row.pressure` — the realized trailing-24h two-sided flow at emit, a
FLOW PROXY not an order book (cite with the pressure derivation's shortcomings); the live SPREAD
snapshot is already `quickSell − quickBuy` on every row, deliberately not duplicated. The full
lean-field inventory lives in the `suggestlog.mjs` header (the ONE schema home).
**`volSrc` (SF-3 — `'bulk'` | `'peritem'`, lean-included):** WHICH `/24h` endpoint the volume behind
`class` came from — `screen.mjs` reads the whole-market bulk `/24h` (`loadAll24h`/`all24h.json`) so it
always logs `'bulk'`; `quote.mjs` fetches per-item `/24h`, but when a recent scan left `all24h.json`
WARM (within its 10-min TTL) it reuses that bulk volume for `class` (a fetch-free file read via
`loadAll24hWarm`, NEVER forcing the ~4000-item bulk dump for a 1-item ask) and logs `'bulk'` too —
converging with screen; a cold quote keeps its per-item volume and logs `'peritem'`. The point: the two
scripts sample `/24h` at different instants, so the same item could log a DIFFERENT `class` across them
(the polluted quantity is `volDay = min(hpv,lpv)` itself; re-deriving from the stored `volDay` doesn't
launder it). `volSrc` lets F1 bucket/normalize the two sources; the warm read converges them for free
when the data is on disk. Decided by the pure `classAndSource(row, id, warmBulkMap)` in
`suggestlog.mjs`; `watch.mjs` supplies no `volSrc` (its `classify()` label isn't a `volDay` class) so
its rows stay byte-identical. Pinned by `pipeline/sf3-volsrc.test.mjs`.
No PII — ids/prices/timestamps only (the repo is public). `sync-fills.mjs`'s commit set now
includes it when present (same add-only-these-files discipline as `screen.json`). NB: `watch.mjs`
is still read-only w.r.t. the market/positions — this analytics append is the sole exception, and
its header guardrail says so.

**Rotation/compaction (SR1).** The active root file is bounded to the CURRENT calendar month.
On every append `logSuggestions` first calls `rotateLedger()` (guarded by a cheap first-line-month
check, so it only does real work once the oldest row predates the current month): each completed
month is moved OUT of the deploy root into `pipeline/suggestions-archive/suggestions-YYYY-MM.jsonl`.
Rotation NEVER drops a row — it writes each archive fully (existing ∪ new, deduped, tmp+rename)
*before* truncating the active file, so a crash mid-rotation leaves the rows in the active file and
a re-run re-archives them idempotently. Unparseable / ts-less lines stay in the active file, never
discarded. The rows are F1's calibration data: **archived, never deleted.** Any full-history reader
MUST read active + archives via `readSuggestionLines` — `outcomes.mjs`'s F1 join does — since after
the first rotation the active file holds only the current month. `sync-fills.mjs` commits the
`pipeline/suggestions-archive/` dir alongside `suggestions.jsonl`. The active-ledger path stays
pinned to the repo root by `pipeline/lib/suggestlog.test.mjs` (only history relocates).

### 11.2 Historical market-context retention (`/5m?timestamp=`)
Outcome analysis reconstructs the **trailing-2h band at each historical trade placement** (same
basis as `patientTargets` / `computeQuote`'s `bandLo`/`bandHi`), which requires reading *past* 5m
windows. The wiki `/5m?timestamp=<unix÷300>` bulk endpoint serves them, and a **live spot-check
(2026-07-04)** confirmed full data returns at **1 week, 1 month, 6 months, and 2 years** back
(HTTP 200, ~1.6–1.9k items/window, per-item avgLow/High/volume intact) — so the source retains 5m
history for **at least 2 years**; band enrichment is never blocked by the endpoint for any fill in
that window. As insurance against re-fetching, the local `.cache/bands/` prune was raised **7d →
90d** (`BANDS_RETENTION_DAYS` in `marketfetch.mjs`) — local + gitignored; **band data is never
committed**.

### 11.3 `pipeline/outcomes.mjs` — the join (DERIVED, gitignored)
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
conventions, not derived values. `--report` also prints two standing honesty lines (W1): an
**F1-gate progress** line (`cells cleared / cells needed`, reusing the same constants) and a
**concentration** line (top item's share of closed lots / realised P/L, with a `>40%` caveat that
per-item reads are then mostly one sample). The `/morning` skill runs `--report` as a **weekly**
descriptive read (first morning of each calendar week — descriptive analysis starts now, calibration
stays gated). On the current dataset (103 campaigns, ~2.5 days, 83% fill rate,
realized +2.8m over 39 closed sell campaigns) the join is validated and behaves correctly — buy
placements cluster at the 0–20 band percentile, sells at 80–100, exactly the patient-pricing
signature — but only **1** cell clears n≥30, so **F1 stays gated**: the schema/pipeline are sound,
the sample simply must accrue calendar time (why O1 starts now).

## 12. Sync cadence decision — schedule ELIMINATED, sync is on-demand only (2026-07-04, G1 step 0)

**Decision (Ben, 2026-07-04):** delete the `CofferFillsSync` Task Scheduler job entirely.
`sync-fills.mjs` becomes **on-demand only** — invoked at session start by the skills that
need fresh data, or manually when Ben wants a push. There is no longer any *unattended*
writer to `main`. (Precision, added by LW1/§14: the invariant is specifically **no unattended
writer to `main`**. The local log-watcher daemon — `watch-log.mjs`, 2026-07-05 — regenerates
`fills.json`/`positions.json`/`offers.json` in the working tree on every log change but does
**zero git**, so it writes only *local files* and does **not** breach this. Publishing to
`main`/Pages stays attended and on-demand, exactly as below.) This is what unblocked the branch →
PR → merge-queue migration (G1): with
the 20-min auto-push gone, every write to `main` is attended, so `main` can require a PR +
green `checks` without a machine-identity bypass. Attended sessions (Ben, or an agent
pushing as his actor) ride a lightweight ruleset bypass on his own GitHub role; **no
separate machine/deploy-key bypass identity was created.**

**Dependency inventory (what actually needed the cadence — and why on-demand covers it):**
- **Deployed-app Ledger/Coffer freshness.** The app fetches `positions.json` same-origin.
  This is the *only* consumer that benefited from unattended freshness, and only when Ben is
  **away from the PC**. But: (a) the sync runs on the PC and reads `~/.runelite` — when the
  PC is off, no cadence (20-min or otherwise) can produce a fresh `positions.json` anyway, so
  a schedule buys freshness only during the exact hours a session would also be running and
  could sync on demand; (b) mobile freshness is M1's job (the staleness banner +
  Refresh-positions button + eventual GitHub-as-backend writes), not the scheduler's. So
  eliminating the cadence costs the away-from-PC case nothing a schedule could have saved.
- **`/morning` / `/overnight` / `/positions` reconstruction freshness.** These run on the PC
  and now **invoke `node pipeline/sync-fills.mjs` at session start** (skills updated in G1) —
  a forced sync gives them strictly fresher data than a ≤20-min-stale file ever did.
- **`suggestions.jsonl` (O1) growth.** Append-only analytics that accrues with calendar time,
  but the ACTIVE root file is now bounded to the current month by SR1 rotation (§11.1) — completed
  months roll into `pipeline/suggestions-archive/`, so the deploy-root file no longer grows
  unbounded. It does not need a *cadence*, only to be committed when a session runs a script that
  appends to it (the same on-demand sync commits both the active file and the archive dir).
- **Remote readers of `fills.json`.** None besides the app's `positions.json` path; no
  external consumer depends on sub-hour freshness.

**Consequences / what this changes:**
- The Task Scheduler job `CofferFillsSync` is **deleted** (`schtasks /Delete /TN
  CofferFillsSync /F`). The `run-fills-sync.vbs` / `run-fills-sync.cmd` wrappers were
  **excised** (chunk X2, 2026-07-05) — no longer in `pipeline/`.
- `sync-fills.mjs`'s `--auto` amend/force-push path was **excised** (chunk X2, 2026-07-05).
  It existed only to collapse the scheduler's rolling commits; with the schedule gone it was
  dead code, so it was removed rather than kept commented — **git history is the recovery
  story** if a schedule is ever wanted again. The **clobber-guard** (`syncMainToRemote`:
  fetch → ff-or-loudly-abort) still runs on every sync and is what keeps a manual sync from
  clobbering a phone push or a PR-merged `main`; every sync is now a plain fresh commit whose
  push is safely rejected on any race the guard didn't already catch.
- **`main` is protected by a ruleset** (id `18520289`) requiring a PR + the `checks` status
  check (no force-push/deletion), with a repository-admin **always** bypass. Two caveats as
  landed: **no merge queue** (this is a user-owned repo — the ruleset `merge_queue` rule is
  rejected; a queue needs an org on Team/Enterprise), and **PR creation is currently blocked
  by the gh token** (`createPullRequest` → `FORBIDDEN`; fix = `gh auth refresh -s repo`,
  interactive/Ben-only). So the on-demand sync — and attended work generally — pushes direct
  to `main` under Ben's admin bypass (verified working); the PR-for-everything flow is the
  intent once the token is refreshed. See the workflow docs (`/ship` §2/§6, CLAUDE.md gh
  section, PLAN.md dispatch model). **M1 must now assume no scheduled PC writer exists:**
  mobile freshness leans on the Refresh button + (optionally) the stretch in-cloud
  reconstruction Action, never on a background PC push.

## 13. Mobile write path — GitHub-as-backend (M1, 0.39.0)

A phone GE trade lands in the same pipeline as a PC trade with seconds of friction, and
fix-at-the-source is preserved: **the phone writes a SOURCE log line, never
`fills.json`/`positions.json`** (single-writer — only `sync-fills.mjs` writes those). Ben trades
on the official OSRS mobile client (no auto-capture possible), so this is frictionless *manual*
capture, chosen as GitHub-contents-API-with-a-fine-grained-PAT — no cloud backend, no PC-as-server.

### 13.1 `mobile-fills.log` (TRACKED, repo root, append-only)
Same line vocabulary as `coffer-manual.log` — `BOUGHT`/`SOLD`/`WITHDRAWN`/`BANKED` fill lines plus
`{"state":"REMOVE","target":"<eventId>"}` tombstones — but written to **slot 9** (mobile) so its
provenance stays visible next to desktop/CLI manual entries (slot 8) and live GE slots (0–7). It
ships with a comment-header only; comment lines (starting `#`) are ignored by `parseJsonLine()`.
The **phone owns writes** to it (via the GitHub contents API); `sync-fills.mjs` only **READS** it —
it lives at the repo root (NOT in `LOG_DIR`) and is pulled in as an extra parse source, then folded
into `fills.json`/`positions.json` through the normal reconstruction. It stays **out of the PC's
commit set** (the PC never modifies it).

### 13.2 App side (`js/github.js`, `js/ledger.js`, `js/fillslog.js`)
<!-- A3 (0.43.0): the quick-add / mobile-write code (addTrade, writeToMobileLog, renderGhSync) moved from js/ui.js to js/ledger.js. -->

On a phone the File System Access API (the desktop `coffer-manual.log` path) doesn't exist, so the
app's **GitHub sync** panel (Ledger tab) stores a **fine-grained PAT** — Contents: Read and write,
this repo only — in `localStorage`. Security: the token is never rendered back after entry, never
exported (`backup.js`'s explicit field list omits it), and never logged ("PAT updated" only). The
owner/repo derive from the Pages origin (`<owner>.github.io/<repo>/`) so no account name is
hardcoded; `cofferGhOwner`/`cofferGhRepo`/`cofferGhBranch` localStorage overrides cover custom
hosts and local testing. The Ledger quick-add routes its write — desktop FS log (slot 8) if linked,
else the mobile GitHub path (slot 9) when a token is saved — as **GET sha → PUT append**, re-GET +
retry on a 409/422 sha race (`appendMobileLines`). Backdated entries carry the true trade time (the
phantom-5-bludgeons rule). Edits/deletes on a mobile pending row are append-only (a new line + a
REMOVE tombstone), routed by an `origin:'gh'` tag. The S3 **watchlist write-back** uses the same
path (`putJsonFile` → `watchlist.json`, ids) when a token is set.

### 13.3 Multi-writer sync (see §12 + `sync-fills.mjs` `syncMainToRemote`)
The PC sync and the phone are two writers to `origin/main` with **disjoint** file sets (the PC
commits `fills.json` / `positions.json` / `offers.json` / `screen.json` / `suggestions.jsonl` (+ its
`pipeline/suggestions-archive/` when rotation has produced it); the
phone appends only `mobile-fills.log`), so a phone
push only moves `origin/main` ahead. The sync fast-forwards local main onto the moved remote BEFORE
reading logs (so the phone's line is read this run) and lands a **fresh commit** on top — never
amend/force over the phone's commit. A genuine **divergence aborts loudly (exit 1)**: under the
disjoint-writer contract it is a structural bug (an unexpected local commit, a double-writer, a
stale branch), to reconcile by hand — not to force through.

### 13.4 Freshness (the phone's PRIMARY mechanism now — no scheduled PC writer, §12)
The app shows a `generatedAt` staleness banner on the Ledger (age + a **Refresh-positions** button)
and a staleness chip on the Coffer. The Refresh button is a **same-origin re-fetch** of
`positions.json` — it CANNOT regenerate it (that needs the PC's RuneLite log + a sync run). Design
copy says so. Mobile-entered lines render immediately as optimistic `pending` rows, dropped once a
`positions.json` with a newer `generatedAt` absorbs them.

### 13.5 Stretch (not built) — PC-free reconstruction
A GitHub Action on pushes touching `mobile-fills.log` could merge + rebuild + commit
`positions.json` in-cloud (`reconstruct.mjs` is pure; it must respect single-writer ownership as a
third committer and never require `.runelite` logs). Deliberately NOT built — with no PC schedule,
PC-off phone staleness *may* eventually justify it, but that's Ben's call, not an executor's. Until
then the Refresh button is the freshness path.

## 14. Local log-watcher — desk-side freshness without an unattended writer (LW1/LW2, 0.48.0; heartbeat LW3, 0.51.0)

**Origin (Ben, 2026-07-05):** "Can we have some process watch the log file and automatically
sync?" Chosen answer — **option 1: regenerate locally on every log change, never auto-commit/push.**
It gives the app at the PC live positions **and** live offers within ~seconds of every
fill/cancel/reprice while **keeping the §12 invariant fully intact** — the daemon does **zero git**.
Publishing to Pages (and therefore the phone) stays attended and on-demand, exactly as before §14.

### 14.1 `regenerate()` core + `sync-fills.mjs --local`
The reconstruction core is factored out of `sync-fills.mjs`'s `main()` into an exported, **git-free**
`regenerate({ write, logDir, repoDir })`: it reads the exchange-logger files + the repo-root
`mobile-fills.log` + `coffer-manual.log`, merges with the existing `fills.json`, reconstructs, and —
when `write` is true — writes `fills.json` / `positions.json` / `offers.json` to `repoDir` (each
only on a real content change, ignoring `generatedAt`). It performs **no git operations at all** —
the multi-writer `syncMainToRemote()` guard and the commit/push live only in the attended `main()`
wrapper. `main()` is behind the standard `import.meta.url === pathToFileURL(argv[1])` invocation
guard, so importing `regenerate()` (the daemon, the tests) never triggers a sync — no live-log read
side effect, and crucially **no git**.

- `node pipeline/sync-fills.mjs --local` runs `regenerate()` and writes the three artifacts with
  **zero git** (no fetch/ff, no commit, no push, `syncMainToRemote` never called). It is desk-side
  freshness only.
- **`--local` does NOT fold un-pulled phone writes.** `mobile-fills.log` is only as fresh as the
  local checkout — no fetch/ff happens on the local path — so a phone-pushed line the PC hasn't
  pulled is invisible until the next **attended** sync (which ff's origin/main before reading logs).
  That is acceptable: local mode serves the person sitting at the PC, who never needs the phone's
  un-pulled lines. The daemon inherits the same property.
- The attended (no-flag) path is unchanged byte-for-byte (same multi-writer guard, tombstone line,
  summaries, change-gating) **plus `offers.json` now joins its commit set** (added only when present
  on disk, alongside `fills.json`/`positions.json`/`screen.json`/`suggestions.jsonl` — never a
  blanket `git add -A`).

### 14.2 `offers.json` (TRACKED root artifact, written in BOTH modes)
A flat snapshot of the live GE offer slots, app-fetched same-origin like `positions.json`:

```
{ app:'the-coffer-offers', version:1, generatedAt:<ISO>,
  offers:[ { slot, side:'buy'|'sell', itemId, item, price, qty, filled, lastUpdateTs } ] }
```

Source: `pipeline/lib/offers.mjs` (`readOfferRows()` → `offersSnapshot()`). `side` is
`BUYING`→`buy` / `SELLING`→`sell`; `price` = offer price each; `qty` = total offer size; `filled` =
cumulative filled so far; `lastUpdateTs` = the offer line's epoch ms. **EMPTY / terminal / cancelled
slots are excluded** (only per-slot latest `BUYING`/`SELLING` states survive). Item names resolve
offline/best-effort from the shared mapping cache (`nameLookupFromCache()`, no network — falls back
to `#<id>`). The schema is deliberately **dumb and flat**; presentation is the app/future-Watch-tab's
job. It is read from the exchange-logger dir **only** (booked mobile/manual fills are not live
offers). `positions.json` still knows only booked fills — `offers.json` is what closes the
committed-capital-in-open-offers gap for the app.

### 14.3 `watch-log.mjs` — the daemon
`node pipeline/watch-log.mjs` (or the root `watch-log.cmd` wrapper) `fs.watch`es the exchange-logger
**directory** (not a single file, so log rotation is caught; `coffer-manual.log` is a sibling inside
that same dir, so manual-fill / REMOVE-tombstone edits fire the same watcher — no second watch), and
on every change runs `regenerate()` **in-process** after a ~10s debounce (which coalesces Windows'
duplicate/rename event bursts). One console line per run (`hh:mm regenerated — N events, M open
offers`); an initial pass runs at startup so the artifacts are fresh the moment it launches.

Started **manually**, dies with the terminal (Ctrl+C), **no Task Scheduler job — that is the whole
point** (a scheduled daemon would reintroduce an unattended writer). It calls the same
`regenerate()` core `--local` runs, so there is no second copy of the pipeline to drift. It does
**zero git, ever** — and does **not** fold un-pulled phone writes (§14.1). Because it shares the
reconstruction chain, a client-restart EMPTY burst regenerates identical artifacts harmlessly
(`buildEvents()` ignores EMPTY lines).

**Liveness heartbeat (LW3, 0.51.0).** `regenerate()` only rewrites `positions.json` when the BOOKED
positions change — so during a quiet no-fill stretch `positions.generatedAt` legitimately freezes,
which is a book-change signal, NOT a daemon-liveness signal. Reading it as liveness produced a false
"is the watcher running?" alarm on the localhost stamp. To measure liveness independently, the daemon
also writes a tiny gitignored root-level `heartbeat.json` (`{app:'the-coffer-heartbeat',
generatedAt:<ISO>}`) once at startup and then every `HEARTBEAT_MS` (30s) via `setInterval`, wrapped in
try/catch (a heartbeat failure never crashes the daemon). It lands at the repo ROOT (imported
`REPO_DIR` from `sync-fills.mjs`, honoring the same `--repo-dir` override the `regenerate()` call
uses) so the same-origin `serve` can fetch it. The heartbeat does **ZERO git and ZERO log re-read** —
pure liveness, regenerating nothing; it is explicitly NOT the "polling fallback" the plan avoided, and
because `heartbeat.json` is gitignored (never committed/pushed) the §12 "no unattended writer to
`main`" invariant is preserved.

### 14.4 The LW2 consumer — localhost live-refresh (app, 0.48.0)
The app is the daemon's consumer. On localhost (`IS_LOCALHOST` in `js/state.js` —
`location.hostname` localhost/127.0.0.1), the app polls `positions.json` + `offers.json` +
`heartbeat.json` every ~30s (`js/ledger.js` `startLocalPoll`), compares `generatedAt`, and only on a
change re-runs the **existing M1 `syncFills()` merge** (no second merge path) and stashes the offers
on `STATE.offers`/`STATE.offersTs` (consumed by the **Watch tab**, 0.49.0 `js/watch.js`, which renders
them as verdict-tagged offer rows behind a staleness banner). It renders a **two-part** freshness
stamp (LW3) **instead of** the M1 banner + Refresh button — the two never double-banner:
- **`watcher live hh:mm`** from `heartbeat.json` (`STATE.heartbeatTs`, `fetchHeartbeat`) — the real
  daemon-liveness line. If the heartbeat is older than `HEARTBEAT_STALE_MS` (90s, ~3 missed beats) it
  turns into a red **"watcher down? — restart node pipeline/watch-log.mjs"** warning. THIS line, not
  the book line, carries the liveness alarm now.
- **`book synced hh:mm · N open offers`** from `positions.json` (`STATE.fillsTs`) — informational,
  **no age warning** (a frozen book is normal during quiet trading; the old ~10-min book-age warning
  was the false alarm and is removed).

On `bensumm.github.io` `IS_LOCALHOST` is false and behavior is byte-identical to 0.47.0 (M1 banner +
button remain) — all heartbeat logic lives inside the localhost-only branch. Change detections log
under the `'system'` scope. Net effect: with the daemon running, a fill/cancel/reprice shows in the
desk app within ~40s (debounce + poll) with no keystrokes and **zero new git commits**, and the
"watcher live" line stays fresh even across a long no-fill stretch.
