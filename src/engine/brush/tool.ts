import type { BrushPreset } from './presets';

/** Everything the engine needs to start a stroke. Captured at pen-down. */
export interface ToolSettings {
  preset: BrushPreset;
  /** Full-pressure diameter, document px. */
  size: number;
  /** Stroke opacity ceiling, 0..1. */
  opacity: number;
  /** StreamLine, 0..1. */
  smoothing: number;
  /** CSS hex color. */
  color: string;
  /** Erase with the selected brush (Procreate-style), instead of painting. */
  eraser: boolean;
}
