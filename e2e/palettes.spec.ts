import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

// Palettes: made by hand, exported and imported as files, made from an image, and shown in the
// color panel.

test.beforeEach(async ({ page }) => {
  // Downloads instead of the system Save dialog, which a headless browser can't drive.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__drawthing !== undefined);
});

const colorPanel = (page: Page) => page.getByRole('dialog', { name: 'Color' });

async function openPalettes(page: Page) {
  if (!(await colorPanel(page).isVisible())) {
    await page.getByRole('button', { name: 'Color', exact: true }).click();
  }
  await colorPanel(page).getByRole('button', { name: 'Palettes…' }).click();
  return page.getByRole('dialog', { name: 'Palettes' });
}

test('make, export, delete and re-import a palette, and show it in the color panel', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const modal = await openPalettes(page);
  const name = modal.getByRole('textbox', { name: 'Palette name' });

  await modal.getByRole('button', { name: 'New', exact: true }).click();
  await expect(name).toHaveValue('Palette');
  await modal.getByRole('button', { name: 'Add current color' }).click();
  await modal.getByRole('textbox', { name: 'Hex color' }).fill('#ff8800');
  await modal.getByRole('textbox', { name: 'Hex color' }).press('Enter');
  await modal.getByRole('button', { name: 'Add current color' }).click();
  await expect(modal.getByRole('button', { name: 'Use #ff8800' })).toBeVisible();
  await name.fill('Warm');
  await name.press('Enter');
  await expect(modal.getByRole('button', { name: /^Warm/ })).toBeVisible();

  const download = page.waitForEvent('download');
  await modal.getByRole('button', { name: 'Export .gpl' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Warm.gpl');
  const gpl = readFileSync(await file.path());
  expect(gpl.toString()).toContain('Name: Warm');
  expect(gpl.toString()).toContain('255 136   0\t#ff8800');

  await modal.getByRole('button', { name: 'Delete palette' }).click();
  await modal.getByRole('button', { name: 'Delete Warm' }).click();
  await expect(modal.getByRole('button', { name: /^Warm/ })).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: 'Import…' }).click();
  await (await chooser).setFiles({ name: 'Warm.gpl', mimeType: 'text/plain', buffer: gpl });
  await expect(name).toHaveValue('Warm');
  await expect(modal.getByRole('button', { name: /^Use / })).toHaveCount(2);

  await modal.getByRole('button', { name: 'Show in Color panel' }).click();
  await modal.getByRole('button', { name: 'Close' }).click();
  const panel = colorPanel(page);
  await expect(panel.getByRole('heading', { name: 'Warm' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Color #ff8800' })).toBeVisible();
  await panel.getByRole('button', { name: 'Add current color to palette' }).click();
  await expect(panel.getByRole('button', { name: /^Color #/ })).toHaveCount(3);

  // Palettes are kept on the device.
  await page.reload();
  await page.waitForFunction(() => window.__drawthing !== undefined);
  await page.getByRole('button', { name: 'Color', exact: true }).click();
  await expect(colorPanel(page).getByRole('heading', { name: 'Warm' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a palette from the colors of an image', async ({ page }) => {
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(60, 20);
    const ctx = canvas.getContext('2d')!;
    ['#ff0000', '#00ff00', '#0000ff'].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(i * 20, 0, 20, 20);
    });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const modal = await openPalettes(page);
  const chooser = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: 'From image…' }).click();
  await (
    await chooser
  ).setFiles({ name: 'Stripes.png', mimeType: 'image/png', buffer: Buffer.from(png) });

  const extracted = modal.getByRole('list', { name: 'Extracted colors' }).getByRole('listitem');
  await expect(extracted).toHaveCount(3);
  await expect(modal.getByText('Only 3 distinct colors found.')).toBeVisible();
  await modal.getByRole('slider', { name: /^Colors/ }).fill('2');
  await expect(extracted).toHaveCount(2);
  await modal.getByRole('button', { name: 'Create palette' }).click();
  await expect(modal.getByRole('textbox', { name: 'Palette name' })).toHaveValue('Stripes');
  await expect(modal.getByRole('button', { name: /^Use / })).toHaveCount(2);
});
