/* archive.mjs — the Tier-1 SQLite market archive (Pipeline v2, chunk D0).
   A thin, DOM-free wrapper over node:sqlite (`DatabaseSync`, verified on Node v22.16). It is the
   append-forever home for the RAW bulk bucketed market snapshots — the broad intraday history that
   the wiki API only serves ~30h/item live (so accrual is the ONLY route to it) and that P3's term
   structure + P6's walk-forward backtests read.

   ── DON'T-REBUILD INVARIANTS (load-bearing; the "no duplicates / no blowup by construction" rules) ──
   1. Archive ONLY bucketed endpoints — /1h and /5m — keyed by the API-SUPPLIED bucket `timestamp`
      (the top-level field the wiki returns, e.g. /5m → timestamp 1783563300). NEVER /latest: it is
      an instantaneous read with no stable bucket, so it has no idempotent key and would duplicate.
   2. PK (grain, ts, itemId) + `INSERT OR IGNORE` ⇒ re-appending a bucket is a no-op (idempotent).
      A companion `buckets` table records each whole-market (grain, ts) that has been stored, so a
      caller can ask `hasBucket(grain, ts)` and SKIP THE FETCH ENTIRELY on a fast loop (no wasted
      network on a bucket already archived). Check-before-fetch is the caller's job; this module
      exposes the cheap predicate.
   3. Store ONLY raw observations (avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume).
      EVERYTHING derived — regime, phase, bands, term structure, validator/path scores — is recomputed
      by pure functions from these raw rows and is NEVER cached here. (The one bridge exception is the
      `daily_seed` table: pre-D0 the regime proxy lived as reduced MIDS in .cache/daily/*.json; those
      derived mids are imported ONCE into `daily_seed` so the loadDaily switchover doesn't lose ~17d of
      history. Nothing writes daily_seed after the one-time seed; it ages out of every window grid.)
   4. WAL + busy_timeout so ad-hoc runs and a future desk orchestrator (P8) can write concurrently
      without "database is locked".

   ── ExperimentalWarning suppression (decision) ──
   node:sqlite prints `ExperimentalWarning: SQLite is an experimental feature…` the moment the module
   is LOADED. A static `import` hoists above any module-body code, so we can't install a filter first;
   instead we override `process.emitWarning` to drop exactly that one warning, THEN `createRequire`
   node:sqlite synchronously (proven to suppress it). This is process-scoped and surgical — every other
   warning still prints, and no `--no-warnings`/global flag is required on any script (so the
   watch-loop stdout/stderr contract stays clean without callers opting in). */

import fs from 'node:fs';
import pathMod from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = pathMod.dirname(fileURLToPath(import.meta.url));
// Append-forever, gitignored, and deliberately OUTSIDE pipeline/.cache/ (that tree is disposable /
// pruned; the archive must survive). Sidecars .sqlite-wal / .sqlite-shm are gitignored too.
export const DEFAULT_DB = pathMod.join(HERE, '..', '..', '.market-archive.sqlite');

export const GRAINS = new Set(['1h', '5m']);   // the ONLY endpoints we archive (bucketed; never /latest)
const RAW_FIELDS = ['avgHighPrice', 'avgLowPrice', 'highPriceVolume', 'lowPriceVolume'];

