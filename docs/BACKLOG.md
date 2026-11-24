# BACKLOG — every open item that has no plan, one line each

Folded from 46 plan files. Full text of any plan: `git show 1cfdda0:plans/<NAME>.md`. `PLAN.md`'s open items were
folded here too (old text: `git show a3e08de:PLAN.md`). Bug numbers are stable ids. "verified" = the code was read when this was written; "reported" = a reader agent's
claim, so re-check before building. Finish or delete a line; do not grow it into prose.

## Bugs

4. verified — `quotecore.js` `mom` is magnitude-blind: a 1 gp print under the 2h band is a `breakdown`, which can headline a CUT. Scale by noise (GN-0). M
5. verified — held-lot exit rung (`quote-items.mjs` "typical exit") has no break-even term (EC5). S
6. verified — `retrojoin.mjs` cannot tell an owner pick from a scan pick. Build before the next `/analyze`. S
8. verified — `analyze.mjs` skips only `(none)`, so `watchlist` can be proposed as a niche to tune. S
10. reported — `collapseOffers` merges two offers when a terminal row is lost and the slot relists: wrong unit cost. Read FILLS-PIPELINE §5.1. M
11. reported — `js/watch.js` shows UNDERWATER without the thesis silencing the console applies (AP3). M
12. reported — capital is multiplied in three times (`THROUGHPUT_CAP_GP`, Path-A gp/d, digest `rankKey`, now only a tie-break); Path-A reads 0/d on a fully deployed book, and capEff is unbounded for dust items. Decide which ONE layer owns capital. M
13. verified — amplitude "Both-leg reach" is pinned by its own 0.5 quantiles (`amplitudescreen.mjs` `AMP_BID_Q`/`AMP_ASK_Q`), and its `bid-`/`ask-unreachable` rejects are really stale-optimistic drops. M
14. verified — `quote-items --positions` logs no estimator fields (ledger only). S
15. reported — mobile-cancel phantom deflates deployable capital; `add-manual-fill` has no cancel mode. M
16. reported — `validate.mjs` `windowHours` above 24 wraps (latent); `valuescreen.mjs` missing `knifeDelta` passes the gate (latent, 0 of 4,041 items); `market.js` labels a falling short series reversion; `eventId` omits price and qty; `askFromSnapshot`/`bidFromSnapshot` take the first match only; value lane ignores bonds; `restartBlindSuspects` uses read order; a Webweaver bow (u) row once printed twice on one board, undiagnosed. S each
17. verified — `dedupeSnapshots` drops an identical repeat manual entry (two events on slot 8 today); people work round it by bumping the slot. Exempting manual slots double-counts those two until they are tombstoned. S
18. verified — regime floor tests are bare thresholds (`windowread.mjs` `FC_FLAT_FRAC`): 0.2 gp/d of rounding flips falling to flat and opens the falling-exclusion gate. Measure how many items sit in the band; consider a deadband. M
19. verified — `--mode reverse` header names rejected items without `r.gate.reasons`. S
20. reported — `logblind.mjs` misses the false-EMPTY restart snapshot (fresh log, every slot EMPTY, FIFO holds), so NOT LISTED prints for listed offers. Display only. M
21. verified — `bondFee(null)` is fee-free while `amplitudescreen.mjs` refuses a bond with no guide; one refusal home in money-math. S

## Decisions waiting on the owner

