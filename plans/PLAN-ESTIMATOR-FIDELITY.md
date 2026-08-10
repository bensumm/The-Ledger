# PLAN-ESTIMATOR-FIDELITY — the discovery estimator understates both legs; the rank buries repriceable rows; throughput is assumed, not measured

**Status: PARTIALLY SHIPPED (corrected 2026-08-09 — this line read "PLANNING ONLY. No code changed."
while EF-0a and EF1 were both marked ✅ 2026-08-01 in its own Status table, and `MIRAGE_PLACEMENT` had
shipped as a real export at `js/estimators/families.mjs:93`).** Read the per-chunk Status column, not
this line, before assuming a chunk is unbuilt. Per-topic working doc (2026-08-01, hardened from a
live-session finding set); folds into `PLAN.md` and is deleted when its last chunk ships
(`docs/PLANNING.md` lifecycle). Executor rules = PLAN.md "Executor rules", verbatim.

Read first: `js/estimators/sell-models/reach-fold.mjs` header (the AC7 verdict — load-bearing),
`js/estimators/pair.mjs` header, `pipeline/lib/signal/patha.mjs` header,
`plans/PLAN-ESTIMATOR-POSTURE.md`, `plans/PLAN-REACH-CALIBRATION.md` (the sibling axis),
`plans/PLAN-FETCH-POOL-SCALING.md` (owns the starvation half — NOT re-planned here),
`docs/MARKET-ANALYSIS.md` §1/§3.

## Context / diagnosis

**The anchor incident (Ben, ~2026-07-29 session — the "Runite bolts (unf) lap set", n=5 laps on
ONE item):** the band screen quoted Runite bolts (unf) `Est. buy 106 → Est. sell 120` (+12/u)
while `read-window-range --ask 124` independently verified 124 as routinely reachable (then
12/14 days, recent 2/3, placement p14 of the daily-HIGH distribution), and Ben's realized fills
that day were sells at 124/125 against dip buys at 103. Screen-quoted spread ≈ 64% of the
realized one; the understated net feeds `rank = net × P ÷ TTF`, which is what orders the board.
**This is a hypothesis-generating anchor, NOT a calibrated finding** (rule 4) — n=5 laps, one
item, one hot day, remembered because it filled. EF0 below is the counterfactual that decides
how much of it generalizes; nothing in this plan auto-applies on the anchor alone.

Root causes CONFIRMED in code (all verified against current `main`, 2026-08-01):

1. **Price-basis mismatch, structural.** The discovery estimate prices off the **2h robust
   band**: the sell candidates blend `[reach-folded bandTop, diurnal ask, asym ask]` but the
   diurnal (daily-basis) ask is **clamped to the 2h band top** —
   `sCands.push(clamp(dAsk, qs, bandTop))`, `js/estimators/sell-models/reach-fold.mjs:132` —
   and the buy floor is the 2h band low (`buyLo = min(ob, qb)`, `:143`; shell clamp
   `pair.mjs:200`). So a daily-distribution ask above the 2h top, or a diurnal dip below the 2h
   low, is **unquotable by construction**, while the verifier (`read-window-range`) and Ben's
   realized fills operate on exactly that daily distribution. The two surfaces answer different
   questions and cannot agree; the contradiction is built in, not a data bug.
2. **The band sell fold is DELIBERATE (AC7) — this plan must not simply delete it.**
   `reach-fold.mjs:32-47` documents why the fold stays in the discovery price (rank's ask-reach
   P is soft-floored at 0.25, so an un-folded stale top can out-rank genuine edges; grade caps
   cap the letter but never reorder) and names the re-decision path: score raw-top vs folded
   against realized/reachable outcomes, with AC9 (reach-aware overnight sort) already shipped.
   EF0 runs that scoring; EF2 attacks the *basis*, which AC7 never adjudicated.
