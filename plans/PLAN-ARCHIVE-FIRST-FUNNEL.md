# PLAN-ARCHIVE-FIRST-FUNNEL — gate on what we already own; rank on quality, not on wallet

**Status: PLANNING ONLY (2026-08-07). No code changed.** Two SEPARABLE changes in one doc: (A) the
capital-layer split, small and independently valuable; (B) the archive-first funnel, structural.
A does not depend on B. Every number below is measured this session and cited to how it was obtained.

---

## §0 — Diagnosis (measured, not asserted)

### 0.1 The funnel today

`node pipeline/commands/screen-flip-niches.mjs --mode all --stats`, TOP=90 (post `0763dbc`),
fully-deployed book (deployable ≈ 0), 2026-08-07:

| Stage | BAND | CHURN | AMPLITUDE |
| --- | --- | --- | --- |
| 1 · Stage-1 cheap gate | 140 gated | 93 gated | 56 admitted |
| 2 · admission → fetch | **93 fetched · 47 crowded out** | 91 · 2 out | 54 (top 40 + 18 watchlist) |
| 3 · Stage-2 gates | 63 survivors · yield **68%** | 11 · **12%** | 5 · **9%** |
| 4 · rank (Path-A gp/d) | **0/d on ALL 63 rows** | — | — |
| 5 · digest (`capEff × deployable`) | **0 for every row** | | |

177 unique items fetched per `--mode all` pass, each costing 2–3 per-item `/timeseries` calls.

### 0.2 Finding A — capital is multiplied in at three layers; TWO of them collapse at zero

Capital enters at `THROUGHPUT_CAP_GP` (pre-fetch, inside `expGpDay`), at Path-A gp/d (post-fetch, the
**primary console sort**), and at the digest's `rankKey = capEff × deployable`. On a fully-deployed
book, **all 63 band rows printed `Path-A 0/d` and every digest row ranked 0 simultaneously** — the
board's primary sort and its triage view were both dead at once.

⚠ **CORRECTED after review: "all three collapse" was wrong — Stage-1 already handles zero.**
`gatecandidates.mjs:273` reads `t.THROUGHPUT_MODE !== 'legacy' && t.THROUGHPUT_CAP_GP && mid > 0`, and
the comment two lines above states the intent outright: *"A null/absent OR ≤0 pool degrades to
capital-blind legacy (a 0 pool is a failed/empty cash anchor — degrade to legacy rather than nuke the
whole screen to expGpDay 0; the `&&` truthiness handles both)."* So the zero-collapse is real for
**Path-A** (`patha.mjs:105`, `floor(capital/price)` → 0) and the **digest** (`screen-flip-niches.mjs:806`)
only. Sub-defect (i) "no defined behaviour at deployable ≈ 0" does NOT apply to Stage-1 — that layer
already got this right, and its handling is the model the other two should copy.

Observed consequence (digest, same pass): an **A- `fill-now` row sorted BELOW three D/C `sell
unreliable` rows**, with 8 of 11 rows reading `sell unreliable`.

| Item | capEff | deploy | grade | verdict |
| --- | --- | --- | --- | --- |
| Bronze dart | 3155.56%/d | 0 | **D** | sell unreliable |
| Quetzal feed | 231.42%/d | 0 | C | sell unreliable |
| Camphor plank | 61.28%/d | 0 | C | sell unreliable |
| Venator ring | 4.23%/d | 0 | **A-** | **fill-now** |

A product stops being a ranking the moment one factor is zero. Two sub-defects: (i) no defined
behaviour at `deployable ≈ 0`; (ii) `capEff` is unbounded, so dust prints 3155%/d and dominates any
product it survives.

### 0.3 Finding B — the pre-fetch ranker does not predict post-fetch score

The top crowded-out band row is **Sanguinesti staff (uncharged)**, excluded with
`reason: thin-reserve-full` and a Stage-1 `expGpDay` of **~12.89m/d**. Admitted via
`--thin-reserve 15` and actually fetched, the same row reads:

