import type { Rect, Target } from '../gl/target';

/** Premultiplied RGBA8 pixels of a target (or a rect of it), rows top to bottom (no flip). */
export function readPremultiplied(
  gl: WebGL2RenderingContext,
  t: Target,
  r: Rect = { x: 0, y: 0, w: t.w, h: t.h },
): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fbo);
  gl.readPixels(r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  return data;
}

/** Reads an RGBA8 target into straight-alpha ImageData (texture row 0 = top row, no flip). */
export function readImage(gl: WebGL2RenderingContext, t: Target): ImageData {
  const data = readPremultiplied(gl, t);
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

/** Premultiplied pixels over an opaque color (0–255 RGB), in place: the result is opaque. */
export function flattenOnto(px: Uint8ClampedArray | Uint8Array, rgb: readonly number[]) {
  const [r = 255, g = 255, b = 255] = rgb;
  for (let i = 0; i < px.length; i += 4) {
    const k = 1 - (px[i + 3] ?? 0) / 255;
    if (k === 0) continue;
    px[i] = Math.round((px[i] ?? 0) + r * k);
    px[i + 1] = Math.round((px[i + 1] ?? 0) + g * k);
    px[i + 2] = Math.round((px[i + 2] ?? 0) + b * k);
    px[i + 3] = 255;
  }
}

/** Tight bounds of the non-transparent pixels, or null if there are none. */
export function contentBounds(
  px: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): Rect | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (px[row + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Copies a rect out of a w-wide RGBA buffer. */
export function crop(
  px: Uint8ClampedArray<ArrayBuffer>,
  w: number,
  r: Rect,
): Uint8ClampedArray<ArrayBuffer> {
  if (r.x === 0 && r.w === w && r.y === 0 && px.length === r.w * r.h * 4) return px;
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * w + r.x) * 4;
    out.set(px.subarray(src, src + r.w * 4), y * r.w * 4);
  }
  return out;
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
