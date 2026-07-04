# PLAN-3 — Underwater-at-tick triage: the five-way read + gated decision tree (2026-07-04)

Sequel to `PLAN.md` / `PLAN-2.md`. Same executor contract: **read `CLAUDE.md` fully, then
PLAN.md's "Executor rules" — they apply verbatim** (node --check, real-browser smoke test where
the app is touched, APP_VERSION bump on app changes since `js/quotecore.js` ships to the app,
no PII, spec-style: rule + cheap anchor, no live data pasted into this doc).

## The problem (Ben, 2026-07-04)

During the polling loop a held position reads **underwater** — live instabuy < break-even
(`ceil(cost/0.98)`) — and/or the 2h band looks collapsed. Yesterday this happened on seeds at a
quiet hour; the same flips worked fine today. The read was *technically correct off the data
fetched* and still the wrong basis for action: the band collapse was time-of-day, not
deterioration. The current logic has exactly one lens for "underwater" (regime + mom cut
matrix) and no way to say "this reading isn't trustworthy right now."

The ask: enumerate every interpretation of that observation, name each one's blindspot in the
current pricing/action logic, attach a **cheap** reconciliation to each (no new endpoints —
everything below reuses fetches the tick already makes), and restructure the verdict logic as
an explicit branching tree so the handling maps to the model.

## The five interpretations

Previous sessions discussed ~4 (diurnal / transient shock / real breakdown / regime decline).
The seed incident splits a fifth out of the diurnal case, and the split matters: "the price is
genuinely lower at this hour" and "the *measurement* degrades at this hour" are different
claims that demand different standards of evidence (see the cycle-guard reconciliation below).

### E — Not a price at all (measurement artifact)
The "quote" is stale, one-sided, or built from too few prints to mean anything.
**Blindspots in the current code (all verified 2026-07-04):**
- `computeQuote` receives the full wiki `/latest` object (`fetchLatest` in
  `pipeline/marketfetch.mjs` returns it whole) but **ignores `lowTime`/`highTime`** — an
  instabuy print from four hours ago is treated as a live quote.
- `momVerdict` (`js/quotecore.js`): `underwater = instabuy==null || instabuy<breakEven` — a
  **missing** quote produces **CUT**, the most aggressive verdict from the least information.
- `band.n` (count of populated 5m windows) is computed and returned but gates nothing; band
  one-sidedness (lows populated, highs empty) isn't tracked at all.
- `classify()` in `pipeline/watch.mjs` routes any `mom==='breakdown'` straight to the FALLING
  1-minute cut playbook with no reliability check upstream.
**Cheap reconciliation:** quote age and band sidedness come from the fetches already made.
Verdict = **NO-READ**: no price action may be derived from an unreliable quote.

### A — Diurnal liquidity trough (the seed incident)
Prices and the band genuinely print lower at quiet hours because only lowball crossings occur;
it recovers every day. **Blindspots:**
- The `MONITORING.md` 24h-cycle guard demands a *proven backtested hour-of-day price pattern*
  before deferring a cut — the right standard for a **price-cycle** claim, the wrong standard
  for a **liquidity-rhythm** claim. Result: default-cut fires into the day's thinnest book, the
  worst possible execution moment.
- Nothing compares "this 2h window" against "the same clock window yesterday," even though the
  data is already in hand.
**Cheap reconciliation:** the wiki `/timeseries 5m` fetch returns ~365 points ≈ 30 hours;
`computeQuote` slices only the last 24. From the SAME already-fetched series: compare the
current 2h window vs the window 24h earlier (band position + traded-window count), and check
whether yesterday's dip subsequently recovered. Also compare current-2h activity vs the series'
median 2h activity. Zero extra API calls.

