/**
 * Timing samples for the benchmarks (ROADMAP §7.1) and the debug HUD. Each metric keeps its most
 * recent samples in a fixed ring, so recording is allocation-free and cheap enough to stay on.
 */
export class Samples {
  private ring: Float64Array;
  private next = 0;
  private filled = 0;

  constructor(capacity = 1024) {
    this.ring = new Float64Array(capacity);
  }

  push(value: number) {
    this.ring[this.next] = value;
    this.next = (this.next + 1) % this.ring.length;
    this.filled = Math.min(this.filled + 1, this.ring.length);
  }

  get count(): number {
    return this.filled;
  }

  clear() {
    this.next = 0;
    this.filled = 0;
  }

  /** Nearest-rank percentile (0..100) of the kept samples; 0 when there are none. */
  percentile(p: number): number {
    if (this.filled === 0) return 0;
    const sorted = this.ring.slice(0, this.filled).sort();
    const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
    return sorted[Math.max(0, rank - 1)] ?? 0;
  }

  /** How many kept samples exceed `limit`. */
  countAbove(limit: number): number {
    let n = 0;
    for (let i = 0; i < this.filled; i++) if ((this.ring[i] ?? 0) > limit) n++;
    return n;
  }

  summary(): SampleSummary {
    let max = 0;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) {
      const v = this.ring[i] ?? 0;
      max = Math.max(max, v);
      sum += v;
    }
    return {
      count: this.filled,
      mean: this.filled ? sum / this.filled : 0,
      p50: this.percentile(50),
      p95: this.percentile(95),
      max,
    };
  }
}

export interface SampleSummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

/** Main-thread timings, ms. */
export const perf = {
  /** CPU time of each engine frame that did work. */
  frame: new Samples(),
  /** Pen-up: stroke merged into its layer plus the start of its tile capture. */
  commit: new Samples(),
  /** One undo or redo step, from its turn in the queue until it's applied. */
  history: new Samples(),
  /** Autosave: the synchronous part (taking changes, thumbnail) that can drop frames. */
  saveSync: new Samples(),
  /** Autosave: start to written, including compression and IndexedDB. */
  saveTotal: new Samples(),
  /** Tasks over 50 ms seen by PerformanceObserver (Chromium only). */
  longTasks: new Samples(256),
  /** Page start → first frame the engine presented. */
  firstFrameMs: null as number | null,
};

let observing = false;

/** Counts long tasks from now on, where the browser reports them. Safe to call repeatedly. */
export function observeLongTasks() {
  if (observing || typeof PerformanceObserver === 'undefined') return;
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
  observing = true;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) perf.longTasks.push(entry.duration);
  }).observe({ type: 'longtask' });
}
