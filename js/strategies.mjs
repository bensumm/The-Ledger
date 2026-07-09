/* strategies.mjs — the DECLARATIVE STRATEGY REGISTRY (Pipeline v2, chunk P4c).
   DOM-free, near-dependency-free ESM (imports only the pure `tax` from format.js + the path
   vocabulary from paths.mjs — no fetch/fs, no window/document), importable by BOTH the browser app
   AND the node pipeline exactly like js/quotecore.js / js/paths.mjs. Keep it that way.

   WHAT THIS IS. Before P4c the screen's four niches (band / spread / rising / churn) lived as
   imperative `if (mode === 'spread') … else …` branches inside pipeline/lib/gatecandidates.mjs — the
   niche name was a magic string threaded through the gate stack, the fetch-pool ranker, and the
   post-fetch survival doctrine. P4c re-expresses each niche as a DATA-SHAPED SPEC here: the per-mode
   EDGE definition, the pre-fetch pool rule, the fetch-pool ranking mode, and the inferred DEFAULT
   ENTRY PATH the surfacing implies. gatecandidates.mjs now looks up `STRATEGIES[mode]` and calls
   `spec.edge(...)` / reads `spec.pool` / `spec.rank` instead of branching on the name — so P5 can add
   the scalp/value specs (and the per-spec falling gates of the amended doctrine) by REGISTERING a new
   spec, WITHOUT editing gatecandidates.mjs or screen.mjs again.

   BYTE-IDENTITY (the refactor-proof). The edge functions below are a MECHANICAL re-expression of the
   exact inline blocks gatecandidates.mjs used to run — same tax math, same gate order, same `continue`
   points (a `continue` is now a `return null`). The P1 replay goldens (pipeline/fixtures/replay/
   golden.json) must pass UNCHANGED after this refactor; any behavior delta is a defect. The pre-P5
   falling-exclusion still lives in gatecandidates.mjs's surviveMode (unchanged here) — the amended
   per-spec falling doctrine is P5, and this registry is the seam it slots into.

   ⚠ The DEFAULT ENTRY PATH per niche (band/spread/churn → scalp, rising → value-hold) is a JUDGMENT
   proposal (Ben-vetoable) — it encodes how /scan describes each niche's INTENT (band/spread/churn are
   flip-first "buy the low, sell the top" plays → the intraday `scalp` thesis; rising is a "size-small,
   mid-reprice move" you hold through the froth → the `value-hold` thesis). It is written to the
   suggestions ledger as the inferred entry thesis so a LATER fill can attribute a position to a thesis
   when no explicit `thesis.mjs set --path` was declared (the P4b fallback: explicit > inferred > null).
   It is NOT a gate and does not affect which rows surface. */

import { tax } from './format.js';
import { PATH_KEYS } from './paths.mjs';

// The entry (unheld) thesis vocabulary — the ONLY path keys enumeratePaths() offers a fresh candidate.
// A surfacing spec's defaultPath must be one of these (a surfaced row is, by definition, unheld).
export const ENTRY_PATH_KEYS = Object.freeze([PATH_KEYS.SCALP, PATH_KEYS.VALUE_HOLD, PATH_KEYS.AVOID]);

// The churn volume floor — a buy-limit-cycle commodity must trade this many two-sided units/day AND
// have a real buy limit. Byte-identical to the `limitVol >= 2000 && limit > 0` gate the old inline
// churn branch ran; named here so the number has one home.
export const CHURN_MIN_VOL = 2000;

/* --- edge functions (pure; the spec's step-3 edge, re-expressed verbatim from gatecandidates.mjs) ---
   Each takes ({ avgHigh, avgLow, band, limitVol, limit, thin }, thresholds) and returns either
     { modeNet, modeRoi, activeWin }   (the row's after-tax edge + traded-window count, or null win)
   or null when the item fails this niche's edge/gate (the old `continue`). `band` is the aggregated
   2h band record { bandLo, bandHi, active5m } or undefined (spread never reads it). ALL numeric math
   is the shared `tax()` so the numbers stay byte-identical to screen.mjs / the app. */

// spread: after-tax ROI of the 24h-average spread (the original bludgeon-style screen).
function spreadEdge({ avgHigh, avgLow, thin }, t) {
  const modeNet = (avgHigh - tax(avgHigh)) - avgLow;
  const modeRoi = modeNet / avgLow * 100;
  if (modeRoi < t.MIN_ROI && !(thin && modeNet >= t.MIN_NET_GP)) return null;   // %-ROI OR (thin & abs-gp)
  return { modeNet, modeRoi, activeWin: null };
}

// the traded-band common core (band / rising / churn all price the edge off the intraday band).
// Returns the band edge + activeWin, or null when the band is missing/untraded. The per-spec gate
// (ROI vs volume) is applied by the caller edge below.
function bandCore({ band, thin }, t) {
  if (!band || band.bandLo == null || band.bandHi == null) return null;
  const minActive = thin ? t.MIN_ACTIVE_THIN : t.MIN_ACTIVE;   // 6/2h is impossible at ~12/d — relax for thin
  if (band.active5m < minActive) return null;                  // band must be TRADED, not one spike
  const modeNet = (band.bandHi - tax(band.bandHi)) - band.bandLo;   // band low → band top, after tax
  const modeRoi = modeNet / band.bandLo * 100;
  return { modeNet, modeRoi, activeWin: band.active5m };
}

