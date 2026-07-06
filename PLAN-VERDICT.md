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
- **V6** — recovery-read (advisory recover-vs-drop forecast) + the capital-awareness companion —
  the payoff layer: the deterministic signals feed a *surfaced forecast*, so the LLM digs in only
  when the read is uncertain or conflicts with the verdict.

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

### V4 — conviction gating (arm-then-confirm) — **DONE**
- **Files:** `pipeline/lib/watchstate.mjs` (new pure `convictionGate()` + a `passesBelowSupport`
  counter mirroring `passesUnderwater` — added to the state entry, `computeDeltas`, `advanceState`),
  `pipeline/watch.mjs` (a pre-headline held-conviction loop stores `it.gate`; `heldAlert` consults it;
  armed notes render in the table loop), `pipeline/watchstate.test.mjs` (now 19 checks — 8 new V4
  fixtures), docs (`pipeline/MONITORING.md`, `.claude/skills/positions/SKILL.md`,
  `.claude/skills/morning/SKILL.md`, `CLAUDE.md`). **NOT js/quotecore.js — the pure core stays pure.**
- **APP_VERSION:** none (pipeline-only; the app has no per-pass store — the documented follow-on).
- **Tag:** BEHAVIOR CHANGE **to alerts only** (verdict strings unchanged; what *escalates to a headline
  ALERT* is gated).
- **What it does:** the pure `convictionGate({verdict, gate, passesUnderwater, price, support,
  cutTrigger, passesBelowSupport}) → {escalate, armed, reason}` decides ONLY whether a held verdict
  becomes a headline ⚠ ALERT. Precedence: (1) Gate-2 breakdown `CUT` — **EXEMPT**, escalates
  immediately/unconditionally (the byte-identical invariant); (2) structural break **convincingly**
  broken — price < cut-trigger (≥`CUT_TRIGGER_DELTA` below support) OR below support for 2 consecutive
  passes → escalate; (3) Gate-D `CUT-CANDIDATE` — arm on pass 1, escalate on the 2nd consecutive
  underwater-liquid pass; (4) a single non-convincing graze of support → arm. `momVerdict` output is
  untouched — the Verdict column still prints `CUT-CANDIDATE`; only the headline is gated. Armed items
  show a visible note (`CUT-CANDIDATE armed — 1st underwater pass…` / `approaching cut-trigger —
  armed…`), not a headline. The alert count reflects only confirmed escalations + always-immediate
  breakdowns/other existing alerts. Live evidence FOR this (2026-07-06 webweaver): a named ~18.25m
  tripwire broke to ~18.18m then bounced to ~18.55m **within one pass** — an immediate-fire cut would
  have sold the low; arm-then-confirm threads it.
- **TEST MANIFEST (8 new, `watchstate.test.mjs`):** `passesBelowSupport` increments over consecutive
  below-support passes; it resets on surface/identity/stale-gap; Gate-D 1st pass → armed no alert;
  2nd consecutive → escalate; a reset re-arms from pass 1; price ≥δ below support (single pass) →
  immediate structural escalation; a non-convincing graze arms, 2nd below-support pass escalates;
  **INVARIANT** — a Gate-2 breakdown CUT escalates immediately regardless of pass count / conviction.

### V5 — standardize the emit contract + doc reconcile — **PENDING**
- **Files:** `pipeline/watch.mjs` (unified per-item line), `pipeline/MONITORING.md`, `CLAUDE.md`,
  `.claude/skills/positions/SKILL.md`, `.claude/skills/morning/SKILL.md`.
- **APP_VERSION:** none (pipeline+docs).
- **Tag:** OUTPUT-ONLY (format) + docs.
- **What it does:** one standard emit line — `verdict · conviction · Δ-since-last · tripwire ·
  fill-progress` — and a reconciliation pass so MONITORING/CLAUDE/`/positions`/`/morning` describe the
  temporal layer consistently (process rule 8).

