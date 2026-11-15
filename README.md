# DrawThing

A pen-first drawing PWA for iPad + Apple Pencil and Windows tablets + Surface/MPP pens.
See [docs/ROADMAP.md](docs/ROADMAP.md) for the architecture and phased plan.

**Status:** Phase 8. In so far:

- the WebGL2 engine, pen input and gestures
- the brush engine (Ink, Pencil, Airbrush, Marker, Chalk, plus an eraser)
- layers with blend modes and groups, and undo/redo
- the full interface: top bar, sidebar, brush library and settings with pressure curves, colour
  picker, layers panel with thumbnails and drag-to-reorder, eyedropper, and keyboard shortcuts
- colour palettes: make and edit them, import and export Procreate `.swatches` and GIMP `.gpl`
  files, or pick N colours from an image; 16 recent colours
- several layers selected at once to group or flatten them, and a one-tap reset of the canvas
  rotation
- saving: every change is autosaved on the device, the app reopens the last artwork, and the
  gallery lists saved artworks (rename, duplicate, delete)
- export to PNG, JPEG, layered PSD and `.drawthing` (lossless backup); import of those, plus
  photos as a new canvas or onto a layer
- app hardening:
  - an install guide on iPad and an Install button on Edge and Chrome
  - updates offered only between drawings
  - "Open with DrawThing" for `.drawthing`, PSD and image files on Windows
  - a title-bar-less desktop window
  - recovery from a GPU reset without losing the artwork or its undo history
- performance and QA tooling:
  - a benchmark lab (`?lab`)
  - a stroke recorder
  - stroke-replay visual regression and real pen/touch input tests in CI
  - a bundle-size budget
  - the device checklist in [docs/QA.md](docs/QA.md)

Running that checklist on real iPads and Surfaces is next. Optional cloud sync (Phase 9) follows if
it's wanted.

## Requirements

**Docker Engine 24+ with Compose v2** (or Docker Desktop on Windows/macOS). That's all: Node.js and
npm are not needed on the host. Every npm command runs inside a container, and production is a
static web server image.

| Image (`Dockerfile` target) | Used for                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| `dev` (Node 22)             | Dev server with hot reload, and any npm command (`./scripts/dnpm`)             |
| `runtime` (Caddy)           | The deployable app: the built PWA plus HTTPS handling for each deployment mode |
| `e2e` (Playwright)          | End-to-end tests, with browsers and their system libraries included            |

## Develop

```bash
docker compose up dev
```

Open http://localhost:5173. Add `?debug` for the diagnostics overlay. The source is bind-mounted,
so edits hot-reload. Dependencies live in a Docker volume, never on the host.

Run npm inside the dev image with `./scripts/dnpm`:

```bash
./scripts/dnpm run check
```

| Command                                   | What it does                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `docker compose up dev`                   | Vite dev server on http://localhost:5173 (no service worker in dev)                |
| `./scripts/dnpm run check`                | Typecheck, lint, format check and unit tests                                       |
| `./scripts/dnpm run build`                | Production build into `dist/`                                                      |
| `./scripts/dnpm install <pkg>`            | Add a dependency (updates `package.json` and the lockfile)                         |
| `./scripts/e2e`                           | Playwright end-to-end tests (PWA, undo/redo, saving, export and import, GPU reset) |
| `./scripts/e2e replay --update-snapshots` | Refresh the visual regression reference images after an intended change            |
| `./scripts/dnpm run size`                 | Build, then check the startup JavaScript against its 250 KB gzipped budget         |

When `package.json` changes under you (e.g. after a `git pull`), refresh the dependency volume:

```bash
./scripts/dnpm ci
```

## Deploy

One image, three modes. The mode is chosen by an env file in `deploy/env/`.

| Mode            | Who it's for                                           | URL                        | HTTPS                                        |
| --------------- | ------------------------------------------------------ | -------------------------- | -------------------------------------------- |
| **Same system** | Drawing on the machine running Docker (e.g. a Surface) | `http://localhost:8080`    | Not needed: `localhost` is a secure context  |
| **LAN**         | Tablets on your home/office network                    | `https://<LAN IP>`         | Caddy's internal CA, trusted once per device |
| **Cloud**       | Anywhere, via a domain name                            | `https://draw.example.com` | Automatic Let's Encrypt certificate          |

DrawThing has no backend. Drawings stay in each device's browser storage (IndexedDB), so every mode
serves the same static files. Each device and browser has its own gallery: use Share → DrawThing to
move or back up artwork.

### Same system

```bash
docker compose --env-file deploy/env/local.env up -d --build app
```

