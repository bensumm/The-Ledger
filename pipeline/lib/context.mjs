/**
 * context.mjs — the Pipeline-v2 ITEM CONTEXT CHAIN + the ONE shared held-verdict renderer (chunk P0).
 *
 * WHY THIS EXISTS. Before P0 the two single-item surfaces disagreed by construction: `quote.mjs
 * --positions` and `watch.mjs` each re-derived a held lot's verdict inline, from DIFFERENT inputs.
 * quote.mjs never read the live offer book or the watch loop's cross-pass memory, so it could not
 * print the `HOLD — ask filling` (V3 Gate-D) softening or any conviction-timer state — watch.mjs
 * could. Same lot, two answers. This module is the single home that ends the fork: one staged
 * enricher chain builds an `ItemContext`, and one parameterized renderer turns it into either
 * surface's verdict string. Both surfaces call the SAME functions here, so the matrix cannot drift.
 *
 * THE CHAIN (staged, PURE enrichers — the momVerdict optional-degradation precedent: a missing
 * stage input degrades downstream, it never throws):
 *
 *   identity → market → history → intraday → position → (validate / paths: LATER chunks)
 *
 *   identity  { id, name }
 *   market    { row }                     Tier-0 computeQuote row (js/quotecore.js) — the live read
 *   history   { phase, termStructure }    multi-day trajectory; termStructure is a P3 extension point
 *   intraday  { ts5m, ts6h, ts1h, reach } Tier-2 per-item series (+ P2 reach candidate for validate)
 *   position  { held, qty, avgCost, be, lotValue, ask, bid, askFilling, lotCtx, mv,
 *               support, cutTrigger, deltas, gate, newStateEntry, thesis }
 *
 * PURITY / IO BOUNDARY. NOTHING here fetches or touches fs. The CALLER loads the data (loadSnapshot /
 * fetchItemInputs for market+intraday, offers.json via lib/offers.mjs for the book, the watch-state
 * entry via lib/watchstate.mjs, the hold-thesis entry via lib/holdthesis.mjs, and the structural
 * support/cut-trigger from the already-fetched ts1h) and feeds it in. That keeps every stage
 * node-importable + fixture-tested with no network. The position stage's conviction math is the pure
 * computeDeltas / advanceState / convictionGate from watchstate.mjs — quote.mjs gains the same
 * arm-then-confirm read watch.mjs has, off the SAME shared state file.
 *
 * THE POSITION STAGE loads (via its caller) offers.json + watch-state for ALL consumers — that is
 * precisely what gives `quote.mjs --positions` the askFilling softening + conviction timers it
 * previously lacked. `ask`/`bid` are NORMALIZED offers `{ price, filled, total }` so a caller can
 * source them from offers.json (quote) OR the live exchange log (watch) without this module caring.
 *
 * THE RENDERER is shared and PARAMETERIZED, not forked: `renderHeldVerdict(ctx, { mode })` emits
 * `compact` (the quote.mjs table Verdict cell) or `verbose` (the watch.mjs heldAction line) off the
 * SAME `heldMomVerdict(ctx)` decision. Both strings are reproduced VERBATIM from the pre-P0 inline
 * functions so existing output stays byte-identical; only the shared source of `mv` changed.
 */
import { computeQuote, momVerdict, breakEven, phase, BIG_TICKET_GP, FRESH_HOURS } from '../../js/quotecore.js';
import { fmtP } from '../../js/money-format.js';
import { computeDeltas, advanceState, convictionGate, pathPersistence,
  verdictPersistence, VERDICT_PERSIST_MS } from './watchstate.mjs';
import { enumeratePaths, weighPaths } from '../../js/paths.mjs';

// ---------------------------------------------------------------------------
// STAGE ENRICHERS — each (ctx, input) → ctx, mutating exactly one namespace and returning ctx so
// they chain. A fresh ctx is `{}`. Nulls in / missing prior namespaces degrade gracefully.
// ---------------------------------------------------------------------------

/* identity — the item's id + display name (the only always-present namespace). */
export function identityStage(ctx, { id, name } = {}) {
  ctx.identity = { id: id ?? null, name: name ?? (id != null ? '#' + id : null) };
  return ctx;
}

/* market — the Tier-0 live read. `inp` is fetchItemInputs()'s output (latest/ts5m/ts6h/vol24[/ts1h]);
   held/asked/limit/guide match computeQuote's existing call sites. Row is null only if computeQuote
   is handed nothing usable (it tolerates missing feeds itself). */
export function marketStage(ctx, { inp = {}, guide = null, limit = null, held = false, asked = true } = {}) {
  ctx.market = { row: computeQuote({ ...inp, guide, limit, held, asked }) };
  return ctx;
}

