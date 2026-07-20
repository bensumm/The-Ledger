# PLAN-AMPLITUDE-SCAN — a 24h-cycle discovery lane (+ the cycle-period unification question)

**Status:** HARDENED (Fable pass, 2026-07-19) — validated against the code, ready for Ben+Claude
review, then the Opus implementation pass. Not yet scheduled. This is a plan, not code.
Original author: session 2026-07-19 (Ben's "Masori chestplate category" thread).

---

## Fable review notes (what changed in this pass, and the §6 verdict)

**Unification verdict, in one paragraph:** the cycle-period continuum is a **genuine organizing
FRAME but a forced IMPLEMENTATION abstraction** — and the surprising finding from reading the code
is that the honest version of the "cycle-parameterized core" **already exists and is called
`FLIP_NICHES`**. The registry (`js/flip-niches.mjs`) + the estimator-family rank
(`js/estimators/families.mjs` — `net × P(fill) ÷ TTF` with a per-family `pFill`/`ttf`/`lapUnits`)
+ the `gate:` routing seam in `pipeline/lib/gatecandidates.mjs` is a declarative per-lane spec over
shared machinery; what differs per lane is exactly what SHOULD differ (the edge function, the gate
stack, the estimator family — i.e. *which data grain defines the cycle*). A literal `cycle=<t>`
engine would break on churn (its edge is buy-limit-throttled volume×spread, not an oscillation —
three code-verified exemptions would have to leak back in as special cases) and on the data-grain
problem (the 2h band comes from the 5m walk, the daily range from the 1h series, the multi-week
cycle from the daily archive — the period parameter doesn't unify acquisition, which is where most
of the code lives). **Recommendation: (a+) — build amplitude as a 4th declarative spec** (a new
`gate:'amplitude'` route + a new `'amplitude'` estimator family, mirroring exactly how value was
added at P5), **and bank the real dedup as a small extraction** (the shared candidate-loop
boilerplate that `gateCandidates` and `gateValueCandidates` both repeat). Incremental, not
all-or-nothing; details + evidence in §6.

**The 4 most important hardenings to the lane itself:**
1. **The rank formula is replaced.** The draft's bespoke `ampScore = net × deployable ÷ holdDays`
   is structurally the SAME formula as the standard rank (`÷ holdDays` ≡ `÷ TTF` with a ~1-day
   prior) minus the fill-probability term the draft's own §4 says is make-or-break. §2.2 now
   specifies a new **`'amplitude'` estimator family** instead: `pFill` = the two-leg recent-reach
   product at the quoted daily levels, `ttf` = the hold-horizon prior, `lapUnits` = the
   deployable-units min() (the hook churn already uses). Rank/grade/suggestions machinery then work
   unchanged — no parallel ranking system to maintain or calibrate.
2. **The gate is two-stage, like value's — the draft's single-stage gate is not computable
   pre-fetch.** The pre-fetch context has only the bulk 24h volumes, the 2h bands, and the daily
   archive (whole-market /1h at **6h spacing** — 4 mid samples/day, which systematically
   *attenuates* the daily hi/lo range). Exact daily amplitude needs the per-item 1h series, which
   is only fetched for survivors. §2.1 now encodes: cheap attenuated pre-fetch proxy → exact
   post-fetch confirm off `windowStats`.
3. **The liquidity floor is the existing count-matched pair, not a new number — and the lane's
   big tickets enter via the gp-flow THIN path.** The draft's "~100/day" style floor is a
   pre-PLAN-VOL24 legacy-units number (the /24h endpoint under-read 10–27×; floors were
   count-matched to corrected volume: unit floor 3,500, gp-flow 4.5b). Masori body at ~250/d
   corrected is *below* the unit floor and admits via gp-flow (250 × 42m ≈ 10.5b) — meaning the
   amplitude class is largely **thin-class by construction**, with the honesty consequences
   (thin reserve, `THIN_GRADE_CAP` A-) spelled out in §2.1. Also: the default `MAX_PRICE` 45m
   nearly clips the anchor example (Masori ≈ 42m) — the lane needs its own price window.
4. **The make-or-break metric is now concrete and computable at n≈0 fills** (§4/§A5): a
   *shadow both-leg replay* off the 1h archive (would the bid have touched AND the ask printed
   within the horizon, for every surfaced pick — an n-rich would-have-filled rate, honestly
   labeled an upper bound) alongside the realized-fill join via the existing `retrojoin` spine
   for the picks Ben actually takes.

**Honesty corrections:** the §1 claim that day-of-week seasonality tooling "already exists" was
false — there is **no day-of-week machinery anywhere** (`hourProfile` is hour-of-day only;
verified by grep across `windowread.mjs`/`read-window-range.mjs`). It is genuinely-new code and is
flagged as such (§2.4). The §3 value→invest rename is costlier than "rename across the set" — the
`value` spec KEY is load-bearing in the suggestions ledger and replay goldens; §3 now separates
label-rename (cheap) from key-rename (forks the retro history — don't).

---

## 0. The origin — what we found

Chasing "what matches the Ancient godsword's signature" (≈40m price · thin ~110/day volume ·
stable regime), the truest twin — **Masori body** (≈42m · ~250/day · flat · daily range
41.3m↔43.9m ≈ **4%**) — *never surfaces in the band screen*. Diagnosed root cause (verified, not
guessed):

1. The band screen **prices the 2h band**, so Masori body reads Quick **+0.0%** / Optimistic
   **+1.2%** — the ~4% daily amplitude is invisible at the 2h grain.
2. The band screen **ranks by `net × P(fill) ÷ TTF`**, which *punishes slow fills*. Masori body
   scored rank ~12,881 with **P(fill) ~0.06 · ttf ~26h** — the model correctly saying "you won't
   fill in 2h," which is the wrong question for a lane whose whole point is a ~day-long hold.

So there is a real, repeatable edge (a big-ticket that oscillates ~4% *daily*) that the current
screen is **structurally blind to**. This plan adds the lane that sees it.

**Fable note on the diagnosis:** confirmed against the code. `quotedPair` (js/estimators/
families.mjs) prices band's rank at the 2h `optBuy/optSell` edges, and `pFillIntraday`'s reach
read + `ttfIntraday`'s intraday prior are both 2h/intraday-basis — the rank was answering the
right question for band's thesis and the wrong one for a daily-cycle thesis. The fix is a new
thesis (spec + estimator family), NOT a patch to band's rank.

## 1. The organizing frame — strategies are ONE question at different cycle periods

Ben's reframe (2026-07-19): the flip-niches are not four unrelated strategies — they are the
**same operation at different cycle periods**: *buy the low of the N-period cycle, sell the high,
capture the amplitude minus tax.*

| Lane | Cycle period | "Buy low / sell high" of… | Confidence cycle repeats | Capital lockup |
| --- | --- | --- | --- | --- |
| churn | ~immediate | the spread, captured at max frequency* | very high | ~none |
| band | ~2h | the 2h intraday oscillation | high | hours |
| **amplitude (NEW)** | **~24h** | **the daily swing** | **medium** | **~1 day** |
| value → **invest** | ~7d+ | the multi-week cycle | low | weeks |

\* **Caveat (do not force-fit — code-CONFIRMED, see §6):** churn's edge is buy-limit-throttled
*volume × spread*, not an intraday price swing — `churnEdge` (js/flip-niches.mjs) has **no ROI
gate at all** (`CHURN_MIN_VOL` + a real buy limit are the gate; "tiny per-unit margin is accepted,
volume does the work"), its rank is per-LAP (`churnLapUnits` — the limit is a *fact*, not a cycle
read), and its `fillShape:'symmetric'` exempts it from the ask-reach discount, the reach grade
cap, and both estimatePair fold legs. Its "cycle" is bounded by the 4h limit reset, not a
low→high oscillation. band / amplitude / invest are the clean triplet on the *amplitude* axis;
churn sits at the fast end with a different edge source. The unification (§6) must not pretend
churn is amplitude-at-t0.

**Corollary — pricing context scales with the cycle:** the longer the hold, the more the pricing
leans on historical trajectory. band (2h) needs only the current intraday shape; **amplitude (24h)
leans hard on the hour-of-day diurnal profile** (to time both legs to the daily trough/peak);
**~1.5-day holds cross day boundaries → day-of-week seasonality** (the UK weekly rhythm, weekend→
weekday transitions) enters; invest (7d+) needs multi-week trajectory.

**Tooling honesty (corrected):** the hour-of-day grain is fully built (`hourProfile` /
`deriveDiurnalRange`, js/windowread.mjs — including the trend-dominates guard and the Ghrazi
cluster lesson) and the multi-week grain is built (`termStructure` + the warm
`trajectoryFrom1h`). **Day-of-week seasonality tooling does NOT exist** — nothing in the repo
buckets by weekday (verified). `read-window-range --nights 21` prints daily rows a human can
eyeball by weekday, but there is no encoded read. The 1.5-day experiment's seasonality consult is
genuinely-new code (§2.4) — small (a weekday sibling of `hourProfile`'s day bucketing), but new.

## 2. The new lane — `--mode amplitude`

Discovery method: **amplitude-by-day analysis.** Find big-ticket items whose *daily* high/low
range is a wide, stable, two-sided-reachable oscillation, and price the godsword playbook onto
them (bid the daily trough, ask the daily peak, hold ~a day, cycle).

### 2.0 Reuse map (verified against the code — what exists vs. what's new)

Everything the draft called "existing machinery" was checked. The honest split:

**Exists, reusable as-is (name → home):**
- **Daily-grain reach/quantiles** — `windowStats` (full-day = `wStart:0, wEnd:0` — the exact call
  `renderMode` already makes per survivor at lines ~593/~610), `reachedDays`/`touchedDays`,
  `quantLow`/`quantHigh`, `recencySplit`, `recentQuant` — all `js/windowread.mjs`. Note the leg
  asymmetry: the ask leg is `reachedDays`/`side:'ask'` (daily HIGHS), the bid leg is
  `touchedDays`/`side:'bid'` (daily LOWS) — the draft said "reachedDays" for both.
- **Daily trough/peak pair** — `asymPair` (deep-bid quantile + high-reach ask quantile off the
  same `windowStats`) and/or `hourProfile`+`deriveDiurnalRange` (dip/peak clusters + levels +
  the trend-dominates guard). Both are *already computed for every band survivor* in
  `renderMode` — the amplitude lane's post-fetch pricing has zero-new-fetch inputs.
- **Trend-vs-oscillation guard** — `hourProfile().trendDominates` is literally the "a trending
  item's 'amplitude' is drift" test (|daily-low drift/day| ≥ `TREND_DOM_FRAC`×amplitude), and
  value's `knifeDelta` (js/valuescreen.mjs) + `trajectoryFrom1h` are the decline-in-progress
  guards. No new regime math needed.
- **Deployable capital** — `derive-cash-tiers.mjs` `deployablePool`, already threaded into the
  screen as the value `--capital` default and `THROUGHPUT_CAP_GP` (screen-flip-niches.mjs
  ~L155–215). The per-slot cap pattern (`--capital ÷ --slots` → `VALUE_CAP_GP`) is directly
  reusable.
- **Deployable-units bound** — value's three-way min in `valueScore` (`capGp/buyLow`,
  `VALUE_VOL_SHARE × limitVol × days`, `limit × windows/day × days`) is the exact shape §2.2
  needs; `expUnits` (gatecandidates.mjs) is the same physics at the churn grain.
- **Anchor-nudge** — `anchorNudge` (`pipeline/probes/anchor.mjs`), injected into `estimatePair`
  as the final step. **Reach-fold** — `js/estimators/sell-models/reach-fold.mjs` via the
  `SELL_TOP_MODELS` registry inside `estimatePair`'s shell (PC3). Both reusable — BUT see §2.3:
  `estimatePair` prices the `opt` (2h-band) or `term` basis; amplitude posting daily-quantile
  levels either rides the value pattern (surface computes its own pair; `priceBasis:'term'`-like)
  or adds a 4th `priceBasis` value. Small registry-vocabulary change either way.
- **Rank/grade spine** — `estimateRank`/`rankScore` + the `ESTIMATORS` family registry
  (js/estimators/families.mjs) and `rateItem`/grade (js/rating.mjs). §2.2 slots amplitude in as
  a family instead of building `ampScore`.
- **Break-even floor** — `breakEven()` (js/quotecore.js), already the non-skippable shell floor
  in `estimatePair`.
- **Suggestion logging + retro join** — `suggestlog.mjs` (`suggestionEntry` + shadow fields) and
  `retrojoin.mjs`/`analyze-record.mjs` for §4's realized-fill half.

**Genuinely new (unavoidable, kept small):**
- The `amplitudeGate` + amplitude-edge math itself (the recent-5d median daily-amplitude read +
  the two-stage proxy/confirm split below) — a new pure lib mirroring `valuescreen.mjs`'s shape.
- The `'amplitude'` estimator family entry (a `pFill`/`ttf`/`lapUnits` triple — ~30 lines against
  existing helpers).
- Registry vocabulary: `gate:'amplitude'` in `VALID_GATE`, `'amplitude'` in `VALID_ESTIMATORS`
  (+ mirror in `ESTIMATOR_FAMILIES`), possibly a `priceBasis` value; the spec entry itself; the
  render table (a `renderValueMode`-style term-structure sibling).
- Day-of-week bucketing for the 1.5-day experiment (§2.4) — no existing home.
- The shadow both-leg replay (§4/A5) — new joiner command, but it reuses the SQLite 1h archive
  and the `windowStats` vocabulary.

### 2.1 Gates (all must pass) — TWO-STAGE, like value's

**Structural constraint the draft missed:** at gate time the screen has only bulk data — the
corrected rolling-24h volumes (`loadAll24hRolling`), the 2h bands, and the daily archive
(`loadDaily`: whole-market /1h at **6h spacing** — 4 mid samples/day). Per-day TRUE hi/lo needs
the per-item 1h series, fetched only for the top-N pool. So the amplitude gate splits exactly the
way value's did (termStructure proxy pre-fetch → live/phase confirm post-fetch):

- **Stage 1 (pre-fetch, bulk archive) — amplitude PROXY:** recent-5d median of the daily
  (max-mid − min-mid) range off the 6h-spaced archive, thresholded at a *lower* placeholder than
  the true gate (the 4-samples/day grain attenuates the range — it misses intra-6h extremes AND
  reads mids, not hi/lo). Its only job is picking the fetch pool, exactly like `proxyDrift`.
  If the archive slice is cold, degrade honestly to no-candidate (value's `hasData:false`
  precedent), never to a fake amplitude.
- **Stage 2 (post-fetch, per-item 1h series) — the real gates, all off ONE
  `windowStats(series1h, { nights, wStart:0, wEnd:0 })` call:**
  - **Daily-amplitude gate** — recent-5d median of per-day `(hi − tax(hi)) − low` ≥ **~3%
    after-tax of the low** (PLACEHOLDER, n≈0). Computable directly from `stats.days` (each entry
    carries `{low, hi}`); the after-tax fold is the shared `tax()`. Measured on the DAILY range,
    NOT the 2h band — the edge band can't see.
  - **Both-leg daily reach** — the quoted bid touches on ≥2 of recent-3 days
    (`recencySplit(stats.days, 'bid', ampBid)`) AND the quoted ask prints on ≥2 of recent-3 days
    (`recencySplit(stats.days, 'ask', ampAsk)`), with the full-window count shown beside recent-3
    and the `staleOptimistic` flag honored (the reach-contamination guard, already built). Both
    thresholds PLACEHOLDER. This is the load-bearing viability test (§4).
  - **Stable / oscillating regime** — reject when `hourProfile().trendDominates` fires (drift
    swamps the swing) or the value-style knife read (`trajectoryFrom1h` /
    `knifeDelta > VALUE_KNIFE_PCT`-analog) says decline-in-progress. Oscillation around a flat
    level is the thesis; a trending item's "amplitude" is drift you get run over on.
- **Two-sided daily liquidity — reuse the existing count-matched pair, don't mint a number.**
  The non-negotiable `hpv>0 && lpv>0` two-sided gate stays, off the CORRECTED rolling-24h source
  (PLAN-VOL24 — the /24h endpoint is broken; volume is composed from /1h, default since step 2).
  The floor is the existing pair: unit floor `FLOOR` 3,500/day OR gp-flow `GP_FLOOR` 4.5b
  (both count-matched to corrected volume — any "~100/day" figure is a dead legacy-units number).
  **Consequence to state honestly:** the lane's big-ticket class is mostly BELOW the unit floor
  and admits via gp-flow — Masori body ~250/d × 42m ≈ 10.5b clears 4.5b — i.e. amplitude rows are
  largely **`thin`-class by construction**: they ride the bounded thin reserve and carry
  `THIN_GRADE_CAP` (A-) today. Either accept the cap (honest: you can only move a few units/day)
  or give the lane its own explicitly-argued exemption later WITH data — do not silently exempt
  at launch. Add the size leg: intended units ≤ ~10% of limiting-side vol/day (the
  `VALUE_VOL_SHARE`/`expUnits` mirror), so "enter+exit the intended size" is a checked bound,
  not prose.
- **Price window** — the lane needs its own: the shared default `MAX_PRICE` 45m nearly clips the
  anchor examples (Masori ≈42m; the class extends above 45m). Give amplitude a spec-level price
  window (min: a real capital-deployment floor à la `VALUE_MIN_PRICE`; max: none or high),
  rather than inheriting band's.

### 2.2 Ranking — an `'amplitude'` ESTIMATOR FAMILY, not a bespoke `ampScore`

The draft proposed `ampScore ≈ net_per_cycle × deployable-mult ÷ holdDays`. Pressure-tested
against the code, this is the standard rank in disguise, minus its most important term:
`rankScore` is `net × P(fill) ÷ TTF-days` — with TTF ≈ holdDays, `÷ holdDays` IS `÷ TTF`. The
band rank buried Masori not because of the formula but because its *inputs* were 2h-basis
(2h-band pair, intraday reach, intraday TTF prior). And the draft's version drops `P(fill)`
entirely — the exact term its own §4 calls make-or-break (a gate that passes ≠ a round-trip that
completes). Building `ampScore` would also fork a second ranking composite to tune (the
valueScore-vs-rankScore duplication §6 flags, repeated a third time).

**So: register `'amplitude'` in the `ESTIMATORS` family registry** (js/estimators/families.mjs)
and let `estimateRank`/`rateItem`/suggestions logging work unchanged:

- **`pFill`** = the two-leg product at the quoted daily pair: bid-touch fraction ×
  ask-reach fraction, recent-3-weighted with the full window as the sample-size backstop (the
  `reachRead`/`recencySplit` idiom `estimatePair` already uses). This makes the honest "will the
  round trip complete?" number the FIRST-CLASS rank input from day one, and it self-reports its
  thinness (`n` = scored days). Basis label `'daily-reach-2leg'`. Note this *replaces* the
  Proposal-A ask-reach discount rather than stacking on it — set `fillShape` so the discount
  isn't applied twice (an `'asym'` fillShape would re-discount by ask reach; either mark the
  family exempt the way `symmetric` is at families.mjs:251, or fold the exit leg ONLY here —
  implementation must pick one and document it).
- **`ttf`** = the hold-horizon prior in seconds (`holdDays × 86400`, holdDays a spec/CLI
  parameter, default 1, experiment 1.5 — §2.4). PLACEHOLDER until the retro join measures
  realized cycle time.
- **`lapUnits`** = deployable units — `min(capGp/ampBid, volShare × limitVol, limit-accumulation)`
  (value's three-way min; capGp = derived `deployablePool ÷ slots`, the existing `--capital`/
  `--slots` flow). This uses the hook churn already exercises (`estimateRank` multiplies
  `net × lapUnits`), so the rank is realizable after-tax gp/day of parked capital — the draft's
  intent — while per-unit net stays the displayed honest margin. Prefer raw bounded units over
  value's clamped-log `deployMult`: the min() is already bounded by the vol-share leg, and raw
  units keep the rank a gp-denominated quantity comparable with churn's lap rank.

Grade falls out of `rateItem` as usual (with the thin-cap consequence stated in §2.1;
`capitalFactor`'s big-ticket haircut also applies — fine, it's mild and honest).

### 2.3 Pricing (the godsword playbook, encoded)

- **Buy** at the daily-trough reach level — `quantLow`/`recentQuant(days,'bid',p,3)` off the
  full-day `windowStats`, cross-checked against `deriveDiurnalRange`'s dip level, timed to the
  diurnal trough window (`hourProfile().dip` — already computed per survivor).
- **Sell** at the daily-peak reach level (`recentQuant(days,'ask',p,3)` /
  `hourProfile().peak`), timed to the diurnal peak window.
- Break-even floor unchanged (`breakEven()` in `js/quotecore.js`); never list below it — this
  comes free if the pair is emitted through `estimatePair`'s shell (BE floor + ordering clamps +
  `anchorNudge` are the shell's, non-skippable).
- **Price-basis wiring (the one real seam):** `estimatePair`/`quotedPair` know
  `'quick'|'opt'|'term'`. Amplitude posts daily-quantile levels — either (i) ride the `'term'`
  pattern (the surface computes its own pair, like `renderValueMode`), or (ii) add a
  `'daily'` basis to `VALID_PRICE_BASIS`+`quotedPair`. Prefer (ii) if amplitude rows should get
  the estimator-pair console cells; (i) is less code. Implementation decision, flagged not
  hidden.
- Anchor-nudge + reach-fold reuse confirmed (§2.0) — no new pricing math beyond the quantile
  picks.

### 2.4 Hold horizon + the 1.5-day experiment

- **Prefer same-day both-leg fill** (buy the trough, sell the peak, same local day).
- **Do NOT require it** (Ben). Experiment with **~1.5-day holds**: fill the buy on day 1's
  trough, sell into day 2's peak. Make `holdDays` a spec/CLI parameter so the experiment is a
  flag, not a fork (it feeds the family `ttf` and the §4 horizon).
- **Day-of-week seasonality is NEW CODE** (corrected — §1): a weekday-bucketed sibling of
  `hourProfile`'s day machinery (per-weekday median daily hi/lo/amplitude over ~3–4 weeks of the
  1h archive; n≈3–4 samples per weekday cell — state that n every time it prints, rule 4). Ship
  it as part of the experiment chunk (A3), NOT the launch gate — the lane works at holdDays=1
  without it.

