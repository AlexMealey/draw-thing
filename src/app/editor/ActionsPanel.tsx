import { useEffect, useState } from 'react';
import { RecorderControls } from '../../debug/RecorderControls';
import type { Engine } from '../../engine/Engine';
import { tileGrid } from '../../engine/history/tiles';
import { chooseFile } from '../../files/deliver';
import { decodeImage, fitImage, pixelsToTiles } from '../../files/image';
import { IMAGE_ACCEPT } from '../../files/importFile';
import { documentStore, useDocument } from '../../state/documentStore';
import { toolStore, useTools } from '../../state/toolStore';
import type { OpenProject } from '../project';
import { BackgroundPicker } from '../ui/BackgroundPicker';
import { fileSize, percent } from '../ui/format';
import { Panel } from '../ui/Panel';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';

interface Props {
  project: OpenProject;
  engine: () => Engine | null;
  flush: () => Promise<void>;
  /** Shows the diagnostics section (?debug). */
  debug?: boolean;
  onNotice: (message: string) => void;
  onClose: () => void;
  onNewCanvas: () => void;
  /** Shows how to install the app (absent once installed). */
  onInstall?: () => void;
  /** Restarts into a waiting new version (absent unless there is one). */
  onUpdate?: () => void;
}

const GESTURES: [string, string][] = [
  ['Two-finger tap', 'Undo'],
  ['Three-finger tap', 'Redo'],
  ['Four-finger tap', 'Hide or show the interface'],
  ['Pinch, twist, drag', 'Zoom, rotate, move the canvas'],
  ['Quick pinch in', 'Fit canvas to screen'],
  ['Touch and hold', 'Eyedropper'],
  ['Pen barrel button', 'Eyedropper'],
  ['Space + drag', 'Move the canvas (keyboard)'],
  ['B / E / L / C', 'Brush, eraser, layers, color'],
  ['[ and ]', 'Smaller / bigger brush'],
  ['Ctrl/⌘ + and −', 'Zoom in / out'],
  ['← and →', 'Rotate the canvas; hold to keep turning (turn on under Canvas view)'],
];

