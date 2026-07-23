/* analyze.mjs — the PURE analysis core (PLAN-ANALYZE chunk AZ1).
 *
 * The dataset AUDIT + tuning-CANDIDATE derivation, with NO fs / NO fetch — the same PURE-core / IO-shell
 * split as retrojoin.mjs ⇄ lib/retrojoin.mjs. The caller (pipeline/commands/analyze-record.mjs) reads the ledger + fills
 * + positions and feeds parsed objects in; analyze.test.mjs feeds SYNTHETIC fixtures only.
 *
 * It re-implements NONE of the join math — the retro rollup is the caller's `retroJoin`/`aggregateOutcomes`
 * (lib/retrojoin.mjs); this file only AUDITS completeness and turns the aggregates into honest flags.
 *
 * HONESTY (rule 4). Candidates are ANOMALIES the documented baseline can't explain, never the baseline
 * itself (a ~0% taken rate is EXPECTED — most suggestions are never acted on). Every threshold is a
 * NAMED PLACEHOLDER; every aggregate carries n; the n-gates live HERE so a skill can't launder a thin
 * signal into a confident claim.
 */
import { fmt, fmtTurn } from '../../js/money-format.js';
import { tax } from '../../js/quotecore.js';   // the ONE tax impl — shadow net is after-tax like the realized net

// --- NAMED PLACEHOLDER thresholds (audit SHAPE, not tuned magnitudes) --------------------------------
export const MIN_N_CANDIDATE = 20;        // a tuning candidate needs at least this many suggestions in its group
export const RECENT_FRACTION = 0.25;      // field-drop audit splits the ledger's recent tail (by ts) vs the prior body
export const FIELD_DROP_MIN_WINDOW = 30;  // min rows in EACH of {prior, recent} before a field-drop flag can fire
export const FIELD_PRIOR_PRESENT = 0.8;   // a field counts as "was reliably logged" at ≥ this presence in the prior body
export const FIELD_RECENT_ABSENT = 0.5;   // …and "regressed" if its recent presence falls below this
export const POSITIONS_STALE_SEC = 3600;  // positions.json older than fills.json by more than this ⇒ a staleness flag
// Fields that SHOULD be present on ~every quote/screen row — a recent collapse means an emit path broke.
export const ALWAYS_FIELDS = ['class', 'regime'];
// Lean/conditional forward fields — reported as presence RATES (informational), never flagged as bugs.
export const OPTIONAL_FIELDS = ['validators', 'rank', 'bid', 'ask', 'posture', 'path', 'volSrc', 'grade', 'depth'];

// pure formatters (shared by the core's flag strings + the script's report) ---------------------------
export const hrs = sec => sec == null ? '—' : fmtTurn(sec / 3600);
export const gp = n => n == null ? '—' : (n >= 0 ? '+' : '') + fmt(n);
export const pct = x => x == null ? '—' : Math.round(x * 100) + '%';

export function fieldPresence(rows, field) {
  if (!rows.length) return null;
  let present = 0;
  for (const r of rows) if (r[field] != null) present++;
  return present / rows.length;
}
function isoToSec(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor(t / 1000) : null; }

/* auditDataset(sug, fillsData, posData, retroMeta, opts) → the dataset-health section.
 *   sug        — { rows, malformed, noKey } from the caller's ledger read.
 *   fillsData  — parsed fills.json (or null); posData — parsed positions.json (or null).
 *   retroMeta  — retroJoin(...).meta (nBuyOffers / nClaimed for the un-attributed signal).
 *   opts.nowSec (default Date.now()/1000), opts.sinceH (freshness window, or null). PURE. */
