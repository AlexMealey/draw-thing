import type { BrushPreset } from '../brush/presets';
import type { ToolSettings } from '../brush/tool';
import type { InputSample } from './PointerInput';

/**
 * Strokes as the engine received them (document px, after palm rejection and gestures), for
 * regression replays (ROADMAP §7.1): record a real Pencil or Surface Pen session, save it as JSON,
 * and replay it in CI. Replaying gives the same pixels as the original strokes, since everything
 * after the input (smoothing, spacing, jitter) is deterministic.
 */
export interface StrokeRecording {
  format: 'drawthing-strokes';
  version: 1;
  /** Document size the coordinates refer to. */
  doc: { w: number; h: number };
  /** Free text: device, browser, what was being tested. */
  note: string;
  strokes: RecordedStroke[];
}

export interface RecordedStroke {
  tool: ToolSettings;
  pointerType: string;
  /** Drawn with the pen's eraser end. */
  eraser: boolean;
  /** Flat `x, y, pressure, altitude, azimuth, t` per sample; t in ms from the stroke's start. */
  samples: number[];
  /** Pen-up commits; a finger stroke that became a gesture is cancelled. */
  end: 'commit' | 'cancel';
}

export const SAMPLE_FIELDS = 6;

/** Collects strokes as the engine accepts them. */
export class StrokeRecorder {
  private strokes: RecordedStroke[] = [];
  private current: RecordedStroke | null = null;
  private t0 = 0;

  constructor(
    private doc: { w: number; h: number },
    private note = '',
  ) {}

  get strokeCount(): number {
    return this.strokes.length;
  }

  begin(s: InputSample, tool: ToolSettings, opts: { pointerType: string; eraser: boolean }) {
    this.t0 = s.t;
    this.current = {
      tool: { ...tool },
      pointerType: opts.pointerType,
      eraser: opts.eraser,
      samples: [],
      end: 'commit',
    };
    this.add(s);
  }

  extend(samples: readonly InputSample[]) {
    for (const s of samples) this.add(s);
  }

  end(how: 'commit' | 'cancel') {
    if (!this.current) return;
    this.current.end = how;
    this.strokes.push(this.current);
    this.current = null;
  }

  finish(): StrokeRecording {
    return {
      format: 'drawthing-strokes',
      version: 1,
      doc: { ...this.doc },
      note: this.note,
      strokes: [...this.strokes],
    };
  }

  private add(s: InputSample) {
    // Full precision: even 0.01 px of rounding would change antialiased edges on replay.
    this.current?.samples.push(s.x, s.y, s.pressure, s.altitude, s.azimuth, s.t - this.t0);
  }
}

/** A recorded stroke's samples, timestamped from `t0` (the replay's clock). */
export function strokeSamples(stroke: RecordedStroke, t0: number): InputSample[] {
  const out: InputSample[] = [];
  const s = stroke.samples;
  for (let i = 0; i + SAMPLE_FIELDS <= s.length; i += SAMPLE_FIELDS) {
    out.push({
      x: s[i] ?? 0,
      y: s[i + 1] ?? 0,
      pressure: s[i + 2] ?? 1,
      altitude: s[i + 3] ?? Math.PI / 2,
      azimuth: s[i + 4] ?? 0,
      t: t0 + (s[i + 5] ?? 0),
    });
  }
  return out;
}

/** Reads a recording file, with a readable error for anything that isn't one. */
export function parseRecording(json: string): StrokeRecording {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Not a stroke recording (invalid JSON)');
  }
  const rec = data as Partial<StrokeRecording> | null;
  if (rec?.format !== 'drawthing-strokes') throw new Error('Not a stroke recording');
  if (rec.version !== 1) throw new Error(`Unsupported recording version ${String(rec.version)}`);
  const { w, h } = rec.doc ?? {};
  if (!isPositive(w) || !isPositive(h)) throw new Error('Recording has no document size');
  if (!Array.isArray(rec.strokes)) throw new Error('Recording has no strokes');
  rec.strokes.forEach((s, i) => {
    const ok =
      isTool(s?.tool) &&
      Array.isArray(s.samples) &&
      s.samples.length >= SAMPLE_FIELDS &&
      s.samples.length % SAMPLE_FIELDS === 0 &&
      s.samples.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      (s.end === 'commit' || s.end === 'cancel');
    if (!ok) throw new Error(`Stroke ${i + 1} of the recording is damaged`);
  });
  return {
    format: 'drawthing-strokes',
    version: 1,
    doc: { w, h },
    note: typeof rec.note === 'string' ? rec.note : '',
    strokes: rec.strokes,
  };
}

const isPositive = (v: unknown): v is number => typeof v === 'number' && v > 0 && v <= 16384;

function isTool(t: Partial<ToolSettings> | undefined): t is ToolSettings {
  const preset = t?.preset as Partial<BrushPreset> | undefined;
  return (
    typeof t?.size === 'number' &&
    typeof t.opacity === 'number' &&
    typeof t.smoothing === 'number' &&
    typeof t.color === 'string' &&
    typeof t.eraser === 'boolean' &&
    typeof preset?.id === 'string' &&
    typeof preset.tip === 'object' &&
    typeof preset.size === 'object' &&
    typeof preset.pressure === 'object'
  );
}
