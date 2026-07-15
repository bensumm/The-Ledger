/**
 * gatecandidates.mjs — the screen's pure candidate-selection + survival doctrine (P1).
 *
 * Extracted from screen-flip-niches.mjs (GC1 first pulled `gateCandidates`/`risingPoolFloor` out as exported,
 * threshold-driven functions behind screen-flip-niches.mjs's invocation guard; P1 relocated the whole
 * pool-selection + post-fetch-doctrine cluster HERE so it is node-importable + fixture-testable with
 * synthetic data and no live network). The LOGIC is byte-identical to the pre-P1 inline screen-flip-niches.mjs
 * code — this is a pure MOVE. screen-flip-niches.mjs imports everything back and calls it exactly where it did.
 *
 * The four concerns that live here (all pure, no CLI/network/fs state):
 *   1. gateCandidates(mode, ctx, thresholds) — the PRE-FETCH gate stack (two-sided liquidity OR
 *      gp-flow, price window, rising-pool noise floor, per-mode step-3 edge, 500k attention floor).
 *      Threshold-driven so fixtures drive it; defaults to DEFAULT_THRESHOLDS (the CLI defaults). P4c:
 *      the per-mode step-3 EDGE + the rising-pool rule + the rank mode are now DECLARATIVE strategy
 *      specs (js/flip-niches.mjs) this looks up by `mode` — byte-identical, but a new niche registers a
 *      spec instead of adding an `if (mode === …)` branch here.
 *   2. rankAndSlice(mode, cand, dailySeries, opts) + proxyDrift + softFactor — the fetch-pool
 *      ORDERING (never displayed): proxy-drift deprioritizes probable fallers (softFactor), a bounded
 *      "rising reserve" front-loads the highest-proxy risers (the absorbed `rising` niche, Steps 3+4),
 *      thin gp-flow qualifiers get a bounded reserve, then TOP-N slice.
 *   3. surviveMode(mode, row, phase, opts) — the POST-FETCH doctrine renderMode applies to each
 *      fetched row: falling-exclusion (+ --phase-rescue basing rescue), the scalp falling-confirm, and
 *      overnight-posture filters. Returns {keep, discardReason, rescued}; discardReason maps 1:1 to
 *      renderMode's `disc` counters (falling / notFalling / posture), and `rescued` drives
 *      the disc.rescued counter (which increments on rescue even if a later gate drops the row).
 *   4. expUnits — the shared throughput predicate the above and the watchlist path reuse.
 *
 * PIN NOTE (P1 → re-pinned at P5): surviveMode encodes the CURRENT pre-amendment falling-exclusion
 * behavior (falling ⇒ dropped unless --phase-rescue basing). Ben's 2026-07-08 falling amendment
 * lands at P5 — the fixtures here will change then, and that diff IS the doctrine change.
 *
 * ALL numeric math (the spec edges' tax, overnightStaleRisk, median) is the shared impl (tax lives in
 * flip-niches.mjs's edge functions now, imported from js/money-math.js there), so the numbers stay
 * byte-identical to screen-flip-niches.mjs / the app. No live data in the tests (CLAUDE.md rule 4).
 */
import { overnightStaleRisk, OVERNIGHT_SPAN_H } from '../../js/quotecore.js';
import { median } from './cli.mjs';
// P5 — the value niche's term-structure gate + rank (js/valuescreen.mjs, pure). gateCandidates routes
// a `gate:'value'` spec here instead of the shared band/spread liquidity+edge stack.
import { termStructure } from '../../js/termstructure.mjs';
import { valueRanges, valueScore, valueGate, valueTier, VALUE_MIN_PRICE } from '../../js/valuescreen.mjs';
// P4c: the per-mode step-3 EDGE + the pool/rank rules are now DECLARATIVE strategy specs in
// js/flip-niches.mjs. gateCandidates/rankAndSlice look up FLIP_NICHES[mode] and call spec.edge / read
// spec.rank / spec.confirm instead of branching on the niche name — byte-identical behavior
// (the P1 replay goldens pin it), but a new niche (P5 scalp/value) registers a spec instead of editing
// this file. `tax` moved with the edge functions into flip-niches.mjs.
import { FLIP_NICHES } from '../../js/flip-niches.mjs';

