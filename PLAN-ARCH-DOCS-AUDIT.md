# PLAN-ARCH-DOCS-AUDIT.md — critical pass over architecture + the whole doc corpus

Status: **PROPOSAL — Ben review required.** Produced 2026-07-10, investigation-only (no code
or doc edited). Per `docs/PLANNING.md` this is a draft; approved chunks fold into `PLAN.md`.

Overall verdict up front, honestly: post-Pipeline-v2 the architecture is in GOOD shape — one
verdict home (`lib/context.mjs` ended the quote/watch fork), declarative strategy specs, pure
fixture-pinned libraries, replay goldens, colocated auto-discovered tests. The real problems
are residue at the seams (below) and a documentation corpus that has outgrown its own
"move-never-copy / one-home" discipline: the same 2026-07-09 rulings now live in three to four
places each.

---

## Part 1 — Architecture flaws / inconsistencies, ranked by real impact

### A1 (HIGH) — `monitor.mjs` reconstructs a book that ignores tombstones
PLAN.md Discovered (2026-07-05, observed live): monitor rebuilds a FIFO from the exchange
log(s) without `coffer-manual.log` REMOVE tombstones, so purged lots reappear as phantom holds
— and an agent already gave wrong listing advice off it once. Two scripts answer "what do I
hold?" differently (`positions.json` via `reconstruct()` vs monitor's in-memory FIFO). This is
exactly the class of same-number-two-ways bug Pipeline-v2 was launched to kill, still open.
**Fix direction (per the existing note):** route monitor through the same event pipeline as
sync (tombstones folded in), or at minimum label the section "live-log FIFO — may include
tombstoned lots". The label is a 5-minute honesty fix; the routing is the real fix.

### A2 (HIGH, conditional on app use) — app Watch tab shows ungated verdicts
The console silences an expected-underwater headline behind a declared hold thesis
(`convictionGate` + `hold-thesis.json`); the deployed Watch tab shows the raw verdict (README
TG1 follow-on). If Ben glances at the phone he can get the whiplash the P0 unification cured
between quote and watch. Owned by `PLAN-APP-PARITY.md` chunk AP3 — listed here because it is a
*verdict-consistency* flaw, not a feature gap.

### A3 (MED-HIGH) — two overlapping thesis stores, both carrying a `tripwire`
Gitignored `.cache/session-thesis.json` (free-text intent) and tracked `hold-thesis.json`
(gating, numeric tripwire, path-carrying) are BOTH written via `thesis.mjs set`, with
`--tripwire` targeting the session store (a string) while hold-thesis's is numeric. The P4a
follow-on already flags the confusion ("sole writer" was wrong). A P8 single-writer desk
orchestrator will trip over this. **Fix direction:** one CLI surface, one declared-plan store
(hold-thesis) + one scratch-intent store with NO overlapping field names; a migration note in
FILLS-PIPELINE. Judgment-heavy (product semantics), needs Ben.

