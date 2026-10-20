import { unzlibSync, zlibSync } from 'fflate';
import type { TileData } from './History';

const native =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/**
 * Deflates raw tile bytes into a zlib Blob (the history's compressed form and the on-disk tile
 * format). Uses the browser's CompressionStream where it exists, fflate otherwise.
 */
export async function compressTile(t: TileData): Promise<TileData> {
  if (!(t instanceof Uint8Array)) return t;
  if (!native) return new Blob([zlibSync(t, { level: 6 }) as Uint8Array<ArrayBuffer>]);
  const stream = new Blob([t as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).blob();
}

export async function inflateTile(t: TileData): Promise<Uint8Array | null> {
  if (!(t instanceof Blob)) return t;
  if (!native) return unzlibSync(new Uint8Array(await t.arrayBuffer()));
  const stream = t.stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