Open http://localhost:8080 and install it from the browser's address bar (Edge/Chrome). This mode
only listens on `127.0.0.1`.

### LAN

1. Copy the preset and set `LAN_ADDRESS` to the IP tablets use to reach this machine:

   ```bash
   cp deploy/env/lan.env.example deploy/env/lan.env
   ```

2. Start it:

   ```bash
   docker compose --env-file deploy/env/lan.env up -d --build app
   ```

3. **Trust the local certificate authority once per device.** Open `http://<LAN_ADDRESS>:8081/ca.crt`:
   - **iPad:** allow the download, then Settings → Profile Downloaded → Install. Then Settings →
     General → About → Certificate Trust Settings → enable "Caddy Local Authority".
   - **Windows:** open the file → Install Certificate → Local Machine → "Trusted Root Certification
     Authorities".
4. Open `https://<LAN_ADDRESS>`. On iPad, use Share → Add to Home Screen to install.

The CA lives in the `caddy_data` volume and survives restarts and rebuilds. `docker compose down -v`
deletes it, and then every device has to trust the new one.

**Running Docker inside WSL2** (no Docker Desktop)? WSL sits behind NAT, so the LAN can't see its
ports. Either enable mirrored networking (`networkingMode=mirrored` under `[wsl2]` in
`%UserProfile%\.wslconfig`, then `wsl --shutdown`), or forward ports 80, 443 and 8081 with
`netsh interface portproxy`. Docker Desktop publishes ports on Windows directly. In both cases,
allow the ports through Windows Firewall.

### Cloud

**A VM with a domain name** (any provider). Point DNS at the VM, open ports 80 and 443, then:

```bash
cp deploy/env/cloud.env.example deploy/env/cloud.env
```

Set `SITE_ADDRESS` to your domain, then start it:

```bash
docker compose --env-file deploy/env/cloud.env up -d --build app
```

Caddy gets and renews the certificate automatically.