> `Est. buy 17.78m (3/3 · 8/14 · p64) · Est. sell 18.23m (1/3) · net +88,162/u (+0.5%) · P(ask)~50%
> · rank 140k · A- · Path-A 0/d ⚠<floor`

**Do NOT read 12.89m/d as forgone profit** — read it as the fetch queue being sorted by roughly the
wrong key.

⚠ **CORRECTED after review: the "orders of magnitude" framing was unit-confused.** Stage-1 `expGpDay`
is gp/DAY; "rank 140k" is `net × P(fill) ÷ TTF` (different units); and `Path-A 0/d` is zero **because
capital is 0** — the very artifact §0.2 diagnoses, not a statement about the item (every row on that
board reads `0/d`, including an 8gp Raw mackerel). The apples-to-apples comparison is Stage-1's implied
modeNet ≈ 277k/u against post-fetch net **+88k/u ≈ 3×**, before P(fill) ≈ 0.5. **The direction holds —
the proxy over-orders — but the magnitude is ~3×, not orders of magnitude.** Also: crowd-out membership
churns daily (Sanguinesti staff is IN the default board on a later pass, A-, rank 142.3k), so this is
an illustrative anchor, not a stable one. This is why `TOP` 40→90 doubled the board
(BAND 32→67) without surfacing this row at all: widening a mis-ordered queue buys more of the wrong
items. MT1 documented this hazard class (Stage-1 `expGpDay` vs post-fetch Path-A against one 500k
constant); this is the first measurement of it on the top excluded row.

### 0.4 Finding C — the reserves bind, and raising them is a queue re-order

`THIN_RESERVE` = 6. 47 of 140 band candidates never get a fetch slot. At `--thin-reserve 15` (its
`THIN_RESERVE_MAX`) the best excluded is *still* `thin-reserve-full` (Necklace of anguish, ~8.58m/d).
The reserve queue is deeper than the reserve at any sanctioned size. Per `admission.mjs`'s own ruling
the reserves are **validation scaffolding with an exit condition** — "once the top-N is proven to
surface the best candidates for the capital pool, the reserves are not needed at all."

### 0.5 Finding D — we pay API to DECIDE, and we already own the data

The Stage-2 gates (reach, trajectory/floor, amplitude, term structure) are **14-day history reads**.
Measured contents of `pipeline/.market-archive.sqlite`:

| grain | items | rows | span | newest | items w/ data <24h | items w/ ≥300 obs in 14d |
| --- | --- | --- | --- | --- | --- | --- |
| `1h` | **4,489** | 5,085,789 | 70.7d | **1.8h old** | 4,155 | **2,297** |
| `5m` | **4,438** | 6,726,713 | 29.8d | **0.2h old** | 4,097 | **2,619** |

Row shape is `{ts, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume}` (`archive.mjs:150–159`).
`open().seriesFor(id, grain, {from,to})` returns it directly (verified: 71 points for 3 days of 1h on
Masori body, id 27229).

⚠ **NOT drop-in — the key is `ts`, every consumer reads `timestamp`** (corrected after review; the
earlier "identical shape" claim here was WRONG). `windowread.mjs:259,880,1173,1512,1569` and
`quotecore.js:246` (`points.filter(p => p && p.timestamp != null …)`) all key on `timestamp`. Fed raw,
archive rows are **silently discarded by every filter** — `windowStats` returns empty, the gates
degrade-to-pass, and nothing throws. This is a one-line rename, but the failure mode it would have
caused is the quiet kind, so AF4's fixture pin is load-bearing, not ceremony. The four VALUE columns
are genuinely identical; only the time key differs.

The archive is fed for free by the `cache-warm` daemon (`PT1H45M`, zero-git) off the **bulk**
`/5m?timestamp=W` and `/1h?timestamp=W` endpoints, which return ~1,800 items per call. So the marginal
API cost of gating one more candidate from the archive is **zero**, while the marginal cost of gating
one more candidate today is 2–3 per-item calls — which is the entire reason the reserves exist.

