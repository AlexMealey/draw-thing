import { invoke } from '@tauri-apps/api/core';
import type {
  NewProject,
  ProjectBackend,
  ProjectChanges,
  ProjectRecord,
  ProjectSummary,
  TileMap,
} from '../backend';
import { DEFAULT_NAME, newProjectId, type SavedDocument } from '../document';
import { decodeFrame, encodeFrame, FrameBody, frameItem } from './frame';

/**
 * The desktop app's storage: the library folder, through the Rust commands in
 * `src-tauri/src/library/commands.rs` (see `store.rs` there for the folder layout). Each save is
 * one framed message that Rust journals, so it lands whole or not at all, as with IndexedDB.
 */

interface StoredSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  hasThumb: boolean;
}

interface StoredProject extends StoredSummary {
  createdAt: number;
  doc: SavedDocument;
}

/** `journal::SaveHeader` in Rust. */
export interface SaveHeader {
  id: string;
  name: string;
  createdAt?: number;
  now: number;
  width: number;
  height: number;
  doc: SavedDocument;
  replaceTiles: boolean;
  removedLayers: string[];
  /** `[layer, key, offset, length]`; length -1 deletes the tile. */
  tiles: [string, number, number, number][];
  thumb: [number, number] | null;
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Frames one save: its tiles (those of layers still in the document) and thumbnail. */
export async function encodeSave(
  id: string,
  p: {
    doc: SavedDocument;
    tiles: TileMap;
    removedLayers?: Iterable<string>;
    thumb?: Blob | null;
    name?: string;
    createdAt?: number;
    replaceTiles?: boolean;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const body = new FrameBody();
  const keep = new Set(p.doc.layers.map((l) => l.id));
  const tiles: SaveHeader['tiles'] = [];
  for (const [layerId, layer] of p.tiles) {
    if (!keep.has(layerId)) continue;
    for (const [key, blob] of layer) {
      tiles.push(blob ? [layerId, key, ...body.add(await bytes(blob))] : [layerId, key, 0, -1]);
    }
  }
  const header: SaveHeader = {
    id,
    name: p.name ?? DEFAULT_NAME,
    createdAt: p.createdAt,
    now: Date.now(),
    width: p.doc.width,
    height: p.doc.height,
    doc: p.doc,
    replaceTiles: p.replaceTiles ?? false,
    removedLayers: [...(p.removedLayers ?? [])],
    tiles,
    thumb: p.thumb ? body.add(await bytes(p.thumb)) : null,
  };
  return encodeFrame(header, body);
}

/** Rust's `load_tiles` frame back into tile Blobs. */
export function decodeTiles(buf: ArrayBuffer): Map<string, Map<number, Blob>> {
  const { header, body } = decodeFrame<[string, number, number, number][]>(buf);
  const out = new Map<string, Map<number, Blob>>();
  for (const [layerId, key, offset, length] of header) {
    let layer = out.get(layerId);
    if (!layer) out.set(layerId, (layer = new Map()));
    layer.set(key, new Blob([frameItem(body, offset, length)]));
  }
  return out;
}

async function thumb(id: string): Promise<Blob | null> {
  const buf = await invoke<ArrayBuffer>('library_thumb', { id });
  return buf.byteLength > 0 ? new Blob([buf], { type: 'image/png' }) : null;
}

async function getProject(id: string): Promise<ProjectRecord | undefined> {
  const p = await invoke<StoredProject | null>('library_get', { id });
  if (!p) return undefined;
  const { hasThumb, ...record } = p;
  return { ...record, thumb: hasThumb ? await thumb(id) : null };
}

async function createProject(p: NewProject): Promise<string> {
  const id = newProjectId();
  await invoke('library_save', await encodeSave(id, { ...p, replaceTiles: true }));
  return id;
}

export const fsBackend: ProjectBackend = {
  async listProjects(): Promise<ProjectSummary[]> {
    const list = await invoke<StoredSummary[]>('library_list');
    return Promise.all(
      list.map(async ({ hasThumb, ...s }) => ({
        ...s,
        thumb: hasThumb ? await thumb(s.id) : null,
      })),
    );
  },

  getProject,

  async loadTiles(projectId) {
    return decodeTiles(await invoke<ArrayBuffer>('library_load_tiles', { id: projectId }));
  },

  async saveProject(id: string, changes: ProjectChanges) {
    await invoke('library_save', await encodeSave(id, changes));
  },

  createProject,

  async renameProject(id, name) {
    await invoke('library_rename', { id, name });
  },

  async duplicateProject(id) {
    const p = await invoke<StoredProject | null>('library_get', { id });
    if (!p) return null;
    const newId = newProjectId();
    const done = await invoke<boolean>('library_duplicate', {
      id,
      newId,
      name: `${p.name} copy`,
      now: Date.now(),
    });
    return done ? newId : null;
  },

  async deleteProject(id) {
    await invoke('library_delete', { id });
  },

  getLastOpen: () => invoke<string | null>('library_last_open'),

  async setLastOpen(id) {
    await invoke('library_set_last_open', { id });
  },
};
