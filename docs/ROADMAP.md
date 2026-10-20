# DrawThing — MVP Technical Roadmap

_Procreate-style drawing PWA for iPad + Apple Pencil and Windows tablets + Surface/MPP pens._

## 0. TL;DR decisions

| Concern | Decision |
|---|---|
| UI shell | **React 19 + TypeScript + Vite**. React renders chrome only and never sits in the paint hot path. |
| Rendering | **Custom WebGL2 engine** (thin helpers via `twgl.js`), in imperative TS classes outside React. |
| State | **Zustand** for document metadata and tool settings. Engine-owned **command-pattern history** with **tile-diff** pixel undo. |
| Input | Pointer Events + `getCoalescedEvents` + `getPredictedEvents` (feature-detected), rAF-batched rendering. |
| Brush | Dab/stamp engine: stabilizer → midpoint-quadratic path → arc-length spacing → instanced dabs into a **stroke buffer**. |
| Layers | One GPU texture per layer. Logical 256² tile grid for dirty tracking, undo and saves. Compositor caches **below/above** the active layer. |
| Persistence | IndexedDB (`idb`), dirty tiles only, written from a Worker. `.drawthing` zip format, PNG/JPEG/PSD export. |
| PWA | `vite-plugin-pwa` (Workbox `generateSW`), prompt-to-update, iOS install coach and persistent storage. |
| Delivery | **Docker everywhere.** npm runs only inside containers (dev server, builds, tests). Production is a static Caddy image deployed on the same system, on a LAN (internal CA) or in the cloud (Let's Encrypt or platform TLS). See §10. |

Complexity scale: **S** ≤ 2 days · **M** 3–5 days · **L** 1–2 weeks · **XL** 2–4 weeks (one senior dev).

### Timeline overview

| Phase | Scope | Complexity | Est. |
|---|---|---|---|
| P0 | Foundations, tooling, Docker dev/deploy, HTTPS device loop | M | 1 wk |
| P1 | GL engine core, viewport, input pipeline | L | 2 wk |
| P2 | Brush engine | XL | 2–3 wk |
| P3 | Layers & compositor | L | 2 wk |
| P4 | Undo/redo & history | L | 1–1.5 wk |
| P5 | UI shell & gestures (parallelizable with P2–P4) | L | 2 wk |
| P6 | Persistence & export | L | 2 wk |
| P7 | PWA hardening (iOS/Windows) | M | 1 wk |
| P8 | Performance & device QA sprint (plus continuous) | M–L | 1–2 wk |
| P9 | *(optional)* Cloud sync | L | 2 wk |

**Total MVP: about 13–16 weeks for one dev, or 8–10 weeks for two** (one on the engine, one on UI and persistence).

---

## 1. Architecture & stack selection

### 1.1 Rendering library comparison

| Option | Fit for a raster painting app | Verdict |
|---|---|---|
| **React + Konva.js** | Scene graph of *vector objects* with hit-testing. Painting means thousands of dabs per stroke, so you end up drawing into an image node anyway and paying scene-graph overhead. Konva has no layer blend shaders and no FBO control. | ❌ Wrong abstraction |
| **Raw Canvas2D** | Simplest option, and `globalCompositeOperation` gives every blend mode for free. But **iOS Safari caps total canvas memory** (a few hundred MB, depending on device). 20 layers at 2732×2048 (22.4 MB each) is about 450 MB and blows the cap. There's no float buffers, so low-flow buildup bands, and per-dab `drawImage` gets CPU-bound with large soft brushes. | ⚠️ Good for prototypes and export helpers, not the engine |
| **PixiJS v8** | WebGL2/WebGPU, `RenderTexture` for layers, batching, and advanced blend modes as filters. A solid fallback if the team lacks GL experience. Its scene-graph and renderer abstractions get in the way of the parts that matter here: ping-pong blend passes, premultiplied-alpha control, scissored dirty rects and async PBO readback for undo. | ✅ Acceptable fallback |
| **Three.js** | A 3D engine: cameras, materials and a scene graph that 2D painting doesn't need, plus a large bundle. | ❌ Overkill |
| **Custom WebGL2 (+ twgl.js)** | The hot path is small: (a) stamp instanced dabs into an FBO and (b) composite N layer textures with blend shaders. That's about 1.5–2k LOC you fully control. You get float/half-float stroke buffers, scissor-limited recompositing, async readback, and a straight path to OffscreenCanvas-in-Worker and later WebGPU. | ✅ **Recommended** |

**Why WebGL2 wins on layer management and performance**
- GPU memory isn't subject to Safari's Canvas2D cap. A layer is a texture plus an FBO, and a budget formula (§4.4) keeps you below jetsam limits.
- Compositing cost per frame is **O(1) in layer count** during a stroke, thanks to the below/above caches (§4.2).
- Blend modes are about 30 lines of GLSL that follow the W3C Compositing spec, the same math `globalCompositeOperation` uses, so results match Canvas2D and PSD semantics.
- WebGL2 is universal on iPadOS 15+ and Chromium/Edge on Windows. WebGPU can be an optional backend later, behind the same `Renderer` interface.

### 1.2 Module architecture

```
src/
  app/            React shell: screens, panels, design tokens
  state/          Zustand stores: documentStore (layers JSON), toolStore (brush, color), uiStore
  engine/
    Engine.ts         owns GL context, frame loop, wires everything
    gl/               twgl wrappers: Target (tex+fbo), QuadRenderer, programs, PBO readback
    input/            PointerInput, GestureRecognizer, Stabilizer
    brush/            BrushPreset types, StrokePath, DabGenerator, DabRenderer (instanced)
    layers/           LayerStore (GPU layers), Compositor, Viewport (pan/zoom/rotate present)
    history/          History, commands, TileCapture (async PBO)
  workers/        persistence.worker.ts (IDB + deflate), export.worker.ts (PNG/JPEG/PSD encode)
  storage/        idb schema, project (de)serialization, .drawthing zip
Dockerfile        multi-stage: dev (Node), build, runtime (Caddy), e2e (Playwright)
compose.yaml      services: dev, app, e2e
deploy/           Caddyfile + env presets (local, LAN, cloud)
scripts/          dnpm (npm in Docker), e2e
```

Data flows one way: **React/Zustand → Engine** (commands such as `setLayerOpacity`) and
**Engine → Zustand** (only coarse facts: `canUndo`, layer thumbnails, dirty flag). The engine subscribes to
stores with `subscribeWithSelector`. React never re-renders during a stroke.

### 1.3 PWA configuration strategy  — [M]

**Common (both platforms)**
- `vite-plugin-pwa` with `generateSW`. Precache the whole app shell, including brush tip and grain textures as hashed assets. No runtime caching for user data, which lives in IndexedDB. `navigateFallback: 'index.html'`.
- `registerType: 'prompt'`. Show an "Update ready" toast **only in the gallery or right after a save**. Never reload mid-drawing.
- Call `navigator.storage.persist()` on first project creation and show `navigator.storage.estimate()` in Settings.
- Serve over HTTPS wherever the browser doesn't already treat the origin as secure. The Caddy runtime image handles this per deployment mode (§10): plain `localhost` on the same system, an internal CA on the LAN, and Let's Encrypt or platform TLS in the cloud.

```jsonc
// manifest (generated by vite-plugin-pwa)
{
  "id": "/", "name": "DrawThing", "short_name": "DrawThing",
  "start_url": "/?source=pwa", "scope": "/",
  "display": "standalone",
  "display_override": ["window-controls-overlay", "standalone"],   // Windows desktop-mode titlebar
  "orientation": "any",
  "background_color": "#1c1c1e", "theme_color": "#1c1c1e",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "screenshots": [ /* wide + narrow: richer install UI in Chrome/Edge */ ],
  "file_handlers": [{ "action": "/open", "accept": {
      "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "application/x-drawthing": [".drawthing"] } }],
  "launch_handler": { "client_mode": "focus-existing" }
}
```

**iOS / iPadOS Safari quirks**
- Safari never fires `beforeinstallprompt`. Detect `isIPad && !navigator.standalone` and show an `<InstallCoach>` that walks through Share → Add to Home Screen. Note that iPadOS reports a Mac UA, so use `navigator.maxTouchPoints > 1` to detect it.
- **Storage is separate** between the Safari tab and the home-screen app, so projects don't carry over. Push installation *before* the user creates work, and say so in the coach.
- Script-writable storage in **non-installed** Safari sites can be evicted after 7 days without use (ITP). Installed web apps are exempt. That's one more reason to install.
- Head tags: `viewport` with `viewport-fit=cover, user-scalable=no` (Safari may ignore `user-scalable`, so §2.3 covers zoom blocking), `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, a 180px `apple-touch-icon`, and `apple-touch-startup-image` splash screens (generate them with `pwa-asset-generator`).
- Lay out with `env(safe-area-inset-*)`. Home-indicator and edge swipes can't be blocked.
- **WebGL context loss** happens on memory pressure and backgrounding. Handle `webglcontextlost`/`restored` by rebuilding textures from IndexedDB, which is the source of truth because we autosave after every stroke (§6.2).

**Windows (Edge / Chrome)**
- Show a custom Install button via `beforeinstallprompt`. `file_handlers` lets users "Open with DrawThing" from Explorer. Optionally package for the Microsoft Store with **PWABuilder**.
- Use the File System Access API (`showSaveFilePicker`) for real Save As. Wrap it with `browser-fs-access` so iOS falls back to download or share.
- `window-controls-overlay` gives a full-bleed canvas in desktop mode. Use `titlebar-area-*` env vars in CSS.

### 1.4 State management & undo/redo  — [L]

Three tiers, kept strictly apart:

1. **Engine state** (GPU textures, in-flight stroke, caches): plain TS objects, mutable, no reactivity.
2. **Document model** (layer stack JSON, active layer, canvas size) and **tool state** (brush, color): **Zustand**. Small, serializable, drives React.
3. **Ephemeral UI** (which panel is open, slider being dragged): React local state.

**History = command pattern with tile diffs**, owned by `engine/history`:

```ts
type TileKey = `${number},${number}`;          // 256×256 tile coordinates
type TileData = Uint8Array | null;              // premultiplied RGBA8; null = fully transparent (free)

type HistoryEntry =
  | { kind: 'pixels'; layerId: string; tiles: Map<TileKey, { before: TileData; after: TileData }>; bytes: number }
  | { kind: 'layerProps'; layerId: string; before: Partial<LayerMeta>; after: Partial<LayerMeta> }
  | { kind: 'layerAdd' | 'layerDelete'; meta: LayerMeta; index: number; tiles?: Map<TileKey, TileData> }
  | { kind: 'layerMove'; from: number; to: number }
  | { kind: 'merge'; /* composite of the above */ steps: HistoryEntry[] };
```

- Strokes paint into a separate **stroke buffer**, so the layer is untouched until pen-up (§3.2). At commit: issue
  `readPixels` of the dirty tiles into a **PBO** (*before*), merge the stroke, issue a second PBO read (*after*), then
  `fenceSync`. Map the buffers a frame or two later. Commit never stalls the GPU.
- Undo means `texSubImage2D` of the *before* tiles. Redo writes the *after* tiles. Both are O(dirty tiles).
- The history budget is **bytes, not steps**: about 256 MB on iPad and 512 MB on Windows. Evict the oldest entries. Compress idle entries in a worker with `CompressionStream('deflate')` or `fflate`.
- The *after* tiles double as the **autosave payload**, so persistence never reads back from the GPU a second time.
- Zustand only holds `{ canUndo, canRedo }`.
- **As built (Phase 4):**
  - Layer-panel changes (add, delete, move, properties, background) are recorded automatically from the document store. Consecutive opacity or background-colour changes within 1.5 s merge into one step.
  - Merge Down, Flatten and Clear record their own entries, with sparse whole-layer tile diffs.
  - A deleted layer's pixels are kept in its entry, so undo brings it back intact.
  - Steps more than 8 away from the cursor are deflated with `CompressionStream` once drawing pauses. Undo inflates them asynchronously, through a queue that applies steps in order.
  - `e2e/history.spec.ts` checks that 150 undo/redo steps reproduce every intermediate image exactly.

---

## 2. Input handling & stylus optimization (critical)

### 2.1 Unifying input with Pointer Events  — [L]

- Listen on the canvas element only, with `setPointerCapture` on down.
- **Pen-first palm rejection:** after the first `pointerType === 'pen'` contact, fingers never paint. They only do gestures (pinch, rotate, pan, 2-finger tap to undo, 3-finger tap to redo). Touches that arrive while the pen is down are ignored entirely (palm).
- **Finger painting** is allowed until a pen is seen, with a setting to override. A second finger arriving within a stroke **cancels** that stroke, because it was the start of a gesture.
- Read the full digitizer rate with `getCoalescedEvents()` (Apple Pencil reports at about 240 Hz). Without it, the 60/120 Hz event loop drops samples and fast strokes turn polygonal.
- On Chromium, `getPredictedEvents()` gives you prediction. Feature-detect both.
- Map extra hardware: the Surface/Wacom **eraser end** is `button === 5` or `buttons & 32`, and the **barrel button** is `buttons & 2`. Pen **hover** shows up as `pointermove` with `buttons === 0`: Apple Pencil hover on M2+ iPad Pro, and Surface Pen in range. Use it for a brush-size cursor.
- Apple Pencil double-tap and squeeze **aren't exposed to the web**. Provide on-screen equivalents instead (the Modify button).

#### Critical snippet: `engine/input/PointerInput.ts`

```ts
export interface InputSample {
  x: number; y: number;              // document pixels
  pressure: number;                  // 0..1 (normalized)
  altitude: number; azimuth: number; // radians, Pointer Events L3 convention
  t: number;                         // ms (event.timeStamp)
}

export interface StrokeSink {
  begin(s: InputSample, opts: { pointerType: string; eraser: boolean; barrel: boolean }): void;
  extend(samples: InputSample[]): void;  // enqueue only; drained once per rAF
  predict(samples: InputSample[]): void; // replaces the previous prediction
  hover(s: InputSample | null): void;    // pen hover cursor
  end(): void;                           // commit stroke
  cancel(): void;                        // discard (finger stroke became a gesture)
}

export interface GestureSink {
  update(touches: ReadonlyMap<number, PointerEvent>): void; // pinch/rotate/pan, 2/3-finger taps
  release(pointerId: number): void;
}

type PE = PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };

export class PointerInput {
  private drawingId: number | null = null;
  private drawingType = '';
  private penSeen = false;              // first pen contact switches fingers to gestures-only
  fingerDrawing = true;                 // user preference
  private touches = new Map<number, PointerEvent>();
  private lastPressure = 0.5;
  private rect: DOMRect;
  private ro: ResizeObserver;
  private ac = new AbortController();

  constructor(
    private el: HTMLElement,
    private sink: StrokeSink,
    private gestures: GestureSink,
    private screenToDoc: (x: number, y: number) => [number, number], // inverse view transform
  ) {
    // Never call getBoundingClientRect per event (forces layout). Canvas is position:fixed.
    this.rect = el.getBoundingClientRect();
    this.ro = new ResizeObserver(() => { this.rect = el.getBoundingClientRect(); });
    this.ro.observe(el);

    const opts = { passive: false, signal: this.ac.signal } as const;
    el.addEventListener('pointerdown', this.onDown, opts);
    el.addEventListener('pointermove', this.onMove, opts);
    el.addEventListener('pointerup', this.onUp, opts);
    el.addEventListener('pointercancel', this.onCancel, opts);
    el.addEventListener('pointerleave', () => this.sink.hover(null), opts);

    // CSS `touch-action: none` handles panning, but iOS Safari still needs these to stop
    // the magnifier loupe, callout menu, double-tap zoom and WebKit's gesture events.
    // (preventDefault on touch events does NOT suppress pointer events.)
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', block, opts);
    el.addEventListener('touchmove', block, opts);
    el.addEventListener('gesturestart', block, opts);  // WebKit-only
    el.addEventListener('contextmenu', block, opts);   // Windows pen press-and-hold = right-click
  }

