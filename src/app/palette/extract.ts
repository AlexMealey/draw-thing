import type { Pixels } from '../../files/image';
import { rgbToHex } from '../color';

const MAX_ITERATIONS = 24;

/**
 * The `count` colors that best sum up an image (dominant first): k-means++ in OKLab, so clusters
 * follow perceived differences. Each color is the image's own pixel nearest its cluster's center,
 * which keeps them crisp rather than averaged. Pixels under half opacity are ignored. Deterministic.
 * Pass a downscaled image (~128 px): every distinct color is a point.
 */
export function extractColors(px: Pixels, count: number): string[] {
  // Distinct colors and how often each appears.
  const weights = new Map<number, number>();
  for (let i = 0; i < px.width * px.height * 4; i += 4) {
    if ((px.data[i + 3] ?? 0) < 128) continue;
    const rgb = ((px.data[i] ?? 0) << 16) | ((px.data[i + 1] ?? 0) << 8) | (px.data[i + 2] ?? 0);
    weights.set(rgb, (weights.get(rgb) ?? 0) + 1);
  }
  const n = weights.size;
  const k = Math.min(Math.max(1, Math.round(count)), n);
  if (k === 0) return [];
  const rgbs = [...weights.keys()];
  const w = Float64Array.from(weights.values());
  const lab = new Float64Array(n * 3);
  rgbs.forEach((rgb, i) => lab.set(toOklab(rgb), i * 3));
  const dist = (i: number, c: Float64Array, j: number) => {
    const dl = lab[i * 3]! - c[j * 3]!;
    const da = lab[i * 3 + 1]! - c[j * 3 + 1]!;
    const db = lab[i * 3 + 2]! - c[j * 3 + 2]!;
    return dl * dl + da * da + db * db;
  };

  // k-means++ seeding, starting from the most common color.
  const centers = new Float64Array(k * 3);
  let first = 0;
  for (let i = 1; i < n; i++) if (w[i]! > w[first]!) first = i;
  centers.set(lab.subarray(first * 3, first * 3 + 3), 0);
  const nearest = new Float64Array(n).fill(Infinity);
  const random = mulberry32(0x5eed);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      nearest[i] = Math.min(nearest[i]!, dist(i, centers, c - 1));
      total += nearest[i]! * w[i]!;
    }
    let pick = n - 1;
    let r = random() * total;
    for (let i = 0; i < n; i++) {
      r -= nearest[i]! * w[i]!;
      if (r <= 0 && nearest[i]! > 0) {
        pick = i;
        break;
      }
    }
    centers.set(lab.subarray(pick * 3, pick * 3 + 3), c * 3);
  }

  // Lloyd iterations.
  const assign = new Int32Array(n).fill(-1);
  const sums = new Float64Array(k * 4);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist(i, centers, c);
        if (d < bestD) {
          best = c;
          bestD = d;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved = true;
      }
    }
    if (!moved) break;
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i]!;
      for (let ch = 0; ch < 4; ch++) {
        sums[c * 4 + ch] = sums[c * 4 + ch]! + (ch < 3 ? lab[i * 3 + ch]! : 1) * w[i]!;
      }
    }
    for (let c = 0; c < k; c++) {
      const total = sums[c * 4 + 3]!;
      if (total > 0) for (let ch = 0; ch < 3; ch++) centers[c * 3 + ch] = sums[c * 4 + ch]! / total;
    }
  }

  // Each cluster's size and its member nearest the center.
  const size = new Float64Array(k);
  const rep = new Int32Array(k).fill(-1);
  const repD = new Float64Array(k).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const c = assign[i]!;
    size[c] = size[c]! + w[i]!;
    const d = dist(i, centers, c);
    if (d < repD[c]!) {
      rep[c] = i;
      repD[c] = d;
    }
  }
  const order = [...Array(k).keys()]
    .filter((c) => rep[c]! >= 0)
    .sort((a, b) => size[b]! - size[a]!);
  const out = order.map((c) => {
    const rgb = rgbs[rep[c]!]!;
    return rgbToHex((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  });
  return [...new Set(out)];
}

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0xRRGGBB) → OKLab. */
function toOklab(rgb: number): [number, number, number] {
  const r = toLinear((rgb >> 16) & 255);
  const g = toLinear((rgb >> 8) & 255);
  const b = toLinear(rgb & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Small seeded PRNG: the same image always gives the same palette. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
