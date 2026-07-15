/* sessionthesis.mjs — #4 session-thesis memory (PLAN-YIELD). A thin persisted per-lane record of
   the agent's INTENT — the thesis for holding an item, the named tripwire, the predicted window — so
   a stateless verdict is read AGAINST the intent instead of re-derived from scratch each pass. Folds
   into #1 as a consumer of the enriched log; persists exactly like watchstate's loadState/saveState.

   The pure state model is fixture-testable (sessionthesis.test.mjs). watch.mjs is a READ-ONLY
   consumer (prints the reminder, never writes); pipeline/commands/declare-thesis.mjs is the sole writer (no
   concurrent-write race). Honesty: a thesis is INTENT the human/agent records — it is never a
   verdict/alert input and decides nothing.

   State shape: { "<itemId>": { thesis, tripwire|null, window|null, setAt(unixSec) } } */
import fs from 'node:fs';

export const THESIS_TTL_DAYS = 14;   // a lane not touched in this long is stale intent → pruned

export function loadThesis(p) {
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
  catch { return {}; }
}
export function saveThesis(p, state) {
  try { fs.writeFileSync(p, JSON.stringify(state || {}, null, 2) + '\n'); } catch {}
}

/* upsert — set/merge a lane's thesis. thesis is the intent string; tripwire/window optional.
   Passing a field updates it; omitting it (undefined) preserves the prior value. */
export function upsertThesis(state, id, { thesis, tripwire, window } = {}, now = Math.floor(Date.now() / 1000)) {
  const s = { ...(state || {}) };
  const prev = s[id] || {};
  s[id] = {
    thesis:   thesis   !== undefined ? thesis   : (prev.thesis   ?? null),
    tripwire: tripwire !== undefined ? tripwire : (prev.tripwire ?? null),
    window:   window   !== undefined ? window   : (prev.window   ?? null),
    setAt: now,
  };
  return s;
}
export function clearThesis(state, id) { const s = { ...(state || {}) }; delete s[id]; return s; }

/* prune — drop lanes whose setAt is older than ttlDays (stale intent) or malformed. */
export function pruneThesis(state, now = Math.floor(Date.now() / 1000), ttlDays = THESIS_TTL_DAYS) {
  const out = {}; const cutoff = now - ttlDays * 86400;
  for (const [id, e] of Object.entries(state || {})) if (e && e.thesis && (e.setAt == null || e.setAt >= cutoff)) out[id] = e;
  return out;
}

/* thesisLine — one-line reminder for a held/bid lane; null when no thesis recorded. */
export function thesisLine(entry) {
  if (!entry || !entry.thesis) return null;
  const bits = [`thesis: ${entry.thesis}`];
  if (entry.tripwire) bits.push(`tripwire ${entry.tripwire}`);
  if (entry.window) bits.push(`window ${entry.window}`);
  return bits.join(' · ');
}