  dispose() { this.ac.abort(); this.ro.disconnect(); }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'pen') this.penSeen = true;

    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, e);
      if (this.drawingType === 'pen') return;           // palm on glass while pen is down
      const canDraw = !this.penSeen && this.fingerDrawing
        && this.touches.size === 1 && this.drawingId === null;
      if (!canDraw) {
        // A second finger means the first one was the start of a gesture, not a stroke.
        if (this.drawingType === 'touch') this.abortDrawing();
        this.gestures.update(this.touches);
        return;
      }
    }
    if (this.drawingId !== null) return;                // one drawing pointer at a time

    this.drawingId = e.pointerId;
    this.drawingType = e.pointerType;
    this.el.setPointerCapture(e.pointerId);
    this.sink.hover(null);
    this.sink.begin(this.sample(e), {
      pointerType: e.pointerType,
      eraser: e.button === 5 || (e.buttons & 32) !== 0, // Surface/Wacom eraser end
      barrel: (e.buttons & 2) !== 0,                     // barrel button → eyedropper/modifier
    });
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && e.pointerId !== this.drawingId) {
      if (this.touches.has(e.pointerId)) {
        this.touches.set(e.pointerId, e);
        if (this.drawingType !== 'pen') this.gestures.update(this.touches);
      }
      return;
    }
    if (e.pointerId !== this.drawingId) {
      if (e.pointerType === 'pen' && e.buttons === 0) this.sink.hover(this.sample(e));
      return;
    }
    // Coalesced events recover the full digitizer rate the event loop would drop.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    this.sink.extend((coalesced.length ? coalesced : [e]).map(this.sample));
    // Prediction (Chromium today). Rendered to a throwaway buffer, replaced every frame.
    const predicted = e.getPredictedEvents?.() ?? [];
    this.sink.predict(predicted.map(this.sample));
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.delete(e.pointerId) && e.pointerId !== this.drawingId) {
      this.gestures.release(e.pointerId);
      return;
    }
    if (e.pointerId !== this.drawingId) return;
    this.sink.extend([this.sample(e)]);
    this.sink.end();
    this.release();
  };

  // iOS fires pointercancel for system gestures (Control Center, app switcher, Stage Manager).
  // Commit pen strokes instead of discarding, so the user never loses ink.
  private onCancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch') { this.touches.delete(e.pointerId); this.gestures.release(e.pointerId); }
    if (e.pointerId !== this.drawingId) return;
    if (this.drawingType === 'touch') { this.abortDrawing(); return; }
    this.sink.end();
    this.release();
  };

  private abortDrawing() { this.sink.cancel(); this.release(); }

  private release() {
    if (this.drawingId !== null && this.el.hasPointerCapture(this.drawingId)) {
      this.el.releasePointerCapture(this.drawingId);
    }
    this.drawingId = null;
    this.drawingType = '';
  }

  private sample = (e: PointerEvent): InputSample => {
    const ev = e as PE;
    const [x, y] = this.screenToDoc(e.clientX - this.rect.left, e.clientY - this.rect.top);
    let pressure = 1;                       // mouse / finger: full pressure, curves decide the rest
    if (e.pointerType === 'pen') {
      // Windows Ink often reports 0 on the first contact sample and 0 on pointerup.
      // Pens without pressure report a constant 0.5 per spec.
      pressure = e.pressure > 0 ? e.pressure : this.lastPressure;
      this.lastPressure = pressure;
    }
    const { altitude, azimuth } = ev.altitudeAngle !== undefined
      ? { altitude: ev.altitudeAngle, azimuth: ev.azimuthAngle ?? 0 }
      : tiltToSpherical(e.tiltX, e.tiltY);
    return { x, y, pressure, altitude, azimuth, t: e.timeStamp };
  };
}

/** tiltX/tiltY (degrees, Windows pens) → altitude/azimuth (radians, Apple Pencil convention). */
function tiltToSpherical(tiltXDeg: number, tiltYDeg: number) {
  const tx = Math.tan((tiltXDeg * Math.PI) / 180);
  const ty = Math.tan((tiltYDeg * Math.PI) / 180);
  if (tx === 0 && ty === 0) return { altitude: Math.PI / 2, azimuth: 0 };
  return {
    altitude: Math.atan(1 / Math.hypot(tx, ty)),
    azimuth: (Math.atan2(ty, tx) + 2 * Math.PI) % (2 * Math.PI),
  };
}
```

*Production hardening:* pool `InputSample` objects to avoid per-event allocation. Also try `pointerrawupdate`
(Chromium, secure contexts) behind a flag, A/B-measuring the latency against `pointermove`.

### 2.2 Pressure, tilt & latency reduction  — [L]

**Input processing pipeline** (runs once per rAF over the queued samples):

```
raw samples ─► Stabilizer (StreamLine) ─► pressure EMA + curve LUT ─► StrokePath (midpoint quadratic)
            ─► arc-length dab spacing ─► DabRenderer (instanced, 1 draw call) ─► Compositor (dirty rect) ─► present
