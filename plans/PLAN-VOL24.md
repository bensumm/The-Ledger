# PLAN-VOL24 — the `/24h` volume endpoint is broken; compose the real rolling-24h from `/1h`

Per-topic plan (folds into `PLAN.md` and is deleted when its last chunk ships — the plan-file rule).

## ⚠ RE-MEASURED 2026-08-10/11 — the endpoint CHANGED; the fix stands, the reason does not

**Read this before quoting any number below.** The 2026-07-13 finding (next section) described the
endpoint as it behaved *then* and is kept verbatim as the historical record. It no longer describes
what `/24h` serves.

### The headline: BULK and PER-ITEM are no longer the same endpoint

This plan's finding section states "The `/24h` response (bulk AND per-item — identical)". **That is
false as of 2026-08-10**, and it is the single most consequential correction here, because it decides
which call sites need the fix:

| | what it serves now | verdict |
| --- | --- | --- |
| **bulk `/24h`** | a complete, bit-exact **UTC-day** aggregate; that day closed 24–48h before the read | **not a trailing-24h source** — `loadAll24hRolling` is load-bearing |
| **per-item `/24h?id=`** | a complete, bit-exact **UTC-day** aggregate, one day FRESHER; that day closed 0–24h before the read | **also not a trailing-24h source** — `vol24FromInputs` does real work ~23h/day |

⚠ **THIS TABLE SAID THE OPPOSITE UNTIL 2026-08-11, and the error propagated through three commits.**
It recorded per-item as "the **true trailing 24h** / **CORRECT** — `vol24FromInputs` is currently a
no-op", on evidence of "**22/24 bit-identical**" and later "19/24". Both measurements were taken inside
the **00:00–01:00 UTC** hour — the only hour in which `lastCompleteHour()`'s composed window coincides
with the per-item served day. That is 17:00–18:00 PDT, the hour these sessions habitually run in.

What per-item actually is, measured n=30 by summing each item's own `/1h` series two ways:

| compared against | bit-exact |
| --- | --- |
| the **UTC day** its own `timestamp` labels, `[T, T+23h]` | **30/30** |
| the **true trailing 24h** | **4/30** |

Its `timestamp` is a day boundary (`T % 86400 == 0`) exactly **24h ahead of bulk's**. Also worth
knowing: the **`?id=` parameter is IGNORED** — `/24h?id=2` and `/24h?id=13190` both return the same
full 4,152-item map, so `fetch24hOne` downloads the whole market to read one row.

**Keep the per-item correction — for its ARITHMETIC, not merely its coverage guard.** The earlier
"its arithmetic is a no-op, only the guard earns its place" framing understated it by about 23 hours a
day. Both endpoints answer "what did this item trade during a fixed past UTC day", which is not the
question a liquidity gate asks; composing from `/1h` is the only trailing-24h source available.
Corollary, since it was asserted here too: "every disagreement is the COMPOSED side falling short" is
false — on a fresh out-of-window probe the composed value **exceeded** the endpoint on 8/24, by up to
+56%, because the two are measuring different windows rather than one being truncated.

### The bulk endpoint: which window does `timestamp` label?

Re-measured against the local SQLite 1h archive (a different source from the live
recompose that produced the original finding), 374 items with full 24-bucket coverage on both windows:

| Hypothesis for the window `/24h`'s `timestamp` T labels | median | p25 | p75 | within ±10% |
| --- | --- | --- | --- | --- |
| `[T-23h, T]` — T is the day's END | 1.102 | 0.988 | 1.283 | 144/374 (39%) |
| **`[T, T+23h]` — T is the day's START** | **1.000** | **1.000** | **1.000** | **374/374 (100%)** |

So today `/24h` serves a **complete and exact UTC-day aggregate** — bit-exact against the `/1h` sum.

⚠ **But note what does and does not establish that.** The ±10% band above is weak evidence: an offset
scan over 61 candidate windows across ±30h found **39 of 53** evaluable offsets land inside ±10%, and
offset −1h scores 244/247 (median 1.0031) — nearly indistinguishable from offset 0. What actually
establishes the window is **exact integer equality on both hpv and lpv**, plus `T % 86400 == 0`. Cite
that, not the ratio.

