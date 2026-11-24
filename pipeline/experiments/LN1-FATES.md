# fates-a — PLAN.md lines 1-615 (LN1 extraction, Sonnet pass)

Conventions: "verified" = I read the code/doc line cited; "reported" = taken from PLAN.md's own prose, not re-checked. HOME means the cited file:line really states it (PLAN.md never counts). Homes in `CHANGELOG.md` are cited as history only; where CHANGELOG is the sole home I say so and propose BACKLOG instead if it is a "do not rebuild".

## 1. SHAS (every Status row, L104-239 + wave table L83-98)

AL1 | adaptive-loop pace() tier engine | done 2026-09-19 (no sha in row) — code `pipeline/lib/loop/pace.mjs`
AL2 | run-loop consumes pace(), --mute | OPEN (plans/PLAN-ADAPTIVE-LOOP.md §5)
AL3 | /loop DYNAMIC driver doctrine docs | OPEN
AL4 | event tighteners beyond watch pass | OPEN (optional, gated on AL2 tick log)
AL5 | auto-start skill hooks, overnight non-start | OPEN
BSH H1+H4 | rebuy gate, settled closeout, REVIVE | 2026-09-03 (CHANGELOG pipeline 1.3.0; no sha)
BSH H2+H3 | bond opt-in; per-slot offer winner | bddf12f, 08ebb20
SLT C1-C4 | sale-log worthNet fix, net-primary | dc07707
SLT C5 | taxAmt recorded-tax read | 2026-09-02 (CHANGELOG pipeline 1.2.0; no sha)
DL2 | reactive liquid-flush loop, FLUSH alert | 73eb65e
DL4 | scan auto-nominates dip candidates | 6c9abf2
DL3 | flush-distribution thesis layer | OPEN (n-gated)
DP1 | dip-posture entry classifier | 597f132
PM1 | probe-module system | 6aba80b
TG1 | thesis-gated hold alerts | b2634a1
T1 | standard table v2 | c7b53e7
T2 | Trends sections, last-2h view | 70633f6
O1 | outcomes dataset | b0749bf
K1 | self-improving skills | 283e12a
K2 | memory dedupe | no repo commit
K3 | CLAUDE.md slimming round 2 | ec02495
S1 | screening economics gp-flow | 5ad72a9
S2 | overnight vs active posture | 12e8a86
S3 | watchlist always scanned | 3a38018
Q1 | Gate-0 reliability gap | 23deba0
E1 | local-time audit | 4c8973a
L1 | action logging | 3404681
G1 | PR flow + ruleset | 553c3a6, b57fbe8
M1 | mobile parity GitHub backend | 6789859, d3df7fe
N1 | push-notification alerts | 033318e
P1 | snapshot re-emission dedupe | 5015a5c
D1 | doc reconciliation pass | 2135d49
R1 | reconstruct test harness + CI | c79dcc5
X1 | pipeline dedup | e7e62f5
X2 | dead-scheduler excision | fb9344e
A1 | app dead-code sweep | a2e8318
A2 | app fetch/helper unification | 1aa43ec
A3 | split ledger.js out of ui.js | 7ef1db1
BE1 | break-even 5m tax-cap fix | 82340d5
W1 | trade-analysis cadence (/morning) | 5666eac
CI1 | browser smoke test in CI | 69bf79d
TB1 | sortable table component | 3e40cbe
LU1 | Ledger UX rework | c88df30
FX1 | Finder full-catalog search | c12bf4b
NY1 | niche-yield audit | no repo change
SY1 | sync-fills points in skills | 563da75
NY2 | niche ruling (spread/rising deleted later) | f982a31
OR1 | org map docs | 1822ad9
OR2 | pipeline/lib split | 94781cc
TD1 | glob test runner + money tests | d147bab
TD2 | testability extractions | e442367
TD3 | test sweep | a1110c7
LW1 | local log-watcher core + offers.json | b97c87b, d395864
LW2 | app localhost live-refresh | 9da9910
LW3 | local-watcher docs | 8ad3a45
LH1 | validateSlotTransitions hardening | c0fc711
LH2 | restart-blindness header | f7bd006
LH3 | log-hardening docs | 05ccea6
TC1 | trendcore extraction | eaa5414
GC1 | gateCandidates extraction | cb3eb67
SL1 | suggestlog path regression fix | 1702126
V1+V2 | verdict temporal memory | 8a5d160
V3 | Gate-D lot-context softening | 692baee
V4 | arm-then-confirm conviction gating | 2a87269
V5 | emit-contract standardization | 825469f
V6 | recovery-read + capital companion | PLAN-VERDICT fold commit (no sha)
FC1 | opt-in fetch cache (OFF default) | 0e48b2c
YF1 | historical market-state helper | 2ab0139
YS1 | outcomes schema v2 | 92ffa1c
YS2 | forward prediction-field logging | 27f0baa
YV1 | velocity + capital-utilization | 1ea914d, 7502889, 2fdae81
YT1 | session-thesis memory | 5439fed
YP2 | state-transition scan | 9f60c15
YP1 | guide re-anchor prediction (silent) | a93da6a
YA1 | in-app capital-utilization line | a7fd785
PM2 | probe firing logs | 5ca4f95
SR1 | suggestions.jsonl rotation | 457a7bd
GA1 | .gitattributes LF/CRLF | 3a7f68f
F1 | algorithm feedback loop | GATED
D0 | snapshot + SQLite archive | 7e0e962
V2-P0 | item-context chain, unified verdict | a6dc7d1
V2-P1 | surface extraction, replay harness | f02fbf5, 8db97bf
V2-P2 | validate stage, reachValidator | 910bea1
V2-P3 | floorValidator, term structure | b55f895
V2-P4a | path engine core | e2eed20
V2-P4b | path persistence + migration | ec425f7
V2-P4c | declarative strategy specs | cfcc624
V2-P5 | scalp/value specs, path-aware bids | fe46f2e
V2-P6a | retro-join calibrator | 6c3f1b5
V2-P6b | TTF estimators, rank net*P/TTF | a21f1bc
V2-P6c | empty-result sub-floor fallback | 6432a05
V2-P7 | docs/skills triage, skill-lint | 105326a, f8de508
V2-P8 | desk orchestrator | OPEN (BACKLOG Dropped)
TV1 | per-thesis validators + trajectory | 2026-07-09 (no sha in row)
PF1 | pure diurnal+trend forecast module | 2026-07-10 (no sha); PF2-PF8 OPEN-ish, see rows
ARCH-1 | monitor applies REMOVE tombstones | a24d456
COD-1 | quote-basis ordering fixture | 55861d1
DL1 | doc-drift linter | ef239dc
COD-2 | overnight accumulation table to script | 81d9049
COD-3 | rebidBar/rebidAdvice helper | 5b91d10
COD-4 | quote budgeted ts1h | a923496
DOC-1..4 | docs cleanup | e45cd7b, 560b28b, 1619ff6, 0c9ecca
ARCH-3 | parseGp cross-comments | 6808c58
SWEEP | 07-10 innocuous dedups | ef68792
SF-2 | quote ts1h budget comment | fe57a3b
SF-1 | quantile type-7 one home | 2cbca38
SF-3 | volSrc tag, warm-only bulk read | 3a36a1e
DT1-DT6 | diurnal timing layer | 7756706, 63d5863, aeab7d1, 369f059, f642fef, 296332d
DAEMON P1-P10 | daemon subsystem + manager | 8a372df, df86759, c1c7080, 167c439, 9540d25, 937a687
HT0-HT5 | 3-day hourly drift read | 51da206, 746da1b, 89bfdde, e1d8c1a
RF0-RF6 | reverse-flip harvest | 0dc43ca, 665e22e, 5df6987, 8d9f348, 89bfdde, e1d8c1a
CAP-DEP L1-L3,C1 | deployable shown not modelled | ecbc5de, 10856ab
LIB-SUBDIRS 0-7 | lib regrouped into 7 dirs | 36ee38c, 0193801, 0e0b5f9, 2424834, d527217, 49792ac, 75083c0, C7 no sha
CLEANUP C1-C11 | /cleanup skill + guards | 5f3ac4b, C11 no sha
MT1-MT3 | gear reserve, rotation period line | 86e4aa6
MT-V2 1-3 | mid-tier reserve, paging | no sha ("this wave")
VZ1-VZ6 | one render layer | 2026-07-16 (no sha)
FC1 (2nd) | floor+ceiling slope classifier | c8fee6b
CT1 | derived cash | 2026-07-12; ecbc5de
WX1 | auto ask-exit read on big-ticket lots | 9aeaf7a
PARITY | app/console parity 6 of 10 | 1df4352, 143d7c9, a794f99, a214f4e, 9921c91, 2e1a110, c41bc1c; AP2/AP3/AP5/1.0.0 OPEN
AR1-AR4 | architecture-coherence salvage | 2b7af60, 4c8973a, ceb538b; AR2 never built
A1-A6 | amplitude lane + THE SWAP | 4acd1bb (DT1 re-horizon c50626f)
FPS 1-4 | fetch-pool scaling, VALUE_RESERVE | 5e7e9d9, 0763dbc
VOL24 1-4 | rolling-24h volume recalibration | bd3f254, 42ce665, 69696fc, 195c074, 5851e18
OUTPUT-TABLE | Est. buy/sell default columns | 3b50b7b
BL1-BL4 | both-leg grid search CLOSED NEGATIVE | b8fc8f2 (proposal 9e5a9e3)
DL-0/DL-1-3 | day-low surfacing CLOSED NEGATIVE | 20a45f9 (scoped 03fb76e)
BLINDSPOT #1-#7 | false-negative audit | 746da1b
RVA | reach-validator audit | 5e7e9d9
MWO | multi-week oscillator scoping | 5e7e9d9, 2d3b21f
CV1-CV14 | dead-export validation | 19c3682, executed 219192d
RDP 1-3 | depth/pressure read removal | fce5974 (chunk 4 DECLINED)
REACH-SURFACE | reach surface built then demoted | 88f7df7, 27dd25d, dcf26d4, 18e53c5, e927dd4, 1cfc5ea, d0a698a, d09ede3; 5 CANCELLED; 6/7/9 UNSCHEDULED; 8 executed 0.76.0 (no sha)
PP (L548-614) | patient pair | ca3939e, 02417e4, 21e442e, 00344fb

