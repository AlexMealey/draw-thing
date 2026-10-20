import type { Rect } from '../gl/target';

/** Growable instance buffer of dabs (x, y, radius, alpha) plus their bounding box. */
export class DabBatch {
  data = new Float32Array(4 * 1024);
  count = 0;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  push(x: number, y: number, radius: number, alpha: number) {
    if ((this.count + 1) * 4 > this.data.length) {
      const grown = new Float32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const i = this.count++ * 4;
    this.data[i] = x;
    this.data[i + 1] = y;
    this.data[i + 2] = radius;
    this.data[i + 3] = alpha;
    const r = radius + 1; // antialiased edge
    this.minX = Math.min(this.minX, x - r);
    this.minY = Math.min(this.minY, y - r);
    this.maxX = Math.max(this.maxX, x + r);
    this.maxY = Math.max(this.maxY, y + r);
  }

  clear() {
    this.count = 0;
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
  }

  /** Integer pixel bounds, or null when empty. */
  bounds(): Rect | null {
    if (this.count === 0) return null;
    const x = Math.floor(this.minX);
    const y = Math.floor(this.minY);
    return { x, y, w: Math.ceil(this.maxX) - x, h: Math.ceil(this.maxY) - y };
  }
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(w, r.x + r.w);
  const y1 = Math.min(h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
