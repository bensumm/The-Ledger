# PLAN-LANE-ADMISSION — structural fetch-pool admission + per-lane gp/day ranking

Status: **admission validated (this session), ranking spec DRAFTED, build not started.**
Owner-driven design session (Ben, 2026-07-25). All numbers below were derived against the live
bulk caches (`pipeline/.cache/{guide,mapping.cache,all24h-rolling,latest}.json`) and validated
against the real book (`positions.json` closed/open + `fills.json` + `watchlist.json` = **60
distinct flipped/watched items**).

## Why (motivation)

The current fetch-pool gate (`gatecandidates.mjs` `gateCandidates` + `admission.mjs`
`pickFetchPool`) mixes **edge thresholds into "what to fetch"**: two-sided `hpv>0 && lpv>0` AND
(`volDay ≥ 3500` OR `volDay×mid ≥ 4.5b` gp-flow), then post-fetch ROI/gpDay/net gates. The
`volDay×mid ≥ 4.5b` turnover floor is a **crowding-out mechanism** — a genuine thin edge only gets
looked at if it *also* has enormous raw turnover (the documented Abyssal-bludgeon / Sanguinesti
starvation incident, `admission.mjs` header).

Head-to-head over the whole tradeable universe:

| | current gate | new gate |
| --- | --- | --- |
| pre-fetch pool | 1,414 | **917** |
| real-flip recall (of 60) | 55/60 | **59/60** |
| newly recovered | — | 208 starved thin-gear + the 182-item "Dragon scimitar" mid-tier |

The new gate is **smaller and higher-recall**: it admits on *structure* (two-sided depth + money-
flow), edge-agnostic, so nothing with a real book is starved. Edge judgment moves entirely to a
separate **ranking** stage.

## The validated admission system

**One universal structural gate, then a volume-based lane split. No edge computation at admission.**

```
UNIVERSAL (bulk, no per-item fetch):
  value       ≥ 100 gp                       # dust cut
  thin-side   ≥ max(limit, 25)               # two-sidedness + reliability; thin = min(hpv, lpv)
                                             #   null-limit → max(0,25)=25 (fallback)
  notional    = value × volDay ≥ 25m/day     # "enough money moves here to bother" (2-D liquidity)

LANE = volume (the margin-regime discriminator):
  volDay ≥ 20k  → CHURN lane   (high-turnover; margin harvested intraday)
  volDay < 20k  → GEAR  lane   (low-turnover;  margin harvested over multiple days)
```

Result: **961 admitted (gear 498 / churn 463), 59/60 real-flip recall** (the 1 miss —
Defence potion(4), 709/day — is a correct thin drop).

### Why each rule (the hard-won lessons — do not "simplify" these back out)

- **thin = min(hpv, lpv), an ABSOLUTE floor — NOT a balance RATIO.** A ratio (`min/max`) mis-flags
  hugely-liquid-but-lopsided items as ghost books: bird nests (thin 72k–184k) and moon armour sets
  read 0.16–0.36 by ratio but are trivially crossable. The real question is "can I fill a limit's
  worth on the thin side?" → absolute depth. `thin ≥ max(limit, 25)` also kills the true ghosts
  (Silver bolts unf 14.3k/**0**, Swamp toad **1**/16.2k). NOTE: MIN_THIN was 50, lowered to **25**
  after the before/after pass showed 50 clipped real high-value thin gear (Torva set thin 39,
  Imbued heart 49, Blade of saeldor 38 — you flip 1–2 units of a 500m item, so 39/day is plenty).
  The notional floor + `thin ≥ limit` independently cut ALL the junk (Halloween mask, damaged Torva
  variants) even at MIN_THIN 0, so the higher floor was redundant harm — same failure shape as the
  value floor. 25 keeps a reliability floor (~1 thin-side trade/hr) without amputating big-ticket gear.
- **notional (value × volDay), NOT a value floor, NOT a volume floor.** The three cases don't
  separate on either axis alone: Twisted bow (low vol 300 / high val 1.47b), Dragon scimitar
  (moderate/moderate), Halloween mask (low/low junk). Only money-flow separates them —
  twbow 441b, dscim 385m, halloween mask 1.0m. A single-axis **value floor (100k) silently
  amputated the entire Dragon-scimitar mid-tier (182 items)** — found via the before/after pass.
- **Lane = volume, not value.** Our real flips clustered <8k/day (gear) and >45k/day (churn) — but
  that "clean gap" was an **artifact of our own biased book** (we trade big gear + hyper-liquid
  runes, not the populated middle). Volume *is* the turnover that makes margin multi-day vs
  intraday, so it's the right regime signal; value is not (a 4m item at limit-8 trades like gear, a
  10k item at 1.14m/day trades like churn).
