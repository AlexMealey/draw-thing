import type { Page } from '@playwright/test';

/** The parts of the Engine and Autosaver that ?debug exposes for tests. */
export interface EngineHook {
  readonly docW: number;
  readonly docH: number;
  debugHash(): string;
  undo(): void;
  redo(): void;
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
