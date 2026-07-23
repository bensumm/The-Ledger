# PLAN-ESTIMATOR-HONEST-SELL — the display sell-read redesign

Per-topic working doc (PLANNING.md lifecycle). Designed + Fable-hardened 2026-07-22. Grew out of
PLAN-OSCILLATION-CYCLE's reach-fold investigation.

## Why (the proven bug)

The DISPLAY sell estimator (`estimatePair` → the `Est.sell`/`Net` columns + `read-window-range.mjs`'s
`fold:` line — the number the operator DRILLS on) **haircuts the margin then BE-clamps it**. Because
`netMargin(buy, breakEven(buy)) ≡ +1` for the entire uncapped price range (`breakEven = ceil(buy/0.98)`,
`js/quotecore.js:55-59` — proven empirically 777→17.4M all net +1), **any literal "+1 (BE X)" is 100%-
diagnostic of an over-fold clamped to break-even, never a real market break-even.** The reach-fold is
recency-weighted + phase-BLIND, so it over-folds a real thin edge (Prayer regen: fold says +1, the
phase-aware forward exit says +2%) into a false "no trade" — and the operator SKIPS it. This is the
more expensive error (a mirage gets caught by drilling; an over-folded edge never gets drilled).

**The fix is consistency, not invention.** The RANK estimator (`estimateRank`, `js/estimators/families.mjs:
269,290-300`) already does it RIGHT: `net = netMargin(pair.bid, pair.ask)` (RAW, never folded) × a P(fill)
that carries the reachability (`askReachFactor`). Reachability as a probability multiplier on an honest
margin — the display estimator is the inconsistent outlier that mangles the margin. Align it.

## Scope: CONSOLE/PIPELINE-ONLY. No screen.json, no gate, no APP_VERSION.

`estimatePair`/`estPairCells`/`estConfLean` are consumed only by `quote-items.mjs` /
`screen-flip-niches.mjs` / `read-window-range.mjs` stdout (grep-confirmed — the app/screen.json never
call `estimatePair`; pair.mjs header documents this). The redesign is ADDITIVE (new fields beside the
existing ones), so existing consumers stay byte-identical. No APP_VERSION.

## The target shape — one read, three parts, every surface

Replace the single haircut-then-clamp `estSell` with a three-part sell read, rendered identically everywhere:
1. **Honest margin** — the raw band-edge (or the forward-projected exit level). **NEVER BE-clamped to
   display "+1".** A genuinely sub-BE row shows its real (possibly negative) net + a floor ANNOTATION
   (`recency-fold floored to BE — nothing to price above break-even`), not a number substitution.
2. **P(fill)** beside it — REUSE `askReachFactor` (`js/estimators/reach.mjs`, the exact fn `estimateRank`
   calls at families.mjs:291). Do NOT fork a second reach model. This makes the display match the rank's
   honest pattern (probability, not margin haircut).
3. **"List at X"** — the single actionable price, from the FORWARD projection `driftExitFrom(profile,
   days, ctx, {holdHorizonDays})` → `driftAdjustedExit` (`js/forecast.mjs`), phase-aware + percentile-
   tunable via the already-exposed `AMP_ASK_Q`/`AMP_BID_Q` dial. "Folding done right."

**RETAINED, not deleted, shown SECONDARY:** the recency reach-fold (`reachFoldModel.propose`) rides
alongside labeled `(secondary — recency-weighted, phase-blind)`. Its caution is the CORRECT read for a
confirmed KNIFE (`oscillationVsKnife.knife===true` — no cycle to project forward). Neither read is
crowned by fiat; BOTH ship every pass. `driftAdjustedExit` degrades to a labeled `trend-only` mode on a
knife (not a crash), so "always show both, let the number communicate" — no new detector call site needed.

## Chunks (sequential — the shell must land before the consumers)

- **E1 — `js/estimators/pair.mjs` shell (the honesty fix).** (a) STOP overwriting `estSell` to `be`
  (pair.mjs:183-188) — keep `estSell` honest, carry `estSellFloorBind = beFloored ? be : null` for
  display. (b) Compute `pFill` via `askReachFactor` (reuse). (c) Accept an optional `extra.forward =
  {profile, days, holdHorizonDays}`; when present, compute `dae = driftExitFrom(...)` and return
  `estSellForward`/forward fields (null when absent — degrade, no new fetch). Everything else in the
  shell untouched (it governs the retained reach-fold number).
- **E2 — `js/estimators/cells.mjs` (`estPairCells` + `estConfLean`).** Compound sell cell: `honest ±
  P(fill)% · list at FORWARD (holdHorizonDays, confidence) · recency-fold Y (secondary)`. `beFloored`
  becomes a caution flag on the SECONDARY fold only, never a market fact. `estConfLean`: KEEP `beFloored`
  (F-G continuity), ADD `forwardPeak/forwardTrough/forwardConfidence/holdHorizonDays` (YS2 lean, present-
  only-when-computed) — the F-G join column for the eventual fold-vs-forward-vs-realized retro.
- **E3 — `read-window-range.mjs` `fold:` line (the DRILLED surface — do FIRST after E1).** Three-part
  render; pass `extra.forward = {profile: profMargin, days: scored, holdHorizonDays}` (both already
  computed earlier in the fn — zero new fetch).
