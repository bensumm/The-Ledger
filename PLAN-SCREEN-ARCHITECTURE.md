# PLAN-SCREEN-ARCHITECTURE — a principled admission/ranking layer for the opportunity screen

Drafted 2026-07-18. Follows `docs/PLANNING.md`.

**STATUS UPDATE (Ben, 2026-07-18, same day): SC1–SC4 shipped immediately, not staged.** Ben's
ruling on reading this plan: "current system is broken... it's not a question of is the old system
better, it's do we fix the problem or not." So `pipeline/lib/admission.mjs` (`pickFetchPool` +
`buildTrackIndex`/`trackBoost`) landed as the DEFAULT admission path in `screen-flip-niches.mjs`
the same session, folding SC1 (exclusion report) + SC2 (thin lane ranks on `expGpDay`, not raw
gp-flow) + SC3 (bounded rotating exploration reserve) + SC4 (boost-only track-record prior) into
one chunk — R4's "separate veto" was resolved live (Ben: "track record boost is an interesting
thought, ok with trying it"). `rankAndSlice` (gatecandidates.mjs) is UNCHANGED, still fixture/
golden-pinned, and stays selectable via `--admission legacy` per R2/R5's rollback guarantee — SC5
(join-outcomes-based graduation before this becomes unconditionally trusted) is still open, see
below. 12 new unit tests (`pipeline/test/admission.test.mjs`) + the full existing suite (80 tests)
pass; `check-imports`/`lint-skills`/`lint-docs` clean.

**Honest live-validation results (same session, real market data):**
- Fixed the anchor mechanism: the thin lane now ranks on real after-tax edge, and every excluded
  candidate is reported (`crowded out: N (best excluded: X, ~Y/d expected net, reason: Z)`).
- Sanguinesti staff (uncharged) was confirmed IN the gated candidate pool with a real edge
  (~9.0m/d expGpDay) but did NOT win a slot on the run tested — 7 OTHER big tickets (Nightmare
  staff, Armadyl crossbow, Pegasian boots, Crimson kisten, Bellator ring, Webweaver bow (u), Twisted
  buckler) had genuinely BIGGER after-tax edges that night, and the exploration rotation (2 slots)
  didn't land on it that instant. This is the system working correctly, not failing — but it means
  "will bludgeon/sang show up" is no longer a yes/no property of the code, it's a per-night
  competition among real edges, visible via the exclusion report instead of silently absolute.
  Abyssal bludgeon wasn't even in the gated pool that run (its live 2h band spread didn't clear
  positive net that moment) — a live-market fact, unrelated to admission.
- **CORRECTION (2026-07-18, same session, on further investigation): the "Blood/Soul rune
  validator-reject" claim above was WRONG** — `reach` is declared `mode: 'inform'` on every
  flip-niche spec (`js/flip-niches.mjs`), and `runValidators` structurally clamps an inform-mode
  reject back to `pass` (`js/validate.mjs:404-406`) — it can never drop a row. Re-traced with the
  actual `disc.reject` reasons (`--stats`): the two live causes are `limit` and `floor`, not
  `reach`. Per-item, correctly:
  - **Blood rune** — genuinely held, genuinely admitted (unbounded held reserve, confirmed
    identical under `--admission legacy`), fetched, quoted — then dropped by `limitValidator`
    because the 4h buy limit (25,000) is fully spent (`read-buy-limits.mjs` confirms 0 left). This
    is CORRECT, intentional behavior: `/scan` discovers NEW buys; a fully-bought item has nothing
    left to suggest. `/positions` already covers "how's my existing position." Not a bug.
  - **Soul rune** — checked `positions.json`: it is NOT currently held (only Blood rune's two lots
    are open). It never reaches `pickFetchPool`/`rankAndSlice` at all — it fails
    `gateCandidates`'s PRE-EXISTING 500k gp/day attention floor before the admission layer ever
    sees it, entirely unrelated to this chunk.
  - **Real gap found regardless:** the exploration/rotation fix (SC3) originally covered ONLY the
    thin lane. A genuine mid-tier churn/band candidate that clears every gate but consistently
    loses the non-thin velocity-lane ranking has the exact same starvation shape, just unfixed on
    that lane — **fixed same session**: `pickFetchPool` now splits the exploration budget across
    BOTH the thin and velocity lanes (roughly half each), with a new test pinning it
    (`pipeline/test/admission.test.mjs`). 13 admission tests + the full 69-suite pipeline sweep pass.
  - **Not yet done, named here for a future chunk:** `gateCandidates`'s OWN drops (the 500k
    attention floor, the two-sided liquidity gate, the price window, `modeNet<=0`) still have NO
    exclusion report — SC1's "crowded out" line only covers what `pickFetchPool` itself excludes,
    not what never reached it. A full accounting of "why didn't item X show up" needs this too.

