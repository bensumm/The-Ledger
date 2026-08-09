// Head-to-head: MY in-sample day-grain cycleCompletion vs THE STUDY's out-of-sample hour-grain
// design, on the same items and the same archive. Isolates which of the two is broken.
import { pathToFileURL } from 'node:url';
const TMP = 'C:/Users/benls/.claude/jobs/950fdd1e/tmp/';
const lib = await import(pathToFileURL(TMP + 'hp-lib.mjs').href);
const { openArchive, loadSeries1h, indexDays, midnightTs, geTax } = lib;
const R = 'C:/dev/The-Ledger/';
const { windowStats } = await import(pathToFileURL(R + 'js/windowread.mjs').href);
const { amplitudeRanges, cycleCompletion } = await import(pathToFileURL(R + 'js/amplitudescreen.mjs').href);

const ITEMS = [
  { id: 27641, name: 'Saturated heart' },
  { id: 6585,  name: 'Amulet of fury' },
  { id: 26241, name: 'Virtus armour set' },
  { id: 27232, name: 'Masori chaps' },
];
const h = await openArchive();
const pct = v => v == null ? '—' : (100 * v).toFixed(1) + '%';

console.log('item                | MINE (in-sample, day grain) | STUDY (out-of-sample, hour grain)');
console.log('                    | ask-reprints ≤4d            | entry%   done|entry ≤24h  ≤96h   n');
for (const it of ITEMS) {
  const series = loadSeries1h(h, it.id);
  if (series.length < 24 * 20) { console.log(`${it.name}: too little archive`); continue; }

  // ---- MINE: levels from the SAME 14-day window that is then scored (the circularity) ----
  const recent = series.slice(-24 * 14);
  const st = windowStats(recent, { nights: 14, wStart: 0, wEnd: 0 });
  const ar = amplitudeRanges(st, null, { holdDays: 4 });
  const mine = (ar && ar.hasData) ? cycleCompletion(st.days, { bid: ar.ampBid, ask: ar.ampAsk, horizonDays: 4 }) : null;

  // ---- STUDY: levels fitted strictly PRE-T, entry+completion at hour grain ----
  const days = indexDays(series);
  const dayKeys = [...days.keys()].sort();
  let origins = 0, entries = 0, d24 = 0, d96 = 0;
  for (let di = 15; di < dayKeys.length; di++) {
    const T = dayKeys[di], eT = days.get(T);
    if (!eT || eT.nLow < 12 || eT.nHi < 12) continue;
    const cut = midnightTs(T);
    const fitPts = series.filter(p => p.timestamp < cut && p.timestamp >= cut - 20 * 86400);
    const stats = windowStats(fitPts, { nights: 14, wStart: 0, wEnd: 0 });
    if (!stats) continue;
    const a2 = amplitudeRanges(stats, null, { holdDays: 1 });
    if (!a2 || !a2.hasData || a2.ampBid == null || a2.ampAsk == null) continue;
    origins++;
    let entryH = null;
    for (let hh = 0; hh < 24; hh++) { const v = eT.hours.get(hh); if (v && v.low != null && v.low <= a2.ampBid) { entryH = hh; break; } }
    if (entryH == null) continue;
    entries++;
    const eTs = cut + entryH * 3600;
    const reach = hours => {
      for (const p of series) {
        if (p.timestamp <= eTs) continue;
        if (p.timestamp > eTs + hours * 3600) break;
        if (p.avgHighPrice != null && p.avgHighPrice >= a2.ampAsk) return true;
      }
      return false;
    };
    if (reach(24)) d24++;
    if (reach(96)) d96++;
  }
  const mineTxt = mine && mine.frac != null ? `${mine.completed}/${mine.judged} = ${pct(mine.frac)}` : '—';
  console.log(`${it.name.padEnd(19)} | ${mineTxt.padEnd(27)} | ${pct(entries / (origins || 1)).padEnd(8)} ${pct(entries ? d24 / entries : null).padEnd(11)} ${pct(entries ? d96 / entries : null).padEnd(6)} ${entries}`);
}
h.close?.();
