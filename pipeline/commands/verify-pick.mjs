#!/usr/bin/env node
// @does One PASS/FAIL/UNKNOWN line per pick: fresh trio at your bid and ask, print age, break-even, buy limit
// @ask "verify X at bid/ask", "is this pick still good?", "re-check my picks" => "<item>@<bid>:<ask>[@<flip-niche>]" [...] [--why]
// @ask "verify the whole scan", "does anything clear?" => --scan [N] [--all]
// @read run in the same turn as the rec; pitch only a PASS (no fill guarantee)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API, jget, loadMapping, fetchLatest, fetchTs } from '../lib/market/marketfetch.mjs';
import { parseGp } from '../lib/render/cli.mjs';
import { ageMin, STALE_MIN } from '../lib/render/last-report-rows.mjs';
import { limitWindow, buysByItem } from '../lib/capital/limits.mjs';
import { LOG_DIR } from '../lib/reconstruct/offers.mjs';
import { regenerate } from './sync-fills.mjs';
import { windowStats, hourProfile, reachMargin, reachMarginTrigger, recencySplit, RECENT_NIGHTS, floorCeilingTrack, formatFloorCeiling } from '../../js/windowread.mjs';
import { breakEven, QUICK_FRESH_MIN } from '../../js/quotecore.js';
import { netMargin, isBond } from '../../js/money-math.js';
import { MODE_KEYS } from '../../js/flip-niches.mjs';

const TRIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'read-window-range.mjs');
const USAGE = `usage: node pipeline/commands/verify-pick.mjs "<item>@<bid>:<ask>[@<flip-niche>]" [...more] [--why]   niche: ${MODE_KEYS.join('|')} (default band)
       node pipeline/commands/verify-pick.mjs --scan [N] [--all] [--why]   the last scan's digest, churn and band rows (default all; N = top N)`;
const TRIO_NICHES = ['band', 'churn', 'scalp'];
const fin = Number.isFinite;
const fmt = n => fin(n) ? n.toLocaleString('en-US') : '—';
const signed = n => fin(n) ? (n < 0 ? '−' : '+') + fmt(Math.abs(n)) : '—';

export function parsePick(text) {
  const m = /^([^@]+)@([^:@]+):([^:@]+)(?:@([^:@]+))?$/.exec(text);
  if (!m || !m[1].trim()) return null;
  const bid = parseGp(m[2]), ask = parseGp(m[3]), niche = m[4] ? m[4].trim().toLowerCase() : 'band';
  return bid > 0 && ask > 0 && MODE_KEYS.includes(niche) ? { item: m[1].trim(), bid, ask, niche } : null;
}

// A rule returns {} (clean), { fail } or { unknown }.
const worst = parts => ['fail', 'unknown'].map(k => ({ [k]: parts.map(p => p[k]).filter(Boolean).join(', ') })).find(r => r.fail || r.unknown) || {};
const WINDOWS = [['peak', 'in peak'], ['day', 'all-day']];

export function staleLivePrint(f) {
  return worst([['instasell', 'low', 'lowAgeMin'], ['instabuy', 'high', 'highAgeMin']].map(([name, px, age]) =>
    !fin(f.live?.[px]) || !fin(f.live[age]) ? { unknown: `no live ${name} print` }
      : f.live[age] > QUICK_FRESH_MIN ? { fail: `stale live print: ${name} ${Math.ceil(f.live[age])}m old` } : {}));
}

function trigger(f, side, label, windows = WINDOWS) {
  return worst(windows.map(([k, where]) => {
    const rm = f[k]?.[side]?.rm, t = reachMarginTrigger(rm);
    if (t == null) return { unknown: `${side} ${where}: no live pace to test the ⚠⚠ trigger` };
    return t ? { fail: `⚠⚠ ${label} ${where}: cushion now ${signed(rm.cushionNow)}${rm.trend === 'fading' ? ' FADING' : ''}, live ${fmt(rm.pace.liveNow)} vs hour median ${fmt(rm.pace.medianAtHour)}` } : {};
  }));
}
export function sellEarlyTrigger(f) { return trigger(f, 'ask', 'sell-early trigger on the ask'); }
export function bidPullingAway(f) { return trigger(f, 'bid', 'market pulling away from the bid', [['day', 'all-day']]); }

