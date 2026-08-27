# PLAN-FIRST-ASK — can the FIRST ask be set so fewer lots need four reprices?

Status: **DRAFT, not scheduled.** Measurement only. Prefix `FA*` (verified unclaimed —
`lint-plan-refs.mjs --collisions` lists 49 of 337 ids colliding across 43 plans + the root `PLAN.md`, and `FA[0-9]+` appears
nowhere in the tree).

Family: `pipeline/commands/join-*` is **SIX** commands, not four. **The only property all six share
is that they GATE NOTHING** — every attempt to state a richer common contract has been false, twice
now, so this plan states what each one does instead of a family rule:

| command | what it scores | against what |
| --- | --- | --- |
| `join-reach-basis.mjs` | a logged signal | 1h archive PRINTS (reached ≠ filled — its header says so) |
| `join-asym-outcomes.mjs` | a logged signal | 1h archive PRINTS |
| `join-amplitude-outcomes.mjs` | a logged signal | 1h archive PRINTS ("neither is a realized fill") |
| `join-depth-outcomes.mjs` | **no logged signal** — recomputes | `positions.json` closed lots (REAL fills) |
| `join-outcomes.mjs` | logged suggestions | realized fills |
| `join-window-clears.mjs` | logged suggestions | realized fills |

**Zero of the first four satisfy "a logged signal against realized outcomes"** — the half that reads
a logged signal scores archive prints, and the one that scores real fills reads no logged signal.
The two commands that actually do both are the two an earlier draft left out of the family. Where
`join-firstask-outcomes.mjs` lands is a DESIGN CHOICE this plan must make explicitly, not inherit.

A previous draft also claimed a "cost-regime map with an r\*, never an accuracy headline" family
rule. That was `join-reach-basis.mjs`'s method generalised. Only that one command carries cost-ratio
machinery (11 references; the other three have zero), and `join-asym-outcomes.mjs`'s headline output
IS a set of rates (17.8 / 24.2 / 4.3%). This plan should still PREFER the cost-regime form — it is
the better shape for a threshold question, which is what FA asks — but as a deliberate choice
argued here, not as an inherited convention.

---

## 1. Context / diagnosis

### 1.1 The observation

Sell campaigns over **2026-07-01 .. 08-21**. A reprice is not visible inside one placement: it is
`SELLING → CANCELLED_SELL → EMPTY → SELLING` at a new price, i.e. **across** placements, so it only
exists once placements are chained into a per-lot campaign.

Reproduced this session off the SHIPPED primitive (see §1.3), 1,420 sell offers → 610 campaigns,
591 with a `complete` terminal:

| reprices | n | median hold | median first→last ask move |
| --- | ---: | ---: | ---: |
| 0 | 348 | 0.0h | 0.00% |
| 1 | 93 | 0.5h | −0.20% |
| 2–3 | 87 | 1.7h | −0.65% |
| **4+** | **63** | **10.2h** | **−1.56%** |

**243 of 591 sold campaigns (41%) involved ≥1 reprice.** Worst walk-downs: Black dragon leather
(14 reprices / 29.9h / −6.3%), Dragon nails (17× / −4.8%), Dragon boots (9× / −8.8%).

Separately, over 228 closed lots ≥5m in the last 60d: 84% win rate, median +1.00%, mean +0.86%,
p90 +2.32%, and losses erase 26% of gross winnings. **The right tail is truncated and the walk-down
is the suspected mechanism** — that suspicion is the whole reason this plan exists, and it is a
suspicion, not a finding.

### 1.2 The question, narrowed

Not "which lots do we miss". Campaigns sitting ≥8h before selling split **untouched 5 / repriced
58** — the owner catches nearly every stalled lot, so there is no meaningful missed cohort and no
alerting deliverable here. The open question is only:

> **Can the FIRST ask be set so that fewer lots need four reprices?**

### 1.3 Anchor incident — the confident zero (the reason FA1 exists)

The first hand-rolled version of this reconstruction reported **`0 / 579 reprices (0%)`**. It did
not error. It closed a campaign on the `EMPTY` event and so never chained a relist back to its
originating lot, and it produced a clean, confident, wrong number that survived a read-through.
Any campaign work in this plan is fixture-pinned against **that specific mutant** or it is not
verified.

