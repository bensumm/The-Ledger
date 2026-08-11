/* marketfetch.mjs — the ONE node-side fetch layer for the pipeline analysis scripts
   (quote-items.mjs, screen-flip-niches.mjs, watch-positions.mjs, trigger-alerts.mjs; loadMapping is also the shared name/id
   loader for monitor-offers.mjs / add-manual-fill.mjs). DOM-free; pairs with js/quotecore.js (which
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
const CACHE_DIR = path.join(HERE, '..', '..', '.cache'); // pipeline/.cache/ — this file lives in pipeline/lib/ (OR2)
const DAILY_DIR = path.join(CACHE_DIR, 'daily');       // whole-market 1h window archive @6h spacing (regime proxy)
const TS_DIR = path.join(CACHE_DIR, 'ts');             // per-item timeseries cache (screen re-fetch avoidance)
const OB_DIR = path.join(CACHE_DIR, 'outcomes-bands'); // per-item REDUCED historical 5m bands (join-outcomes.mjs; tiny)
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
// @test-only: fetch-cache control for deterministic tests (fetchcache.test.mjs); production leaves the cache at its default.
export function setFetchCache(on) { cacheEnabled = !!on; }
// @test-only: fetch-cache state probe for tests (fetchcache.test.mjs).
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

/* --- single-item live inputs (quote-items.mjs / --positions) --- */
export async function fetchLatest(id) { const j = await cachedJget(API + '/latest?id=' + id, FETCH_TTL.latest); return (j.data && (j.data[id] || j.data[String(id)])) || null; }
export async function fetchTs(id, step) { return (await cachedJget(API + '/timeseries?id=' + id + '&timestep=' + step, step === '5m' ? FETCH_TTL.ts5m : FETCH_TTL.tsSlow)).data || []; }
export async function fetch24hOne(id) { const j = await cachedJget(API + '/24h?id=' + id, FETCH_TTL.vol24); return (j.data && (j.data[id] || j.data[String(id)])) || null; }

/* --- fetchItemInputs(id): the combined latest + 5m + 6h series + 24h-vol read every per-item
   consumer needs, with polite 60ms spacing across a multi-item ask. THE one copy — was a
   byte-identical `fetchInputs()` inlined in quote-items.mjs / watch-positions.mjs / trigger-alerts.mjs (X1 dedup;
   resolves the lane-N note). Feeds straight into computeQuote({ ...inp, guide, limit, … }). --- */
export async function fetchItemInputs(id, { ts1h = false } = {}) {
  const latest = await fetchLatest(id); await sleep(60);
  const ts5m = await fetchTs(id, '5m'); await sleep(60);
  const ts6h = await fetchTs(id, '6h'); await sleep(60);
  const vol24 = await fetch24hOne(id);
  const out = { latest, ts5m, ts6h, vol24 };
  if (ts1h) { await sleep(60); out.ts1h = await fetchTs(id, '1h'); } // window-context line (watch-positions.mjs only)
  return out;
}

/* --- fetchTsCached(id, step, ttlMs): fetchTs with a short-TTL per-item disk cache under
   .cache/ts/. Used ONLY by the screen (a discovery read where a few-minutes-stale series is
   fine and re-running the screen shouldn't re-hammer the API — the "avoid needless re-fetches"
   rule). quote-items.mjs --positions deliberately keeps the UNcached fetchTs (position management wants
   live). Files are overwritten per (id,step); prune old ones with pruneCache('ts', …). --- */
