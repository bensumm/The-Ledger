#!/usr/bin/env node
/* lint-comments.mjs — the COMMENT DOCTRINE ratchet.
 *
 * THE DOCTRINE (owner ruling): behavior belongs in CODE. A comment carries BRIEF intent only when
 * absolutely necessary — the contract, the units, the invariant, a one-line "measured and failed,
 * don't rebuild it" pointer — otherwise none at all. Agent-traceable, not prose. HISTORY IS NOT A
 * COMMENT: dated narrative belongs in CHANGELOG.md, the ONE home for how the code got here.
 *
 * Three structural proxies, no semantic judgement:
 *   (1) DATED REFERENCES — a `YYYY-MM-DD` in a comment is, essentially always, history.
 *   (2) BLOCK LENGTH — a contiguous run past ~40 lines is a document, not a comment.
 *   (3) VOLUME — comment lines against code lines. The axis (1) and (2) are blind to: a compact,
 *       undated 19-line header passed both while carrying 2.3x more comment than code.
 *
 * A RATCHET, not a cliff. Existing debt is grandfathered in `comment-budget.json` and may only ever
 * improve, so a long cleanup is safe without blocking files nobody is cleaning yet. A file ABSENT
 * from the baseline is NEW code and must meet NEW_FILE_CAPS outright.
 *
 * VOLUME RATCHETS ON THE ABSOLUTE COUNT, NOT THE RATIO — a ratio ceiling would go red when you
 * DELETE code, which is not a regression. The ratio caps NEW files only, where there is no baseline
 * to count down from, and as an ALLOWANCE (max of ratio x code, FLOOR_LINES) rather than a minimum
 * file size: a hard size cutoff would exempt the worst shape there is, a 36-line essay over two
 * lines of constants, which is what a plain `code >= N` guard was measured to let through.
 *
 * HONEST LIMITS — a line-shape heuristic, not a parser. A leading line counts as comment when it
 * matches /^\s*(\/\/|\/\*|\*)/, so a `//`-looking line inside a template literal can be miscounted
 * (measured: zero in this repo). Known evasions, none silent-proof: undated narrative is invisible
 * to (1); one blank line every N lines halves (2); (3) counts LEADING lines only, so trailing
 * `code(); // …` prose is unseen by it — a DATED trailing comment is still caught by (1), which is
 * why trailing comments are scanned at all. This measures MAGNITUDE, never meaning. Do NOT grow it
 * into a semantic/LLM check (same standing constraint as lint-docs / check-daemon-safety).
 *
 * A genuinely new schema/ledger module may need a longer block than the cap allows; bless it
 * deliberately rather than shrinking a real contract to fit.
 *
 * CLI:
 *   node pipeline/ci/lint-comments.mjs            check against the baseline (CI mode)
 *   node pipeline/ci/lint-comments.mjs --report   print the worst offenders, never fail
 *   node pipeline/ci/lint-comments.mjs --bless    rewrite the baseline to current counts
 *   node pipeline/ci/lint-comments.mjs --bless --force   also allow ceilings to go UP
 *
 * `--bless` only ever writes counts already true on disk, and REFUSES to raise a ceiling — or to
 * grandfather a NEW file that is over doctrine — without `--force`, so a red build's instinctive
 * re-bless cannot launder the regression that turned it red.
 *
 * CONSTRAINTS (checks.yml, /ship §4): fast, offline, deterministic, public-log-safe, no ~/.runelite,
 * no secrets, no network, static-only (reads sources as text, never imports them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const BASELINE = path.join(HERE, 'comment-budget.json');

// Production surfaces. Tests carry explanatory prose by design and are not budgeted.
const ROOTS = ['js', 'pipeline/lib', 'pipeline/commands', 'pipeline/ci', 'pipeline/daemons', 'pipeline/probes'];
const SKIP_RE = /\.test\.mjs$/;

// A file absent from the baseline is new: it must meet the doctrine, not inherit someone else's debt.
// The ratio is the repo's own median, so new code must be at least as lean as the typical file; the
// floor is the room a real contract header needs before the ratio is the binding term.
const NEW_FILE_CAPS = { dated: 2, block: 40, ratio: 0.5, floorLines: 20 };

const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;
const DATED_RE = /20[0-9]{2}-[0-9]{2}-[0-9]{2}/;
// A date inside a QUOTED span in a comment is example data, not narrative — a guard documenting the
// input it declines ("2026-08-08 — `X` does not bind") must be able to quote one. Strings are stripped
// before the date test for the same reason check-daemon-safety.mjs preserves them: quoting is evidence
// about the code, not a claim about when the code changed.
const QUOTED_RE = /"[^"]*"|'[^']*'|`[^`]*`/g;
const hasDate = line => DATED_RE.test(line.replace(QUOTED_RE, ''));

// A trailing `code(); // note` is a comment too, and NOT counting it would make it the obvious place
// to put narrative once the leading-comment budget bites — i.e. the guard would create its own
// evasion. Strings are stripped first so a URL or a date inside a literal is not mistaken for one.
const trailingComment = line => {
  const bare = line.replace(QUOTED_RE, '');
  const i = bare.indexOf('//');
  return i === -1 ? null : bare.slice(i);
};

// DATA PROVENANCE IS NOT HISTORY. A dated line under a `DATA CAVEATS` marker inside the same comment
// block describes the CURRENT contents of a data file on disk — "volDay absent before 2026-08-11" is
// what a joiner needs at the schema to avoid a silently-wrong join, and it cannot move to CHANGELOG
// without losing the reader who needs it. Dates in such a block are exempt; everywhere else a date
// reads as narrative. This is the one place the doctrine's date axis genuinely splits in two.
const CAVEAT_MARKER_RE = /DATA CAVEATS?/;

/** Walk ROOTS for .js/.mjs sources, repo-relative and sorted for deterministic output. */
function sources(root = ROOT) {
  const out = [];
  const walk = dir => {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(e.name) && !SKIP_RE.test(e.name)) out.push(rel);
    }
  };
  ROOTS.forEach(walk);
  return out.sort();
}

