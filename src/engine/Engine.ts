import { parseHexColor } from './brush/color';
import { DabGenerator } from './brush/DabGenerator';
import { DEFAULT_PRESET_ID, presetById, type BrushPreset } from './brush/presets';
import { Stabilizer } from './brush/Stabilizer';
import { type Pt, StrokePath } from './brush/StrokePath';
import type { ToolSettings } from './brush/tool';
import { createGL, isDesynchronized } from './gl/context';
import { createTarget, deleteTarget, type Rect, strokeFormat, type Target } from './gl/target';
import { GestureRecognizer } from './input/GestureRecognizer';
import { type InputSample, PointerInput, type StrokeSink } from './input/PointerInput';
import { type Affine, identity, multiply, toMat3 } from './math/affine';
import { clampRect, DabBatch, unionRect } from './render/DabBatch';
import { DabRenderer } from './render/DabRenderer';
import { Presenter, targetClip } from './render/Presenter';
import { ema, engineStats } from './stats';
import { ViewTransform } from './view/ViewTransform';

export interface EngineOptions {
  /** Multi-finger tap: 2 = undo, 3 = redo, 4 = toggle UI. */
  onTap?: (fingers: number) => void;
  onContextLost?: () => void;
}

const MAX_DOC_SIZE = 4096;
const PAPER = [1, 1, 1] as const;
const SURROUND = [0.173, 0.173, 0.18, 1] as const;
const CURSOR_RING = [0.38, 0.38, 0.38, 0.85] as const; // premultiplied mid-gray: visible on light and dark
const KEY_ZOOM = 1.25;

/** One in-progress stroke: its own copy of the tool settings and pipeline state. */
interface Stroke {
  preset: BrushPreset;
  stabilizer: Stabilizer;
  path: StrokePath;
  dabs: DabGenerator;
  /** Premultiplied; white for erase strokes, which only use coverage. */
  color: [number, number, number, number];
  opacity: number;
  erase: boolean;
  /** Prediction contradicts smoothing, so it's only used with StreamLine off. */
  predict: boolean;
  bounds: Rect | null;
}

/**
 * The drawing engine: owns the WebGL2 context, document textures, view transform and input,
 * and renders on demand in a requestAnimationFrame loop. No React in here.
 *
 * Document model so far: one raster layer plus a stroke buffer. A stroke deposits dabs into the
 * stroke buffer (flow builds up there), the present pass previews it at the stroke's opacity, and
 * on pen-up it is merged into the layer at that opacity. A finger stroke that turns into a pinch
 * is discarded cleanly.
 *
 * Stroke pipeline per sample: Stabilizer (StreamLine + pressure smoothing) → StrokePath
 * (midpoint quadratic, arc-length spacing) → DabGenerator (pressure curves, tilt, jitter) →
 * DabRenderer (tip shape + grain, one instanced draw per frame).
 */
export class Engine implements StrokeSink {
  readonly docW: number;
  readonly docH: number;

  private gl: WebGL2RenderingContext;
  private layer: Target;
  private strokeBuf: Target;
  private dabs: DabRenderer;
  private presenter: Presenter;
  private view = new ViewTransform();
  private input: PointerInput;
  private ro: ResizeObserver;
  private ac = new AbortController();

  private viewW: number;
  private viewH: number;
  private fboClip: Float32Array;
  private screenClip = new Float32Array(9);
  private gestureBase: Affine = identity();

  private tool: ToolSettings = {
    preset: presetById(DEFAULT_PRESET_ID),
    size: 8,
    opacity: 1,
    smoothing: 0,
    color: '#1c1c1e',
    eraser: false,
  };

  private stroke: Stroke | null = null;
  private strokeSeed = 1;
  private pending: 'commit' | 'cancel' | null = null;
  private queue: InputSample[] = [];
  private predicted: InputSample[] = [];
  private hoverSample: InputSample | null = null;

