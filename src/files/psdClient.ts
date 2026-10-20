import type { PsdDocData, PsdImport } from './psd';

export type PsdRequest = { type: 'write'; doc: PsdDocData } | { type: 'read'; buffer: ArrayBuffer };
export type PsdResponse =
  { ok: true; bytes: Uint8Array } | { ok: true; doc: PsdImport } | { ok: false; error: string };

/**
 * One short-lived worker per job (exports and imports are rare). Where workers can't be created,
 * the job runs on the main thread.
 */
function run(req: PsdRequest, transfer: Transferable[]): Promise<PsdResponse> {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return runHere(req);
  }
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<PsdResponse>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      // The pixel buffers have already moved to the worker, so there's no retrying here.
      resolve({ ok: false, error: e.message || 'The PSD worker failed' });
    };
    worker.postMessage(req, transfer);
  });
}

async function runHere(req: PsdRequest): Promise<PsdResponse> {
  const { readPsdFile, writePsdFile } = await import('./psd');
  try {
    return req.type === 'write'
      ? { ok: true, bytes: writePsdFile(req.doc) }
      : { ok: true, doc: readPsdFile(req.buffer) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function encodePsd(doc: PsdDocData): Promise<Blob> {
  // Pixel buffers move to the worker instead of being copied.
  const transfer = doc.layers.flatMap((l) => (l.pixels ? [l.pixels.data.buffer] : []));
  if (doc.composite) transfer.push(doc.composite.data.buffer);
  const res = await run({ type: 'write', doc }, [...new Set(transfer)] as Transferable[]);
  if (!res.ok) throw new Error(res.error);
  if (!('bytes' in res)) throw new Error('Unexpected PSD worker reply');
  return new Blob([res.bytes as Uint8Array<ArrayBuffer>], { type: 'image/vnd.adobe.photoshop' });
}

export async function decodePsd(file: Blob): Promise<PsdImport> {
  const buffer = await file.arrayBuffer();
  const res = await run({ type: 'read', buffer }, [buffer]);
  if (!res.ok) throw new Error(res.error);
  if (!('doc' in res)) throw new Error('Unexpected PSD worker reply');
  return res.doc;
}