### A4 (MED) — validator coverage is asymmetric across surfaces
The v2 principle is "validators on EVERY surface", but coverage differs by data availability:
`screen.mjs` fetches ts1h for survivors so reach/trajectory FIRE; `quote.mjs` doesn't, so reach
degrades to pass on the surface Ben uses for explicit asks (the P2 follow-on); `--mode value`
renders via `valueGate`, bypassing `runValidators`, so `limitValidator` never reaches it (PLAN
Discovered, LM1 note). The docs are honest about each gap individually, but the aggregate is a
quiet inversion: the *explicit-ask* surface has the weakest validation. **Fix direction:** a
budgeted ts1h fetch on `quote.mjs` (it's 1–2 items per invocation — cheap), and a validators
pass in `renderValueMode` when value graduates. Mechanical once decided.

### A5 (MED) — two rating philosophies for "which flip is best"
App Finder: `js/market.js` `ratingParts` (profit/hr × quality dampener) — the pre-P6b
philosophy Ben explicitly rejected for the console ("I despise gp/d"). Console: per-thesis
rank `net × P(fill) ÷ TTF` (`lib/estimators.mjs`) + `rating.mjs` grades. Same question, two
models, different orderings. Deliberately deferred (calibration placeholders + app deferral),
but it should be RECORDED as a known fork with a planned convergence point (post-F1), which no
doc currently does. Also inside the console: per-lap churn ranks clump at S+ because
`rating.mjs` cutoffs are per-unit scale (documented honest limit, calibration-gated).

### A6 (MED) — `screen.json` channel freeze is turning the Scan tab into a husk
~8 console features are "stdout-only, never in screen.json" by ruling; the published artifact
shape froze while the console's read of the same rows got richer. Correct under the app
deferral, but the drift compounds per feature. Owned by `PLAN-APP-PARITY.md` AP2 (versioned
additive schema) — flagged here as the structural cause of most app/console drift.

### A7 (LOW-MED) — latent single-writer hazards around watch-state
`quote.mjs --positions`' read-only `pathsStage` mutates `ctx.position.newStateEntry` it never
saves (P4b follow-on) — harmless now, a booby trap for P8. Companion P0 follow-on: quote's
conviction runs without the structural-support arm (no ts1h). Both are known and written down;
they belong IN the P8 spec (PLAN-DESK-AGENT.md DA2 says the same).

### A8 (LOW) — small duplications / seams, all known, none urgent
- `parseGp` exists in `pipeline/cli.mjs` and `js/format.js` with different behavior
  (intentional; the agreed one-line cross-comment is still missing).
- Log-file discovery near-duplicated (`sync-fills.readLogFiles` vs `offers.readExchangeLog`).
- `quote.mjs` vs `screen.mjs` can log different liquidity `class` for the same item in
  `suggestions.jsonl` (different volume sources) — a calibration-data pollutant once F1 opens;
  unify the volume source before F1, not after.
- `js/backup.js:23` UTC date slug (cosmetic).
- `js/` directory semantics have quietly changed: it now holds 6+ `.mjs` modules the app never
  imports (validate, termstructure, valuescreen, paths, strategies, windowread). The `.js` =
  app-served / `.mjs` = shared-not-yet-app convention is real but UNWRITTEN — one paragraph in
  README "Map of the repo" would make it deliberate instead of accidental.

### Sound structures worth affirming (no action)
The ROOT-LOCKED vs movable split is well-mapped and correct; the CLI-vs-lib `pipeline/`/`lib/`
split (OR2) is doing its job; shared `js/quotecore.js`/`format.js` genuinely prevent the app
and pipeline computing tax/break-even/quotes differently — the one place the "same number two
ways" risk is structurally solved; the replay golden harness pins the funnel.

---

## Part 2 — Documentation audit (whole corpus)

Corpus: CLAUDE.md (~450 lines), README.md (718), PLAN.md (564), CHANGELOG.md (1224),
docs/LORE.md (93), docs/PLANNING.md (70), docs/SKILL-TRIAGE.md (153), pipeline/MONITORING.md
(600), pipeline/FILLS-PIPELINE.md (729), skills: /scan 466, /positions 283, /overnight 154,
/morning 117, /ship 163; plus module/test header comments.

### Q1 — Additive vs noise

**High-value (keep, these earn their bytes):** CLAUDE.md's ask→command routing table; the
"Where shipped work is documented" pointer map; README's ROOT-LOCKED table + shared-module
ripple map + test-location convention; PLANNING.md (short, sharp); LORE.md (exactly what it
says); SKILL-TRIAGE.md (the semantic record behind skill-lint); the honesty tags throughout.

**Low-value / noise (specific):**
- **CLAUDE.md's market-analysis section has re-bloated after two slimming rounds (K3, P7).**
  The Bar D bullet ends "The ONE home for this is the `bandCore` header in `js/strategies.mjs`"
  — yet CLAUDE.md itself carries ~15 lines of Bar D spec above that sentence. Bar E: same
  pattern (full spec + "Pinned by `pipeline/bandedge.test.mjs`"). The value niche carries FOUR
  consecutive same-day ruling paragraphs (deployable-capital, artifact/liquidity hardening,
  RC1 recency anchor, trajectory-GATE) totaling ~70 lines, each of which ALSO lives in
  README's `valuescreen.mjs` entry and in the landing commit messages. CLAUDE.md here reads as
  a changelog, not a routing doc — the "supersedes the same-day VALUE_ABSGP_* boost" narrative
  is history (LORE/CHANGELOG material), not an operating fact.
- **README "Files" entries have become full spec restatements.** `valuescreen.mjs` ~20 lines,
  `watch.mjs` ~20 lines, `context.mjs` ~16 lines — the registry's contract (purpose, contents,
  producer/consumer, per rule 8) needs 2–4 lines each; the spec belongs in the module header it
  already duplicates.
