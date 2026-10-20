import { compressTile } from '../engine/history/compress';
import { tileGrid } from '../engine/history/tiles';
import { gpuBudgetBytes, maxLayersFor } from '../engine/layers/budget';
import { MAX_DOC_SIZE } from '../engine/limits';
import { type SavedDocument } from '../persistence/document';
import { createProject } from '../persistence/projects';
import { type LayerMeta, makeLayer } from '../state/documentStore';
import { decodeDrawthing } from './drawthing';
import {
  decodeImage,
  fitImage,
  importSize,
  makeThumbnail,
  type Pixels,
  pixelsToTiles,
} from './image';
import type { PsdLayerData } from './psd';
import { decodePsd } from './psdClient';

/** File types the gallery's Import accepts. */
export const IMPORT_ACCEPT = '.drawthing,.psd,image/png,image/jpeg,image/webp';
/** File types that can be placed on a layer. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export interface Imported {
  id: string;
  /** Something the user should know, e.g. what couldn't be kept. */
  note?: string;
}

/** Turns a `.drawthing`, PSD or image file into a new gallery project. */
export async function importAsProject(file: File): Promise<Imported> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const name = file.name.replace(/\.[^.]+$/, '').trim() || 'Imported';
  if (ext === 'drawthing') {
    const p = await decodeDrawthing(file);
    return { id: await createProject(p) };
  }
  if (ext === 'psd' || file.type === 'image/vnd.adobe.photoshop') return importPsd(file, name);
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    return importImage(file, name);
  }
  throw new Error('DrawThing can open .drawthing, PSD, PNG, JPEG and WebP files');
}

async function importImage(file: File, name: string): Promise<Imported> {
  const bitmap = await decodeImage(file);
  try {
    const size = importSize(bitmap.width, bitmap.height, MAX_DOC_SIZE);
    const layer = makeLayer('Layer 1');
    const px = fitImage(bitmap, size.w, size.h);
    const id = await store(
      name,
      size,
      [layer],
      new Map([[layer.id, { px, left: 0, top: 0 }]]),
      { color: '#ffffff', visible: true },
      await makeThumbnail(bitmap),
    );
    const scaled = size.w !== bitmap.width || size.h !== bitmap.height;
    return {
      id,
      note: scaled ? `Scaled down to ${size.w} × ${size.h} px (the largest canvas)` : undefined,
    };
  } finally {
    bitmap.close();
  }
}

async function importPsd(file: File, name: string): Promise<Imported> {
  const psd = await decodePsd(file);
  if (psd.width > MAX_DOC_SIZE || psd.height > MAX_DOC_SIZE) {
    throw new Error(
      `This PSD is ${psd.width} × ${psd.height} px; the largest canvas is ${MAX_DOC_SIZE} px`,
    );
  }
  const limit = maxLayersFor(psd.width * psd.height * 4, gpuBudgetBytes());
  if (psd.layers.length > limit) {
    throw new Error(
      `This PSD has ${psd.layers.length} layers; at its size this device can hold ${limit}`,
    );
  }
  // A solid, full-size bottom layer named "Background" (as DrawThing and Procreate export it)
  // becomes the canvas background again instead of a layer.
  const first = psd.layers[0];
  const bgColor = first && backgroundColor(first, psd.width, psd.height);
  const background = bgColor
    ? { color: bgColor, visible: first.visible }
    : { color: '#ffffff', visible: false }; // PSD layers bring their own background
  const metas: LayerMeta[] = [];
  const pixels = new Map<string, { px: Pixels; left: number; top: number }>();
  for (const l of bgColor ? psd.layers.slice(1) : psd.layers) {
    const meta = {
      ...makeLayer(l.name),
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      alphaLocked: l.alphaLocked,
    };
    metas.push(meta);
    if (l.pixels) pixels.set(meta.id, { px: l.pixels, left: l.left, top: l.top });
  }
  if (metas.length === 0) metas.push(makeLayer('Layer 1'));
  const thumb = psd.composite ? await makeThumbnail(psd.composite).catch(() => null) : null;
  const id = await store(name, { w: psd.width, h: psd.height }, metas, pixels, background, thumb);
  return {
    id,
    note:
      psd.approximated > 0
        ? `${psd.approximated} layer${psd.approximated > 1 ? 's' : ''} used features DrawThing doesn’t have (shown as plain pixels)`
        : undefined,
  };
}

async function store(
  name: string,
  size: { w: number; h: number },
  layers: LayerMeta[],
  pixels: Map<string, { px: Pixels; left: number; top: number }>,
  background: SavedDocument['background'],
  thumb: Blob | null,
): Promise<string> {
  const grid = tileGrid(size.w, size.h);
  const tiles = new Map<string, Map<number, Blob>>();
  for (const [layerId, { px, left, top }] of pixels) {
    const out = new Map<number, Blob>();
    for (const [key, raw] of pixelsToTiles(px, grid, left, top)) {
      out.set(key, (await compressTile(raw)) as Blob);
    }
    tiles.set(layerId, out);
  }
  const doc: SavedDocument = {
    schema: 1,
    width: size.w,
    height: size.h,
    tileSize: 256,
    background,
    layers,
    activeLayerId: layers[layers.length - 1]!.id,
    layerCounter: layers.length,
  };
  return createProject({ name, doc, tiles, thumb });
}

/** The color of a layer that is a plain opaque "Background" covering the canvas, else null. */
function backgroundColor(l: PsdLayerData, w: number, h: number): string | null {
  const px = l.pixels;
  if (l.name !== 'Background' || l.opacity !== 1 || l.blendMode !== 'normal' || !px) return null;
  if (l.left !== 0 || l.top !== 0 || px.width !== w || px.height !== h) return null;
  const d = px.data;
  const [r = 0, g = 0, b = 0] = d;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] !== r || d[i + 1] !== g || d[i + 2] !== b || d[i + 3] !== 255) return null;
  }
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