---

## 2. Rulings

Dated decisions. Every open question below is decided or carries a flagged proposed default.

- **R-a (2026-08-25, measured, supersedes the brief).** *Do not write a new campaign-reconstruction
  lib.* `pipeline/lib/reconstruct/campaigns.mjs` already is that lib (WC2,
  PLAN-WINDOW-CLEAR-OUTCOMES) and already reproduces the finding. Building a second one is the
  two-homes topology this repo's planning doc names as how forks are born. FA1 **extends** it.
- **R-b (2026-08-25, measured).** *The 3-hour gap heuristic is not a foundation risk.* Sweeping the
  stitch gap 20min → 6h moves the reprice rate 41% → 42% and the campaign count 610 → 605. The
  parameter is near-insensitive over an 18× range. FA1 still **publishes** the sweep, but it is a
  one-table acceptance criterion, not a research chunk.
- **R-c (2026-08-25, measured).** *Read `fills.json`, not the raw `~/.runelite/exchange-logger/`
  logs.* `fills.json` retains `placed` (2,241) and `cancelled` (1,264) events **with the offer
  price**, already deduped and slot-sequenced by the shipped parser, which handles the
  logout-EMPTY-burst phantom-cancel class the raw logs will re-inflict on anyone who re-parses them.
- **R-d (2026-08-25, measured, changes the plan's shape).** *M3 as specified is not measurable on
  the current log.* See §4. It is redesigned as a recomputation, with the logged join kept as a thin
  corroborating stratum.
- **R-e.** Deliverable is a **REPORT**. It gates nothing, adds no tag, no verdict word, no new
  label, no `screen.json` field.
- **R-f.** If it yields an action, that action is a **number** (a first-ask percentile target) shown
  **beside** the existing `Est. sell` as a visible comparison — never a silent swap
  (`gate-on-error-cost-not-n`; the pressure-exit precedent).
- **R-g (proposed default, flagged for veto).** Era is fixed at 2026-07-01 .. 08-21 and **locked
  before the first run**, as is the decisive spec in each chunk. Everything else is a sensitivity
  row. This is the `join-reach-basis.mjs` / `join-asym-outcomes.mjs` convention and exists so a
  favourable subset cannot become the headline.

---

## 3. Existing scaffolding (this is not greenfield)

Verified in code this session:

| Need | Already exists | Evidence |
| --- | --- | --- |
| Campaign reconstruction | `reconstructCampaigns` = `dedupeSnapshots → collapseOffers → stampFirstFill → groupCampaigns` | `pipeline/lib/reconstruct/campaigns.mjs:69` |
| Cancel-replace stitching | `groupCampaigns`, closes on `prev.state === 'complete'` **or** gap > `REPRICE_GAP` | `campaigns.mjs:46` |
| The stitch gap | `REPRICE_GAP = 20 * 60` (**20 minutes**, not the 3h the brief assumed) | `campaigns.mjs:20` |
| Per-campaign base fields | `campaignBase` | `campaigns.mjs:83` |
| Manual/phone slot exclusion | `isManualSlot`, slot ≥ 8 | `campaigns.mjs:27` |
| Trailing 14-day daily highs | `windowStats(series, { nights = 14 })` | `js/windowread.mjs:254` |
| **Percentile of a level in a distribution** | `placement(sortedAsc, x)` | `js/windowread.mjs:57` |
| The `--ask` reach basis | `askExitRead`, `reachedDays` | `js/windowread.mjs:706`, `:37` |
| 1h forward archive | `archive.open` / `seriesFor`, 903MB, covers the era | `pipeline/lib/market/archive.mjs` |
| Suggestion log reader | `readSuggestionLines()` | `pipeline/lib/render/suggestlog.mjs` |
| Item-clustered bootstrap CI on a CONTINUOUS outcome | `clusterBootstrapCI` | `join-depth-outcomes.mjs:218` |
| Item-clustered bootstrap CI on a {0,1} outcome | `bootstrapM` | `join-reach-basis.mjs:222` (which carries a comment saying `clusterBootstrapCI` is the wrong tool there — the two are NOT interchangeable) |

Two prior joins already share `campaigns.mjs` (`join-outcomes.mjs:39`, `join-window-clears.mjs:53`).
This plan makes a third. **The FIFO money path (`collapseOffers` / `matchTrades`) is never
re-implemented** — CLAUDE.md reconstruction rule.

---

## 4. The M3 problem — read this before scheduling anything

The brief made M3 (*whose number was the first ask?*) the chunk that decides what the fix even is:
if first asks are predominantly the owner's own numbers, tuning the estimator changes nothing and
this is a doctrine/display matter instead. That is the right pivot. **But M3 as specified cannot be
run.**

Joining each of the 610 sell campaigns' first ask back to an `estSell` on `suggestions.jsonl`
within 6h before placement:

| | real | placebo −7d | placebo +3d |
| --- | ---: | ---: | ---: |
| exact price match | 12 | 0 | 1 |
| within 0.1% | 12 | 0 | 0 |
| logged, no match | 31 | 31 | 18 |
| **no suggestion row in the 6h window** | **483** | 507 | 519 |
| no row for that item, ever | 72 | 72 | 72 |

Two things follow, and they point opposite ways:

1. **The join is clean.** The placebo shifts return 0–1 matches, so the 24 real matches are genuine
   and not numeric coincidence. The method works.
2. **There is almost nothing to join.** 555 of 610 campaigns (91%) have no tool sell number
   available at all.

**The refuting test, run rather than assumed.** "91% self-priced" has an innocent alternative: the
number was produced but never logged. That alternative is **true**, and it is most of the effect.
Across the live file **plus** `pipeline/suggestions-archive/` (`parseErr = 0`), `suggestions.jsonl`
carries **screen rows in overwhelming majority — more than an order of magnitude over `quote` and
`watch` combined**, and
`screen/watchlist` logs **zero** `estSell` on every one of its rows.
**No row counts are quoted here.** Every tally written into this paragraph has since been restated
wrong at least once, including one that mixed all-time counts under an era label. Re-derive with
`analyze-record.mjs --json` (`audit.byScript`), and note that an era-scoped claim needs an era
FILTER — the ratio is what the argument rests on, not the digits.
(⚠ An earlier draft of this paragraph read "26,354 / 448 / 30". Those were the CURRENT-FILE counts
wearing an era label — they sum to 26,832, the superseded live-file total — and the `watch` figure was
off by 112x. A separate draft called `screen/watchlist` "the single largest mode"; on the
archive-inclusive ledger **`band` is larger, 50,008 vs 29,327**, and watchlist leads only in the
current file. Recount before quoting any of these.) The surfaces that actually price a SELL (`/positions` via `quote-items --positions`,
`watch-positions`) are the ones that barely log. So the logged record cannot separate *"Ben used his
own number"* from *"the tool's number was never written down"*, and any tool-priced-vs-self-priced
split computed from it would be an artifact of instrumentation coverage.

**Consequence (R-d).** FA2 measures the counterfactual by **recomputation with no look-ahead** —
what the estimator would have said at the campaign's first-ask timestamp — rather than by reading a
sparse logged field. This is not an invention: `join-depth-outcomes.mjs` hit exactly this problem
(a sparse logged `depthExit`) and solved it exactly this way. The 24-row logged join is retained as
a **separate corroborating stratum**, never folded into the main result.

Note honestly what the recomputation does and does not answer. It answers *"would the tool's number
have differed from the one placed?"*. It does **not** answer *"did he see it?"* — divergence cannot
distinguish ignored from never-shown. Combined with the ≤3.9% ceiling on campaigns that could have
been tool-sourced at all, the honest reading is already that **the sell-side first ask is
predominantly not a tool number**, which is the pre-registered branch where the deliverable becomes
doctrine/display rather than estimator tuning.

---

## 5. Target architecture

One home per concern.

- `pipeline/lib/reconstruct/campaigns.mjs` — **extended, not forked.** Gains an explicit
  side filter and an injectable stitch gap. Stays the ONE campaign home — **TWO** non-test consumers
  today (`join-outcomes.mjs:39`, `join-window-clears.mjs:53`), three once this command lands.
  (`reconstruct.mjs:269` only NAMES campaigns.mjs in a comment; it imports nothing from it.)
- `pipeline/commands/join-firstask-outcomes.mjs` — **new.** The measurement command. Pure scoring
  core exported for fixtures (`firstAskPercentiles`, `scoreNulls`, `costRegime`), thin CLI shell,
  `--json` returning before any text. **Not a "family convention"** — three of the four
  named commands break it on their degenerate paths; it is a requirement this command adopts.
- `js/windowread.mjs` — **read-only.** `windowStats` + `placement` are reused as the percentile
  basis. The brief's instruction stands: reuse the `--ask` code path, do not re-derive it.
- Nothing under `js/` changes unless FA7 ships, and FA7 is display-only.

---

## 6. Staged chunks

Foundations first. **FA2 runs before FA3** — it is cheaper and, per §4, it decides whether the rest
of the plan is even the right shape.

| id | chunk | depends on | primary files | acceptance criteria | CI guards kept green |
| --- | --- | --- | --- | --- | --- |
| **FA1** | **Campaign reconstruction, verified.** Extend `campaigns.mjs` with a side filter + injectable stitch gap. No new lib (R-a). No behaviour change for the two existing consumers. | — | `pipeline/lib/reconstruct/campaigns.mjs`, `pipeline/test/campaigns-firstask.test.mjs` | (1) **Mutation-verified RED against the §1.3 mutant** — a `groupCampaigns` that closes on the slot-clear must make a named fixture fail; a test that passes against it is vacuous and does not count. (2) Two further mutants: gap→0, and terminal-check inverted. (3) `join-outcomes.mjs --json` and `join-window-clears.mjs --json` **byte-identical** before/after (diff-proven, not asserted). (4) Published gap sweep {20m, 1h, 3h, 6h} — expected ≈41%→42% (R-b); a materially different result means the extension changed semantics. | `run-tests`, `check-imports`, `check-dead-exports`, `lint-arch`, `lint-comments` |
| **FA2** | **Attribution (was M3), by recomputation.** Per §4/R-d: recompute the estimator's sell number at each campaign's first-ask ts with no look-ahead; report the divergence distribution. Report the **logging-coverage table of §4 as a first-class result**, and the 24-row logged join as a separate stratum. | FA1 | `pipeline/commands/join-firstask-outcomes.mjs`, `pipeline/test/joinfirstask.test.mjs` | (1) A no-look-ahead test with a **boundary fixture having a bucket exactly at the placement ts** — the `join-reach-basis.mjs` precedent, where the first draft's look-ahead test was vacuous for want of exactly that fixture. (2) The placebo shifts are re-run and reported beside the real join. (3) Report states the ≤3.9% tool-sourced ceiling and the instrumentation caveat in the output itself, not only in the plan. **Gate B (below) is evaluated here.** | `run-tests`, `check-imports`, `lint-comments`, `lint-docs` |
| **FA3** | **M1 + M2 — first-ask and filling-ask percentiles.** Percentile of the first ask, and of the price that actually sold, within the trailing 14-day daily-HIGH distribution, via `windowStats` + `placement`. Split by reprice bucket (0 / 1 / 2–3 / 4+). `M1 − M2` is the walk-down in percentile terms, which normalizes across items far better than a % move. | FA1 | `join-firstask-outcomes.mjs` | (1) Percentile basis proven identical to `read-window-range --ask` on a shared fixture — same function, not a re-derivation. (2) Item-clustered bootstrap CI on every bucket contrast. A percentile is a CONTINUOUS outcome, so `bootstrapM` (the {0,1} tool) is wrong — but `clusterBootstrapCI` is **not drop-in reusable either**: it hard-wires `r.residualPct` (`join-depth-outcomes.mjs:238-239`), takes a BINARY `split` where this wants four reprice buckets, and its nesting refusal (`:230-232`) will likely fire given §9's own note that items concentrate in one bucket. Budget for generalising it — the plausible naive outcome is **no CI at all**, which no criterion below anticipates. (3) Bucket monotonicity reported with its CI, never as a bare gradient. **This chunk carries the stop-gate — Gate A.** | `run-tests`, `check-imports`, `lint-comments` |
| **FA4** | **M4 — the three pre-registered nulls,** scored against the 1h archive in **slot-hours**. **N1** place at the eventual filling price immediately. **N2** the dumb clock — first ask, then after N hours jump straight to the every-day-reach level, one step instead of four, no signal and no new machinery. **N3** no intervention — leave the first ask resting, did it ever reach? | FA3 + Gate A open | `join-firstask-outcomes.mjs` | (1) Capital cost in **slot-hours against 8 GE slots**. A gp-per-day-of-capital metric is **forbidden**: one was computed this session and read 22%/day for a tier with 1–3h median holds, which is an artifact of assuming instant redeployment. (2) `reached ≠ filled` stated per null — 1h `avgHighPrice` bounds a real queue-position fill from above. (3) **If N2 wins, the deliverable is one line in `/positions`; the plan says so and stops at FA6.** | `run-tests`, `check-imports` |
| **FA5** | **Cost-regime map + r\*.** Report the crossover map, not an accuracy figure (`join-reach-basis.mjs` precedent, where accuracy moved +0.2pp→+3.7pp on class imbalance alone while r\* barely moved). Costs: a first ask set too low forfeits spread on a lot that would have filled high; too high costs the walk-down **plus** the slot-hours. | FA4 | `join-firstask-outcomes.mjs` | (1) Output is a regime map with crossover ratios, so a reader places their own cost ratio rather than inheriting one. (2) Sign stability reported across horizons and across the two halves of the era. (3) No accuracy number in the headline. | `run-tests`, `lint-docs` |
| **FA6** | **README inventory + doc reconciliation.** Entry for `join-firstask-outcomes.mjs` and the amended `campaigns.mjs` contract; CLAUDE.md ask→command row; grep-and-fix any statement this supersedes. | any chunk that creates or changes a file | `README.md`, `CLAUDE.md`, `pipeline/FILLS-PIPELINE.md` §5.1 if the campaign contract moved | (1) Per rule 8 this is **per-commit, not deferred to the end** — FA6 is the reconciliation sweep, not the first time a file gets an entry. (2) Reconciliation, not append: no surviving contradictory statement. | `lint-docs`, `lint-arch`, `lint-plan-refs`, `lint-guard-lists` |
| **FA7** | **Display — CONDITIONAL, only if FA5 yields a number.** A first-ask percentile target shown **beside** `Est. sell` as a visible comparison (R-f). Never a silent swap, no new label, no gate. | FA5 yielding a usable r\* | `js/estimators/cells.mjs`, `pipeline/lib/render/emit.mjs` | (1) Both numbers visible, existing one unchanged. (2) `APP_VERSION` bump (rule 5) if the deployed app is touched. (3) Every non-target branch byte-identical. | `run-tests`, `smoke`, `check-imports`, `check-verdict-guards`, `lint-comments` |

### Gates

Word-labelled deliberately: these are decision points, not shippable chunks (PLANNING.md — don't
number non-chunks in chunk style).

- **Gate A — the flatness stop, evaluated at FA3.** *Hypothesis:* reprice count rises with first-ask
  percentile. *Refuting outcome:* the percentile is **flat across buckets**, meaning repricing is
  driven by post-placement market moves, competition or impatience — not by the initial price.
  **If it comes back flat, the plan STOPS at FA3. FA4, FA5 and FA7 are not built.** Stated here
  before the run so the outcome cannot be renegotiated after it.
- **Gate B — the attribution stop, evaluated at FA2, and it fires FIRST.** If FA2 confirms §4 —
  that the sell-side first ask is predominantly not a tool number — then **no estimator tuning is
  in scope for this plan at all**, whatever FA3 finds. FA3 still runs (the percentile gradient is
  worth knowing and feeds `/positions` doctrine), but FA5's deliverable is a doctrine/display line
  and FA7 is the only implementation chunk that can follow. The current evidence says Gate B is
  more likely to fire than Gate A.

---

## 7. Encoding boundary

| rule | disposition |
| --- | --- |
| Campaign stitching + the reprice definition | **Encode** — `campaigns.mjs`, already encoded, extended by FA1 |
| Percentile basis for a first ask | **Encode** — reuse `windowStats` + `placement`, no new derivation |
| "Don't walk an ask down four times" | **Judgment** — this plan measures whether that is even the right advice; it does not encode it |
| A first-ask percentile target | **Display only**, gated on FA5 (R-e, R-f) |
| Which lots to alert on | **Retired** — measured, there is no missed cohort (§1.2) |

No skill prose changes, so no `lint-skills.mjs` triage table is owed.

---

## 8. Bookkeeping & compatibility

- **README inventory entry at file creation, in the same commit** — for
  `join-firstask-outcomes.mjs` and `pipeline/test/joinfirstask.test.mjs`. Hard project rule; not
  deferred to FA6.
- `campaigns.mjs`'s existing export surface is **additive only** — `join-outcomes.mjs` and
  `join-window-clears.mjs` must not need an edit.
- No `screen.json` / `suggestions.jsonl` schema change, so no published-artifact shape freeze is
  touched and no `--publish` add-list change is owed (`pipeline/FILLS-PIPELINE.md` §13.3).
- No new CI guard, so `lint-guard-lists.mjs` needs no doc update.
- `APP_VERSION` bump **only** if FA7 ships; FA1–FA6 are pipeline-only stdout and ship without one,
  noted in the commit message (rule 5).
- This file is deleted and folded into `PLAN.md` when its last chunk ships. Run
  `lint-plan-refs.mjs --refs PLAN-FIRST-ASK` **before** deleting — nothing else in CI will tell you.

---

## 9. Honesty (process rule 4)

Stated up front, and belongs in the command's own header, not only here.

- **Item-day clustering.** Looting bag note and Runite bolts recur heavily; effective n is well
  below 610. Every CI resamples **items**, never rows.
- **One era, one update cycle.** 52 days containing a single update cycle — 2026-07-22 took 6 losses
  on 10 lots. Findings do not transfer across update regimes, and the `update-cycle-timing` lesson
  says that cycle is the dominant loss mechanism in held gear.
- **`reached ≠ filled`.** Archive percentiles come from **1h aggregates, not the order book**. No
  queue position, no partial fills, no competition at the level, so "reachable" **bounds a real fill
  from above**. Counter-direction, so the bound is not one-way: a 1h `avgHighPrice` is a trade-side
  average, so `avg < ask` does not imply no print, which undercounts prints and partially offsets.
- **Desktop only.** Exchange logs capture desktop RuneLite; phone trades are absent. Manual/mobile
  slots (≥ 8) are excluded as synthetic, so a phone-executed reprice is invisible to every number
  here.
- **The 41% is n=591 campaigns, not 591 independent decisions.** 348 of them are a single untouched
  placement, so the repriced cohort that carries the whole finding is 243.
- **No threshold in this plan is validated.** Nothing here proposes a number that auto-applies.
  Threshold work belongs to **F1**, which is gated on O1's sample thresholds.
- **The truncated right tail is a suspicion.** §1.1 asserts the walk-down as the *suspected*
  mechanism for the p90 +2.32% ceiling. This plan does not test that link, and FA5's r\* is not
  evidence for it.

---

## 10. Verification summary

- FA1 is **mutation-verified against the §1.3 confident-zero mutant** specifically, plus two others.
  A green test that also passes against that mutant is vacuous — the `join-reach-basis.mjs` vacuous
  look-ahead test is the standing anchor for this failure class.
- FA1 proves the two existing consumers byte-identical by **diffing `--json`**, not by inspection.
- FA2 requires a boundary fixture with a bucket exactly at the placement ts, or its no-look-ahead
  claim is unproven.
- FA3 proves its percentile basis identical to the shipped `--ask` path on a shared fixture.
- Every chunk's numbers are reproducible from `fills.json` + the 1h archive with no network.
- Per CLAUDE.md rule 10, **adversarial review is the default**: at minimum one pass briefed to
  attack the reconstruction, and **one pass scoped away from the region under work**.