// --- surgical ExperimentalWarning suppression, installed BEFORE node:sqlite loads (see header) ---
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const opt = rest[0];
  const type = (opt && typeof opt === 'object') ? opt.type : opt;
  const msg = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (type === 'ExperimentalWarning' && /SQLite/i.test(msg)) return;   // drop only THIS one
  return _emitWarning(warning, ...rest);
};
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const mid1h = e => (e && e.avgLowPrice && e.avgHighPrice) ? (e.avgLowPrice + e.avgHighPrice) / 2
  : (e && (e.avgLowPrice || e.avgHighPrice)) || null;

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      grain           TEXT    NOT NULL,
      ts              INTEGER NOT NULL,
      itemId          INTEGER NOT NULL,
      avgHighPrice    INTEGER,
      avgLowPrice     INTEGER,
      highPriceVolume INTEGER,
      lowPriceVolume  INTEGER,
      PRIMARY KEY (grain, ts, itemId)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS obs_item ON observations (grain, itemId, ts);
    CREATE TABLE IF NOT EXISTS buckets (
      grain    TEXT    NOT NULL,
      ts       INTEGER NOT NULL,
      storedAt INTEGER,
      rows     INTEGER,
      PRIMARY KEY (grain, ts)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS daily_seed (
      ts     INTEGER NOT NULL,
      itemId INTEGER NOT NULL,
      mid    REAL,
      PRIMARY KEY (ts, itemId)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      val TEXT
    );
  `);
}

/* open(dbPath = DEFAULT_DB, { readonly = false }) → a handle. Callers open explicitly (nothing here
   touches the real DB on import), so CI/tests hit only temp / :memory: databases. */
export function open(dbPath = DEFAULT_DB, { readonly = false } = {}) {
  if (dbPath !== ':memory:') {
    try { fs.mkdirSync(pathMod.dirname(dbPath), { recursive: true }); } catch {}
  }
  const db = new DatabaseSync(dbPath, { readOnly: readonly });
  // WAL + a generous busy_timeout for concurrent ad-hoc writers (invariant 4). :memory: ignores WAL.
  try { db.exec('PRAGMA journal_mode = WAL;'); } catch {}
  try { db.exec('PRAGMA busy_timeout = 5000;'); } catch {}
  if (!readonly) initSchema(db);

  const stmtHasBucket = db.prepare('SELECT 1 FROM buckets WHERE grain = ? AND ts = ? LIMIT 1');
  const stmtInsObs = db.prepare(
    `INSERT OR IGNORE INTO observations (grain, ts, itemId, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume)
     VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const stmtInsBucket = db.prepare('INSERT OR IGNORE INTO buckets (grain, ts, storedAt, rows) VALUES (?, ?, ?, ?)');

  const handle = {
    db,
    path: dbPath,

    /* Has this whole-market (grain, ts) bucket already been stored? Cheap — the caller's
       check-before-fetch predicate (invariant 2). */
    hasBucket(grain, ts) {
      return !!stmtHasBucket.get(String(grain), Number(ts));
    },

    /* append(grain, ts, data): archive one whole-market bulk snapshot. `data` is the wiki
       `{ [id]: {avgHighPrice,avgLowPrice,highPriceVolume,lowPriceVolume} }` map; `ts` MUST be the
       API-supplied bucket timestamp. Idempotent (INSERT OR IGNORE on the composite PK). Returns
       { inserted, bucketNew }. Only the four raw fields are persisted (invariant 3). */
    append(grain, ts, data) {
      const g = String(grain), t = Number(ts);
      if (!GRAINS.has(g)) throw new Error(`archive.append: refusing non-bucketed grain '${g}' (only ${[...GRAINS].join('/')})`);
      if (!Number.isFinite(t)) throw new Error('archive.append: bucket ts must be a finite number');
      const ids = data ? Object.keys(data) : [];
      let inserted = 0;
      db.exec('BEGIN');
      try {
        for (const idStr of ids) {
          const e = data[idStr]; if (!e) continue;
          const r = stmtInsObs.run(g, t, Number(idStr),
            e.avgHighPrice ?? null, e.avgLowPrice ?? null,
            e.highPriceVolume ?? null, e.lowPriceVolume ?? null);
          inserted += Number(r.changes || 0);
        }
        const b = stmtInsBucket.run(g, t, Date.now(), ids.length);
        db.exec('COMMIT');
        return { inserted, bucketNew: Number(b.changes || 0) > 0 };
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch {}
        throw err;
      }
    },

    /* seriesFor(itemId, grain, {from, to}) → ascending raw rows for one item:
       [{ ts, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume }]. from/to are inclusive
       unix-second bounds (omit for all). Derivations (mid, regime, phase) are the caller's job. */
    seriesFor(itemId, grain, { from = -Infinity, to = Infinity } = {}) {
      const lo = Number.isFinite(from) ? from : -9e18;
      const hi = Number.isFinite(to) ? to : 9e18;
      return db.prepare(
        `SELECT ts, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume
           FROM observations WHERE grain = ? AND itemId = ? AND ts BETWEEN ? AND ?
          ORDER BY ts ASC`).all(String(grain), Number(itemId), lo, hi);
    },

    /* marketAt(grain, ts) → the whole-market slice at one bucket as
       { [id]: {avgHighPrice,avgLowPrice,highPriceVolume,lowPriceVolume} } (same shape the API
       returned), reconstructed from stored raw rows. */
    marketAt(grain, ts) {
      const rows = db.prepare(
        `SELECT itemId, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume
           FROM observations WHERE grain = ? AND ts = ?`).all(String(grain), Number(ts));
      const out = {};
      for (const r of rows) out[r.itemId] = {
        avgHighPrice: r.avgHighPrice, avgLowPrice: r.avgLowPrice,
        highPriceVolume: r.highPriceVolume, lowPriceVolume: r.lowPriceVolume,
      };
      return out;
    },

    /* dailyRangeBulk({ ids, sinceTs }) → the whole-market per-item per-DAY price range off the raw
       /1h observations, in ONE bulk SQL aggregate (no per-item fetch, no per-item loop). READ-ONLY —
       never touches append/buckets/write paths. Powers PLAN-LANE-ADMISSION's Path-A intraday-range
       margin (the "bulk /1h archive walk"): a day's range = MAX(avgHighPrice) / MIN(avgLowPrice) over
       that day's 1h buckets, GROUP BY (itemId, day). Day key = date(ts,'unixepoch') (UTC) — this is an
       INTERNAL aggregate key for range computation, NOT a rendered timestamp, so UTC is correct here
       (the local-time display convention governs surfaced times, not this bucketing).

       Returns { ranges, coverage }:
         ranges   : { [itemId]: { [dateKey]: { hi, lo } } }  (hi/lo may be null if a side never printed)
         coverage : { [dateKey]: nBuckets }  — distinct 1h buckets stored for that day (24 = full day),
                    from the authoritative `buckets` table; lets a wrapper report coverageDays honestly
                    instead of hardcoding a lookback depth the archive may not actually hold yet.
       Degrades honestly on a cold/empty archive: returns { ranges:{}, coverage:{} }, NEVER throws (so
       fixtures/CI on a temp/:memory: DB get a clean empty, not an error).
         - ids     : optional itemId whitelist (omit → whole market)
         - sinceTs : optional inclusive unix-second lower bound (omit → all history) */
    dailyRangeBulk({ ids, sinceTs } = {}) {
      try {
        const rangeClauses = ["grain = '1h'"], rangeArgs = [];
        if (Number.isFinite(sinceTs)) { rangeClauses.push('ts >= ?'); rangeArgs.push(Number(sinceTs)); }
        if (ids && ids.length) { rangeClauses.push(`itemId IN (${ids.map(() => '?').join(',')})`); ids.forEach(i => rangeArgs.push(Number(i))); }
        const rangeWhere = 'WHERE ' + rangeClauses.join(' AND ');
        const rows = db.prepare(
          `SELECT itemId, date(ts, 'unixepoch') AS d, MAX(avgHighPrice) AS hi, MIN(avgLowPrice) AS lo
             FROM observations ${rangeWhere}
            GROUP BY itemId, d`).all(...rangeArgs);
        const ranges = {};
        for (const r of rows) {
          const bucket = ranges[r.itemId] || (ranges[r.itemId] = {});
          bucket[r.d] = { hi: r.hi ?? null, lo: r.lo ?? null };
        }
        // coverage: distinct 1h buckets per day from the buckets table (24 ⇒ a full-coverage day).
        const covClauses = ["grain = '1h'"], covArgs = [];
        if (Number.isFinite(sinceTs)) { covClauses.push('ts >= ?'); covArgs.push(Number(sinceTs)); }
        const covRows = db.prepare(
          `SELECT date(ts, 'unixepoch') AS d, COUNT(*) AS n
             FROM buckets WHERE ${covClauses.join(' AND ')} GROUP BY d`).all(...covArgs);
        const coverage = {};
        for (const r of covRows) coverage[r.d] = Number(r.n || 0);
        return { ranges, coverage };
      } catch {
        return { ranges: {}, coverage: {} };   // cold/empty archive → clean empty, never throw
      }
    },

    /* exportFixture({ grain, ids, from, to, path }) → a compact, deterministic fixture object of raw
       observations (sorted grain→ts→itemId). Writes JSON to `path` when given. Round-trips through
       `append` (append each bucket) — the format the P1 replay harness reads. */
    exportFixture({ grain, ids, from = -Infinity, to = Infinity, path } = {}) {
      const clauses = [], args = [];
      if (grain) { clauses.push('grain = ?'); args.push(String(grain)); }
      if (ids && ids.length) { clauses.push(`itemId IN (${ids.map(() => '?').join(',')})`); ids.forEach(i => args.push(Number(i))); }
      if (Number.isFinite(from)) { clauses.push('ts >= ?'); args.push(from); }
      if (Number.isFinite(to)) { clauses.push('ts <= ?'); args.push(to); }
      const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
      const observations = db.prepare(
        `SELECT grain, ts, itemId, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume
           FROM observations ${where} ORDER BY grain, ts, itemId`).all(...args);
      const fixture = { schema: 'coffer-archive-fixture/1', fields: RAW_FIELDS, observations };
      if (path) fs.writeFileSync(path, JSON.stringify(fixture, null, 2));
      return fixture;
    },

    /* pruneBefore(ts): the shipped-but-unused `--prune-before` utility. Deletes observations +
       bucket + seed rows strictly older than `ts` (unix seconds). Returns per-table deleted counts.
       The archive is append-forever by policy — this exists as a manual escape hatch, NOT a default
       path, and nothing calls it.

       GROWTH, MEASURED 2026-07-28 (the old "~30–35GB/yr, Ben-approved" figure was an estimate and
       overstated the real rate by 4–8x; corrected here so a future prune decision starts from facts):
         · on-disk cost   45.4 bytes/row, including indexes + the buckets table
                          (340MB / 7.84M rows on a 60d /1h + 19d /5m archive)
         · /1h            ~2,982 rows/bucket × 24/day  =  72k rows/day = 3.1 MB/day = 1.1 GB/yr
         · /5m            ~1,580 rows/bucket × 288/day = 455k rows/day = 19.7 MB/day = 7.0 GB/yr @100%
         · TOTAL          4.0 GB/yr at OBSERVED coverage · 8.1 GB/yr at 100% coverage
       /5m is ~86% of the growth (288 buckets/day vs 24), so it is the only grain worth pruning if
       this ever matters. It does not currently matter: at 4–8 GB/yr a desktop absorbs this for years.

       BEFORE PRUNING ANY /5m HISTORY, note it IS read — this is not a write-only grain. Beyond
       loadBands' trailing 2h window, three surfaces read historical 5m via `seriesFor(id,'5m')`:
       `analyze-fill-placement.mjs` (per-lot placement windows, AC1/AC2), `quote-items.mjs`, and
       `read-window-range.mjs`. A retention cut would silently degrade those, so it needs a stated
       horizon per consumer, not a blanket date. */
    pruneBefore(ts) {
      const t = Number(ts);
      const obs = db.prepare('DELETE FROM observations WHERE ts < ?').run(t);
      const buk = db.prepare('DELETE FROM buckets WHERE ts < ?').run(t);
      const seed = db.prepare('DELETE FROM daily_seed WHERE ts < ?').run(t);
      return { observations: Number(obs.changes || 0), buckets: Number(buk.changes || 0), daily_seed: Number(seed.changes || 0) };
    },

    // --- daily-regime-proxy helpers (loadDaily backing; keep observations raw-only, invariant 3) ---
    _metaGet(key) { const r = db.prepare('SELECT val FROM meta WHERE key = ?').get(key); return r ? r.val : null; },
    _metaSet(key, val) { db.prepare('INSERT OR REPLACE INTO meta (key, val) VALUES (?, ?)').run(key, String(val)); },
    /* Seed the derived pre-D0 regime mids ONCE from .cache/daily/*.json (`{window:{id:mid}}`). */
    seedDailyFromCache(dailyDir) {
      if (this._metaGet('daily_seeded')) return { seeded: 0, alreadyDone: true };
      let files = []; try { files = fs.readdirSync(dailyDir); } catch { this._metaSet('daily_seeded', 1); return { seeded: 0, noDir: true }; }
      const ins = db.prepare('INSERT OR IGNORE INTO daily_seed (ts, itemId, mid) VALUES (?, ?, ?)');
      let seeded = 0;
      db.exec('BEGIN');
      try {
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          let obj = {}; try { obj = JSON.parse(fs.readFileSync(pathMod.join(dailyDir, f), 'utf8')); } catch { continue; }
          for (const w in obj) { const snap = obj[w]; if (!snap) continue; for (const id in snap) { const m = snap[id]; if (m != null) seeded += Number(ins.run(Number(w), Number(id), m).changes || 0); } }
        }
        this._metaSet('daily_seeded', 1);
        db.exec('COMMIT');
      } catch (err) { try { db.exec('ROLLBACK'); } catch {} throw err; }
      return { seeded, alreadyDone: false };
    },
    /* Does window `w` have ANY daily data (raw 1h obs OR seed mids)? Used for check-before-fetch. */
    hasDailyWindow(w) {
      const t = Number(w);
      if (this.hasBucket('1h', t)) return true;
      return !!db.prepare('SELECT 1 FROM daily_seed WHERE ts = ? LIMIT 1').get(t);
    },
    /* dailyMidsAt(w) → { [id]: mid } for one window: raw 1h observations (mid1h-derived, authoritative)
       UNIONed with seed mids for ids the raw rows don't cover. Byte-identical mid to the pre-D0 cache
       because mid1h is the same reduction over the same raw inputs. */
    dailyMidsAt(w) {
      const t = Number(w), out = {};
      const seed = db.prepare('SELECT itemId, mid FROM daily_seed WHERE ts = ?').all(t);
      for (const r of seed) if (r.mid != null) out[r.itemId] = r.mid;
      const raw = db.prepare('SELECT itemId, avgLowPrice, avgHighPrice FROM observations WHERE grain = ? AND ts = ?').all('1h', t);
      for (const r of raw) { const m = mid1h(r); if (m != null) out[r.itemId] = m; }   // raw overrides seed
      return out;
    },

    // test/inspection helpers (not part of the surfacing contract)
    observationCount() { return Number(db.prepare('SELECT COUNT(*) AS n FROM observations').get().n); },
    bucketCount(grain) {
      return grain
        ? Number(db.prepare('SELECT COUNT(*) AS n FROM buckets WHERE grain = ?').get(String(grain)).n)
        : Number(db.prepare('SELECT COUNT(*) AS n FROM buckets').get().n);
    },
    /* newestBucket(grain) → the max ts (unix seconds) stored for that grain, or null if none.
       The buckets PK is (grain, ts), so SELECT MAX(ts) WHERE grain=? is an index-covered aggregate
       (O(log n), no scan, no new index). READ-ONLY, never touches a write path. Powers the cache-warm
       guard's "how cold is the /1h archive" check (PLAN-DAEMON-SUBSYSTEM Chunk 1a). Degrades honestly:
       .get() on an empty table returns { ts: null }, so a cold/fresh archive yields null, never throws
       — the guard reads "no data yet" as "cold" rather than crashing. */
    newestBucket(grain = '1h') {
      try {
        return db.prepare('SELECT MAX(ts) AS ts FROM buckets WHERE grain = ?').get(String(grain)).ts ?? null;
      } catch { return null; }
    },

    close() { try { db.close(); } catch {} },
  };
  return handle;
}

/* CLI utility path: `node pipeline/lib/archive.mjs --prune-before <unixSeconds|ISO>` (shipped, unused
   by default — invariant is append-forever). Also bare invocation prints row/bucket counts. */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const h = open();
  try {
    const pruneIdx = args.indexOf('--prune-before');
    if (pruneIdx >= 0) {
      const raw = args[pruneIdx + 1];
      const ts = /^\d+$/.test(raw || '') ? Number(raw) : Math.floor(Date.parse(raw) / 1000);
      if (!Number.isFinite(ts)) { console.error('usage: --prune-before <unixSeconds|ISO-date>'); process.exit(2); }
      const r = h.pruneBefore(ts);
      console.log(`pruned before ${ts}: ${r.observations} observations, ${r.buckets} buckets, ${r.daily_seed} seed rows`);
    } else {
      console.log(`archive @ ${h.path}\n  observations: ${h.observationCount()}\n  buckets: 1h=${h.bucketCount('1h')} 5m=${h.bucketCount('5m')}`);
    }
  } finally { h.close(); }
}
