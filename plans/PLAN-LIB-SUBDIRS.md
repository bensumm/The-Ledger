Status: **IN PROGRESS — chunk 0 SHIPPED; clusters 1–7 REMAIN (Ben, 2026-07-26).** A slow, opportunistic
reorg run a cluster at a time between feature work, never a single big-bang pass.
Per-topic working doc (`docs/PLANNING.md` lifecycle); folds into `PLAN.md` + deleted when every cluster lands.

| Chunk | State | Notes |
| --- | --- | --- |
| **0 — tooling + guard prep** | **SHIPPED** | `pipeline/ci/move-lib-cluster.mjs` (resolve-and-compare mover, `--dry-run`, pure helpers pinned by `move-lib-cluster.test.mjs`); `lint-arch.mjs` bare-basename resolution now recurses `pipeline/lib/**`; `check-imports.mjs` ENTRYPOINTS = every `pipeline/commands/*.mjs` (11 → 30, 473 → 614 imports checked). All 7 guards green. |
| **1 — `render/`** | **SHIPPED** | render, emit, cli, suggestlog, retrojoin, replay, analyze. 65 rewrites across 39 files; git recorded all 7 as renames. Two bugs found + fixed live — the mover's pre-move write path (resurrected files at `lib/` root), and **self-relative path math** (`suggestlog.mjs`'s `LEDGER`), now detected by `selfRelativePathRisks`. |
| **2 — `thesis/`** | **SHIPPED** | holdthesis, sessionthesis, watchstate, reverseflipstate. 26 rewrites across 19 files. Clean as predicted — no self-relative paths, no cross-cluster edges out. |
| **3 — `reconstruct/`** | **SHIPPED** | reconstruct, campaigns, offers, positions, fill-placement, sync-invoke, logblind. 45 rewrites across 28 files. Landed BEFORE capital as the hardening reorder specified (avoids double-touching 3 capital files). **Two self-relative paths fixed** — `offers.mjs`'s mapping-cache read (try/caught, so it would have failed SILENTLY) and `sync-invoke.mjs`'s `SYNC_FILLS`; both verified by resolving them at runtime, since the suite passes either way. |
| 4 — `timing/` · 5 — `market/` · 6 — `signal/` · 7 — `capital/` | open | |

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
- **No behavior change, ever — but this is NOT automatic (learned chunk 1).** A chunk is a pure move +
  import-path rewrite *plus* a hand re-count of any self-relative path math in the moved files (recipe step
  2b). `positions.json`/`screen.json` regenerate byte-identical — verify this, it is the acceptance check
  that catches a broken `HERE`-relative path that every static guard passes. No APP_VERSION bump
  (pipeline-only); tests are updated for the new paths only.
- **The archlint / README file-registry stays honest** — each chunk updates README "Map of the repo" entries
  to the new `lib/<cluster>/` paths in the SAME commit (process rule 8). `docs/ARCHITECTURE.md` and
  `docs/GLOSSARY.md` are the two docs `lint-arch.mjs` actually CI-enforces (a stale reference there
  hard-fails, not just drifts) — see the Guards section below for exactly which references break and why.

## The repeatable recipe (per cluster — no re-derivation each run)

1. `git mv pipeline/lib/<file>.mjs pipeline/lib/<cluster>/<file>.mjs` for each file in the cluster (or run the
   chunk-0 helper below, which does this step + step 2 mechanically).
