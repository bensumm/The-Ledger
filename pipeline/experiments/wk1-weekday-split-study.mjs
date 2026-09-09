#!/usr/bin/env node
/**
 * wk1-weekday-split-study.mjs — WK1 (PLAN-WEEKLY-CYCLE §0 measurement 1, folded — full text via `git show 6d0d970:plans/PLAN-WEEKLY-CYCLE.md`):
 * is the amplitude lane's OWN walk-forward entry record weekday-structured?
 *
 * WHAT IT ANSWERS. The weekly-cycle plan measured a basket-level weekday price cycle (§1) whose
 * naive calendar backtest is EV-negative (§3). The aligned program (§0) asks a different question
 * first: do the entries the amplitude lane would actually have taken — `ampWalkForward` semantics,
 * levels fitted strictly pre-origin, trough-touch entry, 4d ask horizon — complete at different
 * rates depending on the LOCAL WEEKDAY the entry fired? If yes, day-scale phase carries information
 * the lane is blind to; if no, this record can't motivate the phase overlay and the program's weight
 * moves to measurement 3 (full-universe period+phase). DIAGNOSTIC ONLY: nothing here gates, sizes,
 * or auto-prices, and the weekday BUCKET is the diagnostic grain, not the shipped shape (§0 —
 * derived windows, not calendar buckets).
 *
 * ── PRE-REGISTERED DECISION RULE (written 2026-09-08 BEFORE the first run; plan §5) ──────────────
 * Statistic, on judged entries only (completed|missed; PENDING excluded, the ampWalkForward contract):
 *   S1 (pooled, calendar-aligned)  = Σ_d n_d·(p_d − p̄)²   over the 7 weekday buckets, all items pooled.
 *   S2 (item-aligned)              = Σ_i Σ_d n_{i,d}·(p_{i,d} − p̄_i)²  over items with ≥10 judged
 *                                    entries on ≥3 distinct weekdays — catches items whose trough
 *                                    days DIFFER (plan §4) and would cancel in the pooled view.
 * Null: permute outcome labels WITHIN each item across its judged entries (weekday labels fixed,
 * per-item base rates preserved), N=10,000 draws, seeded mulberry32(20260908) so reruns reproduce.
 * p = (1 + #{S* ≥ S}) / (1 + N), computed for S1 and S2 from the same draws.
 * Decision, α = 0.05 per statistic (two tests, so family-wise ≈0.10 — accepted, pre-registered:
 * they answer different questions and the output is a direction decision, not a shipped number):
 *   · either p < 0.05                          → "weekday structure exists in the lane's record" —
 *                                                 measurements 2–4 proceed.
 *   · both p ≥ 0.05 AND pooled judged ≥ 100    → "no structure at this grain" — measurement 2 is
 *                                                 NOT motivated by this record; the program decides
 *                                                 on measurement 3 (a different statistic: price
 *                                                 LEVEL phase over the universe), and if 3 is also
 *                                                 null the plan closes "measured, too thin, don't
 *                                                 build".
 *   · both p ≥ 0.05 AND pooled judged < 100    → UNDERPOWERED — no claim either way (the plan §1
 *                                                 note on the superseded n=2/weekday test is the
 *                                                 cautionary tale). Defer to measurement 3.
 * WEDNESDAY CAVEAT (pre-registered): Wednesday buckets carry the game-update confound (plan §6).
 * Any Wednesday-specific claim is DEFERRED to measurement 2; here Wednesday is one bucket of seven.
 * Everything outside the rule above — entry counts by weekday, per-item tables, mean net-if-completed
 * — is DESCRIPTIVE and decides nothing.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Mechanics. Items = watchlist.json ∪ the plan's five §1 items ∪ the DT1b validation four, resolved
 * via pipeline/.cache/mapping.cache.json (fails loudly on an unresolved name — floor-strategy
 * precedent; NOT runnable on a clean checkout: needs the local archive + populated mapping cache).
 * Per item: 1h archive series (READ-ONLY), the PRODUCTION `ampWalkForward` itself with the new
 * opt-in `collect:true` per-entry detail — NOT a reimplementation, so this study cannot disagree
 * with the shipped estimator by construction (the reimplementation-drift risk
 * amp-cycle-reproduction.mjs exists to police). Board-default params: horizonDays 4, askQ/bidQ 0.5.
 * Net-if-completed uses the canonical js/money-math.js tax(): ((ask − tax(ask)) − bid) / bid.
 * Entry counts per weekday are read against a ~uniform baseline (over ~100d every weekday offers
 * ~equal origin days), so raw counts are interpretable without an origin denominator.
 *
 * HONESTY. Touch proxies (1h avgLow/avgHigh), no queue/partial-fill/competition — rates are upper
 * bounds. Fit windows overlap across origins → effective n < judged. ONE archive era, one season.
 * Completion rate is the decision statistic; net columns inherit every §3 caveat (a miss has no
 * realized net here — modelling the miss is measurement 2's job, per the §0 check-in doctrine).
 *
 * Reads the archive READ-ONLY; writes nothing the pipeline reads. `--json <path>` dumps the tables.
 * Run: `node pipeline/experiments/wk1-weekday-split-study.mjs`
 */
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const { open } = await imp('pipeline/lib/market/archive.mjs');
const { archiveSeries } = await imp('pipeline/lib/market/archive-series.mjs');
const { ampWalkForward } = await imp('js/amplitudescreen.mjs');
const { tax } = await imp('js/money-math.js');