---

## §1 — The two changes

### A · Capital-layer split (small, independent, do first)

One question per layer, one form per question:

| Question | Form | Layer |
| --- | --- | --- |
| Can I afford this at all? | **binary filter** | Stage-1 cheap gate — the only layer that can drop an item *before* paying a fetch |
| How good is this opportunity? | **rank — containing NO capital** | Stage-2 / rating |
| How much can I deploy? | **sizing, shown per row** | presentation |

Quality is a property of the item and the market, not of the wallet: an A- setup is A- at 100m or at
0. Removing capital from the rank is what stops an A- row sorting below a D row.

Zero-capital then behaves correctly at every layer: the affordability filter empties the list (or is
bypassed — see Open Q3), the quality rank is **unaffected**, and sizing annotates each row with an
explicit "0 deployable" instead of a silent multiply-by-zero.

⚠ **This reverses a recorded owner ruling and must engage it as one (review MAJOR).**
`THROUGHPUT_CAP_GP`/`capPerWindow` is **PLAN-CAPITAL-THROUGHPUT, Ben 2026-07-14**
(`gatecandidates.mjs:88–95,160–180`): the attention floor deliberately asks *"if I dedicate everything
to this ONE lane, can it net 500k/day?"* — and **gp/day throughput IS inherently wallet-relative**. An
item needing a 40m tranche per window cannot yield 500k/d to a 5m pool, and a binary "can I afford one
unit" filter does **not** capture that. The design is also self-targeting: where a tranche is
affordable, capital-aware is byte-identical to legacy (`:170–174`), so it only demotes where capital
genuinely binds. **The strongest case against change A is therefore that Stage-1's capital-awareness is
correct and should be kept** — the defect is confined to Path-A and the digest. Countervailing owner
precedent exists (PLAN-GRADE-REWORK deleted `capitalFactor` from GRADES, `admission.mjs:112–114`), so
the honest scope is: **capital-free GRADES and RANKS, capital-aware THROUGHPUT gate.** Ben's call.

**⚠ The trap in "rank on quality" (review MAJOR).** The A--below-D ordering in §0.2 is produced by the
`rankKey = 0` tie falling through to **`capEff`-desc** (`screen-flip-niches.mjs:890–892`) — i.e. by a
capital-free key. The `× deployable` was added precisely because "raw capEff is SCALE-FREE, so
dust-tier cheap high-% items swept the top-N" (`:751–752`). So **the naive reading of AF1 reproduces
the exact bug it is meant to fix.** The replacement key must be scale-aware without being
wallet-aware — net-per-lap × P(fill) ÷ TTF is the existing candidate. Name it in AF1 or do not ship it.

### B · Archive-first funnel (structural)

Invert what API spend buys. Today: spend API to DECIDE (fetch 93 to gate them), then price. Proposed:

1. **Gate on the archive** — run every Stage-2 gate for **all** gated candidates off `seriesFor`, zero
   API. Crowding-out disappears because there is no per-candidate fetch cost to ration.
2. **Fetch to PRICE only** — per-item live calls for the final shortlist (~20), not the pool (~177).
3. **Delete the reserve scaffolding** — `THIN_RESERVE` / `GEAR_RESERVE` / `MID_TIER_RESERVE` exist to
   ration a budget that no longer binds. This is their stated exit condition, reached by removing the
   constraint rather than by proving the ranker.

⚠ **UNRESOLVED — the "~20 shortlist / ~10× saving" was incoherent as first written (review BLOCKER).**
Today's board prints **63 band + 10 churn + 5 amplitude rows, every one carrying a quoted Est. buy/sell**.
That cannot coexist with "price only ~20" and risk #3 ("no archive data reaches a quoted price"). Three
mutually exclusive resolutions, and the plan must PICK one before AF7:

