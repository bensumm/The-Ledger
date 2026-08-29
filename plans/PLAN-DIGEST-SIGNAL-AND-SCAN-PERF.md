# PLAN-DIGEST-SIGNAL-AND-SCAN-PERF — make the decision digest's top rows worth reading, and stop the scan spending 40% of its wall clock in a serial loop

**Status: PARTLY SHIPPED — SP1 landed (see the Status table below). The original header read "PLANNING ONLY (2026-08-07). No code changed"; that is no longer true. Two independent workstreams in one doc
because they share one file (`pipeline/commands/screen-flip-niches.mjs`) and therefore one
parallel-safety contract — but they are otherwise unrelated and can ship in either order.**

> ⚠ **WORKSTREAM A'S FOUNDING PREMISE NO LONGER DESCRIBES THE CODE (2026-08-28).** Two things went
> out from under it. **`sell unreliable` was DELETED** (SEP12, `40ee02b`) after it measured worse
> than not gating at all below cost ratio ~1.29 — so §0.1's anchor board, claim A1's priority-1
> reading and every count of it below describe a rule that no longer exists. And **DS2 SHIPPED in the
> same wave**, going further than specified: the reach cell prints `NN% <basis-mark>`, not a glyph.
> Separately, AF1 moved the comparator off `capEff × deployable` to `rank`. Read the rest of this
> workstream as a record of what was true in 2026-08, not as open work; DS0/DS1 are what remain.

- **Workstream A — digest SIGNAL.** *(as of 2026-08-07, superseded — see the banner above.)* The
  `--digest` block ranks rows by `capEff × deployable` and
  never reads the reach column it prints, so its top slots go to rows its own verdict calls
  `sell unreliable`. CHANGES WHAT BEN SEES → every chunk is gated behind a measurement chunk.
- **Workstream B — scan PERFORMANCE.** A cold `--mode all` run is 14–17s wall; ~40% of it is one
  serial `for` loop in `runWatchlist`. BEHAVIOUR-PRESERVING → the acceptance bar is byte-identical
  stdout, and these chunks carry almost no decision risk.

---

## 0. Context / diagnosis — verified in code and against live data

Every claim below was re-derived this session. Where the originating hypothesis was **wrong or
imprecise, it is marked and corrected** — that is the point of this section.

### 0.1 The anchor incident (live, 2026-08-07)

A real `--mode all --digest` run this session produced an 11-row digest board in which
**9 of 11 rows read `sell unreliable`**, the top four were graded `C · C · D · B-`, and the only two
`A-` rows in the whole board were **#5** (Masori chaps, `fill-now`) and a row that only appeared at
all via the appended big-ticket visibility slice (Venator ring). The ranking put four
"you-can't-realise-the-sell" rows above the one row it graded `A- fill-now`.

That is the named anchor: **the `sell unreliable` board.** It reproduces the earlier observation
(Vial of blood #1 in two consecutive passes; Red dragonhide #3 at the board's highest `capEff` with
an ask reaching 0/14 days) and it is cheap to re-check — re-run the scan and count the verdict words.

### 0.2 Claim-by-claim verification

| # | Original claim | Verdict | Evidence |
| --- | --- | --- | --- |
| A1 | `buildDigestBlock` sorts on `capEff × deployable` (`rankKey`) and ignores reach entirely; `digestVerdict` puts `sell unreliable` at priority 1; the `crossable === false` sort-floor is existing precedent | **CONFIRMED** | `screen-flip-niches.mjs:872` — `key = r => (r.crossable === false ? -Infinity : (r.rankKey ?? r.capEff ?? -Infinity))`; comparator at `:873–874` breaks ties on `capEff` then `rank`. `reachFrac` appears only in `digestCells` (`:822`), never in `key`. `digestVerdict:635` is the `sell unreliable` rule; `:633` (`crossable === false`) is priority 0, so `sell unreliable` is priority **1** as stated. W3-1's `-Infinity` floor is the demote-don't-drop precedent. |
| A2 | `askPlacement` is only tested on the HIGH side; there is no LOW-placement rule; an ask at p0 renders reach ✓ | **CONFIRMED, and quantified** | The only `askPlacement` test in `digestVerdict` is `> MIRAGE_PLACEMENT` (`:641`). In `digestReachAndPlacement` it appears twice more, both as the same `> MIRAGE_PLACEMENT` bound (`:701`, `:721`). A low placement means the quoted ask sits below nearly every daily high in 14d ⇒ `his.filter(h => h >= refLevel).length / his.length → 1` ⇒ reach ✓ by construction. **Measured over `suggestions.jsonl`: 154 of 1,421 rows with a placement read (11%) sit at `askPlacement ≤ 0.05`, and 130 of those 154 (84%) render reach ✓.** The placement histogram has its largest single bucket at `0.0` (209 rows). The trap is real and is ~1 row in 9. |
| A3 | `enrichDigestDrift` computes the ask-decay for the rendered rows but prints it in a sub-list, **not as a column/verdict input** | **PARTLY REFUTED** | It *is* already a verdict input — `:858–861` relabels a `fill-now` verdict to `⚠ falling — verify (~X/d)` when the drift is uniform-down beyond `DIGEST_DRIFT_RELABEL_FRAC` **and** the niche is band/churn. What is true: it is not a **column**, it fires on a narrow conjunction, and it never touches `rankKey`. So the remaining work is display consolidation, not new signal. |
| A4 | Exit-pool size is absent from the digest though `row.volDay` is in hand | **CONFIRMED** | `digestCells` (`:818–828`) has no volume/pool column. `row.volDay` is used only as `deployUnits({ limitVol: row.volDay … })` at `:773`. |
| A5 | The digest is console-only and `verdict`/`reachFrac`/`askPlacement`/`marginTrend` are **never logged** | **PARTLY REFUTED — `askPlacement` IS logged** | `screen-flip-niches.mjs:1540` logs `askPlacement` (present on **1,421 of 1,974** capEff-bearing rows, 72%); `suggestlog.mjs:479` stores it. `capEff` and `weakDeploy` are also logged (`:1521`). Still unlogged: `verdict` (the field named `verdict` in the ledger is the **letter grade**, `:1508`), `reachFrac`, `marginTrend`, `placementDiverges`, `crossable`, `deployable`, `rankKey`, `softBuy`, `phase`, `bigTicket`, and the digest's own rank position. **Also: `reachFrac` is RECONSTRUCTIBLE today** from the logged `estConfidence.{askRecHit,askRecDays,askHit,askDays}` — that is what made §0.3 possible without shipping anything. |
| A6 | Empirically, `pFill < 0.5` share rises from 70% at capEff 0–10%/d to 86–94% above | **REPRODUCED BUT THE INFERENCE IS REFUTED** | See §0.3. |
| B1 | Cold 14s / warm 3s, 422 HTTP calls, 21.5s summed in-flight, 7.9s with zero HTTP in flight | **CONFIRMED** (13.98s span, 422 calls, 21.5s in-flight, 8.05s zero-in-flight on the supplied profile; an independent run this session gave 16.53s / 417 / 29.3s / 7.85s) | `/tmp` profile re-analysis, both runs. |
| B2 | Head phase 5.5s / 24 calls with "~20 serial rolling-24h composition calls" | **CONFIRMED on the numbers, REFUTED on the cause** | Head = 5.95s wall, 26 calls, but only **1.30s in-flight and 4.85s idle**. The calls are `loadBands`'s cold `/5m?timestamp=<w>` bucket backfill (`marketfetch.mjs:455–462`), not a rolling-24h composition. Per window the loop pays fetch (~90ms) + **`await sleep(70)`** + **`archive.append` of a whole-market snapshot (~175ms, inferred residual)**. **So the head is SQLite-write-bound, not fetch-bound** — parallelising its fetches recovers at most the ~1.3s of sleeps + ~1.1s of serialisation, never the ~3.3s of appends. Warm, the whole head-loader set measures **294ms** (`loadBands(2)` 69ms + `loadDaily(17,6)` 207ms), which is why "warm 3s" happens. |
| B3 | Parallel survivor burst 2.5s / 330 calls at ~90 concurrency | **CONFIRMED on time/count, REFUTED on concurrency** | 2.00s wall / 328 calls / 17.2s in-flight, **peak concurrency 15** — exactly `FETCH_CONCURRENCY = 5` (`:2646`) × the 3-endpoint `Promise.all` (`:2657–2661`). ~8.6× effective parallelism. This phase is already efficient; leave it alone. |
| B4 | Watchlist tail 6.0s / 68 calls at concurrency 4–8 | **CONFIRMED on time/count, REFUTED on concurrency — it is strictly serial** | `runWatchlist` (`:2218–2239`) is a plain `for … of` with `await fetchTsCached(5m)` → `await sleep(30)` → `await fetchTsCached(6h)` → `await sleep(30)`. Measured: 6.03s wall / 68 calls / **3.06s in-flight** / 2.90s idle on the supplied profile; 9.45s / 74 / 6.01s / 3.42s on this session's run. The idle is 34–37 × 2 × 30ms of `sleep` (2.0–2.2s) plus per-row compute. The same file already has the correct pattern at `:2650–2670` (bounded worker pool) and at `:2380` (`Promise.all` over the three series). |
| B5 | `read-window-range.mjs:180` uses plain `fetchTs`, so the post-scan verification trio re-pulls 1h series the scan just cached | **CONFIRMED**, and it is **not the only one** | `read-window-range.mjs:180` — `Promise.all([fetchTs(r.id,'1h'), fetchLatest(r.id)])`. **`read-schedule.mjs:258` has the identical pattern** (`await fetchTs(id,'1h')`), and `/schedule` is run on every position set. `fetchTsCached` (`marketfetch.mjs:192`) is the targeted alternative and already writes the same `.cache/ts/<id>-1h.json` the scan fills. |

### 0.3 The empirical read on `capEff` — reproduced, then dismantled

Re-derived over the 1,974 rows in the active `suggestions.jsonl` carrying `capEff` (the original
count of 1,941 differs only by rows appended since):

- Distribution reproduces: p50 **29.0%/d**, p90 **132.9%/d**, p99 **1,777.8%/d**, max **14,727%/d**.
- The `pFill < 0.5` share by capEff band reproduces: 69% (0–10) → 86% (10–30) → 91% (30–60) →
  86% (60–120) → 89% (120–300) → 100% (300–1000) → 90% (1000+).

