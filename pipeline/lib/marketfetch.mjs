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
import { createHash } from 'node:crypto';
import { open as openArchive } from './archive.mjs';   // D0: Tier-1 SQLite market archive

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, '..', '.cache'); // pipeline/.cache/ — this file lives in pipeline/lib/ (OR2)
const BANDS_DIR = path.join(CACHE_DIR, 'bands');       // whole-market 5m window archive (gitignored via .cache/)
const DAILY_DIR = path.join(CACHE_DIR, 'daily');       // whole-market 1h window archive @6h spacing (regime proxy)
const TS_DIR = path.join(CACHE_DIR, 'ts');             // per-item timeseries cache (screen re-fetch avoidance)
const OB_DIR = path.join(CACHE_DIR, 'outcomes-bands'); // per-item REDUCED historical 5m bands (outcomes.mjs; tiny)
const OD_DIR = path.join(CACHE_DIR, 'outcomes-daily'); // per-item REDUCED historical 1h@6h series (YF1 loadHistDaily; tiny)
const MAP_CACHE = path.join(CACHE_DIR, 'mapping.cache.json'); // under pipeline/.cache/ (OR2); shared name<->id loader

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

/* --- FC1: opt-in cross-invocation fetch cache (PLAN-YIELD) -----------------------------------
   OFF by default. Enable with COFFER_FETCH_CACHE=1 (env) or setFetchCache(true). When enabled, the
   per-item GET reads below (fetchLatest / fetchTs / fetch24hOne) are served from a gitignored
   per-URL file cache under .cache/fetch/ when younger than a per-endpoint TTL — a PURE wrapper: a
   cache HIT returns the exact payload a live fetch would have returned within the TTL, so numbers
   stay byte-identical. This kills the redundant re-pulls when a screen → windowrange → watch on the
   same item all fire seconds apart. Default-OFF is deliberate: every existing decision path
   (quote --positions, the watch verdict pass) stays byte-identical unless a caller opts in, and the
   TTLs are sized so even when enabled a live price can only be seconds stale — NEVER enable the
   cache on a position-management or write-committing run (a verdict wants the live book). The bulk
   screen loaders keep their own readCache/writeCache store; FC1 only wraps the per-item fetchers
   that had no cross-process cache. .cache/ is already gitignored (OR2), so no new ignore entry. */
const FETCH_DIR = path.join(CACHE_DIR, 'fetch');
let cacheEnabled = process.env.COFFER_FETCH_CACHE === '1';
export function setFetchCache(on) { cacheEnabled = !!on; }
export function fetchCacheEnabled() { return cacheEnabled; }
// per-endpoint TTLs (ms): live /latest + the 5m band move fast → short; /24h + the 1h/6h series move
// slowly → longer. Sized so a cached value can never feed a decision a stale price it would regret.
export const FETCH_TTL = { latest: 60e3, ts5m: 60e3, tsSlow: 15 * 60e3, vol24: 15 * 60e3 };
const fetchCacheName = url => createHash('sha1').update(url).digest('hex') + '.json';
// pure-ish cache primitives (dir injectable so they're fixture-testable without the network)
export function _fetchCacheGet(dir, url, ttlMs, now = Date.now()) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, fetchCacheName(url)), 'utf8'));
    if (o && o.url === url && (now - o.ts) < ttlMs) return o.data;
  } catch {}
  return undefined;   // miss (absent, wrong url, or expired) — never a fabricated payload
}
export function _fetchCachePut(dir, url, data, now = Date.now()) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, fetchCacheName(url)), JSON.stringify({ ts: now, url, data })); } catch {}
}
export async function cachedJget(url, ttlMs) {
  if (!cacheEnabled || !(ttlMs > 0)) return jget(url);          // disabled → straight passthrough (byte-identical)
  const hit = _fetchCacheGet(FETCH_DIR, url, ttlMs);
  if (hit !== undefined) return hit;
  const data = await jget(url);
  _fetchCachePut(FETCH_DIR, url, data);
  return data;
}

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
    ensureCacheDir(); // MAP_CACHE now lives under .cache/ (OR2) — make sure it exists before writing
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
export async function fetchLatest(id) { const j = await cachedJget(API + '/latest?id=' + id, FETCH_TTL.latest); return (j.data && (j.data[id] || j.data[String(id)])) || null; }
export async function fetchTs(id, step) { return (await cachedJget(API + '/timeseries?id=' + id + '&timestep=' + step, step === '5m' ? FETCH_TTL.ts5m : FETCH_TTL.tsSlow)).data || []; }
export async function fetch24hOne(id) { const j = await cachedJget(API + '/24h?id=' + id, FETCH_TTL.vol24); return (j.data && (j.data[id] || j.data[String(id)])) || null; }

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

   Returns { [id]: { bandLo: min avgLowPrice, bandHi: max avgHighPrice, active5m: #windows two-sided
   WITHIN one 5m bucket (display/quality signal), tradedWin: #windows with ANY trade (Bar D density),
   sawLow / sawHigh: did each side print ≥1× across the window (Bar D two-sidedness) } } for every item
   seen in the windows. bandCore (js/strategies.mjs) gates on tradedWin + sawLow/sawHigh, not active5m. --- */
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
      let b = bands[id]; if (!b) b = bands[id] = { bandLo: null, bandHi: null, active5m: 0, tradedWin: 0, sawLow: false, sawHigh: false };
      if (e.avgLowPrice)  b.bandLo = b.bandLo == null ? e.avgLowPrice : Math.min(b.bandLo, e.avgLowPrice);
      if (e.avgHighPrice) b.bandHi = b.bandHi == null ? e.avgHighPrice : Math.max(b.bandHi, e.avgHighPrice);
      const lv = e.lowPriceVolume || 0, hv = e.highPriceVolume || 0;
      if (lv > 0 && hv > 0) b.active5m++;   // both sides in the SAME 5m window (a quality/display signal, no longer the gate)
      if (lv > 0 || hv > 0) b.tradedWin++;  // Bar D DENSITY: any trade this window (one-sided OK)
      if (lv > 0) b.sawLow = true;          // Bar D TWO-SIDEDNESS: each side printed ≥1× across the whole window
      if (hv > 0) b.sawHigh = true;
    }
  }
  return bands;
}

