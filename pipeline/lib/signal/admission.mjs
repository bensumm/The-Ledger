/**
 * admission.mjs — unified fetch-pool admission scorer (PLAN-SCREEN-ARCHITECTURE, 2026-07-18).
 *
 * Anchor incident (2026-07-17): the screen never surfaced Abyssal bludgeon or Sanguinesti staff
 * (uncharged) despite both having real, profitable trading history with Ben, because
 * `gatecandidates.mjs`'s `rankAndSlice` admits big-ticket ("thin") candidates to the fetch pool
 * through a fixed 6-slot reserve ranked on RAW GP-FLOW (units/day × price) — a dimension that has
 * nothing to do with edge quality. Whichever handful of big tickets has the highest turnover that
 * day permanently crowds out everyone else, and nothing reports it. Ben's ruling: "raising the
 * floor is just papering over the problem" — the fix is the ranking dimension and the
 * invisibility, not a bigger reserve. Full diagnosis: PLAN-SCREEN-ARCHITECTURE.md.
 *
 * This module is the NEW default admission path (`pickFetchPool`), switched on in
 * screen-flip-niches.mjs. `rankAndSlice` (gatecandidates.mjs) keeps the three lane fixes below OUT of the
 * legacy path, is still golden-pinned, and stays selectable via `--admission legacy` for rollback. It is
 * NOT frozen, though — a fix that must hold on BOTH paths lands in both (the value reserve; PP-R's watch
 * reserve, which changed its signature and return value), so do not restate it as "unchanged".
 *
 * Three fixes over the legacy thin/rising/top-N reserve stack:
 *   1. SC2 — the thin lane ranks on `expGpDay` (the after-tax, already-Bar-E-robustified realistic
 *      daily edge — the SAME number the table prints), not raw gp-flow. Tie-break on gp-flow so a
 *      genuine liquidity difference between near-equal edges still matters.
 *   2. SC3 — a small, deterministically-ROTATING exploration reserve (split across BOTH the thin
 *      lane and the non-thin velocity lane, 2026-07-18 extension) pulls in gated-but-excluded
 *      candidates on a bounded cycle, so a real edge that's merely #7-or-worse on a given night's
 *      ranking can't be starved out indefinitely on EITHER lane (the failure class the anchor
 *      incident demonstrated) — starvation-proof by construction, not by a bigger fixed number.
 *   3. SC1 — every gated candidate NOT admitted is returned with a reason, so this class of silent
 *      exclusion is visible on every pass instead of requiring a manual CLI bisect to discover.
 *
 * Track-record boost (R4, Ben 2026-07-18: "ok with trying it") — a BOOST-ONLY multiplier from Ben's
 * own realized closed-lot history (positions.json), folded into every lane's sort key. This is a
 * narrow amendment to velocitytag.mjs's "a label, NEVER a rate/sort/gate" doctrine: that doctrine
 * still governs the DESCRIPTIVE velocity tag shown in the table (untouched, still stdout-only,
 * still never gates); this is a SEPARATE, bounded ADMISSION-ONLY prior that can only ever ADD fetch
 * priority to a proven-profitable item, never subtract from or gate out an unproven/losing one —
 * the live edge/gate stack already does that job. Unvalidated (PLACEHOLDER weights, rule 4) —
 * PLAN-SCREEN-ARCHITECTURE.md's SC5 names the join-outcomes-based check before this graduates
 * beyond "worth trying."
 */
import { proxyDrift, softFactor, THIN_RESERVE_DEFAULT, RISING_RESERVE_DEFAULT, TOP_DEFAULT, VALUE_RESERVE_DEFAULT, WATCH_RESERVE_DEFAULT, watchReserved } from './gatecandidates.mjs';
import { classifyVolLane } from './structural-admission.mjs';   // MT2 — the EXISTING gear/churn discriminator; never a second one

// --- track record (boost-only admission prior) -------------------------------------------------

// buildTrackIndex(closedLots) -> Map(itemId -> { n, sumRealised, wins }). Pure aggregation over
// positions.json's `closed` array — `realised` is already the after-tax net per lot (see
// pipeline/FILLS-PIPELINE.md). No fetch, no fs: the caller already has `closed` in hand (it reads
// positions.json for HELD_IDS regardless).
export function buildTrackIndex(closedLots) {
  const idx = new Map();
  for (const lot of (Array.isArray(closedLots) ? closedLots : [])) {
    if (lot == null || lot.itemId == null || lot.realised == null) continue;
    let e = idx.get(lot.itemId);
    if (!e) { e = { n: 0, sumRealised: 0, wins: 0 }; idx.set(lot.itemId, e); }
    e.n++; e.sumRealised += lot.realised; if (lot.realised > 0) e.wins++;
  }
  return idx;
}

