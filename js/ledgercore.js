import { pad2 } from './format.js';

/*
 * LEDGER CORE (TD2.1) — the pure Date/Map math behind the Ledger view.
 *
 * `periodKey` and `groupTrades` were living in js/ledger.js, but ledger.js pulls in the DOM
 * (renderLedger, the fills-write cluster, github.js) at import — which pinned two pure
 * functions behind an un-node-importable module. This is a straight MOVE into a pure module so
 * the day-boundary bucketing (`periodKey`) and per-item aggregation grouping (`groupTrades`)
 * can be fixture-tested in node (pipeline/ledgercore.test.mjs). ledger.js re-imports both.
 *
 * TIME CONVENTION: `periodKey` uses LOCAL Date getters by design (project rule — every
 * RENDERED timestamp is local; UTC/ISO is storage/wire only). A local 23:55 dip buckets to
 * that local day, NOT the UTC-rolled next day. Do not swap in getUTC*; the E1 audit fixture
 * (now committed in ledgercore.test.mjs) guards this.
 */

// ts is epoch SECONDS. Returns { key, label } for the day/week/month bucket the trade falls in.
export function periodKey(ts, period){
  const d=new Date(ts*1000);
  if(period==='month') return {key:d.getFullYear()+'-'+pad2(d.getMonth()+1), label:d.toLocaleString([], {month:'short'})+' '+d.getFullYear()};
  if(period==='week'){ const m=new Date(d); m.setHours(0,0,0,0); m.setDate(m.getDate()-((m.getDay()+6)%7)); // back to Monday
    return {key:'w'+m.getFullYear()+'-'+pad2(m.getMonth()+1)+'-'+pad2(m.getDate()), label:'wk '+pad2(m.getMonth()+1)+'/'+pad2(m.getDate())}; }
  return {key:d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()), label:pad2(d.getMonth()+1)+'/'+pad2(d.getDate())}; // day
}

// Groups trades by item (id when present, else name) → [{key, itemId, name, rows:[...]}].
export function groupTrades(trades){
  const m=new Map();
  for(const t of trades){ const k=t.itemId!=null?('i'+t.itemId):('n'+t.name);
    if(!m.has(k)) m.set(k,{key:k, itemId:t.itemId, name:t.name, rows:[]}); m.get(k).rows.push(t); }
  return [...m.values()];
}
