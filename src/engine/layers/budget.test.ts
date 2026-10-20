import { describe, expect, it } from 'vitest';
import { maxLayersFor } from './budget';

const MB = 1024 * 1024;

describe('maxLayersFor', () => {
  it('fits an iPad Pro sized canvas into a 600 MB budget', () => {
    expect(maxLayersFor(2732 * 2048 * 4, 600 * MB)).toBe(21);
  });

  it('always allows at least one layer', () => {
    expect(maxLayersFor(4096 * 4096 * 4, 100 * MB)).toBe(1);
  });
});