export function auditDataset(sug, fillsData, posData, retroMeta, { nowSec = Math.floor(Date.now() / 1000), sinceH = null } = {}) {
  const { rows, malformed = 0, noKey = 0 } = sug;
  const flags = [];   // { level: 'warn'|'info', msg }
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const newest = sorted.length ? sorted[sorted.length - 1].ts : null;
  const oldest = sorted.length ? sorted[0].ts : null;
  const sinceCut = sinceH != null ? nowSec - sinceH * 3600 : null;
  const inWindow = sinceCut != null ? rows.filter(r => r.ts >= sinceCut).length : null;

  const byScript = {};
  for (const r of rows) { const k = r.script || '(none)'; byScript[k] = (byScript[k] || 0) + 1; }

  if (malformed > 0) flags.push({ level: 'warn', msg: `${malformed} unparseable ledger line(s) — a writer emitted malformed JSON` });
  if (noKey > 0) flags.push({ level: 'warn', msg: `${noKey} ledger row(s) missing itemId/ts (dropped from every join)` });
  if (newest != null && nowSec - newest > 24 * 3600) flags.push({ level: 'info', msg: `newest suggestion is ${hrs(nowSec - newest)} old — no reads logged recently` });
  if (sinceH != null && inWindow === 0) flags.push({ level: 'warn', msg: `0 suggestions logged in the last ${sinceH}h — is an emit path (or a running loop) silent?` });

  // field-DROP detection: recent tail (RECENT_FRACTION by ts) vs prior body; flag an ALWAYS_FIELD that
  // was reliably logged in the body but collapsed recently (an emit path broke).
  const fieldAudit = { always: {}, optional: {} };
  const splitIdx = Math.floor(sorted.length * (1 - RECENT_FRACTION));
  const prior = sorted.slice(0, splitIdx);
  const recent = sorted.slice(splitIdx);
  for (const f of ALWAYS_FIELDS) {
    const pr = fieldPresence(prior, f), rc = fieldPresence(recent, f);
    fieldAudit.always[f] = { prior: pr, recent: rc };
    if (prior.length >= FIELD_DROP_MIN_WINDOW && recent.length >= FIELD_DROP_MIN_WINDOW &&
        pr != null && rc != null && pr >= FIELD_PRIOR_PRESENT && rc < FIELD_RECENT_ABSENT) {
      flags.push({ level: 'warn', msg: `field '${f}' presence dropped ${pct(pr)}→${pct(rc)} (prior n=${prior.length} → recent n=${recent.length}) — an emit path stopped logging it` });
    }
  }
  for (const f of OPTIONAL_FIELDS) fieldAudit.optional[f] = fieldPresence(rows, f);

  // fills ⇆ ledger coherence: buy offers with no plausible prior suggestion (mobile/manual — un-attributed).
  const nBuy = retroMeta ? retroMeta.nBuyOffers : 0;
  const nClaimed = retroMeta ? retroMeta.nClaimed : 0;
  const unattributed = nBuy - nClaimed;
  const unattributedRate = nBuy ? unattributed / nBuy : null;
  if (unattributedRate != null && unattributedRate > 0.5 && nBuy >= 20)
    flags.push({ level: 'info', msg: `${unattributed}/${nBuy} filled buy offers (${pct(unattributedRate)}) have no prior suggestion — un-attributed (mobile/manual, or a read that wasn't logged)` });

  // rebuildability PROXY (join-outcomes.mjs is not run here): inputs parse + positions fresh vs fills.
  const fillsSec = fillsData ? isoToSec(fillsData.generatedAt) : null;
  const posSec = posData ? isoToSec(posData.generatedAt) : null;
  const rebuild = {
    fillsParsed: !!fillsData, positionsParsed: !!posData,
    fillsGeneratedAt: fillsSec, positionsGeneratedAt: posSec,
    positionsBehindFillsSec: (fillsSec != null && posSec != null) ? fillsSec - posSec : null,
  };
  if (!fillsData) flags.push({ level: 'warn', msg: `fills.json missing/unparseable — every join is blind` });
  if (!posData) flags.push({ level: 'warn', msg: `positions.json missing/unparseable — FIFO view unavailable` });
  if (rebuild.positionsBehindFillsSec != null && rebuild.positionsBehindFillsSec > POSITIONS_STALE_SEC)
    flags.push({ level: 'warn', msg: `positions.json is ${hrs(rebuild.positionsBehindFillsSec)} behind fills.json — re-run sync/reconstruct before trusting the FIFO view` });

  // forward-data recommendations: analyses we CAN'T do because a field was never logged.
  const forward = [];
  // Both fields ship as of 2026-07-12 (lean `grade` + `depth` in suggestionEntry) — these fire only
  // while the analysis window predates the fields (self-silencing as new rows accrue).
  if (fieldPresence(rows, 'rank') != null && !rows.some(r => r.grade != null))
    forward.push(`grade LETTER is not logged in this window (only numeric 'rank') — the lean 'grade' field shipped 2026-07-12; a grade-clumping audit needs rows from after that.`);
  if (rows.length && !rows.some(r => r.spread != null || r.depth != null))
    forward.push(`no book depth snapshot in this window — the lean 'depth' ({hpv,lpv} 24h flow proxy) shipped 2026-07-12; fill-rate-vs-depth retro needs rows from after that (spread is already derivable: quickSell − quickBuy).`);

  return { total: rows.length, oldest, newest, inWindow, sinceH, byScript,
    malformed, noKey, fieldAudit, unattributed, nBuy, unattributedRate, rebuild, forward, flags };
}

