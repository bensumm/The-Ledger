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

// P5 scalp niche — a DELIBERATE intraday flip on a falling market (Ben's 2026-07-08 amendment: a
// faller is not necessarily a poor buy). The scalp edge wants a WIDER fresh band than the base `band`
// niche: after-tax ROI ≥ SCALP_MIN_ROI (above band's MIN_ROI 1.5%), clearing tax + a real scalp
// margin. Reach-validation against TODAY's high (is the sell level actually printing today?) is the
// P2 reachValidator, which degrades to pass on the screen (no 1h fetch) exactly like every other
// surface. Flip-only / no-hold / hard intraday stop — encoded in the path engine (SCALP_NO_HOLD_PENALTY
// in js/paths.mjs) + offerVerdict's scalp tripwire. PLACEHOLDER (n≈0; the PM2/suggestions accrual tunes it).
export const SCALP_MIN_ROI = 2.0;

// scalp: a TRADED intraday band whose after-tax ROI clears the (wider) scalp margin. Unlike band it
// takes no thin abs-gp fallback — a scalp is a margin play, not a big-ticket gp-flow play.
function scalpEdge(inp, t) {
  const e = bandCore(inp, t);
  if (!e) return null;
  if (e.modeRoi < SCALP_MIN_ROI) return null;   // wide enough to clear tax + a scalp margin
  return e;
}

// value: an after-tax 24h-average amplitude proxy — a conformance-valid, deterministic edge so the
// spec passes the strategies.test.mjs edge sweep. NOTE: the value NICHE does NOT select on this edge;
// its selection is the term-structure `valueGate` (js/valuescreen.mjs), routed by `gate: 'value'` in
// pipeline/lib/gatecandidates.mjs. This function is the "cheap cycle-amplitude proxy" kept only so the
// registry contract (every spec has a callable edge) holds uniformly. Never gates.
function valueEdge({ avgHigh, avgLow }, t) {
  const modeNet = (avgHigh - tax(avgHigh)) - avgLow;
  const modeRoi = avgLow ? modeNet / avgLow * 100 : 0;
  return { modeNet, modeRoi, activeWin: null };
}

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
     inAll       part of `--mode all` (NY3, Ben 2026-07-09: churn IN, spread OUT — reverses NY2.2/NY2.3.
                 Rationale from the one-thesis-at-a-time scan: spread's 24h-average edge is structurally
                 narrower than the intraday band + kept surfacing mis-shelved risers with ~0 clean flips;
                 churn's high-volume commodity lane (the rune staples) deserves default visibility. So
                 --mode all is now band/rising/churn.)
     pool        pre-fetch pool rule: { risingFloor } — apply risingPoolFloor (NY2.1) before fetch
     edge        (inputs, thresholds) → { modeNet, modeRoi, activeWin } | null  (the step-3 edge)
     rank        fetch-pool ordering: 'proxy' (rising — proxy-drift-first) | 'velocity' (default)
     confirm     post-fetch survival note ('rising' | null) — DESCRIPTIVE. The rising-confirm/posture
                 doctrine still lives in surviveMode keyed on mode; this field documents the coupling.
     falling     the PER-SPEC falling doctrine (P5 — the amended, no-longer-global rule). surviveMode
                 reads THIS instead of a hardcoded exclusion:
                   'exclude'     — falling ⇒ dropped (unless --phase-rescue basing). The four original
                                   niches keep this → byte-identical behavior (the replay goldens pin it).
                   'accept'      — falling is a valid candidate (scalp EXPECTS a falling wide band; Ben's
                                   2026-07-08 amendment). Not dropped for the regime alone.
                   'knife-guard' — value: reject a real decay/downtrend knife but ACCEPT a flat/basing
                                   value-low (handled in the term-structure valueGate, not surviveMode).
     gate        'band' (default — the shared liquidity+edge pre-fetch stack) | 'value' (the
                 term-structure valueGate in js/valuescreen.mjs; gateCandidates routes on this).
     validators  the PER-THESIS validator PLAN (Ben 2026-07-09 — no longer dormant metadata; screen.mjs
                 now drives runValidators off THIS instead of the full registry). Each entry is either a
                 bare key string (gate mode) or { key, mode:'gate'|'inform', window? }:
                   gate   — the validator's verdict stands (caution flags, reject drops the row).
                   inform — COMPUTED + annotated but never downgrades (status clamped to pass, the
                            would-have verdict logged for the track record). The noise reconciliation:
                            the swing/local-min/knife/reach ANALYSIS is useful to every thesis, but only
                            a thesis that GATES on a key lets it hide a row — so scalp INFORMS on
                            trajectory (it accepts a falling wide band by thesis) while band could gate.
                   window — reach-only { windowHours, nights }: the thesis's reach HORIZON (a band/scalp
                            8h flip window vs value's full-day week+ daily-min TIMING read). Omitted ⇒
                            reachValidator's default 8h/14-night.
                 ROLLOUT (rule 4 — n≈0): the newly-activated validators (reach, trajectory,
                 value-amplitude) start INFORM everywhere; only the already-live floor + limit gates gate.
                 Flipping a cell to gate is a one-word change once its notes prove out against live data.
     defaultPath the inferred DEFAULT ENTRY PATH the surfacing implies (Ben-vetoable; see header).
     estimator   (P6b) the per-thesis P(fill)+TTF estimator FAMILY key — one of pipeline/lib/
                 estimators.mjs's ESTIMATOR_FAMILIES ('intraday' | 'value' | 'rising'). The niche's
                 rank = net × P(fill) ÷ TTF is computed by that family's estimators (the demoted
                 expGpDay is no longer the ranked/displayed "best" — Ben, 2026-07-09). Just a family
                 STRING here (data); the estimator functions + registry live in pipeline/lib.
     priceBasis  (P6b) the ONE price pair the thesis posts — the price-basis principle: net, P(fill),
                 TTF are ALL evaluated at this pair. 'quick' = the live quick pair (transact-now,
                 spread); 'opt' = the patient 2h band edges (band/rising/churn/scalp); 'term' = the
                 term-structure floor→recovery pair the value surface computes itself (valuescreen). */
