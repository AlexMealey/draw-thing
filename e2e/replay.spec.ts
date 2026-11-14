import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { REGRESSION_SCENES, type Scene, sceneFromRecording } from '../src/lab/scenes';
import { openLab } from './lab';

// Phase 8: stroke-replay visual regression (ROADMAP §7.1). Each scene is drawn through the real
// brush pipeline and compared with its reference image (Playwright's comparator is pixelmatch).
// The synthetic scenes cover every brush feature; recordings of real pen sessions dropped into
// e2e/recordings/ are replayed too.
//
// After an intended rendering change, review the diffs in the report, then refresh the images:
//   ./scripts/e2e replay --update-snapshots

const RECORDINGS = join(import.meta.dirname, 'recordings');

function recordedScenes(): Scene[] {
  let files: string[];
  try {
    files = readdirSync(RECORDINGS).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) =>
    sceneFromRecording(
      `recording-${f.replace(/\.json$/, '')}`,
      JSON.parse(readFileSync(join(RECORDINGS, f), 'utf8')),
    ),
  );
}

for (const scene of [...REGRESSION_SCENES, ...recordedScenes()]) {
  test(`scene ${scene.name} matches its reference image`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 900, height: 700 });
    await openLab(page, scene.doc.w, scene.doc.h);
    await page.evaluate((s) => window.__lab!.playScene(s), scene);
    const png = Buffer.from(await page.evaluate(() => window.__lab!.png()), 'base64');
    // Rendering here is deterministic (the same software GPU every run), so only rounding-level
    // differences are tolerated: about 1/255 per channel, on no more than a handful of pixels.
    expect(png).toMatchSnapshot(`${scene.name}.png`, { threshold: 0.02, maxDiffPixels: 4 });
    expect(errors).toEqual([]);
  });
}

// Gaussian blur over the ink scene's hard edges. Large radii blur a downsampled copy of the
// layer: the result must stay smooth, without the repeated copies that spaced-out taps leave.
for (const radius of [8, 40, 150, 400]) {
  test(`gaussian blur ${radius} px matches its reference image`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const scene = REGRESSION_SCENES.find((s) => s.name === 'ink-pressure')!;
    await page.setViewportSize({ width: 900, height: 700 });
    await openLab(page, scene.doc.w, scene.doc.h);
    await page.evaluate((s) => window.__lab!.playScene(s), scene);
    await page.evaluate((r) => {
      const e = window.__lab!.engine;
      e.beginAdjustment('gaussian');
      e.setAdjustment({ radius: r });
      e.applyAdjustment();
      return e.whenIdle();
    }, radius);
    const png = Buffer.from(await page.evaluate(() => window.__lab!.png()), 'base64');
    expect(png).toMatchSnapshot(`gaussian-${radius}.png`, { threshold: 0.02, maxDiffPixels: 4 });
    expect(errors).toEqual([]);
  });
}
