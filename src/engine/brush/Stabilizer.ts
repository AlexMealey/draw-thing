import type { InputSample } from '../input/PointerInput';

/** Lag of the pulled string at full StreamLine, ms. */
const MAX_LAG_MS = 120;
/** Pressure smoothing time constant: removes digitizer jitter without visible lag. */
const PRESSURE_TAU_MS = 8;
const CATCH_UP_STEPS = 6;

/**
 * StreamLine: a frame-rate independent "pulled string" (exponential follow, k = 1 − e^(−dt/τ))
 * plus light pressure smoothing. At amount 0 positions pass through untouched.
 */
export class Stabilizer {
  private smoothed: InputSample | null = null;
  private raw: InputSample | null = null;

  constructor(private amount: number) {}

  push(raw: InputSample): InputSample {
    this.raw = raw;
    const prev = this.smoothed;
    if (!prev) return (this.smoothed = raw);
    const dt = Math.max(0, raw.t - prev.t);
    const kp = 1 - Math.exp(-dt / PRESSURE_TAU_MS);
    const pressure = prev.pressure + (raw.pressure - prev.pressure) * kp;
    let { x, y } = raw;
    if (this.amount > 0) {
      const k = 1 - Math.exp(-dt / (MAX_LAG_MS * this.amount));
      x = prev.x + (raw.x - prev.x) * k;
      y = prev.y + (raw.y - prev.y) * k;
    }
    return (this.smoothed = { ...raw, x, y, pressure });
  }

  /** Pen-up: glide from the smoothed position to where the pen actually lifted. */
  catchUp(): InputSample[] {
    const from = this.smoothed;
    const to = this.raw;
    if (!from || !to || this.amount === 0) return [];
    const out: InputSample[] = [];
    for (let i = 1; i <= CATCH_UP_STEPS; i++) {
      const t = i / CATCH_UP_STEPS;
      out.push({ ...from, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
    return out;
  }
}
