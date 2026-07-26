# PLAN-BLINDSPOT-AUDIT — false negatives: what we throw away or never see

**Status: AUDIT ONLY, no code changed.** Ben asked for the inverse of the usual question — not
"are our picks good" (false positives, the domain of `docs/SIGNAL-AUDIT.md`'s stale-read census)
but "what genuinely-profitable shapes are we systematically dropping or blind to." This doc is
that inventory. Read `docs/MARKET-ANALYSIS.md` (gate/grade doctrine) and `docs/GLOSSARY.md` first
if the vocabulary here is unfamiliar.

**Honesty up front (CLAUDE.md rule 4).** Most of this is **n≈0 hypothesis-generation off
structure and one live scan snapshot** (2026-07-24), not a calibrated study. Two things anchor it
in real data: (1) a read-only `screen-flip-niches.mjs --mode all/amplitude/value` run this session
whose actual drop counts and crowded-out candidates are quoted verbatim below, and (2)
`analyze-record.mjs --json` against the live `suggestions.jsonl` (73,493 rows). Everything else is
structural reasoning from the gate code + specs. Don't treat a ranking here as a validated backlog
— treat it as "where to look first if false negatives turn out to matter."

---

## 1. Ranked false-negative signatures

| # | Signature | Cause | Evidence | Potential (honest) |
|---|---|---|---|---|
| 1 | **A real winner never gets fetched at all** — dropped before any pricing/gate math runs, purely by a fixed top-N/thin-reserve slot count | `pipeline/lib/admission.mjs` `pickFetchPool` / `gatecandidates.mjs` `rankAndSlice`: `TOP_DEFAULT=40`, `THIN_RESERVE_DEFAULT=6`, `VALUE_TOP_DEFAULT=25` are **fixed constants**, independent of `--capital` | **Live, quoted**: band dropped 93/134 gated candidates before fetch this session — best excluded was **Crimson kisten, ~13.84m/d expected net, reason `thin-reserve-full`** (bigger expected net/day than most of the 24 items that DID get shown). Churn dropped 45/86 — best excluded **Seeking dragon arrow, ~4.16m/d, reason `top-n-full`**. Value dropped 104/129 gated candidates (top-25-by-valueScore cut, no reserve at all). Already Ben-flagged in `PLAN.md` "Discovered" 2026-07-23 (Sanguinesti staff/Basilisk jaw/Webweaver bow buried at `--top 40`, surfaced only at `--top 90`) — **tracked but unfixed** | **HIGH** — this is the one signature with a concrete, currently-real, currently-larger-than-shown-picks number attached to it |
| 2 | **Liquid falling big-ticket with a genuinely positive robust-band net, invisible to every discovery niche unless already watchlisted** | band/churn declare `falling:'exclude'` (the doctrine default); amplitude additionally gates the same shape on `trend`/`knife`/`margin-below-floor`; nothing in `--mode all` has a "falling but liquid and still net-positive" lane | **Live, quoted**: this session's WATCHLIST section (gate/floor-exempt) shows ~15 A−/B+ falling/cooling big-tickets with clearly positive Optimistic net that never appear in band, churn, or amplitude output — Ancient godsword (+623.2k, P~0.50), Dragon claws (+414.2k), Webweaver bow (+248.7k, also amplitude-dropped on `trend`), Masori body (+137.5k, P~1.00), Archers ring (+59.2k), Aranea boots (+23.5k), Dragonfire shield (+12.8k), Toxic blowpipe (+46.3k). The amplitude run's own Stage-2 footer: `trend 11, knife 0, margin-below-floor 1` of 41 candidates dropped for exactly this shape. Confirms + sharpens the already-known `falling-exclusion-amended` doctrine and the `multi-week-oscillator-class` memory: **a NEW falling big-ticket that isn't already on `watchlist.json` has no path to discovery at all**, regardless of how liquid or profitable its patient band is | **HIGH** — the watchlist proves the shape is common (15/60 watched items this scan) and the per-item nets are large (100k–900k/flip); the entire class depends on Ben having pre-added the item |
| 3 | **The repeatable multi-week oscillator (the fang quadrant)** | Niche taxonomy is 3 cycle periods on ONE axis: band (2h), amplitude (24h, gate windows `AMP_NIGHTS=14`/`OSC_DETECTOR_NIGHTS=21`, endpoint-capped ~15d real data), invest/value (7d+, explicitly framed as **buy-and-hold ONE-SHOT**, not a repeating lap). No niche models "repeats every ~6–8 days" | Confirmed structural, not re-derived from data this session (already anchored in user memory: fang's real period ~6–8d, swing ~11%, found by accident on the *daily* amplitude clock). Even if amplitude's oscillation detector caught fang's shape, its `hold ~1d` framing and rank family price a 1-day cycle, not a 6–8d one; value's framing would price one entry and never re-enter after the first sell | **MEDIUM-HIGH** — one concrete anchor (fang), unknown how many other items share the shape; genuinely a taxonomy hole, not a threshold-tuning fix |
| 4 | **Thin big-ticket buried under a `B` letter grade despite a correctly-computed top rank** | `REACH_GRADE_CAP='B'` fires whenever ask-reach < `REACH_GRADE_CAP_FRAC` (50%), on top of `THIN_GRADE_CAP='A-'`. But `P(fill)` (the same ask-reach factor) is **already** multiplied into the `net × P(fill) ÷ TTF` rank the row sorts on — the grade cap re-penalizes the identical signal a second time, on the LETTER a human skims by, not the rank a human should sort by | Structural (code read: `js/rating.mjs` `capGrade`/`REACH_GRADE_CAP_FRAC`). `docs/SIGNAL-AUDIT.md` "Grade-cap sprawl" already flags the five-cap legibility debt and R7 shipped a `cappedBy` field naming which cap bound the letter — that fixes attribution, not the double-penalty itself. This is a genuine open finding beyond `cappedBy`/RF6/HT (which are about thin-big-ticket *instability* and 3-day-drift *decay*, not this specific rank-vs-letter mismatch) | **MEDIUM** — a human-legibility false negative (skim past a `B` that's actually top-ranked), not an algorithmic one; the sort order itself is arguably fine, but Ben's memory (`actionable-first-dead-last`) says ordering matters and grade is the first thing read |
| 5 | **`reach` validator is the single largest reject source in the historical record, unverified as correctly-tight** | `js/validate.mjs` `reachValidator`; `reach` gates on `band`+`churn`, informs elsewhere per the P2/P3 registry | **Live, quoted**: `analyze-record.mjs --json` over 73,493 logged suggestions: `validator 'reach' rejects = 8,009` — by a wide margin the most-firing reject (next is `trajectory` at 1,606). The tool's own candidate output explicitly caveats: *"a high reject count alone is NOT evidence of over-tightness"* — no not-taken→would-have-filled counterfactual exists yet to confirm or clear it | **LOW-MEDIUM confidence, but flagged as HIGH volume** — this is exactly the kind of number `/analyze`'s own F1 pipeline exists to eventually adjudicate; flagging it here so it isn't lost, but it's explicitly not proof of anything by the tool's own honesty bar |
| 6 | **Update-cycle gear: no anticipation signal on either side, by design** | `PLAN-SIGNAL-RECENCY.md`: *"the operator overlays exogenous knowledge (game updates, community intel) on top of every trend note"* — this is a **deliberate** design choice, confirmed by grep (no `gameUpdate`/`patchDay`/update-calendar code anywhere in the repo) | Memory (`update-cycle-timing`) documents the post-update DUMP being misread as a discount by @floor/dip signals; this audit's job was to check whether the pre-update PUMP side is *also* blind. It is — but so is every other exogenous-news shape, on purpose. The generic `spike-rising-lows`/`spike-falling-lows` phase classifier (seen live in this session's WATCH CLOSELY section) gives a *partial*, non-update-specific tell ("healthy reprice, more holdable" vs "froth, fragile — do not chase") that happens to catch some of this shape incidentally | **LOW as a code gap** — this is closer to a "found nothing to fix" than a blindspot: encoding a game-update calendar would be a categorically different (and fragile) kind of signal than everything else in the system. Worth stating explicitly rather than leaving it an open question, since the task asked directly |
| 7 | **Value/invest's top-25-by-`valueScore` cut has no reserve mechanism at all** | `VALUE_TOP_DEFAULT=25`, no `thinReserve`/`risingReserve` analog exists for the value niche (those are band/churn-only in `gatecandidates.mjs`) | **Live, quoted**: this session's `--mode value` run: `admitted 129 (gate) · fetched 25 (top 25 by valueScore) · shown 20` — **104 gated candidates never got a fetch slot**, and unlike band/churn there is no guaranteed-slot carve-out for a big-ticket that ranks outside the top 25 on the (day-scale) `valueScore` proxy but might have a genuinely strong multi-week cycle | **MEDIUM** — same root-cause family as #1 (crowded fetch pool), called out separately because value has *zero* mitigation where band/churn at least have a partial one; folds into the same fix if #1 is ever addressed |

---

## 2. Minimal-signal sketches for the top few (hypotheses, not plans)

**#1 — fetch-pool crowding.** The fix is already scoped in `PLAN.md`'s Discovered list (Ben,
2026-07-23): make `thinReserve`/`top` scale with `--capital` instead of a fixed constant, so a
high-bankroll pass doesn't need a manual `--top 90`. This audit adds: extend the same idea to
**value's `VALUE_TOP_DEFAULT`**, which currently has no reserve concept at all (#7). The minimal
version doesn't need a capital-scaling formula on day one — even a small fixed reserve (mirroring
`THIN_RESERVE_DEFAULT`) for value's own thin/big-ticket tail would close the gap `#7` describes at
near-zero design cost, before the fuller capital-aware version lands.

