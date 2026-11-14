import { createTarget, deleteTarget, type Target } from '../gl/target';

/**
 * Resizes a texture to a fixed output size with blits. Smooth downscaling goes in 2× linear steps,
 * which averages properly instead of aliasing like one big minification would; upscaling is one
 * linear blit. `smooth: false` is a single nearest-neighbour blit (hard pixels, for pixel art).
 * The intermediate targets are allocated once.
 */
export class Scaler {
  private chain: Target[] = [];

  constructor(
    private gl: WebGL2RenderingContext,
    srcW: number,
    srcH: number,
    readonly outW: number,
    readonly outH: number,
    readonly smooth = true,
  ) {
    if (!smooth) return;
    let w = srcW;
    let h = srcH;
    while (w > outW * 2 || h > outH * 2) {
      w = Math.max(outW, Math.ceil(w / 2));
      h = Math.max(outH, Math.ceil(h / 2));
      this.chain.push(createTarget(gl, w, h));
    }
  }

  /** Draws `src` resized into `dst`, which must be outW × outH. */
  run(src: Target, dst: Target) {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    const filter = this.smooth ? gl.LINEAR : gl.NEAREST;
    let prev = src;
    for (const t of [...this.chain, dst]) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
      gl.blitFramebuffer(0, 0, prev.w, prev.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, filter);
      prev = t;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    for (const t of this.chain) deleteTarget(this.gl, t);
    this.chain = [];
  }
}

/** The size that fits `w × h` inside `max × max`, never enlarging. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}
