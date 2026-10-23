/** A held arrow key starts turning the canvas after this long (the tap step has already fired). */
export const HOLD_DELAY_MS = 300;
const MAX_SPEED = 180;

/**
 * Turning speed (°/s) after an arrow key has been held for `heldMs`. It starts slow enough to
 * land precisely and speeds up in stages, scaled by the tap step.
 */
export function holdSpeed(stepDeg: number, heldMs: number): number {
  if (heldMs < HOLD_DELAY_MS) return 0;
  const stage = heldMs < 1000 ? 1 : heldMs < 2500 ? 2.5 : 6;
  return Math.min(MAX_SPEED, Math.max(1, stepDeg) * 10 * stage);
}

/**
 * Rotates by one step on press, then keeps turning while the key is held. Key-repeat events are
 * ignored by the caller: this controller runs off requestAnimationFrame instead.
 */
export class ArrowRotation {
  private dir = 0;
  private start = 0;
  private last = 0;
  private raf = 0;

  constructor(
    private rotate: (degrees: number) => void,
    private step: () => number,
  ) {}

  press(dir: -1 | 1) {
    if (this.dir === dir) return;
    this.dir = dir;
    this.rotate(dir * this.step());
    this.start = this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  release(dir?: -1 | 1) {
    if (dir !== undefined && dir !== this.dir) return;
    this.dir = 0;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    if (this.dir === 0) return;
    const speed = holdSpeed(this.step(), now - this.start);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (speed > 0 && dt > 0) this.rotate(this.dir * speed * dt);
    this.raf = requestAnimationFrame(this.tick);
  };
}