| | What it means | Saving | Cost |
| --- | --- | --- | --- |
| **(a) shrink the board to ~20** | product change | ~10× | contradicts `0763dbc`, landed the SAME DAY to widen the board 32→67 — almost certainly wrong |
| **(b) price every surfaced row** | board unchanged | **~2–3×** (≈78×3 vs ≈177×3 calls) | honest, smaller than advertised |
| **(c) archive-price the tail** | board unchanged | ~10× | violates risk #3 — forbidden |

**Provisional pick: (b).** The real win is not the call count — it is that **every** gated candidate
gets scored instead of 66%, and the reserves/crowding-out disappear. Restate the benefit as
*coverage*, not as a 10× API reduction, until measured. Note the `tsSlow` 15-min TTL
(`marketfetch.mjs:79`) means repeat passes inside the window don't pay full freight anyway — the
"177 × 2–3 calls" bill is the COLD-pass worst case and should be labelled as such.

---

## §2 — Chunks

| # | Chunk | Dep | Effort |
| --- | --- | --- | --- |
| ~~**AF1**~~ | ✅ **SHIPPED `cdce288` 2026-08-07.** Digest sorts on `rank` (net × P(fill) ÷ TTF) — scale-aware, capital-free, already computed per row. `capEff` and `deploy` stay as displayed columns; only the sort basis changed. The "must not be bare `capEff`" trap was real: at `deployable ≈ 0` the old key collapsed into the `capEff` tie-break, reproducing the dust-sweep by another route. | — | S |
| **AF1b** | Bound `capEff` (sub-defect ii). Unbounded %/day is what lets a dust item print 3155%/d. No chunk owned this before review. | — | S |
| ~~**AF2**~~ | ✅ **SHIPPED `cdce288` 2026-08-07.** Path-A is now MARKET THROUGHPUT (`capital: Infinity`) — what the item can produce, not what this wallet can extract. Capital rides as `affordableUnits` in the cell title. Measured: band rows reading `0/d` went **62/62 → 0/62** at zero deployable, and **0/63 → 0/63** at `--capital 200m` (non-degenerate case unaffected). ⚠ The `pathA.gpDay` logged to `suggestions.jsonl` (Chunk E) changes MEANING at this commit — a join across it sees a discontinuity. | — | S |
| **AF3** | Stage-1 affordability **filter**. **RULED (Ben, 2026-08-07): KEEP, but CONDITIONAL — only worth doing if the initial candidate pool is ALSO driven from archived data rather than a live fetch.** Dependency moved from AF1/AF2 to AF6: a capital filter over a live-fetch-budgeted pool just re-shuffles the 93 items we could already afford to look at; over an archive-driven pool it filters the real universe. Do NOT build it standalone. | **AF6** | M |
| **AF3b** | **The cream-of-the-crop problem (Ben, 2026-08-07) — the real goal of this plan.** *"For our top 40 or 90 we need to work on a way to 1. FILTER and 2. SORT so that we can get a smaller population that are the cream of the crop candidates to investigate further. If that's not possible we may need to resort to just looking at the entire universe, but I'd like to avoid that if possible."* Two distinct problems: a **filter** (what is disqualified outright) and a **sort** (what leads among the qualified). §7.1 of `PLAN-ASK-BACKTEST.md` shows we currently have NO validated basis for either — grade/rank/pFill all fail against the one observable outcome, and that outcome is itself confounded by trade frequency. **So this chunk is blocked on evidence, not on code.** The fallback Ben names — score the entire universe — becomes cheap once gating is archive-driven (AF6), which is the argument for doing AF4→AF6 first and treating whole-universe as the honest baseline to beat rather than the failure case. | AF6 | **L** |
| **AF4** | `archiveSeriesFor(id, grain, days)` adapter + a `6h`-from-`1h` aggregator, shape-pinned against a live `fetchTs` fixture. | — | M |
| **AF5** | Route ONE Stage-2 gate (proposal: trajectory/floor) through AF4 for all gated candidates; shadow-log archive-vs-live verdicts, change nothing. NB it is not purely archive-fed today — `warmOverride` (`screen-flip-niches.mjs:1047`) injects a LIVE 1h series while `loadDaily` is cold; that injection is what AF5 replaces. | AF4 | M |
| **AF5b** | **Migrate the 6h consumers — `regimeDrift` (`quotecore.js:173–192`, `windowStats nights:20`) and `phase()`. MISSING before review, and it is the biggest gate**: falling/regime is the dominant band discard (23 of 41). AF7 cannot land without it. | AF4 | **L** |
| **AF6** | Promote AF5/AF5b to real gates once the shadow log clears its stated threshold; extend to reach + amplitude. | AF5, AF5b | M |
| **AF7** | Shortlist-only live pricing; measure API calls + wall-clock before/after. | AF6 | M |
| **AF8** | Retire the reserves. **Scope corrected: there are SEVEN** (THIN/RISING/VALUE/watch/EXPLORE/GEAR/MID_TIER — `admission.mjs:80`) plus held, not three; and if the budget stops binding, `rankAndSlice`/`proxyDrift`/`softFactor` fetch-ordering is equally vestigial. **Deleting them also terminates EF-0a's `via`/`preRank`/`prePool` natural experiment** and changes the `suggestions.jsonl` surface — needs a bookkeeping/compat note. The recorded exit condition is *evidence-based* ("once the top-N is SHOWN to surface the best candidates"); removing the constraint instead of proving the ranker is a different move and must be labelled as one. | AF7 | M |
| **AF9** | Optional (strategy 5): `cache-warm` precomputes the gate pass into a ranked candidate file; interactive scan reads it + prices ~20. | AF7 | L |

