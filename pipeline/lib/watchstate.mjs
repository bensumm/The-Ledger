// watchstate.mjs — PURE cross-pass TEMPORAL MEMORY for the console watch.mjs loop (chunk V1).
//
// watch.mjs is stateless per pass: it re-quotes every position from scratch and never remembers
// what the LAST pass looked like. That stateless purity is correct for the DECISION layer —
// momVerdict() (js/quotecore.js) stays a pure function of the current quote and is NOT touched
// here. What this module adds is the layer momVerdict deliberately cannot have: memory of how a
// position moved BETWEEN consecutive passes (Δ instabuy, a momentum transition, how many passes
// running it has been underwater, whether the 2h band top is drifting). That memory lives OUTSIDE
// momVerdict, owned by the watch loop, and in V1 it is OUTPUT-ONLY — it emits context lines and
// changes NO verdict, NO alert, NO row selection.
//
// SPLIT (deliberate, mirrors ledgercore/watchcore): the pure delta/counter logic (computeDeltas /
// advanceState / classifyBandTop) is DOM-free, network-free, fs-free and is what the fixtures
// exercise. The thin IO wrappers (loadState / saveState) are the ONLY things that touch fs and are
// never in the tested path — a state-file failure must never break a watch pass, so watch.mjs
// guards every call and loadState degrades to {} rather than throw.
//
// State entry shape (one per position key, e.g. "held:27652" / "bid:27652:18000000"):
//   { ts, identity, instabuy, mom, bandTop, breakEven, support,
//     underwater, passesUnderwater, belowSupport, passesBelowSupport, bandTopHist:[] }
// `identity` is a caller-chosen stable string for the position lot/offer (held: qty+avgCost; bid:
// offer price+max). A changed identity, or a gap since the last pass exceeding STALE_GAP_MS, RESETS
// the counters — so `passesUnderwater` (and `passesBelowSupport`) only ever reflect CONSECUTIVE,
// RECENT passes of the SAME position, never a stale count carried across a re-buy or an hours-long
// loop pause. `passesBelowSupport` (V4) mirrors `passesUnderwater` but counts consecutive passes
// whose live instabuy printed below the V2 structural support level — it feeds the arm-then-confirm
// structural-break escalation (convictionGate below).

import fs from 'node:fs';
import { dirname } from 'node:path';

// --- named tunables (NOT magic numbers) ----------------------------------------------------
// A position is considered a NEW episode (counters reset) when the gap since its last observed
// pass exceeds this. ~2× the tightest expected /loop cadence (CADENCE_TIGHT = 1min in watch.mjs,
// but real human loops run minutes apart) → 15 min: two consecutive passes must be recent to count
// as consecutive. Keeps `passesUnderwater` honest across an overnight pause / a closed laptop.
export const STALE_GAP_MS = 15 * 60 * 1000;
// How many recent band-top observations to retain for the drift classification. A short window so
// the trend reflects the CURRENT few passes, not an hour-old level.
export const BANDTOP_HIST = 4;
// Fractional first→last change of the retained band tops below which the band top is "flat".
// Placeholder pending validation (same discipline as the rating.mjs / phase() cutoffs) — a display
// threshold only, it drives no verdict.
export const BANDTOP_FLAT_PCT = 0.003;   // ±0.3%

// A position is underwater when its live instabuy (clear-now price) is below its break-even.
const isUnderwater = o => o != null && o.instabuy != null && o.breakEven != null && o.instabuy < o.breakEven;
// A position is below structural support (V4) when its live instabuy prints under the V2 support
// level. Independent of underwater — a lot can break support while still above its own break-even.
const isBelowSupport = o => o != null && o.instabuy != null && o.support != null && o.instabuy < o.support;

// Reset policy: identity changed (different lot / re-priced offer) OR the gap since the last pass
// is too large to be a consecutive poll. A missing prior is NOT a reset (it's first-seen — handled
// separately so counters INITIALISE rather than reset). now = ms.
export function shouldReset(prior, cur, now) {
  if (!prior) return false;
  if (prior.identity !== (cur && cur.identity != null ? cur.identity : null)) return true;
  if (prior.ts != null && now != null && (now - prior.ts) > STALE_GAP_MS) return true;
  return false;
}