```

- **Pressure:** a light EMA (α ≈ 0.4) removes digitizer jitter. Map it through a user-editable **cubic-bezier curve** baked into a 256-entry LUT, with separate curves for size and flow per brush. Optional taper ramps pressure over the first and last N px.
- **Tilt:** `altitude` maps to size boost and grain softening for pencil shading. `azimuth` rotates the tip for flat or chisel tips. Both feed `Dab.angle` and `Dab.size`.
- **Stabilization (StreamLine):** a pulled-string filter that is frame-rate independent (`k = 1 − e^(−dt/τ)`, τ from 0–120 ms, set by the user). On pen-up it **catches up** to the raw end point so strokes end where the pen lifted. Optionally add a **One-Euro filter** for slow-speed jitter on some MPP digitizers. It's speed-adaptive, so fast strokes stay responsive.
- **Prediction:** use `getPredictedEvents()` where available. Otherwise, linearly extrapolate the last ~16 ms of velocity, capped at one frame. Draw it into a **throwaway prediction buffer** that's cleared every frame, so it's never committed. Turn prediction off when StreamLine > 0, because the two contradict each other.

**Latency checklist**
- No React and no Zustand writes in the hot path. Pointer handlers only enqueue.
- Render once per `requestAnimationFrame`. Behind a flag, try *render-in-event* for `desynchronized` contexts on Chromium.
- `canvas.getContext('webgl2', { desynchronized: true, alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' })`. On Chromium/Windows, `desynchronized` can bypass the compositor queue. Safari ignores it, which is harmless. `high-performance` matters on dual-GPU Surface Books.
- Recomposite only the **dirty rect** with `gl.scissor`. One instanced draw call per frame for all new dabs.
- Use `contain: strict` on the viewport container and keep `backdrop-filter` blur off the canvas area. Blur over a changing canvas costs a lot of frame time on iPad.
- Move persistence, compression and encoding to Workers, so the main thread stays free.
- **Don't assume 120 Hz on iPad.** Safari has historically capped rAF at 60 Hz even on ProMotion (the "Prefer Page Rendering Updates near 60fps" setting), and Low Power Mode throttles further. Coalesced events still give full-rate *geometry*. Measure on current iPadOS.

### 2.3 Preventing browser behaviors (scroll, zoom, selection)  — [S]

```css
html, body {
  position: fixed; inset: 0; overflow: hidden;
  overscroll-behavior: none;                 /* no pull-to-refresh / rubber-banding */
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none;               /* iOS long-press callout */
  -webkit-tap-highlight-color: transparent;
}
.canvas { touch-action: none; }              /* disables pan/zoom/pen-flicks on the canvas */
button, .panel { touch-action: manipulation; } /* kills double-tap zoom on chrome UI */
.slider { touch-action: none; }              /* custom sliders handle their own drags */
```

- Combine this with the JS listeners in the snippet above: `touchstart`/`touchmove` with `{passive:false}` plus `preventDefault()`, WebKit `gesturestart`, and `contextmenu`.
- iOS ignores `user-scalable=no` for accessibility. The blocked `touchmove`/`gesturestart` handlers are what actually prevent page zoom, and our own pinch handles canvas zoom.
- Block keyboard zoom too: `Ctrl/⌘ + wheel` and `Ctrl/⌘ + +/-` → `preventDefault` and route them to canvas zoom. This matters for Windows tablets with a type cover.
- Text inputs, such as layer rename, get `user-select: text` locally, so iPadOS Scribble and selection still work there.

---

## 3. The brush engine (simplified MVP)

### 3.1 Modular brush architecture  — [L]

A brush is **pure data** (JSON), so presets are serializable, importable and testable. The pipeline stages are
small interfaces you can swap out: `Stabilizer`, `StrokePath`, `DabGenerator(brush)`, `DabRenderer(gl)`.

```ts
interface BrushPreset {
  id: string; name: string;
  tip:   { texture: string; roundness: number; angle: number; followStroke: boolean; tiltRotates: boolean };
  grain?: { texture: string; scale: number; depth: number; mode: 'moving' | 'texturized' };
  size:  { min: number; max: number };  // doc px; pressure lerps between
  opacity: number;                      // stroke-level cap (0..1)
  flow: number;                         // per-dab alpha (0..1)
  spacing: number;                      // fraction of diameter (0.02..1)
  accumulate: 'over' | 'max';           // build-up vs. marker-style (no overlap darkening)
  pressure: { size: CurveLUT; flow: CurveLUT };
  tilt?: { sizeBoost: number };
  jitter?: { size: number; angle: number; scatter: number };
  stabilization: number;                // StreamLine 0..1
  erase?: boolean;                      // any preset can be used as an eraser
}
```

**Size, Opacity, Flow and Pressure semantics (Procreate-like)**
- **Size** is the dab diameter, `lerp(min, max, curve.size(pressure)) × tiltBoost`.
- **Flow** is the alpha deposited by each dab, `flow × curve.flow(pressure)`. Overlapping dabs build up *within* a stroke.
- **Opacity** is the *ceiling* for the whole stroke. It's applied once, when the stroke buffer is composited onto the layer, so a stroke can never get more opaque than this value however much you scrub.
- **Pressure mapping** uses per-target curves (size and flow) edited with a 2-handle bezier in Brush Settings.

**MVP presets (5):**
- Ink: hard round, flow 1, size ← pressure.
- Pencil: grainy tip, moving grain, flow ← pressure, tilt → size.
- Airbrush: soft tip, flow 0.1, spacing 8%.
- Marker: chisel tip, `accumulate: 'max'`.
- Chalk: texturized grain plus size, angle and scatter jitter.

The **Eraser** is a mode, not a preset: it erases with whichever brush is selected, as in Procreate. The
Surface Pen's eraser end switches it on for that stroke. Grain textures are generated procedurally
(`brush/grain.ts`), so there are no image assets to ship.

### 3.2 Stroke rendering algorithm  — [L]

**Midpoint quadratic Béziers + arc-length dab spacing.** Raw samples are joined by quadratic curves that run from
`mid(Pᵢ₋₁,Pᵢ)` to `mid(Pᵢ,Pᵢ₊₁)`, with `Pᵢ` as the control point.

- **Versus line segments:** fast strokes at 240 Hz still have 20–40 px gaps. Straight segments give visible corners, while quadratics are C¹-continuous.
- **Versus Catmull-Rom:** Catmull-Rom needs a lookahead sample (one more sample of latency). The midpoint scheme only needs the current sample.
- Pressure is interpolated along the same curve. Dabs are emitted every `spacing × diameter` along the arc length. A carry-over distance keeps spacing uniform across segment boundaries and frames.

```ts
// engine/brush/StrokePath.ts
export interface Pt { x: number; y: number; p: number }    // p = stabilized, curve-mapped pressure

export class StrokePath {
  private prev: Pt | null = null;
  private lastMid: Pt | null = null;
  private toNext = 0;                                        // arc length until next dab

  constructor(private spacingAt: (p: number) => number,      // ≥ 0.5 px
              private emit: (pt: Pt, out: Pt[]) => void) {}

  push(pt: Pt, out: Pt[]) {
    if (!this.prev) { this.prev = this.lastMid = pt; this.emit(pt, out); this.toNext = this.spacingAt(pt.p); return; }
    const mid = lerp(this.prev, pt, 0.5);
    this.walkQuad(this.lastMid!, this.prev, mid, out);
    this.prev = pt; this.lastMid = mid;
  }

  finish(out: Pt[]) { if (this.prev && this.lastMid) this.walkLine(this.lastMid, this.prev, out); }

  private walkQuad(a: Pt, c: Pt, b: Pt, out: Pt[]) {
    const n = Math.max(1, Math.ceil((dist(a, c) + dist(c, b)) / 2));   // ~2 px flattening
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n, mt = 1 - t, w0 = mt * mt, w1 = 2 * mt * t, w2 = t * t;
      const q = { x: w0 * a.x + w1 * c.x + w2 * b.x, y: w0 * a.y + w1 * c.y + w2 * b.y, p: w0 * a.p + w1 * c.p + w2 * b.p };
      this.walkLine(prev, q, out); prev = q;
    }
  }

  private walkLine(a: Pt, b: Pt, out: Pt[]) {
    const len = dist(a, b);
    let pos = 0;
    while (pos + this.toNext <= len) {
      pos += this.toNext;
      const pt = lerp(a, b, pos / len);
      this.emit(pt, out);
      this.toNext = this.spacingAt(pt.p);
    }
    this.toNext -= len - pos;
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
```

**Dab rendering on the GPU:** each frame's dabs are uploaded as one instance buffer `{x, y, size, angle, alpha}` and
drawn with `drawArraysInstanced` into the **stroke buffer**. Use RGBA16F where `EXT_color_buffer_half_float` or
`EXT_color_buffer_float` is renderable. Otherwise fall back to RGBA8 with ordered dithering, so low-flow
airbrushing doesn't band.

**Per-frame loop** (inside the engine's `StrokeSink`):

```ts
onFrame() {
  const dabs: Pt[] = [];
  for (const s of this.queue) this.path.push(this.toPt(this.stabilizer.push(s)), dabs);
  this.queue.length = 0;
  this.dabRenderer.stamp(this.strokeBuffer, dabs, this.brush);   // 1 instanced draw
  this.dirty.add(boundsOf(dabs, this.brush));                     // + last frame's prediction rect
  this.prediction.render(this.predicted);                         // throwaway buffer
  this.viewport.present(this.compositor.render(this.layers, this.active, this.live, this.dirty.take()));
}
```

**Commit (pen-up):** `path.finish()` and stabilizer catch-up → async PBO capture of the *before* tiles → merge the stroke buffer into the layer at `opacity` (blend state from §3.3) → *after* capture → clear the stroke buffer within the dirty rect → push the history entry → mark tiles for autosave.

### 3.3 Texture & compositing (dry media, ink)  — [M]

- **Ink:** a hard tip with flow 1 and `over` accumulation, and no grain. Edges come from the tip's antialiased alpha (smoothstep in the shader, not a bitmap), so they stay crisp at any size.
- **Dry media (pencil, chalk):** the dab alpha is multiplied by a **grain texture sampled in document space** (`gl_FragCoord`-based, so grain stays fixed to the paper = "moving" mode). Low flow plus pressure → flow lets repeated passes fill the paper's valleys. "Texturized" mode instead samples grain in dab space, so the grain rolls with the tip.
- The same operations map one-to-one onto Canvas2D's `globalCompositeOperation`. These are the W3C Porter-Duff operators, implemented as WebGL2 blend state on premultiplied alpha. The Canvas2D column also documents the export and fallback path:

| Purpose | Canvas2D `globalCompositeOperation` | WebGL2 (premultiplied) |
|---|---|---|
| Deposit dab / commit stroke | `source-over` | `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` |
| Eraser | `destination-out` | `blendFunc(ZERO, ONE_MINUS_SRC_ALPHA)` |
| Apply grain/texture mask to stroke | `destination-in` | `blendFunc(ZERO, SRC_ALPHA)` |
| Alpha lock (paint only on existing pixels) | `source-atop` | `blendFunc(DST_ALPHA, ONE_MINUS_SRC_ALPHA)` |
| Marker (no overlap darkening) | ≈ `lighten` on alpha | `blendEquation(MAX)` |
| Add / glow | `lighter` | `blendFunc(ONE, ONE)` |
| Layer modes: multiply, screen, overlay, … | same names | shader (needs backdrop), §4.2 |

---

## 4. Layer system

### 4.1 Data structure  — [M]

The JSON metadata lives in Zustand. Pixels live in GPU textures, and persisted tiles in IndexedDB.
**Index 0 is the bottom.** Groups are designed in (`kind: 'group'`) but stay flat in the MVP.

```jsonc
{
  "schema": 1,
  "id": "prj_01JB…", "name": "Untitled Artwork",
  "width": 2732, "height": 2048, "dpi": 264, "tileSize": 256,
  "background": { "color": "#ffffff", "visible": true },
  "activeLayerId": "lyr_2",
  "layers": [
    { "id": "lyr_1", "name": "Sketch", "kind": "raster",
      "visible": true, "opacity": 0.45, "blendMode": "multiply",
      "locked": false, "alphaLocked": false, "clipToBelow": false,
      "tiles": ["0,0", "1,0", "4,3"],          // non-empty tiles only (sparse)
      "bounds": [0, 0, 1280, 1024],            // tight content box, used for PSD export
      "rev": 41 },                              // bumps on pixel change, used for thumbnails/sync
    { "id": "lyr_2", "name": "Ink", "kind": "raster", "visible": true, "opacity": 1,
      "blendMode": "normal", "locked": false, "alphaLocked": false, "clipToBelow": false,
      "tiles": [], "bounds": null, "rev": 0 }
  ],
  "createdAt": 1729440000000, "updatedAt": 1729443600000
}
```

The blend modes for the MVP are normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn and add.
Alpha lock is in. Clipping masks come later, but the field is reserved.

### 4.2 Rendering pipeline: efficient compositing  — [L]

- **Document space vs. view space.** The compositor produces a single `out` texture at document resolution. The `Viewport` presents it with the pan/zoom/rotate matrix. Panning and zooming run **only the present pass** (one textured quad), with no recompositing at all.
- **Cache around the active layer.** `below` holds the background plus layers under the active one. `above` holds the layers over it, pre-merged. That works because `source-over` is associative. If any above layer uses a non-normal mode, fall back to blending those layers individually, since non-normal modes depend on the backdrop.
- **During a stroke**, each frame costs about four dirty-rect passes, whatever the layer count: copy `below` → `out`, merge active + stroke, blend into `out`, blend `above`.
- **Invalidation** happens on layer property or order changes, a change of active layer, undo/redo on a non-active layer, and visibility toggles.

#### Critical snippet: `engine/layers/Compositor.ts`

```ts
import type { QuadRenderer, Programs } from '../gl';  // thin twgl.js-backed helpers

export interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number } // RGBA, premultiplied
export interface Rect { x: number; y: number; w: number; h: number }  // GL texel coords (bottom-left origin)

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
  | 'color-dodge' | 'color-burn' | 'add';
const MODE_ID: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, 'color-dodge': 6, 'color-burn': 7, add: 8,
};

export interface GpuLayer { id: string; visible: boolean; opacity: number; blendMode: BlendMode; target: Target }
export interface LiveStroke { target: Target; opacity: number; erase: boolean }

/**
 * Composites the layer stack in document space. Everything except the layer being painted is
 * cached, so a frame during a stroke costs ~4 scissored passes regardless of layer count.
 */
export class Compositor {
  private below: Target;    // background + layers[0 .. active-1]
  private above: Target;    // layers[active+1 ..] pre-merged (valid only when all 'normal')
  private out: Target;      // final document image → Viewport.present()
  private preview: Target;  // active layer + live stroke (layer itself untouched until commit)
  private scratch: Target;  // backdrop snapshot for programmable blend modes
  private belowValid = false;
  private aboveValid = false;
  private activeIndex = -1;

  constructor(
    private gl: WebGL2RenderingContext,
    private quad: QuadRenderer,
    private progs: Programs,              // { copy, blend }
    createTarget: () => Target,           // doc-sized RGBA8 texture + FBO
    private background: [number, number, number, number], // premultiplied
  ) {
    this.below = createTarget(); this.above = createTarget(); this.out = createTarget();
    this.preview = createTarget(); this.scratch = createTarget();
  }

  /** Metadata (visibility/opacity/blend/order) or a non-active layer's pixels changed. */
  invalidate() { this.belowValid = this.aboveValid = false; }

  render(layers: GpuLayer[], active: number, stroke: LiveStroke | null, dirty: Rect | null): Target {
    if (active !== this.activeIndex) { this.activeIndex = active; this.invalidate(); }

    const above = layers.slice(active + 1).filter(l => l.visible && l.opacity > 0);
    const aboveCacheable = above.every(l => l.blendMode === 'normal'); // 'over' is associative

    if (!this.belowValid || (aboveCacheable && !this.aboveValid)) dirty = null; // full rebuild frame
    if (!this.belowValid) {
      this.clear(this.below, this.background);
      for (const l of layers.slice(0, active)) {
        if (l.visible && l.opacity > 0) this.blend(this.below, l.target, l.opacity, l.blendMode, null);
      }
      this.belowValid = true;
    }
    if (aboveCacheable && !this.aboveValid) {
      this.clear(this.above, [0, 0, 0, 0]);
      for (const l of above) this.blend(this.above, l.target, l.opacity, 'normal', null);
      this.aboveValid = true;
    }

    // Per-frame work, restricted to the dirty rect.
    this.copy(this.below, this.out, dirty);
    const a = layers[active];
    if (a?.visible) {
      const src = stroke ? this.mergeStroke(a.target, stroke, dirty) : a.target;
      this.blend(this.out, src, a.opacity, a.blendMode, dirty);
    }
    if (aboveCacheable) this.blend(this.out, this.above, 1, 'normal', dirty);
    else for (const l of above) this.blend(this.out, l.target, l.opacity, l.blendMode, dirty);

    this.gl.disable(this.gl.SCISSOR_TEST);
    return this.out;
  }

  /** Full flatten into `dst` (used by export and Flatten/Merge commands). */
  flattenInto(layers: GpuLayer[], dst: Target, withBackground: boolean) {
    this.clear(dst, withBackground ? this.background : [0, 0, 0, 0]);
    for (const l of layers) if (l.visible && l.opacity > 0) this.blend(dst, l.target, l.opacity, l.blendMode, null);
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  private blend(dst: Target, src: Target, opacity: number, mode: BlendMode, rect: Rect | null) {
    const gl = this.gl;
    if (mode === 'normal') {
      // Fixed-function premultiplied source-over == Canvas2D 'source-over'.
      this.bind(dst, rect);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.quad.draw(this.progs.copy, { u_src: src.tex, u_opacity: opacity });
      gl.disable(gl.BLEND);
      return;
    }
    // Programmable modes read the backdrop: snapshot only the affected rect, then overwrite it.
    this.copy(dst, this.scratch, rect);
    this.bind(dst, rect);
    this.quad.draw(this.progs.blend, {
      u_src: src.tex, u_dst: this.scratch.tex, u_opacity: opacity, u_mode: MODE_ID[mode],
    });
  }

  private mergeStroke(layer: Target, s: LiveStroke, rect: Rect | null): Target {
    const gl = this.gl;
    this.copy(layer, this.preview, rect);
    this.bind(this.preview, rect);
    gl.enable(gl.BLEND);
    if (s.erase) gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); // 'destination-out'
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);          // 'source-over'
    this.quad.draw(this.progs.copy, { u_src: s.target.tex, u_opacity: s.opacity }); // opacity = stroke cap
    gl.disable(gl.BLEND);
    return this.preview;
  }

  private copy(src: Target, dst: Target, rect: Rect | null) {
    const gl = this.gl;
    const r = rect ?? { x: 0, y: 0, w: src.w, h: src.h };
    gl.disable(gl.SCISSOR_TEST);                     // blits are clipped by the scissor test
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(r.x, r.y, r.x + r.w, r.y + r.h, r.x, r.y, r.x + r.w, r.y + r.h,
      gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }

  private bind(t: Target, rect: Rect | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    if (rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(rect.x, rect.y, rect.w, rect.h); }
    else gl.disable(gl.SCISSOR_TEST);
  }

  private clear(t: Target, rgba: [number, number, number, number]) {
    this.bind(t, null);
    this.gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
}
```

**Blend shader** (W3C Compositing Level 1 separable modes, on premultiplied inputs):

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_src, u_dst;
uniform float u_opacity;
uniform int u_mode;
in vec2 v_uv;
out vec4 o;

vec3 B(vec3 b, vec3 s) {
  switch (u_mode) {
    case 1: return b * s;                                                          // multiply
    case 2: return b + s - b * s;                                                  // screen
    case 3: return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); // overlay
    case 4: return min(b, s);                                                      // darken
    case 5: return max(b, s);                                                      // lighten
    case 6: return mix(min(vec3(1.0), b / max(1.0 - s, vec3(1e-5))), vec3(0.0), step(b, vec3(0.0))); // color-dodge
    case 7: return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, vec3(1e-5))), vec3(1.0), step(1.0, b)); // color-burn
    case 8: return min(b + s, vec3(1.0));                                          // add
    default: return s;
  }
}