- **PLAN.md "Discovered — Open" holds finished work.** Bar D, Bar E, churn Step 6, and the
  spread/rising resolution are all marked DONE inside the *Open* list, each with a full spec
  paragraph — violating the file's own discipline ("shipped-chunk detail lives in the commits,
  not here"). ~120 lines of done-work prose in the open list.
- **`index.html:103`** (deployed!) still describes Band/Spread/Rising/Churn and "Falling items
  are excluded" — actively false on the public page (owned by PLAN-APP-PARITY AP1).

### Q2 — General enough, or over-fitted to one incident?

The one-line named anchor ("the Hydra leather buy", "the bones miss") is the house style and
works. What has over-grown it is the **multi-paragraph incident story embedded in a skill**:
- `/scan` "Anchor pricing" — ~27 lines for an n=2 rule, including both full fill narratives
  with prices (PLAN.md executor rules explicitly say "Do NOT paste live data … it rots").
- `/scan` "Froth entry" — ~19 lines around one webweaver case.
- `/scan` "Asymmetric ask-reach read" + nested RC1 sub-bullets — ~45 lines whose enforcement
  half is now CODED (reach validator, Leg B, `⚠ stale` split); the story parts (Dharok's, blood
  rune, Hydra) have earned one line each, not paragraphs.
- `/positions` DWH trajectory anchor — the method (numbered steps) earns its place; the
  15-day price-by-price DWH narrative is LORE material.
These blocks were all triaged KEEP-AS-JUDGMENT in SKILL-TRIAGE (correctly — the *judgment* is
real), but the triage judged disposition, not LENGTH. Proposal: keep every rule, compress every
story to `rule + named anchor + (story: LORE.md)`. Estimated /scan shrink: 466 → ~300 lines
with zero rule loss. Needs Ben sign-off per the P7 precedent (retires/compressions are
Ben-gated).

Also over-fitted: CLAUDE.md's value-niche narrative (Q1 above) — four snapshots of one day's
iteration retained as if each were an operating rule.

### Q3 — Prose that could be CODIFIED (the priority, per `docs-small-encode-in-scripts`)

Concrete candidates, prose → code:

1. **Doc-drift lint (`pipeline/doclint.mjs`) — the meta-fix.** Rule 8's "grep the docs for
   superseded statements" is itself only prose. A tiny CI test with a maintained denylist:
   superseded terms × files (e.g. `Spread`/`Rising` as live niches in `index.html`/CLAUDE.md;
   "Falling items are excluded" unqualified; `--mode spread`). When a ruling deletes a concept,
   the executor adds a denylist line — CI then catches every future doc that resurrects it.
   Cheap, mechanical, high leverage; the skill-lint precedent proves the pattern.
2. **Quote-basis ordering invariant → test.** CLAUDE.md: "on consistent bases
   optBuy ≤ quickBuy ≤ quickSell ≤ optSell holds; a break on MIXED bases is a bug (fix the
   script)." Only prose today. Encode as a `quotecore.test.mjs` fixture assertion over
   consistent-basis inputs + a runtime debug assert gated off in production paths.
