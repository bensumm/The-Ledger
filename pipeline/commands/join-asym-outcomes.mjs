#!/usr/bin/env node
/* join-asym-outcomes.mjs — PLAN-PATIENT-PAIR §7. Replaces the asym pair's READ-BACK QUANTILE
 * CONSTANTS with forward-measured rates: given the deep bid was ACTUALLY TOUCHED, was the high ask
 * reached within H hours? Every level comes from a LOGGED row and is scored forward only.
 *
 * ── READ THIS BEFORE QUOTING ANY NUMBER ───────────────────────────────────────────────────────
 * 1. THE TWO LEGS ARE THE DELIVERABLE: a measured P(bid touched) and a measured P(ask reached |
 *    touched), replacing constants that measure nothing (caveat 4). Quote them as a PAIR — the
 *    round trip is their conjunction, and either alone flatters it.
 * 2. `touched ≠ filled` and `reached ≠ filled`. Outcomes are "a 1h bucket printed avgLowPrice ≤ bid"
 *    and "a 1h bucket printed avgHighPrice ≥ ask" — no queue position, no partial fills, no
 *    competition at the level. Every absolute rate here is an UPPER BOUND on a real offer.
 * 3. Counter-direction, so the bound is not one-way: the 1h avg is a trade-side AVERAGE, so
 *    `avg ≥ ask` implies a print at or above, but `avg < ask` does NOT imply no print. That
 *    UNDERCOUNTS prints, partially offsetting (2). Both legs share the 1h-avg basis deliberately.
 * 4. `pAsk`/`pBid` AS LOGGED ARE NOT A BASELINE TO BEAT — they are the quantile constants read back
 *    out (PLAN §2b: pAsk = 0.86 on 89.9% of rows, pBid = 0.29 on 86.5%, i.e. 12/14 and 4/14).
 *    Printing the measured rate BESIDE them shows the size of the fiction, not a model comparison.
 * 5. THE GUARD SPLIT IS ONLY RECOVERABLE ON PART OF THE POOL. `pAskAt`/`pBidAt` ship from
 *    2026-08-12; earlier rows carry neither, so guarded-vs-unguarded is unknown on them and they
 *    are reported as a third stratum, never folded into either. On guarded rows the PRICE was moved
 *    to `quickSell` while `pAsk` was measured at the lower level (PLAN §2d) — different questions,
 *    scored separately.
 * 6. One era, one update cycle, band-dominated. Item-day clustering ⇒ effective n well below
 *    nominal; every CI here resamples ITEMS, not rows.
 *
 * WHY THIS EXISTS: every surface that renders the patient pair displays a probability that orders
 * nothing (§2b), and PLAN §7 makes this the one piece of work here that produces EVIDENCE rather
 * than visibility. It is also the DT1 generalisation test — DT1 (2026-08-09) measured completion
 * within 24h given entry at 4.8% over 92 items, which sank the amplitude lane's daily premise. The
 * anchor incident was an overnight big-ticket move. Either DT1 does not reach that class or the
 * anchor was a good outcome from a bad-odds setup; the price strata are where that reads.
 *
 * GATES NOTHING. No threshold moves off this file; threshold work belongs to F1.
 */
import { fileURLToPath } from 'node:url';
import * as archive from '../lib/market/archive.mjs';
import { readSuggestionLines } from '../lib/render/suggestlog.mjs';
import { parseArgs } from '../lib/render/cli.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { BIG_TICKET_GP } from '../../js/quotecore.js';

// The decisive spec — LOCKED BEFORE THE FIRST RUN so a favourable subset cannot become the
// headline. Everything else is a sensitivity row.
export const DECISIVE_ENTRY_H = 24;      // the deep bid must be touched within this of the suggestion
export const DECISIVE_HORIZON_H = 24;    // the ask must then be reached within this of the TOUCH
export const SENSITIVITY_HORIZONS_H = [8, 24, 48, 96, 168];
export const BOOTSTRAP_ITERS = 2000;
export const BOOTSTRAP_SEED = 12345;
export const MIN_ITEMS_FOR_CI = 5;

