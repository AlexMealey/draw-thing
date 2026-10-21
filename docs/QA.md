# Performance & device QA

How to run the ROADMAP §7.1 benchmarks and the §7.2 device checklist, and what CI already covers.
Results from real devices go in [the log at the end](#results-log).

## What CI covers (`./scripts/e2e`)

Headless Chromium in the Playwright container uses a software GPU (SwiftShader). It can prove
correctness, not tablet speed.

| Spec                    | Checks                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/replay.spec.ts`    | **Stroke-replay visual regression.** Synthetic scenes covering every brush feature (pressure, tilt, grain, flow, max accumulation, jitter, both erasers, StreamLine, cancelled strokes, all 9 blend modes), plus every recording in `e2e/recordings/`. Each is compared with its reference image in `e2e/snapshots/` (Playwright's comparator, pixelmatch). |
| `e2e/input.spec.ts`     | Real pen and touch input through Chromium's input pipeline (CDP): pressure sets the width, no 0-pressure first dot, tilt widens the pencil, a resting palm leaves no mark and moves nothing, fingers paint only until a pen is used, a second finger turns a stroke into a pinch without a mark, and a recorded session replays pixel-identically. |
| `e2e/perf.spec.ts`      | The benchmark suite (quick settings). Every benchmark must run; GL objects must not leak, the context must survive, GPU and history memory must stay within budget. Timings are reported (`test-results/…/benchmarks.json`), and only enforced with `BENCH_STRICT=1`. |
| `e2e/history.spec.ts` … | Earlier phases: undo/redo exactness, saving and crash recovery, export/import, PWA, GPU reset.                                                                                                                                                         |

Plus `./scripts/dnpm run size`: the JavaScript needed at startup must stay under 250 KB gzipped
(currently about 120 KB).

After an intended rendering change, look at the diffs in `playwright-report/`, then refresh the
reference images and commit them:

```bash
./scripts/e2e replay --update-snapshots
```

## Running the benchmarks on a device

1. Open the deployed app with `?lab` (for example `https://<LAN IP>/?lab`), or turn on `?debug` and
   use Actions → Diagnostics → *Open the lab*. The lab draws on a scratch canvas and never touches
   your artwork. Autosave is timed on a temporary project, which is deleted afterwards.
2. Press **Run benchmarks**. This uses §7.1's settings: 2732 × 2048, 20 layers, a 400 px soft
   brush at 5% spacing, about 40 s in all. Use `?lab&w=4096&h=4096` for the largest canvas.
   *Quick run* is a 10-second sanity check.
3. Press **Save report** and add the numbers to the [results log](#results-log). Reload before
   running again, because the document keeps its layers.
4. **Soak (30 min):** continuous drawing, undo and layer churn. Keep the screen awake. GL objects
   must stay constant at every checkpoint, and history must stay within budget. Watch memory in
   Safari Web Inspector (Mac) or Edge's Task Manager while it runs.

| Benchmark                  | What the lab measures                                                         | Target                     |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| Page start → first frame   | `performance.now()` at the engine's first frame                               | < 1.5 s cached             |
| Frame CPU p95              | CPU time of each frame while scribbling                                       | < 8 ms at 120 Hz, < 16 at 60 |
| Frame interval p95         | rAF intervals while scribbling (includes GPU time, so it shows dropped frames) | ≤ one refresh             |
| Long tasks                 | `PerformanceObserver('longtask')` (Chromium only)                             | 0                          |
| Stroke commit p95          | Merge into the layer + start of the tile capture                              | < 4 ms                     |
| Dab throughput             | One batch of ~150k 20 px dabs, GPU-synchronised                               | ≥ 50k dabs/s               |
| Undo / redo                | Full-canvas airbrush stroke, worst of 5 each, GPU-synchronised                | < 50 ms                    |
| Autosave                   | Change → written to IndexedDB (and its main-thread part)                      | < 150 ms, fits in a frame  |
| Export PNG / PSD           | Full size / all layers                                                        | < 3 s / < 10 s             |
| GPU memory, history memory | Engine estimates vs. the §4.4 budgets                                         | within budget              |
| GL objects                 | Live textures/buffers/… before and after layer churn                          | 0 leaked                   |

**Input-to-photon latency** needs a camera. Film the pen tip in 240 fps slow motion while drawing
fast, then count the frames between the tip moving and ink appearing (1 frame ≈ 4.2 ms). Targets:
iPad ≤ 30 ms, Surface ≤ 40 ms. The HUD's *latency* (`?debug`) is the software part only.

## Recording real pen sessions for CI

1. Open the app with `?debug`, then Actions → Diagnostics → **Record strokes** (also in the lab).
2. Draw whatever needs protecting, such as a pressure-heavy sketch, fast hatching or a palm
   resting on the screen. Strokes are recorded as the engine received them (after palm
   rejection), with pressure, tilt and timing.
3. **Stop and save.** This writes `strokes-<date>.json`.
4. Copy it to `e2e/recordings/<name>.json`, then create its reference image:

   ```bash
   ./scripts/e2e replay --update-snapshots=missing
   ```

5. Check `e2e/snapshots/replay.spec.ts/recording-<name>.png`, then commit both files.

A recording replays at its own canvas size. *Replay recording…* plays one back on the current
canvas at the original pace, which is handy for comparing devices or brush changes by eye.

## Device checklist (ROADMAP §7.2)

Run it on each device and browser below. "CI" marks items the e2e suite already covers in
Chromium; they still need a look on the real hardware, because WebKit and the digitizers differ.

**Devices:** iPad Pro (M-series) + Pencil 2/Pro · base iPad + Pencil USB-C/1st gen · Surface Pro +
Surface Pen · a non-Microsoft MPP 2.0 or Wacom AES pen · mouse and trackpad.
**Browsers and modes:** Safari tab · iPad Home Screen app · Edge tab and installed · Chrome tab and
installed.

### Input

- [ ] Pressure ramps smoothly from feather-light to full. No 0-pressure dot at the start (Windows
      Ink), no thin tail at the end. *CI: width and first-sample checks.* HUD: watch `p=`.
- [ ] Tilt shading: Pencil `altitudeAngle` and Surface `tiltX/Y` give the same result (Pencil
      brush, pen held flat). *CI: tilt widens the pencil.*
- [ ] Fast scribbles stay smooth, with no polygon corners. The HUD's samples/s should be ≈ 240 on
      Pencil (coalesced events).
- [ ] A resting palm makes no marks, zoom or pan, and fingers can't draw once the pen has been
      used. *CI.*
- [ ] Finger painting works before any pen is seen, and a second finger cancels the stroke and
      pinches. *CI.*
- [ ] Surface Pen eraser end erases, the barrel button picks a color, and hover shows the brush
      ring (also M2+ iPad Pro with Pencil hover).
- [ ] No page scroll, rubber-band, pull-to-refresh, double-tap zoom, text-selection loupe,
      callout, Windows press-and-hold menu or pen flicks.
- [ ] Two-, three- and four-finger taps and quick pinch-to-fit are reliable and never leave a
      stray mark.
- [ ] A system gesture mid-stroke (Control Center swipe, Alt-Tab) commits the stroke cleanly.

### Rendering and performance

- [ ] Lab benchmarks meet every target. Check the rAF rate on iPad (60 vs 120 Hz; the report
      shows `refreshHz`), and again in Low Power Mode.
- [ ] Blend modes match a reference: export a PSD of a blend-mode test (the `blend-modes` scene
      is a good template), open it in Photoshop or Krita and compare within 1/255.
- [ ] Context-loss recovery: in the console, run
      `document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`.
      Every layer and undo step must come back. *CI.*
- [ ] Rotation, Split View, Stage Manager and Windows snap resizing keep the view and document
      intact.
- [ ] 30-minute soak in the lab: GL objects flat, history within budget, no reload.

### PWA and persistence

- [ ] Installs from Safari's Add to Home Screen (icon, splash, status bar, safe areas) and from
      the Edge/Chrome install prompt (window-controls-overlay title bar).
- [ ] Airplane mode: cold launch, draw, save, export and reopen all work.
- [ ] Updates: deploying a new version shows the prompt, and the app never reloads mid-stroke.
- [ ] Killing the app mid-session (swipe away, Task Manager) loses at most the last stroke.
- [ ] `storage.persist()` is granted on install, and Actions → App reports quota.
- [ ] LAN: each tablet trusts the local CA from `http://<LAN IP>:8081/ca.crt`, installs from
      `https://<LAN IP>` and works offline.
- [ ] Cloud: the certificate is issued and renewed automatically, and an update deploy shows the
      prompt on installed clients.
- [ ] PNG, JPEG and PSD exports open in Photos, Files, Explorer, Photoshop and Krita;
      `.drawthing` re-imports losslessly.

## Results log

Add a row per device, browser and build. Paste the lab's saved report next to it if you like.

| Date | Build | Device | Browser / mode | Hz | Frame CPU p95 | Interval p95 | Commit p95 | Dabs/s | Undo | Autosave | PNG / PSD | Latency (camera) | Checklist | Notes |
| ---- | ----- | ------ | -------------- | -- | ------------- | ------------ | ---------- | ------ | ---- | -------- | --------- | ---------------- | --------- | ----- |
|      |       |        |                |    |               |              |            |        |      |          |           |                  |           |       |

For reference, the CI container (SwiftShader, quick settings, 1024 × 768) measured: frame CPU p95
0.3 ms, commit p95 0.5 ms, ~100k dabs/s, undo 5 ms, autosave 80 ms, PNG 31 ms, PSD 124 ms, no
leaked GL objects. At full §7.1 settings, the same software GPU drops frames with a 400 px brush
(interval p95 33 ms), as expected from a CPU rasterizer.
