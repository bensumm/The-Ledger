/* marketfetch.mjs — the ONE node-side fetch layer for the pipeline analysis scripts
   (quote.mjs, screen.mjs, watch.mjs, alerts.mjs; loadMapping is also the shared name/id
   loader for monitor.mjs / add-manual-fill.mjs). DOM-free; pairs with js/quotecore.js (which
   owns ALL the quote/tax/regime MATH — this file only fetches raw inputs and feeds them in).

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
const DAILY_DIR = path.join(CACHE_DIR, 'daily');       // whole-market 1h window archive @6h spacing (regime proxy)
const TS_DIR = path.join(CACHE_DIR, 'ts');             // per-item timeseries cache (screen re-fetch avoidance)
const OB_DIR = path.join(CACHE_DIR, 'outcomes-bands'); // per-item REDUCED historical 5m bands (outcomes.mjs; tiny)
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

/* --- fetchItemInputs(id): the combined latest + 5m + 6h series + 24h-vol read every per-item
   consumer needs, with polite 60ms spacing across a multi-item ask. THE one copy — was a
   byte-identical `fetchInputs()` inlined in quote.mjs / watch.mjs / alerts.mjs (X1 dedup;
   resolves the lane-N note). Feeds straight into computeQuote({ ...inp, guide, limit, … }). --- */
export async function fetchItemInputs(id, { ts1h = false } = {}) {
  const latest = await fetchLatest(id); await sleep(60);
  const ts5m = await fetchTs(id, '5m'); await sleep(60);
  const ts6h = await fetchTs(id, '6h'); await sleep(60);
  const vol24 = await fetch24hOne(id);
  const out = { latest, ts5m, ts6h, vol24 };
  if (ts1h) { await sleep(60); out.ts1h = await fetchTs(id, '1h'); } // window-context line (watch.mjs only)
  return out;
}

/* --- fetchTsCached(id, step, ttlMs): fetchTs with a short-TTL per-item disk cache under
   .cache/ts/. Used ONLY by the screen (a discovery read where a few-minutes-stale series is
   fine and re-running the screen shouldn't re-hammer the API — the "avoid needless re-fetches"
   rule). quote.mjs --positions deliberately keeps the UNcached fetchTs (position management wants
   live). Files are overwritten per (id,step); prune old ones with pruneCache('ts', …). --- */
export async function fetchTsCached(id, step, ttlMs) {
  ensureCacheDir(); try { fs.mkdirSync(TS_DIR, { recursive: true }); } catch {}
  const p = path.join(TS_DIR, id + '-' + step + '.json');
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); if (o && Date.now() - o.ts < ttlMs) return o.data; } catch {}
  const data = await fetchTs(id, step);
  try { fs.writeFileSync(p, JSON.stringify({ ts: Date.now(), data })); } catch {}
  return data;
}
/* delete files in a .cache subdir older than maxAgeMs (bounds the ts cache growth) */
export function pruneCache(subdir, maxAgeMs) {
  const dir = path.join(CACHE_DIR, subdir);
  let files = []; try { files = fs.readdirSync(dir); } catch { return; }
  const now = Date.now();
  for (const f of files) {
    try { if (now - fs.statSync(path.join(dir, f)).mtimeMs > maxAgeMs) fs.unlinkSync(path.join(dir, f)); } catch {}
  }
}

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
   apart); every later run only backfills the windows minted since. Files older than the retention
   window (BANDS_RETENTION_DAYS, raised 7d→90d for O1 — outcome analysis reads historical bands at
   trade-placement time) are pruned.

   Window alignment (verified live 2026-07-03 against id 560): `latest = floor(now/300)*300 - 300`
   is the last COMPLETE 5m window and equals the last point of /timeseries?timestep=5m; the 24
   windows [latest, latest-300, …] are byte-identical to that series' slice(-24). So the edges
   below == computeQuote's bandLo/bandHi over the same item — that is the mandatory sanity gate.

   Returns { [id]: { bandLo: min avgLowPrice, bandHi: max avgHighPrice, active5m: #windows with
   two-sided trades } } for every item seen in the windows. --- */
