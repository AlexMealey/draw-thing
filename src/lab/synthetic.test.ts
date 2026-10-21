import { describe, expect, it } from 'vitest';
import { parseRecording, SAMPLE_FIELDS } from '../engine/input/recording';
import { REGRESSION_SCENES } from './scenes';
import { along, line, mulberry32, PEN_HZ, penStroke, scribble, tool, zigzag } from './synthetic';

const area = { x: 10, y: 20, w: 300, h: 200 };
const inside = (p: { x: number; y: number }) =>
  p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h;

describe('synthetic strokes', () => {
  it('are deterministic', () => {
    expect(scribble(area, 0.5, 4)).toEqual(scribble(area, 0.5, 4));
    expect(scribble(area, 0.5, 4)).not.toEqual(scribble(area, 0.5, 5));
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  it('scribbles stay inside their area at the pen rate', () => {
    const pts = scribble(area, 1, 9);
    expect(pts).toHaveLength(PEN_HZ);
    expect(pts.every(inside)).toBe(true);
    expect(pts.every((p) => p.p >= 0 && p.p <= 1)).toBe(true);
  });

  it('a zigzag covers the whole area', () => {
    const pts = zigzag(area, 20);
    expect(pts.every(inside)).toBe(true);
    const ys = new Set(pts.map((p) => p.y));
    // Rows closer together than the brush, from the top edge to the bottom edge.
    expect(Math.min(...ys)).toBe(area.y);
    expect(Math.max(...ys)).toBe(area.y + area.h);
    expect(area.h / (ys.size - 1)).toBeLessThan(20);
  });

  it('pen strokes are valid recordings with 240 Hz timestamps', () => {
    const stroke = penStroke(
      along(4, line(0, 0, 40, 0), (u) => u),
      tool('ink'),
    );
    expect(stroke.samples).toHaveLength(5 * SAMPLE_FIELDS);
    expect(stroke.samples[SAMPLE_FIELDS + 5]).toBeCloseTo(1000 / PEN_HZ);
    expect(stroke.samples[SAMPLE_FIELDS * 4 + 2]).toBe(1); // pressure ramps up to 1
  });

  it('every regression scene serializes to valid recordings', () => {
    expect(new Set(REGRESSION_SCENES.map((s) => s.name)).size).toBe(REGRESSION_SCENES.length);
    for (const scene of REGRESSION_SCENES) {
      for (const step of scene.steps) {
        if (!('strokes' in step)) continue;
        const rec = {
          format: 'drawthing-strokes',
          version: 1,
          doc: scene.doc,
          note: '',
          strokes: step.strokes,
        };
        expect(() => parseRecording(JSON.stringify(rec)), scene.name).not.toThrow();
      }
    }
  });
});
