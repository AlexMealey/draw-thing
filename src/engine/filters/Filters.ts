import { Program } from '../gl/program';
import { ADJUST_FS, GAUSS_FS, MOTION_FS, QUAD_VS } from '../gl/shaders';
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

export const MAX_BLUR_RADIUS = 100;
export const MAX_MOTION_DISTANCE = 200;
/** Gaussian taps per side; bigger radii space them out. */
const MAX_TAPS = 48;
const MOTION_SAMPLES = 64;

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
    this.gauss = new Program(gl, QUAD_VS, GAUSS_FS);
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
      case 'gaussian': {
        // The kernel reaches 3σ = radius; taps are spread out when that needs more than MAX_TAPS.
        const radius = Math.min(MAX_BLUR_RADIUS, Math.max(0, p.radius));
        const stride = Math.max(1, radius / MAX_TAPS);
        const blur = {
          u_sigma: Math.max(0.5, radius / 3 / stride),
          u_taps: Math.max(1, Math.ceil(radius / stride)),
        };
        this.pass(src, temp, this.gauss, { ...mid, ...blur, u_step: [stride / src.w, 0] });
        this.pass(temp, out, this.gauss, { ...last, ...blur, u_step: [0, stride / src.h] }, alpha);
        break;
      }
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