## 3. value → invest (rename + deprecation-watch)

- **Rename `value` → `invest` — LABEL AND DOCS ONLY at first; keep the spec KEY.** Ground truth:
  the string `value` is a load-bearing KEY in `FLIP_NICHES` (`--mode value`, `gate:'value'`
  routing at three dispatch sites in screen-flip-niches.mjs, `estimator:'value'`,
  `rank:'value'`), and — the real cost — it is written into **`suggestions.jsonl` history and the
  replay goldens**. A key rename forks the retro record (`analyze-record`/`retrojoin` rollups
  split into two lanes) unless an alias map is added everywhere. So: phase 1 renames the `label`
  ('Invest'), the skills/docs/GLOSSARY prose, and optionally accepts `--mode invest` as an alias;
  the `value` key + module/constant names migrate only if/when a suggestions-ledger alias map is
  built (probably never worth it). It *is* investing — a capital-commitment bet on a multi-week
  cycle that may not complete — and the display name should say so; the ledger key doesn't have to.
- **Keep it, lowest priority, explicitly experimental.** Retro (since 2026-07-08): value =
  **15,018 suggestions → 1 fill → +37.9k realized → +3 per-attention** — the weakest per-attention
  of any lane that produced anything, and the 2nd-most expensive to compute. (Honesty: 0%-taken
  everywhere; this is "hasn't earned its keep," not proof it's worthless.)
- **THE SWAP DECISION (Ben, 2026-07-19) — disable value in `--mode all`, run amplitude in its
  slot.** Rather than *add* amplitude as a second fetch-heavy lane alongside value (value and
  amplitude share the same expensive two-stage fetch-then-confirm cost structure), **swap them**:
  amplitude takes value's slot in the `--mode all` default composition. This is cost-neutral (the
  scan's fetch budget stays flat — we spend the same compute on a lane Ben will actually trade
  instead of one taken once ever) AND it's a clean head-to-head (amplitude inherits value's exact
  slot, so per-attention is compared on equal footing). Mechanics — **it's a toggle, not a
  delete:** flip value's `inAll` OFF and amplitude's `inAll` ON in `FLIP_NICHES`; `value` stays
  fully runnable via explicit `--mode value` (nothing removed, the `value` KEY + retro history +
  replay goldens are untouched, reverting is one word). value's suggestions simply stop *logging*
  while disabled; its historical record is intact. Honest cost of the swap: value's one unique
  lane — the truly-illiquid multi-week bet amplitude's daily-reach gate won't surface — goes dark
  during the trial, but at 1 fill / +37.9k ever, that's no real loss and it's a `--mode value`
  away. **Decide value's fate on the head-to-head per-attention after amplitude has a few weeks of
  record** (§6 note: the two share most of their gate/rank vocabulary — the comparison is clean).

