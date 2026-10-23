import { expect, type Page, test } from '@playwright/test';
import { hash, mouseUp } from './hooks';

// Adjustments preview on the active layer, apply as one undo step, and cancel cleanly; layer
// groups change how their layers are drawn and painted.

async function stroke(page: Page, y: number) {
  await page.mouse.move(200, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 60, y + Math.sin(i) * 30);
  await mouseUp(page);
}

const idle = (page: Page) => page.evaluate(() => window.__drawthing!.whenIdle());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__drawthing !== undefined);
});

test('adjustments preview, cancel, apply and undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const panel = page.getByRole('dialog');
  const open = async (name: string) => {
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Adjustments', exact: true }).click();
    }
    await panel.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  };
  const slider = (name: string) => panel.getByRole('slider', { name: new RegExp(`^${name}`) });

  await stroke(page, 300);
  await stroke(page, 450);
  const original = await hash(page);

  // Cancel leaves the layer as it was.
  await open('Gaussian Blur');
  await slider('Radius').fill('20');
  const preview = await hash(page);
  expect(preview).not.toBe(original);
  await panel.getByRole('button', { name: 'Cancel' }).click();
  expect(await hash(page)).toBe(original);

  // Painting waits while an adjustment is open.
  await open('Gaussian Blur');
  await slider('Radius').fill('20');
  await stroke(page, 600);
  expect(await hash(page)).toBe(preview);
  await panel.getByRole('button', { name: 'Apply' }).click();
  const blurred = await hash(page);
  expect(blurred).toBe(preview);

  const steps = [original, blurred];
  for (const [name, settings] of [
    ['Hue, Saturation', { Hue: '90', Saturation: '0.5' }],
    ['Brightness & Contrast', { Brightness: '-0.3', Contrast: '0.6' }],
    ['Motion Blur', { Distance: '150', Angle: '30' }], // two passes: samples > 1 px apart
    ['Motion Blur', { Distance: '20', Angle: '120' }],
  ] as const) {
    await open(name);
    for (const [label, value] of Object.entries(settings)) await slider(label).fill(value);
    await panel.getByRole('button', { name: 'Apply' }).click();
    steps.push(await hash(page));
  }
  expect(new Set(steps).size).toBe(steps.length);

  // Closing the panel cancels.
  await open('Gaussian Blur');
  await slider('Radius').fill('50');
  await page.keyboard.press('Escape');
  expect(await hash(page)).toBe(steps[steps.length - 1]);

  for (let i = steps.length - 1; i > 0; i--) {
    await page.evaluate(() => window.__drawthing!.undo());
    await idle(page);
    expect(await hash(page), `undo to step ${i - 1}`).toBe(steps[i - 1]);
  }
  for (let i = 1; i < steps.length; i++) {
    await page.evaluate(() => window.__drawthing!.redo());
    await idle(page);
    expect(await hash(page), `redo to step ${i}`).toBe(steps[i]);
  }
  expect(errors).toEqual([]);
});

test('group opacity, visibility and alpha lock apply to their layers', async ({ page }) => {
  const layers = page.getByRole('dialog', { name: /^Layers/ });
  const showLayers = async () => {
    if (!(await layers.isVisible())) {
      await page.getByRole('button', { name: 'Layers', exact: true }).click();
    }
  };
  const button = async (name: string) => {
    await showLayers();
    await layers.getByRole('button', { name, exact: true }).click();
  };

  await stroke(page, 300);
  await button('Add layer');
  await page.keyboard.press('Escape');
  await stroke(page, 330);
  const plain = await hash(page);

  await button('Group');
  expect(await hash(page)).toBe(plain); // grouping alone changes nothing
  await layers.getByRole('slider', { name: /^Group opacity/ }).fill('0.5');
  const faded = await hash(page);
  expect(faded).not.toBe(plain);

  await layers.getByRole('checkbox', { name: 'Hide Group 1' }).click();
  const hidden = await hash(page);
  expect(hidden).not.toBe(faded);
  await page.keyboard.press('Escape');
  await stroke(page, 500); // refused: its group is hidden
  expect(await hash(page)).toBe(hidden);

  await showLayers();
  await layers.getByRole('checkbox', { name: 'Show Group 1' }).click();
  await layers.getByRole('button', { name: /^Group 1/ }).click(); // select it for its settings
  await layers.getByRole('checkbox', { name: 'Alpha lock all layers' }).click();
  const locked = await hash(page);
  await page.keyboard.press('Escape');
  await stroke(page, 650); // only lands where the layer already has paint: none there
  expect(await hash(page)).toBe(locked);
  await stroke(page, 330); // over the layer's own stroke
  expect(await hash(page)).not.toBe(locked);

  // Both strokes (the one outside the paint is a step too), alpha lock (no visible change), show,
  // hide, opacity, group.
  const undone = [locked, locked, faded, hidden, faded, plain, plain];
  expect(locked).toBe(faded);
  for (const [i, expected] of undone.entries()) {
    await page.evaluate(() => window.__drawthing!.undo());
    await idle(page);
    expect(await hash(page), `undo ${i}`).toBe(expected);
  }
});
