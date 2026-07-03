#!/usr/bin/env node
/**
 * watch.mjs — ADAPTIVE, item-type-aware live-session monitor (chunk 7).
 *
 * A market-aware companion to monitor.mjs. Where monitor.mjs is a LOG-STATE snapshot
 * (active offers / recent fills / held count from the exchange log, no market fetch),
 * watch.mjs is the MARKET side of the loop: it re-quotes every held/target item live via
 * js/quotecore.js, classifies it by item TYPE, and drives a human-executed polling session
 * (the /loop skill, ~1–3 min) with:
 *   - per-item CLASS  → recommended attention cadence + which playbook applies
 *   - live re-quoted buy-at / list-at prices (list-at is ALWAYS break-even-floored)
 *   - DROP / CUT alerts via the SHARED chunk-6 cut-trigger momVerdict()
 *   - a compact per-item RISK read (spread · two-sided liquidity · regime · ticket/exposure)
 *     with an adverse-selection warning, and the scalp/market-make playbook gated to
 *     ranging-wide-spread items ONLY.
 *
 * Why a sibling and not an edit to monitor.mjs: monitor.mjs owns log parsing and has NO
 * market fetch; watch.mjs owns market fetch + quotecore classification and takes its held
 * basis from positions.json. Fusing them would bloat one tool and duplicate the fetch layer.
 * Run monitor.mjs to see your resting offers / fills; run watch.mjs to decide what to do.
 *
 * GUARDRAILS (hard):
 *   - HUMAN-EXECUTED DECISION SUPPORT ONLY. This tool NEVER places or cancels a GE offer —
 *     automating GE interaction is botting and bannable. It tells you WHEN to act; you click.
 *   - READ-ONLY. It reads positions.json + live prices and writes nothing.
 *   - No reimplemented quote/tax/regime/momentum math — ALL of it is js/quotecore.js.
 *
 * Held basis = repo-root positions.json OPEN lots (the pipeline's WITHDRAWN/BANKED-aware
 * FIFO from sync-fills.mjs). Deliberately NOT the in-memory reconstruct.mjs path that
 * monitor.mjs uses — reconstruct.mjs is an older copy blind to WITHDRAWN/BANKED, so its held
 * count can be wrong when manual lines exist (PLAN.md Discovered). positions.json is the
 * trusted held source; its only cost is the ~20m sync lag, which this tool prints so a very
 * recent trade's lag is visible. Cost basis is static once bought, so lag rarely changes a call.
 *
 * Usage:
 *   node pipeline/watch.mjs                       # monitor every held position (positions.json)
 *   node pipeline/watch.mjs "Crystal seed" 23959  # also watch these target items (buy-side)
 *   node pipeline/watch.mjs --targets-only "Ranarr weed"   # skip held, watch only these
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeQuote, breakEven, momVerdict, BIG_TICKET_GP } from '../js/quotecore.js';
import { fmtP, fmt } from '../js/format.js';
import { loadMapping, loadGuide, fetchLatest, fetchTs, fetch24hOne, sleep } from './marketfetch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POSITIONS = path.join(HERE, '..', 'positions.json');

// ---------------------------------------------------------------------------
// CLASSIFICATION taxonomy — tunable named constants, NOT magic numbers.
// Boundaries are justified in pipeline/MONITORING.md ("Item-type classes"); the
// short version:
//   LIQUID_FLOOR_PER_DAY — two-sided daily volume below which a book is "thin". 100/d is
//     the practical floor codified in CLAUDE.md (below it is ghost-spreads / no reliable
//     exit); Vol/d here is already the limiting side (min hi/lo vol) from computeQuote.
//   BIG_TICKET_UNIT_GP — per-UNIT price at/above which a single unit is large capital, so a
//     drop is expensive per fill (bludgeon/lightbearer territory). Distinct from the chunk-6
//     BIG_TICKET_GP, which is a whole-LOT (qty×cost) capital-at-risk threshold — momVerdict
//     still uses that one; this one only steers cadence/class.
//   WIDE_SPREAD_PCT — (instabuy−instasell)/instasell at/above which the intraday band is wide
//     enough to be the edge (ladder the band). Tax is 2% on the sell, and CLAUDE.md wants
//     meaningfully >~0.5% AFTER tax → ~3% gross spread is the smallest band worth scalping.
// ---------------------------------------------------------------------------
const LIQUID_FLOOR_PER_DAY = 100;
const BIG_TICKET_UNIT_GP   = 1_000_000;
const WIDE_SPREAD_PCT      = 3;

// Attention cadence (minutes) the /loop should re-check an item at. The loop runs at ONE
// interval; we recommend the TIGHTEST cadence across everything monitored so the most urgent
// item is polled often enough. 1–3 min matches the plan (GE fills over minutes→hours).
const CADENCE_TIGHT = 1;   // hair-trigger: falling, or thin big-ticket volatile
const CADENCE_MED   = 2;   // active watch: ranging scalp, thin, or unconfirmed regime
const CADENCE_LOOSE = 3;   // glance: stable liquid narrow-band

// class -> {cadence, scalp(is market-making the playbook?), label}
const CLASSES = {
  FALLING:                    { cadence: CADENCE_TIGHT, scalp: false, label: 'FALLING' },
  THIN_BIG_TICKET_VOLATILE:   { cadence: CADENCE_TIGHT, scalp: false, label: 'THIN_BIG_TICKET_VOLATILE' },
  LIQUID_RANGING_WIDE:        { cadence: CADENCE_MED,   scalp: true,  label: 'LIQUID_RANGING_WIDE' },
  STABLE_LIQUID:              { cadence: CADENCE_LOOSE, scalp: false, label: 'STABLE_LIQUID' },
  THIN_OTHER:                 { cadence: CADENCE_MED,   scalp: false, label: 'THIN_OTHER' },
  UNKNOWN:                    { cadence: CADENCE_MED,   scalp: false, label: 'UNKNOWN' },
};

/* Assign an item TYPE from its quotecore row. Priority order matters: the hazard classes
   (falling, thin-big-ticket) win first, and the scalp class is only reachable on a liquid,
   flat-regime, wide-band item — so the market-make playbook can NEVER attach to a trending
   item. All inputs come from quotecore (regime/rising/falling/volDay/mom); no local math. */
