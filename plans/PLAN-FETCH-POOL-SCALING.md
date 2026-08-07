# PLAN-FETCH-POOL-SCALING — capital-scale the fetch pool, give value a reserve

**Status: ALL FOUR CHUNKS SHIPPED `5e7e9d9` (2026-07-24)** — VALUE_RESERVE default-ON in both
admission paths; the `scaleSlots` capital curve behind the explicit `--scale-pool` flag (default
OFF — byte-identical otherwise, Open Decision 1 resolved opt-in-first); `clampUnionFetch`/
`TOTAL_FETCH_MAX` cross-niche ceiling. Constants all PLACEHOLDER n≈0. *(Header was stale
"PLANNING ONLY" until 2026-08-01 — corrected during EF-0a's doc pass.)* **The `via`+rank
suggestions-ledger logging this plan's evidence depends on — the PLAN.md Discovered
reserve-retirement prerequisite — LANDED 2026-08-01 as EF-0a (PLAN-ESTIMATOR-FIDELITY):** every
screen row now logs `via`/`preRank`/`prePool` and each pass logs its per-niche crowded-out set, so
the reserve-vs-ranked-in comparison and any slice-size tuning can finally read real data. Still
open here: the default-on decision for `--scale-pool` (needs that accrued data) + fold-into-PLAN.md
lifecycle.

**Evidence for the `--scale-pool` default-on decision (2026-08-07, live A/B at 100.75m deployable).**
A paired `--mode all` run, `--top 40` (default) vs `--top 90`, same pass, `--no-publish`:

| | `--top 40` | `--top 90` |
| --- | --- | --- |
| BAND rows rated | 31 | 68 (+37, **none lost**) |
| BAND grades | A-×1 B×8 C×9 D×12 | A-×2 B×11 B-×7 C×17 D×30 |
| CHURN grades | **S+×2** B×2 | **S+×10** B×2 |

The widening is **strictly additive** — every `--top 40` row survived at 90 — and the dominant gain
is **CHURN S+ 2 → 10**, not the band big-tickets the starvation entry predicted. BAND gains a second
A- (Masori chaps) plus three B and a whole B- tier that the default never reaches at all.

**⛔ DECISION EVIDENCE: flipping `--scale-pool` ON BY DEFAULT DOES NOT SOLVE THIS (2026-08-07, measured).**
`CAP_REF = 100_000_000` is the reference bankroll the fixed defaults are treated as tuned against, and
the measured pool was **100.75m — 0.75% above it**. `scaleSlots` is `base·(1 + POOL_SCALE·√(excess/CAP_REF))`,
so at √0.0075 ≈ 0.087 the curve barely engages:

| pool | base | at 100.75m | max | reaches max at |
| --- | --- | --- | --- | --- |
| `TOP` (band/churn) | 40 | **43** | 90 | ~256m capital |
| `THIN_RESERVE` | 6 | **7** | 15 | — |
| `AMP_TOP` | 40 | **43** | 90 | ~256m |

Verified live, `--mode all`, same session: default → **31 band rows**; `--scale-pool` → **33**;
`--top 90` → **68**. So the default-on flip captures **~5% of the available win** (+2 rows vs +37).

**The conclusion is that the BASE is mis-tuned at the reference bankroll, not that scaling is missing.**
At *exactly* the capital the defaults are tuned for, `top 40` leaves 37 gradeable band rows and 8 S+
churn rows unfetched. No capital-conditioning curve fixes a base that is wrong at its own reference
point — the curve is anchored to it.

**Cost of raising the base is small and now measured** (`--mode all`, per-item ts cache cleared before
each run, bulk caches warm, two runs each — after SP1 landed):

| | mean wall | BAND | CHURN |
| --- | --- | --- | --- |
| `--top 40` | 1,605 ms | 32 | 5 |
| `--top 90` | 2,024 ms (**+419 ms, +26%**) | **67 (+109%)** | **13 (+160%)** |

Widening is **strictly additive** (every `--top 40` row survives at 90) and touches no gate, price,
grade or rank — only what gets CONSIDERED. Amplitude is unaffected (its own `AMP_TOP`).

**Open for Ben — three defensible knobs, they differ at OTHER capital levels:** (a) raise the `TOP`
default 40 → 90 (fixes the reference point, leaves the curve for genuinely large bankrolls);
(b) lower `CAP_REF` so the curve engages earlier (keeps one mechanism, but re-anchors what "tuned
against" means); (c) raise `POOL_SCALE` (steeper curve, same anchor). NOT decided here — this is a
behaviour change to every scan Ben reads, not a perf chunk.

**Minor bug found while measuring:** under `--scale-pool` the run header still prints the UNSCALED
`top ${TOP}` (`screen-flip-niches.mjs`'s header line reads the module-level `TOP`, not the scaled
local computed at `:2623`), so the output cannot tell you what pool size actually ran. Fix alongside
whichever knob lands.

**⛔ CORRECTION 2026-08-07 (same day, later): the "anchor does not reproduce" claim below is WRONG.**
It reproduces exactly as recorded — the earlier test used the wrong knob. `--stats` on a `--top 90`
run shows Sanguinesti staff (uncharged) STILL crowded out, as the single highest-value excluded
candidate, with **`reason: thin-reserve-full`** — not `top-n-full`. The binding constraint was never
`TOP`; it is `THIN_RESERVE`'s fixed **6** slots, which is precisely what the PLAN.md entry always said.
Raising `--thin-reserve 15` admits it and it grades **A-**. The reserve is still binding even at its
MAX: the next-best excluded becomes Necklace of anguish (~8.58m/d), also `thin-reserve-full`.

⚠ **But do NOT read "~12.89m/d expected net" as forgone profit.** That is the **Stage-1 PRE-FETCH
proxy** (`expGpDay`), the number that decides fetch priority. Once actually fetched the same row reads
**net +88,162/u (+0.5%), rank 140k, P(ask)~0.36** — orders of magnitude below its own proxy. So the
real finding is worse and more interesting than "we're losing 12.89m/d": **the ranker that decides who
gets fetched is not predictive of what an item scores once fetched.** This is MT1's documented
two-different-numbers-against-one-constant hazard, now measured on the top excluded row. Fixing
`THIN_RESERVE` without fixing the proxy just re-orders a queue sorted by the wrong key.

⚠ **The paragraph below (kept for the record) is superseded by the correction above.** PLAN.md's Discovered entry names Sanguinesti staff
(uncharged), Basilisk jaw and Webweaver bow as the items `--top 40` buried at a 162m trial. In this
run **none of the three appears in EITHER pool** — Sanguinesti staff left the board on its own
degraded numbers between two consecutive default scans, not on admission. So the *mechanism* (a fixed
top-N starves candidates a larger bankroll could deploy into) is confirmed, but the *starved
population* is mis-recorded: it is predominantly churn-class commodities, not thin big-tickets.
Anyone tuning `THIN_RESERVE` off that anchor would be tuning the wrong reserve. n=1 paired run,
one capital level — enough to correct the anchor, NOT enough to flip the default (rule 4). Originally scoped from blindspot-audit findings **#1** and **#7**
(`PLAN-BLINDSPOT-AUDIT.md`): the scan's fetch pool is sized by FIXED constants
(`pipeline/lib/gatecandidates.mjs` `TOP_DEFAULT=40`, `THIN_RESERVE_DEFAULT=6`,
`VALUE_TOP_DEFAULT=25`, `AMP_TOP_DEFAULT=40`), independent of how much capital there actually is
to deploy — so on a big-bankroll night a real winner can rank outside the slice and never get
fetched, and the value niche has **no reserve mechanism at all** (band/churn at least get
`THIN_RESERVE`). Read `docs/MARKET-ANALYSIS.md` and `PLAN-BLINDSPOT-AUDIT.md` §1 findings #1/#7
first if this is your first pass at the fetch-pool code.

---

## 1. Problem statement, quantified

### 1.1 What "fetch pool" means here, precisely

Each mode (band/churn/scalp/value/amplitude) runs a two-stage funnel every scan:

1. **Gate** (`gateCandidates` in `gatecandidates.mjs`) — cheap, bulk-data-only (the `/latest` +
   `/24h`-or-rolling map + the bulk 6h daily archive already fetched once for the whole scan).
   Every item in the OSRS item map that clears liquidity/price-window/edge math becomes a
   "candidate." This is NOT the expensive part — it's one bulk array scan.
2. **Admit → fetch** (`pickFetchPool` in `admission.mjs`, or legacy `rankAndSlice` in
   `gatecandidates.mjs` under `--admission legacy`) — ranks the gated candidate pool and takes
   the top-N (`TOP`/`THIN_RESERVE`/`VALUE_TOP_DEFAULT`/`AMP_TOP_DEFAULT`) into the **fetch pool**.
   Only fetch-pool survivors get the expensive per-item network calls: `screen-flip-niches.mjs`
   fetches 3 independent series per survivor (`5m`, `6h`, `1h` — see line ~2136-2143), at
   `FETCH_CONCURRENCY = 5` in flight at once (line 2125). A candidate that doesn't make the
   fetch pool is dropped **before any pricing/gate math that would actually judge it runs** —
   the gate stack's own liquidity/edge check never sees it a second time; there is no
   post-fetch recovery path.

### 1.2 The real fetch-budget constraint

- **Cost unit**: 3 wiki-API series calls per fetch-pool survivor (5m/6h/1h), pooled at
  concurrency 5. Wall-clock cost is therefore roughly `ceil(survivors / 5) × (latency per
  batch)`. This session's live band run: `TOP=40` candidates + `THIN_RESERVE=6` → up to 46
  fetch slots for band alone; `--mode all` unions survivors *across* band/churn/amplitude
  before fetching (line 2127: `ids = new Set()` collects the union), so shared items are
  fetched once, but each niche still independently caps its own contribution to that union.
- **Live evidence (this session, quoted in the audit doc)**: band admitted 134 gated
  candidates, fetched only the top-40-plus-6-thin-reserve slice, **dropped 93** pre-fetch —
  best excluded was Crimson kisten at ~13.84m/d expected net (bigger than most of the 24 shown
  items), reason `thin-reserve-full`. Value admitted 129, fetched top-25, **dropped 104** with
  no reserve at all.
- **Why "just fetch everything" is out of scope**: gated-candidate counts (129–134 this
  session) are not the worst case — a cold/wide price window or a slack liquidity floor can
  gate hundreds of items. Fetching every gated candidate would multiply wiki-API call volume
  by 3-5x on an ordinary pass and turn a ~10-20s scan into a multi-minute one, with no bound
  on worst case. The wiki API is shared/rate-limited infrastructure `screen-flip-niches.mjs`
  already throttles deliberately (`FETCH_CONCURRENCY = 5`, comment: "keep modest; the wiki API
  sees ≤15 concurrent requests" across the whole process). Any scaling design must keep a
  **hard ceiling** on total fetch-pool size regardless of how large the gated pool or the
  capital figure gets.

### 1.3 What "capital-scaling" should mean

Ben's own 2026-07-23 framing (`PLAN.md` Discovered list) was "make `thinReserve`/`top` scale
with `--capital` instead of a fixed constant, so a high-bankroll pass doesn't need a manual
`--top 90`." The intuition: more deployable capital means more positions could plausibly be
opened this pass, so the fetch pool should widen enough to give more candidates a chance to be
judged — but capital growth must map to a **sub-linear, capped** slot increase, not a 1:1 one
(bankroll can be 10-100x larger than the 40-slot default's implicit "typical" capital, and
fetch cost must not scale 10-100x with it).

---

## 2. The scaling model

### 2.1 Reuse the existing capital read — no new derivation

`screen-flip-niches.mjs` already derives a capital figure every run it needs one
(`VALUE_CAPITAL` / `DERIVED_CASH.deployablePool`, lines ~180-182 and re-derived with a
market-ref at ~2056-2075) via `loadDerivedCash` (`pipeline/lib/derive-cash-tiers.mjs`), the
SAME three-tier model `run-loop.mjs`'s `--min-idle` scan gate and `/book` already read
(`deployablePool = availableCash + Σ escrow of DEEP resting bids` — the "money that could
plausibly get deployed on new positions this pass" tier, deliberately looser than
`availableCash` but tighter than `liquidCapital`). **This plan proposes zero new capital
plumbing** — band/churn/scalp fetch-pool sizing should key off the SAME `VALUE_CAPITAL` figure
already computed (or an explicit `--capital` override, already supported), not a second
capital read. This also means the scaling is free to compute — the number is already in hand
by the time `TOP`/`THIN_RESERVE` are read (today they're read at CLI-parse time, before
`DERIVED_CASH` is available; see Open Decision 5.1 below for the sequencing implication).

### 2.2 The slot formula (curve shape, not exact numbers — placeholder per rule 4)

A **sub-linear, capped** scaling function on top of today's fixed default, so:
- at "reference" capital (the level the current defaults were implicitly tuned against — call
  it `CAP_REF`, itself a placeholder), the formula reproduces **today's exact constant**
  (zero-ripple at the current typical bankroll);
- growth beyond `CAP_REF` adds slots slower than linearly (e.g. `sqrt` or `log` scaling) so a
  10x bankroll does NOT imply a 10x fetch bill;
- a **hard ceiling** (`*_MAX`) caps the slot count regardless of capital, keeping the worst-case
  fetch bill bounded and predictable.

Sketch (illustrative shape only — exact constants are Open Decisions, §4):

```
slots(capital) = clamp(
  BASE + SCALE * sqrt(max(0, capital - CAP_REF) / CAP_REF),
  BASE,
  MAX
)
```

Applied per pool:
- `TOP`: `BASE = TOP_DEFAULT (40)`, some `MAX` (e.g. 80-100, matching the manual `--top 90`
  workaround Ben already resorted to for Sanguinesti staff/Basilisk jaw/Webweaver bow).
- `THIN_RESERVE`: `BASE = THIN_RESERVE_DEFAULT (6)`, smaller `MAX` (e.g. 12-15) — this lane
  exists specifically to keep big-tickets from crowding the velocity lane, so it should widen
  more conservatively than TOP.
- `VALUE_TOP_DEFAULT`: `BASE = 25`, needs its own reserve mechanic first (§2.3) before scaling
  makes sense on top of it.
- `AMP_TOP_DEFAULT`: `BASE = 40` — already widened once (F-D, 25→40) specifically for this
  false-negative class; capital-scaling is the generalization of that ad hoc widen.

At `capital == CAP_REF` (or when `deployablePool` is unknown/null — no cash anchor stated),
every formula must degrade to exactly today's constant, so:
- a session with no stated cash anchor (`DERIVED_CASH.known === false`) is **byte-identical**
  to current behavior (this is already the common case for a fresh/never-anchored session —
  `VALUE_CAPITAL` currently falls back to a `100_000_000` default in that case; the scaling
  formula should treat that same fallback as `CAP_REF` so it's a no-op, not a silent slot
  change tied to an arbitrary default).
- an explicit `--top`/`--thin-reserve`/CLI override always wins outright (today's behavior,
  unchanged) — capital-scaling only replaces the *default*, never overrides an explicit flag.

### 2.3 The value reserve mechanic (finding #7)

Value currently has zero reserve: `pickFetchPool`'s `isValue` branch
(`admission.mjs` lines 107-111) and legacy `rankAndSlice`'s value branch (`gatecandidates.mjs`
lines 339-341) both do a flat `sort by valueScore, slice(0, top)` — no analog to
`THIN_RESERVE`/`RISING_RESERVE`/the amplitude niche's `watchReserve`. The minimal fix (named in
the audit doc §2 as available "at near-zero design cost, before the fuller capital-aware
version lands"):

- Add a **`VALUE_RESERVE`** slot count (mirrors `THIN_RESERVE`'s shape), carved out of the
  value fetch pool for candidates that rank **outside** the top-N by `valueScore` but score
  highly on a secondary signal already computed at gate time and currently unused for ranking:
  `termStructure`'s cycle-amplitude read (`js/termstructure.mjs`, already computed per
  candidate in `gateValueCandidates` to build `valueRanges`/`valueScore` itself) — e.g. rank
  the excluded remainder by raw cycle-amplitude-% (not the same composite `valueScore`, which
  already folds in capital/liquidity weighting that may be exactly what's burying a legitimate
  big-ticket with a strong cycle but low `limitVol`).
- This mirrors the `THIN_RESERVE`/`RISING_RESERVE`/`watchReserve` **precedent already three
  times over** in this codebase (band/churn's thin+rising reserves, amplitude's watchlist
  reserve) — same shape: rank the excluded remainder by a DIFFERENT key than the primary cut,
  take a small bounded slice, prepend it (never reshuffle the top-N itself).
- `VALUE_RESERVE` should ALSO capital-scale per §2.2's formula, once §2.2 lands — but ships
  independently first as a small fixed reserve (the audit doc's own recommended sequencing),
  since it closes the "zero mitigation" gap at near-zero cost without waiting on the capital
  formula's harder design questions.

### 2.4 The fetch-budget ceiling that keeps this bounded

Two independent caps, both mandatory regardless of the scaling curve chosen:

1. **Per-pool `MAX`** (§2.2) bounds each niche's own contribution.
2. **A total-scan ceiling** — since `--mode all` unions survivors across niches before
   fetching (dedup on shared items, but NOT a shared budget today), a capital-scaled band +
   capital-scaled churn + capital-scaled amplitude could each independently grow toward their
   own `MAX` on the same high-capital night, and the union could grow well past what any single
   niche's `MAX` implies. This plan recommends an explicit **`TOTAL_FETCH_MAX`** the union is
   clamped to post-computation (log a warning + which niche(s) got trimmed, never silently) —
   this is a NEW mechanic, not present in any form today, and is the one piece of this plan
   without a direct precedent elsewhere in the codebase. Needs its own trim-order judgment call
   (Open Decision 4.4).

---

## 3. Staged chunks, ranked by leverage

Ordered so each chunk ships independently, is fixture-testable where pure, and — critically —
**produces byte-identical output at today's defaults** (no `--capital` override, no cash
anchor stated, or capital == `CAP_REF`) so this is a strict opt-in/no-ripple change until Ben
turns the scaling on.

### Chunk 1 (highest leverage, lowest risk) — `VALUE_RESERVE`
Add the value-niche reserve mechanic (§2.3) as a **small fixed reserve** first (no capital
scaling yet — mirrors `THIN_RESERVE_DEFAULT`'s shape: a plain constant, e.g. `VALUE_RESERVE_DEFAULT
= 6`). Touches `gatecandidates.mjs` (legacy `rankAndSlice`'s value branch) AND `admission.mjs`
(`pickFetchPool`'s `isValue` branch — both need it, since `ADMISSION` defaults to `unified`).
**Acceptance**: fixture test with a synthetic gated pool where a candidate outside top-25 by
`valueScore` has the highest cycle-amplitude of the excluded remainder — assert it appears in
the returned survivor set, tagged distinguishably (mirrors `via:'explore'`'s tagging pattern in
`admission.mjs`, e.g. `via:'reserve'`) so a renderer/log can tell a reserve-slotted row from a
ranked-in one. Existing golden fixtures for band/churn/amplitude must stay byte-identical (this
chunk only touches the value branch). Zero ripple: `VALUE_RESERVE_DEFAULT` adds slots, it
doesn't remove any — the existing top-25 survivors are untouched, this only appends.
**Why first**: closes finding #7 (the "zero mitigation" gap) completely on its own, at the
lowest design risk of the whole plan — no capital-derivation sequencing question, no new
ceiling mechanic, straight reuse of an existing three-times-precedented pattern.

### Chunk 2 — the capital-scaling formula, band/churn/scalp only
Implement §2.2's curve for `TOP`/`THIN_RESERVE` (the shared band-gate niches). Requires
resolving the CLI sequencing gap (§4, Open Decision 5.1): `TOP`/`THIN_RESERVE` are read from
`A.top`/`A['thin-reserve']` at parse time (line 155, 233), but `DERIVED_CASH`/`VALUE_CAPITAL`
isn't reliably available until later in `main()` (line ~2056-2075, itself gated on which modes
are running). The scaling call needs to move to (or be re-evaluated at) the point after capital
is derived, mirroring how `THRESHOLDS.THROUGHPUT_CAP_GP` is already patched in-place post-derive
(line 2080) rather than read once at parse time. **Acceptance**: pure fixture test of the
scaling function itself (`slots(capital) -> count`) independent of any live fetch — the
formula is exported as a standalone pure function so unit fixtures can pin the curve exactly
(zero-ripple point, `CAP_REF` boundary, `MAX` ceiling) without a live scan. A live-run
acceptance check: `--capital <CAP_REF-equivalent>` (or no cash anchor stated) produces
byte-identical `screen.json`/stdout to today's fixed-default run; a synthetic higher `--capital`
demonstrably widens `TOP` and surfaces a previously-buried candidate (the Sanguinesti
staff/Basilisk jaw/Webweaver bow anchor case from `PLAN.md`'s Discovered list is the natural
regression check — confirm they surface at the scaled `--capital` without needing a manual
`--top 90`).

### Chunk 3 — extend capital-scaling to `VALUE_TOP_DEFAULT` + `VALUE_RESERVE`, `AMP_TOP_DEFAULT`
Apply the same formula (§2.2) to value's and amplitude's own top-N + Chunk 1's new reserve.
**Acceptance**: same shape as Chunk 2 — pure fixture on the formula, byte-identical at
`CAP_REF`, live regression against a named previously-buried amplitude/value candidate if one
can be identified (else: synthetic-only, honestly labeled as such).

### Chunk 4 — `TOTAL_FETCH_MAX` cross-niche ceiling
Only needed once Chunks 2+3 mean multiple niches can each independently widen on the same
`--mode all` pass. Implements §2.4's total-scan cap with a trim-and-log behavior (Open Decision
4.4 decides trim order). **Acceptance**: fixture where band+churn+amplitude's individually-
capital-scaled `TOP`s would sum past `TOTAL_FETCH_MAX` in the union — assert the union is
clamped and the console log names which niche(s)/candidates were trimmed and why (never a
silent drop — mirrors the existing `excluded`-with-`reason` contract `pickFetchPool` already
guarantees per-niche, extended to the cross-niche level).

**Sequencing note**: Chunk 1 stands alone and should ship regardless of whether Chunks 2-4 are
adopted — it's the cheapest, most isolated fix for the worse of the two audit findings (#7 has
literally zero mitigation today; #1's `TOP=40`/`THIN_RESERVE=6` at least admit SOME big
tickets). Chunks 2-4 are a single connected unit — shipping 2 without 4 leaves the
cross-niche ceiling gap open on `--mode all` capital-scaled runs, so 4 should not be skipped
if 2/3 ship live (default-off/opt-in during development is fine; the ceiling must exist before
default-on).

---

## 4. Open decisions for Ben

1. **Opt-in first, or default-on immediately?** Given the "capital → more slots" formula is
   n≈0 judgment (no calibration data on what slot count actually correlates with catching real
   winners vs. wasted fetches), this plan leans toward landing Chunks 2-4 behind an explicit
   flag (e.g. `--scale-pool` or auto-on only when `--capital` is explicitly passed) for a
   trial period, with `--admission unified` (today's default) staying byte-identical until
   opted in — mirroring how `--asym`/`--pressure-exit`/`--phase-rescue` all shipped gated
   before graduating. Chunk 1 (`VALUE_RESERVE`) is small enough it could default-on immediately
   (it only adds slots, never removes) — Ben's call on how cautious to be there specifically.
2. **The exact curve** (`sqrt`, `log`, or a stepped lookup table) and its constants
   (`CAP_REF`, `SCALE`, per-pool `MAX`) are unset placeholders (§2.2) — this plan does not
   presume a number. A "what capital level did the current 40/6/25/40 defaults implicitly get
   tuned against" question doesn't really have an answer (they were picked structurally, not
   capital-calibrated) — so `CAP_REF` is itself a judgment call, not a derivable constant.
3. **`TOTAL_FETCH_MAX`'s value and trim order** (§2.4) — if the cross-niche union has to be
   trimmed, which niche gives up slots first? Options: proportional trim across all niches,
   trim the niche(s) that grew the most from their base, or a fixed priority order (e.g.
   protect `held`/`watched` reserves everywhere, then value's reserve, then trim TOP-lane
   slots last-added-first). No strong signal either way from the codebase — the closest
   precedent (amplitude's watchlist reserve, band/churn's held reserve) is always "unbounded,
   protect the named/held set first," which argues for protecting reserves over TOP-lane slots
   when a trim is needed, but that's this plan's inference, not a decision Ben has made.
4. **Does the value-reserve secondary signal (§2.3, cycle-amplitude-%) need its own gate**, or
   is "rank the excluded remainder by it and take the top few" enough? A pure ranking with no
   floor could surface a genuinely weak/noisy candidate just because it's the "best of the
   worst" — band/churn's `THIN_RESERVE` has this same shape today (ranked by raw gp-flow, no
   independent floor) and it works because the post-fetch gate (`surviveMode`) still judges the
   fetched candidate for real; value's reserve would get the same protection (still has to
   clear `valueGate`'s term-structure knife guard post-fetch), so this plan assumes no
   additional floor is needed, but flags it as worth Ben's explicit sign-off given #7's
   "no mitigation" starting point makes it tempting to overcorrect.
5. **CLI/derivation sequencing** (Chunk 2's blocker) — today `TOP`/`THIN_RESERVE` are simple
   module-level `const`s read once at parse time; `DERIVED_CASH` isn't settled until partway
   through `main()`, and only reliably for modes that actually need it (value/amplitude
   trigger the re-derive at line 2063; band/churn alone currently do NOT re-derive with a
   market-ref, they'd fall back to the pre-derive `VALUE_CAPITAL_DERIVED` estimate from line
   180-182). Making band/churn's fetch-pool sizing capital-aware means either (a) always
   re-deriving cash early regardless of mode (a small always-on cost: one `loadDerivedCash`
   call plus, if a market-ref is wanted, walking `offers.json` — both already cheap/local, no
   network beyond what's already fetched), or (b) accepting a less-precise pre-market-ref
   capital figure for band/churn's own scaling. This plan assumes (a) — always deriving cash
   early — but that's an implementation-simplicity judgment call worth Ben confirming rather
   than silently deciding.

---

## 5. What this plan deliberately does NOT propose

- **No unbounded/"fetch everything" pool** — every chunk keeps a hard per-niche `MAX` plus
  (from Chunk 4) a cross-niche ceiling. Capital scaling widens the pool, it never removes the
  cap.
- **No change to the post-fetch gate/grade/rank stack** (`surviveMode`, `valueGate`,
  `amplitudeGate`, rating/grading) — this plan is entirely about which candidates get a chance
  to reach that stack, not what happens once they do. A wider fetch pool means more candidates
  get judged; it does not loosen how they're judged.
- **No touch to the exploration-reserve mechanic** (`admission.mjs`'s `pickExploration`/
  `EXPLORE_RESERVE_DEFAULT`) — that's a different false-negative mitigation (rotating
  starvation-proofing within a fixed-size pool) already shipped and orthogonal to pool SIZE.

---

## 6. Ambiguities found in the existing code (flagged, not resolved)

- **`ADMISSION` has two live code paths** (`legacy` `rankAndSlice` vs default `unified`
  `pickFetchPool`) that both implement the value/amplitude branches independently
  (`gatecandidates.mjs` lines 339-356 vs `admission.mjs` lines 107-130) — Chunk 1's
  `VALUE_RESERVE` has to be added in BOTH places to not silently vanish under
  `--admission legacy`. Every future chunk touching a niche's admission logic has this same
  double-maintenance shape until/unless the two paths are unified (out of scope for this plan
  — noted as a maintenance cost this plan inherits, not something it proposes fixing).
- **Band/churn's pre-market-ref capital estimate** (line 180-182, used before the line-2063
  re-derive) is a strictly cruder number than what value/amplitude get — Open Decision 5
  above is really asking whether that gap should be closed as part of this work or left as a
  known imprecision band/churn's capital-scaled slots would inherit.
