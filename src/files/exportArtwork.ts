import type { Engine } from '../engine/Engine';
import { getProject, loadTiles } from '../persistence/projects';
import { documentStore } from '../state/documentStore';
import { fileName } from './deliver';
import { encodeDrawthing } from './drawthing';
import { encodeImage } from './image';
import type { PsdLayerData } from './psd';
import { encodePsd } from './psdClient';

export type ExportFormat = 'png' | 'jpeg' | 'psd' | 'drawthing';

export interface ExportedFile {
  blob: Blob;
  filename: string;
}

/** Exports the open artwork from the engine; `.drawthing` is read from the saved project. */
export async function exportArtwork(
  engine: Engine,
  project: { id: string; name: string },
  format: ExportFormat,
  opts: { jpegQuality?: number; flush: () => Promise<void> },
): Promise<ExportedFile> {
  switch (format) {
    case 'png':
      return {
        blob: await encodeImage(engine.exportImage(false), 'image/png'),
        filename: fileName(project.name, 'png'),
      };
    case 'jpeg':
      return {
        blob: await encodeImage(engine.exportImage(true), 'image/jpeg', opts.jpegQuality ?? 0.92),
        filename: fileName(project.name, 'jpg'),
      };
    case 'psd':
      return { blob: await exportPsd(engine), filename: fileName(project.name, 'psd') };
    case 'drawthing':
      await opts.flush();
      return exportProjectFile(project.id);
  }
}

/** Layers cropped to their content, plus DrawThing's background as a layer of its own. */
async function exportPsd(engine: Engine): Promise<Blob> {
  const { width, height, background, groups } = documentStore.getState();
  const composite = engine.exportImage(false);
  const layers: PsdLayerData[] = engine.exportLayers().map(({ meta, left, top, pixels }) => {
    const group = groups.findIndex((g) => g.id === meta.groupId);
    return {
      name: meta.name,
      visible: meta.visible,
      opacity: meta.opacity,
      blendMode: meta.blendMode,
      alphaLocked: meta.alphaLocked,
      left,
      top,
      pixels,
      group: group < 0 ? undefined : group,
    };
  });
  const bg = new Uint8ClampedArray(width * height * 4);
  const n = Number.parseInt(background.color.slice(1), 16);
  for (let i = 0; i < bg.length; i += 4) {
    bg[i] = (n >> 16) & 255;
    bg[i + 1] = (n >> 8) & 255;
    bg[i + 2] = n & 255;
    bg[i + 3] = 255;
  }
  layers.unshift({
    name: 'Background',
    visible: background.visible,
    opacity: 1,
    blendMode: 'normal',
    alphaLocked: false,
    left: 0,
    top: 0,
    pixels: { width, height, data: bg },
  });
  return encodePsd({ width, height, layers, groups, composite });
}

/** A saved project as a `.drawthing` file (works from the gallery, without opening it). */
export async function exportProjectFile(id: string): Promise<ExportedFile> {
  const p = await getProject(id);
  if (!p) throw new Error('This artwork isn’t saved yet');
  const blob = await encodeDrawthing({
    name: p.name,
    createdAt: p.createdAt,
    doc: p.doc,
    tiles: await loadTiles(id),
    thumb: p.thumb,
  });
  return { blob, filename: fileName(p.name, 'drawthing') };
}