function classify(row) {
  const unit = row.mid ?? row.quickBuy ?? row.quickSell ?? null;
  const liquid = row.volDay != null && row.volDay >= LIQUID_FLOOR_PER_DAY;
  const spreadPct = (row.quickBuy && row.quickSell != null)
    ? (row.quickSell - row.quickBuy) / row.quickBuy * 100 : null;
  // hazard first
  if (row.falling || row.mom === 'breakdown') return 'FALLING';
  if (!liquid && unit != null && unit >= BIG_TICKET_UNIT_GP) return 'THIN_BIG_TICKET_VOLATILE';
  // scalp only on a confirmed-flat, liquid, wide-band item
  if (liquid && row.regime && row.regime.ok && !row.rising && spreadPct != null && spreadPct >= WIDE_SPREAD_PCT)
    return 'LIQUID_RANGING_WIDE';
  if (liquid && row.regime && row.regime.ok) return 'STABLE_LIQUID';
  if (!liquid) return 'THIN_OTHER';
  return 'UNKNOWN'; // liquid but regime unconfirmed, or volume unknown
}

const spreadPctOf = row => (row.quickBuy && row.quickSell != null)
  ? (row.quickSell - row.quickBuy) / row.quickBuy * 100 : null;

async function fetchInputs(id) {
  const latest = await fetchLatest(id); await sleep(60);
  const ts5m = await fetchTs(id, '5m'); await sleep(60);
  const ts6h = await fetchTs(id, '6h'); await sleep(60);
  const vol24 = await fetch24hOne(id);
  return { latest, ts5m, ts6h, vol24 };
}

