#!/usr/bin/env node
// @does Replays the crash-entry rules on archived dump events
// @ask "did buying the dump work?", "score the crash-entry rules" => [--items N]
// @read read its verdict line and plans/PLAN-CRASH-REPLAY.md first; every fill is an upper bound
/* join-crash-entry.mjs — CRX2 of plans/PLAN-CRASH-REPLAY.md: scores the crash-entry rules on per-item dump
 * events from the 1h archive (read-only, one bulk read). The spec, the win criterion and the null branch
 * are the plan's "Statistics and win criterion" section, registered before this ran:
 *   primary   — block P, big + 1–10m, ST-time vs RB1, paired per event, onset-day cluster bootstrap.
 *               "beats" iff the CI excludes 0 AND ST-time's own CI is > 0 AND the paired sign agrees at
 *               H_exit 3d and 14d. Anything else prints "no detectable edge".
 *   secondary — every other candidate vs RB1, Holm-corrected; never the headline.
 *   block R   — raids-4 is ONE cluster: point estimates and signs only, never an interval.
 *   refusal   — fewer than MIN_CLUSTERS onset days → no interval.
 * The persistence row is a sensitivity added after CRX1's sanity run saw it; it is NOT pre-registered.
 *
 * Run: node pipeline/commands/join-crash-entry.mjs [--json] [--items N] */
import { fileURLToPath } from 'node:url';
import * as archive from '../lib/market/archive.mjs';
import { loadMapping } from '../lib/market/marketfetch.mjs';
import { parseArgs } from '../lib/render/cli.mjs';
import { pairedClusterCI } from '../lib/signal/cluster-ci.mjs';
import {
  detectEvents, eventWindow, entriesFor, scoreEntries, scoreOracle, persistentOnset, pairedRows,
  classOf, CRASH_CLASSES, CRASH_MIN_PRICE, H_EXIT,
} from '../lib/market/crash-entry.mjs';

export const MIN_CLUSTERS = 8;
export const ALPHA = 0.05;
export const PRIMARY = ['ST-time', 'RB1'];
export const FAMILY = ['R0', 'R2', 'R3', 'R4', 'R5', 'ST-trigger'];
export const RULE_KEYS = ['RB0', 'RB1', 'RB1-00UTC', 'RB1-diurnal', 'RB2', ...FAMILY, 'ST-time'];
export const QTY1 = 'qty 1 (lot-size neutral)';
export const SIGN_EXIT_H = [3 * 24, 14 * 24];
export const SENSITIVITIES = [
  { key: 'bail high', opts: { bail: 'high' } },
  { key: 'strict volume (2×qty)', opts: { volMult: 2 } },
  { key: 'H_fill 6h', opts: { hFill: 6 } },
  { key: 'bid −1%', opts: { bidAdj: -0.01 } },
  { key: 'EX2 ladder exit', opts: { exit: 'EX2' } },
  { key: QTY1, opts: { unitQty: true } },
];
const ZERO = '__never';

/* Every rule and spec for one event, entries decided once at nowSec. */
export function scoreEvent(series, ev, nowSec, { limit = null } = {}) {
  const w = eventWindow(series, ev, { hExit: Math.max(H_EXIT, ...SIGN_EXIT_H) });
  const base = { limit };
  const entries = Object.fromEntries(RULE_KEYS.map(k => [k, entriesFor(w, ev, k, nowSec)]));
  const at = opts => Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, scoreEntries(w, ev, e, nowSec, { ...base, ...opts })]));
  const pair = (opts, e = entries, x = ev) => Object.fromEntries(PRIMARY.map(k => [k, scoreEntries(w, x, e[k], nowSec, { ...base, ...opts })]));
  const out = {
    primary: { ...at({}), oracle: scoreOracle(w, ev, nowSec, base) },
    horizons: Object.fromEntries(SIGN_EXIT_H.map(h => [h, pair({ hExit: h })])),
    sens: Object.fromEntries(SENSITIVITIES.map(s => [s.key, pair(s.opts)])),
    persist: null,
  };
  const pev = persistentOnset(w, ev, nowSec);
  if (pev) out.persist = pair({}, Object.fromEntries(PRIMARY.map(k => [k, entriesFor(w, pev, k, nowSec)])), pev);
  return out;
}

export function splitBlocks(events) {
  const ok = e => CRASH_CLASSES.includes(e.cls);
  return { P: events.filter(e => ok(e) && e.block === 'P'), R: events.filter(e => ok(e) && e.block === 'R') };
}

