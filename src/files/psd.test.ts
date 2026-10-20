import { describe, expect, it } from 'vitest';
import { readPsdFile, writePsdFile } from './psd';

describe('PSD', () => {
  it('writes layers that read back with their properties and pixels', () => {
    const red = new Uint8ClampedArray(4 * 3 * 4);
    for (let i = 0; i < red.length; i += 4) red.set([255, 0, 0, 128], i);
    const bytes = writePsdFile({
      width: 20,
      height: 10,
      layers: [
        {
          name: 'Paper',
          visible: false,
          opacity: 1,
          blendMode: 'normal',
          alphaLocked: false,
          left: 0,
          top: 0,
          pixels: null,
        },
        {
          name: 'Ink',
          visible: true,
          opacity: 0.5,
          blendMode: 'color-dodge',
          alphaLocked: true,
          left: 5,
          top: 2,
          pixels: { width: 4, height: 3, data: red },
        },
      ],
    });
    const psd = readPsdFile(bytes.buffer as ArrayBuffer);
    expect(psd).toMatchObject({ width: 20, height: 10, approximated: 0 });
    expect(psd.layers.map((l) => l.name)).toEqual(['Paper', 'Ink']);
    expect(psd.layers[0]).toMatchObject({ visible: false, pixels: null });
    const ink = psd.layers[1]!;
    expect(ink).toMatchObject({ blendMode: 'color-dodge', alphaLocked: true, left: 5, top: 2 });
    expect(ink.opacity).toBeCloseTo(0.5, 2);
    expect(ink.pixels).toMatchObject({ width: 4, height: 3 });
    expect([...ink.pixels!.data.subarray(0, 4)]).toEqual([255, 0, 0, 128]);
  });
});
