import { describe, expect, it } from 'vitest';
import { extractColors } from './extract';

type Rgba = [number, number, number, number];

/** A w×h image of horizontal bands, `rows` rows each. */
function bands(width: number, list: [Rgba, number][]) {
  const height = list.reduce((n, [, rows]) => n + rows, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  let y = 0;
  for (const [rgba, rows] of list) {
    for (let i = 0; i < rows * width; i++) data.set(rgba, (y * width + i) * 4);
    y += rows;
  }
  return { width, height, data };
}

describe('extractColors', () => {
  it('finds the colors of an image, most common first', () => {
    const img = bands(10, [
      [[0, 0, 255, 255], 2],
      [[255, 0, 0, 255], 5],
      [[0, 255, 0, 255], 3],
    ]);
    expect(extractColors(img, 3)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });

  it('never returns more colors than the image has', () => {
    const img = bands(4, [
      [[10, 20, 30, 255], 1],
      [[200, 100, 50, 255], 1],
    ]);
    expect(extractColors(img, 10)).toHaveLength(2);
  });

  it('ignores mostly transparent pixels', () => {
    const img = bands(4, [
      [[255, 255, 0, 255], 1],
      [[0, 0, 0, 0], 8],
      [[255, 0, 255, 100], 8],
    ]);
    expect(extractColors(img, 5)).toEqual(['#ffff00']);
    expect(extractColors(bands(2, [[[0, 0, 0, 0], 2]]), 5)).toEqual([]);
  });

  it('picks colors that are in the image, the same ones every time', () => {
    const list: [Rgba, number][] = [];
    for (let i = 0; i < 64; i++) list.push([[i * 4, 255 - i * 4, (i * 37) % 256, 255], 1]);
    const img = bands(3, list);
    const a = extractColors(img, 6);
    expect(a).toHaveLength(6);
    expect(extractColors(img, 6)).toEqual(a);
    const present = new Set(
      list.map(
        ([[r, g, b]]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''),
      ),
    );
    for (const c of a) expect(present.has(c)).toBe(true);
  });
});
