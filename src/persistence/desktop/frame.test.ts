import { describe, expect, it } from 'vitest';
import { decodeFrame, encodeFrame, FrameBody, frameItem } from './frame';

describe('frame', () => {
  it('round-trips a header and body parts', () => {
    const body = new FrameBody();
    const a = body.add(new Uint8Array([1, 2, 3]));
    const b = body.add(new Uint8Array([9]));
    const buf = encodeFrame({ a, b, name: 'é' }, body);
    const { header, body: out } = decodeFrame<{ a: number[]; b: number[]; name: string }>(
      buf.buffer,
    );
    expect(header).toEqual({ a: [0, 3], b: [3, 1], name: 'é' });
    expect([...frameItem(out, 0, 3)]).toEqual([1, 2, 3]);
    expect([...frameItem(out, 3, 1)]).toEqual([9]);
  });

  it('uses a little-endian length prefix, as Rust reads it', () => {
    const buf = encodeFrame([]);
    expect([...buf]).toEqual([2, 0, 0, 0, 0x5b, 0x5d]);
  });

  it('refuses truncated frames and out-of-range items', () => {
    expect(() => decodeFrame(new Uint8Array([1, 0]).buffer)).toThrow();
    expect(() => decodeFrame(new Uint8Array([9, 0, 0, 0, 0x7b]).buffer)).toThrow();
    const { body } = decodeFrame(encodeFrame(null).buffer);
    expect(() => frameItem(body, 0, 1)).toThrow();
  });
});