// --- per-item RISK read (7.4): spread · liquidity · regime · ticket/exposure + adverse selection.
// The scalp/market-make note is gated to LIQUID_RANGING_WIDE only. The adverse-selection warning
// fires whenever we'd suggest an aggressive low bid (optBuy < quickBuy) OUTSIDE a ranging book:
// a fill at that low bid usually means the market dropped to meet it → often no exit margin.
function riskRead(row, cls, exposureGp) {
  const sp = spreadPctOf(row);
  const spTxt = sp != null ? `spread ${sp.toFixed(1)}% (${fmtP(row.quickSell - row.quickBuy)}/u)` : 'spread —';
  const liq = row.volDay != null
    ? `vol ${fmt(row.volDay)}/d (${row.volDay >= LIQUID_FLOOR_PER_DAY ? 'liquid' : 'THIN — exit not guaranteed'})`
    : 'vol — (liquidity unknown)';
  const reg = (row.regime && row.regime.ok)
    ? `regime ${row.regimeLabel} ${row.regime.driftPct >= 0 ? '+' : ''}${row.regime.driftPct.toFixed(0)}%`
    : 'regime unconfirmed';
  const unit = row.mid ?? row.quickBuy ?? row.quickSell;
  const ticket = unit != null ? `unit ${fmtP(unit)}` : 'unit —';
  const exp = exposureGp != null ? ` · exposure ${fmtP(exposureGp)}` : '';
  const bits = [spTxt, liq, reg, ticket + exp];
  // adverse-selection: aggressive low bid off a non-ranging / thin book
  const lowBid = row.optBuy != null && row.quickBuy != null && row.optBuy < row.quickBuy;
  if (cls === 'LIQUID_RANGING_WIDE') {
    bits.push(`SCALP-OK: ranging wide band — laddering the band is the edge (still: a low-bid fill can precede a dip)`);
  } else if (lowBid) {
    bits.push(`ADVERSE-SELECTION: a fill at the low bid ${fmtP(row.optBuy)} usually means the market dropped to meet it → often no exit margin`);
  }
  return bits.join(' · ');
}

// --- ACTION line for a HELD lot. Sell-side framing is HONEST (clear-vs-hold), never
// "out-run the drop". List-at is break-even-floored. momVerdict() (chunk 6) runs FIRST so a
// 2h breakdown escalates before the lagging multi-day regime confirms.
function heldAction(row, be, lotValue) {
  const instabuy = row.quickSell;
  if (instabuy == null) return 'NO QUOTE — cannot price; do not act blind.';
  const mv = momVerdict(row, be, lotValue);
  if (mv) {
    if (mv.action === 'CUT')
      return `CUT @ ${fmtP(mv.listAt)} — controlled loss-taking: stop the bleed, free the capital. This is NOT out-running the drop; chasing the ask lower just sells cheaper.`;
    if (mv.action === 'CLEAR')
      return `LIST-TO-CLEAR @ ${fmtP(mv.listAt)} — bank it; a softening market won't pay the patient premium. Repricing down realizes the current price, it does not beat the market.`;
    if (mv.action === 'HOLD_STRONG')
      return `HOLD — list high @ ${fmtP(mv.listAt)} (2h top); don't sell into strength.`;
    if (mv.action === 'HOLD_WATCH')
      return `HOLD — watch; a lone 2h dip vs an uptrend on a small lot is usually noise.`;
  }
  if (row.falling) {
    return instabuy >= be
      ? `SELL @ ${fmtP(instabuy)} — falling regime, clear in profit. Not out-running the drop; taking the exit while it's still green.`
      : `CUT @ ${fmtP(instabuy)} — falling & underwater; take the small loss to free capital before a bigger one.`;
  }
  // stable / rising: patient list at the band top if it clears break-even, else floor at break-even
  const listAt = (row.optSell != null && row.optSell >= be) ? row.optSell : Math.max(instabuy, be);
  const banded = row.optSell != null && row.optSell > instabuy;
  return `HOLD — list @ ${fmtP(listAt)} (break-even-floored${banded ? ', band top' : ''}). ` +
    `Only in THIS ranging case does listing at the band top earn a premium; if it flips to breakdown, momVerdict switches to clear-vs-hold — don't defend the ask down.`;
}

