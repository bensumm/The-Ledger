/**
 * estimators/sell-models/pressure.mjs (PC3, 2026-07-17) — the PB4 PRESSURE-EXIT sell-top model, extracted
 * verbatim from estimatePair's `{pressureExit:true}` override branch. A TRIAL (n≈0, F1-ungraduated): when
 * a pressure-driven reachable band is in hand it REPLACES both legs (Est. buy = the deep reachable bid,
 * Est. sell = the bold reachable ask). It is NEVER published — the caller refuses `--publish` under it
 * (compose.refusePublishIfNonNeutral) and shadow-logs the NEUTRAL reach-fold beside it (unbiased retro).
 *
 * Obeys the SELL-MODEL CONTRACT documented in ./reach-fold.mjs: it returns the same
 * { estBuy, buyLo, estSell, sellHi, confidence } shape and CANNOT bypass the shell's non-skippable
 * floors — the pressure ask is still ordering-clamped (sell ≥ live), still BE-floored, and a declared
 * thesis exit still wins the sell leg at the shell (only the BUY goes pressure then). A pressure deep bid
 * MAY sit below the band low (that's the point), so buyLo = -Infinity — but the shell still ceils it at
 * the live instabuy (qb). The reliability-gated peak-cap (PB4's ruled decision): a FULLY-reliable read may
 * exceed the observed 24h high (sellHi = Infinity); a reliability<1 read keeps the dayHigh cap (the
 * thin-book mirage guard). When no valid reachable band is present the model DEGRADES to the neutral
 * reach-fold proposal byte-for-byte (the flag is a no-op without a band).
 *
 * PURE: no fetch/DOM/fs. Delegates to reachFoldModel for the neutral base (preserving its buy-reach + ask
 * confidence + relief evidence under the override). PLACEHOLDER, n≈0 (rule 4).
 */
import { reachFoldModel } from './reach-fold.mjs';

const num = x => (typeof x === 'number' && Number.isFinite(x)) ? x : null;

// PB4 (PLAN-DEPTH-EXIT / PLAN-REACHABILITY-CONSOLIDATION): the reliability at/above which the pressure-exit
// ask may exceed the observed 24h high (the ruled reliability-gated peak-cap decision). reachableBand's
// reliability saturates to 1 on a liquid, well-sampled book; below it the dayHigh cap binds (the thin-book
// mirage guard). PLACEHOLDER (n≈0) — F1 owns whether/where this relaxes.
export const PRESSURE_EXIT_REL_FULL = 1;

export const pressureModel = {
  name: 'pressure',
  // NOT a default shadow: a trial with a fetch cost + a loud banner. It runs only when it is the ACTIVE
  // model (--est-sell pressure / the legacy --pressure-exit), never as a silent per-pass shadow.
  defaultShadow: false,
  propose(ctx) {
    // The neutral base carries the buy-reach annotation, the ask-reach confidence, and the relief evidence
    // that the override PRESERVES (the cell/shadow still read them). It is also the exact degrade target.
    const base = reachFoldModel.propose(ctx);
    const rbx = ctx.extra.reachable;
    if (!rbx || num(rbx.ask) == null || num(rbx.bid) == null) return base;   // no band ⇒ neutral (byte-identical)
    const dayHi = ctx.dayHi;
    const relFull = num(rbx.reliability) != null && rbx.reliability >= PRESSURE_EXIT_REL_FULL;
    // sellHi: fully-reliable ⇒ uncapped (may exceed the 24h high); else cap at the observed 24h high when
    // one is known (the shell still floors at qs). buyLo -Infinity: a deep bid may sit below the band low.
    const sellHi = relFull ? Infinity : (dayHi != null ? dayHi : Infinity);
    return {
      estBuy: rbx.bid, buyLo: -Infinity,
      estSell: rbx.ask, sellHi,
      confidence: {
        ...base.confidence,   // keep the neutral buy-reach / ask-reach / relief evidence under the override
        // The override REPLACES estSell with rbx.ask — a price the reach/fade fold never touched. So the
        // markers that assert "the emitted sell was fold-processed" must NOT ride the pressure confidence
        // (they'd describe a discount/exemption applied to a different number): null them, honouring
        // pair.mjs's stated "pressure model omits it → null" invariant for both. (relief/ask/bid stay — they
        // are descriptive EVIDENCE of the neutral read the cell shows alongside, not applied-to-emit claims.)
        fade: null, foldExempt: null,
        pressureExit: { pressure: num(rbx.pressure), reliability: num(rbx.reliability) },
      },
    };
  },
};
