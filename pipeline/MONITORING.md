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

The **durable, session-independent** home for this logic is the app itself. The
**Refresh-positions button shipped** (0.39.0, M1) — a same-origin `positions.json` re-fetch;
what remains unbuilt is the in-app **break-even/regime deterioration check** on the Ledger. So
today this doc + `monitor.mjs`/`watch.mjs` are still how the *judgment* half of the workflow
runs; the app owns freshness.

## The tool: `pipeline/monitor.mjs`

```
node pipeline/monitor.mjs
```

Print-only — it never writes trade data. Each run emits:

- **log freshness** — minutes since the newest exchange-log line, on the wall clock (so a
  stalled/idle log is distinguishable from a live-but-quiet market).
- **restart-blindness warning (LH2)** — a `⚠ log may be blind` header line (in both `monitor.mjs`
  and `watch.mjs`) when the log has gone stale (≥20m) AND shows no active offers AND you hold open
  inventory: the post-restart state where the plugin has re-emitted nothing, so resting offers read
  as missing. It changes no verdict — it just names the failure so a session doesn't chase "vanished"
  offers (restart-check RuneLite or nudge a slot to force a re-emit). Pure line assembler in
  `pipeline/lib/logblind.mjs` (`blindWarningLine`), fixtures in `pipeline/logblind.test.mjs`.
- **ACTIVE OFFERS** — offers open right now (per-slot latest `BUYING`/`SELLING` state),
  with filled/total and the offer price.
- **FILLS / CANCELS (last 30m)** — recent terminal events with executed price.
- **HELD POSITIONS** — qty, cost basis, and **break-even** (shared `breakEven()`, tax-capped —
  see CLAUDE.md "Break-even") per open lot, plus whether it's currently listed in a sell offer.

**Data sources, and why:**
- Offers/fills come from the RuneLite Exchange Logger (`~/.runelite/exchange-logger/`) —
  real-time.
- Held positions are reconstructed **IN-MEMORY from the live exchange log** via the shared
  pipeline FIFO (`reconstruct.mjs`), *not* read from `positions.json` — so `monitor.mjs`'s
  held count is **real-time**, with no sync-file lag. (`watch.mjs`, by contrast, *does* read
  `positions.json`; the two are reconciled because both run the same canonical
  WITHDRAWN/BANKED-aware `reconstruct.mjs` chain — see the `watch.mjs` note below.) A naive
  re-sum of terminal log events would double-count RuneLite's re-logged/duplicate terminal
  lines (found live 2026-07-02: an 11:01 buy re-logged identically at 11:15 → a +5 phantom),
  but `reconstruct()` runs **`dedupeSnapshots()`** (P1, 2026-07-05) first, dropping snapshot
  re-emissions before the FIFO, so the in-memory held count never phantoms. Cost basis is
  static once bought.
- **`held-override.json` reconciliation knob** (`pipeline/.cache/held-override.json`, gitignored,
  code-only — `monitor.mjs:66-80`): the Exchange Logger occasionally drops a `SOLD` event
  during fast same-second flipping, so the log can hold more buys than sells and the
  reconstruction *over*-counts held (confirmed: seeds logged 57 bought / 52 sold, real held
  0 — no FIFO can invent the missing sell input). The file maps `{ "<itemId>": "<ISO-or-unix
  since>" }` meaning "I hold 0 of this as of `<since>`; count only its log fills after that
  time." Set it when you know a position is phantom; trades after `<since>` still track
  normally, and the monitor prints `(held-override active — reconciling: …)` when it applies.
- Item names are fetched from the wiki mapping and cached 24h in `pipeline/.cache/mapping.cache.json`
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

