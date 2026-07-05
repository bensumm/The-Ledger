/* suggestlog.mjs — the append-only SUGGESTIONS LEDGER (PLAN O1 step 1).
 *
 * Every recommendation the analysis scripts emit — quote.mjs (per-item + --positions),
 * screen.mjs (each rated niche row), watch.mjs (each held/target read) — is logged HERE at
 * emit time, unconditionally, one JSON object per line, to repo-root suggestions.jsonl. This
 * is the "what the tool SAID" half of the outcomes dataset; pipeline/outcomes.mjs joins it to
 * "what actually FILLED" (fills.json). The ledger is TRACKED in git (append-only; ids / prices
 * / timestamps only — NO PII; the repo is public). sync-fills.mjs adds it to its commit set
 * when present.
 *
 * Line schema (the O1 contract):
 *   { ts, script, mode, params, itemId, quickBuy, optBuy, quickSell, optSell, mom, regime, class, verdict }
 *     ts      — unix SECONDS at emit time
 *     script  — 'quote' | 'screen' | 'watch'
 *     mode    — the mode/niche as computed then (screen niche name, or null)
 *     params  — the run's params object (screen flags, positions:true, …) or null
 *     class   — the item-type / liquidity label AS COMPUTED THEN. The classification logic
 *               evolves; recomputing it later would REWRITE history, so it's snapshotted here.
 *     verdict — the emitted action verdict where the script produces one (else null)
 *   Prices are whatever the computeQuote row held (may be null) — we never fabricate a number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(HERE, '..', 'suggestions.jsonl');

// Coarse liquidity class from the limiting-side daily volume — a stable, script-independent
// vocabulary so quote.mjs / screen.mjs rows share one `class`. Thresholds mirror CLAUDE.md's
// two-sided practical floor (~100/d) and a rough liquid cutoff. watch.mjs instead passes its
// richer classify() taxonomy label (FALLING / THIN_BIG_TICKET_VOLATILE / …) — that IS "the label
// as computed then" for that script.
// liqClassOf(volDay) is the raw-number core (outcomes.mjs joins on stored volDay, no row); liqClass(row)
// is the row convenience wrapper. ONE threshold set (X1 dedup — was copied as liqClassOf in outcomes.mjs).
// NY2.4: this 'thin' (volDay < 100) is DISTINCT from screen.mjs's grade-capping `thin` (the gp-flow-only
// admission path, limitVol < 50). Because volDay == limitVol, an item at 50–99/day logs class:'thin'
// here yet is NOT gp-flow-thin, so it grades on merit — a class:'thin' + high grade in the ledger is
// expected, not a cap escape (see rating.mjs THIN_GRADE_CAP note).
export function liqClassOf(volDay) {
  if (volDay == null) return 'unknown';
  if (volDay < 100) return 'thin';
  if (volDay < 1000) return 'mid';
  return 'liquid';
}
export function liqClass(row) { return liqClassOf(row && row.volDay); }

// Build one suggestion entry from a computeQuote row + the caller's class/verdict. Kept separate
// from logSuggestions so a caller can assemble a batch, then log once.
export function suggestionEntry(row, { itemId, cls, verdict } = {}) {
  return {
    itemId,
    quickBuy:  row.quickBuy  ?? null,
    optBuy:    row.optBuy    ?? null,
    quickSell: row.quickSell ?? null,
    optSell:   row.optSell   ?? null,
    mom:       row.mom       ?? null,
    regime:    row.regimeLabel ?? null,
    class:     cls ?? null,
    verdict:   verdict ?? null,
  };
}

// Append entries to suggestions.jsonl. Best-effort: a logging failure must NEVER break a market
// read (the ledger is analytics, not the product) — it warns and moves on. One fs call per batch.
export function logSuggestions(script, { mode = null, params = null } = {}, entries = []) {
  if (!entries || !entries.length) return;
  const ts = Math.floor(Date.now() / 1000);
  const text = entries.map(e => JSON.stringify({ ts, script, mode, params, ...e })).join('\n') + '\n';
  try { fs.appendFileSync(LEDGER, text); }
  catch (err) { console.error('(suggestlog: could not append to suggestions.jsonl — ' + ((err && err.message) || err) + ')'); }
}
