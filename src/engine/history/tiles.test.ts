import { describe, expect, it } from 'vitest';
import { alignToTiles, isEmpty, sameBytes, tileGrid, tileRect, tilesIn } from './tiles';

describe('tile grid', () => {
  const grid = tileGrid(600, 300); // 3 × 2 tiles, partial at the right and bottom

  it('clamps edge tiles to the document', () => {
    expect(grid).toMatchObject({ cols: 3, rows: 2 });
    expect(tileRect(grid, 0)).toEqual({ x: 0, y: 0, w: 256, h: 256 });
    expect(tileRect(grid, 5)).toEqual({ x: 512, y: 256, w: 88, h: 44 });
  });

  it('aligns rects to whole tiles and lists their keys', () => {
    const aligned = alignToTiles(grid, { x: 250, y: 10, w: 20, h: 260 });
    expect(aligned).toEqual({ x: 0, y: 0, w: 512, h: 300 });
    expect(tilesIn(grid, aligned!)).toEqual([0, 1, 3, 4]);
    expect(alignToTiles(grid, { x: -50, y: -50, w: 10, h: 10 })).toBeNull();
  });

  it('compares tile bytes', () => {
    const a = new Uint8Array(16);
    const b = new Uint8Array(16);
    expect(isEmpty(a)).toBe(true);
    b[7] = 1;
    expect(isEmpty(b)).toBe(false);
    expect(sameBytes(a, b)).toBe(false);
    expect(sameBytes(a, new Uint8Array(16))).toBe(true);
    expect(sameBytes(null, null)).toBe(true);
    expect(sameBytes(a, null)).toBe(false);
  });
});
