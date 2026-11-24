/* plan.mjs — planLines(): the action-ordered, one-line-per-lot plan `quote-items.mjs --positions` prints even in quiet
 * mode. PURE. A lot is { name, qty, be, display (heldDisplay's result or null), verdictText, listAt (heldListAt with the
 * verdict), holdListAt (heldListAt without it, never under BE), exitPrice, tripwire, prev }.
 * Only a CUT/LIST/SELL word may print a price under break-even. */
import { fmtP } from '../../../js/money-format.js';

const GROUPS = [/^CUT/, /^(LIST|SELL)/, /^(WATCH|NO[ -]|FALLING|UNDERWATER|DIURNAL|SHOCK)/];
const WATCH = 2;
const groupOf = word => { const i = GROUPS.findIndex(r => r.test(word)); return i < 0 ? GROUPS.length : i; };
const headWord = t => String(t || '').split(/ @| \(| —| ·/)[0].trim() || 'HOLD';
const clip = s => s.length > 70 ? s.slice(0, 69) + '…' : s;

export function planLine(l) {
  const d = l.display, kind = d?.mvDisplay?.synthetic ? d.mvDisplay.kind : null;
  const frame = kind === 'frame', expired = kind === 'expired';
  const token = headWord(d ? d.token : l.verdictText);
  const overrode = frame && /^(CUT|LIST-TO-CLEAR)/.test(d.raw || '');
  const word = overrode ? 'HOLD (overrode cut)' : frame ? 'HOLD' : token;
  let g = frame ? GROUPS.length : groupOf(token);
  const arming = d?.arming && d.armedKey ? `${d.armedKey} arming` : null;
  if (expired || (arming && /^CUT/.test(d.armedKey))) g = Math.min(g, WATCH);
  const exitWord = !frame && groupOf(token) < WATCH;
  const price = exitWord ? l.listAt : frame && l.exitPrice != null ? l.exitPrice : l.listAt >= l.be ? l.listAt : l.holdListAt;
  const reason = expired ? 'plan expired — reassess' : overrode && l.tripwire != null ? `abort < ${fmtP(l.tripwire)}`
    : frame ? '' : arming ?? (/\(([^)]*)\)/.exec(l.verdictText || '') || [])[1] ?? '';
  const cur = d?.state?.displayVerdict;
  const parts = [`${word} ${l.name} ×${l.qty}`, `list @ ${fmtP(price)} (BE ${fmtP(l.be)})`];
  if (reason) parts.push(clip(reason));
  if (l.prev != null && cur != null && l.prev !== cur) parts.push(`was ${l.prev}`);
  return { g, line: parts.join(' · ') };
}

export function planLines(lots) {
  if (!lots || !lots.length) return ['no held lots'];
  return lots.map((l, i) => ({ i, ...planLine(l) })).sort((a, b) => a.g - b.g || a.i - b.i).map(r => r.line);
}
