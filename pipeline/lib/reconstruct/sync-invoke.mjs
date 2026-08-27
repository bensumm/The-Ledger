/**
 * sync-invoke.mjs — the ONE home for the "always sync first" (SY1) invocation.
 *
 * Before every market read (screen / positions-quote / watch), the read surfaces run a LOCAL,
 * zero-git `sync-fills.mjs` so positions.json is rebuilt off the current exchange logs (prose
 * "sync before every read" was skipped repeatedly and a real closed position went unnoticed; SY1
 * moved it in-code). The invocation was copy-pasted across the read surfaces and already drifting
 * (watch's summary regex matched `^Pushed`, the others did not); AR1 collapses them here.
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
 *   - ⚠ THE FAILURE NOTE GOES TO STDERR AND THE SUMMARY TO STDOUT — do NOT "tidy" them onto one
 *     stream. Three of the FOUR callers run `if (!VERBOSE) console.log = () => {}` a few lines BEFORE
 *     calling this (NOT `read-book.mjs`: no quiet default, so its note lands). On the other three a
 *     `console.log` failure note reaches nobody — the very
 *     invocation CLAUDE.md's command table tells an agent to run (measured: 0 bytes to stdout for a
 *     whole runLocalSync, on the SUCCESS arm too, so silence never evidenced health). That is the
 *     hazard SY1 exists to remove, reinstated: a crashing sync leaves the read quoting a FROZEN
 *     positions.json with no sign, against the rule never to infer book freshness from elapsed time.
 *     Suppressing "here is what synced" is a display choice; suppressing "your book did not refresh"
 *     is a correctness one. Stderr is never stubbed, so the warning always lands.
 *   - The child's stderr is CAPTURED (not discarded) so the note carries the real cause; `e.message`
 *     alone renders every distinct failure as the same "Command failed: …\sync-fills.mjs".
 *   - The summary regex is the UNION `/^positions:|^Pushed|nothing to/` (AR1 regex reconciliation):
 *     watch already matched `^Pushed`; screen/quote did not. A bare (local) `sync-fills.mjs` never
 *     prints a `Pushed` line, so unifying to the superset is a strict no-op on observed output for
 *     all four surfaces while removing the divergence — one regex, one home.
 *
 * Node-only (child_process); NOT app-imported — no APP_VERSION bump when this changes.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// TWO up from lib/reconstruct/ to reach pipeline/, then commands/ (PLAN-LIB-SUBDIRS chunk 3 nested this file).
const SYNC_FILLS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'commands', 'sync-fills.mjs');
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
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const summary = out.trim().split('\n').filter(l => SUMMARY_RE.test(l));
    if (summary.length) console.log('sync · ' + summary.join(' · ') + '\n');
  } catch (e) {
    // Pick the child's ERROR line, not the first or last line of its stderr: node's crash dump opens
    // with the source excerpt and CLOSES with its own "Node.js v22.16.0" banner, so both ends name
    // something useless. (Measured — the first cut of this took .pop() and reported the node version
    // as the cause.) `e.message` alone is no better: it degrades every distinct failure to the same
    // "Command failed: …\node.exe …\sync-fills.mjs".
    const lines = String(e.stderr || '').split('\n').map(l => l.trim()).filter(Boolean);
    // The prefix is OPTIONAL: a bare `Error: Cannot find module …` is the shape a MISSING sync-fills
    // produces, and requiring a prefix skipped straight past it to node's internal loader path.
    const why = lines.find(l => /^(?:[A-Za-z_$][\w$]*)?Error\b/.test(l))
      || lines.find(l => !/^(at\s|\^|Node\.js v|node:)/.test(l))
      || (e.message || 'failed').split('\n')[0];
    // console.error, NOT console.log — see the ⚠ in the header. The callers stub console.log.
    console.error('sync · ⚠ FAILED (' + why + ') — ' + offBookNote + ', which may be STALE\n');
  }
}
