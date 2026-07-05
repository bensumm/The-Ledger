#!/usr/bin/env node
/**
 * smoke.mjs — minimal headless-browser smoke of the deployed app (PLAN CI1).
 *
 * `node --check` + the quotecore/reconstruct fixtures only cover syntax and pure logic; an
 * ES-module import/export mismatch or a render-path throw ships green today. This is the DOM
 * smoke that catches "syntax passed but the app broke": it serves the repo root, loads
 * index.html in Playwright chromium (headless), and fails on any uncaught page error, any
 * app-originated console error, or a pane that renders empty.
 *
 *   node pipeline/smoke.mjs
 *
 * ALL external network is stubbed — nothing hits prices.runescape.wiki, the wiki guide, the
 * GitHub API, or Google Fonts in CI. Same-origin files (index.html, js/*, styles.css, the
 * root *.json the app fetches) are served for real off a tiny static server, so the real
 * init + render path runs against a tiny 2-item fixture universe. The app already catches
 * fetch failures, so an empty-but-valid shape is enough for it to initialize.
 *
 * Constraints (/ship §4): public logs, no secrets, no ~/.runelite, seconds-fast (chromium
 * install is the slow part — cached by the CI runner). Exit 0 = pass; non-zero = a failure.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
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
];
const nowS = Math.floor(Date.now() / 1000);
const datum = (h, l, hv, lv) => ({ high: h, low: l, highTime: nowS, lowTime: nowS,
  avgHighPrice: h, avgLowPrice: l, highPriceVolume: hv, lowPriceVolume: lv });
const DATA = { 2: datum(205, 195, 80000, 80000), 4151: datum(2010000, 1985000, 1400, 1400) };
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
    if (url.includes('prices.runescape.wiki')) return route.fulfill(json(url.includes('/mapping') ? MAPPING : { data: DATA }));
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

  const TABS = ['finder', 'scan', 'trends', 'watchlist', 'watch', 'signals', 'ledger', 'logs'];
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
