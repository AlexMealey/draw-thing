import type { Engine } from '../engine/Engine';
import type { RecordedStroke, StrokeRecording } from '../engine/input/recording';
import { BLEND_MODES, documentStore, type LayerMeta } from '../state/documentStore';
import { along, line, penStroke, scribble, swell, tool, zigzag } from './synthetic';

/**
 * A reproducible drawing: strokes onto the active layer, and layers added above it. The visual
 * regression suite renders each scene and compares it with a stored image.
 */
export interface Scene {
  name: string;
  doc: { w: number; h: number };
  steps: SceneStep[];
}

export type SceneStep =
  | { strokes: RecordedStroke[] }
  /** Adds a layer above the active one and selects it. */
  | { layer: Partial<Omit<LayerMeta, 'id'>> };

/** Visual regression images stay small: 640 × 480. */
export const SCENE_DOC = { w: 640, h: 480 };

/** A recording (e.g. a real Pencil session) as a scene. */
export function sceneFromRecording(name: string, rec: StrokeRecording): Scene {
  return { name, doc: rec.doc, steps: [{ strokes: rec.strokes }] };
}

/** Draws a scene onto the engine's document, then waits until every change has landed. */
export async function playScene(engine: Engine, scene: Scene): Promise<void> {
  for (const step of scene.steps) {
    if ('layer' in step) {
      const doc = documentStore.getState();
      const id = doc.addLayer();
      if (id === null) throw new Error(`Scene ${scene.name}: layer limit reached`);
      doc.updateLayer(id, step.layer);
    } else {
      await engine.replay({
        format: 'drawthing-strokes',
        version: 1,
        doc: scene.doc,
        note: '',
        strokes: step.strokes,
      });
    }
  }
  await engine.whenIdle();
  engine.takeChanges(); // finishes the strokes' tile readbacks
}

const { w: W, h: H } = SCENE_DOC;
const rows = (n: number, i: number) => (H * (i + 0.5)) / n;

