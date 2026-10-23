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
  /** The group this layer belongs to, if any. A group's layers are adjacent in the stack. */
  groupId: string | null;
}

/**
 * A pass-through folder of adjacent layers (one level, no nesting). Its visibility, opacity and
 * locks apply on top of each child's own, without changing them.
 */
export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  alphaLocked: boolean;
  /** Children are hidden in the layers panel (not recorded in history). */
  collapsed: boolean;
}

export interface Background {
  color: string;
  visible: boolean;
}

export const DEFAULT_BACKGROUND: Background = { color: '#ffffff', visible: true };

export interface DocumentState {
  width: number;
  height: number;
  background: Background;
  /** Index 0 is the bottom of the stack. */
  layers: LayerMeta[];
  /** Groups in no particular order: each sits where its layers are. Never empty. */
  groups: LayerGroup[];
  activeLayerId: string;
  /** From the GPU memory budget (ROADMAP §4.4). */
  maxLayers: number;
  /** Numbering for new layer names. */
  layerCounter: number;
  /** Numbering for new group names. */
  groupCounter: number;

  /** A blank document; the background defaults to visible white. */
  reset(opts: { width: number; height: number; maxLayers: number; background?: Background }): void;
  /** Replaces everything with a saved document. */
  load(doc: DocumentInput): void;
  /** Adds an empty layer above the active one and selects it. Null at the layer limit. */
  addLayer(): string | null;
  /** Inserts a prepared layer (e.g. a duplicate) at a stack index and selects it. */
  insertLayer(layer: LayerMeta, index: number): boolean;
  /** Removes a layer (never the last one) and selects the one below it. */
  removeLayer(id: string): void;
  selectLayer(id: string): void;
  updateLayer(id: string, patch: Partial<Omit<LayerMeta, 'id'>>): void;
  /**
   * Moves a layer to a stack index (0 = bottom). `groupId` is the group it should end up in
   * (undefined keeps its own); a layer dropped between two layers of a group always joins it.
   */
  moveLayer(id: string, index: number, groupId?: string | null): void;
  setBackground(patch: Partial<Background>): void;
  /** Replaces the whole stack, e.g. after Flatten. */
  replaceLayers(layers: LayerMeta[], activeId: string): void;
  /** Puts an ungrouped layer into a new group. Returns the group's id, or null. */
  groupLayer(id: string): string | null;
  /** Dissolves a group; its layers stay where they are. */
  ungroup(groupId: string): void;
  updateGroup(id: string, patch: Partial<Omit<LayerGroup, 'id'>>): void;
  /** Deletes a group with its layers. False when that would leave no layers. */
  removeGroup(id: string): boolean;
  /**
   * Moves a whole group so its bottom layer lands at stack index `index` of the stack without
   * the group. It never lands inside another group.
   */
  moveGroup(id: string, index: number): void;
  /** Takes a layer out of its group, placing it just above the group. */
  removeFromGroup(id: string): void;
}

/** The state without its actions. */
export type DocumentData = Omit<
  DocumentState,
  | 'reset'
  | 'load'
  | 'addLayer'
  | 'insertLayer'
  | 'removeLayer'
  | 'selectLayer'
  | 'updateLayer'
  | 'moveLayer'
  | 'setBackground'
  | 'replaceLayers'
  | 'groupLayer'
  | 'ungroup'
  | 'updateGroup'
  | 'removeGroup'
  | 'moveGroup'
  | 'removeFromGroup'
>;

/** Document data as saved: documents from before groups existed have none. */
export type DocumentInput = Omit<DocumentData, 'layers' | 'groups' | 'groupCounter'> & {
  layers: readonly (Omit<LayerMeta, 'groupId'> & { groupId?: string | null })[];
  groups?: readonly LayerGroup[];
  groupCounter?: number;
};

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
    groupId: null,
  };
}

export function makeGroup(name: string): LayerGroup {
  idSeq += 1;
  return {
    id: `group-${Date.now().toString(36)}-${idSeq}`,
    name,
    visible: true,
    opacity: 1,
    locked: false,
    alphaLocked: false,
    collapsed: false,
  };
}

/**
 * Makes a stack consistent: layers of unknown groups are ungrouped, a layer separated from the
 * rest of its group leaves it, and groups without layers go. Unchanged arrays are returned as is.
 */