const PERM_N = 10_000;
const SEED = 20260908;
const ALPHA = 0.05;
const MIN_POOLED_JUDGED = 100;   // pre-registered power floor — below it the null branch may not fire
const S2_MIN_JUDGED = 10;        // per-item qualification for S2
const S2_MIN_WEEKDAYS = 3;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- item set ----------------------------------------------------------------------------------
const watchlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'watchlist.json'), 'utf8'));
const EXTRA = [
  'Nightmare staff', 'Venator ring',                       // plan §1 items not on the watchlist
  'Saturated heart', 'Virtus armour set', 'Masori chaps',  // DT1b validation set (Fury is watchlisted)
];
const wanted = [...new Set([...watchlist, ...EXTRA])];
const mapping = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline', '.cache', 'mapping.cache.json'), 'utf8'));
const byName = new Map(Object.entries(mapping).map(([id, m]) => [m.name, Number(id)]));
const unresolved = wanted.filter(n => !byName.has(n));
if (unresolved.length) { console.error(`FATAL: unresolved item names (mapping cache): ${unresolved.join(', ')}`); process.exit(1); }
const ITEMS = wanted.map(n => ({ id: byName.get(n), name: n }));

// ---- collect per-entry records off the PRODUCTION estimator ------------------------------------
// READONLY IS NON-NEGOTIABLE — a plain open() runs schema DDL against the multi-GB live DB.
const h = open(undefined, { readonly: true });
const perItem = [];
for (const it of ITEMS) {
  const series = archiveSeries(h, it.id, '1h', { days: 120 });
  const wf = ampWalkForward(series, { horizonDays: 4, collect: true });
  if (!wf || !wf.entriesDetail) continue;
  const recs = wf.entriesDetail.map(e => ({
    ...e,
    dow: new Date(e.entryTs * 1000).getDay(),   // LOCAL weekday — repo display convention
    netPct: e.outcome === 'completed' ? 100 * ((e.ask - tax(e.ask)) - e.bid) / e.bid : null,
  }));
  perItem.push({ ...it, wf, recs });
}
h.close?.();

// ---- statistics ---------------------------------------------------------------------------------
const judgedOf = recs => recs.filter(r => r.outcome !== 'pending');
function weekdayStat(recs) {          // Σ_d n_d (p_d − p̄)² over weekday buckets of judged entries
  const n = new Array(7).fill(0), c = new Array(7).fill(0);
  let N = 0, C = 0;
  for (const r of recs) { n[r.dow]++; N++; if (r.outcome === 'completed') { c[r.dow]++; C++; } }
  if (!N) return 0;
  const pbar = C / N;
  let s = 0;
  for (let d = 0; d < 7; d++) if (n[d]) { const p = c[d] / n[d]; s += n[d] * (p - pbar) * (p - pbar); }
  return s;
}
function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const itemJudged = perItem.map(it => ({ ...it, j: judgedOf(it.recs) })).filter(it => it.j.length > 0);
const s2Items = itemJudged.filter(it => it.j.length >= S2_MIN_JUDGED && new Set(it.j.map(r => r.dow)).size >= S2_MIN_WEEKDAYS);
const pooled = itemJudged.flatMap(it => it.j);