/* --- loadDaily(days, stepHours): a BULK multi-day mid-price series for EVERY item, zero per-item
   timeseries calls — the regime-proxy source (Fable's structural fix). The wiki /1h endpoint is a
   bulk whole-market snapshot that ALSO accepts ?timestamp=<unix divisible by 3600> for a past 1h
   window (verified live 2026-07-04 against id 560: a 6h-sampled /1h mid series tracks the real
   per-item /timeseries?timestep=6h mids within ~0.5%, well inside the noise a 3d-vs-14d MEDIAN
   proxy tolerates). We sample one window every `stepHours` over the last `days`.

   D0 RE-POINT: the window store is now the Tier-1 SQLite archive (pipeline/lib/archive.mjs), not the
   old per-UTC-day .cache/daily/*.json files. The archive holds ONLY the RAW /1h observations; the
   {ts, mid} regime-proxy series is DERIVED here via mid1h — byte-identical to the pre-D0 output for
   the same windows, because mid1h is the same reduction over the same inputs (proven: the old cache
   stored mid1h(entry); the DB stores the raw entry and we mid1h it at read time). The pre-D0 reduced
   mids are imported ONCE into the archive's `daily_seed` table (seedDailyFromCache) so the switchover
   keeps ~17d of history. Check-before-fetch (hasDailyWindow) means a fast re-run does ZERO network for
   windows already stored; a fetched window is appended keyed by the API-supplied bucket timestamp.
   Pass { db } to reuse an already-open archive handle (loadSnapshot does); otherwise a handle is
   opened + closed here.

   Returns { [id]: [{ ts, mid }] } ascending by ts — the input shape a regime-drift proxy consumes.
   This is a PROXY for picking the fetch pool; the DISPLAYED regime is still the real per-item
   computeQuote/regimeDrift, and the falling-exclusion + rising-confirm remain post-fetch.

   { noFetch }: P3 — assemble the daily mids from ONLY what the archive already holds (raw obs + seed),
   skipping the whole-market /1h backfill. This is the read-only path a surface that must NOT change its
   fetch semantics uses (quote.mjs's per-item read feeds it to floorValidator's term structure): zero
   network, degrades to a sparse/empty series when the archive is cold. --- */