3. **`/overnight` accumulation formula → script.** The skill hand-computes
   `min(buyLimit × 2, 8/24 × 0.10 × volDay)` with a prose plea to "keep the constants aligned
   with `screen.mjs`'s `expUnits`" — alignment-by-prose is the canonical drift generator. Add
   `expUnitsOvernight()` beside `expUnits` in `lib/gatecandidates.mjs` and have
   `screen.mjs --posture overnight` print the accumulation-and-capital table itself; the skill
   keeps only prioritization judgment.
4. **Cut-and-rebid friction bar → helper.** `/positions`: the pair only beats holding if the
   rebid sits "more than tax + half the spread below the clear (~2.5%+)". A pure
   `rebidBar(clear, spread)` in `js/quotecore.js` + an advisory line where CUT verdicts render
   — the agent stops re-deriving arithmetic in prose.
5. **`/morning` weekly-read trigger → marker.** "Run on the first /morning of each week; if
   unsure whether it already ran, ask Ben" — a `.cache/last-weekly-report` stamp written by
   `outcomes.mjs --report` plus a `--weekly-due` check removes the ambiguity entirely.
6. **Timing-target rule → extend the diurnal block to `quote.mjs`.** "Every recommended price
   states its timing target" is enforced-by-agent today; `screen.mjs` already auto-prints the
   diurnal BID/ASK block. Running the same `hourProfile` on quote's per-item read (it fetches
   the needed series or can, cheaply, for 1–2 items) puts the timing data on the surface where
   prices are actually pitched.
7. **Stale-book banner → shared.** `/positions` prose says "act on the stale banner"; only
   `watch.mjs` prints one. A `positions.json` age banner in the shared context chain
   (`quote.mjs --positions` too) makes the prompt appear wherever the book is read.
8. **Suggestions liquidity-class unification (A8)** — not prose, but the F1-data-quality fix
   that several honesty notes currently paper over.

Weak candidates (leave as judgment): fresh-read-before-acting (can't be enforced agent-side
beyond watch's per-tick re-quote); one-line-per-item (already script-owned where it matters via
`briefBook`); entry-aggression posture (taste).

### Q4 — Redundant prose (restates code / duplicates another doc / superseded)

- **The 3–4-home rulings:** Bar D, Bar E, churn per-lap, value deployable-capital/RC1 each live
  in CLAUDE.md + README module entry + PLAN.md Discovered + the module header/commit. One home
  (module header) + pointers everywhere else is the stated policy; apply it.
- **`/positions` §3 verdict table vs `pipeline/MONITORING.md` step 4.** The skill says
  "Vocabulary = MONITORING.md step 4" and then reproduces a full 10-row verdict table with
  interpretation. The interpretations differ in wording, which is exactly how the
  0.30.0→0.33.0 incident started. One table should be the home; the other a pointer.