void main() {
  vec4 s = texture(u_src, v_uv) * u_opacity;           // premultiplied
  vec4 d = texture(u_dst, v_uv);
  vec3 Cs = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 Cb = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
  vec3 co = s.rgb * (1.0 - d.a) + d.rgb * (1.0 - s.a) + s.a * d.a * B(Cb, Cs);
  o = vec4(co, s.a + d.a * (1.0 - s.a));
}
```

### 4.3 Flattening & export memory strategy  — [M]

- **Export flatten:** free the `below`, `above` and `preview` caches first, which releases three doc-sized textures. Reuse one as the flatten target and call `flattenInto()`. Read it back in **512-row strips** via PBO into a single `Uint8ClampedArray`, so there's exactly one CPU copy and no per-layer canvases. Transfer it zero-copy to the export worker. Rebuild the caches afterwards.
- **Flatten / Merge Down commands** reduce live GPU memory. Each is a single `merge` history entry that stores the merged layers' tiles, so the operation can be undone.
- **Merge Down keeps the picture unchanged.** The lower layer's opacity is baked into its pixels before the upper layer is blended in with its own opacity and mode. The merged layer then sits at 100% opacity and keeps the lower layer's blend mode.
- **Flatten discards hidden layers**, like Photoshop's flatten.
- **Hidden-layer eviction** (stretch goal): layers that stay hidden for a while can be dropped from the GPU and lazily re-uploaded from IndexedDB tiles.

### 4.4 Memory budget (enforce in the MVP)

Bytes per layer = `W × H × 4`. For 2732×2048 that's **22.4 MB**, and for 4096×4096 it's **64 MB**. The fixed overhead is
`below + above + out + preview + scratch + stroke(F16 = 2×)` ≈ **7 layer-equivalents**.

`maxLayers = floor((gpuBudget − 7 × layerBytes) / layerBytes)`. Starting budgets to tune empirically: about **700 MB on
iPad Pro (8 GB+)**, **400 MB on base iPads**, and **1 GB on Windows** (use `navigator.deviceMemory` where available).
Procreate also caps layer count by canvas size. Show the limit in the canvas-size picker.

At 2732×2048 on an iPad Pro, that gives about 24 layers. **Post-MVP:** a sparse GPU tile atlas that allocates only
non-empty 256² tiles typically gives 3–10× more layers.

---

## 5. UI/UX & clean design

### 5.1 Component hierarchy  — [L]

```
<App>
├─ <GalleryScreen>               project grid (IDB thumbnails), New Canvas (size presets + layer limit), Import
└─ <EditorScreen>
   ├─ <CanvasViewport/>          mounts <canvas>, creates Engine + PointerInput once; never re-renders
   │   └─ <BrushCursor/>         hover ring (pen hover / mouse)
   ├─ <TopBar>                   auto-hides on full-screen (4-finger tap)
   │   ├─ left:  <GalleryButton/> <ActionsMenu/> (Export, Canvas, Prefs)
   │   └─ right: <ToolButton brush/> <ToolButton eraser/> <LayersButton/> <ColorSwatch/>
   ├─ <SideBar side={leftHanded ? 'right' : 'left'}>
   │   ├─ <VerticalSlider value="size"/>  <ModifyButton/> (eyedropper)  <VerticalSlider value="opacity"/>
   │   └─ <UndoButton/> <RedoButton/>
   ├─ <Panel anchor>             popover (landscape) / bottom sheet (portrait)
   │   ├─ <BrushLibrary/> → <BrushSettings/> (size, opacity, flow, spacing, StreamLine, <PressureCurveEditor/>)
   │   ├─ <LayersPanel/> → <LayerRow/> (thumb, name, eye, N-blend chip → <LayerProps/> opacity+blend), drag-reorder
   │   └─ <ColorPanel/> (HSB disc + square, hex, history, palette)
   ├─ <Toast/>                   "Undo", "Zoom 140%", "Saved"
   └─ <InstallCoach/>            iOS Add-to-Home-Screen hint
