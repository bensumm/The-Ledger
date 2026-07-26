Status: **PROPOSAL — chip-away, one cluster per chunk (Ben, 2026-07-26).** No chunk shipped yet. This is
a slow, opportunistic reorg to run a cluster at a time between feature work, never a single big-bang pass.
Per-topic working doc (`docs/PLANNING.md` lifecycle); folds into `PLAN.md` + deleted when every cluster lands.

# PLAN-LIB-SUBDIRS — group `pipeline/lib/`'s 50 files into concept subdirectories

## The goal (Ben's framing)

`pipeline/lib/` is a flat directory of **50 `.mjs` files**. It doesn't hinder work day-to-day, but the
flatness hides the architecture: you can't see the concept boundaries by looking at the tree. Grouping
cohesive files into named subdirectories gives the codebase **polish and readability**, and — the real
win — **explicit subdirectories inherently describe the architecture**, so a new reader (or a future
agent) can reason about the system from its shape. This is a navigability/legibility investment with
**zero runtime payoff**, so it must not cost a regression: every chunk keeps the guards green.

## Why incremental, never one pass

This is a **no-build / no-bundler** repo (deployed exactly as the files sit). Moving one lib file rewrites
every `import … from '../lib/<file>.mjs'` that names it — across ~30 `pipeline/commands/*.mjs`, the other
~50 libs, and ~120 `pipeline/test/*.test.mjs` references. A single big-bang move touches hundreds of import
lines at once and turns any mistake into a hard-to-bisect breakage. So: **one cohesive cluster per chunk**,
`check-imports.mjs` + the full guard suite green before the next. The clusters are independent, so the order
is flexible and the work can pause indefinitely between chunks.

## Hard constraints

- **`js/` stays put — this plan is `pipeline/lib/` only.** The `js/*.js` modules are ROOT-LOCKED / app-fetched
  and wired into `index.html`; moving them changes the app's load surface (README "Map of the repo" ROOT-LOCKED
  split). A later, separate phase could consider `js/` — NOT this plan.
- **`paths.mjs` and `version.mjs` are high-fan-in infra** — imported very widely. Leave them at `lib/` root (or
  move them LAST, on their own chunk) so early chunks stay small.
- **No behavior change, ever.** A chunk is a pure move + import-path rewrite. `positions.json`/`screen.json`
  regenerate byte-identical; no APP_VERSION bump (pipeline-only); tests are updated for the new paths only.
- **The archlint / README file-registry stays honest** — each chunk updates README "Map of the repo" entries
  to the new `lib/<cluster>/` paths in the SAME commit (process rule 8).

## The repeatable recipe (per cluster — no re-derivation each run)

1. `git mv pipeline/lib/<file>.mjs pipeline/lib/<cluster>/<file>.mjs` for each file in the cluster.
2. Rewrite imports mechanically. Every importer of a moved file changes its specifier:
   - a sibling INSIDE the same new cluster: `'./x.mjs'` (was `'./x.mjs'`) — unchanged if both moved together.
   - a lib file OUTSIDE the cluster importing IN: `'./x.mjs'` → `'./<cluster>/x.mjs'`.
   - a moved file importing a lib file that STAYED: `'./y.mjs'` → `'../y.mjs'`.
   - a `pipeline/commands/*` or `pipeline/test/*` importer: `'../lib/x.mjs'` → `'../lib/<cluster>/x.mjs'`.
   Find them with `grep -rn "lib/<file>\|from '\./<file>" pipeline/`. `check-imports.mjs` is the safety net —
   it statically resolves every entrypoint's imports against exports, so a missed rewrite fails CI loudly.
3. Run the full guard suite (`run-tests`, `check-imports`, `check-dead-exports`, `check-daemon-safety`,
   `lint-arch`, `lint-skills`, `lint-docs`) — all green before landing.
4. Update the moved files' README "Map of the repo" entries to their new paths, same commit.

## Proposed starting taxonomy (refine per chunk — the debatable part)

Eight concept clusters over the 50 files. Names/assignments are a STARTING point; settle each cluster's
membership when its chunk runs (a few files are genuinely ambiguous — noted). `ignored`, `paths`, `version`
can stay at `lib/` root as cross-cutting infra.

| Cluster | Files (starting assignment) |
| --- | --- |
| `market/` | marketfetch, archive, warm-term-structure, compose, guideanchor, item-context, probes, hourly-lmh |
| `capital/` | derive-cash-tiers, cash-anchor, book-model, capital-utilization, freed-capital, limits, ownedledger |
| `reconstruct/` | reconstruct, campaigns, offers, positions, fill-placement, sync-invoke, logblind |
| `signal/` | estimators, rating, gatecandidates, admission, structural-admission, patha, recovery, range-position, levels |
| `timing/` | cyclewatch, velocity, velocitytag, staleexit, statetransition |
| `thesis/` | holdthesis, sessionthesis, watchstate, reverseflipstate |
| `render/` | render, emit, cli, suggestlog, retrojoin, replay, analyze |
| (root infra) | paths, version, ignored — stay at `lib/` root |

Ambiguous calls to settle at chunk time: `levels`/`range-position` (signal vs timing), `hourly-lmh` (market
vs timing), `analyze`/`retrojoin`/`replay` (render vs their own `retro/` cluster), `logblind` (reconstruct
vs a log/ cluster with offers).

## Suggested chunk order (lowest fan-in / most cohesive first)

Do the tightest, most-self-contained clusters first so early chunks are small and low-risk:

1. **`render/`** — mostly output-side, low inbound fan-in from core logic.
2. **`thesis/`** — small (4 files), cohesive state stores.
3. **`capital/`** — cohesive; `derive-cash-tiers`/`book-model` already cluster conceptually.
4. **`timing/`**, then **`market/`**, then **`reconstruct/`** — larger fan-in (reconstruct especially, it
   underpins positions/offers/cash), so land it once the recipe is proven.
5. **`signal/`** — largest, most cross-referenced; last.

Each is a standalone chunk; skip/re-order freely. Stop any time — a partially-clustered `lib/` is still valid.

## Acceptance (per chunk)

The cluster's files live under `pipeline/lib/<cluster>/`; every importer resolves (`check-imports` green);
full guard suite green; `positions.json`/`screen.json` regenerate byte-identical on an unchanged log; README
"Map of the repo" entries updated to the new paths. When the LAST cluster lands, fold this doc into `PLAN.md`
and delete it.
