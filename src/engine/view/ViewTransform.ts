import {
  about,
  apply,
  type Affine,
  identity,
  invert,
  multiply,
  rotate,
  scale,
  translate,
} from '../math/affine';

const MIN_SCALE = 0.02;
const MAX_SCALE = 64;
const QUARTER_TURN = Math.PI / 2;

/** View-space margins (CSS px) covered by UI chrome. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Document pixels → view pixels (CSS px, relative to the canvas element).
 * Always a similarity transform: uniform scale, rotation, translation.
 */
export class ViewTransform {
  private m: Affine = identity();
  private inv: Affine = identity();

  get docToView(): Affine {
    return this.m;
  }

  get scale(): number {
    return Math.hypot(this.m.a, this.m.b);
  }

  /** Radians, in (−π, π]. */
  get rotation(): number {
    return Math.atan2(this.m.b, this.m.a);
  }

  viewToDoc(x: number, y: number): [number, number] {
    return apply(this.inv, x, y);
  }

  /** Sets the transform, clamping scale about the given view-space pivot. */
  set(m: Affine, pivotX: number, pivotY: number) {
    const s = Math.hypot(m.a, m.b);
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
    this.m = clamped === s ? m : multiply(about(scale(clamped / s), pivotX, pivotY), m);
    this.inv = invert(this.m);
  }

  panBy(dx: number, dy: number) {
    this.set(multiply(translate(dx, dy), this.m), 0, 0);
  }

  zoomAt(factor: number, x: number, y: number) {
    this.set(multiply(about(scale(factor), x, y), this.m), x, y);
  }

  rotateAt(rad: number, x: number, y: number) {
    this.set(multiply(about(rotate(rad), x, y), this.m), x, y);
  }

  /**
   * Centers the document, unrotated, filling `margin` of the view area left free by `insets`
   * (UI chrome such as the top bar and sidebar).
   */
  fit(docW: number, docH: number, viewW: number, viewH: number, insets = NO_INSETS, margin = 0.94) {
    const w = Math.max(1, viewW - insets.left - insets.right);
    const h = Math.max(1, viewH - insets.top - insets.bottom);
    const s = Math.min(w / docW, h / docH) * margin;
    const cx = insets.left + w / 2;
    const cy = insets.top + h / 2;
    this.set({ a: s, b: 0, c: 0, d: s, e: cx - (docW * s) / 2, f: cy - (docH * s) / 2 }, cx, cy);
  }

  /** Keeps the content centered when the view resizes (rotation, split view, window resize). */
  reshape(oldW: number, oldH: number, newW: number, newH: number) {
    this.panBy((newW - oldW) / 2, (newH - oldH) / 2);
  }

  /** Snaps to the nearest quarter turn if within `threshold` radians. */
  snapRotation(x: number, y: number, threshold = (5 * Math.PI) / 180) {
    const r = this.rotation;
    const target = Math.round(r / QUARTER_TURN) * QUARTER_TURN;
    if (r !== target && Math.abs(r - target) < threshold) this.rotateAt(target - r, x, y);
  }
}
