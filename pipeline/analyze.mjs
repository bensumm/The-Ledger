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
import { auditDataset, deriveCandidates, dipLoopAudit, askHeadroomAudit, hrs, gp, pct, ALWAYS_FIELDS, OPTIONAL_FIELDS } from './lib/analyze.mjs';

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
const dipLoop = dipLoopAudit(sug.rows, retroRows);   // DL2 — FLUSH firings ⇆ fills.json retro
const askHead = askHeadroomAudit(sug.rows, retroRows);   // Bar E — ask-headroom flags ⇆ fills.json retro

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
  dipLoop,
  askHead,
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

// ---- 4. Dip-loop (DL2 FLUSH) retro ------------------------------------------------------------------
// CANDIDATE-SURFACING ONLY (PLAN-ANALYZE boundary): emits evidence-with-n and POINTS AT F1; it never
// mutates DIP_LOOP_* — F1 (gated on O1 sample thresholds) owns any actual retune, exactly like §3.
console.log(`\n## 4. Dip-loop (DL2 FLUSH) retro — flush SIGNALS ⇆ fills.json (candidate-surfacing; F1 calibrates)`);
if (!dipLoop.n) {
  console.log(`  no flush signals logged yet (watch.mjs --dip) — n=0. The dip-loop retro is a PLACEHOLDER until signals accrue; nothing to flag for F1 (rule 4).`);
} else {
  console.log(`  ${dipLoop.n} flush signal(s) · ${dipLoop.nAlerted} alerted (liquid → headline FLUSH) · ${dipLoop.nSignalOnly} signal-only (illiquid/gated — DL3 input)`);
  const sep = dipLoop.separation;
  const sfmt = (a, b) => `${a != null ? Math.round(a).toLocaleString() : '—'} vs ${b != null ? Math.round(b).toLocaleString() : '—'}`;
  console.log(`  alerted split: ${dipLoop.nFillable} fillable (a buy filled within horizon) · ${dipLoop.nNotFillable} not-taken`);
  console.log(`  separation over ALERTED (fillable vs not-taken): dipScore ${sfmt(sep.dipScoreFillable, sep.dipScoreNotFillable)} · volDay ${sfmt(sep.volDayFillable, sep.volDayNotFillable)} · depth ${pct(sep.depthPctFillable)} vs ${pct(sep.depthPctNotFillable)}`);
  const so = dipLoop.signalOnlyDist;
  if (so.n) console.log(`  signal-only distribution (DL3 standing-bid input): n=${so.n} · depth ${pct(so.depthPct)} · volDay ${so.volDay != null ? Math.round(so.volDay).toLocaleString() : '—'} · dipScore ${so.dipScore != null ? Math.round(so.dipScore).toLocaleString() : '—'}`);
  for (const f of dipLoop.firings)
    console.log(`    - #${f.itemId} · ${f.alerted ? 'ALERTED' : 'signal-only (' + (f.gatedReason || 'gated') + ')'} · depth ${pct(f.depthPct)} · volDay ${f.volDay != null ? f.volDay.toLocaleString() : '—'} · bucket ${f.bucketVol != null ? f.bucketVol.toLocaleString() : '—'} · dipScore ${f.dipScore != null ? Math.round(f.dipScore).toLocaleString() : '—'} → ${f.outcome ?? 'not-taken'}${f.latencySec != null ? ` (${hrs(f.latencySec)})` : ''}`);
}
console.log(`  ⚠ n≈0 — DIP_LOOP_LIQUID_FLOOR / DIP_LOOP_FLUSH_PCT / dipScore are PLACEHOLDERS; this is a FLAG for F1 (analyze surfaces evidence, never retunes a constant), not a calibrated conclusion.`);
// TODO(DL2-follow): richer join — correlate the FALLING LEG (did the still-falling flush actually keep
// filling a resting bid?) + per-item episode duration; feed the signal-only distribution into DL3.

// §5 — Bar E ask-headroom retro (candidate-surfacing; F1 calibrates ASK_HEADROOM_* / the deferred widen).
console.log(`\n## 5. Ask-headroom (Bar E) retro — shave-gap flags ⇆ fills.json (candidate-surfacing; F1 calibrates)`);
if (!askHead.n) {
  console.log(`  no ask-headroom flags logged yet (quote/screen) — n=0. PLACEHOLDER until the robust p90 shaves a traded top on a surfaced row; nothing to flag for F1 (rule 4).`);
} else {
  console.log(`  ${askHead.n} shave-gap flag(s) · ${askHead.nTrusted} trusted (surfaced as a ladder note) · ${askHead.nUntrusted} untrusted (audit only — thin-flier path Bar E protects)`);
  console.log(`  trusted subset: mean gap ${pct(askHead.gapPctTrusted)} of the ask · mean net-leverage ${askHead.netLeverTrusted != null ? askHead.netLeverTrusted.toFixed(1) + '×' : '—'} · ${askHead.nTakenTrusted} taken → realized/u ${gp(askHead.realisedPerUnitTaken)}`);
  for (const r of askHead.trusted)
    console.log(`    - #${r.itemId} · gap +${r.gap != null ? r.gap.toLocaleString() : '—'} (raw top ${r.rawTop != null ? r.rawTop.toLocaleString() : '—'}) · bucket ${r.topBucketVol != null ? r.topBucketVol.toLocaleString() : '—'} u → ${r.outcome ?? 'not-taken'}${r.realisedPerUnit != null ? ` · realized/u ${gp(r.realisedPerUnit)}` : ''}`);
  console.log(`  NOTE: the STRICT "did the realized sell reach the raw top?" join needs the realized SELL price (the retro row is buy-keyed today) — a documented follow-up; this reports the trusted population + round-trip now.`);
}
console.log(`  ⚠ n≈0 — ASK_HEADROOM_MIN_PCT / RAWTOP_TRUST_BUCKET_VOL / ASK_HEADROOM_VOL_FLOOR are PLACEHOLDERS; this is a FLAG for F1 (analyze surfaces evidence, never retunes; the Option-B clamp-widen is F1's to graduate), not a calibrated conclusion.`);

console.log(`\n(read-only: suggestions ledger + fills.json + positions.json; nothing written, nothing fetched)`);
