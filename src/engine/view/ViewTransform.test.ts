import { describe, expect, it } from 'vitest';
import { apply } from '../math/affine';
import { ViewTransform } from './ViewTransform';

describe('ViewTransform', () => {
  it('resets rotation exactly, keeping the zoom and the pivot in place', () => {
    const view = new ViewTransform();
    view.fit(1000, 800, 1200, 900);
    view.zoomAt(1.7, 300, 200);
    view.rotateAt(1.234, 640, 480);
    const scale = view.scale;
    const pivot = view.viewToDoc(600, 450);

    view.resetRotation(600, 450);

    expect(view.rotation).toBe(0);
    expect(view.docToView.b).toBe(0);
    expect(view.docToView.c).toBe(0);
    expect(view.scale).toBeCloseTo(scale, 12);
    const [x, y] = apply(view.docToView, pivot[0], pivot[1]);
    expect(x).toBeCloseTo(600, 9);
    expect(y).toBeCloseTo(450, 9);
  });

  it('straightens from any angle', () => {
    for (const deg of [-179.9, -90, -3, 0.2, 45, 180]) {
      const view = new ViewTransform();
      view.fit(500, 500, 800, 600);
      view.rotateAt((deg * Math.PI) / 180, 400, 300);
      view.resetRotation(400, 300);
      expect(view.rotation).toBe(0);
    }
  });
});