/* A REJECTED ESTIMATOR, kept per the join-depth convention of recording what failed.
 * The first design scored a MATCHED NULL: the same item and level over a horizon-length window at
 * RANDOM offsets, reporting `P(hit | entered) − null` as "does entering predict the exit". It
 * measured −36.0pp, CI [−42.7, −29.1] over 369 items — which reads as overwhelming adverse
 * selection and is an ARTIFACT OF THE STARTING PRICE. The conditional arm always begins at a moment
 * the market just traded DOWN to the deep bid; the null arm begins wherever. Measured directly, the
 * null arm starts at 99.8% of that row's ask level against the conditional arm's 93.8% — a 5.95%
 * gap, so the null was largely scoring windows that began at or above the ask, where "reached" is
 * free. Do not reinstate a null that is matched on neither the starting price nor the clock; the
 * shipped contrast below is TIME-MATCHED, both arms over the identical calendar window. */
const HOUR = 3600;

/* firstIndexAfter(series, ts) → the first index whose bucket is strictly later than ts. */
function firstIndexAfter(series, ts) {
  let lo = 0, hi = series.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (series[m].ts <= ts) lo = m + 1; else hi = m; }
  return lo;
}

/* touchedAt(series, from, level, windowH) → the ts of the first bucket in (from, from+windowH]
 * printing avgLowPrice ≤ level, or null. The ENTRY leg: a resting deep bid is touched when the
 * market trades down to it. Uses avgLow (the instasell side) because that is the side a BUY fills
 * against — the orientation `js/quotecore.js` pins for quickBuy. */
export function touchedAt(series, from, level, windowH) {
  if (!series || !series.length || level == null) return null;
  const end = from + windowH * HOUR;
  for (let i = firstIndexAfter(series, from); i < series.length && series[i].ts <= end; i++) {
    const lo = series[i].avgLowPrice;
    if (lo != null && lo <= level) return series[i].ts;
  }
  return null;
}

/* reachedWithin(series, from, level, windowH) → did any bucket in (from, from+windowH] print
 * avgHighPrice ≥ level. The EXIT leg, mirroring the entry leg's side convention. */
export function reachedWithin(series, from, level, windowH) {
  if (!series || !series.length || level == null) return false;
  const end = from + windowH * HOUR;
  for (let i = firstIndexAfter(series, from); i < series.length && series[i].ts <= end; i++) {
    const h = series[i].avgHighPrice;
    if (h != null && h >= level) return true;
  }
  return false;
}

/* covers(series, until) → does the archive extend far enough to RESOLVE an outcome ending at
 * `until`. An unresolved row is DROPPED, never counted as a miss — counting it as a miss would bias
 * every rate downward by exactly the truncation at the end of the archive. */
export function covers(series, until) {
  return !!(series && series.length && series[series.length - 1].ts >= until);
}

/* scoreRow(series, row, {entryH, horizonH}) → one row's forward outcome, or null if the archive
 * cannot resolve it.
 *
 * Three observations, all over the SAME calendar window W = (ts, ts + entryH + horizonH]:
 *   entered    the deep bid was touched in (ts, ts+entryH]                      → the real pBid
 *   hit        the ask was reached in (touch, touch+horizonH]                   → the real pAsk|entered
 *   askOnly    the ask was reached ANYWHERE in W, ignoring the bid entirely     → the TIME-MATCHED arm
 *
 * `hit ⇒ askOnly` by construction (the exit window is a subset of W), so the two are a DECOMPOSITION,
 * not a horse race: askOnly − roundTrip is the cost of insisting on the buy leg first, measured
 * against the same item over the same hours. That containment is what makes it confound-free where
 * the rejected random-offset null was not.
 *
 * RESOLUTION IS TWO-STAGE and the distinction matters. A row that never entered is resolved for the
 * ENTRY question (we watched the whole entry window and nothing touched) but carries NO exit
 * observation — it is not an exit miss. Pooling the two turns "the bid rarely fills" into "the ask
 * rarely reaches", which is a different and false claim. */
export function scoreRow(series, row, { entryH, horizonH }) {
  const wEnd = row.ts + (entryH + horizonH) * HOUR;
  if (!covers(series, wEnd)) return null;
  const askOnly = reachedWithin(series, row.ts, row.ask, entryH + horizonH);
  const tTouch = touchedAt(series, row.ts, row.bid, entryH);
  if (tTouch == null) {
    return { itemId: row.itemId, ts: row.ts, entered: false, exitResolved: false,
             hit: false, roundTrip: false, askOnly };
  }
  const hit = reachedWithin(series, tTouch, row.ask, horizonH);
  return { itemId: row.itemId, ts: row.ts, entered: true, exitResolved: true, hit,
           roundTrip: hit, askOnly, waitH: (tTouch - row.ts) / HOUR };
}

