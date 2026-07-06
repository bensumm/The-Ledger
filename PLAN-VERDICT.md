# PLAN-VERDICT.md — verdict-layer temporal memory + conviction gating (V1–V5)

Goal: make the held-position cut/hold verdict *convincing over time* — react to how a position moves
across consecutive watch passes, not just its instantaneous quote — **without** turning the pure
decision core into a stateful thing. Codify what is data-derivable and recurring; keep the LLM for
context, novelty, and explanation.

## Architectural principle (do not violate)

`momVerdict()` / `offerVerdict()` (js/quotecore.js) stay **PURE functions of the current quote** — no
tick-to-tick memory, no fs, no clock beyond the injected `now`. They are shared byte-identically by
the app (trends.js reviewPositions, ui.js) and every pipeline script; smuggling temporal state into
them would (a) desync the app, which has no per-pass store, and (b) make the byte-identical
breakdown-cut invariant untestable.

The temporal layer therefore lives **OUTSIDE** momVerdict, owned by the console `watch.mjs` loop and
its pure helper `pipeline/lib/watchstate.mjs`. The split:

| Concern | Home | Nature |
| --- | --- | --- |
| "Is THIS quote a cut?" (gate tree) | `momVerdict` (js/quotecore.js) | PURE, current-quote-only, app+pipeline shared |
| "Is this bid adverse selection?" | `offerVerdict` (js/quotecore.js) | PURE, current-quote-only, shared |
| Break-even / tax | `breakEven` (js/quotecore.js) | PURE |
| Δ between passes, consecutive-underwater count, mom transition, band-top drift | `watchstate.mjs` | PURE deltas + THIN fs IO wrapper, console-only |
| Structural support / cut-trigger tripwire | `levels.mjs` | PURE, console-only |
| Conviction gating (arm-then-confirm an alert) | `watch.mjs` (+ watchstate) | stateful loop, console-only |
| Novel context / one-off judgment / explanation | the LLM session | not codified |

**What we explicitly DO NOT codify:** the human read of a novel situation, per-item session dossiers
(memory: *per-item session context*), any market-truth claim from a small sample, and the ACT
authority — watch.mjs remains decision support; Ben places every offer.

## Ship order (resolved)

- **V1 + V2 together** — output-only, zero verdict/alert change, so they land as one reviewed,
  low-risk commit. **DONE (this commit).**
- **V3 alone** — the first behavior change (a pure-momVerdict signature extension + app inherit).
- **V4 alone** — conviction gating in the loop (no pure-core change).
- **V5** — emit-contract + doc reconciliation.

## Resolved open decisions

- **Console-first.** The temporal layer lives in the console watch loop. App Watch-tab adoption of
  the same context lines is a **documented follow-on**, not in V1–V5.
- **`FRESH_HOURS` / staleness starts at 1h** — monitor the real loop cadence and adjust; don't
  over-tune a placeholder before there's evidence. (V4 fill-progress freshness.)
- **`STALE_GAP_MS` = 15 min** (V1) — two passes must be within this to count as consecutive.
- Placeholder thresholds (`CUT_TRIGGER_DELTA` 0.5%, `BANDTOP_FLAT_PCT` 0.3%, `SUPPORT_LOOKBACK_DAYS`
  5) are **unvalidated** and cited nowhere as calibrated — same discipline as the rating.mjs cutoffs.

---

## Per-chunk scope

### V1 — watch-loop state store + per-pass deltas — **DONE (this commit)**
- **Files:** NEW `pipeline/lib/watchstate.mjs` (pure), NEW `pipeline/watchstate.test.mjs`, edits to
  `pipeline/watch.mjs` (wire load→deltas→emit→save), state file `pipeline/.cache/watch-state.json`
  (gitignored via `.cache/`).
- **APP_VERSION:** none (pipeline-only).
- **Tag:** OUTPUT-ONLY. Adds a nested Δ line under each held/bid note; changes no verdict, no alert,
  no row selection.
- **What it does:** pure `computeDeltas(prior, cur, now)` / `advanceState(prior, cur, now)` compute Δ
  instabuy (+dir, gap), a mom transition (`prior→cur`), a band-top drift (rising/flat/decaying over a
  bounded history), and a `passesUnderwater` counter. RESET policy: identity change (held: qty+avg
  cost; bid: offer price+max) OR gap > `STALE_GAP_MS` → counters re-count from this episode. THIN
  `loadState`/`saveState` are the only fs surface; watch.mjs guards every call (a state failure never
  breaks a pass, like `logGuideChanges`). watch.mjs rebuilds state fresh from the current pass's items
  so vanished positions drop out.