/**
 * Per-file doctrine metrics: dated history refs, longest contiguous comment run, and volume.
 *
 * Tracks `/* … *\/` OPEN/CLOSE state rather than matching each line's leading token. A line-shape test
 * misses every block interior not written with a leading `*` — 3,424 such lines across 80 files here,
 * including the whole of js/quotecore.js's canonical header — and counted them as CODE, so writing
 * prose RAISED the file's allowance. Two lines of essay bought one line of comment.
 *
 * A trailing `code(); // note` counts as one comment AND one code line. Counting it as neither (the
 * first version) rewarded moving prose from leading to trailing position: it lowered `comments` and
 * raised `code` at once, so an expanded copy of a REFUSED file passed at a pinned ceiling of 0.
 * Counting it as both makes that migration exactly neutral, which is the honest reading.
 */
function measure(rel, root = ROOT) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
  let dated = 0, block = 0, run = 0, blockAt = 0, runAt = 0, inCaveats = false, comments = 0, code = 0;
  let inBlock = false;
  const datedLines = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    let isComment = false;
    if (inBlock) { isComment = true; if (t.includes('*/')) inBlock = false; }
    else if (t.startsWith('/*')) { isComment = true; if (!t.includes('*/')) inBlock = true; }
    else if (t.startsWith('//')) isComment = true;
    if (isComment) {
      if (run === 0) { runAt = i + 1; inCaveats = false; }   // a new block clears the caveat scope
      run++; comments++;
      if (CAVEAT_MARKER_RE.test(line)) inCaveats = true;
      if (!inCaveats && hasDate(line)) { dated++; datedLines.push(i + 1); }
    } else {
      if (run > block) { block = run; blockAt = runAt; }
      run = 0; inCaveats = false;
      if (t) code++;
      const tail = trailingComment(line);
      if (tail) {
        comments++;
        if (DATED_RE.test(tail)) { dated++; datedLines.push(i + 1); }
      }
    }
  });
  if (run > block) { block = run; blockAt = runAt; }
  return { dated, block, blockAt, datedLines, comments, code };
}

