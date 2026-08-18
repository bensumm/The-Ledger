# PLAN-THIN-RESERVE — should `THIN_RESERVE` be widened, or capital-scaled, or replaced?

**Status: INVESTIGATION DONE; TR1/TR2/TR3 ALL STILL OPEN — no code changed and only ONE of TR1's four
doc edits landed** (`PLAN.md`'s "Thin-reserve should scale with `--capital`" entry, `PLAN.md:1102`).
Still missing: the CAPITAL-CONDITIONED-RESERVES §5e caveat (`PLAN.md:1155-1176`), the `THIN_RESERVE`
note on `pipeline/lib/signal/admission.mjs`'s ⚠ scaffolding header (`:77-99`), the `docs/MARKET-ANALYSIS.md`
§fetch-pool correction (`:363`), TR2's displacement line + fixture, and TR3's comment.
**RECOMMENDATION, as amended by this doc's own R5/R6: DO NOT WIDEN, DO NOT DEFAULT-ON `--scale-pool`,
DO NOT BLEND TO MERIT — *at present capital*. The closure is CAPITAL-CONDITIONAL, not permanent**
(revisit at ~150–200m deployable), and the reason to cite is "capital binds before slots", NOT §3c
(DOWNGRADED: n=20, 47% non-flips, CI [0.26%,7.04%], the 2.8× figure unreproduced). The starting hypothesis — "`THIN_RESERVE = 6`
is a hard quota that starves a 3.34m/d big-ticket, so widen it (or turn on the capital curve)" —
is **mechanically correct and economically backwards**. Widening it is free in fetch cost, so the
question is never "can we afford it"; it is a pure 1-for-1 *reallocation* from the cheap-churn
velocity lane into big-ticket gear, and Ben's own 408 realised closed lots say that trade runs
**1.32% vs 3.73% gp per capital-day the wrong way**. Everything below is measured on this repo at
HEAD `6e6738b`. Every constant discussed is a PLACEHOLDER n≈0 (rule 4); the *outcome* numbers are
real but small-n and confounded (§6).

Prior art this does NOT re-litigate — read first: `plans/PLAN-FETCH-POOL-SCALING.md` (the
`scaleSlots` curve + the 2026-08-07 default-on decision evidence), `PLAN.md` Discovered
"Thin-reserve should scale with `--capital`" and "CAPITAL-CONDITIONED RESERVES", and
`pipeline/lib/signal/admission.mjs`'s two headers (the bludgeon/Sanguinesti anchor incident, and
the ⚠ "THE RESERVES ARE VALIDATION SCAFFOLDING, NOT PERMANENT ARCHITECTURE" ruling).

---

## 1. The admission path, verified end-to-end

The default admission path is **`pickFetchPool` (`pipeline/lib/signal/admission.mjs`)**, not
`rankAndSlice` — `ADMISSION` defaults to `'unified'` (`screen-flip-niches.mjs:335`);
`rankAndSlice` in `gatecandidates.mjs` only runs under `--admission legacy`. Both implement the
same quota shape, so the finding holds either way, but any diff must land in **both** files.

**Confirmed: `thinAdmitted` IS a hard slice-quota.** In `pickFetchPool`:

```
const thinAll   = rest.filter(c => c.thin);          // gp-flow qualifiers, held out of the main pool
const thinScored = thinAll.map(...).sort(by expGpDay × trackBoost, tiebreak gp-flow);
const thinAdmitted  = thinScored.slice(0, thinReserve);      // ← the quota
const thinRemainder = thinScored.slice(thinReserve);
```

The excluded remainder gets exactly **one** further chance: `exploredThin = pickExploration(thinRemainder,
ceil(exploreReserve/2) = 1, now)` — a deterministic 30-minute rotation. Everything else is reported
`reason: 'thin-reserve-full'` and never fetched. `MT3`'s own `rotationNote` prints the honest wait.
A `thin` candidate is **never** eligible for the velocity lane (`velocityPool` is built from
`nonThinAll`), so the quota is the only merit path.

**Two corrections to the framing this investigation was handed.**

1. **`TOP` is no longer 40 — it is 90** (`screen-flip-niches.mjs:206`, raised 2026-08-07). The
   `--top 90` workaround IS the default now. `90 == TOP_MAX`, so `--scale-pool` is already a
   **no-op on the band/churn TOP pool at any capital**; it only still governs
   `THIN_RESERVE`/`VALUE_*`/`AMP_TOP`.
2. **The thin reserve is carved OUT of the `top` budget, not added to it**:
   `nonThinBudget = max(0, top − thinAdmitted − exploredThin − risers)`. So every thin slot is a
   velocity slot. This is why widening costs zero fetches (§4) — and why it is not additive.

