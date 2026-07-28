# PLAN-SYMMETRIC-MATCHING — match sells→buys the same way we match buys→sells

**Status:** PARTIALLY SHIPPED — **SM0 + SM1 are DONE** (SM1 landed 2026-07-27, `1d57e7c`); **SM2–SM5
remain OPEN**, which is why this file is still here rather than folded into `PLAN.md` and deleted.
(Corrected 2026-07-28: this line read "proposed, not started" long after SM1 shipped — see the
per-chunk headings in §6 for the authoritative state, and prefer them over this summary.)
Raised by Ben 2026-07-26 in response to a mis-modeling report
(see §2). **This SUPERSEDES the ownership-filter approach** that a prior investigation recommended —
that fix suppressed a symptom at three read surfaces; this one removes the cause in one function.

**Honesty (process rule 4):** the accounting claims below are arithmetic and were checked against
the live book on 2026-07-26. Nothing here is a calibration claim. The only empirical input is the
14-row `unmatched` census in §5, which is a full enumeration, not a sample.

---

## 1. The insight

The exchange log is the source of truth. Every buy is a buy; every sell is a sell. FIFO already
pairs **buy → sell** into a closed flip. It does not pair **sell → buy**, so a reverse flip (sell an
owned keep into a peak, rebuy at the dip) has no terminal state and leaks a phantom open lot.

Ben, 2026-07-26: *"Why can't we match sells to their purchase like we match purchases to their
sells?"*

Making the matcher symmetric is ~10 lines in one function and dissolves an entire layer of
compensating machinery.

## 2. The problem it fixes

Two reverse-flip cycles completed 2026-07-26:

| Item | id | Sold | Tax | Rebought | Realised |
| --- | --- | --- | --- | --- | --- |
| Masori body (f) | 27238 | 78,140,000 | 1,562,800 | 75,290,000 | **+1,287,200** |
| Confliction gauntlets | 31106 | 77,680,000 | 1,553,600 | 74,777,000 | **+1,349,400** |

After the rebuy legs filled, both items sat in `positions.json.open` as ordinary flip lots. Before
the cycle they existed only in `owned-items.json` (`classification:'keep'`) and did **not** appear in
positions at all — like the other ~25 bank keeps. The same physical item is modeled differently
purely because it transited the GE.

Live consequences:

1. `/positions` emits flip verdicts on restored personal gear — Masori drew a `CUT-CANDIDATE`,
   i.e. the tool advised cutting gear that had just been deliberately repurchased.
2. `buildBook`'s `workingGp` (`pipeline/lib/book-model.mjs:110`) sums every open group's cost with
   no owned-item awareness, so **~150.07m of bank keeps is counted as deployed working capital**,
   distorting the working/parked/idle split and everything downstream of it.
3. The lots consume alerting and attention as if tradeable.

**This is a design gap, not a bug.** Every component works to spec. `PLAN-REVERSE-FLIP.md` (deleted;
recoverable via `git show de5bb97^:PLAN-REVERSE-FLIP.md`) describes a completed cycle as *"the rebuy
FILLED … as an open lot; that completed loop"* — its authors treated "ends up as an open lot" as the
finished state. `REVERSE_FLIP_STATES` is `['holding','awaiting-rebuy','rebuy-armed']`; there is no
`'rebought'`. RF0–RF6 never scoped the terminal state.

## 2.1 SCOPE — this measures a keep ROUND TRIP, not a "reverse flip"

Owner ruling (Ben, 2026-07-27), in response to a raised concern that liquidating keeps to fund another
purchase would create pending shorts that never resolve:

> *"That's not a design problem, because I want those items eventually — this will just tell me how much
> money lost liquidating to invest elsewhere when I do rebuy."*

**A keep can be sold for several reasons** — a deliberate reverse flip (sell the peak, rebuy the dip),
or a liquidation to free capital for something else (2026-07-27: several keeps sold to fund a Soulreaper
axe). **The mechanism is identical and correct for both**, and the distinction is NOT recoverable from
the exchange log — a liquidation and a reverse-flip sell are byte-identical events.

