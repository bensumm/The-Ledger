# PLAN-RECENCY-BASIS — one recency basis for the reach signals (the recovering-item under-read)

**Status: PARTIALLY SHIPPED (2026-08-04/05). RB-3 and RB-5 are DONE — Fix 2's display half plus the
de-duplication. RB-1, RB-2 (Fix 1) and RB-4 (Fix 2's rank half) are NOT started.**

> ⚠ **RB-3's CHOSEN BASIS WAS REVERSED on 2026-08-09 (0.71.3) — read this before working from the plan
> text below.** RB-3's *finding* stands and is load-bearing: the fold PRICE and the `pFill` printed beside
> it must declare the SAME basis, or a row contradicts itself on a regime-changed item. What was wrong was
> the basis it picked. Both sites moved back to the **full window**: recent-3 is four-valued at n=3 (one
> night swings the fraction by a third of its range), and forward-scoring over 6,016 ask rows with a real
> 8h outcome put the full-window read at **+9.8pp within-item, p=0.0001**. Consequences for this plan:
> **RB-4 is moot in the direction it was written** — it proposed moving the RANK onto recent-3 to close a
> display/rank split that no longer exists (both are full-window now); a future study would be arguing to
> move BOTH to recent, which is a different chunk. The tables below that describe display sites as
> "recent-3 preferred" are HISTORY, not current state — the only recent-preferring surfaces left are the
> `--digest` reach column and `watch-positions`' size-relief note, both flagged pending their own
> measurement. Current state lives in `js/estimators/pair.mjs`'s `reachRead` header and CHANGELOG 0.71.3.

| Chunk | State | Notes |
|---|---|---|
| RB-0 | not run | scratchpad bake-off, never committed by design; RB-4 is blocked on it |
| RB-1 | **not started** | `stalePessimistic` does not exist in the repo |
| RB-2 | **not started** | `js/validate.mjs` untouched; see the version-reservation correction below |
| RB-3 | **DONE** | all code + all six §11 doc reconciliations; `estimators.test.mjs`'s don't-fork pin rewritten, not left green by accident |
| RB-4 | **deferred, gated** | `families.mjs`/`suggestlog.mjs` untouched; the deferral + its evidence gate are named in-code (`reach.mjs`, `pair.mjs`) |
| RB-5 | **DONE** | `digestReachFrac` delegates to `reachFraction`; `capeff-digest.test.mjs` passes byte-identical (the stated acceptance criterion) |

**Sequencing note (this file said "strictly sequential"):** RB-3/RB-5 landed WITHOUT RB-1/RB-2, which
precede them in §5's order. That is fine and was not a mistake — the ordering existed for FILE-OVERLAP
reasons (RB-2 and RB-3 edit adjacent lines of one `watch-positions.mjs` function), not logical
dependency: RB-1/RB-2 are **Fix 1** (`stalePessimistic`, a different signal) and RB-3/RB-4 are **Fix 2**
(the P(fill) basis). RB-1/RB-2 remain runnable as-specified; re-check the `watch-positions.mjs` overlap
against RB-3's landed edit before starting RB-2, since that region has now changed.

**⚠ VERSION RESERVATION CORRECTED (2026-08-05).** §10 reserved `scan 1.89→1.90` and
`positions 1.52→1.53` for RB-2. Those numbers were **consumed by an unrelated change** (the deep-book
`avgBoundRead` clause). **CORRECTED AGAIN (2026-08-06):** `scan 1.91` / `positions 1.54` were then
consumed too, by the durable-floor composition (the A–D set on the Snape grass entry). **RB-2 must take
`scan 1.92` and `positions 1.55`.** The recurring lesson: **never reserve a skill version in a plan
document — read the live frontmatter at landing time.** §10's literal numbers are stale by construction.

**This file survives its partial landing** — §10's "delete on the last chunk" applies only once RB-1,
RB-2 and RB-4 have shipped too.

Two related defects in the reach layer, both of which systematically UNDER-RATE an item whose
price regime has recently turned UP after a decline:

- **Fix 1 — the missing mirror flag.** `recencySplit`'s divergence test is (mostly) symmetric but
  only ONE side of it is named and consumed. A crashed item gets a penalty (`staleOptimistic`); a
  recovering item gets the *absence* of a penalty, never a credit or even a note.
- **Fix 2 — `P(fill)` and the fold price sit on different recency bases.** The price beside them
  is recent-3-honest; the probability is full-window flat. On a recovering item they contradict
  each other by construction, and the same file computes a THIRD basis for the digest column.

Anchor (cheap, survives): **"the recovering item reads stale."** Named live context (rots, do not
plan against the numbers): a 60-item breadth panel on 2026-08-03 put the median item at −3.09%/14d,
−2.26%/7d, **+0.05%/3d** — a decelerating decline that has just crossed to flat, i.e. the exact
regime in which this mismatch bites the whole board at once.

---

## 1. Context / diagnosis — CONFIRMED in code

Every line below was re-verified by reading the file. Line numbers are as of the working tree at
plan time (`main` @ c53569e + uncommitted data artifacts).

### 1.1 Fix 1 — `staleOptimistic` has no mirror

`js/windowread.mjs:83-90`:

```js
const scored = recentDays >= recentN && fullN >= recentN + 2;              // :83
const gap = fullFrac - recentFrac;                                         // :87
const diverges = scored && (Math.abs(gap) >= RECENCY_DIVERGE
  || (recentHit === 0 && fullHit > 0 && fullFrac >= 0.2));                 // :88
const staleOptimistic = diverges && recentFrac < fullFrac;                 // :89
```

`diverges` is returned (`:90`) but **no consumer reads it on its own** — every consumer reads
`staleOptimistic`. So the recovering half of a two-sided test is computed and thrown away.

#### ⚠ THE CENTRAL DESIGN PROBLEM — a naive mirror MISSES the motivating case

Only the `Math.abs(gap)` clause is two-sided. The second clause (`recentHit === 0 && fullHit > 0 &&
fullFrac >= 0.2`) is strictly one-directional: it exists to catch a *partial-rate crash* (blood
rune, 4/14 full → 0/3 recent — a 0.29 gap that is under the 1/3 threshold but unambiguously
stale). There is **no mirror clause**.

**The consequence is not a curiosity — it is disqualifying for the naive spec.** Anchor: **the
Mokhaiotl waystone ask**, full **10/14**, recent **3/3**. Verified against the formula:
`fullFrac` = 0.714, `recentFrac` = 1.0, `gap` = −0.286, `|gap|` < `RECENCY_DIVERGE` (0.333), and
the zero-clause cannot fire in this direction ⇒ **`diverges` is `false`, so
`diverges && recentFrac > fullFrac` is `false`.** A mirror defined that way would have stayed
**silent on the single best real example we have**, on a live position. A flag that misses its
motivating case is cosmetic.

**Resolution (RB-1) — the mirror gets a SATURATION clause, the exact grammatical mirror of the
zero-clause:**

```
staleOptimistic  zero-clause : recentHit === 0            && fullHit > 0    && fullFrac >= 0.2
stalePessimistic sat-clause  : recentHit === recentDays   && fullHit < fullN && fullFrac <= 0.8
```

Read as English the two are the same sentence in opposite directions: *"recent is pinned at the
floor while the full window shows a materially better rate"* / *"recent is pinned at the ceiling
while the full window shows a materially worse rate."* On the waystone: `recentHit`(3) ===
`recentDays`(3) ✓, `fullHit`(10) < `fullN`(14) ✓, `fullFrac`(0.714) ≤ 0.8 ✓ ⇒ **fires.**

**Constant discipline.** `0.8` is `1 − 0.2` — the SAME unvalidated magnitude already in the
zero-clause, applied symmetrically, not a second invented number. RB-1 EXTRACTS the existing bare
literal into a named `RECENCY_SATURATION_FRAC = 0.2` and writes the mirror as
`fullFrac <= 1 - RECENCY_SATURATION_FRAC`, so there is one number with one name governing both
directions. **Honesty: the symmetry is an ASSUMPTION, not evidence.** The 0.2 was itself chosen
against the blood-rune anchor (n=1); reusing it in the mirror direction is n=1 there too. Labeled
PLACEHOLDER on both sides.

**The over-firing risk this creates, and the bar it must clear.** `recent 3/3` is not rare, so
`stalePessimistic` could fire broadly and become noise — the exact failure
`plans/PLAN-DIURNAL-RECENCY-GUARD.md:228` names ("an inform-only flag Ben has to trust dies if it
fires on everything"). That plan set and met a **~25% bar** via a two-population sweep
(`:277-283`: `dip-watchlist.json` 60 items, a by-construction-recently-moved population, vs
`watchlist.json` 25 curated liquid items — 16% on the latter, "under the ~25% bar"). **RB-1 must
repeat that exact sweep methodology and clear the same bar**, or the saturation clause is
re-tuned before RB-2 renders it. That is an acceptance criterion, not a follow-up.

### 1.2 Fix 1 — the consumers, all one-directional

| Site | What it does | Kind |
|---|---|---|
| `js/validate.mjs:122` | `if (rc.staleOptimistic) status = bumpSeverity(status)` | **GATES** (pass→caution→reject) |
| `js/validate.mjs:125` | `staleTail` reason string | display |
| `js/validate.mjs:112` | `staleOptimistic` on `evidence` | data |
| `js/amplitudescreen.mjs:199` | `legOk = rs => !rs.staleOptimistic && (…)` | **GATES** (drops an amplitude leg) |
| `js/windowread.mjs:132,149` | `computeReality` passes `rs.staleOptimistic` through | data |
| `js/windowread.mjs:158` | `realityClause` returns `''` unless `spikeTop \|\| staleOptimistic` | display |
| `pipeline/commands/watch-positions.mjs:240` | `' ⚠stale'` suffix on the per-offer window line | display |
| `pipeline/commands/read-window-range.mjs:230` | `rsTxt` — `⚠ stale` token in the summary table | display |
| `pipeline/commands/read-window-range.mjs:485` | the long `⚠ stale — …discount it` prose note | display |

*The brief listed 4 of these 9; the two `read-window-range.mjs` sites and `validate.mjs:125` were
missing. `js/windowread.mjs:158` was listed and is correct.*

### 1.3 Fix 1 — the bid-side asymmetry is REAL and the current behavior is CORRECT

On a recovering item the BID leg legitimately fires `staleOptimistic`: recent daily LOWS sit
ABOVE the old lows, so a band-low bid that "touched 14/14" over the window genuinely will not
fill now. That is the Hydra-leather doctrine, encoded and battle-tested
(`.claude/skills/scan/SKILL.md:527-537`). **The mirror is an ASK-side concept.** Any chunk that
"symmetrizes" the bid-side read is wrong, and §5 lists the doc edit that says so in place, so a
future editor does not undo it.

The mirror is still *computed* on both sides (the primitive stays pure and symmetric); a bid-side
`stalePessimistic` means "recent lows dipped BELOW the old lows — the bid fills more easily than
the full count says," which is real information on a falling item. It is rendered but never gated.

### 1.4 Fix 2 — three bases on one row

| # | Consumer | Basis | Site |
|---|---|---|---|
| 1 | the fold **price** (`Est. sell`, `recency-fold`) | **recent-3 preferred**, full as backstop | `js/estimators/pair.mjs:103` (`const frac = rec ? rec.frac : full.frac`), consumed at `js/estimators/sell-models/reach-fold.mjs:133` |
| 2 | the **`P(fill)` printed beside that price** | **full window, flat** | `js/estimators/reach.mjs:94` (`clamp01(a.reachedDays / a.nDays)`) via `askReachFactor`, wired at `js/estimators/pair.mjs:225`, printed at `pipeline/commands/read-window-range.mjs:598` and rendered at `:603` |
| 3 | the **rank** `net × P ÷ TTF` | **full window, flat** | `js/estimators/families.mjs:332` → `:341` `rankScore(...)` |
| 4 | the digest **reach ✓/✗ column + mirage verdict** | **recent-3 preferred** | `pipeline/commands/screen-flip-niches.mjs:658-662` (`digestReachFrac`) |

**Finding the brief did not have: #4.** `screen-flip-niches.mjs:660` already reads
`askReachExtra.recentHit / askReachExtra.recentDays` when a recent read exists. So on the SAME
screen row, today, the digest says "reach ✓ (recent)" while the rank right next to it discounts P
off the full window. This is not a hypothetical inconsistency — it is live in one file, and it is
independent evidence that recent-3-preferred is already the repo's revealed preference everywhere
it is a *display*, and full-window only where it is a *number that moves the board*.

**Correction to the brief — the blast radius splits three ways, not one.** The brief says
"`P(fill)` feeds `rank = net × P ÷ TTF`, which is the primary ordering of the screen." True of the
rank, but NOT via `pair.mjs:225`. There are **three independent `askReachFactor` call sites**:

| Call site | Role | Ordering blast radius | Chunk |
|---|---|---|---|
| `js/estimators/pair.mjs:225` | **display only** — `pFill` is returned and printed; nothing ranks, sorts, gates or grades on it | **zero** | RB-3 |
| `js/estimators/families.mjs:332` | **the rank** — feeds `rankScore` (`:341`), the screen sort, the grade letter (`rateItem`/`REACH_GRADE_CAP`), the digest `rankKey`, and `screen.json` | **primary ordering** | RB-4 |
| `pipeline/commands/watch-positions.mjs:252` | **held-lot relief note** — called TWICE (`askReachFactor(aR, 0)` and `askReachFactor(aR, rel)`) purely to decide whether size relief moved the factor enough to print a `size-relieved fill ~N%` clause | **zero** (note visibility only) | RB-3 |

That distinction is what makes this shippable in graded risk steps rather than one scary swap
(RB-3 vs RB-4 below).

### 1.5 The data is already in hand at every call site — zero new fetch

Every surface that passes `askReach` already attaches `recentHit`/`recentDays`:

- `pipeline/commands/screen-flip-niches.mjs:1106` (`askReachExtra`, off the validator's evidence)
- `pipeline/commands/screen-flip-niches.mjs:1088` (`reachExtra`, the bid leg)
- `pipeline/commands/quote-items.mjs:449,451`
- `pipeline/commands/watch-positions.mjs:751,753`
- `pipeline/commands/read-window-range.mjs:567,572`

**One exception, load-bearing:** `pipeline/commands/watch-positions.mjs:251` builds a *bare*
`{ reachedDays, nDays }` (no recent fields) purely to compute the relief suffix
(`askReachFactor(aR, 0)` vs `askReachFactor(aR, rel)` at `:252`). Any change to `askReachFactor`'s
default behavior silently changes that note too. This is the reason §4 does NOT change the
function's default — it adds an explicit opt-in. **It is also a real decision, not just a hazard:
see RB-3 for the ruling on this site's basis.** The recent counts ARE available in scope there
(`stats.days` is used by the `stale()` helper at `:240`), so the site can go either way.

### 1.7 The don't-fork invariant is pinned in a TEST and a CODE COMMENT, not just docs

`pipeline/test/estimators.test.mjs:782-789` — `'E1 pFill REUSES askReachFactor byte-identical (the
don't-fork pin) + absent → 1'` — asserts at `:785`
`assert.equal(e.pFill, askReachFactor(ar), 'pFill is the SAME askReachFactor value the rank
carries (no fork)')`. `js/estimators/cells.mjs:71-75` states the same invariant in a comment
("the SAME askReachFactor probability the rank carries").

**Correction — RB-3 does NOT turn CI red, and it is important to be exact about why.** The
fixture at `:783` is `const ar = { reachedDays: 4, nDays: 14 }` — it carries **no** `recentHit`/
`recentDays`. Under `prefer:'recent'` that degrades to the full window (the absent→degrade rule),
so `estimatePair(...).pFill` still equals `askReachFactor(ar)` and **the assertion still passes**.
Same for `:788` (`bare.pFill === askReachFactor(undefined)` → 1 === 1).

**That is worse than a red build, and is the actual finding.** The test would keep passing while
the invariant its name claims to pin ("the SAME value the rank carries") had quietly become
conditional — a test that no longer tests what it says. RB-3 must therefore change it
deliberately rather than being forced to; the exact edit is specified in RB-3's verification
block. `cells.mjs:71-75`'s comment must be reworded in the same commit for the same reason.

### 1.6 What is measured vs assumed (rule 4, up front)

- **Measured:** the code paths and their bases (§1.1–§1.5) — read, not inferred.
- **Measured, external to this repo:** the market is currently in the decelerating-decline regime
  (60-item breadth panel, fixed hours-of-day, day-over-day slopes off the local 1h SQLite archive).
  This establishes the defect is *live*, not that the fix improves outcomes.
- **Assumed / unvalidated:** that recent-3 is a *better* predictor of ask fill than the full
  window. **n = 0.** Nothing in `fills.json` has been joined to a reach basis. RB-0 measures how
  much the board MOVES; it cannot measure whether the move is right. Say this plainly on every
  surface that ships a changed number.
- **Assumed:** that `RECENT_NIGHTS = 3` is the right recent window. It is an existing
  PLACEHOLDER (`js/windowread.mjs:71`); this plan inherits it and invents no new constant.

---

## 2. Rulings

All open questions from the first planning round are **DECIDED** (Ben, 2026-08-03, recorded below
as rulings 4–9). No silent open questions remain.

1. **The mirror is INFORM-ONLY on first ship. It never gates.**
   Justification, in Ben's own frame: `staleOptimistic`'s two gating consumers both *withhold* a
   candidate (`validate.mjs:122` bumps severity; `amplitudescreen.mjs:199` drops a leg). A
   symmetric mirror would have to *relax* severity or *admit* a leg — i.e. it would newly ADMIT
   candidates. Per the brief's own standing bias and the repo's
   `gate-on-error-cost-not-n` rule: a false admit costs money, a false omit costs nothing but a
   missed trade. Compounding it, §1.1 proves the mirror is *structurally weaker* than the flag it
   mirrors (no zero-clause). Gating on the weaker half of an asymmetric test at n≈0 is not
   defensible. So: additive field + a rendered token, no status change, no leg admitted.
2. **Invent no new constants; EXTRACT and mirror the existing one.** `stalePessimistic` reuses
   `RECENCY_DIVERGE` and the existing `diverges`, plus a saturation clause built on the
   zero-clause's own `0.2` — extracted into a named `RECENCY_SATURATION_FRAC` and applied as
   `1 − RECENCY_SATURATION_FRAC` in the mirror direction (§1.1). The P(fill) basis reuses
   `reachRead`'s existing rule. **No new unvalidated magnitude enters the repo**, though the
   symmetry assumption itself is unvalidated and is labeled as such.
3. **Fix 2 ships in two chunks with different risk profiles** — display first (RB-3, zero ordering
   effect), rank second (RB-4, decision-moving, visible comparison). They are separately
   revertable.
4. **RULING (Ben) — RB-4 is CONSOLE-ONLY. `screen.json` and the app stay on the full-window
   basis.** An unvalidated reorder does not get pushed into the deployed app. Direct precedent,
   cited: the Path-A gp/d sort shipped exactly this way —
   `pipeline/commands/screen-flip-niches.mjs:1447` ("published screen.json keeps rateItem's grade +
   the neutral sort UNCHANGED — we FREEZE the pre-Path-A…") and the footer at `:1589` ("The
   published screen.json / app stay on Grade + the neutral sort (console-only until validated)"),
   with `plans/PLAN-LANE-ADMISSION.md:8` recording the same. **My earlier "ship the reorder"
   proposal is withdrawn.** The two-basis split I worried about is handled by DOCUMENTING the basis
   per surface (§10), not by pushing the reorder.
5. **RULING (Ben) — the basis is NOT chosen now. RB-0 measures THREE candidates** (full-window,
   hard recent-3, and a recency-WEIGHTED fraction over the full window) and reports the rank-delta
   distribution for each; RB-4 is **blocked** on that evidence. Rationale, which supersedes my
   hard-swap proposal: n=3 makes `P(fill)` four-valued {0.25, 0.5, 0.75, 1.0} and it is a
   **multiplier into `rankScore`**, so a single day's change can swing rank by up to 33%. The
   fold-price precedent does **not** transfer — a price is continuous and band-bounded; a
   probability multiplier is neither.
6. **RULING (Ben) — sigil is `↑ recent-stronger`, never `⚠`.** A warning mark on a credit misleads.
7. **RULING (Ben) — the digest stays out of scope, WITH a defensive comment.** `digestReachFrac` is
   deliberately already recent-based; RB-5 adds a code comment saying so, so nobody "fixes" it back
   into a third divergence.
8. **RULING (Ben) — RB-3 and RB-4 land back-to-back in one session**, with the
   `estimators.test.mjs:782` / `cells.mjs:71-75` invariant breakage spelled out and handled in
   RB-3 (§1.7).
9. **The bid-side `⚠ stale` doctrine is untouched and is documented as untouched.** §1.3.
10. **The `stalePessimistic` name is adopted** — the exact grammatical mirror of `staleOptimistic`,
    which is what matters for a future reader of `recencySplit`.

---

## 3. Existing scaffolding (this rebuilds nothing)

- `recencySplit` / `RECENT_NIGHTS` / `RECENCY_DIVERGE` — `js/windowread.mjs:71-91`. The whole
  divergence computation exists; only the naming of one branch is missing.
- `computeReality` / `realityClause` — `js/windowread.mjs:125-169`. The ONE renderer across three
  console surfaces, already carrying a two-flag (`spikeTop` / `staleOptimistic`) shape and a
  `typicalLevel`. A third flag is an additive branch, not a new renderer.
- `reachRead` — `js/estimators/pair.mjs:98-106`. The recent-preferred fraction rule already
  exists as a pure function; Fix 2 does not invent it, it reuses it.
- `digestReachFrac` — `pipeline/commands/screen-flip-niches.mjs:658-662`. A third copy of the same
  rule; RB-5 folds it into the shared one.
- **The visible-comparison precedent — the whole mechanism already exists.** EF1(b):
  `screen-flip-niches.mjs:1260-1271` computes the pre-change value by calling the estimator twice,
  suppresses the note when nothing moved (`:1269`), and emits a footer line via `exemptNotes` →
  `:1612`. Shadow fields ride `suggestions.jsonl` via
  `pipeline/lib/render/suggestlog.mjs:431,487-491` (`exemptionBounded`, `rankPre`). RB-4 copies
  this shape line-for-line rather than inventing a new one.
- Acceptance fixtures: `pipeline/test/windowread.test.mjs` (recencySplit `:148,:160,:170`;
  computeReality `:371-411` — and **`:382` is already the mirror case**, asserting "recent is
  ROSIER than full here — the opposite shape, not stale"), `pipeline/test/validate.test.mjs:99-126`,
  `pipeline/test/estimators.test.mjs`, `pipeline/test/amplitudescreen.test.mjs`,
  `pipeline/test/oscillation-gate.test.mjs:58` (a `goodLeg()` stub of a `recencySplit` result).

---

## 4. Target architecture

One home per concern; no new files.

```
js/windowread.mjs          recencySplit → + stalePessimistic     (the ONE definition)
                           computeReality → passes it through
                           realityClause → renders it            (the ONE renderer)
js/validate.mjs            evidence.stalePessimistic (DATA ONLY — status untouched)
js/amplitudescreen.mjs     UNTOUCHED (legOk stays one-directional — ruling 1)
js/estimators/reach.mjs    askReachFactor(askReach, relief, { prefer }) — default 'full',
                           byte-identical; the recency rule lives in ONE new pure helper
js/estimators/pair.mjs     :225 opts into prefer:'recent'        (RB-3, display)
js/estimators/families.mjs :332 opts into prefer:'recent'        (RB-4, rank)
pipeline/commands/*        render only
```

**Why an explicit `prefer` option and not a behavior change to `askReachFactor`:** the function has
a third caller (`watch-positions.mjs:252`) that passes a bare `{reachedDays, nDays}` for an
unrelated relief note. Changing the default would silently move that note. Keeping the default
`'full'` makes every existing call byte-identical by construction and makes the two opt-in sites
grep-able. The repo's anti-boolean-threading lesson (PC3) is about *model composition* in
`estimatePair`, not about a leaf numeric helper — a second forked function would violate the
stronger "one definition" rule that `pFill reuses askReachFactor, never forked" was built on
(`js/estimators/pair.mjs:18` header).

---

## 5. Staged chunks

**Strictly sequential: RB-0 → RB-1 → RB-2 → RB-3 → RB-4 → RB-5.** RB-0 is the critical path (RB-4
is blocked on it) and can start immediately, in parallel with RB-1/RB-2.

**Correction to my first draft:** I called RB-1/RB-2 and RB-3 parallel-safe. **They are not.**
RB-2 edits `watch-positions.mjs:240` and RB-3 edits `watch-positions.mjs:251-252` — adjacent lines
inside the *same function*, which is the "same-function overlap" PLAN.md's parallel-safety rule
says must be sequenced, not merged by git. They also share
`pipeline/commands/read-window-range.mjs`. Full primary-file sets in §10.

RB-4 depends on RB-0 (evidence) and RB-3 (the display half must land first, or
`docs/MARKET-ANALYSIS.md:84`'s "the SAME probability the rank carries" claim is false for the
interval between them; ruling 8 lands them back-to-back).

Per CLAUDE.md rule 8 and `docs/PLANNING.md`'s anti-pattern list, **there is no separate docs
chunk** — each chunk carries its own reconciling docs pass, listed inline.

---

### RB-0 — BASIS BAKE-OFF: measure three candidate bases (no commit) — **RB-4 IS BLOCKED ON THIS**

**Not a code chunk, and no longer a simple sanity check** — per ruling 5 this is where the basis
gets CHOSEN. A throwaway script in the scratchpad (never committed, never in `pipeline/`) runs the
current screen pool and, for every row with an `askReach` carrying recent fields, computes the
ask-reach fraction three ways:

| Basis | Definition | Property |
|---|---|---|
| **A — full-window** (today) | `reachedDays / nDays` | continuous-ish (n≈14), no recency |
| **B — hard recent-3** | `recentHit / recentDays`, full as fallback | recency-honest, **four-valued**, high variance |
| **C — recency-weighted** | `Σ(wᵢ·hitᵢ) / Σ(wᵢ)` over all N days, `wᵢ = λ^(age_days)` | continuous AND recency-honest; λ controls the half-life |

Sweep **λ ∈ {0.7, 0.8, 0.9, 1.0}** (λ=1.0 reduces exactly to basis A — a built-in correctness
check on the harness itself; if the λ=1.0 column does not reproduce basis A byte-for-byte, the
harness is wrong, not the data).

**Report, per basis (and per λ for C):**
1. rows where the factor differs from A at all, and the **P-delta distribution**;
2. the **rank-delta distribution** (this is the decision variable);
3. **top-N churn** — how many rows change top-10/top-20 position vs A;
4. **granularity** — for B, how many rows land on each of the four values; for C, the spread;
5. **stability** — re-run across two consecutive `suggestions.jsonl` passes with no new market
   data and report how much each basis's ordering moves *on its own noise* (this is the direct
   measurement of ruling 5's 33%-swing concern);
6. rows with `recentDays < 3` (no recent read → unaffected under every basis).

**Acceptance:** a table of the above delivered to Ben, plus an explicit recommendation with the
tradeoff named. **RB-4 may not be dispatched until a basis is chosen off this evidence.** If B and
C are indistinguishable on rank-delta but C is materially more stable, C wins on stability alone.

**What RB-0 CANNOT do (rule 4):** it does not validate *direction* — it cannot say which basis
predicts fills better. That needs a realized-fill join and is F1's job (§7 F3). RB-0 bounds
*magnitude* and *stability* only. Do not let a clean RB-0 table be reported as evidence the change
is correct.

**Files:** scratchpad only. **APP_VERSION:** n/a. **Docs:** none.

---

### RB-1 — `stalePessimistic` on the primitive (pure, additive, nothing reads it)

**Change:** `js/windowread.mjs`
- Extract the zero-clause's bare `0.2` into `export const RECENCY_SATURATION_FRAC = 0.2;` beside
  `RECENCY_DIVERGE` (`:71-72`) and rewrite the existing zero-clause to use it — **proven
  byte-identical**, since `0.2` is substituted for itself.
- `recencySplit` (`:88-90`): add the mirror saturation clause and the flag:
  ```js
  const satMirror = scored && recentDays > 0 && recentHit === recentDays
    && fullHit < fullN && fullFrac <= 1 - RECENCY_SATURATION_FRAC;
  const stalePessimistic = (diverges && recentFrac > fullFrac) || satMirror;
  ```
  `satMirror` must also be OR-ed into the returned `diverges` so the two flags stay consistent
  with it (a caller reading `diverges` must not see `false` while `stalePessimistic` is `true`).
  **Verify this does not change `staleOptimistic`:** `staleOptimistic` is
  `diverges && recentFrac < fullFrac`; `satMirror` implies `recentFrac`(1.0) > `fullFrac`(≤0.8),
  so widening `diverges` by `satMirror` can never newly fire `staleOptimistic`. Pin it with a
  fixture rather than trusting the argument.
- Extend the `--- recency split ---` header block (`:59-72`) to describe BOTH shapes, the
  zero-clause/saturation-clause symmetry, and the honesty note that the mirrored `0.2` is an
  assumption (n=1 on each side).
- `computeReality` (`:147-150`): pass `stalePessimistic: rs.stalePessimistic` through.

**Nothing consumes it in this chunk.** `realityClause`'s guard at `:158` is NOT changed here.

**Verification / fixtures** — `pipeline/test/windowread.test.mjs`:
1. Every existing recencySplit + computeReality assertion passes unchanged (`:148,:160,:170,
   :382,:403,:411`) — the additive-field pin. **`RECENCY_SATURATION_FRAC` extraction proven
   byte-identical** by these same fixtures.
2. NEW: mutual-exclusivity pin — on the existing `:148`/`:160` stale fixtures,
   `stalePessimistic === false`; and the `satMirror`-widened `diverges` never flips
   `staleOptimistic` on any existing fixture.
3. NEW: the abs-gap mirror — full 3/14, recent 3/3 → `stalePessimistic === true`,
   `staleOptimistic === false` (fires via the `|gap|` clause, before the saturation clause).
4. NEW — **THE WAYSTONE FIXTURE, built from the real numbers: full 10/14, recent 3/3.** Assert
   `stalePessimistic === true`, `staleOptimistic === false`, `diverges === true`. Comment it as
   the motivating case, naming *why* it needs the saturation clause (`|gap|` = 0.286 < 0.333). If
   this fixture ever goes red, the flag has regressed to cosmetic.
5. NEW: the saturation clause's own boundary — full 12/14 (0.857 > 0.8), recent 3/3 → does NOT
   fire (the clause is bounded, not "any 3/3"); and full 11/14 (0.786 ≤ 0.8), recent 3/3 → fires.
   This pins where the bound actually sits.
6. NEW: `recentHit === recentDays` with `fullHit === fullN` (14/14 · 3/3, a level that always
   prints) → does NOT fire — nothing has changed, there is no recovery to report.
7. Extend `:382` ("recent is ROSIER than full — the opposite shape") to assert
   `r.stalePessimistic === true`.
8. `pipeline/test/oscillation-gate.test.mjs:58`'s `goodLeg()` stub: leave as-is and add an
   assertion that `amplitudeGate`'s `legOk` is unaffected by the new field (the never-admits pin).

**ACCEPTANCE GATE — the over-flag sweep (not optional, not deferred).** Reproduce
`plans/PLAN-DIURNAL-RECENCY-GUARD.md:273-283`'s two-population methodology exactly: score
`stalePessimistic` across (a) `dip-watchlist.json` (~60 by-construction-recently-moved items,
higher base rate EXPECTED) and (b) `watchlist.json` (~25 curated liquid items — the population
that matters). **Bar: ≤ ~25% flag rate on population (b).** Over the bar ⇒ the saturation clause
is re-tuned (or reverts to abs-gap-only) BEFORE RB-2 renders it. Report both rates to Ben with the
chunk. This is the same bar and the same sweep the sibling guard cleared at 16%.

**Guards:** `node --check js/windowread.mjs`; `node pipeline/ci/run-tests.mjs`;
`node pipeline/ci/check-dead-exports.mjs` (no new *export* is added, so this passes — but note
that if a future chunk exports a constant used only by tests, this guard fails).

**APP_VERSION:** `js/windowread.mjs` IS imported by the deployed app (`js/quotecore.js:37`,
`js/trends.js:7`) — but only `windowStats`/`floorCeilingTrack`/`hourProfile`/`deriveDiurnalRange`/
`hourConcentration` are imported; `recencySplit` is not, and no rendered app output changes.
**No bump.** State the reasoning in the commit message (the repo's "pipeline-only stdout tweaks may
ship without a bump, noted in the commit message" precedent).

**Docs (reconcile in this commit):**
- `README.md:104-112` — the `computeReality`/`realityClause` inventory entry lists `spikeTop` /
  `staleOptimistic`; add `stalePessimistic` **in place** in the same sentence.
- `docs/SIGNAL-AUDIT.md:23` — the `recencySplit` row's "flags `staleOptimistic`" → "flags
  `staleOptimistic` / `stalePessimistic`".
- `CHANGELOG.md` — entry.

---

### RB-2 — render the mirror (inform-only, four surfaces, one renderer)

**Change:**
- `js/windowread.mjs:157-169` `realityClause`: extend the guard at `:158` to
  `(!reality.spikeTop && !reality.staleOptimistic && !reality.stalePessimistic)` and add the
  recovering branch. **Sigil: `↑`, never `⚠`** (ruling 6 — a warning mark on a credit misleads).
  Text, mirroring the existing stale clause at `:168`:
  `↑ recent-stronger (${verb} ${reachedDays}/${nDays}d full · ${recentHit}/${recentDays} recent · typical ~X)`.
  `short`/`exit` styles get the compact form. Byte-identical when nothing fires (the existing
  contract).
- `js/validate.mjs:112`: add `stalePessimistic: rc.stalePessimistic` to `evidence`.
  **`:122` is NOT touched. `:125`'s `staleTail` is NOT touched.** A separate, additive
  `recoverTail` may be appended to the `pass` reason only.
- `pipeline/commands/read-window-range.mjs:230` (`rsTxt`) and `:485` (the prose note): add the
  mirror token/clause beside the existing stale one.
- `pipeline/commands/watch-positions.mjs:240`: the `stale()` helper becomes a
  `recencyMark(side, level)` returning `' ⚠stale'` | `' ↑recent-stronger'` | `''`. One-line-per-item
  discipline preserved.

**Verification:**
1. `pipeline/test/validate.test.mjs` — NEW: a stalePessimistic-shaped input produces the SAME
   `status` as an equivalent non-diverging input (the **never-admits pin**, the load-bearing
   assertion of ruling 1). Existing `:99,:117-126` unchanged.
2. `pipeline/test/windowread.test.mjs` — NEW `realityClause` cases: mirror fires → the `↑` text;
   clean → `''` (byte-identical); **`spikeTop` + mirror ⇒ `spike-top` WINS** — pin the precedence
   explicitly rather than leaving it to branch order. This is not bookkeeping: a `recent 3/3` can
   be a genuine regime turn OR a 3-day spike, and those demand opposite actions. `spikeTop` already
   encodes the "recent print is anomalous" test (`reachFrac ≤ 0.25` + extreme placement + a recent
   hit, `js/windowread.mjs:146`), so when it fires it is the *more specific* claim and must
   suppress the credit. A mirror that overrode `spikeTop` would actively recommend chasing a spike.
3. Manual stdout diff: `read-window-range.mjs --ask` and `watch-positions.mjs` on a known-clean
   item must be byte-identical to pre-chunk output.
4. `node pipeline/ci/smoke-test.mjs` — `js/validate.mjs` is imported by `js/trends.js:8`.

**APP_VERSION:** `js/validate.mjs` IS app-imported (`js/trends.js:8` — `reachValidator`,
`floorValidator`, `trajectoryValidator` render as validator notes in the Trends view). **Verify
during the chunk whether `js/trends.js` renders `evidence` fields or only `status`/`reason`.**
If any app-rendered string changes → **bump `APP_VERSION` in `js/state.js`** and watch the
`pages-build-deployment` run. If nothing app-rendered changes → no bump, note it in the commit.
Do not guess: read `js/trends.js`'s validator-note render before deciding.

**Docs (reconcile in this commit):**
- `.claude/skills/scan/SKILL.md:513-517` — "flags **`⚠ stale`** when the full count is rosier than
  recent" is now half the story. Rewrite in place to name both directions and how to read each.
- `.claude/skills/scan/SKILL.md:527-537` — **add one sentence preserving the bid-side rule**: the
  mirror is ask-side; the `⚠ stale`-on-a-BID doctrine (Hydra leather) is unchanged and must not be
  "symmetrized". Without this, the next editor undoes §1.3.
- `.claude/skills/scan/SKILL.md` frontmatter `version: 1.89` → `1.90`.
- `.claude/skills/positions/SKILL.md:416` (the `recent 0/3 ⚠ stale` reference — this one IS
  `recencySplit`): add the mirror. **Do NOT touch `:141` or `:155`** — those `⚠ stale` strings are
  the *stale live print* guard, a completely different signal; editing them is the likely mistake.
- `.claude/skills/positions/SKILL.md` frontmatter `version: 1.52` → `1.53`.
- `docs/SKILL-TRIAGE.md:50` — "the `⚠ stale` flag is coded, the read is judgment" → name both flags.
  (This file is CI-linted by `pipeline/ci/lint-skills.mjs`; keep the row's tag structure.)
- `docs/MARKET-ANALYSIS.md:294` — the amplitude viability read says "`staleOptimistic`-guarded";
  add that the mirror explicitly does NOT admit a leg (ruling 1), so the guard's asymmetry is a
  documented decision rather than an oversight.
- `docs/MARKET-ANALYSIS.md:167` already records the recovering-item failure mode for `regimeDrift`
  (fixed by `floorCeilingTrack` at R2). **Cross-reference it; do not duplicate the prose** —
  `pipeline/ci/lint-docs.mjs` CHECK 2 is a duplicate-phrase check.
- `README.md:104-112` — update the `realityClause` renderer description to three flags.
- `CHANGELOG.md` — entry.

---

### RB-3 — Fix 2, the DISPLAY half (zero ordering blast radius)

**Change:**
- `js/estimators/reach.mjs`: add ONE pure exported helper next to `askReachFactor` —
  `reachFraction(askReach, { prefer = 'full' })` → `number|null`, implementing the recent-preferred
  rule (`recentDays > 0 ? recentHit/recentDays : reachedDays/nDays`) with `prefer:'full'` returning
  today's `reachedDays/nDays`. Then `askReachFactor(askReach, relief = 0, { prefer = 'full' } = {})`
  calls it. **Default unchanged ⇒ every existing call site is byte-identical**, including
  `watch-positions.mjs:252`'s bare-object relief note (§1.5).
- `js/estimators/pair.mjs:225`: `askReachFactor(extra.askReach, 0, { prefer: 'recent' })`. Update
  the header comment at `:221-224` and the module header note at `:18` — both currently assert
  pair's `pFill` is "the SAME P(fill) the rank uses… reused (never forked)". **After RB-3 alone
  that sentence is false for one release interval** (see §6 Q2); the comment must say so honestly:
  "display P is recent-basis; the rank is still full-basis until RB-4 — the two disagree by design
  for this interval."
- `pipeline/commands/read-window-range.mjs:598`: when the two bases differ, print both —
  `· P(fill)~42% (full-window 71%)`. Following the EF1(b) suppress-when-unmoved rule, print the
  single value when they are equal. `:603`'s template consumes `pf` unchanged.
- **`pipeline/commands/watch-positions.mjs:251-252` — the third call site (ruling: recent basis).**
  Attach the recent counts to `aR` (from the `recencySplit` already computed in scope for `stale()`
  at `:240` — zero new fetch) and pass `{ prefer: 'recent' }` to both `askReachFactor` calls.
  **Reasoning, and the visible consequence:** this note prints inches from RB-2's new
  `↑ recent-stronger` marker on the same held-lot line; leaving it full-basis would put two
  contradicting recency reads on one line — the exact defect this plan exists to remove. The
  consequence is that on a recovering item where recent reach is already 3/3, the base factor is
  1.0, relief has nothing left to relieve, and **the `size-relieved fill ~N%` clause disappears**.
  That is correct, not a regression: there is no discount to soften. Pin it with a fixture so the
  disappearance is a tested behavior rather than a bug report later.
- Optionally reuse `reachFraction` inside `pair.mjs`'s `reachRead` (`:103`) so there is literally
  one implementation of the rule. **Must be proven byte-identical** (mechanical-move discipline).

**Verification** — `pipeline/test/estimators.test.mjs`:
1. `askReachFactor(a)` and `askReachFactor(a, 0)` byte-identical to pre-chunk for every existing
   fixture — including one with recent fields present, to pin that the DEFAULT ignores them.
2. `askReachFactor(a, 0, {prefer:'recent'})` on `{reachedDays:12, nDays:14, recentHit:0,
   recentDays:3}` → the floor-mapped value for frac 0 (`PFILL_ASKREACH_FLOOR` = 0.25); and on
   `{reachedDays:2, nDays:14, recentHit:3, recentDays:3}` → 1.0. Both directions.
3. `prefer:'recent'` with `recentDays` absent/0 degrades to the full window (the absent→degrade
   precedent) — pin explicitly.
4. `estimatePair(...).pFill` now moves with the recent read; `estimateRank(...).rank` and `.pFill`
   are **byte-identical** — the "RB-3 does not move the board" pin.
5. Existing fixtures at `:308,:321,:429,:502` (which already carry recent/full divergence) get an
   explicit `pFill` assertion so a future regression is caught.
6. **`pipeline/test/estimators.test.mjs:782-789` — the don't-fork pin must be REWRITTEN, not left
   to pass by accident (§1.7).** It currently passes only because its fixture `{reachedDays:4,
   nDays:14}` has no recent fields. Replace it with a two-case test that states the *new* truth:
   - **case 1 (degrade):** with `ar` unchanged (no recent fields),
     `e.pFill === askReachFactor(ar)` — still byte-identical, now asserted as the *degrade* path;
   - **case 2 (the real invariant):** with `ar2 = {reachedDays:4, nDays:14, recentHit:3,
     recentDays:3}`, assert `e.pFill === askReachFactor(ar2, 0, {prefer:'recent'})` and
     `e.pFill !== askReachFactor(ar2)` — i.e. **still not forked** (it is the same function on the
     same basis the caller declared), but no longer identical to the *default* call.
   Rename the test accordingly (the invariant is "reuses `askReachFactor`, never reimplements it,"
   NOT "always equals the full-window call"). Keep the `:788` absent→1 assertion as-is.
7. `pipeline/test/watchcore.test.mjs` (or the watch surface's suite) — a fixture pinning that the
   relief clause disappears when the recent basis puts the base factor at 1.0.
8. `js/estimators/cells.mjs:71-75` — reword the comment in the same commit (§1.7). It currently
   claims "the SAME askReachFactor probability the rank carries"; after RB-3 (and before RB-4) the
   rank is still full-basis, so the honest wording is that the Net cell's `P(ask)~` is the
   **ask-leg factor on the display basis**, with a pointer to RB-4 for the rank. `estPairCells`'s
   rendered output is otherwise untouched.

**APP_VERSION:** `js/estimators.mjs` is app-imported (`js/market.js:4`), but `js/market.js:206`
calls `estimateRank(FINDER_SPEC, row)` with **no `extra`** → no `askReach` → `askReachFactor`
returns 1 → **app behavior is provably unchanged**, and `estimatePair` is never called by the app
(`js/estimators/pair.mjs:62` header states this). **No bump**; state the proof in the commit
message. Still run `smoke-test.mjs`.

**Docs:**
- `docs/MARKET-ANALYSIS.md:84` — "with its **P(fill)** beside it (`askReachFactor`, the SAME
  probability the rank carries — raw margin × P(fill), reused not forked)". Rewrite in place to
  state the basis and the temporary divergence.
- `docs/MARKET-ANALYSIS.md:733` — the `fold:` line spec must gain the `(full-window p%)` clause.
- `docs/SIGNAL-AUDIT.md:63` — **this row is WRONG TODAY and must be fixed regardless.** It claims
  `askReachFactor`'s input is "reach fraction (recent-3 preferred via `reachRead` upstream)" and
  Recency-aware "✅ (inherits RC1)". Neither is true: `askReachFactor` computes
  `reachedDays/nDays`; `reachRead` feeds only the fold price. Correct it to describe the actual
  per-call-site basis after RB-3.
- `docs/SIGNAL-AUDIT.md:57` — the `estimatePair`/`reachFoldModel` row: the fold basis line stays
  correct, but add the pFill basis.
- `docs/GLOSSARY.md:101` — "**P(fill)** — probability the flip fills, two legs: `P(bid) × ask-reach
  factor`" → name the basis.
- `README.md:1330-1348` — the `js/estimators/reach.mjs` + `estimateRank` inventory entry: register
  the new `reachFraction` export and the `prefer` option (rule 8: a new export gets an inventory
  entry in the same commit).
- `CHANGELOG.md` — entry.

---

### RB-4 — Fix 2, the RANK half (DECISION-MOVING; **CONSOLE-ONLY**; visible comparison mandatory)

**BLOCKED on RB-0** (ruling 5 — the basis is chosen from the bake-off, not assumed) **and on RB-3
having landed** (ruling 8).

**Ruling 4 shapes the implementation: the console rank moves, `screen.json` does not.** Concretely
— the basis is a per-call input, and the screen computes BOTH reads (it already does exactly this
for EF1(b) at `:1262`):

```
er      = estimateRank(spec, row, { …, pBasis: <chosen> })   → console render + sort + digest rankKey
erFull  = estimateRank(spec, row, { …             })          → screen.json row, published grade, last-report
```

The published artifact is written from `erFull`, byte-identical to today. Follow the Path-A
precedent's own guard at `pipeline/commands/screen-flip-niches.mjs:1447` (the "FREEZE the
pre-Path-A published values" block) — put the freeze in the same place and reference it, so both
console-only overlays are visible together rather than one hiding behind the other.

**A fixture must pin the freeze:** a screen run where the two bases disagree produces a
`screen.json` byte-identical to the full-basis run. This is the load-bearing assertion of ruling 4
— if it is missing, a later refactor silently publishes the unvalidated basis.

**Change:**
- `js/estimators/families.mjs:332`: take the basis from `extra.pBasis` (default `undefined` ⇒
  today's full-window call ⇒ byte-identical for every existing caller, including the app's
  `js/market.js:206`). Update the `:314-328` doctrine comment in place.
- `pipeline/commands/screen-flip-niches.mjs` — the visible comparison, copying EF1(b)
  (`:1260-1271`) shape exactly. `erFull` is computed anyway for the `screen.json` freeze above, so
  the comparison is free:
  - `moved` predicate identical in spirit to `:1269` (`Math.round(er.rank) !== Math.round(erFull.rank)
    || er.pFill.value.toFixed(2) !== erFull.pFill.value.toFixed(2)`) — **suppress the note when
    nothing moved** (compact-output rule);
  - push to a new `basisNotes` array, emitted in the footer beside the existing three at `:1606-1612`:
    `⇄ P-basis recent-3 — <name>: ask <X> reached a/b recent vs c/d full → rank R (was R0) · P~p (was p0) — recency-basis (RB-4, PLACEHOLDER n≈0)`.
  - This is the *precise* answer to the brief's requirement 2: same sigil-prefixed footer line, same
    "X (was Y)" pair for BOTH the rank and P, same suppress-when-unmoved rule, same
    PLACEHOLDER/n label.
- `pipeline/lib/render/suggestlog.mjs:431,487-491`: add `pBasis` + `rankPreBasis` shadow fields
  beside `exemptionBounded`/`rankPre`, logged on every row whose basis differed (including no-op
  moves — the EF1(b) shadow discipline, so the F1 retro can segment).
- **The `js/rating.mjs` grade letter and `REACH_GRADE_CAP` follow the rank automatically.** Do not
  add a second comparison there; the footer line is the one place the swap is announced.

**Verification:**
1. `pipeline/test/estimators.test.mjs` — `estimateRank` with an explicit `pBasis` under a
   recent/full divergence returns the chosen-basis P and rank; **with `pBasis` absent it is
   byte-identical to pre-chunk** (the every-existing-caller pin, incl. the app).
2. A fixture pinning that a row with `recentDays < 3` (thin recent sample) is untouched.
2b. **The `screen.json` freeze fixture** (above) — the load-bearing ruling-4 assertion.
3. `pipeline/test/suggestlog.test.mjs` — the two new shadow fields are emitted only when the basis
   differed, and are absent otherwise (lean-shadow discipline).
4. A screen stdout fixture / manual run on a known clean board proving the footer line does NOT
   appear when nothing moved.
5. `check-imports.mjs`, `check-dead-exports.mjs`, `lint-docs.mjs`, `run-tests.mjs`, `smoke-test.mjs`.

**APP_VERSION:** `js/market.js` passes no `askReach` and now also no `pBasis` → app rank unchanged
→ **no bump**. Under ruling 4 `screen.json` is written from `erFull`, so the published artifact is
byte-identical too — **there is no app-facing change of any kind**, which is precisely why the
console-only ruling was the right call.

**Docs:**
- `docs/MARKET-ANALYSIS.md:590-596` — "**P(fill) is two-leg:** `P = P_bid × askReachFactor(askReach)`"
  and the EF1(c) leg-labeling paragraph: name the recent-3 basis in place.
- `docs/MARKET-ANALYSIS.md:84` — remove the RB-3 "temporary divergence" sentence; the two are one
  basis again.
- `docs/SIGNAL-AUDIT.md:63` — the `askReachFactor` row is now genuinely "✅ recency-aware"; and
  `:113` (Tier-2 item 5, the soft-floor writeup) must state that the floor now applies to the
  recent-3 fraction, which makes a 0/3 mirage hit the 0.25 floor *more* often — a real behavioral
  consequence worth naming.
- `docs/GLOSSARY.md:99,101` — rank/P(fill) definitions.
- `README.md:1330-1348` — the `estimateRank` two-leg-P description.
- `.claude/skills/scan/SKILL.md:546` and the surrounding EF1 block — add how to read the `⇄ P-basis`
  footer line (relay both numbers, same as the `⚠ exemption dropped` instruction at `:558`).
  Bump `version:` again.
- `CHANGELOG.md` — entry.

---

### RB-5 — collapse the third basis (mechanical, byte-identical)

**Change:** `pipeline/commands/screen-flip-niches.mjs:658-662` `digestReachFrac` is a third copy of
the recent-preferred rule. Replace its body with a call to `reachFraction(askReachExtra,
{prefer:'recent'})` from `js/estimators/reach.mjs`.

**Plus the defensive comment (ruling 7)** at `digestReachFrac`: state that this surface has been
recent-based since PLAN-CAPITAL-EFFICIENCY-AND-DIGEST and that this is DELIBERATE, not drift — it
was the third of three bases (§1.4) and is now the shared one. Without the comment, a future
reader who finds the digest disagreeing with `screen.json` (which stays full-basis under ruling 4)
will "fix" it back into a divergence.

**This is a pure mechanical move** (PLANNING.md chunk rule: mechanical moves are separate chunks
from behavior changes, each proven byte-identical). After RB-4 the digest column and the rank read
the same number from the same function — the §1.4 three-basis problem is closed.

**Verification:** `pipeline/test/capeff-digest.test.mjs` (which has ~15 `digestReachAndPlacement`
fixtures at `:216-329`) passes **unchanged, byte for byte** — that IS the acceptance criterion.
Plus `check-imports.mjs` (a new cross-package import from `pipeline/commands/` into
`js/estimators/reach.mjs` — verify the existing shim path
`pipeline/lib/signal/estimators.mjs` is the right import, not a direct `js/` reach).

**APP_VERSION:** none. **Docs:** `docs/SIGNAL-AUDIT.md`'s digest rows; `CHANGELOG.md`.

---

## 6. Open questions — ALL RESOLVED

The five questions from planning round 1 were ruled on by Ben (2026-08-03) and are recorded as
rulings 4–8 in §2. Summary of what changed from my proposals:

| # | Question | Ruling | vs my proposal |
|---|---|---|---|
| 1 | Reorder published `screen.json`? | **No — RB-4 console-only**, Path-A precedent (`screen-flip-niches.mjs:1447,1589`) | **overruled** (I proposed shipping the reorder) |
| 2 | RB-3/RB-4 sequencing | back-to-back in one session, breakage spelled out | accepted |
| 3 | Hard recent-3 vs blend | **Neither assumed — RB-0 bakes off three bases; RB-4 blocked on it** | **overruled** (I proposed the hard swap) |
| 4 | Sigil | `↑ recent-stronger`, never `⚠` | accepted |
| 5 | Digest | out of scope + a defensive comment | accepted, comment added |

**No open questions remain.** Two items are *evidence-gated* rather than open: the P-basis choice
(RB-0) and whether the saturation clause clears the over-flag bar (RB-1's sweep). Both have a
defined decision procedure and a named fallback, so an executor is never blocked on a judgment
call that has not been made.

---

## 7. What would falsify this (how we would know it made things worse)

Rule 4 cuts both ways: a plan that cannot say what would disprove it is not making a claim. Each
row names the observable, where it is measured, and what it would trigger.

| # | Failure mode | Observable | Measured where | Response |
|---|---|---|---|---|
| F1 | **The mirror is noise.** The saturation clause fires so broadly the token stops carrying information. | flag rate on the curated `watchlist.json` population **> ~25%** | RB-1's over-flag sweep, re-run at RB-2 and periodically via `/cleanup` | re-tune or drop the saturation clause back to abs-gap-only |
| F2 | **The mirror credits spikes.** `recent 3/3` was a 3-day spike, not a regime turn; the item then fails to reach the ask. | rows flagged `stalePessimistic` (and NOT `spikeTop`) whose ask subsequently goes unfilled at a rate no better than unflagged rows | `positions.json` unfilled resting asks joined to the flag, via `analyze-record.mjs` | tighten the `spikeTop` precedence, or require ≥2 confirming days |
| F3 | **The rank basis is worse, not just different.** The whole premise (recent predicts fill better) is wrong. | partition logged suggestions by the SIGN of (recent − full) fraction; compare realized ask-fill rate and time-to-fill across the two groups. **If rows the new basis PROMOTED fill no better than rows it DEMOTED, the change is not an improvement.** | F1 retro over the `pBasis`/`rankPreBasis` shadows RB-4 logs to `suggestions.jsonl` | revert `pBasis` to full (one-line default flip) |
| F4 | **The rank got unstable.** Four-valued P (basis B) makes the board reshuffle on its own noise. | top-10/top-20 churn between consecutive passes **with no new market data**, vs the full-basis baseline | RB-0 item 5 pre-ship; the same measure re-run post-ship | switch to the weighted basis C, or raise λ |
| F5 | **The consistency claim itself is false.** The price and the P still disagree because they read different windows. | the screen's `askReach` comes from the validator's **coming-8h** window (`js/validate.mjs:67-76`, EF1(d)) while `quote-items` uses the **full day** — both feed "recent-3", but of different windows | direct comparison of the two surfaces on one item, minutes apart (the documented neitiznot divergence) | out of scope here — this is EF0's window-basis unification, and RB must not claim to have fixed it |

**F5 is the honest limit of this plan and must not be glossed.** RB-3/RB-4 make the *recency
basis* consistent within a surface. They do **not** unify the *window* basis across surfaces —
that divergence is documented at `js/validate.mjs:67-76` as intentional and EF0-gated. No doc,
commit message, or console line from this plan may claim "the surfaces now agree."

**Where F3's evidence comes from, and why the shadows log on no-op moves:** the `pBasis` /
`rankPreBasis` fields RB-4 writes are the join key. They are logged on **every** row whose basis
differed, including rows where the rank did not visibly move, precisely so the retro has both arms
of the comparison. This mirrors EF1(b)'s shadow discipline (`suggestlog.mjs:487-491`).

---

## 8. Honesty (process rule 4)

- **New unvalidated MAGNITUDES introduced: ZERO. New unvalidated ASSUMPTIONS: one, named.**
  `stalePessimistic` reuses `RECENCY_DIVERGE` and the zero-clause's own `0.2` (extracted to
  `RECENCY_SATURATION_FRAC` and mirrored as `1 − 0.2`); the P-basis reuses `reachRead`'s rule;
  `RECENT_NIGHTS = 3` is inherited and already a labeled PLACEHOLDER (`js/windowread.mjs:71`).
  **The assumption is the SYMMETRY** — that the magnitude tuned against the blood-rune crash
  anchor (n=1) is also right in the recovery direction (n=1, the waystone). That is a lean, not a
  law; RB-1's over-flag sweep is what keeps it honest, and it is the first thing to re-tune if F1
  fires.
- **What is measured:** the code paths and their bases (§1, read not inferred); the current market
  regime (external breadth panel — establishes the defect is live, nothing more); after RB-0, the
  magnitude, granularity and *stability* of the board move under each candidate basis; after RB-1,
  the flag rate on two populations.
- **What is assumed and NOT validated:** that a recency-weighted basis predicts ask fill better
  than the full window. **n = 0.** No fills-to-basis join exists. **Do not describe RB-3/RB-4 as an
  accuracy improvement in any doc, commit message, or console line** — describe them as a
  *consistency* fix: the price and the probability printed beside each other now answer the same
  question. That claim is provable; the accuracy claim is not.
- **The basis is not chosen in this document** (ruling 5). Any executor who reads a basis
  preference into §1 or §5 is reading it wrong — RB-0 decides, RB-4 is blocked on it.
- **The mirror's sensitivity is a designed tradeoff, not an accident.** The naive
  `diverges && recentFrac > fullFrac` misses the motivating case entirely (§1.1); the saturation
  clause fixes that at the cost of a broader firing surface, bounded by the ≤25% sweep bar.
- **Sample-size honesty on the recent read:** n = 3, and it is a *multiplier* into the rank
  (ruling 5). This is the reason RB-0 measures granularity and self-noise stability, not just
  deltas.
- **What would validate any of this:** F1's realized-fill retro joined against the logged
  `pBasis`/`rankPreBasis` shadows RB-4 adds — the F3 test in §7. That is why those shadows log
  even on no-op moves.
- **What this plan explicitly does NOT fix:** the cross-surface WINDOW basis divergence (§7 F5).

---

## 9. Encoding boundary + skill triage

| Rule | Disposition | Where it lives |
|---|---|---|
| "a recovering ask reads stronger than the full window says" | **ENCODE** | `recencySplit.stalePessimistic` (RB-1) |
| "the mirror never admits a candidate" | **ENCODE** (as an absence) + **fixture** | `validate.test.mjs` never-admits pin (RB-2) |
| "a `⚠ stale` BID means don't assert the fill" | **KEEP-AS-JUDGMENT** — unchanged | `.claude/skills/scan/SKILL.md:527-537` |
| "how to read the two-directional recency token" | **KEEP-AS-JUDGMENT** | `/scan` SKILL.md (RB-2 rewrite) |
| "P(fill) and its price share one basis" | **ENCODE** | `reachFraction` + the `prefer` option (RB-3/RB-4) |
| "relay both numbers when the basis moved a rank" | **KEEP-AS-JUDGMENT** | `/scan` SKILL.md, mirroring `:558` |

`pipeline/ci/lint-skills.mjs` requires every SKILL.md rule-block to be tagged; the two
KEEP-AS-JUDGMENT rewrites need `_(judgment: …)_` tags in the house style.

---

## 10. Bookkeeping & compatibility checklist (per chunk, not deferred)

| Item | RB-1 | RB-2 | RB-3 | RB-4 | RB-5 |
|---|---|---|---|---|---|
| `node --check` touched files | ✓ | ✓ | ✓ | ✓ | ✓ |
| `pipeline/ci/run-tests.mjs` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `check-imports.mjs` | ✓ | ✓ | ✓ | ✓ | ✓ (new import) |
| `check-dead-exports.mjs` | ✓ | ✓ | ✓ (new export MUST have a non-test consumer in the same commit) | ✓ | ✓ |
| `lint-docs.mjs` / `lint-skills.mjs` / `lint-arch.mjs` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `smoke-test.mjs` (Playwright) | — | ✓ (validate.mjs is app-imported) | ✓ | ✓ | — |
| `README.md` inventory entry | ✓ | ✓ | ✓ (new export) | ✓ | — |
| SKILL.md `version:` bump | — | scan 1.89→1.90, positions 1.52→1.53 | — | scan bump | — |
| `APP_VERSION` (`js/state.js`) | no | **decide in-chunk** (see RB-2) | no (proven) | no (proven — `screen.json` frozen to `erFull`, ruling 4) | no |
| `CHANGELOG.md` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Schema back-compat | — | — | — | `suggestions.jsonl` gains 2 optional fields (additive, reader-tolerant) | — |
| Published-artifact freeze | — | — | — | **`screen.json` written from `erFull` + a fixture pinning byte-identity (ruling 4)** | — |
| No new files ⇒ no `.gitignore` / ARCHITECTURE.md changes | ✓ | ✓ | ✓ | ✓ | ✓ |

**Evidence gates (a chunk may not start until its gate is met):** RB-1 → the ≤25% over-flag sweep
(reported with the chunk, not after). RB-4 → RB-0's basis bake-off, with a basis chosen.
RB-0 itself is ungated and can start immediately; it is the critical path.

**Primary-file sets (the parallel-safety contract).** RB-1/RB-2: `js/windowread.mjs`,
`js/validate.mjs`, `pipeline/commands/read-window-range.mjs`, `pipeline/commands/watch-positions.mjs`.
RB-3: `js/estimators/reach.mjs`, `js/estimators/pair.mjs`, `js/estimators/cells.mjs`,
`pipeline/commands/read-window-range.mjs`, `pipeline/commands/watch-positions.mjs`.
**⚠ RB-2 and RB-3 overlap on two command files AND on `watch-positions.mjs`'s same region
(`:240` vs `:251-252`, adjacent lines in one function) — these are NOT parallel-safe. Sequence
them**, contrary to my first draft which called them parallel. RB-4: `js/estimators/families.mjs`,
`pipeline/commands/screen-flip-niches.mjs`, `pipeline/lib/render/suggestlog.mjs`. RB-5:
`pipeline/commands/screen-flip-niches.mjs` (sequence after RB-4 — same file).

**Landing:** attended direct-push under the admin bypass, `git fetch && rebase origin/main &&
push`, per CLAUDE.md rule 6 / `/ship` §2. Describe each chunk to Ben before landing.

**On the last chunk:** fold this file into root `PLAN.md`'s Status table (one row per chunk + sha)
and **delete `plans/PLAN-RECENCY-BASIS.md`** — the per-topic plan does not survive its last chunk.

---

## 11. Full doc reconciliation index (rule 8 — grep-and-fix in place, never append)

Consolidated for the executor. Each entry already appears in its chunk above; this is the
single checklist.

| File:line | Statement this supersedes/contradicts | Chunk |
|---|---|---|
| `docs/SIGNAL-AUDIT.md:63` | **WRONG TODAY** — claims `askReachFactor`'s input is "recent-3 preferred via `reachRead` upstream" and ✅ recency-aware. It is `reachedDays/nDays`, full window. | RB-3 (fix), RB-4 (make true) |
| `docs/SIGNAL-AUDIT.md:23` | `recencySplit` row names only `staleOptimistic` | RB-1 |
| `docs/SIGNAL-AUDIT.md:57` | `estimatePair` row — fold basis correct, pFill basis unstated | RB-3 |
| `docs/SIGNAL-AUDIT.md:113` | Tier-2 item 5, the 0.25 soft-floor writeup — floor now applies to the recent fraction | RB-4 |
| `docs/MARKET-ANALYSIS.md:84` | "P(fill) beside it (`askReachFactor`, the SAME probability the rank carries — reused not forked)" | RB-3 (temporary divergence), RB-4 (restore) |
| `docs/MARKET-ANALYSIS.md:294` | amplitude's "`staleOptimistic`-guarded" viability read | RB-2 |
| `docs/MARKET-ANALYSIS.md:590-596` | "P = P_bid × askReachFactor(askReach)" + EF1(c) leg labeling — must now state the basis **per surface** (console recent, published full), the ruling-4 consequence | RB-4 |
| `pipeline/commands/screen-flip-niches.mjs:1589` | the Path-A footer already says "The published screen.json / app stay on Grade + the neutral sort (console-only until validated)" — **extend it in place** to cover the P-basis overlay too, rather than adding a second footer sentence saying the same thing about a different column | RB-4 |
| `pipeline/test/estimators.test.mjs:782` | the don't-fork pin passes for the wrong reason after RB-3 (§1.7) — **rewrite the test, do not leave it green by accident** | RB-3 |
| `js/estimators/cells.mjs:71-75` | comment asserts pair's P is "the SAME askReachFactor probability the rank carries" | RB-3 |
| `docs/MARKET-ANALYSIS.md:733` | the three-part `fold:` line spec | RB-3 |
| `docs/MARKET-ANALYSIS.md:167` | already records the recovering-item mislabel for `regimeDrift` — **cross-reference, do not duplicate** (lint-docs CHECK 2) | RB-2 |
| `docs/GLOSSARY.md:99,101` | rank / P(fill) definitions, basis unstated | RB-3, RB-4 |
| `docs/SKILL-TRIAGE.md:50` | "the `⚠ stale` flag is coded" — one flag | RB-2 |
| `README.md:104-112` | `computeReality`/`realityClause` entry lists two flags | RB-1, RB-2 |
| `README.md:1330-1348` | `js/estimators/reach.mjs` + `estimateRank` inventory — new export + basis | RB-3, RB-4 |
| `.claude/skills/scan/SKILL.md:513-517` | "flags `⚠ stale` when the full count is rosier than recent" — half the story | RB-2 |
| `.claude/skills/scan/SKILL.md:527-537` | bid-side doctrine — **PRESERVE explicitly**, add a do-not-symmetrize sentence | RB-2 |
| `.claude/skills/scan/SKILL.md:546-561` | rank-discount + EF1 relay block — add the `⇄ P-basis` read | RB-4 |
| `.claude/skills/positions/SKILL.md:416` | `recent 0/3 ⚠ stale` (this one IS recencySplit) | RB-2 |
| `.claude/skills/positions/SKILL.md:141,155` | **DO NOT TOUCH** — these `⚠ stale` strings are the *stale live print* guard, a different signal | — |
| `CLAUDE.md` | grep found **no** contradicted statement (no `staleOptimistic` / P-basis claim). Only a "Done" pointer once the last chunk ships. | last chunk |
| `docs/ARCHITECTURE.md` | grep found **no** mention of `staleOptimistic` / `recencySplit` / `askReachFactor`. No new files ⇒ `lint-arch.mjs` unaffected. Nothing to reconcile. | — |
| `docs/FLOW.md:81` | names `js/estimators.mjs P(fill)/TTF` generically — no basis claim, no change needed | — |
| `pipeline/MONITORING.md:558` | mentions `recencySplit` as a fetched primitive only — no basis claim | — |