export const TRACK_BOOST_MIN_N = 3;     // PLACEHOLDER (rule 4) — fewer closed lots can't support a prior
export const TRACK_BOOST_CAP = 1.5;     // PLACEHOLDER — boost-only, capped so it can never dominate the live edge term
export const TRACK_BOOST_FULL_N = 15;   // PLACEHOLDER — closed-lot count at which the boost reaches its cap

// trackBoost(entry) -> multiplier in [1, TRACK_BOOST_CAP]. BOOST-ONLY by construction: a losing,
// mixed, or unknown track record always returns exactly 1 — a bad history never gets to GATE an
// item out here (that job stays with the live edge/gate stack); this only rewards a lane that has
// repeatedly, genuinely made money.
export function trackBoost(entry, { minN = TRACK_BOOST_MIN_N, cap = TRACK_BOOST_CAP, fullN = TRACK_BOOST_FULL_N } = {}) {
  if (!entry || entry.n < minN || entry.sumRealised <= 0) return 1;
  const winRate = entry.wins / entry.n;
  if (winRate < 0.5) return 1;   // net losing/mixed lane → no boost (also never a penalty)
  const conf = Math.min(1, (entry.n - minN) / Math.max(1, fullN - minN));
  return 1 + (cap - 1) * conf * winRate;
}

// --- admission ------------------------------------------------------------------------------------

/* ⚠ THE RESERVES ARE VALIDATION SCAFFOLDING, NOT PERMANENT ARCHITECTURE (Ben, 2026-07-27).
   Read this before adding, resizing, or defending a reserve.

   Every reserve below (THIN/RISING/VALUE/watch/EXPLORE/GEAR/MID_TIER) is a deliberate BYPASS of the
   ranked top-N. That is justified only while we cannot yet trust the ranking — and the ranking is
   already capital-aware: expGpDay caps affordable units by the deployable pool (THROUGHPUT_CAP_GP,
   capPerWindow = pool / mid), so a small bankroll promotes cheaper items and a large one lets big
   tickets win on net/u. The reserve SIZES are the part that is still capital-blind: fixed slot counts
   cost the same at 10m as at 500m.

   EXIT CONDITION — these retire once the top-N is shown to surface the best candidates for the
   capital pool. They are kept in the short term BECAUSE we are still validating, not because a
   permanent per-class quota is the intended end state. Do not entrench them.

   HOW THE PROOF GETS MADE: each reserve admission is a natural experiment — an item the ranking would
   NOT have fetched, fetched anyway and then scored post-fetch. Comparing `via`-tagged rows against
   ranked-in rows is therefore the evidence that retires the reserves. EF-0a (2026-08-01, the PLAN.md
   Discovered "log `via`" prerequisite): `via` + the candidate's `preRank`/`prePool` (its 1-based
   position in this niche's pre-fetch ordering, stamped by pickFetchPool below) now RIDE
   suggestions.jsonl on every screen row, and each pass's non-admitted candidates are persisted as one
   aggregate `excluded` ledger line per niche (suggestlog.mjs excludedShadow) — so the reserve-vs-
   ranked-in comparison, and the "would the buried row have been good?" counterfactual (EF0,
   PLAN-ESTIMATOR-FIDELITY), can finally accrue. Inform-only: the stamps never gate/rank/sort. */
export const EXPLORE_RESERVE_DEFAULT = 2;   // PLACEHOLDER (rule 4) — small + bounded; the fetch-budget guard is R2
export const ROTATE_MS = 30 * 60 * 1000;    // exploration rotation period — no persisted state file needed