export function normalizeGroups(
  layers: readonly LayerMeta[],
  groups: readonly LayerGroup[],
): { layers: LayerMeta[]; groups: LayerGroup[] } {
  const known = new Set(groups.map((g) => g.id));
  const closed = new Set<string>();
  let changed = false;
  let prev: string | null = null;
  const out = layers.map((l) => {
    let groupId = l.groupId ?? null;
    if (groupId !== null && (!known.has(groupId) || closed.has(groupId))) groupId = null;
    if (prev !== null && prev !== groupId) closed.add(prev);
    prev = groupId;
    if (groupId === l.groupId) return l;
    changed = true;
    return { ...l, groupId };
  });
  const used = new Set(out.map((l) => l.groupId));
  const kept = groups.filter((g) => used.has(g.id));
  return {
    layers: changed ? out : (layers as LayerMeta[]),
    groups: kept.length === groups.length ? (groups as LayerGroup[]) : kept,
  };
}

/** A layer's properties as drawn and painted: its group's visibility, opacity and locks applied. */
export function effectiveLayer<T extends LayerMeta>(layer: T, groups: readonly LayerGroup[]): T {
  const g = layer.groupId === null ? undefined : groups.find((x) => x.id === layer.groupId);
  if (!g) return layer;
  return {
    ...layer,
    visible: layer.visible && g.visible,
    opacity: layer.opacity * g.opacity,
    locked: layer.locked || g.locked,
    alphaLocked: layer.alphaLocked || g.alphaLocked,
  };
}

export type LayerRow =
  { kind: 'layer'; layer: LayerMeta } | { kind: 'group'; group: LayerGroup; children: LayerMeta[] };

/** The layers panel's rows, top of the stack first; a group's children are top first too. */
export function layerRows(state: Pick<DocumentState, 'layers' | 'groups'>): LayerRow[] {
  const rows: LayerRow[] = [];
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i]!;
    const last = rows[rows.length - 1];
    if (layer.groupId === null) rows.push({ kind: 'layer', layer });
    else if (last?.kind === 'group' && last.group.id === layer.groupId) last.children.push(layer);
    else {
      const group = state.groups.find((g) => g.id === layer.groupId);
      rows.push(group ? { kind: 'group', group, children: [layer] } : { kind: 'layer', layer });
    }
  }
  return rows;
}

