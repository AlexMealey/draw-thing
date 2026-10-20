import { DEFAULT_NAME, newProjectId, type SavedDocument } from './document';
import { getDB, type ProjectRecord, type TileId, tileRange } from './db';

export type { ProjectRecord } from './db';

/** Tiles by layer id, then tile key: zlib Blobs, or null for "now transparent". */
export type TileMap = Map<string, Map<number, Blob | null>>;

export interface ProjectSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  thumb: Blob | null;
}

/** Newest first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await getDB();
  const all = await db.getAll('projects');
  return all
    .map(({ id, name, width, height, updatedAt, thumb }) => ({
      id,
      name,
      width,
      height,
      updatedAt,
      thumb,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return (await getDB()).get('projects', id);
}

/** A project's tiles, still compressed (they're inflated as they're uploaded to the GPU). */
export async function loadTiles(projectId: string): Promise<Map<string, Map<number, Blob>>> {
  const db = await getDB();
  const tx = db.transaction('tiles');
  const range = tileRange(projectId);
  const [keys, values] = await Promise.all([
    tx.store.getAllKeys(range),
    tx.store.getAll(range),
    tx.done,
  ]);
  const out = new Map<string, Map<number, Blob>>();
  keys.forEach(([, layerId, key], i) => {
    const blob = values[i];
    if (!blob) return;
    let layer = out.get(layerId);
    if (!layer) out.set(layerId, (layer = new Map()));
    layer.set(key, blob);
  });
  return out;
}

export interface ProjectChanges {
  doc: SavedDocument;
  /** Changed tiles of layers in `doc`. */
  tiles: TileMap;
  /** Layers whose tiles should go entirely (deleted layers). */
  removedLayers: Iterable<string>;
  /** A new thumbnail, or undefined to keep the old one. */
  thumb?: Blob;
  /** Name for a project that doesn't exist yet. */
  name?: string;
  /** `tiles` is the complete set: drop every stored tile first. */
  replaceTiles?: boolean;
}

/**
 * Writes one autosave in a single transaction, so the stored project is always a consistent
 * state: either all of this save or none of it. Creates the project if it isn't stored yet.
 */
export async function saveProject(id: string, changes: ProjectChanges): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'tiles'], 'readwrite');
  const tiles = tx.objectStore('tiles');
  const projects = tx.objectStore('projects');
  const writes: Promise<unknown>[] = [];
  // Requests in a transaction run in order, so the puts below land after these deletes.
  if (changes.replaceTiles) writes.push(tiles.delete(tileRange(id)));
  for (const layerId of changes.removedLayers) writes.push(tiles.delete(tileRange(id, layerId)));
  const keep = new Set(changes.doc.layers.map((l) => l.id));
  for (const [layerId, layer] of changes.tiles) {
    if (!keep.has(layerId)) continue;
    for (const [key, blob] of layer) {
      const tileId: TileId = [id, layerId, key];
      writes.push(blob ? tiles.put(blob, tileId) : tiles.delete(tileId));
    }
  }
  const existing = await projects.get(id);
  const now = Date.now();
  const { doc } = changes;
  writes.push(
    projects.put({
      id,
      name: existing?.name ?? changes.name ?? DEFAULT_NAME,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      width: doc.width,
      height: doc.height,
      thumb: changes.thumb ?? existing?.thumb ?? null,
      doc,
    }),
  );
  await Promise.all([...writes, tx.done]);
}

/** Stores a complete project (an import or a copy) under a new id and returns that id. */
export async function createProject(p: {
  name: string;
  doc: SavedDocument;
  tiles: Map<string, Map<number, Blob>>;
  thumb: Blob | null;
  createdAt?: number;
}): Promise<string> {
  const id = newProjectId();
  const db = await getDB();
  const tx = db.transaction(['projects', 'tiles'], 'readwrite');
  const writes: Promise<unknown>[] = [];
  const store = tx.objectStore('tiles');
  for (const [layerId, layer] of p.tiles) {
    for (const [key, blob] of layer) writes.push(store.put(blob, [id, layerId, key]));
  }
  const now = Date.now();
  writes.push(
    tx.objectStore('projects').put({
      id,
      name: p.name,
      width: p.doc.width,
      height: p.doc.height,
      createdAt: p.createdAt ?? now,
      updatedAt: now,
      thumb: p.thumb,
      doc: p.doc,
    }),
  );
  await Promise.all([...writes, tx.done]);
  return id;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('projects', 'readwrite');
  const p = await tx.store.get(id);
  if (p) await tx.store.put({ ...p, name });
  await tx.done;
}

export async function duplicateProject(id: string): Promise<string | null> {
  const p = await getProject(id);
  if (!p) return null;
  return createProject({
    name: `${p.name} copy`,
    doc: p.doc,
    tiles: await loadTiles(id),
    thumb: p.thumb,
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'tiles', 'meta'], 'readwrite');
  const last = await tx.objectStore('meta').get(LAST_OPEN);
  await Promise.all([
    tx.objectStore('tiles').delete(tileRange(id)),
    tx.objectStore('projects').delete(id),
    last === id ? tx.objectStore('meta').delete(LAST_OPEN) : undefined,
    tx.done,
  ]);
}

const LAST_OPEN = 'lastOpenProject';

/** The project to reopen on launch (crash recovery: it's at most one autosave behind). */
export async function getLastOpen(): Promise<string | null> {
  const id = await (await getDB()).get('meta', LAST_OPEN);
  return typeof id === 'string' ? id : null;
}

export async function setLastOpen(id: string): Promise<void> {
  await (await getDB()).put('meta', id, LAST_OPEN);
}
