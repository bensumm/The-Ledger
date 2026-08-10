# PLAN-REACH-HORIZON — the reach window: label the basis, defer the change

**Status:** HARDENED 2026-08-09 (Fable adversarial pass over the 2026-08-09 scoping draft). Build-ready
for Chunks 1–2; Chunk 3 is explicitly BLOCKED and says on what. The scoping draft's central claim
("the mismatch runs in both directions") **failed verification** — both directions, independently, and
the measurement below inverts its per-niche speculation. The hardened plan is smaller than the scoped
one on purpose: the null option won on evidence.

---

## 1. The finding that opened this

From the 2026-08-08/09 validator forward-scoring pass (PLAN.md "Discovered"):

> `reach` is INFORM-ONLY everywhere and excludes nothing — 27,799 firings shaping prices, weak
> discrimination (reject 55.9% vs caution 62.2% @8h) and an 8h window applied to 1–2 day theses:
> **18.2% of scored levels printed within 48h but not within 8h**. STILL OPEN — the horizon mismatch
> is real and unaddressed; scoring it properly needs a fill model, not a print model.

The scoping draft reframed this as "the window is mismatched to the thesis, in both directions:
8h flatters band's ~2h thesis; 24h understates value's multi-week thesis." **That reframe does not
survive contact with the code.** What survives is narrower and is stated in §2–§3.

## 2. Verification results — what the tree actually says

**Verified and correct** (all re-checked against source 2026-08-09):

- The per-candidate override exists and is used: `js/validate.mjs:122-123` reads
  `cand.windowHours`/`cand.nights` before `REACH_WINDOW_HOURS`(8)/`REACH_NIGHTS`(14) (`:67-68`).
- Per-niche assignments: band/churn/scalp carry no `window` (default 8h — `js/flip-niches.mjs:261,
  :271, :289`); value and amplitude declare `{ windowHours: 24, nights: 14 }` (`:311`, `:366`).
- The §4 consumer map: fold price + displayed P(fill) are full-window basis (`js/estimators/pair.mjs:128,
  :266`, the 0.71.3 flip); the rank term is `askReachFactor` (`js/estimators/reach.mjs:125`); the two
  still-recent-preferring surfaces are real (`pipeline/commands/screen-flip-niches.mjs:805` digest column,
  `pipeline/commands/watch-positions.mjs:260` relief note); `read-window-range.mjs:645` prints the
  recent-3 figure as a labelled parenthetical, not a swap.
- The settled REACH_CAUTION_FRAC ground (§7 constraints) matches the `reachValidator` docblock verbatim.

**Failed verification — the two table entries the draft asserted from a grep:**

1. **band "~2h thesis" is not a declared thesis horizon.** The tree carries THREE conflicting
   statements about band's hold horizon, none of them a measurement:
   - `DRIFT_INTRADAY_HOLD_DAYS = 2/24` (`js/flip-niches.mjs:81`) — but its own comment says it is a
     **named placeholder anchored to the 2h PRICE GRAIN** (the Bar-E `BAND_HOURS` edge window), chosen
     "rather than invented fresh". The 2h band is the window the *price levels are computed over*, not
     how long the flip holds.
   - The registry's own `window` doctrine (`js/flip-niches.mjs:215-217`) declares the 8h default AS
     "a band/scalp **8h flip window**" — i.e. by declaration, 8h *is* the thesis horizon.
   - The original PLAN.md finding says "1–2 day theses".
   The draft's "window is ~4× the thesis — flatters" picked the first statement and ignored the other
   two. Worse, the same 2/24 constant covers churn and scalp identically, yet the draft's table called
   those "plausible; unexamined" — internally inconsistent, the tell of a quick-grep assertion.
   **Honest state: band/churn/scalp's hold horizon is UNDECLARED.** There is no number to match a
   window to, so "8h flatters band" is unsupported.
