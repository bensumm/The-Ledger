# PLAN-BOOK-SELF-HEAL — the book heals itself; old inconsistencies stop poisoning today

**Status:** PLANNED — tradeoffs settled with Ben 2026-09-02 (§2, his answers quoted), chunked (§4), ready for executors.
**Raised:** 2026-09-02 — "the sell log should self heal so that an inconsistency days ago shouldn't
affect a clean book today… My ledger shows last 3 days as red even though it's been positive."

---

## 1. The three failure modes (all verified at source before planning)

**A — Reverse-flip rebuy misfire.** `matchTrades` (pipeline/lib/reconstruct/reconstruct.mjs) closes a
keep round trip the moment ANY buy arrives for an item with an open short — intent-blind by design
(SM1). Ben frequently rebuys an item *intending a fresh flip*; the buy is silently consumed closing
the RT (often at a bad delta), his flip lot never opens, his next sell finds no lot → unmatched →
the flip's profit vanishes and the day reads red. Four shorts are open right now (items 21012,
29580, 11832, 11834 — ages 3–5 weeks), each a live tripwire.

**B — Aged half-legs poison forever.** Mobile logins miss transactions; manual amendments land days
later and re-fight the FIFO. An open short or unmatched sell participates in matching INDEFINITELY
(the "open measurement, no deadline" doctrine in matchTrades' header), so a weeks-old inconsistency
still grabs today's buys. **Ben has explicitly overridden that doctrine for UNDECLARED aged shorts**
(§2 Q2) — amend the header, don't half-respect it.

**C — Bond costed wrong on the amplitude screen.** `js/money-math.js` owns the correct bond model
(bond 13190: EXEMPT from 2% sell tax, but a GP-bought bond costs a 10%-of-guide retrade fee; OPT-IN
via `{bond:true, guide}` because netMargin can't see an itemId). `js/amplitudescreen.mjs` never opts
in — it uses a private `afterTax = p − tax(p)` (≈:67) — so it printed the bond at +457.8k/cycle
where the real number is −441,000/unit; the screen now offers 4 units (≈1.76m trap if taken).

**D (rides along) — offers.json phantom-slot class.** `activeOffers` (pipeline/lib/reconstruct/offers.mjs)
takes each slot's "latest" line by FILE-MTIME read order, not wall-clock. A manual CANCELLED line in
`coffer-manual.log` beats the live `exchange.json`'s stale BUYING row only until RuneLite appends
anything (mtime jumps) — then the phantom resurrects. Diagnosed live on the slot-2 crossbow bid
2026-09-02: the cancel was injected TWICE and the phantom returned twice. Durable fix = per-slot
latest-by-wall-clock (`Date.parse(date+'T'+time)`), ties keep later-read.

## 2. Decided design (Ben's tradeoff answers, 2026-09-02 — quoted where they constrain)

- **Q1 rebuy intent → "Time/price heuristic."** A buy closes an open short iff
  `(buyTs − short.sellTs) ≤ SHORT_MAX_AGE_DAYS` **AND** `buyEach ≤ short.beRebuy`. Otherwise the buy
  opens a normal flip lot and the short stays open (until it ages out, below). A hold-thesis
  `reverseFlip:true` declaration on the item OVERRIDES the gate (closes regardless — tool holds
  state, Ben drives). When the heuristic REFUSES a close that old code would have made, say so
  visibly (one line in the sync summary naming item + why) — decision-movers stay visible
  (gate-on-error-cost doctrine).
- **Q2 self-heal → breakeven closeout with special status, case-by-case revival.** ("Close them out
  with a special status at breakeven and revive them on a case by case basis… breakeven closeout
  seems simple.") At age > `SHORT_MAX_AGE_DAYS`, an UNDECLARED short settles: **realised 0 by
  construction** (it books `buyEach = beRebuy`), status-tagged, removed from the consuming queue.
  Preserve `sellEach`/`tax`/`beRebuy`/`sellTs` on the settled row so revival loses nothing.
  Aged `unmatched` rows already contribute zero realised — leave their matching alone; age-tag only.
- **Q3 retroactivity → "yes but breakeven closeout should minimize this — it's like it never
  happened."** Retro-correction stays the model; the settle-at-0 design is chosen exactly because
  it shifts no totals when it fires. **Plus a scope correction Ben attached: "personal use" items
  are per-TRADE (`--type withdraw` that one trade), never item-level ignore unless he explicitly
  asks** — ignoring an item = adding it to the app's ignore list, a separate deliberate act (§4 D).
- **Q4 bond → "Thread the real bond model."** Route the amplitude screen's costing through the
  existing opt-in (`row.bond` → money-math bond branch), the same way computeQuote/estimators
  already do. Do NOT blanket-exclude the bond.
- **Recorded tradeoff of the closeout (told to Ben before encoding):** the settled RT's real
  economics vanish from lifetime realised — a later rebuy below beRebuy books only the fresh flip's
  leg, so lifetime P/L is understated by the forgone RT deltas. Accepted for the clean daily book.
  Revival exists for the case-by-case exceptions.

## 3. Constants (⚖ judgment, one home each, no magic numbers inline)

- `SHORT_MAX_AGE_DAYS = 14` — both the heuristic's window AND the settle age (ONE constant; a short
  either closes inside it or settles at its edge). 14 covers the measured multi-week-oscillator
  class (fang period ~6–8d) while ending the four current 3–5-week tripwires. Lives beside the
  matchTrades short queue.
- Price gate = `beRebuy` exactly (no tolerance) — Ben picked the option as worded; keep it simple.

## 4. Chunks

**H1 — the heuristic + the closeout (one chunk; both live in matchTrades' short path).**
`matchTrades`: (a) the Q1 gate on short consumption, with the hold-thesis `reverseFlip` override
threaded as a parameter (matchTrades stays pure/IO-free — the CALLER loads hold-thesis, same
pattern as `keeps`; every existing caller passing nothing keeps byte-identical behavior on books
with no shorts older than the gate); (b) settle-at-age into a `settled` array on positions.json
(new schema key: `{itemId, qty, sellEach, tax, beRebuy, sellTs, settledTs, reason:'aged-out'}`;
realised 0 by construction — the app ignores unknown keys, console surfaces print it);
(c) `REVIVE` directive: `add-manual-fill.mjs --revive <item|id> [--sell-ts <ts>]` appends
`{"state":"REVIVE","item":<id>,"target":<sellTs>}` to coffer-manual.log — parsed as an EXEMPTION
MARKER (like REMOVE, no ts/slot of its own): the identified short is exempt from aging AND from the
price/time gate on its next matching rebuy. Pure function of the log → idempotent under full-history
rebuild, survives every resync. (d) Sync summary lines: shorts settled this run, closes the
heuristic refused. (e) AMEND the matchTrades header doctrine ("open measurement, no deadline" →
"declared shorts have no deadline; undeclared shorts settle at breakeven after SHORT_MAX_AGE_DAYS —
Ben 2026-09-02") — and reconcile FILLS-PIPELINE.md §5/§5.1a + docs/FLOW.md + README positions.json
entry with the new `settled` key and the heuristic. Failing-first tests: gate closes inside
window+price; refuses outside either; declared override closes anyway; settle books 0 and preserves
fields; REVIVE re-arms; eventId untouched; existing-caller byte-identity.
**Real-book acceptance (worktree `--repo-dir`, never Ben's live artifacts):** the four live shorts
settle at 0 (lifetime realised UNCHANGED — state the identity), awaitingRebuy empties into
`settled`, and the last-3-days per-day buckets stay green and unchanged.

**H2 — bond threading (js/, independent files).** `amplitudescreen.mjs` costs bond rows through the
money-math bond branch (`row.bond` + guide, mirroring computeQuote's opt-in), and SWEEP every other
screen/estimator lane for private `afterTax`/`tax(` money math that bypasses the opt-in (grep
`js/*.mjs` + `pipeline/lib/**`; report each site as fixed / already-opted-in / not-a-money-path).
The bond row must now print its true economics (regression test with a synthetic guide: the
+457.8k-class fake profit becomes the fee-dominated negative). APP_VERSION bump (deployed js/ change).
The money-math LATENT GAP note (js/ui.js `realised()`) stays latent — documented, bond still
quarantined in the book.

**H3 — offers wall-clock (pipeline/lib/reconstruct/offers.mjs).** `activeOffers`: per-slot winner by
`Date.parse(date+'T'+time)`; NaN or tie → later-read wins (re-emit semantics unchanged). Failing-first
test: a CANCELLED line earlier in read order but newer in wall-clock beats a stale BUYING from a
later-mtime file (the slot-2 crossbow shape, fixtures only). Update the offers.test.mjs header's
"latest line" business requirement to say wall-clock. Acceptance: a worktree offers-snapshot run
shows slot 2 gone while slots 6/7 survive.

**H4 — personal-use is per-trade (docs/skills only).** Encode Ben's Q3 rider where the workflows
live: the /positions skill + FILLS-PIPELINE §10 manual-fill notes — a personal-use mention =
tombstone THAT trade (`--type withdraw`), NEVER add the item to ignored-items.json unless Ben
explicitly asks for the ignore list. Audit the two skills' prose for anything implying item-level
ignore on mention.

**Version/CHANGELOG discipline:** H1+H3 = pipeline 1.3.0 (one entry, lane-1 writes it; H3's note
folds in at landing). H2 = APP_VERSION bump + its own CHANGELOG entry. Lanes land hand-serialized
(H2/H3 lane first, H1 lane rebases).

## 5. Migration effect (announce to Ben at landing, before his next bare sync)

First sync after H1 lands: the four open shorts settle at breakeven (realised 0 each — lifetime
realised does NOT move, unlike the SLT correction), `awaitingRebuy` empties into `settled`, and
every future rebuy of those items opens a clean flip lot unless REVIVEd. No other row changes.

## 6. Out of scope (named so nobody scope-creeps)

- Estimating a basis for unmatched sells (they stay zero-realised, age-tagged only).
- App-side Ledger rendering of the `settled` array (console-first; app display is a follow-up).
- The js/ui.js bond `realised()` latent gap (documented, quarantine-guarded).
- Freezing past days' P&L (Ben chose retro-correction).
