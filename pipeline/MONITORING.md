# Live position monitoring + deterioration-watch routine

A read-only companion to the fill pipeline: watch open GE offers and held positions in
real time, and get HOLD / WATCH / CUT guidance as positions move. This is the routine an
agent (or a person) follows when running a polling loop over live trades. It caught a DFS
band-bottom deterioration and a seed over-cap during the 2026-07-02 session.

The **durable, session-independent** home for this logic is the app itself — the
Refresh-positions button + a break-even/regime check on the Ledger (see CLAUDE.md
"Open followups"). Until that exists, this doc + `monitor.mjs` are how the workflow runs.

## The tool: `pipeline/monitor.mjs`

```
node pipeline/monitor.mjs
```

Print-only — it never writes trade data. Each run emits:

- **log freshness** — minutes since the newest exchange-log line, on the wall clock (so a
  stalled/idle log is distinguishable from a live-but-quiet market).
- **ACTIVE OFFERS** — offers open right now (per-slot latest `BUYING`/`SELLING` state),
  with filled/total and the offer price.
- **FILLS / CANCELS (last 30m)** — recent terminal events with executed price.
- **HELD POSITIONS** — qty, cost basis, and **break-even = `ceil(cost / 0.98)`** per open
  lot, plus whether it's currently listed in a sell offer.

**Data sources, and why:**
- Offers/fills come from the RuneLite Exchange Logger (`~/.runelite/exchange-logger/`) —
  real-time.
- Held positions come from **`positions.json`** (the pipeline's `collapseOffers` +
  `matchTrades` FIFO), *not* a re-parse of the log. A naive re-sum of terminal log events
  double-counts re-logged/duplicate `BOUGHT` lines (found live 2026-07-02: an 11:01 buy
  re-logged identically at 11:15 → a +5 phantom). `positions.json` already handles dedup,
  cancels, partial fills, and pre-log inventory. The trade-off is its ~20m sync lag; the
  tool prints the file's age so recent-trade lag is visible. Cost basis is static once
  bought, so the lag rarely matters for deterioration calls.
- Item names are fetched from the wiki mapping and cached 24h in `mapping.cache.json`
  (gitignored).

## The polling routine (per tick)

1. Run `node pipeline/monitor.mjs`.
2. Report **only changes** vs the prior tick: new fills, cancels, newly placed offers,
   offers now stale vs market, newly closed flips (net after the 2% tax from actual fills).
   Ignore `EMPTY` slot housekeeping (`item:0`).
3. For each **active offer**, fetch live `/latest?id=<item>` and assess fill likelihood
   (bid vs instasell) and restate its sell target.
4. **Deterioration watch** — for each **held position**, fetch live instabuy vs break-even:
   - `instabuy >= break-even` → fine; hold / list at target.
   - `instabuy < break-even` (underwater) → pull the 6h **regime drift** (recent-3-day vs
     prior-~2-week median):
     - **regime flat** (drift > −5%): **WATCH** — band oscillation; hold at/above
       break-even, do **not** cut.
     - **regime falling** (drift ≤ −5%): **CUT-CANDIDATE** — recommend getting out (list to
       clear at the instabuy; take the small loss before a bigger one — the 0.20.0
       falling-item rule).
       - **24h-cycle guard (gates the cut):** only *defer* the cut if there is a **proven,
         backtested hour-of-day recovery pattern** predicting a bounce ~this time tomorrow.
         Daily/hourly cycles are usually noise (codified lesson) — **default to treating the
         deterioration as real** and recommending the cut unless the pattern is
         statistically proven. The guard exists to avoid cutting the rare item with a real
         daily rhythm, not to rationalize holding losers.
5. **Flag** if an item's total held qty exceeds its exposure cap, or if held inventory is
   **UNLISTED** (bought but not in a sell offer).
6. Keep each report tight — one line if nothing changed. Only re-run a full multi-day trend
   for a brand-new position or an offer clearly moving against us.

## Cadence

Cron-style loop (session-only) at ~5 min is comfortable; GE offers fill over minutes to
hours. Tighten to ~2 min during active flipping, widen when idle. Nothing here writes — it's
safe to poll as often as you like; the only cost is API calls in step 3–4.