export const STRATEGY_LIST = Object.freeze([
  {
    key: 'band', label: 'Band', inAll: true,
    pool: { risingFloor: false }, edge: bandEdge, rank: 'velocity', confirm: null,
    falling: 'exclude', gate: 'band',
    validators: [{ key: 'floor', mode: 'gate' }, { key: 'reach', mode: 'inform' }, { key: 'trajectory', mode: 'inform' }, { key: 'limit', mode: 'gate' }],
    defaultPath: PATH_KEYS.SCALP, estimator: 'intraday', priceBasis: 'opt',
  },
  {
    key: 'spread', label: 'Spread', inAll: false,   // NY3 (Ben 2026-07-09) — off-by-default; reach with explicit --mode spread
    pool: { risingFloor: false }, edge: spreadEdge, rank: 'velocity', confirm: null,
    falling: 'exclude', gate: 'band',
    validators: [{ key: 'floor', mode: 'gate' }, { key: 'reach', mode: 'inform' }, { key: 'trajectory', mode: 'inform' }, { key: 'limit', mode: 'gate' }],
    defaultPath: PATH_KEYS.SCALP, estimator: 'intraday', priceBasis: 'quick',
  },
  {
    key: 'rising', label: 'Rising', inAll: true,
    pool: { risingFloor: true }, edge: bandEdge, rank: 'proxy', confirm: 'rising',
    falling: 'exclude', gate: 'band',
    validators: [{ key: 'floor', mode: 'gate' }, { key: 'reach', mode: 'inform' }, { key: 'trajectory', mode: 'inform' }, { key: 'limit', mode: 'gate' }],
    defaultPath: PATH_KEYS.VALUE_HOLD, estimator: 'rising', priceBasis: 'opt',
  },
  {
    key: 'churn', label: 'Churn', inAll: true,   // NY3 (Ben 2026-07-09) — default-on again (reverses NY2.2); the high-volume commodity lane
    pool: { risingFloor: false }, edge: churnEdge, rank: 'velocity', confirm: null,
    falling: 'exclude', gate: 'band',
    validators: [{ key: 'floor', mode: 'gate' }, { key: 'reach', mode: 'inform' }, { key: 'trajectory', mode: 'inform' }, { key: 'limit', mode: 'gate' }],
    defaultPath: PATH_KEYS.SCALP, estimator: 'intraday', priceBasis: 'opt',
  },
  {
    key: 'scalp', label: 'Scalp', inAll: false,   // P5 — off-by-default; explicit --mode scalp only (provisional, n≈0)
    pool: { risingFloor: false }, edge: scalpEdge, rank: 'velocity', confirm: null,
    // scalp accepts a falling wide band by thesis → trajectory + floor INFORM only (never veto a scalp for
    // being a faller; its stop lives in the path engine / offerVerdict, not a screen gate).
    falling: 'accept', gate: 'band',
    validators: [{ key: 'floor', mode: 'inform' }, { key: 'reach', mode: 'inform' }, { key: 'trajectory', mode: 'inform' }, { key: 'limit', mode: 'gate' }],
    defaultPath: PATH_KEYS.SCALP, estimator: 'intraday', priceBasis: 'opt',
  },
  {
    key: 'value', label: 'Value', inAll: false,   // P5 — off-by-default; explicit --mode value only (provisional, n≈0)
    pool: { risingFloor: false }, edge: valueEdge, rank: 'value', confirm: null,
    // value KEEPS reach — as a full-day week+ daily-min TIMING read (windowHours 24 / 14 nights), not an
    // 8h flip check: it finds WHEN the recent-week low prints so the entry is timed (Hydra/Berserker).
    // value-amplitude is value's own recent-week cycle+proximity check. All inform in the n≈0 rollout.
    falling: 'knife-guard', gate: 'value',
    validators: [
      { key: 'floor', mode: 'gate' },
      { key: 'reach', mode: 'inform', window: { windowHours: 24, nights: 14 } },
      // trajectory GATES in value (Ben 2026-07-09): a KNIFE drops. Value's defining thesis is "buy the
      // base, never the knife", and a multi-week HOLD makes buying a knife cost far more than missing one
      // (asymmetry) — so this is the one niche where the knife verdict is a thesis violation, not a nuance,
      // and it graduates from inform→gate ahead of the others. It catches the knives valueGate's weaker
      // term-structure knifeDelta misses (Inoculation bracelet, Zombie axe). `elevated` stays a caution
      // flag (a timing note, not a drop); oscillating/based/rising pass. A dropped knife is NAMED in the
      // §F footer (renderValueMode), so it leaves buy-now but stays auditable. Value-scoped: band/rising
      // already exclude fallers, scalp accepts them — trajectory stays inform there.
      { key: 'trajectory', mode: 'gate' },
      { key: 'value-amplitude', mode: 'inform' },
      { key: 'limit', mode: 'gate' },
    ],
    defaultPath: PATH_KEYS.VALUE_HOLD, estimator: 'value', priceBasis: 'term',
  },
]);

