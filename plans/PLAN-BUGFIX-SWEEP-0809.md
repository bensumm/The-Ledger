# PLAN-BUGFIX-SWEEP-0809 — adversarial verification of Lane D's four claimed bugs

Status: **INVESTIGATION COMPLETE, NOTHING APPLIED.** Every finding below was reproduced (or
refuted) with a runnable script before being written down. No source, test, or doc file was
edited — this document proposes diffs in prose only.

Origin: `plans/PLAN-BID-DEPTH-5PCT.md` appendix, Lane **D** ("Four verified bugs"). The lane's
own summary line is **partly wrong on two of the four** — corrections are marked ⚠ below.

Repro scripts (throwaway, outside the repo): `C:\Users\benls\.claude\jobs\950fdd1e\tmp\`
— `repro1-hourly.mjs`, `repro2-window.mjs`, `repro3-phantom.mjs`, `repro4b-pinsweep.mjs`.

---

## Ranking by real user impact

| # | Bug | Verdict | Impact | Changes a printed number? |
| --- | --- | --- | --- | --- |
| **1** | Bug 1 — hourly Δ/d on 2-point slopes | **CONFIRMED** | **HIGH** — live on every quote / positions / scan-digest / schedule surface; states a confidently-wrong *direction* that inverts when the window widens | **YES** (that is the point) |
| **2** | Bug 3 — no phantom-offer clear | **PARTIAL** ⚠ | **MEDIUM** — real gap, but the harm is the *opposite sign* to the one claimed, and it is conservative (under-deploys, never over-deploys) | Yes, for the affected item only |
| **3** | Bug 4 — bare-literal test pins | **CONFIRMED (wrong lines)** ⚠ | **LOW** — maintainer-facing only; zero user impact; ~10-minute fix | No |
| **4** | Bug 2 — `windowHours >= 24` wraps | **REFUTED as a live bug / CONFIRMED as a latent trap** | **NONE today** — no caller passes > 24, and it is *already documented* in `plans/PLAN-REACH-HORIZON.md` | No (must not) |

---

## Bug 1 — the per-hour Δ/d column reads a single swing as a diurnal trend

> **SUPERSEDED 2026-08-09 by PLAN-DIURNAL-TRIAGE DT3 — the column was DELETED, not widened.**
> This diagnosis was right and is now part of the evidence: the n=2 two-point "slope" documented
> below is *why* the read never worked. But the recommended fix (widen the default to 7 days,
> single-source it, print `n`) is superseded — out-of-sample measurement showed no window length
> crosses into usefulness (days=4/7/14 all lose to predict-no-change; the apparent gain at 7/14 is
> convergence to the baseline), and direction was 49.7% at the shipped config. So `hourlyDrift`, the
> `Δ/d` column, `hourlyDriftNote`, `THIN_DRIFT_DAYS`, and the digest relabel were all removed; the
> ask-reach-decay sub-signal was extracted as `askReachDecay`. Full record: the tombstone in
> `pipeline/lib/market/hourly-lmh.mjs` + CHANGELOG "DT3". **Bugs 2–4 below are untouched by this.**

### Verdict: **CONFIRMED.** Every sub-claim holds, and the effect is larger than claimed.

### Where it lives

- `pipeline/lib/market/hourly-lmh.mjs` — `hourlyDrift(series1h, { days = 3, ask })`.
  - `leastSquaresSlope(ys)` (`:119-127`) — returns `null` on `< 2` points.
  - The only guard is `if (mids.length < 2) { hours.push(null); continue; }` (`:184`).
    **There is no minimum-n guard beyond 2, and `n` is never carried out of the function.**
  - `splitDescription(hours)` (`:136-143`) renders the "mornings X/d, evenings Y/d" phrase off the
    AM/PM *medians* of those per-hour slopes.
- `pipeline/commands/read-window-range.mjs:356-374` — the `--hourly` grid's `Δ/d (Nd)` column.
  `driftCell` (`:357-363`) prints arrow + gp only; **no `n`, no confidence qualifier**. The footer
  says "INFORM-ONLY, n≈0 — never gates", which speaks to *calibration*, not to *this hour's sample size*.
- `js/windowread.mjs:591-612` — `hourlyDriftNote`, the shared summary renderer.

### Reproduction (live wiki 1h series, 2026-08-09 ~03:00 local)

`repro1-hourly.mjs` fetches the real 1h `/timeseries` for **Imbued heart (20724)** and
**Saturated heart (27641)** and counts the datapoints behind each hour's slope.

**Datapoint count per hour bucket, `--days 3` — both items:**

```
n-histogram = {"2": 21, "3": 3}     ← 21 of 24 hours have exactly TWO points
```

Only hours 00–02 have three (today's partial date had only reached 02:00). At `--days 7` the
histogram is `{"6": 21, "7": 3}`; at `--days 14`, `{"13": 21, "14": 3}`. So the claim
"with `--days 3` most hour buckets have only TWO datapoints" is **exactly right — 87.5% of them.**
With `n = 2` the least-squares fit reduces algebraically to `y₁ − y₀`: the column labelled
"least-squares slope" is literally a two-sample difference.

**The artifact, Saturated heart (27641), `--days 3` (dates 08-07, 08-08, 08-09):**

```
hour  n   Δ/d              hour  n   Δ/d
 03   2   +4,978,157 up     19   2   −3,366,606 down
 04   2   +4,185,366 up     20   2   −4,207,580 down
 05   2   +4,285,979 up     21   2   −5,433,495 down
 06   2   +3,454,102 up     22   2   −4,780,283 down
 07   2   +2,291,019 up     23   2   −5,064,686 down
