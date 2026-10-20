import type { Rect } from '../gl/target';

/** History and (later) saving work in 256×256 document tiles (ROADMAP §4). */
export const TILE = 256;

export interface TileGrid {
  w: number;
  h: number;
  cols: number;
  rows: number;
}

export function tileGrid(w: number, h: number): TileGrid {
  return { w, h, cols: Math.ceil(w / TILE), rows: Math.ceil(h / TILE) };
}

/** Tiles are numbered row-major: key = ty · cols + tx. */
export function tileRect(grid: TileGrid, key: number): Rect {
  const tx = key % grid.cols;
  const ty = Math.floor(key / grid.cols);
  const x = tx * TILE;
  const y = ty * TILE;
  return { x, y, w: Math.min(TILE, grid.w - x), h: Math.min(TILE, grid.h - y) };
}

export function allTiles(grid: TileGrid): number[] {
  return Array.from({ length: grid.cols * grid.rows }, (_, i) => i);
}

/** Expands a document rect to whole tiles, clamped to the document. Null if it's outside. */
export function alignToTiles(grid: TileGrid, r: Rect): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x / TILE) * TILE);
  const y0 = Math.max(0, Math.floor(r.y / TILE) * TILE);
  const x1 = Math.min(grid.w, Math.ceil((r.x + r.w) / TILE) * TILE);
  const y1 = Math.min(grid.h, Math.ceil((r.y + r.h) / TILE) * TILE);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Keys of the tiles covering a tile-aligned rect. */
export function tilesIn(grid: TileGrid, aligned: Rect): number[] {
  const keys: number[] = [];
  const tx0 = aligned.x / TILE;
  const ty0 = aligned.y / TILE;
  const tx1 = Math.ceil((aligned.x + aligned.w) / TILE);
  const ty1 = Math.ceil((aligned.y + aligned.h) / TILE);
  for (let ty = ty0; ty < ty1; ty++)
    for (let tx = tx0; tx < tx1; tx++) keys.push(ty * grid.cols + tx);
  return keys;
}

/** True when every byte is zero, i.e. a fully transparent premultiplied tile. */
export function isEmpty(data: Uint8Array): boolean {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);
  for (let i = 0; i < words.length; i++) if (words[i] !== 0) return false;
  return true;
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  const wa = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2);
  const wb = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
  return true;
}
