/**
 * cache-warm.mjs — the cache-warm GUARD daemon (PLAN-DAEMON-SUBSYSTEM Phase-1 Chunk 4).
 *
 * THE JOB: keep the Tier-1 SQLite market archive's /1h grain FULL so PLAN-LANE-ADMISSION Path-A's
 * intraday-range margin doesn't silently degrade. Coverage otherwise only accrues as a side-effect of
 * a manual scan/positions run, so an idle stretch leaves the archive lagging the wiki. This guard is
 * the forward-looking fix: a CHEAP check (how old is the newest /1h bucket?) runs often, and the
 * EXPENSIVE backfill runs only when the archive has fallen behind.
 *
 * ── WHAT A GAP ACTUALLY COSTS (corrected 2026-07-27 — the original premise here was WRONG) ──
 * This header used to claim "the wiki only serves ~30h/item live, so a bucket that ages out of the
 * rolling-24h window can never be back-filled", and WARM_THRESHOLD_HOURS was set to 23 on that basis.
 * Both halves were false, measured against the live API:
 *   • bulk /1h?timestamp=<w> serves real, distinct whole-market buckets at least 365 DAYS back
 *     (probed at 2025-07-28: id 560 hi=144, highPriceVolume=2.11m) — not ~30h.
 *   • per-item /timeseries?timestep=1h returns 365 points ≈ 364h of history — also not ~30h.
 * So a hole is NOT permanent data loss; it is repairable at any depth by re-requesting the bucket.
 * What actually bites is that no ROUTINE path ever re-requests an old one: loadAll24hRolling's walk
 * is capped at the trailing 24 windows, and loadDaily only fills a 6-HOURLY grid (stepHours=6) — which
 * is exactly why the archive shows a 1-bucket-in-6 sawtooth older than a day. Repairing existing holes
 * is therefore a deliberate, separate job: `pipeline/commands/backfill-archive.mjs`.
 * The live cost of a gap is the READ-side deflation in between: a surface that composes trailing-24h
 * volume straight off the archive without triggering a backfill (loadDailyRangeBulk is zero-fetch by
 * contract) sees only the buckets actually stored, understating volume roughly in proportion.
 *
 * ── THE SAFETY INVARIANT (zero-git by construction — non-negotiable) ──────────────────────────────
 * This daemon does READ + FETCH-INTO-LOCAL-ARCHIVE only. It MUST NEVER import sync-fills.mjs or do
 * any git work. Its only side effects are: (1) loadAll24hRolling()/loadBands() appending raw buckets
 * into the local .sqlite archive + writing .cache/*.json (all zero-git, check-before-fetch), and
 * (2) stamping this daemon's lastRan into pipeline/.cache/daemon-state.json. That is why the registry
 * marks it `local:true` and the manager is allowed to auto-run it. Keep it that way.
 *
 * ── SHAPE the registry expects (registry.mjs dynamic-imports this module) ──
 * The registry entry's healthCheck()/start() delegate to `mod.healthCheck()` / `mod.start()` — so
 * this module MUST export exactly those two named functions, each callable with NO arguments (their
 * defaults wire to the real archive + real backfills). Both are wrapped so they NEVER throw to the
 * caller (the manager's defensive contract).
 *
 * ── INJECTABLE for hermetic tests ──
 * start()'s real backfills touch the network. So both are OPTIONAL params defaulting to the real
 * loadAll24hRolling / loadBands; a test passes spies/counters to stay offline. healthCheck() likewise
 * takes an optional archive `db` handle (forwarded to newest1hAgeHours) so a test can point it at a
 * synthetic :memory: archive with a controlled newest-bucket ts. Production defaults stay wired to the
 * real functions — no behavior change when called arg-free by the registry.
 *
 * Node-only, no APP_VERSION bump.
 */
import { pathToFileURL } from 'node:url';
import { newest1hAgeHours, loadAll24hRolling as realLoadAll24hRolling, loadBands as realLoadBands }
  from '../lib/market/marketfetch.mjs';
