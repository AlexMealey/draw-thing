import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { readPsd } from 'ag-psd';
import { hash, mouseUp } from './hooks';

// Phase 6: artwork survives a reload, and exports/imports round-trip.

async function ready(page: Page) {
  await page.waitForFunction(() => window.__drawthing !== undefined);
  await expect(page.getByText('Opening…')).toHaveCount(0);
}

async function stroke(page: Page, y: number) {
  await page.mouse.move(200, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 60, y + Math.sin(i) * 30);
  await mouseUp(page);
}

test.beforeEach(async ({ page }) => {
  // Downloads instead of the system Save dialog, which a headless browser can't drive.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.setViewportSize({ width: 1200, height: 800 });
});

test('artwork is saved and reopens after a reload', async ({ page }) => {
  await page.goto('/?debug=1');
  await ready(page);
  await stroke(page, 300);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Add layer', exact: true }).click();
  await page.keyboard.press('Escape');
  await stroke(page, 450);
  await page.evaluate(() => window.__drawthingSaver!.flush());
  const before = await hash(page);

  await page.reload();
  await ready(page);
  expect(await hash(page)).toBe(before);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Layers/ }).getByText('Layer 2')).toBeVisible();

  // The gallery lists it, with a thumbnail.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Gallery' }).click();
  const card = page.getByRole('button', { name: 'Open Untitled Artwork' });
  await expect(card).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('src', /^blob:/);
});

test('exports PNG, JPEG, PSD and .drawthing, and re-imports .drawthing exactly', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/?debug=1');
  await ready(page);
  await stroke(page, 350);
  const original = await hash(page);

  const exportAs = async (label: string) => {
    if (!(await page.getByRole('dialog', { name: 'Actions' }).isVisible())) {
      await page.getByRole('button', { name: 'Actions' }).click();
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const d = await download;
    return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
  };

  const png = await exportAs('PNG');
  expect(png.name).toBe('Untitled Artwork.png');
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');
  const size = await page.evaluate(() => [
    innerWidth * devicePixelRatio,
    innerHeight * devicePixelRatio,
  ]);
  expect([png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)]).toEqual(size);

  const jpeg = await exportAs('JPEG');
  expect(jpeg.name).toBe('Untitled Artwork.jpg');
  expect([...jpeg.bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);

  const psdFile = await exportAs('PSD');
  const psd = readPsd(psdFile.bytes, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  expect(psd.children?.map((l) => l.name)).toEqual(['Background', 'Layer 1']);

  const dt = await exportAs('DrawThing');
  expect(dt.name).toBe('Untitled Artwork.drawthing');

  // Import it from the gallery as a second artwork and open that.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Gallery' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (
    await chooser
  ).setFiles({ name: 'Copy.drawthing', mimeType: 'application/zip', buffer: dt.bytes });
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(2);
  // The import keeps the name stored in the file; the newest card is the import.
  await page.evaluate(() => ((window as { previous?: unknown }).previous = window.__drawthing));
  await page
    .getByRole('button', { name: /^Open / })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Gallery' })).toHaveCount(0);
  await page.waitForFunction(
    () => window.__drawthing && window.__drawthing !== (window as { previous?: unknown }).previous,
  );
  await ready(page);
  expect(await hash(page)).toBe(original);
});

test('incremental saves stay exact through layer operations and undo', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?debug=1');
  await ready(page);
  const layers = async () => {
    if (!(await page.getByRole('dialog', { name: /^Layers/ }).isVisible())) {
      await page.getByRole('button', { name: 'Layers', exact: true }).click();
    }
    return page.getByRole('dialog', { name: /^Layers/ });
  };
  const layerButton = async (name: string) =>
    (await layers()).getByRole('button', { name, exact: true }).click();
  const undo = () => page.getByRole('button', { name: 'Undo' }).click();
  // Save between some steps but not others, so saves cover one change and several.
  const save = () => page.evaluate(() => window.__drawthingSaver!.flush());

  await stroke(page, 250);
  await save();
  await layerButton('Add layer');
  await page.keyboard.press('Escape');
  await stroke(page, 350);
  await layerButton('Duplicate');
  await save();
  await layerButton('Delete');
  await undo(); // the deleted layer comes back with its pixels
  await save();
  await layerButton('Merge down');
  await page.keyboard.press('Escape');
  await stroke(page, 500);
  await save();
  await layerButton('Flatten');
  await save();
  await undo();
  await layerButton('Clear');
  await undo();
  await save();
  const before = await hash(page);

  await page.reload();
  await ready(page);
  expect(await hash(page)).toBe(before);
});
