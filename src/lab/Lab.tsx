import { useCallback, useEffect, useRef, useState } from 'react';
import { RecorderControls } from '../debug/RecorderControls';
import { Engine } from '../engine/Engine';
import { hasWebGL2 } from '../engine/gl/context';
import { deliver } from '../files/deliver';
import { encodeImage } from '../files/image';
import ui from '../app/ui/ui.module.css';
import {
  type BenchOptions,
  type BenchReport,
  type BenchResult,
  DEVICE_OPTIONS,
  QUICK_OPTIONS,
  runBenchmarks,
  runSoak,
} from './benchmarks';
import styles from './Lab.module.css';
import { playScene, type Scene } from './scenes';
import { tool } from './synthetic';
import type { ToolSettings } from '../engine/brush/tool';

/** What the lab exposes to end-to-end tests as `window.__lab`. */
export interface LabHook {
  engine: Engine;
  playScene(scene: Scene): Promise<void>;
  /** The composited document as a base64 PNG. */
  png(): Promise<string>;
  runBenchmarks(options?: Partial<BenchOptions>): Promise<BenchReport>;
  /** Selects a brush preset for the strokes that follow (real pointer input). */
  useBrush(presetId: string, patch?: Partial<Omit<ToolSettings, 'preset'>>): void;
}

declare global {
  interface Window {
    __lab?: LabHook;
  }
}

/** §7.1's document: an iPad Pro 12.9" screen. */
const DEFAULT_DOC = { w: 2732, h: 2048 };

function labParams() {
  const q = new URLSearchParams(location.search);
  const size = (key: string, fallback: number) => {
    const v = Number(q.get(key));
    return Number.isInteger(v) && v > 0 ? v : fallback;
  };
  return {
    doc: { w: size('w', DEFAULT_DOC.w), h: size('h', DEFAULT_DOC.h) },
    showUi: q.get('ui') !== '0',
  };
}

/**
 * The lab (`?lab`, optionally `&w=…&h=…&ui=0`): a bare canvas on a scratch document, for the
 * benchmark suite, soak test, stroke recordings and visual regression scenes. Nothing here
 * touches the user's artwork.
 */
export function Lab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [params] = useState(labParams);
  const [supported] = useState(hasWebGL2);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [report, setReport] = useState<BenchReport | null>(null);
  const [soak, setSoak] = useState<BenchResult[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [soaking, setSoaking] = useState(false);
  const soakAbort = useRef<AbortController | null>(null);

  const say = useCallback((message: string) => setLog((l) => [...l.slice(-200), message]), []);
  const engine = useCallback(() => engineRef.current, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const e = new Engine(canvas, {
      docSize: params.doc,
      onNotice: (m) => console.info(m),
    });
    engineRef.current = e;
    window.__lab = {
      engine: e,
      playScene: (scene) => playScene(e, scene),
      png: async () => {
        const blob = await encodeImage(e.exportImage(false), 'image/png');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      },
      runBenchmarks: (options) => runBenchmarks(e, { ...QUICK_OPTIONS, ...options }),
      useBrush: (presetId, patch) => e.setTool(tool(presetId, patch)),
    };
    return () => {
      if (window.__lab?.engine === e) delete window.__lab;
      e.dispose();
      engineRef.current = null;
    };
  }, [params]);

  const bench = async (options: BenchOptions) => {
    const e = engineRef.current;
    if (!e || busy) return;
    setBusy(true);
    setReport(null);
    setLog([]);
    try {
      setReport(await runBenchmarks(e, options, say));
      say('Done. Reload the page before running again (the document keeps its layers).');
    } catch (err) {
      console.error(err);
      say(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const startSoak = async () => {
    const e = engineRef.current;
    if (!e || busy) return;
    const ac = new AbortController();
    soakAbort.current = ac;
    setBusy(true);
    setSoaking(true);
    setSoak(null);
    setLog(['Soak test: 30 minutes of drawing, undo and layer churn. Keep the screen on.']);
    try {
      const results = await runSoak(
        e,
        30,
        (s) =>
          say(
            `${s.minute} min · GL objects ${s.glObjects} · history ${s.historyMB} MB · heap ${s.heapMB ?? '–'} MB`,
          ),
        ac.signal,
      );
      setSoak(results);
    } finally {
      soakAbort.current = null;
      setBusy(false);
      setSoaking(false);
    }
  };

  const json = () => JSON.stringify({ benchmarks: report, soak }, null, 2);
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  if (!supported) return <p className={styles.panel}>This browser doesn’t support WebGL2.</p>;

  return (
    <>
      <canvas ref={canvasRef} className={styles.canvas} aria-label="Lab canvas" />
      {params.showUi && (
        <section className={styles.panel} aria-label="Lab">
          <header className={styles.header}>
            <h1>DrawThing lab</h1>
            <button className={ui.textButton} onClick={() => setCollapsed((c) => !c)}>
              {collapsed ? 'Show' : 'Hide'}
            </button>
          </header>
          {!collapsed && (
            <>
              <p className={styles.muted}>
                Scratch canvas {params.doc.w} × {params.doc.h} px. Your artwork isn’t touched.
                Change the size with <code>?lab&amp;w=4096&amp;h=4096</code>.
              </p>
              <div className={styles.row}>
                <button
                  className={`${ui.textButton} ${ui.primary}`}
                  disabled={busy}
                  onClick={() => void bench(DEVICE_OPTIONS)}
                >
                  Run benchmarks
                </button>
                <button
                  className={ui.textButton}
                  disabled={busy}
                  onClick={() => void bench(QUICK_OPTIONS)}
                >
                  Quick run
                </button>
                {soaking ? (
                  <button className={ui.textButton} onClick={() => soakAbort.current?.abort()}>
                    Stop soak
                  </button>
                ) : (
                  <button
                    className={ui.textButton}
                    disabled={busy}
                    onClick={() => void startSoak()}
                  >
                    Soak (30 min)
                  </button>
                )}
              </div>
              <RecorderControls engine={engine} onNotice={say} />
              {(report || soak) && (
                <>
                  <ResultsTable results={[...(report?.results ?? []), ...(soak ?? [])]} />
                  <div className={styles.row}>
                    <button
                      className={ui.textButton}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(json())
                          .then(() => say('Copied the report'))
                      }
                    >
                      Copy report
                    </button>
                    <button
                      className={ui.textButton}
                      onClick={() =>
                        void deliver(
                          new Blob([json()], { type: 'application/json' }),
                          `drawthing-bench-${stamp()}.json`,
                        )
                      }
                    >
                      Save report
                    </button>
                  </div>
                </>
              )}
              {log.length > 0 && (
                <pre className={styles.log} role="log">
                  {log.join('\n')}
                </pre>
              )}
              <p>
                <a href="./" className={styles.link}>
                  Back to DrawThing
                </a>
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}

function ResultsTable({ results }: { results: BenchResult[] }) {
  return (
    <table className={styles.table}>
      <tbody>
        {results.map((r) => (
          <tr key={r.id}>
            <td aria-label={r.pass === null ? 'info' : r.pass ? 'pass' : 'fail'}>
              {r.pass === null ? '·' : r.pass ? '✓' : '✗'}
            </td>
            <td>
              {r.label}
              <small>
                Target {r.target}
                {r.detail && ` · ${r.detail}`}
              </small>
            </td>
            <td className={styles.value}>
              {r.value === null ? 'n/a' : `${r.value}${r.unit ? ` ${r.unit}` : ''}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
