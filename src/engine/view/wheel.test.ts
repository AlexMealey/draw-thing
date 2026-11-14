import { describe, expect, it } from 'vitest';
import { type WheelLike, WheelClassifier } from './wheel';

const prefs = { wheel: 'zoom' as const, zoomStep: 1.25 };
const ev = (patch: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  timeStamp: 0,
  ...patch,
});

describe('WheelClassifier', () => {
  it('zooms one zoom step per mouse wheel notch', () => {
    const w = new WheelClassifier();
    const out = w.classify(ev({ deltaY: -100 }), prefs, 800);
    expect(out.kind).toBe('zoom');
    expect(out.kind === 'zoom' && out.factor).toBeCloseTo(1.25);
    const back = w.classify(ev({ deltaY: 100, timeStamp: 1000 }), prefs, 800);
    expect(back.kind === 'zoom' && back.factor).toBeCloseTo(0.8);
  });

  it('pans when the preference says so', () => {
    const out = new WheelClassifier().classify(
      ev({ deltaY: 100 }),
      { ...prefs, wheel: 'pan' },
      800,
    );
    expect(out).toEqual({ kind: 'pan', dx: -0, dy: -100 });
  });

  it('pans sideways with Shift', () => {
    const out = new WheelClassifier().classify(ev({ deltaY: 100, shiftKey: true }), prefs, 800);
    expect(out).toEqual({ kind: 'pan', dx: -100, dy: 0 });
  });

  it('always zooms with Ctrl (trackpad pinch)', () => {
    const out = new WheelClassifier().classify(ev({ deltaY: 2.5, ctrlKey: true }), prefs, 800);
    expect(out.kind).toBe('zoom');
  });

  it('keeps a trackpad scroll panning for the whole gesture', () => {
    const w = new WheelClassifier();
    expect(w.classify(ev({ deltaX: 1.5, deltaY: 3 }), prefs, 800).kind).toBe('pan');
    // Later events of the same gesture look like a mouse wheel, but stay a pan.
    expect(w.classify(ev({ deltaY: 4, timeStamp: 16 }), prefs, 800).kind).toBe('pan');
    // A new gesture after a pause is classified again.
    expect(w.classify(ev({ deltaY: 100, timeStamp: 1000 }), prefs, 800).kind).toBe('zoom');
  });

  it('scales line-mode deltas (Firefox mouse wheels)', () => {
    const out = new WheelClassifier().classify(ev({ deltaY: -3, deltaMode: 1 }), prefs, 800);
    expect(out.kind === 'zoom' && out.factor).toBeCloseTo(1.25);
  });
});