/* GEAR_RESERVE (MT2, PLAN-MID-TIER-ADMISSION 2026-07-27) — fetch-pool slots guaranteed to GEAR-lane
   candidates on the non-thin VELOCITY lane.

   The starved class: MID-PRICE gear (Helm of neitiznot, ~10k–2m mid). It is too LIQUID to be `thin`
   (limitVol ≥ FLOOR) so the thin reserve never covers it, and too LOW-MARGIN to win the velocity lane's
   absolute-expGpDay sort against churn commodities reaching 4.21m/d. The one class with neither a reserve
   nor a winning rank — so it is never fetched, at any bankroll, on every pass, deterministically.

   NOT a re-rank (the ruling that scopes this): the pre-fetch orderer cannot rank on capital efficiency —
   capEfficiency() needs the estimator result, which only exists AFTER the fetch. And reforming the GRADE
   to be capital-relative is the thing PLAN-GRADE-REWORK deliberately walked back (capitalFactor deleted,
   5fea8bd). So this is an ADDITIVE reserve in the shape of every other reserve in this file: the ranked
   top-N is untouched, `0` is byte-identical to pre-change, and nothing here reaches rating.mjs. */
export const GEAR_RESERVE_DEFAULT = 4;      // PLACEHOLDER (rule 4) — n=0; no mid-tier flip has ever been logged

/* MID_TIER_RESERVE (PLAN-MID-TIER-V2, 2026-07-27) — the SIBLING of GEAR_RESERVE that actually reaches
   the class GEAR_RESERVE was built for and missed.

   Measured after MT2 shipped: GEAR_RESERVE works mechanically (purely additive, 0 rows displaced) but
   `gear` is a VOLUME lane (`volDay < CHURN_VOL_CUT`), not a price or equipment class. It spans Old
   school bond (11.88m mid) down to Mithril keel parts (4.5k), and ranking that peer group by absolute
   expGpDay hands the slots to cheap high-buy-limit consumables — teleport scrolls, notes, ship parts.
   Helm of neitiznot, the motivating item, sat rank 10/15 and was never admitted. In other words MT1's
   "biggest number wins" bias simply recurred one level down, inside the reserve's own peer group.

   The fix is the RANKING DIMENSION, not a bigger reserve — the ruling this module's header already
   records from the bludgeon/Sanguinesti incident ("raising the floor is just papering over the
   problem"). Bumping GEAR_RESERVE 4→10 was considered and REJECTED: it spends 6 more fetch slots to
   reach an item scoring WORSE post-fetch (Path-A 420.7k/d, sub-floor) than what 4 slots already
   deliver (528k–758k/d, grade B). Instead this reserve re-cuts the PEER GROUP by GE buy limit — an
   existing per-candidate field, not a new metric — so genuinely GE-restricted items (limit ~70, the
   same range as the thin lane's own 5–70) are ranked against each other rather than against
   mass-tradeable commodities at limit 10,000+. */
export const MID_TIER_RESERVE_DEFAULT = 2;  // PLACEHOLDER (rule 4) — n=0. Owner's call: TWO, not four — a small
                                            // bite, paired with the offset so the next batch is one flag away.
export const MID_TIER_OFFSET_DEFAULT = 0;   // next-batch paging; 0 ⇒ byte-identical to un-paged
export const MID_TIER_LIMIT_CUT = 200;      // PLACEHOLDER — buy-limit ceiling. Real armor/weapon limits cluster
                                            // 5–100; the commodity population sits at 10,000+ or null; 200 is in
                                            // the empirically-clean gap with headroom.

/* safeSlot(v, fallback) -> a non-negative integer, or `fallback` when v is not finite or is negative.
   Guards the `.slice(start, end)` footgun that PAGING introduces here for the first time: a negative
   START selects from the array's END (never the intended "next N by rank"), a negative RESERVE makes
   the END bound negative too and can silently ADMIT MORE than asked (reserve -2 on a 5-item pool
   admits 3, not 0), and `.slice(NaN, …)` degrades to an empty admission instead of the configured
   default. None of THIN/RISING/GEAR/VALUE_RESERVE validate their CLI input, because a plain reserve
   SIZE alone can't produce a negative slice bound — paging is what makes this a genuinely new hazard,
   so this is not a missing mirror of existing precedent. It lives HERE rather than at the CLI so a
   fixture calling pickFetchPool directly (the whole test suite) is protected too. A finite
   non-integer truncates (safe degrade); only NaN/negative fall back. */
export function safeSlot(v, fallback) {
  return (Number.isFinite(v) && v >= 0) ? Math.trunc(v) : fallback;
}

