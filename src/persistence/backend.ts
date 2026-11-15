import type { ProjectRecord } from './db';
import type { SavedDocument } from './document';

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
 * Where artwork is stored: IndexedDB on the web (`idbBackend`), the library folder in the
 * desktop app (`desktop/fsBackend`). `projects.ts` picks one; nothing else needs to know which.
 */
export interface ProjectBackend {
  /** Newest first. */
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<ProjectRecord | undefined>;
  /** A project's tiles, still compressed. */
  loadTiles(projectId: string): Promise<Map<string, Map<number, Blob>>>;
  /** One autosave, all or nothing. Creates the project if it isn't stored yet. */
  saveProject(id: string, changes: ProjectChanges): Promise<void>;
  /** Stores a complete project (an import or a copy) under a new id and returns that id. */
  createProject(p: NewProject): Promise<string>;
  renameProject(id: string, name: string): Promise<void>;
  duplicateProject(id: string): Promise<string | null>;
  deleteProject(id: string): Promise<void>;
  /** The project to reopen on launch. */
  getLastOpen(): Promise<string | null>;
  setLastOpen(id: string): Promise<void>;
}

export interface NewProject {
  name: string;
  doc: SavedDocument;
  tiles: Map<string, Map<number, Blob>>;
  thumb: Blob | null;
  createdAt?: number;
}