// --- ACTION line for a WATCHED (not held) target. Buy-side, with the scalp entry gated.
function targetAction(row, cls, be) {
  if (cls === 'FALLING') return `SKIP — falling / breaking down; don't buy into a drop.`;
  if (row.quickBuy == null) return `NO QUOTE — skip.`;
  if (cls === 'LIQUID_RANGING_WIDE') {
    const exit = row.optSell != null ? fmtP(row.optSell) : 'the band top';
    return `SCALP-BUY @ ${fmtP(row.optBuy)} (band low); set the EXIT AT ENTRY → sell @ ${exit}. Don't leave a stranded ask if the band shifts.`;
  }
  const lowBid = row.optBuy != null && row.optBuy < row.quickBuy;
  const asel = lowBid ? ` (adverse-selection: a fill at ${fmtP(row.optBuy)} likely means it dropped to you — confirm exit margin)` : '';
  return `BUY @ ${fmtP(row.quickBuy)} now / ${fmtP(row.optBuy)} patient${asel}. Set the exit ≥ break-even ${fmtP(be)} at entry.`;
}

async function buildItem({ id, name, qty, avgCost }, map, guide) {
  const inp = await fetchInputs(id);
  const held = qty != null;
  const row = computeQuote({ ...inp, guide: guide[id] ?? null, limit: map.byId[id]?.limit ?? null, held, asked: true });
  const cls = classify(row);
  const meta = CLASSES[cls];
  const be = held ? breakEven(avgCost) : (row.quickBuy != null ? breakEven(row.quickBuy) : null);
  const lotValue = held ? qty * avgCost : null;
  return { id, name, qty, avgCost, held, row, cls, meta, be, lotValue };
}

// A held item is an ALERT if the shared cut-trigger says CUT/CLEAR, or it's underwater
// (instabuy < break-even), or its multi-day regime is falling. Reuses momVerdict — no
// separate escalation logic.
function heldAlert(it) {
  const { row, be, lotValue, name } = it;
  const instabuy = row.quickSell;
  const mv = momVerdict(row, be, lotValue);
  if (mv && (mv.action === 'CUT' || mv.action === 'CLEAR')) {
    return { level: mv.action, msg: `${mv.verdict} ${name} @ ${fmtP(mv.listAt)} — ${mv.action === 'CUT' ? '2h breakdown & underwater' : '2h breakdown'}; ${mv.action === 'CUT' ? 'free the capital' : 'bank it, don\'t hold for the premium'}.` };
  }
  if (instabuy != null && be != null && instabuy < be)
    return { level: 'UNDERWATER', msg: `UNDERWATER ${name} — live sell ${fmtP(instabuy)} < break-even ${fmtP(be)}. Hold ≥ break-even only if regime is flat/rising; cut if it turns.` };
  if (row.falling)
    return { level: 'FALLING', msg: `FALLING ${name} — multi-day regime ${row.regimeLabel} ${row.regime.driftPct.toFixed(0)}%. Price to clear at the instabuy ${fmtP(instabuy)}; don't defend the ask down.` };
  return null;
}

function positionsProvenance() {
  try {
    const p = JSON.parse(fs.readFileSync(POSITIONS, 'utf8'));
    const ageMin = p.generatedAt ? Math.round((Date.now() - Date.parse(p.generatedAt)) / 60000) : null;
    return { pos: p, ageMin };
  } catch (e) { return { err: e && e.message || String(e) }; }
}

