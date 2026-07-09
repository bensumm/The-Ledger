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
 * Line schema (the O1 contract, + YS2 forward fields — lean-included, present only when supplied):
 *   { ts, script, mode, params, itemId, quickBuy, optBuy, quickSell, optSell, mom, regime, class, verdict,
 *     posture?, tripwire?, fillWindowHrs?, velocityClass?, thesis?, validators?, path?,
 *     bid?, ask?, pFill?, ttfSec?, rank?, estBasis?, estN? }   (P6b rank estimate — the quoted pair +
 *     net×P÷TTF components; lean-included, absent on older rows)
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
// HERE is pipeline/lib/ (since OR2 moved this file into lib/), so repo root is TWO levels up.
// A single '..' here silently forked the ledger into untracked pipeline/suggestions.jsonl for
// half a day (2026-07-05) — suggestlog.test.mjs pins the resolved path to the repo root.
export const LEDGER = path.join(HERE, '..', '..', 'suggestions.jsonl');

// SR1 — rotation/compaction. The active LEDGER lives in the DEPLOY ROOT and grows unbounded
// (~3k rows/day ≈ >1MB/day). To keep the root file bounded to the CURRENT calendar month while
// never dropping a row (rows are F1's calibration data — ARCHIVE, never delete), completed months
// are moved OUT of the root into monthly archive files `suggestions-YYYY-MM.jsonl` under a tracked
// `pipeline/suggestions-archive/` dir (out of the deploy root, still committed by sync-fills). The
// resolved ACTIVE path above stays pinned by suggestlog.test.mjs — only history relocates.
export const ARCHIVE_DIR = path.join(HERE, '..', 'suggestions-archive');

