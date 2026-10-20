import type { TileData } from './History';

const supported = typeof CompressionStream !== 'undefined';

/** Deflates raw tile bytes. Returns the input unchanged where CompressionStream is missing. */
export async function compressTile(t: TileData): Promise<TileData> {
  if (!supported || !(t instanceof Uint8Array)) return t;
  const stream = new Blob([t as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).blob();
}

export async function inflateTile(t: TileData): Promise<Uint8Array | null> {
  if (!(t instanceof Blob)) return t;
  const stream = t.stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
