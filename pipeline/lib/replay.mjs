/**
 * replay.mjs — the snapshot-replay acceptance ENGINE (Pipeline v2, chunk P1, the harness half).
 *
 * P1's mechanical half extracted screen.mjs's candidate-selection + survival doctrine into the pure
 * lib/gatecandidates.mjs (gateCandidates → rankAndSlice → surviveMode). This module drives that WHOLE
 * per-niche funnel off a committed, synthetic market SNAPSHOT — no live API, no real SQLite — so the
 * screen's discovery behavior is pinned by golden outputs the way computeQuote/reconstruct already are.
 * (Steps 3+4: the default niche set is band + churn — the spread/rising specs were deleted.)
 *
 * WHY a superset of D0's archive fixture (coffer-archive-fixture/1). D0's exportFixture emits ONLY the
 * raw bucketed /1h+/5m observations the Tier-1 archive stores. The screen funnel needs MORE than raw
 * buckets: the whole-market /24h map (v24), the aggregated 2h band (loadBands), the /latest snapshot,
 * the guide price, the buy limit, the per-item 5m/6h timeseries computeQuote reads, and the bulk daily
 * {ts,mid} regime proxy rankAndSlice orders by. So the replay SNAPSHOT is a documented SUPERSET,
 * schema `coffer-replay-snapshot/1`: one self-contained per-item record carrying exactly those inputs.
 * It is still raw market data (no derived verdicts) — every derivation (regime, phase, mom, reliable,
 * grade, survival) is recomputed here by the SAME pure functions the app/screen use.
 *
 * DETERMINISM. buildSnapshot() expands a fixed set of ARCHETYPES into full raw series anchored to a
 * FIXED instant (ANCHOR_TS) — timestamps are internally-consistent (regimeDrift/phase window off the
 * series' own tEnd, never the wall clock), and computeQuote is called with now=ANCHOR_TS*1000 so the
 * staleness check is anchored too. The one wall-clock coupling left is overnightStaleRisk (surviveMode
 * calls it with the real Date.now()); each archetype's ts5m therefore carries 23 windows so that helper's
 * `<24 populated points` guard makes it DETERMINISTICALLY false — the overnight scenario here isolates
 * the thin/posture drop, and the staleness sub-check itself stays unit-pinned in survivemode.test.mjs.
 *
 * NICHE SET (Steps 3+4, Ben 2026-07-09): runReplay's default modes are now band + churn — the `spread`
 * and `rising` specs are DELETED (js/flip-niches.mjs). The falling doctrine is PER-SPEC (P5): band/churn
 * exclude fallers; the scalp scenario accepts AND requires them (spec.falling=accept + the scalp confirm);
 * value has its own term-structure gate. Each doctrine diff IS recorded by regenerating the golden.
 * No live data (CLAUDE.md rule 4).
 */
import { computeQuote, phase } from '../../js/quotecore.js';
import { gateCandidates, rankAndSlice, surviveMode, DEFAULT_THRESHOLDS, THIN_RESERVE_DEFAULT, TOP_DEFAULT } from './gatecandidates.mjs';

// A fixed pass instant. 6h/5m/daily windows are all offset from this; nothing reads the wall clock
// except overnightStaleRisk (deterministically false by construction — see header).
export const ANCHOR_TS = 1783560000;   // unix seconds (a stable, arbitrary instant)

const DAY = 86400, H6 = 6 * 3600, M5 = 300;
const round = Math.round;

