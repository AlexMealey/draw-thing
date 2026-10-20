import type { Rect, Target } from '../gl/target';
import type { LayerTiles } from './History';
import { allTiles, isEmpty, sameBytes, TILE, type TileGrid, tileRect, tilesIn } from './tiles';

/** Reads and writes RGBA8 layer textures tile by tile (texture row y = document row y). */
export class TileIO {
  private zeros = new Uint8Array(TILE * TILE * 4);

  constructor(
    private gl: WebGL2RenderingContext,
    readonly grid: TileGrid,
  ) {}

  /** Synchronous readback of every non-empty tile. For layer operations, not strokes. */
  readAll(target: Target): Map<number, Uint8Array> {
    const gl = this.gl;
    const out = new Map<number, Uint8Array>();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
    for (const key of allTiles(this.grid)) {
      const r = tileRect(this.grid, key);
      const data = new Uint8Array(r.w * r.h * 4);
      gl.readPixels(r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      if (!isEmpty(data)) out.set(key, data);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return out;
  }

  /** Writes tiles; null clears the tile. */
  write(target: Target, tiles: ReadonlyMap<number, Uint8Array | null>) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (const [key, data] of tiles) {
      const r = tileRect(this.grid, key);
      const bytes = data ?? this.zeros.subarray(0, r.w * r.h * 4);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    }
  }

  /**
   * Starts an asynchronous before/after capture of a tile-aligned region: call `after()` once the
   * change has been drawn. The GPU copies into pixel-pack buffers; nothing blocks until `finish()`.
   */
  capture(target: Target, region: Rect): Capture {
    return new Capture(this.gl, this.grid, target, region);
  }

  /** Before/after change set for whole layers (layer operations). */
  static diff(before: Map<number, Uint8Array>, after: Map<number, Uint8Array>): LayerTiles {
    const out: LayerTiles = new Map();
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(key) ?? null;
      const a = after.get(key) ?? null;
      if (!sameBytes(b, a)) out.set(key, { before: b, after: a });
    }
    return out;
  }
}

export class Capture {
  private before: WebGLBuffer;
  private afterBuf: WebGLBuffer | null = null;
  private fence: WebGLSync | null = null;
  private bytes: number;

  constructor(
    private gl: WebGL2RenderingContext,
    private grid: TileGrid,
    private target: Target,
    private region: Rect,
  ) {
    this.bytes = region.w * region.h * 4;
    this.before = this.readInto();
  }

  /** Captures the region again after the change, and fences both copies. */
  after() {
    const gl = this.gl;
    this.afterBuf = this.readInto();
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  /** True once the GPU has finished both copies, so finish() won't stall. */
  ready(): boolean {
    if (!this.fence) return false;
    const status = this.gl.clientWaitSync(this.fence, 0, 0);
    return status === this.gl.ALREADY_SIGNALED || status === this.gl.CONDITION_SATISFIED;
  }

  /** Returns the changed tiles (identical ones dropped) and frees the GPU buffers. */
  finish(): LayerTiles {
    const gl = this.gl;
    const before = this.download(this.before);
    const after = this.afterBuf ? this.download(this.afterBuf) : before;
    gl.deleteBuffer(this.before);
    if (this.afterBuf) gl.deleteBuffer(this.afterBuf);
    if (this.fence) gl.deleteSync(this.fence);

    const out: LayerTiles = new Map();
    for (const key of tilesIn(this.grid, this.region)) {
      const b = this.slice(before, key);
      const a = this.slice(after, key);
      if (!sameBytes(b, a)) out.set(key, { before: b, after: a });
    }
    return out;
  }

  private readInto(): WebGLBuffer {
    const gl = this.gl;
    const { x, y, w, h } = this.region;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.bytes, gl.STREAM_READ);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.target.fbo);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return buf;
  }

  private download(buf: WebGLBuffer): Uint8Array {
    const gl = this.gl;
    const data = new Uint8Array(this.bytes);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return data;
  }

  /** Copies one tile out of the region buffer; null when it's fully transparent. */
  private slice(region: Uint8Array, key: number): Uint8Array | null {
    const r = tileRect(this.grid, key);
    const stride = this.region.w * 4;
    const rowBytes = r.w * 4;
    const tile = new Uint8Array(r.w * r.h * 4);
    for (let row = 0; row < r.h; row++) {
      const src = (r.y - this.region.y + row) * stride + (r.x - this.region.x) * 4;
      tile.set(region.subarray(src, src + rowBytes), row * rowBytes);
    }
    return isEmpty(tile) ? null : tile;
  }
}