**#2 — falling-but-liquid big-ticket.** Not "un-exclude falling from band/churn" (that would break
the working default and reopen ghost-spread risk on illiquid fallers). The narrower shape: a
console-only "falling watch" lane that runs the SAME robust-band Optimistic math band already
computes for gated survivors, restricted to items that are (a) two-sided liquid, (b) big-ticket by
`BIG_TICKET_GP`, and (c) currently excluded ONLY by the falling doctrine (not by liquidity/reach/
margin). This is close to what the WATCHLIST section already renders for watched items — the gap
is that it only fires for items Ben already added. A cheap version: when amplitude's Stage-2 drops
a candidate specifically on `trend`/`knife` (not `amp-below-floor`/`bid-unreachable`/
`ask-unreachable`/`unaffordable`), print it in a small `— falling, still liquid, band-priced —`
appendix instead of silently discarding it, using the SAME `estimatePair` band math band/churn
already run. Inform-only, no gate change, no rank change — exactly the shape the existing digest
big-ticket-lane guarantee (POLISH 1) already uses as a precedent.

**#3 — repeatable multi-week oscillator.** Out of scope to sketch meaningfully without real
period-detection work (this would be a genuinely new signal, not a threshold tweak) — flagging the
taxonomy gap is the honest deliverable here. A future chunk would need: (a) a period-detection pass
over the daily archive (autocorrelation or peak-to-peak spacing on `windowStats`'s daily series,
distinct from `oscillationVsKnife`'s leg-counting, which is tuned for the ≥1.5-cycle/≥3-leg
detection at the amplitude/24h scale, not a 6–8d one), (b) a hold-horizon that isn't hardcoded to 1
day like amplitude or "forever" like value. Named here so a future planner doesn't have to
rediscover it.