// --- series generators (raw, deterministic; mids preserved so regimeDrift/proxyDrift are exact) -----
// A 6h regime series: 10 recent points (≤~2.5d, all inside regimeDrift's 3d recent window) at recentMid
// and 10 prior points (4–15d back, inside the 3–17d prior window) at priorMid ⇒ driftPct is exactly
// (recentMid-priorMid)/priorMid*100. Each point's mid == its target (avgLow=mid*0.99, avgHigh=mid*1.01).
function reg6h(recentMid, priorMid, anchor = ANCHOR_TS) {
  const pt = (ts, mid) => ({ timestamp: ts, avgLowPrice: round(mid * 0.99), avgHighPrice: round(mid * 1.01) });
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push(pt(anchor - 4 * DAY - round(i * 1.2 * DAY), priorMid));  // prior: 4.0–14.8d
  for (let i = 9; i >= 0; i--) pts.push(pt(anchor - i * H6, recentMid));                          // recent: 0–2.25d
  return pts.sort((a, b) => a.timestamp - b.timestamp);
}

// A 2h 5m band: 23 windows (see header — the <24 guard keeps overnightStaleRisk deterministically
// false) whose min avgLowPrice == bandLo and max avgHighPrice == bandHi, so computeQuote's own 2h band
// matches the aggregated loadBands band the gate used ⇒ the momentum tell is clean (in-band).
function band5m(bandLo, bandHi, anchor = ANCHOR_TS) {
  const pts = [];
  for (let i = 22; i >= 0; i--) {
    const ts = anchor - i * M5;
    pts.push({ timestamp: ts, avgLowPrice: bandLo + (i % 3), avgHighPrice: bandHi - (i % 3) });
  }
  return pts;   // ascending by ts
}

// The bulk daily {ts,mid} regime proxy rankAndSlice orders by: 4 recent (≤3d) + 6 prior (4–9d) points,
// clearing proxyDrift's ≥4-recent / ≥6-prior sample gates, with the same recent/prior mids as reg6h.
function daily(recentMid, priorMid, anchor = ANCHOR_TS) {
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push({ ts: anchor - 4 * DAY - i * DAY, mid: priorMid });
  for (const d of [2.5, 2, 1, 0]) pts.push({ ts: anchor - round(d * DAY), mid: recentMid });
  return pts.sort((a, b) => a.ts - b.ts);
}

/* The five shared archetypes named in PLAN.md's P1 spec. Each row is a compact spec; buildSnapshot()
   expands it into full raw series. `expect` documents the intended behavior (the golden is generated
   from the funnel, then hand-checked against this table — it is NOT read by runReplay). */
