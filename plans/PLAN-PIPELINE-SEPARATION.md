# PLAN-PIPELINE-SEPARATION — separating measurement, interpretation, labeling, and rendering in the read path

**SEP16a SHIPPED** `d500e36` + review-fix `0569000` — the shared watchlist reader (`pipeline/lib/config/watchlist.mjs`) now backs the five node-side loaders; the app keeps its own `fetch` resolve and is NOT covered by the tripwire. Review corrected two claims this plan made: SIX call sites died on a malformed file, not five (`screen-flip-niches.mjs` reads it twice), and a malformed entry cost exactly ONE member rather than emptying the set.

**Status:** r6 — **EXECUTION BEGUN on the ship-first front** (owner ruling 2026-08-25; the
coordinator is executing, starting with the runner change SEP1a). r1–r4 were drafting rounds
(r1 initial; r2 vs adversarial round 1; r3 vs the owner's scope ruling; r4 vs round 2 of the
cap-5 count); r5 was a FOLD-IN round: two new owner rulings (watchlist separation, diurnal-hours
precision), one live defect recorded (the quiet-mode section loss — SEP16), one open defect logged
un-diagnosed (the duplicate digest row), no other scope added. **r6 is a SCOPING + CORRECTION round
on SEP16 only:** it RETRACTS r5's live-defect claim (`039972e` already fixed the dump half — the
file contradicted itself at `:456`), restates SEP16's warrant on the permission/report conflation,
expands it into five sub-chunks with two costed forks recorded as decisions, adds one open ruling
(R-retrohorizon) and one latent defect (`analyze.mjs`'s perNiche bucket). No other chunk changed.
Every code claim verified by reading or running the cited file; claims from a review round I could
not independently reproduce are marked `[r1-measured]`/`[r2-measured]`. Disagreements are argued
inline — two r1 pushbacks held, three r2 amendments are recorded below at their point of use.
**Chunk prefix:** `SEP*` — unique across `plans/` + `PLAN.md` (grep-checked). Findings are labelled
with words (`Cause A`…); the letter-number space is for shippable chunks.

**r5 disposition summary (fold-in).** (1) The dump gap is BIGGER than r4 reported — coordinator
ran the quiet default and only band + churn survive anywhere machine-readable; the digest still
prints to quiet stdout, but amplitude, watchlist, dip pool and watch-closely reached NEITHER
stdout NOR the dump. **CORRECTED r6 (2026-08-25) — the second half of that claim is now STALE, and
was left contradicting `:456`/§7 inside this same file: commit `039972e` wrapped all four surfaces
in `captureReport` (watchlist at `screen:2998`, watch-closely `:2990`, dip pool `:2997`, amplitude
`:2976`).** `captureReport` (`screen:349-363`) swaps `console.log` for a line buffer, pushes the
buffer into `REPORTS` — the DUMP — then replays it through the saved sink, which under the quiet
default is the no-op. So the honest statement is: **they reach the DUMP but not stdout.** The
watchlist is therefore no longer silently lost, and SEP16 is no longer a live-defect chunk; it
survives on the OTHER half of its warrant — R-watchlist's ruling that a distinct question gets a
distinct command, plus the report/permission conflation SEP16 now carries (§7). SUPERSEDES r4's
"write the watchlist into the dump" (already true via the wrap).
(2) Owner ruling R-diurnal + coordinator measurement fold into SEP14: cutting the diurnal HOURS
clause saves ~1,400 tokens, not ~10,000 — the expensive segment sharing that line is the
liquidity/tranche/price-knee sizing read (~5,524 tokens), which is LOAD-BEARING and stays.
(3) One open defect recorded, not diagnosed: `Webweaver bow (u)` printed TWICE on one digest
board, same pass, both A− `fill-now`, one with a reach tick and one without (§3, open-defects
note). (4) Execution status: SEP1a in progress by the coordinator.

**r4 disposition summary.** ONE chunk is replaced on an owner override: the per-niche-tables
opt-in (r3's SEP14) is **REJECTED by the owner, verbatim: "I'd rather not make per-niche tables
opt in — I want to check all niches when I scan."** Full niche coverage on every scan is a HARD
CONSTRAINT (it is also standing doctrine — the coverage rule exists because a prior session let one
salient sub-task become the only niche evaluated). The instruction I acted on in r3 predated the
override; the process record stays visible here rather than being silently swapped. The
cheapest-largest-win framing SURVIVES because the tokens are not where the niches are: round 2
measured a real `--verbose --digest --mode all` run at ~45,572 tokens, of which ALL FOUR niche
tables total 7,795 and per-row NOTE families ~32,000 (the single largest item: the per-survivor
diurnal-timing line, 10,077 tokens in band alone) [r2-measured]. SEP14 is rewritten as a
decision-surface stdout mode + a COMPLETE render dump + a per-item note reader (§7) — and the
dump-completeness half is a verified real gap, not a flag flip: the current dump holds exactly TWO
reports (band + churn; verified 2026-08-25 by reading `pipeline/.cache/last-report/screen.json` —
2 entries), while the digest (`screen:3019`, realLog), watchlist (`:2540`, bare console.log),
amplitude (no `emitReport` call — the only emit site is `:1995`) and dip pool are console-only.
Everything else from round 2 was already addressed in r3 and carries forward unchanged (ledger
pruning + reset, both skills' hardcoded verify path, falsifier observers, the console lint's
test-scope policy, the plan-deletion loophole + self-certifying lifecycle guard).

**r3 disposition summary.** The owner ruled a **ship-first front of four** (§7 Front); the rest is
re-sequenced behind it. Chunks whose premise round 2 falsified are rewritten or retired **with the
reason recorded**: the private per-suite tail contract is RETIRED (ten suites already emit TAP —
reinventing it + exempting them is the rot pattern this plan fights); the label-kinds rendering
registry is RETIRED (the output is hedge-SATURATED, not hedge-poor — a 194th mark fixes nothing;
what remains of that chunk is the guard repair, the log discriminator, and a grade-basis gloss);
the production-spearman dedup is RETRACTED (the second "production" copy is in `experiments/` —
verified). Two coordinator self-corrections are incorporated: the goldens-can't-be-trusted ordering
argument was stale (re-run: zero silent suites today — the runner chunk is insurance, not repair),
and the formatter-home relocation rationale was false (windowread is ALREADY app-bundled —
`js/quotecore.js:40`, `js/trends.js:7`, verified — and `js/money-format.js` has zero imports,
verified; the formatter goes to `js/estimators/reach.mjs` beside `reachFraction`, putting the basis
vocabulary and its formatter in one module).

## 1. Context / diagnosis — the problem in the owner's words

> "It really feels like we routinely confuse ourselves. It's not clear how we get certain numbers or
> why we never realize things are failing silently or only discovering issues after we think we're
> done. It's time to get organized and streamline the pipeline so that we have proper separation of
> concerns. Particularly around the labeling and interpretation layers, behavior is not consistent
> (ie how much do we look into for digest)."

Anchor incidents (each verified; file:line evidence in §3):

- **The big-ticket capital miscount.** `big-ticket` compares a per-UNIT price at four sites and a
  per-LOT value at three; a doc equated the two semantics and shipped a wrong figure
  (`CHANGELOG.md:31-37`: 60.1% by unit vs 82.1% by lot value).
- **A measured-worthless tag still rendered as a verdict.** The digest prints `sell unreliable`;
  `join-reach-basis.mjs` measured that exact tag as losing to not-gating-at-all below cost ratio
  ~1.29 — and the finding landed as a code COMMENT (`screen-flip-niches.mjs:763-766`) while the
  verdict rule one screen up (`:728`) still fires the word as priority 1. Four candidate rows were
  dismissed on it without inspection. **Owner ruling 2026-08-25: delete the rule** (§7 SEP12).
- **S+ beside a negative displayed net.** Grade rates a different price pair than the one the table
  prints; the correction ships as prose (`.claude/skills/scan/SKILL.md:31-38`, measured: three churn
  rows at S+/S+/S− on displayed nets of −6, −48, −23).
- **Seven reach quantities, one token shape.** `11/14` in-window beside an all-day cushion missing
  5 of 7 days, nothing distinguishing them (§3 Cause A).
- **Stale live prints anchoring the primary sell column.** Four items quoted an ask that WAS the
  live instabuy aged 14–64 min, each reaching 0/7 days; the ⚠ note fired in a different channel.
- **31 assertions, zero bytes, green tick.** `pipeline/test/render.test.mjs` passed silently
  (import-scope cause FIXED at `quote-items.mjs:1037-1044`, `8dd5bc2`; re-run 2026-08-25: zero
  suites currently silent). The runner hole remains open — insurance, not live repair (§3 Cause E).
- **Depth of inspection undefined.** Of 8 digest rows: 3 trio-verified, 4 dismissed on a single
  token, 1 never mentioned — and the niche-coverage rule made the output LOOK complete. Round 2
  adds the budget arithmetic (Cause H): the digest is ~407 of ~45,572 stdout tokens — under 1%
  of the read, whose bulk is per-row note families, not niche tables.

## 2. The read path as it exists today (the layer map)

| # | Stage | Owner (verified) | Notes |
|---|---|---|---|
| 0 | Acquisition | `pipeline/lib/market/marketfetch.mjs`, `pipeline/lib/market/archive.mjs` | timestamps + volumes originate here |
| 1 | Per-item quote synthesis | `js/quotecore.js` `computeQuote` (:348) | fuses live pair, band (`robustBand` :326), momentum, regime, staleness flags (:481-485) — a deliberate one-home fusion |
| 2 | Window/diurnal statistics | `js/windowread.mjs` (`windowStats` :254, `hourProfile` :1205, `recencySplit` :78, `reachMargin` :754, `windowClear` :864) | pure math leaf — but ALREADY app-bundled (`quotecore.js:40`, `trends.js:7`) and already exporting nine formatters (r2 correction to r1's "pure leaf ⇒ no formatters" reading) |
| 3 | Estimates | `js/estimators/pair.mjs` `estimatePair` (:196); `families.mjs` `estimateRank` (:354); `reach.mjs` (`reachFraction` :94); `cells.mjs` | `cells.mjs` is render-projection code living in the estimates module (mis-filed in r1 — itself a small instance of the boundary blur) |
| 4 | Labels / verdicts | `js/rating.mjs` `rateItem` (:220); `js/quotecore.js` `momVerdict` (:638); `js/validate.mjs`; **`screen-flip-niches.mjs` `digestVerdict` (:723)** — labeling inside a command entrypoint | |
| 5 | Rendering | `pipeline/lib/render/render.mjs` `renderReport` (:174) + `mdTable` + `emit.mjs` (+ `js/estimators/cells.mjs`); report objects → `pipeline/.cache/last-report/<kind>.json` | cells arrive as bare strings — provenance must be baked upstream or it is gone |
| 6 | Skill judgment | `.claude/skills/scan/SKILL.md` (1,005 lines) + three siblings | ~24,300 tokens ordering a ~37,000-token read [r2-measured] |
| 7 | Operator | Ben | |

**Fusion points:** `screen-flip-niches.mjs` (3,086 lines) fuses stages 2–5 + publish — digest stats
(`digestReachAndPlacement` :785 incl. an inline reach recomputation :803-809 bypassing
`reachFraction`), labels (`digestVerdict` :723), module-private thresholds (`MIRAGE_REACH_FRAC`
:644 — unimportable; its scorer `join-reach-basis.mjs:50-55` keeps a documented LOCAL COPY whose
line reference is already stale), render (`buildDigestBlock` :981), publish. `quote-items.mjs:874-960`
fuses measurement+interpretation+render in one try/catch (the ReferenceError-disguising shape,
CLAUDE.md rule 10). Stage 1's fusion is by design; the defect is consumers DROPPING fields at its
boundary: `estimatePair` reads `row.quickBuy/quickSell` (pair.mjs:197-198) and none of
`row.quickStale`/`row.quoteAgeMin`.

## 3. Findings — eight structural causes

### Cause A — names are shared at the value level, never at the meaning level

The one-home rule deduplicates FUNCTIONS and CONSTANTS, not MEANINGS. Census (definitions read;
review-round corrections applied and marked):

| Word | Distinct meanings | Evidence | Where it bites |
|---|---|---|---|
| `big-ticket` | **TWO semantics across SEVEN sites** (r2 correction — r1/r2 drafts said "six meanings", counting operands; the four unit variants all compare a per-unit price, the three lot variants a lot value, which is exactly why the two-predicate remedy fits): per-UNIT — ask (`join-asym-outcomes.mjs:256`), mid (`screen-flip-niches.mjs:689`), guide (`js/reverseflip.mjs:214`), executed-each (`ownedledger.mjs:151`); per-LOT — value (`js/quotecore.js:674`, `watch-positions.mjs:784`), cost ∪ watchlist (`quote-items.mjs:874`) | one constant `js/quotecore.js:97` | the CHANGELOG miscount; `item-context.mjs:423-424` says "big-ticket ≥ 10m" on a per-LOT decision beside `emit.mjs:351`'s per-UNIT headline |
| reach `hit/n` | SEVEN bases share the token shape: full-day 14d (`quote-items.mjs:512-513`); coming-8h validator (`js/validate.mjs:124,157`); coming-8h × 7d (`watch-positions.mjs:222-223,262-263`); diurnal window (`emit.mjs:170,202`); 5m-grain (`quote-items.mjs:913`); asym quantile tally (`emit.mjs:329-334`); amplitude walk-forward `recent·full` pair (`screen-flip-niches.mjs:2315`, verified). Render surface: **38–49 sites across 9–11 files depending on the match pattern** (r2 correction: r2's "41 across 10" is not reproducible as a single number; the census is pattern-dependent, so SEP6 states its grep and the executor re-derives) | the doctrine exists as prose: `js/validate.mjs:102` "Cross-surface comparison of raw reach tokens is invalid without naming the window basis" — most render sites don't | the 11/14-vs-5-of-7 anchor; the Divine-super-combat 30× pool miss (`scan/SKILL.md:728-735`) |
| `verdict` | SIX vocabularies write the ONE `suggestions.jsonl` `verdict` field verbatim (`suggestlog.mjs:536,546`) across SEVEN writer sites: momVerdict words (watch :938), SKIP/BUY/FLUSH (:947), BID-OK/CANCEL-BID (:949), a letter grade (`screen:1678`, `:2536` — verified), VALUE-BUY/WATCH (:2131), AMP-CYCLE (:2379), a rendered SENTENCE (`quote-items.mjs:962` logging `renderHeldVerdict` from :760) | `join-outcomes.mjs:106` carries `script`+`mode`, so 4 of 6 are separable; the indiscriminable case is `logSuggestions('watch', {mode:null})` (`watch-positions.mjs:937`) — three vocabularies, one stream | a watch-stream retro on `verdict` mixes three vocabularies |
| `capEff` | logged = intrinsic, no `lapsCap` (`screen:1695`); displayed = buy-limit-bounded (:901-902) | both `%/d` | digest vs log compares two quantities |
| windows/day | THREE constants: `REFILL_WINDOWS_PER_DAY = 6` (`desk-cadence.mjs:38`, physical), `ACTIONABLE_WINDOWS_PER_DAY = 2` (:39), `LAPS_PER_DAY_CEIL = 6` (`screen:639` — an independent literal re-deriving the physical 6) | flagged in prose at screen :46, reconciled nowhere | |
| `thin` | four triggers (`js/rating.mjs:134-147,172`; `js/reverseflip.mjs:211-219`) | rating.mjs:141-144 records the conflation | |
| `stale`/`fresh` | two bars on ONE datum (`STALE_QUOTE_MIN=90` vs `QUICK_FRESH_MIN=15`, `quotecore.js:111,121` — the 64-min godsword print was simultaneously "reliable" and "stale"); ~37 definition lines in total [r1-measured] | | which staleness does a ⚠ mean? |
| `pressure` | `hpv/lpv` flow ratio (`quotecore.js:441`) vs `medVolHi/medVolLo` (`windowread.mjs:1032-1036`) | two `N×` tokens, neither naming its basis | |
| `reliability` / `confidence` / `mirage` / `spread` / `rank` / `deployable` | as censused in r2 (three/four/two-cutoff/four-plus-a-ghost/three/three definitions respectively — all file:line-verified in the r2 round; unchanged by round 2) | | the digest `deploy` cell's silent flat-100m fallback (`screen:189-190`) remains the sharpest: a real book read and an assumption render identically |
| `median` | **16 implementations, 10 outside `experiments/`** [r2-measured; r1 said three, r2's review said eleven — three successive counts, three patterns: the census lesson again]. Verified instances: type-7 (`quotecore.js:155`), mean-of-middles (`trendcore.js:51`, `cli.mjs:72`), upper-middle (`windowread.mjs:275,1108`, `forecast.mjs:35`) | | |
| duplicated exports | `SENSITIVITY_HORIZONS_H` `[8,24,48,96,168]` (`join-asym-outcomes.mjs:47`) vs `[8,24,48,72]` (`join-reach-basis.mjs:60`). ~~spearman~~ **RETRACTED** (r2 correction, verified: `edge-map-lib.mjs` lives in `pipeline/experiments/` — exactly ONE production spearman, `fill-placement.mjs:31`; no production duplication). ~~parseGp~~ retracted in r2 (documented two-homes split) | | |

### Cause B — provenance is stripped at layer boundaries

1. **Staleness:** `computeQuote` emits `quickStale`/`quoteAgeMin` (:481-485); `estimatePair`'s
   contract excludes them and clamps Est. sell to `row.quickSell` regardless of age
   (pair.mjs:197-198, :245-257); the warning rides a separate notes channel
   (`staleLiveNote`, quote-items :144-152). The digest patched this locally for ITS reach column
   (screen :788-809) — a per-surface fix instead of a boundary fix.
2. **The digest reach cell is three quantities** (exempt → `—`; stale-guarded → inline full-window
   fraction; else recent-3), rendered as a bare `✓`/`✗` at :945 — no count, no denominator, no
   basis — and `digestReachAndPlacement` RETURNS `staleGuarded` (:829) which row assembly DISCARDS
   (:1308 destructures four fields, not it — verified). Fixed by owner ruling at SEP12.
3. **`deploy`**: real pool vs assumed 100m, unmarked. **`Regime`**: 6h-vs-1h grain divergence
   documented, not carried. **Grade**: rates `quotedPair`'s band pair, not the printed Est. pair.
4. **Measurements**: the "+9.8pp n=6,016" figure quoted in many files with "NO recorded method and
   no surviving script" (`join-reach-basis.mjs` header); README:2647 carries BOTH "wrong in four
   consecutive review rounds" AND "wrong in three…" for two different hand-counts in one cell (the
   r2 round's own correction note picked one and miscounted the miscount count — recorded, not
   fixed).

### Cause C — a measured negative lands beside a label, never in it (REWRITTEN in r3 per round 2)

r1/r2 framed this as "labels have no epistemic kind" and proposed a kinds registry. **Round 2
falsified the premise's direction** [r2-measured, spot-consistent with the digest header, which
opens `INFORM-ONLY, PLACEHOLDER n≈0 — never gates` — screen :982]: of 1,896 text units in a real
published scan, 193 say PLACEHOLDER, 321 carry an n≈0-class hedge, 135 "would caution/reject", 121
"not a gate" — **~24% of output units already hedge.** The reader is not starved of epistemic
marking; the reader is saturated with it, which is WHY a comment saying "do not read this column as
a filter" (screen :763-766) changed nothing while the verdict word kept firing. The real defect:
**there is no mechanism by which a measurement that scores a surface CHANGES that surface.** The
`sell unreliable` result landed as a comment (Cause B item 4's transport); the S+/negative-net
result landed as skill prose (`scan/SKILL.md:31-38`). Nothing forces "measured losing" to become
"deleted/replaced/demoted". The remedy is C-MEASURED (§6) + the owner's SEP12 ruling — fewer,
harder words; not a 194th mark. The kinds-registry rendering half is **RETIRED, reason recorded
here**; the salvageable parts (the drifted NOTE_KINDS guard, the verdict-log discriminator, a
grade-basis gloss) live in SEP7.

### Cause D — interpretation lives inside command entrypoints

As censused in §2 (screen's digest family + `quote-items.mjs:874-960`). The measured cost stands:
the label threshold's own scorer cannot import it (`join-reach-basis.mjs:50-55` local copy; stale
line pointer). SEP4 is the fix and the model.

### Cause E — pass/fail signals do not require evidence

1. **The runner** (`run-tests.mjs:51-54`): `stdio:'inherit'`, pass = exit 0; it never sees output.
   Status honesty (coordinator's r2 self-correction, consistent with my own full run 2026-08-25):
   **zero suites are silent today** — the class is a recurrence risk, not a live defect. Ten suites
   already emit **TAP via `node:test`** (verified: `admission.test.mjs:4` imports it; the runner's
   own output shows `TAP version 13`) — counter-produced, standard, machine-readable. Tail census
   is pattern-dependent: 27 canonical / 61–85 variant / 10–34 none across three successive counts
   with three patterns (mine 2026-08-25: 27/61/34 on `/checks? passed/i` over source; round 2's
   27/85/10 counts TAP and looser tails as variants). The instability of the count is itself the
   finding — SEP1b's TAP direction dissolves the classification rather than picking a winner.
2. **Global console mutation is the output architecture** — three entrypoint-guarded stubs
   (`quote-items.mjs:1044`, `watch-positions.mjs:591`, `screen:2790`, verified) plus a FOURTH
   assignment class round 2 found and I verified: `pipeline/test/validate.test.mjs:72-74` assigns
   `console.error` and restores it in `finally` — legitimate capture, so SEP2's lint needs a stated
   test-scope policy, not "any assignment fails".
3. **Silent gate-offs** (all verified; none currently degraded — conditional failure modes):
   unreadable fills.json → buy-limit validator passes (screen :2561); unparseable positions.json →
   held-exception + track-boost off (:2829); **cold archive → empty-series SUCCESS → floorValidator
   passes** (`quote-items.mjs:346-349` comment admits it; consumed :394) and the rebid trajectory
   degrades to `'unknown'` (:721) — the dominant path is the success return, which a catch-wired
   note would never see; watch buy-limit clause vanishes (watch :968); watchlist section omitted
   (screen :2445 — `if (!wl.length) return null`; re-verified r6, was :2452); archive appends swallowed (`marketfetch.mjs:359,501,581`); guide cache
   infinite-TTL (:164). 47 bare-null `windowread` returns [r1-measured] stay out of scope.
4. **Guards' blind spots repeat as a class** — incl. eight source-text-regex suites (seven
   comment-vulnerable) [r1-measured; class verified], and `lint-guard-lists.mjs:10`'s "ELEVEN"
   vs twelve actual steps — caused by the twelfth guard (`lint-comments.mjs`) landing mid-audit.
5. **Verification claims are prose** — four false claims in one session; the per-case
   honesty-line convention (`estimator-orientation.test.mjs`) is right and unenforced. **And the
   same defect exists on the PROSE axis** (round 2, verified by running it): `lint-plan-lifecycle.mjs`
   derives its verdict from each plan's SELF-WRITTEN status line and flags **all 42 plans "ok" —
   including one whose status begins "SHIPPED 1c03fd9 … all three workstreams"** — and CI never
   runs it (absent from `checks.yml`, verified). Green-without-evidence, in the guard meant to
   police plan hygiene. → SEP15.

### Cause F — inspection depth is undefined and keyed to untrusted labels

Unchanged from r2 (trio "mandatory for every top pick", `scan/SKILL.md:716-725`, trigger term
undefined; coverage rule certifies breadth of mention; the measured-worthless words were the
de-facto dismissal gate). The observable half has a data source: the trio ALWAYS writes item-keyed
results on `--out` (`read-window-range.mjs:822-826` — unconditional `writeFileSync`; entries carry
the scored LEVELS, verified :622,:637) — but **no timestamp** (the `--out` dump is the bare results
array; `generatedAt` exists only on `--json` stdout, verified :819) and **two skills hardcode the
same path** (`scan/SKILL.md:725`, `positions/SKILL.md:486`, verified — the surfaces clobber each
other). _(r2's note said the results carry "no price context and no timestamp" — half right: no
timestamp, but the levels ARE present, which is precisely what makes SEP11a's mismatch flag
buildable.)_ → SEP11a/b.

### Cause G — prose accretes; corrections append instead of replacing

Corrected numbers (round 2; my r2 figures understated in the direction that made the problem look
smaller — itself a live instance of this cause, recorded): over 284 tracked JS/MJS files —
**code 40,584 / comments 22,801 / markdown 35,160 / skills 2,640 → 60,601 prose vs 40,584 code =
1.49:1**; comment share of non-blank source **36%** [r2-measured; my r2 figures — 48k code, 1.15:1,
29% — counted 4,555 blank lines as code and ran 15% low on comments]. The mechanism is stated by
`lint-comments.mjs`'s own header: corrections append clauses. Governance honesty (round 2,
verified): `lint-comments.mjs` ROOTS cover `js` + `pipeline/{lib,commands,ci,daemons,probes}` and
**skip `.test.mjs`**; `comment-budget.json` has **zero `pipeline/test` and zero `.md` entries** —
so markdown, skills and tests have NO size governance; every "prose delta" in §7 is
review-enforced, not lint-enforced, and §7 says so per chunk instead of implying a guard.

### Cause H — the digest problem is a context-budget problem, and the budget is in per-row notes, not niches (ADDED r3; CORRECTED r4)

Measured on a real `--verbose --digest --mode all` run, 182,289 chars ≈ 45,572 tokens
[r2-measured, section-by-section]: BAND 25,516 · CHURN 12,603 · WATCHLIST 3,000 · AMPLITUDE 1,153 ·
DIGEST 407 · preamble/pools ~464. Split by LINE KIND: **all four niche TABLES total 7,795 tokens**
(band 3,947 + churn 711 + amplitude 152 + watchlist 2,985); the remaining ~32,000 is per-row NOTE
families — `↳` diurnal-timing lines 10,077 in band alone (65 survivors × ~155), `ℹ`
trajectory/reach/window notes 6,260 band + 7,039 churn, `◆` asym 3,312, other families ~3,100.
The digest itself is ~407 tokens — under 1% of the read. Four rows dismissed on one token is budget
arithmetic, not labeling.

Two consequences, one constraint. The constraint (owner ruling, §4 R-coverage): **full niche
coverage on every scan is non-negotiable** — dropping niches would save only ~3,000 tokens and cost
exactly what the owner protects. The consequences: (1) the win is moving per-row NOTES out of
stdout — computed and written, no longer read aloud; (2) that is only a RELOCATION rather than a
data loss if the render dump is COMPLETE, and today it is not: `pipeline/.cache/last-report/screen.json`
holds exactly TWO reports (band + churn — verified 2026-08-25, 2 entries), while the digest prints
via `realLog` (`screen:3019`), the watchlist via bare `console.log` (`:2540`), and
amplitude/dip-pool never pass through the one report-emitting site (`emitReport`, `:1995` — the
only call). Read the dump instead of stdout today and you lose precisely the coverage the ruling
protects. SEP14 (rewritten) is the fix: **stdout carries the decision surface, the dump carries
the detail, a reader pulls detail per item** — inverting today's default where the agent reads
everything about 79 rows to act on two. Every chunk that ADDS output (basis suffixes, degrade
notes, footers) is charged against this budget in its output-delta line.

### Open defects recorded during review (logged, deliberately not diagnosed here)

- **Duplicate digest row (r5, coordinator-observed):** `Webweaver bow (u)` printed TWICE on one
  digest board in one pass — both A−, both `fill-now`, one with a reach tick and one without.
  The digest pool is filled per-niche (`collectDigestRow` per `renderMode` pass), so the likely
  shape is one item surviving two niches with divergent reach reads — but that is a HYPOTHESIS,
  not a diagnosis (rule: name the refuting test before stating a cause — nobody has run one).
  Notable: this is the item from the incident that started this plan. Owner/executor to triage;
  a dedupe-or-label decision belongs with SEP4's extracted module.
- **`watchlist` can surface as a tuning-candidate "niche" (r6, latent, verified not-yet-observed):**
  `analyze.mjs:235-241` skips only the `'(none)'` bucket when scanning `perNiche` for
  net-negative-per-attention candidates, and watchlist's `realisedN = 32` clears `minN = 20`. So
  `/analyze` can propose tuning a "niche" that is not one — it is the always-shown exempt section.
  Not diagnosed further and NOT fixed by SEP16 (which deliberately leaves the log untouched, see
  its Decision 1); the fix belongs with the perNiche rollup's bucket policy.
- **Quiet-mode section loss (r5, live defect — RESOLVED for the dump half, r6):** amplitude,
  watchlist, dip pool and watch-closely reached neither stdout nor the dump on a default run.
  `039972e` wrapped all four in `captureReport`, so they now reach the DUMP but still not quiet
  stdout (mechanism + line refs in the r5/r6 disposition note above). What remains is stdout
  visibility — SEP14 part 2's decision surface — not a silent-drop defect. SEP16 no longer inherits
  this as its warrant; see SEP16's restated warrant.

## 4. Rulings

**Ruled (recorded, dated):**
- **R-tag — RULED 2026-08-25 (owner, via coordinator):** delete the `sell unreliable` verdict rule
  (`screen:728`) and change the reach cell (:945) from ✓/✗ to the fraction with a basis marker.
  SEP12, ship-first. (The grade-side `REACH_GRADE_CAP` in `rating.mjs` is a separate mechanism and
  is NOT touched by this ruling.)
- **R-rounds — RULED 2026-08-25 (owner):** review rounds get a stopping rule: stop when a round
  stops finding things wrong; cap 5 then check in; a round may delete or repair; appending a new
  claim needs a reason. Encoded at SEP13 beside CLAUDE.md rule 10 (which encoded the trigger,
  never the termination — measured consequence 2026-08-09: twelve numbered correction rounds,
  +940 lines, ~1:1 substantive-to-corrective [coordinator-measured]).
- **R-metric (negative ruling, owner-confirmed):** realised gp is NOT a success metric for this
  plan — trading frequency is deliberately low right now to make room for this work. §12 says so
  explicitly so no future reader misreads the book.
- **R-coverage — RULED 2026-08-25 (owner, verbatim):** "I'd rather not make per-niche tables opt
  in — I want to check all niches when I scan." Full niche coverage on every scan is a HARD
  constraint on every chunk in this plan; r3's opt-in mechanism is dead (§7 SEP14 is its
  replacement, which preserves all four niche tables in the decision surface). This ruling
  REINFORCES the existing coverage doctrine (`scan/SKILL.md` one-line-per-niche rule) rather than
  amending it.
- **R-watchlist — RULED 2026-08-25 (owner, verbatim):** "The watchlist rule could probably be
  reworked — maybe a separate watchlist scan, not automatically stapled to the regular path."
  Supersedes r4's fix of writing the watchlist section into the dump. The watchlist becomes its
  own surface/mode (SEP16) — a distinct question gets a distinct command, which is this plan's
  thesis. The honesty rule travels with it wherever it lands: exempt from floors, never silently
  dropped, each row carrying the note saying what a gate would have hidden.
- **R-diurnal — RULED 2026-08-25 (owner):** the diurnal-hours read was measured near-nonexistent —
  drop the hours clause where the reliability gate fails (78 of 79 survivors on the measured pass:
  `levels only — no reliable hours`; ~1.3% pass, consistent with the ~0.8% on record
  [coordinator-measured]) and keep it for the minority that pass. The measurement that LICENSES
  this cut is the split-half hours-reliability gate (`windowReliability`, `js/windowread.mjs`
  — the DT4 tri-state), NOT the window→fill non-result (DT2) and NOT the deleted per-hour drift
  slope (DT3) — three distinct diurnal measurements exist on record and the chunk cites the right
  one. The diurnal LEVELS stay — load-bearing, out of scope. Encoded at SEP14 part 4.

**Open (proposed defaults, flagged for veto):**
- **R-surface (SEP14):** whether the new decision-surface stdout mode becomes the `/scan` skill's
  DEFAULT invocation (full mode staying one flag away), and whether the R10 "core AND context both
  relay" tracking ruling (render.mjs, Ben 2026-07-16) needs a note that per-row context families
  now relay via the dump+reader path instead of stdout. Proposed default: yes to both.
- **R-stale (SEP8):** stale-anchored Est. sell — default annotate-in-cell via `liveAgeTag`, never
  suppress. Alternative: demote out of the primary column.
- **R-depth (SEP11b):** which rows REQUIRE the trio before relay. Default: any row the reply names
  a price for; any big-ticket-lot-sized deploy. Informed by SEP11a's observed footer.
- **R-noise (SEP5/6):** basis-suffix budget (≤4 chars + one legend line). Charged against Cause H.
- **R-degrade (SEP3):** gate-off notes render core-tier. Per-site veto list in the chunk.
- **R-verdictlog (SEP7):** additive `verdictKind`; the audit gating any change to the old field
  runs against the SEVEN-site census.
- **R-retrohorizon (NEW r6; gates SEP16e's sibling question and any future removal of the
  watchlist log):** `'watchlist'` is absent from `HORIZON_BY_MODE` (`retrojoin.mjs:49-52`) so it
  falls to the 24h default — LONGER than band/churn's 12h — and `:147-155` awards each buy to the
  nearest-prior suggestion in horizon, so watchlist rows (logged for all 60 items every scan)
  usually win the claim. **Proposed default: LEAVE IT, and do not let SEP16 change it in either
  direction.** Rationale: `retrojoin.mjs:45-47` already rules this class ("CHANGES WHICH FILLS THE
  RETRO ATTRIBUTES … an owner call, not a doc-pass edit"), and the measured differential (band
  taken 71→85, realised Σ 5.30m→6.73m; Bar-E 0/11→1/12) shows the numbers move but not which
  attribution is right. Settling it needs an owner call on what a watchlist row CLAIMS, which is a
  question about the retro's semantics, not about rendering. Veto path: rule it and SEP16e's
  sibling chunk follows. Full evidence at SEP16 F-c.

## 5. Existing scaffolding (not greenfield)

- Ten `node:test`/TAP suites (`admission`, `admit-min-net`, `admit-skip-asym`, `daemon-safety`,
  `diurnal-recency-replay`, `estimator-orientation`, `guard-lists`, `lint-skills-scope`,
  `patient-cell`, `watch-reserve` [r2-listed; two verified]) — SEP1b's direction, already in-tree.
- `reachFraction` (`js/estimators/reach.mjs:94`) — the basis rule; SEP5 puts `fmtReach` beside it.
- `liveAgeTag` + the `{degraded, reason}` convention + `depth n/a — <why>` render
  (`windowread.mjs`, `emit.mjs:51`) — SEP8/SEP3 templates.
- `read-window-range.mjs --out` (:822-826) — item-keyed, level-carrying results; SEP11a adds ts +
  a ledger.
- `pipeline/ci/lint-comments.mjs` + `comment-budget.json` — the prose ratchet; its scope gaps are
  Cause G's governance note.
- `lint-plan-lifecycle.mjs` — exists, non-gating, self-status-trusting (Cause E item 5); SEP15
  repairs rather than reinvents.
- `reality-render-coverage.test.mjs` (fixed-regex coverage pattern + honest limits),
  `estimator-orientation.test.mjs` (per-case mutation statements), replay goldens (E6), AO1
  last-report dumps, `NOTE_KINDS`/`TIER` (drifted — SEP7 repairs).
- Measurements cited, not re-run: `join-reach-basis.mjs`, `join-depth-outcomes.mjs`, DT2, AF1, the
  S+/negative-net measurement.

## 6. Target architecture — four contracts

- **C-BASIS.** A quantity in a cross-confused family (reach; live-print age; digest capital basis)
  travels as a struct carrying its basis and is rendered only by that family's ONE formatter, which
  always prints the basis. The formatter lives BESIDE the family's math home (r3: `fmtReach` in
  `js/estimators/reach.mjs` next to `reachFraction` — the merged contract is structurally true
  only if vocabulary and formatter share a module; r1's `windowread` pick and r2's `money-format`
  pick both rested on wrong premises, recorded in the header note).
- **C-MEASURED** (replaces r2's C-KIND; Cause C rewrite). A measurement that scores a rendered
  surface must CHANGE the surface — delete, replace, demote, or re-rank — or record an explicit
  owner decision not to. A comment or doc caveat is not an accepted landing site for a negative
  result. SEP12 is the first enforcement by example; SEP10's artifacts make the trail auditable.
- **C-ARTIFACT.** An evidence claim cites a machine-written artifact: a test's check count is
  produced by the counter (TAP / SEP1a), a measurement's headline lives in a script-written file
  (SEP10), "this row was verified" means the verify ledger contains it (SEP11a). Scope honesty
  (r2 §6/§10 disagreement resolved by narrowing §6): this covers claims OF EXECUTION AND RESULT;
  it cannot detect a check that runs and asserts the wrong thing — one of the four false claims
  ("a regression check that never called the function it guarded") is only partially in scope: the
  artifact proves the check ran, not that it guards what it names.
- **C-EVIDENCE.** Green means evidence: the runner rejects silent suites (SEP1a); a gate that
  turns off says so (SEP3); console mutation outside stated scopes fails CI (SEP2); a plan's
  lifecycle verdict cannot rest solely on its self-written status (SEP15).

New homes: `pipeline/lib/signal/digest.mjs` (SEP4); `pipeline/ci/lint-console-mutation.mjs`
(SEP2); `fmtReach` in `js/estimators/reach.mjs` (SEP5); the verify ledger (SEP11a). The r2 harness
module is retired with SEP1's redesign.

## 7. Staged chunks

### THE SHIP-FIRST FRONT (owner ruling 2026-08-25 — land these four first, in this order)

### SEP1a — the runner fails a silent suite (~20 lines; insurance, not repair)
**Change:** `run-tests.mjs` captures child stdout (echoing through unchanged) and fails any suite
producing zero bytes. No per-suite contract, no migration, no format requirement — that was r2's
harness design, RETIRED per round 2 (A1): ten suites already emit TAP, and a private format +
an exemption list for them is the rot pattern this plan exists to kill. Capture is safe
[r2-measured: 172 KB total, 13 KB largest, under `maxBuffer`].
**Verify:** the runner's own unit test spawns it against a temp dir containing a
deliberately-silent fixture suite (import-scope `console.log` stub) and asserts RED — the fixture
lives OUTSIDE the discovered `pipeline/test` set so CI isn't permanently red; the live 122 stay
green; full checks job.
**Output/prose delta:** ~0.
**Falsifier + observer:** a suite later passes while printing nothing — observed by the runner's
unit test (CI, every push) and by the next zero-byte incident; if one occurs despite the gate, the
capture path itself is broken.

### SEP4 — extract the digest interpretation layer (mechanical; the model chunk)
**Change:** move `digestVerdict`, `digestReachAndPlacement`, `digestReachFrac`, `weakDeploy`,
`liveCrossable`, `capEfficiency` + constants (`MIRAGE_REACH_FRAC`, `WEAK_DEPLOY_ROI_PCT`,
`BIG_TICKET_MIN/SLICE`, `DIGEST_TOP`, `LAPS_PER_DAY_CEIL`) from `screen-flip-niches.mjs` to new
`pipeline/lib/signal/digest.mjs`. `isBigTicket` does NOT move (SEP9 deletes it).
`join-reach-basis.mjs` drops its documented local copy and imports `MIRAGE_REACH_FRAC`. No
behavior change. Headers trimmed to mechanism-plus-pointer to land inside `NEW_FILE_CAPS`
`{dated:2, block:40}`; any block that cannot trim without losing load-bearing doctrine is named in
the commit for a deliberate bless.
**Verify:** stdout byte-identical on a recorded `--digest --verbose` pass + replay goldens; full
checks job; README entry same commit.
**Output/prose delta:** negative (headers trimmed).
**Falsifier + observer:** any stdout diff — observed at ship time by the diff itself. This chunk
is the MODEL: every later mechanical move copies its verification shape.

### SEP12 — the two digest edits (both anchor incidents; R-tag is RULED)
**Change:** (1) delete the `sell unreliable` rule (`screen:728` — post-SEP4, its new home); the
verdict falls through to the next rule; the code comment :751-766 shrinks to a pointer at the
measurement artifact (SEP10 retro-fits the artifact; until then, at the README entry). (2) the
reach cell (:945) renders the FRACTION with a basis marker instead of ✓/✗ — `2/3r` (recent-3),
`9/14d` (stale-guarded full-day), `—` (exempt). The owner's "two lines" framing names the INTENT —
two rendered artifacts change (one verdict rule deleted, one cell re-rendered) — and that framing
governs; implementation honesty: ~15 lines land, because `reachFraction` collapses counts to a
float, so `digestReachAndPlacement` returns additive `{hit, n, basis}` alongside `reachFrac`, and
row assembly stops discarding `staleGuarded` (returned :829, dropped at :1308 — verified). This inline format is the PREVIEW of SEP5's `fmtReach`, which later replaces it.
**Verify:** goldens re-pinned (deliberate change, reviewed); a fixture pool with one stale-guarded
row asserts the `d`-vs-`r` marker renders; full checks job.
**Output/prose delta:** cell grows ~4 chars/row; verdict column loses its noisiest word. Net
context cost ≈ 0 (Cause H).
**Falsifier + observer:** a session dismisses a row on the reach cell alone at a basis the cell
mis-states — observed by the SEP11a footer once it lands (the ledger records what was actually
verified); until then an accepted blind spot, stated.

### SEP13 — the review stopping-and-shape rule (cheapest; CLAUDE.md)
**Change:** beside process rule 10 (which encodes the TRIGGER for adversarial review and never the
termination), add the owner's ruled stopping rule: stop when a round stops finding things wrong;
cap 5 then check in; a round may delete or repair; appending a new claim needs a stated reason.
Evidence line: 2026-08-09 — twelve numbered correction rounds of one day's work, +940 net lines,
~1:1 substantive-to-corrective commits [coordinator-measured].
**Verify:** `lint-docs` green (rule 8 reconciliation: rule 10's own text gains the pointer).
**Output/prose delta:** +~6 lines CLAUDE.md, the one home of process rules.
**Falsifier + observer:** a future wave again runs >5 rounds without a check-in or nets large
positive correction-line counts — observed by §12's six-week measurement.

### THE RE-SEQUENCED REMAINDER (in order; premise changes per chunk recorded; SEP16 rides
immediately after SEP14 — it shares the report-path work and fixes the live quiet-mode drop, so
the pair lands adjacently)

### SEP14 — decision surface on stdout, detail in the dump, a reader per item (REWRITTEN r4 — the r3 opt-in mechanism is DEAD by owner ruling R-coverage)
_The r3 version made per-niche tables opt-in; the owner rejected that verbatim (§4 R-coverage).
This rewrite keeps the ~80% budget win while preserving every niche table on every scan — the
tokens were never in the niche count (Cause H): all four tables cost 7,795 of 45,572; the per-row
note families cost ~32,000._
**Change — three parts that compose, executed dump-first so nothing is ever lost:**
1. **(first) Make the render dump COMPLETE.** Write the digest, amplitude, dip-pool and
   watch-closely sections into `pipeline/.cache/last-report/screen.json` alongside the two reports
   it holds today (band + churn via `emitReport`, the single report-emitting site at `screen:1995`
   — verified; the other sections DO reach the dump, by the different `captureReport` path added in
   `039972e`, which buffers bare `console.log` into `REPORTS` and replays into the quiet no-op sink,
   so they land as untyped `lines` sections and are absent only from quiet stdout — r6 correction to
   r5, which reported them as reaching neither). The WATCHLIST is deliberately
   NOT folded in here: per R-watchlist it becomes its own surface (SEP16). (r6: the "also cures its
   live quiet-mode drop" clause that stood here is RETIRED — `039972e`'s `captureReport` wrap
   already put it in the dump, and SEP16 keeps the main scan's compute + publication anyway.) Until this part lands, dropping any stdout is DATA LOSS, not relocation —
   that distinction is the whole chunk. (The CLAUDE.md/skill claims that the digest
   and amplitude are "console-only, never in screen.json" are reconciled in the same commit: the
   published root `screen.json` app artifact is unchanged — this is the gitignored last-report
   dump, a different file with the same basename; the docs pass must keep that distinction sharp.)
2. **A decision-surface stdout mode** printing: the digest, EVERY niche table the scan runs
   (band + churn + amplitude in `--mode all`; the watchlist table moves to SEP16's own surface per
   R-watchlist — r5 amendment to the r4 "all four" wording), and the one-line footers that carry
   gate outcomes (grade distribution, `skipped: N unprofitable at the shown pair`, `crowded out:`,
   the SUB-FLOOR marker) — and NO per-row note families. Target ~8,000 tokens against the measured
   45,572 (~82% cut) with **full niche coverage preserved** (R-coverage) and nothing removed from
   what is computed, gated, or covered.
3. **A per-item note reader** — pull ONE item's note block out of the dump on demand (~200 tokens)
   instead of re-reading ~32,000 or re-running the scan. This is also what makes the verification
   trio cheap enough to run on every candidate being elevated (Cause F's economics).
4. **(R-diurnal, stated precisely so it is not oversold)** Suppress the diurnal HOURS clause and
   the `levels only — no reliable hours` boilerplate on rows that FAIL the split-half reliability
   gate (`windowReliability` — the measurement that licenses this cut; 78 of 79 survivors failed
   on the measured pass), keeping the clause for the ~1% that pass. **This saves ~1,400 tokens,
   not ~10,000** [coordinator-measured: the hours/reliability tail costs 1,395 of the line's
   9,723; the other ~5,524 is the liquidity/tranche/price-knee SIZING segment sharing the line —
   LOAD-BEARING (it caught a real 31×-tranche / 4.6×-pool sizing error the night it was measured)
   and NOT in scope]. The big saving is and remains parts 1–3, which move the WHOLE line to
   retrievable storage; part 4 is a precision trim, never the token fix. Diurnal LEVELS untouched.
**The data guarantee, stated so nobody "fixes" it back:** the per-survivor diurnal-timing line
exists because of a deliberate every-survivor rule (the DT4 data-guarantee pin,
`dt4-timedlap-coverage.test.mjs`). This chunk moves that guarantee from PRINTED to WRITTEN-AND-
RETRIEVABLE — still computed and stored for all survivors (all 79 in the measured run), no longer
read aloud. If the DT4 pin asserts the printing rather than the computation, the pin is updated in
the same commit to assert presence in the dump — the guarantee's substance, not its channel. A
future reader must not restore the printing as a bug fix.
**Verify (mechanical, the extraction-chunk shape):** (a) byte-identity — the decision-surface mode's
tables + digest are byte-identical to the full mode's tables + digest on the same pass (any diff =
the mode dropped something it should not); (b) completeness — an assertion that every section
present in full stdout is present in the dump; (c) the reader round-trips a named item's notes
byte-identical to the full-mode stdout block; full checks job.
**Output/prose delta:** the biggest negative in the plan: ~−37,000 tokens per scan read at the
default surface [r2-measured baseline], +0 computed.
**Falsifier + observer:** (a)/(b) are CI-observed (the byte-identity and completeness assertions);
the judgment residual — a candidate elevated without its notes ever being pulled — is observed by
the SEP11a footer (elevated + no ledger entry) once it lands.
**Ruling dependency:** R-surface (make it the skill default; R10 wording note). R-coverage binds
the design (every table the scan runs stays); R-watchlist moves the watchlist table to SEP16.

### SEP16 — the watchlist: split the PERMISSION set from the REPORT (R-watchlist is RULED)
**Warrant, RESTATED r6.** r5 justified this chunk as a live defect (the section reaching neither
stdout nor the dump). **That warrant is gone** — `039972e` wrapped `runWatchlist` in `captureReport`
(`screen:2998`), so the rows are in the dump on every default run. Two warrants survive, and they
are stronger than the one they replace:

1. **R-watchlist is RULED** — a distinct question gets a distinct command, this plan's thesis.
2. **`watchlist.json` conflates two jobs under one name** (r6, verified): a load-bearing
   PERMISSION/PRIORITY set that eight code paths consult, and a 60-row REPORT that is measurably
   answering the wrong question about its own contents. Anchor: **Soulreaper axe at 404.62m graded
   `A- (thin) · net 1.01m P~0.50 ttf~34.6h`** — a two-hour band read on an item held for weeks,
   because `screen:2485`'s own `P6b` comment says a watchlist row has no niche context and is
   therefore ranked under the neutral band thesis. This is not a `rateItem` defect; it is the
   correct answer to a question nobody asked. Supporting measurements on the current `screen.json`:
   **45 of 60 rows appear in no niche table** (so the section is NOT redundant — "delete it" is the
   wrong move), and the grade spread is `A- (thin)` 30 · `D (thin)` 20 · `C (thin)` 5 · `B- (thin)` 3 ·
   `B (thin)` 2 — half the table on one letter, every row on the same caveat.

**Five r6 findings that CONSTRAIN the design. Each was verified against source; each fails
SILENTLY with CI green, which is why they are listed before the change and not after it.**

- **F-a — `why` metadata CANNOT live in `watchlist.json`.** Two independent blockers.
  *(i) The app owns the file and rewrites it as bare numeric ids.* `js/ui.js:129-132` — every
  `toggleWatch` calls `pushWatchlist`; `:153-160` writes `STATE.watchlist` verbatim, which is an
  array of numeric ids (`js/state.js:60`); `dev-server.mjs:100-115` validates nothing and writes it
  to `ROOT/watchlist.json`. One star-click on localhost destroys every annotation AND all 60 names,
  with no git review.
  *(ii) An object entry silently EMPTIES the permission set.* `buildMapping.resolve`
  (`marketfetch.mjs:138-144`) does `String(token).trim()`, so an object entry becomes
  `"[object Object]"` → no `/^\d+$/` match → `byName` miss → **returns `null`, does not throw**. Six
  loaders share the pattern and every one of them `continue`s on null: `screen:2408-2419`,
  `quote-items.mjs:81-91`, `watch-positions.mjs:97-107`, `read-schedule.mjs:290-295`,
  `report-archive-gate.mjs:55-56`, `js/ui.js:505-508`. The try/catch at `screen:2792` never fires —
  the set just goes empty, and every grant below turns off at once. `read-schedule.mjs --audit`
  (`:417`, `:245-262`) would then propose every already-watchlisted item as a new addition.
  **⇒ role metadata goes in a SEPARATE id-keyed sidecar; `watchlist.json` stays the bare array the
  app owns.** That makes the permission half byte-identical by CONSTRUCTION rather than by intent.
- **F-b — there are at least EIGHT permission/priority grants, not the four in circulation.**
  (1) gate exemption via the `watchedIds` arg (`gatecandidates.mjs:407`, called `screen:2858`);
  (2) **the BAND-STACK bounded fetch reserve — `WATCH_RESERVE_DEFAULT = 24`**
  (`gatecandidates.mjs:141`), consumed by `rankAndSlice` `:501` and `admission.mjs:198,251`, with
  skip reason `watch-reserve-full` at `admission.mjs:376`; (3) the AMPLITUDE reserve
  (`gatecandidates.mjs:532-540`), a DIFFERENT mechanism that is **UNBOUNDED** — its own comment says
  so; (4) the amplitude Stage-1 proxy-floor bypass (`:405`); (5) `subFloorFallback` (`:468`);
  (6) the sub-BE render-filter exemption (`screen:1417`); (7) the `NOISE_OFFER_GP` incidental-lot
  exemption in BOTH `quote-items.mjs:696` and `watch-positions.mjs:630`; (8) **two big-ticket
  FORCE-INCLUDES** — `quote-items.mjs:874` (`cost >= BIG_TICKET_GP || watchlistIds.has(itemId)`,
  gating the window-exit read, reused `:948`) and `watch-positions.mjs:730` (WC1 window-clear rung).
  Grants 7 and 8 mean "permission set" undersells it: membership already changes what `/positions`
  and `watch-positions` PRINT. It is a permission **and priority** set, and freezing it means
  freezing both. Two raw-NAME consumers (`read-schedule.mjs:290`, `report-archive-gate.mjs:55`)
  never resolve to ids at all, so they need the name array intact, not just the id set.
- **F-c — the report half is NOT free to move: it is half the retro ledger.** `runWatchlist` calls
  `logSuggestions('screen', {mode:'watchlist'}, sugg)` at `screen:2497`, and that write is
  **13,380 of 26,832 rows in `suggestions.jsonl` — 49.9%, larger than band's 10,269**
  (r6-measured; recount by grouping the file on `context.mode`). Nothing filters on it and no test
  covers it, so deleting it breaks nothing and moves real numbers: a measured differential has
  `analyze-record.mjs` band taken 71→85 with realised Σ 5.30m→6.73m, churn 15→24, and **§5's Bar-E
  headline flipping from "0/11 reached" to "1/12 reached"** [coordinator-measured].
  *Mechanism — claim-stealing:* `'watchlist'` is absent from `HORIZON_BY_MODE`
  (`retrojoin.mjs:49-52`), so `horizonFor` (`:53-55`) falls to `HORIZON_DEFAULT_SEC = 24h` (`:40`),
  which is LONGER than band/churn's `HORIZON_INTRADAY_SEC = 12h` (`:38`); `retrojoin.mjs:147-155`
  awards each buy to the **latest qualifying** (nearest-prior) suggestion in horizon, and watchlist
  rows are logged for all 60 items on every scan, so they usually win.
  *Bias axis to state whenever these numbers are quoted:* **12 ids are logged ONLY under watchlist
  mode** (excluding the mode-less `(none)` bucket — including it, the count is 10; the exclusion is
  the right basis because the claim is about NICHE coverage) — Dragonfire shield, Serpentine helm
  (uncharged), Soulreaper axe, Eclipse atlatl, Archers ring, Granite maul, Aranea boots, Masori
  mask (f), Malediction ward, Burning claws, Mystic smoke staff, Defence potion(4) — i.e. exactly
  the gate-exempt big-ticket gear class, 17.1% of item-days. Cutting the log does not just shrink
  the ledger, it removes a CLASS from it.
  *Latent bug, recorded not fixed here:* `analyze.mjs:235-241` skips only `'(none)'`, and
  watchlist's `realisedN = 32 ≥ minN = 20`, so **`watchlist` can already surface as a
  tuning-candidate "niche" that is not a niche.** Fix belongs with the perNiche rollup, not with
  this chunk; recorded in §3's open defects.
- **F-d — the split would open a doctrine hole.** `scan/SKILL.md:934-937`: falling watchlisted items
  are excluded from every niche table (only HELD rows carry `surviveMode`'s falling bypass) and
  "appear only in the Watchlist section." Move that section away and **a falling watchlisted item
  appears NOWHERE in a scan** — violating `:938` "always report, honestly." ⇒ the roll-up must
  **NAME** falling/crash-risk watchlisted items, never merely count them. `SKILL.md:867-868` must
  also be reconciled: its `watch-reserve-full` footer tells the reader to "read it there" in a
  section that will no longer exist on that surface.
- **F-e — every coupling above fails silently, and CI stays green.** `js/ui.js:440-443` guards
  `if (wl && Array.isArray(wl.rows) && wl.rows.length)`, so a null `screen.json` `watchlist` key
  omits the section with no crash and no schema bump. `smoke-test.mjs:130` asserts a `watchlist`
  TAB — the unrelated app-side editor (`panel-watchlist`) — and the scan pane's content score stays
  positive off the niche tables. There is NO tripwire for any of F-a…F-d. The acceptance criteria
  below are written to BE the tripwire.

**Decision 1 (the render-vs-ledger fork) — CHOSEN: separate WHERE IT RENDERS from WHAT IT LOGS.**
The main scan KEEPS computing the watchlist, keeps `logSuggestions` at `screen:2497` firing
unchanged, and keeps publishing `screen.json`'s `watchlist` + `html.watchlist`; only the rendered
TABLE leaves the main surface. Rejected alternative: fix `HORIZON_BY_MODE` first as a prerequisite.
Why:
  (i) Keeping the log is the NULL action for the ledger — it makes the render move provably
  orthogonal to the dataset, and orthogonality is checkable by counting rows. The horizon fix is not
  checkable: the 71→85 differential shows the numbers MOVE, not which attribution is CORRECT, and
  there is no ground truth to adjudicate it against.
  (ii) `retrojoin.mjs:45-47` already says, about the amplitude horizon, that widening it "CHANGES
  WHICH FILLS THE RETRO ATTRIBUTES … so it is an owner call, not a doc-pass edit." The same
  sentence governs adding `watchlist`. Making a render chunk depend on it blocks a ruled surface
  change behind an unruled measurement decision.
  (iii) **Stated honestly: this choice PRESERVES the claim-stealing.** The retro is contaminated
  today, before SEP16, and SEP16 neither causes nor cures it. F-c's differential is a measurement of
  a PRE-EXISTING defect that the deletion experiment surfaced. It is elevated to a named open
  ruling (R-retrohorizon, §4) rather than silently folded in.
  *Consequence that constrains R-watchlist's reading, flagged for veto:* "not automatically stapled
  to the regular path" can only mean the SURFACE, not the compute. A main scan that stops computing
  the watchlist stops logging it, which is exactly the 49.9% ledger change above. If the owner
  intends the compute to leave too, that is a ledger ruling and R-retrohorizon must be settled first.

**Decision 2 (the grade-artifact fork) — CHOSEN: the move reproduces the omission exactly; wiring it
up is a SEPARATE, separately-ruled chunk (SEP16e).**
"100% of rows carry `(thin)`" is confirmed (60/60) but is a **code-path artifact, not a property of
the items**: `screen:2487` calls `estimateRank(FLIP_NICHES.band, row)` with **no third argument**,
while the niche path at `:1358` passes `{reach, askReach, askPlacement}`. With no `extra`,
`families.mjs:354-372` sets `reach: null, askReach: null` → pure prior → `pFillN = 0` by
construction → the confidence marker fires on every row. So:
  - **Option 1 (chosen, SEP16b):** the new surface calls `estimateRank` with no `extra`, exactly as
    today. Grades byte-match; the marker stays; the move is provably mechanical (this plan's own
    rule: mechanical moves are separate chunks from behavior changes).
  - **Option 2 (SEP16e, NOT shipped by default):** wire `extra` in. **Costed, r6:** `reachExtra`
    needs `series1h.get(id)` (`screen:1172-1183`) and `askReachExtra` needs the ask-side validator
    result (`:1198-1201`) — but `runWatchlist(map, ctx, guide, latest, qcache, series5m)` fetches
    only **5m and 6h and has no `series1h` in scope**. Only the 15 ids the niche pools already
    covered would have a 1h series; the other **45 would need a new 1h fetch per scan**. So Option 2
    is not a wiring tidy-up — it is a fetch-budget change AND a grade-distribution change on exactly
    the gate-exempt big-ticket class. It gets its own before/after and its own ruling.
  ⇒ "renders unchanged" is only true under Option 1, and SEP16b's acceptance test is what keeps it
  true.

**Change — sub-chunks (each independently landable; SEP16b→d touch one new file and must be
hand-serialized against each other).**

- **SEP16a — the sidecar + the permission fixture (foundation; NO behavior change).**
  New `watchlist-meta.json` at the repo root: an id-keyed object,
  `{ "<itemId>": { "why": "target|hold|universe|probe", "note": …, "addedTs": …, "level": … } }`.
  Id-keyed because names are the app's write-back casualty and ids are what every grant consults.
  New `pipeline/lib/config/watchlist.mjs` — the ONE reader, exporting `loadWatchlistIds(map)`,
  `loadWatchlistNames()` (for the one genuinely name-keyed consumer, `read-schedule`’s `buildAudit` join — r6 said two; `report-archive-gate` already resolved to ids) and `loadWatchlistEntries(map)` (ids ∪
  sidecar). **Degrade path, explicit:** sidecar absent → **every entry is `universe`**, never an
  error; sidecar unparseable → same, plus one stderr line; an id in the sidecar that is NOT in
  `watchlist.json` → ignored (the array is authoritative for membership); a `why` that is missing,
  unknown or non-string → `universe` + one stderr line. The sidecar is never consulted by any of
  F-b's eight grants. Repoint the FIVE node-side loaders at the shared reader (r6 said six: `js/ui.js`’s `loadRepoWatchlist` `fetch`es the file in the browser and cannot import a node module, so the app keeps its own resolve and the F-a(ii) tripwire does NOT cover it); `watchlist.json` parsing is
  untouched.
  **Verify:** new `pipeline/test/watchlist-permission.test.mjs` pins — **P1** the id set is identical
  with the sidecar present, absent, empty, garbled, and containing unknown roles (the property the
  whole chunk rests on); **P2** `loadWatchlistNames()` never returns `"[object Object]"`; **P3** an
  object entry accidentally landing in `watchlist.json` FAILS LOUDLY at the loader instead of
  quietly losing that member (or, on a whole-file rewrite, emptying the set — r6 claimed one bad
  entry emptied it; measured against the pre-change loader it cost exactly one member) — the F-a(ii) tripwire, which does not exist today; **P4**
  absent/unreadable/non-array → empty set, no throw. Plus a live before/after dump of the sorted id
  set from all six call sites (five node + the app’s, read separately) on the real file, diffed to empty in the commit message. `checks` job
  green; README registry entries for BOTH new files at creation; `.gitignore` decision recorded
  (proposed: TRACKED, so the roles survive a clone; it holds no PII).
- **SEP16b — `pipeline/commands/read-watchlist.mjs`: the report surface (MECHANICAL move).**
  The rendering moves out of `runWatchlist` into the new command, through `emitReport` so it exists
  in stdout AND its own dump entry. ONE compute path — the command imports the same row builder;
  no duplicate quote loop. Decision 2 Option 1 applies: `estimateRank` is called with no `extra`.
  **Verify:** the new surface's table **byte-matches** the old section's table on the same inputs
  (the SEP4 shape) — including the grade column, which is the Decision-2 tripwire; `--json`;
  empty/absent watchlist → clean message, exit 0.
- **SEP16c — the main scan's roll-up (the F-d doctrine fix).**
  `runWatchlist` keeps compute + `logSuggestions` + publication (Decision 1) and loses only its
  three `console.log`s (`screen:2499-2501`). In their place, one line that **NAMES** the
  falling/crash-risk rows: `watchlist: 60 tracked · 15 crossed into a niche table · falling: <names>
  · run read-watchlist.mjs`. The falling/crash-risk set comes from data already computed
  (`row.falling` / `watchlistNote`'s reason, `screen:2434`) — no new signal.
  **Verify, and these are the F-e tripwires:** (1) `suggestions.jsonl` gains the SAME number of
  `mode:'watchlist'` rows per pass as before — **counted, not assumed**; (2) `screen.json`'s
  `watchlist.rows` length, `watchlist.headers` and `html.watchlist` are unchanged (diff two
  artifacts); (3) the deployed Scan tab still renders the section — checked in a real browser, since
  `js/ui.js:440-443` guarantees CI cannot see this; (4) a falling watchlisted item is NAMED on the
  main scan — assert with a fixture that has one, because this is the doctrine hole.
  **Docs:** `scan/SKILL.md:867-868` (the `watch-reserve-full` "read it there" pointer) and `:934-938`
  (the Watchlist-section bullets) reconciled IN PLACE, `version:` bumped; CLAUDE.md's ask-routing
  table gains the new command; `render.mjs`'s WATCHLIST tier entry reconciled.
- **SEP16d — the roles earn their keep: `target` / `hold` / `probe` + `--audit`.**
  `target` (I intend to buy): multi-week range position + accumulation level, composed from
  `js/termstructure.mjs` + `range-position.mjs` + `hourly-lmh.mjs`. Read ASYMMETRICALLY — range
  position is a caution at extremes, never a credit; the wording must not imply "low in the range,
  therefore buy". `hold` (I own it): the exit level and the **ask-reach AT that level**, from
  `js/windowread.mjs` (`windowStats`/`reachedDays`/`placement`/`realityClause`) — the same numbers
  `read-window-range.mjs --ask` prints, routed, not recomputed. `universe`: no separate render; the
  roll-up covers it — say that plainly rather than implying a fifth surface. `probe`: ever traded /
  ever surfaced / ever held; three nos ⇒ prune candidate. `--audit` is the PRUNE direction and
  **imports `buildAudit` from `read-schedule.mjs:249`** (already exported) for the ADD direction —
  two homes for "who belongs on the watchlist" is how forks are born.
  **Anchor this chunk answers:** an Armadyl crossbow listed at 37m sat unsold for days;
  `read-window-range.mjs "Armadyl crossbow" --ask 37000000` returns `reached 2/14 days · placement
  p86 · ⚠ spike-top`. It was never auto-surfaced because `/positions`' window-exit note fires off a
  big-ticket lot in `positions.json` (F-b grant 8) and that lot never reached the book. **No lot ⇒
  no note ⇒ zero automatic reach checks on an untracked 36m position.**
  **Verify:** replay the anchor from a sidecar fixture and show the clause side-by-side with
  `read-window-range.mjs`'s — the ONE falsifiable claim these roles make; assert it prints with NO
  `positions.json` lot present, since that is the entire reason the role exists; no `level` and no
  live ask → an honest "no level to test", never a fabricated one. Nothing writes `watchlist.json`.
- **SEP16e — the `extra`-wiring question (Decision 2 Option 2). NOT scheduled; needs a ruling.**
  Ships only against a costed before/after: the grade-distribution delta on the 60, the 45 new 1h
  fetches per scan, and whether the resulting `pFillN > 0` is honest for rows that are gate-exempt
  precisely because their books are unverifiable. Until then the marker stays, and the reason it
  fires is documented at the call site so no future reader mistakes it for an item property.

**Non-goals (each is a plausible wrong turn).** Do NOT touch `rateItem`/`estimateRank`/
`THIN_GRADE_CAP` — the undifferentiated grade is a REPORT defect (the band answer printed for 45
items no band pass would admit), and 60/60 `(thin)` is Decision 2's artifact plus a selection effect,
the watchlist being deliberately big-ticket and slow. Do NOT change any gate, floor, threshold or
reserve. Do NOT migrate `watchlist.json` to ids or to objects. Do NOT add a new estimator.

**Output/prose delta:** main-scan stdout −~3,000 tokens (the table moves; a naming roll-up replaces
it). **No compute or fetch saving** — Decision 1 keeps the quote loop where it is; any claim of a
scan speed-up from this chunk is false.

**Falsifier + observer:** a watchlist row that would have warned goes unseen because the separate
command was never run. Observer: the roll-up NAMES the falling/crash-risk rows (F-d), so the
time-sensitive half is visible without running anything; the rest is Ben's cadence. Pre-agreed
revert if the pointer proves insufficient: fold the TABLE (not the notes) back into the decision
surface. Second falsifier, specific to Decision 1: if a future reader finds the retro numbers
changed across SEP16, the row-count assertion in SEP16c was wrong — that assertion is the whole
guarantee.

**Ruling dependency:** R-watchlist (RULED — this chunk is its encoding), with the surface-vs-compute
reading flagged for veto in Decision 1; R-retrohorizon (OPEN, §4) gates SEP16e's sibling question
and any future removal of the watchlist log.

### SEP2 — console-mutation containment (first follow-on per risk-weighted order)
**Change:** new `pipeline/ci/lint-console-mutation.mjs`: assignment to `console.log`/`console.error`/
`process.stdout.write` fails OUTSIDE (a) the three pinned entrypoint-guard sites (`quote-items.mjs:1044`,
`watch-positions.mjs:591`, `screen:2790`) and (b) `pipeline/test/**` capture-and-restore patterns —
the round-2-found fourth site (`pipeline/test/validate.test.mjs:72-74`, assign + `finally` restore,
verified) is legitimate and a naive "any assignment" rule reds it day one; the test-scope policy is
stated in the guard header, not discovered. Registered in `checks.yml` + the THREE governed docs
`lint-guard-lists` enforces (its GOVERNED DOCS list — the only new CI guard this plan ships, so the
bookkeeping is 3 doc mentions + 1 README entry, not r2's implied four-guard cost; see §11).
**Verify:** mutation test (module-scope stub in a scratch copy → red; live tree green); full
checks job.
**Output/prose delta:** +1 lean header (≤ NEW_FILE_CAPS) + 3 one-line doc mentions.
**Falsifier + observer:** a swallowed-output incident recurs via a path the lint permits (aliasing,
a new channel) — observer: the incident itself plus SEP1a's runner gate, which converts the
likeliest symptom (a silent suite) to RED. Aliasing is an ACCEPTED BLIND SPOT (same class as
`check-daemon-safety`'s).

### SEP11a — the verify ledger + digest footer (tool half; no ruling needed)
**Change:** `read-window-range.mjs` appends each `--out` result to
`pipeline/.cache/verify-ledger.jsonl` with **`ts` added** (the `--out` file itself has none —
verified :822-826) and the scored levels it already carries (verified :622,:637 — r2's "no price
context" claim was wrong on this half, recorded); append-time pruning drops entries older than 48h
(the "session-scoped" label is banned by evidence: `session-thesis.json` is a month stale,
`edge-map-panel.jsonl` is 60 MB unpruned [r2-measured] — this ledger prunes ITSELF, no separate
job). The digest footer reports per rendered row: verified (with the entry's AGE and scored
levels, flagging a mismatch when this pass's quoted ask has moved off the scored level — the
staleness-cause-inside-the-fix recursion round 2 caught) / no record. Both skills' hardcoded
`verify.json` path (scan :725, positions :486 — verified clobber) becomes harmless: the LEDGER is
the read source; `verify.json` stays last-run scratch.
**Verify:** fixture ledger + pool → footer lines incl. an aged-entry mismatch case; absent ledger
→ honest absence line; full checks job.
**Output/prose delta:** footer ≤ 1 line per digest row.
**Falsifier + observer:** a relay claims verification for an item the ledger lacks, or quotes a
verified level the mismatch flag was flagging — observer: the footer itself (it prints the
contradiction); residual gameability (running the trio unread) stated, not oversold.

### SEP5 — reach values carry their basis; `fmtReach` beside `reachFraction`
**Change:** producers thread `{hit, n, basis, scope}` (additive); ONE formatter `fmtReach` in
`js/estimators/reach.mjs` (see §6 — third home proposal, this one grounded: same module as the
basis rule; app-imported via the estimators barrel → APP_VERSION bump, rule-5-enforced, E9 guard
unbuilt). Consumers this chunk: the SEP12 inline preview (replaced), `emit.mjs:170,202` (window-
scoped counts rendering byte-shaped as full-day), `js/validate.mjs:156-158` (the coming-8h window
named), `cells.mjs:22`'s silent recent-primary collapse (gains the `r` suffix).
**Verify:** goldens re-pinned line-by-line; render-coverage test (fixed-regex pattern, stated
limit); per-basis unit tests; full checks job.
**Output/prose delta:** +≤4 chars per reach token + one legend line per report (R-noise; charged
against Cause H).
**Falsifier + observer:** an unlabelled `N/M` token on a COVERED surface — observer: the coverage
test (CI). New surfaces evading it are an ACCEPTED BLIND SPOT recorded in the test header.

### SEP6 — reach basis, remaining surfaces
**Change:** route the remaining census through `fmtReach`. Census stated WITH ITS PATTERN (round-2
correction: a bare count is not reproducible — 38 sites/9 files narrow vs 49/11 broad): the
executor re-derives by the grep recorded in the chunk before editing; known members incl.
`quote-items.mjs:512-514,540-541,817,906-913,968-970`, `watch-positions.mjs:222-223,262-263,270,272`,
`read-window-range.mjs:267,606,621-669,725`, `screen:1380-1381,1420-1421,2315` (the walk-forward
pair keeps an explicit two-token form), `emit.mjs:329-334`, `js/reverseflip.mjs:271`,
`js/windowread.mjs:171,240,242`, `report-archive-gate.mjs:91`.
**Verify:** as SEP5, per-file diffs reviewed.
**Output/prose delta:** ~0 beyond suffixes.
**Falsifier + observer:** as SEP5.

### SEP7 — what survives of the label chunk (registry-render half RETIRED — Cause C rewrite)
**Change:** (i) repair the drifted `NOTE_KINDS` guard: derived emitted-set (not the hand-typed 11
at `render.test.mjs:284`), reverse check (a dead entry fails — `trajectory`, verified dead), full
18-entry coverage. (ii) `suggestionEntry` gains additive `verdictKind`; `join-outcomes.mjs:106`
carries it; the audit gating any old-field change runs against the SEVEN writer sites. (iii) grade
states its basis where it renders: the digest/table header glosses `grade` with the pair it rates
(one line — the narrow, reachable target replacing r2's deletion bar). Then `scan/SKILL.md:31-33`
(the warning sentences ONLY) compress to a pointer; **:34-38 STAY** — round 2 verified (and I
re-read) that the span carries a live instruction (`spec.admitMinNet` + relay-the-skipped-footer)
and breaks mid-sentence at :37→:38, so r2's "delete :31-37" bar was unreachable as written;
RETIRED, reason recorded. The `fact/triage/measured` rendering marks are RETIRED per Cause C's
rewrite (saturation, B2) — the surviving principle is C-MEASURED, enforced by rulings like SEP12,
not by a mark vocabulary.
**Verify:** the three guard directions each mutation-verified against a named mutant; goldens;
schema additive; `lint-skills` green.
**Output/prose delta:** negative (skill sentences compressed; no new vocabulary).
**Falsifier + observer:** a future measurement lands as a comment/caveat without the surface
changing or an owner decision recorded — observer: the wave-review process itself (this is
C-MEASURED's residual judgment half; ACCEPTED as unenforceable by lint, stated).

### SEP8 — staleness rides the estimate
**Change:** unchanged from r2 (premise intact; round 2 strengthened it via the ledger-staleness
recursion): `estimatePair` accepts `extra.liveAge`; the bundle carries `anchorAge` when a clamp
BOUND the price; `cells.mjs` renders `liveAgeTag` in-cell past `QUICK_FRESH_MIN` (R-stale);
additive `estAnchorAgeMin` shadow field.
**Verify:** the 0-of-7 × 64-min incident as a fixture; non-stale paths corpus-diff byte-identical
(PP2 precedent); full checks job; APP_VERSION bump.
**Output/prose delta:** tag renders only when stale.
**Falsifier + observer:** a stale-anchored Est. sell renders untagged — observer: the incident
fixture (CI) for the covered path; callers passing no ages render absence and are LISTED (the
list is the blind-spot record).

### SEP9 — same-word cleanups that need only names
**Change:** (a) `isBigTicketUnit(price)` / `isBigTicketLot(value)` beside the constant; the SEVEN
sites call them (census corrected per round 2: two semantics — the remedy fit the corrected count
all along); screen's local `isBigTicket` deleted here; GLOSSARY entry; `item-context.mjs:423-424`
says "lot". (b) additive `capEffIntrinsic` log field; digest header glosses the displayed column
buy-limit-bounded. (c) `deploy` cell marks the 100m fallback (`deploy 100m (assumed)`).
(d) windows/day: `LAPS_PER_DAY_CEIL`'s literal 6 becomes an import of `REFILL_WINDOWS_PER_DAY`
(same physical rule — verified `desk-cadence.mjs:38`); `ACTIONABLE_WINDOWS_PER_DAY` keeps its
distinct name; the render sites gloss which is in play; screen :46's prose flag retires.
**Verify:** goldens (marked cells only); ship-time grep: no bare `BIG_TICKET_GP` comparison outside
the predicates + home; full checks job.
**Output/prose delta:** ≤ 0.
**Falsifier + observer:** a new bare comparison or a doc equating unit/lot again — observer: NONE
standing (a semantic lint is out of scope, §9) — ACCEPTED BLIND SPOT; the ship-time grep is the
only check, recorded.

### SEP10 — measurements carry their provenance
**Change:** each `join-*.mjs` decision run writes a committed artifact
(`pipeline/measurements/<name>.json`: spec, date, decisive numbers, scorer sha); governed docs cite
the path instead of transcribing; absorbed from r2's SEP7: a check that any doc/registry reference
to a measurement artifact resolves on disk. Scope honesty per C-ARTIFACT (§6).
**Verify:** exemplar conversion (the `join-reach-basis` README entry); `lint-docs` + full checks
job green.
**Output/prose delta:** negative in docs.
**Falsifier + observer:** a headline number hand-transcribed with no artifact, or an artifact
hand-edited against its provenance line — observer: the path-resolution check for existence;
content drift is an ACCEPTED BLIND SPOT until the lint-docs value-pinning extension (deferred,
stated).

### SEP15 — plan lifecycle: the immortal-plans loophole + the self-trusting guard (NEW in r3)
**Change (Cause E item 5, prose axis — all verified by running the guard):** (a) delete the
fully-shipped plans the existing fold-and-delete rule already mandates (round 2: three plans,
1,093 lines [r2-measured] — executor derives the set from PLAN.md's Status table, runs
`lint-plan-refs.mjs --refs <NAME>` before each delete per CLAUDE.md). (b) close the loophole that
makes closed NEGATIVE-RESULT plans immortal: the fold rule keys on "last chunk ships", and a
negative result has no last chunk — amend docs/PLANNING.md: a plan closed by decision folds on the
DECISION. (c) `lint-plan-lifecycle.mjs` flags 42/42 "ok" INCLUDING a status beginning
"SHIPPED 1c03fd9 … all three workstreams" (verified by run) because its verdict trusts the
self-written status line; repair: a COMPLETE_RE-leading status cannot flag ok without a stated
reason-to-exist, and the report gains a stale-status age check. Whether it joins `checks.yml`
(it is absent today — verified) is flagged for Ben: it would be guard #13 with 3 doc mentions.
**Verify:** the repaired guard flags the known SHIPPED-status plan in a fixture copy; plan-refs
green after deletions.
**Output/prose delta:** −1,000+ lines of `plans/`.
**Falsifier + observer:** a fully-shipped or decision-closed plan survives a month post-close —
observer: the repaired lifecycle report, run by `/cleanup` per wave.

### SEP3 — gates never turn off silently (demoted; nothing depends on it)
**Change:** as r2, with the corrected wiring (notes key on the EMPTY-SUCCESS state at
`quote-items.mjs:394` and :721, not the catch; the other sites as censused in Cause E item 3).
Status honesty: nothing on the list is degraded today.
**Verify:** per-site fixtures (unreadable/ empty inputs) assert the note; healthy-run output
byte-identical.
**Output/prose delta:** notes render only when something degraded.
**Falsifier + observer:** a real input failure occurs with no note — observer: the next `/morning`
or watch session that hits it (the fixtures cover the censused sites; an UNCENSUSED site failing
silently is the accepted blind spot, and the census is a floor).

### SEP1b — TAP direction for the suite ("whenever"; replaces the retired harness design)
**Change:** teach `run-tests.mjs` to READ TAP where a suite emits it (pass/fail/count from the
protocol, not exit code alone); migrate suites toward `node:test` opportunistically — when a suite
is touched for other reasons, not as a 122-file wave. ~14 suites need hand work [r2-measured;
shape verified: `probes.test.mjs:44` uses `ok(cond,msg)`; `cache-warm-hook`/`daemons` await
thenable `ok(…)`]. The r2 private `# harness:` line and its shared-module design are RETIRED
(reason: TAP already exists in-tree; a private format plus a TAP exemption list is a
hand-maintained-list rot vector — round 2, accepted).
**Verify:** TAP suites' counts appear in runner output; a TAP suite reporting 0 tests fails; full
checks job.
**Output/prose delta:** negative over time (bespoke `ok()`s retire on touch).
**Falsifier + observer:** a migrated suite passing with 0 executed tests — observer: the runner's
TAP count check (CI).

### SEP11b — the inspection-depth skill half (LAST; needs R-depth + observed SEP11a)
**Change:** as r2 — `scan/SKILL.md` replaces "every top pick" with R-depth's ruled trigger; a
one-line disposition per digest row; a dismissal must cite a hard fact, and (r3) "verified" means
the LEDGER has it. Written against SEP11a's observed footer behavior, and edits BOTH skills that
invoke the trio (scan AND positions — the r2 draft edited only scan, round-2 correction accepted).
**Verify:** `lint-skills` green; prose delta ≤ 0 across the two skills.
**Falsifier + observer:** a disposition line naming an item the ledger lacks — observer: the
SEP11a footer (prints the contradiction in the same output the disposition rides in).

## 8. Encoding boundary

Encoded: SEP1a/1b (runner), SEP2 (lint), SEP12 (ruled deletion + cell), SEP4 (extraction), SEP5/6
(structs + formatter + coverage tests), SEP7's guards + log field + gloss, SEP8 (anchor age), SEP9
(predicates), SEP10 (artifacts + path check), SEP11a (ledger + footer), SEP15 (lifecycle repair), SEP16 (watchlist surface — the sidecar schema, the five-node-loader read path and the roll-up's
falling-NAMING rule are encoded; WHICH role an item deserves stays judgment, proposed by
`--audit` and never auto-written; its cadence stays Ben's).
Judgment (tagged in skills / process rules): SEP13's stopping rule (a process rule — CLAUDE.md is
its one home); SEP14's one judgment residue — the R-surface default choice (its mode, dump
completeness and reader are encoded, CI-pinned); SEP11b's dispositions; C-MEASURED's residual half (nothing
can lint "this measurement should have changed the surface" — the wave review owns it, stated).
Retired prose on encode: skill warning sentences (SEP7), screen :46 windows/day flag (SEP9), the
verdict-comment block (SEP12).

## 9. Not proposing, and why (incl. items retired this round)

- **RETIRED r3 — the per-suite tail/harness contract** (SEP1's r2 design): TAP exists in-tree;
  a private format would need an exemption list — the rot pattern itself. Replaced by SEP1a+SEP1b.
- **RETIRED r3 — the label-kinds rendering registry** (r2 SEP7a): the output is hedge-saturated
  (Cause C rewrite, B2's counts); mark #194 is not a fix. Survivors: guard repair, `verdictKind`,
  grade gloss.
- **RETRACTED r3 — production spearman dedup** (edge-map copy is `experiments/` — verified);
  retracted r2: `parseGp` (documented two-homes split).
- No big-bang rewrite / universal value-objects; no wholesale render relocation; no semantic/LLM
  lints; no re-measurement of settled questions; no grade/rank re-math (F1's territory); no wire
  renames (additive only); no fixing all 47 bare-null degrades (gate class only); median/
  `SENSITIVITY_HORIZONS_H` dedups → Discovered list.
- **No standing big-ticket lint** (semantic); SEP9's ship-time grep + GLOSSARY are the defense,
  blind spot accepted and recorded at the chunk.

## 10. Honesty (process rule 4)

- Review-round measurements not independently reproduced are marked `[r1-measured]`/`[r2-measured]`
  at each use; executors treat every census as a floor and re-derive by the stated pattern before
  editing. Independently verified this round: the TAP suites, the `ok(cond,msg)` shape, the
  test-file console capture (validate.test.mjs:72-74), the experiments/ location of edge-map,
  both skills' verify.json paths, the `--out` write path + missing ts + present levels, the
  lifecycle guard's 42/42-ok run incl. a SHIPPED-leading status, the ✓/✗ render line (:945) and
  the discarded `staleGuarded` (:829 vs :1308), windowread's app imports (quotecore.js:40,
  trends.js:7), money-format's zero imports, and lint-comments' ROOTS/caps/tracked status.
  Verified r4 (round 2): the last-report dump holds exactly TWO reports (band + churn — read the
  file, 2 entries, ~196 KB); the watchlist section prints via bare `console.log` (`screen:2540` —
  so under the quiet default it reaches NEITHER stdout nor the dump), the digest via `realLog`
  (`:3019`), and `emitReport` (:1995) is the only report-emitting call site — the dump-completeness
  gap SEP14 part 1 closes. The section/line-kind token tables in Cause H are [r2-measured] — not
  independently reproduced; the executor re-measures on a current pass before pinning SEP14's
  ~8,000-token target. Process record: r3's opt-in chunk was built on a coordinator instruction
  the owner later overruled — the override and the verbatim ruling are recorded at §4 R-coverage
  rather than the chunk being silently swapped.
- **My own errors, kept on record as instances of the causes:** r2's prose ratio understated the
  problem (Cause G, corrected); r1's falsifiers held veto paths (labels not meaning what they say);
  r1 mis-filed `cells.mjs` across its own boundary; the r1 "six meanings" big-ticket count
  conflated operands with semantics (corrected to two semantics / seven sites); the r1/r2 relayed
  summary once ran ahead of the plan's conditional framing (degrade gates "off today" — they were
  not). Also recorded: THREE successive review rounds produced three different tail censuses and
  three different median counts under three patterns — the instability is the finding, and it is
  why SEP1b/SEP6 state patterns, not numbers.
- Coordinator corrections recorded: the goldens-distrust ordering argument was stale (zero silent
  suites at re-run — SEP1a is insurance); the formatter-home relocation rationale was false
  (verified; home is now `js/estimators/reach.mjs`).
- Prose/output deltas are REVIEW-enforced, not lint-enforced, for markdown, skills and tests
  (`lint-comments` ROOTS exclude them — Cause G governance note); only `digest.mjs` and
  `lint-console-mutation.mjs` among new files are cap-governed. The r2 §11 claim implying
  otherwise was wrong on four of six files (round 2, accepted).
- SEP1a cannot make assertions meaningful; SEP11a is gameable by running-without-reading; SEP9's
  protection is ship-time only; C-MEASURED's enforcement is partly judgment. Each blind spot is
  stated at its chunk with its observer or its acceptance.
- Thresholds touched remain PLACEHOLDERs; moving them changes their address, not their evidence.
- This plan is itself long prose in a repo whose Cause G is prose accretion; its defense: plans/
  is transient (SEP15 makes that true in practice, not just in doctrine), and §12 measures whether
  the work moved the needle.

## 11. Bookkeeping & compatibility checklist (per-chunk)

- New files: `pipeline/lib/signal/digest.mjs` and `pipeline/ci/lint-console-mutation.mjs` are
  `NEW_FILE_CAPS`-governed; the verify ledger, measurement artifacts and any fixture suites are
  NOT (outside lint-comments ROOTS) — their size discipline is review-owned and stated here, not
  implied to a guard. README "Map of the repo" entry per new file, same commit — **kept lean
  deliberately**: the measured 3,708-char average README entry [r2-measured] is a symptom (Cause
  G), not a norm to match.
- Exactly ONE new CI guard ships (SEP2) → 3 governed-doc mentions + 1 README entry (r2's
  four-guard/12-mention projection dissolved with the harness retirement; SEP15's possible
  promotion of the lifecycle report to `checks.yml` is flagged for Ben as guard #13 with the same
  3-mention cost, not assumed).
- Every chunk's verify list runs the FULL twelve-guard `checks` job.
- Wire: `suggestions.jsonl`/`screen.json` changes additive only.
- APP_VERSION: SEP5 and SEP8 touch app-imported modules → bump per rule 5 (E9 manifest guard is
  unbuilt — the bump rides review); SEP12's digest cell is CONSOLE-only (digest never reaches
  `screen.json` — CLAUDE.md's digest section), no bump; SEP1a/1b/2/4/10/11a/13/15 pipeline-only.
- Docs pass per chunk reconciles in place (CLAUDE.md pointers; MARKET-ANALYSIS §1 digest columns
  at SEP12/SEP5; GLOSSARY at SEP5/SEP9; ARCHITECTURE one-home row at SEP4; PLANNING.md fold rule
  at SEP15). Skill edits (SEP7, SEP11b, SEP14, SEP16) bump SKILL.md `version:` frontmatter.

## 12. Success observation (six weeks; added per round 2)

Concrete, measurable, and owned — checked at the wave retro after the front ships:

1. **Correction ratio:** correction/fix-up commits per shipped chunk < 1:1 over the window
   (baseline: ~1:1 on 2026-08-09's twelve-round day [coordinator-measured]; measured from git log
   by the existing commit-subject conventions).
2. **Read budget:** tokens per standard `/scan` read falling (proxy: byte size of the stdout
   surface the skill reads per pass; baseline **45,572 tokens** measured on a real
   `--verbose --digest --mode all` run, of which per-row note families are ~32,000
   [r2-measured]; SEP14's decision-surface target ~8,000 with all four niches intact). SEP14 is
   the main lever; SEP5/SEP12/SEP3's additions must not eat it. The skill file itself
   (~24.3k tokens [r2-measured]) is a second lever, governed by the per-chunk prose deltas.
3. **Incident classes:** zero recurrences of the four front-class incidents (silent suite;
   measured-worthless label rendered as verdict; basis-less digest reach read; >5 review rounds
   without check-in).
4. **Explicitly NOT a metric:** realised gp — the owner confirmed trading frequency is deliberately
   low to make room for this work; a future reader must not score this plan against the book
   (R-metric, §4).
