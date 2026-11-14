import type { Engine } from '../engine/Engine';
import { gifDelays } from '../engine/frames/timing';
import { MAX_DOC_SIZE } from '../engine/limits';
import { documentStore } from '../state/documentStore';
import { fileName } from './deliver';
import type { ExportedFile } from './exportArtwork';

export type AnimationFormat = 'gif' | 'mp4';

export interface AnimationExportOptions {
  format: AnimationFormat;
  /** Output size, px (MP4 rounds to even numbers). */
  width: number;
  height: number;
  /** Smooth resampling; false keeps hard pixels (pixel art). */
  smooth: boolean;
  /** Ticks per second: each frame shows for hold / fps seconds. */
  fps: number;
  /** GIF: loop forever (otherwise it plays once). */
  loop: boolean;
  /** MP4: how many times the animation plays in the video. */
  repeat: number;
  signal?: AbortSignal;
  /** Frames done so far, out of the total. */
  onProgress?: (done: number, total: number) => void;
}

export const MAX_EXPORT_SIZE = MAX_DOC_SIZE;

/** Lets the page breathe between frames (progress, Cancel), and stops if cancelled. */
async function breathe(signal: AbortSignal | undefined) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}

function render(engine: Engine, frameId: string, o: AnimationExportOptions, opaque: boolean) {
  const img = engine.frameImage(frameId, o.width, o.height, { smooth: o.smooth, opaque });
  if (!img) throw new Error('The canvas isn’t ready yet; try again in a moment');
  return img;
}

/**
 * Renders every frame of the open artwork at the chosen size and encodes them as an animated
 * GIF or an MP4 video, one frame at a time.
 */
export async function exportAnimation(
  engine: Engine,
  project: { name: string },
  o: AnimationExportOptions,
): Promise<ExportedFile> {
  const doc = documentStore.getState();
  const frames = doc.frames;
  const clamp = (n: number) => Math.min(MAX_EXPORT_SIZE, Math.max(1, Math.round(n)));
  o = { ...o, width: clamp(o.width), height: clamp(o.height) };
  try {
    return o.format === 'gif'
      ? await exportGif(engine, project, frames, !doc.background.visible, o)
      : await exportMp4(engine, project, frames, o);
  } finally {
    engine.disposeExportScaler();
  }
}

async function exportGif(
  engine: Engine,
  project: { name: string },
  frames: readonly { id: string; hold: number }[],
  transparent: boolean,
  o: AnimationExportOptions,
): Promise<ExportedFile> {
  const { createGifWriter } = await import('./gifClient');
  const delays = gifDelays(
    frames.map((f) => f.hold),
    o.fps,
  );
  const writer = await createGifWriter({
    width: o.width,
    height: o.height,
    transparent,
    repeat: o.loop ? 0 : -1,
  });
  try {
    for (const [i, f] of frames.entries()) {
      await breathe(o.signal);
      await writer.add(render(engine, f.id, o, !transparent), delays[i]!);
      o.onProgress?.(i + 1, frames.length);
    }
    const blob = await writer.finish();
    return { blob, filename: fileName(project.name, 'gif') };
  } catch (err) {
    writer.cancel();
    throw err;
  }
}

async function exportMp4(
  engine: Engine,
  project: { name: string },
  frames: readonly { id: string; hold: number }[],
  o: AnimationExportOptions,
): Promise<ExportedFile> {
  const { createMp4Writer, evenSize } = await import('./mp4');
  const width = evenSize(o.width);
  const height = evenSize(o.height);
  const opts = { ...o, width, height };
  const writer = await createMp4Writer(width, height, o.fps);
  const repeat = Math.max(1, Math.round(o.repeat));
  // Constant frame rate: one video frame per tick, so held frames repeat (players and sites
  // handle that best). A drawing is rendered once per pass and reused for its ticks.
  const total = frames.reduce((n, f) => n + f.hold, 0) * repeat;
  let tick = 0;
  try {
    for (let pass = 0; pass < repeat; pass++) {
      for (const f of frames) {
        await breathe(o.signal);
        const img = render(engine, f.id, opts, true);
        for (let k = 0; k < f.hold; k++) {
          await writer.add(img, tick / o.fps, 1 / o.fps);
          tick++;
        }
        o.onProgress?.(tick, total);
      }
    }
    const blob = await writer.finish();
    return { blob, filename: fileName(project.name, 'mp4') };
  } catch (err) {
    await writer.cancel().catch(() => {});
    throw err;
  }
}
