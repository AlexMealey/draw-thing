import type { Page } from '@playwright/test';

/** The parts of the Engine and Autosaver that ?debug exposes for tests. */
export interface EngineHook {
  readonly docW: number;
  readonly docH: number;
  debugHash(): string;
  debugFrameHash(frameId: string): string;
  frameIds(): string[];
  selectFrame(id: string): boolean;
  readonly playing: boolean;
  undo(): void;
  redo(): void;
  rotateView(degrees: number): void;
  whenIdle(): Promise<void>;
}

export interface SaverHook {
  flush(): Promise<void>;
}

declare global {
  interface Window {
    __drawthing?: EngineHook;
    __drawthingSaver?: SaverHook;
    __pointerUp?: Promise<void>;
  }
}

/** Hash of the composited document. */
export const hash = (page: Page) => page.evaluate(() => window.__drawthing!.debugHash());

/** The animation's frame ids, in order. */
export const frameIds = (page: Page) => page.evaluate(() => window.__drawthing!.frameIds());

/** Hash of one frame, flattened on its background. */
export const frameHash = (page: Page, id: string) =>
  page.evaluate((frame) => window.__drawthing!.debugFrameHash(frame), id);

/**
 * Releases the mouse and waits until the page has handled the pointerup. Playwright's input and
 * page.evaluate() travel separately, so a save right after `mouse.up()` could miss the stroke.
 */
export async function mouseUp(page: Page) {
  await page.evaluate(() => {
    window.__pointerUp = new Promise((resolve) =>
      addEventListener('pointerup', () => resolve(), { once: true, capture: true }),
    );
  });
  await page.mouse.up();
  await page.evaluate(() => window.__pointerUp);
}
