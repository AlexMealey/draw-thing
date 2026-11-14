import { unzlibSync } from 'fflate';
import { compressTile } from '../history/compress';
import type { LayerTiles, TileData } from '../history/History';

/** Deflated tile bytes (zlib), kept as bytes so they can be inflated synchronously. */
interface Packed {
  readonly zlib: Uint8Array;
}

type Parked = Uint8Array | Packed;

const isPacked = (t: Parked): t is Packed => !(t instanceof Uint8Array);

/**
 * CPU copies of layer pixels as 256² tiles (fully transparent tiles absent), for the layers of
 * frames that aren't on the GPU. Only the active frame's layers have textures; switching frames
 * parks the old ones here and uploads the new ones from here, synchronously.
 *
 * A resident layer can keep its copy too: if it hasn't been painted on since it was uploaded, the
 * copy is still exact and parking it again needs no readback.
 *
 * Fresh tiles are raw; `compressIdle()` deflates the ones that aren't likely to be needed soon.
 */
export class ParkedTiles {
  private layers = new Map<string, Map<number, Parked>>();

  has(layerId: string): boolean {
    return this.layers.has(layerId);
  }

  ids(): string[] {
    return [...this.layers.keys()];
  }

  delete(layerId: string) {
    this.layers.delete(layerId);
  }

  clear() {
    this.layers.clear();
  }

  /** Replaces a layer's tiles with raw bytes (e.g. a GPU readback). Arrays are kept, not copied. */
  setRaw(layerId: string, tiles: ReadonlyMap<number, Uint8Array>) {
    this.layers.set(layerId, new Map(tiles));
  }

  /**
   * Replaces a layer's tiles with stored ones (zlib Blobs from IndexedDB, or raw bytes). Async:
   * a Blob's bytes can only be read asynchronously.
   */
  async setStored(layerId: string, tiles: ReadonlyMap<number, TileData>) {
    const out = new Map<number, Parked>();
    for (const [key, t] of tiles) {
      if (t === null) continue;
      out.set(key, t instanceof Blob ? { zlib: new Uint8Array(await t.arrayBuffer()) } : t);
    }
    this.layers.set(layerId, out);
  }

  /** Applies changed tiles (history): null makes a tile transparent. */
  write(layerId: string, tiles: ReadonlyMap<number, Uint8Array | null>) {
    let layer = this.layers.get(layerId);
    if (!layer) this.layers.set(layerId, (layer = new Map()));
    for (const [key, data] of tiles) {
      if (data === null) layer.delete(key);
      else layer.set(key, data);
    }
  }

  /** Gives `to` the same pixels as `from` (tiles are immutable, so they're shared). */
  copy(from: string, to: string) {
    const layer = this.layers.get(from);
    if (layer) this.layers.set(to, new Map(layer));
  }

  /** The layer's tiles as raw bytes, inflating as needed (synchronous). Null if not parked. */
  raw(layerId: string): Map<number, Uint8Array> | null {
    const layer = this.layers.get(layerId);
    if (!layer) return null;
    const out = new Map<number, Uint8Array>();
    for (const [key, t] of layer) out.set(key, isPacked(t) ? unzlibSync(t.zlib) : t);
    return out;
  }

  /** The layer's tiles in history/storage form: raw bytes or zlib Blobs. Null if not parked. */
  tileData(layerId: string): Map<number, TileData> | null {
    const layer = this.layers.get(layerId);
    if (!layer) return null;
    const out = new Map<number, TileData>();
    for (const [key, t] of layer) {
      out.set(key, isPacked(t) ? new Blob([t.zlib as Uint8Array<ArrayBuffer>]) : t);
    }
    return out;
  }

  /** History tiles for a layer that disappears: every tile goes from its content to empty. */
  removal(layerId: string): LayerTiles {
    const out: LayerTiles = new Map();
    for (const [key, t] of this.tileData(layerId) ?? []) out.set(key, { before: t, after: null });
    return out;
  }

  /** Approximate bytes held (raw + deflated). */
  bytes(): number {
    let total = 0;
    for (const layer of this.layers.values()) {
      for (const t of layer.values()) total += isPacked(t) ? t.zlib.byteLength : t.byteLength;
    }
    return total;
  }

  /**
   * Deflates raw tiles, except those of `keepRaw` layers (likely to be uploaded soon). Stops early
   * when `cancelled()` turns true. A tile replaced meanwhile is left alone.
   */
  async compressIdle(keepRaw: ReadonlySet<string>, cancelled: () => boolean) {
    for (const [layerId, layer] of [...this.layers]) {
      if (keepRaw.has(layerId)) continue;
      for (const [key, t] of [...layer]) {
        if (isPacked(t)) continue;
        const blob = await compressTile(t);
        if (cancelled()) return;
        if (!(blob instanceof Blob)) continue;
        const zlib = new Uint8Array(await blob.arrayBuffer());
        if (cancelled()) return;
        if (this.layers.get(layerId) === layer && layer.get(key) === t) layer.set(key, { zlib });
      }
    }
  }
}