/* summarize(scored) → the two legs, the round trip, and the time-matched ask-only arm. `pBid` and
 * the round trip are over EVERY resolved row; `pAskGivenEntry` is over the entered subset only. */
export function summarize(scored) {
  const res = scored.filter(Boolean);
  if (!res.length) return null;
  const exits = res.filter(s => s.exitResolved);
  const entered = res.filter(s => s.entered).length;
  const hits = exits.filter(s => s.hit).length;
  const rt = res.filter(s => s.roundTrip).length;
  const ao = res.filter(s => s.askOnly).length;
  const waits = exits.map(s => s.waitH).filter(x => x != null).sort((a, b) => a - b);
  return {
    nResolved: res.length, nEntered: entered, nExitResolved: exits.length,
    pBid: entered / res.length,
    pAskGivenEntry: exits.length ? hits / exits.length : null,
    roundTrip: rt / res.length,
    askOnly: ao / res.length,
    entryCost: (rt - ao) / res.length,          // ≤ 0 by construction — a decomposition, not a race
    medWaitH: waits.length ? waits[waits.length >> 1] : null,
    items: new Set(res.map(s => s.itemId)).size,
  };
}

/* bootstrapEntryCost(scored, opts) → a 95% CI on `entryCost`, resampling ITEMS (caveat 6). Refuses
 * below MIN_ITEMS_FOR_CI rather than printing an interval off a handful of items. */
export function bootstrapEntryCost(scored, { iters = BOOTSTRAP_ITERS, seed = BOOTSTRAP_SEED } = {}) {
  const res = scored.filter(Boolean);
  const byItem = new Map();
  for (const s of res) { if (!byItem.has(s.itemId)) byItem.set(s.itemId, []); byItem.get(s.itemId).push(s); }
  const items = [...byItem.values()];
  if (items.length < MIN_ITEMS_FOR_CI) return null;
  let st = seed >>> 0;
  const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  const cs = [];
  for (let i = 0; i < iters; i++) {
    const draw = [];
    for (let k = 0; k < items.length; k++) draw.push(...items[Math.floor(rnd() * items.length)]);
    if (!draw.length) continue;
    const rt = draw.filter(s => s.roundTrip).length, ao = draw.filter(s => s.askOnly).length;
    cs.push((rt - ao) / draw.length);
  }
  if (cs.length < iters / 4) return null;
  cs.sort((a, b) => a - b);
  return { lo: cs[Math.floor(cs.length * 0.025)], hi: cs[Math.floor(cs.length * 0.975)],
           iters: cs.length, items: items.length };
}

/* readRows(lines?) → the candidate pool. Every guard is field-level and COUNTED, so the funnel
 * prints where the pool went rather than leaving a silent drop. */
export function readRows(lines) {
  // readSuggestionLines() yields RAW JSON STRINGS (the ledger plus every monthly archive), not
  // parsed objects — parsing is the caller's job, exactly as the sibling joins do it.
  const src = lines || readSuggestionLines();
  const drop = { parseFail: 0, noKey: 0, noAsym: 0, noLevels: 0, crossed: 0 };
  const rows = [];
  for (const line of src) {
    let r; try { r = typeof line === 'string' ? JSON.parse(line) : line; } catch { drop.parseFail++; continue; }
    // aggregate admission rows carry NO itemId property at all — a LOOSE test is required here
    // (suggestlog.mjs's joiner contract; a strict === null does not skip them).
    if (r == null || r.itemId == null) { drop.noKey++; continue; }
    const a = r.asym;
    if (!a) { drop.noAsym++; continue; }
    if (a.bid == null || a.ask == null) { drop.noLevels++; continue; }
    // a crossed pair cannot pose the question (buy above the sell) — measured at 0 today, kept
    // because the display pair is min/max-guarded and a future guard change could produce one.
    if (a.bid >= a.ask) { drop.crossed++; continue; }
    rows.push({ itemId: r.itemId, ts: r.ts, name: r.name ?? null, mode: r.mode ?? null,
      bid: a.bid, ask: a.ask, pAsk: a.pAsk ?? null, pBid: a.pBid ?? null,
      // guarded = the ordering guard moved the PRICE off the level the probability was measured at
      // (PLAN §2d). Unknowable before pAskAt/pBidAt shipped — null, never false.
      askGuarded: a.pAskAt == null ? null : a.ask !== a.pAskAt,
      bidGuarded: a.pBidAt == null ? null : a.bid !== a.pBidAt });
  }
  return { rows, drop };
}

