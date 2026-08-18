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
 *   C10 — for each `plans/PLAN-*.md` (excluding the root `PLAN.md`), read its Status BLOCK (the whole
 *         markdown paragraph, not the first line) and flag it `review` when the status reads as
 *         fully-complete (SHIPPED|DONE|LANDED) with NO stated reason to still exist — see OPEN_RE for
 *         the marker set, which includes negated completions ("not landed") — i.e. a doc past its
 *         fold-in point. A false `review` is the expensive direction: this report is what a plan
 *         REDUCE pass consults before DELETING a doc.
 *   C11 — SKILL_FILES drift: which `.claude/skills/<name>/SKILL.md` exist on disk but are NOT in
 *         `lint-skills.mjs`'s `SKILL_FILES` array. NOTE this report is no longer the only thing
 *         watching that: `lint-skills.mjs` now GATES its own scope (`scopeDrift`, both directions,
 *         in checks.yml), because this file is a non-gating report and never was in CI. Kept as the
 *         at-a-glance view alongside the other lifecycle columns; expect it to read clean.
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

// Markdown emphasis to drop so the word tests see plain words. `_` is deliberately NOT in the set:
// the stripped text is also what the report PRINTS, and stripping underscores turned the identifiers
// a status names into names that do not exist anywhere (`APP_VERSION` printed as `APPVERSION`), which
// a reader then greps for and cannot find. `_`-delimited italics around a done/open word would evade
// the tests, but `_` is a word character so `\b` never matched inside those anyway.
const EMPH_RE = /[*`]/g;

// A status reads COMPLETE if it carries a done-word, and STILL-OPEN if it carries any marker of
// remaining/deferred work. The open vocabulary is broader than the plan's illustrative
// {PARTIAL|DEFERRED|PENDING|AWAITING} on purpose: the guard MUST NOT flag a legitimately-open doc
// (PLAN-CLEANUP-SKILL §3.1 names "PARTIALLY LANDED" as a keep-alive case `\bPARTIAL\b` would miss,
// and real Status lines say "…LANDED; X open/remains/gated on accrual"). Kept structural — a word
// set, never semantic.
const COMPLETE_RE = /\b(SHIPPED|DONE|LANDED)\b/i;
// PARTLY is a separate stem from PARTIAL, not a suffix of it — `PLAN-DIGEST-SIGNAL-AND-SCAN-PERF`
// says "PARTLY SHIPPED" and was flagged as a fold candidate with SP2 still open.
// NEGATED completion is an open marker, not a complete one: COMPLETE_RE is a bare word test, so
// "Restart-blindness recovery SCOPED DOWN, not landed" satisfies `\bLANDED\b` and nominates a plan
// whose status says the work did NOT land. Matching the negation literally keeps this structural —
// still a word set, no semantics — and it must be listed here (not subtracted from COMPLETE_RE)
// because a status routinely carries both ("AF1–AF5 shipped; AF6 not yet built").
const OPEN_RE = new RegExp([
  '\\b(?:PARTIAL(?:LY)?|PARTLY|DEFERRED|PENDING|AWAITING|DRAFT|PROPOSAL|OPEN|REMAINS?|GATED|WIP',
  '|SHELVED|SCOPING|UNBUILT|HELD)\\b',
  '|\\b(?:NOT|NEVER)\\s+(?:YET\\s+)?(?:LANDED|SHIPPED|DONE|STARTED|BUILT|IMPLEMENTED|AUTHORISED|AUTHORIZED|ANSWERED)\\b',
].join(''), 'i');

// Pull the `Status:` BLOCK from a plan doc's head — the `Status:` line found in the first ~12 lines,
// plus every continuation line up to the end of that markdown paragraph. Returns the status TEXT, or
// null if none is present.
export function extractStatus(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    // Strip markdown emphasis BEFORE matching, not after. The old order anchored `^\s*Status:` against
    // the RAW line, so the extremely common `**Status: …**` form never matched and the plan silently
    // reported "(no Status line)" — three plans written 2026-08-07 all landed in that hole, and the
    // report is non-gating so nothing complained. A leading `#`/`>` is tolerated for the same reason.
    const bare = lines[i].replace(EMPH_RE, '');
    const m = bare.match(/^\s*(?:#{1,6}\s*|>\s*)?Status:\s*(.+)$/i);
    if (!m) continue;
    // Read the BLOCK, not just the line — the SECOND instance of this function's one failure mode.
    // A status is routinely written "SHIPPED — six chunks landed." / "AF6 and AF7 remain OPEN.", and
    // taking only the first line drops the open marker, so a plan with live work is flagged `review`
    // (a fold candidate). That direction of failure is the dangerous one: this report is what a plan
    // REDUCE pass consults before DELETING a doc — a false `ok` costs a re-read, a false `review`
    // costs a plan.
    //
    // Read to the PARAGRAPH terminator, with no line cap. A cap re-opens the same hole one line
    // further down: at a 3-continuation cap the real corpus put `OPEN: §10's five owner questions
    // were never answered` and `HELD for F1/retro-join` on line five of their own status blocks, and
    // both plans were nominated as fold candidates. A markdown status IS one paragraph, so the
    // terminator already bounds it and the cap only added a second, wrong bound.
    // NOTE the widened block cuts BOTH ways — the joined text is tested against COMPLETE_RE too, so a
    // continuation can newly satisfy the complete side as well. It is not a one-way bias toward
    // keeping a doc alive; it is simply the whole status instead of an arbitrary prefix of it.
    const parts = [m[1].trim()];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) break;
      if (/^\s*(?:#{1,6}\s|-{3,}|={3,}|\|)/.test(lines[j])) break;
      parts.push(lines[j].replace(EMPH_RE, '').trim());
    }
    return parts.join(' ').trim();
  }
  return null;
}

// The mirror of the negated-completion case: a status that says it has nothing left carries the word
// OPEN while meaning the opposite ("Nothing open here" — PLAN-OUTPUT-TABLE, a genuine fold candidate
// the bare word test kept alive). Scrubbed before the open test, not added to it. Both directions are
// literal phrase sets; neither reads meaning, and a phrasing outside the set still defeats them —
// which is why this stays a REPORT and the reader still opens the doc.
const NEG_OPEN_RE = /\b(?:NOTHING|NONE|NO)\s+(?:\w+\s+){0,2}?OPEN\b/gi;

// A status is `review` (past its fold-in point) iff it reads as complete AND carries no open marker.
// A missing Status line is `ok` (can't judge it complete) — reported, not flagged.
export function classifyStatus(statusText) {
  if (statusText == null) return 'ok';
  const scrubbed = statusText.replace(NEG_OPEN_RE, ' ');
  return COMPLETE_RE.test(scrubbed) && !OPEN_RE.test(scrubbed) ? 'review' : 'ok';
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
