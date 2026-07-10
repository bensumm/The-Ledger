/* estimators.mjs — RE-EXPORT SHIM (AP4, 2026-07-10).
 * The estimator/rank core MOVED to js/estimators.mjs so the app's Finder can rank/grade on the SAME
 * module the pipeline uses (the app↔console parity boundary — shared logic lives in js/, node
 * re-imports it, never forks). This shim keeps every existing pipeline importer
 * (`./lib/estimators.mjs`) resolving byte-identically. Do NOT add logic here — edit js/estimators.mjs. */
export * from '../../js/estimators.mjs';
