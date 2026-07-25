# PLAN-GRADE-REWORK — dimensionally-honest, single-source screen grading (rank + letter + digest, reconciled)

Status: **DRAFT — awaiting approval.** Per-topic working doc (PLANNING.md lifecycle step 1–2);
folds into `PLAN.md` and is deleted when its last chunk ships. Executor rules = PLAN.md
"Executor rules", verbatim (also CLAUDE.md process rules 1–9). **ZERO code has been changed to
produce this plan** — every claim below is a direct code read (file:line), not theory. This plan
is a mix of STRUCTURAL fixes (land now, calibration-independent) and one F1-GATED bucket
(constant retuning — explicitly NOT scheduled here). Read the honesty core (§4) before touching
any chunk.

## 1. Problem / motivation

A screen run today computes **three different numeric rankings of the same row**, none
reconciled with the others:

1. **The letter grade** — `rateItem()` in `js/rating.mjs`: `score = round(rank × riskMult)`,
   graded off one fixed `GRADE_CUTOFFS` table (`js/rating.mjs:73-78`), applied identically to
   every strategy family.
2. **The rank** — `estimateRank()`/`rankScore()` in `js/estimators/families.mjs:253-257`:
   `net × P(fill) ÷ TTF`, PER-UNIT for band/value/rising, PER-LAP for churn
   (`churnLapUnits`, `families.mjs:203-209`, multiplied in at `families.mjs:299-300`), PER-CYCLE
   for amplitude (`ttfAmplitude`'s `holdDays × 86400`, `families.mjs:141-144`).
3. **The digest's `rankKey`** — `collectDigestRow()` in
   `pipeline/commands/screen-flip-niches.mjs:551-575`: `capEff × deployable`, where `deployable`
   is realizable capital-parked gp/day from `js/valuescreen.mjs`'s `deployUnits()` (the exact
   three-way GE-physics min: bankroll cap, market-share bound, buy-limit accumulation —
   `valuescreen.mjs:200-208`), and `capEff` is yet a FOURTH rate (`capEfficiency()`,
   `screen-flip-niches.mjs:457-462`: after-tax ROI% earned per day of capital tied up, using its
   OWN `holdDays()` — `screen-flip-niches.mjs:438-448` — which re-derives a TTF-to-rate transform
   independently of `rankScore`'s).

The digest was built (`PLAN-CAPITAL-EFFICIENCY-AND-DIGEST`, see its header comment,
`screen-flip-niches.mjs:405-411`) **because the letter grade optimizes the wrong thing** for a
big-ticket triage decision: `capitalFactor` (`rating.mjs:57-60`) *mildly penalizes* big per-unit
price ("1m→1.0, 10m→0.85, ~46m→0.6"), and the grade's `rank` term is per-unit, so a cheap
high-velocity item and a big-ticket low-velocity item are compared on a metric that structurally
favors the cheap one — the opposite of what a "how should I deploy my actual bankroll" triage
needs. Rather than fix the grade, a second parallel ranking (the digest) was bolted on top. Two
systems now coexist that will disagree on the same batch by construction, and a third rate
(`capEff`) was invented in between them. This plan reconciles them into one dimensionally-honest
basis instead of a third bolt-on.

## 2. What was verified (evidence, not theory — read 2026-07-21)

Each numbered item below is one of the eight flaws under test — CONFIRMED / CORRECTED /
REJECTED against the actual code, plus three flaws found that were not in the original list.

### FLAW 1 — incommensurable rank units under one grade table — **CONFIRMED**
`GRADE_CUTOFFS` (`rating.mjs:73-78`) is one absolute table `gradeFor()` (`rating.mjs:79-82`)
applies to every family's `score`. But the `rank` it's grading is PER-UNIT for band/value/rising
(`lapUnits` defaults to 1, `families.mjs:299`), PER-LAP for churn (`net × lapUnits` where
`lapUnits` = the buy limit bounded by feasible depth, `families.mjs:203-209,299-300`), and
PER-CYCLE for amplitude (`ttfAmplitude` returns `holdDays × 86400` as the TTF denominator,
`families.mjs:141-144`, with `lapUnits` = `amplitudeDeployUnits`, `families.mjs:150-156`). Same
letter, three physically different quantities. Confirmed exactly as described; the "Water
battlestaff churn grades S+ next to a higher-per-unit-net band item" anchor is plausible given the
mechanism but was NOT independently re-verified against live data (rule: no pasted live data —
the mechanism is what's load-bearing, not the specific item).

### FLAW 2 — the grade and the digest rank the same board differently by construction — **CONFIRMED, and broader than stated**
Confirmed as described (§1 above). **Correction/addition:** it is not two rankings but **three**
— grade `score`, raw `rank`, and digest `rankKey`/`capEff` — each a different unit
(unitless-times-riskMult, gp-equivalent-per-day-ish, %-per-day × gp). `capEfficiency`'s
`holdDays()` (`screen-flip-niches.mjs:438-448`) independently RE-DERIVES a TTF-to-rate transform
instead of reusing `rankScore`'s (`families.mjs:253-257`) — a second home for the same concept.
The floor values happen to coincide numerically today (`TTF_FLOOR_DAYS = 1/24` day,
`families.mjs:80`, vs. `Math.max(ttfSec, 3600)/86400` in `holdDays`, `screen-flip-niches.mjs:445`
— `3600s = 1/24` day) but the constant is duplicated as a literal, not imported — a silent-drift
risk if either changes (this is exactly the "two-homes" anti-pattern `PLANNING.md`'s Anti-patterns
section names).

### FLAW 3 — absolute cutoffs on an unbounded, right-skewed score — **CONFIRMED**
`GRADE_CUTOFFS` is a fixed absolute table (`rating.mjs:73-78`). The module header
(`rating.mjs:3-8`) states the PURPOSE is comparative ("which are worth our time… SEPARATE the
best from the merely-good") and even pre-empts the clumping critique in-code ("If a whole batch
clumps at one grade, that is a signal the SCORE lacks dynamic range… not that the letter scale is
wrong") — i.e. the author anticipated this exact tension and chose to defend the absolute
implementation rather than flag it as a contradiction. That defense doesn't survive Flaw 1: even
with full dynamic range, an absolute table graded across incommensurable per-unit/per-lap/per-cycle
units can't "separate the best of a batch" honestly, because the same number means different
things per family. The specific "Necklace of passage 180%/d" anchor was not independently
re-verified (no live data pasted), but the mechanism is confirmed structurally: `rankScore`
(`families.mjs:253-257`) has no upper bound beyond `TTF_FLOOR_DAYS`'s 1-hour floor
(`families.mjs:80`) — a large `net` at a near-zero TTF is a legitimate but extreme value the fixed
table has no way to compress or contextualize.

### FLAW 4 — `riskMult` compounds and double-counts fill-ease — **CONFIRMED, and one double-count is undocumented**
`riskMult = regime × mom × liq × capital × confidence` (`rating.mjs:130`), 5 sub-1 factors;
`0.85^5 ≈ 0.4437` — the arithmetic checks out. The module header (`rating.mjs:16-18`) already
self-documents ONE overlap (liq factor vs. pFill/TTF touching fill-ease) as a "MILD OVERLAP NOTE"
— that part of the critique is already acknowledged in-code, not newly found. **What is NOT
documented anywhere:** a breakdown-momentum double-count. `momFactor` penalizes a breakdown at
×0.45 (`rating.mjs:41`), and separately `pFillIntraday` (the rank's own P(fill) estimator) ALSO
subtracts `PFILL_BREAKDOWN_PENALTY = 0.15` off `p` for the identical `mom === 'breakdown'`
condition (`families.mjs:74,111`). A breakdown row is discounted twice for the same signal, once
in the multiplier and once in the rank itself feeding that same multiplier's product — undocumented,
unlike the liq/pFill overlap.

**FLAW 4b (2026-07-24 blindspot audit, `PLAN-BLINDSPOT-AUDIT.md` finding #4) — `REACH_GRADE_CAP`
re-penalizes ask-reach a THIRD time.** The ask-reach fraction is already multiplied into the
`net × P(fill) ÷ TTF` rank the row sorts on (`P(fill)`'s ask-fill factor). Separately,
`REACH_GRADE_CAP='B'` fires whenever ask-reach `< REACH_GRADE_CAP_FRAC=0.5` (`js/rating.mjs:109-110`),
capping the displayed LETTER on the identical signal. So a correctly top-*ranked* thin/reach-capped
pick can show a demoted letter a human skims past — a legibility false-negative (the sort order is
arguably fine; the letter mis-signals). `cappedBy` (R7, shipped) fixed cap *attribution*, not this
double-application. **Sequencing (Ben, 2026-07-24):** address this AFTER the audit's low-hanging fruit
(#1/#7 fetch-pool crowding). It's distinct from RF6 / PLAN-HOURLY-3DAY-TREND (those are thin-ticket
*instability* and 3-day-drift *decay*, not the rank-vs-letter reach double-count) — and it directly
informs the open "should ask-reach % feed the grade?" question: reach is ALREADY in the grade twice,
so the answer is a VISIBLE divergence cap, not a third continuous reach term. Folds naturally into
[G1](#g1--centralize-grade-caps-inside-rateitem-fix-f--land-first-calibration-free) (grade-cap
centralization) — the reach cap should key off the rank's already-priced reach, not re-derive it.

### FLAW 5 — TTF is the most-leveraged, least-measured input — **CONFIRMED, sharper than stated**
`rankScore` (`families.mjs:253-257`) divides by TTF; the header on the priors block
(`families.mjs:36-41`) states every estimator constant is "n≈0 on EVERYTHING." Verified further:
`ttfIntraday` (`families.mjs:170-178`) DOES have a real-velocity branch (`vel.medianFillSec`) —
but a repo-wide search for who populates `ctx.velocity`/`extra.velocity` in production found only
`pipeline/lib/velocitytag.mjs` and two TEST files (`pipeline/test/estimators.test.mjs`,
`pipeline/test/velocitytag.test.mjs`) — **no production surface** (`screen-flip-niches.mjs`,
`quote-items.mjs`, `watch-positions.mjs`) wires a real velocity read into `estimateRank`'s `extra`
today. So in production, TTF is ALWAYS the prior/floor branch, never a measured one — the flaw is
confirmed at its strongest possible reading, not a partial one.

### FLAW 6 — no evidence/sample dimension in the letter — **CONFIRMED**
`rateItem`'s signature (`rating.mjs:122`) takes `row, rank, activeWin, nWin, thin` — it never
receives `pFill.n` or `ttf.n`, even though every estimator already returns them
(`estR(value, n, basis)`, `families.mjs:63`). `confidenceFactor` (`rating.mjs:65-68`) is a partial
analog but is band-window-trade-count only (n of traded 5m windows), not the estimator's own
`n`. `THIN_GRADE_CAP` is a hard boolean cap (gp-flow-thin or not), not a shrinkage. So a thin-n
(`n=0`, pure prior) S+ and a deeply-measured (`n=14`, real reach-read) S+ are byte-identical in
the letter today — confirmed exactly as stated, with the precise gap (the `n` fields exist and
are simply never read by `rateItem`).

### FLAW 7 — two sources of truth (returned grade ≠ displayed grade) — **CONFIRMED**
`rateItem` applies `THIN_GRADE_CAP` internally (`rating.mjs:132`) — ONE cap lives inside. But at
the render site (`screen-flip-niches.mjs:977-985`) THREE MORE caps stack sequentially outside it:
`PHASE_BASING_GRADE_CAP` (rescued rows), `SUBFLOOR_GRADE_CAP` (sub-floor fallback rows), and
`REACH_GRADE_CAP` (low ask-reach). So a returned `grade` from `rateItem` is provisional — the
value actually shown/published can differ from what `rateItem` returned, and the split (1 cap in,
3 caps out) is exactly the ad hoc stacking described. Confirmed with the added precision of which
cap lives where.

### FLAW 8 (found, not in the original list) — cross-surface grade drift already exists, independent of any fix here
`js/market.js` (the app's Finder) calls the SAME `rateItem`/`estimateRank` (`market.js:4-5,206,210`)
but at a **different price basis**: the Finder comment says outright "COARSE here (live-quick-pair
basis, no per-item band)" (`ui.js:84`), vs. Scan's 2h-band `optBuy`/`optSell` pair
(`quotedPair`'s `'opt'` default, `families.mjs:245`). So the *same item* can show two *different*
letters on Scan vs. Finder **today**, before any change proposed here — a pre-existing
cross-surface consistency gap. This matters directly for Fix B (relative grading): if the letter
becomes percentile-based, the batch it's relative TO must be defined per surface, or cross-surface
drift gets worse, not better (see §7 Open questions).

### FLAW 9 (found, not in the original list) — `capitalFactor` and a deployable-capital fold would double-penalize big-ticket items
`capitalFactor` (`rating.mjs:57-60`) penalizes purely on per-unit PRICE (`mid`) as a crude proxy
for "capital committed" — it has no notion of how many units are actually deployed. The digest's
`deployUnits()`/`deployable` (`screen-flip-niches.mjs:556-557`, `valuescreen.mjs:200-208`) already
computes the REAL capital-at-risk (price × feasible position size, GE-physics-bounded). If Fix A
folds deployable units into the shared rank (so a big-ticket item's rank already reflects that it
can only deploy a few units), `capitalFactor`'s separate per-unit-price haircut becomes a SECOND,
redundant penalty for the same underlying fact (a big-ticket item ties up more gp per slot) —
compounding rather than complementing the fold. Fix A must retire or re-derive `capitalFactor` in
the same chunk, not leave it stacked on top of a now-capital-aware rank (see chunk G2 below and
open question O3).

### On the proposed fixes
- **(A) fold deployable units into ALL families' rank** — feasible; the exact machinery
  (`deployUnits`) already exists, is already `js/`-homed for app-importability
  (`valuescreen.mjs:1-6` header states this explicitly), and is already proven at the digest.
  Kills #1 (unit mismatch — every family now ranks realizable after-tax gp/day-on-deployed-capital)
  and #2 (grade and digest converge on the same basis). **Correction:** must retire/re-derive
  `capitalFactor` in the same chunk (Flaw 9) or it double-penalizes.
- **(B) relative/percentile grading** — feasible for Scan (large survivor pool per run) but **not
  well-defined for a batch of size 1** — the Finder computes `rateItem` for a single quoted item
  at a time (`market.js:210`), and the Watchlist for a handful. A percentile needs a reference
  distribution; neither surface has a natural "batch." **Refinement required:** fall back to a
  log-compressed absolute scale below a minimum batch size (see chunk G3), don't make percentile
  the only path.
- **(C) collapse `riskMult`** — cheap, calibration-free; also the right place to kill the
  momentum double-count (Flaw 4's undocumented half) and reconsider `capitalFactor` (Flaw 9).
- **(D) saturating TTF term** — cheap, calibration-free; bounds Flaw 5's leverage without needing
  real velocity data first.
- **(E) empirical-Bayes shrinkage** — feasible; the `n` fields already exist in `estR()`, they're
  simply not threaded into `rateItem` (Flaw 6) — this is a plumbing job, not new estimation
  machinery. Medium effort because it needs a per-family "how much n is a lot" reference, itself a
  judgment call, not simply "wire the number through."
- **(F) centralize caps inside `rateItem`** — feasible and cheap; do FIRST (see chunk ordering) so
  every later chunk edits one call site, not four.

**Recommendation validated:** A + B are the highest-leverage, but B depends on A landing first (a
percentile over an already-reconciled rank basis is meaningful; a percentile over today's
three-way-incommensurable rank is not). F is cheapest and should land BEFORE A/B so those chunks
don't also have to reconcile the cap-stacking bug. C/D are cheap calibration-free wins, sequenced
after A (C directly resolves Flaw 9, which A's landing creates/exposes). E is medium, independent,
can land anytime after F. Constant-tuning stays F1-gated throughout, never part of any chunk here.

## 3. Answers to the specific watch-fors in the brief

- **Does "relative" break the Finder's stable-letter expectation?** Partially moot — Flaw 8 shows
  the SAME item already renders different letters on Scan vs. Finder today (different price
  basis), so "one stable letter across the app" is not a currently-true property to protect. It IS
  worth protecting *within* a surface (the same Finder search shouldn't reshuffle letters between
  keystrokes) — chunk G3 addresses this via a per-surface-defined, not per-render, reference
  distribution (see G3's acceptance criteria).
- **Does folding deployable units double-count anything the digest already does?** Yes — see Flaw
  9. It also raises the question of whether the digest becomes redundant once the grade/rank carry
  the same basis; recommend the digest STAYS (its guaranteed-big-ticket-visibility slice and
  verdict-word triage are UX conveniences independent of the ranking basis) but its `rankKey`
  should degrade to reading the now-reconciled shared rank rather than recomputing `capEff ×
  deployable` a second time — flagged as an explicit open question (O2), not decided here.
- **Does any fix silently change `screen.json`?** Every chunk that touches `js/rating.mjs` or
  `js/estimators/families.mjs` changes the `grade`/`rank` strings a subsequent `--publish` writes
  into `screen.json` — those two files are IMPORTED BY THE APP (`js/market.js:4-5`), so this is
  never console-only. A chunk confined to `pipeline/commands/screen-flip-niches.mjs`'s cap-ordering
  (e.g. moving a cap call, not changing a cutoff) changes screen.json's DATA on next publish
  without changing deployed CODE — still worth flagging in the commit/CHANGELOG even though it may
  not need an `APP_VERSION` bump (see per-chunk table below for the exact call on each chunk).
- **The ripple map for `js/rating.mjs` being app-imported** — see §5, it's also true of
  `js/estimators/families.mjs` (confirmed via `market.js:4`, not just `rating.mjs`).

## 4. The honesty core (process rule 4 — read before touching any chunk)

1. **Structural vs. calibration, kept strictly separate.** Every chunk below (G1–G6) is
   STRUCTURAL: it fixes a dimensional/compounding/plumbing defect that holds regardless of
   whether any constant is later retuned. NONE of them claims to validate the grade against
   realized fills. A seventh bucket (G7, constant retuning from the retro-join) is named but
   explicitly NOT scheduled — it is F1-GATED and requires realized-fill sample sizes this repo
   does not have yet (the archive/retro-join is still accruing, per `js/estimators/families.mjs`'s
   own header, "n≈0 on EVERYTHING").
2. **Every constant this plan introduces or moves is a NAMED PLACEHOLDER with its `n` stated
   beside it**, exactly like the ones it's replacing (e.g. a new percentile-batch-size floor, a
   new saturating-TTF knee point) — never presented as tuned.
3. **Nothing here retires off one week of data**, and nothing here concludes "signal X predicts
   fills better than signal Y" — that conclusion belongs to F1/the retro-join, never to this
   refactor.
4. **Fixture-pinned, not vibes-pinned.** `pipeline/test/rating.test.mjs` already exists and pins
   STRUCTURE/ORDERING (not specific cutoff numbers) — every chunk extends it the same way: pin the
   new invariant (e.g. "a churn row's rank is now realizable-gp/day like every other family," "a
   percentile-graded batch is monotonic in rank," "shrinkage never promotes a low-n row above a
   high-n row with an equal raw score") without pinning a magic number as "correct."
5. **No chunk claims the two/three rankings' disagreement was "solved" in some absolute sense** —
   only that they now share one basis; residual disagreement (e.g. digest's verdict triage vs. the
   grade letter) is a UX-layering choice, not a bug, and is called out as such.

## 5. Ripple / registry map — every surface that renders a grade or rank

| Surface | File(s) | How it gets the grade/rank | App-imported? |
|---|---|---|---|
| Scan console table | `pipeline/commands/screen-flip-niches.mjs` (render loop ~L972-1009) | calls `rateItem` then stacks `capGrade` (rescued/subFloor/reach) | No (pipeline-only file) |
| Scan → `screen.json` → deployed app | same render loop, written via `--publish` | the STRING baked at render time | **Yes, indirectly** — screen.json is app-fetched data; its `grade`/`Rank` cell content changes whenever the render loop's grade computation changes, even though this file itself isn't imported |
| Deployed app Scan tab | `js/ui.js` `renderScan`/the `'Grade'` header special-case (`ui.js:341`) | reads the `grade` string FROM screen.json (no local recompute) | Yes (renders whatever screen.json says) |
| Deployed app Finder tab | `js/market.js` (`rateItem`/`estimateRank` calls, `market.js:5,4,210,206`), rendered by `js/ui.js` `renderFinder` (~L69-100) | **recomputes live** via the same `js/rating.mjs`/`js/estimators/families.mjs` modules, at the LIVE-QUICK-PAIR basis (`ui.js:84` comment) | **Yes, directly** — code import |
| Deployed app Watchlist tab | `js/ui.js` `renderWatch` (~L178-194), reads `it.desir.grade` | same live recompute as Finder (shares the `rawItem`/`desir` pipeline) | Yes, directly |
| Console decision digest | `screen-flip-niches.mjs` `collectDigestRow`/`buildDigestBlock` (~L496-619), `--digest`-gated | separate `capEff`/`rankKey` computation, reads `grade` as an input column only | No (stdout-only, `--digest`-gated, never written to screen.json per its own header comment L276) |
| `quote-items.mjs` / `watch-positions.mjs` | — | confirmed via grep: **neither imports `rating.mjs`** — they don't render a letter grade today | N/A |
| Fixtures | `pipeline/test/rating.test.mjs` (exists), no `families.mjs`-specific fixture found for `rankScore`'s unit-uniformity — `pipeline/test/estimators.test.mjs` exists and should gain the new invariant | — | — |

**One-definition rule for the implementer:** the SoT for the grade/score/cap logic is
`js/rating.mjs`; `pipeline/lib/rating.mjs` is a pure re-export shim (`pipeline/lib/rating.mjs:1-6`)
— never add logic there. The SoT for rank/TTF/pFill is `js/estimators/families.mjs`;
`js/estimators.mjs` and `pipeline/lib/estimators.mjs` are barrels/shims. Change ONE file per
concern; every consumer above updates automatically because they all import the same module (no
per-surface fork).

## 6. Chunks

Each chunk is independently shippable, carries its own `pipeline/test/*.test.mjs` extension, a
docs+README reconciliation pass in the same commit, and an explicit `APP_VERSION` call.

### G1 — centralize grade caps inside `rateItem` (Fix F) — *land first, calibration-free*
**Changes:** `js/rating.mjs` — extend `rateItem`'s options bag to accept the existing external
caps (`PHASE_BASING_GRADE_CAP`, `SUBFLOOR_GRADE_CAP`, the reach-fraction check that currently
drives `REACH_GRADE_CAP`) as optional inputs, applying all four caps (thin + these three) via one
internal `capGrade` chain in a fixed, documented order. `pipeline/commands/screen-flip-niches.mjs`
— replace the four scattered `capGrade` calls (lines ~977-985) with passing the same inputs into
the single `rateItem` call (~L972); no behavior change, a pure relocation.
**Acceptance:** extend `pipeline/test/rating.test.mjs` with a fixture asserting
`rateItem(...).grade` already equals what today's post-render capped value would be, for a
constructed row that trips two caps at once (order-of-application is now pinned, not incidental)
— diff the console output on a live-ish synthetic fixture before/after to prove byte-identical
render output. `node --check` both files; `node pipeline/ci/run-tests.mjs`.
**Docs:** `js/rating.mjs` header note the four-cap chain; `screen-flip-niches.mjs`'s comments at
the old call sites point to the new one (move, don't leave a stale duplicate comment — rule 8).
README: no new file, no inventory change (both files already registered) — just confirm the
"rating.mjs" description in README's module map still matches (it already says "grade/score
model").
**APP_VERSION:** bumps — this changes `js/rating.mjs`'s public behavior (app-imported).
**Console-only note:** none — this is not console-only, it's a code change to an app-imported
module even though the pipeline is the only *caller* of the newly-accepted options; the module
itself changed.

### G2 — dimensionally-uniform rank: fold deployable capital into every family (Fix A) — *the highest-leverage chunk*
**Changes:** `js/estimators/families.mjs` — extend `estimateRank`'s per-family `lapUnits` concept
(already present for churn/amplitude, `families.mjs:299` `est.lapUnits ? est.lapUnits(ctx) : 1`)
so band/value/rising ALSO compute a `lapUnits` off `deployUnits()` (imported from
`../valuescreen.mjs`, already `js/`-homed and app-safe) rather than defaulting to `1` — i.e. every
family's `rank` becomes "realizable after-tax gp/day on the capital you can actually park and
exit," not per-unit. `ctx` needs `capGp`/`limitVol`/`limit`/`buyLow` threaded in (some already
present — `volDay`/`limit` are already on `ctx`, `families.mjs:278`; `capGp` is new — degrades to
`deployUnits`'s existing null-safe behavior, `valuescreen.mjs:200-208`, when absent, so a caller
that doesn't pass capital keeps a units≡1-equivalent rank, NOT byte-identical to before but a
documented, deliberate behavior change).
**Also in this chunk (Flaw 9) — O3 RESOLVED: DELETE `capitalFactor`.** `js/rating.mjs` — remove
`capitalFactor` (`rating.mjs:57-60`) and its term in the `riskMult` product entirely. Ben's ruling:
at current capital, big-ticket lanes shouldn't be penalized for per-unit price — the deployable-capital
fold above is the only capital consideration, and it rewards (not penalizes) a big-ticket that deploys
fully. Reconcile the header comment in place (rule 8, not append). Fixture: a big-ticket row that
previously lost ~0.6× to `capitalFactor` now grades on its deployable throughput alone.
**Wire-up:** `pipeline/commands/screen-flip-niches.mjs` — pass `capGp: VALUE_CAPITAL` (the same
capital figure the digest already uses, `screen-flip-niches.mjs:556`) into the `estimateRank`
calls across ALL modes (today it's implicitly only reachable via the digest's separate
`collectDigestRow` path). `js/market.js` — the app-side call (`market.js:206`, `FINDER_SPEC` /
`estimateRank(FINDER_SPEC, row)`) needs a `capGp` too; recommend `STATE.bankroll`
(`js/state.js:54`, already exists, already used elsewhere for sizing) as the default, degrading to
shape-only (no `capGp`) if that's judged too coarse a proxy for the app's live single-item context
— Ben's call (open question O4), don't decide silently.
**Acceptance:** new fixtures in `pipeline/test/estimators.test.mjs` (exists) pinning: (a) a
churn-family rank and a band-family rank at equal realizable-gp/day inputs now compare
sensibly (same order of magnitude, not the old per-unit-vs-per-lap mismatch); (b) `capGp: null`
degrades every family to the pre-change per-unit rank (backward-compatible path, diff-proven byte
identical against the CURRENT fixture set with `capGp` omitted); (c) **O2 RESOLVED — `rankKey` retires:** the digest no longer recomputes its own
`capEff × deployable`; it SORTS off the shared grade `rank`. Delete the `rankKey` computation in
`collectDigestRow` and point the digest sort at the unified rank. There is now ONE ranking, so the
fixture pins that the digest ordering IS the grade-`rank` ordering (not two metrics forced into
agreement). The digest VIEW (guaranteed-visibility slice, verdict words) is otherwise unchanged.
`node --check`, `run-tests.mjs`, a `serve.cmd`+Playwright/browser smoke pass on the Finder tab (this
touches `js/market.js`).
**Docs:** `docs/MARKET-ANALYSIS.md` "Rank + grade" section (§`### Rank + grade`, currently states
"rank = net after tax × P(fill) ÷ TTF" per-thesis without the deployable-capital fold) — add the
fold, and grep the doc for any remaining "per-unit" framing that this supersedes, fix in place.
README: update the `rating.mjs`/`estimators` module-map entries (already reference `deployUnits`
at line ~163, "extracted (byte-identical) so the screen's decision digest can reuse the SAME
deployable-capital shape" — reconcile this to say the GRADE now reuses it too, not just the
digest). CLAUDE.md: no ask→command table change (this is an internals fix, not a new workflow).
**APP_VERSION:** bumps (both `js/rating.mjs` and `js/estimators/families.mjs` are app-imported).
This is the highest-risk chunk for a live-browser regression — the mandatory smoke test is not
optional here.

### G3 — invocation-independent, per-mode-normalized grading (Fix B, refined by O1) — *depends on G2 landing*
**BEN'S O1 RULING (2026-07-21) — read first, it rules out the naive draft.** The grade MUST be
**invocation-independent**: the same item gets the same letter whether it appears in a single-mode
run or inside `--mode all`. That KILLS the "percentile within the live batch" mechanism the draft
proposed — a live-batch percentile drifts with cohort composition (band-alone's 30 rows vs
band-in-all's 38 rows move the same item's percentile). The reference must be **per-mode and STABLE
across runs**, not the transient set of items in this invocation. Letters stay comparable ACROSS
modes (G2 already made the scores comparable; each mode's stable reference maps them to the SAME
letter semantics). Determinism invariant: `grade(item) = f(item.score, stable_per_mode_reference)` —
never a function of what else ran this pass.
**Changes:** `js/rating.mjs` — grade a (log-compressed, per Fix B) score against a **stable per-mode
reference distribution**, NOT the current batch. The reference is the open sub-decision below; both
candidate mechanisms are pure functions of (score, reference) → deterministic. Keep the absolute-cutoff
path only as the cold-start fallback when no reference exists yet (a newly-added mode with no archive).
`pipeline/commands/screen-flip-niches.mjs` — supply the per-mode reference at render time (loaded, not
recomputed from the live pool).
**Sub-decision this chunk must force (new, from O1) — what IS the stable per-mode reference?**
(a) a ROLLING per-mode score distribution from the daily archive (self-maintaining, deterministic
given the archive, adapts slowly) → percentile the item against it; or (b) per-mode CALIBRATED FIXED
cutoffs (set once from the historical per-mode distribution — absolute again, but per-mode-tuned so it
does NOT clump like the current one-table cutoffs). *Recommend (a)* — invocation-independent AND
self-updating, no manual recalibration, and it composes cleanly with G6's shrinkage / G7's retune.
Both satisfy Ben's invariant; pick at build time.
**Acceptance:** fixture pinning (a) **invocation-independence (O1's invariant): the same item +
same reference yields the SAME letter whether graded alone or amid a larger pool** — the primary
pin; (b) monotonicity (never a worse letter for a higher score against the same reference);
(c) cold-start fallback is byte-identical to today's `gradeFor` when no reference exists;
(d) a severely-skewed reference no longer clumps modest scores at the bottom cutoff — pin the SHAPE
improvement, not a specific letter. Must NOT regress G1's cap-centralization (caps still apply after
the score maps to a letter, same chain).
**Docs:** `docs/MARKET-ANALYSIS.md` "Rank + grade" — document that a letter means "this item's
standing against its mode's stable reference," identical across runs (O1), and that Scan and Finder
now share that meaning (closes Flaw 8's accidental cross-surface divergence rather than formalizing it).
**APP_VERSION:** bumps (`js/rating.mjs` changed; Finder/Watchlist + Scan grade semantics change).
**O1 — RESOLVED (Ben, 2026-07-21):** per-mode reference, normalized so letters are comparable across
modes AND identical whether run alone or in `--mode all`. The remaining choice is the reference
MECHANISM (rolling archive vs calibrated fixed cutoffs, above), not the batch-scope question — which
is now moot, since the grade is no longer scoped to the live batch at all.

### G4 — collapse `riskMult` + kill the momentum double-count (Fix C) — *cheap, cleanup after G2*
**O6 RESOLVED (Ben, 2026-07-21): geometric mean, pending testing.** `js/rating.mjs` — normalize the
now-4 factors (regime, mom, liq, confidence — `capital` was deleted in G2) via a **geometric mean**
instead of the raw product, softening the compounding (`0.85⁴≈0.52` product → geometric mean ≈ 0.85)
without deleting any signal. The fuller 2–3-factor collapse (merge `mom`→`regime`, `liq`→`confidence`)
is a DEFERRED G4b, run only if testing shows the geometric mean insufficient. Either way: remove the
momentum double-count identified in
Flaw 4 — `momFactor`'s breakdown penalty (`rating.mjs:41`) and `pFillIntraday`'s
`PFILL_BREAKDOWN_PENALTY` (`families.mjs:74,111`) currently both fire off the identical
`mom==='breakdown'` signal; pick ONE home for it (recommend keeping it in `pFillIntraday` since
that's inside the rank the grade already multiplies by, and removing `momFactor`'s breakdown
branch specifically, leaving `momFactor`'s breakup-chase-risk branch untouched since nothing else
covers that).
**Acceptance:** extend `pipeline/test/rating.test.mjs`'s existing riskMult-product fixture (test
#4, `rating.test.mjs:73-83`) to assert the NEW factor count/shape and that a breakdown row is
penalized exactly once end-to-end (score-level assertion spanning both `rateItem` and
`estimateRank`, since the double-count spans two modules).
**Docs:** `js/rating.mjs`'s "MILD OVERLAP NOTE" header comment (`rating.mjs:16-18`) — reconcile in
place: it currently says the overlap is "kept because regime/momentum/capital/confidence still
carry quality signal" — update to reflect which overlap was actually removed vs. kept.
**APP_VERSION:** bumps.

### G5 — bound TTF's leverage with a saturating fill-speed term (Fix D) — *cheap, calibration-free*
**Changes:** `js/estimators/families.mjs` — `rankScore` (`families.mjs:253-257`) currently divides
by raw `days` (floored at `TTF_FLOOR_DAYS`). Replace the raw division with a saturating
transform (e.g. `1/(days + K)` or a clamped `1/days` beyond some ceiling) so an extreme low-TTF
value can't unboundedly inflate the rank — this bounds Flaw 5's leverage WITHOUT needing the
velocity data that would actually validate TTF (that's G7/F1-gated). Name the new saturation
constant as a placeholder (n≈0).
**Acceptance:** fixture proving the new transform is monotonically decreasing in `days` (an item
that fills slower never ranks higher, preserving the intent) AND bounded (a fixture with
`days → TTF_FLOOR_DAYS` no longer produces an unbounded rank blowup vs. a fixture with a
"normal" TTF).
**Docs:** `families.mjs`'s `rankScore` doc comment (`families.mjs:248-252`) — update "PER-UNIT…"
description to note the saturation; `docs/MARKET-ANALYSIS.md` rank/grade section.
**APP_VERSION:** bumps.

### G6 — a `(thin)` confidence MARKER on the letter (Fix E, reshaped by O5) — *medium, independent, land anytime after G1*
**O5 RULING (Ben, 2026-07-21): mark, don't shrink.** Do NOT perturb the score with an empirical-Bayes
shrinkage — that's a magic number that moves a real grade. Instead, when confidence is poor, annotate
the letter with a `(thin)` denotation (letter unchanged). More honest and fully deterministic (no
score math, so no interaction with G3's stable-reference grade or G5's TTF term).
**Changes:** `js/rating.mjs` — `rateItem` accepts the `n` already computed on the reach/pFill reads
(the agent confirmed `estR()` returns `n` everywhere; `rateItem` just never receives it — Flaw 6) and
sets a `thinConfidence` flag when `n` is below a NAMED PLACEHOLDER floor. The render layer appends
`(thin)` to the letter when the flag is set (parallel to how the existing gp-flow `thin` cap already
annotates). `pipeline/commands/screen-flip-niches.mjs` — pass `er.pFill.n`/`er.ttf.n` into the
`rateItem` call (~L972; values already computed, discarded today — the `windowExit`-shadow discovery
pattern).
**INVESTIGATION THIS CHUNK MUST DO FIRST (Ben's O5 question — "shouldn't we be using our percentile
measurements here?"):** scope, before implementing, whether the confidence trigger should be pure
sample-`n` or also incorporate the percentile/placement reads. Working hypothesis to confirm-or-refute
with evidence: `placement` measures a price's POSITION in the distribution, NOT the sample size behind
it — so the `nDays`/recent-3 counts are the right confidence signal, and placement is orthogonal. But
test whether distribution SHAPE (IQR width / concentration around the level) adds real confidence
signal a raw `n` misses. Write the finding into the chunk before coding the trigger; do not guess.
**Acceptance:** fixture proving (a) a thin-`n` row gets `(thin)` while a high-`n` row at the identical
score does NOT (kills the "byte-identical S+" gap Flaw 6 named) — a MARKER assertion, the score/letter
itself is unchanged by the flag; (b) the marker never alters the letter or its ordering.
**Docs:** `js/rating.mjs` header — add the `(thin)`-marker note beside the existing `THIN_GRADE_CAP`
honesty block (`rating.mjs:84-101`), and reconcile that the gp-flow `thin` and this confidence `thin`
are DIFFERENT triggers sharing a label (grep for the existing NY2.4 "two different thins" note and
extend it, don't contradict it); README's `rating.mjs` inventory entry.
**APP_VERSION:** bumps (render change).

### G7 — constant retuning from the retro-join — **NOT SCHEDULED, F1-GATED, named only**
Once G1-G6 land and the retro-join (`pipeline/lib/retrojoin.mjs`) has accrued enough realized-fill
samples against the NEW (reconciled) rank/grade basis, `GRADE_CUTOFFS`, `TTF_*` priors,
`WEAK_DEPLOY_ROI_PCT`, and every other named placeholder touched above become calibration
candidates. This bucket is explicitly OUT OF SCOPE for this plan — it is listed so a future
implementer doesn't mistake G1-G6 (structural, calibration-independent) for having already done
this work.

## 7. Open questions / decisions for Ben (list only — don't action unprompted)

- **O1 — RESOLVED (Ben, 2026-07-21): grades must be invocation-independent.** The letter is
  normalized against a **stable per-mode reference**, comparable across modes and IDENTICAL whether an
  item is graded in a single-mode run or inside `--mode all`. This rules OUT live-batch percentile
  (cohort-dependent → non-deterministic); see G3 (rewritten). New sub-decision surfaced: the reference
  MECHANISM — rolling per-mode archive distribution (recommended) vs per-mode calibrated fixed cutoffs.
- **O2 — RESOLVED (Ben, 2026-07-21): `rankKey` retires.** Ben's framing: "if we graded correctly in
  the first place we wouldn't need this correction; the grades should take this into account." So
  post-G2 the unified grade/rank IS the correct deployable-throughput ranking — the digest's separate
  `capEff × deployable` recomputation is redundant and is removed. The DIGEST VIEW survives (its
  guaranteed-visibility slice + verdict words are UX), but it **sorts off the shared rank**, not its
  own `rankKey`. G2's acceptance (c) becomes: the digest ordering == the grade `rank` ordering because
  there is now ONE ranking, not two that must be pinned into agreement.
- **O3 — RESOLVED (Ben, 2026-07-21): DELETE `capitalFactor` outright.** "We're at capital now where
  we can afford to deploy into multiple big-ticket lanes at once — they shouldn't be penalized." The
  per-unit-price penalty is removed entirely (not re-derived); G2's deployable-capital fold is the
  ONLY capital consideration, and it rewards a big-ticket that deploys fully rather than penalizing it
  for being expensive. Removes the Flaw-9 double-penalty by deletion.
- **O4 — RESOLVED (Ben, 2026-07-21): the Finder's `capGp` uses the live-derived `deployablePool`,
  NOT static `STATE.bankroll`.** The app grade becomes capital-aware and consistent with the console,
  closing the Scan-vs-Finder basis gap (Flaw 8) rather than reopening it. **Implementation constraint
  for G2/Opus:** `deployablePool` is pipeline-derived (`lib/derive-cash-tiers.mjs`) and the in-browser
  Finder cannot run that derivation — so the value must be PLUMBED to the app (write the current
  `deployablePool` into `screen.json` at publish time and have the Finder read it, falling back to
  `STATE.bankroll` only when the field is absent/stale). This is the one place O4 touches app fetch
  plumbing; pin a fixture that the Finder grade is byte-identical to the console grade for the same
  item + same `capGp`.
- **O5 — RULED (Ben, 2026-07-21), with an investigation flag: MARK `(thin)`, don't shrink the score.**
  Prefer an explicit `(thin)` denotation on a low-confidence letter over silently perturbing the score
  (G6 is reshaped accordingly — marker, letter unchanged; more honest + deterministic than a magic
  shrinkage). The trigger is low `n` in the reach/pFill sample (already computed — the agent confirmed
  `estR()` returns `n` everywhere; `rateItem` just never receives it). **Open investigation Ben raised:
  "shouldn't we be using our percentile measurements here?"** — worth a proper look. Working read:
  `placement` percentile measures a price's POSITION in the distribution, not the SAMPLE SIZE behind
  it; the `nDays`/recent-3 counts that ride alongside every placement read are the actual confidence
  signal. But whether the distribution's SHAPE (e.g. IQR width / concentration) should also feed the
  `(thin)` trigger is genuinely open — G6 must scope this investigation before implementing, not guess.
- **O6 — RESOLVED (Ben, 2026-07-21): geometric-mean normalization, pending testing.** Start with
  option (b) — normalize `riskMult` via a geometric mean instead of the raw product (softens the
  0.85⁵≈0.44 compounding without deleting any signal) + remove the momentum double-count. The fuller
  2–3-factor collapse is deferred to a G4b only if testing shows the geometric mean is insufficient.

## 8. Hand-off notes for the Opus implementer

- **Recommended first chunk: G1.** It is the smallest, purely mechanical (a relocation, not a
  behavior change — pin that with a byte-identical-output diff), and it gives every subsequent
  chunk ONE call site (`rateItem`) to extend instead of four scattered ones.
- **G2 is the linchpin and the highest-risk chunk.** Before starting it, re-read
  `js/valuescreen.mjs`'s `deployUnits` header in full (it already documents the exact GE-physics
  three-way min this chunk reuses) and `screen-flip-niches.mjs`'s `collectDigestRow`
  (~L551-575) as the working reference implementation of "how to thread capital into a rank" —
  don't re-derive that shape, port it.
- **Validation discipline (CLAUDE.md process rule 2, non-negotiable for G2/G3 especially):**
  `node --check` every touched file; `node pipeline/ci/run-tests.mjs`; then an ACTUAL browser
  check — `serve.cmd` + either a manual look or the Playwright/chromium approach from the 2026-07
  restructuring session — on the Finder tab AND the Watchlist tab (both recompute grades live via
  `js/market.js`) before calling either chunk done. A syntax-clean `node --check` pass does not
  catch a cross-module rank/grade regression; this repo has a specific prior incident (the
  `momVerdict` reconciliation, per CLAUDE.md's own citation) for exactly this failure class.
- **Byte-parity checks where a chunk claims backward-compatibility.** G2's `capGp: null` fallback
  and G1's cap-relocation both claim "byte-identical to today" for their respective default paths
  — prove it with an actual diff of console stdout / a synthetic `screen.json` before vs. after on
  a fixed seed row set, not just a fixture assertion. Don't ship a "should be identical" claim
  unverified.
- **`--publish` discipline.** G2/G3/G4/G5/G6 all change what a subsequent `--publish` writes to
  `screen.json`. Don't run `--publish` from a dev/test pass of any of these chunks — that's the
  once-a-day `/overnight` `sync-fills.mjs --publish` path per CLAUDE.md rule 6; a chunk's own
  verification should diff STDOUT / a throwaway `--no-publish` JSON dump, never the real
  `screen.json`.
- **Every chunk's docs pass is not optional (rule 8).** `docs/MARKET-ANALYSIS.md`'s "Rank + grade"
  section currently describes the PRE-this-plan basis in present tense — each chunk that ships
  must grep that section (and README's `rating.mjs`/`estimators` entries) for now-superseded
  phrasing and fix it in place, not append a second, contradicting paragraph.
- **Fold-out discipline.** When G1-G6 (or whichever subset Ben approves) all ship, fold this file's
  chunks into `PLAN.md`'s Status table with their shas and DELETE this file, per the standing
  per-topic-plan convention (see `PLAN-WINDOW-CLEAR-OUTCOMES.md`'s own header for the precedent).

## 9. Minimum shippable

G1 alone is a real, low-risk improvement (one source of truth for the displayed grade). G1+G2 is
the plan's actual payoff — the two/three-ranking disagreement this whole effort exists to fix.
G3-G6 are each independently valuable but none is required for G1+G2 to be a coherent, shippable
improvement on their own.