/* rotationPeriodMs(poolSize, slots, rotateMs) -> ms for one full rotation, or null when nothing rotates.
   MT3 — the exploration reserve is documented as "starvation-proof by construction", which is true and,
   unqualified, misleading: 1 velocity slot rotating over ~140 excluded candidates every 30 min means a
   given row waits ~70 HOURS of continuous scanning for its turn. Pure so the render site can report the
   real period instead of implying promptness. */
export function rotationPeriodMs(poolSize, slots, rotateMs = ROTATE_MS) {
  if (!(poolSize > 0) || !(slots > 0)) return null;
  return Math.ceil(poolSize / slots) * rotateMs;
}

// deterministic rotation pick off a coarse time bucket: which excluded candidates get an
// exploration slot changes every ROTATE_MS, so the same starved item isn't picked forever without
// needing to track "last fetched" across passes on disk.
function pickExploration(pool, n, now) {
  if (!pool.length || n <= 0) return [];
  const bucket = Math.floor(now / ROTATE_MS);
  const sorted = pool.slice().sort((a, b) => a.id - b.id);
  const out = [];
  for (let i = 0; i < Math.min(n, sorted.length); i++) out.push(sorted[(bucket + i) % sorted.length]);
  return out;
}

/* pickFetchPool(mode, cand, dailySeries, opts) -> { survivors, excluded }
   Mirrors rankAndSlice's signature and the held-item unbounded guarantee, but:
     - thin lane ranks on expGpDay (the after-tax realistic edge) × trackBoost, not raw gp-flow
     - adds a small deterministically-rotating exploration reserve over the thin candidates that
       lost that ranking, so a real edge can't be permanently starved out; each such survivor is
       tagged `via:'explore'` (AR2) so a renderer CAN mark a lottery-slotted row vs a ranked-in one
       (the screen table surfaces it as a small 🎲 token) — inform-only, never gates/ranks/grades
     - folds trackBoost into the non-thin/rising lane's sort key too
     - adds a GEAR_RESERVE (MT2) on the non-thin velocity lane, so mid-price gear — which is neither
       thin enough for the thin reserve nor high-margin enough to outrank churn — gets guaranteed slots
     - returns every non-admitted candidate with a reason (SC1) instead of silently dropping it
   The value niche keeps its own gate + hard top-N by valueScore (already has an honest
   admitted/shown footer via renderValueMode) — passed through unchanged, out of scope here. */