import { loadState, saveState, STATE_PATH } from './manager.mjs';   // reuse Chunk 2/3's heartbeat helpers

// This daemon's stable id — MUST match the registry entry's `name` (the daemon-state.json key).
const DAEMON_NAME = 'cache-warm';

/**
 * WARM_THRESHOLD_HOURS — warm when the newest /1h bucket is older than this.
 *
 * 3h, chosen to KEEP PACE WITH THE TICK (was 23h; retuned 2026-07-27 after an audit found the archive
 * sitting 12.6h behind the wiki with the guard still reporting "fresh", trailing-24h coverage 13/24).
 *
 * WHY THE OLD 23h COULD NOT WORK. The Task Scheduler job (run-cache-warm.cmd, "TheCofferCacheWarm")
 * ticks every 4h. Pairing a 23h threshold with a 4h tick leaves ~1h of margin against the 24h cap on
 * loadAll24hRolling's backfill walk, so the arithmetic loses: a check landing at 22.9h skips, and the
 * NEXT one is 4h later at 26.9h — by which point the hours between 24h and 26.9h have fallen outside
 * the walk and no routine path fetches them again. It also meant the guard did nothing for a 22h lag,
 * which is the read-side deflation described in the header. A threshold must be < the tick interval to
 * bound the lag at all; 3h keeps worst-case lag at roughly tick + threshold ≈ 7h and always leaves the
 * whole trailing-24h window inside the walk's reach.
 *
 * STILL A JUDGMENT NUMBER, not a measured optimum (Rule 4). It is bounded above by the 4h tick and
 * below by fetch cost: each warm that fires re-walks up to 24 bulk windows at ~70ms apart, so driving
 * it toward 0 buys fresher data at the cost of near-continuous refetching. What would VALIDATE it:
 * observed lag distribution per tick, and whether any read surface actually moved a decision on a
 * <3h-stale archive. Re-tune if the tick interval changes — the two are coupled, not independent.
 *
 * @provisional-api: PLAN-DAEMON-SUBSYSTEM Chunk 4 threshold; the opportunistic ensure() hook (Chunk 5)
 * is the workflow consumer once it lands. Used internally by healthCheck() today.
 */
export const WARM_THRESHOLD_HOURS = 3;

/**
 * healthCheck({ now, db, ageHours }) → { ok, detail, lastRan? }
 *
 * Reads the newest /1h bucket age (opens + closes its OWN archive handle via newest1hAgeHours) and
 * classifies:
 *   - COLD archive (newest1hAgeHours returns null — no /1h data yet, e.g. a fresh clone / :memory: CI):
 *     treat "no data yet" as "needs warming" → ok:false. Never a crash.
 *   - age > WARM_THRESHOLD_HOURS → ok:false (about to lose a bucket; warm).
 *   - else → ok:true (fresh).
 * Never throws: any unexpected error is caught and reported as ok:false (needs-warming), consistent
 * with "cold reads as stale" — the fail-safe direction for a zero-git guard is to warm, never to skip.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.now]       injectable clock (ms) for tests
 * @param {object}   [opts.db]        an already-open archive handle to reuse (tests pass a temp :memory: one)
 * @param {Function} [opts.ageHours]  injectable age probe (default newest1hAgeHours) — tests may stub it
 */
export function healthCheck({ now = Date.now(), db, ageHours = newest1hAgeHours } = {}) {
  try {
    const age = ageHours({ db, now });                 // hours since newest /1h bucket, or null if cold
    if (age == null) {
      return { ok: false, detail: 'archive COLD — no /1h buckets yet; needs warming', lastRan: null };
    }
    if (age > WARM_THRESHOLD_HOURS) {
      return { ok: false, detail: `newest /1h bucket ${age.toFixed(1)}h old (> ${WARM_THRESHOLD_HOURS}h threshold) — needs warming`, lastRan: null };
    }
    return { ok: true, detail: `newest /1h bucket ${age.toFixed(1)}h old (≤ ${WARM_THRESHOLD_HOURS}h) — fresh` };
  } catch (e) {
    // Never crash the caller; fail toward "needs warming" (a zero-git warm is always safe).
    return { ok: false, detail: `healthCheck error (${(e && e.message) || e}) — treating as cold/needs-warming`, lastRan: null };
  }
}

