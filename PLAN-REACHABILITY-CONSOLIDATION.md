# PLAN-REACHABILITY-CONSOLIDATION — pressure as the load-bearing reachability primitive

Status: **DRAFT — migration ARCHITECTURE + evidence-scaffolding only. Nothing retired; every existing
heuristic stays fully live.** Per-topic working doc (PLANNING.md lifecycle). Cross-linked from
`PLAN-DEPTH-EXIT.md` (which shipped the primitives this consolidates around: DE1/DE2/DE6 depth,
PB1 pressure, DE3 the two-lens held-lot line). This doc SPANS beyond depth-exit — it governs how the
whole *reachability layer* (how far a resting bid/ask realistically fills) converges on ONE
evidence-scored primitive instead of accreting parallel heuristics. It designs HOW to earn the
calibration; it does not claim it (rule 4 — n≈0 on every constant named below).

## The premise (what PB1 validated, and the overlap it exposes)
`pressure = medVolHi/medVolLo` is a **dimensionless, scale-free demand-balance signal already latent in
every `windowStats` read** (it falls out of the volume fields the reach math already sums). PB1
(`reachableBand`, `js/windowread.mjs`) made it *drivable*: `base ± band·φ(ln pressure)·reliability`
prices a two-sided reachable band off the buyer/seller balance, validated for reasonableness across 10
commodities (2gp–10k gp) with the IQR band and no φ peak-cap. Depth (DE1) independently answers the
*size-reachable tail*; **pressure + depth are two lenses on one reachable-price distribution** (pressure
= center/direction/velocity, depth = size-reachable tail — proven at DE3).

That creates **overlap with two older reachability heuristics that should CONVERGE, not accrete**:

