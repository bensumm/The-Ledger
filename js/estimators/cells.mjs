/**
 * estimators/cells.mjs (PC2, 2026-07-17) — the RENDER/SHADOW projections of estimatePair's output,
 * split out of the estimator monolith: EST_HEADERS (the shared column set), estPairCells (the four
 * structured display cells) and estConfLean (the lean suggestions.jsonl shadow object). PURE: imports
 * only the money-format fmtP. These consume estimatePair's `{ ..., confidence }` bundle (from ./pair.mjs)
 * but do not import it — the caller passes the est object in. See the js/estimators.mjs barrel header for
 * the full doctrine; the confidence idioms are unvalidated PLACEHOLDERS (rule 4).
 */
import { fmtP } from '../money-format.js';
import { fmtHoldHorizon } from '../windowread.mjs';   // PLAN-ESTIMATOR-HONEST-SELL follow-up — the shared "~Nh/Nd hold" renderer (leaf; no cycle)

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

// the buy-cell confidence token: the RECENT-3 touch fraction (reachTok) plus, when the caller attached one
// (PLAN-ESTIMATOR-POSTURE AC1 — band niche only, computed zero-fetch off the screen's series1h), the
// PLACEMENT PERCENTILE of estBuy within the 14-day daily-LOW distribution, e.g. `4/14 · p36`. A low pXX =
// "below most daily lows" = a deep/patient entry (js/windowread.mjs placement doctrine). '–' when neither.
function buyTok(c) {
  const toks = [];
  const rt = reachTok(c.bid);
  // AC6: a churn fold-exempt row drops the bid-reach caution token (the day-level touch-reach mismeasures a
  // tight symmetric lap on the BUY leg too — same doctrine as the sell). The PLACEMENT percentile is kept —
  // it is a distribution position, not the invalidated reach signal (AC6). The bid counts still shadow.
  if (rt !== '–' && !c.foldExempt) toks.push(rt);
  if (c.buyPlacement != null) toks.push('p' + Math.round(c.buyPlacement * 100));
  return toks.length ? toks.join(' · ') : '–';
}

/* estPairCells(est) → the four structured {t, c} cells for the EST_HEADERS columns (screen + quote
   render from this ONE builder so the cell text can't drift). Confidence rides IN the price cells
   (Ben's rule): buy carries its touch fraction (recent-3 primary) + an optional AC1 placement percentile,
   sell its reach fraction OR a `(declared)` marker when anchored to a thesis exit; a bound BE floor is
   named on the sell cell (amber) — that row's estimate is saying "no trade at model prices", and PP2
   appends the PATIENT alternative (est.patient) there when one is positive, so "no trade" is never the
   whole story the reader gets. */
