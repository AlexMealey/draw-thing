import {
  type DocumentState,
  effectiveLayer,
  frameIndex,
  frameStack,
} from '../../state/documentStore';
import { Program } from '../gl/program';
import { ONION_FS, QUAD_VS } from '../gl/shaders';
import { createTarget, deleteTarget, type Target } from '../gl/target';
import type { TileIO } from '../history/TileIO';
import type { Compositor, Rgba } from '../layers/Compositor';
import { type QuadPass, targetClip } from '../render/QuadPass';
import { flattenOnto, imageToDataURL, unpremultiply } from '../render/readback';
import { fitWithin, Scaler } from '../render/Scaler';
import { Thumbnailer } from '../render/Thumbnailer';
import { MAX_ONION_FRAMES, type OnionSettings } from './onion';
import type { ParkedTiles } from './ParkedTiles';

const TINT_BEFORE = [0.92, 0.23, 0.2] as const;
const TINT_AFTER = [0.16, 0.66, 0.32] as const;
const TINT_AMOUNT = 0.85;
/** Longest side of a cached preview frame, px (also capped by the screen). */
const PREVIEW_MAX = 1600;
/** Cache sizes are planned for frame counts in steps of this, so adding a frame rarely resizes. */
const CAPACITY_STEP = 8;

interface Deps {
  gl: WebGL2RenderingContext;
  quad: QuadPass;
  compositor: Compositor;
  tileIO: TileIO;
  parked: ParkedTiles;
  /** The texture of a layer of the active frame. */
  resident: (layerId: string) => Target | undefined;
  docW: number;
  docH: number;
  /** GPU bytes the preview cache may use. */
  cacheBudget: number;
  /** Longest side of the screen, device px: previews needn't be sharper. */
  screenMax: number;
}

/**
 * Renders animation frames: any frame flattened at full size (export), and small cached previews
 * without the background (playback, onion skin, timeline thumbnails).
 *
 * Every frame has a version, bumped whenever its pixels or layers change; cached previews and
 * thumbnails of an older version are redrawn when next needed.
 */
export class Animator {
  private versions = new Map<string, number>();
  private acc: Target | null = null;
  private scratch: Target | null = null;
  private cache = new Map<string, { target: Target; version: number }>();
  private size = { w: 1, h: 1 };
  private capacity = 0;
  private scaler: Scaler | null = null;
  private onion: Target | null = null;
  private onionKey = '';
  private onionProgram: Program;
  private thumbnailer: Thumbnailer | null = null;
  private thumbVersions = new Map<string, number>();

  constructor(private d: Deps) {
    this.onionProgram = new Program(d.gl, QUAD_VS, ONION_FS);
  }

  version(frameId: string): number {
    return this.versions.get(frameId) ?? 0;
  }

  bump(frameId: string) {
    this.versions.set(frameId, this.version(frameId) + 1);
  }

  bumpAll() {
    for (const [id, v] of this.versions) this.versions.set(id, v + 1);
    this.thumbVersions.clear();
    this.onionKey = '';
  }

  /** Drops cached data of frames that no longer exist. */
  prune(alive: ReadonlySet<string>) {
    for (const [id, entry] of this.cache) {
      if (alive.has(id)) continue;
      deleteTarget(this.d.gl, entry.target);
      this.cache.delete(id);
    }
    for (const id of this.versions.keys()) if (!alive.has(id)) this.versions.delete(id);
    for (const id of this.thumbVersions.keys()) if (!alive.has(id)) this.thumbVersions.delete(id);
  }

  /** Whether every frame has a current preview (playback can start). */
  allCached(doc: DocumentState): boolean {
    this.plan(doc.frames.length);
    return doc.frames.every((f) => this.cache.get(f.id)?.version === this.version(f.id));
  }

  /** Previews of the next few uncached frames; true when all are done. */
  cacheSome(doc: DocumentState, budgetMs: number): boolean {
    const start = performance.now();
    for (const f of doc.frames) {
      if (this.cache.get(f.id)?.version === this.version(f.id)) continue;
      this.preview(doc, f.id);
      if (performance.now() - start > budgetMs) return this.allCached(doc);
    }
    return true;
  }

  /** How many frames have a current preview. */
  cachedCount(doc: DocumentState): number {
    return doc.frames.filter((f) => this.cache.get(f.id)?.version === this.version(f.id)).length;
  }

  /**
   * A frame flattened at document size (premultiplied), into a shared target that the next call
   * overwrites. `background`: put under it, or null for transparency.
   */
  render(doc: DocumentState, frameId: string, background: Rgba | null): Target {
    const { gl, compositor, docW, docH } = this.d;
    const acc = (this.acc ??= createTarget(gl, docW, docH));
    compositor.flattenInto([], acc, background);
    const stack = frameStack(doc, frameId);
    if (!stack) return acc;
    const active = frameId === doc.activeFrameId;
    for (const meta of stack.layers) {
      const l = effectiveLayer(meta, stack.groups);
      if (!l.visible || l.opacity <= 0) continue;
      let src = active ? this.d.resident(l.id) : undefined;
      if (!src) {
        const tiles = this.d.parked.raw(l.id);
        if (!tiles || tiles.size === 0) continue;
        src = this.scratch ??= createTarget(gl, docW, docH);
        compositor.clearTarget(src, null);
        this.d.tileIO.write(src, tiles);
      }
      compositor.blendLayer(acc, src, l.opacity, l.blendMode, null);
    }
    gl.disable(gl.SCISSOR_TEST);
    return acc;
  }

