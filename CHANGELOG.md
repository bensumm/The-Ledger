# CHANGELOG — The Coffer / The-Ledger

Deep per-version writeups (rationale, superseded approaches, the "why" behind each shipped
change) live here. `CLAUDE.md`'s "Done (recent)" section keeps only a one-line load-bearing
pointer per entry — the "do not rebuild this" signal — and points here for the full story.
Moved out of `CLAUDE.md` by PLAN.md chunk K3 (2026-07-04). Newest entries at the top of the
recent block; the ordering below preserves the original CLAUDE.md sequence.

For anything older or not captured here, the commit history + `git show <sha>` is canonical.

## Recent

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
