/** A stroke sample: document position plus mapped pressure (0..1). */
export interface Pt {
  x: number;
  y: number;
  p: number;
}

export type DabSink = (pt: Pt) => void;

/**
 * Turns samples into evenly spaced dab positions along midpoint quadratic Béziers
 * (from mid(Pᵢ₋₁,Pᵢ) to mid(Pᵢ,Pᵢ₊₁) with Pᵢ as control): C¹-smooth at any speed and needs
 * no lookahead sample. Spacing carries over across segments and frames.
 */
export class StrokePath {
  private prev: Pt | null = null;
  private lastMid: Pt | null = null;
  private toNext = 0; // arc length until the next dab

  constructor(private spacingAt: (p: number) => number) {}

  push(pt: Pt, sink: DabSink) {
    if (!this.prev || !this.lastMid) {
      this.prev = this.lastMid = pt;
      sink(pt);
      this.toNext = this.spacingAt(pt.p);
      return;
    }
    const mid = lerp(this.prev, pt, 0.5);
    this.walkQuad(this.lastMid, this.prev, mid, sink);
    this.prev = pt;
    this.lastMid = mid;
  }

  /** Draws the last half-segment, which the midpoint scheme otherwise holds back. */
  finish(sink: DabSink) {
    if (this.prev && this.lastMid) this.walkLine(this.lastMid, this.prev, sink);
  }

  /**
   * Emits the dabs that `points` (e.g. predicted samples) plus `finish()` would add, without
   * changing the path. Used for a throwaway on-screen overlay that hides input latency.
   */
  preview(points: readonly Pt[], sink: DabSink) {
    const { prev, lastMid, toNext } = this;
    for (const p of points) this.push(p, sink);
    this.finish(sink);
    this.prev = prev;
    this.lastMid = lastMid;
    this.toNext = toNext;
  }

  private walkQuad(a: Pt, c: Pt, b: Pt, sink: DabSink) {
    const n = Math.max(1, Math.ceil((dist(a, c) + dist(c, b)) / 2)); // ~2 px flattening
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const mt = 1 - t;
      const w0 = mt * mt;
      const w1 = 2 * mt * t;
      const w2 = t * t;
      const q = {
        x: w0 * a.x + w1 * c.x + w2 * b.x,
        y: w0 * a.y + w1 * c.y + w2 * b.y,
        p: w0 * a.p + w1 * c.p + w2 * b.p,
      };
      this.walkLine(prev, q, sink);
      prev = q;
    }
  }

  private walkLine(a: Pt, b: Pt, sink: DabSink) {
    const len = dist(a, b);
    let pos = 0;
    while (pos + this.toNext <= len) {
      pos += this.toNext;
      const pt = lerp(a, b, pos / len);
      sink(pt);
      this.toNext = this.spacingAt(pt.p);
    }
    this.toNext -= len - pos;
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  p: a.p + (b.p - a.p) * t,
});