export const ARCHETYPES = [
  {
    id: 2001, name: 'Stable band commodity', behavior: 'stable band',
    // flat regime, wide 2h band, deeply liquid → the model surviving-and-surfaced band flip.
    recentMid: 100_000, priorMid: 100_000, band: [98_000, 102_000], active5m: 20, tradedWin: 24, sawLow: true, sawHigh: true,
    // PLAN-VOL24: volumes scaled to the corrected rolling-24h world (rolling is now the default source);
    // limitVol 126k clears both the recalibrated FLOOR (3500 → non-thin band) and CHURN_MIN_VOL (65000 → churn candidate).
    v24: [98_000, 102_000, 140_000, 126_000], limit: 1_500, guide: 100_000,
    expect: 'kept in band + churn (flat, wide traded band, deeply liquid); dropped notFalling in scalp (not falling)',
  },
  {
    id: 2002, name: 'Genuine dip riser', behavior: 'genuine dip',
    // confirmed rising regime, clean in-band momentum → survives every niche incl. the rising confirm.
    recentMid: 107_000, priorMid: 100_000, band: [104_000, 109_000], active5m: 20, tradedWin: 24, sawLow: true, sawHigh: true,
    // PLAN-VOL24: scaled to corrected volume — limitVol 95k clears FLOOR (3500) and CHURN_MIN_VOL (65000).
    v24: [104_000, 109_000, 110_000, 95_000], limit: 800, guide: 106_000,
    expect: 'kept in band + churn (a confirmed riser clears the band gates); dropped notFalling in scalp',
  },
  {
    id: 2003, name: 'Thin big ticket', behavior: 'thin big ticket',
    // flat, admitted via the gp-flow floor ONLY (limitVol 320 < unit FLOOR 3500; 320×~15m ≈ 4.8b ≥ GP_FLOOR
    // 4.5b) → thin. PLAN-VOL24: volumes scaled to the corrected world — a genuine thin big ticket now needs
    // ~300+ units/day at a 15m mid to clear the recalibrated 4.5b gp-flow floor, but stays < FLOOR (thin) and
    // < CHURN_MIN_VOL (never a churn candidate). Bar D regression guard (Ben 2026-07-09): active5m 0 — this
    // big ticket has ZERO 5m windows that were two-sided WITHIN one 5m bucket (its prints scatter across the
    // hour), so the OLD gate (active5m ≥ MIN_ACTIVE_THIN 1) would have DROPPED it — the exact bug. Bar D admits
    // it on tradedWin 8 (8 windows saw a trade) + sawLow/sawHigh (both sides printed across the 2h). Kept, as before.
    recentMid: 15_050_000, priorMid: 15_050_000, band: [14_700_000, 15_400_000], active5m: 0, tradedWin: 8, sawLow: true, sawHigh: true,
    v24: [14_700_000, 15_400_000, 340, 320], limit: 8, guide: 15_000_000,
    expect: 'kept thin in band via Bar D (tradedWin 8 + two-sided; active5m 0 would have failed the old gate); dropped POSTURE overnight (no thin fast-lane); never in churn (limitVol<CHURN_MIN_VOL); dropped notFalling in scalp',
  },
  {
    id: 2004, name: 'Decay knife', behavior: 'decay-knife',
    // liquid with a real band edge (PASSES the pre-fetch gate) but a falling regime → the classic
    // knife caught POST-fetch by the falling-exclusion, before any edge is offered.
    recentMid: 40_000, priorMid: 45_000, band: [39_000, 41_000], active5m: 15, tradedWin: 20, sawLow: true, sawHigh: true,
    // PLAN-VOL24: scaled to corrected volume — limitVol 95k clears FLOOR + CHURN_MIN_VOL (so it's gated in both, then dropped FALLING).
    v24: [39_000, 41_000, 110_000, 95_000], limit: 1_000, guide: 41_000,
    expect: 'gated in band/churn, dropped FALLING there (falling check precedes all others); KEPT in scalp (falling is the thesis)',
  },
  {
    id: 2005, name: 'Falling wide band', behavior: 'falling wide-band',
    // an even wider, fatter-looking band edge — but STILL falling. Pins that band width never rescues a
    // faller (the edge is a trap): dropped falling despite the tempting spread.
    recentMid: 200_000, priorMid: 235_000, band: [188_000, 214_000], active5m: 12, tradedWin: 18, sawLow: true, sawHigh: true,
    // PLAN-VOL24: scaled to corrected volume — limitVol 78k clears FLOOR + CHURN_MIN_VOL (gated in both, dropped FALLING).
    v24: [190_000, 210_000, 90_000, 78_000], limit: 400, guide: 205_000,
    expect: 'gated with a fat edge in band/churn, dropped FALLING there (width is not a rescue); KEPT in scalp',
  },
];

/* buildSnapshot() → the full coffer-replay-snapshot/1 object (deterministic). This IS the committed
   fixture's content; the test guards the committed JSON against drift from this generator. */
// @test-only: replay golden-fixture harness, driven by replay.test.mjs (no production entrypoint runs replay).
export function buildSnapshot(anchor = ANCHOR_TS) {
  const items = {};
  for (const a of ARCHETYPES) {
    const [bandLo, bandHi] = a.band;
    const [avgLow, avgHigh, hpv, lpv] = a.v24;
    items[a.id] = {
      name: a.name, behavior: a.behavior, limit: a.limit, guide: a.guide,
      v24: { avgLowPrice: avgLow, avgHighPrice: avgHigh, highPriceVolume: hpv, lowPriceVolume: lpv },
      band: { bandLo, bandHi, active5m: a.active5m, tradedWin: a.tradedWin, sawLow: a.sawLow, sawHigh: a.sawHigh },
      // /latest: instasell = bandLo, instabuy = bandHi (in-band ⇒ clean momentum), stamped at the anchor.
      latest: { low: bandLo, high: bandHi, lowTime: anchor, highTime: anchor },
      ts5m: band5m(bandLo, bandHi, anchor),
      ts6h: reg6h(a.recentMid, a.priorMid, anchor),
      daily: daily(a.recentMid, a.priorMid, anchor),
    };
  }
  return { schema: 'coffer-replay-snapshot/1', anchorTs: anchor, note: 'synthetic archetypes for the P1 replay harness (no PII, no live data)', items };
}

