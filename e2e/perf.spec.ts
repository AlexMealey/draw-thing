import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openLab } from './lab';

// Phase 8: the §7.1 benchmark suite, quick settings, in CI's headless Chromium. Its software GPU
// says nothing about tablet performance, so timings are reported, not enforced (set
// BENCH_STRICT=1 to enforce them on real hardware). What must hold everywhere: every benchmark
// runs, nothing leaks, the context survives and memory stays within budget.
//
// On a device, open /?lab and press "Run benchmarks" instead (docs/QA.md).

const STRICT = process.env.BENCH_STRICT === '1';
const ALWAYS = ['gl-leaks', 'context-loss', 'gpu-memory', 'history-memory'];

test('the benchmark suite runs, without leaks or context loss', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1200, height: 800 });
  await openLab(page, 1024, 768);

  const report = await page.evaluate(() => window.__lab!.runBenchmarks());
  const json = JSON.stringify(report, null, 2);
  await testInfo.attach('benchmarks.json', { body: json, contentType: 'application/json' });
  writeFileSync(testInfo.outputPath('benchmarks.json'), json);
  const table = report.results
    .map((r) => {
      const mark = r.pass === null ? '·' : r.pass ? '✓' : '✗';
      return `${mark} ${r.label}: ${r.value ?? 'n/a'} ${r.unit} (target ${r.target})`;
    })
    .join('\n');
  console.log(`\n${String(report.env.renderer)}\n${table}`);

  const ids = report.results.map((r) => r.id);
  for (const id of [
    'cold-start',
    'frame-cpu',
    'frame-interval',
    'commit',
    'dab-throughput',
    'undo',
    'autosave',
    'export-png',
    'export-psd',
    ...ALWAYS,
  ]) {
    expect(ids, `benchmark ${id} ran`).toContain(id);
  }
  for (const r of report.results) {
    if (ALWAYS.includes(r.id) || STRICT) {
      expect.soft(r.pass, `${r.label}: ${r.value} ${r.unit} ${r.detail ?? ''}`).not.toBe(false);
    }
  }
  // The scratch project used to time autosaves is gone again.
  expect(errors).toEqual([]);
});
