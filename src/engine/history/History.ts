import type { Background, LayerMeta } from '../../state/documentStore';

/** Premultiplied RGBA8 tile bytes, the same deflated, or null for a fully transparent tile. */
export type TileData = Uint8Array | Blob | null;

export interface TileChange {
  before: TileData;
  after: TileData;
}

/** Changed tiles of one layer, by tile key. */
export type LayerTiles = Map<number, TileChange>;

export interface DocSnapshot {
  layers: readonly LayerMeta[];
  activeLayerId: string;
  background: Background;
}

/**
 * One undo step (ROADMAP §1.4): optionally the layer-stack metadata before and after, plus the
 * changed tiles of any layers. Layers that appear or disappear carry their pixels here, so a
 * deleted layer comes back intact.
 */
export interface HistoryEntry {
  label: string;
  doc?: { before: DocSnapshot; after: DocSnapshot };
  pixels: Map<string, LayerTiles>;
  /** Present while the tiles are still being read back from the GPU; call to finish now. */
  pending?: () => void;
  /** Consecutive entries with the same key (e.g. one slider drag) merge into one. */
  coalesceKey?: string;
  time: number;
  bytes: number;
}

export interface HistoryLimits {
  maxBytes: number;
  maxEntries: number;
}

const COALESCE_MS = 1500;

export function tileBytes(t: TileData): number {
  if (t === null) return 0;
  return t instanceof Blob ? t.size : t.byteLength;
}

export function entryBytes(e: HistoryEntry): number {
  let total = 0;
  for (const tiles of e.pixels.values()) {
    for (const change of tiles.values())
      total += tileBytes(change.before) + tileBytes(change.after);
  }
  return total;
}

/**
 * A linear undo stack with a cursor: entries before it can be undone, entries from it can be
 * redone. Bounded by bytes, not just steps; the oldest steps are dropped first.
 */
export class History {
  private entries: HistoryEntry[] = [];
  private cursor = 0;
  private total = 0;

  constructor(
    private limits: HistoryLimits,
    private onChange: () => void = () => {},
  ) {}

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  get totalBytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.length;
  }

  peekUndo(): HistoryEntry | undefined {
    return this.entries[this.cursor - 1];
  }

  peekRedo(): HistoryEntry | undefined {
    return this.entries[this.cursor];
  }

  push(entry: HistoryEntry) {
    for (const dropped of this.entries.splice(this.cursor)) this.total -= dropped.bytes;
    const top = this.entries[this.cursor - 1];
    if (
      top &&
      entry.coalesceKey !== undefined &&
      top.coalesceKey === entry.coalesceKey &&
      entry.time - top.time < COALESCE_MS &&
      top.doc &&
      entry.doc &&
      entry.pixels.size === 0
    ) {
      top.doc.after = entry.doc.after;
      top.time = entry.time;
      this.onChange();
      return;
    }
    entry.bytes = entryBytes(entry);
    this.total += entry.bytes;
    this.entries.push(entry);
    this.cursor = this.entries.length;
    this.enforce();
    this.onChange();
  }

  /** Recomputes an entry's size after its tiles arrived or were compressed. */
  updateBytes(entry: HistoryEntry) {
    if (!this.entries.includes(entry)) return;
    const bytes = entryBytes(entry);
    this.total += bytes - entry.bytes;
    entry.bytes = bytes;
    this.enforce();
    this.onChange();
  }

  /** Drops one entry (its pixels were lost before they were read back). */
  remove(entry: HistoryEntry) {
    const i = this.entries.indexOf(entry);
    if (i < 0) return;
    this.entries.splice(i, 1);
    this.total -= entry.bytes;
    if (i < this.cursor) this.cursor--;
    this.onChange();
  }

  stepBack() {
    if (this.cursor > 0) this.cursor--;
    this.onChange();
  }

  stepForward() {
    if (this.cursor < this.entries.length) this.cursor++;
    this.onChange();
  }

  /** Finishes every GPU readback still in flight (blocking). Needed before applying entries. */
  flushPending() {
    for (const e of this.entries) e.pending?.();
  }

  /** Entries far enough from the cursor that compressing them won't slow down undo. */
  compressible(keepRaw: number): HistoryEntry[] {
    return this.entries.filter(
      (e, i) => !e.pending && (i < this.cursor - keepRaw || i >= this.cursor + keepRaw),
    );
  }

  clear() {
    this.entries = [];
    this.cursor = 0;
    this.total = 0;
    this.onChange();
  }

  private enforce() {
    while (
      this.entries.length > 1 &&
      this.cursor > 1 &&
      (this.total > this.limits.maxBytes || this.entries.length > this.limits.maxEntries)
    ) {
      const dropped = this.entries.shift();
      if (dropped) this.total -= dropped.bytes;
      this.cursor--;
    }
  }
}
