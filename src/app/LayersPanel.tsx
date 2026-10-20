import type { Engine } from '../engine/Engine';
import { activeIndex, BLEND_MODES, type BlendMode, useDocument } from '../state/documentStore';
import styles from './LayersPanel.module.css';

interface Props {
  engine: () => Engine | null;
  onNotice: (message: string) => void;
}

/** Temporary layers panel for testing the compositor; the real one arrives in Phase 5. */
export function LayersPanel({ engine, onNotice }: Props) {
  const layers = useDocument((s) => s.layers);
  const activeId = useDocument((s) => s.activeLayerId);
  const maxLayers = useDocument((s) => s.maxLayers);
  const background = useDocument((s) => s.background);
  const actions = useDocument((s) => s);
  const index = activeIndex({ layers, activeLayerId: activeId });
  const active = layers[index];

  const add = () => {
    if (actions.addLayer() === null)
      onNotice(`Layer limit reached (${maxLayers} at this canvas size)`);
  };

  return (
    <section className={styles.panel} aria-label="Layers">
      <div className={styles.header}>
        <span>
          Layers {layers.length}/{maxLayers}
        </span>
        <button className={styles.icon} onClick={add} aria-label="Add layer" title="Add layer">
          ＋
        </button>
      </div>

      <ul className={styles.list}>
        {[...layers].reverse().map((l) => (
          <li
            key={l.id}
            className={`${styles.row} ${l.visible ? '' : styles.hidden}`}
            aria-current={l.id === activeId}
          >
            <button className={styles.name} onClick={() => actions.selectLayer(l.id)}>
              {l.name}
              <small>
                {l.blendMode !== 'normal' && l.blendMode}
                {l.opacity < 1 && ` ${Math.round(l.opacity * 100)}%`}
                {l.alphaLocked && ' α'}
                {l.locked && ' 🔒'}
              </small>
            </button>
            <button
              className={styles.icon}
              aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
              aria-pressed={l.visible}
              onClick={() => actions.updateLayer(l.id, { visible: !l.visible })}
            >
              {l.visible ? '●' : '○'}
            </button>
          </li>
        ))}
        <li className={`${styles.row} ${background.visible ? '' : styles.hidden}`}>
          <span className={styles.name}>Background</span>
          <input
            type="color"
            aria-label="Background color"
            value={background.color}
            onChange={(e) => actions.setBackground({ color: e.target.value })}
          />
          <button
            className={styles.icon}
            aria-label={background.visible ? 'Hide background' : 'Show background'}
            aria-pressed={background.visible}
            onClick={() => actions.setBackground({ visible: !background.visible })}
          >
            {background.visible ? '●' : '○'}
          </button>
        </li>
      </ul>

      {active && (
        <div className={styles.props}>
          <label htmlFor="layer-opacity">Opacity</label>
          <input
            id="layer-opacity"
            type="range"
            min={0}
            max={100}
            value={Math.round(active.opacity * 100)}
            onChange={(e) =>
              actions.updateLayer(active.id, { opacity: Number(e.target.value) / 100 })
            }
          />
          <label htmlFor="layer-blend">Blend</label>
          <select
            id="layer-blend"
            value={active.blendMode}
            onChange={(e) =>
              actions.updateLayer(active.id, { blendMode: e.target.value as BlendMode })
            }
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className={styles.checks}>
            <label>
              <input
                type="checkbox"
                checked={active.alphaLocked}
                onChange={(e) => actions.updateLayer(active.id, { alphaLocked: e.target.checked })}
              />
              Alpha lock
            </label>
            <label>
              <input
                type="checkbox"
                checked={active.locked}
                onChange={(e) => actions.updateLayer(active.id, { locked: e.target.checked })}
              />
              Lock
            </label>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button
          onClick={() => active && actions.moveLayer(active.id, index + 1)}
          disabled={index >= layers.length - 1}
        >
          Up
        </button>
        <button
          onClick={() => active && actions.moveLayer(active.id, index - 1)}
          disabled={index <= 0}
        >
          Down
        </button>
        <button onClick={() => engine()?.mergeDown()} disabled={index <= 0}>
          Merge down
        </button>
        <button onClick={() => engine()?.flatten()} disabled={layers.length < 2}>
          Flatten
        </button>
        <button onClick={() => engine()?.clearLayer()}>Clear</button>
        <button
          onClick={() => active && actions.removeLayer(active.id)}
          disabled={layers.length <= 1}
        >
          Delete
        </button>
      </div>
    </section>
  );
}