// Classify the band-top drift over a retained history (oldest→newest). <2 points → null (can't say).
// Returns { trend:'rising'|'flat'|'decaying', from, to } | null.
export function classifyBandTop(hist) {
  const h = (hist || []).filter(v => v != null);
  if (h.length < 2) return null;
  const from = h[0], to = h[h.length - 1];
  if (!from) return { trend: 'flat', from, to };
  const chg = (to - from) / from;
  const trend = chg > BANDTOP_FLAT_PCT ? 'rising' : chg < -BANDTOP_FLAT_PCT ? 'decaying' : 'flat';
  return { trend, from, to };
}

/* PURE. Compute the per-item deltas of `cur` (this pass's observation) against `prior` (the stored
   entry from last pass). Never mutates. `cur` = { identity, instabuy, mom, bandTop, breakEven }.
   Returns a flat deltas object:
     { firstSeen, reset, underwater, passesUnderwater, belowSupport, passesBelowSupport,
       instabuyDelta, instabuyDir, gapMs,
       momFrom, momTo, momTransition, momChanged,
       bandTopTrend, bandTopFrom, bandTopTo }
   On a first-sighting OR a reset the cross-pass deltas are null/absent (nothing consecutive to
   compare) — but `passesUnderwater`/`passesBelowSupport` still initialise to 1 when the fresh
   observation is already underwater / below support. */
export function computeDeltas(prior, cur, now) {
  const firstSeen = !prior;
  const reset = shouldReset(prior, cur, now);
  const fresh = firstSeen || reset;
  const underwater = isUnderwater(cur);
  const passesUnderwater = underwater ? ((fresh ? 0 : (prior.passesUnderwater || 0)) + 1) : 0;
  const belowSupport = isBelowSupport(cur);
  const passesBelowSupport = belowSupport ? ((fresh ? 0 : (prior.passesBelowSupport || 0)) + 1) : 0;

  let instabuyDelta = null, instabuyDir = null, gapMs = null;
  if (!fresh && prior.instabuy != null && cur && cur.instabuy != null) {
    instabuyDelta = cur.instabuy - prior.instabuy;
    instabuyDir = instabuyDelta > 0 ? '+' : instabuyDelta < 0 ? '-' : '0';
    gapMs = (prior.ts != null && now != null) ? now - prior.ts : null;
  }

  let momFrom = null, momTo = cur ? (cur.mom ?? null) : null, momTransition = null, momChanged = false;
  if (!fresh) {
    momFrom = prior.mom ?? null;
    momTransition = `${momFrom}→${momTo}`;
    momChanged = momFrom !== momTo;
  }

  let bandTopTrend = null, bandTopFrom = null, bandTopTo = null;
  if (!fresh) {
    const bt = classifyBandTop([...(prior.bandTopHist || []), cur ? cur.bandTop : null]);
    if (bt) { bandTopTrend = bt.trend; bandTopFrom = bt.from; bandTopTo = bt.to; }
  }

  return { firstSeen, reset, underwater, passesUnderwater, belowSupport, passesBelowSupport,
    instabuyDelta, instabuyDir, gapMs,
    momFrom, momTo, momTransition, momChanged,
    bandTopTrend, bandTopFrom, bandTopTo };
}

/* PURE. Produce the NEW stored entry for this pass (the value watch.mjs persists for `cur`'s key).
   Advances the underwater counter and the band-top history under the same reset policy as
   computeDeltas, so the two never disagree. Never mutates its inputs. now = ms. */
export function advanceState(prior, cur, now) {
  const fresh = !prior || shouldReset(prior, cur, now);
  const underwater = isUnderwater(cur);
  const passesUnderwater = underwater ? ((fresh ? 0 : (prior.passesUnderwater || 0)) + 1) : 0;
  const belowSupport = isBelowSupport(cur);
  const passesBelowSupport = belowSupport ? ((fresh ? 0 : (prior.passesBelowSupport || 0)) + 1) : 0;
  const priorHist = fresh ? [] : (prior.bandTopHist || []);
  const bandTopHist = (cur && cur.bandTop != null ? [...priorHist, cur.bandTop] : priorHist).slice(-BANDTOP_HIST);
  return {
    ts: now ?? null,
    identity: cur && cur.identity != null ? cur.identity : null,
    instabuy: cur ? (cur.instabuy ?? null) : null,
    mom: cur ? (cur.mom ?? null) : null,
    bandTop: cur ? (cur.bandTop ?? null) : null,
    breakEven: cur ? (cur.breakEven ?? null) : null,
    support: cur ? (cur.support ?? null) : null,
    underwater,
    passesUnderwater,
    belowSupport,
    passesBelowSupport,
    bandTopHist,
  };
}