/* dipLoopAudit(sugRows, retroRows) → the DL2 dip-loop (FLUSH) retro section. PURE. CANDIDATE-SURFACING,
 * never constant-mutating (the PLAN-ANALYZE encoding boundary: analyze.mjs emits evidence-with-n and
 * points at F1; F1 owns any actual retune of DIP_LOOP_*).
 *
 * WHAT IT DOES. Pulls every flush SIGNAL row (a watch-positions.mjs --dip suggestion carrying the lean `dipLoop`
 * component object) out of the ledger and JOINS it against fills.json via the SAME retroJoin rows the
 * rollup already built — retroRows aligns 1:1 with sugRows (retroJoin maps over the suggestions in order),
 * so retroRows[i].outcome tells whether a buy actually FILLED on that item within the horizon. The log is
 * WIDER than the alert: `alerted` firings (liquid + exit-clearing → the headline FLUSH) are segmented from
 * `signal-only` rows (illiquid / gated out — the standing-bid evidence, DL3's input). The alerted subset is
 * where fillability is meaningful, so the fillable-vs-not SEPARATION is computed over ALERTED rows only; the
 * signal-only distribution is reported separately (it is DL3's raw material, not a DL2 fill signal).
 *
 * HONESTY (rule 4). n≈0 — DIP_LOOP_LIQUID_FLOOR / DIP_LOOP_FLUSH_PCT / dipScore are NAMED PLACEHOLDERS; the
 * caller emits this as an n-gated CANDIDATE pointing at F1, never a calibrated conclusion. "Fillable" is the
 * retro-join's own outcome sense (a buy plausibly caused by the firing filled) — same mobile/manual-
 * attribution caveat as the rollup. */
