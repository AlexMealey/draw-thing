/** Base grain texture size; `BrushPreset.grain.scale` stretches it in document px. */
export const GRAIN_SIZE = 256;

/**
 * Procedural, seamlessly tiling paper grain: a few octaves of periodic value noise, weighted
 * toward fine "tooth", with a contrast curve so low-flow strokes catch only the peaks.
 */
export function generatePaperGrain(size = GRAIN_SIZE, seed = 1337): Uint8Array {
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const octaves: [cells: number, weight: number][] = [
    [8, 0.12],
    [16, 0.18],
    [32, 0.25],
    [64, 0.27],
    [128, 0.18],
  ];
  const acc = new Float32Array(size * size);
  for (const [cells, weight] of octaves) {
    const lattice = Float32Array.from({ length: cells * cells }, rand);
    const at = (cx: number, cy: number) => lattice[(cy % cells) * cells + (cx % cells)] ?? 0;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        acc[y * size + x] = (acc[y * size + x] ?? 0) + (top + (bottom - top) * ty) * weight;
      }
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of acc) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const out = new Uint8Array(size * size);
  for (let i = 0; i < acc.length; i++) {
    const n = ((acc[i] ?? 0) - min) / (max - min || 1);
    out[i] = Math.round(smooth(Math.min(1, Math.max(0, (n - 0.2) / 0.6))) * 255);
  }
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
