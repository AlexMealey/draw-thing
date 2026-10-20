import { detectOS } from '../../platform/env';

const MB = 1024 * 1024;

/**
 * GPU overhead that doesn't depend on the layer count, in layer-sized units: the compositor's
 * below/above/out/preview/scratch targets plus a half-float stroke buffer (2×).
 */
export const FIXED_LAYER_EQUIVALENTS = 7;

/**
 * Starting GPU memory budgets (ROADMAP §4.4), to be tuned on real devices. Exceeding what the OS
 * allows gets the page killed (iPadOS) or the context lost, so the layer count is capped instead.
 */
export function gpuBudgetBytes(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory !== undefined) {
    if (nav.deviceMemory >= 8) return 1024 * MB;
    if (nav.deviceMemory >= 4) return 600 * MB;
    return 350 * MB;
  }
  const os = detectOS(nav.userAgent, nav.maxTouchPoints);
  return os === 'ipados' || os === 'ios' ? 600 * MB : 800 * MB;
}

export function maxLayersFor(layerBytes: number, budget: number): number {
  return Math.max(1, Math.floor((budget - FIXED_LAYER_EQUIVALENTS * layerBytes) / layerBytes));
}

/** Undo history budget (ROADMAP §1.4): bytes, not steps. */
export function historyBudgetBytes(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (nav.deviceMemory !== undefined) {
    if (nav.deviceMemory >= 8) return 512 * MB;
    if (nav.deviceMemory >= 4) return 256 * MB;
    return 128 * MB;
  }
  const os = detectOS(nav.userAgent, nav.maxTouchPoints);
  return os === 'ipados' || os === 'ios' ? 256 * MB : 512 * MB;
}
