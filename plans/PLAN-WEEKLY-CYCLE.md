# PLAN-WEEKLY-CYCLE — the weekday price cycle (WK1 null; WK2 branch (c); WK3 outcome (i); WK4 SHIPPED — the inform-only dislocation/yield surface is live on quote + digest)

Chunk prefix **WK** (verified collision-free, `lint-plan-refs.mjs --collisions`, 2026-09-08).

**This document deliberately contains no prescribed mechanism.** §0 records the ALIGNED GOAL and
the decisive measurements (added 2026-09-08 after owner alignment); mechanism design stays with the
executor. The rest states a measured effect, the constraints
that bound it, the claims REFUTED along the way (including two errors in this document's OWN first
draft, recorded in §2 rather than silently fixed), and the open question about item classes. The executor designs the mechanism. Nothing below is a
prescribed implementation, and the numbers below are *measurements to reproduce*, not targets.

Owner intent, verbatim (2026-09-08): *"the theory is that items dip late sunday/monday/tuesday and
rise friday/saturday. thats what we used to flip the crossbow"* and *"can we buy closer to median
for the DAY and sell closer to the median for the DAY just at a different level during the week?"*

---

## 0. ALIGNMENT (2026-09-08, owner) — this plan is amplitude's calendar axis, not a standalone strategy

Aligned after the comparison against the `--mode amplitude` lane. Owner, verbatim: *"I buy framing
2 — the intent wasn't to blindly buy on tuesday but to investigate ways to more intelligently find
items that are similar to amplitude. The weekly framing is just a rough proof that there is
predictability."*

**What this settles for the executor:**

- **The goal is: give the amplitude lane the calendar information it keeps rediscovering from
  price.** The weekly cycle is treated as *rough proof of predictability* — evidence that part of
  amplitude's surviving multi-day oscillator class (fang measured ~6–8d ≈ a week; DT1b) may be
  calendar-locked. Success = a measured improvement in the amplitude lane's walk-forward numbers
  (completion rate / EV) when entries and exits are conditioned on the item's derived day-scale
  phase (see the derived-window bullet below), or an honest null.
- **The naive calendar rule does not need rescuing.** §3's every-Tuesday backtest is GATELESS —
  it enters items amplitude's knife guard / drift-margin gate / oscillationVsKnife temper exist to
  reject, and its −2.97% adversely-selected miss is the same mechanism DT1 measured on trough-touch
  entry. Its negative EV is evidence that calendar alone is not an entry signal (which §5 already
  requires), not that the cycle is untradeable.
- **The §3 miss case is answered by ATTENDED CHECK-INS, not a pre-committed bail policy.** Owner,
  verbatim: *"monitoring/check-ins accomplish our goal, live check in on the peak day will tell us
  what we can reasonably expect to sell the item for."* The desk already runs this machinery
  (watch-positions re-verdicts, `read-schedule` windows, the reachable-level cooling exit). The
  backtest's bail(A)/bail(B) bracket stays as the *unattended* bound; the shipped answer is a live
  re-read at the exit window that prices the reachable level, and the re-reported EV under §5
  should model that policy rather than dump-at-market.
- **Windows are DERIVED from price history, not hard weekday buckets.** Owner (2026-09-08, second
  refinement): *"Not sure if hard splitting on weekdays makes sense, would be nice if it was
  flexible and able to derive the window from the price history."* So the shipped shape is a
  per-item PERIOD + PHASE estimated from the item's own history (the day-scale analogue of
  `hourProfile`), with the calendar-locked weekly cycle as the SPECIAL CASE "period ≈ 7d and phase
  stable against the weekday" — a prior, never a bucket. This also matches DT1b's record: the
  survivors' measured periods vary (fang ~6–8d), so a 7d grid would misphase some of them. The
  cheap discriminator between calendar-locked and free-running: over 14 weeks a free-running
  trough DRIFTS through the week; a locked one stays pinned. Weekday tables (§1/§4) remain the
  existence DIAGNOSTIC only.
- **Decisive measurements, in cost order (these become the WK chunks):**
  1. Weekday-split the existing `ampWalkForward` record — are entry-completion and EV
     weekday-structured for the survivors? (Cheapest; runs on machinery that exists. Diagnostic
     only — establishes that day-scale phase carries information, not the shipped bucket shape.)
  2. Re-run the §3 EV table with the amplitude gate stack applied at entry — does filtering the
     adversely-selected 27% flip the sign? Must carry the §6 Wednesday-update confound.
  3. The class/phase question over the full universe off the 1h archive (Stage-1 already sweeps
     it), measured as per-item period + phase + phase-drift rather than a weekday table: which
     items cycle at all, which are calendar-locked vs free-running vs inverted (the hilt), and is
     the §4 class story an axis or an artifact.
  4. Derived trough-phase as a prior on knife-vs-dip disambiguation — a crash landing in the
     item's measured trough window is more likely a cycle trough; the same crash at peak phase is
     more likely real. A *temper* on the knife guard (analogous to `oscillationVsKnife`) and an
     input to the DL4 dip loop — the one approach that creates NEW entries rather than re-timing
     existing ones.