That is not a limitation to work around; it is why no intent discrimination is needed. What the pending
short actually measures is the **round trip on owned gear**:

- `BE-rebuy = soldEach − tax(soldEach)` is the break-even on the *capital reallocation*.
- Rebuy **below** it → the reallocation was free or better; the capital was used elsewhere at no cost.
- Rebuy **above** it → the gap is exactly what the reallocation cost.

So a long-pending short is not cruft awaiting cleanup — it is an open measurement, and it resolves
whenever the item is actually rebought. **Consequences:** (1) no timeout, auto-retire, or staleness
sweep on the pending bucket — rejected, they would discard a live measurement; (2) the closed-row tag
must be intent-neutral (`keepRoundTrip`, not `reverseFlip`); (3) reclassifying a keep to `flip` remains
available for gear genuinely never coming back, but it is an owner decision, never a prompt or a nag
(see the SM2 PENDING-ONLY ruling).

## 3. Why the obvious fixes are wrong

**A `withdraw` cannot do this job — in either direction it is destructive.**
`computeOwnedQty` (`pipeline/lib/ownedledger.mjs:98-111`) folds `seedQty + Σ(buy/banked) −
Σ(sell/withdraw)` over events with `ts >= seedTs`; the only lever to exclude an event is a timestamp
below `seedTs`. But `matchTrades` has **no `seedTs` gate at all** and walks the full history:

- Stamped **after** the rebuy → counted by the fold → owned qty drops to 0 while the item is in the bank.
- Stamped **before** `seedTs` to escape the fold → in `matchTrades` it lands before the BANKED lot and
  consumes *that*, converting a correctly-booked `closed` profit row into `withdrawn:true, realised:0`
  — **it destroys the realised P/L.**

No timestamp convention makes it safe. Do not attempt it.

**An ownership filter at the read surfaces** (suppress a lot whose item is an owned keep, in
`quote-items.mjs` / `watch-positions.mjs` / `book-model.mjs`) works, but it is a symptom fix at three
call sites for a lot that should never have existed, and it leaves the two-state-machine problem in §4
untouched.

## 4. The state-machine argument

There are currently **two** state machines over the same reality:

- the **implicit** one in `matchTrades` — position = f(event history)
- the **explicit** declared one in `reverse-flip-state.json`

Two state machines over one reality can disagree, and on 2026-07-26 they did: `reverse-flip-state.json`
held Confliction at `awaiting-rebuy` while `positions.json.open` already carried the filled rebuy lot
(`buyTs 1785081021`, after the declared `soldTs 1785053373`). `/book`'s RF4 block would have printed
Confliction as *pending a rebuy* in one section while the same report showed it as an open flip lot in
another. Nothing in `read-book.mjs`, `read-schedule.mjs` or `reconcile-reverse-flip.mjs` cross-checks
the two.