**But the inference does not survive three checks, and the plan must not lean on it:**

1. **The association is weak.** Spearman ρ(capEff, pFill) = **−0.185** over all 1,974 rows. Median
   `pFill` moves only 0.30 → 0.25 across three orders of magnitude of `capEff`.
2. **Most of it is niche mix, not capEff.** Within `mode=band` ρ = **−0.110** (n=1,532); within
   `mode=churn` ρ = **−0.092** (n=442). The 0–10 band is 52% churn (higher `pFill` by construction);
   every band above it is 80–95% band. The "70% → 86%" step is largely the mix changing.
3. **The units are not the ranked units.** The logged `capEff` is the **lapsCap-free** intrinsic
   value (`:1521` calls `capEfficiency(spec, er)` with no `lapsCap`), while the digest **ranks and
   displays** the buy-limit-bounded one (`:779`). So the 14,727%/d tail describes a number the
   digest never shows. Any tuning built on the logged series is calibrating the wrong variable
   unless DS0 logs both.
4. **The sample is not 1,974 independent observations.** 61 distinct scan passes over 302 distinct
   items. Heavy repeat measurement; treat n as *tens*, not thousands.

Also: `pFill` is the model's own estimate and `capEff`'s denominator (`holdDays`) comes from the same
`er.ttf` the same estimator produced, so a "high capEff ⇒ low pFill" relation is partly an identity
of the estimator, not an observation about the market. **Association only, mechanically coupled,
n≈tens.** (Process rule 4.)

### 0.4 The finding that reframes Workstream A — the reach glyph is a 3-sample coin flip

This was not in the original hypothesis and it changes the recommended fix.

`digestReachFrac` (`:666`) delegates to `reachFraction(askReachExtra, { prefer:'recent' })`, and
`reachFraction` (`js/estimators/reach.mjs:94–101`) returns `recentHit / recentDays` whenever recent
counts exist. Over the ledger:

- **`askRecDays === 3` on 1,974 of 1,974 rows (100%).** The recent basis is *always* used.
- So `reachFrac` takes exactly four values: **0/3 (694 rows, 35%) · 1/3 (388, 20%) · 2/3 (323, 16%) ·
  3/3 (569, 29%)**.
- The digest's ✓/✗ splits at `REACH_GRADE_CAP_FRAC = 0.5` (`js/rating.mjs:160`), i.e.
  **✗ ⟺ the ask printed on 0 or 1 of the last 3 days**. That is **55% of all rows**, which is exactly
  why the live board reads 9-of-11 `sell unreliable`.
- Against the 14-day basis the same rows would classify differently **30% of the time**
  (recent✓/full✗ 19%, recent✗/full✓ 10%). The glyph's value depends materially on a basis choice
  that RB-5 deliberately fixed to "recent" for display.

**Consequences for the plan:**

- The problem is *not only* "the sort ignores reach". Even a perfect reach-aware sort would be
  sorting on a 3-sample binomial rendered as a confident glyph.
- A naive "demote every reach ✗" rule would demote **55% of the board** off n=3 — a large,
  unmeasured risk of burying good candidates, and squarely against Ben's "never drop a row" doctrine.
- Therefore the first surface change must be **making the noise visible** (render the counts), and
  any sort intervention must be scoped to the **unambiguous** end (0/3, 35% of rows) and gated on a
  real measurement.

### 0.5 Things the original investigation did not cover

**(a) The `deployable` factor saturates — the ranking degenerates toward pure `capEff`.**
`deployable = deployUnits × buyLow` and `deployUnits = min(capGp/buyLow, 0.10·volDay·2, limit·6·2)`
(`js/valuescreen.mjs:200–208`). When the **bankroll bound binds**, `deployable` collapses to exactly
`capGp` (= `VALUE_CAPITAL`) for every such row, so `rankKey = capEff × constant` and the deployable
weight does nothing. Evidence: on the live board **7 of 11 rows show `deploy` = 56.34m to the
100-gp digit** — the capital pool itself. Over the ledger, using the logged `bid` + `volDayRolling`
and the session's 56.34m pool, **62% of rows are bankroll-bound** (an upper bound — the unlogged
buy-limit bound can only lower `deployable`, so the true saturation share is ≤62% and ≈60% on the
observed board). The term does real work at the *bottom* (dust-tier rows get discounted), essentially
none at the *top*. This is the POLISH-1 failure resurfacing one level up at high bankroll, and it is
the same "capital-conditioned reserves" concern PLAN.md's MT-V2 row already flags.

**(b) `capEfficiency` is mis-specified at the top of its range — the lap ceiling is inverted.**
`holdDays` (`:570–581`): the **churn** branch caps laps at `LAPS_PER_DAY_CEIL = 6`; every **other**
family gets `Math.max(ttfSec, 3600) / 86400`, i.e. an implicit ceiling of **24 laps/day**. So the
patient 2h-band thesis is allowed a *higher* recycling rate than the lane that exists to recycle,
and the module header's claim that churn's recycling "is rewarded in capEff's RANKING via holdDays"
is the opposite of what the code does. `lapsCap` (POLISH 2) only ever *lengthens* `holdDays`, so it
does not repair the asymmetry — it binds only where the buy limit binds.

**(c) The `sell unreliable` epidemic is definitional, not incidental** — §0.4.

**(d) No other consumer depends on the digest ordering.** `buildDigestBlock` has exactly one
production call site (`:2700`, `realLog`-gated on `--digest`) plus `pipeline/test/capeff-digest.test.mjs`.
It is never written to `screen.json` (`:2739–2754` builds the payload from `rows`, not `DIGEST_ROWS`)
nor to the last-report dump. Downstream is prose only: `.claude/skills/scan/SKILL.md` §1,
`docs/MARKET-ANALYSIS.md` §§232–249, `docs/SIGNAL-AUDIT.md` rows 67–69. **The blast radius of a
digest change is one console block and three docs** — unusually cheap for a signal change.

**(e) Existing test coverage is strong and will catch regressions.**
`pipeline/test/capeff-digest.test.mjs` is 406 lines / 66 assertions across 11 groups covering
`capEfficiency` (incl. `lapsCap`), `weakDeploy`, the full `digestVerdict` rule table *including
first-match ordering*, `deployUnits`, `buildDigestBlock`'s sort/cap/tie-break/deploy column, the
big-ticket slice, the POLISH-3 stale guard, R4b trend, R5 escalation, and W3-1 crossability. Any
sort or verdict change **will** break specific named tests, which is the desired failure mode.

**(f) CI constrains the shape of new code.** `.github/workflows/checks.yml` runs
`check-dead-exports.mjs` — *"no export kept alive only by its own test"* — so a new helper must have
a production caller in the same commit, not a test-only one. `check-imports.mjs` statically resolves
every `pipeline/commands/*.mjs` import. `lint-docs.mjs` is a denylist + duplicate-phrase checker on
the CLAUDE.md ⇆ README axis. Nothing in CI hits the network, so no chunk here can be validated by CI
alone — each needs a local live run.

**(g) `runWatchlist`'s loop body is pure — parallelisation is genuinely order-safe.** Inside the loop
(`:2218–2239`) the only mutations are `rows.push` and `sugg.push`. `qcache` is read-only here (built
at `:2649–2671` and not written after). `computeQuote`, `estimateRank`, `rateItem` (`js/rating.mjs:200`,
builds a fresh `factors` object), `stdCells` and `suggestionEntry` are pure — there are no
module-level mutable accumulators in `js/rating.mjs`, `js/estimators/families.mjs`, or
`pipeline/lib/signal/estimators.mjs`. `loadWatchlist` dedupes ids via a `seen` Set (`:2183–2188`) so
no two iterations touch the same `.cache/ts/<id>-<step>.json`. `logSuggestions` is called **once**
after the loop (`:2240`) over `sugg`, and the printed table iterates `rows` — **both are
order-sensitive**, so the safe transform is: parallel FETCH phase into an id-keyed Map, then the
existing serial loop unchanged over `wl` order. That is the same split `:2650–2671` already uses.

**(h) The `cache-warm` daemon guards the wrong grain for this cost.** `healthCheck`
(`cache-warm.mjs:99–113`) decides staleness purely from `newest1hAgeHours` — the **/1h** grain —
while `start` (`:145`) warms **both** /1h and the /5m bands. The head cost measured in B2 is entirely
the **/5m** grain (a 2h × 5m = 24-bucket window that ages out completely in 2 hours), and the
daemon's Task Scheduler tick is **4h**. So the grain the interactive scan actually pays for is never
the grain the guard measures. Noted as a finding; the fix is partly a Ben-owned scheduling decision,
not only code — see SP5.

---

## 1. Rulings (decisions of record; proposed defaults are flagged for veto)

1. **Measurement lands before any change to what Ben sees.** DS0 (logging) and DS1 (the study)
   ship before DS3/DS4/DS5. DS2 is the one exception and it is argued explicitly in §3.
   *(Ben, standing: "tuning stands on evidence, not vibes".)*
2. **Never drop a row; demote it and show why.** Every Workstream-A chunk preserves the row and its
   displayed `capEff`, following the W3-1 `-Infinity` sort-floor precedent verbatim
   (`:868–872`). A demoted set gets a visible divider, never silence. *(Ben, standing doctrine.)*
3. **Fills-joined validation of the digest is NOT possible today and the plan says so.**
   `report-retro.mjs` over the whole archive reports **88,499 suggestion rows × 336 buy offers → 92
   filled + 135 filled-worse + 88,272 not-taken (100% not-taken to 0 s.f.)**. The digest's own top-8
   rows are a sub-population of that; there is no chance of a per-cell n. The censoring is structural:
   **skipped rows have no outcome, ever.** DS1 therefore validates against a **market
   counterfactual** ("did the quoted ask actually print within the horizon?") which is observable for
   every row, acted-on or not. **RULED (Ben, 2026-08-07): counterfactual accepted as the evidence
   basis — and DS1 has now been RUN (see DS1 below). Its result SHELVED DS4 rather than graduating
   it.** The suggestions log is therefore KEPT, not deleted: it is unvalidatable by fills forever, but
   **99.9% validatable against the price archive**, which spans 2026-05-29 → today — 40 days before
   the suggestions log began.
