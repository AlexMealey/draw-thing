import type { BrushPreset } from '../engine/brush/presets';
import styles from './DevToolbar.module.css';

const COLORS = ['#1c1c1e', '#f2f2f7', '#ff375f', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2'];

export interface BrushAdjustments {
  size: number;
  opacity: number;
  smoothing: number;
}

interface Props {
  presets: readonly BrushPreset[];
  preset: BrushPreset;
  adjust: BrushAdjustments;
  color: string;
  eraser: boolean;
  onPreset: (id: string) => void;
  onAdjust: (adjust: BrushAdjustments) => void;
  onColor: (color: string) => void;
  onEraser: (eraser: boolean) => void;
  layersOpen: boolean;
  onLayers: () => void;
  onFit: () => void;
}

/** Temporary controls for testing the engine; replaced by the real UI in Phase 5. */
export function DevToolbar(props: Props) {
  const { presets, preset, adjust, color, eraser } = props;
  const set = (patch: Partial<BrushAdjustments>) => props.onAdjust({ ...adjust, ...patch });

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Brush">
      <div className={styles.group} role="radiogroup" aria-label="Brush">
        {presets.map((p) => (
          <button
            key={p.id}
            className={styles.button}
            role="radio"
            aria-checked={p.id === preset.id}
            onClick={() => props.onPreset(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <Slider
        label="Size"
        min={1}
        max={preset.size.max}
        value={adjust.size}
        display={`${adjust.size}`}
        onChange={(size) => set({ size })}
      />
      <Slider
        label="Opacity"
        min={1}
        max={100}
        value={Math.round(adjust.opacity * 100)}
        display={`${Math.round(adjust.opacity * 100)}%`}
        onChange={(v) => set({ opacity: v / 100 })}
      />
      <Slider
        label="StreamLine"
        min={0}
        max={100}
        value={Math.round(adjust.smoothing * 100)}
        display={`${Math.round(adjust.smoothing * 100)}%`}
        onChange={(v) => set({ smoothing: v / 100 })}
      />
      <div className={styles.group}>
        {COLORS.map((c) => (
          <button
            key={c}
            className={styles.swatch}
            style={{ background: c }}
            aria-label={`Color ${c}`}
            aria-pressed={!eraser && color === c}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className={styles.group}>
        <button
          className={styles.button}
          aria-pressed={eraser}
          title="Erase with the selected brush"
          onClick={() => props.onEraser(!eraser)}
        >
          Eraser
        </button>
        <button className={styles.button} aria-pressed={props.layersOpen} onClick={props.onLayers}>
          Layers
        </button>
        <button className={styles.button} onClick={props.onFit}>
          Fit
        </button>
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}

function Slider({ label, min, max, value, display, onChange }: SliderProps) {
  return (
    <label className={styles.slider}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{display}</output>
    </label>
  );
}