## 4. Honesty / risk (process rule 4)

- **n ≈ 0.** Every threshold here (3% amplitude, the Stage-1 proxy threshold, the recent-3
  both-leg reach counts, the ~10% vol-share size leg, holdDays 1/1.5, the family's pFill/ttf
  shapes) is a PLACEHOLDER. This lane is a hypothesis, surfaced inform-first until it has a
  record. Do not cite any constant as validated.
- **The one make-or-break empirical question:** *do both legs actually fill within the hold
  horizon, repeatably?* The band model's pessimism (P~0.06 at 2h) is partly RIGHT — you won't
  fill fast. The daily low/high ARE reached each day, but not at predictable times, so same-day
  round-trips aren't guaranteed. The gate (§2.1) measures "the levels printed"; §A5 measures
  "the round trip completes" — and the gate passing ≠ the round trip completing (queue position,
  size, the peak printing before your buy fills). **The measurement (concrete, two tracks):**
  1. **Shadow both-leg replay (n-rich, zero fills needed):** every surfaced amplitude pick logs
     `{ampBid, ampAsk, holdDays, bidTouchRecent, askReachRecent, dip/peak windows}` to
     `suggestions.jsonl` (the existing `suggestionEntry` + a lane shadow block). A joiner (new
     command, mirroring `join-outcomes`/`f1-calibrate`'s shape) replays each pick against the
     NEXT `holdDays` of the 1h archive: leg-1 would-fill = a daily low ≤ ampBid printed in the
     horizon; leg-2 would-fill = a daily high ≥ ampAsk printed AFTER the leg-1 day, within the
     horizon. Report the both-leg rate, per holdDays. HONESTY LABEL, always attached: a printed
     level ≠ your fill (no queue/size model) — this is an UPPER BOUND on the realized rate, the
     cheap falsifier: if even the upper bound is low, the lane is dead; if high, it earns the
     realized test.
  2. **Realized rate (small-n, the truth):** the picks Ben actually takes flow through the
     existing fills pipeline; `retrojoin` (with the multi-day horizon it already has —
     `HORIZON_MULTIDAY_SEC`) attributes buy→sell round trips to the lane's suggestions. Report
     realized both-leg completion + realized cycle time (which calibrates the family `ttf`)
     beside the shadow upper bound in `/analyze`. Never oversell: at launch this column is
     n=0 and says so.
- **Console-only + inform-first at launch**, like value/scalp were — excluded from
  `screen.json`, no app tab, no auto-bid, all new validators inform-mode (the registry's
  documented n≈0 rollout convention), until the record supports promoting it. Surfacing follows
  the `/scan` provisional-lane pattern (the "PROVISIONAL, n≈0 — don't trade on it yet" framing
  value/scalp carry, plus the actionable-first output discipline: amplitude picks are patient
  multi-hour plays — they list under deploy/accumulate, never as act-now rows). Never oversell a
  pick off the daily-range alone; state the thin-class unit reality (~a few units/day) on every
  big-ticket row.

## 5. Rough shape of the work (chunks — for the Opus implementation pass, after Ben reacts)

- **A1** — `amplitudescreen.mjs` (js/, valuescreen's shape): Stage-1 proxy + Stage-2
  `amplitudeGate` off `windowStats` (daily-amplitude median, both-leg `recencySplit` reach,
  trend/knife guard) + the deployable-units min(). Pure, fixture-tested, no fetch.
- **A2** — registry + screen wiring: the `amplitude` spec in `FLIP_NICHES` (gate:'amplitude',
  estimator:'amplitude', its own price window, **`inAll:true` — THE SWAP (§3): amplitude enters
  the `--mode all` default set and `value`'s `inAll` flips to `false` in the same change** (value
  stays reachable via explicit `--mode value`); still console-only/inform-first (excluded from
  `screen.json`, no app tab) at launch per the provisional-lane convention); `gateCandidates` routes `gate:'amplitude'`
  (the `gate:'value'` seam); the `'amplitude'` estimator family in `ESTIMATORS`; the term-
  structure-style console table (trough-bid / peak-ask / both-leg recent reach / hold horizon /
  net-per-cycle / deployable units / grade). Conformance suite picks the spec up for free.
- **A3** — `holdDays` parameter + the 1.5-day experiment path, including the NEW day-of-week
  bucketing read (weekday sibling of hourProfile; n-per-cell stated).
- **A4** — value → invest **label** rename (label, skills, docs, GLOSSARY; `--mode invest`
  alias). The `value` KEY stays (see §3 — the suggestions ledger/goldens fork). **Includes THE
  SWAP: `value.inAll = false`** (paired with A2's `amplitude.inAll = true`) — the toggle that
  takes value out of the `--mode all` default while keeping `--mode value`/`--mode invest`
  runnable. Reconcile the `/scan` skill's `--mode all` niche list (band+churn+value → band+churn+
  amplitude) and any doc that enumerates the default set.
- **A5** — the §4 measurement: the lane shadow block on `suggestions.jsonl` + the shadow
  both-leg replay joiner + the retrojoin lane rollup into `/analyze`.
- **A6 (from §6, cheap, do it while in there)** — extract the shared candidate-loop boilerplate
  (two-sided check, price window, thin/gp-flow classification) that `gateCandidates` and
  `gateValueCandidates` duplicate into one helper all three gate stacks call. Replay goldens pin
  byte-identity.
- **Docs** — README inventory (every new file), MARKET-ANALYSIS (new lane + the cycle-period
  frame + the reconciliation pass over the gates/rank sections), `/scan` skill (the amplitude
  judgment layer, provisional framing), GLOSSARY (amplitude/invest). No `APP_VERSION` bump —
  console-only pipeline (confirm nothing app-imported changed at implementation; the registry IS
  app-imported, so the spec addition needs the smoke test green — check whether a registry-only
  addition trips the app's conformance/bundle expectations).

## 6. THE ANSWER — is the cycle-period unification real or forced?

Short version: **the frame is genuine; the proposed implementation (a `cycle=<t>` engine) is
forced. The genuine version of the unification already exists in the codebase — deepen it instead
of replacing it.**

### 6.1 Where "same operation, different period" holds cleanly — and where it breaks

**Holds cleanly — band / amplitude / value(invest).** Verified against the code, these three
really are one operation at three periods. Each has: an amplitude-of-cycle edge (band's
`bandCore` net over the 2h band; amplitude's daily-range net; value's `afterTaxAmpPct` over the
recency-anchored floor→ceiling), a two-sided-liquidity + reach viability test, a
trough-entry/peak-exit pricing doctrine (band low / daily trough / durable q15 floor), a
knife-or-trend guard scaled to the period (band's falling-exclusion, amplitude's
trend-dominates, value's knifeDelta + trajectory gate), and a capital-aware rank (band's
capital-aware `expGpDay` pool-order + rank; value's `deployMult`; amplitude's `lapUnits`). The
period even predicts the guard's form — exactly the draft's corollary.

**Breaks — churn, on three code-verified axes, not one.** The draft flagged churn's volume/limit
edge; the code shows the misfit is deeper:
1. **Edge source:** `churnEdge` has *no ROI/amplitude gate at all* — `CHURN_MIN_VOL` (65k
   corrected units/day) + `limit != null` IS the gate. There is no "cycle low/high" being bought
   and sold; the margin is whatever the band gives, volume does the work.
2. **Rank unit:** churn ranks the LAP (`churnLapUnits` — the buy limit is a *fact*), not a
   cycle's amplitude on parked capital.
3. **Fill shape:** `fillShape:'symmetric'` exempts churn from the ask-reach discount, the
   `REACH_GRADE_CAP`, and both `estimatePair` fold legs (families.mjs:251, pair.mjs AC5/AC6) —
   the whole reach vocabulary the other three lanes share *mismeasures* churn by design.
   A `cycle=t0` preset would have to carry all three exemptions as special cases — that is the
   leaky-abstraction signature. Second breaker: **scalp** (a falling-market directional flip —
   `confirm:'falling'`) is also not a cycle-period point; it's a regime bet. The continuum
   describes 3 of the 5 lanes.

### 6.2 Does a single cycle-parameterized core reduce the REAL duplication?

What the duplication actually is, from reading the code:
- `gateCandidates` vs `gateValueCandidates` (gatecandidates.mjs) — ~25 lines of genuinely
  duplicated candidate-loop boilerplate each (two-sided check, mid computation, price window,
  thin/gp-flow classification). A third gate stack (amplitude) would make a third copy.
  **A parameterized core WOULD collapse this — but so does a 30-line helper extraction (A6),
  without any new abstraction.**
- `valueScore` vs `rankScore` — two ranking composites. This plan already kills the third copy
  by putting amplitude in the estimator-family registry; the honest follow-up is migrating
  value's rank onto the same family spine someday (its `pFillValue`/`ttfValue` family already
  exists!), not building a cycle engine.
- `renderMode` vs `renderValueMode` — two render paths (~400 lines each). This is the biggest
  real duplication and the one a "one engine" story implies collapsing — but the columns
  genuinely differ per thesis (band's momentum/regime cells vs value's term-structure row), and
  PLAN-SCREEN-ARCHITECTURE / the `buildScreenNicheReport` seam is already the in-flight answer.
- **What would NOT collapse — the reason the engine is forced:** the three periods read three
  different DATA GRAINS with different acquisition cost and freshness: band's edge comes from
  the live 5m band walk (bulk, every pass), amplitude's from the per-item 1h series (survivors
  only, Leg B), value's from the daily/termStructure archive (bulk, warm). The `cycle=<t>`
  parameter does not unify *where the cycle's low/high comes from* — and fetch orchestration +
  grain handling is where most of screen-flip-niches.mjs's 1,558 lines actually live. A single
  core would immediately grow per-period grain branches inside it, i.e. the four explicit modes
  again, indoors and harder to see.
