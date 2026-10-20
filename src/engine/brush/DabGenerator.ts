import type { DabBatch } from '../render/DabBatch';
import { bakeCurve, evalCurve } from './curves';
import type { BrushPreset } from './presets';
import type { Pt } from './StrokePath';

const UPRIGHT = Math.PI / 2;

interface State {
  seed: number;
  lastX: number;
  lastY: number;
  direction: number;
}

/**
 * Turns path positions into dabs for one stroke: pressure curves, tilt, stroke direction and
 * jitter. Randomness comes from a seeded PRNG, so a stroke is reproducible from its input.
 */
export class DabGenerator {
  private sizeLut: Float32Array;
  private flowLut: Float32Array;
  private altitude = UPRIGHT;
  private azimuth = 0;
  private state: State;

  constructor(
    private preset: BrushPreset,
    /** Full-pressure diameter, document px. */
    private size: number,
    seed: number,
  ) {
    this.sizeLut = bakeCurve(preset.pressure.size);
    this.flowLut = bakeCurve(preset.pressure.flow);
    this.state = { seed: seed >>> 0 || 1, lastX: NaN, lastY: NaN, direction: 0 };
  }

  /** Tilt of the sample being fed to the path next. */
  setTilt(altitude: number, azimuth: number) {
    this.altitude = altitude;
    this.azimuth = azimuth;
  }

  /** Diameter before jitter; also drives dab spacing. */
  diameterAt(p: number): number {
    const { size, tilt } = this.preset;
    const ratio = size.minRatio + (1 - size.minRatio) * evalCurve(this.sizeLut, p);
    const flatness = 1 - Math.min(1, Math.max(0, this.altitude / UPRIGHT));
    const tiltBoost = tilt ? 1 + tilt.sizeBoost * flatness : 1;
    return Math.max(1, this.size * ratio * tiltBoost);
  }

  spacingAt = (p: number): number => Math.max(0.5, this.diameterAt(p) * this.preset.spacing);

  emit(pt: Pt, out: DabBatch) {
    const { tip, jitter, flow, pressure } = this.preset;
    const s = this.state;

    const dx = pt.x - s.lastX;
    const dy = pt.y - s.lastY;
    if (dx * dx + dy * dy > 0.01) s.direction = Math.atan2(dy, dx);
    s.lastX = pt.x;
    s.lastY = pt.y;

    let radius = this.diameterAt(pt.p) / 2;
    let angle = tip.angle;
    if (tip.followStroke) angle += s.direction;
    if (tip.tiltRotates) angle += this.azimuth;
    let x = pt.x;
    let y = pt.y;
    if (jitter) {
      radius *= 1 + jitter.size * (this.random() * 2 - 1);
      angle += jitter.angle * Math.PI * (this.random() * 2 - 1);
      if (jitter.scatter > 0) {
        const r = Math.sqrt(this.random()) * jitter.scatter * radius * 2;
        const a = this.random() * Math.PI * 2;
        x += Math.cos(a) * r;
        y += Math.sin(a) * r;
      }
    }
    const alpha =
      flow * (pressure.flowMin + (1 - pressure.flowMin) * evalCurve(this.flowLut, pt.p));
    out.push(x, y, Math.max(0.5, radius), alpha, angle);
  }

  /** For throwaway previews: snapshot and restore everything emit() changes. */
  save(): State {
    return { ...this.state };
  }

  restore(state: State) {
    this.state = { ...state };
  }

  /** mulberry32 */
  private random(): number {
    let t = (this.state.seed = (this.state.seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