- **CLAUDE.md "Script facts" bullets vs README pipeline entries** — quote.mjs/watch.mjs/
  screen.mjs each described at length in both, drifting independently (README's is inventory,
  CLAUDE.md's is behavior — the split is defensible but the current text overlaps ~60%).
- **Superseded framing kept alongside its replacement:** CLAUDE.md still narrates NY2/NY3 and
  the VALUE_ABSGP boost as "SUPERSEDED (same day)" — resolved history that belongs in
  CHANGELOG/LORE; the operating doc should state only the current rule.
- `/morning` section numbering runs 1,2,3,5,4,6 (mechanical tidy).
- Memory `execute-plans-off-main` says "no PRs (gh is API-reads only)" — dated per
  SKILL-TRIAGE's own note; a one-line refresh next time memory is touched.

---

## Part 3 — Chunked cleanup plan

Order: mechanical/correctness first, judgment-heavy compressions last (they need Ben rounds).

| # | Chunk | Nature | Primary files |
| --- | --- | --- | --- |
| ARCH-1 | monitor.mjs tombstone fold-in (or, minimum, the honest section label) | mechanical-ish; the routing fix touches reconstruction — read FILLS-PIPELINE §5.1 first, pin with a tombstone fixture | `pipeline/monitor.mjs`, test |
| DL1 | `pipeline/doclint.mjs` + seed denylist (spread/rising-as-live, unqualified falling-exclusion) + CI wire | mechanical, new test auto-discovered | `pipeline/doclint.mjs`, `checks.yml` |
| COD-1 | Quote-basis ordering invariant test | mechanical | `pipeline/quotecore.test.mjs` |
| COD-2 | Overnight accumulation table into `screen.mjs --posture overnight`; `/overnight` §6 shrinks to prioritization judgment + pointer | mostly mechanical; formula already specified | `lib/gatecandidates.mjs`, `screen.mjs`, `/overnight` SKILL.md |
| COD-3 | `rebidBar` helper + advisory line; weekly-read marker in `outcomes.mjs` | mechanical | `js/quotecore.js`, `pipeline/outcomes.mjs`, skills pointers |
| COD-4 | quote.mjs budgeted ts1h → reach fires on explicit asks; shared stale-book banner in context chain; diurnal line on quote | mechanical once approved (small fetch-budget decision for Ben) | `pipeline/quote.mjs`, `lib/context.mjs` |
| DOC-1 | PLAN.md Discovered prune — DONE items collapse to Status-style one-liners | mechanical | `PLAN.md` |
| DOC-2 | CLAUDE.md diet round 3 — Bar D/E, churn, value paragraphs → verified module headers + 1–3-line pointers; superseded narratives → LORE/CHANGELOG. **Move never copy: verify the header actually carries the invariant BEFORE deleting the CLAUDE.md text** | judgment-light but care-heavy | `CLAUDE.md`, module headers, `docs/LORE.md` |
| DOC-3 | README "Files" compaction to registry-grade entries (purpose/producer/consumer, 2–4 lines) with header pointers | judgment-light, large diff | `README.md` |
| DOC-4 | Verdict-table single-home: MONITORING.md step 4 keeps the tree; `/positions` §3 keeps action-mapping ONLY where it differs, pointer otherwise; fix `/morning` numbering | judgment-medium (wording reconciliation) | `MONITORING.md`, skills |
| DOC-5 | Skills anchor compression — stories → LORE.md, `rule + named anchor` stays; strip pasted live prices per the executor spec-style rule | **judgment-heavy, Ben-gated** (P7 precedent: compressions are proposals until signed off); ship as a disposition table first | skills, `docs/LORE.md`, `docs/SKILL-TRIAGE.md` |
| ARCH-2 | Thesis-store unification (one CLI, disjoint fields) | judgment-heavy, needs Ben ruling on semantics | `pipeline/thesis.mjs`, `lib/sessionthesis.mjs`, `lib/holdthesis.mjs`, docs |
| ARCH-3 | Suggestions liquidity-class source unification (pre-F1 data hygiene) + parseGp cross-comments | mechanical | `pipeline/quote.mjs`/`screen.mjs`, `lib/`, `js/format.js` |

Cross-references, not duplicated here: `index.html`/`ui.js` stale copy = PLAN-APP-PARITY AP1;
app Watch ungated verdicts = AP3; screen.json schema = AP2; P8 hazards = PLAN-DESK-AGENT DA2.

## Encoding boundary
DL1/COD-1..4 move enforcement from prose to code (the standing preference). DOC-2/3/5 move
prose between homes — they encode nothing and must not silently delete judgment; DOC-5 ships a
disposition table for Ben exactly like P7 did.

## Bookkeeping & compatibility
- DL1's doclint gets a README inventory entry + CI note; it must stay a denylist (never a
  semantic checker — the skill-lint honesty note applies verbatim).
- DOC-2/3 are reconciliation passes (rule 8): every deletion is a verified MOVE with the
  receiving home named in the commit message.