- **E4 — `quote-items.mjs` columns.** `estPairCells` change propagates; plumb `extra.forward` from the
  `hourProfile`/`windowStats` this file already computes for its Chunk-5/6 notes (zero new fetch).

## Tests (the reuse/degrade pins)
- `estSell` NEVER overwritten to `be` (a sub-BE row returns the real negative net + a `floorBind` fact —
  no more literal "+1").
- `pFill` byte-identical to `askReachFactor` on identical inputs (the don't-fork pin).
- `extra.forward` absent → byte-identical to today's reach-fold-only output (degrade-safe).
- `extra.forward` present → forward fields match a direct `driftExitFrom` call (delegation, not re-derive).
- `estConfLean` forward fields present/absent per YS2; `beFloored` still logs (F-G continuity, no regression).
- read-window-range fold line's new three-part text + a KNIFE-mode (trend-only forward) fixture renders,
  no crash.

## Honesty (rule 4)
Every forward number carries `holdHorizonDays` + confidence ordinal (never a bare gp figure). Every
reach-fold number labeled secondary/phase-blind. `beFloored` reads as an annotation, never a market fact.
NO "which is right" claim — both ship, labeled, until F-G's realized-fill retro adjudicates.

## Deferred (NOT this plan) — the denoising lever, GATED on F-G

Promoting the forward exit into `estimateRank`'s `net`/`pFill` (reaching the graded board + `screen.json`
for every niche) is what would DENOISE the rank — but it's **Ring 3**, one step beyond the shelved F-I and
the unbuilt Wave-4 (both digest-only). It reorders the published board, and `estimateRank` has NO knife
guard (unlike `amplitudeGate`), so a misclassified knife would inflate the published rank with nothing to
catch it. GATED on F-G proving the forward read out-predicts the recency-P, AND requires a rank-level
knife-fallback (route `net` through `oscillationVsKnife.knife` → fall back to raw `netMargin` on a knife,
templating Chunk-3B's gate-not-substitute pattern). Not near-term.

## Status
| Chunk | State | SHA | Notes |
| --- | --- | --- | --- |
| E1 | LANDED-in-worktree | — | pair.mjs shell — stopped the BE-overwrite (estSell honest); added `estSellFloorBind`, `pFill` (reuses askReachFactor), `estSellForward`/forward fields (driftExitFrom off `extra.forward`, degrade-safe) |
| E2 | LANDED-in-worktree | — | cells.mjs — sell cell: honest number + floor ANNOTATION (not substitution) + `list ~X (~Nd hold, conf)`; P(fill) beside the net; estConfLean KEEPs beFloored + ADDs forward fields (YS2) |
| E3 | LANDED-in-worktree | — | read-window-range `fold:` line — three-part: honest best-case net + P(fill) + `list at X (forward)` + `recency-fold Y (secondary — phase-blind)` + floor caution |
| E4 | LANDED-in-worktree | — | quote-items — `extra.forward` plumbed from the in-hand `prof`/`ast.days`; footer explainer reconciled |
| Consumer audit | LANDED-in-worktree | — | reverted the watch-positions BE floor (honest sub-BE = cut price); fixed the quote-items false `(BE-floored)` label |
| Ring-3 (rank denoise) | DEFERRED — gated on F-G + needs rank knife guard | — | forward exit → estimateRank/screen.json, all niches |

E1–E4 landed as ONE coherent commit (the shell adds fields the consumers render).

**Consumer audit ruling (Fable a4b4d2bb + independent re-verify) — sub-BE is the CUT price, not a bug.**
The E1 commit had floored the two PB4 pressure-exit held-lot surfaces to break-even (`estSellFloorBind ??
estSell`) on the premise "a LIST price must never sit below break-even." That premise is WRONG, and the
codebase already proves it: `momVerdict`'s canonical CUT / CUT-CANDIDATE gate deliberately returns
`listAt: instabuy` BELOW break-even to free stuck capital, and `heldListAt` (`pipeline/lib/emit.mjs`)
passes that sub-BE number through UNFLOORED. So the honest `estSell` is the CORRECT number on a held cut;
flooring it suppresses the damage-control signal. Fix: both surfaces now show the HONEST number —
watch-positions' `heldLa` reverted to bare `estSell` (safe: the note block renders `list @ X · break-even
Y`, so a sub-BE X is self-labeling), and quote-items' stale `(BE-floored)` literal (false once the number
isn't floored) → truthful `(below BE Y — cut/damage-control price, not a profit)`. `cells.mjs` /
`read-window-range.mjs` / the shadow-log consumers were audited CONFIRMED-SOUND (honest number +
annotation, never substitution). Open follow-up (non-blocking): niche-conditioned `holdHorizonDays` (the
forward "list at X" currently always assumes the 1.5d default — renders inline, not deceptive).

Tests: the reuse/degrade/delegation pins in `pipeline/test/estimators.test.mjs` (pFill≡askReachFactor,
forward-absent byte-identical, forward-present delegates to driftExitFrom, estConfLean YS2 + beFloored
continuity, KNIFE trend-only renders); the three BE-clamp tests were rewritten to the honest behavior.