- **Third owner refinement (2026-09-08, after WK2 closed branch (c); REOPENS the plan for WK3).**
  First, the class question: *"Was the WK2 analysis done by item class? We should investigate
  which kinds of items fail and which kinds of items succeed."* (WK2 tested per-item cycles and
  the whole-universe basket, never class-level baskets — and §1 was precisely a class-basket
  effect.) Then, before any WK3 result was computed, the goal reframe, verbatim: *"The end goal
  is to be able to judge if an item is advantageous to buy and determine the yield as it
  fluctuates, we don't need to define or identify a concrete cycle necessarily."* So WK3's
  PRIMARY measurement is a per-class DEVIATION-CONDITIONED FORWARD-YIELD profile off a STRICTLY
  TRAILING reference (the centered detrend that describes cycles is lookahead and must not price
  a buy signal), with the cycle tests demoted to secondary/explanatory; success and failure per
  class are judged on conditional after-tax yield vs the item's own unconditional baseline, and
  classes where deep deviations predict CONTINUED fall are reported as the knife classes. The
  full pre-registered rule (taxonomy, buckets, horizons, item-paired aggregation, BH cells,
  lane-increment check, outcomes) is the WK3 script header, committed before the run.

A full merge into one period+phase cycle lane (amplitude's current behavior = the special case
"phase from price only") is the end-state ONLY if measurement 1–2 show calendar phase actually
moves EV — it is a rebuild of a lane still at n≈0 and is not to be started on this document alone.

### WK1 result (2026-09-08) — the pre-registered NULL branch fired

`pipeline/experiments/wk1-weekday-split-study.mjs` (decision rule pre-registered in its header
before the first run; permutation test, seed pinned). 65 items (watchlist ∪ the §1 five ∪ the DT1b
validation four), 120d archive, the PRODUCTION `ampWalkForward` itself via a new opt-in
`collect:true` per-entry detail (aggregates byte-identical; suite green) at board defaults
(4d horizon, 0.5/0.5 quantiles).

**Completion by entry weekday is FLAT.** Judged n per bucket 412–440; completion rates
Sun–Sat: 28.2 / 27.3 / 28.2 / 28.5 / 29.4 / 28.6 / 29.5% — a 2.2pp spread around the pooled 28.5%
(n=2,958), about one naive binomial se per bucket. S1 (pooled) p=0.9945, S2 (item-aligned)
p=1.0000 → **"NO STRUCTURE at this grain — measurement 2 not motivated by this record;
measurement 3 decides the program"** (the power floor, pooled judged ≥ 100, was met 30× over).
Entry counts are also flat — trough-touches do not cluster on any weekday.

**Why p≈1 (flatter than chance), verified rather than asserted:** consecutive entries share
overlapping 4d horizons and consecutive days are different weekdays, so outcome RUNS smear evenly
across buckets. Measured (the script now prints this — it is the reproducer for these numbers):
lag-1 outcome agreement 86.2% vs a 64.4% per-item pairs-weighted independence baseline, implied
ρ ≈ 0.61. (The first commit's prose quoted 59.2% — a pooled-rate baseline that double-counts
between-item heterogeneity; corrected in review, ~5.2pp of the claimed excess was item mix.) So
the i.i.d. permutation p-values must not be read literally; the load-bearing fact is the raw
flatness itself.

**Reading:** the lane's trough-touch entry already conditions on price LEVEL, and given that, no
weekday structure is detectable at this grain in its completion record — a Tue entry (window =
the §1 up-leg) completes at 28.2% vs a Sat entry (window = the down-leg) at 29.5%. The §1 cycle
lives in levels, and the lane already trades levels. This is consistent with §1 being real and
this record carrying no residual calendar signal for the entry leg.

**Limits.** With ρ ≈ 0.61, effective n ≈ N(1−ρ)/(1+ρ) ≈ 712 (~102/bucket), honest per-bucket se
~4.5pp — so this study CANNOT exclude weekday effects of several pp; "no structure detectable at
this grain" is the registered claim, not "no effect exists". Board-default 0.5/0.5 quantiles =
the MEDIAN trough — weak conditioning (an entry on ~45% of scoreable days); deep-quantile entries
were not split (rarer → worse power) and per the pre-registered rule this run was not re-analysed
— recorded as a limit, not rerun. Touch proxies, one era. The raw mean net-if-completed by
weekday (7.6–17.3%) is item MIX: within-item centered it collapses to −1.1…+1.7pp, max 1.6 se
from zero — consistent with noise across 7 buckets (also printed by the script).

**Consequences (per the pre-registration):** measurement 2 (gated §3 re-run) is NOT motivated by
this record. Measurement 3 — per-item period+phase on price LEVELS over the universe, a different
statistic — now decides the program; if it is also null the plan closes "measured, too thin,
don't build". Measurement 4's knife-prior premise concerns dip-entry disambiguation, not
touch-entry completion, so it is untouched by this null but inherits measurement 3's answer.