- No APP_VERSION implications anywhere in this plan (AP1's app fix lives in the parity plan).

## Honesty (process rule 4)
- Impact rankings in Part 1 are judgment; only A1 has a demonstrated live cost (the 2026-07-05
  phantom-lot advice).
- The line-count shrink estimates (e.g. /scan 466→~300) are eyeballed, not measured.
- DL1 catches only what its denylist names — it prevents *recurrence* of known drift, not novel
  drift; the wave-start Sonnet drift scan stays necessary.
- DOC-5 risks losing texture that has genuinely guided sessions; that is why it is Ben-gated
  and table-first rather than executed blind.

---

## Part 4 — 2026-07-14 refresh (re-audit before the rename/hardening effort)

Parts 1–3 above are the 2026-07-10 snapshot. This section RECONCILES their status against the
live code (several shipped; a couple are more open than stated; one sub-point is now factually
wrong) and adds findings the first pass missed. Verified in-code, not from docs.

### Status reconciliation of Part 1 (A1–A8)

| Item | 2026-07-14 status | Evidence |
| --- | --- | --- |
| A1 monitor tombstones | ✅ **SHIPPED** (ARCH-1) | `monitor.mjs:66` — REMOVE tombstones ROUTED through the shared FIFO; header affirms "REMOVE tombstones applied" |
| A2 app Watch ungated verdicts | ⛔ open | owned by PLAN-APP-PARITY AP3 |
| A3 two thesis stores | ⚠️ **PARTIAL** | `clear` now clears BOTH (FIX 2, `thesis.mjs:18`) + header documents the split; but two stores + the overlapping `--tripwire` (string in session-thesis vs numeric in hold-thesis) still coexist — the P8 hazard stands |
| A4 validator coverage asymmetry | ✅ **mostly SHIPPED** (COD-4) | `quote.mjs` now fetches budgeted ts1h → reach/trajectory fire on explicit asks; the `renderValueMode` runValidators bypass may remain (low, value is off-by-default) |
| A5 two rating models | ✅ **functionally CLOSED** (AP4) | `market.js:230` — Finder Grade/Rating/sort use `it.desir` = `desirabilityOf()` = the shared `estimateRank`+`rateItem`; residue → N4 |
| A6 screen.json husk | ⛔ open | PLAN-APP-PARITY AP2 |
| A7 watch-state single-writer hazards | ⛔ open | P8 / PLAN-DESK-AGENT DA2 |
| A8 small dups + `.js`/`.mjs` convention | ⚠️ **sub-point STALE** | the "app imports none of the `.mjs`" claim is now WRONG → N3; parseGp cross-comment + log-discovery dup still open |

### New findings (not in the 2026-07-10 pass)

**N1 (MED-HIGH) — vestigial `rising`/`spread` scaffolding, node-only.** The deleted niches left a
live skeleton across 7 files: `risingPoolFloor()` (never invoked — no spec sets
`pool.risingFloor:true`); `RISE_MID_FLOOR`/`RISE_LIQUID_VOL` (`screen.mjs` + `gatecandidates.mjs`
+ 2 test fixtures); `pool:{risingFloor:false}` on all 4 live specs + its schema validation;
`'proxy'` rank + `'rising'` estimator family (valid vocabulary no spec uses); a **dead
`if (mode === 'rising')` branch** in `surviveMode` (`gatecandidates.mjs:347`); ~20 lines of
"kept for re-add" prose; a test pinning the unused predicate. CLAUDE.md states git history is the
re-add reference — carrying live scaffolding as a hedge contradicts that. **Fix:** delete the
cluster. `strategies.mjs`/`gatecandidates.mjs` are node-only ⇒ **no APP_VERSION**.

**N2 (MED) — `spec.confirm` is a dead "looks-load-bearing" field.** Declared on all 4 specs
(`'falling'` on scalp, `null` else) and schema-validated (`strategies.mjs:314`), but **no consumer
reads it** — `surviveMode` hardcodes `mode === 'scalp'` (`gatecandidates.mjs:357`). This is the
exact drift P4c claimed to have removed. **Fix:** make `surviveMode` read `spec.confirm === 'falling'`
and delete both the `scalp` and dead `rising` branches. Node-only ⇒ no APP_VERSION. Pairs with N1.

**N3 (MED) — the `.js`/`.mjs` extension no longer signals app-vs-node blast radius (supersedes A8's
sub-point).** Verified import graph from `js/main.js`: **app-imported `.mjs`** = `estimators`,
`rating`, `windowread`, `validate`, `termstructure`, `forecast` (6 — via `market.js`/`trends.js`,
wired by AP4 + TV 0.58/0.60); **node-only `.mjs`** = `strategies`, `paths`, `valuescreen` (3). A8's
"app never imports the `.mjs`" is now false. This is a **live rename LANDMINE**: editing OR renaming
any of the 6 app-imported modules is an APP change (APP_VERSION), while the 3 node-only ones are
free. **Fix direction:** record the accurate split in README "Map of the repo", or better — move the
app-imported shared modules into a legibly-named location so blast radius is visible from the path.

**N4 (LOW-MED) — vestigial app-side rating scorer (residue of A5/AP4).** `market.js` still computes
`ratingParts` + `it.rate`/`it.riskIndex`/`it.score` (`:225–227`), explicitly marked VESTIGIAL
("no longer rendered or sorted on… kept only until RATE_W is fully torn out"). Deletable with the
`RATE_W`/`RATE_ROI_MAX`/`RATE_VOL_MAX`/… constants, PRESERVING `it.pph` (still the Profit/hr column).
APP change ⇒ **APP_VERSION bump**.

**N5 (LOW) — tax math split across two homes.** `breakEven`/`maxBuyForExit` in `quotecore.js`,
`netMargin`/`bondFee` in `format.js`. Defensible (format is the low-level shared home) but the split
rule is unwritten — a one-line home-comment fixes it.

**N6 (LOW, note only) — `estimators.mjs` god-module.** 607 lines / 30+ exports spanning distinct
concerns: pFill families, ttf families, `reachRelief`, `askReachFactor`, `asymEstimate`, the rank
composition (`rankScore`/`estimateRank`), the est-view reconciliation (`estimatePair`/`entryDoctrine`),
AND display formatting (`fmtTtf`). Split candidate by concern, but it's app-imported (higher risk,
APP_VERSION, import churn) — **flag, do not act** pending the rename effort deciding module boundaries.

