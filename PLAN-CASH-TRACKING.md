# PLAN-CASH-TRACKING — derive idle cash from the log, stop asking Ben to re-state it

**Status:** problem statement. Investigation + resolution plan TBD (hand-off, same flow as
PLAN-VERDICT-NOISE.md). Do NOT implement from this doc — it frames the problem and the
accounting model; the resolution plan is a separate pass.

---

## Symptom

Every flip-loop pass, the total-capital footer reads idle cash off a **manually STATED
snapshot** (`.capital-state.json`, set via `node pipeline/cash.mjs <amount>`). The moment Ben
trades, that figure ages — so the assistant either (a) reports a stale idle-cash number, or
(b) pesters Ben to re-state it. In this session the snapshot said "47m stated 46m ago" while a
**53.10m** Dragon-hunter-lance bid was resting — a figure that *cannot* be true (GE would not
escrow a 53.10m bid against 47m of coins), yet nothing reconciled it. The assistant had to
hand-wave "your anchor is probably stale" instead of just **knowing** the number.

Ben's argument (verbatim intent): *"You should be able to calculate cash at any given instant
from my log and a starting point — and even auto-detect when I've added capital: if the sum
value of my resting offers exceeds your current cash snapshot, I clearly have more than you
think, so raise it. The only case you can't detect is when I'm SHORT — and I'll tell you that.
That's the one manual input you need from me."*

Cash is essentially **zero-sum and conserved**: it only moves when a buy fills (out), a sell
fills (in, after tax), or Ben injects/withdraws. The log already records the first two with the
full offer lifecycle. So idle cash is **derivable**, not something to poll a human for.

---

## What the data already gives us (grounded, with file citations)

- **`.capital-state.json`** (`pipeline/lib/cashstate.mjs`) — the current mechanism: a manual
  `{ cashGp, statedAt }`. The module comment states the premise this doc challenges: *"The GE
  cash stack is not in any log … so idle GP can only be tracked from a figure Ben states."* That
  is true of the *cash stack as a standalone reading*, but NOT of cash as a **derived balance**:
  a starting `cashGp` + `statedAt` is exactly the anchor the derivation needs.
- **`fills.json`** carries the **full offer lifecycle per event**: `{ ts, type: buy|sell,
  state: placed|cancelled|filled…, price, qty, filled, spent, itemId, slot, id }`. So every cash
  movement is present:
  - a **buy fill** → cash out = the buy cost (`spent`, or `price×filled`);
  - a **sell fill** → cash in = proceeds **after the 2% GE tax** (the same after-tax basis
    `positions.json` reconstruction already computes via `matchTrades` — reuse it, don't
    re-derive tax);
  - a **`placed`/`cancelled`** buy → no cash movement, but it marks escrow (see below). Live
    example this session: the DHL bid logged `placed` @ 53.101m then `cancelled`, both
    `filled:0 spent:0` — zero cash impact, correctly.
- **`offers.json` / `activeOffers()`** (`pipeline/lib/offers.mjs`) — the **resting (unfilled)
  offers** not yet in `fills.json`. A resting BUY escrows `qty×price` of cash (reserved by GE,
  unavailable to spend elsewhere); a partially-filled buy escrows the remainder. This is the
  bridge between "filled flows" (fills.json) and "committed-but-not-yet-settled" cash.
- **`capitalutil.totalCapital({workingGp, parkedGp, cashGp})`** (`pipeline/lib/capitalutil.mjs`)
  — the consumer. Today `cashGp` is the stated figure or `null`. The ask is to feed it a
  **derived** `cashGp` instead.

---

## The accounting model (the core of the resolution)

Define, relative to an anchor `{ cashGp₀, statedAt }`:

```
liquidCapital(now) = cashGp₀
                   + Σ sellProceedsAfterTax(fills where ts > statedAt)
                   − Σ buyCost(fills where ts > statedAt)          [FILLED buys]

availableCash(now) = liquidCapital(now)
                   − Σ restingBuyEscrow(active unfilled bids)      [offers.json]
```

- **`liquidCapital`** = every coin you'd have if all resting bids were cancelled — the true
  redeployable pool. This is what "scan at N capital" should use.
- **`availableCash`** = coins free to commit *right now* without cancelling anything (the
  in-game coin stack). This is what the footer's "idle cash" should show.
- The split must be **consistent about what the anchor means**: is `cashGp₀` the coin stack
  (excludes resting-bid escrow) or total liquid (includes it)? Pin one definition. (Recommended:
  anchor = coin stack = `availableCash` at `statedAt`; then resting bids placed *after* the
  anchor are already captured as `placed` events + offers.json, no double-count. The resolution
  must handle the anchor-time resting bids carefully — the ONE genuine subtlety.)
- **Partial fills / double-count guard:** a buy that is 60% filled has 60% in `fills.json`
  (`filled`/`spent`) and 40% escrowed in `offers.json`. Sum both, never the whole `qty×price`
  twice. `offers.json` remaining-qty is the source of truth for the unfilled leg.

---

## The injection detector (Ben's "auto-detect added capital")

The model self-heals in ONE direction. If at any instant:

```
availableCash(now) < 0          — OR —
Σ restingBuyEscrow > liquidCapital(now)
```

