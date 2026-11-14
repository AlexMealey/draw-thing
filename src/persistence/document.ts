import {
  type AnimationSettings,
  BLEND_MODES,
  type Background,
  clampFps,
  clampHold,
  type DocumentState,
  frameStack,
  type LayerGroup,
  type LayerMeta,
  normalizeGroups,
} from '../state/documentStore';
import { TILE } from '../engine/history/tiles';
import { MAX_DOC_SIZE } from '../engine/limits';

/**
 * The saved form of a document's metadata (ROADMAP §4.1): what `documentStore` holds, minus the
 * device-specific layer limit. Pixels are stored separately as 256² tiles.
 */
export interface SavedDocument {
  schema: 1;
  width: number;
  height: number;
  tileSize: typeof TILE;
  background: Background;
  /**
   * Every frame's layers, frame by frame in frame order; index 0 is the bottom of the first
   * frame's stack. Each frame's layers are adjacent. (Older apps read this as one stack.)
   */
  layers: SavedLayer[];
  /** Absent in documents saved before groups existed. */
  groups?: LayerGroup[];
  /** The active frame's active layer. */
  activeLayerId: string;
  layerCounter: number;
  groupCounter?: number;
  /** Absent in documents saved before animation existed: they are one frame. */
  frames?: SavedFrame[];
  activeFrameId?: string;
  animation?: AnimationSettings;
}

/** A layer with the frame it belongs to (absent: the first frame). */
export type SavedLayer = LayerMeta & { frameId?: string };

export interface SavedFrame {
  id: string;
  hold: number;
  activeLayerId: string;
}

export const DEFAULT_NAME = 'Untitled Artwork';

export function toSaved(doc: DocumentState): SavedDocument {
  const layers: SavedLayer[] = [];
  const groups: LayerGroup[] = [];
  const frames: SavedFrame[] = [];
  for (const f of doc.frames) {
    const stack = frameStack(doc, f.id);
    if (!stack) continue;
    for (const l of stack.layers) layers.push({ ...l, frameId: f.id });
    for (const g of stack.groups) groups.push({ ...g });
    frames.push({ id: f.id, hold: f.hold, activeLayerId: stack.activeLayerId });
  }
  return {
    schema: 1,
    width: doc.width,
    height: doc.height,
    tileSize: TILE,
    background: { ...doc.background },
    layers,
    groups,
    activeLayerId: doc.activeLayerId,
    layerCounter: doc.layerCounter,
    groupCounter: doc.groupCounter,
    frames,
    activeFrameId: doc.activeFrameId,
    animation: { ...doc.animation },
  };
}

let idSeq = 0;

export function newProjectId(): string {
  idSeq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `prj-${Date.now().toString(36)}-${idSeq}${rand}`;
}

/** Ids end up in database keys and zip paths, so imported ones are held to a safe alphabet. */
const SAFE_ID = /^[\w-]{1,64}$/;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Checks untrusted document JSON (an imported file) and returns it in canonical form, or throws
 * with a short reason.
 */
