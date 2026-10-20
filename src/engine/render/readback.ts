import type { Target } from '../gl/target';

/** Reads an RGBA8 target into straight-alpha ImageData (texture row 0 = top row, no flip). */
export function readImage(gl: WebGL2RenderingContext, t: Target): ImageData {
  const data = new Uint8ClampedArray(t.w * t.h * 4);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
  gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  unpremultiply(data);
  return new ImageData(data, t.w, t.h);
}

export function unpremultiply(px: Uint8ClampedArray | Uint8Array) {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] ?? 0;
    if (a === 0 || a === 255) continue;
    const k = 255 / a;
    px[i] = Math.min(255, Math.round((px[i] ?? 0) * k));
    px[i + 1] = Math.min(255, Math.round((px[i + 1] ?? 0) * k));
    px[i + 2] = Math.min(255, Math.round((px[i + 2] ?? 0) * k));
  }
}

let scratch: HTMLCanvasElement | null = null;

/** PNG data URL of an image; fine for thumbnails and previews (small images only). */
export function imageToDataURL(img: ImageData): string {
  scratch ??= document.createElement('canvas');
  scratch.width = img.width;
  scratch.height = img.height;
  scratch.getContext('2d')?.putImageData(img, 0, 0);
  return scratch.toDataURL('image/png');
}