export function estPairCells(est) {
  if (!est) return [{ t: '—' }, { t: '—' }, { t: '—' }, { t: '—' }];
  const c = est.confidence;
  // AC5: a churn fold-exempt row drops the ask reach caution token — the day-level reach signal is declared
  // invalid for a symmetric lap, so it must not ride the cell as an implied caution (the reach counts still
  // reach the F1 shadow via estConfLean). Every non-exempt branch keeps today's EXACT rendering, so band
  // (asym, never exempt) is byte-identical; foldExempt only removes the token that would otherwise show.
  // PLAN-ESTIMATOR-HONEST-SELL E2 — estSell is the HONEST reach-fold price now (no longer overwritten to BE);
  // beFloored is a CAUTION on that secondary/phase-blind fold ("nothing to price above break-even"), NEVER a
  // number substitution (the old ` (BE-floored)` hid the real sub-BE number behind a break-even price + a "+1").
  let sellSuffix;
  if (c.beFloored) sellSuffix = ` (reach-fold floored to BE ${fmtP(est.estSellFloorBind != null ? est.estSellFloorBind : est.be)} — nothing to price above break-even${(!c.foldExempt && c.ask) ? `, ${reachTok(c.ask)}` : ''})`;
  else if (c.declaredAnchored) sellSuffix = ' (declared)';
  // R5: a `fading` ask cushion tightened the sell fold even on a clean reach — surface it as a caution beside
  // the reach token so the number never reads as an un-caveated band top (the mirage the fade guards against).
  else sellSuffix = c.foldExempt ? '' : ` (${reachTok(c.ask)}${c.fade ? ', fading↓' : ''})`;
  // E2: the FORWARD "list at X" — the phase-aware projected exit LEVEL (driftExitFrom), appended when the
  // caller passed extra.forward. It carries its hold horizon + a confidence ORDINAL (never a bare gp figure —
  // the formatFloorCeiling honesty discipline, rule 4). Absent forward ⇒ '' (byte-identical reach-fold read).
  const fwdSeg = est.estSellForward != null
    ? ` · list ~${fmtP(Math.round(est.estSellForward))} (~${fmtHoldHorizon(est.holdHorizonDays)} hold${est.forwardConfidence ? `, ${est.forwardConfidence}` : ''}, forward n≈0)` : '';
  // E2: P(fill) beside the honest margin (the Net cell) — computed by the SAME askReachFactor the rank calls,
  // so the display reads "raw margin × P(fill)" honestly. Shown only where the ask-reach caution is (evidence
  // present, not a foldExempt lap); absent → no token (byte-identical). This is what replaces the fake "+1".
  // EF1(c) (PLAN-ESTIMATOR-FIDELITY): labeled `P(ask)~` — this probability is the ASK-LEG factor ONLY
  // (askReachFactor), while the Rank cell's `P~` is the TWO-LEG product (entry × ask). The same row was
  // printing `P~57%` here beside `P~0.00` in the rank cell with no marker — the label names which leg
  // each number is, and the rank cell now labels a collapsed leg (screen-flip-niches.mjs consoleRankCell).
  // THE BASIS — CORRECTED 2026-08-09. This block used to say the ask-leg factor is on the DISPLAY
  // (recent-3) basis while the rank stays full-window, "so these two are NOT the same number and are not
  // meant to be… Never claim they match." Both halves are FALSE since the 2026-08-09 flip: `pair.mjs`
  // computes this factor with `{prefer:'full'}` at both call sites — the SAME basis as the rank — so the
  // display-vs-rank divergence is retired and the numbers DO agree in basis.
  // This mattered more than a stale comment: `pair.mjs:113-116` pins the invariant that its `frac` and
  // `pFill` must ALWAYS declare the same basis, and this file documented the OPPOSITE, pointing readers
  // at pair.mjs for a rationale pair.mjs no longer holds. An editor following it would have flipped
  // `pFill` back to `recent` and reintroduced the exact bug RB-3 existed to remove.
  // (Still true, and unrelated: `P(ask)~` is the ASK LEG ONLY; the Rank cell's `P~` is the two-leg
  // product, which is why the same row can show two different percentages.)
  const pTok = (est.estNet != null && est.pFill != null && c.ask && !c.foldExempt)
    ? ` · P(ask)~${Math.round(est.pFill * 100)}%` : '';
  // PP2 — on the BE-floored branch ONLY, name the PATIENT alternative, so "nothing to price above
  // break-even" is not the whole story when the asym pair on the same row is positive. Wording is
  // formatAsymFill's (the ONE home for price-vs-measured-level honesty; the ask guard binds on ~70% of
  // rows), passed in as text. Positive net only, and the tail names what the counts are NOT.
  const patSeg = (c.beFloored && est.patient && est.patient.net > 0)
    ? ` · patient: ${est.patient.bidTxt} → ${est.patient.askTxt} · net +${fmtP(est.patient.net)}/u — resting levels, in-sample counts, not a fill rate` : '';
  const netTxt = est.estNet == null ? '—'
    : `${est.estNet > 0 ? '+' : ''}${fmtP(est.estNet)} (${est.estRoi != null ? (est.estRoi >= 0 ? '+' : '') + est.estRoi.toFixed(1) + '%' : '—'})${pTok}`;
  return [
    { t: `${fmtP(est.estBuy)} (${buyTok(c)})` },
    { t: `${fmtP(est.estSell)}${sellSuffix}${fwdSeg}${patSeg}`, c: c.beFloored ? 'amber' : (c.declaredAnchored ? 'gain' : undefined) },
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
  // PLAN-ESTIMATOR-HONEST-SELL E2: KEEP beFloored (F-G continuity — the retro must still segment the sub-BE
  // fold rows; must not regress). It is now a fold annotation, not a market fact, but the shadow field is unchanged.
  if (c.beFloored) o.beFloored = true;
  // E2: the FORWARD "list at X" fields (driftExitFrom) for the eventual F-G fold-vs-forward-vs-realized retro
  // join. YS2 lean discipline — present ONLY when the forward was actually computed (extra.forward was passed);
  // a reach-fold-only pass logs none of them (byte-identical shadow).
  if (est.forwardPeak != null) o.forwardPeak = Math.round(est.forwardPeak);
  if (est.forwardTrough != null) o.forwardTrough = Math.round(est.forwardTrough);
  if (est.forwardConfidence != null) o.forwardConfidence = est.forwardConfidence;
  if (est.holdHorizonDays != null) o.holdHorizonDays = est.holdHorizonDays;
  // AC5/AC6: the churn fold-exemption marker so the F1 retro can segment the un-folded churn rows (the
  // reach counts above STAY logged — they are the data the exemption will be tested against). YS2: present
  // only when it fired.
  if (c.foldExempt) o.foldExempt = c.foldExempt;
  // EF1(b): the placement-bounded exemption-DROP marker ('placement') — a symmetric row whose ask sat
  // above the daily-high distribution and therefore took the standard fold. YS2: present only when it fired.
  if (c.exemptionBounded) o.exemptionBounded = c.exemptionBounded;
  // R5 shadow (F1 retro-join: did the fade-tightened top predict the realized sell better than the raw top?)
  // — present only when a fading cushion actually discounted the sell (YS2 absent-field pattern).
  if (c.fade) o.fade = c.fade.discount;
  if (c.doctrine && c.doctrine !== 'reach-fold') o.doctrine = c.doctrine;
  // PLAN-ESTIMATOR-POSTURE AC1 shadow: the band-low buy's placement percentile within the 14-day daily-LOW
  // distribution (present only on band rows the screen annotates — the YS2 absent-field pattern).
  if (c.buyPlacement != null) o.buyPlacement = Math.round(c.buyPlacement * 100) / 100;
  // PLAN-LIQUIDITY-REACH shadow (F1 retro-join: did the relaxed top actually fill?) — present only when
  // the relief changed the estimate (the YS2 absent-field pattern; normal rows stay byte-identical).
  if (c.relief) {
    o.reachRelief = Math.round(c.relief.relief * 100) / 100;
    if (c.relief.sizeRatio != null) o.sizeRatio = Math.round(c.relief.sizeRatio * 10000) / 10000;
    if (c.relief.debiasedTop != null) o.debiasedTop = c.relief.debiasedTop;
  }
  return Object.keys(o).length ? o : null;
}