let tsDirEnsured = false;   // PERF: the TS_DIR mkdir is idempotent — do it ONCE per process, not per call.
export async function fetchTsCached(id, step, ttlMs) {
  if (!tsDirEnsured) { ensureCacheDir(); try { fs.mkdirSync(TS_DIR, { recursive: true }); } catch {} tsDirEnsured = true; }
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

/* --- bulk inputs (screen-flip-niches.mjs). 10-min cache; these are the whole-market snapshots. --- */
export const ALL24H_TTL = 10 * 60 * 1000;   // ONE source of the bulk /24h freshness window (loadAll24h + the warm read)
export async function loadAll24h() {
  const cached = readWarmAll24h();
  if (cached) return cached;
  const j = await jget(API + '/24h'); const d = j.data || {};
  writeCache('all24h.json', d); return d;
}
/* SF-3 — warm-ONLY read of the bulk /24h snapshot (the CONVERGENCE layer for the logged liquidity
   `class`). Returns the whole-market { id: {highPriceVolume, lowPriceVolume, …} } map ONLY IF
   all24h.json is present AND within ALL24H_TTL (a recent screen wrote it) — a PURE, SYNCHRONOUS
   FILE READ, ZERO network. Returns null when the cache is cold / stale / absent so the caller keeps
   its already-fetched per-item volume. HARD CONSTRAINT (SF-3): this must NEVER trigger the ~4000-item
   bulk /24h fetch for a 1-item ask — it reuses the readCache path and by construction cannot fetch
   (no `await`/`jget`). readWarmAll24h(dir, ttl, now) is the dir-injectable primitive (fixture-testable
   without the network, mirroring FC1's _fetchCacheGet); loadAll24hWarm() is the production wrapper. */
export function readWarmAll24h(dir = CACHE_DIR, ttlMs = ALL24H_TTL, now = Date.now()) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, 'all24h.json'), 'utf8'));
    if (o && (now - o.ts) < ttlMs) return o.data;
  } catch {}
  return null;   // cold / stale / absent — caller must NOT fetch (keeps the per-item volume instead)
}
export function loadAll24hWarm() { return readWarmAll24h(); }
export async function loadAllLatest() {
  const cached = readCache('latest.json', 3 * 60 * 1000);
  if (cached) return cached;
  const j = await jget(API + '/latest'); const d = j.data || {};
  writeCache('latest.json', d); return d;
}