export function parseSavedDocument(value: unknown): SavedDocument {
  const fail = (why: string): never => {
    throw new Error(`Not a DrawThing document: ${why}`);
  };
  if (typeof value !== 'object' || value === null) return fail('no document');
  const v = value as Record<string, unknown>;
  if (v.schema !== 1) return fail('unsupported version');
  const side = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DOC_SIZE;
  if (!side(v.width) || !side(v.height)) return fail('bad canvas size');
  if (v.tileSize !== TILE) return fail('bad tile size');
  const bg = v.background as Record<string, unknown> | undefined;
  if (!bg || typeof bg.color !== 'string' || !HEX.test(bg.color)) return fail('bad background');
  if (!Array.isArray(v.layers) || v.layers.length === 0) return fail('no layers');
  const ids = new Set<string>();
  const opacityOf = (o: unknown) => (typeof o === 'number' ? Math.min(1, Math.max(0, o)) : 1);
  const groupIds = new Set<string>();
  const rawGroups: LayerGroup[] = (Array.isArray(v.groups) ? v.groups : []).map(
    (raw: unknown): LayerGroup => {
      const g = (raw ?? {}) as Record<string, unknown>;
      const id = g.id;
      if (typeof id !== 'string' || !SAFE_ID.test(id) || groupIds.has(id) || ids.has(id)) {
        fail('bad group id');
      }
      groupIds.add(id as string);
      return {
        id: id as string,
        name: typeof g.name === 'string' ? g.name.slice(0, 200) : 'Group',
        visible: g.visible !== false,
        opacity: opacityOf(g.opacity),
        locked: g.locked === true,
        alphaLocked: g.alphaLocked === true,
        collapsed: g.collapsed === true,
      };
    },
  );
  const frameIds = new Set<string>();
  const rawFrames: SavedFrame[] = (Array.isArray(v.frames) ? v.frames : []).map(
    (raw: unknown): SavedFrame => {
      const f = (raw ?? {}) as Record<string, unknown>;
      if (typeof f.id !== 'string' || !SAFE_ID.test(f.id) || frameIds.has(f.id)) {
        fail('bad frame id');
      }
      frameIds.add(f.id as string);
      return {
        id: f.id as string,
        hold: clampHold(typeof f.hold === 'number' ? f.hold : 1),
        activeLayerId: typeof f.activeLayerId === 'string' ? f.activeLayerId : '',
      };
    },
  );
  const rawLayers = v.layers.map((raw: unknown): SavedLayer => {
    const l = (raw ?? {}) as Record<string, unknown>;
    if (typeof l.id !== 'string' || !SAFE_ID.test(l.id) || ids.has(l.id) || groupIds.has(l.id)) {
      fail('bad layer id');
    }
    ids.add(l.id as string);
    const blendMode = BLEND_MODES.find((m) => m === l.blendMode) ?? 'normal';
    const opacity = opacityOf(l.opacity);
    return {
      id: l.id as string,
      name: typeof l.name === 'string' ? l.name.slice(0, 200) : 'Layer',
      visible: l.visible !== false,
      opacity,
      blendMode,
      locked: l.locked === true,
      alphaLocked: l.alphaLocked === true,
      groupId: typeof l.groupId === 'string' ? l.groupId : null,
      ...(typeof l.frameId === 'string' && frameIds.has(l.frameId) ? { frameId: l.frameId } : {}),
    };
  });
  // Frames in order, each frame's layers together (untagged layers belong to the first frame);
  // frames without layers go.
  const firstFrame = rawFrames[0]?.id;
  const frameOf = (l: SavedLayer) => l.frameId ?? firstFrame;
  const order = rawFrames.map((f) => f.id);
  const sorted =
    rawFrames.length > 0
      ? order.flatMap((id) => rawLayers.filter((l) => frameOf(l) === id))
      : rawLayers;
  const { layers, groups } = normalizeGroups(sorted, rawGroups);
  const tagged = rawFrames.length > 0 ? layers.map((l) => ({ ...l, frameId: frameOf(l) })) : layers;
  const frames = rawFrames
    .filter((f) => tagged.some((l) => l.frameId === f.id))
    .map((f) => {
      const own = tagged.filter((l) => l.frameId === f.id);
      const activeLayerId = own.some((l) => l.id === f.activeLayerId)
        ? f.activeLayerId
        : own[own.length - 1]!.id;
      return { ...f, activeLayerId };
    });
  const activeFrameId =
    typeof v.activeFrameId === 'string' && frames.some((f) => f.id === v.activeFrameId)
      ? v.activeFrameId
      : frames[0]?.id;
  const anim = v.animation as Record<string, unknown> | undefined;
  const animation: AnimationSettings | undefined =
    anim && typeof anim === 'object'
      ? {
          enabled: anim.enabled === true,
          fps: clampFps(typeof anim.fps === 'number' ? anim.fps : NaN),
        }
      : undefined;
  const activeFrame = frames.find((f) => f.id === activeFrameId);
  const active = typeof v.activeLayerId === 'string' && ids.has(v.activeLayerId);
  return {
    schema: 1,
    width: v.width as number,
    height: v.height as number,
    tileSize: TILE,
    background: { color: bg.color, visible: bg.visible !== false },
    layers: tagged,
    groups,
    activeLayerId: activeFrame
      ? tagged.some((l) => l.id === v.activeLayerId && l.frameId === activeFrame.id)
        ? (v.activeLayerId as string)
        : activeFrame.activeLayerId
      : active
        ? (v.activeLayerId as string)
        : layers[layers.length - 1]!.id,
    layerCounter:
      typeof v.layerCounter === 'number' && v.layerCounter >= layers.length
        ? Math.floor(v.layerCounter)
        : layers.length,
    groupCounter:
      typeof v.groupCounter === 'number' && v.groupCounter >= groups.length
        ? Math.floor(v.groupCounter)
        : groups.length,
    ...(frames.length > 0 ? { frames, activeFrameId } : {}),
    ...(animation ? { animation } : {}),
  };
}
