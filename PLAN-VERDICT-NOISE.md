# PLAN-VERDICT-NOISE — held-position verdict churn (problem statement)

Status: **IMPLEMENTED 2026-07-11** — VN-0 (2bfa4a7), VN-1 (fd0ad54), VN-2 (3df2014), VN-3
(817cdd4) all landed locally (F0–F4; F5 deferred as planned). Replay (n=1, 2026-07-11 session):
raw label transitions 15/10/13 (Berserker/Toxic/Masori) → 2/2/0 through the full stack, Gate-2
CUT still immediate. momVerdict untouched; the deferred post-retro momVerdict step remains open.

## Symptom (what Ben observed)

The held-position outputs (`quote.mjs --positions` + `watch.mjs`) are **noisy and
inconsistent** — the verdict label swings across the whole vocabulary while the underlying
price barely moves. Live evidence, one item, ~30 minutes, 3-minute cadence:

Berserker ring ×8 (held@ 3.08m, BE 3.15m), instabuy oscillating **3.10m–3.17m the entire
time (~2% band)**, cycled through:

```
HOLD → UNDERWATER → NO-READ → CUT → CUT-CANDIDATE → HOLD → LIST-TO-CLEAR → HOLD → CUT
      → LIST-TO-CLEAR → HOLD → LIST-TO-CLEAR ...
```

Same pass can show `⚠ CUT` / `⚠ LIST-TO-CLEAR` in the headline while the note directly below
reads *"armed — a flicker at this cadence; headline only if the breakdown HOLDS ~4m."* Two
layers disagreeing in one render.

## Diagnosed root causes (hypotheses for Fable to confirm/refute in code)

1. **Stateless per-pass verdict on a position parked ON break-even, in a thin book,
   re-evaluated every 3 min.** BE sits *inside* the 5m noise band (Berserker BE 3.15m, live
   3.10–3.17m; Masori BE 43.07m, live ~43.11m; Toxic BE 11.04m, live ~11.0–11.1m — all three
   within ~0.5% of BE). "Is live above BE?" is a coin-flip per print → UNDERWATER↔HOLD flips
   every pass.

2. **Momentum tell keys off the 2h band low, which is itself recomputed each pass.** Live
   crossing the moving band edge by a hair flips `clean`↔`breakdown`, which flips
   LIST-TO-CLEAR/CUT on and off.

3. **Feed inversion on thin books** (e.g. Masori 41/d) intermittently forces NO-READ — a pure
   artifact interleaved with real verdicts.

4. **Displayed verdict is NOT debounced, but the alert layer IS.** The arm-then-confirm /
   persistence machinery (V4) gates the *headline alert* but the *table verdict label* still
   shows the instantaneous per-pass verdict — so the two disagree (headline "CUT" vs note
   "armed ~0m flicker").

5. **Path weights are placeholders and flap** (list-to-clear 0.30↔0.42, cut 0.42↔0.57) — false
   precision that reads as instability.

6. **Cadence oversampling.** 3-minute polling on positions that move ~1%/hour manufactures the
   flip-flop; nothing actionable happens in 3 minutes on these lots.