**Managed container platforms** (Cloud Run, Fly.io, Render, Azure Container Apps, …) terminate TLS
themselves. Build and push the `runtime` image, then deploy it with `SITE_ADDRESS=:8080` (or the
platform's port):

```bash
docker build --target runtime -t registry.example.com/drawthing .
```

```bash
docker push registry.example.com/drawthing
```

### Published image

Every push to `main` publishes the `runtime` image to GitHub Packages as
`ghcr.io/alexmealey/draw-thing`, for Intel/AMD and ARM (`.github/workflows/publish.yml`). A
`v1.2.0` tag also publishes `:1.2.0` and `:1.2`. To run it without the source, on the same
system:

```bash
docker run -d --name drawthing -p 127.0.0.1:8080:80 ghcr.io/alexmealey/draw-thing
```

For LAN or cloud mode, set `APP_IMAGE=ghcr.io/alexmealey/draw-thing` in the env file, then
`docker compose --env-file <file> pull app` and `up -d app`, without `--build`.

## Desktop app (experimental)

The `experimental/tauri` branch also builds DrawThing as a native desktop app with
[Tauri](https://tauri.app): an `.exe` on Windows, a `.dmg` on macOS and an AppImage/`.deb` on
Linux. It needs no Docker and no browser. It's the same app with two differences:

- **Your artwork lives in a library folder you choose**, as plain files, rather than in browser
  storage. The default is `Documents/DrawThing`. To change it, open **Actions** in the top bar,
  then **Change location…** under Library:
  - If the folder you pick is empty, DrawThing offers to move your library there. It can also start
    an empty library there instead.
  - If the folder already holds a DrawThing library, it switches to that one, and the old library
    stays where it is.
  - If the folder has other files in it (Documents, say), the library goes in a `DrawThing`
    subfolder.

  The folder holds the artwork plus brushes, palettes and preferences, so they all move with it
  (onto a synced drive like OneDrive, for example). It also has an `Exports` folder, where the
  Save dialog starts. **Show in folder** opens the library folder.

- Double-clicking a `.drawthing` file opens it in the app, and so does opening one with the app
  while it's running.

```
<library>/
  library.json                    marks the folder as a library; the last open artwork
  settings/tools.json             brushes and preferences
  settings/palettes.json          palettes
  artworks/<id>/project.json      name, size and layers
  artworks/<id>/thumb.png         gallery thumbnail
  artworks/<id>/tiles/<layer>/<n>.bin   pixels, 256 × 256 tiles (zlib-deflated RGBA)
  Exports/
```

Each autosave is written whole to a journal before any file changes, so killing the app mid-save
never leaves an artwork half-saved: the next launch finishes the save.

**Get it:** download the build for your OS from the Artifacts of the latest
[Desktop app workflow run](https://github.com/alexmealey/draw-thing/actions/workflows/desktop.yml).
The builds aren't signed, so Windows SmartScreen ("More info → Run anyway") or macOS Gatekeeper
(right-click → Open) asks once. Browser artwork doesn't carry over by itself. Use Share →
DrawThing in the browser, then import the files in the app.

**Build it yourself:** you need Node 22 and [Rust](https://rustup.rs) on the machine you build
for (plus Tauri's [system packages](https://tauri.app/start/prerequisites/) on Linux):

```bash
npm ci
```

```bash
npm run desktop
```

`npm run desktop` opens the app with hot reload. `npm run desktop:build` makes the installer in
`src-tauri/target/release/bundle/`. From WSL or Linux with only Docker, the `desktop` image runs
the Rust tests and the Linux build:

```bash
./scripts/dcargo test
```

```bash
docker compose run --rm -w /app desktop sh -c "npm ci && npm run desktop:build"
```

Pen input needs a native window. WSLg doesn't pass the pen through, so try drawing on Windows
itself.

## Testing on tablets during development

- **Pen input over the LAN, with hot reload:** start the dev server with
  `DEV_BIND=0.0.0.0 DEV_HTTPS=1 docker compose up dev`, open `https://<LAN IP>:5173` and accept the
  self-signed certificate warning. Pointer Events work. iOS refuses service workers on untrusted
  certificates, though, so test install and offline with the LAN deployment above.
- **Tunnels:** a tunnel such as Cloudflare Tunnel gives a trusted HTTPS URL without touching the
  network. To tunnel the dev server, allow its hostname with `VITE_ALLOWED_HOSTS=<host>` (or `all`).
- **Windows drives:** if the source lives on a Windows drive mounted into a container, set
  `VITE_USE_POLLING=1` so file changes are noticed.

## Debug tools (no Mac needed)

Add query flags once. They're remembered per device, so the installed app keeps them.

- `?debug` shows the HUD:
  - FPS, input-to-GPU latency, dabs per frame, zoom and rotation
  - Pointer events/s vs **samples/s**. Samples/s includes coalesced events, so it's the real
    digitizer rate, about 240/s on Apple Pencil.
  - Pressure, tilt, altitude and azimuth
  - WebGL2, coalesced and predicted event support
  - Service worker, online and storage state
- `?log` mirrors `console.*` and uncaught errors to the dev server's output
  (`docker compose logs -f dev`). The deployed Caddy image has no log endpoint, so the client
  switches itself off there.
- `?debug=0` / `?log=0` turns them off.
- `?lab` opens the benchmark lab on a scratch canvas. It never touches your artwork.
  - It holds the §7.1 benchmarks, a 30-minute soak test, and stroke recording and replay.
  - With `?debug`, the recorder is also in Actions → Diagnostics.
  - See [docs/QA.md](docs/QA.md).

## Layout

```
src/
  app/        React UI: editor/ (top bar, sidebar, panels), gallery/, ui/ (panel, modal, sliders,
              icons), palette/ (palette files, colours from an image)
  state/      Zustand stores: document (layers), tools and palettes (persisted per device), history,
              thumbnails, view
  engine/     WebGL2 engine: input, gestures, view transform, brush, layers, history, rendering
  persistence/  stored projects and tiles (IndexedDB, or desktop/ for the library folder), the
              autosaver, the saved document format
  files/      export and import: PNG/JPEG, PSD (ag-psd, in a worker), .drawthing (zip), delivery
  debug/      flags, HUD, remote logging client, stroke recorder controls
  lab/        benchmark lab (?lab): benchmarks, soak, synthetic strokes, regression scenes
  platform/   OS / install-mode detection, service worker updates, install prompt, file launches;
              desktop.ts for the desktop app (settings, opened files, library location)
  styles/     global CSS: design tokens + browser-gesture suppression
tools/        Vite plugins (remote-log endpoint), bundle-size check
e2e/          Playwright tests; snapshots/ holds reference images, recordings/ real pen sessions
deploy/       Caddyfile and env presets (local / LAN / cloud)
src-tauri/    the desktop app: Rust shell, library folder (src/library/), tauri.conf.json
scripts/      dnpm (npm in Docker), dcargo (cargo in Docker), e2e
Dockerfile, compose.yaml
.github/workflows/publish.yml   publishes the runtime image to ghcr.io
.github/workflows/desktop.yml   builds the desktop app for Windows, macOS and Linux
public/logo.svg   source for all generated icons and iPad splash screens (pwa-assets.config.ts)
```
