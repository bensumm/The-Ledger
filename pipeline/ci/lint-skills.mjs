#!/usr/bin/env node
/**
 * lint-skills.mjs — a HEURISTIC linter for the four market SKILL.md files (Pipeline-v2 P7).
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
 * Run: `node pipeline/ci/lint-skills.mjs`  (CI runs it in the cheap `checks` job).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // pipeline/ci -> repo root

export const SKILL_FILES = [
  '.claude/skills/scan/SKILL.md',
  '.claude/skills/positions/SKILL.md',
  '.claude/skills/overnight/SKILL.md',
  '.claude/skills/morning/SKILL.md',
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

export function lintFile(relPath) {
  const text = readFileSync(join(ROOT, relPath), 'utf8');
  const blocks = lintText(text);
  return { relPath, blocks, untagged: blocks.filter((b) => !b.tagged) };
}

function main() {
  let total = 0;
  let totalUntagged = 0;
  const offenders = [];

  for (const rel of SKILL_FILES) {
    const { blocks, untagged } = lintFile(rel);
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
