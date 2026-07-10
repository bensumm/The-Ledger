/* helpers */
export const TAXCAP=5_000_000;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const now=()=>Math.floor(Date.now()/1000);
export const pad2=n=>(n<10?'0':'')+n;
export function tax(p){ if(!p||p<50) return 0; return Math.min(Math.floor(p*0.02),TAXCAP); }
// --- Old School Bond: the ONE tax exception (Ben 2026-07-09) --------------------------------------
// A bond is EXEMPT from the 2% GE tax, but a bond bought with GP is untradeable and costs 10% of its
// GUIDE value to make re-tradeable — so a bond flip's effective cost is `buy + 10%×guide` and the sell
// is tax-free. i.e. compare `sell` against `buy + bondFee(guide)`, with NO sell-side tax. Encoded here
// as an exception in the tax/net math (netMargin below + breakEven in quotecore.js) so no surface has to
// special-case it. BOND_ID is the canonical home; state.js re-exports it for the app (which excludes the
// bond from its catalog entirely — this exception is what keeps the PIPELINE quote/screen honest instead).
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
export function fmt(n){
  if(n===null||n===undefined||isNaN(n)) return '—';
  const s=n<0?'-':''; const a=Math.abs(n);
  if(a>=1e9) return s+(a/1e9).toFixed(2).replace(/\.00$/,'')+'b';
  if(a>=1e6) return s+(a/1e6).toFixed(2).replace(/\.00$/,'')+'m';
  if(a>=1e3) return s+(a/1e3).toFixed(1).replace(/\.0$/,'')+'k';
  return s+Math.round(a).toLocaleString();
}
export function fmtP(n){
  if(n===null||n===undefined||isNaN(n)) return '—';
  const a=Math.abs(n);
  if(a<100000) return (n<0?'-':'')+Math.round(a).toLocaleString();   // full gp resolution under 100k
  return fmt(n);
}
export function fmtTurn(h){ if(h===null||h===undefined) return '—'; return h<1?'~'+Math.round(h*60)+'m':'~'+h.toFixed(1)+'h'; }
export const fmtHour=h=>pad2(h)+':00';
// parseGp — app-form gp parser. Deliberately NOT identical to pipeline/lib/cli.mjs's parseGp:
// that CLI copy accepts a leading '-' sign and rounds a numeric passthrough; this app copy accepts
// leading-dot decimals (".5m"), strips internal spaces, and passes a number through unrounded.
// Kept as two homes on purpose (browser form input vs CLI arg parsing).
export function parseGp(str){
  if(typeof str==='number') return str; if(!str) return NaN;
  str=(''+str).trim().toLowerCase().replace(/,/g,'').replace(/ /g,'');
  const m=str.match(/^([0-9]*\.?[0-9]+)([kmb]?)$/); if(!m) return NaN;
  let v=parseFloat(m[1]); if(m[2]==='k')v*=1e3; else if(m[2]==='m')v*=1e6; else if(m[2]==='b')v*=1e9;
  return Math.round(v);
}
export const sgn=n=>n>0?'gain':(n<0?'loss':'');
export function grade(ri){ return ri<0.25?'A':ri<0.5?'B':ri<0.75?'C':'D'; }

