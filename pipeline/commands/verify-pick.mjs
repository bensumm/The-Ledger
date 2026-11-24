#!/usr/bin/env node
// @does One PASS/FAIL/UNKNOWN line per pick: fresh trio at your bid and ask, print age, break-even, buy limit
// @ask "verify X at bid/ask", "is this pick still good?", "re-check my picks" => "<item>@<bid>:<ask>" [...] [--why]
// @read run in the same turn as the rec; pitch only a PASS, which is not a fill guarantee
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMapping, fetchLatest, fetchTs } from '../lib/market/marketfetch.mjs';
import { parseGp } from '../lib/render/cli.mjs';
import { limitWindow, buysByItem } from '../lib/capital/limits.mjs';
import { LOG_DIR } from '../lib/reconstruct/offers.mjs';
import { regenerate } from './sync-fills.mjs';
import { windowStats, hourProfile, reachMargin, reachMarginTrigger, recencySplit, RECENT_NIGHTS, floorCeilingTrack, formatFloorCeiling } from '../../js/windowread.mjs';
import { breakEven, QUICK_FRESH_MIN } from '../../js/quotecore.js';
import { netMargin, isBond } from '../../js/money-math.js';

const TRIO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'read-window-range.mjs');
const USAGE = 'usage: node pipeline/commands/verify-pick.mjs "<item>@<bid>:<ask>" [...more] [--why]';
const fin = Number.isFinite;
const fmt = n => fin(n) ? n.toLocaleString('en-US') : '—';
const signed = n => fin(n) ? (n < 0 ? '−' : '+') + fmt(Math.abs(n)) : '—';

export function parsePick(text) {
  const m = /^([^@]+)@([^:@]+):([^:@]+)$/.exec(text);
  if (!m || !m[1].trim()) return null;
  const bid = parseGp(m[2]), ask = parseGp(m[3]);
  return bid > 0 && ask > 0 ? { item: m[1].trim(), bid, ask } : null;
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

export function bondFee(f) { return f.bond ? { unknown: 'bond retrade fee not modelled here' } : {}; }

// WARN never changes the status: a skill caution, not one of the owner's FAIL conditions.
export const WARN_RULES = new Set([bidPullingAway, askAbovePeakLevel, staleReach, bidNotTouched, noListedLimit]);
export const RULES = [staleLivePrint, sellEarlyTrigger, bidPullingAway, foldUnderBreakEven, fadingBidAboveTodaysLow, exitRarelyPrints,
  noMarginAfterTax, bidAboveMaxBuy, askAbovePeakLevel, staleReach, bidNotTouched, buyLimitSpent, noListedLimit, peakWindowMissing, bondFee];

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

export function fieldsFrom({ name, bid, ask, trio, series, latest, limit, bond = false, now = new Date() }) {
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
    name, bid, ask, bond, be: breakEven(bid), net: netMargin(bid, ask), maxBuy: trio?.exit?.maxBuy, live, fold: trio?.fold ?? null, limit,
    track: st ? formatFloorCeiling(floorCeilingTrack(st.days, { forming: st.forming }), fmt) : null,
    day: st && { bid: dayLeg('bid', bid), ask: dayLeg('ask', ask), todayLow: st.forming?.low ?? null },
    peak: trio ? { resolved: trio.window?.resolvedFrom === 'peak', window: trio.window, level: pk?.level, gap: pk?.user?.gap ?? null, rarelyPrints: trio.exit?.rarelyPrints,
      bid: trioLeg(trio.bid, trio.bid?.touchedDays), ask: trioLeg(trio.ask, trio.ask?.reachedDays) } : null,
  };
}

export const trioArgs = (id, { bid, ask }) => [String(id), '--ask', String(ask), '--bid', String(bid), '--exit', String(ask), '--window', 'peak', '--profile', '--json'];
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

async function main() {
  const args = process.argv.slice(2), why = args.includes('--why');
  const picks = args.filter(a => a !== '--why').map(a => a.startsWith('--') ? null : parsePick(a));
  if (!picks.length || picks.includes(null)) { console.error(USAGE); process.exit(1); }
  const map = await loadMapping().catch(() => null), buys = readBuys();
  for (const p of picks) {
    const r = map?.resolve(p.item);
    let f = { name: p.item + (r ? '' : ' (not in the item mapping)'), bid: p.bid, ask: p.ask, be: breakEven(p.bid), net: netMargin(p.bid, p.ask) };
    if (r) {
      const or = v => v.catch(() => null);
      const [latest, series, trio] = await Promise.all([or(fetchLatest(r.id)), or(fetchTs(r.id, '1h')), or(runTrio(r.id, p))]);
      f = fieldsFrom({ name: r.name, bid: p.bid, ask: p.ask, trio, series, latest, bond: isBond(r.id),
        limit: buys && limitWindow({ buys: buys.get(r.id) || [], limit: map.byId[r.id]?.limit ?? null }) });
    }
    console.log(formatLine(f, judge(f)));
    if (why) console.log(formatWhy(f));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
