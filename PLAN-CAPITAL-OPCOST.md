# PLAN-CAPITAL-OPCOST — inform-only opportunity-cost read on held lots

**Status:** SHELVED (Ben 2026-07-14) — gated on an accurate pricing model, do NOT build yet.
Was: proposed (arch review 2026-07-14, the positions-side mirror of `PLAN-CAPITAL-THROUGHPUT.md`).

**Why shelved (Ben's ruling):** the opportunity-cost hurdle inherently recommends *"cut this, you'd
earn more elsewhere"* — but "elsewhere earns more" is the LEAST-trustworthy output of the model right
now (placeholder estimates, n≈0). A cut-to-redeploy built on that risks COMPOUNDING our own mistake:
we usually got into a below-hurdle lot from bad timing / a bad rec, and the same shaky model then tells
us to book the loss and chase another of its guesses. The right lens for a stuck lot is NOT opportunity
cost but **damage control** — *"this is a bomb we're holding; here's the least-cost, most-likely exit"*
— which is self-contained (needs only good EXIT pricing for what we already own, no faith in a phantom
alternative) and is ALREADY served by the sell-velocity step-down, the window-clear back-solve, and the
break-even floor. Opportunity cost is comparative + forward and needs a trustworthy cross-lane earning
model; exit planning is self-contained. Build the comparison only once the pricing model earns that
trust. If ever built, FRAME it as least-cost exit planning, never a redeploy-hurdle cut. See memory
`opcost-cut-needs-trusted-model`.

When un-shelved: inform-only + shadow-logged, thresholds NAMED PLACEHOLDERS (n≈0), promotion into any
verdict F1-gated, **no `APP_VERSION` bump as scoped** (determination below).

## Problem

The discovery path is now capital-aware (`PLAN-CAPITAL-THROUGHPUT` — `expGpDay` caps the per-window
tranche by `deployablePool`). Held lots are deliberately floor-EXEMPT (you always review what you
hold), but the capital CONCEPT has a positions-side mirror that today exists only QUALITATIVELY:
**is the capital a lot PARKS earning its keep vs redeploying it?** The judgment lives in prose —
the sell-velocity step-down (`/positions` SKILL.md :94), the cut-and-rebid friction bar (:203–214,
encoded as `rebidBar`/`rebidAdvice`, `js/quotecore.js:752–804`), the
`opportunity-cost-can-beat-patient-hold` memory — with NO number. Meanwhile `watch.mjs` already
derives the three-tier capital (`loadDerivedCash`, watch.mjs:943) but uses it only for the SUMMARY
footer, never as a per-lot input; `quote.mjs --positions` derives no capital at all.

The missing number: *"this lot parks ~Y gp earning ~X gp/day at its own clear price; the
redeployment hurdle on that capital is ~Z gp/day."*

## Design

### D1 — the numerator: the lot's own clear economics through the EXISTING estimator exports

`lotGpDay` = the lot's remaining after-tax edge per day of capital tied, at the price the verdict
ALREADY emits — never a new price:

```
listAt     = the verdict's own list-at (mv.listAt / the heldVerdictCompact fallback chain,
             context.mjs:398–402 — the BE-floored band-top/instabuy level both surfaces print)
netPerUnit = (listAt − tax(listAt)) − avgCost          # shared tax(); bond-aware via row.bond/guide
pFill      = pFillIntraday(ctx at ask=listAt)          # js/estimators.mjs:88 — the family entry-fill
ttf        = ttfIntraday(ctx)                          # js/estimators.mjs:236 — volume-velocity prior
lotGpDay   = rankScore({ net: netPerUnit × qty, pFill, ttfSec: ttf.value })   # :312 — the ONE metric
lotValue   = qty × avgCost                             # already on ctx.position (context.mjs:230)
```

No forked rank math: `rankScore`/`ttfIntraday`/`pFillIntraday` are existing `js/estimators.mjs`
exports (node reaches them via the AP4 shim `pipeline/lib/estimators.mjs`). This is deliberately
NOT `estimateRank(spec, row)` verbatim — that prices a FRESH flip at the thesis's quoted pair
(optBuy→optSell); a held lot's entry cost is sunk at `avgCost` and its exit is the verdict's
`listAt`, so the pair differs while every component function is shared. No askReach discount leg
(that's a discovery grade/rank concern, PLAN-GRADE-REACH; the lot read stays the simple family P —
folding reach in is an F1 follow-up once the shadow data says it matters).

Honesty: an underwater lot yields `lotGpDay ≤ 0` — rendered as "earning ~nothing at the current
clear", which IS the opportunity-cost signal, but the line never says CUT (momVerdict owns cuts;
this is the `⤴ ask headroom` posture, byte-for-byte).

### D2 — the benchmark/hurdle: pro-rate the EXISTING 500k attention floor; no discovery fetch