// DEFAULT_THRESHOLDS: the gate-stack constants at their CLI defaults (screen-flip-niches.mjs builds its own
// THRESHOLDS from parsed args and passes it explicitly; this default serves fixtures / import callers
// that don't supply one). Values mirror screen-flip-niches.mjs's `A.<flag> != null ? … : <default>` fallbacks.
export const DEFAULT_THRESHOLDS = {
  FLOOR: 3500, MIN_ROI: 1.5, MIN_PRICE: 0, MAX_PRICE: 45e6, MIN_NET_GP: 100_000,   // PLAN-VOL24 step 2: FLOOR 50 → 3500 (mirrors screen-flip-niches.mjs; count-matched to the corrected rolling-24h volume)
  // Bar D (Ben 2026-07-09): the traded-band gate reads tradedWin (density) + sawLow/sawHigh (two-sided),
  // NOT the same-5m-window active5m count that structurally culled big tickets. MIN_TRADED = dense floor,
  // MIN_TRADED_THIN = the relaxed floor for gp-flow big tickets (2 ⇒ a lone spike still fails).
  MIN_TRADED: 6, MIN_TRADED_THIN: 2, MIN_GPD: 500_000, GP_FLOOR: 4_500_000_000,   // PLAN-VOL24 step 2: GP_FLOOR 250m → 4.5b (corrected gp-flow); MIN_GPD KEPT at 500k (Ben — real NET-throughput floor)
  // P5 value niche — the 500k gp/day THROUGHPUT floor is REPLACED by valuescreen's after-tax
  // cycle-amplitude floor (a slow-hold has low daily velocity but big cycle appreciation). What value
  // relaxes is the gp/day THROUGHPUT bar, NOT the two-sided UNIT-liquidity bar: you still have to exit a
  // (large-ish) held position at the cycle top, so the item needs a genuine two-sided market. Ben 2026-
  // 07-09: raised 20 → 50 (= the base FLOOR) after the value scan surfaced 1/d–6/d untradeable rows
  // (Adamant halberd 6/d, Gloves of silence 1/d) — a hold you can't exit isn't a hold. PLACEHOLDER
  // (rule 4). Two-sided liquidity (hpv>0 && lpv>0) stays non-negotiable.
  // PLAN-VOL24 step 2: 50 → 3500, tracking the base FLOOR against the CORRECTED rolling-24h volume (the
  // /24h endpoint under-read ~10–27×, so the old 50 was ~18× too loose in corrected units).
  VALUE_LIQ_FLOOR: 3500,
  // VALUE_CAP_GP: the per-position capital cap that bounds valueScore's deployable-units (bankroll leg). NOT
  // a fixed doctrine number — screen-flip-niches.mjs derives it from --capital ÷ --slots (Ben's current capital spread
  // across the positions we'd hold). This default (≈ 100m ÷ 5 slots) serves fixtures / import callers that
  // don't supply one. PLACEHOLDER (rule 4).
  VALUE_CAP_GP: 20_000_000,
  // PLAN-CAPITAL-THROUGHPUT (Ben 2026-07-14) — the band/churn expGpDay is now CAPITAL-AWARE. THROUGHPUT_CAP_GP
  // is the FULL derived deployable pool (NOT ÷slots — unlike VALUE_CAP_GP): the attention floor asks "if I
  // dedicate everything to this ONE lane, can it net MIN_GPD/day?"; if not, skip. THROUGHPUT_MODE 'capital'
  // (default) applies the affordable-units cap in expUnits; 'legacy' restores the pre-change capital-blind
  // value (escape hatch + the --stats old-vs-new repro). A null cap (no cash anchor / fixtures / import
  // callers) degrades to legacy, so DEFAULT_THRESHOLDS is byte-identical to pre-change behavior. screen-flip-niches.mjs
  // sets THROUGHPUT_CAP_GP from the derived deployablePool after it re-derives the anchor.
  THROUGHPUT_MODE: 'capital', THROUGHPUT_CAP_GP: null,
};
// Default rank/slice sizing (screen-flip-niches.mjs's --thin-reserve / --top defaults).
export const THIN_RESERVE_DEFAULT = 6;
// RISING_RESERVE_DEFAULT (Steps 3+4) — fetch-pool slots reserved for the highest-proxyDrift risers, the
// absorbed `rising` niche mechanism (see rankAndSlice). Small + bounded (a named PLACEHOLDER, rule 4).
export const RISING_RESERVE_DEFAULT = 6;
export const TOP_DEFAULT = 40;
// P5 — the value niche's HARD top-N (§F flood control: the gated pool WILL be large; never dump it).
export const VALUE_TOP_DEFAULT = 25;