const ratioOf = m => (m.code ? m.comments / m.code : 0);
const allowance = m => Math.max(Math.round(NEW_FILE_CAPS.ratio * m.code), NEW_FILE_CAPS.floorLines);
const ratioOver = m => m.comments > allowance(m);
const overDoctrine = m => m.dated > NEW_FILE_CAPS.dated || m.block > NEW_FILE_CAPS.block || ratioOver(m);

const loadBaseline = (file = BASELINE) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { files: {} };
// A baseline entry with no `comments` field fails CLOSED at 0. Treating it as "no ceiling" made
// deleting one JSON key a cheaper red-build reflex than typing --force, and the deletion laundered the
// regression silently — the exact move the bless refusal exists to block.
const ceilingComments = b => (b && b.comments != null ? b.comments : 0);

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--bless') ? 'bless' : argv.includes('--report') ? 'report' : 'check';
  // --root/--baseline exist so pipeline/test/lint-comments.test.mjs can drive every branch against a
  // fixture tree, the way guard-lists.test.mjs drives its guard. Without them this was the only CI
  // guard with no test, and the only way to exercise it was mutating the live repo.
  const argVal = name => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const root = argVal('--root') || ROOT;
  const baselineFile = argVal('--baseline') || (root === ROOT ? BASELINE : path.join(root, 'comment-budget.json'));

  const files = sources(root);
  const measured = new Map(files.map(f => [f, measure(f, root)]));
  const totals = [...measured.values()].reduce(
    (a, m) => ({ dated: a.dated + m.dated, worst: Math.max(a.worst, m.block), comments: a.comments + m.comments, code: a.code + m.code }),
    { dated: 0, worst: 0, comments: 0, code: 0 });

  if (mode === 'bless') {
    // Record EVERY scanned file, including clean ones — otherwise a file at zero dated refs inherits
    // the looser new-file cap and can silently drift up to it. Dated refs ratchet EXACTLY (a file at
    // zero stays at zero); block length ratchets to max(current, doctrine cap), so an over-budget
    // header is pinned where it is while a compliant file keeps normal room to edit its contract.
    const prev = loadBaseline(baselineFile);
    const out = { files: {} }, raised = [];
    // A path in the baseline with no file on disk is a DELETION or a RENAME. A rename otherwise resets
    // the ratchet silently: the new path is "new code", passes the allowance, and blesses at whatever
    // count it carries — a 1 → 91 ceiling increase landing green with no --force.
    const vanished = Object.keys(prev.files).filter(f => !measured.has(f));
    for (const [f, m] of measured) {
      const ceiling = { dated: m.dated, block: Math.max(m.block, NEW_FILE_CAPS.block), comments: m.comments };
      const was = prev.files[f];
      if (was && (ceiling.dated > was.dated || ceiling.block > was.block || ceiling.comments > ceilingComments(was))) {
        raised.push(`${f}: dated ${was.dated}→${ceiling.dated}, block ${was.block}→${ceiling.block}, comments ${ceilingComments(was)}→${ceiling.comments}`);
      } else if (!was && overDoctrine(m)) {
        // Without this a single bless grandfathers brand-new over-doctrine code at whatever it
        // happens to be — the hole that lets volume in. "New code meets the doctrine" only holds if
        // adding it to the baseline is itself deliberate.
        raised.push(`${f}: NEW file over doctrine — dated ${m.dated}, block ${m.block}, ${m.comments}c/${m.code}k ratio ${ratioOf(m).toFixed(2)}`);
      }
      out.files[f] = ceiling;
    }
    // Refuse to launder a regression. A red build's instinctive fix is to re-bless, which would
    // quietly raise the ceiling past whatever just broke it — so raising is opt-in and always listed.
    if (raised.length && !argv.includes('--force')) {
      for (const r of raised) console.error(`✗ would RAISE ${r}`);
      for (const v of vanished) console.error(`  (baseline entry with no file on disk — deleted or RENAMED: ${v})`);
      console.error(`\n✗ bless refused — ${raised.length} ceiling(s) would go UP. The ratchet only lowers. Clean the file, or re-run with --force if the increase is genuinely intended.`);
      process.exit(1);
    }
    fs.writeFileSync(baselineFile, `${JSON.stringify(out, null, 2)}\n`);
    for (const r of raised) console.log(`  ⚠ raised (forced) ${r}`);
    for (const v of vanished) console.log(`  ⚠ dropped (no file on disk — deleted or renamed) ${v}`);
    const over = [...measured.values()].filter(overDoctrine).length;
    console.log(`✓ comment-budget baseline written — ${Object.keys(out.files).length} file(s) pinned, ${over} over doctrine, ${totals.dated} dated ref(s), worst block ${totals.worst}.`);
    return;
  }

  if (mode === 'report') {
    const ranked = [...measured].filter(([, m]) => overDoctrine(m))
      .sort((a, b) => (b[1].dated - a[1].dated) || (b[1].block - a[1].block));
    console.log(`comment-doctrine report — ${ranked.length} file(s) over doctrine of ${files.length} scanned\n`);
    for (const [f, m] of ranked.slice(0, 30)) {
      console.log(`  ${String(m.dated).padStart(3)} dated  block ${String(m.block).padStart(3)} @${m.blockAt}  ratio ${ratioOf(m).toFixed(2)} (${m.comments}c/${m.code}k)  ${f}`);
    }
    console.log(`\ntotal dated refs in comments: ${totals.dated} · longest block: ${totals.worst} · repo volume ${totals.comments}c/${totals.code}k = ${(totals.comments / totals.code).toFixed(2)}`);
    return;
  }

  const base = loadBaseline(baselineFile);
  const violations = [];
  for (const [f, m] of measured) {
    const b = base.files[f];   // eslint-disable-line no-unused-vars — read below for every axis
    const cap = b ? { dated: b.dated, block: b.block } : NEW_FILE_CAPS;
    const kind = b ? 'ratchet' : 'new-file';
    if (m.dated > cap.dated) violations.push({ f, rule: `${kind}-dated`, msg: `${m.dated} dated history ref(s) in comments, ceiling ${cap.dated} (line${m.datedLines.length > 1 ? 's' : ''} ${m.datedLines.slice(0, 6).join(', ')}${m.datedLines.length > 6 ? ', …' : ''}) — history belongs in CHANGELOG.md` });
    if (m.block > cap.block) violations.push({ f, rule: `${kind}-block`, msg: `longest comment block is ${m.block} lines at :${m.blockAt}, ceiling ${cap.block} — a block this long is a document, not a comment` });
    // Baselined files ratchet on the absolute count; new files, having none, answer to the ratio.
    if (b && m.comments > ceilingComments(b)) {
      violations.push({ f, rule: 'ratchet-volume', msg: `${m.comments} comment lines, ceiling ${ceilingComments(b)} — this file's prose may only come out; trim elsewhere to add here` });
    } else if (!b && ratioOver(m)) {
      violations.push({ f, rule: 'new-file-volume', msg: `${m.comments} comment lines against ${m.code} code (ratio ${ratioOf(m).toFixed(2)}), allowance ${allowance(m)} — behavior belongs in code; keep intent brief or absent` });
    }
  }

  if (violations.length) {
    for (const v of violations) console.error(`✗ ${v.f} [${v.rule}] ${v.msg}`);
    console.error(`\n✗ comment-doctrine FAILED — ${violations.length} violation(s). Comments describe the code as it is now; dated narrative goes to CHANGELOG.md. After a genuine cleanup, re-baseline with --bless.`);
    process.exit(1);
  }
  const tracked = Object.keys(base.files).filter(f => measured.has(f)).length;   // not entries for files that are gone
  console.log(`✓ comment-doctrine passed — ${files.length} source file(s); ${tracked} grandfathered at or below their ceiling; ${totals.dated} dated ref(s) remain (ratchet only lowers).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