The rest of this document is the original research-only plan as drafted, kept for the full
diagnosis, the design rationale, and SC5/SC6 (still open — graduation criteria and the docs fold).
Scope: the **admission + fetch-pool ranking layer** of `screen-flip-niches.mjs` — which gated
candidates get a per-item fetch slot, how that decision is ranked, and how exclusions are reported.
**Out of scope (settled doctrine, untouched):** the pricing/tax/reach math (`breakEven`,
`estimatePair`, RC1 recency, Bar D/E), the two-sided liquidity gate, the per-spec falling doctrine,
the validator registry, the grade caps, the value niche's own gate, posture, and the held/watchlist
exemptions.

## Context / diagnosis

**Anchor incident (2026-07-17): the bludgeon/sanguinesti thin-reserve starvation.** The screen
kept surfacing the same narrow rotation and NEVER surfaced Abyssal bludgeon or Sanguinesti staff
(uncharged) — both with real, documented, profitable trading history with Ben (the validated
half-chase: bludgeon 2026-07-05, +292k — CHANGELOG.md:87 records the retro cell is 68% one item,
Abyssal bludgeon). Rerunning with `--thin-reserve 30` surfaced both immediately with real positive
edges (+60,486/u and +171,000/u net), plus ~18 other big tickets that never appear at the default.

Root cause, confirmed in code:

