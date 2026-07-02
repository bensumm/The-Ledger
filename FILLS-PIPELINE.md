# The Coffer — Fill-Data Pipeline (handoff for Claude Code)

> Written 2026-07-01 in a Claude mobile session. This doc transfers full context to a
> Claude Code instance on Ben's Windows machine. Read it top to bottom before touching
> anything. The goal: close the feedback loop between The Coffer's trade suggestions
> and real GE trades captured by RuneLite.

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

- Trades placed outside RuneLite (mobile client) are invisible to the plugin. Ben says
  he trades desktop-only. Fallback: screenshot of in-game GE history → any Claude
  session can transcribe to schema-conformant JSON for manual merge.
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
      see the ADAPTER comment in `sync-fills.mjs`. Also: the plugin never emits a
      distinct cancelled state (goes straight to `EMPTY`), handled by a
      sequence-aware pass (`buildEvents()`) instead of per-line parsing.
- [x] Scheduled task running; fills.json updating in the repo and served by Pages —
      Task Scheduler job `CofferFillsSync`, every 20 min, runs
      `wscript.exe run-fills-sync.vbs` (hidden wrapper around `run-fills-sync.cmd`,
      which cd's into the repo and runs `node sync-fills.mjs --auto`). The `--auto`
      flag makes it amend its own previous commit + force-push instead of piling up
      commits (see the git section of `sync-fills.mjs`). An "at logon" trigger was
      attempted but is blocked (`Access is denied`) in this environment even at
      limited run-level — not pursued further since the 20-min interval already
      catches up after sleep/logon within 20 minutes.
- [x] Sell-tax gross-vs-net question answered empirically and recorded here (§5) —
      `spent`/`worth` is gross, not post-tax. Also surfaced that execution price can
      differ from the quoted offer price even on a full fill.
- [ ] Then: tool-side fetch+merge (§6.1) as the first index.html change
