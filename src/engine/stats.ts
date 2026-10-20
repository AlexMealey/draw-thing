/**
 * Engine counters, written each frame and polled by the debug HUD at 2 Hz.
 * A plain mutable object on purpose: nothing reactive in the hot path.
 */
export const engineStats = {
  running: false,
  /** EMA of newest input sample → GPU submit, ms. Display adds ~1 refresh on top. */
  latencyMs: 0,
  dabsPerFrame: 0,
  /** EMA of CPU time spent in the frame callback, ms. */
  frameCpuMs: 0,
  /** 100% = one document pixel per device pixel. */
  zoomPercent: 100,
  rotationDeg: 0,
  docSize: '',
  desynchronized: false,
  /** Stroke buffer format: rgba16f avoids banding in low-flow buildup. */
  strokeFormat: '',
  layers: 0,
  maxLayers: 0,
  /** Estimated GPU memory for layers, caches and the stroke buffer. */
  gpuMB: 0,
  historySteps: 0,
  historyMB: 0,
};

export const ema = (prev: number, next: number, k = 0.2) =>
  prev === 0 ? next : prev + (next - prev) * k;
