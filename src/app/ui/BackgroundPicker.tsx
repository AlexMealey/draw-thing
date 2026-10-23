import type { Background } from '../../state/documentStore';
import styles from './BackgroundPicker.module.css';
import ui from './ui.module.css';

const SWATCHES: { name: string; color: string }[] = [
  { name: 'White', color: '#ffffff' },
  { name: 'Paper', color: '#f4efe4' },
  { name: 'Gray', color: '#808080' },
  { name: 'Charcoal', color: '#2c2c2e' },
  { name: 'Black', color: '#000000' },
];

interface Props {
  value: Background;
  onChange: (background: Background) => void;
  label?: string;
}

/** A canvas background: a few swatches, any color, or none (hidden, the canvas is transparent). */
export function BackgroundPicker({ value, onChange, label = 'Background' }: Props) {
  const color = value.color.toLowerCase();
  const custom = value.visible && !SWATCHES.some((s) => s.color === color);

  return (
    <div className={styles.picker} role="radiogroup" aria-label={label}>
      {SWATCHES.map((s) => (
        <button
          key={s.color}
          className={styles.swatch}
          style={{ background: s.color }}
          role="radio"
          aria-checked={value.visible && color === s.color}
          aria-label={s.name}
          title={s.name}
          onClick={() => onChange({ color: s.color, visible: true })}
        />
      ))}
      <label
        className={`${styles.swatch} ${styles.custom}`}
        style={custom ? { background: value.color } : undefined}
        data-checked={custom}
        title="Custom color"
      >
        <input
          type="color"
          aria-label="Custom color"
          value={value.color}
          onChange={(e) => onChange({ color: e.target.value, visible: true })}
        />
      </label>
      <button
        className={`${styles.swatch} ${ui.checker}`}
        role="radio"
        aria-checked={!value.visible}
        aria-label="Transparent"
        title="Transparent"
        onClick={() => onChange({ ...value, visible: false })}
      />
    </div>
  );
}
