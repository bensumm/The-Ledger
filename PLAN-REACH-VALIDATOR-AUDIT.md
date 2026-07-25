# PLAN-REACH-VALIDATOR-AUDIT — is `reach` actually costing us anything?

**Status: SCOPING + LIVE ANALYSIS, no code changed.** Investigates `PLAN-BLINDSPOT-AUDIT.md`
finding #5 ("`reach` validator is the single largest reject source in the historical record,
unverified as correctly-tight"). READ-ONLY: read `js/validate.mjs` / `js/flip-niches.mjs` /
`pipeline/lib/analyze.mjs`, ran `analyze-record.mjs --json`, and ran a new read-only forward-reach
join against `pipeline/lib/archive.mjs` (not built before this session). Companion to
`PLAN-MULTIWEEK-OSCILLATOR.md`. Related, NOT duplicated: `PLAN-REACH-CALIBRATION.md` (in-flight,
still open at its AC1 gate result) investigates a different axis of `reach` — whether the
underlying 1h-average-based reach CHECK correctly measures achievable price for a small resting
order. This doc investigates whether the reject VOLUME itself represents real, current lost
opportunity. Read both if working on `reach` next.

---

## 1. The premise needs a correction before anything else

The blindspot audit quoted `analyze-record.mjs --json`: **8,009 of ~9,800 validator rejects are
`reach`** (re-run this session: **8,118** — the dataset grew). It also quoted the audit doc's own
framing: *"`reach` gates on `band`+`churn`, informs elsewhere per the P2/P3 registry."*

**That framing is wrong for the CURRENT registry.** Reading `js/flip-niches.mjs` directly: every
spec — band, churn, scalp, value, amplitude — declares `{ key: 'reach', mode: 'inform' }`. `git
log -S"key: 'reach', mode: 'gate'"` over this file's whole history returns **zero commits** —
`reach` has never been a gate-mode validator for any flip-niche since it was introduced. The
registry's own header comment says so explicitly: *"the newly-activated validators (reach,
trajectory, value-amplitude) start INFORM everywhere; only the already-live floor + limit gates
gate."* `reach` is designed to be a shadow validator today, by deliberate rollout choice — not a
live gate that happens to fire a lot.

**Confirmed directly against `suggestions.jsonl` (74,735 rows, all reach validator entries):**

| status | inform-mode (shadow, never drops a row) | gate-mode (real drop) |
|---|---|---|
| caution | 14,514 | 192 |
| reject | **8,081** | **37** |

**99.5% of the reject count the audit flagged never actually removed a suggestion from any
screen output.** Only 37 rows, system-wide, across the whole archive, were ever actually dropped
by `reach` in gate mode (and those 37 come from a `null`-mode niche — a `quote`/`positions`
surface, not a discovery screen). A sample row with `status:'reject', mode:'inform'` is still
present in `suggestions.jsonl` with a passing `verdict:'A-'` — the row shipped normally; `reach`
only annotated it.

**This is the headline finding of this audit: as currently wired, `reach` is not a meaningful
false-negative source in live behavior.** The 8,118 figure is real, but it measures how often the
shadow-logged signal WOULD reject if flipped to gate — exactly the F1-rollout instrumentation it
was built to be, not a currently-active discovery filter. The blindspot audit's own honesty
caveat ("a high reject count alone is NOT evidence of over-tightness") turns out to be truer than
even it assumed: the count barely touches live behavior at all right now.

---

## 2. So what IS worth asking — is the signal itself well-calibrated, for whenever it graduates to gate?

Given `reach` is inform-only today, the actual decision-relevant question isn't "is it costing us
flips right now" (it mostly isn't) but "if/when it's flipped to gate per-niche, is the threshold
roughly right." Two things investigated:

### 2a. Is `reject` firing on marginal cases or genuine ones?

`reachValidator`'s reject line is `frac <= REACH_REJECT_FRAC (=0)` — by construction, a **pure**
reject (no RC1 stale bump) only fires when a level was reached on **zero** of the scored ~14
nights. That's a strict, definitional signal, not a marginal-45%-rounds-down-to-reject case.
Parsing the actual reason strings behind all 8,118 rejects:

- **5,381 (66%)** are genuine `frac = 0` — never reached in the whole scored window.
- **2,737 (34%)** are RC1 **stale-optimistic bumps** — the level WAS reached historically (up to
  ~43% of nights), but the recent 3-night sample shows 0 hits, so severity gets bumped one step
  (caution→reject). This is a real, different signal from a genuine zero — a level that used to
  print but the recent regime doesn't confirm.

So a third of "reject" isn't "never happens," it's "happened in the past, not lately" — worth
knowing before ever gating on this, since a bump off a 3-night sample is a much thinner basis than
the reject label alone suggests.

### 2b. Would rejected levels have actually printed if given the chance? — the join, built this session

The blindspot audit flagged this as unbuildable: *"no not-taken→would-have-filled counterfactual
exists yet."* That was true as of `PLAN-REACH-CALIBRATION.md`'s 2026-07-17 check of the archive
(then: 189 one-hour buckets, "cannot yet support a continuous cross-day... reach read"). **It is
no longer true.** `pipeline/lib/archive.mjs` now holds continuous 1h data from **2026-06-11 to
2026-07-24** (1.1M rows), fully overlapping `suggestions.jsonl`'s range (starts 2026-07-04). That
means for any reach-reject row whose scoring window has since elapsed, we can directly ask the
archive: *did the market actually reach that ask/bid within the following windowHours?* — a real
market-truth counterfactual, no fills needed.

