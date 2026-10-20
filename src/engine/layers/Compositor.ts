import type { BlendMode } from '../../state/documentStore';
import { Program } from '../gl/program';
import { BLEND_FS, COPY_FS, QUAD_VS } from '../gl/shaders';
import { bindTarget, createTarget, deleteTarget, type Rect, type Target } from '../gl/target';
import { type QuadPass, targetClip } from '../render/QuadPass';

export interface GpuLayer {
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  target: Target;
}

/** How a stroke buffer combines with its layer. 'inside' = alpha lock (source-atop). */
export type StrokeMode = 'paint' | 'erase' | 'inside';

export interface LiveStroke {
  target: Target;
  opacity: number;
  mode: StrokeMode;
}

/** Premultiplied RGBA. */
export type Rgba = readonly [number, number, number, number];

const TRANSPARENT: Rgba = [0, 0, 0, 0];

const MODE_ID: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  'color-dodge': 6,
  'color-burn': 7,
  add: 8,
};

const shows = (l: GpuLayer) => l.visible && l.opacity > 0;

/**
 * Composites the layer stack in document space (ROADMAP §4.2). Everything except the layer being
 * painted is cached: `below` (background + layers under the active one) and `above` (layers over
 * it, pre-merged while they're all 'normal', since source-over is associative). A frame during a
 * stroke therefore costs a few scissored passes over the dirty rect, whatever the layer count.
 */
export class Compositor {
  private below: Target;
  private above: Target;
  private out: Target;
  /** Active layer + live stroke; the layer itself is untouched until commit. */
  private preview: Target;
  /** Backdrop snapshot for programmable blend modes. */
  private scratch: Target;
  private copy: Program;
  private blend: Program;
  private clip: Float32Array;
  private belowValid = false;
  private aboveValid = false;
  private activeIndex = -1;

  constructor(
    private gl: WebGL2RenderingContext,
    private quad: QuadPass,
    w: number,
    h: number,
  ) {
    this.below = createTarget(gl, w, h);
    this.above = createTarget(gl, w, h);
    this.out = createTarget(gl, w, h);
    this.preview = createTarget(gl, w, h);
    this.scratch = createTarget(gl, w, h);
    this.copy = new Program(gl, QUAD_VS, COPY_FS);
    this.blend = new Program(gl, QUAD_VS, BLEND_FS);
    this.clip = targetClip({ w, h });
  }

  /** The composited document from the last render(). */
  get output(): Target {
    return this.out;
  }

  /** Call when anything other than the active layer's pixels changed (metadata, order, others). */
  invalidate() {
    this.belowValid = this.aboveValid = false;
  }

  /** Recomposites `out` within `dirty` (or entirely when null or when caches were rebuilt). */
  render(
    layers: readonly GpuLayer[],
    active: number,
    background: Rgba | null,
    stroke: LiveStroke | null,
    dirty: Rect | null,
  ): Target {
    if (active !== this.activeIndex) {
      this.activeIndex = active;
      this.invalidate();
    }
    const above = layers.slice(active + 1).filter(shows);
    const aboveCacheable = above.every((l) => l.blendMode === 'normal');

    if (!this.belowValid || (aboveCacheable && !this.aboveValid)) dirty = null;
    if (!this.belowValid) {
      this.fill(this.below, background ?? TRANSPARENT, null);
      for (const l of layers.slice(0, Math.max(0, active))) {
        if (shows(l)) this.blendLayer(this.below, l.target, l.opacity, l.blendMode, null);
      }
      this.belowValid = true;
    }
    if (aboveCacheable && !this.aboveValid) {
      this.fill(this.above, TRANSPARENT, null);
      for (const l of above) this.blendLayer(this.above, l.target, l.opacity, 'normal', null);
      this.aboveValid = true;
    }

    this.copyRect(this.below, this.out, dirty);
    const a = layers[active];
    if (a && shows(a)) {
      const src = stroke ? this.mergeStroke(a.target, stroke, dirty) : a.target;
      this.blendLayer(this.out, src, a.opacity, a.blendMode, dirty);
    }
    if (aboveCacheable) {
      if (above.length > 0) this.blendLayer(this.out, this.above, 1, 'normal', dirty);
    } else {
      for (const l of above) this.blendLayer(this.out, l.target, l.opacity, l.blendMode, dirty);
    }
    this.gl.disable(this.gl.SCISSOR_TEST);
    return this.out;
  }