// P6c — empty-result sub-floor fallback sizing + honesty cap (Ben, 2026-07-09: when a niche's floors
// leave ZERO candidates, re-run BENEATH the floor and show the best few HONESTLY LABELED — never
// silently lower the bar). Both are named PLACEHOLDERS (rule 4): the cap count is a small "best few",
// and the grade ceiling makes a sub-floor row structurally unable to print a headline grade (it did
// NOT clear the attention/liquidity bar, so it must never read like a qualified pick).
export const SUBFLOOR_TOP = 5;
export const SUBFLOOR_GRADE_CAP = 'C';

// realistic expected units/day: buy-limit refreshes ~every 4h → 6 limits/day, capped at a 10% share
// of the limiting-side daily volume. Null limit → volume share only.
// PLAN-CAPITAL-THROUGHPUT (Ben 2026-07-14): optional PER-WINDOW capital cap — `capPerWindow` = units the
// deployable bankroll affords in ONE 4h buy-window (deployablePool / price). It answers Ben's "for THIS
// price, how many can I realistically capture" — the old two caps measured MARKET capacity (limit +
// volume share), capital-blind. The cap enters INSIDE the ×6 (not as a separate whole-day cap) because
// churn RECYCLES intra-day: you deploy a tranche, it sells within the window, and the freed capital
// rebuys next window — so the binding question is "can I afford ONE buy-limit tranche?", not "can I
// afford a whole day's accumulation at once?". (A whole-day/turns=1 cap wrongly HID fast churn Ben trades
// — anglerfish/sanfew — because it under-credited the intra-day recycle; per-window fixes that.)
// SELF-TARGETING: when one tranche is affordable (min(limit, capPerWindow) == limit) the result is
// byte-identical to legacy (soul rune, anglerfish, chins — never hidden). It binds ONLY where even a
// single buy-limit tranche costs more than the pool — the genuinely capital-constrained big/expensive
// positions, exactly the intended demotion. null capPerWindow → legacy (no capital term), so every
// existing caller (overnight, watchlist, fixtures) is byte-for-byte unchanged.
export const expUnits = (limit, volDay, capPerWindow = null) => {
  const vShare = 0.10 * (volDay || 0);
  if (capPerWindow == null) return limit != null ? Math.min(limit * 6, vShare) : vShare;   // legacy — byte-identical
  const perWindow = limit != null ? Math.min(limit, capPerWindow) : capPerWindow;          // + per-window affordability
  return Math.min(perWindow * 6, vShare);
};
// COD-2 (2026-07-10) — realistic expected units accumulated over the OVERNIGHT window (the /overnight
// §6 accumulation sizing, previously hand-computed in the skill as min(buyLimit×2, 8/24×0.10×volDay)
// with a PROSE plea to "keep the constants aligned with expUnits"). This IS that formula, but derived
// by SCALING expUnits to the OVERNIGHT_SPAN_H window so the 6-limits/day (24/4h) and 10% volume-share
// constants can NEVER drift from the day figure: min(a,b)·k = min(a·k, b·k), so multiplying the whole
// expUnits result by SPAN/24 is exact — min(limit·6, 0.10·volDay)·(8/24) = min(limit·2, 8/24·0.10·volDay).
// Buy limit refreshes ~every 4h → 2 windows in an 8h span; the volume-share leg prorates flat across the
// span. UPPER BOUND (assumes fills at your price, no fill-probability) — screen-flip-niches.mjs labels it as such.
export const expUnitsOvernight = (limit, volDay) => expUnits(limit, volDay) * OVERNIGHT_SPAN_H / 24;

