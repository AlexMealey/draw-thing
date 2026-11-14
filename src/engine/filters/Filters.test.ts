import { describe, expect, it } from 'vitest';
import { blurPlan, MAX_BLUR_RADIUS } from './Filters';

describe('blurPlan', () => {
  it('blurs small radii at full size, sampling every pixel', () => {
    expect(blurPlan(12)).toEqual({ level: 0, sigma: 4, taps: 12 });
    expect(blurPlan(24).level).toBe(0);
  });

  it('halves the layer until the radius is small there', () => {
    expect(blurPlan(40)).toMatchObject({ level: 1, taps: 20 });
    expect(blurPlan(150)).toMatchObject({ level: 3, taps: 19 });
    const max = blurPlan(MAX_BLUR_RADIUS);
    expect(max.level).toBe(5);
    expect(max.sigma).toBeCloseTo(400 / 32 / 3);
  });

  it('never spaces taps further apart than a texel of its level', () => {
    for (let r = 1; r <= MAX_BLUR_RADIUS; r += 7) {
      const { level, taps } = blurPlan(r);
      expect(taps).toBeLessThanOrEqual(24);
      expect(taps * 2 ** level).toBeGreaterThanOrEqual(r);
    }
  });

  it('clamps out-of-range radii', () => {
    expect(blurPlan(-5)).toEqual({ level: 0, sigma: 0.5, taps: 1 });
    expect(blurPlan(10_000)).toEqual(blurPlan(MAX_BLUR_RADIUS));
  });
});