**Chosen: derived hurdle, zero new doctrine.** Discovery's capital question is "a lane given the
whole pool must net ≥ `MIN_GPD` (500k, gatecandidates.mjs:58)". The positions mirror pro-rates that
same floor to the lot's parked slice:

```
hurdleGpDay = MIN_GPD × lotValue ÷ (deployablePool + lotValue)
```

(`deployablePool + lotValue` = the pool a redeployment would command after clearing the lot.) So a
lot parking 17% of redeployable capital must earn ~17% of the attention floor to justify the park.
Reuses the ONE existing capital anchor (`deployablePool`, `lib/cashderive.mjs`) + the ONE existing
throughput floor — no second capital model to drift (the PLAN-CAPITAL-THROUGHPUT open-question
about sharing one helper applies here too). Unanchored cash (`dc.known === false`) → hurdle null →
the line prints the earn side only + "no hurdle — set a cash anchor (cash.mjs)". A conservative
(marketRef-less) derivation only SHRINKS the pool → hurdle rises → more prompts, never fewer — the
safe direction.

**Rejected — (b) live comparison vs the current top discovery pick:** `quote.mjs --positions` /
`watch.mjs` do not fetch the discovery universe by design; plumbing `screen.json`/a screen run in
couples the positions read to a possibly-hours-stale scan (dishonest comparison) or forces the
bulk fetch onto every watch tick (against the zero/cheap-fetch grain). Worse, "top pick earns 3×
this lot" reads as an instruction — the exact disguised-gate drift this feature must not have.
**Rejected as a live input — (c) realized lane history from fills.json:** per-lane n is tiny
(the ~116-lot concentration caveat, `capitalutil.mjs` header); realized-vs-parked is the RETRO's
job — the `opCost` shadow field (D5) gives `analyze.mjs` exactly that join.

### D3 — module home: `pipeline/lib/opcost.mjs` (node-only); render seam beside the V6 advisories

Consumers are `quote.mjs --positions` + `watch.mjs` only — both node. So the pure read
`lotOpportunityCost({ qty, avgCost, listAt, row, deployablePool, minGpd })` →
`{ lotGpDay, lotValue, hurdleGpDay, ratio, pFill, ttfSec, basis }` lives in a new
**`pipeline/lib/opcost.mjs`** (precedents: `capitalutil.mjs`, `recovery.mjs` — pure, output-only,
fixture-tested, never a verdict input). NOT `js/quotecore.js` (no app consumer; don't grow the
app-imported blast radius for a positions-only read) and NOT `context.mjs` (that's the chain +
renderer home; the math goes in its own module like every other advisory, with at most a thin
`opCostLine()` formatter in opcost.mjs itself). It imports `rankScore`/`pFillIntraday`/
`ttfIntraday` from the estimators shim and `tax` from `js/format.js` — imports of app modules are
free; only EDITS to them ripple.

### D4 — surfacing: a sibling inform line, relevance-gated like the V6 recovery-read

Computed on EVERY held lot on both surfaces; PRINTED only when decision-relevant (the
`recoveryTrigger` discipline, watch.mjs:787–795 — computed always, surfaced when it matters), so
a healthy earning lot doesn't add a line per pass (PLAN-VERDICT-NOISE grain). Surface when
`lotGpDay < hurdleGpDay`, or `lotGpDay ≤ 0`, or the verdict is already CUT-family/LIST-TO-CLEAR
(where it quantifies the freed-capital case the rebid advisory argues qualitatively):

```
⇄ opportunity cost: parks ~12.9m (×4 @ 3.22m) earning ~+95k/d at clear 3.35m (P~0.6 · ttf ~1.2d)
  · hurdle ~110k/d (500k floor pro-rated to ~17% of redeployable) — BELOW hurdle (placeholder, n≈0)
```

- **`quote.mjs --positions`:** a grouped tail section beside the Rebid advisory
  (quote.mjs:418–422 pattern): `Opportunity cost (capital parked vs redeploy hurdle — support,
  never a verdict):`. Needs one `loadDerivedCash()` call added (file-read only — fills/offers/
  anchor; ZERO fetch; marketRef omitted → conservative).
- **`watch.mjs`:** a new optional `opCost` field on `heldNoteBlock` (`pipeline/lib/emit.mjs:51`),
  nested AFTER the guaranteed V5 emit-contract fields exactly like `recovery`/`path` — absent →
  byte-identical block. Compute the derived cash ONCE per pass (hoist the existing summary-time
  `loadDerivedCash` at watch.mjs:943 above the held loop and reuse it for both the per-lot hurdle
  and the footer — same conservative direction if the bid marketRef isn't built yet at that point,
  or build `bidMarketRef` first; either is fetch-free).

**Never a gate.** It is wired into: stdout lines + the shadow field. It is NOT wired into:
`momVerdict`, `heldDisplay`/`verdictPersistence`, `convictionGate`, `offerVerdict`, `heldAlert`/
any alert class, or any drop/hide/grade path — a held lot renders identically in the table and
headline with or without this line. The renderer changes are additive-null (emit.mjs optional
field; a new quote.mjs section), so existing fixtures pin the absence path.