  /** Composites `src` onto `dst` with a layer blend mode (also used by Merge Down). */
  blendLayer(dst: Target, src: Target, opacity: number, mode: BlendMode, rect: Rect | null) {
    const gl = this.gl;
    if (mode === 'normal') {
      // Fixed-function premultiplied source-over == Canvas2D 'source-over'.
      this.bind(dst, rect);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawCopy(src, opacity);
      gl.disable(gl.BLEND);
      return;
    }
    // Programmable modes read the backdrop: snapshot just the rect, then overwrite it.
    this.copyRect(dst, this.scratch, rect);
    this.bind(dst, rect);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.scratch.tex);
    this.blend.use({
      u_docToClip: this.clip,
      u_docSize: [dst.w, dst.h],
      u_src: 0,
      u_dst: 1,
      u_opacity: opacity,
      u_mode: MODE_ID[mode],
    });
    this.quad.draw();
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Merges a finished stroke into its layer. */
  commitStroke(layer: Target, stroke: LiveStroke, rect: Rect) {
    this.bind(layer, rect);
    this.drawStroke(stroke);
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  /** Flattens visible layers into `dst` (Flatten command, and export later). */
  flattenInto(layers: readonly GpuLayer[], dst: Target, background: Rgba | null) {
    this.fill(dst, background ?? TRANSPARENT, null);
    for (const l of layers)
      if (shows(l)) this.blendLayer(dst, l.target, l.opacity, l.blendMode, null);
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  clearTarget(t: Target, rect: Rect | null) {
    this.fill(t, TRANSPARENT, rect);
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  dispose() {
    for (const t of [this.below, this.above, this.out, this.preview, this.scratch]) {
      deleteTarget(this.gl, t);
    }
    this.copy.dispose();
    this.blend.dispose();
  }

  private mergeStroke(layer: Target, stroke: LiveStroke, rect: Rect | null): Target {
    this.copyRect(layer, this.preview, rect);
    this.bind(this.preview, rect);
    this.drawStroke(stroke);
    return this.preview;
  }

  /** Draws the stroke buffer at its opacity into the bound target. */
  private drawStroke(stroke: LiveStroke) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    if (stroke.mode === 'erase')
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); // destination-out
    else if (stroke.mode === 'inside')
      gl.blendFunc(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // source-atop
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // source-over
    this.drawCopy(stroke.target, stroke.opacity);
    gl.disable(gl.BLEND);
  }

  private drawCopy(src: Target, opacity: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    this.copy.use({
      u_docToClip: this.clip,
      u_docSize: [src.w, src.h],
      u_src: 0,
      u_opacity: opacity,
    });
    this.quad.draw();
  }

  private copyRect(src: Target, dst: Target, rect: Rect | null) {
    const gl = this.gl;
    const r = rect ?? { x: 0, y: 0, w: src.w, h: src.h };
    gl.disable(gl.SCISSOR_TEST); // blits are clipped by the scissor test
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(
      r.x,
      r.y,
      r.x + r.w,
      r.y + r.h,
      r.x,
      r.y,
      r.x + r.w,
      r.y + r.h,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
  }

  private fill(t: Target, rgba: Rgba, rect: Rect | null) {
    this.bind(t, rect);
    this.gl.clearColor(rgba[0], rgba[1], rgba[2], rgba[3]);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  private bind(t: Target, rect: Rect | null) {
    bindTarget(this.gl, t, rect);
  }
}
