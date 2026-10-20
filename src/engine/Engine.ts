import {
  activeIndex,
  documentStore,
  type DocumentState,
  type LayerMeta,
  makeLayer,
} from '../state/documentStore';
import { historyStore } from '../state/historyStore';
import { thumbnailStore } from '../state/thumbnailStore';
import { parseHexColor } from './brush/color';
import { DabGenerator } from './brush/DabGenerator';
import { type BrushPreset, DEFAULT_PRESET_ID, presetById } from './brush/presets';
import { Stabilizer } from './brush/Stabilizer';
import { type Pt, StrokePath } from './brush/StrokePath';
import type { ToolSettings } from './brush/tool';
import { createGL, isDesynchronized } from './gl/context';
import { createTarget, deleteTarget, type Rect, strokeFormat, type Target } from './gl/target';
import type { SavedDocument } from '../persistence/document';
import { compressTile, inflateTile } from './history/compress';
import {
  type DocSnapshot,
  History,
  type HistoryEntry,
  type LayerTiles,
  type TileData,
} from './history/History';
import { type Capture, TileIO } from './history/TileIO';
import { alignToTiles, tileGrid, tileRect } from './history/tiles';
import { GestureRecognizer } from './input/GestureRecognizer';
import { type InputSample, PointerInput, type StrokeSink } from './input/PointerInput';
import { gpuBudgetBytes, historyBudgetBytes, maxLayersFor } from './layers/budget';
import { MAX_DOC_SIZE, screenDocSize } from './limits';
import {
  Compositor,
  type GpuLayer,
  type LiveStroke,
  type Rgba,
  type StrokeMode,
} from './layers/Compositor';
import { type Affine, apply, identity, multiply, toMat3 } from './math/affine';
import { clampRect, DabBatch, unionRect } from './render/DabBatch';
import { renderBrushPreview } from './render/BrushPreview';
import { DabRenderer } from './render/DabRenderer';
import { Presenter } from './render/Presenter';
import { QuadPass, targetClip } from './render/QuadPass';
import {
  contentBounds,
  crop,
  flattenOnto,
  imageToDataURL,
  readPremultiplied,
  unpremultiply,
} from './render/readback';
import { Thumbnailer } from './render/Thumbnailer';
import { ema, engineStats } from './stats';
import { type Insets, NO_INSETS, ViewTransform } from './view/ViewTransform';

export interface EngineOptions {
  /** Multi-finger tap: 2 = undo, 3 = redo, 4 = toggle UI. */
  onTap?: (fingers: number) => void;
  /** Short user-facing message, e.g. why a stroke was refused. */
  onNotice?: (message: string) => void;
  onContextLost?: () => void;
  /** Document size in px; defaults to the screen size (× device pixel ratio). */
  docSize?: { w: number; h: number };
  /** Opens a saved document (its size wins over `docSize`); pixels follow via loadTiles(). */
  document?: SavedDocument;
  /** Fired after every change that's recorded in history, i.e. whenever there's unsaved work. */
  onChange?: () => void;
  /** View margins covered by UI chrome; "fit to screen" keeps the canvas clear of them. */
  insets?: Insets;
  /** Eyedropper loupe position (view CSS px) and color under it; null when it ends. */
  onEyedropper?: (loupe: { x: number; y: number; color: string | null } | null) => void;
  onColorPicked?: (color: string) => void;
}

export { MAX_DOC_SIZE, screenDocSize };

const SURROUND = [0.173, 0.173, 0.18, 1] as const;
const CURSOR_RING = [0.38, 0.38, 0.38, 0.85] as const; // premultiplied mid-gray: visible on light and dark
const KEY_ZOOM = 1.25;
/** The most recent history steps stay uncompressed so undoing them is instant. */
const KEEP_RAW_STEPS = 8;
const COMPRESS_DELAY_MS = 1500;
const THUMBNAIL_DELAY_MS = 300;
/** Longest side of the gallery thumbnail, px. */
const GALLERY_THUMB = 512;

/** A layer's pixels for export (PSD), cropped to its content. */
export interface LayerExport {
  meta: LayerMeta;
  left: number;
  top: number;
  /** Straight alpha; null for an empty layer. */
  pixels: ImageData | null;
}

/** One in-progress stroke: its own copy of the tool settings and pipeline state. */
interface Stroke {
  layerId: string;
  preset: BrushPreset;
  stabilizer: Stabilizer;
  path: StrokePath;
  dabs: DabGenerator;
  /** Premultiplied; white for erase strokes, which only use coverage. */
  color: [number, number, number, number];
  opacity: number;
  mode: StrokeMode;
  /** Prediction contradicts smoothing, so it's only used with StreamLine off. */
  predict: boolean;
  bounds: Rect | null;
}

/**
 * The drawing engine: owns the WebGL2 context, layer textures, view transform and input, and
 * renders on demand in a requestAnimationFrame loop. No React in here.
 *
 * Layer metadata lives in `documentStore` (Zustand); the engine mirrors it with one GPU texture
 * per layer and recomposites when it changes. Pixel operations (strokes, clear, merge, flatten)
 * go through the engine.
 *
 * A stroke deposits dabs into the stroke buffer (flow builds up there); the compositor previews
 * it on the active layer at the stroke's opacity, and on pen-up merges it into the layer. A finger
 * stroke that turns into a pinch is discarded cleanly.
 *
 * Stroke pipeline per sample: Stabilizer (StreamLine + pressure smoothing) → StrokePath
 * (midpoint quadratic, arc-length spacing) → DabGenerator (pressure curves, tilt, jitter) →
 * DabRenderer (tip shape + grain, one instanced draw per frame).
 */
