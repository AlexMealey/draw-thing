import { type Curve, LINEAR } from './curves';

/**
 * A brush is pure data, so presets are serializable, importable and testable (ROADMAP §3.1).
 * Sizes are diameters in document px; the size slider sets the full-pressure diameter.
 */
export interface BrushPreset {
  id: string;
  name: string;
  tip: {
    /** 1 = crisp edge, 0 = soft falloff from the center. */
    hardness: number;
    /** Minor/major axis ratio: 1 = round, smaller = flat chisel. */
    roundness: number;
    /** Tip rotation, radians. */
    angle: number;
    /** Rotate the tip with the stroke direction. */
    followStroke: boolean;
    /** Rotate the tip with the pen's azimuth (how it's held). */
    tiltRotates: boolean;
  };
  grain?: {
    /** Grain period relative to the base 256 px texture. */
    scale: number;
    /** 0 = no texture, 1 = paint only on the grain's peaks. */
    depth: number;
    /** 'moving': grain fixed to the paper. 'texturized': grain stamped with each dab. */
    mode: 'moving' | 'texturized';
  };
  size: {
    default: number;
    max: number;
    /** Diameter at zero pressure as a fraction of full size. */
    minRatio: number;
  };
  /** Default stroke opacity: the ceiling the whole stroke can reach (0..1). */
  opacity: number;
  /** Paint deposited by each dab at full pressure (0..1). Builds up within a stroke. */
  flow: number;
  /** Dab spacing as a fraction of the diameter. */
  spacing: number;
  /** 'over' builds up where dabs overlap; 'max' never gets darker than one dab (marker). */
  accumulate: 'over' | 'max';
  pressure: {
    size: Curve;
    flow: Curve;
    /** Flow at zero pressure as a fraction of full flow. 1 = pressure doesn't affect flow. */
    flowMin: number;
  };
  tilt?: {
    /** Extra size when the pen lies flat: 2 = three times as wide at full tilt. */
    sizeBoost: number;
  };
  jitter?: {
    /** Random size variation, fraction of size. */
    size: number;
    /** Random rotation, fraction of a half turn. */
    angle: number;
    /** Random offset, fraction of the diameter. */
    scatter: number;
  };
  /** Default StreamLine smoothing (0..1). */
  stabilization: number;
}

const ROUND = { roundness: 1, angle: 0, followStroke: false, tiltRotates: false };

export const PRESETS: readonly BrushPreset[] = [
  {
    id: 'ink',
    name: 'Ink',
    tip: { ...ROUND, hardness: 1 },
    size: { default: 8, max: 120, minRatio: 0.12 },
    opacity: 1,
    flow: 1,
    spacing: 0.05,
    accumulate: 'over',
    pressure: { size: [0.2, 0.4, 0.6, 1], flow: LINEAR, flowMin: 1 },
    stabilization: 0.1,
  },
  {
    id: 'pencil',
    name: 'Pencil',
    tip: { ...ROUND, hardness: 0.7 },
    grain: { scale: 0.5, depth: 0.9, mode: 'moving' },
    size: { default: 5, max: 40, minRatio: 0.6 },
    opacity: 1,
    flow: 0.5,
    spacing: 0.08,
    accumulate: 'over',
    pressure: { size: LINEAR, flow: [0.45, 0, 0.8, 0.7], flowMin: 0.08 },
    tilt: { sizeBoost: 2.5 },
    stabilization: 0,
  },
  {
    id: 'airbrush',
    name: 'Airbrush',
    tip: { ...ROUND, hardness: 0 },
    size: { default: 160, max: 800, minRatio: 1 },
    opacity: 1,
    flow: 0.1,
    spacing: 0.08,
    accumulate: 'over',
    pressure: { size: LINEAR, flow: LINEAR, flowMin: 0.05 },
    stabilization: 0,
  },
  {
    id: 'marker',
    name: 'Marker',
    tip: { hardness: 0.85, roundness: 0.4, angle: -0.6, followStroke: false, tiltRotates: false },
    size: { default: 28, max: 160, minRatio: 0.8 },
    opacity: 1,
    flow: 0.6,
    spacing: 0.04,
    accumulate: 'max',
    pressure: { size: LINEAR, flow: LINEAR, flowMin: 0.6 },
    stabilization: 0.2,
  },
  {
    id: 'chalk',
    name: 'Chalk',
    tip: { hardness: 0.4, roundness: 0.8, angle: 0, followStroke: true, tiltRotates: false },
    grain: { scale: 1.2, depth: 1, mode: 'texturized' },
    size: { default: 36, max: 240, minRatio: 0.6 },
    opacity: 1,
    flow: 0.55,
    spacing: 0.18,
    accumulate: 'over',
    pressure: { size: LINEAR, flow: LINEAR, flowMin: 0.3 },
    jitter: { size: 0.25, angle: 1, scatter: 0.08 },
    stabilization: 0,
  },
];

export const DEFAULT_PRESET_ID = 'ink';

export function presetById(id: string): BrushPreset {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  if (!preset) throw new Error('No brush presets defined');
  return preset;
}
