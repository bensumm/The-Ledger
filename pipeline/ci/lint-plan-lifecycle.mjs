#!/usr/bin/env node
/**
 * lint-plan-lifecycle.mjs — a NON-GATING report for the /cleanup skill (PLAN-CLEANUP-SKILL C10+C11).
 *
 * WHY: `docs/PLANNING.md` states that a per-topic `PLAN-*.md` "folds into PLAN.md and is deleted the
 * moment its last chunk ships" — but nothing checked it (`lint-arch.mjs` checks the inverse: that files
 * a doc NAMES resolve). This gives that prose a cheap, repeatable data source so /cleanup doesn't
 * re-derive it by hand each run. It is a REPORT, not a gate — a plan doc legitimately stays open for a
 * while, so failing CI on it would fight the natural editing cadence. NEVER wired into checks.yml.
 *
 * TWO reports:
 *   C10 — for each `plans/PLAN-*.md` (excluding the root `PLAN.md`), read its Status line and flag it `review`
 *         when the status reads as fully-complete (SHIPPED|DONE|LANDED) with NO stated reason to still
 *         exist (PARTIAL|DEFERRED|PENDING|AWAITING|DRAFT) — i.e. a doc past its fold-in point.
 *   C11 — SKILL_FILES drift: which `.claude/skills/<name>/SKILL.md` exist on disk but are NOT in
 *         `lint-skills.mjs`'s `SKILL_FILES` array (so lint-skills silently doesn't cover them).
 *
 * STRUCTURAL only (regex on a Status line + a set-difference on filenames) — never semantic, same
 * discipline as `lint-docs.mjs`. Exit is ALWAYS 0. `--json` prints only the machine block.
 *
 * Run: `node pipeline/ci/lint-plan-lifecycle.mjs [--json]`
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SKILL_FILES } from './lint-skills.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // pipeline/ci -> repo root
const PLANS_DIR = join(ROOT, 'plans');   // per-topic PLAN-*.md live under plans/ (moved off the root 2026-07-26)

// A status reads COMPLETE if it carries a done-word, and STILL-OPEN if it carries any marker of
// remaining/deferred work. The open vocabulary is broader than the plan's illustrative
// {PARTIAL|DEFERRED|PENDING|AWAITING} on purpose: the guard MUST NOT flag a legitimately-open doc
// (PLAN-CLEANUP-SKILL §3.1 names "PARTIALLY LANDED" as a keep-alive case `\bPARTIAL\b` would miss,
// and real Status lines say "…LANDED; X open/remains/gated on accrual"). Kept structural — a word
// set, never semantic.
const COMPLETE_RE = /\b(SHIPPED|DONE|LANDED)\b/i;
const OPEN_RE = /\b(PARTIAL(?:LY)?|DEFERRED|PENDING|AWAITING|DRAFT|PROPOSAL|OPEN|REMAINS?|REMAIN|GATED|WIP)\b/i;

// Pull the first `Status:` line from a plan doc's head (first ~12 lines), with markdown bold/emphasis
// stripped so the regex sees plain words. Returns the cleaned status TEXT or null if none is present.
export function extractStatus(text) {
  const lines = text.split(/\r?\n/).slice(0, 12);
  for (const line of lines) {
    // Strip markdown emphasis BEFORE matching, not after. The old order anchored `^\s*Status:` against
    // the RAW line, so the extremely common `**Status: …**` form never matched and the plan silently
    // reported "(no Status line)" — three plans written 2026-08-07 all landed in that hole, and the
    // report is non-gating so nothing complained. A leading `#`/`>` is tolerated for the same reason.
    const bare = line.replace(/[*_`]/g, '');
    const m = bare.match(/^\s*(?:#{1,6}\s*|>\s*)?Status:\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

// A status is `review` (past its fold-in point) iff it reads as complete AND carries no open marker.
// A missing Status line is `ok` (can't judge it complete) — reported, not flagged.
export function classifyStatus(statusText) {
  if (statusText == null) return 'ok';
  return COMPLETE_RE.test(statusText) && !OPEN_RE.test(statusText) ? 'review' : 'ok';
}

// Scan the plans/ dir for PLAN-*.md (excluding PLAN.md, which stays at the repo root). Returns
// [{ path, statusLine, flag }]. `dir` is overridable for the fixture test; a missing dir → [].
export function scanPlans(dir = PLANS_DIR) {
  const out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }   // no plans/ dir → nothing to report
  for (const name of names) {
    if (!/^PLAN-.+\.md$/.test(name)) continue;
    if (name === 'PLAN.md') continue;
    let statusLine = null;
    try { statusLine = extractStatus(readFileSync(join(dir, name), 'utf8')); } catch { /* unreadable → null */ }
    out.push({ path: name, statusLine, flag: classifyStatus(statusLine) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// C11 — SKILL.md files on disk NOT in lint-skills' SKILL_FILES. Returns the sorted rel-path list.
export function skillDrift(root = ROOT, linted = SKILL_FILES) {
  const skillsDir = join(root, '.claude', 'skills');
  const present = [];
  let entries = [];
  try { entries = readdirSync(skillsDir, { withFileTypes: true }); } catch { return []; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const rel = `.claude/skills/${ent.name}/SKILL.md`;
    try { readFileSync(join(root, rel)); } catch { continue; } // dir without a SKILL.md → skip
    present.push(rel);
  }
  const lintedSet = new Set(linted);
  return present.filter((p) => !lintedSet.has(p)).sort();
}

function main() {
  const jsonOnly = process.argv.includes('--json');
  const plans = scanPlans();
  const unlisted = skillDrift();
  const payload = { plans, unlintedSkills: unlisted };

  if (jsonOnly) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`PLAN-*.md lifecycle — ${plans.length} plan doc(s) in plans/ (excluding the root PLAN.md):`);
  for (const p of plans) {
    const mark = p.flag === 'review' ? '⚑ REVIEW' : '·';
    console.log(`  ${mark}  ${p.path} — ${p.statusLine ?? '(no Status line)'}`);
  }
  const flagged = plans.filter((p) => p.flag === 'review');
  console.log(flagged.length
    ? `\n⚑ ${flagged.length} plan doc(s) read as complete with no deferred/partial marker — candidates to fold into PLAN.md + delete.`
    : '\n· No plan doc reads as unconditionally complete — none overdue for fold-in.');

  console.log(`\nlint-skills SKILL_FILES coverage — ${unlisted.length} skill(s) present on disk but NOT linted:`);
  if (unlisted.length) for (const s of unlisted) console.log(`  ⚑ ${s}`);
  else console.log('  · every .claude/skills/*/SKILL.md is in lint-skills.mjs SKILL_FILES.');

  console.log('\n--- JSON ---');
  console.log(JSON.stringify(payload));
  console.log('\n(non-gating report — exit 0 always; /cleanup reads this, CI does not run it.)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