export function foldUnderBreakEven(f) {
  const fold = f.fold;
  if (!fin(f.be)) return { unknown: 'no break-even' };
  if (fold && fin(fold.estSellForward) && Math.round(fold.estSellForward) < f.be) return { fail: `fold list at ${fmt(Math.round(fold.estSellForward))} under BE ${fmt(f.be)}` };
  if (fold && fin(fold.estSell) && fold.estSell < f.be) return { fail: `reach-fold ${fmt(fold.estSell)} under BE ${fmt(f.be)}` };
  if (fold?.confidence?.beFloored) return { fail: `reach-fold floored at BE ${fmt(f.be)}` };
  if (!fold || !fold.confidence || !fin(fold.estSell)) return { unknown: 'no fold read' };
  return fin(fold.estSellForward) ? {} : { unknown: 'fold has no forward list-at' };
}

export function fadingBidAboveTodaysLow(f) {
  const trends = WINDOWS.map(([k]) => f[k]?.bid?.rm?.trend ?? null);
  if (trends.includes('fading')) {
    if (!fin(f.day?.todayLow)) return { unknown: "bid cushion FADING and today's low unknown" };
    return f.day.todayLow > f.bid ? { fail: `bid cushion FADING and today's low ${fmt(f.day.todayLow)} is above the bid ${fmt(f.bid)}` } : {};
  }
  return trends.includes(null) ? { unknown: 'bid cushion trend unknown' } : {};
}

export function exitRarelyPrints(f) {
  const a = f.peak?.ask;
  if (f.peak?.rarelyPrints === true) return { fail: `exit rarely prints in-window (${a?.hit ?? '—'}/${a?.n ?? '—'})` };
  return f.peak?.rarelyPrints === false ? {} : { unknown: 'exit reach not scored in-window' };
}

export function noMarginAfterTax(f) {
  if (!fin(f.net) || !fin(f.be)) return { unknown: 'break-even or net missing' };
  return f.net <= 0 || f.ask < f.be ? { fail: `no margin after tax: ask ${fmt(f.ask)} vs BE ${fmt(f.be)} (net ${signed(f.net)})` } : {};
}

export function bidAboveMaxBuy(f) {
  if (f.maxBuy === undefined) return { unknown: 'no --exit back-solve' };
  if (f.maxBuy === null) return { fail: `ask ${fmt(f.ask)} carries no profitable buy` };
  return f.bid > f.maxBuy ? { fail: `bid ${fmt(f.bid)} above max profitable buy ${fmt(f.maxBuy)}` } : {};
}

export function askAbovePeakLevel(f) {
  if (!fin(f.peak?.gap)) return { unknown: 'no peak-window level' };
  return f.peak.gap > 0 ? { fail: `ask ${fmt(f.peak.gap)} above the peak window's level ${fmt(f.peak.level)}` } : {};
}

export function staleReach(f) {
  return worst([['bid', 'day', 'all-day'], ['ask', 'day', 'all-day'], ['ask', 'peak', 'in peak']].map(([side, k, where]) => {
    const r = f[k]?.[side]?.recency;
    if (!r || !(r.fullN >= RECENT_NIGHTS + 2)) return { unknown: `${side} reach ${where} too thin to score` };
    return r.staleOptimistic ? { fail: `${side} reach ⚠ stale ${where} (recent ${r.recentHit}/${r.recentDays}, full ${r.fullHit}/${r.fullN})` } : {};
  }));
}

export function bidNotTouched(f) {
  const r = f.day?.bid?.recency;
  if (!r || !(r.recentDays > 0)) return { unknown: 'recent bid touches unknown' };
  if (r.recentHit > 0 || (fin(f.day.todayLow) && f.day.todayLow <= f.bid) || (fin(f.live?.low) && f.live.low <= f.bid)) return {};
  return { fail: `bid touched on 0/${r.recentDays} recent days and live ${fmt(f.live?.low)} is above it` };
}

export function buyLimitSpent(f) {
  if (!f.limit) return { unknown: 'buy limit left unknown' };
  if (f.limit.limit == null) return {};
  if (f.limit.remaining == null) return { unknown: 'buy limit left unknown' };
  return f.limit.remaining <= 0 ? { fail: `buy limit exhausted (${fmt(f.limit.boughtInWindow)}/${fmt(f.limit.limit)} this 4h window)` } : {};
}

export function noListedLimit(f) { return f.limit && f.limit.limit == null ? { fail: 'no buy limit listed (not unlimited)' } : {}; }

export function peakWindowMissing(f) { return f.peak?.resolved ? {} : { unknown: 'no peak window could be derived' }; }

export function nicheUnfolded(f) { return f.niche && !TRIO_NICHES.includes(f.niche) ? { fail: `niche ${f.niche}: read-window-range has no ${f.niche} fold, so the band fold judged this` } : {}; }

