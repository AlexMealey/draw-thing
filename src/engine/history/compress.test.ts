import { describe, expect, it } from 'vitest';
import { compressTile, inflateTile } from './compress';

describe('tile compression', () => {
  it('round-trips raw bytes through a zlib Blob', async () => {
    const raw = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < raw.length; i += 7) raw[i] = i & 255;
    const packed = await compressTile(raw);
    expect(packed).toBeInstanceOf(Blob);
    expect((packed as Blob).size).toBeLessThan(raw.byteLength / 2);
    expect(await inflateTile(packed)).toEqual(raw);
  });

  it('passes null (transparent) tiles through', async () => {
    expect(await compressTile(null)).toBeNull();
    expect(await inflateTile(null)).toBeNull();
  });
});
