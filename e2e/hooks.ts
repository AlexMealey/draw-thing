import type { Page } from '@playwright/test';

/** The parts of the Engine and Autosaver that ?debug exposes for tests. */
export interface EngineHook {
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
  }
}

/** Hash of the composited document. */
export const hash = (page: Page) => page.evaluate(() => window.__drawthing!.debugHash());
