import { describe, expect, it } from 'vitest';
import { presetById } from '../brush/presets';
import type { ToolSettings } from '../brush/tool';
import type { InputSample } from './PointerInput';
import { parseRecording, StrokeRecorder, strokeSamples } from './recording';

const TOOL: ToolSettings = {
  preset: presetById('pencil'),
  size: 12,
  opacity: 0.8,
  smoothing: 0.25,
  color: '#ff375f',
  eraser: false,
};

const sample = (x: number, t: number, pressure = 0.5): InputSample => ({
  x: x + 0.123456789,
  y: x / 3,
  pressure,
  altitude: 0.9,
  azimuth: 2.1,
  t,
});

describe('StrokeRecorder', () => {
  it('round-trips strokes through JSON exactly', () => {
    const rec = new StrokeRecorder({ w: 800, h: 600 }, 'test');
    rec.begin(sample(10, 1000.25), TOOL, { pointerType: 'pen', eraser: false });
    rec.extend([sample(11, 1004.5, 0.6), sample(12, 1008.75, 0.7)]);
    rec.end('commit');
    rec.begin(sample(50, 2000), { ...TOOL, eraser: true }, { pointerType: 'touch', eraser: true });
    rec.end('cancel');
    expect(rec.strokeCount).toBe(2);

    const parsed = parseRecording(JSON.stringify(rec.finish()));
    expect(parsed.doc).toEqual({ w: 800, h: 600 });
    expect(parsed.note).toBe('test');
    const [first, second] = parsed.strokes;
    expect(first?.tool).toEqual(TOOL);
    expect(second).toMatchObject({ pointerType: 'touch', eraser: true, end: 'cancel' });

    // Timestamps are relative to the stroke start, so a replay can run on any clock.
    const replayed = strokeSamples(first!, 500);
    expect(replayed.map((s) => s.t)).toEqual([500, 504.25, 508.5]);
    expect(replayed[1]).toEqual({ ...sample(11, 0, 0.6), t: 504.25 });
  });

  it('ignores samples outside a stroke', () => {
    const rec = new StrokeRecorder({ w: 10, h: 10 });
    rec.extend([sample(1, 0)]);
    rec.end('commit');
    expect(rec.finish().strokes).toEqual([]);
  });
});

describe('parseRecording', () => {
  const valid = () => {
    const rec = new StrokeRecorder({ w: 100, h: 100 });
    rec.begin(sample(1, 0), TOOL, { pointerType: 'pen', eraser: false });
    rec.end('commit');
    return rec.finish();
  };

  it('rejects files that are not recordings', () => {
    expect(() => parseRecording('{')).toThrow(/invalid JSON/);
    expect(() => parseRecording('{"format":"other"}')).toThrow(/Not a stroke recording/);
    expect(() => parseRecording(JSON.stringify({ ...valid(), version: 2 }))).toThrow(/version 2/);
    expect(() => parseRecording(JSON.stringify({ ...valid(), doc: { w: 0, h: 5 } }))).toThrow(
      /document size/,
    );
  });

  it('rejects damaged strokes', () => {
    const rec = valid();
    const damaged = [
      { ...rec.strokes[0], samples: [1, 2, 3] },
      { ...rec.strokes[0], samples: [1, 2, 3, 4, 5, Number.NaN] },
      { ...rec.strokes[0], end: 'maybe' },
      { ...rec.strokes[0], tool: { ...TOOL, preset: null } },
    ];
    for (const stroke of damaged) {
      // NaN becomes null in JSON, which is just as invalid.
      expect(() => parseRecording(JSON.stringify({ ...rec, strokes: [stroke] }))).toThrow(
        /Stroke 1/,
      );
    }
  });
});
