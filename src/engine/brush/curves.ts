/** A pressure response curve as CSS-style cubic-bezier(x1, y1, x2, y2) from (0,0) to (1,1). */
export type Curve = readonly [number, number, number, number];

export const LINEAR: Curve = [0.25, 0.25, 0.75, 0.75];

const LUT_SIZE = 256;

/** Bakes a curve into a lookup table indexed by pressure, so per-dab evaluation is O(1). */
export function bakeCurve([x1, y1, x2, y2]: Curve): Float32Array {
  const bezier = (t: number, p1: number, p2: number) => {
    const mt = 1 - t;
    return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
  };
  const lut = new Float32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const x = i / (LUT_SIZE - 1);
    // x(t) is monotonic for x1, x2 in [0, 1]: binary search for the t that gives this x.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (bezier(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    lut[i] = Math.min(1, Math.max(0, bezier((lo + hi) / 2, y1, y2)));
  }
  return lut;
}

export function evalCurve(lut: Float32Array, p: number): number {
  const f = Math.min(1, Math.max(0, p)) * (lut.length - 1);
  const i = Math.floor(f);
  const a = lut[i] ?? 0;
  const b = lut[Math.min(i + 1, lut.length - 1)] ?? a;
  return a + (b - a) * (f - i);
}
