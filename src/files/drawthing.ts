import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'fflate';
import { tileGrid } from '../engine/history/tiles';
import { DEFAULT_NAME, parseSavedDocument, type SavedDocument } from '../persistence/document';

/**
 * The `.drawthing` file (ROADMAP §6.1): a zip, lossless, for backups and moving artwork between
 * devices.
 *
 *   document.json             SavedDocument + { name, createdAt }
 *   tiles/<layer>/<tx>_<ty>.bin   one 256² tile: zlib-deflated premultiplied RGBA8, row 0 at the top
 *   thumb.png                 gallery thumbnail
 *
 * Tiles are already deflated, so the zip stores them as-is.
 */
export interface DrawthingProject {
  name: string;
  createdAt?: number;
  doc: SavedDocument;
  tiles: Map<string, Map<number, Blob>>;
  thumb: Blob | null;
}

export const DRAWTHING_TYPE = 'application/zip';

export async function encodeDrawthing(p: DrawthingProject): Promise<Blob> {
  const files: Zippable = {
    'document.json': [
      strToU8(JSON.stringify({ ...p.doc, name: p.name, createdAt: p.createdAt })),
      { level: 6 },
    ],
  };
  const { cols } = tileGrid(p.doc.width, p.doc.height);
  for (const [layerId, tiles] of p.tiles) {
    for (const [key, blob] of tiles) {
      const name = `tiles/${layerId}/${key % cols}_${Math.floor(key / cols)}.bin`;
      files[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    }
  }
  if (p.thumb) files['thumb.png'] = [new Uint8Array(await p.thumb.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>], { type: DRAWTHING_TYPE });
}

const TILE_PATH = /^tiles\/([\w-]+)\/(\d+)_(\d+)\.bin$/;

/** Reads a `.drawthing` file; throws with a short reason if it isn't a valid one. */
export async function decodeDrawthing(file: Blob): Promise<DrawthingProject> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('Not a DrawThing document: not a zip file');
  }
  const json = entries['document.json'];
  if (!json) throw new Error('Not a DrawThing document: document.json is missing');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw new Error('Not a DrawThing document: document.json is not JSON');
  }
  const doc = parseSavedDocument(raw);
  const meta = raw as { name?: unknown; createdAt?: unknown };

  const grid = tileGrid(doc.width, doc.height);
  const layerIds = new Set(doc.layers.map((l) => l.id));
  const tiles = new Map<string, Map<number, Blob>>();
  for (const [path, bytes] of Object.entries(entries)) {
    const m = TILE_PATH.exec(path);
    if (!m) continue;
    const [, layerId = '', txs = '', tys = ''] = m;
    const tx = Number(txs);
    const ty = Number(tys);
    if (!layerIds.has(layerId) || tx >= grid.cols || ty >= grid.rows) continue;
    let layer = tiles.get(layerId);
    if (!layer) tiles.set(layerId, (layer = new Map()));
    layer.set(ty * grid.cols + tx, new Blob([bytes as Uint8Array<ArrayBuffer>]));
  }
  const thumb = entries['thumb.png'];
  return {
    name:
      typeof meta.name === 'string' && meta.name.trim() ? meta.name.slice(0, 200) : DEFAULT_NAME,
    createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : undefined,
    doc,
    tiles,
    thumb: thumb ? new Blob([thumb as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null,
  };
}
