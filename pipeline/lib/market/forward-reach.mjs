/* forward-reach.mjs — RE-EXPORT SHIM.
 * The forward-scoring primitives MOVED to js/forward-reach.mjs so the browser-side surface builder
 * (js/reach-surface.mjs) can reach them — js/ never imports pipeline/, so a primitive both sides need
 * has to live in js/. Same boundary and same shim shape as pipeline/lib/signal/estimators.mjs. This
 * keeps every existing pipeline importer resolving byte-identically. Do NOT add logic here — edit
 * js/forward-reach.mjs. */
export * from '../../../js/forward-reach.mjs';