// --- regime proxy off loadDaily's bulk {ts,mid} series: SAME 3d-vs-prior-~2wk shape as quotecore's
// regimeDrift, but computed from the whole-market archive and NEVER displayed — it only ORDERS the
// fetch pool so we spend the expensive per-item fetches on likely survivors. The real regime (and the
// falling-exclusion + rising-confirm) is still the post-fetch computeQuote. ---
export function proxyDrift(points) {
  if (!points || points.length < 2) return null;
  const tEnd = points[points.length - 1].ts;
  const recentCut = tEnd - 3 * 86400, priorCut = tEnd - 17 * 86400;
  const recent = [], prior = [];
  for (const p of points) { if (p.mid == null) continue; if (p.ts >= recentCut) recent.push(p.mid); else if (p.ts >= priorCut) prior.push(p.mid); }
  if (recent.length < 4 || prior.length < 6) return null;       // too little archive → unknown (fall back to raw rank)
  const rm = median(recent), pm = median(prior);
  if (!rm || !pm) return null;
  return (rm - pm) / pm * 100;
}
// PLACEHOLDER fetch-pool ordering weight — deprioritize probable fallers (they'd be discarded
// post-fetch anyway). Chunk-C study sets these numbers; null (unknown regime) = mild trust.
export const softFactor = drift => drift == null ? 0.7 : drift <= -8 ? 0.1 : drift <= -5 ? 0.5 : 1;

// --- gate stack + mode-specific step-3 edge, ranked by realistic gp/day (picks the fetch pool) ---
// GC1: exported + threshold-driven. The gate LOGIC is byte-identical to before — every constant it
// used to close over is now a named field of the `t` thresholds object (default DEFAULT_THRESHOLDS),
// so fixtures can drive the whole stack (two-sided-liquidity OR gp-flow, price window, rising-pool
// floor, per-mode edge, 500k attention floor) without CLI/network state. `expUnits` and `tax` are pure.
export function gateCandidates(mode, ctx, t = DEFAULT_THRESHOLDS) {
  const spec = FLIP_NICHES[mode];
  if (!spec) throw new Error('gateCandidates: unknown strategy mode "' + mode + '"');
  if (spec.gate === 'value') return gateValueCandidates(ctx, t);   // P5 — the term-structure value gate
  const { v24, map, bands } = ctx;
  const cand = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity gate (shared, NON-NEGOTIABLE)
    const limitVol = Math.min(hpv, lpv);
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid < t.MIN_PRICE || mid > t.MAX_PRICE) continue;   // price window (shared)
    // liquidity: raw UNIT floor OR the gp-flow floor (thin big-ticket path). `thin` = qualified via
    // gp-flow only (below the unit floor) → honestly marked downstream (grade cap + tooltip).
    const thin = limitVol < t.FLOOR;
    if (thin && limitVol * mid < t.GP_FLOOR) continue;    // fails BOTH the unit floor and the gp-flow floor
    const limit = map.byId[id]?.limit ?? null;

    // --- step 3: the DECLARATIVE spec's edge — P4c re-expressed the old inline per-mode branch as
    // flip-niches.mjs edge functions (byte-identical: a `continue` is now a `return null`). Returns the
    // after-tax { modeNet, modeRoi, activeWin } or null when the item fails this niche's edge/gate. ---
    const edge = spec.edge({ avgHigh, avgLow, band: bands ? bands[id] : undefined, limitVol, limit, thin }, t);
    if (!edge) continue;
    const { modeNet, activeWin } = edge;
    if (modeNet <= 0) continue;
    // PLAN-CAPITAL-THROUGHPUT (Ben 2026-07-14): expGpDay is CAPITAL-AWARE — the PER-WINDOW buy is capped by
    // what the deployable bankroll affords one tranche of at this price (capPerWindow = pool / mid; mid is
    // the gp-flow price proxy this gate already uses at line ~155). THROUGHPUT_MODE 'legacy' or a null cap
    // restores the capital-blind value. expGpDayLegacy is carried on the candidate so screen-flip-niches.mjs can log it
    // as a shadow field (suggestions.jsonl) → --stats/F1 diff old-vs-new surfacing. THIN gp-flow big tickets
    // stay EXEMPT from the floor (unchanged — they ride the thin reserve; folding capital into the thin path
    // is a documented follow-up in PLAN-CAPITAL-THROUGHPUT).
    // A null/absent OR ≤0 pool degrades to capital-blind legacy (a 0 pool is a failed/empty cash anchor —
    // degrade to legacy rather than nuke the whole screen to expGpDay 0; the `&&` truthiness handles both).
    const capPerWindow = (t.THROUGHPUT_MODE !== 'legacy' && t.THROUGHPUT_CAP_GP && mid > 0)
      ? t.THROUGHPUT_CAP_GP / mid : null;
    const expGpDay = Math.round(expUnits(limit, limitVol, capPerWindow) * modeNet);
    const expGpDayLegacy = Math.round(expUnits(limit, limitVol) * modeNet);
    // 500k/day attention floor — pre-rating, so no grade ever advertises a sub-floor row. Thin gp-flow
    // qualifiers are EXEMPT (a unit/gp-day count mismeasures them — see MIN_GPD note).
    if (!thin && expGpDay < t.MIN_GPD) continue;
    cand.push({ id, limitVol, mid, limit, expGpDay, expGpDayLegacy, activeWin, thin });
  }
  return cand;
}

