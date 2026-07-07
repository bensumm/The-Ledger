/* guideanchor.mjs — YP1 (#2, PLAN-YIELD). The GE guide price re-anchors ~once/day per item at an
   item-specific time; the update instantly re-anchors guide-price buyers, compressing/lifting the
   realtime ceiling. This models, per item, the typical update TIME (local hour) and MAGNITUDE from
   the accruing .guide-history.jsonl change record, surfaced as an ADVISORY line on quote/watch rows.

   PURE. HONESTY GATE (the whole point): below GUIDE_MIN_UPDATES observed re-anchors the model
   returns ok:false and surfaces NOTHING — 2 observed so far in the wild, this needs DAYS of history
   before the timing/magnitude claim is real. It is decision SUPPORT, never a verdict/alert input.

   Times are LOCAL (repo convention): the update hour is new Date(ts*1000).getHours(). */
import fs from 'node:fs';

export const GUIDE_MIN_UPDATES = 3;   // honesty gate (placeholder): fewer observed updates → no claim

// Load the .guide-history.jsonl change record: one {ts,id,name,guide,prev} per observed change.
export function loadGuideHistory(p) {
  const out = [];
  let text = '';
  try { text = fs.readFileSync(p, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && r.id != null && r.ts != null) out.push(r); } catch {}
  }
  return out;
}

// The re-anchor UPDATE events for one item: a guide CHANGE (prev present, positive, and different).
// A first sighting (prev:null) is NOT an update — it establishes the baseline, it isn't a re-anchor.
export function guideUpdates(history, id) {
  return (history || [])
    .filter(r => r && r.id === id && r.prev != null && r.prev > 0 && r.guide != null && r.guide !== r.prev)
    .map(r => ({ ts: r.ts, guide: r.guide, prev: r.prev, deltaPct: (r.guide - r.prev) / r.prev * 100 }))
    .sort((a, b) => a.ts - b.ts);
}

function median(xs) { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; }
const hourGap = (a, b) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));   // wraparound (23↔0)

/* guideAnchorModel(updates, {minUpdates}) -> { ok, nUpdates, [modalHour, hourConfident,
   medianDeltaPct, lastDeltaPct] | reason }. ok:false below the gate — no fabricated timing. */
export function guideAnchorModel(updates, { minUpdates = GUIDE_MIN_UPDATES } = {}) {
  const n = (updates || []).length;
  if (n < minUpdates) return { ok: false, nUpdates: n, reason: `only ${n} observed update(s) — need ${minUpdates}` };
  const hours = updates.map(u => new Date(u.ts * 1000).getHours());
  const counts = {}; for (const h of hours) counts[h] = (counts[h] || 0) + 1;
  const modalHour = +Object.entries(counts).sort((a, b) => b[1] - a[1] || (+a[0]) - (+b[0]))[0][0];
  const within = hours.filter(h => hourGap(h, modalHour) <= 1).length;
  const hourConfident = within / n >= 0.6;     // most updates within ±1h of the modal hour
  return { ok: true, nUpdates: n, modalHour, hourConfident,
    medianDeltaPct: median(updates.map(u => u.deltaPct)), lastDeltaPct: updates[n - 1].deltaPct };
}

/* guideAnchorLine(model, curGuide) -> a one-line advisory, or null when gated/absent. */
export function guideAnchorLine(model, curGuide = null) {
  if (!model || !model.ok) return null;
  const hh = String(model.modalHour).padStart(2, '0');
  const conf = model.hourConfident ? '' : ' (time scattered — low confidence)';
  const dir = model.medianDeltaPct >= 0 ? '+' : '';
  const proj = (curGuide != null && curGuide > 0) ? ` → ≈${Math.round(curGuide * (1 + model.medianDeltaPct / 100)).toLocaleString()}` : '';
  return `guide re-anchor: usually ~${hh}:00${conf} · typical step ${dir}${model.medianDeltaPct.toFixed(1)}%${proj} · n=${model.nUpdates} (advisory — small sample)`;
}
