/* marketfetch.mjs — the ONE node-side fetch layer for the chunk-3 analysis scripts
   (quote.mjs, screen.mjs). DOM-free; pairs with js/quotecore.js (which owns ALL the
   quote/tax/regime MATH — this file only fetches raw inputs and feeds them in).

   Data sources (identical to what the browser app uses in js/market.js + js/state.js):
     - live/series/24h prices : prices.runescape.wiki  /latest /timeseries /24h /mapping
     - GE guide price         : chisel.weirdgloop.org os_dump.json bulk dump
                                (node has no CORS wall, so we can always read the richest
                                 dump directly — same source market.js reaches for first).
   Caching: mapping + guide + the bulk 24h/latest screen inputs are cached under
   pipeline/.cache/ (gitignored) with short TTLs so a session doesn't hammer the API. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, '.cache');
const BANDS_DIR = path.join(CACHE_DIR, 'bands');       // whole-market 5m window archive (gitignored via .cache/)
const MAP_CACHE = path.join(HERE, 'mapping.cache.json'); // shared with add-manual-fill.mjs (name<->id)

export const API = 'https://prices.runescape.wiki/api/v1/osrs';
const MAP_URL = API + '/mapping';
const GUIDE_DUMP = 'https://chisel.weirdgloop.org/gazproj/gazbot/os_dump.json';
export const UA = 'TheCoffer-analysis/0.28 (bensumm; github.com/bensumm/The-Ledger)';

const DAY = 24 * 3600 * 1000;

function ensureCacheDir() { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {} }
// read a {ts,data} cache file if younger than ttlMs; else null
function readCache(name, ttlMs) {
  try {
    const p = path.join(CACHE_DIR, name);
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (o && Date.now() - o.ts < ttlMs) return o.data;
  } catch {}
  return null;
}
function writeCache(name, data) {
  ensureCacheDir();
  try { fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export async function jget(url) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error('http ' + r.status + ' for ' + url);
    return await r.json();
  } finally { clearTimeout(to); }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* --- mapping (id<->name, buy limit). 24h TTL, cache shared with add-manual-fill.mjs.
   Returns { byId:{id:{name,limit}}, resolve(nameOrId)->{id,name}|null } --- */
export async function loadMapping() {
  let arr = null;
  try {
    if (Date.now() - fs.statSync(MAP_CACHE).mtimeMs < DAY) {
      const cached = JSON.parse(fs.readFileSync(MAP_CACHE, 'utf8'));
      // add-manual-fill.mjs writes a flat {id:name} map; we want {id:{name,limit}} — only
      // reuse the cache if it's our richer shape, else refetch to get limits.
      if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
        const sample = cached[Object.keys(cached)[0]];
        if (sample && typeof sample === 'object' && 'name' in sample) return buildMapping(objToArr(cached));
      }
    }
  } catch {}
  try {
    arr = await jget(MAP_URL);
    const rich = {}; for (const it of arr) rich[it.id] = { name: it.name, limit: it.limit ?? null };
    fs.writeFileSync(MAP_CACHE, JSON.stringify(rich));
    return buildMapping(arr);
  } catch (e) {
    // last resort: whatever is on disk (possibly the flat name map)
    try {
      const cached = JSON.parse(fs.readFileSync(MAP_CACHE, 'utf8'));
      return buildMapping(objToArr(cached));
    } catch { throw new Error('mapping unavailable and no cache: ' + (e && e.message || e)); }
  }
}
function objToArr(obj) {
  return Object.entries(obj).map(([id, v]) => (v && typeof v === 'object')
    ? { id: +id, name: v.name, limit: v.limit ?? null }
    : { id: +id, name: v, limit: null });
}
function buildMapping(arr) {
  const byId = {}, byName = {};
  for (const it of arr) { byId[it.id] = { name: it.name, limit: it.limit ?? null }; byName[String(it.name).toLowerCase()] = it.id; }
  return {
    byId,
    resolve(token) {
      const t = String(token).trim();
      if (/^\d+$/.test(t)) { const id = +t; return byId[id] ? { id, name: byId[id].name } : { id, name: '#' + id }; }
      const id = byName[t.toLowerCase()];
      return id ? { id, name: byId[id].name } : null;
    }
  };
}

/* --- GE guide dump (id -> price). 10-min cache. Same parse as js/market.js:
   keys may be item names; the numeric id is o.id. --- */
export async function loadGuide() {
  const cached = readCache('guide.json', 10 * 60 * 1000);
  if (cached) return cached;
  try {
    const raw = await jget(GUIDE_DUMP);
    const g = {};
    for (const k in raw) {
      if (k[0] === '%') continue; const o = raw[k]; if (!o || typeof o !== 'object') continue;
      const id = (+o.id) || (+k); if (!id) continue;
      if (o.price != null) g[id] = o.price;
    }
    writeCache('guide.json', g);
    return g;
  } catch { return readCache('guide.json', Infinity) || {}; }
}