export class Engine implements StrokeSink {
  readonly docW: number;
  readonly docH: number;

  private gl: WebGL2RenderingContext;
  private layers = new Map<string, Target>();
  private strokeBuf: Target;
  private quad: QuadPass;
  private compositor: Compositor;
  private dabs: DabRenderer;
  private presenter: Presenter;
  private view = new ViewTransform();
  private input: PointerInput;
  private ro: ResizeObserver;
  private ac = new AbortController();
  private unsubscribe: () => void;

  private viewW: number;
  private viewH: number;
  private fboClip: Float32Array;
  private screenClip = new Float32Array(9);
  private gestureBase: Affine = identity();
  private insets: Insets;

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
  /** Document area that needs recompositing: a rect, everything, or nothing. */
  private docDirty: Rect | 'all' | null = 'all';

  private tileIO: TileIO;
  private history: History;
  /** >0 while the engine itself changes the store (merge, flatten, undo), so it isn't recorded. */
  private suppressRecord = 0;
  /** Undo/redo run in order; compressed tiles inflate asynchronously. */
  private historyQueue: Promise<void> = Promise.resolve();
  /** Stroke tiles still being read back from the GPU. */
  private captures = new Map<HistoryEntry, Capture>();
  private compressTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Tiles changed since the autosaver last asked, latest content per tile. Every pixel change
   * comes through a history entry, whose tiles are reused here instead of reading the GPU again.
   */
  private unsaved = new Map<string, Map<number, TileData>>();
  /** True while a saved document's tiles are being uploaded; input waits. */
  private loading = false;

  private thumbnailer: Thumbnailer;
  private galleryThumbnailer: Thumbnailer | null = null;
  private thumbsDirty = new Set<string>();
  private thumbTimer: ReturnType<typeof setTimeout> | undefined;

  private eyedropperArmed = false;
  private picking: { color: string | null } | null = null;
  private spaceHeld = false;
  private panPointer: { id: number; x: number; y: number } | null = null;

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
    this.insets = opts.insets ?? NO_INSETS;
    const rect = canvas.getBoundingClientRect();
    this.viewW = rect.width || innerWidth;
    this.viewH = rect.height || innerHeight;

    const dpr = devicePixelRatio || 1;
    const cap = Math.min(MAX_DOC_SIZE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const saved = opts.document;
    const size = saved ? { w: saved.width, h: saved.height } : (opts.docSize ?? screenDocSize());
    this.docW = Math.max(1, Math.min(cap, Math.round(size.w)));
    this.docH = Math.max(1, Math.min(cap, Math.round(size.h)));
    this.strokeBuf = createTarget(gl, this.docW, this.docH, strokeFormat(gl));
    this.fboClip = targetClip(this.strokeBuf);
    this.quad = new QuadPass(gl);
    this.compositor = new Compositor(gl, this.quad, this.docW, this.docH);
    this.dabs = new DabRenderer(gl);
    this.presenter = new Presenter(gl, this.quad);
    this.tileIO = new TileIO(gl, tileGrid(this.docW, this.docH));
    this.thumbnailer = new Thumbnailer(gl, this.docW, this.docH);
    thumbnailStore.setState({ urls: {} });
    this.history = new History(
      { maxBytes: historyBudgetBytes(), maxEntries: 250 },
      this.publishHistory,
    );

    let maxLayers = maxLayersFor(this.docW * this.docH * 4, gpuBudgetBytes());
    if (saved) {
      // A document from a bigger device keeps its layers; it just can't gain more.
      maxLayers = Math.max(maxLayers, saved.layers.length);
      documentStore.getState().load({ ...saved, width: this.docW, height: this.docH, maxLayers });
    } else {
      documentStore.getState().reset({ width: this.docW, height: this.docH, maxLayers });
    }
    this.syncLayers(documentStore.getState());
    this.unsubscribe = documentStore.subscribe(this.onDocumentChange);

    canvas.width = Math.round(this.viewW * dpr);
    canvas.height = Math.round(this.viewH * dpr);
    this.view.fit(this.docW, this.docH, this.viewW, this.viewH, this.insets);

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
      hold: (p) => {
        const [x, y] = this.view.viewToDoc(p.x, p.y);
        this.startPick(x, y);
      },
      holdMove: (p) => {
        const [x, y] = this.view.viewToDoc(p.x, p.y);
        this.pickAt(x, y);
      },
      holdEnd: (cancelled) => this.finishPick(!cancelled),
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
    // Space+drag and middle-mouse drag pan. Capture-phase listeners on the canvas run before
    // PointerInput's, so a pan never reaches the stroke pipeline.
    const capture = { capture: true, passive: false, signal } as const;
    canvas.addEventListener('pointerdown', this.onPanDown, capture);
    canvas.addEventListener('pointermove', this.onPanMove, capture);
    canvas.addEventListener('pointerup', this.onPanEnd, capture);
    canvas.addEventListener('pointercancel', this.onPanEnd, capture);
    window.addEventListener('keydown', this.onSpace, { signal });
    window.addEventListener('keyup', this.onSpace, { signal });

    engineStats.running = true;
    engineStats.docSize = `${this.docW}×${this.docH}`;
    engineStats.desynchronized = isDesynchronized(gl);
    engineStats.strokeFormat = this.strokeBuf.format;
    engineStats.maxLayers = maxLayers;
    this.publishHistory();
    this.requestFrame();
  }

