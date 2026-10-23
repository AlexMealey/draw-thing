import { useStore } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { type BrushOverride, resolvePreset } from '../engine/brush/overrides';
import { type BrushPreset, DEFAULT_PRESET_ID, PRESETS, presetById } from '../engine/brush/presets';
import type { ToolSettings } from '../engine/brush/tool';
import { type Background, DEFAULT_BACKGROUND } from './documentStore';

export type ToolMode = 'paint' | 'erase';
export type ColorPicker = 'square' | 'wheel';

export interface BrushAdjustments {
  size: number;
  opacity: number;
  smoothing: number;
}

/** A brush the user saved from Brush Settings. */
export interface CustomBrush {
  preset: BrushPreset;
  /** Listed above the built-in brushes. */
  pinned: boolean;
}

export interface ToolState {
  mode: ToolMode;
  /** Selected brush per tool: painting and erasing each have their own, like Procreate. */
  presetIds: Record<ToolMode, string>;
  /** Size/opacity/StreamLine per tool and brush, keyed `${mode}:${presetId}`. */
  adjustments: Record<string, BrushAdjustments>;
  /** Brush Settings edits per built-in preset. */
  overrides: Record<string, BrushOverride>;
  /** The user's own brushes, in the order they were saved. */
  customBrushes: CustomBrush[];
  color: string;
  recentColors: string[];
  /** Sidebar on the right, for left-handed drawing. */
  sidebarRight: boolean;
  /** Paint with a finger until a pen has been used. */
  fingerDrawing: boolean;
  /** The install coach has been shown (it opens by itself only once). */
  installCoachSeen: boolean;
  /** Left and right arrow keys rotate the canvas by `arrowRotateStep` degrees. */
  arrowRotate: boolean;
  arrowRotateStep: number;
  /** Twisting the canvas snaps to the nearest quarter turn when it ends close to one. */
  snapRotation: boolean;
  /** How much [ and ] change the brush size (0.15 = 15%). */
  sizeStep: number;
  /** Zoom factor of Ctrl/⌘ + and −. */
  keyZoomStep: number;
  /** Background picked first in the New canvas dialog. */
  newCanvasBackground: Background;
  /** The color panel's picker: saturation/brightness square or a hue/saturation wheel. */
  colorPicker: ColorPicker;
  /** Hue, saturation, brightness and contrast sliders under the picker. */
  colorSliders: boolean;

  setMode(mode: ToolMode): void;
  selectPreset(id: string): void;
  adjust(patch: Partial<BrushAdjustments>): void;
  setOverride(presetId: string, patch: BrushOverride): void;
  resetOverride(presetId: string): void;
  /**
   * Saves a brush as it is now, edits included, as a new brush and selects it. A built-in brush
   * goes back to its original settings. Returns the new brush's id.
   */
  saveAsNewBrush(fromId: string): string;
  /** Brush Settings edits to a custom brush go straight into it. */
  updateCustomBrush(id: string, patch: BrushOverride): void;
  renameCustomBrush(id: string, name: string): void;
  togglePin(id: string): void;
  deleteCustomBrush(id: string): void;
  /** `commit` also records the color in the recent colors. */
  setColor(color: string, commit?: boolean): void;
  setPrefs(patch: Partial<Pick<ToolState, Pref>>): void;
}

type Pref =
  | 'sidebarRight'
  | 'fingerDrawing'
  | 'installCoachSeen'
  | 'arrowRotate'
  | 'arrowRotateStep'
  | 'snapRotation'
  | 'sizeStep'
  | 'keyZoomStep'
  | 'newCanvasBackground'
  | 'colorPicker'
  | 'colorSliders';

const MAX_RECENT = 10;
const MODES: readonly ToolMode[] = ['paint', 'erase'];
const DEFAULT_IDS: Record<ToolMode, string> = { paint: DEFAULT_PRESET_ID, erase: 'airbrush' };

let brushSeq = 0;
function newBrushId(): string {
  brushSeq += 1;
  return `custom-${Date.now().toString(36)}-${brushSeq}${Math.random().toString(36).slice(2, 6)}`;
}