…the books are **contradictory**: Ben committed more gp than the anchor says he had, which is
only possible if he **injected capital** the anchor didn't know about. The resting-offer escrow
is therefore a **hard lower bound** on the true balance. The system should **raise the anchor**
to restore consistency (bump `cashGp₀` so `availableCash ≥ 0`, or ≥ the reserved total),
optionally re-stamping `statedAt` to now, and **report the inferred injection** ("detected +Xm
capital added — resting bids exceeded the tracked balance"). This is exactly Ben's *"if the sum
value of my offers exceeds your cash snapshot, I have more than you think."*

## The one unobservable case (the single manual input)

The derivation can **over-estimate** — the model cannot see gp that left the system *without a
tracked fill*: an off-ledger withdrawal, a non-flip purchase not routed through the logged GE
flow, or (the silent killer) a **missed log** (RuneLite off, a trade on an untracked device — a
missed SELL looks like an injection; a missed BUY looks like an over-estimate). In those cases
the derived cash is too HIGH and the assistant may suggest a buy Ben can't fund.

Ben's rule collapses all of this to a **single, rare manual signal**: *"I'll tell you when I'm
short — that's the only time I can't act on a suggestion."* So the design target is:

- **Derive by default; never ask Ben to re-state a number the log already implies.**
- **Self-correct UP** on the injection detector (offers-exceed-balance).
- **Accept one manual DOWN correction** ("I'm short / I only have Xm") — which just re-anchors.

Honesty (process rule 4): this is **deterministic accounting, not a model** — it is exactly as
correct as the log is complete. Name the completeness dependency loudly; the injection detector
masks a missed-sell as an injection, so it is a convenience, not a proof of correctness.

---

## Why it matters

- **Removes a recurring human-in-the-loop step** on every flip-loop pass (the standing
  cron task) — the assistant should open each pass already knowing deployable capital.
- **Makes "scan at N capital" honest** — N should be *derived `liquidCapital`*, not a number
  Ben typed 45 minutes and three trades ago.
- **Closes the reconciliation gap** that produced this session's "47m stated vs 53.10m bid
  resting" contradiction — the exact case the injection detector is meant to auto-resolve.
- **Serves the zero-sum framing Ben asked for** ("we need to do a better job tracking this as
  we buy and sell — it's essentially a zero-sum game").

---

## Scope & constraints

- **Node/pipeline-only.** The consumers are `watch.mjs` (footer), `quote.mjs`, and the
  `/scan` capital input — none are app-imported. Expected **no `APP_VERSION` bump** (confirm no
  edit reaches an app-imported module; flag if it does).
- **Reuse, don't re-derive:** the after-tax sell basis already lives in the `positions.json`
  reconstruction (`matchTrades`); the active-offer escrow already lives in `offers.mjs`
  (`activeOffers`). The deriver should compose these, not reimplement tax or offer parsing.
- **Keep `capitalutil.totalCapital` pure/fixture-testable** (it already is — the impure fs read
  stays in a `cashstate`-style module). The deriver is the new impure seam.
- **Never a verdict/alert input** — cash stays output-only (the existing `cashstate` invariant).
- **Backward-compatible anchor:** `.capital-state.json`'s `{cashGp, statedAt}` shape is the
  anchor already; `cash.mjs <amount>` becomes "re-anchor" (the manual DOWN correction), and
  bare `cash.mjs` should print the **derived** balance + its provenance (anchor age, net flow
  since, any inferred injection), not just echo the stored number.
- **Multi-writer safety:** the sync ff-pulls `origin/main` (mobile fills) before reading; the
  deriver reads the same reconciled `fills.json`, so mobile trades are already folded in.

---

## Candidate directions (for the investigation to weigh — not decisions)

1. **A pure `deriveCash({anchor, fills, offers})` in a new `pipeline/lib/cashderive.mjs`** →
   `{ liquidCapital, availableCash, netFlowSinceAnchor, restingEscrow, inferredInjection }`,
   fixture-tested against hand-built fill/offer sets (including partial-fill and
   injection-detect fixtures). `watch.mjs`/`quote.mjs`/scan read it.
2. **Anchor lifecycle:** keep the ORIGINAL anchor and always derive forward (no compounding
   drift), vs. periodically re-stamp. Recommend original-anchor + forward-derive; only the
   injection detector or a manual re-state moves it.
3. **Reporting:** the footer shows derived `availableCash` (coin stack) with `liquidCapital`
   (incl. cancellable bids) alongside, an age/provenance note, and an explicit
   "inferred +Xm injection" line when the detector fires. Replace the staleness banner —
   derived cash doesn't go stale the same way.
4. **The manual surface:** `cash.mjs <amount>` = re-anchor (the DOWN correction); add a
   lightweight "I'm short" path if a bare re-anchor is too heavy. Decide whether an auto-injection
   bump should persist to `.capital-state.json` or stay in-memory per pass.
5. **Completeness guard:** when net flow since the anchor is large or the anchor is very old,
   surface a soft "derived — verify against your coin stack" nudge rather than silently trusting
   a long unverified chain.

---

## Deliverable spec (for the resolution plan)

- Ranked chunks, smallest blast radius first (F0 = pure deriver + fixtures; then wire each
  consumer), mirroring PLAN-VERDICT-NOISE's F0→Fn shape.
- A pure, fixture-tested core (`cashderive.mjs`) with: normal derive, partial-fill no-double-count,
  injection-detect (offers-exceed-balance → inferred bump), and missed-log-honesty cases.
- Doc reconciliation pass: the `cashstate.mjs`/`cash.mjs` "can only be stated" comments are now
  SUPERSEDED — rewrite them in place (not append); update CLAUDE.md's cash pointer, README's file
  inventory for any new lib, and the `/scan`/`/positions` capital-input prose.
- Honesty framing throughout: deterministic accounting, log-completeness-bounded, injection
  detector is convenience-not-proof, one manual DOWN signal is the only human input.
- Node-only → no `APP_VERSION` bump (verify + flag if any edit reaches an app-imported module).
