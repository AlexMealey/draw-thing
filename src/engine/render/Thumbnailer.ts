import { createTarget, deleteTarget, type Target } from '../gl/target';
import { imageToDataURL, readImage } from './readback';

/** Longest side of a layer thumbnail, px. */
export const THUMB_SIZE = 96;

/**
 * Layer thumbnails by repeated 2× linear downsampling (blits), which averages properly instead of
 * aliasing like a single big minification would. The chain is allocated once per document size.
 */
export class Thumbnailer {
  private chain: Target[] = [];

  constructor(
    private gl: WebGL2RenderingContext,
    docW: number,
    docH: number,
  ) {
    const scale = THUMB_SIZE / Math.max(docW, docH);
    const tw = Math.max(1, Math.round(docW * scale));
    const th = Math.max(1, Math.round(docH * scale));
    let w = docW;
    let h = docH;
    while (w > tw * 2 || h > th * 2) {
      w = Math.max(tw, Math.ceil(w / 2));
      h = Math.max(th, Math.ceil(h / 2));
      this.chain.push(createTarget(gl, w, h));
    }
    this.chain.push(createTarget(gl, tw, th));
  }

  render(src: Target): string {
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    let prev = src;
    for (const t of this.chain) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prev.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
      gl.blitFramebuffer(0, 0, prev.w, prev.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      prev = t;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return imageToDataURL(readImage(gl, prev));
  }

  dispose() {
    for (const t of this.chain) deleteTarget(this.gl, t);
  }
}
