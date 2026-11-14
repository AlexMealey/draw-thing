import { Program } from '../gl/program';
import { ADJUST_FS, GAUSS_FS, MOTION_FS, QUAD_VS, REGION_VS } from '../gl/shaders';
import { bindTarget, type Target } from '../gl/target';
import { type QuadPass, targetClip } from '../render/QuadPass';

export type AdjustmentKind = 'hsb' | 'brightnessContrast' | 'gaussian' | 'motion';

/** Every adjustment's settings; each kind uses some of them. */
export interface AdjustmentParams {
  /** Degrees, -180..180. */
  hue: number;
  /** -1..1 (0 = unchanged). */
  saturation: number;
  brightness: number;
  contrast: number;
  /** Gaussian blur radius, document px. */
  radius: number;
  /** Motion blur length, document px. */
  distance: number;
  /** Motion blur direction, degrees (0 = horizontal). */
  angle: number;
}

export const NEUTRAL_ADJUSTMENT: AdjustmentParams = {
  hue: 0,
  saturation: 0,
  brightness: 0,
  contrast: 0,
  radius: 0,
  distance: 0,
  angle: 0,
};

export const MAX_BLUR_RADIUS = 400;
export const MAX_MOTION_DISTANCE = 200;
/** Radius (px) one Gaussian pass covers directly; bigger radii blur a smaller copy of the layer. */
const LEVEL_RADIUS = 24;
const MOTION_SAMPLES = 64;

export interface BlurPlan {
  /** How many times the layer is halved before blurring (0 = full size). */
  level: number;
  /** In pixels of that level. */
  sigma: number;
  taps: number;
}

/**
 * How to blur by `radius` px. Spacing taps out over a wide radius shows the image repeated, so
 * big radii instead halve the layer until the radius is at most LEVEL_RADIUS there, blur that
 * with every texel sampled, and scale the result back up (smooth, since it's blurred).
 */
export function blurPlan(radius: number): BlurPlan {
  const r = Math.min(MAX_BLUR_RADIUS, Math.max(0, radius));
  let level = 0;
  while (r / 2 ** level > LEVEL_RADIUS) level++;
  const scaled = r / 2 ** level;
  return { level, sigma: Math.max(0.5, scaled / 3), taps: Math.max(1, Math.ceil(scaled)) };
}

/** A region at the origin of a target: a downsampled level of the image being blurred. */
interface Region {
  t: Target;
  w: number;
  h: number;
}

/** Whether these settings leave the layer as it is. */
export function isNeutral(kind: AdjustmentKind, p: AdjustmentParams): boolean {
  switch (kind) {
    case 'hsb':
      return p.hue === 0 && p.saturation === 0 && p.brightness === 0;
    case 'brightnessContrast':
      return p.brightness === 0 && p.contrast === 0;
    case 'gaussian':
      return p.radius < 0.5;
    case 'motion':
      return p.distance < 1;
  }
}

/** Contrast factor for an amount in [-1, 1] (the color panel's contrast uses the same curve). */
export function contrastFactor(amount: number): number {
  const k = Math.min(1, Math.max(-1, amount));
  return k >= 0 ? 1 + 3 * k : 1 + k;
}

/** Layer filters (Adjustments): full-layer GPU passes from one target into another. */
export class Filters {
  private adjust: Program;
  private gauss: Program;
  private motion: Program;

  constructor(
    private gl: WebGL2RenderingContext,
    private quad: QuadPass,
  ) {
    this.adjust = new Program(gl, QUAD_VS, ADJUST_FS);
    this.gauss = new Program(gl, REGION_VS, GAUSS_FS);
    this.motion = new Program(gl, QUAD_VS, MOTION_FS);
  }

