Vibe coded tool for OSRS market analysis

# The Coffer — PWA bundle

Standalone OSRS Grand Exchange flipping tool, installable to the iOS home screen. Single-file app, no build step, no framework.

## Files
- `index.html` — the app (vanilla JS, one file)
- `manifest.json` — PWA manifest
- `icon-180.png` — iOS home-screen icon (`apple-touch-icon`)
- `icon-192.png`, `icon-512.png` — standard PWA icons
- `icon-maskable-512.png` — maskable icon (safe-zone padded)
- `fills.json` — real-trade data synced from RuneLite, fetched same-origin by the app
- `pipeline/` — RuneLite fill-data pipeline tooling (not served by Pages, not part of
  the app itself); see `pipeline/FILLS-PIPELINE.md`

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
