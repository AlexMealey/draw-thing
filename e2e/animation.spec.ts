import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { frameHash, frameIds, hash, mouseUp } from './hooks';

// Stop-frame animation: frames are drawn like any artwork, cloned or started blank, reordered,
// undone across frames, saved, and exported as GIF/MP4.

async function ready(page: Page) {
  await page.waitForFunction(() => window.__drawthing !== undefined);
  await expect(page.getByText('Opening…')).toHaveCount(0);
}

async function stroke(page: Page, y: number, x = 200) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 50, y + Math.sin(i) * 30);
  await mouseUp(page);
}

const idle = (page: Page) => page.evaluate(() => window.__drawthing!.whenIdle());

async function enableAnimation(page: Page) {
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('checkbox', { name: /^Animation/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('contentinfo', { name: 'Timeline' })).toBeVisible();
}

const timeline = (page: Page) => page.getByRole('contentinfo', { name: 'Timeline' });
const frameButton = (page: Page, n: number) =>
  timeline(page).getByRole('button', { name: new RegExp(`^Frame ${n}(,|$)`) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/?debug=1');
  await ready(page);
});

test('clone keeps the drawing, a new frame is blank, frames keep their pixels', async ({
  page,
}) => {
  const blank = await hash(page);
  await enableAnimation(page);
  await stroke(page, 250);
  const first = await hash(page);
  expect(first).not.toBe(blank);

  await timeline(page).getByRole('button', { name: 'Clone frame' }).click();
  expect(await frameIds(page)).toHaveLength(2);
  expect(await hash(page)).toBe(first);
  await expect(frameButton(page, 2)).toHaveAttribute('aria-current', 'true');

  await stroke(page, 400);
  const second = await hash(page);
  expect(second).not.toBe(first);

  await timeline(page).getByRole('button', { name: 'New frame' }).click();
  expect(await frameIds(page)).toHaveLength(3);
  expect(await hash(page)).toBe(blank);

  // Switching shows each frame's own pixels, by tap and by keyboard.
  await frameButton(page, 1).click();
  expect(await hash(page)).toBe(first);
  await page.keyboard.press('.');
  expect(await hash(page)).toBe(second);
  await page.keyboard.press('.');
  expect(await hash(page)).toBe(blank);
  await page.keyboard.press('.'); // wraps around
  expect(await hash(page)).toBe(first);

  // Frame hashes of parked frames match what they showed.
  const [a, b, c] = await frameIds(page);
  const fa = await frameHash(page, a!);
  await frameButton(page, 2).click();
  const fb = await frameHash(page, b!);
  await frameButton(page, 1).click();
  expect(await frameHash(page, a!)).toBe(fa);
  expect(await frameHash(page, b!)).toBe(fb);
  expect(await frameHash(page, c!)).not.toBe(fb);
});

test('undo reaches back into other frames, and deleted frames come back', async ({ page }) => {
  await enableAnimation(page);
  await stroke(page, 250);
  const first = await hash(page);
  await timeline(page).getByRole('button', { name: 'Clone frame' }).click();
  await stroke(page, 420);
  const second = await hash(page);

  // From frame 1, undo goes to frame 2 and takes its stroke away.
  await frameButton(page, 1).click();
  await page.evaluate(() => window.__drawthing!.undo());
  await idle(page);
  await expect(frameButton(page, 2)).toHaveAttribute('aria-current', 'true');
  expect(await hash(page)).toBe(first);
  await page.evaluate(() => window.__drawthing!.redo());
  await idle(page);
  expect(await hash(page)).toBe(second);

  // Delete frame 2 from its menu (tap the active frame again), then undo.
  await frameButton(page, 2).click();
  const menu = page.getByRole('dialog', { name: 'Frame 2 of 2' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Delete' }).click();
  expect(await frameIds(page)).toHaveLength(1);
  expect(await hash(page)).toBe(first);
  await page.evaluate(() => window.__drawthing!.undo());
  await idle(page);
  expect(await frameIds(page)).toHaveLength(2);
  await expect(frameButton(page, 2)).toHaveAttribute('aria-current', 'true');
  expect(await hash(page)).toBe(second);
});

test('frames, holds and frame rate survive a reload; reorder by menu', async ({ page }) => {
  await enableAnimation(page);
  await stroke(page, 250);
  await timeline(page).getByRole('button', { name: 'Clone frame' }).click();
  await stroke(page, 420);
  await timeline(page).getByRole('button', { name: 'New frame' }).click();
  await stroke(page, 330, 400);

  // Frame 3: hold 3, move it first.
  await frameButton(page, 3).click();
  const menu = page.getByRole('dialog', { name: 'Frame 3 of 3' });
  await menu.getByRole('slider', { name: 'Hold' }).fill('3');
  await menu.getByRole('button', { name: 'Move earlier' }).click();
  await page
    .getByRole('dialog', { name: 'Frame 2 of 3' })
    .getByRole('button', { name: 'Move earlier' })
    .click();
  await page.keyboard.press('Escape');
  await expect(frameButton(page, 1)).toHaveAccessibleName('Frame 1, held 3');

  await timeline(page).getByRole('button', { name: 'Animation settings' }).click();
  await page
    .getByRole('dialog', { name: 'Animation' })
    .getByRole('slider', { name: 'Frame rate' })
    .fill('8');
  await page.keyboard.press('Escape');

  const ids = await frameIds(page);
  const hashes = [];
  for (const id of ids) hashes.push(await frameHash(page, id));
  await page.evaluate(() => window.__drawthingSaver!.flush());

  await page.reload();
  await ready(page);
  await expect(timeline(page)).toBeVisible();
  expect(await frameIds(page)).toEqual(ids);
  for (const [i, id] of ids.entries()) expect(await frameHash(page, id)).toBe(hashes[i]);
  await expect(frameButton(page, 1)).toHaveAccessibleName('Frame 1, held 3');
  await timeline(page).getByRole('button', { name: 'Animation settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Animation' }).getByText('8 fps')).toBeVisible();
});

test('onion skin shows on screen only, and playback starts and stops', async ({ page }) => {
  await enableAnimation(page);
  await stroke(page, 250);
  await timeline(page).getByRole('button', { name: 'New frame' }).click();
  await stroke(page, 420);
  const plain = await hash(page);
  const screen = () =>
    page
      .locator('canvas')
      .screenshot()
      .then((b) => b.toString('base64'));
  const before = await screen();

  await timeline(page).getByRole('button', { name: 'Onion skin' }).click();
  await expect(timeline(page).getByRole('button', { name: 'Onion skin' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(screen).not.toBe(before); // frame 1 shows through
  expect(await hash(page)).toBe(plain); // ...but not in the artwork

  await timeline(page).getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => window.__drawthing!.playing)).toBe(true);
  await timeline(page).getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => page.evaluate(() => window.__drawthing!.playing)).toBe(false);
  expect(await hash(page)).toBe(plain);
});

/** Width, height, frame delays (cs) and loop count of a GIF, walking its blocks. */
function parseGif(b: Buffer) {
  expect(b.subarray(0, 6).toString()).toBe('GIF89a');
  const w = b.readUInt16LE(6);
  const h = b.readUInt16LE(8);
  let p = 13;
  if (b[10]! & 0x80) p += 3 * 2 ** ((b[10]! & 7) + 1); // global color table
  const delays: number[] = [];
  let loops: number | null = null;
  let frames = 0;
  const skipSubBlocks = () => {
    while (b[p]! !== 0) p += b[p]! + 1;
    p++;
  };
  while (p < b.length) {
    const kind = b[p]!;
    if (kind === 0x3b) break; // trailer
    if (kind === 0x21) {
      const label = b[p + 1]!;
      if (label === 0xf9) delays.push(b.readUInt16LE(p + 4));
      if (label === 0xff && b.subarray(p + 3, p + 14).toString() === 'NETSCAPE2.0') {
        loops = b.readUInt16LE(p + 16);
      }
      p += 2;
      skipSubBlocks();
    } else if (kind === 0x2c) {
      frames++;
      const packed = b[p + 9]!;
      p += 10;
      if (packed & 0x80) p += 3 * 2 ** ((packed & 7) + 1); // local color table
      p++; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`Unexpected GIF block 0x${kind.toString(16)} at ${p}`);
    }
  }
  return { w, h, delays, frames, loops };
}

async function exportFile(page: Page, button: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const d = await download;
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

test('exports an animated GIF with the frames, holds, size and frame rate', async ({ page }) => {
  test.setTimeout(60_000);
  await enableAnimation(page);
  await stroke(page, 250);
  await timeline(page).getByRole('button', { name: 'Clone frame' }).click();
  await stroke(page, 420);
  await frameButton(page, 2).click();
  await page
    .getByRole('dialog', { name: 'Frame 2 of 2' })
    .getByRole('slider', { name: 'Hold' })
    .fill('2');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await share.getByRole('combobox', { name: 'Size' }).selectOption('0.5');
  await share.getByRole('slider', { name: 'Frame rate' }).fill('10');
  const { docW, docH } = await page.evaluate(() => ({
    docW: window.__drawthing!.docW,
    docH: window.__drawthing!.docH,
  }));
  const gif = await exportFile(page, 'Export GIF');
  expect(gif.name).toBe('Untitled Artwork.gif');
  const info = parseGif(gif.bytes);
  expect([info.w, info.h]).toEqual([Math.round(docW / 2), Math.round(docH / 2)]);
  expect(info.frames).toBe(2);
  expect(info.delays).toEqual([10, 20]); // 1 and 2 ticks at 10 fps, in centiseconds
  expect(info.loops).toBe(0); // forever
});

test('exports an MP4 video', async ({ page }) => {
  test.setTimeout(60_000);
  const h264 = await page.evaluate(async () => {
    if (typeof VideoEncoder === 'undefined') return false;
    const r = await VideoEncoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: 640,
      height: 480,
    });
    return r.supported === true;
  });
  test.skip(!h264, 'This browser build has no H.264 encoder');
  await enableAnimation(page);
  await stroke(page, 250);
  await timeline(page).getByRole('button', { name: 'Clone frame' }).click();
  await stroke(page, 420);

  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share' });
  await share.getByRole('radio', { name: 'MP4 video' }).check();
  await share.getByRole('combobox', { name: 'Size' }).selectOption('custom');
  await share.getByRole('spinbutton', { name: 'Width' }).fill('320');
  const mp4 = await exportFile(page, 'Export MP4');
  expect(mp4.name).toBe('Untitled Artwork.mp4');
  expect(mp4.bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(mp4.bytes.includes(Buffer.from('moov'))).toBe(true);
  expect(mp4.bytes.includes(Buffer.from('avc1'))).toBe(true);
  // Two frames, one tick each at the default 12 fps.
  const mvhd = mp4.bytes.indexOf(Buffer.from('mvhd'));
  const v1 = mp4.bytes[mvhd + 4] === 1;
  const timescale = mp4.bytes.readUInt32BE(mvhd + (v1 ? 24 : 16));
  const duration = v1
    ? Number(mp4.bytes.readBigUInt64BE(mvhd + 28))
    : mp4.bytes.readUInt32BE(mvhd + 20);
  expect(duration / timescale).toBeCloseTo(2 / 12, 2);
});