/* --- Rolling-24h volume (PLAN-VOL24, 2026-07-13; re-measured 2026-08-10) ---------------------
   THIS BLOCK IS THE ONE HOME for what /24h actually serves. Every other site points here.

   ⚠⚠ READ THIS FIRST — THE PREMISE OF THE 2026-08-10 WAVE WAS WRONG, CORRECTED 2026-08-11.
   That wave concluded "bulk is broken, PER-ITEM is CORRECT (the true trailing-24h), so
   vol24FromInputs is a no-op". **Both halves of that are false.** NEITHER endpoint serves a
   trailing 24h. Both serve a COMPLETE, bit-exact UTC-DAY aggregate; they differ only in WHICH
   day, and per-item is one day fresher:
       bulk      `timestamp` T = 2026-08-09T00:00Z  (that day closed ~25h before the read)
       per-item  `timestamp` T = 2026-08-10T00:00Z  (that day closed ~1.5h before the read)
       the two Ts differ by EXACTLY 24h; both satisfy T % 86400 == 0.
   Measured directly (n=30, each item's own /1h series summed two ways):
       served == sum over the UTC DAY [T, T+23h]  →  30/30
       served == sum over the TRUE TRAILING 24h   →   4/30
   HOW THE WRONG CONCLUSION SURVIVED — this is the part to remember. `lastCompleteHour()` makes
   the composed trailing window coincide with the per-item served day ONLY during 00:00–01:00
   UTC. The "22/24" and then the "19/24 bit-identical" measurements were both taken inside that
   hour (commit d8f63e2 is stamped 01:03 UTC), which is 17:00–18:00 PDT — the hour these
   sessions habitually run in, so it WILL recur. Re-running the identical script one hour later
   gives 4/24. If you are about to conclude the two agree, CHECK THE CLOCK FIRST.
   CONSEQUENCE: vol24FromInputs is NOT a no-op. It does real work roughly 23 hours a day, and
   every downstream statement built on "no live number moves" is void (they are corrected at
   their own sites: read-book.mjs, quote-items.mjs, watch-positions.mjs).
   ALSO: the `?id=` parameter is IGNORED — `/24h?id=2` and `/24h?id=13190` both return the same
   full 4,152-item map. `fetch24hOne` therefore downloads the entire market to read one row.
   Not a correctness bug (it indexes by id), but it is not the cheap call its name implies.

   The two endpoints, as they actually behave:
     • BULK /24h (no id) — the STALER day. It serves a COMPLETE, bit-exact
       UTC-DAY aggregate whose top-level `timestamp` T is the day's START: served hpv/lpv equal
       the /1h sum over [T, T+23h].
       EXACTNESS is established by an OFFSET SCAN, not by a ratio: exact integer equality on BOTH
       hpv and lpv, over candidate 24-bucket windows at other offsets, plus T % 86400 == 0.
       Re-run 2026-08-11 over the FULL two-sided market (3,767 items, T=1786233600): offset 0
       scores 3767/3767, offset −1h 414/3767, offset +1h 383/3767, with T re-read after the scan
       to confirm it had not advanced. Discrimination is overwhelming but NOT literally zero off
       the true window — a thin item whose boundary hours are empty matches at ±1h too, so an
       earlier "0/247 at every other offset" (taken on a coverage-filtered 247-item sample) does
       not generalize. Do NOT cite the ±10% band for this — offset −1h scores 244/247 within
       ±10%, so that test barely discriminates the true window from one shifted a single hour.
       (An earlier version of this block cited the archive's own FWD/BACK ratio as a "control".
       That was a TAUTOLOGY: since endpoint == FWD exactly, endpoint/BACK ≡ FWD/BACK by
       construction. Removed.)
       The defect is STALENESS, not magnitude — and state it against the day's CLOSE, not T:
       the served day closes at T+24h, so a T lag of 71.3h (08-10) and 48.9h (08-11) means the
       day closed 47.3h and 24.9h before those reads. The anchor advances once per UTC day, so
       freshness SAWTOOTHS: the newest data is between ~24h and ~48h old, and the aggregate spans
       24–72h back. ("2–3 days stale" was wrong and is retracted.)
       This is the source loadAll24hRolling exists to replace.
     • PER-ITEM /24h?id= (fetch24hOne) — the FRESHER day, and still NOT a trailing-24h source.
       Its T is one UTC day ahead of bulk's, so the day it serves has typically closed 0–24h ago
       (1.5h at the 2026-08-11 01:30Z read) against bulk's 24–48h. That is a genuine and useful
       difference — it is the better of the two — but "fresher" is not "correct", and the whole
       2026-08-10 wave turned on conflating them.
       ⚠ THREE SUCCESSIVE FIGURES HERE HAVE NOW BEEN RETRACTED. (1) "22/24 BIT-IDENTICAL" sat
       beside "4 had incomplete coverage and 3 of those under-reported by >1%", which cannot both
       hold on one 24-item sample — two probes written as one. (2) The replacement, "19/24", was
       measured inside the 00:00–01:00 UTC hour where the composed window coincides with the
       served day; the same script an hour later returns 4/24. (3) "Every disagreement is the
       COMPOSED side falling short, never endpoint error" is false — on a fresh out-of-window
       probe the composed value EXCEEDED the endpoint on 8/24, by as much as +56%, because it is
       measuring a different window rather than a truncated one.
       What is left standing, and it is the useful part: composing from /1h is the ONLY trailing-24h
       source we have. Both endpoints answer a different question (what did this item trade in a
       fixed past UTC day), which is not the question a liquidity gate asks. So keep the correction
       for its ARITHMETIC as well as its coverage guard — the earlier "it is insurance / a no-op"
       framing understated it by about 23 hours a day.
     • As measured 2026-07-13 (the original finding, kept in PLAN-VOL24.md): a ~1–3h slice of a
       UTC day at ~26h lag — a ~10–27× under-report. HISTORY. Not re-verifiable, and NOT true of
       either endpoint today. Do NOT restate ~10–27× in the present tense; bulk now measures
       ~1.0× against the day it labels.
   WHY IT CHANGED IS UNKNOWN — do not invent a mechanism. An earlier version of this block claimed
   the endpoint "used to serve a partial, still-accumulating day and now waits for it to close,
   which is exactly why staleness grew while accuracy went to exact." That story is RETRACTED: it
   contradicts the July evidence it claimed to explain (PLAN-VOL24 records 14 days of HISTORICAL
   /24h?timestamp= buckets each truncated to their first 1–3h — closed days, truncated, not
   accumulating), and if T is the day's START then a 26h-old T describes a day that closed 2h
   before the read and cannot still be accumulating. Both observations are real; the causal link
   between them is not established. State the two measurements in their own tense and stop there.
   Net: the BULK correction below is load-bearing; the per-item correction is insurance.
   The /5m, /1h, /6h grains are healthy. These
   composers reconstruct the TRUE trailing-24h volume from the /1h grain:
     • rolling24FromTs1h — sums an ALREADY-FETCHED per-item /timeseries?1h (ZERO new fetch on a row
       whose 1h series is in hand: screen survivors, quote COD-4).
     • loadAll24hRolling — walks the last 24 complete /1h?timestamp bulk windows (the loadDaily/
       loadBands grid-aligned pattern), REUSING the Tier-1 SQLite 1h archive (check-before-fetch, so a
       warm machine fetches only the gaps loadSnapshot/loadDaily didn't accrue).
   Both were proven EXACT vs a per-item timeseries sum (10/10 items, hpv AND lpv, 2026-07-13). The
   emitted per-id shape MATCHES loadAll24h's entry — {highPriceVolume,lowPriceVolume,avgHighPrice,
   avgLowPrice} — so a caller can swap sources with no shape change; the avg prices are volume-weighted
   24h means of the hourly avgs (a real VWAP, unlike /24h's single averaged number).
   ⚠ `rolling` IS THE SCREEN DEFAULT and has been since step 2 shipped (2026-07-13) —
   screen-flip-niches.mjs `--vol-source` has `fallback: 'rolling'`, pinned by compose.test.mjs.
   This paragraph said the opposite ("SHADOW/opt-in … the DEFAULT legacy path never calls it, so
   nothing changes live … pending the floor recalibration") for roughly a month after the thing it
   was pending on had shipped. `--vol-source legacy` is the ESCAPE HATCH, not the default. */
