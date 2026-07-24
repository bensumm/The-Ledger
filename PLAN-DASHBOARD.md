# PLAN-DASHBOARD — the book / capital dashboard (`/book`)

**Status: BUILD-READY** (Fable, 2026-07-23 — hardened 2026-07-23, owner decisions folded same day,
file:line anchors re-verified against the current tree). Pipeline-only — no deployed-app change, no
`APP_VERSION` bump. Pure inform-only (no gates), same honesty class as the other reader commands.
Nothing below is an open question; an implementer can start chunk 1 without further input.

**Straightforwardness verdict: yes, materially simpler than a fresh feature.** Every INPUT already
exists and is already exported/reusable — `readOpenPositions`, `readOffersSnapshot`, `breakEven`,
`bookUtilization`/`totalCapital`, and `derive-cash-tiers.mjs`'s `loadDerivedCash` is a callable
library, not CLI-only. No new export is needed anywhere except the two new files this plan adds.

## Owner's final decisions (all five folded in below, not just noted)
1. **P&L rows are GROUPED** (per-item weighted-avg cost, `readOpenPositions().groups`), matching
   every other positions surface. NOT per-tranche. Decided — Risk 4 below records the accepted
   trade-off, it is no longer an open decision point.
2. **The sizer is a `--size` flag** on `read-book.mjs` (`read-book.mjs --size "<item>" [--capital
   <gp>]`), not a separate command. Default capital = the same invocation's own `deployablePool`
   (view 1's number), not a re-derived one.
3. **Live marks ride the shared per-invocation fetch, never a forced-fresh re-fetch.** `read-book.mjs`
   computes ONE item-id union up front (`heldItems ∪ restingBidItems ∪ {sizer target if --size}`),
   fetches `latest`/`ts5m` for that union exactly once, and every view (capital/slots, P&L, sizer)
   reads off that single fetched-and-age-labelled pool. This is what "resolves" the two catches the
   draft raised: the 60s-TTL cache question becomes moot (there's no cross-process cache dependency
   to reason about — see below) and the sizer's extra `marketRef` need is just "one bigger union,"
   not a second fetch pass. Every mark is labelled with its age (`computeQuote`'s
   `row.quickStale.sell` / `row.quoteAgeMin.sell`) and rendered with that label — **never a silent
   stale P&L number.**
4. **A completed-but-uncollected GE slot counts as EMPTY/free.** Accepted, intentional
   simplification — do NOT build `restartBlindSuspects`-style patching for it. Document it as a
   known simplification in the tool's own output (one caveat line), not a TODO to fix later.
5. **View (1) calls `capital-utilization.mjs` directly** (`bookUtilization`/`totalCapital`) for the
   working/parked/idle split — book-model.mjs does not reimplement that math.

## Correction found during this hardening pass — the "60s cache" is opt-in, not automatic
The original draft's Risk 1 treated `FETCH_TTL.latest = 60e3` (`marketfetch.mjs:79`) as if it were
always live. It is not: `cachedJget` (`marketfetch.mjs:92-99`) only reads/writes that file cache
when `cacheEnabled` is true, and `cacheEnabled` **defaults to OFF** (`process.env.COFFER_FETCH_CACHE
=== '1'`, `marketfetch.mjs:72`) and is currently enabled by **no command in the repo** (verified:
only `marketfetch.mjs` itself and `pipeline/test/fetchcache.test.mjs` reference
`COFFER_FETCH_CACHE`/`setFetchCache`). So today, a bare `fetchLatest(id)` call from any reader — this
one included — is a genuine live HTTP round-trip every time, not a cache hit off some other command's
recent pull; there is no cross-process staleness risk to manage because there is no cross-process
cache in play. **Decision 3 above sidesteps the whole question**: `read-book.mjs` doesn't need to
enable `COFFER_FETCH_CACHE` (and per the module's own header comment at `marketfetch.mjs:59-70`,
should not, on principle — that toggle exists for redundant re-pulls across *separate* commands
seconds apart, not this dashboard's job), because within ONE `read-book.mjs` invocation every item's
`latest` is fetched exactly once and threaded through to all three views. The only honest residual
statement is: **a `/book` run is a live snapshot at the moment it runs, aged-labelled if a mark came
from a slow slice** (this only matters for the 1h `ts1h` series the sizer's clearability needs, which
IS 15-min TTL'd but again only relevant if `COFFER_FETCH_CACHE` is ever turned on repo-wide — out of
scope here). Fold this correction in place of the old "60s not 15 min" framing; it was directionally
right (60s not 15min) but implied an automatic cache that doesn't exist yet.

## Problem / motivation
All session we hand-computed the same things: "two slots free," "leather is 15.6m tied at ~1.5%
edge," "~7–13 seeds fits the capital." There's no single view of **the state of the book right
now** — what's deployed, what's free, per-lot economics, and what a given amount of capital can buy.
This is a standing dashboard that reads existing state and renders it; it invents no new market model.

Folds together three ideas that share the same inputs (so they're ONE command, not three):
- **(1) Capital & slots** — the 8 GE slots, what's in each, deployed vs idle capital, free slots,
  and the deployable pool (the existing `derive-cash-tiers` three-tier model, via
  `capital-utilization.mjs` for the working/parked/idle split — decision 5).
- **(2) Book / P&L board** — per open lot (GROUPED — decision 1): cost basis, live mark, unrealized
  P&L, % to break-even, capital tied, days held.
- **(5) Tranche sizer** — `--size "<item>"` (decision 2): given free capital + an item →
  recommended buy size, bounded by **buy limit × clearability(volume) × capital**, with
  net-if-cycled.

## Data flow — VERIFIED (file:line, re-checked 2026-07-23)
The dashboard is a READER: existing sources → one aggregation layer (`book-model.mjs`, pure) → three
rendered views. Nothing writes.

```
positions.json (open lots)   ──readOpenPositions()──────────┐ pipeline/lib/positions.mjs:20
                                                              │ -> { pos, groups, openLots, ageMin }
offers.json (resting offers) ──readOffersSnapshot()──────────┤ pipeline/lib/offers.mjs:89
                                                              │ -> offers[] { slot, side, itemId, item,
                                                              │    price, qty, filled, lastUpdateTs }
fills.json + cash-anchor.json ─loadDerivedCash()──────────────┤ pipeline/lib/derive-cash-tiers.mjs:185
                                                              │ -> { availableCash, deployablePool,
                                                              │    liquidCapital, reservedDeep,
                                                              │    reservedCommitted, ... }         ├─▶ book-model.mjs (pure)
live marks ─fetchLatest(id), ONE call per id in the union───────┤ pipeline/lib/marketfetch.mjs:168        ─▶ view (1) capital/slots
                                                              │ -> { high, low, highTime, lowTime }   ─▶ view (2) per-lot P&L
buy-limit + in-window buys ─limitWindow()/buysByItem()────────┤ pipeline/lib/limits.mjs:46,73             ─▶ view (5) sizer
clearability (sizer only) ─vol24FromInputs()/fetchTs(id,'1h')─┤ pipeline/lib/marketfetch.mjs:289,169
                                                              │
capital split ─bookUtilization()/totalCapital()───────────────┤ pipeline/lib/capital-utilization.mjs:15,30
break-even + stale-live flag ─breakEven()/computeQuote()───────┘ js/quotecore.js:55,341
                                                                (breakEven for P&L; computeQuote's
                                                                 row.quickStale.sell/quoteAgeMin.sell
                                                                 for the honesty label on view 2's
                                                                 marks — these are per-SIDE objects,
                                                                 `{buy,sell}`, not flat scalars: use
                                                                 `.sell` since the mark is quickSell)
```

### Resolved data-flow questions (were Q1–Q5 in the draft; all still hold on re-check)

1. **The `-c` union stays a one-liner**, matching `PLAN-SCHEDULE.md`'s identical precedent for its
   own item-set union: `new Set([...groups.map(g => g.itemId), ...offers.map(o => o.itemId)])`. No
   shared helper module with `/schedule` — rule-of-three, not yet a third consumer.
2. **Live-mark fetch.** `fetchLatest(id)` (`marketfetch.mjs:168`) → `{ high, low, highTime,
   lowTime }`. **Mark side = `latest.high`** (`row.quickSell` in `computeQuote` naming,
   `quotecore.js:343`, comment *"your SELL fills at the instabuy"*) — the same field
   `momVerdict`'s underwater check already compares against `breakEven` (`quotecore.js:625`, local
   var `instabuy`), so view (2)'s "underwater" read agrees with the verdict surfaces by
   construction. `latest.low` (`row.quickBuy`) is the wrong side for a HELD lot's value.
   **Staleness label:** `computeQuote`'s `row.quickStale.sell` (boolean) / `row.quoteAgeMin.sell`
   (minutes) — confirmed at `quotecore.js:470-478`: `quickStale` and `quoteAgeMin` are **objects
   keyed `{buy, sell}`**, not flat values; use the `.sell` member. This is the SAME guard
   `staleLiveNote()` in `quote-items.mjs:138` renders (`QUICK_FRESH_MIN = 15`, `quotecore.js:118`),
   so a stale mark is labelled with the same words/threshold everywhere.
3. **Deployed vs idle capital — call `loadDerivedCash()` + `capital-utilization.mjs` directly, don't
   hand-roll the split** (decision 5). `loadDerivedCash(repoDir, { marketRef })`
   (`derive-cash-tiers.mjs:185`) returns the reconciled three-tier model —
   `availableCash ≤ deployablePool ≤ liquidCapital` — with `reservedDeep`/`reservedCommitted` already
   split via `restingBuyEscrow` + `classifyBid`. Deployed capital for view (1) = Σ(open-lot cost,
   from `groups`) + `reserved` (all resting-BUY escrow); idle/free = `availableCash`; the sizer's
   default capital = `deployablePool`. `bookUtilization({ workingGp, parkedGp })` and
   `totalCapital({ workingGp, parkedGp, cashGp })` (`capital-utilization.mjs:15,30`) take those same
   two (or three) numbers and return the %-split view (1) renders — call them, don't recompute
   `utilizationPct`/`committedPct`/`idlePct` inline.
   **`marketRef` requirement:** classifying a resting bid deep-vs-committed needs `{ live, bandLow }`
   per item with an open BUY offer (`derive-cash-tiers.mjs:70-85`). Resolved by decision 3: build
   `marketRef` from the SAME single per-invocation fetch union (`heldItems ∪ restingBidItems`), not a
   second fetch pass. A resting bid on an item not currently held still needs its OWN `fetchLatest`
   call — it's just folded into the one union computed up front, sized `|heldItems ∪
   restingBidItems ∪ {sizerItem?}|`.
4. **Days held — GROUPED, oldest-tranche `buyTs`** (decision 1, final). `readOpenPositions().groups`
   pre-aggregates per item at weighted-avg cost with `buyTs` = the OLDEST lot's timestamp in the
   group (`positions.mjs:12,29`) — matches `momVerdict`'s entry-age softening convention. One row
   per item, one cost basis, one age, matching every other positions-vs-market surface. (Per-tranche
   rows are explicitly OUT — see Risk 4, which now records this as the accepted trade-off rather
   than an open question.)
5. **P&L math — `breakEven()` only, nothing re-derived.** `js/quotecore.js:55` is the tax-capped
   piecewise definition. `% to break-even = (mark − breakEven(avgCost)) / breakEven(avgCost)`;
   `unrealPL = qty * (mark − breakEven(avgCost))` (after-tax — `breakEven` already bakes in the 2%
   GE tax + `TAXCAP`). Import `breakEven` from `quotecore.js`; never call `js/money-math.js`'s
   `tax(p)` directly to re-derive a break-even inside `book-model.mjs` — that would be a second
   tax-math home. `js/money-format.js` is formatting only (`fmt`, `fmtP`, …), confirmed no math.

## Is this already half-built? — extend two things, build two things (unchanged on re-check)
- **`pipeline/lib/capital-utilization.mjs`** (`bookUtilization`, `totalCapital`) already computes the
  working/parked/idle capital split `watch-positions.mjs`'s `=== SUMMARY ===` block feeds off
  `loadDerivedCash()`'s output (`watch-positions.mjs:1201-1245`). Decision 5: book-model.mjs calls
  these two functions directly for the capital-split math.
- **`quote-items.mjs --positions`** already builds, per grouped lot, `avgCost`, `be`, `row.quickSell`/
  `row.optSell`, and a verdict — but does not render unrealized P&L gp/%, capital tied, or days held
  as columns, even though every input is already in scope. book-model.mjs's job is to compute and
  KEEP those three, not re-fetch/re-derive.
- **Genuinely new, nothing to extend:** (a) free-GE-slot counting / per-slot occupant listing — no
  surface counts slots today, and decision 4 fixes its scope (completed-uncollected = free, not a
  bug to chase); (b) the tranche sizer (`buy limit × clearability × capital`) — no surface combines
  `limitWindow` + volume + a capital ceiling into a recommended size today, though every ingredient
  individually exists (`limitWindow`, `vol24FromInputs`, `deployablePool`).

## Hook-in points
- **A new standalone reader `pipeline/commands/read-book.mjs`** (sibling to `read-buy-limits.mjs`:
  same no-mutation reader shape — `loadMapping()` for names/limits, read the three repo-root JSON
  files directly, plain `console.log` lines via the `hhmm()`-style LOCAL-time helper pattern already
  in `read-buy-limits.mjs:28-31`, no markdown-table machinery). Driven by a **`/book` skill**
  (`.claude/skills/book/SKILL.md`, following `/positions`/`/scan` precedent).
- **The sizer as a flag on the same command** (decision 2, final): `read-book.mjs --size "<item>"
  [--capital <gp>]`, capital defaulting to the SAME invocation's `deployablePool`. Matches
  `quote-items.mjs`'s own `--positions` mode-switch precedent; shares the aggregation layer + the
  one-shot fetch union with views (1)/(2) for free.
- **The `-c`-equivalent union stays a one-liner** in `read-book.mjs` — no shared helper with
  `/schedule` for now.
- **NOT in the loop by default** — on-demand "show me the book" read, unlike the schedule's loop
  one-liner. (A future compact "idle: Xm · N slots free" loop header is possible but out of scope.)

## Honesty / constraints
- Inform-only, never gates. Every rendered mark carries its `quickStale.sell`/`quoteAgeMin.sell`
  label (decision 3) — never a silent stale P&L number.
- Free-slot count is a log-derived lower bound on occupancy, not ground truth (decision 4) — the
  dashboard states this once as a known simplification, not a caveat that implies a fix is pending.
- `deployablePool` degrades to `availableCash` (reports LESS deployable than may really be true)
  whenever a resting bid's item is missing from the `marketRef` union — the conservative default
  already baked into `derive-cash-tiers.mjs`; `/book` inherits it for free.
- Times rendered LOCAL (repo rule). Pipeline-only: **no `APP_VERSION` bump** — commit message notes
  the pipeline-only nature per rule 5.
- New `read-book.mjs` + `book-model.mjs` + `/book` skill → README inventory entry + CLAUDE.md
  ask→command row, in the SAME commit each file lands (rule 8, not deferred).

## Implementation detail — build-ready

### File layout
- **`pipeline/lib/book-model.mjs`** (pure, no fetch, no fs). Single exported function, e.g.
  `buildBook({ groups, offers, cash, marks, limitInputs, sizer })`. Fixture-tested off canned
  positions/offers/cash/marks objects — no network, no filesystem, in its own test file
  `pipeline/test/book-model.test.mjs`.
- **`pipeline/commands/read-book.mjs`** (impure shell). Reads the three repo-root JSON files, builds
  the fetch union, calls `fetchLatest`/`fetchTs` per id in that union, calls `loadDerivedCash` with
  the resulting `marketRef`, calls `book-model.mjs`, renders. This is the ONLY file that touches the
  network or a mapping load.
- **`.claude/skills/book/SKILL.md`** — thin: routes the ask to the command, states the honesty
  caveats (decision 3's age-labelling, decision 4's slot-count simplification) so Ben sees them even
  if he only reads the skill, not the code.

### book-model.mjs — exact shape
```
buildBook({
  groups,        // readOpenPositions().groups: [{ itemId, qty, cost, avgCost, buyTs }]
  offers,        // readOffersSnapshot().offers: [{ slot, side, itemId, item, price, qty, filled, lastUpdateTs }]
  cash,          // loadDerivedCash() result: { availableCash, deployablePool, liquidCapital, reservedDeep, reservedCommitted, ... }
  marks,         // Map<itemId, { mark, stale, ageMin }> — ONE entry per id in the fetch union, caller-built
                 //   from fetchLatest + computeQuote's row.quickStale.sell/row.quoteAgeMin.sell (decision 3)
  now = Date.now(),
}) -> {
  slots: {
    total: 8,
    occupied,           // count of offers[] with side/qty implying an active slot (BUYING/SELLING; decision 4: a
                         //   just-completed BOUGHT/SOLD slot counts as free, matching activeOffers()'s own semantics)
    free,               // total - occupied
    occupants: [{ slot, side, itemId, name, price, qty, filled }],
    caveat: 'free-slot count is a log-derived lower bound; a just-completed, not-yet-collected slot reads as free (accepted simplification, not a bug)',
  },
  capital: {
    // delegates to capital-utilization.mjs (decision 5) + the loadDerivedCash result verbatim —
    // does NOT recompute utilizationPct/committedPct/idlePct inline
    workingGp,        // = Σ(groups[].cost)  -- capital tied up in held inventory
    parkedGp,         // = reservedDeep + reservedCommitted (resting-BUY escrow, from `cash`)
    ...bookUtilization({ workingGp, parkedGp }),      // -> { committed, utilizationPct }
    ...totalCapital({ workingGp, parkedGp, cashGp: cash.availableCash }),  // -> { totalGp, committedPct, idlePct }
    deployablePool: cash.deployablePool,
    availableCash: cash.availableCash,
  },
  lots: [{
    itemId, name, qty, avgCost,
    breakEven,          // = breakEven(avgCost)   (js/quotecore.js:55)
    mark,               // = marks.get(itemId).mark  (latest.high / quickSell)
    stale,              // = marks.get(itemId).stale
    ageMin,             // = marks.get(itemId).ageMin
    unrealPL,           // = qty * (mark - breakEven)   -- after-tax; null if mark is null (no quote)
    pctToBE,            // = (mark - breakEven) / breakEven  -- null if mark is null
    capTied,            // = qty * avgCost   (== groups[].cost for that item)
    daysHeld,           // = (now/1000 - buyTs) / 86400   (buyTs is the GROUP's oldest-lot ts, decision 1)
  }],
})
```
Acceptance check for chunk 1 (Risk 5's requirement, made concrete): a fixture where `groups`/`cash`
match a real `watch-positions.mjs` SUMMARY-footer snapshot must produce `capital.workingGp`/
`parkedGp`/`utilizationPct` **byte-identical** to what that footer printed for the same input — not
"looks right," an exact-value assertion in the test file.

### The sizer (`--size`) — math spelled out
Three independent bounds, take the minimum, then report the net if the position cycles once:
1. **Buy-limit bound** — `limitWindow({ buys: buysByItem(fillsEvents)[itemId], limit, now })
   .remaining` (`limits.mjs:46,73`); `null` limit → sizer refuses to recommend a qty for that item
   (repo rule: null limit is UNKNOWN, never unlimited — same as `read-buy-limits.mjs`'s own
   convention).
2. **Clearability bound** — `vol24FromInputs({ ts1h: await fetchTs(itemId, '1h') })` (`marketfetch.mjs:169,289`)
   gives the corrected trailing-24h `{ highPriceVolume, lowPriceVolume }`; clearability bound =
   some conservative fraction of the smaller side's daily volume (reuse whatever fraction `/scan`'s
   own sizing judgment already uses for "don't be the whole day's volume" — do not invent a new
   constant; if `/scan`'s skill prose doesn't encode one explicitly, default to the same 500k gp/d
   attention-floor-adjacent judgment already documented in `docs/MARKET-ANALYSIS.md` rather than a
   fresh number). This is the ONE bound needing an extra per-item fetch (`ts1h`, 15-min TTL) beyond
   what views (1)/(2) need — scope it to ONLY the `--size` target item, not the whole union.
3. **Capital bound** — `Math.floor(capital / breakEven-adjusted unit cost)`, where `capital` =
   `--capital` override or the SAME invocation's `cash.deployablePool` (decision 2/3 — never a
   separately-fetched or re-derived number).
   `recommendedQty = Math.min(buyLimitBound, clearabilityBound, capitalBound)`.
   `netIfCycled = recommendedQty * (breakEven-implied sell target − current ask/buy price)` — reuse
   the SAME mark (`latest.high`/`quickSell`) and `breakEven` already computed for view (2); no new
   pricing model.
4. Render which bound was BINDING (buy-limit / clearability / capital) — this is the single most
   useful line of the sizer's output; don't just print the final number.

### Rendering / CLI shape
Follow `read-buy-limits.mjs`'s style exactly: plain `- ` bullet lines, LOCAL `hhmm()`-style time
helper reused verbatim (copy the ~4-line function, it's not worth a shared import for one helper),
no markdown tables. Suggested sections in output order: `=== SLOTS ===` → `=== CAPITAL ===` →
`=== BOOK (P&L) ===` → (only with `--size`) `=== SIZER: <item> ===`.

## Risks / where this is NOT as straightforward as it looks (updated)
1. **RESOLVED, not a residual risk** — see the "Correction found" section above: the 60s cache is
   opt-in and off by default; decision 3's one-shot-fetch-union design sidesteps it entirely. Do not
   re-introduce `COFFER_FETCH_CACHE`/`setFetchCache` into this command.
2. **Free-slot counting inherits a known log gap — ACCEPTED, not fixed (decision 4).**
   `activeOffers()` (`offers.mjs:112`) only reports a slot occupied when its LATEST row is
   `BUYING`/`SELLING`; a just-completed (`BOUGHT`/`SOLD`, not yet collected in-game) slot reads as
   available. This is the same class of gap `restartBlindSuspects()` patches for a different
   symptom — explicitly OUT of scope here. The dashboard carries one caveat line (see
   `slots.caveat` above) rather than silently overcounting; do not build detection logic for it.
3. **The sizer's clearability bound needs its own `ts1h` fetch, scoped narrowly.** Only the
   `--size` target item needs `fetchTs(id, '1h')` — do not extend this to the whole book union;
   views (1)/(2) never need the 1h series, only `latest`.
4. **Grouped P&L is the accepted trade-off (decision 1, no longer an open question).** A lot with an
   old core position plus a fresh top-up shows ONE blended break-even and ONE (conservative, oldest)
   days-held number — a top-up doesn't get its own row. This is decided, matching every other
   positions-vs-market surface; do not build a per-tranche mode as a "nice to have" alongside it —
   that would be scope creep past what was decided.
5. **Duplication risk if book-model.mjs re-derives capital math instead of calling
   `capital-utilization.mjs`/`derive-cash-tiers.mjs`.** Guarded by the chunk-1 acceptance check
   above (byte-identical to `watch-positions.mjs`'s SUMMARY footer for the same input) — this is now
   a testable gate, not a prose warning.

## Chunks (small, independently landable, in dependency order)
1. **`pipeline/lib/book-model.mjs`** (pure) + `pipeline/test/book-model.test.mjs`. Implements
   `buildBook()` per the exact shape above. No fetch, no fs, no network in this file. Acceptance:
   (a) fixture-driven unit tests for slots/capital/lots math; (b) the Risk-5 byte-identical
   capital-split check against a canned `watch-positions.mjs` SUMMARY snapshot; (c) `node --check`.
   **Depends on nothing** — can start immediately.
2. **`pipeline/commands/read-book.mjs`** — views (1)+(2). The impure shell: reads the three JSON
   files, builds the `heldItems ∪ restingBidItems` union, fetches `latest` once per id in that union,
   builds `marketRef` + the `marks` map (with `quickStale.sell`/`quoteAgeMin.sell` via
   `computeQuote`), calls `loadDerivedCash({ marketRef })`, calls `book-model.mjs`, renders
   `=== SLOTS ===` + `=== CAPITAL ===` + `=== BOOK (P&L) ===`. Acceptance: manual run against the
   live repo state produces numbers cross-checked by hand against a fresh `/positions` +
   `derive-cash-tiers.mjs` run for the same instant; `node --check`. **Depends on chunk 1.**
3. **Sizer (`--size`)** — extends `read-book.mjs` with the `--size "<item>" [--capital <gp>]` flag,
   adding the item to the fetch union (plus its own `ts1h` fetch, scoped per Risk 3), computing the
   three bounds + binding-bound label + net-if-cycled, rendering `=== SIZER: <item> ===`. Acceptance:
   fixture test in `book-model.test.mjs` (or a sibling `sizer.test.mjs`) covering each bound being the
   binding one in turn (buy-limit binds, clearability binds, capital binds), plus a `null`-limit
   refusal case. **Depends on chunks 1–2** (reuses their fetch union + mark map).
4. **`/book` skill + docs reconciliation** — `.claude/skills/book/SKILL.md` (routes asks like "what's
   my book look like", "what's deployed/idle", "how much X can I buy right now" → the command;
   states decision 3/4's honesty caveats up front). README.md: new inventory entries for
   `read-book.mjs`, `book-model.mjs`, and the skill file, at creation (rule 8). CLAUDE.md: one new
   ask→command table row pointing at `/book`. Doc-drift grep: search README/CLAUDE.md for any
   existing half-description of "book"/"capital dashboard"/"slots" under a different name and
   reconcile in the same commit (rule 8's reconciliation-not-append requirement). **Depends on
   chunks 1–3** landing so the skill/docs describe real, working behavior.

**Version lane:** pipeline-only. No `APP_VERSION` bump (rule 5) — note the pipeline-only nature in
each chunk's commit message. No skill `version:` frontmatter bump needed on chunks 1–3 (no skill
file touched yet); chunk 4 sets the `/book` skill's initial `version: 1` frontmatter.

## Decisions for Ben — NONE OPEN
All five items in the original "Open questions for Fable" list plus the two decision points the
draft flagged (grouped-vs-per-tranche P&L, sizer-as-flag-vs-command) are resolved by the owner's
final decisions folded in above. Nothing here blocks starting chunk 1.
