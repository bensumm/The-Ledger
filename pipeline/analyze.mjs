#!/usr/bin/env node
/**
 * analyze.mjs — the ANALYSIS ENGINE (PLAN-ANALYZE chunk AZ1). READ-ONLY. IO + print shell.
 *
 *   node pipeline/analyze.mjs                whole-history audit + retro rollup + tuning candidates
 *   node pipeline/analyze.mjs --since 24     restrict the freshness/window audit to the last N hours
 *   node pipeline/analyze.mjs --json         emit the structured brief object (for the /analyze skill)
 *   node pipeline/analyze.mjs --min-n 30     override the candidate n-floor (default MIN_N_CANDIDATE)
 *
 * WHAT THIS IS — and is NOT. The mechanical half of the analysis construct: AUDIT the dataset's health,
 * ORCHESTRATE the already-built joins, derive FLAGGED tuning candidates. The `/analyze` skill (AZ2) is
 * the judgment half that interprets this brief into a retro + proposals.
 *
 * IT RE-IMPLEMENTS NOTHING (rule 8). The suggestion→fill retro is the PURE `retroJoin`/`aggregateOutcomes`
 * (lib/retrojoin.mjs); the audit/candidate logic is the PURE lib/analyze.mjs; the ledger read is the ONE
 * shared `readSuggestionLines` (active + monthly archives). The campaign/band-percentile join (outcomes.mjs)
 * is NOT re-run here — it fetches historical bands and is slow; AZ1 does a lightweight REBUILDABILITY PROXY
 * (inputs parse + positions.json fresh vs fills.json) and points the skill at `outcomes.mjs --report`.
 *
 * READ-ONLY like retrojoin.mjs: reads suggestions.jsonl (+ archives) + fills.json + positions.json and
 * writes NOTHING (no artifact, no ledger, no fetch). It must NEVER enter a commit/sync path.
 *
 * HONESTY (rule 4). Weeks-cold, mostly-not-taken sample (archive began 2026-07-08). Every aggregate prints
 * n; a candidate is a FLAG FOR F1 (the calibration home), never a calibrated conclusion; the n-gates live
 * in lib/analyze.mjs so the skill can't launder a thin signal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { readSuggestionLines } from './lib/suggestlog.mjs';
import { retroJoin, aggregateOutcomes } from './lib/retrojoin.mjs';
import { auditDataset, deriveCandidates, hrs, gp, pct, ALWAYS_FIELDS, OPTIONAL_FIELDS } from './lib/analyze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FILLS = path.join(ROOT, 'fills.json');
const POSITIONS = path.join(ROOT, 'positions.json');

const A = parseArgs(process.argv.slice(2));
const JSON_OUT = !!A.json;
const SINCE_H = A.since != null && A.since !== true ? Number(A.since) : null;
const MIN_N = A['min-n'] != null && A['min-n'] !== true ? Number(A['min-n']) : undefined;
const nowSec = Math.floor(Date.now() / 1000);

// ---- load (read-only) --------------------------------------------------------------------------------
function loadSuggestions() {
  const rows = []; let malformed = 0, noKey = 0;
  for (const line of readSuggestionLines()) {
    if (!line.trim()) continue;
    let s; try { s = JSON.parse(line); } catch { malformed++; continue; }
    if (s.itemId == null || s.ts == null) { noKey++; continue; }
    rows.push(s);
  }
  return { rows, malformed, noKey };
}
function loadJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// ---- run --------------------------------------------------------------------------------------------
const sug = loadSuggestions();
const fillsData = loadJson(FILLS);
const posData = loadJson(POSITIONS);
const fillsEvents = fillsData && Array.isArray(fillsData.events) ? fillsData.events : [];
const { rows: retroRows, meta: retroMeta } = retroJoin(sug.rows, fillsEvents);
const { perNiche, perPath } = aggregateOutcomes(retroRows);
const audit = auditDataset(sug, fillsData, posData, retroMeta, { nowSec, sinceH: SINCE_H });
const MIN_N_DEFAULT = 20;   // mirrors lib/analyze.mjs MIN_N_CANDIDATE (the deriveCandidates default when --min-n is absent)
const minN = MIN_N ?? MIN_N_DEFAULT;
const candidates = deriveCandidates(perNiche, sug, { minN: MIN_N });

const brief = {
  generatedAt: nowSec,
  audit,
  retro: {
    nSuggestions: retroMeta.nSuggestions, nBuyOffers: retroMeta.nBuyOffers, nClaimed: retroMeta.nClaimed,
    outcomeMix: {
      filled: retroRows.filter(r => r.outcome === 'filled').length,
      filledWorse: retroRows.filter(r => r.outcome === 'filled-worse').length,
      notTaken: retroRows.filter(r => r.outcome === 'not-taken').length,
    },
    perNiche, perPath,
  },
  candidates,
  minN,
};

if (JSON_OUT) { console.log(JSON.stringify(brief, null, 2)); process.exit(0); }

// ---- human report -----------------------------------------------------------------------------------
console.log(`# analyze — dataset audit + retro rollup + tuning candidates`);
console.log(`  ⚠ weeks-cold, mostly-not-taken sample (archive began 2026-07-08). Every aggregate carries n; candidates are FLAGS for F1, not conclusions (process rule 4).`);

console.log(`\n## 1. Dataset audit`);
console.log(`  ledger: ${audit.total} rows` +
  (audit.oldest != null ? ` · span ${hrs(nowSec - audit.oldest)}..${hrs(nowSec - audit.newest)} ago` : '') +
  (audit.inWindow != null ? ` · ${audit.inWindow} in last ${audit.sinceH}h` : ''));
console.log(`  by script: ` + Object.entries(audit.byScript).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`  always-fields: ` + ALWAYS_FIELDS.map(f => { const a = audit.fieldAudit.always[f]; return `${f} ${pct(a.prior)}→${pct(a.recent)}`; }).join(' · ') + `  (prior→recent presence)`);
console.log(`  optional-fields: ` + OPTIONAL_FIELDS.map(f => `${f} ${pct(audit.fieldAudit.optional[f])}`).join(' · '));
console.log(`  fills⇆ledger: ${audit.unattributed}/${audit.nBuy} filled buy offers un-attributed (${pct(audit.unattributedRate)})`);
const rb = audit.rebuild;
console.log(`  rebuildability: fills ${rb.fillsParsed ? 'ok' : 'MISSING'} · positions ${rb.positionsParsed ? 'ok' : 'MISSING'}` +
  (rb.positionsBehindFillsSec != null ? ` · positions ${hrs(rb.positionsBehindFillsSec)} behind fills` : ''));
if (audit.forward.length) { console.log(`  forward-data recommendations:`); for (const f of audit.forward) console.log(`    - ${f}`); }
if (audit.flags.length) { console.log(`  flags:`); for (const f of audit.flags) console.log(`    ${f.level === 'warn' ? '⚠' : 'ℹ'} ${f.msg}`); }
else console.log(`  flags: none`);

console.log(`\n## 2. Retro rollup (per niche — realized profit per unit of attention is the last columns)`);
const rollupHead = ['niche', 'n', 'taken%', 'filled', 'not-taken', 'ttf med (n)', 'realised Σ (n)', 'per-attn'];
const rollupRows = perNiche.map(g => [g.key, String(g.n), pct(g.takenRate), String(g.filled), String(g.notTaken),
  `${hrs(g.latencyMedianSec)} (n=${g.latencyN})`, `${gp(g.realisedSum)} (n=${g.realisedN})`,
  g.realisedPerAttention != null ? gp(Math.round(g.realisedPerAttention)) : '—']);
const w = rollupHead.map((h, i) => Math.max(h.length, ...rollupRows.map(r => r[i].length)));
const line = r => r.map((c, i) => c.padEnd(w[i])).join('  ');
console.log('  ' + line(rollupHead));
console.log('  ' + w.map(x => '-'.repeat(x)).join('  '));
for (const r of rollupRows) console.log('  ' + line(r));
console.log(`  (full band-percentile × liquidity fill-time cells: node pipeline/outcomes.mjs --report)`);

console.log(`\n## 3. Tuning candidates (n ≥ ${minN}; each is a flag for F1, never applied here)`);
const realCands = candidates.filter(c => c.kind === 'candidate');
if (!realCands.length) console.log(`  no anomaly cleared the n≥${minN} floor — nothing honestly tunable yet (a ~0% taken rate is the expected baseline, not a candidate).`);
const mark = { context: 'ℹ context', candidate: '• CANDIDATE', inform: 'ℹ inform' };
for (const c of candidates) { console.log(`  ${mark[c.kind] || '•'}: ${c.signal}`); console.log(`    → ${c.pointsAt}`); }

console.log(`\n(read-only: suggestions ledger + fills.json + positions.json; nothing written, nothing fetched)`);