export function bondFee(f) { return f.bond ? { unknown: 'bond retrade fee not modelled here' } : {}; }

// WARN never changes the status: a skill caution, not one of the owner's FAIL conditions.
export const WARN_RULES = new Set([bidPullingAway, askAbovePeakLevel, staleReach, bidNotTouched, noListedLimit, nicheUnfolded]);
export const RULES = [staleLivePrint, sellEarlyTrigger, bidPullingAway, foldUnderBreakEven, fadingBidAboveTodaysLow, exitRarelyPrints,
  noMarginAfterTax, bidAboveMaxBuy, askAbovePeakLevel, staleReach, bidNotTouched, buyLimitSpent, noListedLimit, peakWindowMissing, bondFee, nicheUnfolded];

export function judge(f) {
  const gate = RULES.filter(r => !WARN_RULES.has(r)).map(r => r(f));
  const fails = gate.map(r => r.fail).filter(Boolean), unknowns = gate.map(r => r.unknown).filter(Boolean);
  const warns = RULES.filter(r => WARN_RULES.has(r)).map(r => r(f).fail).filter(Boolean);
  return { status: fails.length ? 'FAIL' : unknowns.length ? 'UNKNOWN' : 'PASS', fails, unknowns, warns };
}

const reach = l => l && fin(l.hit) && l.n > 0 ? `${l.hit}/${l.n}` : '—';
export function formatLine(f, j) {
  const left = fin(f.limit?.remaining) ? `${fmt(f.limit.remaining)} left` : 'limit left —';
  return [`${j.status} ${f.name} ${fmt(f.bid)}→${fmt(f.ask)} ${signed(f.net)} BE ${fmt(f.be)}`,
    `reach bid ${reach(f.day?.bid)} ask ${reach(f.day?.ask)} (peak ask ${reach(f.peak?.ask)})`, left,
    ...j.fails, ...(j.warns.length ? ['warn: ' + j.warns.join('; ')] : []), ...(j.unknowns.length ? ['unknown: ' + j.unknowns.join('; ')] : [])].join(' · ');
}

export function formatWhy(f) {
  const age = a => fin(a) ? `${Math.ceil(a)}m` : '—', w = f.peak?.window;
  const leg = l => `${reach(l)}, recent ${l?.recency ? `${l.recency.recentHit}/${l.recency.recentDays}` : '—'}, cushion ${l?.rm?.trend ?? '—'} ${signed(l?.rm?.cushionNow)}`;
  return [`live ${fmt(f.live?.low)} (${age(f.live?.lowAgeMin)}) / ${fmt(f.live?.high)} (${age(f.live?.highAgeMin)}) · today's low ${fmt(f.day?.todayLow)} · max buy ${fmt(f.maxBuy)}`,
    `all-day bid ${leg(f.day?.bid)} · ask ${leg(f.day?.ask)}`,
    `peak ${f.peak?.resolved ? `${w.start}:00–${w.end}:00` : '—'} level ${fmt(f.peak?.level)} (ask ${signed(f.peak?.gap)}) · bid ${leg(f.peak?.bid)} · ask ${leg(f.peak?.ask)}`,
    `fold ${fmt(f.fold?.estSell)} · list at ${fmt(f.fold?.estSellForward == null ? null : Math.round(f.fold.estSellForward))}`,
    ...(f.track ? [f.track] : []),
    ...RULES.map(r => { const x = r(f); return `${x.fail ? '✗' : x.unknown ? '?' : '✓'} ${r.name}${x.fail || x.unknown ? ': ' + (x.fail || x.unknown) : ''}`; }),
  ].map(s => '    ' + s).join('\n');
}

