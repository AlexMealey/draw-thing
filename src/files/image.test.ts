import { describe, expect, it } from 'vitest';
import { tileGrid } from '../engine/history/tiles';
import { importSize, pixelsToTiles } from './image';

function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width: w, height: h, data };
}

describe('pixelsToTiles', () => {
  it('premultiplies and keeps only touched tiles', () => {
    const grid = tileGrid(600, 300); // 3 × 2 tiles
    const tiles = pixelsToTiles(solid(10, 10, [200, 100, 50, 128]), grid, 250, 250);
    // A 10×10 patch at (250, 250) straddles tiles 0, 1, 3 and 4.
    expect([...tiles.keys()].sort()).toEqual([0, 1, 3, 4]);
    const t0 = tiles.get(0)!;
    const i = (255 * 256 + 255) * 4; // bottom-right pixel of tile 0
    expect([...t0.subarray(i, i + 4)]).toEqual([100, 50, 25, 128]);
    expect(t0[0]).toBe(0); // untouched pixels stay transparent
  });

  it('clips to the document and drops transparent tiles', () => {
    const grid = tileGrid(256, 256);
    expect(pixelsToTiles(solid(50, 50, [255, 0, 0, 255]), grid, 300, 0).size).toBe(0);
    expect(pixelsToTiles(solid(50, 50, [255, 0, 0, 0]), grid, 0, 0).size).toBe(0);
    const edge = grid.w - 1;
    const right = pixelsToTiles(solid(50, 50, [255, 0, 0, 255]), grid, edge, 0).get(0)!;
    expect(right[edge * 4 + 3]).toBe(255);
  });
});

describe('importSize', () => {
  it('scales big images down to the largest canvas, keeping the aspect ratio', () => {
    expect(importSize(8000, 4000, 4096)).toEqual({ w: 4096, h: 2048 });
    expect(importSize(1000, 500, 4096)).toEqual({ w: 1000, h: 500 });
  });
});