2. **value's 24h window is not an understatement — it is a different question, deliberately.**
   `js/flip-niches.mjs:305-307`: value keeps reach "as a full-day week+ daily-min **TIMING** read
   (windowHours 24 / 14 nights), not an 8h flip check: it finds WHEN the recent-week low prints so the
   entry is timed." It scores the *entry*, not the multi-week exit. Additionally value never consumes
   `askReachFactor` at all (fillShape `'symmetric'` is exempt from the ask-reach rank discount;
   priceBasis `'term'`; rank `'value'`), so its reach read is inform display only. Lengthening it to
   "multi-week" would (a) destroy the timing read (a window spanning the whole cycle saturates to 1 —
   informationless) and (b) is **mechanically impossible** — see the seam limit below.

**Two more corrections found while verifying:**

- **The seam cannot express any horizon > 24h.** `reachValidator` computes
  `wEnd = (wStart + windowHours) % 24` (`js/validate.mjs:124`) and `windowStats` buckets by clock
  window within a day (`js/windowread.mjs:255-284`, `inWindow` at `:24`). `windowHours: 24` means
  "full day"; `windowHours: 48` wraps mod 24 and silently produces the same full-day read. The
  draft's Option A ("declare the thesis horizon on every spec") is not just unvalidated — for any
  multi-day horizon it is *inexpressible* without new machinery. The study's own 48h outcome could
  only be computed by archive replay, never by this seam.
- **Citation misattribution:** the spec's `window` merges into the reach candidate in
  `runValidators` (`js/validate.mjs:562-565`), not at `js/flip-niches.mjs:475` — that line is the
  test-only conformance whitelist in `validateNicheSpec`.

## 3. The measurement — per-niche decomposition (run 2026-08-09, read-only replay)

Method: streamed `suggestions.jsonl` + `pipeline/suggestions-archive/*.jsonl` (95,905 rows), parsed
every logged `reach` firing from its reason string (`ask <level> reached only h/nd` — the ledger's
lean entries drop the evidence object, so the reason string and the row's `mode` are the only basis
carriers; see Chunk 2), and forward-scored each against the /1h archive (readonly), flat
`(ts, ts+8h]` / `(ts, ts+48h]`, print = `avgHighPrice ≥ level` (asks), requiring full 48h coverage.
28,300 firings parsed; 25,929 scored.

| Lane | n scored | % printed ≤8h | % printed ≤48h | % gap (48h-not-8h) |
| --- | --- | --- | --- | --- |
| band | 22,760 | 36.7 | 64.0 | **27.3** |
| churn | 2,792 | 44.0 | 73.7 | **29.7** |
| quote (no mode) | 330 | 36.7 | 55.5 | 18.8 |
| scalp | 30 | 36.7 | 66.7 | 30.0 |
| **value** | **0** | — | — | — |
| **amplitude** | **0** | — | — | — |
| ALL | 25,929 | 37.5 | 64.9 | 27.4 |

Robustness: deduped by (item, side, level, calendar-day) → n=8,111; band gap 27.0, churn 26.5 —
the repeated-scan autocorrelation does not create the effect. My aggregate gap (27.4%) is larger
than the study's 18.2% because the denominators differ (all parseable firings with 48h coverage vs
the study's 6,016-row scored set); the direction and the per-niche structure are the durable part.
Both are PRINT rates — upper bounds on fill, per §4 — and n-honesty applies: these describe the
logged non-pass firings only (a `pass` is never logged, so there is still no control arm; this
replay rebuilds outcomes, not the missing pass arm).

**Findings:**

1. **The draft's speculation is exactly backwards.** It guessed the aggregate "may well be carried
   almost entirely by the long-thesis lanes." Measured: the long-thesis lanes contribute **zero rows**
   — value logged no validators until 2026-08-08 and amplitude's validators sit dormant in the
   console path (`js/flip-niches.mjs:360-363`). The 18.2% is a **band+churn ask-side phenomenon**
   (~99% of scored mass), and the gap rate is roughly uniform across the short lanes (~27–30%), so
   the aggregate is not a composition artifact of lane mix either.
2. **Every logged reach firing is ask-side.** The bid-leg reach check runs as a separate inform call
   (`screen-flip-niches.mjs:1233-1236`) whose result feeds display but does not reach the row's
   logged `validators`. The ledger's reach track record is asks only — a measurement constraint to
   record, and Chunk 2's business.
