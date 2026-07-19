# PLAN-ESTIMATOR-POSTURE — the reach-fold buy leg collapses patient band flips

Status: DRAFT (2026-07-18, Ben-directed via `/analyze`). Owner: next session.
Console/estimator-only, provisional. Folds into `PLAN.md` and is deleted the moment its last
chunk ships (per CLAUDE.md's plan-file rule). Direct continuation/**amendment** of
`PLAN-OUTPUT-TABLE.md` — read that first; this corrects one premise in it.

## Motive (Ben, 2026-07-18)

A full `/scan` read as "board dead, hold — nothing clean" when the patient band edge was solid
the whole time. Ben's challenge: *"if everything dies on the sell leg, could we just be misplacing
our buy leg?"* — verified YES. The default `Est. buy/sell` columns price a **fill-now** posture on
every row, and on a quiet-band day that collapses both legs to live and BE-floors real flips.

**The anchor incident (this session, verified via `--raw` + `read-window-range.mjs`):**
- **Abyssal bludgeon** — patient band flip 17.18m → 17.74m = **+209k (+1.2%)**. The folded `Est.`
  pair showed 17.50m → 17.86m = **+1 (BE-floored)**. The buy leg folded +320k up to near live
  (guide 17.53m) because the band-low bid's recent reach was low; the sell folded down; the spread
  vanished. The item was mis-read as dead.
- **Ancient godsword** — a genuine +640k patient flip (buy ~39.53m, list 40.99m, sell reaches
  recent 2/3, rising healthy reprice) **never surfaced in the folded top table at all** — only
  appeared under `--raw`.
- **Crimson kisten** (the counter-check) — the *sell* fold was CORRECT: the 43.6m band top reaches
  0/7 on the 5m grain, a real mirage. Realistic edge is ~+360k at the current spread, not the raw
  +751k. So the resolution is NOT "trust the raw band" — it is "separate the price from the
  fill-probability and show both."

## Root cause

`js/estimators/sell-models/reach-fold.mjs` — the `reach-fold` doctrine (band + churn) folds the BUY
leg toward the live instabuy by the band-low's recent touch-reach:

```js
const anchor = Math.round(qb - (qb - ob) * fold(bidR.frac));   // qb = live instabuy, ob = band low
```

- `fold=1` (band low touched ≥ `EST_REACH_SAT_FRAC`=0.75 of recent days) ⇒ buy = band low (deep). OK.
- `fold→0` (quiet band, recent 0/3) ⇒ buy = live instabuy. **The patient deep bid is discarded.**

The SELL leg folds down symmetrically (`fR = f0 + relief×(1−f0)`, `sCands = qs + (topRef−qs)×fR`).
On a quiet band both legs collapse to live → BE-floor binds → `estNet ≈ 0`.

**The premise conflict:** `PLAN-OUTPUT-TABLE.md` §"fold reach INTO the price, don't caveat beside
it" defines `estBuy` as *"the reach-realistic acquisition price, not the artifact band floor that
never fills."* That treats non-immediate fill as a mispriced buy. For the **band** niche —
doctrine "ladder BUYS at the band low, SELL at the band top" — non-immediate fill is the strategy.
Folding the PRICE on the buy leg encodes a fill-now posture the band niche never asked for.

## Evidence from the analyze engine (2026-07-18)

- `reach` is the #1 most-firing reject validator (**4,995 rows**); `inform`, not yet a `candidate`,
  because there is **no not-taken → would-have-filled counterfactual** logged. This is the data gap
  that must close before F1 can calibrate the fold.
- Band niche: 24,056 surfaced · 0% taken · 8 filled · +2.27m realized (n=23). Weeks-cold — no
  aggregate here clears n≥20. **Nothing below is a calibrated claim; every constant stays F1's.**

## The resolution — decouple PRICE from FILL-PROBABILITY (recommended)

The band-niche default price should be the **patient band edge**, with reach carried as a
**confidence annotation on the cell** (the sell side already does this: `43.65m (0/3 · 4/14)`).
Stop mutating the buy NUMBER toward live; annotate its fill-probability instead.

### AC1 — buy leg: band niche prices the band low, annotates reach (does NOT fold the price)
`entryDoctrine`/`reachFoldModel` for the band niche emits `estBuy = ob` (band low, diurnal-dip
blended as today), and the buy cell carries the recent/full touch token `(0/3 · 9/14)` exactly like
the sell. The fill-now fold is REMOVED from the band buy price. **Churn stays fold-toward-live**
(churn IS a fill-now lane — its doctrine is "buy every limit, flip fast"), so the split is
per-niche, routed off `spec`, not global. BE-floor unchanged (honesty preserved).

### AC2 — the grade/rank must absorb the fill-probability the price no longer hides
Because the price stops folding, a low-reach patient bid must not out-rank a fill-now one on price
alone. Verify `rank = net × P(fill) ÷ TTF` actually feeds the **bid** reach into `P(fill)` and TTF
(a 0/3-recent patient bid ⇒ low P, long TTF ⇒ ranks BELOW an equal-net fill-now flip). If it
doesn't today, wire it. This is what keeps the mirage (Crimson kisten's stale top) from ranking
like a real edge once the raw price is shown.