/* PURE. The V4 arm-then-confirm ESCALATION decision — decides ONLY whether a held-lot verdict is
   allowed to become a HEADLINE ⚠ ALERT this pass. It does NOT change any verdict string (momVerdict
   is untouched) and NOT any pricing; watch.mjs consumes { escalate, armed, reason } to route an
   escalation into the headline block (escalate) vs. a visible armed NOTE (armed) vs. nothing.

   Inputs (all from the current pass; the cross-pass counts come from computeDeltas):
     verdict, gate          — momVerdict()'s verdict string + gate (e.g. 'CUT-CANDIDATE'/'D', 'CUT'/2)
     passesUnderwater       — consecutive underwater-liquid passes (V1 counter)
     price                  — live instabuy (clear-now price)
     support, cutTrigger    — V2 structural support + the (support−δ) tripwire
     passesBelowSupport     — consecutive passes with price below support (V4 counter)

   PRECEDENCE (highest first):
     1. Gate-2 breakdown CUT — EXEMPT: escalates IMMEDIATELY, unconditionally, never gated. This is
        the byte-identical breakdown invariant — a live 2h breakdown while underwater is not a thing
        to sit on; delaying it is the exact failure that cost the bludgeon exit.
     2. Structural break CONVINCINGLY broken — price ≥δ below support (i.e. below the cut-trigger) OR
        below support for 2 consecutive passes → escalate. Codifies the override-discipline
        "require conviction (0.5% or two passes)"; the direct fix for the 2026-07-06 too-tight
        tripwire (a level broke −0.9% then bounced within one pass — arm-then-confirm would hold).
     3. Gate-D clean-momentum CUT-CANDIDATE — arm-then-confirm: must survive 2 consecutive
        underwater-liquid passes before escalating; the 1st pass ARMS (visible note, not a headline).
     4. A single non-convincing graze of support (below support, not through the trigger, <2 passes)
        → ARM the structural break (visible note), no headline.
   Anything else → neither escalate nor armed. */
export function convictionGate({ verdict, gate, passesUnderwater = 0,
  price = null, support = null, cutTrigger = null, passesBelowSupport = 0 } = {}) {
  // 1. Gate-2 breakdown CUT — EXEMPT (the invariant). Immediate regardless of any conviction count.
  if (verdict === 'CUT' && gate === 2)
    return { escalate: true, armed: false, reason: 'breakdown' };

  const belowSupport = price != null && support != null && price < support;
  const throughTrigger = belowSupport && cutTrigger != null && price < cutTrigger;

  // 2. Structural break convincingly broken → immediate structural escalation.
  if (throughTrigger || (belowSupport && passesBelowSupport >= 2))
    return { escalate: true, armed: false, reason: 'structural' };

  // 3. Gate-D CUT-CANDIDATE — arm on pass 1, escalate on the 2nd consecutive underwater-liquid pass.
  if (verdict === 'CUT-CANDIDATE' && gate === 'D') {
    if (passesUnderwater >= 2) return { escalate: true, armed: false, reason: 'cut-candidate' };
    return { escalate: false, armed: true, reason: 'cut-candidate-armed' };
  }

  // 4. A single non-convincing graze of support → arm (visible note), no headline.
  if (belowSupport) return { escalate: false, armed: true, reason: 'structural-armed' };

  return { escalate: false, armed: false, reason: null };
}

// --- THIN IO (the only fs surface; never in the tested path) -------------------------------
// loadState degrades to {} on ANY failure (missing file, corrupt JSON) — a bad state file must
// never break a pass. saveState writes the whole keyed map compactly, creating .cache/ if needed.
export function loadState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch {
    return {};
  }
}
export function saveState(statePath, state) {
  fs.mkdirSync(dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state ?? {}));
}
