import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'add',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Layer metadata (ROADMAP §4.1). Pixels live in the engine's GPU textures, keyed by id. */
export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  /** No painting, clearing or erasing. */
  locked: boolean;
  /** Paint only where the layer already has pixels. */
  alphaLocked: boolean;
}

export interface Background {
  color: string;
  visible: boolean;
}

export interface DocumentState {
  width: number;
  height: number;
  background: Background;
  /** Index 0 is the bottom of the stack. */
  layers: LayerMeta[];
  activeLayerId: string;
  /** From the GPU memory budget (ROADMAP §4.4). */
  maxLayers: number;
  /** Numbering for new layer names. */
  layerCounter: number;

  reset(opts: { width: number; height: number; maxLayers: number }): void;
  /** Adds an empty layer above the active one and selects it. Null at the layer limit. */
  addLayer(): string | null;
  /** Inserts a prepared layer (e.g. a duplicate) at a stack index and selects it. */
  insertLayer(layer: LayerMeta, index: number): boolean;
  /** Removes a layer (never the last one) and selects the one below it. */
  removeLayer(id: string): void;
  selectLayer(id: string): void;
  updateLayer(id: string, patch: Partial<Omit<LayerMeta, 'id'>>): void;
  /** Moves a layer to a stack index (0 = bottom). */
  moveLayer(id: string, index: number): void;
  setBackground(patch: Partial<Background>): void;
  /** Replaces the whole stack, e.g. after Flatten. */
  replaceLayers(layers: LayerMeta[], activeId: string): void;
}

let idSeq = 0;

export function makeLayer(name: string): LayerMeta {
  idSeq += 1;
  return {
    id: `layer-${Date.now().toString(36)}-${idSeq}`,
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    alphaLocked: false,
  };
}

export function activeIndex(state: Pick<DocumentState, 'layers' | 'activeLayerId'>): number {
  return state.layers.findIndex((l) => l.id === state.activeLayerId);
}

export const documentStore = createStore<DocumentState>()((set, get) => {
  const first = makeLayer('Layer 1');
  return {
    width: 0,
    height: 0,
    background: { color: '#ffffff', visible: true },
    layers: [first],
    activeLayerId: first.id,
    maxLayers: 1,
    layerCounter: 1,

    reset({ width, height, maxLayers }) {
      const layer = makeLayer('Layer 1');
      set({
        width,
        height,
        maxLayers,
        background: { color: '#ffffff', visible: true },
        layers: [layer],
        activeLayerId: layer.id,
        layerCounter: 1,
      });
    },

    addLayer() {
      const s = get();
      if (s.layers.length >= s.maxLayers) return null;
      const n = s.layerCounter + 1;
      const layer = makeLayer(`Layer ${n}`);
      const layers = [...s.layers];
      layers.splice(activeIndex(s) + 1, 0, layer);
      set({ layers, activeLayerId: layer.id, layerCounter: n });
      return layer.id;
    },

    insertLayer(layer, index) {
      const s = get();
      if (s.layers.length >= s.maxLayers) return false;
      const layers = [...s.layers];
      layers.splice(Math.min(Math.max(0, index), layers.length), 0, layer);
      set({ layers, activeLayerId: layer.id });
      return true;
    },

    removeLayer(id) {
      const s = get();
      const i = s.layers.findIndex((l) => l.id === id);
      if (i < 0 || s.layers.length <= 1) return;
      const layers = s.layers.filter((l) => l.id !== id);
      const activeLayerId =
        s.activeLayerId === id ? (layers[Math.max(0, i - 1)]?.id ?? '') : s.activeLayerId;
      set({ layers, activeLayerId });
    },

    selectLayer(id) {
      if (get().layers.some((l) => l.id === id)) set({ activeLayerId: id });
    },

    updateLayer(id, patch) {
      set({ layers: get().layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
    },

    moveLayer(id, index) {
      const layers = [...get().layers];
      const from = layers.findIndex((l) => l.id === id);
      if (from < 0) return;
      const to = Math.min(layers.length - 1, Math.max(0, index));
      if (to === from) return;
      const [layer] = layers.splice(from, 1);
      if (layer) layers.splice(to, 0, layer);
      set({ layers });
    },

    setBackground(patch) {
      set({ background: { ...get().background, ...patch } });
    },

    replaceLayers(layers, activeId) {
      if (layers.length === 0) return;
      set({
        layers,
        activeLayerId: layers.some((l) => l.id === activeId) ? activeId : layers[0]!.id,
      });
    },
  };
});

/** React hook: `useDocument((s) => s.layers)`. */
export function useDocument<T>(selector: (state: DocumentState) => T): T {
  return useStore(documentStore, selector);
}
