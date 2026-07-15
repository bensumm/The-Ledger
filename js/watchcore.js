/* watchcore.js — PURE derivations for the in-app Watch tab (js/watch.js renders; this module
   DECIDES). DOM-free and node-importable, so every rule here is fixture-pinned in
   pipeline/watchcore.test.mjs. The verdict VOCABULARY is momVerdict()'s (js/quotecore.js) and the
   offer verdict is offerVerdict()'s — this module only MAPS those to card severity / alert
   membership and folds the summary/feed aggregates; it never recomputes a verdict. No imports
   from browser-only modules (keeps it pure + testable). */
import { fmtP } from './money-format.js';   // format.js is DOM-free/shared — used to own the --brief line format

// Held-verdict → severity FAMILY for the card's left stripe + pill tint. Semantic colour encodes
// STATE (green/amber/red); gold stays the accent, never good/bad (the design-system rule).
//   hold  (green): the HOLD family — HOLD, "HOLD — list high", "HOLD — watch", "HOLD — ask filling"
//   cut   (red):   CUT, CUT-CANDIDATE, LIST-TO-CLEAR, FALLING (all price-to-clear situations)
//   watch (amber): DIURNAL-WATCH, SHOCK-WATCH, NO-READ, UNDERWATER, NO-QUOTE, "WATCH — fresh entry"
//                  — caution, not a cut. (The V3 Gate-D softenings land in hold/watch by prefix.)
export function verdictFamily(verdict){
  const v=String(verdict||'').toUpperCase();
  if(v.startsWith('HOLD')) return 'hold';
  if(v==='CUT'||v==='CUT-CANDIDATE'||v==='LIST-TO-CLEAR'||v==='FALLING') return 'cut';
  return 'watch';
}

// ALERTS (the whole definition, spec D): CUT-family HELD verdicts + CANCEL-BID offers. The tab
// badge AND the summary "Alerts" cell both read this ONE count — never diverge them.
export const HELD_ALERT_VERDICTS=new Set(['CUT','CUT-CANDIDATE','LIST-TO-CLEAR']);
export const CANCEL_BID='CANCEL-BID';
export function isHeldAlert(verdict){ return HELD_ALERT_VERDICTS.has(String(verdict||'').toUpperCase()); }
export function alertCount(heldVerdicts=[], offerVerdicts=[]){
  return heldVerdicts.filter(isHeldAlert).length + offerVerdicts.filter(v=>v===CANCEL_BID).length;
}

// Incidental inventory: a held lot whose TOTAL value (qty×avgCost) is below this floor is noise,
// not a flip — collapsed to one muted line, never a card (the /positions incidental-inventory
// rule; matches watch.mjs NOISE_OFFER_GP). splitHeld partitions {value} lots accordingly.
export const INCIDENTAL_GP=100_000;
export function splitHeld(lots=[]){
  const flips=[], incidentals=[];
  for(const l of lots) (l.value>=INCIDENTAL_GP?flips:incidentals).push(l);
  return {flips, incidentals};
}