export async function loadDaily(days = 17, stepHours = 6, { db, noFetch = false } = {}) {
  const archive = db || openArchive();
  const ownArchive = !db;
  try {
    try { archive.seedDailyFromCache(DAILY_DIR); } catch {}   // one-time migration of the pre-D0 mids
    const HOUR = 3600, step = stepHours * HOUR;
    const now = Math.floor(Date.now() / 1000);
    const lastHour = Math.floor(now / HOUR) * HOUR - HOUR;      // last complete 1h window
    const latest = Math.floor(lastHour / step) * step;         // align to the step grid (stable windows across runs)
    const nWin = Math.max(1, Math.ceil(days * 24 / stepHours));
    const windows = []; for (let i = 0; i < nWin; i++) windows.push(latest - i * step);

    // backfill only the windows the archive lacks (raw obs OR seed); bulk /1h once each, append RAW.
    // noFetch (read-only) skips this loop entirely — assemble from whatever is already stored.
    for (const w of noFetch ? [] : windows) {
      if (archive.hasDailyWindow(w)) continue;                  // check-before-fetch ⇒ no wasted network
      let resp = null;
      try { resp = await jget(API + '/1h?timestamp=' + w); } catch { resp = null; }
      await sleep(70);
      if (!resp || !resp.data) continue;
      const bts = Number.isFinite(resp.timestamp) ? resp.timestamp : w;  // grid-aligned past window ⇒ bts === w
      try { archive.append('1h', bts, resp.data); } catch {}
    }

    // assemble per-item ascending {ts, mid} series from the archive (raw-derived + seed union)
    const series = {};
    const asc = [...windows].sort((a, b) => a - b);
    let coverageWindows = 0;
    for (const w of asc) {
      const mids = archive.dailyMidsAt(w);
      if (!mids || Object.keys(mids).length === 0) continue;
      coverageWindows++;
      for (const id in mids) (series[id] || (series[id] = [])).push({ ts: w, mid: mids[id] });
    }
    // coverageWindows (distinct requested windows present) lets the caller detect a cold archive
    return { series, coverageWindows };
  } finally {
    if (ownArchive) archive.close();
  }
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
     { bandLo, bandHi, active5m, tradedWin, sawLow, sawHigh, loVol, hiVol, nWin, covered }
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
    let bandLo = null, bandHi = null, active5m = 0, tradedWin = 0, sawLow = false, sawHigh = false, loVol = 0, hiVol = 0, covered = 0;
    for (const w of reqWindows[idx]) {
      const d = s[w]; if (d === undefined) continue; covered++;
      if (!d) continue;
      if (d.lo) bandLo = bandLo == null ? d.lo : Math.min(bandLo, d.lo);
      if (d.hi) bandHi = bandHi == null ? d.hi : Math.max(bandHi, d.hi);
      loVol += d.lv; hiVol += d.hv;
      if (d.lv > 0 && d.hv > 0) active5m++;
      if (d.lv > 0 || d.hv > 0) tradedWin++;
      if (d.lv > 0) sawLow = true;
      if (d.hv > 0) sawHigh = true;
    }
    return { bandLo, bandHi, active5m, tradedWin, sawLow, sawHigh, loVol, hiVol, nWin, covered };
  });
}

/* --- loadHistDaily(reqs, days, stepHours): the PAST-ANCHORED sibling of loadHistBands (YF1). For a
   SET of (item, endUnix) requests it reconstructs the trailing `days` 6h-sampled series ENDING at
   each endUnix — the exact `[{avgLowPrice, avgHighPrice, timestamp}]` shape regimeDrift()/phase()
   consume — sourced from the historical whole-market /1h?timestamp bulk endpoint (the ONLY way to
   read a PAST 1h window; per-item /timeseries has no timestamp param). This is what lets
   lib/histstate.mjs classify regime + phase AS OF a fill, not just now.

   Same disk discipline as loadHistBands: each distinct 6h window (aligned to the step grid so
   nearby reqs share windows) is fetched ONCE whole-market, every requested item extracted from it,
   only the reduced per-item datum {lo,hi} persisted under .cache/outcomes-daily/<id>.json. A window
   with no entry for an item is cached as null so it is never re-fetched. Past windows are immutable.

   reqs: [{ id, endUnix }]. Returns an array aligned to reqs, each an ASCENDING points list
   [{ avgLowPrice, avgHighPrice, timestamp }] (windows with no trade for that item are dropped). --- */