// band / rising: the traded band + the %-ROI OR (thin & abs-gp) gate.
function bandEdge(inp, t) {
  const e = bandCore(inp, t);
  if (!e) return null;
  if (e.modeRoi < t.MIN_ROI && !(inp.thin && e.modeNet >= t.MIN_NET_GP)) return null;
  return e;
}

// churn: the traded band + a buy-limit-cycle commodity gate (volume+limit); NO %-ROI gate — tiny
// per-unit margin is accepted, volume does the work.
function churnEdge(inp, t) {
  const e = bandCore(inp, t);
  if (!e) return null;
  if (!(inp.limitVol >= CHURN_MIN_VOL && inp.limit != null && inp.limit > 0)) return null;
  return e;
}

/* --- the registry ---------------------------------------------------------------------------------
   Each spec's SHAPE (validated by validateStrategySpec + the conformance suite):
     key         stable niche id (the --mode value)
     label       display name
     inAll       part of `--mode all` (NY2.2: churn is off-by-default → false)
     pool        pre-fetch pool rule: { risingFloor } — apply risingPoolFloor (NY2.1) before fetch
     edge        (inputs, thresholds) → { modeNet, modeRoi, activeWin } | null  (the step-3 edge)
     rank        fetch-pool ordering: 'proxy' (rising — proxy-drift-first) | 'velocity' (default)
     confirm     post-fetch survival note ('rising' | null) — DESCRIPTIVE. The survival doctrine
                 (falling-exclusion / rising-confirm / posture) still lives in surviveMode keyed on
                 mode; this field documents the coupling and is the P5 seam for per-spec gates.
     validators  validator keys this niche EXPECTS to run (metadata for P5 — screen.mjs still runs the
                 full js/validate.mjs registry on every surface today; [] = the shared default stack).
     defaultPath the inferred DEFAULT ENTRY PATH the surfacing implies (Ben-vetoable; see header). */
export const STRATEGY_LIST = Object.freeze([
  {
    key: 'band', label: 'Band', inAll: true,
    pool: { risingFloor: false }, edge: bandEdge, rank: 'velocity', confirm: null,
    validators: [], defaultPath: PATH_KEYS.SCALP,
  },
  {
    key: 'spread', label: 'Spread', inAll: true,
    pool: { risingFloor: false }, edge: spreadEdge, rank: 'velocity', confirm: null,
    validators: [], defaultPath: PATH_KEYS.SCALP,
  },
  {
    key: 'rising', label: 'Rising', inAll: true,
    pool: { risingFloor: true }, edge: bandEdge, rank: 'proxy', confirm: 'rising',
    validators: [], defaultPath: PATH_KEYS.VALUE_HOLD,
  },
  {
    key: 'churn', label: 'Churn', inAll: false,   // NY2.2 — off-by-default; reach with explicit --mode churn
    pool: { risingFloor: false }, edge: churnEdge, rank: 'velocity', confirm: null,
    validators: [], defaultPath: PATH_KEYS.SCALP,
  },
]);

// by-key map + the ordered mode-name lists screen.mjs derives from the registry (so the niche names
// live in ONE place — the registry — not as a magic-string array in screen.mjs).
export const STRATEGIES = Object.freeze(Object.fromEntries(STRATEGY_LIST.map(s => [s.key, s])));
export const MODE_KEYS = Object.freeze(STRATEGY_LIST.map(s => s.key));                       // ['band','spread','rising','churn']
export const ALL_MODE_KEYS = Object.freeze(STRATEGY_LIST.filter(s => s.inAll).map(s => s.key)); // NY2.2: churn excluded

/* --- conformance ----------------------------------------------------------------------------------
   validateStrategySpec(spec) → string[] of structural violations (empty = conformant). The conformance
   suite (strategies.test.mjs) iterates STRATEGY_LIST asserting no violations, feeds a deliberately
   malformed spec to prove the checker BITES, and runs each edge over the replay archetypes for
   no-throw + determinism — so P5 registering scalp/value gets conformance-checked for free. */
const VALID_PATH_KEYS = new Set(Object.values(PATH_KEYS));
const VALID_RANKS = new Set(['velocity', 'proxy']);

export function validateStrategySpec(spec) {
  const errs = [];
  if (!spec || typeof spec !== 'object') return ['spec is not an object'];
  if (typeof spec.key !== 'string' || !spec.key) errs.push('key must be a non-empty string');
  if (typeof spec.label !== 'string' || !spec.label) errs.push('label must be a non-empty string');
  if (typeof spec.inAll !== 'boolean') errs.push('inAll must be a boolean');
  if (!spec.pool || typeof spec.pool !== 'object') errs.push('pool must be an object');
  else if (typeof spec.pool.risingFloor !== 'boolean') errs.push('pool.risingFloor must be a boolean');
  if (typeof spec.edge !== 'function') errs.push('edge must be a function');
  else if (spec.edge.length < 1) errs.push('edge must take (inputs, thresholds)');
  if (!VALID_RANKS.has(spec.rank)) errs.push(`rank must be one of ${[...VALID_RANKS].join('/')}`);
  if (!(spec.confirm === null || typeof spec.confirm === 'string')) errs.push('confirm must be a string or null');
  if (!Array.isArray(spec.validators)) errs.push('validators must be an array');
  if (typeof spec.defaultPath !== 'string' || !VALID_PATH_KEYS.has(spec.defaultPath))
    errs.push('defaultPath must be a key in paths.mjs PATH_KEYS');
  else if (!ENTRY_PATH_KEYS.includes(spec.defaultPath))
    errs.push('defaultPath must be an ENTRY (unheld-enumerable) path key: ' + ENTRY_PATH_KEYS.join('/'));
  return errs;
}
