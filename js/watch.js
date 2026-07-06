/* watch.js — the Watch tab: a verdict-first, at-a-glance flipping desk. Where pipeline/watch.mjs
   is the zero-lag CONSOLE authority (it reads the exchange log directly), this is the in-app DESK
   surface: the SAME shared momVerdict()/offerVerdict()/breakEven() decisions (js/quotecore.js),
   run in the browser against live marketfetch quotes, over the data the app already has (held book
   from positions.json via syncFills, offers from STATE.offers/offers.json, today's fills from
   fills.json). The one thing the console can't persist — a per-item SESSION-CONTEXT note (entry
   thesis + tripwire) — lives here, under every verdict, so a stateless CUT never reads as an order.

   Pure derivations (alert count, verdict→family, flip/incidental split, today's-fills + net,
   summary aggregates) live in js/watchcore.js (fixture-tested); this module is DOM + fetch only.
   Async model: renderWatchTab() paints synchronously from module caches (never blank — smoke-safe);
   refreshWatchQuotes() re-quotes held + buy-offer items, folds the verdicts into the caches, and
   repaints. The market re-quote loop runs ONLY while the tab is visible (enterWatch/leaveWatch);
   it reuses marketfetch's cached ts/24h store, so it's a light refresh, not a new data poller. */
import { API, STATE, IS_LOCALHOST, sGet, sSet, logEvent } from './state.js';
import { jget, fetchTs, fetch24h } from './marketfetch.js';
import { computeQuote, momVerdict, breakEven, momCell, offerVerdict } from './quotecore.js';
import { fmt, fmtP, netMargin } from './format.js';
import { resolveId } from './market.js';
import { openTrends } from './trends.js';
import { realised, fmtAge } from './ui.js';
import { verdictFamily, isHeldAlert, CANCEL_BID, splitHeld, todaysFills, summary, isSameLocalDay } from './watchcore.js';

const FRESH_MS = 10 * 60 * 1000;          // "book synced"/offers go amber past ~10 min (localhost)
const WATCH_REFRESH_MS = 180000;          // re-quote every ~3 min while the tab is open

// module caches (module-local per the marketfetch precedent — only watch.js touches them, so the
// STATE-object rule doesn't apply). quoteCache: id → {row, ts5m}. noteCache: id → note string.
const quoteCache = new Map();
const noteCache = new Map();
let todaysFillsCache = [];
let lastQuoteAt = 0;                       // ms of the last successful re-quote (for the price stamp)
let refreshTimer = null, refreshInFlight = false;
let editingNoteId = null;                 // guard: don't clobber an open inline note editor on re-render

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nameOf = id => { const it = resolveId(id); return (it && it.name) || ('#' + id); };
const arr = x => Array.isArray(x) ? x : [];

/* ---- data assembly (from STATE) --------------------------------------------------------- */
// open flip lots grouped by item at weighted-avg cost (value = deployed capital in that flip).
function heldGroups() {
  const open = STATE.trades.filter(t => t.sell === null);
  const byId = new Map();
  for (const t of open) {
    const g = byId.get(t.itemId) || { itemId: t.itemId, name: t.name, qty: 0, cost: 0, buyTs: t.opened || 0 };
    g.qty += t.qty; g.cost += t.buy * t.qty;
    if (t.opened && (!g.buyTs || t.opened < g.buyTs)) g.buyTs = t.opened;
    byId.set(t.itemId, g);
  }
  return [...byId.values()].map(g => ({ ...g, avgBuy: g.qty ? Math.round(g.cost / g.qty) : 0, value: g.cost }));
}
// closed flips whose SELL landed today (local) — drives the Day P/L cell.
const closedToday = () => STATE.trades
  .filter(t => t.sell !== null && !t.withdrawn && isSameLocalDay(t.closed, Date.now()))
  .map(t => ({ realised: realised(t) }));
// matched view for the feed's per-sell net (itemId + sellTs → realised).
const closedForNet = () => STATE.trades
  .filter(t => t.sell !== null && !t.withdrawn)
  .map(t => ({ itemId: t.itemId, sellTs: t.closed, realised: realised(t) }));

