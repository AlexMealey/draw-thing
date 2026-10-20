import { useMemo } from 'react';
import { resolvePreset } from '../../engine/brush/overrides';
import { PRESETS } from '../../engine/brush/presets';
import type { Engine } from '../../engine/Engine';
import { toolStore, useTools } from '../../state/toolStore';
import { Panel } from '../ui/Panel';
import { SettingsIcon } from '../ui/icons';
import ui from '../ui/ui.module.css';
import styles from './Brushes.module.css';
import { usePreview } from './usePreview';

interface Props {
  engine: () => Engine | null;
  onClose: () => void;
  onSettings: (presetId: string) => void;
}

/** Brush library for the current tool (paint or erase). Tap the selected brush to edit it. */
export function BrushLibrary({ engine, onClose, onSettings }: Props) {
  const mode = useTools((s) => s.mode);
  const selected = useTools((s) => s.presetIds[s.mode]);
  const overrides = useTools((s) => s.overrides);
  const presets = useMemo(() => PRESETS.map((p) => resolvePreset(p, overrides[p.id])), [overrides]);
  const preview = usePreview(engine);

  return (
    <Panel
      title={mode === 'erase' ? 'Eraser' : 'Brushes'}
      onClose={onClose}
      actions={
        <button
          className={ui.iconButton}
          aria-label="Brush settings"
          onClick={() => onSettings(selected)}
        >
          <SettingsIcon />
        </button>
      }
    >
      <ul className={styles.list} role="radiogroup" aria-label="Brushes">
        {presets.map((p) => (
          <li key={p.id}>
            <button
              className={styles.brush}
              role="radio"
              aria-checked={p.id === selected}
              onClick={() =>
                p.id === selected ? onSettings(p.id) : toolStore.getState().selectPreset(p.id)
              }
            >
              <span className={styles.name}>{p.name}</span>
              {p.id === selected && <span className={styles.hint}>Tap to edit</span>}
              <img src={preview(p)} alt="" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
