import {
  type BlendMode as PsdBlendMode,
  initializeCanvas,
  type Layer,
  type Psd,
  readPsd,
  writePsdUint8Array,
} from 'ag-psd';
import { BLEND_MODES, type BlendMode } from '../state/documentStore';
import type { Pixels } from './image';

// ag-psd only needs plain pixel buffers when given `imageData`, so no canvas is required: this
// module runs in a worker and in unit tests.
initializeCanvas(
  () => {
    throw new Error('ag-psd: no canvas available');
  },
  (width, height) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

export interface PsdLayerData {
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  alphaLocked: boolean;
  /** Position of `pixels` in the document; layers are cropped to their content. */
  left: number;
  top: number;
  /** Straight alpha; null for an empty layer. */
  pixels: Pixels | null;
  /** Index into `PsdDocData.groups`; a group's layers are adjacent. */
  group?: number;
}

/** A layer folder (one level: deeper folders are merged into their top-level one). */
export interface PsdGroupData {
  name: string;
  visible: boolean;
  opacity: number;
  alphaLocked: boolean;
}

export interface PsdDocData {
  width: number;
  height: number;
  /** Bottom first. */
  layers: PsdLayerData[];
  groups?: PsdGroupData[];
  /** The flattened image, shown by apps that don't read layers. */
  composite?: Pixels;
}

const TO_PSD: Record<BlendMode, PsdBlendMode> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  add: 'linear dodge',
};

const FROM_PSD = new Map<PsdBlendMode, BlendMode>(BLEND_MODES.map((m) => [TO_PSD[m], m]));

export function writePsdFile(d: PsdDocData): Uint8Array {
  const children: Layer[] = [];
  let folder = null as { index: number; layer: Layer } | null;
  for (const l of d.layers) {
    const w = l.pixels?.width ?? 0;
    const h = l.pixels?.height ?? 0;
    const layer: Layer = {
      name: l.name,
      hidden: !l.visible,
      opacity: l.opacity,
      blendMode: TO_PSD[l.blendMode],
      transparencyProtected: l.alphaLocked,
      left: l.left,
      top: l.top,
      right: l.left + w,
      bottom: l.top + h,
      imageData: l.pixels ?? undefined,
    };
    const g = l.group === undefined ? undefined : d.groups?.[l.group];
    if (!g || l.group === undefined) {
      folder = null;
      children.push(layer);
      continue;
    }
    if (folder?.index !== l.group) {
      // DrawThing groups are pass-through, like Photoshop's default for folders.
      folder = {
        index: l.group,
        layer: {
          name: g.name,
          hidden: !g.visible,
          opacity: g.opacity,
          blendMode: 'pass through',
          transparencyProtected: g.alphaLocked,
          children: [],
        },
      };
      children.push(folder.layer);
    }
    folder.layer.children!.push(layer);
  }
  const psd: Psd = { width: d.width, height: d.height, imageData: d.composite, children };
  // noBackground: an opaque bottom layer stays a normal layer, as it is in DrawThing.
  return writePsdUint8Array(psd, { noBackground: true });
}

export interface PsdImport extends PsdDocData {
  /** Layers that couldn't be represented exactly (e.g. an unsupported blend mode). */
  approximated: number;
}

/** Reads an 8-bit RGB PSD. Groups are flattened into the stack; their children are kept. */
export function readPsdFile(buffer: ArrayBuffer): PsdImport {
  const psd = readPsd(buffer, { useImageData: true, skipThumbnail: true });
  if ((psd.bitsPerChannel ?? 8) !== 8) throw new Error('Only 8-bit PSD files can be opened');
  const layers: PsdLayerData[] = [];
  const groups: PsdGroupData[] = [];
  let approximated = 0;
  // Top-level folders become groups; deeper ones fold their visibility into their layers.
  const walk = (children: Layer[], hidden: boolean, group: number | undefined) => {
    for (const l of children) {
      if (l.children) {
        if (l.blendMode && l.blendMode !== 'pass through' && l.blendMode !== 'normal') {
          approximated++;
        }
        if (group === undefined) {
          groups.push({
            name: l.name ?? `Group ${groups.length + 1}`,
            visible: l.hidden !== true,
            opacity: l.opacity ?? 1,
            alphaLocked: l.transparencyProtected === true,
          });
          walk(l.children, hidden, groups.length - 1);
        } else {
          if ((l.opacity ?? 1) < 1) approximated++;
          walk(l.children, hidden || l.hidden === true, group);
        }
        continue;
      }
      const mode = (l.blendMode && FROM_PSD.get(l.blendMode)) ?? 'normal';
      const unsupported = l.blendMode !== undefined && !FROM_PSD.has(l.blendMode);
      if (unsupported || l.text || l.placedLayer || l.mask || l.effects) approximated++;
      const px = l.imageData;
      layers.push({
        name: l.name ?? `Layer ${layers.length + 1}`,
        visible: !(hidden || l.hidden),
        opacity: l.opacity ?? 1,
        blendMode: mode,
        alphaLocked: l.transparencyProtected === true,
        left: l.left ?? 0,
        top: l.top ?? 0,
        pixels: px && px.width > 0 && px.height > 0 ? (px as Pixels) : null,
        group,
      });
    }
  };
  walk(psd.children ?? [], false, undefined);
  // A flat PSD has no layers, only the composite image.
  if (layers.length === 0 && psd.imageData) {
    layers.push({
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      alphaLocked: false,
      left: 0,
      top: 0,
      pixels: psd.imageData as Pixels,
    });
  }
  const composite = psd.imageData as Pixels | undefined;
  return { width: psd.width, height: psd.height, layers, groups, composite, approximated };
}
