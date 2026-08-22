/**
 * gatecandidates.mjs — the screen's pure candidate-selection + survival doctrine (P1).
 *
 * The pool-selection + post-fetch-doctrine cluster lives HERE (out of screen-flip-niches.mjs) so it is
 * node-importable + fixture-testable with synthetic data and no live network. screen-flip-niches.mjs
 * imports it all back and calls it where the logic would otherwise sit inline.
 *
 * The four concerns that live here (all pure, no CLI/network/fs state):
 *   1. gateCandidates(mode, ctx, thresholds) — the PRE-FETCH gate stack (two-sided liquidity OR
 *      gp-flow, price window, rising-pool noise floor, per-mode step-3 edge, MIN_GPD attention floor).
 *      Threshold-driven so fixtures drive it; defaults to DEFAULT_THRESHOLDS (the CLI defaults). P4c:
 *      the per-mode step-3 EDGE + the rising-pool rule + the rank mode are now DECLARATIVE strategy
 *      specs (js/flip-niches.mjs) this looks up by `mode` — byte-identical, but a new niche registers a
 *      spec instead of adding an `if (mode === …)` branch here.
 *   2. rankAndSlice(mode, cand, dailySeries, opts) + proxyDrift + softFactor — the fetch-pool
 *      ORDERING (never displayed): proxy-drift deprioritizes probable fallers (softFactor), a bounded
 *      "rising reserve" front-loads the highest-proxy risers (the absorbed `rising` niche, Steps 3+4),
 *      thin gp-flow qualifiers get a bounded reserve, then TOP-N slice, and `watchReserved` (shared with
 *      admission.mjs's default path) prepends a BOUNDED slice of watchlist.json items the slice cut.
 *   3. surviveMode(mode, row, phase, opts) — the POST-FETCH doctrine renderMode applies to each
 *      fetched row: falling-exclusion (+ --phase-rescue basing rescue), the scalp falling-confirm, and
 *      overnight-posture filters. Returns {keep, discardReason, rescued}; discardReason maps 1:1 to
 *      renderMode's `disc` counters (falling / notFalling / posture), and `rescued` drives
 *      the disc.rescued counter (which increments on rescue even if a later gate drops the row).
 *   4. expUnits — the shared throughput predicate the above and the watchlist path reuse.
 *
 * FALLING DOCTRINE (P5): PER-SPEC, never a global exclusion — a faller is not necessarily a poor buy
 * ("we cannot judge falling without its history and typical fluctuations"). surviveMode reads
 * `spec.falling`; its header carries the per-value semantics and the held-item bypass.
 *
 * ALL numeric math (the spec edges' tax, overnightStaleRisk, median) is the shared impl (tax lives in
 * flip-niches.mjs's edge functions now, imported from js/money-math.js there), so the numbers stay
 * byte-identical to screen-flip-niches.mjs / the app. No live data in the tests (CLAUDE.md rule 4).
 */
import { overnightStaleRisk, OVERNIGHT_SPAN_H } from '../../../js/quotecore.js';
import { REFILL_WINDOWS_PER_DAY, ACTIONABLE_WINDOWS_PER_DAY } from '../../../js/desk-cadence.mjs';   // the ONE home for the windows/day assumption (re-exported below)
import { median } from '../render/cli.mjs';
// P5 — the value niche's term-structure gate + rank (js/valuescreen.mjs, pure). gateCandidates routes
// a `gate:'value'` spec here instead of the shared band/spread liquidity+edge stack.
import { termStructure } from '../../../js/termstructure.mjs';
import { valueRanges, valueScore, valueGate, valueTier, VALUE_MIN_PRICE } from '../../../js/valuescreen.mjs';
// A2 (PLAN-AMPLITUDE-SCAN) — the amplitude niche's Stage-1 pre-fetch proxy + its price window.
// gateCandidates routes a `gate:'amplitude'` spec to gateAmplitudeCandidates (below), mirroring the
// `gate:'value'` seam. Stage 2 (the exact amplitudeGate off windowStats) runs post-fetch in renderAmplitudeMode.
import { amplitudeProxy, AMP_MIN_PRICE, AMP_MAX_PRICE, AMP_STAGE1_MIN_PCT } from '../../../js/amplitudescreen.mjs';
// RF2 (PLAN-REVERSE-FLIP) — the reverse-flip niche's INVERTED regime gate + rebuy-leg-weighted liquidity
// check (js/reverseflip.mjs, pure). gateCandidates routes a `gate:'reverse'` spec to
// gateReverseFlipCandidates (below), mirroring the `gate:'value'`/`gate:'amplitude'` seams — but its pool is
// the caller-assembled OWNED-item set (owned-items.json keep ∪ hold-thesis reverseFlip:true), NOT the v24
// fetch universe, so it takes that pool + a per-id context map off `ctx` rather than iterating v24.
import { reverseFlipGate } from '../../../js/reverseflip.mjs';
// P4c: the per-mode step-3 EDGE + the pool/rank rules are now DECLARATIVE strategy specs in
// js/flip-niches.mjs. gateCandidates/rankAndSlice look up FLIP_NICHES[mode] and call spec.edge / read
// spec.rank / spec.confirm instead of branching on the niche name — byte-identical behavior
// (the P1 replay goldens pin it), but a new niche (P5 scalp/value) registers a spec instead of editing
// this file. `tax` moved with the edge functions into flip-niches.mjs.
import { FLIP_NICHES } from '../../../js/flip-niches.mjs';
// PLAN-LANE-ADMISSION Chunk B — the STRUCTURAL admission gate (value ∧ thin ∧ notional + gear/churn
// volLane), an alternate iterator with the SAME callback shape as eachLiquidCandidate. Routed via
// `t.GATE === 'structural'` (default undefined → legacy → byte-identical). Additive behind the flag;
// see structural-admission.mjs's header for the edge-blind-admission scope + the naming-collision note.
import { eachStructuralCandidate, DEFAULT_STRUCTURAL } from './structural-admission.mjs';