- **TEST MANIFEST (`watchstate.test.mjs`, 11 checks):** first-seen → no deltas; first-seen underwater
  → count 1; Δ instabuy signed+dir+gap; mom transition string + momChanged; consecutive-underwater
  increment; surface-above-BE reset to 0; identity-change reset (deltas dropped, count re-starts);
  stale-gap reset (+ just-inside-gap does NOT reset); band-top rising/flat/decaying + null <2;
  decaying band-top through computeDeltas; advanceState non-mutation.

### V2 — structural support / tripwire computation — **DONE (this commit)**
- **Files:** NEW `pipeline/lib/levels.mjs` (pure), NEW `pipeline/levels.test.mjs`, edit `watch.mjs`
  (emit a `support X · cut-trigger Y` line on held rows).
- **APP_VERSION:** none (pipeline-only).
- **Tag:** OUTPUT-ONLY. The line is labeled context; it changes no verdict and raises no alert.
- **What it does:** from the recent per-day LOW series (derived from the 1h `/timeseries` watch.mjs
  ALREADY fetches for its window line — **no new fetch**, via `windowStats` with a full-day window),
  `structuralSupport()` = the most recent higher-low that held (else the N-day floor over
  `SUPPORT_LOOKBACK_DAYS`), and `cutTrigger()` = support × (1 − `CUT_TRIGGER_DELTA`). Graceful
  degradation: <2 usable lows → null, no crash.
- **TEST MANIFEST (`levels.test.mjs`, 7 checks):** support = most recent higher-low; latest pivot not
  an older one; strictly-declining → N-day floor; cut-trigger = support−δ and strictly below;
  supportLevels bundles both / null when unknown; <2 lows → null; lookback window bounds the series.

### V3 — lot-context softening of the Gate-D CUT-CANDIDATE — **DONE (0.52.0)**
- **Files:** `js/quotecore.js` (`momVerdict` gains an OPTIONAL `lotCtx={buyTs, askFilling}` 6th arg
  + exported `FRESH_HOURS=1` placeholder), `pipeline/quotecore.test.mjs` (6 new V3 fixtures incl.
  the byte-identical breakdown-cut regression — now 33 checks), callers pass lotCtx (`watch.mjs`
  held rows: buyTs from the open lot + askFilling = an active ask filled>0 above the clear price;
  `quote.mjs --positions`: buyTs only, askFilling undefined; `js/trends.js reviewPositions`: buyTs
  from `t.opened`), `pipeline/lib/positions.mjs` (`readOpenPositions` groups carry `buyTs` = oldest
  lot), `js/watch.js` + `js/watchcore.js` (verdict-string reconcile), docs (MONITORING §4 /
  `/positions` §3 v1.13 / CLAUDE.md). **Note:** the plan draft said `fillProgress`; shipped as the
  clearer boolean `askFilling`. New verdicts: **WATCH — fresh entry** (entry-age) / **HOLD — ask
  filling** (fill-progress) — both hold ≥ break-even, neither is an alert.
- **APP_VERSION:** **YES** (deployed app inherits — trends.js reviewPositions renders it).
- **Tag:** BEHAVIOR CHANGE.
- **What it does:** entry age (from `buyTs`, carried on open lots in positions.json) + fill-progress
  soften **ONLY** the Gate-D clean-momentum `CUT-CANDIDATE` (which is *definitionally* true after a
  patient partial fill: an underwater-through-a-liquid-window read on a lot you're mid-filling is
  expected, not a bleed). It must **NEVER** soften the Gate-2 breakdown `CUT` — a real 2h breakdown
  while underwater still cuts immediately and byte-identically. lotCtx is optional; absent it,
  momVerdict is unchanged (the app and every current caller keep working).
- **TEST MANIFEST:** new fixtures pinning the Gate-D softening ON (aged/partially-filled lot →
  softened) and OFF (fresh lot → unchanged), AND an explicit assertion that the Gate-2 breakdown CUT
  is byte-identical with and without lotCtx (the invariant).

### V4 — conviction gating (arm-then-confirm) — **PENDING**
- **Files:** `pipeline/watch.mjs` + `pipeline/lib/watchstate.mjs` (NOT js/quotecore.js — the pure core
  stays pure), `pipeline/watchstate.test.mjs` (escalation fixtures).
- **APP_VERSION:** none (pipeline-only; the app has no per-pass store — the documented follow-on).
- **Tag:** BEHAVIOR CHANGE **to alerts only** (verdict strings unchanged; what *escalates to a headline
  ALERT* is gated).
