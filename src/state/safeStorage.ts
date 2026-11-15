import type { StateStorage } from 'zustand/middleware';

/** localStorage that never throws (private mode, blocked storage): prefs just won't persist. */
const browserStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

/**
 * Desktop app: preferences live in the library folder (`settings/*.json`), so they follow it.
 * Reads stay synchronous: `platform/desktop.ts` loads every setting before the first render
 * (`connectSettings`), and writes go to disk shortly after, through `persist`.
 */
const memory = new Map<string, string>();
let persist: ((key: string, value: string | null) => void) | null = null;

const libraryStorage: StateStorage = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => {
    memory.set(k, v);
    persist?.(k, v);
  },
  removeItem: (k) => {
    memory.delete(k);
    persist?.(k, null);
  },
};

/**
 * Fills the desktop settings from the library and starts saving changes. Until then nothing is
 * written, so stores created early can't overwrite the stored settings with their defaults.
 */
export function connectSettings(
  values: Record<string, string>,
  write: (key: string, value: string | null) => void,
) {
  memory.clear();
  for (const [k, v] of Object.entries(values)) memory.set(k, v);
  persist = write;
}

export const safeStorage: StateStorage = __DESKTOP__ ? libraryStorage : browserStorage;