**#4 — grade-vs-rank double penalty.** The minimal fix is NOT to remove `REACH_GRADE_CAP` (it
exists because a letter grade alone, without the rank number beside it, oversells a rarely-filling
top). It's a **presentation** fix: since the rank already prices `P(fill)`, a row capped by
`REACH_GRADE_CAP` specifically (as opposed to `THIN_GRADE_CAP`/`SUBFLOOR_GRADE_CAP`/
`PHASE_BASING_GRADE_CAP`) could carry a distinguishing marker meaning "letter is conservative,
rank is the real read" — vs. the other caps, which represent additional risk the rank doesn't
price at all (thinness, sub-floor entry, basing-phase froth). `cappedBy` already names which cap
fired; this only needs a doc/skill note ("read rank over letter when `cappedBy: reach`") rather
than new code — possibly even just a `/scan` skill judgment-layer bullet.

---

## 3. Gates we looked at and found correctly tight (no blindspot manufactured)

- **Two-sided liquidity gate (`hpv>0 && lpv>0`).** Non-negotiable per prior lessons (ghost-spread
  ITAM). No false-negative case found — a one-sided book genuinely can't be crossed both ways;
  loosening it would reopen a closed failure mode, not open a new opportunity class.
- **500k gp/d attention floor.** Exempts held/asked/watchlist items already (`docs/MARKET-ANALYSIS.md`
  §3), and this session's own WATCHLIST rows show it firing correctly on genuinely sub-scale items
  (Coal, Ranarr seed, Wrath rune, Mahogany plank, Snape grass, Antidote++, Super combat potion —
  all D-grade, all flagged "below 500k/day attention floor," all sub-100gp commodities where a
  500k-a-day floor is the right kind of filter). No evidence of a real opportunity hiding behind it
  this session.
