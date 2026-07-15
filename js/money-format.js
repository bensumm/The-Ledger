/* money-format.js — number/gp DISPLAY formatting (split out of the old format.js, R2).
   fmt/fmtSig/fmtP/fmtTurn/fmtHour render a gp amount; pad2/parseGp/sgn/grade/gradeCls are the small
   display/parse helpers. The money/tax MATH (tax, netMargin, bond exception, clamp, now) lives in
   js/money-math.js. See docs/GLOSSARY.md. */
export const pad2=n=>(n<10?'0':'')+n;
export function fmt(n){
  if(n===null||n===undefined||isNaN(n)) return '—';
  const s=n<0?'-':''; const a=Math.abs(n);
  if(a>=1e9) return s+(a/1e9).toFixed(2).replace(/\.00$/,'')+'b';
  if(a>=1e6) return s+(a/1e6).toFixed(2).replace(/\.00$/,'')+'m';
  if(a>=1e3) return s+(a/1e3).toFixed(1).replace(/\.0$/,'')+'k';
  return s+Math.round(a).toLocaleString();
}
// fmtSig(n, sig) — FIXED-significant-figure display for chart axes/tooltips, where fmt()'s 1-decimal
// k-range (7834 → "7.8k") collapses distinct prints onto the same label and hides trend detail. Keeps a
// compact k/m/b suffix but shows `sig` significant figures with the decimals RETAINED (not stripped),
// so 7834/7850/8000 render "7.834k"/"7.850k"/"8.000k" — visibly different. Default 4 sig figs (Ben's ask).
export function fmtSig(n,sig=4){
  if(n===null||n===undefined||isNaN(n)) return '—';
  const s=n<0?'-':''; const a=Math.abs(n);
  if(a<1000) return s+(a>=100?Math.round(a):+a.toPrecision(Math.min(sig,3))).toLocaleString();
  let unit=1,suf='';
  if(a>=1e9){unit=1e9;suf='b';} else if(a>=1e6){unit=1e6;suf='m';} else {unit=1e3;suf='k';}
  const x=a/unit;                                    // x in [1,1000)
  const dec=Math.max(0,sig-(Math.floor(Math.log10(x))+1));
  return s+x.toFixed(dec)+suf;
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
// gradeCls(g) — color tier CSS class for a DESIRABILITY letter grade (rating.mjs: S+ … D), used by the
// Finder + Scan so 'S+'/'A-'/'B+' etc. get a color (the raw 'r'+g class can't match — '+'/'-' aren't
// valid in a CSS class selector). Buckets by the leading letter: S→rS (best), A→rA, B→rB, C→rC, D→rD.
export function gradeCls(g){ if(!g) return ''; const c=String(g)[0]; return c==='S'?'rS':c==='A'?'rA':c==='B'?'rB':c==='C'?'rC':'rD'; }

