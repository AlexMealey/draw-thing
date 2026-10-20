import { readPsdFile, writePsdFile } from './psd';
import type { PsdRequest, PsdResponse } from './psdClient';

// Runs ag-psd off the main thread: encoding a big layered PSD takes long enough to stall input.
self.addEventListener('message', (e: MessageEvent<PsdRequest>) => {
  const reply = (msg: PsdResponse, transfer: Transferable[] = []) =>
    self.postMessage(msg, { transfer });
  try {
    if (e.data.type === 'write') {
      const bytes = writePsdFile(e.data.doc);
      reply({ ok: true, bytes }, [bytes.buffer]);
    } else {
      const doc = readPsdFile(e.data.buffer);
      const transfer = doc.layers.flatMap((l) => (l.pixels ? [l.pixels.data.buffer] : []));
      if (doc.composite) transfer.push(doc.composite.data.buffer);
      reply({ ok: true, doc }, [...new Set(transfer)]); // a flat PSD's layer is its composite
    }
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
