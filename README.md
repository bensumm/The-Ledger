Vibe coded tool for OSRS market analysis

# The Coffer — PWA bundle

Standalone OSRS Grand Exchange flipping tool, installable to the iOS home screen. Vanilla JS, no build step, no framework — just plain static files.

## Files
- `index.html` — the app shell (markup only)
- `styles.css` — all styles
- `js/` — the app logic, split into ES modules (`state.js` holds shared mutable
  state as a single `STATE` object + constants/persistence/diagnostics;
  `format.js` formatting/tax helpers; `charts.js` inline SVG chart rendering;
  `market.js` price/guide fetching + scoring engine; `trends.js` archive +
  seasonal analysis; `ui.js` Finder/Watchlist/Signals/Ledger/Coffer rendering;
  `backup.js` export/import; `main.js` is the entry point — event wiring + init,
  loaded from `index.html` as `<script type="module">`). No bundler: deployed to
  Pages exactly as these files sit on disk.
- `manifest.json` — PWA manifest
- `icon-180.png` — iOS home-screen icon (`apple-touch-icon`)
- `icon-192.png`, `icon-512.png` — standard PWA icons
- `icon-maskable-512.png` — maskable icon (safe-zone padded)
- `fills.json` — real-trade data synced from RuneLite, fetched same-origin by the app
- `pipeline/` — RuneLite fill-data pipeline tooling (not served by Pages, not part of
  the app itself); see `pipeline/FILLS-PIPELINE.md`

## Local development
ES module scripts can't load over `file://` (browsers block it for CORS reasons),
so double-clicking `index.html` no longer works for local testing. Run `serve.cmd`
(tries Python's built-in `http.server`, falls back to `npx serve`) and open
`http://localhost:8000/` instead. GitHub Pages deploys are unaffected either way —
Pages always serves over real HTTP.

## Deploy with GitHub Pages (all doable from iOS)
1. Create a repo and add every file above to the **root**.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save.**
3. Wait ~1 minute, then open `https://<user>.github.io/<repo>/`.
4. In Safari: **Share → Add to Home Screen.** Launch from the icon for full-screen, standalone mode.

Every `git push` auto-deploys; the next launch serves the new file. There is **no service worker**, so there is no cache to invalidate — updates are immediate.

## Persistence
When hosted, the app stores everything in **IndexedDB**: ledger, watchlist, settings, the growing hourly archives, and the cached price snapshots. (It still uses the artifact `window.storage` if run inside Claude, and falls back to in-memory only if neither is available.)

iOS can still evict site storage under device-storage pressure even for installed PWAs. Use the in-app **Export** button periodically as a backstop. Migrating from the artifact build? Export there, Import here — the formats match.

## Notes for future work
- No-MacBook friendly: edit and deploy entirely from the GitHub iOS app or a client like Working Copy.
- A service worker (network-first for the HTML) would add an offline shell, but the app needs the live wiki API to be useful, so it was intentionally omitted for v1.
- `apple-mobile-web-app-status-bar-style` is set to `black`. For an edge-to-edge look, switch to `black-translucent`, add `viewport-fit=cover` to the viewport meta, and pad the header with `env(safe-area-inset-top)`.