- **null-limit → thin ≥ 25 fallback (not exclude).** ~89 newer gear items (Webweaver, Basilisk
  jaw, Magus/Ultor/Bellator/Venator rings, Bow of faerdhinen, Oathplate, Sunfire fanatic) have
  `limit=null` in the mapping; hard-excluding them dropped real flips.

## Ranking spec (DRAFT — DUAL-PATH, build target)

Admission is edge-blind by design; **ranking is where edge decides.** An item is ranked on a
**comparable after-tax gp/day** (profit per day of deployed capital) so the 961 sort into one list.

### Two paths per item — NOT two lanes, NOT competing metrics

The realized ground truth (positions.json closed lots, n=316, 3 weeks) forced this reframe. Every
item potentially offers TWO distinct plays; the ranking carries both and never collapses one into
the other:

- **PATH A — intraday flip (the CALIBRATED base rate).** Buy and sell within the day; margin is a
  fraction of the intraday daily-range. **Validated**: lots held <12h win **88–92%** and printed
  **+29.5m**; realized margin ≈ **0.45× (gear) / 0.62× (churn)** of the fetched intraday range (a
  `captureFrac`). This is the sortable, trustworthy number.
- **PATH B — amplitude swing (theoretically sound, NOT YET VALIDATED).** Buy near the multi-day
  floor, sell near the ceiling over days. **n≈0 executed** — Osmumten's fang (2026-07-21) was the
  first real attempt. The data is **SILENT, not negative**, on Path B: the only long holds in the
  record are **stuck-bags** (fast flips that didn't fill and were held underwater — the 12–48h
  bucket wins just **43%** and is **net −1.7m**), concentrated in update-cycle gear dumps
  (fang/hydra/blowpipe) — a *diagnosed, safeguardable* failure, not evidence against swings.
  Path B is carried **descriptively** and must **accrue its own outcomes** before it moves a ranked
  number (F1 / join-outcomes discipline — do NOT gate a strategy out at n≈0).

**Do not repeat the session's mistake**: the multi-day swing bands (p80−p20 … max−min) overstate
*realized* margin **5–12×** — because we mostly capture the intraday range, not the full swing. The
swing is Path B's *theoretical* ceiling, not Path A's margin.

### Path A — the calibrated gp/day (one unified formula, both former lanes)

The former gear/churn split stops being different margin math and becomes **where the item sits on
one throughput axis** (gear = few cycles / big units; churn = many cycles / small units):

```
margin/u   = intradayDailyRange × captureFrac            # ~0.5; calibrate 0.45 gear / 0.62 churn
             intradayDailyRange = robust p-band of per-day (high − low), after tax   [bulk /1h walk]
units/cyc  = min(buyLimit, capital ÷ price)              # 0 if unaffordable — never floor to 1
cycles/day = throughput-bounded (buy-limit refills ∧ volume-feasible)   # gear few, churn many
gp/day     = margin/u × units/cyc × cycles/day
null-limit fallback: infer limit from volDay (e.g. volDay/24)
```

### Path B — the amplitude/optionality overlay (inform, until it earns outcomes)

- Surface, per item, whether a **genuine multi-day floor→ceiling swing** exists (the oscillator /
  amplitude read) — separately from Path A's gp/day, never folded into it yet.
- **Dual-path optionality is a RISK DISCOUNT, not extra revenue.** When BOTH paths are genuinely
  present, a fast flip that doesn't fill isn't a loss-in-waiting — it exits at the swing later. That
  bounds the downside of patience, which **licenses more optimistic pricing / fuller sizing**. But
  only **when the second exit is real** — a flat/ranging floor with a reachable ceiling, NOT a
  falling-knife/update-dump where the "floor" is an illusion (the exact shape of every stuck-bag
  loss). The floor-is-real / anti-stuck-bag gate is MANDATORY for any optionality credit.
- Anchor (Ben, 2026-07-25): a prior Ancestral hat **sold at 57m instantly** — the fast path can
  catch the range *ceiling* on a good window, not just the median clear. So Path A's realizable
  price has real upside variance on a ranging item (the reachable-ceiling, not only the p50 clear),
  and that upside is part of why the optionality is cheap to hold for.

### Common overlay (reuse existing infra — do NOT reinvent)

```
- Path A gp/day → the single cross-lane ranking number
- existing grade (net × P(fill) ÷ TTF) + reach = a QUALITY discount on Path A gp/day, never a gate
- existing 500k gp/day attention floor (MIN_GPD) = post-rank surfacing cut on a CLEAN pool
- anti-stuck-bag / floor-is-real gate = REQUIRED before any Path-B optionality credit
```

The one genuinely new build is the **robust intraday daily-range margin × captureFrac off the bulk
`/1h` archive walk**; TTF, grade, reach, expGpDay plumbing all already exist. Path B reuses the
existing oscillator/floor-ceiling reads, kept inform-only until its outcomes accrue.

### Validation status (this session)

