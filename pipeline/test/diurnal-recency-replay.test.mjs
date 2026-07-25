/**
 * diurnal-recency-replay.test.mjs — PLAN-DIURNAL-RECENCY-GUARD Layer B (retrospective replay).
 *
 * Runs the REAL `hourProfile` (js/windowread.mjs) against a FROZEN, committed snapshot of the archived
 * 1h series for the known failure that motivated the guard, and asserts it fires `spikeTop` with a
 * `typicalLevel` at the reachable level — NOT the spike top.
 *
 * WHY A FROZEN FIXTURE (not a live fetch): the wiki's 1h averages are REVISED over time and the "recent
 * 3 days" window `hourProfile` reads is DATA-relative, so a spike naturally ages out of reproduction
 * within a day or two. A live-fetch assertion is therefore non-deterministic and self-heals past the
 * failure — it cannot be a regression test. The committed fixture is the series CUT at end-07-23 PDT
 * (`cutISO`), freezing the exact 2026-07-24 state where the recent-3 data days were the 07-21/22 double
 * spike + 07-23. The default run asserts against THAT; `--live` is a diagnostic only.
 *
 * ANCHORS:
 *   • Black dragon leather (2509) — HARD anchor. Frozen peak 4,337 → spikeTop=true, typicalLevel ~4,216
 *     (the reachable ceiling; actual 07-23 print 4,208). This is the live money position the guard saves.
 *   • Primordial boots (13239)    — INFORM only. Validated LIVE by Fable at build (2026-07-24, peak
 *     19.36m/p93/2-of-14), but the 1h archive has since revised past the sharp print (frozen peak now
 *     reads 19.25m/p71/5-of-14, below the fire thresholds) — a genuinely borderline case. Reported, not
 *     asserted. The synthetic Layer A fixtures in windowread.test.mjs cover the boots-shape deterministically.
 * HONESTY: n=1 hard real-data anchor + Layer A synthetics. "Catches the case that fooled us," not a rate.
 *
 * Run:
 *   node pipeline/test/diurnal-recency-replay.test.mjs            # replay the frozen fixture + assert (CI)
 *   node pipeline/test/diurnal-recency-replay.test.mjs --live     # live diagnostic (no assert — data moves)
 *   node pipeline/test/diurnal-recency-replay.test.mjs --snapshot # refresh the frozen fixture from live (cut at cutISO)
 */
// HERMETICITY (CI-vs-local determinism): hourProfile buckets each observation by LOCAL hour-of-day
// (getHours) and reads a wall-clock-relative recent-days window, so both the PEAK WINDOW and the
// recent split shift with the machine timezone and the current date. The frozen fixture froze the
// DATA but not the CLOCK — so authored on PDT ~07-24 it passed, but CI (UTC) picked a different peak
// window (15:00 vs 04:00) and a slid recent split, failing a test about neither. We pin BOTH axes to
// the freeze boundary: TZ to the authoring zone (America/Los_Angeles), and hourProfile's `now` to
// REPLAY_NOW below. Assigning process.env.TZ triggers a tzset in Node, and nothing imported here
// evaluates a local Date at load, so the pin is honored before the first hourProfile call.
process.env.TZ = 'America/Los_Angeles';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Module-relative imports (resolved against THIS file's location, not the cwd) so the harness runs from
// any working directory AND against whichever checkout it lives in (worktree or main). loadMapping exposes
// .byId + .resolve (NO .byName — never reach for it).
import { hourProfile } from '../../js/windowread.mjs';
import { fetchTs, loadMapping, setFetchCache } from '../lib/marketfetch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'diurnal-recency-replay.json');
// The freeze boundary: end-of-07-23 PDT (07-24 06:59 UTC) so the recent-3 DATA days are the 07-21/22
// double-spike + 07-23 — the exact state that produced the contaminated peak on 2026-07-24.
const CUT_ISO = '2026-07-24T06:59:00Z';
// Pin hourProfile's recent-days window to the freeze boundary so the frozen fixture replays the exact
// 2026-07-24 state regardless of when (or where) CI runs — without this, real wall-clock time marches
// past the frozen spike and the recent split self-heals, exactly the non-regression trap the header warns
// about for --live. The --live diagnostic intentionally keeps default now (data moves; no assert).
const REPLAY_NOW = new Date(CUT_ISO);

const ANCHORS = [
  // hard: assert spikeTop + typicalLevel band. inform: report only (see header).
  { id: 2509,  name: 'Black dragon leather', hard: true,  typicalLo: 4_180,      typicalHi: 4_300 },
  { id: 13239, name: 'Primordial boots',     hard: false },
];

const fmtM = v => (v == null ? '—' : v >= 1e6 ? (v / 1e6).toFixed(3) + 'm' : String(Math.round(v)));

async function liveSeries({ truncate = false } = {}) {
  setFetchCache(true);
  await loadMapping();                           // exercises .byId/.resolve availability (no .byName use)
  const cut = Math.floor(new Date(CUT_ISO).getTime() / 1000);
  const out = {};
  for (const a of ANCHORS) {
    const full = await fetchTs(a.id, '1h');
    out[a.id] = truncate ? full.filter(p => p.timestamp <= cut) : full;
  }
  return out;
}

function loadFixture() {
  if (!fs.existsSync(FIXTURE)) return null;
  try { return JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).series || null; } catch { return null; }
}

