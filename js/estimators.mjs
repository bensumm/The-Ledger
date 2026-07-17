/**
 * estimators.mjs — the BARREL (PC2, 2026-07-17). This file used to hold the whole 659-line estimator
 * core; it was split into `js/estimators/` and now re-exports every symbol so EVERY existing import
 * path stays valid, byte-for-byte — the app's `js/market.js` (`import { estimateRank }`) and the
 * pipeline shim `pipeline/lib/estimators.mjs` (`export * from '../../js/estimators.mjs'`) are unchanged.
 *
 * The split (one concept per file; full doctrine + evidence comments live in each):
 *   ./estimators/families.mjs  the P(fill)/TTF family estimators (pFill/ttf families, churnLapUnits), the
 *                              ESTIMATORS registry + estimatorFor, quotedPair, rankScore, estimateRank,
 *                              fmtTtf. Carries the module's founding header (why gp/d was demoted, the
 *                              price-basis principle, the family list, PURITY).
 *   ./estimators/reach.mjs     the reach-conditioning helpers: reachRelief (+ its liquidity/size
 *                              constants), dayHighFrom5m, askReachFactor, asymEstimate.
 *   ./estimators/pair.mjs      the reconciliation price estimator: entryDoctrine + estimatePair (the
 *                              ordering SHELL/spine only — declared-exit anchor → model proposal →
 *                              nudge → ordering clamps → BE floor). Re-exports the EST_* constants +
 *                              SELL_TOP_MODELS for this barrel.
 *   ./estimators/sell-models/  the named, swappable sell-top PROPOSAL models estimatePair dispatches to
 *                              (PC3): index.mjs (the SELL_TOP_MODELS registry), reach-fold.mjs (the
 *                              neutral fold — DEFAULT + always-on shadow; owns the model CONTRACT header
 *                              + EST_REACH_SAT_FRAC/EST_BLEND_EQUAL_WEIGHTS), pressure.mjs (the PB4
 *                              pressure-exit trial + PRESSURE_EXIT_REL_FULL). A new sell-top variant is a
 *                              file + one registry line, NOT a boolean threading through estimatePair.
 *   ./estimators/cells.mjs     the render/shadow projections: EST_HEADERS, estPairCells, estConfLean.
 *
 * NOTE the families↔reach edge is a runtime function-reference cycle (reach's asymEstimate calls
 * families' estimatorFor/rankScore; families' estimateRank calls reach's askReachFactor) — ESM handles
 * it because every use is at call time, not module-evaluation top level. Do NOT add logic to this
 * barrel — it is re-exports only; edit the split files.
 */
export * from './estimators/families.mjs';
export * from './estimators/reach.mjs';
export * from './estimators/pair.mjs';
export * from './estimators/cells.mjs';
