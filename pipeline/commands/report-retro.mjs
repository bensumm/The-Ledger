#!/usr/bin/env node
/**
 * retrojoin.mjs — the RETRO-JOIN report (Pipeline v2, chunk P6a). The FOUNDATION slice of P6.
 *
 *   node pipeline/commands/report-retro.mjs           per-niche + per-path outcome accounting (default)
 *   node pipeline/commands/report-retro.mjs --json    dump the raw joined rows array to stdout (no aggregation)
 *
 * For EVERY suggestion row the tool ever logged (active suggestions.jsonl + pipeline/suggestions-
 * archive/*.jsonl, via the ONE shared readSuggestionLines), join FORWARD to fills.json BUY events
 * for the same item AFTER the suggestion and classify: filled (a buy fill at ≤ the suggested buy
 * within a per-mode horizon) / filled-worse (bought that item in the window but above the suggested
 * price) / not-taken (no buy fill in window — the DOMINANT class; most suggestions are never acted
 * on, and this report says so honestly). Where a closed FIFO round-trip exists, it adds the buy→sell
 * hold time + realized after-tax net.
 *
 * This is the ground-truth TTF calibrator the P6 ruling demands (realized suggestion→fill latency
 * from our own fills, NOT touch-proxies) and the per-niche "realized profit per unit of attention"
 * read that later decides the spread/band/churn consolidation question (PLAN.md Discovered). The
 * join logic is the PURE, fixture-tested pipeline/lib/retrojoin.mjs; this script is only IO + print.
 *
 * HONESTY (process rule 4): n is printed on EVERY aggregate; there are NO derived grades or
 * verdicts. The archive began accruing 2026-07-08, so the sample is weeks-cold and mostly not-taken
 * — the report's job is honest accounting, not conclusions.
 *
 * READ-ONLY. Reads fills.json + the suggestions ledger; writes NOTHING (no artifact, no ledger).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib/cli.mjs';
import { readSuggestionLines } from '../lib/suggestlog.mjs';
import { retroJoin, aggregateOutcomes } from '../lib/retrojoin.mjs';
import { fmt, fmtTurn } from '../../js/money-format.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const FILLS = path.join(ROOT, 'fills.json');

const A = parseArgs(process.argv.slice(2));
const JSON_OUT = !!A.json;

function loadFillsEvents() {
  if (!fs.existsSync(FILLS)) { console.error('fills.json not found at ' + FILLS); process.exit(1); }
  const events = (JSON.parse(fs.readFileSync(FILLS, 'utf8')).events || []);
  if (!events.length) { console.error('fills.json has no events.'); process.exit(1); }
  return events;
}
function loadSuggestions() {
  const out = [];
  for (const line of readSuggestionLines()) {
    if (!line.trim()) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (s.itemId == null || s.ts == null) continue;
    out.push(s);
  }
  return out;
}

const hrs = sec => sec == null ? '—' : fmtTurn(sec / 3600);
const gp = n => n == null ? '—' : (n >= 0 ? '+' : '') + fmt(n);

function printGroup(title, groups) {
  console.log(`\n## ${title}`);
  // one line per group, numbers-only, n on every aggregate
  const head = ['group', 'n', 'filled', 'worse', 'not-taken', 'taken%', 'ttf med [p25..p75] (n)', 'realised Σ (n)', 'per-attn', 'hold med'];
  const rows = groups.map(g => [
    g.key,
    String(g.n),
    String(g.filled),
    String(g.filledWorse),
    String(g.notTaken),
    g.takenRate != null ? Math.round(g.takenRate * 100) + '%' : '—',
    `${hrs(g.latencyMedianSec)} [${hrs(g.latencyP25Sec)}..${hrs(g.latencyP75Sec)}] (n=${g.latencyN})`,
    `${gp(g.realisedSum)} (n=${g.realisedN})`,
    g.realisedPerAttention != null ? gp(Math.round(g.realisedPerAttention)) : '—',
    `${hrs(g.holdMedianSec)} (n=${g.holdN})`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const fmtRow = r => r.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmtRow(head));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmtRow(r));
}

const events = loadFillsEvents();
const suggestions = loadSuggestions();
const { rows, meta } = retroJoin(suggestions, events);

if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const { perNiche, perPath } = aggregateOutcomes(rows);
const filled = rows.filter(r => r.outcome === 'filled').length;
const worse = rows.filter(r => r.outcome === 'filled-worse').length;
const notTaken = rows.filter(r => r.outcome === 'not-taken').length;

console.log(`# Retro-join — ${rows.length} suggestion rows × ${meta.nBuyOffers} buy offers (${meta.nClaimed} offers claimed)`);
console.log(`  outcome mix: filled ${filled} · filled-worse ${worse} · not-taken ${notTaken}` +
  (rows.length ? `  (${Math.round(notTaken / rows.length * 100)}% not-taken)` : ''));
console.log(`  horizons (NAMED PLACEHOLDERS): intraday ${hrs(meta.horizon.intradaySec)} (scalp/band/spread/churn) · multi-day ${hrs(meta.horizon.multidaySec)} (rising/value) · default ${hrs(meta.horizon.defaultSec)} (quote/positions)`);
console.log(`  ⚠ the suggestions archive began accruing 2026-07-08 — a mostly-not-taken sample is EXPECTED; n is printed on every aggregate, and there are deliberately NO grades/verdicts (process rule 4).`);

printGroup('Per niche (mode) — realized profit per unit of attention is the last two columns', perNiche);
printGroup('Per path (mode / inferred entry path) — rows predating P4c group under "(no-path)"', perPath);

console.log(`\n(read-only: fills.json + suggestions ledger; nothing written)`);
