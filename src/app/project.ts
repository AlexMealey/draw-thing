import type { Engine } from '../engine/Engine';
import type { Autosaver } from '../persistence/Autosaver';
import { DEFAULT_NAME, newProjectId, type SavedDocument } from '../persistence/document';
import { getLastOpen, getProject, loadTiles } from '../persistence/projects';
import type { Background } from '../state/documentStore';

/** The artwork open in the editor. */
export interface OpenProject {
  /** Changing the key remounts the editor, and with it a fresh engine. */
  key: number;
  id: string;
  name: string;
  size: { w: number; h: number };
  /** Null for a new canvas, which is stored on its first change. */
  doc: SavedDocument | null;
  tiles: Map<string, Map<number, Blob>> | null;
  /** Stored without a thumbnail (e.g. imported): make one once it's loaded. */
  needsThumbnail: boolean;
  /** A new canvas's background (white when absent). */
  background?: Background;
}

/** The live editor's engine and its autosaver. */
export interface Session {
  engine: Engine;
  saver: Autosaver;
}

let mounts = 0;

export function newProject(size: { w: number; h: number }, background?: Background): OpenProject {
  return {
    key: ++mounts,
    id: newProjectId(),
    name: DEFAULT_NAME,
    size,
    doc: null,
    tiles: null,
    needsThumbnail: false,
    background,
  };
}

/** Reads a stored project (null if it no longer exists). */
export async function openProject(id: string): Promise<OpenProject | null> {
  const record = await getProject(id);
  if (!record) return null;
  return {
    key: ++mounts,
    id,
    name: record.name,
    size: { w: record.width, h: record.height },
    doc: record.doc,
    tiles: await loadTiles(id),
    needsThumbnail: record.thumb === null,
  };
}

/** On launch: the artwork that was open last time (crash recovery), else a new canvas. */
export async function openLast(fallbackSize: { w: number; h: number }): Promise<OpenProject> {
  try {
    const id = await getLastOpen();
    const p = id ? await openProject(id) : null;
    if (p) return p;
  } catch (err) {
    console.error('Couldn’t reopen the last artwork', err); // e.g. storage blocked
  }
  return newProject(fallbackSize);
}