/* history — multi-day trajectory. phase() over the 6h series (spike/decay/basing); termStructure is
   the P3 read (js/termstructure.mjs — 1/3/7/14/28d + durable floor + typical fluctuation), passed in by
   the caller when it has a daily-mid series. Left null when absent so downstream `?? null`-degrades; the
   BUY-side floorValidator reads it (a HELD lot on this chain is a sell decision → floorValidator degrades
   regardless, so quote.mjs --positions deliberately leaves it null). */
export function historyStage(ctx, { ts6h = null, termStructure = null } = {}) {
  ctx.history = { phase: ts6h ? phase(ts6h) : null, termStructure };
  return ctx;
}

/* intraday — the Tier-2 per-item series the position/verdict stages read (ts5m drives momVerdict's
   Gates 1/2/D; ts1h feeds the window/support context). P2 wired the reach extension point: an
   optional `reach` candidate `{ side:'ask'|'bid', level, windowHours?, nights?, now? }` rides this
   namespace so js/validate.mjs's reachValidator can score a would-be bid/ask against the ts1h window
   read WITHOUT this module (or the validator) fetching anything — the caller sets both series + level.
   Bands are still a later extension point; `reach` defaults to null so existing callers are unchanged. */
export function intradayStage(ctx, { ts5m = null, ts6h = null, ts1h = null, reach = null } = {}) {
  ctx.intraday = { ts5m, ts6h, ts1h, reach };
  return ctx;
}

// Is the held lot's OWN ask actively transacting ABOVE the clear price? The V3 Gate-D fill-progress
// heuristic, byte-identical to watch.mjs's inline test — an active sell with filled units priced
// above the live instabuy. Normalized offer shape `{ price, filled, total }`; null ask → false.
function askIsFilling(row, ask) {
  return !!(ask && ask.filled > 0 && row && row.quickSell != null && ask.price > row.quickSell);
}

// ---------------------------------------------------------------------------
// VN-1 DISPLAYED-VERDICT layer — ONE home for the token + label so the table cell and the note
// can never disagree (RC4 of PLAN-VERDICT-NOISE dissolves by construction). The RAW verdict
// (momVerdict + the mv-null fallbacks) is UNTOUCHED and stays what the suggestions ledger logs;
// this layer only decides what the two surfaces RENDER, via watchstate.verdictPersistence.
// ---------------------------------------------------------------------------

/* rawHeldToken — the ONE raw display token for a held lot (byte-identical to the pre-VN-1
   watch.mjs heldVerdict()): the momVerdict verdict string when one fired, else the
   FALLING / UNDERWATER / HOLD / NO-QUOTE fallbacks. This is what the ledger logs (raw, honest)
   and what feeds the persistence gate as the candidate. */
export function rawHeldToken(row, be, mv) {
  if (mv) return mv.verdict;
  if (!row) return 'NO-QUOTE';
  if (row.falling) return 'FALLING';
  if (row.quickSell != null && be != null && row.quickSell < be) return 'UNDERWATER';
  return row.quickSell != null ? 'HOLD' : 'NO-QUOTE';
}

// VN-3 (F2) — the PARKED-at-break-even dead-band. RC1: a lot whose break-even sits INSIDE the 5m
// noise band flips HOLD↔UNDERWATER on every print ("is live above BE?" is a coin-flip per pass —
// the Berserker shape: BE 3.15m, live 3.10–3.17m). Both tokens rank severity 0 (deliberately, so
// the mv-null set stayed byte-identical in VN-1), so persistence alone can't stop that flap. When
// live sits within a dead-band of BE on a CLEAN read, the display names the actual situation —
// `PARKED — at break-even (±X)` — instead of alternating, and watch.mjs suppresses the ungated
// UNDERWATER headline inside the band (the falling-regime alert is unchanged — PARKED requires a
// non-falling row). Display-only; the raw HOLD/UNDERWATER token still flips underneath (logged).
// ⚠ BOTH PLACEHOLDERS (rule 4, n=1 session): dead-band = HALF the current 2h raw band width
// (BE_DEADBAND_BAND_FRAC), floored at a fixed pct of BE (BE_DEADBAND_MIN_PCT) — shape, not
// calibration; F1-retro owns tuning.
export const BE_DEADBAND_BAND_FRAC = 0.5;    // fraction of the 2h raw band width
export const BE_DEADBAND_MIN_PCT = 0.005;    // floor: ±0.5% of break-even

/* isParkedAtBE — PURE: a held lot counts as PARKED when no momVerdict fired (a clean read — any
   escalated/softened state keeps its own token), the regime is not falling, and |live − BE| sits
   inside the dead-band. Returns the dead-band gp (truthy) or null. */
