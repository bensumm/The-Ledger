#!/usr/bin/env node
/**
 * doclint.test.mjs — acceptance for the DL1 structural doc-drift linter.
 *
 * Pins BOTH checks on synthetic fixtures (so the algorithm is proven independent of the live corpus)
 * AND the live regression guards (the real corpus must lint clean, and the denylist must STILL catch
 * the known index.html AP1 drift — proving CHECK 1 is not a silent no-op).
 */
import assert from 'node:assert/strict';
import {
  DENYLIST, runDenylist, normalizeWords, findDuplicateShingles, runDuplicatePhrase,
  SHINGLE_WORDS, POINTER_DOCS,
} from './doclint.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

console.log('DL1 doclint acceptance:');

/* ---- CHECK 1: denylist patterns ---------------------------------------------------------- */
ok('the deleted-niche pattern matches the LIVE-niche form, not deletion prose', () => {
  const e = DENYLIST.find(x => x.id === 'niche-spread-rising-live');
  assert.ok(e.pattern.test('one table per niche (Band / Spread / Rising / Churn)'), 'catches the live niche list');
  assert.ok(!e.pattern.test('the spread/rising niches were DELETED (Steps 3+4)'), 'lowercase deletion prose is NOT a hit');
});
ok('the unqualified falling-exclusion pattern matches only the global framing', () => {
  const e = DENYLIST.find(x => x.id === 'falling-excluded-unqualified');
  assert.ok(e.pattern.test('Falling items are excluded. This is a snapshot'), 'catches the unqualified sentence');
  assert.ok(!e.pattern.test('band/churn EXCLUDE fallers (the per-strategy doctrine)'), 'the qualified per-strategy form is NOT a hit');
});
ok('the --mode {spread,rising} patterns catch the deleted commands', () => {
  assert.ok(DENYLIST.find(x => x.id === 'mode-spread-cmd').pattern.test('run `screen.mjs --mode spread`'));
  assert.ok(DENYLIST.find(x => x.id === 'mode-rising-cmd').pattern.test('screen.mjs --mode rising --floor 50'));
});

/* ---- CHECK 1: live corpus + the AP1-owned catch ------------------------------------------ */
ok('the real corpus has NO hard (non-xfail) denylist violations', () => {
  const hard = runDenylist().filter(h => !h.xfail);
  assert.deepEqual(hard, [], `unexpected live denylist drift: ${hard.map(h => `${h.file}[${h.id}]`).join(', ')}`);
});
ok('the denylist STILL catches index.html AP1 drift as xfail (CHECK 1 is not a no-op)', () => {
  const xfails = runDenylist().filter(h => h.xfail && h.file === 'index.html');
  const ids = xfails.map(h => h.id).sort();
  assert.deepEqual(ids, ['falling-excluded-unqualified', 'niche-spread-rising-live'],
    'both known index.html drifts are caught + owned by AP1');
  for (const h of xfails) assert.match(h.xfail, /AP1/, 'the xfail names its owner');
});

/* ---- CHECK 2: normalization + duplicate detection (pure, synthetic) ---------------------- */
ok('normalizeWords strips code/markdown/punctuation to a flat lowercase word array', () => {
  assert.deepEqual(normalizeWords('The **Band** gate (`bandCore`) — see it.'), ['the', 'band', 'gate', 'see', 'it']);
  assert.deepEqual(normalizeWords('drop ```\ncode block\n``` here'), ['drop', 'here'], 'fenced code is dropped');
});
ok('a verbatim ≥14-word passage shared by two docs is flagged; a short shared phrase is not', () => {
  // 16-word shared passage → flagged.
  const shared = 'the surface gate additionally drops any row whose after tax net at the thesis own posted pair';
  const dups = findDuplicateShingles([
    { name: 'A.md', text: 'intro alpha ' + shared + ' tail alpha' },
    { name: 'B.md', text: 'intro beta ' + shared + ' tail beta' },
  ]);
  assert.ok(dups.length >= 1, 'the shared long passage is flagged');
  assert.deepEqual(dups[0].files, ['A.md', 'B.md']);
  // a short incidental overlap (< SHINGLE_WORDS) does NOT collide.
  const none = findDuplicateShingles([
    { name: 'A.md', text: 'the band gate is the edge here and now today' },
    { name: 'B.md', text: 'the band gate is the edge but priced differently elsewhere' },
  ]);
  assert.deepEqual(none, [], `a ${SHINGLE_WORDS - 1}-or-fewer word overlap must not flag`);
});
ok('a passage in only ONE doc is never a duplicate', () => {
  const dups = findDuplicateShingles([
    { name: 'A.md', text: 'a unique passage of at least fourteen distinct words appearing only once in a single home' },
    { name: 'B.md', text: 'completely different unrelated wording carrying none of the same running fourteen word window at all' },
  ]);
  assert.deepEqual(dups, []);
});
ok('a null/absent doc is skipped, not thrown on', () => {
  assert.deepEqual(findDuplicateShingles([{ name: 'missing.md', text: null }]), []);
});

/* ---- CHECK 2: live corpus ---------------------------------------------------------------- */
ok('the real CLAUDE.md ⇆ README axis has NO non-allowlisted duplicate passages', () => {
  const dups = runDuplicatePhrase(POINTER_DOCS);
  assert.deepEqual(dups, [], `unexpected copy-not-move: ${dups.map(d => `[${d.files.join('+')}] "${d.shingle.slice(0, 40)}…"`).join(' | ')}`);
});

console.log(`\n✓ doclint.test.mjs — ${pass} check(s) passed.`);