// by-key map + the ordered mode-name lists screen.mjs derives from the registry (so the niche names
// live in ONE place — the registry — not as a magic-string array in screen.mjs).
export const STRATEGIES = Object.freeze(Object.fromEntries(STRATEGY_LIST.map(s => [s.key, s])));
export const MODE_KEYS = Object.freeze(STRATEGY_LIST.map(s => s.key));                       // ['band','spread','rising','churn','scalp','value']
export const ALL_MODE_KEYS = Object.freeze(STRATEGY_LIST.filter(s => s.inAll).map(s => s.key)); // NY3 (Ben 2026-07-09): band/rising/churn in --mode all (spread + P5 scalp/value explicit-only)

/* --- conformance ----------------------------------------------------------------------------------
   validateStrategySpec(spec) → string[] of structural violations (empty = conformant). The conformance
   suite (strategies.test.mjs) iterates STRATEGY_LIST asserting no violations, feeds a deliberately
   malformed spec to prove the checker BITES, and runs each edge over the replay archetypes for
   no-throw + determinism — so P5 registering scalp/value gets conformance-checked for free. */
const VALID_PATH_KEYS = new Set(Object.values(PATH_KEYS));
const VALID_RANKS = new Set(['velocity', 'proxy', 'value']);
const VALID_FALLING = new Set(['exclude', 'accept', 'knife-guard']);   // P5 per-spec falling doctrine
const VALID_GATE = new Set(['band', 'value']);                          // P5 gate-stack selector
// P6b — the estimator family + price-basis vocabularies. VALID_ESTIMATORS mirrors pipeline/lib/
// estimators.mjs's ESTIMATOR_FAMILIES (the runtime registry there is the home; this Set exists so a
// typo'd family name is caught by conformance instead of silently defaulting to intraday in production).
const VALID_ESTIMATORS = new Set(['intraday', 'value', 'rising']);
const VALID_PRICE_BASIS = new Set(['quick', 'opt', 'term']);
// The validator KEYS a spec may name + the gate/inform modes. Kept as a local literal (NOT imported
// from js/validate.mjs) so this registry stays near-dependency-free / app-bundle-light; the SOURCE OF
// TRUTH is validate.mjs's REGISTRY_ORDER — the conformance test cross-checks the two so drift bites.
const VALID_VALIDATOR_KEYS = new Set(['reach', 'floor', 'trajectory', 'value-amplitude', 'limit']);
const VALID_VALIDATOR_MODES = new Set(['gate', 'inform']);