Symmetric matching collapses them to **one**, derived from the log. The declared store then carries
only *intent and planning* (BE-rebuy, what's pending) and never accounting — a much smaller job, and
one it can't silently get wrong.

## 5. The gate — and the data that requires it

Unconditional symmetric matching would rewrite history. Census of `positions.json.unmatched`
(2026-07-26, full enumeration, n=14):

| Class | Count | Examples |
| --- | --- | --- |
| Owned keep | **1** | Abyssal bludgeon (13263) 1 @ 17,745,000, 07-19 |
| Not a keep | **13** | 5952 126×@7,375 · 5952 74×@7,430 · 11237 33×@3,945 · 31729 77×@6,365 · 31916 18×@1,098 · 29684 13×@12,251 · 23959 3×@3,445,000 · 3054 13×@29,000 … |

Those 13 are early-July commodity sells with genuinely unknown basis — pre-log inventory. Several are
items that get flipped repeatedly, so unconditional matching would pair a pre-log sell against a later
genuine flip buy: inventing a reverse flip that never happened **and** orphaning the flip that did.

**Gate: a sell that finds no open lot opens a short ONLY if the item is an `owned-items.json`
`classification:'keep'`.** One condition, on data that already exists, over exactly the right
population (1-of-a-kind personal gear is what the reverse flip operates on). Non-keep sells continue to
land in `unmatched` — "basis unknown", which is what that bucket is for.

Owner ruling (Ben, 2026-07-26): **the keep list alone** — no union with a declared cycle, no
quantity cap. The cap was considered and rejected as unnecessary once §5.1 landed.

### 5.1 PREREQUISITE — the keep list must contain actual keeps

The gate is only as good as the classification behind it. `owned-items.json` was bulk-seeded from the
bank on 2026-07-25 (all 27 entries `source:'seed'`, `classification:'keep'`), which encoded *"this was
sitting in my bank"* — **not** *"this is gear I don't trade."* Those are different claims, and the
difference breaks the gate.

Flip activity per keep, 2026-07-26 (closed rows in `positions.json`):

| Keep | Closed flips |
| --- | --- |
| **Abyssal bludgeon (13263)** | **28** |
| Bandos tassets | 4 |
| Ancestral hat · Dragon warhammer · Masori mask (f) · Osmumten's fang | 3 each |
| Bandos godsword · Confliction gauntlets · Dragon hunter crossbow · Masori body (f) | 1 each |
| 17 of 27 | zero activity |

Abyssal bludgeon is a **7× outlier** — an actively-traded flip vehicle that happens to live in the
bank, mis-seeded as a keep. Left in the pool it breaks symmetric matching badly: its 07-19 unmatched
sell would open a short, FIFO would hand it the 07-22 buy @17,151,000 that is currently matched to a
genuine 3-minute intraday flip, and the displacement would **cascade** down a ~28-row history.

**Resolved by reclassification, not by modeling** (Ben: *"what if we just drop the bludgeon reference
entirely?"*). `declare-owned.mjs classify "Abyssal bludgeon" flip` — done 2026-07-26; the pool is now
26 keeps + 1 flip. `classification:'flip'` already means exactly *"normal merch item, not
owned-for-keeping."* With the outlier out, the remaining keeps top out at 4 flips and the cascade
risk goes with it — which is why no quantity cap is needed.

**Encode the hygiene, don't rely on remembering it** (repo convention: rules belong in scripts, not
prose). SM1 should carry a guard that flags a `classification:'keep'` item accumulating flip activity
past a threshold — a keep with many closed flips is a mis-classification signal, and it is precisely
the condition that makes this gate unsafe. Threshold is a PLACEHOLDER; the observed separation is
28 vs 4, so anything in that gap is defensible pending real data.

⚠ Note the coupling this creates: **`owned-items.json` classification now affects the P/L record**,
not just which items the reverse-flip screen surfaces. Reclassifying an item silently changes how its
sells reconstruct. That is a genuine new sharp edge — SM5 must document it, and SM2's pending line is
the visible surface that makes it auditable rather than silent.

## 5.2 SEQUENCING — RESOLVED, SM1 unblocked

This plan collided with `PLAN-LIB-SUBDIRS` (the cluster-at-a-time `pipeline/lib/` reorg), which was
mid-flight and queued to move files SM1 edits. **That reorg completed 2026-07-26; the plan is folded
into `PLAN.md` and deleted. The constraint is satisfied — SM1 may proceed.**

Final locations of the four files SM1 touches, re-verified after the reorg:

| File | Final path | Anchor |
| --- | --- | --- |
| `reconstruct.mjs` (edit target) | `pipeline/lib/reconstruct/reconstruct.mjs` | `matchTrades` :258 · `unmatched.push` :289 |
| `ownedledger.mjs` (the gate reads it) | `pipeline/lib/capital/ownedledger.mjs` | `computeOwnedQty` :98 |
| `book-model.mjs` (capital fix) | `pipeline/lib/capital/book-model.mjs` | `workingGp` :110 |
| `reverseflipstate.mjs` | `pipeline/lib/thesis/reverseflipstate.mjs` | — |

Line numbers were re-verified at the FINAL paths, not assumed: a `git mv` does not shift them, and all
four held. `check-imports.mjs` green (614 imports, 30 entrypoints). Anything citing a bare
`pipeline/lib/<file>.mjs` for these four is stale by definition — the flat layout no longer exists.

## 6. Chunks

### SM0 — diff harness (read-only, ships nothing) — **DONE 2026-07-27, PASS**
Prototyped symmetric matching against a copy of the book; no production file touched.

**Baseline fidelity first.** The harness initially disagreed with `positions.json` (333/20/79 vs
332/3/16) while realised total matched exactly. Cause: `sync-fills.mjs:254` calls
`reconstruct(quarantineEvents(merged, ignoredCfg))` — the shipped path filters events through the
**ignored-items quarantine** before reconstruction, which a naive `matchTrades(collapseOffers(
dedupeSnapshots(events)))` skips. With `quarantineEvents` applied the harness reproduces
`positions.json` exactly (332 closed / 3 open / 16 unmatched / realised 33,829,972). **Any diff taken
without that filter is measuring the wrong book.**

**Result A — with the manual BANKED workaround still in place (today's book):**

| | current | symmetric |
| --- | --- | --- |
| closed | 332 | 332 (0 added, 0 removed) |
| open | 3 | 3 |
| unmatched | 16 | 15 |
| realised TOTAL | 33,829,972 | 33,829,972 (delta **0**) |
| `awaitingRebuy` | — | 1 |

Exactly ONE row moves: a Dragon hunter crossbow sold 34,945,000 on 2026-07-27 leaves `unmatched` and
becomes a pending short with BE-rebuy 34,246,100. Nothing else in 332 closed rows is disturbed.

**Result B — SM3 acceptance test (the two BANKED lines retired):**

| | current | symmetric |
| --- | --- | --- |
| closed | 330 | 332 |
| unmatched | 18 | 15 |
| realised TOTAL | 31,193,372 | **33,829,972** |

Under the CURRENT matcher both reverse flips vanish entirely — 0 closed rows, 0 realised, profits
silently lost. Under symmetric matching both are reproduced **to the gp, unaided**:
`Masori body (f) +1,287,200` and `Confliction gauntlets +1,349,400`, tagged `reverseFlip`. The
33,829,972 − 31,193,372 = 2,636,600 delta is exactly those two figures summed.

**Conclusion: SM1 is confirmed cheap** — a ~20-line change with a one-row diff against the live book,
and it structurally replaces the hand-injected BANKED workaround rather than merely coexisting with it.
SM3 is pre-validated. Proceed.

### SM1 — symmetric matching in `matchTrades` — **BUILT 2026-07-27, all 7 guards green (not yet committed)**
Shipped shape: `matchTrades(offers, { keeps })` + `reconstruct(events, { keeps })`, new `awaitingRebuy`
bucket, `keepRoundTrip:true` closed-row tag. `keepIds` / `keepMisclassificationRisks` added to
`capital/ownedledger.mjs`; `sync-fills.mjs` threads the keep set and prints the §5.1 hygiene warning.
Verified against the live book: closed 332 → 332 (realised 33,829,972 unchanged), unmatched 16 → 15,
`awaitingRebuy` 1 — **exactly SM0 Result A**. Backward compat proven: omitting `keeps` reproduces
pre-SM1 output byte-for-byte, so `campaigns.mjs`/`join-outcomes.mjs` are unaffected.
New test `pipeline/test/symmetric-matching.test.mjs` (10 checks, runtime-built fake store).
Two defects caught during the build: `positionsSig` omitted the new bucket (a keep-sell-only change
would have read as "no change" and skipped the write), and `check-dead-exports` caught the hygiene
guard being exported without a consumer. Docs reconciled in the same pass: `FILLS-PIPELINE.md` §5.1 +
new §5.1a, `CLAUDE.md`, `README.md` (artifact contract + test inventory).
**Still owed:** SM2 (surface the pending line on `/positions`, `/book`, `/schedule`), SM3 (retire the
two BANKED lines — pre-validated by SM0 Result B), SM4, SM5's full doc sweep.

_Original spec:_
`pipeline/lib/reconstruct/reconstruct.mjs:258-304`. Add a per-item **short queue** beside the existing
`lots` FIFO:
- **sell branch** (currently `unmatched.push(...)` at `:289`): if the item is a keep, push the
  remainder onto the short queue carrying `sellEach`/`tax`/`sellTs`; else `unmatched` as today.
- **buy/banked branch**: drain any open short for that item FIFO *before* opening a lot; each match
  emits a `closed` row with `realised = (sellEach − taxEach − buyEach) × qty` and a
  `keepRoundTrip:true` tag so it stays distinguishable from a cash flip. **Tag name is deliberately
  neutral — NOT `reverseFlip`** (see §2.1: a deliberate reverse flip is only one of the reasons a keep
  gets sold and later rebought, and the row must not assert an intent the log cannot supply).
- Leftover shorts at the end of the walk surface as a new derived bucket (§SM2).

Keep the existing `banked` semantics untouched — `banked` lots still enter the FIFO queue as today;
this chunk only adds the mirror path.

### SM2 — surface the derived `awaitingRebuy` bucket
Leftover shorts become a `positions.json` bucket (name TBD — `awaitingRebuy`, distinct from
`unmatched`). Consumers: `/positions`, `/book`'s RF4 block, `/schedule`. This is the derived
replacement for `reverse-flip-state.json`'s accounting role. **Check the app ripple** — `js/ledger.js`
and anything else reading `positions.json` needs to handle a new top-level key without breaking
(`smoke` job in `checks.yml` covers the page-load half).

**PENDING-ONLY — owner ruling (Ben, 2026-07-26): "just pending — I'll surface when I want to
rebuy."** A leftover short renders as an INFORM-ONLY pending line and nothing more. Specifically it
must NOT:
- be treated as a position or enter the flip-verdict loop (it has no cost basis; a verdict over it
  would be fabricated),
- enter `workingGp` or any capital tier (the capital was *returned* by the sell — that's the point),
- raise an alert, a rebuy-window prompt, a dip notification, or any timing nudge. **The rebuy has no
  deadline and Ben drives its timing** — the tool tracks that a cycle is open and waits to be asked.
  A "you should rebuy now" feature is out of scope by owner ruling, not merely unbuilt.

The line carries: item, qty, sold-each, BE-rebuy (`soldEach − tax(soldEach)`, the canonical
`js/money-math.js` `tax()`), and how long it has been pending. That is the whole surface.

### SM3 — migration: retire the two BANKED compensating lines
The manual BANKED basis lines injected 2026-07-26 become double-counts under SM1 (they were the
workaround this plan removes). Retire via tombstone:

```
node pipeline/commands/add-manual-fill.mjs --remove b55ddf0102fd7f1b   # Masori body (f)  27238
node pipeline/commands/add-manual-fill.mjs --remove 68b36221a69e35c3   # Confliction      31106
```

Then re-sync and assert the two realised figures are **unchanged** at +1,287,200 and +1,349,400, now
produced by the matcher instead of by hand. This assertion is the acceptance test for SM1.

### SM4 — retire the compensating machinery
Once SM1–SM3 hold: `reconcile-reverse-flip.mjs` loses its purpose (its Case-B artifact stops existing).
Decide delete vs. keep-as-advisory. `reverse-flip-state.json` narrows to intent/planning only —
`declare-reverse-flip.mjs` keeps `set`/`clear` for BE-rebuy tracking but no longer carries accounting.
Do **not** build the ownership filter; SM1 makes it unnecessary.

### SM5 — docs reconciliation (mandatory, per process rule 8)
Not append-only. Grep for and fix statements this supersedes: `pipeline/FILLS-PIPELINE.md` §5.1
(reconstruction contract — currently describes `unmatched` as the terminal state for a basis-less sell),
CLAUDE.md's reverse-flip rows, `docs/FLOW.md`, `docs/ARCHITECTURE.md` invariants,
`reconcile-reverse-flip.mjs`'s header, the `/positions` + `/scan` skills. `README.md` gets the
inventory entry for any new file. Fold this plan into `PLAN.md` and delete it from `plans/` when SM5 lands.

## 7. Consequences

- **Realised P/L:** unchanged in value, different in provenance. SM3's assertion is the guard.
- **Survives re-sync:** yes — `fills.json` is rebuilt from the logs every sync and the new behavior is
  in the matcher, not in injected data. This is strictly *better* than the current scheme, which
  depends on hand-injected BANKED lines surviving.
- **`computeOwnedQty`:** untouched. It is already correct (folds to 1); the fault was downstream.
- **Capital accounting:** fixed as a side effect — no open lot means the ~150.07m never enters `workingGp`.
- **Buy limits:** unaffected. `buysByItem`/`limitWindow` (`pipeline/lib/limits.mjs`) fold real `buy`
  events directly; a rebuy is a genuine logged GE buy and still consumes limit.
- **Composes on repeat cycles:** yes, for free — no accumulating state, no per-cycle housekeeping.
- **⚠ Ripple — direct `matchTrades` consumers bypass BOTH `reconstruct()` and the quarantine.**
  `join-outcomes.mjs` (noted in `reconstruct.mjs`'s own header) and `campaigns.mjs:66`
  (`const { closed } = matchTrades(offers)`) call it directly. SM0 established that the shipped book is
  `reconstruct(quarantineEvents(...))` — so these consumers already see a *different* event set than
  `positions.json` does, independent of this plan. SM1 changes `matchTrades` under both of them.
  Audit each: confirm whether the quarantine omission is intended, and whether a `keepRoundTrip`-tagged
  closed row should count toward a campaign. `monitor-offers.mjs` shares `reconstruct()` and gets the
  change for free.

## 8. Open questions

1. ~~Should a leftover short be visible as a *position* or as an *inform-only* pending line?~~
   **RESOLVED (Ben, 2026-07-26): pending, inform-only.** Spec moved into SM2 above.
2. ~~Is `owned-items.json` `classification:'keep'` the right gate, or the union with a declared cycle?~~
   **RESOLVED (Ben, 2026-07-26): the keep list, alone.** No union, no declared-cycle dependency.
3. ~~Retroactive scope: does SM1 re-pair the historical keep in `unmatched`?~~
   **RESOLVED (Ben, 2026-07-26): yes, repair it.** SM0's diff must still show it explicitly. See §5.1 —
   the item that raised this question (Abyssal bludgeon) has been reclassified out of the keep pool, so
   the repair it triggers is now bounded.
4. ~~CI can never exercise the real gate.~~ **RESOLVED (Ben raised, 2026-07-26): fixture +
   `COFFER_OWNED_PATH`.** See §8.4 below — it can, fully.

### 8.4 CI coverage — fixture, NOT a populated production file

Ben asked whether to populate `owned-items.json` with fake data so CI can exercise the gate. **Yes to
the fake data; no to that file.**

**Why not the production file.** `owned-items.json` is NOT gitignored — it is TRACKED with
`skip-worktree` (`git ls-files -v` → `S`), and the committed copy is an empty stub (0 items). That stub
is what CI checks out *and what any fresh clone gets*. Under this plan, classification **changes the
accounting record** (§5.1) — so fake keeps in the committed copy would make a fresh checkout, or any
machine where `skip-worktree` got cleared, reconstruct a real book against fake keeps and open fake
shorts. Committing fake keeps is therefore disqualified on the same grounds as committing the real
ones, plus one worse failure mode.

**The runtime-populate mechanism already exists, at the test layer.** Ben's instinct — populate fake
data at CI time rather than commit it — is correct and is already the established pattern, one layer
better than a workflow step. `pipeline/test/reverse-flip-cli.test.mjs:32-50` mkdtemps a directory,
points `COFFER_OWNED_PATH` at it, then **seeds it at runtime by calling the real CLI**
(`declare-owned.mjs seed 21018 --qty 1`) and asserts against the result. Header: *"NEVER touches the
real root owned-items.json."* `reconcile-reverse-flip.test.mjs:39-40` does the same.

So the gap was never mechanism — it is simply that no test covers the new gate, because the gate does
not exist yet. **SM1 adds cases to this existing harness; no new fixture file and no new CI step are
needed.**

**Do NOT implement this as a workflow step that writes the real path.** `owned-items.json` is
`skip-worktree`, so a clobber of it **does not appear in `git status`** — a workflow step that ever ran
locally (reproducing a CI failure, `act`, a copy-pasted command) would silently destroy the real keep
registry with no diff to notice. The tmpdir pattern is structurally incapable of that, and it keeps
tests behaving identically locally and in CI rather than being meaningful only on the runner.

**Division of responsibility:**
- **CI** — synthetic fixture via `COFFER_OWNED_PATH` exercises the gate's *code path*: keep vs non-keep
  routing, short open/drain, the FIFO order, realised arithmetic, and the §5.1 hygiene guard firing.
- **Local** — the §5.1 hygiene guard validates the *real* keep list. Never CI's job; CI must never see
  real bank contents.

Cases SM1 must add to the existing harness, at minimum: a keep sold→rebought (books a reverse flip at
the expected realised figure), a keep sold and NOT rebought (stays a pending short, §SM2 shape), a
non-keep sold with no open lot (stays `unmatched` — the 13-of-14 census case), a keep whose short is
partially drained by a smaller buy, and a keep with enough closed flips to trip the §5.1 hygiene guard.
Item ids are public game data — no PII concern.

**Coverage hole worth closing in the same pass:** `reverse-flip-cli.test.mjs:45` calls
`classify 21018 flip` with a NUMERIC id — the exact input that triggers the §8a name-clobber bug — and
asserts `classification` persisted while never asserting `name` survived. That hole is why the bug went
undetected. Add a `name` assertion when touching this file.

## 8a. Discovered (unrelated latent bug, found while resolving §5.1)

**`declare-owned.mjs classify <numeric-id> …` clobbers the stored item name.** `resolveId` short-circuits
on numeric input (`if (/^\d+$/.test(token)) return { id: +token, name: '#' + token }`) and never
consults the wiki mapping, then the upsert writes that synthetic `#13263` token over the real name.
Reproduced and repaired 2026-07-26 by re-running with the item name. **`declare-reverse-flip.mjs` has
the identical `resolveId` shape** and the same defect (its entries are transient, so damage is
short-lived, but the CLI output prints `#27238` instead of the item name, which is how it was spotted).

Fix: have `resolveId` reverse-look-up the mapping for numeric input too, or have the upsert preserve an
existing `name` when the resolver only produced a synthetic one. Out of scope for this plan — noted for
PLAN.md's Discovered list.

## 9. Non-goals

- **Not** a way to recover basis on a genuine pre-log sell. That stays unknown, in `unmatched`, correctly.
- **Not** a change to `computeOwnedQty` or to `banked` semantics.
- **Not** a claim that reverse flips are profitable — that's a separate, n≈2 question.
- **Not** shorting. The GE has no short side; "short queue" is internal bookkeeping for owned inventory
  round-tripping, and quantity always nets to zero against the keep.