```

**Gestures** are recognized from the same pointer stream by `GestureRecognizer`:
- 2-finger pinch, rotate and pan.
- A **quick pinch-in** fits the canvas to the screen.
- 2-finger tap undoes and 3-finger tap redoes. A tap means release within 250 ms and less than 10 px of movement.
- A 4-finger tap toggles full-screen UI.
- Touch-and-hold opens the eyedropper.

Keyboard shortcuts cover Windows and iPads with keyboards: `Ctrl/⌘+Z`, `Shift+Ctrl/⌘+Z`, `B`/`E`, `[`/`]` for size, and `Space`+drag to pan.

Size and opacity sliders write to `toolStore` at most once per rAF. The engine reads the value at the next stroke begin.

**As built (Phase 5):**
- The app opens straight into the editor on a screen-size canvas. The gallery overlays it, with "Current canvas" and **New canvas** (five size presets plus a custom size, each showing its layer limit). Saved artworks join the gallery in Phase 6.
- **Tool state is persisted per device** in a Zustand store backed by `localStorage`:
  - the current tool, and a separate brush for painting and for erasing (as in Procreate)
  - size, opacity and StreamLine per tool and brush
  - Brush Settings edits, stored as overrides on the presets
  - colour, recent colours and preferences
- **Eyedropper:** the sidebar button arms a one-shot pick; the pen barrel button and touch-and-hold (450 ms, in pen mode) pick directly. A loupe ring floats above the pick point.
- **Space+drag and middle-mouse drag pan**, via capture-phase listeners on the canvas.
- **Layer thumbnails** are rendered by repeated 2× linear blits (so they don't alias) when drawing pauses.
- **Brush previews** run the real dab pipeline on a sample stroke with a pressure swell.
- **Fit to screen** keeps the canvas clear of the top bar and sidebar.
- **No Radix:** the few primitives needed (panel/sheet, vertical slider, curve editor) are hand-rolled with `role`/`aria-*` and keyboard support, which keeps full control of touch behaviour.

### 5.2 Design system & responsiveness  — [M]

- **Tokens** as CSS custom properties: `--space-1..6`, `--radius`, `--panel-bg`, and `--hit: 44px`, the minimum target for Apple HIG and Fluent touch. The default theme is a **neutral dark gray UI**, so it doesn't bias color perception. Use CSS Modules, and **Radix UI primitives** (Popover, Slider, Dialog) for accessible, unstyled behavior.
- **Layout by aspect ratio and container, not by device:**
  - **Landscape** (iPad, Surface landscape): top bar plus left sidebar, with panels as anchored popovers (max 360px wide).
  - **Portrait / narrow** (`@container editor (max-width: 820px)` or `orientation: portrait`): panels become **bottom sheets** (max 60vh) with drag-to-dismiss. Sidebar sliders shorten with `clamp()`, and the top bar groups into two clusters.
  - Handle Stage Manager, Split View and Windows snap layouts with the same container queries. Resize recomputes the view, not the document.
- `@media (hover: hover) and (pointer: fine)` adds hover states and denser spacing for mouse users. `prefers-reduced-motion` disables panel animations. Pad every edge with `env(safe-area-inset-*)`.
- Keep the canvas maximized: no permanent docks, translucent solid panels (no blur), and full-screen mode.

---

## 6. Export & persistence

### 6.1 Export pipeline  — [L]

| Format | Pipeline |
|---|---|
| **PNG** | `flattenInto(withBackground = bg.visible)` → strip readback → **un-premultiply** + flip Y → `ImageData` → `OffscreenCanvas.convertToBlob({ type: 'image/png' })` in the export worker. Fall back to main-thread `canvas.toBlob`. |
| **JPEG** | Same flow, but force the background (no alpha). Quality slider defaults to 0.92. |
| **PSD** | `ag-psd` in the worker. Read layers back **one at a time, cropped to `layer.bounds`**, which saves a lot of memory. Map name, opacity, hidden, blend mode (`multiply`→`mul `, `screen`→`scrn`, `overlay`→`over`, `color-dodge`→`div `, `color-burn`→`idiv`, `add`→`lddg`, …) and include the flattened composite. |
| **.drawthing** | `fflate` zip: `document.json` + `tiles/<layerId>/<tx>_<ty>.bin` (deflated premultiplied RGBA8) + `thumb.webp`. This is the lossless round-trip and backup format. |

Delivery: on Windows/Chromium use `browser-fs-access`, which calls `showSaveFilePicker`. On iPad use `navigator.share({ files })`,
which opens the share sheet with Save to Photos and Files, with a download as fallback. Import goes through the same file
handlers: PNG/JPEG become a new layer, and `.drawthing` and PSD via `ag-psd` become a new project.

### 6.2 Local persistence (IndexedDB)  — [L]

```
DB "drawthing" v1
  projects   key: id            → { id, name, w, h, updatedAt, thumb: Blob, doc: DocumentJSON }
  tiles      key: [projectId, layerId, tileKey] → Blob (deflated RGBA8)   index: by [projectId, layerId]
  brushes    key: id            → BrushPreset (user presets)
  meta       key: string        → { lastOpenProject, prefs, cleanShutdown }
