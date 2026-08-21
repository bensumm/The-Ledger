# PLAN-PATIENT-PAIR — stop deleting a row because ONE of its two estimates says no

Status: PP0 + PP-R in flight. PP2 next. PP1 DEFERRED (see §6). Owner: this session.
Hardened by an adversarial review pass; **§1 was rewritten after that pass refuted the original
causal story.** Read §1 before proposing anything — the obvious diagnosis was wrong.

Anchor incident: `Webweaver bow (u)` (id 27652) — a real 3-unit trade someone banked ~1.4m on
overnight 08-19→08-20. Our tool quoted the item all day and graded it **A-**, while printing
`Est. sell 15.30m (reach-fold floored to BE 15.42m — nothing to price above break-even)` →
**net −114.7k/u**. Two lines below, on the same row, `◆ asym fill` read
`deep-bid 14.57m → ask 15.30m · net 427k/u`. At the 3 units the sizer called clean
(`tranche ~3 clean`) that is ~1.28m of the ~1.4m realised.

## 1. What actually went wrong — CORRECTED

The first draft of this plan asserted that `spec.admitMinNet` dropped the row. **That is false and
was refuted three ways:**

1. `watchlist.json` contains `Webweaver bow (u)`, and the gate at
   `pipeline/commands/screen-flip-niches.mjs:1455` reads `!WATCHLIST_IDS.has(s.id)` — **watchlisted
   items are EXEMPT from `belowAdmitNet`.** The row cannot have been dropped there.
2. `git log -S admitMinNet` puts the gate's ship date at **2026-08-19 01:46**, i.e. after most of
   the historical evidence the first draft cited. Those rows were *displayed*, not dropped.
3. Across five scans in the incident window the item logged a watchlist/digest row every pass and
   **zero band rows**, while its opt-pair net was positive throughout — so the Step-2 `er.net <= 0`
   drop did not kill it either.

It died earlier, at the **fetch-pool slice**. `rankAndSlice` (`pipeline/lib/signal/gatecandidates.mjs`)
ranks the band pool by `expGpDay × softFactor` and slices top-N with reserves for **held, thin and
rising only**. The `watchReserve` exists solely inside the `gate === 'amplitude'` branch, which
returns early. A watched-but-not-held big-ticket with a small buy limit ranks low on `expGpDay` and
silently falls out of the pool.

Which makes the comment at `screen-flip-niches.mjs:1452` — *"gateCandidates gives them a reserved
slot … so they always surface here"* — **false for watchlist items in band mode**. That is a live
doc-drift bug and it is the actual defect.

**Method note, worth more than the finding:** the refuting test was one grep of `watchlist.json`,
and the first draft shipped a confident causal claim without running it. Same failure shape as the
sizer relabel the day before. Name the refuting test before stating a cause.

## 2. What the measurements rule OUT — do not re-propose these

All figures recomputed independently over `suggestions.jsonl` (append-only, 21,928 rows; NOT
`latest.json`, which is rewritten live and drifts mid-session) using the repo's own `netMargin`.

**2a. Do NOT gate on `max(shownNet, asymNet)`.** Of 8,300 rows carrying both estimates, 671 have a
shown net ≤ 0; **656 of those (97.8%)** have a positive asym net. That is a repeal, not a filter.

**2b. Do NOT build a ranking objective on `pAsk`/`pBid` — they are quantile constants read back.**
`js/windowread.mjs` `asymPair` computes `pAsk = reachedDays(stats.his, quantHigh(stats.his, 0.8)) /
stats.his.length` — **same array, same window**. `quantLow`/`quantHigh` are order statistics whose
own header states the identity. Measured: `pAsk` = 0.86 on **89.9%** of rows (8 distinct values);
`pBid` = 0.29 on **86.5%** (13 distinct). Those are 12/14 and 4/14 — pure 14-day rank
discretization. So `asymRank = net × pAsk ÷ TTF` is `net ÷ TTF × 0.86`: the probability term orders
nothing, and "printed 12/14d" on the display is near-tautological. Verified at mechanism level, not
by correlation; there is no partial rescue.

**2c. Do NOT gate on asym amplitude.** After-tax 25→80 amplitude over 644 items: p10 3.14%,
median ~11.6%, p75 ~29.5%; **≥3% on 90.8% of items.** A wide quantile spread beats a 2% tax on
nearly anything with a daily range.

**2d. A THIRD caveat, found during hardening and not in the first draft: the ask ordering guard
binds on 69.7% of rows** (1,380/1,979 carrying `pAskAt`). On those rows `asym.ask` has been raised
to `quickSell` while `pAsk` was measured at the *lower* unguarded level — so the printed price is
not the price the probability refers to. Any surface showing the patient pair must route through
`formatAsymFill` (`pipeline/lib/render/emit.mjs`), already the ONE home for exactly this
price-vs-level honesty, and must not invent inline wording.