**A third channel nobody has named: `MAX_PRICE` now derives from capital.** Since 2026-08-08
`MAX_PRICE = VALUE_CAPITAL` (`screen-flip-niches.mjs:251`). Capital therefore enters the funnel in
**three** places — the price window (`MAX_PRICE`), the ranking (`THROUGHPUT_CAP_GP` →
`capPerWindow` inside `expUnits`), and the slot sizes (`scaleSlots`, only under `--scale-pool`).
Any `--capital` sweep moves all three at once; a "the reserve binds at X capital" claim measured by
sweeping `--capital` is **not** a clean measurement of the reserve. §2 separates them.

---

## 2. Measured: when does the reserve actually bind, and why

Harness: bulk-only reproduction of the shipped gate→admit path (`gateCandidates` +
`pickFetchPool`, real `loadAll24hRolling`/`loadBands(2)`/`loadDaily(17,6)`, real `trackIndex` off
`positions.json`, exploration bucket pinned). Zero per-item fetches, so capital sweeps are free.
Shipped defaults `top 90 / thinReserve 6`, mode `band`:

| capital | gated | thin cand | survivors | thin excluded | vel excluded | **binding reason** | best excluded |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10m | 157 | 2 | 95 | 0 | 62 | `top-n-full` | Seeking amethyst arrow 1.50m/d |
| 20m | 170 | 14 | 95 | 7 | 68 | `top-n-full` | Air orb 1.60m/d |
| **26.8m (Ben's real pool today)** | 176 | 20 | 95 | 13 | 68 | **`top-n-full`** | Air orb 1.61m/d |
| 40m | 187 | 31 | 95 | 24 | 68 | `top-n-full` | Air orb 1.61m/d |
| 60m | 196 | 40 | 95 | 33 | 68 | `top-n-full` | Air orb 1.61m/d |
| **80m** | 204 | 48 | 95 | 41 | 68 | **`thin-reserve-full`** | Virtus robe top 2.20m/d |
| 100m | 208 | 52 | 95 | 45 | 68 | `thin-reserve-full` | Virtus robe top 2.75m/d |
| 116m | 209 | 53 | 95 | 46 | 68 | `thin-reserve-full` | Masori body (f) 3.11m/d |
| 250m | 221 | 65 | 95 | 58 | 68 | `thin-reserve-full` | Masori body (f) 6.70m/d |
| 500m | 225 | 69 | 95 | 62 | 68 | `thin-reserve-full` | Venator bow (u) 11.79m/d |

**Crossover is between 60m and 80m deployable**, not two points extrapolated. Confirmed live: a
real `--mode band --capital 116m` run prints `best excluded: Masori body (f), ~3.11m/d, reason:
thin-reserve-full`; the *default* run at today's derived pool (26.83m) prints `best excluded: Air
orb, ~1.61m/d, reason: top-n-full` with only 10 thin rows waiting. **At Ben's actual current
capital the thin reserve is not the binding constraint at all.**

**Churn has ZERO thin candidates at every capital level tested (10m→500m).** The thin reserve is
inert on the churn lane. This is a band-only question.

**The mechanism is `MAX_PRICE`, not the reserve.** Non-thin candidates are ~constant (155±2) across
the whole sweep; the *entire* growth in the gated pool is thin items being let in by the widening
price window (2 → 69). So the reserve's coverage collapses from 100% of thin candidates at 10m to
**9% at 500m** — not because 6 got smaller, but because the population it rations grew 35×. Framing
this as "the constant is mis-tuned" misses that no constant is stable against a population that
scales with capital.

---

## 3. Refuting my own loss metric: is 3.11m/d real?

"Best excluded has high expected gp/day" is the weakest link in the whole argument, and it does not
survive contact with the data.

**(a) `expGpDay` is only weakly predictive of post-fetch score — measured, n=145 passes.** EF-0a
(2026-08-01) logs `preRank`/`prePool` on every screen row. Over `suggestions.jsonl`: 5,306 screen
rows carrying both `preRank` and a post-fetch `rank`, grouped into 145 passes (median 30 rows/pass),
**Spearman ρ(preRank, post-fetch rank) = 0.28 mean / 0.31 median, p10 −0.04, p90 0.55.** The
pre-fetch queue order explains under a tenth of the post-fetch score variance. This confirms with
real n what `PLAN-FETCH-POOL-SCALING`'s Finding B recorded at n=1 (Sanguinesti staff: 12.89m/d
proxy → +88,162/u, +0.5%, rank 140k once fetched). ⚠ Honest caveat: part of that ρ gap is
*construct mismatch*, not noise — `expGpDay` is unit-aware (it multiplies by `expUnits`) while the
post-fetch `rank` (`net × P(fill) ÷ TTF`) is strictly **per-unit**. They are not measuring the same
thing, so ρ=0.28 is an upper bound on "noise" and a lower bound on "agreement".

**(b) The post-fetch score is ALSO big-ticket-biased, so "better grades" proves nothing.** Screen
band rows in the ledger, bucketed by `optBuy`:

| price tier | n | median post-fetch `rank` | median pFill | grades |
| --- | --- | --- | --- | --- |
| <100k | 3,920 | 101 | 0.26 | A-×11 B+×86 B×447 B-×382 C×1003 **D×1990** |
| 1m–5m | 49 | 80,298 | 0.26 | A-×21 B×25 D×3 |
| 5m–20m | 203 | 134,882 | 0.27 | **A-×69 B×134, zero C, zero D** |
| >20m | 250 | 162,394 | 0.30 | A-×77 B×172 D×1 |

A big ticket essentially *cannot* grade below B, because both `rank` and the grade are per-unit-net
quantities. So any change that admits more big tickets **mechanically improves the grade
distribution** — which is exactly what widening does (§4). That improvement is a measurement
artifact of the ruler, not evidence of a better board. This is MT1's documented
"two-different-numbers-against-one-constant" hazard recurring one level up.

**(c) The only ruler that isn't circular — realised outcomes.** `positions.json`, 408 closed lots,
0 open (so no survivorship censoring), bucketed by realised `buyEach`:

| tier | lots | win rate | Σ realised | capital deployed | ROI | median hold | **gp per capital-day** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <100k | 212 | **86%** | +15.03m | 1.104b | 1.36% | 1.6h | **3.73%** |
| 100k–1m | 13 | 69% | −0.07m | 60.8m | −0.11% | 3.1h | −0.27% |
| 1m–5m | 63 | **86%** | +5.20m | 469.5m | 1.11% | 0.7h | **3.83%** |
| 5m–20m | 100 | 80% | +10.42m | 1.891b | 0.55% | 2.2h | 1.50% |
| **>20m** | 20 | **50%** | +6.62m | 1.336b | **0.50%** | 2.8h | **1.32%** |

The >20m lane — precisely the population `THIN_RESERVE` exists to admit — is a **coin flip** and
returns **2.8× less per capital-day** than the sub-100k churn the widening displaces. This is the
same conclusion Ben's own recorded update-cycle lesson reached independently ("every big loss is
held gear — fang/hydra/dragon nails/virtus; every win is seeds/runes/consumables"), now with the
book's arithmetic behind it.

**So the finding does not evaporate — it inverts.** The excluded item's `expGpDay` is not a fantasy
in the sense of being fabricated; it is a *real* number computed on a *real* population that Ben
has repeatedly lost money on. Excluding it is not a cost. It is the reserve doing something useful
by accident.

---

## 4. Measured: what widening actually costs

Live A/B, `--mode band --capital 116m --no-publish --verbose`, warm bulk caches, two runs each:

| | fetches | wall (warm, run 2) | rated | grades | best excluded |
| --- | --- | --- | --- | --- | --- |
| default (`thinReserve 6`) | **95** | 956 ms | 59 | A-×2 B×11 B-×6 C×17 D×23 | Masori body (f) 3.11m/d `thin-reserve-full` |
| `--thin-reserve 15` | **95** | 947 ms | 58 | A-×3 B×16 B-×5 C×15 D×19 | Zaryte vambraces 2.03m/d `thin-reserve-full` |
| `--thin-reserve 30` | **96** | 954 ms | 62 | A-×6 B×25 B-×5 C×13 **D×13** | Air orb 1.61m/d `top-n-full` |

**Fetch cost and wall clock are unchanged.** Widening the thin reserve is not a budget question at
all — it is a pure reallocation inside a fixed 90-slot pool. That kills the entire
"sub-linear, capped, hard-ceiling" framing `PLAN-FETCH-POOL-SCALING` §2.2 built for `TOP`: that
framing is correct for `TOP` (which genuinely buys fetches) and **category-inappropriate for
`THIN_RESERVE`** (which buys nothing and spends velocity slots). `scaleSlots` applied to
`THIN_RESERVE` is a curve solving a budget problem this pool does not have.

**Displacement is exactly 1-for-1, and it hits the lane the reserve was built to protect.** From the
harness at 116m (`+admitted / −displaced`):

| thinReserve | survivors | +/− | thin still excluded |
| --- | --- | --- | --- |
| 6 | 95 | — | 46 |
| 8 | 95 | +4 / −4 | 44 |
| 10 | 95 | +6 / −6 | 42 |
| 12 | 95 | +8 / −8 | 40 |
| 15 | 95 | +11 / −11 | 37 |
| 20 | 95 | +16 / −16 | 32 |
| 30 | 96 | +25 / −24 | 22 |

Live, default → `--thin-reserve 30`, the board **loses** Water orb, Atlatl dart, Rune javelin tips,
Tuna potato, Grimy torstol, Dragon dart, Emerald necklace, Bastion potion(4), Sapphire necklace,
Aether catalyst, Super combat potion(2), Magic longbow (u), Grimy avantoe, Ensouled dragon head,
Dragon dart(p++), Dragon javelin tips (16 velocity rows, all <20k) — and **gains** Oathplate legs
(89m), Masori body (f) (72m), Venator bow (70m), Oathplate helm (85m), Masori chaps (51m),
Ancestral hat (47m), Noxious halberd (41m), Tormented synapse (32m), Justiciar set (31m), Dragon
hunter crossbow (32m), Magus ring (26m), Saradomin godsword (23m)…

That is the <100k / 1m–5m lane (86% win, 3.73–3.83% per capital-day) being swapped out for the
>20m lane (50% win, 1.32% per capital-day). **This is a finding against the change**, exactly as
the investigation brief anticipated it might be.

**Also observed — a non-monotonicity worth a note.** Widening the reserve can *eject* a thin item:
`Dragon warhammer` (1.49m/d) is admitted at `thinReserve 6` and gone at 8; `Ancestral hat 🎲` is
rated at default and lost at 15. Cause: both entered via `exploredThin`, and `pickExploration`
indexes into `thinRemainder`, whose membership changes when the quota moves. Harmless (the lottery
is explicitly non-deterministic-by-design) but it means "widening is additive" is **false** for the
thin lane in both directions. Worth one comment line wherever this is next touched.

---

## 5. The alternatives, argued both ways

### 5a. Widen the constant (6 → 10/15) — REJECT
*For:* trivial, reversible, zero fetch cost, and the reserve genuinely is the binding constraint
above ~70m. *Against:* it buys big-ticket gear with churn slots at a measured 2.8:1 disadvantage in
gp per capital-day; the "improved grades" that would be cited as evidence are an artifact (§3b); and
`PLAN.md` Finding C already ruled that raising it "is a queue re-order, not a fix, until Finding B
is addressed" — and Finding B (§3a) is now measured worse, not better.

### 5b. Default-on `--scale-pool` — REJECT
Already measured and rejected once (`PLAN-FETCH-POOL-SCALING`, 2026-08-07: captures ~5% of the
available win). Three further reasons it is *more* wrong now than then:
- `CAP_REF = 100_000_000` is **not** a tuned reference. The plan doc's own Open Decision 2 concedes
  "a *what capital level did the 40/6/25/40 defaults get tuned against* question doesn't really have
  an answer — they were picked structurally." The header comment's "the reference bankroll the
  fixed defaults are treated as tuned against" is doing unearned work. It was chosen to match the
  no-anchor `VALUE_CAPITAL` fallback so the curve would be a no-op — i.e. **the anchor was picked for
  zero-ripple, then retconned as a calibration**. It is off by ~4× against Ben's actual 26.8m pool,
  which means the curve is a silent no-op for every session he actually runs.
- Widening `THIN_RESERVE` costs no fetches (§4), so the *entire justification for a sub-linear
  capped curve* — bounding a fetch bill — does not apply to this pool.
- sqrt vs log vs step is unanswerable and moot: at 116m the curve moves 6 → 8, which §4 shows is
  +3 gear rows for −4 churn rows. Tuning the curve tunes the size of a trade we should not be making.

### 5c. Merit blend — thin competes on `expGpDay`, reserve becomes a FLOOR not a CAP — REJECT, and this one is the trap
This is the most intellectually appealing option and the measurement kills it outright. Counterfactual
over the same gated pool, "pure merit" = whole pool sorted by `expGpDay` desc, top 90:

| capital | thin candidates | thin that would rank INTO a pure-merit top-90 |
| --- | --- | --- |
| 26.8m | 20 | 11 |
| 116m | 53 | **51 of 53** |

At 116m a merit blend does not "let the best big ticket compete" — it hands **the entire pool** to
big tickets and evicts 54 velocity rows. The reason is structural and already documented in
`admission.mjs`'s header and `PLAN.md`'s CAPITAL-CONDITIONED RESERVES entry: `expGpDay` is
capital-aware via `capPerWindow = pool / mid`, so once the pool stops binding on a 40m item, big
tickets win on net/u by construction. **The 6-slot quota is not suppressing merit — it is the only
thing currently stopping the ranking from going all-in on the worst-performing tier in the book.**
A merit blend would be strictly worse than any tuned constant, not strictly better.

### 5d. Do nothing — RECOMMENDED
The reserve is a CAP on a class that underperforms 2.8:1, in a system whose pre-fetch ranker is
ρ≈0.28 predictive and whose post-fetch grade is structurally biased toward that same class. Every
mechanism proposed to "fix" it makes the board worse by the only non-circular ruler available.

### 5e. If anything is built here, build the RULER — the one genuinely open thread
`PLAN.md`'s CAPITAL-CONDITIONED RESERVES entry already names the right shape: condition each reserve
on whether its class is *plausibly deployable at the current pool* (`limit × mid` as a fraction of
`THROUGHPUT_CAP_GP`) rather than sizing it by hand, so a reserve self-retires at high capital and
self-activates at low. Note the direction that implies for THIS reserve: at high capital, big
tickets become *more* deployable, so a deployability-conditioned rule would make the thin reserve
**grow** — i.e. it would reproduce exactly the trade §4 shows is unprofitable. That entry should be
amended with §3c's outcome table before anyone implements it.

---

## 6. Honesty ledger (rule 4)

- `>20m` is **n=20 closed lots** at a 50% win rate — high variance, and the sum is positive
  (+6.62m). The claim is "worse gp per capital-day", NOT "loses money". The 5m–20m tier (n=100,
  1.50%) points the same way, which is the reason to believe the direction rather than the point
  estimate.
- Realised lots are **what Ben chose to trade**, not what the screen admitted — selection, not a
  controlled arm. A big ticket he bought is one he decided on; the counterfactual "big tickets the
  reserve excluded" has no outcome data by construction (they were never fetched, never suggested,
  never traded). The suggestion→outcome join EF0 names is the only thing that would close this.
- The ρ=0.28 measurement compares a unit-aware pre-fetch key against a per-unit post-fetch key
  (§3a) — a real construct mismatch, not pure noise.
- Every capital level except 26.8m is synthetic (`--capital` override). All three capital channels
  move together in that sweep (§1); the crossover band 60–80m is therefore "where the reserve
  becomes binding *given* the price window also opened", not a pure reserve threshold.
- One market snapshot, one day (2026-08-09). The gated-pool composition varies day to day; the
  60–80m crossover should be re-measured before anyone acts on the exact number.

---

## 7. Build-ready chunks

Ordered by leverage. **TR1 and TR2 are the only ones worth doing now**; TR3–TR5 are contingent.

### TR1 — Record the finding where the next agent will hit it (DOC ONLY, ~30 lines)
The single highest-value change: three separate live docs currently point a future agent at
"widen the thin reserve" and none of them carries the displacement or outcome measurement.
- `PLAN.md` Discovered → "Thin-reserve should scale with `--capital`": append the §2 binding curve,
  §4 displacement table and §3c outcome table, and mark the entry **CLOSED — measured, do not
  widen** (it currently reads as an open, endorsed direction with an interim workaround).
- `PLAN.md` Discovered → CAPITAL-CONDITIONED RESERVES: add the §5e caveat that a
  deployability-conditioned rule points the thin reserve the *wrong* way.
- `pipeline/lib/signal/admission.mjs`: extend the existing ⚠ scaffolding header with a
  `THIN_RESERVE` note — "this is a CAP on an underperforming class, measured 2026-08-09; widening
  it is a 1-for-1 velocity-lane swap costing zero fetches, see plans/PLAN-THIN-RESERVE.md".
- `docs/MARKET-ANALYSIS.md` §fetch pool: correct "the fixed slot counts … independent of how much
  capital there actually is" — `TOP` is 90 = `TOP_MAX` (curve already a no-op) and `MAX_PRICE` is
  now capital-derived, which is the actual capital-sensitivity of the pool.
No code, no version bump. Acceptance: `lint-docs.mjs` clean; a reader of any of the four entry
points reaches the measurement before reaching the proposal.

### TR2 — Make the displacement visible on every scan (SMALL, code, inform-only)
Today `crowded out: N … reason: thin-reserve-full` tells you a big ticket was excluded but never
that admitting it would *evict* a velocity row. Extend `renderMode`'s crowded-out line (and/or
`rotationNote`, `screen-flip-niches.mjs:633`) with the reallocation fact:
`thin lane 6/53 slots · +1 thin slot = −1 velocity slot (nonThinBudget 77)`. Pure display off
numbers already in hand (`thinAdmitted.length`, `thinAll.length`, `nonThinBudget`). Zero fetch cost.
Acceptance: fixture in `pipeline/test/admission.test.mjs` pinning the counts; a scan at
`--capital 116m` prints the line; `--thin-reserve 0` prints it degenerately, never throws.
**Why this and not a knob:** the reserve's real defect is invisibility of the trade-off, which is
this module's own founding ruling ("the fix is the ranking dimension AND the invisibility").

### TR3 — Fix the exploration non-monotonicity note (TRIVIAL, comment only)
`pickExploration(thinRemainder, …)` re-indexes when `thinReserve` changes, so widening can eject a
lottery-admitted row (§4). One comment at `admission.mjs`'s `exploredThin` line. No behaviour change
— the rotation is deliberately non-deterministic (AR2, Ben's call). Acceptance: none needed.

### TR4 — GATED on evidence: the suggestion→outcome join (NOT scoped here)
Every conclusion above leans on realised lots that were never a controlled arm (§6). The join EF0
(`PLAN-ESTIMATOR-FIDELITY`) names — suggested row → what it actually did — is the prerequisite for
any reserve-sizing decision, this one included. **Do not size a reserve before it exists.** Listed
here only so a future agent does not treat §3c as sufficient.

### TR5 — GATED on TR4: retire the reserve rather than resize it
`admission.mjs`'s header already states the exit condition ("these retire once the top-N is shown to
surface the best candidates for the capital pool"). §5c shows the top-N does **not** currently do
that — a merit top-90 would be 51/53 big tickets at 116m. So the honest sequencing is: fix the
RANKING's per-unit bias first (a capital/velocity-aware pre-fetch key, i.e. rank on something
closer to Path-A gp/day than to net/u), *then* retire the quota. Resizing the quota before that is
re-ordering a queue sorted by the wrong key — `PLAN.md` Finding C's exact words, now with the
displacement cost attached.

**Explicitly NOT proposed:** widening `THIN_RESERVE_DEFAULT`; lowering `CAP_REF`; raising
`POOL_SCALE`; defaulting `--scale-pool` on; any merit/floor blend. Each is argued and rejected in §5.

---

# Red-team + the plain-English trade-off (Ben's ask, 2026-08-09)

> Ben: *"Not sure I understand the consequences of widening, worth a deeper investigation."*
> Adversarial second pass. **The §5d recommendation SURVIVES at Ben's capital. The §3c evidence does
> NOT survive the weight §3–§5 put on it and is downgraded below.** Nothing above is deleted.

## R1. The answer, at YOUR board — `--thin-reserve 6 → 30`, real pool 26.83m

Three live `--mode band --no-publish` runs, back to back, warm caches, **capital untouched** (derived
`deployablePool` 26,827,440 in all three — so `MAX_PRICE`, `THROUGHPUT_CAP_GP` and `scaleSlots` are
byte-identical across the A/B and the only thing that moved is the reserve. §1's three-channel
confound is fully controlled here; it is NOT controlled in R5, which says so).
All three: **95 fetched · 178 gated · 61/60/61 rated · binding reason `top-n-full`.**

| | comes ON the board | gp/d as printed | **gp/d YOUR wallet** | capital it eats | slots |
| --- | --- | --- | --- | --- | --- |
| in | Granite hammer (L4·gear) | 5.48m | **1.370m** | 22.44m | 1 |
| in | Masori chaps (L3·gear) | 8.69m | **1.086m** | 25.90m | 1 |
| in | Magus ring (L2·gear) | 12.03m | **0.687m** | 25.18m | 1 |
| in | Ring of suffering (L6·gear) | 3.25m | **0.406m** | 19.19m | 1 |
| in | Saradomin godsword (L7·gear) | 3.10m | **0.388m** | 23.13m | 1 |
| in | Necklace of anguish (L8·gear) | 2.73m | **0.341m** | 19.22m | 1 |
| in | Bandos godsword (L13·gear) | 1.86m | **0.233m** | 17.88m | 1 |
| | **total in** | **37.14m** | **4.511m** | — | — |
| out | Dragon dart (L14·churn) | 0.723m | **0.723m** | 12.32m | 1 |
| out | Magic longbow (u) (L22·churn) | 0.583m | **0.583m** | 7.58m | 1 |
| out | Amylase crystal (L24·churn) | 0.573m | **0.573m** | 6.71m | 1 |
| out | Aether catalyst (L29·churn) | 0.496m | **0.496m** | 8.63m | 1 |
| out | Dragon dart(p++) (L31·churn) | 0.463m | **0.463m** | 19.18m | 1 |
| out | Saradomin brew(4) (L35·churn) | 0.365m | **0.365m** | 13.50m | 1 |
| out | Yanillian hops (L39·churn) | 0.284m | **0.284m** | 9.16m | 1 |
| out | Tuna potato · Atlatl dart · Tai bwo wannai teleport | 0.595m | **0.595m** | — | — |
| | **total out** | **4.081m** | **4.081m** | — | — |

Read the last three "out" rows as free: all three already print `⚠<floor` (under the 250k attention
floor), so they are surfaced-not-actionable today. `Amulet of torture` and `Ironwood logs` also change
label — they move from the 🎲 exploration lottery into the reserve proper. Same item, not a gain.

**What actually changes on your board, in one sentence:** you trade the **tail** of the churn lane
(ranks 14→41 of 42) for the **head** of the gear lane (ranks 2→13 of 19) — and since you act on the
top handful, the rows that leave are ones you were never going to touch.

## R2. Why the printed number is not the number — the thing that makes this confusing

`Path-A gp/d` on the console is computed with **`capital: Infinity`** (`screen-flip-niches.mjs`, AF2
comment — deliberate: it measures what the ITEM can produce for anyone, not what your wallet extracts).
Capital rides separately as `affordableUnits`. So:

| | printed | affordable units at 26.83m | your real gp/d | haircut |
| --- | --- | --- | --- | --- |
| Magus ring | 12.03m/d | **1** | 0.687m/d | **17.5×** |
| Masori chaps | 8.69m/d | **1** | 1.086m/d | 8.0× |
| Granite hammer | 5.48m/d | **2** | 1.370m/d | 4.0× |
| Dragon dart | 0.723m/d | 23,953 | 0.723m/d | 1.0× |
| Amylase crystal | 0.573m/d | 43,979 | 0.573m/d | 1.0× |

Rescaled by `expUnits(limit, volDay, floor(pool÷price))÷expUnits(limit, volDay, null)`, W=2 — the
shipped formula, just with your pool instead of Infinity. **Every big ticket widening admits is
inflated 4–18×; every velocity row it evicts is exact.** That gap is the whole reason the trade-off
looks obviously-good on screen and is roughly a wash in fact.

## R3. So what does it cost per day? — the honest bound

Capital binds long before slots do at 26.83m, so you cannot have the whole "in" column; you can have
about one of it:

| build | gp/d | capital used | slots used |
| --- | --- | --- | --- |
| best single entrant (Granite hammer, 2u) | **1.370m** | 22.44m | 1 of 8 |
| best three leavers (Dragon dart + Magic longbow (u) + Amylase crystal) | **1.879m** | 26.61m | 3 of 8 |

**Widening costs you roughly 0.5m/d at today's capital — and per gp of capital the two sides are a
near tie** (Granite hammer 6.1%/day, Dragon dart 5.9%/day). It is not the 2.8:1 rout §4 implies; it is
a coin-flip-close swap that happens to land slightly the wrong way, on a board where the reserve is
not the binding constraint in the first place.

## R4. ATTACK — the §3c evidence does not carry the weight placed on it

**(a) Survivorship: the tier and "update-sensitive gear" are PERFECTLY collinear. Not separable.**
All 20 `>20m` lots are combat gear — 11 distinct items, zero commodities:
`Ancestral hat · Ancient godsword · Avernic defender hilt · Confliction gauntlets · Dragon hunter
crossbow · Masori body · Masori body (f) · Masori chaps · Soulreaper axe · Spectral spirit shield ·
Virtus robe top`. There is **no non-gear >20m lot in the book to split against**, so the gear-vs-not
test the brief asked for cannot be run — and the claim "**the >20m class** underperforms" is
unsupported. What the data supports is the narrower, already-known "**the update-sensitive gear Ben
traded** underperformed" (the `update-cycle-timing` memory). ⚠ This does **not** rescue widening:
the 7 rows widening actually admits at 26.83m are **7/7 combat gear**, drawn from exactly the
collinear population. The confound relabels the finding; it does not reverse it.

**(b) 46.7% of the `>20m` capital denominator is FOUR zero-P/L non-flips.** `realised == 0` exactly:
Soulreaper axe (421m, 0.0h hold), Masori body (f) (75m, 0.2h), Confliction gauntlets (75m, 0.2h),
Ancestral hat (53m, 20h). Wash/relist reconstruction artifacts, not flips — and they are scored as
losses in the 50% win rate.

| tier | n | zero-P/L lots | zero share of capital | ROI all | ROI ex-zeros | win all | win ex-zeros |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <100k | 212 | 9 | 0.2% | 1.36% | 1.36% | 86% | 90% |
| 1m–5m | 63 | 3 | 1.5% | 1.11% | 1.12% | 86% | 90% |
| 5m–20m | 100 | 1 | 0.7% | 0.55% | 0.55% | 80% | 81% |
| **>20m** | 20 | **4** | **46.7%** | 0.50% | **0.93%** | 50% | **63%** |

No other tier exceeds 1.5%. Leave-one-out: dropping the **single** Soulreaper axe row moves tier ROI
0.495% → 0.723%; dropping the worst Ancestral hat moves gp-per-capital-day 2.28% → 3.26%. **A verdict
that flips on one row is not a verdict.**

**(c) The gap is not statistically distinguishable.** Bootstrap, 20k resamples over lots:

| | n | point | 95% CI | |
| --- | --- | --- | --- | --- |
| `>20m` gp per capital-day | 20 | 2.28% | **[0.26%, 7.04%]** | CI is 27× wide |
| `<100k` gp per capital-day | 212 | 5.16% | [3.74%, 7.08%] | |
| | | | **P(>20m ≥ <100k) = 9.2%** | directional, not significant |

Win rate (Wilson): `>20m` 10/20 = 50%, CI **[30%, 70%]**; `<100k` 86% CI [81%, 90%]. The win-rate gap
is real; the **gp-per-capital-day gap that §3c/§4/§5 actually argue from is not** at conventional
thresholds. ⚠ Also flagged: **I could not reproduce §3c's figures.** Same lots, same tiers, I get
<100k **5.16%** and >20m **2.28%** (a 2.3× gap) where §3c reports 3.73% / 1.32% (a 2.8× gap). Same
direction, different magnitude — the hold-time flooring convention behind §3c's column is unstated
and I could not recover it. **Treat "2.8×" as unverified; the direction is what replicates.**

**(d) Slot/attention model — the brief's crux. It does NOT flip at your capital.** Per realised
slot-cycle the big tickets genuinely win (331k gp/lot vs 71k for sub-100k, 4.7×), and with
`ACTIONABLE_WINDOWS_PER_DAY = 2` a big-ticket round trip spends both windows against churn's one — so
the attention-normalised comparison is 331k/day vs 2×71k = 142k/day, and big tickets win 2.3×. **But
that model only governs when SLOTS are scarce and capital is not.** At 26.83m the reverse holds: you
can fund 4 velocity positions or **1** big ticket, and 7 of 8 slots sit empty either way (R3). Slot
efficiency is the right ruler only once capital stops binding — which is R5.

## R5. ATTACK — "capital that cannot deploy earns zero". This one LANDS, ~15× above your board

Best achievable gp/day for an 8-slot book, greedy + 4k randomised restarts over today's real 61-row
band board, wallet-honest Path-A (⚠ **this table varies the pool, so all three capital channels move
together — §1's confound is NOT controlled here; the R1 A/B above is the clean measurement**):

| pool | velocity lane only | idle | whole board (incl. gear) | idle | |
| --- | --- | --- | --- | --- | --- |
| 10m | 1.83m/d | 0 | 1.82m/d | 0 | wash |
| **27m (yours)** | **3.75m/d** | **0** | **3.79m/d** | **0** | **wash — +0.04m/d** |
| 50m | 6.28m/d | 0 | 6.39m/d | 0 | wash |
| 80m | 8.03m/d | 0 | 7.78m/d | 0 | velocity wins |
| 116m | 9.63m/d | 0 | 9.63m/d | 0 | wash |
| 200m | 11.50m/d | 0 | 11.98m/d | 0 | +0.48m/d |
| 400m | 14.79m/d | **41m** | 14.53m/d | 0 | idle appears |
| 800m | 14.79m/d | **441m** | **20.78m/d** | 0 | **gear +6.0m/d** |

**So a flat "never widen" IS wrong at the top end** — above ~400m the velocity lane physically
saturates 8 slots and the marginal capital earns literally nothing, while the gear lane absorbs it for
+6m/d. The reserve's correctness is capital-dependent, exactly as the brief suspected. It is just that
the crossover is ~15× your current pool, not near it. Note §2's crossover (60–80m, where the reserve
starts *binding*) and this one (~200–400m, where widening starts *paying*) are different thresholds and
should not be conflated — the reserve binds for a long stretch during which binding is the correct behaviour.

## R6. Verdict — what changed and what did not

| §5 claim | red-team result |
| --- | --- |
| 5d "do not widen" **at Ben's capital** | **SURVIVES** — costs ~0.5m/d, and the reserve isn't even binding (`top-n-full`) |
| §4 "1-for-1 reallocation, zero fetch cost" | **CONFIRMED independently** at the real pool: 95/95/95 fetches, 178 gated, all three runs |
| §3c ">20m is the worst tier, 2.8:1" | **DOWNGRADED** — n=20, 47% of capital is non-flips, CI [0.26%,7.04%], P=9.2%, figure unreproduced |
| §3c/§5e "the class underperforms" | **NOT SUPPORTED** — tier is 100% gear; class effect and update-sensitivity are inseparable |
| §5d "do nothing" as a **permanent** rule | **OVERTURNED at the top end** — above ~400m, excluding gear strands capital at zero |
| §7 TR1 "mark CLOSED — do not widen" | **AMEND** — record it as *capital-conditional*, and stop citing §3c as the reason |

**Recommendation (one line):** leave `THIN_RESERVE` at 6 — at 26.83m widening buys ~0.5m/d of harm on
a constraint that isn't binding — but re-cite the reason as *"capital binds before slots, so gear
cannot deploy here"* rather than *"the >20m tier underperforms"* (n=20, half of it non-flips, CI spans
0.26–7.04%), and set a **revisit trigger at ~150–200m deployable** rather than closing the question.
