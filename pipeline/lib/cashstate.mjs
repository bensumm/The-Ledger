/* cashstate.mjs — persist Ben's cash ANCHOR ({ cashGp, statedAt }) for the total-capital read.
   NOTE (PLAN-CASH-TRACKING): the GE cash stack is not in any log, but idle cash is no longer merely
   "stated" — the stored figure is the ANCHOR that lib/cashderive.mjs runs FORWARD from (anchor +
   Σ sells-after-tax − Σ buys − resting-bid escrow). So this module stores the starting point;
   cashderive.mjs computes the current balance. A re-anchor (pipeline/cash.mjs <amount>) is the manual
   reset — the first anchor, or the one DOWN correction when Ben is short / spent gp off-ledger (the
   only movement the log can't see). Stored in gitignored `.capital-state.json` at the repo root;
   read by cashderive, whose loadDerivedCash feeds watch.mjs's SUMMARY footer (availableCash) and
   screen.mjs's --capital default (liquidCapital) — consumers no longer read this anchor directly.
   Impure (fs) — kept OUT of the pure capitalutil.mjs
   / cashderive deriveCash so those stay fixture-testable. */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR } from '../sync-fills.mjs';

const FILE = repoDir => path.join(repoDir, '.capital-state.json');

/* readCash() -> { cashGp, statedAt } | null (null = unknown → footer shows committed absolute only). */
export function readCash(repoDir = REPO_DIR) {
  try {
    const j = JSON.parse(fs.readFileSync(FILE(repoDir), 'utf8'));
    if (j && typeof j.cashGp === 'number') return { cashGp: j.cashGp, statedAt: j.statedAt || null };
  } catch { /* absent/unreadable → unknown */ }
  return null;
}

/* writeCash(gp) -> the persisted record; stamps statedAt so the footer can age/staleness-banner it. */
export function writeCash(cashGp, repoDir = REPO_DIR) {
  const rec = { cashGp, statedAt: new Date().toISOString() };
  fs.writeFileSync(FILE(repoDir), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/* clearCash() -> true if a stored balance was removed (forget the stated figure). */
export function clearCash(repoDir = REPO_DIR) {
  try { fs.unlinkSync(FILE(repoDir)); return true; } catch { return false; }
}
