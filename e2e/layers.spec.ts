import { expect, type Page, test } from '@playwright/test';
import { hash, mouseUp } from './hooks';

// Several layers can be selected and grouped or flattened together; the canvas angle shows while
// it's turned and one tap turns it back.

async function stroke(page: Page, y: number) {
  await page.mouse.move(200, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 60, y + Math.sin(i) * 20);
  await mouseUp(page);
}

const idle = (page: Page) => page.evaluate(() => window.__drawthing!.whenIdle());
const undo = async (page: Page) => {
  await page.evaluate(() => window.__drawthing!.undo());
  await idle(page);
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/?debug=1');
  await page.waitForFunction(() => window.__drawthing !== undefined);
});

test('selected layers group and flatten together, and undo', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const panel = page.getByRole('dialog', { name: /^Layers/ });
  const showLayers = async () => {
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Layers', exact: true }).click();
    }
  };
  const button = async (name: string) => {
    await showLayers();
    await panel.getByRole('button', { name, exact: true }).click();
  };
  const tick = (name: string) => panel.getByRole('checkbox', { name: `Select ${name}` });
  const eye = (name: string) => panel.getByRole('checkbox', { name });

  // Three layers with strokes that don't overlap, so their order doesn't change the picture.
  await stroke(page, 260);
  await button('Add layer');
  await page.keyboard.press('Escape');
  await stroke(page, 400);
  await button('Add layer');
  await page.keyboard.press('Escape');
  await stroke(page, 540);
  const plain = await hash(page);

  await showLayers();
  await eye('Hide Layer 1').click();
  await eye('Hide Layer 3').click();
  const onlySecond = await hash(page);
  await eye('Show Layer 1').click();
  await eye('Show Layer 3').click();
  expect(await hash(page)).toBe(plain);

  // Select starts with the active layer; pick the bottom one too and group them.
  await button('Select');
  await expect(tick('Layer 3')).toBeChecked();
  await tick('Layer 1').check();
  await expect(panel.getByRole('status')).toHaveText('2 layers selected');
  await button('Group');
  await expect(eye('Hide Group 1')).toBeVisible();
  await expect(panel.getByRole('slider', { name: /^Group opacity/ })).toBeVisible();
  expect(await hash(page)).toBe(plain);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute(
    'title',
    'Undo Group layers',
  );
  await undo(page);
  await expect(eye('Hide Group 1')).toHaveCount(0);
  expect(await hash(page)).toBe(plain);

  // Shift-click selects too; flattening merges into the topmost layer's place.
  await panel.getByRole('button', { name: 'Select Layer 1' }).click({ modifiers: ['Shift'] });
  await expect(panel.getByRole('status')).toHaveText('2 layers selected');
  await button('Flatten');
  await expect(page.getByRole('dialog', { name: /^Layers 2\// })).toBeVisible();
  expect(await hash(page)).toBe(plain);
  await eye('Hide Layer 3').click(); // the merged layer holds both strokes
  expect(await hash(page)).toBe(onlySecond);

  await undo(page); // visibility
  await undo(page); // flatten
  await expect(page.getByRole('dialog', { name: /^Layers 3\// })).toBeVisible();
  expect(await hash(page)).toBe(plain);
  await eye('Hide Layer 1').click();
  expect(await hash(page)).not.toBe(plain); // its pixels are back on their own layer
  expect(errors).toEqual([]);
});

test('the rotation pill shows the angle and turns the canvas back', async ({ page }) => {
  const pill = page.getByRole('button', { name: /^Reset rotation/ });
  await expect(pill).toHaveCount(0);
  await page.evaluate(() => window.__drawthing!.rotateView(30));
  await expect(pill).toHaveText('30°');
  await pill.click();
  await expect(pill).toHaveCount(0);
});