- **Path A calibrated + validated** against realized P/L (captureFrac 0.45/0.62; <12h 88–92% win).
- **Setup #1 (swing/TTF) FAILED** across-boundary comparability (gear ~10× overstated — TTF is
  fill-latency, not the swing period). Setup A/B/C compared; **B (intraday) is the right shape**,
  A/C (swing) describe an unvalidated Path B.
- **captureFrac 0.45/0.62, n=13/12** — modest, own-book-styled (fast-flip biased). PLACEHOLDER
  (rule 4); re-calibrate as outcomes accrue, and re-check whether it's stable across volatility.

## Ranking-phase requirements (Ben, 2026-07-25 — hard requirements, not optional)

1. **Rank-validation within AND across lane boundaries** — confirm an item's real potential maps to
   its rank, and that a churn item and a gear item at the *same* gp/day are genuinely comparable
   (the boundary is where a bad metric hides).
2. **Metric-choice discipline per data point** — for EVERY number ask: is this a median / high /
   low / average, and is that the right statistic for what this gate/rank is trying to capture?
   (The median-vs-p90 and value-floor-vs-notional lessons applied everywhere.)
3. **Many ranking setups, validated** — not one formula asserted; experiment and check.
4. **Before/after each change** — what are we excluding now that we weren't, and including now that
   we weren't; examine the items, not just the counts (this pass already surfaced the 182-item
   hole).

## Forward-accrual harness — the ONLY valid ranking metric (Ben-approved, 2026-07-25)

**Why this exists.** Ranking CANNOT be validated retrospectively. A rank-order test against realized
daily-ROI on the closed lots gave **Spearman 0.11** (n=25) — not because the model is necessarily
bad, but because realized daily-ROI is **behavior-confounded**: it's dominated by *when we happened
to sell* (holdDays), not the item's intrinsic potential. So the only honest success metric is
**forward**: log what the ranking said, join it to what actually happened later, score the
prospective correlation. This mirrors the SHIPPED **WC1/WC2** pattern (`windowExit` logged forward,
`join-outcomes` scores which signal predicted a fill) and `join-amplitude-outcomes.mjs`.

**H1 — the forward field (lean-included, `suggestlog.mjs` schema).** At rank/emit time, the screen
(and quote/watch where a ranked gp/day is computed) appends a `pathA` object to the suggestion line,
following the exact lean-included precedent of `windowExit`/`depthExit`/`reachable`:
```
pathA: { gpDay, marginU, captureFrac, cyclesDay, units, price, intradayRange, lane, rankInLane }
```
Present only when a Path-A number was computed; absent on older/other rows. IDs/prices/timestamps
only (public-repo/no-PII rule already holds for this ledger).

**H2 — the join scorer (`join-outcomes` extension, mirror `join-amplitude-outcomes.mjs`).** Joins
logged `pathA` to later `fills.json` outcomes and reports **(a) prospective rank correlation**
(Spearman of predicted gp/day vs realized) and **(b) calibration** (predicted/realized ratio, i.e.
whether captureFrac 0.45/0.62 holds forward). Gate-C style readiness (`--report`).