export async function loadHistDaily(reqs, days = 17, stepHours = 6) {
  ensureCacheDir();
  try { fs.mkdirSync(OD_DIR, { recursive: true }); } catch {}
  const step = stepHours * 3600;                              // 6h = 21600, divisible by 3600 (grid-legal for /1h?timestamp)
  const nWin = Math.max(2, Math.ceil(days * 24 / stepHours));
  const align = t => Math.floor(t / step) * step;
  const ids = new Set(reqs.map(r => r.id));

  const store = new Map();                                    // id -> { window: {lo,hi}|null }
  for (const id of ids) { let s = {}; try { s = JSON.parse(fs.readFileSync(path.join(OD_DIR, id + '.json'), 'utf8')); } catch {} store.set(id, s); }

  const reqWindows = reqs.map(r => { const latest = align(r.endUnix); const ws = []; for (let i = 0; i < nWin; i++) ws.push(latest - i * step); return ws; });
  const missing = new Set();
  reqs.forEach((r, idx) => { const s = store.get(r.id); for (const w of reqWindows[idx]) if (s[w] === undefined) missing.add(w); });

  const dirty = new Set();
  for (const w of [...missing].sort((a, b) => b - a)) {
    let data = null;
    try { data = (await jget(API + '/1h?timestamp=' + w)).data || {}; } catch { data = null; }
    await sleep(70);
    for (const id of ids) {
      const s = store.get(id);
      if (s[w] !== undefined) continue;
      if (data === null) continue;                            // fetch failed → leave undefined for a later retry
      const e = data[id] || data[String(id)];
      s[w] = e ? { lo: e.avgLowPrice ?? null, hi: e.avgHighPrice ?? null } : null;
      dirty.add(id);
    }
  }
  for (const id of dirty) { try { fs.writeFileSync(path.join(OD_DIR, id + '.json'), JSON.stringify(store.get(id))); } catch {} }

  return reqs.map((r, idx) => {
    const s = store.get(r.id);
    const pts = [];
    for (const w of [...reqWindows[idx]].sort((a, b) => a - b)) {
      const d = s[w]; if (!d) continue;
      if (d.lo == null && d.hi == null) continue;
      pts.push({ avgLowPrice: d.lo, avgHighPrice: d.hi, timestamp: w });
    }
    return pts;
  });
}

/* --- loadSnapshot({ db, budgetIds, ts1h }): the Pipeline-v2 (D0) per-pass CONTEXT. ONE immutable
   object describing the whole market AS OF one instant, composed ENTIRELY from the existing loaders
   (loadMapping / loadGuide / loadAll24h / loadAllLatest) — this function changes NO loader behavior,
   it just gathers them into a frozen context and, as a side effect, PASSIVELY ACCRUES the Tier-1
   archive: it appends the current bulk /1h and /5m buckets (the only endpoints we archive; keyed by
   the API-supplied bucket timestamp) using check-before-fetch, so a running watch loop that calls
   loadSnapshot each tick grows P6's backtest history at zero marginal fetch on an already-stored
   bucket. /latest is Tier-0 only and is NEVER archived (no idempotent bucket key).

   Shape (P0 will consume it — D0 only BUILDS it):
     { ts, latest, v24, mapping, guide, archive, series(id) }
   - ts        : Date.now() at pass start (the pass instant every derivation anchors to)
   - latest    : whole-market /latest map { id: {high,low,highTime,lowTime} } (loadAllLatest)
   - v24       : whole-market /24h map (loadAll24h)
   - mapping   : the id<->name/limit mapping (loadMapping)
   - guide     : id -> GE guide price (loadGuide)
   - archive   : the open Tier-1 handle (Tier-1 term structure / seriesFor reads)
   - series(id): memoized Tier-2 per-item read (fetchItemInputs) — BUDGETED to `budgetIds`; an id not
                 in the budget returns null so a caller can't accidentally fan out a whole-market
                 per-item fetch through the context. Pass ts1h to include the 1h window series.
   The caller owns the archive lifecycle when it passes `db`; otherwise loadSnapshot opens one and
   leaves it open (a per-pass context is short-lived; close via ctx.archive.close() when done). --- */
export async function loadSnapshot({ db, budgetIds = [], ts1h = false } = {}) {
  const ts = Date.now();
  const mapping = await loadMapping();
  const guide = await loadGuide();
  const v24 = await loadAll24h();
  const latest = await loadAllLatest();
  const archive = db || openArchive();

  // passively accrue Tier-1: append the current COMPLETE bulk /1h and /5m buckets (check-before-fetch).
  // These are cheap whole-market reads; each distinct bucket is stored once (INSERT OR IGNORE), so a
  // fast loop that re-enters the same 5m window does zero extra network.
  for (const grain of ['5m', '1h']) {
    try {
      const probe = await jget(API + '/' + grain);            // latest complete bucket + its API timestamp
      const bts = Number.isFinite(probe && probe.timestamp) ? probe.timestamp : null;
      if (bts != null && probe.data && !archive.hasBucket(grain, bts)) archive.append(grain, bts, probe.data);
    } catch {}
  }

  const budget = new Set((budgetIds || []).map(Number));
  const seriesCache = new Map();
  async function series(id) {
    const n = Number(id);
    if (!budget.has(n)) return null;                           // Tier-2 is budgeted — never a blind fan-out
    if (seriesCache.has(n)) return seriesCache.get(n);
    const inp = await fetchItemInputs(n, { ts1h });
    seriesCache.set(n, inp);
    return inp;
  }

  return Object.freeze({ ts, latest, v24, mapping, guide, archive, series });
}
