/* cluster-ci.mjs — the paired cluster-bootstrap interval join-exit-ev and crash-entry share. PURE; seeded, so deterministic.
 * A row is { rec: { itemId }, per: { [key]: { edgeFrac } } }; `rec.itemId` is the resampling unit, whatever
 * the caller makes it (an item for join-exit-ev, an onset day for crash-entry). */
export const BOOTSTRAP_ITERS = 2000;
export const BOOTSTRAP_SEED = 12345;   // one seed keeps join-exit-ev and crash-entry comparable

/* Item-CLUSTER bootstrap on the PAIRED per-origin difference in edge. Paired because both contenders
 * saw the same window; clustered because an item's origins share one price path. `p` is the two-sided
 * bootstrap p of a zero difference (resolution 1/iters). */
export function pairedClusterCI(rows, keyA, keyB, { iters = BOOTSTRAP_ITERS, seed = BOOTSTRAP_SEED } = {}) {
  const byItem = new Map();
  let allSum = 0, allN = 0;
  for (const r of rows) {
    const a = r.per[keyA], b = r.per[keyB];
    if (!a || !b) continue;
    const d = a.edgeFrac - b.edgeFrac;
    const cur = byItem.get(r.rec.itemId) || { sum: 0, n: 0 };
    cur.sum += d; cur.n++;
    byItem.set(r.rec.itemId, cur);
    allSum += d; allN++;
  }
  const items = [...byItem.values()];
  if (items.length < 4) return null;
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0, n = 0;
    for (let k = 0; k < items.length; k++) { const g = items[Math.floor(rnd() * items.length)]; sum += g.sum; n += g.n; }
    if (n) out.push(sum / n);
  }
  if (out.length < iters / 4) return null;
  out.sort((a, b) => a - b);
  const below = out.filter(x => x <= 0).length, above = out.filter(x => x >= 0).length;
  const p = Math.min(1, (2 * Math.min(below, above)) / out.length);
  return { point: allSum / allN, lo: out[Math.floor(out.length * 0.025)], hi: out[Math.floor(out.length * 0.975)], items: items.length, p };
}