export function fieldsFrom({ name, bid, ask, niche = null, trio, series, latest, limit, bond = false, now = new Date() }) {
  const ageMin = t => fin(t) ? (now / 1000 - t) / 60 : null;
  const live = latest && { low: latest.low ?? null, high: latest.high ?? null, lowAgeMin: ageMin(latest.lowTime), highAgeMin: ageMin(latest.highTime) };
  const isStale = age => !(fin(age) && age <= QUICK_FRESH_MIN);
  const pace = live && { lo: live.low, hi: live.high, staleLo: isStale(live.lowAgeMin), staleHi: isStale(live.highAgeMin), loAgeMin: live.lowAgeMin, hiAgeMin: live.highAgeMin };
  const st = series?.length ? windowStats(series, { wStart: 0, wEnd: 0, now }) : null;
  const profile = st && hourProfile(series, { now });
  const dayLeg = (side, level) => {
    const recency = recencySplit(st.days, side, level);
    return { hit: recency.fullHit, n: recency.fullN, recency, rm: reachMargin(st.days, side, level, { profile, live: pace, now }) };
  };
  const trioLeg = (l, hit) => l ? { hit, n: l.nDays, recency: l.recency, rm: l.reachMargin } : null;
  const pk = trio?.windowScored?.peak;
  return {
    name, bid, ask, niche, bond, be: breakEven(bid), net: netMargin(bid, ask), maxBuy: trio?.exit?.maxBuy, live, fold: trio?.fold ?? null, limit,
    track: st ? formatFloorCeiling(floorCeilingTrack(st.days, { forming: st.forming }), fmt) : null,
    day: st && { bid: dayLeg('bid', bid), ask: dayLeg('ask', ask), todayLow: st.forming?.low ?? null },
    peak: trio ? { resolved: trio.window?.resolvedFrom === 'peak', window: trio.window, level: pk?.level, gap: pk?.user?.gap ?? null, rarelyPrints: trio.exit?.rarelyPrints,
      bid: trioLeg(trio.bid, trio.bid?.touchedDays), ask: trioLeg(trio.ask, trio.ask?.reachedDays) } : null,
  };
}

export const trioArgs = (id, { bid, ask, niche }) => [String(id), '--ask', String(ask), '--bid', String(bid), '--exit', String(ask), '--window', 'peak', '--profile', '--json', ...(TRIO_NICHES.includes(niche) ? ['--niche', niche] : [])];
async function runTrio(id, p) {
  const { stdout } = await promisify(execFile)(process.execPath, [TRIO, ...trioArgs(id, p)], { maxBuffer: 1 << 26, timeout: 60000 });
  return JSON.parse(stdout).items[0];
}

// null (limit UNKNOWN) when no desktop log was read; regenerate() exits the process on a missing dir.
function readBuys() {
  if (!fs.existsSync(LOG_DIR)) return null;
  try {
    const r = regenerate({ write: false, warn: false });
    return r.sources.length > (r.mobilePresent ? 1 : 0) ? buysByItem(r.merged) : null;
  } catch { return null; }
}

async function checkPick(p, { map, buys, latest = fetchLatest }) {
  const r = map?.resolve(p.item);
  if (!r) return { name: p.item + ' (not in the item mapping)', bid: p.bid, ask: p.ask, be: breakEven(p.bid), net: netMargin(p.bid, p.ask) };
  const or = v => v.catch(() => null);
  const [live, series, trio] = await Promise.all([or(latest(r.id)), or(fetchTs(r.id, '1h')), or(runTrio(r.id, p))]);
  return fieldsFrom({ name: r.name, bid: p.bid, ask: p.ask, niche: p.niche, trio, series, latest: live, bond: isBond(r.id),
    limit: buys && limitWindow({ buys: buys.get(r.id) || [], limit: map.byId[r.id]?.limit ?? null }) });
}

export const SCAN_BAND_DEFAULT = Infinity;
const SCAN_CONCURRENCY = 4;
const SCREEN_DUMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'last-report', 'screen.json');

export function dumpRefusal(payload, now = Date.now()) {
  const age = ageMin(payload?.generatedAt, now);
  if (!Array.isArray(payload?.laneRows)) return `no laneRows in the last scan dump${age == null ? '' : ` (${age}m old)`}: re-run the scan`;
  if (age == null) return 'the last scan dump has no readable age: re-run the scan';
  return now - Date.parse(payload.generatedAt) > STALE_MIN * 60000 ? `the last scan dump is ${age}m old (limit ${STALE_MIN}m): re-run the scan` : null;
}

// Equal gp (no capital: all 0) keeps the dump's wallet-free table order.
export function scanCandidates({ laneRows = [], digestRows = [] }, n = SCAN_BAND_DEFAULT) {
  const of = m => laneRows.filter(r => r.mode === m), gp = r => (r.netEach ?? 0) * (r.units ?? 0);
  const band = of('band').sort((a, b) => gp(b) - gp(a)).slice(0, n);
  const seen = new Map();
  for (const r of [...digestRows, ...of('churn'), ...band]) if (!seen.has(r.itemId + ':' + r.mode)) seen.set(r.itemId + ':' + r.mode, r);
  const isAmp = r => r.mode === 'amplitude', priced = r => r.bid > 0 && r.ask > 0;
  const rows = [...seen.values()].filter(r => !isAmp(r)), trade = rows.filter(r => !isBond(r.itemId));
  return {
    picks: trade.filter(priced), digest: digestRows.length, bandTotal: of('band').length, bonds: rows.length - trade.length, unpriced: trade.filter(r => !priced(r)).length,
    amplitude: new Set([...of('amplitude'), ...digestRows.filter(isAmp)].map(r => r.itemId)).size,
  };
}