  /**
   * Filters `src` into `out`. `temp` (same size, contents discarded) holds intermediate passes
   * and is left cleared. `keepAlpha` stops blurs from spreading an alpha-locked layer.
   */
  run(
    kind: AdjustmentKind,
    p: AdjustmentParams,
    src: Target,
    out: Target,
    temp: Target,
    keepAlpha: boolean,
  ) {
    const gl = this.gl;
    const base = { u_docToClip: targetClip(src), u_docSize: [src.w, src.h], u_src: 0 };
    // Intermediate passes never keep alpha; the last one reads the original's (unit 1).
    const mid = { ...base, u_keepAlpha: false, u_alpha: 0 };
    const last = { ...base, u_keepAlpha: keepAlpha, u_alpha: keepAlpha ? 1 : 0 };
    const alpha = keepAlpha ? src : undefined;
    gl.disable(gl.BLEND);
    switch (kind) {
      case 'hsb':
      case 'brightnessContrast':
        this.pass(src, out, this.adjust, {
          ...base,
          u_hue: kind === 'hsb' ? p.hue / 360 : 0,
          u_saturation: kind === 'hsb' ? p.saturation : 0,
          u_brightness: p.brightness,
          u_contrast: kind === 'brightnessContrast' ? contrastFactor(p.contrast) : 1,
        });
        return;
      case 'gaussian':
        this.gaussian(blurPlan(p.radius), src, out, temp, alpha);
        break;
      case 'motion': {
        const distance = Math.min(MAX_MOTION_DISTANCE, Math.max(0, p.distance));
        const a = (p.angle * Math.PI) / 180;
        const span = (len: number) => [(Math.cos(a) * len) / src.w, (Math.sin(a) * len) / src.h];
        const line = { u_span: span(distance), u_samples: MOTION_SAMPLES };
        const gap = distance / MOTION_SAMPLES;
        if (gap <= 1) {
          this.pass(src, out, this.motion, { ...last, ...line }, alpha);
        } else {
          // Samples more than a pixel apart would show as copies: a short second pass smooths them.
          this.pass(src, temp, this.motion, { ...mid, ...line });
          const smooth = { u_span: span(gap), u_samples: Math.ceil(gap) + 1 };
          this.pass(temp, out, this.motion, { ...last, ...smooth }, alpha);
        }
        break;
      }
    }
    this.clear(temp);
  }

  /**
   * Levels live at the origin of `temp` and `out` (no extra GPU memory), alternating so that the
   * smallest one, and its blur, end up in `temp`; the last pass scales it up into all of `out`.
   */
  private gaussian(plan: BlurPlan, src: Target, out: Target, temp: Target, alpha?: Target) {
    const whole = (t: Target): Region => ({ t, w: src.w, h: src.h });
    const blur = { sigma: plan.sigma, taps: plan.taps };
    if (plan.level === 0) {
      this.region(whole(src), whole(temp), { ...blur, dir: [1, 0] });
      this.region(whole(temp), whole(out), { ...blur, dir: [0, 1] }, alpha);
      return;
    }
    let from = whole(src);
    for (let i = 1; i <= plan.level; i++) {
      const to: Region = {
        t: (plan.level - i) % 2 === 0 ? temp : out,
        w: Math.ceil(from.w / 2),
        h: Math.ceil(from.h / 2),
      };
      this.region(from, to, { sigma: 1, taps: 0, dir: [0, 0] }); // bilinear: averages 2×2
      from = to;
    }
    const swap: Region = { ...from, t: out };
    this.region(from, swap, { ...blur, dir: [1, 0] });
    this.region(swap, from, { ...blur, dir: [0, 1] });
    this.region(from, whole(out), { sigma: 1, taps: 0, dir: [0, 0] }, alpha);
  }

  private region(
    from: Region,
    to: Region,
    blur: { sigma: number; taps: number; dir: [number, number] },
    alpha?: Target,
  ) {
    const gl = this.gl;
    const { t: src } = from;
    bindTarget(gl, to.t, { x: 0, y: 0, w: to.w, h: to.h });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    if (alpha) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, alpha.tex);
      gl.activeTexture(gl.TEXTURE0);
    }
    this.gauss.use({
      u_dstRegion: [to.w / to.t.w, to.h / to.t.h],
      u_srcRegion: [from.w / src.w, from.h / src.h],
      u_uvMin: [0.5 / src.w, 0.5 / src.h],
      u_uvMax: [(from.w - 0.5) / src.w, (from.h - 0.5) / src.h],
      u_step: [blur.dir[0] / src.w, blur.dir[1] / src.h],
      u_sigma: blur.sigma,
      u_taps: blur.taps,
      u_src: 0,
      u_keepAlpha: !!alpha,
      u_alpha: 1,
    });
    this.quad.draw();
  }

  dispose() {
    for (const p of [this.adjust, this.gauss, this.motion]) p.dispose();
  }

  private pass(
    src: Target,
    dst: Target,
    program: Program,
    uniforms: Parameters<Program['use']>[0],
    second?: Target,
  ) {
    const gl = this.gl;
    bindTarget(gl, dst, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    if (second) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, second.tex);
      gl.activeTexture(gl.TEXTURE0);
    }
    program.use(uniforms);
    this.quad.draw();
  }

  /** The temp target is someone else's buffer (the stroke buffer): give it back empty. */
  private clear(temp: Target) {
    const gl = this.gl;
    bindTarget(gl, temp, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
