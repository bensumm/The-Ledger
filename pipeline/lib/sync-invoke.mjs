/**
 * sync-invoke.mjs — the ONE home for the "always sync first" (SY1) invocation.
 *
 * Before every market read (screen / positions-quote / watch), the read surfaces run a LOCAL,
 * zero-git `sync-fills.mjs` so positions.json is rebuilt off the current exchange logs (Ben,
 * 2026-07-16 — prose "sync before every read" was skipped repeatedly, so a real closed position
 * went unnoticed; SY1 moved it in-code). That invocation used to be copy-pasted byte-for-byte
 * across `screen-flip-niches.mjs`, `quote-items.mjs`, and `watch-positions.mjs` — three homes for
 * one operational concern, already drifting (watch's summary regex matched `^Pushed`, the other
 * two did not). AR1 (PLAN-ARCHITECTURE-COHERENCE) collapses them here.
 *
 * CONTRACT (behavior-preserving):
 *   - Runs the BARE (no-flag) `sync-fills.mjs` as a child of the current node — LOCAL / ZERO-GIT
 *     (no fetch, no commit, no push; that's the pipeline default since 2026-07-15, FILLS-PIPELINE
 *     §12). Publishing stays the once-a-day `/overnight` `sync-fills.mjs --publish`, never here.
 *   - NEVER blocks/aborts the read on failure — a network/git/fs hiccup must not stop a screen,
 *     a positions review, or a monitoring pass. On any throw it prints a one-line "skipped" note
 *     and returns.
 *   - Prints exactly ONE summary line to `console.log` (which the callers reassign to a no-op
 *     unless `--verbose`, so this respects their quiet default — the helper reads the live global
 *     `console.log` at call time, it does not capture a reference).
 *   - The summary regex is the UNION `/^positions:|^Pushed|nothing to/` (AR1 regex reconciliation):
 *     watch already matched `^Pushed`; screen/quote did not. A bare (local) `sync-fills.mjs` never
 *     prints a `Pushed` line, so unifying to the superset is a strict no-op on observed output for
 *     all three surfaces while removing the divergence — one regex, one home.
 *
 * Node-only (child_process); NOT app-imported — no APP_VERSION bump when this changes.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SYNC_FILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'sync-fills.mjs');
const SUMMARY_RE = /^positions:|^Pushed|nothing to/;

/**
 * runLocalSync({ offBookNote }) — run the local sync-fills rebuild before a read.
 * @param {object}  [opts]
 * @param {string}  [opts.offBookNote] — surface-specific tail for the failure line
 *                  (e.g. "screening off the current book"). Default: "reading off the current book".
 */
export function runLocalSync({ offBookNote = 'reading off the current book' } = {}) {
  try {
    const out = execFileSync(process.execPath, [SYNC_FILLS],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const summary = out.trim().split('\n').filter(l => SUMMARY_RE.test(l));
    if (summary.length) console.log('sync · ' + summary.join(' · ') + '\n');
  } catch (e) {
    console.log('sync · ⚠ skipped (' + (e.message || 'failed').split('\n')[0] + ') — ' + offBookNote + '\n');
  }
}