```

- **Autosave after every stroke commit**, debounced to about 500 ms. The payload is the history entry's *after* tiles, which needs no extra GPU readback. They go to `persistence.worker.ts` (via `comlink`), which compresses and writes them in **one transaction**, plus the doc JSON. Thumbnails regenerate at most every 10 s, from a GPU-downsampled 512px composite.
- Flush immediately on `visibilitychange → hidden` and `pagehide`, because iOS may kill a backgrounded PWA without warning.
- **Crash recovery:** set `meta.cleanShutdown = false` on open. On next launch, reopen the last project from IDB, which is always at most one stroke behind.
- On WebGL context loss, rebuild every layer texture from the `tiles` store.

### 6.3 Cloud sync (optional, P9)  — [L]

- Name tiles by content: `sha256(tile)` → the blob key in S3/R2 (presigned PUT). Unchanged tiles never re-upload.
- The project manifest is the doc JSON plus a tile hash map and `rev`. Sync on app open, `online`, and after idle, because Background Sync isn't available in Safari.
- Conflicts: last-writer-wins per project, and on divergence **keep both** (a duplicated project named "(conflict)"). That's simple and safe for an MVP.
- Backend options: Supabase (auth + storage) or Cloudflare R2 + Workers. A self-hosted backend runs as another service in `compose.yaml`, reverse-proxied by Caddy, so the same-system, LAN and cloud modes keep working (§10).

---

## 7. Performance & testing strategy

### 7.1 Benchmarks (with targets)  — [M]

| Metric | How to measure | Target |
|---|---|---|
| Input-to-photon latency | 240 fps slow-mo phone camera, counting frames from pen tip to ink. Built-in latency HUD (`event.timeStamp` → rAF → `performance.now()` after submit). | iPad ≤ 30 ms, Surface ≤ 40 ms |
| Frame time while scribbling, 20 layers @ 2732×2048, 400px soft brush, 5% spacing | `performance.measure` per frame, plus PerformanceObserver `longtask` | p95 < 8 ms (120 Hz) / < 16 ms (60 Hz); 0 long tasks |
| Dab throughput | Synthetic stroke replay | ≥ 50k dabs/s |
| Stroke commit (merge + PBO capture) | Marks around commit | p95 < 4 ms main-thread |
| Undo / redo | Marks | < 50 ms for a full-canvas stroke |
| GPU memory, 20 / 30 / max layers @ 2732×2048 and 4096² | Formula vs. Safari Web Inspector Graphics/Memory, Chrome `about:gpu`/Task Manager | Within budget §4.4, no context loss |
| History memory under long sessions | Engine byte counter | Never exceeds budget |
| 30-min soak (continuous drawing + undo + layer churn) | Memory timeline | Flat; no leaked textures (track a `gl.create*` count) |
| Autosave | Worker timing | < 150 ms, zero dropped frames |
| Export 4K PNG / PSD, 20 layers | Timing + peak memory | PNG < 3 s; PSD < 10 s; no OOM on 4 GB iPad |
| Cold start (cached SW) to drawable | `performance.now()` at first frame | < 1.5 s; app JS < 250 KB gz |

**Tooling**
- **Vitest** for StrokePath spacing, the stabilizer, curve LUTs, the history byte budget, tile math and serialization.
- **Playwright** to replay deterministic strokes. Chromium CDP `Input.dispatchMouseEvent`/`dispatchTouchEvent` support `pointerType: 'pen'`, `force` and `tiltX/Y`. Pixel-snapshot each result with **pixelmatch**. Tests run in the official Playwright container (`./scripts/e2e`), which bundles the browsers and their system libraries, so CI and every machine behave the same.
- An in-app **stroke recorder** that saves real Pencil and Surface Pen sessions as JSON for regression replays in CI.
- **Spector.js** for GL debugging and a debug HUD for FPS, latency, GPU MB and history MB.
- **No Mac?** Safari Web Inspector needs one. Otherwise use the in-app HUD plus a remote log sink (or **eruda**) on the iPad.

### 7.2 Cross-device test checklist

**Devices:** iPad Pro (M-series) with Pencil 2 or Pencil Pro, a base iPad with Pencil USB-C or 1st gen (which may lack pressure or tilt), Surface Pro with Surface Pen, a non-Microsoft MPP 2.0 or Wacom AES pen, plus a mouse and trackpad baseline.
**Browsers and modes:** Safari tab, iPad home-screen PWA, Edge (tab and installed), and Chrome (tab and installed).

Input
- [ ] Pressure ramps smoothly from feather-light to full. The first sample after pen-down has no 0-pressure dot (Windows Ink). The stroke end doesn't get a thin tail.
- [ ] Tilt shading works: Pencil `altitudeAngle` and Surface `tiltX/Y` give equivalent results.
- [ ] Fast scribbles stay smooth with no polygon corners (coalesced events active, as shown in the HUD).
- [ ] Palm resting while drawing causes no marks, zoom or pan. A finger can't draw after the pen has been used.
- [ ] Finger painting works before any pen is seen. A second finger cancels the stroke and starts a pinch.
- [ ] Surface Pen eraser end erases, the barrel button triggers the eyedropper, and hover shows the brush cursor (also on M2+ iPad Pro).
- [ ] No page scroll, rubber-band, pull-to-refresh, double-tap zoom, text-selection loupe, callout, Windows press-and-hold context menu or pen flicks.
- [ ] Two-, three- and four-finger taps and pinch-to-fit are reliable and never leave a stray mark.
- [ ] A system gesture mid-stroke (Control Center swipe, Alt-Tab) commits the stroke cleanly.

Rendering and performance
- [ ] Every benchmark in §7.1 meets its target on each device. Check rAF rate on iPad (60 vs 120 Hz) and in Low Power Mode.
- [ ] All 9 blend modes match a reference PSD exported and opened in Photoshop or Krita, within 1/255.
- [ ] Context-loss recovery works: force it with `WEBGL_lose_context` and confirm all layers are restored.
- [ ] Rotation, Split View, Stage Manager and Windows snap resize keep the view and document intact.

PWA and persistence
- [ ] Installs from Safari Add to Home Screen (icon, splash, status bar, safe areas) and from the Edge/Chrome install prompt (`window-controls-overlay`).
- [ ] Airplane mode: cold launch, draw, save, export and reopen all work.
- [ ] Updates: deploying a new SW shows a prompt and never reloads mid-stroke.
- [ ] Killing the app mid-session (swipe away, Task Manager) loses at most the last stroke after relaunch.
- [ ] `storage.persist()` is granted on install, and quota is reported.
- [ ] LAN deployment: each tablet trusts the local CA from `http://<LAN IP>:8081/ca.crt`, then installs from `https://<LAN IP>` and works offline.
- [ ] Cloud deployment: the certificate is issued and renewed automatically, and an update deploy shows the update prompt on installed clients.
- [ ] Export PNG, JPEG and PSD round-trip into Photos, Files, Explorer, Photoshop and Krita. `.drawthing` re-imports losslessly.

