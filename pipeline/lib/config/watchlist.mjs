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
 * ONE OPTIONS BAG for all three loaders: `{ map, root, tolerant }`. A positional second argument was
 * the original shape and it made `loadWatchlistNames(map)` return `[]` in silence — the exact class
 * this module exists to close.
 *
 * Degrade: absent/unreadable/non-array watchlist → empty, never a throw; absent/garbled/unknown-role
 * sidecar → every entry `universe`, never a throw.
 *
 * MALFORMED ENTRY. `map.resolve` stringifies an object entry to "[object Object]", misses `byName` and
 * returns null without throwing, so a pre-SEP16a loader quietly lost THAT ONE MEMBER and kept the rest
 * (measured against the verbatim old loader: 60 clean → 60 with a stray object → 59 with a member
 * rewritten as one). Only a WHOLE-FILE schema rewrite emptied the set, which `pushWatchlist` cannot
 * produce — it writes bare numeric ids.
 *
 * So strict-throw is the default (importers and future callers get the loud contract), and the desk
 * commands pass `tolerant: true`: keep every well-formed member, print ONE banner. Aborting an
 * inform-only read over one bad entry destroys more than the member it saves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCHLIST_ROOT = path.join(HERE, '..', '..', '..');
const WATCHLIST_FILE = 'watchlist.json';
const WATCHLIST_META_FILE = 'watchlist-meta.json';
const WATCHLIST_ROLES = ['target', 'hold', 'universe', 'probe'];
export const WATCHLIST_ROLE_DEFAULT = 'universe';

export class WatchlistFormatError extends Error {
  constructor(msg) { super(msg); this.name = 'WatchlistFormatError'; }
}

function readJson(root, file) {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) }; }
  catch (e) { return { ok: false, missing: e && e.code === 'ENOENT', message: (e && e.message) || String(e) }; }
}

const shapeOf = e => (e === null ? 'null' : Array.isArray(e) ? 'array' : typeof e);
const article = s => (/^[aeiou]/.test(s) ? 'an' : 'a');

function malformedLine(bad, total, tolerant) {
  const head = bad.slice(0, 3).map(b => `[${b.i}] is ${article(b.shape)} ${b.shape}`).join(', ');
  const rest = bad.length > 3 ? ` (+${bad.length - 3} more)` : '';
  const scope = !tolerant ? 'refusing a watchlist that is not a flat list of names/ids'
    : bad.length >= total ? 'no member resolves — watchlist permissions OFF this run'
    : `${bad.length} of ${total} entries dropped — the other ${total - bad.length} still grant`;
  return `⚠ ${WATCHLIST_FILE}${head}${rest}, not an item name or id — ${scope}`;
}

// Straight to the stream: quiet mode stubs `console.log` and the screen's report capture reassigns it
// to a buffer, so a banner routed through console reaches no human on the paths that need it most.
// ONCE per process — screen and watch-positions each read the file twice, and run-loop re-execs the
// command per tick, so per-process is per-pass.
const ANNOUNCED = new Set();
function banner(msg) {
  if (ANNOUNCED.has(msg)) return;
  ANNOUNCED.add(msg);
  process.stdout.write(msg + '\n');
}

// Raw tokens in file order, for the name-keyed consumers. A number is stringified (map.resolve
// stringifies anyway); anything that is neither string nor finite number is malformed.
export function loadWatchlistNames({ root = WATCHLIST_ROOT, tolerant = false } = {}) {
  const r = readJson(root, WATCHLIST_FILE);
  if (!r.ok) {
    if (!r.missing) console.error(`${WATCHLIST_FILE} unreadable — watchlist permissions OFF this run: ${r.message}`);
    return [];
  }
  if (!Array.isArray(r.value)) {
    console.error(`${WATCHLIST_FILE} is not an array — watchlist permissions OFF this run`);
    return [];
  }
  const out = [], bad = [];
  r.value.forEach((entry, i) => {
    if (typeof entry === 'string') out.push(entry);
    else if (typeof entry === 'number' && Number.isFinite(entry)) out.push(String(entry));
    else bad.push({ i, shape: shapeOf(entry) });
  });
  if (bad.length) {
    const msg = malformedLine(bad, r.value.length, tolerant);
    if (!tolerant) { console.error(msg); throw new WatchlistFormatError(msg); }
    banner(msg);
  }
  return out;
}

export function loadWatchlistMeta({ root = WATCHLIST_ROOT } = {}) {
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
export function loadWatchlistEntries({ map, root = WATCHLIST_ROOT, tolerant = false } = {}) {
  const meta = loadWatchlistMeta({ root });
  const seen = new Set(), out = [];
  for (const token of loadWatchlistNames({ root, tolerant })) {
    const hit = map.resolve(token);
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push({ id: hit.id, name: hit.name, ...roleOf(meta, hit.id) });
  }
  return out;
}

export function loadWatchlistIds({ map, root = WATCHLIST_ROOT, tolerant = false } = {}) {
  return new Set(loadWatchlistEntries({ map, root, tolerant }).map(e => e.id));
}