dominant: mornings +1,281,129/d, evenings −3,366,606/d
```

That is a **±10m/day apparent time-of-day pattern on a ~75m item.** The evening figure matches the
lane's reported −3.37m/d to the gp. (The morning figure differs from the lane's +2.29m/d only because
the AM median shifts as today's partial date accumulates hours — same artifact, sampled hours apart.)

**The same item, same series, wider window — the artifact vanishes and the morning sign FLIPS:**

```
--days 3   dominant: {dir:'down', magPerDay:  −840,701, uniform:false, split:'mornings +1,281,129/d, evenings −3,366,606/d'}
--days 7   dominant: {dir:'flat', magPerDay:  −193,682, uniform:false, split:'mornings   −460,641/d, evenings   −89,469/d'}
--days 14  dominant: {dir:'down', magPerDay:  −365,963, uniform:true,  split: null}
```

Imbued heart (20724) behaves identically: `--days 3` gives `+4.3m/d` in the 03–08 hours and
`−6.3m/d` at 21:00, `uniform:true down ~−1.34m/d`; `--days 7` collapses it to
`−315k/d`, `--days 14` to `−427k/d`, both an order of magnitude smaller.

**Diagnosis.** With `n = 2` at `--days 3`, the two samples for hours 03–23 are 08-07 and 08-08 —
which straddle the single ~08-08 01:00 peak. Morning hours sampled the rising leg on 08-08;
evening hours sampled the falling leg. The "diurnal pattern" is a picture of *where in one 1.5-day
swing each hour happened to land*, presented as a repeating time-of-day structure.

### Blast radius — this is not confined to `read-window-range --hourly`

`days: 3` is **hard-coded at four production call sites**, not just the CLI diagnostic:

| Call site | Surface |
| --- | --- |
| `pipeline/commands/quote-items.mjs:503` | every bare quote |
| `pipeline/commands/quote-items.mjs:869` | every held/watched position line |
| `pipeline/commands/screen-flip-niches.mjs:990` | the top-X scan digest enrichment (HT3) |
| `pipeline/commands/read-schedule.mjs:281` | the `/schedule` agenda's per-item drift note |
| `pipeline/commands/read-window-range.mjs:132` | `HOURLY_DAYS`, `--days` default 3 |

`pipeline/lib/render/render.mjs:107` gives it a `TIER.context` sigil (`↕`), so it prints on the standard
note stack. `hourly-lmh.mjs:112` notes that "the one place a drift number moves a displayed LABEL is
the caller's job (screen-flip-niches.mjs HT3)" — so the artifact can also relabel a digest verdict.

### The repo already has the counter-precedent

`js/reverseflip.mjs:193-195`:

```js
// The drift window (days) a THIN item defaults to — 7d, not the standard 3d, because a thin book's 3-day
// slope whipsaws (Ruling §6). The label (hourlyDriftNote) already tells the window truth. PLACEHOLDER.
export const THIN_DRIFT_DAYS = 7;
```

The whipsaw was already diagnosed — but the remedy was scoped to *thin* items only. The evidence
above shows a 75m, liquid, big-ticket item whipsawing the same way, because the driver is **n = 2**,
not thinness.

### Recommended fix — widen the default to 7 days, single-source it, and print `n`

Weighed and rejected:

- **Minimum-n guard alone (require ≥ 3).** At `--days 3` this blanks 21 of 24 hours and computes
  `dominant` off three adjacent night hours. It forces the widening anyway, and does so by silently
  gutting the read instead of fixing it. Reject as a standalone.
- **Suppress on within-hour single-swing dominance.** Cannot be measured from `n = 2` — you need
  ≥ 3 points to say a series is swing-dominated. Reject: it is the widening in disguise, with
  a new placeholder threshold attached.
- **"Label it inform-only more loudly."** It *already* says `INFORM-ONLY, n≈0 — never gates`, and
  the artifact still shipped a directional claim to four surfaces. A louder disclaimer on a number
  that is wrong is not a fix. Reject.
- **Widen the default days.** The only option that removes the artifact at the source, and it has
  in-repo precedent (`THIN_DRIFT_DAYS = 7`, Ruling §6).

**Proposed diff, in prose:**

1. **`pipeline/lib/market/hourly-lmh.mjs`** — add an exported
   `export const HOURLY_DRIFT_DAYS = 7;` beside the existing `HOURLY_DRIFT_*` placeholders, with a
   comment recording *this* evidence (n = 2 at 3 days on 21/24 hours; the 27641 morning-sign flip).
   Change `hourlyDrift`'s signature default from `{ days = 3 }` to `{ days = HOURLY_DRIFT_DAYS }`.
   Retire `js/reverseflip.mjs`'s `THIN_DRIFT_DAYS = 7` as a duplicate of the same number — or keep
   it and re-export from the new constant so there is one owner (my preference: make
   `THIN_DRIFT_DAYS` an alias with a comment that the thin case is no longer special).

2. **Carry `n` out of the computation.** In `hourlyDrift`, add `n: mids.length` to each
   `perHour` entry, and add `minN` / `medianN` to `dominant`. Purely additive — no existing field
   changes shape.

3. **`js/windowread.mjs:591`** — change `hourlyDriftNote`'s `days = 3` default to import the same
   `HOURLY_DRIFT_DAYS`. **This is load-bearing:** `quote-items.mjs:504`, `:870`,
   `screen-flip-niches.mjs:991` and `read-schedule.mjs:281` all call `hourlyDriftNote` **without**
   `days`. If the compute default moves to 7 and the renderer's stays at 3, every one of those four
   surfaces will print the literal string **"3-day hourly drift:"** over a 7-day window — a silent
   lie, worse than the bug. Additionally: append a low-sample qualifier when
   `dominant.minN < 3`, e.g. `… (n=2/hour — two-point slope, treat as a snapshot not a trend)`.

4. **`pipeline/commands/read-window-range.mjs:132`** — `HOURLY_DAYS` default 3 → `HOURLY_DRIFT_DAYS`.
   In `driftCell` (`:357`), render `n` when it is below 3: `↓ −5.0m/d (n=2)`. Update the footer at
   `:370` from "N-day per-hour least-squares slope" to name the per-hour sample too.

5. **The four hard-coded `days: 3` call sites** — replace the literal with `HOURLY_DRIFT_DAYS`
   at `quote-items.mjs:503`, `:869`, `screen-flip-niches.mjs:990`, `read-schedule.mjs:281`.

**Does it change a currently-printed number?** **Yes — deliberately, on every drift note.**
Magnitudes shrink ~5–10× and some directions invert (that is the fix). Per
`[[gate-on-error-cost-not-n]]` this is a *visible* swap, not a silent one: the note's own label
already states the window (`"7-day hourly drift: …"`), so the change announces itself the first
time Ben reads a quote. No gate, rank, price, or verdict changes — with one caveat to verify at
apply time: `screen-flip-niches.mjs` HT3 may relabel a **displayed** digest verdict off
`drift.dominant`, so digest verdict *words* can move. That is the correct direction (fewer
false "step-down" labels), but re-run the scan digest before/after and diff the verdict column.

**Do NOT bump `APP_VERSION`** — this is pipeline stdout only, no `js/` app-surface change beyond
`windowread.mjs`'s note text. `js/windowread.mjs` *is* imported by the app; check whether
`hourlyDriftNote` reaches a rendered app surface before deciding. Tests to update:
`pipeline/test/windowread.test.mjs:1216, :1224` pin the exact note strings incl. `"3-day hourly drift:"`.

---

## Bug 2 — `windowHours >= 24` silently wraps mod 24

### Verdict: **REFUTED as a live bug. CONFIRMED as a latent trap — and already documented.**

### The wrap is real

`js/validate.mjs:124`:

```js
const wStart = now.getHours(), wEnd = (wStart + windowHours) % 24;
```

`js/windowread.mjs:24`:

```js
export const inWindow = (h, wStart, wEnd) =>
  wStart < wEnd ? (h >= wStart && h < wEnd) : (h >= wStart || h < wEnd);