### B — Transient one-off shock (dump / decant / merch unwind)
Real prints on real volume, but one seller; mean-reverts on exhaustion within hours; not
clock-tied. **Blindspot:** `momVerdict` can't distinguish a 2–3-window gap-down on a volume
spike that then stabilizes (seller done) from a steady bleed of lower lows (repricing under
way) — both are just `mom==='breakdown'`. **Cheap reconciliation:** shape-read the last 24×5m
points (already fetched, and they carry per-window volumes): spike-gap-then-stabilize vs
monotone drip.

### C — Real momentum breakdown (leading edge of a repricing)
The bludgeon case — the reason the `Mom` tell exists. **Blindspot is the mirror image of all
of the above:** every gate this plan adds is a potential new excuse to hold a loser, which is
exactly what the cycle guard was built to prevent. **Reconciliation is structural:** every gate
in the tree defers only on **positive evidence** (a failed freshness check, a matched
yesterday-dip-and-recovery, a matched shock shape). Ambiguity always falls through to the
existing cut discipline. A break printing at/above typical activity during liquid hours passes
every gate and cuts exactly as today.

### D — Established multi-day regime decline
Already handled (regime falling → CUT-CANDIDATE), but with two blindspots:
- `regimeDrift` is a 3-day median vs prior-2-week median on 6h buckets — **blind to today**,
  and *diluted* right after a large one-day drop (the recent-3d median still contains pre-drop
  days), so it under-reports exactly when it matters.
- Flat regime + underwater = WATCH **forever**; nothing escalates persistence.
**Cheap reconciliation (stateless):** compute *underwater duration* from the 5m series itself —
how long has `avgHighPrice` printed below break-even, and did that span cover a
peak-liquidity window? Underwater through a liquid peak defeats the diurnal defense and
escalates WATCH → CUT-CANDIDATE. No tick-to-tick memory files needed.

## The decision tree (per held-position tick where instabuy < break-even)

Gate order matters. Each gate is a positive-evidence test; fall-through means "treat as real."

```
underwater tick
│
├─ GATE 0 — is this reading even a price?  (interpretation E)
│    fresh prints on both sides? band two-sided with enough windows?
│    ├─ NO  → NO-READ: keep existing ask ≥ break-even; NO price action off this
│    │        quote; if NO-READ persists through a liquid window → escalate as D
│    └─ YES ↓
├─ GATE 1 — is it the clock?  (interpretation A)
│    current-2h activity ≪ typical  AND  same clock window yesterday dipped
│    AND recovered afterwards?
│    ├─ YES → DIURNAL-WATCH: hold ask ≥ break-even; do NOT cut into the trough.
│    │        HARD STOP: still underwater at the next liquid window → fall through
│    │        to Gate 2 with the diurnal defense spent (one use per episode).
│    └─ NO ↓
├─ GATE 2 — what kind of down-move?  (B vs C/D, volume-qualified)
│    mom === 'breakdown'?
│    ├─ no  → regime falling  → CUT-CANDIDATE            (existing behavior)
│    │        regime flat/rising → WATCH + underwater-duration escalation (new)
│    └─ yes → shape of the move in the 2h window:
│         ├─ SHOCK (gap ≤3 windows on a volume spike, then stabilized)
│         │    + small lot + regime intact → SHOCK-WATCH one more cycle
│         │    (big-ticket lots: the BIG_TICKET_GP clear rule stands unchanged —
│         │     size still overrides patience)
│         └─ BLEED or ambiguous → existing momVerdict matrix → CUT / LIST-TO-CLEAR
```

