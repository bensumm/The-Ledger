import { fmt } from './format.js';

/* svg charts */
export function svgLine(values,opt){
  opt=opt||{}; const W=480,H=150,padL=8,padR=8,padT=12,padB=20;
  const pts=values.map((v,i)=>({i,v})).filter(p=>p.v!=null&&!isNaN(p.v));
  if(pts.length<2) return '<div class="mini">Not enough data yet.</div>';
  let mn=Math.min(...pts.map(p=>p.v)), mx=Math.max(...pts.map(p=>p.v)); if(mn===mx){mn*=0.999;mx=mx*1.001+1;}
  const n=values.length, xw=(W-padL-padR)/Math.max(n-1,1);
  const X=i=>padL+i*xw, Y=v=>padT+(H-padT-padB)*(1-(v-mn)/(mx-mn));
  let d=''; pts.forEach((p,k)=>{ d+=(k?'L':'M')+X(p.i).toFixed(1)+' '+Y(p.v).toFixed(1)+' '; });
  const area=d+'L '+X(pts[pts.length-1].i).toFixed(1)+' '+(H-padB)+' L '+X(pts[0].i).toFixed(1)+' '+(H-padB)+' Z';
  let minP=pts[0],maxP=pts[0]; pts.forEach(p=>{if(p.v<minP.v)minP=p; if(p.v>maxP.v)maxP=p;});
  const labels=opt.labels||[]; let xl='';
  (opt.ticks||[]).forEach(t=>{ if(t<n) xl+='<text class="axislbl" x="'+X(t)+'" y="'+(H-6)+'" text-anchor="middle">'+(labels[t]!=null?labels[t]:t)+'</text>'; });
  const cls=opt.eq?'eline':'pline', acls=opt.eq?'earea':'parea';
  let base=''; if(opt.baseline!=null){ const by=Y(opt.baseline); base='<line class="baseln" x1="'+padL+'" x2="'+(W-padR)+'" y1="'+by+'" y2="'+by+'"/>'; }
  let dots=''; if(opt.markExtremes!==false){
    dots='<circle class="dotmin" cx="'+X(minP.i)+'" cy="'+Y(minP.v)+'" r="3.5"><title>low: '+(labels[minP.i]||minP.i)+' · '+fmt(minP.v)+'</title></circle>'+
         '<circle class="dotmax" cx="'+X(maxP.i)+'" cy="'+Y(maxP.v)+'" r="3.5"><title>high: '+(labels[maxP.i]||maxP.i)+' · '+fmt(maxP.v)+'</title></circle>';
  }
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'"><path class="'+acls+'" d="'+area+'"/>'+base+'<path class="'+cls+'" d="'+d+'"/>'+dots+xl+'</svg>';
}
export function svgBars(values,opt){
  opt=opt||{}; const W=480,H=150,padL=8,padR=8,padT=12,padB=20, n=values.length;
  const mx=Math.max(...values,1), bw=(W-padL-padR)/n; let peak=0; values.forEach((v,i)=>{if(v>values[peak])peak=i;});
  const labels=opt.labels||[]; let bars='';
  values.forEach((v,i)=>{ const h=(H-padT-padB)*(v/mx), x=padL+i*bw, yy=H-padB-h;
    bars+='<rect class="vbar '+(i===peak?'peak':'')+'" x="'+(x+1).toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+Math.max(bw-2,1).toFixed(1)+'" height="'+h.toFixed(1)+'"><title>'+(labels[i]||i)+': '+fmt(v)+'/hr</title></rect>'; });
  let xl=''; (opt.ticks||[]).forEach(t=>{ if(t<n) xl+='<text class="axislbl" x="'+(padL+t*bw+bw/2)+'" y="'+(H-6)+'" text-anchor="middle">'+(labels[t]!=null?labels[t]:t)+'</text>'; });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'">'+bars+xl+'</svg>';
}

