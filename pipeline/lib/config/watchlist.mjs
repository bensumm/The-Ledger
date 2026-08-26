/* watchlist.mjs — the ONE reader for repo-root `watchlist.json` and its `watchlist-meta.json` sidecar.
 *
 * `watchlist.json` is a PERMISSION AND PRIORITY set, not a list: membership grants gate exemption,
 * a bounded fetch reserve, floor bypasses, a render-filter exemption and two big-ticket
 * force-includes. Six loaders parsed it separately; this is their one home.
 *
 * Role metadata lives in the SIDECAR because the app owns `watchlist.json` and rewrites the whole
 * file as bare numeric ids on every star-click (`js/ui.js` pushWatchlist). No grant reads the
 * sidecar — the id set is sidecar-independent by construction, which `watchlist-permission.test.mjs` pins.
 *
 * Degrade: absent/unreadable/non-array watchlist → empty, never a throw; absent/garbled/unknown-role
 * sidecar → every entry `universe`, never a throw. An OBJECT entry inside the array is the one LOUD
 * case: `map.resolve` stringifies it to "[object Object]", misses `byName`, returns null, and every
 * grant turns off at once with CI green. It throws, and prints to stderr — which survives the
 * quiet-mode `console.log` stub that would swallow anything else.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WATCHLIST_ROOT = path.join(HERE, '..', '..', '..');
export const WATCHLIST_FILE = 'watchlist.json';
export const WATCHLIST_META_FILE = 'watchlist-meta.json';
export const WATCHLIST_ROLES = ['target', 'hold', 'universe', 'probe'];
export const WATCHLIST_ROLE_DEFAULT = 'universe';

export class WatchlistFormatError extends Error {
  constructor(msg) { super(msg); this.name = 'WatchlistFormatError'; }
}

function readJson(root, file) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) }; }
  catch (e) { return { ok: false, missing: e && e.code === 'ENOENT', message: (e && e.message) || String(e) }; }
}

// Raw tokens in file order, for the name-keyed consumers. A number is stringified (map.resolve and
// buildAudit both stringify anyway); anything that is neither string nor finite number is the loud case.
export function loadWatchlistNames(root = WATCHLIST_ROOT) {
  const r = readJson(root, WATCHLIST_FILE);
  if (!r.ok) {
    if (!r.missing) console.error(`${WATCHLIST_FILE} unreadable — watchlist permissions OFF this run: ${r.message}`);
    return [];
  }
  if (!Array.isArray(r.value)) {
    console.error(`${WATCHLIST_FILE} is not an array — watchlist permissions OFF this run`);
    return [];
  }
  return r.value.map((entry, i) => {
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'number' && Number.isFinite(entry)) return String(entry);
    const shape = entry === null ? 'null' : Array.isArray(entry) ? 'array' : typeof entry;
    const msg = `${WATCHLIST_FILE}[${i}] is a ${shape}, not an item name or id — the whole permission set would resolve to nothing`;
    console.error(msg);
    throw new WatchlistFormatError(msg);
  });
}

export function loadWatchlistMeta(root = WATCHLIST_ROOT) {
  const r = readJson(root, WATCHLIST_META_FILE);
  if (!r.ok) {
    if (!r.missing) console.error(`${WATCHLIST_META_FILE} unreadable — every watchlist entry read as ${WATCHLIST_ROLE_DEFAULT}: ${r.message}`);
    return {};
  }
  const v = r.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    console.error(`${WATCHLIST_META_FILE} is not an id-keyed object — every watchlist entry read as ${WATCHLIST_ROLE_DEFAULT}`);
    return {};
  }
  return v;
}

function roleOf(meta, id) {
  const e = meta[id];
  const bare = { why: WATCHLIST_ROLE_DEFAULT, note: null, addedTs: null, level: null };
  if (!e || typeof e !== 'object' || Array.isArray(e)) return bare;
  let why = e.why;
  if (typeof why !== 'string' || !WATCHLIST_ROLES.includes(why)) {
    if (why !== undefined) console.error(`${WATCHLIST_META_FILE}: id ${id} has role ${JSON.stringify(why)} — read as ${WATCHLIST_ROLE_DEFAULT}`);
    why = WATCHLIST_ROLE_DEFAULT;
  }
  return { why, note: e.note ?? null, addedTs: e.addedTs ?? null, level: e.level ?? null };
}

// Resolved members in file order, first occurrence wins, unresolvable tokens skipped. An id present
// in the sidecar but absent from the array is ignored — the array is authoritative for membership.
export function loadWatchlistEntries(map, root = WATCHLIST_ROOT) {
  const meta = loadWatchlistMeta(root);
  const seen = new Set(), out = [];
  for (const token of loadWatchlistNames(root)) {
    const hit = map.resolve(token);
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({ id: hit.id, name: hit.name, ...roleOf(meta, hit.id) });
  }
  return out;
}

export function loadWatchlistIds(map, root = WATCHLIST_ROOT) {
  return new Set(loadWatchlistEntries(map, root).map(e => e.id));
}