function dayKey(unixSec) { return new Date(unixSec * 1000).toISOString().slice(0, 10); } // UTC day
// Band archive retention. Raised 7d→90d for O1: pipeline/outcomes.mjs reconstructs the trailing-2h
// band at each historical trade PLACEMENT, so recent (weeks-old) windows must survive to be joinable.
// Local + gitignored (.cache/) — band data is NEVER committed. 90d is the enrichable outcome window.
export const BANDS_RETENTION_DAYS = 90;
export async function loadBands(hours = 2) {
  ensureCacheDir();
  try { fs.mkdirSync(BANDS_DIR, { recursive: true }); } catch {}
  const step = 300;
  const now = Math.floor(Date.now() / 1000);
  const latest = Math.floor(now / step) * step - step;       // last complete 5m window
  const nWin = Math.max(1, Math.ceil(hours * 3600 / step));
  const windows = []; for (let i = 0; i < nWin; i++) windows.push(latest - i * step);

  // load existing per-day archive, pruning files whose day is entirely older than retention
  const cutoff = now - BANDS_RETENTION_DAYS * 86400;
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

/* --- loadDaily(days, stepHours): a BULK multi-day mid-price series for EVERY item, zero per-item
   timeseries calls — the regime-proxy source (Fable's structural fix). The wiki /1h endpoint is a
   bulk whole-market snapshot that ALSO accepts ?timestamp=<unix divisible by 3600> for a past 1h
   window (verified live 2026-07-04 against id 560: a 6h-sampled /1h mid series tracks the real
   per-item /timeseries?timestep=6h mids within ~0.5%, well inside the noise a 3d-vs-14d MEDIAN
   proxy tolerates). We sample one window every `stepHours` over the last `days`, reducing each
   whole-market snapshot to {id: mid} (regime only needs the level), archived per-UTC-day under
   .cache/daily/ exactly like loadBands. Cold ~= days*24/stepHours bulk calls (17d@6h ≈ 68, ~70ms
   apart); later runs only backfill windows minted since. Past windows are immutable → cached
   forever until pruned (files older than days+2 dropped).

   Returns { [id]: [{ ts, mid }] } ascending by ts — the input shape a regime-drift proxy consumes.
   This is a PROXY for picking the fetch pool; the DISPLAYED regime is still the real per-item
   computeQuote/regimeDrift, and the falling-exclusion + rising-confirm remain post-fetch. --- */
const mid1h = e => (e && e.avgLowPrice && e.avgHighPrice) ? (e.avgLowPrice + e.avgHighPrice) / 2 : (e && (e.avgLowPrice || e.avgHighPrice)) || null;
export async function loadDaily(days = 17, stepHours = 6) {
  ensureCacheDir();
  try { fs.mkdirSync(DAILY_DIR, { recursive: true }); } catch {}
  const HOUR = 3600, step = stepHours * HOUR;
  const now = Math.floor(Date.now() / 1000);
  const lastHour = Math.floor(now / HOUR) * HOUR - HOUR;      // last complete 1h window
  const latest = Math.floor(lastHour / step) * step;         // align to the step grid (stable windows across runs)
  const nWin = Math.max(1, Math.ceil(days * 24 / stepHours));
  const windows = []; for (let i = 0; i < nWin; i++) windows.push(latest - i * step);

  // load per-day archive, pruning files entirely older than days+2
  const cutoff = now - (days + 2) * 86400;
  const archive = new Map();                                  // windowUnix -> {id: mid}
  let files = []; try { files = fs.readdirSync(DAILY_DIR); } catch {}
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const dayStart = Date.parse(f.slice(0, 10) + 'T00:00:00Z') / 1000;
    if (Number.isFinite(dayStart) && dayStart + 86400 < cutoff) {
      try { fs.unlinkSync(path.join(DAILY_DIR, f)); } catch {}
      continue;
    }
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, f), 'utf8'));
      for (const w in obj) archive.set(+w, obj[w]);
    } catch {}
  }

  // backfill only missing windows (bulk /1h each once, reduced to {id: mid}, appended to its day file)
  const touched = new Map();                                  // dayKey -> {window: {id:mid}}
  for (const w of windows) {
    if (archive.has(w)) continue;
    let data = null;
    try { data = (await jget(API + '/1h?timestamp=' + w)).data || {}; } catch { data = null; }
    await sleep(70);
    if (!data) continue;
    const red = {}; for (const id in data) { const m = mid1h(data[id]); if (m != null) red[id] = m; }
    archive.set(w, red);
    const dk = dayKey(w);
    if (!touched.has(dk)) {
      let cur = {}; try { cur = JSON.parse(fs.readFileSync(path.join(DAILY_DIR, dk + '.json'), 'utf8')); } catch {}
      touched.set(dk, cur);
    }
    touched.get(dk)[w] = red;
  }
  for (const [dk, obj] of touched) {
    try { fs.writeFileSync(path.join(DAILY_DIR, dk + '.json'), JSON.stringify(obj)); } catch {}
  }

  // assemble per-item ascending {ts, mid} series
  const series = {};
  const asc = [...windows].sort((a, b) => a - b);
  let coverageWindows = 0;
  for (const w of asc) {
    const snap = archive.get(w); if (!snap) continue;
    coverageWindows++;
    for (const id in snap) (series[id] || (series[id] = [])).push({ ts: w, mid: snap[id] });
  }
  // coverageWindows (distinct requested windows present) lets the caller detect a cold archive
  return { series, coverageWindows };
}

