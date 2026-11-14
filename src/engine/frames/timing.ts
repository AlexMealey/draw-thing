/**
 * Animation timing. A frame stays on screen for `hold` ticks of 1/fps seconds each, so at 12 fps
 * a frame "on twos" (hold 2) shows for 1/6 s. Pure functions: shared by playback and export.
 */

/** Total ticks of one pass through the animation. */
export function totalTicks(holds: readonly number[]): number {
  return holds.reduce((n, h) => n + h, 0);
}

/** The frame showing at a tick (wrapping around), or -1 for no frames. */
export function frameAtTick(holds: readonly number[], tick: number): number {
  const total = totalTicks(holds);
  if (total <= 0) return -1;
  let t = ((Math.floor(tick) % total) + total) % total;
  for (let i = 0; i < holds.length; i++) {
    t -= holds[i]!;
    if (t < 0) return i;
  }
  return holds.length - 1;
}

export interface FrameTime {
  /** Seconds from the start. */
  start: number;
  /** Seconds on screen. */
  duration: number;
}

/** When each frame starts and how long it shows, at `fps` ticks per second. */
export function frameTimes(holds: readonly number[], fps: number): FrameTime[] {
  const out: FrameTime[] = [];
  let ticks = 0;
  for (const h of holds) {
    out.push({ start: ticks / fps, duration: h / fps });
    ticks += h;
  }
  return out;
}

/** Shortest GIF frame delay browsers honour (shorter ones get slowed to ~0.1 s). */
export const GIF_MIN_DELAY_CS = 2;

/**
 * Per-frame GIF delays in centiseconds (the format's unit). Rounding error is carried to the next
 * frame, so the whole animation keeps its length: three frames at 1/30 s become 3, 3, 4 cs.
 * Delays are at least GIF_MIN_DELAY_CS, so anything faster than 50 fps plays slower.
 */
export function gifDelays(holds: readonly number[], fps: number): number[] {
  const out: number[] = [];
  let exact = 0;
  let given = 0;
  for (const h of holds) {
    exact += (h * 100) / fps;
    const d = Math.max(GIF_MIN_DELAY_CS, Math.round(exact - given));
    out.push(d);
    given += d;
  }
  return out;
}

/**
 * Constant-rate video: which source frame shows at each output frame, sampling the animation at
 * `outFps` (each output frame shows whatever is on screen at its start time).
 */
export function resample(holds: readonly number[], fps: number, outFps: number): number[] {
  const seconds = totalTicks(holds) / fps;
  const count = Math.max(1, Math.round(seconds * outFps));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // A hair past the start, so exact boundaries land on the new frame despite rounding.
    out.push(frameAtTick(holds, (i * fps) / outFps + 1e-9));
  }
  return out;
}