export function parkedDeadband(row, be) {
  if (!row || be == null || row.quickSell == null || row.falling) return null;
  const bandW = (row.rawBandHi != null && row.rawBandLo != null) ? (row.rawBandHi - row.rawBandLo) : 0;
  const dead = Math.max(BE_DEADBAND_BAND_FRAC * bandW, BE_DEADBAND_MIN_PCT * be);
  return Math.abs(row.quickSell - be) <= dead ? dead : null;
}

/* heldDisplay — compute the persistence-gated DISPLAY read for a held lot. PURE; the caller
   supplies the (possibly nulled-for-fresh) prior watch-state entry and the clock, exactly like
   pathsStage. Returns:
     { raw, token, label, arming, armedKey, armedMs, persistMs, confirmedThisPass,
       unreliableThisPass, mvDisplay, state:{displayVerdict, verdictArmedKey, verdictArmedSince} }
   - `token` is the persistence-gated verdict token; `label` is the FULL rendered string
     (token + an "(X arming ~Nm/Pm)" suffix while a challenger arms, + a
     "(read unreliable this pass — reason)" note on a NO-READ demotion).
   - `mvDisplay` is what renderHeldVerdict consumes: the RAW mv (possibly null) when nothing
     diverges — so rendering is byte-identical to pre-VN-1 — or a `{ synthetic:true, verdict:label,
     raw }` wrapper when the displayed label differs from the raw read.
   - `state` rides the newStateEntry ADDITIVELY (only watch.mjs persists it; quote reads-only —
     with no watch loop running the prior is stale/absent, so this degrades to the instantaneous
     verdict: an honest degrade, documented in MONITORING.md step 4). */
export function heldDisplay({ row = null, be = null, mv = null, prior = null,
  nowMs = Date.now(), persistMs = VERDICT_PERSIST_MS, thesis = null, diurnalAsk = null } = {}) {
  const raw = rawHeldToken(row, be, mv);
  const immediate = !!(mv && mv.action === 'CUT' && mv.gate === 2);   // the Gate-2 breakdown CUT invariant
  // VN-2 THESIS RENDER FRAME (RC7): a lot with a DECLARED plan whose live price still holds ABOVE
  // the declared tripwire RENDERS as the plan — `HOLD — per thesis: exit <declared> @ <window> ·
  // abort < <tripwire>` — with the band-flip read demoted to the raw/notes layer. The exit is the
  // DECLARED exitPrice (falling back to the caller-supplied diurnal ASK off the in-hand 1h series —
  // never the 2h band top, which under-priced the diurnal exit: the 43.60m-band-top-vs-44.22m-peak
  // money leak). The Gate-2 breakdown CUT ALWAYS overrides the frame (`immediate` above — same
  // precedence convictionGate #1 encodes); live at/below the tripwire → frame off, normal
  // escalation resumes. Display-only: momVerdict + the raw ledger token are untouched.
  const live = row ? row.quickSell : null;
  const frameActive = !immediate && thesis && thesis.tripwire != null && live != null && live > thesis.tripwire;
  let frameLabel = null;
  if (frameActive) {
    const exit = thesis.exitPrice ?? diurnalAsk ?? null;
    const exitBit = exit != null ? `exit ${fmtP(exit)}` : 'exit per plan';
    const winBit = thesis.window != null ? ` @ ${thesis.window}h local` : '';
    const pathBit = thesis.path != null ? ` (${thesis.path})` : '';
    frameLabel = `HOLD — per thesis${pathBit}: ${exitBit}${winBit} · abort < ${fmtP(thesis.tripwire)}`;
  }
  // VN-3 (F2): PARKED dead-band — only reachable on a clean mv-null read (never masks an
  // escalated/softened verdict) and only when no thesis frame governs.
  const deadband = (!frameActive && !immediate && mv == null) ? parkedDeadband(row, be) : null;
  const parkedActive = deadband != null;
  const candidate = frameActive ? 'HOLD — per thesis' : parkedActive ? 'PARKED' : raw;
  const vp = verdictPersistence(prior, { candidate, immediate, now: nowMs, persistMs });
  const min = ms => Math.max(0, Math.round((ms || 0) / 60000));
  const token = vp.displayVerdict ?? candidate;
  // the frame's/PARKED's full label replaces the bare token whenever it is what displays
  const parkedShown = parkedActive && token === 'PARKED';
  let label = (frameActive && token === 'HOLD — per thesis') ? frameLabel
    : parkedShown ? `PARKED — at break-even (±${fmtP(Math.round(deadband))})${be != null ? ` — list ≥ ${fmtP(be)}` : ''}`
    : token;
  if (vp.arming && vp.armedKey != null)
    label += ` (${vp.armedKey} arming ~${min(vp.armedMs)}m/${min(persistMs)}m)`;
  if (vp.unreliableThisPass)
    label += ` (read unreliable this pass${row && row.reliableReason ? ` — ${row.reliableReason}` : ''})`;
  const frameShown = frameActive && token === 'HOLD — per thesis';
  const diverges = (vp.displayVerdict !== raw) || vp.arming || vp.unreliableThisPass || frameShown || parkedShown;
  const mvDisplay = diverges
    ? { synthetic: true, kind: frameShown ? 'frame' : parkedShown ? 'parked' : 'persist', verdict: label, raw }
    : mv;
  return {
    raw, token, label, frame: frameShown, parked: parkedShown, arming: vp.arming, armedKey: vp.armedKey,
    armedMs: vp.armedMs, persistMs, confirmedThisPass: vp.confirmedThisPass,
    unreliableThisPass: vp.unreliableThisPass, mvDisplay,
    state: { displayVerdict: vp.displayVerdict ?? candidate,
      verdictArmedKey: vp.arming ? vp.armedKey : null,
      verdictArmedSince: vp.arming ? vp.armedSince : null },
  };
}