- **Threshold tuning is ALREADY one-place-per-lane:** the constants live as named exports in the
  lane's pure lib (DEFAULT_THRESHOLDS, VALUE_*, CHURN_MIN_VOL) with the spec routing in one
  registry. A cycle engine would turn N named constants into one table of per-period rows — a
  cosmetic reshuffle, not a reduction; the tuning work (F1, count-matching, retro-join) is
  per-lane either way because the DATA per lane differs.

**The key realization:** the repo already went through exactly this design argument at P4c/P5 and
landed on the right abstraction — a **declarative spec registry over shared machinery**, where a
lane = {edge fn, gate route, estimator family, falling doctrine, price basis, fill shape,
validator plan}. That IS the cycle-parameterized core, with "cycle period" implicit in which
grain the edge/gate/estimator read. It has already absorbed two lane additions (scalp, value)
and two deletions (spread, rising) without touching the dispatch code — the extensibility the
`cycle=<t>` idea is reaching for, demonstrated rather than hypothesized.

### 6.3 Migration: incremental, and the first step is this plan

- **Amplitude as a 4th spec** (A1/A2) exercises every seam the unification needs: a new gate
  route (2nd non-band gate), a new estimator family (5th), a new price basis. If the seams take
  it cleanly — as they took value — that's evidence the registry is the right core.
