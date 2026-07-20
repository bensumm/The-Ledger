# CHANGELOG — The Coffer / The-Ledger

Deep per-version writeups (rationale, superseded approaches, the "why" behind each shipped
change) live here. `CLAUDE.md`'s "Done (recent)" section keeps only a one-line load-bearing
pointer per entry — the "do not rebuild this" signal — and points here for the full story.
Moved out of `CLAUDE.md` by PLAN.md chunk K3 (2026-07-04). Newest entries at the top of the
recent block; the ordering below preserves the original CLAUDE.md sequence.

For anything older or not captured here, the commit history + `git show <sha>` is canonical.

## Recent

### Diurnal windows labelled in BOTH local + UK zones — `fmtHourRange` (pipeline stdout, no APP_VERSION, 2026-07-20)
Every diurnal window the tools emit (the `↗ windowExit` peak-window note on `quote-items.mjs --positions`, the
DIP/PEAK headers in `read-window-range.mjs`'s hour-of-day profile) is an hour-of-day computed with LOCAL getters —
so it reads in the runner's zone (Pacific for Ben) while OSRS demand is UK-driven. Stating a window in one basis
and reasoning in the other was a **recurring narration error** (Ben, 2026-07-20: a buy-limit note read off a stale
cached dump got blamed on GMT/Pacific — the limit math was fine, but the underlying window-basis confusion is real).
Fix: `fmtHourRange(startH,endH)` in `js/money-format.js` renders both — e.g. `01:00–03:00 PDT / 09:00–11:00 UK`. The
local⇄UK offset is Intl-derived per instant (`ukHourOffset`), so it's DST-correct for **both** zones (≈+8h most of the
year, ±1h during the ~2-week transition mismatch) rather than a hardcoded +8; `localTzAbbrev` names the local side.
Wired into `quote-items.mjs` (windowExit note) and `read-window-range.mjs` (DIP/PEAK headers); the compact `→ BID/ASK`
recommendation line stays local-only to avoid bloat. No app-behavior change (the browser doesn't call the new
export yet) → no `APP_VERSION` bump. **Immediately surfaced a live mislabel:** the `godsword-uk-day-peak` thesis
resolves to a 17:00–21:00 PDT peak = **01:00–05:00 UK** (UK small hours, not UK day) — the name's basis is wrong,
flagged for re-derivation.