/* position — THE load-bearing stage. Reads ctx.market.row + ctx.intraday.ts5m and folds in the lot,
   the live book (ask/bid), the structural support/cut-trigger, the watch-state prior + the declared
   hold thesis. Produces the ONE lotCtx + momVerdict `mv` both surfaces render, plus the conviction
   gate (arm-then-confirm) and the next-pass state entry (the caller persists it — watch does; quote
   reads-only). Every conviction input is optional: absent a watch-state prior / support / nowMs the
   gate degrades to no-escalation and the verdict is unchanged (the pre-P0 quote.mjs behavior).

   inputs:
     held, qty, avgCost, buyTs   the lot (buyTs = oldest lot's unix seconds; feeds the fresh-entry gate)
     ask, bid                    normalized live offers { price, filled, total } | null
     support, cutTrigger         structuralSupport(dayLows) + its tripwire (from ts1h) | null
     watchStatePrior             the prior `held:<id>` watch-state entry | null (→ first-seen)
     nowMs                       ms clock for the conviction streak durations
     thesisEntry                 the declared hold-thesis entry { exitPrice, tripwire, horizon } | null */
export function positionStage(ctx, {
  held = false, qty = null, avgCost = null, buyTs = null,
  ask = null, bid = null, support = null, cutTrigger = null,
  watchStatePrior = null, nowMs = Date.now(), thesisEntry = null, diurnalAsk = null,
} = {}) {
  const row = ctx.market ? ctx.market.row : null;
  const ts5m = ctx.intraday ? ctx.intraday.ts5m : null;
  const be = held
    ? (avgCost != null ? breakEven(avgCost) : null)
    : (row && row.quickBuy != null ? breakEven(row.quickBuy) : null);
  const lotValue = (held && qty != null && avgCost != null) ? qty * avgCost : null;
  const askFilling = askIsFilling(row, ask);
  const lotCtx = { buyTs: buyTs ?? null, askFilling };
  // The ONE momVerdict both surfaces render — computed once, off the full lotCtx (the fork's cure).
  const mv = held ? momVerdict(row, be, lotValue, ts5m, undefined, lotCtx) : null;

  // Conviction (arm-then-confirm) — the timers quote.mjs previously lacked. Pure watchstate math over
  // the shared state file. Guarded shape: any missing input degrades to a no-escalation gate.
  let deltas = null, gate = { escalate: false, armed: false, reason: null }, newStateEntry = null;
  if (held && row) {
    const cur = {
      identity: `hld:${qty}:${avgCost != null ? Math.round(avgCost) : ''}`,
      instabuy: row.quickSell, mom: row.mom, bandTop: row.rawBandHi, breakEven: be, support,
    };
    deltas = computeDeltas(watchStatePrior, cur, nowMs);
    newStateEntry = advanceState(watchStatePrior, cur, nowMs);
    gate = convictionGate({
      verdict: mv && mv.verdict, gate: mv && mv.gate,
      price: row.quickSell, support, cutTrigger,
      underwaterMs: deltas.underwaterMs, belowSupportMs: deltas.belowSupportMs, breakdownMs: deltas.breakdownMs,
      thesis: thesisEntry, underwater: deltas.underwater,
    });
  }

  // VN-1: the persistence-gated DISPLAY read (one home; both surfaces render from it via
  // renderHeldVerdict). A fresh episode (first-seen / reset) drops the prior so a re-bought lot
  // re-establishes its label, mirroring the conviction counters. Fields ride newStateEntry
  // ADDITIVELY (only watch.mjs persists; quote is read-only per the P0 contract).
  let display = null;
  if (held && row) {
    const freshD = deltas ? (deltas.firstSeen || deltas.reset) : true;
    display = heldDisplay({ row, be, mv, prior: freshD ? null : watchStatePrior, nowMs,
      thesis: thesisEntry, diurnalAsk });   // VN-2: declared plan → render frame (quote passes the declared plan verbatim; watch adds the diurnal-ask fallback)
    if (newStateEntry) {
      newStateEntry.displayVerdict = display.state.displayVerdict;
      newStateEntry.verdictArmedKey = display.state.verdictArmedKey;
      newStateEntry.verdictArmedSince = display.state.verdictArmedSince;
    }
  }

  ctx.position = {
    held, qty, avgCost, buyTs: buyTs ?? null, be, lotValue,
    ask, bid, askFilling, lotCtx, mv, display,
    support, cutTrigger, deltas, gate, newStateEntry, thesis: thesisEntry ?? null,
  };
  return ctx;
}

