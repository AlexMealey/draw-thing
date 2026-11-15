import type { NewProject, ProjectBackend, ProjectChanges } from './backend';
import { idbBackend } from './idbBackend';

export type { ProjectChanges, ProjectRecord, ProjectSummary, TileMap } from './backend';

/**
 * Stored artwork. On the web it's IndexedDB; the desktop app keeps it as files in the library
 * folder. `__DESKTOP__` is a build-time constant, so the web bundle never includes the desktop
 * backend.
 */
let current: Promise<ProjectBackend> | null = null;

function backend(): Promise<ProjectBackend> {
  current ??= __DESKTOP__
    ? import('./desktop/fsBackend').then((m) => m.fsBackend)
    : Promise.resolve(idbBackend);
  return current;
}

/** Newest first. */
export const listProjects = async () => (await backend()).listProjects();

export const getProject = async (id: string) => (await backend()).getProject(id);

/** A project's tiles, still compressed (they're inflated as they're uploaded to the GPU). */
export const loadTiles = async (projectId: string) => (await backend()).loadTiles(projectId);

/**
 * Writes one autosave as a single unit, so the stored project is always a consistent state:
 * either all of this save or none of it. Creates the project if it isn't stored yet.
 */
export const saveProject = async (id: string, changes: ProjectChanges) =>
  (await backend()).saveProject(id, changes);

/** Stores a complete project (an import or a copy) under a new id and returns that id. */
export const createProject = async (p: NewProject) => (await backend()).createProject(p);

export const renameProject = async (id: string, name: string) =>
  (await backend()).renameProject(id, name);

export const duplicateProject = async (id: string) => (await backend()).duplicateProject(id);

export const deleteProject = async (id: string) => (await backend()).deleteProject(id);

/** The project to reopen on launch (crash recovery: it's at most one autosave behind). */
export const getLastOpen = async () => (await backend()).getLastOpen();

export const setLastOpen = async (id: string) => (await backend()).setLastOpen(id);