export function pickFetchPool(mode, cand, dailySeries, opts = {}) {
  const {
    thinReserve = THIN_RESERVE_DEFAULT, risingReserve = RISING_RESERVE_DEFAULT, top = TOP_DEFAULT,
    valueReserve = VALUE_RESERVE_DEFAULT, exploreReserve = EXPLORE_RESERVE_DEFAULT, trackIndex = null, now = Date.now(),
    watchReserve = WATCH_RESERVE_DEFAULT,
    gearReserve = GEAR_RESERVE_DEFAULT,
    midTierReserve: midTierReserveRaw = MID_TIER_RESERVE_DEFAULT, midTierOffset: midTierOffsetRaw = MID_TIER_OFFSET_DEFAULT,
    midTierLimitCut = MID_TIER_LIMIT_CUT,
  } = opts;
  const midTierReserve = safeSlot(midTierReserveRaw, MID_TIER_RESERVE_DEFAULT);
  const midTierOffset = safeSlot(midTierOffsetRaw, MID_TIER_OFFSET_DEFAULT);
  const isValue = cand.length && cand[0].valueScore !== undefined;
  if (isValue) {
    // PLAN-FETCH-POOL-SCALING chunk 1 — the VALUE RESERVE, applied in the DEFAULT (unified) admission
    // path too (ADMISSION==='unified' unless --admission legacy, so the fix has to live in BOTH places
    // — admission.mjs:116 documents this double-maintenance shape). The excluded remainder is re-ranked
    // by RAW cycle-amplitude-% (valueRanges.afterTaxAmpPct — a DIFFERENT key than the composite
    // valueScore that buries a low-liquidity big cycle) and the top `valueReserve` are PREPENDED with
    // via:'reserve' (mirrors the exploration reserve's via:'explore' marker — a renderer/log CAN tell a
    // reserve-slotted row from a ranked-in one). Additive: the ranked top-N is untouched, and the
    // reserved rows are NOT also reported excluded.
    const sorted = cand.slice().sort((a, b) => (b.valueScore - a.valueScore) || (a.id - b.id));
    // EF-0a — stamp every gated candidate's position in THIS niche's pre-fetch ordering (valueScore
    // desc, the ordering that decides admission here) so the ledger can answer "how did a reserve/
    // excluded pick rank in the overall list?" (PLAN.md Discovered `via`+rank logging). Mutates the
    // candidate objects (the proxyDrift precedent below); clones made later inherit the stamp.
    // Inform-only — never read by any gate/sort in this module.
    sorted.forEach((c, i) => { c.preRank = i + 1; c.prePool = sorted.length; });
    const topN = sorted.slice(0, top);
    const topIds = new Set(topN.map(c => c.id));
    const ampOf = c => (c.valueRanges && c.valueRanges.afterTaxAmpPct) || 0;
    const reserve = sorted.slice(top)
      .sort((a, b) => (ampOf(b) - ampOf(a)) || (a.id - b.id))
      .slice(0, valueReserve)
      .map(c => ({ ...c, via: 'reserve' }));
    const reservedIds = new Set(reserve.map(c => c.id));
    const survivors = [...reserve, ...topN];
    const excluded = sorted.slice(top).filter(c => !reservedIds.has(c.id)).map(c => ({ ...c, reason: 'value-top-n' }));
    return { survivors, excluded };
  }
  // A2 (PLAN-AMPLITUDE-SCAN) — the amplitude niche keeps its own Stage-1 gate + hard top-N by the
  // daily-amplitude PROXY (mirrors value's own-gate branch); the throughput/thin/exploration lanes below
  // don't apply (amplitude candidates carry no expGpDay — they're ranked by ampProxy, not gp/day velocity).
  // F-B (PLAN-OSCILLATION-CYCLE post-landing follow-up) — a WATCHLIST RESERVE mirrors gatecandidates.mjs's
  // rankAndSlice (this is the DEFAULT admission path — ADMISSION==='unified' — so the fix has to live
  // here too, not just in the legacy rankAndSlice): any `watched` candidate (gateAmplitudeCandidates
  // already let it through the proxy floor) that falls outside the top-N still gets a guaranteed fetch
  // slot, so a watchlisted big-ticket (fang/blowpipe/dragon boots) actually reaches the Stage-2
  // amplitudeGate instead of being silently crowded out by AMP_TOP_DEFAULT every scan.
  const isAmplitude = cand.length && cand[0].ampProxy !== undefined;
  if (isAmplitude) {
    const sorted = cand.slice().sort((a, b) => (b.ampProxy - a.ampProxy) || (a.id - b.id));
    // EF-0a — same pre-fetch-position stamp as the value branch, on amplitude's own ordering key
    // (ampProxy desc). Inform-only.
    sorted.forEach((c, i) => { c.preRank = i + 1; c.prePool = sorted.length; });
    const topN = sorted.slice(0, top);
    const topIds = new Set(topN.map(c => c.id));
    const watchReserveRows = cand.filter(c => c.watched && !topIds.has(c.id));   // UNBOUNDED here; the band stack's is bounded (WATCH_RESERVE_DEFAULT) — see that constant
    const survivors = [...watchReserveRows, ...topN];
    const survivorIds = new Set(survivors.map(c => c.id));
    return { survivors, excluded: cand.filter(c => !survivorIds.has(c.id)).map(c => ({ ...c, reason: 'amplitude-top-n' })) };
  }

  for (const c of cand) c.proxyDrift = proxyDrift(dailySeries[c.id]);
  const boostOf = c => trackIndex ? trackBoost(trackIndex.get(c.id)) : 1;

  // EF-0a (PLAN.md Discovered "log `via` into suggestions.jsonl" — the reserve-retirement prerequisite):
  // stamp every gated candidate's 1-based position in the UNIFIED pre-fetch ordering,
  // expGpDay × softFactor(proxyDrift) × trackBoost — the exact formula the Discovered entry names as
  // unrecoverable after the fact ("neither multiplier is recorded"). This is a DIAGNOSTIC reference
  // ordering over the WHOLE gated pool (held + thin + velocity together); the actual admission still
  // runs the per-lane sorts below (thin omits softFactor, held bypasses ranking) — the stamp exists so
  // a ledger row can say "would have ranked 12th of 178", not to change who is admitted. Mutates the
  // candidate objects (the proxyDrift precedent above); via-tagged clones inherit it. Inform-only —
  // nothing below reads preRank/prePool.
  {
    const unifiedScore = c => (c.expGpDay || 0) * softFactor(c.proxyDrift) * boostOf(c);
    const ordered = cand.slice().sort((a, b) => (unifiedScore(b) - unifiedScore(a)) || (a.id - b.id));
    ordered.forEach((c, i) => { c.preRank = i + 1; c.prePool = ordered.length; });
  }

  const held = cand.filter(c => c.held);
  const heldIds = new Set(held.map(c => c.id));
  const rest = cand.filter(c => !heldIds.has(c.id));

  const thinAll = rest.filter(c => c.thin);
  const nonThinAll = rest.filter(c => !c.thin);

  // THIN lane (SC2) — rank on the already-computed after-tax realistic edge, not raw gp-flow.
  // Tie-break on gp-flow so a genuine liquidity gap between near-equal edges still separates them.
  const thinScored = thinAll
    .map(c => ({ c, score: (c.expGpDay || 0) * boostOf(c) }))
    .sort((a, b) => b.score - a.score || (b.c.limitVol * b.c.mid) - (a.c.limitVol * a.c.mid));
  const thinAdmitted = thinScored.slice(0, thinReserve).map(x => x.c);
  const thinRemainder = thinScored.slice(thinReserve).map(x => x.c);

  // NON-THIN throughput lane + rising reserve — same shape as rankAndSlice, trackBoost folded in.
  nonThinAll.sort((a, b) => (b.expGpDay * softFactor(b.proxyDrift) * boostOf(b)) - (a.expGpDay * softFactor(a.proxyDrift) * boostOf(a)));
  const risers = nonThinAll.filter(c => (c.proxyDrift ?? 0) > 0).sort((a, b) => b.proxyDrift - a.proxyDrift).slice(0, risingReserve);
  const riserIds = new Set(risers.map(c => c.id));
  const velocityPool = nonThinAll.filter(c => !riserIds.has(c.id));
  // EXPLORATION, velocity lane (2026-07-18 extension — the thin lane isn't the only one that can
  // starve a real edge: a mid-tier churn/band candidate that clears every gate but consistently
  // loses the velocity ranking has the SAME failure shape, just on this lane instead. Split the
  // exploration budget so BOTH lanes rotate — half (min 1) each, rounded toward the thin lane since
  // that's the anchor incident's lane; a lane with nothing to explore just forfeits its half.
  const thinExploreN = Math.ceil(exploreReserve / 2), velExploreN = Math.floor(exploreReserve / 2);
  // AR2 (PLAN-ARCHITECTURE-COHERENCE, the MARKER option): tag every exploration-admitted survivor
  // with `via:'explore'` so the render site can tell a rotating-lottery slot from a ranked-in pick
  // (the exploration reserve is Date.now()-bucketed, so a row can be admitted THIS pass purely
  // because it's this 30-min window's rotation turn — honest to mark it, not hide the fact). The
  // rotation logic is DELIBERATELY unchanged (Ben's call — mark, don't de-non-determinize). The tag
  // is a CLONE (spread `{...c}`) applied AFTER pickExploration, so it can't clobber the candidate's
  // own fields and the originals in `cand` stay unmarked — a non-exploration survivor carries no
  // `via` at all (byte-identical shape to before; JSON is unchanged when exploreReserve is 0).
  const exploredThin = pickExploration(thinRemainder, thinExploreN, now).map(c => ({ ...c, via: 'explore' }));
  const nonThinBudget = Math.max(0, top - thinAdmitted.length - exploredThin.length - risers.length);
  const velocityAdmitted = velocityPool.slice(0, nonThinBudget);
  const velocityRemainder = velocityPool.slice(nonThinBudget);
  const exploredVelocity = pickExploration(velocityRemainder, velExploreN, now).map(c => ({ ...c, via: 'explore' }));

  // GEAR RESERVE (MT2) — see the GEAR_RESERVE_DEFAULT header. Ranked among GEAR-LANE PEERS on the same
  // expGpDay×trackBoost axis the lane already uses, so no new metric is invented; it is only the peer
  // GROUP that changes. Tagged via:'reserve' (the value reserve's existing marker), which also makes them
  // `isProtected` in clampUnionFetch for free. Rows already taken by the exploration rotation are excluded
  // so the two reserves can't double-spend a slot on the same item.
  //
  // FAIL-CLOSED on a missing volDay: `Number.isFinite` first, deliberately NOT `classifyVolLane(c.volDay ?? 0)`
  // — 0 is below CHURN_VOL_CUT, so a `??0` default would silently classify EVERY volDay-less candidate as
  // gear and hand the reserve to an arbitrary set. No volDay ⇒ no reserve slot (pinned by a test).
  const exploredVelIds = new Set(exploredVelocity.map(c => c.id));
  const gearReserved = velocityRemainder
    .filter(c => !exploredVelIds.has(c.id) && Number.isFinite(c.volDay) && classifyVolLane(c.volDay) === 'gear')
    .sort((a, b) => ((b.expGpDay || 0) * boostOf(b)) - ((a.expGpDay || 0) * boostOf(a)) || (a.id - b.id))
    .slice(0, gearReserve)
    .map(c => ({ ...c, via: 'reserve' }));

  // MID_TIER_RESERVE (PLAN-MID-TIER-V2) — a SIBLING of GEAR_RESERVE, sequenced strictly AFTER it (it
  // draws from what GEAR_RESERVE left behind), additionally filtered to a LOW GE BUY LIMIT. See the
  // MID_TIER_RESERVE_DEFAULT header above for why the buy limit is the right axis and why a bigger
  // GEAR_RESERVE was rejected. Same additive shape as every other reserve here: 0 is a strict no-op.
  //
  // ⚠ NULL LIMIT — fail-closed, but NEVER silently. Requiring `c.limit != null` is correct TODAY (the
  // only null-limit gear-lane candidates measured are teleport scrolls) but it opposes a deliberate
  // ruling in structural-admission.mjs: "null ⇒ MIN_THIN fallback, NOT exclude — ~89 newer gear items
  // carry limit=null". Measured: 450 of 4,591 mapped items carry a null limit, and Webweaver bow (u),
  // Magus ring and Bellator ring are null-limit gear-lane candidates right now — they miss this pool
  // ONLY because they classify `thin`. Being liquid enough to escape `thin` is the DEFINING trait of
  // the mid-tier class, so this will eventually drop a real target item. The filter stays; the
  // invisibility does not — such a candidate is reported below as `mid-tier-limit-unknown` rather than
  // being folded into the generic `top-n-full` (SC1's never-a-silent-drop contract, and this module's
  // own header: the fix is the ranking dimension AND the invisibility).
  // Honest about its coarseness: that reason fires for EVERY mid-tier-eligible null-limit candidate,
  // not only one that would have won a slot — it flags "structurally shut out", not "would have been
  // admitted", the same coarseness as the pre-existing top-n-full bucket.
  const gearReservedIds = new Set(gearReserved.map(c => c.id));
  const midTierEligible = c =>
    !exploredVelIds.has(c.id) && !gearReservedIds.has(c.id) &&
    Number.isFinite(c.volDay) && classifyVolLane(c.volDay) === 'gear';
  const midTierReserved = velocityRemainder
    .filter(c => midTierEligible(c) && c.limit != null && c.limit <= midTierLimitCut)
    .sort((a, b) => ((b.expGpDay || 0) * boostOf(b)) - ((a.expGpDay || 0) * boostOf(a)) || (a.id - b.id))
    .slice(midTierOffset, midTierOffset + midTierReserve)   // paging; safeSlot-guarded, and an offset at/past
    .map(c => ({ ...c, via: 'reserve' }));                  // the pool size slices to [] by plain JS semantics

  const ranked = [...held, ...thinAdmitted, ...exploredThin, ...risers, ...velocityAdmitted, ...exploredVelocity, ...gearReserved, ...midTierReserved];
  // WATCH RESERVE (PP-R) — the band stack had no watchlist reserve on EITHER admission path, so a
  // watchlisted item that lost the thin/velocity ranking never reached a niche TABLE (runWatchlist still
  // quoted and graded it in its own section — the lost thing is the lane, not the price; the amplitude
  // branch above has had a reserve since F-B). Same bounded, additive, prepend-only shape; the
  // selection itself is gatecandidates.mjs's `watchReserved`, shared so this path and the legacy
  // rankAndSlice cannot drift apart (the double-maintenance the value reserve already warns about).
  const watchAdmitted = watchReserved(cand, ranked, watchReserve);
  const survivors = [...watchAdmitted, ...ranked];

  // --- exclusion report (SC1) — every gated candidate NOT admitted, with a reason. ---
  const admittedIds = new Set(survivors.map(c => c.id));
  const excluded = cand
    .filter(c => !admittedIds.has(c.id))
    // A watchlisted candidate that is STILL excluded lost the bounded watch reserve itself — say so
    // rather than folding it into the generic lane bucket, so the bound is visible when it binds
    // (SC1's never-a-silent-drop contract; same reasoning as `mid-tier-limit-unknown`).
    .map(c => ({ ...c, reason: c.watched ? 'watch-reserve-full'
      : c.thin ? 'thin-reserve-full'
      : ((c.proxyDrift ?? 0) > 0 ? 'rising-reserve-full'
      : (midTierEligible(c) && c.limit == null ? 'mid-tier-limit-unknown' : 'top-n-full')) }))
    .sort((a, b) => (b.expGpDay || 0) - (a.expGpDay || 0));

  return { survivors, excluded };
}