// DEFAULT_THRESHOLDS: the gate-stack constants at their CLI defaults (screen-flip-niches.mjs builds its own
// THRESHOLDS from parsed args and passes it explicitly; this default serves fixtures / import callers
// that don't supply one). Values mirror screen-flip-niches.mjs's `A.<flag> != null ? … : <default>` fallbacks.
export const DEFAULT_THRESHOLDS = {
  FLOOR: 3500, MIN_ROI: 1.5, MIN_PRICE: 0, MAX_PRICE: 45e6, MIN_NET_GP: 100_000,   // PLAN-VOL24 step 2: FLOOR 50 → 3500 (mirrors screen-flip-niches.mjs; count-matched to the corrected rolling-24h volume)
  // Bar D: the traded-band gate reads tradedWin (density) + sawLow/sawHigh (two-sided), NOT the
  // same-5m-window active5m count that structurally culled big tickets. MIN_TRADED = dense floor,
  // MIN_TRADED_THIN = the relaxed floor for gp-flow big tickets (2 ⇒ a lone spike still fails).
  // MIN_GPD is PAIRED with the 6→2 refill haircut and meaningless without it: cutting churn's multiplier
  // ~3× while holding the old doubled floor would make the board STRICTER on churn, not rebalanced. Big
  // tickets are volume-bound so the haircut misses them entirely — the halved floor is what actually lets
  // them surface. EXPERIMENTAL, tune freely.
  MIN_TRADED: 6, MIN_TRADED_THIN: 2, MIN_GPD: 250_000, GP_FLOOR: 4_500_000_000,   // PLAN-VOL24 step 2: GP_FLOOR 250m → 4.5b (corrected gp-flow)
  // P5 value niche — the MIN_GPD gp/day THROUGHPUT floor is REPLACED by valuescreen's after-tax
  // cycle-amplitude floor (a slow-hold has low daily velocity but big cycle appreciation). What value
  // relaxes is the gp/day THROUGHPUT bar, NOT the two-sided UNIT-liquidity bar: you still have to exit a
  // (large-ish) held position at the cycle top, so the item needs a genuine two-sided market: at a 20/d
  // floor the value scan surfaced untradeable 1/d–6/d rows (Adamant halberd 6/d, Gloves of silence 1/d),
  // and a hold you can't exit isn't a hold. So this TRACKS the base FLOOR, COUNT-MATCHED to the CORRECTED
  // rolling-24h volume distribution — anchored empirically, NOT off any "/24h under-reads ~10–27×" ratio
  // (that ratio measures ~1.0×; see marketfetch.mjs's loadAll24hRolling header). PLACEHOLDER (rule 4).
  // Two-sided liquidity (hpv>0 && lpv>0) stays non-negotiable.
  VALUE_LIQ_FLOOR: 3500,
  // VALUE_CAP_GP: the per-position capital cap that bounds valueScore's deployable-units (bankroll leg). NOT
  // a fixed doctrine number — screen-flip-niches.mjs derives it from --capital ÷ --slots (Ben's current capital spread
  // across the positions we'd hold). This default (≈ 100m ÷ 5 slots) serves fixtures / import callers that
  // don't supply one. PLACEHOLDER (rule 4).
  VALUE_CAP_GP: 20_000_000,
  // PLAN-CAPITAL-THROUGHPUT — the band/churn expGpDay is CAPITAL-AWARE. THROUGHPUT_CAP_GP
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
// WATCH_RESERVE_DEFAULT (PP-R) — fetch-pool slots reserved for repo-root watchlist.json items on the
// BAND stack (band/churn/scalp — every `gate:'band'` spec). The amplitude gate has had a watch reserve
// since F-B; the band path had NONE, so a watchlisted-but-not-held item ranking below the
// expGpDay×softFactor cutoff never reached a NICHE TABLE.
//
// ⚠ SCOPE — what was lost was the niche row, NOT the item. runWatchlist quotes, grades and publishes
// every watchlist id on every scan (pre-fetching any the niche pools missed), so the item was always
// priced and always visible in its own section. What it missed is everything keyed to the niche lane:
// the churn/band partition, the Path-A sort, the per-niche validator stack, the digest, and its
// per-niche screen.json row. Do not restate this as "the item was never priced" — that is false and the
// watchlist section disproves it.
//
// BOUNDED, unlike amplitude's — the bound caps a prepend whose only structural limit is the watchlist's
// own length (60 today), which is what makes an unbounded copy unwise on a lane that also carries the
// thin/rising/gear/mid-tier reserves. The cost is never those 60: the reserve can only re-admit
// candidates ALREADY past Stage 1. Measured on ONE basis — the 88 band passes logged in
// suggestions.jsonl between the `--top 90` change and this chunk — the per-pass count of watchlist
// candidates that cleared the gate and were still excluded ran mean 7.2, p50 8, p90 12, max 15; across
// the full logged history, which includes the earlier top-40 pool, max 24. The bound is that
// all-history max, so on the current pool it is a CEILING WITH HEADROOM that has never once bound: no
// logged pass, on any basis, exceeded it. That is a deliberate choice, not a measured operating point.
//
// Headroom is cheap because the marginal cost is not a whole fetch. Every reserve-admitted row is by
// definition a watchlist item runWatchlist would have quoted anyway (5m + 6h); admitting it to the
// niche pool moves those two calls earlier and adds only the survivor-only /1h leg — one request per
// admitted id — plus, under --mode all, 0-2 additional UNIQUE ids, since amplitude's own watch reserve
// is usually fetching the same ones (measured over three live snapshots: deduped survivor union
// 174 -> 175, 162 -> 162, 175 -> 177).
//
// Sized for full coverage rather than a tighter bound for one reason: FPS's own measurement found the
// pre-fetch ranker is NOT predictive of what an item scores once fetched. Ranking watchlist items
// against each other and truncating is therefore the same failure this reserve exists to prevent, so it
// should bind as rarely as the fetch budget allows. If it ever does bind, the slots go to the highest
// expGpDay (the lane's own edge key) and pickFetchPool reports the remainder `watch-reserve-full` —
// never a silent drop. PLACEHOLDER (rule 4): a growing watchlist re-opens the question.
export const WATCH_RESERVE_DEFAULT = 24;
export const TOP_DEFAULT = 40;
// P5 — the value niche's HARD top-N (§F flood control: the gated pool WILL be large; never dump it).
export const VALUE_TOP_DEFAULT = 25;
// PLAN-FETCH-POOL-SCALING chunk 1 (finding #7) — the VALUE niche's fetch-pool RESERVE. Value had NO
// reserve mechanism at all (band/churn get THIN_RESERVE/RISING_RESERVE, amplitude gets the watchlist
// reserve); a big-ticket with a strong cycle but low limitVol is buried by the composite valueScore
// (which folds in the deployable-capital/liquidity weighting that penalizes exactly that profile) and
// never fetched. This carves out a small bounded slice for the excluded remainder, ranked by RAW
// cycle-amplitude-% (valueRanges.afterTaxAmpPct — a DIFFERENT key than the primary valueScore cut,
// exactly the thin/rising/watch-reserve shape: rank the remainder by a different key, take a bounded
// slice, PREPEND it, never reshuffle the top-N). Additive — it only ADDS slots, never removes. The
// reserve rows still clear the post-fetch valueGate knife guard, so no independent floor is needed here
// (mirrors THIN_RESERVE's no-floor rank). PLACEHOLDER n≈0 (rule 4).
export const VALUE_RESERVE_DEFAULT = 6;
// A2 — the amplitude niche's HARD top-N (same flood-control shape as value; the Stage-1 proxy pool can be
// large, so rank by ampProxy and take a bounded shortlist to fetch the per-item 1h series for). PLACEHOLDER.
// F-D: 40 rather than 25, to surface the big-ticket oscillator class a top-25 cut hides (a read-only
// top-60 run surfaced Virtus set/robe, Oathplate, Tormented synapse). Costs ~+15 fetches/scan;
// they verify sub-1% off the median-peak basis, so this is VISIBILITY, not new edge — the margin gate + the
// verify trio still govern. The F-B watchlist RESERVE is the complementary targeted path (a named straggler
// below this cut still gets a slot); this is the general net-widen.
export const AMP_TOP_DEFAULT = 40;

// --- PLAN-FETCH-POOL-SCALING chunks 2-3: sub-linear, capped capital-scaling of the fetch pool -------
// The fixed pool sizes above (40/6/25/6/40) are capital-BLIND: on a big-bankroll night more positions
// could plausibly be opened, so a real winner ranked outside the fixed slice never gets fetched — yet
// the fetch cost must NOT scale 1:1 with a 10-100x bankroll. scaleSlots widens a base slot count as
// deployable capital grows past a reference level, sub-linearly (sqrt) and hard-capped. It is a strict
// no-op at/below CAP_REF (and on a null/unknown capital), so a session with no cash anchor — where
// VALUE_CAPITAL falls back to exactly CAP_REF (100m) — reproduces today's fixed constant BYTE-FOR-BYTE.
// Every constant here is a PLACEHOLDER n≈0 (rule 4): there is no calibration for what slot count catches
// real winners vs wasted fetches — CAP_REF in particular is a structural judgment (the fixed defaults
// were never capital-tuned), not a derived number.
export const CAP_REF = 100_000_000;   // PLACEHOLDER — the reference bankroll the fixed defaults are treated as tuned against; matches screen-flip-niches.mjs's no-anchor VALUE_CAPITAL fallback so a fresh/never-anchored session is a no-op
export const POOL_SCALE = 1;          // PLACEHOLDER — widening strength: slots = base·(1 + POOL_SCALE·sqrt(excess/CAP_REF)), clamped to max
// Per-pool hard ceilings (§2.2 — the worst-case fetch bill must stay bounded regardless of capital).
export const TOP_MAX = 90;            // PLACEHOLDER — matches the manual `--top 90` workaround Ben already resorted to
export const THIN_RESERVE_MAX = 15;   // PLACEHOLDER — widens more conservatively than TOP (this lane guards the velocity lane from big-ticket crowding)
export const VALUE_TOP_MAX = 60;      // PLACEHOLDER
export const VALUE_RESERVE_MAX = 15;  // PLACEHOLDER
export const AMP_TOP_MAX = 90;        // PLACEHOLDER
// scaleSlots(base, { capital, capRef, scale, max }) -> integer slot count. capital == null / ≤ capRef
// returns `base` EXACTLY (the byte-identical no-op). Above capRef it adds base·scale·sqrt(excess/capRef)
// slots, rounded, then clamped to `max`. Pure, never throws.
export function scaleSlots(base, { capital = null, capRef = CAP_REF, scale = POOL_SCALE, max = Infinity } = {}) {
  if (capital == null || !(capital > capRef) || !(capRef > 0)) return base;   // ≤ ref / unknown → exact base
  const widened = base + scale * base * Math.sqrt((capital - capRef) / capRef);
  return Math.min(max, Math.round(widened));
}

// P6c — empty-result sub-floor fallback sizing + honesty cap: when a niche's floors leave ZERO
// candidates, re-run BENEATH the floor and show the best few HONESTLY LABELED — never silently lower
// the bar. Both are named PLACEHOLDERS (rule 4): the cap count is a small "best few",
// and the grade ceiling makes a sub-floor row structurally unable to print a headline grade (it did
// NOT clear the attention/liquidity bar, so it must never read like a qualified pick).
export const SUBFLOOR_TOP = 5;
export const SUBFLOOR_GRADE_CAP = 'C';

// realistic expected units/day: `limit × windows`, capped at a 10% share of the limiting-side daily
// volume. Null limit → volume share only.
// ⚠ `windows` DEFAULTS TO `ACTIONABLE_WINDOWS_PER_DAY` = **2**, NOT the physical 6. Do NOT describe this
// as "buy-limit refreshes ~every 4h → 6 limits/day": that is the game rule (`REFILL_WINDOWS_PER_DAY`), a
// DIFFERENT constant and not what this function uses by default. See js/desk-cadence.mjs for the divergence.
// PLAN-CAPITAL-THROUGHPUT: optional PER-WINDOW capital cap — `capPerWindow` = units the
// deployable bankroll affords in ONE 4h buy-window (deployablePool / price). It answers Ben's "for THIS
// price, how many can I realistically capture" — the other two caps measure MARKET capacity (limit +
// volume share), capital-blind. The cap enters INSIDE the per-window multiplier (not as a separate
// whole-day cap) because
// churn RECYCLES intra-day: you deploy a tranche, it sells within the window, and the freed capital
// rebuys next window — so the binding question is "can I afford ONE buy-limit tranche?", not "can I
// afford a whole day's accumulation at once?". (A whole-day/turns=1 cap wrongly HID fast churn Ben trades
// — anglerfish/sanfew — because it under-credited the intra-day recycle; per-window fixes that.)
// SELF-TARGETING: when one tranche is affordable (min(limit, capPerWindow) == limit) the result is
// byte-identical to legacy (soul rune, anglerfish, chins — never hidden). It binds ONLY where even a
// single buy-limit tranche costs more than the pool — the genuinely capital-constrained big/expensive
// positions, exactly the intended demotion. null capPerWindow → legacy (no capital term), so every
// existing caller (overnight, watchlist, fixtures) is byte-for-byte unchanged.
// PHYSICAL vs ACTIONABLE refill windows — the rationale, the ⚠ floor-recalibration warning, and the
// ruling's still-unmodelled half live in ONE home: `js/desk-cadence.mjs`. Duplicating them here and in
// valuescreen/amplitudescreen is exactly what let the copies drift apart under the 6→2 haircut (one
// moved, the others stayed at 6 while still claiming to "mirror expUnits").
// Imported (NOT `export … from`, which would re-export without binding them locally — `expUnits`'s
// default parameter below needs the local binding) and re-exported, so every existing importer of
// these names keeps working unchanged.
export { REFILL_WINDOWS_PER_DAY, ACTIONABLE_WINDOWS_PER_DAY };
export const expUnits = (limit, volDay, capPerWindow = null, windows = ACTIONABLE_WINDOWS_PER_DAY) => {
  const vShare = 0.10 * (volDay || 0);
  if (capPerWindow == null) return limit != null ? Math.min(limit * windows, vShare) : vShare;
  const perWindow = limit != null ? Math.min(limit, capPerWindow) : capPerWindow;          // + per-window affordability
  return Math.min(perWindow * windows, vShare);
};
// COD-2 — realistic expected units accumulated over the OVERNIGHT window (the /overnight §6
// accumulation sizing; the skill's hand-computed min(buyLimit×2, 8/24×0.10×volDay) plus a PROSE plea to
// "keep the constants aligned with expUnits"). This IS that formula, but derived
// by SCALING expUnits to the OVERNIGHT_SPAN_H window so the 6-limits/day (24/4h) and 10% volume-share
// constants can NEVER drift from the day figure: min(a,b)·k = min(a·k, b·k), so multiplying the whole
// expUnits result by SPAN/24 is exact — min(limit·6, 0.10·volDay)·(8/24) = min(limit·2, 8/24·0.10·volDay).
// Buy limit refreshes ~every 4h → 2 windows in an 8h span; the volume-share leg prorates flat across the
// span. UPPER BOUND (assumes fills at your price, no fill-probability) — screen-flip-niches.mjs labels it as such.
// NOT haircut by ACTIONABLE_WINDOWS_PER_DAY, deliberately: the overnight span is the one window that is
// genuinely UNATTENDED by design — a resting deep bid collects its 2 refills (8h ÷ 4h) while Ben sleeps,
// with no re-buying required. The attention argument that motivates the daytime haircut does not apply
// here, so this passes the PHYSICAL count and keeps its documented min(limit×2, 8/24×0.10×volDay).
export const expUnitsOvernight = (limit, volDay) =>
  expUnits(limit, volDay, null, REFILL_WINDOWS_PER_DAY) * OVERNIGHT_SPAN_H / 24;

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
// floor, per-mode edge, MIN_GPD attention floor) without CLI/network state. `expUnits` and `tax` are pure.
// A6 (PLAN-AMPLITUDE-SCAN §6.2 — the one real dedup) — the shared candidate-loop boilerplate all three
// gate stacks (band, value, amplitude) repeat: iterate v24, the two-sided-liquidity gate (hpv>0 && lpv>0,
// NON-NEGOTIABLE), the mid price window, and the thin/gp-flow classification. `fn` receives the survivor
// context ({ id, d, hpv, lpv, limitVol, avgHigh, avgLow, mid, thin }) and returns a candidate object or
// null (a per-gate `continue`); non-null results are collected. BYTE-IDENTITY: this is a MECHANICAL
// extraction — the iteration order (`for … in`), the exact gate order + `continue` points, and the mid/
// thin math are unchanged, so the P1 replay goldens must pass UNCHANGED (they pin the band path here).
export function eachLiquidCandidate({ v24 }, { minPrice = 0, maxPrice = Infinity, floorVol, gpFloor }, fn) {
  const out = [];
  for (const idStr in v24) {
    const id = +idStr; const d = v24[idStr]; if (!d) continue;
    const hpv = d.highPriceVolume || 0, lpv = d.lowPriceVolume || 0;
    if (hpv <= 0 || lpv <= 0) continue;                 // two-sided liquidity gate (shared, NON-NEGOTIABLE)
    const limitVol = Math.min(hpv, lpv);
    const avgHigh = d.avgHighPrice, avgLow = d.avgLowPrice;
    if (!avgHigh || !avgLow) continue;
    const mid = (avgHigh + avgLow) / 2;
    if (mid < minPrice || mid > maxPrice) continue;     // price window (shared)
    // liquidity: raw UNIT floor OR the gp-flow floor (thin big-ticket path). `thin` = qualified via
    // gp-flow only (below the unit floor) → honestly marked downstream (grade cap + tooltip).
    const thin = limitVol < floorVol;
    if (thin && limitVol * mid < gpFloor) continue;     // fails BOTH the unit floor and the gp-flow floor
    const c = fn({ id, d, hpv, lpv, limitVol, avgHigh, avgLow, mid, thin });
    if (c) out.push(c);
  }
  return out;
}

export function gateCandidates(mode, ctx, t = DEFAULT_THRESHOLDS, heldIds = new Set(), watchedIds = new Set()) {
  const spec = FLIP_NICHES[mode];
  if (!spec) throw new Error('gateCandidates: unknown strategy mode "' + mode + '"');
  if (spec.gate === 'value') return gateValueCandidates(ctx, t);                         // P5 — the term-structure value gate
  if (spec.gate === 'amplitude') return gateAmplitudeCandidates(ctx, t, watchedIds);     // A2 — the daily-amplitude Stage-1 proxy gate (F-B: watchedIds bypass the proxy floor)
  if (spec.gate === 'reverse') return gateReverseFlipCandidates(ctx.reversePool || [], ctx.reverseCtxById || {}, t);   // RF2 — the OWNED-item reverse-flip gate (pool + per-id ctx come off `ctx`, not v24)
  const { map, bands } = ctx;
  // The per-mode step-3 edge callback — IDENTICAL for both gates; only the ADMISSION iterator differs.
  // Extracted to a const (was inline) so `--gate structural` can feed the SAME fn to
  // eachStructuralCandidate without touching spec.edge. Under `--gate legacy` (t.GATE !== 'structural',
  // the default) this is the byte-identical eachLiquidCandidate call the replay goldens pin.
  const edgeFn = ({ id, hpv, lpv, limitVol, avgHigh, avgLow, mid, thin }) => {
    const limit = map.byId[id]?.limit ?? null;

    // --- step 3: the DECLARATIVE spec's edge — P4c re-expressed the old inline per-mode branch as
    // flip-niches.mjs edge functions (byte-identical: a `continue` is now a `return null`). Returns the
    // after-tax { modeNet, modeRoi, activeWin } or null when the item fails this niche's edge/gate. ---
    const edge = spec.edge({ avgHigh, avgLow, band: bands ? bands[id] : undefined, limitVol, limit, thin }, t);
    if (!edge) return null;
    const { modeNet, activeWin } = edge;
    if (modeNet <= 0) return null;
    // PLAN-CAPITAL-THROUGHPUT: expGpDay is CAPITAL-AWARE — the PER-WINDOW buy is capped by
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
    // MIN_GPD/day attention floor — pre-rating, so no grade ever advertises a sub-floor row. Thin gp-flow
    // qualifiers are EXEMPT (a unit/gp-day count mismeasures them — see MIN_GPD note). A HELD item is
    // EXEMPT too — CODE-enforced here, not a prose-only "held/asked items are exempt" note (same
    // held-item exception as surviveMode's falling bypass below). Held items never reach this file with a
    // real gp-flow reading if the market moved against them — dropping them here would be the exact
    // "silently vanishes" failure this prevents.
    const held = heldIds.has(id);
    if (!thin && !held && expGpDay < t.MIN_GPD) return null;
    // volDay (MT2, PLAN-MID-TIER-ADMISSION) — TOTAL two-sided daily volume, carried so admission.mjs's
    // GEAR_RESERVE can call classifyVolLane without re-deriving it. ⚠ This is hpv+lpv and MUST NOT be
    // confused with `limitVol` = min(hpv,lpv) directly above, which is the thin-side DEPTH: substituting
    // it would classify churn items as gear and poison the reserve with the exact population it exists to
    // keep out — a plausible-looking result, not a crash. The structural gate already computes the same
    // hpv+lpv (structural-admission.mjs:125), so both admission paths agree on this field.
    // `watched` — on the candidate for the SAME reason `held` is: the watch reserve in rankAndSlice /
    // pickFetchPool reads it, and clampUnionFetch treats a watched row as protected. It was set only by
    // gateAmplitudeCandidates, so on this (band/churn/scalp) path every candidate read `undefined` and the
    // reserve had nothing to select — the reserve and this field ship together or neither works.
    const watched = watchedIds.has(id);
    return { id, limitVol, volDay: hpv + lpv, mid, limit, expGpDay, expGpDayLegacy, activeWin, thin, held, watched };
  };
  // GATE routing (PLAN-LANE-ADMISSION Chunk B) — independent of --admission (which is pool ORDERING,
  // not membership). Default 'legacy' → the unchanged eachLiquidCandidate admission. 'structural' swaps
  // in the edge-blind universal gate; the per-mode edgeFn (spec.edge) still runs post-admission in this
  // chunk. Thresholds fold structural overrides off `t` (undefined → DEFAULT_STRUCTURAL placeholders).
  if (t.GATE === 'structural') {
    return eachStructuralCandidate(ctx, {
      minValue: t.MIN_VALUE ?? DEFAULT_STRUCTURAL.minValue,
      minThin: t.MIN_THIN_DEPTH ?? DEFAULT_STRUCTURAL.minThin,
      minNotional: t.MIN_NOTIONAL ?? DEFAULT_STRUCTURAL.minNotional,
      churnVolCut: t.CHURN_VOL_CUT ?? DEFAULT_STRUCTURAL.churnVolCut,
    }, edgeFn);
  }
  return eachLiquidCandidate(ctx, { minPrice: t.MIN_PRICE, maxPrice: t.MAX_PRICE, floorVol: t.FLOOR, gpFloor: t.GP_FLOOR }, edgeFn);
}

/* P5 — the VALUE niche's own candidate gate (PLAN-VALUE §A). Keeps the two-sided liquidity gate + the
   price window; REPLACES the MIN_GPD gp/day throughput floor with valuescreen's after-tax cycle-amplitude
   floor, LOWERS the liquidity floor (VALUE_LIQ_FLOOR — hold for days–weeks needs eventual exitability,
   not fast churn), and rejects a decay/downtrend KNIFE via the term structure. `ctx.daily` is the bulk
   daily-mid archive (screen-flip-niches.mjs's loadDaily) already loaded at gate time — the term structure is
   computed from it with NO per-item fetch. Each survivor carries its valueScore + valueRanges + tier so
   rankAndSlice can hard top-N by score (§F) and renderMode can print the term-structure row. */
function gateValueCandidates(ctx, t = DEFAULT_THRESHOLDS) {
  const { map, daily } = ctx;
  const floorVol = t.VALUE_LIQ_FLOOR ?? DEFAULT_THRESHOLDS.VALUE_LIQ_FLOOR;   // LOWERED value liquidity floor OR gp-flow
  // A6: the two-sided / price-window / thin classification is the shared helper; value's own gate
  // (mid ≥ VALUE_MIN_PRICE, the term-structure amplitude floor + knife) is the fn body.
  return eachLiquidCandidate(ctx, { minPrice: Math.max(t.MIN_PRICE, VALUE_MIN_PRICE), maxPrice: t.MAX_PRICE, floorVol, gpFloor: t.GP_FLOOR }, ({ id, limitVol, mid, thin }) => {
    const ts = termStructure(daily && daily[id]);            // 1/3/7/14/28d structure (no per-item fetch)
    const vr = valueRanges(ts, mid);                        // mid = live proxy pre-fetch
    const g = valueGate(vr, {});                            // amplitude floor + term-structure knife guard
    if (!g.pass) return null;
    const limit = map.byId[id]?.limit ?? null;
    return { id, limitVol, mid, limit, thin, valueScore: valueScore(vr, { limitVol, limit, capGp: t.VALUE_CAP_GP ?? null }), valueRanges: vr, tier: valueTier(vr) };
  });
}

/* A2 (PLAN-AMPLITUDE-SCAN §2.1) — the AMPLITUDE niche's Stage-1 pre-fetch gate. Keeps the shared
   two-sided liquidity gate + the thin/gp-flow classification (via eachLiquidCandidate), but uses
   amplitude's OWN price window (min AMP_MIN_PRICE, no upper cap — the default 45m clips Masori≈42m) and
   REPLACES the MIN_GPD gp/day throughput floor with the cheap ATTENUATED daily-amplitude PROXY off the bulk
   6h-spaced archive (js/amplitudescreen.mjs amplitudeProxy). The proxy's ONLY job is picking the fetch
   pool — the EXACT gate (amplitudeGate off the per-item 1h windowStats) runs post-fetch in
   renderAmplitudeMode (the two-stage split, exactly like value's proxy→confirm). `ctx.daily` is the bulk
   archive already loaded at gate time (no per-item fetch). Each survivor carries `ampProxy` so
   rankAndSlice can hard top-N by it. A cold/short archive slice → null proxy → not a candidate (the
   honest degrade — never a fake amplitude).

   F-B (PLAN-OSCILLATION-CYCLE): `watchedIds` (repo-root
   watchlist.json, the SAME set the S3 always-scanned watchlist pass already reads) BYPASSES the
   AMP_STAGE1_MIN_PCT proxy floor — a watchlisted big-ticket whose proxy reads below the floor (or is
   null on a cold archive slice) still becomes a candidate, carrying `watched:true` so rankAndSlice can
   guarantee it a fetch slot below (see there for why this is a RESERVE, not a floor relax). It still
   has to clear the shared two-sided-liquidity + price-window gate above (non-negotiable) — this only
   waives the proxy-floor CUT, not the base liquidity/price gate. A watched item that clears here is NOT
   automatically admitted to the amplitude table: it still has to pass the real Stage-2 amplitudeGate
   (trend/knife/margin-below-floor) in renderAmplitudeMode exactly like any other survivor — reaching the
   gate is the fix, not a free pass through it. */
function gateAmplitudeCandidates(ctx, t = DEFAULT_THRESHOLDS, watchedIds = new Set()) {
  const { map, daily } = ctx;
  const floorVol = t.FLOOR;   // amplitude's big tickets mostly enter via the gp-flow THIN path (§2.1)
  return eachLiquidCandidate(ctx, { minPrice: Math.max(t.MIN_PRICE, AMP_MIN_PRICE), maxPrice: AMP_MAX_PRICE, floorVol, gpFloor: t.GP_FLOOR }, ({ id, limitVol, mid, thin }) => {
    const ampProxy = amplitudeProxy(daily && daily[id]);     // Stage-1 attenuated proxy off the 6h archive
    const watched = watchedIds.has(id);
    if (!watched && (ampProxy == null || ampProxy < AMP_STAGE1_MIN_PCT)) return null;
    const limit = map.byId[id]?.limit ?? null;
    return { id, limitVol, mid, limit, thin, ampProxy, watched };
  });
}

/* RF2 (PLAN-REVERSE-FLIP §5) — the REVERSE-FLIP niche's candidate gate. PURE + total (one entry in, one
   annotated entry out), so it's fixture-testable with a synthetic keep-pool and NO live fetch (CLAUDE.md
   rule 4). Unlike every other gate here it does NOT iterate the v24 fetch universe: its population is the
   caller-assembled OWNED-item pool (owned-items.json classification:'keep' ∪ hold-thesis reverseFlip:true —
   Ruling §8: the keep set IS the pool, no per-item opt-in flag), which is small and pre-selected by
   OWNERSHIP, not attention-worthiness. So it takes that `pool` array + a per-id market-context map (`ctxById`
   the caller fetched: { trajectory, sellRef, rebuyRef?, swingPct?, sellLegVol?, rebuyLegVol? }) and applies
   RF1's reverseFlipGate/reverseFlipEdge per candidate. `t` is accepted for signature parity with the other
   gates but unused (reverseFlipGate closes over its own PLACEHOLDER constants).

   Returns EVERY pool entry annotated with its `gate` (the full reverseFlipGate result — decision ∈
   pass|caution|reject, reasons[], regime, edge), NOT a filtered subset: the renderer (runReverseMode) splits
   surfaced (decision ≠ 'reject') from rejected-for-a-footer, mirroring value's droppedTrajKnife footer. An
   empty pool → [] (the honest empty-keep-pool degrade, never a throw). */
export function gateReverseFlipCandidates(pool, ctxById = {}, t = DEFAULT_THRESHOLDS) {
  return (pool || []).map(p => {
    const c = (ctxById && ctxById[p.id]) || {};
    const gate = reverseFlipGate({
      trajectory: c.trajectory,
      sellRef: c.sellRef, rebuyRef: c.rebuyRef, swingPct: c.swingPct,
      sellLegVol: c.sellLegVol, rebuyLegVol: c.rebuyLegVol,
    });
    return { id: p.id, name: p.name, source: p.source, gate, edge: gate.edge, regime: gate.regime };
  });
}

/* --- P6c: empty-result sub-floor fallback --------------------------------------------------------
   TRIGGER (screen-flip-niches.mjs owns it): a niche whose gateCandidates() came back EMPTY at the configured
   floors. This helper then re-runs the SAME gate stack (no forked logic — it just calls
   gateCandidates with relaxed thresholds) down a two-step ladder to find WHICH floor emptied it:
     1. 'min-gpd'    — relax ONLY the attention floor (MIN_GPD → 0). If candidates appear, the MIN_GPD
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
  // Only the shared band gate stack has the MIN_GPD/GP_FLOOR ladder this relaxes. value + amplitude own
  // their own floors (term-structure / daily-amplitude gate) and are provisional/off-app — out of scope.
  if (!spec || spec.gate !== 'band') return null;
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
export function rankAndSlice(mode, cand, dailySeries, { thinReserve = THIN_RESERVE_DEFAULT, risingReserve = RISING_RESERVE_DEFAULT, top = TOP_DEFAULT, valueReserve = VALUE_RESERVE_DEFAULT, watchReserve = WATCH_RESERVE_DEFAULT } = {}) {
  // P5 value niche (§F): rank the WHOLE gated pool by the composite valueScore and take a HARD top-N.
  // The pool is expected large; the shortlist is bounded (renderValueMode prints admitted-vs-shown).
  // PLAN-FETCH-POOL-SCALING chunk 1 — a VALUE RESERVE (mirrors the thin/rising/watch reserves): the
  // excluded remainder is re-ranked by RAW cycle-amplitude-% (valueRanges.afterTaxAmpPct, NOT the
  // composite valueScore that buries a low-liquidity big cycle) and the top `valueReserve` are PREPENDED
  // with `via:'reserve'` so a renderer can tell a reserve-slotted row from a ranked-in one. Additive —
  // the ranked top-N itself is untouched; the reserve only ADDS slots (same guarantee as the thin reserve).
  if (FLIP_NICHES[mode] && FLIP_NICHES[mode].gate === 'value') {
    const sorted = cand.slice().sort((a, b) => (b.valueScore - a.valueScore) || (a.id - b.id));
    const topN = sorted.slice(0, top);
    const topIds = new Set(topN.map(c => c.id));
    const ampOf = c => (c.valueRanges && c.valueRanges.afterTaxAmpPct) || 0;
    const reserve = sorted.slice(top)
      .filter(c => !topIds.has(c.id))
      .sort((a, b) => (ampOf(b) - ampOf(a)) || (a.id - b.id))
      .slice(0, valueReserve)
      .map(c => ({ ...c, via: 'reserve' }));
    return [...reserve, ...topN];
  }
  // A2 — the amplitude niche: rank the whole Stage-1 pool by the attenuated daily-amplitude PROXY and take
  // a HARD top-N to fetch (the exact Stage-2 gate confirms per survivor in renderAmplitudeMode).
  // F-B — a WATCHLIST RESERVE, mirroring the held-reserve shape above: any `watched` candidate that fell
  // outside the top-N by proxy still gets a guaranteed fetch slot, PREPENDED (not reshuffling the ranked
  // top-N itself). This is deliberately a reserve, not a bigger AMP_TOP_DEFAULT — raising the top-N would
  // cost one more live per-item fetch for EVERY candidate in the widened band on EVERY scan, forever, to
  // fix a handful of named items; a reserve costs fetches ONLY for the items actually on the watchlist.
  // ⚠ UNBOUNDED, and its original "watchlist.json is a small set, never a flood risk" justification no
  // longer holds unexamined: the file now carries 60 entries and a live pool measured 17 watched
  // candidates through the Stage-1 gate, 10 of them outside the top-N — a +25% fetch bill on this niche,
  // and structurally it could prepend more rows than AMP_TOP_DEFAULT reserves into. Not currently harmful
  // (every extra fetch is a named item), so it is left AS IS deliberately rather than folded into the
  // band stack's bounded WATCH_RESERVE_DEFAULT — which today would be a no-op here (10 ≤ its bound).
  if (FLIP_NICHES[mode] && FLIP_NICHES[mode].gate === 'amplitude') {
    const sorted = cand.slice().sort((a, b) => (b.ampProxy - a.ampProxy) || (a.id - b.id));
    const topN = sorted.slice(0, top);
    const topIds = new Set(topN.map(c => c.id));
    const watchReserveRows = cand.filter(c => c.watched && !topIds.has(c.id));
    return [...watchReserveRows, ...topN];
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
  // HELD RESERVE (same family as thin/rising above): a held item that cleared the gate
  // above must not still vanish here just for ranking below the velocity cutoff. UNBOUNDED by design —
  // there are only ever a handful of held lots at once (never a flood risk like the thin/rising pools),
  // so every held survivor gets a guaranteed slot rather than a capped reserve.
  const heldSurvivors = cand.filter(c => c.held && !riserIds.has(c.id));
  const heldIdsInPool = new Set(heldSurvivors.map(c => c.id));
  const rest = nonThin.filter(c => !riserIds.has(c.id) && !heldIdsInPool.has(c.id));
  const reserved = cand.filter(c => c.thin && !heldIdsInPool.has(c.id)).sort((a, b) => (b.limitVol * b.mid) - (a.limitVol * a.mid)).slice(0, thinReserve);
  const pool = [...heldSurvivors, ...reserved, ...risers, ...rest].slice(0, top + heldSurvivors.length);
  return [...watchReserved(cand, pool, watchReserve), ...pool];
}

// WATCH RESERVE (PP-R) — the band stack's counterpart to the amplitude gate's watchlist reserve, and the
// same shape as every other reserve in this file: rank the remainder by its own key, take a BOUNDED slice,
// PREPEND it, never reshuffle the ranked pool. It runs on the ALREADY-SLICED pool so it is strictly
// additive — a watchlisted candidate that ranked in is a no-op, and one that fell outside gets a
// guaranteed NICHE-LANE slot instead of being visible only in the always-on watchlist section (which
// prices it either way — see WATCH_RESERVE_DEFAULT's scope note before restating this as "never priced").
// The rank key is `expGpDay` — the lane's own edge number, so when the bound binds the biggest measured
// edge takes the slots (the alternative, gp-flow, is the dimension admission.mjs's founding ruling
// rejected). Reaching the fetch pool is NOT admission to the table: the row still faces surviveMode's
// falling doctrine and every post-fetch gate, exactly like a ranked-in row.
// Shared by rankAndSlice and pickFetchPool (admission.mjs) so the two admission paths cannot drift —
// the double-maintenance shape the value reserve already warns about.
export function watchReserved(cand, admitted, limit = WATCH_RESERVE_DEFAULT) {
  if (!(limit > 0)) return [];                                  // 0 / negative ⇒ no reserve (byte-identical to pre-PP-R)
  const inPool = new Set((admitted || []).map(c => c.id));
  return cand.filter(c => c.watched && !inPool.has(c.id))
    .sort((a, b) => ((b.expGpDay || 0) - (a.expGpDay || 0)) || (a.id - b.id))
    .slice(0, limit)
    .map(c => ({ ...c, via: 'watch' }));                         // provenance tag (value/gear use via:'reserve', exploration via:'explore')
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
// P5 — the falling doctrine is PER-SPEC (the falling amendment: a faller is not necessarily a poor buy —
// "we cannot judge falling without its history and typical fluctuations"). surviveMode reads
// spec.falling; there is no hardcoded global exclusion:
//   'exclude'     — falling ⇒ dropped (unless --phase-rescue basing, OR opts.held — see below). The
//                   four original niches carry this, pinned by the replay goldens for a NON-held row.
//                   'knife-guard' (value) also lands here defensively, but value never reaches
//                   surviveMode — its knife guard is valueGate.
//   'accept'      — falling is a VALID candidate (scalp EXPECTS a falling wide band); not dropped for
//                   the regime alone. Its intraday tripwire lives in offerVerdict/the path engine.
//                   Step 5: scalp goes further — a scalp-mode CONFIRM below REQUIRES falling
//                   (a non-falling scalp is a band flip → dropped 'notFalling'), so scalp = fallers only.
export function surviveMode(mode, row, phase, opts = {}) {
  const { phaseRescue = false, posture = 'active', thin = false, series5m = null, held = false } = opts;
  const spec = FLIP_NICHES[mode];
  const fallingDoctrine = spec ? spec.falling : 'exclude';
  let rescued = false;
  let heldFallingOverride = false;
  // HELD-ITEM EXCEPTION — CODE, not /scan skill prose ("items Ben holds ... always show, with
  // price-to-clear"), so it cannot silently depend on the agent remembering to check.
  // A held item's regime can flip to 'falling' between one pass and the next with NO
  // warning otherwise — this is the ONLY bypass the exception covers; posture/notFalling drops below
  // are untouched (the exception is specifically about the exclude-fallers doctrine, not every gate).
  if (row.falling && fallingDoctrine !== 'accept' && held) {
    heldFallingOverride = true;
  } else if (row.falling && fallingDoctrine !== 'accept') {
    if (phaseRescue && phase && phase.phase === 'basing') rescued = true;   // decayed off a spike, lows flattened
    else return { keep: false, discardReason: 'falling', rescued: false, heldFallingOverride: false };  // screen rule: never surface fallers
  }
  // Post-fetch CONFIRM — SPEC-DRIVEN (P4c → N2): read `spec.confirm`, never a `mode === …` branch.
  // A spec that declares `confirm: 'falling'` (scalp) positively REQUIRES a falling regime:
  // spec.falling='accept' stops the exclusion above from dropping the faller, and this confirm ALSO drops a
  // NON-falling row ('notFalling') — a scalp on a non-falling item is just a band flip band already owns.
  // Its ROI-bind (a fresh wide band clearing −ROI once tax is paid) is caught by renderMode's Step-2 net>0
  // surface gate, so it isn't re-checked here.
  if (spec && spec.confirm === 'falling' && !row.falling) return { keep: false, discardReason: 'notFalling', rescued, heldFallingOverride };
  if (posture === 'overnight') {
    // overnight posture: only a confident, patient, non-thin edge that won't be stale by morning.
    if (thin) return { keep: false, discardReason: 'posture', rescued, heldFallingOverride };                                      // no thin fast-lane
    if (!(row.regimeLabel === 'flat' || row.rising)) return { keep: false, discardReason: 'posture', rescued, heldFallingOverride }; // confident flat/rising only (drops unknown)
    if (!row.reliable) return { keep: false, discardReason: 'posture', rescued, heldFallingOverride };                              // needs a trustworthy band
    if (row.mom === 'breakdown') return { keep: false, discardReason: 'posture', rescued, heldFallingOverride };                    // no active pullback overnight
    if (overnightStaleRisk(series5m, row.optBuy)) return { keep: false, discardReason: 'posture', rescued, heldFallingOverride };   // stale/underwater by morning
  }
  return { keep: true, discardReason: null, rescued, heldFallingOverride };
}
