/* holdthesis.mjs — TG1: the AGENT-WRITTEN declared-hold-thesis store (the greenlist pattern).
 *
 * The problem it solves. watch.mjs's UNDERWATER / CUT-CANDIDATE headline measures the live instabuy
 * against BREAK-EVEN. But a patient / accumulation hold is DEFINITIONALLY underwater on the
 * instant-clear from the moment its bid fills — so the headline cries wolf every pass on a lot where
 * being underwater IS the plan (Ben, 2026-07-07: "I'm tired of being told I'm underwater when that's
 * the plan from the start"). The real risk on such a lot isn't break-even, it's the TRIPWIRE (the
 * declared structural break level, e.g. nest 4,678). A declared thesis silences the expected-underwater
 * HEADLINE while the live price holds above the tripwire, and lets the headline fire once it breaks.
 *
 * Where the gating decision lives: NOT here. This module is only the store (load / lookup / write).
 * The decision is the thesis branch of convictionGate() (pipeline/lib/watchstate.mjs) — the layer that
 * already owns headline-vs-quiet-note escalation (V4/V7). momVerdict() (js/quotecore.js) is UNTOUCHED:
 * the verdict stays honest (you ARE underwater vs the instant-clear); only the headline is gated.
 *
 * AGENT-WRITTEN, watch-READ-ONLY (the greenlist pattern, exactly like ignored-items.json's greenlist).
 * When Ben declares a hold plan ("accumulate nest, exit 4,848, tripwire 4,678, multi-day"), the agent
 * APPENDS/UPSERTS an entry via upsertThesis() (or hand-edits the JSON). watch.mjs only ever READS it —
 * it is a DECLARATION, never mutates fills/positions, and watch stays read-only. It is a verdict/alert
 * input ONLY through the convictionGate thesis branch (the one deliberate exception, and only to
 * SILENCE a known-expected signal — never to manufacture a new one; honesty rule 4).
 *
 * TRACKED at repo root as hold-thesis.json (deliberately NOT gitignored, unlike YT1's session-thesis
 * .cache file). A declared multi-day hold plan must survive across sessions and machines and is
 * agent-written like watchlist.json / ignored-items.json's greenlist — a session-scoped gitignored
 * cache would silently forget the plan on the next machine. It carries item ids/prices only (no PII).
 *
 * Store shape: a flat ARRAY of entries (mirrors the greenlist), one per declared lot:
 *   { id, exitPrice, tripwire, horizon, path, enteredUnder, ts }
 *     id           — item id (number)
 *     exitPrice    — the declared target sell (gp); display only
 *     tripwire     — the declared structural break level (gp); THE gating level
 *     horizon      — free-text plan horizon ("multi-day", "overnight", …); display only
 *     path         — (P4a, optional) the CURRENT declared path key for the lot (js/paths.mjs
 *                    PATH_KEYS — 'value-hold' / 'hold-recovery' / …); null when undeclared
 *     enteredUnder — (P4a, optional) the path key the lot was ENTERED under; feeds the path
 *                    engine's MIGRATION flag (dominant ≠ enteredUnder); null when undeclared
 *     ts           — unix SECONDS the entry was declared; drives TTL expiry
 * An entry with no numeric tripwire cannot gate (thesisFor still returns it for display, but the
 * convictionGate branch no-ops without a tripwire — safe-degrade to today's behavior).
 *
 * BACK-COMPAT (P4a): path/enteredUnder are ADDITIVE + optional. LEGACY entries written before P4a
 * (no path/enteredUnder keys) stay fully valid everywhere — load/lookup/prune never read them, and
 * upsertThesis defaults both to null. The path engine treats a missing path/enteredUnder as
 * "undeclared" (no migration signal), exactly the degrade-not-throw contract js/paths.mjs relies on.
 */
import fs from 'node:fs';

export const HOLD_THESIS_TTL_DAYS = 14;   // a declared plan older than this is stale intent → pruned

/* loadHoldThesis — read the tracked store. Degrades to [] on ANY failure (missing / corrupt) so a
   bad store file can never break a watch pass — matches watchstate.loadState's degrade-not-throw. */
export function loadHoldThesis(p) {
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(o) ? o : []; }
  catch { return []; }
}
/* saveHoldThesis — write the whole array back (pretty, trailing newline) for a clean tracked diff. */
export function saveHoldThesis(p, store) {
  try { fs.writeFileSync(p, JSON.stringify(store || [], null, 2) + '\n'); } catch {}
}

/* thesisFor — the active declared thesis for an item id (the most-recently-declared if several),
   or null. PURE. This is watch.mjs's only read path. */
export function thesisFor(store, id) {
  const matches = (store || []).filter(e => e && e.id === id);
  if (!matches.length) return null;
  return matches.reduce((a, b) => ((b.ts ?? 0) >= (a.ts ?? 0) ? b : a));
}

/* upsertThesis — the agent's write path: replace any existing entry for the id, else append. PURE
   (returns a new array). tripwire/exitPrice/horizon/path/enteredUnder default to null; ts stamps the
   declaration. path/enteredUnder (P4a) are additive — omitting them writes a null-valued but
   fully-shaped entry, so a store of new-shape entries reads identically to the legacy shape wherever
   those keys go unused. */
export function upsertThesis(store,
  { id, exitPrice = null, tripwire = null, horizon = null, path = null, enteredUnder = null } = {},
  now = Math.floor(Date.now() / 1000)) {
  const rest = (store || []).filter(e => !(e && e.id === id));
  return [...rest, { id, exitPrice, tripwire, horizon, path, enteredUnder, ts: now }];
}

/* clearThesis — drop every entry for an id (the plan is done / abandoned). PURE. */
export function clearThesis(store, id) { return (store || []).filter(e => !(e && e.id === id)); }

/* pruneHoldThesis — drop entries older than ttlDays (stale declared intent) or malformed. PURE.
   watch.mjs prunes on read so a forgotten plan can't silence forever. */
export function pruneHoldThesis(store, now = Math.floor(Date.now() / 1000), ttlDays = HOLD_THESIS_TTL_DAYS) {
  const cutoff = now - ttlDays * 86400;
  return (store || []).filter(e => e && e.id != null && (e.ts == null || e.ts >= cutoff));
}
