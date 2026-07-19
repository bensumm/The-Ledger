# PLAN-GATE-NOISE — magnitude-blind momentum tell fires Gate 2 on noise (plan only)

Status: **DRAFT 2026-07-16** — nothing below is implemented. Sibling of `PLAN-VERDICT-NOISE.md`
(IMPLEMENTED 2026-07-11): that wave fixed the *display/persistence* layer (node-only, momVerdict
untouched) and explicitly deferred "promoting any of this INTO momVerdict itself" until post-retro.
This plan is that deferred layer — but one step further upstream: it changes WHETHER `mom`
classifies a break at all, in the shared classifier, not when a verdict headlines. Different layer,
different file (VERDICT-NOISE is a closed shipped record); executor adds a cross-pointer there.

## 1. Context / diagnosis

**Ben, 2026-07-16 (verbatim):** "So how can we make the gate more aware so it's less noisy?" — Gate 2
should distinguish a real breakdown from ordinary volatility **scaled to the item's own normal
range**, not a fixed threshold that's too tight for volatile items and too loose for tight ones.

**Root cause (confirmed in code).** The momentum tell in `computeQuote`
(`js/quotecore.js:340-342`) is magnitude-blind:

```js
let mom='clean', momPct=0;
if(quickBuy!=null && rawBandLo!=null && quickBuy<rawBandLo){ mom='breakdown'; momPct=(rawBandLo-quickBuy)/rawBandLo; }
else if(quickSell!=null && rawBandHi!=null && quickSell>rawBandHi){ mom='breakup'; momPct=(quickSell-rawBandHi)/rawBandHi; }
```

`momPct` is COMPUTED but never gates the flip — a 1gp print below the raw 2h band floor
(`rawBandLo` = the true min of the last 24×5m `avgLowPrice`, Bar-E split at :286-293) classifies
`breakdown` identically to a multi-percent crash. `momPct` is consumed only downstream as a
*strength* grade (`momCell` ↓ vs ↓↓ at `MOM_STRONG_PCT=0.02`, :706-715;
`trigger-alerts.mjs:105` `strongDown`). The classification itself has no floor.