**H3 — the forward metric must NOT repeat the behavior confound (the crux, metric-discipline #2).**
The realized target the join scores against must be a property of the *item + model*, not of *when
we sold*. So it measures **whether the predicted intraday range actually materialized the following
day(s), and whether ~captureFrac of it was reachable** (from the fills we DID place + the realized
next-day range), NOT the raw realized-daily-ROI that just failed retrospectively. Decoupling the
metric from our sell-timing is the make-or-break design decision of this harness.

**H4 — the readiness gate (F1/SC5 discipline).** Path-A gp/day stays a **coarse tiering signal,
never a hard gate/auto-action**, until H2 accrues n ≥ threshold with a stable positive rank
correlation. captureFrac (0.45/0.62) is re-estimated FROM the forward join once n supports it,
replacing the retrospective placeholder. Until then: tiers, not precise ordering.

**Sequencing:** build Path-A margin (the `/1h`-archive intraday-range × captureFrac) → emit `pathA`
(H1) → build the join scorer (H2/H3) → accrue → gate/recalibrate (H4). H1 is cheap and can ship the
moment Path-A computes a number, so accrual starts as early as possible.

## Open items / honesty (rule 4)

- **notional 25m/day, thin-floor 25, vol-cut 20k are snapshot+own-book calibrated** — they sit in
  real gaps and hold 59/60, but are NOT outcome-calibrated. Re-check once ranking + real fills
  accrue (join-outcomes, à la SC5). In particular, `thin ≥ max(limit,25)` is a *reliability* line,
  not an outcome-validated one — items with thin 20–24 at high notional are the next boundary to
  re-examine if a real flip turns up there.
- **Before/after DONE twice** (value-floor gate → found the 182-item hole; notional gate → found
  the MIN_THIN-50 second hole, now fixed at 25). No third hole at the current cut; re-verify after
  any further threshold change.
- **`/1h` archive multi-day depth** — confirm the archive holds enough history to compute a stable
  daily-range for the whole universe cheaply (the ranking margin's data source).
- Relationship to the existing `pickFetchPool` / `rankAndSlice` / mode stack (band/churn/value/
  amplitude) is a REPLACEMENT of the pre-fetch gate + a reframe of the lanes; the ranking overlay
  reuses expGpDay/grade/reach. Migration/rollout (behind a flag, fixtures) is unscoped here.

## Hardening findings (Fable, 2026-07-25)

Reconciled every load-bearing claim against the actual code (file:line). One correction, one
naming collision to fix in the build, everything else holds.

1. **`/1h` bulk daily-range — CONFIRMED FEASIBLE, empirically verified live against the real
   archive (not just read of the code).** `pipeline/lib/archive.mjs`'s `observations` table stores
   raw per-item-per-hour `avgHighPrice`/`avgLowPrice` (archive.mjs:63-73, invariant 3) with an index
   on `(grain, itemId, ts)` (archive.mjs:73). A bulk aggregate query —
   `SELECT itemId, date(ts,'unixepoch') d, MAX(avgHighPrice) hi, MIN(avgLowPrice) lo FROM
   observations WHERE grain='1h' AND ts>=? GROUP BY itemId, d` — is NOT a function that exists
   today (no bulk-aggregate method on the archive handle; `seriesFor` is per-item-only,
   archive.mjs:150-160) but is a straightforward ADD. Verified live against the actual
   `pipeline/.market-archive.sqlite`: **306 distinct 1h buckets since 2026-07-13, 1,724–3,303
   items/bucket, full 24/24-hour coverage every day from 2026-07-13 onward** (spot-checked via a
   throwaway script, not committed); the aggregate query above ran in **429ms and returned 53,328
   whole-market daily-range rows** for that window. This is the concrete "bulk /1h archive walk"
   the plan asserts — it is real, cheap, and needs one new SQL aggregate method
   (`archive.dailyRangeBulk(ids, sinceTs)` or similar), not a per-item fetch.
   - **Caveat (the one correction): the "7–14 days" depth claim is right at the edge, not
     comfortably inside it.** `loadAll24hRolling` (marketfetch.mjs:303) — the mechanism that
     backfills full hourly coverage — is gated behind `--vol-source rolling`, which IS the CLI
     default (`screen-flip-niches.mjs:361`, `fallback: 'rolling'`), so it runs on every normal
     scan. But full 24/24 hourly coverage only started **2026-07-13** (12 days of history as of
     today, 2026-07-25) — before that, the archive only holds 4-8 buckets/day (the pre-existing
     `loadDaily` 6h-step regime-proxy archive, seeded from `.cache/daily/*.json`). So a 14-day
     lookback will silently thin out to sparser-than-intended coverage for the oldest ~2 days of
     any 14-day window today, and will only reach a genuinely comfortable 14-day depth around
     2026-07-27. **Recommendation: build the aggregate to accept a `days` parameter and report
     `coverageDays` (the actual number of full-24h days found), same honesty pattern as
     `loadDaily`'s `coverageWindows` (marketfetch.mjs:498) — never silently degrade sample depth
     without saying so.**
2. **Naming collision to fix before writing any code: "lane" means two different things.** The
   admission spec's "GEAR lane (volDay<20k) / CHURN lane (volDay≥20k)" is a NEW volume-regime split
   at admission time. The codebase already has a `churn` **mode/niche** (`js/flip-niches.mjs`,
   `FLIP_NICHES.churn`) with its own edge/rank/gate spec, entirely orthogonal (a mode is an
   edge-computation strategy; the new "lane" is a pre-edge structural bucket every mode's
   candidates would fall into). Call the new admission-time split something unambiguous in code —
   e.g. `volLane: 'low'|'high'` or `throughputLane` — never `mode` or bare `lane` reused near
   `FLIP_NICHES`. This is purely a naming-collision risk (a future grep for "churn" will hit both
   concepts), not a logic problem, but it will confuse the first executor who doesn't know both
   exist. Flagged so the Chunk-1 executor picks the name once, not twice.
3. **`gateCandidates`/`pickFetchPool` seam confirmed.** `eachLiquidCandidate` (gatecandidates.mjs:211-230)
   is the ONE shared iterator every mode's gate (`gateCandidates` band/churn path at :238,
   `gateValueCandidates` at :285, `gateAmplitudeCandidates` at :319) already funnels through — it
   does the two-sided-liquidity + price-window + thin-classification and calls back into a
   per-mode `fn`. The new universal structural gate replaces exactly this chokepoint's admission
   *criteria* (notional/thin/lane vs today's two-sided+floorVol/gpFloor), while the callback shape
   (`fn({id, limitVol, mid, ...}) → candidate|null`) and everything downstream (`spec.edge`,
   `rankAndSlice`/`pickFetchPool`, `surviveMode`) stays untouched — so a mode's edge computation
   never has to change to adopt the new gate. `--admission legacy` (admission.mjs) is a SEPARATE
   axis (pool ordering, not pool membership) from `rankAndSlice` vs `pickFetchPool` — the new
   structural gate needs its OWN rollback flag (e.g. `--gate structural|legacy`, defaulting to
   `legacy` until validated), independent of `--admission`. Both flags can coexist (2×2), matching
   this repo's existing precedent of flag-gated non-destructive additions (PLAN-SCREEN-ARCHITECTURE's
   `admission.mjs` landing beside `rankAndSlice` without deleting it).
4. **Fixture/golden blast radius is real and must be scoped up front.** `pipeline/test/fixtures/replay/golden.json`
   pins `gateCandidates`'s current per-mode output; `gatecandidates.test.mjs`, `survivemode.test.mjs`,
   `admission.test.mjs`, `subfloor.test.mjs`, `flip-niches.test.mjs` all assert against today's gate
   shape. A flag-gated new gate (default off) means these stay byte-identical and green with zero
   changes — confirmed the correct rollout shape for chunk sequencing (build new, prove it
   side-by-side, flip the default only after a before/after pass, per this repo's `--vol-source`/
   `--admission legacy` precedent).
5. **`expGpDay` is DEMOTED, not the live ranked number — Path A's gp/day is a NEW metric, not a
   rename.** `js/rating.mjs`'s header (rating.mjs:12) and `screen-flip-niches.mjs:44/70/82` are
   explicit: `expGpDay` was demoted at P6b to a **pre-fetch pool orderer only**; the actual
   displayed/ranked quality composite is `rateItem` (`js/rating.mjs:122`, `net × P(fill) ÷ TTF`,
   built on the P6b per-thesis estimator families in `pipeline/lib/estimators.mjs`, NOT expGpDay).
   The plan's "Path A gp/day → the single cross-lane ranking number" is therefore a genuinely NEW
   sortable quantity that must find its place ALONGSIDE `rateItem`'s existing grade — the plan's own
   "existing grade = a QUALITY DISCOUNT on Path A gp/day, never a gate" phrasing already gets this
   right, but a build chunk must not accidentally wire Path-A gp/day as a expGpDay rename (it isn't
   one — expGpDay folds in `expUnits`'s three-compounding-guess throughput math that P6b explicitly
   moved away from displaying).
6. **H1/H2/H3 precedent match confirmed exactly, with one important precision the plan doesn't
   spell out: H2 must mirror `join-amplitude-outcomes.mjs`, NOT `join-outcomes.mjs`.** Both exist
   and both "join" something, but they answer different questions —
   `join-outcomes.mjs` (join-outcomes.mjs:1-35) is CAMPAIGN-keyed, joins fills.json BACKWARD to the
   nearest prior suggestion, and its target (realized daily-ROI / fill-time cells) is exactly the
   BEHAVIOR-CONFOUNDED metric H3 says must not be repeated (dominated by when we happened to sell).
   `join-amplitude-outcomes.mjs` (join-amplitude-outcomes.mjs:1-26, 58-83) is SUGGESTION-keyed,
   joins FORWARD against the archive's OWN materialized future range (not our fills), and is
   PURE + fixture-tested with a clean `replayPick(series, pick, opts) → {resolved, pending, ...}`
   shape reading `db.seriesFor(itemId, '1h', {from, to})` (join-amplitude-outcomes.mjs:110) keyed on
   `(itemId, suggestion ts)`. This is the ONLY of the two that avoids the sell-timing confound, and
   it is the one the plan means — worth stating explicitly since a name search alone doesn't
   disambiguate them. `suggestlog.mjs`'s lean-included pattern (`if (x != null) e.x = x`, e.g.
   `windowExit`/`depthExit`/`reachable` at suggestlog.mjs:474-482) is exactly how `pathA` slots in
   (H1) — confirmed by direct read, not inference.

