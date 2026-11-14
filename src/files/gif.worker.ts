import { GifBuilder } from './gif';
import type { GifRequest, GifResponse } from './gifClient';

// Palette quantization and LZW compression for every frame take long enough to stall input,
// so GIFs are built here. Frames arrive one at a time and are acknowledged, so the page never
// queues more than one.
let builder: GifBuilder | null = null;

self.addEventListener('message', (e: MessageEvent<GifRequest>) => {
  const reply = (msg: GifResponse, transfer: Transferable[] = []) =>
    self.postMessage(msg, { transfer });
  try {
    const req = e.data;
    if (req.type === 'start') {
      builder = new GifBuilder(req.options);
      reply({ type: 'ack' });
    } else if (req.type === 'frame') {
      if (!builder) throw new Error('GIF not started');
      builder.add(new Uint8ClampedArray(req.rgba), req.delayCs);
      reply({ type: 'ack' });
    } else {
      if (!builder) throw new Error('GIF not started');
      const bytes = builder.finish();
      builder = null;
      reply({ type: 'done', bytes }, [bytes.buffer]);
    }
  } catch (err) {
    reply({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});