/* Holm step-down adjusted p-values, same order as the input; null stays null. */
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => p != null).sort((a, b) => a[0] - b[0]);
  const out = ps.map(() => null), m = idx.length;
  let run = 0;
  idx.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (m - r) * p)); out[i] = run; });
  return out;
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const withZero = results => results.map(r => ({ ...r, per: { ...r.per, [ZERO]: { status: 'entered', frac: 0 } } }));

/* Paired contrast a − b over events where both legs resolved; refuses an interval below minClusters onset days. */
export function contrast(results, a, b, { minClusters = MIN_CLUSTERS } = {}) {
  const rows = pairedRows(results, a, b);
  const clusters = new Set(rows.map(r => r.rec.itemId)).size;
  const point = mean(rows.map(r => r.per[a].edgeFrac - r.per[b].edgeFrac));
  const base = { a, b, n: rows.length, clusters, point, pending: results.length - rows.length };
  if (clusters < minClusters) return { ...base, refused: true };
  const ci = pairedClusterCI(rows, a, b);
  return ci ? { ...base, refused: false, lo: ci.lo, hi: ci.hi, p: ci.p } : { ...base, refused: true };
}

export const ownMean = (results, key, opts) => contrast(withZero(results), key, ZERO, opts);

export function enteredMean(results, key) {
  const xs = results.map(r => r.per[key]).filter(x => x && x.status === 'entered').map(x => x.frac);
  return { n: xs.length, mean: mean(xs) };
}

/* Every rule's own mean against doing nothing (no-entry = 0), Holm across the rules; never-enter is its own row. */
export function versusNothing(results) {
  const rows = RULE_KEYS.map(k => ({ key: k, own: ownMean(results, k), entered: enteredMean(results, k) }));
  const adj = holm(rows.map(x => (x.own.refused ? null : x.own.p)));
  const ruled = rows.map((x, i) => ({ ...x, pHolm: adj[i], beats: adj[i] != null && adj[i] <= ALPHA && x.own.lo > 0 }));
  const winners = ruled.filter(x => x.beats).map(x => x.key);
  return {
    rows: [{ key: 'never-enter', own: ownMean(results, ZERO), entered: { n: 0, mean: null }, pHolm: null, beats: false }, ...ruled],
    headline: winners.length ? `${winners.join(', ')} beat${winners.length === 1 ? 's' : ''} never-enter on block P` : 'No rule beats never-enter on block P',
  };
}

export function primaryVerdict(primary, own, signs) {
  const beats = !primary.refused && !own.refused && primary.lo > 0 && own.lo > 0 && signs.every(s => s != null && s.point > 0);
  return beats ? 'ST-time beats RB1' : 'no detectable edge';
}

/* Block R: point estimates only — one correlated block, so no interval is ever computed. */
export function caseSeries(results, key) {
  const done = results.map(r => r.per[key]).filter(x => x && x.status !== 'pending').map(x => x.frac).sort((a, b) => a - b);
  const q = f => (done.length ? done[Math.min(done.length - 1, Math.floor(f * done.length))] : null);
  return { key, n: done.length, pending: results.length - done.length, mean: mean(done), min: q(0), median: q(0.5), max: done.length ? done[done.length - 1] : null };
}

