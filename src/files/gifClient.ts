import type { GifOptions } from './gif';

export type GifRequest =
  | { type: 'start'; options: GifOptions }
  | { type: 'frame'; rgba: ArrayBuffer; delayCs: number }
  | { type: 'finish' };

export type GifResponse =
  { type: 'ack' } | { type: 'done'; bytes: Uint8Array } | { type: 'error'; error: string };

/** Builds a GIF one frame at a time, in a worker where possible. */
export interface GifWriter {
  /** Takes ownership of the pixels (they move to the worker). */
  add(frame: ImageData, delayCs: number): Promise<void>;
  finish(): Promise<Blob>;
  /** Stops and frees everything; the writer can't be used afterwards. */
  cancel(): void;
}

const toBlob = (bytes: Uint8Array) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' });

export async function createGifWriter(options: GifOptions): Promise<GifWriter> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return mainThreadWriter(options);
  }
  let pending: { resolve: (r: GifResponse) => void } | null = null;
  let failed: string | null = null;
  worker.onmessage = (e: MessageEvent<GifResponse>) => {
    const p = pending;
    pending = null;
    p?.resolve(e.data);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    failed = e.message || 'The GIF worker failed';
    const p = pending;
    pending = null;
    p?.resolve({ type: 'error', error: failed });
  };
  const send = (req: GifRequest, transfer: Transferable[] = []) =>
    new Promise<GifResponse>((resolve) => {
      if (failed) return resolve({ type: 'error', error: failed });
      pending = { resolve };
      worker.postMessage(req, transfer);
    });
  const check = (r: GifResponse) => {
    if (r.type === 'error') {
      worker.terminate();
      throw new Error(r.error);
    }
    return r;
  };

  check(await send({ type: 'start', options }));
  return {
    async add(frame, delayCs) {
      const rgba = frame.data.buffer;
      check(await send({ type: 'frame', rgba, delayCs }, [rgba]));
    },
    async finish() {
      const r = check(await send({ type: 'finish' }));
      worker.terminate();
      if (r.type !== 'done') throw new Error('Unexpected GIF worker reply');
      return toBlob(r.bytes);
    },
    cancel() {
      worker.terminate();
    },
  };
}

async function mainThreadWriter(options: GifOptions): Promise<GifWriter> {
  const { GifBuilder } = await import('./gif');
  const builder = new GifBuilder(options);
  return {
    add: async (frame, delayCs) => builder.add(frame.data, delayCs),
    finish: async () => toBlob(builder.finish()),
    cancel: () => {},
  };
}
