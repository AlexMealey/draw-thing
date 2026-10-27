import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { PaletteInput } from '../../state/paletteStore';
import { hexToHsv, hexToRgb, hsvToHex, rgbToHex } from '../color';

/**
 * Palette files:
 *
 * - **Procreate `.swatches`:** a zip holding `Swatches.json`, one palette `{ name, swatches }` (or
 *   an array of them), each swatch `{ hue, saturation, brightness, alpha, colorSpace }` in 0–1 or
 *   null for an empty slot. Colors are read as sRGB.
 * - **GIMP `.gpl`:** text, read by GIMP, Krita, Inkscape, Aseprite and Lospec.
 */
export type PaletteFormat = 'swatches' | 'gpl';

export const PALETTE_TYPES: Record<PaletteFormat, string> = {
  swatches: 'application/zip',
  gpl: 'text/plain',
};

const MAX_NAME = 100;

export function toGpl(p: PaletteInput): string {
  const lines = ['GIMP Palette', `Name: ${oneLine(p.name)}`, 'Columns: 8', '#'];
  for (const hex of p.colors) {
    const [r, g, b] = hexToRgb(hex);
    lines.push(`${pad(r)} ${pad(g)} ${pad(b)}\t${hex}`);
  }
  return lines.join('\n') + '\n';
}

/** Throws if the text isn't a GIMP palette. */
export function parseGpl(text: string, fallbackName: string): PaletteInput {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== 'GIMP Palette') throw new Error('Not a GIMP palette');
  let name = '';
  const colors: string[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const field = /^(Name|Columns):\s*(.*)$/i.exec(line);
    if (field) {
      if (field[1]!.toLowerCase() === 'name') name = field[2]!.trim();
      continue;
    }
    const m = /^(\d+)\s+(\d+)\s+(\d+)\b/.exec(line);
    if (m) colors.push(rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])));
  }
  return { name: cleanName(name, fallbackName), colors };
}

export function toSwatches(p: PaletteInput): Uint8Array {
  const swatches = p.colors.map((hex) => {
    const { h, s, v } = hexToHsv(hex);
    return { hue: h / 360, saturation: s, brightness: v, alpha: 1, colorSpace: 0 };
  });
  const json = JSON.stringify({ name: oneLine(p.name), swatches });
  return zipSync({ 'Swatches.json': [strToU8(json), { level: 6 }] });
}

/** Throws if the bytes aren't a Procreate swatches file. */
export function parseSwatches(bytes: Uint8Array, fallbackName: string): PaletteInput[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Not a swatches file: not a zip file');
  }
  const path = Object.keys(entries).find((k) => /(^|\/)swatches\.json$/i.test(k));
  if (!path) throw new Error('Not a swatches file: Swatches.json is missing');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(entries[path]!));
  } catch {
    throw new Error('Not a swatches file: Swatches.json is not JSON');
  }
  const list = (Array.isArray(raw) ? raw : [raw]).filter(isObject);
  const out = list
    .filter((p) => Array.isArray(p.swatches))
    .map((p) => ({
      name: cleanName(typeof p.name === 'string' ? p.name : '', fallbackName),
      colors: (p.swatches as unknown[]).filter(isObject).flatMap((s) => {
        const h = unit(s.hue);
        const sat = unit(s.saturation);
        const v = unit(s.brightness);
        return h === null || sat === null || v === null
          ? []
          : [hsvToHex({ h: h * 360, s: sat, v })];
      }),
    }));
  if (out.length === 0) throw new Error('Not a swatches file: no palette in it');
  return out;
}

/** Reads a `.swatches` or `.gpl` file (told apart by content); throws if it's neither. */
export async function readPaletteFile(file: File): Promise<PaletteInput[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fallback = file.name.replace(/\.[^.]*$/, '');
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseSwatches(bytes, fallback); // "PK"
  return [parseGpl(strFromU8(bytes), fallback)];
}

export function encodePalette(p: PaletteInput, format: PaletteFormat): Blob {
  const data = format === 'gpl' ? toGpl(p) : (toSwatches(p) as Uint8Array<ArrayBuffer>);
  return new Blob([data], { type: PALETTE_TYPES[format] });
}

const pad = (n: number) => String(n).padStart(3, ' ');
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const cleanName = (name: string, fallback: string) =>
  (oneLine(name) || oneLine(fallback) || 'Palette').slice(0, MAX_NAME);

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** A number in 0–1 (clamped), or null. */
function unit(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : null;
}
