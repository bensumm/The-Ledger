/* watchcore.js — PURE derivations for the in-app Watch tab (js/watch.js renders; this module
   DECIDES). DOM-free and node-importable, so every rule here is fixture-pinned in
   pipeline/watchcore.test.mjs. The verdict VOCABULARY is momVerdict()'s (js/quotecore.js) and the
   offer verdict is offerVerdict()'s — this module only MAPS those to card severity / alert
   membership and folds the summary/feed aggregates; it never recomputes a verdict. No imports
   from browser-only modules (keeps it pure + testable). */

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