### V6 — recovery-read (recover-vs-drop forecast, ADVISORY) — **PENDING**
- **Files:** a PURE composer (new `pipeline/lib/` helper, or `js/quotecore.js` if the app will share
  it) that composes momVerdict's EXISTING inputs — `diurnalRead` (seasonal), `regimeDrift` + `phase`
  (trend direction), `underwaterHours` (persistence) — into a lean; surfaced in `pipeline/watch.mjs`;
  fixture-tested. Console-first (app Watch-tab adoption a documented follow-on).
- **APP_VERSION:** none if the composer is pipeline-consumed only (the `phase()` precedent); a bump
  only if the app renders it.
- **Tag:** OUTPUT-ONLY + ADVISORY — a surfaced line, NOT a verdict input. It informs the human/LLM; it
  never auto-cuts (respects the "do not codify judgment" line — the lean is decision SUPPORT, the
  verdict/alert paths are untouched).
- **What it does:** answers the question every non-clean position poses — *recover above BE, or keep
  dropping?* — as `seasonal (diurnal + weekly) × regime/phase direction × persistence` → a lean
  {likely-recovers | likely-drops | uncertain} + drivers, e.g. `recovery-read: likely recovers —
  post-trough hour + flat regime + at support`. Composes signals already computed (no new fetch). The
  cut-trigger δ (V2/V4) becomes a backstop, not the whole decision.
- **TRIGGER (Ben, 2026-07-06 — "if it isn't in a great position, sanity check"):** compute cheaply on
  every held lot + resting offer, but SURFACE only when the naive action isn't obviously right —
  (a) underwater, (b) thin-margin just above BE, (c) a decaying / unfilled ask, (d) a resting bid
  whose fill hinges on direction, or (e) the lean CONFLICTS with the current verdict (e.g. a green lot
  with a drop-lean — the highest-value case). SILENT on cleanly-good positions (comfortably green +
  filling + rising + clean momentum) — the naive action stands. Same informative-gating as V1/V2.
- **HONESTY (process rule 4):** a LEAN, not a probability; the per-item hourly magnitude is low-sample
  (the F1 cell-count problem) so lean on the robust STRUCTURAL shape (UK day/night, weekday/weekend),
  not a precise per-hour number; blind to shocks/repricings — `phase` (spike) is the only warning and
  it caps confidence. Anchor: the 2026-07-06 webweaver — rising regime + at structural support leaned
  recover, and it did (18.18m→18.55m) where the mechanical tripwire leaned cut.
- **TEST MANIFEST:** each trigger condition surfaces / stays silent as specified; the lean composes
  correctly for the canonical cases (quiet-trough + flat + at-support → recovers; falling + persisted
  through a liquid window → drops; conflicting inputs → uncertain); a cleanly-good position → silent.

### Companion — capital awareness + auto-scan on freed capital (Ben, 2026-07-06) — **PENDING**
- Rides V1's state store. The loop already knows DEPLOYED capital (held + resting bids) but NOT free
  cash — that isn't in the RuneLite logs. Assume reinvested unless told otherwise.
- **Design:** the robust version is event-driven — when a watch pass detects a SELL that freed ≥ ~5m
  (via V1 fill deltas), SURFACE a scan prompt inline in the loop output ("freed 7.4m — scan?"). A
  fuller version anchors to a stated bankroll and tracks proceeds−spend for a running free-cash
  figure, but the freed-capital trigger needs no anchor and is the honest floor.
- **Tag:** OUTPUT-ONLY (surfaces a suggestion; never auto-places — Ben places every offer).
  Console-first.
- Split from V6 because it's a loop/capital feature, not a verdict-layer forecast — sequence it after
  V4/V5 or fold into V6's land; coordinator's call.

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
- **V6:** ADVISORY — a surfaced forecast line, never a verdict/alert input, so the invariant is
  untouched (same guarantee as V1/V2's output-only lines). The Companion is likewise surface-only.

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
- V4 — DONE (pipeline-only — no APP_VERSION)
- V5 — PENDING
- V6 — PENDING (recovery-read forecast + the capital-awareness companion)

Fold this file into PLAN.md and delete it when V6 ships (the per-topic-plan rule in CLAUDE.md).
