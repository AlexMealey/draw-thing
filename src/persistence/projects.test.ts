import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDBForTests } from './db';
import type { SavedDocument } from './document';
import {
  deleteProject,
  duplicateProject,
  getLastOpen,
  getProject,
  listProjects,
  loadTiles,
  renameProject,
  saveProject,
  setLastOpen,
} from './projects';

const layer = (id: string) => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'normal' as const,
  locked: false,
  alphaLocked: false,
  groupId: null,
});

const doc = (...ids: string[]): SavedDocument => ({
  schema: 1,
  width: 512,
  height: 512,
  tileSize: 256,
  background: { color: '#ffffff', visible: true },
  layers: ids.map(layer),
  activeLayerId: ids[0]!,
  layerCounter: ids.length,
});

const tile = (n: number) => new Blob([new Uint8Array([n])]);
const keysOf = (m: Map<string, Map<number, Blob>>) =>
  Object.fromEntries([...m].map(([id, t]) => [id, [...t.keys()].sort()]));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDBForTests();
});

describe('project storage', () => {
  it('creates a project on its first save and applies tile changes incrementally', async () => {
    await saveProject('p1', {
      doc: doc('a', 'b'),
      tiles: new Map([
        [
          'a',
          new Map([
            [0, tile(1)],
            [1, tile(2)],
          ]),
        ],
        ['b', new Map([[3, tile(3)]])],
      ]),
      removedLayers: [],
      name: 'First',
    });
    expect(keysOf(await loadTiles('p1'))).toEqual({ a: [0, 1], b: [3] });

    // Tile 0 cleared, tile 2 painted, layer b deleted.
    await saveProject('p1', {
      doc: doc('a'),
      tiles: new Map([
        [
          'a',
          new Map([
            [0, null],
            [2, tile(4)],
          ]),
        ],
      ]),
      removedLayers: ['b'],
    });
    expect(keysOf(await loadTiles('p1'))).toEqual({ a: [1, 2] });
    const p = await getProject('p1');
    expect(p).toMatchObject({ name: 'First', width: 512 });
    expect(p!.doc.layers.map((l) => l.id)).toEqual(['a']);
  });

  it('replaces every tile on a full save', async () => {
    const tiles = new Map([
      [
        'a',
        new Map([
          [0, tile(1)],
          [1, tile(2)],
        ]),
      ],
    ]);
    await saveProject('p1', { doc: doc('a'), tiles, removedLayers: [] });
    await saveProject('p1', {
      doc: doc('a'),
      tiles: new Map([['a', new Map([[3, tile(5)]])]]),
      removedLayers: [],
      replaceTiles: true,
    });
    expect(keysOf(await loadTiles('p1'))).toEqual({ a: [3] });
  });

  it('lists, renames, duplicates and deletes, keeping projects apart', async () => {
    const tiles = new Map([['a', new Map([[0, tile(1)]])]]);
    await saveProject('p1', { doc: doc('a'), tiles, removedLayers: [], name: 'One' });
    await saveProject('p2', { doc: doc('a'), tiles, removedLayers: [], name: 'Two' });
    await setLastOpen('p1');

    await renameProject('p1', 'Renamed');
    const copy = await duplicateProject('p1');
    expect(copy).not.toBeNull();
    expect((await listProjects()).map((p) => p.name).sort()).toEqual([
      'Renamed',
      'Renamed copy',
      'Two',
    ]);
    expect(keysOf(await loadTiles(copy!))).toEqual({ a: [0] });

    await deleteProject('p1');
    expect(await getProject('p1')).toBeUndefined();
    expect((await loadTiles('p1')).size).toBe(0);
    expect(keysOf(await loadTiles('p2'))).toEqual({ a: [0] });
    expect(await getLastOpen()).toBeNull(); // it pointed at the deleted project
  });
});
