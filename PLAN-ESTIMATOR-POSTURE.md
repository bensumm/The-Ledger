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

### AC3 — surface the patient-vs-fill-now divergence explicitly (the cheap interim, ship first)
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
| AC1 | band buy leg: band-low price + reach annotation, per-niche split | next session |
| AC2 | verify/wire bid-reach into rank P(fill)/TTF | next session |
| AC4 | buy-leg would-have-filled counterfactual log | F1 (gated on O1) |

## Docs to reconcile when this ships (rule 8)

- `PLAN-OUTPUT-TABLE.md` — amend the "fold reach INTO the price" premise to per-niche (churn folds,
  band annotates). This plan folds into `PLAN.md` at ship.
- `docs/MARKET-ANALYSIS.md` — the Est. buy/sell column definition (price vs annotation split).
- `.claude/skills/scan/SKILL.md` — the reach-flag reading (a low buy-reach is "patient," not "dead").
- `README.md` inventory — the `js/estimators/sell-models/` entry if the buy doctrine moves.