### Hardening batch proposal (blast-radius-grouped)

- **Batch H1 — node-only, no APP_VERSION** (mechanical, test-pinned): N1 + N2 (they're one cluster —
  delete rising/spread residue AND make `surviveMode` spec-driven). De-clutters the vocabulary the
  rename touches. Replay goldens + `strategies.test`/`gatecandidates.test`/`subfloor.test` must stay green.
- **Batch H2 — app-side, APP_VERSION bump**: N4 (tear out the vestigial `RATE_W` scorer). Smoke + a
  Finder render check required.
- **Docs/convention** (fold into task #3 doc-cleanup): N3 (write the real blast-radius split) + N5
  (tax-split home-comment) + the still-open A8 dups.
- **Deferred, judgment-heavy** (own chunks, need Ben rulings): A3 thesis-store unification, N6
  estimators split — both interact with the rename's module-boundary decisions, so they wait for it.

### Honesty (rule 4)
- N1/N2/N4 severities are the "dead code carries complexity" judgment, not a demonstrated live bug —
  none has caused a wrong trade; the cost is comprehension + rename-surface, which is exactly this
  effort's target.
- N3 is a fact (the import graph), not a judgment; its FIX direction (relocate vs document) is the judgment.
- Whether the `renderValueMode` validator bypass (A4 residue) still exists was not fully traced — value
  is off-by-default/provisional, so it's low priority; verify if value graduates.

---

## Part 5 — root causes + preventive guards (Ben 2026-07-14: "encode rules so this doesn't recur")

The N-findings are SYMPTOMS. Each belongs to a recurring ROOT-CAUSE CLASS; the leverage is a CI GUARD
that catches the whole class, in the repo's existing mechanical-guard tradition (`import-check.mjs`,
`doclint.mjs`, `skill-lint.mjs`, `smoke.mjs` — a denylist/structural checker, NEVER a semantic/LLM one).
**Guard-first sequencing:** build the guard, watch it FLAG the known instances (proof it bites), THEN
land the fix (H1/H2) and watch it go GREEN — the guard both drives the cleanup and prevents regression.

