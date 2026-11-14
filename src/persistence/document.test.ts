import { describe, expect, it } from 'vitest';
import { documentStore } from '../state/documentStore';
import { parseSavedDocument, type SavedDocument, toSaved } from './document';

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

describe('saved frames', () => {
  const animated: SavedDocument = {
    ...valid,
    layers: [
      { ...layer('a1', 'g1'), frameId: 'f1' },
      { ...layer('b1', null), frameId: 'f2' },
      { ...layer('a2', null), frameId: 'f1' },
    ],
    groups: [group('g1')],
    activeLayerId: 'b1',
    frames: [
      { id: 'f1', hold: 2, activeLayerId: 'a2' },
      { id: 'f2', hold: 1, activeLayerId: 'b1' },
    ],
    activeFrameId: 'f2',
    animation: { enabled: true, fps: 24 },
  };

  it('keeps frames, holds and the frame rate, with each frame’s layers together', () => {
    const doc = parseSavedDocument(JSON.parse(JSON.stringify(animated)));
    expect(doc.layers.map((l) => [l.id, l.frameId])).toEqual([
      ['a1', 'f1'],
      ['a2', 'f1'],
      ['b1', 'f2'],
    ]);
    expect(doc.frames).toEqual(animated.frames);
    expect(doc.activeFrameId).toBe('f2');
    expect(doc.activeLayerId).toBe('b1');
    expect(doc.animation).toEqual({ enabled: true, fps: 24 });
  });

  it('repairs frames: unknown tags go to the first frame, empty frames go, bad holds clamp', () => {
    const doc = parseSavedDocument({
      ...animated,
      layers: [
        { ...layer('a1', null), frameId: 'ghost' },
        { ...layer('b1', null), frameId: 'f2' },
      ],
      groups: [],
      frames: [
        { id: 'f1', hold: -4, activeLayerId: 'missing' },
        { id: 'f2', hold: 1.6 },
        { id: 'f3', hold: 1 },
      ],
      activeFrameId: 'f3',
      animation: { enabled: 'yes', fps: 900 },
    });
    expect(doc.frames).toEqual([
      { id: 'f1', hold: 1, activeLayerId: 'a1' },
      { id: 'f2', hold: 2, activeLayerId: 'b1' },
    ]);
    expect(doc.layers.map((l) => l.frameId)).toEqual(['f1', 'f2']);
    expect(doc.activeFrameId).toBe('f1');
    expect(doc.activeLayerId).toBe('a1');
    expect(doc.animation).toEqual({ enabled: false, fps: 60 });
  });

  it('rejects bad frame ids', () => {
    expect(() => parseSavedDocument({ ...animated, frames: [{ id: '../x', hold: 1 }] })).toThrow(
      /frame id/,
    );
    expect(() =>
      parseSavedDocument({
        ...animated,
        frames: [
          { id: 'f', hold: 1 },
          { id: 'f', hold: 1 },
        ],
      }),
    ).toThrow(/frame id/);
  });

  it('round-trips through the store', () => {
    const parsed = parseSavedDocument(JSON.parse(JSON.stringify(animated)));
    documentStore.getState().load({ ...parsed, maxLayers: 10 });
    const saved = toSaved(documentStore.getState());
    expect(parseSavedDocument(JSON.parse(JSON.stringify(saved)))).toEqual(parsed);
  });
});