**Sequence:** `AF1 + AF2` (independently valuable, land today) → `AF4 → AF5 → AF6 → AF7 → AF8`, with
`AF3` any time after AF2 and `AF9` last.

---

## §3 — Risks and honest gaps

1. ~~**Coverage is 2,297 dense-history items, not 4,489** … UNVALIDATED: are the ~140 band-gated
   candidates inside the dense set?~~ **✅ CLOSED, MEASURED FAVOURABLE (review, 2026-08-07.)** Replicating
   Stage-1 via `gateCandidates` on the same bulk ctx: **143 of 144** band-gated candidates have ≥300 1h
   obs in 14d, **144/144** on 5m, and **143/144** have ≥80% 1h coverage over **21 days** — a stricter bar
   than this plan's own 14d predicate, and the depth `regimeDrift`'s `nights:20` and `phase()` actually
   need. Amplitude 43/43. The single sparse item (Ardeaglais teleport, 227 obs) still has enough to gate.
   B's benefit does not shrink on coverage grounds. A live fallback for sparse items is still required as
   a correctness guard — it just will not fire often.
2. **`6h` is not stored** (grains are `1h` and `5m` only). Derivable by aggregating 1h — precedent
   `rolling24FromTs1h`. ⚠ **CORRECTED: "lossy for volume-weighted means" is wrong reasoning** — a
   volume-weighted mean of volume-weighted 1h means over an ALIGNED 6h partition is mathematically
   **exact**. The real error sources, which AF4 must state **per price tier**: (a) the wiki stores avg
   prices as **integers**, so a recomposed 6h mean carries ±0.5gp per-bucket rounding — negligible on
   gear, but 0.5gp on an 8gp item is **6%**, against `driftPct` thresholds of ±5%, so it can flip a
   regime on penny items; (b) 1h holes (median coverage 334/336 buckets — small); (c) the newest ~1.75h
   is not yet archived. A gear-only fixture would validate clean and still misclassify commodities.
3. **Freshness is adequate for gating, NOT for pricing.** 1h is 1.8h old, 5m 12 min. Gates are 14-day
   reads so this is immaterial; prices must stay live (`/latest`, already bulk). **Any chunk that lets
   archive data reach a quoted price is out of scope** and must be flagged, not done.
4. **Behaviour change is the point, so "byte-identical" cannot be the acceptance.** AF5's shadow-log
   is the mechanism: prove archive and live agree on VERDICTS before switching, then accept the diff.
