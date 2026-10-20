# DrawThing

A pen-first drawing PWA for iPad + Apple Pencil and Windows tablets + Surface/MPP pens.
See [docs/ROADMAP.md](docs/ROADMAP.md) for the architecture and phased plan.

**Status:** Phase 0 (foundations). It's an installable, offline-capable shell with debug tooling. The drawing engine arrives in Phase 1.

## Quick start

Requires Node 22 (`.nvmrc`).

```bash
nvm use
npm install
npm run dev
```

| Script              | What it does                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server on http://localhost:5173 (no service worker in dev)                         |
| `npm run dev:https` | Same, with a self-signed cert on all interfaces, for LAN testing                            |
| `npm run build`     | Type-check, then build to `dist/` and generate icons, splash screens and the service worker |
| `npm run preview`   | Serve the production build on http://localhost:4173 (SW active)                             |
| `npm run check`     | Typecheck, lint, format check and unit tests                                                |
| `npm test`          | Unit tests (Vitest)                                                                         |
| `npm run test:e2e`  | Builds, serves, and runs Playwright PWA tests (manifest, offline reload)                    |

Playwright on WSL/Linux needs Chromium's system libraries once:

```bash
sudo npx playwright install-deps chromium
```

## Testing on real tablets

Pointer Events and service workers need a **secure context**. `localhost` counts; a LAN IP does not.

1. **Reach the dev machine from the tablet.** WSL2 sits behind NAT by default, so the tablet can't see
   it. Either enable mirrored networking (`networkingMode=mirrored` under `[wsl2]` in
   `%UserProfile%\.wslconfig`, then `wsl --shutdown`), or forward the port from Windows with
   `netsh interface portproxy`. Then allow the port through Windows Firewall.
2. **Pen input over LAN:** use `npm run dev:https` and accept the self-signed certificate warning.
3. **Install and offline testing on iPad:** iOS won't register a service worker on an untrusted
   certificate. Expose `npm run preview` through a trusted HTTPS tunnel instead, for example
   `cloudflared tunnel --url http://localhost:4173`, and open the printed URL on the iPad.
   Then use Share, then Add to Home Screen.

On the Windows tablet itself, `http://localhost:5173` / `:4173` works directly in Edge and Chrome.

## Debug tools (no Mac needed)

Add query flags once. They're remembered per device, so the installed app keeps them.

- `?debug` shows the HUD:
  - FPS, worst frame and rAF rate
  - Pointer events/s vs **samples/s**. Samples/s includes coalesced events, so it's the real digitizer rate, about 240/s on Apple Pencil.
  - Pressure, tilt, altitude and azimuth
  - WebGL2, coalesced and predicted event support
  - Service worker, online and storage-persistence state
- `?log` mirrors `console.*` and uncaught errors to the **dev/preview server terminal**. That's the substitute for Safari Web Inspector.
- `?debug=0` / `?log=0` turns them off.

## Layout

```
src/
  app/        React shell (App, UpdatePrompt)
  debug/      flags, HUD, remote logging client
  platform/   OS / install-mode detection
  styles/     global CSS: design tokens + browser-gesture suppression
tools/        Vite plugins (remote-log endpoint)
e2e/          Playwright PWA tests
public/logo.svg   source for all generated icons and iPad splash screens (pwa-assets.config.ts)
```