3. **"The horizon mismatch is real" cannot currently be evidenced for the lanes it was hypothesised
   about.** For band/churn — the lanes that dominate the data — whether 8h is "too short" is
   undecidable without knowing (a) how long Ben's asks actually rest (undeclared, disputed in-tree)
   and (b) a fill proxy (does the 48h-only print cohort *fill* resting offers at a usefully higher
   rate?). Neither exists. For value/amplitude it is unmeasurable from the ledger, full stop.

## 4. THE TRAP, re-examined — when is a longer window honest?

The draft's trap: "lengthening the horizon inflates reach monotonically and without bound, while
true fill probability does NOT rise proportionally — so a longer window makes every number more
flattering and less true." Attacked, this splits into a right half and two wrong halves:

- **Right:** the print rate is monotone non-decreasing in the window (a superset window can only add
  hits). And a *silent* substitution of a longer window under consumers informally calibrated to 8h
  numbers would flatter every quoted price. That half stands and binds Chunk 3.
- **Wrong ("without bound"):** it is bounded by 1, and the bound is the actual failure mode —
  **saturation**. As W grows the fraction compresses toward 1 (band: 36.7% → 64.0% from 8h → 48h)
  and the term stops discriminating between items. The cost of a long window is measurable signal
  compression, not unbounded flattery.
- **Wrong ("less true"):** `P(fill within W)` is *also* monotone in W — an offer resting 48h really
  is more likely to fill than one resting 8h. A 48h print rate is not "less true" than an 8h one;
  it is the upper bound of a *different event*. Whether the print→fill bias worsens with W is
  **unmeasurable from current data** (no suggestion→fill join) — the draft asserted it; we don't
  know it, in either direction.

**The defensible construction under which a longer window IS honest** — all three conditions, jointly:

1. **Behavioral match:** W equals the duration the offer will actually rest (which is a fact about
   how Ben trades, not about the thesis label — and is currently undeclared).
2. **Basis labelling:** every printed reach number names its window, so no consumer — human or
   downstream code — can mistake a 48h fraction for an 8h one. `reachValidator`'s own docblock
   (`js/validate.mjs:102`) already states "cross-surface comparison of raw reach tokens is invalid
   without naming the window basis" — and today **no surface names it**. That is the actual
   honesty bug, and it is shippable without touching any number.
3. **Joint re-scaling:** the rank is `net × P(fill) ÷ TTF`. Widening the window moves P(fill) up
   while TTF and the capital-lockup it stands for stay 8h-shaped — the rank would inflate with no
   economic change. A horizon change is only coherent if every horizon-dependent term moves to the
   same basis together. (This is a sharper form of the trap than the draft's: the window is a free
   parameter *only when moved on one term at a time*.)

So the honest reframe: **the window is not too short or too long — it is unlabelled, and any change
to it is undecidable without a fill proxy.** That conclusion selects the option below.

## 5. Options, costed — and the recommendation

**A. Per-niche horizon = thesis horizon. REJECTED (now).** Three independent blockers: the thesis
horizons it would copy from don't exist for band/churn/scalp (§2 — three conflicting in-tree
statements, no measurement); horizons > 24h are inexpressible in the seam (§2, the mod-24 wrap);
and it moves the fold price + rank on zero fill evidence, violating the visible-comparison ship
pattern (`gate-on-error-cost-not-n`). Its value/amplitude half is additionally wrong in kind —
their 24h windows are deliberate entry-timing reads, not deficits.

**B. Multi-horizon display. REJECTED as a build; absorbed as labelling.** It half-exists already:
the validator's clock-anchored coming-8h read, quote's full-day read (`windowStats` wStart 0), the
day-level 14-night `asymPair` pAsk on band/scalp, and the fold line's `P(fill)~X% (recent-3 Y%)`
comparison. A third computed horizon adds surface noise with no decision rule for choosing among
them. The real gap is that none of the existing horizons is *named* on the surface — which is
Option C done properly, not a new computation.