7. **Suggestions log: 90-day hot retention, then roll off.** *(Ben, 2026-08-07.)* The log grows
   ~13k rows/day at ~1.2KB each (July alone: 82,993 rows / 75MB) with no retention policy today.
   90 days preserves every study the price archive can support (its own span is ~71 days) while
   bounding growth. See DS8.
8. **`deploy` is REPLACED by `pool`, not supplemented.** *(Ben, 2026-08-07: "I don't care about that
   column, it's not important.")* It read `56.34m` — the bankroll itself — on 7 of 11 live rows.
   Resolves DS6's open column-budget question; the digest stays 9 columns.
9. **A cached series must SURFACE its staleness.** *(Ben, 2026-08-07: "<15-minute stale is acceptable
   as long as we surface how stale it is.")* SP2 ships with a visible age stamp on the read, never a
   silent substitution.
10. **SP5's archive-growth cost is ACCEPTED; the sub-2h tick is APPROVED.** *(Ben, 2026-08-07: "that
    is an acceptable consequence for the SP5 tick update".)* Recorded with the measured magnitude so
    the acceptance is anchored to a number rather than a shrug — **archive composition measured the
    same day**:

    | grain | rows | span | rows/day | buckets/day captured |
    | --- | --- | --- | --- | --- |
    | `1h` | 5,076,154 | 71d | 71,917 | 24 / 24 (complete) |
    | `5m` | 6,657,681 | 30d | 224,653 | **139 / 288 = 48.3%** |

    The 48.3% is the lossy-window effect quantified: at a 4h tick the 2h `/5m` window rotates fully
    between runs. A sub-2h tick takes 5m capture to ~288 buckets/day — **~2.07×**, about
    **+240k rows/day**. At the archive's measured **~45 bytes/row** (505MB ÷ 11.73M rows) that is
    **~+11MB/day**, taking total growth from **~13MB/day (~4.9GB/yr) to ~24MB/day (~8.8GB/yr)**.
    **Ben has accepted this.** Note the `5m` grain has only been accruing since ~2026-07-08 (30d), so
    its rows/day figure is current-rate, not a long-run average.

    **SUPERSEDED IN EFFECT the same day by DS9.** Ben then proposed tiered retention (`5m` 30d /
    `1h` 90d), which caps the archive at **~0.9GB steady state** and absorbs this growth entirely.
    The acceptance above still stands as the ruling — SP5 does not depend on DS9 shipping — but in
    practice the cost Ben accepted will not be incurred. This ruling never governed DS8, which is the
    *suggestions ledger* and is separate.
4. **`capEff` stays a display+sort metric and never becomes a gate.** Unchanged from
   PLAN-CAPITAL-EFFICIENCY-AND-DIGEST §1.4. DS5 changes how it is *computed*, not what it *authorises*.
5. **Perf chunks are behaviour-preserving or they do not ship.** Acceptance for SP1/SP2/SP3 is
   diff-proven identical stdout on a real run (modulo the timing line), not "looks the same".
6. **The existing logged `capEff` field is not repurposed.** DS0 adds a sibling; changing the
   meaning of a field with 1,974 historical rows would silently corrupt every future calibration.
   *(The YS2 absent-field pattern — additive only.)*

---

## 2. Existing scaffolding (build on, not around)

| Need | Already exists |
| --- | --- |
| demote-don't-drop in the digest sort | W3-1's `crossable === false → -Infinity` floor, `:868–874` |
| additive ledger fields that don't break old readers | YS2 absent-field pattern, `suggestlog.mjs` `suggestionEntry` |
| a read-only retro command shape | `pipeline/commands/report-retro.mjs` + pure core `pipeline/lib/render/retrojoin.mjs` |
| historical per-item 5m bands for a counterfactual | `loadHistBands` + `.cache/outcomes-bands/`, and the SQLite archive (`marketAt`) |
| a bounded parallel fetch pool with id-keyed results | `screen-flip-niches.mjs:2650–2671` (survivor pool) and `:2380` |
| per-item TTL disk cache for slow series | `fetchTsCached` (`marketfetch.mjs:186–199`) |
| a visible-swap relabel that shows the number that caused it | `enrichDigestDrift` (`:846–863`) |
| the reach counts needed for an honest cell | already computed — `askReachExtra.{recentHit,recentDays,reachedDays,nDays}`, and already logged inside `estConfidence` |

**Nothing here is greenfield.** Every chunk is an extension of a pattern already in the file.

---

## 3. Staged chunks

Legend — **[P]** behaviour-preserving (perf/refactor; acceptance = byte-identical stdout) ·
**[S]** changes what surfaces (signal; acceptance = named fixture + a live A/B) ·
**[M]** measurement only (no user-visible change at all).

### DS0 — log the digest's computed fields **[M]** · do-first

**What changes.** In `collectDigestRow` (`:768`), stash the fields already computed for the digest
onto the row, and in the `logSuggestions` call (`:1507–1544`) add ONE lean object per row:

```
digest: { verdict, reachHit, reachDays, reachFrac, marginTrend, placementDiverges,
          crossable, deployable, rankKey, capEffRealizable, bigTicket, phase, digestRank }
```

`capEffRealizable` is the **lapsCap-bounded** number the digest ranks on — the existing `capEff`
field keeps its lapsCap-free meaning untouched (Ruling 6). `digestRank` is the row's position in
`buildDigestBlock`'s sorted order (or `null` when it never rendered), which is *not* reconstructable
later because it depends on the pass's whole pool. `reachHit`/`reachDays` are the raw counts, not
just the fraction — §0.4 is why.

**Files.** `pipeline/commands/screen-flip-niches.mjs`, `pipeline/lib/render/suggestlog.mjs`
(field docs + the absent-field guard), `pipeline/test/capeff-digest.test.mjs` (a shape fixture),
`README.md` (ledger field inventory), `docs/SIGNAL-AUDIT.md`.

**Ordering constraint.** `digestRank` is only known *after* `buildDigestBlock` sorts, which runs
after every `renderMode`'s `logSuggestions`. Two options: (i) log the digest object without
`digestRank` and emit ONE aggregate `digestBoard` line after `buildDigestBlock` (the `excludedShadow`
precedent at `:2637–2640` — an itemId-less aggregate row that every joiner skips); (ii) defer all
digest logging to that aggregate line. **Recommend (i)** — per-row fields join, the board line
carries ordering.

**Verified by.** Run a scan; assert every `mode`-bearing row now carries `digest.*`; assert an
old-shaped row still parses; `node pipeline/ci/run-tests.mjs`; `check-imports`, `check-dead-exports`.

**Rollback.** Delete the added fields. The absent-field pattern means every reader already tolerates
their absence; no migration, no schema bump.

**Impact / confidence / risk / effort / reversible.** Benefit: unlocks DS1 and every later tuning
decision — currently *nothing* about the digest's own output survives the pass. Confidence **high**
(pure additive logging). Risk of cutting a good candidate: **zero** (nothing displayed changes).
Effort **S**. Fully reversible.

---

### DS1 — the market-counterfactual digest study **[M]** · ✅ **PILOT RUN 2026-08-07 — RESULT BELOW**

> **RESULT (pilot, 2026-08-07).** Run ahead of DS0 because the reach basis was reconstructible from
> the already-logged `estConfidence.askRecHit/askRecDays` (§0.2 A5). Sampled 5,000 of the 68,935
> `script:'screen'` rows carrying an `ask`, joined forward 24h against the archive's `1h`
> `avgHighPrice`:
>
> - **Archive coverage of the next-24h window: 4,996 / 5,000 = 99.9%.** The coverage risk this chunk
>   flagged did NOT materialise at the 24h horizon. (48h untested.)
> - **Overall: the quoted ask printed within 24h on 59.7% of covered rows.**
>
> | recent-reach cell at suggestion time | n | ask printed ≤24h |
> | --- | --- | --- |
> | 0/3 | 776 | **55.4%** |
> | 1/3 | 418 | 58.6% |
> | 2/3 | 346 | 65.0% |
> | 3/3 | 652 | **69.9%** |
> | (field absent — pre-`estConfidence` rows) | 2,804 | 58.0% |
>
> **Reading.** The gradient is real, monotone and statistically solid (0/3 vs 3/3: 14.5pp, z ≈ 5.6).
> **But a 0/3 ask still prints 55.4% of the time** — more often than not. So the 3-day reach basis is
> a genuine *tilt*, not a *gate*. This **graduates DS2** (the counts carry real information and
> deserve to be legible) and **SHELVES DS4** (flooring 35% of the board on a signal that is wrong
> more than half the time is a different bias, not a denoiser).
>
> **Honesty (rule 4).** "Printed within 24h" is a weaker claim than "your order would have filled" —
> a 1h-bucket `avgHighPrice` reaching the level does not mean a specific unit transacted. One
> horizon, unweighted by mode, and 56% of sampled rows predate the `estConfidence` field. The
> conclusion this supports is the *negative* one (0/3 does not predict failure), which is robust to
> all three caveats; any positive claim from it needs the full chunk below.
>
> **Still worth building the full chunk** for the 12h/48h horizons, the `askPlacement ≤ 0.05` bucket
> DS3 needs, and per-mode conditioning — but it is now a *refinement*, no longer a gate on anything.
> The pilot harness should be promoted into the command rather than rewritten.

**What changes.** New read-only `pipeline/commands/report-digest.mjs` + pure core
`pipeline/lib/render/digeststudy.mjs`. For each logged digest row, look forward in market history
(the SQLite archive's `/5m` + `/1h` grains, and `loadHistBands` for depth) and answer, with no fill
required and no censoring:

- **Did the quoted ask (`optSell`) actually print within 12h / 24h / 48h?** — the direct
  counterfactual for `sell unreliable`.
- Conditioned on: `reachHit/reachDays` (0/3 vs 1/3 vs 2/3 vs 3/3 — the four cells §0.4 identifies),
  `askPlacement` decile (with the `≤0.05` bucket broken out for DS3), `marginTrend`, `digestRank`,
  `mode`, and `capEffRealizable` quartile.
- Report **n per cell on every line** and refuse to print a rate below a stated floor.

**Files.** two new files + `pipeline/test/digeststudy.test.mjs`, `README.md` inventory,
`docs/SIGNAL-AUDIT.md`.

**Verified by.** Synthetic fixtures for the pure core (a row whose ask printed at +6h; one that never
printed; one with no archive coverage → `unknown`, never a fabricated `no`). Live run prints a table
with n on every row.

**Rollback.** Delete both files; nothing else imports them. (Watch `check-dead-exports` — the pure
core must be imported by the command in the same commit.)

**Impact / confidence / risk / effort / reversible.** Benefit: this is the *only* honest evidence
route for DS4, and it also directly tests whether the 3-day reach basis (§0.4) predicts anything at
all — a result that would be worth having even if no further chunk ships. Confidence in the *method*
**high**; confidence that it will produce a usable answer **medium** — archive coverage of the `/5m`
grain is sawtoothed older than ~24h (`cache-warm.mjs` header), so the 48h horizon may degrade to
`unknown` on many rows. Risk **zero** (read-only). Effort **M–L** — the largest chunk here. Fully
reversible.

---

### DS2 — make the reach cell honest (counts, not a glyph) **[S]** · ✅ **SHIPPED VIA SEP12 (2026-08-25)**

> Shipped beyond spec: the cell renders `NN% <basis-mark>` — the fraction AND its basis — and no
> `✓`/`✗` remains in the digest (`screen-flip-niches.mjs`, `digestCells`). The text below is the
> original specification, kept for its rationale.

> **PROMOTED (2026-08-07).** With DS4 shelved by the DS1 pilot, this is the whole of the signal work
> that ships. It is also *directly* supported by the pilot: the four cells have materially different
> forward print rates (55.4% → 69.9%), so showing the cell is showing real information — while the
> glyph that collapses them at 0.5 currently labels a 55%-printing row `✗`.

**What changes.** `digestCells` (`:822`) renders `✓` / `✗` / `—`. Change to show the sample the
call rests on, plus the free 14-day second opinion already in hand:

```
reach:  ✗ 0/3        (full 2/14d)
reach:  ✗ 1/3        (full 9/14d)      ← the 30%-disagreement case, now visible
reach:  ✓ 3/3        (full 13/14d)
reach:  —                              ← reach-exempt, unchanged
```

**No ranking change. No verdict change. No row moves.** This is a rendering change only.

**Why this is the one surface chunk that ships before DS1.** It does not act on the signal — it stops
the tool *overstating* a signal it already prints. §0.4 shows the glyph is a 3-sample binomial and
that a competing 14-day basis disagrees 30% of the time; rendering `✗` alone is the honesty defect
(process rule 4), and the fix is to show the number. Under the `gate-on-error-cost-not-n` rule this
is "inform → on".

**Files.** `pipeline/commands/screen-flip-niches.mjs` (`digestCells`, and `collectDigestRow` must
carry `reachHit`/`reachDays` — free once DS0 lands), `pipeline/test/capeff-digest.test.mjs`,
`.claude/skills/scan/SKILL.md` (bump `version:`), `docs/MARKET-ANALYSIS.md`, `docs/SIGNAL-AUDIT.md`.

**Verified by.** Fixture asserting all four cells (0/3, 1/3, 2/3, 3/3) + the exempt `—` + a
no-full-window degrade. Live run: the column is wider and the counts match the `estConfidence` values
logged in the same pass.

**Rollback.** One-line revert of `digestCells`.

**Impact / confidence / risk / effort / reversible.** Benefit: the reader can immediately tell a
`✗ 0/3` (never printed in 3 days) from a `✗ 1/3` (printed yesterday) — today they are the same glyph
and together they are **55% of every board**. Confidence **high**, and the evidence is direct
measurement (`askRecDays === 3` on 100% of 1,974 rows), not association. Risk of cutting a good
candidate: **zero** — nothing is demoted. Effort **S**. Fully reversible.

---

### DS3 — the LOW-placement / crashed-regime read **[S]** · do-later (after DS1)

**What changes.** Two additions, both honest-labelling rather than demotion:

1. In `digestReachAndPlacement`, when `askPlacement <= LOW_PLACEMENT` (proposed **0.05**, a named
   PLACEHOLDER, n≈0), mark the row `placementFloored: true`. The reach read at such a level is
   **uninformative by construction** (the ask sits below essentially the whole 14-day daily-high
   distribution, so `reachFrac → 1` mechanically), so the cell renders
   `✓ 3/3 (p0 — ask below the 14d high range)`.
2. Add a `digestVerdict` rule at priority **between** `mirage top` and `weak deploy`:
   `below-range — verify regime`. It fires only on `placementFloored && !reachExempt`. It does **not**
   floor the sort.

**Why not a demotion.** A p0 ask has two readings that the digest cannot currently tell apart: a
crashed regime whose whole daily-high distribution is stale-high (the Raw anglerfish trap), or a
deliberately conservative fast-clearing exit (which is a *good* trade). Demoting both would punish
the second. The `hourlyDrift` relabel (`:846–863`) already exists to separate them and fires on
exactly these rows — DS7 makes that pairing visible.

**Files.** `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/capeff-digest.test.mjs`,
`.claude/skills/scan/SKILL.md`, `docs/MARKET-ANALYSIS.md`, `docs/SIGNAL-AUDIT.md`.

**Verified by.** Fixture: `askPlacement 0.02` + reach 3/3 → the labelled cell and the new word;
`askPlacement 0.5` → byte-identical to today; a symmetric/exempt row → untouched. Live: the ~11%
of rows §0.2 A2 measured should carry the label.

**Rollback.** Remove the rule and the `placementFloored` flag; the verdict table returns to its
prior first-match order (the ordering tests pin this).

**Impact / confidence / risk / effort / reversible.** Benefit: closes a measured 11%-of-rows blind
spot where the reach ✓ is an artifact. Confidence in the *mechanism* **high** (it is arithmetic);
confidence in `LOW_PLACEMENT = 0.05` **low — an invented placeholder**, which DS1 can move.
Risk of cutting a good candidate: **low** (labels only; no sort change). Effort **S–M**. Reversible.

---

### DS4 — reach-aware sort floor, scoped to the unambiguous end **[S]** · ❌ **SHELVED 2026-08-07 — the gate did not clear**

> **DS1's pilot vetoed this chunk on its own terms.** The gate written below was: ship only if the
> 0/3 cell has a materially lower ask-print rate than 2/3 and 3/3, *with n stated*. It does have a
> lower rate — **55.4% vs 65.0% / 69.9%, n = 776 / 346 / 652, z ≈ 5.6** — but the absolute level is
> the problem, not the gradient: **a 0/3 ask prints within 24h more often than not.** Flooring 35% of
> the board below a `— demoted —` divider on a signal that is wrong 55% of the time substitutes one
> bias for another; it does not denoise.
>
> This is the gate working as designed, not a failure of the chunk. **Do not revive it on the
> gradient alone.** It could be reconsidered only if a later study finds a *conjunction* that is
> genuinely predictive (e.g. `0/3` **and** `askPlacement ≥ p85` **and** `marginTrend === 'fading'`) —
> a much narrower slice than 35% of the board, with its own stated n.
>
> The mechanism below is retained verbatim because it is correct and cheap to resurrect; only the
> justification is missing. Everything below this box is the ORIGINAL spec, unedited.

**What changes.** Extend `buildDigestBlock`'s comparator key (`:872`) with a **second** floor tier,
using W3-1's shape exactly:

```
crossable === false        → -Infinity        (unchanged)
reachHit === 0 && reachDays >= 3 && !exempt   → floored below every un-floored row
otherwise                                     → rankKey
```

The displayed `capEff` is never mutated; floored rows still render, under a
`— demoted: ask did not print in 3 days —` divider mirroring the big-ticket slice divider (`:891`).

**Deliberately NOT scoped to all `✗`.** Flooring every reach ✗ demotes 55% of the board off n=3.
Flooring only `0/3` demotes **35%** (694 of 1,974) and only where the ask printed on *no* day of the
recent window — the one cell where the 3-sample read is least ambiguous.

**Gate.** Ships only if DS1 shows the 0/3 cell has a materially lower ask-print rate at the 24h
horizon than the 2/3 and 3/3 cells, **with n stated**. If DS1 comes back `unknown` on most rows
(the archive-coverage risk in DS1), this chunk **does not ship** — say so and move on.

**Files.** `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/capeff-digest.test.mjs`,
`.claude/skills/scan/SKILL.md`, `docs/MARKET-ANALYSIS.md`, `docs/SIGNAL-AUDIT.md`.

**Verified by.** Fixtures: a 0/3 row with the highest `rankKey` sinks below a 3/3 row and **still
renders**; a 1/3 row is untouched; an exempt (`reachFrac === null`) row is untouched; the crossable
floor still wins over the reach floor. Live A/B: run with and without a `--digest-reach-floor 0|1`
flag and diff the two boards.

**Rollback.** Delete the second tier from `key`. Ship it **behind a flag defaulting to off for one
week** so the rollback is a config change, not a revert.

**Impact / confidence / risk / effort / reversible.** Benefit: on the anchor board, this moves the
`A- fill-now` row from #5 to #1 and pushes the C/D `sell unreliable` block below the divider — the
single change that most directly fixes the complaint. Confidence **conditional** — the *mechanism* is
certain, the *justification* is entirely DS1's to supply. **Risk of cutting a good candidate: the
highest of any chunk here.** 35% of rows move, on a 3-sample statistic, and the tool has zero
measured evidence today that a 0/3 ask fails to clear. That is exactly why it is gated and
flag-defaulted-off. Effort **S** (the code) / **M** (the evidence). Reversible.

---

### DS5 — reconcile `capEfficiency`'s lap ceiling **[S]** · do-later

**What changes.** `holdDays` (`:570–581`) applies `LAPS_PER_DAY_CEIL = 6` to the churn branch only,
leaving non-churn families an implicit 24 laps/day via the 1h `holdDays` floor (§0.5b). Apply the
same ceiling to both branches — i.e. floor non-churn `holdDays` at `1 / LAPS_PER_DAY_CEIL` — or
document, in the module header, why a band lane may lap 4× faster than a churn lane.

**Files.** `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/capeff-digest.test.mjs`,
`docs/MARKET-ANALYSIS.md`.

**Verified by.** Existing tests at `:35–55` pin the current arithmetic and **will fail** — that is
the acceptance signal; each is updated with the new expected value and a comment naming the ruling.
Live: print the digest before/after and show which rows moved.

**Rollback.** Revert the floor. Note the existing tests then need reverting too — keep the change
and its test edits in one commit so `git revert` is clean.

**Impact / confidence / risk / effort / reversible.** Benefit: removes an inversion that
systematically inflates fast-TTF band rows — the class currently occupying the top of the board
(Camphor logs at 104.89%/d on the anchor board). Confidence that the **inconsistency is real**:
**high** (read it off the two branches). Confidence that **6 is the right ceiling for band**:
**low** — `LAPS_PER_DAY_CEIL` derives from the 4h buy-limit window, which is a *buy-side* constraint
and only loosely a *hold-cycle* constraint. Risk: it re-orders the board with no fill evidence, so
**consider gating on DS1 too**. Effort **S**. Reversible.

---

### DS6 — exit-pool column, **REPLACING `deploy`** **[S]** · **promoted to do-first** (Ruling 8)

> **RULED (Ben, 2026-08-07): `pool` REPLACES `deploy`; it is not a 10th column.** The open
> column-budget question below is closed — the digest stays 9 columns wide and `deploy` is deleted
> outright. Ben: *"I don't care about that column, it's not important."* This also removes the only
> reason this chunk was do-later (the width concern), and it pairs naturally with DS2 since both are
> single-cell render changes to `digestCells` with no re-rank.
>
> **Sort-key note:** `deployable` still feeds `rankKey` (`:788`) — this chunk removes the *column*,
> not the field. Whether a saturating factor belongs in the sort at all is §0.5a's finding and stays
> open; do not silently change the ordering while deleting the column.

**What changes.** Replace the `deploy` column in `digestCells` with the **exit pool** — the deployed
position as a share of daily flow, e.g. `deploy ÷ (volDay × price)` rendered as `pool 3%` / `pool 71%`.
All inputs are in hand (`row.volDay` at `:773`, `deployable` at `:774`); zero new fetch.

**Why it matters more than it looks.** §0.5a shows `deploy` saturates at the capital cap on ~60% of
rows, so the `deploy` column currently reads `56.34m` for most of the board and tells the reader
nothing. The exit-pool share is the number that *doesn't* saturate, and it is the honest answer to
"can I actually get out of this size".

**Files.** `pipeline/commands/screen-flip-niches.mjs`, `pipeline/test/capeff-digest.test.mjs`,
`.claude/skills/scan/SKILL.md`, `docs/MARKET-ANALYSIS.md`.

**Verified by.** Fixture on the arithmetic + a null-degrade (`—`, never `0%`). Live: the saturated
rows should show visibly different pool shares despite identical `deploy`.

**Rollback.** Remove the column.

**Impact / confidence / risk / effort / reversible.** Benefit: makes the saturation visible without
touching the ranking. Confidence **high** (arithmetic on in-hand fields). Risk **zero** (inform-only,
no re-rank). Effort **S**. Reversible. *Note: the table is already 9 columns wide; if a 10th is too
much, this replaces `deploy` rather than joining it — a Ben call.*

---

### DS7 — fold the drift read into the table **[S]** · do-later, low priority

**What changes.** `enrichDigestDrift` (`:846–863`) already computes a per-row drift and already
relabels band/churn `fill-now` rows. Add a compact `drift` cell (`↓ 800k/d` / `↑ 217/d` / `—`) so the
number sits beside the verdict it modifies, and keep the sub-list for the full note.

**Files / verification / rollback.** As DS6.

**Impact.** Benefit **low-moderate** — the information is already printed, three lines lower.
Confidence **high**. Risk **zero**. Effort **S**. Reversible. *This is the chunk to cut first if the
wave needs trimming.*

---

### DS8 — 90-day retention on the suggestions ledger **[M]** · do-first, cheap (Ruling 7)

**Why this exists.** Ben's question was whether the 88k not-taken rows are worth keeping at all. The
answer from DS1's pilot is **yes, emphatically** — 99.9% of them are joinable against the price
archive, and they are the *only* sample any digest study will ever have (fills will never arrive:
92 filled / 88,272 not-taken). But there is no retention policy today, and the ledger grows
**~13k rows/day at ~1.2KB each** (July: 82,993 rows / 75MB; live file 5,630 rows / 6.8MB).
Unbounded, that is ~900MB/year on top of a **505MB** market archive.

> **The archive is now LOCAL-ONLY (Ben, 2026-08-07).** `pipeline/suggestions-archive/` is gitignored
> and dropped from `sync-fills.mjs --publish`'s commit set, so DS8's retention rule governs a **single
> uncopied file on one disk** — and DS1's counterfactual evidence base (82,993 rows) has **no repo
> backup**. That raises the cost of rule 2's over-pruning failure from "recoverable from git history"
> to "gone". Considered and rejected: gzipping the rolled months (71.5MB → 7.9MB, **9×**), which
> would have kept them in-repo at a tolerable size.

**What changes.**
1. A retention utility (mirroring `archive.mjs`'s shipped-but-unused `pruneBefore` shape,
   `:241–266`) that rolls `suggestions.jsonl` rows older than **90 days** into
   `pipeline/suggestions-archive/` and prunes archive months beyond the window.
2. **Never prune below the market archive's own span** — the ledger is worthless without the price
   history to join it to, and useless to keep beyond it. Today that span is ~71 days
   (2026-05-29 → now), so 90 days is already the binding constraint; the utility should read the
   archive span and refuse to prune inside it rather than trusting the constant.
3. **Opportunistic cleanup:** ~3,134 rows carry `mode: 'spread'` (756) or `'rising'` (2,378) —
   niches DELETED from the codebase. Dead schema; drop them on the first roll.

**Files.** one new command + test, `README.md` inventory, `pipeline/FILLS-PIPELINE.md`.

**Verified by.** Fixture: a row at 89d survives, 91d rolls, and a row inside the archive span is
refused regardless of age. Live: row count before/after, and `report-retro.mjs` still runs.

**Rollback.** The rolled rows are moved, never deleted, until a second explicit prune step.

**Impact / confidence / risk / effort / reversible.** Benefit: bounds unbounded growth and removes
dead-schema rows; **does not improve any read** — this is hygiene, not performance. Confidence
**high**. Risk **low**, but non-zero in one direction only: pruning too aggressively destroys
irreplaceable evidence, which is why rule 2 above is a hard refusal rather than a warning. Effort
**S**. Reversible while rows are moved rather than deleted.

---

### DS9 — TIERED market-archive retention: `5m` 30d / `1h` 90d **[M]** · do-first (Ben, 2026-08-07)

**Ben's proposal, and it is the right shape.** *"Is the 5m data valuable after 30 days? Maybe we can
prune the high resolution to keep only a month and leave the lower resolution data for 90 days."*
`archive.mjs:253` independently reached the same conclusion on 2026-07-28 — *"/5m is ~86% of the
growth (288 buckets/day vs 24), so it is the only grain worth pruning"* — but blocked itself on a
missing input: *"it needs a **stated horizon per consumer**, not a blanket date."* This chunk supplies
that input and unblocks it.

**The stated horizon per consumer (measured 2026-08-07 — the missing input):**

| `5m` consumer | Lookback | Where |
| --- | --- | --- |
| `loadBands` — the 2h band basis | **2 hours** | `marketfetch.mjs:451` (`nWin = 24`) |
| `quote-items.mjs` — the `↗ windowExit` 5m-grain reach | **14 days** | `:812`, `windowStats({ nights: 14 })` hard-coded |
| `analyze-fill-placement.mjs` — AC1/AC2 placement + smoothing bias | **~15 days** | `:100–102`, bounded by the fetched 1h span (wiki returns 365×1h) |
| `read-window-range.mjs` — the trio's `5m-grain` line | **14 default; 21 in doctrine** | `:171`, `windowStats({ nights: NIGHTS })` — NIGHTS is the `--nights` flag |

**Verdict: 30 days is safe with ~9 days of margin.** The deepest *documented* 5m need is **21 days**
— the `--nights 21` that the froth-entry diligence and big-ticket hold-vs-cut reads prescribe
(`/scan`, `/positions`). Nothing reads 5m beyond that.

**Two honest caveats, neither blocking.**
1. `--nights` is **user-settable and uncapped**, so `--nights 60` would exceed the window. The failure
   mode is already graceful and visible, not silent: the 5m read is gated on `FIVE_MIN_MIN_DAYS`
   covered days and **degrades to 1h-only**, labelled (`read-window-range.mjs:69,160–161`). It omits,
   it never fabricates. That is what makes this low-risk.
2. **A future high-resolution counterfactual is the one thing that could want deep 5m.** DS1's pilot
   used the `1h` grain and was fine, but DS1-full's 12h/48h horizons and DS3's placement work might
   prefer 5m across the ledger's full 90 days. If that ever happens the tier is the constraint —
   revisit then; do not pre-build for it.

**Disk — this makes SP5's accepted cost a non-issue.** Using `archive.mjs:248–252`'s own measured
constants (45.4 bytes/row; `/1h` 72k rows/day; `/5m` 455k rows/day at 100% capture):

| | rows | size |
| --- | --- | --- |
| `5m` × 30d | 13.65M | ~620MB |
| `1h` × 90d | 6.48M | ~294MB |
| **steady state** | **~20.1M** | **~0.9GB, BOUNDED** |

Against ~8.1GB/yr growing forever without it. **Ruling 10 accepted unbounded growth; this chunk means
Ben does not have to live with it** — the tick change's cost is absorbed entirely by the tier.

**What changes.** `pruneBefore(ts)` (`:261–266`) is a **blanket all-grain** delete and is the wrong
shape here — it would take `1h` down with `5m`. Add a per-grain variant
(`DELETE FROM observations WHERE ts < ? AND grain = ?`, plus the matching `buckets` row) and a thin
command that applies the two horizons. Keep `pruneBefore` as-is; do not repurpose it.

**Files.** `pipeline/lib/market/archive.mjs` (new per-grain prune + fold the horizon table into the
`:241–260` comment, which is its ONE home — do not duplicate it into this plan long-term), one new
command + test, `README.md` inventory.

**Verified by.** Fixture: a `1h` row at 89d survives a `5m`-scoped prune; a `5m` row at 31d is
deleted and its `1h` sibling at the same ts is not; `buckets` stays consistent with `observations`.
Live: run the Ruling-10 grain query before/after — `1h` span unchanged, `5m` span → 30d — then
re-run the verification trio on a held item and confirm the `5m-grain` line still renders.

**Rollback — the safety copy is a LIFECYCLE, not a one-off (Ben, 2026-08-07).** Deleted rows are
**not** recoverable from the archive itself, but they ARE re-fetchable from the wiki's bulk
`/5m?timestamp=` endpoint for any bucket, so a mis-prune costs a backfill rather than the data. The
copy exists to make that backfill unnecessary for the *first* run only, and it must be **taken and
then removed**, as explicit numbered steps — a 505MB+ orphan is the failure mode this avoids:

1. **Immediately before** the first live prune (NOT in advance — a copy taken days early is a
   stale copy, worse than none because it invites false confidence):
   `cp pipeline/.market-archive.sqlite pipeline/.market-archive.sqlite.prebak`
   Include the `-wal`/`-shm` sidecars, or checkpoint WAL first, or the copy is not consistent.
   The `.cache`/archive paths are already gitignored (OR2) — confirm `.prebak` is too before writing
   it, so a 505MB blob can never reach a commit.
2. Run the prune.
3. **Validate** — all four must pass before the copy goes:
   - the Ruling-10 grain query: `1h` span unchanged at ~90d, `5m` span now ~30d, row counts match
     the predicted ~20.1M;
   - the verification trio on a held item still renders its `5m-grain` line (i.e. the prune did not
     drop coverage the 14/21-day consumers need);
   - `quote-items.mjs --positions` on a big-ticket lot still renders `↗ windowExit` with a
     `5m-grain reached N/14` clause;
   - a full `screen-flip-niches.mjs --mode all` completes and `loadBands` still fills its 2h window.
4. **Delete the copy** — `rm pipeline/.market-archive.sqlite.prebak`. This step is part of the chunk's
   definition of done; DS9 is **not complete while the `.prebak` exists**.
5. If any validation in (3) fails: restore from the copy, and only then investigate.

**Status 2026-08-07: no copy exists.** DS9 has not been built or run; the archive is untouched at
505MB. Step 1 happens at execution time, not now.

**Impact / confidence / risk / effort / reversible.** Benefit: bounds the archive at ~0.9GB instead of
~8.1GB/yr, and removes the only cost objection to SP5. Confidence **high** — the horizons are
measured, not assumed, and the degradation path is already built. Risk **low but not zero**: it is the
only chunk in this wave that **destroys data**, which is why the horizon table above is the gate and
why a file copy precedes the first run. Effort **S**. Reversible only via re-fetch, not undo.

---

### SP1 — parallelise `runWatchlist`'s fetch phase **[P]** · ✅ **SHIPPED 2026-08-07**

> **✅ SHIPPED 2026-08-07.** Landed as specified. `FETCH_CONCURRENCY` hoisted to module scope (was
> function-local in `main()`, invisible to `runWatchlist`) so both pools share ONE politeness bound;
> `sleep` dropped from the imports — no serialized per-fetch throttle remains in the file.
>
> **Measured, cold cache (`rm -rf pipeline/.cache/ts` before each), `--mode band`, 47 unique items:**
> **7s → 1s**, reproduced on a second cold run. Consistent with the arithmetic: ~40 watchlist items
> missed `qcache` × 2 endpoints = ~80 strictly-serial fetches + ~2.4s of pure `sleep(30)`; at
> concurrency 5 with both endpoints in flight that collapses to ~8 rounds.
>
> **Acceptance met.** Full `--verbose` stdout diff across the serial/parallel cold pair: **358 lines
> each, 3 sections each, 47 unique items each, and 7 differing hunks — every one of them a
> `~63min ago` → `~64min ago` elapsed-minute counter advancing because the runs were a minute apart.**
> Zero price, reach-count, grade, or ordering deltas. Watchlist row order diffed identical on both the
> warm and cold pairs. All 104 test suites + import/daemon/forecast/arch/doc guards green.
>
> ⚠ **The win is larger than the plan's 4.0–7.5s estimate on this shape** because `--mode band` fetches
> a smaller survivor pool, so MORE watchlist items fall through to the (previously serial) path. On
> `--mode all` the survivor pool covers more of the watchlist and the absolute saving will be smaller —
> do not quote "7s → 1s" as a whole-scan figure without re-measuring per mode.

**What changes.** Split `runWatchlist` (`:2213–2246`) into (a) a **fetch phase** that, for the
watchlist ids missing from `qcache`, runs a bounded worker pool (`FETCH_CONCURRENCY`, reusing the
`:2650–2671` shape) doing `Promise.all([fetchTsCached(5m), fetchTsCached(6h)])` per item into an
id-keyed Map, then (b) the **existing serial loop, unchanged**, over `wl` order, reading from that
Map. The two `sleep(30)`s go away — the pool bound *is* the politeness throttle, exactly as the
comment at `:2643–2645` already argues for the survivor pool.

**Order-safety is proven, not assumed** — see §0.5g: the loop body is pure, `rows`/`sugg` keep `wl`
order because the compute loop is untouched, `logSuggestions` still fires once after it, and
`loadWatchlist` dedupes ids so no two workers write the same cache file.

**Files.** `pipeline/commands/screen-flip-niches.mjs` only.

**Verified by.** **Byte-identical stdout.** Run the scan twice with the ts cache pre-warmed
(`fetchTsCached` TTLs make the payloads stable within the window), capture `--verbose` output before
and after, `diff` them — must be empty. Plus: `suggestions.jsonl`'s watchlist block must be in the
same item order. Plus a wall-clock A/B with the cache cleared.

**Rollback.** Restore the serial loop (one function).

**Impact / confidence / risk / effort / reversible.** **Benefit: 4.0–7.5s off a 14–17s run.**
Measured tail = 6.03s wall / 3.06s in-flight (supplied profile) and 9.45s / 6.01s (this session's
run); at concurrency 5 × 2 endpoints the in-flight collapses to ~0.6–1.2s and the ~2.2s of `sleep`
disappears, leaving ~1.2–1.5s of per-row compute. Expect the tail at **~1.5–2.5s**. **This is not
just a cold-start win** — `TS_TTL_5M = 3 minutes` (`:427`), so at the `/loop` cadence
(`--scan 15`, CLAUDE.md) every 5m series is always re-fetched and the tail is paid on **every** scan.
Confidence **high** — the numbers are measured twice and the code change mirrors an existing,
proven pattern in the same file. Risk of cutting a good candidate: **N/A, behaviour-preserving.**
Effort **S–M**. Fully reversible.

---

### SP2 — cache the SLOW bucketed series on the verification surfaces **[P]** · do-first

**What changes.** `read-window-range.mjs:180` and `read-schedule.mjs:258` switch
`fetchTs(id, '1h')` → `fetchTsCached(id, '1h', TS_TTL_1H)` (15 min, the same constant the scan uses
at `:428`). **`fetchLatest` stays uncached.** No env var, no `COFFER_FETCH_CACHE`.

> **RULED (Ben, 2026-08-07, Ruling 9): the staleness must be SURFACED, not silent.** *"<15-minute
> stale is acceptable as long as we surface how stale it is."* So this chunk is NOT a pure
> byte-identical swap — it adds one visible token naming the age of the served series, e.g.
> `(1h series cached 6m ago)` on the trio's header line, and nothing at all on a cache miss (a live
> fetch has no age to report). Acceptance changes accordingly: **identical NUMBERS, plus one new
> age token on a cache hit** — diff the two runs and confirm the only delta is that token. This
> keeps SP2 honest by the same standard the `⚠ stale live print` note already sets elsewhere, and it
> is what makes a ≤15-minute-stale series safe to price off: the reader can see it.

**Working out the FC1 scoping the header warns about.** `marketfetch.mjs:59–70` says *"NEVER enable
the cache on a position-management or write-committing run (a verdict wants the live book)."* That
warning is about the **live book** — `/latest`, and the 5m band that prices a bid. It is *not* about
a **bucketed 1h series**, which by construction cannot be fresher than its own hour boundary: a
15-minute TTL on it can never serve a value a live fetch would have contradicted within the same
bucket. The correct scoping is therefore **per-call-site and per-endpoint**, not a process-wide env
flag:

| endpoint | cacheable on a decision run? | why |
| --- | --- | --- |
| `/latest` | **no** | the live book; a verdict reads it |
| `/timeseries?timestep=5m` | **no** | prices the bid; moves within the TTL |
| `/timeseries?timestep=1h`, `6h` | **yes**, ≤15 min | bucketed; cannot change within its bucket |
| bulk `/24h`, `/1h?timestamp=`, `/5m?timestamp=` | already cached | own store, check-before-fetch |

`fetchTsCached` is the existing per-endpoint mechanism; `COFFER_FETCH_CACHE=1` stays off, because a
process-wide flag would sweep `/latest` in with the rest — which is precisely what the header
forbids. **Recommendation: never turn `COFFER_FETCH_CACHE` on; extend `fetchTsCached` call sites
instead.**

**Files.** `pipeline/commands/read-window-range.mjs`, `pipeline/commands/read-schedule.mjs`,
`pipeline/lib/market/marketfetch.mjs` (header note recording the scoping ruling),
`docs/MARKET-ANALYSIS.md`.

**Verified by.** Byte-identical stdout for `read-window-range.mjs "<item>" --hourly --days 3` run
twice inside the TTL, and a wall-clock A/B immediately after a scan (the cache is warm ⇒ the 1h pull
should be ~0ms). Confirm `.cache/ts/<id>-1h.json` is the file being hit.

**Rollback.** Revert two one-line call changes.

**Impact / confidence / risk / effort / reversible.** Benefit: on the mandatory post-scan
verification trio, ~0.3–0.8s per item that the scan *just* fetched; on `/schedule -c` over a full
position set, proportionally more. Modest in absolute seconds but it removes a redundant API hit on
every verification, which is also the politeness win. Confidence **high**. Risk: a 1h series up to
15 minutes stale on a `--exit` pricing read — bounded by the bucket boundary, so **low**, but this is
the one perf chunk that is *not* strictly zero-risk and it should be called out to Ben as such.
Effort **XS**. Fully reversible.

---

### SP3 — parallelise `loadBands`'s cold bucket backfill **[P]** · do-later

**What changes.** `marketfetch.mjs:455–462` walks missing `/5m` buckets serially with
`await jget(...)` → `await sleep(70)` → `archive.append(...)`. Split: fetch the missing windows
through a bounded pool (≈4 concurrent) into a Map, then **append serially in window order** (the
append must stay ordered/serial — one SQLite writer).

**Files.** `pipeline/lib/market/marketfetch.mjs` + its tests.

**Verified by.** Byte-identical `bands` object for the same window set (deep-equal against a
pre-change capture); byte-identical `positions.json`/`screen.json`; archive `bucketCount` unchanged.

**Rollback.** Restore the serial loop.

**Impact / confidence / risk / effort / reversible.** Benefit: **~2.0–2.4s of a 5–6s head, and no
more.** Measured, the head is **4.85s idle against only 1.30s in-flight** — the recoverable part is
the 24 × 70ms sleeps (~1.7s) plus fetch serialisation (~0.5s); the residual ~3.3s is
`archive.append` writing whole-market snapshots and **parallelising fetches does not touch it**.
Confidence **high** on the number, because the profile separates in-flight from idle directly.
Risk: `marketfetch.mjs` is imported by every command — highest blast radius of any chunk here — and
4 concurrent whole-market `/5m` payloads is a heavier API burst than 15 concurrent per-item calls.
Effort **M**. Reversible. **Recommend do-later**, after SP1 has banked the larger, safer win.

---

### SP4 — batch `archive.append` across buckets **[P]** · **don't bother (yet)**

`archive.append` (`archive.mjs:126–140`) already wraps each bucket in `BEGIN` with prepared
statements and WAL is on (`:102`), so the remaining win is one transaction boundary per bucket, not
per row. The measured ~175ms/bucket is close to the floor for ~4,000 `node:sqlite` inserts.
**Do not schedule this** unless SP3 lands and the head is still the dominant cost.

---

### SP5 — sub-2h tick + teach `cache-warm` about the `/5m` grain **[P/ops]** · ✅ **APPROVED 2026-08-07 (Ruling 10) — do-first**

> **APPROVED.** The blocker was the archive-growth cost (~13MB/day → ~24MB/day, ~4.9GB/yr →
> ~8.8GB/yr); Ben accepted it explicitly. Ships as **two separable steps** — do them in this order so
> the ops half is provably working before the code half assumes it:
>
> 1. **The tick** — `Set-ScheduledTask` on `TheCofferCacheWarm`'s repetition interval,
>    **4h → 105 min** *(Ben's number, 2026-08-07)*. Inside the 2h `loadBands` window with **15 min of
>    slack**, so a bucket is only missed if a run is skipped *and* the next one is >15 min late.
>    **No code.** Verify by re-reading `Get-ScheduledTaskInfo` and then, after ~a day,
>    re-running the grain query in Ruling 10 — the `5m` buckets/day figure should move 139 → ~288.
>    Rollback is the same one-line command with `4h`.
> 2. **The `healthCheck` `/5m` term** — only meaningful once step 1 is live, because before that a
>    truthful `/5m` health read would just report "cold" every time by design.
>
> **Expected benefit:** interactive scan head **5.5s → ~294ms**, and it stacks with SP1 (disjoint
> phases — SP1 is per-item `/timeseries`, this is bulk `/5m` buckets). **Second benefit, arguably the
> larger one:** archive *completeness* goes 48.3% → ~100% on the 5m grain, which directly improves the
> evidence base every future counterfactual (DS1, DS3) joins against.

`cache-warm`'s `healthCheck` (`cache-warm.mjs:99–113`) measures only `newest1hAgeHours`, while
`start` (`:145`) warms `/1h` **and** `/5m` — and the interactive cost measured in B2 is entirely the
`/5m` grain, whose 2h × 24-bucket window ages out completely in **2 hours** against a **4h** Task
Scheduler tick (§0.5h). Adding a `/5m` freshness term to `healthCheck` is a small code change, **but
it only helps if the tick is more frequent than 2h** — which is a Ben-owned scheduling decision, not
a code change. **Surface the finding; do not build until Ben rules on the tick interval.**

> **MEASURED 2026-08-07 — what the tick actually does (correcting a natural misreading).** The
> scheduled task is `TheCofferCacheWarm` → `pipeline/daemons/run-cache-warm.cmd`, repetition
> **every 4h** (observed: last 10:05, next 14:05, `LastTaskResult 0`). `start()` (`:139`) calls
> exactly two things, both zero-git, both `hasBucket`-guarded check-before-fetch:
>
> | step | endpoint | shape | window |
> | --- | --- | --- | --- |
> | `loadAll24hRolling()` | `/1h?timestamp=W` | **BULK — all items per call** | 24 × 1h buckets |
> | `loadBands()` | `/5m?timestamp=W` | **BULK — all items per call** | 24 × 5m buckets (2h) |
>
> **It does NOT fetch any item individually.** One measured `/5m?timestamp=` call = **156KB, 1,799
> items, ~124ms**; a full cold 24-bucket backfill ≈ **24 calls / ~3.6MB / +1.68s of `sleep(70)`**,
> plus the ~175ms/bucket `archive.append` that B2 identified as the real cost. The per-item
> `/timeseries?id=N` calls — the 398 that dominate a scan — are **never warmed by this daemon**, so
> SP1 and SP5 address disjoint phases and their savings ADD rather than overlap.
>
> **Second-order finding — the 4h tick is lossy, not merely stale.** `loadBands` only ever looks back
> 2h (`nWin = 24`), so at a 4h tick **the window fully rotates between runs and ~half of all 5-minute
> buckets are never captured at all**. A sub-2h tick therefore improves archive *completeness*, not
> just read latency — which matters because the archive is the evidence base for DS1 and every future
> counterfactual. Cost: the archive is already **505MB / 71 days**; doubling 5m capture is a real
> disk consideration to state alongside DS8's retention rule, not a free win.
>
> **Entailment of the change itself:** one `Set-ScheduledTask` repetition-interval edit — **no code**.
> The code half is only the `healthCheck` `/5m` term, which exists so `status` stops reporting
> "fresh" while the grain that actually costs interactive time is cold.

---

## 4. Sequencing

```
do-first   DS0 ──▶ DS1 ─────────────┐            SP1        SP2
           DS2 (independent)        │             │          │
                                    ▼             ▼          ▼
do-later                     DS3 · DS4 · DS5    SP3        SP5(Ben)
                                    DS6
cut-first                           DS7        SP4 (don't bother)
```

- **DS0 → DS1 is a hard dependency** (DS1 has nothing to read without DS0).
- **DS4 and DS5 are gated on DS1** (Ruling 1). DS3 and DS6 are labelling/inform and may ship
  alongside DS2 if Ben prefers, but DS3's `LOW_PLACEMENT` constant is unvalidated either way.
- **Parallel-safety:** every Workstream-A chunk touches the same ~350-line region of
  `screen-flip-niches.mjs` (`:530–900`) and the same test file — **sequence them, do not run them as
  parallel lanes.** SP1 touches `:2213–2246`, a disjoint region, so SP1 **can** run concurrently
  with a DS chunk. SP2/SP3 touch different files entirely and are freely parallel.

---

## 5. Recommended do-first / do-later / don't-bother

| | Chunk | Why |
| --- | --- | --- |
| **DO FIRST** | **SP1** | Largest measured win (4–7.5s of 14–17s), behaviour-preserving, mirrors an existing pattern in the same file, zero decision risk. Do this one even if nothing else ships. |
| | **DS0** | Nothing about the digest survives a pass today. Every other Workstream-A decision is blocked on it and it changes nothing Ben sees. |
| | **DS2** | Pure honesty. `askRecDays === 3` on 100% of rows is a *measured* fact, and rendering a 3-sample binomial as a bare `✗` on 55% of the board is the defect. No demotion, no risk. |
| | **SP2** | Two one-line changes; removes a redundant API pull on every verification read; settles the FC1 scoping question with a written ruling. |
| | **DS6** | **Promoted (Ruling 8).** Now a straight swap of a column that reads `56.34m` on 60% of rows for one that doesn't saturate. Same file and shape as DS2 — ship them together. |
| | **SP5-tick** ✅ *approved (Ruling 10)* | Second-largest perf win (head 5.5s → ~294ms) for a **`Set-ScheduledTask` interval edit, no code**. Also fixes archive completeness (5m capture 48.3% → ~100%). Growth cost ~13→24MB/day accepted. |
| | **DS8** | Bounds a ledger growing ~13k rows/day with no policy, and drops ~3,134 dead-schema rows. Cheap, and DS1 has now proven the data is worth protecting. |
| | **DS1 (full)** | The pilot already answered the gating question. The full chunk is now a *refinement* (12h/48h horizons, the `≤p05` bucket DS3 needs, per-mode conditioning) — valuable, no longer blocking. |
| **DO LATER** | **DS3** | Real 11%-of-rows blind spot, but `LOW_PLACEMENT = 0.05` is invented — better after the full DS1 can move it. |
| | **DS5** | The inconsistency is certain; the right ceiling is not. Re-orders the board with no evidence — gate it. |
| | **SP3** | ~2s of a 5–6s head, on the highest-blast-radius file. Largely subsumed if the tick change lands — re-measure before scheduling. |
| | **SP5-code** | The `healthCheck` `/5m` term. Only meaningful once the tick is <2h; build it with the tick, not before. |
| **DON'T BOTHER** | **SP4** | The transaction batching is already done per bucket; the remaining win is small. |
| | **DS7** | The information is already on screen three lines lower. Cut this first if the wave needs trimming. |
| **SHELVED** | **DS4** | ❌ Its own gate rejected it: a 0/3 ask prints **55.4%** of the time within 24h. Revive only on a narrower predictive *conjunction*, never on the gradient alone. |

**Shipping sequence (revised 2026-08-07; DS2 has since shipped via SEP12, and Workstream A's premise
is superseded — see the banner at the top):** `SP5-tick ✅done → SP1 → DS0 → DS2 + DS6 → SP2 → SP5-code → DS8 + DS9`,
with the full DS1 and DS3/DS5 as follow-ons.

*Why the tick goes first:* it is the only step with **no code at all** (one `Set-ScheduledTask`
command), it needs ~a day of elapsed time before its effect is verifiable in the grain query, and
every later perf measurement is cleaner taken against an already-warm archive. Its code half
(SP5-code, the `healthCheck` `/5m` term) deliberately lands late — it can only tell the truth once
the tick is live.

**Headline numbers.** Perf: **~14–17s → ~8–11s** from SP1 alone; the tick change takes the head from
**5.5s → ~294ms** on top of that, and the two are disjoint (SP1 fixes per-item `/timeseries`, the tick
fixes bulk `/5m` buckets). The survivor burst (2.0s / 328 calls / peak concurrency 15) is already
optimal and must not be touched. Signal: on the anchor board, **9 of 11 rows read `sell unreliable`
and the top four graded C/C/D/B-**; DS2 + DS6 make the 55%-of-board `✗` and the saturated `deploy`
column legible. **The board is no longer re-ranked by this wave** — DS4 was the only chunk that would
have, and the evidence rejected it.

---

## 6. Encoding boundary

| Rule | Disposition |
| --- | --- |
| "a 3-day reach read is a weak sample" | **ENCODE** (DS2 — render the counts). It is arithmetic, not taste. |
| "a p0 ask means the reach read is uninformative" | **ENCODE** (DS3 — `placementFloored` + the label). |
| "an ask that didn't print in 3 days shouldn't top the board" | **DO NOT ENCODE — TESTED AND REJECTED (2026-08-07).** DS1's pilot measured it: such an ask still prints 55.4% of the time within 24h (n=776). It stays judgment in `/scan`, and `/scan` should stop treating a bare `✗` as disqualifying. |
| "how much of the pool can I actually exit into" | **ENCODE** (DS6 — the arithmetic exists). |
| "which of these is worth a closer look" | **STAYS JUDGMENT** — the digest ranks; Ben picks. Unchanged from PLAN-CAPITAL-EFFICIENCY-AND-DIGEST §1.4. |
| the `/scan` skill's digest paragraph | **RETIRE the stale column list** — it names `Item \| capEff \| deploy \| reach \| phase \| soft-buy \| grade \| verdict`, but the code has printed a `trend` column since R4b (`:894`). Fix in place with the first DS chunk that ships (rule-8 reconciliation), not as a trailer. |

---

## 7. Bookkeeping & compatibility checklist (per chunk, not deferred)

- **README inventory** at file creation: `plans/PLAN-DIGEST-SIGNAL-AND-SCAN-PERF.md` (this doc, added
  with the plan), and at DS1 both `pipeline/commands/report-digest.mjs` and
  `pipeline/lib/render/digeststudy.mjs`.
- **Ledger schema**: DS0 is additive-only (YS2 absent-field pattern). No schema version bump; old
  rows keep parsing; `suggestlog.mjs`'s header field list is updated in the same commit.
- **`screen.json` shape is FROZEN at schema 2** — no chunk here touches it (the digest has never
  been in it; `:2739–2754` builds from `rows`).
- **`APP_VERSION`**: **no bump on any chunk here.** Every change is pipeline/console-only; nothing in
  `js/` that the deployed app loads changes. (DS5 touches `holdDays`, which lives in
  `screen-flip-niches.mjs`, not `js/`.)
- **SKILL frontmatter**: `/scan` `version:` bumps on DS2/DS3/DS4/DS6 (any board change); `/schedule`
  on SP2 only if its output note changes (it should not).
- **CI**: nothing new to wire — DS1's new files are auto-discovered by `run-tests.mjs` and swept by
  `check-imports`. **Watch `check-dead-exports`**: DS1's pure core must be imported by its command in
  the same commit or CI fails.
- **`.gitignore`**: nothing new (DS1 reads existing caches, writes nothing).
- **Plan lifecycle**: this doc folds into `PLAN.md` and is deleted when its last shipped chunk lands;
  `lint-plan-lifecycle.mjs` scans `plans/` for docs past their fold-in point.

---

## 8. Honesty (process rule 4) — what is NOT evidence here

- **No chunk in this plan is backed by realised fills.** `report-retro.mjs` over the entire archive
  returns 92 filled + 135 filled-worse against 88,272 not-taken — **100% not-taken to 0 s.f.** The
  digest's own top-8 population is a strict subset of that. There is no per-cell n and there will not
  be one at ~20 lots/day for a long time.
- **The capEff↔pFill relationship is association only, is mostly niche mix, and is mechanically
  coupled.** ρ = −0.185 overall, −0.11/−0.09 within mode; `pFill` is the model's own output and
  `capEff`'s denominator comes from the same estimator. It must not be cited as evidence that a
  high-capEff row fills worse.
- **n is tens, not thousands.** 1,974 logged rows = 61 passes × 302 items, heavily repeated.
- **Every threshold introduced here is a named placeholder**: `LOW_PLACEMENT = 0.05` (DS3, invented
  this session), the `reachHit === 0` scope of DS4 (chosen because it is the *unambiguous* end of a
  4-valued statistic, not because it was measured), and DS5's reuse of `LAPS_PER_DAY_CEIL = 6` for
  the non-churn lane (a *buy-side* constraint applied to a *hold-cycle* question).
- **What would validate them:** DS1's market counterfactual — ask-print rate within 12/24/48h,
  bucketed by reach cell, placement decile and mode, with n printed per cell. **This plan accrues
  that data at DS0 and measures it at DS1.** It does not accrue fill evidence, and it will not.
- **DS1 itself may come back inconclusive.** The `/5m` archive grain is sawtoothed beyond ~24h
  (`cache-warm.mjs` header, corrected 2026-07-27), so the 48h horizon may be `unknown` on many rows.
  If so, the honest outcome is that DS4 and DS5 do not ship — and that is an acceptable result.
- **The perf numbers are two samples, not a distribution.** 13.98s and 16.53s; the tail measured
  6.03s and 9.45s. The API's own latency varies ~2× between runs. Quote SP1's win as a **range**
  (4–7.5s), never a point estimate.

---

## 9. Verification summary (per-chunk acceptance, concrete)

| Chunk | Acceptance |
| --- | --- |
| DS0 | Every scan-logged row carries `digest.*`; one `digestBoard` aggregate line per pass; an old-shaped row still parses; `run-tests.mjs` + `check-imports` + `check-dead-exports` green. |
| DS1 | Pure-core fixtures: ask printed at +6h → `yes`; never printed → `no`; no archive coverage → `unknown` (never a fabricated `no`). Live report prints n on every cell. |
| DS2 | Fixtures for 0/3, 1/3, 2/3, 3/3, exempt `—`, and a missing-full-window degrade. Live counts match the same pass's `estConfidence`. |
| DS3 | `askPlacement 0.02` + reach 3/3 → labelled cell + `below-range — verify regime`; `0.5` → byte-identical; symmetric/exempt untouched; the existing first-match ordering tests still pass with the new rule inserted at its stated priority. |
| DS4 | Highest-`rankKey` 0/3 row sinks below a 3/3 row **and still renders**; 1/3 untouched; exempt untouched; `crossable === false` still wins. Flag-off default ⇒ byte-identical board. |
| DS5 | The four `capEfficiency` tests at `:35–55` updated with new expected values in the same commit; a printed before/after board naming which rows moved. |
| DS6 | Arithmetic fixture + null-degrade to `—`. Saturated rows show differing pool shares at identical `deploy`. |
| SP1 | **`diff` of `--verbose` stdout before/after is empty** (ts cache pre-warmed); watchlist rows and `suggestions.jsonl` entries in identical order; wall-clock A/B recorded. |
| SP2 | Byte-identical `read-window-range --hourly --days 3` twice inside the TTL; `.cache/ts/<id>-1h.json` confirmed as the hit. |
| SP3 | Deep-equal `bands` object vs a pre-change capture; `positions.json`/`screen.json` byte-identical; archive `bucketCount` unchanged. |

---

## 10. Open questions for Ben

**All five original questions were ANSWERED 2026-08-07** — recorded as Rulings 3, 7, 8, 9 in §1 and
folded into the chunks. Kept here as decisions of record:

1. ~~Ruling 3 default — accept the market counterfactual?~~ → **YES.** DS1 was then run; its result
   **shelved DS4** rather than graduating it (§DS1, §DS4). The suggestions log is **kept**, with a
   90-day retention rule (DS8) instead of deletion.
2. ~~DS6 column budget — 10th column or replace?~~ → **REPLACE `deploy`.** Digest stays 9 columns
   (Ruling 8).
3. ~~DS4 rollout — flag-off or straight on?~~ → **MOOT.** DS4 is shelved; nothing re-ranks this wave.
4. ~~SP5 — is the tick moveable below 2h?~~ → **YES, and APPROVED** (Ruling 10). A `Set-ScheduledTask`
   interval edit, no code, 4h → 105 min (Ben's number). The 4h tick was *lossy*, not merely stale; the resulting
   archive growth (~13 → ~24MB/day) was measured and explicitly accepted by Ben 2026-08-07.
5. ~~SP2 residual risk — is ≤15-min-stale acceptable?~~ → **YES, provided the age is SURFACED**
   (Ruling 9). SP2 gains one visible age token; acceptance becomes "identical numbers + that token".

### Still open

- ~~**Market-archive retention.**~~ → **RESOLVED same day as DS9** (Ben: tiered `5m` 30d / `1h` 90d).
  Caps the archive at ~0.9GB steady state against ~8.1GB/yr unbounded. The per-consumer horizon table
  `archive.mjs:259` demanded is now measured and lives in DS9.

### Still open

- **Nothing blocking.** The only genuinely unresolved item left in this wave is §0.5a's finding that
  `deployable` saturates and degenerates `rankKey` to raw `capEff` on ~60% of rows. DS6 removes the
  *column*; whether the *factor* belongs in the sort has no chunk and is deliberately unscheduled,
  because it is a re-rank and this wave ships none.
- **Does `deployable` belong in `rankKey` at all?** DS6 removes the column; §0.5a's finding that the
  factor saturates on ~60% of rows (degenerating `rankKey` to raw `capEff`) is untouched by this
  wave and has no chunk. Deliberately left open — it is a re-rank, and this wave ships none.
