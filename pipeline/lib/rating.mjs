/* rating.mjs — RE-EXPORT SHIM (AP4, 2026-07-10).
 * The desirability-score / letter-grade core MOVED to js/rating.mjs so the app's Finder can grade on
 * the SAME module the pipeline uses (the app↔console parity boundary — shared logic lives in js/, node
 * re-imports it, never forks). This shim keeps every existing pipeline importer (`./lib/rating.mjs`)
 * resolving byte-identically. Do NOT add logic here — edit js/rating.mjs. */
export * from '../../js/rating.mjs';
