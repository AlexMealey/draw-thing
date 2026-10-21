import { type BrushPreset, presetById } from '../engine/brush/presets';
import type { ToolSettings } from '../engine/brush/tool';
import type { RecordedStroke } from '../engine/input/recording';

/**
 * Deterministic synthetic strokes, for benchmarks and visual regression scenes. They go through
 * the same pipeline as recorded ones; only the input is made up. Pure: no DOM, no Math.random.
 */

/** A digitizer sample: position (doc px), pressure, and optionally the pen's angles (radians). */
export interface PenPoint {
  x: number;
  y: number;
  p: number;
  altitude?: number;
  azimuth?: number;
}

/** Apple Pencil's report rate. */
export const PEN_HZ = 240;

export function tool(presetId: string, patch: Partial<Omit<ToolSettings, 'preset'>> = {}) {
  return toolWith(presetById(presetId), patch);
}

export function toolWith(
  preset: BrushPreset,
  patch: Partial<Omit<ToolSettings, 'preset'>> = {},
): ToolSettings {
  return {
    preset,
    size: preset.size.default,
    opacity: 1,
    smoothing: preset.stabilization,
    color: '#1c1c1e',
    eraser: false,
    ...patch,
  };
}

/** A pen stroke through `points`, one sample per point at `hz`. */
export function penStroke(
  points: readonly PenPoint[],
  settings: ToolSettings,
  opts: { hz?: number; eraser?: boolean; end?: 'commit' | 'cancel'; pointerType?: string } = {},
): RecordedStroke {
  const dt = 1000 / (opts.hz ?? PEN_HZ);
  const samples: number[] = [];
  points.forEach((pt, i) => {
    samples.push(pt.x, pt.y, pt.p, pt.altitude ?? Math.PI / 2, pt.azimuth ?? 0, i * dt);
  });
  return {
    tool: settings,
    pointerType: opts.pointerType ?? 'pen',
    eraser: opts.eraser ?? false,
    samples,
    end: opts.end ?? 'commit',
  };
}

/** `n + 1` points along a path, u = 0..1, with a pressure (and tilt) profile. */
export function along(
  n: number,
  path: (u: number) => [number, number],
  pressure: (u: number) => number = () => 1,
  tilt?: (u: number) => { altitude: number; azimuth: number },
): PenPoint[] {
  const out: PenPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const [x, y] = path(u);
    out.push({ x, y, p: clamp01(pressure(u)), ...tilt?.(u) });
  }
  return out;
}

export const line =
  (x0: number, y0: number, x1: number, y1: number) =>
  (u: number): [number, number] => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];

/** Pressure that rises, holds, and tapers off like a natural hand stroke. */
export const swell = (u: number) => Math.sin(Math.PI * u) ** 0.6;

/**
 * A fast hand-like scribble: smooth wandering curves across the area, at the pen rate.
 * `speed` in px per second.
 */
export function scribble(
  area: { x: number; y: number; w: number; h: number },
  seconds: number,
  seed: number,
  speed = 2500,
): PenPoint[] {
  const random = mulberry32(seed);
  // A sum of a few sines per axis: never leaves the area, never repeats exactly.
  const waves = Array.from({ length: 3 }, () => ({
    fx: 0.3 + random() * 1.2,
    fy: 0.3 + random() * 1.2,
    px: random() * Math.PI * 2,
    py: random() * Math.PI * 2,
  }));
  const n = Math.max(2, Math.round(seconds * PEN_HZ));
  const out: PenPoint[] = [];
  // Advance the curve parameter so the pen moves at roughly `speed` px/s.
  const scale = Math.max(area.w, area.h);
  const step = speed / PEN_HZ / scale;
  let s = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (const w of waves) {
      x += Math.sin(s * w.fx * 6 + w.px);
      y += Math.sin(s * w.fy * 6 + w.py);
    }
    out.push({
      x: area.x + area.w * (0.5 + x / (2 * waves.length)),
      y: area.y + area.h * (0.5 + y / (2 * waves.length)),
      p: clamp01(0.55 + 0.4 * Math.sin(i / 37 + seed)),
    });
    s += step;
  }
  return out;
}

/** A back-and-forth stroke that covers the whole area with a brush of `diameter`. */
export function zigzag(
  area: { x: number; y: number; w: number; h: number },
  diameter: number,
): PenPoint[] {
  const out: PenPoint[] = [];
  const rows = Math.max(1, Math.ceil(area.h / (diameter * 0.7)));
  for (let r = 0; r <= rows; r++) {
    const y = area.y + (area.h * r) / rows;
    const [a, b] = r % 2 === 0 ? [area.x, area.x + area.w] : [area.x + area.w, area.x];
    const steps = Math.max(2, Math.ceil(area.w / (diameter / 4)));
    for (let i = 0; i <= steps; i++) out.push({ x: a + ((b - a) * i) / steps, y, p: 1 });
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Small, fast, well-distributed PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
