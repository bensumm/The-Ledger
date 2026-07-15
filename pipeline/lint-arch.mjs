#!/usr/bin/env node
/* lint-arch.mjs — doc-reference guard (2026-07-14): every code-font FILE reference a governed doc names
 * must resolve on disk. It is the sync mechanism for docs/ARCHITECTURE.md (invariant E7): a durable
 * architecture doc names ~30 modules/guards, and the failure mode is that a rename/delete leaves the doc
 * pointing at a file that no longer exists (worst during the directory-hierarchy rename). This closes that
 * gap the same way import-check closes missing-imports and doclint closes superseded-term drift.
 *
 * WHAT: for each governed doc it extracts every `code-font` token that LOOKS like a file (starts with a
 * word char, ends in a known source/data/doc extension, no spaces) and checks it exists — a path with a
 * `/` is resolved from the repo root; a bare basename (docs often write `screen.mjs`, not the full path)
 * resolves against the known source dirs. Function names / field names / mode strings in code font have no
 * file extension → ignored. Transient PLAN-*.md working docs are exempt (they are folded + deleted by
 * design). Genuinely-future files go in PROPOSED with the doc marking them "(proposed)".
 *
 * MUST STAY a structural/existence checker, never a semantic one (the skill-lint / doclint honesty note
 * applies verbatim). CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, no network/secrets.
 * Run: node pipeline/lint-arch.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// Docs whose code-font file references are guarded (extend as more durable docs adopt the contract).
const DOCS = ['docs/ARCHITECTURE.md', 'docs/GLOSSARY.md'];

// Referenced files that intentionally don't exist YET (the doc must mark each "(proposed)"/"planned").
// Removing a file's proposed status = deleting its line here once it ships (the acknowledgement gate).
const PROPOSED = new Set(['docs/FLOW.md', 'flip-niches.mjs', 'held-item-strategy.mjs']);

// A bare basename resolves against these dirs (repo-root-relative). '' = repo root (index.html, *.json).
const SEARCH_DIRS = ['', 'js', 'pipeline', 'pipeline/lib', 'pipeline/test', 'pipeline/probes', 'docs', '.github/workflows', '.claude/skills'];

const EXT = /\.(mjs|js|json|jsonl|md|css|html|yml|yaml)$/;

// Extract file-ish `code-font` tokens. Skips: non-file tokens (no extension), spaced phrases, `.test.mjs`
// suffix fragments (start with '.'), and transient PLAN-*.md working docs.
export function extractRefs(md) {
  const refs = new Set();
  const re = /`([^`]+)`/g; let m;
  while ((m = re.exec(md)) !== null) {
    const tok = m[1].trim();
    if (/\s/.test(tok)) continue;                 // a phrase, not a filename
    if (!/^[\w][\w./-]*$/.test(tok)) continue;    // must start with a word char (skips `.test.mjs` fragments) + no globs
    if (!EXT.test(tok)) continue;                 // must end in a known extension (skips fn/field names)
    if (/^PLAN-.*\.md$/.test(tok)) continue;      // transient working docs (folded + deleted by design)
    refs.add(tok);
  }
  return refs;
}

export function resolveRef(ref) {
  if (PROPOSED.has(ref)) return true;
  if (ref.includes('/')) return fs.existsSync(path.join(ROOT, ref));
  return SEARCH_DIRS.some(d => fs.existsSync(path.join(ROOT, d, ref)));   // bare basename → any known dir
}

function main() {
  let failures = 0, checked = 0;
  for (const doc of DOCS) {
    const p = path.join(ROOT, doc);
    if (!fs.existsSync(p)) { console.error(`✗ archlint: governed doc missing: ${doc}`); failures++; continue; }
    for (const ref of extractRefs(fs.readFileSync(p, 'utf8'))) {
      checked++;
      if (!resolveRef(ref)) { failures++;
        console.error(`✗ ${doc}: names \`${ref}\` — no such file on disk (rename/delete drift). Fix the reference, or add it to PROPOSED (and mark it "(proposed)" in the doc).`);
      }
    }
  }
  if (failures) { console.error(`\n✗ archlint FAILED — ${failures} broken doc reference(s).`); process.exit(1); }
  console.log(`✓ archlint passed — ${checked} doc file-reference(s) across ${DOCS.length} governed doc(s) all resolve.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