⚠ **The "0/247 at every other offset" figure was sample-specific and is corrected.** Re-run 2026-08-11
over the **full two-sided market** (3,767 items, `T = 1786233600`, with `/24h` re-read after the scan to
confirm T had not advanced): **offset 0 → 3767/3767 bit-exact**, offset −1h → 414/3767, offset +1h →
383/3767. The discrimination is overwhelming, but it is not literally zero off the true window — a thin
item whose boundary hours carry no trades matches at ±1h as well. The earlier 0/247 came from a
coverage-filtered 247-item sample and does not generalize past it.

An earlier version of this section offered "the archive's own FWD/BACK ratio is the identical
1.102/39%" as a *control*. It is a **tautology** — since endpoint == FWD exactly, endpoint/BACK ≡
FWD/BACK by construction, computed over the same rows. Retracted. The conclusion (that BACK's near-1.0
is day-to-day volume similarity) still holds; it just wasn't shown by that number.

**What is broken now is STALENESS, not magnitude.** T lagged **71.3h** on 2026-08-10 and **48.9h** on
2026-08-11 — the anchor advances a day at a time. State the defect against the day's **CLOSE**, not
against T: the served day closes at `T+24h`, so those two lags mean the day closed **47.3h** and
**24.9h** before the reads, i.e. the newest data is **~24–48h old** and the aggregate spans 24–72h back.
(An earlier version of this paragraph said "a whole day that closed 2–3 days ago" — that conflated the
age of T with the age of the DATA and is **retracted**; it also contradicted the very numbers printed
beside it.) The under-report ratio that justified this plan now measures **~1.0×**, not 10–27×.

**Why it changed is UNKNOWN — do not invent a mechanism.** An earlier version of this section claimed
the endpoint "served a partial, still-accumulating day in July and now waits for the day to close,
which is exactly why staleness grew while accuracy went to exact." **Retracted.** It contradicts the
July evidence it claimed to explain — §"The finding" below records 14 days of *historical*
`/24h?timestamp=` buckets each truncated to their first 1–3h, i.e. **closed** days truncated, not
accumulating ones — and if T is the day's START, a 26h-old T describes a day that closed 2h before the
read and cannot still be accumulating. Both measurements are real; the causal link between them is
not established, and the earlier hedge ("almost certainly correct when made") was stronger than the
story that replaced it. State the two measurements in their own tense and stop there.

**Consequences.**
- The fix (compose from `/1h`) is **unchanged and still correct** — a fixed past UTC day cannot gate
  today's liquidity, whatever its internal accuracy, and that is true of BOTH endpoints.