/* P5 — the VALUE niche's own candidate gate (PLAN-VALUE §A). Keeps the two-sided liquidity gate + the
   price window; REPLACES the 500k gp/day throughput floor with valuescreen's after-tax cycle-amplitude
   floor, LOWERS the liquidity floor (VALUE_LIQ_FLOOR — hold for days–weeks needs eventual exitability,
   not fast churn), and rejects a decay/downtrend KNIFE via the term structure. `ctx.daily` is the bulk
   daily-mid archive (screen-flip-niches.mjs's loadDaily) already loaded at gate time — the term structure is
   computed from it with NO per-item fetch. Each survivor carries its valueScore + valueRanges + tier so
   rankAndSlice can hard top-N by score (§F) and renderMode can print the term-structure row. */
function gateValueCandidates({ v24, map, bands, daily }, t = DEFAULT_THRESHOLDS) {
  const floorVol = t.VALUE_LIQ_FLOOR ?? DEFAULT_THRESHOLDS.VALUE_LIQ_FLOOR;
  const cand = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity (KEPT — must be exitable)
    const limitVol = Math.min(hpv, lpv);
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid < Math.max(t.MIN_PRICE, VALUE_MIN_PRICE) || mid > t.MAX_PRICE) continue;   // price window + value capital-deployment floor
    const thin = limitVol < floorVol;                       // LOWERED value liquidity floor OR gp-flow
    if (thin && limitVol * mid < t.GP_FLOOR) continue;
    const ts = termStructure(daily && daily[id]);            // 1/3/7/14/28d structure (no per-item fetch)
    const vr = valueRanges(ts, mid);                        // mid = live proxy pre-fetch
    const g = valueGate(vr, {});                            // amplitude floor + term-structure knife guard
    if (!g.pass) continue;
    const limit = map.byId[id]?.limit ?? null;
    cand.push({ id, limitVol, mid, limit, thin, valueScore: valueScore(vr, { limitVol, limit, capGp: t.VALUE_CAP_GP ?? null }), valueRanges: vr, tier: valueTier(vr) });
  }
  return cand;
}

/* --- P6c: empty-result sub-floor fallback --------------------------------------------------------
   TRIGGER (screen-flip-niches.mjs owns it): a niche whose gateCandidates() came back EMPTY at the configured
   floors. This helper then re-runs the SAME gate stack (no forked logic — it just calls
   gateCandidates with relaxed thresholds) down a two-step ladder to find WHICH floor emptied it:
     1. 'min-gpd'    — relax ONLY the attention floor (MIN_GPD → 0). If candidates appear, the 500k
                       gp/day bar was the emptier; everything shown still cleared liquidity + edge.
     2. 'liquidity'  — ALSO relax the gp-flow floor (GP_FLOOR → 0), which admits every TWO-SIDED item
                       below the unit floor as `thin` (the existing thin path — grade cap, tooltip).
                       The two-sided gate itself (hpv>0 && lpv>0) is NON-NEGOTIABLE and never relaxed,
                       and the per-niche EDGE (min-roi / churn volume / scalp margin) is the THESIS,
                       not a floor — it is never relaxed either.
   Returns { cand, relaxed, floorDesc } for the first ladder step that un-empties the pool, or null
   when even the fully-relaxed gate finds nothing (the market, not the floors, is empty — the screen
   keeps its normal `_none_` output). The VALUE niche is out of scope: its floors are its own
   term-structure amplitude gate (+ §F flood control with an admitted-vs-shown footer), not the
   MIN_GPD/GP_FLOOR pair this ladder relaxes — and it's provisional/off-by-default (n≈0). */
