#!/usr/bin/env node
/* lint-budget.mjs — size ceilings that only come DOWN, and expiry dates on provisional features.
 *
 *   node pipeline/ci/lint-budget.mjs           check (CI)
 *   node pipeline/ci/lint-budget.mjs --bless   lower ceilings to current size (never raises one)
 *
 * (1) Every doc in `docs` has a byte ceiling: adding a line means removing one.
 * (2) `plans` caps the number of files in plans/.
 * (3) Every file carrying a provisional-api marker, and every listed inform-only feature, needs a
 *     `provisional.json` entry with a decideBy date and a passTest. Past the date CI fails until it is
 *     promoted or deleted; entries inside 14 days are listed as due soon.
 * CRLF is normalised before measuring, so Windows and CI agree.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const BUDGET = path.join(HERE, 'doc-budget.json');
const PROVISIONAL = path.join(HERE, 'provisional.json');
const MAX_HORIZON_DAYS = 120;
const MARKER = '@provisional-' + 'api';

export const docBytes = text => Buffer.byteLength(text.replace(/\r\n/g, '\n'), 'utf8');

export function checkDocs(budget, sizeOf, planCount) {
  const bad = [];
  for (const [f, cap] of Object.entries(budget.docs)) {
    const n = sizeOf(f);
    if (n != null && n > cap) bad.push(`${f}: ${n} bytes, ceiling ${cap} — remove ${n - cap} bytes (encode it or cut it)`);
  }
  if (planCount > budget.plans) bad.push(`plans/: ${planCount} files, ceiling ${budget.plans} — finish or delete one first`);
  return bad;
}

export function checkProvisional(entries, markedFiles, existing, todayMs) {
  const bad = [];
  const covered = new Set();
  for (const e of entries) {
    for (const k of ['id', 'decideBy', 'passTest']) if (!e[k]) bad.push(`provisional entry ${e.id || '?'}: missing ${k}`);
    const t = Date.parse(e.decideBy + 'T23:59:59Z');
    if (!Number.isFinite(t)) bad.push(`${e.id}: bad decideBy "${e.decideBy}"`);
    else if (t < todayMs) bad.push(`${e.id}: EXPIRED ${e.decideBy} — promote or delete it. Pass test: ${e.passTest}`);
    else if (t - todayMs > MAX_HORIZON_DAYS * 864e5) bad.push(`${e.id}: decideBy more than ${MAX_HORIZON_DAYS}d out`);
    for (const f of e.files || []) { covered.add(f); if (!existing(f)) bad.push(`${e.id}: ${f} no longer exists — drop the entry`); }
  }
  for (const f of markedFiles) if (!covered.has(f)) bad.push(`${f}: carries ${MARKER} but no provisional.json entry names it`);
  return bad;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out); else if (/\.(mjs|js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

function main() {
  const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; } };
  const sizeOf = f => { const t = read(f); return t == null ? null : docBytes(t); };
  const budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8'));
  const planCount = fs.existsSync(path.join(ROOT, 'plans')) ? fs.readdirSync(path.join(ROOT, 'plans')).filter(f => f.endsWith('.md')).length : 0;
  if (process.argv.includes('--bless')) {
    for (const f of Object.keys(budget.docs)) {
      const n = sizeOf(f);
      if (n == null) delete budget.docs[f]; else budget.docs[f] = Math.min(budget.docs[f], n);
    }
    budget.plans = Math.min(budget.plans, planCount);
    fs.writeFileSync(BUDGET, JSON.stringify(budget, null, 2) + '\n');
    console.log('doc budget lowered to current sizes');
    return;
  }
  // Skills and the durable docs may not dodge the ceiling by being new.
  const governed = ['CLAUDE.md', 'README.md', 'PLAN.md', 'pipeline/MONITORING.md', 'pipeline/FILLS-PIPELINE.md',
    ...fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`),
    ...fs.readdirSync(path.join(ROOT, '.claude', 'skills')).map(d => `.claude/skills/${d}/SKILL.md`).filter(f => read(f) != null)];
  const bad = governed.filter(f => budget.docs[f] == null).map(f => `${f}: no ceiling in doc-budget.json — add one`);
  bad.push(...checkDocs(budget, sizeOf, planCount));
  const marked = [...walk('js'), ...walk('pipeline/lib'), ...walk('pipeline/commands'), ...walk('pipeline/daemons')].filter(f => read(f).includes(MARKER));
  bad.push(...checkProvisional(JSON.parse(fs.readFileSync(PROVISIONAL, 'utf8')), marked, f => read(f) != null, Date.now()));
  for (const e of JSON.parse(fs.readFileSync(PROVISIONAL, 'utf8'))) {
    const left = Math.floor((Date.parse(e.decideBy + 'T23:59:59Z') - Date.now()) / 864e5);
    if (left >= 0 && left <= 14) console.log(`  due soon: ${e.id} in ${left}d — ${e.passTest}`);
  }
  if (bad.length) { console.error('✗ budget lint FAILED'); for (const b of bad) console.error('  ' + b); process.exit(1); }
  console.log(`✓ budget lint passed — ${governed.length} docs, ${planCount} plans, ${marked.length} provisional files within budget.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