/* --- paths stage (V2-P4b) — the path-engine slice of the chain ------------------------------------
   Derives the js/paths.mjs scoring context from the already-built namespaces (market row + history
   phase + position lot), enumerates + weighs the candidate paths, and runs the P4b PERSISTENCE GATE
   (pathPersistence, lib/watchstate.mjs — arm-then-confirm + hysteresis) against the prior watch-state
   entry so a flapping weight can never whiplash the headline path. PURE — no fetch, no fs; the caller
   supplies the prior state entry + clock, exactly like positionStage's conviction inputs.

   enteredUnder source (P4b contract): the tracked hold-thesis entry's `enteredUnder` (declared via
   `thesis.mjs set --path`), read off ctx.position.thesis; null when undeclared — NEVER fabricated.
   The declared `path` field additionally SEEDS the incumbent when the watch-state entry carries no
   persisted currentPath yet (a declared plan shouldn't be displaced without arm-then-confirm just
   because the state file is fresh).

   Persistence fields ride the position stage's `newStateEntry` ADDITIVELY (`currentPath` /
   `pathArmedKey` / `pathArmedSince` / `enteredUnder`) so the ONE writer (watch.mjs) persists them
   with the entry it already saves; quote.mjs builds the same ctx but never persists (P0 read-only
   contract). `fresh` (first-seen / reset, from position deltas) drops the prior so a re-bought lot
   re-establishes its path from scratch, mirroring the conviction counters. */
export function pathsStage(ctx, { watchStatePrior = null, nowMs = Date.now(), fresh = null } = {}) {
  const row = ctx.market ? ctx.market.row : null;
  const ph = ctx.history ? ctx.history.phase : null;
  const p = ctx.position || {};
  // fresh (first-seen / reset ⇒ drop the prior) defaults off the position stage's own deltas,
  // so buildItemContext callers don't have to pre-compute what the chain already knows.
  const isFresh = fresh != null ? !!fresh : !!(p.deltas && (p.deltas.firstSeen || p.deltas.reset));
  const thesis = p.thesis || null;
  const enteredUnder = thesis && thesis.enteredUnder != null ? thesis.enteredUnder : null;
  const declaredPath = thesis && thesis.path != null ? thesis.path : null;
  const ts = ctx.history ? ctx.history.termStructure : null;
  const floor = (ts && ts.hasData && ts.floor != null) ? ts.floor : null;
  const live = row ? (row.quickSell ?? row.mid ?? null) : null;
  // the DERIVED scoring context js/paths.mjs speaks (all fields optional; absence degrades there)
  const derived = {
    held: !!p.held,
    regime: row ? (row.falling ? 'falling' : row.rising ? 'rising' : (row.regime && row.regime.ok ? 'flat' : null)) : null,
    phase: ph ? (ph.phase ?? null) : null,
    mom: row ? (row.mom ?? null) : null,
    underwater: (p.be != null && row && row.quickSell != null) ? row.quickSell < p.be : undefined,
    aboveFloor: (floor != null && live != null) ? live >= floor : undefined,
    breakEven: p.be ?? null,
    quickBuy: row ? row.quickBuy : null, quickSell: row ? row.quickSell : null,
    optBuy: row ? row.optBuy : null, optSell: row ? row.optSell : null,
    floor,
    reliable: row ? row.reliable : undefined,
    bandWidthPct: (row && row.optBuy > 0 && row.optSell != null) ? (row.optSell - row.optBuy) / row.optBuy : null,
    enteredUnder,
  };
  const weighedRes = weighPaths(enumeratePaths(derived), derived);   // {dominant, weighed, enteredUnder, migration(RAW)}
  // Persistence: seed the incumbent from the DECLARED path when no persisted currentPath exists yet.
  const prior0 = isFresh ? null : watchStatePrior;
  const prior = (prior0 && prior0.currentPath != null) ? prior0
    : (declaredPath != null ? { ...(prior0 || {}), currentPath: declaredPath } : prior0);
  const incumbentKey = prior && prior.currentPath != null ? prior.currentPath : null;
  const incumbent = incumbentKey != null ? weighedRes.weighed.find(w => w.key === incumbentKey) : null;
  const persisted = pathPersistence(prior, {
    dominantKey: weighedRes.dominant ? weighedRes.dominant.key : null,
    dominantViability: weighedRes.dominant ? weighedRes.dominant.viability : null,
    incumbentViability: incumbent ? incumbent.viability : null,
    enteredUnder, now: nowMs,
  });
  ctx.paths = { ...weighedRes, persisted, declaredPath };
  // fold the persistence fields into the next-pass state entry (ADDITIVE; only watch.mjs saves it)
  if (ctx.position && ctx.position.newStateEntry) {
    ctx.position.newStateEntry.currentPath = persisted.currentPath ?? null;
    ctx.position.newStateEntry.pathArmedKey = persisted.armedKey ?? null;
    ctx.position.newStateEntry.pathArmedSince = persisted.armedSince ?? null;
    ctx.position.newStateEntry.enteredUnder = enteredUnder ?? null;
  }
  return ctx;
}