**C. Label the basis; change no number. RECOMMENDED — and earned, not assumed.** The null option
wins on the evidence of this pass: the motivating table failed verification in both directions
(§2), the measured aggregate belongs to lanes whose correct window is undecidable without a fill
proxy (§3), and the honesty analysis (§4) locates the actual bug in the missing label, not the
window length. Cost: a reason-string token + surface labels + doc pass; zero numeric movement;
zero risk. It also *improves the data*: the window token flows into the ledger's lean reason
string for free, ending the mode-inference this pass's measurement had to do.

**D. Hazard-rate normalisation. REJECTED.** It erases the clock-anchoring that is the deliberate
core of the windowread design (prints cluster diurnally — a constant-rate hazard is the one model
the data already refutes), it is the largest build, and a per-hour print hazard is still a print
model — the same trap in fancier units.

**E. (added) Ledger instrumentation.** Cheap, makes the next measurement honest: carry the window
basis explicitly in the logged reach entry, and fix or document the ask-only logging of the bid
leg (§3 finding 2). Sampled pass-logging (a 1-in-N control arm) is the only way the ledger ever
gets a real pass arm; propose it, cost it against ledger size, let Ben decide.

**F. (added, deferred) The fill-proxy-gated horizon decision.** The change the original finding
actually wants, correctly blocked: no window move until the suggestion→fill join exists (tracked
separately, acknowledged blocker on ALL P(fill) calibration) and the §4 conditions can be met.

## 6. Chunks (each names its doc-reconciliation pass — CLAUDE.md rule 8)

**Chunk 0 — measurement. DONE (this pass, 2026-08-09).** Results in §3; scratch script (not
committed) replayed the ledger against the readonly /1h archive. No repo files touched.

**Chunk 1 — window-basis labelling (Option C). SHIP FIRST.**
- `reachValidator`'s reason string gains the window token: `ask 38000 reached only 0/14d @8h`
  (and `@24h` where a spec's window applies). The token thereby enters every surface note and —
  via `leanValidators` (`js/validate.mjs:598-605`, which keeps only key/status/reason/mode) —
  the suggestions ledger, for free.
- Name the basis where reach numbers print without one: the `--digest` reach column header and
  `watch-positions`' relief note additionally gain a `recent-3` marker (they prefer the recent
  basis — §7), and `read-window-range`'s fold line already labels both bases (no change).
- **Numbers that move: NONE.** This chunk changes labels only; fold, rank, grade, screen.json are
  byte-identical. If any ledger-parsing consumer (analyze-record) greps reach reasons, update its
  pattern in the same commit.
- Doc-reconciliation: `docs/MARKET-ANALYSIS.md` (reach token description gains the basis token);
  `js/validate.mjs` docblock (the :102 warning becomes "…and every surface now names it");
  `docs/GLOSSARY.md` if it defines the reach token; **PLAN.md "Discovered"** — correct the reach
  entry in place: the 18.2% is measured as a band/churn ask-side aggregate (the "1–2 day theses"
  and any carried-by-long-lanes reading are superseded by §3); CHANGELOG entry. APP_VERSION: none
  expected (validate.mjs is not yet app-imported; verify with `check-imports`/grep before landing
  and note "pipeline-only" in the commit per rule 5).

**Chunk 2 — ledger completeness (Option E). SHIP SECOND, small.**
- Decide the carrier: the `@Nh` reason token (Chunk 1) may be sufficient; if not, add
  `windowHours` as a field on the lean reach entry (one line in `leanValidators` or at the reach
  push site — measure the ledger-size cost first, it is ~14 bytes/firing).
- The bid-leg reach inform result (`screen-flip-niches.mjs:1233-1236`) never reaches the logged
  `validators`: either fold it in (preferred — it is the entry-side track record) or pin a comment
  + doc line stating the ledger's reach record is ask-only. Decide in-build; don't leave it tacit.
- Propose (do not silently ship) sampled pass-logging: 1-in-N reach passes logged with a
  `sampled:true` marker — the only path to a real control arm inside the ledger. Ben decides N or
  vetoes; costed against ledger growth.
