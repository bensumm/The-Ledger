# PLAN-PIPELINE-COMPOSITION — one file per estimator/probe/gate, a thin layer that picks which run

Untracked planning doc (2026-07-17). Per the fold-out discipline this file folds into
`PLAN.md` when scheduled and is deleted when its last chunk ships. Executor rules =
PLAN.md "Executor rules", verbatim. Cross-referenced from `PLAN-REACH-CALIBRATION.md`
(this reorg is sequenced BEFORE its `safeQuantile` chunk AC3, so the new estimator lands
directly into the new structure).

## Intent

Ben's ask, near-verbatim: if estimators, probes, and gates are three distinct concepts
with existing peers, each should have its own directory under pipeline, and the scripts
that use them should make include/exclude/swap easy — "avoid 'all estimators live in this
file'; instead 'each estimator/probe/gate has its own file, and there is a layer on top
that configures which pieces run', via command-line argument and/or configuration-file
defaults. How close are we?"

This doc is the audit + the answer. Headline: **closer than it looks in two of the three
categories, because the composition LAYER (registries, per-thesis plans, a
one-file-per-module loader) mostly already exists — what's missing is (i) the physical
one-file-per-concept split of two monolith files, (ii) named, swappable price-model
variants in `estimatePair` (today they're boolean if-branches), and (iii) a config-file +
precedence resolver, which does not exist at all.** And one honest negative: the "gates"
category should NOT be split into peer files — its composition already lives at the
flip-niche-spec level, and the gate stack is an ordered pipeline, not a set of peers.

## What was verified (evidence, not theory — all read in full this session)

### Inventory: what each file actually contains

- **Probes are ALREADY the target architecture — the in-repo precedent to copy, not a
  gap.** `pipeline/probes/<name>.mjs` (4 today: dip, froth, decant, anchor), one file per
  probe, discovered by presence (drop in = enabled, delete = gone), `enabled:false`
  soft-off, a stage-keyed loader/runner (`pipeline/lib/probes.mjs`, 226 lines) with an
  empty-passthrough guarantee and a per-module firing log. Nothing to build here; this
  plan's whole job is making the other two categories look like this one.
- **Validators: 6 distinct concepts in ONE 440-line file (`js/validate.mjs`)** — reach,
  floor, trajectory, value-amplitude, limit, dip-posture (~30–60 lines each). BUT the
  composition layer already exists and is genuinely good: a keyed registry
  (`VALIDATORS` + `REGISTRY_ORDER`), and per-thesis include/exclude/mode ALREADY
  declarative — each flip-niche spec carries `validators: [{key, mode:'gate'|'inform',
  window?}]` and `runValidators(ctx, {specs})` runs exactly that plan. Entanglement is
  low: shared status algebra (`worseOf`, `bumpSeverity`, `degrade`) is ~15 lines; each
  validator imports its own analysis module (windowread/termstructure/quotecore) and
  never calls a sibling. A one-file-per-validator split is mechanical.
- **Estimators: the real monolith — `js/estimators.mjs` is 659 lines holding THREE
  distinct sub-concepts:**
  1. *P(fill)/TTF family estimators + the rank composite* (~lines 59–378): pFillIntraday/
     Value/Rising, ttfIntraday/Value/Rising, churnLapUnits, rankScore, estimateRank —
     already registry-shaped (`ESTIMATORS` keyed by family, `estimatorFor(spec)` selected
     by the spec's `estimator` field). Cleanly separable.
  2. *Reach-conditioning helpers* (~lines 109–219): reachRelief, askReachFactor,
     dayHighFrom5m, asymEstimate + their constants. Separable; consumed by both 1 and 3.
  3. *The reconciliation price estimator* (~lines 380–659): entryDoctrine, reachRead,
     `estimatePair` (one ~115-line function), estPairCells, estConfLean. **This is the
     "all estimators live in this file" pain point in its sharpest form:** the sell-top
     model variants are not named pieces — the neutral reach-fold is inline math, the
     pressure-exit trial is a `{pressureExit: true}` boolean option that overrides both
     legs mid-function, and the declared-exit anchor is another branch. A new model
     (safeQuantile) added the same way would be a third boolean threading through the
     same function.
  Entanglement between the three is real but narrow: tiny shared helpers (`num`,
  `clamp01`, `estR`, `reachTok`), and 3 consumes 2 (reachRelief/dayHighFrom5m). No shared
  mutable state anywhere — everything is pure functions + frozen constants.
- **Gates: `pipeline/lib/gatecandidates.mjs` (376 lines) is NOT a set of swappable peers.**
  It is an ordered pipeline — gateCandidates (the pre-fetch stack: two-sided liquidity →
  price window → thin/gp-flow → spec edge → attention floor, as sequenced `continue`s
  that accumulate flags like `thin`/`held` onto the candidate), rankAndSlice (reserve
  ordering), surviveMode (post-fetch doctrine), subFloorFallback (the relax ladder). The
  include/exclude/swap seam ALREADY exists one level up: `FLIP_NICHES[mode].gate`
  routes band-vs-value stacks, `spec.edge` is the per-niche pluggable function,
  `spec.falling`/`spec.confirm` drive surviveMode. Splitting the interior gate steps into
  files would break an order-dependent, replay-golden-pinned stack for no flexibility
  gain — the P1/P4c goldens exist precisely because this code's value is byte-identity.
- **Strategy specs (`js/flip-niches.mjs`, 324 lines) are a peer category that is ALREADY
  DONE:** a declarative registry, selected by `--mode band|churn|scalp|value|all`,
  conformance-tested, with per-spec estimator family, validator plan, gate route, price
  basis, fill shape. It should not be reorganized — it IS the top layer the other
  categories plug into. (One spec ≈ 10 lines + a ~15-line edge function; splitting four
  specs into four files would be ceremony, not flexibility.)

### The existing include/exclude/swap flags — coherent pattern or bespoke branches?

Checked every flag named in the ask (`screen-flip-niches.mjs`, `quote-items.mjs`,
`watch-positions.mjs`):

- Parsing IS shared: one `parseArgs` (`pipeline/lib/cli.mjs`) used everywhere.
- Everything after parsing is bespoke: `--pressure-exit` → a `PRESSURE_EXIT` const →
  a boolean options-bag param into `estimatePair(..., {pressureExit: true})` (duplicated
  at 3 call sites across 3 scripts, each with its own trial banner string); `--asym` →
  a repriced row CLONE + sort flip inline in the screen loop; `--vol-source` → its own
  validated two-value enum with its own error message; `--phase-rescue` → an opts flag
  threaded into surviveMode. The `--publish`-refusal guard for non-neutral estimators is
  hand-copied per flag (`--asym` and `--pressure-exit` each have their own refuse block).
- **No configuration file exists anywhere in the pipeline** (grepped: no config.json /
  rc-file / defaults file is read by any command). Every default is a hardcoded fallback
  in each script's `A.<flag> != null ? … : <default>` line; `DEFAULT_THRESHOLDS` in
  gatecandidates.mjs is an import-caller/fixture fallback, not a user config.

So: the *vocabulary* of swap-via-flag exists and Ben already uses it; the *mechanism* is
N bespoke if-branches. Roughly: registries/plans ~exist (probes 100%, validators ~80%,
estimator families ~80%, niches 100%); named-variant price models 0%; config-file +
precedence resolution 0%.

### Blast radius of a physical split (the specific risk question)

- **Pipeline call sites are already behind a narrow seam:** every pipeline consumer
  imports from `pipeline/lib/estimators.mjs`, which is a 6-line
  `export * from '../../js/estimators.mjs'` shim. Splitting js/estimators.mjs into a
  directory while keeping `js/estimators.mjs` as a barrel (re-exporting the split files)
  means ZERO pipeline call-site changes.
- **The app imports it too:** `js/market.js` imports `estimateRank` from
  `./estimators.mjs` (AP4 app↔console parity). The barrel keeps that import path intact,
  but the split still ships new browser-fetched files under `js/` — it IS a deployed-app
  change (no-build ES modules), so it takes an `APP_VERSION` bump and the README
  "Map of the repo" ripple, even though behavior is byte-identical.
- **Safety nets already in CI:** `check-imports.mjs` statically verifies every pipeline
  entrypoint's imports resolve (catches the classic split mistake — a missing re-export);
  `estimators.test.mjs` pins reachRelief/estimatePair behavior incl. relief-0
  byte-identity; the P1 replay goldens pin the gate stack; the smoke test catches an app
  module-graph break.
- **The one genuinely delicate spot:** `estimatePair`'s internal ORDERING contract —
  relief fold → pressure override → anchor nudge → ordering clamps → BE floor LAST.
  Extracting the sell-top variants into named models must preserve that spine (the models
  replace only the "propose a sell-top / entry" step; the clamps + BE floor stay in the
  shared shell). This is design work, not a mechanical move — it's PC3, the only
  non-mechanical chunk.

## The honesty core (process rule 4 — read before any chunk)

1. **Two of three categories mostly exist.** Presenting this as "build a composition
   layer" would overstate it: probes are done, validators/estimator-families have
   registries + per-thesis selection already. The genuinely new work is the estimatePair
   model registry (PC3) and the config resolver (PC1). The file splits (PC2/PC4) are
   mechanical relocations behind existing seams.
2. **Gates are excluded on the merits, not deferred.** The gate stack's flexibility seam
   is the flip-niche spec (`gate`/`edge`/`falling`/`validators`) and it already works —
   a `pipeline/lib/gates/` directory would trade byte-identity-pinned, order-dependent
   code for a false symmetry. If a future need arises for a swappable gate STEP, the spec
   field is where it registers (the P4c precedent: a new niche registers a spec, it
   doesn't edit gatecandidates).
3. **No framework.** The "layer on top" is: a keyed plain-object registry per directory
   (the ESTIMATORS/VALIDATORS pattern that already exists), plus a ~40-line resolver
   (flag > config file > hardcoded default). No plugin system, no DI, no dynamic
   discovery for js/ modules (the probe loader's readdir trick is fine for node-only
   probes; app-importable js/ files must use static imports — the browser has no readdir).
4. **The split must be a pure move, proven by existing tests.** Same discipline as P1/P4c:
   goldens + estimators.test.mjs + check-imports pass UNCHANGED, or the chunk is wrong.
   Any behavior delta is a defect, not an opportunistic improvement.
5. **This reorg does not gate the calibration study.** PLAN-REACH-CALIBRATION's AC1/AC2
   (read-only analysis of our own fills) touches none of these files and could run first
   or in parallel. The reorg is sequenced ahead of it on Ben's call + because it's cheap
   and makes AC3's landing clean — not because AC1 needs it. Only AC3/AC4b (the
   safeQuantile model + its estimatePair consumption) genuinely depend on this landing
   first.

## Architecture (sketch)

Target layout — matching existing conventions (`js/` for app-shared pure logic,
`pipeline/lib/` for node-only, `pipeline/probes/` untouched):

```
js/estimators.mjs                 → becomes the BARREL (re-exports everything below;
                                    app + pipeline-shim import paths unchanged)
js/estimators/families.mjs        pFill*/ttf*/churnLapUnits + ESTIMATORS registry,
                                  rankScore, estimateRank, quotedPair, fmtTtf
js/estimators/reach.mjs           reachRelief, askReachFactor, dayHighFrom5m,
                                  asymEstimate + their constants
js/estimators/pair.mjs            estimatePair shell (ordering spine: models → nudge →
                                  clamps → BE floor) + entryDoctrine + reachRead
js/estimators/sell-models.mjs     SELL_TOP_MODELS = { 'reach-fold': …, 'pressure': …,
                                  (later) 'safe-quantile': … } — each model one small
                                  named function (proposed sell-top + evidence note);
                                  estimatePair takes `sellModel: '<name>'` instead of
                                  the boolean pressureExit (kept as a synonym)
js/estimators/cells.mjs           estPairCells, estConfLean (render/shadow projections)

js/validate.mjs                   → registry + runner + status algebra ONLY
js/validators/<key>.mjs           one file per validator (reach, floor, trajectory,
                                  value-amplitude, limit, dip-posture)

pipeline/probes/                  unchanged (already the pattern)
pipeline/lib/gatecandidates.mjs   unchanged (composition stays at the spec level)

pipeline/lib/compose.mjs          the resolver: resolve(category, {flag, config, fallback})
                                  → { active: name, shadow: [names] } with precedence
                                  CLI flag > pipeline/pipeline-config.json > hardcoded
                                  default. ACTIVE-PLUS-SHADOW, not exclusive-or (Ben's
                                  refinement — the pressure-exit precedent): the active
                                  model feeds the displayed/published number; every
                                  shadow model still RUNS each pass and logs its result
                                  to suggestions.jsonl (the existing estConfLean/asym/
                                  pressure shadow-field shape). This return-shape room
                                  is the whole refinement — no orchestration layer, the
                                  caller just loops the shadow names through the same
                                  registry call it makes for the active one. Plus ONE
                                  shared refusePublishIfNonNeutral(selection) replacing
                                  the per-flag copies
pipeline/pipeline-config.json     OPTIONAL, absent by default (absent ⇒ every current
                                  default stands byte-identically); e.g.
                                  { "sellModel": "reach-fold", "volSource": "rolling",
                                    "modes": ["band","churn","value"] }
```

Selection surface after the reorg (all defaults unchanged):
`--est-sell reach-fold|pressure|safe-quantile` (with `--pressure-exit` as legacy sugar),
`--mode …` (exists), `--vol-source …` (exists, moves onto the resolver), per-thesis
validator plans (exist, in the spec). One registry object per directory; a script asks
the resolver, the resolver reads flag-then-config-then-default, the registry hands back
the named function. That is the whole layer.

## Chunks (not yet scheduled — proposed breakdown)

### PC1 — `compose.mjs` resolver + optional config file (~half day) — **DONE (2026-07-17)**
Shipped `pipeline/lib/compose.mjs` (`resolve()` → `{active, shadow:[]}`, `loadPipelineConfig()`,
`refusePublishIfNonNeutral()`), wired into `screen-flip-niches.mjs` (mode/vol-source/asym/phase-rescue/
pressure-exit), `quote-items.mjs` + `watch-positions.mjs` (pressure-exit). The two inline `--asym`/
`--pressure-exit` publish-refusal copies in `screen-flip-niches.mjs` were consolidated into the ONE shared
guard (same messages, same order, same exit/downgrade semantics). `pipeline/pipeline-config.json` stays
OPTIONAL/absent — absence is byte-identical to the pre-PC1 defaults (pinned by the full suite staying green
+ the new `compose.test.mjs` asserting `resolve()` == `flag ?? fallback` with no config). No `APP_VERSION`
bump (pipeline-only). README "Map of the repo" carries the `compose.mjs` + `pipeline-config.json` entries.
Skill vocabulary + `docs/ARCHITECTURE.md` composition-invariant pointer deferred to PC3 per the docs pass
below (PC1 changes no default behavior, so no skill statement went stale). Left as the pre-PC1 spec:
The precedence resolver + the ONE publish-refusal guard, wired into
`screen-flip-niches.mjs`/`quote-items.mjs`/`watch-positions.mjs` for the flags that
already exist (`vol-source`, `pressure-exit`, `asym`, `phase-rescue`, `mode`). The
return shape is `{ active, shadow: [] }` from day one (see the architecture sketch) —
active-plus-shadow, never exclusive-or — even though the shadow list is empty until PC3
gives it members. Absent config file ⇒ byte-identical behavior (pinned by running the
existing goldens/tests).

### PC2 — split `js/estimators.mjs` behind the barrel (mechanical, ~half day)
Pure move into `js/estimators/{families,reach,pair,cells}.mjs`; `js/estimators.mjs`
becomes the barrel. Zero call-site changes (pipeline shim + app import path unchanged);
`estimators.test.mjs` + check-imports + smoke pass unchanged. APP_VERSION bump (deployed
js/ file set changes) + README map update.

### PC3 — the sell-model registry (the one design chunk, ~a day)
Extract the sell-top proposal step of `estimatePair` into named `SELL_TOP_MODELS`
('reach-fold' = today's neutral fold verbatim; 'pressure' = the PB4 trial verbatim),
selected via PC1's resolver (`--est-sell`, `--pressure-exit` as synonym). The shell keeps
the ordering spine (declared-exit anchor, nudge, clamps, BE floor) so models can't skip
the honesty floors.
**Active-plus-shadow, not a strict swap (Ben's refinement — this codifies what the
pressure-exit precedent already does):** today the neutral estimate is computed AND
shadow-logged on every run even when `--pressure-exit` drives the display, and the
pressure read is computed alongside on the surfaces that carry it — the flag only picks
which one is ACTIVE (displayed table / screen.json). PC3 keeps that contract general:
every registered model in the resolver's `shadow` list runs each pass and logs its
proposed sell-top to `suggestions.jsonl` (same lean per-model field shape as the existing
`asym`/`estConfLean`/pressure shadows); only the `active` model's number reaches the
displayed cells or a publish. No orchestration system — one loop over the shadow names,
calling the same registry functions. **This is what makes PLAN-REACH-CALIBRATION's AC1
cross-model calibration possible at all:** `safe-quantile.mjs` (AC3 there) ships as a
registered SHADOW first, accruing side-by-side rows against 'reach-fold'/'pressure' on
the same real outcomes, and graduates to `active` only on a Ben ruling after the retro —
without a bespoke one-off logging mechanism per model, which is exactly the scaffolding
this reorg exists to eliminate.
**This is `safeQuantile`'s landing slot:** PLAN-REACH-CALIBRATION AC3
then ships as `js/estimators/safe-quantile.mjs` + one registry line, not another boolean.
Gate: existing estimatePair tests byte-identical under 'reach-fold' active with today's
shadow set.

**Pickup item carried from PC1 (Ben, not yet executed):** PC1's resolver only handles a
single-value `mode` selection (`--mode band|churn|scalp|value|all`, one active string). It does
NOT yet support the `pipeline-config.json` `"modes": ["band","churn","value"]` ARRAY shape shown
in the config example above, which is what `screen-flip-niches.mjs --mode all`'s niche-expansion
set (currently hardcoded to band+churn+value) would need to become config-driven. PC3 must extend
`compose.mjs`/`screen-flip-niches.mjs` to resolve that array — not just the scalar `mode` — before
PC3 is considered complete.

### PC4 — split `js/validate.mjs` into `js/validators/` (mechanical, opportunistic)
One file per validator key; validate.mjs keeps the registry/runner/status algebra.
Independent of PC1–PC3 — can ride along with any chunk that touches a validator, or land
alone. No behavior change; conformance + validator tests unchanged.

### Explicitly NOT proposed
A `pipeline/lib/gates/` split (honesty item 2); splitting `js/flip-niches.mjs`; any
dynamic discovery/plugin loading for app-importable js/ modules; touching the probe
system.

## Docs / registry pass (rule 8, per chunk)

- `README.md` "Map of the repo": entries for `js/estimators/` + `js/validators/`
  directories, `pipeline/lib/compose.mjs`, and `pipeline/pipeline-config.json` at
  creation; the js/estimators.mjs + js/validate.mjs entries updated to "barrel/registry"
  in the same commit.
- `docs/ARCHITECTURE.md`: the composition rule as an invariant pointer — "estimator/
  validator variants register in the directory registry + resolver; a boolean
  mode-flag threading through a shared function is the anti-pattern this replaced".
- Module headers own the full spec (docs-small memory): compose.mjs documents the
  precedence order; sell-models.mjs documents the model contract + the shell's
  non-skippable floors.
- `CLAUDE.md`: no new section — the ask→command table is unchanged; the `--est-sell`
  vocabulary rides in `/scan`/`/positions` SKILL.md bumps when PC3 lands.
- Reconciliation greps when PC3 lands: every doc line describing `--pressure-exit` as
  "the flag that overrides both legs" (quote-items/watch headers, docs/MARKET-ANALYSIS.md)
  updated to the named-model framing in place, not appended beside.