1. **`reachRelief`** (PLAN-LIQUIDITY-REACH, `js/estimators.mjs`) — a whole-day-volume-RATIO softening of
   the ask-reach fold. Depth measures directly what relief only proxied (size÷flow), and pressure adds
   the DIRECTION relief lacks (relief is symmetric — it can't tell a buy-heavy book's high ask from a
   sell-heavy book's deep bid). **Strongest retirement candidate.**
2. **`asymPair`/`asymEstimate`** (`js/windowread.mjs` / `js/estimators.mjs`) — a deep-bid/high-reach-ask
   pair at **FIXED quantiles** (`ASYM_P_LO=0.25` / `ASYM_P_HI=0.8`). `reachableBand` is the **same
   deep-bid→high-ask idea with pressure-DERIVED levels** — a **merge** candidate, not a parallel thing.
3. **reach-as-a-PRICING-driver** — the reach FOLD in `estimatePair` (fold the band edge toward live by
   how rarely it prints) is the **qty→0 limit of depth** (proven DE1). reach-as-an-OBSERVABLE
   (`reachValidator`, the touched/reached counts) **STAYS** — that is evidence, not a competing price.

## The two required properties (Ben named both — non-negotiable)
- **EVIDENCE-BASED — parallel-run, never replace-on-theory.** The competing estimates shadow-log SIDE BY
  SIDE on `suggestions.jsonl` so `join-outcomes.mjs`/`retrojoin.mjs` score them HEAD-TO-HEAD on real
  fills. Nothing retires until the retro shows the replacement WINS over a calibration window.
- **CONTROLLED — staged, reversible, deprecate-then-remove.** Each supersession is flag-gated, flag-off
  byte-identical (the DE4/PB4 pattern). Mark superseded, keep as the live FALLBACK, remove ONLY after the
  replacement proves out. The migration map below names the exact order + the per-step evidence gate.

---

## 1. INVENTORY — every touchpoint where the three heuristics drive a number

### `reachRelief` (`js/estimators.mjs`) — the size/liquidity ask-reach softener
| Consumer | Surface(s) | What it produces | What it feeds |
| --- | --- | --- | --- |
| `estimatePair` Part A (fold softening `fR = f0 + relief·(1−f0)`) | screen `--default`, quote `--default`, quote `--positions` | softens the ask-reach fold toward 1 | the console **`Est. sell`** cell (+ shadow `estSell`) |
| `estimatePair` Part B (top de-bias toward `dayHighFrom5m`) | same | widens the sell top reference (≤ observed 24h high) | same `Est. sell` |
| `askReachFactor(askReach, relief)` | watch-positions `reliefSuffix` note; estimatePair internal | the `size-relieved fill ~N%` clause | a watch NOTE only (**DE3 already supersedes it** when the depth read is non-null) |
| `estConfLean` | screen/quote shadow | logs `reachRelief`/`sizeRatio`/`debiasedTop` **when it fired** | `suggestions.jsonl` (F1) |

**Blast radius — SMALL and known.** `reachRelief` is **NOT wired into `estimateRank`** (the rank feeds the
published grade/sort/`screen.json`) — the `askReachFactor` header states this is deliberately F1-gated
and never landed. So relief drives ONLY: the **console `Est. sell` price** (never the app / `screen.json`
/ grade) and the **watch `size-relieved` note** (already the DE3 fallback). Retiring it touches a
console price + one note — no grade/rank/app surface.

### `asymPair` / `asymEstimate` (`js/windowread.mjs` / `js/estimators.mjs`) — fixed-quantile deep/high pair
| Consumer | Surface(s) | What it produces | What it feeds |
| --- | --- | --- | --- |
| `◆ asym fill` inform line | screen, quote | deep-bid→high-reach-ask + P_ask/P_bid | stdout note only |
| `asym` shadow field | screen | `{bid,ask,pAsk,pBid,n,rank}` | `suggestions.jsonl` (F1 A/B) |
| `estimatePair` sell blend | screen, quote | `asym.highReachAsk` is ONE `sCands` blend input | the `Est. sell` cell (**coupling — see entanglement**) |
| `--asym` reprice + sort flip | screen (F1-GATED, **off**, `--publish` refused under it) | band/scalp quoted prices = the asym pair; rank = net×P_ask÷TTF | the quoted table + sort (experimental only) |

**Blast radius — MEDIUM, mostly experimental.** The default path uses asym only as an inform line + one
`estSell` blend input + the shadow field. The rank/reprice consumer (`--asym`) is already F1-gated and
OFF — a swap there is experiment-vs-experiment, not a live-path change.

### reach-as-pricing (`estimatePair` fold; `estimateRank` two-leg P)
| Consumer | Surface(s) | What it produces | Disposition |
| --- | --- | --- | --- |
| `estimatePair` reach FOLD (`fold(frac)`) | screen/quote `Est. sell`/`Est. buy` | folds the band edge toward live by reach frequency | **qty→0 limit of depth (DE1)** — subsumed by depth on held lots (DE4), stays the discovery degrade |
| `askReachFactor` in `estimateRank` | screen `screen.json`/grade | two-leg P(fill) exit discount on the rank | **load-bearing, F1-gated** — reach-as-observable; NOT a consolidation target here |
| `reachValidator` (`js/validate.mjs`) | every surface | caution/reject on rarely-reached edges | **STAYS — reach as EVIDENCE, out of scope** |

### What each estimator predicts for the head-to-head (the exit-price ask, the scored quantity)
- **reach**: the reach-folded band top (relief=0 case of `estSell`).
- **reachRelief**: the relief-softened, top-de-biased `estSell`.
- **asym**: `asymEstimate.ask` (= `highReachAsk`, clamped to live/band).
- **depth**: `clearableAsk` → `depthExit.ask` (null-with-reason on a thin book).
- **pressure**: `reachableBand.ask` → `reachable.ask`.
All five map to a single realized target the retro already produces: **`sellEach`** (the qty-weighted
realized GROSS sell price per closed lot — `retrojoin.mjs` added it 2026-07-12 for exactly this class of
sell-side join). The bid side mirrors it against `fillEach`/the deep-bid touch.

---

## 2. THE HEAD-TO-HEAD (design — reuse the F1 machinery, don't fork a calibrator)

**Co-log requirement (the gap this task's scaffolding closes).** DE3 logs `depthExit` + `reachable` on
watch held rows but NOT the reachRelief `estSell` or the `asym` pair; screen/quote log `estSell` + `asym`
but not `depthExit`/`reachable`. **No single surface logs all five.** The head-to-head needs every
competing exit estimate on the SAME `(itemId, ts)` row so the join scores them against ONE realized
`sellEach`. **Scaffolding chunk RC-S1 (this task) makes the watch held-lot surface log all five** (the
richest accrual surface — the loop fires many times per real held lot, and held lots produce the real
sells to score). Screen/quote co-log of pressure is a cheap follow-on (RC-S2, noted below).

**The scorer (DESIGN — F1 analysis, built when the window warms, NOT now).** A pure
`aggregateReachability(retroRows)` sibling of `aggregateOutcomes` (`retrojoin.mjs`): for every row with a
closed round-trip (`sellEach` present) it reads the five predicted asks off the joined suggestion,
computes each estimator's signed + absolute error vs `sellEach`, and buckets by the **(side × liquidity
class × regime)** cell — reusing `liqClassOf` (the existing `class`) + `regime` already on the row, and
`groupStat`'s n-on-every-field / quantile discipline. Per cell it reports, per estimator: n, median
signed error (bias), median |error| (accuracy), and an **exit-safe rate** (predicted ask ≤ `sellEach`, so
a realized fill actually cleared it). **Refuses any per-cell verdict below `--min-n`** (the `join-outcomes
--report` floor, default 8 — reused, not reinvented). No grade/verdict on a cold sample (rule 4).

**Promotion criterion (the evidence gate — one definition, applied per supersession).** In a
(side × liqClass × regime) cell at n ≥ floor over a calibration window, the challenger SUPERSEDES the
incumbent when it **both** (a) lowers median |error| vs `sellEach` and (b) does not worsen the exit-safe
rate — sustained across the window, not a single report. Cells that never reach n stay on the incumbent
(the fallback never disappears silently). This is the SAME gate shape DE4/DE7/PB4 already defer to — F1,
attended, per-cell — so no parallel calibrator is introduced.

---

## 3. THE MIGRATION MAP (order · reversible mechanism · evidence gate — all F1-gated + attended)

Each step: flag-gated, **flag-off byte-identical**, deprecate-then-remove. Do NOT start any step until
its gate is met on the head-to-head over a calibration window.

- **RC1 — `reachRelief` → depth (held) / pressure (direction), on the `Est. sell` price.** *First — smallest
  blast radius (console price + note, no grade/rank/app).* Mechanism: a `--depth-exit`/pressure flag in
  `estimatePair` (the DE4 flag) makes the depth ask (non-null) / pressure ask the held-lot sell reference,
  relief the FALLBACK when both are null. Gate: RC1 cell (side=ask × liquid × any regime) shows
  depth-or-pressure beats relief on |error| without worsening exit-safe rate. Deprecate: mark `reachRelief`
  superseded (keep live as the thin-book fallback). Remove: only after ≥1 full window with no cell
  regressing to it. **This is DE4 by another name** — RC1 IS the DE4 chunk, scoped as the first
  supersession.
- **RC2 — `asymPair` → `reachableBand` (merge the fixed-quantile pair into the pressure-derived band).**
  *Second — the merge, medium radius.* Mechanism: `reachableBand` produces the deep-bid/high-ask pair
  `asymEstimate` produces, but pressure-derived; a flag routes the `◆ asym` inform line + the `estSell`
  blend input + the F1-gated `--asym` reprice through `reachableBand` instead. Gate: RC2 cell shows the
  pressure band's bid AND ask both beat the fixed-quantile pair on |error|/exit-safe across liquidity
  classes (the fixed 0.25/0.8 can't flex with direction — the hypothesis). Deprecate: `asymPair` marked
  superseded, kept as the fallback + the `--asym` experiment's basis until RC2's own window proves out.
  Remove `asymPair` only after the `estSell` blend + `--asym` both read `reachableBand`. **Entanglement to
  respect (see §6): `asymPair.highReachAsk` currently feeds `estSell` — RC2 must re-point that blend input
  in the same flag, or `estSell` silently keeps a fixed-quantile leg.**
- **RC3 — reach-fold → depth on held lots (the qty→0 subsumption made load-bearing).** *Third — rides
  RC1's flag.* The reach fold in `estimatePair` is depth's qty→0 limit (DE1-proven); on a held lot with a
  non-null depth read the fold is redundant. Mechanism: same DE4 flag. reach-fold stays permanently on the
  DISCOVERY surface (no held qty; a per-row depth fetch is the DE7 cost decision). reach-as-observable
  (`reachValidator`) is untouched. Gate: subsumed by RC1's (same flag, same cell). No separate removal —
  the fold simply isn't reached on held lots under the flag.

**The PB4 decision this migration FORCES (surfaced at PB1, decided here as a consolidation point).** PB's
doctrine is **no peak cap** — a fully-reliable pressure read may price ABOVE the last observed peak
(that's the whole point: `clearableAsk`'s 394 under-reads the real 397). But `estimatePair` currently caps
the sell reference at `dayHighFrom5m` (the observed 24h high — "Soul rune won't sell at 500"). **These
cannot both hold once pressure drives the price.** The consolidation ruling: the cap is a **reliability-
gated** ceiling, not an absolute one. When `reachableBand.reliability == 1` (a liquid, well-sampled book),
the pressure ask may exceed `dayHighFrom5m` up to `PRESSURE_HEADROOM_MAX` bands; when reliability < 1 the
`dayHighFrom5m` cap binds (the thin-book mirage guard). This is EXACTLY the mirage-reintroduction risk F1
exists to referee, so **PB4 ships flag-off and the cap-relaxation is scored on the head-to-head's exit-safe
rate** (did prices above the observed high actually clear?) before it can bind live. Until then the
`dayHighFrom5m` cap stands unchanged. Recorded as the PB4 acceptance gate.

---

## 4. OUT OF SCOPE (pressure is cyclical demand-balance — blind to these; they STAY orthogonal)
- **Break-even floor** (`breakEven`, `js/quotecore.js`) — the model-free honesty floor; every estimate is
  BE-floored regardless of which reachability primitive wins. Never a consolidation target.
- **Trajectory / regime / phase** (`regimeDrift`, `phase`, `momVerdict`) — direction-over-DAYS; pressure
  reads demand-balance WITHIN the window. They compose (regime picks the tape; pressure prices within it),
  they do not merge.
- **Buy limits** (`limits.mjs`) — the 4h accumulation cap; a sizing constraint, not a reachability read.
- **Catalyst / event shocks** (`flushSignal`, update-driven moves) — pressure captures the CYCLICAL dip,
  never the event-driven macro low (validated: Soul rune 351, Magic logs 774 outliers sit outside the
  band). Event handling stays the flush/shock machinery's job.
- **reach-as-OBSERVABLE** (`reachValidator`, the touched/reached counts + RC1 recency split) — evidence,
  not a competing price. Stays on every surface.

---

## 5. SCAFFOLDING BUILT IN THIS TASK (non-gated; the retirements/promotions stay F1-gated + attended)
- **RC-S1 — watch held-lot five-way co-log (LANDED — see the commit).** watch-positions held rows now log
  the reachRelief-family `estBuy`/`estSell`/`estConfidence` (via `estimatePair`, `declaredExit` NULLED so
  the scored number is the MODEL's intrinsic ask, not the operator's plan) + the `asym` pair, ALONGSIDE the
  DE3 `depthExit`/`reachable`. Zero new fetch (reuses the in-hand ts1h/ts5m). Inform-only — no rendered
  verdict/price/table/alert changes; a compute failure degrades to no shadow (guarded). This is what makes
  the head-to-head start accruing on the richest surface.
- **RC-S2 — pressure co-log on screen survivors + quote (LANDED — see the commit).** Every screen
  survivor and every quote row now co-logs the pressure-driven `reachable` band off the in-hand 1h
  `windowStats` (zero new fetch), so the head-to-head accrues on the DISCOVERY surfaces too, not just held
  lots. `estSell` (reachRelief) + `asym` already logged there; reach rides `estConfidence`. On a HELD quote
  row (`--positions` / a held item's per-item read) the depth floor is ALSO free (real held qty + the 1h
  series in hand) so `depthExit` co-logs there too — a bare "how's X" read has no held qty → no depth (the
  DE7 fetch-budget rule keeps depth OFF the screen and off bare per-item reads). The three co-logs now share
  ONE reshaper home — `reachableShadow`/`depthExitShadow`/`asymShadow` in `pipeline/lib/suggestlog.mjs` — so
  the watch/screen/quote shadow shapes can't drift (watch's RC-S1 inline reshapers were refactored onto
  them). Inform-only; rendered output byte-identical. **The five-way head-to-head now spans held +
  discovery: complete.**

## 6. HONESTY / ENTANGLEMENTS (rule 4 — surfaced, not forced)
- **n≈0 on everything.** This doc designs the calibration; it claims none. Every promotion is gated on a
  real head-to-head window that does not yet exist. The φ/`PRESSURE_*`/`DEPTH_*` constants stay placeholders.
- **Entanglement (real, not a blocker): `asymPair.highReachAsk` feeds `estSell`.** `asymPair` is NOT purely
  parallel to `estimatePair` — its high-reach ask is one blend candidate for `estSell`. So RC2's merge must
  re-point that blend input to `reachableBand` in the SAME flag, or `estSell` silently retains a
  fixed-quantile leg after `asymPair` is "retired." Named in RC2; it constrains the merge order (blend
  re-point ships WITH the `--asym`/inform re-point, not after).
- **Entanglement (mild): the DE3 `size-relieved` note already depends on `reachRelief`.** DE3 supersedes it
  with the depth read when non-null; RC1's flag completes the removal. The note is the fallback until then —
  consistent with deprecate-then-remove.
- **No entanglement that breaks the premise.** The inventory found no consumer that `reachableBand`/depth
  cannot cover: reachRelief has NO rank/grade/app consumer (small radius); asymPair's only rank consumer is
  the already-off `--asym` experiment (experiment-vs-experiment swap). The consolidation is LESS entangled
  than a heuristic-layer merge usually is — chiefly because reachRelief never earned its way into the
  grade. If a future surface wires reachRelief/asym into `estimateRank` before RC1/RC2 land, STOP and
  re-scope (it would move the blast radius onto `screen.json`).
