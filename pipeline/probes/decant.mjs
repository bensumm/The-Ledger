/* modules/decant.mjs — the ⚗decant dose-arbitrage probe (PM1's MULTI-ITEM probe).
 *
 * THEORY (under test; rule 4). A 4-dose potion and its 1/2/3-dose forms are distinct GE items. You can
 * buy cheap low-dose potions and DECANT them (via the NPC, e.g. Bob Barter) up to 4-dose for free. So
 * when a lower-dose variant is discounted enough that its per-4-dose-equivalent BUY cost beats buying
 * the 4-dose directly, there's a stock-up arbitrage. A market-STATE 'observe' tag; touches no number,
 * feeds no verdict.
 *
 * WHY THIS PROBE EXISTS IN PM1 — the multi-item boundary. Every other seed probe reads ONE row.
 * decant needs the SIBLING dose-variant prices, so it stress-tests how a probe declares "extra data
 * needs". PM1's decision (documented in lib/modules.mjs NEEDS): a probe declares `needs(row, ctx) =>
 * [siblingIds]`, but decant satisfies it OPPORTUNISTICALLY — the screen already loads the whole-market
 * 24h map (`ctx.v24all`), so decant reads its dose siblings from there with ZERO extra fetch. Hence
 * surfaces:['screen'] (the per-item quote surface has no whole-market map — decant stays silent there
 * until a future caller honors `needs` with an active pre-fetch; the interface is defined for that day).
 *
 * HONESTY. This ships the full `needs` INTERFACE + a real, fixture-tested dose comparison
 * (`bestDecant`), wired to fire on the screen off the free 24h map. It does NOT model decant fees,
 * NPC availability, or the low-dose fill LIQUIDITY (a cheap (1)-dose may not fill in size) — those are
 * why a firing is a PROMPT to check, not a validated edge. Size in the low-dose's own liquidity.
 */

export const DECANT_MIN_DISCOUNT_PCT = 3.0;   // a variant must beat the direct 4-dose buy by ≥ this

/* PURE dose math. Inputs are BUY (instasell) prices you'd pay per item.
     four     = the 4-dose buy price (number) — the direct route's cost per 4 doses.
     variants = [{dose:1|2|3, buy:<price>}] — lower-dose buy prices.
   Per-4-dose-equivalent cost of a k-dose variant = (4/k) × its buy price (decant k-dose units up to 4).
   Returns the CHEAPEST variant that beats `four` by ≥ minDiscountPct, or null.
     → { dose, per4, four, discountPct } */
export function bestDecant({ four, variants }, minDiscountPct = DECANT_MIN_DISCOUNT_PCT) {
  if (!(four > 0) || !Array.isArray(variants)) return null;
  let best = null;
  for (const v of variants) {
    if (!v || !(v.buy > 0) || !(v.dose >= 1) || v.dose >= 4) continue;
    const per4 = (4 / v.dose) * v.buy;
    const discountPct = (four - per4) / four * 100;
    if (discountPct >= minDiscountPct && (!best || per4 < best.per4)) {
      best = { dose: v.dose, per4, four, discountPct };
    }
  }
  return best;
}

// derive the 1/2/3-dose sibling item ids for a "(4)"-dose potion name via the mapping. Null if the
// item isn't a 4-dose potion or the map is absent. Used by BOTH needs() and probe().
function doseSiblings(name, map) {
  if (!name || !map || typeof map.resolve !== 'function') return null;
  if (!/\(4\)\s*$/.test(name)) return null;              // only a 4-dose potion has dose siblings
  const out = [];
  for (const dose of [1, 2, 3]) {
    const sibName = name.replace(/\(4\)(\s*)$/, `(${dose})$1`);
    const hit = map.resolve(sibName);
    if (hit) out.push({ dose, id: hit.id });
  }
  return out.length ? out : null;
}

export default {
  name: 'decant',
  version: 1,
  theory: 'a lower-dose potion whose per-4-dose-equivalent buy cost beats the 4-dose directly = decant arbitrage',
  stage: 'observe',
  surfaces: ['screen'],   // needs the whole-market 24h map (ctx.v24all); silent on the per-item quote surface
  // the multi-item DATA-NEEDS declaration (PM1): the sibling dose ids this probe wants pre-fetched.
  // Advisory on the screen (satisfied off ctx.v24all); a future active-pre-fetch caller reads this.
  needs(row, ctx = {}) {
    const sibs = doseSiblings(ctx.name, ctx.map);
    return sibs ? sibs.map(s => s.id) : [];
  },
  probe(row, ctx = {}) {
    if (!row || !row.reliable) return null;
    const v24all = ctx.v24all;
    if (!v24all) return null;                            // no whole-market map → can't read siblings
    const four = ctx.avgLow24;                           // the 4-dose direct buy (this row's 24h avg low)
    if (!(four > 0)) return null;
    const sibs = doseSiblings(ctx.name, ctx.map);
    if (!sibs) return null;
    const variants = [];
    for (const s of sibs) {
      const d = v24all[s.id] || v24all[String(s.id)];
      if (d && d.avgLowPrice > 0) variants.push({ dose: s.dose, buy: d.avgLowPrice });
    }
    const best = bestDecant({ four, variants });
    if (!best) return null;
    return {
      tag: `⚗decant (${best.dose})-dose −${best.discountPct.toFixed(1)}%`,
      note: `buy (${best.dose})-dose, decant to 4 for ~${Math.round(best.per4).toLocaleString()}/4 vs ${Math.round(four).toLocaleString()} direct`,
    };
  },
};
