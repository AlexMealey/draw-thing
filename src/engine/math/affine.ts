/** 2D affine transform in canvas convention: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Point {
  x: number;
  y: number;
}

export const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
export const translate = (x: number, y: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const scale = (s: number): Affine => ({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 });

export function rotate(rad: number): Affine {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** `m ∘ n`: applies `n` first, then `m`. */
export function multiply(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) throw new Error('Cannot invert a singular transform');
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) };
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** `T(p) · n · T(−p)`: applies `n` about pivot `p` (e.g. zoom around the cursor). */
export function about(n: Affine, px: number, py: number): Affine {
  return multiply(translate(px, py), multiply(n, translate(-px, -py)));
}

/** Column-major mat3 for a GLSL `mat3` uniform. */
export function toMat3(m: Affine, out: Float32Array = new Float32Array(9)): Float32Array {
  out[0] = m.a;
  out[1] = m.b;
  out[2] = 0;
  out[3] = m.c;
  out[4] = m.d;
  out[5] = 0;
  out[6] = m.e;
  out[7] = m.f;
  out[8] = 1;
  return out;
}

/**
 * The similarity transform (uniform scale + rotation + translation) taking p1→q1 and p2→q2:
 * exactly what two fingers do to the canvas during a pinch.
 */
export function similarityFromPairs(p1: Point, p2: Point, q1: Point, q2: Point): Affine {
  const ux = p2.x - p1.x;
  const uy = p2.y - p1.y;
  const vx = q2.x - q1.x;
  const vy = q2.y - q1.y;
  const uu = ux * ux + uy * uy;
  if (uu === 0) return translate(q1.x - p1.x, q1.y - p1.y);
  // Complex division v/u gives s·(cosθ + i·sinθ).
  const a = (vx * ux + vy * uy) / uu;
  const b = (vy * ux - vx * uy) / uu;
  return { a, b, c: -b, d: a, e: q1.x - (a * p1.x - b * p1.y), f: q1.y - (b * p1.x + a * p1.y) };
}