- F1 calibration: sample gate is met; refresh outcomes first. Candidates: thin-class buy percentile, `TTF_INTRADAY_PRIOR_SEC`.
- AF6: promote `--archive-regime` (archive depth gate met). Then AF7/AF8 retire the fetch reserves; AF3/AF3b (owner: keep, conditional on an archive pool) and AF9 wait on it.
- DS9 archive retention (5m 30d / 1h 90d): the DB is 2.6 GB. The fade, crash and reach scorers read deeper 1h history; check each first.
- Hybrid review composition (broad agent + seam finders + strong verify). Waves 1–2: a load-bearing find cost about 45k tokens for the broad agent, about 154k for finders.
- Unify the two thesis stores (ARCH-2). `reverseListBand` still folds the overshooting pressure ask. FloorValidator relax direction (R3b). Wave-3 ghost-band drop: gate on durable crossability, never the instant tick.
- Registered, never run: the WPC §7b forward test; the holds interpretation layer (§9). Sampled validator pass-logging (owner picks N).
- Multi-user template, MCP bank server: not planned.
- PF1b peak floor: the projected peak follows the live mid down on a soft print. The planned reachable-high floor lags a decline, so it would raise exit prices and loosen the amplitude gate on fallers. If built: only on a non-falling trend, off recent hourly highs.
- FIFO clock is offer PLACEMENT time, undocumented in FILLS-PIPELINE §5.1; a fill-time clock moves realised 39.16m → 35.78m. Document or change.
- F1 evidence is lopsided (no falling cell; the rising cell is mostly one item): direction only, never magnitudes. Reconcile the four clearability constants (0.5%/1% display against 10% gating) there; nothing reads `trancheComfort` back.
- Do not merge `renderValueMode`/`renderMode` or `valueScore`/`estimateRank` until the value lane survives its trial.
- N1 alert delivery mechanism (MONITORING); `pnl.mjs` realised/open P&L by item and period; alert basis (mid or instant side); whether held-lot tables carry Est. columns plus the asym note (an earlier build printed a net under break-even and a footer under the wrong item).

## Chores

- Owner-ruled, unbuilt (PIPELINE-SEPARATION): SEP14 decision-surface stdout plus a per-item note reader (PLAN-LEAN LN5 covers it); SEP16d/e watchlist roles and `extra` wiring; SEP2 console-mutation lint; SEP9; SEP10 `pipeline/measurements/`; SEP15 gate `lint-plan-lifecycle`; SEP11a verify ledger.
- SP2: cache the 1h series in `read-window-range` and `read-schedule`, showing staleness (owner approved). SP5: `/5m` term in the cache-warm health check.
- SM2 surface `awaitingRebuy` on positions, book and schedule; SM5 docs sweep. TR1 "do not widen" note in `admission.mjs`; TR2 print what a reserve slot displaces.
- SC5 graduate `--admission unified` and delete `legacy`. `join-outcomes` RC-S3 gate text is stale. SM3 tombstone check and SM4 reconcile header. `fill-surface` `possible` must use the series' real grain before any consumer (AB7; AB4 flow check and AB5 spike guard come first). GN-1 momentum calibration logging ships with bug 4.
- `isBigTicketUnit`/`Lot` split; name the window in the reach reason; app-import manifest test (E9); tax one-home check (E8); pin lines for the bare `0.85` in `capeff-digest.test.mjs`.
- `join-reach-outcomes`: exclude pre-E2 rows where `estSell === breakEven(estBuy)`. Capital-conditioned fetch reserves (the fixed slot counts bypass the capital-aware rank). Any first-ask baseline from before the `groupCampaigns` keying fix must be re-derived.
- Doc drift: `daemons/registry.mjs` "rides EVERY read"; GLOSSARY lacks `reverse`; FILLS-PIPELINE schema blocks (`type`, `slot`, closed block); 500k floor in EDGE-MAP and VOLUME-VS-BAND findings; `backup.js` UTC date; UA version tokens. Delete `RATE_W`/`ratingParts` (AP4) and the dead `tranche` param of `isThinBigTicket`. Value lane has no `limitValidator`.
- Guards derive scope from a registry, refuse a zero-length read, and report their own count (nine silent under-reports).

## Ideas (each needs a decision it would change before it becomes a plan)

- AB7 `--fill-rate` on window reads · EF0 fold-versus-raw report (also gates Ring-3 and AC4) · `join-patha-outcomes` (LANE-ADMISSION F) · serve survivor 1h series from the archive (now indexed) · peak/dip window-divergence guard · recovering-item `stalePessimistic` flag · suppress a drilled-and-rejected pick for the session · stale-anchor 24h refusal · DS6 exit-pool share instead of `deploy` · falling-liquid big-ticket appendix · offer-keyed fill curves · relief=0 counterfactual co-log · bid depth against live, shown beside guide (BD2) · first-ask/reprice study (folds into LADDERED-STEPDOWN) · wiki game-context note · per-item price-adjustment button on Trends.
- DL3: per-item flush profile (p25/p50 price, cadence, floor stability) from the flush log; bid percentile conditioned on the item, F1 calibrates; n-gated · attention axis: gp per decision, since a band/amp trip spends both daily windows and churn one · price-keyed big-ticket fetch reserve (cap, TOP and gear reserve only reshuffle) · tight-band mid-tier edge (Berserker helm, Dragon scimitar, Rune platebody fail the 1.5% MIN_ROI; needs a `--gate` flag first) · diurnal read on gate-excluded rows · wire probes into watch and score `pipeline/probes/*.log` · set-to-component ownership (pieces to Ancestral set ≈ +1.95m once) · post-update gear-dump event study · multi-week period detector (autocorrelation of daily mids, 18+ days) · N-day HIGH proximity, forward out of sample · buy 3% under mid and exit +0.5% against 1% under and +2%, gp/day · score P(deep bid touched in 24h) by floor slope · counterfactual join for vetoed and cut rows · grade counts ask reach twice (REACH_GRADE_CAP) · annotated price chart.
- Falling-liquid appendix predicate: two-sided liquid, `BIG_TICKET_GP`, dropped ONLY on trend or knife.

