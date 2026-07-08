/* modules.mjs — the probe-module LOADER + stage-keyed runner (PM1).
 *
 * WHAT A PROBE IS. A *probe* is an experimental, per-item ANNOTATION — the lightweight cousin of a
 * niche. A niche is a permanent, validated candidate MODE (band/spread/rising, heavy, in screen.mjs);
 * a probe is a trial-and-keep-or-drop THEORY you can see in the output and DELETE cleanly if it's
 * wrong. Each probe lives in ONE file `pipeline/modules/<name>.mjs` and is discovered by presence:
 * drop the file in → enabled; delete it → gone without a trace. That removability is the whole point,
 * and it is guaranteed by the empty-passthrough contract below.
 *
 * A PROBE HOOKS A NAMED PIPELINE STAGE (not "just annotates a row"). The pipeline is a sequence:
 *   fetch → gate → observe (derive the row) → rate → price (form the recommendation) → render
 * and a probe registers at ONE stage with that stage's input/output contract:
 *
 *   stage      | probe(...) signature                    | returns            | seed probes
 *   -----------|-----------------------------------------|--------------------|---------------------
 *   'observe'  | probe(row, ctx)                          | {tag, note?}|null  | dip, froth, decant
 *   'price'    | probe(row, {side, proposed}, ctx)        | {price, reason}|null | anchor
 *   'gate'     | probe(candidate, ctx)  (FUTURE)          | {admit, reason}|null | (phase-rescue)
 *
 * MODULE SHAPE — `export default { name, version, theory, stage, surfaces, needs?, enabled?, probe }`:
 *   name      unique string (also the <name>.mjs basename + the <name>.log firing log, PM2 — see FIRING LOG).
 *   version   the probe is a THEORY UNDER TEST; bump when its logic changes so a firing log is scoreable.
 *   theory    one-line human statement of what it's testing (rule 4 honesty: a firing is DATA, not an edge).
 *   stage     'observe' | 'price' | 'gate' — dictates the probe() signature + which runner calls it.
 *   surfaces  array of 'screen'|'quote'|'watch' the probe applies to (a probe is skipped off-surface).
 *   needs?    OPTIONAL (row, ctx) => number[] — sibling item ids this probe wants (decant; see NEEDS below).
 *   enabled?  OPTIONAL false → soft-off without deleting the file.
 *   probe     PURE function; MUST NOT touch a verdict/gate/rating/reconstruction (see INVARIANTS).
 *
 * THE ctx CONTRACT (what a surface hands every probe). A probe reads the shared quotecore `row`
 * (guide/quickBuy/quickSell/optBuy/optSell/mom/regimeLabel/rising/reliable/band/…) PLUS this ctx:
 *   surface   'screen'|'quote'|'watch' — the SAME signal can MEAN different things per surface, so a
 *             probe may frame per-surface (dip = "buy candidate" on screen/quote; "average-down window"
 *             when owned on watch).
 *   owned     bool — Ben holds an open lot of this item (drives the dip screen↔watch inversion).
 *   id, name  item identity (decant maps dose siblings by name/id).
 *   thin      bool — gp-flow-only liquidity (dip excludes; a thin band is noisy).
 *   phase     the quotecore phase() object {phase,curMid,baseMid,peakMid,lowSlope} over ts6h, or null.
 *   avgLow24, avgHigh24   this item's 24h-endpoint average low/high (dip reads avgLow24).
 *   series5m, series6h    raw fetched series (froth reads the low-trajectory shape).
 *   v24all    the WHOLE-MARKET 24h map (screen only — decant reads sibling dose prices from it, zero
 *             extra fetch; absent on the per-item quote surface).
 *   map       loadMapping() result (name/id resolve; decant).
 *   price     OPTIONAL {side:'ask'|'bid', proposed} — present only when the surface has an advisory
 *             price to refine (anchor). Absent → price-stage probes are skipped.
 *
 * THE EMPTY-PASSTHROUGH GUARANTEE (removability). `runProbes()` returns `[]` when NO module fired
 * (empty/absent modules dir, or none matched) — the render appends NOTHING, so output is
 * BYTE-IDENTICAL to a build with no probe system at all. Callers add the dedicated `Probes` column
 * ONLY when at least one row produced a tag (so "no module present OR none fire → byte-identical").
 *
 * FIRING LOG (PM2 — wired). Every fired annotation is APPENDED to `pipeline/modules/<module>.log`
 * (gitignored) by `logFirings(fired, meta)`, called EXPLICITLY by each surface AFTER runProbes (runProbes
 * itself stays PURE). One compact JSONL line per firing carries enough to SCORE it later without
 * re-fetching: `{ts, module, version, stage, surface, id, name, tag, price (price-stage only), quickBuy,
 * quickSell, guide, regimeLabel, phase}`. `version` is the probe's DECLARED version (looked up from the
 * loaded set) so a re-scored log knows which theory-version fired. Writes are individually try/caught +
 * swallowed (a broken log never breaks a render); no firing ⇒ no write ⇒ no file. SCORING (hit/miss) is
 * a later chunk — PM2 only accrues the data.
 *
 * INVARIANTS (non-negotiable — split by stage):
 *   - NEVER the decision core. No probe of any stage feeds a verdict / gate / rating / reconstruction.
 *     That core stays byte-identical whether any module loads or not — that is what makes deletion safe.
 *   - 'observe' probes are PURE ADDITIVE annotations — they touch NO number; output is byte-identical
 *     minus the tag.
 *   - 'price' probes modify only the ADVISORY recommendation (the human-facing suggested ask/bid),
 *     never a gate/verdict input. The loader hands the surface a {price, reason}; the surface renders
 *     it as advice. Delete → the recommended price reverts to the un-nudged band value.
 *
 * NEEDS — the multi-item boundary (decant forces the decision). Most probes read ONE row. decant is a
 * MULTI-ITEM probe: it compares a 4-dose potion against the per-4-dose cost of its 1/2/3-dose siblings.
 * So a probe declares its extra data needs with an OPTIONAL `needs(row, ctx) => number[]` (a FUNCTION,
 * not a static list — the siblings depend on the specific item). THE DECISION MADE HERE (PM1): rather
 * than teach the loader to pre-fetch, decant satisfies `needs` OPPORTUNISTICALLY off data the surface
 * ALREADY has — the screen loads the whole-market 24h map (`ctx.v24all`) for free, so decant reads its
 * dose siblings from there with ZERO extra fetch (surfaces:['screen']). `collectNeeds()` below exposes
 * the declared sibling-id set for a FUTURE surface that must actively pre-fetch (e.g. quote, which has
 * no whole-market map); until such a caller exists it is advisory only. This keeps PM1 light while the
 * `needs` interface is fully defined and documented.
 */
import { readdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODULES_DIR = join(HERE, '..', 'modules');
export const STAGES = ['observe', 'price', 'gate'];

// module-level cache of the loaded, stage-grouped probes. null until loadModules() runs, so a caller
// that never loads (or a test) gets the empty-passthrough []. Kept module-scoped so runProbes() can
// carry the spec's (row, surface, ctx) signature without threading the loaded set through every call.
let _loaded = null;

// discover pipeline/modules/*.mjs (NOT *.test.mjs — a colocated test isn't a probe). Absent dir → [].
// Same fs.readdirSync trick as run-tests.mjs (identical on Windows + ubuntu CI; no shell globbing).
function discoverFiles(dir) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }                                 // absent modules dir → no probes (byte-identical)
  return ents
    .filter(e => e.isFile() && e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs'))
    .map(e => join(dir, e.name))
    .sort();                                            // deterministic firing order
}

// shape-validate one loaded module; return the normalized probe object or null (with a loud warn).
function validate(mod, file) {
  const p = (mod && mod.default) || mod;
  if (!p || typeof p !== 'object') { console.warn(`⚠ probe ${file}: no default export object — skipped`); return null; }
  if (!p.name || typeof p.name !== 'string') { console.warn(`⚠ probe ${file}: missing string \`name\` — skipped`); return null; }
  if (!STAGES.includes(p.stage)) { console.warn(`⚠ probe ${p.name}: unknown stage "${p.stage}" (want ${STAGES.join('|')}) — skipped`); return null; }
  if (typeof p.probe !== 'function') { console.warn(`⚠ probe ${p.name}: \`probe\` is not a function — skipped`); return null; }
  if (p.enabled === false) return null;                // soft-off (present but disabled)
  return p;
}

/* loadModules(dir?) — import + validate + stage-group every module file ONCE. Async (dynamic import).
   Returns { observe:[], price:[], gate:[], all:[] } and caches it for runProbes/collectNeeds. Call it
   at surface startup (screen.mjs main(), quote.mjs). A module that throws on import is warned + skipped
   (a broken probe never breaks the surface — removability again). */
export async function loadModules(dir = MODULES_DIR) {
  const grouped = { observe: [], price: [], gate: [], all: [] };
  for (const file of discoverFiles(dir)) {
    let mod;
    try { mod = await import(pathToFileURL(file).href); }
    catch (e) { console.warn(`⚠ probe module failed to load (${file}): ${e.message}`); continue; }
    const p = validate(mod, file);
    if (!p) continue;
    grouped[p.stage].push(p);
    grouped.all.push(p);
  }
  _loaded = grouped;
  return grouped;
}

