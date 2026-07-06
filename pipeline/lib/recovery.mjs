// recovery.mjs — PURE recover-vs-drop FORECAST composer for the watch loop (chunk V6).
//
// ADVISORY, OUTPUT-ONLY. This module answers the one question every NON-clean position poses —
// "recover above break-even, or keep dropping?" — by COMPOSING signals momVerdict already computes
// (nothing new is fetched, nothing is decided). It is NEVER a verdict or an alert input: it emits a
// surfaced LEAN line for the human/LLM to read, and the mechanical cut-trigger (V2/V4) stays the
// backstop. momVerdict / offerVerdict / convictionGate are untouched — this decides nothing and
// auto-cuts nothing (the byte-identical breakdown-cut invariant is preserved trivially: no verdict/
// alert path calls this).
//
// HONESTY (process rule 4 — baked into the code + the rendered drivers): it is a LEAN, not a
// probability. It leans on the ROBUST STRUCTURAL shape (UK day/night seasonality via diurnalRead,
// the item's regime/phase, its structural support) rather than a precise per-item-per-hour number —
// per-item hourly magnitude is low-sample (the F1 cell-count problem), so we do NOT present a false
// per-hour precision. It is BLIND to shocks / repricings: phase==='spike' is the ONLY warning we
// have and it CAPS confidence (a decisive lean is downgraded to `uncertain` — we cannot forecast a
// recovery through a possible ongoing pump/repricing).
//
// COMPOSITION (each driver is a robust structural signal, already computed for the quote):
//   Seasonal    — diurnalRead: a quiet-hour trough that dipped-and-recovered yesterday → recover.
//   Trend/phase — regimeLabel (rising/flat → recover · falling → drop) + phase (basing → recover ·
//                 decay → drop · spike → warning, caps confidence).
//   Persistence — underwaterHours.coveredLiquidPeak (underwater THROUGH a liquid window → the
//                 seasonal excuse is spent → drop) + position vs V2 structural support (at/above →
//                 recover · below → drop).

// A decisive lean requires the winning side to lead by at least this many concordant drivers; a
// lead of 0 (a tie / conflict) or 1 (a lone weak signal) → `uncertain`. PLACEHOLDER, cited nowhere
// as calibrated — the same discipline as the levels.mjs / phase() cutoffs. Leaning decisive only on
// ≥2 concordant structural signals is the honest floor (one signal is not a forecast).
export const LEAN_MARGIN = 2;

/* PURE. Compose the already-computed signals into a lean. Inputs (all pre-derived by the caller —
   this re-derives nothing, mirroring the "compose, don't fetch" contract):
     diurnal      — diurnalRead(ts5m, now) result | null   (seasonal)
     regime       — regimeLabel(regimeDrift(...)) result { label, falling, rising } | null
     phase        — phase(ts6h) result { phase, ... } | null
     underwater   — underwaterHours(ts5m, breakEven) result { hours, coveredLiquidPeak } | null
     price        — the live instabuy (clear-now price) | null   (for the support comparison)
     support      — the V2 structural support level | null
   Returns { lean: 'likely-recovers'|'likely-drops'|'uncertain', drivers: [string], recover, drop,
     spike } — `drivers` is the ordered human-readable list (seasonal → trend → persistence). */
export function recoveryRead({ diurnal, regime, phase, underwater, price = null, support = null } = {}) {
  const drivers = [];
  let recover = 0, drop = 0, spike = false;

  // --- Seasonal (diurnal) --------------------------------------------------------------------
  if (diurnal && diurnal.quiet && diurnal.yesterdayDipped && diurnal.yesterdayRecovered) {
    recover++; drivers.push('post-trough hour');
  }

  // --- Trend: regime direction ---------------------------------------------------------------
  if (regime && regime.rising)      { recover++; drivers.push('rising regime'); }
  else if (regime && regime.falling){ drop++;    drivers.push('falling regime'); }
  else if (regime && regime.label === 'flat') { recover++; drivers.push('flat regime'); }

  // --- Trend: phase shape --------------------------------------------------------------------
  const ph = phase && phase.phase;
  if (ph === 'basing')      { recover++; drivers.push('basing'); }
  else if (ph === 'decay')  { drop++;    drivers.push('decaying lows'); }
  else if (ph === 'spike')  { spike = true; drivers.push('elevated (spike) — blind to a repricing'); }

  // --- Persistence ---------------------------------------------------------------------------
  if (underwater && underwater.coveredLiquidPeak) {
    drop++; drivers.push('underwater through a liquid window');
  }
  if (support != null && price != null) {
    if (price >= support) { recover++; drivers.push('at support'); }
    else                  { drop++;    drivers.push('below support'); }
  }

  const net = recover - drop;
  let lean;
  if (spike)                lean = 'uncertain';                 // a spike caps confidence (blind to the pump/repricing)
  else if (net >= LEAN_MARGIN)  lean = 'likely-recovers';
  else if (net <= -LEAN_MARGIN) lean = 'likely-drops';
  else                          lean = 'uncertain';            // tie / lone weak signal → conflicting or weak
  return { lean, drivers, recover, drop, spike };
}