**Blast radius of a false `breakdown`** (all keyed on the string, all currently fire on 1gp):
- `momVerdict` Gate 2 (`js/quotecore.js:589-612`): CUT (underwater) / LIST-TO-CLEAR (in profit) /
  HOLD-WATCH / SHOCK-WATCH — and the Gate-2 CUT is **deliberately EXEMPT from arm-then-confirm**
  (`pipeline/lib/watchstate.mjs:275-281`, precedence #1: "a live 2h breakdown while underwater is
  not a thing to sit on … NEVER silenced by a thesis"). So a noise flip headlines IMMEDIATELY.
- `js/quotecore.js:680` `liveBreak` (cut-trigger line), `js/rating.mjs:41` (risk mult 0.45),
  `js/estimators.mjs:105,229` (P(fill) penalty, confirmation), `js/forecast.mjs:93`,
  `js/held-item-strategy.mjs:160`, `pipeline/lib/gatecandidates.mjs:372` (overnight discard),
  `pipeline/commands/watch-positions.mjs:171,338,887` (FALLING class, CANCEL-BID),
  `pipeline/commands/quote-items.mjs:573` (staleRisk), `pipeline/lib/watchstate.mjs:75`
  (`isBreakdown` → breakdownSince), the app Momentum column (`js/trends.js:248`, `js/watch.js:182`).

**Anchor incidents (this session, 2026-07-16):**
1. **Soul rune** (the clean false positive): 9–16m units/day, normal daily range ~15–20gp (14d lows
   378–386, highs 394–402). A 2gp dip (391→389) below the 2h band floor while marginally underwater
   → full Gate-2 "CUT — free the capital" headline (exempt from every debounce), with the price
   sitting mid-range of its 14d structure and far above the declared thesis abort (378). Note
   momPct here was 2/391 ≈ **0.51%** — a fixed 0.5% floor would NOT have caught it.
2. **Water orb** (the chop re-trigger): a real ~2–3h volume-backed distribution correctly fired
   Gate 2, then kept re-firing on ordinary bounce-back chop all afternoon — once the crash lows
   rolled out of the 2h window, `rawBandLo` rose back to normal-chop levels and every small re-dip
   below the moving edge re-classified `breakdown`.

**Why the display-layer fixes (VERDICT-NOISE VN-1/2/3) don't cover this:** they gate headlines and
labels in the node render; the Gate-2 CUT is exempt from all of them BY DESIGN, and the app
surfaces plus rating/estimator/screen consumers read `mom` raw. The only layer that can fix a
false Gate-2 CUT without touching the protected exemption is the classifier itself.

## 2. Rulings (Ben, 2026-07-16 — encode, don't re-litigate)

- **R1.** Gate 2 must become "more aware" — the break threshold scales to the ITEM's own normal
  behavior, not a uniform softening, *if a per-item volatility measure is realistically available*
  (it is — §3). A fixed percent for every item is exactly the complaint.
- **R2.** The Gate-2-CUT exemption from arm-then-confirm is UNTOUCHED. It is the documented,
  fixture-pinned invariant (`watchstate.mjs:250-254` precedence #1; `quotecore.test.mjs`
  "V3 INVARIANT" :268-282, "P4a INVARIANT" :350-362; the bludgeon-exit lesson). The fix changes
  WHETHER `mom` classifies as breakdown, never WHEN a breakdown headlines.
- **R3.** This is judgment-layer/market logic — no relation to the session's visualization work
  (PLAN-VIZ-LAYER); separate plan, separate wave.

## 3. Existing scaffolding (not greenfield)

- **The per-item "typical swing" concept already exists**: `js/termstructure.mjs`
  `termStructure()` :115-154 — `typicalSwing` = IQR (q25→q75, `TYPICAL_LO_Q`/`TYPICAL_HI_Q`) of
  the durable-lookback (28d→14d fallback) mids, floored at `MIN_SWING_FRAC=0.02` of the floor;
  spike-robust by construction (fixture-proven, `termstructure.test.mjs:72-76`). Consumed by
  `floorValidator` (`js/validate.mjs:125-178` — the "buy X is N.NN× typical swing above the 28d
  floor" screen caution). **Caveat:** it takes a daily-mid `[{ts,mid}]` series (screen's
  `loadDaily` / archive), which `computeQuote` does NOT have.
- **The data to compute the same measure IS already in hand at the classifier**: `computeQuote`
  receives `ts6h` (`js/quotecore.js:279`) — the full wiki `/timeseries?timestep=6h` (365 points ≈
  90 days; fetched everywhere via `fetchItemInputs`, `pipeline/lib/marketfetch.mjs:170-177`, and by
  the app for Trends/Watch). `regimeDrift` (:133-146) and `phase()` (:157+, "ZERO new network")
  already mine it. An IQR of 6h mids over the last 14d is ~56 points — computable inline with the
  file's own `quantileSorted`, **zero extra fetch, on every surface uniformly (app + pipeline)**.
- **A strength threshold already exists downstream**: `MOM_STRONG_PCT=0.02` (`js/quotecore.js:706`)
  grades ↓ vs ↓↓ — precedent for a named, display-consumed momentum constant; it stays as-is.
- **Graze-vs-conviction doctrine already exists for the STRUCTURAL signal**: `convictionGate`
  precedence #2/#4 (`watchstate.mjs:293-310`) — through-the-trigger (δ ≈ 0.5%) OR persisted-below
  → escalate; a single non-convincing graze only ARMS. This plan is the same doctrine applied to
  the *momentum* signal — but at the classifier (stateless, per-magnitude), NOT via timing, because
  R2 forbids adding timing in front of the Gate-2 CUT. Reusing `convictionGate` itself is
  architecturally wrong here: it is node-only, stateful (needs the watch-state store), and gates
  headlines — the app and the screen/rating/estimator consumers of `mom` never pass through it.
- **The calibration loop exists**: `suggestions.jsonl` logs `mom` per pass
  (`pipeline/lib/suggestlog.mjs:267`) but NOT `momPct`; `pipeline/commands/join-outcomes.mjs` +
  `analyze-record.mjs` (`/analyze`) join the ledger to realized outcomes. Adding the magnitude
  fields makes false-positive rates measurable retroactively.
- **Prior art checked**: no prior attempt at a momentum-magnitude floor in `git log`/`CHANGELOG.md`
  (grep `momentum.*(threshold|noise)` / `graze` — no hits). `PLAN-VERDICT-NOISE.md` is the adjacent
  shipped wave (display layer; deferred this layer explicitly).

## 4. Options considered → target architecture

- **Option A — fixed `momPct` floor (e.g. 0.3–0.5%).** REJECTED as the primary fix: fails the Soul
  rune anchor outright (0.51% > 0.5%), and is exactly the uniform threshold R1 rules out — too
  tight for a volatile item, too loose for a tight one. Kept only as the shape of the degrade path
  discussion (and even there we prefer degrade-to-current, below).
- **Option C — threshold inside Gate 2 only (momVerdict), leave `mom` raw.** REJECTED: fixes one
  of ~12 consumers; watch's FALLING class, the overnight discard, rating, estimators, and the
  Momentum column would keep flipping on 1gp, and the table would contradict the verdict. Fix at
  the source (the repo's fix-at-the-source doctrine), one home.
- **Option B — RECOMMENDED: noise-scale the classifier at `js/quotecore.js:340-342`.**

**Target mechanics (all inside `computeQuote`, pure, zero new fetch):**

1. New pure helper in `js/quotecore.js` (same file as its one consumer + `quantileSorted`):
   `typicalSwing6h(ts6h, {days=MOM_NOISE_LOOKBACK_DAYS})` → the IQR (q25→q75) of the 6h mids
   (same `mid()` convention as `regimeDrift`) whose `timestamp` falls in the last `days` days;
   `null` when fewer than `MOM_NOISE_MIN_POINTS` mids (degrade). Header cross-pointers name it the
   intraday twin of `termstructure.mjs`'s `typicalSwing` (same IQR discipline, different series —
   deliberately NOT an import: `termstructure.mjs` imports `quantileSorted` FROM `quotecore.js`
   (:74), so quotecore importing termStructure back would create an ESM cycle; and termStructure
   requires a daily-mid series computeQuote doesn't have. One concern, two documented homes with
   pointers — flagged honestly, veto-able in favor of extracting the quantile into a leaf module.
2. Classifier becomes graze-aware:
   ```
   overshootGp = rawBandLo − quickBuy            (resp. quickSell − rawBandHi)
   noiseGp     = swing==null ? null : MOM_NOISE_SWING_FRAC × swing
   breakdown   ⇔ overshootGp > 0 && (noiseGp==null || overshootGp ≥ noiseGp)
   ```
   A sub-threshold overshoot leaves `mom='clean'` and sets an ADDITIVE
   `row.momGraze = {dir, gp, noiseGp}` (else null). `momPct` unchanged for real breaks. Additive
   `row.momNoiseGp` exposes the threshold used (`null` = degraded → classifier byte-identical to
   today). NO change to `mom`'s vocabulary (`clean|breakdown|breakup`) — every consumer keeps its
   equality checks; a graze behaves as clean everywhere, which IS the fix.
3. **Degrade contract = current behavior.** Thin/absent `ts6h` → `noiseGp=null` → any break
   classifies (today's sensitivity). Positive evidence of normal noise is required to SUPPRESS a
   tell — the same positive-evidence-defers doctrine as momVerdict's gates, and it means an
   unknown/new item can never have a real breakdown muted by a missing series.
4. **Symmetry:** apply the same threshold to `breakup` (proposed default, for one coherent
   classifier; the downside risk of a suppressed breakup is a missed ladder note / HOLD_STRONG —
   low harm). Flagged for veto in §8.
5. **NO level-fraction floor on the swing initially** (unlike termstructure's `MIN_SWING_FRAC`):
   a dead-flat item gets IQR≈0 → threshold≈0 → full sensitivity (a break from perfect flatness IS
   anomalous), and flat-band synthetic fixtures stay byte-identical. Revisit at calibration.

**What this does to the anchors:** Soul rune — 14d 6h-mid IQR ~4–8gp → threshold ~2–4gp at
`MOM_NOISE_SWING_FRAC=0.5` → the 2gp dip classifies clean+graze (borderline at the low end —
exactly what the replay in §9 checks). Water orb — the real multi-percent break is many × swing →
fires unchanged; the afternoon chop (small dips below the recovered band edge) sits under
threshold → suppressed. Genuine episodic re-triggers ABOVE threshold are real by definition;
stateless episode memory is out of scope (the node layer's `breakdownSince`/convictionGate already
covers headline persistence).

**Where code lives (one home per concern):** classifier + helper + constants →`js/quotecore.js`;
ledger fields → `pipeline/lib/suggestlog.mjs`; nothing new in `momVerdict`, `watchstate.mjs`, or
any consumer.

## 5. Staged chunks

**GN-0 — the noise-scaled classifier (the behavior change).**
- `js/quotecore.js`: `typicalSwing6h` helper + `MOM_NOISE_SWING_FRAC` / `MOM_NOISE_LOOKBACK_DAYS`
  / `MOM_NOISE_MIN_POINTS` (named PLACEHOLDERS, header-commented with what validates them) +
  the graze-aware classification + additive `momGraze`/`momNoiseGp` row fields.
- Fixtures (`pipeline/test/quotecore.test.mjs`): (a) Soul-rune-shape — tight 14d 6h series, 2gp
  break → `mom==='clean'`, `momGraze` set, and `momVerdict` does NOT return a Gate-2 verdict;
  (b) water-orb-shape — multi-% break on the same series → `breakdown`, and the bludgeon Gate-2
  CUT byte-identical to today; (c) degrade — no/thin `ts6h`, 1gp break → `breakdown` (today's
  behavior PINNED); (d) breakup symmetry twin. **Executor must audit every existing fixture that
  BOTH passes a `ts6h` (`mk6h`, test:519-526) AND asserts `mom==='breakdown'`** (e.g. the bludgeon
  setups around :88-180): `mk6h`'s two-level step series has a computable IQR — either the
  fixture's break already clears the threshold (verify numerically) or the fixture is amended
  deliberately and the amendment called out in the commit. `bandRow` fixtures (empty ts6h,
  :515-516) ride the degrade path untouched. The V3/P4a invariant fixtures (:268-282, :350-362)
  must pass UNMODIFIED.
- **APP_VERSION bump** (quotecore is app-imported by `js/trends.js:13`, `js/watch.js:17`; the
  Momentum column + Trends verdicts change behavior).
- Docs pass: `docs/MARKET-ANALYSIS.md` momentum-tell paragraph (:37-44) gains the noise threshold
  (reconcile "a break IS a real momentum tell" phrasing — grep for superseded absolutes);
  `CHANGELOG.md`; `PLAN-VERDICT-NOISE.md` gets a one-line cross-pointer.

**GN-1 — calibration plumbing (node-only, no APP_VERSION).**
- `pipeline/lib/suggestlog.mjs`: additive `momPct`, `momNoiseGp`, `momGraze` fields (JSONL is
  additive-safe; header schema comment updated; README `suggestions.jsonl` entry updated).
- `/analyze` / `join-outcomes.mjs`: a breakdown-outcome join — for each logged `mom='breakdown'`
  (and each suppressed graze), did the price recover above the band within N hours (false
  positive) or continue (true)? This is the data that graduates the §7 placeholders.
- Replay validation (n=1, honest framing): re-run the 2026-07-16 Soul-rune / Water-orb ledger
  windows through the new classifier; report breakdown-classification counts before/after (expect
  Soul rune 2gp → suppressed; Water orb main event → kept; afternoon chop → mostly suppressed).

**GN-2 — display honesty (optional, small).**
- `momCell` gains a muted graze token (e.g. `~`) so a suppressed break is visible-but-quiet rather
  than silently `–`; `docs/MARKET-ANALYSIS.md` symbol row updated. App change → rides GN-0's
  APP_VERSION or bumps its own. Skip if Ben prefers a clean `–`.

## 6. Encoding boundary

- **Encoded (scripts):** the entire rule — swing computation, threshold, degrade, graze fields —
  lives in `js/quotecore.js`; no skill prose re-states the numbers (pointers only, per
  docs-small-encode-in-scripts).
- **Judgment (skills, pointer-level):** `/positions` gets one line — "a `momGraze` note is
  sub-noise, not a breakdown; don't re-litigate it as one" — versioned SKILL bump, `judgment:`
  tagged if lint requires. No other prose rules touched; no triage-table entries retired.

## 7. Honesty (process rule 4)

Every constant below is a PLACEHOLDER, n≈0 — chosen to make the two n=1 anchor incidents come out
right, which is anecdote, not calibration:
- `MOM_NOISE_SWING_FRAC = 0.5` (overshoot ≥ half the 14d typical 6h-mid IQR). The Soul-rune 2gp dip
  is BORDERLINE at the low end of the estimated IQR — the GN-1 replay measures it, and the value
  may need to move.
- `MOM_NOISE_LOOKBACK_DAYS = 14`, `MOM_NOISE_MIN_POINTS` (≈20?) — lookback/degrade knobs, untested.
- IQR-of-6h-mids as the noise measure at all (vs MAD, vs a 5m-band-width multiple) — unvalidated;
  termstructure's own header asks the same open question.
**What validates them:** GN-1's breakdown-outcome join over the accumulating ledger (recovery-
within-N-hours false-positive rate for fired breakdowns AND for suppressed grazes — the plan
accrues BOTH sides by logging grazes). Until that sample exists, cite the threshold as "placeholder
pending retro", never as calibrated.

## 8. Open judgment calls for Ben (proposed defaults, veto-able)

1. **Symmetric breakup threshold** (proposed: yes, one coherent classifier) — suppressing a
   sub-noise breakup also suppresses its ladder note (`quote-items.mjs:556`) and HOLD_STRONG.
2. **Helper home**: inline twin in `quotecore.js` (proposed — avoids an ESM cycle and a series-type
   mismatch) vs extracting `quantileSorted` to a leaf module so termstructure owns ALL swing math.
3. **GN-2 graze display token** (`~`) vs keeping the column a clean `–`.
4. **`MOM_STRONG_PCT` left fixed at 2%** (display strength grade) — not swing-scaled in this wave;
   revisit at calibration if ↓↓ proves as item-blind as the base tell.

## 9. Verification (per-chunk acceptance)

- **GN-0:** all new fixtures in §5 pass; existing `quotecore.test.mjs` V3/P4a invariant fixtures
  pass UNMODIFIED (the Gate-2-CUT byte-identity is the regression that must never break); the
  degrade fixture pins today's behavior for series-less rows; `node --check` + full
  `pipeline/test` suite + CI `checks` + `smoke` green; a manual `quote-items.mjs "Soul rune"`
  against live data shows the Momentum column no longer flips on gp-level wiggle.
- **GN-1:** a logged pass shows the new fields; `join-outcomes`/`analyze` runs clean on a ledger
  mixing old (field-less) and new lines (additive back-compat proven by running it on the real
  file); the 2026-07-16 replay counts reported to Ben as n=1 evidence, not calibration.
- **GN-2:** smoke test green; symbol row in MARKET-ANALYSIS matches `momCell` output.
- **Docs reconciliation greps (rule 8):** `MARKET-ANALYSIS.md` for "a break is a real momentum
  tell" absolutes; `MONITORING.md` for any "any print below the 2h floor" phrasing; skills lint.

## 10. Bookkeeping & compatibility checklist

- APP_VERSION: GN-0 bumps (app-imported `js/quotecore.js` behavior change); GN-1 node-only (no
  bump, note in commit message); GN-2 app display (bump or ride GN-0).
- README inventory: no new files planned (helper + constants live in existing modules; fixtures in
  the existing test file) — if the executor splits a new test file, register it at creation.
- `suggestions.jsonl` schema: additive fields only; header comment in `suggestlog.mjs` + README
  entry updated in the same commit; `retrojoin.mjs`/`join-outcomes.mjs` must tolerate absent
  fields (they must already — old lines lack many fields).
- `screen.json` / published artifacts: row shape gains additive `momGraze`/`momNoiseGp` via
  computeQuote — additive, no shape freeze broken; note in the PB4 `reachable`-band context that
  nothing there is touched.
- Landing: attended direct-push under the admin bypass, chunk-per-commit, docs pass per commit;
  fold this file into `PLAN.md` and delete it when GN-1 (or GN-2 if taken) ships.