### AC3 — REMOVED 2026-07-18 (superseded by AC1)
The interim patient-band-edge divergence footer shipped as a stopgap, then was DELETED the moment AC1
landed: once the band buy leg prices the band low natively, the real patient edge shows in the
Est. buy/sell/net columns directly, so the compensating footer was redundant. Removed from
`screen-flip-niches.mjs` renderMode + the `patient-band-edge` mention in `pipeline/lib/render.mjs`'s
tier-registry comment. Original spec kept below for the record:

### AC3 (original) — surface the patient-vs-fill-now divergence explicitly (the cheap interim, ship first)
A footer/inform line when the folded pair is BE-floored but the raw band pair clears: `patient band
edge (deep bid + patient ask): Abyssal bludgeon +209k, Ancient godsword +640k — N rows the fill-now
fold hid`. This is the low-risk change that stops the board reading dead TODAY, independent of
AC1/AC2 landing. It reuses the `--raw` numbers already computed.

### AC4 — the counterfactual data gap (F1, highest compounding value)
Log the not-taken → would-have-filled outcome so `reach` graduates from `inform` to a real F1
candidate: for each folded/rejected leg, did the raw band edge actually print in the following
window? Extend the existing shadow logs — `winClear` (sell) and the ask-headroom retro — to the
**BUY** leg (did the band-low bid's price trade after we folded it up?). Lean field on
`js/estimators` confidence → `suggestlog.mjs`, YS2 pattern. Until this exists, EST_REACH_SAT_FRAC
and whether the fold should touch price at all are UNANSWERABLE — do not tune the constant, close
the data gap. (Owner: F1 / O1 sample thresholds.)

## Honesty labels (process rule 4)

- AC1/AC3 are a **display/posture** change (which number the table shows) — encodes on judgment +
  the verified bludgeon/godsword anchors, no calibration claim.
- AC2 is a correctness check on existing rank math — verify-then-wire, not a tune.
- AC4 is the ONLY thing that lets any fold CONSTANT be calibrated later; it is a data-plumbing
  proposal, and the constants stay F1's, gated on O1 thresholds. n is weeks-cold today.
- The whole reach-fold-on-price idea (PLAN-OUTPUT-TABLE) is **provisional, n≈3–14**; this plan does
  not delete it — it scopes it to the churn/fill-now lane and restores the patient price to the band
  lane pending F1 evidence.

## Owners / routing

| Chunk | What | Owner |
| --- | --- | --- |
| AC3 | patient-edge divergence footer (interim, ship first) | ✅ SHIPPED 2026-07-18 — a `context`-tier stdout footer in `screen-flip-niches.mjs` renderMode (BAND niche only): when the folded Est. pair is BE-floored but the RAW patient pair (`optBuy→optSell`, reusing `row.optNet`) clears ≥ MIN_NET_GP (100k), one `ℹ patient band edge` line names those rows + their patient net. Console-only (never enters screen.json — verified byte-identical), inform-only, no gate/rank/grade touch, no APP_VERSION bump. |
| AC1 | band buy leg: band-low price + reach annotation, per-niche split | ✅ SHIPPED 2026-07-18 — `entryDoctrine` (js/estimators/pair.mjs) now splits band off churn by fillShape: band ('asym') → the new `'band-low'` doctrine (prices `ob`, the band low, no fold — same math as value's 'trough', a distinct LABEL); churn ('symmetric') KEEPS `'reach-fold'` (fill-now fold, BYTE-IDENTICAL — proven over the replay archetypes). The band buy cell carries the reach token + a PLACEMENT PERCENTILE `(4/14 · pXX)` — `placement(rbStats.lows, estBuy)` computed ZERO-FETCH off the screen's in-hand 14-day daily lows and threaded via `est.confidence.buyPlacement` into `estPairCells`. Console/shadow-only (app never calls estimatePair; screen.json publishes the raw cells) → NO APP_VERSION bump. Verified: BE-floored band rows dropped 4→1; same-item pairs un-fold (Superior dragon bones +56→+256, Ranging potion +27→+117). |
| AC2 | verify/wire bid-reach into rank P(fill)/TTF | ✅ SHIPPED (verify-only, already wired) 2026-07-18 — the rank (`estimateRank`, quotedPair = optBuy/optSell = the band low) already feeds the BID reach into `pFillIntraday` via `extra.reach`; a low-reach band-low bid gets low P and ranks DOWN. Evidence: Masori body net +542k/u but bid-reach 0/3 (1/14) → P~0.04, rank 24,859 (far below Nightmare staff P~0.29, rank 217.2k); Weapon poison / Dragon dart tip 0/14 bids → P~0.00, rank 0 (bottom). No code change needed. The SELL leg keeps its reach-fold (un-folded ONLY the buy) — the stale-top mirage stays buried (Masori sell 42.90m folded, not the raw asym 43.12m). |
| AC4 | buy-leg would-have-filled counterfactual log | F1 (gated on O1) — still OPEN |

## Docs to reconcile when this ships (rule 8)

- `PLAN-OUTPUT-TABLE.md` — amend the "fold reach INTO the price" premise to per-niche (churn folds,
  band annotates). This plan folds into `PLAN.md` at ship.
- `docs/MARKET-ANALYSIS.md` — the Est. buy/sell column definition (price vs annotation split).
- `.claude/skills/scan/SKILL.md` — the reach-flag reading (a low buy-reach is "patient," not "dead").
- `README.md` inventory — the `js/estimators/sell-models/` entry if the buy doctrine moves.

---

# Wave 2 (2026-07-18, Ben-directed) — discovery shows best-case, the fold becomes a validation data point

Status: DRAFT — architected this session, not implemented. Continues AC numbering from AC4.
Principle (Ben): **scan is DISCOVERY** — cast a wide net, show the BEST-CASE edge, don't pessimize
the price; **reachability is truly checked in the VALIDATION flow** (`read-window-range.mjs`'s
`--ask/--bid/--exit/--profile` verify trio, run before every real offer). So the reach-FOLD moves
OUT of the discovery price and INTO validation as a DATA POINT. The load-bearing guardrail:
"best-case" means the PRICE shown — the **RANK must stay reachability-aware**, or the wide net just
sorts mirages first (Crimson kisten's +751k stale top would rank #1).

## Findings (file:line — how it works today)

**The fold, and where it does/doesn't check `symmetric`:**
- `js/estimators/sell-models/reach-fold.mjs:64` — `fold(f) = min(1, f / EST_REACH_SAT_FRAC)`.
- Buy leg `:75` — `doctrine === 'reach-fold'` (churn) folds the buy UP toward the live instabuy by
  the band-low's recent touch-reach; `trough`/`band-low` anchor `ob` unfolded (AC1's split).
- Sell leg `:85-92` — `fR = f0 + relief×(1−f0)`, `sCands = qs + (topRef−qs)×fR` — the ask-reach fold
  applies to EVERY niche routed through the model. **There is NO `fillShape` check anywhere in
  `propose()`** — churn's price folds on a signal the codebase declares invalid for churn.
- `js/estimators/pair.mjs:88-93` — `entryDoctrine`: `fillShape === 'symmetric'` → `'reach-fold'`
  (churn keeps the fill-now buy fold); band → `'band-low'`.

**The already-declared churn exemptions (the half-wired doctrine):**
- `js/estimators/families.mjs:251` — RANK: `askF = (spec.fillShape === 'symmetric') ? 1 :
  askReachFactor(ctx.askReach)` — churn's rank P skips the ask-reach discount, on the doctrine that
  the day-level reach read (1h avg-high aggregates vs a tight 5m band top) mismeasures a
  small-margin churn band.
- `pipeline/commands/screen-flip-niches.mjs:738-739` — GRADE: same `!== 'symmetric'` guard on the
  `REACH_GRADE_CAP` letter ceiling.
- So the codebase's own position is "this signal is noise for churn" — for rank and grade — while
  `reach-fold.mjs` still mutates churn's PRICE with it on both legs. Smoking gun (this session):
  Super restore(4) Est. Net **+1 (BE-floored)** vs rank net **112** and REALIZED **74.9/u over 10
  lots**; Ruby dragon bolts(e) BE-floored purely from the BUY fold with ask reached 3/3.

**Scope of a `symmetric`-keyed change (verified — it is churn-only in practice):**
- `pipeline/commands/quote-items.mjs:405-406,618` — quote-items ALWAYS passes `FLIP_NICHES.band`
  (asym) to `estimatePair`, whatever the item → a symmetric exemption never fires there.
- `screen-flip-niches.mjs:1045,1470` — value renders via `renderValueMode`, which never calls
  `estimatePair`. Value is also `fillShape:'symmetric'` (`js/flip-niches.mjs:191-195`) but its
  `entryDoctrine` resolves to `'trough'` first (`priceBasis:'term'`, pair.mjs:90) and no value
  surface reaches the reach-fold model. Scalp is `'asym'` → untouched.

**The rank is computed at the RAW pair — the fold never enters it:**
- `families.mjs:201-206` (`quotedPair`, band `priceBasis:'opt'` → the raw band edges) and `:229`
  (`net = netMargin(pair.bid, pair.ask)`). So removing/keeping any PRICE fold changes the display
  only; the rank's net is already best-case, discounted through P, not through price.

**The validation flow (`read-window-range.mjs`) today:**
- `--bid`/`--ask` scoring `:222-241` — touched/reached k/N + recency split + placement percentile
  (+ 5m-grain where the archive has coverage); `--exit` back-solve `:247-266`; `--profile` diurnal
  `:140-175`. The 1h series + live pair are fetched once per item (`:136`). `--out` writes
  `verify.json` (`:49,:369-374`), `--json` dumps the same result objects. **No reach-folded price
  appears anywhere in this flow** — the operator sees raw counts/placement but never "what the
  estimator's fold would make of this level."

## The crux — does the band SELL fold also move out of the discovery price?

**Verdict: KEEP the band sell fold in the discovery price for now.** Today's rank is NOT a
sufficient mirage guard on its own. Two structural gaps, reasoned from the code:

1. **The ask-reach P discount is deliberately SOFT-floored.** `js/estimators/reach.mjs:89-96` +
   `families.mjs:82` — `askReachFactor` maps reach 0 → `PFILL_ASKREACH_FLOOR = 0.25`, never lower
   (the intentional false-negative guard for n≈14). A 0/7 stale top keeps ≥25% of its P. Run the
   Crimson-kisten shape through it: raw +751k × ≥0.25 ⇒ ≥ ~188k of rank-net-equivalent — MORE than
   a genuine +150k edge at P 0.9 (~135k). The AC2 anchor (Masori body P~0.04) was driven by the
   **bid**-reach entering `pFillIntraday` multiplicatively; an ask-side mirage with a
   frequently-touched band low does NOT collapse the same way. A large-net stale top can still
   out-rank real edges in the active sort. `REACH_GRADE_CAP='B'` (`js/rating.mjs:109-110`) caps
   the LETTER, but a cap doesn't reorder — the row still sits high showing a best-case +751k.
2. **The overnight posture sort is fully reach-BLIND.** `screen-flip-niches.mjs:790` —
   `POSTURE === 'overnight'` sorts by raw `row.optNet` desc, no P, no reach, before falling back to
   score. Un-fold the band sell price and a Crimson-kisten row sorts **#1 by construction** on the
   posture where Ben sizes unattended capital, with a best-case price in the cell. Today the folded
   Est. sell is the only countervailing honesty on that surface.

So the full generalization ("discovery uniformly best-case") is UNSAFE today. The principle is
still honoured: churn un-folds now (its fold is measurement noise per the codebase's own doctrine —
that's a correction, not a loosening), the fold's value surfaces in validation for every niche
(AC8), and band's sell un-fold becomes a **re-decidable follow-up** gated on (a) AC9 making the
overnight ordering reach-aware and (b) AC4/F1 measuring whether the raw top or the folded value
better predicts realized sells. If F1 says the fold predicts nothing, it dies everywhere; if it
predicts fills, it has earned its place — either way the call becomes data, not doctrine.

## ACs (continuing from AC4)

### AC5 — churn sell-fold exemption: force `fR = 1` for `fillShape:'symmetric'`
**What:** in `reach-fold.mjs propose()`, when `ctx.spec.fillShape === 'symmetric'`, the sell fold
factor is forced to 1 → `estSell` = the band-top blend the rank already prices on (the `sCands`
diurnal-ask blend stays — it is a timing model, not the invalidated reach signal; the residual
delta vs the exact band top is small on a tight churn band and is NOT part of the evidence gate).
Keep `confidence.ask` POPULATED (the F1 shadow must keep logging the reach counts — they are the
very data that will test this exemption) but add `confidence.foldExempt: 'symmetric'`;
`estPairCells` (`js/estimators/cells.mjs:48-52`) omits the sell reach token when `foldExempt` (a
signal the codebase declares invalid must not ride the cell as an implied caution), and
`estConfLean` (`cells.mjs:67-86`) logs `foldExempt` so the retro can segment.
**Why:** finishes the half-wired exemption — rank (`families.mjs:251`) and grade
(`screen-flip-niches.mjs:738`) already skip this signal for churn; the price is the last surface
still folding on it. Anchor: Super restore(4) +1 (BE-floored) vs realized 74.9/u.
**Honesty:** a display/consistency correction, not a tune — it aligns the price with an exemption
Ben already ruled (2026-07-12); no constant changes. Churn numbers CHANGE intentionally.
**Verify:** new `estimators.test.mjs` fixture (symmetric spec + low ask-reach ⇒ estSell = band-top
blend, no fold; asym spec unchanged golden); before/after `--mode churn` run — Super restore(4)
un-floors to a net in the rank's magnitude (~112-order, not +1); `--mode band` byte-identical.

### AC6 — churn buy leg anchors the band low (no bid-reach fold up)
**What:** `entryDoctrine` (`pair.mjs:88-93`): `fillShape === 'symmetric'` → `'band-low'` (same
math+label as band, per AC1's "distinct label only when the math differs" precedent). The
`'reach-fold'` doctrine value then has NO producer — delete the buy-side fold branch in
`reach-fold.mjs:75` (the `Math.round(qb - (qb - ob) * fold(...))` arm) and retire the string from
the doctrine union/comments. The screen's placement-percentile attach
(`screen-flip-niches.mjs:651-655`) gates on `doctrine === 'band-low'` — churn rows now qualify and
get the `(k/N · pXX)` buy annotation too (placement is distribution position, not the invalidated
reach signal — keep it; update the "BAND NICHE ONLY" comment). Suppress the buy-cell reach token
for `foldExempt` rows the same way as AC5's sell side; shadow counts keep logging.
**Why:** the same doctrine on the other leg — the day-level reach read mismeasures the tight churn
band on BOTH legs (Ben, this session). Anchor: Ruby dragon bolts(e) BE-floored purely from the BUY
fold while its ask reached 3/3.
**Honesty:** display/posture change on Ben's ruling; deletes dead code rather than leaving a
doctrine with no producer. Churn buy prices CHANGE intentionally.
**Verify:** fixture (symmetric spec ⇒ estBuy = `ob`-blend, identical to a band spec's);
before/after `--mode churn` — Ruby dragon bolts(e) un-floors; quote-items byte-identical (always
passes the band spec — verified above); value path unreached (renderValueMode never calls
estimatePair).

### AC7 — band sell fold: KEEP in the discovery price (the crux verdict), with a named exit path
**What:** no code change to band's sell leg. Document IN `reach-fold.mjs`'s header that the band
sell fold is retained as the discovery mirage guard **because** (a) `PFILL_ASKREACH_FLOOR = 0.25`
soft-floors the rank's ask-reach discount (a big-net stale top keeps ≥25% P and can out-rank real
edges) and (b) the overnight sort was reach-blind pre-AC9 — and that its removal is re-decidable
when AC4/F1 scores raw-top vs folded against realized sells (with AC9 as a prerequisite).
**Why:** the crux analysis above — "best-case price" without a sufficient ordering guard sorts
mirages first, the exact failure the guardrail names.
**Honesty:** a judgment call from code structure + the kisten/Masori anchors, not a calibrated
claim; explicitly provisional pending AC4's counterfactual data.
**Verify:** `--mode band` before/after byte-identical for the sell leg (AC5/6 must not touch band).

### AC8 — fold-as-data-point in `read-window-range.mjs` (the fold's new home)
**What:** when the verify trio is invoked with a scoreable level (`--bid`/`--ask`/`--exit`) and the
live pair is available, compute the estimator's fold ON the in-hand data and print it as ONE
informational line per scored leg, e.g.:
`  fold: best-case ask 43,650,000 → reach-folded 42,900,000 (recent 0/3 · full 4/14) · net at folded pair +XXXk (BE Y)`
Mechanics — ZERO new fetch, byte-parity with the screen's fold by construction:
- Build a synthetic estimator row from data already in hand (`:136,:177,:204`): `quickBuy =
  latest.high`, `quickSell = latest.low`, `optBuy = BID ?? bidSide.q50`, `optSell = ASK ?? EXIT ??
  askSide.q50`; `extra.bidReach/askReach` from the already-computed `touchedDays`/`reachedDays` +
  `recencySplit` counts (`:207-213,:222-241` — same field remap the screen does at its :565/:583).
- Call the SHARED `estimatePair(FLIP_NICHES[niche], row, extra, { sellModel: 'reach-fold' })` (new
  imports from `../lib/estimators.mjs` + `js/flip-niches.mjs`); a `--niche <band|churn|scalp>` flag
  defaults to `band`. Reusing the estimator (not re-deriving the fold math, not reading the stale
  shadow log — fresh-read-before-acting) guarantees the number matches what the screen would fold.
- Dump into the JSON: `result.fold = { estBuy, estSell, estNet, be, confidence: estConfLean(est) }`
  → rides `--json` and the `--out` `verify.json` (`:369-374`) unchanged in shape elsewhere.
- Absent live pair / no scoreable level ⇒ no line, no field (the degrade convention).
**Why:** this is where the principle lands — discovery shows best-case; the operator sees
`best-case X · reach-folded Y` at the moment capital is committed, and picks with both numbers in
hand. It also makes the fold's number visible on churn even though churn's discovery price no
longer folds (the `--niche churn` call inherits AC5/6's exemption — for churn the line will show
fold ≈ best-case, which is itself informative).
**Honesty:** inform-only, PLACEHOLDER model (n≈14) — label the line as the estimator's fold, not a
verdict; never gates/overrides the existing reach/placement/depth reads.
**Verify:** run the trio on a known item with a stale top (kisten shape) — the folded value prints
below the raw ask and lands in `verify.json`; run without `--ask/--bid/--exit` — output
byte-identical to today.

### AC9 — the reachability-aware RANK stays intact and gets its one named strengthening
**What:** (a) PIN the guardrail: an `estimators.test.mjs` assertion that a band-spec rank with a
low ask-reach ranks below an equal-net high-reach row (the Lightbearer golden already covers the
shape — extend, don't duplicate), so no future "best-case" pass can quietly drop the discount.
(b) FIX the discovered reach-blind spot: the overnight posture sort
(`screen-flip-niches.mjs:790`) multiplies its primary key by the ask-reach factor —
`optNet × askReachFactor(askReachExtra)` (store `askReachExtra` or the factor on the pushed row at
`:785`) — so an unattended-capital sort can't put a stale top first. Symmetric niches pass factor 1
(the AC5 doctrine, and `askReachFactor` is absent→1 anyway). Console-only reorder; `screen.json`
untouched.
**Why:** the guardrail clause of the principle. (b) is load-bearing for ever revisiting AC7 —
without it, un-folding band's sell makes the overnight board sort mirages first by construction.
**Honesty:** (a) is a test; (b) is a judgment ordering change (n = the kisten/godsword anchors),
intentionally altering overnight ordering — say so to Ben in the ship note. `PFILL_ASKREACH_FLOOR`
itself is NOT touched (F1's constant).
**Verify:** before/after `--posture overnight` run — a low-ask-reach big-net row demotes; active
posture ordering unchanged; replay goldens unaffected (render-stage only).

## Validation strategy (this wave INTENTIONALLY changes discovery numbers — byte-identity is NOT the goal on churn)

Before/after evidence gates, in order:
1. **Churn shows real net:** `--mode churn` (or `--mode all`) — Super restore(4) Est. Net in the
   rank's magnitude (~112-order, not +1); Ruby dragon bolts(e) no longer BE-floored. Capture both
   tables in the ship note.
2. **Band untouched:** `--mode band` Est. cells byte-identical pre/post AC5+AC6 (the exemption is
   keyed off `symmetric`; band is `asym`). Scalp and quote-items byte-identical (band spec always).
3. **Mirages still rank down:** the Crimson-kisten shape (or the current closest stale-top row)
   stays low/graded ≤ B in the active sort, and post-AC9 demotes under `--posture overnight` too.
4. **Fold-as-datapoint appears:** the verify trio prints the `fold:` line and `verify.json` carries
   `result.fold`; a flagless run is byte-identical.
5. **Console/shadow-only:** grep confirms the app never imports/calls `estimatePair`
   (screen.json publish path untouched — same check AC1 ran); `--publish` before/after diff of
   `screen.json` is byte-identical ⇒ **no APP_VERSION bump**. Pipeline-only change, noted in the
   commit message per rule 5.
6. `node --check` every touched file + `estimators.test.mjs` / `loadbands.test.mjs` green; CI
   `checks` + `smoke` green.

## Sequencing (for the Opus implementer — each step independently verifiable)

1. **AC5** (sell exemption + `foldExempt` plumbing through cells/shadow) + its fixtures. Gate 1a+2.
2. **AC6** (entryDoctrine symmetric→'band-low', delete the dead buy-fold branch, placement comment)
   + fixtures. Gate 1b+2.
3. **AC9** (test pin + overnight sort factor). Gate 3.
4. **AC8** (read-window-range fold line + `--niche` + `result.fold`). Gate 4.
5. **AC7** (header doc note in reach-fold.mjs) + the docs pass below. Gates 5-6, then ship.

## Docs to reconcile (rule 8 — additions for this wave)

- `PLAN-OUTPUT-TABLE.md` — extend the 2026-07-18 amendment: churn no longer folds EITHER leg
  (the "churn still folds its buy toward live" sentence is superseded by AC6).
- `docs/MARKET-ANALYSIS.md` — the churn-exemption bullet (~:223) now covers rank + grade + BOTH
  price legs; add the `read-window-range` fold-as-datapoint line to the verify-trio description.
- `.claude/skills/scan/SKILL.md` — churn Est. cells are unfolded band-edge prices now (read the
  rank/grade for fill risk); note the fold datapoint lives in the validation step.
- `README.md` inventory — `read-window-range.mjs` entry gains the fold line + `--niche`;
  `js/estimators/` entries updated for the retired `'reach-fold'` entry doctrine.
- `js/flip-niches.mjs` `fillShape` doc block (~:186-195) — the symmetric exemption list grows
  "both estimatePair price legs".

## Owners / routing (Wave 2)

| Chunk | What | Owner |
| --- | --- | --- |
| AC5 | churn sell-fold exemption (fR=1 symmetric, foldExempt token/shadow) | ✅ SHIPPED (estimator core: reach-fold/pair/cells) |
| AC6 | churn buy leg → 'band-low' anchor; delete dead reach-fold buy branch | ✅ SHIPPED — core in a23a901; the churn buy-cell pXX DISPLAY doctrine (screen-flip-niches AC1/AC6 comment + README estimators reconciliation) landed in the WIP-pile cleanup |
| AC7 | band sell fold KEPT in discovery (crux verdict) — doc note + exit path | ✅ SHIPPED (reach-fold.mjs header note) |
| AC8 | fold-as-datapoint in read-window-range (`fold:` line + `result.fold` + `--niche`) | ✅ SHIPPED in the WIP-pile cleanup, alongside read-window-range's `--profile`-compose + `--out <path>` WIP it was entangled with (one commit — the three concerns share the usage line + doc header, not cleanly hunk-separable) |
| AC9 | rank guardrail: (a) test pin + (b) overnight-sort fill-prob weight | (a) ✅ SHIPPED (estimators.test pin); (b) ✅ SHIPPED — overnight sort keys on `optNet × er.pFill` (two-leg fill prob), superseding the first cut's `optNet × askReachFactor` (floored at 0.25 + ask-leg-only → rank-0/P≈0 rows like Extended stamina(4) sorted #2); now they sink to the bottom, reachable high-P edges lead; churn exempt (ovWeight=1). Console-only (POSTURE never enters screen.json). Judgment change on a cold sample — unvalidated vs realized overnight fills |
| AC4 | buy-leg would-have-filled counterfactual log — also the calibrator that re-decides AC7 | F1 (gated on O1) — still OPEN |
