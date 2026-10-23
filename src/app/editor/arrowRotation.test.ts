import { describe, expect, it } from 'vitest';
import { HOLD_DELAY_MS, holdSpeed } from './arrowRotation';

describe('holdSpeed', () => {
  it('waits before turning, so a tap is exactly one step', () => {
    expect(holdSpeed(1, 0)).toBe(0);
    expect(holdSpeed(1, HOLD_DELAY_MS - 1)).toBe(0);
  });

  it('speeds up in stages', () => {
    expect(holdSpeed(1, 500)).toBe(10);
    expect(holdSpeed(1, 1500)).toBe(25);
    expect(holdSpeed(1, 3000)).toBe(60);
  });

  it('scales with the step and is capped', () => {
    expect(holdSpeed(5, 500)).toBe(50);
    expect(holdSpeed(90, 3000)).toBe(180);
  });
});
