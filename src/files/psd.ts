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
}

export interface PsdDocData {
  width: number;
  height: number;
  /** Bottom first. */
  layers: PsdLayerData[];
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
  const psd: Psd = {
    width: d.width,
    height: d.height,
    imageData: d.composite,
    children: d.layers.map((l): Layer => {
      const w = l.pixels?.width ?? 0;
      const h = l.pixels?.height ?? 0;
      return {
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
    }),
  };
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
  let approximated = 0;
  const walk = (children: Layer[], hidden: boolean) => {
    for (const l of children) {
      if (l.children) {
        if (l.blendMode && l.blendMode !== 'pass through' && l.blendMode !== 'normal') {
          approximated++;
        }
        walk(l.children, hidden || l.hidden === true);
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
      });
    }
  };
  walk(psd.children ?? [], false);
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
  return { width: psd.width, height: psd.height, layers, composite, approximated };
}