2. Rewrite imports mechanically. Every importer of a moved file changes its specifier. Verified against the
   real import graph (see "Import-edge evidence" below) — **six** edge cases, not four:
   - a sibling INSIDE the same new cluster: `'./x.mjs'` (was `'./x.mjs'`) — unchanged if both moved together.
   - a lib file OUTSIDE the cluster importing IN: `'./x.mjs'` → `'./<cluster>/x.mjs'`.
   - a moved file importing a lib file that STAYED at `lib/` root: `'./y.mjs'` → `'../y.mjs'`.
   - a `pipeline/commands/*` or `pipeline/test/*` importer: `'../lib/x.mjs'` → `'../lib/<cluster>/x.mjs'`.
   - **(new) a moved file importing `js/` (external, outside `pipeline/`)**: every nesting level adds one
     `../`. `pipeline/lib/x.mjs` → `pipeline/lib/<cluster>/x.mjs` turns `'../../js/quotecore.js'` into
     `'../../../js/quotecore.js'`. **This is the highest-volume edit** — confirmed **~30 lines across ~24 of
     the 50 lib files** import from `../../js/...` (quotecore.js, money-format.js, windowread.mjs,
     termstructure.mjs, valuescreen.mjs, amplitudescreen.mjs, flip-niches.mjs, reverseflip.mjs,
     held-item-strategy.mjs, validate.mjs — grep confirmed, e.g. `pipeline/lib/gatecandidates.mjs:36,40,41,45,51,57`,
     `pipeline/lib/item-context.mjs:42,43,46`, `pipeline/lib/staleexit.mjs:30,31`). Also covers the two
     **re-export barrel shims** `pipeline/lib/estimators.mjs:6` (`export * from '../../js/estimators.mjs'`)
     and `pipeline/lib/rating.mjs:6` (`export * from '../../js/rating.mjs'`) — same depth-bump rule applies
     to `export * from` / `export { … } from` lines, which a naive `import …` -only regex will MISS (see
     Guards section — `check-imports.mjs`'s own parser has exactly this blind spot).
   - **(new) a file that imports a target ALREADY moved into a different cluster in an earlier chunk**: the
     depth changes a SECOND time when the importer itself later moves. Example (real edge, not hypothetical):
     `pipeline/lib/gatecandidates.mjs:37` imports `'./cli.mjs'`. If `render/` ships chunk 1, this becomes
     `'./render/cli.mjs'` immediately (case 2, cli.mjs moved, gatecandidates.mjs still at root). When
     `signal/` ships later and gatecandidates.mjs itself moves into `signal/`, the specifier must bump AGAIN
     to `'../render/cli.mjs'`. Miss this second bump and the path is wrong by one level — silently, since
     `'../render/cli.mjs'` from `signal/` still parses as a string, it just resolves to the wrong (or a
     nonexistent) file. `check-imports.mjs` catches nonexistent targets, but a coincidentally-existing wrong
     target would NOT be caught by path-resolution alone — reread the diff, don't just trust "CI is green."
   Find them with `grep -rn "lib/<file>\|from '\./<file>\|from '\.\./<file>" pipeline/` — critically, run this
   grep against the WHOLE `pipeline/` tree (including already-created cluster subdirs), not just
   `pipeline/lib/` root + `commands/` + `test/`, or the second-bump case above is missed. `check-imports.mjs`
   is the safety net for entrypoint-reachable breakage — but see Guards below for what it does NOT cover.
2b. **Re-count every SELF-RELATIVE path in the moved files (added chunk 1 — a real blind spot, not
   hypothetical).** A file that computes a path from its own location (`import.meta.url` → `HERE`) does NOT
   survive a pure move: nesting one level deeper silently changes where that path resolves. This is runtime
   path arithmetic, so **no import guard can see it** — `check-imports` passes, the file parses, and the
   artifact quietly lands somewhere new. ANCHOR: `suggestlog.mjs`'s `LEDGER = path.join(HERE, '..', '..',
   'suggestions.jsonl')` pointed at the repo root from `lib/` but at `pipeline/` from `lib/render/`, which
   would have forked `suggestions.jsonl` into an untracked file (the same file's header records this class
   biting once before, 2026-07-05). The mover now PRINTS a `⚠ SELF-RELATIVE PATHS` block listing every such
   line in the moved set — re-count the `'..'` segments by hand for each, then re-run the suite. Six files
   still carry this pattern: `archive`, `compose`, `marketfetch`, `offers`, `probes`, `sync-invoke`.
3. Run the full guard suite (`run-tests`, `check-imports`, `check-dead-exports`, `check-daemon-safety`,
   `lint-arch`, `lint-skills`, `lint-docs`) — all green before landing. If the chunk-0 helper exists, it runs
   `check-imports` + `run-tests` itself and prints a per-file edit summary for review before commit.
4. Update the moved files' path references in **README.md "Map of the repo"** (37 pre-existing
   `pipeline/lib/` references — grep-confirmed) **AND `docs/ARCHITECTURE.md` / `docs/GLOSSARY.md`** (these two
   are the only docs `lint-arch.mjs` actually enforces — a stale reference in EITHER hard-fails CI, not just
   goes stale; see Guards below) **AND grep `.claude/skills/*.md`** for the moved basenames (book/scan/morning/
   overnight/analyze skills carry ~7 `pipeline/lib/<file>.mjs` prose pointers — confirmed via grep — that NO
   guard checks, so they go stale silently if skipped). Same commit as the move.

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

## Import-edge evidence (grep-verified, 2026-07-26 hardening pass)

Import style, confirmed by reading a sample of each importer class:
- `pipeline/commands/*.mjs` → `'../lib/<file>.mjs'` (e.g. `read-book.mjs:27-35`).
- `pipeline/lib/*.mjs` → sibling `'./<file>.mjs'`, or `'../../js/<file>.{mjs,js}'` for the app-shared modules.
- `pipeline/test/*.test.mjs` → same `'../lib/<file>.mjs'` shape as commands.
- **No dynamic `import()` of any `pipeline/lib/*` file exists today** — grep of `import\(` across `pipeline/`
  hits only `pipeline/daemons/registry.mjs` + `cache-warm.mjs` (daemon manager, unrelated), `pipeline/lib/probes.mjs`
  (dynamically loads `pipeline/probes/*.mjs`, a different directory, by directory-listing — unrelated to this
  move), and the CI scanners themselves (`check-imports.mjs`/`check-daemon-safety.mjs`, which use `import()`
  to introspect exports, not to load application logic). **No `path.join`-constructed or otherwise
  string-built lib specifier exists.** So a naive text-based specifier rewrite is safe — there is no exotic
  import style in today's tree that it would silently break. (A future chunk could introduce one; the helper
  script's verification step below is the backstop, not this observation alone.)
- **Two re-export barrels**: `pipeline/lib/estimators.mjs:6` and `pipeline/lib/rating.mjs:6`, both
  `export * from '../../js/<name>.mjs'` — one-line shims per `docs/ARCHITECTURE.md:82`. Handled by the same
  depth-bump rule as a normal import (see recipe case 5), NOT by any special re-export logic — but a
  text-only tool must match `export … from` as well as `import … from`, which `check-imports.mjs`'s own
  parser does NOT (see Guards below).
- **Real internal cross-cluster edges** (grep of `from '\./[a-zA-Z-]+\.mjs'` across all of `pipeline/lib/`,
  mapped against the proposed taxonomy):

  | Importer (cluster) | Imports (cluster) | Evidence |
  | --- | --- | --- |
  | `limits.mjs` (capital) | `reconstruct.mjs` (reconstruct) | `pipeline/lib/limits.mjs:29` |
  | `ownedledger.mjs` (capital) | `reconstruct.mjs` (reconstruct) | `pipeline/lib/ownedledger.mjs:31` |
  | `derive-cash-tiers.mjs` (capital) | `reconstruct.mjs`, `offers.mjs` (reconstruct) | `pipeline/lib/derive-cash-tiers.mjs:60,62` |
  | `capital-utilization.mjs` (capital) | `cli.mjs` (render) | `pipeline/lib/capital-utilization.mjs:11` |
  | `book-model.mjs` (capital) | `capital-utilization.mjs` (capital, sibling) | `pipeline/lib/book-model.mjs:23` |
  | `freed-capital.mjs` (capital) | `watchstate.mjs` (thesis) | `pipeline/lib/freed-capital.mjs:15` |
  | `fill-placement.mjs` (reconstruct) | `marketfetch.mjs` (market) | `pipeline/lib/fill-placement.mjs:14` |
  | `item-context.mjs` (market) | `watchstate.mjs` (thesis) | `pipeline/lib/item-context.mjs:45` |
  | `gatecandidates.mjs` (signal) | `cli.mjs` (render), `structural-admission.mjs` (signal, sibling) | `pipeline/lib/gatecandidates.mjs:37,62` |
  | `admission.mjs` (signal) | `gatecandidates.mjs` (signal, sibling) | `pipeline/lib/admission.mjs:39` |
  | `patha.mjs` (signal) | `gatecandidates.mjs` (signal, sibling) | `pipeline/lib/patha.mjs:33` |
  | `replay.mjs` (render) | `gatecandidates.mjs` (signal) | `pipeline/lib/replay.mjs:34` |
  | `retrojoin.mjs` (render) | `reconstruct.mjs` (reconstruct), `cli.mjs` (render, sibling) | `pipeline/lib/retrojoin.mjs:29,30` |
  | `range-position.mjs` (signal) | `marketfetch.mjs` (market) | `pipeline/lib/range-position.mjs:13` |
  | `velocitytag.mjs` (timing) | `cli.mjs` (render) | `pipeline/lib/velocitytag.mjs:7` |

  Root infra (`paths.mjs`, `ignored.mjs`, `cash-anchor.mjs`→`paths.mjs`) is imported from several clusters but
  stays at `lib/` root per the hard constraints, so those edges never change depth — not listed.

## Helper script — `pipeline/ci/move-lib-cluster.mjs` (recommend: BUILD, as chunk 0)

**Decision: worth building.** ~30 external `../../js/` lines + ~15 internal cross-cluster edges + the
commands/test rewrite, repeated across 6 remaining chunks, is exactly the "hundreds of import lines, one
mistake is hard to bisect" risk the plan's own "Why incremental" section names — except incrementalism alone
doesn't fix a missed rewrite WITHIN a chunk. A single reusable script written once (chunk 0, ~1-2 hours) pays
for itself by chunk 2 and removes the highest-volume manual-error source. Manual+`check-imports` is NOT
sufficient alone: `check-imports.mjs` only statically parses `import … from` (not `export … from` — misses a
broken re-export specifier unless the module also throws at evaluation AND is transitively reached by one of
its 11 hardcoded entrypoints — see Guards), and it only covers those 11 entrypoints, not all ~29
`pipeline/commands/*.mjs` files (see Guards) — so a missed rewrite in an uncovered command can reach `main`
undetected by CI.

**Spec:**
- **Input**: cluster name + explicit file-basename list, e.g.
  `node pipeline/ci/move-lib-cluster.mjs render render.mjs emit.mjs cli.mjs suggestlog.mjs retrojoin.mjs replay.mjs analyze.mjs`.
  Membership stays a human/chunk-time decision (per "Ambiguous calls" above) — the tool only executes a
  decided list, it never infers clustering.
- **Step 1 — move**: for each named file, verify it exists at `pipeline/lib/<file>.mjs` and the destination
  doesn't already exist, then `spawnSync('git', ['mv', src, dest])`.
- **Step 2 — rewrite by RESOLVED PATH, not by textual pattern-matching the 6 cases.** This is the key design
  choice that makes the tool correct without hand-coding each edge case: walk every `.mjs`/`.js` file under
  `js/`, `pipeline/` (recursively — covers `lib/` incl. already-created cluster subdirs, `commands/`, `test/`,
  `ci/`, `probes/`, `daemons/`). For each file, parse every relative specifier in both `import … from '…'`
  AND `export … from '…'` / `export * from '…'` forms (reuse `check-imports.mjs`'s comment-stripped
  statement-splitting approach, but extend the regex to also match the `export` keyword — its current
  `import`-only parser is exactly the barrel-shim gap noted above). Resolve each specifier to an ABSOLUTE
  path relative to the importing file's directory. If that absolute path equals one of the just-moved files'
  OLD absolute path, compute the new relative specifier from the importer's directory (unchanged, unless the
  importer itself is also in the moved set) to the file's NEW absolute path, and replace the exact quoted
  substring in place. Because this is resolve-and-compare rather than "detect which of 6 cases applies," it
  automatically and correctly handles: siblings, outside-in, moved-importing-stayed, the external `js/`
  depth-bump, AND the already-moved-in-an-earlier-chunk depth-bump — no case-specific logic needed, and no
  case can be silently missed by omission.
- **Barrel/re-export handling**: covered by the same mechanism (Step 2 matches `export * from` /
  `export { x } from` too) — no separate logic. `export * from` re-exports don't need name-level rewriting,
  only the specifier string.
- **Verification**: after rewriting, run `check-imports.mjs` and `run-tests.mjs` as child processes and
  surface their output; print a per-file diff summary (which specifiers changed, old → new) for the human to
  review before `git add`/commit — the tool never commits. Exit non-zero if either guard fails, leaving the
  working tree as-is (git mv + rewrites already applied) for inspection/fix, not auto-reverted.
- **What it deliberately does NOT do**: infer cluster membership, touch `README.md`/`docs/ARCHITECTURE.md`/
  `docs/GLOSSARY.md`/`.claude/skills/*.md` (still a manual step 4, since those are prose judgment calls about
  what to say, not mechanical path substitution), or run `lint-arch`/`lint-docs`/`check-dead-exports`/
  `check-daemon-safety` (cheap enough to run by hand as the existing recipe step 3 already says; adding them
  wouldn't change the tool's design).

## Guards — what actually catches a bad move, and what needs a tweak

Read `check-imports.mjs`, `lint-arch.mjs`, `check-dead-exports.mjs`, `check-daemon-safety.mjs`, `lint-docs.mjs`
in full against this plan. Findings:

- **`check-imports.mjs` — no code change needed, but has two pre-existing coverage gaps this plan should
  know about rather than assume away.** Its specifier resolution (`path.resolve(path.dirname(entry),
  imp.specifier)`, `pipeline/ci/check-imports.mjs:88`) is directory-depth-agnostic — it will correctly
  resolve `'../lib/market/marketfetch.mjs'` exactly as well as `'../lib/marketfetch.mjs'`, so subdirectories
  need no guard-side change. BUT: (1) `ENTRYPOINTS` (`check-imports.mjs:32-36`) is a **hardcoded list of 11**
  command files (`screen-flip-niches`, `quote-items`, `watch-positions`, `run-loop`, `analyze-record`,
  `monitor-offers`, `read-buy-limits`, `read-window-range`, `sync-fills`, `add-manual-fill`,
  `join-amplitude-outcomes`) out of **~29** `pipeline/commands/*.mjs` files — `read-book.mjs`,
  `read-schedule.mjs`, `declare-owned.mjs`, `derive-cash.mjs`, `reconcile-reverse-flip.mjs`, and ~13 others
  are NOT statically checked by this guard at all. Their import correctness depends entirely on whether a
  `pipeline/test/*.test.mjs` happens to import that command file directly (confirmed only 10 test files do:
  `joinwindowclears`, `reverseflip-surfacing`, `schedule`, `render`, `capeff-digest`,
  `oscillation-reachphase`, `join-amplitude`, `f1-calibrate`, `trigger-alerts`, `sync-fills` — grep-verified).
  A command outside both lists (e.g. `read-book.mjs`, which imports 7 lib files including 3 in the proposed
  `capital` cluster) could ship a broken import to `main` and only surface when Ben runs `/book`. **This is a
  pre-existing gap, not caused by this plan** — but this plan's per-chunk touch count makes it far more
  likely to matter. **RESOLVED in chunk 0** — `ENTRYPOINTS` now reads the whole `pipeline/commands/` directory
  (30 entrypoints, 614 imports checked, up from 11/473), so every command is statically checked and a new one
  is covered automatically. The per-chunk "spot-run an uncovered command" step is no longer needed.
  (2) its parser (`parseRelativeImports`, `check-imports.mjs:41-69`) matches `import … from`
  only, never `export … from`/`export * from` — so a broken re-export specifier (the estimators.mjs/rating.mjs
  shims) is caught only INDIRECTLY: the broken module throws at `import()` evaluation time
  (`exportsOf`, `check-imports.mjs:74-81`), and that's only exercised if the module is transitively reached
  from one of the 11 entrypoints. `estimators.mjs`/`rating.mjs` are reached via `screen-flip-niches.mjs`
  (rank/grade), so today they're covered — but this is a fragile, indirect form of coverage worth naming, not
  assuming.
- **`lint-arch.mjs` — NEEDS A TWEAK, or the first chunk that moves a bare-basename-referenced file
  hard-fails CI.** `SEARCH_DIRS` (`lint-arch.mjs:36`) is a flat list including `'pipeline/lib'` but no
  cluster subdirectories, and `resolveRef` (`lint-arch.mjs:58-62`) only checks a bare basename (no `/`)
  against that fixed list. `docs/ARCHITECTURE.md` DOES reference lib files as bare basenames — confirmed:
  `` `gatecandidates.mjs` `` at `docs/ARCHITECTURE.md:132` and `` `compose.mjs` `` at `docs/ARCHITECTURE.md:142`
  (no `pipeline/lib/` prefix). It ALSO references several lib files by FULL path with a `/`
  (`pipeline/lib/item-context.mjs`, `pipeline/lib/estimators.mjs`, `pipeline/lib/sync-invoke.mjs` at
  `docs/ARCHITECTURE.md:78,82,83`; `docs/GLOSSARY.md:76` references `pipeline/lib/hourly-lmh.mjs`) — those
  resolve by literal path (`resolveRef`'s `ref.includes('/')` branch, `lint-arch.mjs:60`), so they go stale
  the moment the file moves UNLESS the doc reference is rewritten in the same commit (this is now explicit in
  recipe step 4 above). The bare-basename form is the one that needs a code tweak: extend `SEARCH_DIRS` to
  include each new cluster dir as it's created (`'pipeline/lib/render'`, `'pipeline/lib/capital'`, …) — but
  that means editing `lint-arch.mjs` on EVERY chunk, which is exactly the kind of per-chunk guard-maintenance
  this plan should avoid. **Better tweak, one-time**: change `resolveRef`'s bare-basename branch to search
  `pipeline/lib/**` recursively (one level of subdirectories is enough — this taxonomy is not deeply nested)
  instead of iterating a fixed `SEARCH_DIRS` list, so it never needs touching again regardless of which
  cluster ships when. **DONE in chunk 0** — `resolveRef`'s bare-basename branch now falls back to a recursive
  search under `RECURSIVE_DIRS = ['pipeline/lib']` (`lint-arch.mjs`), so no per-chunk guard maintenance is
  needed and chunk 1 cannot hard-fail on a bare-basename reference. Pinned by `lint-arch.test.mjs`.
- **`check-dead-exports.mjs` — no tweak needed.** `SCAN_DIRS` (`check-dead-exports.mjs:39`) is `[js/,
  pipeline/]` and its `walk()` helper (`check-dead-exports.mjs:78-87`) already recurses into subdirectories
  (skipping only `node_modules`/`.cache`), so moved files are picked up automatically regardless of nesting
  depth. Confirmed by reading the walk implementation, not assumed.
- **`check-daemon-safety.mjs` — no tweak needed, out of scope.** It only scans `pipeline/daemons/*.mjs`
  (`check-daemon-safety.mjs:51,122-124`), a directory this plan never touches. No daemon file imports a
  `pipeline/lib/*` file matching the sync-fills denylist patterns, and the plan's move doesn't touch
  `pipeline/daemons/` at all.
- **`lint-docs.mjs` — no tweak needed.** Its DENYLIST entries key off specific superseded PROSE terms/old CLI
  basenames (e.g. the R2a/R3 rename map at `lint-docs.mjs:126-146`), not off `pipeline/lib/` path shape; none
  of its patterns assume a flat `lib/` directory. Its single-source duplicate-phrase check (CHECK 2) is
  scoped to `CLAUDE.md`/`README.md` prose, unaffected by a path change elsewhere.
- **No README-completeness lint exists.** The task description asked to check for one; there isn't one —
  `README.md`'s "Map of the repo" (37 `pipeline/lib/` references, grep-confirmed) is honesty-checked only by
  human review (process rule 8) and by nothing structural. A stale README entry after a move is silent —
  same class of gap as the skills references above, just in a doc `lint-arch` doesn't govern either.
  Consider (not required for this plan) folding README.md into `lint-arch.mjs`'s `DOCS` list in a future
  chunk — noted here, not spec'd, since it's a bigger lift (README's registry format needs a look for
  false-positive risk before adding it) and out of scope for a lib-reorg hardening pass.
- **`.claude/skills/*.md` — no guard covers file-reference resolution at all** (`lint-skills.mjs` was read in
  full; it has no `existsSync`/path-resolution check of any kind — it lints skill-doc structure/frontmatter,
  not cross-references). The 5 skill files with `pipeline/lib/` prose pointers (book, scan, morning,
  overnight, analyze — grep-confirmed) go stale completely silently. Now covered by recipe step 4's manual
  grep sweep; still no automated backstop.

## Suggested chunk order — pressure-tested

The original "lowest fan-in first" framing is directionally right but the internal-cross-cluster-edge table
above changes two calls:

1. **`render/`** (chunk 1, after chunk-0 helper) — still first. `cli.mjs` is imported from 4 OTHER proposed
   clusters (capital, signal, timing, and render's own siblings) — moving it FIRST means every one of those
   importers gets its `cli.mjs` specifier bumped exactly ONCE (case 2: outside-cluster importing in, while
   the importer is still at `lib/` root) rather than twice. This is the right file to move first for exactly
   that reason — worth stating explicitly, since the plan's original rationale ("low inbound fan-in") was
   about the WRONG direction of fan-in for `cli.mjs` specifically (it has HIGH fan-in FROM other clusters;
   what's true is `render/`'s files have low fan-in reaching INTO other clusters, i.e. cheap as a first move).
   Caveat: `replay.mjs` (render) imports `gatecandidates.mjs` (signal) — this is a real reciprocal edge (see
   next point), so render is not fully self-contained even as the first chunk; it's still the cheapest first
   move, just not a zero-edge one.
2. **`thesis/`** (chunk 2) — confirmed clean via the edge table: no thesis file imports outside `lib/` root +
   `js/`; two OTHER clusters (market's `item-context.mjs`, capital's `freed-capital.mjs`) import INTO thesis
   (`watchstate.mjs`), one-directional. Matches the plan's placement; no correction needed.
3. **Reorder: do `reconstruct/` BEFORE `capital/`, not after.** The edge table shows THREE capital-cluster
   files depend on reconstruct (`limits.mjs`, `ownedledger.mjs`, `derive-cash-tiers.mjs` — all import
   `reconstruct.mjs` and/or `offers.mjs`). Landing `capital/` first (as currently ordered, step 3) means those
   3 files get their `reconstruct.mjs`/`offers.mjs` specifiers bumped ONCE when capital moves (case 3,
   moved-importing-stayed) and then bumped AGAIN when `reconstruct/` finally moves (the new case 6,
   already-moved-cross-cluster). That's a guaranteed double-touch of 3 files, invisible unless the grep sweep
   in the LATER `reconstruct/` chunk explicitly includes `pipeline/lib/capital/*.mjs` (easy to forget since
   "capital chunk is done, why am I touching it again"). Reordering reconstruct before capital removes the
   double-touch entirely — capital's `limits.mjs`/`ownedledger.mjs`/`derive-cash-tiers.mjs` then get their
   reconstruct-import specifiers right in ONE step (case 2, at reconstruct-chunk time) and never touch them
   again when capital itself later moves (case 3, moved-importing-stayed becomes the ONLY remaining edit).
   This does mean reconstruct — flagged in the original plan as "larger fan-in… land it once the recipe is
   proven" — has to move earlier than intended. Given the chunk-0 helper resolves-by-path rather than
   hand-coding cases, the "prove the recipe first" caution matters less than it did under a manual-only
   recipe; recommend proving the helper on `render/` + `thesis/` (chunks 1-2, low-risk) and then running
   `reconstruct/` third specifically BECAUSE it's high-fan-in, not despite it — the earlier it moves, the
   fewer files get touched twice.
4. **`timing/`**, then **`market/`**, then **`signal/`**, then **`capital/`** last (moved from its original
   #3 slot for the reason above).
5. Note the `gatecandidates.mjs` (signal) ↔ `cli.mjs` (render) edge is directional at the cluster level
   (`gatecandidates.mjs` imports `cli.mjs`; `replay.mjs` in render imports `gatecandidates.mjs`) — this is
   TWO separate files each importing the other's cluster, not one file importing itself, so it is NOT a
   circular import and both clusters remain independently movable. It just means `signal/` (last, since it's
   "largest, most cross-referenced" per the original plan — still correct) will touch `replay.mjs` (already
   in `render/`) at signal-move time — expected, covered by the grep-the-whole-tree instruction in recipe
   step 2.

Each is a standalone chunk; skip/re-order freely. Stop any time — a partially-clustered `lib/` is still valid.

## Acceptance (per chunk)

The cluster's files live under `pipeline/lib/<cluster>/`; every importer resolves (`check-imports` green,
noting its entrypoint-coverage gap above — spot-check any touched command outside the 11 covered
entrypoints); full guard suite green (`lint-arch` green requires its `SEARCH_DIRS`/basename-resolution tweak
to have landed in chunk 0 — see Guards); `positions.json`/`screen.json` regenerate byte-identical on an
unchanged log; `README.md` "Map of the repo" **AND** `docs/ARCHITECTURE.md` **AND** `docs/GLOSSARY.md`
entries updated to the new paths (the latter two are CI-enforced by `lint-arch`, not optional polish); a grep
of `.claude/skills/*.md` for the moved basenames confirms no stale pointer (no guard enforces this — manual).
When the LAST cluster lands, fold this doc into `PLAN.md` and delete it.