/** "Ink" → "Ink 2", "Ink 2" → "Ink 3": the first number no brush has yet. */
function nextName(name: string, customs: readonly CustomBrush[]): string {
  const base = name.replace(/ \d+$/, '');
  const taken = new Set(customs.map((b) => b.preset.name));
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

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
      presetIds: { ...DEFAULT_IDS },
      adjustments: {},
      overrides: {},
      customBrushes: [],
      color: '#1c1c1e',
      recentColors: [],
      sidebarRight: false,
      fingerDrawing: true,
      installCoachSeen: false,
      arrowRotate: false,
      arrowRotateStep: 15,
      snapRotation: true,
      sizeStep: 0.15,
      keyZoomStep: 1.25,
      newCanvasBackground: DEFAULT_BACKGROUND,
      colorPicker: 'square',
      colorSliders: true,

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
      saveAsNewBrush: (fromId) => {
        const s = get();
        const source = brushById(s, fromId);
        const id = newBrushId();
        const smoothing = s.adjustments[`${s.mode}:${fromId}`]?.smoothing;
        const preset: BrushPreset = {
          ...resolvePreset(source, s.overrides[fromId]),
          id,
          name: nextName(source.name, s.customBrushes),
          stabilization: smoothing ?? source.stabilization,
        };
        const adjustments = { ...s.adjustments };
        for (const mode of MODES) {
          const a = s.adjustments[`${mode}:${fromId}`];
          if (a) adjustments[`${mode}:${id}`] = { ...a };
        }
        const overrides = { ...s.overrides };
        if (isBuiltIn(fromId)) {
          // The edits now live in the new brush: the built-in one starts over.
          delete overrides[fromId];
          const a = adjustments[`${s.mode}:${fromId}`];
          if (a) adjustments[`${s.mode}:${fromId}`] = { ...a, smoothing: source.stabilization };
        }
        set({
          customBrushes: [...s.customBrushes, { preset, pinned: false }],
          adjustments,
          overrides,
          presetIds: { ...s.presetIds, [s.mode]: id },
        });
        return id;
      },
      updateCustomBrush: (id, patch) =>
        set({
          customBrushes: get().customBrushes.map((b) =>
            b.preset.id === id ? { ...b, preset: resolvePreset(b.preset, patch) } : b,
          ),
        }),
      renameCustomBrush: (id, name) =>
        set({
          customBrushes: get().customBrushes.map((b) =>
            b.preset.id === id ? { ...b, preset: { ...b.preset, name } } : b,
          ),
        }),
      togglePin: (id) =>
        set({
          customBrushes: get().customBrushes.map((b) =>
            b.preset.id === id ? { ...b, pinned: !b.pinned } : b,
          ),
        }),
      deleteCustomBrush: (id) => {
        const s = get();
        const adjustments = { ...s.adjustments };
        for (const mode of MODES) delete adjustments[`${mode}:${id}`];
        const presetIds = { ...s.presetIds };
        for (const mode of MODES) if (presetIds[mode] === id) presetIds[mode] = DEFAULT_IDS[mode];
        set({
          customBrushes: s.customBrushes.filter((b) => b.preset.id !== id),
          adjustments,
          presetIds,
        });
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
        customBrushes: s.customBrushes,
        color: s.color,
        recentColors: s.recentColors,
        sidebarRight: s.sidebarRight,
        fingerDrawing: s.fingerDrawing,
        installCoachSeen: s.installCoachSeen,
        arrowRotate: s.arrowRotate,
        arrowRotateStep: s.arrowRotateStep,
        snapRotation: s.snapRotation,
        sizeStep: s.sizeStep,
        keyZoomStep: s.keyZoomStep,
        newCanvasBackground: s.newCanvasBackground,
        colorPicker: s.colorPicker,
        colorSliders: s.colorSliders,
      }),
    },
  ),
);

const adjustKey = (s: Pick<ToolState, 'mode' | 'presetIds'>) => `${s.mode}:${s.presetIds[s.mode]}`;
const basePreset = (s: Pick<ToolState, 'mode' | 'presetIds' | 'customBrushes'>) =>
  brushById(s, s.presetIds[s.mode]);

export const isBuiltIn = (id: string) => PRESETS.some((p) => p.id === id);

/** A custom brush or a built-in one (unknown ids fall back to the default brush). */
export function brushById(s: Pick<ToolState, 'customBrushes'>, id: string): BrushPreset {
  return s.customBrushes.find((b) => b.preset.id === id)?.preset ?? presetById(id);
}

/** The library's order: pinned custom brushes, the built-in ones, then the other custom ones. */
export function brushSections(s: Pick<ToolState, 'customBrushes' | 'overrides'>): BrushPreset[][] {
  return [
    s.customBrushes.filter((b) => b.pinned).map((b) => b.preset),
    PRESETS.map((p) => resolvePreset(p, s.overrides[p.id])),
    s.customBrushes.filter((b) => !b.pinned).map((b) => b.preset),
  ];
}

/** The selected brush for the current tool, with the user's Brush Settings edits applied. */
export function currentPreset(s: ToolState): BrushPreset {
  const base = basePreset(s);
  return isBuiltIn(base.id) ? resolvePreset(base, s.overrides[base.id]) : base;
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
