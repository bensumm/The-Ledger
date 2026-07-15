/* modules/anchor.mjs — the ⚓ round-number anchor PRICE-NUDGE probe (PM1).
 *
 * THEORY (under test; rule 4). Buyers and sellers cluster their limit orders at round numbers
 * (10,700 · 5,000 · 250,000). Per the /scan anchor-pricing doctrine, when the natural actionable price
 * lands in the DEAD ZONE just the wrong side of an anchor, a one-tick nudge to just-inside jumps the
 * whole queue at that anchor for a trivial give-up:
 *   ask (sell): a proposed ask just ABOVE an anchor → nudge DOWN to anchor−1 ("under 10,700") — your
 *               ask clears ahead of the wall of asks sitting AT 10,700.
 *   bid (buy):  a proposed bid just BELOW an anchor → nudge UP to anchor+1 ("over 5,000") — your bid
 *               fills ahead of the wall of bids sitting AT 5,000.
 * A PRICE-NUDGE annotation (stage:'price'), NOT a state tag — it is the seed probe that proves the
 * loader carries the 'price' output shape ({price, reason}) alongside the 'observe' tag shape. It
 * touches ONLY the advisory recommendation (the human-facing suggested price); it never feeds a
 * gate/verdict/rating (INVARIANT). Delete the file → the recommended price reverts to the raw band value.
 */

// The nudge only fires when the proposed price sits within NUDGE_FRAC of an anchor on the dead-zone
// side — a wide gap means the anchor isn't the binding wall, so leave the price alone.
export const NUDGE_FRAC = 0.005;   // within 0.5% of the anchor

// The round-number "grid" for a price: 10^(floor(log10(price))−2) ≈ 1% of the magnitude, clamped to a
// minimum of 1gp. So anchors fall on the natural round wall as price scales — ~10,700 → step 100
// (walls at …10,600/10,700/10,800), ~250,000 → step 1,000, ~5,000 → step 10.
export function anchorStep(price) {
  if (!(price > 0)) return null;
  return Math.max(1, Math.pow(10, Math.floor(Math.log10(price)) - 2));
}
// nearest round anchor at/below and at/above `price` on that grid.
export function nearestAnchors(price) {
  const step = anchorStep(price);
  if (step == null) return null;
  const below = Math.floor(price / step) * step;
  const above = below + step;
  return { step, below, above };
}

/* the pure nudge: given a side and a proposed price, return {price, reason}|null.
   ask just above an anchor → anchor−1; bid just below an anchor → anchor+1. */
export function anchorNudge(side, proposed) {
  if (proposed == null || !(proposed > 0)) return null;
  const a = nearestAnchors(proposed);
  if (!a) return null;
  if (side === 'ask') {
    // ask sitting just ABOVE the lower anchor (in the dead zone above a round wall) → duck under it.
    const over = proposed - a.below;
    if (a.below > 0 && over > 0 && over <= a.below * NUDGE_FRAC) {
      const price = a.below - 1;
      return { price, reason: `⚓ ask ${price.toLocaleString()} (under ${a.below.toLocaleString()})` };
    }
  } else if (side === 'bid') {
    // bid sitting just BELOW the upper anchor → step over it to lead the queue.
    const under = a.above - proposed;
    if (under > 0 && under <= a.above * NUDGE_FRAC) {
      const price = a.above + 1;
      return { price, reason: `⚓ bid ${price.toLocaleString()} (over ${a.above.toLocaleString()})` };
    }
  }
  return null;
}

export default {
  name: 'anchor',
  version: 1,
  theory: 'a proposed price in the dead zone just past a round-number wall → nudge one tick inside to jump the queue',
  stage: 'price',
  surfaces: ['screen', 'quote'],
  probe(row, priceCtx = {}, _ctx = {}) {
    if (!row || !row.reliable) return null;
    const { side, proposed } = priceCtx;
    if (proposed == null) return null;
    return anchorNudge(side || 'ask', proposed);
  },
};
