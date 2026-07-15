#!/usr/bin/env node
/**
 * lint-skills.test.mjs — acceptance for the P7 heuristic skill linter.
 *
 * Pins the rule-block convention (`- **…**` top-level bullets), the two tag forms
 * (backticked code pointer OR `judgment:`), the frontmatter/fence exclusions, and — the
 * live regression guard — that the four real SKILL.md files currently lint clean.
 */
import assert from 'node:assert';
import { lintText, lintFile, SKILL_FILES } from '../ci/lint-skills.mjs';

let passed = 0;
const ok = (name, fn) => { fn(); console.log(`  ✓ ${name}`); passed++; };

// --- the convention: what counts as a rule-block -------------------------------------
ok('a top-level bold bullet is a rule-block; plain bullets are not', () => {
  const blocks = lintText([
    '- **A rule.** body text `pipeline/x.mjs`',
    '- a plain bullet, no bold lead — not a rule-block',
    '  - **nested bold** — not top-level, folded into no open block here',
  ].join('\n'));
  assert.strictEqual(blocks.length, 1, 'only the one top-level bold bullet counts');
  assert.strictEqual(blocks[0].tagged, true);
});

// --- tag form 1: a backticked code pointer -------------------------------------------
ok('a backticked source path tags the block (all extensions)', () => {
  for (const ptr of ['`js/flip-niches.mjs`', '`rating.mjs`', '`checks.yml`', '`screen.json`']) {
    const [b] = lintText(`- **Enforced rule.** enforced by ${ptr} at gate time`);
    assert.strictEqual(b.tagged, true, `${ptr} should tag`);
  }
});
ok('a script MENTIONED without a closing backtick after the ext does NOT tag', () => {
  // `windowrange.mjs --ask <x>` — the .mjs is not immediately before a closing backtick.
  const [b] = lintText('- **Method rule.** run `windowrange.mjs --ask <top>` before pitching');
  assert.strictEqual(b.tagged, false, 'heuristic requires the backtick to close right after the ext');
});

// --- tag form 2: the explicit judgment: tag ------------------------------------------
ok('the literal judgment: tag tags a block with no code pointer', () => {
  const [b] = lintText('- **Taste rule.** _(judgment: pricing call)_ nudge across the anchor');
  assert.strictEqual(b.tagged, true);
});
ok('an untagged rule-block is flagged', () => {
  const [b] = lintText('- **Bare rule.** prose with no pointer and no tag at all');
  assert.strictEqual(b.tagged, false);
});

// --- exclusions ----------------------------------------------------------------------
ok('YAML frontmatter is skipped', () => {
  const blocks = lintText([
    '---', 'name: x', 'version: 1.0', '---',
    '- **Real rule.** _(judgment: x)_ body',
  ].join('\n'));
  assert.strictEqual(blocks.length, 1);
});
ok('bullets inside fenced code are not rule-blocks', () => {
  const blocks = lintText([
    '- **Real rule.** _(judgment: x)_ body',
    '```', '- **not a rule, it is code**', '```',
  ].join('\n'));
  assert.strictEqual(blocks.length, 1);
});

// --- counting + degradation ----------------------------------------------------------
ok('mixed doc counts tagged and untagged correctly', () => {
  const blocks = lintText([
    '- **One.** `a.mjs`',
    '- **Two.** _(judgment: y)_',
    '- **Three.** untagged',
  ].join('\n'));
  assert.strictEqual(blocks.length, 3);
  assert.strictEqual(blocks.filter((b) => !b.tagged).length, 1);
});
ok('empty text yields no blocks (no throw)', () => {
  assert.deepStrictEqual(lintText(''), []);
});

// --- LIVE regression guard: the real skills must lint clean ---------------------------
ok('all four committed SKILL.md files are fully tagged', () => {
  for (const rel of SKILL_FILES) {
    const { blocks, untagged } = lintFile(rel);
    assert.ok(blocks.length > 0, `${rel} should have rule-blocks`);
    assert.strictEqual(untagged.length, 0, `${rel} has untagged rule-blocks: ${untagged.map((u) => u.lead).join(', ')}`);
  }
});

console.log(`\n✓ lint-skills.test.mjs — all ${passed} checks passed.`);
