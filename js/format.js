/* helpers */
export const TAXCAP=5_000_000;
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const now=()=>Math.floor(Date.now()/1000);
export const pad2=n=>(n<10?'0':'')+n;
export function tax(p){ if(!p||p<50) return 0; return Math.min(Math.floor(p*0.02),TAXCAP); }
export function netMargin(low,high){ if(!low||!high) return null; return (high-tax(high))-low; }
// qty variant: per-unit after-tax margin × qty (the P/L-surface form). Same null-on-missing-price guard.
export function netMarginQty(low,high,qty){ const m=netMargin(low,high); return m==null?null:m*qty; }
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
export function parseGp(str){
  if(typeof str==='number') return str; if(!str) return NaN;
  str=(''+str).trim().toLowerCase().replace(/,/g,'').replace(/ /g,'');
  const m=str.match(/^([0-9]*\.?[0-9]+)([kmb]?)$/); if(!m) return NaN;
  let v=parseFloat(m[1]); if(m[2]==='k')v*=1e3; else if(m[2]==='m')v*=1e6; else if(m[2]==='b')v*=1e9;
  return Math.round(v);
}
export const sgn=n=>n>0?'gain':(n<0?'loss':'');
export function grade(ri){ return ri<0.25?'A':ri<0.5?'B':ri<0.75?'C':'D'; }