export function subFloorFallback(mode, ctx, t = DEFAULT_THRESHOLDS) {
  const spec = FLIP_NICHES[mode];
  if (!spec || spec.gate === 'value') return null;
  const ladder = [
    { key: 'min-gpd',
      floorDesc: `the ${(t.MIN_GPD / 1e3).toLocaleString()}k gp/day attention floor (--min-gpd)`,
      relax: { ...t, MIN_GPD: 0 } },
    { key: 'liquidity',
      floorDesc: `the liquidity floor (${t.FLOOR}/day units OR ${(t.GP_FLOOR / 1e6).toLocaleString()}m gp-flow) — even with the attention floor relaxed`,
      relax: { ...t, MIN_GPD: 0, GP_FLOOR: 0 } },
  ];
  for (const step of ladder) {
    const cand = gateCandidates(mode, ctx, step.relax);
    if (cand.length) return { cand, relaxed: step.key, floorDesc: step.floorDesc };
  }
  return null;
}
// The one honest label every sub-floor surface carries (spec wording): names WHICH floor was relaxed
// and its configured value. A reader must never mistake a sub-floor row for a qualified one.
export function subFloorLabel(fb) {
  return `sub-floor — shown because nothing cleared ${fb.floorDesc}; relaxed (${fb.relaxed}) for this table only`;
}

// Rank the gated pool and take the top-N to fetch. The proxy (from the bulk daily archive) orders
// WHICH items we spend the expensive per-item fetch on — deprioritizing probable fallers (softFactor)
// and front-loading the highest-proxy risers into a bounded reserve so a riser isn't buried below flats
// (the absorbed `rising` mechanism, Steps 3+4). `opts.thinReserve`/`opts.risingReserve`/`opts.top`
// default to screen-flip-niches.mjs's defaults (screen passes the CLI values explicitly); fixtures can drive them.
export function rankAndSlice(mode, cand, dailySeries, { thinReserve = THIN_RESERVE_DEFAULT, risingReserve = RISING_RESERVE_DEFAULT, top = TOP_DEFAULT } = {}) {
  // P5 value niche (§F): rank the WHOLE gated pool by the composite valueScore and take a HARD top-N.
  // The pool is expected large; the shortlist is bounded (renderValueMode prints admitted-vs-shown).
  if (FLIP_NICHES[mode] && FLIP_NICHES[mode].gate === 'value') {
    return cand.slice().sort((a, b) => (b.valueScore - a.valueScore) || (a.id - b.id)).slice(0, top);
  }
  for (const c of cand) c.proxyDrift = proxyDrift(dailySeries[c.id]);
  // Thin gp-flow qualifiers are held OUT of the main ranking and given a bounded RESERVE instead.
  // Two reasons: (1) their intraday band is priced off a thinly-traded 2h window, so bandNet is noisy
  // and often inflated (the band-top-artifact lesson) → a raw-expGpDay rank lets them CROWD OUT genuine
  // liquid flips; (2) the design intent is "surface the big ticket honestly, don't let it take over".
  // So the main pool is non-thin only; thin items get up to thinReserve slots, ranked by real gp-flow
  // (limitVol×mid, not the noisy bandNet). Net effect: the non-thin survivor set is materially unchanged
  // (gp-flow ADDS ≤ thinReserve rows/niche, doesn't reshuffle).
  const nonThin = cand.filter(c => !c.thin);
  // The shipped fetch-pool order: realistic expGpDay softened DOWN for probable fallers (softFactor).
  // (The deleted `rising` niche's proxy-first full-pool sort is gone — its mechanism is the reserve below.)
  nonThin.sort((a, b) => (b.expGpDay * softFactor(b.proxyDrift)) - (a.expGpDay * softFactor(a.proxyDrift)));
  // RISING RESERVE (Steps 3+4 — the absorbed `rising` niche mechanism). The deleted rising niche's ONE
  // real edge was proxy-first fetch-pool ordering: it surfaced probable RISERS that band's expGpDay order
  // can bury below flats. To keep that false-negative protection without a whole niche, reserve up to
  // `risingReserve` of the top-N fetch slots for the highest positive-proxyDrift non-thin candidates —
  // exactly mirroring the thin reserve (a small, bounded PREPEND, ranked by its own key; it ADDS ≤
  // risingReserve high-proxy rows to the front, it does not reshuffle the velocity pool). Bounded + small
  // by design; a riser already high on expGpDay is a no-op (it was already at the front).
  const risers = nonThin.filter(c => (c.proxyDrift ?? 0) > 0).sort((a, b) => b.proxyDrift - a.proxyDrift).slice(0, risingReserve);
  const riserIds = new Set(risers.map(c => c.id));
  const rest = nonThin.filter(c => !riserIds.has(c.id));
  const reserved = cand.filter(c => c.thin).sort((a, b) => (b.limitVol * b.mid) - (a.limitVol * a.mid)).slice(0, thinReserve);
  return [...reserved, ...risers, ...rest].slice(0, top);
}