/* a validators[] entry is a bare key string OR { key, mode?, window? }. Returns a violation string or null. */
function validatorEntryError(v) {
  const key = typeof v === 'string' ? v : (v && v.key);
  if (!key || !VALID_VALIDATOR_KEYS.has(key)) return `validators entry has invalid key ${JSON.stringify(key)}`;
  if (typeof v === 'string') return null;
  if (v.mode != null && !VALID_VALIDATOR_MODES.has(v.mode)) return `validators[${key}].mode must be gate/inform`;
  if (v.window != null) {
    if (typeof v.window !== 'object') return `validators[${key}].window must be an object`;
    for (const f of ['windowHours', 'nights'])
      if (v.window[f] != null && typeof v.window[f] !== 'number') return `validators[${key}].window.${f} must be a number`;
  }
  return null;
}

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
  if (!VALID_FALLING.has(spec.falling)) errs.push(`falling must be one of ${[...VALID_FALLING].join('/')}`);
  if (!VALID_GATE.has(spec.gate)) errs.push(`gate must be one of ${[...VALID_GATE].join('/')}`);
  if (!(spec.confirm === null || typeof spec.confirm === 'string')) errs.push('confirm must be a string or null');
  if (!Array.isArray(spec.validators)) errs.push('validators must be an array');
  else for (const v of spec.validators) { const e = validatorEntryError(v); if (e) errs.push(e); }
  if (typeof spec.defaultPath !== 'string' || !VALID_PATH_KEYS.has(spec.defaultPath))
    errs.push('defaultPath must be a key in paths.mjs PATH_KEYS');
  else if (!ENTRY_PATH_KEYS.includes(spec.defaultPath))
    errs.push('defaultPath must be an ENTRY (unheld-enumerable) path key: ' + ENTRY_PATH_KEYS.join('/'));
  if (!VALID_ESTIMATORS.has(spec.estimator)) errs.push(`estimator must be one of ${[...VALID_ESTIMATORS].join('/')}`);
  if (!VALID_PRICE_BASIS.has(spec.priceBasis)) errs.push(`priceBasis must be one of ${[...VALID_PRICE_BASIS].join('/')}`);
  return errs;
}
