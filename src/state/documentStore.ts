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

/** One frame of an animation. Its pixels are its own layer stack. */
export interface FrameMeta {
  id: string;
  /** How many ticks (1 / fps) the frame stays on screen: 2 = "on twos". */
  hold: number;
}

/** A frame's layer stack while another frame is the active one. */
export interface FrameStack {
  layers: LayerMeta[];
  groups: LayerGroup[];
  activeLayerId: string;
}

export interface AnimationSettings {
  /** Shows the timeline. A document always has at least one frame either way. */
  enabled: boolean;
  /** Ticks per second. */
  fps: number;
}

export const DEFAULT_ANIMATION: AnimationSettings = { enabled: false, fps: 12 };
export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MAX_HOLD = 99;

export const clampFps = (fps: number) =>
  Number.isFinite(fps)
    ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps)))
    : DEFAULT_ANIMATION.fps;
export const clampHold = (hold: number) =>
  Number.isFinite(hold) ? Math.min(MAX_HOLD, Math.max(1, Math.round(hold))) : 1;

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
  /**
   * Animation frames, in playback order. The active frame's stack is `layers`/`groups`/
   * `activeLayerId`; every other frame's is in `parked`. Layer and group ids are unique across
   * all frames.
   */
  frames: FrameMeta[];
  activeFrameId: string;
  parked: Readonly<Record<string, FrameStack>>;
  animation: AnimationSettings;

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
  /**
   * Puts layers from anywhere in the stack (in or out of groups) into a new group, gathered in
   * stack order where the topmost of them was, but never inside another group. Groups left empty
   * go. Returns the new group's id, or null when none of the ids is a layer.
   */
  groupLayers(ids: readonly string[]): string | null;
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
  /** Makes another frame the active one (its stack becomes `layers`). False if it can't. */
  selectFrame(id: string): boolean;
  /** Adds a frame with its stack at a position in the frame list and makes it active. */
  insertFrame(frame: FrameMeta, stack: FrameStack, index: number): void;
  /** Deletes a frame (never the last one); deleting the active one selects its neighbour. */
  removeFrame(id: string): boolean;
  /** Moves a frame to a position in the frame list. */
  moveFrame(id: string, index: number): void;
  setFrameHold(id: string, hold: number): void;
  setAnimation(patch: Partial<AnimationSettings>): void;
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
  | 'groupLayers'
  | 'ungroup'
  | 'updateGroup'
  | 'removeGroup'
  | 'moveGroup'
  | 'removeFromGroup'
  | 'selectFrame'
  | 'insertFrame'
  | 'removeFrame'
  | 'moveFrame'
  | 'setFrameHold'
  | 'setAnimation'
>;

/**
 * Document data as saved: every frame's layers in one list, each tagged with its frame. Documents
 * from before groups existed have none; documents from before frames existed have one frame.
 */
export type DocumentInput = Omit<
  DocumentData,
  'layers' | 'groups' | 'groupCounter' | 'frames' | 'activeFrameId' | 'parked' | 'animation'