export function report(scored, { classes = CRASH_CLASSES } = {}) {
  const pick = (block, f, cls = classes) => scored.filter(s => s.ev.block === block && cls.includes(s.ev.cls)).map(s => ({ ev: s.ev, per: f(s) })).filter(r => r.per);
  const P = pick('P', s => s.primary), R = pick('R', s => s.primary);
  const primary = contrast(P, ...PRIMARY);
  const own = ownMean(P, 'ST-time');
  const signs = SIGN_EXIT_H.map(h => contrast(pick('P', s => s.horizons[h]), ...PRIMARY));
  const fam = FAMILY.map(k => contrast(P, k, 'RB1'));
  const adj = holm(fam.map(c => (c.refused ? null : c.p)));
  const family = fam.map((c, i) => ({ ...c, pHolm: adj[i], significant: adj[i] != null && adj[i] <= ALPHA }));
  const winner = primaryVerdict(primary, own, signs) !== 'no detectable edge' ? 'ST-time' : null;
  const keysR = ['RB0', 'RB1', 'RB1-00UTC', 'RB2', ...FAMILY, 'ST-time'];
  const nothing = versusNothing(P);
  const byClass = (f, classify, c) => scored.filter(s => s.ev.block === 'P' && classify(s.ev) === c).map(s => ({ ev: s.ev, per: f(s) })).filter(r => r.per);
  const onsetCls = ev => ev.cls, preDumpCls = ev => classOf(ev.refMax);
  return {
    headline: nothing.headline,
    nothing: nothing.rows,
    verdict: primaryVerdict(primary, own, signs),
    primary, own, ownBailHigh: ownMean(pick('P', s => s.sens['bail high']), 'ST-time'), signs: SIGN_EXIT_H.map((h, i) => ({ hExitH: h, ...signs[i] })),
    family,
    baselines: [
      { label: 'RB0 − RB1', ...contrast(P, 'RB0', 'RB1') },
      { label: 'RB2 − RB1-00UTC (clock-matched; fewer entries also count as a win here)', ...contrast(P, 'RB2', 'RB1-00UTC') },
      { label: 'never-enter − RB1-00UTC (the abstention yardstick for the row above)', ...contrast(withZero(P), ZERO, 'RB1-00UTC') },
      { label: 'RB1-00UTC − RB1 (clock alone)', ...contrast(P, 'RB1-00UTC', 'RB1') },
    ],
    oracle: { medians: Object.fromEntries(['oracle', 'ST-time', 'RB1'].map(k => [k, caseSeries(P, k).median])) },
    strata: [
      ...classes.map(c => ({ label: `class ${c}`, ...contrast(byClass(s => s.primary, onsetCls, c), ...PRIMARY) })),
      ...classes.map(c => ({ label: `class ${c}, ${QTY1}`, ...contrast(byClass(s => s.sens[QTY1], onsetCls, c), ...PRIMARY) })),
      ...classes.map(c => ({ label: `class ${c} keyed on pre-dump price`, ...contrast(byClass(s => s.primary, preDumpCls, c), ...PRIMARY) })),
    ],
    sensitivities: [
      { key: 'diurnal RB1', ...contrast(P, 'ST-time', 'RB1-diurnal') },
      ...SENSITIVITIES.map(s => ({ key: s.key, ...contrast(pick('P', x => x.sens[s.key]), ...PRIMARY) })),
      { key: 'persistent onset (NOT pre-registered)', ...contrast(pick('P', s => s.persist), ...PRIMARY) },
    ],
    blockR: {
      rules: keysR.map(k => caseSeries(R, k)),
      primary: contrast(R, ...PRIMARY, { minClusters: Infinity }),
      winner,
    },
    counts: ['P', 'R'].flatMap(b => classes.map(c => {
      const evs = scored.filter(s => s.ev.block === b && s.ev.cls === c);
      return { block: b, cls: c, events: evs.length, clusters: new Set(evs.map(s => s.ev.cluster)).size, persistent: evs.filter(s => s.persist).length };
    })),
  };
}

const pct = v => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
export const pTxt = p => (p === 0 ? '<0.001' : p.toFixed(3));
const ciTxt = c => (c.refused ? `no CI (${c.clusters} clusters < ${MIN_CLUSTERS})` : `[${pct(c.lo)}, ${pct(c.hi)}] p=${pTxt(c.p)}`);
const line = (label, c) => `  ${label.padEnd(44)} Δ ${pct(c.point).padStart(8)}  ${ciTxt(c)}  n=${c.n} clusters=${c.clusters}${c.pending ? ` (${c.pending} unresolved dropped)` : ''}`;

