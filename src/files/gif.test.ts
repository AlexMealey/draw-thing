import { describe, expect, it } from 'vitest';
import { GifBuilder } from './gif';

const solid = (w: number, h: number, rgba: number[]) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) px.set(rgba, i);
  return px;
};

/** Delays of the frames (graphic control extensions), and the loop count. */
function scan(b: Uint8Array) {
  const delays: number[] = [];
  let loops: number | null = null;
  const flags: number[] = [];
  for (let i = 0; i < b.length - 8; i++) {
    if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 4) {
      delays.push(b[i + 4]! | (b[i + 5]! << 8));
      flags.push(b[i + 3]!);
    }
    if (String.fromCharCode(...b.subarray(i, i + 11)) === 'NETSCAPE2.0') {
      loops = b[i + 13]! | (b[i + 14]! << 8);
    }
  }
  return { delays, loops, flags };
}

describe('GIF builder', () => {
  it('writes a looping GIF89a with per-frame delays', () => {
    const gif = new GifBuilder({ width: 4, height: 3, transparent: false, repeat: 0 });
    gif.add(solid(4, 3, [255, 0, 0, 255]), 8);
    gif.add(solid(4, 3, [0, 0, 255, 255]), 17);
    const bytes = gif.finish();
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe('GIF89a');
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(4);
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(3);
    const { delays, loops, flags } = scan(bytes);
    expect(delays).toEqual([8, 17]);
    expect(loops).toBe(0);
    expect(flags.every((f) => (f & 1) === 0)).toBe(true); // opaque
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it('marks transparency, and plays once when asked', () => {
    const gif = new GifBuilder({ width: 2, height: 2, transparent: true, repeat: -1 });
    const px = solid(2, 2, [0, 0, 0, 0]);
    px.set([10, 200, 30, 255], 0);
    gif.add(px, 10);
    const { loops, flags } = scan(gif.finish());
    expect(loops).toBeNull();
    expect(flags[0]! & 1).toBe(1);
  });

  it('refuses frames of the wrong size', () => {
    const gif = new GifBuilder({ width: 2, height: 2, transparent: false, repeat: 0 });
    expect(() => gif.add(solid(3, 2, [0, 0, 0, 255]), 10)).toThrow(/wrong size/);
  });
});
