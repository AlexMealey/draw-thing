import { applyPalette, GIFEncoder, quantize } from 'gifenc';

export interface GifOptions {
  width: number;
  height: number;
  /** Keep (1-bit) transparency; otherwise frames are opaque. */
  transparent: boolean;
  /** -1 = play once, 0 = loop forever. */
  repeat: number;
}

/**
 * Builds an animated GIF frame by frame. Each frame gets its own 256-color palette (drawings
 * change color between frames); transparent GIFs use 1-bit alpha.
 */
export class GifBuilder {
  private enc = GIFEncoder();
  private count = 0;

  constructor(private o: GifOptions) {}

  /** Straight-alpha RGBA, width × height. `delayCs`: how long it shows, in centiseconds. */
  add(rgba: Uint8Array | Uint8ClampedArray, delayCs: number) {
    const { width, height, transparent, repeat } = this.o;
    if (rgba.length !== width * height * 4) throw new Error('GIF frame has the wrong size');
    const format = transparent ? 'rgba4444' : 'rgb565';
    const palette = quantize(rgba, 256, transparent ? { format, oneBitAlpha: true } : { format });
    const index = applyPalette(rgba, palette, format);
    const clear = transparent ? palette.findIndex((c) => c[3] === 0) : -1;
    this.enc.writeFrame(index, width, height, {
      palette,
      delay: delayCs * 10,
      repeat,
      transparent: clear >= 0,
      transparentIndex: Math.max(0, clear),
      first: this.count === 0,
    });
    this.count++;
  }

  finish(): Uint8Array {
    this.enc.finish();
    return this.enc.bytes();
  }
}
