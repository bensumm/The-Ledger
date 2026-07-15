#!/usr/bin/env node
/**
 * emit.test.mjs — the watch.mjs per-HELD-item emit contract (chunk V5).
 *
 * emit.mjs orders + formats the already-computed pieces of a held-lot note block into ONE stable,
 * consistently-ordered shape. It decides nothing (V5 is output-format-only). This pins the contract
 * so a future editor can't silently drop the guaranteed sell field or re-order the block.
 *
 * BUSINESS REQUIREMENTS (what must not break):
 *   - The block ALWAYS emits a sell line (`sell: list @ X · break-even Y`) on a held lot — the
 *     standing user rule (Ben, 2026-07-06): always state the sell price for every held item.
 *   - Field ORDER is fixed: verdict → conviction → Δ → tripwire → sell. Optional fields drop out
 *     when null, WITHOUT shifting the sell line off the end.
 *   - `heldListAt` prefers the shared momVerdict's listAt; falls back to band-top-floored-at-BE,
 *     else max(instabuy, BE), else BE — never null when the lot is priceable.
 *
 * Synthetic fixtures only. Run: `node pipeline/test/emit.test.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { heldNoteBlock, heldListAt } from '../lib/emit.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

const sellLine = lines => lines.find(l => l.includes('sell: list @'));

/* --- the sell line is ALWAYS present, and is always LAST -------------------------------------- */
ok('a quiet held lot (no conviction/delta/tripwire) still emits the sell line, last', () => {
  const lines = heldNoteBlock({
    name: 'Bandos chestplate', verdict: 'HOLD — list @ 21.1m (break-even-floored).',
    window: null, reliableReason: null,
    conviction: null, delta: null, tripwire: null,
    listAt: 21_100_000, breakEven: 20_500_000, fillProgress: 'NOT LISTED',
  });
  assert.equal(lines.length, 2);                 // header + guaranteed sell line only
  assert.ok(lines[0].startsWith('- Bandos chestplate:'));
  assert.equal(lines[1], '    sell: list @ 21.10m · break-even 20.50m · NOT LISTED');
});

ok('the sell line survives even when every optional field is present, and stays LAST', () => {
  const lines = heldNoteBlock({
    name: 'Twisted bow', verdict: 'CUT-CANDIDATE @ 1.63b — underwater.',
    window: 'ask 1.7b reached 3/7d', reliableReason: null,
    conviction: 'CUT-CANDIDATE armed — 1st underwater pass…',
    delta: 'Δ instabuy -12m (5m) · 2nd pass underwater',
    tripwire: 'support 1.60b · cut-trigger 1.59b (context — not a verdict)',
    listAt: 1_670_000_000, breakEven: 1_640_000_000, fillProgress: 'ask 5/10 @ 1.7b',
  });
  // order: header, conviction, delta, tripwire, sell
  assert.equal(lines.length, 5);
  assert.ok(lines[0].includes('CUT-CANDIDATE'));
  assert.ok(lines[1].includes('armed'));
  assert.ok(lines[2].startsWith('    Δ instabuy'));
  assert.ok(lines[3].startsWith('    support'));
  assert.equal(lines[4], '    sell: list @ 1.67b · break-even 1.64b · ask 5/10 @ 1.7b');
  assert.equal(sellLine(lines), lines[lines.length - 1]);  // ALWAYS last
});

ok('P4b: an optional path line slots between recovery and the sell line; omitted when null', () => {
  const base = {
    name: 'Decay knife', verdict: 'CUT-CANDIDATE @ 39.5k — underwater.',
    window: null, reliableReason: null,
    conviction: null, delta: null, tripwire: null, recovery: 'recovery-read: likely drops — decay',
    listAt: 42_000, breakEven: 42_000, fillProgress: null,
  };
  const withPath = heldNoteBlock({ ...base, path: 'path MIGRATED hold-recovery → cut 0.89 (support, not a verdict)' });
  assert.equal(withPath.length, 4);                       // header, recovery, path, sell
  assert.ok(withPath[1].includes('recovery-read'));
  assert.ok(withPath[2].includes('path MIGRATED'), 'the path line rides after recovery');
  assert.equal(sellLine(withPath), withPath[withPath.length - 1], 'the sell line is STILL last');
  // no path → byte-identical to the pre-P4b block
  const noPath = heldNoteBlock(base);
  assert.deepEqual(noPath, [withPath[0], withPath[1], withPath[3]]);
});

ok('window + reliability flag ride the header line; a null fillProgress drops from the sell line', () => {
  const lines = heldNoteBlock({
    name: 'Dragon bones', verdict: 'HOLD — list @ 2.5k.',
    window: 'ask 2.6k reached 5/7d', reliableReason: 'feed-inversion',
    conviction: null, delta: null, tripwire: null,
    listAt: 2500, breakEven: 2450, fillProgress: null,
  });
  assert.ok(lines[0].includes('· window ask 2.6k reached 5/7d'));
  assert.ok(lines[0].includes('· ⚠ feed-inversion'));
  assert.equal(lines[1], '    sell: list @ 2,500 · break-even 2,450');   // no trailing fill-progress
});

ok('optional pressure rides the header line between window and the reliability flag; omitted when null', () => {
  const base = {
    name: 'Dragon bones', verdict: 'HOLD — list @ 2.5k.',
    window: 'ask 2.6k reached 5/7d', reliableReason: 'feed-inversion',
    conviction: null, delta: null, tripwire: null,
    listAt: 2500, breakEven: 2450, fillProgress: null,
  };
  const withPress = heldNoteBlock({ ...base, pressure: 'buy 1.4×' });
  assert.ok(withPress[0].includes('· window ask 2.6k reached 5/7d · pressure buy 1.4× · ⚠ feed-inversion'));
  // no pressure → byte-identical to the pre-pressure block
  assert.deepEqual(heldNoteBlock(base), heldNoteBlock({ ...base, pressure: null }));
});

/* --- heldListAt precedence ------------------------------------------------------------------- */
ok('heldListAt prefers the momVerdict listAt when present', () => {
  const mv = { listAt: 18_550_000 };
  assert.equal(heldListAt({ quickSell: 18_100_000, optSell: 18_900_000 }, 18_000_000, mv), 18_550_000);
});

ok('no mv → band top when it clears break-even, else max(instabuy, BE), else BE', () => {
  // band top ≥ BE → band top
  assert.equal(heldListAt({ quickSell: 100, optSell: 130 }, 110, null), 130);
  // band top < BE → max(instabuy, BE) = BE here (instabuy 100 < BE 120)
  assert.equal(heldListAt({ quickSell: 100, optSell: 105 }, 120, null), 120);
  // band top < BE, instabuy > BE → instabuy
  assert.equal(heldListAt({ quickSell: 125, optSell: 105 }, 120, null), 125);
  // nothing priceable → degrade to BE (never null)
  assert.equal(heldListAt({ quickSell: null, optSell: null }, 120, null), 120);
});

console.log(`\nAll ${pass} checks passed.`);