## Build chunks (HARDENED — Fable 2026-07-25)

Ordered; each chunk names its files, its integration seam, its gotcha checks, and whether it ships
something validated or a named PLACEHOLDER (process rule 4). **A** and **B** below are independent
of each other and of everything else — start both in parallel. Everything after depends on at
least one of them landing first, as marked.

### Chunk A — bulk daily-range aggregate off the `/1h` archive (independent, start first)
- **Files**: `pipeline/lib/archive.mjs` (new method on the handle, e.g.
  `dailyRangeBulk({ ids, sinceTs, db })` → `{ [itemId]: { [dateKey]: {hi, lo} } }` or a flat row
  array — pick whichever shape `pipeline/lib/marketfetch.mjs` callers want); a thin wrapper in
  `marketfetch.mjs` alongside `loadDaily`/`loadAll24hRolling` (e.g. `loadDailyRangeBulk(days, {db})`)
  that also reports `coverageDays` (the honesty field from finding #1).
- **Integration seam**: a NEW read-only method beside `seriesFor`/`marketAt` on the same handle
  object (archive.mjs:112-257) — no schema change, no write-path change (the raw observations table
  already has everything needed, per invariant 3). Zero interaction with `gatecandidates.mjs`/
  `admission.mjs` at this chunk — this is purely a new data-access function.
- **Gotchas**: keep it read-only (never touches `append`/`buckets`); must degrade honestly on a
  cold archive (empty result + `coverageDays: 0`, never throw) so fixtures/CI (which run against a
  temp/`:memory:` DB per archive.mjs:96-97's documented test isolation) get a clean empty result,
  not an error. Add to `pipeline/test/archive.test.mjs` with a synthetic multi-day fixture (per
  `exportFixture`'s round-trip shape, archive.mjs:177-193) — never test against the live
  `.market-archive.sqlite`.
- **Validated vs placeholder**: the QUERY is validated (measured live: 429ms/53k rows, finding #1).
  What days-of-history it can actually promise is honest-but-thin right now (12 days full coverage,
  growing) — surface via `coverageDays`, don't assert 14 in code/docs until it's true.
- **Docs**: update `README.md`'s archive.mjs entry (new method) and note `coverageDays` growth in
  this plan file if depth is still short when Path A ships.

### Chunk B — structural admission gate module (independent, start first)
- **Files**: new module, e.g. `pipeline/lib/structural-admission.mjs` (mirrors `gatecandidates.mjs`/
  `admission.mjs`'s existing split: pure, no fetch/fs, fixture-testable). Implements the universal
  gate (value≥100gp, thin=min(hpv,lpv)≥max(limit,25) with null-limit→25 fallback, notional=value×
  volDay≥25m/day) and the lane classifier (naming per finding #2 — NOT `mode`/`lane` bare;
  `volLane: 'gear'|'churn'` or similar, clearly commented as ORTHOGONAL to `FLIP_NICHES` modes).
- **Integration seam**: an alternate iterator with the SAME callback shape as `eachLiquidCandidate`
  (gatecandidates.mjs:211, `fn({id, limitVol, mid, ...}) → candidate|null`), selectable via a NEW
  flag independent of `--admission` — e.g. `--gate structural|legacy` (default `legacy`) — so
  `gateCandidates` (gatecandidates.mjs:232) can route to it without touching `spec.edge`/
  `rankAndSlice`/`surviveMode` at all in this chunk. Do NOT wire it as the default; do NOT delete
  `eachLiquidCandidate`.
- **Gotchas**: this chunk must NOT change `pipeline/test/fixtures/replay/golden.json` or any
  existing gate/survive/admission/flip-niches fixture (finding #4) — it's purely additive behind
  the new flag. Confirm with `--gate legacy` (or the flag omitted) that every existing test still
  passes unchanged. Add fixture tests exercising the new gate directly (synthetic v24 data), not
  against golden.json.
- **Validated vs placeholder**: the thresholds (25m/day notional, thin-floor 25, 20k vol-cut) are
  explicitly named PLACEHOLDERS in the plan's own "Open items" section — carry that forward in the
  module's header comment, don't upgrade their status here.
- **Docs**: README inventory entry for the new file at creation (process rule 8); note the
  `--gate` flag in `CLAUDE.md`'s ask→command table only once it's wired into a user-facing surface
  (not yet at this chunk — this chunk is library-only).

### Chunk C — Path-A margin/gp-day calculator (depends on Chunk A)
- **Files**: new pure module, e.g. `pipeline/lib/patha.mjs`. Implements `intradayDailyRange` (robust
  p-band of Chunk A's per-day high−low, after tax — reuse the existing `robustBand`/
  `BAND_EDGE_*` from `js/quotecore.js`, imported the same way `marketfetch.mjs:385` already does,
  rather than inventing a second percentile-band implementation), `marginU = intradayDailyRange ×
  captureFrac` (0.45 gear / 0.62 churn, PLACEHOLDER per finding/rule 4), `unitsCyc = min(buyLimit,
  capital÷price)` (reuse `expUnits`'s existing null-limit/volDay-inferred-limit fallback shape,
  gatecandidates.mjs:164-169, rather than re-deriving it), `cyclesDay` (throughput-bounded, mirrors
  the existing buy-limit-refill logic already in `expUnits`/`expUnitsOvernight`), and
  `gpDay = marginU × unitsCyc × cyclesDay`.
- **Integration seam**: standalone — takes Chunk A's daily-range data + `js/quotecore.js`'s tax/
  `robustBand` + mapping (buyLimit) as pure inputs; does not touch `gatecandidates.mjs`/
  `admission.mjs` in this chunk (wiring into the actual gate/rank pipeline is Chunk D).
  Explicitly NOT `expGpDay` (finding #5) — name it distinctly (`pathAGpDay` or similar) so no reader
  conflates the two.
- **Gotchas**: fixture-test against Chunk A's synthetic archive fixtures (no live data, rule 4);
  confirm the after-tax reduction reuses `js/quotecore.js`'s `tax()` (the ONE definition, per
  CLAUDE.md's market-analysis doctrine) rather than a re-implementation.
- **Validated vs placeholder**: captureFrac 0.45/0.62 are PLACEHOLDERS (n=13/12, own-book-biased,
  per the plan's Validation-status section) — must be named as such in the module header, not
  presented as calibrated. The daily-range-percentile math itself (robustBand reuse) is validated
  infrastructure.

### Chunk D — wire Path-A gp/day into a ranked, shown surface (depends on Chunks A+C; B optional)
- **Files**: `pipeline/commands/screen-flip-niches.mjs` (and/or `quote-items.mjs` per the plan's
  "quote/watch where a ranked gp/day is computed" scope) — add `pathA` computation per candidate,
  behind its own flag/mode gate (e.g. only computed when explicitly requested, given it's a NEW
  unvalidated number) so it never silently changes today's displayed grade/rank.
- **Integration seam**: Path-A's gp/day sits ALONGSIDE `rateItem`'s existing grade (finding #5) —
  reuse `js/rating.mjs`'s `gradeFor`/`capGrade` as the quality discount per the plan's "common
  overlay" section, and the existing `MIN_GPD` 500k floor (gatecandidates.mjs:61) as a post-rank
  surfacing cut, NOT a new gate. Whether this runs against the legacy pool or Chunk B's structural
  pool is an explicit choice this chunk must make and document (the plan defers this — "Migration/
  rollout... unscoped" — so this is the chunk that un-defers it).
- **Gotchas**: APP_VERSION bump required (CLAUDE.md rule 5 — this changes the deployed app's
  displayed surface, if `quote-items.mjs`/the app UI shows it; a pipeline-console-only addition may
  ship without a bump per rule 5's pipeline-stdout carve-out — decide per exact surface touched).
  CI: `checks` job's fixture/golden pins (finding #4) and `smoke` job (loads `index.html` headless)
  must stay green — if this touches any app-facing surface, run the smoke test locally first.
- **Validated vs placeholder**: the WHOLE Path-A number is placeholder-grade until H2/H4 accrue
  (captureFrac unvalidated) — ship it as an inform-only / secondary column, never replacing the
  existing grade/rank, matching the plan's explicit H4 ruling ("tiers, not precise ordering" until
  accrual).

### Chunk E — H1: `pathA` forward field (depends on Chunk C; independent of B/D)
- **Files**: `pipeline/lib/suggestlog.mjs` (`suggestionEntry`'s param list + the lean-included
  `if (pathA != null) e.pathA = pathA;` line, following the EXACT precedent at suggestlog.mjs:474-482
  for `windowExit`/`depthExit`/`reachable`); the emit call sites in `screen-flip-niches.mjs` (the
  `suggestionEntry(...)` calls at screen-flip-niches.mjs:1284/1654/1835/1952) and wherever
  `quote-items.mjs`/`watch-positions.mjs` compute a ranked gp/day, passing the shape from the plan:
  `{ gpDay, marginU, captureFrac, cyclesDay, units, price, intradayRange, lane, rankInLane }`.
- **Integration seam**: purely additive param — absent on rows where Path-A wasn't computed
  (mirrors the existing optional-field contract exactly; no schema migration, no back-compat break
  since consumers already null-check optional suggestlog fields).
- **Gotchas**: `suggestions.jsonl` is (per the plan) NOT root-locked in the same way as
  `fills.json`/`positions.json` — confirm its ROOT-LOCKED-or-not status in README's Map of the repo
  before assuming it's freely editable; IDs/prices/timestamps only, no PII (repo-public rule,
  already the existing discipline for this file).
- **Validated vs placeholder**: this chunk is CHEAP and can ship the moment Chunk C computes a
  number — start accrual as early as possible (the plan's own sequencing note). The field's
  presence is validated; its calibration (captureFrac) is not — that's H2/H4's job, not this
  chunk's.
- **Can run in parallel with**: Chunk B, Chunk D (as long as D's emit calls end up passing the
  `pathA` object this chunk defines — light coordination, not a hard sequencing dependency if E
  lands the schema first).

### Chunk F — H2/H3: the join scorer (depends on Chunk E having accrued *some* logged `pathA` rows, and Chunk A for the forward archive read)
- **Files**: new command, e.g. `pipeline/commands/join-patha-outcomes.mjs`, mirroring
  `join-amplitude-outcomes.mjs` STRUCTURALLY (finding #6) — NOT `join-outcomes.mjs`. Same shape:
  a pure `replayPathAPick(series, pick, opts)` core (fixture-tested, no live archive) + a guarded
  CLI that reads `suggestions.jsonl` via `readSuggestionLines()` (filtering rows carrying
  `r.pathA`), opens the archive read-only, and calls `db.seriesFor(itemId, '1h', {from: pick.ts,
  to: nowSec})` (join-amplitude-outcomes.mjs:110) per item.
- **Integration seam**: the target metric must be H3's non-confounded one — "did the predicted
  intraday range materialize the following day(s), and was ~captureFrac of it reachable from fills
  we actually placed" — NOT realized-daily-ROI. Concretely: replay each logged `pathA.intradayRange`
  prediction against Chunk A's forward daily-range aggregate for the same item over the pick's
  horizon, and separately report Spearman(predicted gpDay, realized-range-implied gpDay) +
  predicted/realized ratio (whether captureFrac holds forward) — Gate-C style `--report`, mirroring
  join-amplitude-outcomes.mjs's `--report`/`resolved`/`pending` honesty split (pending = archive
  doesn't yet cover the horizon, not a miss).
- **Gotchas**: must print "n=0, too new to judge" honestly when no rows have resolved yet (rule 4)
  — do not synthesize a correlation number below a sample floor (mirror `join-outcomes.mjs`'s
  `--min-n` refusal-to-summarize discipline even though this isn't that file).
- **Validated vs placeholder**: this chunk BUILDS the validator; it does not itself validate
  anything until real accrual — ship it, expect `n≈0` on day one.

### Chunk G — H4: readiness gate / recalibration (depends on Chunk F having accrued real n)
- **Files**: `pipeline/lib/patha.mjs` (Chunk C) gains a documented threshold check — Path-A gp/day
  stays a coarse TIERING signal (not a hard gate/auto-action) until Chunk F's `--report` shows a
  stable positive rank correlation at n ≥ some floor (pick a floor consistent with this repo's
  existing `--min-n 8`-style precedent in `join-outcomes.mjs`, or restate one explicitly).
- **Integration seam**: when the floor is met, `captureFrac` is RE-ESTIMATED from Chunk F's forward
  join (replacing the 0.45/0.62 retrospective placeholder) rather than hand-edited — this is mostly
  a process/decision chunk, not a large code chunk, until real n exists.
- **Gotchas**: this is explicitly NOT buildable in full today (no data yet) — scope this chunk as
  "wire the threshold check + the recalibration hook, leave it dormant" rather than trying to
  pre-compute a number that doesn't exist yet.
- **Validated vs placeholder**: entirely gated on future data; do not let an executor mark this
  chunk "done" by inventing a threshold with no accrued n behind it.

### Chunk H — Path B descriptive overlay wiring (independent; low priority, can run anytime after Chunk D)
- **Files**: wherever Chunk D surfaces Path A, add the existing oscillator/floor-ceiling read
  (already-shipped amplitude/value-screen infra, per the plan's "reuses existing oscillator/floor-
  ceiling reads" line) as a SEPARATE inform-only column/flag — never folded into Path-A's gp/day
  number (the plan's explicit "risk discount, not extra revenue" framing).
- **Integration seam**: reuses `js/amplitudescreen.mjs`/`js/valuescreen.mjs`'s existing term-
  structure reads — no new math, just a presentation-layer join alongside Path A's output.
- **Gotchas**: the "floor-is-real / anti-stuck-bag gate" the plan calls MANDATORY before any
  optionality credit does not yet exist as code (it's described, not built) — if this chunk is
  read as licensing more optimistic pricing, that gate must be built FIRST; scope Chunk H as
  strictly descriptive/inform until that gate exists, per the plan's own wording.
- **Validated vs placeholder**: fully descriptive/placeholder (n≈0 executed per the plan) — never
  gates, never gets a code path that "licenses" sizing on its own.

### Dependency / parallelism summary
```
A (archive bulk range)  ─┐
                          ├─→ C (Path-A calc) ─┬─→ D (wire into surface) ──→ H (Path-B overlay)
B (structural gate)  ────┘  (independent of B)  ├─→ E (H1 pathA field) ──→ F (H2/H3 join) ──→ G (H4 gate)
```
A and B: start immediately, in parallel, no shared files. C depends only on A. E depends only on C
(not on B or D — can land before D if convenient, since E's schema doesn't need a live surface to
exist yet). D depends on A+C (and optionally B, if the owner decides Path A should run against the
structural-gated pool rather than the legacy pool — an explicit decision this hardening pass
surfaces but does not make). F depends on E having shipped and some accrual time passing. G depends
on F. H is lowest priority and only depends on D existing to attach to.