// Reassemble the gate-stack context (loadAll24h + loadMapping + loadBands shapes) from a snapshot.
function snapshotCtx(snap) {
  const v24 = {}, byId = {}, bands = {};
  for (const idStr in snap.items) {
    const it = snap.items[idStr], id = +idStr;
    v24[id] = it.v24;
    byId[id] = { name: it.name, limit: it.limit };
    bands[id] = it.band;
  }
  return { v24, map: { byId }, bands };
}

// The per-item daily {ts,mid} proxy series map rankAndSlice consumes.
function snapshotDaily(snap) {
  const out = {};
  for (const idStr in snap.items) out[+idStr] = snap.items[idStr].daily;
  return out;
}

/* runReplay(snapshot, opts) → the funnel result for each requested niche. This is the WHOLE P1 funnel:
   gateCandidates (pre-fetch gate) → rankAndSlice (fetch-pool order) → computeQuote (the row) + phase →
   surviveMode (post-fetch doctrine). Returns, per niche, the exact stage outputs the golden pins:
     { gated:[{id,thin}], ranked:[id], survivors:[{id,keep,discardReason,rescued}], kept:[id], dropped:{id:reason} }
   opts: { modes, thresholds, thinReserve, top, phaseRescue, posture } — all default to screen's defaults. */
// @test-only: replay golden-fixture harness, driven by replay.test.mjs (no production entrypoint runs replay).
export function runReplay(snap, {
  modes = ['band', 'churn'],   // Steps 3+4 (Ben 2026-07-09): spread + rising specs DELETED
  thresholds = DEFAULT_THRESHOLDS,
  thinReserve = THIN_RESERVE_DEFAULT,
  top = TOP_DEFAULT,
  phaseRescue = false,
  posture = 'active',
} = {}) {
  const ctx = snapshotCtx(snap);
  const dailySeries = snapshotDaily(snap);
  const out = {};
  for (const mode of modes) {
    const cand = gateCandidates(mode, ctx, thresholds);
    const ranked = rankAndSlice(mode, cand, dailySeries, { thinReserve, top });
    const survivors = [], kept = [], dropped = {};
    for (const s of ranked) {
      const it = snap.items[s.id];
      // the real row, from the real computeQuote, off the snapshot's raw inputs (now anchored).
      const row = computeQuote({
        latest: it.latest, ts5m: it.ts5m, ts6h: it.ts6h, vol24: it.v24,
        guide: it.guide, limit: it.limit, now: (snap.anchorTs ?? ANCHOR_TS) * 1000,
      });
      const ph = phase(it.ts6h);
      const sv = surviveMode(mode, row, ph, { phaseRescue, posture, thin: s.thin, series5m: it.ts5m });
      survivors.push({ id: s.id, keep: sv.keep, discardReason: sv.discardReason, rescued: sv.rescued });
      if (sv.keep) kept.push(s.id); else dropped[s.id] = sv.discardReason;
    }
    out[mode] = {
      gated: cand.map(c => ({ id: c.id, thin: c.thin })).sort((a, b) => a.id - b.id),
      ranked: ranked.map(s => s.id),
      survivors,
      kept: kept.slice().sort((a, b) => a - b),
      dropped,
    };
  }
  return out;
}