### PLAN-AMPLITUDE-SCAN — the `amplitude` 24h-cycle discovery lane + THE SWAP (console-only, no APP_VERSION, 2026-07-19)
A new `--mode amplitude` flip-niche: buy the daily TROUGH, sell the daily PEAK, hold ~a day, cycle — the
big-ticket-that-oscillates-daily class (Masori-body class) the band screen is structurally blind to (band
prices the 2h band so a ~day-long ~4% swing reads ~0% at the 2h grain, and its `net×P÷TTF` rank buries a
day-long fill at P~0.06/ttf~26h). Built as a 4th DECLARATIVE spec over the existing machinery, NOT a
`cycle=t` engine (§6 verdict): **A1** a pure `js/amplitudescreen.mjs` — two-stage gate (Stage-1 attenuated
daily-range proxy off the 6h archive picks the fetch pool → Stage-2 exact `amplitudeGate` off one full-day
`windowStats(series1h)`: after-tax daily-amplitude floor, both-leg recent-3 daily reach + full-window
fallback (staleOptimistic-guarded), trend/knife guard) + the deployable-units min; fixture-tested, no
fetch. **A2** the `amplitude` spec in `FLIP_NICHES` (`gate:'amplitude'`→`gateAmplitudeCandidates`,
`estimator:'amplitude'` = the two-leg daily-reach family so the STANDARD `net×P÷TTF` rank/grade/suggestions
carry it, `priceBasis:'daily'`) + `renderAmplitudeMode`'s daily-cycle console table. **A3** a `--hold-days`
parameter (1 / the 1.5-day day-crossing experiment) + `weekdayProfile` (js/windowread.mjs — the genuinely-new
day-of-week seasonality read; no day-of-week tooling existed). **A4 / THE SWAP** value→**Invest** label
rename + `--mode invest` alias (the `value` KEY stays — a key rename forks the suggestions ledger/goldens);
**`amplitude.inAll=true` and `value.inAll=false`** so `--mode all` runs band+churn+amplitude (value stays
runnable via `--mode value`/`--mode invest`). **A5** the make-or-break measurement — the `amplitude` shadow
block on `suggestions.jsonl` + `join-amplitude-outcomes.mjs` (replays each pick against the next `holdDays`
of the 1h archive for a would-have-fill UPPER BOUND) + the retro-join lane rollup into `/analyze`. **A6** the
one real dedup — `eachLiquidCandidate` extracts the shared candidate-loop boilerplate all three gate stacks
(band/value/amplitude) repeated; replay goldens pin band/churn/value byte-identity. Launch is console-only +
inform-first (excluded from `screen.json`, no app tab); every threshold is a PLACEHOLDER (n≈0) — the lane is
a hypothesis until the shadow replay + realized retro-join earn it. Live trial: amplitude surfaces the class
(Inquisitor's mace / Arcane sigil / Torva / Nightmare staff / Bellator ring) and `--mode all` runs amplitude
not value. No `APP_VERSION` bump (console-only pipeline; the registry addition is app-safe — verified the app
module graph evaluates and estimateRank on the amplitude spec returns a harmless null 'daily' pair).

### PERF-1 + LOCAL-FILE1 — `loadBands` off flat files onto the SQLite archive; local watchlist/ignore write-back (0.65.5, 2026-07-19)
Two independent fixes from the same session. **PERF-1**: `loadBands` (`pipeline/lib/marketfetch.mjs`)
was reading EVERY retained day-file under `.cache/bands/` (90-day retention, grown to 359MB/17 files)
on every single `/scan` pass just to pull the ~24 needed 5-minute windows — measured at 45-70% of
total wall time. Migrated onto the Tier-1 SQLite archive (`marketAt('5m', w)`, mirroring
`loadAll24hRolling`'s check-before-fetch pattern) — cut a warm `--mode all` pass from ~3-5s to
~1.9s, and removes the unbounded future growth (the flat-file cache was on track to get 5x worse
over the next couple months). `loadHistBands` (the outcome-join's own reduced per-item cache) is
untouched — separate function, separate cache. The dead `.cache/bands/` directory was deleted;
`BANDS_RETENTION_DAYS`/`BANDS_DIR` are gone (the archive is append-forever by policy, no retention
pruning needed). New coverage: `pipeline/test/loadbands.test.mjs`.

**LOCAL-FILE1**: Ben's watchlist toggles in the browser (`pushWatchlist`/`pushIgnored`, `js/ui.js`)
only wrote back to the tracked `watchlist.json`/`ignored-items.json` when a GitHub token was
configured (the mobile/Pages path) — on localhost, with no token, additions lived only in
`localStorage` and were invisible to the pipeline/console screen, causing a silent 1-vs-23-item
mismatch Ben caught by comparing the app's Watchlist tab to the console output. Since "the local
server IS the app" (Pages was the early proof of concept), `dev-server.mjs` now exposes `POST
/api/local-file?path=<allowlisted file>` — a zero-git local write, same discipline as the existing
`/api/scan` — and the two push functions try it first on localhost, falling through to the GitHub
path unchanged everywhere else. `watchlist.json` backfilled to the 23 items already in Ben's
browser state as a one-time manual sync.

### AC4a — percentile-placement + grain-aware reach rendering on `read-window-range.mjs` + `--json` (pipeline-only, 2026-07-17)
`PLAN-REACH-CALIBRATION` AC4a (+ AO2). A scored `--bid`/`--ask`/`--exit` on `read-window-range.mjs` now
reports its PERCENTILE PLACEMENT in the trailing daily-low/high distribution BESIDE the existing reach
count — e.g. `--ask 398 → would have been reached on 1/14 day(s) · recent 0/3 · placement p93 of the
14-day daily-HIGH distribution`. This is the descriptive reframe of Finding 3: "reached k/N" only asks
whether the 1h-bucket AVERAGE crossed a level, so a low count on a liquid book read as a false mirage
warning (Soul rune's ~20+ real 397–399 fills vs "reached 1/14"); the placement says WHERE the level sits
historically, with n stated (process rule 4). The price→percentile primitive is a new pure
`placement(sortedAsc, x)` in **`js/windowread.mjs`** — the shared js/ home beside `quantLow`/`quantHigh`
(the inverse direction), chosen over reaching into `pipeline/lib/fill-placement.mjs`'s `cdf` (calibration
code built for AC1's study, a different module layer); `cdf` now DELEGATES to `placement` so there is ONE
implementation. Where the Tier-1 archive (`lib/archive.mjs`, read-only + best-effort) has ≥3 covered
window-days, a less-smoothed **5m-grain** reach/placement rides ALONGSIDE the 1h figure (labeled, a LOWER
BOUND on the true gap per AC2), degrading cleanly to 1h-only otherwise — in testing it fired for liquid
items over a broad window (Soul rune 398 → 5m reached 3/7 · p57, materially less alarming than the 1h
1/14 · p93) and cleanly went 1h-only on a narrow/off-peak window. AO2's `--json` folded in on the same
touch: it dumps the assembled per-item result objects to stdout (the `analyze-record`/`analyze-fill-placement`
non-render `--json`→stdout convention, NOT `writeLastReport` — this command builds no render.mjs sections);
default markdown stdout is byte-identical when `--json` is absent (the console→`log` gate, same pattern
`analyze-fill-placement.mjs` uses). **NOT built, explicitly out of scope:** any "safe ≈ pXX" threshold or
recommendation — the placement is PURELY DESCRIPTIVE. AC3's calibrated liquidity-scaled safe quantile did
not proceed: AC1's evidence gate FAILED (the Finding-2 size-share knee is unobservable on our own fills,
"GATE RESULT: NOT MET"), so there is no calibrated basis for a "safe" annotation; the trust judgment (distrust
near the historical extreme on a thin book, trust deeper into the tail on a deep book) stays in the
human/skill + `docs/MARKET-ANALYSIS.md` layer. New tests in `pipeline/test/windowread.test.mjs` pin
`placement`. No `APP_VERSION` bump: `js/windowread.mjs` gained a new pure export no app code calls yet, so
no browser-visible behavior change. `docs/MARKET-ANALYSIS.md` Finding-3 guard reconciled in place (the
reach-count-only framing is superseded by placement, not appended-to); `README.md` inventory + PLAN updated.

### AC1/AC2 fill-placement calibration study — the knee does NOT replicate on our own fills (INVESTIGATION only, pipeline-only, 2026-07-17)
PLAN-REACH-CALIBRATION's evidence gate. New READ-ONLY command `pipeline/commands/analyze-fill-placement.mjs`
(pure core `pipeline/lib/fill-placement.mjs`, tested by `pipeline/test/fill-placement.test.mjs`) joins every
closed sell lot to same-day 1h bucket data and measures WHERE realized `sellEach`/`buyEach` cleared in the
trailing daily-high/low distribution (the `quantHigh`/`quantLow` percentile machinery) as a function of
volDay (→ `qEvidence`) and `sizeShare` = qty ÷ the CORRECTED composed rolling-24h volume (`rolling24FromTs1h`,
NEVER the broken `/24h`). AC2 rides along — the 1h `avgHighPrice` vs same-hour archive-5m max smoothing bias.
A NEW file, not an `analyze-record.mjs` mode: that command's contract is "no fetch, no writes, never a
commit/sync path", and this study fetches live `/timeseries?1h` + reads the archive. Builds NONE of
`safeQuantile`/`qEvidence`/`impactFold` (AC3) and touches NO live pricing/gating surface.

**Honest finding (rule 4 — the whole point of this chunk): the Finding-2 size-share knee does NOT replicate,
and CANNOT be tested on our own fills.** (1) Finding 2's shares were computed on the broken `/24h` denominator
and are inflated ~6–16×; on the corrected rolling-24h volume every placeable lot sits **below ~0.74% share**
(Soul rune 25k = 0.07%, Raw anglerfish 10k = 0.41%, not the 0.56%/6.6% Finding 2 reported). We have ZERO fills
in the ≥1% "impact" regime the knee describes — the only >1%-share lots are qty-1–5 lots of thin items, not
large tranches. (2) Within the observed 0–0.74% band there is no monotone degradation: pooled
Spearman ρ(share, placement) = +0.02 (≈0, wrong sign for a knee); the p80 bump in one share bucket is just the
one liquid item (Soul rune) we sold aggressively — a liquidity effect, not a share effect. The per-item
cross-item ρ = −0.30 (n=28) is weak, small-n, and confounded with liquidity. **AC2:** the 5m-max-vs-1h-avg
smoothing bias is tiny and flat (median 0.36–0.56% across all volume buckets, ρ=+0.09), and is only a LOWER
BOUND (the 5m value is itself an average). **Gate result: NOT MET** — the knee is unobservable on our ground
truth. The plan should stop at AC1 + AC4a's descriptive percentile rendering; AC3's calibrated SAFE threshold
should not proceed on this evidence (a coordinator + Ben ruling owns the go/no-go). Coverage caveats: only
102/227 sells placeable (the early period 07-02→07-07 exceeds the live 1h's ~15d reach), and the sample is
heavily clustered (top items 25/25/23/19/12 lots). No `APP_VERSION` bump (pipeline-only, no deployed-app
change). Docs: README "Map of the repo" (command + lib), PLAN-REACH-CALIBRATION AC1/AC2 marked DONE with the
finding.

### F1 calibration study — the gate cleared, the evidence is thin (INVESTIGATION only, no constant graduated; pipeline-only, 2026-07-17)
F1's documented sample gate (n≥30 per side×pctl×class×regime cell, ≥5 cells) cleared for the first time
(`join-outcomes.mjs --report`: "5 cell(s) clear n≥30. F1 MAY open" — PLAN.md's "currently 1" was stale).
Ben asked for an F1 investigation kicked off now. Delivered `pipeline/commands/f1-calibrate.mjs` — a
**read-only, PROPOSAL-ONLY** calibration study over the derived `outcomes.json` that touches NO live
pricing/gating code (`trendcore.js` and `js/estimators/families.mjs` are unchanged). It (1) re-audits the
gate, (2) prints P(fill)/median-TTF curves by side × class × band-percentile, and (3) proposes
class-conditional `patientTargets` percentiles + fitted `PFILL_*` / `TTF_*` magnitudes, each with
supporting n + a confidence label. Test: `pipeline/test/f1-calibrate.test.mjs` (9 checks, incl. a
drift-guard tying `MIN_N_F1`/`MIN_CELLS_F1` to `join-outcomes.mjs`).

**Honest findings (rule 4 — this chunk is entirely about this).** The gate IS computed correctly against
its own spec: the F1-gate line keys on regime, and all 5 cleared cells are 100% reconstructed
`stateAtFill.regime`, ZERO from the `'noreg'` fallback — regime is genuinely controlled, not just labeled.
(The `--report` 2D table's regime-COLLAPSED "cells clearing" side-totals differ from the 4D gate count —
display-only; the verdict line is right.) BUT the 5 cells are lopsided: **4 flat + 1 rising + 0 falling**,
and the lone rising cell (`buy|0-20|mid`, n=31) is **68% one item (Abyssal bludgeon)** — not broad. So
the confound is controlled only within `flat`. Directional proposals are trustworthy — thin buys under-fill
at the 0.20 percentile (P≈41% vs mid/liquid ≈72–75%, so thin needs a shallower percentile), sell 0.80 is
well-placed (P≈94–100%), and `TTF_INTRADAY_PRIOR_SEC` (12h) is ~10–100× too slow (realized intraday
first-fill 7–27m, round-trip hold median 0.9h). Magnitudes are NOT trustworthy: `TTF_MULTIDAY_PRIOR_SEC` is
UNTESTABLE (no multi-day lots, max hold 23.5h), `TTF_REF_VOL` unfittable (bimodal volume), and per-class
percentiles/`PFILL_*` rest on weak or proxy-based n. **CALIBRATION (the actual constant changes) remains a
separate, ungraduated decision pending Ben** — no live constant moved; no `APP_VERSION` bump (pipeline-only,
no deployed-app change). Docs: README "Map of the repo", PLAN.md F1 (stale count corrected, findings recorded,
F1 explicitly NOT marked done).

### The `estimatePair` sell-top proposal became a named model registry (0.65.3 → 0.65.4, PLAN-PIPELINE-COMPOSITION PC3, 2026-07-17)
The one DESIGN chunk of the composition wave (PC1 = the resolver, PC2 = the mechanical file split; this
lands on top). The sell-top proposal step of `estimatePair` — previously the neutral fold as inline math
plus the PB4 pressure trial as a `{pressureExit:true}` boolean that overrode both legs mid-function — is
now a named, registered MODEL under `js/estimators/sell-models/`: `reach-fold.mjs` (the neutral fold,
verbatim; DEFAULT + always-on shadow) and `pressure.mjs` (the PB4 trial, verbatim), keyed in
`SELL_TOP_MODELS` (index.mjs). `estimatePair` is now the SHELL/spine only — it preps shared inputs,
delegates the buy+sell proposal to the active model, then applies the non-skippable floors a model CANNOT
bypass (declared-exit anchor → anchor nudge → ordering clamps [buy ≤ live, sell ≥ live] → BE floor last).
A model chooses only its outer clamp bound (a pressure deep bid below the band low, a fully-reliable
pressure ask above the 24h high); the live floor + BE floor are the shell's. **Byte-identical**: the full
suite stays green (`estimators.test.mjs` unchanged assertions pass under `reach-fold` active; new PC3
assertions pin `{sellModel:'reach-fold'} ≡ default` and `{sellModel:'pressure'} ≡ {pressureExit:true}`),
and the barrel re-exports the `EST_*`/`PRESSURE_EXIT_REL_FULL` constants + `SELL_TOP_MODELS` so every
import path resolves unchanged (check-imports: 353 imports). Selection is wired through PC1's resolver:
**`--est-sell reach-fold|pressure`** (new), **`--pressure-exit` = legacy sugar** for `--est-sell pressure`
at all three call sites (an explicit `--est-sell` wins). **Active-plus-shadow, generalized**: `resolve()`
gained an optional `shadowPool` (→ `shadow` = pool minus active) + `compose.shadowModelsOf(registry)` pools
the `defaultShadow:true` models; when `pressure` is active the neutral `reach-fold` rides `SELL_MODEL.shadow`
and still logs the unbiased retro co-log to `suggestions.jsonl` — the mechanism that lets `safe-quantile`
(PLAN-REACH-CALIBRATION AC3) ship later as ONE registry line + a shadow model, no shell change. Also folded
the PC1 pickup: `--mode all`'s flip-niche set is now config-overridable via `pipeline-config.json`
`"modes":[…]` (an ARRAY resolved through the same precedence resolver; absent ⇒ `ALL_MODE_KEYS`,
byte-identical). `APP_VERSION` bumped because the browser-fetched `js/estimators/` module graph changed
(new files in the `export *` graph the app's `js/market.js` pulls), even though app-visible behavior is
unchanged — same convention as PC2. Docs: README "Map of the repo" (compose + the sell-models directory),
`docs/ARCHITECTURE.md` (the composition invariant — register a variant, don't thread a boolean),
`docs/MARKET-ANALYSIS.md` (the named-model framing, reconciled in place).

### `js/estimators.mjs` split into a directory behind a barrel (0.65.1 → 0.65.2, PLAN-PIPELINE-COMPOSITION PC2, 2026-07-17)
A PURE MECHANICAL file split — zero behavior change, proven by the full suite (all 66 test suites incl.
`estimators.test.mjs` + the acceptance/replay goldens that pin exact estimator output) staying green, a
byte-identical live `quote-items` A/B (HEAD monolith vs the split), and the headless smoke. The 659-line
`js/estimators.mjs` god-module (the N6 note in PLAN-ARCH-DOCS-AUDIT) held three distinct sub-concepts;
it is now the BARREL (`export *`) over four one-concept files under `js/estimators/`:
`families.mjs` (the P(fill)/TTF family estimators + the `ESTIMATORS` registry, `estimateRank`/`rankScore`/
`quotedPair`/`fmtTtf` + the founding header), `reach.mjs` (the reach-conditioning helpers `reachRelief`/
`dayHighFrom5m`/`askReachFactor`/`asymEstimate` + their constants), `pair.mjs` (the reconciliation price
estimator `estimatePair` + `entryDoctrine` + its `EST_*` constants), and `cells.mjs` (`EST_HEADERS`/
`estPairCells`/`estConfLean`). **Every existing import path is unchanged** — the app's `js/market.js`
(`import { estimateRank }`) and the pipeline shim `pipeline/lib/estimators.mjs` (`export * from
'../../js/estimators.mjs'`) both resolve exactly as before (check-imports: 348 imports across 10
entrypoints resolve). families↔reach is a runtime function-reference cycle (asymEstimate needs
estimatorFor/rankScore; estimateRank needs askReachFactor) — ESM-safe since both uses are at call time.
`APP_VERSION` bumped because the deployed `js/` file set changed (browser-fetched ES modules, no build),
even though behavior is byte-identical. This is the mechanical relocation PC2 promised; PC3 (the named
sell-model registry that replaces the `pressureExit` boolean) lands the one design change on top of this
structure. README "Map of the repo" carries the barrel + four-file entries.

### Agent-readable market-read dump (quiet-by-default, `--verbose` opt-in) + the Finding-3 reach-count docs guard (2026-07-17, `pipeline/lib/cli.mjs`+the three market-read CLIs+`docs/MARKET-ANALYSIS.md`+`/scan`+`/positions` skills — NO APP_VERSION, PLAN-REACH-CALIBRATION AO1+AC-0)
Two small, independent fixes riding the first two steps of the reach-calibration roadmap
(`PLAN-REACH-CALIBRATION.md`). **AO1:** `screen-flip-niches.mjs`/`quote-items.mjs`/`watch-positions.mjs`
now always write their render.mjs report object to a gitignored `pipeline/.cache/last-report/<kind>.json`
(`writeLastReport`, `pipeline/lib/cli.mjs`) — the exact structured data the markdown table is rendered
from, so an agent reading the pipeline no longer has to re-parse a ~480-line stdout dump. Shipped with
`--quiet` as the opt-in flag, then revised same-day after review: a flag an agent can forget to pass
doesn't force the habit of actually reading the dump, so the default is flipped — quiet-and-dump-only is
now what a bare run does, and `--verbose` opts INTO the markdown table (the "paste this to Ben" case,
which `/scan` §1 and `/positions` §1's canonical invocations now pass explicitly). **AC-0:** Finding 3
(from the same session's live pricing work) had no written home — "reached N/14" off
`read-window-range.mjs --ask/--bid` counts days where the hourly bucket AVERAGE crossed a level, which is
stricter than what a resting order needs; Soul rune's own ~20+ closed lots fill routinely at 397-399
despite a "reached 1/14, recent 0/3" read. A guard paragraph in `docs/MARKET-ANALYSIS.md` §4 (judge by
liquidity — distrust only near the historical extreme on a deep book, stay near center on a thin one —
never by the raw count alone) plus a pointer from `/scan`'s RC1 bullet stop the next session re-rejecting
a normal above-average ask. Placeholder until AC4a's percentile-placement read replaces it.

### Two pricing-optimism findings encoded from real fills (2026-07-17, `js/quotecore.js`+`js/estimators.mjs`+`docs/MARKET-ANALYSIS.md`+`/scan` skill — NO APP_VERSION)
Two facts kept getting re-derived session after session because nothing durable recorded them.
(1) **Quick can be the wrong way round vs a true instant cross.** `quickBuy`/`quickSell` (`js/quotecore.js`
`computeQuote`) are built from the wiki `/latest` endpoint's recent AVERAGED low/high, not the literal
top-of-book price at the moment of a click. Ben ran five real 1-unit instant buy→sell round trips
(RuneLite, logged in fills.json/positions.json) and compared them against `Quick`'s own quoted net;
four of five were clean comparisons (blood rune was mid-move) and all four showed the model's legs
reversed relative to the real fill order, with the true round-trip loss running 3–5× worse than
Quick's quoted net (n=4, same-day — not a calibrated multiplier). Full writeup: the header comment
above `computeQuote` in `js/quotecore.js`; one-line pointer in `docs/MARKET-ANALYSIS.md` §1.
(2) **The reach-relief "small clip clears at a better price" premium collapses as tranche size grows
relative to daily volume.** Cross-referencing real closed lots (positions.json vs fills.json) across
Soul rune, Blood rune, Prayer potion(4), Super restore(4), Ruby dragon bolts (e), and Raw anglerfish
found a rough knee: clean fills below ~0.5% of daily volume, visible degradation by ~0.7–1%
(Prayer potion(4), Super restore(4)), and the premium fully gone by ~5–7% (Raw anglerfish's
9,890-unit tranche sold at a net loss after tax despite nominally selling above the buy price — its
own 15,000-unit buy limit is ~10.4% of its daily volume, structurally oversized for its own liquidity
depth). This is the real-data explanation for why `--pressure-exit` (`js/estimators.mjs`
`estimatePair`) was found too optimistic this session (Water orb) and stays opt-in/`--publish`-refused.
Full writeup + numbers: the `/scan` SKILL.md "Asymmetric ask-reach read" bullet (v1.63); one-line
pointer in `js/estimators.mjs`'s `reachRelief` header. Both findings are prose-only, small-n
(n=4 / n≈6), explicitly not folded into any threshold or gate — evidence to score against, not a
calibration.

### watch-positions.mjs cadence tiers re-scaled 1/2/3 → 3/5/15 (2026-07-16, `pipeline/commands/watch-positions.mjs`+`pipeline/MONITORING.md`+`/positions` skill — NO APP_VERSION)
Ben's call: the old TIGHT/MED/LOOSE tiers (1m/2m/3m) were all "hair-trigger" by GE fill-time
standards — even the loosest tier matched what should be the tight one. Re-scaled so `CADENCE_TIGHT`
(actively managing a live situation — falling/thin-big-ticket-volatile) = 3m, `CADENCE_MED` (ranging
scalp / thin / unconfirmed regime) = 5m, `CADENCE_LOOSE` (stable liquid, narrow band — the ordinary
glance case) = 15m. Reconciled the matching table + example command in `pipeline/MONITORING.md` and
the two "not the old hair-trigger cadence" cross-references (`MONITORING.md`, `/positions` skill).


### Incidental-inventory filter is code-enforced, both surfaces (2026-07-16, `pipeline/commands/watch-positions.mjs`+`pipeline/commands/quote-items.mjs`+`/positions` skill — NO APP_VERSION)
Same failure shape as the sync-enforcement and held-item-exception fixes earlier this session: the
`/positions` skill's incidental-inventory rule ("a stray loot lot never earns a verdict") was prose
an agent had to apply manually every pass, and it wasn't — three ×1 rune-drop loot lots (Steam
rune, Sunfire rune, Aether rune) kept re-earning full CUT-CANDIDATE/UNDERWATER headline alerts every
single watch pass because nothing in the pipeline actually checked lot value. Fixed: both
`watch-positions.mjs` and `quote-items.mjs --positions` now filter any lot whose total value
(`qty × avgCost`) is under `NOISE_OFFER_GP` (100,000 gp — the same constant already governing tiny
offer noise) unless the item is on the watchlist, BEFORE it reaches the table/verdict loop at all —
no row, no alert. Collapsed into one `incidental inventory, ignored: X, Y` line instead. Watchlist
membership remains the exemption regardless of value.

### Tabs are real URL paths; scan analysis survives a re-publish (0.65.3, `js/main.js`+`pipeline/commands/screen-flip-niches.mjs`)
Two fixes from live use of the same-day Scan-tab work. (1) **Tab routing**: `switchTab` now writes
`#<tab>` to the URL hash on every genuine navigation (a tab click, or a programmatic jump like
"buy" → Ledger or an item name → Trends), and the app restores the tab from the hash on load/
`hashchange`. Ben's ask: "Refresh scan → should take us back to the Scan tab with the new info, not
the Finder tab" — before this, "Refresh scan"'s `location.reload()` always landed back on Finder
(the HTML-default panel), since nothing recorded which tab you'd been on. (2) **Analysis
persistence**: `screen-flip-niches.mjs --publish` was building its payload as a fresh object literal
every run, silently WIPING any `analysis` blurb set via `set-scan-analysis.mjs` on the very next
scan (including the recurring `/scan` loop's routine re-publishes, seconds later) — now reads the
existing `screen.json`'s `analysis` field first and carries it forward unless a fresh one overwrites
it. Caught because Ben set an analysis, then a routine `/scan` loop pass republished and erased it
before he'd even seen it on the page.


### Scan tab: PLAN-VIZ-LAYER's Stage-2 HTML seam built, collapsed niches, analysis blurb, real refresh, blurb moved to bottom (0.65.3, `pipeline/lib/render.mjs`+`pipeline/commands/screen-flip-niches.mjs`+`index.html`+`js/ui.js`+`styles.css`+`pipeline/commands/set-scan-analysis.mjs` new)
Several Scan-tab requests in one pass, the biggest being the Stage-2 seam PLAN-VIZ-LAYER explicitly
deferred (R6/the honesty note "nothing Stage-2 is built") — now built: **`render.mjs` gained
`renderHtmlTable(headers, rows)`**, a pipeline-side twin of `js/ui.js`'s client-side `scanTableHtml`/
`scanPressureCell` (same T1 cell shape, same markup, imports `gradeCls`/`fmtP` from
`js/money-format.js` for byte-parity). `screen-flip-niches.mjs --publish` now writes a `html` field
into `screen.json` (one pre-rendered string per niche + watchlist) as an ADDITIVE sibling to the
existing `cells` data (never a replacement — an older app build ignoring `html` still works).
`js/ui.js`'s `renderScan` now prefers `scan.html[niche]` when present, falling back to client-side
`scanTableHtml` for a screen.json published before this field existed — the fallback must stay
visually identical to the pipeline path, not a second design. An earlier same-session console
box-drawing table prototype (`pipeline/lib/cli.mjs` `consoleTable`/`consoleCards`) was explicitly
ruled OUT as a dead end for this — the app is the only target surface, never a bare terminal; those
two prototype exports remain in cli.mjs, unused, pending a decision on whether to remove them.

Also: (1) the explanatory `.scanintro` blurb moved from the top of the panel to the bottom. (2) Each
niche (Band/Churn) now renders inside a `<details>`/`<summary>` and starts COLLAPSED — the page opens
compact, click a niche's header to expand just that table (Watchlist stays a plain always-open
section — the small always-shown exception, not a collapsible niche). (3) "Refresh scan" now does a
full `location.reload()` once the local dev-server's `/api/scan` run succeeds, instead of only
re-rendering the scan panel's DOM in place. (4) A new `#scanAnalysis` mount point at the TOP of the
panel renders an optional `screen.json.analysis` HTML string — a short judgment blurb separate from
the raw tables, hidden when absent. Populated via a new small command,
`pipeline/commands/set-scan-analysis.mjs "<html>"` (or `--clear`) — a zero-refetch patch of just that
one field, since the analysis is the judgment PASS OVER an already-published scan (the `/scan`
skill's §2), not part of the scan's own deterministic output; written manually by the session doing
the read, never auto-generated.

### screen-flip-niches.mjs publishes by default now — was opt-in behind --publish (2026-07-16, `pipeline/commands/screen-flip-niches.mjs`+`/scan` skill — NO APP_VERSION)
Ben noticed his local Scan tab was 2 days stale and asked why, given this session had been running
`/scan` repeatedly — root cause: `--publish` (the flag that writes repo-root `screen.json`, what the
app actually reads) was opt-in, and every `/scan` read this whole session correctly ran WITHOUT it
per the then-current skill doctrine, so nothing had refreshed the file since the last manual publish.
Fixed by flipping the default: `screen-flip-niches.mjs` now writes `screen.json` on every run unless
`--no-publish` is passed. **Publishing here is the local file write only — it is NOT a git commit**;
committing/pushing `screen.json` to `main` remains a separate, deliberate step (the once-a-day
`/overnight` `sync-fills.mjs --publish` is the only thing that does that, and is unrelated to this
flag). The `--asym`/`--pressure-exit` F1-gates (screen.json must stay on the neutral estimator) now
degrade gracefully under the new default — running either just silently skips the write that pass
instead of erroring; an EXPLICIT `--publish --asym`/`--publish --pressure-exit` combo still hard-
refuses, since that's a real conflict, not an accidental default.

### PLAN-VIZ-LAYER VZ3-VZ6 landed — quote-items.mjs + screen-flip-niches.mjs onto the render layer, skill relay rules, docs sweep (2026-07-16, `pipeline/lib/render.mjs`+`pipeline/commands/quote-items.mjs`+`pipeline/commands/screen-flip-niches.mjs`+4 skills — NO APP_VERSION)
Completes the visualization-layer initiative's Stage-1 scope (`PLAN-VIZ-LAYER.md`). **VZ3**:
`quote-items.mjs` (both per-item and `--positions` modes) now builds one report object printed via
`renderReport`; the flat prose `lines[]` became typed note items, with the per-kind sigil moved into
render.mjs's `NOTE_KINDS` registry. **VZ4a/VZ4b**: `screen-flip-niches.mjs`'s per-niche tables,
footer notes, AND the loose info sections (diurnal timing, overnight-accumulation, entry-paths, etc.)
now render through one `renderReport` call per niche instead of ad-hoc console.log calls scattered
across the function; the `--publish` `screen.json` payload (schema 2) is untouched. **VZ5**: the
render layer's tier registry (core/context/shadow, R10) is documented in `render.mjs`'s header as the
ONE source; all four skills (`/scan`, `/positions`, `/overnight`, `/morning`) gained the two relay
rules — never fence a script's table, and relay both `core` and `context` tiers by default (no
speculative trimming). **VZ6**: docs reconciliation sweep (README inventory, MARKET-ANALYSIS.md
pointer, superseded-phrase grep). All chunks byte-identity-verified against golden fixtures
(`pipeline/test/render.test.mjs`, now 18 checks) plus live smoke runs; no gate/verdict/break-even/
grade number changed anywhere (R5 held). Screen's footer notes (caution/trajectory/headroom/etc.)
stayed pre-formatted strings rather than fully typed kinds — several carry mid-string variables so
the sigil isn't a pure prefix; flagged as a possible follow-up, not done here.

### PLAN-VIZ-LAYER VZ1+VZ2b landed, VZ2a's headline/table mismatch fixed (2026-07-16, `pipeline/lib/render.mjs` new, `watch-positions.mjs`+`pipeline/lib/cli.mjs` — NO APP_VERSION)
First landed chunk of the visualization-layer initiative (see `PLAN-VIZ-LAYER.md`). **VZ1**: a new
`pipeline/lib/render.mjs` peer render layer — `watch-positions.mjs`'s entire output pass now builds
one plain report object (`buildWatchReport`) and prints it once via `renderReport`, delegating to the
existing formatters (`mdTable` etc.) rather than hand-building console output inline; byte-identical
to the prior output (fixture-pinned in new `pipeline/test/render.test.mjs`). **VZ2b**: the watch
table's Quick/Optimistic cells adopt the canonical `js/quotecore.js` `quoteCells` composite
(buy → sell · net (roi)) — a deliberate visible change (owner-approved: visual format may adapt).
**VZ2a (the actual anchor bug)**: `heldAlert()`'s structural-break headline used to hardcode its
verdict word to `CUT` regardless of what the table's persistence-gated verdict said — this is
exactly the mismatch watched live and repeatedly this session (Water orb: headline "CUT — structural
break", table "PARKED"/"HOLD"). Root cause (confirmed via a live fixture): `convictionGate` (raw price
vs. support/cut-trigger, in `watchstate.mjs`) and `heldDisplay`/`momVerdict` (the full persistence-
gated judgment) are two INDEPENDENT state machines that can legitimately disagree — not one signal
rendered two ways. Ben's ruling (2026-07-16): `heldDisplay` stays authoritative for the verdict word;
a structural support break still surfaces, but as an appended warning clause ("⚠ also broke
structural support...; verdict unchanged, watch closely"), never as a contradicting verdict override.
Landed directly (small, well-scoped fix, not deferred to a follow-up plan chunk). VZ3 (quote-items),
VZ4a/b (screen-flip-niches), VZ5 (surfacing-tier registry + skill relay rules), VZ6 (docs sweep)
remain queued in `PLAN-VIZ-LAYER.md`.

### Sync-before-every-read is code-enforced, not just doctrine (2026-07-16, `watch-positions.mjs`+`quote-items.mjs`+`screen-flip-niches.mjs` — NO APP_VERSION)
Same failure shape as the held-item exception below: "run sync-fills.mjs before every positions/scan
read" was prose doctrine (CLAUDE.md, both skills, a Claude memory entry) that an agent — this one —
kept skipping anyway, because nothing made it happen. Anchor incident: a real Raw anglerfish position
(bought 2026-07-15 22:46, sold 2026-07-16 12:09, closed at a -98,900 loss) was declared "just a
reconstruction bug, not a real position" mid-session because the book hadn't been re-synced before
that call was made — the position was real, the book was stale, and the doctrine alone didn't catch
it. Fixed by making the sync unconditional in code: `watch-positions.mjs`'s sync (previously gated
behind an opt-in `--sync` flag, with a now-stale comment claiming it pushes to `main` on every
filled pass — false since the 2026-07-15 local/zero-git default) now always runs; `quote-items.mjs
--positions` and `screen-flip-niches.mjs` gained the same unconditional sync-first call, matching
the pattern (local/zero-git `execFileSync` of `sync-fills.mjs`, never blocks the read on failure,
quiet one-line summary). All three verified live post-change.

### Held-item exception is code-enforced, both halves (2026-07-16, `pipeline/lib/gatecandidates.mjs`+`screen-flip-niches.mjs` — NO APP_VERSION)
A `/scan` judgment-filter validation pass found the skill's own prose rule — "items Ben holds ...
always show, with price-to-clear" — had zero code behind it, confirmed by grep twice: neither the
falling-exclusion nor the 500k gp/day attention floor actually exempted a held item, they just
happened to still pass today because neither held item's regime/liquidity had crossed the line yet.
Fixed both: `surviveMode()` gains a `held` opt that bypasses ONLY the falling-exclusion drop
(scoped to the stated exception, not `notFalling`/posture), flagging `heldFallingOverride` so the
screen prints an explicit note rather than a silent appearance; `gateCandidates()` gains a
`heldIds` param exempting a held item from `MIN_GPD` the same way the thin-gp-flow path already
does, paired with an unbounded held reserve in `rankAndSlice()` (mirrors the existing thin/rising
reserves) so a held item can't still vanish at the top-N fetch cutoff. Caught a real bug live-testing
this — a module-scoping mistake (`heldIds` local to `main()`, unreachable from `renderMode()`) —
fixed before shipping. `gatecandidates.test.mjs` 22→29 fixtures; `survivemode.test.mjs`'s 16
exact-shape assertions updated for the new `heldFallingOverride` field. Full detail:
`PLAN-COPILOT-IDEAS.md` chunk 3.

### Margin-reduction budget on held-lot reprices — PB-COPILOT-1 (2026-07-16, `pipeline/lib/watchstate.mjs`+`emit.mjs`+`watch-positions.mjs` — NO APP_VERSION)
Ported from a research read of Flipping Copilot / FlipSmart's open-source RuneLite plugin code
(both are thin clients over proprietary backends, so their ranking/pricing algorithms aren't
inspectable — but their client-side offer machinery is). FlipSmart's `ActiveOfferAdvisorService`
tracks a cumulative give-back budget across a resting offer's repricings so a chase can't silently
surrender its whole edge one small step at a time with no single step looking alarming. `advanceState()`
now persists `initialAsk`/`lastAsk`/`consecutiveAskDecreases`/`cumulativeReductionPct` per held lot
(reset on the same identity-change/stale-gap policy as the rest of the module; an ask INCREASE never
counts against the budget); `marginBudgetNote()` fires an inform-only line once the give-back crosses
5% (placeholder) or 3 straight step-downs (placeholder), rendered via a new optional `heldNoteBlock`
field. Anchor: the same session's anglerfish position got stepped 2,579→2,489 over ~25 minutes chasing
a live breakdown with no memory of the cumulative give-back. Restart-blindness FILL recovery (the
plugins' other technique) was scoped down to a documented hard limitation rather than half-built —
see `PLAN-COPILOT-IDEAS.md`. Honesty: both thresholds are placeholders (n≈0), ported from FlipSmart's
own hardcoded constants, not derived from our retro data.

### Pressure band width is recency-gated — PB5 (2026-07-15, `js/windowread.mjs` — APP_VERSION 0.65.1)
The first live default-on trial of the pressure model (four deliberate pressure-floor bids left to ride)
surfaced Ben's theory: the model's proposed floors don't map to items that **changed regime inside the
measurement window**. Root cause — `reachableBand` anchored its band *center* to the recent nights
(`recentQuant`) but sized the band *width* (day-low/high IQR) over the **full** window, so a dip-and-recover
(Ranarr: 5,555 was a one-off dip, not a cycled level) or a reprice-up (anglerfish, rising +10%, its floor
anchored to pre-spike lows it had climbed away from) still widened the IQR and pushed the deep bid below
where the item currently trades. The `⚠stale` flag was already warning about exactly this — the model just
wasn't feeding recency into the *width*. **Fix:** the width now measures over the recent `PRESSURE_BAND_RECENT_N`
(=7) nights — wider than the 3-night center because a median is stable at n=3 but an IQR is not (a 3-night IQR
collapses to ~0 on flat recent nights and would kill the sell-heavy deep-bid, so recent-3 was rejected);
falls back to the full window when the recent slice is too thin. Live-verified: anglerfish's deep bid moved
2,251→2,432 (up to the recent floor), Ranarr 5,555→5,609, Soul rune (genuinely stable) unchanged — the
regime-changed floors pull back toward the live cycle while the stable churner is untouched. Still
inform-only/trial (the retro co-log keeps accruing the NEUTRAL estimate); n≈0 on fills. Full design +
per-chunk detail: `PLAN-DEPTH-EXIT.md` PB5.

### `docs/ARCHITECTURE.md` + the `archlint` doc-reference guard (2026-07-14, docs+pipeline — NO APP_VERSION)
The audit's core finding was that fragmentation persists because no single home states what the system IS
or why. `docs/ARCHITECTURE.md` is that home — the general-rules layer, deliberately split into **🔒 ENFORCED**
invariants (E1–E9, each naming the CI guard that fails on violation) vs **⚖️ JUDGMENT** principles (labelled
not-machine-enforced). The enforced/judgment split is the answer to "how does the doc stay in sync": a
mechanical claim is either guarded or marked *(proposed)*. The immediate dogfood: **`pipeline/archlint.mjs`**
(E7) — every code-font FILE token the doc names must resolve on disk (path from root or bare basename against
the source dirs; `PLAN-*.md` exempt, future files in a `PROPOSED` set), so a rename/delete can't silently
orphan a reference — most valuable through the coming directory rename. Wired into `checks.yml`; pinned by
`archlint.test.mjs`. Content is principle-level (one-home rule, the app-imported blast-radius model / N3,
ROOT-LOCKED artifacts, RC-A/B/C anti-patterns + their guards); the pipeline-order flow walkthrough is a
deferred companion (`docs/FLOW.md`, after the rename settles names).

### Vestigial-code cleanup + the RC-A dead-export guard (2026-07-14, APP_VERSION 0.64.1)
The architecture re-audit (`PLAN-ARCH-DOCS-AUDIT.md` Parts 4–5) found the repo's recurring drift is
vestigial "kept-for-future / until-torn-out" code, so the fix is a GUARD for the whole class, not a
symptom-by-symptom patch (Ben's steer). Shipped:
- **`pipeline/dead-export-check.mjs` (RC-A guard)** — the inverse of import-check: fails CI if any `js/`/
  `pipeline/` export has no non-test consumer. Fable validated the dispositions (`PLAN-CLEANUP-VALIDATION.md`);
  it immediately caught `maxBuyForExit` shipped unwired last session. Legit test-only / provisional exports
  declare intent inline (`// @test-only:` / `// @provisional-api:`). Its own occurrence-counter had a
  false-positive bug (a naive comment-stripper dropped `STAGES` from a `${…}` template) — fixed with a
  character-scanner (strings/templates/regexes preserved) and pinned by `dead-export-check.test.mjs`. Wired
  into `checks.yml`.
- **Removed 6 confirmed remnants:** `selectNominations` (its manual↔auto name-dedup was PORTED into the live
  `reconcileDipPool`, closing a latent duplicate gap), `briefBook`, `supportLevels`, `buysForItem`, the dead
  `STATUS` enum, and `DL4_MAX_NOMINATIONS_PER_SCAN` (pre-reconcile append-model leftovers).
- **N1 — deleted the vestigial rising/spread scaffolding** (`pool.risingFloor` on every spec + its
  validation, `risingPoolFloor`, `RISE_MID_FLOOR`/`RISE_LIQUID_VOL`, the dead `mode==='rising'` branch).
- **N2 — `surviveMode` now reads `spec.confirm`** instead of hardcoding `mode==='scalp'` (the declarative
  intent P4c claimed; the dead `rising` branch was kept alive ONLY by its test — the RC-A pattern exactly).
- **`alertCount` wired into `js/watch.js`** (it duplicated the expression inline against its own header's
  "the ONE count — never diverge" rule → the APP_VERSION bump). `maxBuyForExit` marked `@provisional-api`
  with its proper back-solve consumer (a `windowrange --exit` CLI) tracked as a fast-follow.
All 62 test suites + import-check + dead-export + doclint green; behavior byte-identical (replay goldens hold).

### WINDOW-CLEAR: days-reach ≠ within-window clear (2026-07-14, PLAN-WINDOW-CLEAR A+B, pipeline/skills-only — NO APP_VERSION)
A churn/scalp lap is a WITHIN-WINDOW round trip, but every reach number we surface answers "did this
level print on N of M DAYS" — not "does it print WHEN I'm selling (in the target window), and does the
window absorb my size". A level can reach 12/14 days yet only print in a 2h spike that's already behind
you today (the Hydra trap). **Part A (skills):** graduated the `peak-timing-default-for-pricing` memory
into a canonical WINDOW-CLEAR PRICING step in `/scan` (name the exit window → quote the reachable-IN-WINDOW
ask → BACK-SOLVE the buy so BE+margin ≤ that exit → project whether today's window is ahead/printed);
`/positions` sell-velocity points at it; the diurnal/asym-reach sections retag as its inputs; memory
retired to a pointer (fold-not-copy, doclint-clean). **Part B (code):** `js/windowread.mjs`
`windowClear`/`windowClearDiverges` — the within-window reach + absorption pool + `clearRatio` off the
SAME in-hand 1h series (zero new fetch); `js/quotecore.js` `maxBuyForExit` — the tax-EXACT inverse of
`breakEven` (largest buy with `breakEven(buy)+margin ≤ sell`, piecewise+bond, brute-verified). `screen.mjs`
(churn/scalp) + `quote.mjs` fire an inform-only `ℹ window-clear` note when the ask reaches on DAYS but
rarely IN its peak window (live: Anglerfish 6/14-in-window vs 9/14 all-day) — never a gate/drop/grade/
`screen.json`/verdict input; a lean `winClear` rides `suggestions.jsonl` for F1. The note is gated to the
window-REACH leg; the `sizeShort`/`clearRatio` size leg is shadow-only (a narrow peak window mis-reads
size on a continuously-clearing churn lap — deferred to F1). New pure exports, node-only consumers,
`screen.json` byte-identical → NO APP_VERSION. Pinned by windowread.test/quotecore.test fixtures.

### Capital-aware expGpDay — the band/churn attention floor + fetch-rank now respect your bankroll (2026-07-14, PLAN-CAPITAL-THROUGHPUT, pipeline-only — NO APP_VERSION)
**Ben's ask:** "there's no way I'm cycling 90k anglerfish — for this price, how many can I realistically
capture over the next day × profit." The discovery throughput `expGpDay` (the `MIN_GPD` attention floor +
the fetch-pool order) was **capital-blind** — `expUnits = min(limit×6, 0.10×volDay)` measures MARKET
capacity, so a cheap-but-your-full-limit-position-exceeds-your-bankroll lane over-reported throughput.
Now `expUnits(limit, volDay, capPerWindow)` caps the PER-WINDOW buy by what the derived `deployablePool`
(`lib/cashderive.mjs`) affords one tranche of: `min(limit, pool/mid) × 6`. The cap enters INSIDE the ×6
(per-window) NOT as a whole-day cap, because churn RECYCLES intra-day — the binding question is "can I
afford ONE buy-limit tranche?" (a whole-day `turns=1` cap wrongly hid fast churn — anglerfish/sanfew — in
the first cut; per-window fixes it). **SELF-TARGETING:** byte-identical when one tranche is affordable
(cheap/liquid churn — anglerfish, soul rune, chins — never hidden), binds ONLY where even one tranche >
the pool (expensive/big positions; the thin big-tickets it bites are floor-EXEMPT, so it makes their rank
NUMBER honest without gating them). `screen.mjs --throughput capital|legacy` (default capital); a null/≤0
pool degrades to legacy. `expGpDay`/`expGpDayLegacy` log as a shadow pair on `suggestions.jsonl` for the
F1 old-vs-new diff. **At a 77m pool it is a NO-OP on surfacing** (nothing crossed the 500k floor — only
Osmumten's fang's rank number moved), so `MIN_GPD` stays 500k; it's a correct latent guard that activates
at smaller capital / larger positions. Node-only (the app Finder passes no capital; `screen.json` publishes
only `{id, cells}`) → replay goldens + `screen.json` byte-identical → **no APP_VERSION**. Pure gate stays
fixture-drivable (null cap = legacy branch); pinned by the `gatecandidates.test.mjs` SLACK/BIND/legacy
fixture. Architecture-reviewed PASS. The ÷slots variant was dropped (concurrency is owned by the
positions-side opportunity-cost read, PLAN-CAPITAL-OPCOST).

### VN-3 — PARKED-at-break-even dead-band + coarse path weights (2026-07-11, PLAN-VERDICT-NOISE F2+F4, pipeline-only — NO APP_VERSION)
**RC1 (the remaining flap after VN-1).** HOLD and UNDERWATER both deliberately rank severity 0 in the
VN-1 persistence layer (so the mv-null token set stayed byte-identical), which left the BE-parked
coin-flip — "is live above break-even?" re-answered per print on a lot whose BE sits INSIDE the 5m
noise band (Berserker BE 3.15m, live 3.10–3.17m) — flipping the label every pass. **F2:** on a clean
(mv-null, non-falling) read with live inside a dead-band of BE — HALF the current 2h raw band width,
floored at ±0.5% of BE (`BE_DEADBAND_BAND_FRAC`/`BE_DEADBAND_MIN_PCT`, both PLACEHOLDERS, n=1) — the
display names the situation: `PARKED — at break-even (±X) — list ≥ <BE>`, one stable state instead of
the alternation, and watch.mjs suppresses the ungated UNDERWATER headline inside the band (the
falling-regime alert is unchanged — PARKED requires a non-falling row; an escalated verdict or an
out-of-band print exits the state). Display-only: the raw HOLD/UNDERWATER token still flips
underneath and stays what the ledger logs. **F4 (RC5):** `renderPathLine` viabilities render at ONE
decimal — the placeholder weights step in ±0.12 quanta, and two decimals rendered that as false
precision that read as instability (0.30↔0.42). Pinned by the verdictpersist.test.mjs FIXTURE-1
Berserker sequence (one rendered state across 12 passes, raw flipping underneath).

### VN-2 — thesis-aware exit frame (2026-07-11, PLAN-VERDICT-NOISE F3, pipeline-only — NO APP_VERSION)
**RC7, the frame mismatch (Ben's key point).** The churn session's positions were entered on the
DIURNAL thesis (buy the dip window, sell the peak window), but `momVerdict` judges every hold with a
band-flip frame — so the expected pre-peak trough kept flagging LIST-TO-CLEAR/CUT, and the band-top
"clear" (43.60m Masori) sat BELOW the peak target the lot was entered to capture (44.22m): the noise
frame was actively losing money vs the plan. **What shipped:** (1) `hold-thesis.json` grows an
additive `window` field ("h-h" local exit window) and `thesis.mjs set … --path` now writes the FULL
declared plan — numeric `--tripwire` (parseGp), new `--exit <gp>`, `--window` — preserving existing
values when omitted. (2) `convictionGate` 1b (TG1) now ALSO thesis-silences **LIST-TO-CLEAR** above
the declared tripwire (supersedes the original exclusion — on a declared hold the band-top clear IS
the expected dip; below the tripwire the V7 escalation resumes; the Gate-2 CUT exemption untouched,
checked first). (3) The shared display layer renders a declared lot above its tripwire as
`HOLD — per thesis (<path>): exit <declared exitPrice | diurnal ASK (watch.mjs, off the in-hand 1h
series, zero extra fetch) | "exit per plan"> @ <window>h local · abort < <tripwire>`, with the raw
band-flip read demoted to the note — fixing the band-top-below-peak exit mis-pricing. Undeclared
lots are byte-identical (VN-1 stays the floor). `momVerdict`/`js/quotecore.js`/`js/paths.mjs`
untouched. Pinned by the verdictpersist.test.mjs thesis-frame fixtures + the amended
watchstate.test.mjs TG1 cases.

### VN-1 — persistence-gated DISPLAYED verdict (2026-07-11, PLAN-VERDICT-NOISE F1, pipeline-only — NO APP_VERSION)
**The incident (n=1 session).** A Berserker ring lot parked ON break-even, re-read every 3 min, swung
`HOLD → UNDERWATER → NO-READ → CUT → CUT-CANDIDATE → HOLD → LIST-TO-CLEAR → …` (~12 label flips in 30
min on a ~2% band), and one render could print `⚠ LIST-TO-CLEAR` in the table while the note below
called the same read "a flicker at this cadence" (RC4: the alert layer was debounced since V4/V7, the
LABEL never was). **What shipped:** `verdictPersistence()` (`lib/watchstate.mjs`, mirrors
`pathPersistence`) + the shared `heldDisplay`/`rawHeldToken` display layer (`lib/context.mjs`) — the
RENDERED label on watch.mjs + `quote.mjs --positions` is now severity-ranked arm-then-confirm
(CUT=3, CUT-CANDIDATE/LIST-TO-CLEAR=2 escalations must hold `VERDICT_PERSIST_MS`, a PLACEHOLDER =
`ALERT_PERSIST_MS`; calmer-or-equal adopts immediately so de-escalation never lingers). The **Gate-2
breakdown CUT bypasses the timer at both layers** (the bludgeon invariant, structurally preserved);
a **NO-READ against an established incumbent** demotes to a `(read unreliable this pass)` note (RC3)
and no longer headlines. The raw `momVerdict` is UNTOUCHED — it stays what `suggestions.jsonl` logs
(the replay/calibration basis); HOLD/UNDERWATER/FALLING rank severity 0 so the mv-null token set
renders byte-identically (the HOLD↔UNDERWATER flip is VN-3's PARKED dead-band, deliberately
separate). App surfaces keep the instantaneous verdict; quote degrades honestly when no watch loop
has been writing state. Pinned by `pipeline/verdictpersist.test.mjs`.

### Ask-headroom signal — surface the profit above the quoted ask (2026-07-11, PLAN Bar-E-signal, pipeline-only — NO APP_VERSION)
**The incident (n=1).** A held Soul rune lot (25k, break-even 389) was verdicted `HOLD — list high @ 393
(2h breakup — patient on the sell)` and then SOLD at 397 — only because the GE better-price rule fills a
393 list against higher standing bids. At 4gp of net/u on an 8gp true edge, the suggested NUMBER pointed at
HALF the profit (~100k vs ~200k). The tool had no way to say "real demand prints above the number I quoted
— ladder up." A Fable subagent designed the fix and **corrected the diagnosis**: under a breakup
`quickSell > rawBandHi`, so `optSell = max(quickSell, bandHi) = quickSell` — the 393 was the **live
instabuy**, not a p90-shaved edge; the 397 was standing-bid depth `/latest` structurally can't show. So
there are TWO upside classes, and both are covered.

**What shipped (Option C — signal now, clamp-widen deferred to F1).** `computeQuote` emits an additive,
inform-only `row.askHeadroom = {gap, gapPct, rawTop, topBucketVol, netLever, trusted} | null`:
- **Class 1 (shave gap):** fires when `rawBandHi > optSell` (structurally a DENSE side, not a breakup) —
  the robust p90 discarded a TRADED in-band top. This is the gap Momentum **cannot** show (`mom` is 'clean'
  because the live print sits inside the raw band). It is the first live consumer of the `rawBandLo/rawBandHi`
  "retained for audit" fields.
- **Class 2 (breakup — the actual incident):** `optSell == quickSell`, no in-band evidence above — the
  upside IS the existing `mom='breakup'` tell, re-voiced as ladder guidance at the render layer, no new number.

**Inform-only, everywhere.** It NEVER moves a quoted number, gates, drops, reprices, or grades — the robust
band still sets every price, so Bar E's thin-flier protection and the value-niche q15/q85 twin
(`valueAmplitudeValidator`) are UNCHANGED. Trust = the raw-top 5m BUCKET's own `highPriceVolume` (direct
evidence the top price traded size — sharper than counting buckets or item `volDay`), fallback item `volDay`;
an untrusted gap is logged for audit but not surfaced. Rendered as `⤴ ask headroom` on `quote.mjs` (read +
`--positions` held sibling line, following the `renderPathLine` pattern so `momVerdict`/`renderHeldVerdict`
stay byte-identical) and `screen.mjs` (sibling of the `ℹ trajectory/reach` note, stdout-only, NOT in
`screen.json`). A lean `askHeadroom` field rides `suggestions.jsonl`; **`analyze.mjs` §5** (`askHeadroomAudit`)
joins it to `fills.json` and surfaces the n-gated Option-B graduation candidate to F1.

**Honesty (rule 4).** n=1 — the market claim ("dense-churn raw tops are reachable demand") is a HYPOTHESIS.
All three constants (`ASK_HEADROOM_MIN_PCT` 0.5%, `RAWTOP_TRUST_BUCKET_VOL` 50, `ASK_HEADROOM_VOL_FLOOR`
2000) are PLACEHOLDERS pending F1 retro calibration; the p97/raw clamp-widen is a pre-registered F1
graduation (which WOULD bump `APP_VERSION` + regen the replay goldens), not shipped. `robustBand`/`mom`/
`optSell`/`momVerdict` byte-identical; no app code reads the new field → no `APP_VERSION` bump (the
`flushSignal`/`nominateDip` node-only-consumer precedent). Pinned by four new `quotecore.test.mjs` fixtures
(trusted / untrusted-flier-still-protected / sparse-silent / breakup-is-Class-2) + an `analyze.test.mjs`
audit fixture; all 59 suites + doclint green.

### screen.mjs survivor fetch — bounded worker pool (2026-07-11, pipeline-only — NO APP_VERSION)
The cold-scan cost was one sequential loop: ~50+ survivors × 3 serialized timeseries round-trips
(5m/6h/1h) each followed by a `sleep(30)`. Replaced with a bounded worker pool (`FETCH_CONCURRENCY = 5`
items at once; each item's three independent endpoints fetched via `Promise.all`) — the pool bound is
now the API-politeness throttle, so the per-fetch sleeps in that loop are gone. Byte-identical results
(same fetches, same id-keyed Map writes, same `computeQuote` inputs; replay goldens pin it) — only the
fetch scheduling changed. `fetchTsCached`'s per-(id,step) disk cache is untouched, so warm re-runs stay
fast; structurally a cold `--mode all` scan drops from ~160 serialized round-trips + ~5s of sleeps to
~⌈53/5⌉ pool waves of parallel triples.

### Chart axis/tooltip resolution — fmtSig 4-sig-fig labels (0.62.0)
The Trends charts rendered y-axis labels and hover tooltips with the app's `fmt()`, which collapses the
k-range to a single decimal (`7834 → "7.8k"`). On a narrow-band item like snapdragon (~7.8k↔8.0k) that
maps consecutive, visibly-different prints onto the SAME label — a rising or falling series looks flat, and
the resolution the chart exists to show is hidden. Fix: a new **`fmtSig(n, sig=4)`** in `js/format.js` shows
a FIXED number of significant figures (default 4, Ben's ask) with a compact k/m/b suffix but the decimals
**retained, not stripped** — so `7834/7850/8000` render `7.834k / 7.850k / 8.000k`, distinct. `chartlib.js`
now defaults its y label/tooltip formatter to `fmtSig` (was `fmt`), and all four Trends charts (recent,
diurnal bars, forecast, price history) drop their explicit `yFmt:fmt` to inherit it — one change covers the
whole Trends page. `fmt()` is unchanged everywhere else (tables, cells). Alternative considered: step-based
precision (only as many digits as the tick spacing needs); 4 sig figs is simpler and honors the stated ask.

### DL4 — the scan auto-nominates dip candidates ("B feeds A", 2026-07-11, pipeline-only — NO APP_VERSION)
A flush is EXOGENOUS — you can't know in advance WHICH liquid item will gap down — so DL2's hand-curated
`dip-watchlist.json` has a coverage gap: an item nobody added can never fire the 5m FLUSH loop. DL4 closes
it by letting the on-demand SCAN feed the reactive loop. `pipeline/screen.mjs --mode all` already fetches
the whole liquid universe's 24h stats + 2h bands (the gate tier) plus the survivors' 5m series; DL4 adds a
zero-fetch **nomination pass** over exactly that in-hand data — NO new fetches (the hard constraint). Pure
**`nominateDip(v24Entry, bandEntry)`** (`js/quotecore.js`) reads flush-SUITABILITY: a two-sided book (the
non-negotiable ghost-spread guard — `sawLow && sawHigh`, else `hpv>0 && lpv>0`) with wide-enough amplitude
(2h band ≥ `DL4_WIDE_BAND_PCT`, else 24h range ≥ `DL4_WIDE_DAY_PCT`), split into a **liquid** track
(`limitVol ≥ DIP_LOOP_LIQUID_FLOOR` — an active FLUSH candidate) or an **illiquid** track (a DL3 standing-
bid candidate); a one-sided or narrow book returns null. A nominee that is also a survivor gets a
zero-fetch **flush-now bonus** (`flushSignal` on its already-fetched 5m series) so a live flush wins the
per-scan cap. Pure **`selectNominations(existing, candidates, cap)`** dedups by id (polymorphic over legacy
plain-string/number entries) and caps at `DL4_MAX_NOMINATIONS_PER_SCAN`. New picks are APPENDED as
`{ id, name, source:'auto', track, addedTs }` objects; the scan prints a `Dip nominations` line for Ben to
curate. The `dip-watchlist.json` schema evolved to these objects and **`watch.mjs`'s `--dip` reader is now
polymorphic** (legacy plain name/id entries still resolve; a mixed array works). SUITABILITY, NOT a live
catch — a nomination is a **PROPOSAL TO WATCH, not a validated pick, not "trade this"**; n=2, every `DL4_*`
constant is a NAMED PLACEHOLDER, F1 owns calibration. Node-only: `screen.mjs` writes, `watch.mjs` reads;
no `js/` app module imports the nomination logic (verified by grep) → NO APP_VERSION bump. Tests:
`pipeline/dl4nominate.test.mjs`. This partly de-risks DL3's discovery half (still n-gated on the log
accruing).

### DL2 — the reactive liquid-flush loop: bid-into-the-fall on a dumping liquid book (2026-07-11, pipeline-only — NO APP_VERSION)
Some dips are off-schedule EXOGENOUS flushes: a holder dumps units into a LIQUID book faster than buyers
absorb them, so price gaps down and stays fillable for a short window before it reverts. These are not the
multi-day faller the regime column tracks (the knife thesis LAGS them) and not diurnal (the forecast is
silent — they're unscheduled), so the `FALLING → SKIP` default misses them. The retro anchor (n=2): today
we MISSED a Searing-page flush — it dumped 4,732 instasell units in ONE 5m bucket and stayed fillable ~45
min, but our ~15-min-stale scan missed the front-loaded volume. The illiquid twin (Abyssal bludgeon,
~83/day, ~16m/unit) was UN-fillable — only 2 units crossed all episode. The lesson: `price×limit` is
DEPLOYABILITY (can you park capital?); FILLABILITY is UNIT-FLOW (`volDay` — will a seller cross down to your
bid?).

DL2 adds a ~5m REACTIVE dip loop for LIQUID lanes only. **`flushSignal(row, ts5m, avgLow24)`** (pure, in
`js/quotecore.js`) fires `flush:true` when ALL hold: (i) liquid (`volDay ≥ DIP_LOOP_LIQUID_FLOOR`, 1000/d),
(ii) deep (live instasell ≥`DIP_LOOP_FLUSH_PCT`=3% below the 24h avg low), (iii) still `falling` (reuses
DP1's `recentDirection` — reverting/flat/null don't fire), (iv) the exit clears (reliable quote, after-tax
net at the bid >0, `optSell` above break-even). It REUSES `recentDirection`/`breakEven`/`netMargin` — no
re-derived direction or tax math. A soft `dipScore = log10(volDay) × deployableGp × afterTaxMargin` ranks
which firing surfaces first (null-limit guarded via a `DIP_LOOP_DEPLOY_VOL_FRAC` volume proxy — Searing had
a null limit). Current-bucket volume is INFORMATIONAL (alert text only), never a firing gate (Ben's
refinement — the front-loaded flush already happened by the time a scan sees it).

`pipeline/watch.mjs --dip` folds the tracked repo-root **`dip-watchlist.json`** pool (item names/ids) into
the buy-side target set and emits a headline `FLUSH — <item> dumping (<depth%> below 24h floor, <N> units
this bucket) · bid-into-the-fall @ <buy> now · list @ <sell> (BE <be>) · window closing — reverts fast.`
(list-at break-even-floored; buy-limit-aware via the shared `limitWindow` — an exhausted 4h window replaces
the bid clause with "buy limit exhausted — frees ~HH:MM"; multiple firings sort by `dipScore` desc). It's a
deliberate carve-out from `FALLING → SKIP` — NOT routed through `classify()`/`targetAction`, which correctly
SKIP a multi-day faller. It ALERTS, never places (the watch.mjs read-only guardrail is untouched).

LOGGING IS DECOUPLED FROM ALERTING (Ben's amendment). The ALERT stays liquid-only, but the flush SIGNAL
(deep + falling; gates ii+iii, minus the liquidity floor i and the liquid-fill-economics exit gate iv) is
logged for EVERY watched item — liquid AND illiquid. An illiquid item never alerts (you can't poll-fill it),
but its flush depth/frequency history is the evidence basis for WHERE to rest a standing bid on it — the
other half of the liquid/illiquid split, and DL3's input. `flushSignal` now returns a `signal` flag beside
`flush`; each firing logs a `dipLoop` record with `alerted` (true = headline FLUSH · false = SIGNAL-ONLY,
logged silently) + `gatedReason` (`liquid-floor` / `exit-not-clear` / null), verdict `FLUSH` vs `FLUSH-SIGNAL`.

HONESTY (rule 4): thresholds are NAMED PLACEHOLDERS, n=2, 5m cadence floor / ~5m latency, reactive-not-a-
predictor. Full `dipLoop` schema: `{ volDay, price, limit, depthPct, bucketVol, quickBuy, optSell,
afterTaxMargin, dipScore, alerted, gatedReason }` (joinable against `fills.json` by itemId+ts). ONE ledger,
ONE writer: it's a lean field on the existing `suggestlog.mjs → suggestions.jsonl`, NOT a separate silo log,
so AZ1's dataset audit auto-covers its health. **`pipeline/analyze.mjs` §4** (`dipLoopAudit`) joins signals
against fills, segments alerted (fillable-vs-not separation) from signal-only (the illiquid distribution,
DL3's input), and SURFACES an n-gated re-fit CANDIDATE that POINTS AT F1 — read-only, evidence-with-n, never
mutates a `DIP_LOOP_*` constant (F1 owns calibration, the PLAN-ANALYZE encoding boundary). NO APP_VERSION:
`flushSignal` is consumed only by the node CLI monitor; no `js/` app module imports it (verified by grep).
Tests: `pipeline/diploop.test.mjs`. Follow-on **DL3** (flush-distribution → candidate discovery feeding the
thesis layer / `strategies.mjs` + auto-fed `dip-watchlist.json`) is specced in PLAN.md, OPEN/n-gated.

### DP1 — dip DIRECTION, not just depth: the dip-posture entry classifier (2026-07-10, pipeline-only — NO APP_VERSION)
A resting bid only fills while price is still coming DOWN to it — a seller has to cross the spread down.
Once a dip REVERTS (bounces off its low and runs away up) no seller crosses down, so the bid just sits
there missing. Two n=2 incidents motivated this: a Searing-page bid @16,014 on a dip that had ALREADY
reverted (bounced to 16,249+ and ran away), and an Abyssal-bludgeon bid @16.15m on a ~83/day item that
never filled. The existing ⬇DIP probe (`pipeline/modules/dip.mjs`) captured DEPTH (live under the 24h avg
low); DP1 adds DIRECTION.

- **`recentDirection(ts5m, opts)` — new pure export in `js/quotecore.js`** (its natural home beside the
  other 5m intraday-shape reads `bandCore`/`diurnalRead`/`overnightStaleRisk`; the 1h series is too coarse
  at 2–4 points over the ~3h lookback). Reads the `avgLowPrice` side (the instasell side, where a resting
  bid fills) over an already-fetched 5m series → `null` (thin/absent) or `{ dir, minLow, minAgeMin,
  recentLevel, bouncePct, n }`, `dir ∈ falling|reverting|flat`. `recentLevel` is the ROBUST **median** of
  the last 3 lows (Bar-E discipline — a lone flier print can't fake a bounce; reuses the SF-1 shared
  `median`). `falling` = fresh low OR still at the low; `reverting` = bounced ≥ `DIR_REVERT_PCT` off an
  un-fresh low. All five constants (`DIR_LOOKBACK_H/MIN_POINTS/FRESH_MIN/AT_LOW_PCT/REVERT_PCT`) are named
  PLACEHOLDERS (n=2); validation = retro-joining firings against fills (did 'reverting' correlate with a
  miss, 'falling' with a fill).
- **`dipPostureValidator(ctx)` — new validator in `js/validate.mjs`** (`'dip-posture'`, BUY-side,
  **INFORM-only, NEVER-REJECT** by construction — it can never drop a row or re-price a bid). Speaks only
  on a dip row (`DIPPOST_MIN_PCT`, a twin of dip.mjs's `DIP_MIN_PCT` — `js/` can't import `pipeline/`, so
  it's redefined with a cross-pointer both places). falling/flat → pass ("a resting bid fills as it
  drops"); reverting → caution ("cross @ instabuy … or pass", with the after-tax cross net, bond-aware via
  `netMargin`; an unprofitable cross says so). Degrades to pass on held/no-quote/no-24h-avg/no-5m/no-dip/
  thin-series.
- **Wiring:** inform on the band + churn specs only (`js/strategies.mjs`) — NOT scalp (accepts fallers by
  thesis) or value (a buy-hold, not a bid-fill play). `screen.mjs` hoists the existing 24h lookup and feeds
  `intraday.ts5m`/`avgLow24`; `quote.mjs`'s per-item read feeds the same (so the note fires on the
  explicit-ask surface too). The `--positions` path is untouched (held lots degrade anyway).
- **NO APP_VERSION:** `js/trends.js` imports only `reachValidator`/`floorValidator`/`trajectoryValidator`
  from `validate.mjs`, and `js/strategies.mjs` is not imported by any app module — the new
  `recentDirection`/`dipPostureValidator` exports are unused by the deployed app, so this is not an
  app-behavior change. Fixture-pinned in `pipeline/dipposture.test.mjs`; the full suite (incl. the P1
  replay goldens) stays green — the change is render-stage/inform-only.

### 0.61.0 — Finder Desirability grade (AP4 partial) · forecast cone · searched-item charts (2026-07-10)
Three Ben-requested items, all `js/` (+ `index.html`/`styles.css`); no pipeline change.

- **Finder grade: A–F Risk → Desirability (S+…D).** The Finder's Grade column + Rating bar + default
  sort now come from the SAME shared modules the console uses — `js/estimators.mjs` rank
  (`net × P(fill) ÷ TTF`) + `js/rating.mjs` letter grade — replacing the old profit/hr `RATE_W` Risk
  model. **Honest coarse basis:** the Finder has no per-item 2h band/momentum (it can't fetch a series
  per universe item without hammering the rate limit), so it ranks the LIVE QUICK pair
  (`priceBasis:'quick'`), labeled coarse in the tooltip — the *quote* button remains the band-precise
  read. `volDay` = limiting side (min hpv/lpv, the console basis); the console's thin-grade cap (A-)
  is mirrored so an illiquid big-ticket can't headline S+. Provisional — cutoffs uncalibrated (n≈0).
  New `gradeCls()` (js/format.js) buckets S+…D to a color tier (`.rS/.rA/.rB/.rC/.rD`), also applied to
  the **Scan** tab's grades (they were previously uncolored — `r'S+'` can't match a CSS selector). The
  Watchlist tab's Risk column becomes Grade too. Profit/hr stays as an informational column; the old
  `RATE_W`/`riskIndex`/`score` are now vestigial (full teardown is a follow-up).
- **Forecast cone.** The Trends Forward-forecast chart now draws BOTH projected paths — the projected
  **low** (gold) and **high** (cool) over the next 24h with the uncertainty band shaded between + the
  trough/peak marked — instead of a single low line. Via a small additive `overlay`+`fillBetween`
  option on `js/chartlib.js` (absent config ⇒ byte-identical to every existing single-series chart).
- **Searched items now get the full charts.** Opening Trends for a search-surfaced catalog item (a
  sub-browse-floor / non-universe id) previously showed the plan card only — the `!it.offscreen` gate
  hid Recent/History/Diurnal/Forecast/Why for no data reason (the 5m/1h/6h series fetch fine for any
  id, and each section self-guards). Now a searched item renders the SAME charts as an in-universe one.

### 0.60.0 — Trends item page: Forward forecast + term-structure floor overlay (TV, app-parity) (2026-07-10)
Two of the four Q3 item-page visualizations, both **strategy (C)** off shared `js/` modules the
console already uses — the numbers are the SAME reads, not an app fork. `js/trends.js` +
`index.html` + `styles.css`; the shared modules (`forecast.mjs`, `termstructure.mjs`,
`validate.mjs`) are **now app-imported** (this falsifies their old "not app-imported → no
APP_VERSION" notes — reconciled in README/CLAUDE).

- **Term-structure floor overlay** (on the Price history chart). `termStructure(hseries)` — the
  durable multi-week **floor / ceiling** (robust q15/q85) drawn as teal reference lines + a shaded
  support band, over the existing 6h history. Beside it, the **floor + trajectory validator notes**
  (`floorValidator`/`trajectoryValidator`, inform-only) render the SAME verbatim text the console
  prints — the "buy the base, not the knife" read (trajectory shape: based / oscillating / knife /
  elevated; floor proximity in typical-swings). This is Ben's **validator-note split** — the note
  lives WITH the picture it qualifies, not in one flat block. Degrades quietly on a cold/thin archive
  (floor null → just the live-buy line + a "forms as history accrues" line).
- **Forward forecast** (new timing-tier section). `diurnalForecast(profile)` off the SAME
  `hourProfile` the Diurnal timing chart reads — projects the next 24h: **next trough (bid) + next
  peak (ask)** with eta / window / uncertainty band + confidence, the "not buyable at a good price
  now — buyable ~X in ~4h" answer. A projected-low curve charts the "when does it get cheap" line
  with the trough marked. **Degrades loudly** (post-shock spike/decay, live 2h-band violation,
  thin/flat series → an explicit "withheld — <why>" line, never a guessed number). Provisional
  (PF, n≈0) — the forecast caveat is the note beneath, per the split.
- The two remaining Q3 viz (diurnal is already in since 0.58.0; the fourth is the reach note, also
  in) — the item page now carries all four decision-support reads. Finder rank/grade rebase (AP4),
  Watch verdict consistency (AP3), and buy-limit context (AP5) remain before the 1.0.0 milestone.

### 0.59.0 — Trends charts on `chartlib`: labels, tooltips, timespan windows, neutral diurnal (2026-07-10)
First visual-review pass on the item-page charts (Ben, on localhost). All in `js/trends.js` +
`js/chartlib.js` + `styles.css` + `index.html`; no shared-module or pipeline change.

- **Recent movement + Price history retrofit to `chartlib`.** Both were static `svgLine`. Now
  interactive: y-axis **price labels** and a **hover tooltip** (crosshair + nearest-point readout) on
  both; Price history additionally gets **selectable 1d / 7d / 30d / 90d / All** windows off the 6h
  series (drag-to-pan / wheel-zoom too). The hourly seasonality charts + quote sparkline stay on
  `charts.js` (unchanged).
- **Max-zoom floor (`chartlib`).** The old min-span allowed `fullSpan/500`, which on a 90d/6h series
  let you zoom into a window with zero points. Replaced with a density floor (`medGap*4`, ~4 points),
  so wheel/pinch can't zoom into empty space; explicit span buttons bypass the floor to land on their
  exact duration (a "1d" button still shows exactly one day).
- **Diurnal timing — neutral colors + lookback toggle.** Dropped the green/red dip/peak (they implied
  good/bad, but dip and peak are both deliberately targeted) for a neutral **cool = cheap-hours /
  warm = pricey-hours** pair with a legend. Added an **avg over 7d / 28d** lookback toggle (7d
  reactive, 28d steadier) — hour-of-day either way, via the same shared `windowread` math. (A
  day-of-week view was considered and set aside — day labels weren't useful enough.)
- Further chart polish is deferred to a later pass (Ben: "we'll take another pass later").

### 0.58.0 — app↔console parity: interactive chart library (CL) + Trends Diurnal timing (TV) (2026-07-10)
The CL + first TV sub-chunk of `PLAN-APP-PARITY.md`. Two additive pieces, one bump.

- **CL — `js/chartlib.js`, a reusable interactive SVG chart.** `charts.js` (`svgLine`/`svgBars`) is a
  static 480×150 snapshot — no pan, no zoom, no rescale. `chartlib.js` is the interactive successor the
  whole app can adopt over time. `createChart(container, {series, refs, bands, markers, kind:'line'|'bars',
  yFmt, xFmt, spans, span})` returns a `{setSpan, destroy}` handle. **Pan/zoom model** (decided — SVG with
  viewBox semantics, JS-recomputed; NOT canvas, NOT a CSS transform): the SVG viewBox is fixed (crisp at
  any device zoom) and what moves is the DATA WINDOW `[vLo,vHi]` — a slice of `[tMin,tMax]`. Every pan
  (pointer-drag, shift the window) and zoom (wheel / trackpad ctrl-wheel / two-pointer touch pinch, about
  the cursor) mutates the window and RE-RENDERS the SVG innerHTML from that slice, which is what lets the
  **y-axis auto-rescale to the visible x-window** (zoom into a flat region and detail still shows) while
  keeping stroke widths crisp. Listeners live on the persistent `<svg>` so re-rendering doesn't drop them.
  A **span selector** (2h/1d/1w/3mo/All) snaps the window; spans with no more data than they'd show are
  disabled. Hover shows a floating tooltip + crosshair (t + value via `xFmt`/`yFmt`). Clamps so you can't
  pan/zoom outside the data. NEVER throws on a missing container or empty series — degrades to a "Not
  enough data yet." note + a no-op handle. Theme-aware off the existing chart CSS classes + a few new
  chartlib-only ones (`.ichart`/`.chartspans`/`.chartspan`/`.charttip`/`.cgrid`/`.cxhair`/`.cxdot`).
  ADDITIVE — `charts.js` is untouched (Trends recent/history/hourly + the quote sparkline still use it).
- **TV — Diurnal timing on the Trends item page.** A new **Diurnal timing** section (timing tier, below
  Price history — per the `trends.js` header comment's decision-priority ordering; a timing tool, NOT above
  the plan card). Off the ALREADY-fetched 1h series (no new request), it runs the shared
  `js/windowread.mjs` `hourProfile`/`deriveDiurnalRange` — the SAME computation the console's `screen.mjs`
  + `quote.mjs` print (parity, not a fork) — and renders a 24-bar hour-of-day chart (dip hours green, peak
  hours red) via `chartlib.js` with the derived stale-guarded BID/ASK overlaid as reference lines, plus a
  one-line BID→ASK readout with the after-tax swing and the ★ clean-candidate flag (same formula as the
  console). Degrades to a "not enough hourly history yet" line when `hourProfile` returns null (never a
  broken chart). **Validator split (Ben's instruction):** the `reach` validator note — which scores whether
  those diurnal levels are actually touched/reached — is rendered beside this chart, inform-only, via
  `js/validate.mjs`'s `reachValidator` off the in-hand 1h series (floor/trajectory belong with the future
  term-structure viz, not here). Honest: the diurnal thresholds are placeholders (n≈0); the section is
  labeled guidance, matching the console framing. `js/windowread.mjs` + `js/validate.mjs` are now
  APP-IMPORTED (first app consumers).

### 0.57.0 — app↔console parity, app shell: stale-copy fix · Signals removed · pipeline-version display (2026-07-10)
Lane B of the app↔console parity program (`PLAN-APP-PARITY.md`). Three cohesive app-shell changes, one bump:

- **AP1 — deployed surface stale-copy fix.** The Scan tab still advertised "one table per niche (Band /
  Spread / Rising / Churn)" and "Falling items are excluded" — both stale: the `spread` + `rising` niches
  were DELETED (Steps 3+4, 2026-07-09), the default niches are now **Band · Churn**, and falling handling
  is **per-strategy** (band/churn skip fallers EXCEPT items you hold, ask about, or watchlist, which show
  with price-to-clear guidance). Rewrote the Scan intro accordingly; pruned `NICHE_META`/`NICHE_ORDER` in
  `js/ui.js` to the shipped niches (the unknown-key fallback is kept AND hardened — a published
  `screen.json` niche absent from `NICHE_ORDER` now still renders, labeled by its raw key, appended after
  the known ones); relabeled the Scan params line's "≥N windows" → "≥N traded windows" (the console's
  `--min-traded` / Bar D naming; `screen.json` still publishes the key as `minActive` for back-compat, so
  the app reads the same key and only the display label changed). Also dropped the stale "Signals" mention
  from the footer copy.
- **SIG-DEL — Signals tab removed** (Ben: "I don't use it"). Deleted the nav button + `sigBadge`, the
  `#panel-signals` section, `renderSignals` (`js/ui.js`), `computeSignals` (`js/trends.js`) and its two
  callers in `js/market.js`'s loadAll path, `STATE.signalCache`, and — since nothing else imported it —
  the `planSignal` export from `js/trendcore.js` plus its two `pipeline/trendcore.test.mjs` cases. The
  other trendcore exports (analyseHourly/analyseBroad/buildPlan/patientTargets/backtestPlan) stay. The
  browser smoke's tab list (`pipeline/smoke.mjs`) dropped `signals` (8 → 7 panes).
- **PV render — pipeline version in-app.** The header now shows `app v0.57.0 · pipeline vX.Y.Z (scan HH:MM)`
  next to the app version (new `#pipeVer` span). The pipeline version + scan time are read from the
  published `screen.json` (`payload.pipeline` + `payload.generatedAt`, rendered as LOCAL time) when
  `renderScan` loads it; an older artifact without the `pipeline` field degrades to `pipeline v?` and
  never crashes. This is the LAST-PUBLISHED artifact's version, not a live import — a static page can't do
  better (the label is honest about it). Lane A (separate) stamps the field into `screen.json`/
  `positions.json` at publish; the currently-committed `screen.json` has no field yet, so `v?` is the
  expected default until the next scan.

Not the 1.0.0 parity milestone — that lands at the end of the program. Docs reconciled: `README.md` (tab
inventory, `ui.js` role), `CLAUDE.md`, and `pipeline/doclint.mjs` (the two AP1 xfails were retired now that
index.html is fixed; the denylist rules stay live and now actively guard index.html).

### value-default — value niche runs in `--mode all` (2026-07-10, pipeline-only, no APP_VERSION)
Ben's ruling: the `value` niche graduates from explicit-`--mode value`-only to running in the default
`--mode all` scan alongside band + churn. Mechanism: `inAll: false → true` on the value spec in
`js/strategies.mjs`, so `ALL_MODE_KEYS` now resolves to `['band','churn','value']`. **`scalp` stays
off-by-default** (explicit `--mode scalp` only). Value remains **console-only** (excluded from
`screen.json`, no app tab) so there is no APP_VERSION bump, and it stays **provisional** (n≈0, PLACEHOLDER
thresholds) — a bare `--mode all` runs it on placeholder `--capital`/`--slots` (pass `--capital <gp>` for a
real deployable-capital rank). Docs reconciled in place (CLAUDE.md, `/scan` SKILL v1.44, `screen.mjs`
header/comments). Known open follow-up surfaced by the first default run: the BUY-NOW tier vs the
value-amplitude validator can disagree on a soft-floor item — they measure proximity off different
series/windows (tier: robust q15/q85 over the 28d loadDaily archive; validator: raw min/max over the 7d
1h-derived series). Root-caused this session; fix is queued (demote buy-now→watch on an amplitude caution
+ robustify the validator's 7d edges with quantiles, Bar E's low-side twin).

### 0.55.0 — BAR-E Scope B: robust band edges in the app Optimistic column (2026-07-10)
The Scope B follow-through on Bar E (below): the same flier-trimming now lands in the **app-facing**
`computeQuote` Optimistic column (`optBuy`/`optSell`) at source, not just the pipeline surfacing path.
Previously the app took `bandLo = min(avgLow)` / `bandHi = max(avgHigh)` raw over the last 24×5m points, so
a lone flier inflated the surfaced Optimistic ROI — the exact "band-top artifact" Scope A killed on the
pipeline side. Now `computeQuote` clamps the Optimistic edges against the **robust** band (p10 low / p90
high on a dense side ≥ 8 prints, raw extremum on a sparse side).

**The split.** `bandLo`/`bandHi` in `computeQuote` did two jobs: (1) the MOMENTUM tell (`mom` =
breakdown/breakup fired off `quickBuy < rawBandHi` etc.) and (2) the Optimistic clamp. Scope B SPLITS the
variable so only the clamp changes: `rawBandLo`/`rawBandHi` keep the TRUE `min`/`max` and still drive `mom`
and the `row.rawBandLo/rawBandHi` audit fields (a "fresh 2h high" must fire off the real band max, not the
robust p90 — so the Momentum column is byte-identical); the robust edges feed ONLY the Optimistic clamp
(and `row.band.lo/hi`). Net behavioral effect: Momentum unchanged; Optimistic loses the flier artifact on
dense bands; sparse bands (<8 prints) unchanged because robust==raw there.

**Shared-home move.** `robustBand` + `quantileSorted` + `BAND_EDGE_MIN_SAMPLE`/`_HI_Q`/`_LO_Q` (all
NAMED PLACEHOLDERS, unchanged values) MOVED from `pipeline/lib/marketfetch.mjs` into `js/quotecore.js` —
the app+node shared, DOM-free module every pipeline script already imports — so both paths robustify off
the ONE implementation (quotecore must never import `marketfetch`, which drags `fs` into the browser).
`marketfetch.mjs` now imports them from quotecore and re-exports, so `pipeline/bandedge.test.mjs` (imports
from `./lib/marketfetch.mjs`) is untouched. `loadHistBands` stays RAW on purpose (honest O1 backtest
reconstruction). Tests: full suite 49 suites green; `pipeline/bandedge.test.mjs` (8) unchanged; a new
`quotecore.test.mjs` Scope-B assertion proves the split (dense high-side flier → `optSell` below the raw
max while `rawBandHi`/`mom` still reflect the raw max) — quotecore 41→42. **Replay golden byte-UNCHANGED**
(the fixture bands are near-flat, so robust==raw for every fixture row). Browser smoke passed. The three
thresholds remain unvalidated placeholders (process rule 4) — Scope B changes WHERE the edge is drawn, not
whether the magnitude is right.

### BAR-E — robust band edges: a lone flier can't set bandHi (2026-07-10, pipeline-only — NO APP_VERSION)
The Bar-D sequel. Bar D fixed WHETHER a band gates (density vs two-sidedness); Bar E fixes WHERE its
edges sit. The band edge was the raw `min(avgLow)` / `max(avgHigh)` over the 2h of 5m prints, so ONE
flier — a lone 100k print against a 59k mid — set `bandHi` and inflated the surfaced ROI (the "band-top
artifact" the reach validator and a manual `/scan` rule had to catch after the fact). `robustBand`
(`pipeline/lib/marketfetch.mjs`) now takes the **p90 high / p10 low** on a DENSE side (≥
`BAND_EDGE_MIN_SAMPLE` = 8 prints) and keeps the raw extremum on a SPARSE side — because a quantile over
a handful of points either equals the max or wrongly *discards the one real high*, exactly the thin
big-ticket class Bar D just admitted (the reach validator backstops that residue).

**Scope decision (Ben, "let's do scope A first… even if we surface outliers the validation layer should
catch it").** Bar E robustifies the **LIVE surfacing path only** — `loadBands` → `bandCore`'s edge/Rank.
Two paths stay RAW on purpose: (1) `loadHistBands`, because the O1 backtest-join reconstructs the *actual*
band a historical trade sat in (flier and all) for fill-model calibration, not a surfacing decision; and
(2) `computeQuote`'s app-facing Optimistic column (Scope B — **DONE in 0.55.0, see the entry above**;
`robustBand` has since MOVED to `js/quotecore.js` and this file re-exports it). Because the robustification lives
upstream in the aggregation, `bandCore` and the replay golden are **byte-unchanged**; Bar E gets its own
focused unit test (`pipeline/bandedge.test.mjs`, 8 checks) on the pure `robustBand` helper instead of a
golden change. Live `--mode band` confirmed clean (big tickets still surface; edges no longer flier-set).
The three thresholds are NAMED PLACEHOLDERS pending a validation pass (process rule 4); `rawBandLo`/
`rawBandHi` are retained on the band record for audit / a future §F "edge trimmed X→Y" note.

### BAR-D — traded-band gate: decouple density from two-sidedness (2026-07-09, pipeline-only)
Ben: "This seems to bite us a bunch, how can we improve on this?" — the "residual" from the spread/rising
deletion (an item with ZERO traded 5m windows in the 2h is deliberately excluded) was culling nearly every
genuinely-liquid BIG TICKET. Root cause: the traded-band gate counted only 5m windows that were two-sided
*within the same 5 minutes* (`active5m`). A big ticket prints a handful of times an hour (a low at :05, a
high at :35) and almost never has both sides inside one 5m bucket, so `active5m ≈ 0` and even the relaxed
thin bar (`MIN_ACTIVE_THIN:1`) dropped it — a coincidence bar masquerading as a liquidity bar.

The one count was doing two unrelated jobs: (1) "is this liquid" — already the two-sided 24h gate's job,
better; (2) "is this band real or one spike" — an artifact question. Bar D SPLITS them: DENSITY = `tradedWin`
(windows with ANY trade, one-sided OK — a lone spike is `tradedWin 1`, still rejected; `MIN_TRADED` 6 dense /
`MIN_TRADED_THIN` 2 thin) + TWO-SIDEDNESS = `sawLow && sawHigh` asked ONCE across the whole window (an
all-buys-no-sells ghost fails). Liquidity proper stays the 24h gate. We compared four candidate bars
(status-quo / 1h-bucket / wider-lookback / decouple) and picked D as the one that separates the jobs using
data already computed; Bar E (robustify the band EDGES with p10/p90 so a lone print can't set `bandHi`) was
deferred — the reach validators backstop that residual.

RIPPLE: `marketfetch.mjs` emits `tradedWin`/`sawLow`/`sawHigh` on BOTH band paths (`loadBands` + the
outcomes `loadHistBands`); `bandCore` (js/strategies.mjs — no app module imports it, so no APP_VERSION) gates
on them with a legacy `active5m` fallback; `activeWin`→`rating.mjs` confidence now reports `tradedWin` so a
big ticket is no longer grade-penalised for low `active5m`; `active5m` survives as a display/quality signal.
`--min-active` → `--min-traded` (old flag kept as an alias). Replay archetype 2003 became the regression
guard — `active5m 0` (would have failed the old gate) surviving on `tradedWin 8`; golden.json byte-UNCHANGED
(every gate decision identical). Live smoke: `--mode band` now surfaces Avernic hilt / Masori body / Ghrazi
rapier / Virtus robe top / Armadyl godsword — the class that was invisible. `/scan` 1.40→1.41.

### BOND1 — bond tax exception + searchable in the app (2026-07-09, APP_VERSION 0.54.0)
Ben: "encode the bond mechanic … as an exception in the tax calculation. i.e. buy price + 10% guide just
for bonds to compare against the sell." The Old School Bond is EXEMPT from the 2% GE tax, but a GP-bought
bond is untradeable and costs 10% of its guide value to make re-tradeable — so a bond flip's net =
`sell − (buy + 10%×guide)`, tax-free. Encoded as the ONE exception in the tax math: `netMargin(low,high,
{bond,guide})` and `breakEven(buy,{bond,guide})` in `js/format.js`/`js/quotecore.js` (opts absent ⇒
byte-identical normal path — every existing caller unchanged). `computeQuote` applies it when passed the
item `id` (sets `row.bond`/`row.retradeFee`); `estimateRank` reads those so a ~0-spread bond can't grade
off a phantom tax-only spread. Result: `quote.mjs "Old School Bond"` now reads Quick −1.22m (−10%) /
Optimistic −444k (−3.7%) with a `bond: TAX-EXEMPT, but +1.22m retrade fee` note — where it previously
showed a false tax-only profit.

APP: the bond used to be filtered out of the catalog entirely (unsearchable); it is now KEPT (searchable)
with a bond-aware Finder margin (`market.js` `bondMarginOpts`), so it shows an honest loss instead of
being hidden. `BOND_ID` moved to its canonical home in `format.js` (state.js's copy removed).

SCOPE (deliberately minimal — Ben flagged overengineering mid-build): the exception lives in the tax
primitives + the ONE quote builder (`computeQuote`) + the rank net (`estimateRank`); the pre-fetch band
GATE (`strategies.mjs`/`gatecandidates.mjs`) was NOT made bond-aware (it would have threaded a fee through
5 edge functions + risked the replay goldens) — unnecessary, because the DISPLAYED net/grade already come
from the bond-aware `computeQuote`/`estimateRank`, so a surfaced bond reads honestly unprofitable. Held-lot
break-even plumbing (watch/alerts/positions) was left on the normal path (a held bond is out of scope).
Tests: `format.test.mjs`/`quotecore.test.mjs` bond fixtures (netMargin/breakEven/computeQuote); all
pipeline suites green; replay goldens untouched.

### TV1 — per-thesis validators + trajectory (knife/oscillating) + in-script windowrange (2026-07-09, pipeline-only — NO APP_VERSION)
Ben's design session: (1) "does it always make sense to run every validator for every thesis?" and
(2) "any suggested item should have the windowrange analysis done in script." The resolution separates
a validator's COMPUTATION (thesis-agnostic — the swing/local-min/knife/reach analysis helps every buy)
from its ACTION (thesis-specific). `spec.validators` (`js/strategies.mjs`) becomes an authoritative
per-thesis plan of `{key,mode,window}` — `gate` (verdict stands) vs `inform` (computed + annotated,
never drops, would-have verdict logged for the track record) — and `screen.mjs` drives
`runValidators(ctx,{specs})` off it (was: the whole registry on every surface). This is the noise
reconciliation: only a thesis that GATES on a key lets it hide a row, so `scalp` INFORMS on trajectory
(it accepts a falling wide band by thesis) while band could gate.

Two new validators + the classifier: `js/termstructure.mjs` `classifyTrajectory` labels the multi-week
SHAPE — **knife** (spike + monotone-down lows → the Nightmare-staff catch), **oscillating** (repeating
local minima around a flat/declining mean → a falling-BUT-buyable rhythm, the Hydra-leather case, checked
BEFORE knife so it isn't mislabeled), **based** (flat value-low), **elevated** (bought high). `js/validate.mjs`
gains `trajectoryValidator` (the buy-side SHAPE policy, distinct from floor's LEVEL check) and
`valueAmplitudeValidator` (value's recent-week amplitude + proximity-to-low). `screen.mjs` **Leg B**
fetches the 1h series for surfaced SURVIVORS only (`TS_TTL_1H`, ~one fetch per surfaced row) so
`reachValidator` FIRES on the screen (was dormant — degraded to no-data), and derives the trajectory off
that same 1h series (`trajectoryFrom1h`) so it fires NOW while the `loadDaily` archive is still cold.
`valueAmplitudeValidator` reads the recent-WEEK amplitude off that same warm 1h-derived term structure
(`richFrom1h`, `current` set to the live price) so it, too, fires now instead of degrading on the cold
`loadDaily` 7d slice (`valueRanges`/`valueGate`/floor keep the `loadDaily` proxy). All
surfaced rows carry `ℹ trajectory/reach` inform notes. ROLLOUT (rule 4, n≈0): reach/trajectory/value-amplitude
start **inform everywhere**; only the already-live floor+limit gate — flipping a cell to gate is a one-word
change once the notes prove out. Tests: `validate.test.mjs` (+9: the two validators, gate/inform clamp,
informFlags, ledger track-record logging, reach-window injection), `termstructure.test.mjs` (+4: the
classifier's knife/oscillating/based/degrade shapes), registry-key assertions updated; replay goldens
UNTOUCHED (the validator surface runs after the pinned gate funnel). No app module imports the changed
modules → no APP_VERSION.

### LM1 — buy-limit awareness on every suggesting flow (2026-07-09, pipeline-only — NO APP_VERSION)
Ben's ruling: "limits.mjs ... should be a part of every flow that suggests items ie we can flag as
profitable but disqualify on limits and state when the limit should reset." New pure
`pipeline/lib/limits.mjs` (`limitWindow` — the community-documented rolling-4h model: each bought unit
counts against the limit for 4h; returns bought-in-window / remaining / nextFreeAt / fullResetAt;
`buysByItem` extracts BUY fills via the SAME `collapseOffers(dedupeSnapshots(...))` chain the
reconstruction uses) + CLI `pipeline/limits.mjs "<item>"`. Wired into every suggesting surface via a
new `limitValidator` in the js/validate.mjs registry (BUY-side: remaining 0 → reject with "buy limit
exhausted (bought N/N this 4h window) — next frees ~HH:MM"; remaining < 25% (`LIMIT_CAUTION_FRAC`,
placeholder) → caution; absent stage / null limit → degrade to pass — null limit = UNKNOWN, never
unlimited). screen.mjs builds the per-item window map once per run from fills.json (local file, no
fetch) — an exhausted-limit candidate is dropped into the counted `rejected:` footer WITH its reset
time (profitable-but-disqualified stays visible); held/asked/watchlist rows are never hidden (flag =
NOTE). quote.mjs extends the regime line: `buy limit 25,000/4h (bought 8,400 this window — 16,600
left, next frees ~14:20)`, gated on in-window buys so zero-usage output is byte-identical. HONESTY
(documented in the lib header + CLI footer): fills.json sees only logged fills, so bought-in-window is
a LOWER bound and remaining an UPPER bound (a mobile/unlogged buy is invisible); units attribute to
the offer's close time (conservative skew). Known gap: the provisional `--mode value` niche renders
via `valueGate`, not `runValidators`, so it lacks the limit stage (PLAN.md Discovered). 48 suites.
No APP_VERSION: `js/validate.mjs` is node-only today (no app module imports it, verified) and the
validator degrades without the pipeline-supplied stage.

### Buy/sell pressure ratio on quote + watch (2026-07-09, pipeline stdout only — NO APP_VERSION)
Ben's ask: surface the buy/sell pressure ratio in the live fetch output, with its shortcomings
documented. `computeQuote` (js/quotecore.js) now derives `row.pressure = {hpv, lpv, ratio}` from the
/24h endpoint it ALREADY receives (zero extra fetch): `highPriceVolume` = units transacted at the
instabuy side (buyers crossing the spread), `lowPriceVolume` = the instasell side (sellers crossing);
ratio = hpv/lpv. The ONE display formatter `pressureText` renders it as the dominant side
(`buy 1.4× (hpv 3.05m / lpv 2.3m)`, compact `buy 1.4×`; null when either side is zero/absent).
Surfaced on: the `quote.mjs` per-item regime line, and the `watch.mjs` held note-block header
(new optional `pressure` field in the V5 emit contract, `lib/emit.mjs` — omitted-when-null pinned
byte-identical), plus the bid and target note lines. **Documented shortcomings (at the derivation):**
it is REALIZED flow, not an order book (Jagex exposes no resting bid/ask depth — "N buyers waiting"
is genuinely unavailable); side attribution is the wiki's price-side heuristic; it's a TRAILING 24h
window that lags intraday shifts (the Momentum column stays the live directional tell); flip-heavy
items trend toward 1.0× by construction, so a strong skew on a liquid item means more than balance
does. Display-only — deliberately NOT a gate, verdict, or rating input (pinned: a verdict fixture
with a lopsided vol24 is byte-identical). No APP_VERSION: the app renders via quoteCells, which is
untouched (the P5 data-only-quotecore-field precedent). Once the D0 archive holds weeks of 5m
snapshots, a rolling imbalance-vs-forward-move calibration is the natural follow-on.

### V2-P6c — empty-result sub-floor fallback (2026-07-09, pipeline-only — NO APP_VERSION)
Ben's 2026-07-09 ruling: when a niche's floors leave ZERO candidates, the screen must not print an
empty table and stop — it re-runs the gate BENEATH the floor and shows the best sub-floor rows
HONESTLY LABELED, never silently lowering the bar. New `subFloorFallback(mode, ctx, thresholds)` in
`pipeline/lib/gatecandidates.mjs`: fires ONLY when `gateCandidates` came back empty at the configured
floors (a niche with ≥1 candidate is untouched — verified byte-identical stdout on a live cached-data
before/after diff, and the P1 replay goldens are unchanged), then walks a two-step relaxation ladder
through the SAME `gateCandidates` (no forked gate logic) to identify WHICH floor emptied it:
(1) `min-gpd` — relax only the 500k attention floor; (2) `liquidity` — also relax the gp-flow floor,
admitting sub-unit-floor two-sided items via the existing `thin` path. The two-sided liquidity gate
and the per-niche THESIS EDGE (min-roi / churn volume / scalp margin) are NEVER relaxed — a market
they emptied returns null and the normal `_none_` output stands unchanged.

**Honesty contract.** The table banner replaces the niche header: `SUB-FLOOR FALLBACK — 0 candidates
cleared the configured floors` + the label `sub-floor — shown because nothing cleared <floor + its
configured value>; relaxed (<which>) for this table only`. Every row ALSO carries it: grades are
capped at `SUBFLOOR_GRADE_CAP` ('C' — a sub-floor row can never print a grade a qualified row could)
and render as `C (sub-floor)`. Cap = best `SUBFLOOR_TOP` (5) by the existing `rankAndSlice` ordering.
Both constants are NAMED PLACEHOLDERS.

**Scope discipline.** Stdout-only: a sub-floor niche publishes `[]` to `screen.json` — byte-identical
to what a pre-P6c empty niche published (no APP_VERSION bump). Suggestions-ledger rows ARE logged
(a surfaced row Ben acts on must stay joinable for F1 calibration) but carry a lean
`subFloor: 'min-gpd'|'liquidity'` marker (YS2 absent-field pattern — normal rows byte-identical,
pinned by test) so calibration can segment them. Validators still run on fallback rows (reject still
DROPS — verified live), per-spec falling doctrine + posture unchanged, watchlist/held exemptions
untouched. The VALUE niche is scoped out (its floors are its own term-structure amplitude gate + §F
flood control with an admitted-vs-shown footer, and it's provisional/off-by-default n≈0). Tests: new
`subfloor.test.mjs` (11 checks); 46 suites green.

### V2-P6b — per-thesis TTF estimators + rank replaces gp/d (2026-07-09, pipeline-only — NO APP_VERSION)
Ben's 2026-07-09 ruling: "I despise gp/d as a metric; it makes so many assumptions about fill speed and
fill price… let's get something that's more accurate per thesis and less hand wavey." `expGpDay`
(min(limit×6, 10%×volDay) × modeNet — three compounding unmeasured throughput assumptions) is
**DEMOTED**: it survives ONLY as the cheap pre-fetch pool orderer inside `rankAndSlice` and as the 500k
`--min-gpd` attention pre-filter — never again the displayed "best" number or the grade basis. The
replacement, per thesis: **rank = net after tax × P(fill at the quoted prices) ÷ TTF**.

**The price-basis principle (coordinator-ruled, Ben-vetoable).** Every suggestion commits to ONE price
pair — the bid/ask the thesis itself would post — and net, P(fill) and TTF are ALL evaluated at that
same pair (declared per spec as `priceBasis`): spread = live quick pair; band/churn/scalp = 2h band
edges; rising = near-current entry → forecast target; value = durable floor → term-structure recovery
level (NOT the raw ceiling). The net is always the ONE shared `netMargin`/`tax` — no new tax logic.

**The estimator seam.** New PURE `pipeline/lib/estimators.mjs`: three estimator families (registry keyed
by a spec's new `estimator` field — `intraday` / `value` / `rising`), each a `pFill(ctx)` + `ttf(ctx)`
returning `{value, n, basis}` so the honesty (what data, how many observations) travels WITH the number.
intraday P(fill) = band-depth (or a real windowread reach read when a surface fetches the 1h series —
degrades honestly on screen/quote, which don't, exactly like reachValidator), TTF = volume-velocity
around the intraday prior; value P(fill) = floor-proximity (the P5 valueScore component), TTF =
trough→recovery prior; rising = regime/forecast horizon. `rankScore` = net × P(fill) ÷ TTF(days),
PER-UNIT (not per-slot — volume/slot-count is exactly the throughput assumption Ben rejected), with a
1h TTF floor. `estimateRank(spec,row,extra)` bundles pair/net/pFill/ttf/rank.

**Wiring.** `screen.mjs`'s last column is now `Rank net·P/ttf` (risk-adjusted rank + honest components
`net · P~ · ttf~`) instead of `Score gp/d`; `rating.mjs`'s grade reward moved from expGpDay to the rank
(cutoffs re-scaled, still NAMED PLACEHOLDERS); niche/watchlist/value all rank on the same basis. The
suggestions ledger gains lean fields `bid/ask/pFill/ttfSec/rank/estBasis/estN` (YS2 lean pattern — absent
on older rows, byte-identical) so the retro-join can later calibrate estimate-vs-realized.

**HONESTY (rule 4).** n≈0 on EVERYTHING estimator-shaped today — every constant is a named placeholder
encoding SHAPE, not magnitude; the archive began accruing 2026-07-08 and `retrojoin.mjs` is the
calibrator that will replace the guesses. The intraday/multiday TTF priors mirror retrojoin's horizons
in magnitude but are declared apart (a JOIN CLAIM WINDOW vs an EXPECTED-LATENCY prior — distinct concepts).

**App-safe / goldens.** No app module imports `strategies.mjs`/`estimators.mjs`, and the app renders
screen.json headers generically (only 'Grade' is special-cased) with headers travelling in the payload —
so renaming the column is safe with NO APP_VERSION bump. The P1 replay goldens are UNCHANGED (verified
via `--update`: zero diff) — the funnel golden captures gated/ranked/kept/dropped, and `rankAndSlice`'s
pre-fetch ordering deliberately still uses expGpDay (the demotion ruling); the displayed rank is a
renderMode concern the funnel golden doesn't capture. Tests: new `estimators.test.mjs` (14 checks:
conformance no-throw/degrade/determinism over the replay archetypes + per-family math + rankScore/
quotedPair/estimateRank), `strategies.test.mjs` + `rating.test.mjs` extended; 45 suites green.

### V2-P6a — the retro-join calibrator (2026-07-09, pipeline-only — NO APP_VERSION)
The FOUNDATION slice of P6 (evidence-based viability + TTF). A new **suggestion→fill retro-join**:
for every suggestion row the tool ever logged (active `suggestions.jsonl` + the monthly archives,
via the ONE shared `readSuggestionLines`), join FORWARD to `fills.json` BUY events for the same
item AFTER the suggestion and classify the outcome — `filled` (a buy fill at ≤ the suggested buy
within a per-mode horizon), `filled-worse` (bought that item in the window but above the suggested
price), or `not-taken` (no buy fill in the window — the DOMINANT class; most suggestions are never
acted on, and the report says so honestly). Where a closed FIFO round-trip exists it adds the
buy→sell hold time + realized after-tax net. This is the ground-truth TTF calibrator the P6 ruling
(Ben 2026-07-09) demands — realized suggestion→fill latency from OUR OWN FILLS, never touch-proxies
(touched ≠ filled: queue position is invisible) — and its per-niche "realized profit per unit of
attention" read is the input that will later decide the spread/band/churn consolidation question.

**Extend vs sibling — a SIBLING.** `outcomes.mjs` already exists but is CAMPAIGN-keyed and joins
BACKWARD (each offer-campaign → its nearest PRIOR suggestion) to validate the campaign schema +
band-percentile fill-time cells. The retro-join is SUGGESTION-keyed and joins FORWARD (each
suggestion → the fills it plausibly caused); the primary key, join direction, and output all
differ, so folding it into outcomes.mjs would blur two concerns. It REUSES rather than duplicates:
the same FIFO helpers (`collapseOffers`/`matchTrades`/`dedupeSnapshots`) and the ONE shared
suggestions reader — no second reader was created.

- `pipeline/lib/retrojoin.mjs` — the PURE, node-importable, fs/fetch-free join core (`retroJoin` +
  `aggregateOutcomes`), synthetic-fixture-tested in `pipeline/retrojoin.test.mjs` (10 assertions:
  filled/filled-worse/not-taken, exact latency, the nearest-prior one-fill-one-suggestion dedup, a
  path-less row aggregating under mode, a round-trip's realized net, partial fills, determinism).
- `pipeline/retrojoin.mjs` — the read-only REPORT (`node pipeline/retrojoin.mjs`): per-niche +
  per-path accounting with **n on every aggregate and deliberately NO grades/verdicts** (process
  rule 4 — the archive began accruing 2026-07-08, so a weeks-cold, mostly-not-taken sample is
  EXPECTED). `--json` dumps the raw joined rows.
- **NAMED PLACEHOLDERS:** the per-mode fill horizons — `HORIZON_INTRADAY_SEC` (12h; scalp/band/
  spread/churn), `HORIZON_MULTIDAY_SEC` (7d; rising/value), `HORIZON_DEFAULT_SEC` (24h; mode-less
  quote/positions rows). The whole point of the retro-join is that it MEASURES the real latency so
  a later chunk (P6b/c) can replace these guesses with data. Nothing here is calibrated.

First real run: 11,356 suggestion rows × 115 buy offers → 18 filled · 55 filled-worse · 11,283
not-taken (99% not-taken — honest and expected this early). TTF estimators, per-thesis ranking,
`weighPaths` viability feeding, and the sub-floor fallback are LATER chunks; this is the calibrator
they feed.

### V2-P5 — scalp/value niches + path-aware bids + per-strategy falling doctrine (2026-07-09, pipeline-only + inert quotecore/paths/termstructure widening — NO APP_VERSION)
The DOCTRINE chunk of the Pipeline-v2 wave: Ben's 2026-07-08 amendment — "a falling item is not
necessarily a poor purchase; we cannot judge falling without its history and typical fluctuations" —
turns the global falling-exclusion into a PER-STRATEGY rule, and adds two provisional off-by-default
niches that exploit it. **Every scalp/value threshold + weight is a NAMED PLACEHOLDER (n≈0);** the
suggestions ledger (mode `scalp`/`value`) is the accrual that would tune them — nothing here is validated.
- **Per-spec falling doctrine.** Each strategy spec now declares `falling` (`js/strategies.mjs`):
  `exclude` (band/spread/rising/churn — unchanged; the replay goldens pin byte-identity), `accept`
  (scalp EXPECTS a falling wide band), `knife-guard` (value — reject a decay/downtrend, accept a
  flat/basing value-low). `surviveMode` reads `spec.falling` instead of a hardcoded exclusion. The
  replay golden re-pin (`--update`, hand-reviewed) adds ONLY a new `scalp` scenario where the fallers
  2004/2005 SURVIVE — the existing four-niche scenarios are byte-identical.
- **`scalp` niche** (`--mode scalp`, off-by-default): a deliberate intraday flip on a falling market —
  a wide fresh band clearing tax + a scalp margin (`SCALP_MIN_ROI`=2.0%, placeholder, > band's 1.5%),
  reach-validated on today's high (the P2 reachValidator, which degrades to pass on the screen — no 1h
  fetch, same as every surface). Flip-only/no-hold with a hard intraday stop: the path engine
  (`js/paths.mjs` `SCALP_NO_HOLD_PENALTY`) sinks BOTH hold-family theses when `enteredUnder==='scalp'`,
  so an unsold scalp lap migrates to `cut`, NEVER `hold-recovery` (pinned in paths.test.mjs).
- **`value` niche** (`--mode value`, off-by-default, console-only — PLAN-VALUE): buy near a multi-week
  low and HOLD for the cycle; the edge is ONE tax-paid sell of a big move, not fast churn. Its own gate
  (`js/valuescreen.mjs` + `js/termstructure.mjs`): two-sided liquidity KEPT, the 500k gp/day THROUGHPUT
  floor REPLACED by an after-tax cycle-amplitude floor (`VALUE_MIN_CYCLE_PCT`=6%), liquidity floor
  LOWERED (`VALUE_LIQ_FLOOR`=20 — hold for days/weeks needs eventual exitability, not churn), and a
  decay/downtrend KNIFE guard (recent-3d median below the 14d median). Amplitude is computed off the
  ROBUST floor→ceiling quantiles (new `termStructure.ceiling` = q85, symmetric to the q15 floor) so a
  lone spike can't inflate a range, with a noise cap (`VALUE_MAX_CYCLE_PCT`=150%), a capital-deployment
  min price (`VALUE_MIN_PRICE`=1000), and a MULTI-WEEK coverage guard (a cold archive surfaces nothing —
  the honest degrade). Ranked by `valueScore` (amplitude × proximity-to-low × floor-stability — §F), a
  HARD top-N (`VALUE_TOP_DEFAULT`=25), buy-now/watch tiers by proximity, its own §D table with the hold
  horizon stated + a provisional banner + an admitted-vs-shown footer. Value picks are ISOLATED (§E) —
  they never feed the fast-flip verdicts and are excluded from `screen.json` (no app tab yet).
- **Path-aware bids — CANCEL-BID emergent.** `offerVerdict(row, price, pathCtx?)` gains an OPTIONAL
  third arg (a declared scalp/value-hold thesis key or `{path,tripwire}`). A bid under a deliberate
  thesis no longer CANCEL-BIDs off the falling REGIME alone — only its own tripwire (scalp: a live
  reliable 2h breakdown; value-hold: a floor break). **App-inertness proof:** absent the third arg the
  verdict is BYTE-IDENTICAL to pre-P5 across the full state×price matrix (pinned in watchcore.test.mjs),
  and the deployed app Watch tab calls `offerVerdict(row, price)` with no path arg → app behavior
  unchanged → NO APP_VERSION bump (the P4a "inert quotecore widening" precedent). `watch.mjs` threads
  the declared path (from the hold-thesis store) into its bid rows/alerts.
- **Docs + tests.** Six-spec conformance suite green; new `pipeline/valuescreen.test.mjs`; value gate +
  §F flood-control regression in `gatecandidates.test.mjs`; scalp accept in `survivemode.test.mjs`;
  path-aware + app-inertness in `watchcore.test.mjs`; scalp-lap in `paths.test.mjs`. CLAUDE.md's falling
  rule + niche list, README inventory, and MONITORING.md's bid-verdict matrix reconciled in place.

### V2-P4c — Declarative strategy specs + surfacing-side paths (2026-07-08, pipeline-only — NO APP_VERSION)
Before P4c the screen's four niches lived as imperative `if (mode === 'spread') … else …` branches
inside `pipeline/lib/gatecandidates.mjs` — the niche name was a magic string threaded through the gate
stack, the fetch-pool ranker, and the survival doctrine. P4c re-expresses each niche as a DATA-SHAPED
SPEC so P5 can add the scalp/value specs (and the amended per-spec falling gates) by REGISTERING a spec,
not by editing gatecandidates.mjs / screen.mjs again.
- **New `js/strategies.mjs`** — a pure, DOM-free registry (imports only `tax` from format.js + `PATH_KEYS`
  from paths.mjs; app- and node-importable like quotecore/paths). Each niche is a spec `{key, label, inAll,
  pool:{risingFloor}, edge, rank, confirm, validators, defaultPath}`. The `edge` functions are a MECHANICAL
  re-expression of the exact inline blocks gatecandidates.mjs used to run (same `tax` math, same gate
  order, a `continue` is now a `return null`). `gateCandidates`/`rankAndSlice` look up `STRATEGIES[mode]`
  and drive off `spec.edge` / `spec.pool.risingFloor` / `spec.rank`; `screen.mjs` derives its MODES/
  ALL_MODES from the registry (the niche names live in ONE place now). NY2.1 rising-pool floor + NY2.2
  churn-off-by-default preserved.
- **BYTE-IDENTITY (the refactor-proof).** The P1 replay goldens (`pipeline/fixtures/replay/golden.json`)
  pass UNCHANGED (no `--update`); `gatecandidates.test.mjs` + `survivemode.test.mjs` stay green + unedited.
  A LIVE `screen.mjs --mode band` diff — same on-disk fetch cache, pre-refactor vs post-refactor with the
  new annotation block stripped — was **byte-identical** (zero diff). The survival doctrine (falling-
  exclusion / rising-confirm / posture) is UNTOUCHED in `surviveMode` (still keyed on mode) — the amended
  per-spec falling doctrine is P5, and the registry is the seam it slots into.
- **Screen shows the weighed path set per candidate** — each surfaced row gains a compact stdout
  annotation (`  ↳ Cake — scalp* 0.60 · value-hold 0.30 · avoid 0.30`): the surfacing spec's inferred
  default entry path (marked `*`) + the weighed js/paths.mjs alternatives (unheld enumeration: scalp/
  value-hold/avoid) off the already-derived row+phase (no new fetch). Decision SUPPORT, display-only — it
  never hides/reorders a row and is deliberately NOT in the published `screen.json` cells (the app
  contract stays byte-identical). Viabilities are the P4a PLACEHOLDER heuristics (shape, not calibration).
- **Inferred default entry path via the suggestions ledger** — `suggestionEntry` gains a lean `path`
  field (the spec's `defaultPath`), lean-included exactly like the YS2 fields: a caller that supplies no
  path (quote.mjs, watchlist rows) logs a byte-identical shape. It lets a later fill attribute a position
  to a thesis when no explicit `thesis.mjs set --path` was declared (the P4b fallback: explicit hold-
  thesis > inferred > null; P4c only WRITES the field).
- **HONESTY (rule 4).** The DEFAULT ENTRY PATH per niche (band/spread/churn → `scalp`, rising →
  `value-hold`) is a JUDGMENT proposal, **Ben-vetoable** — it encodes how `/scan` describes each niche's
  intent (band/spread/churn are flip-first "buy the low, sell the top" plays → intraday `scalp`; rising
  is a "size-small, mid-reprice move" you hold through the froth → `value-hold`). Not a gate; changing it
  is a one-line registry edit.
- **Conformance suite (`pipeline/strategies.test.mjs`)** — iterates the registry asserting every spec's
  structural contract (`validateStrategySpec`: required fields, edge callable, `defaultPath` an ENTRY
  path key in paths.mjs's vocabulary, gates well-formed), proves the checker BITES on a deliberately-
  malformed spec, and runs each edge over the shared replay archetypes for no-throw + determinism — so P5
  registering scalp/value gets conformance-checked for free. 42 suites green (was 41).

### V2-P4b — Path persistence + migration + held wiring (2026-07-08, pipeline-only — NO APP_VERSION)
P4a's `weighPaths` re-weighs a held lot's thesis-paths every pass, so its `dominant`/`migration` are
INSTANTANEOUS — two near-tied paths can trade the top spot tick-to-tick, and surfacing that as a fresh
"migrated" headline each pass is exactly the whiplash the alert layer already learned to gate (V4/V7).
P4b applies the SAME arm-then-confirm discipline to path dominance and wires the path read into both
held surfaces.
- **New `pathPersistence()` (`pipeline/lib/watchstate.mjs`)** — the pure cross-pass dominance gate,
  colocated with `convictionGate` because it is the same kind of stateful watch-state memory (it takes
  already-derived path KEYS and never imports js/paths.mjs, so watchstate stays paths-agnostic). A
  dominance flip must (a) beat the incumbent's viability by `PATH_HYSTERESIS_MARGIN` to even ARM and
  (b) hold dominant for `PATH_PERSIST_MS` of wall-clock time to CONFIRM into the persisted
  `currentPath`; a flip back while arming DISARMS; a different challenger restarts the clock; no prior
  `currentPath` (first sighting / reset episode) adopts the dominant immediately. **HONESTY (rule 4):
  `PATH_PERSIST_MS` (8 min — deliberately 2× `ALERT_PERSIST_MS`: a path change is a bigger structural
  claim than an alert) and `PATH_HYSTERESIS_MARGIN` (0.05 viability) are NAMED PLACEHOLDERS** — they
  encode the shape of the whiplash guard, not calibrated magnitudes; P6's walk-forward per-item×path
  evidence (and F1's realized-outcome joins) is what would validate them.
- **`pathsStage()` + `renderPathLine()` (`pipeline/lib/context.mjs`)** — the chain's `paths` slice
  (PLAN.md: … position → validate → **paths** → render) and the renderer-family home. `pathsStage`
  derives the js/paths.mjs scoring ctx from the built namespaces (market row → regime/mom, history →
  phase + term-structure floor when present, position → underwater/BE/thesis), weighs the paths, runs
  the persistence gate off the shared `held:<id>` watch-state entry, and folds
  `currentPath`/`pathArmedKey`/`pathArmedSince`/`enteredUnder` ADDITIVELY into the position stage's
  `newStateEntry`. `enteredUnder` comes ONLY from the tracked hold-thesis entry (`thesis.mjs set
  --path`) — null when undeclared, never fabricated; the declared `path` seeds the INCUMBENT when the
  state file has no persisted path yet, so a declared plan can't be displaced without arm-then-confirm.
  `renderPathLine(ctx)` is the ONE shared dominant-path line: `path <cur> 0.62 · entered under <k> ·
  menu: …`; an arming challenger shows `<key> challenging (arming ~Nm/Pm)`; a CONFIRMED migration
  headlines as `path MIGRATED <enteredUnder> → <current>`. **Deviation from the spec's "P0's renderer
  becomes the dominant-path renderer", reported honestly:** `renderHeldVerdict`'s output strings are
  deliberately UNTOUCHED (the P0 byte-identity + P4a momVerdict pins stand); the path renderer ships
  as a SIBLING export in the same renderer module both surfaces consume — one home, no fork, verdicts
  stable.
- **Wiring** — `watch.mjs`: the held conviction loop runs `pathsStage` per lot (fresh on first-seen/
  reset, guarded like all state math) and the V5 note block gains field **4b (dominant path)** between
  recovery-read and the guaranteed sell line (emit contract order otherwise unchanged; sell line still
  ALWAYS last — `emit.test.mjs` extended). watch.mjs stays the ONE writer of the state file.
  `quote.mjs --positions`: builds the same stage read-only (P0 contract — it renders armed/current
  path state but never persists) and prints a `Paths (persistence-gated dominant per held lot)` block
  under the Conviction block. NO path-driven alert class exists (migration prominence is prose in the
  note/verdict area only; path-aware CANCEL-BID is P5). momVerdict/verdict strings byte-identical;
  fetch semantics unchanged on both surfaces.
- **Back-compat + fixtures** — watch-state schema change is additive: legacy `.cache/watch-state.json`
  entries (no path fields) load unchanged (`computeDeltas`/`advanceState` pinned byte-identical with/
  without the new fields) and establish their path on first pass. New `pipeline/pathpersist.test.mjs`
  (13 checks) pins the PLAN.md acceptance: flapping dominance never flips the persisted
  `currentPath`/headline inside `persistMs` (simulated tick sequences, both pure-gate and end-to-end
  through `pathsStage`+`renderPathLine`), a real migration arms → confirms → `MIGRATED` prose, the
  entered-under-`hold-recovery` decay-knife migrates toward the exit family (be-escape/cut) through
  the gate, hysteresis (a near-tie never arms), and the legacy back-compat. All 41 suites green;
  live smoke of both surfaces verified (path line renders identically on watch + quote off the same
  state; the P4a byte-identity and Gate-2-CUT-exempt fixtures untouched).
- **What would validate the placeholders:** enough migration events with realized outcomes to compare
  confirm-window/hysteresis settings against whipsaw-vs-lag cost — the P6 walk-forward replay over the
  Tier-1 archive + the suggestions×fills retro-join. Until then, treat the printed viabilities and the
  8-min/0.05 gate as shape, not signal.

### V2-P4a — Path engine core, pure (2026-07-08, pipeline-only — NO APP_VERSION)
The v2 verdict model stops being "item → one label" and becomes "item × THESIS → an action under that
thesis". A held lot can be, at once, a value-hold above its multi-week floor, a be-escape if you just
want your capital back, and a cut if the floor is eroding — each is a PATH, and the desk should show the
dominant one as the headline with the rest as a weighed MENU. This chunk builds the PURE core only
(persistence/migration wiring is P4b; declarative strategy specs are P4c).
- **New `js/paths.mjs`** — dependency-free, DOM-free, app-importable like `quotecore.js`.
  `enumeratePaths(ctx) → Path[]` returns the sensible candidate thesis-paths (held lots →
  hold-recovery/value-hold/be-escape/list-to-clear/cut; unheld candidates → scalp/value-hold/avoid —
  the union of the momVerdict verdict vocabulary + PLAN.md's path mentions, cast as first-class
  non-mutually-exclusive theses). `weighPaths(paths, ctx) → {dominant, weighed, enteredUnder, migration}`
  scores each by viability off the ALREADY-DERIVED context (regime/phase/underwater/aboveFloor/
  band-width) and sorts. Path shape = `{key, thesis, action∈BUY/HOLD/LIST/CUT/AVOID, levels, tripwire,
  horizon, economics, viability, evidence}`; alternatives are decision SUPPORT, never alert inputs.
  `migration` is the raw dominant≠enteredUnder flag (the arm-then-confirm persistence gate + hysteresis
  is P4b). **HONESTY (rule 4):** every viability weight is a NAMED PLACEHOLDER heuristic encoding only
  the SHAPE of the judgment (a falling decay-knife's hold-family MUST rank below its exit-family), NOT a
  calibrated magnitude — P6 replaces them with evidence-based, sample-sized viability. Pure + degrade-
  not-throw: an unprovable path floors to a LOW (never-zero) viability with a `no-data` evidence note;
  missing ctx never throws.
- **`holdthesis.mjs` generalized** — entries grow the additive optional `path` + `enteredUnder`
  (defaulting null); LEGACY entries written before P4a stay fully valid (load/lookup/prune never read
  them). A back-compat fixture pins that a legacy-shape entry round-trips byte-for-byte.
- **`thesis.mjs set … --path <key> [--entered-under <key>]`** declares the path-engine entry path into
  the TRACKED root `hold-thesis.json` (the path-carrying store js/paths.mjs reads `enteredUnder` off —
  NOT the gitignored session-thesis file, which stays free-text intent), preserving any existing plan
  fields; enteredUnder defaults to the path on first declaration and is preserved when the path later
  migrates.
- **`lotCtx` widened with an optional `path`** in `momVerdict` (`js/quotecore.js`) — PLUMBED THROUGH
  ONLY: no gate reads it, so a lotCtx carrying a path yields a BYTE-IDENTICAL verdict to one omitting it
  (pinned by a new "P4a INVARIANT" fixture mirroring the V3 invariant; the Gate-2-CUT-exempt contract is
  preserved verbatim). Wiring a verdict to the dominant path is deliberately P4b/P5.
- **Acceptance:** a decay-knife held lot (falling regime, decay phase, underwater, above the multi-week
  floor) ranks value-hold/hold-recovery LOWEST and the exit-family (cut > list-to-clear > be-escape)
  higher, with cut dominant; a genuine-dip counter-fixture (rising/basing) ranks a hold above the cut
  (proving the weights aren't trivially always-exit). New `pipeline/paths.test.mjs` (9 checks) +
  extended `holdthesis.test.mjs`/`quotecore.test.mjs`; all suites green via `run-tests.mjs`.

### V2-P3 — floorValidator + term structure off the Tier-1 archive (2026-07-08, pipeline-only — NO APP_VERSION)
The falling-exclusion amendment ("we cannot judge falling without an item's history and typical
fluctuations") gets its first concrete evidence read: a PURE multi-day **term structure** + a
BUY-side **`floorValidator`** on every buy surface.
- **New `js/termstructure.mjs`** (lives in `js/`, NOT `pipeline/lib/`, because `js/validate.mjs`'s
  floorValidator imports it and a `js/` module may not import `pipeline/lib/` — same home rule as
  `quotecore.js`/`windowread.mjs`). Pure DOM-free math over a daily-mid `[{ts,mid}]` series (the
  `loadDaily` regime proxy / the Tier-1 archive): the **1/3/7/14/28-day structure** (median/low/high +
  where the current level sits in each lookback's range), a **durable floor** (a low quantile —
  `FLOOR_QUANTILE` 0.15 — of the longest multi-week lookback with ≥ `FLOOR_MIN_POINTS`), and a
  **typical fluctuation** = the inter-quartile range of that lookback (IQR, so a single recent
  spike/decay doesn't inflate "normal"). A short/empty series degrades to `hasData:false` (never throws).
- **`floorValidator`** (registered in `js/validate.mjs`, BUY-side ONLY): rejects/cautions a buy that is
  NOT near the durable floor — it measures the buy level's distance above the floor in units of the
  typical swing (`> FLOOR_REJECT_RANGES` 2.0 → reject, `> FLOOR_CAUTION_RANGES` 1.0 → caution). The
  decay-knife shape (bid parked well above where the 14/28d structure says support prints) rejects; a
  genuine dip (bid at/below the durable floor) passes. A **HELD lot is a SELL decision → degrades to
  pass**, so it never touches a positions review; explicit asks / held / watchlist are never hidden.
- **Wired on both buy surfaces off data ALREADY at gate time — no fetch-semantics change.** `screen.mjs`
  feeds `floorValidator` the `daily[id]` regime-proxy series it already loads at gate time (reject DROPS
  the row + `--stats` + footer, caution flags it). `quote.mjs`'s per-item read (a buy-interest read)
  feeds it the **read-only** daily mids from whatever the archive already holds (new `loadDaily(…​,
  {noFetch:true})` — zero network; a flagged buy is a NOTE, the row is never hidden). `quote.mjs
  --positions` leaves it null by construction (held = sell side).
- **HONEST LIMIT (rule 4):** every threshold is a named PLACEHOLDER (the F1/P6 walk-forward study would
  tune them); the archive only began accruing 2026-07-08, so an item with little/no daily history
  DEGRADES to pass — a real reject needs a warm multi-week series. Verified live: it drew a `caution` on
  Masori body (buy 1.02× typical swing above the 28d floor) on `screen --mode band` and the same NOTE on
  a per-item `quote`, both exit 0. New `pipeline/termstructure.test.mjs` pins the math + the acceptance
  (decay-knife reject / genuine-dip pass / no-data + held-lot degrade, both surface ctx shapes);
  `pipeline/validate.test.mjs` re-pinned to the two-validator registry. The P1 replay goldens are
  UNCHANGED — `replay.mjs` drives the gate funnel (gateCandidates→surviveMode), not the validator DROP,
  so floorValidator does not touch its output.

### V2-P2 — Validate stage + reachValidator, every surface (2026-07-08, pipeline-only — NO APP_VERSION)
The Pipeline-v2 wave's per-surface gate differences (the quote-vs-watch verdict fork's third root) get
their shared home: a registry of PURE validators in **`js/validate.mjs`** — `(ctx) → {status:
pass|caution|reject, reason, evidence}` — run on EVERY surface so a screen, a per-item quote and a
positions review can't disagree on the same gate. Validators are PURE (no fetch/fs; pure math over a
caller-fed series is fine), NEVER throw, and DEGRADE to `pass` with a `no-data` note on missing input —
they only downgrade on affirmative evidence, never on the absence of data (the momVerdict precedent).
- **`reachValidator`** wraps `windowread`'s reach/touch scoring + the RC1 recency split: a candidate
  bid/ask the last ~14 same-window nights say is rarely reached → `caution`, never reached → `reject`
  (definitional out-of-range), and the RC1 stale-optimistic flag (full reach concentrated in an OLDER
  price regime the recent nights don't confirm) bumps severity one step — reusing `recencySplit`'s
  existing semantics, no new thresholds beyond named PLACEHOLDERS (`REACH_CAUTION_FRAC` 0.5, etc.).
- **`windowread.mjs` MOVED `pipeline/lib/` → `js/`** (byte-identical — proven by a same-sha `git mv`;
  the test suite re-pointed and green is the behavior proof) so it's node- AND app-importable like
  `quotecore.js`; imports updated in `windowrange.mjs`/`watch.mjs`/`lib/context.mjs` + the moved test
  (`pipeline/windowread.test.mjs`, now beside `quotecore.test.mjs`).
- **Wired into `screen.mjs` + `quote.mjs`** via the P0 context chain's intraday-stage reach extension
  point. Reject semantics (Ben-vetoable default): screens DROP `reject` (folded into `--stats` + a new
  `rejected: N (top-3 reasons)` footer, printed only when N>0) and FLAG `caution`; explicit asks / held
  / watchlist rows are NEVER hidden (a fired flag is a NOTE + a lean `validators` field on the
  suggestions ledger). **HONEST LIMIT:** `screen.mjs`/`quote.mjs` don't fetch the 1h series (no
  fetch-semantics change was allowed), so `reachValidator` DEGRADES to `pass`/no-data on both today —
  default output is byte-identical; the framework carried P3's whole-market `floorValidator` (shipped —
  it scores the patient BUY against the durable multi-week floor off the daily proxy already at gate time).
- `suggestionEntry` widened with a lean-included `validators` field (YS2 pattern — present only when a
  flag fired, so clean rows log byte-identically). New `pipeline/validate.test.mjs` pins registry
  semantics + the reachValidator fixtures (rarely-reached, never-reached, RC1 stale→reject, degrade).

### RC1 — recency split, the reach-contamination guard (2026-07-08, pipeline-only — NO APP_VERSION)
`windowrange.mjs`/`watch.mjs`'s flat full-window touched/reached COUNT lies on an item that changed price
REGIME inside the window — the count is dominated by stale, older-priced days. Two-sided, one bug (in both,
the stale days are the older higher-priced ones): an **ask** on a fallen/crashed item reads "reached 4/14"
where all four reaches are pre-crash (the blood-rune case: pre-crash highs 313–315, recovery tops 299–310,
so 313 is a fresh re-touch not an established sell); a **bid** on a repriced-up item reads "touched 14/14"
off old cheap days the floor has since left. Ben caught it live ("14/14 could also be because it's dropping,
like the nests") and again reading the runes. Fix: the pure `recencySplit()`/`recentQuant()` in
`pipeline/lib/windowread.mjs` print the **recent-3-night** hit rate + a `recent-3 ~50%` quantile beside the
full-window ones, and append **`⚠ stale`** when the full count is rosier than recent — a big fraction gap OR
the definitive case, recent hits it ZERO times while the full window shows a ≥20% rate (which catches a
partial-rate crash like blood rune's 4/14→0/3, a 0.29 gap under the fraction threshold). **Not a threshold
loosening** — the DHCB band-top-artifact SKIP is intact; this stops the *count* misdescribing a regime-change
item. Surfaces in `windowrange.mjs` (`--bid`/`--ask` lines + summary) and `watch.mjs`'s window line (compact
`⚠stale`). A stable item never flags (super-restore's real 14/14 ask, recent 3/3, stays silent — verified
live). Fixtures: `pipeline/lib/windowread.test.mjs` (both sides + stable-no-flag + thin-history-no-flag).

### GA1 — `.gitattributes` EOL normalization (repo-config only — NO APP_VERSION)
Makes line endings explicit (text sources `eol=lf`, the Windows `*.cmd` launchers `eol=crlf`, `*.png`
`binary`) so `core.autocrlf` no longer guesses and the recurring Windows "LF will be replaced by CRLF"
commit warnings stop. **Don't-rebuild:** the index already stored LF for every text file (working tree
was CRLF via autocrlf), so `git add --renormalize` was a no-op — `.gitattributes` only pins that behavior
deterministically; don't add a blanket `* text=auto` that could reclassify the single-line machine-JSON
outputs (`fills.json`/`positions.json`/`offers.json` have zero line-ending bytes and are left untouched).
Inventory entry: README's file registry.

### SR1 — `suggestions.jsonl` rotation/compaction (pipeline-only — NO APP_VERSION)
The O1 ledger grew unbounded in the DEPLOY ROOT (~3k rows/day). `pipeline/lib/suggestlog.mjs` now bounds
the active root file to the CURRENT calendar month: on every append `logSuggestions` calls `rotateLedger()`
(cheap first-line-month guard) which rolls each COMPLETED month out to
`pipeline/suggestions-archive/suggestions-YYYY-MM.jsonl`. **Don't-rebuild / the load-bearing rules:**
(1) rows are F1's calibration data — ARCHIVE, never delete; rotation writes each archive fully (dedup,
tmp+rename) BEFORE truncating the active file, so it's crash-safe + idempotent + zero-row-loss; (2) any
FULL-HISTORY reader (`outcomes.mjs`'s F1 join) MUST read active + archives via the shared
`readSuggestionLines` — reading the active file alone silently halves the calibration set after the first
rotation; (3) the active-ledger path stays REPO-ROOT, pinned by `pipeline/lib/suggestlog.test.mjs` (SL1) —
only history relocates; don't re-relativize `LEDGER`. `sync-fills.mjs` commits the archive dir alongside
`suggestions.jsonl`. Note: as of landing, 100% of rows are the current month, so the first rotation is a
no-op — the first real archive fires at the next month boundary. Fixtures:
`pipeline/lib/suggestlog.test.mjs`. Full story: `FILLS-PIPELINE.md` §11.1.

### TG1 — Thesis-gated hold alerts, silence expected-underwater (2026-07-07, pipeline-only — NO APP_VERSION)
A patient/accumulation hold is DEFINITIONALLY underwater on the instant-clear from the moment its bid fills,
so the `UNDERWATER`/`CUT-CANDIDATE` headline cried wolf every pass (Ben: "tired of being told I'm underwater
when that's the plan"). The fix lives in the ALERT gate, NOT the verdict core. **Don't-rebuild / the
load-bearing rules:** (1) `momVerdict()` (`js/quotecore.js`) is UNTOUCHED — the verdict still SAYS underwater
(honest); only the *headline* is gated. (2) The thesis branch lives in `convictionGate()`
(`pipeline/lib/watchstate.mjs`) — a declared thesis with a numeric tripwire, live ABOVE the tripwire → ARMED
note (`per thesis: silent above X…`), no headline; live at/below the tripwire → falls through to the normal
V4/V7 escalation (real risk headlines). (3) The **Gate-2 breakdown `CUT` stays EXEMPT** — checked BEFORE the
thesis branch, a real breakdown is NEVER silenced (`LIST-TO-CLEAR` is also excluded from the silence). (4) The
store is AGENT-WRITTEN like the greenlist — TRACKED root `hold-thesis.json` (`{id,exitPrice,tripwire,horizon,
ts}`, 14-day TTL), read via `pipeline/lib/holdthesis.mjs`, watch READ-ONLY; when Ben declares a hold plan the
agent appends/upserts an entry (`upsertThesis`). No thesis / empty store → byte-identical to today (opt-in,
safe-degrade). Fixtures: `pipeline/lib/holdthesis.test.mjs` + the TG1 block in `pipeline/watchstate.test.mjs`.
Full story: `MONITORING.md` "What each tick surfaces" item 1 (the THESIS-silence bullet) + the `holdthesis.mjs`
header.

### PM2 — Probe firing logs wired (2026-07-07, pipeline-only — NO APP_VERSION)
PM1 defined the per-probe `pipeline/modules/<name>.log` firing-log convention but left it UNWIRED; PM2 wires
the writes so the validate-before-promote data accrues. `logFirings(fired, meta)` (`pipeline/lib/modules.mjs`)
appends ONE compact JSONL line per fired annotation —
`{ts,module,version,stage,surface,id,name,tag,price(price-stage only),quickBuy,quickSell,guide,regimeLabel,phase}`
— enough to SCORE the firing later without re-fetching; `version` is the probe's DECLARED version (looked up
from the loaded set). Called EXPLICITLY by `screen.mjs` renderMode + `quote.mjs` runItems right after their
`runProbes` calls. **Don't-rebuild / the load-bearing rules:** (1) `runProbes` stays PURE — logging is a
separate explicit call, never folded into the runner; (2) **failure-safe** — every write is try/caught +
swallowed, a broken log can NEVER break a render; (3) **byte-identical stdout** — logging adds NO output change
(the Probes column is untouched); (4) no firing ⇒ no write ⇒ no file. SCORING (hit/miss) is deliberately a
LATER chunk — PM2 only accrues. Fixtures: the FIRING LOG block in `pipeline/modules.test.mjs`. Full story: the
`pipeline/lib/modules.mjs` header (FIRING LOG) + README's probe-modules inventory entry.

### PM1 — Probe-module system, theory-testing plug-ins (2026-07-07, pipeline-only — NO APP_VERSION)
A pluggable way to trial a per-item market THEORY, see it in a dedicated stdout `Probes` column, and DELETE it
in one `rm`. `pipeline/lib/modules.mjs` is the LOADER + stage-keyed runner: it auto-discovers
`pipeline/modules/*.mjs` (presence = enabled), groups probes BY STAGE (`observe` → `{tag,note}`; `price` →
`{price,reason}`; `gate` future), and `runProbes(row,surface,ctx)` returns the fired annotations. screen.mjs +
quote.mjs append a `Probes` column ONLY when a probe fires. **Don't-rebuild / the load-bearing invariants:**
(1) the **empty-passthrough guarantee** — no module present OR none fire ⇒ `[]` ⇒ nothing appends ⇒
**byte-identical** output — that IS the removability contract, never break it; (2) **NO probe of any stage feeds
a verdict/gate/rating/reconstruction** — observe probes touch NO number, price probes touch ONLY the advisory
recommendation; (3) the `Probes` column is **stdout-only**, deliberately NOT in the published
`screen.json`/app (an app Probes column bumps APP_VERSION — a separate later step). Four seed probes: **dip**
(the migrated ex-`screen.mjs` `⬇DIP` prototype — same gates), **froth** (spike/rising knife-vs-healthy
classifier off `phase().lowSlope`), **anchor** (the `price`-stage round-number nudge, proving both output
shapes), **decant** (MULTI-ITEM — reads dose siblings off the whole-market 24h map `ctx.v24all` and declares
them via `needs(row,ctx)`; screen-only). Watch surface + owned dip-inversion (average-down) are the deliberate
follow-on. A firing is DATA to score, never a validated edge (rule 4). Fixtures: `pipeline/modules.test.mjs`.
Full story: the `pipeline/lib/modules.mjs` header + README's probe-modules inventory entry.

### MERCH-book quarantine — `ignored-items.json` + greenlist (2026-07-07, pipeline-only — NO APP_VERSION)
Items Ben transacts but doesn't flip (farming inputs, loot, personal-use) are quarantined from the DERIVED
merch views. **Don't-rebuild / the load-bearing rule:** `pipeline/lib/ignored.mjs` `quarantineEvents` filters
the `reconstruct()` INPUT only — `fills.json` stays the FULL merged audit (never delete an ignored item's
events; it's a VIEW filter). Intent isn't in the log, so an ignored item is quarantined BY DEFAULT and a
specific transaction is surfaced as a real flip ONLY via a `greenlisted` entry matched on id+price(±3%)+ts(±6h).
**The greenlist is agent-written:** when you recommend a flip of an ignored item and Ben confirms qty+price,
APPEND `{id,qty,price,ts,consumed:false}` to `ignored-items.json`'s `greenlisted` array (Ben only flips these
on a rec, so that gate catches every legit flip). Wired in `sync-fills.mjs` (positions/offers) + `lib/offers.mjs
activeOffers` (watch); real-log validated snapdragon 6→0 entries with realised P/L byte-identical. Fixtures:
`pipeline/ignored.test.mjs`. Full story: the `pipeline/lib/ignored.mjs` header + README's `ignored-items.json`
inventory entry.

### V5 — watch.mjs per-held EMIT CONTRACT (pipeline+docs only — NO APP_VERSION)
The pure `heldNoteBlock()` in `pipeline/lib/emit.mjs` (fixture-pinned `pipeline/emit.test.mjs`) makes each held
lot's note block ONE stable, consistently-ordered shape: `verdict · conviction-state (V4 armed) · Δ-since-last
(V1) · structural tripwire (V2) · sell/list-at (+ break-even) · fill-progress`. **Don't-rebuild / the
load-bearing rule:** the **sell/list-at + break-even line is ALWAYS emitted on a held lot** (`sell: list @ X ·
break-even Y · ask n/m`), guaranteed even if the optional context fields fail to compute — Ben's standing rule
(2026-07-06): always state the sell price for every held item, since a fill you didn't see may have happened.
`heldListAt` prefers the shared momVerdict `listAt`, else the band-top-floored-at-BE fallback — never re-fork
that. OUTPUT-FORMAT-ONLY (no verdict/alert/row-selection change). Full state: PLAN.md V5 row, `MONITORING.md`
"What each tick surfaces" (the emit-contract block).

### V7 — Cadence-independent alert gating, TIME-based arm-then-confirm (pipeline-only — NO APP_VERSION)
`convictionGate()` (`pipeline/lib/watchstate.mjs`) now escalates on **elapsed WALL-CLOCK time a condition has
persisted** (`ALERT_PERSIST_MS`, 4-min placeholder), NOT a pass count. **Why:** a pass-count threshold made a
faster /loop manufacture faster alerts — at 1-min cadence "2 consecutive passes" was 2 min of noise; a choppy
market checked every minute produced flicker headlines. Time-gating makes sensitivity independent of cadence.
**New:** `LIST-TO-CLEAR` (a 2h-momentum breakdown, previously UNGATED — it headlined every ↓ pass) is now
arm-then-confirmed too: a single-pass flicker only ARMS; it headlines only once the breakdown HOLDS ≥
`ALERT_PERSIST_MS`. Persistence is measured from `underwaterSince`/`belowSupportSince`/`breakdownSince`
timestamps in the watch-state. **Don't-rebuild / invariant preserved:** the **Gate-2 breakdown `CUT` stays
EXEMPT — immediate, never time-gated** (pinned by an "immediate regardless of elapsed time" fixture); note
`LIST-TO-CLEAR` also carries `gate:2` but its verdict is `LIST-TO-CLEAR` not `CUT`, so it is gated, not exempt.
`watchstate.test.mjs` pins the time-based gate + a cadence-independence fixture. Full state:
`pipeline/MONITORING.md` "What each tick surfaces" item 1.

### V4 — Conviction gating, arm-then-confirm alerts (pipeline-only — NO APP_VERSION)
(The pass-count thresholds here were SUPERSEDED by V7's time-based gating above — read that first.) The pure
`convictionGate()` in `pipeline/lib/watchstate.mjs` gates whether a held verdict escalates to a headline ⚠ ALERT
in `watch.mjs` (verdict strings UNCHANGED; `js/quotecore.js` untouched). A Gate-D `CUT-CANDIDATE` needs the
underwater condition to persist (V7: ≥ `ALERT_PERSIST_MS`; was 2 passes) to alert; a structural break needs the
V2 tripwire convincingly broken (`< cut-trigger`) OR below support persisted. First observation → ARMED (a
visible note, not a headline). **Don't-rebuild / invariant:** the **Gate-2 breakdown `CUT` is EXEMPT — it alerts
immediately, byte-identically** (pinned by an "immediate regardless of conviction" fixture); never gate it. Full
state: `pipeline/MONITORING.md` "What each tick surfaces" item 1.

### V6 — Verdict self-sufficiency, recovery-read forecast + capital companion (pipeline-only — NO APP_VERSION)
The last chunk of the V1–V6 verdict-layer series (`PLAN-VERDICT.md` folded into `PLAN.md` + deleted) — two
ADVISORY, OUTPUT-ONLY surfaces in `watch.mjs`, neither a verdict/alert input (`momVerdict`/`offerVerdict`/
`convictionGate` untouched — the breakdown-cut invariant holds trivially). (1) The pure
`pipeline/lib/recovery.mjs` COMPOSES momVerdict's existing signals (`diurnalRead` seasonal · `regimeLabel`/
`phase` trend · `underwaterHours` persistence · position vs the V2 support) into a recover-vs-drop LEAN
(`likely-recovers`/`likely-drops`/`uncertain` + drivers), surfaced as `recovery-read: …` ONLY on a non-clean
position (underwater / thin-margin / unfilled ask / `BID-BEHIND` bid / lean-conflicts-verdict) and silent on a
cleanly-good one. **Don't-rebuild / honesty:** it's a LEAN not a probability, and `phase==='spike'` CAPS it to
`uncertain` (blind to a repricing) — never wire it into a verdict/alert. (2) The pure `pipeline/lib/capital.mjs`
detects capital freed by a booked SELL between passes (a held lot's qty dropped, off V1's prior-pass state) and,
≥ `FREED_CAPITAL_SCAN_GP` (5m placeholder), surfaces a `⋯ freed ~X — consider a scan to redeploy` prompt —
surface-only, never auto-places/runs the scan; a fresh/stale-gap prior yields no misfire. Fixtures:
`pipeline/recovery.test.mjs` + `pipeline/capital.test.mjs` (22 suites).

### YA1 (0.53.0) — in-app capital-utilization line (Watch tab; the yield program's #5)
The one honest, self-contained app surface from the PLAN-YIELD program's #5 (app surfacing). The
Watch tab summary gains a **Utilization** cell — working (held inventory, able to profit) vs parked
(capital tied up in resting UNFILLED buy bids) — computed client-side from data the tab already has
(`positions.json` exposure + `offers.json` buy bids). The pure `capitalSplit()` lives in
`js/watchcore.js` (fixture-pinned in `watchcore.test.mjs`), mirroring pipeline `lib/capitalutil.mjs`
`bookUtilization` (a tiny parallel so the browser needs no node-only import). Shown ONLY when capital
is actually parked (a clean book is trivially 100% working → noise); a low % renders amber (idle
capital is a yield leak). Display-only, never a verdict input. The `.wsummary` grid moved to
`auto-fit` so 4 or 5 cells both lay out cleanly.

**Deliberately NOT built (validation-gate honesty):** the two headline #5 features — in-app
fill-probability and the Trends "recommend price adjustment" button — stay DEFERRED. Both depend on
**F1 calibration (still GATED)** and on a **published outcomes artifact the app doesn't fetch**;
surfacing a fill-probability the model hasn't earned would violate the program's entire honesty
discipline. Console-first stays the intentional design. Full program story: `PLAN-YIELD.md`.

### Trajectory phase() classifier + opt-in basing-rescue (pipeline-only — NO APP_VERSION)
`computeQuote` already fetches a ~21-day 6h series (`ts6h`) per candidate and runs `regimeDrift` over
it, so the multi-week price history is ALREADY in hand — this adds a richer *trajectory-shape*
classifier over the SAME data with ZERO new network fetches. `regimeDrift`/`regimeLabel`
(flat/rising/falling) stays the untouched gate driver; `phase()` is complementary observational
enrichment.

- **Part A — `phase(points)` in `js/quotecore.js`** (next to `regimeDrift`/`regimeLabel`, reusing the
  same `mid(p)` idiom + the private `med()` helper). Returns `{ phase, curMid, baseMid, peakMid,
  lowSlope }` with `phase ∈ 'base'|'spike'|'decay'|'basing'|'unknown'`. Derived quantities mirror
  `regimeDrift`'s timestamp-window style off `tEnd = last timestamp`: `curMid` = median mid over the
  last `PHASE_CUR_DAYS` (2); `baseMid` = median mid over the OLDEST portion (`ts ≤ tEnd −
  PHASE_BASE_LOOKBACK_DAYS·86400`, 14d) = the pre-spike base; `peakMid` = max mid over ALL points +
  `peakRecent` (peak within `PHASE_PEAK_RECENT_DAYS`=6); `lowSlope` = fractional first-day→last-day
  change of the per-LOCAL-day min `avgLowPrice` over the last `PHASE_RECENT_LOW_DAYS` (4). Ordered
  classification: elevated (`cur ≥ base×(1+PHASE_SPIKE_PCT`=0.08`)`) + recent peak → `spike`; else
  pulled back off a recent peak (`cur ≤ peak×(1−PHASE_DECAY_FROM_PEAK_PCT`=0.08`)`) with lows still
  falling (`lowSlope < −PHASE_LOW_FLAT_PCT`=0.02) → `decay`, or lows flattened
  (`|lowSlope| ≤ PHASE_LOW_FLAT_PCT`) → `basing`; else `base`; `<2` points / no cur-or-base level →
  `unknown`. **All thresholds are NAMED PLACEHOLDERS pending validation** (same discipline as the
  `rating.mjs` grade cutoffs) — do not cite them as calibrated. `regimeDrift`/`regimeLabel` are
  untouched and regression-guarded in the test.
- **Part A display (`pipeline/screen.mjs`)** — `renderMode` calls `phase()` on the SAME `ts6h` each
  row was quoted from (a new `series6h` map alongside the existing `series5m`) and FOLDS an
  informative phase into the existing Regime cell (`Rising +77% · spike`, `Flat -8% · basing`). NO new
  column — the canonical width/contract is intact; `base`/`unknown` add nothing. This is display-only
  and does NOT change which rows are gated in/out. It mutates only the per-call `stdCells` copy, never
  the shared `row` model.
- **Part B — `--phase-rescue` (OFF by default; default output byte-identical)** — when set, an item
  the falling-exclusion would normally DROP but whose `phase()==='basing'` is instead SURFACED, its
  Regime cell noted `· basing after decay — provisional`, its grade CAPPED at `PHASE_BASING_GRADE_CAP`
  (`B`) by reusing `rating.mjs`'s already-exported `capGrade` (NO `rating.mjs` change), and a
  provisional tooltip on the Grade cell. `--stats` reports a `basing-rescued N` count. Deliberately
  minimal/conservative — a gated trial, not a default behavior change.
- **Tests (`pipeline/quotecore.test.mjs`)** — a `phase()` block (synthetic 6h fixtures only) pins
  `base`/`spike`/`decay`/`basing`(the DWH anchor)/`unknown`, plus a regression assertion that
  `regimeDrift`/`regimeLabel` still label an existing-style fixture. All 17 suites stay green (27
  checks in this file).
- **NO APP_VERSION bump:** `phase()` lives in the shared `quotecore.js` but is consumed ONLY by the
  pipeline `screen.mjs`; the deployed app imports nothing new (`grep phase js/` finds only the
  definition) and renders byte-identically — allowed to ship without a bump per process rule 5.
- **Docs handled separately (to avoid a same-file edit race):** the `CLAUDE.md` "Regime" doctrine line
  and the `/scan` SKILL.md phase documentation are being reconciled by a concurrent skills edit + a
  human follow-up, NOT in this change's four-file set.

### Daemon liveness heartbeat — split "watcher live" from "book synced" (0.51.0, LW3)
The localhost freshness stamp conflated two different facts and produced a false "is the watcher
running?" alarm during quiet trading. The stamp was derived entirely from `positions.json`'s
`generatedAt` (`STATE.fillsTs`) — but the `watch-log.mjs` daemon only rewrites `positions.json`
when the BOOKED positions change (a fill). During a no-fill stretch `positions.generatedAt`
legitimately freezes, so the stamp looked dead (and warned "no update in 10+ min; is the watcher
running?") even though the daemon was alive and watching. The daemon is purely event-driven
(`fs.watch`, no polling fallback), so there was NO signal that measured daemon liveness independent
of book changes.

The fix adds a real heartbeat and separates liveness from book-change:
- **Daemon (`pipeline/watch-log.mjs`):** a `setInterval` (`HEARTBEAT_MS`, 30s) — plus one write at
  startup — writes a tiny root `heartbeat.json` (`{app:'the-coffer-heartbeat', generatedAt:<ISO>}`)
  via `fs.writeFileSync` in a try/catch (a heartbeat failure never crashes the daemon). It does
  **ZERO git and ZERO log re-read** — pure liveness, regenerating nothing; explicitly NOT the
  "polling fallback" the plan avoided. It lands at the repo ROOT (new: `watch-log.mjs` imports the
  now-exported `REPO_DIR` from `sync-fills.mjs`, honoring the same `--repo-dir` override the
  `regenerate()` call uses) so the same-origin serve can fetch it. `heartbeat.json` is gitignored
  (never committed/pushed), so the FILLS-PIPELINE §12 "no unattended writer to `main`" invariant is
  preserved.
- **App (`js/ledger.js`, localhost-only):** `pollLocal` now also fetches `heartbeat.json` (new
  `fetchHeartbeat`, seeded in `startLocalPoll` alongside `fetchOffers`) into `STATE.heartbeatTs`
  (new on the STATE object, `js/state.js`). `renderLocalStamp` now shows TWO facts: **`watcher live
  hh:mm`** from the heartbeat (older than `HEARTBEAT_STALE_MS` = 90s → red "watcher down? — restart
  node pipeline/watch-log.mjs", `.warn` class) — THIS line carries the liveness warning; and
  **`book synced hh:mm · N open offers`** from `STATE.fillsTs`, which NO LONGER warns on age (a
  frozen book is normal when trading is quiet). The old 10-min book-age warning (`LOCAL_STALE_MS`)
  is removed. The deployed origin (`bensumm.github.io`, `IS_LOCALHOST` false) path — the M1 re-fetch
  banner + Refresh-positions button — is byte-identical; all heartbeat logic lives inside the
  localhost-only branch.

### Suggestlog path regression fix (SL1, pipeline-only — no APP_VERSION bump)
OR2 moved `suggestlog.mjs` from `pipeline/` into `pipeline/lib/` but left its ledger path as
`HERE/'..'/suggestions.jsonl` — correct from the old location, but from `lib/` it resolves to
`pipeline/suggestions.jsonl`. Every market read from OR2 onward (2026-07-05 10:21→15:39, 351
rows) appended the O1 suggestions ledger — the accrual dataset the F1 algorithm-feedback gate
is waiting on — to that untracked fork while the tracked repo-root file sat frozen. Found when
Ben questioned a cleanup recommendation to delete the "orphan" (the first-pass review had
misread `HERE/..` as repo root); the near-miss is the lesson — **verify a file is dead by
proving what writes it, not by checking what reads it.** Fix: path now two levels up (exported
as `LEDGER`), the 351 stranded rows folded back into the tracked ledger in ts order, and new
`pipeline/lib/suggestlog.test.mjs` pins the resolved path to the repo root (plus the
never-fabricate-numbers entry contract and the liqClassOf thresholds). 17 suites. One
follow-through at merge time: rows the desk writes to the forked path before it pulls this fix
get folded the same way, then the stray file is deleted.

### Trends analytics extraction + gate-stack extraction (0.50.0 TC1; GC1 pipeline-only, no bump)
Two Wave-7 testability extractions, both pure MOVES with behavior held byte-identical (the TD2
precedent: make a decision-bearing function node-importable so its real rules get a committed fixture,
without changing them).

**TC1 — `js/trendcore.js` (0.50.0).** The pure, DOM-free analytics behind the Trends view — everything
from `bestWindow` / `analyseHourly` / `analyseBroad` / the `seasonalFactors`→`hourFactors`→`factorStats`
decomposition through `buildPlan`, `patientTargets`, the walk-forward `dayGroups`/`backtestPlan` gate,
and `planSignal` (plus `median` and the `sideVal`/`localDayKey`/`hourOf` helpers) — was living
DOM-pinned in `js/trends.js` (which imports charts.js/ui.js/main.js at load), so the money-affecting
`backtestPlan` gate and `patientTargets` sizing had NO test. Moved wholesale into node-importable
`js/trendcore.js` (its only imports are node-safe `format.js` tax/netMargin and `quotecore.js`
regimeDrift); `trends.js` re-imports the six it renders (`analyseHourly`, `analyseBroad`, `buildPlan`,
`patientTargets`, `backtestPlan`, `planSignal`). The Trends tier-structure doctrine header stays in
`trends.js` where its editors look. New `pipeline/trendcore.test.mjs` (19 checks) pins: the walk-forward
gate (insufficient-days path + a clean 10-day diurnal cycle where buying the cheap window / selling the
rich one beats naive spread-flip every out-of-sample day, `edge === stratRoi − spreadRoi`), patient vs
falling offer sizing (20th/80th vs 10th/clear-at-instabuy percentiles), the seasonal detrend (a 2× price
day yields identical hour factors), volume weighting, corrupt-print trimming, and `median`/`bestWindow`
edges. No behavior change — a straight move; `APP_VERSION` → 0.50.0 because it touches deployed files.

**GC1 — `gateCandidates` thresholds-as-argument (pipeline-only, no bump).** `screen.mjs`'s pre-fetch
candidate gate stack was a module-scoped function closing over the CLI-derived constants (FLOOR,
MIN_ROI, GP_FLOOR, MIN_GPD, the rising-pool floor, …), so it couldn't be fixtured. GC1 exports it as
`gateCandidates(mode, ctx, thresholds = THRESHOLDS)` — every constant it used is now a named field of
the `thresholds` object; `main()` passes a `THRESHOLDS` object built from the same CLI values, so stdout
is byte-identical for every mode/flag. New `pipeline/gatecandidates.test.mjs` (8 checks) drives the whole
stack with synthetic 24h/band data: two-sided liquidity, gp-flow big-ticket `thin` admission, the 500k
attention floor + the thin exemption, the rising-pool noise floor (big-ticket OR liquid, rising-mode
only), a traded-band requirement, and the price window. **Boundary honestly documented:** falling-
EXCLUSION and rising-CONFIRM are NOT in `gateCandidates` — they run post-fetch in `renderMode` off the
real `computeQuote` row — and held/asked/watchlist exemptions bypass the gate stack entirely (the S3
watchlist path), so they're out of this function's scope and not fixtured here. Runner now discovers
16 suites; no `checks.yml` edit (auto-discovery).

### Exchange-log hardening — impossible-transition validation + restart-blindness warning (LH1/LH2, pipeline-only, no APP_VERSION bump)
**Origin (Ben, 2026-07-05):** "we've had a ton of problems with the log discrepancies… missing bids,
phantom bids." A live-session catalogue found four failure classes; two were already fixed (the
EMPTY-burst phantom-cancel inference was deleted 2026-07-05; the stale-positions basis is solved by
LW1's `watch-log.mjs`). This is the remaining two. **Pipeline + docs only — no deployed-app change,
so no `APP_VERSION` bump.**

**LH1 — slot-state validation in reconstruction.** A GE slot is a state machine: a terminal event
(BOUGHT/SOLD/CANCELLED_*) closes it, so a SECOND terminal on the same slot with NO placement/progress
line between is IMPOSSIBLE unless the plugin re-emitted a stale slot state after a relog (the burst of
simultaneous EMPTY lines on the OTHER slots is the tell). On 2026-07-05, 13:25:53 and 13:29:01 both
logged `BOUGHT` item 13263 qty 1 @17,401,000 on slot 7 — only one buy was real.
- New exported pure `validateSlotTransitions(events)` in `pipeline/lib/reconstruct.mjs`, run at
  INGEST (next to `buildEvents()`, BEFORE the `fills.json` merge) in `sync-fills.mjs` `regenerate()`
  and in `monitor.mjs`. Walking each GE slot's event subsequence in ts order, when a terminal follows
  a terminal on the same slot with nothing re-opening it between: if STRICTLY identical to the prior
  terminal (`sameTerminal`: item+type+qty+price+filled+spent) it is a provable re-emit → **DROPPED
  LOUDLY** (a `console.warn` per drop with item/qty/price/slot + the prior terminal's ts, plus a
  dropped-count in the sync summary line) and, because it runs pre-merge, it **never enters
  `fills.json`**. Conservative: any differing field → warn but KEEP (fail toward preserving data);
  manual slots 8/9 (no GE state machine) are exempt entirely. This does NOT resurrect the deleted
  cancel-to-EMPTY inference — EMPTY lines are consumed by `buildEvents()` and never reach here, so
  absence is still never evidence; only two REAL terminals trigger it.
- The loud warnings are gated (`warn:false`) in the frequently-re-run callers — the `watch-log.mjs`
  daemon, `sync-fills.mjs --local`, and `monitor.mjs` — which re-read the whole log every run and
  would otherwise re-print months-old historical re-emits every tick; the attended sync stays loud.
- `dedupeSnapshots()` (P1) remains the SILENT DERIVATION-LAYER BACKSTOP inside `reconstruct()`, using
  the same discriminator, so a phantom ALREADY persisted in an older (pre-LH1) `fills.json` — which the
  ingest validator never re-reads — is still dropped from the derived `positions.json`. Don't merge the
  two layers: ingest (loud, keeps the archive clean going forward) vs derivation (silent, cleans history).
- **Real-log acceptance:** re-running the reconstruction over the live logs into a temp dir dropped
  **17** identical same-slot re-emits (incl. the known 13:29 bludgeon), each warned, and produced a
  `positions.json` byte-identical (modulo `generatedAt`) to the committed one — confirming the drops
  were already what the silent backstop did; LH1 only makes them visible and keeps them out of the
  archive. Fixtures in `pipeline/validateslots.test.mjs` (the verbatim 13:29 case, the real-repeat
  case with a placement between, a near-duplicate differing price → kept, manual slots exempt, P/L
  parity, and a REMOVE tombstone still purging a surviving event).

**LH2 — restart-blindness warning line.** After a client restart the Exchange Logger (emit-on-change)
re-emits nothing until each slot next changes, so `monitor.mjs`/`watch.mjs` read resting offers as
missing (NOT LISTED / no active bids) for minutes-to-hours — root cause is the plugin, not fixable in
reconstruction, but detectable.
- New pure `blindWarningLine()` + `BLIND_STALE_MIN` in `pipeline/lib/logblind.mjs`, wired into both
  `monitor.mjs` and `watch.mjs` headers. **Chosen heuristic (self-contained, documented in the file
  header):** fire when the newest exchange-log line is stale (≥20m) AND the log shows ZERO active
  offers AND you hold open inventory (>0 lots) — the exact post-restart blind state, and very unlikely
  otherwise (an idle desk fails the inventory gate; a live log fails staleness; a log showing your
  offers fails the zero-offers gate). Deliberately avoids fragile RuneLite `launcher.log`/`client.log`
  mtime parsing (client.log is rewritten continuously while running). Honest limitation, documented: it
  can't see a blind state where you hold no inventory but only resting bids. No behavioral change — the
  header line is the whole deliverable; verdicts/annotations are untouched. Fixtures in
  `pipeline/logblind.test.mjs` (pure line assembly only, not the filesystem probe).

**Docs (LH3):** `FILLS-PIPELINE.md` §5.1 + §10 name both artifact classes and the two-layer validator
and reconcile the "append-only truth" phrasing (the log is an archive of REAL events, not unfiltered
truth); `MONITORING.md` documents the blindness header line; the `reconstruct.mjs` P1 comment is
reconciled to "silent backstop." Test suite: 14 suites green via `node pipeline/run-tests.mjs` (adds
`validateslots.test.mjs` + `logblind.test.mjs`).

### Watch tab — the at-a-glance flipping desk (0.49.0)
**Origin (Ben, 2026-07-05):** an approved HTML mockup (`WATCH-TAB-MOCKUP.html`, since deleted — recover via git history) — a verdict-first desk surface that
turns the data LW1/LW2 made live at the desk (held book + offers) into a single glance: *what do I
hold, what wants action, what's resting, what filled today.* Built exactly to the mockup, with the
tweaks Ben pre-approved.

**What shipped:**
- **A new `Watch` tab** rendered by `js/watch.js`, top-to-bottom: (1) three freshness stamps (prices
  live / held book synced / offers as-of-sync — staleness is always stamped, never hidden); (2) a
  4-cell summary strip (Exposure = deployed capital · Day P/L = today's realised · Free capital =
  bankroll − deployed · Alerts); (3) **held positions** as one verdict-first card per flip lot —
  severity stripe (green HOLD / amber WATCH / red CUT) + a `momVerdict()` pill + momentum glyph +
  a right-aligned P/L-at-action figure + a 4-col data grid (Held @ / Break-even / Quick sell or
  Target ask / Regime) + a dashed action line + a **session-context note**; incidental inventory
  (sub-100k lots) collapses to one muted line; (4) **active offers** from `STATE.offers`, each a flat
  verdict-tagged row (BID-OK / BID-BEHIND / CROSSING / CANCEL-BID for bids, LISTED for asks) with a
  fill-progress bar, behind an amber staleness banner (the browser can't read the exchange log —
  offers are as-of-last-sync; held quotes above are live); (5) today's fills feed from `fills.json`.
- **Shared verdicts, not reimplemented.** Held cards call the shared `momVerdict()`; the bid decision
  was extracted from `pipeline/watch.mjs`'s inline `bidVerdict` into a new pure `offerVerdict(row,
  offerPrice)` in `js/quotecore.js`, and `watch.mjs` now routes its `bidVerdict`/`bidAlert`/`bidAction`
  through it — **byte-identical console output**, and a bid now reads identically in the terminal and
  the browser (the `momVerdict` precedent). Break-even is the shared `breakEven()`; the momentum glyph
  is `momCell()`. No tax/quote/verdict math is duplicated.
- **The tweaks (Ben-approved):** (A) session-context notes are **editable in place** (✎ → inline input;
  empty → "+ add context…"), persisted per item under `watchnote:<id>` via the app's `sSet`/`sGet`;
  their contents are **never logged** (L1). (B) the bid logic is **shared, not forked** (above). (C)
  pure derivations live in node-importable `js/watchcore.js` (verdict→stripe family, alert count,
  flip/incidental split, today's-fills feed + after-tax net, summary aggregates) and are fixture-tested
  in `pipeline/watchcore.test.mjs` (12 checks incl. `offerVerdict`'s gate order). (D) **Alerts =
  CUT-family held verdicts (CUT / CUT-CANDIDATE / LIST-TO-CLEAR) + CANCEL-BID offers** — the tab badge
  (red when >0) and the summary cell share the one count. (E) data sources reuse what the app already
  has: held book from `positions.json` via `syncFills`, offers from `STATE.offers` (LW2), today's fills
  from same-origin `fills.json` filtered to the LOCAL day, and Day P/L's after-tax net comes from the
  matched `positions.json` close (fills.json alone has no profit) — an unmatched sell honestly shows a
  blank net.
- **Naming:** the pre-existing **Watchlist** tab used the id `watch`; it was renamed to id `watchlist`
  (routing + panel id only; `watchTable`/`watchBadge`/`renderWatch` unchanged) so the new tab could
  take `watch` (matching the pipeline's `watch.mjs` concept, and the smoke test's existing `watch`
  entry). `pipeline/smoke.mjs` now enumerates 8 panes (`watchlist` + `watch`) and asserts both render
  non-empty under stubs.
- **Refresh model:** the market re-quote loop runs **only while the tab is visible** (started in
  `switchTab`), reusing marketfetch's cached `ts`/`24h` store — a light refresh, not a new data poller.
  One background pass fires at init so the alert badge is live before the tab is first opened.

Verified with a headless Playwright pass against the real committed `positions.json`/`offers.json`/
`fills.json`: two flip cards (Basilisk jaw → HOLD green, Serpentine helm → CUT red), the Soul-rune
incidental collapsed, offers rendered with a BID-BEHIND bid, today's fills fed, badge = 1, and the note
round-tripping through localStorage — no console errors. APP_VERSION → 0.49.0.

### Local log-watcher — desk-side freshness without an unattended writer (0.48.0, LW1/LW2)
**Origin (Ben, 2026-07-05):** "Can we have some process watch the log file and automatically sync?"
The obvious build — a daemon that auto-commits/pushes on every change — would reintroduce exactly the
**unattended writer to `main`** that §12 (schedule elimination, G1) deleted to unblock the PR + `checks`
protection. So we took **option 1**: regenerate locally on every log change, **never** commit or push.
The daemon does **zero git**; publishing to Pages (and the phone) stays attended and on-demand, so the
§12 invariant is preserved intact — the phrasing was tightened everywhere to "no unattended writer *to
`main`*", which a local-file-only daemon does not breach.

**LW1 (pipeline-only, no APP_VERSION bump):**
- The reconstruction core is extracted from `sync-fills.mjs`'s `main()` into an exported, git-free
  `regenerate({ write, logDir, repoDir })` — reads exchange-logger + `coffer-manual.log` +
  `mobile-fills.log`, merges with `fills.json`, reconstructs, writes `fills.json`/`positions.json`/
  `offers.json` (each only on a real content change). `main()` sits behind the standard
  `import.meta.url === pathToFileURL(argv[1])` invocation guard, so importing `regenerate()` triggers
  no sync and **no git**. New `sync-fills.mjs --local` runs it with zero git; the attended no-flag path
  is byte-identical to before plus `offers.json` in its commit set. `--local` deliberately does **not**
  fold un-pulled phone writes — that needs the attended sync's fetch/ff (acceptable: local mode serves
  the person at the PC).
- New **tracked root `offers.json`** — a dumb flat snapshot of the live GE offer slots (`{slot, side,
  itemId, item, price, qty, filled, lastUpdateTs}`), sourced from `pipeline/lib/offers.mjs`
  (`readOfferRows` → `offersSnapshot`, names resolved offline/best-effort from the mapping cache).
  EMPTY/terminal/cancelled slots excluded. It closes the gap `positions.json` (booked fills only) can't
  see: committed capital sitting in open offers.
- **`pipeline/watch-log.mjs` + `watch-log.cmd`** — the daemon: `fs.watch` on the exchange-logger
  **directory** (catches rotation; `coffer-manual.log` is a sibling there, so manual edits fire the
  same watcher — no second watch), ~10s debounce to absorb Windows' rename/duplicate bursts, then
  `regenerate()` **in-process** (same core as `--local` — no second pipeline copy to drift). Manual
  start, dies with the terminal, **no Task Scheduler** — that's the point.
- Tests (auto-discovered): `sync-fills.test.mjs` guards that `regenerate()` does zero git; `offersSnapshot`
  cases added to `pipeline/lib/offers.test.mjs`. 11 suites green.

**LW2 (deployed-app change, APP_VERSION 0.47.0 → 0.48.0):** on localhost (`IS_LOCALHOST` in
`js/state.js`) the app polls `positions.json` + `offers.json` every ~30s, compares `generatedAt`, and
on a change re-runs the **existing M1 `syncFills()` merge** (no second merge path) and stashes offers on
`STATE.offers`/`STATE.offersTs` (data home for the future Watch tab). It renders a compact "book synced
hh:mm · N open offers" stamp (local time, stale-colored past ~10 min) **instead of** the M1 banner +
Refresh button — never double-banner. On `bensumm.github.io` `IS_LOCALHOST` is false and behavior is
byte-identical to 0.47.0. With the daemon running, a fill/cancel/reprice reflects in the desk app within
~40s (debounce + poll), no keystrokes, zero new git commits. Full design: `FILLS-PIPELINE.md` §14.

### Finder full-catalog search + Signals badge count (0.46.0, PLAN chunk FX1)
Two verified UI bugs. (1) **"Soul rune" was unsearchable** — `buildItems()` excludes anything
with `l.high < MIN_PRICE` (1000gp) from `STATE.ITEMS` to keep browse-mode noise out, but Finder
search only filtered `STATE.ITEMS`, so sub-1000gp items could never be found even though search
deliberately bypasses the browse gates. Fixed at the search layer (NOT by dropping `MIN_PRICE`):
when a query is active, `currentFinderRows` unions in catalog matches via the existing off-screen
`rawItem` path for ids not in `STATE.ITEMS` (needs a live price to quote). Those rows carry
`offscreen:true` and lack `rate`/`score`/`fill`/`turn`; the renderer prints `—` for the grade and
rating-bar cells (fmt/fmtP/fmtTurn already null-safe) with a "below the browse price floor" title.
The quote button and star both work on them (they key off id; `resolveId`/`toggleWatch` already
handle catalog items). Browse view (no query) is byte-identical — verified in chromium. (2) The
**Signals badge read 0 with rows present**: `#sigBadge` showed only `firing` (rows whose BUY
signal fires now), which misreads as "tab is empty". It now shows `firing/total` (e.g. `0/6`),
plain `0` when there are no signal rows at all.

### Push-notification trigger engine (PLAN chunk N1 — pipeline + docs only, no APP_VERSION bump)
Design-first: the delivery mechanism decision ships as a committed doc section
(`pipeline/MONITORING.md` "Push notifications on market events") and the trigger ENGINE ships
as `pipeline/alerts.mjs` — **delivery-agnostic**, it only DETECTS and EMITS. Three trigger
classes: (1) POSITION — a held item's `momVerdict()` escalates to CUT/CUT-CANDIDATE or Momentum
`↓↓`, verdict from the shared gate tree (never re-derived); (2) FILL — a resting offer
completed, from the exchange log via `offers.mjs` (same source as `monitor.mjs`); (3) PRICE — a
live mid crosses a named alert in the tracked repo-root `alerts.json`. **Transition-only**:
fires on a state CHANGE vs the last run (a small gitignored `pipeline/.alerts-state.json`),
never on a level — first run seeds, an unchanged second run emits nothing, a persistent breach
doesn't re-buzz. Named constants `ALERT_COOLDOWN_MIN=60` (anti-flap, position/price only),
`FILL_WINDOW_MIN=60`, `FILL_DEDUPE_TTL_MIN=720`. **Quiet hours** (S2's `isOvernightNow()`,
22:00–06:00 local) suppress position/price alerts and preserve the transition so it re-fires
after 06:00 — **fills are exempt** (a completed trade always buzzes). Structured JSON + human
line on stdout, diagnostics on stderr (empty stdout = nothing fired). Delivery is **decided
after a live trial of option (a)** — a scheduled Claude Code session using the harness
`PushNotification` tool (zero new infra); (b) ntfy.sh from Task Scheduler and (c) Actions+email
are the fallbacks. No app changes; no new scheduled task/Action/topic created in this chunk.

### Mobile parity — GitHub-as-backend writes (0.39.0, PLAN chunk M1)
A phone trade now lands in the same pipeline as a PC trade, and fix-at-the-source stays intact
— the phone writes a *source log line*, never `fills.json`/`positions.json`. Four pieces:

**Pipeline multi-writer path (`sync-fills.mjs`).** Finishes B1: `syncMainToRemote()` is now
rebase-or-abort. Two writers touch `origin/main` — this PC sync (fills/positions/screen/
suggestions) and the phone (`mobile-fills.log`, via the GitHub contents API) — with **disjoint**
file sets, so a phone push only ever moves `origin/main` *ahead*. The guard fast-forwards local
main onto the moved remote BEFORE reading logs (so the phone's line is read this run) and lands a
**fresh commit** on top (never amend/force over the phone's commit; the scheduler-era `--auto`
amend path was later excised in chunk X2, §12). A genuine **divergence** now **aborts loudly (exit 1)** instead of
warn-and-continue — under the single-writer contract it's a structural bug to reconcile by hand,
not to force through. `main()` reads repo-root `mobile-fills.log` as an extra source (it is NOT in
`LOG_DIR`); slot 9 keeps mobile provenance distinct from desktop/CLI slot-8 manuals; the PC only
READS it (stays out of the PC's commit set). Validated with a bare-repo fixture (ff-then-fresh-
commit reads the mobile line into positions.json with the phone commit preserved; divergence aborts).

**New tracked `mobile-fills.log`** (repo root, comment-header only) — same line vocabulary as
`coffer-manual.log` (BOUGHT/SOLD/WITHDRAWN/BANKED + `{"state":"REMOVE","target":…}` tombstones).

**App write path + quick-add (`js/github.js` new, `js/ui.js`, `js/fillslog.js`).** Settings gains a
**GitHub sync** panel storing a fine-grained PAT in localStorage — never rendered back, never
exported (`backup.js` doesn't touch it), never logged (`logEvent 'action'` says "PAT updated"
only). owner/repo derive from the Pages origin (no account name hardcoded; localStorage overrides
for custom hosts/testing). The existing Ledger quick-add now routes its write: desktop File System
Access (slot 8) when the log is linked, else the mobile GitHub path (slot 9) when a token is saved
— GET sha → PUT append; on 409/422 re-GET and retry. Backdated entries still carry the true trade
time (the phantom-5-bludgeons rule); WITHDRAWN is a form mode and REMOVE is exposed via pending-row
delete (mobile edit/delete = append tombstone(+new line), routed by an `origin:'gh'` tag). A dedupe
guard warns on an identical item+side+price+qty just staged. Narrow-screen CSS enlarges tap targets
(16px inputs to avoid iOS zoom).

**Freshness UX (`js/ui.js`).** Since G1 there's no scheduled PC writer, so the phone's PRIMARY
freshness mechanism is here: a `generatedAt` staleness banner on the Ledger (with age + a
**Refresh-positions** button — a same-origin re-fetch; it can't regenerate positions.json, which
needs the PC's RuneLite log) and a staleness chip on the Coffer. Mobile-entered lines still render
immediately as `pending` rows, absorbed on the next `positions.json`. Folds in the S3 **watchlist
write-back**: add/remove now persists to repo `watchlist.json` through the same contents-API path
when a token is set (best-effort; the in-memory union still applies without one).

Validation: `node --check` all touched modules; a Playwright (Edge channel) smoke over http drove
the PAT-save UI, the real quick-add form submit → intercepted GitHub GET→PUT (slot-9 BOUGHT line,
correct branch/sha/base64 body) → optimistic pending row, the watchlist-write shape, and the
Refresh-positions re-fetch + banner. The GitHub write path can't be fully exercised without a real
PAT, so the network call was intercepted with a fake token and the request shape asserted.

### Action logging pass (0.38.0, PLAN chunk L1)
Instrument, don't rebuild: the `logEvent(level, scope, msg)` ring + persisted `logring` + Logs
view already existed (`js/state.js`), but every caller was a *system* fetch path (market/guide/
storage/fills). L1 adds a new `'action'` scope and logs the user's own actions, one line each,
each including the object of the action and no PII (item names/ids/prices only). Instrumented at
the **event handler**, never inside shared functions (`switchTab`/`loadAll` also run on
init/programmatic paths we don't log), so a passive re-render never emits a log: tab-bar clicks,
manual price refresh + Finder retry, scan refresh, watchlist add/remove, quote-expander opens,
trade log/hide/delete + pending-row and manual-log edit/delete, Trends open (item + source:
`link` for a deep-link, `manual` for a typed lookup — logged once at the single `runTrends`
funnel), position review (with a verdict tally — `renderPositionCard` now returns `{html,
verdict}` so the one caller can count them), backup export/import, and the bankroll/slots/strategy
settings. `LOG_MAX` 50→200 to hold the extra volume. The Logs view gains a minimal **All /
Actions / System** scope filter (`STATE.logFilter`, `logRowsHtml(withDate, filter)`,
`setLogFilter`); the status-banner dropdown always shows All. Settings note: no secret is ever
logged (the PAT M1 will add would log "PAT updated" only — value never).

### Screening economics + posture + watchlist-always-scanned (0.37.0, PLAN chunks S1/S2/S3)
S1: the liquidity gate gains a **gp-flow alternative path** — an item passes on `limitVol ≥
--floor` (50/d, unchanged) OR `limitVol × mid ≥ --gp-floor` (250m default), so an Avernic-class
big ticket (single-digit units/day, hundreds of millions of real two-sided gp flow) finally
surfaces, marked `thin: true` with a grade cap at A- and a "size in units, expect slow fills"
tooltip. Thin qualifiers are held OUT of the main ranking in a bounded `--thin-reserve` (6/niche,
ranked by real gp-flow) because their thinly-traded wide bands inflate `expGpDay`. ROI gate gets
an absolute-gp alternative for thin items (`--min-net-gp`, 100k/u); the band-activity gate
relaxes to 1 traded window for them. The **500k gp/day attention floor** moved from a `/scan`
post-filter to the structural `--min-gpd` flag, applied pre-rating (thin + held/asked exempt) —
it visibly tightens every niche (churn ~2 rated, spread ~4). S1.3 (dropping the spread niche)
deferred pending a few days of `--mode all` publishes. S2: `--posture overnight|active|auto`
(auto = local clock, 22:00–06:00 named constants); overnight = flat/rising confident-band only,
patient band-edge pricing, net-edge-weighted ranking, plus an `overnightStaleRisk` exclusion
built on the shipped `diurnalRead` basis (yesterday's overnight window printing below the
current bid); 4 posture fixtures in `quotecore.test.mjs`; published `screen.json` records the
posture in `params` and the app Scan banner shows it. S3: tracked repo-root **`watchlist.json`**;
the app unions it into `STATE.watchlist` (in-memory; write-back is M1); every screen appends a
gate-exempt **Watchlist** section with exclusion reasons as notes — falling watchlist items ARE
shown with the falling warning (extends the held/asked exception). Version note: the S-lane
authored this as 0.36.0 in parallel with Q1; renumbered to 0.37.0 at merge.

### Gate-0 feed-inversion reliability fix (0.36.0, PLAN chunk Q1)
A feed-inverted row — a crossed live feed, where the instasell (`latest.low`) prints *above*
the instabuy (`latest.high`) — used to reach `momVerdict()` with `reliable:true`/`ordered:false`
(the band was dense/fresh/two-sided, so nothing in the reliability chain caught it) and print a
decisive verdict off a non-price. Live case (2026-07-04): a row footnoted "⚠ feed inversion —
quote basis unreliable" still printed **CUT-CANDIDATE**. Fix folds inversion into the SINGLE
reliability source: `computeQuote` now sets `reliableReason='feed-inversion'` (→ `reliable:false`)
when `quickBuy>quickSell`, so every consumer that checks `row.reliable` (momVerdict's Gate 0,
`watch.mjs`'s `mom==='breakdown' && reliable`, `quote.mjs`'s classify) treats it as unreliable —
not just one path. `momVerdict()`'s Gate 0 also re-checks `row.ordered===false` at the decision
point as belt-and-suspenders. Result: an inverted feed prints **NO-READ** (Gate 0), never a
decisive verdict. New acceptance fixture in `pipeline/quotecore.test.mjs`; the 8 pre-existing
verdicts (incl. the bludgeon-cut regression guard) stay byte-identical. The `/positions` skill's
interim NO-READ-equivalent override is removed (the script now emits NO-READ itself), and the
CLAUDE.md Q1 followup + MONITORING.md Gate 0 reason list are reconciled.

### Self-improving skills (2026-07-04, PLAN-5 K1, no `APP_VERSION` bump)
Each workflow skill (`/positions` `/scan` `/overnight` `/morning`) gained a closing
**"Encode learnings"** section: capture what a run taught, but only AFTER the actionable
output is delivered and Ben's offers are placed/adjusted (his explicit rule — never
interleave doc edits with live market work). At that point ask one short question
("anything from this run worth encoding?"), route each fact to ONE canonical home
(move-never-copy: judgment-layer lessons → the owning SKILL.md + `version:` bump;
table/app contracts → CLAUDE.md; user preferences → Claude memory; monitoring doctrine →
`MONITORING.md`), and spawn a background subagent to make the edits + commit so the main
conversation keeps flowing. Honesty guard (process rule 4): process learnings encode
freely; a *market* claim (a new threshold, a pattern) still needs the usual evidence
standard — one session is one sample.

### `/overnight` v1.1 — fill-realism check (2026-07-04)
The first real overnight run filled 0/50,000 units — band-floor bids are extreme prints
nobody crosses down to during quiet hours, and the accumulation formula is an upper bound
that assumes fills at your price. The skill now requires a fill-realism read (price between
band floor and instasell for must-fill bids; count recent 5m windows at/below the bid) and
"up to" framing. (v1.2 made this measured, not guessed, via `nightlows.mjs`.)

### Project skills + CLAUDE.md slimming (2026-07-04, PLAN-5, no `APP_VERSION` bump)
Four committed skills — `/positions` (gate-tree verdict interpretation,
incidental-inventory filter, feed-inversion reliability override, action plan + interactive
tail), `/scan` (judgment pass over `screen.mjs` incl. the 500k gp/d floor), `/overnight`
(two-phase composer: `/positions` → pause for capital → `/scan` + 8h accumulation sizing
`min(limit×2, 8/24×0.10×volDay)`), `/morning` (overnight reconstruction, re-verdict stale
bids) — at `.claude/skills/*/SKILL.md`. `quote.mjs` regime lines now print the buy limit
(chunk 3a). Per-workflow doctrine *moved* out of CLAUDE.md into the skills.
**Skill-versioning convention:** skills-only changes bump the SKILL.md `version:`
frontmatter and get a one-line pointer in CLAUDE.md — they NEVER bump `APP_VERSION` (that
marks the deployed app, which skills never touch).

### Underwater-at-tick triage — the five-way read + gated decision tree (0.33.0, PLAN-3)
`momVerdict()` in `js/quotecore.js` is now the whole underwater gate tree, not just the Mom
cut-trigger. `computeQuote` exposes `reliable`/`reliableReason`/`quoteAgeMin` (Gate 0 — a
stale/one-sided/sparse quote is unreliable; the old `instabuy==null → CUT` bug is fixed to
**NO-READ**). New pure, fixture-tested helpers: `diurnalRead` (Gate 1 — quiet-hour trough
that dipped+recovered ~24h ago → **DIURNAL-WATCH**, spent statelessly once the window turns
liquid), `moveShape` (Gate 2 — small-lot volume-spike **shock** that stabilized →
**SHOCK-WATCH**, vs a **bleed** → cut), `underwaterHours` (D-escalation — underwater
*through a liquid window* → **CUT-CANDIDATE**, ending the flat-regime WATCH-forever case).
Every gate defers only on positive evidence, so the bludgeon-style real breakdown cuts
byte-identically (regression-guarded). Wired into all three consumers (`watch.mjs`,
`quote.mjs --positions`, `reviewPositions`) + the `classify()` breakdown route
reliability-gated. Acceptance fixtures: `pipeline/quotecore.test.mjs`
(`node pipeline/quotecore.test.mjs`). Docs: `MONITORING.md` step 4 is the tree; the
24h-cycle guard is unchanged but reframed as **input** (Gate 0/1: is this a price?) vs
**decision** (the guard: is there a proven daily rhythm?).

### Last-2h momentum tell — `Mom` column + cut-trigger (0.30.0)
The chunk-2 standard quote table (0.28.0) CLAMPS the optimistic prices against the live
quote (`optBuy=min(quickBuy, bandLo)`, `optSell=max(quickSell, bandHi)`) — correct for
*pricing*, but that clamp alone was **incomplete**: it ANNIHILATED the momentum signal (a
live-outside-its-own-2h-band break can never appear once clamped). Fix: `computeQuote` now
derives `mom ∈ {clean,breakdown,breakup}` from the **pre-clamp** raw band comparison
(`quickBuy<rawBandLo` ↓ / `quickSell>rawBandHi` ↑) and exposes it; the price clamp is
unchanged. `Mom` (clean / ↓ / ↑) renders in the dig-in views only (Trends card, Finder
**expander**, position review, `quote.mjs`/`screen.mjs`) — NOT the Finder bulk list
(deliberate; `market.js` untouched). Held-position cut-trigger: shared `momVerdict()` in
`js/quotecore.js` (used by both `reviewPositions` and `quote.mjs --positions`) —
↓+underwater → CUT; ↓+in-profit+flat/falling → LIST-TO-CLEAR; ↓+in-profit+rising →
size-conditional on `BIG_TICKET_GP` (10m total lot value: ≥ → clear, < → HOLD-watch); ↑ →
HOLD/list at 2h top. The base-mixing bug is guarded separately by `quoteOrdered()`, not the
clamp. **(0.33.0: this ↓/↑ matrix is now the Gate-2 leaf of the PLAN-3 underwater gate tree
— `momVerdict` additionally returns NO-READ / DIURNAL-WATCH / SHOCK-WATCH / CUT-CANDIDATE
ahead of it; see the 0.33.0 entry above.)**

### Live position monitor + deterioration-watch routine (2026-07-02)
`pipeline/monitor.mjs` (read-only — live offers/fills from the exchange log + held
positions with break-even from `positions.json`, *not* a log re-sum) drives a polling
routine documented in `pipeline/MONITORING.md`: a verdict per held position, break-even =
`ceil(buy/0.98)`, with an **evidence-gated 24h-cycle guard** (daily cycles are usually
noise → default to cutting a genuinely falling position; only a *proven* backtested
hour-of-day pattern defers a cut). The underwater verdict became the **PLAN-3 gate tree**
(0.33.0 — `MONITORING.md` step 4; the 24h-cycle guard is unchanged, now framed as
input-vs-decision). Session/agent-run for now; the durable app-native home is the
Refresh-positions + Ledger break-even/regime followups.

### Falling items → price to clear (0.20.0)
Ben's rule — for a falling item the suggested prices must reflect the fall: buy low
aggressively, price to sell quickly. This **superseded** the 0.19.0 "HOLD — cut if slow /
list high above market" nuance, which misfired: in a decline the recent highs are *always*
above the current price, so the old `patientUpside` guard was ~always true and told you to
list above a dropping market (the Dragon nails case, found live). Now `renderPositionCard`
collapses the falling branches → always list at the instabuy (in profit → SELL to clear;
underwater → CUT), never above it. `patientTargets` is trend-aware (see the Trends tab
header comment in `js/trends.js`) and the plan card's pricing copy branches on `PT.falling`.

### Position review workflow (0.19.0)
"Review pricing" on the Ledger → `reviewPositions()` in `js/trends.js` renders a HOLD /
ADJUST / CUT verdict + "list at X" price per open lot.

### Ledger auto-populate from fills (0.18.0)
`syncFills()` in `js/ui.js` fetches `positions.json` and merges pipeline-reconstructed real
trades into the Ledger/Coffer (`src:'fills'`, idempotent rebuild, tombstoned via
`STATE.fillsHidden`).

### Finder rating rework (0.17.0)
`computeScores()` in `js/market.js` blends four 0..1 sub-scores (ROI, liquidity, stability,
turnaround) into a `quality` dampener on profit/hr; per-factor tooltip on the Risk grade +
Rating bar.
