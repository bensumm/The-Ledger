# ARCHITECTURE — what The Coffer is, and the rules that keep it coherent

This is the **general-rules** layer: the load-bearing structure of the system and the invariants that
must hold, in ONE place. It exists because the failure mode of this repo is *fragmentation* — logic
and intent scattered across files with no single home stating what the system is, so a dead export or
a stale convention can sit for weeks until someone digs to reconstruct the "why" (the 2026-07-14
audit). This doc is the anti-fragmentation index.

It is **not** the file inventory (that's `README.md` "Map of the repo"), the change log (`CHANGELOG.md`),
the term lookup (`docs/GLOSSARY.md` — plain-English definitions of the vocabulary + the codename
dictionary), the narrative history (`docs/LORE.md`), or the agent workflow (`.claude/skills/*`). It is
the durable "how this is organized and why" that those all assume.

## How to read this doc (and how it stays in sync)

Every claim here is one of two kinds, and they are labelled:

- **🔒 ENFORCED** — a mechanically-checkable rule that a **named CI guard** fails on. The guard is the
  source of truth; this doc points at it. If the rule is violated, CI goes red — the doc cannot silently
  drift from reality for these.
- **⚖️ JUDGMENT** — a principle or doctrine that **cannot** be machine-verified (it's about taste, honesty,
  or design intent). Kept honest by CLAUDE.md **process rule 8** (reconcile docs in the same change that
  touches them) + the wave-start drift scan. These *can* drift; treat them as guidance, not gospel, and
  fix them when you notice.

**The sync contract for this file itself:** every module/guard/path this doc names in `code font` must
resolve on disk — enforced by **`archlint`** (🔒, status below). So this doc can't name a file that got
renamed or deleted without CI catching it — which matters most during the directory rename. Beyond that,
a mechanical claim that has no guard yet is marked *(proposed)* — do not read it as enforced until its
guard ships.

---

## The system in brief

**The Coffer** is an OSRS Grand Exchange flipping tool with **no build step, no framework, no bundler** —
the files deploy to GitHub Pages exactly as they sit on disk. Two surfaces share one core:

- **The browser app** — `index.html` (markup) + `styles.css` + ES modules under `js/`. Entry is
  `js/main.js`.
- **The Node pipeline** — CLIs in `pipeline/` (screen/quote/watch/…) with libraries in `pipeline/lib/`.
  It closes the loop between suggestions and real fills (`fills.json` → `positions.json`).

The two **must compute the same numbers the same way**. They do, because the load-bearing math lives in
**shared pure modules** both import — the single place the "same number computed two ways" bug is
structurally prevented.

---

## 🔒 Enforced invariants

| # | Invariant | Guard (source of truth) | What fails CI |
| --- | --- | --- | --- |
| E1 | Every pipeline entrypoint's imports resolve against real module exports | `pipeline/ci/check-imports.mjs` | an `import { x }` of a name a module doesn't export |
| E2 | No export is kept alive only by its own test (no vestigial "kept-for-future" code) | `pipeline/ci/check-dead-exports.mjs` (+ `.test.mjs`) | an export with no non-test consumer and no `@test-only`/`@provisional-api` marker |
| E3 | Docs carry no superseded terms; no single-source phrase is duplicated across the CLAUDE.md⇆README axis | `pipeline/ci/lint-docs.mjs` (+ `.test.mjs`) | a denylisted term (e.g. a deleted flip-niche as "live") or a duplicated invariant |
| E4 | Every SKILL.md rule-block is tagged (encoded-vs-judgment disposition) | `pipeline/ci/lint-skills.mjs` | an untagged rule block |
| E5 | The browser app loads and paints with all external network stubbed | `pipeline/ci/smoke-test.mjs` (headless chromium) | any page/console error or empty pane |
| E6 | The screen funnel is behaviour-stable across refactors | replay goldens (`pipeline/test/replay.test.mjs`, `@test-only` harness) | a gate/rank/render change that moves a pinned archetype |
| E7 | Every module/guard/path **this doc** names resolves on disk | `pipeline/ci/lint-arch.mjs` (+ `pipeline/test/lint-arch.test.mjs`) | a `code-font` file path in ARCHITECTURE.md that doesn't exist |
| E8 | Tax/break-even math has exactly ONE home | *(proposed — a `no-tax-math-outside-quotecore/money-math` check)* | a `breakEven`/`netMargin`/`maxBuyForExit` defined outside `js/quotecore.js`/`js/money-math.js` |
| E9 | The app-imported module set is known and acknowledged (APP_VERSION blast radius) | *(proposed — the RC-C app-import manifest test, ships with the directory hierarchy)* | a new app import of a shared module without updating the manifest |

E8–E9 are *proposed*: their rule is real but the guard isn't built yet. Until then they're ⚖️ judgment.

---

## The one-home rule (⚖️, partially E8)

A concept has exactly **one definition home**; everywhere else imports it. This is the single most
important structural rule — it's what prevents the app and pipeline from diverging. The load-bearing homes:

| Concept | Home | Notes |
| --- | --- | --- |
| Tax / break-even / bond math | `js/quotecore.js` (`breakEven`, `maxBuyForExit`) + `js/money-math.js` (`netMargin`, `bondFee`, `tax`) | the ONE tax home (quotecore = derived, money-math = primitives; `js/money-format.js` is display-only). *(E8 proposed)* |
| Quote computation | `js/quotecore.js` (`computeQuote`) | the app + `quote-items.mjs`/`screen-flip-niches.mjs` all call it |
| Band/window/diurnal math | `js/windowread.mjs` (`windowStats`, `robustBand` via re-export, `hourProfile`, `windowClear`, `asymPair`) | the pure window-range math; `robustBand` itself lives in `quotecore.js` |
| Verdict rendering (held lots) | `pipeline/lib/item-context.mjs` (`renderHeldVerdict`) | ended the quote↔watch verdict fork |
| Flip-niches (screen strategies) | `js/flip-niches.mjs` (`FLIP_NICHE_LIST`) | declarative specs; consumers look up `FLIP_NICHES[mode]` |
| Held-item strategies | `js/held-item-strategy.mjs` (`enumeratePaths`/`weighPaths`) | "compare strategies" for a held lot (a `path` = a held-item strategy) |
| Validators | `js/validate.mjs` | pure `(ctx) → {status, reason, evidence}` |
| Rank / grade | `js/estimators.mjs` (`estimateRank`) + `js/rating.mjs` (`rateItem`) | `pipeline/lib/estimators.mjs`/`rating.mjs` are one-line re-export SHIMS, not forks |
| Sync-before-read invocation (SY1) | `pipeline/lib/sync-invoke.mjs` (`runLocalSync`) | `screen-flip-niches.mjs`, `quote-items.mjs`, `watch-positions.mjs` each call it once (AR1 — was copy-pasted byte-for-byte, with a hairline regex divergence, across all three) |
| Fetch-pool admission (screen) | `pipeline/lib/admission.mjs` (`pickFetchPool`, default) / `pipeline/lib/gatecandidates.mjs` (`rankAndSlice`, `--admission legacy` rollback) | `screen-flip-niches.mjs`. AR2 honesty note: `pickFetchPool`'s exploration reserve is `Date.now()`-bucketed (deliberately left non-deterministic), so a survivor admitted purely on this pass's rotation carries `via:'explore'` and the screen table marks it 🎲 — a lottery slot is never rendered as a ranked-in pick. Inform-only; never gates/ranks/grades. |

A second implementation of any of these anywhere is drift — call the home, don't re-derive.

## The shared-module / blast-radius model (⚖️, → E9)

The `.js` = app-served / `.mjs` = shared convention **no longer signals blast radius** (audit finding N3),
so know it explicitly. An edit to an **app-imported** module is an APP change (bump `APP_VERSION` in
`js/state.js`, per process rule 5); an edit to a **node-only** module is not.

- **App-imported shared modules** (reachable from `js/main.js` → `market.js`/`trends.js`/…):
  `js/quotecore.js`, `js/money-math.js`, `js/money-format.js`, `js/estimators.mjs`, `js/rating.mjs`, `js/windowread.mjs`,
  `js/validate.mjs`, `js/termstructure.mjs`, `js/forecast.mjs`. Editing any of these **can** bump
  `APP_VERSION` — check whether app-visible behaviour changed.
- **Node-only `.mjs`** (the app never imports them): `js/flip-niches.mjs`, `js/held-item-strategy.mjs`,
  `js/valuescreen.mjs`, and everything under `pipeline/`. Node-only stdout/logic changes ship without a
  bump.

The RC-C manifest test (E9) will make this list the source of truth a new app-import must reconcile
against; the directory hierarchy (upcoming rename) will additionally make the split legible *by path*.

## ROOT-LOCKED artifacts (⚖️)

`fills.json`, `positions.json`, `offers.json`, `screen.json`, `suggestions.jsonl` and the other data
artifacts the app fetches **same-origin** are LOCKED to the repo root — the app's `fetch` paths assume it.
Their **field names are a wire contract** (schema consumers + the F1 retro-join read them); renaming a
field orphans historical data. The full ROOT-LOCKED vs movable split is `README.md` "Map of the repo".

---

## ⚖️ Judgment principles (the doctrine no guard can hold)

**Doctrine lives in code, not prose (encode over prose).** The standing preference: a rule that CAN be a
validator, a shared helper, or a lint SHOULD be — not a paragraph in a skill or doc that rots. Skill prose
is judgment the code can't do; the moment a rule becomes mechanical, move it into the code and leave a
pointer. (This is why the guards above exist instead of "remember to…" prose.)

**One canonical home per fact; move, never copy.** A ruling lives in exactly one place (a module header,
a skill, this doc) and everywhere else points at it. Copying a rule into a second doc is how the
0.30.0→0.33.0 verdict-vocabulary contradiction happened; `doclint` (E3) now guards the worst axis of it.

**Placeholder honesty (the F1 discipline).** Most thresholds are honest **PLACEHOLDERs** at n≈0 — named so
they're greppable and the F1 calibration retro (opens only when the fill sample clears documented n-gates)
can find them. Never oversell a placeholder as tuned; never gate a real decision on an uncalibrated
constant without saying so. An intended-but-unwired API declares itself `@provisional-api` **citing a
tracking item** — otherwise it's just vestigial rot (below).

**Declarative strategy specs.** A flip-niche is a spec in `js/flip-niches.mjs` (`{key, edge, rank, falling,
gate, confirm, validators, …}`); `gatecandidates.mjs` drives behaviour off the spec fields, never off
`if (mode === '…')`. A new flip-niche registers a spec; it does not edit the gate stack. (N2 fixed the last
`mode ===` leak — the lesson: a declared spec field must actually be *read*, or it's dead metadata.)

**Validators are pure and inform-vs-gate is per-thesis.** Each validator is a pure `(ctx) → verdict`; its
COMPUTATION is thesis-agnostic but its ACTION (gate vs inform) is declared per-spec. No validator fetches
or mutates.

**Estimator variants register; they don't thread a boolean.** A swappable estimator model — today the
`estimatePair` sell-top models (`js/estimators/sell-models/`: `reach-fold`, `pressure`) — is a named file
+ one line in a keyed registry (`SELL_TOP_MODELS`), selected through the `compose.mjs` resolver
(`--est-sell` / the optional pipeline config); the shell (`estimatePair`) keeps the non-skippable floors (ordering
clamps, BE floor, declared-exit anchor) so a model only PROPOSES a price, never bypasses them.
Active-plus-shadow: the active model displays/publishes, every `defaultShadow` model still runs + logs to
`suggestions.jsonl` each pass (the unbiased F1 co-log). A **boolean mode-flag threading through a shared
function** (the pre-PC3 `{pressureExit:true}` that overrode both legs mid-function) is the anti-pattern this
replaced — a new variant (safe-quantile, PLAN-REACH-CALIBRATION AC3) lands as a registry line, not a third
boolean. Same shape as declarative specs below: composition lives in a registry + a resolver, not in `if`s.

**Provisional/app-parity drift is tracked, not silent.** Where the console is deliberately ahead of the
app (`screen.json` frozen while stdout gets richer), that's a known deferral with an owning plan, not an
accident — say so at the seam.

---

## Anti-patterns (how fragmentation gets in) + their guards

The audit named three recurring root causes. Each now has (or is getting) a guard so the *class* can't
recur — the point is to catch the pattern, not patch instances.

- **RC-A — vestigial "kept-for-future / until-torn-out" code.** A concept's last consumer is deleted but
  its export + test are left behind (against "git history is the reference"). It rots and inflates every
  later read. **Guard: `check-dead-exports.mjs` (E2).** Legit test-only/provisional exports opt out inline
  with `@test-only`/`@provisional-api` + a reason.
- **RC-B — declared-but-unread config/spec field.** A field is set + schema-validated but no code reads it,
  so it *looks* load-bearing while the real logic branches elsewhere (the `spec.confirm` case, N2).
  **Guard (behavioural): the conformance/`survivemode` tests pin that each spec field drives an observable
  effect.** A generic unread-field lint is a possible future add.
- **RC-C — drifted/unwritten convention.** A rule everyone "knows" but nothing checks silently breaks (the
  `.js`/`.mjs` blast-radius convention, N3). **Guard: the app-import manifest test (E9, proposed) + this
  doc's blast-radius model.**

Full audit + findings: `PLAN-ARCH-DOCS-AUDIT.md` (Parts 1–5); the disposition validation:
`PLAN-CLEANUP-VALIDATION.md`.

---

## Keeping this doc honest

- **Mechanical claims are guarded or marked *(proposed)*.** When a *(proposed)* guard ships, flip its row
  to 🔒 and delete the marker — that edit is the acknowledgement.
- **`archlint` (E7) guards this file's references** (🔒 shipped 2026-07-14). A cheap offline check that
  every `` `code-font` `` file token named here resolves on disk — a path resolves from the repo root, a
  bare basename against the source dirs. `PLAN-*.md` working docs are exempt (transient by design), and a
  genuinely-future file goes in archlint's `PROPOSED` set with a "(proposed)" mark here. It matters most
  through the directory rename, when files move. Structural/existence only, never semantic.
- **Judgment sections follow process rule 8:** the change that alters the behaviour updates the principle
  here in the same commit. A wave-start drift scan is the backstop.
- This doc states *principles*; the **flow/entity walkthrough** (how a price/trade/suggestion/verdict
  moves through the system, end to end) is its companion `docs/FLOW.md`.
