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
      groupId: null,
    },
  ],
  groups: [],
  activeLayerId: 'layer-a',
  layerCounter: 3,
  groupCounter: 0,
};

const layer = (id: string, groupId: string | null) => ({ ...valid.layers[0]!, id, groupId });
const group = (id: string) => ({
  id,
  name: 'Group',
  visible: true,
  opacity: 0.8,
  locked: false,
  alphaLocked: true,
  collapsed: false,
});

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

  it('keeps groups', () => {
    const doc = {
      ...valid,
      layers: [layer('a', null), layer('b', 'g'), layer('c', 'g')],
      groups: [group('g')],
      activeLayerId: 'b',
      groupCounter: 4,
    };
    expect(parseSavedDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('opens documents from before groups', () => {
    const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(valid));
    delete legacy.groups;
    delete legacy.groupCounter;
    delete (legacy.layers as Record<string, unknown>[])[0]!.groupId;
    expect(parseSavedDocument(legacy)).toEqual(valid);
  });

  it('repairs groups: unknown, split and empty ones', () => {
    const doc = parseSavedDocument({
      ...valid,
      layers: [layer('a', 'g'), layer('b', null), layer('c', 'g'), layer('d', 'nope')],
      groups: [group('g'), group('empty')],
      activeLayerId: 'a',
    });
    expect(doc.layers.map((l) => l.groupId)).toEqual(['g', null, null, null]);
    expect(doc.groups?.map((g) => g.id)).toEqual(['g']);
  });

  it.each([
    ['an unsafe group id', { ...valid, groups: [group('../x')] }],
    ['a group id shared with a layer', { ...valid, groups: [group('layer-a')] }],
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
