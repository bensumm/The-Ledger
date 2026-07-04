# Live position monitoring + deterioration-watch routine

A read-only companion to the fill pipeline: watch open GE offers and held positions in
real time, and get HOLD / WATCH / CUT guidance as positions move. This is the routine an
agent (or a person) follows when running a polling loop over live trades. It caught a DFS
band-bottom deterioration and a seed over-cap during the 2026-07-02 session.

> **What "position" means (Ben's definition, 2026-07-04): any committed capital — held
> inventory PLUS every active GE offer.** A resting BUY is capital committed to buying; a
> resting SELL is held inventory being sold. `positions.json` only knows *booked fills*, so
> tooling that reads only it misses the offer half — the shared reader is `offers.mjs`.
>
> **Two tools, two jobs.** `monitor.mjs` (below) is the **log-state snapshot** — your
> resting offers, recent fills/cancels, held count — parsed from the exchange log, no market
> fetch. `watch.mjs` ([Adaptive routine](#adaptive-item-type-aware-routine-pipelinewatchmjs))
> is the **market side** — it re-quotes every position (held lots AND active offers) plus any
> target items, classifies each by item TYPE, and drives an active human session with per-item
> cadence, drop/CUT alerts, and risk reads. Run `monitor.mjs` for the raw log state; run
> `watch.mjs` to decide what to do.

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
4. **Deterioration watch — the underwater triage gate tree (PLAN-3).** For each **held
   position** where live instabuy < break-even, the verdict comes from the shared
   `momVerdict()` gate tree in `js/quotecore.js` (identical in `watch.mjs`,
   `quote.mjs --positions`, and the app's position review — the tooling emits it, you don't
   hand-run it). Each gate defers **only on positive evidence**; ambiguity always falls
   through to the cut discipline, so a genuine breakdown still cuts exactly as before.
   - **GATE 0 — is this reading even a price?** A **stale** (`/latest` aged past a
     print-interval-scaled threshold), **inverted** (a crossed feed — live instasell above the
     live instabuy, so `quoteOrdered()` fails; Q1), **one-sided**, or **too-sparse** quote →
     **NO-READ**: no price action off it; keep any ask ≥ break-even and re-check at the next
     liquid window. A *missing* instabuy is NO-READ, **never** CUT (you cannot price a cut off
     a price that doesn't exist).
   - **GATE 1 — is it the clock?** Underwater at a **quiet** window (2h activity well below
     the item's typical) that the **same clock window dipped into and recovered from ~24h
     ago** → **DIURNAL-WATCH**: hold ≥ break-even, do **not** cut into the trough. Spent
     statelessly — once *this* window is liquid (not quiet) and still underwater, the check no
     longer fires and it falls through to Gate 2.
   - **GATE 2 — what kind of down-move?** A `mom==='breakdown'` that is a **one-off shock**
     (a ≤3-window volume-spike gap that then stabilized) on a small lot with an intact regime
     → **SHOCK-WATCH** (one more cycle); a **bleed**, a big-ticket lot, or an ambiguous shape
     → the existing **CUT / LIST-TO-CLEAR** matrix.
   - **D-escalation — persistence.** Clean `mom` but the band has printed below break-even
     **through a liquid (busy-hour) window** → **CUT-CANDIDATE**: a genuine daily trough
     recovers when the book fills, so this is persistence, not the clock. This is what stops a
     flat-regime underwater lot sitting on WATCH forever.
   - **regime falling** (drift ≤ −5%) with no live break still lands **CUT-CANDIDATE** (list
     to clear at the instabuy — take the small loss before a bigger one; the 0.20.0
     falling-item rule).
   - **24h-cycle guard (unchanged) — input vs. decision.** The guard still governs its own
     question: *"the price is genuinely lower; is there a **proven, backtested hour-of-day
     recovery pattern** that justifies holding?"* — default **cut** unless proven. Daily/hourly
     cycles are usually noise; the guard exists to avoid cutting the rare item with a real
     daily rhythm, not to rationalize holding losers. Gates 0–1 govern a **different**
     question — *"is this reading a price at all?"* — and reject the **input**; they never
     defer a **decision** made on a good input. The seed incident was the second question
     misfiled as the first: a liquidity artifact adjudicated under the price-cycle standard of
     evidence, and (correctly, under that standard) lost.
5. **Flag** if an item's total held qty exceeds its exposure cap, or if held inventory is
   **UNLISTED** (bought but not in a sell offer).
6. Keep each report tight — one line if nothing changed. Only re-run a full multi-day trend
   for a brand-new position or an offer clearly moving against us.

## Cadence

Cron-style loop (session-only) at ~5 min is comfortable; GE offers fill over minutes to
hours. Tighten to ~2 min during active flipping, widen when idle. Nothing here writes — it's
safe to poll as often as you like; the only cost is API calls in step 3–4.

---

## Adaptive item-type-aware routine (`pipeline/watch.mjs`)

`monitor.mjs`'s routine runs one flat cadence and one set of rules for every position. But a
thin big-ticket volatile item and a liquid ranging scalp candidate demand **different**
attention and **different** playbooks. `watch.mjs` classifies each held/target item by TYPE
and adapts cadence + playbook + alert thresholds to it. It's the driver for an active,
human-executed flipping session on a tight 1–3 min loop.

```
node pipeline/watch.mjs                        # every position: held lots + active GE offers
node pipeline/watch.mjs "Crystal seed" 23959   # also watch these targets (buy-side)
node pipeline/watch.mjs --targets-only "Ranarr weed"   # skip held+offers, watch only these
```

**Active offers are first-class positions** (see the definition at the top of this doc).
The default run reads the live exchange log via `offers.mjs` (~0 lag) alongside
`positions.json`:
- **Asks** annotate their held row — `listed n/m @ X`, or `NOT LISTED` (an unlisted hold is
  a stranded lot — exit discipline). An ask whose buy isn't booked yet (inside the ~20m sync
  window) prints with an honest "break-even unknown, run sync-fills.mjs" note, never a
  fabricated basis.
- **Bids** get their own section + verdict vocabulary: `BID-OK` (resting inside the band),
  `BID-BEHIND` (market moved away — unlikely to fill; nudge only while the edge holds),
  `CROSSING` (at/above live instasell — fills imminent, have the exit priced), and
  **`CANCEL-BID`** (item falling or in a *reliable* 2h breakdown — a fill would be adverse
  selection: the market dropped to meet you). Only `CANCEL-BID` joins the alerts section;
  placement feedback never alerts.
- **Noise guard:** offers under `NOISE_OFFER_GP` (100k) total value are collapsed to one
  ignored line — a stray supply order never earns a verdict.

**Read-only, human-executed decision support — the hard guardrail.** This tool NEVER places
or cancels a GE offer, not even stubbed. Automating GE interaction is botting and bannable.
It tells you *when* to act; **you** click. It reads `positions.json` + live prices and writes
nothing.

**All quote/tax/regime/momentum math is `js/quotecore.js`** (`computeQuote`, `regimeDrift`/
`regimeLabel`, `breakEven`, `momVerdict`, `BIG_TICKET_GP`) — the same module the app and the
`quote.mjs`/`screen.mjs` scripts use, so a verdict here can't drift from the app's.

**Held basis = `positions.json` open lots**, *not* re-derived in-memory from the log the way
`monitor.mjs` does. Both are now correct — since chunk 8 they share the SAME canonical
WITHDRAWN/BANKED-aware `reconstruct.mjs` chain, so the held count agrees either way.
`positions.json` (written by `sync-fills.mjs` via `reconstruct.mjs`) is chosen for `watch.mjs`
because it's the already-persisted pipeline output — no log re-parse needed. The only trade-off
is the ~20m sync lag — `watch.mjs` prints the file's age and flags it stale past 25m, so a very
recent trade's lag is visible. Cost basis is static once bought, so lag rarely changes a call.

### Item-type classes → cadence + playbook

Boundaries are **tunable named constants** at the top of `watch.mjs`, not magic numbers:

- `LIQUID_FLOOR_PER_DAY = 100` — two-sided daily volume (the limiting side, `min(hi,lo)` from
  `computeQuote`) below which a book is **thin**. 100/d is the practical floor codified in
  the `/scan` skill (`.claude/skills/scan/SKILL.md`); below it, exits are unreliable
  ghost-spreads.
- `BIG_TICKET_UNIT_GP = 1_000_000` — per-**unit** price at/above which one unit is large
  capital, so a drop is expensive per fill (bludgeon/lightbearer/seed territory). Distinct
  from chunk-6 `BIG_TICKET_GP` (a whole-**lot** qty×cost threshold, which `momVerdict` still
  owns) — this one only steers cadence/class.
- `WIDE_SPREAD_PCT = 3` — `(instabuy−instasell)/instasell` at/above which the intraday band
  is wide enough to *be* the edge. Tax is 2% on the sell and CLAUDE.md wants meaningfully
  >~0.5% after tax, so ~3% gross is the smallest band worth laddering.

Classification is priority-ordered so a hazard class always wins and the scalp class is only
reachable on a liquid, flat-regime, wide-band item — the market-make playbook can **never**
attach to a trending item:

| Class | Trigger | Cadence | Playbook |
|---|---|---|---|
| `FALLING` | regime falling **or** (`mom==='breakdown'` **and** the quote is reliable — PLAN-3 Gate 0) | **1m** | cut/clear discipline; targets → SKIP (don't buy a drop) |
| `THIN_BIG_TICKET_VOLATILE` | thin (`vol<floor`) & unit ≥ 1m | **1m** | hair-trigger cut; strong adverse-selection warning |
| `LIQUID_RANGING_WIDE` | liquid & flat regime & spread ≥ 3% | **2m** | **SCALP** — ladder band low→top; the only class that gets market-making |
| `STABLE_LIQUID` | liquid & confirmed regime, narrow band | **3m** | ordinary patient flip; glance |
| `THIN_OTHER` | thin, not big-ticket | **2m** | caution; small size; adverse-selection warning |
| `UNKNOWN` | liquid but regime unconfirmed / vol unknown | **2m** | caution until regime confirms |

The loop runs at **one** interval; `watch.mjs` recommends the **tightest** cadence across
everything you're monitoring (so the most urgent item is polled often enough) and prints the
ready-to-paste `/loop` command:

```
/loop 1m node pipeline/watch.mjs "Crystal seed"
```

`/loop <interval> <command>` (the `/loop` skill) re-runs on that fixed interval; report only
what changed vs the prior tick. 1–3 min matches GE fill dynamics — offers fill over minutes to
hours, so a sub-minute loop just burns API calls.

### What each tick surfaces

1. **DROP / CUT ALERTS** (held only — you can't be underwater on what you don't hold).
   Escalation reuses the chunk-6 shared cut-trigger `momVerdict()`: a **2h breakdown on a held
   lot escalates to CUT before the lagging multi-day regime confirms** (the bludgeon-exit
   lesson). An item also alerts if it's simply UNDERWATER (`instabuy < break-even`) or its
   multi-day regime is FALLING.
2. **Live re-quoted buy-at / list-at**, `break-even`-floored — never list below
   `ceil(cost/0.98)`.
3. **Per-item RISK read**: spread width, two-sided liquidity (limiting side), regime, unit
   ticket / capital exposure, and an **adverse-selection** warning for any aggressive low bid
   (`optBuy < quickBuy`) outside a ranging book — a fill at that low bid usually means the
   market dropped to meet it, so you often have no exit margin. The scalp/market-make note is
   **gated to `LIQUID_RANGING_WIDE` only**.

### Honest sell-side framing (read this before repricing a sell)

**You cannot "stay ahead of a drop" by chasing your ask down — that is just selling cheaper.**
`watch.mjs` never frames a sell-side move as out-running the market. A downward reprice is one
of exactly two things, and the tool says which:

- **Downtrend (FALLING / breakdown)** → repricing down is **controlled loss-taking**: you're
  choosing to stop the bleed and free the capital, not beating the market. `CUT`/`LIST-TO-CLEAR`
  at the instabuy.
- **Ranging (flat regime, wide band)** → listing at the band top **realizes the band**; that's
  the only regime where patience earns a premium. If it flips to breakdown, `momVerdict`
  switches the same lot to clear-vs-hold — don't defend the ask down.

### Exit discipline (memory `opportunity-cost-can-beat-patient-hold`)

Set the exit **at entry** (the SCALP-BUY line prints the paired sell target), don't leave a
**stranded ask** if the band shifts, and **cut on breakdown rather than hoping** — a lagging
multi-day regime floor can't protect a same-day softening call. On a thin/softening book, the
flat patient premium/unit rarely beats freeing the locked capital; clear at the instabuy and
redeploy.