function render(r, meta) {
  const L = [];
  L.push(`VERDICT: ${r.headline}.`);
  L.push(`join-crash-entry — CRX2, 1h archive to ${meta.archiveEnd}; ${meta.items} items scanned.`);
  L.push('Block P is single-item repricings, NOT a crash; fills/reach are UPPER bounds; per-unit net fraction of fill.');
  L.push('', 'Events (big + 1–10m):');
  for (const c of r.counts) L.push(`  block ${c.block} ${c.cls.padEnd(6)} events ${c.events}  onset-day clusters ${c.clusters}  persistent ${c.persistent}`);
  L.push('', `PRIMARY (pre-registered) — ${r.verdict}`);
  L.push(line('ST-time − RB1 (H_exit 7d)', r.primary));
  L.push(line('ST-time own mean vs never-enter', r.own));
  L.push(line('ST-time own mean vs never-enter, bail high', r.ownBailHigh));
  for (const s of r.signs) L.push(line(`ST-time − RB1 (H_exit ${s.hExitH / 24}d)`, s));
  L.push('', `SECONDARY — vs RB1, Holm across ${FAMILY.length} (α ${ALPHA}); never the headline`);
  for (const c of r.family) L.push(`${line(`${c.a} − RB1`, c)}  pHolm=${c.pHolm == null ? '—' : c.pHolm.toFixed(3)}${c.significant ? ' *' : ''}`);
  L.push('', `VERSUS NEVER-ENTER — own mean (no-entry = 0), Holm across ${RULE_KEYS.length} rules; "entered" = mean over filled events only`);
  for (const x of r.nothing) L.push(`${line(x.key, x.own)}  entered ${pct(x.entered.mean)} (n=${x.entered.n})  pHolm=${x.pHolm == null ? '—' : pTxt(x.pHolm)}${x.beats ? ' *' : ''}`);
  L.push('', 'BASELINES (descriptive) — RB2 always enters at 00:00 UTC, so it is read against RB1 moved to that hour');
  for (const c of r.baselines) L.push(line(c.label, c));
  L.push('', 'ORACLE — trough entry under EX1; an UPPER bound on entry-timing headroom, not a rule');
  const md = r.oracle.medians;
  L.push(`  medians: oracle ${pct(md.oracle)}, ST-time ${pct(md['ST-time'])}, RB1 ${pct(md.RB1)} — the oracle entry is volume-free, so a one-unit lowball print can set it`);
  L.push('', 'SENSITIVITIES — primary contrast re-run; no claims');
  for (const s of r.strata) L.push(line(s.label, s));
  for (const s of r.sensitivities) L.push(line(s.key, s));
  L.push('', 'BLOCK R (raids-4) — ONE correlated block: point estimates only, never an interval');
  for (const x of r.blockR.rules) L.push(`  ${x.key.padEnd(12)} mean ${pct(x.mean).padStart(8)}  min ${pct(x.min)}  median ${pct(x.median)}  max ${pct(x.max)}  resolved ${x.n}  unresolved ${x.pending}`);
  const sg = r.blockR.primary.point;
  L.push(`  ST-time − RB1 on block R: ${pct(sg)} (sign ${sg > 0 ? '+' : sg < 0 ? '−' : '0/none'}) over n=${r.blockR.primary.n}${r.blockR.winner ? '' : '; no block-P winner to transfer'}`);
  L.push('  Block R outcomes are incomplete until every onset has 14d of history (re-run on or after 2026-11-13).');
  return L.join('\n');
}

const SQL = `SELECT itemId, ts, avgHighPrice, avgLowPrice, highPriceVolume, lowPriceVolume FROM observations
  WHERE grain = '1h' AND itemId IN (SELECT itemId FROM observations WHERE grain = '1h' GROUP BY itemId HAVING MAX(avgHighPrice) >= ?)
  ORDER BY itemId, ts`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = archive.open(archive.DEFAULT_DB, { readonly: true });
  const last = db.db.prepare("SELECT MAX(ts) AS m FROM buckets WHERE grain = '1h'").get().m;
  const nowSec = last + 3600;
  const bySeries = new Map();
  for (const r of db.db.prepare(SQL).all(CRASH_MIN_PRICE)) {
    if (!bySeries.has(r.itemId)) bySeries.set(r.itemId, []);
    bySeries.get(r.itemId).push({ ts: r.ts, avgHighPrice: r.avgHighPrice, avgLowPrice: r.avgLowPrice, highPriceVolume: r.highPriceVolume, lowPriceVolume: r.lowPriceVolume });
  }
  let mapping = null;
  try { mapping = await loadMapping(); } catch { mapping = null; }
  const ids = [...bySeries.keys()].slice(0, args.items ? Number(args.items) : undefined);
  const { P, R } = splitBlocks(ids.flatMap(id => detectEvents(bySeries.get(id), nowSec, { itemId: id })));
  const scored = [...P, ...R].map(ev => {
    const limit = mapping?.byId?.[ev.itemId]?.limit ?? null;
    return { ev, limit, ...scoreEvent(bySeries.get(ev.itemId), ev, nowSec, { limit }) };
  });
  const r = report(scored);
  const meta = { archiveEnd: new Date(last * 1000).toISOString(), items: ids.length, mapping: !!mapping };
  if (args.json) console.log(JSON.stringify({ meta, ...r }, null, 2));
  else console.log(render(r, meta) + (mapping ? '' : '\n  (no buy-limit mapping available — 1–10m qty capped by capital only)'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