| RC | Root-cause class | Findings | Encodable guard (proposal) | Cost / caveat |
| --- | --- | --- | --- | --- |
| **RC-A** | Vestigial "kept for future re-add / until torn out" code — a deleted concept's scaffolding retained as a hedge, against CLAUDE.md's "git history is the reference" rule. It then rots + inflates the rename surface. | N1, N4 | **Orphan-export lint** — extend `import-check.mjs` (already parses the whole import graph): flag any exported symbol referenced by NOTHING outside its own `*.test.mjs`. `risingPoolFloor` is exactly this (exported, only its own test calls it). | Needs a small allowlist for genuine public entrypoints (CLI mains, app-served bundle roots). Static ref-count only — won't catch dynamic/string dispatch, but this codebase uses static imports. |
| **RC-B** | Declared-but-unread config/spec field — a schema field that's SET + validated but no consumer reads, so it reads as load-bearing while the real logic branches elsewhere. | N2 | **Behavioral conformance test** — the `strategies.test.mjs` conformance suite asserts each spec FIELD drives an observable effect. Concretely: a `surviveMode` fixture pinning `confirm:'falling'` ⇒ a non-falling row drops (`notFalling`), which the current `mode==='scalp'` bypass would fail once the hardcode is removed. | Generic "unread field" detection is hard; the pin is per-field. Cheap for the ~13 spec fields; each new field earns a pin. |
| **RC-C** | Unwritten / drifted blast-radius convention — the `.js`=app / `.mjs`=node rule silently broke as `trends.js`/`market.js` began importing shared `.mjs`; an editor can't tell APP_VERSION scope from the path. | N3 | **App-import manifest test** — a fixture walks the real import graph from `js/main.js` and asserts the set of reachable modules EQUALS a declared allowlist. A new app-import of a shared module then FAILS CI until the manifest is updated (forcing the editor to acknowledge the new APP_VERSION blast radius). Pairs with the hierarchy move (below) that makes the split visible by path. | The manifest is hand-maintained, but that's the point — the update is the acknowledgement gate. |
| **RC-D** | Findings/status-doc drift — the 2026-07-10 audit's statuses went stale (shipped items still marked open). | (the audit itself) | Lighter, process not code: the wave-start drift scan already exists; keep audit docs status-reconciled at each pickup (this Part 4 did it). Not worth a CI check. | — |

### Hierarchy (Ben 2026-07-14: "establish some hierarchy, not just flat") — folds into RC-C

`pipeline/` (~80 files), `pipeline/lib/` (~40), and `js/` (~30) are near-flat. A directory HIERARCHY is
the STRUCTURAL form of the RC-C guard: if app-imported shared modules live in a legibly-named folder
(e.g. `js/shared/` for the 8 the app + node both use: `quotecore`, `format`, `estimators`, `rating`,
`windowread`, `validate`, `termstructure`, `forecast`) and node-only strategy/pipeline logic lives
elsewhere, blast radius is READABLE FROM THE PATH and the manifest test guards the boundary. The
hierarchy design is owned by the rename review (task #2); it must respect the ROOT-LOCKED artifact
filenames + the `js/` app-served bundle roots (moving an app-imported module changes its `import`
specifier → an APP_VERSION-class change, so the moves are part of the phased rename, not free).
