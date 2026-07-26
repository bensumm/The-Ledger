#!/usr/bin/env node
/**
 * report-branches.mjs — a NON-GATING fact-gather for the /cleanup skill (PLAN-CLEANUP-SKILL C12).
 *
 * WHY: nothing in `pipeline/ci/` touches git branches/worktrees, yet CLAUDE.md process rule 9's
 * stale-branch-delete rule ("verify each landed against PLAN.md's Status table, NOT `git branch
 * --merged`") is prose only. This gives that prose a cheap, repeatable data source so /cleanup's
 * worktree/branch review reads gathered facts instead of a fresh manual `git log`/`merge-base`
 * investigation each time.
 *
 * IT ONLY GATHERS FACTS. Classification ("stale" vs "deferred") is the CALLER's judgment step —
 * staleness also needs cross-referencing PLAN.md's Status table and any `PLAN-*.md`'s explicit
 * "preserved UNCOMMITTED, do not delete" note (a text-understanding step). The script NEVER decides
 * stale, NEVER deletes anything, NEVER exits non-zero, and is NOT wired into checks.yml.
 *
 * Output (JSON to stdout): { branches: [...], worktrees: [...] } —
 *   branch  row: { ref, tipSha, tipDate, tipSubject, isAncestorOfMain }
 *   worktree row: { worktreePath, ref, tipSha, tipDate, tipSubject, isAncestorOfMain, dirty }
 * `isAncestorOfMain` compares the tip against `origin/main`. `dirty` = `git status --porcelain`
 * non-empty in that worktree.
 *
 * Run: `node pipeline/ci/report-branches.mjs [--pretty]`
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');   // pipeline/ci -> repo root
const MAIN_REF = 'origin/main';

function git(args, cwd = ROOT) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

// --- pure parsers (unit-tested on fixture text) --------------------------------------

// `git worktree list --porcelain` → [{ path, head, branch }]. `branch` is null when detached.
export function parseWorktreePorcelain(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice('worktree '.length), head: null, branch: null };
    } else if (line.startsWith('HEAD ') && cur) {
      cur.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached' && cur) {
      cur.branch = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// `git branch --format='%(refname:short)%09%(objectname)'` → [{ ref, sha }] (local branches only).
export function parseBranchRefs(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [ref, sha] = line.split('\t');
    if (ref && sha) out.push({ ref, sha });
  }
  return out;
}

// --- fact gather (impure — shells out to git) ----------------------------------------

function tipInfo(sha, cwd = ROOT) {
  const r = git(['log', '-1', '--format=%H%x09%cI%x09%s', sha], cwd);
  if (r.status !== 0 || !r.stdout) return { tipSha: sha, tipDate: null, tipSubject: null };
  const [tipSha, tipDate, tipSubject] = r.stdout.split('\t');
  return { tipSha, tipDate, tipSubject };
}

function isAncestorOfMain(sha, cwd = ROOT) {
  return git(['merge-base', '--is-ancestor', sha, MAIN_REF], cwd).status === 0;
}

export function gather() {
  const branchRows = [];
  for (const { ref, sha } of parseBranchRefs(git(['branch', '--format=%(refname:short)%09%(objectname)']).stdout)) {
    branchRows.push({ ref, ...tipInfo(sha), isAncestorOfMain: isAncestorOfMain(sha) });
  }

  const worktreeRows = [];
  for (const wt of parseWorktreePorcelain(git(['worktree', 'list', '--porcelain']).stdout)) {
    const dirty = wt.path ? git(['status', '--porcelain'], wt.path).stdout.length > 0 : null;
    worktreeRows.push({
      worktreePath: wt.path,
      ref: wt.branch,
      ...tipInfo(wt.head || 'HEAD'),
      isAncestorOfMain: wt.head ? isAncestorOfMain(wt.head) : null,
      dirty,
    });
  }
  return { branches: branchRows, worktrees: worktreeRows };
}

function main() {
  const facts = gather();
  const pretty = process.argv.includes('--pretty');
  console.log(JSON.stringify(facts, null, pretty ? 2 : 0));
  if (pretty) {
    console.log('\n(non-gating fact report — classify against PLAN.md Status + any PLAN-*.md "do not delete" note; never auto-deletes.)');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
