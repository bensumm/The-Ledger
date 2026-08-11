#!/usr/bin/env node
/* check-verdict-guards.mjs — the dropped-lotCtx pin for momVerdict (2026-08-10).
 *
 * WHY: momVerdict's 6th arg `lotCtx` carries Gate D's two V3 softenings — a lot bought under
 * FRESH_HOURS ago → `WATCH — fresh entry`, an own ask filling above the clear price → `HOLD — ask
 * filling`. Both are FAIL-OPEN by construction: `lotCtx && lotCtx.askFilling` is simply false when
 * the caller never passed one, so a blind call silently returns CUT-CANDIDATE. No error, no warning.
 *
 * The cost, found 2026-08-10: js/watch.js (the app's Watch tab) and trigger-alerts.mjs (push alerts)
 * both called it with 4 args. Each had the lot's `buyTs` already computed and in scope on the very
 * line above. Verified live before the fix — same row, same real 5m series: 4-arg → CUT-CANDIDATE,
 * 6-arg with a fresh buyTs → WATCH — fresh entry. A red CUT badge on a minutes-old fill.
 *
 * WHAT this forbids on every PRODUCTION call site (js/**, pipeline/commands/**, pipeline/lib/**):
 *   (1) MISSING — fewer than 6 arguments.
 *   (2) DEAD    — a 6th argument that is literally `undefined`/`null`, which reads identically to
 *                 omitting it. (The 5th, `now`, IS legitimately `undefined` — momVerdict defaults it.)
 * pipeline/test/** is exempt: proving the degradation path REQUIRES calling without a lotCtx.
 *
 * Structural, not semantic — same philosophy as check-forecast-guards.mjs / check-daemon-safety.mjs.
 * It cannot tell a real lotCtx from an empty object; it only pins that the argument is threaded. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ROOTS = ['js', 'pipeline/commands', 'pipeline/lib'];
const FN = 'momVerdict';

// Strip comments, string bodies AND regex literals so a call inside prose (or a `//`-disabled line)
// never matches, and a `,` inside a literal can't be mis-counted as an argument separator. Length is
// preserved so indexes still map to lines.
//
// Regex literals are not optional here: js/watch.js contains `.replace(/"/g, '&quot;')`, and a
// scrubber that skips regex handling reads that `"` as a string opener and blanks THE REST OF THE
// FILE. The v1 of this guard did exactly that — it saw zero call sites in watch.js and reported
// green over the very bug it was written for. `lostSites()` below is the backstop for the next
// version of that mistake; a guard that cannot see must never pass.
const REGEX_OK_BEFORE = /[([{,;:!&|?+\-*/%~^=<>]$|\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;
function scrub(src) {
  const out = src.split('');
  let i = 0, prev = '';   // prev = last non-space scrubbed-through char/word, for the regex/division call
  const blank = n => { for (let k = 0; k < n && i < src.length; k++) { if (src[i] !== '\n') out[i] = ' '; i++; } };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && d === '*') { blank(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blank(1);
      blank(2); continue; }
    if (c === '"' || c === "'" || c === '`') { const q = c; blank(1);
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { blank(2); continue; } blank(1); }
      blank(1); prev = 'x'; continue; }
    // regex literal — only where a value cannot precede, else `/` is division
    if (c === '/' && REGEX_OK_BEFORE.test(prev)) { blank(1);
      while (i < src.length && src[i] !== '/' && src[i] !== '\n') {
        if (src[i] === '\\') { blank(2); continue; }
        if (src[i] === '[') { blank(1); while (i < src.length && src[i] !== ']' && src[i] !== '\n') { if (src[i] === '\\') { blank(2); continue; } blank(1); } }
        blank(1); }
      blank(1); prev = 'x'; continue; }
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? (/[\w$]$/.test(prev) ? prev + c : c) : c;
    i++;
  }
  return out.join('');
}

// Backstop against a scrub bug: every RAW occurrence that LOOKS like a call — `momVerdict(` with no
// space and a non-empty argument list, not preceded by `//` on its line — must have been seen by the
// scan. Prose is excluded by those two tests: this repo's comments write either `momVerdict()` or
// `momVerdict (words…)`, and both forms appear only inside comments. The v1 scrub bug (a regex literal
// blanking the rest of js/watch.js) hid `const mv = momVerdict(row, …)`, which this does catch.
function lostSites(src, seenLines) {
  const lost = [];
  const re = /momVerdict\(\s*[^)\s]/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
    if (before.includes('//') || before.trimStart().startsWith('*')) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (!seenLines.has(line)) lost.push(line);
  }
  return lost;
}

// Split the argument list at `open` (index of '(') into top-level argument texts.
function splitArgs(s, open) {
  const args = []; let depth = 0, start = open + 1, i = open;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { args.push(s.slice(start, i)); return { args, end: i }; } }
    else if (c === ',' && depth === 1) { args.push(s.slice(start, i)); start = i + 1; }
  }
  return null;   // unbalanced — caller treats as a parse failure
}

const files = [];
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
  else if (/\.m?js$/.test(e.name)) files.push(p);
} };
for (const r of ROOTS) { const d = path.join(ROOT, r); if (fs.existsSync(d)) walk(d); }

const problems = [];
let checked = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');
  const s = scrub(src);
  const re = new RegExp('(^|[^\\w.$])' + FN + '\\s*\\(', 'g');
  const seenLines = new Set();
  let m;
  while ((m = re.exec(s))) {
    const open = s.indexOf('(', m.index + m[0].length - 1);
    const line = src.slice(0, open).split('\n').length;
    seenLines.add(line);
    // skip the declaration itself (`function momVerdict(`)
    if (/function\s*$/.test(s.slice(Math.max(0, m.index - 12), m.index + m[0].length - FN.length - 1))) continue;
    const split = splitArgs(s, open);
    if (!split) { problems.push(`${rel}:${line} — could not parse the ${FN}() argument list`); continue; }
    checked++;
    const args = split.args.map(a => a.trim());
    if (args.length < 6) { problems.push(`${rel}:${line} — ${FN}() called with ${args.length} args; lotCtx (6th) is MISSING, so Gate D's fresh-entry / ask-filling softenings are dead and a fresh or filling lot escalates to CUT-CANDIDATE`); continue; }
    if (/^(undefined|null)$/.test(args[5])) problems.push(`${rel}:${line} — ${FN}()'s 6th arg is literally \`${args[5]}\`, which is identical to omitting it (DEAD guard)`);
  }
  for (const line of lostSites(src, seenLines)) problems.push(`${rel}:${line} — a ${FN}() call with arguments that the scan did NOT see; the comment/string/regex scrubber is broken (see scrub()'s header). Fix the scrubber, do not silence this.`);
}

if (!checked) { console.error(`✗ check-verdict-guards: found ZERO ${FN}() call sites — the scan is broken, not clean.`); process.exit(1); }
if (problems.length) {
  console.error(`✗ check-verdict-guards: ${problems.length} unguarded ${FN}() call site(s) of ${checked} checked:\n` + problems.map(p => '  - ' + p).join('\n'));
  console.error(`\n  Pass a lotCtx: { buyTs, askFilling }. buyTs is on the position group already (readOpenPositions/heldGroups both compute it).`);
  process.exit(1);
}
console.log(`✓ check-verdict-guards: ${checked} ${FN}() production call site(s) all thread lotCtx`);
