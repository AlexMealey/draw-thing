import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex } from './color';

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
});
