export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
}

export type WheelIntent =
  { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

/** A scroll gesture keeps its first classification while its events keep coming. */
const GESTURE_GAP_MS = 250;

/**
 * Decides what a wheel event does to the view:
 * - Ctrl/⌘ + wheel zooms. Chromium and Safari send trackpad pinches this way too.
 * - A mouse wheel zooms (or pans, with `wheel: 'pan'`). Shift + wheel pans sideways.
 * - Two-finger trackpad scrolling pans. It's told apart from a mouse wheel by pixel-mode deltas
 *   that are fractional or sideways, and the decision sticks for the rest of that gesture.
 */
export class WheelClassifier {
  private lastT = -Infinity;
  private trackpad = false;

  classify(
    e: WheelLike,
    prefs: { wheel: 'zoom' | 'pan'; zoomStep: number },
    viewH: number,
  ): WheelIntent {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewH : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      this.lastT = e.timeStamp;
      return { kind: 'zoom', factor: Math.exp(-dy * 0.01) };
    }

    const newGesture = e.timeStamp - this.lastT > GESTURE_GAP_MS;
    this.lastT = e.timeStamp;
    if (newGesture) this.trackpad = false;
    if (e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY))) this.trackpad = true;

    if (e.shiftKey) return { kind: 'pan', dx: -(dx || dy), dy: 0 };
    if (this.trackpad || prefs.wheel === 'pan') return { kind: 'pan', dx: -dx, dy: -dy };
    // One notch (about 100 px, or 3 lines) zooms by the Ctrl/⌘ +/− step.
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaMode === 2 ? e.deltaY : dy / 100;
    return { kind: 'zoom', factor: prefs.zoomStep ** -notches };
  }
}