  // ── Public API (called from React) ──────────────────────────────────────────

  /** Takes effect from the next stroke. */
  setTool(tool: ToolSettings) {
    this.tool = tool;
    this.requestFrame(); // cursor ring size
  }

  /** UI chrome changed (shown, hidden, sidebar moved): affects the next fit. */
  setInsets(insets: Insets) {
    this.insets = insets;
  }

  fitToScreen() {
    this.view.fit(this.docW, this.docH, this.viewW, this.viewH, this.insets);
    this.requestFrame();
  }

  /** Clears the active layer. */
  clearLayer() {
    const doc = documentStore.getState();
    const meta = doc.layers[activeIndex(doc)];
    const target = meta && this.layers.get(meta.id);
    if (!meta || !target || this.stroke) return;
    if (meta.locked) return this.notice(`${meta.name} is locked`);
    const before = this.tileIO.readAll(target);
    if (before.size === 0) return;
    this.compositor.clearTarget(target, null);
    this.markThumbs([meta.id]);
    this.pushHistory({
      label: 'Clear layer',
      pixels: new Map([[meta.id, TileIO.diff(before, new Map())]]),
      time: performance.now(),
      bytes: 0,
    });
    this.markDirty('all');
  }

  /**
   * Merges the active layer into the one below it. The lower layer's opacity is baked into its
   * pixels first, so the merge doesn't change how the picture looks; it keeps its blend mode.
   */
  mergeDown() {
    const doc = documentStore.getState();
    const i = activeIndex(doc);
    const upper = doc.layers[i];
    const lower = doc.layers[i - 1];
    if (!upper || !lower) return this.notice('There’s no layer below to merge into');
    const src = this.layers.get(upper.id);
    const dst = this.layers.get(lower.id);
    if (!src || !dst || this.stroke) return;
    const before = snapshot(doc);
    const lowerBefore = this.tileIO.readAll(dst);
    const upperBefore = this.tileIO.readAll(src);
    const merged = createTarget(this.gl, this.docW, this.docH);
    this.compositor.blendLayer(merged, dst, lower.opacity, 'normal', null);
    if (upper.visible)
      this.compositor.blendLayer(merged, src, upper.opacity, upper.blendMode, null);
    deleteTarget(this.gl, dst);
    this.layers.set(lower.id, merged);
    this.markThumbs([lower.id]);
    this.withoutRecording(() => {
      doc.updateLayer(lower.id, { opacity: 1 });
      doc.removeLayer(upper.id); // selects `lower`; syncLayers frees `src`
    });
    this.pushHistory({
      label: 'Merge down',
      doc: { before, after: snapshot(documentStore.getState()) },
      pixels: new Map([
        [lower.id, TileIO.diff(lowerBefore, this.tileIO.readAll(merged))],
        [upper.id, TileIO.diff(upperBefore, new Map())],
      ]),
      time: performance.now(),
      bytes: 0,
    });
  }

  /** Composites all visible layers into a single new layer. Hidden layers are discarded. */
  flatten() {
    const doc = documentStore.getState();
    if (this.stroke || doc.layers.length < 2) return;
    const before = snapshot(doc);
    const pixels = new Map<string, LayerTiles>();
    for (const l of doc.layers) {
      const t = this.layers.get(l.id);
      if (t) pixels.set(l.id, TileIO.diff(this.tileIO.readAll(t), new Map()));
    }
    const target = createTarget(this.gl, this.docW, this.docH);
    this.compositor.flattenInto(this.gpuLayers(doc), target, null);
    const layer = makeLayer('Flattened');
    pixels.set(layer.id, TileIO.diff(new Map(), this.tileIO.readAll(target)));
    this.layers.set(layer.id, target); // registered before the store change, so it's kept
    this.withoutRecording(() => doc.replaceLayers([layer], layer.id));
    this.pushHistory({
      label: 'Flatten',
      doc: { before, after: snapshot(documentStore.getState()) },
      pixels,
      time: performance.now(),
      bytes: 0,
    });
  }

  /** The next touch on the canvas picks a color instead of painting. */
  setEyedropper(armed: boolean) {
    this.eyedropperArmed = armed;
  }

  /** Allow painting with a finger until a pen has been used. */
  setFingerDrawing(enabled: boolean) {
    this.input.fingerDrawing = enabled;
  }