// UTC month key (YYYY-MM) for a unix-SECONDS ts. Archive naming is a STORAGE/wire concern, so it
// uses UTC (consistent with the CLAUDE.md time-convention: ISO/UTC is storage, local getters are
// display). The current-month boundary uses the same UTC basis so the two never disagree.
function monthKey(tsSec) {
  const d = new Date(tsSec * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
export function currentMonthKey(now = Date.now()) { return monthKey(Math.floor(now / 1000)); }

// Cheap guard: read only the FIRST line (oldest row — the ledger is appended in ts order) and
// return its month, without slurping a month-sized file on every append. Returns null if the file
// is missing/empty/unparseable (→ caller skips rotation, appends normally).
function firstLineMonth() {
  let fd;
  try {
    fd = fs.openSync(LEDGER, 'r');
    const buf = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.toString('utf8', 0, bytes);
    const nl = s.indexOf('\n');
    const line = (nl >= 0 ? s.slice(0, nl) : s).trim();
    if (!line) return null;
    const ts = JSON.parse(line).ts;
    return ts == null ? null : monthKey(ts);
  } catch { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
}

// Move every row OLDER than the current month out of the active LEDGER into its monthly archive.
// SAFETY (no row loss): each archive is written FULLY (existing ∪ new, deduped by exact line, via
// tmp+rename) BEFORE the active file is rewritten to drop the moved rows — so a crash mid-rotation
// leaves the rows still in the active file and a re-run re-archives them idempotently (dedup means
// no duplicates). Unparseable / ts-less lines are KEPT in the active file, never discarded. Handles
// multiple accumulated prior months in one pass. Returns { rotated, months } for reporting.
export function rotateLedger(now = Date.now(), { ledger = LEDGER, archiveDir = ARCHIVE_DIR } = {}) {
  if (!fs.existsSync(ledger)) return { rotated: 0, months: [] };
  const cur = currentMonthKey(now);
  const lines = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const keep = [];
  const byMonth = new Map();
  for (const line of lines) {
    let ts = null;
    try { ts = JSON.parse(line).ts; } catch { keep.push(line); continue; }  // keep unparseable in place
    const mk = (ts == null) ? cur : monthKey(ts);
    if (mk >= cur) keep.push(line);                                          // current (or defensive future) stays active
    else (byMonth.get(mk) || byMonth.set(mk, []).get(mk)).push(line);
  }
  if (byMonth.size === 0) return { rotated: 0, months: [] };
  fs.mkdirSync(archiveDir, { recursive: true });
  let rotated = 0;
  for (const [mk, mlines] of byMonth) {
    const file = path.join(archiveDir, `suggestions-${mk}.jsonl`);
    const existing = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim()) : [];
    const seen = new Set(existing);
    const merged = existing.slice();
    for (const l of mlines) if (!seen.has(l)) { merged.push(l); seen.add(l); rotated++; }
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, merged.join('\n') + '\n');
    fs.renameSync(tmp, file);                                               // archive committed before active shrinks
  }
  const tmpA = ledger + '.tmp';
  fs.writeFileSync(tmpA, keep.length ? keep.join('\n') + '\n' : '');
  fs.renameSync(tmpA, ledger);
  return { rotated, months: [...byMonth.keys()] };
}

// Read EVERY suggestion line across the active ledger + all monthly archives, oldest-file first
// (active last = newest). Rotation splits the O1 dataset across files, so any reader that needs the
// FULL history (outcomes.mjs's F1 calibration join) MUST read through here, not the active file
// alone — reading LEDGER directly would silently halve the calibration set after the first rotation.
export function readSuggestionLines({ ledger = LEDGER, archiveDir = ARCHIVE_DIR } = {}) {
  const files = [];
  if (fs.existsSync(archiveDir)) {
    for (const f of fs.readdirSync(archiveDir)) {
      if (/^suggestions-\d{4}-\d{2}\.jsonl$/.test(f)) files.push(path.join(archiveDir, f));
    }
    files.sort();                                                          // YYYY-MM sorts chronologically
  }
  files.push(ledger);                                                      // active month last
  const out = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) if (line.trim()) out.push(line);
  }
  return out;
}

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
//
// YS2 forward-enrichment (PLAN-YIELD): the caller may ALSO pass prediction fields the backfill can
// never invent — posture (active/overnight, the posture the read was made under), tripwire (the
// named structural level being watched), fillWindowHrs (predicted time-to-fill), velocityClass
// (predicted fast/slow), thesis (one-line intent — NO PII). They are LEAN-INCLUDED: a field is
// written ONLY when the caller supplies a non-null value, so a row with no forward context stays
// byte-for-byte the shape it had before (keeps suggestions.jsonl from ballooning — SR1). Honesty:
// a script logs only what it can HONESTLY compute (e.g. posture from the clock/flag); it never
// fabricates a thesis or a pre-F1 predicted velocity. outcomes.mjs joinSuggestion reads each `?? null`.
// P2: `validators` is the compact non-pass validator-flag list (js/validate.mjs leanValidators) —
// lean-included exactly like the YS2 fields, so a clean (all-pass) row's logged shape is unchanged.
export function suggestionEntry(row, { itemId, cls, verdict, posture, tripwire, fillWindowHrs, velocityClass, thesis, validators, path, bid, ask, pFill, ttfSec, rank, estBasis, estN } = {}) {
  const e = {
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
  if (posture != null)       e.posture = posture;
  if (tripwire != null)      e.tripwire = tripwire;
  if (fillWindowHrs != null) e.fillWindowHrs = fillWindowHrs;
  if (velocityClass != null) e.velocityClass = velocityClass;
  if (thesis != null)        e.thesis = thesis;
  if (validators != null)    e.validators = validators;
  // P4c: `path` is the INFERRED default entry-path key from the surfacing strategy spec
  // (js/strategies.mjs defaultPath — band/spread/churn → scalp, rising → value-hold). Lean-included
  // exactly like the YS2 fields, so a caller that supplies no path (quote.mjs, watchlist rows) logs a
  // byte-identical shape. It lets a later fill attribute a position to a thesis when no explicit
  // `thesis.mjs set --path` was declared (the P4b fallback: explicit hold-thesis > inferred > null).
  if (path != null)          e.path = path;
  // P6b — the per-thesis rank estimate: the ONE quoted pair the thesis posts (bid/ask) + the rank
  // components (pFill, TTF seconds, the composite rank = net×P÷TTF) + n/basis so the retro-join can
  // calibrate estimate-vs-realized. Lean-included exactly like the YS2 fields: written ONLY when
  // supplied, so a caller that logs no rank estimate (older callers) stays byte-for-byte unchanged.
  if (bid != null)           e.bid = bid;
  if (ask != null)           e.ask = ask;
  if (pFill != null)         e.pFill = pFill;
  if (ttfSec != null)        e.ttfSec = ttfSec;
  if (rank != null)          e.rank = rank;
  if (estBasis != null)      e.estBasis = estBasis;
  if (estN != null)          e.estN = estN;
  return e;
}

// Append entries to suggestions.jsonl. Best-effort: a logging failure must NEVER break a market
// read (the ledger is analytics, not the product) — it warns and moves on. One fs call per batch.
export function logSuggestions(script, { mode = null, params = null } = {}, entries = []) {
  if (!entries || !entries.length) return;
  // SR1: before appending, roll any completed month out to its archive so the active root file
  // stays bounded to the current month. Cheap guard — only reads the whole file (rotateLedger) when
  // the OLDEST row predates the current month; otherwise a single small first-line read. Best-effort:
  // rotation must NEVER break a market read (the ledger is analytics, not the product).
  try {
    const fm = firstLineMonth();
    if (fm && fm < currentMonthKey()) rotateLedger();
  } catch (err) { console.error('(suggestlog: rotation skipped — ' + ((err && err.message) || err) + ')'); }
  const ts = Math.floor(Date.now() / 1000);
  const text = entries.map(e => JSON.stringify({ ts, script, mode, params, ...e })).join('\n') + '\n';
  try { fs.appendFileSync(LEDGER, text); }
  catch (err) { console.error('(suggestlog: could not append to suggestions.jsonl — ' + ((err && err.message) || err) + ')'); }
}