- **Bar E band-edge robustness (p90/p10 trim on dense sides).** Exists specifically to prevent a
  false POSITIVE (one flier inflating an edge); as a possible false-negative source it would only
  matter if it trimmed away a real, repeatedly-traded edge — but the `tradedWin`/`sawLow`/`sawHigh`
  density gate (Bar D) already requires the edge to be genuinely traded before Bar E even applies
  the trim, so a real edge with real density survives the trim by construction.
- **`ignored-items.json` quarantine.** Verified by grep: this file is consumed only by
  `pipeline/lib/ignored.mjs`'s MERCH-VIEW consumers (offers/monitor/holdthesis/sync-fills/
  dev-server) — **`screen-flip-niches.mjs` never imports it.** An ignored item (e.g. "Old school
  bond," quarantined `personal-use`) still fully participates in scan/screen candidacy — and did,
  live, this session (Old school bond graded S+ in the amplitude run). The doc's own claim
  ("quarantine is a VIEW filter ONLY, not a pricing gag") checks out in code, not just in prose.
- **Value/invest's `VALUE_MIN_CYCLE_PCT=6%` / `VALUE_MAX_CYCLE_PCT=150%` hard gate.** This audit
  initially expected to find the inform-only `valueAmplitudeValidator`'s 4% week-amplitude floor
  (`VALAMP_MIN_PCT`) as a live blindspot candidate — but per the P2/P3 registry it's **inform
  everywhere**, never gates, and `analyze-record.mjs`'s 174 "would-have-rejected" rows on that key
  are shadow-logged, not real drops. The ACTUAL hard gate at the value niche level is the
  6%/150% cycle-amplitude band in `js/valuescreen.mjs`, which is wide enough (150% ceiling) that
  it's rejecting regime-change/noise cases, not real value cycles — this session's value run
  dropped only 5/129 candidates post-fetch on `trajectory-knife`, all named, all legitimately
  falling knives per the printed reasons (Annakarl teleport (tablet), Oranges(5), Bastion
  potion(4), Red topaz, Magus ring).

---

## 4. What this audit could NOT investigate (flagged, not guessed at)

- **Item 7's "cut-then-ran" question** — whether an item we explicitly vetoed/cut later ran up —
  could not be answered from `analyze-record.mjs`'s current output: the retro rolls up
  filled/filledWorse/notTaken per flip-niche, but doesn't currently join a REJECTED/dropped
  candidate id forward to its realized future price. The `candidates` section (the four validator-
  reject counts) is the closest proxy, and it's explicitly n-gated by the tool's own honesty
  language. A real answer needs a not-taken→would-have-filled counterfactual join that doesn't
  exist yet (the tool says as much for the `reach` validator specifically).
- **Whether Crimson kisten / Seeking dragon arrow / the other crowded-out items are ACTUALLY good
  flips**, as opposed to merely having a high `expGpDay` proxy that a fuller gate pass would still
  reject on liquidity/reach/margin grounds once fetched — this audit only confirms they never got
  the chance to be checked, not that they'd pass. (Seeking dragon arrow in particular is currently
  under a separate, deliberate Ben veto per the `arrows-on-hold-pending-update` memory — an
  independent reason it shouldn't surface right now regardless of the fetch-pool question.)
- **A systematic count of how many watchlist-only falling big-tickets (signature #2) would clear
  the two-sided-liquidity/reach gates if run through the pipeline** — this audit spot-checked ~15
  from one scan's WATCHLIST section; a real estimate needs the "falling watch" appendix sketched
  in §2 actually built and run for a few days.
