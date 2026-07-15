# LORE.md — narrative, history, and superseded-approach rationale

Ben's standing rule (2026-07-08, memory `docs-small-encode-in-scripts`): *"CLAUDE.md small, no
fluff, lore in a separate file."* This is that file. It holds the **stories** — why the code is
shaped the way it is, which approaches were tried and dropped, and the incidents behind the
process rules — so CLAUDE.md can stay a lean routing/facts/pointers doc.

**What is NOT here (and where it lives instead):**
- **Load-bearing invariants** live in the header of the module/test that governs them (CLAUDE.md
  "Where shipped work is documented"). Nothing in LORE.md is load-bearing — it's context.
- **Shipped-change record** = `CHANGELOG.md` + `git log`.
- **File/artifact registry** = `README.md` ("Files" + "Map of the repo").
- **The plan + scoreboard** = `PLAN.md`.

---

## Why the code is split into `js/*.js` (the single-file history)

The app was one **1375-line `index.html`** file until 2026-07, when development moved from
mobile-only Claude sessions to Claude Code on a PC. The single-file constraint was ever only about
**zero-build GitHub Pages deploys**, not mobile editing — so the split into ES modules under `js/`
keeps the zero-build deploy (the files ship exactly as they sit on disk) while making the code far
more reviewable/diffable. Consequence that still bites: ES modules don't load over `file://`, so
local testing needs `serve.cmd` (see README "Local development"). The full current module
inventory is README's "Files" section — not duplicated here or in CLAUDE.md.

## The live desk experience (LW2/LW3/LW4) — why localhost behaves differently

`serve.cmd` is also the **live desk experience**: on localhost the app polls
`positions.json`/`offers.json`/`heartbeat.json` and, paired with the `watch-log.mjs` daemon,
reflects fills/offers within ~40s with **zero git**. The daemon's 30s `heartbeat.json` (LW3)
drives a "watcher live" liveness stamp that stays fresh even when the book is frozen during a quiet
no-fill stretch — that split fixed a false "is the watcher running?" alarm the old positions-only
stamp raised during no-fill stretches. On `bensumm.github.io` the poll is off and the M1
Refresh-positions banner + button are unchanged. Operational detail: README "Local development",
`FILLS-PIPELINE.md` §14.

**LW4 — the local scan refresh (2026-07-12).** The Scan tab renders a static `screen.json` snapshot
that only the pipeline's `screen.mjs --publish` rewrites, so on the deployed site "Refresh scan"
could only ever re-fetch the same frozen file — a no-op on a stale snapshot. But the same zero-git
insight behind LW2 applies: on the local dev server the browser reads `screen.json` off local disk,
so a fresh LOCAL scan is purely a local file write — nothing to do with git. So `serve.cmd` swapped
the Python `http.server` for a node **`dev-server.mjs`** that serves the same static root AND exposes
`POST /api/scan` (127.0.0.1 only), which runs `screen.mjs --mode all --publish` and rewrites
`screen.json` locally. Now a localhost Refresh click runs a REAL scan and the app re-reads the fresh
file — and a Claude session at the same desk can read that same regenerated `screen.json` as context.
It keeps the daemon's zero-git discipline (local file write only; publishing to Pages stays the
attended `sync-fills.mjs`), is bound off-localhost-unreachable because it runs a shell command, and
degrades on deployed Pages to the old re-fetch-the-published-snapshot behavior.

## The fills pipeline's evolution — the eliminated scheduler

The pipeline captures real GE trades client-side via RuneLite's Exchange Logger plugin and closes
the loop against the tool's suggestions. It once ran on a ~20-minute `CofferFillsSync` Task
Scheduler job; that **unattended writer was eliminated 2026-07-04** (`FILLS-PIPELINE.md` §12) — sync
is now **on-demand only** (session-start or a manual push), which is why there is no unattended
identity and the artifacts land on `main` via the attended admin-bypass push. Why the derived
artifacts (`positions.json`/`offers.json`) are **ROOT-LOCKED**: the app fetches them same-origin and
`fills.json` is the source they reconstruct from — moving any is a coordinated app+pipeline+phone
change, mapped in README "Map of the repo". Reconstruction detail: `FILLS-PIPELINE.md` §5.1.

---

## Incident anchors behind the process rules

- **The 0.30.0→0.33.0 `momVerdict` reconciliation (the anchor for CLAUDE.md process rule 8).** A
  change added a new verdict path while an OLD contradictory statement was left standing elsewhere
  in the docs — the reader then had two rules that disagreed. The lesson, now process rule 8: a
  documentation pass is **reconciliation, not append** — grep for what a change supersedes and fix
  it in place. The `docs/PLANNING.md` anti-patterns list leads with this one.