export async function mapLimit(items, limit, fn) {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

const ruleWords = r => r.name.replace(/([A-Z])/g, ' $1').toLowerCase();
const leadingReason = f => ruleWords(RULES.find(r => !WARN_RULES.has(r) && r(f).fail));

// results: [{ row, f, j }]
export function scanReport(results, { all = false, why = false } = {}) {
  const of = s => results.filter(x => x.j.status === s);
  const passes = of('PASS'), fails = of('FAIL'), unknowns = of('UNKNOWN');
  const line = ({ row, f, j }) => [formatLine(f, j).replace(/^PASS/, j.warns.length ? 'PASS ⚠' : 'PASS') + ` · ${row.mode} ${row.grade ?? '—'}`, ...(why ? [formatWhy(f)] : [])];
  const counts = new Map();
  for (const { f } of fails) counts.set(leadingReason(f), (counts.get(leadingReason(f)) || 0) + 1);
  const tally = [...counts].sort((a, b) => b[1] - a[1]).map(([r, k]) => `${r} ${k}`).join(', ');
  return [
    ...(passes.length ? [] : [`⚠ nothing clears at screen prices (${results.length} checked${unknowns.length ? `, ${unknowns.length} UNKNOWN` : ''})`]),
    ...passes.filter(x => !x.j.warns.length).flatMap(line), ...passes.filter(x => x.j.warns.length).flatMap(line),
    `FAIL ${fails.length}${tally ? ': ' + tally : ''} · UNKNOWN ${unknowns.length}${unknowns.length ? ': ' + unknowns.map(x => x.f.name).join(', ') : ''}`,
    ...(all ? fails.flatMap(line) : []),
  ];
}

async function runScan(n, opts) {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(SCREEN_DUMP, 'utf8')); } catch { console.error('no readable scan dump: run the scan first'); process.exit(1); }
  const refusal = dumpRefusal(payload);
  if (refusal) { console.error(refusal); process.exit(1); }
  const c = scanCandidates(payload, n);
  const skipped = [`${c.amplitude} amplitude excluded`, c.bonds && `${c.bonds} bond skipped`, c.unpriced && `${c.unpriced} unpriced skipped`].filter(Boolean).join(', ');
  console.log(`scan dump ${ageMin(payload.generatedAt)}m old: checking ${c.picks.length} (${c.digest} digest + churn + top ${Math.min(n, c.bandTotal)} of ${c.bandTotal} band), ${skipped}`);
  const [map, bulk] = await Promise.all([loadMapping().catch(() => null), jget(API + '/latest').then(j => j.data, () => null)]);
  const ctx = { map, buys: readBuys(), latest: bulk ? async id => bulk[id] ?? null : fetchLatest };
  const results = await mapLimit(c.picks, SCAN_CONCURRENCY, async row => {
    const f = await checkPick({ item: map ? String(row.itemId) : row.name, bid: row.bid, ask: row.ask, niche: row.mode }, ctx);
    return { row, f, j: judge(f) };
  });
  console.log(scanReport(results, opts).join('\n'));
}

function scanArgs(args) {
  const rest = args.filter(a => !['--scan', '--all', '--why'].includes(a));
  if (rest.length > 1 || (rest.length && (!/^[1-9]\d*$/.test(rest[0]) || args[args.indexOf('--scan') + 1] !== rest[0]))) return null;
  return rest.length ? +rest[0] : SCAN_BAND_DEFAULT;
}

async function main() {
  const args = process.argv.slice(2), why = args.includes('--why');
  if (args.includes('--scan')) {
    const n = scanArgs(args);
    if (n == null) { console.error(USAGE); process.exit(1); }
    return runScan(n, { all: args.includes('--all'), why });
  }
  const picks = args.filter(a => a !== '--why').map(a => a.startsWith('--') ? null : parsePick(a));
  if (!picks.length || picks.includes(null)) { console.error(USAGE); process.exit(1); }
  const map = await loadMapping().catch(() => null), buys = readBuys();
  for (const p of picks) {
    const f = await checkPick(p, { map, buys });
    console.log(formatLine(f, judge(f)));
    if (why) console.log(formatWhy(f));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
