#!/usr/bin/env node
/**
 * sessionthesis.test.mjs — acceptance fixtures for #4's session-thesis state model
 * (lib/sessionthesis.mjs). The state functions are PURE (a temp-file round-trip covers load/save);
 * fixture-testable with synthetic values, no live data (rule 4).
 * Run: `node pipeline/test/sessionthesis.test.mjs` (exits non-zero on any failure).
 *
 * BUSINESS REQUIREMENTS pinned here (diff a change against these):
 *   - upsert sets the thesis + optional tripwire/window + a setAt stamp; a partial upsert (omitting
 *     a field) PRESERVES the prior value, never nulls it silently.
 *   - clear removes a lane; prune drops stale lanes (setAt older than the TTL) and thesis-less rows.
 *   - thesisLine formats "thesis: … · tripwire … · window …", omitting absent parts; null when no
 *     thesis.
 *   - load of an absent/garbage file is {} (never a throw); save→load round-trips.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadThesis, saveThesis, upsertThesis, clearThesis, pruneThesis, thesisLine, THESIS_TTL_DAYS } from '../lib/sessionthesis.mjs';
// FIX 2 (2026-07-13): `thesis.mjs clear` must reach BOTH stores. These are the pure building blocks it
// wires together — the session clearThesis (above) + the hold-thesis clearThesis/upsertThesis (below).
import { upsertThesis as upsertHoldThesis, clearThesis as clearHoldThesis, thesisFor as holdThesisFor } from '../lib/holdthesis.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };
const NOW = 1_783_000_000;

console.log('#4 session-thesis acceptance:');

ok('upsert sets thesis + tripwire + window + setAt', () => {
  const s = upsertThesis({}, 4151, { thesis: 'accumulate the dip', tripwire: 'support 2.7m', window: '21-0' }, NOW);
  assert.equal(s[4151].thesis, 'accumulate the dip');
  assert.equal(s[4151].tripwire, 'support 2.7m');
  assert.equal(s[4151].window, '21-0');
  assert.equal(s[4151].setAt, NOW);
});

ok('a partial upsert preserves the prior tripwire, never nulls it', () => {
  let s = upsertThesis({}, 1, { thesis: 'hold', tripwire: 'support 100' }, NOW);
  s = upsertThesis(s, 1, { thesis: 'still hold' }, NOW + 10);   // no tripwire passed
  assert.equal(s[1].thesis, 'still hold');
  assert.equal(s[1].tripwire, 'support 100', 'prior tripwire preserved on a partial update');
});

ok('clear removes a lane', () => {
  const s = clearThesis(upsertThesis({}, 7, { thesis: 'x' }, NOW), 7);
  assert.ok(!('7' in s) && !(7 in s));
});

ok('prune drops stale lanes (past TTL) and thesis-less rows, keeps fresh', () => {
  const state = {
    1: { thesis: 'fresh', setAt: NOW },
    2: { thesis: 'old', setAt: NOW - (THESIS_TTL_DAYS + 1) * 86400 },
    3: { thesis: null, setAt: NOW },              // no thesis → dropped
  };
  const p = pruneThesis(state, NOW);
  assert.ok('1' in p, 'fresh kept');
  assert.ok(!('2' in p), 'stale dropped');
  assert.ok(!('3' in p), 'thesis-less dropped');
});

ok('thesisLine formats present parts, omits absent, null on no thesis', () => {
  assert.equal(thesisLine({ thesis: 'x', tripwire: 'y', window: 'z' }), 'thesis: x · tripwire y · window z');
  assert.equal(thesisLine({ thesis: 'x' }), 'thesis: x');
  assert.equal(thesisLine({ thesis: 'x', tripwire: 'y' }), 'thesis: x · tripwire y');
  assert.equal(thesisLine({}), null);
  assert.equal(thesisLine(null), null);
});

ok('load of an absent/garbage file is {} and save→load round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coffer-thesis-'));
  const p = path.join(dir, 'session-thesis.json');
  assert.deepEqual(loadThesis(p), {}, 'absent file → {}');
  fs.writeFileSync(p, 'not json');
  assert.deepEqual(loadThesis(p), {}, 'garbage file → {}, never a throw');
  const s = upsertThesis({}, 99, { thesis: 'round trip' }, NOW);
  saveThesis(p, s);
  assert.deepEqual(loadThesis(p), s, 'save then load round-trips');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

// FIX 2 — the TWO-STORE clear contract: `thesis.mjs clear <id>` drops the id from the session store
// AND the tracked hold-thesis store (the declared, gating plan `set --path` writes). Before the fix a
// cleared plan left its gating exit/tripwire behind (the stale Masori body / Lightbearer / fury
// pollution). Pin the hold-thesis half here (session clear is pinned by 'clear removes a lane' above):
ok('FIX 2 two-store clear: hold-thesis clear drops the declared id, preserves the others', () => {
  let h = upsertHoldThesis([], { id: 23956, exitPrice: 6_270_000, tripwire: 6_000_000, path: 'value-hold' }, NOW);
  h = upsertHoldThesis(h, { id: 27229, exitPrice: 44_340_000, tripwire: 41_500_000, path: 'diurnal' }, NOW);
  assert.ok(holdThesisFor(h, 23956) && holdThesisFor(h, 27229), 'both declared before clear');
  const after = clearHoldThesis(h, 23956);
  assert.equal(holdThesisFor(after, 23956), null, 'cleared id removed from hold-thesis (no lingering gating exit)');
  assert.ok(holdThesisFor(after, 27229), 'other declared plan untouched');
  // clearing an id with NO declared entry is a no-op (thesis.mjs only writes the file when one existed).
  assert.deepEqual(clearHoldThesis(after, 99999), after);
});

console.log(`\nAll ${pass} acceptance checks passed.`);
