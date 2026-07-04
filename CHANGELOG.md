# CHANGELOG — The Coffer / The-Ledger

Deep per-version writeups (rationale, superseded approaches, the "why" behind each shipped
change) live here. `CLAUDE.md`'s "Done (recent)" section keeps only a one-line load-bearing
pointer per entry — the "do not rebuild this" signal — and points here for the full story.
Moved out of `CLAUDE.md` by PLAN.md chunk K3 (2026-07-04). Newest entries at the top of the
recent block; the ordering below preserves the original CLAUDE.md sequence.

For anything older or not captured here, the commit history + `git show <sha>` is canonical.

## Recent

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