async function main() {
  if (process.argv.includes('--snapshot')) {
    const series = await liveSeries({ truncate: true });
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify({
      capturedAt: Math.floor(Date.now() / 1000), cutISO: CUT_ISO,
      note: 'PLAN-DIURNAL-RECENCY-GUARD Layer B — FROZEN truncated series (cut end-07-23 PDT) reproducing the 2026-07-24 spike-top failure. Leather (2509) hard anchor; boots (13239) inform-only.',
      series,
    }, null, 0));
    console.log(`  ✓ snapshot written to ${FIXTURE} (cut ${CUT_ISO})`);
    return;
  }

  const live = process.argv.includes('--live');
  const series = live ? await liveSeries() : loadFixture();
  if (!series) throw new Error('no committed fixture — run --snapshot first (needs live data)');
  console.log(`diurnal-recency replay (source: ${live ? 'live (diagnostic — no assert)' : 'frozen fixture'}):`);
  let failures = 0;
  for (const a of ANCHORS) {
    const prof = hourProfile(series[a.id], { nights: 14, ...(live ? {} : { now: REPLAY_NOW }) });
    if (!prof) { console.log(`  ✗ ${a.name} (${a.id}): unprofilable series`); if (a.hard && !live) failures++; continue; }
    const rl = prof.peak.reality, rawLevel = prof.peak.level;
    const line = `${a.name} (${a.id}): peak ${fmtM(rawLevel)}, window ${String(prof.peak.startH).padStart(2, '0')}:00–${String(prof.peak.endH).padStart(2, '0')}:00 · reached ${rl.reachedDays}/${rl.nDays}d (recent ${rl.recentHit}/${rl.recentDays}) · p${rl.placement == null ? '—' : Math.round(rl.placement * 100)} · spikeTop=${rl.spikeTop} · typicalLevel ${fmtM(rl.typicalLevel)}`;
    if (!a.hard || live) { console.log(`  ${a.hard ? '·' : 'ⓘ'} ${line}${a.hard ? '' : '  (inform-only)'}`); continue; }
    try {
      assert.equal(rl.spikeTop, true, `${a.name}: the recent spike must flag spikeTop`);
      assert.ok(rl.typicalLevel >= a.typicalLo && rl.typicalLevel <= a.typicalHi,
        `${a.name}: typicalLevel ${fmtM(rl.typicalLevel)} must land in the reachable band [${fmtM(a.typicalLo)}, ${fmtM(a.typicalHi)}], NOT the spike top`);
      const bandMid = (a.typicalLo + a.typicalHi) / 2;                 // accuracy: typical beats raw vs the reachable band
      assert.ok(Math.abs(rl.typicalLevel - bandMid) <= Math.abs(rawLevel - bandMid),
        `${a.name}: |typical − reachable| must beat |raw − reachable|`);
      console.log(`  ✓ ${line}`);
    } catch (err) { console.log(`  ✗ ${line}\n      ${err.message}`); failures++; }
  }
  if (failures) { console.error(`\n${failures} hard anchor(s) failed — the guard does not catch the known failure. NOT shipping.`); process.exit(1); }
  console.log(`\nHard anchor (leather) fires spikeTop with a reachable typicalLevel; boots reported inform-only (n=1 real + Layer A synthetics — "catches what fooled us," not a rate).`);
}

main().catch(e => { console.error(e); process.exit(1); });
