import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedDocument } from '../document';
import { decodeFrame, encodeFrame, FrameBody, frameItem } from './frame';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { decodeTiles, fsBackend } = await import('./fsBackend');
type SaveHeader = import('./fsBackend').SaveHeader;

const doc = (...ids: string[]) =>
  ({
    schema: 1,
    width: 512,
    height: 256,
    tileSize: 256,
    layers: ids.map((id) => ({ id })),
    activeLayerId: ids[0],
  }) as unknown as SavedDocument;

const blob = (...bytes: number[]) => new Blob([new Uint8Array(bytes)]);

/** The save `library_save` was last called with. */
function lastSave() {
  const call = invoke.mock.calls.findLast(([cmd]) => cmd === 'library_save');
  const buf = call?.[1] as Uint8Array<ArrayBuffer>;
  return decodeFrame<SaveHeader>(buf.buffer);
}

beforeEach(() => {
  invoke.mockReset();
});

describe('fsBackend', () => {
  it('frames a save: kept layers only, deletions, thumbnail', async () => {
    invoke.mockResolvedValue(undefined);
    await fsBackend.saveProject('prj-1', {
      doc: doc('L1'),
      tiles: new Map([
        [
          'L1',
          new Map<number, Blob | null>([
            [0, blob(1, 2)],
            [3, null],
          ]),
        ],
        ['gone', new Map<number, Blob | null>([[0, blob(7)]])],
      ]),
      removedLayers: ['L2'],
      thumb: blob(9),
    });
    const { header, body } = lastSave();
    expect(header).toMatchObject({
      id: 'prj-1',
      name: 'Untitled Artwork',
      width: 512,
      height: 256,
      replaceTiles: false,
      removedLayers: ['L2'],
      tiles: [
        ['L1', 0, 0, 2],
        ['L1', 3, 0, -1],
      ],
      thumb: [2, 1],
    });
    expect([...frameItem(body, 0, 2)]).toEqual([1, 2]);
    expect([...frameItem(body, 2, 1)]).toEqual([9]);
  });

  it('creates a project as one complete save under a new id', async () => {
    invoke.mockResolvedValue(undefined);
    const id = await fsBackend.createProject({
      name: 'Imported',
      doc: doc('L1'),
      tiles: new Map([['L1', new Map([[5, blob(4)]])]]),
      thumb: null,
      createdAt: 42,
    });
    const { header } = lastSave();
    expect(header).toMatchObject({ id, name: 'Imported', createdAt: 42, replaceTiles: true });
    expect(header.thumb).toBeNull();
  });

  it('reads tiles in the frame Rust sends', async () => {
    const body = new FrameBody();
    const header = [
      ['L1', 0, ...body.add(new Uint8Array([1, 2]))],
      ['L1', 4, ...body.add(new Uint8Array([3]))],
      ['L2', 1, ...body.add(new Uint8Array([5]))],
    ];
    const tiles = decodeTiles(encodeFrame(header, body).buffer);
    expect([...tiles.keys()]).toEqual(['L1', 'L2']);
    expect(new Uint8Array(await tiles.get('L1')!.get(4)!.arrayBuffer())).toEqual(
      new Uint8Array([3]),
    );
  });

  it('lists artwork, fetching only the thumbnails that exist', async () => {
    invoke.mockImplementation((cmd: string, args?: { id: string }) => {
      if (cmd === 'library_list') {
        return Promise.resolve([
          { id: 'a', name: 'A', width: 1, height: 1, updatedAt: 2, hasThumb: true },
          { id: 'b', name: 'B', width: 1, height: 1, updatedAt: 1, hasThumb: false },
        ]);
      }
      if (cmd === 'library_thumb' && args?.id === 'a') return Promise.resolve(new ArrayBuffer(3));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const list = await fsBackend.listProjects();
    expect(list.map((p) => [p.id, p.thumb?.size ?? null])).toEqual([
      ['a', 3],
      ['b', null],
    ]);
    expect(list[0]).not.toHaveProperty('hasThumb');
  });

  it('duplicates under a new id and name', async () => {
    invoke.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'library_get' ? { id: 'a', name: 'Cat' } : true),
    );
    const id = await fsBackend.duplicateProject('a');
    expect(invoke).toHaveBeenLastCalledWith(
      'library_duplicate',
      expect.objectContaining({ id: 'a', newId: id, name: 'Cat copy' }),
    );
  });
});