export function ActionsPanel({
  project,
  engine,
  flush,
  debug,
  onNotice,
  onClose,
  onNewCanvas,
  onInstall,
  onUpdate,
}: Props) {
  const width = useDocument((s) => s.width);
  const height = useDocument((s) => s.height);
  const layers = useDocument((s) => s.layers.length);
  const maxLayers = useDocument((s) => s.maxLayers);
  const sidebarRight = useTools((s) => s.sidebarRight);
  const fingerDrawing = useTools((s) => s.fingerDrawing);
  const arrowRotate = useTools((s) => s.arrowRotate);
  const arrowRotateStep = useTools((s) => s.arrowRotateStep);
  const snapRotation = useTools((s) => s.snapRotation);
  const sizeStep = useTools((s) => s.sizeStep);
  const keyZoomStep = useTools((s) => s.keyZoomStep);
  const newCanvasBackground = useTools((s) => s.newCanvasBackground);
  const colorPicker = useTools((s) => s.colorPicker);
  const colorSliders = useTools((s) => s.colorSliders);
  const { setPrefs } = toolStore.getState();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try {
      await job();
    } catch (err) {
      console.error(err);
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const insertImage = async () => {
    const file = await chooseFile(IMAGE_ACCEPT);
    if (!file) return;
    await run('Adding image…', async () => {
      const e = engine();
      if (!e) return;
      const bitmap = await decodeImage(file);
      const { width: w, height: h } = documentStore.getState();
      const tiles = pixelsToTiles(fitImage(bitmap, w, h), tileGrid(w, h));
      bitmap.close();
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image';
      if (e.insertLayer(name, tiles)) onClose();
    });
  };

  return (
    <Panel title="Actions" side="left" onClose={onClose}>
      <h3 className={ui.section}>Canvas</h3>
      <p style={{ margin: 0, fontSize: 14 }}>
        <strong>{project.name}</strong>
        <br />
        {width} × {height} px · {layers} of {maxLayers} layers
      </p>
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={ui.textButton} onClick={onNewCanvas}>
          New canvas…
        </button>
        <button className={ui.textButton} onClick={() => void insertImage()} disabled={!!busy}>
          Insert image…
        </button>
      </p>

      {busy && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          {busy}
        </p>
      )}

      <h3 className={ui.section}>App</h3>
      {onUpdate && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
          <span style={{ flex: 1, fontSize: 14 }}>A new version is ready.</span>
          <button className={`${ui.textButton} ${ui.primary}`} onClick={onUpdate}>
            Restart
          </button>
        </p>
      )}
      {onInstall && (
        <p style={{ margin: '4px 0' }}>
          <button className={ui.textButton} onClick={onInstall}>
            Install app…
          </button>
        </p>
      )}
      <StorageStatus onNotice={onNotice} />

      <h3 className={ui.section}>Preferences</h3>
      <label className={ui.switch}>
        Sidebar on the right
        <input
          type="checkbox"
          checked={sidebarRight}
          onChange={(e) => setPrefs({ sidebarRight: e.target.checked })}
        />
      </label>
      <label className={ui.switch}>
        Paint with a finger (until a pen is used)
        <input
          type="checkbox"
          checked={fingerDrawing}
          onChange={(e) => setPrefs({ fingerDrawing: e.target.checked })}
        />
      </label>

      <h3 className={ui.section}>Color</h3>
      <div className={ui.switch} role="radiogroup" aria-label="Color picker">
        Picker
        <span style={{ display: 'flex', gap: 6 }}>
          {(['square', 'wheel'] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={colorPicker === p}
              className={`${ui.textButton} ${colorPicker === p ? ui.primary : ''}`}
              onClick={() => setPrefs({ colorPicker: p })}
            >
              {p === 'square' ? 'Square' : 'Wheel'}
            </button>
          ))}
        </span>
      </div>
      <label className={ui.switch}>
        Hue, saturation, brightness and contrast sliders
        <input
          type="checkbox"
          checked={colorSliders}
          onChange={(e) => setPrefs({ colorSliders: e.target.checked })}
        />
      </label>

      <h3 className={ui.section}>Canvas view</h3>
      <label className={ui.switch}>
        Arrow keys rotate the canvas
        <input
          type="checkbox"
          checked={arrowRotate}
          onChange={(e) => setPrefs({ arrowRotate: e.target.checked })}
        />
      </label>
      {arrowRotate && (
        <SliderRow
          label="Rotation step"
          value={arrowRotateStep}
          min={0}
          max={90}
          step={5}
          format={() => `${arrowRotateStep}°`}
          onChange={(v) => setPrefs({ arrowRotateStep: Math.max(1, v) })}
        />
      )}
      <label className={ui.switch}>
        Snap rotation to quarter turns
        <input
          type="checkbox"
          checked={snapRotation}
          onChange={(e) => setPrefs({ snapRotation: e.target.checked })}
        />
      </label>
      <SliderRow
        label="Zoom step"
        value={keyZoomStep}
        min={1.1}
        max={2}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setPrefs({ keyZoomStep: v })}
      />
      <SliderRow
        label="Size step"
        value={sizeStep}
        min={0.05}
        max={0.5}
        format={percent}
        onChange={(v) => setPrefs({ sizeStep: v })}
      />

      <h3 className={ui.section}>New canvas background</h3>
      <BackgroundPicker
        label="New canvas background"
        value={newCanvasBackground}
        onChange={(background) => setPrefs({ newCanvasBackground: background })}
      />

      {debug && (
        <>
          <h3 className={ui.section}>Diagnostics</h3>
          <RecorderControls engine={engine} onNotice={onNotice} />
          <p style={{ margin: '4px 0' }}>
            <button
              className={ui.textButton}
              onClick={() =>
                void flush().then(() => {
                  location.href = './?lab';
                })
              }
            >
              Open the lab (benchmarks)
            </button>
          </p>
        </>
      )}

      <h3 className={ui.section}>Gestures & shortcuts</h3>
      <dl
        style={{
          margin: 0,
          fontSize: 13,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '6px 12px',
        }}
      >
        {GESTURES.map(([g, what]) => (
          <div key={g} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--color-text-muted)' }}>{g}</dt>
            <dd style={{ margin: 0 }}>{what}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

interface StorageInfo {
  used: number;
  quota: number;
  persisted: boolean;
}

/** How much the artwork takes up, and whether the browser may clear it under pressure. */
function StorageStatus({ onNotice }: { onNotice: (message: string) => void }) {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const storage = navigator.storage as StorageManager | undefined;
    if (!storage?.estimate) return;
    let cancelled = false;
    Promise.all([storage.estimate(), storage.persisted?.() ?? false])
      .then(([estimate, persisted]) => {
        if (cancelled) return;
        setInfo({ used: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted });
      })
      .catch(() => {}); // not worth a message
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!info) return null;

  const keep = async () => {
    const granted = await navigator.storage.persist().catch(() => false);
    setVersion((v) => v + 1);
    if (!granted) onNotice('The browser didn’t allow it yet; installing the app usually does');
  };

  return (
    <>
      <p style={{ margin: '4px 0', fontSize: 14 }}>
        Storage: {fileSize(info.used)} of {fileSize(info.quota)} ·{' '}
        <span style={{ color: 'var(--color-text-muted)' }}>
          {info.persisted ? 'kept safe from clearing' : 'may be cleared if space runs low'}
        </span>
      </p>
      {!info.persisted && (
        <p style={{ margin: '4px 0' }}>
          <button className={ui.textButton} onClick={() => void keep()}>
            Keep artwork safe
          </button>
        </p>
      )}
    </>
  );
}