export const ROLL24_HOURS = 24;
// last COMPLETE 1h bucket start (unix sec); the trailing-24h window is [anchor-23h, anchor].
function lastCompleteHour(now = Date.now()) { return Math.floor(now / 1000 / 3600) * 3600 - 3600; }
// volume-weighted mean of [[avgPrice, vol], …] (skips null price / zero-vol pairs); null if no volume.
function vwap(pairs) {
  let num = 0, den = 0;
  for (const [p, v] of pairs) { if (p == null || !(v > 0)) continue; num += p * v; den += v; }
  return den > 0 ? Math.round(num / den) : null;
}
export function rolling24FromTs1h(ts1h, now = Date.now()) {
  if (!Array.isArray(ts1h) || !ts1h.length) return null;
  const anchor = lastCompleteHour(now);
  const from = anchor - (ROLL24_HOURS - 1) * 3600;
  let hpv = 0, lpv = 0; const hi = [], lo = [];
  for (const p of ts1h) {
    if (!p || !(p.timestamp >= from) || p.timestamp > anchor) continue;
    hpv += p.highPriceVolume || 0; lpv += p.lowPriceVolume || 0;
    hi.push([p.avgHighPrice, p.highPriceVolume || 0]); lo.push([p.avgLowPrice, p.lowPriceVolume || 0]);
  }
  return { highPriceVolume: hpv, lowPriceVolume: lpv, avgHighPrice: vwap(hi), avgLowPrice: vwap(lo) };
}
/* vol24FromInputs(inp, now) → { vol24, volSrc, buckets } — the CORRECTED per-item volume for a quote/watch read.
   ⚠ STATUS (corrected 2026-08-11 — the THIRD revision of this paragraph; read the ONE HOME block above
   before trusting any figure here). The PER-ITEM /24h?id= endpoint this overrides is NOT the true
   trailing-24h: it is a complete UTC-DAY aggregate, one day fresher than bulk. Measured 30/30 exact
   against the day its own `timestamp` labels, 4/30 against the true trailing window. So this function's
   ARITHMETIC is NOT a no-op — it moves the number roughly 23 hours a day, and is a no-op only inside the
   00:00–01:00 UTC hour where the composed window happens to coincide with the served day. Two earlier
   versions of this paragraph claimed the opposite ("currently correct", "presently a no-op"); both were
   measured inside that hour. Its coverage guard matters too, but it is no longer the only thing that does.
   It prefers the TRUE trailing-24h composed from the item's IN-HAND 1h series (rolling24FromTs1h — zero new
   fetch on a surface that already fetched ts1h: quote COD-4, watch window line). DEGRADES to the /24h read
   (volSrc 'peritem-24h') when the 1h series is absent OR too short to cover the trailing 24h (a brand-new
   item, or a truncated fetch) — a partial 1h sum would UNDER-report worse than /24h. The returned vol24 is
   the SAME shape computeQuote consumes ({highPriceVolume,lowPriceVolume,avgHighPrice,avgLowPrice}), so it's
   a drop-in override that also corrects the pressure ratio + the 24h avg-low/high dip reference. It does NOT
   touch computeQuote (js/quotecore.js is app-imported — byte-identical); it only changes the VALUE passed in.
   ⚠ `volSrc` and `buckets` are DIAGNOSTIC ONLY — as of 2026-08-11 NO production caller reads either; both
   call sites (`read-book.mjs`, and the quote/watch path) take `.vol24` and discard the rest, so the fields
   are kept alive solely by vol24.test.mjs. Do not write a comment claiming callers "judge coverage" on
   `buckets` until one actually does. They are cheap and genuinely useful when probing a degraded read by
   hand, which is why they stay; surfacing `volSrc` on a degraded quote is an open, unscheduled follow-up.
   (check-dead-exports.mjs sees exports, not returned FIELDS, so nothing catches this class automatically.) */