/** Every brush feature: pressure, tilt, grain, flow, max accumulation, jitter, erasing, smoothing. */
export const REGRESSION_SCENES: Scene[] = [
  {
    name: 'ink-pressure',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [
          penStroke(
            along(240, line(40, rows(4, 0), 600, rows(4, 0)), (u) => u),
            tool('ink', { size: 40 }),
          ),
          penStroke(
            along(240, line(40, rows(4, 1), 600, rows(4, 1)), (u) => 1 - u),
            tool('ink', { size: 40 }),
          ),
          penStroke(
            along(240, line(40, rows(4, 2), 600, rows(4, 2)), swell),
            tool('ink', { size: 40 }),
          ),
          // Feather-light: the thinnest the brush gets.
          penStroke(
            along(240, line(40, rows(4, 3), 600, rows(4, 3)), () => 0.02),
            tool('ink', { size: 40 }),
          ),
        ],
      },
    ],
  },
  {
    name: 'pencil-tilt-grain',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [0, 1, 2, 3].map((i) =>
          penStroke(
            along(200, line(60, rows(4, i), 580, rows(4, i)), swell, (u) => ({
              // Upright on the left, lying flat on the right; held at a different angle per row.
              altitude: Math.PI / 2 - u * 1.2,
              azimuth: (i * Math.PI) / 2,
            })),
            tool('pencil', { size: 14 }),
          ),
        ),
      },
    ],
  },
  {
    name: 'airbrush-flow',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [
          penStroke(
            along(180, line(80, 120, 560, 360), swell),
            tool('airbrush', { size: 120, color: '#0a84ff' }),
          ),
          penStroke(
            along(180, line(80, 360, 560, 120), (u) => 0.3 + 0.7 * u),
            tool('airbrush', { size: 120, color: '#ff375f' }),
          ),
          penStroke(
            along(180, line(320, 40, 320, 440), () => 1),
            tool('airbrush', { size: 60, opacity: 0.5 }),
          ),
        ],
      },
    ],
  },
  {
    name: 'marker-max',
    doc: SCENE_DOC,
    steps: [
      {
        // Crossings and doubling back must never get darker than a single pass.
        strokes: [
          penStroke(
            along(300, (u) => [60 + 520 * u, 240 + 160 * Math.sin(u * Math.PI * 4)]),
            tool('marker', { size: 40, color: '#30d158' }),
          ),
          penStroke(
            along(150, line(60, 240, 580, 240)),
            tool('marker', { size: 40, color: '#30d158' }),
          ),
        ],
      },
    ],
  },
  {
    name: 'chalk-jitter',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [
          penStroke(
            scribble({ x: 60, y: 60, w: 520, h: 360 }, 1.2, 7, 900),
            tool('chalk', { size: 40, color: '#bf5af2' }),
          ),
        ],
      },
    ],
  },
  {
    name: 'eraser',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [
          penStroke(
            zigzag({ x: 80, y: 80, w: 480, h: 320 }, 60),
            tool('ink', { size: 60, color: '#ff9f0a' }),
          ),
          // The eraser tool, and the pen's eraser end.
          penStroke(
            along(200, line(60, 160, 580, 160), swell),
            tool('ink', { size: 40, eraser: true }),
          ),
          penStroke(along(200, line(60, 320, 580, 320), swell), tool('airbrush', { size: 80 }), {
            eraser: true,
          }),
        ],
      },
    ],
  },
  {
    name: 'streamline',
    doc: SCENE_DOC,
    steps: [
      {
        // A jagged path, smoothed: the result depends on the samples' timing.
        strokes: [0.3, 0.9].map((smoothing, i) =>
          penStroke(
            along(240, (u) => [60 + 520 * u, rows(2, i) + (Math.floor(u * 48) % 2 ? 50 : -50)]),
            tool('ink', { size: 10, smoothing }),
          ),
        ),
      },
    ],
  },
  {
    name: 'fast-scribble',
    doc: SCENE_DOC,
    steps: [
      {
        // Very fast pen movement: spacing has to fill the gaps between far-apart samples.
        strokes: [
          penStroke(
            scribble({ x: 20, y: 20, w: 600, h: 440 }, 1, 3, 9000),
            tool('ink', { size: 6, smoothing: 0 }),
          ),
        ],
      },
    ],
  },
  {
    name: 'cancel-and-opacity',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [
          penStroke(along(100, line(60, 120, 580, 360)), tool('ink', { size: 30, opacity: 0.4 })),
          penStroke(along(100, line(60, 360, 580, 120)), tool('ink', { size: 30, opacity: 0.4 })),
          // A finger stroke that turned into a pinch leaves nothing.
          penStroke(along(100, line(320, 40, 320, 440)), tool('ink', { size: 30 }), {
            pointerType: 'touch',
            end: 'cancel',
          }),
        ],
      },
    ],
  },
  {
    name: 'blend-modes',
    doc: SCENE_DOC,
    steps: [
      {
        strokes: [
          penStroke(
            zigzag({ x: 0, y: 0, w: W, h: H / 2 }, 50),
            tool('ink', { size: 50, color: '#5e5ce6' }),
          ),
          penStroke(
            along(60, line(0, H * 0.75, W, H * 0.75)),
            tool('airbrush', { size: 200, color: '#ffd60a' }),
          ),
        ],
      },
      // One column per mode, painted on its own layer across both backgrounds.
      ...BLEND_MODES.flatMap((mode, i): SceneStep[] => {
        const x = (W * (i + 0.5)) / BLEND_MODES.length;
        return [
          { layer: { blendMode: mode, opacity: i % 2 ? 0.8 : 1 } },
          {
            strokes: [
              penStroke(
                along(80, line(x, 20, x, H - 20)),
                tool('ink', { size: 44, color: '#ff6b3d' }),
              ),
            ],
          },
        ];
      }),
    ],
  },
];