const S1obs = weekdayStat(pooled);
const S2obs = s2Items.reduce((s, it) => s + weekdayStat(it.j), 0);

// Null: permute outcomes WITHIN each item (weekday labels fixed) — same draws feed both statistics.
const rnd = mulberry32(SEED);
let ge1 = 0, ge2 = 0;
for (let k = 0; k < PERM_N; k++) {
  const permJ = itemJudged.map(it => {
    const outs = shuffled(it.j.map(r => r.outcome), rnd);
    return { ...it, j: it.j.map((r, i) => ({ dow: r.dow, outcome: outs[i] })) };
  });
  const s1 = weekdayStat(permJ.flatMap(it => it.j));
  const s2 = permJ.filter(it => s2Items.some(q => q.id === it.id)).reduce((s, it) => s + weekdayStat(it.j), 0);
  if (s1 >= S1obs) ge1++;
  if (s2 >= S2obs) ge2++;
}
const p1 = (1 + ge1) / (1 + PERM_N);
const p2 = (1 + ge2) / (1 + PERM_N);

// ---- report -------------------------------------------------------------------------------------
const fmt = (v, w = 6) => String(v).padStart(w);
const pct = v => v == null ? '   —  ' : (100 * v).toFixed(1).padStart(5) + '%';

console.log(`WK1 weekday-split of the ampWalkForward record — ${perItem.length} items with a scoreable record (of ${ITEMS.length} requested)`);
console.log(`params: horizon 4d, askQ/bidQ 0.5/0.5 (board defaults), 120d archive read, local weekdays\n`);

console.log('POOLED by entry weekday (judged = completed + missed; pending excluded):');
console.log('day | judged | completed | rate   | pending | mean net-if-completed');
const poolRows = [];
for (let d = 0; d < 7; d++) {
  const j = pooled.filter(r => r.dow === d);
  const comp = j.filter(r => r.outcome === 'completed');
  const pend = itemJudged.flatMap(it => it.recs).filter(r => r.dow === d && r.outcome === 'pending');
  const nets = comp.map(r => r.netPct).filter(v => v != null);
  const meanNet = nets.length ? nets.reduce((a, b) => a + b, 0) / nets.length : null;
  const flag = j.length && j.length < 10 ? ' ⚠ n<10' : '';
  poolRows.push({ day: DAYS[d], judged: j.length, completed: comp.length, rate: j.length ? comp.length / j.length : null, pending: pend.length, meanNetPct: meanNet });
  console.log(`${DAYS[d]} | ${fmt(j.length)} | ${fmt(comp.length, 9)} | ${pct(j.length ? comp.length / j.length : null)} | ${fmt(pend.length, 7)} | ${meanNet == null ? '—' : meanNet.toFixed(2) + '%'}${flag}`);
}
const NP = pooled.length, CP = pooled.filter(r => r.outcome === 'completed').length;
console.log(`ALL | ${fmt(NP)} | ${fmt(CP, 9)} | ${pct(NP ? CP / NP : null)}`);
console.log('(entry COUNTS per weekday are readable against a ~uniform baseline — every weekday offers ~equal origin days over the window)\n');

console.log(`PER-ITEM weekday completion (items with judged ≥ 20; cells "completed/judged", · = no entries, cells with judged < 10 are noise):`);
for (const it of itemJudged.filter(x => x.j.length >= 20).sort((a, b) => b.j.length - a.j.length)) {
  const cells = DAYS.map((_, d) => {
    const j = it.j.filter(r => r.dow === d);
    if (!j.length) return '   ·  ';
    return `${String(j.filter(r => r.outcome === 'completed').length).padStart(2)}/${String(j.length).padEnd(3)}`;
  });
  console.log(`${it.name.padEnd(30)} ${cells.join(' ')}  (judged ${it.j.length}, rate ${pct(it.j.filter(r => r.outcome === 'completed').length / it.j.length)})`);
}

