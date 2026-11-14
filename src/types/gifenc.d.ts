// gifenc ships without types; this covers the parts DrawThing uses.
declare module 'gifenc' {
  export type GifPalette = number[][];
  export type GifFormat = 'rgb565' | 'rgb444' | 'rgba4444';

  export interface GifFrameOptions {
    palette?: GifPalette;
    /** Milliseconds (written as centiseconds, rounded). */
    delay?: number;
    /** -1 = play once, 0 = loop forever, n = n extra loops (first frame only). */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: GifFormat;
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaThreshold?: number;
      clearAlphaColor?: number;
    },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifFormat,
  ): Uint8Array;
}
