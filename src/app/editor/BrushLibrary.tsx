import { Fragment, useMemo } from 'react';
import type { Engine } from '../../engine/Engine';
import { brushSections, isBuiltIn, toolStore, useTools } from '../../state/toolStore';
import { Panel } from '../ui/Panel';
import { PinIcon, SettingsIcon } from '../ui/icons';
import ui from '../ui/ui.module.css';
import styles from './Brushes.module.css';
import { usePreview } from './usePreview';

interface Props {
  engine: () => Engine | null;
  onClose: () => void;
  onSettings: (presetId: string) => void;
}

/**
 * Brush library for the current tool (paint or erase). Tap the selected brush to edit it.
 * Pinned custom brushes come first, then the built-in ones, then the other custom ones.
 */
export function BrushLibrary({ engine, onClose, onSettings }: Props) {
  const mode = useTools((s) => s.mode);
  const selected = useTools((s) => s.presetIds[s.mode]);
  const overrides = useTools((s) => s.overrides);
  const customBrushes = useTools((s) => s.customBrushes);
  const sections = useMemo(
    () => brushSections({ customBrushes, overrides }).filter((list) => list.length > 0),
    [customBrushes, overrides],
  );
  const pinned = useMemo(
    () => new Set(customBrushes.filter((b) => b.pinned).map((b) => b.preset.id)),
    [customBrushes],
  );
  const preview = usePreview(engine);
  const { selectPreset, togglePin } = toolStore.getState();

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
        {sections.map((presets, i) => (
          <Fragment key={i}>
            {i > 0 && <li className={styles.divider} role="separator" />}
            {presets.map((p) => (
              <li key={p.id} className={styles.item}>
                <button
                  className={styles.brush}
                  role="radio"
                  aria-checked={p.id === selected}
                  onClick={() => (p.id === selected ? onSettings(p.id) : selectPreset(p.id))}
                >
                  <span className={styles.name}>{p.name}</span>
                  {p.id === selected && <span className={styles.hint}>Tap to edit</span>}
                  <img src={preview(p)} alt="" />
                </button>
                {!isBuiltIn(p.id) && (
                  <button
                    className={`${ui.iconButton} ${styles.pin}`}
                    aria-label={`Pin ${p.name}`}
                    aria-pressed={pinned.has(p.id)}
                    onClick={() => togglePin(p.id)}
                  >
                    <PinIcon fill={pinned.has(p.id) ? 'currentColor' : 'none'} />
                  </button>
                )}
              </li>
            ))}
          </Fragment>
        ))}
      </ul>
    </Panel>
  );
}
