#!/usr/bin/env node
/**
 * lint-skills.mjs — a HEURISTIC linter for every SKILL.md under `.claude/skills/` (Pipeline-v2 P7).
 *
 * WHY: Ben's standing rule (2026-07-08, memory `docs-small-encode-in-scripts`) — prefer
 * encoding judgment in scripts/validators over prose; keep prose honest about which kind it is.
 * A skill "rule-block" is either (a) something a module/test now ENFORCES (so it should point at
 * that code, not restate it) or (b) a genuine JUDGMENT call the LLM/Ben makes (so it should say
 * so, explicitly). This linter makes UNTAGGED prose growth VISIBLE and fails CI on it, so the
 * three-way triage in `docs/SKILL-TRIAGE.md` can't silently rot as skills grow.
 *
 * THE CONVENTION (cheap + structural, deliberately not a markdown parser):
 *   - A RULE-BLOCK is a TOP-LEVEL list item whose visible text begins with a bolded lead-in —
 *     a line matching  `- **…**`  (the "bolded imperative" convention). Nested bullets and
 *     continuation paragraphs belong to the block they sit under; they are NOT separate blocks.
 *   - A rule-block is TAGGED if its text (the bullet + everything until the next top-level
 *     bullet / heading) contains EITHER:
 *       1. a backticked CODE POINTER — a `…` span ending in a source extension
 *          (.mjs/.js/.yml/.yaml/.json), e.g. `js/flip-niches.mjs`, `rating.mjs`; OR
 *       2. the explicit lowercase tag  `judgment:`  (the KEEP-AS-JUDGMENT marker).
 *   - Blocks inside ``` fenced code and the YAML frontmatter are ignored.
 *   - FAIL (exit 1) if any rule-block is untagged; print per-file + total counts always so
 *     growth is visible even on a green run.
 *
 * HONEST LIMITS (this is a heuristic, not a semantic checker — do not oversell it):
 *   - It cannot tell whether a cited script ACTUALLY enforces the rule; a block that merely
 *     mentions `read-window-range.mjs` as the tool it uses counts as pointed. The OR is intentional
 *     (Ben's spec) and the real semantic call lives in `docs/SKILL-TRIAGE.md`, hand-maintained.
 *   - It only recognises the `- **…**` top-level convention; a rule written as a bare paragraph
 *     or a sub-bullet is invisible to it. Keep material rules as top-level bolded bullets.
 *   - It is a GROWTH-VISIBILITY guard, not proof of correctness. A green lint means "every
 *     rule-block is at least labelled", never "the skills are right".
 *
 * SCOPE IS SELF-CHECKING — `SKILL_FILES` is a DECLARED list and `scopeDrift()` fails the run if it
 * disagrees with `.claude/skills/` in either direction. See that function for why the list stays.
 *
 * Run: `node pipeline/ci/lint-skills.mjs`  (CI runs it in the cheap `checks` job).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // pipeline/ci -> repo root

// The linted set — EVERY SKILL.md under .claude/skills/, kept honest by scopeDrift() below rather than
// by hand. book/schedule/ship joined 2026-07-26 (PLAN-CLEANUP-SKILL C11) once their rule-blocks were
// tagged.
export const SKILL_FILES = [
  '.claude/skills/scan/SKILL.md',
  '.claude/skills/positions/SKILL.md',
  '.claude/skills/overnight/SKILL.md',
  '.claude/skills/morning/SKILL.md',
  '.claude/skills/analyze/SKILL.md',
  '.claude/skills/cleanup/SKILL.md',
  '.claude/skills/book/SKILL.md',
  '.claude/skills/schedule/SKILL.md',
  '.claude/skills/ship/SKILL.md',
];

const RULE_BLOCK_RE = /^- \*\*/;              // top-level bullet, bold lead-in
const TOP_BULLET_RE = /^(?:- |\d+\. )/;        // any top-level list item (ends a block)
const HEADING_RE = /^#{1,6} /;                 // a heading (ends a block)
const FENCE_RE = /^```/;
const CODE_POINTER_RE = /`[^`]+\.(?:mjs|js|yml|yaml|json)`/; // a backticked source path
const JUDGMENT_TAG_RE = /judgment:/;

/**
 * Parse one SKILL.md's text into rule-blocks. Pure — takes text, returns
 * [{ line, lead, text, tagged }]. Exported for the test.
 */
export function lintText(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let inFence = false;
  let inFrontmatter = false;

  // Detect a leading YAML frontmatter block (--- … ---) and skip it.
  if (lines[0] && lines[0].trim() === '---') inFrontmatter = true;

  let current = null; // the open rule-block, or null
  const closeCurrent = () => {
    if (current) {
      const text = current.buf.join('\n');
      blocks.push({
        line: current.line,
        lead: current.lead,
        tagged: CODE_POINTER_RE.test(text) || JUDGMENT_TAG_RE.test(text),
      });
      current = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (inFrontmatter) {
      if (i > 0 && raw.trim() === '---') inFrontmatter = false;
      continue;
    }
    if (FENCE_RE.test(raw)) {
      // A fence boundary ends any open block and toggles fence state.
      closeCurrent();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (current) current.buf.push(raw); // fenced text still belongs to an open block's extent
      continue;
    }

    // A new top-level bullet or heading closes the current block.
    if (TOP_BULLET_RE.test(raw) || HEADING_RE.test(raw)) {
      closeCurrent();
      if (RULE_BLOCK_RE.test(raw)) {
        const lead = (raw.match(/^- \*\*(.+?)\*\*/) || [, raw.slice(0, 60)])[1];
        current = { line: i + 1, lead: lead.trim(), buf: [raw] };
      }
      continue;
    }
    // Continuation / nested line belongs to the open block.
    if (current) current.buf.push(raw);
  }
  closeCurrent();
  return blocks;
}

export function lintFile(relPath, root = ROOT) {
  const text = readFileSync(join(root, relPath), 'utf8');
  const blocks = lintText(text);
  return { relPath, blocks, untagged: blocks.filter((b) => !b.tagged) };
}

/**
 * Compare the DECLARED SKILL_FILES against what is actually on disk, BOTH directions.
 * `unlisted` = a skill CI would silently never lint; `missing` = a stale entry whose readFileSync
 * would otherwise die with a raw ENOENT stack instead of naming the cause. Pure — returns the two
 * lists; the caller decides to fail. Exported for the test.
 *
 * WHY THE DECLARED LIST STAYS rather than just globbing the directory: it is the reviewable statement
 * of intent, and `lint-plan-lifecycle.mjs` imports it. But a guard trusting a hand-kept list is a guard
 * whose coverage can shrink to nothing while still printing green — this array's own comment named
 * that report as its backstop, and it is not in checks.yml, so nothing gating ever compared list to disk.
 */
export function scopeDrift(root = ROOT, declared = SKILL_FILES) {
  const skillsDir = join(root, '.claude', 'skills');
  // `missing` is computed by existsSync per DECLARED path and does not depend on this readdir, so an
  // unreadable skills dir must not suppress it — that would report clean and let main() fall through to
  // the raw ENOENT this function exists to replace. Only the `unlisted` half is unknowable here.
  let entries = [];
  try { entries = readdirSync(skillsDir, { withFileTypes: true }); } catch { entries = []; }
  const onDisk = entries
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
    .map((e) => `.claude/skills/${e.name}/SKILL.md`);
  const declaredSet = new Set(declared);
  return {
    unlisted: onDisk.filter((p) => !declaredSet.has(p)).sort(),
    missing: declared.filter((p) => !existsSync(join(root, p))).sort(),
  };
}

function main() {
  // `--root <dir>` retargets the whole run at a fixture tree. It exists so the TEST can drive main()
  // itself: without it the only reachable assertion is that the exported helper computes the right
  // lists, which a gate that ignores those lists would still satisfy. That is not hypothetical — the
  // first version of this file's test passed with the failure branch below stubbed out to `if (false)`.
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg >= 0 && rootArg + 1 < process.argv.length ? process.argv[rootArg + 1] : ROOT;

  // Scope check FIRST: a wrong scope makes every count below meaningless, so there is no point
  // reporting "9 skills, 0 untagged" when the real answer is "10 skills, one never opened".
  const { unlisted, missing } = scopeDrift(root);
  if (unlisted.length || missing.length) {
    console.error('\n✗ skill-lint FAILED — SKILL_FILES no longer matches .claude/skills/:');
    for (const p of unlisted) console.error(`  NOT LINTED (on disk, absent from SKILL_FILES): ${p}`);
    for (const p of missing) console.error(`  STALE ENTRY (in SKILL_FILES, absent from disk): ${p}`);
    console.error('\nAdd the skill to SKILL_FILES (tagging its rule-blocks first), or drop the stale entry.');
    process.exit(1);
  }

  let total = 0;
  let totalUntagged = 0;
  const offenders = [];

  for (const rel of SKILL_FILES) {
    const { blocks, untagged } = lintFile(rel, root);
    total += blocks.length;
    totalUntagged += untagged.length;
    const flag = untagged.length ? `✗ ${untagged.length} UNTAGGED` : '✓';
    console.log(`${flag}  ${rel} — ${blocks.length} rule-block(s)`);
    for (const u of untagged) offenders.push(`  ${rel}:${u.line} — **${u.lead}**`);
  }

  console.log(`\nTotal: ${total} rule-block(s) across ${SKILL_FILES.length} skills; ${totalUntagged} untagged.`);
  if (totalUntagged) {
    console.error('\n✗ skill-lint FAILED — every rule-block needs a `code-pointer` OR a `judgment:` tag:');
    for (const o of offenders) console.error(o);
    console.error('\nSee docs/SKILL-TRIAGE.md for the disposition of each rule.');
    process.exit(1);
  }
  console.log('✓ skill-lint passed — every rule-block is tagged.');
}

// The `argv[1] &&` is load-bearing, not defensive noise: with no script path (a `node -e` import, some
// embedders) pathToFileURL(undefined) THROWS, so importing this module for SKILL_FILES — which
// lint-plan-lifecycle.mjs does — would die at load rather than skip main(). Same shape check-daemon-safety
// pins on the git-writer.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
