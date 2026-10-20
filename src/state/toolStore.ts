import { useStore } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { type BrushOverride, resolvePreset } from '../engine/brush/overrides';
import { type BrushPreset, DEFAULT_PRESET_ID, presetById } from '../engine/brush/presets';
import type { ToolSettings } from '../engine/brush/tool';

export type ToolMode = 'paint' | 'erase';

export interface BrushAdjustments {
  size: number;
  opacity: number;
  smoothing: number;
}

export interface ToolState {
  mode: ToolMode;
  /** Selected brush per tool: painting and erasing each have their own, like Procreate. */
  presetIds: Record<ToolMode, string>;
  /** Size/opacity/StreamLine per tool and brush, keyed `${mode}:${presetId}`. */
  adjustments: Record<string, BrushAdjustments>;
  /** Brush Settings edits per preset. */
  overrides: Record<string, BrushOverride>;
  color: string;
  recentColors: string[];
  /** Sidebar on the right, for left-handed drawing. */
  sidebarRight: boolean;
  /** Paint with a finger until a pen has been used. */
  fingerDrawing: boolean;

  setMode(mode: ToolMode): void;
  selectPreset(id: string): void;
  adjust(patch: Partial<BrushAdjustments>): void;
  setOverride(presetId: string, patch: BrushOverride): void;
  resetOverride(presetId: string): void;
  /** `commit` also records the color in the recent colors. */
  setColor(color: string, commit?: boolean): void;
  setPrefs(patch: Partial<Pick<ToolState, 'sidebarRight' | 'fingerDrawing'>>): void;
}

const MAX_RECENT = 10;

/** localStorage that never throws (private mode, blocked storage): prefs just won't persist. */
const safeStorage: StateStorage = {
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

export function defaultAdjustments(preset: BrushPreset, mode: ToolMode): BrushAdjustments {
  return {
    size:
      mode === 'erase'
        ? Math.min(preset.size.max, Math.max(preset.size.default, 40))
        : preset.size.default,
    opacity: preset.opacity,
    smoothing: preset.stabilization,
  };
}

export const toolStore = createStore<ToolState>()(
  persist(
    (set, get) => ({
      mode: 'paint',
      presetIds: { paint: DEFAULT_PRESET_ID, erase: 'airbrush' },
      adjustments: {},
      overrides: {},
      color: '#1c1c1e',
      recentColors: [],
      sidebarRight: false,
      fingerDrawing: true,

      setMode: (mode) => set({ mode }),
      selectPreset: (id) => set({ presetIds: { ...get().presetIds, [get().mode]: id } }),
      adjust: (patch) => {
        const s = get();
        const key = adjustKey(s);
        const current = s.adjustments[key] ?? defaultAdjustments(basePreset(s), s.mode);
        set({ adjustments: { ...s.adjustments, [key]: { ...current, ...patch } } });
      },
      setOverride: (presetId, patch) =>
        set({
          overrides: { ...get().overrides, [presetId]: { ...get().overrides[presetId], ...patch } },
        }),
      resetOverride: (presetId) => {
        const overrides = { ...get().overrides };
        delete overrides[presetId];
        set({ overrides });
      },
      setColor: (color, commit = false) => {
        const recent = commit
          ? [color, ...get().recentColors.filter((c) => c !== color)].slice(0, MAX_RECENT)
          : get().recentColors;
        set({ color, recentColors: recent });
      },
      setPrefs: (patch) => set(patch),
    }),
    {
      name: 'drawthing:tools',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        mode: s.mode,
        presetIds: s.presetIds,
        adjustments: s.adjustments,
        overrides: s.overrides,
        color: s.color,
        recentColors: s.recentColors,
        sidebarRight: s.sidebarRight,
        fingerDrawing: s.fingerDrawing,
      }),
    },
  ),
);

const adjustKey = (s: Pick<ToolState, 'mode' | 'presetIds'>) => `${s.mode}:${s.presetIds[s.mode]}`;
const basePreset = (s: Pick<ToolState, 'mode' | 'presetIds'>) => presetById(s.presetIds[s.mode]);

/** The selected brush for the current tool, with the user's Brush Settings edits applied. */
export function currentPreset(s: ToolState): BrushPreset {
  const base = basePreset(s);
  return resolvePreset(base, s.overrides[base.id]);
}

export function currentAdjustments(s: ToolState): BrushAdjustments {
  return s.adjustments[adjustKey(s)] ?? defaultAdjustments(basePreset(s), s.mode);
}

export function toolSettings(s: ToolState): ToolSettings {
  return {
    preset: currentPreset(s),
    ...currentAdjustments(s),
    color: s.color,
    eraser: s.mode === 'erase',
  };
}

export function useTools<T>(selector: (state: ToolState) => T): T {
  return useStore(toolStore, selector);
}