/* --- loadHistBands(reqs, hours): the trailing `hours` 5m band for a SET of (item, endUnix)
   requests, sourced from the historical whole-market /5m?timestamp bulk endpoint (the ONLY way to
   read a PAST 5m window — per-item /timeseries?5m only reaches ~30h back). Powers outcomes.mjs's
   "band percentile at trade placement" enrichment: same basis as computeQuote's bandLo/bandHi
   (min avgLowPrice / max avgHighPrice over the last `hours`), evaluated AS OF each placement time.

   Efficiency + disk discipline: each distinct 5m window is fetched ONCE (whole-market), and while
   we have that snapshot we extract EVERY requested item from it, persisting only the REDUCED
   per-item datum {lo,hi,lv,hv} under .cache/outcomes-bands/<id>.json (a few KB/item — NOT the
   ~1.5MB whole snapshots loadBands keeps). RAM stays flat (one snapshot at a time). A window with
   no entry for an item is cached as null (item didn't trade) so it is never re-fetched for that item.

   reqs: [{ id, endUnix }]. Returns an array aligned to reqs:
     { bandLo, bandHi, active5m, tradedWin, loVol, hiVol, nWin, covered }
   covered = how many of the nWin windows were resolvable (present in the archive or fetched);
   covered < nWin ⇒ the /5m history for that window is gone (see FILLS-PIPELINE.md retention note). --- */
export async function loadHistBands(reqs, hours = 2) {
  ensureCacheDir();
  try { fs.mkdirSync(OB_DIR, { recursive: true }); } catch {}
  const step = 300;
  const nWin = Math.max(1, Math.ceil(hours * 3600 / step));
  const align = t => Math.floor(t / step) * step;
  const ids = new Set(reqs.map(r => r.id));

  // load reduced per-item caches
  const store = new Map();                                   // id -> { window: {lo,hi,lv,hv}|null }
  for (const id of ids) { let s = {}; try { s = JSON.parse(fs.readFileSync(path.join(OB_DIR, id + '.json'), 'utf8')); } catch {} store.set(id, s); }

  // per-req trailing window list; collect the windows still missing for ANY requested item
  const reqWindows = reqs.map(r => { const latest = align(r.endUnix); const ws = []; for (let i = 0; i < nWin; i++) ws.push(latest - i * step); return ws; });
  const missing = new Set();
  reqs.forEach((r, idx) => { const s = store.get(r.id); for (const w of reqWindows[idx]) if (s[w] === undefined) missing.add(w); });

  // fetch each missing window once; extract EVERY item-of-interest present, cache reduced
  const dirty = new Set();
  const windows = [...missing].sort((a, b) => b - a);
  for (const w of windows) {
    let data = null;
    try { data = (await jget(API + '/5m?timestamp=' + w)).data || {}; } catch { data = null; }
    await sleep(70);
    for (const id of ids) {
      const s = store.get(id);
      if (s[w] !== undefined) continue;
      const e = data ? (data[id] || data[String(id)]) : null;
      // data===null (fetch failed) → leave undefined so a later run can retry; else cache datum|null
      if (data === null) continue;
      s[w] = e ? { lo: e.avgLowPrice ?? null, hi: e.avgHighPrice ?? null, lv: e.lowPriceVolume || 0, hv: e.highPriceVolume || 0 } : null;
      dirty.add(id);
    }
  }
  for (const id of dirty) { try { fs.writeFileSync(path.join(OB_DIR, id + '.json'), JSON.stringify(store.get(id))); } catch {} }

  // aggregate the band per request (same min-low / max-high basis as computeQuote's 2h band)
  return reqs.map((r, idx) => {
    const s = store.get(r.id);
    let bandLo = null, bandHi = null, active5m = 0, tradedWin = 0, loVol = 0, hiVol = 0, covered = 0;
    for (const w of reqWindows[idx]) {
      const d = s[w]; if (d === undefined) continue; covered++;
      if (!d) continue;
      if (d.lo) bandLo = bandLo == null ? d.lo : Math.min(bandLo, d.lo);
      if (d.hi) bandHi = bandHi == null ? d.hi : Math.max(bandHi, d.hi);
      loVol += d.lv; hiVol += d.hv;
      if (d.lv > 0 && d.hv > 0) active5m++;
      if (d.lv > 0 || d.hv > 0) tradedWin++;
    }
    return { bandLo, bandHi, active5m, tradedWin, loVol, hiVol, nWin, covered };
  });
}
