/* money-math.js — the money / tax MATH home (split out of the old format.js, R2).
   Together with quotecore.js's `breakEven`/`maxBuyForExit`, this is the ONE tax/margin/bond home
   (ARCHITECTURE E8): the 2% GE tax, after-cost margins, and the Old School Bond exception. Also holds
   the two generic numeric primitives `clamp`/`now` as their low-level shared home (not money-specific,
   but too small for their own file). Display formatting lives in js/money-format.js. See docs/GLOSSARY.md. */
export const TAXCAP=5_000_000;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const now=()=>Math.floor(Date.now()/1000);
export function tax(p){ if(!p||p<50) return 0; return Math.min(Math.floor(p*0.02),TAXCAP); }
// --- Old School Bond: the ONE tax exception (Ben 2026-07-09) --------------------------------------
// A bond is EXEMPT from the 2% GE tax, but a GP-bought bond is untradeable and costs 10% of its GUIDE
// value to make re-tradeable: net = sell − (buy + bondFee(guide)), NO sell-side tax. Encoded in netMargin
// below + breakEven/maxBuyForExit in quotecore.js. BOND_ID is the canonical home — nothing re-exports it.
// OPT-IN, NOT automatic: netMargin can't see an itemId, so every caller passes `{bond:true, guide}` itself.
// Bonds ARE in the app catalog (js/market.js `bondMarginOpts`); estimators/pair/reach/validate opt in
// via `row.bond`, which computeQuote sets.
// LATENT GAP (2026-08-10): js/ui.js `realised()` does NOT opt in, so a closed bond row would render
// over-taxed by tax(sell) and short the retrade fee. Harmless today only because the bond is in
// ignored-items.json and quarantineEvents drops it BEFORE reconstruction — 42 filled bond events in
// fills.json produce ZERO positions.json rows (verified). Twin of the matchTrades gap noted in
// reconstruct.mjs; fixing either needs a guide price at the P/L surface and moves historical realised P/L.
export const BOND_ID=13190;
export const BOND_RETRADE_PCT=0.10;          // fee (of guide) to re-tradeable a GP-bought bond
export const isBond=id=>id===BOND_ID;
export function bondFee(guide){ return guide>0?Math.floor(guide*BOND_RETRADE_PCT):0; }
// netMargin(low,high[,opts]) — after-cost per-unit margin. opts.bond (with opts.guide) switches to the
// BOND cost model: NO 2% sell tax, but the 10%-of-guide retrade fee added to the buy. Without opts it is
// byte-identical to the legacy (high-tax(high))-low, so every existing non-bond caller is unchanged.
export function netMargin(low,high,opts){ if(!low||!high) return null;
  if(opts&&opts.bond) return high-low-bondFee(opts.guide);
  return (high-tax(high))-low; }
// qty variant: per-unit after-cost margin × qty (the P/L-surface form). Same null-on-missing-price guard.
export function netMarginQty(low,high,qty,opts){ const m=netMargin(low,high,opts); return m==null?null:m*qty; }
