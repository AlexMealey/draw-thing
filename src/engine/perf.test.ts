import { describe, expect, it } from 'vitest';
import { Samples } from './perf';

describe('Samples', () => {
  it('reports nearest-rank percentiles', () => {
    const s = new Samples();
    for (let i = 1; i <= 100; i++) s.push(i);
    expect(s.percentile(50)).toBe(50);
    expect(s.percentile(95)).toBe(95);
    expect(s.percentile(100)).toBe(100);
    expect(s.summary()).toMatchObject({ count: 100, mean: 50.5, max: 100 });
    expect(s.countAbove(90)).toBe(10);
  });

  it('keeps only the most recent samples', () => {
    const s = new Samples(4);
    for (const v of [100, 100, 1, 2, 3, 4]) s.push(v);
    expect(s.count).toBe(4);
    expect(s.summary().max).toBe(4);
  });

  it('is empty after clear', () => {
    const s = new Samples();
    s.push(5);
    s.clear();
    expect(s.summary()).toEqual({ count: 0, mean: 0, p50: 0, p95: 0, max: 0 });
  });
});
