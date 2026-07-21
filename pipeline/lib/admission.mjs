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
 * screen-flip-niches.mjs. `rankAndSlice` (gatecandidates.mjs) is UNCHANGED, still fixture/golden-
 * pinned, and stays selectable via `--admission legacy` for rollback — nothing here erases it.
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
import { proxyDrift, softFactor, THIN_RESERVE_DEFAULT, RISING_RESERVE_DEFAULT, TOP_DEFAULT } from './gatecandidates.mjs';

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

export const EXPLORE_RESERVE_DEFAULT = 2;   // PLACEHOLDER (rule 4) — small + bounded; the fetch-budget guard is R2
const ROTATE_MS = 30 * 60 * 1000;           // exploration rotation period — no persisted state file needed

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
     - returns every non-admitted candidate with a reason (SC1) instead of silently dropping it
   The value niche keeps its own gate + hard top-N by valueScore (already has an honest
   admitted/shown footer via renderValueMode) — passed through unchanged, out of scope here. */
export function pickFetchPool(mode, cand, dailySeries, opts = {}) {
  const {
    thinReserve = THIN_RESERVE_DEFAULT, risingReserve = RISING_RESERVE_DEFAULT, top = TOP_DEFAULT,
    exploreReserve = EXPLORE_RESERVE_DEFAULT, trackIndex = null, now = Date.now(),
  } = opts;
  const isValue = cand.length && cand[0].valueScore !== undefined;
  if (isValue) {
    const sorted = cand.slice().sort((a, b) => (b.valueScore - a.valueScore) || (a.id - b.id));
    return { survivors: sorted.slice(0, top), excluded: sorted.slice(top).map(c => ({ ...c, reason: 'value-top-n' })) };
  }
  // A2 (PLAN-AMPLITUDE-SCAN) — the amplitude niche keeps its own Stage-1 gate + hard top-N by the
  // daily-amplitude PROXY (mirrors value's own-gate branch); the throughput/thin/exploration lanes below
  // don't apply (amplitude candidates carry no expGpDay — they're ranked by ampProxy, not gp/day velocity).
  const isAmplitude = cand.length && cand[0].ampProxy !== undefined;
  if (isAmplitude) {
    const sorted = cand.slice().sort((a, b) => (b.ampProxy - a.ampProxy) || (a.id - b.id));
    return { survivors: sorted.slice(0, top), excluded: sorted.slice(top).map(c => ({ ...c, reason: 'amplitude-top-n' })) };
  }

  for (const c of cand) c.proxyDrift = proxyDrift(dailySeries[c.id]);
  const boostOf = c => trackIndex ? trackBoost(trackIndex.get(c.id)) : 1;

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

  const survivors = [...held, ...thinAdmitted, ...exploredThin, ...risers, ...velocityAdmitted, ...exploredVelocity];

  // --- exclusion report (SC1) — every gated candidate NOT admitted, with a reason. ---
  const admittedIds = new Set(survivors.map(c => c.id));
  const excluded = cand
    .filter(c => !admittedIds.has(c.id))
    .map(c => ({ ...c, reason: c.thin ? 'thin-reserve-full' : ((c.proxyDrift ?? 0) > 0 ? 'rising-reserve-full' : 'top-n-full') }))
    .sort((a, b) => (b.expGpDay || 0) - (a.expGpDay || 0));

  return { survivors, excluded };
}