/* ---- live quote fetch (reuses marketfetch's cached ts/24h store) ------------------------- */
async function fetchLatest(id) { const j = await jget(API + '/latest?id=' + id); return (j.data && (j.data[id] || j.data[String(id)])) || (STATE.LATEST && STATE.LATEST[id]) || null; }
async function fetchWatchQuote(id) {
  const [latest, ts5m, ts6h, vol24] = await Promise.all([fetchLatest(id), fetchTs(id, '5m'), fetchTs(id, '6h'), fetch24h(id)]);
  const guide = (STATE.GUIDE && STATE.GUIDE[id] && STATE.GUIDE[id].price) || null;
  const limit = (((STATE.byId && STATE.byId[id]) || (STATE.catById && STATE.catById[id])) || {}).limit || null;
  const row = computeQuote({ latest, ts5m: arr(ts5m), ts6h: arr(ts6h), vol24, guide, limit, held: true, asked: true });
  return { row, ts5m: arr(ts5m) };
}

// The held verdict: the shared cut-trigger first (byte-identical to watch.mjs's heldVerdict),
// falling back to the same regime-based tokens when momVerdict defers.
function heldVerdict(row, be, lotValue, ts5m) {
  const mv = momVerdict(row, be, lotValue, ts5m);
  if (mv) return { verdict: mv.verdict, mv };
  if (row.falling) return { verdict: 'FALLING', mv: null };
  if (row.quickSell != null && be != null && row.quickSell < be) return { verdict: 'UNDERWATER', mv: null };
  return { verdict: row.quickSell != null ? 'HOLD' : 'NO-QUOTE', mv: null };
}