/* buildItemContext — compose the whole chain from per-stage inputs. Any stage's input may be omitted
   (that namespace still initialises, degrading downstream). Returns the ctx object. `paths` (P4b)
   runs the path stage after position; pass `{ watchStatePrior, nowMs, fresh }` (or `true` for
   defaults) to weigh + persistence-gate the lot's thesis-paths. */
export function buildItemContext({ identity = {}, market = {}, history = {}, intraday = {}, position = null, paths = null } = {}) {
  const ctx = {};
  identityStage(ctx, identity);
  marketStage(ctx, market);
  historyStage(ctx, history);
  intradayStage(ctx, intraday);
  if (position) positionStage(ctx, position);
  if (paths) pathsStage(ctx, paths === true ? {} : paths);
  return ctx;
}

// ---------------------------------------------------------------------------
// SHARED HELD-VERDICT RENDERER — one home, two parameterized outputs. Both read ctx.position.mv
// (the single momVerdict decision) so the two surfaces can never disagree on the verdict.
// ---------------------------------------------------------------------------

/* The ONE held-verdict decision. Returns the position stage's momVerdict (or null when not held /
   not escalated). Both render modes and both surfaces consume this. */
export function heldMomVerdict(ctx) {
  return ctx && ctx.position ? ctx.position.mv : null;
}

/* COMPACT — the quote.mjs `--positions` table Verdict cell. Body reproduced VERBATIM from the pre-P0
   quote.mjs verdict() so booked-lots output stays byte-identical; the only change is that `mv` now
   carries the askFilling softening (the HOLD — ask filling case quote could not previously reach). */
function heldVerdictCompact(row, be, mv) {
  const instabuy = row ? row.quickSell : null;
  if (mv) {
    const at = mv.listAt != null ? ` @ ${fmtP(mv.listAt)}` : '';
    const tag = mv.action === 'NO_READ'       ? ` (unreliable: ${row.reliableReason} — no action, keep ask ≥ break-even)`
              : mv.action === 'DIURNAL_WATCH' ? ' (quiet-hour trough; dipped+recovered yesterday — hold ≥ break-even, re-check at a liquid hour)'
              : mv.action === 'SHOCK_WATCH'   ? ' (one-off shock not a bleed — hold one more cycle; cut on a fresh low)'
              : mv.gate === 'D'               ? ' (underwater through a liquid window — persistence, not the clock)'
              : mv.action === 'CUT'           ? ' (2h breakdown & underwater — free capital)'
              : mv.action === 'CLEAR'         ? (row.rising ? ` (2h breakdown vs uptrend; big-ticket ≥ ${BIG_TICKET_GP / 1e6}m → clearing)` : ' (2h breakdown — bank it, don’t hold for the premium)')
              : mv.action === 'HOLD_WATCH'    ? ` (2h pullback vs uptrend on a sub-${BIG_TICKET_GP / 1e6}m lot — may reabsorb)`
              : ' (2h breakup — patient on the sell, don’t sell into strength)';
    return `${mv.verdict}${at}${tag}`;
  }
  if (instabuy == null) return 'NO QUOTE';
  if (row.falling) {
    return instabuy >= be
      ? `SELL @ ${fmtP(instabuy)} (falling — clear in profit)`
      : `CUT @ ${fmtP(instabuy)} (falling & underwater — free capital)`;
  }
  const listAt = (row.optSell != null && row.optSell >= be) ? row.optSell
               : (instabuy >= be ? instabuy : be);
  if (listAt >= be && (row.optSell != null && row.optSell >= be)) return `HOLD — list @ ${fmtP(listAt)}`;
  if (instabuy >= be) return `HOLD — list @ ${fmtP(instabuy)}`;
  return `HOLD — underwater, list ≥ ${fmtP(be)} (break-even)`;
}

/* VERBOSE — the watch.mjs per-held action line. Body reproduced VERBATIM from the pre-P0 watch.mjs
   heldAction() (it now takes the shared `mv` rather than recomputing it — same inputs, same result). */