// ── CLI (guarded; the pure core above is what the tests import) ─────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asJson = process.argv.includes('--json');
  const entryH = args.entry != null ? Number(args.entry) : DECISIVE_ENTRY_H;
  const horizonH = args.horizon != null ? Number(args.horizon) : DECISIVE_HORIZON_H;
  const onlyItem = args.item ?? null;

  const { rows: all, drop } = readRows();
  let rows = all;
  if (onlyItem) {
    const mapping = await loadMapping();
    const hit = mapping?.resolve?.(onlyItem);
    if (!hit) { console.error(`--item: could not resolve "${onlyItem}" to an item id`); process.exit(1); }
    rows = rows.filter(r => r.itemId === hit.id);
  }
  if (!rows.length) { console.log('no asym rows in the ledger — nothing to score.'); return; }

  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const byItem = new Map();
  for (const r of rows) { if (!byItem.has(r.itemId)) byItem.set(r.itemId, []); byItem.get(r.itemId).push(r); }
  const seriesCache = new Map();
  for (const id of byItem.keys()) seriesCache.set(id, db.seriesFor(id, '1h', {}));

  const runAt = (eH, hH) => {
    const out = [];
    for (const [id, rs] of byItem) {
      const series = seriesCache.get(id);
      for (const r of rs) {
        const s = scoreRow(series, r, { entryH: eH, horizonH: hH });
        if (s) out.push({ ...s, row: r });
      }
    }
    return out;
  };

  const scored = runAt(entryH, horizonH);
  const overall = summarize(scored);
  const ci = bootstrapEntryCost(scored);
  const sensitivity = SENSITIVITY_HORIZONS_H.filter(h => h !== horizonH).map(h => {
    const s = summarize(runAt(entryH, h));
    return { horizonH: h, pBid: s?.pBid ?? null, pAskGivenEntry: s?.pAskGivenEntry ?? null,
             roundTrip: s?.roundTrip ?? null, askOnly: s?.askOnly ?? null, n: s?.nResolved ?? 0 };
  });
  // The DT1 generalisation question (PLAN §7): does the big-ticket class behave like the pooled one?
  const priceStrata = [['big-ticket', s => s.row.ask >= BIG_TICKET_GP],
                       ['sub-big-ticket', s => s.row.ask < BIG_TICKET_GP]]
    .map(([label, f]) => ({ label, ...(summarize(scored.filter(f)) ?? {}) }));
  // The §2d question: a guarded row's PRICE is not the level its probability was measured at.
  const guardStrata = [['ask-guarded', s => s.row.askGuarded === true],
                       ['ask-unguarded', s => s.row.askGuarded === false],
                       ['unknown (pre-pAskAt)', s => s.row.askGuarded === null]]
    .map(([label, f]) => ({ label, ...(summarize(scored.filter(f)) ?? {}) }));
  // What the display CLAIMS, for the side-by-side in caveat 4. NOT a baseline.
  const claimed = (() => {
    const withP = rows.filter(r => r.pAsk != null && r.pBid != null);
    if (!withP.length) return null;
    return { pAsk: withP.reduce((a, r) => a + r.pAsk, 0) / withP.length,
             pBid: withP.reduce((a, r) => a + r.pBid, 0) / withP.length, n: withP.length };
  })();
  try { db.db.close(); } catch {}

  if (asJson) {
    console.log(JSON.stringify({
      app: 'the-coffer-asym-outcomes', version: 1, entryH, horizonH,
      caveat: 'touched/reached != filled — every absolute rate is an UPPER BOUND on a real offer',
      drop, poolRows: rows.length, claimed, overall, ci, sensitivity, priceStrata, guardStrata,
    }, null, 2));
    return;
  }

  const pct = x => x == null ? '—' : (100 * x).toFixed(1) + '%';
  const pp = x => x == null ? '—' : (x >= 0 ? '+' : '') + (100 * x).toFixed(1) + 'pp';
  const THIN_N = 30;
  const thin = o => (o && o.nResolved != null && o.nResolved < THIN_N) ? ' ⚠ thin' : '';

  console.log(`\n── join-asym-outcomes — bid touched ≤${entryH}h, then ask reached ≤${horizonH}h from the TOUCH ──`);
  console.log(`pool ${rows.length} row(s) over ${overall?.items ?? 0} item(s)  ·  dropped: ${Object.entries(drop).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`\n── THE TWO LEGS — the deliverable (absolute rates are UPPER BOUNDS, caveat 2) ──`);
  console.log(`  entry  P(deep bid touched ≤${entryH}h)        ${pct(overall?.pBid)}   over ${overall?.nResolved ?? 0} resolved row(s)`);
  console.log(`  exit   P(ask reached ≤${horizonH}h | touched)   ${pct(overall?.pAskGivenEntry)}   over ${overall?.nExitResolved ?? 0} entered row(s)`);
  console.log(`  ROUND TRIP (both legs)                      ${pct(overall?.roundTrip)}   median wait to the touch ${overall?.medWaitH == null ? '—' : overall.medWaitH.toFixed(1) + 'h'}`);
  if (claimed) {
    console.log(`\n── WHAT THE DISPLAY CLAIMS (read-back quantile constants — NOT a baseline, caveat 4) ──`);
    console.log(`  pBid: logged ${pct(claimed.pBid)} vs measured ${pct(overall?.pBid)}   ·   pAsk: logged ${pct(claimed.pAsk)} vs measured ${pct(overall?.pAskGivenEntry)}   (n ${claimed.n})`);
  }
  console.log(`\n── THE COST OF THE BUY LEG (time-matched: same rows, same window W = ts+${entryH + horizonH}h) ──`);
  console.log(`  ask reached anywhere in W, ignoring the bid   ${pct(overall?.askOnly)}`);
  console.log(`  round trip (bid first, THEN the ask)          ${pct(overall?.roundTrip)}   ⇒ entry costs ${pp(overall?.entryCost)}`);
  if (ci) console.log(`  95% CI [${(100 * ci.lo).toFixed(1)}, ${(100 * ci.hi).toFixed(1)}]pp resampling ${ci.items} ITEMS`);
  else console.log(`  95% CI: refused — under ${MIN_ITEMS_FOR_CI} items`);
  console.log(`  (round trip ⊆ ask-only BY CONSTRUCTION — this is a decomposition, not a horse race)`);
  console.log(`\n── SENSITIVITY (exit horizon; entry window held at ${entryH}h) ──`);
  for (const s of sensitivity) console.log(`  ${String(s.horizonH).padStart(3)}h   entry ${pct(s.pBid)}   exit|entry ${pct(s.pAskGivenEntry)}   round trip ${pct(s.roundTrip)}   ask-only ${pct(s.askOnly)}   n ${s.n}`);
  console.log(`\n── PRICE STRATA (the DT1 generalisation test — DT1 measured 4.8% completion ≤24h given entry) ──`);
  for (const s of priceStrata) console.log(`  ${s.label.padEnd(16)} entry ${pct(s.pBid)}  exit|entry ${pct(s.pAskGivenEntry)}  round trip ${pct(s.roundTrip)}  ask-only ${pct(s.askOnly)}  n ${s.nResolved ?? 0}${thin(s)}`);
  console.log(`\n── GUARD STRATA (a guarded row's PRICE is not the level its probability was measured at) ──`);
  for (const s of guardStrata) console.log(`  ${s.label.padEnd(22)} entry ${pct(s.pBid)}  exit|entry ${pct(s.pAskGivenEntry)}  round trip ${pct(s.roundTrip)}  n ${s.nResolved ?? 0}${thin(s)}`);

  console.log(`\nHONESTY: touched/reached ≠ filled — no queue position, no partials, no competition at`);
  console.log(`the level, so every absolute rate bounds a real offer from ABOVE. One era, one update`);
  console.log(`cycle, band-dominated; CIs resample items. A random-offset null was tried and REJECTED`);
  console.log(`as a starting-price artifact — see the header before reinstating one.`);
  console.log(`This GATES NOTHING — threshold work belongs to F1.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