- **The rollback incident (process rule 1).** Work was once done from a stale copy of the (then
  single) `index.html` and clobbered newer changes. The rule: confirm current state before editing;
  the same principle now applies across the split files together.
- **The Hydra leather buy (the Pipeline-v2 root incident — PLAN.md).** A 13.5m buy off a mid-decay
  price (not the multi-week floor), because the reach/floor checks were prose in `/scan` and no
  script ran them — then whiplash hold/cut advice from the `quote.mjs`-vs-`watch.mjs` verdict fork.
  This is the anchor for the whole Pipeline-v2 wave (snapshot layer, one verdict home, validators on
  every surface).

## Superseded / rejected approaches (don't rebuild these)

- **Global falling-exclusion → per-strategy (P5, Ben 2026-07-08).** Falling was once a blanket
  screen exclusion. It is now PER-SPEC (`js/flip-niches.mjs` `spec.falling`:
  `exclude`/`accept`/`knife-guard`) — band/churn still exclude, but scalp accepts a falling wide
  band deliberately and value knife-guards. Memory `falling-exclusion-amended`. Any doc saying
  "falling items are silently excluded" without the per-spec qualifier is stale.
- **Niche roster: NY2/NY3 off-by-default → `spread`/`rising` DELETED (Ben 2026-07-09, Steps 3+4).**
  NY2/NY3 ruled `spread` "stays off-by-default" and `rising` "kept in `--mode all`". Both specs were
  then deleted outright: spread's 24h-average edge is structurally narrower than the intraday band and
  surfaced ≈0 clean flips once the render net>0 gate landed; `rising` ⊆ `band` (a riser clears band's
  gates too). Rising's one real mechanism — proxy-first fetch-pool ordering so risers aren't buried
  below flats — was absorbed into `rankAndSlice`'s small rising reserve (`RISING_RESERVE_DEFAULT`). The
  live roster is band/churn/scalp/value (`js/flip-niches.mjs`); doclint denylists spread/rising as live
  niches. Git history is the spec reference.
- **Value-niche rank: %-amplitude → abs-gp → deployable-capital (all same day, Ben 2026-07-09).**
  `valueScore`'s amplitude term is a scale-free PERCENTAGE, so cheap high-volatility teleport tabs
  (cycling 30–100%) swept the hard top-N fetch cut while the genuinely viable mid-amp DEPLOYABLE sub-1m
  class (Soiled page, Snape grass seed, Awakener's orb) never got quoted. A first patch boosted ABSOLUTE
  gp/unit (`VALUE_ABSGP_*`) — but a full-pool (235-item) investigation showed abs-gp just rewards
  "expensive" (ZERO big-liquid items exist: nothing >1m trades 500+/d) and buried the same class. So
  abs-gp was SUPERSEDED the same day by the DEPLOYABLE-CAPITAL measure (realizable after-tax gp/cycle on
  the capital you can actually park+exit — the three-way `deployUnits` min + a clamped `deployMult`
  folded into `valueScore`). `VALUE_ABSGP_*` is gone; the operating rule lives in `js/valuescreen.mjs`'s
  header. This was one of four same-day value iterations (deployable-capital, artifact/liquidity
  hardening, RC1 recency anchor, trajectory-GATE) whose current form is now that module header.
- **`expGpDay` as the ranking metric → demoted (P6b, Ben 2026-07-09: "I despise gp/d").** Rank is now
  `net after tax × P(fill at the quoted pair) ÷ TTF` per thesis (`pipeline/lib/estimators.mjs`);
  `expGpDay` survives only as the cheap pre-fetch pool orderer + the 500k `--min-gpd` pre-filter.
- **Cancel-to-EMPTY fill inference → deleted (LH1).** An EMPTY slot snapshot is NOT evidence of a
  fill; the inference that tried to read fills from cancel-to-EMPTY transitions was removed and must
  not be resurrected (`pipeline/lib/reconstruct.mjs` / LH1 header; the false-EMPTY-snapshot restart
  variant is a known display-only warning case, PLAN.md Discovered).
- **Re-scoring the screen off a reachable sell → rejected (`/scan`).** The cheap ts6h proxy
  understates reach → false negatives that HIDE good sells (worse than the band-top-artifact problem
  it would fix). The accepted alternative: run `windowrange.mjs --ask` on the handful you actually
  pitch, not on the whole screen.
- **Bank-visibility auto-reconciliation → deferred (PLAN.md).** Bank data is a manual, always-stale
  clipboard export; auto-reconciling it against live `positions.json` risks false discrepancies.
  Bank truth stays advisory, never injected into `fills.json`.

---

*When a chunk retires an approach or lands a lesson worth remembering, add the story here and leave
the load-bearing rule in the governing module/test header — not the other way round.*