Built and ran a read-only script doing exactly this (sampled ~3,700 of the 7,402 reach-reject rows
whose 8h forward window has fully elapsed, using `archive.seriesFor(itemId, '1h', {from, to})`
against the parsed ask/bid level from each row's own logged reason string):

| status scored | forward-reached within 8h (real market data) |
|---|---|
| reject (n=3,701 sampled) | **31.3%** |
| — genuine frac=0 subset (n=2,403) | 29.8% |
| — stale-optimistic-bump subset (n=1,298) | 34.1% |
| caution (n=2,623 sampled) | **39.2%** |

**Reading this honestly:**

- The ordinal ranking is sane — caution-status levels are more likely to be reached forward
  (39.2%) than reject-status levels (31.3%). The signal isn't backwards.
- But **31.3% of rejected levels DID get reached within the very next 8 hours**, despite the
  backward-looking 14-night window saying "never/rarely." That's a meaningfully high false-reject
  rate if this were ever gating — nearly 1 in 3 "reject" calls would have been wrong in the very
  next window. Some of this gap is expected and structural (markets drift; a level unreached in
  the past 14 nights can still be reached as price trends toward it — the check is inherently
  backward-looking against a forward question), but 31% is not a small residual.
- The genuine-zero and stale-bump subsets don't differ hugely (29.8% vs 34.1%) — the RC1 bump
  isn't obviously making things worse or better; it's roughly the same forward-hit rate as a
  "real" zero, which is mild evidence the bump isn't miscalibrated relative to the base case (but
  also isn't clearly justified as a SEPARATE, harsher signal either).
- This is a single 8h window, a fixed approximation (some niches — value/amplitude — actually use
  a 24h window; this analysis applied 8h uniformly for simplicity, so value/amplitude rows here
  are approximated, not exact). It also only tests "did price touch the level at all," not
  "would OUR specific order size have filled there" — the same distinction `PLAN-REACH-
  CALIBRATION.md`'s Finding 3 already raised about the underlying average-vs-achievable question.

**Bottom line for 2b: this is real, if rough, evidence that `reach`'s reject line is on the loose
side for a hypothetical gate — not wildly wrong, but a ~31% forward-hit rate among "rejects" is a
nontrivial miss rate if this graduates from inform to gate as-is.**

---

## 3. What the join needs to become a real, repeatable instrument (not a one-off script)

This session's join was a throwaway sample script, not a committed tool. To make this a durable,
re-runnable check (the kind `/analyze`'s F1 pipeline is meant to own):

- **A small pure module**, e.g. `pipeline/lib/reach-outcomes.mjs`: given a `suggestions.jsonl` row
  with a `reach` validator entry (parse the level/side from the ALREADY-LOGGED reason string, or —
  better — log `level`/`side`/`windowHours` as structured fields on the validator entry instead of
  only in prose, a small logging change in `js/validate.mjs`/`suggestlog.mjs` that would make this
  join far less fragile than string-parsing the reason text as this session's script did), query
  `archive.seriesFor(itemId, '1h', {from: ts, to: ts + windowHours*3600})`, and report whether the
  level was crossed forward.
- **Per-niche, per-window-length correctness** (not the uniform-8h approximation used here) —
  value/amplitude's 24h window needs its own pass.
- **Feed the result into `analyze-record.mjs`'s existing candidate framework**
  (`pipeline/lib/analyze.mjs` `deriveCandidates`) as a genuine `kind:'candidate'` (not just
  `kind:'inform'`) once it has enough n, since this is exactly the counterfactual join that
  function's own comment says it's missing.
- **This is a natural F1 chunk**, not a new plan program — it slots directly into the roadmap
  `PLAN-REACH-CALIBRATION.md` already lays out (that plan's AC1 already established the pattern:
  join closed-lot/suggestion data against archived buckets, gate model changes on real evidence).
  A `reach`-graduate-to-gate decision should follow the same AC1-style gate discipline: build the
  join as a committed script, accrue enough forward-elapsed rows per niche, THEN decide — not
  flip the mode first and observe.

---

## 4. Verdict for Ben

- **The audit's headline number (8,118 rejects) does not currently represent lost discovery.**
  `reach` gates nothing in the live registry (99.5% of its rejects are shadow-logged inform
  annotations); this is a deliberate, documented rollout state, not a bug. If the goal was "are we
  dropping real winners because of `reach` today," the honest answer is **no, essentially not** —
  the mechanism to drop rows on `reach` barely exists yet (37 real drops, ever, and those are on a
  non-niche surface).
- **The calibration question is still open, and now has real (if rough) evidence for the first
  time**: a ~31% forward-hit rate among reach-rejected levels suggests the reject threshold, AS
  DEFINED (frac≤0 over 14 nights, plus the RC1 stale bump), would be somewhat loose if ever
  gated — worth knowing before any future decision to flip a niche's `reach` cell from `inform` to
  `gate`.
- **The join that the audit said didn't exist now does**, cheaply, off the archive that's grown
  enough in the week since `PLAN-REACH-CALIBRATION.md` last checked it (189 buckets →
  1.1M rows / 44 days). Building it as a committed, structured tool (§3) rather than
  re-parsing reason strings ad hoc is the concrete next step, and it's small.
- **No urgency to act on the 31% number itself** — since `reach` isn't gating anything live, there
  is no active harm to fix today. The value is in having the instrument ready for whenever a
  `reach: gate` graduation is actually proposed for band/churn, so that decision can be made on
  real forward-hit evidence instead of the historical-window frac alone.