- **What it does:** a Gate-D `CUT-CANDIDATE` must survive **2 consecutive underwater-liquid passes**
  (V1's `passesUnderwater`) before it escalates to an ALERT; a structural-break cut needs the V2
  tripwire **convincingly broken** (price < cut-trigger, i.e. ≥ `CUT_TRIGGER_DELTA` below support) OR
  2 passes. The Gate-2 breakdown `CUT` stays **IMMEDIATE** (exempt — a live breakdown is not a thing to
  sit on). Live evidence FOR this (2026-07-06 webweaver): a named ~18.25m tripwire broke to ~18.18m
  then bounced to ~18.55m **within one pass** — an immediate-fire cut would have sold the low;
  arm-then-confirm threads it.
- **TEST MANIFEST:** 1 underwater-liquid pass → armed, no alert; 2nd consecutive → alert; a reset
  (gap/identity/surface) → re-arm from scratch; tripwire broken by ≥δ → immediate structural alert;
  breakdown CUT → immediate regardless of pass count (exempt).

### V5 — standardize the emit contract + doc reconcile — **PENDING**
- **Files:** `pipeline/watch.mjs` (unified per-item line), `pipeline/MONITORING.md`, `CLAUDE.md`,
  `.claude/skills/positions/SKILL.md`, `.claude/skills/morning/SKILL.md`.
- **APP_VERSION:** none (pipeline+docs).
- **Tag:** OUTPUT-ONLY (format) + docs.
- **What it does:** one standard emit line — `verdict · conviction · Δ-since-last · tripwire ·
  fill-progress` — and a reconciliation pass so MONITORING/CLAUDE/`/positions`/`/morning` describe the
  temporal layer consistently (process rule 8).

---

## VETTING

### The byte-identical breakdown-cut invariant
The one thing every chunk must preserve: **a real 2h breakdown while underwater still produces the
same `CUT` at the same `listAt`, unconditionally and immediately.** That is the signal whose ABSENCE
cost the bludgeon exit; softening or delaying it is the failure mode to guard.

- **V1/V2:** OUTPUT-ONLY — they add lines and never call/alter any verdict or alert path, so the
  invariant is trivially preserved (proven live: verdicts before/after the edits are identical).
- **V3:** softens ONLY the Gate-D clean CUT-CANDIDATE, never the Gate-2 breakdown CUT — pinned by a
  fixture that asserts the breakdown CUT is byte-identical with and without `lotCtx`.
- **V4:** the Gate-2 breakdown CUT is explicitly EXEMPT from arm-then-confirm (immediate); only the
  Gate-D candidate and the structural-break cut are gated — pinned by an "immediate regardless of pass
  count" fixture.
- **V5:** format-only; no verdict/alert logic touched.

### Risks + mitigations
- **State corruption / bad reset.** A corrupt/partial state file must not break a pass, and a stale
  count must not leak across a re-buy or an overnight pause. → `loadState` degrades to `{}`; every
  state call in watch.mjs is try/caught; the reset policy (identity + `STALE_GAP_MS`) is the
  highest-value thing `watchstate.test.mjs` pins.
- **Shared-consumer degradation.** The app and other pipeline scripts share `momVerdict`. → the
  temporal store is console-only (V1/V2/V4); V3's only pure-core change is an OPTIONAL arg that is a
  no-op when omitted, so every existing caller is unaffected and the app inherits deliberately.
- **Over-codification.** Turning judgment into rules can fire on noise. → conviction gating is
  arm-then-confirm (never fewer alerts on a REAL breakdown, only fewer on a not-yet-convincing one),
  and the "do not codify" list stays explicit.
- **Placeholder thresholds.** `CUT_TRIGGER_DELTA`, `BANDTOP_FLAT_PCT`, `SUPPORT_LOOKBACK_DAYS`,
  `FRESH_HOURS` are UNVALIDATED. → named constants, documented as placeholders, cited nowhere as
  calibrated; display-only until V4, and even then arm-then-confirm bounds the downside.
- **Temporal-layer testing.** Cross-pass logic is easy to get subtly wrong. → the pure delta/counter
  functions are separated from IO precisely so they're fixture-tested with synthetic pass sequences
  (V1 done); V4's escalation gets the same treatment.

## Status
- V1 — DONE (this commit)
- V2 — DONE (this commit)
- V3 — DONE (0.52.0)
- V4 — PENDING
- V5 — PENDING

Fold this file into PLAN.md and delete it when V5 ships (the per-topic-plan rule in CLAUDE.md).
