# CHANGELOG — The Coffer / The-Ledger

Deep per-version writeups (rationale, superseded approaches, the "why" behind each shipped
change) live here. `CLAUDE.md`'s "Done (recent)" section keeps only a one-line load-bearing
pointer per entry — the "do not rebuild this" signal — and points here for the full story.
Moved out of `CLAUDE.md` by PLAN.md chunk K3 (2026-07-04). Newest entries at the top of the
recent block; the ordering below preserves the original CLAUDE.md sequence.

For anything older or not captured here, the commit history + `git show <sha>` is canonical.

## Recent

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
