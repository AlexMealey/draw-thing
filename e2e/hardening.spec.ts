import { expect, type Page, test } from '@playwright/test';
import { hash, mouseUp } from './hooks';

// Phase 7: surviving a GPU reset, "Open with DrawThing", and the install coach.

type LaunchConsumer = (params: { files: { getFile(): Promise<File> }[] }) => void;

declare global {
  interface Window {
    __loseContext?: WEBGL_lose_context;
    __launch?: LaunchConsumer;
    launchQueue?: { setConsumer(consumer: LaunchConsumer): void };
  }
}

async function ready(page: Page) {
  await page.waitForFunction(() => window.__drawthing !== undefined);
  await expect(page.getByText('Opening…')).toHaveCount(0);
}

async function stroke(page: Page, y: number) {
  await page.mouse.move(200, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 60, y + Math.cos(i) * 30);
  await mouseUp(page);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
});

test('rebuilds every layer after the WebGL context is lost, keeping undo', async ({ page }) => {
  await page.goto('/?debug=1');
  await ready(page);
  await stroke(page, 250);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.keyboard.press('Escape');
  await stroke(page, 400);
  await page.evaluate(() => window.__drawthingSaver!.flush());
  const beforeLast = await hash(page);
  // The last stroke is never flushed here: restoring has to save it first.
  await stroke(page, 550);
  await page.waitForTimeout(300); // its readback lands within a few frames
  const before = await hash(page);
  expect(before).not.toBe(beforeLast);

  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Drawing canvas"]',
    )!;
    window.__loseContext = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    window.__loseContext.loseContext();
  });
  await expect(page.getByText('Restoring the canvas…')).toBeVisible();
  // Painting does nothing meanwhile.
  await stroke(page, 650);

  await page.evaluate(() => window.__loseContext!.restoreContext());
  await expect(page.getByText('Restoring the canvas…')).toHaveCount(0);
  expect(await hash(page)).toBe(before);

  // History survived too: undo still steps back exactly.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.evaluate(() => window.__drawthing!.whenIdle());
  expect(await hash(page)).toBe(beforeLast);
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.evaluate(() => window.__drawthing!.whenIdle());
  expect(await hash(page)).toBe(before);

  // And the rebuilt canvas keeps drawing and saving.
  await stroke(page, 650);
  await page.evaluate(() => window.__drawthingSaver!.flush());
  const after = await hash(page);
  await page.reload();
  await ready(page);
  expect(await hash(page)).toBe(after);
});

test('opens files handed over by the OS as new artworks', async ({ page }) => {
  // What Chromium does for an installed app's file_handlers, minus the OS.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', {
      value: { setConsumer: (consumer: LaunchConsumer) => (window.__launch = consumer) },
    });
  });
  await page.goto('/?debug=1');
  await ready(page);
  const first = await page.evaluateHandle(() => window.__drawthing);

  await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(320, 200);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e4572e';
    ctx.fillRect(40, 40, 120, 80);
    const file = new File([await canvas.convertToBlob()], 'Sketch.png', { type: 'image/png' });
    window.__launch!({ files: [{ getFile: async () => file }] });
  });
  await page.waitForFunction((prev) => window.__drawthing && window.__drawthing !== prev, first);
  await ready(page);
  expect(await page.evaluate(() => [window.__drawthing!.docW, window.__drawthing!.docH])).toEqual([
    320, 200,
  ]);
  await page.getByRole('button', { name: 'Gallery' }).click();
  await expect(page.getByRole('button', { name: 'Open Sketch' })).toBeVisible();
});

test.describe('on iPad Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('shows the install coach once, and again from Actions', async ({ page }) => {
    await page.goto('/');
    const coach = page.getByRole('dialog', { name: 'Install DrawThing' });
    await expect(coach).toBeVisible();
    await expect(coach.getByText('Add to Home Screen')).toBeVisible();
    await coach.getByRole('button', { name: 'Got it' }).click();
    await expect(coach).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('Drawing canvas')).toBeVisible();
    await expect(coach).toHaveCount(0);

    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('button', { name: 'Install app…' }).click();
    await expect(coach).toBeVisible();
  });
});

test('offers the browser install dialog when Chromium allows it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Drawing canvas')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Install DrawThing' })).toHaveCount(0);
  await page.evaluate(() => {
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => void ((window as { prompted?: boolean }).prompted = true),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(e);
  });
  await page.getByRole('button', { name: 'Gallery' }).click();
  await page.getByRole('button', { name: 'Install app' }).click();
  await page
    .getByRole('dialog', { name: 'Install DrawThing' })
    .getByRole('button', { name: 'Install', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as { prompted?: boolean }).prompted))
    .toBe(true);
  // One prompt per event: the button goes away.
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
});