5. **AF1/AF2 change the order Ben reads rows in.** That is the intent (an A- should not sort below a
   D), but it is a visible change to a daily surface and needs his sign-off, not just green tests.
6. **Removing the reserves removes an exploration mechanism.** The rotation lottery (~12h/turn) is how
   never-fetched items ever get a look. If gating is free, exploration should be free too — but
   confirm before deleting rather than assuming.
7. **n≈0 throughout.** No claim here is calibrated. AF5's shadow log is the first real evidence.

---

## §4 — Open questions for Ben

1. **AF1/AF2 reorder your daily board.** Land them now, or behind a flag for one session's comparison?
2. **Strategy 5 (AF9)** makes the interactive scan near-instant but candidates up to 105 min old. Gates
   are 14-day reads so this is defensible — worth it, or is live-on-demand preferable?
3. **At zero deployable, should the affordability filter empty the board, or show everything annotated
   "0 deployable"?** The latter answers "what do I buy when cash frees up"; the former is honest about
   what is actionable *now*. Recommend the latter, but it is a desk preference.
4. **Is 45m `--max-price` still right** once gating is free? It exists partly as a fetch-budget proxy.

---

## §5 — Acceptance

| Chunk | Verified by |
| --- | --- |
| AF1/AF2 | A synthetic zero-deployable pass ranks A- above D; a non-zero pass is unchanged in ORDER where capital was previously non-binding. |
| AF4 | Archive-derived series byte-matches `fetchTs` on a fixture for `1h`/`5m`; 6h aggregation error stated numerically, not hand-waved. |
| AF5 | Shadow log over ≥N passes: archive-gate vs live-gate verdict agreement rate, per gate, published before promotion. |
| AF7 | Per-item call count and wall-clock, before/after, cold cache, same mode. |
| AF8 | `--stats` shows 0 crowded-out; every gated candidate carries a Stage-2 verdict. |

---

## §6 — Review record (Fable, 2026-08-07)

Adversarial review + independent re-measurement. Findings folded in place above, not appended — the
inline claims they correct have been rewritten, per CLAUDE.md rule 8.

**Reproduced independently:** the whole §0.5 archive table (1h 4,489 items / 5,085,789 rows / 70.7d /
4,155 <24h / 2,297 dense — five exact matches; 5m figures reproduce with accrual drift); the §0.1
funnel (band 141/93/48/63/68% vs 140/93/47/63/68% — day drift; amplitude 56/54/5 exact); Path-A `0/d`
on every row of a zero-deployable book (an 8gp Raw mackerel reading 0/d proves capital is exactly 0);
the reserve doctrine quote and THIN_RESERVE 6 / MAX 15; TOP=90 post-`0763dbc`.

**Corrections applied:** `ts`≠`timestamp` (§0.5, was "identical shape" — false, and fails SILENTLY);
"all three collapse at zero" (§0.2 — Stage-1 already degrades to capital-blind by design);
"orders of magnitude" (§0.3 — unit-confused; real gap ≈3×); the ~10×/~20-shortlist contradiction
(§1-B, now three explicit options with a provisional pick); "lossy aggregation" (risk 2 — exact in
principle; integer rounding is the real hazard, and it is price-tier dependent); AF8's scope (seven
reserves, not three, plus the terminated `via` experiment); AF1's undefined replacement key + new
AF1b for unbounded `capEff`; new **AF5b** for the missing regime/6h migration — the biggest gate.

**Closed favourably:** risk 1 (dense-history coverage) — 143/144 band-gated candidates clear a bar
STRICTER than this plan asked for.

**Not independently verified, stated as such:** the §0.2 digest row values and "8 of 11 sell
unreliable" (needs that pass's `--digest` state); "177 unique items"; the Necklace-of-anguish
`--thin-reserve 15` figure. The mechanism behind each was confirmed in code even where the datum was
not re-run.

**Repro note:** `--stats` prints nothing without `--verbose`.
