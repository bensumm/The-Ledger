/* paths.mjs — REPO_DIR, the checkout this module lives in (a worktree resolves to ITSELF, so a bare sync there
 * never writes another checkout's book). `--repo-dir <dir>` overrides it for isolated fixture runs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const at = process.argv.indexOf('--repo-dir');
export const REPO_DIR = (at >= 0 && process.argv[at + 1]) || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