/**
 * start({ now, statePath, warm24h, warmBands }) → { ok, detail, lastRan? }
 *
 * Runs the two zero-git, check-before-fetch backfills, then stamps daemon-state.json's lastRan for
 * this daemon (reusing manager.mjs's loadState/saveState — one keyed map, not a second writer).
 * IDEMPOTENT and safe to call from multiple trigger paths in the same minute: the backfills only fetch
 * the buckets the archive lacks, and the manager's MIN_CHECK_INTERVAL_MS throttle is the de-dupe
 * (deliberately NO second lock file). Never throws — a warm failure is reported as ok:false, not raised.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.now]        injectable clock (ms) for tests
 * @param {string}   [opts.statePath]  heartbeat file (default manager.STATE_PATH)
 * @param {Function} [opts.warm24h]    injectable — default the real loadAll24hRolling (network)
 * @param {Function} [opts.warmBands]  injectable — default the real loadBands (network)
 *
 * @provisional-api: PLAN-DAEMON-SUBSYSTEM Chunk 4 guard entry; the opportunistic ensure() hook
 * (Chunk 5) + the Task Scheduler tick (Chunk 6) are the workflow consumers. Invoked today via the
 * registry's dynamic import and this module's CLI.
 */
export async function start({
  now = Date.now(),
  statePath = STATE_PATH,
  warm24h = realLoadAll24hRolling,
  warmBands = realLoadBands,
} = {}) {
  try {
    await warm24h();                 // backfill missing /1h buckets (zero-git, check-before-fetch)
    await warmBands();               // backfill missing /5m band buckets (zero-git, check-before-fetch)

    // Stamp the heartbeat so status()/the throttle see a fresh lastRan (read-modify-write the one map).
    const iso = new Date(now).toISOString();
    const state = loadState(statePath);
    const prev = state[DAEMON_NAME] || {};
    state[DAEMON_NAME] = { ...prev, lastRan: iso, ok: true, detail: 'warmed /1h + bands' };
    saveState(statePath, state);

    return { ok: true, detail: 'warmed loadAll24hRolling + loadBands', lastRan: iso };
  } catch (e) {
    return { ok: false, detail: `warm failed (${(e && e.message) || e})` };
  }
}

// ── CLI (Windows Task Scheduler target — Chunk 6) ────────────────────────────────────────────────
//   node pipeline/daemons/cache-warm.mjs --check-only   → report health, warm NOTHING (exit 0)
//   node pipeline/daemons/cache-warm.mjs [--warm]        → ensure-then-warm (check; if stale, warm)
// The bare/--warm path routes through the manager's ensure() over a ONE-entry registry built from this
// module's own healthCheck/start, so it inherits the SAFETY INVARIANT + the MIN_CHECK_INTERVAL_MS
// throttle (the de-dupe when a Task Scheduler tick and an opportunistic hook fire near-simultaneously)
// for free — no bespoke throttle logic here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check-only');
  const h = healthCheck();
  console.log(`[cache-warm] health: ok=${h.ok} — ${h.detail}`);
  if (checkOnly) {
    process.exit(0);
  } else {
    const { ensure } = await import('./manager.mjs');
    const actions = await ensure({
      registry: [{ name: DAEMON_NAME, kind: 'guard', local: true, healthCheck, start }],
    });
    for (const a of actions) console.log(`[cache-warm] ${a.action}: ${a.detail}`);
    process.exit(0);
  }
}