- Every count-matched floor (`FLOOR` 3500, `CHURN_MIN_VOL` 65000, …) is **unaffected** — but NOT for
  the reason first written here. The claim "they were calibrated against the composed rolling source,
  not against `/24h`" is **false**: the floors were *solved on* rolling but *anchored to* a raw-`/24h`
  quantity (§Step 2 below — count-matched to "the same item count the old floor did under legacy").
  The conclusion survives on direct check of the design targets, which is the evidence that belongs
  here. ⚠ **The counts first written here (820 / 364 / 428) were WRONG and are corrected** — they were
  taken from a review agent's output and propagated without being re-derived, the exact failure this
  plan elsewhere warns about. Re-derived 2026-08-11 by counting the two-sided pool (3,718 items) out of
  `loadAll24hRolling`'s **4,148** ids. ⚠ Two things the first correction also got wrong: it described the
  method as "the `eachLiquidCandidate` predicate", but `FLOOR` is that function's `thin` CLASSIFIER (not
  an admission gate — admission is `FLOOR` OR gp-flow), and `CHURN_MIN_VOL` / `DIP_LOOP_LIQUID_FLOOR` do
  not appear in it at all; and it cited a population of 4,152, which is the `/24h?id=` map size, not the
  object measured.

  | constant | value | admits today | at its OWN solved value | July target |
  | --- | --- | --- | --- | --- |
  | `FLOOR` / `VALUE_LIQ_FLOOR` | 3,500 | 946 | **934** @ 3,652 | 884 |
  | `CHURN_MIN_VOL` | 65,000 | **372** | — | 361 |
  | `DIP_LOOP_LIQUID_FLOOR` | 40,000 | 446 | **438** @ 42,425 | 438 |
  | `GP_FLOOR` (items clearing the gp-flow threshold) | 4,500m | **91** | — | 89 |

  Nothing is mis-gating. ⚠ **But the "+2–7% above target, the direction INVERTS, `FLOOR` over-admits"
  framing was itself wrong** — it reported a deliberate design choice as a discovery. Step 2 below
  records `FLOOR` as "rounded 3,652→**3,500**, leaning looser per Ben's surface-the-lane intent" and
  `DIP_LOOP` as "rounded from 42,425": both were shipped deliberately loose, so they admit more than
  target BY CONSTRUCTION. At its own solved value `DIP_LOOP` admits **exactly 438 = the July target**,
  zero drift — the entire overage is the documented round. Real distribution drift is only `FLOOR`
  (+5.7% at 3,652) and `CHURN` (+3.0%). And treat the third digit as noise: these counts move ~1–2% per
  hour, so an earlier run of the same script gave 943/378/450. `GP_FLOOR` is **91** — the count-match
  counts items clearing the gp-flow threshold; the "88" published in the first correction (and the
  "88–91" published as if it were measurement uncertainty) answered a different question, `limitVol <
  3500 && flow ≥ 4.5b`.
  (A re-solve against *today's* legacy distribution suggests `FLOOR ≈ 47` and "2.5–3× too strict" —
  that is wrong, because today's legacy distribution is ≈ true volume and is not the target the gate
  was ever built on. Do not re-solve on it. Measured for the record: `FLOOR` 50 on the raw bulk `/24h`
  map now admits **2,426**, not the 884 that was July's count-match anchor — which is the whole reason
  that re-solve is invalid.)
- The `~10–27×` figure is HISTORY. Do not restate it in the present tense. The ONE home for the
  current description is the `marketfetch.mjs` `loadAll24hRolling` header.

## The finding (investigated 2026-07-13, empirically confirmed — SUPERSEDED as a description of today, see above)

The tool's `Vol/d` column and every liquidity gate/rank consume
`volDay = min(highPriceVolume, lowPriceVolume)` from the OSRS wiki `/24h` endpoint. **`/24h` is NOT a
rolling-24h window.** Live probing showed:

- The `/24h` response (bulk AND per-item — identical **← NO LONGER TRUE, see the re-measurement above:
  per-item is now the correct trailing-24h while bulk is a complete UTC day whose newest data is ~24–48h old**) carried a `timestamp` field ~26h stale, and the
  served hpv/lpv **exactly matched** (zero delta, both sides, multiple items) the sum of the `/5m`/`/1h`
  buckets over just the **first 1–3 hours of that stale UTC day**.
- Across 14 days of `/24h?timestamp=` daily buckets (and the identical `/timeseries?timestep=24h`), every
  day was truncated to its first 1–3 hours (bucket ÷ true-day-sum = 0.006–0.21).
- Net effect at investigation time: the live `/24h` reported **0.037–0.10×** the true trailing-24h volume
  (a ~10–27× under-report). It is worst in early/mid-UTC hours — i.e. Ben's US-Pacific afternoon/evening
  sessions — so the ~100/day two-sided floor, the 500k gp/d attention floor, gp-flow admission
  (`mid × limitVol`), and the rank/`expGpDay`/overnight `expUnits` are all systematically understated
  exactly when he trades, over-gating the mid-liquidity lane.
- `/5m`, `/1h`, `/6h` are healthy (each serves the last complete bucket, fresh). Only the `/24h`
  aggregation grain is broken. `/24h` is also undocumented on the wiki API page.
