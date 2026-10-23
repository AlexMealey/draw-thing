import { describe, expect, it } from 'vitest';
import type { DocSnapshot, HistoryEntry } from './History';
import { History } from './History';

const snap = (activeLayerId: string): DocSnapshot => ({
  layers: [],
  groups: [],
  activeLayerId,
  background: { color: '#fff', visible: true },
});

const pixels = (label: string, bytes: number, time = 0): HistoryEntry => ({
  label,
  pixels: new Map([['layer', new Map([[0, { before: null, after: new Uint8Array(bytes) }]])]]),
  time,
  bytes: 0,
});

const props = (key: string, time: number, after: string): HistoryEntry => ({
  label: key,
  doc: { before: snap('before'), after: snap(after) },
  pixels: new Map(),
  coalesceKey: key,
  time,
  bytes: 0,
});

describe('History', () => {
  it('removes an entry and keeps the cursor on the same step', () => {
    const h = new History({ maxBytes: 1e9, maxEntries: 100 });
    const a = pixels('a', 4);
    h.push(a);
    h.push(pixels('b', 4));
    h.push(pixels('c', 4));
    h.stepBack(); // c can be redone
    h.remove(a);
    expect(h.size).toBe(2);
    expect(h.totalBytes).toBe(8);
    expect(h.peekUndo()?.label).toBe('b');
    expect(h.peekRedo()?.label).toBe('c');
    h.remove(a); // no longer there
    expect(h.size).toBe(2);
  });

  it('moves a cursor through undo and redo, and push drops the redo branch', () => {
    const h = new History({ maxBytes: 1e9, maxEntries: 100 });
    h.push(pixels('a', 4));
    h.push(pixels('b', 4));
    expect(h.peekUndo()?.label).toBe('b');
    h.stepBack();
    expect(h.canRedo).toBe(true);
    expect(h.peekRedo()?.label).toBe('b');
    h.push(pixels('c', 4));
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(2);
    expect(h.totalBytes).toBe(8);
  });

  it('coalesces quick repeats of the same metadata change', () => {
    const h = new History({ maxBytes: 1e9, maxEntries: 100 });
    h.push(props('opacity:l1', 0, 'x'));
    h.push(props('opacity:l1', 500, 'y'));
    h.push(props('opacity:l1', 3000, 'z')); // too late: a new step
    expect(h.size).toBe(2);
    h.stepBack();
    expect(h.peekUndo()?.doc?.after.activeLayerId).toBe('y');
  });

  it('drops the oldest steps to stay within the byte budget and step limit', () => {
    const h = new History({ maxBytes: 10, maxEntries: 3 });
    h.push(pixels('a', 4));
    h.push(pixels('b', 4));
    h.push(pixels('c', 4)); // 12 bytes > 10
    expect(h.size).toBe(2);
    expect(h.totalBytes).toBe(8);
    h.push(pixels('d', 1));
    h.push(pixels('e', 1));
    expect(h.size).toBe(3);
    h.stepBack();
    h.stepBack();
    h.stepBack();
    expect(h.canUndo).toBe(false);
  });

  it('accounts for tiles that arrive later', () => {
    const h = new History({ maxBytes: 1e9, maxEntries: 100 });
    const e: HistoryEntry = { label: 'stroke', pixels: new Map(), time: 0, bytes: 0 };
    h.push(e);
    e.pixels.set('layer', new Map([[3, { before: new Uint8Array(8), after: null }]]));
    h.updateBytes(e);
    expect(h.totalBytes).toBe(8);
  });
});