  private batch = new DabBatch();
  private overlay = new DabBatch();
  private raf = 0;
  private disposed = false;
  private lost = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: EngineOptions = {},
  ) {
    const gl = (this.gl = createGL(canvas));
    const rect = canvas.getBoundingClientRect();
    this.viewW = rect.width || innerWidth;
    this.viewH = rect.height || innerHeight;

    // Phase 1: a "screen size" canvas, like Procreate's default.
    const dpr = devicePixelRatio || 1;
    const cap = Math.min(MAX_DOC_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    this.docW = Math.min(cap, Math.round(this.viewW * dpr));
    this.docH = Math.min(cap, Math.round(this.viewH * dpr));
    this.layer = createTarget(gl, this.docW, this.docH);
    this.strokeBuf = createTarget(gl, this.docW, this.docH, strokeFormat(gl));
    this.fboClip = targetClip(this.layer);
    this.dabs = new DabRenderer(gl);
    this.presenter = new Presenter(gl);

    canvas.width = Math.round(this.viewW * dpr);
    canvas.height = Math.round(this.viewH * dpr);
    this.view.fit(this.docW, this.docH, this.viewW, this.viewH);

    const gestures = new GestureRecognizer({
      transformStart: () => {
        this.gestureBase = this.view.docToView;
      },
      transform: (delta, pivot) => {
        this.view.set(multiply(delta, this.gestureBase), pivot.x, pivot.y);
        this.requestFrame();
      },
      transformEnd: (pivot) => {
        this.view.snapRotation(pivot.x, pivot.y);
        this.requestFrame();
      },
      tap: (fingers) => this.opts.onTap?.(fingers),
      quickPinch: () => this.fitToScreen(),
    });
    this.input = new PointerInput(canvas, this, gestures, (x, y) => this.view.viewToDoc(x, y));

    this.ro = new ResizeObserver(this.onResize);
    try {
      this.ro.observe(canvas, { box: 'device-pixel-content-box' }); // exact pixels (Chromium)
    } catch {
      this.ro.observe(canvas); // Safari
    }
    const signal = this.ac.signal;
    window.addEventListener('wheel', this.onWheel, { passive: false, signal });
    window.addEventListener('keydown', this.onKey, { signal });
    canvas.addEventListener('webglcontextlost', this.onContextLost, { signal });

    engineStats.running = true;
    engineStats.docSize = `${this.docW}×${this.docH}`;
    engineStats.desynchronized = isDesynchronized(gl);
    engineStats.strokeFormat = this.strokeBuf.format;
    this.requestFrame();
  }

  // ── Public API (called from React) ──────────────────────────────────────────

  /** Takes effect from the next stroke. */
  setTool(tool: ToolSettings) {
    this.tool = tool;
    this.requestFrame(); // cursor ring size
  }

  fitToScreen() {
    this.view.fit(this.docW, this.docH, this.viewW, this.viewH);
    this.requestFrame();
  }

  clear() {
    this.presenter.clear(this.layer, null);
    this.requestFrame();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.ro.disconnect();
    this.ac.abort();
    engineStats.running = false;
    if (this.lost) return;
    // No loseContext(): under StrictMode a new Engine reuses this canvas's context.
    this.dabs.dispose();
    this.presenter.dispose();
    deleteTarget(this.gl, this.layer);
    deleteTarget(this.gl, this.strokeBuf);
  }

  // ── StrokeSink (called by PointerInput) ─────────────────────────────────────

  begin(s: InputSample, opts: { pointerType: string; eraser: boolean }) {
    if (this.pending) this.renderNow(); // pen lifted and touched down within one frame
    const { preset, size, opacity, smoothing, color, eraser } = this.tool;
    const erase = eraser || opts.eraser;
    const [r, g, b] = parseHexColor(color);
    const dabs = new DabGenerator(preset, size, this.strokeSeed++);
    this.stroke = {
      preset,
      stabilizer: new Stabilizer(smoothing),
      path: new StrokePath(dabs.spacingAt),
      dabs,
      color: erase ? [1, 1, 1, 1] : [r, g, b, 1],
      opacity: Math.min(1, Math.max(0, opacity)),
      erase,
      predict: smoothing === 0,
      bounds: null,
    };
    this.hoverSample = null;
    this.queue.push(s);
    this.requestFrame();
  }

  extend(samples: InputSample[]) {
    if (!this.stroke || this.pending) return;
    for (const s of samples) this.queue.push(s);
    this.requestFrame();
  }

  predict(samples: InputSample[]) {
    this.predicted = samples;
  }

  hover(s: InputSample | null) {
    if (s === null && this.hoverSample === null) return;
    this.hoverSample = s;
    this.requestFrame();
  }

  end() {
    if (!this.stroke) return;
    this.pending = 'commit';
    this.requestFrame();
  }

  cancel() {
    if (!this.stroke) return;
    this.pending = 'cancel';
    this.queue.length = 0;
    this.requestFrame();
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  private requestFrame = () => {
    if (!this.raf && !this.disposed && !this.lost) this.raf = requestAnimationFrame(this.frame);
  };

  private renderNow() {
    cancelAnimationFrame(this.raf);
    this.frame();
  }

  private frame = () => {
    this.raf = 0;
    if (this.disposed || this.lost) return;
    const gl = this.gl;
    const start = performance.now();
    let newestInput = -1;

    // 1. New dabs into the stroke buffer: 'over' builds up flow where dabs overlap, 'max'
    //    (marker) never exceeds a single dab.
    const batch = this.batch;
    batch.clear();
    const stroke = this.stroke;
    if (stroke) {
      for (const s of this.queue) {
        this.feed(stroke, stroke.stabilizer.push(s), this.emitDab);
        newestInput = s.t;
      }
      if (this.pending === 'commit') {
        for (const s of stroke.stabilizer.catchUp()) this.feed(stroke, s, this.emitDab);
        stroke.path.finish(this.emitDab);
      }
    }
    this.queue.length = 0;
    if (stroke && batch.count > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.strokeBuf.fbo);
      gl.viewport(0, 0, this.docW, this.docH);
      gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND);
      if (stroke.preset.accumulate === 'max') {
        gl.blendEquation(gl.MAX);
      } else {
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      this.dabs.draw(batch, {
        docToClip: this.fboClip,
        color: stroke.color,
        aa: 1,
        preset: stroke.preset,
      });
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      stroke.bounds = unionRect(stroke.bounds, batch.bounds());
    }

    // 2. Pen-up merges the stroke into the layer at its opacity; a cancelled stroke just goes.
    if (stroke && this.pending) {
      const r = stroke.bounds && clampRect(stroke.bounds, this.docW, this.docH);
      if (r) {
        if (this.pending === 'commit') {
          this.presenter.merge(this.strokeBuf, this.layer, r, stroke.erase, stroke.opacity);
        }
        this.presenter.clear(this.strokeBuf, r);
      }
      this.stroke = null;
      this.pending = null;
      this.predicted = [];
    }
    const live = this.stroke;

    // 3. Present: paper + layer + live stroke, through the view transform.
    const dpr = devicePixelRatio || 1;
    const docToClip = toMat3(
      multiply(viewToClip(this.viewW, this.viewH), this.view.docToView),
      this.screenClip,
    );
    this.presenter.draw({
      layer: this.layer,
      stroke: this.strokeBuf,
      strokeOpacity: live?.opacity ?? 1,
      erase: live?.erase ?? false,
      docToClip,
      paper: PAPER,
      surround: SURROUND,
      nearest: this.view.scale * dpr >= 3,
      width: this.canvas.width,
      height: this.canvas.height,
    });

    // 4. Screen-only overlays, gone next frame: the not-yet-committed tail of the stroke plus
    //    predicted points (hides latency), and the brush cursor ring.
    const overlay = this.overlay;
    const screenAA = 1 / this.view.scale; // 1 CSS px in document units
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (live && !live.erase) {
      overlay.clear();
      const saved = live.dabs.save();
      const predicted = live.predict ? this.predicted : [];
      live.path.preview(predicted.map(toPt), this.emitOverlay);
      live.dabs.restore(saved);
      const [r, g, b] = live.color;
      const o = live.opacity;
      this.dabs.draw(overlay, {
        docToClip,
        color: [r * o, g * o, b * o, o],
        aa: 1,
        preset: live.preset,
      });
    }
    if (this.hoverSample && !live) {
      overlay.clear();
      overlay.push(this.hoverSample.x, this.hoverSample.y, this.tool.size / 2, 1);
      this.dabs.draw(overlay, { docToClip, color: CURSOR_RING, aa: screenAA, ring: true });
    }
    gl.disable(gl.BLEND);

    // Stats for the debug HUD.
    const end = performance.now();
    if (newestInput >= 0) engineStats.latencyMs = ema(engineStats.latencyMs, end - newestInput);
    engineStats.dabsPerFrame = batch.count;
    engineStats.frameCpuMs = ema(engineStats.frameCpuMs, end - start);
    engineStats.zoomPercent = this.view.scale * dpr * 100;
    engineStats.rotationDeg = (this.view.rotation * 180) / Math.PI;
  };

  private feed(stroke: Stroke, s: InputSample, sink: (pt: Pt) => void) {
    stroke.dabs.setTilt(s.altitude, s.azimuth);
    stroke.path.push(toPt(s), sink);
  }

  private emitDab = (pt: Pt) => {
    this.stroke?.dabs.emit(pt, this.batch);
  };

  private emitOverlay = (pt: Pt) => {
    this.stroke?.dabs.emit(pt, this.overlay);
  };

  // ── Environment events ──────────────────────────────────────────────────────

  private onResize = (entries: ResizeObserverEntry[]) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    if (width === 0 || height === 0) return;
    const device = entry.devicePixelContentBoxSize?.[0];
    const w = device ? device.inlineSize : Math.round(width * devicePixelRatio);
    const h = device ? device.blockSize : Math.round(height * devicePixelRatio);
    if (width !== this.viewW || height !== this.viewH) {
      this.view.reshape(this.viewW, this.viewH, width, height);
      this.viewW = width;
      this.viewH = height;
    }
    // Assigning width/height clears the canvas, so only do it on a real change.
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.requestFrame();
  };

  private onWheel = (e: WheelEvent) => {
    if (e.target !== this.canvas) {
      if (e.ctrlKey) e.preventDefault(); // never let the page itself zoom
      return;
    }
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.viewH : 1;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Ctrl+wheel is also what a Chromium trackpad pinch sends.
    if (e.ctrlKey || e.metaKey) this.view.zoomAt(Math.exp(-e.deltaY * unit * 0.01), x, y);
    else this.view.panBy(-e.deltaX * unit, -e.deltaY * unit);
    this.requestFrame();
  };

  private onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const cx = this.viewW / 2;
    const cy = this.viewH / 2;
    switch (e.key) {
      case '=':
      case '+':
        this.view.zoomAt(KEY_ZOOM, cx, cy);
        break;
      case '-':
        this.view.zoomAt(1 / KEY_ZOOM, cx, cy);
        break;
      case '0':
        this.view.fit(this.docW, this.docH, this.viewW, this.viewH);
        break;
      default:
        return;
    }
    e.preventDefault(); // route browser zoom shortcuts to the canvas
    this.requestFrame();
  };

  // Restoring the context (rebuilding textures from saved tiles) arrives in Phase 7.
  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.opts.onContextLost?.();
  };
}

const toPt = (s: InputSample): Pt => ({ x: s.x, y: s.y, p: s.pressure });

/** View CSS px (y down) → clip space of the default framebuffer (y up). */
function viewToClip(w: number, h: number): Affine {
  return { a: 2 / w, b: 0, c: 0, d: -2 / h, e: -1, f: 1 };
}
