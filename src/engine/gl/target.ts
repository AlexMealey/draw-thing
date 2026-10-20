/**
 * A texture + framebuffer pair holding premultiplied RGBA8.
 * Convention: texture row y holds document row y (top-down), so scissor rects equal document rects.
 */
export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete (0x${status.toString(16)})`);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target) {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** Integer document-space rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Binds `t` for drawing, optionally restricted to `rect`. */
export function bindTarget(gl: WebGL2RenderingContext, t: Target, rect: Rect | null) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, t.w, t.h);
  if (rect) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, rect.y, rect.w, rect.h);
  } else {
    gl.disable(gl.SCISSOR_TEST);
  }
}
