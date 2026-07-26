#!/usr/bin/env node
/**
 * report-branches.test.mjs — acceptance for the non-gating branch/worktree fact-gather (C12).
 *
 * Pins the two PURE parsers on DETERMINISTIC fixture text (canned `git worktree list --porcelain`
 * and `git branch --format=…` output) — never live git state, which changes between runs. The
 * classification is the caller's job, so there is nothing else to pin here; the impure `gather()`
 * is exercised by actually running the script against the repo in the /cleanup runbook.
 */
import assert from 'node:assert';
import { parseWorktreePorcelain, parseBranchRefs } from '../ci/report-branches.mjs';

let passed = 0;
const ok = (name, fn) => { fn(); console.log(`  ✓ ${name}`); passed++; };

// --- parseWorktreePorcelain ----------------------------------------------------------
ok('parses attached worktrees, stripping refs/heads/ from the branch', () => {
  const text = [
    'worktree C:/dev/The-Ledger',
    'HEAD 39daf2abb62fb08179e823ee8f65ee6e452f8023',
    'branch refs/heads/main',
    '',
    'worktree C:/dev/The-Ledger/.claude/worktrees/agent-a3e1ba12232696893',
    'HEAD c5094935f889593d619cb11fecff9b6fe655d7f7',
    'branch refs/heads/worktree-agent-a3e1ba12232696893',
    '',
  ].join('\n');
  assert.deepStrictEqual(parseWorktreePorcelain(text), [
    { path: 'C:/dev/The-Ledger', head: '39daf2abb62fb08179e823ee8f65ee6e452f8023', branch: 'main' },
    {
      path: 'C:/dev/The-Ledger/.claude/worktrees/agent-a3e1ba12232696893',
      head: 'c5094935f889593d619cb11fecff9b6fe655d7f7',
      branch: 'worktree-agent-a3e1ba12232696893',
    },
  ]);
});
ok('a detached worktree yields branch:null', () => {
  const text = 'worktree /tmp/wt\nHEAD abc123\ndetached\n';
  assert.deepStrictEqual(parseWorktreePorcelain(text), [{ path: '/tmp/wt', head: 'abc123', branch: null }]);
});
ok('empty input yields no worktrees', () => {
  assert.deepStrictEqual(parseWorktreePorcelain(''), []);
});

// --- parseBranchRefs -----------------------------------------------------------------
ok('parses tab-separated ref/sha lines, skipping blanks', () => {
  const text = [
    'g1-readme-inventory\td7a254eaf03fb394262f2afb71a5b74a966c1224',
    'main\t39daf2abb62fb08179e823ee8f65ee6e452f8023',
    '',
  ].join('\n');
  assert.deepStrictEqual(parseBranchRefs(text), [
    { ref: 'g1-readme-inventory', sha: 'd7a254eaf03fb394262f2afb71a5b74a966c1224' },
    { ref: 'main', sha: '39daf2abb62fb08179e823ee8f65ee6e452f8023' },
  ]);
});
ok('a line without a sha is dropped (not a half-row)', () => {
  assert.deepStrictEqual(parseBranchRefs('lonely-branch-no-sha\n'), []);
});

console.log(`\n✓ report-branches.test.mjs — all ${passed} checks passed.`);