```

`repro2-window.mjs`, `wStart = 10`:

```
windowHours  8 -> wEnd 18 ·  8 of 24 hours
windowHours 23 -> wEnd  9 · 23 of 24 hours
windowHours 24 -> wEnd 10 · 24 of 24 hours   ← full day, CORRECT and intended
windowHours 25 -> wEnd 11 ·  1 of 24 hours   ← silent collapse
windowHours 26 -> wEnd 12 ·  2 of 24 hours   ← the claimed 2-hour window
windowHours 36 -> wEnd 22 · 12 of 24 hours
windowHours 48 -> wEnd 10 · 24 of 24 hours   ← indistinguishable from 24
```

End-to-end through `reachValidator` on a synthetic 14-night series whose ask is reachable only in
local hours 12–14, with `now = 10:00`:

```
windowHours (default 8) -> pass    · ask 1050 reached 14/14d
windowHours          24 -> pass    · ask 1050 reached 14/14d
windowHours          25 -> reject  · ask 1050 reached only 0/14d   ← a REJECT verdict, silently
windowHours          26 -> reject  · ask 1050 reached only 0/14d
windowHours          48 -> pass    · ask 1050 reached 14/14d
```

So `26` does not merely mis-scope — at gate mode it flips `pass` → **`reject`**, dropping the row.
No error, no warning, and `evidence.windowHours` faithfully reports `26` beside a `wStart 10 / wEnd 12`
that contradicts it.

### But no caller passes >= 24 — this is latent

Exhaustive grep of `js/` + `pipeline/` for `windowHours`: the **only** values supplied anywhere are
`24` (`js/flip-niches.mjs:311` value, `:366` amplitude; `pipeline/test/validate.test.mjs:293`) and the
`REACH_WINDOW_HOURS = 8` default. `24` is the documented "full day" idiom and behaves correctly.

Validator specs come **only from the `FLIP_NICHES` code literal** — `runValidators` is called with
`specs` sourced from `FLIP_NICHES` in `quote-items.mjs:354/702` and
`screen-flip-niches.mjs:1189/1233`. No JSON file, CLI flag, or `hold-thesis.json` path can inject a
`window`. `validateNicheSpec`'s `validatorEntryError` (`js/flip-niches.mjs:473-477`) only type-checks
`typeof windowHours === 'number'`, so a future `48` would pass conformance — but that is a *test-only*
checker, and today nothing supplies one.

### It is already a known finding

`plans/PLAN-REACH-HORIZON.md:65-72` already says, verbatim:

> **The seam cannot express any horizon > 24h.** `reachValidator` computes
> `wEnd = (wStart + windowHours) % 24` (`js/validate.mjs:124`) … `windowHours: 48` wraps mod 24 and
> silently produces the same full-day read.

So this is not a new discovery; the honest framing is **"the known limit has no guardrail."**

### Recommended fix — reject loudly, do not generalise

Weighed: *generalising to multi-day spans* would require reworking `windowStats`'s day-keying
(`js/windowread.mjs:17-25` `dayKey`/`inWindow`), which buckets strictly *within* a clock day.
PLAN-REACH-HORIZON already concluded a real multi-day horizon needs archive replay, not this seam.
Building it speculatively is exactly the machinery that plan declined.

**Proposed diff, in prose — `js/validate.mjs`, in `reachValidator` immediately after line 123:**

```
if (!(windowHours > 0 && windowHours <= 24))
  return degrade(key, `unsupported-window-${windowHours}h`);