export function vol24FromInputs(inp, now = Date.now()) {
  const ts1h = inp && inp.ts1h;
  const fallback = (buckets) => ({ vol24: inp ? (inp.vol24 ?? null) : null, volSrc: 'peritem-24h', buckets });
  if (Array.isArray(ts1h) && ts1h.length) {
    const anchor = lastCompleteHour(now);
    const from = anchor - (ROLL24_HOURS - 1) * 3600;
    let earliest = Infinity, latest = -Infinity, buckets = 0;
    for (const p of ts1h) {
      if (!p || !Number.isFinite(p.timestamp)) continue;
      if (p.timestamp < earliest) earliest = p.timestamp;
      if (p.timestamp > latest) latest = p.timestamp;
      if (p.timestamp >= from && p.timestamp <= anchor) buckets++;
    }
    // COVERAGE MUST HOLD AT BOTH ENDS. `earliest <= from` alone left an END-OF-WINDOW hole: a series that
    // reaches far enough BACK but stops hours short of the anchor passed the guard and summed a PARTIAL
    // window — under-reporting in exactly the way this function exists to prevent, and silently, since
    // volSrc still said 'rolling'. Requiring `latest >= anchor` closes it. Pinned by vol24.test.mjs.
    // DO NOT "STRENGTHEN" THIS TO `buckets === 24`. I suspected the both-ends test still admitted a
    // series with INTERIOR gaps that would sum a partial window; that is REFUTED (2026-08-11).
    // /timeseries?timestep=1h OMITS no-trade hours entirely, so a missing interior bucket carries zero
    // volume and the sum is still complete — measured across 120 sampled items, every series this guard
    // accepted with FEWER than 24 in-window buckets was bit-identical to the per-item endpoint, down to a
    // series with ONE in-window bucket (plus older out-of-window points — a literally single-POINT series
    // cannot pass: `earliest == latest == anchor > from` fails the back-end test, so the earlier phrase
    // "down to a single-bucket series" was unreachable as written).
    // The mechanism was verified directly rather than assumed: across sampled items, ZERO returned points
    // had both volumes zero, with up to 350 non-contiguous hour steps inside a 365-point series — so the
    // endpoint genuinely OMITS empty hours rather than zero-filling them. A `buckets === 24` requirement
    // would be strictly worse: it would reject correct sparse (thin-item) series wholesale.
    // ⚠ Known cost — the earlier version of this note UNDERSTATED it. It said the fallback "is currently
    // correct at every call site, so no live number moves". That is FALSE: the per-item endpoint is a
    // UTC-DAY aggregate, not the trailing window (see the ONE HOME block), so falling back DOES move the
    // number — measured up to −10.2% on a fresh out-of-window probe. A false rejection is a real
    // degradation, not a free one.
    // ⚠ And the back-end test `earliest <= from` almost never binds: /timeseries returns up to 365 points
    // (~15 days), so only a brand-new item fails it. Measured n=30: back-end failed 0, front-end failed 6.
    // "Coverage must hold at BOTH ends" is honest about intent, but one end does all the work.
    if (earliest <= from && latest >= anchor) {
      const r = rolling24FromTs1h(ts1h, now);
      if (r && ((r.highPriceVolume || 0) > 0 || (r.lowPriceVolume || 0) > 0)) return { vol24: r, volSrc: 'rolling', buckets };
    }
    return fallback(buckets);
  }
  return fallback(0);   // DEGRADED: the raw per-item /24h read
}
export async function loadAll24hRolling({ db } = {}) {
  const cached = readCache('all24h-rolling.json', ALL24H_TTL);
  if (cached) return cached;
  const archive = db || openArchive();
  const ownArchive = !db;
  try {
    const anchor = lastCompleteHour();
    const windows = []; for (let i = 0; i < ROLL24_HOURS; i++) windows.push(anchor - i * 3600);
    // backfill only the /1h buckets the archive lacks (bulk fetch each once, append RAW — idempotent PK)
    for (const w of windows) {
      if (archive.hasBucket('1h', w)) continue;
      let resp = null;
      try { resp = await jget(API + '/1h?timestamp=' + w); } catch { resp = null; }
      await sleep(70);
      if (!resp || !resp.data) continue;
      const bts = Number.isFinite(resp.timestamp) ? resp.timestamp : w;   // grid-aligned ⇒ bts === w
      try { archive.append('1h', bts, resp.data); } catch {}
    }
    // aggregate per item across the 24 windows from the archive (raw obs)
    const acc = {};                                            // id -> {hpv,lpv, hi:[[p,v]], lo:[[p,v]]}
    for (const w of windows) {
      const snap = archive.marketAt('1h', w);
      for (const id in snap) {
        const e = snap[id]; if (!e) continue;
        const a = acc[id] || (acc[id] = { hpv: 0, lpv: 0, hi: [], lo: [] });
        a.hpv += e.highPriceVolume || 0; a.lpv += e.lowPriceVolume || 0;
        a.hi.push([e.avgHighPrice, e.highPriceVolume || 0]); a.lo.push([e.avgLowPrice, e.lowPriceVolume || 0]);
      }
    }
    const out = {};
    for (const id in acc) {
      const a = acc[id];
      out[id] = { highPriceVolume: a.hpv, lowPriceVolume: a.lpv, avgHighPrice: vwap(a.hi), avgLowPrice: vwap(a.lo) };
    }
    writeCache('all24h-rolling.json', out);
    return out;
  } finally {
    if (ownArchive) archive.close();
  }
}

