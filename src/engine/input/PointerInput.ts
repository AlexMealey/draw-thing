import type { Point } from '../math/affine';

export interface InputSample {
  /** Document px. */
  x: number;
  y: number;
  /** 0..1, normalized. Mouse and finger report 1. */
  pressure: number;
  /** Radians, Pointer Events Level 3 convention (π/2 = upright). */
  altitude: number;
  azimuth: number;
  /** ms, event.timeStamp (same clock as performance.now()). */
  t: number;
}

export interface StrokeSink {
  begin(s: InputSample, opts: { pointerType: string; eraser: boolean; barrel: boolean }): void;
  /** Enqueue only; drained once per animation frame. */
  extend(samples: InputSample[]): void;
  /** Replaces the previous prediction. */
  predict(samples: InputSample[]): void;
  /** Pen hover or mouse position, for the brush cursor; null when it leaves. */
  hover(s: InputSample | null): void;
  /** Commit the stroke. */
  end(): void;
  /** Discard the stroke (a finger stroke that turned into a gesture). */
  cancel(): void;
}

export interface GestureSink {
  /** Current gesture touches in canvas-local CSS px. */
  update(touches: ReadonlyMap<number, Point>, t: number): void;
  release(
    pointerId: number,
    t: number,
    remaining: ReadonlyMap<number, Point>,
    cancelled: boolean,
  ): void;
}

type PE = PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };

/** Touches starting this soon after pen activity (incl. hover) are treated as a resting palm. */
const PALM_WINDOW_MS = 300;

/**
 * Unifies Apple Pencil, Windows pens, touch and mouse into strokes and gestures.
 * Pen-first: after the first pen contact, fingers only do gestures, never paint.
 */
export class PointerInput {
  /** Allow painting with a finger until a pen has been seen. */
  fingerDrawing = true;

  private drawingId: number | null = null;
  private drawingType = '';
  private penSeen = false;
  private lastPenActivity = -Infinity;
  private touches = new Map<number, Point>();
  private palms = new Set<number>();
  private lastPressure = 0;
  private rect: DOMRect;
  private ro: ResizeObserver;
  private ac = new AbortController();

  constructor(
    private el: HTMLElement,
    private sink: StrokeSink,
    private gestures: GestureSink,
    private viewToDoc: (x: number, y: number) => [number, number],
  ) {
    // Never call getBoundingClientRect per event (forces layout). The canvas is position:fixed.
    this.rect = el.getBoundingClientRect();
    this.ro = new ResizeObserver(() => {
      this.rect = el.getBoundingClientRect();
    });
    this.ro.observe(el);

    const opts = { passive: false, signal: this.ac.signal } as const;
    el.addEventListener('pointerdown', this.onDown, opts);
    el.addEventListener('pointermove', this.onMove, opts);
    el.addEventListener('pointerup', this.onUp, opts);
    el.addEventListener('pointercancel', this.onCancel, opts);
    el.addEventListener('pointerleave', () => this.sink.hover(null), opts);

    // CSS `touch-action: none` stops panning, but iOS Safari also needs these to suppress the
    // magnifier loupe, callout, double-tap zoom and WebKit gesture events. Cancelling touch
    // events does not suppress pointer events.
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', block, opts);
    el.addEventListener('touchmove', block, opts);
    el.addEventListener('gesturestart', block, opts); // WebKit-only
    el.addEventListener('contextmenu', block, opts); // Windows pen press-and-hold = right-click
  }

  dispose() {
    this.ac.abort();
    this.ro.disconnect();
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'pen') {
      this.penSeen = true;
      this.lastPenActivity = e.timeStamp;
    }

