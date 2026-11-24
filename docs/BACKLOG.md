# BACKLOG — every open item that has no plan, one line each

Folded from 46 plan files. Full text of any plan: `git show 1cfdda0:plans/<NAME>.md`. `PLAN.md`'s Discovered list
is folded here by PLAN-LEAN LN1; until then read both. "verified" = the code was read when this was written; "reported" = a reader agent's
claim, so re-check before building. Finish or delete a line; do not grow it into prose.

## Bugs

3. verified — `reachPhaseNote` reads a missing forecast as slope 0 and prints "trough phase — floor holding"; a test pins the wrong behaviour. S
4. verified — `quotecore.js` `mom` is magnitude-blind: a 1 gp print under the 2h band is a `breakdown`, which can headline a CUT. Scale by noise (GN-0). M
5. verified — held-lot exit rung (`quote-items.mjs` "typical exit") has no break-even term (EC5). S
6. verified — `retrojoin.mjs` cannot tell an owner pick from a scan pick. Build before the next `/analyze`. S
8. verified — `analyze.mjs` skips only `(none)`, so `watchlist` can be proposed as a niche to tune. S
9. verified — `forecast.mjs` projects the peak off the live mid with no reachable-high floor, so a soft print drags it down (PF1b). S
10. reported — `collapseOffers` merges two offers when a terminal row is lost and the slot relists: wrong unit cost. Read FILLS-PIPELINE §5.1. M
11. reported — `js/watch.js` shows UNDERWATER without the thesis silencing the console applies (AP3). M
12. reported — capital is multiplied in three times; digest `rankKey` is 0 on a fully deployed book. M
13. reported — amplitude "Both-leg reach" column is quantile-pinned (always 7/14). M
14. reported — `quote-items --positions` logs no estimator fields. S
17. verified — `dedupeSnapshots` drops an identical repeat manual entry (two events on slot 8 today); people work round it by bumping the slot. Exempting manual slots double-counts those two until they are tombstoned. S
15. reported — mobile-cancel phantom deflates deployable capital; `add-manual-fill` has no cancel mode. M
16. reported — `validate.mjs` `windowHours` above 24 wraps (latent); `valuescreen.mjs` missing `knifeDelta` passes the gate (latent); `market.js` labels a falling short series reversion; `eventId` omits price and qty; `askFromSnapshot`/`bidFromSnapshot` take the first match only; value lane ignores bonds; `restartBlindSuspects` uses read order; a Webweaver bow (u) row once printed twice on one board, undiagnosed. S each

## Decisions waiting on the owner

- F1 calibration: sample gate is met; refresh outcomes first. Candidates: thin-class buy percentile, `TTF_INTRADAY_PRIOR_SEC`.
- AF6: promote `--archive-regime` (archive depth gate met). Then AF7/AF8 retire the fetch reserves; AF3/AF3b (owner: keep, conditional on an archive pool) and AF9 wait on it.
- DS9 archive retention (5m 30d / 1h 90d): the DB is 2.6 GB. The fade, crash and reach scorers read deeper 1h history; check each first.
- Hybrid review composition (broad agent + seam finders + strong verify). Waves 1–2: a load-bearing find cost about 45k tokens for the broad agent, about 154k for finders.
- Unify the two thesis stores (ARCH-2). `reverseListBand` still folds the overshooting pressure ask. FloorValidator relax direction (R3b). Wave-3 ghost-band drop: gate on durable crossability, never the instant tick.
- Registered, never run: the WPC §7b forward test; the holds interpretation layer (§9). Sampled validator pass-logging (owner picks N).
- Multi-user template, MCP bank server: not planned.

## Chores

