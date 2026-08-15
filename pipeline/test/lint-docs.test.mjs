#!/usr/bin/env node
/**
 * lint-docs.test.mjs — acceptance for the DL1 structural doc-drift linter.
 *
 * Pins BOTH checks on synthetic fixtures (so the algorithm is proven independent of the live corpus)
 * AND the live regression guards (the real corpus must lint clean, and the denylist must STILL catch
 * the known index.html AP1 drift — proving CHECK 1 is not a silent no-op).
 */
import assert from 'node:assert/strict';
import {
  DENYLIST, runDenylist, normalizeWords, findDuplicateShingles, runDuplicatePhrase,
  SHINGLE_WORDS, POINTER_DOCS,
  scanSourceConstants, findConstantDrift, runConstantDrift, constantCandidates, CONST_DOCS,
} from '../ci/lint-docs.mjs';

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
  assert.ok(DENYLIST.find(x => x.id === 'mode-spread-cmd').pattern.test('run `screen-flip-niches.mjs --mode spread`'));
  assert.ok(DENYLIST.find(x => x.id === 'mode-rising-cmd').pattern.test('screen-flip-niches.mjs --mode rising --floor 50'));
});

/* ---- CHECK 1: live corpus is clean (AP1 fixed the last outstanding drift) ----------------- */
ok('the real corpus has NO hard (non-xfail) denylist violations', () => {
  const hard = runDenylist().filter(h => !h.xfail);
  assert.deepEqual(hard, [], `unexpected live denylist drift: ${hard.map(h => `${h.file}[${h.id}]`).join(', ')}`);
});
ok('there are NO outstanding xfails (AP1 fixed the index.html Scan-intro drift; a dead xfail is drift)', () => {
  // The niche-spread-rising-live + falling-excluded-unqualified rules stay LIVE (they now actively
  // guard index.html), but their AP1 xfails were retired once the deployed copy was fixed. Every
  // denylist match must now be a REAL hard violation — no rule may carry an xfail exemption.
  const xfails = runDenylist().filter(h => h.xfail);
  assert.deepEqual(xfails, [], `stale xfail(s) still present: ${xfails.map(h => `${h.file}[${h.id}]`).join(', ')}`);
});
ok('index.html no longer trips either deleted-niche / falling-exclusion rule (AP1 verified in-corpus)', () => {
  const idx = runDenylist().filter(h => h.file === 'index.html');
  assert.deepEqual(idx, [], `index.html still drifts: ${idx.map(h => h.id).join(', ')}`);
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

/* ---- CHECK 3: source constant scan ------------------------------------------------------- */
const SRC = scanSourceConstants().values;
const fire = text => findConstantDrift([{ name: 'T.md', text }], SRC).hits;

ok('the source scan reads real values off disk, both definition shapes', () => {
  assert.equal(SRC.get('BIG_TICKET_GP'), 10_000_000, 'module-level `const NAME = literal`');
  assert.equal(SRC.get('QUICK_FRESH_MIN'), 15);
  assert.equal(SRC.get('FLOOR_CAUTION_RANGES'), 1.5);
  assert.equal(SRC.get('NOISE_OFFER_GP'), 100_000);
  // threshold-TABLE property form, and the spread-override (`{ ...t, MIN_GPD: 0 }`) must NOT
  // register as a second definition — if it does, the name self-collides and is silently dropped.
  assert.equal(SRC.get('MIN_GPD'), 250_000, 'object-property definition survives the relax-ladder overrides');
});
ok('a name with two conflicting source values is DROPPED, never guessed', () => {
  const { values, conflicts } = scanSourceConstants();
  assert.ok(conflicts.some(c => c.name === 'MIN_PRICE'), 'MIN_PRICE is defined twice with different values');
  assert.equal(values.has('MIN_PRICE'), false, 'a conflicted name is not guarded');
});

/* ---- CHECK 3: the matcher (pure, synthetic) ---------------------------------------------- */
ok('a stale literal glossed onto a live constant FIRES — the anchor incident, both word orders', () => {
  // The 2026-08-08 MIN_GPD 500k→250k move; the doc phrasing is literal-BEFORE-name.
  const anchor = fire('the 500k `MIN_GPD` attention floor is a post-rank partition');
  assert.equal(anchor.length, 1);
  assert.equal(anchor[0].name, 'MIN_GPD');
  assert.equal(anchor[0].actual, 250_000);
  assert.equal(anchor[0].quoted, '500k');
  assert.deepEqual(fire('the 250k `MIN_GPD` attention floor is a post-rank partition'), []);
  // literal-AFTER-name, the parenthetical gloss form.
  assert.equal(fire('big-ticket `guide >= BIG_TICKET_GP` (20m) AND liquidity-thin').length, 1);
  assert.deepEqual(fire('big-ticket `guide >= BIG_TICKET_GP` (10m) AND liquidity-thin'), []);
});
ok('HISTORICAL prose inside a governed doc does NOT fire — the letters-in-the-glue rule', () => {
  // This is the difference between a useful guard and one that gets disabled. The repo writes a
  // superseded value as prose ("was 1.0", "MEASURED 2026-08-08"); words break adjacency, so the old
  // number is never read as a claim about the current one.
  assert.deepEqual(fire('`FLOOR_CAUTION_RANGES`, **MEASURED 2026-08-08** - was 1.0; the band carried'), []);
  assert.deepEqual(fire('MEASURED 2026-08-08 - `FLOOR_CAUTION_RANGES` moved'), [], 'a date before the name is not a value');
  assert.deepEqual(fire('from chunk-6 `BIG_TICKET_GP` (a whole-lot threshold)'), [], 'a hyphen-compound word is not a value');
  assert.deepEqual(fire('`BIG_TICKET_GP` is the threshold; a 40m lot clears it'), [], 'a literal past the gloss window is prose');
});
ok('a transition record `A → B` is judged on B, the CURRENT value', () => {
  assert.deepEqual(fire('`FLOOR_CAUTION_RANGES` 1.0 → 1.5 narrowed the caution tier'), []);
  assert.equal(fire('`FLOOR_CAUTION_RANGES` 1.5 → 2.0 narrowed the caution tier').length, 1, 'a wrong RHS still fires');
  assert.deepEqual(fire('`VALUE_LIQ_FLOOR` 50→3500, `CHURN_MIN_VOL` 2000→65000, done'), [],
    'a comma-separated list of old→new pairs does not bleed one pair onto the next name');
});
ok('a constant name that is a SUFFIX of a longer one does not steal its gloss', () => {
  // Six such pairs exist in source (TOP_DEFAULT=40 inside VALUE_TOP_DEFAULT=25, MIN_ROI=1.5 inside
  // SCALP_MIN_ROI=2, …). Without ident boundaries the longer name's CORRECT gloss fails against the
  // shorter name's value — a false alarm, which is how a guard gets disabled.
  assert.equal(SRC.get('TOP_DEFAULT'), 40);
  assert.equal(SRC.get('VALUE_TOP_DEFAULT'), 25);
  assert.deepEqual(fire('the `VALUE_TOP_DEFAULT` = 25 row cap'), [], 'the longer name is judged on its OWN value');
  assert.deepEqual(fire('25 `VALUE_TOP_DEFAULT` rows'), [], 'same in the literal-before-name order');
  assert.equal(fire('the `VALUE_TOP_DEFAULT` = 40 row cap').length, 1, 'the longer name still fires on ITS own drift');
});
ok('magnitude suffixes are ambiguity-TOLERANT; a non-magnitude unit is DECLINED', () => {
  // `15m` is 15 MILLION next to a gp constant and 15 MINUTES next to a duration one — both readings
  // are admitted, so neither produces a false alarm.
  assert.deepEqual(constantCandidates('15', 'm'), [15_000_000, 15]);
  assert.deepEqual(constantCandidates('0.5', '%'), [0.5, 0.005]);
  assert.equal(constantCandidates('30', 's'), null, 'a cross-unit restatement cannot be judged structurally');
  assert.deepEqual(fire('aged past `QUICK_FRESH_MIN` (~15m, the DISPLAY bar)'), []);
  assert.equal(fire('aged past `QUICK_FRESH_MIN` (~30m, the DISPLAY bar)').length, 1, 'ambiguity does not excuse a wrong number');
  assert.deepEqual(fire('every `HEARTBEAT_MS` (30s) via setInterval'), [], 'ms documented in seconds is declined, not failed');
  assert.deepEqual(fire('under `NOISE_OFFER_GP` (100,000 gp - the same constant)'), [], 'a SPACED unit word is prose, the number still compares');
  assert.equal(fire('under `NOISE_OFFER_GP` (50,000 gp - the same constant)').length, 1);
});

/* ---- CHECK 3: live corpus ---------------------------------------------------------------- */
ok('the real governed docs carry NO stale constant literal', () => {
  const { hits } = runConstantDrift();
  const hard = hits.filter(h => !h.xfail);
  assert.deepEqual(hard, [], `stale constant literal(s): ${hard.map(h => `${h.file}:${h.line} ${h.name}=${h.actual} doc says ${h.quoted}`).join(' | ')}`);
});
ok('the live matcher is NOT a no-op — it compares a real corpus of gloss sites', () => {
  // A green CHECK 3 is only meaningful if it actually compared something. A regex edit that narrows
  // the matcher into matching nothing would otherwise pass silently; this is the tripwire.
  const { checked, scanned } = runConstantDrift();
  assert.ok(scanned > 200, `source scan collapsed: only ${scanned} constants found`);
  assert.ok(checked >= 50, `matcher collapsed: only ${checked} glossed site(s) compared (was 66 at build time)`);
  assert.ok(CONST_DOCS.every(d => !/^(CHANGELOG\.md|PLAN\.md|plans\/|docs\/LORE\.md|pipeline\/experiments\/)/.test(d)),
    'the dated/historical record must stay OUT of the governed corpus — restating a superseded value is its job');
});

console.log(`\n✓ lint-docs.test.mjs — ${pass} check(s) passed.`);
