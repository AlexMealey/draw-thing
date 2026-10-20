import { type Affine, type Point, similarityFromPairs } from '../math/affine';
import type { GestureSink } from './PointerInput';

export interface GestureCallbacks {
  /** A two-finger transform began, or its finger pair changed: capture the current view. */
  transformStart(): void;
  /** View-space similarity to apply on top of the view captured at `transformStart`. */
  transform(delta: Affine, pivot: Point): void;
  transformEnd(pivot: Point): void;
  /** 2 = undo, 3 = redo, 4 = toggle UI (Procreate conventions). */
  tap(fingers: number): void;
  /** Fast pinch-in: fit the canvas to the screen. */
  quickPinch(): void;
  /** Touch-and-hold with one finger (eyedropper), then its moves and its release. */
  hold?(p: Point): void;
  holdMove?(p: Point): void;
  holdEnd?(cancelled: boolean): void;
}

/** Schedules `fn` after `ms`; returns a cancel function. Injectable for tests. */
export type Schedule = (fn: () => void, ms: number) => () => void;

const defaultSchedule: Schedule = (fn, ms) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

const TAP_MAX_MS = 300;
const TAP_SLOP_PX = 10;
const QUICK_PINCH_MS = 300;
const QUICK_PINCH_SCALE = 0.75;
const HOLD_MS = 450;

interface Session {
  start: number;
  maxFingers: number;
  moved: boolean;
  origins: Map<number, Point>;
}

interface Pair {
  ids: [number, number];
  /** Positions when the pair formed. */
  p1: Point;
  p2: Point;
  /** Latest positions. */
  q1: Point;
  q2: Point;
  start: number;
  scale: number;
}

/** Multi-finger canvas gestures. Pure logic over canvas-local points and timestamps. */
export class GestureRecognizer implements GestureSink {
  private session: Session | null = null;
  private pair: Pair | null = null;
  private latest: ReadonlyMap<number, Point> = new Map();
  private cancelHold: (() => void) | null = null;
  private holding: number | null = null;

  constructor(
    private cb: GestureCallbacks,
    private schedule: Schedule = defaultSchedule,
  ) {}

  update(touches: ReadonlyMap<number, Point>, t: number) {
    const s = (this.session ??= { start: t, maxFingers: 0, moved: false, origins: new Map() });
    s.maxFingers = Math.max(s.maxFingers, touches.size);
    for (const [id, p] of touches) {
      const o = s.origins.get(id);
      if (!o) s.origins.set(id, { ...p });
      else if (Math.hypot(p.x - o.x, p.y - o.y) > TAP_SLOP_PX) s.moved = true;
    }
    this.latest = touches;

    if (this.holding !== null) {
      const p = touches.get(this.holding);
      if (p) this.cb.holdMove?.(p);
      return;
    }
    if (touches.size === 1 && s.maxFingers === 1 && !s.moved) {
      const [first] = touches;
      if (first && !this.cancelHold) {
        const id = first[0];
        this.cancelHold = this.schedule(() => this.startHold(id), HOLD_MS);
      }
    } else {
      this.stopHoldTimer();
    }

    const [first, second] = touches;
    if (!first || !second) return;
    const [a, q1] = first;
    const [b, q2] = second;
    const pr = this.pair;
    if (!pr || pr.ids[0] !== a || pr.ids[1] !== b) {
      if (pr) this.cb.transformEnd(mid(pr.q1, pr.q2));
      this.pair = {
        ids: [a, b],
        p1: { ...q1 },
        p2: { ...q2 },
        q1: { ...q1 },
        q2: { ...q2 },
        start: t,
        scale: 1,
      };
      this.cb.transformStart();
      return;
    }
    pr.q1 = { ...q1 };
    pr.q2 = { ...q2 };
    pr.scale = dist(q1, q2) / Math.max(dist(pr.p1, pr.p2), 1e-6);
    this.cb.transform(similarityFromPairs(pr.p1, pr.p2, q1, q2), mid(q1, q2));
  }

  release(id: number, t: number, remaining: ReadonlyMap<number, Point>, cancelled: boolean) {
    const s = this.session;
    if (s && cancelled) s.moved = true;
    this.stopHoldTimer();
    if (this.holding === id) {
      this.holding = null;
      this.cb.holdEnd?.(cancelled);
    }

    const pr = this.pair;
    if (pr && pr.ids.includes(id)) {
      this.pair = null;
      this.cb.transformEnd(mid(pr.q1, pr.q2));
      if (!cancelled && t - pr.start < QUICK_PINCH_MS && pr.scale < QUICK_PINCH_SCALE) {
        this.cb.quickPinch();
        if (s) s.moved = true;
      }
    }

    if (remaining.size === 0 && s) {
      this.session = null;
      if (!s.moved && s.maxFingers >= 2 && t - s.start < TAP_MAX_MS) this.cb.tap(s.maxFingers);
    }
  }

  private startHold(id: number) {
    this.cancelHold = null;
    const s = this.session;
    const p = this.latest.get(id);
    if (!s || s.moved || s.maxFingers !== 1 || !p) return;
    s.moved = true; // a hold is never a tap
    this.holding = id;
    this.cb.hold?.(p);
  }

  private stopHoldTimer() {
    this.cancelHold?.();
    this.cancelHold = null;
  }
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
