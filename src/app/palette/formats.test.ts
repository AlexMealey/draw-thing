import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseGpl, parseSwatches, readPaletteFile, toGpl, toSwatches } from './formats';

const palette = { name: 'Sunset', colors: ['#ff8800', '#220044', '#ffffff', '#000000'] };

const swatchesZip = (json: unknown) => zipSync({ 'Swatches.json': strToU8(JSON.stringify(json)) });

describe('GIMP palettes', () => {
  it('round-trips', () => {
    expect(parseGpl(toGpl(palette), 'file')).toEqual(palette);
  });

  it('reads names, comments, spacing and colors without names', () => {
    const text = [
      'GIMP Palette',
      'Name: Lospec 4',
      'Columns: 4',
      '# a comment',
      '',
      '  0   0   0\tBlack',
      '255 255 255',
      '15\t56\t15  Dark green',
    ].join('\r\n');
    expect(parseGpl(text, 'file')).toEqual({
      name: 'Lospec 4',
      colors: ['#000000', '#ffffff', '#0f380f'],
    });
  });

  it('falls back to the file name and rejects other text', () => {
    expect(parseGpl('GIMP Palette\n1 2 3\n', 'mine').name).toBe('mine');
    expect(() => parseGpl('hello', 'x')).toThrow();
  });
});

describe('Procreate swatches', () => {
  it('round-trips', () => {
    expect(parseSwatches(toSwatches(palette), 'file')).toEqual([palette]);
  });

  it('skips empty slots and reads arrays of palettes', () => {
    const red = { hue: 0, saturation: 1, brightness: 1, alpha: 1, colorSpace: 0 };
    const cyan = { hue: 0.5, saturation: 1, brightness: 1, alpha: 1, colorSpace: 0 };
    const zip = swatchesZip([
      { name: 'One', swatches: [red, null, cyan] },
      { name: '', swatches: [null] },
    ]);
    expect(parseSwatches(zip, 'file')).toEqual([
      { name: 'One', colors: ['#ff0000', '#00ffff'] },
      { name: 'file', colors: [] },
    ]);
  });

  it('rejects zips without swatches', () => {
    expect(() => parseSwatches(new Uint8Array([1, 2, 3]), 'x')).toThrow(/not a zip/);
    expect(() => parseSwatches(zipSync({ 'a.txt': strToU8('hi') }), 'x')).toThrow(/missing/);
    expect(() => parseSwatches(swatchesZip({ nope: 1 }), 'x')).toThrow(/no palette/);
  });
});

describe('readPaletteFile', () => {
  it('tells the formats apart by content', async () => {
    const zip = new File([toSwatches(palette) as Uint8Array<ArrayBuffer>], 'a.swatches');
    const gpl = new File([toGpl(palette)], 'b.txt');
    expect(await readPaletteFile(zip)).toEqual([palette]);
    expect(await readPaletteFile(gpl)).toEqual([palette]);
    await expect(readPaletteFile(new File(['nope'], 'c.gpl'))).rejects.toThrow();
  });
});