function heldActionVerbose(row, be, lotValue, ts5m, mv) {
  const instabuy = row ? row.quickSell : null;
  if (mv) {
    if (mv.action === 'NO_READ')
      return `NO-READ (${row.reliableReason}) — the quote isn't a reliable price right now (Gate 0). No price action; keep any ask ≥ break-even ${fmtP(be)} and re-check at the next liquid window.`;
    if (mv.action === 'DIURNAL_WATCH')
      return `DIURNAL-WATCH @ ${fmtP(mv.listAt)} — underwater at a quiet hour that dipped & recovered yesterday (Gate 1). Hold ≥ break-even; do NOT cut into the trough. If still underwater at a liquid hour, the defense is spent → re-assess.`;
    if (mv.action === 'SHOCK_WATCH')
      return `SHOCK-WATCH @ ${fmtP(mv.listAt)} — a one-off volume-spike shock that stabilized, not a bleed, on a small lot with an intact regime (Gate 2). Hold one more cycle; a fresh low next tick = bleed → cut.`;
    if (mv.action === 'HOLD_FILLING')
      return `HOLD — ask filling @ ${fmtP(mv.listAt)} — your own ask is filling above the clear price (Gate D, V3); an ask transacting above the clear beats repricing down. Hold it; let it keep filling.`;
    if (mv.action === 'HOLD_FRESH')
      return `WATCH — fresh entry @ ${fmtP(mv.listAt)} — a fresh (<${FRESH_HOURS}h) patient fill is definitionally underwater on the instant read (Gate D, V3). Hold the ask ≥ break-even and give the thesis its window; don't cut a brand-new lot.`;
    if (mv.action === 'CUT')
      return `${mv.verdict} @ ${fmtP(mv.listAt)} — ${mv.gate === 'D' ? 'underwater through a liquid window: persistence, not the clock' : 'controlled loss-taking: stop the bleed, free the capital'}. This is NOT out-running the drop; chasing the ask lower just sells cheaper.`;
    if (mv.action === 'CLEAR')
      return `LIST-TO-CLEAR @ ${fmtP(mv.listAt)} — bank it; a softening market won't pay the patient premium. Repricing down realizes the current price, it does not beat the market.`;
    if (mv.action === 'HOLD_STRONG')
      return `HOLD — list high @ ${fmtP(mv.listAt)} (2h top); don't sell into strength.`;
    if (mv.action === 'HOLD_WATCH')
      return `HOLD — watch; a lone 2h dip vs an uptrend on a small lot is usually noise.`;
  }
  if (instabuy == null) return 'NO QUOTE — cannot price; do not act blind.';
  if (row.falling) {
    return instabuy >= be
      ? `SELL @ ${fmtP(instabuy)} — falling regime, clear in profit. Not out-running the drop; taking the exit while it's still green.`
      : `CUT @ ${fmtP(instabuy)} — falling & underwater; take the small loss to free capital before a bigger one.`;
  }
  const listAt = (row.optSell != null && row.optSell >= be) ? row.optSell : Math.max(instabuy, be);
  const banded = row.optSell != null && row.optSell > instabuy;
  return `HOLD — list @ ${fmtP(listAt)} (break-even-floored${banded ? ', band top' : ''}). ` +
    `Only in THIS ranging case does listing at the band top earn a premium; if it flips to breakdown, momVerdict switches to clear-vs-hold — don't defend the ask down.`;
}

/* renderHeldVerdict(ctx, { mode }) — the ONE entry point both surfaces call.
     mode 'compact'  → quote.mjs `--positions` Verdict cell (byte-identical to pre-P0 verdict()).
     mode 'verbose'  → watch.mjs heldAction line (byte-identical to pre-P0 heldAction()).
   Both derive from ctx.position.mv, so the two surfaces render the SAME verdict for the SAME lot.
   VN-1: when the position stage computed a DISPLAY read (ctx.position.display), the renderer
   consumes display.mvDisplay instead — the persistence-gated label. When nothing diverges,
   mvDisplay IS the raw mv, so output is byte-identical to pre-VN-1 (and when the display context
   is absent entirely — the pre-VN-1 minimal-ctx call sites — behavior is unchanged). A synthetic
   (diverging) display renders the shared label so the table and the note can't disagree. */