/* ---- the async re-quote pass ------------------------------------------------------------- */
export async function refreshWatchQuotes() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    const groups = heldGroups();
    const buyOffers = (STATE.offers || []).filter(o => o.side === 'buy');
    const ids = new Set([...groups.map(g => g.itemId), ...buyOffers.map(o => o.itemId)]);
    // preload session-context notes for held items (once each)
    await Promise.all(groups.filter(g => !noteCache.has(g.itemId)).map(async g => {
      const n = await sGet('watchnote:' + g.itemId); noteCache.set(g.itemId, typeof n === 'string' ? n : '');
    }));
    const results = await Promise.allSettled([...ids].map(async id => { quoteCache.set(id, await fetchWatchQuote(id)); }));
    if (results.some(r => r.status === 'fulfilled')) lastQuoteAt = Date.now();
    renderWatchTab();
  } catch (e) {
    logEvent('warn', 'system', 'watch re-quote failed: ' + ((e && e.message) || e));
  } finally { refreshInFlight = false; }
}
async function refreshTodaysFills() {
  try {
    const r = await fetch('fills.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    if (!j || j.app !== 'the-coffer-fills') return;
    todaysFillsCache = todaysFills(arr(j.events), closedForNet(), Date.now());
    renderWatchTab();
  } catch (e) { /* keep last-known feed; the panel stays populated */ }
}

/* ---- tab lifecycle (called from switchTab) ---------------------------------------------- */
export function enterWatch() {
  renderWatchTab();
  refreshWatchQuotes();
  refreshTodaysFills();
  if (!refreshTimer) refreshTimer = setInterval(refreshWatchQuotes, WATCH_REFRESH_MS);
}
export function leaveWatch() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

/* ---- HTML builders ----------------------------------------------------------------------- */
const dotStamp = (cls, html) => '<span><span class="wdot ' + cls + '"></span>' + html + '</span>';
function hhmm(tsSec) { const d = new Date(tsSec * 1000); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function stampsHtml() {
  const priceTxt = lastQuoteAt ? 'Prices <b>live</b> · refreshed ' + fmtAge(Date.now() - lastQuoteAt) + ' ago' : 'Prices <b>quoting…</b>';
  let bookTxt, bookCls = 'ok';
  if (!STATE.fillsTs) { bookTxt = 'Held book <b>not synced yet</b>'; bookCls = 'warn'; }
  else {
    const age = Date.now() - STATE.fillsTs * 1000;
    bookCls = (IS_LOCALHOST && age > FRESH_MS) ? 'warn' : 'ok';
    bookTxt = 'Held book <b>synced ' + hhmm(STATE.fillsTs) + '</b>' + (IS_LOCALHOST && age > FRESH_MS ? ' — 10+ min' : '');
  }
  const offFresh = IS_LOCALHOST && STATE.offersTs && (Date.now() - STATE.offersTs * 1000) < FRESH_MS;
  const offTxt = offFresh ? 'Offers <b>live</b> · ' + hhmm(STATE.offersTs) : 'Offers <b>as of last sync</b>';
  return '<div class="wstamps">' + dotStamp(priceTxt.includes('quoting') ? 'warn' : 'ok', priceTxt)
    + dotStamp(bookCls, bookTxt) + dotStamp(offFresh ? 'ok' : 'warn', offTxt) + '</div>';
}

function summaryHtml(agg, alerts, alertMeta) {
  const free = STATE.bankroll - agg.exposureGp;
  const cell = (k, v, vcls, m) => '<div class="wcell"><div class="wk">' + k + '</div><div class="wv num ' + (vcls || '') + '">' + v + '</div><div class="wm">' + m + '</div></div>';
  return '<div class="wsummary">'
    + cell('Exposure', fmt(agg.exposureGp), '', agg.flipCount + ' flip position' + (agg.flipCount === 1 ? '' : 's'))
    + cell('Day P/L', (agg.dayPL > 0 ? '+' : '') + fmt(agg.dayPL), agg.dayPL > 0 ? 'gain' : (agg.dayPL < 0 ? 'loss' : ''), agg.closedCount + ' closed flip' + (agg.closedCount === 1 ? '' : 's'))
    + cell('Free capital', fmt(free), 'gold', 'of ' + fmt(STATE.bankroll) + ' bankroll')
    + cell('Alerts', String(alerts), alerts > 0 ? 'loss' : '', alertMeta)
    + '</div>';
}

// the held card. `q` = cached {row, ts5m} or undefined (still quoting).
function heldCardHtml(g, q) {
  const be = breakEven(g.avgBuy);
  const note = noteCache.get(g.itemId) || '';
  const noteRow = editingNoteId === g.itemId
    ? '<div class="wctx wcte"><input class="wnote-input" id="wnote-input-' + g.itemId + '" type="text" maxlength="240" value="' + esc(note) + '" placeholder="entry thesis + tripwire…" />'
      + '<button class="wnote-save" data-note-save="' + g.itemId + '">Save</button><button class="wnote-cancel" data-note-cancel="' + g.itemId + '">Cancel</button></div>'
    : (note
      ? '<div class="wctx"><span class="lbl">Session context:</span> ' + esc(note) + ' <button class="wnote-edit" title="Edit context" data-note-edit="' + g.itemId + '">✎</button></div>'
      : '<div class="wctx"><button class="wnote-add" data-note-edit="' + g.itemId + '">+ add context…</button></div>');

  if (!q) {
    return '<div class="wcard watch"><div class="whead"><span class="winame"><span class="linkname" data-trend="' + g.itemId + '">' + esc(g.name) + '</span> <span class="wqty">×' + g.qty + '</span></span>'
      + '<span class="wpill watch">reading…</span><span class="wsp"></span></div>'
      + '<div class="wgrid"><div class="wcg"><div class="wk">Held @</div><div class="wv num">' + fmtP(g.avgBuy) + '</div></div>'
      + '<div class="wcg"><div class="wk">Break-even</div><div class="wv num">' + fmtP(be) + '</div></div>'
      + '<div class="wcg"><div class="wk">Quick sell</div><div class="wv num">—</div></div>'
      + '<div class="wcg"><div class="wk">Regime</div><div class="wv">—</div></div></div>' + noteRow + '</div>';
  }
  const { row, ts5m } = q;
  const lotValue = g.value;
  const { verdict, mv } = heldVerdict(row, be, lotValue, ts5m);
  const fam = verdictFamily(verdict);
  const m = momCell(row.mom, row.momPct);
  const momCls = m.cls === 'mommuted' ? 'wmommut' : m.cls;
  // list/target price + P/L-at-action
  let listAt = mv ? mv.listAt : null;
  if (listAt == null) {
    if (fam === 'hold') listAt = (row.optSell != null && row.optSell >= be) ? row.optSell : (row.quickSell != null ? Math.max(row.quickSell, be) : be);
    else listAt = row.quickSell;   // cut/watch fallbacks price at the live instabuy
  }
  const pnl = listAt != null ? (netMargin(g.avgBuy, listAt) || 0) * g.qty : null;
  const pnlLbl = fam === 'cut' ? 'at clear' : (fam === 'hold' ? 'at target' : 'at exit');
  const pnlHtml = pnl != null ? '<span class="wpnl num ' + (pnl >= 0 ? 'gain' : 'loss') + '">' + (pnl >= 0 ? '+' : '') + fmt(pnl) + ' ' + pnlLbl + '</span>' : '';
  // third data cell: hold shows the patient Target ask; others the live Quick sell
  const thirdK = fam === 'hold' ? 'Target ask' : 'Quick sell';
  const thirdV = fam === 'hold' ? '<span class="gain">' + fmtP(listAt) + '</span>' : fmtP(row.quickSell);
  const regCls = row.rising ? 'gain' : (row.falling ? 'loss' : '');
  const regTxt = (row.regime && row.regime.ok) ? cap(row.regimeLabel) + ' ' + (row.regime.driftPct >= 0 ? '+' : '') + row.regime.driftPct.toFixed(0) + '%' : '—';
  const actTxt = actionText(verdict, mv, row, be, listAt);
  const actWhy = mv && mv.why ? ' title="' + esc(mv.why) + '"' : '';
  return '<div class="wcard ' + fam + '">'
    + '<div class="whead"><span class="winame"><span class="linkname" data-trend="' + g.itemId + '">' + esc(g.name) + '</span> <span class="wqty">×' + g.qty + '</span></span>'
    + '<span class="wpill ' + fam + '">' + esc(verdict) + '</span>'
    + '<span class="wmom num ' + momCls + '">mom ' + m.sym + '</span><span class="wsp"></span>' + pnlHtml + '</div>'
    + '<div class="wgrid">'
    + '<div class="wcg"><div class="wk">Held @</div><div class="wv num">' + fmtP(g.avgBuy) + '</div></div>'
    + '<div class="wcg"><div class="wk">Break-even</div><div class="wv num">' + fmtP(be) + '</div></div>'
    + '<div class="wcg"><div class="wk">' + thirdK + '</div><div class="wv num">' + thirdV + '</div></div>'
    + '<div class="wcg"><div class="wk">Regime</div><div class="wv ' + regCls + '">' + regTxt + '</div></div></div>'
    + '<div class="waction ' + fam + '"' + actWhy + '>' + actTxt + '</div>' + noteRow + '</div>';
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// a concise action clause per verdict (the verbose "why" rides as the tooltip). Bold price first.
function actionText(verdict, mv, row, be, listAt) {
  const at = listAt != null ? fmtP(listAt) : (row.quickSell != null ? fmtP(row.quickSell) : '—');
  const B = (label, reason) => '<b>' + label + '</b> — ' + reason;
  if (mv) {
    switch (mv.action) {
      case 'NO_READ': return B('No read', 'quote unreliable (' + row.reliableReason + ') — no price action; keep any ask ≥ break-even ' + fmtP(be) + '.');
      case 'DIURNAL_WATCH': return B('Hold @ ' + at, 'underwater at a quiet hour that dipped &amp; recovered yesterday — don’t cut into the trough.');
      case 'SHOCK_WATCH': return B('Hold @ ' + at, 'a one-off volume shock that stabilised, not a bleed — hold one more cycle.');
      case 'CUT': return B((verdict === 'CUT-CANDIDATE' ? 'Clear @ ' : 'Cut @ ') + at, mv.gate === 'D' ? 'underwater through a liquid window — persistence, not the clock.' : '2h breakdown while underwater — free the capital.');
      case 'CLEAR': return B('List @ ' + at + ' to clear', '2h breakdown — bank it, don’t hold for the patient premium.');
      case 'HOLD_STRONG': return B('List @ ' + at, 'band top — don’t sell into strength.');
      case 'HOLD_WATCH': return B('Hold', 'a lone 2h dip vs a rising regime — usually noise.');
      case 'HOLD_FILLING': return B('Hold @ ' + at, 'your own ask is filling above the clear price — an ask transacting above the clear beats repricing down. Let it fill.');
      case 'HOLD_FRESH': return B('Hold @ ' + at, 'a fresh (&lt;1h) patient fill is definitionally underwater on the instant read — give the thesis its window; don’t cut a brand-new lot.');
    }
  }
  if (verdict === 'FALLING') return B((row.quickSell != null && row.quickSell >= be ? 'Sell @ ' : 'Cut @ ') + at, 'falling regime — price to clear, don’t list above the drop.');
  if (verdict === 'UNDERWATER') return B('Hold @ ' + fmtP(be), 'below break-even — hold ≥ break-even only while the regime holds; cut if it turns.');
  if (verdict === 'NO-QUOTE') return B('No quote', 'no live instabuy to price against — re-check at a liquid window.');
  return B('List @ ' + at, 'band top, break-even-floored. A ranging market earns the premium.');
}

function offerRowHtml(o) {
  const q = quoteCache.get(o.itemId);
  const pct = o.qty ? Math.max(0, Math.min(100, Math.round((o.filled || 0) / o.qty * 100))) : 0;
  const bar = '<span class="wfillbar"><i style="width:' + pct + '%"></i></span>';
  const amt = '<span class="wfn num">' + (o.filled || 0).toLocaleString() + ' / ' + fmt(o.qty) + ' @ ' + fmtP(o.price) + '</span>';
  let pill, ctx;
  if (o.side === 'buy') {
    const v = q ? offerVerdict(q.row, o.price) : null;
    const pc = v === CANCEL_BID ? 'cut' : (v === 'BID-BEHIND' ? 'watch' : 'bidok');
    pill = '<span class="wpill ' + pc + '">' + (v || 'reading…') + '</span>';
    ctx = v === CANCEL_BID ? 'a fill here is adverse selection — cancel unless pricing the fall'
      : v === 'BID-BEHIND' ? 'below the 2h band low · unlikely to fill soon'
        : v === 'CROSSING' ? 'bid ≥ live instasell · expect fills now'
          : v === 'BID-OK' ? 'resting inside the band · patience is the plan' : '';
  } else {
    pill = '<span class="wpill bidok">LISTED</span>';
    ctx = 'resting ask' + (q && q.row.quickSell != null ? ' · live instabuy ' + fmtP(q.row.quickSell) : '');
  }
  return '<div class="woffer"><span class="winame"><span class="linkname" data-trend="' + o.itemId + '">' + esc(o.item || nameOf(o.itemId)) + '</span></span>' + pill + bar + amt
    + '<span class="wsp"></span><span class="wfn wctxnote">' + esc(ctx) + '</span></div>';
}

function fillFeedHtml() {
  if (!todaysFillsCache.length) return '<div class="wfills"><div class="wfill wempty">No fills booked today.</div></div>';
  const rows = todaysFillsCache.map(f => {
    const net = f.side === 'sell' && f.net != null ? '<span class="num ' + (f.net >= 0 ? 'gain' : 'loss') + '">' + (f.net >= 0 ? '+' : '') + fmt(f.net) + '</span>' : '<span class="num wmuted"></span>';
    return '<div class="wfill"><time>' + hhmm(f.ts) + '</time><span class="wside ' + f.side + '">' + f.side.toUpperCase() + '</span>'
      + '<span>' + esc(nameOf(f.itemId)) + ' ×' + f.qty + ' @ <span class="num">' + fmtP(f.price) + '</span></span><span class="wsp"></span>' + net + '</div>';
  }).join('');
  return '<div class="wfills">' + rows + '</div>';
}

/* ---- the single sync render (never blank — smoke-safe) ---------------------------------- */
export function renderWatchTab() {
  const pane = document.getElementById('watchPane');
  if (!pane) return;
  if (editingNoteId != null && document.getElementById('wnote-input-' + editingNoteId)) return;   // don't clobber an open editor

  const groups = heldGroups();
  const withVal = groups.map(g => ({ ...g }));
  const { flips, incidentals } = splitHeld(withVal);
  const agg = summary(flips, closedToday());

  // alerts (spec D): CUT-family held + CANCEL-BID buy offers — both from the quote cache
  const heldVerdicts = flips.map(g => { const q = quoteCache.get(g.itemId); return q ? heldVerdict(q.row, breakEven(g.avgBuy), g.value, q.ts5m).verdict : null; }).filter(Boolean);
  const offerVerdicts = (STATE.offers || []).filter(o => o.side === 'buy').map(o => { const q = quoteCache.get(o.itemId); return q ? offerVerdict(q.row, o.price) : null; }).filter(Boolean);
  const alerts = heldVerdicts.filter(isHeldAlert).length + offerVerdicts.filter(v => v === CANCEL_BID).length;
  const alertMeta = alerts > 0 ? (heldVerdicts.filter(isHeldAlert)[0] || CANCEL_BID) : (heldVerdicts.length || offerVerdicts.length ? 'all clear' : 'nothing to action');

  // tab badge
  const badge = document.getElementById('watchTabBadge');
  if (badge) { badge.textContent = String(alerts); badge.classList.toggle('alertbadge', alerts > 0); }

  // held section
  let heldHtml;
  if (!flips.length) {
    heldHtml = '<div class="wempty2">' + (groups.length ? 'Only incidental inventory held — no flip positions.' : 'No open flip positions. Log a buy or run a pipeline sync to populate the held book.') + '</div>';
  } else {
    heldHtml = flips.map(g => heldCardHtml(g, quoteCache.get(g.itemId))).join('');
  }
  if (incidentals.length) {
    heldHtml += '<div class="wincid">Incidentals · ' + incidentals.map(g => g.qty.toLocaleString() + ' × ' + esc(g.name)).join(' · ') + '</div>';
  }

  // offers section
  const offers = STATE.offers || [];
  const offFresh = IS_LOCALHOST && STATE.offersTs && (Date.now() - STATE.offersTs * 1000) < FRESH_MS;
  let offHtml = '';
  if (!offFresh) {
    offHtml += '<div class="wstale"><span class="wdot2"></span><div><b>Offers as of ' + (STATE.offersTs ? hhmm(STATE.offersTs) + ' sync.' : 'last sync.') + '</b> The browser can’t read the exchange log — run a sync (or check in-game) for live offer state. Held quotes above are live.</div></div>';
  }
  offHtml += offers.length ? offers.map(offerRowHtml).join('') : '<div class="wempty2">No active GE offers in the last synced snapshot.</div>';

  pane.innerHTML = stampsHtml()
    + summaryHtml(agg, alerts, alertMeta)
    + '<h2 class="wh2">Held positions <span class="wcnt">' + flips.length + ' flip' + (flips.length === 1 ? '' : 's') + (incidentals.length ? ' · incidentals collapsed' : '') + '</span></h2>' + heldHtml
    + '<h2 class="wh2">Active offers <span class="wcnt">' + (offFresh ? 'live' : 'from last sync') + '</span></h2>' + offHtml
    + '<h2 class="wh2">Today’s fills</h2>' + fillFeedHtml();

  wire(pane);
}

function wire(pane) {
  pane.querySelectorAll('[data-note-edit]').forEach(b => b.onclick = () => { editingNoteId = +b.dataset.noteEdit; renderWatchTab(); const i = document.getElementById('wnote-input-' + editingNoteId); if (i) i.focus(); });
  pane.querySelectorAll('[data-note-cancel]').forEach(b => b.onclick = () => { editingNoteId = null; renderWatchTab(); });
  pane.querySelectorAll('[data-note-save]').forEach(b => b.onclick = async () => {
    const id = +b.dataset.noteSave, inp = document.getElementById('wnote-input-' + id);
    const val = inp ? inp.value.trim() : '';
    noteCache.set(id, val);
    await sSet('watchnote:' + id, val);                       // per-item note; NEVER log its contents (L1)
    logEvent('info', 'action', 'watch note ' + (val ? 'set' : 'cleared') + ' ' + nameOf(id));
    editingNoteId = null; renderWatchTab();
  });
  // item names (cards + offers) deep-link to Trends, like Finder/Ledger rows
  pane.querySelectorAll('[data-trend]').forEach(b => b.onclick = () => openTrends(+b.dataset.trend));
}