/* PURE. The compact rendered advisory line, e.g.
     recovery-read: likely recovers — post-trough hour · flat regime · at support (a lean, not a probability)
   Returns null for a null read. The "(a lean, not a probability)" caveat is baked in (process
   rule 4 — never present a false precision). */
export function recoveryLine(read) {
  if (!read) return null;
  const label = read.lean === 'likely-recovers' ? 'likely recovers'
    : read.lean === 'likely-drops' ? 'likely drops' : 'uncertain';
  const body = read.drivers.length ? read.drivers.join(' · ') : 'insufficient signal';
  return `recovery-read: ${label} — ${body} (a lean, not a probability)`;
}

// Verdict polarity for the conflict trigger: is the current verdict a HOLD/positive stance, a
// CUT/negative one, or neutral? A recovery-read that CONTRADICTS the stance (a hold-ish verdict with
// a drop-lean, or a cut-ish verdict with a recover-lean — the 2026-07-06 webweaver anchor) is the
// highest-value thing to surface. Pure string classification; no market math.
export function verdictPolarity(verdict) {
  if (verdict == null) return 'neutral';
  const v = String(verdict).toUpperCase();
  if (v.includes('CUT') || v.includes('CLEAR') || v.includes('CANCEL')
    || v === 'FALLING' || v === 'UNDERWATER' || v === 'SKIP') return 'cut';
  if (v.includes('HOLD') || v.includes('WATCH') || v.includes('BID-OK')
    || v.includes('BID-BEHIND') || v.includes('DIURNAL') || v.includes('SHOCK')) return 'hold';
  return 'neutral';
}

// A lean CONFLICTS with the verdict when a hold-ish stance draws a drop-lean, or a cut-ish stance
// draws a recover-lean. Only a decisive lean can conflict (an `uncertain` lean never does).
export function leanConflictsVerdict(lean, verdict) {
  const pol = verdictPolarity(verdict);
  if (lean === 'likely-drops'    && pol === 'hold') return true;
  if (lean === 'likely-recovers' && pol === 'cut')  return true;
  return false;
}

// Within this fraction ABOVE break-even a held lot is "thin margin" (the naive HOLD isn't obviously
// safe — a small drop puts it underwater). PLACEHOLDER, uncalibrated.
export const THIN_MARGIN_PCT = 0.01;   // ≤1% above break-even

/* PURE. The TRIGGER GATE (Ben, 2026-07-06 — "if it isn't in a great position, sanity check"):
   compute the recovery-read cheaply on every held lot + resting offer, but SURFACE the line ONLY
   when the naive action isn't obviously right. Returns { surface, reasons: [string] }.
   HELD-lot surface conditions:
     (a) underwater                         — instabuy < break-even
     (b) thin margin just above break-even  — instabuy within THIN_MARGIN_PCT of break-even
     (c) a decaying / unfilled ask          — an ask is listed but has filled nothing
     (e) the lean CONFLICTS with the verdict — a green lot with a drop-lean (the highest-value case)
   BID surface condition:
     (d) a resting bid whose fill hinges on direction — passed as `bidDirectional`
   SILENT on a cleanly-good position (comfortably green + filling + rising + clean momentum) — no
   condition fires, the naive action stands. Same informative-gating discipline as V1/V2's lines. */
export function recoveryTrigger({ kind = 'held', instabuy = null, breakEven = null, lean = null,
  verdict = null, askListedNotFilling = false, bidDirectional = false } = {}) {
  const reasons = [];
  if (kind === 'bid') {
    if (bidDirectional) reasons.push('fill hinges on direction');
    return { surface: reasons.length > 0, reasons };
  }
  // held lot
  if (instabuy != null && breakEven != null) {
    if (instabuy < breakEven) reasons.push('underwater');
    else if (instabuy < breakEven * (1 + THIN_MARGIN_PCT)) reasons.push('thin margin above break-even');
  }
  if (askListedNotFilling) reasons.push('ask not filling');
  if (leanConflictsVerdict(lean, verdict)) reasons.push('lean conflicts with verdict');
  return { surface: reasons.length > 0, reasons };
}
