# PLAN-CRASH-REPLAY — when should we buy into a dump? (per-item crash-entry timing, point-in-time, live-usable)

Status: **DRAFT v2 (hardened 2026-10-29) — pre-registered experiment design.** Nothing here ships to the app
or moves a gate. Chunk prefix `CRX` (checked: no collisions in `lint-plan-refs.mjs --collisions`).
Arms A (logged-pick replay) and B (failure taxonomy) from v1 were **dropped by Ben 2026-10-29** as low
decision value — he was not trading in the window, and the existing scorers already show the logged
estimators do not beat their nulls. This plan is the former Arm C, rebuilt around per-item hourly events.

## Context / diagnosis

Ben, 2026-10-29: "With a market crash, there are opportunities to come up big if we can buy at the right
time." The raids-4 cycle: inflation into release, then a deflation that is still running. Ben's read is
that items are "more stable now"; that claim gets its own pre-registered test (§Stability read).

Measured 2026-10-29 off `pipeline/.market-archive.sqlite` (read-only; scratch scripts, not committed):

- **Coverage.** 1h grain: 3,695 of 3,696 hourly buckets since 05-29 (complete). 5m grain (from 07-09):
  ~29% of hours missing overall, **median 48% coverage inside the dump windows that matter** — the 5m grain
  cannot be a primary basis here.
