import { expect, type Page, test } from '@playwright/test';

// Phase 4 exit criterion: undo/redo is pixel-identical, through repeated cycles, across strokes
// and every kind of layer operation.

/** The part of the Engine that ?debug exposes as window.__drawthing. */
interface EngineHook {
  debugHash(): string;
  undo(): void;
  redo(): void;
  whenIdle(): Promise<void>;
}

declare global {
  interface Window {
    __drawthing?: EngineHook;
  }
}

const hash = (page: Page) => page.evaluate(() => window.__drawthing!.debugHash());

async function stroke(page: Page, y: number, x0 = 160, x1 = 820) {
  await page.mouse.move(x0, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y + Math.sin(i / 2) * 25, { steps: 3 });
  }
  await page.mouse.up();
}

test('100+ undo/redo steps reproduce every state exactly', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__drawthing !== undefined);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

  const brush = (name: string) => page.getByRole('radio', { name }).click();
  const color = (c: string) => page.getByRole('button', { name: `Color ${c}` }).click();

  // Each step changes the document; record the image after it.
  const states = [await hash(page)];
  const step = async (action: () => Promise<unknown>) => {
    await action();
    states.push(await hash(page));
  };

  await color('#0a84ff');
  for (const [i, name] of ['Ink', 'Pencil', 'Airbrush', 'Marker', 'Chalk'].entries()) {
    await brush(name);
    await step(() => stroke(page, 240 + i * 70));
  }
  await step(() => page.getByRole('button', { name: 'Add layer' }).click());
  await step(() => page.locator('#layer-opacity').fill('60'));
  await brush('Ink');
  await color('#ff375f');
  await step(() => stroke(page, 300, 300, 600));
  await step(() => page.getByLabel('Blend').selectOption('multiply'));
  await page.getByRole('button', { name: 'Eraser' }).click();
  await step(() => stroke(page, 450, 200, 700));
  await page.getByRole('button', { name: 'Eraser' }).click();
  await step(() => page.getByRole('button', { name: 'Merge down' }).click());
  await step(() => page.getByRole('button', { name: 'Add layer' }).click());
  await color('#30d158');
  await step(() => stroke(page, 600));
  await step(() => page.getByRole('button', { name: 'Delete' }).click());
  await step(() => page.getByRole('button', { name: 'Hide background' }).click());
  await step(() => page.getByRole('button', { name: 'Add layer' }).click());
  await step(() => stroke(page, 700));
  await step(() => page.getByRole('button', { name: 'Flatten' }).click());
  await step(() => page.getByRole('button', { name: 'Clear' }).click());

  const n = states.length - 1;
  expect(new Set(states).size).toBeGreaterThan(10); // the steps really changed pixels

  // Keyboard path once.
  await page.keyboard.press('Control+z');
  await page.evaluate(() => window.__drawthing!.whenIdle());
  expect(await hash(page)).toBe(states[n - 1]);
  await page.keyboard.press('Control+Shift+z');
  await page.evaluate(() => window.__drawthing!.whenIdle());
  expect(await hash(page)).toBe(states[n]);

  // Full undo/redo cycles, checking every intermediate image.
  let operations = 0;
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let i = n; i > 0; i--) {
      const h = await page.evaluate(async () => {
        window.__drawthing!.undo();
        await window.__drawthing!.whenIdle();
        return window.__drawthing!.debugHash();
      });
      expect(h, `undo to state ${i - 1} (cycle ${cycle})`).toBe(states[i - 1]);
      operations++;
    }
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    for (let i = 1; i <= n; i++) {
      const h = await page.evaluate(async () => {
        window.__drawthing!.redo();
        await window.__drawthing!.whenIdle();
        return window.__drawthing!.debugHash();
      });
      expect(h, `redo to state ${i} (cycle ${cycle})`).toBe(states[i]);
      operations++;
    }
  }
  expect(operations).toBeGreaterThanOrEqual(100);
  expect(errors).toEqual([]);
});