/** The group shared by the layers on both sides of a stack slot (a layer there must join it). */
function groupAround(layers: readonly LayerMeta[], index: number): string | null {
  const below = layers[index - 1]?.groupId ?? null;
  return below !== null && layers[index]?.groupId === below ? below : null;
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
    groups: [],
    activeLayerId: first.id,
    maxLayers: 1,
    layerCounter: 1,
    groupCounter: 0,

    reset({ width, height, maxLayers, background = DEFAULT_BACKGROUND }) {
      const layer = makeLayer('Layer 1');
      set({
        width,
        height,
        maxLayers,
        background: { ...background },
        layers: [layer],
        groups: [],
        activeLayerId: layer.id,
        layerCounter: 1,
        groupCounter: 0,
      });
    },

    load(doc) {
      // Documents saved before groups existed have neither `groups` nor `groupId`.
      const stack = normalizeGroups(
        doc.layers.map((l) => ({ ...l, groupId: l.groupId ?? null })),
        (doc.groups ?? []).map((g) => ({ ...g })),
      );
      set({
        width: doc.width,
        height: doc.height,
        maxLayers: doc.maxLayers,
        background: { ...doc.background },
        ...stack,
        activeLayerId: doc.activeLayerId,
        layerCounter: doc.layerCounter,
        groupCounter: doc.groupCounter ?? stack.groups.length,
      });
    },

    addLayer() {
      const s = get();
      if (s.layers.length >= s.maxLayers) return null;
      const n = s.layerCounter + 1;
      const i = activeIndex(s);
      const layer = { ...makeLayer(`Layer ${n}`), groupId: s.layers[i]?.groupId ?? null };
      const layers = [...s.layers];
      layers.splice(i + 1, 0, layer);
      set({ layers, activeLayerId: layer.id, layerCounter: n });
      return layer.id;
    },

    insertLayer(layer, index) {
      const s = get();
      if (s.layers.length >= s.maxLayers) return false;
      const layers = [...s.layers];
      const at = Math.min(Math.max(0, index), layers.length);
      const around = groupAround(layers, at);
      layers.splice(at, 0, around ? { ...layer, groupId: around } : layer);
      set({ ...normalizeGroups(layers, s.groups), activeLayerId: layer.id });
      return true;
    },

    removeLayer(id) {
      const s = get();
      const i = s.layers.findIndex((l) => l.id === id);
      if (i < 0 || s.layers.length <= 1) return;
      const layers = s.layers.filter((l) => l.id !== id);
      const activeLayerId =
        s.activeLayerId === id ? (layers[Math.max(0, i - 1)]?.id ?? '') : s.activeLayerId;
      set({ ...normalizeGroups(layers, s.groups), activeLayerId });
    },

    selectLayer(id) {
      if (get().layers.some((l) => l.id === id)) set({ activeLayerId: id });
    },

    updateLayer(id, patch) {
      const s = get();
      const layers = s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
      set('groupId' in patch ? normalizeGroups(layers, s.groups) : { layers });
    },

    moveLayer(id, index, groupId) {
      const s = get();
      const layers = [...s.layers];
      const from = layers.findIndex((l) => l.id === id);
      const layer = layers[from];
      if (!layer) return;
      const to = Math.min(layers.length - 1, Math.max(0, index));
      let target = groupId === undefined ? layer.groupId : groupId;
      if (to === from && target === layer.groupId) return;
      layers.splice(from, 1);
      // It can only join a group next to it (or stay alone in its own).
      const next = (g: string | null) => layers[to - 1]?.groupId === g || layers[to]?.groupId === g;
      if (target !== null && !next(target) && layers.some((l) => l.groupId === target)) {
        target = null;
      }
      layers.splice(to, 0, { ...layer, groupId: groupAround(layers, to) ?? target });
      set(normalizeGroups(layers, s.groups));
    },

    setBackground(patch) {
      set({ background: { ...get().background, ...patch } });
    },

    replaceLayers(layers, activeId) {
      if (layers.length === 0) return;
      set({
        ...normalizeGroups(layers, get().groups),
        activeLayerId: layers.some((l) => l.id === activeId) ? activeId : layers[0]!.id,
      });
    },

    groupLayer(id) {
      const s = get();
      const layer = s.layers.find((l) => l.id === id);
      if (!layer || layer.groupId !== null) return null;
      const n = s.groupCounter + 1;
      const group = makeGroup(`Group ${n}`);
      set({
        layers: s.layers.map((l) => (l.id === id ? { ...l, groupId: group.id } : l)),
        groups: [...s.groups, group],
        groupCounter: n,
      });
      return group.id;
    },

    ungroup(groupId) {
      const s = get();
      if (!s.groups.some((g) => g.id === groupId)) return;
      set({
        layers: s.layers.map((l) => (l.groupId === groupId ? { ...l, groupId: null } : l)),
        groups: s.groups.filter((g) => g.id !== groupId),
      });
    },

    updateGroup(id, patch) {
      set({ groups: get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
    },

    removeGroup(id) {
      const s = get();
      const first = s.layers.findIndex((l) => l.groupId === id);
      const layers = s.layers.filter((l) => l.groupId !== id);
      if (first < 0 || layers.length === 0) return false;
      const activeGone = !layers.some((l) => l.id === s.activeLayerId);
      set({
        layers,
        groups: s.groups.filter((g) => g.id !== id),
        activeLayerId: activeGone
          ? (layers[Math.max(0, first - 1)]?.id ?? layers[0]!.id)
          : s.activeLayerId,
      });
      return true;
    },

    moveGroup(id, index) {
      const s = get();
      const block = s.layers.filter((l) => l.groupId === id);
      if (block.length === 0) return;
      const rest = s.layers.filter((l) => l.groupId !== id);
      let at = Math.min(rest.length, Math.max(0, index));
      while (groupAround(rest, at) !== null) at++; // never inside another group
      const layers = [...rest.slice(0, at), ...block, ...rest.slice(at)];
      if (layers.every((l, i) => l === s.layers[i])) return;
      set({ layers });
    },

    removeFromGroup(id) {
      const s = get();
      const layer = s.layers.find((l) => l.id === id);
      if (!layer || layer.groupId === null) return;
      const rest = s.layers.filter((l) => l.id !== id);
      let top = -1;
      rest.forEach((l, i) => {
        if (l.groupId === layer.groupId) top = i;
      });
      const layers = [...rest];
      layers.splice(top + 1, 0, { ...layer, groupId: null });
      set(normalizeGroups(layers, s.groups));
    },
  };
});

/** React hook: `useDocument((s) => s.layers)`. */
export function useDocument<T>(selector: (state: DocumentState) => T): T {
  return useStore(documentStore, selector);
}