export function renderHeldVerdict(ctx, { mode = 'compact' } = {}) {
  const row = ctx && ctx.market ? ctx.market.row : null;
  const p = (ctx && ctx.position) || {};
  const disp = p.display || null;
  const mv = disp ? disp.mvDisplay : heldMomVerdict(ctx);
  if (mv && mv.synthetic) {
    if (mv.kind === 'frame')
      return mode === 'verbose'
        ? `${mv.verdict} — the declared plan governs (raw band-flip read this pass: ${mv.raw}). Below the tripwire normal escalation resumes; a Gate-2 breakdown CUT always overrides the frame.`
        : mv.verdict;
    if (mv.kind === 'parked')
      return mode === 'verbose'
        ? `${mv.verdict} — live is inside the break-even dead-band (raw this pass: ${mv.raw}); the HOLD/UNDERWATER coin-flip on a BE-parked lot is noise, not a signal. A falling regime, an escalated verdict, or a print outside the band exits this state.`
        : mv.verdict;
    return mode === 'verbose'
      ? `${mv.verdict} — displayed verdict is persistence-gated (raw read this pass: ${mv.raw}); a change confirms only once it holds, except a Gate-2 breakdown CUT which is always immediate.`
      : mv.verdict;
  }
  const ts5m = ctx && ctx.intraday ? ctx.intraday.ts5m : null;
  return mode === 'verbose'
    ? heldActionVerbose(row, p.be, p.lotValue, ts5m, mv)
    : heldVerdictCompact(row, p.be, mv);
}

/* renderPathLine(ctx) — the ONE shared dominant-path line (V2-P4b), rendered ALONGSIDE the verdict
   by both surfaces (watch.mjs's held note block; quote.mjs --positions' per-item info lines). It is
   the renderer-family sibling of renderHeldVerdict — the verdict string itself is deliberately
   UNTOUCHED (momVerdict byte-identity, P4a-pinned); the path read is decision SUPPORT beside it,
   never an alert input. Shape (VN-3/F4: viabilities render at ONE decimal — coarse on purpose):
     path <current> 0.6 · entered under <key> · menu: <alt> 0.5 · <alt> 0.4 (support, not a verdict)
   A CONFIRMED migration (persisted currentPath ≠ enteredUnder — survived the arm-then-confirm gate)
   headlines the line as `path MIGRATED <enteredUnder> → <current>`; a challenger still inside the
   persistMs window shows as `<key> challenging (arming ~Nm/Pm)`. Returns null when no path read
   exists (not held / paths stage not run) so callers can drop the line cleanly.
   HONESTY: the printed viabilities are the P4a PLACEHOLDER heuristics — shape, not calibration. */
export function renderPathLine(ctx) {
  const pa = ctx && ctx.paths;
  if (!pa || !pa.dominant) return null;
  const P = pa.persisted || {};
  const cur = P.currentPath != null ? P.currentPath : pa.dominant.key;
  // VN-3 (F4, RC5): ONE decimal — the P4a weights are placeholder heuristics stepping in ±0.12
  // quanta; two decimals rendered that as false precision that READ as instability (0.30↔0.42).
  const viaOf = k => { const w = pa.weighed.find(x => x.key === k); return (w && w.viability != null) ? w.viability.toFixed(1) : '?'; };
  const min = ms => Math.max(0, Math.round((ms || 0) / 60000));
  const entered = P.enteredUnder != null ? P.enteredUnder : pa.enteredUnder;
  const head = P.migration
    ? `path MIGRATED ${entered} → ${cur} ${viaOf(cur)}${P.confirmedThisPass ? ' (confirmed this pass)' : ''}`
    : `path ${cur} ${viaOf(cur)}${entered != null ? ` · entered under ${entered}` : ''}`;
  const arming = P.arming && P.armedKey != null
    ? ` · ${P.armedKey} ${viaOf(P.armedKey)} challenging (arming ~${min(P.armedMs)}m/${min(P.persistMs)}m)`
    : '';
  const alts = pa.weighed.filter(w => w.key !== cur && w.key !== (P.arming ? P.armedKey : null))
    .slice(0, 3).map(w => `${w.key} ${viaOf(w.key)}`).join(' · ');
  return `${head}${arming}${alts ? ` · menu: ${alts}` : ''} (support, not a verdict — placeholder weights)`;
}

/* staleBookBanner(ageMin) — the SHARED positions.json-age banner (COD-4). watch.mjs already prints a
   held-basis staleness line off positions.json's mtime; before COD-4, quote.mjs --positions read the same
   file SILENTLY, so the explicit-ask/positions surface never warned when the book was stale (the A4 quiet
   inversion — the surface Ben uses most had the weakest freshness signal). This is the ONE home for that
   line so both surfaces word the age + stale threshold identically. Returns the banner string; ageMin ==
   null → the "unavailable" form. STALE_BOOK_MIN mirrors watch.mjs's 25m threshold. */
export const STALE_BOOK_MIN = 25;
export function staleBookBanner(ageMin) {
  if (ageMin == null) return 'held basis positions.json unavailable';
  return `held basis positions.json ${ageMin}m old` +
    (ageMin > STALE_BOOK_MIN
      ? ' ⚠ stale — a very recent trade may not show yet; re-sync (node pipeline/sync-fills.mjs from the MAIN checkout) before trusting the held count'
      : '');
}
