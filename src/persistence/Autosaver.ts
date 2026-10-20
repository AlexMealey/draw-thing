import { compressTile } from '../engine/history/compress';
import type { TileData } from '../engine/history/History';
import { encodeImage } from '../files/image';
import { documentStore } from '../state/documentStore';
import { toSaved } from './document';
import { saveProject, setLastOpen, type TileMap } from './projects';

/** What the autosaver needs from the engine. */
export interface SaveSource {
  /** Tiles changed since the last call (latest content wins), and forgets them. */
  takeChanges(): Map<string, Map<number, TileData>>;
  /** Every non-empty tile of every layer; for recovering after a failed save. */
  allTiles(): Map<string, Map<number, TileData>>;
  /** The composited document, small, for the gallery. */
  galleryThumbnail(): ImageData | null;
}

const SAVE_DELAY_MS = 500;
const THUMB_INTERVAL_MS = 10_000;

/**
 * Saves the open project to IndexedDB (ROADMAP §6.2): ~500 ms after the last change, and right
 * away when the app is hidden (iOS may kill a backgrounded PWA without warning). Each save writes
 * only the tiles that changed, taken from the history's own readbacks, so saving never reads the
 * GPU again. Saves run one at a time, in order.
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private dirty = false;
  /** A save failed, so the next one rewrites the whole project. */
  private full = false;
  private lastThumb = -Infinity;
  private savedOnce = false;
  private closed = false;
  private stored: Set<string>;
  private ac = new AbortController();

  constructor(
    private source: SaveSource,
    readonly projectId: string,
    private opts: {
      /** Layers whose tiles are already stored (an opened project's layers). */
      storedLayers: Iterable<string>;
      /** Name used if this save creates the project. */
      name: string;
      onError?: (err: unknown) => void;
    },
  ) {
    this.stored = new Set(opts.storedLayers);
    const signal = this.ac.signal;
    document.addEventListener(
      'visibilitychange',
      () => document.visibilityState === 'hidden' && void this.flush(),
      { signal },
    );
    window.addEventListener('pagehide', () => void this.flush(), { signal });
  }

  /** Something in the document changed. */
  changed = () => {
    if (this.closed) return;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(false), SAVE_DELAY_MS);
  };

  /** Saves now (with a fresh thumbnail) and resolves once everything is written. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.save(true);
  }

  /** Saves just a fresh thumbnail (for a project stored without one). */
  saveThumbnail(): Promise<void> {
    this.dirty = true;
    return this.flush();
  }

  /** Saves what's pending, then stops. The engine may be disposed once this returns. */
  close(): Promise<void> {
    const done = this.flush();
    this.closed = true;
    this.ac.abort();
    return done;
  }

  /** Stops without saving (the project is being deleted). */
  discard(): Promise<void> {
    clearTimeout(this.timer);
    this.closed = true;
    this.ac.abort();
    return this.chain;
  }

  private save(final: boolean): Promise<void> {
    if (this.closed || (!this.dirty && !this.full)) return this.chain;
    this.dirty = false;
    // Everything that touches the engine happens now, synchronously; the rest is async.
    const full = this.full;
    const changes = this.source.takeChanges(); // also lands a stroke that just ended
    const tiles = full ? this.source.allTiles() : changes;
    const doc = toSaved(documentStore.getState());
    const now = performance.now();
    const thumbImage =
      final || now - this.lastThumb > THUMB_INTERVAL_MS ? this.source.galleryThumbnail() : null;
    if (thumbImage) this.lastThumb = now;
    const ids = new Set(doc.layers.map((l) => l.id));
    const removedLayers = [...this.stored].filter((id) => !ids.has(id));
    this.stored = ids;
    this.full = false;

    this.chain = this.chain.then(async () => {
      try {
        const compressed: TileMap = new Map();
        for (const [layerId, layer] of tiles) {
          const out = new Map<number, Blob | null>();
          for (const [key, t] of layer) out.set(key, (await compressTile(t)) as Blob | null);
          compressed.set(layerId, out);
        }
        const thumb = thumbImage ? await encodeImage(thumbImage, 'image/png') : undefined;
        await saveProject(this.projectId, {
          doc,
          tiles: compressed,
          removedLayers,
          thumb,
          name: this.opts.name,
          replaceTiles: full,
        });
        if (!this.savedOnce) {
          this.savedOnce = true;
          await setLastOpen(this.projectId);
          // Ask the browser not to evict artwork under storage pressure (granted silently to
          // installed PWAs on iOS; Chromium decides by engagement).
          void navigator.storage?.persist?.().catch(() => {});
        }
      } catch (err) {
        // These tiles are no longer tracked, so rewrite everything next time.
        this.full = true;
        this.dirty = true;
        console.error('Autosave failed', err);
        this.opts.onError?.(err);
      }
    });
    return this.chain;
  }
}