7. **FRAME MISMATCH (the deepest one — Ben's key point).** These positions were **entered on
   the DIURNAL thesis** — buy the intraday dip window, sell the diurnal PEAK window (Berserker
   peak 01:00–03:00 ~3.24m; Masori peak 23:00–06:00 ~44.22m; Toxic peak 05:00–09:00 ~11.20m).
   The exit is a *time-of-day peak that hasn't arrived yet*. But `momVerdict` judges them with
   a **band-flip frame** (2h-band breakdown, instabuy-vs-BE clear), which is the wrong model for
   a diurnal-entry hold. Every LIST-TO-CLEAR/CUT during the pre-peak trough window is the
   band-flip frame flagging the *expected* dip as a problem. The verdict has no concept of the
   position's **entry thesis**, so it re-litigates a diurnal hold as if it were a band scalp.
   (Related existing infra: `thesis.mjs set --path`, `js/paths.mjs`, the path engine, the
   diurnal profile in `js/windowread.mjs`, the rebid-advisory's OSCILLATES/trough-peak read.)

## Why it matters

- The churn erodes trust in every verdict, including the real ones — a genuine structural break
  (the only line that matters, e.g. Berserker's 3.06m cut-trigger) is buried in flip-flop.
- It drove repeated near-misses this session: HOLD-through advice was correct every time the
  alert self-resolved next pass, but only because the operator *manually* re-framed each one.
- It mis-priced exits: the band-top "clear" numbers (43.60m Masori) are BELOW the diurnal peak
  target (44.22m) the position was actually entered to capture — the noise frame was actively
  losing money vs the entry thesis.

## Scope / constraints for the resolution

- **Files most likely in play:** `momVerdict()` (shared, in `pipeline/lib/context.mjs` or
  `js/quotecore.js` — confirm), `pipeline/watch.mjs` (render + V4 arm-then-confirm), the
  path/thesis engine (`js/paths.mjs`, `thesis.mjs`, watch-state persistence), the diurnal
  reads (`js/windowread.mjs` `hourProfile`/`deriveDiurnalRange`), `js/quotecore.js`
  `computeQuote`, `pipeline/MONITORING.md` (verdict vocabulary — the ONE home for the gate
  tree). Read the CLAUDE.md "market analysis workflow" + `/positions` skill for the verdict
  contract before proposing changes.
- **Placeholder-honesty (process rule 4):** any new threshold/hysteresis constant is a named
  PLACEHOLDER pending validation; don't oversell.
- **APP_VERSION ripple:** several of these modules are app-imported (`quotecore.js`,
  `validate.mjs`, `windowread.mjs`, `paths.mjs`?) — a behavior change there bumps
  `APP_VERSION`; a node-only change does not. Flag which bucket each proposed change lands in.
- **Don't regress the real signal:** the Gate-2 live-breakdown CUT is deliberately
  immediate (not debounced) — a genuine breakdown must still fire fast. The fix must
  de-noise the *parked-at-BE ranging* case WITHOUT muting a real structural break.

## Candidate directions (seeds only — Fable to evaluate, expand, or reject)

- **Verdict hysteresis:** the displayed label only changes after N consecutive concordant
  passes (extend V4's arm-then-confirm from the alert layer to the label itself).
- **Break-even dead-band:** when |live − BE| < the item's typical 5m noise, emit a stable
  `PARKED — at break-even` state instead of flipping UNDERWATER/LIST-TO-CLEAR.
- **Thesis-aware verdicts:** read the position's entry thesis (diurnal / band / value-hold /
  scalp from `thesis.mjs`/`paths.mjs`) and evaluate the exit against THAT frame — a diurnal
  hold is judged against its peak window + a structural abort, not the 2h band. This is the
  big one and likely subsumes several others.
- **State-change-only reporting + cadence:** report deltas, not a full re-derived verdict each
  pass; suggest a thesis-appropriate cadence (a diurnal hold wants a check near its peak
  window, not every 3 min).
- **Reconcile the two layers:** never render a headline verdict the note simultaneously calls a
  flicker.

## Deliverable Fable should produce (append below this line)

A **RESOLUTION PLAN**: confirmed root-cause mechanics (with file:line citations), a ranked set
of fixes (smallest-blast-radius first), which are cadence/reporting (free) vs code changes,
APP_VERSION impact per change, the placeholder constants each introduces, a test/validation
approach (esp. that the parked-at-BE churn dissolves while a real breakdown still fires fast),
and a suggested chunk sequence that fits the repo's landing process (attended direct-push under
the admin bypass; docs-reconciliation pass per process rule 8). Do NOT implement — plan only.

---

## RESOLUTION PLAN


_Appended by the Fable investigation, 2026-07-11. Plan only — nothing below is implemented._

### A. Confirmed root-cause mechanics (file:line)

**RC1 — stateless per-pass BE comparison. CONFIRMED.**
`underwater = instabuy < breakEven` is recomputed from the live `/latest` print every pass
(`js/quotecore.js:541`; same predicate in `pipeline/lib/watchstate.mjs:60`). The table label
falls through to `UNDERWATER`/`HOLD` off that single comparison (`pipeline/watch.mjs:634-640`
`heldVerdict`; compact prose fallback `pipeline/lib/context.mjs:264-274`). Crucially the plain
**UNDERWATER headline is NOT time-gated** — `heldAlert` fires it per pass
(`pipeline/watch.mjs:426-427`); only a `cut-candidate-armed`/`thesis-armed` gate suppresses it
(`watch.mjs:425`). A BE-parked lot with no declared thesis flips HOLD<->UNDERWATER at both
layers every pass. One nuance vs the hypothesis: the full vocabulary swing needs RC2/RC3 too —
the churn is the PRODUCT of three per-pass inputs, not BE alone.

**RC2 — momentum keyed to the recomputed 2h raw band. CONFIRMED.**
`mom` is derived per pass from live vs `rawBandLo`/`rawBandHi` over the rolling last-24x5m
window (`js/quotecore.js:310-312`, band built at :262-263). A hair below the rolling raw min
flips clean->breakdown, which flips the verdict to CUT (underwater, :569-571) or LIST-TO-CLEAR
(in profit, :578-582). The band edge itself moves every pass (buckets enter/leave the window),
so the trigger line is non-stationary. Only the LIST-TO-CLEAR *headline* is time-gated
(`watchstate.mjs:265-268`); the *label* is not; the Gate-2 CUT headline is exempt by design
(`watchstate.mjs:229-235` — the invariant to preserve).

**RC3 — feed artifacts interleave NO-READ. CONFIRMED.**
`reliableReason` (no-quote / feed-inversion / stale-quote / one-sided-band / sparse-band) is
recomputed per pass (`js/quotecore.js:285-293`); Gate 0 turns any of them into a NO-READ
verdict (`js/quotecore.js:536-540`). On a thin book the quote drifts in and out of
stale/one-sided pass to pass, so NO-READ interleaves with real verdicts as a pure artifact.

**RC4 — the alert is debounced, the displayed label is not. CONFIRMED (the exact two-layer
disagreement).** The V4/V7 arm-then-confirm (`convictionGate`, `watchstate.mjs:225-274`;
`ALERT_PERSIST_MS = 4m` placeholder at :57) gates ONLY the headline (`heldAlert`,
`watch.mjs:384-431`). The displayed table verdict is the raw per-pass momVerdict:
`watch.mjs:737-739` (via `heldVerdict` :634-640) and `quote.mjs:247` (via `renderHeldVerdict`
-> `ctx.position.mv`, `context.mjs:122, 243-245, 317-325`). The gate result rides separately
(`context.mjs:126-140`) and is rendered only as conviction NOTES (`watch.mjs:766-778`,
`quote.mjs:270-275`). The observed contradiction is verbatim in the code: the table pushes
`LIST-TO-CLEAR` (:739) while the note prints "LIST-TO-CLEAR armed — ... a flicker at this
cadence; headline only if the breakdown HOLDS ~4m" (`watch.mjs:775-776`).

**RC5 — placeholder path weights flap in visible quantized steps. CONFIRMED.**
`scorePath` re-weighs every pass from the same flapping booleans (`js/paths.mjs`, scorePath):
list-to-clear = 0.30 base (`PATH_BASE_VIABILITY`) + 0.12 `BREAKDOWN_EXIT_BONUS` — exactly the
observed 0.30<->0.42; cut adds +0.15 `UNDERWATER_ESCAPE_BONUS` on the underwater flicker —
the observed 0.42<->0.57. The DOMINANT path is persistence-gated (`pathPersistence`,
`watchstate.mjs:321-354`) but the printed menu viabilities are raw per-pass two-decimal
numbers (`context.mjs:343-354`) — false precision rendered as instability.

**RC6 — cadence oversampling. CONFIRMED as an operating interaction, not a bug.**
watch.mjs recommends the tightest per-class cadence 1-3m (`watch.mjs:139-150`, `loopMin`
:609) while `MONITORING.md:288` names 5m the operating default and `ALERT_PERSIST_MS` is 4m —
at a 3m loop, most noise never confirms into a headline, yet the LABEL (RC4) flips every pass.
Nothing actionable happens in 3 minutes on a lot moving ~1%/h.

**RC7 — FRAME MISMATCH. CONFIRMED — no verdict path reads the entry thesis.**
- `momVerdict`'s `lotCtx.path` is "PLUMBED THROUGH ONLY — NO gate reads it yet", by explicit
  contract (`js/quotecore.js:523-525`, P4a byte-identity pinned in quotecore.test.mjs).
- The ONLY thesis influence anywhere is convictionGate branch 1b (`watchstate.mjs:242-244`):
  it silences the UNDERWATER/CUT-CANDIDATE *headline* above a declared tripwire — it never
  touches the label, and it explicitly EXCLUDES LIST-TO-CLEAR (:243) — which is precisely the
  verdict the band-flip frame keeps emitting on a pre-peak diurnal trough.
- There is no diurnal path key (`PATH_KEYS`, `js/paths.mjs`: scalp / value-hold /
  hold-recovery / be-escape / list-to-clear / cut / avoid).
- Gate 1 DIURNAL-WATCH (`js/quotecore.js:546-552`) is a narrow stateless defense (quiet hour
  AND same window dipped+recovered yesterday) — it cannot hold a lot toward a peak-window exit
  and is spent the moment the window turns liquid.
- The diurnal exit infra exists but never feeds a held verdict: `hourProfile` /
  `deriveDiurnalRange` (`js/windowread.mjs:175/285`) print on the per-item quote read
  (`quote.mjs:145-155`) but NOT on `--positions`; `rebidAdvice`'s OSCILLATES branch accepts a
  diurnal read but `--positions` passes `diurnal: null` (`quote.mjs:299`).
- The mis-priced exit is structural: every exit-family `listAt` is the instabuy or the 2h band
  top (`js/quotecore.js:555, 570, 582, 609`) — never the diurnal peak level the position was
  entered to capture (Masori "clear 43.60m" < peak target 44.22m).
- Feasibility groundwork already exists: `hold-thesis.json` entries carry
  `{ exitPrice, tripwire, horizon, path, enteredUnder }` (`pipeline/lib/holdthesis.mjs:29-38`),
  `thesis.mjs set --path` writes them, and `positionStage` already threads `thesisEntry` into
  the shared ctx (`context.mjs:107-145`). watch.mjs already fetches ts1h per held item
  (`watch.mjs:360`), so a peak-window read there is zero extra fetch.

**Not confirmed / refuted:** none of the seven hypotheses was wrong; RC1's "coin-flip per
print" is the only over-simplification (see RC1 nuance).

### B. Ranked fixes — smallest blast radius first

**F0 — operate the machinery that already exists (free; docs/skills only).**
- Rule: every DELIBERATE diurnal/value entry gets a declared thesis at entry time —
  `node pipeline/thesis.mjs set "<item>" "<plan>" --tripwire <structural-abort> --path value-hold`.
  That activates the existing TG1 headline silence (`watchstate.mjs:242-244`) TODAY. The
  observed session had no declared theses on any of the three lots.
- Cadence: a parked-at-BE hold with a declared exit window wants a check near its peak window
  plus ~2-3 passes/day, not the 1-3m class cadence — prose in MONITORING.md "Cadence" +
  `/positions`/`/overnight`.
- Cost: SKILL.md `version` bumps + MONITORING.md prose. No APP_VERSION, no code. Limits: the
  label still flips; LIST-TO-CLEAR still headlines after 4m of a real band wobble.

**F1 — label hysteresis: extend arm-then-confirm to the DISPLAYED verdict (node-only code).**
- Persist `lastConfirmedVerdict`/`verdictSince` on the watch-state entry (ADDITIVE fields in
  `advanceState`) and add a pure `verdictPersistence(prior, mv, gate, now)` in
  `pipeline/lib/watchstate.mjs`, mirroring `pathPersistence`: the RENDERED label changes only
  when (a) the incoming verdict is escalate-exempt — the Gate-2 breakdown CUT — which displays
  and headlines IMMEDIATELY on pass 1 (the invariant, structurally preserved by the same
  carve-out as `convictionGate` #1), or (b) the underlying condition has persisted >=
  `VERDICT_PERSIST_MS` (new named PLACEHOLDER, default = `ALERT_PERSIST_MS` 4m, n~0). While a
  challenger is arming, render the incumbent label + suffix `(<candidate> arming ~Nm)` — the
  table and the note can no longer disagree (RC4 dissolved by construction).
- NO-READ becomes a NOTE when an incumbent exists: Gate 0 with a prior confirmed verdict keeps
  the incumbent label + appends `(read unreliable this pass — <reason>)`; NO-READ stays the
  label only on first sight (RC3 de-noised without touching Gate 0 honesty).
- Files: `pipeline/lib/watchstate.mjs`, `pipeline/lib/context.mjs` (renderHeldVerdict gains the
  persisted-verdict input), `pipeline/watch.mjs` (heldVerdict/table/briefRows), `pipeline/quote.mjs`.
  `momVerdict`/`js/quotecore.js` UNTOUCHED.
- APP_VERSION: **none** (all node-only). The app Trends/Watch surfaces keep the instantaneous
  verdict — acceptable (they are not the 3m-cadence surface); note it in docs.
- New placeholders: `VERDICT_PERSIST_MS`.
- Note: quote.mjs is READ-ONLY on watch-state (P0 contract, `quote.mjs:212`) — when no watch
  loop is running, quote hysteresis degrades to whatever the state file last held, then to
  the instantaneous verdict. Honest degrade; document it.

**F2 — `PARKED — at break-even` dead-band display state (node-only code; optional).**
- When live instabuy sits within a dead-band of BE AND mom is clean/arming, render `PARKED —
  at break-even (+/-X)` instead of the HOLD/UNDERWATER alternation, and suppress the ungated
  UNDERWATER headline (`watch.mjs:426`) inside the dead-band (falling-regime alert unchanged).
- Dead-band = half the item current 2h raw band width, floored at a fixed pct — BOTH named
  PLACEHOLDERS (`BE_DEADBAND_BAND_FRAC`, `BE_DEADBAND_MIN_PCT`), n~0, unvalidated.
- Same render layer as F1; momVerdict untouched -> no APP_VERSION. Adds ONE display token to
  the vocabulary -> MONITORING.md step 4 (the ONE home) updated in the same commit.
- Partially subsumed by F1 (which stops the flip), but PARKED names the situation instead of
  freezing a stale HOLD — cheap once the F1 layer exists; ship after F1 only if wanted.

**F3 — THE THESIS-AWARE VERDICT FRAME (RC7 — the big one; node-only code).**
- Feasible with existing infra, yes: three additive pieces.
  1. Optional declared exit WINDOW on the hold-thesis entry (`window: "1-3"` local hours) —
     additive key per the holdthesis.mjs back-compat contract; written by `thesis.mjs set`
     (which already parses a `--window` flag for the session store).
  2. Render frame in `context.mjs`: when a declared thesis exists AND live > tripwire, the
     held lot RENDERS as the thesis frame — `HOLD — per thesis (<path>): exit <exitPrice>
     @ <window> . abort < <tripwire>` — with the band-flip read demoted to the note line.
     When live < tripwire -> fall through to normal escalation. **Gate-2 CUT always overrides
     the frame** (a genuine breakdown-while-underwater stays immediate at BOTH layers — the
     same precedence `convictionGate` #1 already encodes at `watchstate.mjs:229-235`).
  3. Scope the TG1 silence to also cover LIST-TO-CLEAR *only when a thesis is declared and
     live > tripwire* (amending the exclusion at `watchstate.mjs:243`): the pre-peak trough
     "clear at the band top" is exactly the expected dip the declared abort level supersedes.
     The Gate-2 CUT exemption is untouched.
- Exit pricing: the frame exit is the DECLARED exitPrice (falling back to the diurnal ASK
  from the in-hand 1h series — zero extra fetch on watch.mjs (`:360`); on `--positions` start
  with the declared window/price verbatim, zero fetch), fixing the band-top-below-peak
  mis-pricing (the RC7 money leak — 43.60m band top vs 44.22m peak target).
- Files: `pipeline/lib/holdthesis.mjs` (+window), `pipeline/thesis.mjs`,
  `pipeline/lib/watchstate.mjs` (convictionGate 1b scope), `pipeline/lib/context.mjs`,
  `pipeline/watch.mjs`, `pipeline/quote.mjs`. `momVerdict`/`js/quotecore.js`/`js/paths.mjs`
  UNTOUCHED -> **no APP_VERSION**.
- Does it subsume the smaller fixes? For DECLARED lots, largely yes — it dissolves the
  UNDERWATER/CUT-CANDIDATE/LIST-TO-CLEAR churn at both layers AND fixes the exit target. It
  does NOT cover undeclared lots (incidental inventory, forgotten declarations) — F1 stays the
  floor under everything. Recommendation: **F0 + F1 + F3**; F2/F4 optional.
- Deliberately NOT proposed: a new `diurnal` PATH_KEY. The exit window is metadata on the
  declared plan, not a competing thesis-path — value-hold/hold-recovery already carry the
  hold-side weighting, and a new key means fresh placeholder weights (n=0) + strategies.mjs
  vocabulary churn for no verdict benefit. Revisit under P6 evidence-based viability.

**F4 — weight-display honesty (RC5; node-only, cosmetic).** Render path-menu viabilities
coarsely (high/med/low, or one decimal) in `renderPathLine` (`context.mjs:343-354`) so the
+/-0.12 placeholder steps stop reading as instability. No new constants. Dominant-path
persistence already exists; this is presentation only.

**F5 — deferred:** a `--changes-only` watch output mode (state-change deltas instead of a full
re-derived board). Revisit only if churn survives F1+F3.

### C. Validation — churn dissolves, real breaks still fire fast

- New fixture test `pipeline/verdictpersist.test.mjs` (style of `watchstate.test.mjs` /
  `statetransition.test.mjs`), pure synthetic pass sequences:
  1. **Parked-at-BE (the Berserker shape):** instabuy oscillating ~1% across BE, band edge
     grazed once mid-sequence — assert the RENDERED label holds ONE state (HOLD/PARKED) across
     >=10 passes and no headline fires, while asserting the RAW mv underneath still flips
     (honesty: the fix is presentation+persistence, not a changed decision function).
  2. **Real breakdown (the bludgeon shape):** live instasell below rawBandLo AND instabuy <
     BE -> Gate-2 CUT label AND headline on pass 1 THROUGH the new layer — extends the existing
     V3/Gate-2 byte-identity pins; this is the regression that must never break.
  3. **Thesis frame:** declared tripwire below live -> LIST-TO-CLEAR mv renders as the thesis
     HOLD + armed note, no headline; live below tripwire -> normal escalation resumes; Gate-2
     CUT with a declared thesis still immediate (extends the TG1 cases in watchstate.test.mjs).
  4. **NO-READ interleave:** reliable=false on pass N of a stable HOLD -> label unchanged +
     "(read unreliable this pass)" note; NO-READ as label on first sight only.
- **Live replay off the ledger:** the churn is already logged — `suggestions.jsonl` carries the
  per-pass held verdict (`watch.mjs:646-654`, `quote.mjs:263`). Re-run the 2026-07-11
  Berserker/Masori/Toxic window through the new render and count label transitions: expect the
  ~12-flip half-hour to collapse to <=2 while any genuine Gate-2 pass still renders CUT. Report
  the counts as n=1 session evidence, not calibration (rule 4).
- All new constants (`VERDICT_PERSIST_MS`, `BE_DEADBAND_*`) are named PLACEHOLDERS, n~0;
  the F1-retro/analyze loop owns later calibration off the suggestions ledger.

### D. Chunk sequence (attended direct-push under the admin bypass; docs pass per rule 8)

1. **VN-0 (free, docs/skills):** F0 — declare-thesis-at-entry rule + thesis-appropriate
   cadence -> `/positions`, `/overnight` (SKILL version bumps), MONITORING.md "Cadence".
   Can ship today; also immediately declare theses on the three live lots.
2. **VN-1 (code):** F1 label hysteresis + NO-READ note-ification + `verdictpersist.test.mjs`.
   Docs reconciliation: MONITORING.md step 4 states the displayed verdict is persistence-gated
   (vocabulary itself unchanged, Gate-2 CUT immediacy restated); `/positions` step-3 pointer;
   CHANGELOG; README inventory (new test file). No APP_VERSION (pipeline-only, noted in the
   commit message per rule 5).
3. **VN-2 (code):** F3 thesis frame — holdthesis `window` field + thesis.mjs writer +
   convictionGate LIST-TO-CLEAR scoping + render frame + fixtures. Docs: MONITORING.md step 4
   gains the `HOLD — per thesis` display form + the declared-thesis LIST-TO-CLEAR gating note
   (grep for superseded "LIST-TO-CLEAR is excluded" phrasing — the rule-8 reconciliation);
   the README hold-thesis.json entry updated (tracked file, schema change). No APP_VERSION.
4. **VN-3 (optional):** F2 PARKED + F4 coarse weights; MONITORING.md step 4 + `/positions`.
5. **Post-wave:** after ~a week of declared theses, `/analyze` retro on label-transition
   counts + thesis outcomes. Only then consider promoting any of this INTO `momVerdict`
   itself — that step WOULD bump APP_VERSION (`js/quotecore.js` is app-imported by
   `js/trends.js:13` and `js/watch.js:17`) and is deliberately deferred until the node-side
   shape is validated.

**APP_VERSION bucket summary:** every proposed change lands in node-only files
(`pipeline/watch.mjs`, `pipeline/quote.mjs`, `pipeline/thesis.mjs`, `pipeline/lib/context.mjs`,
`pipeline/lib/watchstate.mjs`, `pipeline/lib/holdthesis.mjs`) -> **no APP_VERSION bump in any
chunk**. App-imported modules deliberately untouched: `js/quotecore.js` (trends.js + watch.js),
`js/windowread.mjs`/`js/validate.mjs`/`js/forecast.mjs`/`js/termstructure.mjs` (trends.js, TV
0.58.0/0.60.0). `js/paths.mjs` is currently node-consumed only (imported by js/strategies.mjs
and the pipeline; no app module imports either) — but no change to it is proposed anyway.
