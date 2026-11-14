import { useStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { safeStorage } from './safeStorage';

/** A named list of colors (`#rrggbb`), in the order they were added. */
export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

/** A palette as read from a file or made from an image, before it gets an id. */
export interface PaletteInput {
  name: string;
  colors: readonly string[];
}

export interface PaletteState {
  palettes: Palette[];
  /** The palette shown in the color panel. */
  activeId: string | null;

  /** Adds a palette (its name made unique) and returns its id. */
  create(name: string, colors?: readonly string[]): string;
  rename(id: string, name: string): void;
  /** Deletes a palette; the color panel then shows the first one left. */
  remove(id: string): void;
  setActive(id: string): void;
  addColor(id: string, color: string): void;
  removeColor(id: string, index: number): void;
  /** Adds palettes read from a file; returns their ids. */
  importPalettes(list: readonly PaletteInput[]): string[];
}

/** Longest palette kept: a .gpl file can hold 256 colors. */
export const MAX_PALETTE_COLORS = 256;

export const DEFAULT_PALETTE: readonly string[] = [
  '#1c1c1e',
  '#48484a',
  '#8e8e93',
  '#d1d1d6',
  '#f2f2f7',
  '#ffffff',
  '#ac8e68',
  '#6b4f2e',
  '#ff375f',
  '#ff453a',
  '#ff9f0a',
  '#ffd60a',
  '#30d158',
  '#64d2ff',
  '#0a84ff',
  '#bf5af2',
];

let paletteSeq = 0;
function newPaletteId(): string {
  paletteSeq += 1;
  return `palette-${Date.now().toString(36)}-${paletteSeq}${Math.random().toString(36).slice(2, 6)}`;
}

/** "Palette" → "Palette 2" when that name is taken: the first number no palette has yet. */
function uniqueName(name: string, palettes: readonly Palette[]): string {
  const taken = new Set(palettes.map((p) => p.name));
  const wanted = name.trim() || 'Palette';
  if (!taken.has(wanted)) return wanted;
  const base = wanted.replace(/ \d+$/, '');
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export const paletteStore = createStore<PaletteState>()(
  persist(
    (set, get) => ({
      palettes: [{ id: 'default', name: 'Default', colors: [...DEFAULT_PALETTE] }],
      activeId: 'default',

      create: (name, colors = []) => {
        const s = get();
        const palette = {
          id: newPaletteId(),
          name: uniqueName(name, s.palettes),
          colors: colors.slice(0, MAX_PALETTE_COLORS),
        };
        set({ palettes: [...s.palettes, palette], activeId: s.activeId ?? palette.id });
        return palette.id;
      },
      rename: (id, name) => {
        const s = get();
        const others = s.palettes.filter((p) => p.id !== id);
        set({
          palettes: s.palettes.map((p) =>
            p.id === id ? { ...p, name: uniqueName(name, others) } : p,
          ),
        });
      },
      remove: (id) => {
        const s = get();
        const palettes = s.palettes.filter((p) => p.id !== id);
        set({
          palettes,
          activeId: s.activeId === id ? (palettes[0]?.id ?? null) : s.activeId,
        });
      },
      setActive: (id) => {
        if (get().palettes.some((p) => p.id === id)) set({ activeId: id });
      },
      addColor: (id, color) =>
        set({
          palettes: get().palettes.map((p) =>
            p.id === id && p.colors.length < MAX_PALETTE_COLORS
              ? { ...p, colors: [...p.colors, color] }
              : p,
          ),
        }),
      removeColor: (id, index) =>
        set({
          palettes: get().palettes.map((p) =>
            p.id === id ? { ...p, colors: p.colors.filter((_, i) => i !== index) } : p,
          ),
        }),
      importPalettes: (list) => list.map((p) => get().create(p.name, p.colors)),
    }),
    {
      name: 'drawthing:palettes',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ palettes: s.palettes, activeId: s.activeId }),
    },
  ),
);

export function activePalette(s: Pick<PaletteState, 'palettes' | 'activeId'>): Palette | null {
  return s.palettes.find((p) => p.id === s.activeId) ?? null;
}

export function usePalettes<T>(selector: (state: PaletteState) => T): T {
  return useStore(paletteStore, selector);
}