/* --- loadDailyRangeBulk(days, { db, ids }) — the thin marketfetch wrapper over the archive's
   dailyRangeBulk (PLAN-LANE-ADMISSION Chunk A). Reads the whole-market per-item per-DAY intraday
   range (MAX avgHigh / MIN avgLow over each day's /1h buckets) straight from the Tier-1 SQLite
   archive — READ-ONLY, ZERO fetch (unlike loadDaily/loadAll24hRolling, this NEVER backfills; it only
   reads what accrual has already stored). Powers Path-A's intraday-range margin (Chunk C).

   HONESTY (finding #1): full 24/24 hourly coverage only started 2026-07-13, so a `days`-back window
   can silently thin out for its oldest days. This wrapper NEVER assumes `days` of real depth — it
   reports `coverageDays` = the number of days in the window that actually have FULL 24-bucket 1h
   coverage (same pattern as loadDaily's `coverageWindows`). Do NOT hardcode 14 anywhere downstream;
   read coverageDays. `partialDays` is the count of days present but under-covered (<24 buckets).

   Returns { ranges, coverageDays, partialDays, coverage } where ranges is
   { [id]: { [dateKey]: {hi, lo} } } and coverage is { [dateKey]: nBuckets }. Degrades honestly on a
   cold archive: { ranges:{}, coverageDays:0, partialDays:0, coverage:{} }, never throws.
   `db`: reuse an already-open handle (mirrors loadDaily/loadBands); else opened + closed here. --- */
export const FULL_DAY_1H_BUCKETS = 24;   // a UTC day is fully covered when all 24 /1h buckets are stored
// @provisional-api: bulk daily-range loader for Path-A margin; consumed by the ranker at PLAN-LANE-ADMISSION Chunks D+E.
export function loadDailyRangeBulk(days = 14, { db, ids } = {}) {
  const archive = db || openArchive();
  const ownArchive = !db;
  try {
    const sinceTs = Math.floor(Date.now() / 1000) - Math.max(1, days) * 24 * 3600;
    const { ranges, coverage } = archive.dailyRangeBulk({ ids, sinceTs });
    let coverageDays = 0, partialDays = 0;
    for (const d in coverage) {
      if (coverage[d] >= FULL_DAY_1H_BUCKETS) coverageDays++;
      else if (coverage[d] > 0) partialDays++;
    }
    return { ranges, coverageDays, partialDays, coverage };
  } finally {
    if (ownArchive) archive.close();
  }
}