export function dipLoopAudit(sugRows = [], retroRows = []) {
  const firings = [];
  for (let i = 0; i < sugRows.length; i++) {
    const s = sugRows[i];
    if (!s || s.dipLoop == null) continue;   // dipLoop presence IS the flush-record marker (alerted or signal-only)
    const rj = retroRows[i] || {};
    firings.push({
      itemId: s.itemId, ts: s.ts, ...s.dipLoop,
      alerted: !!s.dipLoop.alerted, gatedReason: s.dipLoop.gatedReason ?? null,
      outcome: rj.outcome ?? null, latencySec: rj.latencySec ?? null,
      fillable: rj.outcome != null && rj.outcome !== 'not-taken',
    });
  }
  const alerted = firings.filter(f => f.alerted);
  const signalOnly = firings.filter(f => !f.alerted);
  const afill = alerted.filter(f => f.fillable);
  const anot = alerted.filter(f => !f.fillable);
  const avg = (arr, k) => { const v = arr.map(f => f[k]).filter(x => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  return {
    n: firings.length, nAlerted: alerted.length, nSignalOnly: signalOnly.length,
    nFillable: alerted.filter(f => f.fillable).length, nNotFillable: anot.length,
    firings, alerted, signalOnly,
    // fillable-vs-not-taken separation over the ALERTED subset (where a bid was actually placeable).
    separation: {
      dipScoreFillable: avg(afill, 'dipScore'), dipScoreNotFillable: avg(anot, 'dipScore'),
      volDayFillable: avg(afill, 'volDay'), volDayNotFillable: avg(anot, 'volDay'),
      depthPctFillable: avg(afill, 'depthPct'), depthPctNotFillable: avg(anot, 'depthPct'),
    },
    // the illiquid signal-only distribution — DL3's input (per-item flush depth/price/frequency), not a
    // DL2 fill signal. Reported so the two populations are never conflated.
    signalOnlyDist: { n: signalOnly.length, depthPct: avg(signalOnly, 'depthPct'), volDay: avg(signalOnly, 'volDay'), dipScore: avg(signalOnly, 'dipScore') },
  };
}

/* askHeadroomAudit(sugRows, retroRows) → the Bar E ask-headroom retro section. PURE. CANDIDATE-SURFACING,
 * never constant-mutating (same encoding boundary as dipLoopAudit — evidence-with-n → F1; F1 owns any
 * retune of ASK_HEADROOM_* or the deferred Option-B clamp-widen).
 *
 * WHAT IT DOES. Pulls every ledger row carrying the lean `askHeadroom` object (computeQuote flagged the
 * robust p90 shaved a TRADED in-band top off the quoted ask). Segments TRUSTED (surfaced as a ladder note)
 * from UNTRUSTED (logged for audit only — the thin-flier path Bar E protects). Joins each to retroRows[i]
 * (1:1 with sugRows) for the realized round-trip. THE QUESTION F1 needs answered: on a TRUSTED-headroom
 * suggestion, did the realized sell actually reach the raw top (i.e. was the quoted ask genuinely leaving
 * money on the table)? As of 2026-07-12 the retro row carries `sellEach` (retrojoin.mjs — the
 * qty-weighted realized GROSS sell price of the claimed lot's closing sells), so the STRICT join IS
 * computed here: rawTopReached = sellEach ≥ askHeadroom.rawTop, null when either side is unknown (an
 * unclosed round-trip, or a pre-field row). Old buy-keyed-only rows degrade to null, never a crash.
 * F1 still owns what to DO with the answer; this reports it n-honest.
 *
 * HONESTY (rule 4). n≈0 — ASK_HEADROOM_MIN_PCT / RAWTOP_TRUST_BUCKET_VOL / ASK_HEADROOM_VOL_FLOOR are NAMED
 * PLACEHOLDERS; the caller emits this as an n-gated CANDIDATE pointing at F1, never a calibrated conclusion. */
export function askHeadroomAudit(sugRows = [], retroRows = []) {
  const rows = [];
  for (let i = 0; i < sugRows.length; i++) {
    const s = sugRows[i];
    if (!s || s.askHeadroom == null) continue;   // askHeadroom presence IS the marker (trusted or audit-only)
    const rj = retroRows[i] || {};
    const sellEach = rj.sellEach ?? null;
    const rawTop = s.askHeadroom.rawTop ?? null;
    rows.push({
      itemId: s.itemId, ts: s.ts, ...s.askHeadroom,
      trusted: !!s.askHeadroom.trusted,
      outcome: rj.outcome ?? null, realisedPerUnit: rj.realisedPerUnit ?? null,
      taken: rj.outcome != null && rj.outcome !== 'not-taken',
      // the strict Bar E join (2026-07-12): did the realized sell PRINT at/above the raw band top the
      // robust clamp shaved? null = unanswerable (no closed round-trip / pre-sellEach retro row).
      sellEach, rawTopReached: (sellEach != null && rawTop != null) ? sellEach >= rawTop : null,
    });
  }
  const trusted = rows.filter(r => r.trusted);
  const untrusted = rows.filter(r => !r.trusted);
  const takenTrusted = trusted.filter(r => r.taken);
  const avg = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  return {
    n: rows.length, nTrusted: trusted.length, nUntrusted: untrusted.length, nTakenTrusted: takenTrusted.length,
    rows, trusted, untrusted,
    // gap distribution on the trusted (surfaced) subset — how much upside the note claimed — and the
    // realized round-trip where a taken lot closed (the material F1 joins to the raw-top-reach question).
    gapPctTrusted: avg(trusted, 'gapPct'), netLeverTrusted: avg(trusted, 'netLever'),
    realisedPerUnitTaken: avg(takenTrusted, 'realisedPerUnit'),
    // strict raw-top-reach accounting over the trusted subset — n-honest: `known` counts only rows
    // where the join was answerable (a closed round-trip with both sellEach and rawTop).
    rawTopKnownTrusted: trusted.filter(r => r.rawTopReached != null).length,
    rawTopReachedTrusted: trusted.filter(r => r.rawTopReached === true).length,
  };
}

/* deriveCandidates(perNiche, sug, opts) → an array of { kind, signal, evidence, pointsAt }.
 * kind ∈ { 'context', 'candidate', 'inform' }. Only 'candidate' is a real tunable anomaly.
 *
 * HONESTY (rule 4). A ~0% taken rate is the documented BASELINE (most suggestions are never acted on),
 * NOT a finding — flagging it per-niche floods the skill with meaningless flags (the first-run failure
 * this was rewritten to avoid). So the only real candidate is a NET-NEGATIVE realized-per-attention on a
 * niche with a real realisedN; validator reject frequency is INFORM prioritization, never a verdict; and
 * the thin taken sample is reported ONCE as context. opts.minN (default MIN_N_CANDIDATE). PURE. */
export function deriveCandidates(perNiche, sug, { minN = MIN_N_CANDIDATE } = {}) {
  const cands = [];
  const rowsN = perNiche.reduce((a, g) => a + g.n, 0);
  const totalTaken = perNiche.reduce((a, g) => a + (g.filled + g.filledWorse), 0);
  if (totalTaken < minN)
    cands.push({ kind: 'context', signal: `taken sample is too thin to judge niche viability (only ${totalTaken} of ${rowsN} suggestions were acted on) — a ~0% taken rate across niches is the EXPECTED baseline, not a finding`,
      evidence: { totalTaken, n: rowsN },
      pointsAt: `no niche-gate change is warranted on taken-rate yet; re-run once fills accumulate` });
  for (const g of perNiche) {
    if (g.key === '(none)') continue;   // the mode-less bucket (quotes + --positions) is not a niche to tune
    if (g.realisedN >= minN && g.realisedPerAttention != null && g.realisedPerAttention < 0)
      cands.push({ kind: 'candidate', signal: `niche '${g.key}' realized NET-NEGATIVE per unit of attention (${gp(Math.round(g.realisedPerAttention))}/row over realisedN=${g.realisedN})`,
        evidence: { niche: g.key, realisedPerAttention: g.realisedPerAttention, realisedSum: g.realisedSum, n: g.realisedN },
        pointsAt: `whether '${g.key}' earns its slot — realized attribution, F1's spread/band/churn consolidation question` });
  }
  const rejByKey = {};
  for (const r of (sug.rows || [])) {
    if (!Array.isArray(r.validators)) continue;
    for (const v of r.validators) if (v && v.status === 'reject' && v.key) rejByKey[v.key] = (rejByKey[v.key] || 0) + 1;
  }
  for (const [k, n] of Object.entries(rejByKey).sort((a, b) => b[1] - a[1])) {
    if (n >= minN) cands.push({ kind: 'inform', signal: `validator '${k}' is the/a most-firing reject (${n} rows) — study first IF fills suggest it's over-tight; a high reject count alone is NOT evidence of over-tightness`,
      evidence: { validator: k, rejects: n, n },
      pointsAt: `the '${k}' validator thresholds (js/validate.mjs) — needs a not-taken→would-have-filled counterfactual to become a real candidate` });
  }
  return cands;
}

/* amplitudeRetro(retroRows, opts) → the F-G shadow-vs-realized readout for the amplitude niche (PLAN-
 * OSCILLATION-CYCLE F-G). PURE. Filters the retroJoin rows to `mode==='amplitude'` picks that actually
 * closed a realized round-trip (realisedNet != null) and, per pick, lines the LOGGED amplitude shadow
 * (ampBid→ampAsk + the drift-adjusted margin) up against the REALIZED fill (buyEach→sellEach + realized
 * net/u). The AGGREGATE `discount` = (Σ shadowNet − Σ realizedNet) / Σ shadowNet — the shadow-vs-real
 * fill gap (positive = the real round-trip fell short of the printed shadow). Both nets are AFTER-TAX
 * per unit so they compare apples-to-apples (shadowNet = afterTax(ampAsk) − ampBid; realizedNet =
 * realisedPerUnit, already after-tax off the FIFO match).
 *
 * HONESTY (rule 4): n-gated by the SAME MIN_N_CANDIDATE floor as the tuning candidates (no new
 * threshold). `belowFloor` is set whenever the pick count is under the floor — the current reality is
 * n=0 (no amplitude round-trip has closed yet), and the caller prints the honest "awaiting real fills"
 * line, never a fabricated table. The per-pick rows are FACTS (a printed level vs a realized fill); the
 * aggregate discount is the CONCLUSION the caller must caveat as not-yet-calibrated below the floor. */
export function amplitudeRetro(retroRows, { minN = MIN_N_CANDIDATE } = {}) {
  const picks = (retroRows || []).filter(r => r && r.mode === 'amplitude' && r.realisedNet != null && r.realisedPerUnit != null);
  const rows = picks.map(r => {
    const amp = r.amplitude || null;
    const ampBid = amp && Number.isFinite(amp.ampBid) ? amp.ampBid : null;
    const ampAsk = amp && Number.isFinite(amp.ampAsk) ? amp.ampAsk : null;
    const driftMargin = amp && amp.drift && Number.isFinite(amp.drift.margin) ? amp.drift.margin : null;
    const shadowNet = (ampBid != null && ampAsk != null) ? Math.round((ampAsk - tax(ampAsk)) - ampBid) : null;
    return { itemId: r.itemId, ampBid, ampAsk, driftMargin, shadowNet,
      buyEach: r.fillEach, sellEach: r.sellEach, realizedNet: r.realisedPerUnit };
  });
  // aggregate only over picks where BOTH a shadow net (had a logged amplitude block) and a realized net exist
  const paired = rows.filter(x => x.shadowNet != null && x.realizedNet != null);
  const shadowSum = paired.reduce((a, x) => a + x.shadowNet, 0);
  const realizedSum = paired.reduce((a, x) => a + x.realizedNet, 0);
  const discount = (paired.length && shadowSum !== 0) ? (shadowSum - realizedSum) / shadowSum : null;
  return { n: picks.length, nPaired: paired.length, minN, belowFloor: picks.length < minN,
    rows, shadowSum, realizedSum, discount };
}