```

Use the existing `degrade()` helper (`:63`) so the failure mode is a **pass with a named
evidence note**, matching the module's stated "DEGRADES to pass (never rejects on absence)"
contract — never a silent 2-hour read, never a spurious reject. Also:

- Extend `validateNicheSpec`'s `validatorEntryError` (`js/flip-niches.mjs:475`) from a bare
  `typeof === 'number'` check to `windowHours > 0 && <= 24`, so the CI conformance test catches a
  bad spec at build time rather than at read time.
- Amend the `⚠ WINDOW SCOPE` header block at `js/validate.mjs:93-102` to state the 24h ceiling and
  point at `plans/PLAN-REACH-HORIZON.md` for why a longer horizon needs archive replay.

**Does it change a currently-printed number?** **No — and it must not.** Verified: the only live
values are `8` and `24`, both `<= 24`, both untouched by the guard. Acceptance check at apply time:
run `pipeline/test/validate.test.mjs` (its `windowHours: 24` case at `:293` must still pass) and
diff a `screen --mode all --no-publish` board before/after; it must be byte-identical.

---

## Bug 3 — no way to clear a phantom offer after a mobile cancel

### Verdict: **PARTIAL.** The gap is real. ⚠ **The stated harm is backwards.**

### ⚠ Correction 1 — a phantom bid DEFLATES the deployable figure; it never inflates it

The lane claims a phantom resting bid "INFLATES the deployable capital figure". `repro3-phantom.mjs`
builds a slot-3 phantom BUY (10 @ 1,000,000 = 10m escrow, 0 filled) against a 50m anchor and runs
`deriveCash` with and without it:

```
DEEP-classified        available 40,000,000 (truth 50,000,000)  deployable 50,000,000 (truth 50,000,000)  -> error       0 gp (EXACT)
COMMITTED-classified   available 40,000,000 (truth 50,000,000)  deployable 40,000,000 (truth 50,000,000)  -> error −10,000,000 gp (DEFLATED)
no marketRef           available 40,000,000 (truth 50,000,000)  deployable 40,000,000 (truth 50,000,000)  -> error −10,000,000 gp (DEFLATED)
```

The arithmetic, from `pipeline/lib/capital/derive-cash-tiers.mjs:155,165`:

```
availableCash  = liquidCapital − reserved          ← phantom ADDS to reserved  ⇒ availableCash falls
deployablePool = availableCash + reservedDeep      ← if the phantom is DEEP the two errors CANCEL exactly
```

So the error is **zero when the phantom classifies DEEP, and −(escrow) when it classifies COMMITTED
or when no `marketRef` is available.** `availableCash` is always understated by the full escrow.
**The tool under-reports capital, it never over-reports it.** Harm is missed deployment and a
`run-loop` scan-gate that stays shut (`deployablePool >= --min-idle` fails), plus a `/book` slot
board showing `slot 3: BUY …` for an offer that no longer exists and a free-slot count one too low
(`read-book.mjs:167`). Not a sizing-into-nothing risk.

### ⚠ Correction 2 — `suspectBidNote` covers the OPPOSITE failure, and does not cover this one

Verified in the same repro: with the phantom present,
`restartBlindSuspects(rows).length === 0` and `suspectBidEscrow(rows) === { n: 0, gp: 0 }` — **no
flag fires.**

That is correct behaviour, not a miss in the flag. Read `pipeline/lib/reconstruct/offers.mjs:174-181`:
`suspectBidEscrow` covers a bid that is **still resting in-game but has dropped OUT of `offers.json`**
(restart-blindness → the slot reads `EMPTY` → its escrow is never subtracted → deployable *inflated*).
The mobile-cancel phantom is the mirror image: **gone in-game, still IN `offers.json`** → escrow
subtracted twice over → deployable *deflated*. They are two different directions of the same axis,
and only one has a surfaced flag today.

`restartBlindSuspects` is structurally incapable of seeing the phantom: it requires the slot's
current state to be `EMPTY` (`offers.mjs:162`). A phantom's current state is `BUYING`.

### Is there already a mechanism? No — checked, and here is exactly why

`add-manual-fill.mjs --remove <eventId>` **does not apply.** It writes
`{"state":"REMOVE","target":"<id>"}`, which tombstones a **fill event** out of the merged
`fills.json` set (`sync-fills.mjs:231-233`). `offers.json` is built on a completely different path:
`sync-fills.mjs:281-282` → `readOfferRows(logDir)` → `offersSnapshot(rows)` → `activeOffers(rows)`,
which is "latest log line per slot; `BUYING`/`SELLING` ⇒ open" (`offers.mjs:115-129`). A `REMOVE`
line has no `slot` and no `BUYING`/`SELLING` state, so it never touches the offer view.

`add-manual-fill.mjs` also **cannot** be coaxed into writing a slot-clearing line:
`--type` is restricted to `buy|sell|withdraw|banked` (`:94`) and `--slot` is hard-floored at 8
(`:99`, "live slots 0-7 are reserved"). A phantom always lives on a live slot 0–7.

`derive-cash.mjs <amount>` **does not fix it either.** It re-anchors `cashGp0`, which feeds
`liquidCapital`; `availableCash = liquidCapital − reserved` then subtracts the phantom escrow
*again*. Re-anchoring to the true in-game stack leaves the deflation exactly as large as before.

**So this is a genuine missing capability, not missing documentation.** It is also
*already named* as the intended remedy by Ben's own ruling — the memory
`deployable-shown-correct-at-source.md` lists the source-level corrections as
"re-anchor `derive-cash.mjs <amount>` … **or a manual-log fix / phantom-bid clear (a 'reclaimable'
bid that's actually gone)**". The phantom-bid clear is doctrine; it just was never built.

### The thing that self-heals, and the thing that does not

The phantom **self-clears** the moment Ben reuses that slot on desktop — the logger emits a fresh
`BUYING`/`SELLING`/terminal line for it and `activeOffers`'s latest-per-slot rule replaces the ghost.
So the phantom only persists while the slot sits idle. That bounds the damage but does not remove it
(an idle-but-apparently-occupied slot is precisely the state `/book` and the scan gate care about).

### ⚠ Correction 3 — a naive manual-line fix is ORDERING-FRAGILE

`repro3-phantom.mjs` part (c): appending
`{"date":…,"time":…,"state":"CANCELLED_BUY","slot":3,"item":…,"qty":0,"max":10,"offer":1000000}`
to `coffer-manual.log` **does** clear the phantom (`offers: 0 → CLEARED`), and it does **not** raise
a false restart-suspect flag (`CANCELLED_BUY` is a genuine terminal, so `restartBlindSuspects`
correctly skips it). It also produces no spurious fill (`qty: 0`), and `validateSlotTransitions`
stays quiet because the preceding same-slot event is a non-terminal `BUYING`.

**But it is undone by the next RuneLite write.** Part (c2):

```
file order: coffer-manual.log -> exchange.log
slot-3 phantom back? YES — the manual cancel was UNDONE by file mtime order
```

`readOfferRows` sorts **files by mtime** and concatenates their lines (`offers.mjs:28-29`), and
`activeOffers` takes the **last row seen per slot** in that concatenated order, not the row with the
latest timestamp (`offers.mjs:117`). As soon as RuneLite touches `exchange.log` again — *for any
slot* — `exchange.log` becomes the newest file, its stale slot-3 `BUYING` line lands last, and the
ghost returns. This is invisible today only because `add-manual-fill.mjs` forbids slots 0–7, so no
manual line has ever competed with a live-slot line.

### Recommended fix — an explicit manual clear + a timestamp-ordered `activeOffers`

Shape chosen to respect the ruling: **explicit, human-initiated, corrects at the SOURCE (the log),
never modelled, never auto-detected, never silently adjusts a number.**

**Proposed diff, in prose:**

1. **`pipeline/lib/reconstruct/offers.mjs` — make `activeOffers` timestamp-ordered (the load-bearing
   half).** Replace the row-order `for (const r of rows) bySlot.set(r.slot, r)` at `:117` with a
   pass that keeps, per slot, the row with the greatest `Date.parse(r.date + 'T' + r.time)`,
   ignoring rows whose timestamp is not finite (a `REMOVE` tombstone has no date/time — the existing
   `NaN` handling at `:45-46` is the precedent). Add a header note: *the offer snapshot is ordered by
   the log's own wall-clock, not by file mtime, so a manual correction cannot be resurrected by the
   next plugin write.*
   **Verify this changes nothing today:** within one file, lines are appended in ts order; across
   rotated logs, mtime order already agrees with ts order; and no manual line currently targets slots
   0–7. Acceptance: rebuild `offers.json` with a bare `sync-fills.mjs` before and after and diff — it
   must be byte-identical apart from `generatedAt`.

2. **A new `--cancel` mode on `add-manual-fill.mjs`** (preferred over a new command — it is the same
   "inject the line the logger never saw" job the script already owns):
   `node pipeline/commands/add-manual-fill.mjs --cancel --slot <0-7> --item "<name>" --price <gp> [--qty <filled>] [--time <iso>]`
   writing `{"date","time","state":"CANCELLED_BUY"|"CANCELLED_SELL","slot","item","qty","max","offer","worth"}`.
   The side comes from the current `offers.json` row for that slot, so `--item`/`--price` can be
   *derived and echoed for confirmation* rather than typed. This branch must relax the `slot >= 8`
   floor **only for `--cancel`** (a cancel by definition names a live slot) and must keep the floor
   for every fill type. If the offer was partially filled, carry the filled `qty` through so the
   already-bought units stay booked.

3. **Prefer a guided `--clear-phantom <slot>`** that reads `offers.json`, prints the row it is about
   to cancel, and refuses when the slot has no resting offer — so Ben never hand-computes the fields.
   Same one-command ergonomics as `reconcile-reverse-flip.mjs`'s print-the-exact-command pattern.

4. **Surfacing (the other half of the ruling).** In `read-book.mjs`'s slot block, append a one-line
   footer whenever any resting offer's `lastUpdateTs` is older than ~24h:
   `(slot N resting since <local time> — if you cancelled it on mobile: add-manual-fill.mjs --clear-phantom N)`.
   Staleness is a *prompt to eyeball*, exactly like `suspectBidNote` — **inform-only, never subtracted.**

5. **Docs (process rule 8, reconciliation not append).** `pipeline/FILLS-PIPELINE.md` §10 owns the
   cancel semantics and the `REMOVE`-tombstone rule — add the phantom-offer case *there*, and state
   plainly that `--remove` is for **fill events in `fills.json`** while `--cancel`/`--clear-phantom` is
   for **resting offers in `offers.json`** (they are separate paths; §244-251's tombstone prose reads
   today as if it covers both). Add a CLAUDE.md ask→command row:
   *"I cancelled an offer on my phone", "clear a phantom bid", "my book shows an offer I don't have"*.
   `README.md` inventory: update `add-manual-fill.mjs`'s entry to name the new mode.

**Does it change a currently-printed number?** Yes — for the cleared item only, and only when Ben
explicitly runs the command. `availableCash` rises by the phantom escrow (toward truth),
`deployablePool` rises by it when the bid was COMMITTED-classified and is unchanged when DEEP,
the `/book` slot count frees one, and the phantom row disappears. Step 1 alone changes nothing.

---

## Bug 4 — bare-literal test pins in `capeff-digest.test.mjs`

### Verdict: **CONFIRMED — but the line numbers are wrong, and one cited line is not a pin at all.** ⚠

### What is actually at the cited lines

| Line | Content | Is it a pin? |
| --- | --- | --- |
| `:270` | `assert.ok(r.askPlacement > 0.85, \`placement above the MIRAGE_PLACEMENT bound (got ${r.askPlacement})\`)` | **YES** — bare `MIRAGE_PLACEMENT` |
| `:297` | `// mirage base: askPlacement > MIRAGE_PLACEMENT (0.85) AND REACH_GRADE_CAP_FRAC (0.5) ≤ reachFrac < MIRAGE_REACH_FRAC (0.70)` | **NO — a comment.** ⚠ Doc-drift risk only |
| `:219` | `assert.ok(r.reachFrac >= 0.5, 'non-stale reads ✓')` | **YES** — bare `REACH_GRADE_CAP_FRAC` (the lane missed this one) |
| `:226` | `assert.ok(r.reachFrac < 0.5, 'the honest read is ✗ (sell unreliable), not the stale ✓')` | **YES** — bare `REACH_GRADE_CAP_FRAC` |
| `:228` | `assert.ok(r.askPlacement > 0.5, …)` | **NO** — `0.5` here is a hand-picked "high in the distribution" sanity bound, not a constant |
| `:106` | `ok('rule 2 — placement > 0.85 AND 0.5 ≤ reach < 0.7 → "mirage top"', …)` | **NO** — a test *title*. Doc-drift risk only |

`pipeline/test/capeff-digest.test.mjs` imports (`:17-21`) `BIG_TICKET_GP`, `FLIP_NICHES`,
`deployUnits` — but **neither** `MIRAGE_PLACEMENT` (`js/estimators/families.mjs:93`) nor
`REACH_GRADE_CAP_FRAC` (`js/rating.mjs:160`), both of which are exported.

### Are these deliberate value-pins? No — read the intent

The counter-argument (a hardcoded expected number is sometimes *correct*) is real, and the repo has
a textbook example of it **in this very file**, at `:96`:

```js
assert.equal(BIG_TICKET_GP, 10_000_000);
assert.equal(weakDeploy(BAND, { mid: BIG_TICKET_GP }, er(3, 1000, 43200)), true);   // exactly at threshold
```

That is the correct shape: **import the constant, pin its value on a line of its own, then use the
symbol everywhere else.** The pin is explicit and self-documenting; a retune fails on the pin line
with an obvious message, and every downstream assertion keeps meaning what it says.

The three offenders do not have that shape. `:270`'s own failure message is
`"placement above the MIRAGE_PLACEMENT bound"` — the author's stated intent is *relative to the
bound*, and the `0.85` is a stand-in for the symbol they meant to use. `:219`/`:226`'s messages are
`"non-stale reads ✓"` / `"the honest read is ✗"`, i.e. *which side of the ✓/✗ split this lands on* —
and that split is documented as `REACH_GRADE_CAP_FRAC` in `docs/MARKET-ANALYSIS.md:259` and
`plans/PLAN-DIGEST-SIGNAL-AND-SCAN-PERF.md:89`. Boundary-relative intent, bare-literal expression.

**The rest of the repo agrees.** Every other test that touches these constants imports them:

```
pipeline/test/estimators.test.mjs:29    imports MIRAGE_PLACEMENT
pipeline/test/estimators.test.mjs:963   symmetricExemptionHolds(FLIP_NICHES.churn, MIRAGE_PLACEMENT)  // 'exactly AT the bound → holds (strict >)'
pipeline/test/estimators.test.mjs:977   estimateRank(…, { askPlacement: MIRAGE_PLACEMENT })
pipeline/test/rating.test.mjs:31        imports REACH_GRADE_CAP_FRAC
pipeline/test/rating.test.mjs:135       rateItem({ …, reachFrac: REACH_GRADE_CAP_FRAC - 0.1 })
```

`capeff-digest.test.mjs` is the sole outlier. Verdict: **genuine anti-pattern, not a value-pin.**

### The repo-wide sweep — attempted, and the honest result

I ran two automated sweeps (`repro4-pinsweep.mjs`, `repro4b-pinsweep.mjs`): extract every
`export const SHOUTY = <number>` from `js/` + `pipeline/lib/` (found ~400), then flag every
`assert.*` line in `pipeline/test/` containing a bare literal equal to one of them where the test
file does not import that constant.

**The sweep is not tractable and should not be built into CI.** It returned **2009** candidates
unfiltered and **744** after restricting to "distinctive" values. Essentially all are false
positives, for a structural reason: threshold constants cluster on a handful of values (`0`, `3`,
`4`, `6`, `14`, `0.25`, `0.5`, `0.15`, `0.03`, `1000`), and those same values appear constantly as
fixture data, quantile arguments, array lengths and loop bounds. `assert.equal(hourProfile(thin,
{ nights: 14, … }), null)` matches seven different `*_DAYS = 14` constants and is wrong about all
seven. A lint rule on this shape would be pure noise — it fails the `lint-docs.mjs` design bar
("must stay a denylist + structural checker") because there is no reliable structural signal.

**The tractable version is per-constant and manual.** Grepping the *specific* values named in the
claim (`0.85`, and `0.5` in a reach-✓/✗ context) found the three real hits above and nothing else in
the suite. That is the whole population.

### Recommended fix

**Proposed diff, in prose — `pipeline/test/capeff-digest.test.mjs`:**

1. Extend the import block at `:17-21`:
   `import { MIRAGE_PLACEMENT } from '../../js/estimators/families.mjs';`
   `import { REACH_GRADE_CAP_FRAC } from '../../js/rating.mjs';`
2. `:270` → `assert.ok(r.askPlacement > MIRAGE_PLACEMENT, \`placement above the MIRAGE_PLACEMENT bound (got ${r.askPlacement})\`);`
3. `:219` → `assert.ok(r.reachFrac >= REACH_GRADE_CAP_FRAC, 'non-stale reads ✓');`
4. `:226` → `assert.ok(r.reachFrac < REACH_GRADE_CAP_FRAC, 'the honest read is ✗ (sell unreliable), not the stale ✓');`
5. **Add the deliberate value-pins**, in the `:96` house style, near the top of §9:
   `assert.equal(MIRAGE_PLACEMENT, 0.85); assert.equal(REACH_GRADE_CAP_FRAC, 0.5);` —
   so a retune still fails *once, loudly, on the pin line*, while every downstream assertion tracks
   the constant. This keeps the legitimate value-pin benefit the counter-argument is about.
6. Leave `:228` alone (not a constant). Leave the fixture inputs at `:298`
   (`reachFrac: 0.6, askPlacement: 0.9`) alone — those are "inside/outside the band" test data;
   rewriting them in terms of the constants would obscure them.
7. Refresh the comment at `:297` and the test title at `:106` if the pinned values ever move — they
   are documentation, and the new pins at (5) make them cheap to keep honest.

**Does it change a currently-printed number?** **No.** Test-only; `0.85 === MIRAGE_PLACEMENT` and
`0.5 === REACH_GRADE_CAP_FRAC` today, so the suite's pass/fail behaviour is identical.

---

## Suggested landing order

`4 → 2 → 1 → 3`. Bug 4 is a self-contained test-file edit with zero behaviour change. Bug 2 is a
small guard that provably changes nothing today and closes a real trap before PLAN-REACH-HORIZON
touches the seam. Bug 1 is the real user-facing fix but changes printed numbers on five surfaces
and needs a before/after digest diff. Bug 3 is the largest (new CLI mode + an `activeOffers`
ordering change + doc reconciliation) and should land last, with step 1 (`activeOffers` ts-ordering,
provably a no-op) split into its own commit ahead of the new command.

**Inventory (process rule 8):** this file needs a `plans/` entry in `README.md`. Per
`docs/PLANNING.md`, fold it into `PLAN.md` and delete it once all four fixes ship — and mark Lane D
done in `plans/PLAN-BID-DEPTH-5PCT.md`'s appendix, correcting its summary line for bugs 2 and 3.
