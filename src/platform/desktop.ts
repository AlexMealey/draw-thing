import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { encodeFrame, FrameBody } from '../persistence/desktop/frame';
import { paletteStore } from '../state/paletteStore';
import { connectSettings } from '../state/safeStorage';
import { toolStore } from '../state/toolStore';
import { pwaStore } from './pwa';

/**
 * The desktop app (Tauri, `src-tauri/`) in place of `startPwa`: preferences from the library
 * folder, and files the app is opened with. Only bundled in the desktop build.
 */
export async function startDesktop() {
  try {
    connectSettings(await invoke<Record<string, string>>('settings_read_all'), queueSetting);
  } catch (err) {
    // Without the stored settings, saving would replace them with defaults: run without saving.
    console.error('Couldn’t read the settings; changes won’t be kept this time', err);
  }
  await Promise.all([toolStore.persist.rehydrate(), paletteStore.persist.rehydrate()]);
  window.addEventListener('pagehide', () => void flushSettings());

  void listen('open-files', () => void takeLaunchFiles());
  void takeLaunchFiles(); // the files it was started with
  void listen('close-requested', () => void close());
}

// --- Closing -------------------------------------------------------------------------------

const closeHooks = new Set<() => Promise<void>>();

/**
 * Runs `save` before the window closes (the open artwork's autosave). Rust holds the close
 * until everything is saved (`src-tauri/src/closing.rs`). Returns the unregister function.
 */
export function beforeClose(save: () => Promise<void>): () => void {
  closeHooks.add(save);
  return () => closeHooks.delete(save);
}

async function close() {
  await Promise.allSettled([...closeHooks].map((save) => save()));
  await flushSettings();
  await invoke('app_close');
}

// --- Settings ------------------------------------------------------------------------------

const SETTINGS_DELAY_MS = 250;
const pending = new Map<string, string | null>();
let settingsTimer: ReturnType<typeof setTimeout> | undefined;

function queueSetting(key: string, value: string | null) {
  pending.set(key, value);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => void flushSettings(), SETTINGS_DELAY_MS);
}

async function flushSettings() {
  clearTimeout(settingsTimer);
  const writes = [...pending];
  pending.clear();
  await Promise.all(
    writes.map(([key, value]) =>
      invoke('settings_write', { key, value }).catch((err: unknown) =>
        console.error(`Couldn’t save ${key}`, err),
      ),
    ),
  );
}

// --- Opened files --------------------------------------------------------------------------

const TYPES: Record<string, string> = {
  psd: 'image/vnd.adobe.photoshop',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The last part of a path, for either separator. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

async function takeLaunchFiles() {
  try {
    const paths = await invoke<string[]>('launch_take');
    if (paths.length === 0) return;
    const files = await Promise.all(
      paths.map(async (path) => {
        const name = baseName(path);
        const ext = name.toLowerCase().split('.').pop() ?? '';
        const bytes = await invoke<ArrayBuffer>('launch_read', { path });
        return new File([bytes], name, { type: TYPES[ext] ?? '' });
      }),
    );
    pwaStore.setState({ launchFiles: files });
  } catch (err) {
    console.error('Couldn’t read the opened files', err);
  }
}

// --- The library folder --------------------------------------------------------------------

export interface LibraryInfo {
  path: string;
  defaultPath: string;
  bytes: number;
  /** The chosen folder, when it couldn't be opened and the default is in use instead. */
  unavailable: string | null;
}

/** What a picked folder holds; see `location::FolderKind` in Rust. */
export type FolderKind = 'current' | 'nested' | 'library' | 'empty' | 'other-files' | 'unwritable';

export const libraryInfo = () => invoke<LibraryInfo>('library_info');

/** The system folder chooser; null if cancelled. */
export const pickLibraryFolder = () => invoke<string | null>('library_pick_folder');

export const inspectFolder = (path: string) => invoke<FolderKind>('library_inspect', { path });

export const revealLibrary = () => invoke<void>('library_reveal');

/** `path`'s `DrawThing` subfolder, with the separator the path already uses. */
export function subfolder(path: string): string {
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/';
  return `${path.replace(/[\\/]+$/, '')}${sep}DrawThing`;
}

/**
 * Moves the library to `path` ('move'), or switches to the library there, or a new one
 * ('switch'), then reloads so everything is read from there. Save the open artwork first.
 */
export async function setLibrary(path: string, mode: 'move' | 'switch') {
  await flushSettings();
  await invoke('library_set', { path, mode });
  location.reload();
}

// --- Exports -------------------------------------------------------------------------------

/** The Save dialog, starting in the library's Exports folder; false if cancelled. */
export async function saveExport(blob: Blob, filename: string): Promise<boolean> {
  const body = new FrameBody();
  body.add(new Uint8Array(await blob.arrayBuffer()));
  return invoke<boolean>('export_save', encodeFrame({ filename }, body));
}