// --- post-fetch doctrine: does this fetched+quoted row SURVIVE its niche/posture? ------------------
// Extracted verbatim from renderMode's inline loop (P1). Returns {keep, discardReason, rescued}:
//   - keep=false ⇒ discardReason ∈ {'falling','notRising','breakdown','posture'}, mapping 1:1 to
//     renderMode's `disc` counters. The caller does `disc[discardReason]++`.
//   - rescued=true ⇒ a faller that --phase-rescue kept because it has decayed to a `basing` shape.
//     It increments disc.rescued AT THE POINT OF RESCUE (before the rising/posture gates), exactly
//     as the original did — so rescued is returned on EVERY branch after the rescue, whether the row
//     is ultimately kept or dropped by a later gate. The caller: `if (rescued) disc.rescued++`.
// opts: { phaseRescue, posture, thin, series5m } — series5m is THIS item's raw 5m series (for the
// overnight staleness read), i.e. renderMode's `series5m && series5m.get(id)`.
// P5 — the falling doctrine is now PER-SPEC (Ben's 2026-07-08 amendment: a faller is not necessarily a
// poor buy — "we cannot judge falling without its history and typical fluctuations"). surviveMode reads
// spec.falling instead of a hardcoded global exclusion:
//   'exclude'     — falling ⇒ dropped (unless --phase-rescue basing). The four original niches keep
//                   this → byte-identical (the replay goldens pin it). 'knife-guard' (value) also lands
//                   here defensively, but value never reaches surviveMode — its knife guard is valueGate.
//   'accept'      — falling is a VALID candidate (scalp EXPECTS a falling wide band); not dropped for
//                   the regime alone. Its intraday tripwire lives in offerVerdict/the path engine.
//                   Step 5 (2026-07-09): scalp goes further — a scalp-mode CONFIRM below REQUIRES falling
//                   (a non-falling scalp is a band flip → dropped 'notFalling'), so scalp = fallers only.
export function surviveMode(mode, row, phase, opts = {}) {
  const { phaseRescue = false, posture = 'active', thin = false, series5m = null } = opts;
  const spec = FLIP_NICHES[mode];
  const fallingDoctrine = spec ? spec.falling : 'exclude';
  let rescued = false;
  if (row.falling && fallingDoctrine !== 'accept') {
    if (phaseRescue && phase && phase.phase === 'basing') rescued = true;   // decayed off a spike, lows flattened
    else return { keep: false, discardReason: 'falling', rescued: false };  // screen rule: never surface fallers
  }
  // Post-fetch CONFIRM — SPEC-DRIVEN (P4c → N2, 2026-07-14: was `mode === 'scalp'` plus a dead
  // `mode === 'rising'` branch for the deleted niche; `spec.confirm` was declared+validated but unread).
  // A spec that declares `confirm: 'falling'` (scalp) positively REQUIRES a falling regime:
  // spec.falling='accept' stops the exclusion above from dropping the faller, and this confirm ALSO drops a
  // NON-falling row ('notFalling') — a scalp on a non-falling item is just a band flip band already owns.
  // Its ROI-bind (a fresh wide band clearing −ROI once tax is paid) is caught by renderMode's Step-2 net>0
  // surface gate, so it isn't re-checked here.
  if (spec && spec.confirm === 'falling' && !row.falling) return { keep: false, discardReason: 'notFalling', rescued };
  if (posture === 'overnight') {
    // overnight posture: only a confident, patient, non-thin edge that won't be stale by morning.
    if (thin) return { keep: false, discardReason: 'posture', rescued };                                      // no thin fast-lane
    if (!(row.regimeLabel === 'flat' || row.rising)) return { keep: false, discardReason: 'posture', rescued }; // confident flat/rising only (drops unknown)
    if (!row.reliable) return { keep: false, discardReason: 'posture', rescued };                              // needs a trustworthy band
    if (row.mom === 'breakdown') return { keep: false, discardReason: 'posture', rescued };                    // no active pullback overnight
    if (overnightStaleRisk(series5m, row.optBuy)) return { keep: false, discardReason: 'posture', rescued };   // stale/underwater by morning
  }
  return { keep: true, discardReason: null, rescued };
}