- Owner-ruled, unbuilt (PIPELINE-SEPARATION): SEP14 decision-surface stdout plus a per-item note reader (PLAN-LEAN LN5 covers it); SEP16d/e watchlist roles and `extra` wiring; SEP2 console-mutation lint; SEP9; SEP10 `pipeline/measurements/`; SEP15 gate `lint-plan-lifecycle`; SEP11a verify ledger.
- SP2: cache the 1h series in `read-window-range` and `read-schedule`, showing staleness (owner approved). SP5: `/5m` term in the cache-warm health check.
- SM2 surface `awaitingRebuy` on positions, book and schedule; SM5 docs sweep. TR1 "do not widen" note in `admission.mjs`; TR2 print what a reserve slot displaces.
- SC5 graduate `--admission unified` and delete `legacy`. `join-outcomes` RC-S3 gate text is stale. SM3 tombstone check and SM4 reconcile header. `fill-surface` `possible` must use the series' real grain before any consumer (AB7; AB4 flow check and AB5 spike guard come first). GN-1 momentum calibration logging ships with bug 4.
- `isBigTicketUnit`/`Lot` split; name the window in the reach reason; app-import manifest test (E9); tax one-home check (E8); pin lines for the bare `0.85` in `capeff-digest.test.mjs`.

## Ideas (each needs a decision it would change before it becomes a plan)

- AB7 `--fill-rate` on window reads · EF0 fold-versus-raw report (also gates Ring-3 and AC4) · `join-patha-outcomes` (LANE-ADMISSION F) · serve survivor 1h series from the archive (now indexed) · peak/dip window-divergence guard · recovering-item `stalePessimistic` flag · suppress a drilled-and-rejected pick for the session · stale-anchor 24h refusal · DS6 exit-pool share instead of `deploy` · falling-liquid big-ticket appendix · offer-keyed fill curves · relief=0 counterfactual co-log · bid depth against live, shown beside guide (BD2) · first-ask/reprice study (folds into LADDERED-STEPDOWN) · wiki game-context note · per-item price-adjustment button on Trends.

## Dropped (owner veto window)

APP-PARITY AP2/AP5/1.0.0 · ANALYZE AZ3 · ASK-BACKTEST AB6/8/9 · CAPITAL-OPCOST · CODE-REVIEW chunk 2 · DIURNAL-TRIAGE DT5/6 · ESTIMATOR-FIDELITY EF2/EF3 · FLOW-DIET FD5/6 · FORECAST PF6–8 · GRADE-REACH C · GRADE-REWORK G2/3/7 · GATE-NOISE GN-2 · LANE-ADMISSION G–I · REACH-CALIBRATION AC3/AC4b · REACHABILITY RC1–3 · RECENCY-BASIS RB-0/4 · RECENCY-REACHABILITY 2/5/6 · PIPELINE-SEPARATION SEP1b/3/5–8/11b/13 (its cap is rule 10) · THIN-RESERVE TR3–5 · V2-P8 desk · HOLD, DIGEST DS0/1 (moot after SEP12), DS3/4/5/7, DS8 (shipped as monthly rotation).

## Standing ruling

Falling is not auto-bad: the exclusion is per strategy (`docs/LORE.md`).

## Measured: do not rebuild

- No rank-based cap on the band table: 7 of 19 real buys sat at rank 16 or lower.
- No queue wall at −5% of guide; the placebo anchor killed the spike. avgHigh bias is not material.
- 1h and 5m give identical reach counts; "5m hides fills" is false. A reach metric cannot rank estimators by price level.
- Grade and rank do not predict "ask printed within 3d": absence of validation, so never filter on grade.
- Archive-versus-live regime flips: 2 of 120. Floor breaks inside a few gp are below derived-6h noise.
- Suggestion-to-fill: a price key yields ~51 unique attributions of 437; no exact correlation scheme, no mobile capture.
- Widening the thin reserve loses at present capital; revisit near 150–200m deployable. The weekly window does not clear tax.
- No opportunity-cost redeploy cut: "elsewhere earns more" is the least trustworthy output. Frame a stuck lot as least-cost exit.
- Restart-blind fills are unrecoverable from the exchange log. The wiki has no Cargo or SMW and no botting signal.
