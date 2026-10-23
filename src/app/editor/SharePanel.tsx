import { useState } from 'react';
import type { Engine } from '../../engine/Engine';
import { deliver } from '../../files/deliver';
import { exportArtwork, type ExportedFile, type ExportFormat } from '../../files/exportArtwork';
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
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'png', label: 'PNG', hint: 'Flattened, keeps transparency' },
  { id: 'jpeg', label: 'JPEG', hint: 'Flattened, smallest' },
  { id: 'psd', label: 'PSD', hint: 'Layers, for Photoshop and others' },
  { id: 'drawthing', label: 'DrawThing', hint: 'Everything, to back up or move' },
];

/** Exports the artwork, through the share sheet where there is one. */
export function SharePanel({ project, engine, flush, onNotice, onClose }: Props) {
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState<string | null>(null);
  /** An export whose save dialog needs a fresh tap (the first one expired while encoding). */
  const [ready, setReady] = useState<ExportedFile | null>(null);

  const save = async (file: ExportedFile) => {
    const result = await deliver(file.blob, file.filename);
    setReady(result === 'needs-tap' ? file : null);
    if (result === 'saved') onNotice(`Exported ${file.filename}`);
  };

  const exportAs = async (format: ExportFormat, label: string) => {
    setBusy(`Exporting ${label}…`);
    setReady(null);
    try {
      const e = engine();
      if (!e) return;
      await save(await exportArtwork(e, project, format, { jpegQuality: quality, flush }));
    } catch (err) {
      console.error(err);
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Share" side="left" onClose={onClose}>
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
    </Panel>
  );
}
