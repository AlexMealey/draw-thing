import { describe, expect, it } from 'vitest';
import { parseSavedDocument, type SavedDocument } from './document';

const valid: SavedDocument = {
  schema: 1,
  width: 800,
  height: 600,
  tileSize: 256,
  background: { color: '#ffffff', visible: true },
  layers: [
    {
      id: 'layer-a',
      name: 'Sketch',
      visible: true,
      opacity: 0.5,
      blendMode: 'multiply',
      locked: false,
      alphaLocked: true,
    },
  ],
  activeLayerId: 'layer-a',
  layerCounter: 3,
};

describe('parseSavedDocument', () => {
  it('accepts a valid document unchanged', () => {
    expect(parseSavedDocument(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('repairs what it can', () => {
    const doc = parseSavedDocument({
      ...valid,
      layers: [{ ...valid.layers[0], blendMode: 'dissolve', opacity: 7 }],
      activeLayerId: 'missing',
      layerCounter: -1,
    });
    expect(doc.layers[0]).toMatchObject({ blendMode: 'normal', opacity: 1 });
    expect(doc.activeLayerId).toBe('layer-a');
    expect(doc.layerCounter).toBe(1);
  });

  it.each([
    ['a newer version', { ...valid, schema: 2 }],
    ['an oversized canvas', { ...valid, width: 100_000 }],
    ['no layers', { ...valid, layers: [] }],
    ['an unsafe layer id', { ...valid, layers: [{ ...valid.layers[0], id: '../x' }] }],
    ['duplicate layer ids', { ...valid, layers: [valid.layers[0], valid.layers[0]] }],
    ['a bad background', { ...valid, background: { color: 'red' } }],
  ])('rejects %s', (_, doc) => {
    expect(() => parseSavedDocument(doc)).toThrow(/Not a DrawThing document/);
  });
});
