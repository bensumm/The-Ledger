import { sGet, sSet } from './state.js';

/*
 * REUSABLE SORTABLE-TABLE HELPER (TB1) — the one place click-to-sort lives.
 *
 * Ben: "the columns should be sortable — we should build a standard table object we can
 * reuse i.e. watchlist, finder etc." Before TB1 the Finder had the only sortable table, as
 * bespoke wiring (a hand-rolled comparator + per-render <th> arrow decoration + a Finder-only
 * STATE.sortKey/sortDir pair). This factors that into a small vanilla helper every table can
 * adopt.
 *
 * makeSortable({ tableId, name, columns, defaultKey?, onSort }) → a controller with:
 *   .sort(rows)   returns a sorted COPY of rows (stable; never mutates the caller's array)
 *   .decorate()   toggles the `.sorted` class + ▲/▼ `.arrow` span on the active header <th>
 *   .setSort(k,d) programmatic sort (e.g. the Finder's sort <select>); persists, no callback
 *   .key / .dir   current sort key + direction (dir: -1 desc, +1 asc)
 *
 * columns: [{ key, type:'num'|'str', get(row), invert? }]. `key` matches the header's
 *   data-k attribute. `type` picks the comparator: 'num' uses the Finder's null-safe
 *   `?? -Infinity` numeric compare, 'str' a plain locale-naive `>`/`<` string compare.
 *   `invert:true` flips the direction for that column — the risk-grade quirk (lower
 *   riskIndex = a better grade, so "sorted desc" must show grade A first).
 *
 * State: click a header to sort by it; click the active header again to reverse. A fresh
 *   column takes its natural default direction (numeric → desc, string → asc — matching the
 *   old Finder's `dir=(k==='name')?1:-1`). State persists per table under `sort:<name>` via
 *   sSet, so a sort survives reload (the Finder's sort used to reset each load). If
 *   `defaultKey` is omitted the table starts UNSORTED (renders in caller order) until the
 *   user clicks a header — that preserves the Watchlist's insertion-order default.
 */
/*
 * compareRows(column, dir) → an (a,b)=>number comparator (TD2.2 — pure, node-importable).
 * `column` is one descriptor from the `columns` list; `dir` is the RAW sort direction
 * (-1 desc / +1 asc). 'str' columns compare with a locale-naive `>`/`<` on the raw dir;
 * 'num' columns sink a missing field to -Infinity so blanks sort last. `invert` (the
 * risk-grade quirk — a lower riskIndex is a BETTER grade, so "desc" must show grade A first)
 * flips the NUMERIC direction only — a string column ignores it, matching the pre-TD2 code.
 */
export function compareRows(column, dir){
  const c=column;
  if(c.type==='str') return (a,b)=>{ const av=c.get(a), bv=c.get(b); return dir*((av>bv)?1:(av<bv?-1:0)); };
  const ndir=c.invert?-dir:dir;
  return (a,b)=>{ const av=c.get(a)??-Infinity, bv=c.get(b)??-Infinity; return ndir*((av>bv)?1:(av<bv?-1:0)); };
}

export function makeSortable({ tableId, name, columns, defaultKey=null, onSort }){
  const table=document.getElementById(tableId);
  const byKey={}; for(const c of columns) byKey[c.key]=c;
  const natDir=k=>(byKey[k] && byKey[k].type==='str')?1:-1;   // string→asc, numeric→desc
  const state={ key:defaultKey, dir:defaultKey?natDir(defaultKey):-1 };

  // restore persisted sort (fire-and-forget: re-render via onSort once it lands)
  sGet('sort:'+name).then(s=>{
    if(s && s.key && byKey[s.key] && (s.dir===1 || s.dir===-1)){
      state.key=s.key; state.dir=s.dir; if(onSort) onSort();
    }
  }).catch(()=>{});

  const persist=()=>sSet('sort:'+name, { key:state.key, dir:state.dir });

  if(table){
    table.querySelectorAll('thead th[data-k]').forEach(th=>{
      th.onclick=()=>{
        const k=th.dataset.k; if(!byKey[k]) return;
        if(state.key===k) state.dir*=-1; else { state.key=k; state.dir=natDir(k); }
        persist(); if(onSort) onSort();
      };
    });
  }

  return {
    get key(){ return state.key; },
    get dir(){ return state.dir; },
    setSort(k, dir){ if(!byKey[k]) return; state.key=k; state.dir=(dir===1||dir===-1)?dir:natDir(k); persist(); },
    sort(rows){
      const c=state.key && byKey[state.key]; if(!c) return rows;   // no active column → caller order
      return rows.slice().sort(compareRows(c, state.dir));
    },
    decorate(){
      if(!table) return;
      table.querySelectorAll('thead th').forEach(th=>{
        th.classList.toggle('sorted', th.dataset.k===state.key);
        const old=th.querySelector('.arrow'); if(old) old.remove();
        if(th.dataset.k===state.key){ const s=document.createElement('span'); s.className='arrow'; s.textContent=state.dir<0?'▼':'▲'; th.appendChild(s); }
      });
    }
  };
}
