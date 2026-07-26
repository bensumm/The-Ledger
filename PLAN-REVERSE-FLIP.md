# PLAN-REVERSE-FLIP — harvesting owned items (2026-07-24)

**Status: RECONCILED 2026-07-25, RF0 buildable.** A staleness audit vs `main` @ 2026-07-25 confirmed the
STRATEGY is fully intact — nothing that landed 2026-07-25 (grade rework `5fea8bd`, Path-A `d2d7d32`, the
daemon subsystem, fetch-pool scaling) touches any concept or code this plan relies on; reverse-flip has
its own gate/table/ownership-gated pool and never referenced `rating.mjs`/`capitalFactor`/`pathA`. Fixed
in this pass: the anchor incident (the 2026-07-24 hat cycle has since COMPLETED — see below), a handful of
drifted `file:line` refs (`gatecandidates` 194-198→237-241, `validateNicheSpec` 434→425, `read-book`
buildBook 146→142), and the plan's own internal contradiction (the readiness section still declared RF1's
shape-vocabulary a build-blocker after Ruling §7 had already fixed it — now reconciled).

Follows `docs/PLANNING.md`'s required shape. Per that doc's lifecycle, this file is folded into
`PLAN.md` and deleted the moment its last chunk ships — do not leave it at the repo root once done.

## Context / diagnosis

Normal flipping deploys capital and treats the SELL as the risky mandatory leg (stranding = can't
sell). **Reverse-flip** inverts this for items Ben already owns and wants to keep (personal-use
gear, or a long-term flip-pipeline hold he's not ready to fully exit):

- **Capital-free.** Monetizes an owned asset; nothing is deployed to enter.
- **Sell-first.** Sell at the diurnal/multi-day PEAK (or into live demand, see below), then rebuy
  at the DIP. The trigger is a peak window, not a dip.
- **Inverted, bounded risk.** The "stuck holding a thin asset" failure can't happen (Ben wants the
  item — holding it is the null outcome, not a loss). The new failure is "can't rebuy cheap enough"
  (price steps up before the rebuy fills) — bounded, because there's no deadline to reacquire your
  own item; worst case you wait for the next dip.

**Anchor incident (2026-07-24, cycle now COMPLETED — reconciled 2026-07-25):** sold 1 Ancestral hat
(id **21018**) @ 57m — it filled **instantly**, above the 56.5m ask, not waiting for any peak window.
The rebuy then FILLED @ ~53.515m (below the 54.05m bid originally placed). This falsifies a naive
"thin item ⇒ sell leg is risky" assumption: on a wanted item, live demand can clear the sell leg
immediately. **The rebuy leg is the binding constraint**, not the sell leg — and here it cleared cheap,
a clean profitable loop. Two live on-disk artifacts remain from it: the @57m sell sits in
`positions.json.unmatched` (a real RF3 Case-B reconciliation instance) and the rebuy is an `open`
lot. (The hat is NOT on `ignored-items.json`; current `personal-use` ignored entries are Battlestaff
1391 + Ghrazi rapier 22324 — use one of those if a `personal-use` example is needed.)

### Regime asymmetry (the inversion, stated precisely)

For every OTHER flip-niche in this repo, `js/termstructure.mjs`'s `classifyTrajectory` shape feeds
gates that treat `rising` as good (upside) and `falling`/`cooling` as risk (stranding). Reverse-flip
inverts this mapping:

**VOCABULARY (CORRECTED 2026-07-24 — this was a load-bearing bug).** `classifyTrajectory`
(`js/termstructure.mjs:184`) emits `knife | oscillating | based | rising | elevated | flat | unknown`.
There is **no `falling` or `cooling` shape** — `knife` is the monotone-decline analog, and `oscillating`
deliberately catches a falling-but-oscillating item (checked BEFORE knife). RF1's gate MUST map against
these real values; the earlier `falling`/`cooling` draft would have matched nothing and silently never
passed on a real decline.