**Conclusion those force:** no profitability gate discriminates, and the asym branch does not
identify the anchor as special. What made it worth ~467k/unit is that it is a **15m** item — 2.9%
of 15m clears the attention floor on a *single unit*. The discriminator is ABSOLUTE gp per unit at
big-ticket size, not a percentage and not a probability. (A reviewer searched for a better
discriminator and did not find one; ROI measured non-discriminating, and `net × tranche ÷
cycle-days` is dimensionally right but rests on the depth/TTF models `join-depth-outcomes.mjs`
already measured as not beating null.)

## 3. Chunks

### PP0 — log `asym` on skipped rows  *(in flight)*
The skip site logs only `estBuy`/`estSell`/`estConfidence`; **all 44 `admitSkip` rows carry
`asym: null`** while surviving rows log `asymShadow(r.asymEr)`. The comment above that site promises
these drops are kept because they are "exactly the sample" the forward gate needs — and the one
field that sample needs is missing. Add `asymEr` to the `skippedRows` push and the shadow to the
entry. Logging completeness only: same rows dropped, same footer, same behaviour.

### PP-R — band-mode watchlist reserve  *(in flight)*
Mirror the existing held/thin/rising reserve shapes so a watched candidate outside top-N still gets
a fetch slot, and make the false comment at 1452 true rather than deleting it.

**The reserve MUST be bounded and the bound measured.** Do not copy amplitude's unbounded reserve:
its own comment justifies being unbounded because "watchlist.json is a small, user-curated set",
but the watchlist now holds **60 entries** against `TOP_DEFAULT = 40`. An unbounded reserve could
prepend more items than the pool it reserves into. The true cost is not 60 — it is the count of
watchlist items that reach `cand` (i.e. already passed Stage-1) and fall outside top-N. Size the
bound from that measurement. `AMP_TOP_DEFAULT` is also 40, so **amplitude's own reserve may already
be mis-sized** — flag, do not silently fold in.

### PP2 — both pairs in the BE-floored cell  *(next)*
`js/estimators/cells.mjs` already branches on `c.beFloored`, already has the amber class and already
names the bound floor. Extend that ONE branch to carry the patient alternative inline.

Scope facts established during hardening:
- **`extra.asym` is ALREADY passed into `estimatePair`** — but the documented contract consumes only
  `{ highReachAsk }`, and the return bundle carries no asym at all. PP2 must add a display-only
  `patient` block to the return.
- **This does NOT overturn rev3.** `pair.mjs` forbids folding the deep bid into `estBuy` because "a
  deep flush bid is rest-and-see OPTIONALITY, never inside an expected-price number." A render-only
  block is not an expected-price number. Say so explicitly in the code, or a future reader will
  read this as rev3 being reversed.
- **`APP_VERSION` bump REQUIRED.** `js/main.js` → `js/market.js` → `js/estimators.mjs`, which does
  `export * from './estimators/cells.mjs'`. The deployed app loads it. (The first draft claimed no
  bump; that was wrong. `js/flip-niches.mjs` genuinely has no app importer — PP1 is exempt.)
- Reaches scan + quote + positions from one edit, because all three render from this one builder.
  That matters: a held lot's quote shows the same misleading BE-floored cell today.
- Every non-`beFloored` branch must stay **byte-identical** — hold the same line the AC5/AC6
  comments hold for `foldExempt`.
- Wording must satisfy §2d and must not let +427k/u read as achievable: it is a level proposal on a
  bid that fills ~4/14 days, carrying a tautological probability.
