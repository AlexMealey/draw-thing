import type { Curve } from './curves';
import type { BrushPreset } from './presets';

/** User edits to a preset from Brush Settings. Absent fields keep the preset's value. */
export interface BrushOverride {
  hardness?: number;
  spacing?: number;
  flow?: number;
  grainDepth?: number;
  minSize?: number;
  flowMin?: number;
  sizeCurve?: Curve;
  flowCurve?: Curve;
  tiltBoost?: number;
  jitterSize?: number;
  jitterAngle?: number;
  scatter?: number;
}

export function resolvePreset(p: BrushPreset, o: BrushOverride | undefined): BrushPreset {
  if (!o || Object.keys(o).length === 0) return p;
  const jitter =
    o.jitterSize !== undefined || o.jitterAngle !== undefined || o.scatter !== undefined || p.jitter
      ? {
          size: o.jitterSize ?? p.jitter?.size ?? 0,
          angle: o.jitterAngle ?? p.jitter?.angle ?? 0,
          scatter: o.scatter ?? p.jitter?.scatter ?? 0,
        }
      : undefined;
  return {
    ...p,
    tip: { ...p.tip, hardness: o.hardness ?? p.tip.hardness },
    grain: p.grain && { ...p.grain, depth: o.grainDepth ?? p.grain.depth },
    size: { ...p.size, minRatio: o.minSize ?? p.size.minRatio },
    flow: o.flow ?? p.flow,
    spacing: o.spacing ?? p.spacing,
    pressure: {
      size: o.sizeCurve ?? p.pressure.size,
      flow: o.flowCurve ?? p.pressure.flow,
      flowMin: o.flowMin ?? p.pressure.flowMin,
    },
    tilt: o.tiltBoost !== undefined ? { sizeBoost: o.tiltBoost } : p.tilt,
    jitter,
  };
}
