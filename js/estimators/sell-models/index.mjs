/**
 * estimators/sell-models/index.mjs (PC3, 2026-07-17) — the SELL_TOP_MODELS registry: the named,
 * swappable sell-top proposal models estimatePair dispatches to (the composition seam). Keyed by the
 * name the resolver / --est-sell flag / pipeline-config.json `sellModel` selects:
 *   'reach-fold' — the neutral fold (DEFAULT + always-on shadow). ./reach-fold.mjs.
 *   (later)      — a new variant ships as ONE more line here (e.g. 'safe-quantile', AC3), NOT another
 *                  boolean threading through estimatePair (the anti-pattern PC3 removed).
 *   'pressure'   — RETIRED from exit pricing (join-exit-ev.mjs's pre-registered criterion; CHANGELOG
 *                  0.76.0). ./pressure.mjs deleted, git-revivable; bid/band reads survive.
 *
 * Each value honours the SELL-MODEL CONTRACT in ./reach-fold.mjs (propose(ctx) → { estBuy, buyLo,
 * estSell, sellHi, confidence }; defaultShadow flag). The shell owns the non-skippable floors
 * (ordering clamps, BE floor, declared-exit anchor) — a model only PROPOSES a price.
 */
import { reachFoldModel } from './reach-fold.mjs';

export const SELL_TOP_MODELS = Object.freeze({
  'reach-fold': reachFoldModel,
});

export { reachFoldModel };
