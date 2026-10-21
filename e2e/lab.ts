import type { CDPSession, Page } from '@playwright/test';

/** The parts of the lab page (`?lab`) the tests use; see src/lab/Lab.tsx. */
export interface LabEngine {
  readonly docW: number;
  readonly docH: number;
  debugHash(): string;
  viewPoint(x: number, y: number): [number, number];
  startRecording(note?: string): void;
  stopRecording(): unknown;
  replay(rec: unknown, pace?: 'instant' | 'recorded'): Promise<void>;
  exportImage(opaque: boolean): ImageData;
  whenIdle(): Promise<void>;
  takeChanges(): unknown;
}

export interface LabHook {
  engine: LabEngine;
  playScene(scene: unknown): Promise<void>;
  png(): Promise<string>;
  runBenchmarks(options?: Record<string, number>): Promise<{
    env: Record<string, unknown>;
    results: {
      id: string;
      label: string;
      value: number | null;
      unit: string;
      target: string;
      pass: boolean | null;
      detail?: string;
    }[];
  }>;
  useBrush(presetId: string, patch?: Record<string, unknown>): void;
}

declare global {
  interface Window {
    __lab?: LabHook;
  }
}

/** Opens the lab on a scratch document of the given size, without its panel. */
export async function openLab(page: Page, w: number, h: number) {
  await page.goto(`/?lab&w=${w}&h=${h}&ui=0`);
  await page.waitForFunction(() => window.__lab !== undefined);
}

export const labHash = (page: Page) => page.evaluate(() => window.__lab!.engine.debugHash());

/** A document point in page coordinates (the lab canvas fills the window). */
export const toPage = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => window.__lab!.engine.viewPoint(x, y), [x, y] as const);

export interface PenSample {
  /** Document px. */
  x: number;
  y: number;
  /** 0..1 */
  force: number;
  tiltX?: number;
  tiltY?: number;
}

/**
 * A pen stroke through Chromium's input pipeline (CDP), with pressure and tilt: the same path a
 * Surface Pen takes, from the browser's input handling through PointerInput.
 */
export async function penStroke(
  page: Page,
  cdp: CDPSession,
  samples: readonly PenSample[],
  opts: { buttons?: number } = {},
) {
  const buttons = opts.buttons ?? 1;
  const at = async (s: PenSample) => {
    const [x, y] = await toPage(page, s.x, s.y);
    return { x, y, force: s.force, tiltX: s.tiltX ?? 0, tiltY: s.tiltY ?? 0 };
  };
  const points = await Promise.all(samples.map(at));
  const [first, ...rest] = points;
  if (!first) return;
  const pen = { pointerType: 'pen' as const, button: 'left' as const, buttons, clickCount: 1 };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pen, ...first });
  for (const p of rest)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pen, ...p });
  const last = points[points.length - 1]!;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...pen,
    buttons: 0,
    ...last,
    force: 0,
  });
  await settle(page);
}

/** Waits until the engine has drawn and committed everything received so far. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await window.__lab!.engine.whenIdle();
    window.__lab!.engine.takeChanges();
  });
}

/**
 * Rows of column `x` (doc px) with ink on the white paper (also light, grainy pencil), i.e. the
 * width of a stroke where it crosses `x`.
 */
export const inkHeight = (page: Page, x: number, y0: number, y1: number) =>
  page.evaluate(
    ([x, y0, y1]) => {
      const img = window.__lab!.engine.exportImage(true);
      let rows = 0;
      for (let y = y0; y < y1; y++) if ((img.data[(y * img.width + x) * 4] ?? 255) < 220) rows++;
      return rows;
    },
    [x, y0, y1] as const,
  );