### D5 — shadow field + F1

A lean `opCost` object rides `suggestions.jsonl` via `suggestionEntry` (the YS2 absent-field
pattern, `suggestlog.mjs:218` — callers that don't supply it log a byte-identical shape):
`{ lotGpDay, lotValue, hurdleGpDay, pFill, ttfSec }`, logged on held rows from both surfaces
whether or not the line printed (logging wider than surfacing, the DL2 precedent). `analyze.mjs`
gains a §-join: did below-hurdle lots in fact resolve slower/worse than above-hurdle ones (join to
realized sell fills)? All constants (`OPCOST_*` surfacing thresholds; the pro-rata hurdle form
itself) are NAMED PLACEHOLDERS (rule 4, n≈0). Promotion — hurdle into any verdict/gate, reach into
the P leg, calibrated thresholds — is F1's, pre-registered here, NOT shipped.

## APP_VERSION determination

**No bump.** New module `pipeline/lib/opcost.mjs` + edits to `quote.mjs`, `watch.mjs`,
`lib/emit.mjs`, `lib/suggestlog.mjs` — ALL node-only (README ripple map). `js/estimators.mjs`,
`js/quotecore.js`, `js/format.js` are imported, not modified. No `screen.json`/app surface touched.
Rule 5's "pipeline-only stdout tweaks" class; precedents: `capitalutil.mjs` (YV1), `recovery.mjs`
(V6), the rebid advisory (COD-3).

## Rollout

1. `pipeline/lib/opcost.mjs` + `opcost.test.mjs` fixtures: profitable lot above/below hurdle,
   underwater lot (negative gp/day), null pool (hurdle degrades), bond lot, missing listAt.
2. Wire `quote.mjs --positions` (new section + `loadDerivedCash`) and `watch.mjs` (hoist dc,
   `heldNoteBlock` `opCost` field); relevance gate per D4.
3. `opCost` lean field on `suggestionEntry` + logged from both surfaces.
4. Docs pass (rule 8, same commit): MONITORING.md (the advisory joins the V6 family list + "What
   each tick surfaces"); `/positions` SKILL.md pointer (see fold below; `version:` bump —
   skills-only rule); README inventory entries (opcost.mjs, the `opCost` field); CLAUDE.md one-line
   pointer under the quote.mjs script-facts bullet.
5. Accrue → `analyze.mjs` join → F1 owns calibration/promotion.

## Rule-8 fold — the number is the COMPANION of the existing judgment, not a second home

- **`/positions` SKILL.md**: the sell-velocity step-down (:94) and friction-bar (:203) sections
  each gain one sentence citing the printed `⇄ opportunity cost` line as the quantitative side of
  their "free the capital" argument — POINT, don't restate the formula (the doc home is the
  opcost.mjs header, like `rebidBar`'s).
- **Memory `opportunity-cost-can-beat-patient-hold`**: already a pointer to the gate tree +
  `/positions`; after shipping, its judgment has a printed number — note that in the pointer, keep
  the memory (the judgment "clear at the instabuy to free capital" is still Ben's call; the line
  only prices it).
- **`rebidAdvice`'s knife branch** ("clear and redeploy the freed capital", quotecore.js:795) and
  the V6 `freedCapital` prompt (watch.mjs:725–729) are the POST-cut half of the same concept; this
  read is the PRE-cut half. No text changes needed there — MONITORING.md's advisory list names the
  three as one family so a future agent doesn't build a fourth.
- **PLAN-CAPITAL-THROUGHPUT.md** cross-link: its "share ONE capital helper" open question now has
  a third consumer (screen floor · value multiplier · opcost hurdle) — noted there when this ships.

## Open questions

- Hurdle denominator: `deployablePool + lotValue` (chosen — the pool a clear would command) vs the
  whole `liquidCapital` vs total capital incl. all working exposure. The chosen form double-prompts
  when MANY lots are parked (each sees a small pool → high hurdle) — arguably correct (capital is
  genuinely scarce then), but check against a real multi-lot book before trusting the gating
  threshold.
- Per-pass noise on watch cadence: is the D4 relevance gate enough, or does the printed line want
  the VN-1 persistence treatment (arm-then-confirm before "BELOW hurdle" appears)? Start ungated —
  it's a nested note, not a headline/alert — and let the verdict-noise retro decide.
- Should churn-lane holds (soul rune etc.) use lap economics (`churnLapUnits`) instead of the
  single-clear read? The single-clear number UNDER-states a recycling lane's earn. Defer: the
  shadow field logs `ttfSec`/`pFill` so F1 can measure the understatement before adding a branch.
- `quote <item>` (non-positions) on a held id: it already anchors Est. sell to a declared exit —
  should it print the opcost line too? Lean no (the positions surfaces are the review seam); revisit
  if Ben asks for it on the per-item read.