### WK2 result (2026-09-08) — branch (c) fired: measured, too thin, don't build

`pipeline/experiments/wk2-period-phase-universe.mjs` — §0 measurement 3, the program-decider. The
decision rule was committed BEFORE the run this time (pre-registration commit `b34bc7d`; detection
= max-R² sinusoid fit over 3–14d on 15d-detrended daily mids, red-noise surrogate null, BH-FDR
q=0.05, branch floors — the script header is the one full spec). 4,323 archive items, 2,516
tested (≥70 valid days, ≥85% coverage), era to 2026-09-08.

**⚠ The FIRST run of this section reported branch (a) — 193 discoveries, 83 clearing every floor
— and that result was an INSTRUMENT ARTIFACT, caught by adversarial review (§2-retraction style:
recorded here, not silently replaced).** The registered null was never passed through the MA15
detrend: real data was scored as mid/MA15−1, surrogates as raw AR(1). The filter amplifies
8–14d (up to ×1.22 at P≈10.5d) and suppresses P>15d, so FILTERED noise concentrates power
exactly where the "discoveries" massed (179/193 at P*≥9.5d, 0 below 6d — the filter's own
signature). The reviewer's end-to-end probe: pure non-periodic red noise through the actual
pipeline yields ~220–310 false discoveries of 2,516 — MORE than the observed 193, consistent
with ZERO true mid-band periodicity. The refuting test cost ~3 minutes (rule 11). Two more
first-run errors, same correction record: every printed trough weekday was +1 (a local/UTC
index mismatch), and the header's "passes the band near-uniformly, gain ≈0.93+" claim was false
(gain 0.87–×1.22 across the band, so printed amplitudes carry up to ~22% filter inflation plus
winner's-curse selection). The script's C1–C3 header block is the full correction spec; the
first run's numbers survive only in `git show fd3f769` and are not to be quoted.

**The corrected rerun (surrogate mids through the SAME deviations()/MA15 pipeline, φ matched on
the filtered lag-1): ZERO FDR discoveries of 2,516. Branch (c) — the plan closes "measured, too
thin, don't build" — which §5 has said from the start is a successful completion.** The
1,934-member basket is not significant either (p=0.586): §6's one-index question stays answered
NO, and branch (b) did not fire.

**The honest residue — reported as inform-only annotation (the §0 null consequence), NOT as
discoveries. The set, defined once: calendar-LOCKED items (P* ∈ [6.5,7.5], drift ≤ 1d) with
p < 0.05 — there are exactly three:** **Old school bond** (p=0.0014 raw, 0.0002
basket-subtracted — the smallest p in the basket-subtracted family (the raw family's smallest
belongs to a non-weekly item) — trough SATURDAY, peak-to-trough 4.2%, drift 0.5d; a real-money
instrument with weekend demand is also the most economically coherent story on the board),
**Mole skin** (p=0.0050, trough SUNDAY, peak-to-trough 3.4%, drift 0.3d, ~330m gp/day), and
**Toxic blowpipe (empty)** (p=0.036, trough TUESDAY, drift 0.2d). **Osmumten's fang is
suggestive only, NOT in the set** (p=0.060, trough TUESDAY, drift 0.0d — EXACT agreement with
§4's Tue trough after the weekday fix, but its p roughly doubles to ≈0.106 under the reviewer's
persistence-matched null, below). Against 2,516 tests even the set of three is not
distinguishable from multiplicity (120 items land P* in the weekly band; these 3 at p<0.05 vs
~6 expected by chance), and an FDR resolution limit applies: at 10k surrogate draws the
smallest achievable p (1e-4) is above the BH single-discovery threshold (2e-5), so NO lone item
could have cleared FDR — only a cluster could, and none did. A further stated limit
(review round 2): the surrogate family's filtered lag-1 saturates at ≈0.61 and ~28% of items —
including every residue item — sit above it, where the null is ANTI-conservative; the
reviewer's persistence-matched re-measurement moved bond 0.0014→≈0.0008 (robust), blowpipe
0.036→0.048, fang 0.060→≈0.106. Branch (c) is unaffected a fortiori (a stricter null keeps
zero discoveries). Bond is the one name that would repay a second era's data.

**§1-five consistency check under the honest null:** staff/crossbow/ring not detected (crossbow
p=0.89, ring p=0.66 — §4's weekday rows for them were fitted noise, a call that is STRONGER
under the corrected test); hilt p=0.049 at P* 14d — not a discovery, not an inverted weekly;
fang as above. §1's basket weekend effect (t=4.48 on the five-item gear basket) is NOT
contradicted — this scan tests single sinusoidal periodicity per item, a different statistic —
but it does not generalize: no per-item weekly class exists at universe scale.

**Limits.** ONE era, one season; touch mids; amplitudes carry filter gain (≤22%) + selection
inflation; the FDR resolution floor above means "zero discoveries" partly reflects instrument
resolution, not proof of absence — but the branch-(c) floors were pre-registered and the honest
read is that nothing tradeable was demonstrated.

**Consequences:** the program CLOSES per the pre-registered rule. Measurement 2 stays
unmotivated (WK1) and its weekly-class premise failed here; measurement 4's knife-prior premise
(a derived trough window worth disambiguating toward) now has no demonstrated per-item cycle set
to anchor it and closes with the plan. What ships is at most annotation: the residue note above
(bond Sat / mole skin Sun / blowpipe Tue, with fang suggestive-only), inform-only, never a gate,
sized at "suggestive, unproven". The derived-window idea (§0) was the right instrument to ask the question with — the
answer came back "too thin at this era's resolution"; a second archive era is the only thing
that reopens this.

### WK3 result (2026-09-08) — outcome (i): deep dislocations carry a real conditional yield advantage, and it is class-structured

`pipeline/experiments/wk3-class-cycle-study.mjs` — the §0 third-refinement measurement (rule
committed before the run, `9eb2743`; 4,323 archive items, 2,516 tested, 10 named metadata classes
+ unclassified). PRIMARY question per the owner reframe: is a dislocated price advantageous to
buy, and what yield does it carry — no cycle required. Reference is STRICTLY TRAILING (15d);
advantage is item-paired (conditional minus the item's own unconditional 4d net, t across items).

**Outcome (i) fired. Deep dislocation (mid ≤ −7% of trailing mean) is a BH-significant BUY
advantage in 8 of 10 named classes — and after the round-1 review's honest splits, FOUR classes
are ROBUST beyond the lane, TWO unresolved.** The registered beyond-lane split used each item's
IN-SAMPLE era-p10 (days the amplitude lane's trough-touch would not already catch); the review's
TRAILING split (each day classified against the item's PRIOR deviations only, ≥30 required — now
encoded in the script's post-registration block) is the honest label, and under it:
**ammo** (+4.8pp same-day, trailing-split t=4.3), **herb** (+3.2pp, t=5.0), **bones-ashes**
(t=7.8/3.4 at the two deeper cells), **midvalue-lowlimit** (+1.8pp on 208 items, ALL THREE deep
buckets significant, trailing t=5.9) are robust; **potion-dose** (+8.3pp same-day, registered
beyond-lane +4.9pp t=3.3, but trailing-split t=1.0) and **bulk-commodity** (+9.6pp; registered
beyond-lane +6.6pp t=1.74, clearing its one-sided gate by 0.009; trailing-split t=1.2) keep
their magnitudes but NOT their significance — unresolved, not established. **The honest
actionable magnitudes are the LAG-1d-ENTRY numbers** (enter at the NEXT day's mid — what a human
acting on a surface actually does; encoded): potion 8.3→+4.9pp, ammo 4.8→+3.3pp, herb +3.4pp,
bones +0.7pp at its significant (−4,−2] cell (the deeper (−7,−4] cell's +2.6pp never cleared BH
— do not pair it with the headline), midvalue +1.6pp, bulk +6.6pp — same-day capture is roughly
half again higher and is quoted only as the descriptive upper bound. bigticket-lowlimit
(+1.81pp, t=8.55) is significant but LANE-CONFINED under the registered split — the lane's
trough-touch already owns this edge, which is WK1's null seen from the other side; the trailing
variant nominally passes (+1.88pp t=4.0 n=24), label kept on the registered check because the
deviation-p10 proxy is weakest for the lane's own class — a WK4 design input for the
lane-owned/no-double-count annotation, and note bigticket is also the one class whose
volume-conditioned deep cell survives (+1.19pp t=3.3). rune's beyond-lane cell FAILS the items
floor (12 < 15 — too few members to classify, not a measured confinement).
**NO knife class exists at class level** — §4's feared "deep deviation predicts continued fall"
class did not materialize at this grain (the closest calls: bigticket (−4,−2] at −0.21pp ns, and
seed-sapling's (−7,−4] near-miss at −1.79pp p=0.025 vs the 0.018 BH cut — "no knife class" means
"none cleared the registered bar", not "none plausible").
**The elevated ≥+4% bucket is significantly NEGATIVE nearly everywhere** (bulk-commodity −8.8pp,
midvalue −3.0pp t=−11.7, unclassified −22.0pp vs baselines) — the sell-side mirror: elevated
prices revert too, which is the reverse-flip/exit-timing read. It survives every review check
unchanged.

**Three caveats govern every yield number (read before quoting):** (1) deep-bucket conditional
yields on thin/cheap classes are inflated by a daily-mid COMPOSITION artifact — a −7% daily mean
mid on a thin item is often one-sided prints, and its "recovery" is not a fill anyone can buy;
the +15–30% conditional means on bulk-commodity/unclassified are artifact-heavy. The paired
advantage does NOT defend against this (the review measured that claim false): (2) **the
deep-dip edge is VOLUME-FRAGILE** — restricting to days with traded gp ≥ the item's own median
(encoded), the beyond-lane classes mostly collapse (potion −0.6pp t=−0.2, midvalue +0.0pp,
bulk t=0.9, ammo t=0.7; herb +2.2pp t=2.3 is the survivor), while the LANE-CONFINED
bigticket cell SURVIVES the volume condition (+1.2pp t=3.3) — the class ranking a surface would
publish INVERTS under a volume condition, and for potion/midvalue the point estimate collapses
(composition, not power). (3) Mid-to-mid at the daily mean mid is not an executable price. The
profile RANKS classes and depths; it does not promise returns. All three are the reason the
WK4 surface must price EXECUTABILITY FIRST: liquidity floor, bid-side entry, spread- and
depth-aware, volume-conditioned yield shown alongside the unconditional one.

**Secondary (explains, does not decide):** class-basket periodicity — NO FDR discovery in either
family under persistence-matched nulls (stated limit: the MA-innovation family RAILS at w=60 for
the three highest-r1 baskets, so "persistence-matched" saturates at the top — WK2 R2-1's
sibling; harmless here since nothing was significant) (the yield advantage is NOT a clean
class-wide sinusoid;
it is mean-reversion from dislocation, exactly the owner's "no concrete cycle necessarily").
Enrichment: bigticket/herb/raw-material shift toward-cycle (BH✓, r1-saturation caveats apply);
potion-dose/bones-ashes/midvalue/ammo/seed-sapling/bulk-commodity are DEAD for per-item cycles at
this resolution. §1's five REPRODUCE (+1.257%/wk weekend-minus-Tue, t=4.33, 12/13 weeks — §5
bullet 1 closed) and the 118-member metadata gear class CONFIRMS the §1 prior DILUTED
(+0.363%/wk, t=2.18 ≥ crit 1.782 one-sided): §1 is a real class property, ~3× weaker class-wide
than on the five book items, consistent with few members expressing it strongly. Descriptively,
rune/ammo/unclassified run the OTHER way (weekend LOWER — e.g. rune −1.10%/wk t=−2.8): §4's
"inverted class" exists, but on commodity classes, not the hilt.

**Limits.** ONE era; mid-to-mid touch proxies; both lane-splits are percentile PROXIES (the lane
fits levels, not percentiles) — the registered one is in-sample (flattering, see above), the
encoded trailing one governs the write-up; cross-item same-day correlation makes
across-item se's optimistic; heuristic taxonomy dilutes (unclassified = 953 tested items, 38%);
BH cells were registered only at h=4d deep buckets — every other cell is descriptive.

**Consequences:** the program does NOT close. Next chunk (WK4, needs owner alignment on shape):
design the inform-only "current deviation vs trailing mean + measured class-conditional yield"
surface, connected to the amplitude lane's estimator frame — with executability pricing as the
first design constraint, big-ticket explicitly annotated as lane-owned (no double-count), and
the ≥+4% elevated read surfaced on the SELL side (reverse-flip/exit timing). Nothing gates,
sizes, or auto-prices off WK3.

### WK4 (2026-09-08) — SHIPPED: the dislocation/yield surface, inform-only, two homes

Owner alignment, verbatim: *"WK4's home depends on how it is implemented; I think we for sure want
it in the digest as it is functioning as the amplitude strategy, and we probably want it on the
quote surface as well because being able to say 'Wait 2 days to buy this item to save X' could be
useful."*

What shipped (every number a WK3 measured constant; reproducer = `wk3-class-cycle-study.mjs`,
regenerated and verified identical before the constants were written down):

- **`pipeline/lib/signal/dislocation.mjs`** — the ONE pure module: the WK3 taxonomy (extracted
  verbatim; the study now re-imports it, `--audit` byte-identical across the move — record and
  runtime cannot drift), the measured cell table, the strictly-trailing deviation read (15d ref,
  ≥12/15 prior days, ≥3 rows today, ≤6h-fresh archive — anything less is SILENCE), and the
  after-tax wait-savings inversion. Fixtures: `pipeline/test/dislocation.test.mjs`.
- **Digest home** (`screen-flip-niches.mjs --digest`): a `dislocation (WK4 …)` block under the
  digest table, computed for the RENDERED rows only (the enrichDigestAskDecay pattern) — never
  re-ranks, never resurrects a filtered row.
- **Quote home** (`quote-items.mjs`, bare + held-lot views): the ◇ note. Deep + robust class →
  the buy read quoting the LAG-ENTRY magnitude with the AT-VOLUME figure beside it (the
  volume-fragility caveat is IN the line, not a footnote); deep + big-ticket → the lane-owned
  no-double-count line; elevated ≥+4% → the owner's wait read, rendered as "waiting ~4d ≈ X gp/u
  cheaper" off the measured class-conditional mean (`waitSavesGp` inverts the after-tax cell).
  "~4d" always — the registered horizon; the owner's "2 days" phrasing is deliberately NOT
  rendered (no 2d cell was registered).

**Intraday read quality (round-1 review K1, re-derived as the study's labeled `--transitions`
block — the committed reproducer):** a first-6-local-hours partial-mean bucket read holds its
bucket at the full-day close **86–91%** of the time at deep7 and **69–88%** at elevated — quotable
at read time — but only **41–74%** at deep4/deep2 (bones-ashes deep2 49%, midvalue deep4/deep2
60%/53%, with 15–29% dissolving to neutral), so every rendered shallow-bucket buy line carries its
cell's measured hold rate in the line itself (`holds ~N% by close`; a dissolve ≈ baseline entry —
forgone edge, not loss). The rates ride the table as per-cell `hold` constants, pinned in the
fixtures.

Honesty constraints encoded, not prosed: potion-dose/bulk-commodity deep cells ABSENT (unresolved
under the trailing split — quoting them would invite acting on an unestablished number); rune deep
ABSENT (items floor); elevated cells carried as descriptive (p≤0.05, ≥15 items — the registered
BH family was deep×4d only) and labeled so; unclassified/neutral/stale/absent-cell = silence,
never a hedge. INFORM-ONLY end to end — the surface gates, sizes, re-ranks, and prices nothing,
and the numbers are class-conditional expectations from ONE era, said so on every line.

Deliberately NOT built: any estimator/rank coupling (outcome-(ii) checking showed the lane already
owns the one volume-robust class), any auto-refresh of the constants (a re-run of WK3 is the only
honest way to move a number — the table is a dated measurement, not a live model), and any
watchlist/read-watchlist surfacing (not an aligned home; the shared builder would drag the
annotation into byte-parity contracts for no aligned benefit).

---

## 1. The effect is real — at BASKET level

Measured over the local 1h archive, 104 days (2026-05-28 → 2026-09-08), 5 big-ticket gear items
(Avernic defender hilt, Nightmare staff, Armadyl crossbow, Venator ring, Osmumten's fang).

Each day's mid is detrended against its own **7-day centered mean**, then averaged **within each
week** before testing — so the items' mutual correlation (hilt~staff measured r=0.776 on
day-over-day returns) cannot inflate the sample size.

| statistic | value |
| --- | --- |
| weekend-minus-Tuesday gap | **+1.395%** |
| sd | 1.165 |
| paired t | **4.48** (df 13) |
| weeks with weekend > Tuesday | **13 / 14** |

Peak Sat/Sun, trough Tue. This is the claim the executor should be able to reproduce first; if it
does not reproduce, nothing else in this document matters.

**A prior session's per-item 14-day test (n=2 per weekday) reported "does not replicate" and was
underpowered.** That conclusion is superseded, and the executor should not reinstate it.

## 2. Where the constraint actually binds — and two claims this document RETRACTS

**⚠ This section was rewritten twice on 2026-09-08, each time after an owner challenge. Both
earlier framings are recorded rather than silently replaced, because an executor who independently
arrives at either needs to know it was tested and rejected.**

- **RETRACTED #1 — "the tax eats the edge."** That compared the 2.00% tax against the
  *median-to-median* 4-day gross (2.850%). The strategy §3 recommends runs at p05/p95. Wrong
  percentile pair; the tax is cleared comfortably on a completed trade (§2a).
- **RETRACTED #2 — "drift dominates by an order of magnitude."** That compared the *cumulative
  104-day* decline against a *weekly* amplitude. Over the 4-day horizon actually traded, typical
  drift is −0.903% (§2b) — real, but not the binding term.

The constraint that does bind is in §3, and it is neither of these.

### 2(a) The tax — cleared on a completed trade

GE tax is 2.00% of the sell. Two different numbers matter and must not be conflated:

| pair | IN-SAMPLE spread (upper bound) | ACHIEVABLE net when both legs fill, after tax |
| --- | --- | --- |
| p05/p95 | 6.295% | **+3.22%** |
| p10/p90 | 5.697% | +2.79% |
| p25/p75 | 4.491% | +1.85% |
| p50/p50 | 2.850% | +0.76% |

**The left column is an UPPER BOUND and must never be quoted as a return.** It is the same-day
distance from the p05 of Tuesday's lows to the p95 of Saturday's highs — realisable only by hitting
both extremes, which is the in-sample saturation trap DT1b already documented. The right column is
the honest one: levels fitted strictly pre-origin, both legs actually reached.

Completed trades clear the tax at every percentile pair, and deep clears it best. **Tax is not the
problem.**

Retained for reference, the buy-weekday ORDERING at median-to-median (n=70 each) — this is what
establishes Tue/Wed as the entry days; the ordering is the finding, not the levels:

| Buy day | mean 4d gross (p50/p50) |
| --- | --- |
| Tue | +2.850% |
| Wed | +2.694% |
| Mon | +1.633% |
| Thu | +1.623% |
| Fri | +0.679% |
| Sun | +0.381% |
| Sat | +0.102% |

All-days null = 1.423%; Tuesday's edge over the null is +1.427%.

### 2(b) Drift — a gentle grind at this horizon, not a disqualifier

Measured over the horizon actually traded (4-day mid-to-mid):

| Item | mean 4d | median 4d | p10 | p90 | windows worse than −2% |
| --- | --- | --- | --- | --- | --- |
| Armadyl crossbow | +0.406% | −0.768% | −4.60 | +7.06 | 37% |
| Avernic hilt | −0.258% | −0.127% | −8.18 | +6.83 | 33% |
| Nightmare staff | −1.368% | −1.767% | −9.61 | +6.30 | 48% |
| Osmumten's fang | −0.579% | −0.624% | −5.66 | +4.18 | 33% |
| Venator ring | −0.142% | −1.058% | −4.68 | +5.58 | 38% |
| **Pooled** | **−0.388%** | **−0.903%** | | | |

Typical 4-day drift is −0.903% against a +3.22% achievable win — about 28% of the win, and it is
already inside the §3 numbers rather than an extra deduction.

Owner framing, adopted (2026-09-08): items in OSRS drift down and settle over time, and the current
bot-banning deflationary regime makes a gentle negative trend the NORMAL state, not a warning. A
mild downward slope is **not** a reason to avoid flipping an item at this timescale. The data agrees
in shape as well as sign: pooled mean minus median is **+0.515pp** — the mean sits ABOVE the median,
so the typical window is the mildly-negative one and a few large up-moves pull the average up. A
persistent gentle grind, not episodic crashes.

**But the left tail is fat and it is where the strategy actually dies** — see §3. A third to a half
of 4-day windows fall more than 2% (33–48% per item), p10 runs −4.60% to −9.61%.

### 2(c) Per-item sign is unstable — see §4

The basket effect is not an item effect. This constraint survives both retractions intact.

## 3. THE BINDING CONSTRAINT — the ask-miss is adversely selected and costs 2× the win

This is the section the executor should start from. Tue buy → Sat (+4d) ask, levels fitted
**strictly pre-origin**, after-tax, expressed as % of the bid. Outcome split per 100 attempts:

| pair | no fill | win | bail | net WIN | net BAIL(A) | net BAIL(B) | EV/att (A) | EV/att (B) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **p05/p95** | 47% | 27% | 27% | **+3.22** | **−6.37** | −5.57 | **−0.839** | **−0.627** |
| p10/p90 | 47% | 27% | 27% | +2.79 | −6.52 | −5.76 | −0.996 | −0.792 |
| p25/p75 | 47% | 31% | 22% | +1.85 | −8.16 | −6.85 | −1.236 | −0.945 |
| p50/p50 | 40% | 33% | 27% | +0.76 | −7.75 | −6.90 | −1.813 | −1.587 |

`bail(A)` = dump at the sell-day median high. `bail(B)` = leave the ask resting to +14d, then mark
at the +14d median high. Of asks that miss the +4d window, only **25%** are reached by +14d, so
patience recovers ~0.2pp and is not the answer.

**The structural facts, which are what the chunk has to solve:**

1. **The winning trade is real.** +3.22% after tax at p05/p95, on a 4-day hold. Not marginal.
2. **The losing trade is twice as large.** −6.37% against a +3.22% win. With win and bail almost
   exactly equally likely (27% / 27%), that asymmetry alone makes the naive rule EV-negative.
3. **The bail is ADVERSELY SELECTED, and this is the mechanism.** On the days the ask misses, the
   item's mid moved **−2.97%** over the 4 days, against a −0.903% unconditional typical. The ask
   misses precisely when the item fell. So the bail is not a random unlucky draw to be averaged
   away — it is a conditional loss that arrives with information attached.
4. **Deep percentiles improve every column** — bigger win, smaller bail, better EV — which is why
   §3's ordering (deep > median) survives all of this even though every EV cell is negative.
   Median-to-median remains the worst cell tested; the owner's second proposal stays refuted.

**Therefore the chunk is not "should we trade the weekly cycle." It is "what happens on the 27% of
attempts where the ask misses."** A design that produces an entry rule and leaves the miss case as
"dump at market" has not engaged with the only term that decides the sign of the EV. Note the repo
already holds relevant doctrine — the cooling-item exit rule (price to the reachable level, never
instasell) and the standing patience-over-panic rule on CUT — and that neither bail modelled here
implements either.

Honest limit on this table: bail(A) and bail(B) are two arbitrary policies chosen to bracket the
range, not modelled exits. The ask percentile's own contribution is not cleanly separated from the
bail policy, so the ask column should be read as "ask+bail jointly", never as an ask-leg result.

## 4. The open question the owner asked for: WHICH CLASSES express this?

Per-item weekday deviation (%, detrended), the reason §1's basket result must not be applied
per item:

| Item | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Osmumten's fang | +1.20 | −0.51 | **−1.69** | −1.18 | −0.34 | +0.84 | **+1.84** |
| Armadyl crossbow | +0.93 | +0.17 | +0.02 | −0.88 | −1.06 | −0.27 | **+1.13** |
| Venator ring | **+1.66** | +1.20 | −0.28 | −1.24 | −1.44 | −0.56 | +0.68 |
| Nightmare staff | +0.55 | −0.43 | −0.44 | +0.50 | −0.44 | −0.50 | +0.24 |
| **Avernic defender hilt** | −0.61 | **−1.02** | −0.77 | +0.26 | **+1.12** | **+1.00** | +0.01 |

Three express it, one (staff) is inside its own noise at ±0.55%, and **one is INVERTED**: the hilt
peaks Thu/Fri and troughs Sun/Mon/Tue. Trough day also varies among the three that do express it
(fang Tue; crossbow and ring Wed/Thu), so even "buy Tuesday" is not uniform — and the crossbow, the
trade that motivated the whole hypothesis, is a **Wed/Thu**-trough item. The owner's recollection of
why that flip worked is therefore not quite what the data says, though the trade itself was real
(4 round trips 09-01→09-05, +1,527,389 realised).

**A candidate mechanism, offered as a hypothesis to test and NOT as a finding.** Weekend play
raises both sides of the book, but not for the same items: an item players BUY to use (fang,
crossbow, ring — upgrade purchases) sees weekend DEMAND, while an item players RECEIVE as raid loot
(the Avernic hilt is a ToB unique) sees weekend SUPPLY. That predicts the sign flip exactly. It is
also a story fitted to five items, chosen because they were in the book — the executor must treat
it as one of several candidate axes, not the answer.

Other axes worth separating before concluding: price tier; daily volume; consumable vs durable;
drop-sourced vs skill/shop-sourced; PvM-gated vs freely producible. **The decisive move is to run
this over the full item universe rather than five book items** — five items cannot distinguish five
candidate axes, and any class rule derived from this sample is fitted by construction.

## 5. What "done" looks like, as an outcome rather than a mechanism

- §1 reproduces, or is reported as not reproducing, off the archive with the week-level test intact.
- The class question in §4 is answered on a sample large enough to separate the candidate axes, with
  per-class sign AND stability reported — not a pooled average that hides an inverted class.
- Whatever ships states, at point of use, that the effect is a **timing overlay on an entry already
  justified on other grounds** — it must not gate, and must not read as a standalone entry signal.
- **The §3 miss case has an explicit designed answer**, and the EV is re-reported under it. A design
  that improves entry timing while leaving the 27% ask-miss as "dump at market" has NOT shipped —
  that term alone decides the sign of the EV. The aligned direction (§0) is attended check-ins +
  the existing reachable-level exit doctrine; the re-reported EV must model that policy, with the
  §3 bail bracket retained as the unattended bound.
- Sizing is evaluated against the §2(b) LEFT TAIL (p10 of −4.60% to −9.61%), not against a mean.
- A pre-registered decision rule for "the edge is thinner than execution noise, do not build" exists
  BEFORE the measurement runs, so a null result is publishable rather than re-analysed until positive.

## 6. Open questions for the executor to answer, not assume

- Is the weekday effect a property of the ITEM or of the market-wide gp flow? If the whole market
  breathes weekly, per-item weekday tables may be re-measuring one index with extra steps.
- Does the effect survive on a drift-neutral (market-relative) basis, i.e. item minus basket? §1
  detrends each item against ITSELF, which removes level but not the common weekly component.
- The archive is ONE 73–104 day era spanning one season. Is there any second era to check against,
  and if not, does that alone cap what may be claimed?
- Do game updates (Wednesday) confound the Tue/Wed result? Wednesday is both the second-best entry
  day AND the standard update day, and the update-cycle doctrine already says gear dumps after an
  update. These two effects are not separated anywhere in this document.
- Buy limits: the 4h limit bounds how much of a weekly cycle can be accumulated on the trough day.
  Is the deployable size per cycle even large enough for the edge to matter against the slot cost?

## 7. Honesty (rule 4)

n = 14 weeks, 5 items, ONE archive era, one season. The basket result is significant on its own
terms (t 4.48, 13/14) but "significant" here means "unlikely to be zero", not "large enough to
trade". Note §2 CORRECTED two errors from this document's own first draft — the tax bar was
evaluated against the wrong percentile pair, and drift was compared across the wrong horizon. Neither retraction made the strategy profitable — the EV is still negative in every §3 cell. What
they did was move the constraint to the right place, which is the difference between an executor
solving the bail problem and an executor re-deriving a tax argument that was never the issue. Both
were caught by the owner, not by a guard. The
binding constraint is neither tax nor drift — this document RETRACTED both framings (§2). It is the
adversely-selected ask-miss: a +3.22% win against a −6.37% bail at equal ~27% frequency, with the
item down −2.97% on exactly the days the ask misses. Per-item sign is unstable and one of five items runs backwards. The class mechanism in §4
is an untested story. Nothing in this document may gate, size, or auto-price anything, and an
executor who concludes the honest answer is "measured, too thin, don't build" has completed the
chunk successfully.
