import { presetById } from '../engine/brush/presets';
import type { Engine } from '../engine/Engine';
import type { RecordedStroke, StrokeRecording } from '../engine/input/recording';
import { gpuBudgetBytes, historyBudgetBytes } from '../engine/layers/budget';
import { perf, type SampleSummary, Samples } from '../engine/perf';
import { engineStats } from '../engine/stats';
import { exportArtwork } from '../files/exportArtwork';
import { encodeImage } from '../files/image';
import { Autosaver } from '../persistence/Autosaver';
import { newProjectId } from '../persistence/document';
import { deleteProject, getLastOpen, setLastOpen } from '../persistence/projects';
import { documentStore } from '../state/documentStore';
import { along, line, penStroke, scribble, tool, toolWith, zigzag } from './synthetic';

/** The §7.1 benchmark suite, run in the lab page (`?lab`) on a scratch document. */

export interface BenchResult {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  /** Human-readable target, e.g. "< 4 ms". */
  target: string;
  /** null: informational, or not measurable in this browser. */
  pass: boolean | null;
  detail?: string;
}

export interface BenchReport {
  startedAt: string;
  durationS: number;
  options: BenchOptions;
  env: Record<string, string | number | boolean>;
  results: BenchResult[];
}

export interface BenchOptions {
  /** Layers in the document while scribbling. */
  layers: number;
  /** Soft brush diameter, doc px. */
  brushSize: number;
  /** Dab spacing, fraction of the diameter. */
  spacing: number;
  /** Strokes of the scribble test (commit timing needs a few). */
  strokes: number;
  /** Total scribbling time. */
  scribbleSeconds: number;
  /** Dabs for the throughput test. */
  dabs: number;
  /** Layer churn cycles of the leak check. */
  churnCycles: number;
  /** Autosaves to time. */
  saves: number;
}

/** ROADMAP §7.1 as written: for real devices. */
export const DEVICE_OPTIONS: BenchOptions = {
  layers: 20,
  brushSize: 400,
  spacing: 0.05,
  strokes: 12,
  scribbleSeconds: 12,
  dabs: 200_000,
  churnCycles: 5,
  saves: 5,
};

/** A quick pass that still exercises every benchmark (CI's software GPU, a first look). */
export const QUICK_OPTIONS: BenchOptions = {
  layers: 6,
  brushSize: 160,
  spacing: 0.1,
  strokes: 6,
  scribbleSeconds: 3,
  dabs: 20_000,
  churnCycles: 2,
  saves: 3,
};

export type Progress = (message: string) => void;

const MB = 1024 * 1024;
const recording = (engine: Engine, strokes: RecordedStroke[]): StrokeRecording => ({
  format: 'drawthing-strokes',
  version: 1,
  doc: { w: engine.docW, h: engine.docH },
  note: 'benchmark',
  strokes,
});