- **Side-casualty**: the `pressure` ratio and the `/24h` `avgHigh`/`avgLow` (gatecandidates' `mid`, the dip
  "24h avg low" reference) come from the same bucket. As of the 2026-08 re-measurement they are
  complete-day averages whose newest data is ~24–48h old (they were ~26h-stale 1–3h samples when this was written)
  — still not a live reference, but stale rather than truncated.

**Confidence**: HIGH on "what it serves now" (exact integer matches, both sides, many items, 14d of
history). Inferred (not proven beyond 14d): how long it has been broken — plausibly the repo's whole
operating history, meaning every volume-denominated threshold was tuned against deflated numbers.

## The fix (source): compose rolling-24h from the healthy `/1h` grain

There is NO single-fetch bulk source of true rolling-24h volume (`/volumes` is one unsplit ~13h-stale
daily number with no hpv/lpv split → can't feed the two-sided gate; it confirms the existing
"overstates tradability" doctrine). The only exact whole-market path is composing 24 bulk
`/1h?timestamp=` snapshots — the same grid-aligned pattern `loadBands`/`loadDaily` already use.

- **`rolling24FromTs1h(ts1h)`** (`pipeline/lib/marketfetch.mjs`) — TRUE trailing-24h
  `{highPriceVolume, lowPriceVolume, avgHighPrice, avgLowPrice}` for ONE item, summed off an
  already-fetched `/timeseries?timestep=1h` array → **zero new fetch** on a row whose 1h series is in hand
  (screen survivors via Leg B, quote COD-4). avg prices = volume-weighted 24h means.
- **`loadAll24hRolling({db})`** — the WHOLE-MARKET map, from the last 24 complete `/1h?timestamp` bulk
  windows, **reusing the Tier-1 SQLite 1h archive** (check-before-fetch: `loadSnapshot`/`loadDaily` already
  accrue some of these buckets, so a warm machine fetches only the gaps). 10-min disk cache mirrors
  `loadAll24h`. Same per-id shape as `loadAll24h` → sources are swappable with no shape change.

Proven **EXACT** vs a per-item timeseries sum: 10/10 items, hpv AND lpv (2026-07-13). Cold cost measured:
24 bulk fetches, ~5s, ~4080 items — cheaper than the 5m band walk.

## Accuracy: Proposal A (cheap scale-factor) is DEAD; B (compose) is exact

Two proposals were sketched. Prototype comparison (limiting-side volDay, window
[07-13 02:00 → 07-14 02:00 UTC]):

| Item | /24h rep | A-est (×24/h) | bulk-roll (fix) | ts-truth | rep/truth | A/truth | bulk/truth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crystal armour seed | 111 | 1,266 | 1,319 | 1,319 | 0.084 | 0.960 | **1.000** |
| Soul rune | 477,221 | 5,444,592 | 9,586,388 | 9,586,388 | 0.050 | 0.568 | **1.000** |
| Cannonball | 430,398 | 4,910,390 | 7,374,328 | 7,374,328 | 0.058 | 0.666 | **1.000** |
| Dragon arrow | 92,292 | 1,052,955 | 1,845,443 | 1,845,443 | 0.050 | 0.571 | **1.000** |
| Blood rune | 664,931 | 7,586,166 | 17,936,825 | 17,936,825 | 0.037 | 0.423 | **1.000** |
| Nature rune | 545,441 | 6,222,911 | 7,483,847 | 7,483,847 | 0.073 | 0.832 | **1.000** |
| Old school bond | 193 | 2,202 | 3,925 | 3,925 | 0.049 | 0.561 | **1.000** |
| Abyssal whip | 169 | 1,928 | 1,685 | 1,685 | 0.100 | 1.144 | **1.000** |
| Zulrah scale | 807,251 | 9,209,889 | 12,939,779 | 12,939,779 | 0.062 | 0.712 | **1.000** |
| Death rune | 871,559 | 9,943,576 | 15,683,127 | 15,683,127 | 0.056 | 0.634 | **1.000** |

