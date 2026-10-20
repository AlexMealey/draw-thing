import { useState } from 'react';
import type { Engine } from '../../engine/Engine';
import { tileGrid } from '../../engine/history/tiles';
import { chooseFile, deliver } from '../../files/deliver';
import { exportArtwork, type ExportedFile, type ExportFormat } from '../../files/exportArtwork';
import { decodeImage, fitImage, pixelsToTiles } from '../../files/image';
import { IMAGE_ACCEPT } from '../../files/importFile';
import { documentStore, useDocument } from '../../state/documentStore';
import { toolStore, useTools } from '../../state/toolStore';
import type { OpenProject } from '../project';
import { percent } from '../ui/format';
import { Panel } from '../ui/Panel';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';

interface Props {
  project: OpenProject;
  engine: () => Engine | null;
  flush: () => Promise<void>;
  onNotice: (message: string) => void;
  onClose: () => void;
  onNewCanvas: () => void;
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
];

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: 'Flattened, keeps transparency' },
  { id: 'jpeg', label: 'JPEG', hint: 'Flattened, smallest' },
  { id: 'psd', label: 'PSD', hint: 'Layers, for Photoshop and others' },
  { id: 'drawthing', label: 'DrawThing', hint: 'Everything, to back up or move' },
];

export function ActionsPanel({ project, engine, flush, onNotice, onClose, onNewCanvas }: Props) {
  const width = useDocument((s) => s.width);
  const height = useDocument((s) => s.height);
  const layers = useDocument((s) => s.layers.length);
  const maxLayers = useDocument((s) => s.maxLayers);
  const sidebarRight = useTools((s) => s.sidebarRight);
  const fingerDrawing = useTools((s) => s.fingerDrawing);
  const { setPrefs } = toolStore.getState();
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState<string | null>(null);
  /** An export whose save dialog needs a fresh tap (the first one expired while encoding). */
  const [ready, setReady] = useState<ExportedFile | null>(null);

  const save = async (file: ExportedFile) => {
    const result = await deliver(file.blob, file.filename);
    setReady(result === 'needs-tap' ? file : null);
    if (result === 'saved') onNotice(`Exported ${file.filename}`);
  };

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setReady(null);
    try {
      await job();
    } catch (err) {
      console.error(err);
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const exportAs = (format: ExportFormat, label: string) =>
    run(`Exporting ${label}…`, async () => {
      const e = engine();
      if (!e) return;
      await save(await exportArtwork(e, project, format, { jpegQuality: quality, flush }));
    });

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

      <h3 className={ui.section}>Share</h3>
      <div style={{ display: 'grid', gap: 6 }}>
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className={ui.textButton}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
            disabled={!!busy}
            onClick={() => void exportAs(f.id, f.label)}
          >
            <span>{f.label}</span>
            <small style={{ color: 'var(--color-text-muted)' }}>{f.hint}</small>
          </button>
        ))}
      </div>
      <SliderRow
        label="JPEG quality"
        value={quality}
        min={0.5}
        max={1}
        format={percent}
        onChange={setQuality}
      />
      {busy && (
        <p role="status" style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          {busy}
        </p>
      )}
      {ready && (
        <p>
          <button className={`${ui.textButton} ${ui.primary}`} onClick={() => void save(ready)}>
            Save {ready.filename}
          </button>
        </p>
      )}

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