- **Numbers that move: NONE** (logging shape only).
- Doc-reconciliation: `docs/FLOW.md` (suggestions row shape), `pipeline/FILLS-PIPELINE.md` only if
  it describes the ledger row (verify), README inventory entry for `suggestions.jsonl` if its
  contract line changes, `js/validate.mjs` leanValidators comment.

**Chunk 3 — the horizon decision. BLOCKED; do not build.** Reopens only when the suggestion→fill
join exists. The decision rule, pre-registered here so it can't drift: a window change for a lane
requires (a) a declared resting duration for that lane's offers (ask Ben — it is a behavioral
fact, not a code fact), (b) fill-proxy evidence that the wider window's extra prints convert to
fills at matched levels, and (c) the §4 joint re-scaling — P(fill) and TTF move to the same basis
in the same commit, shipped as a visible comparison (both numbers printed) for at least one
review cycle before any silent swap. Until then, Chunk 1's labels stand and the 8h default is
declared for what it is: a labelled placeholder, not a thesis statement.

## 7. The two still-recent-preferring surfaces — position: DEFER to RB-4, label only

The `--digest` reach column (`screen-flip-niches.mjs:805`) and `watch-positions`' relief note
(`:260`) prefer the recent-3 basis while fold + rank read full-window. This is a *recency-basis*
split, not a *window-length* split — an orthogonal axis, and a **deliberately decided** one: the
rank call site is pinned full-window pending fills-joined evidence (RB-4, deferred; the measured
>33%-rank-movement rationale is in `js/estimators/reach.mjs:114-124`). Folding a basis flip into
this plan would relitigate settled ground (§8). Chunk 1 gives both surfaces an explicit `recent-3`
label; their basis choice itself stays with RB-4.

## 8. Constraints (carried over — all still binding)

- **CLAUDE.md rule 4.** Every number in §3 is a print-rate over logged non-pass firings — an upper
  bound with no pass arm. Nothing here is calibrated; nothing in Chunks 1–2 claims to be.
- **No fill data exists.** No suggestion→fill join; the acknowledged blocker on all P(fill)
  calibration, tracked separately. Chunk 3 is gated on it by construction.
- **Don't re-litigate settled ground.** REACH_CAUTION_FRAC is measured-and-closed ("no cut point
  earns much; the signal is continuous and lives in the rank") — this plan touches the WINDOW's
  label, never the threshold. RB-4 (rank recency basis) stays deferred (§7).
- **The RB-3 invariant survives:** fold price and the P(fill) beside it declare the same basis.
  Chunk 1 extends the same principle to the window axis.
- **Reach stays inform-only everywhere.** It is measurable *because* it never drops rows — the
  cross-cutting lesson of the validator audit. Nothing in this plan promotes it to gate.

## 9. Pointers (corrected)

- `js/validate.mjs` — `reachValidator` (:112+), the override read (:122-123), the clock-window
  math (:124), constants (:67-72), the WINDOW SCOPE + THRESHOLD HONESTY docblocks (:83-102), the
  **`window` merge site** `runValidators` (:562-565), `leanValidators` (:598-605).
- `js/windowread.mjs` — `windowStats` (:255-284) + `inWindow` (:24): the mod-24 seam limit.
- `js/flip-niches.mjs` — specs (:261/:271/:289/:311/:366), the `window` doctrine comment
  (:215-217), `DRIFT_INTRADAY_HOLD_DAYS` + its placeholder-anchor comment (:67-82), value's
  timing-read rationale (:305-307). (`:475` is the test-only conformance whitelist — not the
  merge site.)
- `js/estimators/reach.mjs` — `reachFraction` (:94), `askReachFactor` (:125), the RB-3/RB-4
  basis doctrine (:114-124).
- `js/estimators/pair.mjs` — fold-basis sites (:128, :266); header carries the 0.71.3 BASIS FLIP.
- `pipeline/commands/screen-flip-niches.mjs` — digest basis (:805), the un-logged bid-leg reach
  call (:1233-1236); `pipeline/commands/watch-positions.mjs` — relief note (:260);
  `pipeline/commands/read-window-range.mjs` — the fold line (:645).
- PLAN.md "Discovered" — the original finding (to be corrected in place by Chunk 1's doc pass).