/* --- newest1hAgeHours({ db }) → hours since the newest /1h bucket in the archive, or null if the
   archive holds no /1h data yet (cold clone / :memory: CI). Thin READ-ONLY, ZERO-fetch wrapper over
   archive.newestBucket('1h') (mirrors loadDailyRangeBulk's shape) so the cache-warm guard
   (PLAN-DAEMON-SUBSYSTEM) can ask "how cold are we?" without opening the archive itself. Degrades
   honestly: null on a cold archive (the guard reads null as "cold"), never throws.
   `db`: reuse an already-open handle; else opened + closed here. --- */
// @provisional-api: /1h archive-freshness probe; consumed by the cache-warm module at PLAN-DAEMON-SUBSYSTEM Chunk 4.
export function newest1hAgeHours({ db, now = Date.now() } = {}) {
  const archive = db || openArchive();
  const ownArchive = !db;
  try {
    const ts = archive.newestBucket('1h');
    if (ts == null) return null;
    return (now - ts * 1000) / 3_600_000;
  } finally {
    if (ownArchive) archive.close();
  }
}

/* --- loadBands(hours): whole-market intraday band data for EVERY item, zero per-item
   timeseries calls (chunk 9.1). The wiki /5m endpoint is a bulk whole-market snapshot and
   accepts ?timestamp=<unix, divisible by 300> to fetch a past 5m window. We walk the last
   `hours` of 5m windows, reading each from the Tier-1 SQLite archive (PERF-1, 2026-07-19 —
   migrated off a flat-file-per-day cache under .cache/bands/) when present, else fetching it
   once and appending it. First cold 2h run ≈ 24 bulk calls (~70ms apart); every later run only
   backfills the windows minted since — mirrors loadAll24hRolling's check-before-fetch pattern.

   PERF-1: the old .cache/bands/*.json day-files were read IN FULL (every retained day, up to
   BANDS_RETENTION_DAYS=90) on every single call just to pull the ~24 needed windows — measured at
   45-70% of a whole `/scan` pass's wall time once the cache grew past a couple weeks (359MB / 17
   files at the time of the fix), and only getting worse as it accreted toward the 90d cap. The
   SQLite archive already indexes by (grain, ts) — `marketAt('5m', w)` reads exactly the requested
   window, no linear scan, no retention pruning needed (the archive is append-forever by policy;
   MEASURED 2026-07-28 at 4.0 GB/yr observed / 8.1 GB/yr at full coverage — the older ~30-35GB/yr
   figure was an over-estimate, see archive.mjs `pruneBefore` for the full per-grain breakdown and
   the list of surfaces that read historical 5m). `loadHistBands` (below) is a SEPARATE
   function with its own per-item reduced cache (.cache/outcomes-bands/) for the outcome-join's
   past-window reconstruction — untouched by this change, do not conflate the two.

   Window alignment (verified live 2026-07-03 against id 560): `latest = floor(now/300)*300 - 300`
   is the last COMPLETE 5m window and equals the last point of /timeseries?timestep=5m; the 24
   windows [latest, latest-300, …] are byte-identical to that series' slice(-24). So the edges
   below == computeQuote's bandLo/bandHi over the same item — that is the mandatory sanity gate.

   Returns { [id]: { bandLo: min avgLowPrice, bandHi: max avgHighPrice, active5m: #windows two-sided
   WITHIN one 5m bucket (display/quality signal), tradedWin: #windows with ANY trade (Bar D density),
   sawLow / sawHigh: did each side print ≥1× across the window (Bar D two-sidedness) } } for every item
   seen in the windows. bandCore (js/flip-niches.mjs) gates on tradedWin + sawLow/sawHigh, not active5m.

   `db`: an already-open archive handle to share (mirrors loadAll24hRolling/loadSnapshot) — when
   omitted, loadBands opens and closes its own. --- */

/* --- Bar E (Ben 2026-07-10) — robustify the band EDGES so a lone flier print can't set bandHi/bandLo.
   robustBand + the three BAND_EDGE_* placeholders now live in js/quotecore.js (app+node shared home,
   Scope B) so the pipeline surfacing path here and the app-facing computeQuote Optimistic column
   robustify off the ONE implementation; re-exported here so callers/tests that import them from this
   module keep working. Doctrine (see the robustBand header in js/quotecore.js): DENSE side (≥
   BAND_EDGE_MIN_SAMPLE prints) → p90 high / p10 low; SPARSE side → raw extremum. SCOPE within this file:
   loadBands (the LIVE surfacing path) uses it; loadHistBands stays RAW min/max on purpose — its job is
   honest historical RECONSTRUCTION for the O1 backtest-join (the real band a trade sat in, flier and
   all), not surfacing. Thresholds are NAMED PLACEHOLDERS pending validation; rawBandLo/rawBandHi kept
   for audit. */
