/**
 * The binary framing shared with `src-tauri/src/library/frame.rs`, for sending tiles and images
 * over Tauri's IPC as raw bytes rather than JSON number arrays:
 *
 *   u32 little-endian header length | header (UTF-8 JSON) | body bytes
 *
 * The header gives each item's place in the body as `[offset, length]`, from the body's start.
 */

/** Collects body parts and hands out their `[offset, length]`. */
export class FrameBody {
  readonly parts: Uint8Array[] = [];
  private size = 0;

  add(bytes: Uint8Array): [number, number] {
    const at: [number, number] = [this.size, bytes.byteLength];
    this.parts.push(bytes);
    this.size += bytes.byteLength;
    return at;
  }
}

export function encodeFrame(header: unknown, body?: FrameBody): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const parts = body?.parts ?? [];
  const out = new Uint8Array(4 + json.byteLength + parts.reduce((n, p) => n + p.byteLength, 0));
  new DataView(out.buffer).setUint32(0, json.byteLength, true);
  out.set(json, 4);
  let at = 4 + json.byteLength;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

export function decodeFrame<H>(buf: ArrayBuffer): { header: H; body: Uint8Array<ArrayBuffer> } {
  if (buf.byteLength < 4) throw new Error('Truncated frame');
  const len = new DataView(buf).getUint32(0, true);
  if (4 + len > buf.byteLength) throw new Error('Truncated frame header');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as H;
  return { header, body: new Uint8Array(buf, 4 + len) };
}

/** The bytes at `[offset, length]` in a body. */
export function frameItem(body: Uint8Array<ArrayBuffer>, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > body.byteLength) {
    throw new Error('Frame item out of range');
  }
  return body.subarray(offset, offset + length);
}