3. **Rank buries a repriceable entry instead of repricing it.** `estimateRank`
   (`js/estimators/families.mjs:296-306`) multiplies the entry-leg family pFill by
   `askReachFactor`; a band-low bid with 0-recent touches zeroes the pair-P and the rank, even
   when the SELL leg is verified. Live repro (2026-08-02 band scan): Helm of neitiznot printed
   `Rank 0 · net 3.9k P~0.00` at row 79/83 while the same row displayed `P~57%` (the estimator
   pFill — a second, contradictory P on the same line) and the model-free patient pair was
   +5,708/u (+13.2%). The correct response to a dead bid is to REPRICE the entry (live
   crossable level) and re-evaluate — not to discard the row.
4. **The mirror defect: churn's fold exemption has no placement bound.** `spec.fillShape ===
   'symmetric'` skips the ask-reach discount entirely (`families.mjs:297`, `reach-fold.mjs:100`)
   on the premise "sells into continuous flow NEAR a tight band top". When the churn ask sits
   AT/ABOVE the daily-high distribution the premise fails but the exemption still fires. Live
   repro (2026-08-02 churn scan): Sapphire dragon bolts (e) `Rank 14.44m · P~0.93 · S+` — the
   top rank on the board — while its own inform note read "reach ask 3191 reached only 1/14d
   (would caution)". The exemption needs the placement check its premise implies.
5. **Windows-per-day is assumed 6 in four homes; the measured number exists and is discarded.**
   - `expUnits` — `pipeline/lib/signal/gatecandidates.mjs:175-180`: `min(perWindow × 6,
     0.10 × volDay)`; inline literal `6` at `:177,179`. Hard pre-fetch gate at `:284`
     (`expGpDay < t.MIN_GPD → null`, MIN_GPD 500k).
   - Path-A (`pipeline/lib/signal/patha.mjs:97-120`) reuses `expUnits`; `captureFrac`
     0.45/0.62 self-documented PLACEHOLDER n=13/12, own-book-biased.
   - Digest `capEff` (`pipeline/commands/screen-flip-niches.mjs:531,553-563`): churn laps
     `min(6, 86400/ttf)`; **non-churn holdDays floors at 1h ⇒ up to 24 implied laps/day** —
     `pipeline/test/capeff-digest.test.mjs:58-61` literally names the 192%/d case "the fantasy"
     (POLISH 2's `lapsCap` bounds it only when the digest passes a deployed size).
   - `js/valuescreen.mjs:102` (`VALUE_WINDOWS_PER_DAY = 6`), `js/amplitudescreen.mjs:88`
     (`AMP_WINDOWS_PER_DAY = 6`) — independent copies; SoT is `LIMIT_WINDOW_SEC`
     (`pipeline/lib/capital/limits.mjs:31`), which only `LAPS_PER_DAY_CEIL` derives from.
   - Meanwhile `diurnalTimedLap` (`js/windowread.mjs:1472-1542`) computes the real dip/peak
     windows, `holdHrs`, reach per leg, tranche bounds — header states the timed lap is
     "~1 cycle/day" — and its output reaches only `timedLapShadow` → `suggestions.jsonl` + one
     console line (`screen-flip-niches.mjs:1100,1441,1543`). It never reaches `expGpDay`,
     `pathAGpDay`, or `capEfficiency`.
   - Session-scale corroboration (one session, inform-only): realized ~26.1k units/day vs
     `expUnits` 60.1k (2.3×); realized ~464k gp/day vs Path-A 1.04m/d (2.2×).
6. **Same-hour surface disagreement on the SAME reach read (new, found while verifying this
   plan).** 2026-08-02, minutes apart: the band screen scored neitiznot's bid 45,701 as
   `(0/3 · p14)` (→ rank P~0.00) while `quote-items.mjs` scored the same bid `(2/3 · 2/14)`.
   DIAGNOSED at EF1(d) — the original hypothesis (timedLap dip-window scoping) was wrong: the
   screen's read is `reachValidator`'s CLOCK-ANCHORED coming-8h window (`wStart = now.getHours()`),
   the quote's is full-day `windowStats` (wStart 0/wEnd 0). Different questions, both legitimate;
   kept + documented in both homes' headers (unification would re-score every board's P — EF0-gated,
   own chunk). See the EF1 section for the full writeup.

**Fetch-pool starvation is real but NOT scoped here.** Runite bolts (unf) required `--top 130`
for a fetch slot (band 88 rated at `--top 180` vs 26 at default; 60–135 "crowded out" per pass).
That is `PLAN-FETCH-POOL-SCALING` chunks 2–4 + the PLAN.md Discovered "capital-conditioned
reserves" ruling (reserves = validation scaffolding with an exit condition). The `via`-rank
suggestions logging half (Discovered, was flagged URGENT — un-captured rank is gone forever)
**shipped 2026-08-01 as EF-0a below**. This plan contributes the evidence row and takes a
dependency on the scaling chunks, nothing more — do not fork that work here.

## Challenge to the premise (why EF0 comes first)

- **Survivorship risk is live.** Re-running the verifier tonight (2026-08-02):
  `--ask 124 → 10/14 BUT recent 1/3 ⚠ stale · cushion FADING +10→−3 · floor/ceiling falling
  −1/d`. The regime cooled after Ben's laps; today the fold's caution is arguably *right* for
  this item. The anchor shows the basis mismatch exists; it does NOT show the fold
  mispredicts on average. Only the counterfactual join settles that.
- **Prior evidence cuts both ways.** `PLAN-REACH-VALIDATOR-AUDIT` already measured ~31% of
  reach-rejected levels printing within 8h (loose in the reject direction), but
  `PLAN-ESTIMATOR-POSTURE`'s Crimson-kisten anchor and tonight's Sapphire row show the fold
  catching real mirages. Both classes exist; the question is the mix and the cost asymmetry.
- **The board-optimism hazard (the DHCB class) is the exact failure the fold guards.** Any
  chunk that raises quoted asks ships with its evidence attached (reach counts + placement +
  reality/recency guards already computed in `diurnalTimedLap`) and as a *visible second
  answer*, never a silent replacement of the conservative one.
- **The `(none)` bucket may be the real prize.** `analyze-record` (run 2026-08-02): every
  screen niche's taken-rate is ≤0.16% and `(none)`-sourced fills carry **+15.15m realized at
  ~3,383 gp/attention-unit ≈ 53× band's 64**. `(none)` = fills with no suggestion row within
  the join horizon — which includes Ben's quote/verifier-driven session flow, not only
  "tool-uninvolved" trades. If most realized P/L already comes from the per-item loop, the
  highest-value estimator work is making DISCOVERY produce what the per-item loop produces
  (this plan), and the honest alternative is to accept the screen as a shortlist generator and
  stop polishing its prices. EF0(b) decomposes the bucket so Ben can rule on that with data.

## Rulings

None from Ben yet. Proposed defaults, each explicitly veto-able:

- **R-1 (proposed):** decision-moving numbers ship as *visible comparison* (both old and new on
  the row/line), promotion to the default number only after EF0's report — per the
  `gate-on-error-cost-not-n` 3-Q rule (these are visible + cheap + reversible, so they ship
  ON, showing what changed; nothing here auto-applies invisibly).
- **R-2 (proposed):** the pre-fetch Stage-1 `expGpDay` gate keeps the ×6 assumption
  (deliberately permissive — see EF3 scope cut).
- **R-3 (proposed):** the timed pair surfaces as a second labeled pair, never replacing the 2h
  pair as the ONE quoted pair of the price-basis principle (`estimators.mjs` header) without a
  Ben ruling.

## Existing scaffolding (not greenfield — verified present)

- `diurnalTimedLap` + multi-peak windows + `peakReality`/`dipReality` recency guards + tranche
  bounds (`js/windowread.mjs`) — computed for EVERY screen survivor already (DT2 §7 guarantee).
- `timedLapShadow` already logs the timed pair per pass (`pipeline/lib/render/suggestlog.mjs`).
- The archive: 1.1M+ rows / 44+ days of bulk 1h+5m (`pipeline/lib/market/archive.mjs`) — the
  forward-reach counterfactual join is now possible offline (REACH-VALIDATOR-AUDIT precedent).
- `join-window-clears.mjs` + `campaigns.mjs` (WC2) — fill-attribution machinery; WC1's
  `windowExit` shadow accruing. `report-retro.mjs`/`retrojoin.mjs` — suggestion→fill joins.
- AC8's `fold:` line + estBuy/estSell/estConfidence shadows — fold-vs-raw is already logged.
- `askReachFactor`, `bandPercentile`, `recencySplit`, `windowStats` — every primitive EF1/EF2
  need exists; NO new statistics home is added (one-home rule).

## Target architecture

No new layers. Changes live where each concern already lives: pair/rank logic in
`js/estimators/*` (pure, console-consumed), throughput kernels in
`pipeline/lib/signal/{gatecandidates,patha}.mjs` + the digest helpers in
`screen-flip-niches.mjs`, window math stays in `js/windowread.mjs` (the ONE profile home —
EF2 consumes `r.timedLap`, never re-derives), evidence reports in `pipeline/commands/`.
`screen.json` and the app are untouched (they render the model-free pair — verified,
`docs/MARKET-ANALYSIS.md` §1; the pressure-model precedent: uncalibrated prices stay out of
`screen.json`).

## Staged chunks

### EF-0a — the `via`+rank logging prerequisite (SHIPPED 2026-08-01; data-perishable, landed first)
The PLAN.md Discovered "log `via` into `suggestions.jsonl`" spec, implemented literally (every scan
pass without it permanently discarded the datapoint — rank depends on that pass's market snapshot
and is NOT reconstructable):
(a) **Per-surfaced-row admission provenance:** `pickFetchPool` (`pipeline/lib/signal/admission.mjs`)
stamps every gated candidate's `preRank`/`prePool` — its 1-based position in that niche's pre-fetch
ordering + the pool size ("would have ranked 12th of 178"). Ordering keys: band/churn = the unified
`expGpDay × softFactor(proxyDrift) × trackBoost` score the Discovered entry names (a DIAGNOSTIC
reference over the whole gated pool — the per-lane admission sorts are untouched; thin omits
softFactor, held bypasses ranking); value = `valueScore`; amplitude = `ampProxy`. The screen's three
log sites (renderMode / value / amplitude) thread `via` ('reserve' | 'explore'; absent = ranked-in —
the natural-experiment baseline) + `preRank`/`prePool` + `askPlacement` (the digest's already-computed
daily-HIGH placement percentile, previously discarded) through `suggestionEntry` as lean
`if (x != null)` fields.
(b) **The crowded-out set:** each pass appends ONE admission-exclusion aggregate line per niche —
`{ ts, script:'screen', mode, params, prePool, excluded:[{ id, reason, preRank?, expGpDay? }, …] }`
(`suggestlog.mjs excludedShadow`) — exactly the excluded population EF0's "would the buried row have
been good?" counterfactual joins against the archive. Aggregate rows are itemId-less by design, so
retroJoin / join-outcomes / join-window-clears / report-retro all skip them structurally;
`analyze-record.mjs` additionally exempts them from its `noKey` health counter.
*Acceptance (all verified at landing):* behaviour-neutral — back-to-back warm-cache before/after
runs of `--verbose --digest --mode all` diff identical except wall-clock "~Nmin ago" labels; no
`screen.json` shape/content change; zero new fetches (every logged number was already in-process);
fixtures pin the stamps (`admission.test.mjs`) + the lean fields/reshaper (`suggestlog.test.mjs`);
measured cost ≈ +19.4KB per `--mode all` pass (~17.9KB the three aggregate lines, ~1.5KB the per-row
trio) vs ~101KB baseline pass. Absent under `--admission legacy` (rankAndSlice stamps nothing —
lean fields simply don't appear).
*Gap vs the task's wish-list (honesty):* the rank components net/P/TTF and the reach splits were
ALREADY logged (`estFields`' bid/ask/pFill/ttfSec/rank + `estConfidence`/`timedLap`); EF-0a added
only what was missing (`via`, `preRank`/`prePool`, `askPlacement`, the excluded set). The
`softFactor`/`trackBoost` multipliers themselves are not logged as separate fields — `preRank` (the
position, which the Discovered entry names as the needed lookup) supersedes recovering them.
*Primary files:* `pipeline/lib/signal/admission.mjs`, `pipeline/lib/render/suggestlog.mjs`,
`pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/analyze-record.mjs`, tests.

### EF0 — the counterfactual + attribution report (evidence first; gates every promotion)
Read-only command `pipeline/commands/report-estimator-fidelity.mjs` (or a `report-retro.mjs`
section if it fits — one home, executor's call):
(a) **Fold-vs-raw forward scoring:** over accrued `suggestions.jsonl` (+archives): for each
band-row shadow, score `estSell` (folded) AND the raw band top AND the logged `timedLap` ask
against subsequent archive 1h/5m prints within the niche horizon — did each level print? Report
per class (liquid/thin × placement bucket): fold's false-caution rate vs mirage-catch rate.
(b) **`(none)`-bucket decomposition:** split by item-ever-suggested, by surface (quote/watch
row exists earlier than horizon?), by watchlist membership — how much is per-item-loop flow vs
genuinely untracked.
(c) **Bid-side counterfactual (the AC4 shape, market-print version):** for band-low bids
logged, did the level print within horizon (5m grain)? — the buy-leg twin of (a).
*Acceptance:* runs offline (archive + ledger only, zero fetch); prints n per cell; makes NO
change to any live number; README inventory entry. Honest-empty when a cell is thin.
*Primary files:* new report command, `pipeline/lib/render/retrojoin.mjs` (import-only).

### EF1 — rank-leg honesty: reprice the dead bid, bound the churn exemption, ONE P per row (SHIPPED 2026-08-01)
(a) **Dead-bid reprice alternative — SHIPPED as specced:** `estimateRank` computes `repriced`
(entry at the live crossable `quickBuy`, sell unchanged, entry-P re-run at the live level with the
now-wrong-level reach read dropped, the SAME bounded ask-leg discount) when the entry-leg P from a
REAL reach read (`basis 'reach'`) < `DEADBID_PFILL_FLOOR` (0.10, PLACEHOLDER n≈0) AND the sell leg
is scored AND the live entry sits above the quoted bid. The screen prints a `↻ repriced entry`
footer line with the sell leg's reach evidence inline (the DHCB guard); a lean `repriced` shadow
rides `suggestions.jsonl`. HEADLINE rank/pFill/sorts untouched (R-1) — pinned by fixture.
(b) **Placement-bounded symmetric exemption — SHIPPED as specced,** at EVERY exemption site so no
surface disagrees: the rank askF skip (`families.mjs` `symmetricExemptionHolds`), the price fold
(`reach-fold.mjs` `foldExempt`), the `REACH_GRADE_CAP` skip, the AC9 overnight P-weight, and the
digest reach/trend/divergence read. `MIRAGE_PLACEMENT` 0.85 MOVED to `families.mjs` (single-sourced;
the screen's digest imports it back). Visible swap: a `⚠ exemption dropped — rank X (was Y) ·
P~a (was b)` line per moved row + lean `exemptionBounded`/`rankPre` shadows. DEVIATION (found live):
integer-tick tight laps (Ancient essence — the whole band is two ticks, so the ask IS the daily
high) read p100 BY CONSTRUCTION and trip the bound; their genuinely-high reach makes the applied
discount a NO-OP (factor ≈ 1 → numbers byte-identical), so the swap NOTE is suppressed when nothing
moved (the shadow still logs). I.e. on integer-tick items the placement bound cannot separate
tail-ask from tight-top — the protection for the Ancient-essence class is the reach count itself,
not the placement gate. EF0's report should segment `exemptionBounded` rows by moved-vs-no-op.
(c) **P coherence — SHIPPED:** the Net cell's ask-leg-only probability is labeled `P(ask)~X%`
(`cells.mjs`), and the CONSOLE rank cell labels a collapsed product (`P~0.00 (bid leg)` — the only
path to 0.00 is a ~0 entry leg, the ask factor floors at 0.25) via `consoleRankCell`, a print-time
copy: the published `screen.json` cells are byte-untouched by (a)/(c).
(d) **Finding-6 DIAGNOSED — root cause found, difference kept + documented (not unified).** The
hypothesis ("dip-window-scoped via timedLap") was WRONG. Actual cause: the screen's bid/ask reach
comes from `reachValidator` (js/validate.mjs), which scores a CLOCK-ANCHORED coming-8h window
(`wStart = now.getHours()`, `REACH_WINDOW_HOURS` 8, over 14 nights — "will it print in the window
it rests through?", and the count MOVES with the clock); quote-items scores the SAME level over the
FULL DAY (`windowStats` wStart 0/wEnd 0 — "does it print at some point in a day?"). 0/3 vs 2/3
minutes apart is therefore legitimate, not a data bug. Unifying is NOT safe as a side-effect: the
screen's rank P(fill) is built on the window read, so switching it to full-day re-scores every
board — its own chunk, EF0-gated, if wanted at all (the two windows answer different questions).
Documented in all three homes (`reachValidator` header, the screen's `reachExtra` block,
quote-items' `bidReach` block); the screen's `↻ repriced entry` line names its window basis.
*Acceptance — all verified at landing:* fixtures pin (a)'s exact trigger + R-1, (b) flipping
strictly above the bound (at-bound keeps), Sapphire-shaped drops from top-rank (live: churn #1
`S+ 10.05m P~1.00` → `B 3.05m P~0.30`, reach cap named), Ancient-essence-shaped keeps its numbers,
neitiznot-shaped prints the alternative (live: `↻ … entry at live 46.3k: net +2.7k/u · rank ~4,958
P~0.46 (sell 50k reached 4/14d)`); estimatePair de-exempted churn folds byte-equal to band; replay
goldens untouched; zero new fetch; suggestions fields additive-lean (pinned). NOTE an intended
consequence: `screen.json`'s grade/rank CELL CONTENT (and score order) changes for de-exempted
churn rows — same shape, data-level, the sanctioned (b) swap; est cells still never enter it.
*Primary files:* `js/estimators/families.mjs`, `js/estimators/sell-models/reach-fold.mjs`,
`js/estimators/pair.mjs`, `js/estimators/cells.mjs`, `js/validate.mjs` (doc),
`pipeline/commands/screen-flip-niches.mjs`, `pipeline/commands/quote-items.mjs` (doc),
`pipeline/lib/render/suggestlog.mjs`, tests (estimators/capeff-digest/suggestlog).

### EF2 — the timed (daily-basis) pair as a first-class visible second answer
Promote the already-computed `r.timedLap` dip/peak pair from a footnote line to a labeled
second pair on band rows where it diverges from the 2h pair by more than a named threshold:
`timed: 108 → 119 (+9, bid 6/7 · ask 2/7, hold ~Xh)` — WITH its reach counts and
`peakReality`/`dipReality` guards inline, so the optimistic number carries its own evidence
(the DHCB guard). The 2h pair stays the headline `Est.` pair (R-3); the rank stays on the
quoted pair. Shadow logs both (already does via `timedLapShadow` — verify fields suffice for
EF0(a), extend leanly if not).
*Acceptance:* zero new fetch (DT2 guarantee); rows without a clean profile degrade silently
(existing `degraded` contract); Runite-bolts-shaped fixture surfaces a timed pair wider than
the 2h pair with reach attached; no `screen.json` change (console-only).
*Primary files:* `pipeline/commands/screen-flip-niches.mjs`, `pipeline/lib/render/render.mjs`
(formatTimedLap seam), `pipeline/lib/render/suggestlog.mjs` (lean fields), tests.
*Depends on:* EF1(c) (row legibility) recommended, not required.

### EF3 — measured cycles/day on the POST-fetch numbers (+ single-source the constant)
(a) **Post-fetch throughput honesty:** where a survivor's profile exists, derive measured
laps/day (from `timedLap` `holdHrs` + window count per day, ceilinged by
`floor(86400/LIMIT_WINDOW_SEC)`) and use it in Path-A's `cyclesDay` and the digest's
`holdDays` — killing the 24-laps "fantasy" floor for non-churn. Display keeps the old number
visible during the trial (`cyc 1.2 (was 6.0)` token, R-1); shadow logs both.
(b) **Single-source the constant (mechanical, byte-identical):** replace the inline `6` at
`gatecandidates.mjs:177,179` and the two `js/` copies (`VALUE_WINDOWS_PER_DAY`,
`AMP_WINDOWS_PER_DAY`) with a derivation from `LIMIT_WINDOW_SEC` (careful: `js/` modules must
not import `pipeline/` — put the derived const in the `js/` home the screens already share, or
mirror with a cross-comment per the `parseGp` precedent; executor picks the clean direction).
Separate commit, diff-proven byte-identical.
(c) **SCOPE CUT — the Stage-1 gate keeps ×6 (R-2).** The ordering conflict (gate runs before
any per-item data exists) is resolved by NOT resolving it: ×6 INFLATES pre-fetch `expGpDay`,
i.e. the hard MIN_GPD gate errs PERMISSIVE, and over-admission is filtered post-fetch — the
cheap failure direction. The residual harm (inflated velocity lanes crowd the fetch-pool
ORDERING) belongs to the admission/`via`-logging work (PLAN-FETCH-POOL-SCALING + PLAN.md
Discovered), not here. An archive-derived Stage-1 cycles estimate (bulk 1h, zero network) is
possible but ships only if EF3(a)'s measured-vs-assumed delta proves large AND a measured
runtime cost is acceptable — a follow-on, deliberately unscheduled.
*Acceptance:* (a) fixtures pin measured-laps derivation + the ceiling; digest fantasy test
updated to assert the measured path; (b) byte-identical diff; (c) documented in
`gatecandidates.mjs`'s expUnits header (why ×6 stays at Stage-1).
*Primary files:* `pipeline/lib/signal/patha.mjs`, `pipeline/commands/screen-flip-niches.mjs`,
`pipeline/lib/signal/gatecandidates.mjs`, `js/valuescreen.mjs`, `js/amplitudescreen.mjs`, tests.

### Deliberately NOT scoped here
- Fetch-pool starvation / reserves / `--top` scaling → `PLAN-FETCH-POOL-SCALING` + PLAN.md
  Discovered (capital-conditioned reserves). The `via`+rank logging prerequisite DID land here
  (EF-0a, 2026-08-01 — it was cheap and its data unrecoverable); the scaling work itself stays out.
- Removing the band sell fold → only via AC7's re-decision path, i.e. EF0(a)'s numbers +
  a Ben ruling. This plan never deletes the fold on the anchor alone.
- `safeQuantile` / size-conditioned achievable price → `PLAN-REACH-CALIBRATION` AC3+ (the
  sibling axis; EF0's report should cite its AC1 findings rather than re-derive).
- Any `screen.json`/app change (the published-cells contract stays frozen; no APP_VERSION).

## Status

| Chunk | What | State |
| --- | --- | --- |
| EF-0a | `via`+rank+excluded-set ledger logging (the data-perishable prerequisite) | ✅ 2026-08-01 |
| EF0 | Counterfactual + attribution report (fold-vs-raw, (none) decomposition, bid twin) | OPEN |
| EF1 | Rank-leg honesty: dead-bid reprice line · placement-bounded churn exemption · one P · finding-6 diagnosis | ✅ 2026-08-01 |
| EF2 | Timed daily-basis pair as visible second answer (guards inline) | OPEN |
| EF3 | Measured cycles/day post-fetch (+ byte-identical constant single-sourcing) | OPEN |

**Recommended sequence: EF1 → EF0 → EF2 → EF3.** EF1(a)/(c)/(d) are pure-win legibility fixes
(nothing reorders silently; the buried-great-trade class is the costliest observed error and
the fix adds a line, losing nothing). EF0 runs early because EF1(b)'s promotion, EF2's
credibility, and any future fold decision all read from it — but it needn't block EF1's
additive parts. EF3(b) can ride any wave (mechanical); EF3(a) last — biggest reorder of the
console sort, wants EF0's frame in place.

## Encoding boundary

Encoded: the reprice condition, the placement bound, measured-laps derivation, the report
joins — all mechanical-given-data, fixture-pinned. Judgment (stays with Ben/skills): whether
the timed pair becomes the headline (R-3), whether the fold dies (AC7 path), what the `(none)`
decomposition means for where effort goes. Skills touched: `/scan` gains one line describing
the repriced-entry marker + timed-pair line (pointer prose, `judgment:`-tagged where it is
judgment; `lint-skills` must stay green).

## Bookkeeping & compatibility (per chunk, not deferred)

- README inventory entry for every new file at creation (EF0's command; this plan file's entry
  ships with the plan commit). `lint-docs`/`lint-plan-lifecycle` stay green (this file is in
  `plans/`, not root).
- `suggestions.jsonl` fields: additive/lean only (`suggestionEntry`'s `if (x != null)` shape);
  never rename existing shadow fields (EF0 reads the historical ones).
- No `screen.json` shape change; no APP_VERSION bump for console-only chunks. If EF3(b)'s
  single-sourcing touches `js/` files the app serves, behavior is byte-identical — follow the
  SF-4 precedent (bundle-or-note in the commit message; bump only if app behavior changes).
- CI: all chunks keep `check-imports` (no `js/` → `pipeline/` imports), replay goldens for
  untouched paths, `run-tests.mjs` green; new fixtures use synthetic data only (rule 4 — no
  live prices in tests).

## Honesty (rule 4)

- The anchor is n=5 laps on one item; the 64%/60% capture figures are one day, one item, and
  the verifier read has ALREADY drifted (2026-08-02: recent 1/3 stale, cushion fading). Named
  placeholders introduced here: the reprice P-floor, the placement bound (reusing
  MIRAGE_PLACEMENT 0.85, itself n≈0), the timed-pair divergence threshold — all PLACEHOLDER,
  n≈0, calibrated only via EF0/F1. `captureFrac` stays the documented placeholder it is.
- The session throughput corroboration (2.2–2.3×) is one session of one trader's book —
  direction-credible, magnitude-uncalibrated.
- EF0's cells will be thin in places; it prints n per cell and refuses conclusions below a
  floor — the WC3 "empty-but-honest" discipline.
- What would validate each: EF0(a)/(c) forward print-rates by class (weeks of ledger already
  accrued — no new wait); EF1(b) pre/post churn-board audit over ≥2 weeks of passes; EF3(a)
  measured-vs-assumed laps distribution over the same window.

## Verification — the before/after harness (Q1 of the acceptance criteria)

Pre-change rows are captured (dated evidence, 2026-08-02 ~02:23Z, WILL rot — kept as
verification context, not as spec): Helm of neitiznot band row `Rank 0 · net 3.9k P~0.00 ·
grade D · row 79/83 · Path-A 433.9k ⚠<floor` vs model-free patient +5,708 (+13.2%); Sapphire
dragon bolts (e) churn row `Rank 14.44m · P~0.93 · S+` vs "ask reached 1/14d" inform note;
Runite bolts (unf) quote `107 → 112 (+3)` vs verifier diurnal `dip 108 · peak 119` (+9 after
tax). Each chunk's executor re-captures the live pre rows THAT day (screen `--verbose` + the
last-report JSON), applies the chunk, re-runs on the SAME warm snapshot (FC1 cache or the
archive replay harness) and diffs: the acceptance question is "does the board reorder
defensibly and does anything good get lost", answered row-by-row for the three archetypes
(buried-great-trade, mirage-top, understated-band) + the top-10 stability of each board.
