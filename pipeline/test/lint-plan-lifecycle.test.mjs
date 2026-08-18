#!/usr/bin/env node
/**
 * lint-plan-lifecycle.test.mjs — acceptance for the non-gating plan-lifecycle report (C10+C11).
 *
 * Pins: the Status-line extraction, the complete-vs-open classification (incl. the PARTIALLY /
 * open-work carve-outs that keep a legitimately-open doc from flagging), and the on-disk scans
 * (plan-doc discovery + SKILL_FILES drift) against DETERMINISTIC in-repo tmp fixtures — never the
 * live repo tree, so the suite can't flap as real plan docs come and go.
 */
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractStatus, classifyStatus, scanPlans, skillDrift,
} from '../ci/lint-plan-lifecycle.mjs';

let passed = 0;
const ok = (name, fn) => { fn(); console.log(`  ✓ ${name}`); passed++; };

// --- extractStatus -------------------------------------------------------------------
ok('extractStatus pulls the first Status line and strips markdown emphasis', () => {
  assert.strictEqual(
    extractStatus('# Title\n\nStatus: **SHIPPED** — done.\n\nbody'),
    'SHIPPED — done.',
  );
});
ok('extractStatus returns null when there is no Status line in the head', () => {
  assert.strictEqual(extractStatus('# Title\n\nsome prose, no status\n'), null);
});
ok('extractStatus ignores a Status line buried below the head window', () => {
  const body = ['# t', ...Array(20).fill('filler'), 'Status: DONE'].join('\n');
  assert.strictEqual(extractStatus(body), null);
});
ok('extractStatus reads the whole Status BLOCK, not just its first line', () => {
  // The live failure this pins: PLAN-DIURNAL-RECENCY-GUARD's status wrapped, the "Chunk 3 stays
  // deferred" clause landed on line 2, and reading one line flagged an explicitly-open plan as a
  // fold candidate — the one direction of failure that can cost a plan.
  assert.strictEqual(
    classifyStatus(extractStatus('Status: Chunks 1+2 SHIPPED.\nChunk 3 stays deferred.\n')),
    'ok',
  );
});
ok('the Status block ends at a blank line, a heading, a rule, or a table row', () => {
  // Each case pairs a line that MUST be read with one that must not, so the assertion fails on a
  // first-line-only reader too — a terminator test whose fixtures all collapse to the first line
  // passes just as happily with the bug in place, which is what the earlier version of this did.
  assert.strictEqual(extractStatus('Status: DONE.\nchunk 4 shipped.\n\nPENDING prose\n'), 'DONE. chunk 4 shipped.');
  assert.strictEqual(extractStatus('Status: DONE.\nchunk 4 shipped.\n## Open items\n'), 'DONE. chunk 4 shipped.');
  assert.strictEqual(extractStatus('Status: DONE.\nchunk 4 shipped.\n---\nDRAFT notes\n'), 'DONE. chunk 4 shipped.');
  assert.strictEqual(extractStatus('Status: DONE.\nchunk 4 shipped.\n| chunk | open |\n'), 'DONE. chunk 4 shipped.');
});
ok('a six-line status keeps its open marker — the real corpus shape, uncapped', () => {
  // The shape that broke the capped reader: PLAN-CAPITAL-EFFICIENCY-AND-DIGEST and PLAN-GRADE-REACH
  // both put the load-bearing clause on line FIVE of the block, past a 3-continuation cap, and both
  // were nominated as fold candidates with live work in them. No cap — the paragraph is the bound.
  const real = [
    'Status: **SHIPPED `1c03fd9` — all three workstreams**, plus POLISH 1+2.',
    'Two later supersessions: the digest now sorts on `rank`, not §3\'s `rankKey`,',
    'and W3-1/W3-2 reshaped the verdict + rank. Constants remain placeholders',
    'pending the retro join, which has not accrued enough rows to move them.',
    'OPEN: §10\'s five owner questions were never answered on the record —',
    'the build took the spec\'s stated defaults.',
  ].join('\n');
  assert.match(extractStatus(real), /five owner questions/);
  assert.strictEqual(classifyStatus(extractStatus(real)), 'ok');
});
ok('the reader stops at the paragraph, so later body prose cannot flip the classification', () => {
  const runaway = ['Status: DONE.', '', ...Array(20).fill('more prose'), 'PENDING'].join('\n');
  assert.strictEqual(classifyStatus(extractStatus(runaway)), 'review');
});
ok('underscored identifiers survive extraction — the report is what a reader greps', () => {
  // Stripping `_` as emphasis printed `APP_VERSION` as `APPVERSION`, a name that exists nowhere.
  assert.strictEqual(
    extractStatus('Status: **SHIPPED** — `PFILL_ASK_REACH_FLOOR` raised, no `APP_VERSION` bump.\n'),
    'SHIPPED — PFILL_ASK_REACH_FLOOR raised, no APP_VERSION bump.',
  );
});

