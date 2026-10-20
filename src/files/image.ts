import { isEmpty, type TileGrid, tileRect } from '../engine/history/tiles';

/** Straight-alpha RGBA pixels, rows top to bottom (ImageData, or the same shape). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Encodes pixels as PNG or JPEG. JPEG has no alpha: callers flatten onto a background first. */
export async function encodeImage(
  img: ImageData,
  type: 'image/png' | 'image/jpeg',
  quality?: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(img.width, img.height);
    canvas.getContext('2d')?.putImageData(img, 0, 0);
    return canvas.convertToBlob({ type, quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')?.putImageData(img, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality),
  );
}

/** Decodes a PNG/JPEG/WebP file, with its color profile and EXIF orientation applied. */
export function decodeImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
}

/**
 * Draws an image into a w×h canvas, scaled down to fit if needed and centered, and returns the
 * pixels. Used to place an imported photo on a layer.
 */
export function fitImage(img: ImageBitmap, w: number, h: number): ImageData {
  const scale = Math.min(1, w / img.width, h / img.height);
  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
  return ctx.getImageData(0, 0, w, h);
}

/** Longest side of gallery thumbnails, px. */
const THUMB_SIZE = 512;

/** A gallery thumbnail (PNG) of an image or of raw pixels. */
export async function makeThumbnail(src: ImageBitmap | Pixels): Promise<Blob> {
  const bitmap =
    src instanceof ImageBitmap
      ? src
      : await createImageBitmap(
          new ImageData(new Uint8ClampedArray(src.data), src.width, src.height),
        );
  const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap !== src) bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), 'image/png'),
  );
}

/** Largest canvas side an imported image keeps; bigger images are scaled down to it. */
export function importSize(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / w, max / h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * Cuts straight-alpha pixels placed at (left, top) in a document into its 256² tiles, as
 * premultiplied RGBA8 (the layer texture format). Fully transparent tiles are left out.
 */
export function pixelsToTiles(
  px: Pixels,
  grid: TileGrid,
  left = 0,
  top = 0,
): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const x0 = Math.max(0, left);
  const y0 = Math.max(0, top);
  const x1 = Math.min(grid.w, left + px.width);
  const y1 = Math.min(grid.h, top + px.height);
  if (x1 <= x0 || y1 <= y0) return out;
  for (let key = 0; key < grid.cols * grid.rows; key++) {
    const r = tileRect(grid, key);
    const ix0 = Math.max(r.x, x0);
    const iy0 = Math.max(r.y, y0);
    const ix1 = Math.min(r.x + r.w, x1);
    const iy1 = Math.min(r.y + r.h, y1);
    if (ix1 <= ix0 || iy1 <= iy0) continue;
    const tile = new Uint8Array(r.w * r.h * 4);
    for (let y = iy0; y < iy1; y++) {
      let src = ((y - top) * px.width + (ix0 - left)) * 4;
      let dst = ((y - r.y) * r.w + (ix0 - r.x)) * 4;
      for (let x = ix0; x < ix1; x++, src += 4, dst += 4) {
        const a = px.data[src + 3] ?? 0;
        if (a === 0) continue;
        tile[dst] = Math.round(((px.data[src] ?? 0) * a) / 255);
        tile[dst + 1] = Math.round(((px.data[src + 1] ?? 0) * a) / 255);
        tile[dst + 2] = Math.round(((px.data[src + 2] ?? 0) * a) / 255);
        tile[dst + 3] = a;
      }
    }
    if (!isEmpty(tile)) out.set(key, tile);
  }
  return out;
}