## Dropped (owner veto window)

APP-PARITY AP2/AP5/1.0.0 · ANALYZE AZ3 · ASK-BACKTEST AB6/8/9 · CAPITAL-OPCOST · CODE-REVIEW chunk 2 · DIURNAL-TRIAGE DT5/6 · ESTIMATOR-FIDELITY EF2/EF3 · FLOW-DIET FD5/6 · FORECAST PF6–8 · GRADE-REACH C · GRADE-REWORK G2/3/7 · GATE-NOISE GN-2 · LANE-ADMISSION G–I · REACH-CALIBRATION AC3/AC4b · REACHABILITY RC1–3 · RECENCY-BASIS RB-0/4 · RECENCY-REACHABILITY 2/5/6 · PIPELINE-SEPARATION SEP1b/3/5–8/11b/13 (its cap is rule 10) · THIN-RESERVE TR3–5 · V2-P8 desk · HOLD, DIGEST DS0/1 (moot after SEP12), DS3/4/5/7, DS8 (shipped as monthly rotation).
From PLAN.md: verdict V1–V6 Watch-tab lines · in-app re-scan and fill probability · `--niche` flag · mobile REMOVE editor · log-discovery dedup · SF-5 · reach-surface chunks 6/7/9 · PP1 named patient section · P8 state writer.

## Standing ruling

Falling is not auto-bad: the exclusion is per strategy (`docs/LORE.md`).
Keep `--raw`: a placeholder-model Est. column must never be the only number available.

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
- Both-leg argmax grid search: 3.80% in sample, 0.48% out; ties the median pin (1.84% → 0.49%). The median is the estimator.
- Pre-fetch expGpDay does not predict post-fetch score (12.89m/d proxy fetched at +0.5%): never quote it as forgone profit. The displayed floor marker (Path-A) and the MIN_GPD gate (stage 1) are different numbers.
- Asym pair: no max(shownNet, asymNet) gate, no asym-amplitude gate (90.8% of items pass 3%), no random-offset null (starting-price artifact). "Deep bid is stale on risers" fails on risers.
- Certain-pair screen: negative on all 31 items ≥10m; both legs of a 50/50 pair available the same day 8.5%. No pairRead.
- Depth model ties the window's median hourly high (+0.81% against +0.83%); its competition multiplier cannot be calibrated.
- Entry depth follows amplitude, not trend direction (−2% hit in 4h: rising 51.5, falling 41.9, flat 21.3; the sign flips at 24h). No direction modifier. An exit at mid×(1+x) breaks even at a buy of mid×(1+x)×0.98.
- Big-ticket same-day round trip about 23% (41% entry in 24h, 55.8% exit in 3d) against about 58% under 100k.
- Exclusion is fetch-slot competition, not validators (about 14 rows against 2,184 `thin-reserve-full` in 35d). Never cite the 2.8:1 over-20m tier figure (n=20).
- `reach` is inform everywhere by design: 31.3% of rejects still reached in 8h; 18.2% print by 48h but not 8h, so scoring needs a fill model. A validator pass is never logged: replay the pure function.
- TOP 40→90 adds churn, not the thin big-tickets once named. `--max-price 90m` added 10 rows and displaced 9; `--gear-reserve 10` was worse. Churn's 12% yield is mostly the band partition.
- N-day lows: best +0.26%/7d after tax. Range persistence adds nothing for commodities; big-ticket unmeasured. WK2's first-run 193 periods were an instrument artifact (rerun 0 of 2,516).
- Guide re-anchor prediction: premise dead since 2026-09-30 (3h refresh, ±20% step).