// LOCAL-day equality (CLAUDE.md time convention: every RENDERED day boundary is local wall-clock,
// never UTC). Used to scope "today's" fills and the Day P/L cell. now = ms (default Date.now()).
export function isSameLocalDay(tsSec, now){
  if(tsSec==null) return false;
  const a=new Date(tsSec*1000), b=new Date(now==null?Date.now():now);
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

// Today's fills feed (spec E): raw fills.json `events` → one line per COMPLETED fill today, newest
// first. We take terminal 'complete' events (a finished offer) with a real filled qty. After-tax
// net is attached to SELLs ONLY, sourced from the MATCHED view (`closed` = positions.json closed
// flips): fills.json alone has no profit, so we look realised up by itemId+sellTs (FIFO can split
// one sell across lots → SUM them). No match (a pre-log sell with no cost basis) → net null, shown
// blank, honestly. BUY lines never carry a net (mockup parity). now = ms (default Date.now()).
export function todaysFills(events=[], closed=[], now){
  const netBy=new Map();
  for(const c of closed){ if(c.sellTs==null) continue;
    const k=c.itemId+':'+c.sellTs; netBy.set(k,(netBy.get(k)||0)+(c.realised||0)); }
  const out=[];
  for(const e of events){
    if(e.state!=='complete') continue;                 // one line per finished offer
    const qty=e.filled||e.qty||0; if(qty<=0) continue;
    if(!isSameLocalDay(e.ts, now)) continue;
    const side=e.type==='sell'?'sell':'buy';
    const k=e.itemId+':'+e.ts;
    const net=(side==='sell' && netBy.has(k))?netBy.get(k):null;
    out.push({ts:e.ts, side, itemId:e.itemId, qty, price:e.price, net});
  }
  out.sort((a,b)=>b.ts-a.ts);
  return out;
}

// Summary aggregates. openFlips: [{value}] (value = qty×avgCost = deployed capital in that flip).
// closedToday: [{realised}] (today's closed flips). Exposure = Σ deployed; Day P/L = Σ realised.
export function summary(openFlips=[], closedToday=[]){
  const exposureGp=openFlips.reduce((s,l)=>s+(l.value||0),0);
  const dayPL=closedToday.reduce((s,c)=>s+(c.realised||0),0);
  return {exposureGp, flipCount:openFlips.length, dayPL, closedCount:closedToday.length};
}

// #3 capital utilization (YA1 — the in-app surface of YV1's bookUtilization). working = held
// inventory able to profit; parked = capital tied up in resting UNFILLED buy bids. PURE, output-only
// (a display read, never a verdict input). utilizationPct is null when nothing is committed — never
// a fabricated 0/100. (A tiny parallel of pipeline/lib/capitalutil.mjs kept here so the browser needs
// no node-only import; the math is trivial.)
export function capitalSplit(workingGp=0, parkedGp=0){
  const w=workingGp||0, p=parkedGp||0, committed=w+p;
  return {workingGp:w, parkedGp:p, committed, utilizationPct: committed>0 ? Math.round(w/committed*100) : null};
}

// --- watch.mjs --brief compact book: the format is OWNED BY THE SCRIPT, not the agent ------------
// Rationale: the recurring one-line-per-item loop report kept drifting (collapsed lines, dropped
// sell prices) because the layout lived in the agent's head. These pure functions make the layout a
// fixed contract: ONE line per position, a dot from the verdict, and `list @ X (BE Y)` ALWAYS present
// when a sell/BE is known (Ben's standing rules output-format-compact-lines + state-sell-price-in-loop
// — now enforced mechanically). The agent only ADDS judgment notes; it no longer formats the book.
// Palette is the fixed MONITORING.md "verdict→dot" contract (Ben-iterated 2026-07-05) — do not diverge.
export function briefDot(verdict){
  const v=String(verdict||'').toUpperCase();
  if(v==='CUT'||v==='CUT-CANDIDATE'||v==='CANCEL-BID') return '🔴';               // act now
  if(v==='LIST-TO-CLEAR'||v==='UNDERWATER') return '🟠';                          // decision pending
  if(v==='NO-READ'||v==='NO-QUOTE'||v==='UNBOOKED-ASK') return '⚪';              // no priceable read / watched
  if(verdictFamily(v)==='hold'||v==='BID-OK') return '🟢';                        // working as planned
  return '🟡';                                                                     // watch: SHOCK/DIURNAL/WATCH-fresh/BID-BEHIND/CROSSING
}
// One line per position. `listAt`/`breakEven` are raw gp (null when unknown); the `→ list X (BE Y)`
// tail is emitted whenever listAt is present, so a resting bid still carries its intended sell.
export function briefLine({verdict, name, position, listAt=null, breakEven=null}){
  const sell = listAt!=null
    ? `→ list ${fmtP(listAt)}${breakEven!=null?` (BE ${fmtP(breakEven)})`:''}`
    : (breakEven!=null?`(BE ${fmtP(breakEven)})`:'');
  return `${briefDot(verdict)} ${name} · ${position}${sell?` ${sell}`:''} · ${verdict}`;
}