export async function runBenchmarks(
  engine: Engine,
  options: BenchOptions,
  onProgress: Progress = () => {},
): Promise<BenchReport> {
  const started = performance.now();
  const results: BenchResult[] = [];
  const add = (r: BenchResult) => {
    results.push(r);
    onProgress(`${r.label}: ${format(r)}`);
  };
  const lossesBefore = engineStats.contextLosses;
  const heapBefore = heapMB();

  onProgress('Measuring the display refresh rate…');
  const refresh = await measureRefresh();
  const hz = 1000 / refresh;
  const frameBudget = hz > 90 ? 8 : 16;

  add({
    id: 'cold-start',
    label: 'Page start → first frame',
    value: perf.firstFrameMs === null ? null : Math.round(perf.firstFrameMs),
    unit: 'ms',
    target: '< 1500 ms (cached)',
    pass: perf.firstFrameMs === null ? null : perf.firstFrameMs < 1500,
    detail: 'Reload the lab page from the installed app for the cold-start number',
  });

  onProgress(`Adding layers (${options.layers})…`);
  addLayers(options.layers);
  await settle(engine);

  // ── Scribbling with a big soft brush in the middle of the stack ────────────
  onProgress('Scribbling…');
  const soft = toolWith(
    { ...presetById('airbrush'), spacing: options.spacing },
    { size: options.brushSize, color: '#0a84ff' },
  );
  const area = { x: 0, y: 0, w: engine.docW, h: engine.docH };
  const perStroke = options.scribbleSeconds / options.strokes;
  const speed = Math.max(engine.docW, engine.docH) / 1.5; // across the canvas in 1.5 s
  const strokes = Array.from({ length: options.strokes }, (_, i) =>
    penStroke(scribble(area, perStroke, i + 1, speed), soft),
  );
  perf.frame.clear();
  perf.commit.clear();
  const longBefore = perf.longTasks.count;
  const intervals = new Samples(4096);
  const stopIntervals = sampleFrameIntervals(intervals);
  await engine.replay(recording(engine, strokes), 'recorded');
  stopIntervals();
  const longTasks = perf.longTasks.count - longBefore;
  const frame = perf.frame.summary();
  const interval = intervals.summary();
  const dropped = intervals.count ? intervals.countAbove(refresh * 1.5) / intervals.count : 0;
  add({
    id: 'frame-cpu',
    label: `Frame CPU while scribbling, p95 (${options.layers} layers, ${options.brushSize}px soft brush)`,
    value: round(frame.p95),
    unit: 'ms',
    target: `< ${frameBudget} ms (${Math.round(hz)} Hz)`,
    pass: frame.count > 0 ? frame.p95 < frameBudget : null,
    detail: `p50 ${round(frame.p50)} ms, max ${round(frame.max)} ms over ${frame.count} frames`,
  });
  add({
    id: 'frame-interval',
    label: 'Frame interval while scribbling, p95',
    value: round(interval.p95),
    unit: 'ms',
    target: `≤ ${round(refresh * 1.25)} ms (one refresh)`,
    pass: interval.count > 0 ? interval.p95 <= refresh * 1.25 : null,
    detail: `${(dropped * 100).toFixed(1)}% of frames late (over 1.5 refreshes); includes GPU time`,
  });
  add({
    id: 'long-tasks',
    label: 'Long tasks while scribbling',
    value: PerformanceObserver.supportedEntryTypes?.includes('longtask') ? longTasks : null,
    unit: '',
    target: '0',
    pass: PerformanceObserver.supportedEntryTypes?.includes('longtask') ? longTasks === 0 : null,
  });
  const commit = perf.commit.summary();
  add({
    id: 'commit',
    label: 'Stroke commit (merge + capture start), p95',
    value: round(commit.p95),
    unit: 'ms',
    target: '< 4 ms',
    pass: commit.count > 0 ? commit.p95 < 4 : null,
    detail: `${commit.count} strokes, max ${round(commit.max)} ms`,
  });
  add({
    id: 'latency',
    label: 'Input → GPU submit (engine EMA)',
    value: round(engineStats.latencyMs),
    unit: 'ms',
    target: 'iPad ≤ 30, Surface ≤ 40 ms incl. display',
    pass: null,
    detail: 'Input-to-photon needs a slow-motion camera; this is the software part only',
  });

  // ── Dab throughput ─────────────────────────────────────────────────────────
  onProgress('Dab throughput…');
  const small = tool('ink', { size: 20, smoothing: 0 });
  const dabSpacing = Math.max(0.5, 20 * small.preset.spacing);
  const path = zigzag(area, 24);
  const throughput = penStroke(resample(path, options.dabs * dabSpacing), small);
  const dabsBefore = engineStats.dabsTotal;
  engine.gpuSync();
  let t = performance.now();
  await engine.replay(recording(engine, [throughput]), 'instant');
  engine.gpuSync();
  const dabSeconds = (performance.now() - t) / 1000;
  const dabs = engineStats.dabsTotal - dabsBefore;
  add({
    id: 'dab-throughput',
    label: 'Dab throughput (20 px ink, one batch)',
    value: Math.round(dabs / dabSeconds),
    unit: 'dabs/s',
    target: '≥ 50000 dabs/s',
    pass: dabs / dabSeconds >= 50_000,
    detail: `${dabs} dabs in ${round(dabSeconds * 1000)} ms`,
  });
  await settle(engine);

  // ── Undo/redo of a full-canvas stroke ──────────────────────────────────────
  onProgress('Undo/redo of a full-canvas stroke…');
  const fill = tool('airbrush', { size: Math.max(engine.docW, engine.docH) / 6 });
  await engine.replay(recording(engine, [penStroke(zigzag(area, fill.size), fill)]), 'instant');
  await settle(engine);
  const undo = new Samples();
  const redo = new Samples();
  for (let i = 0; i < 5; i++) {
    t = performance.now();
    engine.undo();
    await engine.whenIdle();
    engine.gpuSync();
    undo.push(performance.now() - t);
    t = performance.now();
    engine.redo();
    await engine.whenIdle();
    engine.gpuSync();
    redo.push(performance.now() - t);
  }
  const worst = Math.max(undo.summary().max, redo.summary().max);
  add({
    id: 'undo',
    label: 'Undo / redo, full-canvas stroke (worst of 5 each)',
    value: round(worst),
    unit: 'ms',
    target: '< 50 ms',
    pass: worst < 50,
    detail: `undo p50 ${round(undo.percentile(50))} ms, redo p50 ${round(redo.percentile(50))} ms`,
  });

  // ── Autosave ───────────────────────────────────────────────────────────────
  onProgress('Autosave…');
  const save = await benchAutosave(engine, options.saves);
  add({
    id: 'autosave',
    label: 'Autosave after a stroke, p95',
    value: save ? round(save.total.p95) : null,
    unit: 'ms',
    target: '< 150 ms',
    pass: save ? save.total.p95 < 150 : null,
    detail: save
      ? `main thread p95 ${round(save.sync.p95)} ms (${save.sync.p95 < frameBudget ? 'fits in a frame' : 'may drop frames'}); ` +
        `saving on hide (with thumbnail) ${round(save.flushSync)} ms main thread`
      : 'IndexedDB unavailable',
  });

  // ── Exports ────────────────────────────────────────────────────────────────
  onProgress('Exporting PNG…');
  t = performance.now();
  const png = await encodeImage(engine.exportImage(false), 'image/png');
  const pngMs = performance.now() - t;
  add({
    id: 'export-png',
    label: `Export PNG (${engine.docW}×${engine.docH})`,
    value: Math.round(pngMs),
    unit: 'ms',
    target: '< 3000 ms',
    pass: pngMs < 3000,
    detail: `${(png.size / MB).toFixed(1)} MB`,
  });
  onProgress('Exporting PSD…');
  t = performance.now();
  const psd = await exportArtwork(engine, { id: 'bench', name: 'Benchmark' }, 'psd', {
    flush: () => Promise.resolve(),
  });
  const psdMs = performance.now() - t;
  add({
    id: 'export-psd',
    label: `Export PSD (${documentStore.getState().layers.length} layers)`,
    value: Math.round(psdMs),
    unit: 'ms',
    target: '< 10000 ms',
    pass: psdMs < 10_000,
    detail: `${(psd.blob.size / MB).toFixed(1)} MB`,
  });

  // ── Memory ─────────────────────────────────────────────────────────────────
  const gpuBudget = gpuBudgetBytes() / MB;
  add({
    id: 'gpu-memory',
    label: `GPU memory estimate (${engineStats.layers} layers)`,
    value: engineStats.gpuMB,
    unit: 'MB',
    target: `≤ ${gpuBudget} MB budget`,
    pass: engineStats.gpuMB <= gpuBudget,
    detail: 'Compare with Safari Web Inspector / Chrome Task Manager on the device',
  });
  const historyBudget = historyBudgetBytes() / MB;
  add({
    id: 'history-memory',
    label: `Undo history (${engineStats.historySteps} steps)`,
    value: round(engineStats.historyMB),
    unit: 'MB',
    target: `≤ ${historyBudget} MB budget`,
    pass: engineStats.historyMB <= historyBudget,
  });

  // ── Leaks: layer churn must return to the same GL object count ─────────────
  onProgress('Checking for leaked GL objects…');
  await churn(engine); // warms up lazily created resources
  const before = engine.glObjects();
  for (let i = 0; i < options.churnCycles; i++) await churn(engine);
  const after = engine.glObjects();
  const leaked = Object.entries(after)
    .map(([k, v]) => [k, v - before[k as keyof typeof before]] as const)
    .filter(([, d]) => d !== 0);
  add({
    id: 'gl-leaks',
    label: `GL objects after ${options.churnCycles} layer churn cycles`,
    value: leaked.reduce((sum, [, d]) => sum + d, 0),
    unit: 'leaked',
    target: '0',
    pass: leaked.length === 0,
    detail: leaked.length
      ? leaked.map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`).join(', ')
      : `${Object.values(after).reduce((a, b) => a + b, 0)} live objects`,
  });

  const losses = engineStats.contextLosses - lossesBefore;
  add({
    id: 'context-loss',
    label: 'Context losses during the run',
    value: losses,
    unit: '',
    target: '0',
    pass: losses === 0,
  });

  const heapAfter = heapMB();
  return {
    startedAt: new Date(Date.now() - (performance.now() - started)).toISOString(),
    durationS: Math.round((performance.now() - started) / 100) / 10,
    options,
    env: {
      ...environment(engine),
      refreshHz: Math.round(hz),
      ...(heapBefore !== null && heapAfter !== null
        ? { heapMBBefore: heapBefore, heapMBAfter: heapAfter }
        : {}),
    },
    results,
  };
}

export interface SoakSample {
  minute: number;
  glObjects: number;
  historyMB: number;
  heapMB: number | null;
  gpuMB: number;
}

/**
 * 30-minute soak (ROADMAP §7.1): continuous drawing, undo and layer churn. Memory must stay flat:
 * the same GL object count at every checkpoint, history within budget.
 */
export async function runSoak(
  engine: Engine,
  minutes: number,
  onSample: (s: SoakSample) => void,
  signal?: AbortSignal,
): Promise<BenchResult[]> {
  const start = performance.now();
  const samples: SoakSample[] = [];
  const brush = tool('pencil', { size: 24 });
  const area = { x: 0, y: 0, w: engine.docW, h: engine.docH };
  let next = 0;
  let seed = 100;
  await churn(engine);
  while (!signal?.aborted && performance.now() - start < minutes * 60_000) {
    const strokes = [0, 1, 2].map(() => penStroke(scribble(area, 1, seed++, 1200), brush));
    await engine.replay(recording(engine, strokes), 'recorded');
    engine.undo();
    engine.undo();
    engine.redo();
    await engine.whenIdle();
    await churn(engine);
    const minute = (performance.now() - start) / 60_000;
    if (minute >= next) {
      const s: SoakSample = {
        minute: Math.round(minute * 10) / 10,
        glObjects: Object.values(engine.glObjects()).reduce((a, b) => a + b, 0),
        historyMB: round(engineStats.historyMB),
        heapMB: heapMB(),
        gpuMB: engineStats.gpuMB,
      };
      samples.push(s);
      onSample(s);
      next = Math.floor(minute) + 1;
    }
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return [];
  const historyBudget = historyBudgetBytes() / MB;
  const maxHistory = Math.max(...samples.map((s) => s.historyMB));
  return [
    {
      id: 'soak-gl',
      label: `GL objects over ${last.minute} min`,
      value: last.glObjects - first.glObjects,
      unit: 'leaked',
      target: '0',
      pass: samples.every((s) => s.glObjects === first.glObjects),
      detail: `${first.glObjects} → ${last.glObjects}`,
    },
    {
      id: 'soak-history',
      label: 'Undo history, highest',
      value: maxHistory,
      unit: 'MB',
      target: `≤ ${historyBudget} MB`,
      pass: maxHistory <= historyBudget,
    },
    {
      id: 'soak-heap',
      label: 'JS heap growth',
      value: first.heapMB !== null && last.heapMB !== null ? last.heapMB - first.heapMB : null,
      unit: 'MB',
      target: 'flat once history is full',
      pass: null,
      detail: samples.map((s) => s.heapMB ?? '–').join(' → '),
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function addLayers(total: number) {
  const doc = documentStore.getState();
  while (documentStore.getState().layers.length < total) {
    if (doc.addLayer() === null) break; // layer budget
  }
  // Paint in the middle of the stack, so both the below and the above caches are in use.
  const layers = documentStore.getState().layers;
  const middle = layers[Math.floor(layers.length / 2)];
  if (middle) doc.selectLayer(middle.id);
}

/** One cycle of layer operations that leaves the document structure as it found it. */
async function churn(engine: Engine) {
  const doc = documentStore.getState();
  const active = doc.activeLayerId;
  if (doc.addLayer() !== null) {
    const brush = tool('ink', { size: 30 });
    await engine.replay(
      recording(engine, [
        penStroke(along(40, line(40, 40, engine.docW - 40, engine.docH - 40)), brush),
      ]),
      'instant',
    );
    // Undo and redo are queued, the others immediate: wait before each next step.
    engine.duplicateLayer();
    engine.mergeDown();
    engine.undo();
    await engine.whenIdle();
    engine.redo();
    await engine.whenIdle();
    engine.flatten();
    engine.undo();
    await engine.whenIdle();
    const added = documentStore.getState().activeLayerId;
    if (added !== active) documentStore.getState().removeLayer(added);
    documentStore.getState().selectLayer(active);
  }
  await settle(engine);
}

/** Lets stroke readbacks finish and hands their tiles off (the lab has no autosaver). */
async function settle(engine: Engine) {
  await engine.whenIdle();
  engine.takeChanges();
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

async function benchAutosave(
  engine: Engine,
  saves: number,
): Promise<{
  sync: SampleSummary;
  total: SampleSummary;
  /** Saving when the app is hidden: the same work plus a fresh gallery thumbnail. */
  flushSync: number;
} | null> {
  if (typeof indexedDB === 'undefined') return null;
  const previous = await getLastOpen().catch(() => null);
  const id = newProjectId();
  engine.takeChanges(); // only what the strokes below change
  const saver = new Autosaver(engine, id, { storedLayers: [], name: 'Benchmark (temporary)' });
  perf.saveSync.clear();
  perf.saveTotal.clear();
  try {
    await saver.flush(); // the first save writes the document record
    perf.saveSync.clear();
    perf.saveTotal.clear();
    const brush = tool('ink', { size: 24 });
    for (let i = 0; i < saves; i++) {
      const y = ((i + 1) * engine.docH) / (saves + 1);
      await engine.replay(
        recording(engine, [penStroke(along(120, line(40, y, engine.docW - 40, y)), brush)]),
        'instant',
      );
      // The app's path: the engine reports a change, the save follows after a short pause.
      const done = perf.saveTotal.count + 1;
      saver.changed();
      const deadline = performance.now() + 10_000;
      while (perf.saveTotal.count < done && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    const result = { sync: perf.saveSync.summary(), total: perf.saveTotal.summary() };
    perf.saveSync.clear();
    saver.changed();
    await saver.flush();
    return { ...result, flushSync: perf.saveSync.percentile(100) };
  } catch (err) {
    console.error('Autosave benchmark failed', err);
    return null;
  } finally {
    await saver.discard();
    await deleteProject(id).catch(() => {});
    if (previous) await setLastOpen(previous).catch(() => {});
  }
}

/** Median frame interval with nothing else going on. */
async function measureRefresh(): Promise<number> {
  const s = new Samples(64);
  const stop = sampleFrameIntervals(s);
  await new Promise((resolve) => setTimeout(resolve, 600));
  stop();
  return s.percentile(50) || 1000 / 60;
}

function sampleFrameIntervals(into: Samples): () => void {
  let last = -1;
  let raf = requestAnimationFrame(function tick(now) {
    if (last >= 0) into.push(now - last);
    last = now;
    raf = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(raf);
}

/** Points spaced evenly along a polyline, `length` px in total (repeating it if shorter). */
function resample(path: { x: number; y: number }[], length: number) {
  const out: { x: number; y: number; p: number }[] = [];
  const step = 4;
  let travelled = 0;
  for (let i = 0; travelled < length && path.length > 1; i = (i + 1) % (path.length - 1)) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) break;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s < d && travelled < length; s += step, travelled += step) {
      out.push({ x: a.x + ((b.x - a.x) * s) / d, y: a.y + ((b.y - a.y) * s) / d, p: 1 });
    }
  }
  return out;
}

function heapMB(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / MB) : null;
}

function environment(engine: Engine): Record<string, string | number | boolean> {
  let renderer = 'unknown';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // keep 'unknown'
  }
  return {
    userAgent: navigator.userAgent,
    renderer,
    doc: `${engine.docW}×${engine.docH}`,
    dpr: devicePixelRatio,
    deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 'n/a',
    desynchronized: engineStats.desynchronized,
    strokeFormat: engineStats.strokeFormat,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

function format(r: BenchResult): string {
  const value = r.value === null ? 'n/a' : `${r.value}${r.unit ? ` ${r.unit}` : ''}`;
  const verdict = r.pass === null ? '' : r.pass ? ' ✓' : ' ✗';
  return `${value} (target ${r.target})${verdict}`;
}