**Per-item session context (Ben-confirmed doctrine, 2026-07-05).** The gate tree and watch alerts are stateless per tick; the agent servicing the loop is not. Maintain a running per-item dossier across the session — today's oscillation range, printed extremes and when, how each prior alert on this item resolved (noise vs. real), current ask/bid fill progress, and the entry's intent (patient band entry vs. deliberate chase) — and interpret every new alert against it before recommending action. A verdict is a prompt for judgment, not an order: a CANCEL-BID on a 1gp band breach at 1.9m/d volume reads differently from the same verdict on a thin big-ticket, and an UNDERWATER flag on a minutes-old chase entry (underwater by construction until +2%) differently from one on an hours-old patient lot.

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
  a stranded lot — exit discipline). An ask whose buy isn't booked yet in `positions.json`
  (i.e. traded since the last on-demand sync — there is no scheduled sync anymore, §12 of
  FILLS-PIPELINE.md) prints with an honest "break-even unknown, run sync-fills.mjs" note,
  never a fabricated basis.
- **Bids** get their own section + verdict vocabulary: `BID-OK` (resting inside the band),
  `BID-BEHIND` (market moved away — unlikely to fill; nudge only while the edge holds),
  `CROSSING` (at/above live instasell — fills imminent, have the exit priced), and
  **`CANCEL-BID`** (item falling or in a *reliable* 2h breakdown — a fill would be adverse
  selection: the market dropped to meet you). Only `CANCEL-BID` joins the alerts section;
  placement feedback never alerts.
- **Noise guard:** offers under `NOISE_OFFER_GP` (100k) total value are collapsed to one
  ignored line — a stray supply order never earns a verdict.
- **Window-context line (2026-07-05, the berserker-ring lesson):** every bid row (and every
  held row with a live ask) carries a `window` line — the `windowread.mjs` quantiles for the
  **coming 8 local hours** scored over the last ~7 days: bid touched k/N days, ~50%/~75% low
  levels, ~75%/~50% high levels reached, plus the resting offer's own touch/reach count. It
  is CONTEXT printed next to the verdict, never a verdict input — the 2h gate tree is
  unchanged. It exists because the stateless 2h verdicts kept firing CANCEL-BID on a bid
  whose real question was time-of-day (does this window print my level? what does tomorrow
  recover to?) — evidence that previously required a manual `windowrange.mjs` call. Same
  honesty bound: touched ≠ filled, ~7 days is a small sample.

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
is the file's staleness since the **last regeneration**. Two things now regenerate it: an on-demand
`sync-fills.mjs` run (there is no scheduled sync — §12 of FILLS-PIPELINE.md; run it at session start)
and, when running, the `watch-log.mjs` daemon (§14) that rewrites `positions.json`/`offers.json`
locally on every log change with **zero git**. `watch.mjs` prints the file's age and flags it stale
past 25m, so a very recent trade's lag is visible. Cost basis is static once bought, so lag rarely
changes a call.

**Console `watch.mjs`/`monitor.mjs` remain the zero-lag authority** — they read the exchange log
directly (`offers.mjs`, ~0 lag). The localhost app's live view (LW2, `FILLS-PIPELINE.md` §14) trails
them only by the daemon's debounce (~10s) + the app's poll (~30s); it is not the authority, and the
deployed (`bensumm.github.io`) app is still as-of-last-attended-sync. So: the app *can* now see live
offers at the desk (via `offers.json`), but for a sell-the-instant-it-moves call the console read
is still the source of truth.

**The in-app Watch tab (0.49.0, `js/watch.js`) is the at-a-glance DESK surface, not a second
authority.** It renders the same decisions this console produces — held verdicts from the shared
`momVerdict()` and offer verdicts from the shared `offerVerdict()` (both in `js/quotecore.js`, so a
bid reads BID-OK/BID-BEHIND/CROSSING/CANCEL-BID identically in the terminal and the browser) — but
against `positions.json`/`offers.json`, so **offers are only as fresh as the last sync** and are
honestly stamped/bannered as such (held quotes are live via the market API). What the tab adds over
this console is a persisted **session-context note** per held item (entry thesis + tripwire), so a
stateless CUT verdict never reads as an order. Division of labor: run the console `watch.mjs` for the
zero-lag "act now" read; glance at the Watch tab for the standing desk picture (exposure, day P/L,
which held lots want action, what filled today).

### Item-type classes → cadence + playbook

Boundaries are **tunable named constants** at the top of `watch.mjs`, not magic numbers:

