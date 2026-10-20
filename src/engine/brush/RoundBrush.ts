/** Phase 1 brush: hard round tip, pressure → size. Replaced by data-driven presets in Phase 2. */
export interface BrushSettings {
  /** Diameter at full pressure, in document px. */
  size: number;
  /** CSS hex color, e.g. "#1c1c1e". */
  color: string;
  eraser: boolean;
}

/** Fraction of full size at zero pressure, so feather-light strokes still show. */
const MIN_SIZE_RATIO = 0.1;
/** Dab spacing as a fraction of the diameter. */
const SPACING = 0.1;

export function radiusFor(size: number, pressure: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  return Math.max(0.5, (size / 2) * (MIN_SIZE_RATIO + (1 - MIN_SIZE_RATIO) * p));
}

export function spacingFor(size: number, pressure: number): number {
  return Math.max(0.5, 2 * radiusFor(size, pressure) * SPACING);
}

/** "#rrggbb" or "#rgb" → sRGB components 0..1 (black if unparseable). */
export function parseHexColor(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