import { robustBand, BAND_EDGE_MIN_SAMPLE, BAND_EDGE_HI_Q, BAND_EDGE_LO_Q } from '../../../js/quotecore.js';
export { robustBand, BAND_EDGE_MIN_SAMPLE, BAND_EDGE_HI_Q, BAND_EDGE_LO_Q };   // re-export: callers/tests import from here

export async function loadBands(hours = 2, { db } = {}) {
  const archive = db || openArchive();
  const ownArchive = !db;
  try {
    const step = 300;
    const now = Math.floor(Date.now() / 1000);
    const latest = Math.floor(now / step) * step - step;       // last complete 5m window
    const nWin = Math.max(1, Math.ceil(hours * 3600 / step));
    const windows = []; for (let i = 0; i < nWin; i++) windows.push(latest - i * step);

    // backfill only the /5m buckets the archive lacks (bulk fetch each once, append RAW — idempotent PK)
    for (const w of windows) {
      if (archive.hasBucket('5m', w)) continue;
      let data = null;
      try { data = (await jget(API + '/5m?timestamp=' + w)).data || null; } catch { data = null; }
      await sleep(70);
      if (!data) continue;
      try { archive.append('5m', w, data); } catch {}
    }

    // aggregate per item across the requested windows (matches computeQuote min/max over ts.slice(-24))
    const bands = {};
    for (const w of windows) {
      const snap = archive.marketAt('5m', w);
      for (const id in snap) {
        const e = snap[id]; if (!e) continue;
        let b = bands[id]; if (!b) b = bands[id] = { los: [], his: [], active5m: 0, tradedWin: 0, sawLow: false, sawHigh: false };
        if (e.avgLowPrice)  b.los.push(e.avgLowPrice);   // Bar E: collect each side's prints; robustBand sets the edge below
        if (e.avgHighPrice) b.his.push(e.avgHighPrice);
        const lv = e.lowPriceVolume || 0, hv = e.highPriceVolume || 0;
        if (lv > 0 && hv > 0) b.active5m++;   // both sides in the SAME 5m window (a quality/display signal, no longer the gate)
        if (lv > 0 || hv > 0) b.tradedWin++;  // Bar D DENSITY: any trade this window (one-sided OK)
        if (lv > 0) b.sawLow = true;          // Bar D TWO-SIDEDNESS: each side printed ≥1× across the whole window
        if (hv > 0) b.sawHigh = true;
      }
    }
    // Bar E — set each band's edges from the collected prints (robust p90/p10 on a dense side, raw
    // extremum on a sparse one); rawBandLo/rawBandHi kept for audit. Drop the working arrays.
    for (const id in bands) {
      const b = bands[id];
      const r = robustBand(b.los, b.his);
      b.bandLo = r.bandLo; b.bandHi = r.bandHi; b.rawBandLo = r.rawBandLo; b.rawBandHi = r.rawBandHi;
      delete b.los; delete b.his;
    }
    return bands;
  } finally {
    if (ownArchive) archive.close();
  }
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
   fetch semantics uses (quote-items.mjs's per-item read feeds it to floorValidator's term structure): zero
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
   read a PAST 5m window — per-item /timeseries?5m only reaches ~30h back). Powers join-outcomes.mjs's
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

  // aggregate the band per request (same min-low / max-high basis as computeQuote's 2h band).
  // Bar E note: this RECONSTRUCTION path stays RAW min/max on purpose (the real band a historical
  // trade sat in, flier and all — the O1 backtest-join needs the actual band, not the surfacing-robust one).
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
   lib/range-position.mjs classify regime + phase AS OF a fill, not just now.

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
    // Cache the in-flight PROMISE, not the resolved value (chunk 5): two concurrent series(n) calls
    // for the same id would both miss a value-cache and double-fetch. A rejection is evicted so a
    // later call can retry (matches the old resolved-value cache's fail-and-retry behavior).
    const p = fetchItemInputs(n, { ts1h });
    seriesCache.set(n, p);
    p.catch(() => { if (seriesCache.get(n) === p) seriesCache.delete(n); });
    return p;
  }

  return Object.freeze({ ts, latest, v24, mapping, guide, archive, series });
}