async function main() {
  const args = process.argv.slice(2);
  const TARGETS_ONLY = args.includes('--targets-only');
  const tokens = args.filter(a => !a.startsWith('--'));

  const map = await loadMapping();
  const guide = await loadGuide();

  // held items from positions.json (grouped at weighted-avg cost) unless --targets-only
  const heldSpecs = [];
  let posAge = null;
  if (!TARGETS_ONLY) {
    const { pos, ageMin, err } = positionsProvenance();
    if (err) { console.error('cannot read positions.json: ' + err); }
    else {
      posAge = ageMin;
      const byItem = new Map();
      for (const l of (pos.open || []).filter(l => l.qty > 0)) {
        const g = byItem.get(l.itemId) || { qty: 0, cost: 0 };
        g.qty += l.qty; g.cost += l.qty * l.buyEach; byItem.set(l.itemId, g);
      }
      for (const [id, g] of byItem)
        heldSpecs.push({ id, name: map.byId[id]?.name || ('#' + id), qty: g.qty, avgCost: g.cost / g.qty });
    }
  }

  // target items from CLI (buy-side watch)
  const targetSpecs = [];
  for (const t of tokens) {
    const hit = map.resolve(t);
    if (!hit) { console.error(`! no item named "${t}" — skipping`); continue; }
    if (heldSpecs.some(h => h.id === hit.id)) continue; // already covered as a held lot
    targetSpecs.push({ id: hit.id, name: hit.name });
  }

  if (!heldSpecs.length && !targetSpecs.length) {
    console.log('Nothing to watch — no open positions in positions.json and no target items passed.');
    return;
  }

  const held = [];
  for (const s of heldSpecs) held.push(await buildItem(s, map, guide));
  const targets = [];
  for (const s of targetSpecs) targets.push(await buildItem(s, map, guide));

  const all = [...held, ...targets];
  const loopMin = Math.min(...all.map(it => it.meta.cadence));

  // header + provenance
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  console.log(`# Adaptive watch — ${stamp}  ·  READ-ONLY decision support (you place every offer)`);
  if (!TARGETS_ONLY)
    console.log(posAge != null
      ? `held basis: positions.json (WITHDRAWN/BANKED-aware) · ${posAge}m old${posAge > 25 ? ' ⚠ stale — a very recent trade may not show yet' : ''}`
      : `held basis: positions.json unavailable`);
  console.log(`recommended loop: /loop ${loopMin}m node pipeline/watch.mjs${tokens.length ? ' ' + tokens.map(t => `"${t}"`).join(' ') : ''}  (tightest cadence across ${all.length} item${all.length > 1 ? 's' : ''})`);

  // === DROP ALERTS (held only — you can't be underwater on something you don't hold) ===
  console.log('\n=== DROP / CUT ALERTS ===');
  const alerts = held.map(heldAlert).filter(Boolean);
  if (!alerts.length) console.log('(none live — no held item is breaking down, underwater, or in a falling regime)');
  for (const a of alerts) console.log(`  ⚠ ${a.msg}`);

  // === HELD POSITIONS ===
  if (held.length) {
    console.log('\n=== HELD POSITIONS ===');
    for (const it of held) {
      const { row, cls, meta, be, qty, avgCost, lotValue, name } = it;
      console.log(`\n${name} ×${qty}  [${meta.label} · re-check ${meta.cadence}m]  HELD @ ${fmtP(Math.round(avgCost))} (break-even ${fmtP(be)})`);
      console.log(`  quote  buy ${fmtP(row.quickBuy)}/${fmtP(row.optBuy)}  sell ${fmtP(row.quickSell)}/${fmtP(row.optSell)}  mom ${row.mom}`);
      console.log(`  risk   ${riskRead(row, cls, lotValue)}`);
      console.log(`  action ${heldAction(row, be, lotValue)}`);
    }
  }

  // === TARGETS (buy-side watch) ===
  if (targets.length) {
    console.log('\n=== TARGETS (buy-side watch) ===');
    for (const it of targets) {
      const { row, cls, meta, be, name } = it;
      console.log(`\n${name}  [${meta.label} · re-check ${meta.cadence}m]`);
      console.log(`  quote  buy ${fmtP(row.quickBuy)}/${fmtP(row.optBuy)}  sell ${fmtP(row.quickSell)}/${fmtP(row.optSell)}  mom ${row.mom}`);
      console.log(`  risk   ${riskRead(row, cls, null)}`);
      console.log(`  action ${targetAction(row, cls, be)}`);
    }
  }

  console.log('\n(Exit discipline: set the exit at entry · never leave a stranded ask · cut on breakdown rather than hoping. This tool NEVER places or cancels offers — you do.)');
}

await main();