    if (e.pointerType === 'touch') {
      if (this.drawingType === 'pen' || e.timeStamp - this.lastPenActivity < PALM_WINDOW_MS) {
        this.palms.add(e.pointerId); // ignored until it lifts
        return;
      }
      this.touches.set(e.pointerId, this.local(e));
      const canDraw =
        !this.penSeen && this.fingerDrawing && this.touches.size === 1 && this.drawingId === null;
      if (!canDraw) {
        // A second finger means the first one was starting a gesture, not a stroke.
        if (this.drawingType === 'touch') this.abortDrawing();
        this.gestures.update(this.touches, e.timeStamp);
        return;
      }
    }
    if (this.drawingId !== null) return; // one drawing pointer at a time
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    this.drawingId = e.pointerId;
    this.drawingType = e.pointerType;
    this.el.setPointerCapture(e.pointerId);
    this.sink.hover(null);
    // Don't let a 0-pressure first sample (Windows Ink) inherit the previous stroke's pressure.
    if (e.pointerType === 'pen') this.lastPressure = 0;
    this.sink.begin(this.sample(e), {
      pointerType: e.pointerType,
      eraser: e.button === 5 || (e.buttons & 32) !== 0, // Surface/Wacom eraser end
      barrel: (e.buttons & 2) !== 0, // barrel button
    });
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.lastPenActivity = e.timeStamp;

    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      // Track the drawing finger too, so a gesture that takes over starts from where it is now.
      this.touches.set(e.pointerId, this.local(e));
      if (e.pointerId !== this.drawingId) {
        this.gestures.update(this.touches, e.timeStamp);
        return;
      }
    }
    if (e.pointerId !== this.drawingId) {
      if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && e.buttons === 0) {
        this.sink.hover(this.sample(e));
      }
      return;
    }
    // Coalesced events recover the full digitizer rate (Apple Pencil ≈ 240 Hz) that a
    // 60/120 Hz event loop would otherwise drop. Feature-detected: older WebKit lacks it.
    const coalesced = e.getCoalescedEvents?.() ?? [];
    this.sink.extend((coalesced.length ? coalesced : [e]).map(this.sample));
    const predicted = e.getPredictedEvents?.() ?? []; // Chromium today
    this.sink.predict(predicted.map(this.sample));
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.lastPenActivity = e.timeStamp;
    if (e.pointerType === 'touch') {
      if (this.palms.delete(e.pointerId)) return;
      if (this.touches.delete(e.pointerId) && e.pointerId !== this.drawingId) {
        this.gestures.release(e.pointerId, e.timeStamp, this.touches, false);
        return;
      }
    }
    if (e.pointerId !== this.drawingId) return;
    this.sink.extend([this.sample(e)]);
    this.sink.end();
    this.release();
  };

  // iOS fires pointercancel for system gestures (Control Center, app switcher, Stage Manager).
  // Commit pen strokes rather than discard them, so the user never loses ink.
  private onCancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (this.palms.delete(e.pointerId)) return;
      if (this.touches.delete(e.pointerId) && e.pointerId !== this.drawingId) {
        this.gestures.release(e.pointerId, e.timeStamp, this.touches, true);
        return;
      }
    }
    if (e.pointerId !== this.drawingId) return;
    if (this.drawingType === 'touch') {
      this.abortDrawing();
      return;
    }
    this.sink.end();
    this.release();
  };

  private abortDrawing() {
    this.sink.cancel();
    this.release();
  }

  private release() {
    if (this.drawingId !== null && this.el.hasPointerCapture(this.drawingId)) {
      this.el.releasePointerCapture(this.drawingId);
    }
    this.drawingId = null;
    this.drawingType = '';
  }

  private local(e: PointerEvent): Point {
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
  }

  private sample = (e: PointerEvent): InputSample => {
    const ev = e as PE;
    const [x, y] = this.viewToDoc(e.clientX - this.rect.left, e.clientY - this.rect.top);
    let pressure = 1;
    if (e.pointerType === 'pen') {
      // Windows Ink often reports 0 on the first contact sample and on pointerup.
      // Pens without pressure report a constant 0.5, per spec.
      pressure = e.pressure > 0 ? e.pressure : this.lastPressure;
      this.lastPressure = pressure;
    }
    const { altitude, azimuth } =
      ev.altitudeAngle !== undefined
        ? { altitude: ev.altitudeAngle, azimuth: ev.azimuthAngle ?? 0 }
        : tiltToSpherical(e.tiltX, e.tiltY);
    return { x, y, pressure, altitude, azimuth, t: e.timeStamp };
  };
}

/** tiltX/tiltY (degrees, Windows pens) → altitude/azimuth (radians, Apple Pencil convention). */
export function tiltToSpherical(tiltXDeg: number, tiltYDeg: number) {
  const tx = Math.tan((tiltXDeg * Math.PI) / 180);
  const ty = Math.tan((tiltYDeg * Math.PI) / 180);
  if (tx === 0 && ty === 0) return { altitude: Math.PI / 2, azimuth: 0 };
  return {
    altitude: Math.atan(1 / Math.hypot(tx, ty)),
    azimuth: (Math.atan2(ty, tx) + 2 * Math.PI) % (2 * Math.PI),
  };
}
