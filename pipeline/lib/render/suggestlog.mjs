/* suggestlog.mjs — the append-only SUGGESTIONS LEDGER.
 *
 * Every recommendation the analysis scripts emit — quote-items.mjs (per-item + --positions),
 * screen-flip-niches.mjs (each rated niche row), watch-positions.mjs (each held/target read) — is
 * logged HERE at emit time, unconditionally, one JSON object per line, to repo-root
 * suggestions.jsonl. This is the "what the tool SAID" half of the outcomes dataset;
 * join-outcomes.mjs joins it to "what actually FILLED" (fills.json). TRACKED in git (append-only;
 * ids / prices / timestamps only — NO PII, the repo is public); sync-fills.mjs commits it when present.
 *
 * LEAN-INCLUDED is the convention for every `?` field: written only when the caller supplies it, so
 * a row that doesn't carry one is byte-identical to a row from before the field existed. Absence
 * therefore never means "measured and empty" — see DATA CAVEATS.
 *
 * Prices are whatever the computeQuote row held (may be null) — a number is never fabricated.
 *
 * PER-ITEM ROW CORE (present on every row emitted for an item; see the AGGREGATE ROWS section for
 * the one row class that carries almost none of this)
 *   ts        unix SECONDS at emit time
 *   script    'quote' | 'screen' | 'watch'
 *   mode      the niche/mode as computed then (screen niche name, or null)
 *   params    the run's params object (screen flags, positions:true, …) or null
 *   itemId    the item; the joiners' key
 *   class     item-type / liquidity label AS COMPUTED THEN. Snapshotted because the classification
 *             logic evolves and recomputing it later would rewrite history.
 *   verdict   the emitted action verdict where the script produces one (else null)
 *   quickBuy  the LIVE INSTASELL (what you can buy into right now)
 *   quickSell the LIVE INSTABUY  (what you can sell into right now)
 *   optBuy/optSell   the patient 2h-band pair
 *   mom, regime
 *
 * QUOTED PAIR + RANK  ·  bid?, ask?, pFill?, ttfSec?, rank?, estBasis?, estN? (net × P ÷ TTF components)
 *   guide?            GE guide price at emit — the anchor the in-game −5%/+5% buttons compute off.
 *                     NOT reconstructable later: no archive column, .cache/guide.json is a 10-min
 *                     snapshot, .guide-history.jsonl holds only CHANGES.
 *   volSrc?           'bulk' | 'peritem' | 'rolling' — volume source behind `class`. No consumer
 *                     switches on it (analyze.mjs tests presence only).
 *   volDay?           the RAW limiting-side scalar behind `class`, so `class` is reproducible.
 *   volDayRolling?    TRUE trailing-24h {hpv,lpv} composed from /1h; neither /24h endpoint is a
 *                     trailing source (see marketfetch.mjs loadAll24hRolling). With `rolling` as the
 *                     screen default this DUPLICATES the gating quantity — never read it as an A/B.
 *   depth?            realized 24h book-depth {hpv,lpv} off row.pressure — units traded at each side,
 *                     a FLOW PROXY, not an order book. The live spread is already recoverable as
 *                     quickSell − quickBuy and is deliberately not duplicated.
 *   grade?            the rating LETTER as rendered ('S+'…'D', incl. any thin/sub-floor cap).
 *   cappedBy?         which grade CEILING bound that letter: 'thin' | 'phase-basing' | 'sub-floor' |
 *                     'reach' (last-binder-wins); absent when the raw grade stood.
 *   subFloor?         'min-gpd' | 'liquidity' — surfaced by the empty-result sub-floor fallback.
 *   posture?, tripwire?, fillWindowHrs?, thesis?, validators?, path?
 *
 * ESTIMATOR PAIR — NOT a shadow. `Est. buy`/`Est. sell` are the DEFAULT console column set (they
 * replace Quick+Optimistic on the printed niche tables; `--raw` restores them), and under
 * `--pressure-exit` the console re-sorts on estNet. They stay OUT of screen.json (that publish is
 * refused under `--pressure-exit`), so the app still renders Quick/Optimistic.
 *   estBuy?/estSell?/estConfidence?   reconciliation-estimator pair off estimatePair (strategy-aware
 *                     entry, declared-exit-anchored, reach-folded, BE-floored), plus lean evidence
 *                     { askRecHit?, askRecDays?, askHit?, askDays?, bidRecHit?…, declaredAnchored?,
 *                     beFloored?, doctrine? } — recent-3 AND full-window reach counts, the entry
 *                     doctrine, and the declared/BE flags. PLACEHOLDER model, n≈3–14.
 *
 * ADMISSION PROVENANCE (screen renderMode rows; absent under `--admission legacy` and on quote/watch)
 *   via?              how the row won its fetch slot: 'reserve' (value/gear/mid-tier reserve) |
 *                     'explore' (the rotating exploration lottery); ABSENT = ranked-in/held, the baseline.
 *   preRank?/prePool? 1-based position in the niche's pre-fetch ordering and that pool's size
 *                     ("would have ranked 12th of 178"), stamped by admission.mjs pickFetchPool.
 *                     ⚠ The ORDERING SCORE differs per niche — band/churn: expGpDay × softFactor ×
 *                     trackBoost; value: valueScore; amplitude: ampProxy — so preRank is NOT
 *                     comparable across niches; pooling them is a misread. NOT reconstructable later
 *                     (it depends on that pass's market snapshot).
 *   askPlacement?     the quoted ask's placement percentile (0–1) in the 14-day daily-HIGH
 *                     distribution (stale-live-guarded); also BOUNDS the churn ask-reach exemption.
 *                     null when no daily-high history is in hand.
 *
 * SHADOW FIELDS — PLACEHOLDER, logged for the eventual F1 retro-join. Each is `null`/degraded rather
 * than faked when its read is thin. Per-field scope and sample size are stated individually; do not
 * generalise one field's caveat to the group.
 *   repriced?         dead-bid REPRICED-ENTRY alternative { bid, ask, net, pFill, rank } (entry at the
 *                     live crossable level, sell unchanged). A labeled alternative — the row's
 *                     headline rank/pFill stay the untouched dead-bid numbers. Screen rows only.
 *   exemptionBounded? true when the placement bound dropped a churn row's ask-reach exemption; the
 *                     logged pFill/rank are then the DISCOUNTED numbers and rankPre? is the pre-bound
 *                     rank riding beside it. Screen rows only; PLACEHOLDER bounds n≈0.
 *   depthExit?        held-lot percentile-depth { qty, competition, liqClass, ask?, clearFrac?,
 *                     collapse? }; collapse names the null-read reason ('insufficient-depth' |
 *                     'thin-history' | 'no-prints'). liqClass rides EVERY row so F1 can test whether
 *                     the flat ×4 competition bar systematically nulls one liquidity class.
 *                     watch-positions held rows only.
 *   reachable?        pressure-driven band { ask, bid, pressure, reliability, bandLow, bandHigh } off
 *                     windowread.mjs reachableBand; absent when the pressure read degrades.
 *   windowExit?       big-ticket window-clear ask rung off askExitRead:
 *                     { list, live, peakWindow:[startH,endH],
 *                       hiReach:{reached,n,recentHit,recentDays,placement},
 *                       fiveReach:{reached,n,placement}|null,
 *                       reachMargin:{trend,cushionNow,cushionFrom,cushionTo,reachedRecent,nRecent,
 *                                    pace:{gap,onPace,hour,n}|null}|null }
 *                     — the surfaced level, the diurnal peak window it targets, and the TWO competing
 *                     reach signals (1h daily-HIGH and the less-smoothed 5m grain) side by side.
 *                     fiveReach null when the 5m archive is thin. quote --positions / watch
 *                     big-ticket held rows only.
 *   timedLap?         diurnal timed-lap off diurnalTimedLap: either { degraded:true, reason:
 *                     'thin-history'|'no-window' } or
 *                     { bid, ask, dipWindow:[startH,endH], peakWindow:[startH,endH], net, roi,
 *                       instantNet, instantRoi, holdHrs, clean, lowTrend, hiTrend,
 *                       bidReach/askReach:{fullHit,fullN,recentHit,recentDays,diverges},
 *                       dipPool, peakPool, trancheComfort, trancheCeiling, fitNights,
 *                       peakReality/dipReality:{spikeTop,staleOptimistic,typicalLevel,reachedDays,
 *                                               nDays,recentHit,recentDays,placement}|null,
 *                       bidBasis }
 *                     lowTrend/hiTrend are the trend DIRECTION STRING only — projectTrajectory's full
 *                     detail is deliberately dropped. fitNights = the window the LEVEL fields were
 *                     fitted over (14 on a gate-passer, else the caller's `nights`). bidBasis
 *                     ('patient-dip' | 'live') is REQUIRED to read dipReality against `bid`: on a
 *                     'live' row the dip was repriced to the live instasell, so `bid` is no longer the
 *                     level dipReality describes. n≈0 and NEVER a gate/rank/screen.json input.
 *                     Screen survivors supply it; quote/watch are NOT WIRED to (absence here is
 *                     un-wired, not degraded).
 *   asym?             asymmetric-fill estimate { bid, ask, pAsk, pBid, pAskAt, pBidAt, n, rank } — the
 *                     deep-bid → high-reach-ask pair off asymPair (guarded), its exit/entry reach
 *                     fractions, and the asymmetric rank (net × P_ask ÷ TTF, estimators.mjs
 *                     asymEstimate). pAskAt/pBidAt are the LEVELS pAsk/pBid were measured at, which
 *                     the min/max ordering guards can move bid/ask away from; without them a row's
 *                     (ask, pAsk) pair mixes two levels and guarded rows cannot be told from
 *                     unguarded. The row's plain `rank` stays the SYMMETRIC rank so old-vs-new ride
 *                     the same row for the F1 A/B — graduate the sort flip ONLY if asym.rank predicts
 *                     realized exit-safe edge better. band/scalp screen rows with an in-hand 1h
 *                     series only; PLACEHOLDER quantiles, n≈14.
 *   dipLoop?          flush-SIGNAL components { volDay, price, limit, depthPct, bucketVol, quickBuy,
 *                     optSell, afterTaxMargin, dipScore, alerted, gatedReason }; alerted=true →
 *                     headline FLUSH, false → SIGNAL-ONLY gated out by gatedReason. watch --dip rows
 *                     only; joinable against fills.json via itemId+ts.
 *
 * ADMISSION-EXCLUSION AGGREGATE ROWS. Besides per-item rows, each screen pass appends ONE aggregate
 * line per niche recording the CROWDED-OUT set — every gated candidate that never got a fetch slot
 * (pickFetchPool's `excluded` report, incl. 'total-fetch-max' trims). The WHOLE row is:
 *   { ts, script:'screen', mode, params, prePool, excluded:[{ id, reason, preRank?, expGpDay? }, …] }
 * (shaped by excludedShadow below). These are ADMISSION TELEMETRY, NOT suggestions.
 * ⚠ They carry NO `itemId` KEY AT ALL — the property is absent, not null, and so are `class`,
 * `verdict`, `quickBuy`, `mom` and `regime`. Every joiner (retroJoin, join-outcomes,
 * join-window-clears, report-retro) skips them via a LOOSE `== null` test, and analyze-record.mjs
 * skips them before its noKey health counter so they never read as malformed. A new joiner MUST use
 * `== null` (or an `in` check) — a strict `=== null` will NOT skip these rows. Without them the
 * excluded set is unrecoverable after the pass.
 *
 * ⚠ DATA CAVEATS — properties of suggestions.jsonl AS IT EXISTS ON DISK. Read before any join;
 * these are not fixable by re-running, only by splitting the sample.
 *   · volSrc — the screen hardcoded 'bulk' while actually running rolling until 2026-08-11, so
 *     ~1,940 of the first 2,000 rows are mislabelled at rest. Treat a pre-2026-08-11 screen
 *     'bulk' as UNKNOWN.
 *   · volDay — absent before 2026-08-11 (153 of 17,041 rows carried it when join-outcomes began
 *     preferring it). Those rows are unrepairable: the scalar is not recoverable after the pass.
 *   · timedLap.fitNights — absent before 2026-08-10; those rows are ALL caller-basis. Do not join
 *     level fields across that boundary without splitting on it.
 *   · timedLap.peakReality / dipReality / bidBasis — absent before 2026-08-12. The reality flag was
 *     rendered but never written until then, so the guard is unmeasurable on older rows: absent ≠ clean.
 *   · asym.pAskAt / pBidAt — null on pairs predating the field, so guarded and unguarded rows cannot
 *     be told apart there (guarded ≈ 2 of 7 asym rows measured live).
 *   · grade — absent on all rows before 2026-07-12.
 *   · demandRegime — a REMOVED field. Historical rows still carry it; new rows never emit it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMP_ASK_Q, AMP_BID_Q } from '../../../js/amplitudescreen.mjs';   // F-E — the DEFAULT reach-vs-margin quantiles, so amplitudeShadow can lean-log askQ/bidQ only when an experiment run overrode them (one-home, no forked 0.5 literal)

const HERE = path.dirname(fileURLToPath(import.meta.url));
// HERE is pipeline/lib/render/ (PLAN-LIB-SUBDIRS chunk 1 nested it one deeper), so repo root is THREE
// levels up. A single '..' here silently forked the ledger into untracked pipeline/suggestions.jsonl for
// half a day (2026-07-05) — suggestlog.test.mjs pins the resolved path to the repo root, and caught this
// same class again when the render/ move added a level. Re-count these on any future move of this file.
export const LEDGER = path.join(HERE, '..', '..', '..', 'suggestions.jsonl');

// SR1 — rotation/compaction. The active LEDGER lives in the DEPLOY ROOT and grows unbounded
// (~3k rows/day ≈ >1MB/day). To keep the root file bounded to the CURRENT calendar month while
// never dropping a row (rows are F1's calibration data — ARCHIVE, never delete), completed months
// are moved OUT of the root into monthly archive files `suggestions-YYYY-MM.jsonl` under a GITIGNORED
// `pipeline/suggestions-archive/` dir — out of the deploy root and, since 2026-08-07, NOT committed by
// sync-fills (local-only history; the rolled months have no repo backup). The
// resolved ACTIVE path above stays pinned by suggestlog.test.mjs — only history relocates.
export const ARCHIVE_DIR = path.join(HERE, '..', '..', 'suggestions-archive');   // pipeline/suggestions-archive (TWO up from lib/render/)

// UTC month key (YYYY-MM) for a unix-SECONDS ts. Archive naming is a STORAGE/wire concern, so it
// uses UTC (consistent with the CLAUDE.md time-convention: ISO/UTC is storage, local getters are
// display). The current-month boundary uses the same UTC basis so the two never disagree.
function monthKey(tsSec) {
  const d = new Date(tsSec * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
export function currentMonthKey(now = Date.now()) { return monthKey(Math.floor(now / 1000)); }

// Cheap guard: read only the FIRST line (oldest row — the ledger is appended in ts order) and
// return its month, without slurping a month-sized file on every append. Returns null if the file
// is missing/empty/unparseable (→ caller skips rotation, appends normally).
function firstLineMonth() {
  let fd;
  try {
    fd = fs.openSync(LEDGER, 'r');
    const buf = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.toString('utf8', 0, bytes);
    const nl = s.indexOf('\n');
    const line = (nl >= 0 ? s.slice(0, nl) : s).trim();
    if (!line) return null;
    const ts = JSON.parse(line).ts;
    return ts == null ? null : monthKey(ts);
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// Move every row OLDER than the current month out of the active LEDGER into its monthly archive.
// SAFETY (no row loss): each archive is written FULLY (existing ∪ new, deduped by exact line, via
// tmp+rename) BEFORE the active file is rewritten to drop the moved rows — so a crash mid-rotation
// leaves the rows still in the active file and a re-run re-archives them idempotently (dedup means
// no duplicates). Unparseable / ts-less lines are KEPT in the active file, never discarded. Handles
// multiple accumulated prior months in one pass. Returns { rotated, months } for reporting.
export function rotateLedger(now = Date.now(), { ledger = LEDGER, archiveDir = ARCHIVE_DIR } = {}) {
  if (!fs.existsSync(ledger)) return { rotated: 0, months: [] };
  const cur = currentMonthKey(now);
  const lines = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const keep = [];
  const byMonth = new Map();
  for (const line of lines) {
    let ts = null;
    try { ts = JSON.parse(line).ts; } catch { keep.push(line); continue; }  // keep unparseable in place
    const mk = (ts == null) ? cur : monthKey(ts);
    if (mk >= cur) keep.push(line);                                          // current (or defensive future) stays active
    else (byMonth.get(mk) || byMonth.set(mk, []).get(mk)).push(line);
  }
  if (byMonth.size === 0) return { rotated: 0, months: [] };
  fs.mkdirSync(archiveDir, { recursive: true });
  let rotated = 0;
  for (const [mk, mlines] of byMonth) {
    const file = path.join(archiveDir, `suggestions-${mk}.jsonl`);
    const existing = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim()) : [];
    const seen = new Set(existing);
    const merged = existing.slice();
    for (const l of mlines) if (!seen.has(l)) { merged.push(l); seen.add(l); rotated++; }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, merged.join('\n') + '\n');
    fs.renameSync(tmp, file);                                               // archive committed before active shrinks
  }
  const tmpA = ledger + '.tmp';
  fs.writeFileSync(tmpA, keep.length ? keep.join('\n') + '\n' : '');
  fs.renameSync(tmpA, ledger);
  return { rotated, months: [...byMonth.keys()] };
}

// Read EVERY suggestion line across the active ledger + all monthly archives, oldest-file first
// (active last = newest). Rotation splits the O1 dataset across files, so any reader that needs the
// FULL history (join-outcomes.mjs's F1 calibration join) MUST read through here, not the active file
// alone — reading LEDGER directly would silently halve the calibration set after the first rotation.
export function readSuggestionLines({ ledger = LEDGER, archiveDir = ARCHIVE_DIR } = {}) {
  const files = [];
  if (fs.existsSync(archiveDir)) {
    for (const f of fs.readdirSync(archiveDir)) {
      if (/^suggestions-\d{4}-\d{2}\.jsonl$/.test(f)) files.push(path.join(archiveDir, f));
    }
    files.sort();                                                          // YYYY-MM sorts chronologically
  }
  files.push(ledger);                                                      // active month last
  const out = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) if (line.trim()) out.push(line);
  }
  return out;
}

// Coarse liquidity class from the limiting-side daily volume — a stable, script-independent
// vocabulary so quote-items.mjs / screen-flip-niches.mjs rows share one `class`. Thresholds mirror CLAUDE.md's
// two-sided practical floor (~100/d) and a rough liquid cutoff. watch-positions.mjs instead passes its
// richer classify() taxonomy label (FALLING / THIN_BIG_TICKET_VOLATILE / …) — that IS "the label
// as computed then" for that script.
// liqClassOf(volDay) is the raw-number core; liqClass(row) is the row convenience wrapper. ONE threshold
// set (X1 dedup — was copied as liqClassOf in join-outcomes.mjs).
// join-outcomes.mjs resolves a campaign's class through liquidityAtPlacement() below (2026-08-11) — it
// prefers what was MEASURED at placement over a present-day recompute. It still keeps the present-day
// read as `volDayCurrent`/`liqClassCurrent` so the two bases stay comparable.
// NY2.4: this 'thin' (volDay < 100) is DISTINCT from the screen's grade-capping `thin` (gp-flow-only
// admission, limitVol < FLOOR = 3500). ⚠ A [50,100)/day item IS gp-flow-thin under the live FLOOR, so
// the cap applies — an earlier note argued the reverse from the stale FLOOR=50 and treated a
// `class:'thin' + S+` row as expected. It is a real anomaly. Same fix in rating.mjs THIN_GRADE_CAP.
export function liqClassOf(volDay) {
  if (volDay == null) return 'unknown';
  if (volDay < 100) return 'thin';
  if (volDay < 1000) return 'mid';
  return 'liquid';
}
export function liqClass(row) { return liqClassOf(row && row.volDay); }

// The liqClassOf vocabulary. Load-bearing: `class` in suggestions.jsonl is NOT single-vocabulary —
// watch-positions.mjs logs its richer classify() taxonomy (FALLING / STABLE_LIQUID / …) into the SAME
// field (see the note above liqClassOf). Bucket `class` into thin/mid/liquid columns WITHOUT filtering on
// this set and those rows match no column and vanish silently — 102 of 459 joinable campaigns, 2026-08-11.
export const LIQ_CLASSES = new Set(['thin', 'mid', 'liquid', 'unknown']);

// Point-in-time liquidity for a reconstructed campaign (2026-08-11). Bucketing a HISTORICAL fill by
// TODAY's volume asks the wrong question — an item thin at placement and liquid now lands in `liquid`,
// and its slow fill then reads as evidence that liquid items fill slowly. Basis, best first:
//   'logged-volday'  the scalar logged at emit — exact + reproducible. Rows since 2026-08-11 only.
//   'logged-class'   the coarse bucket logged at emit — point-in-time, not reproducible, vocabulary-gated.
//   'current'        today's recompute. Wrong in principle, kept so a row is never DROPPED.
// `basis` rides the row so F1 can segment on it. Pure — no fetch, no clock.
export function liquidityAtPlacement(sug, volDayCurrent) {
  if (sug && sug.volDay != null)
    return { cls: liqClassOf(sug.volDay), basis: 'logged-volday', volDay: sug.volDay };
  if (sug && LIQ_CLASSES.has(sug.class))
    return { cls: sug.class, basis: 'logged-class', volDay: null };
  return { cls: liqClassOf(volDayCurrent), basis: 'current', volDay: null };
}

// SF-3 — decide the logged liquidity `class` AND its volume SOURCE, deterministically and WITHOUT any
// fetch. Problem: quote-items.mjs's per-item /24h and screen-flip-niches.mjs's bulk /24h are different snapshots, so the
// same item could log a different `class` across scripts (the `volDay` itself is polluted; re-deriving
// from the stored volDay doesn't launder it). Fix: when a WARM bulk /24h map is in hand (the caller
// passes marketfetch.loadAll24hWarm() — null when cold), take the item's volume from the SAME bulk
// endpoint screen uses → the classes CONVERGE, tagged volSrc:'bulk'. When cold, keep the per-item
// row.volDay and tag volSrc:'peritem' (the honesty label F1 can bucket/normalize on). This is PURE —
// it fetches nothing; the warm map is whatever the caller already had (the hard no-cold-fetch constraint
// lives at the loadAll24hWarm accessor). This function's 'bulk' tag is CORRECT — it genuinely reads the
// raw all24h.json warm map. (screen-flip-niches.mjs passes VOL_SRC_LABEL, 'rolling' by default.)
// ⚠ OPEN, NOT FIXED: a quote row's `class` therefore comes from the BULK (older) UTC day while the same
// row's `volDay` comes from the rolling composition — two sources on one row, disagreeing on 390 of
// 3,581 items (10.9%). Needs a decision on which source `class` should follow.
export function classAndSource(row, id, warmBulk) {
  const be = warmBulk ? (warmBulk[id] || warmBulk[String(id)]) : null;
  // Returns `volDay` too so the caller can log the scalar the class came from (the number, not a
  // second derived bucket) — without it a class is not reproducible and a source split is invisible.
  if (be) {
    const volDay = Math.min(be.highPriceVolume || 0, be.lowPriceVolume || 0);   // same min(hpv,lpv) basis as computeQuote
    return { cls: liqClassOf(volDay), volSrc: 'bulk', volDay };
  }
  return { cls: liqClass(row), volSrc: 'peritem', volDay: row && row.volDay != null ? row.volDay : null };
}

// --- reachability head-to-head ledger-shadow reshapers (RC-S1/RC-S2, PLAN-REACHABILITY-CONSOLIDATION) --
// ONE home for the `reachable`/`depthExit` shadow-field SHAPE so the watch/screen/quote co-logs can't
// drift (the five-way exit-estimator head-to-head scores these against the realized sell). Each takes a
// RAW js/windowread result and returns the lean ledger object, or null when there is nothing to log.
export function reachableShadow(rb) {
  if (!rb || rb.ask == null) return null;
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  return { ask: rb.ask, bid: rb.bid, pressure: r2(rb.pressure), reliability: r2(rb.reliability), bandLow: rb.bandLow, bandHigh: rb.bandHigh };
}
// depthExit ALWAYS carries the booked ask OR the collapse REASON + the liquidity class (so F1 can
// measure whether the flat ×4 competition bar systematically nulls a class we'd want to price).
export function depthExitShadow(ca, { qty, volDay } = {}) {
  if (!ca) return null;
  const o = { qty, competition: ca.competition, liqClass: liqClassOf(volDay) };
  if (ca.price != null) { o.ask = ca.price; o.clearFrac = Math.round(ca.clearFrac * 100) / 100; }
  else o.collapse = ca.reason;
  return o;
}
// A5 (PLAN-AMPLITUDE-SCAN §4/§A5) — the amplitude lane shadow block: the printed daily trough-bid /
// peak-ask levels, the both-leg RECENT-3 daily reach (DESCRIPTIVE — NOT the viability read it was once
// called; at default quantiles that test reduces to a staleness check), the walkForward round-trip (the
// number that actually drives P(fill) since DT1b), the hold
// horizon, and the diurnal dip/peak windows. join-amplitude-outcomes.mjs replays each pick against the
// NEXT holdDays of the 1h archive to measure the would-have-fill rate as an UPPER BOUND (a printed level
// ≠ your fill). Null when the amplitude read degraded. Takes a js/amplitudescreen.mjs amplitudeRanges
// result + { holdDays, profile } (an hourProfile, optional — for the dip/peak windows).
// PLAN-OSCILLATION-CYCLE Chunk 2 — `drift` is the drift-adjusted margin block (js/amplitudescreen.mjs
// amplitudeDriftMargin): { driftAdjustedPeak, margin, requiredMargin, ceilingSlope, floorSlope, … }, logged
// ALONGSIDE the naive ampBid/ampAsk so a later review can compare the naive netPerCycle against the
// drift-adjusted margin WITHOUT re-running the projection. INFORM-ONLY: computed, never gated (Chunk 3 gates).
// YS2 lean-field: present only when the exit projection produced a number; historical rows keep their shape.
// PLAN-OSCILLATION-CYCLE F-E — the effective reach-vs-margin quantiles (ar.askQ/ar.bidQ) are logged as
// `askQ`/`bidQ` ONLY when an experiment run overrode the default board (≠ AMP_ASK_Q/AMP_BID_Q). This is
// LOAD-BEARING: without it a non-default `--amp-ask-q` run would be indistinguishable in the ledger from a
// default one, silently corrupting F-G's "which quantile nets more" retro. A default run stays byte-identical.
// DT1 (2026-08-09): `holdDays` default 1 → 4, tracking AMP_HOLD_DAYS_DEFAULT (the caller passes it
// explicitly, so this is a fallback only — but a stale 1 here would be a second, wrong home for the
// number). The `cycle` block below logs the in-sample ordered completion (kept for continuity with rows
// logged between DT1 and DT1b — it is CIRCULAR and no longer shown or ranked on), and `walkForward` logs
// the out-of-sample rate that actually drives P(fill) since DT1b, so the retro can score the re-horizoned
// premise against the number the board was really using. Both are logged; only `walkForward` is honest.
export function amplitudeShadow(ar, { holdDays = 4, profile = null, drift = null, walkForward = null } = {}) {
  if (!ar || !ar.hasData || ar.ampBid == null || ar.ampAsk == null) return null;
  const o = {
    ampBid: ar.ampBid, ampAsk: ar.ampAsk, holdDays,
    bidTouchRecent: ar.bidTouch.recentHit, bidTouchDays: ar.bidTouch.recentDays,
    askReachRecent: ar.askReach.recentHit, askReachDays: ar.askReach.recentDays,
    nDays: ar.nDays,
    cycle: ar.cycle ? {
      entries: ar.cycle.entries, judged: ar.cycle.judged,
      completed: ar.cycle.completed, pending: ar.cycle.pending,
      frac: ar.cycle.frac == null ? null : Math.round(ar.cycle.frac * 10000) / 10000,
    } : null,
    walkForward: walkForward ? {
      origins: walkForward.origins, entries: walkForward.entries, judged: walkForward.judged,
      completed: walkForward.completed, pending: walkForward.pending,
      frac: walkForward.frac == null ? null : Math.round(walkForward.frac * 10000) / 10000,
      horizonDays: walkForward.horizonDays,
    } : null,
    medAmpPct: ar.medAmpPct == null ? null : Math.round(ar.medAmpPct * 10000) / 10000,
  };
  if (profile && profile.dip && profile.peak) {
    o.dipWindow = [profile.dip.startH, profile.dip.endH];
    o.peakWindow = [profile.peak.startH, profile.peak.endH];
  }
  if (drift) o.drift = drift;
  if (ar.askQ != null && ar.askQ !== AMP_ASK_Q) o.askQ = ar.askQ;
  if (ar.bidQ != null && ar.bidQ !== AMP_BID_Q) o.bidQ = ar.bidQ;
  return o;
}

// EF-0a — the admission-exclusion aggregate reshaper: pickFetchPool's `excluded` candidates → the lean
// per-pass `excluded` ledger array (see the header's ADMISSION-EXCLUSION AGGREGATE ROWS block). Per
// item: id + the SC1 exclusion reason, plus (lean) the pre-fetch position stamp and the rounded
// expGpDay ordering input where the candidate carried them (value/amplitude candidates have no
// expGpDay — the field is simply absent there). Null when there is nothing excluded (legacy
// admission, or every candidate fetched) → the caller logs no line at all.
export function excludedShadow(excluded) {
  if (!Array.isArray(excluded) || !excluded.length) return null;
  return excluded.map(c => {
    const o = { id: c.id, reason: c.reason ?? null };
    if (c.preRank != null) o.preRank = c.preRank;
    if (c.expGpDay != null) o.expGpDay = Math.round(c.expGpDay);
    return o;
  });
}

// the fixed-quantile asym pair (js/estimators.mjs asymEstimate result) → the lean `asym` shadow field;
// the same shape screen/quote/watch all log for the head-to-head. Null when there is no pair.
export function asymShadow(ae) {
  if (!ae || ae.ask == null) return null;
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  // pAskAt/pBidAt ride along so the join can separate GUARDED rows (bid/ask moved off the measured
  // level by asymEstimate's min/max ordering guards) from unguarded ones. Without them the pair
  // (ask, pAsk) mixes two levels with no way to recover which — see asymEstimate (2026-08-12).
  return { bid: ae.bid, ask: ae.ask, pAsk: r2(ae.pAsk), pBid: r2(ae.pBid),
    pAskAt: ae.pAskAt ?? null, pBidAt: ae.pBidAt ?? null,
    n: ae.nDays, rank: ae.rank == null ? null : Math.round(ae.rank) };
}

// WC1 (PLAN-WINDOW-CLEAR-OUTCOMES) — the window-clear ask-rung FORWARD record. A big-ticket held lot is
// exited with a resting ask priced to catch a DIURNAL PEAK window; this captures, at the moment that rung
// is surfaced, the surfaced list level + the live instabuy anchor + the peak window it targets, PLUS the
// two competing reachability signals SIDE-BY-SIDE for that level: daily-HIGH (1h avgHigh) reach and the
// less-smoothed 5m-grain reach, each with its placement. WC2 later joins this forward record against
// fills.json to answer "for a resting ask into a peak window, is daily-high or 5m-grain reach the better
// fill predictor?" — a question that today has NO dataset (the rendered ↗ windowExit note is discarded).
// Takes a js/windowread.mjs askExitRead result (aer) + the surface context; null when there is no scored
// ask read (list null / no window highs — nothing to log). HONESTY (WC1 core item 5): fiveReach is null
// when the 5m archive is thin/absent — NEVER fabricated. Maps aer's reachedDays→reached, nDays→n;
// recentHit/recentDays come from aer.ask.recency (a recencySplit result).
export function windowExitShadow(aer, { list = null, live = null, peakWindow = null } = {}) {
  if (!aer || !aer.ask) return null;
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  const a = aer.ask, rc = a.recency || {};
  const hiReach = { reached: a.reachedDays, n: a.nDays, recentHit: rc.recentHit ?? null, recentDays: rc.recentDays ?? null, placement: r2(a.placement) };
  const g = aer.grain5m;
  const fiveReach = g ? { reached: g.reachedDays, n: g.nDays, placement: r2(g.placement) } : null;
  // reach-margin fade summary (the cushion TREND + today's pace) — lean: scalars only, the per-day
  // cushion array is dropped so suggestions.jsonl stays compact (SR1). Null when no margin read.
  const rm = a.reachMargin;
  const reachMargin = rm ? {
    trend: rm.trend, cushionNow: rm.cushionNow == null ? null : Math.round(rm.cushionNow),
    cushionFrom: rm.cushionFrom == null ? null : Math.round(rm.cushionFrom),
    cushionTo: rm.cushionTo == null ? null : Math.round(rm.cushionTo),
    reachedRecent: rm.reachedRecent, nRecent: rm.nRecent,
    pace: rm.pace ? { gap: Math.round(rm.pace.gap), onPace: rm.pace.onPace, hour: rm.pace.hour, n: rm.pace.n } : null,
  } : null;
  return { list, live, peakWindow, hiReach, fiveReach, reachMargin };
}

// PLAN-DIURNAL-TIMING DT4 (2026-07-23) — the timed-lap shadow: js/windowread.mjs diurnalTimedLap's
// result, reshaped for the ledger. Two shapes, mirroring the §7 DATA guarantee exactly: a degraded
// read logs `{ degraded: true, reason }` (never faked into zeros); a real read logs the diurnal
// bid/ask + windows, the timed vs. instant (same-hour) margin pair, the recent-N floor/ceiling trend
// DIRECTION ONLY (lowTrend/hiTrend's full `series`/`run`/`break` detail is dropped — SR1 lean
// discipline, the same call windowExitShadow's reachMargin makes for its per-day cushion array), the
// bid/ask recency-split reach counts (full + recent hit/N, the divergence flags — NOT the raw day
// list), the dip/peak liquidity pools, and the §4 tranche comfort/ceiling sizing. PLACEHOLDER, n≈0
// (rule 4) — shadow-logged for the eventual F1 retro-join, never a gate/rank/screen.json input. Null
// only when the caller has no lap object at all (never called); a genuinely degraded lap still logs
// its `{ degraded, reason }` shape (the whole point of the §7 data guarantee).
export function timedLapShadow(lap) {
  if (!lap) return null;
  if (lap.degraded) return { degraded: true, reason: lap.reason };
  const r2 = x => x == null ? null : Math.round(x * 100) / 100;
  const reach = rc => rc ? { fullHit: rc.fullHit, fullN: rc.fullN, recentHit: rc.recentHit, recentDays: rc.recentDays, diverges: rc.diverges } : null;
  // PLAN-DIURNAL-RECENCY-GUARD Chunk 2c (2026-08-12) — the level-reality read, reshaped the same lean
  // way `reach` reshapes a recencySplit: scalars only, `placement` rounded like every other percentile
  // on this row. Both FLAGS ride (they are orthogonal — spikeTop is "an anomalous recent print
  // over-generalised", staleOptimistic is "an old high the current regime no longer reaches"), and so
  // does `typicalLevel`, because the flag without the honest alternative level is a warning a retro
  // cannot score: the question is "was the flagged level worse than the typical it named?", which
  // needs the number, not the boolean. recentHit/recentDays are the EVIDENCE for staleOptimistic and
  // are kept for the same reason — they are what realityClause's 'full' style prints.
  const reality = rl => rl ? {
    spikeTop: rl.spikeTop, staleOptimistic: rl.staleOptimistic, typicalLevel: rl.typicalLevel,
    reachedDays: rl.reachedDays, nDays: rl.nDays,
    recentHit: rl.recentHit ?? null, recentDays: rl.recentDays ?? null,
    placement: r2(rl.placement),
  } : null;
  return {
    bid: lap.bid, ask: lap.ask,
    // Chunk 2c: the recommended levels stopped travelling stripped of their conditions. `peakReality`
    // qualifies `ask`, which deriveDiurnalRange passes through verbatim (js/windowread.mjs,
    // `deriveDiurnalRange`'s `const ask = profile.peak.level` — no reprice on the ask side).
    // `dipReality` describes `profile.dip.level` — which is `bid` only when the bid was NOT repriced;
    // read it with `bidBasis` below. Same rule as read-window-range.mjs's `result.diurnalRange`
    // (stated in full there): the RENDER gates the dip clause on a repriced bid, the RECORD preserves
    // both sides un-gated and records the discriminator, so a retro keeps both facts.
    peakReality: reality(lap.peakReality), dipReality: reality(lap.dipReality),
    // `bidBasis` rides because without it `dipReality` is UNINTERPRETABLE on this row.
    // deriveDiurnalRange reprices `bid` to the live instasell when the dip is not below live
    // (js/windowread.mjs, `deriveDiurnalRange`'s `bid >= liveLo` branch that sets
    // `bidBasis = 'live'`); on such a row `bid` is the live price, not the dip level. Every
    // RENDER site already gates on exactly this fact (read-window-range.mjs:331, read-schedule.mjs's
    // `!r.repriced`) — the record was the one consumer that had no way to tell, because `...dr` puts
    // `bidBasis` on the lap object and this reshaper dropped it. A retro that joins dipReality→bid
    // without it silently mixes two populations.
    bidBasis: lap.bidBasis ?? null,
    dipWindow: lap.dipWindow ? [lap.dipWindow.startH, lap.dipWindow.endH] : null,
    peakWindow: lap.peakWindow ? [lap.peakWindow.startH, lap.peakWindow.endH] : null,
    net: lap.net == null ? null : Math.round(lap.net), roi: r2(lap.roi),
    instantNet: lap.instantNet == null ? null : Math.round(lap.instantNet), instantRoi: r2(lap.instantRoi),
    holdHrs: lap.holdHrs ?? null,
    // `clean` (hourConcentration) is kept for continuity of the existing record, but it was MEASURED
    // not to discriminate and no longer decides anything (DT4, 2026-08-10 — CHANGELOG 0.72.0).
    clean: lap.clean ?? null,
    // DT4: the gate that REPLACED it. Logged because WINDOW_RELIABLE_R is a self-labelled PLACEHOLDER
    // and, without this, there is no path from the record back to the threshold — the deposed statistic
    // was being shadow-logged "for calibration" while its live replacement was not logged at all.
    // `reliable` is the tri-state; rLow/rHi/r are rounded; `relReason` separates flat-shape from the
    // degrade reasons so the two fail modes stay distinguishable in the record.
    reliable: lap.reliable ?? null,
    r: r2(lap.reliability ? lap.reliability.r : null),
    rLow: r2(lap.reliability ? lap.reliability.rLow : null),
    rHi: r2(lap.reliability ? lap.reliability.rHi : null),
    relReason: lap.reliability ? (lap.reliability.reason ?? null) : null,
    relDays: lap.reliability ? (lap.reliability.daysUsed ?? null) : null,
    // DT4b: the window every LEVEL field on this row was actually fitted over. Load-bearing for any
    // retro that spans 2026-08-10: from that date a `reliable:true` row's bid/ask/windows/pools are
    // 14d-fitted and a non-passing row's are the caller's (7d on the screen), so a join across the
    // boundary silently mixes two populations. `reliable` alone only implies the basis for callers
    // whose `nights` is a constant — record the basis itself rather than making the retro infer it.
    fitNights: lap.fitNights ?? null,
    lowTrend: lap.lowTrend ? lap.lowTrend.dir : null, hiTrend: lap.hiTrend ? lap.hiTrend.dir : null,
    bidReach: reach(lap.bidReach), askReach: reach(lap.askReach),
    dipPool: lap.dipPool ?? null, peakPool: lap.peakPool ?? null,
    trancheComfort: lap.trancheComfort ?? null, trancheCeiling: lap.trancheCeiling ?? null,
  };
}

// Build one suggestion entry from a computeQuote row + the caller's class/verdict. Kept separate
// from logSuggestions so a caller can assemble a batch, then log once.
//
// YS2 forward-enrichment (PLAN-YIELD): the caller may ALSO pass prediction fields the backfill can
// never invent — posture (active/overnight, the posture the read was made under), tripwire (the
// named structural level being watched), fillWindowHrs (predicted time-to-fill), thesis (one-line
// intent — NO PII). They are LEAN-INCLUDED: a field is
// written ONLY when the caller supplies a non-null value, so a row with no forward context stays
// byte-for-byte the shape it had before (keeps suggestions.jsonl from ballooning — SR1). Honesty:
// a script logs only what it can HONESTLY compute (e.g. posture from the clock/flag); it never
// fabricates a thesis. join-outcomes.mjs joinSuggestion reads each `?? null`.
// A predicted `velocityClass` was accepted here until 2026-08-10 and REMOVED as dead: no caller ever
// supplied it, so all 15,660 logged rows lacked it and join-outcomes' `predicted.velocityClassPredicted`
// was null on every campaign. It was also redundant — the "prediction" is just the item's dominant
// class from buildVelocityIndex(outcomes.json), which the join can recompute without logging anything.
// The MEASURED velocityClass (velocity.mjs, off a real round-trip) is untouched and still live.
// P2: `validators` is the compact non-pass validator-flag list (js/validate.mjs leanValidators) —
// lean-included exactly like the YS2 fields, so a clean (all-pass) row's logged shape is unchanged.
export function suggestionEntry(row, { itemId, cls, verdict, volSrc, posture, tripwire, fillWindowHrs, thesis, validators, path, bid, ask, pFill, ttfSec, rank, estBasis, estN, subFloor, dipLoop, grade, asym, estBuy, estSell, estConfidence, volDay, volDayRolling, expGpDay, expGpDayLegacy, winClear, windowExit, depthExit, reachable, amplitude, capEff, weakDeploy, cappedBy, timedLap, pathA, via, preRank, prePool, askPlacement, repriced, exemptionBounded, rankPre } = {}) {
  const e = {
    itemId,
    quickBuy:  row.quickBuy  ?? null,
    optBuy:    row.optBuy    ?? null,
    quickSell: row.quickSell ?? null,
    optSell:   row.optSell   ?? null,
    mom:       row.mom       ?? null,
    regime:    row.regimeLabel ?? null,
    class:     cls ?? null,
    verdict:   verdict ?? null,
  };
  // BD-LOG (PLAN-BID-DEPTH-5PCT, Ben-approved 2026-08-09): the GE guide price at emit time — the
  // anchor the in-game −5%/+5% offer buttons compute off. It rides straight off `row.guide` (set by
  // computeQuote, js/quotecore.js), so this is ZERO call-site changes and ~17 B/row.
  //
  // Why it earns its bytes: guide is NOT reconstructable after the fact from anything in this repo —
  // the archive schema has no guide column, .cache/guide.json is a 10-min-TTL snapshot overwritten in
  // place, and .guide-history.jsonl records only re-anchor CHANGES. Without it, "how far under guide
  // was this bid?" is unanswerable for every row ever logged.
  //
  // The live side is ALREADY logged and needs no new field: quickBuy IS the live instasell and
  // quickSell IS the live instabuy (quotecore.js:342-343). So `guide` alone makes BOTH depth-vs-guide
  // and depth-vs-live computable from one row — which is the whole point, because the two anchors
  // disagree materially: measured 2026-08-09, guide sits above live ~72% of the time and the two
  // disagree on whether an offer is "past −5%" for 52 of 428 offers. Either number alone is
  // uninterpretable. Lean-included (the YS2 pattern): a row with no guide in hand logs a
  // byte-identical shape.
  if (row.guide != null)     e.guide = row.guide;
  // SF-3: `volSrc` ('bulk' | 'peritem') records which /24h endpoint the volume behind `class` came
  // from, so F1 can bucket/normalize the two snapshot sources. Lean-included (the YS2 pattern): quote/
  // screen always supply it; a caller that doesn't (watch-positions.mjs passes its own classify() label) logs a
  // byte-identical shape.
  if (volSrc != null)        e.volSrc = volSrc;
  if (posture != null)       e.posture = posture;
  if (tripwire != null)      e.tripwire = tripwire;
  if (fillWindowHrs != null) e.fillWindowHrs = fillWindowHrs;
  if (thesis != null)        e.thesis = thesis;
  if (validators != null)    e.validators = validators;
  // P4c: `path` is the INFERRED default entry-path key from the surfacing strategy spec
  // (js/flip-niches.mjs defaultPath — band/spread/churn → scalp, rising → value-hold). Lean-included
  // exactly like the YS2 fields, so a caller that supplies no path (quote-items.mjs, watchlist rows) logs a
  // byte-identical shape. It lets a later fill attribute a position to a thesis when no explicit
  // `declare-thesis.mjs set --path` was declared (the P4b fallback: explicit hold-thesis > inferred > null).
  if (path != null)          e.path = path;
  // P6b — the per-thesis rank estimate: the ONE quoted pair the thesis posts (bid/ask) + the rank
  // components (pFill, TTF seconds, the composite rank = net×P÷TTF) + n/basis so the retro-join can
  // calibrate estimate-vs-realized. Lean-included exactly like the YS2 fields: written ONLY when
  // supplied, so a caller that logs no rank estimate (older callers) stays byte-for-byte unchanged.
  if (bid != null)           e.bid = bid;
  if (ask != null)           e.ask = ask;
  if (pFill != null)         e.pFill = pFill;
  if (ttfSec != null)        e.ttfSec = ttfSec;
  if (rank != null)          e.rank = rank;
  if (estBasis != null)      e.estBasis = estBasis;
  if (estN != null)          e.estN = estN;
  // EF-0a (2026-08-01) — ADMISSION PROVENANCE (see the schema block above): via = how the row won its
  // fetch slot ('reserve' | 'explore'; absent = ranked-in/held — the natural-experiment baseline),
  // preRank/prePool = the pre-fetch-ordering position stamp ("12th of 178") off admission.mjs, and
  // askPlacement = the quoted ask's daily-HIGH placement percentile the digest already computes.
  // Lean-included (YS2 pattern): quote/watch and `--admission legacy` rows log a byte-identical shape.
  if (via != null)           e.via = via;
  if (preRank != null)       e.preRank = preRank;
  if (prePool != null)       e.prePool = prePool;
  if (askPlacement != null)  e.askPlacement = askPlacement;
  // EF1 (PLAN-ESTIMATOR-FIDELITY, 2026-08-01) — rank-leg honesty shadows (all lean, YS2 pattern):
  //   repriced          { bid, ask, net, pFill, rank } — the EF1(a) dead-bid REPRICED-ENTRY alternative
  //                     (entry at the live crossable level, sell unchanged). A labeled alternative only;
  //                     the row's headline rank/pFill above are UNCHANGED by it (R-1). EF0(c) scores it.
  //   exemptionBounded  true — the EF1(b) placement bound DROPPED this symmetric (churn) row's ask-reach
  //                     exemption (ask above the daily-high distribution); the logged pFill/rank are the
  //                     DISCOUNTED (post-bound) numbers.
  //   rankPre           the pre-bound rank (exemption still held) logged beside it — the R-1 visible-swap
  //                     pair for the F1 pre/post churn-board audit. Present only with exemptionBounded.
  if (repriced != null)      e.repriced = repriced;
  if (exemptionBounded != null) e.exemptionBounded = exemptionBounded;
  if (rankPre != null)       e.rankPre = rankPre;
  // P6c — a screen row surfaced by the EMPTY-RESULT SUB-FLOOR FALLBACK carries which floor was relaxed
  // ('min-gpd' | 'liquidity'). Lean-included (the YS2 pattern — pinned by subfloor.test.mjs): a normal
  // floor-qualified row logs a byte-identical shape, and calibration/readers can segment or exclude
  // sub-floor rows instead of mistaking them for qualified suggestions.
  if (subFloor != null)      e.subFloor = subFloor;
  // R7 (PLAN-SIGNAL-RECENCY) — which grade CEILING (thin | phase-basing | sub-floor | reach) bound the
  // printed letter, or absent when the raw grade stood. Legibility + retro segmentation (which cap most
  // often clamps a would-be-higher letter). Lean-included (YS2): an uncapped row logs a byte-identical shape.
  if (cappedBy != null)      e.cappedBy = cappedBy;
  // PART II (PLAN-GRADE-REACH) — the SHADOW asymmetric-fill estimate { bid, ask, pAsk, pBid, n, rank }
  // beside the row's symmetric `rank`, the data-accrual half of the F1 A/B (see the schema doc above).
  // Lean-included (YS2 pattern): callers without an asym read (quote/watch, churn/value rows, no 1h
  // series) log a byte-identical shape.
  if (asym != null)          e.asym = asym;
  // PLAN-OUTPUT-TABLE (2026-07-13) — the RECONCILIATION-ESTIMATOR shadow pair: estBuy/estSell are the
  // reach-folded, BE-floored Est. buy/sell the console table now renders (js/estimators.mjs
  // estimatePair; PLACEHOLDER model, n≈14), and estConfidence is its lean evidence object
  // ({ askHit, askDays, bidHit, bidDays, beFloored? } — estConfLean). Logged BESIDE the model-free
  // quickBuy/optBuy/… fields so the F1 retro-join can score "did estSell predict the realized sell".
  // Lean-included (YS2 pattern): callers without an estimate log a byte-identical shape.
  if (estBuy != null)        e.estBuy = estBuy;
  if (estSell != null)       e.estSell = estSell;
  if (estConfidence != null) e.estConfidence = estConfidence;
  // AZ-forward (2026-07-12, analyze.mjs forward-data gaps): `grade` is the rating LETTER as rendered
  // then (incl. any thin/sub-floor cap) — the grade-clumping audit's segmentation key. Only screen-flip-niches.mjs
  // computes a grade, so it's a caller param (quote/watch never supply it). Lean-included (YS2 pattern):
  // absent on every pre-field row and on grade-less scripts — consumers treat absent as unknown.
  if (grade != null)         e.grade = grade;
  // PLAN-VOL24 — the TRUE trailing-24h volume { hpv, lpv } composed from /1h (rolling24FromTs1h, off an
  // already-fetched series → zero new fetch). Full field semantics + the shadows-nothing caveat are in
  // the volDayRolling entry of this file's header schema; don't restate them here.
  // Lean-included (YS2 pattern): a caller with no 1h series in hand (watchlist rows) supplies null →
  // no field → byte-identical shape.
  if (volDayRolling != null) e.volDayRolling = volDayRolling;
  // The RAW scalar behind `class` (added 2026-08-11). Before this, 0 of 99,587 rows carried it, so no
  // historical class is reconstructible and the 2026-07-13 quote/screen source split was invisible in
  // the record. Also the point-in-time volume join-outcomes.mjs SHOULD join on — it recomputes from a
  // live map, so F1 cells bucket by today's liquidity. Lean-included (YS2): absent → old rows identical.
  if (volDay != null)        e.volDay = volDay;
  // PLAN-CAPITAL-THROUGHPUT (2026-07-14) — the ACTIVE capital-aware expGpDay + the LEGACY capital-blind
  // expGpDayLegacy, logged as a shadow pair so a --stats/analyze read can diff old-vs-new surfacing on
  // real rows before/after the default flip (the same rollout the volDayRolling shadow served for VOL24).
  // Lean-included (YS2 pattern): a caller with no expGpDay (quote/watch/watchlist) → no field → byte-identical.
  if (expGpDay != null)      e.expGpDay = expGpDay;
  if (expGpDayLegacy != null) e.expGpDayLegacy = expGpDayLegacy;
  // PLAN-WINDOW-CLEAR B2 (2026-07-14) — the within-window CLEAR read { windowReach, reachedDays, nDays,
  // pool, clearRatio, wStart, wEnd, diverges } for the quoted ask's diurnal peak window, logged wider
  // than surfaced (every churn/scalp row, not only the diverging ones) so analyze/F1 can test whether the
  // days-reach ≠ lap-clear divergence predicts an unfilled/slow ask. Lean-included (YS2): a caller with no
  // read (no ts1h / no peak window) supplies null → no field → byte-identical shape.
  if (winClear != null)      e.winClear = winClear;
  // WC1 (PLAN-WINDOW-CLEAR-OUTCOMES 2026-07-20) — the window-clear ask-RUNG forward record for a big-ticket
  // held lot: { list, live, peakWindow:[startH,endH], hiReach:{reached,n,recentHit,recentDays,placement},
  // fiveReach:{reached,n,placement}|null } off windowExitShadow(askExitRead(...)). Records the ACTUAL surfaced
  // rung (thesisEntry.exitPrice ?? optSell) with the daily-HIGH and 5m-grain reach signals SIDE-BY-SIDE, so
  // WC2 can join it against fills.json and ask which signal predicts a resting-ask fill. DISTINCT from winClear
  // (that keys the within-window lap-clear on optSell; this keys the rung's two reach signals + placement).
  // Lean-included (YS2 pattern): quote-items.mjs --positions / watch-positions.mjs big-ticket held rows only —
  // every other row (and a non-big-ticket lot) logs a byte-identical shape. Honesty: fiveReach null when thin.
  if (windowExit != null)    e.windowExit = windowExit;
  // PLAN-DEPTH-EXIT DE3 (2026-07-15) — the held-lot depth-floor shadow ({ qty, competition, liqClass,
  // ask?/clearFrac? | collapse? }) + the pressure-driven reachable band ({ ask, bid, pressure,
  // reliability, bandLow, bandHigh }). Logged BESIDE the row's reach/relief-based fields so the F1
  // retro-join scores all the exit-pricing alternatives against the SAME realized fill — including
  // whether the ×4 competition bar nulls a liquidity class we'd want to price (collapse + liqClass).
  // Lean-included (YS2 pattern): watch-positions.mjs held rows only; degraded reads → no field → byte-identical.
  if (depthExit != null)     e.depthExit = depthExit;
  if (reachable != null)     e.reachable = reachable;
  // DC3 demandRegime shadow field REMOVED 2026-07-22 (PLAN-REMOVE-DEPTH-PRESSURE-READS chunk 2 — the
  // Extension-B demand-cycle read was deleted; historical ledger rows keep the field, new rows omit it).
  // RC-S1/RC-S2 (PLAN-REACHABILITY-CONSOLIDATION 2026-07-15): estBuy/estSell/estConfidence + asym are the
  // reachRelief-family + fixed-quantile exit estimators, co-logged beside depthExit/reachable so all five
  // compete head-to-head against the realized sell. The head-to-head spans HELD (watch, quote --positions)
  // AND DISCOVERY (screen survivors, quote per-item) surfaces: `reachable` (pressure) rides EVERY row with
  // an in-hand 1h series; `depthExit` (depth) rides only HELD rows (real qty + 1h in hand) — a bare
  // discovery row omits it (the DE7 fetch-budget rule). On watch the shadow est uses declaredExit:null (the
  // model's intrinsic ask is the scored quantity). All shaped by the reachableShadow/depthExitShadow/
  // asymShadow reshapers above (ONE home, no drift). estBuy/estSell/estConfidence/asym are handled by the
  // existing lean blocks above — no new field shape.
  // DL2 — a flush SIGNAL (watch-positions.mjs --dip) carries its full component object so the DL2 retro-join
  // (pipeline/commands/analyze-record.mjs §4) can join it against fills.json and, over enough history, SURFACE a re-fit
  // candidate to F1 (analyze never mutates a constant). Logged for EVERY genuine flush signal — liquid
  // (alerted) AND illiquid (signal-only, the standing-bid / DL3 evidence). Lean-included exactly like the
  // YS2 fields — a caller that supplies no dipLoop logs a byte-identical shape (pinned by diploop.test.mjs).
  // Schema: { volDay, price, limit, depthPct, bucketVol, quickBuy, optSell, afterTaxMargin, dipScore,
  // alerted, gatedReason }; joinable against fills.json via the row's itemId + ts.
  if (dipLoop != null)       e.dipLoop = dipLoop;
  // A5 (PLAN-AMPLITUDE-SCAN) — the amplitude lane shadow block { ampBid, ampAsk, holdDays,
  // bidTouchRecent/Days, askReachRecent/Days, nDays, medAmpPct, dipWindow?, peakWindow?, askQ?, bidQ? }.
  // F-E: askQ/bidQ (the reach-vs-margin quantiles the row was quoted at) appear ONLY on an experiment run
  // that overrode the default board — a default run keeps its exact prior shape. screen
  // amplitude rows only; the shadow both-leg replay (join-amplitude-outcomes.mjs) reads it to measure the
  // would-have-fill UPPER BOUND against the 1h archive. Lean-included (YS2 pattern): absent on every other row.
  if (amplitude != null)     e.amplitude = amplitude;
  // Bar E ask-headroom signal (PLAN Bar-E-signal, Ben 2026-07-11): the robust p90 shaved a TRADED in-band
  // top off the quoted ask (row.askHeadroom, computeQuote). Logged whenever present — TRUSTED (surfaced as
  // a note) AND UNTRUSTED (audit only) — so analyze.mjs/F1 can join it to realized fills (does the raw top
  // actually get reached?) before tuning the PLACEHOLDER thresholds or graduating the deferred clamp-widen.
  // Derived off `row` (not a caller param), so quote/screen both log it with no call-site change; a row
  // with no shave gap has row.askHeadroom===null → no field → byte-identical shape. INFORM-ONLY.
  if (row.askHeadroom != null) e.askHeadroom = row.askHeadroom;
  // AZ-forward (2026-07-12): `depth` = the realized 24h two-sided flow at emit, {hpv, lpv} off
  // computeQuote's row.pressure — the "fill-rate vs. book depth" retro input analyze.mjs flagged as
  // unlogged. Derived off `row` (like askHeadroom — quote/screen/watch all log it with no call-site
  // change). HONESTY: this is the trailing-24h FLOW PROXY, not an order-book depth snapshot (cite it
  // with the shortcomings documented at the pressure derivation in js/quotecore.js computeQuote).
  // The SPREAD half of the analyze recommendation is already logged: quickSell − quickBuy on every row.
  // Lean-included: no /24h read → no field → byte-identical shape.
  if (row.pressure && (row.pressure.hpv != null || row.pressure.lpv != null))
    e.depth = { hpv: row.pressure.hpv ?? null, lpv: row.pressure.lpv ?? null };
  // PLAN-CAPITAL-EFFICIENCY-AND-DIGEST (2026-07-21) — the capital-efficiency shadow pair: capEff =
  // after-tax ROI%/day of capital tied up (roiPct ÷ holdDays; a churn lane's holdDays reflects its
  // laps/day), weakDeploy = a big-ticket single-turn pick under the ~0.5%/turn PLACEHOLDER bar. Both
  // INFORM-ONLY (n≈0) — the retro-join calibrates them later; never a gate/screen.json field. Lean-
  // included (YS2 pattern): a caller that supplies neither (quote/watch/watchlist) logs a byte-identical shape.
  if (capEff != null)        e.capEff = capEff;
  if (weakDeploy != null)    e.weakDeploy = weakDeploy;
  // PLAN-DIURNAL-TIMING DT4 (2026-07-23) — the timed-lap shadow (see timedLapShadow above): the
  // js/windowread.mjs diurnalTimedLap result (or its degraded form) for the row. Lean-included (YS2
  // pattern): a caller with no lap in hand (quote/watch — not yet wired at DT4) logs a byte-identical
  // shape; screen-flip-niches.mjs's renderMode survivors always have one (DT2 computes it per row), so
  // every row THAT path logs always carries the field — the §7 data guarantee, at the ledger layer.
  if (timedLap != null)      e.timedLap = timedLap;
  // PLAN-LANE-ADMISSION Chunk E/H1 (2026-07-25) — the Path-A intraday-flip gp/day forward record
  // { gpDay, marginU, captureFrac, cyclesDay, units, price, intradayRange, lane, rankInLane } off
  // pipeline/lib/patha.mjs pathAGpDay (Chunk C) + the row's rank within its lane in this run. This is
  // the ACCRUAL half (E) of the H2/H4 forward validator: Path-A drives the CONSOLE primary sort now
  // (Chunk D, owner decision H4), and its captureFrac is a PLACEHOLDER (n=13/12, own-book-biased) — so
  // the join scorer (Chunk F) reads THIS field to test forward whether the predicted intradayRange
  // materialized and captureFrac holds, before any recalibration. Purely additive — absent on every row
  // where Path-A wasn't computed (null intraday range / non-screen scripts). Lean-included (YS2 pattern):
  // a caller that supplies no pathA logs a byte-identical shape. IDs/prices/timestamps only, no PII.
  if (pathA != null)         e.pathA = pathA;
  return e;
}

// Append entries to suggestions.jsonl. Best-effort: a logging failure must NEVER break a market
// read (the ledger is analytics, not the product) — it warns and moves on. One fs call per batch.
export function logSuggestions(script, { mode = null, params = null } = {}, entries = []) {
  if (!entries || !entries.length) return;
  // SR1: before appending, roll any completed month out to its archive so the active root file
  // stays bounded to the current month. Cheap guard — only reads the whole file (rotateLedger) when
  // the OLDEST row predates the current month; otherwise a single small first-line read. Best-effort:
  // rotation must NEVER break a market read (the ledger is analytics, not the product).
  try {
    const fm = firstLineMonth();
    if (fm && fm < currentMonthKey()) rotateLedger();
  } catch (err) { console.error('(suggestlog: rotation skipped — ' + ((err && err.message) || err) + ')'); }
  const ts = Math.floor(Date.now() / 1000);
  const text = entries.map(e => JSON.stringify({ ts, script, mode, params, ...e })).join('\n') + '\n';
  try { fs.appendFileSync(LEDGER, text); }
  catch (err) { console.error('(suggestlog: could not append to suggestions.jsonl — ' + ((err && err.message) || err) + ')'); }
}