## 2. ROWS (still-load-bearing facts)

Format: `Lnnn` | fact (<=30 words) | FATE.

### A. Open / gated work
- L107-110 AL2-AL5 | Adaptive loop run-loop consumption, doctrine, auto-start hooks still unbuilt; AL4 optional. | HOME: plans/PLAN-ADAPTIVE-LOOP.md:203-228 (live plan, deleted when AL5 ships) + pipeline/ci/provisional.json:57 passTest "AL2 wires pace() into run-loop; otherwise delete pace.mjs" (verified).
- L117, L279-306 DL3 | Per-item flush profile feeding dip-watchlist + niche spec; resting-bid percentile conditioned on price x liquidity x floor-stability, analyze only SURFACES, F1/Ben calibrate. | BACKLOG Ideas: "DL3 illiquid standing-bid: per-item flush profile (p25/p50 flush price, cadence, floor stability) from the widened flush log; bid percentile item-conditioned, F1/owner calibrate; n-gated." Only code mentions of DL3 exist (js/quotecore.js:1225 "DL3's (unbuilt) standing-bid", screen-flip-niches.mjs:2539, GLOSSARY.md:189 "standing-bid backlog") — none carry the spec.
- L184, L245-277 F1 | Gate 5/5 cells at n>=30 numerically, but 4 flat+1 rising+0 falling, rising cell 68% one item; thin buys under-fill at 0.20 pctile (P~41% vs ~72-75%); TTF_INTRADAY_PRIOR_SEC ~10-100x too slow; constants NOT moved. | HOME (partial): BACKLOG.md:28 names the two candidates; pipeline/commands/f1-calibrate.mjs:250 prints the "lopsided coverage, treat as direction" caveat (verified); js/estimators/families.mjs:83 constant unmoved (verified). Lopsidedness stats are not stored durably: BACKLOG one-liner "F1 evidence is lopsided (0 falling cells; rising cell 68% one item); do not graduate magnitudes before falling/rising coverage" under Decisions waiting.
- L198 V2-P8 | Desk orchestrator pipeline/desk.mjs; open after P0-P5. | HOME: BACKLOG.md:50 "V2-P8 desk" in Dropped (verified). No desk.mjs exists (verified by Glob-less ls of pipeline: no file named in README grep not done; reported).
- L226 PARITY AP2/AP3/AP5/1.0.0 OPEN | AP2/AP5/1.0.0 dropped; AP3 = watch.js UNDERWATER thesis silencing. | HOME: BACKLOG.md:50 (AP2/AP5/1.0.0 Dropped) and bug 11 (BACKLOG.md:19) for AP3.
- L226 AP4 partial | RATE_W weights, ratingParts and profit/hr column still ship, flagged vestigial; Q1 ruled FULL REBASE so teardown is a deletion. | verified js/market.js:224,326 and js/state.js:32 still present. FATE: BACKLOG Chores "AP4: delete RATE_W/ratingParts/profit-hr (vestigial; js/market.js:224, js/state.js:32); app unused so low priority". No other home.
- L239 REACH-SURFACE 6/7/9 | Guards/flavor line, pooled fallback surfaces, clock-hour hazard Option D: unscheduled because chunk 4 demoted the surface to description. | DROP (unscheduled, only matter if a surface variant is revived; folded plan `git show bdea911:plans/PLAN-REACH-SURFACE.md` §5). Optional BACKLOG Ideas tail: "reach-surface chunk 9 clock-hour hazard sits behind a ~5pp falsifier check".
- L239 / CHANGELOG:853-854 Option E | One-step ladder (relist half-dispersion lower on a miss) lifts every contender, most high-askers; a single-shot score is a FLOOR on a relist policy; live lead. | HOME: plans/PLAN-LADDERED-STEPDOWN.md (live DRAFT) + BACKLOG.md:46 "first-ask/reprice study (folds into LADDERED-STEPDOWN)"; join-exit-ev.mjs:273-274 states it (verified).
- L212/L200 PF1 "PF2-PF8 remain OPEN" | PF6-8 dropped; PF1b bug 9; PF2-PF5 surfaces. | HOME: BACKLOG.md:50 "FORECAST PF6-8" Dropped; BACKLOG.md:23 bug 9 (PF1b). PF2-PF5 not named — check whether they shipped (reported: forecast line is quote-items #6 per SIGNAL-AUDIT.md:56, so surfaces exist) -> DROP done.
- L235 RVA "NOT BUILT: reach-outcomes module" | Recommended structured level/side/windowHours + reach-outcomes scorer. | DROP done: pipeline/commands/join-reach-outcomes.mjs exists (verified by CLAUDE.md ask table row + README) and join-reach-basis.mjs.
- L534-537/L428-444 FD5-FD6 | Bids on positions surface -> reclaimable-stale capital line staged. | HOME: BACKLOG.md:50 "FLOW-DIET FD5/6" Dropped (verified).
- L441-444 FD ruling | NO grade term in any filter predicate; rank-based cap on winners table open question. | HOME: BACKLOG.md:58-61 "No rank-based cap on the band table" and "never filter on grade" (verified).
- L446-452 Hybrid review wave 1 | Both arms blind; blind-spot fired both directions; keep broad agent AND verify stage; n=1; wave 2 next. | HOME: BACKLOG.md:31 (Waves 1-2 costs, "Hybrid review composition" decision) (verified); plan file folded in 8ab30e2.

### B. Measured negatives / do-not-rebuild
- L152 NY2 | spread + rising niches DELETED; S1.3 spread-drop deferral moot. | DROP superseded (CLAUDE.md ask table says "spread/rising DELETED"; verified).
- L161 LH1 | EMPTY stays non-evidence; do not resurrect cancel-to-EMPTY inference. | HOME: docs/LORE.md:135, pipeline/FILLS-PIPELINE.md:492, sync-fills.mjs:99 (verified text).
- L169 V4 | Gate-2 breakdown CUT is EXEMPT from arm-then-confirm. | HOME: CLAUDE.md cites pipeline/lib/thesis/watchstate.mjs header (not re-opened by me; reported).
- L158 LW1 | daemon does ZERO git. | HOME: pipeline/commands/watch-log.mjs header + pipeline/ci/check-daemon-safety.mjs (CLAUDE.md names both; reported).
- L172 FC1 fetch cache OFF by default so decision paths are byte-identical. | HOME: pipeline/lib/market/marketfetch.mjs:67 "NEVER enable the ..." (verified).
- L215 HT | per-hour drift slope was a measured non-signal and DELETED (DT3); do not rebuild. | HOME: CLAUDE.md ask-table row for read-window-range (49.7% direction, beat predict-no-change on 6 of 380) (verified in the CLAUDE.md text supplied).
- L214 DAEMON | ensure() refuses local:false git-writers; only cache-warm autoRuns. | HOME: pipeline/daemons/manager.mjs + check-daemon-safety.mjs (reported; CLAUDE.md names the guard).
- L217 CAP-DEP | Deployable number SHOWN + corrected at source; three-bucket automated redesign SHELVED, revisit only if capital sized unattended. | HOME: .claude/skills/book/SKILL.md:61 and scan/SKILL.md:109 mention three-bucket (long lines; verified present, text not fully read); memory deployable-shown-correct-at-source. Acceptable HOME.
- L220 MT1 | Row's warning marker is Path-A gp/d (post-fetch display) while the gate uses Stage-1 expGpDay (pre-fetch) — two numbers against one 500k. | HOME: CHANGELOG.md:4357 only (history). Propose BACKLOG Measured: "floor marker (Path-A gp/d) and MIN_GPD gate (Stage-1 expGpDay) are different numbers; never read one as the other". Fixed in code by MT1 (reported).
- L221 MT-V2 | Success = candidate pool appropriate to AVAILABLE CAPITAL, not "helm admitted"; reserves capital-blind; bump 4->10 rejected; chunk 4 tight-band gear edge not scheduled. | HOME (partial): docs/MARKET-ANALYSIS.md:446-452 states the criterion and says the capital-conditioned reserves follow-up is "PLAN.md Open list" — a dangling pointer. BACKLOG: add Chores line "capital-conditioned fetch reserves (GEAR/MID_TIER/THIN): fixed slot counts are a capital-blind bypass of the capital-aware rank" and repoint MARKET-ANALYSIS.md:451.
- L221/MT note | Class B (Berserker helm) not scoped; real blocker is bandEdge ROI floor. | HOME: CHANGELOG.md:4339-4340 only. Likely DROP (low value) or BACKLOG Ideas one line; the Discovered-section agent owns the "Class B Open entry".
- L222 VZ | Render layer presentation-only; heldDisplay stays authoritative for the verdict word, structural break appended as warning clause. | HOME: pipeline/commands/watch-positions.mjs:503 (verified).
- L223 FC1b floorCeilingTrack | Incomplete TODAY bucket must never feed the fit. | HOME: js/windowread.mjs header per PLAN (reported, not re-opened).
- L224 CT1 | Derived cash is never a verdict/alert input; shortfall reported as inferred injection. | HOME: derive-cash-tiers.mjs header (reported); docs/LORE.md carries the incident (reported).
- L227 AR1-AR4 | AR2 (sunset for --admission legacy) never built; evidence-based trigger instead. | HOME: docs/ARCHITECTURE.md:98 "SUNSET CONDITION ... EVIDENCE-based" (verified). BACKLOG.md:41 SC5 also covers graduating unified.
- L228 A1-A6 THE SWAP | Cycle-period frame is an organizing frame, not an engine; value stays runnable; ledger KEY must not be renamed. | HOME: docs/MARKET-ANALYSIS.md section 3 + GLOSSARY (PLAN says so; reported); CLAUDE.md ask row states the swap (verified).
- L229 FPS | Base TOP was mis-tuned at the reference bankroll; TOP 40->90 and --scale-pool default OFF; the stage-1 proxy that picks the pool is not predictive of post-fetch score (do not read it as forgone profit). | HOME (partial): screen-flip-niches.mjs:6 and :158 comment ("No capital-conditioning curve could fix that", verified); scale-pool ruled out by THIN-RESERVE per BACKLOG.md:64 (verified). Proxy-not-forgone-profit has no durable home: BACKLOG Measured "Stage-1 expGpDay proxy is not predictive of post-fetch score (top excluded row 12.89m/d proxy vs +0.5% real); never quote it as forgone profit".
- L230 VOL24 | Do not re-solve any volume floor against today's legacy distribution; endpoint serves complete UTC-day aggregates 24-48h stale (~1.0x); mechanism of change UNKNOWN; ABSENT from a present map = measured zero; check the clock before concluding sources agree. | HOME: js/quotecore.js:1203-1206 (do not re-solve, DL4_MIN_GP_FLOW provenance), pipeline/lib/market/marketfetch.mjs:244-264 (staleness, clock trap, unknown cause) and js/market.js:271-282 (absent=zero, refuting test) — all verified text.
- L231 OUTPUT-TABLE rule 1 | --raw is a NON-NEGOTIABLE escape hatch: a placeholder-model number must never be the only number available. | Escape hatch exists (MARKET-ANALYSIS.md:59, quote-items.mjs:89) but the "non-negotiable / honesty guard" rationale is NOT stated. BACKLOG Standing ruling: "keep --raw: never make a placeholder-model Est. column the only number available".
- L231 OUTPUT-TABLE rule 2 | BE stays model-free. | HOME: js/estimators/pair.mjs:10,16 "quotecore's breakEven (the ONE model-free BE floor)" (verified).
- L231 OUTPUT-TABLE rule 3 | Held-lot surfaces are INTENT-DIFFERENT; keep Quick on --positions. | HOME: pipeline/commands/quote-items.mjs:89-90 (verified).
- L232 BL1-BL4 | Grid-search argmax of net x joint 3.80% in-sample -> 0.48% OOS vs median pin 1.84% -> 0.49%; lands on an order statistic; median is the robust estimator; reopen only with shrunk estimator OOS. | The measured result is NOT durable: grep finds only CHANGELOG.md:3450,3931 and docs/MARKET-ANALYSIS.md:503 / families.mjs:173 reconciling a calibration figure. BACKLOG Measured: "No argmax grid search for both-leg entry bid/ask: 3.80% in-sample -> 0.48% out-of-sample, ties the median pin (1.84% -> 0.49%); the median is the robust estimator. `git show b8fc8f2`".
- L233 DL-0 | Position near 1/3/7/30-day lows is a real relative signal (1111 +3.96%/7d vs 0000 -1.95%) but not a trade: worst-execution negative everywhere, best +0.26%/7d ~15k gp/d vs 250k floor. | HOME: README.md:840-848 + pipeline/experiments/FLOOR-STRATEGY-FINDINGS.md:395-402 (verified). Note README:842 still cites "PLAN.md's DL-0 Status row" — repoint when PLAN folds.
- L233 DL-0 lesson | A refuting test on a different population than the claim is not a refutation (spread explanation). | HOME: CLAUDE.md rule 11 states the general rule (verified in supplied CLAUDE.md). DROP the specific anecdote.
- L234 BLINDSPOT #2 | Liquid FALLING big-ticket with positive robust-band net is invisible to every discovery niche unless watchlisted; fix = console appendix of items dropped on trend/knife, inform-only. | HOME: BACKLOG.md:46 "falling-liquid big-ticket appendix" (verified).
- L234 BLINDSPOT #4 | REACH_GRADE_CAP double-penalizes ask-reach on top of the rank; FLAW 4b lives in plans/PLAN-GRADE-REWORK.md. | That plan is gone (plans/ lists only 4 files); BACKLOG.md:50 drops GRADE-REWORK G2/3/7. REACH_GRADE_CAP still live (MARKET-ANALYSIS.md:284,695,709). FATE: BACKLOG Ideas one line "grade letter double-counts ask reach (REACH_GRADE_CAP on top of rank); legibility only; FLAW 4b via `git show 1cfdda0:plans/PLAN-GRADE-REWORK.md`".
- L234 BLINDSPOT gates | Five gates found correctly tight (two-sided liquidity, attention floor, Bar E trim, ignored-items quarantine not imported by screen, value 6%/150% band). | HOME: CLAUDE.md "Pricing OK on ignored items" memory + gate doctrine in docs/MARKET-ANALYSIS.md (reported). DROP rest.
- L234 BLINDSPOT limit | Cannot tell whether vetoed/cut items later ran (needs a not-taken counterfactual join). | HOME-ish: BACKLOG.md:58-63 only partly; propose BACKLOG Ideas "no counterfactual join for vetoed/cut items; build only if a decision depends on it".
- L235 RVA | Every spec's reach validator is mode inform; 99.5% of 8,118 rejects never removed a suggestion; ~1 in 3 reach rejects forward-reached 31.3% (rejects) vs 39.2% (cautions). | Mode part verified: js/flip-niches.mjs:280,291,310,338 reach inform. Doc home for the shadow-by-design stance: docs/MARKET-ANALYSIS.md:662 (trajectory INFORM everywhere) ; reach-reject 31.3% forward-reach figure has no durable home. BACKLOG Measured: "reach validator is inform everywhere by design; 31.3% of its rejects forward-reached within 8h (single window, touch not fill); do not graduate to gate on frac alone".
- L236 MWO | oscillationVsKnife label tracks SERIES LENGTH (59.5% at 14d -> 99.9% at 60d; driftless random walk ~100% by 30d); widening the window silently deletes the knife temper; normalise first. | HOME: js/forecast.mjs:429-456 "DON'T-REBUILD" (verified, includes the trap and instruction).
- L236 MWO next step | Fang-class repeatability UNMEASURED not refuted; needs autocorrelation on daily mids over >=3 periods (18-24 days); archive now deep enough; let F-G retro accrue. | Only pipeline/experiments/RANGE-PERSISTENCE-FINDINGS.md:229 touches autocorrelation (as a criticism). BACKLOG Ideas: "multi-week oscillator period detector: autocorrelation of daily mids, peak at lag ~6-8 above lag-1 floor, >=18-24d history; fang class unmeasured; wait for amplitude retro n".
- L237 CV | Dead-export dispositions EXECUTED. | DROP done: js/watch.js:292 uses alertCount with never-re-inline comment (verified); STATUS/selectNominations gone (grep for demandPressure/PRESSURE_EXIT came back empty outside docs; verified for pressure).
- L238 RDP chunk 4 | Declined deletion of clearableAsk/reachableBand/demandPressure; later retired the ASK leg (pressure) via join-exit-ev. | DROP done: `--est-sell pressure` and PRESSURE_EXIT no longer exist (grep verified, only docs/SIGNAL-AUDIT.md mention); docs/SIGNAL-AUDIT.md:36,265 state demandPressure+reachableBand survive. Revival rule (git history) stated in-tree via "git-revivable" (SIGNAL-AUDIT.md:34,257).
- L239 REACH-SURFACE | askStar LOSES to incumbents (asym, reachFold tied); chunk 5 default swap CANCELLED; read-exit-surface prices nothing to trade; nothing retired on a gap narrower than instrument noise; reachFold and depth BLOCKED. | HOME: CLAUDE.md ask rows for read-exit-surface.mjs and join-exit-ev.mjs (verified in supplied text) + join-exit-ev.mjs header per CLAUDE.md. Chunk 8 executed: DROP done (pressure removed; MARKET-ANALYSIS.md:62-63 records retirement, verified).
- L560-573 PATIENT-PAIR measurement | Deep bid touched 17.8%/24h, ask reached 24.2% given touch, round trip 4.3% (1.5% big-ticket); horizon does not rescue. | HOME: README.md:1724 and :2612 + emit.mjs `asymClassRateNote` (verified existence at emit.mjs:347).
- L568-573 DO NOT RE-PROPOSE | max(shownNet, asymNet) gate; ranking on pAsk/pBid; asym-amplitude gate; random-offset matched null. | pAsk/pBid were retired in pipeline 1.9.0 (CHANGELOG.md:11, verified). BACKLOG.md:60-63 has no asym lines. FATE: BACKLOG Measured: "asym pair: no max(shownNet, asymNet) gate (repeal, not filter), no asym-amplitude gate (>=3% on 90.8% of items), no random-offset null (starting-price artifact); round trip 4.3%".
- L575-592 held-lot asym clause | `--positions` renders no Est. cells (verified quote-items.mjs:734 headers [...QUOTE_HEADERS,'Held@',...]) and pushes no kind:'asym' note (verified: asym notes only at :297, :483). | BACKLOG Chores: "positions: asym note + class-rate footer not on --positions (no Est. cells; no kind:'asym' note); decision needed whether held-lot table carries Est. columns".
- L593-610 held-lot asym note built-and-reverted | Defects (a) net printed below lot BE, (b) footer lands under a different item, (c) positions co-log no asym field; spec for redoing. | Fold into the single BACKLOG line above (defects a-c as the re-do spec, reported not re-run).
- L612-614 PP1 | Named patient section deferred; round trip 1.5%, revisit only against these numbers. | DROP (§7 argues against; superseded by measurement) — covered by the patient-pair BACKLOG line.

### C. Standing rulings / specs in long sections
- L321-326 Ben's 2026-07-08 rulings | falling-exclusion amended; evidence-based viability; ONE verdict home in js/; declarative specs; every single-item analysis runs validation. | HOME: CLAUDE.md memory pointers + BACKLOG.md:54 "Falling is not auto-bad" + docs/ARCHITECTURE.md validators row (verified).
- L343-389 Pipeline v2 architecture | Snapshot->Surface->Context->Validate->Path; reject semantics (screens drop, explicit asks never hidden); no-blowup rules (store raw only, derive pure); quarantine = merch view filter only. | HOME: docs/ARCHITECTURE.md (rows 94-98 verified; full text reported) + docs/FLOW.md. DROP the spec text.
- L405-412 watch.mjs under v2 contract | Output contract unchanged; migration is a NOTE until it survives persistMs. | HOME: pipeline/MONITORING.md (reported). DROP.
- L414-418 Honesty | Validator thresholds are named placeholders; scalp provisional off by default. | HOME: CLAUDE.md rule 4 + 13(b) provisional.json (verified).
- L399-403 P8 FUTURE cold-start suggestions | out of scope. | DROP (with V2-P8).
- L454-458 Verdict V1-V6 follow-on | App Watch-tab adoption of context lines NOT built. | DROP (app unused per memory lean-program-decisions).
- L459-463 Screen pre-filter heuristic study | Dump cheap 24h/band features + survive/discard labels; rising niche discards ~30 of 40. | DROP: rising niche deleted (CLAUDE.md "spread/rising DELETED"), premise gone.
- L464-465 Per-item "recommend price adjustment" button | deferred. | HOME: BACKLOG.md:46 "per-item price-adjustment button on Trends" (verified).
- L466-484 Annotated chart (chart.mjs + Trends overlay) | Not built (no pipeline/chart.mjs, verified). | BACKLOG Ideas: "annotated price-path chart: CLI + Trends overlay sharing one render helper (owner called it extremely useful 2026-07-10; app currently unused)".
- L485-487 In-app re-scan | build only if published-scan staleness annoys. | DROP (app unused per memory lean-program-decisions; no repo mention outside PLAN).
- L488-493 Bank-visibility tooling deferred | manual stale clipboard export; bank truth advisory, never into fills.json. | HOME: docs/LORE.md:142-143 (verified) + BACKLOG.md:34 "MCP bank server: not planned".
- L496-500 pnl.mjs go/no-go | Standing P&L helper; build only on owner's word; pnl.mjs absent (verified). | BACKLOG Ideas: "pnl.mjs realized/open P&L by item/period/watchlist off positions.json, share ledgercore periods; owner go/no-go (/book --size board covers part)".
- L501 N1 delivery mechanism | option a/b/c pending live trial. | HOME: pipeline/commands/trigger-alerts.mjs:10 and pipeline/MONITORING.md:864 "option (a) is to be trialed live" (verified).
- L502-504 Smaller product calls | side-specific alerts; mobile REMOVE editor; --niche flag; --max-price default vs big tickets; churn --min-gpd exemption. | No home found by grep. BACKLOG Ideas one line listing the five, or DROP (app unused; owner veto).
- L510-515 Out of scope | App-native offer polling; RuneLite-Android; cloud backend; momVerdict changes from T1; rating cutoff calibration; skills->subagents. | No other home (grep empty). LN1 plan says the folded PLAN keeps "out-of-scope" — keep there verbatim; else BACKLOG Standing ruling.
- L519-546 Completed pointers | Pure history. | DROP (git log / CHANGELOG).
- L83-98 wave table | History. | DROP.

## 3. Cautions for the extractor
- BACKLOG.md:3 still says "Discovered list is folded here by LN1; until then read both" — remains true; I did not read Discovered (L616+).
- Dangling PLAN.md citations that will break on fold: README.md:842 (DL-0 row), js/quotecore.js:1205 (VOL24 row), js/forecast.mjs MWO row cite, marketfetch.mjs:265 (VOL24 row), docs/MARKET-ANALYSIS.md:451 ("PLAN.md Open list"), LORE/ARCHITECTURE. Run `lint-plan-refs.mjs --refs PLAN` before deleting sections.
- plans/ holds 4 live plans: ADAPTIVE-LOOP, CRASH-REPLAY, LADDERED-STEPDOWN, LEAN. PLAN.md's references to PLAN-GRADE-REWORK, PLAN-ESTIMATOR-POSTURE, PLAN-ESTIMATOR-HONEST-SELL, PLAN-REACH-CALIBRATION, PLAN-APP-PARITY point at deleted files.
# Fates for PLAN.md Discovered items, lines 616-1311

Verified against the working tree 2026-11-24. "Bug N" = docs/BACKLOG.md Bugs numbering.

| PLAN.md line | What it is | FATE |
| --- | --- | --- |
| 618 | Retro-join cannot tell an owner pick from a scan pick (`retrojoin.mjs`); remedy `manual:true` flag not built. | HOME docs/BACKLOG.md:14 (bug 6). Verified still open: `retrojoin.mjs` has no manual/owner handling. |
| 630 | PLAN-HOLD-FADE-ALERT HF1-HF5 shipped; FADE alert, `FADE_MIN_HOURS`=4, `join-fade-outcomes.mjs`. | DONE: CHANGELOG.md:33 (pipeline 1.7.0); `join-fade-outcomes` result also in CLAUDE.md ask table and README.md:1411,1964. |
| 656 | PLAN-WEEKDAY-PHASE-CONFOUND, pre-registered 2026-09-08, OPEN; universe test (§3) never run. | HOME (partial) docs/BACKLOG.md:32 ("WPC §7b forward test registered, never run"); plan file no longer exists in plans/. Study script `pipeline/experiments/weekday-phase-confound-study.mjs` exists. TF1-TF3 shipped from it (CHANGELOG.md:105). Nothing else open. |
| 672 | EC5: held-lot "typical exit" ladder (`quote-items.mjs`) has no break-even term; live miss 2026-09-08 (hilt 30.12m vs BE 30.52m). | HOME docs/BACKLOG.md:13 (bug 5). Verified still there: `quote-items.mjs:908` assembles q50/q75/everyDay/recent50 with no BE floor. Could cost money (a rung below BE gets listed). |
| 686 | PLAN-WEEKLY-CYCLE WK1-WK4 shipped: dislocation line `dislocation.mjs`; measured nulls (WK1 flat, WK2 zero FDR of 2,516, WK3 no knife class, elevated >= +4% negative). | DONE (WK4 code `pipeline/lib/signal/dislocation.mjs`) and HOME for the negatives: README.md:903-904 (WK2 zero FDR) and README.md:929 (WK3 no knife class). Add one Measured line for the WK2 instrument-artifact warning (first-run 193 discoveries must never be quoted) if README:903 lacks it. |
| 713 | PLAN-ENTRY-CONFIDENCE EC1-EC4 shipped; forming-day contradiction, dip level+premium on buy line. | DONE: CHANGELOG.md:188 (pipeline 1.4.0). |
| 737 | PLAN-THESIS-FRAME TF1-TF3 shipped; plan is the verdict cell, `declare-thesis --path` refuses without tripwire/until. | DONE: CHANGELOG.md:105 (pipeline 1.5.0). The listed render-only limit (alert-layer thesis silence has no date awareness) is stated there. |
| 764 | Value/Invest lane money path not bond-covered (`afterTaxAmpPct`, `valueAmplitudeValidator` take no item id). | HOME docs/BACKLOG.md:24 (bug 16 "value lane ignores bonds"). Verified: `js/valuescreen.mjs` still has `afterTaxAmpPct` with no guide thread. Latent (value is out of `--mode all`). |
| 770 | `restartBlindSuspects` walks per-slot rows in read order (mtime race). | HOME docs/BACKLOG.md:24 (bug 16). Verified: still in `pipeline/lib/reconstruct/offers.mjs`, used at `watch-positions.mjs:676`. Inform-only. |
| 774 | Bond no-guide refusal duplicated in two private `netOf` helpers; `bondFee(null)` is fee-free. | BACKLOG Chores: "one shared bond no-guide refusal home in money-math; `bondFee(null)`->0 stays fee-free for computeQuote (js/money-math.js:25). The `flip-niches.mjs` copy of `netOf` is gone; `amplitudescreen.mjs:66` remains." |
| 778 | `REPO_DIR` hardcoded to main checkout, so a worktree bare sync writes the live book. | DONE (and BACKLOG bug 7 is STALE): `pipeline/lib/paths.mjs:1-7` now resolves relative to the module (a worktree resolves to itself) with `--repo-dir` override. Delete BACKLOG bug 7. |
| 783 | `Math.min` annihilates real n via pure-prior n:0; FIXED `estSampleN`. | DONE: `js/estimators/families.mjs` `estSampleN`, pinned `pipeline/test/estimators.test.mjs:1023`. |
| 795 | `leanValidators` could not tell PASS from ABSTAIN; FIXED with `abstain: true`. | DONE (stated fixed 2026-08-30; pinned in `validate.test.mjs`; not re-grepped). |
| 804 | `reachability.mjs` scores pre-E2 BE-substitution as the fold's own price; deliberately not fixed, biases reachFold/reachRelief rate down in old rows. | BACKLOG Chores: "`join-reach-outcomes` `readRows` exclusion of pre-E2 `beFloored` rows where `estSell === breakEven(estBuy)`; do alongside the join-reach-basis cost-model port; use `js/quotecore.js` breakEven." Scorer is describe-only so low stakes. |
| 818 | `groupCampaigns` multi-chain keying FIXED; every grouping-derived baseline from before must be re-derived. | DONE: `pipeline/lib/reconstruct/campaigns.mjs`, `pipeline/test/campaigns.test.mjs`. Stale-baseline warning: BACKLOG Chores "PLAN-FIRST-ASK 1.1/1.2 baselines predate the fix, re-derive" only if FIRST-ASK work resumes (it is under LADDERED-STEPDOWN). |
| 830 | Suggestlog pace projection recorded stale-REFUSAL as a reading; FIXED both halves. | DONE (stated fixed 2026-08-30, `suggestlog.test.mjs`; not re-grepped). Forward-record boundary note: DROP (history). |
| 838 | "Certain-pair" screen unsatisfiable on big-ticket (0 of 31 items >= 10m; ~38% of sub-100k); `pairRead` was built and deleted; ≥10m both legs of a 50/50 pair same day 8.5%. | BACKLOG Measured: "A certain-pair screen (max daily low / min daily high) nets negative on 0 of 31 items >=10m (passes ~38% of sub-100k); both legs of a 50/50 pair are available the same day 8.5% of the time on >=10m. Do not rebuild a pairRead; 'reached on ~50% of days' is true by construction (fill-surface.mjs header)." No other home found. |
| 853 | Doc/prose drift (a): `pipeline/daemons/registry.mjs` says sync-fills rides EVERY read. | BACKLOG Chores. Verified still there: `registry.mjs:45,118` ("rides EVERY read"). Cosmetic. |
| 853 | Drift (b): schedule skill "three mutually-exclusive modes"; overnight skill stale line citation. | BACKLOG Chores. Schedule part verified still there (`.claude/skills/schedule/SKILL.md:28`); overnight citation not re-checked. LN6 rewrites those skills, so DROP if LN6 lands first. |
| 853 | Drift (c): `docs/GLOSSARY.md` has no `reverse` flip-niche entry. | BACKLOG Chores. Verified still missing (no "reverse" hit). |
| 853 | Drift (d): `check-imports.mjs` reports a syntax error as ~76 failures naming healthy importers. | DROP: syntax step runs first and names the file (stated in the item); standalone misdirection is cosmetic. |
| 870 | `reachPhaseNote` reads missing forecast as slope 0 and prints "floor holding"; a test codifies it. | HOME docs/BACKLOG.md:11 (bug 3). Verified still there: `screen-flip-niches.mjs:2209-2211`, test pinned `oscillation-reachphase.test.mjs:77-82`. Console-only, misleads a big-ticket multi-day entry. |
| 870 (a) | `valuescreen.mjs` `knifeDelta` coalesces unmeasurable to 0 so gate passes; latent, 0 of 4,041 items hit it. | HOME docs/BACKLOG.md:24 (bug 16 "valuescreen missing knifeDelta passes the gate (latent)"). Verified: `js/valuescreen.mjs:178,249`. Reachability measured ZERO; keep that fact: add "0 of 4,041" to the bug 16 clause. |
| 870 (b) | `js/market.js` `refineTrend`: `mom = m7 ?? m30 ?? 0` labels a short falling series `reversion`. | HOME docs/BACKLOG.md:24 (bug 16). Verified: `js/market.js:345-348`. App-side display only. |
| 870 | Closing a sweep against re-audit is itself the finding. | DROP: general lesson, already carried by CLAUDE.md rule 10/11. |
| 924 | Asym deep bid skews stale on rising items: effect small, non-monotone, Simpson artifact; unreproducible (no script); real study = P(touched within 24h) by floor slope. | BACKLOG Measured: "asym deep-bid 'stale on rising items' mechanism FAILS on risers (touch position non-monotone U, rank correlation positive among risers; stratifier `floor.nUsed===5` vs 14-day outcome mismatch); no committed script; do not act on the pooled number; any rerun writes the script first and reads `archive-series.mjs` (ts vs timestamp trap)." Plus BACKLOG Ideas: "score P(deep bid touched in 24h) by floor slope off the archive." Note `--asym` was retired in pipeline 1.9.0, so the investigation is largely moot. |
| 1005 | `render.test.mjs` printed nothing (quote-items blanked `console.log` at import). | DONE: `node pipeline/test/render.test.mjs` now prints its checks (run 2026-11-24). `quote-items.mjs:1061` still blanks console.log when not VERBOSE, but the test now emits output. |
| 1016 (1) | Missing terminal swallows an offer's fills in `collapseOffers` (~95,000 gp on slot 3, 1 of 2,057). | HOME docs/BACKLOG.md:18 (bug 10, "reported"). Not re-verified; needs tests first. Could cost money (book understates spend). |
| 1016 (2) | Manual-slot exemption hardcoded `slot === 8 \|\| 9`; real events sit on slots 10-14. | HOME docs/BACKLOG.md:9 (bug 1). Verified still there: `pipeline/lib/reconstruct/reconstruct.mjs:198`; `campaigns.mjs:22` uses `>=`. Changes realised P/L. |
| 1016 (3) | FIFO orders by PLACEMENT time, undocumented; 3.4m gp of realised P/L rests on the choice. | BACKLOG Chores/Decisions: "Document the FIFO clock (placement `tsOpen`, not fill) in FILLS-PIPELINE §5.1 and matchTrades header; owner decides whether to change (realised 39.16m vs 35.78m, open lots 37 vs 70)." Verified: FILLS-PIPELINE.md has no mention of placement ordering (grep none). |
| 1016 (4) | FILLS-PIPELINE.md schema blocks contradict real artifacts (`type` buy/sell only, `slot` "0-7 (-1 if unknown)", closed block omits banked/withdrawn/keepRoundTrip). | BACKLOG Chores. Verified still stale: `pipeline/FILLS-PIPELINE.md:123,126`. Doc-only; `-1`/`null` slot collision claim not re-checked. |
| 1016 | `campaigns.mjs` `isManualSlot = slot >= 8` fix. | DONE: `pipeline/lib/reconstruct/campaigns.mjs:22`. |
| 1055 | Guard-scope class: guards that derive scope from a directory listing under-report silently (nine instances); rule = derive from registry, refuse empty reads, take the guard's number. | HOME docs/ARCHITECTURE.md:66 (E11) and `pipeline/ci/check-daemon-safety.mjs:12-15` header cover the daemon instance. The three-part rule itself is not stated as a rule anywhere: BACKLOG Measured/Chores one line: "Guards must derive scope from the registry, refuse zero-length reads, and count with the guard's own number (nine silent under-reports 2026-08-09..14)." |
| 1080 | Falling-but-liquid big-ticket appendix (blindspot #2); predicate (two-sided liquid, big-ticket, excluded ONLY by trend/knife) and the negative drop-reason list. | HOME docs/BACKLOG.md:46 (Ideas "falling-liquid big-ticket appendix"). Predicate detail is not there: extend the line with "(a) two-sided liquid, (b) BIG_TICKET_GP, (c) dropped only on trend/knife, not amp-below-floor/bid-/ask-unreachable/unaffordable". |
| 1093 | value/amplitude render-path duplication (`renderMode` vs `renderValueMode`, `valueScore` vs `estimateRank`) deferred on purpose. | BACKLOG Decisions: "Do not merge `renderValueMode` into `renderMode`/`valueScore` into `estimateRank` (~400 lines x2): deliberate deferral until the value lane survives its trial (/cleanup must not 'fix' it)." Not in BACKLOG now. |
| 1100 | Four live models of "how much clears" with constants spanning 20x (tranche 0.5/1%, CLEARABILITY_FRAC 0.5%, expUnits 10% gates, VALUE/AMP_VOL_SHARE 10%); constants left unretuned, F1-gated. | HOME (partial) docs/MARKET-ANALYSIS.md:1020 documents price-knee naming. Disagreement and harness spec not stated: BACKLOG Decisions: "F1: reconcile the clearability constants (tranche 0.5/1% display, CLEARABILITY_FRAC 0.5% display, expUnits 10% GATING, VALUE/AMP_VOL_SHARE 10%); needs logged trancheComfort/trancheCeiling read-back from suggestions.jsonl, which nothing consumes." Constants verified: `js/valuescreen.mjs:101`. |
| 1100 | Dead param `isThinBigTicket(row, {tranche})`; no caller passes tranche. | BACKLOG Chores (one line). Verified: `js/reverseflip.mjs:211-219` still accepts it. Not re-checked callers. |
| 1141 | `sell unreliable` tag loses to never-gate; four cost regimes (never-gate < 1.29, recent-3 < 1.76, full-window < 2.05, gate-all above); don't quote M(1). | HOME CLAUDE.md ask table row (`join-reach-basis.mjs`) and README.md:1939-1940. Also BACKLOG Decisions: F1 owns `REACH_GRADE_CAP_FRAC` threshold; fine as is. The five pre-registered-not-run items and `watch-positions.mjs:267` unmeasured: DROP (none changes the decision, per the item). |
| 1179 | `HORIZON_AMPLITUDE_SEC` is 2 days while lane holds 4; amplitude fills unattributed. | HOME docs/BACKLOG.md:10 (bug 2). Verified still there: `pipeline/lib/render/retrojoin.mjs:48`. Owner call; changes `/analyze` numbers, not trades. |
| 1191 | Proximity-to-extremes screen: LOW side measured negative twice (+0.26%/7d after tax, ~15k gp/day on 40m); HIGH side/pair open. | HOME for the negative: README.md:840 and `pipeline/experiments/FLOOR-STRATEGY-FINDINGS.md`. BACKLOG Measured line needed: "Proximity to N-day LOWS is not a trade (+0.26%/7d after tax, ~15k gp/day on 40m vs 250k floor); two passes; do not reopen the low side without a new mechanism." HIGH side: BACKLOG Ideas "proximity to N-day HIGHS / low-high range-position rank, forward OOS; decision it would change: primary rank vs context". |
| 1220 | "Bottom of a traversed range": DON'T BUILD for commodities (null 6 of 6 cells, anti-selects, does not beat value lane); big-ticket UNMEASURED. | HOME README.md:850,373 and `pipeline/experiments/RANGE-PERSISTENCE-FINDINGS.md`. Add BACKLOG Measured one line: "Range-persistence criterion: no excess over value lane for commodities; zero items >100k in sample, so fang-class big-ticket is UNMEASURED, not refuted." |
| 1241 | `oscillationVsKnife` OSC label is a function of series length (59.5% at 14d to 99.9% at 60d); a deeper archive series would silently delete the guard. | HOME `js/forecast.mjs:431` header (stated "NO normalisation by series length") and the item's own cited README js/forecast.mjs entry. Verified. The "docs/SIGNAL-AUDIT.md has no row for this signal" bit: BACKLOG Chores, low value; DROP acceptable. |
| 1263 (1) | `pFillValue` n structurally 0 (valueRanges did not emit `coverageDays`). | DONE: `js/valuescreen.mjs:181` now returns `coverageDays`; `families.mjs:156` reads it; `estimators.test.mjs:1023` pins it. |
| 1263 (2) | /scan SKILL.md quoted value liquidity floor 50 vs 3,500. | DONE/GONE: no longer found in `.claude/skills/scan/SKILL.md` (grep). LN6 rewrites that skill anyway. |
| 1263 (3) | Superseded 500k gp/d floor survives live-voice in EDGE-MAP-FINDINGS (x2), VOLUME-VS-BAND-FINDINGS (x1); no lint rule. | BACKLOG Chores. Verified still there: `pipeline/experiments/EDGE-MAP-FINDINGS.md:20,150`, `VOLUME-VS-BAND-FINDINGS.md:116`. Cosmetic (findings files are dated records). |
| 1263 (4) | Value spec's validator block lacks the "dormant in console path" note. | DROP: doc-locality only, softened on review. |
| 1287 | `quote-items --positions` logs no depthExit/reachable/asym/estBuy/estSell on held-lot rows (0 of 81). | HOME docs/BACKLOG.md:22 (bug 14). Verified: `quote-items.mjs:955` passes only verdict/validators/windowExit. depthExit itself is now RETIRED (`suggestlog.mjs:84`), so the depthExit half is moot; estimator-field half remains. Ledger-completeness only, no money effect. |
| 1299 | Depth model does not beat a one-line null (median residual +0.81% vs +0.83%; predictedAsk ~52nd percentile, so not a "floor"; trend-dominated; `DEPTH_COMPETITION_MULT` uncalibratable). | BACKLOG Measured: "Depth model `clearableAsk` is indistinguishable from the window's median hourly high (residual +0.81% vs +0.83%, n=277 episodes/77 items), is trend-dominated, and its competition multiplier is uncalibratable from this book. Do not tune it; accept the null or trend-correct it." `join-depth-outcomes.mjs` no longer exists in pipeline/commands (README.md:3509 still names it; stale). No existing home. |

## Proposed BACKLOG lines (consolidated)

Bugs: delete bug 7 (fixed in `pipeline/lib/paths.mjs`). Add to bug 16: "valuescreen knifeDelta null path fires 0 of 4,041 items (latent)".

Decisions:
- FIFO clock is placement time, undocumented; owner decides whether to change (realised 39.16m vs 35.78m under fill-time clock).
- Do not merge `renderValueMode` into `renderMode` or `valueScore` into `estimateRank` until value survives its trial.
- F1: reconcile the four clearability constants (display 0.5%/1% vs gating 10%); needs `trancheComfort`/`trancheCeiling` read-back from suggestions.jsonl.

Chores:
- Shared bond no-guide refusal in money-math (`bondFee(null)` is fee-free).
- `join-reach-outcomes` readRows exclusion of pre-E2 BE-substituted rows.
- Doc drift: `registry.mjs` "rides EVERY read"; GLOSSARY lacks `reverse`; FILLS-PIPELINE.md:123,126 schema stale; FILLS-PIPELINE lacks the placement-clock statement; 500k floor in EDGE-MAP/VOLUME-VS-BAND findings; README.md:3509 names deleted `join-depth-outcomes.mjs`.
- Dead `tranche` param on `isThinBigTicket`.
- Guards derive scope from the registry, refuse zero-length reads, count with the guard's number.

Ideas:
- HIGH-side proximity / low-high range-position rank, forward OOS.
- Score P(asym deep bid touched in 24h) by floor slope off the archive (only if asym is revived).
- Falling-liquid big-ticket appendix: add the predicate (liquid, BIG_TICKET_GP, dropped only on trend/knife).

Measured: do not rebuild:
- Certain-pair screen: negative on 0 of 31 items >= 10m, passes ~38% of sub-100k; both legs of a 50/50 pair same-day 8.5% on >= 10m; no pairRead.
- Asym deep-bid "stale on rising items": mechanism fails on risers; pooled number is a Simpson artifact; no committed script.
- Proximity to N-day lows is not a trade (+0.26%/7d after tax, ~15k gp/day on 40m); range-persistence adds nothing for commodities; big-ticket unmeasured.
- Depth model `clearableAsk` ~ median hourly high; do not tune `DEPTH_COMPETITION_MULT`.
- WK2: the first-run 193 period "discoveries" were an instrument artifact (corrected rerun 0 of 2,516); never quote first-run numbers.
- OSC label saturates with series length: normalise legs before widening the window (guard header at `js/forecast.mjs:431`).
# Fates for PLAN.md lines 1299-1998 (Discovered list, second half)

Section names: Bugs / Decisions / Chores / Ideas / Measured. "verified" = code read in this pass.

| Line | What it is | FATE |
| --- | --- | --- |
| 1299 | Depth model (`clearableAsk`) no better than "median hourly high" null; DEPTH_COMPETITION_MULT not calibratable | DONE: model retired in pipeline 1.8.0 (CHANGELOG.md:23-27; `join-depth-outcomes.mjs` no longer in pipeline/commands). ALSO propose Measured: "Depth model (clearableAsk) ties a median-hourly-high null (+0.81% vs +0.83% residual), trend-dominated; retired 1.8.0, do not rebuild." |
| 1313 | Validator stack first scored vs outcomes (umbrella; sub-items follow) | see sub-rows |
| 1317 | dip-posture falsified at quoted level (85.7% vs 82.6% @8h, n=5,535); policy reframed | HOME: js/quotecore.js:967 and :987 (GEOMETRY TRAP block in `recentDirection` header) |
| 1326 | `floor` validator retuned (caution 1.0 to 1.5); reject tier unmeasured (censored), R3 escalation unmeasurable | HOME: js/validate.mjs:166-217 (MEASURED / UNMEASURED blocks, `FLOOR_CAUTION_RANGES` :195) |
| 1333 | `reach` inform-only; 8h window vs 1-2d theses, 18.2% print within 48h not 8h; needs fill model | BACKLOG (Measured): "reach validator scored on 8h prints, 18.2% of levels print by 48h but not 8h; a proper score needs a fill model, not a print model." Not stated in validate.mjs header (checked :83-87 covers threshold only) |
| 1337 | `REACH_CAUTION_FRAC` no cut point earns >5pp; continuous signal 9.8pp; closed "don't tune" | HOME: js/validate.mjs:83-87 (THRESHOLD HONESTY block) + :70 |
| 1344 | reach fold basis flipped to full-window, stale bump capped at caution (0.71.3); `--digest` reach column + watch relief note still recent-preferring | HOME for the flip: CHANGELOG.md:3619 (0.71.3). Open tail (digest/relief basis split) is settled by `join-reach-basis.mjs` per CLAUDE.md ask table, so DROP the tail |
| 1349 | `trajectory` measures backwards, demoted gate to inform in value; knife +4.08% vs rising -7.28%; post-update gear dump EVENT study still open | HOME: docs/MARKET-ANALYSIS.md:662, js/flip-niches.mjs:345, docs/LORE.md:120. Open event study: BACKLOG Ideas: "post-update gear-dump event study (71d archive is one regime)" (`join-crash-entry.mjs` partly covers: PLAN-CRASH-REPLAY) |
| 1359 | Exclusion really happens in fetch-slot competition: validators dropped ~14 rows in 35d, `thin-reserve-full` dropped 2,184 averaging 3.83m/d | BACKLOG Measured: "Validators drop ~14 rows/35d; thin-reserve-full dropped 2,184 candidates averaging 3.83m/d expected. Exclusion is fetch-slot competition, not validators." No other home found |
| 1363 | Method note: validator `pass` never logged, studies must REPLAY validator at suggestion timestamp | BACKLOG Measured (method): "A validator pass is never logged (leanValidators keeps non-pass only); score by replaying the pure validator at the row timestamp." Matches the BACKLOG "Sampled validator pass-logging" Decision, so merge there |
| 1367 | Caveat: avgLow/avgHigh crossings are prints not fills; absolute rates are upper bounds | HOME: join-asym/fade/crash headers carry it per CLAUDE.md table (crash entry "every fill is an upper bound"); generic statement DROP |
| 1370 | `gpDay` cyclesDay cap 6 theoretical; Ben ruling max ~2x; windows half done (`ACTIONABLE_WINDOWS_PER_DAY`=2) | DONE: js/desk-cadence.mjs:1-50 (constant at :48, ruling in header) |
| 1382 | ATTENTION axis (gp per decision, band/amp cost both windows, churn one) still unbuilt | BACKLOG Ideas: "attention axis: gp per decision, a band/amp round trip spends both daily windows, churn one; touches MIN_GPD, digest rank, capEff, lane sizing." Header js/desk-cadence.mjs:26 already says unbuilt but cites PLAN.md; repoint to BACKLOG |
| 1403 | MIN_GPD 500k to 250k was a rescale; floor ~1.5x tighter than pre-haircut; over-bind unmeasured | HOME: js/desk-cadence.mjs:38-43 (verified) and gatecandidates.mjs:73 |
| 1407 | `--max-price` literal gone, derives from deployable pool; cap was never the binding constraint | DONE: screen-flip-niches.mjs:197-206 (verified; `MAX_PRICE` derived). Measured line proposed: "Lifting the price cap added 1 item (Virtus set); the fetch pool, not the cap, is the binding limit." |
| 1416 | No price-keyed fetch reserve for big-ticket in band/churn; cap/TOP/GEAR_RESERVE are not the lever; zero-sum | BACKLOG Ideas: "price-keyed (BIG_TICKET_GP) fetch reserve; raising cap/TOP/GEAR_RESERVE only reshuffles; big-ticket surfaces via amplitude board and digest big-ticket append." Verified: no price-keyed reserve in admission.mjs. Also Measured: "--max-price 90m added 10 rows displaced 9; --gear-reserve 10 made it worse (54 vs 55 rated)" |
| 1451 | Regime classifiers knife-edge on +/-1gp (Red d'hide chaps -14.40 vs -14.20 vs 14.30 band; Rune nails 749/748): a bare threshold, wants deadband | BACKLOG Ideas, verified still there: windowread.mjs:387 `FC_FLAT_FRAC` bare threshold; no hysteresis. Code cites it: archive-series.mjs:153 ("tracked in PLAN.md Discovered") must repoint. Proposal: "Regime floor-slope/floor-break tests flip on 0.2 gp/d or 1 gp rounding; falling-exclusion gate hangs off it. Measure how many items sit in the band; consider deadband." |
| 1468 | ARCH-DOCS-AUDIT codification COD-2/3/4, ARCH-1, DL1, COD-1 all done | DONE: commits 81d9049, 5b91d10, a923496, a24d456, ef239dc, 55861d1 (cited in the text; shas not re-verified by me) |
| 1473 | Same-day turnover / entry depth is the target; Masori chaps trade; break-even arithmetic table (+0.5% exit needs 1.51% below mid) | HOME for arithmetic: none found (grep "entry depth" docs/README/lib returned nothing). BACKLOG Measured: "Entry depth decides exit availability: break-even exit at mid*(1+x) needs buy < mid*(1+x)*0.98 (+0.5% needs 1.51% below mid, +1% 1.02%, +2% 0.04%)." Strategy claim (dominates patient exits) unmeasured: BACKLOG Ideas "offline test buy 3% under mid then +0.5% vs buy 1% under then +2%, gp/day" |
| 1521 | MEASURED: achievable entry depth conditioned by amplitude, not trend direction (rising 51.5/falling 41.9/flat 21.3 at -2%/4h; flat vs moving 26pp); do not encode rising/falling depth modifier | BACKLOG Measured (no home found, owner-relevant): "Do not encode a trend-direction entry-depth modifier: -2% bid hit within 4h reads rising 51.5% / falling 41.9% / flat 21.3% and the gap flips sign at 24h; flat-vs-moving (amplitude) is the robust conditioner." |
| 1545 | MEASURED: big-ticket tier is wrong place for same-day round trip; -2% bid hit within 24h 41% (>=10m) vs 71.9% (<100k); tax equals the spread (0.53% of mid); round trip ~23% vs ~58% | BACKLOG Measured: "Big-ticket (>=10m) same-day round trip needs two unlikely events (-2% entry 41%/24h, +2% exit 55.8%/3d, ~23% combined) vs <100k ~58%; spread capture alone nets 0.53% of mid after tax." |
| 1584 | Funnel measured end-to-end (--mode all --stats): stage table + findings A-E | split below |
| 1595 | Finding A: capital multiplied into funnel three times (THROUGHPUT_CAP_GP, Path-A gp/d, digest rankKey); all 0 at deployable=0 | BACKLOG Bugs already has 12 (reported). Check update: digest primary sort is now `rank` with `rankKey` tie-break only (screen-flip-niches.mjs:845-854), so the "digest ranked 0" half is probably gone; Path-A 0/d on a fully deployed book unverified. Refine BACKLOG 12 accordingly |
| 1602 | Finding B: pre-fetch proxy (expGpDay) not predictive of post-fetch score (Sanguinesti 12.89m/d to +0.5% A-); widening pool buys wrong items | BACKLOG Measured: "Pre-fetch expGpDay is a weak predictor of post-fetch rank (Sanguinesti staff 12.89m/d prefetch, fetched net +88k/u +0.5%); widening TOP mostly buys more of the wrong items." Note the BACKLOG AF6/AF7 entries concern the reserves |
| 1608 | Finding C: THIN_RESERVE binding at 6 and at max 15 (47 of 140 band candidates unfetched) | HOME: PLAN-THIN-RESERVE closure recorded at admission.mjs:79-90 (reserves are validation scaffolding). BACKLOG Measured already has "Widening the thin reserve loses at present capital" |
| 1611 | Finding D: amplitude drops 34 of 54 on reachability, estimator quantile-pinned | BACKLOG Bugs 13 (reported). Verified still there: amplitudescreen.mjs:98-99 `AMP_BID_Q`/`AMP_ASK_Q` = 0.5. Upgrade BACKLOG 13 to verified |
| 1614 | Finding E: churn 12% yield mostly by design (54 band-lane partition discards; true ~28%) | DROP: observation about a number, "do not fix" is the whole content; if kept, one Measured line: "churn's 12% yield is mostly band partition (true ~28%); do not fix" |
| 1616 | Where capital filtering happens: probably too late; digest misranks at deployable 0 (A- fill-now below three D/C rows); capEff unbounded (3155%/d); capital double-counted | BACKLOG Decisions: "decide the ONE layer that owns capital filtering (Stage-1 cheap proxy vs digest); capEff unbounded for dust items." Digest-0 half partly gone per above (rank now primary, screen-flip-niches.mjs:845); capEff boundedness not checked |
| 1645 | Amplitude "Both-leg reach" is quantile-pinned (always 7/14); gate unchanged, fix direction unscoped; reject names misleading | BACKLOG Bugs 13 (verified still there, amplitudescreen.mjs:98-99). Add: reject reasons `bid-unreachable`/`ask-unreachable` are really stale-optimistic drops on a default run. Docs corrected 2026-08-09 per the entry |
| 1667 | `--mode reverse` names rejects but not WHY | BACKLOG Bugs (verified still there: screen-flip-niches.mjs:2700 prints names only; reasons exist as `r.gate.reasons` and are printed in the empty-pool branch :2635 only). Proposal: "reverse header prints rejected names without gate reasons; print one line per rejected item. S" |
| 1674 | Ownership doesn't model GE set <-> components (Ancestral pieces = set; set ~1.2% premium, pieces-to-set arbitrage ~+1.95m) | BACKLOG Ideas, verified no set/component mapping in js/ or pipeline/ (grep). "Set<->component mapping for ownership/reverse-flip eligibility; wiki mapping data may carry it. One-way pieces to set arbitrage clears ~+1.95m; set to pieces ~-3.3m dead." |
| 1686 | Cushion/trajectory notes label an incomplete day "today" (caused real misreport) | DONE (gone): `reachMargin` is fed `stats.days` which excludes the forming day (windowread.mjs:249-286, :373-375 forming-day guard, EC2) and forming is shown separately as provisional (:583) |
| 1694 | PLAN-ESTIMATOR-FIDELITY (EF0-EF3) planning only | BACKLOG already lists EF0 (Ideas) and drops EF2/EF3 (Dropped). Plan file no longer in plans/. DONE-as-folded: no extra row. Add one Measured note? No: DROP duplicate |
| 1704 | Thin-reserve scale with `--capital`: CLOSED capital-conditionally; do not widen/default-on `--scale-pool`/blend; revisit at ~150-200m deployable; the "408 lots" reason retracted (do not cite 3c 2.8x) | BACKLOG Measured already has the closure and revisit trigger (line 64). Missing: the retraction "do not cite the 2.8:1 >20m worst-tier figure (not reproducible; n=20)". Propose adding that clause to that Measured line |
| 1737 | `TOP` default now 90 (measured +419ms, BAND 32 to 67); `--scale-pool` no-op on that pool; `AMP_TOP_DEFAULT` stays 40 | HOME: `TOP_DEFAULT` in gatecandidates.mjs (imported at admission.mjs:41; value not re-read). Amp-at-40 is a one-line fact: DROP |
| 1744 | Anchor corrected: Sanguinesti/Basilisk/Webweaver don't reproduce; widening gain is CHURN S+ 2 to 10 | BACKLOG Measured line: "Paired A/B at 100.75m: TOP 40 to 90 adds band 31 to 68 rows, mostly churn S+ 2 to 10; the thin big-tickets named earlier do not reproduce (n=1)." |
| 1757 | Capital-conditioned reserves: reserves are validation scaffolding with an exit condition (Ben 2026-07-27) | HOME: pipeline/lib/signal/admission.mjs:79-90 (header, verified). Matches BACKLOG Decisions AF7/AF8 |
| 1779 | Log `via` into suggestions.jsonl | DONE: EF-0a 2026-08-01; code at admission.mjs:218,260 (verified present); stdout 1688/2875 cite PLAN.md and must be repointed |
| 1797 | Class B mid-tier: real blocker is `bandEdge` 1.5% MIN_ROI, not liquidity (Berserker helm, Dragon scimitar, Rune platebody); needs new edge treatment, `--gate` flag not CLI-reachable | BACKLOG Ideas: "tight-band mid-tier items (Berserker helm, Dragon scimitar, Rune platebody) pass structuralGate but fail bandEdge MIN_ROI 1.5%; needs a value-shaped edge treatment, not a MIN_ROI/CHURN_MIN_VOL loosen; prerequisite --gate flag." No home found (grep "tight-band"/"MIN_ROI" docs/BACKLOG nothing). Related BACKLOG Dropped: LANE-ADMISSION G-I |
| 1814 | Diurnal funnel-widening experiment (profile on gate-excluded rows, log "diurnal candidates") | BACKLOG Ideas, no home found (grep "diurnal candidates" empty): "fetch-budgeted diurnal read on gate-excluded rows to log which would be profitable at diurnal prices; prior: may tighten rather than widen." |
| 1823 | Value niche lacks LM1 limit stage (valueGate, not runValidators) | BACKLOG Chores/Ideas: "value lane has no limitValidator; wire only when value gets a validator pass (provisional, n~0)." Verified: no limitValidator in js/valuescreen.mjs. Value lane is out of `--mode all` already; low priority, could DROP |
| 1826 | Spread/rising specs deleted | DONE: js/flip-niches.mjs deletion commits (f982a31 cited); BACKLOG Dropped lists spread/rising deleted per CLAUDE.md |
| 1831 | Bar D traded-band gate | DONE: `0ed7aa1`; invariant in `bandCore` header (js/flip-niches.mjs), docs/MARKET-ANALYSIS.md, GLOSSARY.md |
| 1834 | Bar E band-edge robustness | DONE: `dba20b4` + `7056846` (0.55.0); `robustBand` in js/quotecore.js |
| 1838 | Churn per-lap rank + band partition | DONE: `8c84fac` |
| 1841 | PM1 follow-ons: watch surface for probes, app Probes column, SCORING pass of firings | Sub-item 3 PM2 firing logs: DONE (probes.mjs:52 `pipeline/probes/<module>.log`). Sub-items 1+2 BACKLOG Ideas, verified not wired: probes run only in quote-items/screen-flip-niches (grep), `dip.mjs:14,28` says watch is a follow-on; no js/ Probes column. Proposal: "probes: wire watch (owned dip = average-down window); score pipeline/probes/*.log firings, graduate or delete." Probes are inform-only so likely already under provisional.json: check |
| 1850 | TG1 follow-on: app Watch tab ignores hold-thesis silence | BACKLOG Bugs 11 (reported). Same issue |
| 1852 | P2 follow-ons: reachValidator has no live consumer; footer/caution paths not e2e tested | (1) DONE: consumers now exist in quote-items.mjs, screen-flip-niches.mjs, item-context.mjs, staleexit.mjs (grep reachValidator). (2) DROP: test-coverage wish, no decision |
| 1857 | P3 follow-ons: floorValidator not driven by declarative strategy spec; direction-agnostic mid-range buy on risen item is a conservatism to revisit | BACKLOG Decisions already has "FloorValidator relax direction (R3b)". Spec-driven half: DROP (P4c/P5 plans folded) |
| 1862 | P4a: two overlapping thesis stores (session-thesis.json vs hold-thesis.json) both carry tripwire; archetype 2004 label may be basing not decay | (1) BACKLOG Decisions already has ARCH-2. (2) DROP: unverified fixture-label worry with no consumer |
| 1871 | P4b: `quote --positions` pathsStage mutates `ctx.position.newStateEntry` unsaved; a P8 single writer must know | DROP: P8 desk orchestrator is in BACKLOG Dropped (V2-P8 desk); `newStateEntry` not found in quote-items.mjs now (grep), so moot |
| 1875 | P0 follow-ons: quote --positions conviction lacks support arm (no ts1h); quote could contribute to shared watch state | DROP with P8 (V2-P8 desk dropped); the ts1h half is unverified, mark "reported" if kept |
| 1881 | Guide re-anchor prediction model (Ben wants edge) | DROP, home: owner memory "GE guide-price era 2026-09-30" (guides now 3h refresh, +/-20% step, guideanchor premise dead for new data). I found no repo doc stating it (grep docs/CHANGELOG), so propose Measured: "Guide re-anchor prediction model is dead for post-2026-09-30 data (guides refresh every 3h with +/-20% step); do not rebuild." Owner confirm |
| 1887 | No `--niche` keyword flag on screen | DROP (verified no flag; skills filter by hand; convenience only) |
| 1889 | SF-3 liquidity-class volume-source split (`volSrc`, warm-only bulk read) | DONE: `3a36a1e`; pinned by pipeline/test/sf3-volsrc.test.mjs, FILLS-PIPELINE.md 11.1 |
| 1903 | `js/backup.js:23` filename uses UTC date | BACKLOG Chores (verified still there: backup.js:24 `toISOString().slice(0,10)`; line moved). Cosmetic, app unused per owner 2026-11-24, so DROP is also defensible. File-name only |
| 1906 | gp-flow and `--max-price` default 45m excludes big tickets | DONE: `--max-price` now derived from capital (screen-flip-niches.mjs:197-206) |
| 1910 | 500k `--min-gpd` floor nearly empties churn; may need niche-specific exemption | DROP: floor now 250k paired to the 2-window haircut (gatecandidates.mjs:73-77, desk-cadence.mjs:38-43); premise superseded |
| 1914 | Signals render 2-3x during init (market.js:96-101) | DROP: not a bug, cited lines no longer match (market.js:96-101 is guide fetch); app unused |
| 1916 | `parseGp` divergence cross-comments | DONE: `6808c58` (pipeline/lib/cli.mjs, js/format.js per entry; file js/format.js no longer in js/ listing, not re-verified) |
| 1918 | Arch-sweep followups umbrella | see sub-rows |
| 1920 | SF-1 quantile type-7 three copies | DONE: `2cbca38` (0.56.0), `quantileSorted`/`quantileOf` in js/quotecore.js |
| 1926 | SF-2 quote per-item ts1h uncapped | DONE: comment-only 2026-07-10; owner ruled comment sufficient |
| 1930 | SF-4 two `UA` strings drifted (0.30 vs 0.28) | BACKLOG Chores, verified still there: js/marketfetch.js:13 `TheCoffer/0.30`, pipeline/lib/market/marketfetch.mjs:30 `0.28`. Dead-decorative; DROP is also defensible (needs APP_VERSION bump). One line: "drop version token from both UA strings" |
| 1935 | SF-5 cosmetic: `ratingParts` field names, forecast `atHours` vs `etaH`, README says forecast imports windowread | DROP: cosmetic, owner-labelled skip |
| 1940 | DOC-5 skills anchor compression / ARCH-2 thesis-store unification (Ben-gated) | DOC-5: DROP (superseded by PLAN-LEAN LN4/LN6). ARCH-2: already in BACKLOG Decisions line 32 |
| 1945 | Log-file discovery near-duplicated (`sync-fills.readLogFiles` vs `offers.readExchangeLog`) | DROP: "unify only if either changes again"; verified both exist (sync-fills.mjs:129, offers.mjs:25) |
| 1948 | Named price alerts fire on live mid; side-specific semantics is product decision | BACKLOG Decisions: "named price alerts trigger on mid; should 'sell above Y' use the instabuy basis? one-line change." App unused per owner 2026-11-24; low value. Location of the code not found in js/ by grep ("alert" only in ledger.js/watch.js); unverified |
| 1951 | Fill-alert dedupe key includes timestamp so a re-logged terminal line could alert twice | DROP: no matching code found in js/ or pipeline/lib (grep fillAlert/alertKey/dedupe empty); latent, 60-min window; unverified |
| 1955 | No mobile editor for already-synced fills (REMOVE tombstone via contents API) | DROP: app unused (owner 2026-11-24); desktop path exists (js/ledger.js:142-179 `editManualLog` REMOVE tombstones) |
| 1959 | Watchlist write-back stores ids not names | DROP: harmless, documented in js/github.js; hand-editors only |
| 1962 | `mobile-fills.log` grows unbounded | DROP: append-only by design; file still present in repo root |
| 1965 | LH2 blind-warning can't catch false-EMPTY snapshot restart variant (fresh log, all slots EMPTY, FIFO says held) | BACKLOG Bugs (reported): "logblind.mjs misses the false-EMPTY restart snapshot: all-slots EMPTY burst, no fill/cancel terminals, FIFO says inventory held; display-only warning, never verdict input. Cost: NOT LISTED prints for listed offers." Related memory: "NOT LISTED, suspect logger lag". Code exists: pipeline/lib/reconstruct/logblind.mjs:4 |
| 1973 | `outcomes.mjs` campaigns don't use `dedupeSnapshots` | DONE: YS1 (per 1985); `dedupeSnapshots` now referenced in pipeline/lib/reconstruct/campaigns.mjs and retrojoin.mjs (grep) |
| 1979 | Resolved/promoted list (GC1, GA1, X1, SR1, D1, FC1, YP1) | DONE (all named as shipped chunks; shas not in text) |
| 1982 | Deferred: in-app fill-probability + Trends "recommend price adjustment" button (need F1) | BACKLOG Ideas already has "per-item price-adjustment button on Trends"; in-app fill-probability: DROP (app unused) |
| 1985 | Scan per-row velocity tag shipped as stdout footnote (`lib/velocitytag.mjs`); total-capital view shipped | DONE: `7502889`, `2fdae81` |
| 1991 | Cash view superseded by PLAN-CASH-TRACKING: three-tier `availableCash <= deployablePool <= liquidCapital` | HOME: pipeline/lib/capital/derive-cash-tiers.mjs (verified file exists); CLAUDE.md ask-table run-loop row restates the tier model |
| 1997 | Earlier per-plan Discovered lists in git `39e5d23:PLAN.md` | DROP (git pointer; keep in new PLAN.md only if needed) |

## Proposed BACKLOG lines (verbatim-ready)

Bugs
- verified — `screen-flip-niches.mjs:2700` reverse header names rejected items without the gate reason (reasons exist at :2635). S
- reported — `logblind.mjs` misses the false-EMPTY restart snapshot (fresh log, all slots EMPTY, FIFO says held), so NOT LISTED prints for listed offers. Display-only fix. M
- (upgrade 13 to verified: `amplitudescreen.mjs:98-99` quantiles 0.5; reject names `bid/ask-unreachable` are stale-optimistic drops)

Decisions
- Which layer owns capital filtering (Stage-1 proxy vs digest); capEff is unbounded for dust items.
- Named price alerts: trigger on mid or the side's instant price? (app unused)

Chores / Ideas
- Attention axis (gp per decision) for lanes; repoint desk-cadence.mjs:26 here.
- Price-keyed big-ticket fetch reserve (cap, TOP, GEAR_RESERVE are not the lever).
- Regime floor-slope/floor-break deadband (windowread.mjs:387); measure how many items sit within rounding of `FC_FLAT_FRAC`.
- Set<->component ownership mapping (reverse-flip eligibility, pieces-to-set arbitrage).
- Tight-band mid-tier edge (Berserker helm etc.); needs `--gate` flag first.
- Diurnal funnel-widening on gate-excluded rows.
- Wire probes into watch; score `pipeline/probes/*.log`.
- Offline test: buy 3% under mid then +0.5% exit vs buy 1% under then +2%.
- Post-update gear-dump event study.
- Value lane `limitValidator` (only if value grows a validator pass).

Measured: do not rebuild (new lines)
- Depth model (`clearableAsk`) ties a median-hourly-high null (+0.81% vs +0.83%); retired 1.8.0.
- Entry depth: amplitude, not trend direction, conditions achievable depth (-2%/4h hit: rising 51.5, falling 41.9, flat 21.3; sign flips at 24h). Do not encode a direction modifier.
- Big-ticket same-day round trip is ~23% (-2% entry 41%/24h, +2% exit 55.8%/3d) vs ~58% below 100k; buying 2.04% under mid and selling +0.5% nets only 0.53% after tax.
- Break-even exit arithmetic: buy < mid*(1+x)*0.98 (+0.5% needs 1.51% below mid).
- Validators dropped ~14 rows/35d; `thin-reserve-full` dropped 2,184 (3.83m/d avg): exclusion is fetch-slot competition.
- Pre-fetch expGpDay poorly predicts post-fetch rank (Sanguinesti 12.89m/d, fetched +0.5%).
- reach 8h print scoring misses 18.2% that print within 48h; a fill model is needed to score it.
- Thin-reserve closure: do not cite the 2.8:1 >20m tier figure (n=20, not reproducible).
- TOP 40 to 90 gain is churn (S+ 2 to 10); the named thin big-tickets did not reproduce.
- `--max-price` 90m added 10 rows, displaced 9; `--gear-reserve 10` was worse (54 vs 55).
- Guide re-anchor prediction model dead after 2026-09-30 (3h guide refresh, +/-20% step) — owner confirm.
- A validator `pass` is never logged; replay the pure function to score.

## Code citations of PLAN.md Discovered to repoint
js/desk-cadence.mjs:26; pipeline/commands/report-retro.mjs:18; pipeline/commands/screen-flip-niches.mjs:1688 and :2875; pipeline/lib/market/archive-series.mjs:153; pipeline/lib/render/retrojoin.mjs:47; pipeline/lib/signal/admission.mjs:218 and :260.
