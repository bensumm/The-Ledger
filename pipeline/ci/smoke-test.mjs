#!/usr/bin/env node
/**
 * smoke-test.mjs — minimal headless-browser smoke of the deployed app (PLAN CI1).
 *
 * `node --check` + the quotecore/reconstruct fixtures only cover syntax and pure logic; an
 * ES-module import/export mismatch or a render-path throw ships green today. This is the DOM
 * smoke that catches "syntax passed but the app broke": it serves the repo root, loads
 * index.html in Playwright chromium (headless), and fails on any uncaught page error, any
 * app-originated console error, or a pane that renders empty.
 *
 *   node pipeline/ci/smoke-test.mjs
 *
 * ALL external network is stubbed — nothing hits prices.runescape.wiki, the wiki guide, the
 * GitHub API, or Google Fonts in CI. Same-origin files (index.html, js/*, styles.css, the
 * root *.json the app fetches) are served for real off a tiny static server, so the real
 * init + render path runs against a tiny 3-item fixture universe. The app already catches
 * fetch failures, so an empty-but-valid shape is enough for it to initialize.
 * `/1h` and `/24h` are stubbed with DIFFERENT volumes on purpose — that is what makes the 0.74.0
 * volDay pin at the bottom discriminating. Mutation-proven: reverting the Finder to STATE.VOL grades
 * the fixture S, and reverting `thin` to the `volDay > 0` test grades it A+; both fail, the fix passes
 * at the A- cap. Keep the two maps distinct if you touch the fixtures.
 *
 * Constraints (/ship §4): public logs, no secrets, no ~/.runelite, seconds-fast (chromium
 * install is the slow part — cached by the CI runner). Exit 0 = pass; non-zero = a failure.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');   // pipeline/ci -> repo root
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// --- tiny static server for the repo root (same-origin assets load for real) ----------------
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/`;

// --- external-network fixtures — a tiny 2-item universe the app can render ------------------
const MAPPING = [
  { id: 2, name: 'Cannonball', members: true, limit: 11000 },
  { id: 4151, name: 'Abyssal whip', members: true, limit: 70 },
  { id: 4152, name: 'Ghostbook onesided', members: true, limit: 10000 },
  { id: 4153, name: 'Ghostbook liquid', members: true, limit: 10000 },
];
const nowS = Math.floor(Date.now() / 1000);
const datum = (h, l, hv, lv) => ({ high: h, low: l, highTime: nowS, lowTime: nowS,
  avgHighPrice: h, avgLowPrice: l, highPriceVolume: hv, lowPriceVolume: lv });
// `Ghostbook onesided` is the FIXTURE FOR THE 0.74.0 volDay FIX and is deliberately contradictory:
// healthy on the HOURLY map, but ZERO on one side of the DAILY map. Its true two-sided daily volume is
// 0, so it must be grade-capped. Under the pre-0.74.0 code — which read /1h and used `volDay > 0` — it
// would be uncapped and could headline S+. Serving different volumes per endpoint is what makes the
// assertion below discriminating: it fails if the Finder is reverted to STATE.VOL or to `volDay > 0`.
// `Ghostbook liquid` is the COMPLEMENT: identical prices/margin, but two-sided-healthy on the DAILY
// map. It must NOT be capped. The pair is what proves the map is actually READ — a missing or
// unread /24h map caps EVERYTHING (fail-closed by design), so the one-sided fixture alone cannot
// distinguish "correctly capped" from "no data at all".
const DATA = { 2: datum(205, 195, 80000, 80000), 4151: datum(2010000, 1985000, 1400, 1400),
               4152: datum(30000, 10000, 50000, 50000), 4153: datum(30000, 10000, 50000, 50000) };
const DATA_24H = { 2: datum(205, 195, 1920000, 1920000), 4151: datum(2010000, 1985000, 33600, 33600),
               4152: datum(30000, 10000, 1200000, 0), 4153: datum(30000, 10000, 1200000, 1200000) };
// PAD to clear VOL24_MIN_ITEMS. Without this the app REJECTS the fixture map as too small, sets
// STATE.VOL24 = null, and every fixture volDay is null — so the pin below would exercise the
// UNKNOWN-volume branch while claiming to test the ZERO-volume one, and `THIN_VOL_DAY` would be
// unpinned entirely (a `THIN_VOL_DAY -> 0` mutation passed green before this padding existed).
// Ids are outside MAPPING on purpose: the Finder iterates the mapping, so they only affect the count.
for (let i = 900000; i < 903200; i++) DATA_24H[i] = datum(100, 90, 5000, 5000);
const GUIDE_MODULE = { 2: 200, 4151: 1995000 };   // wiki module: id -> price
const json = obj => ({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

// --- collect failures -----------------------------------------------------------------------
const failures = [];
// Network/asset noise that is NOT an app bug (a stubbed-empty resource, the missing favicon,
// the empty fonts stylesheet). App logging never reaches the console (logEvent → in-app ring),
// so a real console error here is a genuine thrown error we DO want to fail on.
const IGNORE_CONSOLE = /Failed to load resource|net::ERR|favicon|font|stylesheet|preload/i;

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', e => failures.push('pageerror: ' + (e && e.message || e)));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORE_CONSOLE.test(text)) return;
    failures.push('console.error: ' + text);
  });

  // Stub every request: same-origin continues to the static server; external hosts get a
  // fixture or an empty-but-valid body (no aborts — an abort would surface as a console error).
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(BASE)) {
      if (url.includes('/favicon.ico')) return route.fulfill({ status: 200, contentType: 'image/x-icon', body: '' });
      return route.continue();
    }
    if (url.includes('prices.runescape.wiki')) {
      if (url.includes('/mapping')) return route.fulfill(json(MAPPING));
      // /24h must differ from /1h — see DATA_24H. Match '/24h' before the generic fall-through.
      if (url.includes('/24h')) return route.fulfill(json({ data: DATA_24H, timestamp: nowS - (nowS % 86400) - 86400 }));
      return route.fulfill(json({ data: DATA }));
    }
    if (url.includes('oldschool.runescape.wiki')) return route.fulfill(json(GUIDE_MODULE));      // guide module
    if (url.includes('chisel.weirdgloop.org')) return route.fulfill(json({}));                    // bulk dump → empty → app falls back (its known catch path)
    if (url.includes('weirdgloop.org')) return route.fulfill(json({}));                           // per-item guide history
    if (url.includes('api.github.com')) return route.fulfill(json({}));                           // never hit at init
    if (url.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    return route.fulfill(json({}));   // any other external host → empty-but-valid
  });

  await page.goto(BASE, { waitUntil: 'load' });
  // wait for init to finish rendering the finder body (loadAll → renderAll), bounded
  await page.waitForFunction(() => {
    const s = document.getElementById('stamp');
    return s && !/fetching/i.test(s.textContent || '');
  }, { timeout: 20000 }).catch(() => failures.push('init: #stamp never left "fetching…" (loadAll did not resolve)'));

  const TABS = ['finder', 'scan', 'trends', 'watchlist', 'ignore', 'watch', 'ledger', 'logs'];   // Signals tab removed (SIG-DEL); Ignore tab added 2026-07-12
  for (const t of TABS) {
    // click the real tab button (exercises the wired onclick → switchTab)
    await page.click(`nav.tabs button[data-tab="${t}"]`);
    const r = await page.evaluate((name) => {
      const panel = document.getElementById('panel-' + name);
      if (!panel) return { ok: false, why: 'no panel' };
      const visible = !panel.classList.contains('hidden');
      const len = (panel.innerText || '').trim().length + panel.querySelectorAll('input,button,table,th,section,div').length;
      return { ok: visible && len > 0, visible, len };
    }, t);
    if (!r.ok) failures.push(`tab ${t}: visible=${r.visible} content-score=${r.len} (${r.why || 'empty/hidden'})`);
  }

  // --- 0.74.0 volDay regression pin ------------------------------------------------------------
  // The Finder must grade off the DAILY two-sided limiting side (STATE.VOL24 / `/24h`).
  // TWO assertions, and BOTH are required — a missing/unread /24h map caps EVERYTHING (fail-closed by
  // design), so the capped case alone cannot tell "correctly capped" from "no data at all":
  //   `Ghostbook onesided` — zero on one DAILY side, healthy hourly  => MUST be capped at/below A-
  //   `Ghostbook liquid`   — identical prices, healthy on both sides => MUST NOT be capped
  // Together they fail on: reverting to STATE.VOL, reverting `thin` to `volDay > 0`, reintroducing the
  // `|| it.volume` fallback, changing THIN_VOL_DAY, reading the wrong map, and dropping loadVol24().
  await page.click('nav.tabs button[data-tab="finder"]');
  const gradeOfRow = (name) => {
    const cells = [...document.querySelectorAll('#panel-finder td,#panel-finder th')];
    const nameCell = cells.find(c => (c.textContent || '').includes(name));
    if (!nameCell || !nameCell.parentElement) return { found: false };
    const t = [...nameCell.parentElement.querySelectorAll('[title]')].map(e => e.getAttribute('title')).join(' | ');
    const m = /Desirability\s+(\S+)\s+—/.exec(t);
    return { found: true, grade: m ? m[1] : null, title: t.slice(0, 160) };
  };
  const ABOVE_CAP = ['S+', 'S', 'S-', 'A+', 'A'];   // exactly the grades above THIN_GRADE_CAP ('A-')
  const cap = await page.evaluate(gradeOfRow, 'Ghostbook onesided');
  const liq = await page.evaluate(gradeOfRow, 'Ghostbook liquid');

  if (!cap.found)       failures.push('volDay pin: the one-sided fixture row never rendered — fixture or browse gate changed');
  else if (!cap.grade)  failures.push(`volDay pin: no grade parsed for the one-sided row (title="${cap.title}")`);
  else if (ABOVE_CAP.includes(cap.grade))
    failures.push(`volDay pin: a ZERO daily-volume item graded ${cap.grade} — THIN_GRADE_CAP did not fire. `
      + 'The Finder is reading /1h (STATE.VOL), `thin` reverted to `volDay > 0`, the `|| it.volume` fallback is back, or THIN_VOL_DAY moved.');

  const sortKeyAfter = async (value) => {
    await page.selectOption('#sortSel', value);
    return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sort:finder') || 'null'); } catch { return null; } });
  };
  const optionValues = await page.evaluate(() => [...document.querySelectorAll('#sortSel option')].map(o => o.value));
  for (const v of optionValues) {
    const stored = await sortKeyAfter(v);
    if (!stored || stored.key !== v) failures.push(`sortSel: choosing "${v}" left the finder sorted by `
      + `${stored ? stored.key : 'nothing'} — no matching column in finderSort, so the control is dead.`);
  }

  if (!liq.found)       failures.push('volDay pin: the liquid fixture row never rendered — fixture or browse gate changed');
  else if (!liq.grade)  failures.push(`volDay pin: no grade parsed for the liquid row (title="${liq.title}")`);
  else if (!ABOVE_CAP.includes(liq.grade))
    failures.push(`volDay pin: a HEALTHY 1.2M/day item graded ${liq.grade}, i.e. it was capped as thin. `
      + 'STATE.VOL24 is not being populated — loadVol24() is not running, is reading the wrong map, or the map was rejected by VOL24_MIN_ITEMS.');

  await browser.close();
}

try { await run(); } catch (e) { failures.push('threw: ' + (e && e.stack || e)); }
server.close();

if (failures.length) {
  console.error('SMOKE FAILED:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('smoke OK — index.html initialized offline; all 8 tab panes render and switch.');
process.exit(0);