// --- classifyStatus ------------------------------------------------------------------
ok('a bare done-word with no open marker flags review', () => {
  assert.strictEqual(classifyStatus('SHIPPED — all chunks landed.'), 'review');
  assert.strictEqual(classifyStatus('DONE.'), 'review');
});
ok('PARTIALLY LANDED is NOT flagged (the PLAN-ARCHITECTURE-COHERENCE keep-alive case)', () => {
  assert.strictEqual(classifyStatus('PARTIALLY LANDED (salvage subset) — ceb538b.'), 'ok');
});
ok('a landed-but-open status is not flagged', () => {
  assert.strictEqual(classifyStatus('Chunks A–E LANDED; F/G/H/I remain.'), 'ok');
  assert.strictEqual(classifyStatus('most chunks shipped; AC4 open (F1-gated).'), 'ok');
  assert.strictEqual(classifyStatus('WC1 + WC2 LANDED; WC3 gated on accrual.'), 'ok');
});
ok('PARTLY is its own stem — not caught by PARTIAL(LY)', () => {
  assert.strictEqual(classifyStatus('PARTLY SHIPPED — SP1 landed.'), 'ok');
});
ok('a NEGATED done-word is an open marker, not a complete one', () => {
  // `\bLANDED\b` matched "not landed" and nominated PLAN-COPILOT-IDEAS, whose status says the work
  // did not land. Literal negations, still a word set — no semantics.
  assert.strictEqual(classifyStatus('PB-1 LANDED. Restart-blindness recovery SCOPED DOWN, not landed.'), 'ok');
  assert.strictEqual(classifyStatus('Spec DONE; chunk 3 not yet built.'), 'ok');
  assert.strictEqual(classifyStatus('SHIPPED — the five owner questions were never answered.'), 'ok');
});
ok('HELD is an open marker', () => {
  // PLAN-GRADE-REACH: "Constants are PLACEHOLDERS (n≈14). HELD for F1/retro-join" — the only marker
  // on the line, and absent from the set it flagged a plan with a live gate on it.
  assert.strictEqual(classifyStatus('SHIPPED — HELD for F1/retro-join.'), 'ok');
});
ok('SHELVED / SCOPING / UNBUILT each decide on their own', () => {
  // Each of these was in the set but never the DECIDING marker on any real plan, so none had run.
  assert.strictEqual(classifyStatus('SHIPPED — follow-up SHELVED.'), 'ok');
  assert.strictEqual(classifyStatus('SHIPPED — successor still SCOPING.'), 'ok');
  assert.strictEqual(classifyStatus('SHIPPED — chunk 4 UNBUILT.'), 'ok');
});
ok('"Nothing open here" is not an open marker — the mirror of the negation case', () => {
  // PLAN-OUTPUT-TABLE is a genuine fold candidate whose status carries the word OPEN while meaning
  // the opposite; the bare word test kept it alive. Scrubbed, so it flags.
  assert.strictEqual(classifyStatus('SHIPPED 3b50b7b, including all three REVISIONS. Nothing open here.'), 'review');
  assert.strictEqual(classifyStatus('DONE — no chunks open.'), 'review');
  assert.strictEqual(classifyStatus('DONE — AC4 open.'), 'ok');   // the un-negated word still counts
});
ok('DRAFT / PROPOSAL / null are ok (not complete)', () => {
  assert.strictEqual(classifyStatus('DRAFT — not yet executed.'), 'ok');
  assert.strictEqual(classifyStatus('PROPOSAL — review required.'), 'ok');
  assert.strictEqual(classifyStatus(null), 'ok');
});

// --- scanPlans + skillDrift on a tmp fixture -----------------------------------------
ok('scanPlans discovers PLAN-*.md, excludes PLAN.md, and classifies each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-lc-'));
  try {
    writeFileSync(join(dir, 'PLAN.md'), 'Status: SHIPPED\n');            // excluded
    writeFileSync(join(dir, 'PLAN-DONE.md'), 'Status: DONE — all landed.\n');
    writeFileSync(join(dir, 'PLAN-OPEN.md'), 'Status: PARTIALLY LANDED.\n');
    writeFileSync(join(dir, 'PLAN-NOSTATUS.md'), '# no status here\n');
    writeFileSync(join(dir, 'notes.md'), 'Status: DONE\n');              // not a PLAN- file
    const rows = scanPlans(dir);
    assert.deepStrictEqual(rows.map((r) => r.path), ['PLAN-DONE.md', 'PLAN-NOSTATUS.md', 'PLAN-OPEN.md']);
    assert.strictEqual(rows.find((r) => r.path === 'PLAN-DONE.md').flag, 'review');
    assert.strictEqual(rows.find((r) => r.path === 'PLAN-OPEN.md').flag, 'ok');
    assert.strictEqual(rows.find((r) => r.path === 'PLAN-NOSTATUS.md').statusLine, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
ok('skillDrift reports SKILL.md dirs not in the linted list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-lc-sk-'));
  try {
    for (const s of ['scan', 'analyze', 'newthing']) {
      mkdirSync(join(dir, '.claude', 'skills', s), { recursive: true });
      writeFileSync(join(dir, '.claude', 'skills', s, 'SKILL.md'), '---\nname: x\n---\n');
    }
    mkdirSync(join(dir, '.claude', 'skills', 'emptydir'), { recursive: true }); // no SKILL.md → ignored
    const linted = ['.claude/skills/scan/SKILL.md'];
    assert.deepStrictEqual(
      skillDrift(dir, linted),
      ['.claude/skills/analyze/SKILL.md', '.claude/skills/newthing/SKILL.md'],
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
ok('skillDrift returns [] when the skills dir is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plan-lc-none-'));
  try { assert.deepStrictEqual(skillDrift(dir, []), []); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

console.log(`\n✓ lint-plan-lifecycle.test.mjs — all ${passed} checks passed.`);