/* --- single-item live inputs (quote.mjs / --positions) --- */
export async function fetchLatest(id) { const j = await jget(API + '/latest?id=' + id); return (j.data && (j.data[id] || j.data[String(id)])) || null; }
export async function fetchTs(id, step) { return (await jget(API + '/timeseries?id=' + id + '&timestep=' + step)).data || []; }
export async function fetch24hOne(id) { const j = await jget(API + '/24h?id=' + id); return (j.data && (j.data[id] || j.data[String(id)])) || null; }

/* --- bulk inputs (screen.mjs). 10-min cache; these are the whole-market snapshots. --- */
export async function loadAll24h() {
  const cached = readCache('all24h.json', 10 * 60 * 1000);
  if (cached) return cached;
  const j = await jget(API + '/24h'); const d = j.data || {};
  writeCache('all24h.json', d); return d;
}
export async function loadAllLatest() {
  const cached = readCache('latest.json', 3 * 60 * 1000);
  if (cached) return cached;
  const j = await jget(API + '/latest'); const d = j.data || {};
  writeCache('latest.json', d); return d;
}

/* --- loadBands(hours): whole-market intraday band data for EVERY item, zero per-item
   timeseries calls (chunk 9.1). The wiki /5m endpoint is a bulk whole-market snapshot and
   accepts ?timestamp=<unix, divisible by 300> to fetch a past 5m window. We walk the last
   `hours` of 5m windows, reading each from a local per-day archive under .cache/bands/ when
   present else fetching it once and appending it. First cold 2h run ≈ 24 bulk calls (~70ms
   apart); every later run only backfills the windows minted since. Files >7 days old are pruned.

   Window alignment (verified live 2026-07-03 against id 560): `latest = floor(now/300)*300 - 300`
   is the last COMPLETE 5m window and equals the last point of /timeseries?timestep=5m; the 24
   windows [latest, latest-300, …] are byte-identical to that series' slice(-24). So the edges
   below == computeQuote's bandLo/bandHi over the same item — that is the mandatory sanity gate.

   Returns { [id]: { bandLo: min avgLowPrice, bandHi: max avgHighPrice, active5m: #windows with
   two-sided trades } } for every item seen in the windows. --- */
function dayKey(unixSec) { return new Date(unixSec * 1000).toISOString().slice(0, 10); } // UTC day
export async function loadBands(hours = 2) {
  ensureCacheDir();
  try { fs.mkdirSync(BANDS_DIR, { recursive: true }); } catch {}
  const step = 300;
  const now = Math.floor(Date.now() / 1000);
  const latest = Math.floor(now / step) * step - step;       // last complete 5m window
  const nWin = Math.max(1, Math.ceil(hours * 3600 / step));
  const windows = []; for (let i = 0; i < nWin; i++) windows.push(latest - i * step);

  // load existing per-day archive, pruning files whose day is entirely >7 days old
  const cutoff = now - 7 * 86400;
  const archive = new Map();                                  // windowUnix -> {id:{...}}
  let files = []; try { files = fs.readdirSync(BANDS_DIR); } catch {}
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const dayStart = Date.parse(f.slice(0, 10) + 'T00:00:00Z') / 1000;
    if (Number.isFinite(dayStart) && dayStart + 86400 < cutoff) {
      try { fs.unlinkSync(path.join(BANDS_DIR, f)); } catch {}
      continue;
    }
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(BANDS_DIR, f), 'utf8'));
      for (const w in obj) archive.set(+w, obj[w]);
    } catch {}
  }

  // backfill only the missing windows (bulk fetch each once, append to its day file)
  const touched = new Map();                                  // dayKey -> {window:data}
  for (const w of windows) {
    if (archive.has(w)) continue;
    let data = null;
    try { data = (await jget(API + '/5m?timestamp=' + w)).data || {}; } catch { data = null; }
    await sleep(70);
    if (!data) continue;
    archive.set(w, data);
    const dk = dayKey(w);
    if (!touched.has(dk)) {
      let cur = {}; try { cur = JSON.parse(fs.readFileSync(path.join(BANDS_DIR, dk + '.json'), 'utf8')); } catch {}
      touched.set(dk, cur);
    }
    touched.get(dk)[w] = data;
  }
  for (const [dk, obj] of touched) {
    try { fs.writeFileSync(path.join(BANDS_DIR, dk + '.json'), JSON.stringify(obj)); } catch {}
  }

  // aggregate per item across the requested windows (matches computeQuote min/max over ts.slice(-24))
  const bands = {};
  for (const w of windows) {
    const snap = archive.get(w); if (!snap) continue;
    for (const id in snap) {
      const e = snap[id]; if (!e) continue;
      let b = bands[id]; if (!b) b = bands[id] = { bandLo: null, bandHi: null, active5m: 0 };
      if (e.avgLowPrice)  b.bandLo = b.bandLo == null ? e.avgLowPrice : Math.min(b.bandLo, e.avgLowPrice);
      if (e.avgHighPrice) b.bandHi = b.bandHi == null ? e.avgHighPrice : Math.max(b.bandHi, e.avgHighPrice);
      if ((e.lowPriceVolume || 0) > 0 && (e.highPriceVolume || 0) > 0) b.active5m++;
    }
  }
  return bands;
}
