#!/usr/bin/env node
/**
 * warn-truncated-pipeline.mjs — PreToolUse(Bash) guard (2026-07-18, Ben-directed).
 *
 * ENCODES the standing rule "read pipeline output FULLY — never blind-`head`/`tail` it and miss a
 * section" as a mechanism instead of prose (Ben: "encode this so we don't rely on prose"; his
 * `docs-small-encode-in-scripts` philosophy). The failure it catches, twice observed: an agent pipes
 * a market/pipeline script (screen-flip-niches / quote-items / read-window-range / watch-positions /
 * analyze-record / sync-fills …) through `| head`/`| tail`, and the truncation drops the FOOTER
 * families the scripts print last — the reachPlacement (⊙) notes, the AC3 patient-band-edge line, the
 * trajectory/reach/demand inform notes. The head "worked", so the miss is silent.
 *
 * Non-blocking by design: it NEVER denies the command (a `head` is sometimes legitimate — grepping a
 * known token, a quick liveness peek). It injects an `additionalContext` REMINDER so the model
 * reconsiders and re-reads full/greps for the specific token. Reads the PreToolUse stdin JSON, matches
 * a pipeline script piped to head/tail, prints the hook JSON on match, and ALWAYS exits 0 (a parse
 * error or non-match is silent — a guard that blocks the shell on its own bug is worse than no guard).
 *
 * Pure Node (no jq — not installed on the Windows box). See .claude/settings.json `hooks.PreToolUse`.
 */
let s = '';
process.stdin.on('data', d => (s += d)).on('end', () => {
  try {
    const cmd = (JSON.parse(s).tool_input?.command) || '';
    // Require the script to be EXECUTED (node … script.mjs), not merely referenced — `[^|]*` keeps
    // `node` on the SAME pipe segment as the script, so `grep pipeline/commands/x.mjs | head` (reading
    // the source file) does NOT trip it; only a real run whose STDOUT is then truncated does.
    const isPipeline = /node\s+[^|]*pipeline\/commands\/[a-z0-9-]+\.mjs/.test(cmd);
    const truncates = /\|\s*(head|tail)(\s|$)/.test(cmd);
    if (isPipeline && truncates) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext:
            'REMINDER (read-full guard): this pipes a pipeline script through head/tail, which ' +
            'truncates the FOOTER families the scripts print last — reachPlacement (⊙), the AC3 ' +
            'patient-band-edge line, trajectory/reach/demand inform notes. Prefer: redirect to a ' +
            'file then Read it, or grep for the SPECIFIC token you need. Only head/tail when you ' +
            'genuinely want the top/bottom N lines and know nothing important sits past the cut.',
        },
      }));
    }
  } catch { /* malformed stdin ⇒ stay silent, never block the shell */ }
  process.exit(0);
});
