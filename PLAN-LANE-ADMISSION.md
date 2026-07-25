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