// --- PLAN-FETCH-POOL-SCALING chunk 4: the cross-niche fetch-budget ceiling -------------------------
// `--mode all` UNIONS survivors across band/churn/amplitude before fetching (dedup on shared ids, but
// NOT a shared budget today). Once chunks 2-3 let each niche independently capital-scale toward its own
// MAX, the deduped union can grow past what any single niche's MAX implies — so this clamps the union to
// TOTAL_FETCH_MAX, keeping the worst-case fetch bill bounded. It is the ONE piece of this plan with no
// direct precedent (§2.4). PLACEHOLDER n≈0 (rule 4).
export const TOTAL_FETCH_MAX = 150;   // PLACEHOLDER — cross-niche ceiling on the deduped survivor union

// clampUnionFetch(niches, totalMax) -> { niches:[{mode,survivors,trimmed}], unionSize, trimmedCount }.
//   niches: [{ mode, survivors:[cand] }] — each niche's fetch-pool survivors (in rank order, best first).
// Trims plain ranked-in survivors from the tail (lowest-ranked last) fairly across niches (round-robin)
// until the DEDUPED union of survivor ids is ≤ totalMax. Reserve-slotted survivors are PROTECTED and
// never trimmed — held/watched items and any via-tagged reserve row (via:'reserve' value reserve,
// via:'explore' rotation) — matching the codebase precedent of protecting the named/held set first
// (Open Decision 4.4's inference). Pure: returns NEW survivor arrays + the trimmed rows per niche and a
// total; the caller reports the trimmed rows (reason 'total-fetch-max') — never a silent drop (SC1's
// contract extended to the cross-niche level). A union already within budget is returned unchanged
// (trimmed: []), so this is a strict no-op below the ceiling.
export function clampUnionFetch(niches, totalMax = TOTAL_FETCH_MAX) {
  const isProtected = c => !!(c.held || c.watched || c.via);
  const allIds = new Set();
  for (const n of niches) for (const c of n.survivors) allIds.add(c.id);
  if (allIds.size <= totalMax) return { niches: niches.map(n => ({ mode: n.mode, survivors: n.survivors, trimmed: [] })), unionSize: allIds.size, trimmedCount: 0 };

  // protected ids are always kept; the remaining budget fills with the fairest-ranked unprotected ids.
  const protectedIds = new Set();
  for (const n of niches) for (const c of n.survivors) if (isProtected(c)) protectedIds.add(c.id);
  const budget = Math.max(0, totalMax - protectedIds.size);
  // round-robin across each niche's unprotected survivors (already rank-ordered) so no niche is starved.
  const queues = niches.map(n => n.survivors.filter(c => !isProtected(c) && !protectedIds.has(c.id)).slice());
  const keptUnprotected = new Set();
  let idx = 0, emptyStreak = 0;
  while (keptUnprotected.size < budget && emptyStreak < queues.length) {
    const q = queues[idx % queues.length]; idx++;
    if (!q.length) { emptyStreak++; continue; }
    emptyStreak = 0;
    keptUnprotected.add(q.shift().id);
  }
  const keepIds = new Set([...protectedIds, ...keptUnprotected]);
  const out = niches.map(n => {
    const survivors = [], trimmed = [];
    for (const c of n.survivors) (keepIds.has(c.id) ? survivors : trimmed).push(c);
    return { mode: n.mode, survivors, trimmed };
  });
  return { niches: out, unionSize: keepIds.size, trimmedCount: out.reduce((s, n) => s + n.trimmed.length, 0) };
}