> & {
  layers: readonly (Omit<LayerMeta, 'groupId'> & { groupId?: string | null; frameId?: string })[];
  groups?: readonly LayerGroup[];
  groupCounter?: number;
  frames?: readonly (FrameMeta & { activeLayerId?: string })[];
  activeFrameId?: string;
  animation?: AnimationSettings;
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

export function makeFrame(hold = 1): FrameMeta {
  idSeq += 1;
  return { id: `frame-${Date.now().toString(36)}-${idSeq}`, hold };
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
export function normalizeGroups<L extends LayerMeta>(
  layers: readonly L[],
  groups: readonly LayerGroup[],
): { layers: L[]; groups: LayerGroup[] } {
  const known = new Set(groups.map((g) => g.id));
  const closed = new Set<string>();
  let changed = false;
  let prev: string | null = null;
  const out = layers.map((l): L => {
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
    layers: changed ? out : (layers as L[]),
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

/**
 * Where something taking the place of `topId` goes in `rest` (the stack without the layers being
 * moved): just above the layers of `rest` that were below it. Unless it belongs to `groupId`, it
 * never lands inside another group: it goes above that group.
 */
function slotBelow(
  layers: readonly LayerMeta[],
  rest: readonly LayerMeta[],
  topId: string,
  groupId: string | null,
): number {
  const top = layers.findIndex((l) => l.id === topId);
  const keep = new Set(rest.map((l) => l.id));
  let at = layers.slice(0, top).filter((l) => keep.has(l.id)).length;
  while (groupAround(rest, at) !== null && groupAround(rest, at) !== groupId) at++;
  return at;
}

/** What Flatten does to selected layers: they become one layer, in the topmost one's place. */
export interface FlattenPlan {
  /** The layers merged, bottom first. */
  sources: LayerMeta[];
  /** The stack without them. */
  rest: LayerMeta[];
  /** Where the merged layer goes in `rest`. */
  index: number;
  /** The group all of them share (it then still applies to the merged layer), else null. */
  groupId: string | null;
  /** The topmost layer's name. */
  name: string;
}

/** Null unless at least two of the ids are layers. */
export function flattenPlan(
  state: Pick<DocumentState, 'layers'>,
  ids: readonly string[],
): FlattenPlan | null {
  const picked = new Set(ids);
  const sources = state.layers.filter((l) => picked.has(l.id));
  if (sources.length < 2) return null;
  const top = sources[sources.length - 1]!;
  const shared = sources.every((l) => l.groupId === top.groupId) ? top.groupId : null;
  const rest = state.layers.filter((l) => !picked.has(l.id));
  return {
    sources,
    rest,
    index: slotBelow(state.layers, rest, top.id, shared),
    groupId: shared,
    name: top.name,
  };
}

export function activeIndex(state: Pick<DocumentState, 'layers' | 'activeLayerId'>): number {
  return state.layers.findIndex((l) => l.id === state.activeLayerId);
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const out = { ...record };
  delete out[key];
  return out;
}

type FrameState = Pick<
  DocumentState,
  'layers' | 'groups' | 'activeLayerId' | 'frames' | 'activeFrameId' | 'parked'
>;

/** A frame's layer stack, whether it's the active frame or not. */
export function frameStack(doc: FrameState, frameId: string): FrameStack | undefined {
  if (frameId === doc.activeFrameId) {
    return { layers: doc.layers, groups: doc.groups, activeLayerId: doc.activeLayerId };
  }
  return doc.parked[frameId];
}

/** Every frame's layers, in frame order (each frame bottom first). */
export function allLayers(doc: FrameState): LayerMeta[] {
  return doc.frames.flatMap((f) => frameStack(doc, f.id)?.layers ?? []);
}

export function allLayerIds(doc: FrameState): Set<string> {
  return new Set(allLayers(doc).map((l) => l.id));
}

/** The frame a layer belongs to. */
export function frameOfLayer(doc: FrameState, layerId: string): string | undefined {
  if (doc.layers.some((l) => l.id === layerId)) return doc.activeFrameId;
  for (const [id, stack] of Object.entries(doc.parked)) {
    if (stack.layers.some((l) => l.id === layerId)) return id;
  }
  return undefined;
}

export function frameIndex(doc: Pick<DocumentState, 'frames' | 'activeFrameId'>): number {
  return doc.frames.findIndex((f) => f.id === doc.activeFrameId);
}

/**
 * Splits a saved document's tagged layer list into per-frame stacks. Layers of unknown frames go
 * to the first frame; frames without layers are dropped; a group never spans two frames.
 */
function splitFrames(
  doc: DocumentInput,
): Pick<
  DocumentState,
  'layers' | 'groups' | 'activeLayerId' | 'frames' | 'activeFrameId' | 'parked'
> {
  const listed = doc.frames?.length ? doc.frames : [{ ...makeFrame(), activeLayerId: undefined }];
  const known = new Set(listed.map((f) => f.id));
  const firstId = listed[0]!.id;
  const byFrame = new Map<string, LayerMeta[]>();
  for (const raw of doc.layers) {
    const { frameId, ...rest } = raw;
    const id = frameId !== undefined && known.has(frameId) ? frameId : firstId;
    let list = byFrame.get(id);
    if (!list) byFrame.set(id, (list = []));
    list.push({ ...rest, groupId: rest.groupId ?? null });
  }
  const groups = (doc.groups ?? []).map((g) => ({ ...g }));
  const usedGroups = new Set<string>();
  const frames: FrameMeta[] = [];
  const stacks = new Map<string, FrameStack>();
  for (const f of listed) {
    const layers = byFrame.get(f.id);
    if (!layers || layers.length === 0) continue;
    // A group already used by an earlier frame can't also be in this one.
    const own = layers.map((l) =>
      l.groupId !== null && usedGroups.has(l.groupId) ? { ...l, groupId: null } : l,
    );
    const stack = normalizeGroups(own, groups);
    for (const g of stack.groups) usedGroups.add(g.id);
    const wanted = f.activeLayerId;
    stacks.set(f.id, {
      ...stack,
      activeLayerId: stack.layers.some((l) => l.id === wanted)
        ? wanted!
        : stack.layers[stack.layers.length - 1]!.id,
    });
    frames.push({ id: f.id, hold: clampHold(f.hold) });
  }
  const activeFrameId =
    doc.activeFrameId !== undefined && stacks.has(doc.activeFrameId)
      ? doc.activeFrameId
      : frames[0]!.id;
  const active = stacks.get(activeFrameId)!;
  const parked: Record<string, FrameStack> = {};
  for (const [id, stack] of stacks) if (id !== activeFrameId) parked[id] = stack;
  return {
    layers: active.layers,
    groups: active.groups,
    activeLayerId: active.layers.some((l) => l.id === doc.activeLayerId)
      ? doc.activeLayerId
      : active.activeLayerId,
    frames,
    activeFrameId,
    parked,
  };
}

export const documentStore = createStore<DocumentState>()((set, get) => {
  const first = makeLayer('Layer 1');
  const firstFrame = makeFrame();

  /** The active frame's stack, to park when another frame takes over. */
  const current = (s: DocumentState): FrameStack => ({
    layers: s.layers,
    groups: s.groups,
    activeLayerId: s.activeLayerId,
  });

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
    frames: [firstFrame],
    activeFrameId: firstFrame.id,
    parked: {},
    animation: { ...DEFAULT_ANIMATION },

    reset({ width, height, maxLayers, background = DEFAULT_BACKGROUND }) {
      const layer = makeLayer('Layer 1');
      const frame = makeFrame();
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
        frames: [frame],
        activeFrameId: frame.id,
        parked: {},
        animation: { ...DEFAULT_ANIMATION },
      });
    },

    load(doc) {
      // Documents saved before groups existed have neither `groups` nor `groupId`; documents
      // saved before frames existed are one frame.
      const split = splitFrames(doc);
      const groupCount =
        split.groups.length + Object.values(split.parked).reduce((n, s) => n + s.groups.length, 0);
      set({
        width: doc.width,
        height: doc.height,
        maxLayers: doc.maxLayers,
        background: { ...doc.background },
        ...split,
        layerCounter: doc.layerCounter,
        groupCounter: doc.groupCounter ?? groupCount,
        animation: doc.animation
          ? { enabled: doc.animation.enabled === true, fps: clampFps(doc.animation.fps) }
          : { ...DEFAULT_ANIMATION },
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
      const layer = get().layers.find((l) => l.id === id);
      return layer && layer.groupId === null ? get().groupLayers([id]) : null;
    },

    groupLayers(ids) {
      const s = get();
      const picked = new Set(ids);
      const block = s.layers.filter((l) => picked.has(l.id));
      if (block.length === 0) return null;
      const rest = s.layers.filter((l) => !picked.has(l.id));
      const at = slotBelow(s.layers, rest, block[block.length - 1]!.id, null);
      const n = s.groupCounter + 1;
      const group = makeGroup(`Group ${n}`);
      const layers = [
        ...rest.slice(0, at),
        ...block.map((l) => ({ ...l, groupId: group.id })),
        ...rest.slice(at),
      ];
      set({ ...normalizeGroups(layers, [...s.groups, group]), groupCounter: n });
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

    selectFrame(id) {
      const s = get();
      const next = s.parked[id];
      if (id === s.activeFrameId || !next) return false;
      set({
        ...next,
        activeFrameId: id,
        parked: { ...without(s.parked, id), [s.activeFrameId]: current(s) },
      });
      return true;
    },

    insertFrame(frame, stack, index) {
      const s = get();
      if (stack.layers.length === 0 || s.frames.some((f) => f.id === frame.id)) return;
      const frames = [...s.frames];
      frames.splice(Math.min(frames.length, Math.max(0, index)), 0, { ...frame });
      set({
        ...stack,
        frames,
        activeFrameId: frame.id,
        parked: { ...s.parked, [s.activeFrameId]: current(s) },
      });
    },

    removeFrame(id) {
      const s = get();
      const i = s.frames.findIndex((f) => f.id === id);
      if (i < 0 || s.frames.length <= 1) return false;
      const frames = s.frames.filter((f) => f.id !== id);
      if (id !== s.activeFrameId) {
        set({ frames, parked: without(s.parked, id) });
        return true;
      }
      const next = (s.frames[i + 1] ?? s.frames[i - 1])!;
      const stack = s.parked[next.id];
      if (!stack) return false;
      set({ ...stack, frames, activeFrameId: next.id, parked: without(s.parked, next.id) });
      return true;
    },

    moveFrame(id, index) {
      const s = get();
      const from = s.frames.findIndex((f) => f.id === id);
      if (from < 0) return;
      const to = Math.min(s.frames.length - 1, Math.max(0, index));
      if (to === from) return;
      const frames = [...s.frames];
      const [frame] = frames.splice(from, 1);
      frames.splice(to, 0, frame!);
      set({ frames });
    },

    setFrameHold(id, hold) {
      const s = get();
      const h = clampHold(hold);
      if (!s.frames.some((f) => f.id === id && f.hold !== h)) return;
      set({ frames: s.frames.map((f) => (f.id === id ? { ...f, hold: h } : f)) });
    },

    setAnimation(patch) {
      const s = get();
      const next = { ...s.animation, ...patch };
      next.fps = clampFps(next.fps);
      if (next.enabled === s.animation.enabled && next.fps === s.animation.fps) return;
      set({ animation: next });
    },
  };
});

/** React hook: `useDocument((s) => s.layers)`. */
export function useDocument<T>(selector: (state: DocumentState) => T): T {
  return useStore(documentStore, selector);
}
