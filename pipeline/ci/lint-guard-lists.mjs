#!/usr/bin/env node
/**
 * lint-guard-lists.mjs — the guard-list drift gate: every `pipeline/ci/*.mjs` the `checks` job runs
 * is NAMED in each doc enumerating that job, and every `pipeline/ci/…` path those docs name exists.
 *
 * SCOPE, before you widen or trust it: the registry is `checks.yml`, job-scoped to `checks`. It reads
 * that job's SCRIPT steps and not its inline ones, so it checks "pipeline/ci scripts in the checks
 * job" — never "the gating set". A guard claiming more than it reads is the class this one closes.
 *
 * GOVERNED_DOCS is hand-kept and underivable: only prose says whether a doc claims to enumerate the
 * job. `/ship` and `/analyze` are EXCLUDED — partial, purpose-built lists that would fail as written.
 * A new complete-list home must be added here; nothing detects that omission — the guard's blind spot.
 *
 * Structural only, no YAML dependency, no semantic/LLM check (`lint-docs.mjs`'s honesty note governs
 * here too): it proves a name is PRESENT, never that the prose around it is correct.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no secrets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const WORKFLOW = '.github/workflows/checks.yml';
const JOB = 'checks';

// Docs that claim to enumerate the `checks` job in full. See GOVERNED DOCS in the header for why
// this is hand-kept and why /ship and /analyze are not here.
export const GOVERNED_DOCS = [
  'CLAUDE.md',
  'docs/FLOW.md',
  '.claude/skills/cleanup/SKILL.md',
  'docs/ARCHITECTURE.md',
];

/**
 * The `run:` scripts of ONE job in a GitHub Actions workflow, found by indentation rather than a
 * YAML parse: a job key sits at exactly two spaces under `jobs:`, and its body is every line until
 * the next key at that same depth. Returns basenames, e.g. ['run-tests.mjs', …].
 */
export function gatingScripts(yaml, job = JOB) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^  ${job}:\\s*$`).test(l));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i])) { end = i; break; }       // next job key at the same depth
  }
  const body = lines.slice(start, end).join('\n');
  const found = [...body.matchAll(/node\s+pipeline\/ci\/([A-Za-z0-9._-]+\.mjs)/g)].map((m) => m[1]);
  return [...new Set(found)];
}

/** Every `pipeline/ci/<file>.mjs` path a doc names. Bare basenames are NOT matched — see header. */
export function citedCiPaths(text) {
  return [...new Set([...text.matchAll(/pipeline\/ci\/([A-Za-z0-9._-]+\.mjs)/g)].map((m) => m[1]))];
}

/**
 * Does `text` name this script? The `.mjs` suffix is OPTIONAL because the governed docs legitimately
 * differ — FLOW.md writes `check-imports`, CLAUDE.md writes `check-imports.mjs` — and both name it.
 * Requiring the suffix would fail a doc that is correct as written, which is the false-failure class
 * this guard exists to avoid; a loose match can only ever cost a missed omission, never a bad FAIL.
 */
export function namesScript(text, script) {
  const stem = script.replace(/\.mjs$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${stem}(\\.mjs)?\\b`).test(text);
}

export function auditDocs(root = ROOT, docs = GOVERNED_DOCS) {
  const yamlPath = join(root, WORKFLOW);
  if (!existsSync(yamlPath)) return { fatal: `workflow not found: ${WORKFLOW}`, gating: [], rows: [] };
  const gating = gatingScripts(readFileSync(yamlPath, 'utf8'));
  // A zero-length read here would let every doc pass vacuously: "0 missing" and "0 examined" are
  // indistinguishable downstream, so refuse rather than report clean.
  if (!gating.length) return { fatal: `no 'node pipeline/ci/*.mjs' steps found in the '${JOB}' job of ${WORKFLOW}`, gating, rows: [] };

  const rows = [];
  for (const doc of docs) {
    const p = join(root, doc);
    if (!existsSync(p)) { rows.push({ doc, unreadable: true, missing: [], stale: [] }); continue; }
    const text = readFileSync(p, 'utf8');
    rows.push({
      doc,
      unreadable: false,
      missing: gating.filter((s) => !namesScript(text, s)),
      stale: citedCiPaths(text).filter((s) => !existsSync(join(root, 'pipeline', 'ci', s))),
    });
  }
  return { fatal: null, gating, rows };
}

function main() {
  const i = process.argv.indexOf('--root');
  const root = i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : ROOT;
  const { fatal, gating, rows } = auditDocs(root);

  if (fatal) {
    console.error(`✗ guard-list lint FAILED — ${fatal}`);
    process.exit(1);
  }

  const bad = rows.filter((r) => r.unreadable || r.missing.length || r.stale.length);
  if (bad.length) {
    console.error(`\n✗ guard-list lint FAILED — a doc that enumerates the '${JOB}' job is out of date:`);
    for (const r of bad) {
      if (r.unreadable) { console.error(`  UNREADABLE: ${r.doc}`); continue; }
      for (const s of r.missing) console.error(`  MISSING from ${r.doc}: ${s} runs in the '${JOB}' job but the doc never names it`);
      for (const s of r.stale) console.error(`  STALE in ${r.doc}: pipeline/ci/${s} does not exist on disk`);
    }
    console.error(`\nName the guard in the doc (or drop the stale path). Docs checked: ${GOVERNED_DOCS.join(', ')}.`);
    process.exit(1);
  }

  console.log(`✓ guard-list lint passed — ${gating.length} pipeline/ci script(s) in the '${JOB}' job named by all ${rows.length} governed doc(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