---

## 8. Phase-by-phase build roadmap

**P0 Foundations [M, 1 wk]**
- Vite, React, TypeScript (strict), ESLint and Prettier. Set up Vitest and Playwright. [S]
- `vite-plugin-pwa` skeleton, icons and manifest. [S]
- Docker: multi-stage Dockerfile (dev, build, runtime, e2e) and compose services. npm runs only in containers. Caddy runtime with same-system, LAN and cloud modes (§10). [M]
- Debug HUD and remote logging for iPad. [S]
- *Exit:* the installable blank PWA loads offline on iPad and Surface.

**P1 Engine core & input [L, 2 wk]**
- WebGL2 context with the low-latency attributes, a `Target` helper and a quad renderer. [M]
- Viewport transforms: pan, zoom, rotate, and screen↔document mapping. [M]
- `PointerInput` (snippet above), the gesture recognizer, a rAF loop and a latency HUD. [L]
- A simple hard round brush drawn straight into a single layer. [S]
- *Exit:* low-latency pressure lines on both platforms, with no browser gestures interfering.

**P2 Brush engine [XL, 2–3 wk]**
- `StrokePath` (snippet), stabilizer, pressure EMA and curve LUTs. [M]
- Instanced `DabRenderer`, tip shader (hardness, roundness, angle) and an F16 stroke buffer. [L]
- Grain (moving and texturized), tilt mapping, jitter, max accumulation and erase mode. [M]
- Five presets and a Brush Settings data model. [S]
- *Exit:* the Ink, Pencil, Airbrush, Marker and Eraser presets feel right with a Pencil and a Surface Pen.

**P3 Layers & compositor [L, 2 wk]**
- `documentStore` layer JSON and the `LayerStore` of GPU layers. [M]
- `Compositor` (snippet), the blend shader and below/above caching. [L]
- Alpha lock, Merge Down, Flatten and the layer budget. [M]
- *Exit:* 20 layers at full resolution hit the frame-time target.

**P4 History [L, 1–1.5 wk]**
- Async PBO tile capture and pixel entries. [L]
- Metadata, structural and merge entries. [M]
- Byte budget and idle compression. [S]
- *Exit:* 100 undo/redo cycles are pixel-identical (snapshot test).

**P5 UI shell [L, 2 wk; parallel with P2–P4]**
- Gallery, top bar and sidebar. [M]
- Panels: brush library and settings, layers with drag-reorder, color. [L]
- Responsive popover-to-sheet switching, left-handed mode and keyboard shortcuts. [M]

**P6 Persistence & export [L, 2 wk]**
- IndexedDB schema, the persistence worker, autosave and crash recovery. [L]
- PNG and JPEG export through the worker. [M]
- PSD export via `ag-psd`, plus the `.drawthing` format. [M]
- Share and save-picker integration, and import. [S]

**P7 PWA hardening [M, 1 wk]**
- iOS install coach, splash screens and persistent storage. [S]
- Update-prompt flow, file handlers, window-controls-overlay and an optional PWABuilder Store package. [M]
- Context-loss recovery. [M]

**P8 Performance & QA [M–L, 1–2 wk + continuous]**
- Run the §7.1 benchmark suite and the §7.2 checklist on real devices. [M]
- Stroke-replay visual regression in CI. [M]

**P9 (optional) Cloud sync [L, 2 wk]**
- Content-addressed tiles, auth and a conflict policy (§6.3).

---

## 9. Recommended libraries

| Library | Purpose |
|---|---|
| `react`, `react-dom` (19), `typescript`, `vite` | UI shell & build |
| `vite-plugin-pwa` (Workbox) | Service worker, manifest, update prompt |
| `@vite-pwa/assets-generator` or `pwa-asset-generator` | Icons + iOS splash screens |
| `zustand` (+ `subscribeWithSelector`) | Document/tool/UI stores |
| `twgl.js` | Minimal WebGL2 helpers (programs, buffers, FBOs) |
| `idb` | Promise wrapper for IndexedDB |
| `comlink` | Ergonomic RPC to persistence/export workers |
| `fflate` | Fast deflate/zip for tiles and `.drawthing` |
| `ag-psd` | PSD read/write with layers & blend modes |
| `browser-fs-access` | File System Access API with iOS/legacy fallbacks |
| `@radix-ui/react-popover`, `-slider`, `-dialog` | Accessible headless UI primitives |
| `culori` | Color conversions for HSB/OKLCH picker |
| `vitest`, `@playwright/test`, `pixelmatch` | Unit, E2E with synthesized pen input, visual diffs |
| Docker Engine + Compose v2 | All tooling and deployment; the host needs nothing else |
| Caddy 2 (`caddy:2.11-alpine`) | Static PWA server with automatic HTTPS (internal CA or Let's Encrypt) |
| `mcr.microsoft.com/playwright` image | E2E browsers and their system libraries, version-locked to `@playwright/test` |
| `spector.js` (dev), `eruda` (dev, on-device console) | GL frame capture, iPad debugging without a Mac |
| *Fallback:* `pixi.js` v8 | Only if the team won't own a raw WebGL2 layer |

---

## 10. Containerized development & deployment

Everything runs in Docker. The host needs Docker Engine and Compose v2, nothing else: no Node.js and
no npm. The README has the step-by-step commands.

| `Dockerfile` target | Base image | Role |
|---|---|---|
| `dev` | `node:22-bookworm-slim` | Vite dev server with the source bind-mounted and `node_modules` in a named volume. Also runs any npm command through `./scripts/dnpm`. |
| `build` | `dev` dependencies | `npm run build`: type-check, Vite, generated icons and splash screens, service worker. |
| `runtime` | `caddy:2.11-alpine` | Serves `dist/` and handles HTTPS for each mode. The only image that gets deployed. |
| `e2e` | `mcr.microsoft.com/playwright` (same version as `@playwright/test`) | End-to-end tests via `./scripts/e2e`. |

Containers run as uid 1000, so anything they write into the bind-mounted tree (the lockfile,
`dist/`, test reports) belongs to the normal host user.

### Deployment modes

One `runtime` image covers every mode. An env file in `deploy/env/` picks the mode.

| Mode | Env file | Address | TLS | Notes |
|---|---|---|---|---|
| Same system | `local.env` | `http://localhost:8080` | None needed: `localhost` is a secure context | Listens on 127.0.0.1 only |
| LAN | `lan.env` (from `.example`) | `https://<LAN IP>` | Caddy internal CA. Each device trusts it once via `http://<LAN IP>:8081/ca.crt` | `default_sni` serves the certificate to clients that connect by bare IP (they send no SNI). Docker inside WSL2 needs mirrored networking or a port proxy. |
| Cloud VM | `cloud.env` (from `.example`) | `https://<domain>` | Let's Encrypt, issued and renewed automatically | Ports 80 and 443 open |
| Managed platform | none (platform settings) | Platform URL | Terminated by the platform | Deploy `runtime` with `SITE_ADDRESS=:8080` or the platform's port |

### Serving rules (`deploy/Caddyfile`)

- `sw.js`, `manifest.webmanifest` and `index.html` get `Cache-Control: no-cache`, so installed apps notice updates. Hashed `/assets/*` files are cached as immutable.
- Unknown paths fall back to `index.html`. Responses carry `nosniff`, referrer-policy and permissions-policy headers.
- There's no backend and no `/__log` endpoint. Drawings live in each device's IndexedDB, and remote logging is a dev-server feature (the client switches itself off on 404/405).

### Adding backends later

Cloud sync (§6.3) or any other service is added as another service in `compose.yaml` and
reverse-proxied by Caddy (for example `/api/*`). The same-system, LAN and cloud modes then work unchanged.
