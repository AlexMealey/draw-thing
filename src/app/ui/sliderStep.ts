import { type KeyboardEvent, useRef } from 'react';
import { toolStore } from '../../state/toolStore';

export interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
}

export const STEP_CHOICES = [1, 2, 5, 10, 20, 25] as const;

/**
 * The coarse step that holding Shift or Alt asks for, in display units (px, %, °), or null for
 * normal dragging. Both together use the larger one.
 */
export function heldStep(
  m: Modifiers,
  prefs: { stepShift: number; stepAlt: number } = toolStore.getState(),
): number | null {
  if (m.shiftKey && m.altKey) return Math.max(prefs.stepShift, prefs.stepAlt);
  if (m.altKey) return prefs.stepAlt;
  if (m.shiftKey) return prefs.stepShift;
  return null;
}

/**
 * Display units per value unit for a slider's range: 0..1 sliders show percent, wide ones show
 * px or degrees. Null for short ranges (factors like 1.25×), which don't step coarsely.
 */
export function displayUnit(min: number, max: number): number | null {
  if (min >= -1 && max <= 1) return 100;
  return max - min >= 20 ? 1 : null;
}

/** `value` rounded to a multiple of `step`, kept within [min, max]. */
export function snapValue(value: number, step: number, min: number, max: number): number {
  const snapped = Math.round(value / step) * step;
  // Round away float noise (0.1 × 3 = 0.30000000000000004) so displays and comparisons stay clean.
  return Math.min(max, Math.max(min, Number(snapped.toFixed(10))));
}

interface RangeOptions {
  value: number;
  min: number;
  max: number;
  /** Display units per value unit; defaults to displayUnit(min, max), null turns stepping off. */
  unit?: number | null;
  onChange: (value: number) => void;
}

/**
 * Coarse steps for a native range input while Shift or Alt is held. The modifiers come from the
 * pointer and key events themselves, so this works without the input having keyboard focus.
 */
export function useSteppedRange({ value, min, max, unit, onChange }: RangeOptions) {
  const mods = useRef<Modifiers>({ shiftKey: false, altKey: false });
  const perUnit = unit === undefined ? displayUnit(min, max) : unit;
  const coarse = () => {
    const step = perUnit ? heldStep(mods.current) : null;
    return step && perUnit ? step / perUnit : null;
  };
  const remember = (e: Modifiers) => {
    mods.current = { shiftKey: e.shiftKey, altKey: e.altKey };
  };

  return {
    onPointerDown: remember,
    onPointerMove: remember,
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      remember(e);
      const step = coarse();
      if (!step) return;
      const dir =
        e.key === 'ArrowUp' || e.key === 'ArrowRight'
          ? 1
          : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
            ? -1
            : 0;
      if (!dir) return;
      e.preventDefault();
      onChange(snapValue(value + dir * step, step, min, max));
    },
    /** The input's new value, snapped while a modifier is held. */
    snap: (v: number) => {
      const step = coarse();
      return step ? snapValue(v, step, min, max) : v;
    },
  };
}
