import type { BrushSettings } from '../engine/brush/RoundBrush';
import styles from './DevToolbar.module.css';

const COLORS = ['#1c1c1e', '#f2f2f7', '#ff375f', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2'];

interface Props {
  brush: BrushSettings;
  onBrushChange: (brush: BrushSettings) => void;
  onFit: () => void;
  onClear: () => void;
}

/** Temporary Phase 1 controls for testing the engine; replaced by the real UI in Phase 5. */
export function DevToolbar({ brush, onBrushChange, onFit, onClear }: Props) {
  const set = (patch: Partial<BrushSettings>) => onBrushChange({ ...brush, ...patch });

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Brush">
      <label className={styles.size}>
        Size
        <input
          type="range"
          min={1}
          max={200}
          value={brush.size}
          onChange={(e) => set({ size: Number(e.target.value) })}
        />
        <output>{brush.size}</output>
      </label>
      <div className={styles.group}>
        {COLORS.map((color) => (
          <button
            key={color}
            className={styles.swatch}
            style={{ background: color }}
            aria-label={`Color ${color}`}
            aria-pressed={!brush.eraser && brush.color === color}
            onClick={() => set({ color, eraser: false })}
          />
        ))}
      </div>
      <div className={styles.group}>
        <button
          className={styles.button}
          aria-pressed={brush.eraser}
          onClick={() => set({ eraser: !brush.eraser })}
        >
          Eraser
        </button>
        <button className={styles.button} onClick={onFit}>
          Fit
        </button>
        <button className={styles.button} onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