- **Proposal A** (multiply `/24h` by `24 / hoursSinceUTCmidnight`) is **rejected**: its premise
  ("cumulative since UTC midnight") is false — the bucket is a frozen 1–3h slice of *yesterday*. At the
  probe hour the factor coincidentally roughly cancelled the under-report, still leaving ±58% scatter; the
  coincidence collapses as the day advances (at 20:00 UTC the ×1.2 factor against ~10–27×-under data would
  report ~5–15% of true), plus near-midnight division instability. A confidently-wrong number is worse
  than a flagged degraded one.
- **Proposal B** (compose from `/1h`) is exact by construction and is what shipped.

## Step plan

### Step 1 — corrected source, SHADOW-only ✅ SHIPPED 2026-07-13
- `loadAll24hRolling` + `rolling24FromTs1h` added to `pipeline/lib/marketfetch.mjs`.
- **The active `volDay` is UNCHANGED.** `screen.mjs` still gates/displays/ranks off the broken `/24h`
  value (`loadAll24h`) so `screen.json`, the replay goldens, and every live decision stay byte-identical
  and NO extra fetch is added on the default path. The corrected source is reachable only via the new
  **`screen.mjs --vol-source legacy|rolling`** flag (default `legacy`) — the validation lever for step 2.
- **Shadow accrual**: every published screen row logs the corrected per-item volume as a lean
  `volDayRolling: {hpv,lpv}` on `suggestions.jsonl` (computed from the in-hand 1h series → no new fetch;
  omitted where no 1h series is in hand, e.g. watchlist rows). `SCREEN_PARAMS.volSource` records which
  source gated the run.
- Node-only. **No APP_VERSION bump** (the browser app is untouched — deferred to step 3). Docs reconciled:
  `CLAUDE.md` Vol/d line, `README.md` registry (marketfetch + this file), `pipeline/lib/suggestlog.mjs`
  schema.

### Step 2 — recalibrate every volume-denominated floor + flip the default to rolling ✅ SHIPPED 2026-07-13 (Ben-validated)
The `--mode all --stats` legacy-vs-rolling side-by-side confirmed the flood (BAND gated 23→238, CHURN
1→135, VALUE admitted 124→550, dip-pool +40). The `rolling/legacy` volDay ratio is HUGELY dispersed
(p10 7.8× · median 23.0× · p90 173×), so a flat multiplier is wrong — each floor was **count-matched** to
the corrected distribution (the floor that admits ≈ the same item count the old floor did under legacy):