| Shape (real `classifyTrajectory` value) | Normal flip-niche read | Reverse-flip read |
| --- | --- | --- |
| `rising` | good (upside) | **BAD** — sell now, rebuy at a HIGHER floor tomorrow; the cycle loses money by construction |
| `knife` (monotone decline) | risk (stranding) | fine-to-**good** — sell high off a hold you'd otherwise ride down anyway, rebuy lower; PROTECTS the hold's value instead of bleeding it |
| `oscillating` / `based` | mixed (depends on niche) | **ideal** — a repeatable peak→dip lap, the exact shape the whole strategy wants |
| `elevated` (top of 14d range, no spike) | bought-high caution | **good to SELL** (you're at the top) but the rebuy leg is the risk — don't rebuy until it comes off the high |
| `flat` / `unknown` | neutral | neutral — no clear peak/dip lap to harvest; pass |

This is not a new trajectory computation — it is a **re-mapping of `classifyTrajectory`'s existing
output**, computed once, in one place (Chunk RF1).

## Rulings (owner decisions this session, dated 2026-07-24)

1. Break-even rebuy uses the **canonical `tax()`** from `js/money-math.js`
   (`Math.min(Math.floor(p*0.02), TAXCAP)`, floored, capped 5m) — **not** a flat "×0.98"
   approximation. `beRebuy = sellPrice − tax(sellPrice)`; any rebuy strictly below `beRebuy`
   profits after tax. The "×0.98" language in the strategy brief was a simplification for
   round numbers, not a literal formula — this plan uses the real function (one-home rule, E8).
2. Eligibility = (owned ∩ want-to-keep) ∩ clean-oscillator ∩ regime-not-rising ∩ both-legs-liquid-
   enough — see RF1's gate.
3. **The owned-item registry is maintained by seed + capture-on-buy, never by polling the bank**
   (superseding the bare "bank export or nothing" framing of the 2026-07-03 deferral note in
   `PLAN.md`'s "Other unscheduled notes" — see "Reconciling `PLAN.md`" below). Two feeds, one
   registry:
   - **One-time curated seed** — a single manual dump (hand-typed list, or a one-off bank-export
     paste) bootstraps items Ben already owns that predate any GE-log buy (boss drops, long-held
     gear). One-shot, not a running sync.
   - **Capture-on-buy** — the exchange logger already sees every real BUY. A big-ticket, small-qty
     buy the registry doesn't recognize gets queued for a one-line classification prompt
     (flip / keep / consumable) next time an agent talks to Ben, rather than silently assumed.
   No RuneLite bank-export plugin is required to ship this — it's an OPTIONAL later convenience for
   re-seeding, never a hard dependency (this directly narrows Q3, see Chunk RF5).
4. The FIFO reconstruction (`matchTrades`/`collapseOffers` in `pipeline/lib/reconstruct.mjs`) is
   **NOT modified**. Sell-before-buy stays `unmatched` — that rule stays global and untouched (see
   "Q2 answer" below for how legitimate reverse-flip cycles get correct P/L without it).
5. Reverse-flip is **explicit-only** (like `scalp`), never folded into `--mode all` — it's a small,
   personal, high-stakes-per-item population, not a broad screen.
6. **Thin big-ticket items need different read handling (Ben, 2026-07-24, the Ancestral-hat live case).**
   The reverse-flip population IS mostly thin big-ticket (owned gear: hat 135/d, buy limit 8, tranche
   ~1 unit), and the standard reads mislead on exactly that shape — so this is a first-class concern
   of this plan, not a footnote. The live evidence: the hat "trading at 58m" was a **lone standing ask
   reached only 2/14d (p79)** while the item actually TRADES ~55m; and its 3-day hourly drift read
   **contradicted itself by window** (3-day +1.47m/d UP · 5-day down · 7-day flat) because each hourly
   median on a thin book is built from a handful of trades, so the day-over-day slope whipsaws. A point
   recommendation ("list 56.5m") is false precision on an item that wobbles 54–58m intraday. See
   [Chunk RF6](#rf6--thin-big-ticket-read-handling) for the handling. This folds in the thin-item lever
   from PLAN-HOURLY-3DAY-TREND (the `--days`-honest longer drift window, now that the mislabel is fixed).

### Rulings — 2026-07-24 session 2 (SUPERSEDE the above where they conflict)

7. **RF1 vocabulary — use the REAL `classifyTrajectory` shapes** (`knife`/`oscillating`/`based`/`rising`/
   `elevated`/`flat`/`unknown`), per the corrected Regime-asymmetry table above. Mapping ruling (resolves
   build-readiness open-question #1): `rising` → reject; `knife`/`oscillating`/`based` → pass (harvestable);
   `elevated` → sell-side OK but flag the rebuy leg (don't rebuy off the high); `flat`/`unknown` → pass but
   no-conviction (no clear lap). This is the ONLY correct source of shape names — the earlier `falling`/
   `cooling` text is dead.
8. **Drop `reverseFlipEligible` — no per-item opt-in flag (Ben).** The filtered owned-item set IS the
   candidate pool; Ben mentally ignores what he doesn't want, no eligibility gate to maintain. This deletes
   the flag from `owned-items.json`, and RF2's candidate pool becomes simply "the filtered owned set ∪
   `hold-thesis.json` `reverseFlip:true` holds." Resolves build-readiness open-questions #3 and #4 (the
   "show Ben a pre-eligible table / who opts in" flow is gone — the table IS the pool).
9. **Value threshold = 5m** (Ben), NOT `BIG_TICKET_GP` (10m). The reverse-flip candidate filter keeps owned
   items with guide ≥ **5,000,000** (a new `REVERSE_FLIP_MIN_GP = 5_000_000` constant, not `BIG_TICKET_GP`).
   Big-ticket (≥10m) is a *priority ordering* within that pool, not the cutoff. Starting point, not a hard
   permanent limit — widen later if wanted.
10. **RF5 is DELETED (Ben + the MCP finding).** The RuneLite `data-export` plugin already exists and runs on
    Ben's machine, writing `~/.runelite/Data Exports/container_bank.json` (live, export-button-triggered).
    RF5's whole premise ("if re-seeding is tedious, build a ~100-line plugin") is moot — the plugin is
    already there. The owned-item seed reads that file directly (see `PLAN-MCP-BANK-SERVER.md`); no
    bank-export chunk to build. The RF5 section below is retained struck-through for history only.

## Existing scaffolding (what this plan builds on, not around)

- **Declarative niche registry** — `js/flip-niches.mjs` (`FLIP_NICHES`), the `value`/`amplitude`
  precedent for "own gate, own table, `gate:'<name>'` routed in `pipeline/lib/gatecandidates.mjs`,
  off-by-default explicit-only like `scalp`." Reverse-flip is a **new registry entry**, not a
  parallel screen.
- **Quarantine file** — `ignored-items.json` already holds exactly the Case-B population
  (personal-use owned items, e.g. the Ancestral hat, Battlestaff, Ghrazi rapier) with a `_doc` field
  documented as "VIEW filter only, never gags pricing." Reverse-flip eligibility rides an additive
  field on entries already there, not a parallel list (see RF0).
- **Declared-plan stores** — `hold-thesis.json` (tracked, agent-written, `declare-thesis.mjs`
  set/clear/list CLI) is the precedent for "Ben states intent in conversation, the agent writes a
  small tracked JSON store" — `reverse-flip-state.json` follows the identical shape and CLI pattern.
- **`BANKED`/`WITHDRAWN` fill vocabulary** (`pipeline/FILLS-PIPELINE.md` §5.1) — pre-owned inventory
  already has a first-class entry point into the FIFO queue at a declared basis
  (`add-manual-fill.mjs --type banked --price <basis>`). This is the exact mechanism Case-B
  reverse-flip P/L correctness needs — already built, not reinvented (Chunk RF3).
- **`js/termstructure.mjs` `classifyTrajectory`** — the one-home trajectory shape classifier every
  other gate already reads; reverse-flip's inverted regime gate calls it and re-maps the verdict,
  it does not recompute shape.
- **`js/amplitudescreen.mjs` / `js/valuescreen.mjs`** — the pattern for a pure, DOM-free,
  `js/`-homed gate+edge module consumed by both `screen-flip-niches.mjs` and (potentially, later)
  the app, with named-placeholder constants and a conformance fixture set. `js/reverseflip.mjs`
  follows this shape exactly (RF1).
- **`cycle-watch.json` / `dip-watchlist.json`** — precedent for a small, purpose-scoped, per-item
  state file that is NOT the path engine and NOT positions.json — reverse-flip's cycle state
  follows this "scoped state file, opt-in consumer" shape rather than growing
  `js/held-item-strategy.mjs`'s `PATH_KEYS`.
- **`/schedule`, `/book`, `/positions`** — existing surfacing layers this plan extends additively
  (new row types), not new dashboards.

## Target architecture

```
                    ┌─────────────────────────┐
 fills.json ───────▶│  owned-items.json        │◀── one-time seed (manual/pasted)
 (real BUY/SELL     │  (qty = pure fold over    │
  events, existing) │   fills.json since seed;  │
                    │   classification: flip/   │
                    │   keep/consumable/pending)│
                    └─────────────┬─────────────┘
                                  │ reverseFlipEligible items
                                  ▼
                    ┌─────────────────────────┐
                    │  js/reverseflip.mjs       │  pure gate/edge (RF1)
                    │  inverted regime gate ·   │
                    │  amplitude floor ·        │
                    │  tax()-based beRebuy       │
                    └─────────────┬─────────────┘
                                  │ FLIP_NICHES.reverse (RF2)
                                  ▼
              screen-flip-niches.mjs --mode reverse
                                  │ candidate surfaced, Ben sells
                                  ▼
                    ┌─────────────────────────┐
                    │ reverse-flip-state.json   │  declared cycle (RF0)
                    │ {id, state, soldEach,     │  agent-written via
                    │  beRebuy, rebuyBidPrice}  │  declare-reverse-flip.mjs
                    └─────────────┬─────────────┘
                                  │ surfaced in
                                  ▼
              /schedule  ·  /book  ·  /positions        (RF4)
              "rebuy window reached, price ≤ beRebuy, slot free"
```

`owned-items.json` and `reverse-flip-state.json` are the two new tracked artifacts. Everything else
is a registry entry / pure module / surfacing addition to code that already exists.

---

## Question 1 — Candidate surfacing (owned ∩ flippable)

**`owned-items.json`** (NEW, tracked, repo root — mirrors `ignored-items.json`'s shape/doc
convention):

```json
{
  "_doc": "Owned-item registry for reverse-flip eligibility. qty is a COMPUTED rolling balance —
    seedQty + net buy/sell delta over fills.json since seedTs — never hand-edited after the seed.
    classification: 'keep' (owned, want to keep — reverse-flip candidate pool) | 'flip' (normal
    merch item, not owned-for-keeping — the default assumption for anything never classified) |
    'consumable' (used up, not a market position) | 'pending' (awaiting a one-line confirm).
    reverseFlipEligible is a SEPARATE opt-in flag on top of classification:'keep' — not every kept
    item is a good oscillator (Ben must be shown a candidate table and choose it in, RF2).",
  "items": [
    { "id": 21018, "name": "Ancestral hat", "seedQty": 1, "seedTs": 1753315200,
      "classification": "keep", "reverseFlipEligible": true, "source": "seed" }
  ],
  "pendingClassification": [
    { "id": 24417, "name": "Soulreaper axe", "qty": 1, "buyEach": 1400000000, "buyTs": 1753315200,
      "firstSeenTs": 1753315200 }
  ]
}
```

**Seeding (one-shot).** A manual paste — hand-typed list or a bank-export dump (Q3, RF5) — creates
the initial `items[]` baseline for pre-log-history ownership (boss drops, long-held gear the log
never saw a BUY for). Not a running sync; run once, then never again unless Ben wants to reconcile
drift.

**Capture-on-buy (the running tab).** `sync-fills.mjs`'s regenerate pass already re-reads the full
merged event set every run. A new pure fold (`pipeline/lib/ownedledger.mjs`) walks fresh `buy`/
`banked` events since the last run and, for any itemId that is:
- **not already in `owned-items.json.items`**, AND
- **big-ticket** (reuses the existing `BIG_TICKET_GP` constant from `js/quotecore.js` — the same
  threshold `screen-flip-niches.mjs`'s weak-deploy flag already uses, one-home), AND
- **small qty** (≤ a placeholder `PENDING_QTY_MAX`, e.g. 5 — a "keep" purchase is bought in singles,
  a commodity flip buy is bought in hundreds/thousands),

...appends it to `pendingClassification[]` (deduped by id, capped at a placeholder
`MAX_PENDING` so a busy session doesn't flood the list). **This never blocks or alters the sync** —
classification is purely additive enrichment; an item that never gets classified behaves exactly as
it does today (no reverse-flip eligibility, no other surface changed).

**Resolving `pendingClassification`.** Surfaced passively — a `pending N item(s)` line in
`/positions` and `/morning` output (reusing those skills' existing "catch me up" framing, not a new
dashboard) — e.g. `pending: Soulreaper axe ×1 @ 1.4b — flip / keep / consumable?`. When Ben answers
in conversation, the agent runs `declare-owned.mjs classify "<item>" flip|keep|consumable` (new CLI,
mirrors `declare-thesis.mjs`'s resolve-token → upsert → save shape) which moves the entry from
`pendingClassification` into `items[]` with `seedQty` = the qty already computed from the fold (not
re-typed) and `seedTs` = now. A `keep` classification does NOT set `reverseFlipEligible` — that's a
distinct, later, RF2-table opt-in (a keep item might be a one-off boss piece with no clean
oscillation at all).

**Qty reconciliation — the "must go down too" requirement.** `qty` is **never** an incrementally
mutated field. It's recomputed every read as `seedQty + Σ(buy/banked qty) − Σ(sell/withdraw qty)`
over raw `fills.json` events for that itemId with `ts ≥ seedTs` — the exact same idempotent-
rebuild-from-full-history philosophy `positions.json` already uses (never patch a derived number,
recompute it). This is why a reverse-flip SELL correctly drives qty to 0 with **zero special-casing**:
it's a real sell fill event like any other, and the fold already subtracts every sell. The
subsequent rebuy is a real buy fill event and the fold adds it back — again with zero special-
casing. **`reverse-flip-state.json`'s job is narrower than qty-tracking: it's the DECLARED-CYCLE
bookkeeping for scheduling (Q4), not the source of ownership truth.**

**Candidate pool for `--mode reverse` (RF2).** `owned-items.json.items.filter(i =>
i.reverseFlipEligible)` **∪** any currently-open long-term flip-pipeline hold flagged via an
additive `reverseFlip: true` on its `hold-thesis.json` entry (Case A — see Question 2). Two input
surfaces, one pool, because Case A (a normal tracked hold electing a reverse-flip cycle) and Case B
(a personal-use/pre-log owned item) are declared through the store that already owns their intent.

### Question 1b — the falling-but-liquid big-ticket DISCOVERY lane (blindspot audit #2)

**The gap (audit finding #2, `PLAN-BLINDSPOT-AUDIT.md`, HIGH):** band/churn `falling:'exclude'` by
doctrine and amplitude drops fallers on `trend`/`knife`, so **a NEW falling-but-liquid big-ticket
with a genuinely positive robust-band net has NO discovery path unless Ben already watchlisted it.**
The audit found ~15 such items in this session's (gate-exempt) watchlist alone — Ancient godsword
+623k, Dragon claws +414k, Masori body +137k — all invisible to every discovery niche. This is the
DISCOVERY half of the reverse-flip loop (the "B feeds A" direction): the same falling big-tickets are
exactly the reverse-flip's own candidates — either to buy patiently at the band floor, or (if owned)
to reverse-flip out of the next peak.

**The lane (folds into RF2, doesn't need a new command).** `--mode reverse` (or a `--discover`
sub-pass of it) additionally surfaces market items matching: **big-ticket** (guide ≥ `BIG_TICKET_GP`)
**∧ two-sided liquid** (the existing `bothSidedLiquidity` gate — this is NOT relaxed) **∧ falling/
cooling regime ∧ a positive robust patient-band net** (the Bar-E band edge already computed). It is
explicitly EXEMPT from the `falling:'exclude'` / `trend` / `knife` drops that hide it elsewhere —
because for a reverse-flip (or a patient band entry) a falling regime is *not* disqualifying (Ruling
in `falling-exclusion-amended`; the regime-asymmetry table above). Each surfaced item carries the
RF6 thin-item guards (traded-mid-vs-lone-ask flag, longer drift window, `⚠ rebuy may strand`) since
this population IS mostly thin big-ticket. Ben then chooses to watchlist / reverse-flip-eligible it —
the lane's job is DISCOVERY (give the item a path to be seen), not auto-entry.

**Why here and not a band/churn change:** loosening band/churn's falling-exclusion would reintroduce
the falling-knife false-positives those gates exist to stop (the boots/rapier shape). The reverse-flip
mode already *inverts* the regime read (falling = fine-to-good), so it's the correct, scoped home for
a deliberately falling-tolerant discovery lane — the exclusion stays global on the buy-side niches.
INFORM-ONLY, n≈0; it surfaces candidates, never sizes or enters. Acceptance rides with RF2.

---

## Question 2 — Reconstruction safety (FIFO stays untouched)

**The hard constraint restated:** `matchTrades()` (`pipeline/lib/reconstruct.mjs`) treats a SELL
with no open buy lot as `unmatched` — deliberately, because most of the time that's pre-log noise
(the buy predates the log) and inventing a cost basis would fabricate P/L. Reverse-flip must not
revert this rule globally.

**The resolution: reverse-flip splits into two cases, and only one of them ever touches
reconstruction — and even then, through the existing `BANKED` mechanism, not a new branch.**

### Case A — a tracked flip-pipeline hold (already has an open FIFO lot)

Nothing to build. `matchTrades()` already handles this correctly today: the reverse-flip SELL closes
the existing open lot into a normal `closed` row with real realized P/L (exactly as any exit would),
and the REBUY is simply a new `buy` fill that opens a fresh lot. **Zero reconstruction changes for
Case A** — `reverse-flip-state.json` here is pure scheduling/UX (Question 4), never a correctness
mechanism.

### Case B — a pre-log owned item (no buy fill ever logged — the Ancestral hat)

This is where the sell-before-buy ambiguity actually lives. Two paths, both using the **existing**
`BANKED` vocabulary rather than a new matching rule:

1. **Preferred: bank it before selling.** When RF2's candidate table surfaces a Case-B item, the
   agent's guidance (encoded in the `/scan --mode reverse` output, not a new gate) is: inject a
   `BANKED` line first (`add-manual-fill.mjs --type banked --price <declared basis> --time
   <acquisition time>`) at the owned-items seed basis. This enters the FIFO queue exactly like a
   buy (`reconstruct.mjs` line 264: `o.type === 'buy' || o.type === 'banked'`), carrying
   `banked:true`. The subsequent sell then FIFO-matches normally, producing a real `closed` row —
   **this is the fix-at-the-source doctrine already documented in CLAUDE.md, applied to a new
   trigger, not a new mechanism.**
2. **What actually happened live (sold first, no BANKED line yet):** the sell lands in `unmatched`
   — today's correct, safe default, exactly as it should for an untracked sell. **This is not
   broken; it is the reconstruction being honest that it doesn't know the cost basis yet.**
   `pipeline/commands/reconcile-reverse-flip.mjs` (RF3) is a small **advisory** script: given a
   `reverse-flip-state.json` declaration for that item+timestamp, it checks whether the matching
   `positions.json.unmatched` entry exists and, if so, **prints** (never auto-runs) the exact
   `add-manual-fill.mjs --type banked …` command to backfill the basis at the correct historical
   timestamp — so the next sync retroactively produces a correct `closed` row. Ben runs the printed
   command (or doesn't — the realized-P/L gap this leaves is cosmetic/informational, not a
   correctness bug, since `unmatched` sells are already excluded from every profit sum by design).

**Why this can't corrupt existing P/L:** no code path in `reconstruct.mjs` changes. A backfilled
`BANKED` line is indistinguishable, to `matchTrades()`, from any other historical banked lot — it's
the same mechanism Ben already uses for boss drops entering the flip flow. There is no new
"is this sell-before-buy actually a reverse-flip?" branch inside the reconstruction; the
declaration (`reverse-flip-state.json`) only decides **whether to suggest injecting a BANKED line**,
never how matching itself behaves. The global "ignore sold-before-bought" default is preserved
byte-for-byte for every item that never gets a reverse-flip declaration.

---

## Question 3 — Bank visibility (seed + capture-on-buy, not polling)

**Superseding the 2026-07-03 deferral note** (`PLAN.md` "Other unscheduled notes" —
"Bank-visibility tooling — DEFERRED... bank data is a manual, always-stale clipboard export... auto-
reconciling it against live `positions.json` risks false discrepancies"): that ruling's core safety
principle stands and is preserved (**bank truth never gets injected into `fills.json`/
`positions.json`** — see Question 2, only `BANKED` lines Ben explicitly confirms do that). What
changes is the ongoing-tracking half — this plan does **not** need continuous bank polling at all
(Q1's seed + capture-on-buy design). Reconciling in place: the "if revisited" sketch in that note
("one baseline export + GE-log replay = rolling estimate") is exactly what RF0 builds, and this plan
supersedes that note's provisional framing with the concrete design below.

**Seed input (RF0, no plugin required).** The one-time baseline is either:
- Hand-typed: Ben lists what he owns and wants tracked in conversation, the agent writes
  `owned-items.json.items` entries directly (same "Ben states intent, agent writes the file"
  pattern as `hold-thesis.json`).
- Or a pasted bank export (any format Ben can produce today — an in-game bank search screenshot
  transcribed, or a clipboard dump from an existing community plugin) — the agent parses it by hand
  into the same entries. No new file format is required to ship this.

**Capture-on-buy (RF0)** is the ongoing mechanism (Rulings §3) — it needs nothing from the bank at
all, only the exchange logger the pipeline already reads.

**Optional later convenience (RF5, Ben-gated, NOT required to ship RF0–RF4):** if manual re-seeding
proves too tedious for pre-log drift (items acquired outside GE — clan drops, quest rewards), a
sibling directory to `.runelite/exchange-logger/` — e.g. `.runelite/bank-export/` — can hold a raw
JSON snapshot from a small RuneLite plugin (mirrors `pipeline/FILLS-PIPELINE.md` §8's "worst case: a
~100-line custom plugin" fallback — `ItemContainerChanged` on the bank container is exactly as small
as the exchange-logger fallback described there). `pipeline/commands/sync-bank.mjs` would read it
the same way `sync-fills.mjs` reads `LOG_DIR` (same ADAPTER-comment-and-`--probe` verification
discipline), diff against `owned-items.json`, and **print a proposed reconciliation** —
`--apply` writes it, nothing auto-applies silently. Still bank-truth-stays-advisory: it only ever
touches `owned-items.json`, never `fills.json`/`positions.json`. This chunk is explicitly optional
and last — RF0's seed+capture-on-buy design is sufficient on its own.

---

## Question 4 — Slot/timing fit (schedule, book, positions)

**`reverse-flip-state.json`** (NEW, tracked, repo root — mirrors `hold-thesis.json`'s shape/CLI
pattern):

```json
[
  { "id": 21018, "name": "Ancestral hat", "state": "awaiting-rebuy",
    "soldQty": 1, "soldEach": 57000000, "soldTs": 1753315200,
    "beRebuy": 55860000, "targetQty": 1,
    "rebuyBidPrice": 54050000, "rebuyBidTs": 1753318000,
    "declaredTs": 1753315300 }
]
```
_(Illustrative mid-cycle `awaiting-rebuy` entry — id corrected to the real Ancestral hat 21018. NB: the
real 2026-07-24 hat cycle this was drawn from has since COMPLETED — the @57m sell now sits in
`positions.json.unmatched` and the rebuy FILLED @~53.515m as an open lot; that completed loop + the live
`unmatched` sell are a real on-disk instance of the RF3 Case-B reconciliation, a stronger worked example.)_

`state` ∈ `holding` (declared, not yet sold — pre-trigger) → `awaiting-rebuy` (sold, no bid resting
yet — fully capital-free) → `rebuy-armed` (a bid IS resting — `offers.json` already tracks it as a
normal buy offer, no special-casing needed there) → `rebought` (cycle closes, entry pruned/archived
like `hold-thesis.json`'s TTL). Written by `pipeline/commands/declare-reverse-flip.mjs`
(`set|advance|clear|list`, mirrors `declare-thesis.mjs` exactly) — the agent declares/advances state
when Ben reports what happened ("sold the hat at 57m" → `awaiting-rebuy`; "bid resting at 54.05m" →
`rebuy-armed`), never a script inferring intent from raw fills.

**Surfacing (all three additive, inform-only, no auto-placement — Ben places every market offer):**

- **`/schedule` (`read-schedule.mjs`).** A new row source alongside the existing
  positions∪offers / watchlist union: every `reverse-flip-state.json` entry in `awaiting-rebuy`
  gets a REBUY row using the **same** `hourProfile` dip-window machinery every other buy row already
  uses, but additionally gated for display purposes on `live price ≤ beRebuy` — the row reads
  "not yet (live 58.2m > BE 55.86m)" until price crosses under BE, then "rebuy window — BE 55.86m,
  live 54.1m, dip window active." This reuses `hoursUntil`/`isInsideWindow`/`hourProfile` verbatim;
  it is a new row-source function (`reverseFlipRows`), not a new timing model.
- **`/book` (`read-book.mjs`).** A new **"Reverse-flip pending"** section, separate from the
  per-lot P&L board (since an `awaiting-rebuy` item holds **zero** GE-slot commitment — it is
  capital-free by construction until a bid is actually placed). Once `state` advances to
  `rebuy-armed`, the resting bid already appears in the normal offers-derived slot accounting with
  **no reverse-flip-specific code** — `offers.json` doesn't know or care why a buy offer exists.
- **`/positions` (`quote-items.mjs --positions` / the `/positions` skill).** Because a Case-B
  `awaiting-rebuy` item has no open FIFO lot, it's invisible to the normal held-lots table by
  construction — add a small additive "pending reverse-flip" block reading `reverse-flip-state.json`
  directly (same shape/placement as the schedule row, reused rather than re-derived) so the cycle
  never silently disappears between the sell and the rebuy.

**The slot-squat / rebuy-miss failure mode (honest, not solved, just bounded).** A resting rebuy bid
priced below a level the market never revisits ties up a GE slot indefinitely for no gain. Per the
strategy's own risk framing this is BOUNDED (no deadline — worst case, wait for the next dip) and
per the repo's standing judgment ("Patience on cancel and cut" — don't be trigger-happy on
cancelling a resting bid off a few quiet days), this plan does **not** propose an auto-cancel. It
proposes only an **inform** note: if an `awaiting-rebuy`/`rebuy-armed` entry's `soldTs` (or
`rebuyBidTs`) ages past a placeholder `REBUY_STALE_DAYS` with price never crossing `beRebuy`,
`/schedule`'s row for it prints a `⚠ N days awaiting rebuy — reconsider level?` note. Never
auto-cancels, never escalates to a headline alert — a visible nudge only, matching the repo's
existing armed-note-not-headline pattern (`convictionGate` in `pipeline/lib/watchstate.mjs`) without
actually wiring into that gate (reverse-flip is not a held-lot verdict; wiring it into
`convictionGate` is explicitly out of scope for this plan, see Open Questions).

---

## Staged chunks

Each ships independently, carries its own reconciling docs pass (CLAUDE.md, README.md file
inventory, `docs/GLOSSARY.md` if a new term needs one) and `node --check` + fixture validation per
`PLAN.md`'s Executor rules. Primary-file lists are the parallel-safety contract (disjoint sets may
run concurrently; RF2 depends on RF0+RF1; RF3/RF4 depend on RF0).

### RF0 — Owned-item + cycle-state substrate (foundation, no screen/gate logic yet)

Ships the tracked stores + CLI so Ben can start tracking the in-flight Ancestral-hat cycle
immediately, before any screening logic exists.

- **New:** `owned-items.json` (tracked, repo root, ships with the live seed entry for the
  Ancestral hat + a `_doc`). `reverse-flip-state.json` (tracked, repo root, ships `[]`).
- **New:** `pipeline/lib/ownedledger.mjs` — pure `computeOwnedQty(item, fillsEvents)` fold (Q1),
  `foldPendingBuys(fillsEvents, ownedStore)` (the `BIG_TICKET_GP` + qty-ceiling pending-classify
  filter), load/save helpers (mirrors `pipeline/lib/holdthesis.mjs`'s shape).
- **New:** `pipeline/lib/reverseflipstate.mjs` — load/save/upsert/clear/prune for
  `reverse-flip-state.json` (mirrors `pipeline/lib/holdthesis.mjs` verbatim in structure).
- **New:** `pipeline/commands/declare-owned.mjs` — `seed "<item|id>" [--qty N]`,
  `classify "<item|id>" flip|keep|consumable`, `eligible "<item|id>" on|off` (sets
  `reverseFlipEligible`), `list`.
- **New:** `pipeline/commands/declare-reverse-flip.mjs` — `set "<item|id>" --state
  awaiting-rebuy --sold-each <gp> --qty N [--sold-ts <iso>]`, `advance "<item|id>" --state
  rebuy-armed --bid <gp>`, `clear "<item|id>"`, `list` (mirrors `declare-thesis.mjs`).
- **Extend:** `hold-thesis.json` entries gain an optional additive `reverseFlip: true` (Case A
  marker) — `pipeline/lib/holdthesis.mjs` upsert accepts/preserves it; existing entries without it
  stay valid (additive, no back-compat break).
- **Acceptance:** `computeOwnedQty` fixture-pinned over a synthetic fills.json (seed + buy + sell +
  reverse-flip-shaped sell/rebuy sequence) proving qty tracks to 0 and back with zero
  reverse-flip-specific logic in the fold itself. `declare-owned.mjs`/`declare-reverse-flip.mjs`
  round-trip tested (set → list shows it → clear → list is empty). README entries for both new
  tracked files + both new lib modules + both new commands, in the same commit.

### RF1 — `js/reverseflip.mjs` (pure gate/edge module)

- **New:** `js/reverseflip.mjs` — `invertedRegimeGate(trajectory)` (re-maps `classifyTrajectory`'s
  shape per the Regime Asymmetry table — rising→reject, falling/cooling/oscillating/based→pass,
  short/unknown→caution), `reverseFlipEdge(ctx)` (computes `beRebuy = sellRef − tax(sellRef)` via
  the canonical `js/money-math.js` `tax()`, an amplitude-floor check against a placeholder
  `REVERSE_MIN_SWING_PCT`, direction-agnostic), `reverseFlipGate(ctx)` (composes the regime gate +
  amplitude floor + a rebuy-leg-weighted liquidity check — see Honesty). No fetch, no fs, DOM-free,
  importable by node and (later) the app like `js/valuescreen.mjs`/`js/amplitudescreen.mjs`.
- **Acceptance:** conformance fixture set mirroring the repo's shared archetypes (rising→reject,
  oscillating→pass, falling→pass, thin-liquid→caution-not-reject on the sell leg specifically,
  thin-liquid→caution/reject on the rebuy leg) in `pipeline/test/reverseflip.test.mjs`. No throw on
  missing/short data (degrade-to-caution, the `momVerdict` optional-degradation precedent).

### RF2 — `--mode reverse` wiring

- **Registry entry:** `FLIP_NICHES.reverse` in `js/flip-niches.mjs` (`inAll: false`, explicit-only
  like `scalp`; `gate: 'reverse'` routed in `pipeline/lib/gatecandidates.mjs` to a new
  `gateReverseFlipCandidates` that reads the RF0 pool — `owned-items.json` `reverseFlipEligible`
  items ∪ `hold-thesis.json` `reverseFlip:true` entries — and fetches each directly (no two-stage
  proxy-ordered fetch pool; population is small and pre-selected by ownership, not attention-
  worthiness, unlike every other niche).
- **Wire into** `screen-flip-niches.mjs`'s mode dispatch/usage string/error message (adds `reverse`
  to the explicit-only set alongside `scalp`) and its own table renderer (own columns: Item · Live ·
  Regime(inverted read) · Sold-ref/Peak · BE-rebuy · Swing · gate status — not the standard table-v2
  set, matching the `value`/`amplitude` "own table" precedent).
- **Acceptance:** `node pipeline/commands/screen-flip-niches.mjs --mode reverse` runs against the
  live `owned-items.json` seed without throwing on an empty-eligible-pool day (prints "no reverse-
  flip candidates flagged eligible" rather than erroring). Replay-goldens (`pipeline/test/
  replay.test.mjs`) untouched — reverse-flip's pool never overlaps the standard-mode fetch universe
  by construction, so this is provably zero-ripple on existing modes.

### RF3 — BANKED-backfill reconciliation advisory

- **New:** `pipeline/commands/reconcile-reverse-flip.mjs` — given an item, reads
  `reverse-flip-state.json` + `positions.json.unmatched`, and when a matching unmatched sell exists
  for a declared reverse-flip item, **prints** (never runs) the exact `add-manual-fill.mjs --type
  banked --price <basis> --time <ts>` command with the correct historical timestamp. Read-only —
  touches no file.
- **Acceptance:** fixture with a synthetic `unmatched` sell + a `reverse-flip-state.json` entry
  produces the exact expected command string; a no-declaration or no-unmatched-match case prints
  "nothing to reconcile," never a false positive suggestion.

### RF4 — Surfacing wiring (`/schedule`, `/book`, `/positions`)

- **`read-schedule.mjs`:** new `reverseFlipRows(state, hourProfileByItem, now)` pure row-builder
  (parallel to the existing `agendaRowsForItem`), unioned into the agenda output, tagged distinctly
  (e.g. `RF`) so it's visually distinguishable from a normal position/watchlist row. Includes the
  `REBUY_STALE_DAYS` nudge note.
- **`read-book.mjs`:** new "Reverse-flip pending" section (own render block in `book-model.mjs`,
  pure, fixture-tested) listing `awaiting-rebuy`/`rebuy-armed` entries with sold price, BE-rebuy,
  live price, days-pending.
- **`quote-items.mjs --positions`:** a small additive block reading `reverse-flip-state.json`
  directly, rendered after the normal held-lots table, reusing `fmt`/`fmtP` — no new formatting
  primitives.
- **Acceptance:** fixture-pinned pure row-builders for each surface (no live fetch in the test);
  each surface degrades to printing nothing extra when `reverse-flip-state.json` is `[]` (byte-
  identical to pre-RF4 output on an empty store — zero-ripple on every existing consumer/test that
  doesn't touch reverse-flip).
- **Hourly-drift fold (PLAN-HOURLY-3DAY-TREND HT4):** each reverse-flip candidate surfaced here (and
  in RF2's `--mode reverse` table) carries the shared `hourlyDriftNote` — because selling an owned
  item at a "peak" into a *falling* hourly regime is the trap inverted, and a *rising* hourly drift
  is the reverse-flip's own BAD signal (the regime-asymmetry table above). Shared note module, no new
  compute; wired when HT2/HT4 land.

### RF6 — Thin big-ticket read handling

The reverse-flip population is mostly thin big-ticket, and Ruling 6 records why the standard reads
mislead on it. This chunk makes the thin case honest. It's mostly a set of thin-aware DISPLAY guards
plus one longer-window default — all inform-only, none gate. Depends on PLAN-HOURLY-3DAY-TREND (HT0–HT2
shipped; the `--days`-honest drift label + percentage ask-reach render landed 2026-07-24).

- **Thin detection (one predicate, reused everywhere).** `isThinBigTicket(row)` — true when the item
  is big-ticket (guide ≥ `BIG_TICKET_GP`) AND liquidity-thin (a clearable tranche ≤ ~2 units, or
  `vol/d` below a placeholder floor). Pure, off fields already in hand. This is the switch every guard
  below reads; no per-surface re-derivation.
- **Longer drift window on thin items.** When `isThinBigTicket`, the drift read defaults to a longer
  window (e.g. 7d, not 3d) — because on a thin book the 3-day slope whipsaws (hat: 3d +1.47m up vs 7d
  flat; the 7-day is the honest read). Uses the now-`--days`-honest `hourlyDrift`/`hourlyDriftNote` — no
  new compute, just a thin-aware default for `days`. The label already tells the truth about the window.
- **Traded-mid vs standing-ask spread flag.** On a thin item, surface `trades ~<guide>; lone asks to
  <liveInstabuy>, reached <N/14d>` whenever the live sell offer sits materially above the traded guide
  and that ask level is rarely reached (the 58m-reached-2/14d catch). So a lone optimistic ask is never
  mistaken for "the price". Off the reach/placement data already computed — inform-only.
- **Range, not a point, on thin recommendations.** Where a thin big-ticket emits a list/sell price
  (RF2/RF4 surfaces, and quote-items when the item is reverse-flip-eligible), show a **band**
  (`list ~X–Y`) off the reachable-band read rather than a single false-precise number. The point stays
  available (the band's reachable center); the band communicates the real intraday wobble.
- **Reverse-flip rebuy-reliability caution (the reverse-flip-specific payload).** Thin items are the
  RISKIEST reverse-flip because the rebuy leg is unreliable — a deep rebuy bid can strand while you're
  out of the position and the price ranges/rises away (the live hat 54.05m→cancelled case). RF4's
  reverse-flip rows carry a thin-item `⚠ rebuy may strand (thin, <vol/d>)` note, and RF1's edge read
  discounts the expected value of a thin rebuy leg (inform — it never blocks Ben placing the bid).
- **Acceptance:** `isThinBigTicket` fixture-pinned (a thin big-ticket → true; a liquid big-ticket like a
  common rune → false; a thin CHEAP item → false, not big-ticket). Each display guard degrades to the
  existing output on a non-thin item (byte-identical — zero ripple on the liquid path). All thresholds
  (tranche ≤2, the vol/d floor, "materially above") are PLACEHOLDER constants, documented as such.
  INFORM-ONLY throughout — nothing here gates, drops, or moves a quoted number; it reframes the read.

### ~~RF5 — (OPTIONAL, Ben-gated, last) Bank-export re-seed convenience~~ — **DELETED (Ruling 10)**

> **DELETED 2026-07-24 (Ruling 10).** The RuneLite `data-export` plugin already exists and runs on Ben's
> machine (`~/.runelite/Data Exports/container_bank.json`), so this chunk's premise is moot — the seed reads
> that file directly (`PLAN-MCP-BANK-SERVER.md`). Struck-through text retained for history only; do not build.

- **New (only if Ben asks for it):** `.runelite/bank-export/` sibling dir (gitignored, mirrors
  `.runelite/exchange-logger/` conventions), `pipeline/commands/sync-bank.mjs` (`--probe`/`--dry`/
  `--apply`, same discipline as `sync-fills.mjs`'s onboarding checklist). Diffs against
  `owned-items.json`, **prints** a proposed reconciliation, only `--apply` writes it — never touches
  `fills.json`/`positions.json` (preserves the 2026-07-03 ruling's core safety principle verbatim).
- **Acceptance:** same `--probe` verification discipline as `sync-fills.mjs` §4 step 5 — raw export
  lines next to parsed output, adjust field mapping against a real export before trusting it.
  Explicitly deferred/optional — RF0–RF4 ship and are useful without this chunk ever landing.

---

## Encoding boundary

| Concern | Encoded (script) | Judgment (Ben/agent) |
| --- | --- | --- |
| Owned qty (must reconcile up AND down) | `computeOwnedQty` pure fold over fills.json — never hand-edited | none — this is mechanical given data |
| Regime-inversion mapping (rising=bad) | `invertedRegimeGate` — a fixed re-map of `classifyTrajectory`'s existing output | none — the mapping itself is the ruling, stated once |
| BE-rebuy level | `tax()`-based, mechanical | none |
| Whether an item is a reverse-flip CANDIDATE at all | `reverseFlipEligible` flag — RF2's table surfaces eligible-shape items, Ben opts them into the flag | **Ben decides** — not every "keep" item is a good oscillator |
| Whether/when to actually place the rebuy bid | `/schedule`'s row shows window+BE+slot facts | **Ben places every market offer** — the row is a prompt, never an action |
| Whether to backfill a BANKED line for a Case-B sell | RF3 prints the exact command | **Ben runs it or doesn't** — cosmetic gap either way (see Q2) |
| Stale-rebuy nudge threshold (`REBUY_STALE_DAYS`) | printed note, mechanical trigger | the THRESHOLD itself is a named placeholder pending real cycles |

## Bookkeeping & compatibility checklist (per chunk, not deferred)

- **README.md** "Files"/"Map of the repo" gets an entry, at creation, for: `owned-items.json`,
  `reverse-flip-state.json`, `js/reverseflip.mjs`, `pipeline/lib/ownedledger.mjs`,
  `pipeline/lib/reverseflipstate.mjs`, `pipeline/commands/declare-owned.mjs`,
  `pipeline/commands/declare-reverse-flip.mjs`, `pipeline/commands/reconcile-reverse-flip.mjs`, and
  (RF5 only, if built) `pipeline/commands/sync-bank.mjs` + the `.runelite/bank-export/` note in
  §10-style environment docs.
- **`.gitignore`:** RF5's raw `.runelite/bank-export/` snapshot stays local/gitignored, matching
  `.runelite/exchange-logger/` — `owned-items.json`/`reverse-flip-state.json` themselves ARE tracked
  (small, no PII, same class as `hold-thesis.json`).
- **`pipeline/FILLS-PIPELINE.md`:** no reconstruction-contract change (Q2's whole point) — but §5.1
  gets a short cross-reference note pointing at this plan's Case A/B split, so a future reader of
  the reconstruction doc isn't surprised reverse-flip exists and touches nothing there.
- **`CLAUDE.md`:** once RF2/RF4 ship, add one ask→command row ("what can I reverse-flip?" /
  "sold X, track the rebuy" → the relevant commands) — not part of this plan doc's own edits, but
  flagged here so the executing chunk doesn't skip it (rule 8).
- **`docs/GLOSSARY.md`:** add a "reverse-flip" entry alongside "flip-niche"/"held-item strategy" in
  Part 1, and a codename-table row in Part 2 if this plan's chunk IDs (RF0–RF5) get referenced
  elsewhere after folding into `PLAN.md`.
- **APP_VERSION:** none of RF0–RF5 touch an app-imported module (`js/reverseflip.mjs` is node-only
  at ship time, same class as `js/valuescreen.mjs`/`js/flip-niches.mjs` per `docs/ARCHITECTURE.md`'s
  shared-module table) — no bump expected unless a later chunk adds an app surface (out of scope
  here).
- **`docs/ARCHITECTURE.md`:** add `js/reverseflip.mjs` to the node-only shared-module list in "The
  shared-module / blast-radius model" section in the same commit RF1 lands.

## Honesty (process rule 4 — name every placeholder)

- **n≈0 everywhere.** There is exactly ONE live instance in flight (the Ancestral hat) as of this
  plan's writing. Every threshold below is a **named placeholder**, not a calibrated value:
  `REVERSE_MIN_SWING_PCT` (the amplitude floor), `PENDING_QTY_MAX`/`MAX_PENDING` (capture-on-buy
  filter), `REBUY_STALE_DAYS` (the slot-squat nudge). None of these should be treated as tuned until
  real cycles accrue — this is the same posture as every other flip-niche's launch (`amplitude`,
  `value`, `scalp` all shipped with named placeholders pending evidence).
- **Thin-item both-leg reliability is unvalidated and actively contradicts the naive prior.** The
  ONE data point available (Ancestral hat, instant fill above ask) suggests the SELL leg on a
  wanted/thin item may be MORE reliable than a liquid-market liquidity gate would assume, while the
  REBUY leg's reliability is genuinely unknown (no completed cycle yet). RF1's gate is deliberately
  weighted toward the rebuy leg for this reason, but that weighting itself is a judgment call, not a
  derived one.
- **The regime-inversion heuristic itself is a heuristic, not a proven edge.** "Rising is bad for
  reverse-flip" is directionally obviously true (you'd rebuy higher), but the MAGNITUDE at which a
  weak uptrend still nets positive after a peak sell is unmeasured — `invertedRegimeGate` is a
  binary accept/reject on shape, not a margin computation (unlike `amplitudeDriftMargin`'s numeric
  approach for the amplitude lane). A future chunk could tighten this into a margin-based gate once
  cycles accrue — explicitly out of scope here (see Open Questions).
- **The rebuy-miss / slot-squat failure mode is bounded, not solved.** This plan ships an inform
  nudge (RF4), not a cancellation policy, deliberately (per "Patience on cancel and cut" — the
  repo's standing judgment against trigger-happy cancels off a few quiet days). A truly stuck rebuy
  (price permanently re-rates above BE) has no automated resolution in this plan; Ben re-evaluates
  by hand, same as any other stale resting bid.
- **Capture-on-buy's `BIG_TICKET_GP` + qty-ceiling filter is a heuristic pre-filter, not a
  classifier.** It will both miss genuine "keep" items bought cheap/in bulk (e.g. a large stack of
  a farming input Ben wants for himself) and flag some big one-off flip buys that were never meant
  to be kept. This is fine because misclassification costs nothing (Encoding-boundary table) — a
  missed "keep" item just never gets a reverse-flip candidate row until Ben manually seeds it; a
  false-positive prompt just gets answered "flip" once and never asked again.

## Verification (cross-cutting, beyond each chunk's own acceptance criteria)

- `node --check` every new/touched `.mjs`/`.js`.
- `node pipeline/ci/run-tests.mjs` picks up the new `pipeline/test/*.test.mjs` files automatically
  (glob-discovered per `TD1`) — no manual test-registry edit needed.
- `pipeline/ci/check-imports.mjs` (E1) must pass — every new command's imports resolve.
- No app-facing change in RF0–RF4 (per the Encoding-boundary/APP_VERSION note above), so no browser
  smoke pass is required for those chunks; if a later chunk adds an app surface, the standard
  `serve.cmd` + real-browser check applies then.
- RF2's acceptance criterion that replay goldens are untouched is the load-bearing zero-ripple proof
  for this whole plan: reverse-flip's pool is province-disjoint from every existing niche's fetch
  universe by construction (ownership-gated, not market-gated), so nothing about the existing screen
  funnel can regress.

## Build sequencing / readiness (added post-scoping, 2026-07-24 — read-only verification pass)

This section turns the scoped plan above into a build-ready sequence. It was produced by reading
every file the plan cites as existing scaffolding and checking the claim against the actual code —
no source was changed to produce it.

### 1. Claim verification

| Claim (where made) | Verdict | Evidence |
| --- | --- | --- |
| `matchTrades()`/`collapseOffers()` handle sell-then-rebuy correctly, zero changes needed (Q2, Case A) | **CONFIRMED** | `pipeline/lib/reconstruct.mjs:258-304` — a SELL against an open lot closes it into `closed` with real realised P/L; the next BUY event opens a fresh lot via the same FIFO queue. No reverse-flip-specific branch needed. |
| A `BANKED` fill-line mechanism already exists and enters the FIFO queue like a buy (Q2 Case B, existing-scaffolding bullet) | **CONFIRMED** | `reconstruct.mjs:264-268` (`o.type === 'buy' \|\| o.type === 'banked'` pushes into the same lot queue, carrying `banked:true`); `parseJsonLine`/`normalizeStateStr` (`reconstruct.mjs:50-53,99-100`) recognize a `BANK`/`WITHDRAW` state; `add-manual-fill.mjs` already ships a working `--type banked --price <basis>` CLI path (`add-manual-fill.mjs:20,96,108-110`) with a `Dragon claws --type banked` example in its own header — this is a live, exercised mechanism, not aspirational. |
| A SELL with no open lot lands in `unmatched`, today's safe default (Q2) | **CONFIRMED** | `reconstruct.mjs:289` (`if (remain > 0) unmatched.push(...)`). |
| `declare-thesis.mjs` is the CLI pattern RF0's `declare-owned.mjs`/`declare-reverse-flip.mjs` should mirror | **CONFIRMED, with one nuance** | `declare-thesis.mjs` mirrors cleanly for `resolveId`/positional-vs-flag parsing/`set`/`clear`/`list`. But it actually writes to **two stores** (`session-thesis.json` gitignored + `hold-thesis.json` tracked) with a `--path` flag bridging them — a two-store split RF0 does NOT need (it's one tracked store, `reverse-flip-state.json`). The cleaner mirror is `pipeline/lib/holdthesis.mjs` (`loadHoldThesis`/`saveHoldThesis`/`upsertThesis`/`clearThesis`/`pruneHoldThesis`, all pure, all confirmed at `pipeline/lib/holdthesis.mjs:57-94`) — a flat tracked array, load/save/upsert/clear/prune, exactly RF0's `reverse-flip-state.json` shape. Build RF0's lib module off `holdthesis.mjs`, and treat `declare-thesis.mjs` only as the CLI **argv-parsing** shape reference, not the storage shape reference. |
| `ignored-items.json`'s shape is what `owned-items.json` should mirror | **CONFIRMED, structurally** | `ignored-items.json:1-21` — `{ _doc, items:[{id,name,reason}], greenlisted:[] }`. The mirror holds for "one `_doc` + a tracked `items[]` array of small objects," but `owned-items.json`'s actual per-item shape (qty, classification, `reverseFlipEligible`, source) is materially richer than `ignored-items.json`'s `{id,name,reason}` — the plan's own worked example (lines 150-171) already reflects this correctly; only the top-level convention (doc string + items array) is actually shared. |
| `js/flip-niches.mjs`'s `gate:'value'`/`gate:'amplitude'` seam is the pattern `gate:'reverse'` slots into (RF2) | **CONFIRMED** | `pipeline/lib/gatecandidates.mjs:237-241` (`gateCandidates`; drifted from 194-198 via fetch-pool scaling `5e7e9d9` — content unchanged) already branches `spec.gate === 'value'` / `'amplitude'` to dedicated gate functions before falling into the shared liquidity+edge stack — adding `if (spec.gate === 'reverse') return gateReverseFlipCandidates(...)` is a one-line, well-precedented addition. **One correction to RF2's acceptance text**: `validateNicheSpec` (`flip-niches.mjs:425`) has a closed `VALID_GATE` allow-list `Set(['band','value','amplitude'])` (`flip-niches.mjs:394`) — RF2 MUST add `'reverse'` to that set or the conformance test (`flip-niches.test.mjs`) will fail the moment the new spec registers. Not called out as an explicit RF2 sub-task in the current text; small but will trip an implementer who copies the `value`/`amplitude` precedent without re-reading the conformance list. |
| The Regime Asymmetry table's shape vocabulary (`rising`/`falling`/`cooling`/`oscillating`/`based`) is what `classifyTrajectory` emits, and `invertedRegimeGate` re-maps it 1:1 | **RESOLVED (Ruling §7, 2026-07-25)** — was a real spec bug, now FIXED in the top Regime Asymmetry table | `js/termstructure.mjs:184` states `classifyTrajectory`'s actual output vocabulary in full: `shape ∈ 'knife' \| 'oscillating' \| 'based' \| 'rising' \| 'elevated' \| 'flat' \| 'unknown'`. **There is no `falling` shape and no `cooling` shape at all.** The nearest analog to "falling" is `knife` (a real decay/downtrend — see `basePosition()`'s own coarsening at `termstructure.mjs:307`, `shape === 'knife' → label = 'trending↓'`), and there's no analog to "cooling" — the closest concepts are `flat` (no drift) and `elevated` (like rising but off a high base). RF1's mapping HAS BEEN rewritten against the REAL 7-value enum (top table + Ruling §7): `rising→reject, elevated→reject (same "buy back higher" risk as rising), knife→pass (this IS the "falling" case the plan means), oscillating/based/flat→pass, unknown→caution`. RF1 codes `invertedRegimeGate` straight off that mapping — do NOT reintroduce a `case 'falling':`/`'cooling':` branch (never emitted → silent dead gate). |
| RF6 depends on PLAN-HOURLY-3DAY-TREND's shipped `--days`-honest `hourlyDriftNote` | **CONFIRMED, and already anticipates this plan** | `js/windowread.mjs:503-504`'s own header comment: "this is a SHARED export so a later reverse-flip fold (HT4, deferred pending PLAN-REVERSE-FLIP) can call it too with zero new compute" — `hourlyDriftNote(drift, { ask, fmt, days = 3 })` (`windowread.mjs:512`) takes a `days` param exactly as RF6 needs for the thin-item longer-window default. |
| `/schedule`, `/book`, `/positions` are extensible additive surfacing hosts (RF4) | **CONFIRMED** | `read-schedule.mjs` already has a per-item `agendaRowsForItem` row-builder (`read-schedule.mjs:85`) unioned into one agenda — a `reverseFlipRows` sibling is a same-shape addition. `read-book.mjs` renders off `pipeline/lib/book-model.mjs`'s pure `buildBook` (`read-book.mjs:34,142`) — a new section is additive there too. `quote-items.mjs --positions` (`quote-items.mjs:89`) is a real, live, dedicated code path (not aspirational), confirmed by its own header example. |
| `cycle-watch.json`/`dip-watchlist.json` are the precedent for `reverse-flip-state.json`'s "scoped state file" shape | **CONFIRMED** | `dip-watchlist.json:1-15` — flat tracked array of small per-item objects (`id,name,source,track,addedTs,...`), same shape class the plan proposes. |
| `BIG_TICKET_GP` exists in `js/quotecore.js` for the capture-on-buy filter (RF0) | **CONFIRMED** | `js/quotecore.js:94` — `export const BIG_TICKET_GP = 10_000_000;`, already consumed elsewhere in that file (screen-flip-niches' weak-deploy flag, per the plan's citation). |
| `tax()` is the canonical break-even function (Ruling 1) | **CONFIRMED** | `js/money-math.js:6,9` — `TAXCAP=5_000_000`; `tax(p) = p<50 ? 0 : min(floor(p*0.02), TAXCAP)`, exactly as described. |

**Net verdict: the FIFO/BANKED/CLI/surfacing scaffolding claims all hold up — RF0, RF2's wiring pattern, RF3, RF4, and RF6 are built on real, working code exactly as described.** The RF1 shape-vocabulary miss this section originally flagged **is now RESOLVED** — the Regime Asymmetry table (§ near top) + Ruling §7 were rewritten against `classifyTrajectory`'s REAL 7-value enum (`knife|oscillating|based|rising|elevated|flat|unknown`), so RF1 must simply code `invertedRegimeGate` against that table's mapping (`rising`/`elevated`→reject, `knife`/`oscillating`/`based`/`flat`→pass, `unknown`→caution). The old `falling`/`cooling` draft is dead. Reconciled 2026-07-25 (this section predated the fix rulings and was never updated — a leftover from the plan's own two-session evolution, NOT 2026-07-25 code drift).

### 2. Sequenced build order + dependency graph

The plan's stated order (RF0 → RF1 → RF2, RF3/RF4 depend on RF0) is directionally right but under-specifies two things: RF3 also needs RF1-shaped state semantics to be meaningful, and RF4/RF6 have a real ordering constraint with each other. Refined graph:

```
RF0 (stores + CLIs)
 │
 ├──▶ RF1 (pure gate/edge module — code invertedRegimeGate against the FIXED Regime Asymmetry mapping, Ruling §7)
 │      │
 │      ├──▶ RF2 (--mode reverse wiring; needs RF0's pool + RF1's gate)
 │      │      │
 │      │      └──▶ (Question 1b discovery lane rides in RF2, same dependency)
 │      │
 │      └──▶ RF6 (thin-item guards; consumes RF1's edge output for the ⚠ rebuy-strand note,
 │             but its display guards are otherwise independent of RF1/RF2 — could build the
 │             `isThinBigTicket` predicate + hourlyDriftNote wiring in parallel with RF1)
 │
 ├──▶ RF3 (BANKED-backfill advisory; needs RF0's reverse-flip-state.json shape + positions.json's
 │          existing unmatched[]; does NOT need RF1/RF2 — it's read-only reconciliation, orthogonal
 │          to whether the gate/screen logic exists yet)
 │
 └──▶ RF4 (surfacing in /schedule, /book, /positions; needs RF0's state store to read, and
            benefits from RF6's thin-item notes existing first so the rows aren't shipped bare
            and then immediately re-touched to add the ⚠ note — sequence RF6 before RF4's row
            text, even though RF4's plumbing could start in parallel)

RF5 (optional bank-export) — last, Ben-gated, no other chunk depends on it.
```

**Parallel-safe pairs** (disjoint file sets, per the plan's own primary-file-list contract): RF0 + nothing (foundation, must go first). Once RF0 lands: RF1 and RF3 touch disjoint files and can run concurrently. RF6's `isThinBigTicket` predicate + its `hourlyDriftNote` wiring touch `js/windowread.mjs`/a new thin-detection module and can start alongside RF1 (both read data already in hand; RF6 only needs RF1's *output shape* — not its implementation — to wire the rebuy-strand note, so a stub/interface-first split is possible if there's schedule pressure to parallelize). **RF2 and RF4 should NOT run concurrently** with each other if both touch `pipeline/lib/gatecandidates.mjs`'s `VALID_GATE` set and `read-schedule.mjs` in the same session — low collision risk but worth a quick check before dispatching as parallel lanes.

### 3. Minimum shippable

**RF0 + RF1 + RF2** is the smallest subset that delivers a usable, real reverse-flip loop:
- RF0 gives Ben a place to declare "I sold X, tracking the rebuy" the moment a cycle starts (the live Ancestral-hat cycle can be tracked TODAY once RF0 ships, independent of anything else).
- RF1 gives the gate/edge math (inverted regime + BE-rebuy) that makes a candidate table meaningful rather than just a raw list.
- RF2 gives the actual `--mode reverse` screen Ben runs to find/confirm candidates.

Without RF3, Case-B (pre-log owned items, the actual Ancestral-hat shape) P/L stays `unmatched` — cosmetically incomplete but NOT incorrect (the plan is explicit this is safe-by-design, Q2). Without RF4, the declared cycle only surfaces via `declare-reverse-flip.mjs list` — a manual check, not woven into the daily `/schedule`/`/book`/`/positions` habit; this is the biggest UX gap in the minimum-shippable slice but not a correctness or safety gap. Without RF6, thin-item pricing on the (mostly-thin) candidate population reverts to the standard reads' known false-precision failure mode (the anchor incident itself) — **this is the one omission from "minimum shippable" that has a live, dated, concrete failure example already in hand**, so it's the strongest candidate for pulling forward into the minimum slice ahead of RF4 if only one extra chunk can be afforded. RF3 and RF5 are the two genuinely deferrable chunks (RF3 is advisory-only convenience, RF5 is explicitly Ben-gated-optional per the plan's own text).

### 4. Open decisions that BLOCK the build (need Ben before code)

1. **RF1's shape-vocabulary fix (see Claim Verification above) needs a ruling, not just a bugfix.** Does `elevated` map to reject-like-`rising` (both are "bought back higher" risk) or does it get its own treatment? Does `flat` pass cleanly or get a caution (no drift ≠ guaranteed a dip will come)? This is a 10-minute decision but it's a decision, not mechanical — the current plan text doesn't make it because it was written against a vocabulary that doesn't exist.
2. **Seed contents.** RF0 ships "with the live seed entry for the Ancestral hat" (RF0's own text) — but the full seed list (what ELSE does Ben want tracked from day one: Battlestaff and Ghrazi rapier are already flagged `personal-use` on `ignored-items.json`, are they reverse-flip candidates too?) is undeclared. Blocks nothing structurally (capture-on-buy + manual seeding both work incrementally) but the RF0 acceptance criterion ("ships with the live seed entry") implies at least a decision on whether it's ONE item or several at ship time.
3. **`reverseFlipEligible` opt-in flow — who looks at the candidate table and when?** The plan (Q1) is explicit Ben must be SHOWN a candidate table and opt items in — but no chunk actually builds "show Ben a candidate table of `keep`-classified items that aren't yet eligible-flagged." RF2's `--mode reverse` screen shows already-eligible items; nothing surfaces the *pre*-eligible pool for Ben to review. Worth a ruling: is this a manual `declare-owned.mjs list` review, or does RF2's screen need a `--pending-eligible` view too?
4. **Placeholder thresholds are honestly named but unset.** `REVERSE_MIN_SWING_PCT`, `PENDING_QTY_MAX`/`MAX_PENDING`, `REBUY_STALE_DAYS` all need SOME starting number to ship compiling code, even as an admitted placeholder (the pattern every other niche already follows — `SCALP_MIN_ROI`, `CHURN_MIN_VOL` etc. shipped as named placeholders too). Not a blocker in the sense of needing Ben's judgment call on the VALUE (placeholders are supposed to be a guess), but the chunk executor needs to just pick numbers and say so — flagging so it isn't treated as an open question mid-build.
5. **Does RF6 gate any earlier chunk?** No — confirmed by re-reading: RF6 is explicitly "all inform-only, none gate" (RF6's own acceptance text) and is described as depending on RF1/RF2 only for which surfaces to attach its notes to, not for its own logic. RF6 does NOT block RF0-RF2's build; it only makes their OUTPUT honest on thin items. Given the anchor incident is precisely a thin-item misread, treat RF6 as de-facto required-before-Ben-trusts-the-tool even though it's not build-blocking in the dependency-graph sense (see Minimum Shippable above).

### 5. Gaps / ambiguities that would trip an implementer

- **RF1's shape vocabulary — RESOLVED (Ruling §7, 2026-07-25).** The top Regime Asymmetry table + Ruling §7 now encode the correct mapping against `classifyTrajectory`'s real 7-value enum; RF1 codes `invertedRegimeGate` off that table. The residual guard for the implementer: do NOT write a `case 'falling':`/`'cooling':` branch (never emitted → silent dead gate) — `knife` is the "falling" case. Verified against `js/termstructure.mjs:184` on 2026-07-25.
- **RF0's `computeOwnedQty` fold reads `fills.json` events directly, but RF0's acceptance criterion says "fixture-pinned over a synthetic fills.json."** `fills.json`'s real on-disk event shape is the raw normalized-event shape `reconstruct.mjs`'s `parseJsonLine`/`buildEvents` produce (`{ts,type,state,itemId,price,qty,filled,spent,...}`), not the higher-level `positions.json` closed/open/unmatched shape. The plan doesn't misstate this, but an implementer should confirm which layer `computeOwnedQty` folds over — raw `fills.json` events (correct, per Q1's own text: "over raw `fills.json` events") vs. `positions.json`'s derived rows — before writing the fixture, since the two have materially different per-event field names.
- **RF2's `VALID_GATE` conformance-list addition (`flip-niches.mjs:394`)** isn't named as an explicit RF2 sub-task in the current chunk text — add it explicitly so the chunk's acceptance criteria include "conformance suite passes with `reverse` registered," not just "the screen runs without throwing."
- **RF3's "prints the exact command" acceptance criterion should specify WHICH timestamp field of `positions.json.unmatched`** the backfill command's `--time` should target — `unmatched` entries carry `sellTs` (`reconstruct.mjs:289`) but the BANKED line needs the ACQUISITION time (pre-sale), which lives only in `owned-items.json`'s `seedTs`/`source`, not in the unmatched row itself. The plan's Q2 prose gets this right ("the correct historical timestamp") but doesn't say explicitly that it's `owned-items.json.seedTs`, not anything off `positions.json` — worth stating in RF3's own acceptance bullet since that's the file an RF3 executor will actually open.
- **RF4's "byte-identical to pre-RF4 output on an empty store" acceptance criterion is good discipline but should explicitly say WHICH existing fixture/golden it must match**, so the executor runs the real diff rather than eyeballing it.

### Biggest risk to a clean build

**~~RF1's shape-vocabulary mismatch~~ — RESOLVED (Ruling §7, reconciled 2026-07-25).** The original biggest-risk (an `invertedRegimeGate` coded against a `falling` value that `classifyTrajectory` never emits → a silent dead gate) is fixed: the Regime Asymmetry table + Ruling §7 now specify the mapping against the real 7-value enum, and this readiness section has been reconciled to match. The remaining watch-items are ordinary spec hygiene (Gaps §5): confirm `computeOwnedQty` folds raw `fills.json` events, add `'reverse'` to `VALID_GATE` as an explicit RF2 sub-task, and target `owned-items.json.seedTs` (not any `positions.json` field) for RF3's BANKED `--time`. None blocks RF0.

---

## Open questions / explicitly out of scope

- **Should `invertedRegimeGate` become a margin (like `amplitudeDriftMargin`) instead of a binary
  accept/reject once cycles accrue?** Flagged in Honesty; not decided here — needs real n.
- **Should a stuck `rebuy-armed` entry ever wire into `convictionGate`'s arm-then-confirm
  persistence machinery** (so a long-stale rebuy bid gets the same structured "armed note → escalate
  after persistMs" treatment a held lot gets)? Deliberately deferred — reverse-flip's pending state
  isn't a HELD lot (it's the absence of one), and folding it into `pipeline/lib/watchstate.mjs`
  would grow that module's scope beyond this plan's footprint. A future chunk's call, not this
  plan's.
- **Multi-item reverse-flip campaigns** (selling several owned items into the same peak window,
  batching rebuys) — the schema (`reverse-flip-state.json` as an array) supports N independent
  entries today; no batching/portfolio view is proposed here.
- **RF5's bank-export plugin** — explicitly optional per Rulings §3; only build on Ben's word,
  exactly like the `pnl.mjs`/N1-delivery-mechanism precedents in `PLAN.md`'s "Needs a Ben decision"
  list.