- `LIQUID_FLOOR_PER_DAY = 100` — two-sided daily volume (the limiting side, `min(hi,lo)` from
  `computeQuote`) below which a book is **thin**. 100/d is the practical floor codified in
  the `/scan` skill (`.claude/skills/scan/SKILL.md`); below it, exits are unreliable
  ghost-spreads. **Two different things are both called "the floor" — don't conflate them:**
  this ~100/d is the *judgment* ghost-spread floor (in `watch.mjs`/`/scan`, "is a book liquid
  enough to trust an exit?"). `screen.mjs`'s `--floor` (default **50**) is a separate *script
  gate* — the raw per-unit `limitVol ≥ FLOOR` liquidity threshold that a candidate must clear
  (OR the `--gp-floor` gp-flow path, S1) to even enter the screen. Different purposes,
  different values.
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

Output shape (2026-07-05): a one-line **HEADLINE** (`all quiet` / `⚠ N ALERTS`, plus the
board's held/bid/target counts) with alert details directly under it → one **numbers-only
TABLE** (`Verdict | Item | Position | Quick | Optimistic | Vol/d | Mom | Regime |
Break-even` — Quick/Optimistic cells on the canonical table-v2 basis; one row per held
lot, resting offer, or target) → one compact **note line per item** (the action's first
sentence + the window read's key number) → a **SUMMARY** footer (held exposure + bid
capital totals, alert count, positions/log provenance, the `/loop` line, and the
exit-discipline reminder). Content per item:

1. **DROP / CUT ALERTS** (held breakdowns + CANCEL-BID offers), in the headline block.
   Escalation reuses the chunk-6 shared cut-trigger `momVerdict()`: a **2h breakdown on a held
   lot escalates to CUT before the lagging multi-day regime confirms** (the bludgeon-exit
   lesson). An item also alerts if it's simply UNDERWATER (`instabuy < break-even`) or its
   multi-day regime is FALLING.
2. **Live re-quoted buy-at / list-at**, `break-even`-floored — never list below the shared
   `breakEven()` (tax-capped; see CLAUDE.md "Break-even").
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

---

## Push notifications on market events (`pipeline/alerts.mjs`) — PLAN chunk N1

Ben's phone should buzz on the market events that matter while he's away, and **stay silent
otherwise**. This is the design contract; the trigger ENGINE ships as `pipeline/alerts.mjs`
(delivery-agnostic — see the mechanism decision below). No app involvement: this is
pipeline + a scheduled session only, exactly like the monitoring routine above.

### The three trigger classes

1. **POSITION** — a held position's verdict escalates to **CUT / CUT-CANDIDATE**, or
   **Momentum hits `↓↓`** (a *strong* 2h breakdown — `mom==='breakdown'` and the pre-clamp
   overshoot ≥ `MOM_STRONG_PCT`) on a held item. The verdict comes from the **shared
   `momVerdict()` gate tree** in `js/quotecore.js` — byte-identical to `quote.mjs
   --positions` and the app's position review, never re-derived. No new prediction logic:
   an alert fires on the *same* gate-tree evidence a CUT prints on. The falling-regime +
   underwater CUT (the 0.20.0 clear rule, which `momVerdict` returns `null` for and
   `quote.mjs`'s wrapper labels) is included as a fourth escalation path.
2. **FILL** — a resting GE offer **filled/completed**, read from the exchange log via
   `offers.mjs`/`readExchangeLog()` (the same source `monitor.mjs` uses). Each terminal
   `BOUGHT`/`SOLD` line in the last `FILL_WINDOW_MIN` is a distinct event.
3. **PRICE** — a live price crosses an **explicit named alert** ("tell me if X breaks Y"),
   read from the tracked repo-root **`alerts.json`**. Basis is the live mid
   (`(instabuy+instasell)/2` from `/latest`) — one symmetric reference for both directions.

### The transition-only rule (the whole point)

Every class fires on a **state CHANGE vs the last run, never on a level**. Last-run state
lives in a small **gitignored** file `pipeline/.cache/.alerts-state.json` (`held` verdicts,
fired-`fills` keys, `price`-cross state). So: the **first run seeds** state and reports only
genuinely-new events; a **second run against an unchanged market emits nothing at all**; and
only a real transition — a fresh verdict, a new terminal fill line, a first price cross —
prints. A persistent breach (an item that stays underwater, a price that stays past its
threshold) does **not** re-buzz.

Structured output: each alert is **one JSON line + one human line on stdout**; diagnostics go
to **stderr**, so **empty stdout literally means nothing fired** (the delivery session keys
off that). `--dry-run` detects + emits without writing state (for testing / previewing).

### Named constants (tune in `alerts.mjs`, never inline)

- `ALERT_COOLDOWN_MIN = 60` — a POSITION or PRICE alert for the same (class, item) won't
  re-fire within this window even if the state oscillates (anti-flap). A genuine new
  transition is still *required*; the cooldown only throttles a chattering signal. **Not**
  applied to fills — each fill is a discrete event.
- `FILL_WINDOW_MIN = 60` — how far back each run scans the log for terminal fills.
- `FILL_DEDUPE_TTL_MIN = 720` — how long a fired fill-event key is remembered so a
  still-in-window terminal line isn't re-alerted next run (must exceed `FILL_WINDOW_MIN`).
- `MOM_STRONG_PCT` (imported from `quotecore.js`, the same `↓↓`/`↑↑` threshold the table uses).

### Quiet hours (S2 posture clock) — EXCEPT fills

POSITION and PRICE alerts are **suppressed during quiet hours** (22:00–06:00 local, via the
shared `isOvernightNow()` — the same S2 overnight window) so the phone doesn't buzz
overnight. A suppressed transition is deliberately **NOT committed to state**, so it
**re-surfaces and fires once at the first run after 06:00** — you don't lose an overnight
escalation, you just get it in the morning. **FILLS are exempt**: a completed trade always
notifies, day or night (a fill is money that changed hands, not a judgment call you can defer).

### Named price alerts — `alerts.json`

Tracked repo-root file, an array of `{ itemId, direction: "above"|"below", price, note? }`.
`"above"` fires when the mid rises to/through `price`; `"below"` when it falls to/through it.
**Edited in sessions for now** ("add a price alert on X at Y" → append an entry); an app-side
editor is out of scope for N1. Item ids/prices only — no PII (already public in this repo).
Ships empty (`[]`).

### Delivery mechanism — decision, framed for Ben (trial (a) before committing)

The engine emits; *something* must run it and push the result. Three options, in
recommended order:

- **(a) Scheduled Claude Code background session + the harness `PushNotification` tool —
  RECOMMENDED TRIAL.** A Cron/`/schedule` routine runs `node pipeline/alerts.mjs` every few
  minutes and calls its own `PushNotification` on each emitted human line. **Zero new infra**
  (no topic, no server, no Actions), notifications land in Ben's Claude app, and the session
  can add judgment (e.g. collapse three alerts into one message). This is the intended path
  to **trial live first** before anything heavier is built.
- **(b) `ntfy.sh` topic pushed from a Task Scheduler script** — no Claude dependency, native
  phone push. Caveats: an ntfy topic name is effectively a public channel, so content stays
  item-names/prices-only (already public here) on an **obscure, unguessable topic name**;
  and — named honestly — **G1 just *deleted* the only scheduled job** (`CofferFillsSync`) on
  cadence-elimination grounds. A new **unattended** scheduler is a *different* tradeoff than
  the git-push cadence G1 killed (this one only *reads* + pushes a notification, never writes
  `main`), but re-introducing "a thing that runs on a timer on Ben's PC" is exactly what G1
  moved away from — so (b) is a deliberate step back toward scheduling, taken only if (a)'s
  trial shows a real need for Claude-independent push.
- **(c) GitHub Actions + email** — last resort. Slowest (cron granularity + mail latency),
  runs on a public-log runner, and can't see `~/.runelite` so it's blind to fill events
  (class 2) — only the market-fetch classes would work. Named for completeness; not intended.

**Status: option (a) is to be trialed live before any delivery mechanism is committed.** The
engine (`alerts.mjs`) is delivery-agnostic on purpose so the trial needs no engine changes,
and switching to (b)/(c) later is a change of *who runs it*, not *what it computes*.
