import {
  BLEND_MODES,
  type Background,
  type DocumentState,
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
  /** Index 0 is the bottom of the stack. */
  layers: LayerMeta[];
  /** Absent in documents saved before groups existed. */
  groups?: LayerGroup[];
  activeLayerId: string;
  layerCounter: number;
  groupCounter?: number;
}

export const DEFAULT_NAME = 'Untitled Artwork';

export function toSaved(doc: DocumentState): SavedDocument {
  return {
    schema: 1,
    width: doc.width,
    height: doc.height,
    tileSize: TILE,
    background: { ...doc.background },
    layers: doc.layers.map((l) => ({ ...l })),
    groups: doc.groups.map((g) => ({ ...g })),
    activeLayerId: doc.activeLayerId,
    layerCounter: doc.layerCounter,
    groupCounter: doc.groupCounter,
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
  const rawLayers = v.layers.map((raw: unknown): LayerMeta => {
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
    };
  });
  const { layers, groups } = normalizeGroups(rawLayers, rawGroups);
  const active = typeof v.activeLayerId === 'string' && ids.has(v.activeLayerId);
  return {
    schema: 1,
    width: v.width as number,
    height: v.height as number,
    tileSize: TILE,
    background: { color: bg.color, visible: bg.visible !== false },
    layers,
    groups,
    activeLayerId: active ? (v.activeLayerId as string) : layers[layers.length - 1]!.id,
    layerCounter:
      typeof v.layerCounter === 'number' && v.layerCounter >= layers.length
        ? Math.floor(v.layerCounter)
        : layers.length,
    groupCounter:
      typeof v.groupCounter === 'number' && v.groupCounter >= groups.length
        ? Math.floor(v.groupCounter)
        : groups.length,
  };
}