  /** A frame's cached preview (no background), redrawn if out of date. */
  preview(doc: DocumentState, frameId: string): Target {
    this.plan(doc.frames.length);
    const version = this.version(frameId);
    let entry = this.cache.get(frameId);
    if (entry?.version === version) return entry.target;
    const full = this.render(doc, frameId, null);
    if (!entry) {
      entry = { target: createTarget(this.d.gl, this.size.w, this.size.h), version };
      this.cache.set(frameId, entry);
    }
    this.scaler!.run(full, entry.target);
    entry.version = version;
    return entry.target;
  }

  /** Preview size, px. */
  get previewSize(): { w: number; h: number } {
    return this.size;
  }

  /**
   * The onion skin for the active frame: its neighbours faded (and tinted) into one
   * preview-sized texture. Null when there's nothing to show.
   */
  onionTexture(doc: DocumentState, s: OnionSettings): Target | null {
    const i = frameIndex(doc);
    const layers: { id: string; opacity: number; tint: readonly number[] | null }[] = [];
    const add = (count: number, dir: -1 | 1, tint: readonly number[]) => {
      // Farthest first, so nearer frames land on top.
      for (let k = count; k >= 1; k--) {
        const f = doc.frames[i + dir * k];
        if (!f) continue;
        const fade = (count - k + 1) / count;
        layers.push({ id: f.id, opacity: s.opacity * fade, tint: s.tint ? tint : null });
      }
    };
    add(Math.min(MAX_ONION_FRAMES, s.before), -1, TINT_BEFORE);
    add(Math.min(MAX_ONION_FRAMES, s.after), 1, TINT_AFTER);
    if (layers.length === 0 || s.opacity <= 0) return null;
    this.plan(doc.frames.length);
    const key = [
      this.size.w,
      ...layers.map((l) => `${l.id}:${this.version(l.id)}:${l.opacity}:${l.tint ? 1 : 0}`),
    ].join('|');
    if (this.onion && key === this.onionKey) return this.onion;

    const { gl, quad } = this.d;
    const sources = layers.map((l) => ({ ...l, tex: this.preview(doc, l.id) }));
    const onion = (this.onion ??= createTarget(gl, this.size.w, this.size.h));
    gl.bindFramebuffer(gl.FRAMEBUFFER, onion.fbo);
    gl.viewport(0, 0, onion.w, onion.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const clip = targetClip(onion);
    gl.activeTexture(gl.TEXTURE0);
    for (const src of sources) {
      gl.bindTexture(gl.TEXTURE_2D, src.tex.tex);
      this.onionProgram.use({
        u_docToClip: clip,
        u_docSize: [onion.w, onion.h],
        u_src: 0,
        u_opacity: src.opacity,
        u_tint: src.tint ?? [0, 0, 0],
        u_tintAmount: src.tint ? TINT_AMOUNT : 0,
      });
      quad.draw();
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.onionKey = key;
    return onion;
  }

  /**
   * Draws one out-of-date timeline thumbnail (PNG data URL, on the background when it's shown).
   * Null when all are current.
   */
  nextThumbnail(
    doc: DocumentState,
    background: readonly number[] | null,
  ): { id: string; url: string } | null {
    const stale = doc.frames.find((f) => this.thumbVersions.get(f.id) !== this.version(f.id));
    if (!stale) return null;
    const version = this.version(stale.id);
    const tex = this.preview(doc, stale.id);
    this.thumbnailer ??= new Thumbnailer(this.d.gl, this.size.w, this.size.h);
    const { data, w, h } = this.thumbnailer.renderPremultiplied(tex);
    if (background) flattenOnto(data, background);
    else unpremultiply(data);
    this.thumbVersions.set(stale.id, version);
    return { id: stale.id, url: imageToDataURL(new ImageData(data, w, h)) };
  }

  /** Bytes of GPU memory held for previews. */
  get cacheBytes(): number {
    return (this.cache.size + (this.onion ? 1 : 0)) * this.size.w * this.size.h * 4;
  }

  dispose() {
    const gl = this.d.gl;
    this.dropCache();
    if (this.acc) deleteTarget(gl, this.acc);
    if (this.scratch) deleteTarget(gl, this.scratch);
    this.acc = this.scratch = null;
    this.onionProgram.dispose();
  }

  /** Sizes the previews so `frames` of them fit the budget; resizing drops the cache. */
  private plan(frames: number) {
    if (this.scaler && frames <= this.capacity) return;
    const capacity = Math.ceil(Math.max(1, frames) / CAPACITY_STEP) * CAPACITY_STEP;
    const { docW, docH, cacheBudget, screenMax } = this.d;
    let { w, h } = fitWithin(docW, docH, Math.min(PREVIEW_MAX, Math.max(256, screenMax)));
    // +1: the onion texture.
    const scale = Math.min(1, Math.sqrt(cacheBudget / ((capacity + 1) * w * h * 4)));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
    this.capacity = capacity;
    if (this.scaler && w === this.size.w && h === this.size.h) return;
    this.dropCache();
    this.size = { w, h };
    this.scaler = new Scaler(this.d.gl, docW, docH, w, h);
  }

  private dropCache() {
    const gl = this.d.gl;
    for (const entry of this.cache.values()) deleteTarget(gl, entry.target);
    this.cache.clear();
    if (this.onion) deleteTarget(gl, this.onion);
    this.onion = null;
    this.onionKey = '';
    this.scaler?.dispose();
    this.scaler = null;
    this.thumbnailer?.dispose();
    this.thumbnailer = null;
    this.thumbVersions.clear();
  }
}