| Constant | old | new | basis |
| --- | --- | --- | --- |
| `FLOOR` / `VALUE_LIQ_FLOOR` / band `thin` (`limitVol<FLOOR`) | 50 | **3,500** | count-matched (884 items; rounded 3,652→3,500, leaning looser per Ben's surface-the-lane intent) |
| `CHURN_MIN_VOL` | 2,000 | **65,000** | count-matched (361) |
| `DIP_LOOP_LIQUID_FLOOR` | 1,000 | **40,000** | count-matched (438; rounded from 42,425) |
| `GP_FLOOR` | 250m | **4,500m** | count-matched gp-flow (89; ~18×) |
| `DL4_MIN_GP_FLOW` | 500k | **9m** | GP_FLOOR's ~18× applied to DL4's own 500k turnover floor (NOT tied to MIN_GPD) |
| `DL4_MIN_ABS_SWING` | 50 | **50 (unchanged)** | per-unit price swing, not volume-linked |
| `MIN_GPD` (attention floor) | 500k | **500k (unchanged)** | Ben's call: it's a real NET-throughput quantity — 500k of TRUE throughput is the honest floor; now surfaces the smaller real-throughput lane |

Default `--vol-source` flipped to `rolling`; `legacy` kept as an escape hatch. Replay goldens regenerated
(recorded inputs now flow through the new floor constants). **Combined-effect check confirmed** (see the
"Combined-effect verification" below) — the mid-liquidity commodity lane surfaces, ghost-spread thin items
stay gated, and keeping MIN_GPD at 500k is NOT moot (it binds, not FLOOR, for the small lane).

### Step 2b — per-item node surfaces (quote.mjs + watch.mjs) ✅ SHIPPED 2026-07-13
Step 2 flipped only the `screen` surface; `quote.mjs` + `watch.mjs` still read the broken `/24h` per-item
(`fetch24hOne`) — phantom Vol/d, off pressure ratio, reach-relief firing off deflated numbers. Fixed by
`marketfetch.mjs` `vol24FromInputs(inp)`: composes the true rolling-24h from the item's IN-HAND `ts1h`
(quote COD-4, watch window line → zero new fetch), reassigned onto `inp.vol24` before `computeQuote` so
Vol/d + pressure + the 24h avg-low dip reference + reach-relief all read corrected volume; degrades to the
`/24h` read (`volSrc:'peritem-24h'`) only when the 1h series is too short (brand-new item). `computeQuote`
(js/quotecore.js, app-imported) is UNTOUCHED — only the VALUE passed in changed → no APP_VERSION. Verified
live: Soul rune Vol/d 477k(broken) → **9.82m** rolling, pressure recomputed, reach-relief fires 75%; a thin
book computes its real small volume and degrades sanely. Also landed the **CI import-resolution guard**
(`pipeline/import-check.mjs` → `checks.yml`) that closes the gap which let a missing export ride onto main.

### Step 3 — REMAINING: fix the browser app (deferred, APP_VERSION-bumping)
Every NODE surface (screen + quote + watch) now reads corrected volume; the ONE remaining broken consumer
is the browser app's `js/marketfetch.js` (`fetch24h`, feeding the Finder Grade/sort, Watch tab, Trends
Vol/d). So the published `screen.json` Scan tab + every node CLI are now MORE correct than the live app
until this lands. Per-item the app can sum its own 1h series; the Finder's bulk read needs a design decision
(24 bulk `/1h` fetches per Finder load, or read a published rolling snapshot). This is the `APP_VERSION`-
bumping change; the pipeline fix is not.

### Combined-effect verification (2026-07-13, applied config: rolling + new floors + MIN_GPD 500k)
`node pipeline/screen.mjs --mode all --stats` on the EXACT applied config:

| Niche | legacy (broken /24h, old floors) | rolling + OLD floors (the flood) | **rolling + NEW floors (applied)** |
| --- | --- | --- | --- |
| BAND gated / surfaced | 23 / 6 | 238 / 36 | **137 / 34** |
| CHURN gated / surfaced | 1 / 0 | 135 / 6 | **96 / 10** |
| VALUE admitted / shown | 124 / 22 | 550 / 20 | **122 / 22** |
| unique items fetched | 32 | 96 | **77** |
| Dip-pool added this scan | 0 | 40 (flood) | **1** (DL4 recal fixed the flood) |

The recalibration lands BETWEEN the over-tight legacy and the flood — the mid/small-liquidity lane surfaces
without the 238-gated blow-up. Newly-admitted sample (all two-sided, Vol/d = corrected rolling): big tickets
(Noxious halberd 45m, Dragon claws, Armadyl crossbow) AND the smaller real-throughput lane — Kourend teleport
tab (20.7k/d), Super strength(4) (136k/d), Blue dragon leather (278k/d), Snape grass/Torstol seed (~14k/d),
Divine ranging potion(4) (6.8k/d); CHURN commodities Black chinchompa (408k/d), Sanfew serum(4), Anglerfish,
Dragon bones, Saradomin brew(4), Mahogany plank (1.39m/d). Ghost-spread thin items stay gated (the two-sided
`hpv>0 && lpv>0` floor is untouched).

**MIN_GPD-500k combined-effect check — NOT moot, strongly BINDING.** Holding the new FLOOR fixed and raising
MIN_GPD 500k → 5m collapses BAND gated **139 → 30** (surfaced 34 → 5). So the ~109 lower-throughput band
candidates that surface are admitted specifically BECAUSE MIN_GPD stays at 500k — FLOOR (a unit floor) is NOT
the sole binding gate, and Ben's smaller real-throughput lane genuinely appears. Keeping MIN_GPD at 500k was
the operative choice, not a no-op.
