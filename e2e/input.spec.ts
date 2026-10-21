import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { inkHeight, labHash, openLab, penStroke, type PenSample, settle, toPage } from './lab';

// Phase 8: the automatable part of the §7.2 input checklist, with real pen and touch input sent
// through Chromium's input pipeline (CDP): pressure, tilt, palm rejection, pen-first fingers,
// and stroke recordings that replay pixel-identically.

const W = 800;
const H = 600;

test.use({ hasTouch: true, viewport: { width: 1000, height: 750 } });

const horizontal = (y: number, force: (u: number) => number, tilt = 0): PenSample[] =>
  Array.from({ length: 41 }, (_, i) => ({
    x: 100 + i * 15,
    y,
    force: force(i / 40),
    tiltX: tilt,
  }));

/** Touch input through CDP: `points` are [id, x, y] in doc px, all fingers currently down. */
async function touch(
  page: Page,
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: [number, number, number][],
) {
  const touchPoints = [];
  for (const [id, x, y] of points) {
    const [px, py] = await toPage(page, x, y);
    touchPoints.push({ id, x: px, y: py, radiusX: 4, radiusY: 4, force: 1 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
}

test('pen pressure sets the stroke width, and the first sample has no 0-pressure dot', async ({
  page,
}) => {
  await openLab(page, W, H);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.__lab!.useBrush('ink', { size: 40, smoothing: 0 }));
  await penStroke(
    page,
    cdp,
    horizontal(150, () => 0.1),
  );
  await penStroke(
    page,
    cdp,
    horizontal(300, () => 1),
  );
  await penStroke(
    page,
    cdp,
    horizontal(450, (u) => u),
  );
  const light = await inkHeight(page, 400, 100, 200);
  const heavy = await inkHeight(page, 400, 250, 350);
  expect(light).toBeGreaterThan(0);
  expect(heavy).toBeGreaterThan(light * 2);
  // A ramp from 0: thin at the start, full width at the end.
  const start = await inkHeight(page, 112, 400, 500);
  const end = await inkHeight(page, 680, 400, 500);
  expect(start).toBeLessThan(end / 2);
});

test('tilting the pen widens the pencil', async ({ page }) => {
  await openLab(page, W, H);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.__lab!.useBrush('pencil', { size: 10, color: '#000000' }));
  await penStroke(
    page,
    cdp,
    horizontal(200, () => 0.8, 0),
  );
  await penStroke(
    page,
    cdp,
    horizontal(400, () => 0.8, 60),
  );
  const upright = await inkHeight(page, 400, 150, 250);
  const tilted = await inkHeight(page, 400, 350, 450);
  expect(upright).toBeGreaterThan(0);
  expect(tilted).toBeGreaterThan(upright * 1.5);
});

test('a palm resting on the screen while drawing leaves no mark and moves nothing', async ({
  page,
}) => {
  const stroke = horizontal(300, () => 0.6);
  await openLab(page, W, H);
  const blank = await labHash(page);
  const cdp = await page.context().newCDPSession(page);
  await penStroke(page, cdp, stroke);
  const penOnly = await labHash(page);
  expect(penOnly).not.toBe(blank);

  await openLab(page, W, H);
  const view = await toPage(page, 0, 0);
  const [first, ...rest] = await Promise.all(stroke.map((s) => toPage(page, s.x, s.y)));
  const pen = { pointerType: 'pen' as const, button: 'left' as const, buttons: 1, force: 0.6 };
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    clickCount: 1,
    ...pen,
    x: first![0],
    y: first![1],
  });
  for (const [i, [x, y]] of rest.entries()) {
    if (i === 5) await touch(page, cdp, 'touchStart', [[1, 500, 500]]); // the palm lands
    if (i > 5 && i < 30) await touch(page, cdp, 'touchMove', [[1, 500 + i * 4, 500 - i]]);
    if (i === 30) await touch(page, cdp, 'touchEnd', []);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pen, x, y });
  }
  const [lx, ly] = rest[rest.length - 1]!;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...pen,
    buttons: 0,
    force: 0,
    x: lx,
    y: ly,
  });
  await settle(page);
  expect(await labHash(page)).toBe(penOnly);
  expect(await toPage(page, 0, 0)).toEqual(view);
});

test('fingers paint until a pen is used, then only navigate', async ({ page }) => {
  await openLab(page, W, H);
  const cdp = await page.context().newCDPSession(page);
  const blank = await labHash(page);
  const finger = async (y: number) => {
    await touch(page, cdp, 'touchStart', [[7, 100, y]]);
    for (let i = 1; i <= 10; i++) await touch(page, cdp, 'touchMove', [[7, 100 + i * 50, y]]);
    await touch(page, cdp, 'touchEnd', []);
    await settle(page);
  };
  await finger(150);
  const fingerPainted = await labHash(page);
  expect(fingerPainted).not.toBe(blank);

  await penStroke(
    page,
    cdp,
    horizontal(300, () => 0.5),
  );
  const afterPen = await labHash(page);
  expect(afterPen).not.toBe(fingerPainted);

  await finger(450);
  expect(await labHash(page)).toBe(afterPen);
});

test('a second finger turns a finger stroke into a pinch, without a stray mark', async ({
  page,
}) => {
  await openLab(page, W, H);
  const cdp = await page.context().newCDPSession(page);
  const blank = await labHash(page);
  const view = await toPage(page, W, H);
  await touch(page, cdp, 'touchStart', [[1, 300, 300]]);
  await touch(page, cdp, 'touchMove', [[1, 330, 300]]);
  await touch(page, cdp, 'touchStart', [
    [1, 330, 300],
    [2, 500, 300],
  ]);
  for (let i = 1; i <= 10; i++) {
    await touch(page, cdp, 'touchMove', [
      [1, 330 - i * 10, 300],
      [2, 500 + i * 10, 300],
    ]);
  }
  await touch(page, cdp, 'touchEnd', []);
  await settle(page);
  expect(await labHash(page)).toBe(blank);
  const [x, y] = await toPage(page, W, H);
  expect(Math.hypot(x - view[0], y - view[1])).toBeGreaterThan(50); // zoomed in
});

test('a recorded pen session replays pixel-identically', async ({ page }) => {
  await openLab(page, W, H);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    window.__lab!.useBrush('pencil', { size: 16, smoothing: 0.4 });
    window.__lab!.engine.startRecording('e2e');
  });
  // Changing pressure and tilt, with StreamLine on: the replay must reproduce the timing too.
  const wave = (y: number): PenSample[] =>
    Array.from({ length: 60 }, (_, i) => ({
      x: 80 + i * 11,
      y: y + Math.sin(i / 5) * 60,
      force: 0.2 + 0.8 * Math.abs(Math.sin(i / 9)),
      tiltX: (i % 30) * 2,
      tiltY: 10,
    }));
  await penStroke(page, cdp, wave(200));
  await page.evaluate(() => window.__lab!.useBrush('ink', { size: 12 }));
  await penStroke(page, cdp, wave(420));
  const drawn = await labHash(page);
  const rec = await page.evaluate(() => window.__lab!.engine.stopRecording());
  expect((rec as { strokes: unknown[] }).strokes).toHaveLength(2);

  await openLab(page, W, H);
  await page.evaluate((r) => window.__lab!.engine.replay(r), rec);
  await settle(page);
  expect(await labHash(page)).toBe(drawn);
});