**Reconciling with the 24h-cycle guard** (`MONITORING.md` step 4 — "default to cut unless a
proven backtested pattern"): the guard is untouched and still governs its question — *"the
price is genuinely lower; is there a proven daily price rhythm that justifies holding?"*
(answer still defaults to cut). Gates 0–1 govern a **different question** — *"is this reading a
price at all?"* They reject the **input**; they never defer a **decision** made on a good
input. The seed incident was the second question misfiled as the first: a liquidity artifact
was adjudicated under the price-cycle standard of evidence and (correctly, under that
standard) lost.

## Implementation chunks

All quote/verdict math lands in `js/quotecore.js` (shared app+node, pure, fixture-testable);
consumers only wire and render. Thresholds are named tunable constants, not magic numbers.

### Chunk 1 — Quote reliability (Gate 0)
- `computeQuote` consumes `latest.lowTime`/`latest.highTime` (accept an optional `now` for
  testability): expose `row.quoteAgeMin` per side and `row.reliable` + a reason string
  (`stale-quote` / `one-sided-band` / `sparse-band` / `ok`). Thresholds: named constants
  (e.g. `STALE_QUOTE_MIN`, `MIN_BAND_WINDOWS`), scaled to the item's own typical print
  interval for thin items rather than one absolute number.
- Fix `momVerdict`: `instabuy == null` (or stale beyond threshold) returns a **NO_READ**
  action, never CUT. CUT requires a live, fresh clear-now price by definition — you cannot
  price a cut off a quote that doesn't exist.
- `watch.mjs` `classify()`: the `mom==='breakdown'` → FALLING route is gated on
  `row.reliable`.

### Chunk 2 — Diurnal + persistence reads (Gate 1, D-escalation)
- `diurnalRead(ts5m, now)` in quotecore: from the full ~30h 5m series → `{quiet,
  yesterdayDipped, yesterdayRecovered, activityRatio}` (current 2h window vs same window −24h,
  vs median 2h activity). Callers already pass the full series — verify none pre-slice.
- `underwaterHours(ts5m, breakEvenPrice)`: stateless persistence — contiguous hours
  `avgHighPrice` has printed below break-even, and whether that span covered a
  peak-activity window. Drives WATCH → CUT-CANDIDATE escalation and the DIURNAL-WATCH hard
  stop.

### Chunk 3 — Shock-vs-bleed shape (Gate 2)
- `moveShape(ts5m)` → `'shock' | 'bleed' | 'ambiguous'`: gap concentrated in ≤3 windows with a
  volume spike (max window volume vs the window median) followed by stabilization = shock;
  distributed lower-lows = bleed; anything else = ambiguous (→ falls through to cut, per the
  positive-evidence rule).

### Chunk 4 — Wire the tree into the three consumers
- `pipeline/watch.mjs`, `pipeline/quote.mjs --positions`, and `reviewPositions` in
  `js/trends.js` gain the verdicts **NO-READ**, **DIURNAL-WATCH**, **SHOCK-WATCH** alongside
  the existing set, each printing WHICH gate fired and the evidence in one line (Ben's
  prose-why rule). The canonical 9-column table is untouched; verdicts are the appended
  columns / cards, as today.

### Chunk 5 — Documentation truth
- `MONITORING.md` step 4 replaced by the tree; the 24h-cycle-guard paragraph gains the
  input-vs-decision distinction above. CLAUDE.md "Market analysis workflow" gets one line
  noting underwater verdicts are now gate-tree outputs.

### Acceptance (fixtures — quotecore is pure, no live data in tests)
- Stale-quote fixture (instabuy print aged past threshold) → NO-READ, never CUT.
- Seed-incident replica (quiet current window, yesterday same-window dip that recovered) →
  DIURNAL-WATCH; same fixture still underwater at a liquid-hours window → falls through and
  cuts.
- Bludgeon replica (volume-qualified bleed, liquid hours) → CUT, byte-identical verdict to
  today (regression guard: the gates must not soften the real case).
- Ambiguous-shape breakdown → falls through to the existing momVerdict matrix.
- `quoteOrdered` invariant untouched by any new field.

## Honest limits
The diurnal check compares against exactly one prior day (the 5m series depth); one quiet
yesterday is weak evidence of a rhythm — which is why DIURNAL-WATCH only *waits for the next
liquid window* rather than declaring a pattern, and why the guard's default-cut posture is
preserved everywhere the evidence is ambiguous. None of these gates predict; they only refuse
to act on readings that aren't information.
