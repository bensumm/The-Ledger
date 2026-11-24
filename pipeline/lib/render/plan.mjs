/* plan.mjs — planLines(): the action-ordered, one-line-per-lot plan `quote-items.mjs --positions` prints
 * even in quiet mode. PURE: the caller supplies the display verdict text, list/BE (heldListAt / breakEven),
 * and the current + stored previous display verdict token; nothing is re-derived here. */
import { fmtP } from '../../../js/money-format.js';

const GROUPS = [/^CUT/, /^(LIST|SELL)/, /^(WATCH|NO[ -]|FALLING|UNDERWATER|DIURNAL|SHOCK)/];
const groupOf = word => { const i = GROUPS.findIndex(r => r.test(word)); return i < 0 ? GROUPS.length : i; };
const headWord = t => String(t || '').split(/ @| \(| —| ·/)[0].trim() || 'HOLD';

export function planLines(lots) {
  if (!lots || !lots.length) return ['no held lots'];
  const rows = lots.map((l, i) => {
    const overrode = !!l.frame && /^(CUT|LIST-TO-CLEAR)/.test(l.raw || '');
    const word = l.frame ? (overrode ? 'HOLD (overrode cut)' : 'HOLD') : headWord(l.verdictText);
    const reason = overrode && l.tripwire != null ? `abort < ${fmtP(l.tripwire)}`
      : l.frame ? '' : (/\(([^)]*)\)/.exec(l.verdictText || '') || [])[1] || '';
    const parts = [`${word} ${l.name} ×${l.qty}`, `list @ ${fmtP(l.listAt)} (BE ${fmtP(l.be)})`];
    if (reason) parts.push(reason.length > 70 ? reason.slice(0, 69) + '…' : reason);
    if (l.prev != null && l.prev !== l.cur) parts.push(`was ${l.prev}`);
    return { g: l.frame ? GROUPS.length : groupOf(headWord(l.verdictText)), i, line: parts.join(' · ') };
  });
  return rows.sort((a, b) => a.g - b.g || a.i - b.i).map(r => r.line);
}
