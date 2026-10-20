import { expect, test } from '@playwright/test';

test('serves an installable web app manifest', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();

  const res = await request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    display: string;
    start_url: string;
    icons: { sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/?source=pwa', scope: '/' });
  expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  expect(await page.locator('link[rel="apple-touch-startup-image"]').count()).toBeGreaterThan(0);
});

test('canvas area opts out of browser touch gestures', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Canvas' })).toHaveCSS('touch-action', 'none');
});

test('loads offline once the service worker is installed', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('Ready to work offline.')).toBeVisible();

  // registerType 'prompt' doesn't claim clients, so the first page load isn't controlled yet.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Drawing canvas')).toBeVisible();
});