  /** Copies the active layer (pixels and properties) above itself. */
  duplicateLayer() {
    const doc = documentStore.getState();
    const i = activeIndex(doc);
    const meta = doc.layers[i];
    const src = meta && this.layers.get(meta.id);
    if (!meta || !src || this.stroke) return;
    if (doc.layers.length >= doc.maxLayers) {
      return this.notice(`Layer limit reached (${doc.maxLayers} at this canvas size)`);
    }
    const before = snapshot(doc);
    const copy = createTarget(this.gl, this.docW, this.docH);
    this.compositor.blendLayer(copy, src, 1, 'normal', null); // exact copy onto transparent
    const fresh = makeLayer(`${meta.name} copy`);
    const layer = { ...meta, id: fresh.id, name: fresh.name, locked: false };
    this.layers.set(layer.id, copy);
    this.markThumbs([layer.id]);
    this.withoutRecording(() => doc.insertLayer(layer, i + 1));
    this.pushHistory({
      label: 'Duplicate layer',
      doc: { before, after: snapshot(documentStore.getState()) },
      pixels: new Map([[layer.id, TileIO.diff(new Map(), this.tileIO.readAll(copy))]]),
      time: performance.now(),
      bytes: 0,
    });
  }

  /** PNG data URL of the composited document, gallery-sized. */
  documentThumbnail(): string | null {
    const img = this.galleryThumbnail();
    return img && imageToDataURL(img);
  }

  /** A sample stroke of a brush, as a PNG data URL, for the brush library. */
  brushPreview(preset: BrushPreset): string {
    return renderBrushPreview(this.gl, this.dabs, preset);
  }

  /**
   * Uploads a saved document's tiles (zlib Blobs or raw bytes) into the layer textures. Layers
   * appear one by one; painting waits until everything is in.
   */
  async loadTiles(tiles: ReadonlyMap<string, ReadonlyMap<number, TileData>>): Promise<void> {
    const grid = this.tileIO.grid;
    const count = grid.cols * grid.rows;
    this.loading = true;
    try {
      for (const [layerId, layer] of tiles) {
        const raw = new Map<number, Uint8Array | null>();
        for (const [key, tile] of layer) {
          const data = await inflateTile(tile);
          if (this.disposed || this.lost) return;
          if (!Number.isInteger(key) || key < 0 || key >= count) continue;
          const r = tileRect(grid, key);
          if (data && data.byteLength !== r.w * r.h * 4) continue; // damaged tile
          raw.set(key, data);
        }
        const target = this.layers.get(layerId);
        if (!target) continue;
        this.tileIO.write(target, raw);
        this.compositor.invalidate();
        this.markDirty('all');
        this.markThumbs([layerId]);
      }
    } finally {
      this.loading = false;
    }
  }

  /** Tiles changed since the last call (the autosave payload), and forgets them. */
  takeChanges(): Map<string, Map<number, TileData>> {
    if (this.pending && !this.disposed && !this.lost) this.renderNow(); // a pen just lifted
    for (const entry of [...this.captures.keys()]) entry.pending?.(); // stroke readbacks
    const out = this.unsaved;
    this.unsaved = new Map();
    return out;
  }

  /** Every non-empty tile of every layer (a full save). Blocks on GPU readback. */
  allTiles(): Map<string, Map<number, TileData>> {
    const out = new Map<string, Map<number, TileData>>();
    if (this.disposed || this.lost) return out;
    for (const [id, target] of this.layers) out.set(id, this.tileIO.readAll(target));
    return out;
  }

  /** The composited document, at most 512 px, for the gallery. */
  galleryThumbnail(): ImageData | null {
    if (this.disposed || this.lost) return null;
    if (this.docDirty) this.renderNow();
    this.galleryThumbnailer ??= new Thumbnailer(this.gl, this.docW, this.docH, GALLERY_THUMB);
    return this.galleryThumbnailer.renderImage(this.compositor.output);
  }

  /**
   * The full-size composited image, straight alpha. `opaque` puts it on the background color
   * even when the background is hidden (JPEG has no transparency).
   */
  exportImage(opaque: boolean): ImageData {
    this.renderNow();
    const px = readPremultiplied(this.gl, this.compositor.output);
    if (opaque)
      flattenOnto(
        px,
        parseHexColor(documentStore.getState().background.color).map((v) => v * 255),
      );
    else unpremultiply(px);
    return new ImageData(px, this.docW, this.docH);
  }

  /** Every layer's pixels, cropped to their content, bottom first (PSD export). */
  exportLayers(): LayerExport[] {
    const doc = documentStore.getState();
    const out: LayerExport[] = [];
    for (const meta of doc.layers) {
      const target = this.layers.get(meta.id);
      if (!target) continue;
      const px = readPremultiplied(this.gl, target);
      const r = contentBounds(px, this.docW, this.docH);
      if (!r) {
        out.push({ meta, left: 0, top: 0, pixels: null });
        continue;
      }
      const cropped = crop(px, this.docW, r);
      unpremultiply(cropped);
      out.push({ meta, left: r.x, top: r.y, pixels: new ImageData(cropped, r.w, r.h) });
    }
    return out;
  }

  /** Adds a layer above the active one with the given pixels (premultiplied tiles). */
  insertLayer(name: string, tiles: Map<number, Uint8Array>): boolean {
    const doc = documentStore.getState();
    if (this.stroke || this.loading) return false;
    if (doc.layers.length >= doc.maxLayers) {
      this.notice(`Layer limit reached (${doc.maxLayers} at this canvas size)`);
      return false;
    }
    const before = snapshot(doc);
    const layer = makeLayer(name);
    const target = createTarget(this.gl, this.docW, this.docH);
    this.tileIO.write(target, tiles);
    this.layers.set(layer.id, target); // registered before the store change, so it's kept
    this.markThumbs([layer.id]);
    this.withoutRecording(() => doc.insertLayer(layer, activeIndex(doc) + 1));
    this.pushHistory({
      label: 'Insert image',
      doc: { before, after: snapshot(documentStore.getState()) },
      pixels: new Map([[layer.id, TileIO.diff(new Map(), tiles)]]),
      time: performance.now(),
      bytes: 0,
    });
    return true;
  }