// test/inspection helpers — the loaded set, and a reset so a fixture can load a synthetic dir cleanly.
export function loadedModules() { return _loaded; }
export function resetModules() { _loaded = null; }

/* runProbes(row, surface, ctx) — the stage-keyed runner. Runs OBSERVE-stage probes (the tag producers
   that become the `Probes` column) and, when ctx.price is present, PRICE-stage probes (anchor's nudge),
   returning ONE flat array of fired annotations:
     { module, stage:'observe', tag, note }              — from observe probes
     { module, stage:'price',   tag:<reason>, price }    — from price probes (tag = the human reason)
   Empty when nothing fired (the empty-passthrough guarantee). A probe that throws is swallowed (it can
   never break a render). PURE w.r.t. row/ctx — it only READS them. */
export function runProbes(row, surface, ctx = {}) {
  const g = _loaded;
  if (!g) return [];                                   // never loaded → empty-passthrough
  const out = [];
  for (const m of g.observe) {
    if (Array.isArray(m.surfaces) && !m.surfaces.includes(surface)) continue;
    let res; try { res = m.probe(row, ctx); } catch { res = null; }
    if (res && res.tag) out.push({ module: m.name, stage: 'observe', tag: res.tag, note: res.note ?? null });
  }
  if (ctx.price) {
    for (const m of g.price) {
      if (Array.isArray(m.surfaces) && !m.surfaces.includes(surface)) continue;
      let res; try { res = m.probe(row, ctx.price, ctx); } catch { res = null; }
      if (res && res.price != null) out.push({ module: m.name, stage: 'price', tag: res.reason, price: res.price, note: null });
    }
  }
  return out;
}

/* collectNeeds(items, surface, ctx) — the multi-item pre-fetch contract (see NEEDS above). Given the
   rows a surface is about to render, returns the UNION of sibling item ids the loaded probes declare
   via `needs(row, ctx)`, MINUS ids already present. A surface that must actively pre-fetch (e.g. quote)
   would fetch these before running the probes; the screen surface satisfies decant off `ctx.v24all`
   instead, so it does not need to call this. Advisory until such a caller exists. */
export function collectNeeds(items, surface, ctxFor = () => ({})) {
  const g = _loaded;
  if (!g) return [];
  const have = new Set(items.map(it => it.id));
  const want = new Set();
  for (const m of g.all) {
    if (typeof m.needs !== 'function') continue;
    if (Array.isArray(m.surfaces) && !m.surfaces.includes(surface)) continue;
    for (const it of items) {
      let ids; try { ids = m.needs(it.row, ctxFor(it)); } catch { ids = null; }
      if (Array.isArray(ids)) for (const id of ids) if (id != null && !have.has(id)) want.add(id);
    }
  }
  return [...want];
}

/* logFirings(fired, meta) — the PM2 hit/miss ledger writer. Appends ONE compact JSONL line per fired
   annotation to `pipeline/modules/<module>.log` (gitignored), recording enough context to SCORE the
   firing later WITHOUT re-fetching: identity (id/name), the probe's declared `version` (looked up from
   the loaded set so a scoreable log knows which theory-version fired), the fired tag, the nudged price
   (price-stage only), and the live quote context (quickBuy/quickSell/guide/regime/phase) as of the pass.
   SCORING is a later chunk — this only accrues the data. NOT part of runProbes (which the header
   promises is PURE): a surface calls this explicitly AFTER runProbes.
   FAILURE-SAFE: every write is individually try/caught + swallowed — a broken log can NEVER break a
   render (the same throw-swallowing discipline as runProbes). No firing → no write → no file created.
   `dir` defaults to MODULES_DIR (surface callers omit it); it exists only so a fixture can target a temp dir. */
export function logFirings(fired, meta = {}, dir = MODULES_DIR) {
  if (!Array.isArray(fired) || !fired.length) return;   // no firing → nothing written (no file created)
  const g = _loaded;
  const ts = Math.floor(Date.now() / 1000);
  for (const f of fired) {
    try {
      const probe = g && g.all.find(m => m.name === f.module);
      const line = {
        ts,
        module: f.module,
        version: probe ? (probe.version ?? null) : null,
        stage: f.stage,
        surface: meta.surface ?? null,
        id: meta.id ?? null,
        name: meta.name ?? null,
        tag: f.tag ?? null,
        ...(f.stage === 'price' ? { price: f.price ?? null } : {}),
        quickBuy: meta.quickBuy ?? null,
        quickSell: meta.quickSell ?? null,
        guide: meta.guide ?? null,
        regimeLabel: meta.regimeLabel ?? null,
        phase: meta.phase ?? null,
      };
      appendFileSync(join(dir, `${f.module}.log`), JSON.stringify(line) + '\n');
    } catch { /* swallow — a broken firing log never breaks a render */ }
  }
}
