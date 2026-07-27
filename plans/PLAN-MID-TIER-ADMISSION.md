# PLAN-MID-TIER-ADMISSION — the mid-price band is structurally invisible to the default scan

**Status:** scoped. Problem confirmed, root cause CORRECTED (§3), rulings recorded (§6), chunks MT1–MT3
scoped (§7). Class B (§4) deliberately left unscoped. Surfaced 2026-07-26, Ben-flagged ("we haven't had
any mid items enter — not big gear, not churn — stuff like neitiznot helm"); diagnosis corrected and
scoped 2026-07-27.

**Honesty (process rule 4):** the item-level numbers below are from ONE scan pass on 2026-07-26. This is a
*structural* argument (the mechanism is in the code and the arithmetic is checkable), not a calibration
claim. Do not re-tune a threshold off this document's numbers alone. The §3 correction is a **code read**,
not a new scan — see §3.4 for why no confirming scan was run.

## Status

| Chunk | What | Status |
| --- | --- | --- |
| MT1 | MIN_GPD description reconciliation (doc-only, zero behavior change) | not started |
| MT2 | `GEAR_RESERVE` — a gear-lane fetch reserve in `pickFetchPool` | not started |
| MT3 | Report the exploration reserve's real rotation period | not started |
| — | Class B liquidity-floor recalibration | NOT scoped (§4) |

---

## 1. The problem

The screen surfaces two populations — **big gear** (tiny buy limits, huge per-unit margins) and **churn
commodities** (huge limits, tiny margins, volume does the work). The band between them — call it
**mid-tier gear**, roughly 10k–2m mid, items like Helm of neitiznot, Berserker helm, Dragon scimitar —
has never appeared in a default `/scan`.

It is not that these items are unprofitable. Helm of neitiznot rates **B-** with **Path-A 420.7k/d** and
`+1,648/u (+3.5%)` at 6.2k/d volume. It is simply never fetched.

## 2. Evidence

Default scan (`--mode all`, `--top 40`): band lane printed **20 rated from 176 gated, top 41 fetched**.
Helm of neitiznot absent.

Same screen at `--top 150` (`--mode band --top 150 --no-publish`):

```
| Helm of neitiznot | 48,537 | 47,352 (2/3 · p93) | 49,999 (1/3) | +1,648 (+3.5%) · P~30% |
  48,319 | 6.2k/d | – | Flat · ranging | B- | 1,027 · net 1.6k P~0.15 ttf~4.8h |
  420.7k/d · L12·gear ⚠<floor |
```

Band lane went **20 rated → 91 rated**. The item was gated-in the whole time (177 gated either way); it
just never won a fetch slot.

## 3. Root cause — CORRECTED

> **The original draft of this document blamed `MIN_GPD`. That was wrong.** The correction matters
> because it changes the fix: a floor problem argues for lowering a threshold, an *ordering* problem
> argues for a reserve. Recorded rather than silently edited — the misdiagnosis was caused by a real
> doc inconsistency in the code, which MT1 fixes.

### 3.1 `MIN_GPD` is a hard gate, and mid-tier gear PASSES it

`gatecandidates.mjs:284` is a hard drop, not a demotion:

```js
if (!thin && !held && expGpDay < t.MIN_GPD) return null;
```

Helm of neitiznot clears it comfortably. Stage-1 `expGpDay = expUnits(limit, limitVol, capPerWindow) × modeNet`:

```
expUnits = min(limit × 6, 10% × volDay) = min(70 × 6, 620) = 420 units/day
expGpDay = 420 × 1,648                  ≈ 692k/day   ≥ MIN_GPD (500k)  ✓
```

The document's own evidence already proved this and the draft missed it: **177 candidates gated at BOTH
`--top` settings.** `MIN_GPD` runs before the fetch cap, so if it were excluding the item the gated count
would have differed and the item could never have printed at `--top 150`.

### 3.2 The `⚠<floor` marker measures a DIFFERENT number

The `420.7k/d ⚠<floor` on the printed row is **Path-A gp/day** (`patha.mjs pathAGpDay`) — a post-fetch
intraday-flip estimate with a `captureFrac` placeholder. The gate above uses Stage-1 `expGpDay`. Two
different metrics are compared against the same 500k constant, in the same output, without saying so:

| Metric | Value | Where | Role of the 500k constant |
| --- | --- | --- | --- |
| Stage-1 `expGpDay` | ~692k/d | pre-fetch, `gatecandidates.mjs:284` | **hard gate** — sub-floor is dropped |
| Path-A `gpDay` | 420.7k/d | post-fetch, `screen-flip-niches.mjs:445` | **display marker** — "surfaced, not gated" |

An item can therefore be admitted on one number and flagged sub-floor on the other. That is exactly what
Helm of neitiznot does, and it is what made this plan's first draft misattribute the cause.

### 3.3 The actual binding cause: absolute-`expGpDay` fetch ordering + the `--top` cap

The item is a normal non-thin candidate (`limitVol` 6.2k ≥ `FLOOR` 3,500 ⇒ not `thin`), so it lands in
`pickFetchPool`'s **velocity lane** (`admission.mjs:169`), sorted on:

```js
expGpDay × softFactor(proxyDrift) × trackBoost
```

and truncated to `nonThinBudget = top − thinAdmitted − exploredThin − risers` ≈ 41 − 6 − 1 − 4 ≈ **30
slots for ~170 candidates**. At ~692k it competes head-on with churn commodities reaching 4.21m/d on the
same absolute axis. It loses every pass, deterministically.

**This is not the thin-reserve failure mode.** The thin reserve (`THIN_RESERVE` 6) exists precisely so
big gear does not compete on this axis. Mid-tier gear is too liquid to be `thin`, so it gets no such
protection, and too low-margin to win the absolute sort. It is the one class with neither a reserve nor a
winning rank.

Supporting read: the row printed **`L12·gear`** — 12th in its volume lane (`classifyVolLane`, gear =
`volDay < CHURN_VOL_CUT` 20k) among the 91 rated at `--top 150`. Respectable standing *within its own
lane*, invisible in the unified one. Honesty: `rankInLane` is computed post-fetch
(`screen-flip-niches.mjs:1332`), so this is its rank among rated rows, **not** a proof it would rank 12th
among the 177 gated.

### 3.4 The exploration reserve does not rescue it

`admission.mjs` documents the rotating exploration reserve as "starvation-proof by construction". For
this class that claim is technically true and practically empty. With `EXPLORE_RESERVE_DEFAULT = 2`:

```
velExploreN = floor(2 / 2) = 1 slot, rotating every ROTATE_MS = 30 min
excluded velocity-lane pool ≈ 140 candidates
⇒ expected wait ≈ 140 × 30 min ≈ 70 hours of CONTINUOUS scanning per item
```

A three-day rotation period is starvation in every sense that matters to a person reading a scan. The
mechanism is sound; its budget is not sized to the pool it rotates over. MT3 makes that number visible.

**Why no confirming scan was run (2026-07-27):** `screen-flip-niches.mjs:2313` unconditionally invokes
the local sync, which would execute another agent's in-flight `lib/reconstruct/` matching work and
rewrite `positions.json`. The §3 correction is a pure code read and needs no fetch; re-tuning off a fresh
scan is barred by rule 4 anyway.

## 4. Class B — a separate problem, deliberately NOT scoped

Berserker helm (780/d) and Dragon scimitar (1.7k/d) never become candidates at all. Admission is
`limitVol ≥ FLOOR (3,500/d)` **OR** `limitVol × mid ≥ GP_FLOOR (4.5b)` (`screen-flip-niches.mjs:171,233`).
The two paths cross at:

```
3,500 = 4.5e9 / mid   →   mid ≈ 1,285,714
```

Above ~1.29m mid the gp-flow path gets progressively easier as price rises (Ancestral hat: 189/d × 53m ≈
10b ✓). Below it the flat 3,500/d requirement binds, and cheap churn clears it trivially. Mid-tier gear is
**too cheap for the gp-flow path and too slow for the volume path**.

`FLOOR` was recalibrated **50 → 3,500** in PLAN-VOL24 step 2 (count-matched against the corrected
rolling-24h volume distribution). Whether that overshot for this band is a real question — but it is a
**distribution study, not a code chunk**: answering it needs the corrected volume distribution across the
mid band plus an outcome join, which is `/analyze` territory. 780/d genuinely may be too thin to want.
Left open on purpose; MT1–MT3 do nothing for Class B and should not pretend to.

## 5. Relationship to the existing open entry

PLAN.md "Open" already carries **"Thin-reserve should scale with `--capital`"** (2026-07-23) — at high
capital a fixed 6-slot `THIN_RESERVE` starves *thin big-tickets* (Sanguinesti staff, Basilisk jaw,
Webweaver bow), interim workaround `--top 90`.

A **sibling, not a duplicate** — same function, different starved population:

| | Existing entry | This document |
| --- | --- | --- |
| Starved class | thin **big-tickets** | **mid-price** gear |
| Cause | fixed `THIN_RESERVE` doesn't scale with capital | absolute-`expGpDay` velocity-lane ordering + `--top` cap |
| Lane | thin lane (has a reserve, too small) | velocity lane (has no reserve at all) |
| Binding constraint | reserve slot count | rank against churn on an absolute axis |

Both live in `pickFetchPool` (`pipeline/lib/signal/admission.mjs` — **path updated post-reorg**, was
`pipeline/lib/admission.mjs`). MT2 edits the block immediately below the thin lane, so the two should
land together or MT2 first; either order is fine, but not concurrently in two branches.

## 6. Rulings

**R1 — the pre-fetch orderer must NOT rank on capital efficiency.** Not a preference, a practical
impossibility: `capEfficiency(spec, er, …)` (`screen-flip-niches.mjs:520`) takes `er`, the estimator
result, which only exists **after** the per-item fetch. Ranking the fetch pool on `capEff` would require
inventing a pre-fetch proxy for it — a new unvalidated number in the one place a wrong number is
invisible. Resolves open question 1: `MIN_GPD` stays an absolute pre-fetch floor.

**R2 — a reserve is the right fix, not a re-rank.** Resolves open question 2 (yes) and open question 4
("surface it, don't prioritise it" — which *is* a reserve). Every precedent in this subsystem is an
additive guarantee that leaves the main ordering untouched: `THIN_RESERVE`, `RISING_RESERVE`,
`VALUE_RESERVE` (`admission.mjs:121`), the amplitude `watchReserve` (`:144`), the exploration reserve
(`:187`), and — at display level — the digest's POLISH 1 "guaranteed big-ticket slice"
(`screen-flip-niches.mjs:~800`), which appends an under-represented class rather than re-ranking. MT2
follows that shape exactly.

**R3 — the per-lane-grading history does NOT block this work.** Ben's recollection is real and correctly
remembered: `capitalFactor` was **deleted** in `5fea8bd` (PLAN-GRADE-REWORK, 2026-07-25), removing the
per-unit-price big-ticket penalty from the grade; G2 (deployable-fold) and G3 (per-mode grading) were
**deferred** — the commit's stated reason: *"Path-A subsumes the 'deployable gp/day ranking' North Star,
so reforming the legacy rank to also be deployable-aware is lower-value and the tangled part."*

That ruling governs the **grade** — "how good is this edge, once measured". Fetch admission answers a
different question — "which items are worth spending a fetch on". MT2 never touches `rating.mjs` and
never changes a grade, a score, or `screen.json`. So the history is not an objection to MT2.

It **is** a live warning about scope drift: the moment this work starts proposing a capital-relative
*grade* or a per-lane *grading*, it has walked back into the thing that was deliberately deferred, and it
needs a fresh owner decision rather than this document's authority.

## 7. Chunks

### MT1 — reconcile the `MIN_GPD` description (doc-only, zero behavior change)

Three in-tree descriptions of the same constant, one of them wrong:

| Site | Says | Verdict |
| --- | --- | --- |
| `screen-flip-niches.mjs:76` | "the 500k `--min-gpd` pre-filter (P6b demotion)" | **WRONG** — `gatecandidates.mjs:284` returns `null`; it is a hard drop |
| `screen-flip-niches.mjs:243` | "applied PRE-RATING so grades never advertise sub-floor rows" | correct |
| `screen-flip-niches.mjs:445,1452` | "⚠<floor … surfaced, not gated" | correct, but about **Path-A gp/day**, not the gated `expGpDay` |

Fix: correct :76 to "hard gate", and add one comment at the `⚠<floor` render site naming the two-metrics-
one-constant hazard from §3.2. Per process rule 8 this is a reconciliation, not an addition — the wrong
sentence is edited in place, not annotated. Pipeline-only, no `APP_VERSION` bump.

### MT2 — `GEAR_RESERVE`: a gear-lane fetch reserve in `pickFetchPool`

The core fix. In `admission.mjs`'s non-thin path, after `velocityAdmitted`/`velocityRemainder` are
computed, reserve N slots for `gear`-lane candidates that lost the unified sort:

```js
export const GEAR_RESERVE_DEFAULT = 4;   // PLACEHOLDER (rule 4)

// after velocityRemainder / exploredVelocity
const exploredIds = new Set(exploredVelocity.map(c => c.id));
const gearReserve = velocityRemainder
  .filter(c => !exploredIds.has(c.id) && classifyVolLane(c.volDay ?? 0) === 'gear')
  .sort((a, b) => ((b.expGpDay || 0) * boostOf(b)) - ((a.expGpDay || 0) * boostOf(a)) || (a.id - b.id))
  .slice(0, gearReserve_)
  .map(c => ({ ...c, via: 'reserve' }));
```

Design notes, each tied to an existing precedent:
- **Additive, mirroring the value reserve** (`admission.mjs:121-126`): the ranked top-N is untouched, so
  `gearReserve = 0` is byte-identical to today and the whole chunk is revertible by a constant.
- **`via:'reserve'`** is the existing marker. It is already in `clampUnionFetch`'s `isProtected`
  (`admission.mjs:224`), so reserved rows survive the cross-niche ceiling for free, and the renderer
  already knows how to mark a reserve-slotted row.
- **Excludes rows already taken by exploration**, so the two reserves cannot double-spend a slot.
- **Ranked on `expGpDay × trackBoost` within the gear lane** — the same axis, just against a peer group
  instead of against churn. No new metric is invented (R1).
- **`classifyVolLane` is imported from `lib/signal/structural-admission.mjs`** — the existing lane
  discriminator, not a new one.
- **⚠ `volDay` must be threaded onto the candidate — do NOT substitute `limitVol`.** This is the one
  trap in the chunk. `eachLiquidCandidate` returns `limitVol = Math.min(hpv, lpv)`
  (`gatecandidates.mjs:228`) — the thin-side **depth**. `classifyVolLane` expects **total** two-sided
  volume, `hpv + lpv` (`structural-admission.mjs:25-28`, and `screen-flip-niches.mjs:1332` passes
  `row.volDay`). They differ by up to 2× on a balanced book and far more on a lopsided one, so passing
  `limitVol` would classify churn items as gear and quietly poison the reserve with the exact population
  it is meant to keep out. Fix is one line — `hpv`/`lpv` are already in scope in the `fn` context, so add
  `volDay: hpv + lpv` to the object returned at `gatecandidates.mjs:285`. **Add a unit test pinning that
  the reserve's lane call receives `hpv+lpv`**, because the wrong value here produces a plausible-looking
  reserve rather than a crash.
- **Fetch cost:** +`GEAR_RESERVE` items per non-thin niche per pass, bounded above by `TOTAL_FETCH_MAX`.

Open sub-decision for the owner: whether `GEAR_RESERVE` scales with capital like the sibling entry in §5
proposes for `THIN_RESERVE`. Recommend **shipping it fixed first** — a fixed reserve is the thing whose
effect can actually be read off one before/after scan; capital-scaling both reserves is a coherent
follow-up once mid-tier rows have appeared at all.

Verification: unit tests on `pickFetchPool` (reserve fills only from gear-lane remainder; `0` ⇒
byte-identical survivors; no double-spend with exploration; reserved rows protected by `clampUnionFetch`),
plus a manual `--mode band` before/after showing whether a mid-tier row now appears. **n = 0 on whether
mid-tier flips are profitable** — this chunk buys the class visibility, nothing more (§8).

### MT3 — report the exploration reserve's real rotation period

`renderMode`'s crowded-out line (`screen-flip-niches.mjs:1602-1606`) already reports the count and the
best excluded candidate. Extend it with the §3.4 arithmetic — excluded-pool size ÷ slots × `ROTATE_MS` —
so "starvation-proof by construction" is reported with its actual period instead of implying promptness.
Inform-only, one line, no behavior change. Cheap and it is the honest counterpart to MT2.

## 8. Non-goals

- **Not** a request to lower `MIN_GPD`. §3 shows the floor was never the binding constraint here; the
  floor's real job (dropping dust-tier noise) is untouched.
- **Not** a live tuning change off one scan (rule 4). Every constant introduced is a PLACEHOLDER.
- **Not** a grade/rank/`screen.json` change. MT1–MT3 touch admission and stdout only (R3).
- **Not** a claim that mid-tier items are profitable in practice — no mid-tier flip has ever been logged,
  precisely because none has ever been surfaced. **n = 0.** The chunks buy the class a look, and the
  honest success criterion is "mid-tier rows now appear and can be judged", not "mid-tier makes money".
- **Not** a Class B fix (§4).

## 9. Interim workaround

`--top 150` (or `--min-gpd 300000`) on a scan where the mid band is wanted. Costs extra fetches; fine for
an occasional deliberate look, not for the default loop. Note that per §3 the `--top` bump is the part
doing the work — the `--min-gpd` lowering is treating a symptom that §3.1 shows is not the cause.