  undo() {
    if (!this.stroke && !this.loading) this.enqueueHistory('undo');
  }

  redo() {
    if (!this.stroke && !this.loading) this.enqueueHistory('redo');
  }

  /** Resolves when queued undo/redo steps have been applied. */
  whenIdle(): Promise<void> {
    return this.historyQueue;
  }

  /** Test hook: renders now and returns an FNV-1a hash of the composited document. */
  debugHash(): string {
    this.renderNow();
    const gl = this.gl;
    const out = this.compositor.output;
    const data = new Uint8Array(out.w * out.h * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, out.w, out.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    const words = new Uint32Array(data.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ (words[i] ?? 0), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.compressTimer);
    clearTimeout(this.thumbTimer);
    this.unsubscribe();
    this.input.dispose();
    this.ro.disconnect();
    this.ac.abort();
    engineStats.running = false;
    // Free the context itself once the canvas has really left the page. (Under StrictMode the
    // same canvas is mounted again right away, and the next Engine reuses its context.)
    const gl = this.gl;
    setTimeout(() => {
      if (!this.canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
    }, 0);
    if (this.lost) return;
    // No loseContext(): under StrictMode a new Engine reuses this canvas's context.
    for (const entry of this.captures.keys()) entry.pending?.(); // frees the readback buffers
    this.thumbnailer.dispose();
    this.galleryThumbnailer?.dispose();
    this.dabs.dispose();
    this.presenter.dispose();
    this.compositor.dispose();
    this.quad.dispose();
    for (const t of this.layers.values()) deleteTarget(this.gl, t);
    this.layers.clear();
    deleteTarget(this.gl, this.strokeBuf);
  }

  // ── StrokeSink (called by PointerInput) ─────────────────────────────────────

  begin(s: InputSample, opts: { pointerType: string; eraser: boolean; barrel: boolean }) {
    if (this.eyedropperArmed || opts.barrel) return this.startPick(s.x, s.y);
    if (this.pending) this.renderNow(); // pen lifted and touched down within one frame
    if (this.loading) return this.notice('Still opening…');
    const doc = documentStore.getState();
    const layer = doc.layers[activeIndex(doc)];
    if (!layer) return;
    if (layer.locked) return this.notice(`${layer.name} is locked`);
    if (!layer.visible) return this.notice(`${layer.name} is hidden`);

    const { preset, size, opacity, smoothing, color, eraser } = this.tool;
    const erase = eraser || opts.eraser;
    const [r, g, b] = parseHexColor(color);
    const dabs = new DabGenerator(preset, size, this.strokeSeed++);
    this.stroke = {
      layerId: layer.id,
      preset,
      stabilizer: new Stabilizer(smoothing),
      path: new StrokePath(dabs.spacingAt),
      dabs,
      color: erase ? [1, 1, 1, 1] : [r, g, b, 1],
      opacity: Math.min(1, Math.max(0, opacity)),
      // Alpha lock keeps the layer's alpha: paint lands inside existing pixels; erasing still erases.
      mode: erase ? 'erase' : layer.alphaLocked ? 'inside' : 'paint',
      predict: smoothing === 0,
      bounds: null,
    };
    this.hoverSample = null;
    this.queue.push(s);
    this.requestFrame();
  }

  extend(samples: InputSample[]) {
    const last = samples[samples.length - 1];
    if (this.picking) {
      if (last) this.pickAt(last.x, last.y);
      return;
    }
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
    if (this.picking) return this.finishPick(true);
    if (!this.stroke) return;
    this.pending = 'commit';
    this.requestFrame();
  }

  cancel() {
    if (this.picking) return this.finishPick(false);
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
    const doc = documentStore.getState();

    for (const [entry, capture] of this.captures) if (capture.ready()) entry.pending?.();

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
      const bounds = batch.bounds();
      stroke.bounds = unionRect(stroke.bounds, bounds);
      this.markDirty(bounds);
    }

    // 2. Pen-up merges the stroke into its layer; a cancelled stroke just goes away.
    if (stroke && this.pending) {
      const r = stroke.bounds && clampRect(stroke.bounds, this.docW, this.docH);
      const target = this.layers.get(stroke.layerId);
      if (r) {
        if (this.pending === 'commit' && target) {
          const region = alignToTiles(this.tileIO.grid, r);
          const capture = region ? this.tileIO.capture(target, region) : null;
          this.compositor.commitStroke(target, this.liveStroke(stroke), r);
          if (capture) {
            capture.after();
            this.recordStroke(
              stroke.mode === 'erase' ? 'Erase' : 'Stroke',
              stroke.layerId,
              capture,
            );
          }
          this.markThumbs([stroke.layerId]);
          // A stroke whose layer stopped being active mid-stroke lands in a cached range.
          if (stroke.layerId !== doc.activeLayerId) this.compositor.invalidate();
        }
        this.compositor.clearTarget(this.strokeBuf, r);
        this.markDirty(stroke.layerId === doc.activeLayerId ? r : 'all');
      }
      this.stroke = null;
      this.pending = null;
      this.predicted = [];
    }
    const live = this.stroke;

    // 3. Recomposite whatever changed in the document.
    if (this.docDirty) {
      const rect = this.docDirty === 'all' ? null : clampRect(this.docDirty, this.docW, this.docH);
      if (this.docDirty === 'all' || rect) {
        const showStroke = live?.layerId === doc.activeLayerId;
        this.compositor.render(
          this.gpuLayers(doc),
          activeIndex(doc),
          backgroundColor(doc),
          live && showStroke ? this.liveStroke(live) : null,
          rect,
        );
      }
      this.docDirty = null;
    }

    // 4. Present the document through the view transform.
    const dpr = devicePixelRatio || 1;
    const docToClip = toMat3(
      multiply(viewToClip(this.viewW, this.viewH), this.view.docToView),
      this.screenClip,
    );
    this.presenter.draw({
      image: this.compositor.output,
      docToClip,
      surround: SURROUND,
      nearest: this.view.scale * dpr >= 3,
      width: this.canvas.width,
      height: this.canvas.height,
    });

    // 5. Screen-only overlays, gone next frame: the not-yet-committed tail of the stroke plus
    //    predicted points (hides latency), and the brush cursor ring. The tail is drawn on top
    //    of everything, so it's skipped where that would look wrong.
    const overlay = this.overlay;
    const screenAA = 1 / this.view.scale; // 1 CSS px in document units
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (live && this.canPreviewOnTop(live, doc)) {
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
    if (this.captures.size > 0) this.requestFrame(); // keep polling the GPU readbacks
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

  private liveStroke(stroke: Stroke): LiveStroke {
    return { target: this.strokeBuf, opacity: stroke.opacity, mode: stroke.mode };
  }

  /** The tail overlay is plain source-over on top of the final image. */
  private canPreviewOnTop(stroke: Stroke, doc: DocumentState): boolean {
    if (stroke.mode !== 'paint' || stroke.layerId !== doc.activeLayerId) return false;
    const i = activeIndex(doc);
    const layer = doc.layers[i];
    return (
      layer?.blendMode === 'normal' &&
      layer.opacity === 1 &&
      !doc.layers.slice(i + 1).some((l) => l.visible && l.opacity > 0)
    );
  }

  private markDirty(r: Rect | null | 'all') {
    if (r === null || this.docDirty === 'all') return;
    this.docDirty = r === 'all' ? 'all' : unionRect(this.docDirty, r);
    this.requestFrame();
  }

  // ── Document store sync ─────────────────────────────────────────────────────

  private gpuLayers(doc: DocumentState): GpuLayer[] {
    const out: GpuLayer[] = [];
    for (const meta of doc.layers) {
      const target = this.layers.get(meta.id);
      if (target) out.push({ ...meta, target });
    }
    return out;
  }

  /** Creates textures for new layers and frees those of removed ones. */
  private syncLayers(doc: DocumentState) {
    const ids = new Set(doc.layers.map((l) => l.id));
    for (const [id, target] of this.layers) {
      if (!ids.has(id)) {
        deleteTarget(this.gl, target);
        this.layers.delete(id);
      }
    }
    const fresh: string[] = [];
    for (const id of ids) {
      if (!this.layers.has(id)) {
        this.layers.set(id, createTarget(this.gl, this.docW, this.docH));
        fresh.push(id);
      }
    }
    this.markThumbs(fresh.concat([...ids].filter((id) => !thumbnailStore.getState().urls[id])));
    engineStats.layers = this.layers.size;
    const layerMB = (this.docW * this.docH * 4) / (1024 * 1024);
    engineStats.gpuMB = Math.round(
      layerMB * (this.layers.size + 5) + layerMB * (this.strokeBuf.format === 'rgba16f' ? 2 : 1),
    );
  }

  private onDocumentChange = (doc: DocumentState, prev: DocumentState) => {
    if (this.disposed || this.lost) return;
    // Record before syncLayers frees the textures of deleted layers.
    if (
      this.suppressRecord === 0 &&
      (doc.layers !== prev.layers || doc.background !== prev.background)
    ) {
      this.recordDocChange(prev, doc);
    }
    if (doc.layers !== prev.layers) this.syncLayers(doc);
    if (
      doc.layers !== prev.layers ||
      doc.activeLayerId !== prev.activeLayerId ||
      doc.background !== prev.background
    ) {
      this.compositor.invalidate();
      this.markDirty('all');
    }
  };

  // ── History ─────────────────────────────────────────────────────────────────

  private pushHistory(entry: HistoryEntry) {
    for (const [layerId, tiles] of entry.pixels) this.trackTiles(layerId, tiles);
    this.history.push(entry);
    this.opts.onChange?.();
    clearTimeout(this.compressTimer);
    this.compressTimer = setTimeout(() => void this.compressIdle(), COMPRESS_DELAY_MS);
  }

  /** Stroke tiles arrive a frame or two later, without stalling the GPU. */
  private recordStroke(label: string, layerId: string, capture: Capture) {
    const entry: HistoryEntry = { label, pixels: new Map(), time: performance.now(), bytes: 0 };
    entry.pending = () => {
      entry.pending = undefined;
      this.captures.delete(entry);
      const tiles = capture.finish();
      if (tiles.size > 0) entry.pixels.set(layerId, tiles);
      this.trackTiles(layerId, tiles);
      this.history.updateBytes(entry);
    };
    this.captures.set(entry, capture);
    this.pushHistory(entry);
  }

  /** Metadata changes made directly on the store (layers panel): add, delete, move, properties. */
  private recordDocChange(prev: DocumentState, doc: DocumentState) {
    const { label, coalesceKey } = describeChange(prev, doc);
    if (!label) return; // selection only
    const pixels = new Map<string, LayerTiles>();
    for (const l of prev.layers) {
      const target = this.layers.get(l.id);
      if (target && !doc.layers.some((n) => n.id === l.id)) {
        pixels.set(l.id, TileIO.diff(this.tileIO.readAll(target), new Map()));
      }
    }
    this.pushHistory({
      label,
      doc: { before: snapshot(prev), after: snapshot(doc) },
      pixels,
      coalesceKey,
      time: performance.now(),
      bytes: 0,
    });
  }

  private enqueueHistory(direction: 'undo' | 'redo') {
    this.historyQueue = this.historyQueue
      .then(() => this.applyHistory(direction))
      .catch((err: unknown) => console.error('Undo/redo failed', err));
  }

  private async applyHistory(direction: 'undo' | 'redo') {
    this.history.flushPending();
    const peek = () => (direction === 'undo' ? this.history.peekUndo() : this.history.peekRedo());
    const entry = peek();
    if (!entry || this.disposed) return;
    const side = direction === 'undo' ? 'before' : 'after';

    // Inflate compressed tiles first, then apply everything in one synchronous step.
    const writes = new Map<string, Map<number, Uint8Array | null>>();
    for (const [layerId, tiles] of entry.pixels) {
      const out = new Map<number, Uint8Array | null>();
      for (const [key, change] of tiles) out.set(key, await inflateTile(change[side]));
      writes.set(layerId, out);
    }
    if (this.disposed || this.lost || peek() !== entry || this.stroke) return;

    const doc = entry.doc?.[side];
    if (doc)
      this.withoutRecording(() => documentStore.setState({ ...doc, layers: [...doc.layers] }));
    for (const [layerId, tiles] of writes) {
      const target = this.layers.get(layerId);
      if (target) this.tileIO.write(target, tiles);
      this.trackUnsaved(layerId, tiles);
    }
    if (direction === 'undo') this.history.stepBack();
    else this.history.stepForward();
    this.compositor.invalidate();
    this.markDirty('all');
    this.markThumbs([...writes.keys()]);
    this.notice(`${direction === 'undo' ? 'Undo' : 'Redo'}: ${entry.label}`);
    this.opts.onChange?.();
  }

  /** A recorded change's result is the tiles' new content. */
  private trackTiles(layerId: string, tiles: LayerTiles) {
    const latest = new Map<number, TileData>();
    for (const [key, change] of tiles) latest.set(key, change.after);
    this.trackUnsaved(layerId, latest);
  }

  private trackUnsaved(layerId: string, tiles: ReadonlyMap<number, TileData>) {
    if (tiles.size === 0) return;
    let layer = this.unsaved.get(layerId);
    if (!layer) this.unsaved.set(layerId, (layer = new Map()));
    for (const [key, data] of tiles) layer.set(key, data);
  }

  /** Deflates tiles of older steps once drawing pauses. */
  private async compressIdle() {
    for (const entry of this.history.compressible(KEEP_RAW_STEPS)) {
      let changed = false;
      for (const tiles of entry.pixels.values()) {
        for (const change of tiles.values()) {
          if (change.before instanceof Uint8Array) {
            change.before = await compressTile(change.before);
            changed = true;
          }
          if (change.after instanceof Uint8Array) {
            change.after = await compressTile(change.after);
            changed = true;
          }
          if (this.disposed) return;
        }
      }
      if (changed) this.history.updateBytes(entry);
    }
  }

  private publishHistory = () => {
    const h = this.history;
    historyStore.setState({
      canUndo: h.canUndo,
      canRedo: h.canRedo,
      undoLabel: h.peekUndo()?.label ?? null,
      redoLabel: h.peekRedo()?.label ?? null,
    });
    engineStats.historySteps = h.size;
    engineStats.historyMB = h.totalBytes / (1024 * 1024);
  };

  private withoutRecording(fn: () => void) {
    this.suppressRecord++;
    try {
      fn();
    } finally {
      this.suppressRecord--;
    }
  }

  // ── Eyedropper ──────────────────────────────────────────────────────────────

  private startPick(x: number, y: number) {
    this.picking = { color: null };
    this.hoverSample = null;
    this.pickAt(x, y);
  }

  private pickAt(x: number, y: number) {
    if (!this.picking) return;
    this.picking.color = this.colorAt(x, y) ?? this.picking.color;
    const [vx, vy] = apply(this.view.docToView, x, y);
    this.opts.onEyedropper?.({ x: vx, y: vy, color: this.picking.color });
  }

  private finishPick(commit: boolean) {
    const color = this.picking?.color;
    this.picking = null;
    this.opts.onEyedropper?.(null);
    if (commit && color) this.opts.onColorPicked?.(color);
  }

  /** The composited color at a document point, or null outside it / where it's transparent. */
  private colorAt(x: number, y: number): string | null {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.docW || py >= this.docH) return null;
    if (this.docDirty) this.renderNow();
    const gl = this.gl;
    const data = new Uint8Array(4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.compositor.output.fbo);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    const [r = 0, g = 0, b = 0, a = 0] = data;
    if (a === 0) return null;
    const hex = (v: number) =>
      Math.min(255, Math.round((v * 255) / a))
        .toString(16)
        .padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  // ── Thumbnails ──────────────────────────────────────────────────────────────

  private markThumbs(ids: string[]) {
    if (ids.length === 0) return;
    for (const id of ids) this.thumbsDirty.add(id);
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(this.renderThumbs, THUMBNAIL_DELAY_MS);
  }

  private renderThumbs = () => {
    if (this.disposed || this.lost) return;
    if (this.stroke) {
      this.thumbTimer = setTimeout(this.renderThumbs, THUMBNAIL_DELAY_MS); // not mid-stroke
      return;
    }
    const current = thumbnailStore.getState().urls;
    const urls: Record<string, string> = {};
    for (const [id, target] of this.layers) {
      const existing = current[id];
      urls[id] = this.thumbsDirty.has(id) || !existing ? this.thumbnailer.render(target) : existing;
    }
    this.thumbsDirty.clear();
    thumbnailStore.setState({ urls });
  };

  // ── Panning with Space or the middle mouse button ───────────────────────────

  private onSpace = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || isEditable(e.target)) return;
    e.preventDefault(); // no page scroll, no button activation
    this.spaceHeld = e.type === 'keydown';
    if (!this.panPointer) this.canvas.style.cursor = this.spaceHeld ? 'grab' : '';
  };

  private onPanDown = (e: PointerEvent) => {
    const pan =
      (this.spaceHeld && e.pointerType !== 'touch') ||
      (e.pointerType === 'mouse' && e.button === 1);
    if (!pan || this.stroke) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.panPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.style.cursor = 'grabbing';
  };

  private onPanMove = (e: PointerEvent) => {
    const p = this.panPointer;
    if (!p || e.pointerId !== p.id) return;
    e.stopImmediatePropagation();
    this.view.panBy(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX;
    p.y = e.clientY;
    this.requestFrame();
  };

  private onPanEnd = (e: PointerEvent) => {
    if (!this.panPointer || e.pointerId !== this.panPointer.id) return;
    e.stopImmediatePropagation();
    this.panPointer = null;
    this.canvas.style.cursor = this.spaceHeld ? 'grab' : '';
  };

  private notice(message: string) {
    this.opts.onNotice?.(message);
  }

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
        this.view.fit(this.docW, this.docH, this.viewW, this.viewH, this.insets);
        break;
      case 'z':
      case 'Z':
        if (isEditable(e.target)) return;
        if (e.shiftKey) this.redo();
        else this.undo();
        break;
      case 'y':
        if (isEditable(e.target)) return;
        this.redo();
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

function backgroundColor(doc: DocumentState): Rgba | null {
  if (!doc.background.visible) return null;
  const [r, g, b] = parseHexColor(doc.background.color);
  return [r, g, b, 1];
}

function snapshot(doc: DocumentState): DocSnapshot {
  return { layers: doc.layers, activeLayerId: doc.activeLayerId, background: doc.background };
}

const FIELD_LABELS: Partial<Record<keyof LayerMeta, string>> = {
  name: 'Rename layer',
  visible: 'Layer visibility',
  opacity: 'Layer opacity',
  blendMode: 'Blend mode',
  locked: 'Lock layer',
  alphaLocked: 'Alpha lock',
};

const changedKeys = <T extends object>(a: T, b: T) =>
  (Object.keys(b) as (keyof T)[]).filter((k) => a[k] !== b[k]);

/** A label for the change, and a key when repeats should merge (slider drags). */
function describeChange(
  prev: DocumentState,
  doc: DocumentState,
): { label: string | null; coalesceKey?: string } {
  if (doc.background !== prev.background) {
    const fields = changedKeys(prev.background, doc.background);
    const key = fields.join() === 'color' ? 'background:color' : undefined;
    return { label: 'Background', coalesceKey: key };
  }
  if (doc.layers === prev.layers) return { label: null };
  if (doc.layers.length > prev.layers.length) return { label: 'Add layer' };
  if (doc.layers.length < prev.layers.length) return { label: 'Delete layer' };
  if (doc.layers.some((l, i) => l.id !== prev.layers[i]?.id)) return { label: 'Move layer' };
  const changed = doc.layers.filter((l, i) => l !== prev.layers[i]);
  const layer = changed[0];
  const before = layer && prev.layers.find((p) => p.id === layer.id);
  if (changed.length !== 1 || !layer || !before) return { label: 'Layers' };
  const fields = changedKeys(before, layer);
  return {
    label: FIELD_LABELS[fields[0] ?? 'name'] ?? 'Layer',
    coalesceKey: fields.join() === 'opacity' ? `opacity:${layer.id}` : undefined,
  };
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !['range', 'checkbox', 'color'].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
