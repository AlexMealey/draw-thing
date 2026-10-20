import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { SavedDocument } from './document';

/** One artwork in the gallery. Its pixels are in the `tiles` store. */
export interface ProjectRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  /** Gallery thumbnail (PNG), refreshed at most every few seconds while drawing. */
  thumb: Blob | null;
  doc: SavedDocument;
}

/** [projectId, layerId, tile key]. Tile keys are row-major in the document's 256² grid. */
export type TileId = [string, string, number];

/**
 * ROADMAP §6.2. Tiles are zlib-deflated premultiplied RGBA8; fully transparent tiles are simply
 * absent. Compound keys keep a project's (or a layer's) tiles in one contiguous key range.
 */
interface DrawThingDB extends DBSchema {
  projects: { key: string; value: ProjectRecord };
  tiles: { key: TileId; value: Blob };
  meta: { key: string; value: unknown };
}

export type DB = IDBPDatabase<DrawThingDB>;

let db: Promise<DB> | null = null;

export function getDB(): Promise<DB> {
  db ??= openDB<DrawThingDB>('drawthing', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('tiles');
      d.createObjectStore('meta');
    },
    // Another tab upgraded the schema: let it, and reopen on next use.
    blocking() {
      void db?.then((d) => d.close());
      db = null;
    },
  });
  return db;
}

/** Every tile of a project (or of one layer): arrays sort after numbers and strings. */
export function tileRange(projectId: string, layerId?: string): IDBKeyRange {
  return layerId === undefined
    ? IDBKeyRange.bound([projectId], [projectId, []])
    : IDBKeyRange.bound([projectId, layerId], [projectId, layerId, []]);
}

/** Test hook: forget the open connection (fake-indexeddb is reset between tests). */
export function resetDBForTests() {
  db = null;
}