- **The crash, class-median index** (per-item daily mid ÷ its 09-15..21 median; universe = items with >5m
  gp/d turnover in that base week; n: big≥10m 104, 1–10m 105): big 1.007 at the 10-12 top → 0.856 (10-22)
  → 0.841 (10-29); 1–10m 1.023 (10-18) → 0.799 → 0.749. Last two days flat within noise for both classes
  (big 0.845→0.841, 1–10m 0.750→0.749) after a fall — **no rebound, not yet "stable" by any 3-day rule**.
  (v1's table quoted larger n from a different universe definition; direction and size agree.)
- **Market-wide events do not exist in this archive.** v1's rule (class-median down ≥8% within 4d) fires
  on exactly ONE episode since 05-29 — raids-4, 10-20..10-24 — and on none at any threshold down to −3%.
  The "prior game-update dumps as in-sample" premise of v1 was false; there is no in-sample set at market
  grain. **The unit of analysis is therefore the per-item dump event.**
- **Per-item dumps exist in quantity but cluster hard.** Daily-grain pilot (mid ≥15% below its level ≤3d
  earlier; liquid = trailing-7d turnover >5m gp/d measured BEFORE the move; consecutive days = one event),
  big + 1–10m classes: 141 onsets before 10-19, 154 from 10-19 on; 51% of them sit on five onset days,
  two of which are raids-4. Effective n is onset-days, and raids-4 is ONE block.
- **The trough hour is a spike, not a volume event.** Over those events, the trough hour's instasell volume
  is a median 12 units (p25 4), the same as an ordinary hour; the median avgLow over the SIX hours after the
  trough prints +4.4% above it; the trough sits a median 1.6% under the prior-24h low (a staircase, not a
  cliff). A rule that "buys the trough-hour low" is unreachable by construction — the decision that sees the
  trough bucket is made after it closed, and the next bucket is already higher.
- **Hour-of-day of the trough** (UTC, n=295): roughly flat; a mild excess at 23h (21 vs 12.3 expected) and
  05–08h. Not strong enough to be a rule; carried as one sensitivity.
- **Fills to join: none.** `fills.json` has 0 events 10-08..10-29. This is a simulation against the archive.

Anchor incident: **Noxious halberd**, 39.8m daily high (10-15) → 30.9m (10-28). Prior art that already
measures "buy the dislocation" at DAILY grain: **WK3/WK4** (`pipeline/lib/signal/dislocation.mjs`,
`DISLOCATION_TABLE`): the deep cells pay ~1–3% over 4d at the honest next-day entry (`lag`) and shrink
toward 0 under the volume-executability filter (`vol`) — "the deep edge is volume-fragile". That read is
the **incumbent buy-the-dip rule** and is a baseline here, not something to rediscover.

## Rulings

- Ben 2026-10-29: drop the logged-pick replay and the failure taxonomy; make crash-entry timing the whole
  plan; it must be usable live, each hour, on the current crash.
- Doctrine carried in (memory + skills): the exit on a falling item is the CERTAIN clear above break-even,
  never the rebound peak; reach ≠ fill, every archive fill is an upper bound; effective n is clusters, not
  rows; thresholds are placeholders fixed before the run; results that should move a gate go through F1.
- Everything in **Open questions** below has a proposed default and runs on that default unless vetoed.
- Ben 2026-10-30: sequence **this plan's live read first, then the breadth/stability line on the `/scan`
  header (reusing CRX1's breadth function), then `plans/PLAN-WEEKDAY-PHASE-CONFOUND.md` extended with an
  update-week flag** ("it may prevent us from buying on an update weekend if we are flipping then"). The
  hourly archive shows a fortnightly Monday dump cluster (10 of 10 on-week Mondays above every off-week
  Monday, 06-15..10-19; not a bucket-gap artifact), read by Ben as update cadence + weekend falloff; it
  belongs to that plan, not this one. A parallel investigation into why the scan surfaces almost no 1–10m
  items runs alongside. Era-splitting the record at 10-19 was declined; exit-model tuning stays off.
  Open questions 1–8 were not vetoed and run on their defaults.

## Existing scaffolding (nothing here is greenfield)

- Archive: `pipeline/lib/market/archive.mjs` (`open(path, {readonly:true})`, `seriesFor`). Bucket `ts` is the
  START of the hour, so the bucket at a decision hour is future data: inherit `readableCut` from
  `js/forward-reach.mjs` (the one settled convention, moved there from join-exit-ev at CRX1) by import, never re-derive.
- Incumbent dip read: `dislocation.mjs` `trailingDeviation`/`bucketOf`/`dislocationRead` (deep2/4/7 buckets,
  next-day `lag` entry). Floor/ceiling slope: `js/windowread.mjs` `floorCeilingTrack` (forming-day stripped —
  the look-ahead guard already exists there). 5m direction: `js/quotecore.js` `recentDirection`. Tax/BE:
  `breakEven()` in `js/quotecore.js`, `tax()` in `js/money-math.js` — the ONE definition.
- Scoring conventions to inherit by import or by fixture-pinned copy: fill/reach semantics and item-cluster
  bootstrap (`join-asym-outcomes.mjs`), list-for-H-else-bail with the `bail low|high` sensitivity and the
  era-half invalidator (`join-exit-ev.mjs`), paired cost contrasts (`join-reach-basis.mjs`).
- NOT reusable here: the DL2 flush replay (`flushSignal`): its liquidity gate is ≥40,000 units/day, which
  excludes every big/1–10m item by construction, and its exit-clears gate needs a `reliable` flag that is
  not reconstructable from the archive. Dropped for this plan; it stays the live small-commodity tool.

## Target architecture (one home per concern)

- `pipeline/lib/market/crash-entry.mjs` — PURE, archive-shaped-series in, decisions out: the event detector,
  every entry rule, the fill/exit simulators, the breadth/stability read. Every function takes `nowSec` and
  reads only buckets with `ts ≤ nowSec − 3600` (completed), via the imported `readableCut`.
- `pipeline/commands/join-crash-entry.mjs` — the scorer (read-only, `--json`), block P / block R reports.
- `pipeline/commands/read-crash-entry.mjs` — the LIVE hourly read, calling the SAME lib functions with
  `nowSec = now`. Inform-only; prints the rule states, never a verdict.
- Tests in `pipeline/test/crash-entry.test.mjs` (auto-discovered by `run-tests.mjs`).

## Design (pre-registered)

### Events

- **Onset hour** t0 for item i: the first completed bucket whose mid (avgHigh+avgLow)/2 is ≤ 0.85 × the max
  mid over the trailing 72 completed hours, with the item **liquid** at t0 (trailing-7-completed-day turnover
  > 5m gp/d) and priced ≥ 1m (classes big ≥10m and 1–10m; 10k–1m reported descriptively only). One event per
  item per 14d (cooldown from t0). Coordinator-side hourly count pending; the daily-grain pilot above bounds it.
- **Cluster** = onset UTC day. **Block P** = onsets before 2026-10-19 (idiosyncratic single-item dumps).
  **Block R** = onsets 10-19..10-26 (raids-4: ONE correlated block). Block P is the registration pool; block
  R is reported as a case series, never pooled with P. These are DIFFERENT generating processes (one item
  repricing vs the whole market deleveraging); a block-P result transfers to a crash only by assumption, and
  the plan says so wherever a number is printed.

### Decision clock and no-look-ahead (hardening priority 1)

A rule evaluated at hour t sees buckets with ts ≤ t − 3600 only. Trailing maxima, 24h minima, daily highs
and slopes use completed buckets / completed UTC days only. The fill window opens at bucket t + 3600 (the
bucket AT t belongs to neither side — the `join-exit-ev` convention). Daily features use UTC days in the
replay (the app renders local; this is storage-side math, see CLAUDE.md's time convention).

### Entry rules (each: fired / not, at hour t, from readable buckets)

Baselines, fixed:
- **RB0 knife** — buy at t0 (the naive "buy the dip"). The floor every rule must clear.
- **RB1 delay** — buy at t0 + 72h, unconditionally. THE paired baseline.
- **RB2 incumbent** — the WK4 deep bucket (`bucketOf(trailingDeviation)` ∈ deep4/deep7) entered at the next
  UTC day's first readable hour (the `lag` convention). What the repo already ships.
- **Never-enter** — net 0, the null every "edge" claim is also measured against.

Candidates:
- **R0 deeper** — first hour the mid is ≥25% under the trailing-14d max (a second, deeper trigger).
- **R2 floor-slope** — `floorCeilingTrack` over completed days says the floor is no longer falling.
- **R3 24h-min hold** — min avgLow over the last 24 completed hours ≥ min avgLow over the 24 before them.
- **R4 bounce** — last readable avgLow ≥ 1.02 × the min avgLow of the trailing 24 completed hours
  (confirmation, not prediction).
- **R5 climax** — instasell units over the last 6 completed hours ≥ 2× the trailing-7d hourly median, then
  enter the next hour (capitulation volume).
- **ST-time (staged)** — three equal tranches at t0, t0+24h, t0+48h. **The owner's likely real policy and
  the one registered primary comparison.**
- **ST-trigger (staged)** — one tranche each at t0, first R4 fire, first R2 fire (each at most once, within
  the 7d arm window).
- **Diurnal sensitivity** — RB1 moved to the item's `hourProfile` dip window nearest after t0+72h. One row,
  not a rule family.

Every rule arms at t0 and expires 7d after it; a rule that never fires is a no-entry (net 0, counted).

### Fill (hardening priority 2)

Bid = the last readable bucket's avgLow at the fire hour (transact-now basis; sensitivity −1%). **Filled iff a
bucket in [t+1h, t+H_fill] has avgLow ≤ bid AND lowPriceVolume ≥ qty**; fill price = bid. H_fill = 24h
(sensitivity 6h). qty = 1 for big; for 1–10m, min(buy limit, floor(tranche_gp ÷ bid)). A staged tranche that
does not fill is a partial position, scored as such. Reach ≠ fill: every fill rate is an UPPER bound;
`avg ≤ bid` proves at least one print at or under, nothing about queue position. Strict sensitivity: require
lowPriceVolume ≥ 2×qty. The 5m grain is a sensitivity only, on windows with ≥90% 5m coverage.

### Exit (hardening priority 3)

- **EX1 primary — certain clear.** List at ask = `breakEven(fill) × (1 + m)`, m = 2% placeholder, for
  H_exit = 7d from fill (sensitivities 3d/14d). Reached iff a bucket has avgHigh ≥ ask AND highPriceVolume ≥
  qty → net = ask − tax(ask) − fill. Else bail at the last readable avgLow at fill + H_exit (`bail low`;
  `bail high` as the sensitivity, both reported as in `join-exit-ev`) → net = bail − tax(bail) − fill.
- **EX2 secondary — the doctrine ladder.** Ask = min of the daily HIGHs of the three prior completed UTC days,
  re-set at each 00:00 UTC, same bail. Reported beside EX1, never swapped in post hoc.
- **Oracle** — entry at the window's lowest readable-bucket avgLow, exit under EX1. It bounds ENTRY-timing
  headroom with the exit held fixed; a min-to-max oracle would only measure the rebound.

Outcome per event per rule: **net return as a fraction of fill** (comparable across a 2m and a 40m item);
gp per tranche is derived from it for the owner's reading, never the comparison metric.

### Statistics and win criterion (hardening priority 4)

- Primary spec: block P, big + 1–10m pooled, H_fill 24h, EX1 m=2%, H_exit 7d, bail low. Locked here.
- **Primary test (one):** ST-time vs RB1, paired per event, mean paired difference with an onset-day-cluster
  bootstrap 95% CI. ST-time "beats" iff the CI excludes 0 AND ST-time's own mean net CI is > 0 (beats
  never-enter) AND the paired sign agrees at H_exit 3d and 14d. Anything else: "no detectable edge".
- **Secondary family:** every other candidate vs RB1, same construction, **Holm-corrected** across the
  family. Reported as a table; none can become the headline.
- Class strata, the diurnal row, bail high, strict volume, the 5m check: sensitivities, no claims.
- **Block R (raids-4):** one cluster → no CI is possible. Report point estimates + the per-item spread, and
  the SIGN of the block-P winner on block R. A sign flip is a "does not transfer" flag, not a refutation
  (n = 1 event). **Re-run on or after 2026-11-13**, when 14d outcomes exist for every block-R onset.
- CI refusal floor: fewer than 8 contributing onset-day clusters → print the per-event table, no interval.

### Stability read (Ben's "more stable now", pre-registered)

Daily, point-in-time: (a) breadth = share of liquid items whose last completed UTC day's mid is a 20-day
low; (b) class-median 3-day return (big, 1–10m). **"Stabilising"** placeholder = breadth < 15% AND the 3d
return > −1% on three consecutive days. Printed as one line by the live read. Measured 2026-10-29: condition
(b) holds for two days, not three; (a) is unmeasured until CRX1.

## Staged chunks

- **CRX1 — lib + detector + fixtures.** `pipeline/lib/market/crash-entry.mjs`: event detector, the rules,
  fill/exit simulators, breadth read; `pipeline/test/crash-entry.test.mjs`. README inventory entry at
  creation. Primary files: those two + README. **BUILT (uncommitted, 2026-10-30)** — `readableCut` moved to
  `js/forward-reach.mjs` and `pairedClusterCI` to `pipeline/lib/signal/cluster-ci.mjs` (no lib→commands import);
  RB2 reads UTC days via `dislocation.mjs`'s new `{ utc }` option. Fill sizing: qty = 1 for big, else
  max(1, floor(tranche gp ÷ bid)) capped at the buy limit — a staged tranche smaller than one unit still buys one.
  Still open after CRX2: a tranche size for 10k–1m events (descriptive only, unscored), and whether class
  should key on the onset mid (current) or the pre-dump level.
- **CRX2 — scorer.** `pipeline/commands/join-crash-entry.mjs` on block P at the locked spec; prints the
  primary test, the Holm table, sensitivities, and the block-R case series as far as outcomes exist.
  README entry carries the result, the way the other `join-*` entries do. **BUILT (uncommitted, 2026-10-30)** —
  `node pipeline/commands/join-crash-entry.mjs [--json]`. Result: no rule beats never-enter on block P and the
  primary is "no detectable edge" (numbers: run the command). Added beside the locked spec: a versus-never-enter
  table, RB2's clock control (`RB1-00UTC`), the UTC diurnal row (`RB1-diurnal`), oracle medians only (its
  volume-free trough entry can sit on a one-unit lowball print), lot-size-neutral and pre-dump-price class
  strata, and a persistence sensitivity labelled NOT pre-registered (onsets holding
  `PERSIST_BUCKETS` buckets with ≥ `PERSIST_MIN_UNITS` units, decision re-timed to when that is readable).
  The 5m-grain check was not built.
- **CRX3 — live read.** `pipeline/commands/read-crash-entry.mjs`: for every liquid big/1–10m item in an open
  event, one line: onset, hours since, drawdown vs 72h/14d max, each rule's state (armed / FIRED N h ago),
  the ST-time tranche schedule, the fill-basis bid, EX1 ask and BE, plus the stability line. Header states
  "unscored" until CRX2 reports, then carries CRX2's one-line result. Not wired into `run-loop.mjs`.
- **CRX4 — block-R re-run (≥ 2026-11-13)** + CHANGELOG/README write-up; fold into PLAN.md + delete this file.

## Encoding boundary

Read-only scorers and an inform-only live read. Nothing gates, prices or ranks off this plan. A block-P
winner that should change a default (e.g. a tranche schedule in `/scan`'s dip handling) is proposed in
writing and goes through F1; the live read keeps printing all rules regardless of the result.

## Bookkeeping & compatibility

- README inventory entries for each new file at creation (CRX1, CRX2, CRX3). No new tracked data artifacts;
  scratch output stays under `pipeline/.cache/`. No `.gitignore` change expected.
- `readableCut` and `pairedClusterCI` were moved out of `join-exit-ev.mjs` at CRX1 (to `js/forward-reach.mjs`
  and `pipeline/lib/signal/cluster-ci.mjs`), so no lib imports a command; join-exit-ev imports them back.
- No APP_VERSION bump (pipeline-only). Pipeline version bump per the usual convention at CRX2.
- `check-imports.mjs`, `lint-docs.mjs`, `lint-plan-refs.mjs` cover the new files automatically.

## Honesty

- Thresholds — 0.85×72h-max onset, 14d cooldown, 72h delay, 1.02 bounce, 2× climax, 24h/6h fill windows,
  m = 2%, 7d exit, 15%/−1% stability — are PLACEHOLDERS fixed before the run so they cannot be tuned to the
  answer. Block P accrues nothing new; it is the archive as it stands.
- Block P (single-item repricings) is not a crash. The only crash in the archive is one block, and 14d
  outcomes for it do not exist until mid-November. **No statement of the form "in a crash, rule X works" can
  come out of this plan**; the strongest honest output is "on idiosyncratic dumps X beat the 72h delay, and
  on raids-4 its sign did / did not agree".
- Fill and reach are upper bounds; the trough itself is unreachable (measured above); the 1h average
  undercounts prints, partially offsetting. Both directions stated on every table.
- Capital, slots and competing events are not modelled; the per-event fraction metric is per-unit.
- One era (05-29 → now), one update cycle, and a guide-era boundary at 09-30 that no rule here reads.

## Verification

- Look-ahead pin: every rule and the detector, fed a series truncated at t, return the decision they return
  on the full series (mutation test: appending a future bucket below the bid must not create a fill at t).
- Clock pin: the bucket stamped t is excluded from both the readable set and the fill window.
- Trough pin: a V-shaped fixture whose only bucket ≤ bid is the trough bucket at t → no fill for a decision
  at t; a fill for the decision at t−1h.
- Volume pin: avgLow ≤ bid with lowPriceVolume < qty → no fill.
- Staged pin: a tranche that never fills leaves a partial position whose net is the filled tranches' net.
- Cluster pin: two events on one onset day are one bootstrap unit.
- Reproducibility: the block-P event list is a deterministic function of the archive and the locked spec.

## Hardening log (2026-10-29)

| Change | Defect it fixes | Impact |
| --- | --- | --- |
| Arms A and B deleted | Ben's ruling (not trading; estimators already known not to beat null) | DELETE |
| Market-wide events → per-item hourly events, clustered by onset day | Stated rule yields ONE event in the archive (measured); v1's "prior update dumps are in-sample" was false; the in-sample/holdout design had n = 0 | FIX — the experiment did not exist as framed |
| Block P / block R split; raids-4 reported as one cluster, no CI | Pooling 154 raids-4 rows as independent would print a CI over n ≈ 1 | FIX |
| `readableCut` inherited; fill window from t+1h; completed-day features | v1 let daily lows/highs include hours after the decision | FIX |
| Fill requires volume ≥ qty; trough measured unreachable (+4.4% next 6h) | "1h avgLow ≤ bid" counted the trough-hour print as a fill | FIX |
| 5m grain demoted to a sensitivity | median 48% coverage in the windows that matter | FIX |
| EX1 certain-clear primary, EX2 ladder secondary, bail convention inherited | v1's E2 was the only exit and is unreachable in a continuing staircase; no bail rule | FIX |
| RB2 = the shipped WK4 dislocation read as a baseline | v1 would have "discovered" a daily-grain dip edge the repo already measured | FIX |
| One primary test (ST-time vs RB1) + Holm over the rest + own-CI > 0 + horizon sign agreement | v1 scored 6 rules × 3 horizons × 2 classes with one criterion and no correction | FIX |
| Staged tranche arms added | Owner's likely policy was absent from the rule set | FIX |
| DL2 flush replay dropped | Its ≥40k units/d gate excludes every crash-class item; `reliable` not reconstructable | DELETE |
| Oracle = trough entry under EX1 | v1's min-to-max oracle measured the rebound, not entry headroom | FIX |
| Diurnal row as a single sensitivity | Trough hour-of-day measured roughly flat (n = 295) | LEAVE IT (one row) |
| Stability read registered | "more stable now" had no test; index is flat 2 days, not 3 | FIX |
| Context table re-derived, dated; "still falling at 10-30" reworded | v1's n came from another universe; last two days are flat | FIX |
| 09-30 guide-era boundary noted, no split | No rule here reads `guide` | LEAVE IT |

## Open questions for Ben (each runs on its default unless vetoed)

1. Tranche capital for the gp translation — default 20m per big event, 10m per 1–10m event (the metric
   stays the per-unit fraction either way).
2. Staged schedule — default 3 × equal thirds at 0/24/48h. Alternative: 2 × halves at 0/48h.
3. Exit margin m and horizon — default 2% over BE, 7d. (A larger m makes "reached" rarer and the bail
   dominate; it is the owner's risk preference, not a fit.)
4. Classes — default big + 1–10m primary, 10k–1m descriptive; <10k not scored (commodity flips have their
   own lane).
5. Onset definition — default 0.85 × trailing-72h max, 14d cooldown (the coordinator's count uses the same).
6. Live read placement — default a standalone `read-crash-entry.mjs`; NOT in the run-loop tick until CRX2
   reports.
7. Day boundary for daily features in the replay — default UTC.
8. "Stable" rule — default breadth < 15% of liquid items at a 20-day low AND class 3d return > −1%, three
   consecutive days.