// ---- descriptive: serial dependence + within-item-centered net (review follow-up F3/F4 — added
// AFTER the pre-registered run; reproducers for the prose numbers, they decide nothing). The
// independence baseline is PER-ITEM pairs-weighted (Σ p_i²+(1−p_i)² over consecutive-pair counts) —
// a pooled-rate baseline double-counts between-item heterogeneity (the F2 regression this encodes).
let agree = 0, pairs = 0, baseW = 0, denomW = 0;
for (const it of itemJudged) {
  const p = it.j.filter(r => r.outcome === 'completed').length / it.j.length;
  for (let i = 1; i < it.j.length; i++) {
    pairs++;
    if (it.j[i].outcome === it.j[i - 1].outcome) agree++;
    baseW += p * p + (1 - p) * (1 - p);
    denomW += 2 * p * (1 - p);
  }
}
const obsAgree = pairs ? agree / pairs : null;
const baseAgree = pairs ? baseW / pairs : null;
const rho = denomW ? (agree - baseW) / denomW : null;
const nEff = rho != null ? Math.round(NP * (1 - rho) / (1 + rho)) : null;
const seBucket = nEff ? Math.sqrt((CP / NP) * (1 - CP / NP) / (nEff / 7)) : null;
console.log('\nDESCRIPTIVE — serial dependence (the reproducer for the prose numbers; decides nothing):');
console.log(`  lag-1 outcome agreement (within item)        ${(100 * obsAgree).toFixed(1)}%  (${pairs} pairs)`);
console.log(`  independence baseline (per-item, pairs-wtd)  ${(100 * baseAgree).toFixed(1)}%`);
console.log(`  implied lag-1 correlation rho                ${rho.toFixed(2)}`);
console.log(`  effective n = N(1-rho)/(1+rho)               ~${nEff} (~${Math.round(nEff / 7)}/bucket → per-bucket se ~${(100 * seBucket).toFixed(1)}pp)`);
const centered = [];
for (const it of itemJudged) {
  const nets = it.recs.filter(r => r.netPct != null);
  if (nets.length < 2) continue;
  const m = nets.reduce((a, b) => a + b.netPct, 0) / nets.length;
  for (const r of nets) centered.push({ dow: r.dow, v: r.netPct - m });
}
const cline = DAYS.map((d, i) => {
  const vs = centered.filter(c => c.dow === i).map(c => c.v);
  if (!vs.length) return `${d} —`;
  const mu = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / Math.max(1, vs.length - 1));
  return `${d} ${mu >= 0 ? '+' : ''}${mu.toFixed(1)}±${(sd / Math.sqrt(vs.length)).toFixed(1)}`;
}).join('  ');
console.log(`  net-if-completed, WITHIN-ITEM CENTERED, by weekday (pp vs item mean ± se) — the raw
  net-by-weekday spread is item MIX, this is the de-mixed view: ${cline}`);

console.log(`\nPRE-REGISTERED TEST (${PERM_N} within-item permutations, seed ${SEED}):`);
console.log(`  S1 (pooled calendar-aligned)  = ${S1obs.toFixed(3)}   p = ${p1.toFixed(4)}`);
console.log(`  S2 (item-aligned, ${String(s2Items.length).padStart(2)} items)  = ${S2obs.toFixed(3)}   p = ${p2.toFixed(4)}`);
const structure = p1 < ALPHA || p2 < ALPHA;
let branch;
if (structure) branch = 'STRUCTURE EXISTS — measurements 2–4 proceed';
else if (NP >= MIN_POOLED_JUDGED) branch = 'NO STRUCTURE at this grain — measurement 2 not motivated by this record; measurement 3 decides the program';
else branch = `UNDERPOWERED (pooled judged ${NP} < ${MIN_POOLED_JUDGED}) — no claim; defer to measurement 3`;
console.log(`  BRANCH: ${branch}`);
console.log('  (Wednesday bucket carries the game-update confound — any Wed-specific claim is deferred to measurement 2.)');

const jsonAt = process.argv.indexOf('--json');
if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
  const out = {
    generatedAt: new Date().toISOString(), params: { horizonDays: 4, askQ: 0.5, bidQ: 0.5, days: 120, permN: PERM_N, seed: SEED },
    items: perItem.length, pooled: poolRows, S1: S1obs, p1, S2: S2obs, p2, s2Items: s2Items.map(i => i.name), branch,
    serial: { lag1Agree: obsAgree, indepBaseline: baseAgree, rho, nEff },
    perItem: itemJudged.map(it => ({ name: it.name, id: it.id, judged: it.j.length, completed: it.j.filter(r => r.outcome === 'completed').length })),
  };
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify(out, null, 2));
  console.log(`json → ${process.argv[jsonAt + 1]}`);
}
