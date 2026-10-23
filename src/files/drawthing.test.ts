import { describe, expect, it } from 'vitest';
import type { SavedDocument } from '../persistence/document';
import { decodeDrawthing, encodeDrawthing } from './drawthing';

const doc: SavedDocument = {
  schema: 1,
  width: 600,
  height: 300,
  tileSize: 256,
  background: { color: '#123456', visible: false },
  layers: [
    {
      id: 'layer-1',
      name: 'Ink',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
      alphaLocked: false,
      groupId: null,
    },
  ],
  groups: [],
  activeLayerId: 'layer-1',
  layerCounter: 1,
  groupCounter: 0,
};

const bytes = (b: Blob) => b.arrayBuffer().then((a) => [...new Uint8Array(a)]);

describe('.drawthing files', () => {
  it('round-trips the document, tiles and thumbnail', async () => {
    const tiles = new Map([
      [
        'layer-1',
        new Map([
          [0, new Blob([new Uint8Array([1, 2, 3])])],
          [5, new Blob([new Uint8Array([4, 5])])], // tile (2, 1) of a 3-column grid
        ]),
      ],
    ]);
    const thumb = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const file = await encodeDrawthing({ name: 'Cat', createdAt: 42, doc, tiles, thumb });
    const back = await decodeDrawthing(file);
    expect(back.name).toBe('Cat');
    expect(back.createdAt).toBe(42);
    expect(back.doc).toEqual(doc);
    expect([...back.tiles.get('layer-1')!.keys()].sort()).toEqual([0, 5]);
    expect(await bytes(back.tiles.get('layer-1')!.get(5)!)).toEqual([4, 5]);
    expect(await bytes(back.thumb!)).toEqual([9, 9]);
  });

  it('rejects other files', async () => {
    await expect(decodeDrawthing(new Blob(['hello']))).rejects.toThrow(/not a zip/);
  });
});
