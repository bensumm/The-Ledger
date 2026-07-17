/**
 * estimators/cells.mjs (PC2, 2026-07-17) — the RENDER/SHADOW projections of estimatePair's output,
 * split out of the estimator monolith: EST_HEADERS (the shared column set), estPairCells (the four
 * structured display cells) and estConfLean (the lean suggestions.jsonl shadow object). PURE: imports
 * only the money-format fmtP. These consume estimatePair's `{ ..., confidence }` bundle (from ./pair.mjs)
 * but do not import it — the caller passes the est object in. See the js/estimators.mjs barrel header for
 * the full doctrine; the confidence idioms are unvalidated PLACEHOLDERS (rule 4).
 */
import { fmtP } from '../money-format.js';

// The estimated-pair column set (shared by screen-flip-niches.mjs/quote-items.mjs so the header row can't drift).
export const EST_HEADERS = ['Est. buy', 'Est. sell', 'Net/u (ROI)', 'BE'];

// compact reach token (rev1) — the RECENT-3 fraction is PRIMARY; the full window is appended only when
// the two DIVERGE (`0/3 · 2/14`). Recent-3 absent (thin) ⇒ the full window alone; no read ⇒ '–'.
const fracTok = f => f ? `${f.hit}/${f.days}` : null;
function reachTok(info) {
  if (!info) return '–';
  const recT = fracTok(info.rec), fullT = fracTok(info.full);
  if (recT && info.diverges && fullT) return `${recT} · ${fullT}`;   // divergence → show both (the stale flag)
  return recT || fullT || '–';                                       // recent-3 primary; full is the backstop
}

/* estPairCells(est) → the four structured {t, c} cells for the EST_HEADERS columns (screen + quote
   render from this ONE builder so the cell text can't drift). Confidence rides IN the price cells
   (Ben's rule): buy carries its touch fraction (recent-3 primary), sell its reach fraction OR a
   `(declared)` marker when anchored to a thesis exit; a bound BE floor is named on the sell cell
   (amber) — that row's estimate is saying "no trade at model prices". */
export function estPairCells(est) {
  if (!est) return [{ t: '—' }, { t: '—' }, { t: '—' }, { t: '—' }];
  const c = est.confidence;
  // PB4: the pressure-exit TRIAL marker rides IN the cell (rule 4 — the price never reads as calibrated).
  const pTag = c.pressureExit && c.pressureExit.pressure != null
    ? ` pressure ${c.pressureExit.pressure.toFixed(1)}×${c.pressureExit.reliability != null && c.pressureExit.reliability < 1 ? ` rel ${c.pressureExit.reliability.toFixed(2)}` : ''}` : '';
  let sellSuffix;
  if (c.beFloored) sellSuffix = ` (BE-floored${c.pressureExit ? ',' + pTag : c.ask ? `, ${reachTok(c.ask)}` : ''})`;
  else if (c.pressureExit) sellSuffix = ` (${pTag.trim()})`;
  else if (c.declaredAnchored) sellSuffix = ' (declared)';
  else sellSuffix = ` (${reachTok(c.ask)})`;
  const netTxt = est.estNet == null ? '—'
    : `${est.estNet > 0 ? '+' : ''}${fmtP(est.estNet)} (${est.estRoi != null ? (est.estRoi >= 0 ? '+' : '') + est.estRoi.toFixed(1) + '%' : '—'})`;
  return [
    { t: `${fmtP(est.estBuy)} (${c.pressureExit ? 'pressure' : reachTok(c.bid)})` },
    { t: `${fmtP(est.estSell)}${sellSuffix}`, c: c.beFloored ? 'amber' : (c.pressureExit ? 'gain' : (c.declaredAnchored ? 'gain' : undefined)) },
    { t: netTxt, c: est.estNet == null ? undefined : (est.estNet >= 0 ? 'gain' : 'loss') },
    { t: fmtP(est.be), c: 'mini' },
  ];
}

/* estConfLean(est) → the lean suggestions.jsonl shadow object (F1 retro-join input) or null.
   Numbers, not strings, so the join can score "did estSell predict the realized sell" directly. Carries
   BOTH the recent-3 and full-window counts (rev1) + the entry doctrine + declared/BE flags. Lean
   discipline (YS2): a field is present only when there is evidence behind it. */
export function estConfLean(est) {
  if (!est) return null;
  const c = est.confidence, o = {};
  if (c.ask) { if (c.ask.rec) { o.askRecHit = c.ask.rec.hit; o.askRecDays = c.ask.rec.days; } if (c.ask.full) { o.askHit = c.ask.full.hit; o.askDays = c.ask.full.days; } }
  if (c.bid) { if (c.bid.rec) { o.bidRecHit = c.bid.rec.hit; o.bidRecDays = c.bid.rec.days; } if (c.bid.full) { o.bidHit = c.bid.full.hit; o.bidDays = c.bid.full.days; } }
  if (c.declaredAnchored) o.declaredAnchored = true;
  if (c.beFloored) o.beFloored = true;
  if (c.doctrine && c.doctrine !== 'reach-fold') o.doctrine = c.doctrine;
  // PLAN-LIQUIDITY-REACH shadow (F1 retro-join: did the relaxed top actually fill?) — present only when
  // the relief changed the estimate (the YS2 absent-field pattern; normal rows stay byte-identical).
  if (c.relief) {
    o.reachRelief = Math.round(c.relief.relief * 100) / 100;
    if (c.relief.sizeRatio != null) o.sizeRatio = Math.round(c.relief.sizeRatio * 10000) / 10000;
    if (c.relief.debiasedTop != null) o.debiasedTop = c.relief.debiasedTop;
  }
  return Object.keys(o).length ? o : null;
}
