/**
 * estimators/sell-models/index.mjs (PC3, 2026-07-17) — the SELL_TOP_MODELS registry: the named,
 * swappable sell-top proposal models estimatePair dispatches to (the composition seam Ben asked for —
 * "each estimator has its own file, a layer on top picks which runs"). Keyed by the name the resolver /
 * --est-sell flag / pipeline-config.json `sellModel` selects:
 *   'reach-fold' — the neutral fold (DEFAULT + always-on shadow). ./reach-fold.mjs.
 *   'pressure'   — the PB4 pressure-exit trial (opt-in, never published). ./pressure.mjs.
 *   (later)      — 'safe-quantile' ships as ONE more line here (PLAN-REACH-CALIBRATION AC3), NOT another
 *                  boolean threading through estimatePair — that boolean-flag anti-pattern is what PC3 removed.
 *
 * Each value is a model object honouring the SELL-MODEL CONTRACT documented in ./reach-fold.mjs
 * (propose(ctx) → { estBuy, buyLo, estSell, sellHi, confidence }; defaultShadow flag). The shell owns the
 * non-skippable floors (ordering clamps, BE floor, declared-exit anchor) — a model only PROPOSES a price.
 */
import { reachFoldModel } from './reach-fold.mjs';
import { pressureModel } from './pressure.mjs';

export const SELL_TOP_MODELS = Object.freeze({
  'reach-fold': reachFoldModel,
  'pressure': pressureModel,
});

export { reachFoldModel, pressureModel };
