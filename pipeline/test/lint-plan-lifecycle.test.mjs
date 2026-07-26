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
