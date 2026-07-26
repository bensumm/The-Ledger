/* paths.mjs — shared filesystem anchors for the pipeline, defined in a LIB so lib modules never import
 * a COMMAND just to get them (chunk 6). derive-cash-tiers.mjs and cash-anchor.mjs previously imported
 * REPO_DIR from commands/sync-fills.mjs, which inverts the lib→command layering AND runs sync-fills'
 * whole module top-level (child_process, git helpers) as an import side effect. REPO_DIR honors the same
 * `--repo-dir` override sync-fills accepts (isolated fixture runs point it at a temp dir), defaulting to
 * the git clone root. sync-fills.mjs re-exports REPO_DIR from here, so its existing importer
 * (watch-log.mjs) keeps importing it from sync-fills unchanged. */
function argVal(name) { const i = process.argv.indexOf(name); return (i >= 0 && i + 1 < process.argv.length) ? process.argv[i + 1] : undefined; }

export const REPO_DIR = argVal('--repo-dir') || 'C:\\dev\\The-Ledger';   // your git clone root