- **A6** (the gate-boilerplate helper) banks the one real dedup immediately, goldens-pinned.
- **Later, if wanted:** migrate value's `valueScore` rank onto `estimateRank` (its family
  already exists), then merge the render paths behind `buildScreenNicheReport`. Each step is
  independent and reversible. **Nothing here is all-or-nothing**, and at no point does a
  `cycle=<t>` engine need to exist.
- **Churn stays outside the continuum permanently** — and that's fine; the registry doesn't
  require lanes to be the same operation, only to declare their shape.

### 6.4 Recommendation (the honest trade-off)

**Build amplitude as a 4th declarative mode now — option (a) — but implement its internals the
registry-native way (estimator family + gate route + shared helpers), which quietly IS option
(b) in the only form (b) is true.** The trade-off honestly stated: a literal parameterized core
would buy a tidier STORY and one less gate-loop copy, at the cost of special-casing churn+scalp
inside it, threading data-grain branches through one engine, re-golden-ing four lanes at once,
and betting the refactor before amplitude has proven the 24h thesis has any realized edge
(n≈0 — §4). The registry path buys the same tuning-in-one-place and the same extensibility,
costs one small extraction (A6), risks nothing that isn't goldens-pinned, and leaves the
unification available later if amplitude's record earns it. Use the cycle-period frame where it
genuinely pays: **docs and vocabulary** (MARKET-ANALYSIS's find-doctrine section should present
band/amplitude/invest as one operation at three periods, churn+scalp as the two off-axis
lanes) and **threshold naming** (amplitude's constants should visibly parallel value's so the
per-period comparison stays legible).

## 7. Handoff chain (Ben's plan for this work)

1. **(this doc)** — draft plan.
2. **Fable** — validate + harden §1–§5, answer §6. ✅ this revision.
3. **Ben + Claude** — react to the hardened plan (open decisions: §2.3 price-basis (i) vs (ii);
   §2.1 thin-cap accept vs argue-later; §3 label-only rename OK?; A6 in-scope?).
4. **Opus subagent** — implement the agreed chunks; Claude validates each commit + handles
   landing.