- **BLOCKER on the obvious implementation — `cells.mjs` CANNOT import `formatAsymFill`.** The
  hardening pass recommended routing the clause through `formatAsymFill`, which is correct on
  honesty grounds and impossible as written: that function lives in `pipeline/lib/render/emit.mjs`,
  and **there are ZERO `js/` → `pipeline/` imports in the repo.** The browser loads `js/` only;
  `pipeline/` is not served, so such an import is a runtime 404 in the deployed app (the `smoke`
  job's exact failure class). Resolution: **move `formatAsymFill` into `js/windowread.mjs`** and
  re-export it from `emit.mjs` for the existing pipeline callers. That is where its siblings already
  live — `formatAvgBound`, `formatFloorCeiling` and `formatSoftBuy` are all in `js/windowread.mjs`
  with the same injected-`fmt` signature, so `formatAsymFill` is the odd one out and the move
  corrects existing drift rather than inventing a new home. This makes PP2 a module move plus a
  render change, not a one-branch edit — scope accordingly.
- **No caller changes needed for the data.** `extra.asym` already receives the full `asymPair`
  output (`asymRead` at screen `:1331`, `ap` at quote `:555`); the contract comment naming
  `{ highReachAsk }` documents only what is currently CONSUMED, not what is passed. Note the passed
  object is the UNGUARDED pair, so it is self-consistent with `pAsk` — the guarded prices come from
  `asymEstimate`, which is where §2d's mismatch arises. Decide deliberately which one renders.

### PP1 — named patient section  *(DEFERRED, see §6)*

## 4. Why this is safe on n≈0

Per `gate-on-error-cost-not-n`: every one of these is additive VISIBILITY over rows already being
computed. Nothing auto-applies, nothing is priced off it, no offer is placed by the tool — Ben
places every offer. The failure mode being replaced (a silent delete, a silent pool eviction) is the
one that cannot be checked at all. PP2's error mode is "a resting bid that does not fill", which
costs opportunity, not money.

## 5. Settled details (do not re-litigate)

- **The asym object IS in scope** at the `belowAdmitNet` gate site — same loop iteration. No
  threading needed beyond adding it to the `skippedRows` push.
- **`beFloored` does fire** on the anchor row (`beFloored: true` on the logged rows; `estSell < be`
  in `pair.mjs`). The predicate is sound; the row simply never reached the gate.
- **Do NOT reuse `MIN_GPD`** for a per-unit floor. It is gp/**day** (throughput attention) in
  `gatecandidates.mjs`; a per-unit floor is gp/**unit** (single-fill materiality) — different
  quantities that merely coincide at 250k. It was retuned once already (500k→250k) for unrelated
  reasons, and `lint-docs.mjs`'s constant-drift check pins docs to SCREAMING_SNAKE values by name,
  so two meanings under one name is precisely the class it cannot police. Use a new named constant.
- **Floor shape, if PP1 revives:** absolute gp/unit AND a nominal ROI leg (~1%). Among the 656
  rescued rows the distribution is bimodal — median **158 gp/unit**, p90 1.27m. At a 250k/u floor,
  134 rows / 34 items, all 3m–100m, minimum ROI 1.13%, zero qualifiers under 1%. So the ROI leg is a
  visible no-op today; it exists to cap a region that is *unpopulated, not tested* (the sample's
  largest bid is ~100m, so "a 200m item on a 0.13% move" never occurs here). Both are placeholders.

## 6. Sequencing decision (owner call)

**PP2 ships next; PP1 waits until PP-R has run for several days.** PP-R and PP1 fix different
populations — PP-R recovers watchlisted items already flagged, PP1 recovers non-watchlisted items
the gate drops. PP1's realistic yield measured at roughly **one row every few days**, and the
absolute floor is doing all the discriminating work on a placeholder value. Building the section
before seeing what PP-R alone recovers means sizing that floor against a population nobody has
characterised. Cheap to revisit; expensive to un-ship a cluttered section.

## 7. The measurement this all points at — SCHEDULED, not deferred indefinitely

`join-asym-outcomes.mjs`, in the mould of the existing `join-reach-basis.mjs` /
`join-depth-outcomes.mjs`: given the deep bid was **actually touched** on day D, was the high ask
reached within H hours? That yields a real `pAsk` and a real `pBid`, replacing the read-back
constants (§2b) and making the two estimates comparable on a common footing for the first time.
**PP0 is its sample feed** — without it the dropped rows carry no asym at all.

It is also the test of the anchor itself: DT1 (2026-08-09) measured completion-within-24h given
entry at **4.8%** over 92 items and 4,881 item-days, which is what sank the amplitude lane's daily
premise. The Webweaver move was overnight. Either DT1 does not generalise to the big-ticket
wide-band class, or the anchor was a good OUTCOME from a bad-odds setup. **Nobody currently knows
which, and every surface in this plan displays a number that assumes the favourable answer.** That
uncertainty belongs in the rendered section header text, not only in this file.

Run it after PP-R lands. It gates nothing, the archive already exists, and it is the only thing here
that produces evidence rather than visibility.

## 8. Doc pass (rule 8 — reconciliation, not append)

`README.md` (`screen-flip-niches.mjs`, `gatecandidates`, `cells.mjs` entries), `docs/MARKET-ANALYSIS.md`
(the gate stack), `.claude/skills/scan/SKILL.md` and `.claude/skills/positions/SKILL.md` — **both
relay the `◆ asym fill` note and both must state plainly that `pAsk`/`pBid` are quantile constants
and that the guard binds on ~70% of rows.** That is currently mis-relayable and was in fact
mis-relayed in session. `CHANGELOG.md` per chunk. Grep for superseded statements; do not merely
append.
