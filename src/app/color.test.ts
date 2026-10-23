import { describe, expect, it } from 'vitest';
import { contrastColor, hexToHsv, hsToWheel, hsvToHex, normalizeHex, wheelToHs } from './color';

describe('color', () => {
  it('normalizes hex input', () => {
    expect(normalizeHex('ABC')).toBe('#aabbcc');
    expect(normalizeHex('#0a84FF')).toBe('#0a84ff');
    expect(normalizeHex('nope')).toBeNull();
  });

  it('round-trips through HSV', () => {
    for (const hex of [
      '#000000',
      '#ffffff',
      '#ff375f',
      '#30d158',
      '#0a84ff',
      '#bf5af2',
      '#7f7f7f',
    ]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it('knows primary hues', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00').h).toBe(120);
    expect(hexToHsv('#0000ff').h).toBe(240);
  });

  it('maps the wheel: red on top, hue clockwise, saturation outward', () => {
    expect(wheelToHs(0, -10, 10)).toEqual({ h: 0, s: 1 });
    expect(wheelToHs(5, 0, 10).h).toBeCloseTo(90);
    expect(wheelToHs(0, 5, 10)).toEqual({ h: 180, s: 0.5 });
    expect(wheelToHs(0, 50, 10).s).toBe(1);
    const p = hsToWheel(270, 0.5);
    expect(p.x).toBeCloseTo(-0.5);
    expect(p.y).toBeCloseTo(0);
  });

  it('adjusts contrast around mid-gray', () => {
    expect(contrastColor('#c08040', 0)).toBe('#c08040');
    expect(contrastColor('#c08040', -1)).toBe('#808080');
    expect(contrastColor('#c08040', 1)).toBe('#ff8200');
  });
});