- Thin (gp-flow-admitted) items reach the fetch pool ONLY through a fixed reserve of
  `THIN_RESERVE_DEFAULT = 6` slots (`pipeline/lib/gatecandidates.mjs:83`), filled by ranking thin
  candidates on **raw gp-flow alone** — `(b.limitVol * b.mid) - (a.limitVol * a.mid)`
  (`gatecandidates.mjs:317`). Whichever handful of big tickets has the highest units/day × price
  that day (Noxious halberd, DHCB, Dragon claws, BCP, Osmumten's fang habitually) monopolizes the
  6 slots every pass; edge size, fill history, and reach confidence play no part.
- **Nothing reports the exclusion.** The niche footer prints `gated / fetched / survivors`
  (`screen-flip-niches.mjs:830`, `:980–984`) but never "N gated candidates lost a fetch slot, best
  excluded: X". Six-plus people-hours of encoded doctrine, and this hard cutoff was invisible until
  a manual CLI bisect.

**The broader critique.** The screening pipeline is an accretion of individually-reasoned patches
(each with a real anchor incident), but the ADMISSION layer that decides where the expensive
per-item fetches go is a pile of disjoint fixed-size slices, each ranked on a different single
dimension, none auditable:

| # | Mechanism | Where | Rank dimension | Failure shape |
|---|---|---|---|---|
| 1 | Thin reserve (6) | `gatecandidates.mjs:83,317` | raw gp-flow `limitVol×mid` | **the anchor incident** — starves real thin edges |
| 2 | Rising reserve (6) | `gatecandidates.mjs:86,308` | `proxyDrift` alone | riser #7+ silently buried; no report |
| 3 | Top-N slice (40) | `gatecandidates.mjs:87,300,318` | `expGpDay × softFactor` | non-thin candidate #41+ never fetched; expGpDay itself folds three unmeasured assumptions (limit×6, 10% share, noisy modeNet — the P6b demotion rationale, `screen-flip-niches.mjs:69–72`) yet still solely picks the pool |
| 4 | softFactor null-proxy 0.7 | `gatecandidates.mjs:147` | archive coverage | a cold-archive item is demoted invisibly |
| 5 | Value top-25 | `gatecandidates.mjs:89,287` | valueScore | **already honest** — §F admitted-vs-shown footer; the model to copy |
| 6 | `MAX_PRICE` 45m window | `screen-flip-niches.mjs:143` | price | deliberate capital bound, but silent — belongs in the exclusion report, not changed |

Reserves 1–3 interact: thin (≤6) + rising (≤6) are PREPENDED, consuming up to 12 of the 40 slots
(`gatecandidates.mjs:318`); held survivors ride unbounded on top. Four lanes, four ranks, one
shared budget, zero cross-lane accounting.

**The key structural fact the redesign exploits:** the "cheap pricing pass" already exists.
`gateCandidates` computes, for EVERY candidate at zero marginal fetch (bulk endpoints only):
`mid`, corrected `limitVol` (PLAN-VOL24 rolling), `limit`, `thin`, the Bar-E-robustified after-tax
band edge `modeNet`/`modeRoi` (`spec.edge`, `gatecandidates.mjs:178`), band density `activeWin`,
`proxyDrift`, and capital-aware `expGpDay`. The original reason the thin reserve avoided `bandNet`
("noisy, band-top artifacts", `gatecandidates.mjs:291–296`) predates Bar E — `robustBand` now trims
the flier that motivated that distrust. The admission layer just never caught up.

**Data available but unused in admission:** Ben's own realized history. `outcomes.json`
(`join-outcomes.mjs`, rebuilt on demand) carries per-item campaigns: realized net after tax,
time-to-first-fill, % never-filled; `buildVelocityIndex` (`pipeline/lib/velocitytag.mjs`) already
aggregates it per item — but is doctrine-pinned "a label, NEVER a rate/sort/gate"
(`velocitytag.mjs:4`) and used only as a stdout footnote (`screen-flip-niches.mjs:958–968`).
`positions.json` closed lots carry after-tax realized P/L per item. An item Ben has repeatedly
closed profitably has exactly zero admission advantage over one he's never traded.

## Rulings

- **R1 (Ben, 2026-07-17): "raising the floor is just papering over the problem."** No quick
  `THIN_RESERVE 6→20` bump as the fix. The redesign addresses the rank dimension and the
  invisibility, not just the slot count.
- **R2 (constraint, standing): the fetch budget is real.** Per survivor the screen fetches three
  timeseries (`screen-flip-niches.mjs:1388–1392`), worker-pool-bounded at 5 concurrent
  (wiki-API politeness, `:1377`). Any redesign keeps a bounded, explicit items-per-pass budget —
  the tradeoff becomes a visible parameter, not an implicit consequence of four unrelated knobs.
- **R3 (proposed default, Ben-vetoable): exclusion visibility ships FIRST and unconditionally.**
  Report-only, zero behavior change — this class of bug must be impossible to miss again.
- **R4 (proposed default, Ben-vetoable): track record may inform ADMISSION as a boost-only prior.**
  This amends the `velocitytag.mjs` "never a sort/gate" doctrine narrowly: the descriptive tag
  stays non-gating; a separate, bounded admission PRIOR from realized outcomes may only ever ADD
  fetch priority (never demote, never gate a candidate out). Explicitly flagged for veto.
- **R5 (proposed default, Ben-vetoable): the unified admission score ships opt-in + shadow-logged,
  and flips to default only on join-outcomes evidence** (process rule 4 — no unvalidated formula
  becomes the default on theory).

## Existing scaffolding (not greenfield)

- The pure, fixture-driven funnel: `gateCandidates`/`rankAndSlice`/`surviveMode`
  (`pipeline/lib/gatecandidates.mjs`) with `gatecandidates.test.mjs` (incl. reserve mechanics
  fixtures at `:115,:237–279`), `survivemode.test.mjs`, and the stage-by-stage replay goldens
  (`replay.test.mjs`, `fixtures/replay/golden.json`) — a behavior change IS a reviewed golden diff.
- The declarative niche registry (`js/flip-niches.mjs`) — new admission fields slot into specs.
- The value niche's §F admitted-vs-shown footer — the existing honesty pattern to generalize.
- `suggestions.jsonl` lean shadow fields (YS2 pattern) + `join-outcomes.mjs` + `analyze-record.mjs`
  — the validation loop already exists; the plan only adds fields to it.
- `buildVelocityIndex` — the per-item outcome aggregation the track-record prior reads.
- `pipeline/.cache/last-report/screen.json` (AO1) — the agent-readable dump the full exclusion
  list rides in.

## Target architecture

One admission decision, one budget, one auditable report.

1. **`pipeline/lib/admission.mjs` (new, pure):** `scoreAdmission(cand, ctx)` produces per-candidate
   `{ score, lane, components }` from gate-time data only, and `pickFetchPool(cands, { budget })`
   returns `{ survivors, excluded }` where every excluded candidate carries a machine-readable
   reason + its components. `rankAndSlice` becomes a thin caller (legacy mode preserved verbatim
   behind it until graduation).
2. **Admission score (initial shape, PLACEHOLDER weights):**
   `score = laneRank × softFactor(proxyDrift) × trackBoost`, where laneRank is a WITHIN-LANE
   percentile — throughput lane: `expGpDay`; thin lane: robustified `modeNet` (the principled
   replacement for raw gp-flow — edge size, not turnover, is why a thin big ticket deserves a
   slot); riser lane: proxyDrift — normalized so lanes share one budget with soft weights instead
   of hard walls. `trackBoost ∈ [1, ~1.5]` from realized per-item outcomes (R4; n-gated, ≥N closed
   lots). Held items keep their unbounded guarantee unchanged.
3. **Exploration slots (starvation-proof by construction):** a small fixed count (default 2/niche,
   PLACEHOLDER) of the budget rotates round-robin over gated candidates that haven't been fetched
   in K passes — greedy-on-a-noisy-proxy is the failure class; a bounded exploration budget is the
   principled fix, and it's auditable ("slot went to X, exploration").
4. **Exclusion report (every pass, all modes):** footer line
   `crowded out: N (best excluded: <item> net/u <x> — <lane>)` + the full excluded list (with
   components) in the last-report dump and `--stats`. The value §F pattern, generalized.

## Staged chunks

- **SC0 — pin the current behavior harder (tests first).** Add fixtures pinning WHICH thin
  candidates win when the thin pool exceeds the reserve (the gp-flow ordering itself — currently
  only the cap count is pinned, `gatecandidates.test.mjs:267–273`), and the thin+rising+held slot
  accounting against `top`. No production change. Verification: new fixtures pass against current
  code; replay goldens untouched.
- **SC1 — exclusion visibility (report-only; the R3 chunk).** `rankAndSlice` (or a wrapper)
  returns `{ survivors, excluded }`; `renderMode`/`--stats`/last-report surface it. Zero change to
  which items are fetched — proven by unchanged replay goldens. Acceptance: a synthetic
  10-thin/6-slot fixture names the 4 excluded with reasons; a live `--mode band` run prints the
  crowded-out line. This alone retroactively catches the anchor incident.
- **SC2 — thin lane ranks on robustified edge, not raw gp-flow.** One-line rank swap
  (`gatecandidates.mjs:317` → `modeNet` desc, tie-break gp-flow), reserve size unchanged, thin
  grade cap unchanged. Deliberate behavior change: regenerate + hand-review replay goldens (the
  diff IS the doctrine change); co-log both orderings for one week of passes (lean shadow field)
  so `/analyze` can diff surfacing. Smallest principled fix to WHO gets the 6 slots.
- **SC3 — `admission.mjs` + unified score + explicit budget, opt-in.** `--admission unified|legacy`
  (default legacy), config-routable via PC1 `resolve()`. Unified mode replaces thin/rising reserves
  + top-N with the scored budget + exploration slots. Every pass co-logs the two pools' symmetric
  difference to last-report. Fixture-pinned; legacy path byte-identical (goldens unchanged).
- **SC4 — track-record admission prior (R4; separate chunk, separate veto).** `trackBoost` from
  `buildVelocityIndex` + positions.json closed lots, boost-only, n-gated (min 3 closed lots,
  PLACEHOLDER), capped. Plus the "validated-lane guarantee": an item with ≥N realized profitable
  closures that passes all gates always gets a slot (the bludgeon-can't-vanish guarantee, mirroring
  the held reserve's rationale). Amends the velocitytag doctrine header in the same commit (rule 8
  reconciliation, not append).
- **SC5 — validation + graduation.** Extend `analyze-record.mjs`/`join-outcomes.mjs` to score
  admission old-vs-new from the SC3/SC4 shadow logs: did unified-admission-only items get taken and
  realize profit; did legacy-only items we'd have missed realize profit. Written graduation
  criteria (proposed: ≥2 weeks of passes AND ≥5 realized fills attributable to unified-only
  surfacing with non-negative aggregate net — PLACEHOLDER, Ben-vetoable). Default flips only here;
  goldens regenerate here.
- **SC6 — fold + reconcile.** Docs pass: `docs/MARKET-ANALYSIS.md` §3 (gates/reserves),
  `docs/GLOSSARY.md`, README inventory (admission.mjs entry at SC3, per rule 8 it's actually
  per-chunk — SC6 is the sweep + folding this file into PLAN.md and deleting it.

Chunk independence: SC1 and SC2 are each independently landable and valuable even if SC3+ stalls.

## Encoding boundary

Encoded: the admission score, budget, exclusion report, exploration rotation, track prior — all in
`admission.mjs`/`gatecandidates.mjs`, fixture-pinned. Stays judgment: what Ben does with a
crowded-out line (the /scan skill relays it; no auto-bump of the budget). Skill prose touched: the
/scan skill gains one pointer to the exclusion footer (pointer, not copy — lint-skills enforced).

## Bookkeeping & compatibility

- `admission.mjs` gets a README inventory entry at creation (SC3).
- `screen.json` (frozen schema 2, app contract) is UNTOUCHED by every chunk — exclusion data rides
  stdout + last-report + suggestions.jsonl only. No APP_VERSION bump anywhere in this plan.
- suggestions.jsonl additions are lean/absent-field (YS2) — existing readers byte-identical.
- CI: new fixtures ride the existing `checks` job (test files are auto-swept).

## Honesty (process rule 4)

- The unified score's lane weights, trackBoost cap, exploration count, and n-gates are ALL
  unvalidated placeholders. SC5 names the data that validates them (realized fills joined via
  join-outcomes) and the plan accrues it from SC3 on (shadow co-logs).
- SC2's claim that robustified modeNet beats raw gp-flow for thin admission is a reasoned
  hypothesis (Bar E fixed the noise that motivated gp-flow), not a measured result — the one-week
  co-log is the check, and the anchor incident is n=1.
- Track record is a small sample by construction (Ben's own lots); the boost is capped and n-gated
  precisely because 3–5 closed lots cannot support more than a mild prior.

## Verification (per-chunk acceptance, summarized)

SC0/SC1: new fixtures + unchanged replay goldens (byte-identical funnel proven). SC2: regenerated
goldens hand-reviewed; live before/after `--verbose` diff shows only thin-lane membership changes.
SC3: legacy default byte-identical (goldens); unified mode fixture-pinned incl. exploration
rotation determinism (seeded/pass-counter, not RNG). SC4: boost-only property test (removing the
prior never ADDS an exclusion). SC5: graduation report checked into the analyze output before any
default flip.
